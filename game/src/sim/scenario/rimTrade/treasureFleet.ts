// Scenario package 19a addendum — the Concord's treasure fleet and stagnation (tasks/19-mod-layer-scenarios.md "19a
// addendum", tasks/M4-deferred-plan.md "19a follow-up"). Not a port: every stock call it makes is ported code.
//   Tech: the Concord starts at wizard tech level `rimTraderTechLevel` (createEmpireMidGame techLevel; Galaxy.7.cs
//     GenerateEmpire → ResearchSystem.SetTechTreeLevel) with the Ship Construction line (research.txt projects 105-112,
//     "ABILITIES ;Increased Construction Size, 2, <level>, <size>" = 230/300/400/500/650/800/1100/1500) researched up to
//     `rimTraderConstructionLevel`; research stops per industry once it holds a project of level `rimTraderResearchCap`
//     (the construction line excluded) — the researchFrozen query at Empire.3.cs PerformResearch.
//   Treasure fleet: Treasure Ships (designTemplates/oranthi/treasureship.txt through Empire.GenerateDesignFromSpec,
//     designGeneration.ts 776) plus the Concord's newest escorts, spawned the way Galaxy.8.cs 1474/1546
//     GenerateMilitaryConvoy / GenerateCivilianConvoy (Empire.1.cs 3899 CheckSendShipConvoysViaGateway) spawn a convoy
//     (GenerateNewBuiltObject + a Move mission), sailing one circuit of the nearest foreign space ports; at each stop it
//     buys rim goods and sells rare goods through the rim-trade ledger (the contract hooks of Empire.4.cs 1135
//     InitiateContract). Its ships carry a beacon: visible to every empire (objectVisibleToAll query at Empire.9.cs 3198
//     IsObjectVisibleToThisEmpire), like the original's galaxy-wide reveal (Galaxy.9.cs 1718 RevealObject).
//   Contact: at year `rimTraderContactYear` the Concord broadcasts to every empire it has not met (Galaxy.7.cs 3957
//     DoEmpireEncounter, as when a ship is sighted).
// Rnd: the periodic handler draws (GenerateDesignFromSpec's naming, GenerateNewBuiltObject's parking point / heading,
// DoEmpireEncounter's pre-warp messages); the query and event handlers never draw.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Design } from '../../design';
import type { Habitat } from '../../types';
import { BuiltObject } from '../../builtObject';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { leaveShipGroup } from '../../fleets/shipGroup';
import { Cargo, ResourceRef } from '../../cargo';
import { GAME_DAY_LENGTH, registerScenarioEvent, registerScenarioPeriodic, registerScenarioQuery, registerScenarioYearly, scenarioEmit } from '../hooks';
import { scenarioFlag, scenarioParam, scenarioState } from '../state';
import { scenarioMessage, scenarioNews, scenarioText } from '../messages';
import { noteVoiceCue, voicesOn } from '../llm/voiceCues';
import { registerScenarioMapFeatures, registerScenarioSelectionFeatures, type ScenarioMapFeatures, type ScenarioSelectionFeature, type ScenarioSelectionLike } from '../mapFeatures';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../../diplomacy';
import { EmpireMessageType } from '../../messages';
import { YEAR_LENGTH } from '../../galaxyTime';
import { galaxyStarDate } from '../../tick/simTime';
import { abilityTypeFromFile, nodeIndustry, ResearchAbilityType, type TechNode } from '../../researchSystem';
import { IndustryType } from '../../types';
import { loadDesignSpecification, type DesignSpecification } from '../../data/designSpecifications';
import { ComponentType } from '../../data/components';
import { componentDefinitionsStatic, createNewDesigns, generateDesignFromSpec } from '../../designGeneration';
import { CONCORD_RANGE_COMPONENTS, concordRangeTarget, designFuelRange, designParam } from './concordDesigns';
import { generateNewBuiltObject } from '../../empireEvents';
import { designsFindNewestCanBuild } from '../../forceStructure';
import { assignMission } from '../../missions/assign';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../../missions/mission';
import { galaxyResourceCurrentPrices } from '../../design';
import { cargoGetCargo, cargoRemove } from '../../logistics/orders';
import { contractListenersActive, emitContractInitiated } from '../../logistics/contractEvents';
import { doEmpireEncounter } from '../../exploration';
import { concordHooks, concordNavyActive, isRimTraderAI, rareGoodIds, rimAngerState, rimParam, rimGoodIds, rimTradeState, rimTraderAllowsRestrictedTrade, rimTraderEmpire, rimTraderPort, rimTraderStanding } from './common';
import { isHumanEmpire } from '../../humanEmpires';
import { identifyMechanoidEmpire } from '../../fleets/militaryAI';
import { convoyRecovering, straggleHeld, treasureStraggleAtDeparture } from './treasureRaids';

/** Manifest defaults (scenario.json) of the addendum's params. */
export const TREASURE_PARAM_DEFAULTS = {
    rimTraderTechLevel: 4,
    rimTraderConstructionLevel: 8,
    rimTraderResearchCap: 5,
    rimTraderContactYear: 1,
    treasureFleetSize: 6,
    treasureFleetPerColony: 1,
    treasureCircuitInterval: 360,
    treasureCircuitPorts: 14,
    treasureShipSize: 1500,
    treasureFleetTreasureShips: 8,
    treasureFleetCapitalShips: 3,
    treasureFleetCruisers: 5,
    treasureFleetCarriers: 1,
    treasureStragglePct: 4,
    treasureStraggleMinDays: 10,
    treasureStraggleMaxDays: 40,
    treasureRecoveryDays: 20,
    treasureTradeLot: 200,
    treasureRaidPenalty: 3000,
} as const;

export function treasureParam(galaxy: Galaxy, name: keyof typeof TREASURE_PARAM_DEFAULTS): number {
    return scenarioParam(galaxy, name, TREASURE_PARAM_DEFAULTS[name]);
}

/** A treasure ship docks when its lead ship is this close to the port (world units). */
export const TREASURE_DOCK_RANGE = 2000;
/** Marker / route colour (Oranthi gold). */
export const TREASURE_COLOR = 0xffd24a;

export interface TreasureFleetState {
    /** Star date the package started (contact broadcast timing). */
    startStarDate: number;
    contactDone: boolean;
    /** The Treasure Ship design (kept out of the Concord's design list so its AI never builds it as a freighter). */
    design: Design | null;
    /** The convoy: treasure ships first, then escorts. */
    ships: BuiltObject[];
    treasure: BuiltObject[];
    /** This voyage's ports, in order; the fleet then returns to the Concord port. */
    circuit: BuiltObject[];
    /** Index into circuit of the port sailed to; circuit.length = homeward (or the next stop is being chosen). */
    leg: number;
    /** The voyage is over: the fleet sails home (holds empty, no eligible port left, or the stop cap). */
    homeward?: boolean;
    /** Empires called at this voyage (one stop per empire). */
    visited?: number[];
    sailing: boolean;
    /** Star date of the last departure (-1: never sailed). */
    lastDeparture: number;
    /** Research cap reached in every industry (set yearly). */
    researchCapped: boolean;
    stats: { voyages: number; stops: number; rimUnits: number; rimValue: number; rareUnits: number; rareValue: number; lost: number };
    /** The player's stop requests (journaled command requestTreasureStop): one port per empire, served once. */
    requests?: { empireId: number; port: BuiltObject }[];
    /** The circuit's stops that came from a player request (the rest are the AI empires' requests). */
    requestedPorts?: BuiltObject[];
    /** Treasure ships out of formation (treasureRaids.ts). */
    stragglers?: TreasureStraggler[];
    /** Composition and voyage statistics (absent in older saves). */
    stats2?: TreasureStats2;
}

/** A treasure ship out of formation: held (loading / engine fault) or detouring (refuel) until `until`. */
export interface TreasureStraggler {
    ship: BuiltObject;
    cause: 'loading' | 'engine' | 'refuel';
    /** Star date it fell out. */
    since: number;
    /** Star date its hold ends (it then sails after the convoy). */
    until: number;
    /** The escorts turned back for it. */
    recovering: boolean;
    /** 'engine': the star date the fault strikes (it sails with the convoy until then, then stops dead until `until`). */
    faultAt?: number;
    /** The hold (a Hold mission until `until`) has been given. */
    stopped?: boolean;
    /** Star date it was first more than STRAGGLER_EXPOSED_RANGE from every escort (-1: not exposed yet). */
    exposedSince: number;
}

export interface TreasureStats2 {
    escortsFromNavy: number;
    escortsSpawned: number;
    stopsPlayer: number;
    stopsAi: number;
    tradesPlayer: number;
    tradesAi: number;
    returnedEmpty: number;
    stopsPerVoyage: number[];
    straggles: number;
    straggleDays: number;
    exposedDays: number;
    lootValue: number;
    lootEvents: number;
    /** Per voyage: rare units loaded at departure and left in the holds on the return home (absent in older saves). */
    rareLoaded?: number[];
    rareLeft?: number[];
}

export function treasureStats2(st: TreasureFleetState): TreasureStats2 {
    return (st.stats2 ??= { escortsFromNavy: 0, escortsSpawned: 0, stopsPlayer: 0, stopsAi: 0, tradesPlayer: 0, tradesAi: 0, returnedEmpty: 0, stopsPerVoyage: [], straggles: 0, straggleDays: 0, exposedDays: 0, lootValue: 0, lootEvents: 0 });
}

export function treasureState(galaxy: Galaxy): TreasureFleetState {
    return scenarioState<TreasureFleetState>(galaxy, 'rimTreasure', () => ({
        startStarDate: galaxyStarDate(galaxy),
        contactDone: false,
        design: null,
        ships: [],
        treasure: [],
        circuit: [],
        leg: 0,
        sailing: false,
        lastDeparture: -1,
        researchCapped: false,
        stats: { voyages: 0, stops: 0, rimUnits: 0, rimValue: 0, rareUnits: 0, rareValue: 0, lost: 0 },
    }));
}

function hasTreasureState(galaxy: Galaxy): boolean {
    return galaxy.scenario !== null && 'rimTreasure' in galaxy.scenario.state;
}

// ---------------------------------------------------------------------------------------------------------------
// Tech (creation) and the research cap
// ---------------------------------------------------------------------------------------------------------------

/** research.txt ABILITIES type 2 (Increased Construction Size): the Ship Construction line. */
export function isConstructionSizeNode(n: TechNode): boolean {
    return n.def.abilities.some((a) => abilityTypeFromFile(a.type) === ResearchAbilityType.ConstructionSize);
}

/** The highest Ship Construction level `empire` has researched (research.txt ability level; 0 = none). */
export function constructionLevel(empire: Empire): number {
    let lvl = 0;
    for (const n of empire.research.techTree) {
        if (!n.isResearched) continue;
        for (const a of n.def.abilities) if (abilityTypeFromFile(a.type) === ResearchAbilityType.ConstructionSize) lvl = Math.max(lvl, a.level);
    }
    return lvl;
}

/** Highest tech level researched in `industry`, the construction line excluded (ResearchNodeList 691 GetHighestResearchedProjectForIndustry). */
export function highestResearchedLevel(empire: Empire, industry: IndustryType): number {
    let lvl = 0;
    for (const n of empire.research.techTree) if (n.isResearched && nodeIndustry(n) === industry && !isConstructionSizeNode(n)) lvl = Math.max(lvl, n.def.techLevel);
    return lvl;
}

/**
 * Creation tech (step 1): tech level `techLevel` (SetTechTreeLevel, as GenerateEmpire does; `apply` false when the
 * empire was just generated with it) and the Ship Construction line up to `rimTraderConstructionLevel` with its parents.
 */
export function applyConcordTech(galaxy: Galaxy, r: Empire, setLevel: boolean): void {
    const race = r.dominantRace;
    const techLevel = treasureParam(galaxy, 'rimTraderTechLevel');
    if (setLevel && techLevel !== 0.5) r.research.setTechTreeLevel(galaxy.rnd, race, techLevel, false);
    const target = Math.trunc(treasureParam(galaxy, 'rimTraderConstructionLevel'));
    const mark = (n: TechNode): void => {
        if (n.isResearched) return;
        n.isResearched = true;
        n.selfResearched = true;
        n.progress = n.cost;
        for (const p of n.parentNodes ?? []) mark(p);
    };
    for (const n of r.research.techTree) {
        if (n.def.abilities.some((a) => abilityTypeFromFile(a.type) === ResearchAbilityType.ConstructionSize && a.level <= target)) mark(n);
    }
    // concordDesigns.ts: the most efficient drive / reactor and the densest fuel cell, with their projects' parents.
    if (designParam(galaxy, 'rimTraderDesignRangeSectors') > 0) {
        const ids = new Set(CONCORD_RANGE_COMPONENTS.map((name) => componentDefinitionsStatic(galaxy).find((c) => c.name === name)?.componentId ?? -1).filter((id) => id >= 0));
        for (const n of r.research.techTree) if (n.def.components.some((id) => ids.has(id))) mark(n);
    }
    const rs = r.research;
    rs.researchQueueWeapons = rs.researchQueueWeapons.filter((n) => !n.isResearched);
    rs.researchQueueEnergy = rs.researchQueueEnergy.filter((n) => !n.isResearched);
    rs.researchQueueHighTech = rs.researchQueueHighTech.filter((n) => !n.isResearched);
    rs.update(race);
    r.reviewResearchAbilities();
    r.reviewDesignsBuiltObjectsImprovedComponents();
    // concordDesigns.ts: the Concord's warship designs regenerated now (huge, long-ranged; the stock review then keeps
    // them up to date). Draws the design naming Rnd.
    if (designParam(galaxy, 'rimTraderDesignRangeSectors') > 0 && isRimTraderAI(galaxy, r)) {
        const now = galaxyStarDate(galaxy);
        createNewDesigns(galaxy, r, now, now, true);
    }
}

/** researchFrozen query: the Concord AI stops researching an industry at the cap (construction line excluded). Pure. */
export function concordResearchFrozen(galaxy: Galaxy, value: boolean, args: { empire: Empire; industry: number }): boolean {
    if (value || !isRimTraderAI(galaxy, args.empire)) return value;
    const cap0 = treasureParam(galaxy, 'rimTraderResearchCap');
    const cap = concordHooks().researchCap?.(galaxy, cap0) ?? cap0;
    if (!(cap > 0)) return value;
    return highestResearchedLevel(args.empire, args.industry as IndustryType) >= cap;
}

function yearlyCapCheck(galaxy: Galaxy): void {
    const r = rimTraderEmpire(galaxy);
    if (r === null || !isRimTraderAI(galaxy, r)) return;
    const st = treasureState(galaxy);
    const cap0 = treasureParam(galaxy, 'rimTraderResearchCap');
    const cap = concordHooks().researchCap?.(galaxy, cap0) ?? cap0;
    st.researchCapped = cap > 0 && [IndustryType.Weapon, IndustryType.Energy, IndustryType.HighTech].every((i) => highestResearchedLevel(r, i) >= cap);
}

// ---------------------------------------------------------------------------------------------------------------
// Treasure Ship design
// ---------------------------------------------------------------------------------------------------------------

function cargoRuleIndex(spec: DesignSpecification): number {
    return spec.componentRules.findIndex((c) => c.componentType === ComponentType.StorageCargo);
}

/**
 * The Treasure Ship: the scenario template (LargeFreighter hull) through GenerateDesignFromSpec, its cargo bays scaled
 * so the design reaches `treasureShipSize` (≤ the Concord's civilian construction size) and, with
 * rimTraderDesignRangeSectors > 0, fuel cells added until its range reaches that many sectors (concordDesigns.ts; the
 * cargo makes room for them). Draws Rnd (design naming).
 */
export function generateTreasureShipDesign(galaxy: Galaxy, r: Empire): Design | null {
    const loaded = loadDesignSpecification(galaxy.designSpecificationTexts, 'TreasureShip', BuiltObjectSubRole.LargeFreighter, true, 'Oranthi', false, true);
    const base = loaded ?? loadDesignSpecification(galaxy.designSpecificationTexts, 'LargeFreighter', BuiltObjectSubRole.LargeFreighter, true, null, false, false);
    if (base === null) return null;
    const spec: DesignSpecification = { ...base, componentRules: base.componentRules.map((c) => ({ ...c })) };
    const target = Math.min(treasureParam(galaxy, 'treasureShipSize'), r.maximumConstructionSize(BuiltObjectSubRole.LargeFreighter));
    const rangeTarget = designParam(galaxy, 'rimTraderDesignRangeSectors') > 0 ? concordRangeTarget(galaxy) : 0;
    const ci = cargoRuleIndex(spec);
    const fi = spec.componentRules.findIndex((c) => c.componentType === ComponentType.StorageFuel);
    const now = galaxyStarDate(galaxy);
    let design: Design | null = null;
    for (let pass = 0; pass < 8; pass++) {
        try {
            design = generateDesignFromSpec(galaxy, r, spec, 0.0, now);
        } catch {
            return null;
        }
        if (design === null || ci < 0) break;
        const bays = design.components.filter((c) => c.type === ComponentType.StorageCargo);
        const baySize = bays.length > 0 ? bays[0].size : 0;
        if (baySize <= 0) break;
        // Fuel cells for the range (range is about linear in the fuel carried).
        let addCells = 0;
        const range = designFuelRange(design);
        const cells = design.components.filter((c) => c.type === ComponentType.StorageFuel);
        if (rangeTarget > 0 && fi >= 0 && range > 0 && range < rangeTarget && cells.length > 0) addCells = Math.max(1, Math.ceil(cells.length * (rangeTarget / range) * 1.05) - cells.length);
        const cellSize = cells.length > 0 ? cells[0].size : 0;
        const delta = Math.trunc((target - design.size - addCells * cellSize) / baySize);
        const sizeDone = delta === 0 || (delta > 0 && design.size >= target - baySize);
        if (sizeDone && addCells === 0) break;
        if (addCells > 0) spec.componentRules[fi].amount += addCells;
        spec.componentRules[ci].amount = Math.max(1, spec.componentRules[ci].amount + delta);
    }
    if (design !== null) design.name = scenarioText('Scenario RimTrade Treasure Ship');
    return design;
}

// ---------------------------------------------------------------------------------------------------------------
// The convoy
// ---------------------------------------------------------------------------------------------------------------

function alive(r: Empire, b: BuiltObject): boolean {
    return !b.hasBeenDestroyed && b.actualEmpire === r;
}

function isNormalEmpire(galaxy: Galaxy, e: Empire | null, r: Empire): e is Empire {
    return e !== null && e !== r && e.active && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null;
}

/** Rim goods (units) `owner` holds at `port`. Pure. */
export function portRimUnits(galaxy: Galaxy, port: BuiltObject, owner: Empire): number {
    if (port.cargo === null) return 0;
    let n = 0;
    for (const id of rimGoodIds(galaxy)) n += cargoGetCargo(port.cargo, id, owner)?.amount ?? 0;
    return n;
}

/** Hazards this close to a port (world units: two systems' reach) keep the treasure fleet away from it. */
export const TREASURE_HAZARD_RANGE_SYSTEMS = 2;

/**
 * A port the treasure fleet avoids: the stock Ancient Guardians (the Mechanoid empire, militaryAI.ts
 * identifyMechanoidEmpire) hold a colony or base within TREASURE_HAZARD_RANGE_SYSTEMS systems of it, or a hostile space
 * creature (not benign, with an attack) is that close. Pure.
 */
export function treasurePortHazard(galaxy: Galaxy, port: BuiltObject): boolean {
    const range = galaxy.maxSolarSystemSize * TREASURE_HAZARD_RANGE_SYSTEMS;
    const near = (x: number, y: number): boolean => galaxy.calculateDistance(x, y, port.xpos, port.ypos) <= range;
    const g = identifyMechanoidEmpire(galaxy);
    if (g !== null && g.active) {
        if (port.actualEmpire === g) return true;
        for (const c of g.colonies) if (c !== null && !c.hasBeenDestroyed && near(c.xpos, c.ypos)) return true;
        for (const b of g.builtObjects) if (b !== null && !b.hasBeenDestroyed && b.topSpeed <= 0 && near(b.xpos, b.ypos)) return true;
    }
    for (const c of galaxy.creatures) if (c !== null && !c.hasBeenDestroyed && !c.isBenign && c.attackStrength > 0 && near(c.xpos, c.ypos)) return true;
    return false;
}

/** One empire's stop request: its port, the rim goods there, the request's weight and whether the player made it. */
export interface TreasureStopRequest {
    empire: Empire;
    port: BuiltObject;
    rimUnits: number;
    weight: number;
    player: boolean;
}

/**
 * The stop requests for the next voyage, one per met, non-hostile normal empire (War / TradeSanctions / NotMet left
 * out): an AI empire requests its space port holding the most rim goods (ties: nearest the Concord port, then id); a
 * human empire only the port it asked for (journaled command requestTreasureStop). Ports near the Ancient Guardians or
 * hostile space creatures are left out (treasurePortHazard). Weight = (rim goods + 1) × the
 * standing factor max(0.25, 1 + standing / rimTraderGrantThreshold). Pure.
 */
export function treasureStopRequests(galaxy: Galaxy, r: Empire, from: { xpos: number; ypos: number }): TreasureStopRequest[] {
    const st = treasureState(galaxy);
    const threshold = Math.max(1, rimParam(galaxy, 'rimTraderGrantThreshold'));
    const d = (a: { xpos: number; ypos: number }): number => (a.xpos - from.xpos) ** 2 + (a.ypos - from.ypos) ** 2;
    const out: TreasureStopRequest[] = [];
    for (const e of galaxy.empires) {
        if (!isNormalEmpire(galaxy, e, r)) continue;
        const t = obtainDiplomaticRelation(r, e).type;
        if (t === DiplomaticRelationType.NotMet || t === DiplomaticRelationType.War || t === DiplomaticRelationType.TradeSanctions) continue;
        let port: BuiltObject | null = null;
        let units = 0;
        const human = isHumanEmpire(galaxy, e);
        if (human) {
            const req = (st.requests ?? []).find((q) => q.empireId === e.empireId);
            if (req === undefined || req.port.hasBeenDestroyed || req.port.actualEmpire !== e || !req.port.isSpacePort || treasurePortHazard(galaxy, req.port)) continue;
            port = req.port;
            units = portRimUnits(galaxy, port, e);
        } else {
            for (const p of e.spacePorts) {
                if (p.hasBeenDestroyed || !p.isSpacePort || treasurePortHazard(galaxy, p)) continue;
                const u = portRimUnits(galaxy, p, e);
                if (port === null || u > units || (u === units && (d(p) < d(port) || (d(p) === d(port) && p.builtObjectID < port.builtObjectID)))) {
                    port = p;
                    units = u;
                }
            }
        }
        if (port === null) continue;
        const factor = Math.max(0.25, 1 + rimTraderStanding(galaxy, e.empireId) / threshold);
        out.push({ empire: e, port, rimUnits: units, weight: (units + 1) * factor, player: human });
    }
    out.sort((a, b) => b.weight - a.weight || d(a.port) - d(b.port) || a.port.builtObjectID - b.port.builtObjectID);
    return out;
}

/**
 * The voyage's next stop (2026-10-11: the fleet adds stops until its holds are empty): the heaviest remaining stop
 * request (treasureStopRequests from `from`: one port per empire, hazard-screened, (rim goods + 1) × standing factor)
 * of an empire not yet called at this voyage, whose port the treasure ships can reach from `from` and get home from on
 * one tank (designFuelRange; they refuel at every stop). Null: none left. Pure.
 */
export function nextTreasureStop(galaxy: Galaxy, r: Empire, st: TreasureFleetState, from: { xpos: number; ypos: number }, home: { xpos: number; ypos: number }): BuiltObject | null {
    const visited = st.visited ?? [];
    const range = st.design !== null ? designFuelRange(st.design) : Infinity;
    const r2 = range * range;
    const d = (a: { xpos: number; ypos: number }, b: { xpos: number; ypos: number }): number => (a.xpos - b.xpos) ** 2 + (a.ypos - b.ypos) ** 2;
    for (const q of treasureStopRequests(galaxy, r, from)) {
        if (visited.includes(q.empire.empireId)) continue;
        if (d(q.port, from) > r2 || d(q.port, home) > r2) continue;
        return q.port;
    }
    return null;
}

/** Adds `port` to the voyage (visited; a player's request is served). */
function addStop(st: TreasureFleetState, port: BuiltObject): void {
    st.circuit.push(port);
    if (port.actualEmpire !== null) (st.visited ??= []).push(port.actualEmpire.empireId);
    if ((st.requests ?? []).some((q) => q.port === port)) {
        (st.requestedPorts ??= []).push(port);
        st.requests = st.requests!.filter((q) => q.port !== port);
    }
}

/** The fleet is at `from` with no stop ahead: the next stop, or home (holds empty, none eligible, or the stop cap). */
function extendOrHome(galaxy: Galaxy, r: Empire, st: TreasureFleetState, from: { xpos: number; ypos: number }, home: { xpos: number; ypos: number }): void {
    if (st.homeward === true || st.leg < st.circuit.length) return;
    if (!treasureHoldsRare(galaxy, r, st)) {
        if (st.circuit.length > 0) treasureStats2(st).returnedEmpty++;
    } else if (st.circuit.length < Math.max(1, Math.trunc(treasureParam(galaxy, 'treasureCircuitPorts')))) {
        const next = nextTreasureStop(galaxy, r, st, from, home);
        if (next !== null) {
            addStop(st, next);
            return;
        }
    }
    st.homeward = true;
}

/**
 * Journaled player command requestTreasureStop: the player asks the treasure fleet to call at its space port `port` on
 * a coming voyage (one request per empire: a new one replaces the old). False when the port is not the empire's own
 * space port or there is no Concord fleet. No Rnd.
 */
export function requestTreasureStop(galaxy: Galaxy, empire: Empire, port: BuiltObject | null): boolean {
    const r = rimTraderEmpire(galaxy);
    if (r === null || empire === r || port === null || port.hasBeenDestroyed || port.actualEmpire !== empire || !port.isSpacePort) return false;
    const st = treasureState(galaxy);
    const list = (st.requests ??= []).filter((q) => q.empireId !== empire.empireId);
    list.push({ empireId: empire.empireId, port });
    st.requests = list;
    return true;
}

/** Spawns one convoy ship at the port, as GenerateMilitaryConvoy does (GenerateNewBuiltObject + state ownership). */
function spawnShip(galaxy: Galaxy, r: Empire, design: Design, port: BuiltObject | Habitat): BuiltObject {
    const p = galaxy.selectRelativeParkingPoint();
    const bo = generateNewBuiltObject(galaxy, r, design, null, port.xpos + p.x, port.ypos + p.y);
    // A state convoy: freighter hulls are private by default (Empire.cs 4341 isState); the treasure fleet is the state's.
    const i = r.privateBuiltObjects.indexOf(bo);
    if (i >= 0) r.privateBuiltObjects.splice(i, 1);
    if (!r.builtObjects.includes(bo)) r.builtObjects.push(bo);
    bo.owner = r;
    bo.isAutoControlled = false;
    bo.supportCostFactor = Math.fround(0.2);
    return bo;
}

function escortDesign(r: Empire): Design | null {
    for (const sub of [BuiltObjectSubRole.Cruiser, BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.Frigate, BuiltObjectSubRole.Escort]) {
        const d = designsFindNewestCanBuild(r.designs, sub);
        if (d !== null) return d;
    }
    return null;
}

/** Most ships a treasure fleet may have. */
export const TREASURE_FLEET_MAX = 20;

/**
 * The convoy's target size: treasureFleetSize (the base; ≤ 0 = no fleet) + treasureFleetPerColony × (Concord colonies
 * − 1), at most TREASURE_FLEET_MAX. Pure.
 */
export function treasureFleetTargetSize(galaxy: Galaxy, r: Empire): number {
    const base = Math.trunc(treasureParam(galaxy, 'treasureFleetSize'));
    if (base <= 0) return 0;
    const per = treasureParam(galaxy, 'treasureFleetPerColony');
    return Math.min(TREASURE_FLEET_MAX, Math.trunc(base + per * Math.max(0, r.colonies.length - 1)));
}

/**
 * The fixed composition (treasureFleetTreasureShips > 0): treasure ships and escorts by sub-role (default 8 treasure
 * ships, 3 capital ships, 5 cruisers, 1 carrier). Null: the older scaled fleet (treasureFleetTargetSize). Pure.
 */
export function treasureComposition(galaxy: Galaxy): { treasure: number; escorts: { subRole: BuiltObjectSubRole; n: number }[] } | null {
    const t = Math.trunc(treasureParam(galaxy, 'treasureFleetTreasureShips'));
    if (t <= 0) return null;
    return {
        treasure: t,
        escorts: [
            { subRole: BuiltObjectSubRole.CapitalShip, n: Math.trunc(treasureParam(galaxy, 'treasureFleetCapitalShips')) },
            { subRole: BuiltObjectSubRole.Cruiser, n: Math.trunc(treasureParam(galaxy, 'treasureFleetCruisers')) },
            { subRole: BuiltObjectSubRole.Carrier, n: Math.trunc(treasureParam(galaxy, 'treasureFleetCarriers')) },
        ].filter((x) => x.n > 0),
    };
}

/**
 * Fills the convoy: with the fixed composition, the treasure ships, then per escort sub-role the Concord's own warships
 * of that sub-role the home guard can spare (navy params on), then dedicated ships of its newest design of that
 * sub-role, bought (the first voyage's are free: the Concord's inheritance); without it, the older scaled fleet
 * (⌈size / 3⌉ treasure ships, the rest escorts).
 */
function musterFleet(galaxy: Galaxy, r: Empire, port: BuiltObject | Habitat, st: TreasureFleetState): void {
    const comp = treasureComposition(galaxy);
    const size = comp === null ? treasureFleetTargetSize(galaxy, r) : comp.treasure + comp.escorts.reduce((n, x) => n + x.n, 0);
    const wantTreasure = comp === null ? Math.ceil(size / 3) : comp.treasure;
    st.design ??= generateTreasureShipDesign(galaxy, r);
    const free = st.stats.voyages === 0; // the first fleet is the Concord's inheritance
    const s2 = treasureStats2(st);
    const buy = (d: Design): boolean => {
        if (free) return true;
        const price = d.calculateCurrentPurchasePrice(galaxy);
        if (r.stateMoney < price) return false;
        r.stateMoney -= price;
        return true;
    };
    while (st.design !== null && st.treasure.length < wantTreasure && buy(st.design)) {
        const bo = spawnShip(galaxy, r, st.design, port);
        st.treasure.push(bo);
        st.ships.splice(st.treasure.length - 1, 0, bo);
    }
    // With the navy params on (wealth.ts), escorts come from the Concord's navy first — warships the home guard can
    // spare (rimTraderHomeGuardPct), nearest the port first, out of their fleets and out of AI control — then are bought.
    const takeFromNavy = (want: (b: BuiltObject) => boolean, room: () => boolean): void => {
        if (!concordNavyActive(galaxy)) return;
        const strikeShips = new Set((galaxy.scenario !== null && 'rimAnger' in galaxy.scenario.state ? (rimAngerState(galaxy).strikes ?? []) : []).flatMap((f) => f.ships));
        const navy = r.builtObjects.filter((b) => b !== null && !b.hasBeenDestroyed && b.role === BuiltObjectRole.Military && !st.ships.includes(b));
        const guard = Math.min(100, Math.max(0, rimParam(galaxy, 'rimTraderHomeGuardPct')));
        const escorts = st.ships.length - st.treasure.length;
        let spare = Math.floor(((navy.length + escorts) * (100 - guard)) / 100) - strikeShips.size - escorts;
        const pool = navy
            .filter((b) => b.isAutoControlled && b.builtAt === null && b.firepowerRaw > 0 && b.warpSpeed > 0 && b.subRole !== BuiltObjectSubRole.TroopTransport && b.subRole !== BuiltObjectSubRole.ResupplyShip && !strikeShips.has(b) && want(b))
            .sort((a, b) => galaxy.calculateDistance(a.xpos, a.ypos, port.xpos, port.ypos) - galaxy.calculateDistance(b.xpos, b.ypos, port.xpos, port.ypos) || a.builtObjectID - b.builtObjectID);
        for (const b of pool) {
            if (!room() || spare <= 0) break;
            if (b.shipGroup !== null) leaveShipGroup(galaxy, b);
            b.isAutoControlled = false;
            st.ships.push(b);
            s2.escortsFromNavy++;
            spare--;
        }
    };
    if (comp === null) {
        takeFromNavy(() => true, () => st.ships.length < size);
        const esc = escortDesign(r);
        while (esc !== null && st.ships.length < size && buy(esc)) {
            st.ships.push(spawnShip(galaxy, r, esc, port));
            s2.escortsSpawned++;
        }
        return;
    }
    for (const { subRole, n } of comp.escorts) {
        const count = (): number => st.ships.filter((b) => !st.treasure.includes(b) && b.subRole === subRole).length;
        takeFromNavy((b) => b.subRole === subRole, () => count() < n);
        const d = designsFindNewestCanBuild(r.designs, subRole) ?? escortDesign(r);
        while (d !== null && count() < n && buy(d)) {
            const bo = spawnShip(galaxy, r, d, port);
            st.ships.push(bo);
            s2.escortsSpawned++;
            if (bo.subRole !== subRole) break; // a stand-in design: one only
        }
    }
}

function prune(r: Empire, st: TreasureFleetState): void {
    st.ships = st.ships.filter((b) => alive(r, b));
    st.treasure = st.treasure.filter((b) => alive(r, b));
}

function sailTo(galaxy: Galaxy, st: TreasureFleetState, target: BuiltObject | Habitat): void {
    for (const b of st.ships) {
        if (straggleHeld(galaxy, st, b)) continue; // out of formation (treasureRaids.ts)
        const m = builtObjectMission(b.mission);
        if (m !== null && m.type === BuiltObjectMissionType.Move && m.target === target) continue;
        assignMission(galaxy, b, BuiltObjectMissionType.Move, target, null, BuiltObjectMissionPriority.High);
    }
}

function refuel(st: TreasureFleetState): void {
    for (const b of st.ships) b.currentFuel = b.fuelCapacity;
}

/** Emits one treasure-fleet trade to the contract listeners (freight overlay) and the scenario ledger. No Rnd. */
function emitTrade(galaxy: Galaxy, seller: Empire, buyer: Empire, sellingPoint: BuiltObject | Habitat, destination: BuiltObject | Habitat, resourceId: number, amount: number, value: number, freighter: BuiltObject): void {
    if (contractListenersActive()) emitContractInitiated(galaxy, { starDate: galaxyStarDate(galaxy), seller, sellingPoint, buyer, destination, resourceId, componentId: -1, amount, value, isState: true, freighter });
    scenarioEmit(galaxy, 'contractInitiated', { seller, buyer, sellingPoint, destination, resourceId, componentId: -1, amount, value, isState: true, freighter });
}

/** A stop at a foreign port: buy its rim goods, then sell rare goods up to the host's standing. No Rnd. */
export function treasureTradeAt(galaxy: Galaxy, r: Empire, st: TreasureFleetState, port: BuiltObject): void {
    const host = port.actualEmpire;
    const lead = st.treasure[0] ?? null;
    const home = rimTraderPort(galaxy);
    if (host === null || lead === null || lead.cargo === null || port.cargo === null || home === null) return;
    const prices = galaxyResourceCurrentPrices(galaxy);
    const lot = Math.trunc(treasureParam(galaxy, 'treasureTradeLot')) * st.treasure.length;
    // Buy rim goods (credit).
    for (const id of rimGoodIds(galaxy)) {
        const c = cargoGetCargo(port.cargo, id, host);
        const price = prices[id] ?? 0;
        if (c === null || price <= 0) continue;
        const qty = Math.min(c.available, lot, Math.floor(Math.max(0, r.stateMoney) / price));
        if (qty <= 0) continue;
        const value = qty * price;
        if (c.amount - qty <= 0) cargoRemove(port.cargo, c);
        else c.amount -= qty;
        lead.cargo.add(new Cargo(new ResourceRef(id), qty, r));
        r.stateMoney -= value;
        host.stateMoney += value;
        emitTrade(galaxy, host, r, port, home, id, qty, value, lead);
        st.stats.rimUnits += qty;
        st.stats.rimValue += value;
    }
    // Sell rare goods (debit), only to a host the Concord trades with, never below zero standing.
    const rel = obtainDiplomaticRelation(r, host);
    if (!rel.supplyRestrictedResources && !rimTraderAllowsRestrictedTrade(galaxy, r, host)) return;
    // rimTraderRarePriceMult: the Concord's rare goods sell at the factor over the galaxy price.
    const rareMult = rimParam(galaxy, 'rimTraderRarePriceMult');
    for (const id of rareGoodIds(galaxy)) {
        const price = (prices[id] ?? 0) * rareMult;
        const budget = Math.min(rimTraderStanding(galaxy, host.empireId), Math.max(0, host.stateMoney) * 0.5);
        if (price <= 0 || budget <= 0) continue;
        let qty = Math.min(lot, Math.floor(budget / price));
        for (const ship of st.treasure) {
            if (qty <= 0 || ship.cargo === null) continue;
            const c = cargoGetCargo(ship.cargo, id, r);
            if (c === null) continue;
            const take = Math.min(c.amount, qty);
            if (take <= 0) continue;
            const value = take * price;
            if (c.amount - take <= 0) cargoRemove(ship.cargo, c);
            else c.amount -= take;
            port.cargo.add(new Cargo(new ResourceRef(id), take, host));
            host.stateMoney -= value;
            r.stateMoney += value;
            emitTrade(galaxy, r, host, home, port, id, take, value, ship);
            st.stats.rareUnits += take;
            st.stats.rareValue += value;
            qty -= take;
        }
    }
}

/** Loads rare goods from the Concord port into the treasure ships (up to each ship's cargo capacity, shared evenly). */
function loadRareGoods(galaxy: Galaxy, r: Empire, st: TreasureFleetState, port: BuiltObject | Habitat): void {
    if (port.cargo === null) return;
    const ids = rareGoodIds(galaxy);
    for (const ship of st.treasure) {
        if (ship.cargo === null) continue;
        const share = Math.floor(ship.cargoCapacity / Math.max(1, ids.length));
        for (const id of ids) {
            const c = cargoGetCargo(port.cargo, id, r);
            const qty = Math.min(c?.available ?? 0, Math.floor(share / Math.max(1, st.treasure.length)) || share);
            if (c === null || qty <= 0) continue;
            if (c.amount - qty <= 0) cargoRemove(port.cargo, c);
            else c.amount -= qty;
            ship.cargo.add(new Cargo(new ResourceRef(id), qty, r));
        }
    }
}

/** Home: everything in the holds goes into the port's hold. */
function unload(r: Empire, st: TreasureFleetState, port: BuiltObject | Habitat): void {
    if (port.cargo === null) return;
    for (const ship of st.ships) {
        if (ship.cargo === null) continue;
        for (const c of [...ship.cargo.items]) {
            if (c.empire !== r || c.commodityComponent !== null || c.commodity.resourceId < 0) continue;
            port.cargo.add(new Cargo(new ResourceRef(c.commodity.resourceId), c.amount, r));
            cargoRemove(ship.cargo, c);
        }
    }
}

function lead(st: TreasureFleetState): BuiltObject | null {
    // The first treasure ship in formation (a straggler never leads the convoy).
    const strag = st.stragglers ?? [];
    return st.treasure.find((b) => !strag.some((x) => x.ship === b)) ?? st.treasure[0] ?? st.ships[0] ?? null;
}

/** Rare units in the treasure ships' holds. Pure. */
export function treasureRareUnits(galaxy: Galaxy, r: Empire, st: TreasureFleetState): number {
    const ids = rareGoodIds(galaxy);
    let n = 0;
    for (const b of st.treasure) if (!b.hasBeenDestroyed && b.cargo !== null) for (const id of ids) n += cargoGetCargo(b.cargo, id, r)?.amount ?? 0;
    return n;
}

/** Any treasure ship (in formation) still holds rare goods. Pure. */
export function treasureHoldsRare(galaxy: Galaxy, r: Empire, st: TreasureFleetState): boolean {
    const ids = rareGoodIds(galaxy);
    return st.treasure.some((b) => !b.hasBeenDestroyed && b.cargo !== null && ids.some((id) => (cargoGetCargo(b.cargo!, id, r)?.amount ?? 0) > 0));
}

function portLabel(galaxy: Galaxy, p: BuiltObject | Habitat): string {
    const star = p instanceof BuiltObject ? p.nearestSystemStar : galaxy.determineHabitatSystemStar(p);
    return star !== null ? `${p.name} (${star.name})` : p.name;
}

function depart(galaxy: Galaxy, r: Empire, st: TreasureFleetState, home: BuiltObject | Habitat, now: number): void {
    st.visited = [];
    const first = nextTreasureStop(galaxy, r, st, home, home);
    if (first === null) return;
    musterFleet(galaxy, r, home, st);
    if (st.treasure.length === 0) return;
    loadRareGoods(galaxy, r, st, home);
    (treasureStats2(st).rareLoaded ??= []).push(treasureRareUnits(galaxy, r, st));
    refuel(st);
    st.circuit = [];
    st.requestedPorts = [];
    addStop(st, first);
    st.leg = 0;
    st.homeward = false;
    st.sailing = true;
    st.lastDeparture = now;
    st.stats.voyages++;
    treasureStats2(st).stopsPerVoyage.push(0);
    treasureStraggleAtDeparture(galaxy, r, st);
    sailTo(galaxy, st, first);
    const route = portLabel(galaxy, first);
    scenarioNews(galaxy, r, scenarioText('Scenario RimTrade Treasure Departs', r.name, portLabel(galaxy, home), route), undefined, lead(st));
}

function arrive(galaxy: Galaxy, r: Empire, st: TreasureFleetState, port: BuiltObject): void {
    const s2 = treasureStats2(st);
    const before = st.stats.rimUnits + st.stats.rareUnits;
    treasureTradeAt(galaxy, r, st, port);
    refuel(st);
    st.stats.stops++;
    const player = (st.requestedPorts ?? []).includes(port);
    if (player) s2.stopsPlayer++;
    else s2.stopsAi++;
    const traded = st.stats.rimUnits + st.stats.rareUnits - before;
    if (traded > 0) {
        if (player) s2.tradesPlayer += traded;
        else s2.tradesAi += traded;
    }
    if (s2.stopsPerVoyage.length > 0) s2.stopsPerVoyage[s2.stopsPerVoyage.length - 1]++;
    const host = port.actualEmpire;
    if (host !== null) {
        const m = scenarioMessage(galaxy, host, scenarioText('Scenario RimTrade Treasure Title'), scenarioText('Scenario RimTrade Treasure Docks Host', r.name, portLabel(galaxy, port)), { type: EmpireMessageType.GeneralGoodEvent, sender: r, subject: lead(st) });
        // 19s-2 voices (flag llmVoices; inert otherwise, no state): the mask-ritual greeting as the treasure fleet docks.
        if (isHumanEmpire(galaxy, host) && voicesOn(galaxy)) {
            noteVoiceCue(galaxy, {
                kind: 'concord',
                empire: host,
                message: m,
                voice: r,
                other: host,
                speaker: r.leader,
                role: `the treasure-fleet mask-bearer of the ${r.name}`,
                facts: { occasion: 'treasure fleet arrival', concord: r.name, port: portLabel(galaxy, port), ships: st.treasure.length, voyage: st.stats.voyages },
            });
        }
        scenarioNews(galaxy, r, scenarioText('Scenario RimTrade Treasure Docks', r.name, portLabel(galaxy, port), host.name), (e) => e !== host, lead(st));
    }
}

/** The periodic convoy handler (every long block). */
export function treasureFleetTick(galaxy: Galaxy): void {
    const r = rimTraderEmpire(galaxy);
    if (r === null || !isRimTraderAI(galaxy, r)) return;
    const st = treasureState(galaxy);
    const now = galaxyStarDate(galaxy);
    // Contact broadcast (follow-up tuning).
    const contactYear = treasureParam(galaxy, 'rimTraderContactYear');
    if (!st.contactDone && contactYear > 0 && now - st.startStarDate >= contactYear * YEAR_LENGTH) {
        st.contactDone = true;
        const home = rimTraderPort(galaxy);
        for (const e of galaxy.empires) {
            if (!isNormalEmpire(galaxy, e, r) || obtainDiplomaticRelation(r, e).type !== DiplomaticRelationType.NotMet) continue;
            doEmpireEncounter(galaxy, r, e, home);
        }
    }
    if (Math.trunc(treasureParam(galaxy, 'treasureFleetSize')) <= 0) return;
    prune(r, st);
    const home = rimTraderPort(galaxy);
    if (home === null) return;
    if (!st.sailing) {
        const interval = treasureParam(galaxy, 'treasureCircuitInterval') * GAME_DAY_LENGTH;
        if (st.lastDeparture < 0 || now - st.lastDeparture >= interval) depart(galaxy, r, st, home, now);
        return;
    }
    const l = lead(st);
    if (l === null) {
        // Fleet lost at sea.
        st.sailing = false;
        return;
    }
    // The escorts are turning back for a straggler (treasureRaids.ts): the convoy holds.
    if (convoyRecovering(st)) return;
    // Skip ports that are gone or turned hostile (then choose the next stop, or home).
    for (;;) {
        while (st.homeward !== true && st.leg < st.circuit.length) {
            const p = st.circuit[st.leg];
            const host = p.actualEmpire;
            const bad = p.hasBeenDestroyed || host === null || host === r || obtainDiplomaticRelation(r, host).type === DiplomaticRelationType.War;
            if (!bad) break;
            st.leg++;
        }
        if (st.homeward === true || st.leg < st.circuit.length) break;
        extendOrHome(galaxy, r, st, l, home);
    }
    const target: BuiltObject | Habitat = st.homeward !== true && st.leg < st.circuit.length ? st.circuit[st.leg] : home;
    const dist = galaxy.calculateDistance(l.xpos, l.ypos, target.xpos, target.ypos);
    if (dist > TREASURE_DOCK_RANGE) {
        sailTo(galaxy, st, target);
        return;
    }
    if (target !== home) {
        arrive(galaxy, r, st, target as BuiltObject);
        st.leg++;
        // Out of rare goods: home (no more stops); else the next stop (older saves: the rest of a fixed circuit first).
        if (st.leg < st.circuit.length && !treasureHoldsRare(galaxy, r, st)) {
            st.leg = st.circuit.length;
            st.homeward = true;
            treasureStats2(st).returnedEmpty++;
        }
        extendOrHome(galaxy, r, st, target, home);
        treasureStraggleAtDeparture(galaxy, r, st);
        sailTo(galaxy, st, st.homeward !== true && st.leg < st.circuit.length ? st.circuit[st.leg] : home);
        return;
    }
    // Home.
    (treasureStats2(st).rareLeft ??= []).push(treasureRareUnits(galaxy, r, st));
    unload(r, st, home);
    refuel(st);
    st.sailing = false;
    st.circuit = [];
    st.leg = 0;
    st.homeward = false;
    st.visited = [];
    scenarioNews(galaxy, r, scenarioText('Scenario RimTrade Treasure Returns', r.name, portLabel(galaxy, home)), undefined, l);
}

// ---------------------------------------------------------------------------------------------------------------
// Beacon, raids, map features
// ---------------------------------------------------------------------------------------------------------------

/** objectVisibleToAll query: the convoy's ships are known to every empire. Pure. */
export function treasureBeaconVisible(galaxy: Galaxy, value: boolean, args: { object: BuiltObject | Habitat }): boolean {
    if (value || !(args.object instanceof BuiltObject) || !hasTreasureState(galaxy)) return value;
    return treasureState(galaxy).ships.includes(args.object) && !args.object.hasBeenDestroyed;
}

/** A convoy ship destroyed: the attacker's standing with the Concord drops (NewsNet). No Rnd. */
export function treasureShipDestroyed(galaxy: Galaxy, ev: { builtObject: BuiltObject; destroyer: Empire | null }): void {
    if (!hasTreasureState(galaxy)) return;
    const st = treasureState(galaxy);
    if (!st.ships.includes(ev.builtObject)) return;
    const r = rimTraderEmpire(galaxy);
    st.stats.lost++;
    if (r === null || ev.destroyer === null || ev.destroyer === r) return;
    const isTreasure = st.treasure.includes(ev.builtObject);
    const penalty = treasureParam(galaxy, 'treasureRaidPenalty') * (isTreasure ? 1 : 0.25);
    const row = (rimTradeState(galaxy).ledger[ev.destroyer.empireId] ??= { credit: 0, debit: 0 });
    row.debit += penalty;
    if (isTreasure) scenarioNews(galaxy, r, scenarioText('Scenario RimTrade Treasure Raided', r.name, ev.destroyer.name), undefined, ev.builtObject);
}

export function treasureMapFeatures(galaxy: Galaxy): ScenarioMapFeatures | null {
    if (!hasTreasureState(galaxy) || !scenarioFlag(galaxy, 'rimTrader')) return null;
    const st = treasureState(galaxy);
    const l = st.treasure.find((b) => !b.hasBeenDestroyed) ?? st.ships.find((b) => !b.hasBeenDestroyed) ?? null;
    const out: ScenarioMapFeatures = { markers: [], routes: [] };
    if (l === null) return out;
    if (scenarioFlag(galaxy, 'treasureBeacon')) out.markers.push({ x: l.xpos, y: l.ypos, label: scenarioText('Scenario RimTrade Treasure Fleet'), color: TREASURE_COLOR });
    const home = rimTraderPort(galaxy);
    if (st.sailing && home !== null && st.circuit.length > 0) {
        const points = [home, ...st.circuit, home].map((p) => ({ x: p.xpos, y: p.ypos }));
        out.routes.push({ points, color: TREASURE_COLOR, activeLeg: st.leg });
    }
    return out;
}

/**
 * The treasure fleet selected on the map (one of its ships, or a fleet holding one): its remaining stops (the port
 * sailed to, the later ports, then home) and a line from the lead to every other live ship, so stragglers show.
 * Read-only, no Rnd.
 */
export function treasureSelectionFeature(galaxy: Galaxy, sel: ScenarioSelectionLike): ScenarioSelectionFeature | null {
    if (!hasTreasureState(galaxy) || !scenarioFlag(galaxy, 'rimTrader')) return null;
    const st = treasureState(galaxy);
    if (st.ships.length === 0) return null;
    const picked = sel.shipGroup !== undefined ? sel.shipGroup.ships : sel.builtObjects !== undefined ? sel.builtObjects : sel.builtObject !== undefined ? [sel.builtObject] : [];
    if (!picked.some((b) => st.ships.includes(b))) return null;
    const live = st.ships.filter((b) => !b.hasBeenDestroyed);
    const lead = live.find((b) => st.treasure.includes(b)) ?? live[0] ?? null;
    if (lead === null) return null;
    const stops: { x: number; y: number }[] = [];
    if (st.sailing) {
        if (st.homeward !== true) for (let i = Math.max(0, st.leg); i < st.circuit.length; i++) stops.push({ x: st.circuit[i].xpos, y: st.circuit[i].ypos });
        const home = rimTraderPort(galaxy);
        if (home !== null) stops.push({ x: home.xpos, y: home.ypos });
    }
    return { color: TREASURE_COLOR, lead, stops, members: live.filter((b) => b !== lead) };
}

registerScenarioQuery({ id: 'rimTrade.researchCap', flag: 'rimTrader', query: 'researchFrozen', run: concordResearchFrozen });
registerScenarioQuery({ id: 'rimTrade.beacon', flag: 'treasureBeacon', query: 'objectVisibleToAll', run: (g, v, a) => treasureBeaconVisible(g, v, a) });
registerScenarioEvent({ id: 'rimTrade.treasureRaid', flag: 'rimTrader', event: 'builtObjectKilledBy', run: treasureShipDestroyed });
registerScenarioPeriodic({ id: 'rimTrade.treasure', flag: 'rimTrader', periodDays: 10, run: (g) => treasureFleetTick(g) });
registerScenarioYearly({ id: 'rimTrade.researchCapYear', flag: 'rimTrader', order: 11, run: (g) => yearlyCapCheck(g) });
registerScenarioMapFeatures('rimTrade.treasure', (g) => treasureMapFeatures(g));
registerScenarioSelectionFeatures('rimTrade.treasure', (g, sel) => treasureSelectionFeature(g, sel));
