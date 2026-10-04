// The main view's two "look here" lists the UI fills (per galaxy; a new game starts empty, as Main.Part12.cs 1110 /
// 3409 clear EventLocations):
//
// - SpecialHighlightBuiltObjects (MainView.cs 521; Main.Part9.cs 870 method_246): ships whose travel vectors the
//   method_250 per-ship pass draws red, 2 px (MainView.2.cs 5945-5948, overlayLayer.ts). Set on a selection change to
//   the player's ships travelling to the selected StellarObject (Main.Part10.cs 1328-1331, 1501), and when the hovered
//   row of a left-sidebar list changes (ItemListPanel.cs 2384-2389: the ships on a hovered pirate mission, else those
//   travelling to the selection).
// - EventLocations (MainView.cs 549; Main.Part9.cs 759 method_243 add / 795 method_245 remove): the yellow pings
//   (MainView.2.cs 3500 method_232) at a point, a ship or a habitat — the hovered row's location (ItemListPanel.cs
//   2291-2383). A ping stays where its object was when it was added (`new EventPing((int)Xpos, (int)Ypos, obj)`); here
//   the point is taken where the object is DRAWN, at the first frame that draws the ping (render interpolation), so a
//   moving ship's ping starts on its sprite.
//
// No DOM; no sim writes.

import { BuiltObject } from '../sim/builtObject';
import { Habitat } from '../sim/types';
import type { Empire } from '../sim/empire';
import type { ShipGroup } from '../sim/fleets/shipGroup';
import type { Creature } from '../sim/creature';
import type { Fighter } from '../sim/combat/fighters';
import { BuiltObjectMissionType, builtObjectMission } from '../sim/missions/mission';

/** A ping's object: a ship / base, a habitat, or a fixed point (System.Drawing.Point). */
export type EventPingObject = BuiltObject | Habitat | { readonly x: number; readonly y: number };

/** MainView EventLocations entry (DistantWorlds/EventPing.cs). `x` / `y` are null until first drawn (see the header). */
export interface EventPing {
    readonly obj: EventPingObject;
    x: number | null;
    y: number | null;
}

export class MapHighlights {
    /** MainView.SpecialHighlightBuiltObjects. */
    specialHighlight: ReadonlySet<BuiltObject> = new Set();
    /** MainView.EventLocations. */
    readonly eventLocations: EventPing[] = [];

    /** Main.Part9.cs 870 method_246(list): null → an empty list. */
    setSpecialHighlight(list: Iterable<BuiltObject> | null): void {
        this.specialHighlight = list === null ? new Set() : new Set(list);
    }

    /** Main.Part9.cs 759 method_243(obj): a ping for a ship / habitat / point; anything else (or null) adds none. */
    addEventPing(obj: unknown): void {
        if (obj === null || obj === undefined || typeof obj !== 'object') return;
        if (isShipOrHabitat(obj)) {
            this.eventLocations.push({ obj, x: null, y: null });
        } else if (isPoint(obj)) {
            // `new EventPing(point.X, point.Y, point)`.
            this.eventLocations.push({ obj, x: obj.x, y: obj.y });
        }
    }

    /**
     * Main.Part9.cs 795 method_245(obj): drop the pings of that ship / habitat (by identity), or of a point with the
     * same coordinates.
     */
    removeEventPings(obj: unknown): void {
        if (obj === null || obj === undefined || typeof obj !== 'object') return;
        const list = this.eventLocations;
        let keep: (p: EventPing) => boolean;
        if (isShipOrHabitat(obj)) keep = (p) => p.obj !== obj;
        else if (isPoint(obj)) keep = (p) => !(isPoint(p.obj) && p.obj.x === obj.x && p.obj.y === obj.y);
        else return;
        let w = 0;
        for (let i = 0; i < list.length; i++) if (keep(list[i])) list[w++] = list[i];
        list.length = w;
    }
}

function isShipOrHabitat(o: object): o is BuiltObject | Habitat {
    return o instanceof BuiltObject || o instanceof Habitat;
}
/** A System.Drawing.Point: a plain { x, y }. */
function isPoint(o: object): o is { x: number; y: number } {
    const p = o as { x?: unknown; y?: unknown };
    return typeof p.x === 'number' && typeof p.y === 'number' && !isShipOrHabitat(o);
}

// ---------------------------------------------------------------------------------------------------------------
// The selection's travellers (SpecialHighlightBuiltObjects on a selection change, and the list-hover fallback)
// ---------------------------------------------------------------------------------------------------------------

/** The HUD selection as the overlay / highlight code reads it (the C# _Game.SelectedObject). */
export type SelectedObjectLike = {
    builtObject?: BuiltObject;
    shipGroup?: ShipGroup;
    habitat?: Habitat;
    creature?: Creature;
    fighter?: Fighter;
    builtObjects?: BuiltObject[];
    systemInfo?: boolean;
} | null;

/**
 * The C# SelectedObject as a StellarObject (Main.Part10.cs 1328: SpecialHighlightBuiltObjects is only filled for one):
 * the selected ship / base or habitat. A fleet, a multi-selection, a system (SystemInfo) or nothing is none.
 */
export function selectedStellarObject(sel: SelectedObjectLike): BuiltObject | Habitat | Creature | Fighter | null {
    if (sel === null || sel.shipGroup !== undefined || sel.builtObjects !== undefined || sel.systemInfo === true) return null;
    // Creature and Fighter are StellarObjects too (Creature.cs / Fighter.cs 19): ships attacking / escorting one are
    // DetermineShipsMovingToDestination's (their mission Target is the creature / fighter).
    if (sel.creature !== undefined) return sel.creature;
    if (sel.fighter !== undefined) return sel.fighter;
    return sel.builtObject ?? sel.habitat ?? null;
}

/** Port of Empire.6.cs 1186 CheckShipTravellingToDestination. */
export function checkShipTravellingToDestination(bo: BuiltObject | null, destination: { hasBeenDestroyed: boolean } | null): boolean {
    if (bo === null || bo.hasBeenDestroyed || destination === null || destination.hasBeenDestroyed) return false;
    const m = builtObjectMission(bo.mission);
    if (m === null || m.type === BuiltObjectMissionType.Undefined) return false;
    if (m.target === destination) return m.type !== BuiltObjectMissionType.Transport;
    if (m.secondaryTarget === destination) return m.type === BuiltObjectMissionType.Transport;
    return false;
}

/** Port of Empire.6.cs 1165 DetermineShipsMovingToDestination: the empire's state then private ships heading there. */
export function shipsMovingToDestination(empire: Pick<Empire, 'builtObjects' | 'privateBuiltObjects'>, destination: { hasBeenDestroyed: boolean } | null): Set<BuiltObject> {
    const out = new Set<BuiltObject>();
    if (destination === null) return out;
    for (const bo of empire.builtObjects) if (checkShipTravellingToDestination(bo, destination)) out.add(bo);
    for (const bo of empire.privateBuiltObjects) if (checkShipTravellingToDestination(bo, destination)) out.add(bo);
    return out;
}

const byGalaxy = new WeakMap<object, MapHighlights>();

/** The galaxy's highlight lists (created empty on first use). */
export function mapHighlightsOf(galaxy: object): MapHighlights {
    let h = byGalaxy.get(galaxy);
    if (h === undefined) {
        h = new MapHighlights();
        byGalaxy.set(galaxy, h);
    }
    return h;
}

// ---------------------------------------------------------------------------------------------------------------
// The ping's animation: MainView.2.cs 3500 method_232
// ---------------------------------------------------------------------------------------------------------------

/** MainView.cs 1465 color_16 = (255, 255, 0); 1466 int_9 = 100 (the largest radius, px); method_232 double_11 = 1.6 s. */
export const EVENT_PING_COLOR = 0xffff00;
export const EVENT_PING_MAX_RADIUS_PX = 100;
export const EVENT_PING_PERIOD_S = 1.6;
/** XnaDrawingHelper.DrawCircle(spriteBatch, area, color, 3): 3 px, 30 sides. */
export const EVENT_PING_WIDTH_PX = 3;
export const EVENT_PING_SIDES = 30;
/** method_232: pings more than 40 px outside the view are skipped (and do not advance the phase). */
export const EVENT_PING_MARGIN_PX = 40;

/**
 * method_232's shared phase (MainView double_10, with dateTime_3 the last time method_250 ran): every drawn ping adds
 * the time since that last run, so N pings cycle N times as fast, as in the C#. Wall-clock seconds.
 */
export class EventPingClock {
    /** double_10. */
    phase = 0;
    /** dateTime_3 (DateTime.MinValue at start: the first ping's first frame wraps the phase to -1.6). */
    last = -Infinity;

    /** One drawn ping at wall time `now` (s): its radius (px, the C#'s signed `num5`) and alpha (0-255). */
    advance(now: number): { radius: number; alpha: number } {
        this.phase += now - this.last;
        const period = EVENT_PING_PERIOD_S;
        if (this.phase > period) {
            if (this.phase > period * 2.0) this.phase = 0.0;
            this.phase -= period;
        }
        const half = period * 0.5;
        const num4 = Math.min(1.0, Math.max(0.0, (this.phase - half) / half));
        const alpha = 255 - Math.trunc(num4 * 250.0);
        const radius = 1 + Math.trunc((this.phase / period) * EVENT_PING_MAX_RADIUS_PX);
        return { radius, alpha };
    }

    /** `dateTime_3 = now` after the loop (every method_250 run). */
    endFrame(now: number): void {
        this.last = now;
    }
}
