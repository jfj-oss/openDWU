// The UI's end of the player's message pipeline (docs/sim-worker.md §4.5). The pipeline itself — the star-date stamps,
// the message history, the advisor queue, an event's history message, the defeat game end — is sim code that runs in
// the tick (sim/playerMessages.ts), in every mode. The UI only reads and draws:
//
// - PlayerMessageStream: each message the pipeline handled, with its receipt (the popup / conversation / ticker
//   decisions), for the ticker (empireMessageFeed.ts), the popups and stubs (messagePopups.ts). In-thread it is fed by
//   the galaxy's pipeline listener (installLocalMessageStream); in worker mode by the worker's 'playerMessages' events
//   (workerMessages.ts). The events reach the UI's event recipient (eventMessages.ts): in-thread the sim calls it, in
//   worker mode workerMessages.ts does.
// - The conversation queue rules (rebuilt from a loaded game's history, pruned): UI state, as the C# queue is not saved.
// - The two UI-triggered writes are journaled commands (removeOldHistoryMessages, expireAdvisorSuggestionsForEmpire).
//
// No DOM / Pixi imports.

import { EmpireMessage, EmpireMessageType, empireMessageHistory, removeOldHistoryMessages } from '../sim/messages';
import type { Empire } from '../sim/empire';
import type { Galaxy } from '../sim/galaxy';
import { DiplomaticRelationType, DiplomaticStrategy, type DiplomaticRelation } from '../sim/diplomacy';
import { determineDesiredDiplomaticRelationTypical } from '../sim/diplomacyTick';
import { REAL_SECONDS_IN_GALACTIC_YEAR } from '../sim/galaxyTime';
import { setPlayerMessageListener, type PlayerMessageReceipt } from '../sim/playerMessages';
import { issuePlayerCommand } from '../sim/player/playerCommands';
import { getMessageOptions, routeEmpireMessage, shouldQueueConversation, type DialogPartType } from './messageRouting';
import { isConversationExpired } from './messageStubs';

export type { PlayerMessageReceipt } from '../sim/playerMessages';
export { eventHistoryMessageType, recordEventMessage, type QueuedEvent } from '../sim/playerMessages';

// ---------------------------------------------------------------------------------------------------------------
// The conversation queue (UI state, as the C# DiplomaticMessageQueue is: rebuilt from a loaded game, pruned; messagePopups.ts)
// ---------------------------------------------------------------------------------------------------------------

export interface ConversationEntry {
    message: EmpireMessage;
    conversation: DialogPartType;
    sender: Empire | null;
}

/**
 * EmpireDetailView.cs:639-706 flag3 — the same rule as screens/diplomacyScreen.ts isProposalValid (kept here so the
 * popups, which cannot import the screen, decide the same; test/simWorkerMessages.test.ts checks they agree).
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

/**
 * A ProposeDiplomaticRelation naming DiplomaticRelationType.None from an empire the player is at war with: Main.Part9.cs
 * 1694-1723 queues it as the WAR_END conversation, whose answers (Main.Part9.cs:500: WAR_END_ACCEPT / ..._SUBJUGATIONDEMAND
 * / ..._REJECT, Main.Part10.cs:4798) act on the relation, not on a pending proposal. An AI's SubjugateRequest (Empire.8.cs
 * 1527) arrives this way: its proposed SubjugatedDominion relation never passes EmpireDetailView's check, but the
 * conversation stays answerable while the war is on.
 */
export function isWarEndConversation(entry: ConversationEntry, player: Empire): boolean {
    if (entry.message.messageType !== EmpireMessageType.ProposeDiplomaticRelation || entry.sender === null) return false;
    if (entry.message.subject !== DiplomaticRelationType.None) return false;
    return player.diplomaticRelations.byEmpire(entry.sender)?.type === DiplomaticRelationType.War;
}

// Stand-in for DiplomaticMessageQueue.cs:404 ExpireInvalidMessages — TODO(port): the full per-type expiry rules
// [popupstubs] + DiplomaticMessageQueue.cs:671 method_3: entries older than 250 x RealSecondsInGalacticYear expire.
export function pruneConversationQueue(queue: ConversationEntry[], player: Empire, starDate: number): number {
    let removed = 0;
    for (let i = queue.length - 1; i >= 0; i--) {
        const e = queue[i];
        if (
            (e.message.messageType === EmpireMessageType.ProposeDiplomaticRelation && !isAnswerableProposal(e, player, starDate) && !isWarEndConversation(e, player)) ||
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
// The stream the consumers read
// ---------------------------------------------------------------------------------------------------------------

/** How long a receipt stays readable (each consumer polls every 250 ms and keeps its own seen set). */
const STREAM_RETAIN_MS = 10_000;
const STREAM_MAX = 4000;

/** The player messages the pipeline handled, oldest first, with its decisions. One per game view (both modes). */
export class PlayerMessageStream {
    private entries: { r: PlayerMessageReceipt; at: number }[] = [];
    private readonly byMessage = new WeakMap<EmpireMessage, PlayerMessageReceipt>();

    constructor(private readonly now: () => number = () => performance.now()) {}

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

/** Install (or with null remove) the stream for the game view's player. */
export function setPlayerMessageStream(player: Empire, stream: PlayerMessageStream | null): void {
    if (stream === null) streams.delete(player);
    else streams.set(player, stream);
}

/** The stream of `player` (undefined: no game view installed one — nothing to show). */
export function playerMessageStream(player: Empire | null): PlayerMessageStream | undefined {
    return player === null ? undefined : streams.get(player);
}

/**
 * In-thread: the game's pipeline feeds a stream for its player (the receipts; the events reach the UI's recipient
 * from the sim). Returns the stream and the teardown.
 */
export function installLocalMessageStream(galaxy: Galaxy, player: Empire, now?: () => number): { stream: PlayerMessageStream; dispose: () => void } {
    const stream = new PlayerMessageStream(now);
    setPlayerMessageStream(player, stream);
    setPlayerMessageListener(galaxy, (note) => {
        if (note.receipt !== undefined) stream.push(note.receipt);
    });
    return {
        stream,
        dispose: () => {
            setPlayerMessageListener(galaxy, null);
            setPlayerMessageStream(player, null);
        },
    };
}

// ---------------------------------------------------------------------------------------------------------------
// The UI-triggered writes (journaled commands)
// ---------------------------------------------------------------------------------------------------------------

/** Galactic History's rebind (Main.Part4.cs:2986 method_542 → Empire.cs 4708 RemoveOldHistoryMessages): a command. */
export function trimMessageHistory(galaxy: Galaxy, player: Empire): void {
    issuePlayerCommand(galaxy, player, 'removeOldHistoryMessages', []);
}

/**
 * The history as it reads once the trim has applied (the command lands at the next boundary, in worker mode a round
 * trip later): the screen lists this meanwhile (the same algorithm run on a copy).
 */
export function trimmedHistoryView(player: Empire): EmpireMessage[] {
    const copy = { messageHistory: empireMessageHistory(player).slice(), maximumHistoryMessages: player.maximumHistoryMessages } as unknown as Empire;
    removeOldHistoryMessages(copy);
    return empireMessageHistory(copy);
}

/** The advisor cases of ExpireDiplomacyMessagesForEmpire (messagePopups.ts): a command. */
export function expirePlayerAdvisorSuggestionsFor(galaxy: Galaxy, player: Empire, empire: Empire | null): void {
    if (empire === null) return;
    issuePlayerCommand(galaxy, player, 'expireAdvisorSuggestionsForEmpire', [empire]);
}
