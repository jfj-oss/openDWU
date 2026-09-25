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
import { buildResourceSystem } from '../resourceSystem';
import { buildResearchStatic, ResearchSystem } from '../researchSystem';
import { buildComponentStatic } from '../componentStatic';
import { EmpireTerritory } from '../territory';
import { Population, PopulationList } from '../population';
import { Creature } from '../creature';
import { GalaxyLocation } from '../galaxyLocation';
import { Habitat } from '../types';
import { Random } from '../random';
import { Cargo, CargoList, ResourceRef, Troop, TroopList } from '../cargo';
import { Empire, EmpireCounters, getGovernmentsStatic } from '../empire';
import { PirateEconomy, PirateEconomyYear } from '../pirates/pirateEconomy';
import { EmpireActivity, EmpireActivityList } from '../pirates/empireActivity';
import { PirateColonyControl, PirateColonyControlList } from '../pirates/pirateColonyControl';
import { Blockade } from '../fleets/blockades';
import { FleetAttack } from '../fleets/militaryAI';
import { InvasionStats } from '../combat/invasion';
import { EmpireVisibility, GalaxyResourceMap, SystemVisibility } from '../visibility';
import { BuiltObject, DockingBay } from '../builtObject';
import { BuiltObjectComponent, BuiltObjectComponentList } from '../builtObjectComponent';
import { Design } from '../design';
import { Weapon } from '../weapon';
import { Character, CharacterEvent, CharacterSkill, CharacterSkillList, IntelligenceMission } from '../characters';
import { Ruin } from '../ruins';
import { DesignNameState } from '../designNames';
import { DiplomaticRelation, DiplomaticRelationList, YearlyTradeValue, YearlyTradeValueList } from '../diplomacy';
import { PirateRelation, PirateRelationList } from '../pirateRelations';
import { ForceStructureProjection, ForceStructureProjectionList } from '../forceStructureProjection';
import { HabitatPrioritization } from '../resourceTargets';
import { DesignSpecification, DesignSpecificationComponentRule } from '../data/designTemplates';
import { GraphDecoder, GraphEncoder, type Encoded, type ExternalRef, type GraphCodecOptions } from './graphCodec';

export interface GalaxySaveJSON {
    version: 2;
    /** The Galaxy instance encoded by GraphEncoder (reference id 0). */
    galaxy: Encoded;
}

// ---------------------------------------------------------------------------
// Codec configuration
// ---------------------------------------------------------------------------

/** Every model class that can appear in the galaxy graph. Instances are
 *  rebuilt with Object.create(prototype); the name is what the save stores. */
import { ConstructionQueue } from '../construction/constructionQueue';
import { ConstructionYard } from '../construction/constructionYard';
import { ManufacturingQueue } from '../manufacturingQueue';
import { Manufacturer } from '../manufacturingQueue';
import { ResourceDatePairList } from '../manufacturingQueue';
import { EmpireEvaluation } from '../diplomacy';
import { FuelSourceSystemList } from '../movement';
import { FuelSourceSystem } from '../movement';
import { DiplomacyCounters } from '../diplomacy';
import { OrderList } from '../logistics/orders';
import { EmpireMessage } from '../messages';
import { BuiltObjectMission, Command, Sector } from '../missions/mission';
import { Contract } from '../logistics/contracts';
import { Order, ComponentRef } from '../logistics/orders';
import { PrioritizedTarget } from '../civilianAI';
import { Fighter, FighterSpecification, FighterWeapon } from '../combat/fighters';
import { Explosion, SpaceBattleStats } from '../combat/damage';
const CLASSES: Record<string, object> = {
    EmpireMessage: EmpireMessage.prototype,
    // M4f: ships carry missions from game start (Start.2.cs 1373); freighter contracts, orders, migration/tourism targets.
    BuiltObjectMission: BuiltObjectMission.prototype,
    Command: Command.prototype,
    Sector: Sector.prototype,
    Contract: Contract.prototype,
    Order: Order.prototype,
    ComponentRef: ComponentRef.prototype,
    PrioritizedTarget: PrioritizedTarget.prototype,
    OrderList: OrderList.prototype,
    DiplomacyCounters: DiplomacyCounters.prototype,
    FuelSourceSystem: FuelSourceSystem.prototype,
    FuelSourceSystemList: FuelSourceSystemList.prototype,
    EmpireEvaluation: EmpireEvaluation.prototype,
    ResourceDatePairList: ResourceDatePairList.prototype,
    Manufacturer: Manufacturer.prototype,
    ManufacturingQueue: ManufacturingQueue.prototype,
    ConstructionYard: ConstructionYard.prototype,
    ConstructionQueue: ConstructionQueue.prototype,
    Galaxy: Galaxy.prototype,
    Random: Random.prototype,
    Habitat: Habitat.prototype,
    Population: Population.prototype,
    PopulationList: PopulationList.prototype,
    Creature: Creature.prototype,
    GalaxyLocation: GalaxyLocation.prototype,
    Ruin: Ruin.prototype,
    EmpireTerritory: EmpireTerritory.prototype,
    Empire: Empire.prototype,
    EmpireCounters: EmpireCounters.prototype,
    PirateEconomy: PirateEconomy.prototype,
    // M4s1: Empire.PirateEconomy years and the pirate mission marketplace lists (Galaxy.PirateMissions, Empire.PirateMissions).
    PirateEconomyYear: PirateEconomyYear.prototype,
    EmpireActivity: EmpireActivity.prototype,
    EmpireActivityList: EmpireActivityList.prototype,
    // M4s2: Habitat._PirateColonyControl (pirate factions' control of colonies).
    PirateColonyControl: PirateColonyControl.prototype,
    PirateColonyControlList: PirateColonyControlList.prototype,
    // M4m: Galaxy/Empire blockades and Empire.IncomingEnemyFleetsAndPlanetDestroyers entries.
    Blockade: Blockade.prototype,
    FleetAttack: FleetAttack.prototype,
    // M4q: Habitat.InvasionStats (a colony under invasion / raid).
    InvasionStats: InvasionStats.prototype,
    EmpireVisibility: EmpireVisibility.prototype,
    SystemVisibility: SystemVisibility.prototype,
    GalaxyResourceMap: GalaxyResourceMap.prototype,
    ResearchSystem: ResearchSystem.prototype,
    DesignNameState: DesignNameState.prototype,
    DiplomaticRelation: DiplomaticRelation.prototype,
    DiplomaticRelationList: DiplomaticRelationList.prototype,
    YearlyTradeValue: YearlyTradeValue.prototype,
    YearlyTradeValueList: YearlyTradeValueList.prototype,
    PirateRelation: PirateRelation.prototype,
    PirateRelationList: PirateRelationList.prototype,
    ForceStructureProjection: ForceStructureProjection.prototype,
    ForceStructureProjectionList: ForceStructureProjectionList.prototype,
    HabitatPrioritization: HabitatPrioritization.prototype,
    DesignSpecification: DesignSpecification.prototype,
    DesignSpecificationComponentRule: DesignSpecificationComponentRule.prototype,
    BuiltObject: BuiltObject.prototype,
    DockingBay: DockingBay.prototype,
    BuiltObjectComponent: BuiltObjectComponent.prototype,
    BuiltObjectComponentList: BuiltObjectComponentList.prototype,
    Design: Design.prototype,
    Weapon: Weapon.prototype,
    Cargo: Cargo.prototype,
    CargoList: CargoList.prototype,
    ResourceRef: ResourceRef.prototype,
    Troop: Troop.prototype,
    TroopList: TroopList.prototype,
    Character: Character.prototype,
    CharacterSkill: CharacterSkill.prototype,
    CharacterSkillList: CharacterSkillList.prototype,
    CharacterEvent: CharacterEvent.prototype,
    IntelligenceMission: IntelligenceMission.prototype,
    // M4p: BuiltObject.Fighters (FighterList) and their weapons / specifications; the explosions and battle stats (M4o
    // types) that fighters and combat attach to ships.
    Fighter: Fighter.prototype,
    FighterWeapon: FighterWeapon.prototype,
    FighterSpecification: FighterSpecification.prototype,
    Explosion: Explosion.prototype,
    SpaceBattleStats: SpaceBattleStats.prototype,
};

/** Galaxy fields that hold GameData tables (re-wired from gameData on load,
 *  exactly like generateGalaxy / createGame) or derived indexes (rebuilt). */
const GALAXY_STATIC_FIELDS = ['resources', 'researchStatic', 'designSpecificationTexts', 'designNames', 'resourceSystem', 'races', 'characterNames', 'characterFiles', 'raceFamilies'] as const;
const GALAXY_DERIVED_FIELDS = ['stepOrder', 'stepOrderDirty', 'habitatIndexGrid', 'systemsIndexGrid', 'builtObjectIndexGrid', 'galaxyLocationIndex'] as const;

const CODEC_OPTIONS: GraphCodecOptions = {
    classes: CLASSES,
    skipFields: new Map<object, ReadonlySet<string>>([
        [Galaxy.prototype, new Set<string>([...GALAXY_STATIC_FIELDS, ...GALAXY_DERIVED_FIELDS])],
        // VisibilityOwner is a bag of closures over the empire (Empire.visibilityOwner).
        [EmpireVisibility.prototype, new Set<string>(['owner'])],
        // The 2000x2000 ownership grid (8 MB as JSON) is a pure function of the
        // colonies; ReviewEmpireTerritory recomputes it on load (no Rnd use).
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
    return {
        races: gameData.races,
        raceFamilies: gameData.raceFamilies,
        resources: gameData.resources,
        // generateGalaxy's wiring (galaxy.ts): facilities, fighters (Galaxy.FighterSpecificationsStatic, M4p) and plagues too.
        researchStatic: buildResearchStatic(gameData.research, gameData.components, gameData.races, gameData.policies, gameData.piratePolicies, buildComponentStatic(gameData), gameData.facilities, gameData.fighters, gameData.plagues),
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
    }
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
    return { version: 2, galaxy: encoder.encode(galaxy, 'galaxy') };
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
    for (const field of GALAXY_STATIC_FIELDS) g[field] = tables[field];

    // --- Derived indexes (generateGalaxy / updateSystemInfo / generateNebulae
    //     / Empire.addBuiltObject fill these exactly like this).
    g.stepOrder = [];
    g.stepOrderDirty = true; // lazy: step() rebuilds before first use
    galaxy.initIndexGrids();
    for (const sys of galaxy.systems) {
        const cell = galaxy.resolveIndex(sys.systemStar.xpos, sys.systemStar.ypos);
        galaxy.systemsIndexGrid[cell.x][cell.y].push(sys);
        for (const habitat of sys.habitats) {
            const hc = galaxy.resolveIndex(habitat.xpos, habitat.ypos);
            galaxy.habitatIndexGrid[hc.x][hc.y].push(habitat);
        }
    }
    for (const builtObject of galaxy.builtObjects) {
        // BuiltObject.CompleteTeardown nulls its Galaxy.BuiltObjects slot; RemoveNullBuiltObjects compacts later (M4z1).
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

    // --- Visibility owner hooks (closures over the empire; see Empire ctor).
    for (const empire of flatEmpireList(galaxy)) {
        empire.visibility.owner = empire.visibilityOwner(empire === galaxy.independentEmpire);
    }
    // --- Territory grid (Start.2.cs 1485 ReviewEmpireTerritory; needs research + colonies).
    (galaxy.empireTerritory as unknown as { territory: unknown }).territory = null;
    galaxy.empireTerritory.reviewEmpireTerritory(galaxy);
    return galaxy;
}
