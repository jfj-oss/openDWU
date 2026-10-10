// 19b Dark Farms (tasks/19b-dark-farms.md). Not a port: new scenario behaviour composed of ported functions (each
// composed step cites its C# analogue). Registered from scenario/packages.ts; every handler is gated by the
// `darkFarms` flag, so with the flag off (or no scenario) nothing here runs and nothing draws.
//
// Arc: an overdeveloped colony may grow a hidden factory (a farm, scenario state only — never a PlanetaryFacility).
// It builds, for free, hidden robot troops and "sleeper" freighters: host private-sector freighters that really trade.
// At the turn a new faction (the Harvester Collective) is created mid-game (createThreatFaction, adoptOnly), the robots
// invade the host colony from inside through the stock ground-war resolution, every sleeper flips to the faction, is
// refitted to its armed fit and loads robot troops. Afterwards the farm feeds troops and transports to a thin scenario
// layer that sends loaded transports at weakly garrisoned enemy colonies. Dirty methods: blight bombardment (the
// Xaraktor-virus plague path), assault-pod capture (the Harvester policy + armed templates), saboteur agents.
//
// Rnd (§6): draws only in the yearly spawn handler, the periodic handler (and the stock functions it calls), the
// flag-gated habitatBombarded handler and the player's purge command (a logged command). Fixed iteration orders:
// farms / sleepers by id, galaxy.empires order, empire.colonies order, getBuiltObjectsAtLocation order.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import { BuiltObjectStance, type Design } from '../../design';
import { BuiltObject } from '../../builtObject';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { BuiltObjectFleeWhen, BuiltObjectRole } from '../../data/designSpecifications';
import type { EmpirePolicy } from '../../data/policies';
import { TroopType } from '../../cargo';
import { habitatDevelopmentLevel } from '../../developmentLevel';
import { findNewestCanBuild, generateDesignFromSpec } from '../../designGeneration';
import { getBuiltObjectsAtLocation } from '../../stationPlacement';
import { habitatGenerateNewTroop } from '../../troops';
import { assignMission } from '../../missions/assign';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../../missions/mission';
import { assignLoadTroopsMission } from '../../combat/troopsRuntime';
import { CharacterRole, generateNewCharacter, getEmpireCharacters, type Character, type IntelligenceMission } from '../../characters';
import { infectWithPlague } from '../../events';
import { galaxyPlagues } from '../../eventTypes';
import { EmpireMessageType } from '../../messages';
import { GameEndOutcome } from '../../victory';
import { YEAR_LENGTH, startStarDateForAge } from '../../galaxyTime';
import { galaxyStarDate } from '../../tick/simTime';
import { TroopList } from '../../cargo';
import { GAME_DAY_LENGTH, gameYear, registerScenarioEvent, registerScenarioPeriodic, registerScenarioYearly } from '../hooks';
import { scenarioFlag, scenarioParam } from '../state';
import { scenarioText } from '../messages';
import { registerHiddenThing, retireHiddenTarget } from '../security/registry';
import {
    KNOWLEDGE_CONFIRMED,
    KNOWLEDGE_SUSPECTED,
    arcMessage,
    arcNews,
    atWar,
    createThreatFaction,
    flipToFaction,
    invadeFromInside,
    knowledgeLevel,
    loadTroopsOnto,
    lockWar,
    makeRobotTroop,
    militaryShipCount,
    normalEmpires,
    pastThreatMinYear,
    peekThreatState,
    refitInPlace,
    registerThreatAction,
    registerThreatExistence,
    registerThreatKnownSites,
    revealTo,
    teardownIfDead,
    threatExists,
    threatGameEnd,
    threatState,
    type KnownThreatSite,
    type SentStages,
    type ThreatKnowledge,
} from './framework';
import { isHumanEmpire } from '../../humanEmpires';
import { detPow } from '../../detMath';

export const DARK_FARMS_KEY = 'darkFarms';
export const DARK_FARMS_FLAG = 'darkFarms';
const TAG = 'DarkFarms';
/** Game-end codes (19b): containment (victory for the player) and Harvester majority (defeat). */
export const DARK_FARMS_CODE_CONTAINED = 1901;
export const DARK_FARMS_CODE_DEFEAT = 1902;
/** Production / direction period (game days). */
export const DARK_FARMS_PERIOD_DAYS = 30;
/** Notional jamming of a sleeper's hidden fit (trace-scanner power at which detection reaches the full chance). */
const SLEEPER_JAMMING = 20;
/** Trace-scanner search radius around a sleeper. */
const TRACE_SEARCH_RANGE = 2000;
/** A striking transport this close to its target lands its robots. */
const LANDING_RANGE = 3000;
/** A transport this close to the farm colony takes the farm's surplus troops directly. */
const FARM_DOCK_RANGE = 3000;
/** Agents roll once per this many periods (≈ yearly). */
const AGENT_PERIODS = 12;
/** IntelligenceMissionType.CounterIntelligence (espionage.ts). */
const COUNTER_INTELLIGENCE = 8;

// ---------------------------------------------------------------------------------------------------------------
// State (§7) — plain objects with graph references
// ---------------------------------------------------------------------------------------------------------------

export type DarkFarmStatus = 'hidden' | 'turned' | 'dead';

export interface DarkFarm {
    id: number;
    habitat: Habitat;
    host: Empire;
    bornDate: number;
    state: DarkFarmStatus;
    hiddenTroops: number;
    troopProgress: number;
    shipProgress: number;
    knowledge: ThreatKnowledge[];
    /** Star date the host learnt of the farm (level ≥ 2), −1 = not yet. */
    exposedDate: number;
    turnDate: number;
    /** The host ordered a purge (the player's order or its AI): turn now. */
    purgeRequested: boolean;
    /** Periods run for this farm (agents roll every AGENT_PERIODS). */
    periods: number;
}

export interface Sleeper {
    id: number;
    bo: BuiltObject;
    farmId: number;
    subRole: BuiltObjectSubRole;
    knowledge: ThreatKnowledge[];
}

export interface DarkFarmsState {
    nextId: number;
    faction: Empire | null;
    farms: DarkFarm[];
    sleepers: Sleeper[];
    /** Armed designs of the faction by the hull's original sub-role (Small / MediumFreighter). */
    armedDesigns: Record<number, Design>;
    /** Faction transports spawned by the farms (after the turn). */
    transports: BuiltObject[];
    /** Transports on their way to land robots on an enemy colony (§5.E step 22c). */
    strikes: { bo: BuiltObject; target: Habitat }[];
    /** Ships the faction captured that get the armed fit next period. */
    pendingRefits: BuiltObject[];
    sentStages: SentStages;
    /** Faction ships / colonies lost, by the empire that took them (empireId → count). */
    killsByEmpire: Record<number, number>;
    agentsGiven: boolean;
    /** The faction's capital is the farm colony it is rising in (not owned yet). */
    provisionalCapital: boolean;
    factionHadColonies: boolean;
    ended: boolean;
}

function newState(): DarkFarmsState {
    return {
        nextId: 1,
        faction: null,
        farms: [],
        sleepers: [],
        armedDesigns: {},
        transports: [],
        strikes: [],
        pendingRefits: [],
        sentStages: {},
        killsByEmpire: {},
        agentsGiven: false,
        provisionalCapital: false,
        factionHadColonies: false,
        ended: false,
    };
}

export function darkFarmsState(galaxy: Galaxy): DarkFarmsState {
    return threatState(galaxy, DARK_FARMS_KEY, newState);
}

/** The state if the threat has started (never creates it). */
export function peekDarkFarmsState(galaxy: Galaxy): DarkFarmsState | null {
    return peekThreatState<DarkFarmsState>(galaxy, DARK_FARMS_KEY);
}

// ---------------------------------------------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------------------------------------------

function p(galaxy: Galaxy, name: string, fallback: number): number {
    return scenarioParam(galaxy, name, fallback);
}

const P = {
    graceYears: (g: Galaxy) => p(g, 'graceYears', 25),
    spawnChancePerMille: (g: Galaxy) => p(g, 'spawnChancePerMille', 4),
    minDevelopment: (g: Galaxy) => p(g, 'minDevelopment', 70),
    minPopulationMillions: (g: Galaxy) => p(g, 'minPopulationMillions', 3000),
    maxFarms: (g: Galaxy) => p(g, 'maxFarms', 2),
    troopsPerYear: (g: Galaxy) => p(g, 'troopsPerYear', 6),
    sleepersPerYear: (g: Galaxy) => p(g, 'sleepersPerYear', 2),
    sleeperTurnCount: (g: Galaxy) => p(g, 'sleeperTurnCount', 10),
    turnFleetRatioPct: (g: Galaxy) => p(g, 'turnFleetRatioPct', 20),
    maxTurnYears: (g: Galaxy) => p(g, 'maxTurnYears', 12),
    exposedTurnDays: (g: Galaxy) => p(g, 'exposedTurnDays', 60),
    retakeDestroysFarm: (g: Galaxy) => p(g, 'retakeDestroysFarm', 1),
    troopStrength: (g: Galaxy) => p(g, 'troopStrength', 60),
    garrisonYears: (g: Galaxy) => p(g, 'garrisonYears', 2),
    traceDetectPct: (g: Galaxy) => p(g, 'traceDetectPct', 10),
    agentDetectPct: (g: Galaxy) => p(g, 'agentDetectPct', 15),
    blightChancePct: (g: Galaxy) => p(g, 'blightChancePct', 25),
    defeatPopulationPct: (g: Galaxy) => p(g, 'defeatPopulationPct', 40),
};

const robotArmy = (g: Galaxy) => scenarioFlag(g, 'darkFarmsRobotArmy');
const dirtyMethods = (g: Galaxy) => scenarioFlag(g, 'darkFarmsDirtyMethods');
const gameEndOn = (g: Galaxy) => scenarioFlag(g, 'darkFarmsGameEnd');

// ---------------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------------

function liveFarms(st: DarkFarmsState): DarkFarm[] {
    return st.farms.filter((f) => f.state !== 'dead');
}

function farmSleepers(st: DarkFarmsState, farm: DarkFarm): Sleeper[] {
    return st.sleepers.filter((s) => s.farmId === farm.id && !s.bo.hasBeenDestroyed);
}

function farmAt(st: DarkFarmsState, habitat: Habitat): DarkFarm | null {
    return st.farms.find((f) => f.state !== 'dead' && f.habitat === habitat) ?? null;
}

function systemName(galaxy: Galaxy, h: Habitat): string {
    return galaxy.determineHabitatSystemStar(h).name;
}

/** Robot strength of a farm's troops: troopStrength × 1.25 per 10 development levels above the minimum. */
export function farmTroopStrength(galaxy: Galaxy, farm: DarkFarm): number {
    const dev = habitatDevelopmentLevel(farm.habitat);
    const steps = Math.max(0, (dev - P.minDevelopment(galaxy)) / 10);
    return Math.trunc(P.troopStrength(galaxy) * detPow(1.25, steps));
}

/** Attack strength of a farm's hidden robots at full readiness, in TroopList.TotalDefendStrength units (strength × readiness 100). */
export function farmHiddenStrength(galaxy: Galaxy, farm: DarkFarm): number {
    return farm.hiddenTroops * farmTroopStrength(galaxy, farm) * 100;
}

/** The farm turns when this many of its sleepers live: max(sleeperTurnCount, host military × turnFleetRatioPct %). */
export function turnThreshold(galaxy: Galaxy, farm: DarkFarm): number {
    return Math.max(P.sleeperTurnCount(galaxy), Math.ceil((militaryShipCount(farm.host) * P.turnFleetRatioPct(galaxy)) / 100));
}

/** The host's tech level for the faction: the highest tech level among its researched projects (at least 1). */
function hostTechLevel(host: Empire): number {
    let max = 1;
    for (const n of host.research.techTree) if (n.isResearched && n.def.techLevel > max) max = n.def.techLevel;
    return max;
}

function isShakturi(galaxy: Galaxy, e: Empire): boolean {
    return galaxy.shakturiActualRace !== null && e.dominantRace === galaxy.shakturiActualRace;
}

// ---------------------------------------------------------------------------------------------------------------
// 5.B Spawn (yearly)
// ---------------------------------------------------------------------------------------------------------------

/** Colonies a farm may grow on this year, in galaxy.empires then empire.colonies order (§4 eligibility). */
export function eligibleFarmColonies(galaxy: Galaxy, st: DarkFarmsState): Habitat[] {
    const out: Habitat[] = [];
    const minDev = P.minDevelopment(galaxy);
    const minPop = P.minPopulationMillions(galaxy) * 1e6;
    for (const e of normalEmpires(galaxy, st.faction)) {
        if (isShakturi(galaxy, e)) continue;
        for (const h of e.colonies) {
            if (h === e.capital || h.hasBeenDestroyed) continue;
            if (habitatDevelopmentLevel(h) < minDev) continue;
            if (h.population.totalAmount < minPop) continue;
            if (farmAt(st, h) !== null) continue;
            out.push(h);
        }
    }
    return out;
}

/**
 * The yearly spawn roll (§4): one Next(0, 1000) per eligible colony until a success; at most one farm per year.
 * Analogue: the yearly random-event chances (empireEvents.ts reviewRandomEvents; Empire.1.cs 1758) and
 * ChanceRaceEvent (events.ts 1908; Galaxy.2.cs 4980).
 */
export function darkFarmsYearly(galaxy: Galaxy, year: number): void {
    if (!threatExists(galaxy, DARK_FARMS_KEY)) return; // §0 rarity: not this game — no state, no draws.
    const st = darkFarmsState(galaxy);
    if (st.ended) return;
    const startYear = gameYear(startStarDateForAge(galaxy.age));
    if (year < startYear + P.graceYears(galaxy) || !pastThreatMinYear(galaxy, DARK_FARMS_KEY, year)) return; // §0 timing: also waits for the shared/overridden floor.
    if (liveFarms(st).length >= P.maxFarms(galaxy)) return;
    const minDev = P.minDevelopment(galaxy);
    for (const h of eligibleFarmColonies(galaxy, st)) {
        const dev = habitatDevelopmentLevel(h);
        const chance = P.spawnChancePerMille(galaxy) * (1 + (dev - minDev) / 25);
        if (galaxy.rnd.next(0, 1000) < chance) {
            spawnFarm(galaxy, st, h);
            return;
        }
    }
}

/** A new hidden farm on `habitat` (also used by tests to force one). */
export function spawnFarm(galaxy: Galaxy, st: DarkFarmsState, habitat: Habitat): DarkFarm {
    const farm: DarkFarm = {
        id: st.nextId++,
        habitat,
        host: habitat.empire!,
        bornDate: galaxyStarDate(galaxy),
        state: 'hidden',
        hiddenTroops: 0,
        troopProgress: 0,
        shipProgress: 0,
        knowledge: [],
        exposedDate: -1,
        turnDate: -1,
        purgeRequested: false,
        periods: 0,
    };
    st.farms.push(farm);
    registerHiddenThing(galaxy, { kind: 'farm', concealment: 75, empire: farm.host, target: habitat, package: '19b.darkFarms', site: farm }); // 19m (flag-gated)
    return farm;
}

// ---------------------------------------------------------------------------------------------------------------
// 5.C Production (periodic)
// ---------------------------------------------------------------------------------------------------------------

/** The 30-day handler (§5.C step 16). */
export function darkFarmsPeriodic(galaxy: Galaxy, now: number): void {
    if (!threatExists(galaxy, DARK_FARMS_KEY)) return; // §0 rarity: not this game — no state, no draws.
    const st = darkFarmsState(galaxy);
    if (st.ended) return;
    refitCaptured(galaxy, st);
    const sorted = [...st.farms].sort((a, b) => a.id - b.id);
    for (const farm of sorted) {
        if (farm.state === 'dead') continue;
        if (farm.habitat.hasBeenDestroyed || farm.habitat.empire === null || farm.habitat.population.totalAmount <= 0) {
            farm.state = 'dead';
            continue;
        }
        farm.periods++;
        produce(galaxy, st, farm);
        if (farm.state === 'turned' && st.faction !== null && st.faction.active && farm.habitat.empire !== st.faction) {
            // Turned but the colony still stands: once the last rising is over, the next wave rises from inside.
            const inv = farm.habitat.invadingTroops;
            if ((inv === null || inv.count === 0) && farm.hiddenTroops >= Math.max(1, Math.trunc(P.troopsPerYear(galaxy) / 2))) riseInside(galaxy, st.faction, farm);
        } else if (farm.state === 'turned' && farm.hiddenTroops > 0 && st.faction !== null && farm.habitat.empire === st.faction) {
            // Robots made while the colony was being taken join its garrison / the pickup pool.
            const n = farm.hiddenTroops;
            farm.hiddenTroops = 0;
            for (let i = 0; i < n; i++) afterTurnTroop(galaxy, st, farm);
        }
        if (farm.state === 'hidden') {
            checkDiscovery(galaxy, st, farm);
            hostReaction(galaxy, st, farm);
            if (checkTurn(galaxy, st, farm, now)) darkFarmsTurn(galaxy, st, farm);
            if (farm.state === 'hidden') hints(galaxy, st, farm, now);
        }
    }
    if (st.faction !== null && st.faction.active) directFaction(galaxy, st);
    darkFarmsEndCheck(galaxy, st);
}

function produce(galaxy: Galaxy, st: DarkFarmsState, farm: DarkFarm): void {
    const troopsPerYear = P.troopsPerYear(galaxy);
    const frac = DARK_FARMS_PERIOD_DAYS / 365;
    if (robotArmy(galaxy)) {
        farm.troopProgress += troopsPerYear * frac;
        while (farm.troopProgress >= 1) {
            farm.troopProgress -= 1;
            if (farm.state === 'hidden') {
                if (farm.hiddenTroops < 4 * troopsPerYear) farm.hiddenTroops++;
            } else {
                afterTurnTroop(galaxy, st, farm);
            }
        }
    }
    farm.shipProgress += P.sleepersPerYear(galaxy) * frac;
    while (farm.shipProgress >= 1) {
        farm.shipProgress -= 1;
        if (farm.state === 'hidden') {
            if (farmSleepers(st, farm).length < turnThreshold(galaxy, farm) + 4) spawnSleeper(galaxy, st, farm);
        } else {
            spawnFactionTransport(galaxy, st, farm);
        }
    }
}

/**
 * One sleeper: a host private-sector freighter with the host's stock design, placed at the farm colony, trading like
 * any other (the private sector gives it freight missions). Analogue: CreateIndependentTrader
 * (independentTraders.ts ~470; Galaxy.7.cs 4498-4516) and DirectPrivateConstruction (civilianAI.ts 2490; Empire.6.cs
 * 741) minus price, yard and queue. Rnd: Next(0, 3) (hull), the ship name, heading and parking point.
 */
export function spawnSleeper(galaxy: Galaxy, st: DarkFarmsState, farm: DarkFarm): Sleeper | null {
    const host = farm.host;
    const colony = farm.habitat;
    const medium = galaxy.rnd.next(0, 3) === 1;
    let subRole = medium ? BuiltObjectSubRole.MediumFreighter : BuiltObjectSubRole.SmallFreighter;
    let design = findNewestCanBuild(host.designs, subRole, host);
    if (design === null) {
        subRole = medium ? BuiltObjectSubRole.SmallFreighter : BuiltObjectSubRole.MediumFreighter;
        design = findNewestCanBuild(host.designs, subRole, host);
    }
    if (design === null) return null;
    const bo = placeShip(galaxy, host, design, colony, false);
    const s: Sleeper = { id: st.nextId++, bo, farmId: farm.id, subRole, knowledge: [] };
    st.sleepers.push(s);
    registerHiddenThing(galaxy, { kind: 'sleeper', concealment: 60, empire: host, target: bo, package: '19b.darkFarms', site: s }); // 19m (flag-gated)
    return s;
}

/** CreateIndependentTrader's body (independentTraders.ts ~470) for an owner and state/private sector. */
function placeShip(galaxy: Galaxy, owner: Empire, design: Design, colony: Habitat, stateOwned: boolean): BuiltObject {
    design.buildCount++;
    const name = galaxy.selectRandomUniqueStandardShipName(colony);
    const bo = new BuiltObject(design, name, galaxy, true);
    bo.empire = owner;
    bo.heading = galaxy.selectRandomHeading();
    bo.targetHeading = bo.heading;
    bo.reDefine();
    bo.currentFuel = bo.fuelCapacity;
    owner.addBuiltObjectToGalaxy(bo, colony, false, stateOwned, -2000000001, -2000000001, false);
    const pt = galaxy.selectRelativeParkingPoint();
    bo.parentOffsetX = pt.x;
    bo.parentOffsetY = pt.y;
    bo.xpos = colony.xpos + pt.x;
    bo.ypos = colony.ypos + pt.y;
    return bo;
}

/** After the turn: a new robot troop garrisons the farm colony (up to garrisonYears × troopsPerYear, default 2 years of output), the rest go to transports or wait for pickup. */
function afterTurnTroop(galaxy: Galaxy, st: DarkFarmsState, farm: DarkFarm): void {
    const faction = st.faction;
    const h = farm.habitat;
    if (faction === null || h.empire !== faction) {
        farm.hiddenTroops++; // still being taken: they join the next wave from inside
        return;
    }
    const t = makeRobotTroop(galaxy, faction, farmTroopStrength(galaxy, farm), scenarioText(`${TAG} Troop Name`));
    if (h.troops === null) h.troops = new TroopList();
    const garrisoned = h.troops.items.filter((x) => x.garrisoned).length;
    const garrisonCap = P.garrisonYears(galaxy) * P.troopsPerYear(galaxy);
    if (garrisoned >= garrisonCap) {
        // Surplus: straight into a faction transport parked at the farm (the farm loads its own output, as a
        // LoadTroops completion would), else it waits in the colony for the stock pickup (AssignLoadTroopsMission).
        const ship = st.transports.find((b) => !b.hasBeenDestroyed && b.actualEmpire === faction && (isIdle(b) || isLoading(b)) && b.troopCapacityRemaining >= t.size && galaxy.calculateDistance(b.xpos, b.ypos, h.xpos, h.ypos) <= FARM_DOCK_RANGE);
        if (ship !== undefined) {
            loadTroopsOnto(ship, faction, [t]);
            return;
        }
    }
    t.colony = h;
    t.garrisoned = garrisoned < garrisonCap;
    h.troops.add(t);
    faction.troops.add(t);
}

/** After the turn: a free faction transport (the armed fit, state ship) at the farm colony. */
function spawnFactionTransport(galaxy: Galaxy, st: DarkFarmsState, farm: DarkFarm): void {
    const faction = st.faction;
    if (faction === null || farm.habitat.empire !== faction) return;
    const design = armedDesign(galaxy, st, galaxy.rnd.next(0, 3) === 1 ? BuiltObjectSubRole.MediumFreighter : BuiltObjectSubRole.SmallFreighter);
    if (design === null) return;
    const bo = placeShip(galaxy, faction, design, farm.habitat, true);
    st.transports.push(bo);
    // Built at the farm: it takes the waiting (ungarrisoned) robots aboard at once.
    const h = farm.habitat;
    if (h.troops === null) return;
    const waiting = h.troops.items.filter((t) => !t.garrisoned && !t.awaitingPickup && t.empire === faction);
    const take = [];
    let room = bo.troopCapacityRemaining;
    for (const t of waiting) {
        if (t.size > room) break;
        room -= t.size;
        take.push(t);
    }
    for (const t of take) h.troops.remove(t);
    loadTroopsOnto(bo, faction, take);
}

/** Ships the faction captured: freighter hulls get the armed fit (§5.G step 27). */
function refitCaptured(galaxy: Galaxy, st: DarkFarmsState): void {
    const faction = st.faction;
    const list = st.pendingRefits;
    st.pendingRefits = [];
    if (faction === null) return;
    for (const bo of list) {
        if (bo.hasBeenDestroyed || bo.actualEmpire !== faction) continue;
        const d = armedDesign(galaxy, st, bo.subRole);
        if (d === null) continue;
        flipToFaction(galaxy, bo, faction);
        refitInPlace(galaxy, bo, d);
        if (!st.transports.includes(bo)) st.transports.push(bo);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// 5.F Discovery
// ---------------------------------------------------------------------------------------------------------------

function checkDiscovery(galaxy: Galaxy, st: DarkFarmsState, farm: DarkFarm): void {
    // Trace scanners (§5.F step 23). Analogue: the pirate-smuggler detection in IdentifySystemThreatsToUs
    // (combat/threats.ts 1045; BaconBuiltObject.cs 4863) and the docking check (cmdDocking.ts ~205; BuiltObject.2.cs 2811).
    const pct = P.traceDetectPct(galaxy) / 100;
    for (const s of farmSleepers(st, farm).sort((a, b) => a.id - b.id)) {
        if (pct <= 0) break;
        const near = getBuiltObjectsAtLocation(galaxy, s.bo.xpos, s.bo.ypos, TRACE_SEARCH_RANGE);
        for (const scanner of near) {
            if (scanner === s.bo || scanner.hasBeenDestroyed || scanner.sensorTraceScannerPower <= 0) continue;
            const e = scanner.actualEmpire;
            if (e === null || e === galaxy.independentEmpire || e.pirateEmpireBaseHabitat !== null || e === st.faction) continue;
            if (knowledgeLevel(s, e) >= KNOWLEDGE_CONFIRMED) continue;
            if (galaxy.calculateDistance(scanner.xpos, scanner.ypos, s.bo.xpos, s.bo.ypos) > scanner.sensorTraceScannerRange) continue;
            if (galaxy.rnd.nextDouble() < pct * Math.min(1, scanner.sensorTraceScannerPower / SLEEPER_JAMMING)) {
                sleeperFound(galaxy, st, farm, s, e);
            }
        }
    }
    // Agents (§5.F step 24), about yearly. Analogue: the mission success rolls of PerformIntelligenceMissions
    // (espionage.ts 1267; Empire.5.cs 5597).
    if (farm.periods % AGENT_PERIODS !== 0) return;
    const apct = P.agentDetectPct(galaxy) / 100;
    if (apct <= 0) return;
    for (const e of normalEmpires(galaxy, st.faction)) {
        if (knowledgeLevel(farm, e) >= KNOWLEDGE_CONFIRMED) continue;
        for (const c of getEmpireCharacters(e)) {
            if (!agentWatchesHost(c, e, farm.host)) continue;
            if (galaxy.rnd.nextDouble() < (apct * c.espionageFactored) / 100) {
                revealFarm(galaxy, st, farm, e, KNOWLEDGE_CONFIRMED);
                break;
            }
        }
    }
}

function agentWatchesHost(c: Character, owner: Empire, host: Empire): boolean {
    if (c.role !== CharacterRole.IntelligenceAgent || !c.active) return false;
    const m = c.mission as IntelligenceMission | null;
    if (m === null) return false;
    if (owner === host) return m.type === COUNTER_INTELLIGENCE;
    return m.targetEmpire === host || (m.targetHabitat !== null && m.targetHabitat.empire === host);
}

/** A trace scanner of `e` exposed sleeper `s`: level 3 on the ship, level 2 on its farm. */
export function sleeperFound(galaxy: Galaxy, st: DarkFarmsState, farm: DarkFarm, s: Sleeper, e: Empire): void {
    if (!revealTo(galaxy, s, e, KNOWLEDGE_CONFIRMED)) return;
    const recipients = e === farm.host ? [e] : [e, farm.host];
    arcMessage(galaxy, st.sentStages, recipients, {
        prefix: TAG,
        stage: 'Sleeper Found',
        onceKey: `Sleeper Found:${s.id}`,
        args: [s.bo.name, farm.habitat.name],
        type: EmpireMessageType.GeneralWarning,
        subject: s.bo,
    });
    revealFarm(galaxy, st, farm, e, KNOWLEDGE_SUSPECTED);
}

/** Knowledge of the farm rises for `e` (messages; the host's exposure starts the turn clock). */
export function revealFarm(galaxy: Galaxy, st: DarkFarmsState, farm: DarkFarm, e: Empire, level: number): void {
    if (!revealTo(galaxy, farm, e, level)) return;
    const confirmed = level >= KNOWLEDGE_CONFIRMED;
    arcMessage(galaxy, st.sentStages, [e], {
        prefix: TAG,
        stage: confirmed ? 'Farm Confirmed' : 'Farm Suspected',
        onceKey: `${confirmed ? 'Farm Confirmed' : 'Farm Suspected'}:${farm.id}`,
        textTag: confirmed && e === farm.host ? `${TAG} Farm Confirmed Purge` : undefined,
        args: [farm.habitat.name],
        type: EmpireMessageType.GeneralWarning,
        subject: farm.habitat,
    });
    if (e === farm.host && farm.exposedDate < 0 && level >= KNOWLEDGE_SUSPECTED) farm.exposedDate = galaxyStarDate(galaxy);
}

/**
 * An AI host that knows its farm (§5.F step 25): recruits troops at the colony towards 1.5 × the hidden strength (the
 * stock troopsToRecruit path, as the AI's armored / special-forces recruitment in troopsRuntime.ts ~115), orders the
 * purge at 1.2 ×, and retires every sleeper it has found (AssignMission Retire).
 */
function hostReaction(galaxy: Galaxy, st: DarkFarmsState, farm: DarkFarm): void {
    const host = farm.host;
    if (isHumanEmpire(galaxy, host) || knowledgeLevel(farm, host) < KNOWLEDGE_SUSPECTED) return;
    const h = farm.habitat;
    const hidden = farmHiddenStrength(galaxy, farm);
    const garrison = h.troops?.totalDefendStrength ?? 0;
    if (garrison >= 1.2 * hidden) {
        farm.purgeRequested = true;
    } else if (h.troopsToRecruit !== null && h.troopsToRecruit.count < 5) {
        const t = habitatGenerateNewTroop(galaxy, h, TroopType.Infantry, null, true);
        if (t !== null && garrison + h.troopsToRecruit.totalDefendStrengthExcludeReadiness < 1.5 * hidden) {
            h.troopsToRecruit.add(t);
            host.troops.add(t);
        }
    }
    for (const s of farmSleepers(st, farm)) {
        if (knowledgeLevel(s, host) < KNOWLEDGE_CONFIRMED || s.bo.actualEmpire !== host) continue;
        const m = builtObjectMission(s.bo.mission);
        if (m !== null && m.type === BuiltObjectMissionType.Retire) continue;
        assignMission(galaxy, s.bo, BuiltObjectMissionType.Retire, null, null, BuiltObjectMissionPriority.High);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// 5.D The turn
// ---------------------------------------------------------------------------------------------------------------

/** §4 turn conditions. */
export function checkTurn(galaxy: Galaxy, st: DarkFarmsState, farm: DarkFarm, now: number): boolean {
    if (farm.purgeRequested) return true;
    if (farmSleepers(st, farm).length >= turnThreshold(galaxy, farm)) return true;
    if (now - farm.bornDate >= P.maxTurnYears(galaxy) * YEAR_LENGTH) return true;
    if (farm.exposedDate >= 0 && now - farm.exposedDate >= P.exposedTurnDays(galaxy) * GAME_DAY_LENGTH) return true;
    return false;
}

/** Aggressive war posture for the faction (on top of the Harvester policy file). */
function configureFactionPolicy(policy: EmpirePolicy): void {
    policy.warAttacksAllowColonyBombardment = 2;
    policy.tradeWithOtherEmpires = false;
    policy.constructionMilitary = 2;
}

/** The faction (one for all farms), created on the first turn. Null when the galaxy has no empire id left. */
function ensureFaction(galaxy: Galaxy, st: DarkFarmsState, farm: DarkFarm): Empire | null {
    if (st.faction !== null && st.faction.active) {
        for (const e of normalEmpires(galaxy, st.faction)) if (!atWar(st.faction, e)) lockWar(galaxy, st.faction, e);
        return st.faction;
    }
    const faction = createThreatFaction(galaxy, {
        race: 'Harvester',
        name: scenarioText(`${TAG} Faction Name`),
        techLevel: hostTechLevel(farm.host),
        enemies: normalEmpires(galaxy),
        configurePolicy: configureFactionPolicy,
    });
    if (faction === null) return null;
    // Risk §13: stock AI code reads Empire.Capital without a null check (e.g. ShipGroup SelectFleetBase), so until the
    // faction owns a colony its capital reference is the farm colony it is rising in (as a pirate faction's base
    // habitat reference); onColonyOwnerChanged replaces it with the first colony it takes.
    faction.capital = farm.habitat;
    st.provisionalCapital = true;
    st.faction = faction;
    st.armedDesigns = {};
    st.agentsGiven = false;
    return faction;
}

/** The faction's armed fit of a freighter hull, generated once from the Harvester templates (designGeneration.ts 777). */
function armedDesign(galaxy: Galaxy, st: DarkFarmsState, subRole: BuiltObjectSubRole): Design | null {
    const faction = st.faction;
    if (faction === null) return null;
    const key = subRole === BuiltObjectSubRole.MediumFreighter || subRole === BuiltObjectSubRole.LargeFreighter ? BuiltObjectSubRole.MediumFreighter : BuiltObjectSubRole.SmallFreighter;
    const cached = st.armedDesigns[key];
    if (cached !== undefined) return cached;
    const spec = (faction.designSpecifications as { subRole: BuiltObjectSubRole }[]).find((s) => s !== null && s.subRole === key) ?? null;
    const d = generateDesignFromSpec(galaxy, faction, spec as never, 0, galaxyStarDate(galaxy));
    if (d === null) return null;
    // The stock troop-transport logic (load / unload missions, invasion fleets) keys on the sub-role.
    // Flee rule of a TroopTransport design (GenerateDesignFromSpec's TroopTransport case: Shields50) instead of a
    // freighter's (flee when enemy military is sighted).
    d.subRole = BuiltObjectSubRole.TroopTransport;
    d.role = BuiltObjectRole.Military;
    // Carriers first: they defend themselves (AttackIfAttacked) instead of joining every fight on the way.
    d.stance = BuiltObjectStance.AttackIfAttacked;
    d.fleeWhen = BuiltObjectFleeWhen.Shields50;
    d.name = `${scenarioText(`${TAG} Faction Name`)} ${key === BuiltObjectSubRole.MediumFreighter ? 'Reaper' : 'Gleaner'}`;
    st.armedDesigns[key] = d;
    return d;
}

/**
 * The turn (§5.D step 20), in this order: faction; armed designs; this farm's sleepers flip, refit and load robots;
 * the rest of the robots rise inside the colony (the stock invasion resolution takes it from there); messages.
 * Returns false when no faction could be created (no empire id left): the farm keeps growing and retries.
 */
export function darkFarmsTurn(galaxy: Galaxy, st: DarkFarmsState, farm: DarkFarm): boolean {
    const faction = ensureFaction(galaxy, st, farm);
    if (faction === null) return false;
    const strength = farmTroopStrength(galaxy, farm);
    const troopName = scenarioText(`${TAG} Troop Name`);
    const sleepers = farmSleepers(st, farm).sort((a, b) => a.id - b.id);
    for (const s of sleepers) {
        const d = armedDesign(galaxy, st, s.subRole);
        flipToFaction(galaxy, s.bo, faction);
        if (d !== null) refitInPlace(galaxy, s.bo, d);
        st.transports.push(s.bo);
    }
    // Each armed sleeper carries one robot group (AI rule 3); the rest rise inside the colony.
    if (robotArmy(galaxy)) {
        for (const s of sleepers) {
            if (farm.hiddenTroops <= 0 || s.bo.troopCapacityRemaining < 100) continue;
            loadTroopsOnto(s.bo, faction, [makeRobotTroop(galaxy, faction, strength, troopName)]);
            farm.hiddenTroops--;
        }
    }
    st.sleepers = st.sleepers.filter((s) => s.farmId !== farm.id);
    riseInside(galaxy, faction, farm);
    farm.state = 'turned';
    farm.turnDate = galaxyStarDate(galaxy);
    farm.purgeRequested = false;
    arcMessage(galaxy, st.sentStages, [farm.host], {
        prefix: TAG,
        stage: 'Turn',
        onceKey: `Turn:${farm.id}`,
        args: [farm.habitat.name],
        type: EmpireMessageType.GeneralBadEvent,
        subject: farm.habitat,
    });
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Turn', onceKey: `Turn News:${farm.id}`, textTag: `${TAG} Turn News`, args: [farm.habitat.name], subject: farm.habitat });
    return true;
}

/** The farm's hidden robots rise inside its colony (framework invadeFromInside → the stock ground war). */
function riseInside(galaxy: Galaxy, faction: Empire, farm: DarkFarm): void {
    if (farm.hiddenTroops <= 0) return;
    const strength = farmTroopStrength(galaxy, farm);
    const troopName = scenarioText(`${TAG} Troop Name`);
    const rising = [];
    for (let i = 0; i < farm.hiddenTroops; i++) rising.push(makeRobotTroop(galaxy, faction, strength, troopName));
    farm.hiddenTroops = 0;
    invadeFromInside(galaxy, farm.habitat, faction, rising);
    for (const t of rising) faction.troops.add(t);
}

// ---------------------------------------------------------------------------------------------------------------
// 5.E Spread
// ---------------------------------------------------------------------------------------------------------------

function isIdle(bo: BuiltObject): boolean {
    const m = builtObjectMission(bo.mission);
    return m === null || m.type === BuiltObjectMissionType.Undefined || m.type === BuiltObjectMissionType.Hold;
}

/** Busy with a stock war mission the scenario layer may override (the war AI uses armed transports as warships). */
function isRedirectable(bo: BuiltObject): boolean {
    const m = builtObjectMission(bo.mission);
    if (m === null) return true;
    switch (m.type) {
        case BuiltObjectMissionType.Attack:
        case BuiltObjectMissionType.Capture:
        case BuiltObjectMissionType.Move:
        case BuiltObjectMissionType.Patrol:
        case BuiltObjectMissionType.Escort:
            return (bo.troops?.count ?? 0) > 0;
        default:
            return false;
    }
}

function isLoading(bo: BuiltObject): boolean {
    const m = builtObjectMission(bo.mission);
    return m !== null && m.type === BuiltObjectMissionType.LoadTroops;
}

function garrisonDefend(h: Habitat): number {
    return h.troops?.totalDefendStrength ?? 0;
}

/**
 * The thin layer over the faction's stock war AI (§5.E step 22): idle loaded transports go for the enemy colony that
 * minimises (garrison + 1) × distance within reach and that the carried attack overwhelms (policy invasion overkill);
 * empty ones return to a farm for pickup; with dirty methods the gunships bombard a target too strong to take.
 * Per-ship orders as AssignFleetUnloadTroops does them (invasion.ts 863; Empire.9.cs 525).
 */
export function directFaction(galaxy: Galaxy, st: DarkFarmsState): void {
    const faction = st.faction!;
    st.transports = st.transports.filter((b) => !b.hasBeenDestroyed && b.actualEmpire === faction);
    const farms = liveFarms(st).filter((f) => f.state === 'turned' && f.habitat.empire === faction);
    // Strikes under way: at the target the robots land as invaders (the stock landing of a troop ship attacking a
    // colony: cmdAttack.ts ~590, BuiltObject.2.cs 2340-2351 — troop.Colony = colony, colony.InvadingTroops.Add), and
    // the stock ground war (resolveInvasionBattles) decides it; on the way the ship keeps its Attack order.
    const striking = new Set<BuiltObject>();
    const strikes: { bo: BuiltObject; target: Habitat }[] = [];
    for (const k of st.strikes ?? []) {
        const bo = k.bo;
        if (bo.hasBeenDestroyed || bo.actualEmpire !== faction || bo.troops === null || bo.troops.count === 0) continue;
        if (k.target.hasBeenDestroyed || k.target.empire === faction || k.target.empire === null || !atWar(faction, k.target.empire)) continue;
        if (galaxy.calculateDistance(bo.xpos, bo.ypos, k.target.xpos, k.target.ypos) <= LANDING_RANGE) {
            const troops = [...bo.troops.items];
            bo.troops.clear();
            for (const t of troops) t.builtObject = null;
            invadeFromInside(galaxy, k.target, faction, troops);
            continue;
        }
        const m = builtObjectMission(bo.mission);
        if (m === null || m.type !== BuiltObjectMissionType.Attack || m.targetHabitat !== k.target) {
            assignMission(galaxy, bo, BuiltObjectMissionType.Attack, k.target, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
        }
        strikes.push(k);
        striking.add(bo);
    }
    st.strikes = strikes;
    const home = farms[0]?.habitat ?? faction.capital;
    if (home === null) return;
    // Robots still waiting at the farms: a half-empty transport goes back for them, otherwise it sails with what it has.
    const waiting = farms.some((f) => f.habitat.troops !== null && f.habitat.troops.items.some((t) => !t.garrisoned && !t.awaitingPickup && t.empire === faction));
    const loaded: BuiltObject[] = [];
    for (const bo of st.transports) {
        // The farm's transports answer to this layer, not to the stock mission AI (which would re-task them as
        // warships every few seconds); a transport low on fuel is handed back to the stock AI to refuel.
        bo.isAutoControlled = bo.currentFuel < 0.3 * bo.fuelCapacity;
        if (bo.isAutoControlled || striking.has(bo)) continue;
        const loading = isLoading(bo);
        if (!loading && !isIdle(bo) && !isRedirectable(bo)) continue;
        const carried = bo.troops?.totalSize ?? 0;
        if (bo.troopCapacity > 0 && carried > 0 && (carried >= 0.5 * bo.troopCapacity || !waiting)) loaded.push(bo);
        else if (!loading && waiting && carried < bo.troopCapacity) assignLoadTroopsMission(galaxy, faction, bo, farms[0].habitat, false, false, true);
    }
    if (loaded.length === 0) return;
    const attack = loaded.reduce((a, b) => a + (b.troops?.totalAttackStrength ?? 0), 0);
    const lead = loaded[0];
    const enemies = normalEmpires(galaxy, faction).filter((e) => atWar(faction, e));
    // Reach: 3 × the distance from the farm to the nearest enemy colony.
    let nearest = Number.MAX_VALUE;
    for (const e of enemies) for (const c of e.colonies) nearest = Math.min(nearest, galaxy.calculateDistance(home.xpos, home.ypos, c.xpos, c.ypos));
    const reach = 3 * nearest;
    const overkill = faction.policy?.invasionOverkillFactor ?? 1.3;
    let best: Habitat | null = null;
    let bestScore = Number.MAX_VALUE;
    let strongest: Habitat | null = null;
    let strongestScore = Number.MAX_VALUE;
    for (const e of enemies) {
        for (const c of e.colonies) {
            if (c.hasBeenDestroyed) continue;
            const dHome = galaxy.calculateDistance(home.xpos, home.ypos, c.xpos, c.ypos);
            if (dHome > reach) continue;
            const g = garrisonDefend(c);
            const score = (g + 1) * galaxy.calculateDistance(lead.xpos, lead.ypos, c.xpos, c.ypos);
            if (score < strongestScore) {
                strongestScore = score;
                strongest = c;
            }
            if (attack < overkill * g) continue;
            if (score < bestScore) {
                bestScore = score;
                best = c;
            }
        }
    }
    if (best !== null) {
        // An Attack order on the colony (an UnloadTroops at a hostile colony would add the robots to its garrison);
        // the strike lands them on arrival (above).
        for (const bo of loaded) {
            assignMission(galaxy, bo, BuiltObjectMissionType.Attack, best, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
            st.strikes.push({ bo, target: best });
        }
        return;
    }
    // §5.E step 22d: soften the nearest strong target with the gunships (Bombard; missions/assign.ts 94).
    if (dirtyMethods(galaxy) && strongest !== null && garrisonDefend(strongest) > attack) {
        for (const bo of faction.builtObjects) {
            if (bo.hasBeenDestroyed || bo.role !== BuiltObjectRole.Military || st.transports.includes(bo) || bo.subRole === BuiltObjectSubRole.TroopTransport) continue;
            if (!isIdle(bo) || bo.weapons.length === 0) continue;
            assignMission(galaxy, bo, BuiltObjectMissionType.Bombard, strongest, null, BuiltObjectMissionPriority.Normal);
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// 5.G End
// ---------------------------------------------------------------------------------------------------------------

/** Population the faction holds as a share of all empire-owned population (percent). */
export function factionPopulationPct(galaxy: Galaxy, faction: Empire): number {
    let total = 0;
    let mine = 0;
    for (const e of galaxy.empires) {
        if (e === null || !e.active || e === galaxy.independentEmpire) continue;
        for (const c of e.colonies) {
            total += c.population.totalAmount;
            if (e === faction) mine += c.population.totalAmount;
        }
    }
    return total > 0 ? (100 * mine) / total : 0;
}

/** Containment / collapse / defeat (§4 End, §5.G step 28). */
export function darkFarmsEndCheck(galaxy: Galaxy, st: DarkFarmsState): void {
    const faction = st.faction;
    if (faction === null || st.ended) return;
    if (faction.active && faction.colonies.length > 0) st.factionHadColonies = true;
    if (faction.active && factionPopulationPct(galaxy, faction) >= P.defeatPopulationPct(galaxy)) {
        arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Defeat', args: [Math.round(factionPopulationPct(galaxy, faction))] });
        if (gameEndOn(galaxy)) {
            st.ended = true;
            threatGameEnd(galaxy, faction, GameEndOutcome.Defeat, scenarioText(`${TAG} Defeat Title`), DARK_FARMS_CODE_DEFEAT);
        }
        return;
    }
    if (faction.active && faction.colonies.length === 0 && st.factionHadColonies) {
        arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Collapse', onceKey: 'Collapse' });
    }
    if (liveFarms(st).length > 0) return;
    if (faction.active && !teardownIfDead(galaxy, faction)) return;
    // No farm alive, no faction left: contained.
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Contained' });
    st.ended = true;
    const player = galaxy.playerEmpire;
    if (gameEndOn(galaxy) && player !== null) {
        const total = Object.values(st.killsByEmpire).reduce((a, b) => a + b, 0);
        const byPlayer = st.killsByEmpire[player.empireId] ?? 0;
        if (total > 0 && byPlayer * 2 >= total) threatGameEnd(galaxy, player, GameEndOutcome.Victory, scenarioText(`${TAG} Victory Title`), DARK_FARMS_CODE_CONTAINED);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// §8 Hints
// ---------------------------------------------------------------------------------------------------------------

function hints(galaxy: Galaxy, st: DarkFarmsState, farm: DarkFarm, now: number): void {
    const age = now - farm.bornDate;
    const host = farm.host;
    if (age >= 2 * YEAR_LENGTH) {
        arcMessage(galaxy, st.sentStages, [host], { prefix: TAG, stage: 'Hint Energy', onceKey: `Hint Energy:${farm.id}`, args: [farm.habitat.name], subject: farm.habitat });
    }
    const n = farmSleepers(st, farm).length;
    if (n >= 3) {
        const privateFreighters = host.privateBuiltObjects.filter((b) => b.role === BuiltObjectRole.Freight).length;
        const pct = Math.round((100 * n) / Math.max(1, privateFreighters - n));
        arcMessage(galaxy, st.sentStages, [host], { prefix: TAG, stage: 'Hint Freight', onceKey: `Hint Freight:${farm.id}`, args: [farm.habitat.name, pct], subject: farm.habitat });
    }
    if (age >= 4 * YEAR_LENGTH) {
        arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Rumour', onceKey: `Rumour:${farm.id}`, args: [systemName(galaxy, farm.habitat)], subject: farm.habitat });
        for (const e of normalEmpires(galaxy, st.faction)) revealTo(galaxy, farm, e, 1);
    }
    if (robotArmy(galaxy) && farm.hiddenTroops >= 4 * P.troopsPerYear(galaxy) && P.troopsPerYear(galaxy) > 0) {
        arcMessage(galaxy, st.sentStages, [host], { prefix: TAG, stage: 'Hint Missing', onceKey: `Hint Missing:${farm.id}`, args: [farm.habitat.name], type: EmpireMessageType.GeneralWarning, subject: farm.habitat });
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------------------------------------------

/** §5.D step 21: the faction's colonies, the farm colony changing hands. */
export function onColonyOwnerChanged(galaxy: Galaxy, colony: Habitat, from: Empire | null, to: Empire | null): void {
    const st = peekDarkFarmsState(galaxy);
    if (st === null) return;
    const faction = st.faction;
    if (faction !== null && to === faction) {
        if (faction.capital === null || st.provisionalCapital) faction.capital = colony;
        st.provisionalCapital = false;
        st.factionHadColonies = true;
        if (!st.agentsGiven && dirtyMethods(galaxy)) {
            // §5.D step 20b: two saboteurs; the stock AI then runs sabotage / assassination missions
            // (espionage.ts 1148/1267; Empire.5.cs 5597). Given once the faction has a capital to base them at.
            st.agentsGiven = true;
            for (let i = 0; i < 2; i++) generateNewCharacter(galaxy, faction, CharacterRole.IntelligenceAgent, faction.capital);
        }
        const key = `Fall:${galaxy.habitats.indexOf(colony)}`;
        arcMessage(galaxy, st.sentStages, [from], { prefix: TAG, stage: 'Fall', onceKey: key, args: [colony.name], type: EmpireMessageType.GeneralBadEvent, subject: colony });
        arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Fall', onceKey: `${key} News`, textTag: `${TAG} Fall News`, args: [colony.name, from?.name ?? ''], subject: colony });
    }
    if (faction !== null && from === faction && to !== null && to !== faction) {
        st.killsByEmpire[to.empireId] = (st.killsByEmpire[to.empireId] ?? 0) + 1;
    }
    const farm = farmAt(st, colony);
    if (farm === null) return;
    if (farm.state === 'turned') {
        if (from === faction && to !== faction) {
            if (to === null || colony.population.totalAmount <= 0 || P.retakeDestroysFarm(galaxy) >= 1) {
                farm.state = 'dead';
            } else if (to.pirateEmpireBaseHabitat === null && to !== galaxy.independentEmpire) {
                // Knob 0: the farm keeps working for the Harvesters, hidden again under its new host.
                farm.state = 'hidden';
                farm.host = to;
                farm.bornDate = galaxyStarDate(galaxy);
                farm.hiddenTroops = 0;
                farm.exposedDate = -1;
                farm.knowledge = [];
            } else {
                farm.state = 'dead';
            }
        }
        return;
    }
    // Hidden farm: it follows the colony to a new normal owner; lost with the colony otherwise.
    if (to === null || to === galaxy.independentEmpire || to.pirateEmpireBaseHabitat !== null || colony.population.totalAmount <= 0) farm.state = 'dead';
    else if (to !== faction) farm.host = to;
}

function onBuiltObjectRemoved(galaxy: Galaxy, bo: BuiltObject): void {
    const st = peekDarkFarmsState(galaxy);
    if (st === null) return;
    const i = st.sleepers.findIndex((s) => s.bo === bo);
    if (i >= 0) st.sleepers.splice(i, 1);
    if (st.faction !== null && bo.actualEmpire === st.faction) {
        const killer = (bo.attackers ?? []).map((a) => (a as BuiltObject).actualEmpire).find((e) => e != null && e !== st.faction) ?? null;
        if (killer !== null) st.killsByEmpire[killer.empireId] = (st.killsByEmpire[killer.empireId] ?? 0) + 1;
    }
}

function onBuiltObjectOwnerChanged(galaxy: Galaxy, bo: BuiltObject, from: Empire | null, to: Empire | null): void {
    const st = peekDarkFarmsState(galaxy);
    if (st === null) return;
    const s = st.sleepers.find((x) => x.bo === bo);
    if (s !== undefined && to !== st.faction) {
        // Captured by someone else: its hidden fit is found (§5.C step 18).
        st.sleepers.splice(st.sleepers.indexOf(s), 1);
        retireHiddenTarget(galaxy, 'sleeper', bo, 'captured'); // 19m (flag-gated)
        const farm = st.farms.find((f) => f.id === s.farmId);
        if (to !== null && farm !== undefined && to !== farm.host && to.pirateEmpireBaseHabitat === null && to !== galaxy.independentEmpire) {
            revealTo(galaxy, s, to, KNOWLEDGE_CONFIRMED);
            revealFarm(galaxy, st, farm, to, KNOWLEDGE_SUSPECTED);
        }
        return;
    }
    // The faction captured a freighter hull (boarding, §5.G step 27): armed fit next period.
    if (st.faction !== null && to === st.faction && from !== st.faction && s === undefined && !st.transports.includes(bo)) {
        if (bo.subRole === BuiltObjectSubRole.SmallFreighter || bo.subRole === BuiltObjectSubRole.MediumFreighter || bo.subRole === BuiltObjectSubRole.LargeFreighter) st.pendingRefits.push(bo);
    }
    if (st.faction !== null && from === st.faction && to !== null && to !== st.faction) st.killsByEmpire[to.empireId] = (st.killsByEmpire[to.empireId] ?? 0) + 1;
}

/**
 * Blight bombardment (§5.G step 26): a faction ship bombarding a populated, plague-free colony infects it with the
 * Harvester Blight at blightChancePct. Analogue: the player's Xaraktor DeployVirus (player/executeShipAction.ts 1004;
 * Main.Part7.cs 1020-1043) through Habitat.InfectWithPlague (events.ts 635; Habitat.cs 1838) — no Kaltor, no cooldown.
 */
export function onHabitatBombarded(galaxy: Galaxy, bo: BuiltObject, habitat: Habitat): void {
    const st = peekDarkFarmsState(galaxy);
    if (st === null || st.faction === null || bo.actualEmpire !== st.faction) return;
    if (habitat.empire === null || habitat.population.totalAmount <= 0 || habitat.plagueId >= 0) return;
    const blight = harvesterBlight(galaxy);
    if (blight === null) return;
    if (!(galaxy.rnd.nextDouble() < P.blightChancePct(galaxy) / 100)) return;
    infectWithPlague(galaxy, habitat, blight, null);
    arcMessage(galaxy, st.sentStages, [habitat.empire], { prefix: TAG, stage: 'Blight', onceKey: `Blight:${galaxy.habitats.indexOf(habitat)}`, args: [habitat.name], type: EmpireMessageType.GeneralBadEvent, subject: habitat });
}

export function harvesterBlight(galaxy: Galaxy): ReturnType<typeof galaxyPlagues>[number] | null {
    const list = galaxyPlagues(galaxy);
    const b = list.find((x) => x !== null && x.name === 'Harvester Blight') ?? null;
    // processPlague looks plagues up by id (index): only use the blight if its id is its index.
    return b !== null && list[b.plagueId] === b ? b : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Player purge (§9) and the UI selector
// ---------------------------------------------------------------------------------------------------------------

/** The hidden farm on `colony` that `empire` (its owner) knows of at level ≥ 2, or null. */
export function purgeableFarm(galaxy: Galaxy, empire: Empire, colony: unknown): DarkFarm | null {
    const st = peekDarkFarmsState(galaxy);
    if (st === null || colony === null || typeof colony !== 'object') return null;
    const farm = farmAt(st, colony as Habitat);
    if (farm === null || farm.state !== 'hidden' || farm.host !== empire || farm.habitat.empire !== empire) return null;
    return knowledgeLevel(farm, empire) >= KNOWLEDGE_SUSPECTED ? farm : null;
}

/** Known farms / sleepers for the map overlay and the selection panel. */
export function darkFarmsKnownSites(galaxy: Galaxy, empire: Empire): KnownThreatSite[] {
    const st = peekDarkFarmsState(galaxy);
    if (st === null) return [];
    const out: KnownThreatSite[] = [];
    for (const f of st.farms) {
        if (f.state === 'dead') continue;
        const level = f.state === 'turned' ? KNOWLEDGE_CONFIRMED : knowledgeLevel(f, empire);
        if (level <= 0) continue;
        out.push({ threat: DARK_FARMS_KEY, kind: 'colony', target: f.habitat, level, label: scenarioText(level >= KNOWLEDGE_CONFIRMED ? `${TAG} Farm Confirmed Row` : `${TAG} Farm Suspected Row`) });
    }
    for (const s of st.sleepers) {
        if (s.bo.hasBeenDestroyed) continue;
        const level = knowledgeLevel(s, empire);
        if (level <= 0) continue;
        out.push({ threat: DARK_FARMS_KEY, kind: 'ship', target: s.bo, level, label: scenarioText(`${TAG} Sleeper Role`) });
    }
    return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Registration (module load; scenario/packages.ts imports this module)
// ---------------------------------------------------------------------------------------------------------------

/** Handler ids (tests replace / remove them to compare against a game without the package). */
export const DARK_FARMS_HANDLER_IDS = ['darkFarms.spawn', 'darkFarms.periodic', 'darkFarms.colony', 'darkFarms.removed', 'darkFarms.owner', 'darkFarms.blight'] as const;

/** Registers every Dark Farms hook (module load; tests call it again after removing them). */
export function registerDarkFarms(): void {
    registerThreatExistence(DARK_FARMS_KEY, DARK_FARMS_FLAG);
    registerScenarioYearly({ id: 'darkFarms.spawn', flag: DARK_FARMS_FLAG, order: 10, run: darkFarmsYearly });
    registerScenarioPeriodic({ id: 'darkFarms.periodic', flag: DARK_FARMS_FLAG, order: 10, periodDays: DARK_FARMS_PERIOD_DAYS, run: darkFarmsPeriodic });
    registerScenarioEvent({ id: 'darkFarms.colony', flag: DARK_FARMS_FLAG, event: 'colonyOwnerChanged', run: (g, e) => onColonyOwnerChanged(g, e.colony, e.from, e.to) });
    registerScenarioEvent({ id: 'darkFarms.removed', flag: DARK_FARMS_FLAG, event: 'builtObjectRemoved', run: (g, e) => onBuiltObjectRemoved(g, e.builtObject) });
    registerScenarioEvent({ id: 'darkFarms.owner', flag: DARK_FARMS_FLAG, event: 'builtObjectOwnerChanged', run: (g, e) => onBuiltObjectOwnerChanged(g, e.builtObject, e.from, e.to) });
    registerScenarioEvent({
        id: 'darkFarms.blight',
        flag: 'darkFarmsDirtyMethods',
        event: 'habitatBombarded',
        run: (g, e) => {
            if (scenarioFlag(g, DARK_FARMS_FLAG)) onHabitatBombarded(g, e.builtObject, e.habitat);
        },
    });
    registerThreatKnownSites(DARK_FARMS_KEY, darkFarmsKnownSites);
    registerThreatAction('darkFarms.purge', {
        label: () => scenarioText(`${TAG} Purge Action`),
        available: (g, e, target) => scenarioFlag(g, DARK_FARMS_FLAG) && purgeableFarm(g, e, target) !== null,
        run: (g, e, target) => {
            const farm = purgeableFarm(g, e, target);
            if (farm === null) return false;
            return darkFarmsTurn(g, darkFarmsState(g), farm);
        },
    });
}

registerDarkFarms();
