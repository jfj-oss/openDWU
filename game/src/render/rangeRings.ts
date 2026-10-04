// Hyperjump range rings for the selected ship / fleet: a bold dashed yellow ring at 45% of the current fuel's range
// (go there and come back) and a faint one at 100% (the maximum range). Read-only; no sim changes.
//
// [dw2overlays] The Fuel Range overlay (Improvements, render/fuelOverlay.ts) builds on these radii: the refuelling
// points the player knows (Empire.RefuellingLocations / RefuellingLocationsMilitaryOnly, Empire.6.cs 3845
// UpdateEmpireRefuellingLocations — already limited to the player's explored systems and visible, dockable depots, its
// own and other non-hostile empires'), classed by reach against these rings and by whether the selected ship may and can
// refuel there (Galaxy.6.cs CheckEmpireCanRefuelAtEmpire / CheckFuelSuppliedAtLocation / CheckSufficientFuelAvailable),
// and the point the sim itself would send it to (Empire.6.cs UltraFastFindNearestRefuellingLocation, as
// BuiltObject.1.cs CalculateRefuellingPortion calls it). All read inside withPureSimReads (UI-only, no lazy writes).
import { Graphics } from 'pixi.js';
import type { BuiltObject } from '../sim/builtObject';
import type { Empire } from '../sim/empire';
import type { Galaxy } from '../sim/galaxy';
import type { Habitat } from '../sim/types';
import { BuiltObjectRole } from '../sim/data/designSpecifications';
import { withPureSimReads } from '../sim/readOnlyQuery';
import {
    checkEmpireCanRefuelAtEmpire,
    checkFuelSuppliedAtLocation,
    checkSufficientFuelAvailable,
    currentRange,
    ultraFastFindNearestRefuellingLocation,
    type FuelTypeRef,
} from '../sim/movement';

const FUEL_ROUND_TRIP_FRACTION = 0.45;
const COLOR = 0xffd54a;

export interface RangeRadii {
    /** Distance reachable burning 45% of the current fuel. */
    range45: number;
    /** Distance reachable burning all the current fuel. */
    range100: number;
}

/**
 * Range on current fuel, from the sim's own fuel model (movement.ts currentRange = currentFuel / ((warpBurn +
 * staticEnergy) * fuelPerEnergy) * warpSpeed; linear in fuel, so the 45% ring is 0.45 of it). Null for ships with no
 * hyperdrive (warpSpeed <= 0), bases, destroyed ships or ships with no usable fuel burn.
 */
export function shipRangeRadii(bo: BuiltObject): RangeRadii | null {
    if (bo.hasBeenDestroyed || bo.warpSpeed <= 0 || bo.fuelCapacity <= 0) return null;
    const r = currentRange(bo, 0);
    if (!Number.isFinite(r) || r <= 0) return null;
    return { range45: r * FUEL_ROUND_TRIP_FRACTION, range100: r };
}

/** A fleet is limited by its worst ship: the minimum radii over the ships that have a range (null when none, or any
 * ship has none / no fuel left). */
export function fleetRangeRadii(ships: readonly BuiltObject[]): RangeRadii | null {
    let out: RangeRadii | null = null;
    for (const s of ships) {
        if (s.hasBeenDestroyed) continue;
        const r = shipRangeRadii(s);
        if (r === null) {
            if (s.warpSpeed > 0 && s.fuelCapacity > 0) return null; // a hyperdrive ship that is out of fuel
            continue;
        }
        out = out === null ? r : { range45: Math.min(out.range45, r.range45), range100: Math.min(out.range100, r.range100) };
    }
    return out;
}

function dashedCircle(g: Graphics, cx: number, cy: number, r: number, w: number, h: number): void {
    const dash = 9;
    const gap = 7;
    const step = (dash + gap) / r;
    let a0 = 0;
    let span = Math.PI * 2;
    if (span / step > 1500) {
        // Huge on screen: only the part facing the viewport centre can be visible.
        const diag = Math.hypot(w, h);
        span = Math.min(Math.PI * 2, (diag / r) * 1.5 + 0.02);
        a0 = Math.atan2(h / 2 - cy, w / 2 - cx) - span / 2;
    }
    const n = Math.ceil(span / step);
    for (let i = 0; i < n; i++) {
        const a = a0 + i * step;
        g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        g.arc(cx, cy, r, a, a + (dash / r));
    }
}

/** Draws both rings (screen space, constant line width) centred on (sx, sy); radii in screen px. */
export function drawRangeRings(g: Graphics, sx: number, sy: number, rPx: RangeRadii, w: number, h: number): void {
    g.clear();
    const dist = Math.hypot(Math.max(0, sx, w - sx) , Math.max(0, sy, h - sy));
    const ok = (r: number) => r >= 2 && r < dist * 4 + 1e6;
    if (ok(rPx.range100)) {
        dashedCircle(g, sx, sy, rPx.range100, w, h);
        g.stroke({ width: 1, color: COLOR, alpha: 0.35 });
    }
    if (ok(rPx.range45)) {
        dashedCircle(g, sx, sy, rPx.range45, w, h);
        g.stroke({ width: 2.5, color: COLOR, alpha: 0.8 });
    }
}

// [dw2overlays] begin — Fuel Range overlay data.

/** Where a refuelling point lies against the selected ship's rings. */
export enum RefuelReach {
    /** Inside the 45% ring: there and back on the current fuel. */
    RoundTrip = 0,
    /** Inside the 100% ring. */
    OneWay = 1,
    Beyond = 2,
}

export function refuelReach(distance: number, radii: RangeRadii | null): RefuelReach {
    if (radii === null) return RefuelReach.Beyond;
    if (distance <= radii.range45) return RefuelReach.RoundTrip;
    if (distance <= radii.range100) return RefuelReach.OneWay;
    return RefuelReach.Beyond;
}

export interface RefuelPoint {
    target: Habitat | BuiltObject;
    /** The player's own (else another empire's / an independent one). */
    own: boolean;
    /** From RefuellingLocationsMilitaryOnly (resupply ships, deep-space depots). */
    militaryOnly: boolean;
    /** The selected ship may refuel here and the point stocks its fuel (true with nothing selected). */
    usable: boolean;
    /** Why not: no military refuelling agreement with the owner (CheckEmpireCanRefuelAtEmpire), or no stock of the
     *  ship's fuel (CheckFuelSuppliedAtLocation / CheckSufficientFuelAvailable). Null when usable. */
    blocked: 'treaty' | 'fuel' | null;
    /** Null with nothing selected. */
    reach: RefuelReach | null;
}

export interface FuelOverlayData {
    /** The ship whose fuel limits the selection (fuelReferenceShip), or null. */
    ship: BuiltObject | null;
    radii: RangeRadii | null;
    points: RefuelPoint[];
    /** Where the sim would send `ship` to refuel (null: nowhere, or nothing selected). */
    nearest: Habitat | BuiltObject | null;
}

/** The selection's limiting ship: the one with the shortest range on its current fuel among the ships with a
 * hyperdrive and a fuel tank (as fleetRangeRadii takes the minimum); null when none has one. */
export function fuelReferenceShip(ships: readonly BuiltObject[]): BuiltObject | null {
    let best: BuiltObject | null = null;
    let bestR = Infinity;
    for (const s of ships) {
        if (s.hasBeenDestroyed || s.warpSpeed <= 0 || s.fuelCapacity <= 0) continue;
        const r = currentRange(s, 0);
        const v = Number.isFinite(r) ? r : 0;
        if (best === null || v < bestR) {
            best = s;
            bestR = v;
        }
    }
    return best;
}

/** The player's own ships in a HUD selection (a fleet, a box selection or one ship) and the one the rings centre on (the
 * fleet's lead ship, else the first). Another empire's ships: none (the player does not know their fuel). */
export function playerShipsOfSelection(
    sel: { builtObject?: BuiltObject; shipGroup?: { empire: unknown; ships: BuiltObject[]; leadShip: BuiltObject | null }; builtObjects?: BuiltObject[] } | null,
    player: Empire | null,
): { ships: BuiltObject[]; lead: BuiltObject | null } {
    if (sel === null || player === null) return { ships: [], lead: null };
    let ships: BuiltObject[] = [];
    let lead: BuiltObject | null = null;
    if (sel.shipGroup !== undefined) {
        if (sel.shipGroup.empire === player) {
            ships = sel.shipGroup.ships.filter((s) => !s.hasBeenDestroyed);
            lead = sel.shipGroup.leadShip !== null && !sel.shipGroup.leadShip.hasBeenDestroyed ? sel.shipGroup.leadShip : (ships[0] ?? null);
        }
    } else if (sel.builtObjects !== undefined) {
        ships = sel.builtObjects.filter((s) => !s.hasBeenDestroyed && s.empire === player);
        lead = ships[0] ?? null;
    } else if (sel.builtObject !== undefined && !sel.builtObject.hasBeenDestroyed && sel.builtObject.empire === player) {
        ships = [sel.builtObject];
        lead = sel.builtObject;
    }
    return { ships, lead };
}

/** BuiltObject.1.cs 2409: the fuel the ship takes on (its FuelType, SortTag = the room left in the tank). */
export function shipFuelTypes(ship: BuiltObject): FuelTypeRef[] {
    return ship.fuelType !== null ? [{ resourceId: ship.fuelType.resourceId, sortTag: ship.fuelCapacity - ship.currentFuel }] : [];
}

function isBuiltObjectPoint(o: Habitat | BuiltObject): o is BuiltObject {
    return 'builtObjectID' in o;
}

/**
 * The Fuel Range overlay's points for `player` and the selection `ships` (the player's own; empty = none selected).
 * `from` is where the rings are centred (the lead ship's position).
 */
export function fuelOverlayData(galaxy: Galaxy, player: Empire, ships: readonly BuiltObject[], from: { x: number; y: number } | null): FuelOverlayData {
    return withPureSimReads(() => {
        const ship = ships.length > 0 ? fuelReferenceShip(ships) : null;
        const radii = ships.length > 0 ? fleetRangeRadii(ships) : null;
        const fuelTypes = ship !== null ? shipFuelTypes(ship) : [];
        const military = ship === null || ship.role === BuiltObjectRole.Military;
        const seen = new Set<Habitat | BuiltObject>();
        const points: RefuelPoint[] = [];
        const add = (o: Habitat | BuiltObject | null | undefined, militaryOnly: boolean): void => {
            if (o == null || seen.has(o)) return;
            if (isBuiltObjectPoint(o) && o.hasBeenDestroyed) return;
            seen.add(o);
            const owner = o.empire as Empire | null;
            let blocked: RefuelPoint['blocked'] = null;
            let reach: RefuelReach | null = null;
            if (ship !== null) {
                if (!checkEmpireCanRefuelAtEmpire(galaxy, ship, player, owner)) blocked = 'treaty';
                else if (fuelTypes.length > 0) {
                    const ok = isBuiltObjectPoint(o) ? checkFuelSuppliedAtLocation(galaxy, fuelTypes, o, player, false) : checkSufficientFuelAvailable(galaxy, player, fuelTypes, o, o.empire);
                    if (!ok) blocked = 'fuel';
                }
                if (from !== null) reach = refuelReach(Math.hypot(o.xpos - from.x, o.ypos - from.y), radii);
            }
            points.push({ target: o, own: owner === player, militaryOnly, usable: blocked === null, blocked, reach });
        };
        for (const o of player.refuellingLocations) add(o, false);
        if (military) for (const o of player.refuellingLocationsMilitaryOnly) add(o, true);
        let nearest: Habitat | BuiltObject | null = null;
        if (ship !== null && from !== null) {
            nearest = ultraFastFindNearestRefuellingLocation(galaxy, player, from.x, from.y, fuelTypes, ship, false, ship.role === BuiltObjectRole.Military) as Habitat | BuiltObject | null;
        }
        return { ship, radii, points, nearest };
    });
}
// [dw2overlays] end
