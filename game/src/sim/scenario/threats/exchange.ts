// 19f #8 The Exchange (tasks/19f-hidden-threats.md §8, threat framework framework.ts). Not a port: new scenario
// behaviour composed of ported functions (each composed step cites its C# analogue). Registered from
// scenario/packages.ts; every handler is gated by the `threatExchange` flag, so with the flag off (or no scenario)
// nothing here runs and nothing draws.
//
// The Exchange is a neutral merchant-spy faction. In game year `exchangeYear` it appears as a real empire
// (createEmpireMidGame adoptOnly, Galaxy.8.cs 1348 GenerateShakturi analogue) whose only holdings are a large space
// port near the galaxy centre (its base; the port's habitat is its stand-in capital, as 19b's Harvesters) and what it
// buys in that system. It never colonises, conquers or declares war: the stock empire AI is switched off through the
// Empire Control* automation fields (Manual) and initiateConstruction = false, colonise / invade / bombard missions of
// its ships are refused (assignMissionAllowed), war declarations by or on it are blocked (declareWarBlocked).
//
// Money lives in a scenario purse (st.purse): base income exchangeIncomeStep × years since it appeared (capped at
// exchangeIncomeCap a year), a docking tariff on contracts at the station (contractInitiated) and the brokerage of
// its intel sales. The faction's own treasury is swept into the purse every period, so stock ship upkeep
// (payMaintenanceForBuiltObjects) and pirate contract payments (completePirateMission) are paid out of it. A reserve
// of exchangeReservePct of the year's income is never spent on discretionary items.
//
// What it does with the money, all through stock mechanisms:
//  - underdog funding: the weaker side of every war among normal empires gets exchangeFundPct of its treasury;
//  - intelligence: high-skill agents run the stock IntelligenceMissionType set back to back (character.mission, so
//    the stock PerformIntelligenceMissions resolves them, Empire.5.cs 5597) against war-weary and the strongest
//    empires, with a false-flag message naming the victim's enemy; stolen technology is the Exchange's own. A target's
//    stock counter-intelligence catching an agent opens a 19m security lead (kind exchangeAgent) and a reputation
//    cause against the Exchange;
//  - intel market: the weaker side of each war is given the stronger side's galaxy and operations maps
//    (applyIntelligenceMissionEffect, Empire.6.cs 117 CompleteIntelligenceMission's effect switch); maps / a tech of a
//    rival are sold to AI empires at war (and offered to the player as a scenario decision);
//  - mercenary contracts on the stock pirate market (Empire.2.cs 1138 MakeDefendOffersToPirates / 1719
//    MakeAttackOffersToPirates pattern): Defend contracts on the weaker side's colonies and ports, Attack contracts on
//    the stronger side's bases, in the Exchange's own name (it holds a free protection pact with every pirate faction);
//  - two patrol fleets (up to exchangeFleetCap warships) that never leave the station's system;
//  - research through the stock pirate-faction potential (Empire.cs 1817 AnnualResearchPotential, via the
//    researchAsPirateFaction query) with labs on the station and up to two research stations in its system.
// Counterplay: discovery (money traces, caught agents), a council sanction, and a blockade of the station for
// exchangeBlockadeDays (or its destruction) — then the faction is torn down (events.ts empireCompleteTeardown).
//
// Rnd (§0.4): draws only in the yearly handler (placement: habitat and race; createEmpireMidGame / createNewDesigns /
// generateStartingCharacters / generateNewCharacter; the funding / sales steps draw nothing) and the periodic handler
// (agent hiring, mission target rolls, addBuiltObjectToGalaxy offsets, applyIntelligenceMissionEffect's own draws).
// Query / event handlers never draw. Fixed iteration orders: galaxy.empires order (normalEmpires), empire.colonies /
// builtObjects order, character-list order.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import { AutomationLevel } from '../../empire';
import type { Habitat } from '../../types';
import type { Design } from '../../design';
import type { Race } from '../../data/races';
import type { EmpirePolicy } from '../../data/policies';
import { BuiltObject } from '../../builtObject';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { galaxyDesignSpecificationBySubRole } from '../../gameStartTail';
import { createNewDesigns, generateDesignFromSpec } from '../../designGeneration';
import { latestDesignsFindNewestCanBuild } from '../../pirates';
import { ShipDesignFocus } from '../../researchSystem';
import { ComponentType } from '../../data/components';
import {
    IntelligenceMissionOutcome,
    IntelligenceMissionType,
    applyIntelligenceMissionEffect,
    calculateIntelligenceMissionSkill,
    cascadeTimeLength,
    characterMission,
    newIntelligenceMissionAgainstCharacter,
    newIntelligenceMissionAgainstEmpire,
    newIntelligenceMissionAgainstHabitat,
    newIntelligenceMissionStealTechData,
    resolveKnownCharacters,
    resolveKnownColonies,
    resolveMoreAdvancedProjectsIncludeSpecial,
} from '../../espionage';
import { CharacterRole, CharacterSkillType, generateNewCharacter, generateStartingCharacters, getEmpireCharacters, type Character, type IntelligenceMission } from '../../characters';
import { EmpireActivity, EmpireActivityType } from '../../pirates/empireActivity';
import { calculatePirateAttackPrice, calculatePirateDefendPrice } from '../../pirates/missionsMarket';
import { PirateRelationType, changePirateRelation, obtainPirateRelation } from '../../pirateRelations';
import { EmpireMessageType, sendMessageToEmpire } from '../../messages';
import { gameText } from '../../colonyTick';
import { DiplomaticRelation, DiplomaticRelationType } from '../../diplomacy';
import { FleetPosture, militaryPotency } from '../../diplomacyTick';
import { ShipGroup, empireShipGroups } from '../../fleets/shipGroup';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../../missions/mission';
import { assignMission } from '../../missions/assign';
import { blockadeFor } from '../../fleets/blockades';
import { empireCompleteTeardown } from '../../events';
import { applyReputation, reputationSum } from '../reputation/ledger';
import { mirrorPackageDiscovery, registerHiddenThing } from '../security/registry';
import { peekCouncilState, registerCouncilExtension, type Council, type MotionCandidate } from '../emergent/council';
import { raiseScenarioDecision, registerScenarioDecision, pendingScenarioDecisions, type ScenarioDecision } from '../decisions';
import { createEmpireMidGame } from '../empireMidGame';
import {
    gameYear,
    radiusFraction,
    registerScenarioEvent,
    registerScenarioGameStart,
    registerScenarioPeriodic,
    registerScenarioQuery,
    registerScenarioYearly,
} from '../hooks';
import { scenarioParam } from '../state';
import { scenarioMessage, scenarioText } from '../messages';
import { GameEndOutcome } from '../../victory';
import { galaxyStarDate } from '../../tick/simTime';
import { REAL_SECONDS_IN_GALACTIC_YEAR, startStarDateForAge } from '../../galaxyTime';
import {
    KNOWLEDGE_CONFIRMED,
    KNOWLEDGE_SUSPECTED,
    arcMessage,
    arcNews,
    atWar,
    knowledgeLevel,
    normalEmpires,
    peekThreatState,
    registerThreatKnownSites,
    revealTo,
    threatGameEnd,
    threatState,
    type KnownThreatSite,
    type SentStages,
    type ThreatSite,
} from './framework';

export const EXCHANGE_KEY = 'exchange';
export const EXCHANGE_FLAG = 'threatExchange';
export const EXCHANGE_BUY_INTEL_DECISION = 'exchange.buyIntel';
const TAG = 'Exchange';
const PERIOD_DAYS = 30;
/** Game-end code (19f table). No defeat code: the Exchange never holds territory — only containment. */
export const EXCHANGE_CODE_CONTAINED = 2018;
/** Skill of an Exchange agent in its espionage / sabotage / assassination / psy-ops / concealment skills (Factored 70). */
const AGENT_SKILL = 60;
/** Hiring an agent costs this many missions' worth of money. */
const AGENT_HIRE_MISSIONS = 5;
/** Kept logs are trimmed to this length. */
const LOG_MAX = 100;
const COORD_UNSET = -2000000001;

// Resolved lazily (import cycle game → packages → threats → espionage → … → game; a top-level enum read throws).
function missionTypes(): readonly IntelligenceMissionType[] {
    const T = IntelligenceMissionType;
    return [T.SabotageColony, T.StealTechData, T.SabotageConstruction, T.StealGalaxyMap, T.AssassinateCharacter, T.StealOperationsMap];
}
function grudgeMissionTypes(): readonly IntelligenceMissionType[] {
    const T = IntelligenceMissionType;
    return [T.SabotageColony, T.AssassinateCharacter, T.StealTechData, T.SabotageConstruction];
}
function isSabotage(type: number): boolean {
    const T = IntelligenceMissionType;
    return type === T.SabotageColony || type === T.SabotageConstruction || type === T.AssassinateCharacter;
}

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------

export interface ExchangeStation extends ThreatSite {
    bo: BuiltObject;
}

/** An agent's mission the Exchange assigned (the stock mission object; outcome is read after it resolves). */
export interface ExchangeMission {
    agent: Character;
    mission: IntelligenceMission;
    victim: Empire;
    date: number;
}

/** A contract the Exchange posted on the pirate market. */
export interface ExchangeContract {
    activity: EmpireActivity;
    kind: 'attack' | 'defend';
    /** Defend: the client whose asset is guarded; attack: the owner of the target. */
    victim: Empire;
    date: number;
}

/** A reputation cause that becomes visible to `victimId` once it knows the Exchange (level ≥ suspected). */
export interface ExchangeTrace {
    victimId: number;
    actorId: number;
    cause: string;
    value: number;
    /** GameText tag of the event-log line sent when the trace lands. */
    tag: string;
    args: string[];
}

export type ExchangeIntelItem = 'galaxyMap' | 'operationsMap' | 'tech';

export interface ExchangeState {
    station: ExchangeStation | null;
    placed: boolean;
    ended: boolean;
    faction: Empire | null;
    /** The station's habitat (the faction's stand-in capital). */
    habitat: Habitat | null;
    appearedYear: number;
    /** The game's start tech level option (stored at game start: it is not saved elsewhere). */
    startTechLevel: number;
    /** The faction's tech level at appearance (startTechLevel + exchangeTechLevelBonus, at most 7). */
    techLevel: number;
    purse: number;
    /** This game year's income (base + tariffs + brokerage): the reserve is a share of it. */
    incomeThisYear: number;
    reserve: number;
    incomeLog: { year: number; base: number }[];
    tariffTotal: number;
    brokerageTotal: number;
    fundedTotal: number;
    fundLog: { date: number; empireId: number; amount: number }[];
    spent: { agents: number; missions: number; contracts: number; fleet: number; research: number };
    agentTarget: number;
    missions: ExchangeMission[];
    missionLog: { date: number; type: number; victimId: number }[];
    missionsAssigned: number;
    /** Catches per victim empire id (1 = suspected, 2+ = confirmed). */
    catches: Record<number, number>;
    caughtLog: { date: number; victimId: number; outcome: number }[];
    sabotageLog: { date: number }[];
    giftLog: { year: number; weakerId: number; strongerId: number }[];
    sales: { date: number; buyerId: number; rivalId: number; item: ExchangeIntelItem; price: number; by: 'ai' | 'player' }[];
    contracts: ExchangeContract[];
    contractsPosted: { attack: number; defend: number };
    contractsSucceeded: number;
    fleets: ShipGroup[];
    warships: BuiltObject[];
    researchStations: BuiltObject[];
    traces: ExchangeTrace[];
    blockadeDays: number;
    sentStages: SentStages;
    /** Discovery counter: intel missions an empire has completed against a currently-funded empire. */
    tracesByEmpire: Record<number, number>;
    /** Round-robin cursors (deterministic target / type rotation). */
    targetCursor: number;
    typeCursor: number;
    saleCursor: Record<number, number>;
    /** Grudge ledger: empire id → grudge (decays yearly by exchangeGrudgeDecay %). Absent in saves before it existed. */
    grudges?: Record<number, number>;
    grudgeLog?: { date: number; empireId: number; source: ExchangeGrudgeSource; amount: number }[];
    /** Council sanctions already counted (`<council id>:<year>`). */
    sanctionsSeen?: string[];
    /** The player's declined intel offers, by empire id. */
    refusals?: Record<number, number>;
    grudgeCursor?: number;
}

export type ExchangeGrudgeSource = 'blockade' | 'attack' | 'catch' | 'sanction' | 'refusal' | 'reputation';

function newState(): ExchangeState {
    return {
        station: null,
        placed: false,
        ended: false,
        faction: null,
        habitat: null,
        appearedYear: -1,
        startTechLevel: 0.5,
        techLevel: 0,
        purse: 0,
        incomeThisYear: 0,
        reserve: 0,
        incomeLog: [],
        tariffTotal: 0,
        brokerageTotal: 0,
        fundedTotal: 0,
        fundLog: [],
        spent: { agents: 0, missions: 0, contracts: 0, fleet: 0, research: 0 },
        agentTarget: 0,
        missions: [],
        missionLog: [],
        missionsAssigned: 0,
        catches: {},
        caughtLog: [],
        sabotageLog: [],
        giftLog: [],
        sales: [],
        contracts: [],
        contractsPosted: { attack: 0, defend: 0 },
        contractsSucceeded: 0,
        fleets: [],
        warships: [],
        researchStations: [],
        traces: [],
        blockadeDays: 0,
        sentStages: {},
        tracesByEmpire: {},
        targetCursor: 0,
        typeCursor: 0,
        saleCursor: {},
        grudges: {},
        grudgeLog: [],
        sanctionsSeen: [],
        refusals: {},
        grudgeCursor: 0,
    };
}

export function exchangeState(galaxy: Galaxy): ExchangeState {
    return threatState(galaxy, EXCHANGE_KEY, newState);
}
export function peekExchangeState(galaxy: Galaxy): ExchangeState | null {
    return peekThreatState<ExchangeState>(galaxy, EXCHANGE_KEY);
}

function flagOn(galaxy: Galaxy): boolean {
    return galaxy.scenario !== null && galaxy.scenario.flags[EXCHANGE_FLAG] === true;
}

/** The live Exchange faction (null before it appears, after it ends, or with the flag off). Pure. */
export function exchangeFaction(galaxy: Galaxy): Empire | null {
    if (!flagOn(galaxy)) return null;
    const st = peekExchangeState(galaxy);
    if (st === null || st.ended || st.faction === null || !st.faction.active) return null;
    return st.faction;
}

function p(galaxy: Galaxy, name: string, fallback: number): number {
    return scenarioParam(galaxy, name, fallback);
}
export const EXCHANGE_PARAMS = {
    year: (g: Galaxy) => Math.trunc(p(g, 'exchangeYear', 7)),
    techBonus: (g: Galaxy) => p(g, 'exchangeTechLevelBonus', 1),
    incomeStep: (g: Galaxy) => p(g, 'exchangeIncomeStep', 100000),
    incomeCap: (g: Galaxy) => p(g, 'exchangeIncomeCap', 1000000),
    tariffPct: (g: Galaxy) => p(g, 'exchangeTariffPct', 5),
    reservePct: (g: Galaxy) => p(g, 'exchangeReservePct', 20),
    fundPct: (g: Galaxy) => p(g, 'exchangeFundPct', 5),
    agents: (g: Galaxy) => Math.trunc(p(g, 'exchangeAgents', 6)),
    agentsMax: (g: Galaxy) => Math.trunc(p(g, 'exchangeAgentsMax', 20)),
    missionCost: (g: Galaxy) => p(g, 'exchangeMissionCost', 10000),
    intelPrice: (g: Galaxy) => p(g, 'exchangeIntelPrice', 20000),
    fleetCap: (g: Galaxy) => Math.trunc(p(g, 'exchangeFleetCap', 20)),
    blockadeDaysNeeded: (g: Galaxy) => p(g, 'exchangeBlockadeDays', 120),
    grudgeDecay: (g: Galaxy) => p(g, 'exchangeGrudgeDecay', 20),
    grudgeThreshold: (g: Galaxy) => p(g, 'exchangeGrudgeThreshold', 100),
};

/** Grudge added per source (a blockade: per 30-day period it stands; the reputation source: the worst standing, capped). */
export const EXCHANGE_GRUDGE = { blockade: 25, attack: 30, catch: 40, sanction: 60, refusal: 25, reputationMax: 100 } as const;
const P = EXCHANGE_PARAMS;

function threatsGameEndOn(galaxy: Galaxy): boolean {
    return galaxy.scenario !== null && galaxy.scenario.flags['threatsGameEnd'] !== false;
}

function findEmpire(galaxy: Galaxy, id: number): Empire | null {
    for (const e of galaxy.empires) if (e !== null && e.empireId === id) return e;
    return null;
}

function trimLog<T>(log: T[]): void {
    if (log.length > LOG_MAX) log.splice(0, log.length - LOG_MAX);
}

// ---------------------------------------------------------------------------------------------------------------
// Purse
// ---------------------------------------------------------------------------------------------------------------

/** Contract prices still owed (open Attack + Defend contracts; EmpireActivityList.cs CalculateTotal*Costs). */
function committedContracts(faction: Empire): number {
    return faction.pirateMissions.calculateTotalAttackCosts(faction) + faction.pirateMissions.calculateTotalDefendCosts(faction);
}

/** Money above the reserve and the open contract commitments. Pure. */
export function exchangeSpendable(st: ExchangeState): number {
    if (st.faction === null) return 0;
    return st.purse - st.reserve - committedContracts(st.faction);
}

/** The faction's treasury (upkeep and contract payments were taken from it) is swept into the purse. */
function sweepTreasury(st: ExchangeState): void {
    const f = st.faction;
    if (f === null) return;
    st.purse += f.stateMoney;
    f.stateMoney = 0;
}

function addIncome(galaxy: Galaxy, st: ExchangeState, amount: number): void {
    st.purse += amount;
    st.incomeThisYear += amount;
    st.reserve = (P.reservePct(galaxy) / 100) * st.incomeThisYear;
}

/** Base income of year `year`: exchangeIncomeStep × years since the Exchange appeared (the appearance year = 1), capped. */
export function exchangeBaseIncome(galaxy: Galaxy, st: ExchangeState, year: number): number {
    if (st.appearedYear < 0) return 0;
    const years = Math.max(1, year - st.appearedYear + 1);
    return Math.min(P.incomeCap(galaxy), P.incomeStep(galaxy) * years);
}

function payYearlyIncome(galaxy: Galaxy, st: ExchangeState, year: number): void {
    const base = exchangeBaseIncome(galaxy, st, year);
    st.incomeThisYear = 0;
    addIncome(galaxy, st, base);
    st.incomeLog.push({ year, base });
    trimLog(st.incomeLog);
}

// ---------------------------------------------------------------------------------------------------------------
// Appearance (yearly, once at exchangeYear)
// ---------------------------------------------------------------------------------------------------------------

/** Uncolonised habitats near the galaxy centre (radius fraction ≤ 0.3), galaxy.habitats index order. */
function centralCandidates(galaxy: Galaxy): Habitat[] {
    return galaxy.habitats.filter((h) => h !== null && h.empire === null && !h.hasBeenDestroyed && radiusFraction(galaxy, h.xpos, h.ypos) <= 0.3);
}

/** A playable race no active empire or pirate faction is dominated by (galaxy.races order; rnd pick), else any playable. */
function pickRace(galaxy: Galaxy): Race | null {
    const used = new Set<Race>();
    for (const e of [...galaxy.empires, ...galaxy.pirateEmpires]) if (e !== null && e.active && e.dominantRace !== null) used.add(e.dominantRace);
    const all = galaxy.races.filter((r): r is Race => r !== null && r.playable && r.canBeNormalEmpire);
    const free = all.filter((r) => !used.has(r));
    const list = free.length > 0 ? free : all;
    if (list.length === 0) return null;
    return list[galaxy.rnd.next(0, list.length)];
}

function configurePolicy(policy: EmpirePolicy): void {
    // The Exchange posts its own contracts (postContracts); the stock offer steps stay silent. Pirates accept its Defend
    // contracts only with offerDefensivePirateMissions 2 (missionsMarket.ts determineOfferPirateDefendMissionToPirateFaction).
    policy.offerPirateAttackMissions = 0;
    policy.offerDefensivePirateMissions = 2;
    policy.offerDefensivePirateMissionsSituation = 0;
    policy.offerSmugglingPirateMissions = 0;
}

/** The stock empire AI off (Empire.cs Control* automation fields = Manual; no construction, colonisation, war, agents). */
function switchOffStockAi(faction: Empire): void {
    faction.controlColonization = AutomationLevel.Undefined;
    faction.controlColonyDevelopment = false;
    faction.controlColonyStockLevels = false;
    faction.controlColonyTaxRates = false;
    faction.controlDiplomacyGifts = AutomationLevel.Undefined;
    faction.controlDiplomacyOffense = AutomationLevel.Undefined;
    faction.controlDiplomacyTreaties = AutomationLevel.Undefined;
    faction.controlMilitaryAttacks = AutomationLevel.Undefined;
    faction.controlMilitaryFleets = false;
    faction.controlStateConstruction = AutomationLevel.Undefined;
    faction.controlTroopGeneration = false;
    faction.controlAgentAssignment = AutomationLevel.Undefined;
    faction.controlColonyFacilities = AutomationLevel.Undefined;
    faction.controlPopulationPolicy = false;
    faction.controlCharacterLocations = false;
    faction.controlOfferPirateMissions = AutomationLevel.Undefined;
    // Kept: controlDesigns (its designs improve: CreateNewDesigns) and controlResearch (the stock queue picks projects).
    faction.initiateConstruction = false; // also blocks crash research (researchTick.ts doCrashResearch)
}

/** Start.2.cs 1376-1427 meeting: a None relation on both sides (NotMet upgraded) — the Exchange is a public station. */
function introduce(a: Empire, b: Empire): void {
    let r = a.diplomaticRelations.byEmpire(b);
    if (r === null) a.diplomaticRelations.add(new DiplomaticRelation(DiplomaticRelationType.None, a, a, b, false));
    else if (r.type === DiplomaticRelationType.NotMet) r.type = DiplomaticRelationType.None;
    r = b.diplomaticRelations.byEmpire(a);
    if (r === null) b.diplomaticRelations.add(new DiplomaticRelation(DiplomaticRelationType.None, a, b, a, false));
    else if (r.type === DiplomaticRelationType.NotMet) r.type = DiplomaticRelationType.None;
}

/** `a` has met `b`. Pure. */
function hasMet(a: Empire, b: Empire): boolean {
    const r = a.diplomaticRelations.byEmpire(b);
    return r !== null && r.type !== DiplomaticRelationType.NotMet;
}

/** The faction's design of a sub-role: its newest buildable, else one generated from the stock specification. */
function factionDesign(galaxy: Galaxy, faction: Empire, subRole: BuiltObjectSubRole, fresh = false): Design | null {
    if (!fresh) {
        const d = latestDesignsFindNewestCanBuild(faction, subRole);
        if (d !== null) return d;
    }
    const spec = galaxyDesignSpecificationBySubRole(subRole);
    if (spec === null) return null;
    return generateDesignFromSpec(galaxy, faction, spec, 0, galaxyStarDate(galaxy));
}

/** The station design: the stock large space port plus research labs of each industry (ResearchSystem's best labs). */
function stationDesign(galaxy: Galaxy, faction: Empire): Design | null {
    const design = factionDesign(galaxy, faction, BuiltObjectSubRole.LargeSpacePort, true);
    if (design === null) return null;
    for (const type of [ComponentType.LabsWeaponsLab, ComponentType.LabsEnergyLab, ComponentType.LabsHighTechLab]) {
        const ci = faction.research.evaluateDesiredComponentImprovement(type, ShipDesignFocus.Balanced);
        if (ci !== null) for (let i = 0; i < 2; i++) design.components.push(ci.improvedComponent);
    }
    design.name = scenarioText(`${TAG} Station Name`);
    design.reDefine();
    return design;
}

/** A state-owned base / ship of the faction at `parent` (createIndependentShip / createStartingShip pattern). */
function placeFactionObject(galaxy: Galaxy, faction: Empire, design: Design, parent: Habitat, name: string | null, parking: boolean): BuiltObject {
    design.buildCount++;
    const bo = new BuiltObject(design, name ?? galaxy.generateBuiltObjectName(design, parent), galaxy, true);
    bo.empire = faction;
    bo.purchasePrice = design.calculateCurrentPurchasePrice(galaxy);
    bo.reDefine();
    bo.currentFuel = bo.fuelCapacity;
    bo.currentShields = bo.shieldsCapacity;
    bo.nearestSystemStar = galaxy.determineHabitatSystemStar(parent);
    if (parking) {
        bo.heading = galaxy.selectRandomHeading();
        bo.targetHeading = bo.heading;
        const pt = galaxy.selectRelativeParkingPoint();
        faction.addBuiltObjectToGalaxy(bo, parent, false, true, Math.trunc(pt.x), Math.trunc(pt.y), false);
    } else {
        faction.addBuiltObjectToGalaxy(bo, parent, false, true, -2000000001, -2000000001, false);
    }
    return bo;
}

/** An Exchange agent: a stock agent (generateNewCharacter) with its mission skills raised to AGENT_SKILL. */
function hireAgent(galaxy: Galaxy, st: ExchangeState): Character | null {
    const faction = st.faction;
    if (faction === null) return null;
    const c = generateNewCharacter(galaxy, faction, CharacterRole.IntelligenceAgent, st.habitat).character;
    for (const t of [CharacterSkillType.Espionage, CharacterSkillType.Sabotage, CharacterSkillType.Assassination, CharacterSkillType.PsyOps, CharacterSkillType.Concealment]) {
        const s = c.getSkill(t);
        if (s !== null) s.level = Math.max(s.level, AGENT_SKILL);
        else c.addSkill(t, AGENT_SKILL, null);
    }
    c.rebuildCachedSkillValues();
    return c;
}

function agents(st: ExchangeState): Character[] {
    if (st.faction === null) return [];
    return getEmpireCharacters(st.faction).filter((c) => c.active && c.role === CharacterRole.IntelligenceAgent);
}

/** The free protection pact with every pirate faction (Empire.8.cs 2445 ChangePirateRelation, fee 0), kept up. */
function maintainPacts(galaxy: Galaxy, st: ExchangeState): void {
    const f = st.faction;
    if (f === null) return;
    const now = galaxyStarDate(galaxy);
    for (const pirate of galaxy.pirateEmpires) {
        if (pirate === null || !pirate.active || pirate.pirateEmpireBaseHabitat === null) continue;
        if (obtainPirateRelation(pirate, f).type !== PirateRelationType.Protection) changePirateRelation(pirate, f, PirateRelationType.Protection, now, 0);
    }
}

export function exchangePlace(galaxy: Galaxy, st: ExchangeState, year: number = gameYear(galaxyStarDate(galaxy))): void {
    if (st.placed) return;
    st.placed = true;
    const candidates = centralCandidates(galaxy);
    if (candidates.length === 0) return;
    const habitat = candidates[galaxy.rnd.next(0, candidates.length)];
    const race = pickRace(galaxy);
    if (race === null) return;
    st.techLevel = Math.min(7, st.startTechLevel + P.techBonus(galaxy));
    const faction = createEmpireMidGame(galaxy, {
        kind: 'empire',
        race,
        name: '', // Empire ctor → GenerateEmpireName (Empire.cs 4482)
        adoptOnly: true,
        techLevel: st.techLevel,
        configurePolicy,
    });
    if (faction === null) return;
    faction.capital = habitat; // stand-in capital (stock AI reads Capital without a null check; 19b precedent)
    switchOffStockAi(faction);
    const now = galaxyStarDate(galaxy);
    createNewDesigns(galaxy, faction, now, now, true);
    const design = stationDesign(galaxy, faction);
    if (design === null) return;
    const bo = placeFactionObject(galaxy, faction, design, habitat, design.name, false);
    st.faction = faction;
    st.habitat = habitat;
    st.station = { bo, knowledge: [] };
    st.appearedYear = year;
    generateStartingCharacters(galaxy, faction, habitat); // leader (portrait) and the race's starting characters
    for (const e of normalEmpires(galaxy, faction)) introduce(faction, e);
    refreshCharts(galaxy, st);
    maintainPacts(galaxy, st);
    st.agentTarget = P.agents(galaxy);
    while (agents(st).length < st.agentTarget) if (hireAgent(galaxy, st) === null) break;
    for (let i = 0; i < 2; i++) fleetGroup(galaxy, st, i);
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Opened', args: [faction.name, habitat.name], subject: bo });
}

/**
 * A trading hub hears everything: at appearance and every year the Exchange merges every normal empire's galaxy map
 * (the StealGalaxyMap effect, espionage.ts mergeGalaxyMap) — its agents need known colonies to pick sabotage targets
 * (Empire.5.cs 4601 ResolveKnownColonies).
 */
function refreshCharts(galaxy: Galaxy, st: ExchangeState): void {
    const f = st.faction;
    if (f === null) return;
    const now = galaxyStarDate(galaxy);
    for (const e of normalEmpires(galaxy, f)) applyIntelligenceMissionEffect(galaxy, f, newIntelligenceMissionAgainstEmpire(f, null, IntelligenceMissionType.StealGalaxyMap, now, e));
}

// ---------------------------------------------------------------------------------------------------------------
// Wars, clients, strength
// ---------------------------------------------------------------------------------------------------------------

/** Empire.cs 1576 MilitaryPotency; ties: treasury, then empire id. */
function stronger(a: Empire, b: Empire): boolean {
    const pa = militaryPotency(a);
    const pb = militaryPotency(b);
    if (pa !== pb) return pa > pb;
    if (a.stateMoney !== b.stateMoney) return a.stateMoney > b.stateMoney;
    return a.empireId > b.empireId;
}

/** Every war among normal empires (the Exchange excluded), weaker / stronger by military potency. Pure. */
export function exchangeWarPairs(galaxy: Galaxy, faction: Empire | null = exchangeFaction(galaxy)): { weaker: Empire; stronger: Empire }[] {
    const empires = normalEmpires(galaxy, faction);
    const out: { weaker: Empire; stronger: Empire }[] = [];
    for (let i = 0; i < empires.length; i++) {
        for (let j = i + 1; j < empires.length; j++) {
            const a = empires[i];
            const b = empires[j];
            if (!atWar(a, b)) continue;
            out.push(stronger(a, b) ? { weaker: b, stronger: a } : { weaker: a, stronger: b });
        }
    }
    return out;
}

function fundedEmpireIds(galaxy: Galaxy, faction: Empire | null): Set<number> {
    return new Set(exchangeWarPairs(galaxy, faction).map((w) => w.weaker.empireId));
}

/** Mission targets: grudged empires (worst first, at war or not), war-weary empires at war (most weary first), then the strongest third by potency. Pure. */
export function exchangeMissionTargets(galaxy: Galaxy, faction: Empire): Empire[] {
    const gst = peekExchangeState(galaxy);
    const grudged = gst !== null ? exchangeGrudged(galaxy, gst) : [];
    const clients = normalEmpires(galaxy, faction).filter((e) => e.colonies.length > 0);
    const atWarAny = (e: Empire): boolean => clients.some((o) => o !== e && atWar(e, o));
    const weary = clients.filter((e) => e.warWearinessRaw > 0 && atWarAny(e)).sort((a, b) => b.warWearinessRaw - a.warWearinessRaw || a.empireId - b.empireId);
    const strongest = [...clients].sort((a, b) => militaryPotency(b) - militaryPotency(a) || a.empireId - b.empireId).slice(0, Math.max(1, Math.ceil(clients.length / 3)));
    const out: Empire[] = [];
    for (const e of [...grudged, ...weary, ...strongest]) if (!out.includes(e)) out.push(e);
    return out;
}

/** The victim's war enemy the false flag names (the weakest enemy — the Exchange's client). */
function falseFlagEnemy(galaxy: Galaxy, faction: Empire, victim: Empire): Empire | null {
    let best: Empire | null = null;
    for (const e of normalEmpires(galaxy, faction)) {
        if (e === victim || !atWar(e, victim)) continue;
        if (best === null || stronger(best, e)) best = e;
    }
    return best;
}

// ---------------------------------------------------------------------------------------------------------------
// Yearly: appearance, income, underdog funding, map gifts, intel sales, agent growth
// ---------------------------------------------------------------------------------------------------------------

export function exchangeYearly(galaxy: Galaxy, year: number): void {
    const st = exchangeState(galaxy);
    if (st.ended) return;
    if (!st.placed) {
        const startYear = gameYear(startStarDateForAge(galaxy.age));
        if (year < startYear + P.year(galaxy)) return;
        exchangePlace(galaxy, st, year);
    }
    const f = st.faction;
    if (f === null) return;
    if (!f.active) {
        st.ended = true; // eliminated by other means
        return;
    }
    if (st.station === null || st.station.bo.hasBeenDestroyed) {
        collapse(galaxy, st, null);
        return;
    }
    sweepTreasury(st);
    refreshCharts(galaxy, st);
    exchangeGrudgeYearly(galaxy, st);
    payYearlyIncome(galaxy, st, year);
    fundUnderdogs(galaxy, st);
    giftMaps(galaxy, st, year);
    aiIntelSales(galaxy, st);
    offerPlayerIntel(galaxy, st);
    // Agents grow by one a year while the income allows (the hire is paid from money above the reserve).
    if (year > st.appearedYear && st.agentTarget < P.agentsMax(galaxy) && exchangeSpendable(st) >= P.missionCost(galaxy) * AGENT_HIRE_MISSIONS) st.agentTarget++;
}

/** Underdog funding: the weaker side of each war gets exchangeFundPct of its treasury from the purse (to the reserve). */
export function fundUnderdogs(galaxy: Galaxy, st: ExchangeState): number {
    const pct = P.fundPct(galaxy) / 100;
    let total = 0;
    for (const w of exchangeWarPairs(galaxy, st.faction)) {
        if (exchangeIsGrudged(galaxy, st, w.weaker)) continue; // never funded
        const amount = Math.min(pct * Math.max(0, w.weaker.stateMoney), exchangeSpendable(st));
        if (!(amount > 0)) continue;
        w.weaker.stateMoney += amount;
        st.purse -= amount;
        st.fundedTotal += amount;
        total += amount;
        st.fundLog.push({ date: galaxyStarDate(galaxy), empireId: w.weaker.empireId, amount });
        trimLog(st.fundLog);
        scenarioMessage(galaxy, w.weaker, scenarioText(`${TAG} Funding Title`), scenarioText(`${TAG} Funding`, Math.round(amount), w.stronger.name), {
            type: EmpireMessageType.GeneralGoodEvent,
            log: { category: 'threat', data: { amount: Math.round(amount) } },
        });
    }
    return total;
}

/** The weaker side of each war is given the stronger side's galaxy map and operations map (a gift). */
export function giftMaps(galaxy: Galaxy, st: ExchangeState, year: number): void {
    const f = st.faction;
    if (f === null) return;
    const T = IntelligenceMissionType;
    for (const w of exchangeWarPairs(galaxy, f)) {
        if (exchangeIsGrudged(galaxy, st, w.weaker)) continue;
        const now = galaxyStarDate(galaxy);
        applyIntelligenceMissionEffect(galaxy, w.weaker, newIntelligenceMissionAgainstEmpire(f, null, T.StealGalaxyMap, now, w.stronger));
        applyIntelligenceMissionEffect(galaxy, w.weaker, newIntelligenceMissionAgainstEmpire(f, null, T.StealOperationsMap, now, w.stronger));
        st.giftLog.push({ year, weakerId: w.weaker.empireId, strongerId: w.stronger.empireId });
        trimLog(st.giftLog);
        scenarioMessage(galaxy, w.weaker, scenarioText(`${TAG} Gift Title`), scenarioText(`${TAG} Gift`, w.stronger.name), {
            type: EmpireMessageType.GeneralGoodEvent,
            subject: st.station?.bo ?? null,
            log: { category: 'threat' },
        });
    }
}

/** Price of intelligence on `rival`: exchangeIntelPrice scaled by the rival's size (√ colonies, at least 1). Pure. */
export function exchangeIntelPrice(galaxy: Galaxy, rival: Empire): number {
    return Math.round(P.intelPrice(galaxy) * Math.max(1, Math.sqrt(rival.colonies.length)));
}

/** A rival `buyer` is at war with (lowest empire id), or null. Pure. */
function warRival(galaxy: Galaxy, faction: Empire, buyer: Empire): Empire | null {
    for (const e of normalEmpires(galaxy, faction)) if (e !== buyer && atWar(buyer, e)) return e;
    return null;
}

/**
 * Sells `item` on `rival` to `buyer` for `price`: the buyer pays (the purse books it as brokerage), the item is
 * delivered through the stock mission effect, and the rival learns of the purchase once it knows the Exchange (trace).
 * Returns false when it could not be delivered or paid.
 */
export function sellIntel(galaxy: Galaxy, st: ExchangeState, buyer: Empire, rival: Empire, item: ExchangeIntelItem, price: number, by: 'ai' | 'player'): boolean {
    const f = st.faction;
    if (f === null || st.ended || buyer.stateMoney < price || exchangeIsGrudged(galaxy, st, buyer)) return false;
    const T = IntelligenceMissionType;
    const now = galaxyStarDate(galaxy);
    let mission: IntelligenceMission;
    if (item === 'tech') {
        const agent = agents(st)[0] ?? null;
        const projects = resolveMoreAdvancedProjectsIncludeSpecial(buyer, rival, false);
        if (agent === null || projects.length === 0) return false;
        mission = newIntelligenceMissionStealTechData(f, agent, now, rival, projects[0]);
    } else {
        mission = newIntelligenceMissionAgainstEmpire(f, null, item === 'galaxyMap' ? T.StealGalaxyMap : T.StealOperationsMap, now, rival);
    }
    buyer.stateMoney -= price;
    addIncome(galaxy, st, price);
    st.brokerageTotal += price;
    applyIntelligenceMissionEffect(galaxy, buyer, mission);
    st.sales.push({ date: now, buyerId: buyer.empireId, rivalId: rival.empireId, item, price, by });
    trimLog(st.sales);
    addTrace(galaxy, st, { victimId: rival.empireId, actorId: buyer.empireId, cause: 'exchange.boughtIntel', value: -10, tag: `${TAG} Sale Traced`, args: [buyer.name] });
    scenarioMessage(galaxy, buyer, scenarioText(`${TAG} Sale Title`), scenarioText(`${TAG} Sale ${item}`, rival.name, price), { log: { category: 'threat', data: { price } } });
    return true;
}

const SALE_ITEMS: readonly ExchangeIntelItem[] = ['galaxyMap', 'operationsMap', 'tech'];

/** AI empires at war that have met the Exchange buy when their treasury exceeds 4 × the price (one item a year). */
export function aiIntelSales(galaxy: Galaxy, st: ExchangeState): void {
    const f = st.faction;
    if (f === null) return;
    for (const buyer of normalEmpires(galaxy, f)) {
        if (buyer === galaxy.playerEmpire || !hasMet(buyer, f) || exchangeIsGrudged(galaxy, st, buyer)) continue;
        const rival = warRival(galaxy, f, buyer);
        if (rival === null) continue;
        const price = exchangeIntelPrice(galaxy, rival);
        if (!(buyer.stateMoney > price * 4)) continue;
        const k = st.saleCursor[buyer.empireId] ?? 0;
        let sold = false;
        for (let i = 0; i < SALE_ITEMS.length && !sold; i++) sold = sellIntel(galaxy, st, buyer, rival, SALE_ITEMS[(k + i) % SALE_ITEMS.length], price, 'ai');
        st.saleCursor[buyer.empireId] = k + 1;
    }
}

/** The player's yearly offer: "Buy intelligence on <rival> for N credits" (scenario decision; one pending at a time). */
export function offerPlayerIntel(galaxy: Galaxy, st: ExchangeState): ScenarioDecision | null {
    const f = st.faction;
    const player = galaxy.playerEmpire;
    if (f === null || player === null || !player.active || player === f || !hasMet(player, f) || exchangeIsGrudged(galaxy, st, player)) return null;
    if (pendingScenarioDecisions(galaxy, player).some((d) => d.kind === EXCHANGE_BUY_INTEL_DECISION)) return null;
    const rival = warRival(galaxy, f, player);
    if (rival === null) return null;
    const price = exchangeIntelPrice(galaxy, rival);
    return raiseScenarioDecision(galaxy, player, {
        kind: EXCHANGE_BUY_INTEL_DECISION,
        title: scenarioText(`${TAG} Offer Title`, rival.name, price),
        text: scenarioText(`${TAG} Offer`, rival.name, price, f.name),
        options: [
            { id: 'decline', label: scenarioText(`${TAG} Offer decline`) },
            { id: 'galaxyMap', label: scenarioText(`${TAG} Offer galaxyMap`) },
            { id: 'operationsMap', label: scenarioText(`${TAG} Offer operationsMap`) },
            { id: 'tech', label: scenarioText(`${TAG} Offer tech`) },
        ],
        defaultOption: 'decline',
        expiresDays: 60,
        context: { rivalId: rival.empireId, price },
    });
}

function resolveBuyIntel(galaxy: Galaxy, d: ScenarioDecision, optionId: string): void {
    const st = peekExchangeState(galaxy);
    if (st === null || st.faction === null || st.ended) return;
    if (optionId === 'decline') {
        // Refusing repeatedly (the second refusal on) breeds a grudge.
        const r = (st.refusals ??= {});
        r[d.empire.empireId] = (r[d.empire.empireId] ?? 0) + 1;
        if (r[d.empire.empireId] >= 2) addGrudge(galaxy, st, d.empire, EXCHANGE_GRUDGE.refusal, 'refusal');
        return;
    }
    const rival = findEmpire(galaxy, Number(d.context.rivalId));
    const price = Number(d.context.price);
    if (rival === null || !rival.active) return;
    if (!sellIntel(galaxy, st, d.empire, rival, optionId as ExchangeIntelItem, price, 'player')) {
        scenarioMessage(galaxy, d.empire, scenarioText(`${TAG} Sale Title`), scenarioText(`${TAG} Sale Failed`, rival.name));
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Grudges: what empires did to the Exchange drives its covert targeting (no message to the target)
// ---------------------------------------------------------------------------------------------------------------

/** Adds `amount` to `empire`'s grudge (normal empires only). */
export function addGrudge(galaxy: Galaxy, st: ExchangeState, empire: Empire | null, amount: number, source: ExchangeGrudgeSource): void {
    if (empire === null || empire === st.faction || !empire.active || empire.pirateEmpireBaseHabitat !== null || empire === galaxy.independentEmpire || !(amount > 0)) return;
    const gr = (st.grudges ??= {});
    gr[empire.empireId] = (gr[empire.empireId] ?? 0) + amount;
    const log = (st.grudgeLog ??= []);
    log.push({ date: galaxyStarDate(galaxy), empireId: empire.empireId, source, amount });
    trimLog(log);
}

export function exchangeGrudge(st: ExchangeState, empire: Empire): number {
    return st.grudges?.[empire.empireId] ?? 0;
}

/** Grudge above exchangeGrudgeThreshold. Pure. */
export function exchangeIsGrudged(galaxy: Galaxy, st: ExchangeState, empire: Empire): boolean {
    return exchangeGrudge(st, empire) > P.grudgeThreshold(galaxy);
}

/** Grudged active normal empires, worst grudge first (ties: empire id). Pure. */
export function exchangeGrudged(galaxy: Galaxy, st: ExchangeState): Empire[] {
    if (st.grudges === undefined) return [];
    return normalEmpires(galaxy, st.faction)
        .filter((e) => exchangeIsGrudged(galaxy, st, e))
        .sort((a, b) => exchangeGrudge(st, b) - exchangeGrudge(st, a) || a.empireId - b.empireId);
}

/** Per period: a blockade of the station, and council sanctions against the Exchange (counted once per sanction). */
export function accrueGrudgesPeriodic(galaxy: Galaxy, st: ExchangeState): void {
    const f = st.faction;
    if (f === null || st.station === null) return;
    const blockade = blockadeFor(galaxy, st.station.bo);
    if (blockade !== null) addGrudge(galaxy, st, blockade.initiator, EXCHANGE_GRUDGE.blockade, 'blockade');
    const cs = peekCouncilState(galaxy);
    if (cs === null) return;
    const seen = (st.sanctionsSeen ??= []);
    for (const c of cs.councils) {
        for (const sn of c.sanctions) {
            if (sn.target !== f || sn.kind !== 'sanction') continue;
            const key = `${c.id}:${sn.year}`;
            if (seen.includes(key)) continue;
            seen.push(key);
            for (const m of c.members) addGrudge(galaxy, st, m, EXCHANGE_GRUDGE.sanction, 'sanction');
        }
    }
}

/**
 * Yearly: every grudge decays by exchangeGrudgeDecay %, then the empire with the worst 19o ledger standing toward the
 * Exchange (its causes about the Exchange: caught agents, traced sales and contracts — what passed between them) adds
 * that standing (capped at reputationMax).
 */
export function exchangeGrudgeYearly(galaxy: Galaxy, st: ExchangeState): void {
    const f = st.faction;
    if (f === null) return;
    const gr = (st.grudges ??= {});
    const keep = 1 - P.grudgeDecay(galaxy) / 100;
    for (const id of Object.keys(gr)) {
        gr[Number(id)] *= keep;
        if (gr[Number(id)] < 1e-6) delete gr[Number(id)];
    }
    let worst: Empire | null = null;
    let worstSum = 0;
    for (const e of normalEmpires(galaxy, f)) {
        const sum = reputationSum(galaxy, e, f);
        if (sum < worstSum) {
            worst = e;
            worstSum = sum;
        }
    }
    if (worst !== null) addGrudge(galaxy, st, worst, Math.min(EXCHANGE_GRUDGE.reputationMax, -worstSum), 'reputation');
}

/** builtObjectKilledBy: an empire destroyed the station, a warship or a research station of the Exchange. */
function onKilled(galaxy: Galaxy, bo: BuiltObject, destroyer: Empire | null): void {
    const st = peekExchangeState(galaxy);
    if (st === null || st.ended || st.faction === null || destroyer === null) return;
    const mine = bo.actualEmpire === st.faction || st.warships.includes(bo) || st.researchStations.includes(bo) || st.station?.bo === bo;
    if (mine) addGrudge(galaxy, st, destroyer, EXCHANGE_GRUDGE.attack, 'attack');
}

// ---------------------------------------------------------------------------------------------------------------
// Traces (reputation causes that land on discovery)
// ---------------------------------------------------------------------------------------------------------------

function addTrace(galaxy: Galaxy, st: ExchangeState, t: ExchangeTrace): void {
    st.traces.push(t);
    flushTraces(galaxy, st);
}

/** Traces whose victim now knows the Exchange (≥ suspected) land: a reputation cause and an event-log line. */
export function flushTraces(galaxy: Galaxy, st: ExchangeState): void {
    if (st.station === null || st.traces.length === 0) return;
    const keep: ExchangeTrace[] = [];
    for (const t of st.traces) {
        const victim = findEmpire(galaxy, t.victimId);
        const actor = findEmpire(galaxy, t.actorId);
        if (victim === null || actor === null || !victim.active || !actor.active) continue;
        if (knowledgeLevel(st.station, victim) < KNOWLEDGE_SUSPECTED) {
            keep.push(t);
            continue;
        }
        applyReputation(galaxy, victim, actor, t.value, { cause: t.cause, source: '19f' });
        scenarioMessage(galaxy, victim, scenarioText(`${TAG} Trace Title`), scenarioText(t.tag, ...t.args), { type: EmpireMessageType.GeneralBadEvent, subject: st.station.bo, log: { category: 'threat' } });
    }
    st.traces = keep;
}

function reveal(galaxy: Galaxy, st: ExchangeState, empire: Empire, level: number): boolean {
    if (st.station === null) return false;
    const changed = revealTo(galaxy, st.station, empire, level);
    if (changed) flushTraces(galaxy, st);
    return changed;
}

// ---------------------------------------------------------------------------------------------------------------
// Periodic: sweep, pacts, agents, contracts, research, fleet, blockade
// ---------------------------------------------------------------------------------------------------------------

export function exchangePeriodic(galaxy: Galaxy): void {
    const st = peekExchangeState(galaxy);
    if (st === null || st.ended || st.faction === null || st.station === null) return;
    if (!st.faction.active) return;
    if (st.station.bo.hasBeenDestroyed) {
        collapse(galaxy, st, null);
        return;
    }
    sweepTreasury(st);
    maintainPacts(galaxy, st);
    accrueGrudgesPeriodic(galaxy, st);
    reviewMissions(galaxy, st);
    assignAgents(galaxy, st);
    reviewContracts(galaxy, st);
    postContracts(galaxy, st);
    buyResearchStations(galaxy, st);
    buyWarships(galaxy, st);
    recallFleet(galaxy, st);
    flushTraces(galaxy, st);
    exchangeBlockadeCheck(galaxy);
}

// --- Agents -------------------------------------------------------------------------------------------------------

function idle(c: Character): boolean {
    const m = characterMission(c);
    return m === null || m.type === IntelligenceMissionType.Undefined || m.type === IntelligenceMissionType.CounterIntelligence;
}

/** A mission of `type` for `agent` against `target` with the stock timing (Empire.5.cs 4183 skill → 1 y / 3 m / 1 m). */
function buildMission(galaxy: Galaxy, faction: Empire, agent: Character, type: IntelligenceMissionType, target: Empire): IntelligenceMission | null {
    const T = IntelligenceMissionType;
    const now = galaxyStarDate(galaxy);
    let m: IntelligenceMission | null = null;
    switch (type) {
        case T.SabotageColony:
        case T.SabotageConstruction: {
            let colonies = resolveKnownColonies(faction, target);
            if (type === T.SabotageConstruction) colonies = colonies.filter((h) => h.constructionQueue !== null && (h.constructionQueue as { constructionYards?: { shipUnderConstruction: unknown }[] }).constructionYards?.some((y) => y.shipUnderConstruction !== null) === true);
            if (colonies.length === 0) return null;
            m = newIntelligenceMissionAgainstHabitat(faction, agent, type, now, colonies[galaxy.rnd.next(0, colonies.length)]);
            break;
        }
        case T.AssassinateCharacter: {
            const chars = resolveKnownCharacters(galaxy, faction, target).filter((c) => c.active);
            if (chars.length === 0) return null;
            m = newIntelligenceMissionAgainstCharacter(faction, agent, type, now, chars[galaxy.rnd.next(0, chars.length)]);
            break;
        }
        case T.StealTechData: {
            const projects = resolveMoreAdvancedProjectsIncludeSpecial(faction, target, false);
            if (projects.length === 0) return null;
            m = newIntelligenceMissionStealTechData(faction, agent, now, target, projects[galaxy.rnd.next(0, projects.length)]);
            break;
        }
        case T.StealGalaxyMap:
        case T.StealOperationsMap:
            m = newIntelligenceMissionAgainstEmpire(faction, agent, type, now, target);
            break;
        default:
            return null;
    }
    return cascadeTimeLength(m, calculateIntelligenceMissionSkill(faction, agent, type, target));
}

/** Idle agents start their next mission (targets and types round-robin), each paid from money above the reserve. */
export function assignAgents(galaxy: Galaxy, st: ExchangeState): number {
    const f = st.faction;
    if (f === null) return 0;
    const cost = P.missionCost(galaxy);
    // Replace lost agents up to the target (a hire costs AGENT_HIRE_MISSIONS missions).
    while (agents(st).length < st.agentTarget && exchangeSpendable(st) >= cost * AGENT_HIRE_MISSIONS) {
        if (hireAgent(galaxy, st) === null) break;
        st.purse -= cost * AGENT_HIRE_MISSIONS;
        st.spent.agents += cost * AGENT_HIRE_MISSIONS;
    }
    const targets = exchangeMissionTargets(galaxy, f);
    if (targets.length === 0) return 0;
    const types = missionTypes();
    const grudged = exchangeGrudged(galaxy, st);
    const gTypes = grudgeMissionTypes();
    let assigned = 0;
    for (const agent of agents(st)) {
        if (!idle(agent) || exchangeSpendable(st) < cost) continue;
        let m: IntelligenceMission | null = null;
        let victim: Empire | null = null;
        // Grudged empires first: sabotage, assassination and technology theft.
        for (let tries = 0; tries < grudged.length * gTypes.length && m === null; tries++) {
            const gc = st.grudgeCursor ?? 0;
            victim = grudged[Math.trunc(gc / gTypes.length) % grudged.length];
            m = buildMission(galaxy, f, agent, gTypes[gc % gTypes.length], victim);
            st.grudgeCursor = gc + 1;
        }
        for (let tries = 0; tries < targets.length * types.length && m === null; tries++) {
            victim = targets[st.targetCursor % targets.length];
            const type = types[st.typeCursor % types.length];
            st.typeCursor++;
            if (st.typeCursor % types.length === 0) st.targetCursor++;
            m = buildMission(galaxy, f, agent, type, victim);
        }
        if (m === null || victim === null) break;
        m.agent = agent;
        agent.mission = m;
        st.purse -= cost;
        st.spent.missions += cost;
        st.missions.push({ agent, mission: m, victim, date: galaxyStarDate(galaxy) });
        st.missionLog.push({ date: galaxyStarDate(galaxy), type: m.type, victimId: victim.empireId });
        trimLog(st.missionLog);
        st.missionsAssigned++;
        assigned++;
    }
    return assigned;
}

/**
 * Resolved missions: a detected / captured agent (the stock outcome) or an agent killed on the mission (the target's
 * stock counter-intelligence, espionage.ts performIntelligenceMissions CounterIntelligence branch) is a catch.
 */
export function reviewMissions(galaxy: Galaxy, st: ExchangeState): void {
    const O = IntelligenceMissionOutcome;
    const keep: ExchangeMission[] = [];
    for (const t of st.missions) {
        const o = t.mission.outcome;
        const current = t.agent.active && characterMission(t.agent) === t.mission;
        if (o === O.Capture || o === O.FailDetect || o === O.SucceedDetect) {
            exchangeAgentCaught(galaxy, st, t.victim, o);
            continue;
        }
        if (o === O.Undefined && !t.agent.active) {
            exchangeAgentCaught(galaxy, st, t.victim, O.Capture);
            continue;
        }
        if (current && o === O.Undefined) keep.push(t);
    }
    st.missions = keep;
}

/**
 * The victim caught an Exchange agent: its knowledge of the Exchange rises (suspected, confirmed on a second catch), a
 * 19m security lead of kind exchangeAgent at the station follows, and a reputation cause against the Exchange.
 */
export function exchangeAgentCaught(galaxy: Galaxy, st: ExchangeState, victim: Empire, outcome: number): void {
    const f = st.faction;
    if (f === null || st.station === null || !victim.active) return;
    const n = (st.catches[victim.empireId] ?? 0) + 1;
    st.catches[victim.empireId] = n;
    addGrudge(galaxy, st, victim, EXCHANGE_GRUDGE.catch, 'catch');
    st.caughtLog.push({ date: galaxyStarDate(galaxy), victimId: victim.empireId, outcome });
    trimLog(st.caughtLog);
    const level = n >= 2 ? KNOWLEDGE_CONFIRMED : KNOWLEDGE_SUSPECTED;
    registerHiddenThing(galaxy, { kind: 'exchangeAgent', concealment: 25 * (1 + (AGENT_SKILL / 100) * 3), empire: victim, target: st.station.bo, package: '19f.exchange', site: st.station });
    reveal(galaxy, st, victim, level);
    mirrorPackageDiscovery(galaxy, { knowledge: st.station.knowledge }, victim, Math.max(level, knowledgeLevel(st.station, victim)));
    applyReputation(galaxy, victim, f, -10, { cause: 'exchange.agentCaught', source: '19f' });
    arcMessage(galaxy, st.sentStages, [victim], { prefix: TAG, stage: level >= KNOWLEDGE_CONFIRMED ? 'Agent Confirmed' : 'Agent Caught', onceKey: `Agent:${victim.empireId}:${level}`, args: [f.name], subject: st.station.bo });
}

// --- Contracts ----------------------------------------------------------------------------------------------------

function pirates(galaxy: Galaxy): Empire[] {
    return galaxy.pirateEmpires.filter((e): e is Empire => e !== null && e.active && e.pirateEmpireBaseHabitat !== null);
}

/** A pirate faction would accept an Attack contract on `victim` (it does not protect it: PirateCheckAcceptAttackMission). */
function attackable(galaxy: Galaxy, victim: Empire): boolean {
    return pirates(galaxy).some((pf) => obtainPirateRelation(pf, victim).type !== PirateRelationType.Protection);
}

/** Posts one contract (EmpireActivity in the Exchange's name, as postAttackOffers / MakeDefendOffersToPirates). */
export function exchangePostContract(galaxy: Galaxy, st: ExchangeState, kind: 'attack' | 'defend', victim: Empire, target: Habitat | BuiltObject, price: number): boolean {
    const f = st.faction!;
    const type = kind === 'attack' ? EmpireActivityType.Attack : EmpireActivityType.Defend;
    if (f.pirateMissions.containsEquivalentTarget(target, type)) return false;
    const now = galaxyStarDate(galaxy);
    const expiryDate = now + Math.trunc(1.0 * REAL_SECONDS_IN_GALACTIC_YEAR * 1000.0);
    const activity = new EmpireActivity(victim, f, expiryDate, type, target, price);
    f.pirateMissions.add(activity);
    galaxy.pirateMissions.add(activity);
    st.contracts.push({ activity, kind, victim, date: now });
    st.contractsPosted[kind]++;
    const msgType = kind === 'attack' ? EmpireMessageType.PirateAttackMissionAvailable : EmpireMessageType.PirateDefendMissionAvailable;
    const text = gameText(kind === 'attack' ? 'Pirate Attack Mission Available' : 'Pirate Defend Mission Available', f.name, target.name);
    for (const pf of pirates(galaxy)) sendMessageToEmpire(f, pf, msgType, activity, text);
    return true;
}

/**
 * Posts this period's contracts: first Attack contracts on the bases of grudged empires (at war or not), then for each
 * war Defend on the weaker side's colonies and ports (any client: pirates bid on Exchange-financed Defend contracts
 * without protecting the client, the pirateDefendBidAllowed query; never for a grudged client) and Attack on the
 * stronger side's bases (when a pirate faction would take it). Bounded by live wars / grudges and their targets; each
 * contract only while money above the reserve and the open commitments covers its price.
 */
export function postContracts(galaxy: Galaxy, st: ExchangeState): number {
    const f = st.faction;
    if (f === null || pirates(galaxy).length === 0) return 0;
    let posted = 0;
    const attackBases = (victim: Empire): void => {
        if (!attackable(galaxy, victim)) return;
        for (const b of victim.builtObjects) {
            if (b.hasBeenDestroyed || b.role !== BuiltObjectRole.Base || b.actualEmpire !== victim) continue;
            const price = calculatePirateAttackPrice(galaxy, f, b);
            if (!(price > 0) || !Number.isFinite(price) || exchangeSpendable(st) < price) continue;
            if (exchangePostContract(galaxy, st, 'attack', victim, b, price)) posted++;
        }
    };
    for (const e of exchangeGrudged(galaxy, st)) attackBases(e);
    const pairs = exchangeWarPairs(galaxy, f);
    for (const w of pairs) {
        if (!exchangeIsGrudged(galaxy, st, w.weaker)) {
            const targets: (Habitat | BuiltObject)[] = [...w.weaker.colonies, ...w.weaker.spacePorts];
            for (const t of targets) {
                if (t.hasBeenDestroyed) continue;
                const price = calculatePirateDefendPrice(galaxy, f, t);
                if (!(price > 0) || exchangeSpendable(st) < price) continue;
                if (exchangePostContract(galaxy, st, 'defend', w.weaker, t, price)) posted++;
            }
        }
        attackBases(w.stronger);
    }
    return posted;
}

/** Ended contracts leave the list; a completed Attack contract (its target destroyed) is a trace for the victim. */
function reviewContracts(galaxy: Galaxy, st: ExchangeState): void {
    const f = st.faction;
    if (f === null) return;
    const keep: ExchangeContract[] = [];
    for (const c of st.contracts) {
        const open = f.pirateMissions.items.includes(c.activity) || galaxy.pirateMissions.items.includes(c.activity);
        if (open) {
            keep.push(c);
            continue;
        }
        const t = c.activity.target;
        if (c.kind === 'attack' && t !== null && t.hasBeenDestroyed && c.activity.assignedEmpire !== null) {
            st.contractsSucceeded++;
            addTrace(galaxy, st, { victimId: c.victim.empireId, actorId: f.empireId, cause: 'exchange.contract', value: -10, tag: `${TAG} Contract Traced`, args: [t.name, c.activity.assignedEmpire.name] });
        }
    }
    st.contracts = keep;
}

// --- Research stations ----------------------------------------------------------------------------------------------

const RESEARCH_SUBROLES = (): BuiltObjectSubRole[] => [BuiltObjectSubRole.WeaponsResearchStation, BuiltObjectSubRole.EnergyResearchStation];

/** Up to two research stations at habitats of the station's system, bought from money above the reserve. */
export function buyResearchStations(galaxy: Galaxy, st: ExchangeState): number {
    const f = st.faction;
    const home = st.habitat;
    if (f === null || home === null) return 0;
    st.researchStations = st.researchStations.filter((b) => !b.hasBeenDestroyed && b.actualEmpire === f);
    let bought = 0;
    const subRoles = RESEARCH_SUBROLES();
    while (st.researchStations.length < subRoles.length) {
        const sub = subRoles.find((s) => !st.researchStations.some((b) => b.subRole === s)) ?? subRoles[0];
        const design = factionDesign(galaxy, f, sub);
        if (design === null) break;
        const price = design.calculateCurrentPurchasePrice(galaxy);
        if (exchangeSpendable(st) < price) break;
        const used = new Set(st.researchStations.map((b) => b.parentHabitat));
        const sites = galaxy.systemHabitatsOf(home.systemIndex).filter((h) => h !== null && !h.hasBeenDestroyed && h.empire === null && !used.has(h));
        const site = sites.find((h) => h !== home) ?? sites[0] ?? home;
        const bo = placeFactionObject(galaxy, f, design, site, null, false);
        st.researchStations.push(bo);
        st.purse -= price;
        st.spent.research += price;
        bought++;
    }
    return bought;
}

// --- Fleet ----------------------------------------------------------------------------------------------------------

/** Fleet `i` (0 / 1): a Defend-posture fleet gathered at the station, its posture range the system (Galaxy.9.cs 300-314). */
function fleetGroup(galaxy: Galaxy, st: ExchangeState, i: number): ShipGroup | null {
    const f = st.faction;
    if (f === null || st.habitat === null) return null;
    const existing = st.fleets[i];
    if (existing !== undefined && empireShipGroups(f).includes(existing)) return existing;
    const g = new ShipGroup(galaxy);
    g.empire = f;
    g.gatherPoint = st.habitat;
    g.posture = FleetPosture.Defend;
    g.postureRangeSquared = galaxy.maxSolarSystemSize * galaxy.maxSolarSystemSize;
    g.name = scenarioText(`${TAG} Fleet Name`, i + 1);
    empireShipGroups(f).push(g);
    st.fleets[i] = g;
    return g;
}

function liveWarships(st: ExchangeState): BuiltObject[] {
    const f = st.faction;
    st.warships = st.warships.filter((b) => !b.hasBeenDestroyed && b.actualEmpire === f);
    return st.warships;
}

/** Escort / frigate early; destroyer / cruiser once its designs can build them (newest buildable, best first). */
function warshipDesign(galaxy: Galaxy, faction: Empire, n: number): Design | null {
    const S = BuiltObjectSubRole;
    const big = [S.Cruiser, S.Destroyer].map((s) => latestDesignsFindNewestCanBuild(faction, s)).filter((d): d is Design => d !== null);
    if (big.length > 0) return big[n % big.length];
    const small = n % 2 === 1 ? [S.Frigate, S.Escort] : [S.Escort, S.Frigate];
    for (const s of small) {
        const d = factionDesign(galaxy, faction, s);
        if (d !== null) return d;
    }
    return null;
}

/** Buys warships up to exchangeFleetCap from money above the reserve, filling the smaller of the two fleets first. */
export function buyWarships(galaxy: Galaxy, st: ExchangeState): number {
    const f = st.faction;
    if (f === null || st.habitat === null) return 0;
    const g0 = fleetGroup(galaxy, st, 0);
    const g1 = fleetGroup(galaxy, st, 1);
    if (g0 === null || g1 === null) return 0;
    for (const g of [g0, g1] as ShipGroup[]) {
        g.ships = g.ships.filter((b) => !b.hasBeenDestroyed && b.actualEmpire === f);
        if (g.leadShip !== null && (g.leadShip.hasBeenDestroyed || !g.ships.includes(g.leadShip))) g.leadShip = g.ships[0] ?? null;
    }
    let bought = 0;
    while (liveWarships(st).length < P.fleetCap(galaxy)) {
        const design = warshipDesign(galaxy, f, st.warships.length);
        if (design === null) break;
        const price = design.calculateCurrentPurchasePrice(galaxy);
        if (exchangeSpendable(st) < price) break;
        const bo = placeFactionObject(galaxy, f, design, st.habitat, null, true);
        const g = g0.ships.length <= g1.ships.length ? g0 : g1;
        g.ships.push(bo);
        bo.shipGroup = g;
        if (g.leadShip === null) g.leadShip = bo;
        st.warships.push(bo);
        st.purse -= price;
        st.spent.fleet += price;
        bought++;
    }
    return bought;
}

/** The station's system star. */
function systemStar(galaxy: Galaxy, st: ExchangeState): Habitat | null {
    return st.habitat !== null ? galaxy.determineHabitatSystemStar(st.habitat) : null;
}

/** (x, y) lies inside the station's system (Galaxy.MaxSolarSystemSize of its star, the addBuiltObjectToGalaxy margin). Pure. */
export function exchangeInSystem(galaxy: Galaxy, st: ExchangeState, x: number, y: number): boolean {
    const star = systemStar(galaxy, st);
    if (star === null) return false;
    return galaxy.calculateDistance(x, y, star.xpos, star.ypos) <= galaxy.maxSolarSystemSize + 500;
}

/** Warships outside the system (or idle) patrol the station again (BuiltObjectMissionType.Patrol, as pirate base guards). */
export function recallFleet(galaxy: Galaxy, st: ExchangeState): number {
    if (st.station === null) return 0;
    let recalled = 0;
    for (const b of liveWarships(st)) {
        const m = builtObjectMission(b.mission);
        const idleShip = m === null || m.type === BuiltObjectMissionType.Undefined;
        if (!idleShip && exchangeInSystem(galaxy, st, b.xpos, b.ypos)) continue;
        assignMission(galaxy, b, BuiltObjectMissionType.Patrol, st.station.bo, null, BuiltObjectMissionPriority.Low);
        recalled++;
    }
    return recalled;
}

// ---------------------------------------------------------------------------------------------------------------
// Queries and events
// ---------------------------------------------------------------------------------------------------------------

/** assignMissionAllowed: the Exchange's ships never colonise / invade / bombard, and never take a mission out of system. */
function missionAllowed(galaxy: Galaxy, value: boolean, a: { builtObject: BuiltObject; missionType: number; target: unknown; x: number; y: number }): boolean {
    if (!value) return value;
    const st = peekExchangeState(galaxy);
    if (st === null || st.ended || st.faction === null || a.builtObject.actualEmpire !== st.faction) return value;
    const M = BuiltObjectMissionType;
    if (a.missionType === M.Colonize || a.missionType === M.UnloadTroops || a.missionType === M.Bombard || a.missionType === M.WaitAndBombard) return false;
    let x = a.x;
    let y = a.y;
    const t = a.target as { xpos?: unknown; ypos?: unknown } | null;
    if (t !== null && typeof t === 'object' && typeof t.xpos === 'number' && typeof t.ypos === 'number') {
        x = t.xpos;
        y = t.ypos;
    }
    if (x <= COORD_UNSET || y <= COORD_UNSET) return true;
    return exchangeInSystem(galaxy, st, x, y);
}

/** contractInitiated: the docking tariff on a trade whose selling point or destination is the station. */
function onContract(galaxy: Galaxy, sellingPoint: unknown, destination: unknown, value: number): void {
    const st = peekExchangeState(galaxy);
    if (st === null || st.ended || st.station === null) return;
    if (sellingPoint !== st.station.bo && destination !== st.station.bo) return;
    const tariff = (P.tariffPct(galaxy) / 100) * Math.max(0, value);
    if (!(tariff > 0)) return;
    addIncome(galaxy, st, tariff);
    st.tariffTotal += tariff;
}

function onIntelMissionCompleted(galaxy: Galaxy, empire: Empire, mission: unknown): void {
    const st = peekExchangeState(galaxy);
    if (st === null || st.station === null || st.ended) return;
    const m = mission as IntelligenceMission | { targetEmpire?: Empire | null } | null;
    const target = m?.targetEmpire ?? null;
    if (empire === st.faction) {
        // An Exchange agent's sabotage succeeded unseen: the victim's investigators blame its enemy (false flag).
        const im = m as IntelligenceMission;
        if (target === null || im.outcome !== IntelligenceMissionOutcome.SucceedNotDetect || !isSabotage(im.type)) return;
        const blamed = falseFlagEnemy(galaxy, empire, target);
        if (blamed === null) return;
        st.sabotageLog.push({ date: galaxyStarDate(galaxy) });
        trimLog(st.sabotageLog);
        const where = im.targetHabitat?.name ?? im.targetCharacter?.name ?? target.name;
        const knows = knowledgeLevel(st.station, target) >= KNOWLEDGE_SUSPECTED;
        arcMessage(galaxy, st.sentStages, [target], {
            prefix: TAG,
            stage: knows ? 'Sabotage' : 'Sabotage Blame',
            onceKey: `Sabotage:${st.sabotageLog.length}`,
            args: [blamed.name, where],
            subject: im.targetHabitat ?? null,
        });
        return;
    }
    // Discovery: an agent's mission against a funded empire traces the money (level 2, confirmed after two).
    if (target === null || !fundedEmpireIds(galaxy, st.faction).has(target.empireId)) return;
    const n = (st.tracesByEmpire[empire.empireId] ?? 0) + 1;
    st.tracesByEmpire[empire.empireId] = n;
    const level = n >= 2 ? KNOWLEDGE_CONFIRMED : KNOWLEDGE_SUSPECTED;
    if (!reveal(galaxy, st, empire, level)) return;
    arcMessage(galaxy, st.sentStages, [empire], { prefix: TAG, stage: level >= KNOWLEDGE_CONFIRMED ? 'Funds Confirmed' : 'Funds Traced', onceKey: `Funds:${empire.empireId}:${level}`, subject: st.station.bo });
}

// ---------------------------------------------------------------------------------------------------------------
// Blockade / destruction → collapse
// ---------------------------------------------------------------------------------------------------------------

function activeBlockader(galaxy: Galaxy, st: ExchangeState): Empire | null {
    if (st.station === null) return null;
    const blockade = blockadeFor(galaxy, st.station.bo);
    if (blockade === null) return null;
    const by = blockade.initiator;
    if (by === null || knowledgeLevel(st.station, by) < KNOWLEDGE_CONFIRMED) return null;
    return by;
}

/**
 * The end: funding stops, NewsNet exposes it, every empire warms to the exposer, and the faction is torn down as a
 * defeated faction (events.ts empireCompleteTeardown: fleets dissolved, ships torn down); the purse is lost.
 */
export function collapse(galaxy: Galaxy, st: ExchangeState, exposer: Empire | null): void {
    if (st.ended) return;
    st.ended = true;
    st.purse = 0;
    st.reserve = 0;
    for (const e of galaxy.empires) {
        if (e === null || !e.active || e === exposer || e === st.faction) continue;
        if (exposer !== null) applyReputation(galaxy, e, exposer, 20, { cause: 'exchange.exposed', source: '19f', term: 'bias', decayPerYear: 0, legacy: 'factored' });
    }
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Collapsed' });
    const f = st.faction;
    if (f !== null && f.active) {
        const groups = empireShipGroups(f);
        for (const g of [...groups]) {
            if (g === null) continue;
            for (const b of g.ships) b.shipGroup = null;
            g.ships = [];
            g.leadShip = null;
        }
        groups.length = 0;
        st.fleets = [];
        f.stateMoney = 0;
        empireCompleteTeardown(galaxy, f, null);
    }
    if (threatsGameEndOn(galaxy)) threatGameEnd(galaxy, exposer, GameEndOutcome.Victory, scenarioText(`${TAG} Victory Title`), EXCHANGE_CODE_CONTAINED);
}

export function exchangeBlockadeCheck(galaxy: Galaxy): void {
    const st = peekExchangeState(galaxy);
    if (st === null || st.station === null || st.ended) return;
    const by = activeBlockader(galaxy, st);
    if (by === null) {
        st.blockadeDays = 0;
        return;
    }
    st.blockadeDays += PERIOD_DAYS;
    if (st.blockadeDays >= P.blockadeDaysNeeded(galaxy)) collapse(galaxy, st, by);
}

function onBuiltObjectRemoved(galaxy: Galaxy, bo: BuiltObject): void {
    const st = peekExchangeState(galaxy);
    if (st === null || st.station === null || st.station.bo !== bo || st.ended) return;
    collapse(galaxy, st, null);
}

// ---------------------------------------------------------------------------------------------------------------
// Council (19d8): a sanction motion against the Exchange once a member has it confirmed; never a member
// ---------------------------------------------------------------------------------------------------------------

function councilCandidates(galaxy: Galaxy, c: Council): MotionCandidate[] {
    const f = exchangeFaction(galaxy);
    const st = peekExchangeState(galaxy);
    if (f === null || st === null || st.station === null) return [];
    if (c.sanctions.some((s) => s.target === f && s.kind === 'sanction')) return [];
    const proposer = [...c.members].sort((a, b) => a.empireId - b.empireId).find((m) => knowledgeLevel(st.station!, m) >= KNOWLEDGE_CONFIRMED);
    if (proposer === undefined) return [];
    return [{ kind: 'sanction', proposer, target: f, other: proposer, resourceId: -1, weight: 70 }];
}

function councilVoteBias(galaxy: Galaxy, voter: Empire, m: { kind: string; target: Empire }): number {
    const f = exchangeFaction(galaxy);
    const st = peekExchangeState(galaxy);
    if (f === null || st === null || st.station === null || m.target !== f || m.kind !== 'sanction') return 0;
    return knowledgeLevel(st.station, voter) >= KNOWLEDGE_SUSPECTED ? 40 : 10;
}

// ---------------------------------------------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------------------------------------------

export function exchangeKnownSites(galaxy: Galaxy, empire: Empire): KnownThreatSite[] {
    const st = peekExchangeState(galaxy);
    if (st === null || st.station === null) return [];
    const level = knowledgeLevel(st.station, empire);
    if (level <= 0) return [];
    return [{ threat: EXCHANGE_KEY, kind: 'ship', target: st.station.bo, level, label: scenarioText(level >= KNOWLEDGE_CONFIRMED ? `${TAG} Confirmed Row` : `${TAG} Suspected Row`) }];
}

// ---------------------------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------------------------

export const EXCHANGE_HANDLER_IDS = ['exchange.start', 'exchange.yearly', 'exchange.periodic', 'exchange.intel', 'exchange.removed', 'exchange.tariff', 'exchange.killed'] as const;
export const EXCHANGE_QUERY_IDS = ['exchange.research', 'exchange.noWar', 'exchange.missions', 'exchange.defendClient', 'exchange.defendBid'] as const;

export function registerExchange(): void {
    registerScenarioGameStart({
        id: 'exchange.start',
        flag: EXCHANGE_FLAG,
        run: (g, ctx) => {
            exchangeState(g).startTechLevel = ctx.startTechLevel ?? 0.5;
        },
    });
    registerScenarioYearly({ id: 'exchange.yearly', flag: EXCHANGE_FLAG, order: 10, run: exchangeYearly });
    registerScenarioPeriodic({ id: 'exchange.periodic', flag: EXCHANGE_FLAG, periodDays: PERIOD_DAYS, order: 10, run: (g) => exchangePeriodic(g) });
    registerScenarioEvent({ id: 'exchange.intel', flag: EXCHANGE_FLAG, event: 'intelMissionCompleted', run: (g, e) => onIntelMissionCompleted(g, e.empire, e.mission) });
    registerScenarioEvent({ id: 'exchange.removed', flag: EXCHANGE_FLAG, event: 'builtObjectRemoved', run: (g, e) => onBuiltObjectRemoved(g, e.builtObject) });
    registerScenarioEvent({ id: 'exchange.killed', flag: EXCHANGE_FLAG, event: 'builtObjectKilledBy', run: (g, e) => onKilled(g, e.builtObject, e.destroyer) });
    registerScenarioQuery({
        id: 'exchange.defendBid',
        flag: EXCHANGE_FLAG,
        query: 'pirateDefendBidAllowed',
        run: (g, v, a) => {
            if (v) return v;
            const f = exchangeFaction(g);
            return f !== null && a.activity.requestingEmpire === f && a.activity.type === EmpireActivityType.Defend;
        },
    });
    registerScenarioEvent({ id: 'exchange.tariff', flag: EXCHANGE_FLAG, event: 'contractInitiated', run: (g, e) => onContract(g, e.sellingPoint, e.destination, e.value) });
    registerScenarioQuery({ id: 'exchange.research', flag: EXCHANGE_FLAG, query: 'researchAsPirateFaction', run: (g, v, a) => v || (a.empire === exchangeFaction(g) && a.empire !== null) });
    registerScenarioQuery({
        id: 'exchange.noWar',
        flag: EXCHANGE_FLAG,
        query: 'declareWarBlocked',
        run: (g, v, a) => {
            if (v) return v;
            const f = exchangeFaction(g);
            return f !== null && (a.empire === f || a.target === f);
        },
    });
    registerScenarioQuery({ id: 'exchange.missions', flag: EXCHANGE_FLAG, query: 'assignMissionAllowed', run: (g, v, a) => missionAllowed(g, v, a) });
    registerScenarioQuery({
        id: 'exchange.defendClient',
        flag: EXCHANGE_FLAG,
        query: 'pirateDefendClient',
        run: (g, v, a) => {
            const f = exchangeFaction(g);
            return f !== null && a.activity.requestingEmpire === f && a.activity.type === EmpireActivityType.Defend ? a.activity.targetEmpire : v;
        },
    });
    registerScenarioDecision({ id: EXCHANGE_BUY_INTEL_DECISION, kind: EXCHANGE_BUY_INTEL_DECISION, flag: EXCHANGE_FLAG, resolve: resolveBuyIntel, aiChoose: () => 'decline' });
    registerCouncilExtension({
        id: 'exchange',
        excluded: (g, e) => exchangeFaction(g) === e,
        candidates: (g, c) => councilCandidates(g, c),
        voteBias: (g, voter, m) => councilVoteBias(g, voter, m),
    });
    registerThreatKnownSites(EXCHANGE_KEY, exchangeKnownSites);
}

registerExchange();
