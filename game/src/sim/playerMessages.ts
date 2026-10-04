// The player's message pipeline, in the sim: the game-state half of the C# Main's handling of what the sim sends the
// player (Main.Part9.cs 1572 ReceiveMessageInternal, Main.Part4.cs:487 method_523, Main.Part9.cs 1053
// PromptForAuthorizationInternal).
//
// In the C#, Main is the player empire's IMessageRecipient, IEventMessageRecipient and IAutomationAuthorizer
// (Main.Part12.cs:2881). Each call from the sim threads is queued for the UI thread with BeginInvoke (Main.Part9.cs 1535
// ReceiveMessage, Main.Part4.cs:481 ReceiveEventMessage, Main.Part9.cs 1046 PromptForAuthorization) and handled there,
// one at a time in arrival order. The handlers write game state: the message's StarDate, Empire.MessageHistory
// (method_251 AddHistoryMessage), the advisor queue (the DiplomaticMessageQueue's AdvisorSuggestion entries), the
// defeat game end (Galaxy_GameEnd), and an event's history message (SendMessageToEmpire from method_523). When the UI
// thread gets to the queue depends on thread timing, so the C# has no fixed point. The port picks one, in the same
// arrival order:
//
// - The queue is the player's inbox (messages.ts playerInbox): SendMessageToEmpire, SendEventMessageToEmpire and
//   PromptPlayerForAuthorization append to it.
// - processPlayerMessages drains it at the end of every sim frame (scheduler.ts runSimFrame → playerMessagesFrameEnd,
//   which then also runs the advisor queue's age expiry: the UI thread runs between the sim's frames) and after every
//   applied command (player/playerCommands.ts, strategicDecisions.ts: a click's
//   handler finishes before the UI thread takes the next queued call). Anything sent while draining, such as an
//   event's history message, joins the end of the queue and is handled in the same drain, as a BeginInvoke from the
//   UI thread is.
// - serializeGame drains it before it saves. So the inbox is empty at every save point, and is not saved.
//
// The game state the pipeline changes is part of every mode: headless runs and replays (seed + command log), the
// in-thread app and the sim worker run the same code at the same points. The UI only reads and draws: it gets each
// handled message's receipt (the popup / conversation / ticker decisions) and each event through the galaxy's
// listener (setPlayerMessageListener). The in-thread app turns them into a PlayerMessageStream; the worker sends them
// to the main thread (simworker/simHost.ts 'playerMessages').
//
// Headless, no Rnd. No DOM / Pixi. Not part of the C# Main's UI: sounds, the popup card, the conversation queue, the
// stubs and the ticker list are ui/.

import type { Galaxy } from './galaxy';
import type { Empire } from './empire';
import { EmpireMessage, EmpireMessageType, addHistoryMessage, attachPlayerInbox, playerInbox, sendEmpireMessage, type QueuedEvent } from './messages';
import { BuiltObject } from './builtObject';
import { Habitat } from './types';
import { EventMessageType } from './eventTypes';
import { galaxyStarDate } from './tick/simTime';
import { onGameEnd } from './victory';
import { addAdvisorSuggestion, expireOldAdvisorSuggestions, receiveAdvisorSuggestionMessage } from './advisorQueue';
import { MessageCategory, galaxyMessageOptions, playerDefeatGameEnd, routeEmpireMessage, shouldQueueConversation, tickerShown, type MessageOptions, type MessageRoute } from './messageRouting';
import { withSimWrites } from './readOnlyQuery';

export type { QueuedEvent } from './messages';

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

/**
 * Main.Part4.cs:487 method_523, the recording half: the event becomes a suppressed-popup EmpireMessage of the
 * method_523 type sent to the player (so it reaches the ticker and the saved MessageHistory), gated by 1311 / 1496
 * _Game.DisplayMessageExploration. The message joins the player's inbox and is handled later in the same drain.
 */
export function recordEventMessage(player: Empire, e: QueuedEvent, options: MessageOptions): void {
    const type = eventHistoryMessageType(e.type as EventMessageType, e.additionalData);
    if (type === null || !options.ticker[MessageCategory.Exploration]) return;
    const m = new EmpireMessage(player, type, e.location);
    m.description = e.message;
    m.title = e.title;
    m.supressPopup = true;
    sendEmpireMessage(m, player);
}

// ---------------------------------------------------------------------------------------------------------------
// The message handler (Main.Part9.cs 1572 ReceiveMessageInternal, its game-state part)
// ---------------------------------------------------------------------------------------------------------------

/** What the handler decided for one message: what the UI shows (stub, card, sounds, conversation, ticker line). */
export interface PlayerMessageReceipt {
    message: EmpireMessage;
    /** Taken by the advisor queue (Main.Part9.cs 2226): nothing else happens to it. */
    advisor: boolean;
    /** null when `advisor`. */
    route: MessageRoute | null;
    /** The conversation: queued, opened at once (method_254), or none (also an immediate one SuppressAllPopups drops). */
    action: 'queue' | 'open' | 'none';
    /** bool_2: a ticker line (lstMessages.AddItem); the message was stamped and, unless Informational, recorded. */
    ticker: boolean;
}

/**
 * The game-state part of ReceiveMessageInternal for one message, in the original order: an AdvisorSuggestion joins the
 * advisor queue and is done (2226); the player's own EmpireDefeated ends the game (1994-2020, in the switch →
 * Galaxy_GameEnd); a conversation is stamped (2361); a ticker line stamps the message and records it in the history
 * (2404-2410 → method_251, which skips Informational). The C# also rewrites Description with the formatted line and
 * fills an empty Title (method_251); the port keeps the sim's gameText() encoding and the UI formats both when it
 * draws them.
 */
export function receivePlayerMessage(galaxy: Galaxy, player: Empire, m: EmpireMessage, options: MessageOptions): PlayerMessageReceipt {
    if (receiveAdvisorSuggestionMessage(player, m)) return { message: m, advisor: true, route: null, action: 'none', ticker: false };
    const route = routeEmpireMessage(m, player, options);
    const defeat = playerDefeatGameEnd(m, player, galaxy.empires);
    if (defeat !== null) onGameEnd(galaxy, defeat);
    const starDate = galaxyStarDate(galaxy);
    // Port-only: a popup message keeps the date it arrived for its stub (messageStubList.ts), when it has none.
    if (route.popup && m.starDate <= 0) m.starDate = starDate;
    const action = shouldQueueConversation(route, options);
    if (route.conversation !== null) m.starDate = starDate; // 2361 (conversationOption != null)
    const ticker = tickerShown(m, route);
    if (ticker) {
        m.starDate = starDate; // 2408
        if (m.messageType !== EmpireMessageType.Informational) addHistoryMessage(player, m); // method_251 (Empire.cs 4697)
    }
    return { message: m, advisor: false, route, action, ticker };
}

// ---------------------------------------------------------------------------------------------------------------
// The drain
// ---------------------------------------------------------------------------------------------------------------

/** What the UI hears about: a handled message (its receipt) or an event (for the event panel, which draws it). */
export type PlayerMessageNote = { receipt: PlayerMessageReceipt; event?: undefined } | { receipt?: undefined; event: QueuedEvent };
export type PlayerMessageListener = (note: PlayerMessageNote) => void;

const listeners = new WeakMap<Galaxy, PlayerMessageListener>();
const attached = new WeakMap<Galaxy, Empire>();

/**
 * Hear about every message and event the pipeline handles on `galaxy` (null: stop). The UI's hook (ui/messageStreams.ts
 * in-thread, simworker/simHost.ts in the worker). It runs inside the drain, so it must not change the game.
 */
export function setPlayerMessageListener(galaxy: Galaxy, listener: PlayerMessageListener | null): void {
    if (listener === null) listeners.delete(galaxy);
    else listeners.set(galaxy, listener);
}

/**
 * Attach the inbox to galaxy.playerEmpire (Main.Part12.cs:2881: Main becomes the player's recipient when the game view
 * starts — at the end of a new game's creation and on load; messages sent before are never received, they stay in
 * Empire.Messages for ProcessMessages). Idempotent; follows a change of player. Returns the player, or null.
 */
export function ensurePlayerInbox(galaxy: Galaxy): Empire | null {
    const player = galaxy.playerEmpire;
    const prev = attached.get(galaxy);
    if (prev === player && (player === null || player === undefined || playerInbox(player) !== undefined)) return player ?? null;
    if (prev !== undefined && prev !== player) attachPlayerInbox(prev, false);
    if (player === null || player === undefined) {
        attached.delete(galaxy);
        return null;
    }
    attachPlayerInbox(player);
    attached.set(galaxy, player);
    return player;
}

/**
 * Handle everything in the player's inbox, in arrival order, as the C# UI thread works through its BeginInvoke queue
 * (see the file header for where this runs). Returns how many items were handled.
 */
export function processPlayerMessages(galaxy: Galaxy): number {
    const player = ensurePlayerInbox(galaxy);
    if (player === null) return 0;
    const inbox = playerInbox(player)!;
    if (inbox.length === 0) return 0;
    const listener = listeners.get(galaxy);
    let i = 0;
    withSimWrites(() => {
        try {
            for (; i < inbox.length; i++) {
                const item = inbox[i];
                // The options are read per item: a handler may change nothing of them, but a drain is short anyway.
                const options = galaxyMessageOptions(galaxy);
                if (item.message !== undefined) {
                    if (item.message == null) continue;
                    const receipt = receivePlayerMessage(galaxy, player, item.message, options);
                    listener?.({ receipt });
                } else if (item.event !== undefined) {
                    recordEventMessage(player, item.event, options);
                    listener?.({ event: item.event });
                } else if (item.prompt !== undefined) {
                    // Main.Part9.cs 1053 PromptForAuthorizationInternal: DiplomaticMessageQueue.AddMessage + ExpireInvalidMessages.
                    addAdvisorSuggestion(player, item.prompt);
                }
            }
        } finally {
            inbox.splice(0, Math.min(i + 1, inbox.length));
        }
    });
    return i;
}

/**
 * The end of a sim frame: the inbox (processPlayerMessages), then DiplomaticMessageQueue.cs 864 method_3, the age expiry
 * of the advisor queue, which the C# runs on every DrawMessages of the queue (the UI's draw timer, between the sim's
 * frames): suggestions older than 250 × RealSecondsInGalacticYear leave the queue. Sim-driven here, at the frame's end.
 */
export function playerMessagesFrameEnd(galaxy: Galaxy): void {
    processPlayerMessages(galaxy);
    const player = galaxy.playerEmpire;
    if (player == null || !Array.isArray(player.advisorSuggestions) || player.advisorSuggestions.length === 0) return;
    withSimWrites(() => expireOldAdvisorSuggestions(player, galaxyStarDate(galaxy)));
}

/** Empire.7.cs 3836 PromptPlayerForAuthorization → Main.PromptForAuthorization (BeginInvoke): queue the suggestion. */
export function promptPlayerForAuthorization(empire: Empire, empireMessage: EmpireMessage): void {
    const inbox = playerInbox(empire);
    // No recipient attached (a galaxy no frame has run on, a hand-built test galaxy): handled at once, as before the queue.
    if (inbox === undefined) addAdvisorSuggestion(empire, empireMessage);
    else inbox.push({ prompt: empireMessage });
}
