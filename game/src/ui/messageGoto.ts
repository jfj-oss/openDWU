// "Go to" for a notification: the target the original's message-link click jumps to (Main.Part9.cs:912 method_249: the
// message Subject, a Sender-or-Empire subject falling back to the message Location) and the jump itself, through the
// same camera path the Construction Yards / Troops "Go to" buttons use (hud.ts selectStellarObject / selectShipGroup →
// select + zoom to the object).
// TODO(port): the non-location subjects method_249 also handles (Character, ResearchNode, Resource, Component, Empire
// screens) are not jump targets here.

import type { EmpireMessage } from '../sim/messages';
import type { Galaxy } from '../sim/galaxy';
import { BuiltObject } from '../sim/builtObject';
import { Habitat } from '../sim/types';
import { ShipGroup } from '../sim/fleets/shipGroup';
import { Empire } from '../sim/empire';
import { selectShipGroup, selectStellarObject } from './hud';
import { mapHighlightsOf } from '../render/mapHighlights';

export type GoToTarget =
    | { kind: 'stellar'; object: Habitat | BuiltObject }
    | { kind: 'fleet'; fleet: ShipGroup }
    | { kind: 'point'; x: number; y: number };

function isPointLike(v: unknown): v is { x: number; y: number } {
    return v !== null && typeof v === 'object' && typeof (v as { x?: unknown }).x === 'number' && typeof (v as { y?: unknown }).y === 'number';
}

/** The place a notification is about, or null when it has none (a treaty message, a sender-only message). */
export function messageGoToTarget(message: EmpireMessage): GoToTarget | null {
    let obj: unknown = message.subject;
    // Main.Part9.cs:742-753 method_242 (the hover ping): an Empire / relation-type subject (and a Money offer, which is about the seller) falls back to Location.
    if (message.money > 0 || typeof obj === 'number' || obj instanceof Empire) obj = message.location;
    if (obj instanceof BuiltObject) return obj.hasBeenDestroyed ? null : { kind: 'stellar', object: obj };
    if (obj instanceof ShipGroup) return { kind: 'fleet', fleet: obj };
    if (obj instanceof Habitat) return { kind: 'stellar', object: obj };
    if (isPointLike(obj) && (obj.x !== 0 || obj.y !== 0)) return { kind: 'point', x: obj.x, y: obj.y };
    return null;
}

/** Jump the main view to the target: select it and zoom (a bare point goes to the nearest system). Returns whether it did. */
export function goToTarget(target: GoToTarget, galaxy: Galaxy): boolean {
    switch (target.kind) {
        case 'stellar':
            selectStellarObject(target.object, true);
            return true;
        case 'fleet':
            selectShipGroup(target.fleet, true);
            return true;
        case 'point': {
            const near = galaxy.fastFindNearestSystem(target.x, target.y);
            if (near === null) return false;
            selectStellarObject(near, true);
            return true;
        }
    }
}

/** Go to whatever `message` is about. */
export function goToMessage(message: EmpireMessage, galaxy: Galaxy): boolean {
    const t = messageGoToTarget(message);
    return t === null ? false : goToTarget(t, galaxy);
}

/**
 * The object a message's hover pings (Main.Part9.cs 742 method_242 / 777 method_244): the Subject; a relation-type
 * subject (and a Money offer) is about the Sender; an Empire (the sender included) falls back to the Location point.
 */
export function messagePingObject(message: EmpireMessage): unknown {
    let obj: unknown = message.subject;
    if (typeof obj === 'number') obj = message.sender;
    if (message.money > 0) obj = message.sender;
    if (obj instanceof Empire) obj = message.location;
    return obj;
}

/** method_242: the message's object gets the yellow ping (MainView.EventLocations). */
export function pingMessage(galaxy: Galaxy, message: EmpireMessage): void {
    mapHighlightsOf(galaxy).addEventPing(messagePingObject(message));
}

/** method_244: the message's ping goes. */
export function unpingMessage(galaxy: Galaxy, message: EmpireMessage): void {
    mapHighlightsOf(galaxy).removeEventPings(messagePingObject(message));
}
