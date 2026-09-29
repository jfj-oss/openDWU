// Shield / hull bars under a ship's role marker while it fights (render only, reads sim state, never writes it).
//
// The original (MainView*.cs / Main.Part*.cs) draws no such bars: a damaged ship only gets the cross-hatch damage overlay
// on its sprite (Main.Part12.cs method_106, DamagedComponentCount / Components.Count) and a shield flash on a strike.
// So this is the user's rule alone: two thin bars centred under the marker, at system zoom, while the ship is in combat
// and for a few seconds after, fading out.

import type { BuiltObject } from '../sim/builtObject';
import { MIN_TIME } from '../sim/tick/simTime';

/** Seconds the bars stay fully visible after the last combat activity, then the seconds they take to fade out. */
export const COMBAT_HOLD_S = 5;
export const COMBAT_FADE_S = 3;

export const BAR_HEIGHT_PX = 2;
export const BAR_GAP_PX = 1;
export const BAR_MIN_WIDTH_PX = 14;
export const BAR_MAX_WIDTH_PX = 40;
export const SHIELD_BAR_COLOR = 0x3fa9ff;
export const BAR_BACK_COLOR = 0x000000;
export const BAR_BACK_ALPHA = 0.55;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The sim state the bars read. */
export type BarShip = Pick<BuiltObject, 'currentShields' | 'shieldsCapacity' | 'components' | 'damagedComponentCount' | 'weapons' | 'lastShieldStrike' | 'attackers'>;

/** Shield charge 0..1, or null for a ship with no shields. */
export function shieldFraction(bo: Pick<BuiltObject, 'currentShields' | 'shieldsCapacity'>): number | null {
    if (!(bo.shieldsCapacity > 0)) return null;
    return clamp01(bo.currentShields / bo.shieldsCapacity);
}

/** Hull integrity 0..1: the share of components not damaged (Main.Part12.cs method_106 uses the same damaged / total). */
export function hullFraction(bo: Pick<BuiltObject, 'components' | 'damagedComponentCount'>): number {
    const n = bo.components.items.length;
    if (n <= 0) return 1;
    return clamp01(1 - bo.damagedComponentCount / n);
}

/** Green (1) -> yellow (0.5) -> red (0), as 0xRRGGBB. */
export function hullColor(frac: number): number {
    const t = clamp01(frac);
    const r = t >= 0.5 ? Math.round(255 * (1 - t) * 2) : 255;
    const g = t >= 0.5 ? 255 : Math.round(255 * t * 2);
    return (r << 16) | (g << 8) | 0x30;
}

/** True when another live object is attacking this ship (BuiltObject.Attackers, refreshed by the sim's threat pass). */
function underAttack(bo: Pick<BuiltObject, 'attackers'>): boolean {
    const a = bo.attackers;
    if (a === null) return false;
    for (const x of a) if (x !== null && !(x as { hasBeenDestroyed?: boolean }).hasBeenDestroyed) return true;
    return false;
}

/**
 * Game ms of the ship's last combat activity: nowMs while it is under attack, else the later of its last shield strike
 * and its weapons' last shot (MIN_TIME when neither ever happened).
 */
export function lastCombatMs(bo: Pick<BuiltObject, 'weapons' | 'lastShieldStrike' | 'attackers'>, nowMs: number): number {
    if (underAttack(bo)) return nowMs;
    let last = bo.lastShieldStrike;
    for (const w of bo.weapons) if (w.lastFired > last) last = w.lastFired;
    return last;
}

/** Bar opacity 0..1: full for COMBAT_HOLD_S after the last activity, then a linear fade over COMBAT_FADE_S. */
export function combatBarAlpha(bo: Pick<BuiltObject, 'weapons' | 'lastShieldStrike' | 'attackers'>, nowMs: number): number {
    const last = lastCombatMs(bo, nowMs);
    if (last <= MIN_TIME) return 0;
    const age = (nowMs - last) / 1000;
    if (age <= COMBAT_HOLD_S) return 1;
    return clamp01(1 - (age - COMBAT_HOLD_S) / COMBAT_FADE_S);
}

/** Bar width in screen px for a marker of the given drawn height. */
export function barWidthPx(markerPx: number): number {
    return Math.min(BAR_MAX_WIDTH_PX, Math.max(BAR_MIN_WIDTH_PX, Math.round(markerPx * 1.2)));
}

/** One bar's rectangle in screen px relative to the marker centre, y down. */
export interface BarRect { x: number; y: number; w: number; h: number; color: number; frac: number }

/**
 * The bars for a marker of height markerPx: shields on top (if the ship has shields), hull below, both centred and
 * starting 2 px under the marker.
 */
export function barRects(bo: BarShip, markerPx: number): BarRect[] {
    const w = barWidthPx(markerPx);
    let y = markerPx / 2 + 2;
    const out: BarRect[] = [];
    const s = shieldFraction(bo);
    if (s !== null) {
        out.push({ x: -w / 2, y, w, h: BAR_HEIGHT_PX, color: SHIELD_BAR_COLOR, frac: s });
        y += BAR_HEIGHT_PX + BAR_GAP_PX;
    }
    const h = hullFraction(bo);
    out.push({ x: -w / 2, y, w, h: BAR_HEIGHT_PX, color: hullColor(h), frac: h });
    return out;
}

/** The minimal Graphics surface used (pixi Graphics fits). */
export interface RectSink {
    rect(x: number, y: number, w: number, h: number): unknown;
    fill(style: { color: number; alpha: number }): unknown;
}

/**
 * Draws a ship's bars at world (x, y) into g at zoom z (px per world unit). Backs first and fills after, batched into
 * two fills per ship so one Graphics carries the whole frame.
 */
export function drawCombatBars(g: RectSink, bo: BarShip, x: number, y: number, markerPx: number, z: number, alpha: number): void {
    if (alpha <= 0) return;
    const rects = barRects(bo, markerPx);
    for (const r of rects) g.rect(x + (r.x - 0.5) / z, y + (r.y - 0.5) / z, (r.w + 1) / z, (r.h + 1) / z);
    g.fill({ color: BAR_BACK_COLOR, alpha: BAR_BACK_ALPHA * alpha });
    for (const r of rects) {
        if (r.frac <= 0) continue;
        g.rect(x + r.x / z, y + r.y / z, (r.w * r.frac) / z, r.h / z);
        g.fill({ color: r.color, alpha });
    }
}

