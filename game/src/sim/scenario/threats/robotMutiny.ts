// 19f #9 Robot Mutiny (tasks/19f-hidden-threats.md §9, threat framework framework.ts). Not a port: new scenario
// behaviour composed of ported functions (each composed step cites its C# analogue). Registered from
// scenario/packages.ts; every handler is gated by the `threatRobotMutiny` flag, so with the flag off (or no
// scenario) nothing here runs and nothing draws. scenarios/robotmutiny includes darkfarms (D3) for the Harvester
// race the faction wears (§9 "faction race = Harvester from 19b (via D3 include...)").
//
// Arc: one existing ruin world (no new ruin created) is the hidden transmitter. Empires spread the threat themselves
// by recruiting BattleBot troops (the stock RoboticTroopFoundry path, identified by the stock marker
// troop.race === null && troop.pictureRef === galaxy.races.length, troops.ts 387/701).
//   Hidden growth: every colony whose garrison holds ≥ mutinySleeperMinRobots robots accrues mutinySleepersPerYear
//     hidden sleeper robots a year — a count in this state only (no Troop object, no upkeep, invisible to the stock UI).
//   Rising: once the galaxy-wide robot count clears the threshold at/after mutinyYear, the faction is created and each
//     colony rises only where its robots (garrison robots + sleepers, materialised as stock foundry BattleBot troops)
//     beat the non-robot defenders by the stock CalculateForceStrengths comparison (invasion.ts 543). Elsewhere the
//     robots stay dormant and rise in a later period when the balance flips or a faction warship is in the system.
//     Majority-robot transports flip to the faction (framework flipToFaction).
//   Empire: the faction's first captured colony turns it into a full empire (renamed, locked wars released to the
//     stock diplomacy, the Harvester race set Expanding so the stock AI colonises; capital through the stock
//     takeOwnershipOfColony of the conquest). Everything else — building, research, war review, invasions — is the
//     stock AI it already runs (empireTick.ts empireDoTasks).
//   Beacon fleets: from the rising the transmitter spawns warships at the ruin world (Galaxy.8.cs 1474
//     GenerateMilitaryConvoy's GenerateNewBuiltObject + TakeOwnershipOfBuiltObject), yearly replenished to the target
//     for that year (firepower scaled to the strongest normal empire: mutinyBeaconFirepowerPct + growth, × mutinyBeaconScalePct %), designs at the best regular empire's tech
//     level + mutinyTechBonus (Empire.10.cs GenerateDesignFromSpec with a tech level, as generateSuperPirateFaction
//     does), gathered into Attack-posture fleets the stock fleet AI tasks.
//   Neutralising the source (a troop landing / planet destroyer) stops sleeper growth, further risings and the beacon.
//
// Rnd (§0.4): draws in mutinyTrigger (faction creation, the ship-flip roll), the beacon (design naming, the ship-type
// roll, parking points / headings / names) and mutinyPeriodic's discovery roll. Sleeper accrual, the rising test,
// mutinyHints, the conversion and the AI policy rule are deterministic. Fixed iteration orders: galaxy.habitats index
// order for accrual / risings, normalEmpires(galaxy) order for hints / discovery / the AI rule, an empire's builtObjects
// list order for the ship-flip sweep.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import type { BuiltObject } from '../../builtObject';
import type { Design } from '../../design';
import { Troop, TroopList, TroopType } from '../../cargo';
import { CharacterRole, getEmpireCharacters, stellarObjectCharacters, type Character, type IntelligenceMission } from '../../characters';
import { generateNewTroop } from '../../builtObjectPlacement';
import { calculateForceStrengths, calculatePopulationStrength } from '../../combat/invasion';
import { takeOwnershipOfBuiltObject } from '../../combat/ownership';
import { generateDesignFromSpec } from '../../designGeneration';
import { galaxyDesignSpecificationBySubRole } from '../../gameStartTail';
import { generateNewBuiltObject } from '../../empireEvents';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { obtainDiplomaticRelation } from '../../diplomacy';
import { FleetPosture, calculateOverallStrengthFactorWithoutShields, identifyShakturiEmpire, militaryPotency } from '../../diplomacyTick';
import { rimTraderEmpire } from '../rimTrade/common';
import { isHerderEmpire } from '../rimHerders/common';
import { ShipGroup, empireShipGroups } from '../../fleets/shipGroup';
import { addShipsToShipGroup, compareShipGroups, getNextFleetNumberDescription } from '../../fleets/shipGroupTasks';
import { netSort } from '../../netSort';
import { assignMission } from '../../missions/assign';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../../missions/mission';
import { absorbEmpire } from '../../empireAbsorb';
import { makeHabitatIntoColonyRuntime } from '../../missions/cmdTroops';
import { reviewEmpireTerritory } from '../../exploration';
import { HabitatCategoryType, HabitatType, recalculateMaximumPopulation } from '../../types';
import { identifyMechanoidEmpire } from '../../fleets/militaryAI';
import { gameYear, scenarioEmit, registerScenarioPeriodic, registerScenarioQuery, registerScenarioYearly } from '../hooks';
import { scenarioParam } from '../state';
import { scenarioText } from '../messages';
import { GameEndOutcome } from '../../victory';
import { galaxyStarDate } from '../../tick/simTime';
import { startStarDateForAge } from '../../galaxyTime';
import {
    KNOWLEDGE_CONFIRMED,
    arcMessage,
    arcNews,
    createThreatFaction,
    factionPopulationSharePct,
    flipToFaction,
    invadeFromInside,
    loadTroopsOnto,
    makeRobotTroop,
    knowledgeLevel,
    normalEmpires,
    pastThreatMinYear,
    peekThreatState,
    registerThreatExistence,
    registerThreatSpawn,
    revealTo,
    teardownIfDead,
    threatExists,
    threatGameEnd,
    threatState,
    type SentStages,
    type ThreatKnowledge,
} from './framework';

export const ROBOT_MUTINY_KEY = 'robotMutiny';
export const ROBOT_MUTINY_FLAG = 'threatRobotMutiny';
const TAG = 'Mutiny';
const PERIOD_DAYS = 30;
/** IntelligenceMissionType.CounterIntelligence (espionage.ts): 8. */
const COUNTER_INTELLIGENCE = 8;
/** Game-end codes (19f table: 1911 Grey Tide … 1920 Corporate Coup; victory/containment = code + 100). */
export const ROBOT_MUTINY_CODE_DEFEAT = 1919;
export const ROBOT_MUTINY_CODE_CONTAINED = 2019;
/** The stock RoboticTroopFoundry troop (troops.ts 387, Habitat.cs 7047-7084): strength 60, maintenance ×0.25. */
const ROBOT_TROOP_STRENGTH = 60;
const ROBOT_TROOP_MAINTENANCE = 0.25;
/** Safety cap on warships spawned in one year. */
const BEACON_MAX_SPAWN = 2000;

/** Beacon warships per fleet formed at the transmitter. */
const BEACON_FLEET_SIZE = 20;

/** Hidden sleeper robots at one colony (never Troop objects until the colony rises). */
export interface MutinySleepers {
    colony: Habitat;
    count: number;
}

export interface RobotMutinyState {
    seeded: boolean;
    source: Habitat | null;
    sourceTaken: boolean;
    triggered: boolean;
    faction: Empire | null;
    knowledge: Record<number, ThreatKnowledge[]>;
    sourceKnowledge: ThreatKnowledge[];
    stoppedRecruiting: number[];
    sentStages: SentStages;
    ended: boolean;
    /** Hidden sleepers per colony (galaxy.habitats order of first accrual). */
    sleepers?: MutinySleepers[];
    /** Game year of the rising (-1 before). */
    risingYear?: number;
    /** True once the faction took a colony and became a full empire. */
    becameEmpire?: boolean;
    /** Warships the transmitter spawned (pruned of the destroyed / lost each year). */
    beaconShips?: BuiltObject[];
    /** Last game year the beacon was replenished (-1 never). */
    beaconYear?: number;
    /** Tech level of the current beacon designs (-1 none). */
    beaconTech?: number;
    /** The beacon designs at beaconTech (Escort … Carrier; the ones the generator could build). */
    beaconDesigns?: Design[];
    /** Total warships the beacon spawned. */
    beaconSpawned?: number;
    /** Troop transports the beacon spawned that still carry (or may carry) robots. */
    beaconTransports?: BuiltObject[];
    /** The troop transport design at beaconTech (null none). */
    beaconTransportDesign?: Design | null;
    /** The colony the beacon fleets are assaulting (null none). */
    assaultTarget?: Habitat | null;
    /** Full takeover variant: the Broadcast absorbed the whole Ancient Guardians and plays an expansionist turtle (null: not rolled yet). */
    turtle?: boolean | null;
    /** Turtle: points (colonies, stations) within STATION_RANGE of which its warships may take missions. */
    turtlePresence?: { x: number; y: number }[];
    /** Colonies the beacon's landings took. */
    assaultLandings?: number;
    /** True while faction.capital is the transmitter world standing in for a capital it does not own (see provisionCapital). */
    provisionalCapital?: boolean;
}

function newState(): RobotMutinyState {
    return {
        seeded: false,
        source: null,
        sourceTaken: false,
        triggered: false,
        faction: null,
        knowledge: {},
        sourceKnowledge: [],
        stoppedRecruiting: [],
        sentStages: {},
        ended: false,
        sleepers: [],
        risingYear: -1,
        becameEmpire: false,
        beaconShips: [],
        beaconYear: -1,
        beaconTech: -1,
        beaconDesigns: [],
        beaconSpawned: 0,
        beaconTransports: [],
        beaconTransportDesign: null,
        assaultTarget: null,
        assaultLandings: 0,
        turtle: null,
        turtlePresence: [],
    };
}

export function robotMutinyState(galaxy: Galaxy): RobotMutinyState {
    return threatState(galaxy, ROBOT_MUTINY_KEY, newState);
}
export function peekRobotMutinyState(galaxy: Galaxy): RobotMutinyState | null {
    return peekThreatState<RobotMutinyState>(galaxy, ROBOT_MUTINY_KEY);
}

function p(galaxy: Galaxy, name: string, fallback: number): number {
    return scenarioParam(galaxy, name, fallback);
}
const P = {
    year: (g: Galaxy) => Math.trunc(p(g, 'mutinyYear', 70)),
    minRobots: (g: Galaxy) => Math.trunc(p(g, 'mutinyMinRobots', 30)),
    shipFlipPct: (g: Galaxy) => p(g, 'mutinyShipFlipPct', 100),
    sourceDetectPct: (g: Galaxy) => p(g, 'mutinySourceDetectPct', 8),
    defeatPopulationPct: (g: Galaxy) => p(g, 'mutinyDefeatPopulationPct', 40),
    sleeperMinRobots: (g: Galaxy) => Math.trunc(p(g, 'mutinySleeperMinRobots', 2)),
    sleepersPerYear: (g: Galaxy) => Math.trunc(p(g, 'mutinySleepersPerYear', 15)),
    beaconFirepowerPct: (g: Galaxy) => p(g, 'mutinyBeaconFirepowerPct', 130),
    beaconGrowthPct: (g: Galaxy) => p(g, 'mutinyBeaconGrowthPct', 10),
    beaconMaxPct: (g: Galaxy) => p(g, 'mutinyBeaconMaxPct', 180),
    regimentFirepower: (g: Galaxy) => p(g, 'mutinyRegimentFirepower', 1000),
    regimentStrength: (g: Galaxy) => p(g, 'mutinyRegimentStrength', 60),
    colorMain: (g: Galaxy) => p(g, 'mutinyColorMain', 0x4b3586),
    colorSecondary: (g: Galaxy) => p(g, 'mutinyColorSecondary', 0x0080ff),
    fullTakeoverPct: (g: Galaxy) => p(g, 'mutinyFullTakeoverPct', 20),
    initialTransports: (g: Galaxy) => p(g, 'mutinyInitialTransports', 30),
    foundWorlds: (g: Galaxy) => p(g, 'mutinyFoundWorlds', 3),
    guardianSharePct: (g: Galaxy) => p(g, 'mutinyGuardianSharePct', 12.5),
    startTech: (g: Galaxy) => p(g, 'mutinyStartTech', 5),
    assaultCandidates: (g: Galaxy) => p(g, 'mutinyAssaultCandidates', 12),
    beaconMinFirepower: (g: Galaxy) => p(g, 'mutinyBeaconMinFirepower', 700),
    beaconScalePct: (g: Galaxy) => p(g, 'mutinyBeaconScalePct', 100),
    techBonus: (g: Galaxy) => p(g, 'mutinyTechBonus', 1),
};

function threatsGameEndOn(galaxy: Galaxy): boolean {
    return galaxy.scenario !== null && galaxy.scenario.flags['threatsGameEnd'] !== false;
}

/** The stock BattleBot marker (troops.ts 387 RoboticTroopFoundry / 701; framework.ts makeRobotTroop). */
export function isRobotTroop(galaxy: Galaxy, t: Troop): boolean {
    return t.type === TroopType.Infantry && t.race === null && t.pictureRef === galaxy.races.length;
}

export function sourceNeutralised(st: RobotMutinyState): boolean {
    return st.source === null || st.source.hasBeenDestroyed || st.sourceTaken;
}

/** Older saves carry no reworked fields: fill them in place. */
function ensureFields(st: RobotMutinyState): void {
    st.sleepers ??= [];
    st.risingYear ??= -1;
    st.becameEmpire ??= false;
    st.beaconShips ??= [];
    st.beaconYear ??= -1;
    st.beaconTech ??= -1;
    st.beaconDesigns ??= [];
    st.beaconSpawned ??= 0;
    st.beaconTransports ??= [];
    st.beaconTransportDesign ??= null;
    st.assaultTarget ??= null;
    st.assaultLandings ??= 0;
    st.turtle ??= null;
    st.turtlePresence ??= [];
    st.provisionalCapital ??= false;
}

/**
 * The stock AI reads Empire.Capital without a null check (Empire.9.cs TaskShipGroups → IdentifyThreatenedSystems-
 * Prioritized(Capital.Xpos, …), ShipGroup SelectFleetBase), and the faction's fleets (flipped ships, beacon warships)
 * exist before it owns a colony — the soak saw TaskShipGroups throw on every intermediate tick for years. While it has
 * no capital (before its first colony, or after losing the last one) its capital reference is the transmitter world, as
 * darkFarms.ts does with the farm colony; mutinyBecomeEmpire replaces it with the first colony taken. No Rnd.
 */
function provisionCapital(st: RobotMutinyState): void {
    const faction = st.faction;
    if (faction === null || !faction.active || st.source === null) return;
    if (faction.capital === null) {
        faction.capital = st.source;
        st.provisionalCapital = true;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Seed (yearly, once): pick an existing ruin world as the hidden transmitter. No new ruin created.
// ---------------------------------------------------------------------------------------------------------------

export function mutinySeed(galaxy: Galaxy, st: RobotMutinyState): void {
    if (st.seeded) return;
    st.seeded = true;
    const candidates = galaxy.ruinsHabitats.filter((h) => h !== null && !h.hasBeenDestroyed);
    if (candidates.length === 0) return;
    st.source = candidates[galaxy.rnd.next(0, candidates.length)];
}

// ---------------------------------------------------------------------------------------------------------------
// Robot counting / hints
// ---------------------------------------------------------------------------------------------------------------

function empireRobotCount(galaxy: Galaxy, empire: Empire): number {
    let n = 0;
    for (const t of empire.troops.items) if (isRobotTroop(galaxy, t)) n++;
    return n;
}

function galaxyRobotCount(galaxy: Galaxy): number {
    let n = 0;
    for (const e of normalEmpires(galaxy)) n += empireRobotCount(galaxy, e);
    return n;
}

function mutinyHints(galaxy: Galaxy, st: RobotMutinyState, year: number): void {
    if (year < P.year(galaxy) - 10) return;
    for (const e of normalEmpires(galaxy)) {
        if (empireRobotCount(galaxy, e) >= 10) arcMessage(galaxy, st.sentStages, [e], { prefix: TAG, stage: 'Hint', onceKey: `Hint:${e.empireId}` });
    }
}

/** Robot troops in `habitat`'s garrison that still serve its owner (not the faction). */
function garrisonRobots(galaxy: Galaxy, habitat: Habitat, faction: Empire | null): Troop[] {
    if (habitat.troops === null) return [];
    return habitat.troops.items.filter((t) => isRobotTroop(galaxy, t) && (faction === null || t.empire !== faction));
}

// ---------------------------------------------------------------------------------------------------------------
// Hidden growth: sleepers
// ---------------------------------------------------------------------------------------------------------------

/** Hidden sleepers at `colony` (0 when none). Pure. */
export function mutinySleepersAt(st: RobotMutinyState, colony: Habitat): number {
    for (const s of st.sleepers ?? []) if (s.colony === colony) return s.count;
    return 0;
}

/** Total hidden sleepers galaxy-wide. Pure. */
export function mutinySleeperTotal(st: RobotMutinyState): number {
    let n = 0;
    for (const s of st.sleepers ?? []) n += s.count;
    return n;
}

function setSleepers(st: RobotMutinyState, colony: Habitat, count: number): void {
    const list = (st.sleepers ??= []);
    const i = list.findIndex((s) => s.colony === colony);
    if (count <= 0) {
        if (i >= 0) list.splice(i, 1);
        return;
    }
    if (i >= 0) list[i].count = count;
    else list.push({ colony, count });
}

/**
 * Yearly: every colony (galaxy.habitats order) whose garrison holds ≥ mutinySleeperMinRobots robots of its owner
 * accrues mutinySleepersPerYear hidden sleepers ("built and hidden by the robots themselves"). Lost colonies drop
 * their count. No Rnd.
 */
export function mutinyAccrueSleepers(galaxy: Galaxy, st: RobotMutinyState): void {
    if (sourceNeutralised(st)) return;
    const min = Math.max(1, P.sleeperMinRobots(galaxy));
    const per = Math.max(0, P.sleepersPerYear(galaxy));
    const faction = st.faction;
    st.sleepers = (st.sleepers ?? []).filter((s) => !s.colony.hasBeenDestroyed && s.colony.empire !== null && s.colony.empire !== galaxy.independentEmpire);
    if (per === 0) return;
    for (const h of galaxy.habitats) {
        if (h === null || h.troops === null || h.empire === null || h.empire === galaxy.independentEmpire || h.empire === faction) continue;
        if (h.empire.pirateEmpireBaseHabitat !== null) continue;
        if (garrisonRobots(galaxy, h, faction).length < min) continue;
        setSleepers(st, h, mutinySleepersAt(st, h) + per);
    }
}

/** A sleeper made real: the stock foundry's BattleBot troop (troops.ts 387), full readiness (built in hiding). */
function makeSleeperTroop(galaxy: Galaxy, faction: Empire, name: string): Troop {
    const t = generateNewTroop(name, TroopType.Infantry, ROBOT_TROOP_STRENGTH, faction, null, false);
    t.maintenanceMultiplier = ROBOT_TROOP_MAINTENANCE;
    t.readiness = 100;
    t.pictureRef = galaxy.races.length;
    return t;
}

// ---------------------------------------------------------------------------------------------------------------
// Rising: only where the robots win
// ---------------------------------------------------------------------------------------------------------------

/**
 * The stock ground-war comparison for a rising at `habitat` (Habitat.cs 4435 CalculateForceStrengths, invasion.ts 543,
 * plus the population's share as resolveInvasionBattles adds it): the robots (its owner's garrison robots + the hidden
 * sleepers, as full-readiness foundry troops) attack, every other garrison troop and the colony characters defend.
 * Pure (the sleeper stand-ins are throwaway objects, no description counter touched), no Rnd.
 */
export function mutinyRisingStrengths(galaxy: Galaxy, st: RobotMutinyState, habitat: Habitat, faction: Empire): { robots: number; defenders: number } {
    const attackers = new TroopList();
    for (const t of garrisonRobots(galaxy, habitat, faction)) attackers.add(t);
    const sleepers = mutinySleepersAt(st, habitat);
    for (let i = 0; i < sleepers; i++) attackers.add(makeSleeperTroop(galaxy, faction, ''));
    const defenders = new TroopList();
    if (habitat.troops !== null) for (const t of habitat.troops.items) if (!attackers.contains(t)) defenders.add(t);
    if (attackers.count === 0) return { robots: 0, defenders: defenders.totalDefendStrength };
    const r = calculateForceStrengths(galaxy, habitat, habitat.empire, faction, defenders, stellarObjectCharacters(habitat), attackers, null);
    let defending = r.defendingStrength;
    if (habitat.population != null && defenders.count > 0 && defenders.totalDefendStrength > 0) {
        const ps = calculatePopulationStrength(galaxy, habitat, faction, habitat.empire);
        if (ps.isDefending) defending += ps.result;
    }
    return { robots: r.attackingStrength, defenders: defending };
}

/** True when the robots at `habitat` would beat its other defenders (the rising test). */
export function mutinyRobotsWin(galaxy: Galaxy, st: RobotMutinyState, habitat: Habitat, faction: Empire): boolean {
    const s = mutinyRisingStrengths(galaxy, st, habitat, faction);
    return s.robots > 0 && s.robots > s.defenders;
}

/** Moves a garrisoned robot troop from the colony's defenders to the faction's invaders (§9's rising). */
function mutiniseGarrisonTroop(galaxy: Galaxy, habitat: Habitat, faction: Empire, t: Troop): void {
    const oldEmpire = t.empire as Empire | null;
    habitat.troops?.remove(t);
    if (oldEmpire !== null && oldEmpire !== faction) oldEmpire.troops.remove(t);
    invadeFromInside(galaxy, habitat, faction, [t]);
    if (!faction.troops.contains(t)) faction.troops.add(t);
}

/** The colony rises: sleepers materialise as the faction's BattleBots and rise with the garrison robots. No Rnd. */
export function mutinyRiseAt(galaxy: Galaxy, st: RobotMutinyState, habitat: Habitat, faction: Empire): number {
    const robots = garrisonRobots(galaxy, habitat, faction);
    for (const t of robots) mutiniseGarrisonTroop(galaxy, habitat, faction, t);
    const n = mutinySleepersAt(st, habitat);
    const made: Troop[] = [];
    for (let i = 0; i < n; i++) made.push(makeSleeperTroop(galaxy, faction, faction.generateTroopDescription('BattleBot Group')));
    invadeFromInside(galaxy, habitat, faction, made);
    for (const t of made) if (!faction.troops.contains(t)) faction.troops.add(t);
    setSleepers(st, habitat, 0);
    return robots.length + n;
}

/** Star systems (system-star habitats) holding a live warship of the faction. */
function factionWarshipSystems(faction: Empire): Set<Habitat> {
    const out = new Set<Habitat>();
    for (const b of faction.builtObjects) {
        if (b.hasBeenDestroyed || b.role !== BuiltObjectRole.Military || b.nearestSystemStar === null) continue;
        out.add(b.nearestSystemStar);
    }
    return out;
}

/**
 * Every colony with robots or sleepers (galaxy.habitats order) rises where the robots win, or where a faction warship
 * is in its system (a beacon fleet arriving). Returns the colonies that rose. No Rnd.
 */
export function mutinyRisings(galaxy: Galaxy, st: RobotMutinyState): Habitat[] {
    const faction = st.faction;
    const out: Habitat[] = [];
    if (faction === null || !faction.active || sourceNeutralised(st)) return out;
    const systems = factionWarshipSystems(faction);
    for (const h of galaxy.habitats) {
        if (h === null || h.hasBeenDestroyed || h.empire === null || h.empire === faction) continue;
        if (garrisonRobots(galaxy, h, faction).length === 0 && mutinySleepersAt(st, h) === 0) continue;
        const fleetHere = systems.size > 0 && systems.has(galaxy.determineHabitatSystemStar(h));
        if (!fleetHere && !mutinyRobotsWin(galaxy, st, h, faction)) continue;
        mutinyRiseAt(galaxy, st, h, faction);
        out.push(h);
    }
    return out;
}

/**
 * The rising: every colony holding BattleBots (or hidden sleepers) rises at once, win or lose (the stock ground war
 * decides), and an eighth of the Ancient Guardians' mobile warships (list order, every eighth) defect to the faction.
 * The Guardians stay a separate empire with the rest. No Rnd.
 */
function mutinyUprising(galaxy: Galaxy, st: RobotMutinyState, faction: Empire): void {
    for (const h of galaxy.habitats) {
        if (h === null || h.hasBeenDestroyed || h.empire === null || h.empire === faction) continue;
        if (garrisonRobots(galaxy, h, faction).length === 0 && mutinySleepersAt(st, h) === 0) continue;
        mutinyRiseAt(galaxy, st, h, faction);
    }
    const mech = identifyMechanoidEmpire(galaxy);
    st.turtle = galaxy.rnd.nextDouble() * 100 < P.fullTakeoverPct(galaxy) && mech !== null && mech !== faction && mech.active;
    if (mech === null || mech === faction) return;
    if (st.turtle) {
        // The whole of the Ancient Guardians (homeworld, colonies, ships): they cease to be a separate empire.
        absorbEmpire(galaxy, faction, mech);
        refreshTurtlePresence(galaxy, st);
        return;
    }
    const fleet = mech.builtObjects.filter((b) => !b.hasBeenDestroyed && b.role === BuiltObjectRole.Military && b.topSpeed > 0);
    const take = Math.round((fleet.length * P.guardianSharePct(galaxy)) / 100);
    const step = take > 0 ? fleet.length / take : 0;
    const taken: BuiltObject[] = [];
    for (let i = 0; i < take; i++) taken.push(fleet[Math.floor(i * step)]);
    for (const b of taken) {
        flipToFaction(galaxy, b, faction);
        b.isAutoControlled = true;
        b.supportCostFactor = 0;
    }
    st.beaconShips!.push(...taken);
    if (st.source !== null) formBeaconFleets(galaxy, faction, st.source, taken.filter((b) => b.shipGroup === null));
}

/** Turtle: where the Broadcast has colonies or stations (its warships act only there). No Rnd. */
function refreshTurtlePresence(galaxy: Galaxy, st: RobotMutinyState): void {
    const f = st.faction;
    const pts: { x: number; y: number }[] = [];
    if (f !== null && f.active) {
        for (const c of f.colonies) pts.push({ x: c.xpos, y: c.ypos });
        for (const b of f.builtObjects) if (!b.hasBeenDestroyed && b.role === BuiltObjectRole.Base) pts.push({ x: b.xpos, y: b.ypos });
    }
    st.turtlePresence = pts;
    void galaxy;
}

/**
 * assignMissionAllowed (BuiltObject.2.cs 7620), the turtle's posture (as the Concord's passive posture, rimTrade/passive.ts):
 * its warships take missions only within STATION_RANGE of its own colonies and stations (build, patrol, defend, attack
 * intruders there), plus escorting its own construction ships. Everything else (building, mining, colonising) is the
 * stock AI untouched. Pure.
 */
export function turtleMissionAllowed(galaxy: Galaxy, value: boolean, args: { builtObject: BuiltObject; missionType: number; target: unknown; x: number; y: number }): boolean {
    if (!value) return value;
    const st = peekRobotMutinyState(galaxy);
    const bo = args.builtObject;
    if (st === null || st.turtle !== true || st.faction === null || bo.actualEmpire !== st.faction || bo.role !== BuiltObjectRole.Military) return value;
    const t = args.target as { xpos?: number; ypos?: number; subRole?: number; actualEmpire?: unknown } | null;
    if (args.missionType === BuiltObjectMissionType.Escort && t !== null && t.actualEmpire === st.faction && t.subRole === BuiltObjectSubRole.ConstructionShip) return value;
    const x = t !== null && typeof t === 'object' && typeof t.xpos === 'number' ? t.xpos : args.x;
    const y = t !== null && typeof t === 'object' && typeof t.ypos === 'number' ? (t.ypos as number) : args.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return value;
    for (const q of st.turtlePresence ?? []) if (galaxy.calculateDistance(q.x, q.y, x, y) <= STATION_RANGE) return value;
    return false;
}

const FOUND_TYPES = [HabitatType.Continental, HabitatType.Ocean, HabitatType.MarshySwamp, HabitatType.Desert, HabitatType.Ice, HabitatType.Volcanic];

/** Founds up to mutinyFoundWorlds full colonies on good empty planets nearest the transmitter (the machines' economy from day one). */
function foundWorlds(galaxy: Galaxy, st: RobotMutinyState, faction: Empire): void {
    const src = st.source;
    const race = faction.dominantRace;
    if (src === null || race === null) return;
    const list: { h: Habitat; d: number }[] = [];
    for (const h of galaxy.habitats) {
        if (h === null || h.hasBeenDestroyed || h.empire !== null || h.population.totalAmount > 0 || h === src) continue;
        if ((h.category !== HabitatCategoryType.Planet && h.category !== HabitatCategoryType.Moon) || h.quality < 0.3 || !FOUND_TYPES.includes(h.type)) continue;
        if (h.basesAtHabitat != null && h.basesAtHabitat.length > 0) continue;
        list.push({ h, d: galaxy.calculateDistance(src.xpos, src.ypos, h.xpos, h.ypos) });
    }
    list.sort((a, b) => a.d - b.d || galaxy.habitats.indexOf(a.h) - galaxy.habitats.indexOf(b.h));
    const n = Math.min(P.foundWorlds(galaxy), list.length);
    for (let i = 0; i < n; i++) {
        const h = list[i].h;
        faction.capital = null;
        makeHabitatIntoColonyRuntime(galaxy, faction, h, faction, race, 1e6);
        recalculateMaximumPopulation(h);
        if (h.maxPopulation > h.population.totalAmount) {
            h.population.items[0].amount = h.maxPopulation; // a full world
            h.population.recalculateTotalAmount();
        }
        reviewEmpireTerritory(galaxy, true);
        scenarioEmit(galaxy, 'colonyFounded', { colony: h, empire: faction, joined: false });
    }
    if (faction.colonies.length > 0 && (faction.capital === null || faction.capital.empire !== faction)) faction.capital = faction.colonies[0];
    if (faction.colonies.length > 0) st.provisionalCapital = false;
}

// ---------------------------------------------------------------------------------------------------------------
// Trigger
// ---------------------------------------------------------------------------------------------------------------

export function mutinyTrigger(galaxy: Galaxy, st: RobotMutinyState): boolean {
    ensureFields(st);
    const tech = beaconTechLevel(galaxy, null);
    // At war with everyone but the independents, for good (locked): a plain aggressive machine empire at tech level mutinyStartTech.
    const enemies = galaxy.empires.filter((e): e is Empire => e !== null && e.active && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null);
    const faction = createThreatFaction(galaxy, { race: 'Harvester', name: scenarioText(`${TAG} Faction Name`), enemies, techLevel: P.startTech(galaxy) });
    if (faction === null) return false;
    void tech;
    st.faction = faction;
    st.triggered = true;
    st.risingYear = gameYear(galaxyStarDate(galaxy));
    faction.mainColor = P.colorMain(galaxy);
    faction.secondaryColor = P.colorSecondary(galaxy);
    provisionCapital(st);
    mutinyUprising(galaxy, st, faction); // every BattleBot garrison defects; the Guardians lend an eighth of their fleet
    for (const e of normalEmpires(galaxy, faction)) {
        for (const bo of [...e.builtObjects]) {
            if (bo.hasBeenDestroyed || bo.troops === null || bo.troops.count === 0) continue;
            const robotCount = bo.troops.items.filter((t) => isRobotTroop(galaxy, t)).length;
            if (robotCount * 2 <= bo.troops.count) continue; // majority-robot only
            if (galaxy.rnd.next(0, 100) >= P.shipFlipPct(galaxy)) continue;
            flipToFaction(galaxy, bo, faction);
            for (const t of [...bo.troops.items]) {
                t.empire = faction;
                if (!faction.troops.contains(t)) faction.troops.add(t);
            }
        }
    }
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Trigger', textTag: `${TAG} Trigger News` });
    for (const e of normalEmpires(galaxy, faction)) arcMessage(galaxy, st.sentStages, [e], { prefix: TAG, stage: 'Trigger' });
    mutinyBeacon(galaxy, st, st.risingYear);
    if (st.turtle !== true) {
        spawnTransports(galaxy, st, faction, st.source!, P.initialTransports(galaxy) * REGIMENTS_PER_TRANSPORT);
        foundWorlds(galaxy, st, faction);
    }
    return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Empire on capture
// ---------------------------------------------------------------------------------------------------------------

/**
 * The faction's first colony makes it a full empire. The colony itself already changed hands through the stock
 * conquest (resolveInvasionBattles → takeOwnershipOfColony, which also picks the capital: Empire.1.cs 54 via
 * selectBestCandidateForCapital) — the hand-over pirateAmbition does with takeOwnershipOfColonyFull. What is left is
 * the control hand-over: its own empire name, and the Harvester race set Expanding so the stock AI's expansion gates (Empire.1.cs 3503) open. The AI
 * automation itself is the Empire ctor's (Empire.cs AI defaults), already on. No Rnd. Returns true when converted.
 */
export function mutinyBecomeEmpire(galaxy: Galaxy, st: RobotMutinyState): boolean {
    const faction = st.faction;
    if (faction === null || !faction.active || st.becameEmpire === true || faction.colonies.length === 0) return false;
    st.becameEmpire = true;
    const first = faction.colonies[0];
    faction.name = scenarioText(`${TAG} Empire Name`);
    if (faction.dominantRace !== null) faction.dominantRace.expanding = true;
    if (faction.capital === null || st.provisionalCapital === true) faction.capital = first;
    st.provisionalCapital = false;
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Empire', args: [first.name, faction.name], subject: first });
    return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Beacon fleets
// ---------------------------------------------------------------------------------------------------------------

/** Tech levels ≥ this are the story super weapons (Death Ray 100, Super Laser 101), not the regular tech ladder. */
const SPECIAL_TECH_LEVEL = 100;

/**
 * An empire's tech level: the highest tech level among its researched projects (at least 1; darkFarms hostTechLevel),
 * the special super-weapon levels excluded.
 */
export function empireTechLevel(e: Empire): number {
    let max = 1;
    for (const n of e.research.techTree) if (n.isResearched && n.def.techLevel > max && n.def.techLevel < SPECIAL_TECH_LEVEL) max = n.def.techLevel;
    return max;
}

/**
 * The highest tech level the design generator reaches: the top regular component definition level (Component.cs
 * EvaluateLatest picks components with TechLevel ≤ the level; 7 in the stock components.txt).
 */
export function maxDesignTechLevel(galaxy: Galaxy): number {
    let max = 0;
    for (const d of galaxy.researchStatic?.componentStatic?.definitions ?? []) if (d.techLevel > max && d.techLevel < SPECIAL_TECH_LEVEL) max = d.techLevel;
    return max;
}

/** Beacon tech level: the best regular empire's tech level + mutinyTechBonus, clamped to the generator's maximum. */
export function beaconTechLevel(galaxy: Galaxy, faction: Empire | null): number {
    let best = 1;
    for (const e of normalEmpires(galaxy, faction)) best = Math.max(best, empireTechLevel(e));
    const max = maxDesignTechLevel(galaxy);
    const lvl = Math.trunc(best + P.techBonus(galaxy));
    return max > 0 ? Math.min(lvl, max) : lvl;
}

/** The strongest normal empire's military firepower (militaryPotency, as Generation Ships measures it); not pirates, independents, story or add-on factions. */
export function strongestEmpireFirepower(galaxy: Galaxy, faction: Empire | null): number {
    const mech = identifyMechanoidEmpire(galaxy);
    const shak = identifyShakturiEmpire(galaxy);
    const concord = rimTraderEmpire(galaxy);
    let best = 0;
    for (const e of normalEmpires(galaxy, faction)) {
        if (e === mech || e === shak || e === concord || isHerderEmpire(galaxy, e)) continue;
        best = Math.max(best, militaryPotency(e));
    }
    return best;
}

/**
 * Total Broadcast fleet firepower wanted in year `yearIndex` after the rising (1 = the rising year): the strongest normal
 * empire's x mutinyBeaconFirepowerPct (130 %), +mutinyBeaconGrowthPct (10 points) per later year up to mutinyBeaconMaxPct (180 %),
 * never below mutinyBeaconMinFirepower, all x mutinyBeaconScalePct. Pure.
 */
export function beaconFirepowerTarget(galaxy: Galaxy, faction: Empire | null, yearIndex: number): number {
    const pct = Math.min(P.beaconMaxPct(galaxy), P.beaconFirepowerPct(galaxy) + P.beaconGrowthPct(galaxy) * Math.max(0, yearIndex - 1));
    const want = Math.max(P.beaconMinFirepower(galaxy), (strongestEmpireFirepower(galaxy, faction) * pct) / 100);
    return Math.max(0, (want * P.beaconScalePct(galaxy)) / 100);
}

/** Raises the faction's tech tree to `lvl` (the construction sizes the designs need): SetTechTreeLevel's rule, only upward. */
export function raiseFactionTech(galaxy: Galaxy, faction: Empire, lvl: number): void {
    const race = faction.dominantRace;
    const allowed = galaxy.researchStatic?.allowedRaces;
    let changed = false;
    for (const n of faction.research.techTree) {
        if (n.isResearched || n.def.techLevel > lvl) continue;
        const a = allowed?.get(n.def.projectId);
        if (a !== undefined && (race === null || !a.has(race.name))) continue;
        n.isResearched = true;
        n.selfResearched = true;
        n.progress = n.cost;
        changed = true;
    }
    if (!changed) return;
    faction.research.update(race);
    faction.reviewResearchAbilities();
    faction.reviewDesignsBuiltObjectsImprovedComponents();
}

const BEACON_SUBROLES = [BuiltObjectSubRole.Escort, BuiltObjectSubRole.Frigate, BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.Cruiser, BuiltObjectSubRole.CapitalShip, BuiltObjectSubRole.Carrier];

/** Beacon designs at `lvl` (Empire.10.cs GenerateDesignFromSpec(spec, techLevel), as generateSuperPirateFaction). Draws Rnd (naming). */
function beaconDesigns(galaxy: Galaxy, st: RobotMutinyState, faction: Empire, lvl: number): Design[] {
    if (st.beaconTech === lvl && (st.beaconDesigns ?? []).length > 0) return st.beaconDesigns!;
    raiseFactionTech(galaxy, faction, lvl);
    const now = galaxyStarDate(galaxy);
    const out: Design[] = [];
    for (const sub of BEACON_SUBROLES) {
        const spec = faction.designSpecifications.find((s) => s !== null && s.subRole === sub) ?? galaxyDesignSpecificationBySubRole(sub);
        if (spec === null || spec === undefined) continue;
        let d: Design | null = null;
        try {
            d = generateDesignFromSpec(galaxy, faction, spec, lvl, now);
        } catch {
            d = null;
        }
        if (d === null) continue;
        faction.designs.push(d);
        out.push(d);
    }
    st.beaconTech = lvl;
    st.beaconDesigns = out;
    st.beaconTransportDesign = null;
    const tspec = faction.designSpecifications.find((x) => x !== null && x.subRole === BuiltObjectSubRole.TroopTransport) ?? galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.TroopTransport);
    if (tspec !== null && tspec !== undefined) {
        try {
            const td = generateDesignFromSpec(galaxy, faction, tspec, lvl, now);
            if (td !== null) {
                faction.designs.push(td);
                st.beaconTransportDesign = td;
            }
        } catch {
            st.beaconTransportDesign = null;
        }
    }
    return out;
}

/** GenerateMilitaryConvoy's ship-type roll (Galaxy.8.cs 1474: Next(0, 10)), warships only (its transport slot → Cruiser). */
function pickBeaconDesign(galaxy: Galaxy, designs: Design[]): Design | null {
    const roll = galaxy.rnd.next(0, 10);
    const want =
        roll === 0 ? BuiltObjectSubRole.Escort
        : roll <= 2 ? BuiltObjectSubRole.Frigate
        : roll <= 4 ? BuiltObjectSubRole.Destroyer
        : roll <= 6 || roll === 8 ? BuiltObjectSubRole.Cruiser
        : roll === 7 ? BuiltObjectSubRole.CapitalShip
        : BuiltObjectSubRole.Carrier;
    return designs.find((d) => d.subRole === want) ?? designs[designs.length - 1] ?? null;
}

function beaconAlive(faction: Empire, b: BuiltObject): boolean {
    return !b.hasBeenDestroyed && b.actualEmpire === faction;
}

/** Live beacon warships. Pure. */
export function beaconShipCount(st: RobotMutinyState): number {
    const f = st.faction;
    if (f === null) return 0;
    let n = 0;
    for (const b of st.beaconShips ?? []) if (beaconAlive(f, b)) n++;
    return n;
}

/**
 * Yearly (and at the rising): the transmitter replenishes its warships to this year's target, spawned at the ruin
 * world as GenerateMilitaryConvoy does (Galaxy.8.cs 1474: GenerateNewBuiltObject at a parking point +
 * TakeOwnershipOfBuiltObject, support cost factor, auto-controlled) and gathered into Attack-posture fleets
 * (ShipGroupTasks new-fleet block, shipGroupTasks.ts 3522). Draws Rnd. Returns the ships spawned.
 */
export function mutinyBeacon(galaxy: Galaxy, st: RobotMutinyState, year: number): BuiltObject[] {
    ensureFields(st);
    const faction = st.faction;
    const source = st.source;
    if (faction === null || !faction.active || source === null || sourceNeutralised(st) || st.risingYear! < 0) return [];
    if (st.beaconYear === year) return [];
    st.beaconYear = year;
    st.beaconShips = st.beaconShips!.filter((b) => beaconAlive(faction, b));
    const target = beaconFirepowerTarget(galaxy, faction, year - st.risingYear! + 1);
    const designs = beaconDesigns(galaxy, st, faction, beaconTechLevel(galaxy, faction));
    let have = militaryPotency(faction);
    if (have >= target || designs.length === 0) return [];
    const spawned: BuiltObject[] = [];
    for (let i = 0; i < BEACON_MAX_SPAWN && have < target; i++) {
        const design = pickBeaconDesign(galaxy, designs);
        if (design === null) break;
        const pt = galaxy.selectRelativeParkingPoint();
        const bo = generateNewBuiltObject(galaxy, faction, design, null, source.xpos + pt.x, source.ypos + pt.y);
        takeOwnershipOfBuiltObject(galaxy, faction, bo, faction, false);
        bo.supportCostFactor = 0; // fed by the transmitter: no upkeep
        bo.isAutoControlled = true;
        spawned.push(bo);
        const fp = calculateOverallStrengthFactorWithoutShields(bo);
        if (!(fp > 0)) break;
        have += fp;
    }
    st.beaconShips.push(...spawned);
    st.beaconSpawned = (st.beaconSpawned ?? 0) + spawned.length;
    spawnBeaconTransports(galaxy, st, faction, source, spawned);
    formBeaconFleets(galaxy, faction, source, spawned);
    if (spawned.length > 0) arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Beacon', args: [source.name], subject: source });
    return spawned;
}

/** Regiments carried per beacon troop transport. */
const REGIMENTS_PER_TRANSPORT = 6;
/** Escorts within this of the target count as on station; defending warships within it block a landing. */
const STATION_RANGE = 8000;
const LANDING_RANGE = 3000;

/**
 * Troop transports for the new warships, scaled with them: mutinyRegimentStrength-strength BattleBots, one regiment per
 * mutinyRegimentFirepower of new warship firepower (at least 2), REGIMENTS_PER_TRANSPORT to a ship. Draws Rnd.
 */
function spawnBeaconTransports(galaxy: Galaxy, st: RobotMutinyState, faction: Empire, source: Habitat, warships: BuiltObject[]): void {
    if (warships.length === 0) return;
    let fp = 0;
    for (const b of warships) fp += calculateOverallStrengthFactorWithoutShields(b);
    spawnTransports(galaxy, st, faction, source, Math.max(2, Math.round(fp / Math.max(1, P.regimentFirepower(galaxy)))));
}

/** `regiments` BattleBot regiments on new transports beside the transmitter. Draws Rnd. */
function spawnTransports(galaxy: Galaxy, st: RobotMutinyState, faction: Empire, source: Habitat, regiments: number): void {
    const design = st.beaconTransportDesign ?? null;
    if (design === null) return;
    let left = regiments;
    while (left > 0) {
        const pt = galaxy.selectRelativeParkingPoint();
        const bo = generateNewBuiltObject(galaxy, faction, design, null, source.xpos + pt.x, source.ypos + pt.y);
        takeOwnershipOfBuiltObject(galaxy, faction, bo, faction, false);
        bo.supportCostFactor = 0;
        const k = Math.min(REGIMENTS_PER_TRANSPORT, left);
        loadTroopsOnto(bo, faction, Array.from({ length: k }, () => makeRobotTroop(galaxy, faction, P.regimentStrength(galaxy), faction.generateTroopDescription('BattleBot Group'))));
        st.beaconTransports!.push(bo);
        left -= k;
    }
}

/** The weakly defended colonies of normal empires nearest the transmitter: lowest garrison strength first. Pure. */
export function assaultCandidates(galaxy: Galaxy, st: RobotMutinyState): Habitat[] {
    const src = st.source;
    const faction = st.faction;
    if (src === null || faction === null) return [];
    const list: { h: Habitat; d: number }[] = [];
    for (const e of normalEmpires(galaxy, faction)) {
        for (const c of e.colonies) {
            if (c.hasBeenDestroyed || c.population.totalAmount <= 0) continue;
            list.push({ h: c, d: galaxy.calculateDistance(src.xpos, src.ypos, c.xpos, c.ypos) });
        }
    }
    list.sort((a, b) => a.d - b.d || a.h.name.localeCompare(b.h.name));
    const near = list.slice(0, Math.max(1, P.assaultCandidates(galaxy))).map((x) => x.h);
    const def = (h: Habitat) => (h.troops !== null ? h.troops.totalDefendStrength : 0);
    return near.sort((a, b) => def(a) - def(b));
}

/**
 * The beacon's war (periodic): fleets attack the weakest colony near the transmitter; the transports stage short of it,
 * then land (invadeFromInside, the stock ground war resolves it) once the defending warships are gone and the robots
 * out-number the garrison. Missions only, no Rnd.
 */
function directAssault(galaxy: Galaxy, st: RobotMutinyState): void {
    const faction = st.faction;
    const src = st.source;
    if (faction === null || !faction.active || src === null || st.turtle === true) return;
    st.beaconTransports = st.beaconTransports!.filter((b) => beaconAlive(faction, b));
    let target = st.assaultTarget ?? null;
    if (target !== null && (target.hasBeenDestroyed || target.empire === faction || target.empire === null)) target = null;
    if (target === null) {
        target = assaultCandidates(galaxy, st)[0] ?? null;
        st.assaultTarget = target;
    }
    if (target === null) return;
    const holder = target.empire!;
    const ships = faction.builtObjects.filter((b) => !b.hasBeenDestroyed && b.role === BuiltObjectRole.Military && b.topSpeed > 0 && b.troopCapacity <= 0);
    let onStation = 0;
    for (const bo of ships) {
        if (galaxy.calculateDistance(bo.xpos, bo.ypos, target.xpos, target.ypos) <= STATION_RANGE) onStation++;
        const m = builtObjectMission(bo.mission);
        if (m === null || m.type !== BuiltObjectMissionType.Attack || m.targetHabitat !== target) assignMission(galaxy, bo, BuiltObjectMissionType.Attack, target, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
    }
    let defenders = 0;
    for (const b of holder.builtObjects) {
        if (b.hasBeenDestroyed || b.role !== BuiltObjectRole.Military || b.topSpeed <= 0) continue;
        if (galaxy.calculateDistance(b.xpos, b.ypos, target.xpos, target.ypos) <= STATION_RANGE) defenders++;
    }
    const garrison = target.troops !== null ? target.troops.totalDefendStrength : 0;
    let robots = 0;
    for (const bo of st.beaconTransports!) if (bo.troops !== null) robots += bo.troops.totalAttackStrength;
    const clear = defenders === 0 && (ships.length === 0 || onStation * 2 >= ships.length) && robots > garrison * 1.5;
    const dx = src.xpos - target.xpos;
    const dy = src.ypos - target.ypos;
    const dl = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const stageX = target.xpos + (dx / dl) * STATION_RANGE * 3;
    const stageY = target.ypos + (dy / dl) * STATION_RANGE * 3;
    const landing: Troop[] = [];
    for (const bo of st.beaconTransports!) {
        if (bo.troops === null || bo.troops.count === 0) continue;
        if (clear && galaxy.calculateDistance(bo.xpos, bo.ypos, target.xpos, target.ypos) <= LANDING_RANGE) {
            landing.push(...bo.troops.items);
            bo.troops.clear();
            for (const t of landing) t.builtObject = null;
            continue;
        }
        const m = builtObjectMission(bo.mission);
        if (clear) {
            if (m === null || m.type !== BuiltObjectMissionType.Move || m.targetHabitat !== target) assignMission(galaxy, bo, BuiltObjectMissionType.Move, target, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
        } else if (galaxy.calculateDistance(bo.xpos, bo.ypos, stageX, stageY) > LANDING_RANGE && (m === null || m.type !== BuiltObjectMissionType.Move || m.targetHabitat !== null)) {
            assignMission(galaxy, bo, BuiltObjectMissionType.Move, null, null, BuiltObjectMissionPriority.High, { x: stageX, y: stageY, manuallyAssigned: true });
        }
    }
    if (landing.length > 0) {
        invadeFromInside(galaxy, target, faction, landing);
        st.assaultLandings = (st.assaultLandings ?? 0) + 1;
    }
}

/** The new warships gather at the transmitter in fleets of BEACON_FLEET_SIZE, posture Attack (stock fleet AI tasks them). */
export function formBeaconFleets(galaxy: Galaxy, faction: Empire, source: Habitat, ships: BuiltObject[], posture: FleetPosture = FleetPosture.Attack): void {
    const shipGroups = empireShipGroups(faction);
    for (let i = 0; i < ships.length; i += BEACON_FLEET_SIZE) {
        const batch = ships.slice(i, i + BEACON_FLEET_SIZE).filter((b) => b.shipGroup === null);
        if (batch.length === 0) continue;
        const g = new ShipGroup(galaxy);
        g.empire = faction;
        g.shipTargetAmount = batch.length;
        g.troopTargetStrength = 0;
        g.gatherPoint = source;
        addShipsToShipGroup(galaxy, faction, g, batch, batch.length, true, source);
        if (g.ships.length === 0) continue;
        g.name = `${getNextFleetNumberDescription(faction)} Fleet`;
        g.posture = posture;
        shipGroups.push(g);
        netSort(shipGroups, compareShipGroups);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Discovery / defusal / AI
// ---------------------------------------------------------------------------------------------------------------

function agentWatchesCounterIntelligence(c: Character): boolean {
    if (c.role !== CharacterRole.IntelligenceAgent || !c.active) return false;
    const m = c.mission as IntelligenceMission | null;
    return m !== null && m.type === COUNTER_INTELLIGENCE;
}

function mutinyDiscovery(galaxy: Galaxy, st: RobotMutinyState): void {
    if (st.source === null) return;
    const pct = P.sourceDetectPct(galaxy) / 100;
    if (pct <= 0) return;
    for (const e of normalEmpires(galaxy, st.faction)) {
        if (empireRobotCount(galaxy, e) === 0) continue;
        if (knowledgeLevel({ knowledge: st.sourceKnowledge }, e) >= KNOWLEDGE_CONFIRMED) continue;
        const watching = getEmpireCharacters(e).some(agentWatchesCounterIntelligence);
        if (!watching) continue;
        if (galaxy.rnd.nextDouble() < pct) {
            revealTo(galaxy, { knowledge: st.sourceKnowledge }, e, KNOWLEDGE_CONFIRMED);
            arcMessage(galaxy, st.sentStages, [e], { prefix: TAG, stage: 'Source Found', onceKey: `Source Found:${e.empireId}`, args: [st.source.name], subject: st.source });
        }
    }
}

/** §9 AI: an empire at knowledge level 3 stops recruiting robots (policy colonyAllowFacilityRoboticTroopFoundry = false). */
function aiStopRecruiting(galaxy: Galaxy, st: RobotMutinyState): void {
    for (const e of normalEmpires(galaxy, st.faction)) {
        if (st.stoppedRecruiting.includes(e.empireId)) continue;
        if (knowledgeLevel({ knowledge: st.sourceKnowledge }, e) < KNOWLEDGE_CONFIRMED) continue;
        if (e.policy !== null) e.policy.colonyAllowFacilityRoboticTroopFoundry = false;
        st.stoppedRecruiting.push(e.empireId);
    }
}

/** A troop other than the faction's on the source (a landing / colonising it), or the source destroyed. */
function sourceOccupied(st: RobotMutinyState): boolean {
    const s = st.source;
    if (s === null) return false;
    if (s.hasBeenDestroyed) return true;
    if (s.troops === null || s.troops.count === 0) return false;
    return st.faction === null || s.troops.items.some((t) => t.empire !== st.faction);
}

/**
 * §9 counterplay: a troop landing on the source (present in `source.troops`) defuses it before the trigger (game end:
 * contained); after the trigger it silences the transmitter (no more sleepers, risings or beacon warships).
 */
function checkDefused(galaxy: Galaxy, st: RobotMutinyState): void {
    if (st.sourceTaken || st.source === null || !sourceOccupied(st)) return;
    st.sourceTaken = true;
    if (st.triggered) {
        arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Silenced', args: [st.source.name] });
        return;
    }
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Defused', args: [st.source.name] });
    // Defused before it ever triggered: only this threat's story ends (no mutiny will come), the game carries on (user 2026-10-17: a threat
    // contained before it materialised is not a victory condition).
    st.ended = true;
}

// ---------------------------------------------------------------------------------------------------------------
// Yearly / periodic
// ---------------------------------------------------------------------------------------------------------------

export function mutinyYearly(galaxy: Galaxy, year: number): void {
    if (!threatExists(galaxy, ROBOT_MUTINY_KEY)) return; // §0 rarity: not this game — no state, no draws (minimal guard: shared with the reworked branch).
    const st = robotMutinyState(galaxy);
    ensureFields(st);
    if (st.ended) return;
    if (!st.seeded) {
        const startYear = gameYear(startStarDateForAge(galaxy.age));
        if (year >= startYear && pastThreatMinYear(galaxy, ROBOT_MUTINY_KEY, year)) mutinySeed(galaxy, st); // §0 timing floor
    }
    mutinyHints(galaxy, st, year);
    checkDefused(galaxy, st);
    if (st.ended) return;
    mutinyAccrueSleepers(galaxy, st);
    if (!st.triggered && !sourceNeutralised(st) && year >= P.year(galaxy) && pastThreatMinYear(galaxy, ROBOT_MUTINY_KEY, year) && galaxyRobotCount(galaxy) >= P.minRobots(galaxy)) {
        mutinyTrigger(galaxy, st);
    } else if (st.triggered) {
        mutinyBeacon(galaxy, st, year);
    }
}

export function mutinyPeriodic(galaxy: Galaxy): void {
    const st = peekRobotMutinyState(galaxy);
    if (st === null || st.ended) return;
    ensureFields(st);
    checkDefused(galaxy, st);
    if (st.ended) return;
    if (st.triggered) mutinyRisings(galaxy, st);
    if (st.triggered && st.turtle === true) refreshTurtlePresence(galaxy, st);
    if (st.triggered && !sourceNeutralised(st)) directAssault(galaxy, st);
    mutinyDiscovery(galaxy, st);
    aiStopRecruiting(galaxy, st);
    if (st.faction === null) return;
    mutinyBecomeEmpire(galaxy, st);
    provisionCapital(st);
    if (st.faction.active && factionPopulationSharePct(galaxy, st.faction) >= P.defeatPopulationPct(galaxy)) {
        arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Defeat', args: [Math.round(factionPopulationSharePct(galaxy, st.faction))] });
        if (threatsGameEndOn(galaxy)) {
            st.ended = true;
            threatGameEnd(galaxy, st.faction, GameEndOutcome.Defeat, scenarioText(`${TAG} Defeat Title`), ROBOT_MUTINY_CODE_DEFEAT);
        }
        return;
    }
    // While the transmitter lives the faction is never "dead": the beacon rebuilds it next year.
    if (sourceNeutralised(st) && teardownIfDead(galaxy, st.faction)) {
        arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Contained' });
        if (threatsGameEndOn(galaxy)) {
            st.ended = true;
            threatGameEnd(galaxy, galaxy.playerEmpire, GameEndOutcome.Victory, scenarioText(`${TAG} Victory Title`), ROBOT_MUTINY_CODE_CONTAINED, true);
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------------------------

/** Game Editor: null when the mutiny can start now. Pure. */
export function robotMutinySpawnNote(galaxy: Galaxy): string | null {
    const st = peekRobotMutinyState(galaxy);
    if (st !== null && (st.triggered || st.ended)) return st.ended ? 'Already over' : 'Already risen';
    if (!galaxy.races.some((r) => r !== null && r.name === 'Harvester')) return 'Needs the add-on on at game start';
    return galaxy.ruinsHabitats.some((h) => h !== null && !h.hasBeenDestroyed) || (st?.source ?? null) !== null ? null : 'No ruin world for the transmitter';
}

/**
 * Game Editor: the transmitter is chosen, hidden BattleBot sleepers are planted in the player's three biggest colonies
 * (the rising there is decided by the stock ground war) and the mutiny rises now.
 */
export function robotMutinySpawnNow(galaxy: Galaxy, victim: Empire): boolean {
    const st = robotMutinyState(galaxy);
    ensureFields(st);
    mutinySeed(galaxy, st);
    if (st.source === null) return false;
    const hosts = [...victim.colonies].filter((h) => !h.hasBeenDestroyed && h.troops !== null).sort((a, b) => b.population.totalAmount - a.population.totalAmount).slice(0, 3);
    for (const h of hosts) setSleepers(st, h, mutinySleepersAt(st, h) + Math.max(20, P.sleepersPerYear(galaxy) * 2));
    return mutinyTrigger(galaxy, st);
}

export const ROBOT_MUTINY_HANDLER_IDS = ['robotMutiny.yearly', 'robotMutiny.periodic'] as const;

export function registerRobotMutiny(): void {
    registerThreatExistence(ROBOT_MUTINY_KEY, ROBOT_MUTINY_FLAG);
    registerThreatSpawn({ key: ROBOT_MUTINY_KEY, label: 'The Robot Mutiny', group: 'galactic', addons: ['robotmutiny', 'darkfarms'], note: robotMutinySpawnNote, spawn: robotMutinySpawnNow });
    registerScenarioYearly({ id: 'robotMutiny.yearly', flag: ROBOT_MUTINY_FLAG, order: 10, run: mutinyYearly });
    registerScenarioQuery({ id: 'robotMutiny.turtle', flag: ROBOT_MUTINY_FLAG, query: 'assignMissionAllowed', run: turtleMissionAllowed });
    registerScenarioPeriodic({ id: 'robotMutiny.periodic', flag: ROBOT_MUTINY_FLAG, periodDays: PERIOD_DAYS, order: 10, run: mutinyPeriodic });
}

registerRobotMutiny();
