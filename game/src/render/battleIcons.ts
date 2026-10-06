// Crossed-swords "fighting here" marker on a system in the galaxy view (render only, read-only sim queries).
//
// The original's galaxy-view draw code (the engine DLL; not in the decompiled DistantWorlds/*.cs) has no readable
// rule or art for it: Main.Part*.cs only has the underAttack.png message icon (BaconMain.LoadUiMessages bitmap_28[0]) and
// BuiltObject.InBattle. So this is the user's rule: a system shows the icon while one of the player's own ships/bases is
// in combat (combatActivityAlpha below: under attack, firing or shield-struck, held 5 s then faded over 3 s) or one of
// the player's colonies has attackers. "Under attack" / "has attackers" count only attackers that are alive, hostile and
// still within weapons reach (liveAttacker): the sim's Attackers lists keep a raider that left, as the C# does.
// The player's own assets are always known to them, so fog does not apply.

import type { Graphics } from 'pixi.js';
import type { Empire } from '../sim/empire';
import type { BuiltObject } from '../sim/builtObject';
import type { Habitat } from '../sim/types';
import { MIN_TIME } from '../sim/tick/simTime';

/** Seconds the marker stays fully visible after the last combat activity, then the seconds it takes to fade out. */
export const COMBAT_HOLD_S = 5;
export const COMBAT_FADE_S = 3;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Screen-side reach for an attacker to count as "attacking now": the farther of either side's longest weapon (with
 * slack for ships manoeuvring at the edge of range), never less than ENGAGE_MIN_RANGE (fighters and creatures, which
 * carry no maximumWeaponsRange, close well inside it).
 */
export const ENGAGE_MIN_RANGE = 2500;
const ENGAGE_RANGE_SLACK = 1.5;

type Positioned = { xpos: number; ypos: number };
type AttackerLike = Positioned & { hasBeenDestroyed?: boolean; empire?: unknown; maximumWeaponsRange?: number };

/**
 * True when `x` still counts as attacking a target of `targetEmpire` at (tx, ty) with weapon reach `targetRange`.
 * The C# never prunes Attackers of a live attacker that simply left (BuiltObject.cs 4557 DefendBase only drops destroyed
 * or same-empire entries; ships clear theirs on hyperjump), so a raider that shot a space port once and flew off stays
 * listed for the rest of the game. The marker therefore needs the attacker alive, hostile and still within range.
 */
function liveAttacker(x: unknown, targetEmpire: unknown, tx: number, ty: number, targetRange: number): boolean {
    if (x === null || typeof x !== 'object') return false;
    const a = x as AttackerLike;
    if (a.hasBeenDestroyed || (a.empire !== undefined && a.empire === targetEmpire)) return false;
    const range = Math.max(ENGAGE_MIN_RANGE, ENGAGE_RANGE_SLACK * Math.max(a.maximumWeaponsRange ?? 0, targetRange));
    const dx = a.xpos - tx, dy = a.ypos - ty;
    return dx * dx + dy * dy <= range * range;
}

type AttackTarget = Pick<BuiltObject, 'attackers'> & Positioned & { empire?: unknown; maximumWeaponsRange?: number };

/** True when a live, hostile, in-range object is attacking this ship (BuiltObject.Attackers, see liveAttacker). */
function underAttack(bo: AttackTarget): boolean {
    const a = bo.attackers;
    if (a === null) return false;
    for (const x of a) if (liveAttacker(x, bo.empire, bo.xpos, bo.ypos, bo.maximumWeaponsRange ?? 0)) return true;
    return false;
}

/**
 * Game ms of the ship's last combat activity: nowMs while it is under attack, else the later of its last shield strike
 * and its weapons' last shot (MIN_TIME when neither ever happened).
 */
export function lastCombatMs(bo: Pick<BuiltObject, 'weapons' | 'lastShieldStrike'> & AttackTarget, nowMs: number): number {
    if (underAttack(bo)) return nowMs;
    let last = bo.lastShieldStrike;
    for (const w of bo.weapons) if (w.lastFired > last) last = w.lastFired;
    return last;
}

/** Marker opacity 0..1: full for COMBAT_HOLD_S after the last activity, then a linear fade over COMBAT_FADE_S. */
export function combatActivityAlpha(bo: Pick<BuiltObject, 'weapons' | 'lastShieldStrike'> & AttackTarget, nowMs: number): number {
    const last = lastCombatMs(bo, nowMs);
    if (last <= MIN_TIME) return 0;
    const age = (nowMs - last) / 1000;
    if (age <= COMBAT_HOLD_S) return 1;
    return clamp01(1 - (age - COMBAT_HOLD_S) / COMBAT_FADE_S);
}

type FightShip = Pick<BuiltObject, 'empire' | 'hasBeenDestroyed' | 'weapons' | 'lastShieldStrike' | 'attackers' | 'xpos' | 'ypos' | 'maximumWeaponsRange'> & {
    nearestSystemStar: { systemIndex: number } | null;
};
type FightHabitat = Pick<Habitat, 'owner' | 'attackers' | 'systemIndex' | 'xpos' | 'ypos'>;

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
        if (h.attackers.some((x) => liveAttacker(x, player, h.xpos, h.ypos, 0))) put(h.systemIndex, 1);
    }
    return out;
}

/** Marker size in screen pixels: zoomed in (galaxy factor below 4000) and zoomed out. */
export const SWORD_PX_NEAR = 20;
export const SWORD_PX_FAR = 16;

const OUTLINE = 0x2a0404; // dark rim that keeps the marker readable over stars, nebulae and empire territory
const BLADE = 0xff4034; // the marker red
const BLADE_SHINE = 0xffd6cc; // a thin highlight along the cutting edge
const GUARD = 0xffc8b8;
const GRIP = 0x8a1610;

/**
 * Two crossed scimitars centred on (cx, cy), `px` screen pixels across, in world units (scale = 1/z): tips up, hilts
 * down, each blade widening towards a curved point and bowing outwards, with a curved cross guard, a grip and a pommel.
 * Our own procedural art. Each sword is drawn whole (rim, then fill) so the second crosses cleanly over the first.
 */
export function drawCrossedSwords(g: Graphics, cx: number, cy: number, px: number, z: number, alpha: number): void {
    const h = px / 2; // half size, screen px
    const k = 1 / z; // screen px -> world
    const rim = 1.25; // rim width each side, screen px
    const bladeLen = 1.85 * h, gripLen = 0.5 * h, cross = 0.62 * h; // guard sits `cross` before the crossing point
    const w0 = Math.max(1.6, 0.2 * h); // blade width at the guard, screen px
    const bow = 0.3 * h; // outward bow of the blade at the tip
    for (const s of [1, -1]) {
        // Sword frame: d along the blade (towards the tip), n outward (the side the blade bows to and the edge faces).
        const dx = s * Math.SQRT1_2, dy = -Math.SQRT1_2;
        const nx = s * Math.SQRT1_2, ny = Math.SQRT1_2;
        const ox = -cross * dx, oy = -cross * dy; // the guard, screen px from the centre
        const at = (u: number, v: number): [number, number] => [cx + (ox + u * dx + v * nx) * k, cy + (oy + u * dy + v * ny) * k];
        // Blade outline: spine from guard to tip, then the cutting edge back. Width grows to ~1.6x by 70 % (the
        // scimitar flare), then the edge sweeps up into the point.
        const N = 10;
        const spine: number[] = [], edge: [number, number][] = [], shine: number[] = [];
        for (let i = 0; i <= N; i++) {
            const t = i / N;
            const c = bow * t * t;
            const wd = t < 0.7 ? w0 * (1 + 0.85 * t) : w0 * 1.6 * Math.sqrt(Math.max(0, (1 - t) / 0.3));
            spine.push(...at(t * bladeLen, c - 0.35 * wd));
            edge.push(at(t * bladeLen, c + 0.65 * wd));
            if (i > 0 && i < N) shine.push(...at(t * bladeLen, c + 0.65 * wd - Math.min(0.9, 0.3 * wd)));
        }
        const blade = [...spine, ...edge.reverse().flat()];
        // Guard: a bar across the blade, its ends curving towards the tip (quillons).
        const gl = Math.max(2.6, 0.48 * h), gt = Math.max(1.4, 0.16 * h);
        const guard = [...at(0.35 * gl, -gl - 0.2 * gt), ...at(-0.05 * gt, -0.55 * gl), ...at(-gt, 0), ...at(-0.05 * gt, 0.55 * gl),
            ...at(0.35 * gl, gl + 0.2 * gt), ...at(0.35 * gl - gt, gl), ...at(0, 0.5 * gl), ...at(0, -0.5 * gl), ...at(0.35 * gl - gt, -gl)];
        const g0 = at(-gt, 0), g1 = at(-gt - gripLen, 0);
        const pr = Math.max(1.2, 0.14 * h), pm = at(-gt - gripLen - pr * 0.6, 0);
        const gripW = Math.max(1.4, 0.15 * h);
        // Rim.
        g.poly(blade).stroke({ width: 2 * rim * k, color: OUTLINE, alpha, join: 'round' });
        g.moveTo(g0[0], g0[1]).lineTo(g1[0], g1[1]).stroke({ width: (gripW + 2 * rim) * k, color: OUTLINE, alpha, cap: 'round' });
        g.poly(guard).stroke({ width: 2 * rim * k, color: OUTLINE, alpha, join: 'round' });
        g.circle(pm[0], pm[1], (pr + rim) * k).fill({ color: OUTLINE, alpha });
        // Fill.
        g.poly(blade).fill({ color: BLADE, alpha });
        if (px >= 14) g.poly(shine, false).stroke({ width: 0.8 * k, color: BLADE_SHINE, alpha: alpha * 0.85 });
        g.moveTo(g0[0], g0[1]).lineTo(g1[0], g1[1]).stroke({ width: gripW * k, color: GRIP, alpha, cap: 'butt' });
        g.poly(guard).fill({ color: GUARD, alpha });
        g.circle(pm[0], pm[1], pr * k).fill({ color: GUARD, alpha });
    }
}
