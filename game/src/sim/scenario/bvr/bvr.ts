// BVR combat (scenarios/bvr-combat, flag bvrCombat): an opt-in gameplay change (beyond-visual-range combat). Not a port.
//
// What the original has (and stays as it is without the flag): ships mount a Weapon per weapon component, a Weapon is a
// projectile launcher that fires whenever its fire rate allows and its energy is there (no ammunition), a missile/torpedo is
// a projectile whose hit or miss is rolled at the moment of firing (combat/weapons.ts determineHitTarget) and that steers
// at its target, and Bacon's InterceptMissiles lets point defence / beams / phasers / rail guns shoot incoming missiles
// (WeaponMissile only) down with certainty. Targets are picked from the empire's system threat lists.
//
// With the flag on (the data side is the scenario's components.txt / research.txt overlay: four tiers of a new missile
// launcher family, ids 129-132, and the stock torpedoes rebuilt as close-range, slow, concentrated hitters; see the
// scenario folder), this package adds the rules around them:
//   - Magazines: a BVR missile launcher carries bvrMissileRounds (4) missiles, a torpedo launcher bvrTorpedoRounds (6). The
//     magazine is a pool per component id on a ship (scenario.state.bvrCombat.mags, a Map keyed by the ship that holds only
//     the rounds SPENT since the last rearm: a ship without an entry is full, so older saves and new ships start full and no
//     field is added to BuiltObject). A launcher that is damaged takes its rounds with it. A launcher fires only while its
//     pool has rounds (weapons.ts fireWeaponsAtTarget; bvrMayFire / bvrNoteFired).
//   - Sensor targeting: a missile can be fired at a ship or base only while the firing empire tracks it: the stock visibility
//     test (Empire.9.cs IsObjectVisibleToThisEmpire) must hold AND one of the firing ship, its fleet mates or the empire's
//     long-range scanner stations must reach it with bvrTrackRange plus a share of its long-range scanner / proximity array
//     range, scaled by the target's stealth rating (a cloak shortens it) and cut by a jamming target unless the sensor ship
//     carries a trace scanner of at least that power (bvrTracked). Planets and creatures need no lock.
//   - Seeking: a missile's hit is rolled by bvrMissileHit, not the beam formula: bvrSeekPct plus the firer's targeting minus the
//     target's countermeasures (ECM, fleet ECM, empire factor; weighted bvrEcmWeightPct), with the fleet and captain bonuses.
//   - Point defence (weapons.ts bvrInterceptMissiles, in place of Bacon's call): missiles and torpedoes in flight at a ship can
//     be shot at by its point defence (bvrPdPct per shot) and its beams, phasers and rail guns (bvrGunPct per shot).
//   - Rearming (bvrRearmTick, every other game day): a ship within bvrRearmRange of its own or an allied (mutual defence pact or
//     protectorate) space port or base with a dock, or a deployed resupply ship (at bvrResupplyPct of the port's speed), loads
//     a round every bvrRearmSeconds per pool for bvrRoundCostPct of the launcher's price (with the ship markup), paid by the ship's owner
//     (the port's owner is paid), into debt if need be. A ship docked on a Refuel order stays docked until it is full (cmdDocking.ts cmdRefuel).
//   - AI (bvrAI.ts, flag bvrAI): research order, ship designs, standoff / closing tactics, rearm trips, escorts and point defence.
// Rnd: only the seek roll and the point-defence rolls (the sim's seeded galaxy.rnd). With the flag off (or no scenario)
// nothing here runs and every hook is one comparison.

import type { Galaxy } from '../../galaxy';
import type { BuiltObject } from '../../builtObject';
import type { Empire } from '../../empire';
import type { Weapon } from '../../weapon';
import type { StellarObject } from '../../missions/mission';
import { isBuiltObject } from '../../missions/mission';
import { ComponentType } from '../../data/components';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { galaxyComponentCurrentPrices } from '../../design';
import { baconSettings } from '../../data/baconSettings';
import { DiplomaticRelationType } from '../../diplomacy';
import { isObjectVisibleToThisEmpire } from '../../independentTraders';
import { registerScenarioFramePeriodic } from '../hooks';
import { scenarioFlag, scenarioParam, scenarioState } from '../state';

export const BVR_FLAG = 'bvrCombat';
export const BVR_AI_FLAG = 'bvrAI';
export const BVR_ADDON_ID = 'bvr-combat';
/**
 * The BVR missile launchers are components 129-132 of the scenario's components.txt (type WeaponMissile): the ids follow the
 * stock components 0-128 because the sim indexes its component arrays by id (design.ts galaxyComponentCurrentPrices), so
 * they must stay dense. Research projects 372-378 likewise follow the stock 0-371 (the same ids as the time-bomb add-on's, so the two conflict).
 */
export const BVR_FIRST_COMPONENT_ID = 129;
export const BVR_LAST_COMPONENT_ID = 132;
/** Race event type PredictiveHistory (weapons.ts RACE_EVENT_TYPE_PREDICTIVE_HISTORY). */
const RACE_EVENT_TYPE_PREDICTIVE_HISTORY = 28;

/** Defaults of the scenario.json params (the fallbacks of bvrParam). */
export const BVR_DEFAULTS = {
    bvrMissileRounds: 4,
    bvrTorpedoRounds: 6,
    bvrTrackRange: 2400,
    bvrSensorPct: 10,
    bvrSeekPct: 85,
    bvrEcmWeightPct: 130,
    bvrPdPct: 50,
    bvrPdTorpedoPct: 12,
    bvrGunPct: 15,
    bvrRearmSeconds: 5,
    bvrResupplyPct: 35,
    bvrRearmRange: 1500,
    bvrRoundCostPct: 12,
    bvrDryPct: 25,
    bvrAiValuePct: 35,
} as const;
export type BvrParam = keyof typeof BVR_DEFAULTS;

export function bvrParam(galaxy: Galaxy, name: BvrParam): number {
    return scenarioParam(galaxy, name, BVR_DEFAULTS[name]);
}

/** True when the game runs BVR combat. */
export function bvrOn(galaxy: Galaxy): boolean {
    return galaxy.scenario !== null && scenarioFlag(galaxy, BVR_FLAG);
}

/** True when the AI empires use it (flag bvrAI, under the master switch). */
export function bvrAiOn(galaxy: Galaxy): boolean {
    return galaxy.scenario !== null && scenarioFlag(galaxy, BVR_FLAG) && scenarioFlag(galaxy, BVR_AI_FLAG);
}

// ---------------------------------------------------------------------------------------------------------------
// Which components
// ---------------------------------------------------------------------------------------------------------------

interface DefLike {
    readonly type: ComponentType;
    readonly componentId: number;
}

/** A BVR missile launcher (WeaponMissile, id 129-132). */
export function isBvrMissile(def: DefLike): boolean {
    return def.type === ComponentType.WeaponMissile && def.componentId >= BVR_FIRST_COMPONENT_ID && def.componentId <= BVR_LAST_COMPONENT_ID;
}

/** A launcher with a magazine: a BVR missile launcher or a torpedo launcher (the stock missiles and super weapons are unlimited). */
export function isLimitedLauncher(def: DefLike): boolean {
    return def.type === ComponentType.WeaponTorpedo || isBvrMissile(def);
}

/** Rounds one launcher of this component carries. */
export function roundsPerLauncher(galaxy: Galaxy, def: DefLike): number {
    return def.type === ComponentType.WeaponTorpedo ? bvrParam(galaxy, 'bvrTorpedoRounds') : bvrParam(galaxy, 'bvrMissileRounds');
}

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------

/** A ship's spent rounds by component id, and the game seconds loaded towards the next round. */
export interface Magazine {
    spent: Record<number, number>;
    progress: number;
    /** galaxy.nowMs since which a docked ship has been held for rearming (absent = not held; -1 = gave up waiting). */
    hold?: number;
}

/** Counters (soaks, tests) and the magazines: scenario.state.bvrCombat, only in games with the add-on. */
export interface BvrState {
    mags: Map<BuiltObject, Magazine>;
    /** galaxy.nowMs of the last rearm tick. */
    lastTickMs: number;
    missilesFired: number;
    torpedoesFired: number;
    missileHits: number;
    torpedoHits: number;
    /** Shots that missed their roll (no lock-on). */
    missileMisses: number;
    /** Missiles / torpedoes shot down by point defence, by guns. */
    downedByPd: number;
    downedByGuns: number;
    /** Launch attempts refused for want of a track. */
    untracked: number;
    roundsLoaded: number;
    /** Of them, loaded by a deployed resupply ship (absent in saves from before the counter existed). */
    roundsViaResupply?: number;
    roundsCost: number;
    /** Rearm trips the AI sent fleets on. */
    aiRearmTrips: number;
}

export function bvrState(galaxy: Galaxy): BvrState {
    return scenarioState<BvrState>(galaxy, 'bvrCombat', () => ({
        mags: new Map(),
        lastTickMs: 0,
        missilesFired: 0,
        torpedoesFired: 0,
        missileHits: 0,
        torpedoHits: 0,
        missileMisses: 0,
        downedByPd: 0,
        downedByGuns: 0,
        untracked: 0,
        roundsLoaded: 0,
        roundsCost: 0,
        aiRearmTrips: 0,
    }));
}

/** The state if it exists (never creates it). */
export function peekBvrState(galaxy: Galaxy): BvrState | undefined {
    return galaxy.scenario === null ? undefined : (galaxy.scenario.state.bvrCombat as BvrState | undefined);
}

// ---------------------------------------------------------------------------------------------------------------
// Magazines
// ---------------------------------------------------------------------------------------------------------------

/** Launchers of this component on the ship that can fire (a Weapon exists only for a working component). */
function launcherCount(bo: BuiltObject, componentId: number): number {
    let n = 0;
    for (const w of bo.weapons) if (w != null && w.component.componentId === componentId) n++;
    return n;
}

/** Rounds the ship's launchers of this component hold now. */
export function roundsLeft(galaxy: Galaxy, bo: BuiltObject, def: DefLike): number {
    const cap = launcherCount(bo, def.componentId) * roundsPerLauncher(galaxy, def);
    const m = peekBvrState(galaxy)?.mags.get(bo);
    const spent = m === undefined ? 0 : (m.spent[def.componentId] ?? 0);
    return Math.max(0, cap - spent);
}

/** The fraction (0..1) of a limited launcher's pool that is loaded (1 for any other weapon). */
export function ammoFraction(galaxy: Galaxy, bo: BuiltObject, def: DefLike): number {
    if (!isLimitedLauncher(def)) return 1;
    const cap = launcherCount(bo, def.componentId) * roundsPerLauncher(galaxy, def);
    if (cap <= 0) return 0;
    const m = peekBvrState(galaxy)?.mags.get(bo);
    const spent = m === undefined ? 0 : (m.spent[def.componentId] ?? 0);
    return Math.max(0, cap - spent) / cap;
}

/** May this weapon fire now (it has a round, or it needs none)? */
export function bvrMayFire(galaxy: Galaxy, bo: BuiltObject, weapon: Weapon): boolean {
    const def = weapon.component;
    if (!isLimitedLauncher(def)) return true;
    return roundsLeft(galaxy, bo, def) > 0;
}

/** Spends one round of the weapon's pool (the weapon has just fired). */
export function bvrNoteFired(galaxy: Galaxy, bo: BuiltObject, weapon: Weapon): void {
    const def = weapon.component;
    if (!isLimitedLauncher(def)) return;
    const st = bvrState(galaxy);
    let m = st.mags.get(bo);
    if (m === undefined) {
        m = { spent: {}, progress: 0 };
        st.mags.set(bo, m);
    }
    m.spent[def.componentId] = (m.spent[def.componentId] ?? 0) + 1;
    if (def.type === ComponentType.WeaponTorpedo) st.torpedoesFired++;
    else st.missilesFired++;
}

/** Counts a hit of a limited launcher's round on its target. */
export function bvrNoteHit(galaxy: Galaxy, weapon: Weapon): void {
    const st = bvrState(galaxy);
    if (weapon.component.type === ComponentType.WeaponTorpedo) st.torpedoHits++;
    else st.missileHits++;
}

/** Counts a launch check refused for want of a track (a ready missile launcher, a target in range that the empire does not track). */
export function bvrNoteUntracked(galaxy: Galaxy): void {
    bvrState(galaxy).untracked++;
}

/** Counts a missile or torpedo shot down by point defence or by guns. */
export function bvrNoteDowned(galaxy: Galaxy, byPointDefence: boolean): void {
    const st = bvrState(galaxy);
    if (byPointDefence) st.downedByPd++;
    else st.downedByGuns++;
}

/** A magazine summary of the ship, or null when it carries no limited launcher. */
export interface AmmoSummary {
    missiles: { have: number; cap: number };
    torpedoes: { have: number; cap: number };
}
export function bvrAmmoSummary(galaxy: Galaxy, bo: BuiltObject): AmmoSummary | null {
    if (bo.weapons == null || bo.weapons.length === 0) return null;
    const out: AmmoSummary = { missiles: { have: 0, cap: 0 }, torpedoes: { have: 0, cap: 0 } };
    const seen = new Set<number>();
    let any = false;
    for (const w of bo.weapons) {
        if (w == null || !isLimitedLauncher(w.component)) continue;
        const id = w.component.componentId;
        if (seen.has(id)) continue;
        seen.add(id);
        any = true;
        const cap = launcherCount(bo, id) * roundsPerLauncher(galaxy, w.component);
        const have = roundsLeft(galaxy, bo, w.component);
        const side = w.component.type === ComponentType.WeaponTorpedo ? out.torpedoes : out.missiles;
        side.have += have;
        side.cap += cap;
    }
    return any ? out : null;
}

/** "Missiles 3/8, Torpedoes 12/12", or null (no limited launcher, or BVR combat is off). */
export function bvrAmmoText(galaxy: Galaxy, bo: BuiltObject): string | null {
    if (!bvrOn(galaxy)) return null;
    const s = bvrAmmoSummary(galaxy, bo);
    if (s === null) return null;
    const parts: string[] = [];
    if (s.missiles.cap > 0) parts.push(`Missiles ${s.missiles.have}/${s.missiles.cap}`);
    if (s.torpedoes.cap > 0) parts.push(`Torpedoes ${s.torpedoes.have}/${s.torpedoes.cap}`);
    return parts.join(', ');
}

/** The share (0..1) of the ship's magazine capacity that is loaded (1 when it has no limited launcher). */
export function bvrMagazineFill(galaxy: Galaxy, bo: BuiltObject): number {
    const s = bvrAmmoSummary(galaxy, bo);
    if (s === null) return 1;
    const cap = s.missiles.cap + s.torpedoes.cap;
    return cap <= 0 ? 1 : (s.missiles.have + s.torpedoes.have) / cap;
}

/** True when the ship has limited launchers and its magazines are not full. */
export function bvrNeedsRounds(galaxy: Galaxy, bo: BuiltObject): boolean {
    const m = peekBvrState(galaxy)?.mags.get(bo);
    if (m === undefined) return false;
    for (const k in m.spent) if (m.spent[k] > 0) return true;
    return false;
}

// ---------------------------------------------------------------------------------------------------------------
// Sensor targeting
// ---------------------------------------------------------------------------------------------------------------

/** One sensor platform's tracking reach against a target (before the target's stealth). */
function trackReach(galaxy: Galaxy, s: BuiltObject, jam: number): number {
    const extra = (Math.max(s.sensorLongRange, s.sensorProximityArrayRange) * bvrParam(galaxy, 'bvrSensorPct')) / 100;
    let r = bvrParam(galaxy, 'bvrTrackRange') + extra;
    if (jam > 0 && s.sensorTraceScannerPower < jam) r *= 0.7;
    return r;
}

/**
 * Whether the firing ship's empire tracks `target` well enough to fire a missile at it. Ships and bases need a lock (see the
 * header); anything else (planets, creatures, fighters) is fired at by range alone.
 */
export function bvrTracked(galaxy: Galaxy, firer: BuiltObject, target: StellarObject): boolean {
    if (!isBuiltObject(target)) return true;
    const empire = firer.empire;
    if (empire === null) return true;
    const stealth = target.stealth > 0 ? Math.min(1, target.stealth) : 1;
    const jam = target.sensorTraceScannerJamming;
    const within = (s: BuiltObject): boolean => {
        if (s.hasBeenDestroyed) return false;
        const dx = s.xpos - target.xpos;
        const dy = s.ypos - target.ypos;
        const r = trackReach(galaxy, s, jam) * stealth;
        return dx * dx + dy * dy <= r * r;
    };
    let ok = within(firer);
    if (!ok && firer.shipGroup !== null) {
        const ships = (firer.shipGroup as { ships: (BuiltObject | null)[] }).ships;
        for (let i = 0; i < ships.length && !ok; i++) {
            const s = ships[i];
            if (s != null && s !== firer && within(s)) ok = true;
        }
    }
    if (!ok) {
        const scanners = empire.longRangeScanners as BuiltObject[];
        for (let i = 0; i < scanners.length && !ok; i++) {
            const s = scanners[i];
            if (s != null && s.sensorLongRange > 0 && within(s)) ok = true;
        }
    }
    if (!ok) return false;
    return isObjectVisibleToThisEmpire(galaxy, empire, target);
}

// ---------------------------------------------------------------------------------------------------------------
// Seeking
// ---------------------------------------------------------------------------------------------------------------

/**
 * The hit roll of a BVR missile at a ship or base (replaces the beam-style roll of weapons.ts determineHitTarget). Draws one
 * galaxy.rnd.nextDouble(). `hitRangeChance` is the probability, as the miss-heading code of Weapon.FireInternal reads it.
 */
export function bvrMissileHit(galaxy: Galaxy, self: BuiltObject, target: BuiltObject, groupTargeting: number, captainTargeting: number, groupCm: number, captainCm: number): { willHit: boolean; hitRangeChance: number } {
    let tg = self.targettingModifier + self.fleetTargettingBonus;
    if (self.empire !== null) {
        tg += (self.empire.targettingFactor - 1.0) * 100.0;
        if (self.empire.raceEventType === RACE_EVENT_TYPE_PREDICTIVE_HISTORY) tg += 20.0;
    }
    let cm = target.countermeasureModifier + target.fleetCountermeasureBonus;
    if (target.empire !== null) {
        cm += (target.empire.countermeasuresFactor - 1.0) * 100.0;
        if (target.empire.raceEventType === RACE_EVENT_TYPE_PREDICTIVE_HISTORY) cm += 20.0;
    }
    let p = bvrParam(galaxy, 'bvrSeekPct') / 100 + (tg - (cm * bvrParam(galaxy, 'bvrEcmWeightPct')) / 100) / 100;
    p *= groupTargeting * captainTargeting;
    p /= groupCm * captainCm;
    p = Math.min(0.98, Math.max(0.03, p));
    return { willHit: galaxy.rnd.nextDouble() < p, hitRangeChance: p };
}

// ---------------------------------------------------------------------------------------------------------------
// Rearming
// ---------------------------------------------------------------------------------------------------------------

function hasDock(b: BuiltObject): boolean {
    return b.isSpacePort || (b.dockingBays !== null && b.dockingBays.length > 0);
}

/** Own rearm points of an empire this tick: space ports and bases with a dock, deployed resupply ships. */
function ownSources(empire: Empire): BuiltObject[] {
    const out: BuiltObject[] = [];
    const add = (list: unknown[]): void => {
        for (const o of list) {
            const b = o as BuiltObject | null;
            if (b == null || b.hasBeenDestroyed || !b.isFunctional || out.includes(b)) continue;
            if (b.subRole === BuiltObjectSubRole.ResupplyShip) {
                if (b.isDeployed) out.push(b);
            } else if (b.role === BuiltObjectRole.Base && hasDock(b)) {
                out.push(b);
            }
        }
    };
    add(empire.spacePorts as unknown[]);
    add(empire.refuellingDepots as unknown[]);
    add(empire.resupplyShips as unknown[]);
    return out;
}

function isAllyOf(a: Empire, b: Empire): boolean {
    const t = a.diplomaticRelations.byEmpire(b)?.type;
    return t === DiplomaticRelationType.MutualDefensePact || t === DiplomaticRelationType.Protectorate;
}

/** The empire's rearm points and its allies'. */
export function sourcesFor(galaxy: Galaxy, empire: Empire, cache: Map<Empire, BuiltObject[]>): BuiltObject[] {
    const own = (e: Empire): BuiltObject[] => {
        let l = cache.get(e);
        if (l === undefined) {
            l = ownSources(e);
            cache.set(e, l);
        }
        return l;
    };
    const mine = own(empire);
    let out = mine;
    for (const e of galaxy.empires) {
        if (e == null || e === empire || !e.active || !isAllyOf(empire, e)) continue;
        const theirs = own(e);
        if (theirs.length > 0) out = out === mine ? [...mine, ...theirs] : [...out, ...theirs];
    }
    return out;
}

/** The nearest rearm point within `range` of the ship, with the rearm speed factor (1 at a port or base, less at a resupply ship), or null. */
export function nearestRearmPoint(galaxy: Galaxy, bo: BuiltObject, range: number, sources: readonly BuiltObject[]): { point: BuiltObject; factor: number; dist: number } | null {
    let best: BuiltObject | null = null;
    let bd = range * range;
    for (const s of sources) {
        if (s === bo) continue;
        const dx = s.xpos - bo.xpos;
        const dy = s.ypos - bo.ypos;
        const d2 = dx * dx + dy * dy;
        if (d2 <= bd) {
            bd = d2;
            best = s;
        }
    }
    if (best === null) {
        // A base that has a dock rearms itself.
        if (bo.role === BuiltObjectRole.Base && hasDock(bo) && bo.isFunctional) return { point: bo, factor: 1, dist: 0 };
        return null;
    }
    const factor = best.subRole === BuiltObjectSubRole.ResupplyShip ? bvrParam(galaxy, 'bvrResupplyPct') / 100 : 1;
    return { point: best, factor, dist: Math.sqrt(bd) };
}

/** Loads one round into the pool with the most spent rounds. Returns the credits it cost, or -1 when nothing was spent. */
function loadOneRound(galaxy: Galaxy, bo: BuiltObject, m: Magazine, prices: number[]): number {
    let bestId = -1;
    let bestSpent = 0;
    for (const k in m.spent) {
        const v = m.spent[k];
        if (v > bestSpent) {
            bestSpent = v;
            bestId = Number(k);
        }
    }
    if (bestId < 0) return -1;
    // The launcher's price as a ship builder pays it (the component's resource cost times the empire's ship markup).
    const markup = bo.empire !== null && bo.empire.pirateEmpireBaseHabitat !== null ? baconSettings.shipMarkupFactorPirates : baconSettings.shipMarkupFactor;
    const cost = ((prices[bestId] ?? 0) * markup * bvrParam(galaxy, 'bvrRoundCostPct')) / 100;
    const payer = bo.owner ?? bo.empire;
    // Paid even into debt, as fuel is (cmdDocking.ts cmdRefuel): a broke AI empire still rearms, and cuts its costs elsewhere.
    if (cost > 0 && payer !== null) payer.stateMoney -= cost;
    m.spent[bestId] = bestSpent - 1;
    if (m.spent[bestId] <= 0) delete m.spent[bestId];
    return cost;
}

/** True when the magazine holds no spent rounds. */
function isFull(m: Magazine): boolean {
    for (const k in m.spent) if (m.spent[k] > 0) return false;
    return true;
}

/** Rearms every ship that is within range of a rearm point (frame-periodic, every other game day). */
export function bvrRearmTick(galaxy: Galaxy): void {
    const st = peekBvrState(galaxy);
    if (st === undefined) return;
    const now = galaxy.nowMs;
    const dt = st.lastTickMs > 0 ? Math.min(60, (now - st.lastTickMs) / 1000) : 0;
    st.lastTickMs = now;
    if (st.mags.size === 0) return;
    const range = bvrParam(galaxy, 'bvrRearmRange');
    const secPerRound = bvrParam(galaxy, 'bvrRearmSeconds');
    const prices = galaxyComponentCurrentPrices(galaxy);
    const cache = new Map<Empire, BuiltObject[]>();
    const done: BuiltObject[] = [];
    for (const [bo, m] of st.mags) {
        if (bo.hasBeenDestroyed || bo.empire === null) {
            done.push(bo);
            continue;
        }
        if (isFull(m)) {
            done.push(bo);
            continue;
        }
        const src = nearestRearmPoint(galaxy, bo, range, sourcesFor(galaxy, bo.empire, cache));
        if (src === null) {
            m.progress = 0;
            continue;
        }
        m.progress += dt * src.factor;
        while (secPerRound <= 0 || m.progress >= secPerRound) {
            const cost = loadOneRound(galaxy, bo, m, prices);
            if (cost === -1) break;
            st.roundsLoaded++;
            if (src.point.subRole === BuiltObjectSubRole.ResupplyShip) st.roundsViaResupply = (st.roundsViaResupply ?? 0) + 1;
            st.roundsCost += cost;
            const owner = src.point.owner ?? src.point.empire;
            const payer = bo.owner ?? bo.empire;
            if (owner !== null && payer !== null && owner !== payer) owner.stateMoney += cost;
            if (secPerRound > 0) m.progress -= secPerRound;
            if (isFull(m)) break;
        }
        if (isFull(m)) done.push(bo);
    }
    for (const bo of done) st.mags.delete(bo);
}

/** A docked ship waits at most this long (game ms) for its rounds (a treasury that cannot pay would hold it for ever). */
const HOLD_LIMIT_MS = 180000;

/**
 * Whether a ship docked at `dockedAt` on a Refuel order should stay docked: it is short of rounds and the dock is a rearm
 * point (cmdDocking.ts cmdRefuel; the rounds themselves are loaded by bvrRearmTick). Gives up after HOLD_LIMIT_MS.
 */
export function bvrHoldDockedForRearm(galaxy: Galaxy, bo: BuiltObject, dockedAt: unknown): boolean {
    if (!bvrOn(galaxy)) return false;
    const m = peekBvrState(galaxy)?.mags.get(bo);
    if (m === undefined || isFull(m)) {
        if (m !== undefined) delete m.hold;
        return false;
    }
    const d = dockedAt as BuiltObject | null;
    if (d == null || !isBuiltObject(d) || d.hasBeenDestroyed || !(hasDock(d) || d.subRole === BuiltObjectSubRole.ResupplyShip)) return false;
    if (m.hold === undefined) m.hold = galaxy.nowMs;
    if (m.hold < 0) return false; // gave up (cleared when the magazine is full again)
    if (galaxy.nowMs - m.hold > HOLD_LIMIT_MS) {
        m.hold = -1;
        return false;
    }
    return true;
}

registerScenarioFramePeriodic({
    id: 'bvr.rearm',
    flag: BVR_FLAG,
    periodDays: 2,
    run: (galaxy) => bvrRearmTick(galaxy),
});
