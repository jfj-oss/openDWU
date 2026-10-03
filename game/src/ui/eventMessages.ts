// The player's IEventMessageRecipient (Main.Part4.cs:481 ReceiveEventMessage → 487 method_523): the sim's
// Empire.SendEventMessageToEmpire (events.ts) calls it for story / exploration / disaster / wonder events, and for the
// pre-warp progress milestones (Empire.7.cs CheckSendPreWarpProgressEventMessage: first ship / spaceport / mining and
// research station / military ship, hyperspace and colonization tech, first hyperjump, first contact, first Kaltor,
// first pirate raid — all GeneralDiscovery events).
//
// Like the C# (BeginInvoke) the events are handled after the sim call returns: queued here, drained on a timer.
// Each event is recorded as a suppressed-popup EmpireMessage of the method_523 type (so it reaches the ticker and the
// saved MessageHistory, which the Galactic History screen lists), then shown as method_523 does
// (eventMessagePresentation.ts): the event panel (pnlEventMessage) with its picture and Close / Go to Event Location
// (method_508), the two choice buttons of the encounters and decision events (method_509-511), or the full-view story
// panel (pnlStoryEvent, method_570 / 571). The audio stings are gameAudio.ts's (it chains on this recipient).

import { EventMessageType } from '../sim/eventTypes';
import type { Empire } from '../sim/empire';
import type { Galaxy } from '../sim/galaxy';
import { BuiltObject } from '../sim/builtObject';
import { Habitat } from '../sim/types';
import type { Creature } from '../sim/creature';
import { PlanetaryFacility } from '../sim/construction/facilities';
import { galaxyStarDate } from '../sim/tick/simTime';
import { resolveStarDateDescription } from '../sim/galaxyTime';
import { getMessageOptions } from './messageRouting';
import { showEventMessagePopup, showStoryEventPopup, type EventPopup, type StoryEventPopup } from './messagePopups';
import { issuePlayerCommand } from '../sim/player/playerCommands';
import { resolveGameText } from '../sim/textResolver';
import { EVENT_CHROME, eventGoToTarget, eventMessagePresentation, eventPopupShown, type EventChoice, type EventGoToTarget } from './eventMessagePresentation';
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
    /** btnEventMessageGoto: move the view to the event's location (a ship / base / planet, a creature, or a point). */
    onGoTo: (target: Habitat | BuiltObject) => void;
    /** btnEventMessageGoto for a creature location (method_157(Creature)); default: nothing. */
    onGoToCreature?: (creature: Creature) => void;
    /** btnEventMessageGoto for a point location (method_156(x, y)); default: the nearest system. */
    onGoToPoint?: (x: number, y: number) => void;
}

interface Installed {
    player: Empire;
    timer: ReturnType<typeof setInterval>;
}

let installed: Installed | null = null;

/** The Investigate button's player command (btnEventMessageInvestigate_Click, Main.Part4.cs:1777-1842). */
function issueChoice(galaxy: Galaxy, player: Empire, choice: EventChoice): void {
    switch (choice.kind) {
        case 'investigateRuins':
            issuePlayerCommand(galaxy, player, 'investigateRuins', [choice.habitat]);
            break;
        case 'investigateBuiltObject':
            issuePlayerCommand(galaxy, player, 'investigateEncounteredBuiltObject', [choice.builtObject]);
            break;
        case 'warnTargetOfPirateAttackFunding':
            issuePlayerCommand(galaxy, player, 'warnTargetOfPirateAttackFunding', [choice.requestingEmpire, choice.targetEmpire]);
            break;
        case 'exposePlanetDestroyer': {
            // The same object in-thread / on a synced replica; a by-value copy matches its galaxy entry by name, type and project.
            const l = choice.location;
            let index = galaxy.galaxyLocations.indexOf(l);
            if (index < 0) index = galaxy.galaxyLocations.findIndex((g) => g.type === l.type && g.name === l.name && g.relatedBuiltObject === l.relatedBuiltObject);
            if (index >= 0) issuePlayerCommand(galaxy, player, 'exposeUncoveredPlanetDestroyer', [choice.builder, index]);
            break;
        }
        case 'none':
            break;
    }
}

/** Where presentEventMessage opens its panels (the DOM ones by default; tests record them). */
export interface EventPanelSink {
    showEvent(p: EventPopup): void;
    showStory(p: StoryEventPopup, galaxy: Galaxy): void;
}

const DOM_PANELS: EventPanelSink = {
    showEvent: (p) => void showEventMessagePopup(p),
    showStory: (p, galaxy) => showStoryEventPopup(p, galaxy),
};

/**
 * Port of Main.Part4.cs:487 method_523's presentation half for one event (the recording half is recordEventMessage).
 * Returns what it opened ('event' / 'choice' / 'story', or null when nothing is shown).
 */
export function presentEventMessage(e: QueuedEvent, opts: EventMessagesOptions, panels: EventPanelSink = DOM_PANELS): 'event' | 'choice' | 'story' | null {
    const { player, galaxy } = opts;
    const options = getMessageOptions();
    const p = eventMessagePresentation(e.type, e.additionalData, e.location, player, galaxy);
    if (!eventPopupShown(p, e.additionalData, player, options.suppressAllPopups)) return null;
    const footer = resolveStarDateDescription(galaxyStarDate(galaxy));
    if (p.panel === 'story' || p.panel === 'storyHistory') {
        // method_570 (the EventAction's picture) / method_571 (storyEvent.jpg).
        panels.showStory({ title: e.title, text: e.message, picture: p.panel === 'story' ? p.picture : { kind: 'url', url: EVENT_CHROME.storyEvent } }, galaxy);
        return 'story';
    }
    if (p.panel === 'choice') {
        const choice = p.choice ?? { kind: 'none' };
        const popup: EventPopup = {
            title: e.title,
            text: e.message,
            imageUrl: null,
            picture: p.picture,
            footer,
            forcePause: true, // method_509-511 → method_154
            // method_509 (the three decision events) lays out with int_64 = 30; method_510 / 511 with 0.
            extraButtonH: e.type === EventMessageType.EncounterRuins || e.type === EventMessageType.EncounterBuiltObject ? 0 : 30,
            actions: [
                { label: resolveGameText(p.investigateText ?? ''), onClick: () => issueChoice(galaxy, player, choice) },
                { label: resolveGameText(p.avoidText ?? ''), onClick: () => {} }, // btnEventMessageAvoid_Click: no sim change
            ],
        };
        panels.showEvent(popup);
        return 'choice';
    }
    // method_508: Close, plus Go to Event Location when the location is a ship / base / planet / creature / character / point.
    const target = eventGoToTarget(e.location);
    panels.showEvent({
        title: e.title,
        text: e.message,
        imageUrl: null,
        picture: p.picture,
        footer,
        forcePause: true, // method_508 → method_154
        onGoTo: target !== null ? () => goTo(target, opts) : null,
    });
    return 'event';
}

function goTo(target: EventGoToTarget, opts: EventMessagesOptions): void {
    switch (target.kind) {
        case 'stellar':
            opts.onGoTo(target.object);
            break;
        case 'creature':
            opts.onGoToCreature?.(target.creature);
            break;
        case 'point': {
            if (opts.onGoToPoint !== undefined) {
                opts.onGoToPoint(target.x, target.y);
                break;
            }
            const near = opts.galaxy.fastFindNearestSystem(target.x, target.y);
            if (near !== null) opts.onGoTo(near);
            break;
        }
    }
}

/**
 * Register the player's event message recipient (Main.Part12.cs:2881 `PlayerEmpire.EventMessageRecipient = this`).
 * The field is made non-enumerable while set so the save codec (which walks own enumerable fields) never sees the
 * callback — the C# nulls it before saving (Main.Part12.cs:4080) for the same reason.
 */
export function installEventMessages(opts: EventMessagesOptions): void {
    removeEventMessages();
    const { player } = opts;
    const queue: QueuedEvent[] = [];
    const recipient = {
        receiveEventMessage(type: number, title: string, message: string, additionalData: unknown, location: unknown): void {
            queue.push({ type, title, message, additionalData, location });
        },
    };
    Object.defineProperty(player, 'eventMessageRecipient', { value: recipient, enumerable: false, writable: true, configurable: true });

    // Port of Main.Part4.cs:487 method_523.
    function handle(e: QueuedEvent): void {
        // 1311 / 1496: _Game.DisplayMessageExploration gates recording. Worker mode: the worker recorded it.
        if (playerMessageStream(player) === undefined) recordEventMessage(player, e, getMessageOptions());
        presentEventMessage(e, opts);
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
