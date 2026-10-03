// The sim-state half of the player's message pipeline (docs/sim-worker.md §9 chunk 4), DOM-free so that both threads
// run the same code:
//
// - In-thread (the default), the UI timers call these functions exactly where they wrote the sim before: the ticker
//   (main.ts refreshHud → empireMessageFeed.ts recordTickerMessage), the popups (messagePopups.ts tick →
//   receivePopupMessage) and the event recipient (eventMessages.ts handle → recordEventMessage).
// - With the sim in a worker, the replica is read-only, so those writes run in the worker instead:
//   PlayerMessagePipeline is the player's IMessageRecipient / IEventMessageRecipient there (Main.Part9.cs
//   ReceiveMessage / Main.Part4.cs:481 ReceiveEventMessage queue the call for the UI thread, BeginInvoke; here the
//   worker queues them during the tick) and SimHost pumps it after every tick, between frames as the UI timers run
//   in-thread: the ticker pass, then the popup pass, then the event pass — the in-thread order of the three timers.
//   Each pump becomes one 'playerMessages' worker event: every message the player received (each exactly once, even
//   when Empire.Messages was emptied by ProcessMessages before any sync) with the decisions the worker took for it,
//   and the event messages. The main thread's PlayerMessageStream feeds them to the ticker, the popups and the event
//   recipient, which then only draw.
// - The few user-triggered writes (Galactic History's RemoveOldHistoryMessages, the advisor expiry of a diplomacy
//   exchange) and the Game Options message filters reach the worker as unjournaled UI ops (applyPlayerMessageUiOp),
//   applied on receipt like the in-thread direct writes, never as journaled commands — so the command log stays the
//   in-thread one.
//
// No DOM / Pixi imports (the worker bundles this).

import { EmpireMessage, EmpireMessageType, empireMessageHistory, removeOldHistoryMessages, sendEmpireMessage } from '../sim/messages';
import type { Empire } from '../sim/empire';
import type { Galaxy } from '../sim/galaxy';
import { BuiltObject } from '../sim/builtObject';
import { Habitat } from '../sim/types';
import { EventMessageType } from '../sim/eventTypes';
import { DiplomaticRelationType, DiplomaticStrategy, type DiplomaticRelation } from '../sim/diplomacy';
import { determineDesiredDiplomaticRelationTypical } from '../sim/diplomacyTick';
import { REAL_SECONDS_IN_GALACTIC_YEAR } from '../sim/galaxyTime';
import { galaxyStarDate } from '../sim/tick/simTime';
import { onGameEnd } from '../sim/victory';
import { expireAdvisorSuggestionsForEmpire, receiveAdvisorSuggestionMessage } from '../sim/advisorQueue';
import {
    MessageCategory,
    getMessageOptions,
    playerDefeatGameEnd,
    replaceMessageOptions,
    routeEmpireMessage,
    shouldQueueConversation,
    type DialogPartType,
    type MessageOptions,
    type MessageRoute,
} from './messageRouting';
import { formatEmpireMessage, recordTickerMessage } from './empireMessageFeed';
import { withSimWrites } from '../sim/readOnlyQuery';
import { isConversationExpired } from './messageStubs';

// ---------------------------------------------------------------------------------------------------------------
// The event recipient (Main.Part4.cs:487 method_523, the recording half)
// ---------------------------------------------------------------------------------------------------------------

/**
 * The EmpireMessageType method_523 records an event as (Main.Part4.cs:509-1306), or null when it records nothing
 * (EmpireMessageType.Informational in the main branch, 1311: NewEmpireEmerges and the unlisted types).
 * The three "decision" events (1471-1510, the else branch) are recorded as Informational (which the history skips).
 */
export function eventHistoryMessageType(type: EventMessageType, additionalData: unknown): EmpireMessageType | null {
    const T = EventMessageType;
    const M = EmpireMessageType;
    switch (type) {
        case T.EncounterBuiltObject:
            return additionalData instanceof BuiltObject ? M.ExplorationBuiltObject : null; // 509-528
        case T.EncounterRuins:
            return additionalData instanceof Habitat ? M.ExplorationRuins : null; // 531-554
        case T.RogueFleetDefectsToUs:
        case T.UncoverPirateAttackFundingAnotherEmpire:
        case T.UncoverPlanetDestroyerConstruction:
            return M.Informational; // 1498-1505
        case T.NewEmpireRaceAbility:
        case T.ExoticTechDiscovered:
        case T.SpecialGovernmentType:
        case T.GalacticRefugees:
        case T.SleepersAwake:
        case T.LostBuiltObjectCoordinates:
        case T.LostColonyCoordinates:
        case T.TreasureFound:
        case T.LostColonyFound:
        case T.IndependentPopulation:
            return M.ExplorationHabitat;
        case T.CreatureOutbreak:
        case T.BuiltObjectExplodes:
        case T.PirateAmbush:
            return M.BattleUnderAttack;
        case T.FreeSuperShip:
        case T.PirateFactionJoinsYou:
            return M.ExplorationBuiltObject;
        case T.GeneralRuinsDiscovery:
        case T.RuinsEmpireBonus:
            return M.ExplorationRuins;
        case T.OriginsDiscovery:
        case T.StoryClue:
            return M.GalacticHistory; // 751-771
        case T.RestrictedResourceDiscovered:
            return M.RestrictedResourceDiscovered;
        case T.RogueFleetDefectsFromUs:
        case T.EmpireSplits:
        case T.UncoverPirateAttackFundingYourEmpire:
        case T.DisasterEvent:
        case T.ResourceDepletion:
        case T.PhantomPirates:
            return M.GeneralBadEvent;
        case T.UncoverKnownLocation: // 833-850: goto SpecialArea / AncientBattleDebrisField
        case T.SpecialArea:
        case T.AncientBattleDebrisField:
            return M.ExplorationLocation;
        case T.RareResourceIntercepted:
        case T.ResourceAppearance:
        case T.WonderBuilt:
            return M.GeneralGoodEvent;
        case T.GeneralDiscovery: // 887-953
            if (additionalData instanceof BuiltObject) return M.ExplorationBuiltObject;
            if (additionalData instanceof Habitat) return M.ExplorationHabitat;
            return M.ExplorationRuins;
        case T.RaceEvent:
        case T.CharacterEvent:
        case T.LeaderChange:
            return M.GeneralNeutralEvent;
        default:
            return null;
    }
}

/** One Empire.SendEventMessageToEmpire call (events.ts), as the recipient queued it. */
export interface QueuedEvent {
    type: EventMessageType;
    title: string;
    message: string;
    additionalData: unknown;
    location: unknown;
}

/**
 * Main.Part4.cs:487 method_523, the recording half: the event becomes a suppressed-popup EmpireMessage of the
 * method_523 type sent to the player (so it reaches the ticker and the saved MessageHistory), gated by 1311 / 1496
 * _Game.DisplayMessageExploration.
 */
export function recordEventMessage(player: Empire, e: QueuedEvent, options: MessageOptions): void {
    const type = eventHistoryMessageType(e.type, e.additionalData);
    if (type === null || !options.ticker[MessageCategory.Exploration]) return;
    const m = new EmpireMessage(player, type, e.location);
    m.description = e.message;
    m.title = e.title;
    m.supressPopup = true;
    // The pipeline's writes are sim writes on purpose (both threads, see the file header; docs/sim-worker.md §8): the
    // lazy lookups write here as they do in the worker (readOnlyQuery.ts).
    withSimWrites(() => sendEmpireMessage(m, player));
}

// ---------------------------------------------------------------------------------------------------------------
// The popup pass (Main.Part9.cs ReceiveMessageInternal, its sim writes)
// ---------------------------------------------------------------------------------------------------------------

/** What the popup pass decided for one message (the UI acts on it: stub, card, sounds, conversation queue). */
export interface PopupReceipt {
    /** Taken by the advisor queue (Main.Part9.cs 2226): nothing else happens to it. */
    advisor: boolean;
    /** null when `advisor`. */
    route: MessageRoute | null;
    action: 'queue' | 'open' | 'none';
}

/**
 * The sim side of one new message in messagePopups.ts tick, in the original order: an AdvisorSuggestion joins the
 * advisor queue (Main.Part9.cs 2226) and is done; the player's own EmpireDefeated ends the game (1994-2020 →
 * Galaxy_GameEnd); a popup is stamped with the star date when it has none; a conversation is stamped (2361).
 */
export function receivePopupMessage(galaxy: Galaxy, player: Empire, m: EmpireMessage, options: MessageOptions): PopupReceipt {
    // Sim writes on purpose, in both threads (the file header): the lazy lookups write (readOnlyQuery.ts).
    return withSimWrites(() => receivePopupMessageWrites(galaxy, player, m, options));
}

function receivePopupMessageWrites(galaxy: Galaxy, player: Empire, m: EmpireMessage, options: MessageOptions): PopupReceipt {
    if (receiveAdvisorSuggestionMessage(player, m)) return { advisor: true, route: null, action: 'none' };
    const route = routeEmpireMessage(m, player, options);
    const defeat = playerDefeatGameEnd(m, player, galaxy.empires);
    if (defeat !== null) onGameEnd(galaxy, defeat);
    if (route.popup && m.starDate <= 0) m.starDate = galaxyStarDate(galaxy);
    const action = shouldQueueConversation(route, options);
    if (action !== 'none' && route.conversation !== null) m.starDate = galaxyStarDate(galaxy); // Main.Part9.cs 2361
    return { advisor: false, route, action };
}

// ---------------------------------------------------------------------------------------------------------------
// The conversation queue rebuilt from a loaded game (messagePopups.ts; pure, so the worker seeds its pass the same way)
// ---------------------------------------------------------------------------------------------------------------

export interface ConversationEntry {
    message: EmpireMessage;
    conversation: DialogPartType;
    sender: Empire | null;
}

/**
 * EmpireDetailView.cs:639-706 flag3 — the same rule as screens/diplomacyScreen.ts isProposalValid (kept here so the
 * worker, which cannot load the screen, decides the same; test/simWorkerMessages.test.ts checks they agree).
 */
export function isProposalStillValid(proposal: DiplomaticRelation, other: Empire, player: Empire, starDate: number): boolean {
    const validMs = Math.trunc(0.2 * REAL_SECONDS_IN_GALACTIC_YEAR * 1000); // Galaxy.TreatyOfferValidYears (Galaxy.3.cs:5059)
    if (starDate > proposal.lastDiplomacyTradeOfferDate + validMs) return false;
    const theirs = other.diplomaticRelations.byEmpire(player);
    // A missing relation matches the fresh NotMet relation ObtainDiplomaticRelation would add.
    const strategy = theirs ? theirs.strategy : DiplomaticStrategy.Undefined;
    const type = theirs ? theirs.type : DiplomaticRelationType.NotMet;
    if (determineDesiredDiplomaticRelationTypical(strategy, type) !== proposal.type) return false;
    return true;
}

/** A treaty proposal from the sender that the player can still accept or decline (EmpireDetailView.cs:639-706 flag3). */
export function isAnswerableProposal(entry: ConversationEntry, player: Empire, starDate: number): boolean {
    if (entry.message.messageType !== EmpireMessageType.ProposeDiplomaticRelation) return false;
    if (entry.sender === null) return false;
    const p = player.proposedDiplomaticRelations.byEmpire(entry.sender);
    if (p === null) return false;
    return isProposalStillValid(p, entry.sender, player, starDate);
}

// Stand-in for DiplomaticMessageQueue.cs:404 ExpireInvalidMessages — TODO(port): the full per-type expiry rules
// [popupstubs] + DiplomaticMessageQueue.cs:671 method_3: entries older than 250 x RealSecondsInGalacticYear expire.
export function pruneConversationQueue(queue: ConversationEntry[], player: Empire, starDate: number): number {
    let removed = 0;
    for (let i = queue.length - 1; i >= 0; i--) {
        const e = queue[i];
        if (
            (e.message.messageType === EmpireMessageType.ProposeDiplomaticRelation && !isAnswerableProposal(e, player, starDate)) ||
            (e.message.starDate > 0 && isConversationExpired(e.message.starDate, starDate))
        ) {
            queue.splice(i, 1);
            removed++;
        }
    }
    return removed;
}

/**
 * The conversation queue rebuilt from a loaded game's message history (the C# queue is not saved): each history message
 * that ReceiveMessageInternal would queue (not the immediate ones, which opened at once), newer than the queue's
 * 250-year expiry, oldest first; stale treaty offers are then pruned. A non-offer conversation the player had already
 * dismissed before saving comes back until it expires — TODO(port): the C# drops the whole queue on load
 * (Main.Part12.cs 1204 ClearData); here the history stands in so pending offers survive a load.
 */
export function rebuildConversationQueue(history: readonly EmpireMessage[], player: Empire, starDate: number): ConversationEntry[] {
    const out: ConversationEntry[] = [];
    const options = getMessageOptions();
    const sorted = history.filter((m) => m != null).map((m, i) => ({ m, i })).sort((a, b) => a.m.starDate - b.m.starDate || a.i - b.i);
    for (const { m } of sorted) {
        if (m.messageType === EmpireMessageType.AdvisorSuggestion) continue;
        if (isConversationExpired(m.starDate, starDate)) continue;
        const route = routeEmpireMessage(m, player, options);
        if (route.conversation === null || shouldQueueConversation(route, options) !== 'queue') continue;
        out.push({ message: m, conversation: route.conversation, sender: m.sender });
    }
    pruneConversationQueue(out, player, starDate);
    return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Worker side: the player's recipients and the pump
// ---------------------------------------------------------------------------------------------------------------

/** Everything the pipeline decided for one received message (one PlayerMessagesEvent entry). */
export interface PlayerMessageReceipt {
    message: EmpireMessage;
    /** The ticker line (empireMessageFeed.ts formatEmpireMessage), or null: no ticker line, not recorded. */
    ticker: string | null;
    /** The popup pass handled it (false: a loaded game's queued conversation, which the popups already know). */
    popupPass: boolean;
    advisor: boolean;
    route: MessageRoute | null;
    action: 'queue' | 'open' | 'none';
}

export interface PlayerMessageBatch {
    receipts: PlayerMessageReceipt[];
    events: QueuedEvent[];
}

/** Empire.messageRecipient / eventMessageRecipient while the pipeline is attached (none: null). */
interface Recipients {
    receiveMessage(message: EmpireMessage): void;
    receiveEventMessage(type: number, title: string, message: string, additionalData: unknown, location: unknown): void;
}

function defineHidden(player: Empire, field: 'messageRecipient' | 'eventMessageRecipient', value: unknown, enumerable = false): void {
    Object.defineProperty(player, field, { value, enumerable, writable: true, configurable: true });
}

/**
 * Attach (or with null detach) the pipeline as the player's message and event recipient. Both fields are made
 * non-enumerable, like eventMessages.ts does for the UI recipient: the save codec and the replica sync walk own
 * enumerable fields, so neither ever sees the callbacks. The sim worker attaches before its replica sync first looks
 * at the empire, so the replica's Empire simply has no such fields.
 */
export function attachPlayerRecipients(player: Empire, r: Recipients | null): void {
    defineHidden(player, 'messageRecipient', r);
    defineHidden(player, 'eventMessageRecipient', r);
}

/** Back to the plain fields of a fresh Empire (both null, enumerable). */
export function restorePlayerRecipients(player: Empire): void {
    defineHidden(player, 'messageRecipient', null, true);
    defineHidden(player, 'eventMessageRecipient', null, true);
}

/**
 * Run `fn` (a save) with the player's recipients as an in-thread game has them when it saves: messageRecipient a
 * plain null field (in-thread nothing ever sets it), eventMessageRecipient hidden (the UI's recipient is). The
 * worker's save text is then byte-identical to the in-thread one. defineProperty keeps the key's position.
 */
export function withRecipientsAsSaved<T>(player: Empire, fn: () => T): T {
    const own = Object.getOwnPropertyDescriptor(player, 'messageRecipient');
    if (own === undefined || own.enumerable === true) return fn();
    defineHidden(player, 'messageRecipient', null, true);
    try {
        return fn();
    } finally {
        defineHidden(player, 'messageRecipient', own.value);
    }
}

/**
 * The worker-side pipeline: queues what the sim sends the player during a tick, and runs the UI's sim writes for it
 * once the tick is over (pump). Not ready until the main thread has sent its message options (the Game Options
 * filters decide what is recorded); until then it only queues.
 */
export class PlayerMessagePipeline implements Recipients {
    private pending: EmpireMessage[];
    private events: QueuedEvent[] = [];
    private readonly tickerSeen = new WeakSet<EmpireMessage>();
    private readonly popupSeen = new WeakSet<EmpireMessage>();
    private seeded = false;
    ready = false;

    constructor(
        readonly galaxy: Galaxy,
        readonly player: Empire,
    ) {
        // What is already queued (a loaded save's Empire.Messages) is new to the UI, as the first in-thread poll sees it.
        this.pending = (player.messages as EmpireMessage[]).filter((m) => m != null);
    }

    /** IMessageRecipient (Empire.7.cs 2946 SendMessageToEmpire → Main.ReceiveMessage). */
    receiveMessage(message: EmpireMessage): void {
        this.pending.push(message);
    }

    /** IEventMessageRecipient (events.ts sendEventMessageToEmpire → Main.ReceiveEventMessage). */
    receiveEventMessage(type: number, title: string, message: string, additionalData: unknown, location: unknown): void {
        this.events.push({ type, title, message, additionalData, location });
    }

    /** Messages / events waiting for the next pump. */
    get backlog(): number {
        return this.pending.length + this.events.length;
    }

    /**
     * The UI timers' sim writes for everything received since the last pump, in the in-thread order (ticker, popups,
     * events). Returns what the main thread needs to show it, or null when nothing arrived (or not ready yet).
     */
    pump(): PlayerMessageBatch | null {
        if (!this.ready) return null;
        const { galaxy, player } = this;
        if (!this.seeded) {
            // messagePopups.ts install: a loaded game's pending conversations come back from the saved history and are
            // not handled again.
            this.seeded = true;
            for (const e of rebuildConversationQueue(empireMessageHistory(player) ?? [], player, galaxyStarDate(galaxy))) this.popupSeen.add(e.message);
        }
        if (this.pending.length === 0 && this.events.length === 0) return null;
        const fresh = this.pending;
        this.pending = [];
        const byMessage = new Map<EmpireMessage, PlayerMessageReceipt>();
        const receipts: PlayerMessageReceipt[] = [];
        const receiptOf = (m: EmpireMessage): PlayerMessageReceipt => {
            let r = byMessage.get(m);
            if (r === undefined) {
                r = { message: m, ticker: null, popupPass: false, advisor: false, route: null, action: 'none' };
                byMessage.set(m, r);
                receipts.push(r);
            }
            return r;
        };
        // 1. The ticker (main.ts refreshHud: createEmpireMessageFeed().pollMessages + recordTickerMessage).
        for (const m of fresh) {
            if (m == null || this.tickerSeen.has(m)) continue;
            this.tickerSeen.add(m);
            const text = formatEmpireMessage(m, player);
            receiptOf(m).ticker = text;
            if (text !== null) recordTickerMessage(player, m, galaxyStarDate(galaxy));
        }
        // 2. The popups (messagePopups.ts tick).
        const options = getMessageOptions();
        for (const m of fresh) {
            if (m == null || this.popupSeen.has(m)) continue;
            this.popupSeen.add(m);
            const p = receivePopupMessage(galaxy, player, m, options);
            const r = receiptOf(m);
            r.popupPass = true;
            r.advisor = p.advisor;
            r.route = p.route;
            r.action = p.action;
        }
        // 3. The event recipient (eventMessages.ts timer).
        const events = this.events;
        this.events = [];
        for (const e of events) recordEventMessage(player, e, getMessageOptions());
        return { receipts, events };
    }
}

/** The UI ops the main thread sends the worker (unjournaled, applied on receipt: the in-thread direct writes). */
export type PlayerMessageUiOp = 'messageOptions' | 'removeOldHistoryMessages' | 'expireAdvisorSuggestionsForEmpire';

/** Apply one UI op in the worker. Returns false for an unknown op. */
export function applyPlayerMessageUiOp(pipeline: PlayerMessagePipeline | null, op: string, args: readonly unknown[]): boolean {
    switch (op) {
        case 'messageOptions':
            // Game Options → DisplayMessage* / DisplayPopup* / SuppressAllPopups (session state, messageRouting.ts).
            replaceMessageOptions(args[0] as MessageOptions);
            if (pipeline !== null) pipeline.ready = true;
            return true;
        case 'removeOldHistoryMessages':
            // Galactic History rebind (Main.Part4.cs:2986 method_542 → Empire.cs 4708).
            removeOldHistoryMessages(args[0] as Empire);
            return true;
        case 'expireAdvisorSuggestionsForEmpire':
            // DiplomaticMessageQueue.cs 344 ExpireDiplomacyMessagesForEmpire, the advisor cases (messagePopups.ts).
            expireAdvisorSuggestionsForEmpire(args[0] as Empire, (args[1] as Empire | null) ?? null);
            return true;
        default:
            return false;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Main side (worker mode): the stream the consumers read instead of Empire.Messages
// ---------------------------------------------------------------------------------------------------------------

/** How long a receipt stays readable (each consumer polls every 250 ms and keeps its own seen set). */
const STREAM_RETAIN_MS = 10_000;
const STREAM_MAX = 4000;

/**
 * The player messages the worker delivered, oldest first, with the worker's decisions. Present (for the replica's
 * player) only in worker mode: the consumers then show these instead of polling Empire.Messages and leave the sim
 * writes to the worker. `post` sends a UI op to the worker.
 */
export class PlayerMessageStream {
    private entries: { r: PlayerMessageReceipt; at: number }[] = [];
    private readonly byMessage = new WeakMap<EmpireMessage, PlayerMessageReceipt>();

    constructor(
        readonly post: (op: PlayerMessageUiOp, args: unknown[]) => void,
        private readonly now: () => number = () => performance.now(),
    ) {}

    push(r: PlayerMessageReceipt): void {
        if (this.byMessage.has(r.message)) return;
        this.byMessage.set(r.message, r);
        this.entries.push({ r, at: this.now() });
    }

    /** The receipts still retained (a few seconds' worth), oldest first. */
    receipts(): PlayerMessageReceipt[] {
        const cut = this.now() - STREAM_RETAIN_MS;
        let drop = 0;
        while (drop < this.entries.length && (this.entries[drop].at < cut || this.entries.length - drop > STREAM_MAX)) drop++;
        if (drop > 0) this.entries.splice(0, drop);
        return this.entries.map((e) => e.r);
    }

    receiptOf(m: EmpireMessage): PlayerMessageReceipt | undefined {
        return this.byMessage.get(m);
    }
}

const streams = new WeakMap<Empire, PlayerMessageStream>();

/** Install (or with null remove) the worker-mode stream for the replica's player. */
export function setPlayerMessageStream(player: Empire, stream: PlayerMessageStream | null): void {
    if (stream === null) streams.delete(player);
    else streams.set(player, stream);
}

/** The worker-mode stream of `player` (undefined: in-thread — the UI writes the sim itself). */
export function playerMessageStream(player: Empire | null): PlayerMessageStream | undefined {
    return player === null ? undefined : streams.get(player);
}

/** Galactic History's rebind trim (Empire.cs 4708 RemoveOldHistoryMessages) in either mode. */
export function trimMessageHistory(player: Empire): void {
    const stream = playerMessageStream(player);
    if (stream === undefined) {
        removeOldHistoryMessages(player);
        return;
    }
    stream.post('removeOldHistoryMessages', [player]);
}

/**
 * The history as it reads once a pending trim has landed: in worker mode the worker trims, and the replica's list
 * catches up with the next sync; the screen lists this meanwhile (the same algorithm run on a copy).
 */
export function trimmedHistoryView(player: Empire): EmpireMessage[] {
    const copy = { messageHistory: empireMessageHistory(player).slice(), maximumHistoryMessages: player.maximumHistoryMessages } as unknown as Empire;
    removeOldHistoryMessages(copy);
    return empireMessageHistory(copy);
}

/** The advisor cases of ExpireDiplomacyMessagesForEmpire (messagePopups.ts) in either mode. */
export function expirePlayerAdvisorSuggestionsFor(player: Empire, empire: Empire | null): void {
    const stream = playerMessageStream(player);
    if (stream === undefined) expireAdvisorSuggestionsForEmpire(player, empire);
    else stream.post('expireAdvisorSuggestionsForEmpire', [player, empire]);
}
