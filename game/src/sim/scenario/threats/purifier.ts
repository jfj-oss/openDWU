// The Purifier (Galactic Threats add-on). Not a port: new scenario behaviour composed of ported functions. Registered
// from scenario/packages.ts; every handler is gated by the `threatPurifier` flag (and the threat framework's existence
// lottery), so with the flag off nothing here runs and nothing draws.
//
// A mid-game "Hunt for the Bismarck": an ancient planet destroyer and a close escort lie dormant at a remote anchorage
// (a free habitat in an uncolonised system, far out). When an empire's ship comes to the anchorage (or, at the latest,
// purifierWakeYears later, the nearest empire's, or the player's when the start option "guarantee this threat" is on) the
// Purifier wakes. A pirate-kind faction (createThreatFaction kind 'pirate', the anchorage is its pirate base: the repair
// dock) that is NOT a pirate (pirateFactionPassive switches the pirate AI off, as for the Hollow Fleet and the Dead Probe
// Swarm). Nobody controls it; this module drives it:
//   - the DESTROYER is the stock planet destroyer (designGeneration.ts generatePlanetDestroyerDesign, Galaxy.7.cs 4862:
//     isPlanetDestroyer, the Attack mission on a colony -> firePlanetDestroyerAtHabitat -> destroyHabitat, canDestroyHabitat
//     diameter <= 400). Infinite fuel, and it resupplies its escorts (their fuel is refilled each period while they are near);
//   - the ESCORT follows it closely: the stock Escort mission on the destroyer (the escort hyperjumps after its target and
//     keeps station), at tech purifierTechBonus levels above the galaxy's average, firepower purifierEscortPct % of the mean
//     of the three strongest empires' military (militaryPotency, as Generation Ships scales);
//   - TARGET PROGRAMMING (50/50, one roll at the wake): PREPROGRAMMED (a builders' race family picked at random; it hunts
//     every other family) or the WAKER CHOOSES one family (the player: a scenario decision pop-up; an AI: the family of its
//     strongest rival, an empire it is at war with first). It destroys colonies (any owner) whose largest population is of
//     a hunted family. With no such colony for purifierRetargetYears it retargets the nearest populous family on its own;
//   - RAIDER: it strikes one colony (Attack mission), then jumps away to deep space (an empty system far from every colony)
//     and hides; one strike per purifierStrikeDays at most (the pacing tuned by soaks), never against a colony whose
//     defenders out-gun it, and it retreats when out-gunned (purifierOutgunnedRatio x its group's firepower, the Fighting
//     retreats ratio, fightingRetreats.ts shipFirepower);
//   - LOST CONTACT: an empire knows it only by the stock fog (isObjectVisibleToThisEmpire) and by long-range scanners that
//     detect a hyperjump; each empire keeps its last known position. SHADOWING: while any hunting empire sees it, every
//     hunter gets the sighting. AI hunters send idle warships to the last known system (Patrol, as Generation Ships'
//     commitDefence) or Attack it when in view, once their sent force is purifierHunterRatio x its firepower;
//   - RUDDER HIT: each newly damaged component of the destroyer has purifierRudderPct % to hit its hyperdrive: every hit makes
//     each jump purifierRudderSpool x longer (the hyperjumpSpoolFactor query); the group cannot repair in the field
//     (repairRateFactor ~0). RUN FOR PORT: damaged past purifierPortDamagePct % it sails home to the anchorage; if it arrives
//     and the dock still stands, purifierRepairDays later everything is repaired and it breaks out again;
//   - REPUTATION is light: the stock -20 per planet lands on the faction itself (destroyHabitat charges self.empire), nobody
//     else. The waker takes a one-time -purifierWakerRep civility when exposed (first sighted by another empire, or
//     purifierExposeYears after the wake); then the victims' regard for it drops a little (purifierVictimRep). No war.
//   - the end: destroyer killed -> news, killing-blow empire gets purifierBounty money and +purifierKillerRep civility (every
//     other empire thinks the better of it, as the Void Whale's slayer). No research rewards.
// Map: one medium diamond glyph per viewing empire (live position when in view, a dim hollow one at the last spotted place).
//
// Rnd: only purifierWake (program roll, builders' family, faction / design / ship creation) and the rudder rolls draw
// galaxy.rnd. Everything else is deterministic: fixed iteration orders (galaxy.habitats, galaxy.systems by index,
// galaxy.empires order, the group in push order).

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Design } from '../../design';
import type { BuiltObject } from '../../builtObject';
import type { Habitat } from '../../types';
import type { Race } from '../../data/races';
import { HabitatCategoryType } from '../../types';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { ComponentStatus } from '../../builtObjectComponent';
import { EmpireMessageType } from '../../messages';
import { YEAR_LENGTH, resolveStarDateDescription, startStarDateForAge } from '../../galaxyTime';
import { galaxyStarDate } from '../../tick/simTime';
import { generateNewBuiltObject } from '../../empireEvents';
import { generateDesignFromSpec, generatePlanetDestroyerDesign } from '../../designGeneration';
import { galaxyDesignSpecificationBySubRole } from '../../gameStartTail';
import { takeOwnershipOfBuiltObject } from '../../combat/ownership';
import { builtObjectCompleteTeardown } from '../../combat/teardown';
import { canDestroyHabitat } from '../../combat/attackAI';
import { calculateOverallStrengthFactorWithoutShields, militaryPotency } from '../../diplomacyTick';
import { isObjectVisibleToThisEmpire } from '../../independentTraders';
import { assignMission } from '../../missions/assign';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../../missions/mission';
import { empireShipGroups, shipGroupAssignMission } from '../../fleets/shipGroup';
import { identifyPirateBase } from '../../characters';
import { isHumanEmpire } from '../../humanEmpires';
import { GAME_DAY_LENGTH, gameYear, registerScenarioEvent, registerScenarioFramePeriodic, registerScenarioQuery } from '../hooks';
import { scenarioMessage, scenarioText } from '../messages';
import { scenarioParam } from '../state';
import { registerScenarioMapFeatures, type ScenarioMapFeatures } from '../mapFeatures';
import { registerScenarioDecision, raiseScenarioDecision, type ScenarioDecision } from '../decisions';
import { applyReputation } from '../reputation/ledger';
import { shipFirepower } from '../fightingRetreats/fightingRetreats';
import { empireTechLevel, maxDesignTechLevel, raiseFactionTech } from './robotMutiny';
import {
    KNOWLEDGE_CONFIRMED,
    arcNews,
    knowledgeLevel,
    createThreatFaction,
    forcedThreatVictim,
    normalEmpires,
    pastThreatMinYear,
    peekThreatState,
    registerThreatExistence,
    registerThreatKnownSites,
    revealTo,
    threatExists,
    threatState,
    type KnownThreatSite,
    type SentStages,
    type ThreatKnowledge,
} from './framework';
import { peekHollowFleetState } from './hollowFleet';

export const PURIFIER_KEY = 'purifier';
export const PURIFIER_FLAG = 'threatPurifier';
const TAG = 'Purifier';
const DECISION_KIND = 'purifier.target';
const PERIOD_DAYS = 2;
/** Galaxy.MaxSolarSystemSize (resourceTargets.ts): a ship this close to a system's star is inside the system. */
const SYSTEM_RADIUS = 23000;
/** A move of at least this in one period is a hyperjump. */
const JUMP_MIN = 60000;
/** An escort within this of the destroyer is resupplied from it. */
const RESUPPLY_RANGE = 60000;
/** Enemies within this of the group count when judging whether it is out-gunned. */
const THREAT_RANGE = 45000;
const DEFENCE_RANGE = 30000;
const MAX_CANDIDATES = 15;
const MARKER_COLOR = 0xd04a3a;
const YEAR_DAYS = 360;

export type PurifierMode = 'awaiting' | 'breakout' | 'hide' | 'approach' | 'flee' | 'port' | 'repair';

/** One empire's last known position of the Purifier (plain data, saved). */
export interface PurifierSighting {
    empireId: number;
    x: number;
    y: number;
    systemIndex: number;
    date: number;
    /** Star date of the last message sent to this empire (human empires). */
    lastMessage: number;
}

export interface PurifierYearRow {
    year: number;
    worlds: number;
    escorts: number;
    mode: PurifierMode;
    damagePct: number;
}

export interface PurifierState {
    phase: 'waiting' | 'dormant' | 'awake' | 'ended';
    anchorage: Habitat | null;
    /** Star date the anchorage was chosen (the dormancy timer). */
    openDate: number;
    faction: Empire | null;
    destroyer: BuiltObject | null;
    escorts: BuiltObject[];
    /** The station's own defenders (they sit at the dock). */
    guards: BuiltObject[];
    /** The ancient repair station as a hidden site: which empires know where it is. */
    dockKnowledge: ThreatKnowledge[];
    dockX: number;
    dockY: number;
    waker: Empire | null;
    wakeDate: number;
    program: 'preprogrammed' | 'waker' | null;
    builderFamily: number;
    /** True: hunts every family but builderFamily. False: hunts `hunted`. */
    huntOthers: boolean;
    hunted: number[];
    mode: PurifierMode;
    modeDate: number;
    target: Habitat | null;
    /** Colonies it could not reach (hyperdrive denial, defences): skipped until the date. */
    skip: { habitat: Habitat; until: number }[];
    /** Approach progress: the best distance to the target and the date it improved. */
    progDist: number;
    progDate: number;
    /** The hiding place (a system star). */
    hideSpot: Habitat | null;
    hideDate: number;
    nextStrikeDate: number;
    /** Star date it last had no colony of a hunted family to hunt (0: it has one). */
    noTargetSince: number;
    retargets: number;
    worlds: number;
    /** Every habitat destroyed (moons too). */
    bodies: number;
    victims: Empire[];
    rudderHits: number;
    lastDamaged: number;
    lastX: number;
    lastY: number;
    sightings: PurifierSighting[];
    /** Empire ids that see it right now (refreshed each period). */
    visibleTo: number[];
    engaged: boolean;
    exposed: boolean;
    exposeDate: number;
    portTrips: number;
    repairs: number;
    startStrength: number;
    killsBy: Record<string, number>;
    kills: number;
    losses: number;
    killer: Empire | null;
    bounty: number;
    endDate: number;
    lastScan: number;
    lastDispatch: number;
    decisionPending: boolean;
    history: PurifierYearRow[];
    sentStages: SentStages;
    knowledge: ThreatKnowledge[];
}

function newState(): PurifierState {
    return {
        phase: 'waiting', anchorage: null, openDate: 0, faction: null, destroyer: null, escorts: [], guards: [], dockKnowledge: [], dockX: 0, dockY: 0, waker: null, wakeDate: 0, program: null, builderFamily: -1, huntOthers: false,
        hunted: [], mode: 'breakout', modeDate: 0, target: null, skip: [], progDist: 0, progDate: 0, hideSpot: null, hideDate: 0, nextStrikeDate: 0, noTargetSince: 0, retargets: 0, worlds: 0, bodies: 0, victims: [],
        rudderHits: 0, lastDamaged: 0, lastX: 0, lastY: 0, sightings: [], visibleTo: [], engaged: false, exposed: false, exposeDate: 0, portTrips: 0, repairs: 0, startStrength: 0,
        killsBy: {}, kills: 0, losses: 0, killer: null, bounty: 0, endDate: 0, lastScan: 0, lastDispatch: 0, decisionPending: false, history: [], sentStages: {}, knowledge: [],
    };
}

export function purifierState(galaxy: Galaxy): PurifierState {
    return threatState(galaxy, PURIFIER_KEY, newState);
}

export function peekPurifierState(galaxy: Galaxy): PurifierState | null {
    return peekThreatState<PurifierState>(galaxy, PURIFIER_KEY);
}

function p(galaxy: Galaxy, name: string, fallback: number): number {
    return scenarioParam(galaxy, name, fallback);
}
const P = {
    year: (g: Galaxy) => p(g, 'purifierYear', 25),
    wakeYears: (g: Galaxy) => p(g, 'purifierWakeYears', 12),
    techBonus: (g: Galaxy) => Math.trunc(p(g, 'purifierTechBonus', 1)),
    escortPct: (g: Galaxy) => p(g, 'purifierEscortPct', 90),
    minEscorts: (g: Galaxy) => Math.trunc(p(g, 'purifierMinEscorts', 5)),
    maxEscorts: (g: Galaxy) => Math.trunc(p(g, 'purifierMaxEscorts', 40)),
    waker50: (g: Galaxy) => p(g, 'purifierWakerChoosesPct', 50),
    strikeDays: (g: Galaxy) => p(g, 'purifierStrikeDays', 120),
    outgunned: (g: Galaxy) => Math.max(0.1, p(g, 'purifierOutgunnedRatio', 1.5)),
    hunterRatio: (g: Galaxy) => Math.max(0.1, p(g, 'purifierHunterRatio', 0.8)),
    hideHopDays: (g: Galaxy) => p(g, 'purifierHideHopDays', 90),
    retargetYears: (g: Galaxy) => p(g, 'purifierRetargetYears', 1.5),
    rudderPct: (g: Galaxy) => p(g, 'purifierRudderPct', 8),
    rudderSpool: (g: Galaxy) => p(g, 'purifierRudderSpool', 0.5),
    portDamagePct: (g: Galaxy) => p(g, 'purifierPortDamagePct', 35),
    repairDays: (g: Galaxy) => p(g, 'purifierRepairDays', 90),
    exposeYears: (g: Galaxy) => p(g, 'purifierExposeYears', 3),
    wakerRep: (g: Galaxy) => p(g, 'purifierWakerRep', 5),
    victimRep: (g: Galaxy) => p(g, 'purifierVictimRep', 8),
    killerRep: (g: Galaxy) => p(g, 'purifierKillerRep', 5),
    bounty: (g: Galaxy) => p(g, 'purifierBounty', 400000),
    memoryDays: (g: Galaxy) => p(g, 'purifierMemoryDays', 540),
};

function yearsIn(galaxy: Galaxy): number {
    return gameYear(galaxyStarDate(galaxy)) - gameYear(startStarDateForAge(galaxy.age));
}

function aliveShip(bo: BuiltObject | null, faction: Empire | null): bo is BuiltObject {
    return bo !== null && !bo.hasBeenDestroyed && faction !== null && bo.actualEmpire === faction;
}

function day(galaxy: Galaxy): number {
    return galaxyStarDate(galaxy) / GAME_DAY_LENGTH;
}

function star(galaxy: Galaxy, systemIndex: number): Habitat {
    return galaxy.systems[systemIndex].systemStar;
}

function nearestSystemIndex(galaxy: Galaxy, x: number, y: number): number {
    let best = 0;
    let bd = Number.MAX_VALUE;
    for (let i = 0; i < galaxy.systems.length; i++) {
        const s = galaxy.systems[i].systemStar;
        const d = galaxy.calculateDistance(x, y, s.xpos, s.ypos);
        if (d < bd) {
            bd = d;
            best = i;
        }
    }
    return best;
}

function familyOf(h: Habitat): number {
    const r = h.population?.dominantRace ?? null;
    return r === null ? -1 : r.raceFamily;
}

/** True when a colony whose largest population is of `family` is hunted. Pure. */
export function purifierHunts(st: PurifierState, family: number): boolean {
    if (family < 0) return false;
    return st.huntOthers ? family !== st.builderFamily : st.hunted.includes(family);
}

function populated(h: Habitat | null): h is Habitat {
    return h !== null && !h.hasBeenDestroyed && h.empire !== null && h.population !== null && h.population.totalAmount > 0;
}

/** Every populated colony the Purifier hunts and its weapon can destroy (galaxy.habitats order). Pure. */
export function purifierTargets(galaxy: Galaxy, st: PurifierState): Habitat[] {
    const out: Habitat[] = [];
    const d = st.destroyer;
    if (d === null) return out;
    const now = galaxyStarDate(galaxy);
    for (const h of galaxy.habitats) {
        if (!populated(h) || h.empire === st.faction) continue;
        if (st.skip.some((q) => q.habitat === h && q.until > now)) continue;
        if (!purifierHunts(st, familyOf(h)) || !canDestroyHabitat(galaxy, d, h)) continue;
        out.push(h);
    }
    return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The anchorage and the dormant site
// ---------------------------------------------------------------------------------------------------------------

function siteFree(h: Habitat): boolean {
    return !h.hasBeenDestroyed && h.empire === null && h.population.totalAmount <= 0 && (h.basesAtHabitat == null || h.basesAtHabitat.length === 0);
}

/**
 * The anchorage: a free gas cloud (a stock GasCloud habitat in a nebula, deep space) remote from every colony (about the 10% most
 * remote clouds, so explorers do find it in time); without any free cloud, a free asteroid / planet / moon in an uncolonised
 * system. The ancient repair station is built there when it wakes. Never the Hollow Fleet's. Pure.
 */
export function purifierAnchorage(galaxy: Galaxy): Habitat | null {
    const colonised = new Set<number>();
    const cols: { x: number; y: number }[] = [];
    for (const e of normalEmpires(galaxy)) {
        for (const c of e.colonies) {
            if (!colonised.has(c.systemIndex)) {
                colonised.add(c.systemIndex);
                const s = star(galaxy, c.systemIndex);
                cols.push({ x: s.xpos, y: s.ypos });
            }
        }
    }
    const hollow = peekHollowFleetState(galaxy);
    const pick = (cloud: boolean): Habitat | null => {
        const cands: { h: Habitat; d: number }[] = [];
        const seen = new Set<number>();
        for (const h of galaxy.habitats) {
            if (h === null || h.hasBeenDestroyed || h.empire !== null || (h.basesAtHabitat != null && h.basesAtHabitat.length > 0)) continue;
            if (cloud) {
                if (h.category !== HabitatCategoryType.GasCloud) continue;
            } else {
                if (h.category !== HabitatCategoryType.Asteroid && h.category !== HabitatCategoryType.Planet && h.category !== HabitatCategoryType.Moon) continue;
                if (colonised.has(h.systemIndex) || !siteFree(h) || seen.has(h.systemIndex)) continue;
                seen.add(h.systemIndex);
            }
            if (hollow !== null && hollow.anchorage !== null && galaxy.calculateDistance(h.xpos, h.ypos, hollow.anchorage.xpos, hollow.anchorage.ypos) < 60000) continue;
            let d = Number.MAX_VALUE;
            for (const c of cols) d = Math.min(d, galaxy.calculateDistance(h.xpos, h.ypos, c.x, c.y));
            cands.push({ h, d });
        }
        if (cands.length === 0) return null;
        cands.sort((a, b) => b.d - a.d || a.h.habitatIndex - b.h.habitatIndex);
        return cands[Math.min(cands.length - 1, Math.floor(cands.length * 0.1))].h;
    };
    return pick(true) ?? pick(false);
}

/** An empire's ship at the anchorage's system wakes it: the first (empire order, ship order) such ship's empire. Pure. */
function finderOf(galaxy: Galaxy, st: PurifierState): Empire | null {
    const s = st.anchorage!;
    const reach = Math.max(SYSTEM_RADIUS, s.diameter);
    for (const e of normalEmpires(galaxy)) {
        for (const list of [e.builtObjects, e.privateBuiltObjects]) {
            for (const b of list) {
                if (b.hasBeenDestroyed || b.role === BuiltObjectRole.Base) continue;
                if (galaxy.calculateDistance(b.xpos, b.ypos, s.xpos, s.ypos) <= reach) return e;
            }
        }
    }
    return null;
}

/** The empire that stumbles on it when none has found it by purifierWakeYears: the forced victim, else the nearest capital. Pure. */
function fallbackWaker(galaxy: Galaxy, st: PurifierState): Empire | null {
    const forced = forcedThreatVictim(galaxy, PURIFIER_KEY);
    if (forced !== null) return forced;
    const s = st.anchorage!;
    let best: Empire | null = null;
    let bd = Number.MAX_VALUE;
    for (const e of normalEmpires(galaxy)) {
        if (e.capital === null) continue;
        const d = galaxy.calculateDistance(s.xpos, s.ypos, e.capital.xpos, e.capital.ypos);
        if (d < bd) {
            bd = d;
            best = e;
        }
    }
    return best;
}

// ---------------------------------------------------------------------------------------------------------------
// Waking
// ---------------------------------------------------------------------------------------------------------------

function median3(values: number[]): number {
    const v = [...values].sort((a, b) => b - a).slice(0, 3);
    return v.length === 0 ? 0 : v.reduce((s, x) => s + x, 0) / v.length;
}

function groupDesigns(galaxy: Galaxy, faction: Empire, lvl: number): { destroyer: Design | null; escorts: Design[] } {
    raiseFactionTech(galaxy, faction, lvl);
    const now = galaxyStarDate(galaxy);
    const destroyer = generatePlanetDestroyerDesign(galaxy, 1.0, faction, now);
    faction.designs.push(destroyer);
    const escorts: Design[] = [];
    for (const sub of [BuiltObjectSubRole.Cruiser, BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.Frigate, BuiltObjectSubRole.Cruiser, BuiltObjectSubRole.CapitalShip, BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.Escort]) {
        const spec = faction.designSpecifications.find((s) => s !== null && s.subRole === sub) ?? galaxyDesignSpecificationBySubRole(sub);
        let d: Design | null = null;
        if (spec !== null && spec !== undefined) {
            try {
                d = generateDesignFromSpec(galaxy, faction, spec, lvl, now);
            } catch {
                d = null;
            }
        }
        if (d === null) d = faction.designs.filter((x) => x.subRole === sub && !x.isPlanetDestroyer).at(-1) ?? null;
        if (d === null) continue;
        if (!faction.designs.includes(d)) faction.designs.push(d);
        escorts.push(d);
    }
    return { destroyer, escorts };
}

function spawn(galaxy: Galaxy, faction: Empire, design: Design, x: number, y: number): BuiltObject {
    const pt = galaxy.selectRelativeParkingPoint();
    const bo = generateNewBuiltObject(galaxy, faction, design, null, x + pt.x, y + pt.y);
    takeOwnershipOfBuiltObject(galaxy, faction, bo, faction, false);
    bo.supportCostFactor = 0;
    return bo;
}

function familiesPresent(galaxy: Galaxy): number[] {
    const set = new Set<number>();
    for (const e of normalEmpires(galaxy)) for (const c of e.colonies) {
        const f = familyOf(c);
        if (f >= 0) set.add(f);
    }
    return [...set].sort((a, b) => a - b);
}

function raceOfFamily(galaxy: Galaxy, family: number): Race | null {
    return galaxy.races.find((r) => r !== null && r.raceFamily === family) ?? null;
}

/**
 * Wakes the Purifier at the anchorage for `waker` (tests force it). Returns false when no faction / ship could be made.
 * Draws Rnd: the 50/50 program roll, the builders' family (preprogrammed) and the stock faction / design / ship generation.
 */
export function purifierWake(galaxy: Galaxy, st: PurifierState, waker: Empire | null): boolean {
    const anchorage = st.anchorage;
    const normals = normalEmpires(galaxy);
    if (anchorage === null || normals.length === 0) return false;
    const fams = familiesPresent(galaxy);
    // RND(purifier wake): the program (preprogrammed / the waker chooses), then the builders' family.
    const wakerChooses = galaxy.rnd.nextDouble() * 100 < P.waker50(galaxy);
    let builder = -1;
    if (!wakerChooses && fams.length >= 2) builder = fams[galaxy.rnd.next(0, fams.length)];
    const race = (builder >= 0 ? raceOfFamily(galaxy, builder) : null) ?? galaxy.races.find((r) => r !== null && r.name === 'Mechanoid') ?? galaxy.races.find((r) => r !== null) ?? null;
    if (race === null) return false;
    const avg = normals.reduce((s, e) => s + empireTechLevel(e), 0) / normals.length;
    const max = maxDesignTechLevel(galaxy);
    let lvl = Math.round(avg) + P.techBonus(galaxy);
    if (max > 0) lvl = Math.min(lvl, max);
    lvl = Math.max(1, lvl);
    const faction = createThreatFaction(galaxy, { kind: 'pirate', race, name: scenarioText(`${TAG} Faction Name`), home: anchorage, techLevel: lvl });
    if (faction === null) return false;
    const base = identifyPirateBase(faction);
    if (base !== null) {
        base.name = scenarioText(`${TAG} Dock Name`);
        base.supportCostFactor = 0;
    }
    const designs = groupDesigns(galaxy, faction, lvl);
    const pos = anchorage;
    const destroyer = designs.destroyer === null ? null : spawn(galaxy, faction, designs.destroyer, pos.xpos, pos.ypos);
    if (destroyer === null || !destroyer.isPlanetDestroyer) {
        if (destroyer !== null) builtObjectCompleteTeardown(galaxy, destroyer);
        return false;
    }
    st.faction = faction;
    st.destroyer = destroyer;
    destroyer.currentFuel = destroyer.fuelCapacity;
    let strength = calculateOverallStrengthFactorWithoutShields(destroyer);
    const want = (median3(normals.map((e) => militaryPotency(e))) * P.escortPct(galaxy)) / 100;
    for (let i = 0; designs.escorts.length > 0 && i < P.maxEscorts(galaxy) && (strength < want || i < P.minEscorts(galaxy)); i++) {
        const bo = spawn(galaxy, faction, designs.escorts[i % designs.escorts.length], pos.xpos, pos.ypos);
        st.escorts.push(bo);
        strength += calculateOverallStrengthFactorWithoutShields(bo);
    }
    // The station's own defenders: a modest guard that sits at the dock (the Purifier's group is not the only thing to beat there).
    const guardWant = (want * p(galaxy, 'purifierGuardPct', 35)) / 100;
    let gs = 0;
    for (let i = 0; designs.escorts.length > 0 && i < 12 && gs < guardWant; i++) {
        const bo = spawn(galaxy, faction, designs.escorts[(i + 2) % designs.escorts.length], pos.xpos, pos.ypos);
        st.guards.push(bo);
        gs += calculateOverallStrengthFactorWithoutShields(bo);
    }
    st.dockX = pos.xpos;
    st.dockY = pos.ypos;
    if (waker !== null) revealTo(galaxy, { knowledge: st.dockKnowledge }, waker, KNOWLEDGE_CONFIRMED); // its ship is there: it sees the station
    st.startStrength = strength;
    st.waker = waker;
    st.wakeDate = galaxyStarDate(galaxy);
    st.program = wakerChooses ? 'waker' : 'preprogrammed';
    st.builderFamily = builder;
    st.huntOthers = !wakerChooses;
    st.hunted = [];
    st.lastX = destroyer.xpos;
    st.lastY = destroyer.ypos;
    st.phase = 'awake';
    st.mode = 'breakout';
    st.modeDate = st.wakeDate;
    st.nextStrikeDate = st.wakeDate;
    st.lastDamaged = destroyer.damagedComponentCount;
    if (wakerChooses) chooseFamily(galaxy, st, waker);
    return true;
}

/** An AI's pick: the family of its strongest rival (an empire at war with it first). Pure. */
export function aiPickFamily(galaxy: Galaxy, waker: Empire | null): number {
    const own = waker?.dominantRace?.raceFamily ?? -1;
    const rivals = normalEmpires(galaxy, waker).filter((e) => e.dominantRace !== null);
    const atWarWith = (e: Empire): boolean => waker !== null && waker.diplomaticRelations.byEmpire(e)?.type === 3;
    rivals.sort((a, b) => Number(atWarWith(b)) - Number(atWarWith(a)) || militaryPotency(b) - militaryPotency(a) || a.empireId - b.empireId);
    for (const e of rivals) if (e.dominantRace!.raceFamily !== own) return e.dominantRace!.raceFamily;
    return rivals.length > 0 ? rivals[0].dominantRace!.raceFamily : own;
}

function familyName(galaxy: Galaxy, id: number): string {
    return galaxy.raceFamilies.find((f) => f !== null && f.raceFamilyId === id)?.name ?? `family ${id}`;
}

/** The waker chooses the family: the player by a scenario decision, an AI at once. */
function chooseFamily(galaxy: Galaxy, st: PurifierState, waker: Empire | null): void {
    const fams = familiesPresent(galaxy);
    const rival = aiPickFamily(galaxy, waker);
    if (waker === null || !isHumanEmpire(galaxy, waker) || fams.length === 0) {
        st.hunted = [rival];
        return;
    }
    st.mode = 'awaiting';
    st.decisionPending = true;
    raiseScenarioDecision(galaxy, waker, {
        kind: DECISION_KIND,
        title: scenarioText(`${TAG} Choice Title`),
        text: scenarioText(`${TAG} Choice`, st.anchorage!.name),
        options: fams.map((f) => ({ id: `fam:${f}`, label: scenarioText(`${TAG} Option`, familyName(galaxy, f)) })),
        defaultOption: `fam:${fams.includes(rival) ? rival : fams[0]}`,
        expiresDays: 90,
        context: {},
    });
}

function resolveChoice(galaxy: Galaxy, _d: ScenarioDecision, optionId: string): void {
    const st = peekPurifierState(galaxy);
    if (st === null || !st.decisionPending) return;
    st.decisionPending = false;
    const f = Number(optionId.slice(4));
    st.hunted = [Number.isFinite(f) ? f : -1];
    st.mode = 'breakout';
    st.modeDate = galaxyStarDate(galaxy);
}

// ---------------------------------------------------------------------------------------------------------------
// Group helpers
// ---------------------------------------------------------------------------------------------------------------

function group(st: PurifierState): BuiltObject[] {
    const out: BuiltObject[] = [];
    if (st.destroyer !== null && !st.destroyer.hasBeenDestroyed) out.push(st.destroyer);
    for (const b of st.escorts) if (!b.hasBeenDestroyed) out.push(b);
    return out;
}

function groupFirepower(st: PurifierState): number {
    let s = 0;
    for (const b of group(st)) s += shipFirepower(b);
    return s;
}

function groupStrength(st: PurifierState): number {
    let s = 0;
    for (const b of group(st)) s += calculateOverallStrengthFactorWithoutShields(b);
    return s;
}

/** Share of the destroyer's components that are damaged (0..1). Pure. */
export function purifierDamage(st: PurifierState): number {
    const d = st.destroyer;
    if (d === null || d.components.items.length === 0) return 0;
    return d.damagedComponentCount / d.components.items.length;
}

function isIdle(bo: BuiltObject): boolean {
    const m = builtObjectMission(bo.mission);
    return m === null || m.type === BuiltObjectMissionType.Undefined || m.type === BuiltObjectMissionType.Hold;
}

function sendTo(galaxy: Galaxy, bo: BuiltObject, where: Habitat): void {
    const m = builtObjectMission(bo.mission);
    if (m !== null && m.type === BuiltObjectMissionType.Move && m.targetHabitat === where) return;
    assignMission(galaxy, bo, BuiltObjectMissionType.Move, where, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
}

function resupply(st: PurifierState): void {
    const d = st.destroyer;
    if (d === null) return;
    d.currentFuel = d.fuelCapacity; // infinite fuel
    for (const b of st.escorts) {
        if (b.hasBeenDestroyed || b.fuelCapacity <= 0) continue;
        const dx = b.xpos - d.xpos;
        const dy = b.ypos - d.ypos;
        if (dx * dx + dy * dy <= RESUPPLY_RANGE * RESUPPLY_RANGE) b.currentFuel = b.fuelCapacity; // the destroyer is the resupply point
    }
}

function escortOrders(galaxy: Galaxy, st: PurifierState): void {
    const d = st.destroyer;
    if (d === null) return;
    for (const b of st.escorts) {
        if (b.hasBeenDestroyed) continue;
        const m = builtObjectMission(b.mission);
        if (m !== null && m.type === BuiltObjectMissionType.Escort && m.targetBuiltObject === d) continue;
        // A fight in progress near the destroyer is left to run.
        if (m !== null && m.type === BuiltObjectMissionType.Attack && m.targetBuiltObject !== null && !m.targetBuiltObject.hasBeenDestroyed && galaxy.calculateDistance(b.xpos, b.ypos, d.xpos, d.ypos) < 20000) continue;
        assignMission(galaxy, b, BuiltObjectMissionType.Escort, d, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Choosing where to strike and where to hide
// ---------------------------------------------------------------------------------------------------------------

function defenders(galaxy: Galaxy, st: PurifierState): { x: number; y: number; f: number }[] {
    const out: { x: number; y: number; f: number }[] = [];
    for (const e of normalEmpires(galaxy)) {
        for (const b of e.builtObjects) {
            if (b.hasBeenDestroyed || (b.role !== BuiltObjectRole.Military && b.role !== BuiltObjectRole.Base)) continue;
            const f = shipFirepower(b);
            if (f > 0) out.push({ x: b.xpos, y: b.ypos, f });
        }
    }
    void st;
    return out;
}

/** The colony to strike next: the nearest hunted one whose defenders it out-guns; null when none (or none worth it). Pure. */
export function purifierPickTarget(galaxy: Galaxy, st: PurifierState): Habitat | null {
    const d = st.destroyer;
    if (d === null) return null;
    const all = purifierTargets(galaxy, st);
    if (all.length === 0) return null;
    const dist = (h: Habitat): number => galaxy.calculateDistance(d.xpos, d.ypos, h.xpos, h.ypos);
    all.sort((a, b) => dist(a) - dist(b) || a.habitatIndex - b.habitatIndex);
    const defs = defenders(galaxy, st);
    const mine = groupFirepower(st);
    for (const h of all.slice(0, MAX_CANDIDATES)) {
        let f = 0;
        for (const q of defs) if (galaxy.calculateDistance(q.x, q.y, h.xpos, h.ypos) <= DEFENCE_RANGE) f += q.f;
        if (f * P.outgunned(galaxy) <= mine) return h;
    }
    return null;
}

/** A hiding place: an empty system far from every colony, near the group, away from `avoid`. Pure. */
export function purifierHideSpot(galaxy: Galaxy, from: { x: number; y: number }, avoid: { x: number; y: number } | null): Habitat | null {
    const colonised = new Set<number>();
    const cols: { x: number; y: number }[] = [];
    for (const e of normalEmpires(galaxy)) {
        for (const c of e.colonies) {
            if (colonised.has(c.systemIndex)) continue;
            colonised.add(c.systemIndex);
            const s = star(galaxy, c.systemIndex);
            cols.push({ x: s.xpos, y: s.ypos });
        }
    }
    const near: { i: number; d: number }[] = [];
    for (let i = 0; i < galaxy.systems.length; i++) {
        if (colonised.has(i)) continue;
        const s = galaxy.systems[i].systemStar;
        const d = galaxy.calculateDistance(from.x, from.y, s.xpos, s.ypos);
        if (d < 120000) continue; // a real jump away
        near.push({ i, d });
    }
    near.sort((a, b) => a.d - b.d || a.i - b.i);
    let best: Habitat | null = null;
    let bs = -Number.MAX_VALUE;
    for (const n of near.slice(0, 40)) {
        const s = galaxy.systems[n.i].systemStar;
        let md = Number.MAX_VALUE;
        for (const c of cols) md = Math.min(md, galaxy.calculateDistance(s.xpos, s.ypos, c.x, c.y));
        let score = md - 0.15 * n.d;
        if (avoid !== null && galaxy.calculateDistance(s.xpos, s.ypos, avoid.x, avoid.y) < 150000) score -= 1e9;
        if (score > bs) {
            bs = score;
            best = s;
        }
    }
    return best;
}

// ---------------------------------------------------------------------------------------------------------------
// The raider's state machine
// ---------------------------------------------------------------------------------------------------------------

function enemyFirepowerNear(galaxy: Galaxy, st: PurifierState): { f: number; x: number; y: number } {
    const d = st.destroyer!;
    let f = 0;
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const e of normalEmpires(galaxy)) {
        for (const b of e.builtObjects) {
            if (b.hasBeenDestroyed || b.role !== BuiltObjectRole.Military) continue;
            const dx = b.xpos - d.xpos;
            const dy = b.ypos - d.ypos;
            if (dx * dx + dy * dy > THREAT_RANGE * THREAT_RANGE) continue;
            f += shipFirepower(b);
            sx += b.xpos;
            sy += b.ypos;
            n++;
        }
    }
    return { f, x: n > 0 ? sx / n : d.xpos, y: n > 0 ? sy / n : d.ypos };
}

function setMode(st: PurifierState, mode: PurifierMode, now: number): void {
    st.mode = mode;
    st.modeDate = now;
}

function goHide(galaxy: Galaxy, st: PurifierState, avoid: { x: number; y: number } | null, mode: PurifierMode): void {
    const d = st.destroyer!;
    const spot = purifierHideSpot(galaxy, { x: d.xpos, y: d.ypos }, avoid);
    const now = galaxyStarDate(galaxy);
    if (spot === null) {
        setMode(st, 'hide', now);
        return;
    }
    st.hideSpot = spot;
    st.hideDate = now;
    st.target = null;
    sendTo(galaxy, d, spot);
    setMode(st, mode, now);
}

function arrived(galaxy: Galaxy, bo: BuiltObject, where: Habitat | null): boolean {
    return where !== null && galaxy.calculateDistance(bo.xpos, bo.ypos, where.xpos, where.ypos) <= SYSTEM_RADIUS;
}

function repairAll(galaxy: Galaxy, st: PurifierState): void {
    for (const bo of group(st)) {
        for (const c of bo.components.items) if (c.status === ComponentStatus.Damaged) c.status = ComponentStatus.Normal;
        bo.reDefine();
        bo.currentShields = bo.shieldsCapacity;
    }
    st.rudderHits = 0;
    st.lastDamaged = st.destroyer !== null ? st.destroyer.damagedComponentCount : 0;
    st.repairs++;
    void galaxy;
}

function dockStands(st: PurifierState): boolean {
    return identifyPirateBase(st.faction) !== null;
}

/** True when the approach has made no progress for 40 days (hyperdrive denial, a wall of defences): the target is skipped for a year. */
function stalled(galaxy: Galaxy, st: PurifierState, t: Habitat): boolean {
    const d = st.destroyer!;
    const now = galaxyStarDate(galaxy);
    const dist = galaxy.calculateDistance(d.xpos, d.ypos, t.xpos, t.ypos);
    if (st.progDate === 0 || dist < st.progDist - 5000) {
        st.progDist = dist;
        st.progDate = now;
        return false;
    }
    return now - st.progDate > 40 * GAME_DAY_LENGTH;
}

function drive(galaxy: Galaxy, st: PurifierState): void {
    const d = st.destroyer!;
    const now = galaxyStarDate(galaxy);
    const nowDay = now / GAME_DAY_LENGTH;
    if (st.mode === 'awaiting') return;
    // Run for port when badly damaged and the dock still stands.
    if (st.mode !== 'port' && st.mode !== 'repair' && purifierDamage(st) * 100 >= P.portDamagePct(galaxy) && dockStands(st)) {
        st.target = null;
        sendTo(galaxy, d, st.anchorage!);
        setMode(st, 'port', now);
        st.portTrips++;
        return;
    }
    if (st.mode === 'port') {
        if (arrived(galaxy, d, st.anchorage)) setMode(st, 'repair', now);
        else if (!dockStands(st)) goHide(galaxy, st, null, 'flee');
        else sendTo(galaxy, d, st.anchorage!);
        return;
    }
    if (st.mode === 'repair') {
        if (!dockStands(st)) {
            // The station is gone: no haven left. It slips away into deep space as it is.
            goHide(galaxy, st, null, 'flee');
            return;
        }
        if (nowDay - st.modeDate / GAME_DAY_LENGTH >= P.repairDays(galaxy)) {
            repairAll(galaxy, st);
            setMode(st, 'breakout', now);
        }
        return;
    }
    // Out-gunned: break off and jump away.
    if (st.mode === 'approach' || st.mode === 'breakout') {
        const e = enemyFirepowerNear(galaxy, st);
        if (e.f >= groupFirepower(st) * P.outgunned(galaxy)) {
            goHide(galaxy, st, { x: e.x, y: e.y }, 'flee');
            st.nextStrikeDate = Math.max(st.nextStrikeDate, now + 20 * GAME_DAY_LENGTH);
            return;
        }
    }
    if (st.mode === 'approach') {
        const t = st.target;
        if (t === null || t.hasBeenDestroyed || !populated(t)) {
            // Struck (or lost the target): jump away and hide, then wait out the strike timer.
            st.nextStrikeDate = now + P.strikeDays(galaxy) * GAME_DAY_LENGTH;
            goHide(galaxy, st, { x: d.xpos, y: d.ypos }, 'flee');
        } else if (nowDay - st.modeDate / GAME_DAY_LENGTH > 400 || stalled(galaxy, st, t)) {
            st.skip = st.skip.filter((q) => q.until > now);
            st.skip.push({ habitat: t, until: now + YEAR_LENGTH });
            st.target = null;
            goHide(galaxy, st, null, 'flee');
        } else {
            const m = builtObjectMission(d.mission);
            if (m === null || m.type !== BuiltObjectMissionType.Attack || m.targetHabitat !== t) assignMission(galaxy, d, BuiltObjectMissionType.Attack, t, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
        }
        return;
    }
    if (st.mode === 'flee') {
        if (arrived(galaxy, d, st.hideSpot) || nowDay - st.modeDate / GAME_DAY_LENGTH > 40) setMode(st, 'hide', now);
        else if (st.hideSpot !== null) sendTo(galaxy, d, st.hideSpot);
        return;
    }
    // breakout / hide: strike when the timer allows, else keep to deep space.
    if (now >= st.nextStrikeDate) {
        const t = purifierPickTarget(galaxy, st);
        if (t !== null) {
            st.target = t;
            st.progDate = 0;
            assignMission(galaxy, d, BuiltObjectMissionType.Attack, t, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
            setMode(st, 'approach', now);
            return;
        }
    }
    if (st.mode === 'breakout' && st.hideSpot === null) {
        goHide(galaxy, st, null, 'hide');
        return;
    }
    if (st.hideSpot === null || nowDay - st.hideDate / GAME_DAY_LENGTH >= P.hideHopDays(galaxy)) goHide(galaxy, st, null, 'hide');
    else if (isIdle(d) && !arrived(galaxy, d, st.hideSpot)) sendTo(galaxy, d, st.hideSpot);
    else if (st.mode === 'breakout' && arrived(galaxy, d, st.hideSpot)) setMode(st, 'hide', now);
}

/** No hunted colony for purifierRetargetYears: it takes up the nearest populous family. */
function retarget(galaxy: Galaxy, st: PurifierState): void {
    const now = galaxyStarDate(galaxy);
    const d = st.destroyer!;
    if (purifierTargets(galaxy, st).length > 0 || st.mode === 'awaiting') {
        st.noTargetSince = 0;
        return;
    }
    if (st.noTargetSince === 0) st.noTargetSince = now;
    if (now - st.noTargetSince < P.retargetYears(galaxy) * YEAR_LENGTH) return;
    let best: Habitat | null = null;
    let bd = Number.MAX_VALUE;
    for (const h of galaxy.habitats) {
        if (!populated(h) || h.empire === st.faction || !canDestroyHabitat(galaxy, d, h) || familyOf(h) < 0) continue;
        const dist = galaxy.calculateDistance(d.xpos, d.ypos, h.xpos, h.ypos);
        if (dist < bd) {
            bd = dist;
            best = h;
        }
    }
    st.noTargetSince = 0;
    if (best === null) return;
    st.huntOthers = false;
    st.hunted = [familyOf(best)];
    st.retargets++;
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Retarget', onceKey: `Retarget${st.retargets}`, textTag: `${TAG} Retarget News`, args: [familyName(galaxy, familyOf(best))] });
}

// ---------------------------------------------------------------------------------------------------------------
// Rudder hits
// ---------------------------------------------------------------------------------------------------------------

function rudder(galaxy: Galaxy, st: PurifierState): void {
    const d = st.destroyer!;
    const dc = d.damagedComponentCount;
    for (let i = st.lastDamaged; i < dc; i++) {
        // RND(purifier rudder): one roll per newly damaged component.
        if (galaxy.rnd.nextDouble() * 100 < P.rudderPct(galaxy)) st.rudderHits++;
    }
    st.lastDamaged = dc;
}

// ---------------------------------------------------------------------------------------------------------------
// Sightings, shadowing, reputation
// ---------------------------------------------------------------------------------------------------------------

function sightingOf(st: PurifierState, empire: Empire | null): PurifierSighting | null {
    if (empire === null) return null;
    return st.sightings.find((s) => s.empireId === empire.empireId) ?? null;
}

/** Hunting empires: those of a hunted family, and the victims. */
export function purifierHunters(galaxy: Galaxy, st: PurifierState): Empire[] {
    const out: Empire[] = [];
    for (const e of normalEmpires(galaxy, st.faction)) {
        const f = e.dominantRace?.raceFamily ?? -1;
        if (purifierHunts(st, f) || st.victims.includes(e) || (st.mode === 'repair' && knowledgeLevel({ knowledge: st.dockKnowledge }, e) >= KNOWLEDGE_CONFIRMED)) out.push(e);
    }
    return out;
}

function record(galaxy: Galaxy, st: PurifierState, e: Empire, x: number, y: number, now: number): void {
    let s = sightingOf(st, e);
    const first = s === null;
    if (s === null) {
        s = { empireId: e.empireId, x, y, systemIndex: 0, date: now, lastMessage: -1e18 };
        st.sightings.push(s);
    }
    s.x = x;
    s.y = y;
    s.systemIndex = nearestSystemIndex(galaxy, x, y);
    s.date = now;
    revealTo(galaxy, st, e, KNOWLEDGE_CONFIRMED);
    if (st.waker !== null && e !== st.waker) expose(galaxy, st);
    if (!isHumanEmpire(galaxy, e) || now - s.lastMessage < 45 * GAME_DAY_LENGTH) return;
    s.lastMessage = now;
    const sys = galaxy.systems[s.systemIndex].systemStar;
    scenarioMessage(galaxy, e, scenarioText(first ? `${TAG} Sighted Title` : `${TAG} Resighted Title`), scenarioText(first ? `${TAG} Sighted` : `${TAG} Resighted`, sys.name), {
        type: EmpireMessageType.GeneralWarning,
        subject: sys,
        popup: false,
    });
}

function sightings(galaxy: Galaxy, st: PurifierState): void {
    const d = st.destroyer!;
    const now = galaxyStarDate(galaxy);
    const seeing: Empire[] = [];
    for (const e of normalEmpires(galaxy, st.faction)) if (isObjectVisibleToThisEmpire(galaxy, e, d)) seeing.push(e);
    // Hyperjump detection: a long-range scanner within range of either end of a jump reveals it.
    const jumped = galaxy.calculateDistance(st.lastX, st.lastY, d.xpos, d.ypos) >= JUMP_MIN;
    if (jumped) {
        for (const e of normalEmpires(galaxy, st.faction)) {
            if (seeing.includes(e)) continue;
            for (const s of e.longRangeScanners as BuiltObject[]) {
                if (s.hasBeenDestroyed) continue;
                const r = s.sensorLongRange;
                if (galaxy.calculateDistance(s.xpos, s.ypos, d.xpos, d.ypos) <= r) {
                    seeing.push(e);
                    break;
                }
                if (galaxy.calculateDistance(s.xpos, s.ypos, st.lastX, st.lastY) <= r) {
                    record(galaxy, st, e, st.lastX, st.lastY, now);
                    break;
                }
            }
        }
    }
    st.visibleTo = seeing.map((e) => e.empireId);
    for (const e of seeing) record(galaxy, st, e, d.xpos, d.ypos, now);
    // Shadowing: while any hunter keeps it in sensor range, every hunter gets the sighting.
    const hunters = purifierHunters(galaxy, st);
    if (hunters.some((h) => seeing.includes(h))) for (const h of hunters) if (!seeing.includes(h)) record(galaxy, st, h, d.xpos, d.ypos, now);
    st.lastX = d.xpos;
    st.lastY = d.ypos;
}

/** The station: an empire that sees it learns where it is (the hidden site's knowledge); so does one that sees the Purifier docked. */
function dockSightings(galaxy: Galaxy, st: PurifierState): void {
    const dock = identifyPirateBase(st.faction);
    if (dock === null) return;
    const site = { knowledge: st.dockKnowledge };
    for (const e of normalEmpires(galaxy, st.faction)) {
        if (knowledgeLevel(site, e) >= KNOWLEDGE_CONFIRMED) continue;
        if (isObjectVisibleToThisEmpire(galaxy, e, dock) || (st.mode === 'repair' && st.visibleTo.includes(e.empireId))) {
            revealTo(galaxy, site, e, KNOWLEDGE_CONFIRMED);
            if (isHumanEmpire(galaxy, e)) scenarioMessage(galaxy, e, scenarioText(`${TAG} Dock Title`), scenarioText(`${TAG} Dock Found`, st.anchorage!.name), { type: EmpireMessageType.GeneralWarning, subject: st.anchorage, popup: false });
        }
    }
}

function victimDrop(galaxy: Galaxy, st: PurifierState, victim: Empire): void {
    if (st.waker === null || !st.waker.active || victim === st.waker) return;
    applyReputation(galaxy, victim, st.waker, -P.victimRep(galaxy), { cause: 'purifier.waker', labelKey: 'Reputation Cause purifier.waker', source: 'purifier', legacy: 'factored', decayPerYear: 1 });
}

/** The waker is exposed: a one-time civility loss, the news names it, and the victims' regard for it drops a little. */
function expose(galaxy: Galaxy, st: PurifierState): void {
    if (st.exposed) return;
    st.exposed = true;
    st.exposeDate = galaxyStarDate(galaxy);
    const w = st.waker;
    if (w === null || !w.active) return;
    w.civilityRating -= P.wakerRep(galaxy);
    for (const v of st.victims) victimDrop(galaxy, st, v);
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Exposed', textTag: `${TAG} Exposed News`, args: [w.name] });
}

// ---------------------------------------------------------------------------------------------------------------
// AI hunters
// ---------------------------------------------------------------------------------------------------------------

/** A hunter that knows the station and the Purifier is docked there attacks it as if it were in view. */
function dockKnown0(st: PurifierState, e: Empire): boolean {
    return st.mode === 'repair' && knowledgeLevel({ knowledge: st.dockKnowledge }, e) >= KNOWLEDGE_CONFIRMED;
}

function dispatch(galaxy: Galaxy, st: PurifierState): void {
    const d = st.destroyer!;
    const now = galaxyStarDate(galaxy);
    const need = groupStrength(st) * P.hunterRatio(galaxy);
    for (const e of purifierHunters(galaxy, st)) {
        if (isHumanEmpire(galaxy, e)) continue;
        let s = sightingOf(st, e);
        if (dockKnown0(st, e)) s = { empireId: e.empireId, x: st.dockX, y: st.dockY, systemIndex: nearestSystemIndex(galaxy, st.dockX, st.dockY), date: now, lastMessage: 0 };
        if (s === null || now - s.date > P.memoryDays(galaxy) * GAME_DAY_LENGTH) continue;
        const inView = st.visibleTo.includes(e.empireId) || dockKnown0(st, e);
        const dockKnown = st.mode === 'repair' && dockStands(st) && knowledgeLevel({ knowledge: st.dockKnowledge }, e) >= KNOWLEDGE_CONFIRMED;
        const where = dockKnown ? st.anchorage! : galaxy.systems[s.systemIndex].systemStar;
        const units: { sg: ReturnType<typeof empireShipGroups>[number]; bo: BuiltObject | null; f: number; dist: number }[] = [];
        for (const sg of empireShipGroups(e)) {
            if (sg === null || sg.ships.length === 0 || sg.leadShip === null) continue;
            const m = sg.mission;
            if (m !== null && (m.type === BuiltObjectMissionType.Repair || m.type === BuiltObjectMissionType.Retrofit || m.type === BuiltObjectMissionType.Refuel)) continue;
            let f = 0;
            for (const b of sg.ships) f += calculateOverallStrengthFactorWithoutShields(b);
            units.push({ sg, bo: null, f, dist: galaxy.calculateDistance(sg.leadShip.xpos, sg.leadShip.ypos, s.x, s.y) });
        }
        for (const b of e.builtObjects) {
            if (b.hasBeenDestroyed || b.role !== BuiltObjectRole.Military || b.topSpeed <= 0 || b.warpSpeed <= 0 || b.shipGroup !== null || b.subRole === BuiltObjectSubRole.TroopTransport) continue;
            const m = builtObjectMission(b.mission);
            if (m !== null && m.type !== BuiltObjectMissionType.Patrol && m.type !== BuiltObjectMissionType.Move && m.type !== BuiltObjectMissionType.Hold && m.type !== BuiltObjectMissionType.Undefined) continue;
            units.push({ sg: null, bo: b, f: calculateOverallStrengthFactorWithoutShields(b), dist: galaxy.calculateDistance(b.xpos, b.ypos, s.x, s.y) });
        }
        units.sort((a, b) => a.dist - b.dist);
        const chosen: typeof units = [];
        let sum = 0;
        for (const u of units) {
            chosen.push(u);
            sum += u.f;
            if (sum >= need) break;
        }
        if (sum < need) continue;
        for (const u of chosen) {
            if (u.sg !== null) {
                const m = u.sg.mission;
                if (inView) shipGroupAssignMission(galaxy, u.sg, BuiltObjectMissionType.Attack, d, null, BuiltObjectMissionPriority.High, true);
                else if (m === null || m.type !== BuiltObjectMissionType.Patrol || m.targetHabitat !== where) shipGroupAssignMission(galaxy, u.sg, BuiltObjectMissionType.Patrol, where, null, BuiltObjectMissionPriority.High, true);
            } else if (u.bo !== null) {
                if (inView) assignMission(galaxy, u.bo, BuiltObjectMissionType.Attack, d, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
                else {
                    const m = builtObjectMission(u.bo.mission);
                    if (m === null || m.type !== BuiltObjectMissionType.Patrol || m.targetHabitat !== where) assignMission(galaxy, u.bo, BuiltObjectMissionType.Patrol, where, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Events: strikes, fights, the kill
// ---------------------------------------------------------------------------------------------------------------

function isPurifierShip(st: PurifierState, bo: BuiltObject): boolean {
    return st.faction !== null && bo.actualEmpire === st.faction;
}

function onHabitatDestroyed(galaxy: Galaxy, habitat: Habitat, destroyer: Empire | null): void {
    const st = peekPurifierState(galaxy);
    if (st === null || st.faction === null || destroyer !== st.faction || st.phase !== 'awake') return;
    st.bodies++;
    if (habitat.population === null || habitat.population.totalAmount <= 0) return;
    st.worlds++;
    const v = habitat.empire;
    if (v !== null && v !== galaxy.independentEmpire && v.pirateEmpireBaseHabitat === null) {
        if (!st.victims.includes(v)) {
            st.victims.push(v);
            if (st.exposed) victimDrop(galaxy, st, v);
        }
        if (isHumanEmpire(galaxy, v)) scenarioMessage(galaxy, v, scenarioText(`${TAG} Strike Title`), scenarioText(`${TAG} Strike`, habitat.name), { type: EmpireMessageType.GeneralBadEvent, popup: false });
    }
    scenarioNewsStrike(galaxy, st, habitat);
}

function scenarioNewsStrike(galaxy: Galaxy, st: PurifierState, habitat: Habitat): void {
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Strike', onceKey: `Strike${st.worlds}`, textTag: `${TAG} Strike News`, args: [habitat.name, star(galaxy, habitat.systemIndex).name] });
}

function onAttacked(galaxy: Galaxy, bo: BuiltObject, attackingEmpire: Empire | null): void {
    const st = peekPurifierState(galaxy);
    if (st === null || st.phase !== 'awake' || st.engaged || attackingEmpire === null || attackingEmpire === st.faction) return;
    if (!isPurifierShip(st, bo)) return;
    st.engaged = true;
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Engaged', textTag: `${TAG} Engaged News`, args: [attackingEmpire.name] });
}

function onKilledBy(galaxy: Galaxy, bo: BuiltObject, destroyer: Empire | null): void {
    const st = peekPurifierState(galaxy);
    if (st === null || st.faction === null || st.phase !== 'awake') return;
    if (isPurifierShip(st, bo)) {
        st.losses++;
        if (destroyer !== null && destroyer !== st.faction) st.killsBy[String(destroyer.empireId)] = (st.killsBy[String(destroyer.empireId)] ?? 0) + 1;
        if (bo === st.destroyer) finish(galaxy, st, destroyer);
    } else if (destroyer === st.faction) st.kills++;
}

function finish(galaxy: Galaxy, st: PurifierState, killer: Empire | null): void {
    st.phase = 'ended';
    st.endDate = galaxyStarDate(galaxy);
    const real = killer !== null && killer !== st.faction && killer.active && killer !== galaxy.independentEmpire && killer.pirateEmpireBaseHabitat === null ? killer : null;
    st.killer = real;
    if (real !== null) {
        const bounty = P.bounty(galaxy);
        real.stateMoney += bounty; // salvage money, never research
        st.bounty = bounty;
        real.civilityRating += P.killerRep(galaxy);
        for (const e of normalEmpires(galaxy, real)) applyReputation(galaxy, e, real, P.killerRep(galaxy), { cause: 'purifier.slayer', labelKey: 'Reputation Cause purifier.slayer', source: 'purifier', legacy: 'factored', decayPerYear: 1 });
        if (isHumanEmpire(galaxy, real)) scenarioMessage(galaxy, real, scenarioText(`${TAG} Bounty Title`), scenarioText(`${TAG} Bounty`, Math.round(bounty).toLocaleString('en-US')), { type: EmpireMessageType.GeneralGoodEvent, popup: false });
    }
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Ended', textTag: `${TAG} Ended News`, args: [real !== null ? real.name : scenarioText(`${TAG} Unknown Slayer`), st.worlds] });
    // The leaderless escort and the dock fall silent and are cleared (the stock pirate wind-down then removes the faction).
    for (const b of [...st.escorts, ...st.guards]) if (!b.hasBeenDestroyed) builtObjectCompleteTeardown(galaxy, b);
    const dock = identifyPirateBase(st.faction);
    if (dock !== null) builtObjectCompleteTeardown(galaxy, dock);
}

// ---------------------------------------------------------------------------------------------------------------
// Periodic driver
// ---------------------------------------------------------------------------------------------------------------

export function purifierPeriodic(galaxy: Galaxy): void {
    if (!threatExists(galaxy, PURIFIER_KEY)) return; // §0 rarity: not this game - no state, no draws.
    const st = purifierState(galaxy);
    if (st.phase === 'ended') return;
    const now = galaxyStarDate(galaxy);
    if (st.phase === 'waiting') {
        if (yearsIn(galaxy) < P.year(galaxy) || !pastThreatMinYear(galaxy, PURIFIER_KEY)) return;
        const a = purifierAnchorage(galaxy);
        if (a === null) {
            st.phase = 'ended';
            return;
        }
        st.anchorage = a;
        st.openDate = now;
        st.phase = 'dormant';
        return;
    }
    if (st.phase === 'dormant') {
        if (st.anchorage === null || st.anchorage.hasBeenDestroyed) {
            st.phase = 'ended';
            return;
        }
        if (now - st.lastScan < 6 * GAME_DAY_LENGTH) return;
        st.lastScan = now;
        let waker = finderOf(galaxy, st);
        if (waker === null && now - st.openDate >= P.wakeYears(galaxy) * YEAR_LENGTH) waker = fallbackWaker(galaxy, st);
        if (waker === null) return;
        if (!purifierWake(galaxy, st, waker)) st.phase = 'ended';
        return;
    }
    const faction = st.faction;
    if (faction === null || !faction.active || st.destroyer === null || st.destroyer.hasBeenDestroyed || st.destroyer.actualEmpire !== faction) {
        if (st.phase === 'awake') finish(galaxy, st, null);
        return;
    }
    st.escorts = st.escorts.filter((b) => aliveShip(b, faction));
    st.guards = st.guards.filter((b) => aliveShip(b, faction));
    resupply(st);
    rudder(galaxy, st);
    escortOrders(galaxy, st);
    drive(galaxy, st);
    if (st.mode === 'repair') {
        // Docked for repair it is helpless: shields down, weapons without power (it cannot jump: the spool query).
        st.destroyer.currentShields = 0;
        st.destroyer.currentEnergy = 0;
    }
    sightings(galaxy, st);
    dockSightings(galaxy, st);
    retarget(galaxy, st);
    if (st.waker !== null && !st.exposed && now - st.wakeDate >= P.exposeYears(galaxy) * YEAR_LENGTH) expose(galaxy, st);
    if (now - st.lastDispatch >= 10 * GAME_DAY_LENGTH) {
        st.lastDispatch = now;
        dispatch(galaxy, st);
    }
    const y = yearsIn(galaxy);
    if (st.history.length === 0 || st.history[st.history.length - 1].year < y) st.history.push({ year: y, worlds: st.worlds, escorts: st.escorts.length, mode: st.mode, damagePct: Math.round(purifierDamage(st) * 100) });
    void day;
    void YEAR_DAYS;
}

// ---------------------------------------------------------------------------------------------------------------
// UI (read-only): the Threats & Leads row and the map glyph
// ---------------------------------------------------------------------------------------------------------------

export function purifierKnownSites(galaxy: Galaxy, empire: Empire): KnownThreatSite[] {
    const st = peekPurifierState(galaxy);
    if (st === null || st.phase !== 'awake') return [];
    const out: KnownThreatSite[] = [];
    if (dockStands(st) && knowledgeLevel({ knowledge: st.dockKnowledge }, empire) >= KNOWLEDGE_CONFIRMED && st.anchorage !== null) {
        out.push({ threat: PURIFIER_KEY, kind: 'colony', target: st.anchorage, level: KNOWLEDGE_CONFIRMED, site: { knowledge: st.dockKnowledge }, label: scenarioText(`${TAG} Dock Row`, st.anchorage.name), status: scenarioText(`${TAG} Dock Status`) });
    }
    const s = sightingOf(st, empire);
    if (s === null) return out;
    const target = galaxy.systems[s.systemIndex].systemStar;
    const live = st.visibleTo.includes(empire.empireId);
    out.push({
        threat: PURIFIER_KEY,
        kind: 'colony',
        target,
        level: KNOWLEDGE_CONFIRMED,
        site: st,
        label: live ? scenarioText(`${TAG} Site Row Live`, target.name) : scenarioText(`${TAG} Site Row Seen`, target.name, resolveStarDateDescription(s.date)),
        status: scenarioText(`${TAG} Status`, st.worlds),
    });
    return out;
}

/** One distinctive glyph: at its position while the viewer sees it, dim and hollow at the last spotted place otherwise. */
export function purifierMapFeatures(galaxy: Galaxy, viewer: Empire | null): ScenarioMapFeatures | null {
    const st = peekPurifierState(galaxy);
    if (st === null || st.phase !== 'awake' || viewer === null || st.destroyer === null) return null;
    const markers: ScenarioMapFeatures['markers'] = [];
    if (dockStands(st) && knowledgeLevel({ knowledge: st.dockKnowledge }, viewer) >= KNOWLEDGE_CONFIRMED) markers.push({ x: st.dockX, y: st.dockY, label: '', color: MARKER_COLOR, glyph: 'purifierDock' });
    if (st.visibleTo.includes(viewer.empireId)) markers.push({ x: st.destroyer.xpos, y: st.destroyer.ypos, label: '', color: MARKER_COLOR, glyph: 'purifier' });
    else {
        const s = sightingOf(st, viewer);
        if (s !== null) markers.push({ x: s.x, y: s.y, label: '', color: MARKER_COLOR, glyph: 'purifier', stale: true });
    }
    return markers.length === 0 ? null : { markers, routes: [] };
}

// ---------------------------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------------------------

function isFaction(galaxy: Galaxy, e: Empire | null): boolean {
    const st = peekPurifierState(galaxy);
    return st !== null && e !== null && st.faction === e;
}

export const PURIFIER_HANDLER_IDS = [
    'purifier.periodic',
    'purifier.killedBy',
    'purifier.destroyed',
    'purifier.attacked',
    'purifier.passive',
    'purifier.noProtection',
    'purifier.noCapture',
    'purifier.noRepair',
    'purifier.rudder',
    'purifier.keepFaction',
] as const;

export function registerPurifier(): void {
    registerThreatExistence(PURIFIER_KEY, PURIFIER_FLAG);
    registerScenarioFramePeriodic({ id: 'purifier.periodic', flag: PURIFIER_FLAG, periodDays: PERIOD_DAYS, order: 16, run: (g) => purifierPeriodic(g) });
    registerScenarioEvent({ id: 'purifier.killedBy', flag: PURIFIER_FLAG, event: 'builtObjectKilledBy', run: (g, e) => onKilledBy(g, e.builtObject, e.destroyer) });
    registerScenarioEvent({ id: 'purifier.destroyed', flag: PURIFIER_FLAG, event: 'habitatDestroyed', run: (g, e) => onHabitatDestroyed(g, e.habitat, e.destroyer) });
    registerScenarioEvent({ id: 'purifier.attacked', flag: PURIFIER_FLAG, event: 'builtObjectAttacked', run: (g, e) => onAttacked(g, e.builtObject, e.attackingEmpire) });
    registerScenarioQuery({ id: 'purifier.passive', flag: PURIFIER_FLAG, query: 'pirateFactionPassive', run: (g, v, a) => v || isFaction(g, a.empire) });
    registerScenarioQuery({ id: 'purifier.noProtection', flag: PURIFIER_FLAG, query: 'pirateProtectionDesired', run: (g, v, a) => v && !isFaction(g, a.pirate) });
    registerScenarioQuery({ id: 'purifier.noCapture', flag: PURIFIER_FLAG, query: 'combatCaptureAllowed', run: (g, v, a) => v && !isFaction(g, a.capturingEmpire) });
    registerScenarioQuery({ id: 'purifier.noRepair', flag: PURIFIER_FLAG, query: 'repairRateFactor', run: (g, v, a) => (isFaction(g, a.builtObject.actualEmpire) ? v * 1e-9 : v) });
    registerScenarioQuery({
        id: 'purifier.rudder',
        flag: PURIFIER_FLAG,
        query: 'hyperjumpSpoolFactor',
        run: (g, v, a) => {
            const st = peekPurifierState(g);
            if (st === null || st.destroyer !== a.ship) return v;
            if (st.mode === 'repair') return v * 1000; // docked: it cannot jump away
            return st.rudderHits > 0 ? v * (1 + P.rudderSpool(g) * st.rudderHits) : v;
        },
    });
    registerScenarioQuery({ id: 'purifier.keepFaction', flag: PURIFIER_FLAG, query: 'pirateTerminationBlocked', run: (g, v, a) => v || (isFaction(g, a.empire) && peekPurifierState(g)?.phase === 'awake' && peekPurifierState(g)?.destroyer?.hasBeenDestroyed === false) });
    registerScenarioDecision({ id: 'purifier.decision', kind: DECISION_KIND, flag: PURIFIER_FLAG, resolve: resolveChoice, aiChoose: (g, d) => `fam:${aiPickFamily(g, d.empire)}` });
    registerThreatKnownSites(PURIFIER_KEY, purifierKnownSites);
    registerScenarioMapFeatures('purifier', purifierMapFeatures);
}

registerPurifier();
