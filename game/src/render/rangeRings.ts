// Hyperjump range rings for the selected ship / fleet: a bold dashed yellow ring at 45% of the current fuel's range
// (go there and come back) and a faint one at 100% (the maximum range). Read-only; no sim changes.
import { Graphics } from 'pixi.js';
import type { BuiltObject } from '../sim/builtObject';
import { currentRange } from '../sim/movement';

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
