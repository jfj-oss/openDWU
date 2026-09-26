// The player's IEventMessageRecipient (Main.Part4.cs:481 ReceiveEventMessage → 487 method_523): the sim's
// Empire.SendEventMessageToEmpire (events.ts) calls it for story / exploration / disaster / wonder events.
//
// Like the C# (BeginInvoke) the events are handled after the sim call returns: queued here, drained on a timer.
// Each event is recorded as a suppressed-popup EmpireMessage of the method_523 type (so it reaches the ticker and the
// saved MessageHistory, which the Galactic History screen lists); the WonderBuilt event also pops up on the 16d card.
// TODO(port): the event panel for the other event types (method_508/509/510/511 pictures, method_515-520 music cues,
// Avoid/Investigate buttons) — Main.Part4.cs:487 method_523

import { EmpireMessage, EmpireMessageType, sendEmpireMessage } from '../sim/messages';
import { EventMessageType } from '../sim/eventTypes';
import type { Empire } from '../sim/empire';
import type { Galaxy } from '../sim/galaxy';
import { BuiltObject } from '../sim/builtObject';
import { Habitat } from '../sim/types';
import { PlanetaryFacility } from '../sim/construction/facilities';
import { galaxyStarDate } from '../sim/tick/simTime';
import { resolveStarDateDescription } from '../sim/galaxyTime';
import { MessageCategory, getMessageOptions } from './messageRouting';
import { showEventMessagePopup } from './messagePopups';

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

/** The WonderBuilt event picture: bitmap_8[facility.PictureRef] (Main.Part4.cs:1277), loaded from
 *  environment/planetaryfacilities/facility_<n>.png (Main.Part13.cs:1736 LoadPlanetaryFacilities). */
export function wonderImageUrl(facility: PlanetaryFacility): string {
    return `/assets/dwu/images/environment/planetaryfacilities/facility_${facility.def.pictureRef}.png`;
}

interface QueuedEvent {
    type: EventMessageType;
    title: string;
    message: string;
    additionalData: unknown;
    location: unknown;
}

export interface EventMessagesOptions {
    player: Empire;
    galaxy: Galaxy;
    /** btnEventMessageGoto: move the view to the event's location. */
    onGoTo: (target: Habitat | BuiltObject) => void;
}

interface Installed {
    player: Empire;
    timer: ReturnType<typeof setInterval>;
}

let installed: Installed | null = null;

/**
 * Register the player's event message recipient (Main.Part12.cs:2881 `PlayerEmpire.EventMessageRecipient = this`).
 * The field is made non-enumerable while set so the save codec (which walks own enumerable fields) never sees the
 * callback — the C# nulls it before saving (Main.Part12.cs:4080) for the same reason.
 */
export function installEventMessages(opts: EventMessagesOptions): void {
    removeEventMessages();
    const { player, galaxy, onGoTo } = opts;
    const queue: QueuedEvent[] = [];
    const recipient = {
        receiveEventMessage(type: number, title: string, message: string, additionalData: unknown, location: unknown): void {
            queue.push({ type, title, message, additionalData, location });
        },
    };
    Object.defineProperty(player, 'eventMessageRecipient', { value: recipient, enumerable: false, writable: true, configurable: true });

    // Port of Main.Part4.cs:487 method_523 (the recording half, and the WonderBuilt pop-up).
    function handle(e: QueuedEvent): void {
        const options = getMessageOptions();
        const popupsAllowed = !options.suppressAllPopups; // 489-493 flag
        const type = eventHistoryMessageType(e.type, e.additionalData);
        // 1311 / 1496: _Game.DisplayMessageExploration gates recording.
        if (type !== null && options.ticker[MessageCategory.Exploration]) {
            const m = new EmpireMessage(player, type, e.location);
            m.description = e.message;
            m.title = e.title;
            m.supressPopup = true;
            sendEmpireMessage(m, player);
        }
        if (e.type === EventMessageType.WonderBuilt && popupsAllowed) {
            // 1272-1282: picture from the facility; num = 3 → flag6 (DiscoveryActionRuin, default 0 → shown; the TS
            // empire has no DiscoveryActionRuin yet). TODO(port): method_515 wonder.mp3 music cue — Main.Part4.cs:273
            const facility = e.additionalData instanceof PlanetaryFacility ? e.additionalData : null;
            const target = e.location instanceof Habitat || e.location instanceof BuiltObject ? e.location : null;
            showEventMessagePopup({
                title: e.title,
                text: e.message,
                imageUrl: facility !== null ? wonderImageUrl(facility) : null,
                footer: resolveStarDateDescription(galaxyStarDate(galaxy)),
                onGoTo: target !== null ? () => onGoTo(target) : null,
            });
        }
    }

    const timer = setInterval(() => {
        while (queue.length > 0) handle(queue.shift()!);
    }, 250);
    installed = { player, timer };
}

/** Unregister the recipient (Main.Part12.cs:3195 `EventMessageRecipient = null`). No-op when not installed. */
export function removeEventMessages(): void {
    if (installed === null) return;
    clearInterval(installed.timer);
    Object.defineProperty(installed.player, 'eventMessageRecipient', { value: null, enumerable: true, writable: true, configurable: true });
    installed = null;
}
