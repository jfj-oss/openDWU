// Orbital superiority (scenarios/orbital-superiority, flag orbitalSuperiority; a user-designed gameplay change, off by
// default, set on the new-game wizard's Other Empires page). Not a port.
//
// The original (combat/invasion.ts determineTroopModifiers) gives a flat +0.25 'Space Control' to whichever side of a
// ground invasion has more armed firepower (firepowerRaw) within 2000 of the planet (calculateSpaceControlStrengths,
// stored by tick/habitatTick.ts as habitat.invasionSpaceControlStrengthDefenders / Attackers). With the flag on, every
// periodic invasion update classifies the orbit (D = defenders, A = attackers, R = orbitalSuperiorityRatio):
//   - none       D <= 0 and A <= 0                 the original rule (nothing armed: no bonus either way);
//   - attacker   A > R·D (or D = 0 < A)            invaders +orbitalSuperiorityAttackerBonus 'Orbital superiority';
//   - contested  neither                           invaders lose the bonus and get −orbitalContestedPenaltyStart rising
//                                                  linearly to −orbitalContestedPenaltyMax over orbitalContestedRampDays
//                                                  of continuous contest ("Supply lines disrupted (−41%)"), and lose
//                                                  orbitalContestedAttritionPct of their readiness per day; the
//                                                  defenders keep the original +0.25 when D > A;
//   - defender   D > R·A (or A = 0 < D)            invaders −orbitalCutPenalty ("Supply lines cut"),
//                                                  orbitalCutAttritionPct per day, and no further landings or raids by
//                                                  that empire there; defenders keep the original +0.25.
// A unit worn below orbitalAttritionMinReadiness is lost; the last one lost ends the invasion through the stock
// repelled path (resolveInvasionBattles → invasionRepelled). The contest ramp restarts whenever the state changes.
// Applies to empire invasions only: pirate raids / pirate invaders, rebels (independent militia) and an owner fighting
// a pirate facility on its own planet keep the original rule.
// AI invaders (non-human empires) also keep their troops aboard until they hold the orbit (contested landings wait);
// the AI side (relief fleets, escorts, withdrawals, target choice) is orbitalAI.ts.
// Rnd: none here. State: scenario.state.orbitalSuperiority (only in games with the add-on).

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { BuiltObject } from '../../builtObject';
import type { Habitat } from '../../types';
import type { ShipGroup } from '../../fleets/shipGroup';
import { TroopType, type TroopList } from '../../cargo';
import { tryGetText } from '../../textResolver';
import { getNearbyBuiltObjects } from '../../pirates/pirateAI';
import { resolveInvasionEmpires } from '../../troops';
import { isHumanEmpire } from '../../humanEmpires';
import { galaxyStarDate } from '../../tick/simTime';
import { GAME_DAY_LENGTH } from '../hooks';
import { scenarioFlag, scenarioParam, scenarioState } from '../state';

export const ORBITAL_SUPERIORITY_FLAG = 'orbitalSuperiority';
export const ORBITAL_SUPERIORITY_ADDON_ID = 'orbital-superiority';
const KEY = 'orbitalSuperiority';
/** The original Space Control radius (calculateSpaceControlStrengths). */
export const ORBIT_RANGE = 2000;

export type OrbitState = 'none' | 'attacker' | 'contested' | 'defender';

/** One ground invasion in progress (enemy troops on the planet). */
export interface OrbitalInvasion {
    /** Habitat index. */
    h: number;
    /** Invader / defender empire ids. */
    inv: number;
    def: number;
    started: number;
    state: OrbitState;
    /** Star date the current state began (the contest ramp's start). */
    since: number;
    /** The defender's relief fleet (orbitalAI.ts), while alive. */
    relief: ShipGroup | null;
    reliefSent: boolean;
    /** The invader withdrew its fleet (orbitalAI.ts). */
    withdrawn: boolean;
    /** Star date of the invader's last reinforcement / give-up review (orbitalAI.ts). */
    reviewed: number;
    /** Attrition removed the last invading unit. */
    attrited: boolean;
}

/** AI troops held aboard because the orbit was not theirs. */
export interface OrbitalHold {
    h: number;
    e: number;
    since: number;
    last: number;
}

export interface OrbitalStats {
    invasions: number;
    succeeded: number;
    failed: number;
    failedByAttrition: number;
    reliefsSent: number;
    savedByRelief: number;
    landingsHeld: number;
    landingsAfterHold: number;
    landingsAborted: number;
    reinforcements: number;
    withdrawals: number;
    escortsHeld: number;
}

export interface OrbitalSuperiorityState {
    invasions: OrbitalInvasion[];
    /** Invasions that ended since the last AI review (orbitalAI.ts releases their relief fleets). */
    ended: OrbitalInvasion[];
    holds: OrbitalHold[];
    /** Habitat / empire pairs the AI recently withdrew from (no new invasion target until `until`). */
    cooldowns: { h: number; e: number; until: number }[];
    stats: OrbitalStats;
}

function newStats(): OrbitalStats {
    return { invasions: 0, succeeded: 0, failed: 0, failedByAttrition: 0, reliefsSent: 0, savedByRelief: 0, landingsHeld: 0, landingsAfterHold: 0, landingsAborted: 0, reinforcements: 0, withdrawals: 0, escortsHeld: 0 };
}

export function orbitalSuperiorityOn(galaxy: Galaxy): boolean {
    return scenarioFlag(galaxy, ORBITAL_SUPERIORITY_FLAG);
}

export function orbitalState(galaxy: Galaxy): OrbitalSuperiorityState {
    return scenarioState<OrbitalSuperiorityState>(galaxy, KEY, () => ({ invasions: [], ended: [], holds: [], cooldowns: [], stats: newStats() }));
}

export function orbitalRatio(galaxy: Galaxy): number {
    return scenarioParam(galaxy, 'orbitalSuperiorityRatio', 1.5);
}

/** The orbit state for defender strength `d` and attacker strength `a` (negative = unknown: none). */
export function classifyOrbit(d: number, a: number, ratio: number): OrbitState {
    const dd = Math.max(0, d);
    const aa = Math.max(0, a);
    if (dd <= 0 && aa <= 0) return 'none';
    if (dd <= 0) return 'attacker';
    if (aa <= 0) return 'defender';
    if (aa > ratio * dd) return 'attacker';
    if (dd > ratio * aa) return 'defender';
    return 'contested';
}

/** Armed firepower (firepowerRaw) of `empire`'s built objects within `range` of (x, y): the Space Control measure. */
export function empireFirepowerNear(galaxy: Galaxy, x: number, y: number, range: number, empire: Empire | null): number {
    if (empire === null) return 0;
    let total = 0;
    const near = getNearbyBuiltObjects(galaxy, x, y, range);
    for (let i = 0; i < near.length; i++) {
        const b = near[i];
        if (b != null && !b.hasBeenDestroyed && b.firepowerRaw > 0 && b.owner === empire) total += b.firepowerRaw;
    }
    return total;
}

/** Armed firepower (firepowerRaw) per owner of the built objects within `range` of (x, y): the same Space Control measure, one lookup (Blockades that bite). */
export function firepowerByEmpireNear(galaxy: Galaxy, x: number, y: number, range: number): Map<Empire, number> {
    const out = new Map<Empire, number>();
    const near = getNearbyBuiltObjects(galaxy, x, y, range);
    for (let i = 0; i < near.length; i++) {
        const b = near[i];
        if (b == null || b.hasBeenDestroyed || !(b.firepowerRaw > 0) || b.owner === null) continue;
        const e = b.owner as Empire;
        out.set(e, (out.get(e) ?? 0) + b.firepowerRaw);
    }
    return out;
}

/** A normal (non-pirate) empire that is not the independents. */
function normalEmpire(galaxy: Galaxy, e: Empire | null): e is Empire {
    return e !== null && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null;
}

/** The rule covers this invasion: an empire invading another's colony (not raids, rebels or pirate invaders). */
export function orbitalRuleApplies(galaxy: Galaxy, h: Habitat, invader: Empire | null, defender: Empire | null, attackingTroops: TroopList | null): boolean {
    if (!normalEmpire(galaxy, invader) || defender === null || invader === defender || invader === h.empire) return false;
    if (attackingTroops !== null && attackingTroops.count > 0 && attackingTroops.items[0].type === TroopType.PirateRaider) return false;
    return true;
}

/** The current orbit state of an invasion in progress (from the strengths the habitat tick stored). */
export function invasionOrbitState(galaxy: Galaxy, h: Habitat): OrbitState {
    if (h.invasionSpaceControlStrengthDefenders < 0 || h.invasionSpaceControlStrengthAttackers < 0) return 'none';
    return classifyOrbit(h.invasionSpaceControlStrengthDefenders, h.invasionSpaceControlStrengthAttackers, orbitalRatio(galaxy));
}

export function findInvasion(st: OrbitalSuperiorityState, h: Habitat): OrbitalInvasion | null {
    for (let i = 0; i < st.invasions.length; i++) if (st.invasions[i].h === h.habitatIndex) return st.invasions[i];
    return null;
}

/** Days the orbit has been contested (0 when it is not). */
export function contestedDays(galaxy: Galaxy, h: Habitat): number {
    const inv = findInvasion(orbitalState(galaxy), h);
    if (inv === null || inv.state !== 'contested') return 0;
    return Math.max(0, (galaxyStarDate(galaxy) - inv.since) / GAME_DAY_LENGTH);
}

/** The contested-orbit attack penalty after `days` of contest (start → max, linear over the ramp). */
export function contestedPenalty(galaxy: Galaxy, days: number): number {
    const start = scenarioParam(galaxy, 'orbitalContestedPenaltyStart', 0.35);
    const max = scenarioParam(galaxy, 'orbitalContestedPenaltyMax', 0.5);
    const ramp = Math.max(1, scenarioParam(galaxy, 'orbitalContestedRampDays', 30));
    return start + (max - start) * Math.min(1, Math.max(0, days) / ramp);
}

function text(tag: string, fallback: string): string {
    return tryGetText(tag) ?? fallback;
}

/**
 * determineTroopModifiers' Space Control block with the flag on: pushes this rule's modifiers and returns true, or
 * returns false for the original block (flag off, rule not applicable, or nothing armed in orbit). Pure.
 */
export function orbitalTroopModifiers(galaxy: Galaxy, h: Habitat, attackingTroops: TroopList, defend: { amounts: number[]; reasons: string[] }, attack: { amounts: number[]; reasons: string[] }, spaceControlText: string): boolean {
    if (!orbitalSuperiorityOn(galaxy)) return false;
    const { defender, invader } = resolveInvasionEmpires(h);
    if (!orbitalRuleApplies(galaxy, h, invader, defender ?? h.empire, attackingTroops)) return false;
    const state = invasionOrbitState(galaxy, h);
    switch (state) {
        case 'none':
            return false;
        case 'attacker':
            attack.amounts.push(scenarioParam(galaxy, 'orbitalSuperiorityAttackerBonus', 0.5));
            attack.reasons.push(text('OrbitalSuperiority Held', 'Orbital superiority'));
            return true;
        case 'contested': {
            if (h.invasionSpaceControlStrengthDefenders > h.invasionSpaceControlStrengthAttackers) {
                defend.amounts.push(0.25);
                defend.reasons.push(spaceControlText);
            }
            const p = contestedPenalty(galaxy, contestedDays(galaxy, h));
            attack.amounts.push(-p);
            attack.reasons.push(text('OrbitalSuperiority Disrupted', 'Supply lines disrupted ({0})').replace('{0}', `-${Math.round(p * 100)}%`));
            return true;
        }
        case 'defender':
            defend.amounts.push(0.25);
            defend.reasons.push(spaceControlText);
            attack.amounts.push(-scenarioParam(galaxy, 'orbitalCutPenalty', 0.5));
            attack.reasons.push(text('OrbitalSuperiority Cut', 'Supply lines cut'));
            return true;
    }
}

/** tick/habitatTick.ts, after the invasion's space control strengths are stored: track the invasion and its state. */
export function orbitalTrackInvasion(galaxy: Galaxy, h: Habitat): void {
    if (!orbitalSuperiorityOn(galaxy)) return;
    const { defender: d0, invader } = resolveInvasionEmpires(h);
    const defender = d0 ?? h.empire;
    if (!orbitalRuleApplies(galaxy, h, invader, defender, h.invadingTroops)) return;
    const st = orbitalState(galaxy);
    const now = galaxyStarDate(galaxy);
    const state = invasionOrbitState(galaxy, h);
    let inv = findInvasion(st, h);
    if (inv !== null && inv.inv !== invader!.empireId) {
        endInvasion(galaxy, st, inv, h);
        inv = null;
    }
    if (inv === null) {
        inv = { h: h.habitatIndex, inv: invader!.empireId, def: defender!.empireId, started: now, state, since: now, relief: null, reliefSent: false, withdrawn: false, reviewed: now, attrited: false };
        st.invasions.push(inv);
        st.stats.invasions++;
        return;
    }
    if (inv.state !== state) {
        inv.state = state;
        inv.since = now;
    }
}

function endInvasion(galaxy: Galaxy, st: OrbitalSuperiorityState, inv: OrbitalInvasion, h: Habitat): void {
    const i = st.invasions.indexOf(inv);
    if (i >= 0) st.invasions.splice(i, 1);
    if (h.empire !== null && h.empire.empireId === inv.inv) st.stats.succeeded++;
    else {
        st.stats.failed++;
        if (inv.attrited) st.stats.failedByAttrition++;
        if (inv.reliefSent) st.stats.savedByRelief++;
    }
    st.ended.push(inv);
}

/** tick/habitatTick.ts, periodic step with no invaders on the habitat: close its invasion record. */
export function orbitalTrackNoInvasion(galaxy: Galaxy, h: Habitat): void {
    if (!orbitalSuperiorityOn(galaxy)) return;
    const st = orbitalState(galaxy);
    if (st.invasions.length === 0) return;
    const inv = findInvasion(st, h);
    if (inv !== null) endInvasion(galaxy, st, inv, h);
}

/**
 * combat/invasion.ts resolveInvasionBattles, after the step's losses: the daily supply attrition of a contested or
 * defender-held orbit. Units worn below the minimum readiness are lost (the stock repelled path follows when none is
 * left). No Rnd.
 */
export function orbitalAttrition(galaxy: Galaxy, h: Habitat, defender: Empire | null, timeSpanSeconds: number, stats: { troopsDamageToInvaders: number; destroyedInvadingTroops: number } | null): void {
    if (!orbitalSuperiorityOn(galaxy)) return;
    const troops = h.invadingTroops;
    if (troops === null || troops.count <= 0) return;
    const inv = findInvasion(orbitalState(galaxy), h);
    if (inv === null) return;
    const state = invasionOrbitState(galaxy, h);
    const pct = state === 'contested' ? scenarioParam(galaxy, 'orbitalContestedAttritionPct', 1) : state === 'defender' ? scenarioParam(galaxy, 'orbitalCutAttritionPct', 3) : 0;
    if (!(pct > 0)) return;
    const days = (timeSpanSeconds * 1000) / GAME_DAY_LENGTH;
    const factor = Math.max(0, 1 - (pct / 100) * days);
    const minReadiness = scenarioParam(galaxy, 'orbitalAttritionMinReadiness', 5);
    const items = troops.items.slice();
    for (const t of items) {
        if (t == null) continue;
        const before = t.readiness;
        t.readiness = Math.fround(before * factor);
        if (stats !== null) stats.troopsDamageToInvaders = Math.fround(stats.troopsDamageToInvaders + Math.fround(before - t.readiness));
        if (t.readiness < minReadiness) {
            troops.remove(t);
            const e = t.empire as Empire | null;
            if (e !== null && e.troops != null) e.troops.remove(t);
            if (defender !== null && defender.counters !== null) defender.counters.processTroopDestruction(t);
            if (stats !== null) stats.destroyedInvadingTroops++;
        }
    }
    if (troops.count === 0) inv.attrited = true;
}

// ---------------------------------------------------------------------------------------------------------------
// Landings
// ---------------------------------------------------------------------------------------------------------------

/** Defender / attacker Space Control strengths at `h` for a landing by `attacker`. Pure. */
export function landingOrbitStrengths(galaxy: Galaxy, h: Habitat, defender: Empire, attacker: Empire): { d: number; a: number } {
    return { d: empireFirepowerNear(galaxy, h.xpos, h.ypos, ORBIT_RANGE, defender), a: empireFirepowerNear(galaxy, h.xpos, h.ypos, ORBIT_RANGE, attacker) };
}

/** The orbit state a landing by `attacker` on `h` meets now. */
export function landingOrbitState(galaxy: Galaxy, h: Habitat, attacker: Empire): OrbitState {
    const defender = h.empire;
    if (defender === null || defender === attacker) return 'none';
    const s = landingOrbitStrengths(galaxy, h, defender, attacker);
    return classifyOrbit(s.d, s.a, orbitalRatio(galaxy));
}

export function findHold(st: OrbitalSuperiorityState, h: number, e: number): OrbitalHold | null {
    for (let i = 0; i < st.holds.length; i++) if (st.holds[i].h === h && st.holds[i].e === e) return st.holds[i];
    return null;
}

/**
 * combat/threats.ts shouldInvadeColony: true when this rule refuses `bo`'s troop landing (or raid) on `h` now —
 * a defender-held orbit refuses every empire's landings and raids; a contested one refuses AI empires' landings (the
 * troops wait aboard; orbitalAI.ts withdraws them after orbitalAiHoldDays). Records the AI holds. No Rnd.
 */
export function orbitalLandingBlocked(galaxy: Galaxy, bo: BuiltObject, h: Habitat, raid: boolean): boolean {
    if (!orbitalSuperiorityOn(galaxy)) return false;
    const attacker = bo.empire;
    if (!normalEmpire(galaxy, attacker)) return false;
    const defender = h.empire;
    if (defender === null || defender === attacker) return false;
    const state = landingOrbitState(galaxy, h, attacker);
    const ai = !isHumanEmpire(galaxy, attacker);
    const blocked = state === 'defender' || (!raid && ai && state === 'contested');
    if (!ai || raid) return blocked;
    const st = orbitalState(galaxy);
    const now = galaxyStarDate(galaxy);
    const hold = findHold(st, h.habitatIndex, attacker.empireId);
    if (blocked) {
        if (hold === null) {
            st.holds.push({ h: h.habitatIndex, e: attacker.empireId, since: now, last: now });
            st.stats.landingsHeld++;
        } else hold.last = now;
    } else if (hold !== null) {
        st.holds.splice(st.holds.indexOf(hold), 1);
        st.stats.landingsAfterHold++;
    }
    return blocked;
}
