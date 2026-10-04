// Crossed-swords "fighting here" marker on a system in the galaxy view (render only, read-only sim queries).
//
// The original's galaxy-view draw code (the engine DLL; not in the decompiled DistantWorlds/*.cs) has no readable
// rule or art for it: Main.Part*.cs only has the underAttack.png message icon (BaconMain.LoadUiMessages bitmap_28[0]) and
// BuiltObject.InBattle. So this is the user's rule: a system shows the icon while one of the player's own ships/bases is
// in combat (combatActivityAlpha below: under attack, firing or shield-struck, held 5 s then faded over 3 s) or one of
// the player's colonies has attackers. The player's own assets are always known to them, so fog does not apply.

import type { Graphics } from 'pixi.js';
import type { Empire } from '../sim/empire';
import type { BuiltObject } from '../sim/builtObject';
import type { Habitat } from '../sim/types';
import { MIN_TIME } from '../sim/tick/simTime';

/** Seconds the marker stays fully visible after the last combat activity, then the seconds it takes to fade out. */
export const COMBAT_HOLD_S = 5;
export const COMBAT_FADE_S = 3;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

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

/** Marker opacity 0..1: full for COMBAT_HOLD_S after the last activity, then a linear fade over COMBAT_FADE_S. */
export function combatActivityAlpha(bo: Pick<BuiltObject, 'weapons' | 'lastShieldStrike' | 'attackers'>, nowMs: number): number {
    const last = lastCombatMs(bo, nowMs);
    if (last <= MIN_TIME) return 0;
    const age = (nowMs - last) / 1000;
    if (age <= COMBAT_HOLD_S) return 1;
    return clamp01(1 - (age - COMBAT_HOLD_S) / COMBAT_FADE_S);
}

type FightShip = Pick<BuiltObject, 'empire' | 'hasBeenDestroyed' | 'weapons' | 'lastShieldStrike' | 'attackers'> & {
    nearestSystemStar: { systemIndex: number } | null;
};
type FightHabitat = Pick<Habitat, 'owner' | 'attackers' | 'systemIndex'>;

/** systemIndex -> 0..1 opacity for every system where the player is fighting or being attacked. */
export function systemsUnderFire(
    player: Empire | null,
    ships: Iterable<FightShip | null>,
    habitats: Iterable<FightHabitat>,
    nowMs: number,
): Map<number, number> {
    const out = new Map<number, number>();
    if (player === null) return out;
    const put = (i: number, a: number): void => {
        if (a > (out.get(i) ?? 0)) out.set(i, a);
    };
    for (const bo of ships) {
        if (bo === null || bo.hasBeenDestroyed || bo.empire !== player || bo.nearestSystemStar === null) continue;
        const a = combatActivityAlpha(bo, nowMs);
        if (a > 0) put(bo.nearestSystemStar.systemIndex, a);
    }
    for (const h of habitats) {
        if (h.owner !== player || h.attackers === null) continue;
        if (h.attackers.some((x) => x !== null && !(x as { hasBeenDestroyed?: boolean }).hasBeenDestroyed)) put(h.systemIndex, 1);
    }
    return out;
}

/** Two crossed swords centred on (cx, cy), `px` screen pixels wide, in world units (scale = 1/z). */
export function drawCrossedSwords(g: Graphics, cx: number, cy: number, px: number, z: number, alpha: number): void {
    const h = px / 2 / z;
    const w = Math.max(1.6, px / 7) / z;
    for (const s of [1, -1]) {
        const x0 = cx - s * h, y0 = cy - h, x1 = cx + s * h, y1 = cy + h;
        g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: w + 1.6 / z, color: 0x300000, alpha });
        g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: w, color: 0xff3030, alpha });
        const gx = cx + s * h * 0.45, gy = cy + h * 0.45, gl = h * 0.45;
        g.moveTo(gx - gl, gy).lineTo(gx + gl, gy).stroke({ width: w * 0.9, color: 0xffd0d0, alpha });
    }
}
