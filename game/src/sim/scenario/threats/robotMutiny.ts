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
//     for that year (mutinyBeaconShipsYear1/2/3 × mutinyBeaconScalePct %), designs at the best regular empire's tech
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
import { FleetPosture } from '../../diplomacyTick';
import { ShipGroup, empireShipGroups } from '../../fleets/shipGroup';
import { addShipsToShipGroup, compareShipGroups, getNextFleetNumberDescription } from '../../fleets/shipGroupTasks';
import { netSort } from '../../netSort';
import { gameYear, registerScenarioPeriodic, registerScenarioYearly } from '../hooks';
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
    knowledgeLevel,
    normalEmpires,
    peekThreatState,
    revealTo,
    teardownIfDead,
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
    beaconYear1: (g: Galaxy) => p(g, 'mutinyBeaconShipsYear1', 100),
    beaconYear2: (g: Galaxy) => p(g, 'mutinyBeaconShipsYear2', 200),
    beaconYear3: (g: Galaxy) => p(g, 'mutinyBeaconShipsYear3', 300),
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

// ---------------------------------------------------------------------------------------------------------------
// Trigger
// ---------------------------------------------------------------------------------------------------------------

export function mutinyTrigger(galaxy: Galaxy, st: RobotMutinyState): boolean {
    ensureFields(st);
    const tech = beaconTechLevel(galaxy, null);
    const faction = createThreatFaction(galaxy, { race: 'Harvester', name: scenarioText(`${TAG} Faction Name`), enemies: normalEmpires(galaxy), techLevel: tech });
    if (faction === null) return false;
    st.faction = faction;
    st.triggered = true;
    st.risingYear = gameYear(galaxyStarDate(galaxy));
    mutinyRisings(galaxy, st); // colonies rise only where their robots win (no faction warship exists yet)
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
    return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Empire on capture
// ---------------------------------------------------------------------------------------------------------------

/**
 * The faction's first colony makes it a full empire. The colony itself already changed hands through the stock
 * conquest (resolveInvasionBattles → takeOwnershipOfColony, which also picks the capital: Empire.1.cs 54 via
 * selectBestCandidateForCapital) — the hand-over pirateAmbition does with takeOwnershipOfColonyFull. What is left is
 * the control hand-over: its own empire name, the locked threat wars released to the stock diplomacy (war review,
 * peace), and the Harvester race set Expanding so the stock AI's expansion gates (Empire.1.cs 3503) open. The AI
 * automation itself is the Empire ctor's (Empire.cs AI defaults), already on. No Rnd. Returns true when converted.
 */
export function mutinyBecomeEmpire(galaxy: Galaxy, st: RobotMutinyState): boolean {
    const faction = st.faction;
    if (faction === null || !faction.active || st.becameEmpire === true || faction.colonies.length === 0) return false;
    st.becameEmpire = true;
    const first = faction.colonies[0];
    faction.name = scenarioText(`${TAG} Empire Name`);
    if (faction.dominantRace !== null) faction.dominantRace.expanding = true;
    for (const other of galaxy.empires) {
        if (other === null || other === faction) continue;
        const a = obtainDiplomaticRelation(faction, other);
        const b = obtainDiplomaticRelation(other, faction);
        a.locked = false;
        b.locked = false;
    }
    if (faction.capital === null) faction.capital = first;
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

/** Beacon target for year `yearIndex` after the rising (1 = the rising year), scaled by mutinyBeaconScalePct. */
export function beaconTarget(galaxy: Galaxy, yearIndex: number): number {
    const base = yearIndex <= 1 ? P.beaconYear1(galaxy) : yearIndex === 2 ? P.beaconYear2(galaxy) : P.beaconYear3(galaxy);
    return Math.max(0, Math.round((base * P.beaconScalePct(galaxy)) / 100));
}

/** Raises the faction's tech tree to `lvl` (the construction sizes the designs need): SetTechTreeLevel's rule, only upward. */
function raiseFactionTech(galaxy: Galaxy, faction: Empire, lvl: number): void {
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
    const target = beaconTarget(galaxy, year - st.risingYear! + 1);
    const need = target - st.beaconShips.length;
    if (need <= 0) return [];
    const designs = beaconDesigns(galaxy, st, faction, beaconTechLevel(galaxy, faction));
    if (designs.length === 0) return [];
    const spawned: BuiltObject[] = [];
    for (let i = 0; i < need; i++) {
        const design = pickBeaconDesign(galaxy, designs);
        if (design === null) break;
        const pt = galaxy.selectRelativeParkingPoint();
        const bo = generateNewBuiltObject(galaxy, faction, design, null, source.xpos + pt.x, source.ypos + pt.y);
        takeOwnershipOfBuiltObject(galaxy, faction, bo, faction, false);
        bo.supportCostFactor = 0; // fed by the transmitter: no upkeep
        bo.isAutoControlled = true;
        spawned.push(bo);
    }
    st.beaconShips.push(...spawned);
    st.beaconSpawned = (st.beaconSpawned ?? 0) + spawned.length;
    formBeaconFleets(galaxy, faction, source, spawned);
    if (spawned.length > 0) arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Beacon', args: [source.name], subject: source });
    return spawned;
}

/** The new warships gather at the transmitter in fleets of BEACON_FLEET_SIZE, posture Attack (stock fleet AI tasks them). */
function formBeaconFleets(galaxy: Galaxy, faction: Empire, source: Habitat, ships: BuiltObject[]): void {
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
        g.posture = FleetPosture.Attack;
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
    if (threatsGameEndOn(galaxy)) {
        st.ended = true;
        threatGameEnd(galaxy, galaxy.playerEmpire, GameEndOutcome.Victory, scenarioText(`${TAG} Victory Title`), ROBOT_MUTINY_CODE_CONTAINED);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Yearly / periodic
// ---------------------------------------------------------------------------------------------------------------

export function mutinyYearly(galaxy: Galaxy, year: number): void {
    const st = robotMutinyState(galaxy);
    ensureFields(st);
    if (st.ended) return;
    if (!st.seeded) {
        const startYear = gameYear(startStarDateForAge(galaxy.age));
        if (year >= startYear) mutinySeed(galaxy, st);
    }
    mutinyHints(galaxy, st, year);
    checkDefused(galaxy, st);
    if (st.ended) return;
    mutinyAccrueSleepers(galaxy, st);
    if (!st.triggered && !sourceNeutralised(st) && year >= P.year(galaxy) && galaxyRobotCount(galaxy) >= P.minRobots(galaxy)) {
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
    mutinyDiscovery(galaxy, st);
    aiStopRecruiting(galaxy, st);
    if (st.faction === null) return;
    mutinyBecomeEmpire(galaxy, st);
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
            threatGameEnd(galaxy, galaxy.playerEmpire, GameEndOutcome.Victory, scenarioText(`${TAG} Victory Title`), ROBOT_MUTINY_CODE_CONTAINED);
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------------------------

export const ROBOT_MUTINY_HANDLER_IDS = ['robotMutiny.yearly', 'robotMutiny.periodic'] as const;

export function registerRobotMutiny(): void {
    registerScenarioYearly({ id: 'robotMutiny.yearly', flag: ROBOT_MUTINY_FLAG, order: 10, run: mutinyYearly });
    registerScenarioPeriodic({ id: 'robotMutiny.periodic', flag: ROBOT_MUTINY_FLAG, periodDays: PERIOD_DAYS, order: 10, run: mutinyPeriodic });
}

registerRobotMutiny();
