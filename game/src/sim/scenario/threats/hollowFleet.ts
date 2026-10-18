// The Hollow Fleet (Galactic Threats add-on). Not a port: new scenario behaviour composed of ported functions.
// Registered from scenario/packages.ts; every handler is gated by the `threatHollowFleet` flag (and the threat
// framework's existence lottery), so with the flag off nothing here runs and nothing draws.
//
// A fleet of ancient automated warships wakes at a remote derelict anchorage (a free habitat in an uncolonised system
// far from every capital): a pirate-kind faction (createThreatFaction kind 'pirate', the anchorage is its pirate base)
// that is NOT a pirate - the pirateFactionPassive query switches off the pirate AI (raids, bids, extortion, trade,
// construction), as for the Dead Probe Swarm. This module drives it instead:
//   - strength: hollowFleetStrengthPct % of the median empire military firepower (militaryPotency) when it wakes, at
//     the galaxy's average tech level + hollowFleetTechBonus; no reinforcements, ever;
//   - the ROUTE: the anchorage plus hollowFleetRouteSystems systems chosen once from the Rnd at creation (spread out by
//     farthest-point sampling over the inhabited systems, capitals excluded), visited in a nearest-neighbour tour; each
//     stop has a linger time (Rnd) and a travel time (distance / hollowFleetTravelSpeed). The cycle (stay, travel, stay
//     ...) then repeats on that fixed schedule, with no Rnd: the stay at a stop starts and ends on fixed dates;
//   - it attacks only what is inside the system it is in (ships and bases; never planets), is never sent after
//     anything outside it, and its ships do not repair except at the anchorage once per cycle (repairRateFactor);
//   - the route is learned by sightings: an empire that sees the fleet in a system records that stop (arrive / leave
//     dates); a second sighting in a later cycle teaches it the cycle length, and so every known stop's next visit;
//   - destroying every ship ends it: a news report, a money bounty to the empire with most kills, a debris field with
//     Wreckage & Salvage on. No research rewards.
// AI: AI empires do not send civilian ships into a known stop during its (predicted) stay and do not park fleets
// there; an AI that is strong enough ambushes the fleet at a stop it knows (deterministic, once per stay).
//
// Rnd: only in hollowFleetWake (route pick, linger times) and the stock functions it calls (faction, design and ship
// generation). Periodic, sightings, targeting and the queries never draw. Fixed iteration orders: galaxy.systems by
// index, galaxy.empires order, the fleet's ships in push order.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Design } from '../../design';
import type { BuiltObject } from '../../builtObject';
import { HabitatCategoryType, type Habitat } from '../../types';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { ComponentStatus } from '../../builtObjectComponent';
import { EmpireMessageType } from '../../messages';
import { resolveStarDateDescription, startStarDateForAge } from '../../galaxyTime';
import { galaxyStarDate } from '../../tick/simTime';
import { generateNewBuiltObject } from '../../empireEvents';
import { generateDesignFromSpec } from '../../designGeneration';
import { galaxyDesignSpecificationBySubRole } from '../../gameStartTail';
import { takeOwnershipOfBuiltObject } from '../../combat/ownership';
import { calculateOverallStrengthFactorWithoutShields, militaryPotency } from '../../diplomacyTick';
import { isObjectVisibleToThisEmpireImprecise } from '../../independentTraders';
import { assignMission } from '../../missions/assign';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../../missions/mission';
import { generateDebrisField } from '../../story/storyStart';
import { isHumanEmpire } from '../../humanEmpires';
import { identifyPirateBase } from '../../characters';
import { registerGuardianPeace, GAME_DAY_LENGTH, gameYear, registerScenarioEvent, registerScenarioPeriodic, registerScenarioQuery } from '../hooks';
import { scenarioMessage, scenarioText } from '../messages';
import { scenarioFlag, scenarioParam } from '../state';
import { registerScenarioMapFeatures, type ScenarioMapFeatures } from '../mapFeatures';
import { empireTechLevel, maxDesignTechLevel, raiseFactionTech } from './robotMutiny';
import {
    KNOWLEDGE_CONFIRMED,
    arcNews,
    createThreatFaction,
    threatEmpires,
    pastThreatMinYear,
    peekThreatState,
    registerThreatExistence,
    registerThreatSpawn,
    registerThreatKnownSites,
    revealTo,
    threatExists,
    threatState,
    type KnownThreatSite,
    type SentStages,
    type ThreatKnowledge,
} from './framework';

export const HOLLOW_FLEET_KEY = 'hollowFleet';
export const HOLLOW_FLEET_FLAG = 'threatHollowFleet';
const TAG = 'HollowFleet';
const PERIOD_DAYS = 3;
/** Galaxy.MaxSolarSystemSize (resourceTargets.ts): a ship this close to a system's star is inside the system. */
const SYSTEM_RADIUS = 23000;
const MAX_TARGETS_PER_PERIOD = 12;
const ANCHORAGE_LINGER_DAYS = 30;
const ROUTE_COLOR = 0xc89050;
/** An AI ambush gathers ships from this far (world units) around the stop, if they can arrive before the fleet leaves. */
const AMBUSH_RANGE = 900000;
/** World units an AI fleet covers per day when judging whether an ambush gets there before the fleet leaves. */
const AMBUSH_SPEED = 16000;
const AMBUSH_MAX_SHIPS = 30;

/** One stop of the cycle. Index 0 is the anchorage. Plain data (saved). */
export interface HollowStop {
    systemIndex: number;
    x: number;
    y: number;
    /** Days the fleet stays. */
    linger: number;
    /** Days of travel INTO this stop from the previous one (stop 0: the return from the last stop). */
    travel: number;
}

/** What an empire has seen of one stop: the dates of the last observed stay. */
export interface HollowSighting {
    stop: number;
    arrive: number;
    leave: number;
    /** Cycle number of that stay (the second sighting of a stop in a later cycle teaches the cycle length). */
    cycleNo: number;
}

export interface HollowKnown {
    empireId: number;
    sightings: HollowSighting[];
    /** True once a stop was seen in two different cycles. */
    cycleKnown: boolean;
}

export interface HollowFleetYearRow {
    year: number;
    ships: number;
    losses: number;
    kills: number;
}

export interface HollowFleetState {
    phase: 'waiting' | 'active' | 'ended';
    faction: Empire | null;
    anchorage: Habitat | null;
    stops: HollowStop[];
    cycleDays: number;
    /** Star date the fleet first sat at the anchorage; stop 0's first stay begins here. */
    cycleStart: number;
    ships: BuiltObject[];
    /** The fleet's firepower when it woke. */
    startStrength: number;
    /** (stop, cycle) key of the last order wave, so each phase change re-issues the move once. */
    lastPhase: string;
    /** Cycle number the anchorage repair last ran in. */
    repairedCycle: number;
    /** Empire id -> ships and bases destroyed by it; and by the fleet. */
    killsBy: Record<string, number>;
    kills: number;
    losses: number;
    /** Ships / bases the fleet attacked (engagement orders). */
    engagements: number;
    ambushes: string[];
    bounty: number;
    bountyTo: Empire | null;
    endDate: number;
    lastLossX: number;
    lastLossY: number;
    history: HollowFleetYearRow[];
    sentStages: SentStages;
    /** ThreatSite knowledge (an empire that has seen it at all). */
    knowledge: ThreatKnowledge[];
    known: HollowKnown[];
}

function newState(): HollowFleetState {
    return {
        phase: 'waiting', faction: null, anchorage: null, stops: [], cycleDays: 0, cycleStart: 0, ships: [], startStrength: 0, lastPhase: '', repairedCycle: -1,
        killsBy: {}, kills: 0, losses: 0, engagements: 0, ambushes: [], bounty: 0, bountyTo: null, endDate: 0, lastLossX: 0, lastLossY: 0, history: [], sentStages: {},
        knowledge: [], known: [],
    };
}

export function hollowFleetState(galaxy: Galaxy): HollowFleetState {
    return threatState(galaxy, HOLLOW_FLEET_KEY, newState);
}

export function peekHollowFleetState(galaxy: Galaxy): HollowFleetState | null {
    return peekThreatState<HollowFleetState>(galaxy, HOLLOW_FLEET_KEY);
}

function p(galaxy: Galaxy, name: string, fallback: number): number {
    return scenarioParam(galaxy, name, fallback);
}
const P = {
    year: (g: Galaxy) => p(g, 'hollowFleetYear', 8),
    strengthPct: (g: Galaxy) => p(g, 'hollowFleetStrengthPct', 150),
    techBonus: (g: Galaxy) => Math.trunc(p(g, 'hollowFleetTechBonus', 1)),
    routeSystems: (g: Galaxy) => Math.max(5, Math.min(8, Math.trunc(p(g, 'hollowFleetRouteSystems', 6)))),
    lingerMin: (g: Galaxy) => Math.trunc(p(g, 'hollowFleetLingerMinDays', 20)),
    lingerMax: (g: Galaxy) => Math.trunc(p(g, 'hollowFleetLingerMaxDays', 60)),
    travelSpeed: (g: Galaxy) => Math.max(0, p(g, 'hollowFleetTravelSpeed', 0)),
    minShips: (g: Galaxy) => Math.trunc(p(g, 'hollowFleetMinShips', 4)),
    maxShips: (g: Galaxy) => Math.trunc(p(g, 'hollowFleetMaxShips', 30)),
    bounty: (g: Galaxy) => p(g, 'hollowFleetBounty', 150000),
    ambushPct: (g: Galaxy) => p(g, 'hollowFleetAmbushPct', 150),
    avoidDays: (g: Galaxy) => p(g, 'hollowFleetAvoidDays', 15),
};

const CYCLE = [BuiltObjectSubRole.Cruiser, BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.Frigate, BuiltObjectSubRole.Cruiser, BuiltObjectSubRole.CapitalShip, BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.Escort];
const SUBROLES = [...new Set(CYCLE)];

function yearsIn(galaxy: Galaxy): number {
    return gameYear(galaxyStarDate(galaxy)) - gameYear(startStarDateForAge(galaxy.age));
}

function alive(bo: BuiltObject | null, faction: Empire | null): bo is BuiltObject {
    return bo !== null && !bo.hasBeenDestroyed && faction !== null && bo.actualEmpire === faction;
}

// ---------------------------------------------------------------------------------------------------------------
// Schedule (pure)
// ---------------------------------------------------------------------------------------------------------------

/** Day offset (from the cycle's start) at which the fleet arrives at stop `i`. Pure. */
export function stopArriveOffset(st: HollowFleetState, i: number): number {
    let d = 0;
    for (let j = 0; j < i; j++) d += st.stops[j].linger + st.stops[j + 1].travel;
    return d;
}

export type HollowPhase = { kind: 'stay'; stop: number; cycle: number } | { kind: 'travel'; to: number; cycle: number };

/** Where the schedule has the fleet at star date `date`. Pure. */
export function hollowFleetPhaseAt(st: HollowFleetState, date: number): HollowPhase | null {
    if (st.stops.length === 0 || st.cycleDays <= 0 || date < st.cycleStart) return null;
    const days = (date - st.cycleStart) / GAME_DAY_LENGTH;
    const cycle = Math.floor(days / st.cycleDays);
    const d = days - cycle * st.cycleDays;
    for (let i = 0; i < st.stops.length; i++) {
        const a = stopArriveOffset(st, i);
        if (d >= a && d < a + st.stops[i].linger) return { kind: 'stay', stop: i, cycle };
    }
    for (let i = st.stops.length - 1; i >= 0; i--) if (d >= stopArriveOffset(st, i)) return { kind: 'travel', to: (i + 1) % st.stops.length, cycle };
    return { kind: 'travel', to: 0, cycle };
}

/** The star-date window of stop `i`'s stay in cycle `cycle`. Pure. */
export function hollowFleetWindow(st: HollowFleetState, i: number, cycle: number): { arrive: number; leave: number } {
    const a = st.cycleStart + (cycle * st.cycleDays + stopArriveOffset(st, i)) * GAME_DAY_LENGTH;
    return { arrive: a, leave: a + st.stops[i].linger * GAME_DAY_LENGTH };
}

function knownOf(st: HollowFleetState, empire: Empire | null): HollowKnown | null {
    if (empire === null) return null;
    return st.known.find((k) => k.empireId === empire.empireId) ?? null;
}

/** The stays of a known stop an empire can plan around, from `from` on: one observed stay, or (cycle known) every later cycle. Pure. */
export function knownWindows(st: HollowFleetState, k: HollowKnown, s: HollowSighting, from: number, count: number): { arrive: number; leave: number }[] {
    const out: { arrive: number; leave: number }[] = [];
    if (!k.cycleKnown) {
        if (s.leave > from) out.push({ arrive: s.arrive, leave: s.leave });
        return out;
    }
    const span = st.cycleDays * GAME_DAY_LENGTH;
    const n0 = Math.max(0, Math.ceil((from - s.leave) / span));
    for (let n = n0; out.length < count; n++) out.push({ arrive: s.arrive + n * span, leave: s.leave + n * span });
    return out;
}

/** The next stay an empire expects, over its known stops (null: it knows none or cannot predict). Pure. */
export function hollowFleetExpected(st: HollowFleetState, empire: Empire, from: number): { stop: HollowStop; stopIndex: number; arrive: number; leave: number } | null {
    const k = knownOf(st, empire);
    if (k === null) return null;
    let best: { stopIndex: number; arrive: number; leave: number } | null = null;
    for (const s of k.sightings) {
        const w = knownWindows(st, k, s, from, 1)[0];
        if (w === undefined) continue;
        if (best === null || w.arrive < best.arrive || (w.arrive === best.arrive && s.stop < best.stopIndex)) best = { stopIndex: s.stop, arrive: w.arrive, leave: w.leave };
    }
    return best === null ? null : { stop: st.stops[best.stopIndex], stopIndex: best.stopIndex, arrive: best.arrive, leave: best.leave };
}

// ---------------------------------------------------------------------------------------------------------------
// Waking: anchorage, route, schedule, ships
// ---------------------------------------------------------------------------------------------------------------

function siteFree(h: Habitat): boolean {
    return !h.hasBeenDestroyed && h.empire === null && h.population.totalAmount <= 0 && (h.basesAtHabitat == null || h.basesAtHabitat.length === 0);
}

function colonisedSystems(galaxy: Galaxy): Set<number> {
    const out = new Set<number>();
    for (const e of threatEmpires(galaxy)) for (const c of e.colonies) out.add(c.systemIndex);
    return out;
}

function systemPos(galaxy: Galaxy, systemIndex: number): { x: number; y: number } {
    const s = galaxy.systems[systemIndex].systemStar;
    return { x: s.xpos, y: s.ypos };
}

/** The anchorage: a free asteroid / planet / moon in an uncolonised system, the farthest from every capital. Pure. */
export function hollowFleetAnchorage(galaxy: Galaxy, near: Empire | null = null): Habitat | null {
    const capitals = (near !== null && near.capital !== null ? [near.capital] : threatEmpires(galaxy).map((e) => e.capital)).filter((c): c is Habitat => c !== null);
    const colonised = colonisedSystems(galaxy);
    let best: Habitat | null = null;
    let bestD = near !== null ? -Infinity : -1;
    let bestPref = -1;
    const seen = new Set<number>();
    for (const h of galaxy.habitats) {
        if (h === null || colonised.has(h.systemIndex) || !siteFree(h)) continue;
        const pref = h.category === HabitatCategoryType.Asteroid ? 2 : h.category === HabitatCategoryType.Planet ? 1 : h.category === HabitatCategoryType.Moon ? 0 : -1;
        if (pref < 0) continue;
        if (seen.has(h.systemIndex) && pref <= 0) continue;
        seen.add(h.systemIndex);
        const star = galaxy.systems[h.systemIndex].systemStar;
        let d = Number.MAX_VALUE;
        for (const c of capitals) d = Math.min(d, galaxy.calculateDistance(star.xpos, star.ypos, c.xpos, c.ypos));
        if (near !== null) d = -d; // Game Editor: the nearest to `near`'s capital instead of the farthest
        if (d > bestD || (d === bestD && pref > bestPref)) {
            bestD = d;
            bestPref = pref;
            best = h;
        }
    }
    return best;
}

/**
 * The route's systems (system indices): `count` of them chosen by farthest-point sampling over the inhabited systems
 * (capital systems excluded), starting from `firstPick`; short of inhabited systems it falls back on the uncolonised
 * systems nearest to a colony. Pure (the caller supplies the one Rnd pick).
 */
export function hollowFleetRouteSystems(galaxy: Galaxy, anchorageSystem: number, count: number, firstPick: number): number[] {
    const capitalSystems = new Set<number>();
    for (const e of threatEmpires(galaxy)) if (e.capital !== null) capitalSystems.add(e.capital.systemIndex);
    const inhabited = [...colonisedSystems(galaxy)].filter((s) => !capitalSystems.has(s) && s !== anchorageSystem).sort((a, b) => a - b);
    const cands = [...inhabited];
    if (cands.length < count) {
        const cols: { x: number; y: number }[] = [...colonisedSystems(galaxy)].sort((a, b) => a - b).map((s) => systemPos(galaxy, s));
        const rest: { s: number; d: number }[] = [];
        for (let s = 0; s < galaxy.systems.length; s++) {
            if (cands.includes(s) || s === anchorageSystem || capitalSystems.has(s)) continue;
            const pos = systemPos(galaxy, s);
            let d = Number.MAX_VALUE;
            for (const c of cols) d = Math.min(d, galaxy.calculateDistance(pos.x, pos.y, c.x, c.y));
            rest.push({ s, d });
        }
        rest.sort((a, b) => a.d - b.d || a.s - b.s);
        for (const r of rest) {
            if (cands.length >= count) break;
            cands.push(r.s);
        }
    }
    if (cands.length === 0) return [];
    const picked: number[] = [cands[Math.abs(firstPick) % cands.length]];
    while (picked.length < Math.min(count, cands.length)) {
        let best = -1;
        let bestD = -1;
        for (const s of cands) {
            if (picked.includes(s)) continue;
            const pos = systemPos(galaxy, s);
            let d = Number.MAX_VALUE;
            for (const q of picked) {
                const o = systemPos(galaxy, q);
                d = Math.min(d, galaxy.calculateDistance(pos.x, pos.y, o.x, o.y));
            }
            if (d > bestD) {
                bestD = d;
                best = s;
            }
        }
        if (best < 0) break;
        picked.push(best);
    }
    return picked;
}

/** Nearest-neighbour tour over `systems` starting from the anchorage. Pure. */
function tourOrder(galaxy: Galaxy, anchorageSystem: number, systems: readonly number[]): number[] {
    const left = [...systems];
    const out: number[] = [];
    let cur = systemPos(galaxy, anchorageSystem);
    while (left.length > 0) {
        let bi = 0;
        let bd = Number.MAX_VALUE;
        for (let i = 0; i < left.length; i++) {
            const o = systemPos(galaxy, left[i]);
            const d = galaxy.calculateDistance(cur.x, cur.y, o.x, o.y);
            if (d < bd) {
                bd = d;
                bi = i;
            }
        }
        const next = left.splice(bi, 1)[0];
        out.push(next);
        cur = systemPos(galaxy, next);
    }
    return out;
}

function median(values: number[]): number {
    if (values.length === 0) return 0;
    const v = [...values].sort((a, b) => a - b);
    const m = v.length >> 1;
    return v.length % 2 === 1 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function fleetDesigns(galaxy: Galaxy, faction: Empire, lvl: number): Map<BuiltObjectSubRole, Design> {
    raiseFactionTech(galaxy, faction, lvl);
    const now = galaxyStarDate(galaxy);
    const out = new Map<BuiltObjectSubRole, Design>();
    for (const sub of SUBROLES) {
        const spec = faction.designSpecifications.find((s) => s !== null && s.subRole === sub) ?? galaxyDesignSpecificationBySubRole(sub);
        let d: Design | null = null;
        if (spec !== null && spec !== undefined) {
            try {
                d = generateDesignFromSpec(galaxy, faction, spec, lvl, now);
            } catch {
                d = null;
            }
        }
        if (d === null) d = faction.designs.filter((x) => x.subRole === sub).at(-1) ?? null;
        if (d === null) continue;
        if (!faction.designs.includes(d)) faction.designs.push(d);
        out.set(sub, d);
    }
    return out;
}

function spawnShip(galaxy: Galaxy, faction: Empire, design: Design, x: number, y: number): BuiltObject {
    const pt = galaxy.selectRelativeParkingPoint();
    const bo = generateNewBuiltObject(galaxy, faction, design, null, x + pt.x, y + pt.y);
    takeOwnershipOfBuiltObject(galaxy, faction, bo, faction, false);
    bo.supportCostFactor = 0; // the old drives need no upkeep
    return bo;
}

/** Wakes the fleet at `anchorage` (tests force it). Returns false when no faction or route could be made. Draws Rnd. */
export function hollowFleetWake(galaxy: Galaxy, st: HollowFleetState, anchorage: Habitat): boolean {
    const normals = threatEmpires(galaxy);
    if (normals.length === 0) return false;
    const race = galaxy.races.find((r) => r !== null && r.name === 'Mechanoid') ?? galaxy.races.find((r) => r !== null) ?? null;
    if (race === null) return false;
    const avg = normals.reduce((s, e) => s + empireTechLevel(e), 0) / normals.length;
    const max = maxDesignTechLevel(galaxy);
    let lvl = Math.round(avg) + P.techBonus(galaxy);
    if (max > 0) lvl = Math.min(lvl, max);
    lvl = Math.max(1, lvl);
    // RND(hollow fleet): the route's first pick and every stop's linger time; fixed from here on.
    const pick = galaxy.rnd.next(0, 1_000_000);
    const systems = tourOrder(galaxy, anchorage.systemIndex, hollowFleetRouteSystems(galaxy, anchorage.systemIndex, P.routeSystems(galaxy), pick));
    if (systems.length === 0) return false;
    const faction = createThreatFaction(galaxy, { kind: 'pirate', race, name: scenarioText(`${TAG} Faction Name`), home: anchorage, techLevel: lvl });
    if (faction === null) return false;
    const order = [anchorage.systemIndex, ...systems];
    const lo = Math.min(P.lingerMin(galaxy), P.lingerMax(galaxy));
    const hi = Math.max(P.lingerMin(galaxy), P.lingerMax(galaxy));
    const stops: HollowStop[] = order.map((si, i) => {
        const pos = systemPos(galaxy, si);
        const linger = i === 0 ? ANCHORAGE_LINGER_DAYS : lo + galaxy.rnd.next(0, hi - lo + 1);
        return { systemIndex: si, x: pos.x, y: pos.y, linger, travel: 0 };
    });
    st.faction = faction;
    st.anchorage = anchorage;
    st.stops = stops;
    st.cycleStart = galaxyStarDate(galaxy);
    const base = identifyPirateBase(faction);
    if (base !== null) {
        base.name = scenarioText(`${TAG} Anchorage Name`);
        base.supportCostFactor = 0;
    }
    // The fleet: warship designs in a fixed cycle until the wanted firepower (a share of the median empire's) is reached.
    const designs = fleetDesigns(galaxy, faction, lvl);
    const cycle = CYCLE.filter((s) => designs.has(s));
    const want = (median(normals.map((e) => militaryPotency(e))) * P.strengthPct(galaxy)) / 100;
    let strength = 0;
    for (let i = 0; cycle.length > 0 && i < P.maxShips(galaxy) && (strength < want || i < P.minShips(galaxy)); i++) {
        const bo = spawnShip(galaxy, faction, designs.get(cycle[i % cycle.length])!, stops[0].x, stops[0].y);
        st.ships.push(bo);
        strength += calculateOverallStrengthFactorWithoutShields(bo);
    }
    if (st.ships.length === 0) return false;
    // Travel times: the leg length over the fleet's slowest hyperdrive (units per day; measured sailing runs ~15% faster, so it
    // is never late). hollowFleetTravelSpeed > 0 overrides it.
    const speed = P.travelSpeed(galaxy) > 0 ? P.travelSpeed(galaxy) : Math.max(1, Math.min(...st.ships.map((b) => b.warpSpeed > 0 ? b.warpSpeed : Number.MAX_VALUE)));
    stops.forEach((stop, i) => {
        const prev = stops[(i + stops.length - 1) % stops.length];
        stop.travel = Math.max(2, Math.ceil(galaxy.calculateDistance(prev.x, prev.y, stop.x, stop.y) / speed));
    });
    st.cycleDays = stops.reduce((sum, x) => sum + x.linger + x.travel, 0);
    st.startStrength = strength;
    st.phase = 'active';
    return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Driving the fleet
// ---------------------------------------------------------------------------------------------------------------

function isIdle(bo: BuiltObject): boolean {
    const m = builtObjectMission(bo.mission);
    return m === null || m.type === BuiltObjectMissionType.Undefined || m.type === BuiltObjectMissionType.Hold;
}

/** A fixed berth around a stop for ship `i` (no Rnd). */
function berth(stop: HollowStop, i: number): { x: number; y: number } {
    const a = i * 2.399963;
    const r = 2500 + 600 * (i % 7);
    return { x: stop.x + Math.cos(a) * r, y: stop.y + Math.sin(a) * r };
}

function moveShip(galaxy: Galaxy, st: HollowFleetState, bo: BuiltObject, i: number, stop: HollowStop): void {
    const pt = berth(stop, i);
    assignMission(galaxy, bo, BuiltObjectMissionType.Move, null, null, BuiltObjectMissionPriority.High, { x: pt.x, y: pt.y, manuallyAssigned: true });
}

function inSystem(galaxy: Galaxy, bo: BuiltObject, stop: HollowStop): boolean {
    return galaxy.calculateDistance(bo.xpos, bo.ypos, stop.x, stop.y) <= SYSTEM_RADIUS;
}

function drive(galaxy: Galaxy, st: HollowFleetState, phase: HollowPhase): void {
    const target = st.stops[phase.kind === 'stay' ? phase.stop : phase.to];
    const key = `${phase.kind}:${phase.kind === 'stay' ? phase.stop : phase.to}:${phase.cycle}`;
    const wave = key !== st.lastPhase;
    st.lastPhase = key;
    st.ships.forEach((bo, i) => {
        const m = builtObjectMission(bo.mission);
        const there = inSystem(galaxy, bo, target);
        if (phase.kind === 'stay' && there && !wave) {
            // An engagement outside the system is called off: the fleet never chases beyond it.
            if (m !== null && m.type === BuiltObjectMissionType.Attack && m.targetBuiltObject !== null && !m.targetBuiltObject.hasBeenDestroyed && !inSystem(galaxy, m.targetBuiltObject, target)) moveShip(galaxy, st, bo, i, target);
            else if (isIdle(bo) && galaxy.calculateDistance(bo.xpos, bo.ypos, berth(target, i).x, berth(target, i).y) > 6000) moveShip(galaxy, st, bo, i, target);
            return;
        }
        if (wave || isIdle(bo)) moveShip(galaxy, st, bo, i, target);
        else if (m !== null && m.type === BuiltObjectMissionType.Attack && m.targetBuiltObject !== null && !m.targetBuiltObject.hasBeenDestroyed && !inSystem(galaxy, bo, target)) moveShip(galaxy, st, bo, i, target);
    });
}

/** Everything of another owner inside the stop's system that the fleet may attack: ships and bases (never planets). */
function intruders(galaxy: Galaxy, st: HollowFleetState, stop: HollowStop): BuiltObject[] {
    const faction = st.faction!;
    const out: BuiltObject[] = [];
    for (const e of [...galaxy.empires, ...galaxy.pirateEmpires]) {
        if (e === null || e === faction || !e.active) continue;
        for (const list of [e.builtObjects, e.privateBuiltObjects]) {
            for (const b of list) {
                if (b.hasBeenDestroyed) continue;
                if (galaxy.calculateDistance(b.xpos, b.ypos, stop.x, stop.y) > SYSTEM_RADIUS) continue;
                out.push(b);
                if (out.length >= MAX_TARGETS_PER_PERIOD) return out;
            }
        }
    }
    return out;
}

function engage(galaxy: Galaxy, st: HollowFleetState, stop: HollowStop): void {
    const targets = intruders(galaxy, st, stop);
    if (targets.length === 0) return;
    const free = st.ships.filter((s) => {
        if (!inSystem(galaxy, s, stop)) return false;
        const m = builtObjectMission(s.mission);
        return m === null || m.type !== BuiltObjectMissionType.Attack || m.targetBuiltObject === null || m.targetBuiltObject.hasBeenDestroyed;
    });
    for (const target of targets) {
        for (let k = 0; k < 2 && free.length > 0; k++) {
            let bi = 0;
            let bd = Number.MAX_VALUE;
            for (let i = 0; i < free.length; i++) {
                const d = galaxy.calculateDistance(free[i].xpos, free[i].ypos, target.xpos, target.ypos);
                if (d < bd) {
                    bd = d;
                    bi = i;
                }
            }
            const s = free.splice(bi, 1)[0];
            assignMission(galaxy, s, BuiltObjectMissionType.Attack, target, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
        }
        st.engagements++;
    }
}

/** The anchorage's once-a-cycle refit: components restored, shields full. */
function repairAtAnchorage(galaxy: Galaxy, st: HollowFleetState, cycle: number): void {
    if (st.repairedCycle === cycle) return;
    st.repairedCycle = cycle;
    for (const bo of st.ships) {
        if (!inSystem(galaxy, bo, st.stops[0])) continue;
        for (const c of bo.components.items) if (c.status === ComponentStatus.Damaged) c.status = ComponentStatus.Normal;
        bo.reDefine();
        bo.currentShields = bo.shieldsCapacity;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Sightings (route knowledge)
// ---------------------------------------------------------------------------------------------------------------

export function hollowFleetObserve(galaxy: Galaxy, st: HollowFleetState, empire: Empire, stop: number, cycle: number): void {
    let k = knownOf(st, empire);
    if (k === null) {
        k = { empireId: empire.empireId, sightings: [], cycleKnown: false };
        st.known.push(k);
    }
    const w = hollowFleetWindow(st, stop, cycle);
    const human = isHumanEmpire(galaxy, empire);
    const old = k.sightings.find((s) => s.stop === stop);
    if (old !== undefined) {
        if (old.cycleNo === cycle) return;
        k.cycleKnown = true;
        old.arrive = w.arrive;
        old.leave = w.leave;
        old.cycleNo = cycle;
        return;
    }
    k.sightings.push({ stop, arrive: w.arrive, leave: w.leave, cycleNo: cycle });
    k.sightings.sort((a, b) => a.stop - b.stop);
    // Three stops make the pattern plain: a route that visits them in turn repeats, so the cycle is known.
    if (k.sightings.length >= 3) k.cycleKnown = true;
    const first = revealTo(galaxy, st, empire, KNOWLEDGE_CONFIRMED);
    if (!human) return;
    const name = galaxy.systems[st.stops[stop].systemIndex].systemStar.name;
    const subject = galaxy.systems[st.stops[stop].systemIndex].systemStar;
    scenarioMessage(
        galaxy,
        empire,
        scenarioText(first ? `${TAG} Sighted Title` : `${TAG} Route Title`),
        scenarioText(first ? `${TAG} Sighted` : `${TAG} Route`, name, resolveStarDateDescription(w.leave), k.sightings.length),
        { type: EmpireMessageType.GeneralWarning, subject, popup: false },
    );
}

function sightings(galaxy: Galaxy, st: HollowFleetState, phase: HollowPhase): void {
    if (phase.kind !== 'stay') return;
    const stop = st.stops[phase.stop];
    const here = st.ships.filter((b) => inSystem(galaxy, b, stop));
    if (here.length === 0) return;
    for (const e of threatEmpires(galaxy)) {
        let seen = false;
        for (const b of here) {
            if (isObjectVisibleToThisEmpireImprecise(galaxy, e, b)) {
                seen = true;
                break;
            }
        }
        if (seen) hollowFleetObserve(galaxy, st, e, phase.stop, phase.cycle);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// AI: avoidance and ambush
// ---------------------------------------------------------------------------------------------------------------

/** True when `empire` knows the fleet is (or is predicted to be) in system `systemIndex` between `now` and `now + margin`. Pure. */
export function hollowFleetDanger(galaxy: Galaxy, st: HollowFleetState, empire: Empire, systemIndex: number, now: number, marginDays: number): boolean {
    const k = knownOf(st, empire);
    if (k === null) return false;
    const end = now + marginDays * GAME_DAY_LENGTH;
    for (const s of k.sightings) {
        if (st.stops[s.stop].systemIndex !== systemIndex) continue;
        const w = knownWindows(st, k, s, now, 1)[0];
        if (w !== undefined && w.arrive <= end) return true;
    }
    return false;
}

/** The system a mission aims at (a habitat, a built object, or a point within a route system), or -1. Pure. */
function missionSystem(galaxy: Galaxy, st: HollowFleetState, target: unknown, x: number, y: number): number {
    const t = target as { systemIndex?: number; nearestSystemStar?: { systemIndex: number } | null } | null;
    if (t !== null && typeof t === 'object') {
        if (typeof t.systemIndex === 'number') return t.systemIndex;
        if (t.nearestSystemStar != null) return t.nearestSystemStar.systemIndex;
    }
    if (x > -2000000000 && y > -2000000000) {
        for (const s of st.stops) if (galaxy.calculateDistance(x, y, s.x, s.y) <= SYSTEM_RADIUS) return s.systemIndex;
    }
    return -1;
}

// (a function, not a module-level Set: this module can load inside an import cycle before the mission enum exists)
function ambushAllowed(missionType: number): boolean {
    return missionType === BuiltObjectMissionType.Attack || missionType === BuiltObjectMissionType.Escape || missionType === BuiltObjectMissionType.Retire || missionType === BuiltObjectMissionType.Retrofit || missionType === BuiltObjectMissionType.Repair || missionType === BuiltObjectMissionType.Refuel;
}

function missionAllowed(galaxy: Galaxy, value: boolean, bo: BuiltObject, missionType: number, target: unknown, x: number, y: number): boolean {
    if (!value) return false;
    const st = peekHollowFleetState(galaxy);
    if (st === null || st.phase !== 'active' || st.known.length === 0) return true;
    const empire = bo.actualEmpire;
    if (empire === null || empire === st.faction || isHumanEmpire(galaxy, empire) || bo.role === BuiltObjectRole.Base) return true;
    if (ambushAllowed(missionType)) return true;
    const sys = missionSystem(galaxy, st, target, x, y);
    if (sys < 0) return true;
    return !hollowFleetDanger(galaxy, st, empire, sys, galaxyStarDate(galaxy), P.avoidDays(galaxy));
}

function currentStrength(st: HollowFleetState): number {
    let s = 0;
    for (const b of st.ships) if (!b.hasBeenDestroyed) s += calculateOverallStrengthFactorWithoutShields(b);
    return s;
}

/** A strong AI that knows the stop sends idle warships against the fleet, once per stay. Deterministic. */
function ambush(galaxy: Galaxy, st: HollowFleetState, phase: HollowPhase): void {
    if (phase.kind !== 'stay' || phase.stop === 0) return;
    const stop = st.stops[phase.stop];
    const need = (currentStrength(st) * P.ambushPct(galaxy)) / 100;
    const target = st.ships.find((b) => !b.hasBeenDestroyed && inSystem(galaxy, b, stop)) ?? null;
    if (target === null) return;
    for (const e of threatEmpires(galaxy)) {
        if (isHumanEmpire(galaxy, e)) continue;
        const key = `${e.empireId}:${phase.stop}:${phase.cycle}`;
        if (st.ambushes.includes(key)) continue;
        if (!hollowFleetDanger(galaxy, st, e, stop.systemIndex, galaxyStarDate(galaxy), 0)) continue;
        const daysLeft = (hollowFleetWindow(st, phase.stop, phase.cycle).leave - galaxyStarDate(galaxy)) / GAME_DAY_LENGTH;
        if (daysLeft <= 0) continue;
        const pool: { b: BuiltObject; d: number }[] = [];
        for (const b of e.builtObjects) {
            if (b.hasBeenDestroyed || b.role !== BuiltObjectRole.Military || b.topSpeed <= 0 || !isIdle(b)) continue;
            const d = galaxy.calculateDistance(b.xpos, b.ypos, stop.x, stop.y);
            if (d <= AMBUSH_RANGE && d / AMBUSH_SPEED <= daysLeft) pool.push({ b, d });
        }
        pool.sort((a, b) => a.d - b.d || a.b.builtObjectID - b.b.builtObjectID);
        const chosen: BuiltObject[] = [];
        let sum = 0;
        for (const q of pool) {
            if (chosen.length >= AMBUSH_MAX_SHIPS || sum >= need) break;
            chosen.push(q.b);
            sum += calculateOverallStrengthFactorWithoutShields(q.b);
        }
        if (sum < need || chosen.length === 0) continue;
        st.ambushes.push(key);
        for (const b of chosen) assignMission(galaxy, b, BuiltObjectMissionType.Attack, target, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
    }
}

// ---------------------------------------------------------------------------------------------------------------
// End, kills, bounty
// ---------------------------------------------------------------------------------------------------------------

function finish(galaxy: Galaxy, st: HollowFleetState): void {
    st.phase = 'ended';
    st.endDate = galaxyStarDate(galaxy);
    let top: Empire | null = null;
    let best = 0;
    for (const e of threatEmpires(galaxy)) {
        const n = st.killsBy[String(e.empireId)] ?? 0;
        if (n > best) {
            best = n;
            top = e;
        }
    }
    const bounty = P.bounty(galaxy);
    if (top !== null && bounty > 0) {
        top.stateMoney += bounty;
        st.bounty = bounty;
        st.bountyTo = top;
        if (isHumanEmpire(galaxy, top)) scenarioMessage(galaxy, top, scenarioText(`${TAG} Bounty Title`), scenarioText(`${TAG} Bounty`, Math.round(bounty).toLocaleString('en-US')), { type: EmpireMessageType.GeneralGoodEvent, popup: false });
    }
    if (scenarioFlag(galaxy, 'wreckage')) generateDebrisField(galaxy, st.lastLossX, st.lastLossY, scenarioText(`${TAG} Wreck Field`), 12);
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Ended', textTag: `${TAG} Ended News`, args: [top !== null ? `, most of them by ${top.name}` : ''] });
}

function onKilledBy(galaxy: Galaxy, bo: BuiltObject, destroyer: Empire | null): void {
    const st = peekHollowFleetState(galaxy);
    if (st === null || st.faction === null || st.phase === 'ended') return;
    if (bo.actualEmpire === st.faction) {
        if (bo.role === BuiltObjectRole.Base) return;
        st.losses++;
        st.lastLossX = bo.xpos;
        st.lastLossY = bo.ypos;
        if (destroyer !== null && destroyer !== st.faction) st.killsBy[String(destroyer.empireId)] = (st.killsBy[String(destroyer.empireId)] ?? 0) + 1;
    } else if (destroyer === st.faction) st.kills++;
}

// ---------------------------------------------------------------------------------------------------------------
// Periodic driver
// ---------------------------------------------------------------------------------------------------------------

/** A fleet that sails faster than the schedule and is already in the next stop's system is at that stop (its stay is nominal-dated). */
function effectivePhase(galaxy: Galaxy, st: HollowFleetState, phase: HollowPhase): HollowPhase {
    if (phase.kind !== 'travel') return phase;
    const stop = st.stops[phase.to];
    if (!st.ships.some((b) => inSystem(galaxy, b, stop))) return phase;
    return { kind: 'stay', stop: phase.to, cycle: phase.to === 0 ? phase.cycle + 1 : phase.cycle };
}

export function hollowFleetPeriodic(galaxy: Galaxy): void {
    if (!threatExists(galaxy, HOLLOW_FLEET_KEY)) return; // §0 rarity: not this game - no state, no draws.
    const st = hollowFleetState(galaxy);
    if (st.phase === 'ended') return;
    if (st.phase === 'waiting') {
        if (yearsIn(galaxy) < P.year(galaxy) || !pastThreatMinYear(galaxy, HOLLOW_FLEET_KEY)) return;
        const home = hollowFleetAnchorage(galaxy);
        if (home === null || !hollowFleetWake(galaxy, st, home)) st.phase = 'ended';
        return;
    }
    const faction = st.faction;
    st.ships = st.ships.filter((b) => alive(b, faction));
    if (faction === null || !faction.active || st.ships.length === 0) {
        finish(galaxy, st);
        return;
    }
    const now = galaxyStarDate(galaxy);
    const sched = hollowFleetPhaseAt(st, now);
    if (sched === null) return;
    const phase = effectivePhase(galaxy, st, sched);
    drive(galaxy, st, phase);
    if (phase.kind === 'stay') {
        engage(galaxy, st, st.stops[phase.stop]);
        if (phase.stop === 0) repairAtAnchorage(galaxy, st, phase.cycle);
    }
    sightings(galaxy, st, phase);
    ambush(galaxy, st, phase);
    const y = yearsIn(galaxy);
    if (st.history.length === 0 || st.history[st.history.length - 1].year < y) st.history.push({ year: y, ships: st.ships.length, losses: st.losses, kills: st.kills });
}

// ---------------------------------------------------------------------------------------------------------------
// UI (read-only): the Threats & Leads row and the known route on the map
// ---------------------------------------------------------------------------------------------------------------

function stopName(galaxy: Galaxy, st: HollowFleetState, i: number): string {
    return galaxy.systems[st.stops[i].systemIndex].systemStar.name;
}

export function hollowFleetKnownSites(galaxy: Galaxy, empire: Empire): KnownThreatSite[] {
    const st = peekHollowFleetState(galaxy);
    if (st === null || st.phase !== 'active') return [];
    const k = knownOf(st, empire);
    if (k === null || k.sightings.length === 0) return [];
    const now = galaxyStarDate(galaxy);
    const next = hollowFleetExpected(st, empire, now);
    let label = scenarioText(`${TAG} Site Row`);
    let status = scenarioText(`${TAG} Status Known`, k.sightings.length, k.sightings.map((s) => stopName(galaxy, st, s.stop)).join(', '));
    let target: Habitat = galaxy.systems[st.stops[k.sightings[0].stop].systemIndex].systemStar;
    if (next !== null) {
        target = galaxy.systems[next.stop.systemIndex].systemStar;
        const present = next.arrive <= now;
        label = present ? scenarioText(`${TAG} Site Row Present`, target.name) : scenarioText(`${TAG} Site Row Expected`, target.name, resolveStarDateDescription(next.arrive));
        status = scenarioText(`${TAG} Status Expected`, k.sightings.length, resolveStarDateDescription(next.arrive), resolveStarDateDescription(next.leave));
    } else {
        const last = k.sightings.reduce((a, b) => (b.arrive > a.arrive ? b : a));
        target = galaxy.systems[st.stops[last.stop].systemIndex].systemStar;
        label = scenarioText(`${TAG} Site Row Seen`, target.name, resolveStarDateDescription(last.arrive));
    }
    return [{ threat: HOLLOW_FLEET_KEY, kind: 'colony', target, level: KNOWLEDGE_CONFIRMED, site: st, label, status }];
}

/** The part of the route `viewer` knows (consecutive known stops joined), drawn faint and dashed; a marker at the next expected stop. */
export function hollowFleetMapFeatures(galaxy: Galaxy, viewer: Empire | null): ScenarioMapFeatures | null {
    const st = peekHollowFleetState(galaxy);
    if (st === null || st.phase !== 'active' || viewer === null) return null;
    const k = knownOf(st, viewer);
    if (k === null || k.sightings.length === 0) return null;
    const known = new Set(k.sightings.map((s) => s.stop));
    const n = st.stops.length;
    const routes: ScenarioMapFeatures['routes'] = [];
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        if (!known.has(i) || !known.has(j) || n < 2) continue;
        routes.push({ points: [{ x: st.stops[i].x, y: st.stops[i].y }, { x: st.stops[j].x, y: st.stops[j].y }], color: ROUTE_COLOR, activeLeg: -1 });
    }
    const markers: ScenarioMapFeatures['markers'] = [];
    const next = hollowFleetExpected(st, viewer, galaxyStarDate(galaxy));
    if (next !== null) markers.push({ x: next.stop.x, y: next.stop.y, label: scenarioText(`${TAG} Map Label`, resolveStarDateDescription(next.arrive)), color: ROUTE_COLOR });
    return { markers, routes };
}

// ---------------------------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------------------------

function isFleet(galaxy: Galaxy, e: Empire | null): boolean {
    const st = peekHollowFleetState(galaxy);
    return st !== null && e !== null && st.faction === e;
}

export const HOLLOW_FLEET_HANDLER_IDS = ['hollowFleet.periodic', 'hollowFleet.killedBy', 'hollowFleet.passive', 'hollowFleet.noProtection', 'hollowFleet.noCapture', 'hollowFleet.noRepair', 'hollowFleet.avoid'] as const;

/** Game Editor: null when the Hollow Fleet can wake now. Pure. */
export function hollowFleetSpawnNote(galaxy: Galaxy): string | null {
    const st = peekHollowFleetState(galaxy);
    return st === null || st.phase === 'waiting' ? null : st.phase === 'active' ? 'Already awake' : 'Already over';
}

/** Game Editor: the fleet wakes now at the free anchorage nearest the player. */
export function hollowFleetSpawnNow(galaxy: Galaxy, victim: Empire): boolean {
    const st = hollowFleetState(galaxy);
    if (st.phase !== 'waiting') return false;
    const home = hollowFleetAnchorage(galaxy, victim);
    return home !== null && hollowFleetWake(galaxy, st, home);
}

export function registerHollowFleet(): void {
    registerThreatExistence(HOLLOW_FLEET_KEY, HOLLOW_FLEET_FLAG);
    registerGuardianPeace(HOLLOW_FLEET_KEY, HOLLOW_FLEET_FLAG, (g) => [peekHollowFleetState(g)?.faction]); // the Ancient Guardians and this threat never fight
    registerThreatSpawn({ key: HOLLOW_FLEET_KEY, label: 'The Hollow Fleet', group: 'galactic', addons: ['hollow-fleet'], note: hollowFleetSpawnNote, spawn: hollowFleetSpawnNow });
    registerScenarioPeriodic({ id: 'hollowFleet.periodic', flag: HOLLOW_FLEET_FLAG, periodDays: PERIOD_DAYS, order: 15, run: (g) => hollowFleetPeriodic(g) });
    registerScenarioEvent({ id: 'hollowFleet.killedBy', flag: HOLLOW_FLEET_FLAG, event: 'builtObjectKilledBy', run: (g, e) => onKilledBy(g, e.builtObject, e.destroyer) });
    registerScenarioQuery({ id: 'hollowFleet.passive', flag: HOLLOW_FLEET_FLAG, query: 'pirateFactionPassive', run: (g, v, a) => v || isFleet(g, a.empire) });
    registerScenarioQuery({ id: 'hollowFleet.noProtection', flag: HOLLOW_FLEET_FLAG, query: 'pirateProtectionDesired', run: (g, v, a) => v && !isFleet(g, a.pirate) });
    registerScenarioQuery({ id: 'hollowFleet.noCapture', flag: HOLLOW_FLEET_FLAG, query: 'combatCaptureAllowed', run: (g, v, a) => v && !isFleet(g, a.capturingEmpire) });
    registerScenarioQuery({ id: 'hollowFleet.noRepair', flag: HOLLOW_FLEET_FLAG, query: 'repairRateFactor', run: (g, v, a) => (isFleet(g, a.builtObject.actualEmpire) ? v * 1e-9 : v) });
    registerScenarioQuery({ id: 'hollowFleet.avoid', flag: HOLLOW_FLEET_FLAG, query: 'assignMissionAllowed', run: (g, v, a) => missionAllowed(g, v, a.builtObject, a.missionType, a.target, a.x, a.y) });
    registerThreatKnownSites(HOLLOW_FLEET_KEY, hollowFleetKnownSites);
    registerScenarioMapFeatures('hollowFleet', hollowFleetMapFeatures);
}

registerHollowFleet();
