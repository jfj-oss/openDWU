// Defensive jump interdiction (scenarios/jump-interdiction, flag jumpInterdiction; a user-designed gameplay change, off
// by default, set on the new-game wizard's Other Empires page). Not a port.
//
// What the original / Bacon already have (kept unchanged): a jump's spool (BuiltObject.2.cs 3020 HyperTo: the
// HyperjumpInitiate seconds of the ship's hyperdrive ± 1 s, missions/cmdMovement.ts cmdHyperTo), hyper deny weapons and
// HyperjumpDisabled zones that block a jump outright (movement.ts detectHyperDeny), Hyper Stop gravity wells that pull a
// hostile ship's jump EXIT short of a base (checkForHyperExitGravityWell; jumping in), and Bacon's star gravity wells:
// no ship jumps until it has cruised out of the star's well (BaconBuiltObject.cs 2493 IsOutsideStarGravityWell, read by
// checkFightersOnboardAndRetrieve before the jump starts).
//
// The rule (flag on): every armed defensive base or space port (role Base, fully built, not destroyed, firepower > 0,
// owned by an empire other than the independents) projects an interdiction field around itself in its own system:
//   radius = interdictionRadius × (1 + interdictionFirepowerBonus × min(1, firepower / interdictionFirepowerFull)),
// capped at the system size. A HOSTILE ship that starts a jump inside a field spools interdictionSpoolFactor (3) times
// as long as the stock roll (the roll itself is the stock draw: no extra Rnd). It keeps cruising toward its target while
// spooling; once out of every field it may jump as soon as the stock spool is over. Jumping in is unchanged.
// Hostile: at war; a pirate ship against any empire's base unless that empire pays it protection; a pirate base against
// the ships of empires with no pirate relation (None, as the original Hyper Stop rule). Friendly / neutral / independent
// ships are unaffected. Monsters are excluded: creatures do not use hyperdrives (their lunges are unchanged).
// AI: pirate raids (pirateFleets.ts) need a fleet interdictionAiRaidMargin (1.5) times the strength of the interdicting
// bases in the target system (so they raid there only when strong enough to kill the base first), and AI empires at war
// add up to interdictionAiBorderBases (1) border colony (the own colony nearest each war enemy) to the
// defensive-base locations (empireConstruction.ts buildDefensiveBases; the stock force checks still decide).
// Empire war AI (strikes, invasions, attack-target choice) is deliberately left alone: only pirate raids weigh fields.
// Rnd: none. State: scenario.state.jumpInterdiction, created at the first interdicted jump (only in games with the add-on).

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { BuiltObject } from '../../builtObject';
import type { Habitat } from '../../types';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { DiplomaticRelationType } from '../../diplomacy';
import { PirateRelationType } from '../../pirateRelations';
import { MAX_SOLAR_SYSTEM_SIZE } from '../../movement';
import { calculateOverallStrengthFactor } from '../../combat/threats';
import { noteBuiltObjectEffect } from '../../combat/effectWatch';
import { isHumanEmpire } from '../../humanEmpires';
import { registerScenarioEvent, registerScenarioQuery } from '../hooks';
import { scenarioFlag, scenarioParam, scenarioState } from '../state';

export const JUMP_INTERDICTION_FLAG = 'jumpInterdiction';
export const JUMP_INTERDICTION_ADDON_ID = 'jump-interdiction';
const KEY = 'jumpInterdiction';

/** One interdicted jump being spooled. */
export interface InterdictedSpool {
    ship: BuiltObject;
    base: BuiltObject;
    /** Star date the spool began and its stock length (ms). */
    start: number;
    stock: number;
}

export interface InterdictionStats {
    /** Jumps started inside a hostile field (pirate ships among them). */
    interdicted: number;
    interdictedPirates: number;
    /** Interdicted ships that left every field before the long spool ended. */
    escaped: number;
    /** Pirate raid choices whose required strength the fields raised. */
    raidsRaised: number;
    /** Border colonies added to AI defensive-base locations. */
    borderBaseLocations: number;
}

export interface InterdictionState {
    spools: InterdictedSpool[];
    stats: InterdictionStats;
}

function newState(): InterdictionState {
    return { spools: [], stats: { interdicted: 0, interdictedPirates: 0, escaped: 0, raidsRaised: 0, borderBaseLocations: 0 } };
}

/** The add-on state (created on first use: only games where something was interdicted save it). */
export function interdictionState(galaxy: Galaxy): InterdictionState {
    return scenarioState(galaxy, KEY, newState);
}

/** The state if it exists (never creates it). */
export function interdictionStateIfAny(galaxy: Galaxy): InterdictionState | null {
    const s = galaxy.scenario;
    return s !== null && KEY in s.state ? (s.state[KEY] as InterdictionState) : null;
}

export function jumpInterdictionOn(galaxy: Galaxy): boolean {
    return scenarioFlag(galaxy, JUMP_INTERDICTION_FLAG);
}

export function spoolFactor(galaxy: Galaxy): number {
    return Math.max(1, scenarioParam(galaxy, 'interdictionSpoolFactor', 3));
}

function isPirate(e: Empire): boolean {
    return e.pirateEmpireBaseHabitat !== null;
}

/** The pirate relation type without adding a NotMet relation (ObtainPirateRelation would add one). */
function pirateRelationType(e: Empire, other: Empire): PirateRelationType {
    return e.pirateRelations.getRelationByOtherEmpire(other)?.type ?? PirateRelationType.NotMet;
}

/** Whether two normal empires are at war, without adding a NotMet relation. */
function atWar(e: Empire, other: Empire): boolean {
    return e.diplomaticRelations?.byEmpire(other)?.type === DiplomaticRelationType.War;
}

/** An armed, fully built, undestroyed defensive base or space port of an empire (not the independents). */
export function isInterdictingBase(galaxy: Galaxy, b: BuiltObject | null): b is BuiltObject {
    if (b == null || b.hasBeenDestroyed || b.role !== BuiltObjectRole.Base) return false;
    const sr = b.subRole;
    if (sr !== BuiltObjectSubRole.DefensiveBase && sr !== BuiltObjectSubRole.SmallSpacePort && sr !== BuiltObjectSubRole.MediumSpacePort && sr !== BuiltObjectSubRole.LargeSpacePort) return false;
    if (b.builtAt !== null || b.unbuiltComponentCount > 0 || !(b.firepowerRaw > 0)) return false;
    return b.empire !== null && b.empire !== galaxy.independentEmpire;
}

/** The field radius of an interdicting base: the base radius, up to +interdictionFirepowerBonus with its firepower. */
export function interdictionRadius(galaxy: Galaxy, b: BuiltObject): number {
    const r = scenarioParam(galaxy, 'interdictionRadius', 4000);
    const full = Math.max(1, scenarioParam(galaxy, 'interdictionFirepowerFull', 400));
    const bonus = scenarioParam(galaxy, 'interdictionFirepowerBonus', 0.5);
    return Math.min(MAX_SOLAR_SYSTEM_SIZE, r * (1 + bonus * Math.min(1, Math.max(0, b.firepowerRaw) / full)));
}

/** Whether `base`'s field holds back ships of `shipEmpire` (see the header). */
export function interdictsEmpire(galaxy: Galaxy, base: BuiltObject, shipEmpire: Empire | null): boolean {
    const be = base.empire;
    if (shipEmpire === null || be === null || shipEmpire === be || shipEmpire === galaxy.independentEmpire || be === galaxy.independentEmpire) return false;
    if (isPirate(shipEmpire)) return pirateRelationType(shipEmpire, be) !== PirateRelationType.Protection;
    if (isPirate(be)) return pirateRelationType(shipEmpire, be) === PirateRelationType.None;
    return atWar(shipEmpire, be);
}

/** The system star of the system the ship is in (or null in deep space). */
function shipSystemStar(galaxy: Galaxy, ship: BuiltObject): Habitat | null {
    const s = ship.nearestSystemStar;
    if (s !== null) return s;
    const n = galaxy.fastFindNearestSystem(ship.xpos, ship.ypos);
    if (n === null) return null;
    const dx = ship.xpos - n.xpos;
    const dy = ship.ypos - n.ypos;
    return dx * dx + dy * dy < MAX_SOLAR_SYSTEM_SIZE * MAX_SOLAR_SYSTEM_SIZE ? n : null;
}

/** The interdicting bases in a system (habitat order, then base order). */
export function interdictingBasesInSystem(galaxy: Galaxy, systemIndex: number): BuiltObject[] {
    const out: BuiltObject[] = [];
    const sys = galaxy.systems[systemIndex];
    if (sys === undefined) return out;
    for (const h of sys.habitats) {
        const bases = h.basesAtHabitat;
        if (bases === null || bases === undefined) continue;
        for (let i = 0; i < bases.length; i++) if (isInterdictingBase(galaxy, bases[i])) out.push(bases[i]);
    }
    return out;
}

function inField(galaxy: Galaxy, base: BuiltObject, ship: BuiltObject): boolean {
    const r = interdictionRadius(galaxy, base);
    const dx = ship.xpos - base.xpos;
    const dy = ship.ypos - base.ypos;
    return dx * dx + dy * dy < r * r;
}

/** The hostile interdicting base whose field `ship` is in (the nearest), or null. Read-only. */
export function interdictingBaseFor(galaxy: Galaxy, ship: BuiltObject): BuiltObject | null {
    if (!jumpInterdictionOn(galaxy) || ship.role === BuiltObjectRole.Base || ship.hasBeenDestroyed) return null;
    const star = shipSystemStar(galaxy, ship);
    if (star === null) return null;
    let best: BuiltObject | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const b of interdictingBasesInSystem(galaxy, star.systemIndex)) {
        if (!interdictsEmpire(galaxy, b, ship.empire) || !inField(galaxy, b, ship)) continue;
        const d = Math.hypot(ship.xpos - b.xpos, ship.ypos - b.ypos);
        if (d < bestD) {
            bestD = d;
            best = b;
        }
    }
    return best;
}

function findSpool(st: InterdictionState, ship: BuiltObject): number {
    for (let i = 0; i < st.spools.length; i++) if (st.spools[i].ship === ship) return i;
    return -1;
}

/** cmdHyperTo's spool countdown (query hyperjumpCountdown; see the header). */
export function interdictedCountdown(galaxy: Galaxy, value: number, ship: BuiltObject, starDate: number, spoolStart: number, spoolMs: number): number {
    const factor = spoolFactor(galaxy);
    if (spoolMs >= 0) {
        // First execution: a new spool (a previous entry of this ship is stale).
        const prev = interdictionStateIfAny(galaxy);
        if (prev !== null && prev.spools.length > 0) {
            // Drop this ship's stale entry and every finished / abandoned spool.
            prev.spools = prev.spools.filter((e) => e.ship !== ship && !e.ship.hasBeenDestroyed && starDate < e.start + e.stock * factor);
        }
        const base = interdictingBaseFor(galaxy, ship);
        if (base === null) return value;
        const st = interdictionState(galaxy);
        st.spools.push({ ship, base, start: spoolStart, stock: spoolMs });
        st.stats.interdicted++;
        if (ship.empire !== null && isPirate(ship.empire)) st.stats.interdictedPirates++;
        return held(galaxy, ship, value, spoolStart + spoolMs * factor);
    }
    const st = interdictionStateIfAny(galaxy);
    if (st === null || st.spools.length === 0) return value;
    const i = findSpool(st, ship);
    if (i < 0) return value;
    const e = st.spools[i];
    const long = e.start + e.stock * factor;
    if (starDate >= long) {
        st.spools.splice(i, 1);
        return value;
    }
    let base: BuiltObject | null = e.base;
    if (!isInterdictingBase(galaxy, base) || !interdictsEmpire(galaxy, base, ship.empire) || !inField(galaxy, base, ship)) base = interdictingBaseFor(galaxy, ship);
    if (base !== null) {
        e.base = base;
        return held(galaxy, ship, value, long);
    }
    // Out of every field: the stock spool applies again.
    st.spools.splice(i, 1);
    st.stats.escaped++;
    if (value === long) {
        noteBuiltObjectEffect(galaxy, ship);
        return e.start + e.stock;
    }
    return value;
}

function held(galaxy: Galaxy, ship: BuiltObject, value: number, long: number): number {
    if (value >= long) return value;
    noteBuiltObjectEffect(galaxy, ship);
    return long;
}

/** The selection panel line for a ship in a hostile field / an interdicting base, or null. Read-only. */
export function interdictionInfoLine(galaxy: Galaxy, bo: BuiltObject): string | null {
    if (!jumpInterdictionOn(galaxy)) return null;
    if (bo.role === BuiltObjectRole.Base) return isInterdictingBase(galaxy, bo) ? `Interdiction field: ${Math.round(interdictionRadius(galaxy, bo))}` : null;
    if (bo.warpSpeed <= 0) return null;
    const base = interdictingBaseFor(galaxy, bo);
    if (base === null) return null;
    const f = spoolFactor(galaxy);
    return `Interdicted by ${base.name}: jump spool ${Number.isInteger(f) ? f : f.toFixed(1)}×`;
}

/** The interdiction ring of a selected base (render: a faint circle), or null. Read-only. */
export function interdictionRing(galaxy: Galaxy, bo: BuiltObject | null): { x: number; y: number; radius: number } | null {
    if (bo === null || !jumpInterdictionOn(galaxy) || !isInterdictingBase(galaxy, bo)) return null;
    return { x: bo.xpos, y: bo.ypos, radius: interdictionRadius(galaxy, bo) };
}

// ---------------------------------------------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------------------------------------------

/** The summed strength of the bases in `systemIndex` whose fields hold back `empire`'s ships. */
export function hostileInterdictionStrength(galaxy: Galaxy, empire: Empire, systemIndex: number): number {
    let s = 0;
    for (const b of interdictingBasesInSystem(galaxy, systemIndex)) if (interdictsEmpire(galaxy, b, empire)) s += calculateOverallStrengthFactor(b);
    return s;
}

/** A raid's required fleet strength with the target system's hostile fields (query raidRequiredStrength). */
export function raidStrengthWithInterdiction(galaxy: Galaxy, value: number, empire: Empire, habitat: Habitat): number {
    const s = hostileInterdictionStrength(galaxy, empire, habitat.systemIndex);
    if (s <= 0) return value;
    const need = s * scenarioParam(galaxy, 'interdictionAiRaidMargin', 1.5);
    if (need <= value) return value;
    interdictionState(galaxy).stats.raidsRaised++;
    return need;
}

/** The empires `empire` is at war with (its border's enemies; pirates are left out to keep the weight small). */
function hostileNeighbours(galaxy: Galaxy, empire: Empire): Empire[] {
    const out: Empire[] = [];
    for (const e of galaxy.empires) {
        if (e === empire || e === galaxy.independentEmpire || isPirate(e) || !e.active || e.colonies.length === 0) continue;
        if (atWar(empire, e)) out.push(e);
    }
    return out;
}

/**
 * The own colonies facing hostile territory: per war enemy, the own colony nearest any of its colonies. At most `max`, in hostile-list order, without one whose system already has an
 * interdicting base of ours.
 */
export function borderChokepoints(galaxy: Galaxy, empire: Empire, max: number): Habitat[] {
    const out: Habitat[] = [];
    if (max <= 0 || isPirate(empire) || empire.colonies.length < 2) return out;
    for (const e of hostileNeighbours(galaxy, empire)) {
        if (out.length >= max) break;
        const points: { x: number; y: number }[] = [];
        for (const c of e.colonies) points.push({ x: c.xpos, y: c.ypos });
        if (points.length === 0) continue;
        let best: Habitat | null = null;
        let bestD = Number.POSITIVE_INFINITY;
        for (const own of empire.colonies) {
            if (own === empire.capital || out.includes(own)) continue;
            for (const p of points) {
                const d = (own.xpos - p.x) * (own.xpos - p.x) + (own.ypos - p.y) * (own.ypos - p.y);
                if (d < bestD) {
                    bestD = d;
                    best = own;
                }
            }
        }
        if (best === null) continue;
        let guarded = false;
        for (const b of interdictingBasesInSystem(galaxy, best.systemIndex)) if (b.empire === empire) guarded = true;
        if (!guarded) out.push(best);
    }
    return out;
}

registerScenarioQuery({
    id: 'jumpInterdiction.countdown',
    flag: JUMP_INTERDICTION_FLAG,
    query: 'hyperjumpCountdown',
    run: (g, v, { ship, starDate, spoolStart, spoolMs }) => interdictedCountdown(g, v, ship, starDate, spoolStart, spoolMs),
});

registerScenarioQuery({
    id: 'jumpInterdiction.predict',
    flag: JUMP_INTERDICTION_FLAG,
    query: 'hyperjumpSpoolFactor',
    run: (g, v, { ship }) => (interdictingBaseFor(g, ship) !== null ? v * spoolFactor(g) : v),
});

registerScenarioQuery({
    id: 'jumpInterdiction.raids',
    flag: JUMP_INTERDICTION_FLAG,
    query: 'raidRequiredStrength',
    run: (g, v, { empire, habitat }) => raidStrengthWithInterdiction(g, v, empire, habitat),
});

registerScenarioEvent({
    id: 'jumpInterdiction.borderBases',
    flag: JUMP_INTERDICTION_FLAG,
    event: 'defensiveBaseLocations',
    run: (g, { empire, locations }) => {
        if (isHumanEmpire(g, empire)) return;
        const max = Math.trunc(scenarioParam(g, 'interdictionAiBorderBases', 1));
        for (const h of borderChokepoints(g, empire, max)) {
            if (locations.includes(h)) continue;
            locations.push(h);
            interdictionState(g).stats.borderBaseLocations++;
        }
    },
});
