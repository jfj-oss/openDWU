// Giantworks: slow shield recharge after the shields of a wonder's ship or base are broken. Not a port; shared by the wonders
// (the Ark Engine, and the capture feature for every other Great Work: capture.ts), and the design plating both use.
//
// The stock recharge (combat/weapons.ts rechargeShields) refills a ship's shields in minutes; a broken Great Work must stay
// open for about a year. breakShields(galaxy, bo, days) puts the object on a schedule: from then on `currentShields` never
// exceeds capacity * (days gone / days), however fast the stock recharge is, and the schedule ends when the shields are whole.
// stepShields runs every quarter game day (a frame periodic, so the stock recharge cannot get far ahead of the schedule).
// The schedule is saved (scenario state 'giantworksShields': plain data and BuiltObject references).
// Rnd: none.

import type { Galaxy } from '../../../galaxy';
import type { BuiltObject } from '../../../builtObject';
import type { Design } from '../../../design';
import type { ComponentType } from '../../../data/components';
import { galaxyStarDate } from '../../../tick/simTime';
import { GAME_DAY_LENGTH, registerScenarioFramePeriodic } from '../../hooks';
import { scenarioState } from '../../state';
import { peekThreatState } from '../framework';
import { GW_FLAG } from './state';

export const SHIELDS_KEY = 'giantworksShields';

/** The shield state at or under this share of the capacity counts as broken. */
export const BROKEN_SHIELD_FRACTION = 0.02;

export interface ShieldBreakRec {
    ship: BuiltObject;
    /** Star date the shields broke. */
    brokenAt: number;
    /** Days from empty to whole. */
    days: number;
}

export interface ShieldState {
    breaks: ShieldBreakRec[];
}

export function shieldState(galaxy: Galaxy): ShieldState {
    return scenarioState<ShieldState>(galaxy, SHIELDS_KEY, () => ({ breaks: [] }));
}

export function peekShieldState(galaxy: Galaxy): ShieldState | null {
    return peekThreatState<ShieldState>(galaxy, SHIELDS_KEY);
}

/** The shield state of an object as a share of its capacity (1 for an object without shields). Pure. */
export function shieldFraction(bo: BuiltObject): number {
    return bo.shieldsCapacity > 0 ? Math.max(0, Math.min(1, bo.currentShields / bo.shieldsCapacity)) : 1;
}

/** True when the object's shields are down (at or under BROKEN_SHIELD_FRACTION of the capacity). Pure. */
export function shieldsDown(bo: BuiltObject): boolean {
    return bo.shieldsCapacity > 0 && bo.currentShields <= bo.shieldsCapacity * BROKEN_SHIELD_FRACTION;
}

/** The recharge schedule of an object (null: none). Pure. */
export function shieldBreakOf(galaxy: Galaxy, bo: BuiltObject): ShieldBreakRec | null {
    return peekShieldState(galaxy)?.breaks.find((b) => b.ship === bo) ?? null;
}

/** Where the schedule has the shields now, 0 .. 1 (null: no schedule). Pure. */
export function shieldScheduleFraction(galaxy: Galaxy, bo: BuiltObject): number | null {
    const b = shieldBreakOf(galaxy, bo);
    if (b === null) return null;
    return Math.max(0, Math.min(1, (galaxyStarDate(galaxy) - b.brokenAt) / (Math.max(1, b.days) * GAME_DAY_LENGTH)));
}

/** The shields are broken: they drop to nothing and refill over `days` days. A second call while one is running changes nothing. */
export function breakShields(galaxy: Galaxy, bo: BuiltObject, days: number): ShieldBreakRec {
    const st = shieldState(galaxy);
    let rec = st.breaks.find((b) => b.ship === bo) ?? null;
    if (rec !== null) return rec;
    rec = { ship: bo, brokenAt: galaxyStarDate(galaxy), days: Math.max(1, days) };
    st.breaks.push(rec);
    bo.currentShields = 0;
    return rec;
}

/** Ends a schedule early (the object is gone or its shields are given back whole). */
export function clearShieldBreak(galaxy: Galaxy, bo: BuiltObject, restore: boolean): void {
    const st = peekShieldState(galaxy);
    if (st === null) return;
    const i = st.breaks.findIndex((b) => b.ship === bo);
    if (i < 0) return;
    st.breaks.splice(i, 1);
    if (restore && !bo.hasBeenDestroyed) bo.currentShields = bo.shieldsCapacity;
}

/**
 * Parts of `type` added to the design until `stat(d)` is about `target` (two ReDefines to measure, one to settle): the Ark's
 * plating, and the capture feature's shields for a finished Great Work's base. The design's best part of that type is copied.
 */
export function plateDesignTo(d: Design, type: ComponentType, target: number, stat: (x: Design) => number): void {
    let part: (typeof d.components)[number] | null = null;
    for (const c of d.components) if (c.type === type && c.size > 0 && (part === null || c.value1 + c.value2 > part.value1 + part.value2)) part = c;
    if (part === null) return;
    d.reDefine();
    const base = stat(d);
    if (base >= target) return;
    const probe = 60;
    for (let i = 0; i < probe; i++) d.components.push(part);
    d.reDefine();
    const gain = (stat(d) - base) / probe;
    if (!(gain > 0)) {
        d.components.length -= probe;
        d.reDefine();
        return;
    }
    const need = Math.ceil((target - base) / gain);
    if (need > probe) for (let i = probe; i < need; i++) d.components.push(part);
    else d.components.length -= probe - need;
    d.reDefine();
}

/** Holds every scheduled object's shields to its schedule; a finished schedule is dropped. */
export function stepShields(galaxy: Galaxy): void {
    const st = peekShieldState(galaxy);
    if (st === null || st.breaks.length === 0) return;
    const now = galaxyStarDate(galaxy);
    const keep: ShieldBreakRec[] = [];
    for (const b of st.breaks) {
        const bo = b.ship;
        if (bo.hasBeenDestroyed) continue;
        const f = (now - b.brokenAt) / (Math.max(1, b.days) * GAME_DAY_LENGTH);
        if (f >= 1) {
            bo.currentShields = Math.max(bo.currentShields, bo.shieldsCapacity);
            continue;
        }
        const cap = bo.shieldsCapacity * Math.max(0, f);
        if (bo.currentShields > cap) bo.currentShields = cap;
        keep.push(b);
    }
    st.breaks = keep;
}

registerScenarioFramePeriodic({ id: 'giantworks.shields', flag: GW_FLAG, periodDays: 0.25, order: 19, run: (g) => stepShields(g) });
