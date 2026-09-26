// Save/load of a Galaxy (tasks 11a1/11a2, reworked for the M3 game-start
// state). The whole galaxy object graph — habitats, systems, creatures,
// empires with their built objects / designs / characters / research /
// visibility / diplomacy, galaxy.builtObjects, pirate factions — is written
// through the generic reference-tracking codec in graphCodec.ts, so object
// identity survives the round trip (an object in galaxy.builtObjects and in
// empire.spacePorts is one instance after load, like the C# graph).
//
// Only two kinds of state are not written: static data that lives in GameData
// (races, resources, component/research definitions, policies, name lists —
// referenced by key and re-resolved on load) and derived lookup structures
// that are rebuilt after load (index grids, step order, the visibility owner
// hooks). The C# Galaxy ISerializable members are not ported — this is our own
// save format for the headless sim.

import { Galaxy } from '../galaxy';
import type { GameData } from '../data/gameData';
import { cloneGalaxyRaces, raceScalarFields } from '../data/races';
import { buildResourceSystem } from '../resourceSystem';
import { buildResearchStatic, ResearchSystem } from '../researchSystem';
import { buildComponentStatic } from '../componentStatic';
import { GraphDecoder, GraphEncoder, type Encoded, type ExternalRef, type GraphCodecOptions } from './graphCodec';
// Model classes (registry below), one import per module, sorted by module path.
import { BuiltObject, DockingBay } from '../builtObject';
import { BuiltObjectComponent, BuiltObjectComponentList } from '../builtObjectComponent';
import { Cargo, CargoList, ResourceRef, Troop, TroopList } from '../cargo';
import {
    captainBonusMap, Character, CharacterEvent, CharacterSkill, CharacterSkillList, galaxyStates, habitatCharacters, habitatInvadingCharacters, IntelligenceMission,
    type CaptainBonuses, type CharacterGalaxyState,
} from '../characters';
import { PrioritizedTarget } from '../civilianAI';
import { Explosion, SpaceBattleStats } from '../combat/damage';
import { Fighter, FighterSpecification, FighterWeapon, specificationOf } from '../combat/fighters';
import { InvasionStats } from '../combat/invasion';
import { ConstructionQueue } from '../construction/constructionQueue';
import { ConstructionYard } from '../construction/constructionYard';
import { PlanetaryFacility } from '../construction/facilities';
import { Creature } from '../creature';
import { DesignSpecification, DesignSpecificationComponentRule } from '../data/designTemplates';
import { Design, galaxyComponentCurrentPrices, galaxyResourceCurrentPrices } from '../design';
import { DesignNameState } from '../designNames';
import { DiplomacyCounters, DiplomaticRelation, DiplomaticRelationList, EmpireEvaluation, YearlyTradeValue, YearlyTradeValueList } from '../diplomacy';
import { Empire, EmpireCounters, getGovernmentsStatic } from '../empire';
import { Blockade } from '../fleets/blockades';
import { FleetAttack } from '../fleets/militaryAI';
import { ShipGroup } from '../fleets/shipGroup';
import { ForceStructureProjection, ForceStructureProjectionList } from '../forceStructureProjection';
import { GalaxyLocation } from '../galaxyLocation';
import { Contract } from '../logistics/contracts';
import { ComponentRef, Order, OrderList } from '../logistics/orders';
import { Manufacturer, ManufacturingQueue, ResourceDatePair, ResourceDatePairList } from '../manufacturingQueue';
import { BoxedPirateRelationType } from '../advisorQueue';
import { EmpireMessage } from '../messages';
import { DeclinedTask, DistressSignal } from '../missions/distress';
import { BuiltObjectMission, Command, Sector } from '../missions/mission';
import { FuelSourceSystem, FuelSourceSystemList } from '../movement';
import { PirateRelation, PirateRelationList } from '../pirateRelations';
import { EmpireActivity, EmpireActivityList } from '../pirates/empireActivity';
import { PirateColonyControl, PirateColonyControlList } from '../pirates/pirateColonyControl';
import { PirateEconomy, PirateEconomyYear } from '../pirates/pirateEconomy';
import { Population, PopulationList } from '../population';
import { Random } from '../random';
import { HabitatPrioritization } from '../resourceTargets';
import { Ruin } from '../ruins';
import { EmpireTerritory } from '../territory';
import { TradeableItem } from '../tradeItems';
import { Habitat } from '../types';
import { EmpireVisibility, GalaxyResourceMap, SystemVisibility } from '../visibility';
import { Weapon } from '../weapon';

export interface GalaxySaveJSON {
    version: 2;
    /** The Galaxy instance encoded by GraphEncoder (reference id 0). */
    galaxy: Encoded;
    /** EmpireTerritory's 2000x2000 ownership grid, run-length encoded per row ([value, count, value, count, ...]);
     *  null when the grid was never built. Absent in older saves (then recomputed on load). */
    territory?: number[][] | null;
    /** Galaxy state the TS keeps outside the object graph (module WeakMaps / static-table copies; see
     *  SideTables), encoded with the same reference ids as `galaxy`. Absent in older saves. */
    sideTables?: Encoded;
}

// ---------------------------------------------------------------------------
// Codec configuration
// ---------------------------------------------------------------------------

/**
 * Every model class that can appear in the galaxy graph, grouped and sorted by module. Instances are rebuilt with
 * Object.create(prototype); the name is what the save stores. Classes in src/sim deliberately NOT registered (never
 * stored in the galaxy graph): GalaxyTime (saved by gameSave.ts), GalaxyNebulaeGenerator (generation-only),
 * Tutorial (static data), SortableStellarObjectList (freight.ts scratch list), MissionResolveError (an Error),
 * Fnv (tick digest), SimDriver (scheduler; its state lives on the galaxy as plain fields), GraphEncoder/GraphDecoder.
 */
import { EmpireVictoryConditions, VictoryConditions } from '../victory';
import { Achievement } from '../achievements';
import { EventAction, EventActionExecutionPackage, EventActionList, GameEvent, GameEventList } from '../story/gameEventModel';

const CLASSES: Record<string, object> = {
    // advisorQueue.ts: a pirate-protection suggestion's AdvisorMessageData (Empire.advisorSuggestions; suggest).
    BoxedPirateRelationType: BoxedPirateRelationType.prototype,
    // builtObject.ts
    BuiltObject: BuiltObject.prototype,
    DockingBay: DockingBay.prototype,
    // builtObjectComponent.ts
    BuiltObjectComponent: BuiltObjectComponent.prototype,
    BuiltObjectComponentList: BuiltObjectComponentList.prototype,
    // cargo.ts
    Cargo: Cargo.prototype,
    CargoList: CargoList.prototype,
    ResourceRef: ResourceRef.prototype,
    Troop: Troop.prototype,
    TroopList: TroopList.prototype,
    // characters.ts
    Character: Character.prototype,
    CharacterEvent: CharacterEvent.prototype,
    CharacterSkill: CharacterSkill.prototype,
    CharacterSkillList: CharacterSkillList.prototype,
    IntelligenceMission: IntelligenceMission.prototype,
    // civilianAI.ts: migration/tourism targets (M4f).
    PrioritizedTarget: PrioritizedTarget.prototype,
    // combat/damage.ts: explosions and battle stats attached to ships (M4o).
    Explosion: Explosion.prototype,
    SpaceBattleStats: SpaceBattleStats.prototype,
    // combat/fighters.ts: BuiltObject.Fighters (FighterList), their weapons and specifications (M4p).
    Fighter: Fighter.prototype,
    FighterSpecification: FighterSpecification.prototype,
    FighterWeapon: FighterWeapon.prototype,
    // combat/invasion.ts: Habitat.InvasionStats (M4q).
    InvasionStats: InvasionStats.prototype,
    // construction/
    ConstructionQueue: ConstructionQueue.prototype,
    ConstructionYard: ConstructionYard.prototype,
    PlanetaryFacility: PlanetaryFacility.prototype, // Habitat.Facilities (M4i); its def is a GameData external
    // creature.ts
    Creature: Creature.prototype,
    // data/designTemplates.ts
    DesignSpecification: DesignSpecification.prototype,
    DesignSpecificationComponentRule: DesignSpecificationComponentRule.prototype,
    // design.ts / designNames.ts
    Design: Design.prototype,
    DesignNameState: DesignNameState.prototype,
    // diplomacy.ts
    DiplomacyCounters: DiplomacyCounters.prototype,
    DiplomaticRelation: DiplomaticRelation.prototype,
    DiplomaticRelationList: DiplomaticRelationList.prototype,
    EmpireEvaluation: EmpireEvaluation.prototype,
    YearlyTradeValue: YearlyTradeValue.prototype,
    YearlyTradeValueList: YearlyTradeValueList.prototype,
    // empire.ts
    Empire: Empire.prototype,
    EmpireCounters: EmpireCounters.prototype,
    // fleets/: blockades, incoming-fleet entries (M4m) and fleets (Empire.ShipGroups / BuiltObject.ShipGroup, M4l).
    Blockade: Blockade.prototype,
    FleetAttack: FleetAttack.prototype,
    ShipGroup: ShipGroup.prototype,
    // forceStructureProjection.ts
    ForceStructureProjection: ForceStructureProjection.prototype,
    ForceStructureProjectionList: ForceStructureProjectionList.prototype,
    // galaxy.ts / galaxyLocation.ts
    Galaxy: Galaxy.prototype,
    GalaxyLocation: GalaxyLocation.prototype,
    // logistics/: freighter contracts and market orders (M4d).
    Contract: Contract.prototype,
    ComponentRef: ComponentRef.prototype,
    Order: Order.prototype,
    OrderList: OrderList.prototype,
    // manufacturingQueue.ts
    Manufacturer: Manufacturer.prototype,
    ManufacturingQueue: ManufacturingQueue.prototype,
    ResourceDatePair: ResourceDatePair.prototype,
    ResourceDatePairList: ResourceDatePairList.prototype,
    // messages.ts
    EmpireMessage: EmpireMessage.prototype,
    // missions/distress.ts: Empire.DistressSignals / DeclinedTasks.
    DeclinedTask: DeclinedTask.prototype,
    DistressSignal: DistressSignal.prototype,
    // missions/mission.ts: ships carry missions from game start (Start.2.cs 1373).
    BuiltObjectMission: BuiltObjectMission.prototype,
    Command: Command.prototype,
    Sector: Sector.prototype,
    // movement.ts
    FuelSourceSystem: FuelSourceSystem.prototype,
    FuelSourceSystemList: FuelSourceSystemList.prototype,
    // pirateRelations.ts
    PirateRelation: PirateRelation.prototype,
    PirateRelationList: PirateRelationList.prototype,
    // pirates/: mission marketplace (M4s1), colony control (M4s2), economy.
    EmpireActivity: EmpireActivity.prototype,
    EmpireActivityList: EmpireActivityList.prototype,
    PirateColonyControl: PirateColonyControl.prototype,
    PirateColonyControlList: PirateColonyControlList.prototype,
    PirateEconomy: PirateEconomy.prototype,
    PirateEconomyYear: PirateEconomyYear.prototype,
    // population.ts
    Population: Population.prototype,
    PopulationList: PopulationList.prototype,
    // random.ts
    Random: Random.prototype,
    // researchSystem.ts
    ResearchSystem: ResearchSystem.prototype,
    // resourceTargets.ts
    HabitatPrioritization: HabitatPrioritization.prototype,
    // ruins.ts
    Ruin: Ruin.prototype,
    // territory.ts
    EmpireTerritory: EmpireTerritory.prototype,
    // tradeItems.ts: trade-deal message subjects (Empire.3.cs 4384).
    TradeableItem: TradeableItem.prototype,
    // types.ts
    Habitat: Habitat.prototype,
    // visibility.ts
    EmpireVisibility: EmpireVisibility.prototype,
    GalaxyResourceMap: GalaxyResourceMap.prototype,
    SystemVisibility: SystemVisibility.prototype,
    // weapon.ts
    Weapon: Weapon.prototype,
    // victory.ts / achievements.ts / story/gameEventModel.ts (M4z4, M4z3; merged from main).
    EmpireVictoryConditions: EmpireVictoryConditions.prototype,
    VictoryConditions: VictoryConditions.prototype,
    Achievement: Achievement.prototype,
    EventAction: EventAction.prototype,
    EventActionExecutionPackage: EventActionExecutionPackage.prototype,
    EventActionList: EventActionList.prototype,
    GameEvent: GameEvent.prototype,
    GameEventList: GameEventList.prototype,
};

/** Galaxy fields that hold GameData tables (re-wired from gameData on load,
 *  exactly like generateGalaxy / createGame) or derived indexes (rebuilt). */
const GALAXY_STATIC_FIELDS = ['resources', 'researchStatic', 'designSpecificationTexts', 'designNames', 'resourceSystem', 'races', 'characterNames', 'characterFiles', 'raceFamilies'] as const;
const GALAXY_DERIVED_FIELDS = ['stepOrder', 'stepOrderDirty'] as const;
/** The spatial index grids ARE saved (as references): their per-cell order is the order objects entered the cell
 *  while the sim ran, and index scans (threat lists, nearest-object searches) depend on it, so a rebuilt grid would
 *  change later behaviour. Saves written before this was added lack them and get the rebuild below. */
const GALAXY_INDEX_FIELDS = ['habitatIndexGrid', 'systemsIndexGrid', 'builtObjectIndexGrid', 'galaxyLocationIndex'] as const;

const CODEC_OPTIONS: GraphCodecOptions = {
    classes: CLASSES,
    revive: new Map<object, (instance: object) => void>([
        // Random keeps its draw counter and trace hook as non-enumerable own properties (random.ts ctor); they are
        // diagnostics, not generator state, so a loaded stream counts draws from 0.
        [
            Random.prototype,
            (r) => {
                Object.defineProperty(r, 'draws', { value: 0, writable: true, enumerable: false, configurable: true });
                Object.defineProperty(r, 'trace', { value: null, writable: true, enumerable: false, configurable: true });
            },
        ],
    ]),
    skipFields: new Map<object, ReadonlySet<string>>([
        [Galaxy.prototype, new Set<string>([...GALAXY_STATIC_FIELDS, ...GALAXY_DERIVED_FIELDS])],
        // VisibilityOwner is a bag of closures over the empire (Empire.visibilityOwner).
        [EmpireVisibility.prototype, new Set<string>(['owner'])],
        // The 2000x2000 ownership grid is written run-length encoded beside the graph (GalaxySaveJSON.territory):
        // it is NOT a pure function of the saved state — incremental ReviewEmpireTerritoryUpdate / onlySystems passes
        // leave it partial, and recomputing it on load would also rewrite every colony's colonyInfluenceRadius.
        [EmpireTerritory.prototype, new Set<string>(['territory'])],
    ]),
};

// ---------------------------------------------------------------------------
// Externals: static data referenced by key instead of being copied
// ---------------------------------------------------------------------------

/** The GameData-derived tables a galaxy is wired to (generateGalaxy /
 *  createGame). On save they are read from the galaxy itself; on load they
 *  are rebuilt from gameData, so the two sides agree on every key. */
interface StaticTables {
    races: Galaxy['races'];
    raceFamilies: Galaxy['raceFamilies'];
    resources: Galaxy['resources'];
    researchStatic: NonNullable<Galaxy['researchStatic']>;
    resourceSystem: Galaxy['resourceSystem'];
    designSpecificationTexts: Galaxy['designSpecificationTexts'];
    designNames: Galaxy['designNames'];
    characterNames: Galaxy['characterNames'];
    characterFiles: Galaxy['characterFiles'];
}

function staticTablesOfGalaxy(galaxy: Galaxy): StaticTables {
    if (galaxy.researchStatic === null) throw new Error('Galaxy has no researchStatic; cannot serialize.');
    return {
        races: galaxy.races,
        raceFamilies: galaxy.raceFamilies,
        resources: galaxy.resources,
        researchStatic: galaxy.researchStatic,
        resourceSystem: galaxy.resourceSystem,
        designSpecificationTexts: galaxy.designSpecificationTexts,
        designNames: galaxy.designNames,
        characterNames: galaxy.characterNames,
        characterFiles: galaxy.characterFiles,
    };
}

function staticTablesOfGameData(gameData: GameData): StaticTables {
    // The galaxy's own Race copies (Galaxy.4.cs 2132; cloneGalaxyRaces as in generateGalaxy). Referenced by index like
    // the other tables; their in-play state comes back from the raceFields side table.
    const races = cloneGalaxyRaces(gameData.races);
    return {
        races,
        raceFamilies: gameData.raceFamilies,
        resources: gameData.resources,
        // generateGalaxy's wiring (galaxy.ts): facilities, fighters (Galaxy.FighterSpecificationsStatic, M4p) and plagues too.
        researchStatic: buildResearchStatic(gameData.research, gameData.components, races, gameData.policies, gameData.piratePolicies, buildComponentStatic(gameData), gameData.facilities, gameData.fighters, gameData.plagues),
        resourceSystem: buildResourceSystem(gameData.resources, gameData.components),
        designSpecificationTexts: gameData.designSpecificationTexts ?? new Map(),
        designNames: gameData.designNames ?? [],
        characterNames: gameData.characterNames ?? null,
        characterFiles: gameData.characterFiles ?? null,
    };
}

function forEachExternal(tables: StaticTables, visit: (obj: object, ref: ExternalRef) => void): void {
    const one = (kind: string, key: string | number, item: unknown) => {
        if (item !== null && typeof item === 'object') visit(item as object, { kind, key });
    };
    const list = (kind: string, items: readonly unknown[]) => items.forEach((item, i) => one(kind, i, item));
    const map = (kind: string, items: Map<string | number, unknown>) => items.forEach((item, key) => one(kind, key, item));
    list('race', tables.races);
    list('raceFamily', tables.raceFamilies);
    list('government', getGovernmentsStatic());
    list('resource', tables.resources);
    const rs = tables.researchStatic;
    list('research', rs.definitions);
    map('component', rs.componentsById);
    map('policy', rs.policies);
    map('piratePolicy', rs.piratePolicies);
    one('researchStatic', 0, rs);
    one('resourceSystem', 0, tables.resourceSystem);
    if (rs.componentStatic !== null) {
        one('componentStatic', 0, rs.componentStatic);
        for (const def of rs.componentStatic.definitions) one('componentDef', def.componentId, def);
        // ResearchSystem.componentImprovements holds these per-project entries by reference.
        rs.componentStatic.researchProjects.forEach((p, pi) => p.improvements.forEach((ci, i) => one('componentImprovement', `${pi}:${i}`, ci)));
    }
    // Galaxy.PlanetaryFacilityDefinitionsStatic (PlanetaryFacility.def), FighterSpecificationsStatic (the fighters.txt
    // rows and their shared FighterSpecification instances, combat/fighters.ts specificationOf) and PlaguesStatic.
    list('facility', rs.facilities);
    list('fighterRow', rs.fighters);
    rs.fighters.forEach((row, i) => one('fighterSpec', i, specificationOf(row)));
    list('plague', rs.plagues);
    one('designSpecificationTexts', 0, tables.designSpecificationTexts);
    one('designNames', 0, tables.designNames);
    one('characterNames', 0, tables.characterNames);
    one('characterFiles', 0, tables.characterFiles);
}

function externalsByObject(tables: StaticTables): Map<object, ExternalRef> {
    const out = new Map<object, ExternalRef>();
    // First registration wins (an object may be reachable under two kinds).
    forEachExternal(tables, (obj, ref) => {
        if (!out.has(obj)) out.set(obj, ref);
    });
    return out;
}

function externalsByRef(tables: StaticTables): Map<string, object> {
    const out = new Map<string, object>();
    forEachExternal(tables, (obj, ref) => {
        const key = `${ref.kind}:${ref.key}`;
        if (!out.has(key)) out.set(key, obj);
    });
    return out;
}

// ---------------------------------------------------------------------------
// Serialize
// ---------------------------------------------------------------------------

/** Flat list of all empires in save order: galaxy.empires, then
 *  pirateEmpires, then independentEmpire (gameSave's playerEmpireIndex). */
export function flatEmpireList(galaxy: Galaxy): Empire[] {
    const list = [...galaxy.empires, ...galaxy.pirateEmpires];
    if (galaxy.independentEmpire !== null) list.push(galaxy.independentEmpire);
    return list;
}

/** Convert a Galaxy into a plain JSON-safe object (see GalaxySaveJSON). */
export function galaxyToJSON(galaxy: Galaxy): GalaxySaveJSON {
    const encoder = new GraphEncoder(CODEC_OPTIONS, externalsByObject(staticTablesOfGalaxy(galaxy)));
    const encoded = encoder.encode(galaxy, 'galaxy');
    const sideTables = encoder.encode(collectSideTables(galaxy, [...encoder.visited()]), 'sideTables');
    return { version: 2, galaxy: encoded, territory: encodeTerritory(territoryGrid(galaxy.empireTerritory)), sideTables };
}

/**
 * Diagnostics for tests: objects that the save writes by value although they are reachable from the galaxy's static
 * GameData tables (so they would come back as copies, not as the shared static instance). Returns one short
 * description per leaked object (constructor name + first keys).
 */
export function findStaticDataLeaks(galaxy: Galaxy, gameData?: GameData): string[] {
    const tables = staticTablesOfGalaxy(galaxy);
    const externals = externalsByObject(tables);
    const staticObjects = new Set<object>();
    const stack: unknown[] = [...Object.values(tables), gameData];
    while (stack.length > 0) {
        const v = stack.pop();
        if (v === null || typeof v !== 'object' || staticObjects.has(v) || ArrayBuffer.isView(v)) continue;
        staticObjects.add(v);
        if (v instanceof Map) for (const [k, x] of v) stack.push(k, x);
        else if (v instanceof Set) stack.push(...v);
        else stack.push(...Object.values(v));
    }
    const encoder = new GraphEncoder(CODEC_OPTIONS, externals);
    encoder.encode(galaxy, 'galaxy');
    encoder.encode(collectSideTables(galaxy, [...encoder.visited()]), 'sideTables');
    const out: string[] = [];
    for (const obj of encoder.visited()) {
        if (!staticObjects.has(obj)) continue;
        const name = (Object.getPrototypeOf(obj) as { constructor?: { name?: string } } | null)?.constructor?.name ?? 'null';
        out.push(`${name} {${Object.keys(obj).slice(0, 4).join(', ')}}`);
    }
    return out;
}

/** Index grids for saves that predate GALAXY_INDEX_FIELDS (generateGalaxy / updateSystemInfo / generateNebulae /
 *  Empire.addBuiltObject fill them like this). */
function rebuildIndexGrids(galaxy: Galaxy): void {
    const g = galaxy as unknown as Record<string, unknown>;
    galaxy.initIndexGrids();
    for (const sys of galaxy.systems) {
        const cell = galaxy.resolveIndex(sys.systemStar.xpos, sys.systemStar.ypos);
        galaxy.systemsIndexGrid[cell.x][cell.y].push(sys);
        for (const habitat of sys.habitats) {
            const hc = galaxy.resolveIndex(habitat.xpos, habitat.ypos);
            galaxy.habitatIndexGrid[hc.x][hc.y].push(habitat);
        }
    }
    // galaxy.builtObjects keeps null holes after teardown until RemoveNullBuiltObjects compacts it (Galaxy.cs); the
    // holes are saved as JSON nulls so the list (and its indices) survive the round trip unchanged.
    for (const builtObject of galaxy.builtObjects as (BuiltObject | null)[]) {
        if (builtObject == null) continue;
        const cell = galaxy.resolveIndex(builtObject.xpos, builtObject.ypos);
        galaxy.builtObjectIndexGrid[cell.x][cell.y].push(builtObject);
    }
    const locationGrid: GalaxyLocation[][][] = [];
    for (let i = 0; i < galaxy.indexMaxX; i++) {
        locationGrid.push(Array.from({ length: galaxy.indexMaxY }, () => []));
    }
    g.galaxyLocationIndex = locationGrid;
    for (const location of galaxy.galaxyLocations) galaxy.addGalaxyLocationIndex(location);
}

// ---------------------------------------------------------------------------
// Side tables: galaxy state that lives outside the object graph
// ---------------------------------------------------------------------------

/**
 * State the TS port keeps beside the model objects rather than in their fields. All of it is C# Galaxy / Habitat /
 * BuiltObject state, so it has to survive a save:
 * - Galaxy.ComponentCurrentPrices / ResourceCurrentPrices (design.ts per-galaxy arrays; the market reviews them);
 * - StellarObject.Characters for habitats and Habitat.InvadingCharacters (characters.ts WeakMaps);
 * - BuiltObject._Captain*Bonus (characters.ts captainBonusMap);
 * - Race.AvailableCharacters and Galaxy.RndStatic (characters.ts per-galaxy CharacterGalaxyState);
 * - Plague.LatestTechLevelUpdate (ResearchSystem.ReviewPlagues mutates the galaxy's PlaguesStatic copies);
 * - the scalar fields of the galaxy's Race objects (Galaxy.Races is saved with the C# game; play mutates it, e.g.
 *   Galaxy.5.cs 4472 the Origins ruin's SatisfactionModifier).
 * Maps are keyed by graph objects, so they are encoded by the same encoder right after the galaxy.
 */
interface SideTables {
    componentCurrentPrices: number[];
    resourceCurrentPrices: number[];
    habitatCharacters: Map<Habitat, Character[]>;
    habitatInvadingCharacters: Map<Habitat, Character[]>;
    captainBonuses: Map<BuiltObject, CaptainBonuses>;
    characterState: { raceAvailableCharacters: CharacterGalaxyState['raceAvailableCharacters']; rndStatic: Random } | null;
    plagueLatestTechLevelUpdate: number[];
    /** raceScalarFields of galaxy.races[i] (absent in saves written before races were per galaxy). */
    raceFields?: Record<string, string | number | boolean>[];
    /** Random.drawCount of every saved stream (a non-enumerable diagnostic counter; the harness reports deltas). */
    randomDraws: Map<Random, number>;
}

function collectSideTables(galaxy: Galaxy, visited: readonly object[]): SideTables {
    const out: SideTables = {
        componentCurrentPrices: [...galaxyComponentCurrentPrices(galaxy)],
        resourceCurrentPrices: [...galaxyResourceCurrentPrices(galaxy)],
        habitatCharacters: new Map(),
        habitatInvadingCharacters: new Map(),
        captainBonuses: new Map(),
        characterState: null,
        plagueLatestTechLevelUpdate: (galaxy.researchStatic?.plagues ?? []).map((p) => p.latestTechLevelUpdate),
        raceFields: galaxy.races.map(raceScalarFields),
        randomDraws: new Map(),
    };
    // Every habitat / built object in the saved graph, in visit order (deterministic).
    for (const obj of visited) {
        if (obj instanceof Habitat) {
            const chars = habitatCharacters.get(obj);
            if (chars !== undefined) out.habitatCharacters.set(obj, chars);
            const invading = habitatInvadingCharacters.get(obj);
            if (invading !== undefined) out.habitatInvadingCharacters.set(obj, invading);
        } else if (obj instanceof Random) {
            out.randomDraws.set(obj, obj.drawCount);
        } else if (obj instanceof BuiltObject) {
            const bonuses = captainBonusMap.get(obj);
            if (bonuses !== undefined) out.captainBonuses.set(obj, bonuses);
        }
    }
    const state = galaxyStates.get(galaxy);
    if (state !== undefined) out.randomDraws.set(state.rndStatic, state.rndStatic.drawCount);
    if (state !== undefined) out.characterState = { raceAvailableCharacters: state.raceAvailableCharacters, rndStatic: state.rndStatic };
    return out;
}

function restoreSideTables(galaxy: Galaxy, t: SideTables): void {
    // The price arrays are cached per galaxy by their getters and mutated in place by the market (design.ts).
    galaxyComponentCurrentPrices(galaxy).splice(0, Infinity, ...t.componentCurrentPrices);
    galaxyResourceCurrentPrices(galaxy).splice(0, Infinity, ...t.resourceCurrentPrices);
    for (const [h, list] of t.habitatCharacters) habitatCharacters.set(h, list);
    for (const [h, list] of t.habitatInvadingCharacters) habitatInvadingCharacters.set(h, list);
    for (const [b, bonuses] of t.captainBonuses) captainBonusMap.set(b, bonuses);
    if (t.characterState !== null) {
        galaxyStates.set(galaxy, {
            agentFirstNames: galaxy.characterNames?.firstNames ?? [],
            agentLastNames: galaxy.characterNames?.lastNames ?? [],
            raceAvailableCharacters: t.characterState.raceAvailableCharacters,
            rndStatic: t.characterState.rndStatic,
        });
    }
    // The revive hook defined `draws` (non-enumerable, writable); plain assignment keeps it non-enumerable.
    for (const [rnd, draws] of t.randomDraws ?? []) (rnd as unknown as { draws: number }).draws = draws;
    t.raceFields?.forEach((fields, i) => {
        if (i < galaxy.races.length) Object.assign(galaxy.races[i], fields);
    });
    const plagues = galaxy.researchStatic?.plagues ?? [];
    t.plagueLatestTechLevelUpdate.forEach((v, i) => {
        if (i < plagues.length) plagues[i].latestTechLevelUpdate = v;
    });
}

type TerritoryGrid = Uint8Array[] | null;

function territoryGrid(territory: EmpireTerritory): TerritoryGrid {
    return (territory as unknown as { territory: TerritoryGrid }).territory;
}

function encodeTerritory(grid: TerritoryGrid): number[][] | null {
    if (grid === null) return null;
    return grid.map((row) => {
        const out: number[] = [];
        for (let i = 0; i < row.length; ) {
            const v = row[i];
            let j = i + 1;
            while (j < row.length && row[j] === v) j++;
            out.push(v, j - i);
            i = j;
        }
        return out;
    });
}

function decodeTerritory(rows: number[][] | null): TerritoryGrid {
    if (rows === null) return null;
    return rows.map((runs) => {
        let length = 0;
        for (let i = 1; i < runs.length; i += 2) length += runs[i];
        const row = new Uint8Array(length);
        for (let i = 0, at = 0; i < runs.length; i += 2) {
            row.fill(runs[i], at, at + runs[i + 1]);
            at += runs[i + 1];
        }
        return row;
    });
}

// ---------------------------------------------------------------------------
// Deserialize
// ---------------------------------------------------------------------------

/** Rebuild a Galaxy from a galaxyToJSON object. Static data comes from
 *  gameData, mirroring generateGalaxy's wiring. */
export function galaxyFromJSON(obj: GalaxySaveJSON, gameData: GameData): Galaxy {
    if (obj.version !== 2) throw new Error(`Unsupported galaxy save version ${String((obj as { version: unknown }).version)}.`);
    const tables = staticTablesOfGameData(gameData);
    const externals = externalsByRef(tables);
    const decoder = new GraphDecoder(CODEC_OPTIONS, (ref) => externals.get(`${ref.kind}:${ref.key}`));
    const galaxy = decoder.decode(obj.galaxy, 'galaxy') as Galaxy;
    if (!(galaxy instanceof Galaxy)) throw new Error('Save root is not a Galaxy.');

    // --- Static tables (generateGalaxy / createGame wiring).
    const g = galaxy as unknown as Record<string, unknown>;
    // (Defined, not assigned by computed key, when new: see GraphDecoder '$t' — the Galaxy would turn dictionary-mode.)
    for (const field of GALAXY_STATIC_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(g, field)) g[field] = tables[field];
        else Object.defineProperty(g, field, { value: tables[field], writable: true, enumerable: true, configurable: true });
    }

    // --- State kept outside the graph (after the static tables: the price getters read them).
    if (obj.sideTables !== undefined) restoreSideTables(galaxy, decoder.decode(obj.sideTables, 'sideTables') as SideTables);

    // --- Derived step order (lazy: step() rebuilds before first use).
    g.stepOrder = [];
    g.stepOrderDirty = true;
    if (GALAXY_INDEX_FIELDS.some((field) => g[field] === undefined)) rebuildIndexGrids(galaxy);

    // --- Visibility owner hooks (closures over the empire; see Empire ctor).
    for (const empire of flatEmpireList(galaxy)) {
        empire.visibility.owner = empire.visibilityOwner(empire === galaxy.independentEmpire);
    }
    // --- Territory grid: restored as saved. Saves without it (older version-2 files) fall back to a full
    //     ReviewEmpireTerritory (Start.2.cs 1485), which also recalculates the colony influence radii.
    const territory = galaxy.empireTerritory as unknown as { territory: TerritoryGrid };
    if (obj.territory !== undefined) {
        territory.territory = decodeTerritory(obj.territory);
    } else {
        territory.territory = null;
        galaxy.empireTerritory.reviewEmpireTerritory(galaxy);
    }
    return galaxy;
}
