// The player's IEventMessageRecipient (Main.Part4.cs:481 ReceiveEventMessage → 487 method_523): the sim's
// Empire.SendEventMessageToEmpire (events.ts) calls it for story / exploration / disaster / wonder events.
//
// Like the C# (BeginInvoke) the events are handled after the sim call returns: queued here, drained on a timer.
// Each event is recorded as a suppressed-popup EmpireMessage of the method_523 type (so it reaches the ticker and the
// saved MessageHistory, which the Galactic History screen lists); ruins and the WonderBuilt event open the event panel
// (messagePopups.ts showEventMessagePopup, pnlEventMessage).
// TODO(port): the event panel for the other event types (method_508/509/511 pictures, method_515-520 music cues,
// Avoid/Investigate buttons) — Main.Part4.cs:487 method_523

import { EventMessageType } from '../sim/eventTypes';
import type { Empire } from '../sim/empire';
import type { Galaxy } from '../sim/galaxy';
import { BuiltObject } from '../sim/builtObject';
import { Habitat } from '../sim/types';
import { PlanetaryFacility } from '../sim/construction/facilities';
import { galaxyStarDate } from '../sim/tick/simTime';
import { resolveStarDateDescription } from '../sim/galaxyTime';
import { getMessageOptions } from './messageRouting';
import { showEventMessagePopup } from './messagePopups';
import { issuePlayerCommand } from '../sim/player/playerCommands';
import { resolveGameText } from '../sim/textResolver';
// [simworker] chunk 4: the recording half is messagePipeline.ts (the sim worker records the events itself and hands the
// main thread's recipient each one to show).
import { playerMessageStream, recordEventMessage, type QueuedEvent } from './messagePipeline';
export { eventHistoryMessageType } from './messagePipeline';

/** The WonderBuilt event picture: bitmap_8[facility.PictureRef] (Main.Part4.cs:1277), loaded from
 *  environment/planetaryfacilities/facility_<n>.png (Main.Part13.cs:1736 LoadPlanetaryFacilities). */
export function wonderImageUrl(facility: PlanetaryFacility): string {
    return `/assets/dwu/images/environment/planetaryfacilities/facility_${facility.def.pictureRef}.png`;
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
        // 1311 / 1496: _Game.DisplayMessageExploration gates recording. Worker mode: the worker recorded it.
        if (playerMessageStream(player) === undefined) recordEventMessage(player, e, options);
        if (e.type === EventMessageType.EncounterRuins && popupsAllowed && e.additionalData instanceof Habitat) {
            // Main.Part4.cs:531-554 → method_510 (64-84): the ruin's picture, Investigate Ruins / Leave the Ruins alone.
            // Investigate is btnEventMessageInvestigate_Click 1831-1835 (Galaxy.InvestigateRuins), issued as a player command.
            const habitat = e.additionalData;
            const ruin = habitat.ruin;
            showEventMessagePopup({
                title: e.title,
                text: e.message,
                imageUrl: ruin !== null ? `/assets/dwu/images/environment/ruins/ruin_${ruin.pictureRef}.png` : null,
                footer: resolveStarDateDescription(galaxyStarDate(galaxy)),
                actions: [
                    { label: resolveGameText('Investigate Ruins'), onClick: () => issuePlayerCommand(galaxy, player, 'investigateRuins', [habitat]) },
                    { label: resolveGameText('Leave the Ruins alone'), onClick: () => {} },
                ],
            });
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
