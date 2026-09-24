// Port of Galaxy-level static component data: Galaxy.ComponentDefinitionsStatic
// and the derived lookup structures built from it.
//
// C# sources (DistantWorlds.Types):
//   ComponentDefinition.cs        - ResolveComponentCategory, ResolveIndustry
//   ComponentImprovement.cs       - ComponentImprovement, IsPlanetDestroyer
//   Component.cs                  - EvaluateLatest, EvaluateNext
//   Galaxy.3.cs (~2229)           - GenerateOrderedComponentLists
//   Galaxy.3.cs (5735)            - SetHyperDriveSpeeds
//   Galaxy.3.cs (5766)            - SetResearchCosts
//   Galaxy.3.cs (5812)            - GenerateOrderedComponentList(category, valueBase, valueDivisor)
//   Galaxy.3.cs (4868)            - InitializeData (order of operations)
//   Galaxy.4.cs (20-230)          - remaining GenerateOrderedComponentList overloads,
//                                   CheckComponentMatchesCategoryStrict,
//                                   GenerateOrderedComponentImprovementList
//
// Default base tech cost: InitializeResearchNodeDefinitions (Galaxy.3.cs:4662) calls
// SetResearchCosts(120000, ...) unconditionally when loading research.txt, so 120000 is
// the value used unless a caller later re-runs SetResearchCosts/SetHyperDriveSpeeds with a
// different baseTechCost (DistantWorlds/Start.2.cs passes a game-option-derived value,
// double_1, cast to int). We default to 120000 here, matching the value actually baked
// into research node loading.
//
// Default hyperdrive speed multiplier: Start.2.cs passes a game-option double (double_5)
// with no fallback visible in this decompile; we default to 1.0 (no scaling) since that is
// SetHyperDriveSpeeds' identity value.

import { ComponentType, type Component, type ComponentResourceRequirement } from './data/components';
import { ComponentCategoryType } from './data/policies';
import { IndustryType } from './types';
import type { GameData } from './data/gameData';
import type { ResearchNode, ComponentImprovement as ResearchComponentImprovement } from './data/research';
import { netSort } from './netSort';

export const DEFAULT_BASE_TECH_COST = 120000;
export const DEFAULT_HYPERDRIVE_SPEED_MULTIPLIER = 1.0;

// Port of ComponentDefinition.cs: the data Component plus the three fields derived
// from Type (Category, Industry) and from research (TechLevel).
export interface ComponentDefinition extends Component {
    category: ComponentCategoryType;
    industry: IndustryType;
    techLevel: number;
}

// Port of ComponentImprovement.cs, projected onto a ComponentDefinition rather than
// the C# Component/ComponentID indirection.
export interface ComponentImprovementEntry {
    improvedComponent: ComponentDefinition;
    techLevel: number;
    value1: number;
    value2: number;
    value3: number;
    value4: number;
    value5: number;
    value6: number;
    value7: number;
}

export interface ResearchProjectImprovements {
    projectId: number;
    techLevel: number;
    cost: number;
    improvements: ComponentImprovementEntry[];
}

export interface ComponentStatic {
    definitions: ComponentDefinition[];
    byId: Map<number, ComponentDefinition>;
    researchProjects: ResearchProjectImprovements[];
    researchCostByProjectId: Map<number, number>;

    // Port of Galaxy.3.cs GenerateOrderedComponentLists (2229).
    componentsWeaponBeamOrderedByRange: ComponentDefinition[];
    componentsWeaponTorpedoOrderedByRange: ComponentDefinition[];
    componentsWeaponAreaOrderedByRange: ComponentDefinition[];
    componentsWeaponBeamOrderedByPower: ComponentDefinition[];
    componentsWeaponTorpedoOrderedByPower: ComponentDefinition[];
    componentsWeaponAreaOrderedByPower: ComponentDefinition[];
    componentsReactorOrderedByEfficiency: ComponentDefinition[];
    componentsReactorOrderedByPower: ComponentDefinition[];
    componentsEngineMainThrustOrderedByPower: ComponentDefinition[];
    componentsEngineVectoringOrderedByPower: ComponentDefinition[];
    componentsEngineMainThrustOrderedByEfficiency: ComponentDefinition[];
    componentsEngineVectoringOrderedByEfficiency: ComponentDefinition[];
    componentsHyperdriveOrderedByPower: ComponentDefinition[];
    componentsHyperdriveOrderedByEfficiency: ComponentDefinition[];
    componentsHyperdriveOrderedByJumpInitiation: ComponentDefinition[];
}

// ---------------------------------------------------------------------------
// ComponentDefinition.cs: ResolveComponentCategory / ResolveIndustry
// ---------------------------------------------------------------------------

// Port of ComponentDefinition.cs ResolveComponentCategory (271).
export function resolveComponentCategory(componentType: ComponentType): ComponentCategoryType {
    const T = ComponentType;
    const C = ComponentCategoryType;
    switch (componentType) {
        case T.WeaponBeam:
            return C.WeaponBeam;
        case T.WeaponTorpedo:
        case T.WeaponBombard:
        case T.WeaponMissile:
            return C.WeaponTorpedo;
        case T.WeaponPointDefense:
            return C.WeaponPointDefense;
        case T.WeaponIonCannon:
        case T.WeaponIonPulse:
        case T.WeaponIonDefense:
            return C.WeaponIon;
        case T.WeaponTractorBeam:
        case T.WeaponGravityBeam:
        case T.WeaponAreaGravity:
            return C.WeaponGravity;
        case T.AssaultPod:
            return C.AssaultPod;
        case T.HyperDeny:
        case T.HyperStop:
            return C.HyperDisrupt;
        case T.WeaponAreaDestruction:
            return C.WeaponArea;
        case T.WeaponSuperBeam:
        case T.WeaponSuperPhaser:
        case T.WeaponSuperRailGun:
            return C.WeaponSuperBeam;
        case T.WeaponSuperArea:
            return C.WeaponSuperArea;
        case T.FighterBay:
            return C.Fighter;
        case T.Armor:
            return C.Armor;
        case T.Shields:
            return C.Shields;
        case T.ShieldRecharge:
            return C.ShieldRecharge;
        case T.EngineMainThrust:
        case T.EngineVectoring:
            return C.Engine;
        case T.HyperDrive:
            return C.HyperDrive;
        case T.Reactor:
            return C.Reactor;
        case T.EnergyCollector:
            return C.EnergyCollector;
        case T.ExtractorMine:
        case T.ExtractorGasExtractor:
        case T.ExtractorLuxury:
            return C.Extractor;
        case T.ManufacturerWeaponsPlant:
        case T.ManufacturerEnergyPlant:
        case T.ManufacturerHighTechPlant:
            return C.Manufacturer;
        case T.StorageFuel:
        case T.StorageCargo:
        case T.StorageTroop:
        case T.StoragePassenger:
        case T.StorageDockingBay:
            return C.Storage;
        case T.SensorProximityArray:
        case T.SensorResourceProfileSensor:
        case T.SensorLongRange:
        case T.SensorTraceScanner:
        case T.SensorScannerJammer:
        case T.SensorStealth:
            return C.Sensor;
        case T.ComputerTargetting:
        case T.ComputerTargettingFleet:
        case T.ComputerCountermeasures:
        case T.ComputerCountermeasuresFleet:
        case T.ComputerCommandCenter:
        case T.ComputerCommerceCenter:
            return C.Computer;
        case T.LabsWeaponsLab:
        case T.LabsEnergyLab:
        case T.LabsHighTechLab:
            return C.Labs;
        case T.ConstructionBuild:
        case T.DamageControl:
            return C.Construction;
        case T.HabitationLifeSupport:
        case T.HabitationHabModule:
        case T.HabitationMedicalCenter:
        case T.HabitationRecreationCenter:
        case T.HabitationColonization:
            return C.Habitation;
        case T.WeaponPhaser:
        case T.WeaponRailGun:
            return C.WeaponBeam;
        case T.EnergyToFuel:
            return C.EnergyCollector;
        case T.WeaponSuperTorpedo:
        case T.WeaponSuperMissile:
            return C.WeaponSuperTorpedo;
        default:
            throw new Error('Unknown component type.');
    }
}

// Port of ComponentDefinition.cs ResolveIndustry (91).
export function resolveIndustry(category: ComponentCategoryType): IndustryType {
    const C = ComponentCategoryType;
    switch (category) {
        case C.WeaponBeam:
        case C.WeaponTorpedo:
        case C.WeaponArea:
        case C.WeaponPointDefense:
        case C.WeaponIon:
        case C.WeaponGravity:
        case C.Armor:
        case C.AssaultPod:
        case C.Fighter:
        case C.WeaponSuperBeam:
        case C.WeaponSuperArea:
        case C.WeaponSuperTorpedo:
            return IndustryType.Weapon;
        case C.Shields:
        case C.ShieldRecharge:
        case C.Engine:
        case C.HyperDrive:
        case C.HyperDisrupt:
        case C.Reactor:
        case C.EnergyCollector:
        case C.Extractor:
        case C.Manufacturer:
        case C.Construction:
            return IndustryType.Energy;
        case C.Storage:
        case C.Sensor:
        case C.Computer:
        case C.Labs:
        case C.Habitation:
            return IndustryType.HighTech;
        default:
            throw new Error('Unknown component category type.');
    }
}

function copyResourceRequirements(reqs: ComponentResourceRequirement[]): ComponentResourceRequirement[] {
    return reqs.map((r) => ({ ...r }));
}

// Builds ComponentDefinition copies from GameData components, without mutating GameData.
function buildComponentDefinitions(components: Component[]): ComponentDefinition[] {
    return components.map((c) => {
        const category = resolveComponentCategory(c.type);
        const industry = resolveIndustry(category);
        return {
            ...c,
            resourceRequirements: copyResourceRequirements(c.resourceRequirements),
            category,
            industry,
            techLevel: 0,
        };
    });
}

// ---------------------------------------------------------------------------
// Galaxy.3.cs SetResearchCosts (5766)
// ---------------------------------------------------------------------------

function computeResearchCost(node: ResearchNode, baseTechCost: number): number {
    let multiplier = node.techLevel >= 100 ? 256.0 : Math.pow(2.0, node.techLevel - 1.0);
    if (node.baseCostMultiplierOverride > 0.0) {
        multiplier = node.baseCostMultiplierOverride;
    }
    return Math.fround(multiplier * baseTechCost);
}

function copyImprovementEntry(
    ci: ResearchComponentImprovement,
    def: ComponentDefinition,
    techLevel: number,
): ComponentImprovementEntry {
    return {
        improvedComponent: def,
        techLevel,
        value1: ci.value1,
        value2: ci.value2,
        value3: ci.value3,
        value4: ci.value4,
        value5: ci.value5,
        value6: ci.value6,
        value7: ci.value7,
    };
}

// Port of Galaxy.3.cs SetResearchCosts (5766): assigns TechLevel to every component
// referenced by a research node's Components/ComponentImprovements, and computes each
// node's Cost. Returns per-project improvement copies rather than mutating GameData.
function applyResearchCostsAndTechLevels(
    defsById: Map<number, ComponentDefinition>,
    research: ResearchNode[],
    baseTechCost: number,
): ResearchProjectImprovements[] {
    const result: ResearchProjectImprovements[] = [];
    for (const node of research) {
        const cost = computeResearchCost(node, baseTechCost);
        for (const componentId of node.components) {
            const def = defsById.get(componentId);
            if (def) {
                def.techLevel = node.techLevel;
            }
        }
        const improvements = node.componentImprovements
            .map((ci) => {
                const def = defsById.get(ci.componentId);
                if (!def) return null;
                return copyImprovementEntry(ci, def, node.techLevel);
            })
            .filter((x): x is ComponentImprovementEntry => x !== null);
        result.push({ projectId: node.projectId, techLevel: node.techLevel, cost, improvements });
    }
    return result;
}

// ---------------------------------------------------------------------------
// Galaxy.3.cs SetHyperDriveSpeeds (5735)
// ---------------------------------------------------------------------------

// Port of the HyperDrive-scaling portion of SetHyperDriveSpeeds (5735): scales
// Value1 of every HyperDrive-category component definition, and of every
// research-project component improvement targeting a HyperDrive component, by
// `multiplier`, truncating to int as C#'s `(int)` cast does.
export function applyHyperDriveSpeedMultiplier(
    componentStatic: Pick<ComponentStatic, 'definitions' | 'researchProjects'>,
    multiplier: number,
): void {
    for (const def of componentStatic.definitions) {
        if (def.category === ComponentCategoryType.HyperDrive) {
            def.value1 = Math.trunc(def.value1 * multiplier);
        }
    }
    for (const project of componentStatic.researchProjects) {
        for (const improvement of project.improvements) {
            if (improvement.improvedComponent.category === ComponentCategoryType.HyperDrive) {
                improvement.value1 = Math.trunc(improvement.value1 * multiplier);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Galaxy.4.cs CheckComponentMatchesCategoryStrict (143/148)
// ---------------------------------------------------------------------------

export function checkComponentMatchesCategoryStrict(
    componentCategory: ComponentCategoryType,
    componentType: ComponentType,
    category: ComponentCategoryType,
): boolean {
    const T = ComponentType;
    const C = ComponentCategoryType;
    switch (category) {
        case C.WeaponTorpedo:
            switch (componentType) {
                case T.WeaponBombard:
                case T.WeaponMissile:
                    return false;
                case T.WeaponTorpedo:
                    return true;
            }
            break;
        case C.WeaponBeam:
            switch (componentType) {
                case T.WeaponPhaser:
                case T.WeaponRailGun:
                    return false;
                case T.WeaponBeam:
                    return true;
            }
            break;
        default:
            if (componentCategory === category) {
                return true;
            }
            break;
    }
    return false;
}

export function checkComponentDefinitionMatchesCategoryStrict(
    component: ComponentDefinition,
    category: ComponentCategoryType,
): boolean {
    return checkComponentMatchesCategoryStrict(component.category, component.type, category);
}

// ---------------------------------------------------------------------------
// Galaxy.3.cs/Galaxy.4.cs GenerateOrderedComponentList overloads
// ---------------------------------------------------------------------------

// .NET Array.Sort(keys, items) semantics: ascending order by key, unstable
// (introsort). We port this by netSort-ing (key, item) pairs and comparing keys,
// which reproduces the same swap pattern as sorting the two parallel arrays.
function sortPairsAscendingByKey<T>(pairs: [number, T][]): void {
    netSort(pairs, (a, b) => {
        const ak = a[0];
        const bk = b[0];
        // double.CompareTo(double) / int.CompareTo(int) semantics.
        if (ak < bk) return -1;
        if (ak > bk) return 1;
        if (ak === bk) return 0;
        // NaN handling (only reachable for the double-keyed division overloads).
        if (Number.isNaN(ak)) return Number.isNaN(bk) ? 0 : -1;
        return 1;
    });
}

function valueByIndex(def: ComponentDefinition, index: number): number {
    switch (index) {
        case 1: return def.value1;
        case 2: return def.value2;
        case 3: return def.value3;
        case 4: return def.value4;
        case 5: return def.value5;
        case 6: return def.value6;
        default: return 0;
    }
}

// Port of Galaxy.3.cs GenerateOrderedComponentList(ComponentCategoryType, int, int)
// (5812): filters by loose Category equality, key = valueBase/valueDivisor (double
// division), sorted ascending then reversed (always highest-ratio-first before any
// caller-side .Reverse()).
export function generateOrderedComponentListByCategoryRatio(
    definitions: ComponentDefinition[],
    category: ComponentCategoryType,
    valueBase: number,
    valueDivisor: number,
): ComponentDefinition[] {
    const pairs: [number, ComponentDefinition][] = [];
    for (const def of definitions) {
        if (def.category === category) {
            const key = valueByIndex(def, valueBase) / valueByIndex(def, valueDivisor);
            pairs.push([key, def]);
        }
    }
    sortPairsAscendingByKey(pairs);
    return pairs.map((p) => p[1]).reverse();
}

// Port of Galaxy.4.cs GenerateOrderedComponentList(ComponentType, int, int) (20):
// filters by Type equality, key = valueBase/valueDivisor, ascending then reversed.
export function generateOrderedComponentListByTypeRatio(
    definitions: ComponentDefinition[],
    type: ComponentType,
    valueBase: number,
    valueDivisor: number,
): ComponentDefinition[] {
    const pairs: [number, ComponentDefinition][] = [];
    for (const def of definitions) {
        if (def.type === type) {
            const key = valueByIndex(def, valueBase) / valueByIndex(def, valueDivisor);
            pairs.push([key, def]);
        }
    }
    sortPairsAscendingByKey(pairs);
    return pairs.map((p) => p[1]).reverse();
}

// Port of Galaxy.4.cs GenerateOrderedComponentList(ComponentCategoryType, int, bool)
// (98): strict category match, single value key, ascending then reversed iff
// orderHighestToLowest (default true per the (category, valueType) overload at 93).
export function generateOrderedComponentListByCategory(
    definitions: ComponentDefinition[],
    category: ComponentCategoryType,
    valueType: number,
    orderHighestToLowest = true,
): ComponentDefinition[] {
    const pairs: [number, ComponentDefinition][] = [];
    for (const def of definitions) {
        if (checkComponentDefinitionMatchesCategoryStrict(def, category)) {
            pairs.push([valueByIndex(def, valueType), def]);
        }
    }
    sortPairsAscendingByKey(pairs);
    const ordered = pairs.map((p) => p[1]);
    return orderHighestToLowest ? ordered.reverse() : ordered;
}

// Port of Galaxy.4.cs GenerateOrderedComponentList(ComponentType, int) (182): Type
// equality, single value key, ascending then always reversed.
export function generateOrderedComponentListByType(
    definitions: ComponentDefinition[],
    type: ComponentType,
    valueType: number,
): ComponentDefinition[] {
    const pairs: [number, ComponentDefinition][] = [];
    for (const def of definitions) {
        if (def.type === type) {
            pairs.push([valueByIndex(def, valueType), def]);
        }
    }
    sortPairsAscendingByKey(pairs);
    return pairs.map((p) => p[1]).reverse();
}

// Port of Galaxy.4.cs GenerateOrderedComponentImprovementList (87): the strict
// category ordered list (highest to lowest), each wrapped as a ComponentImprovement
// built from the component (ComponentImprovement(Component) ctor semantics).
export function generateOrderedComponentImprovementList(
    definitions: ComponentDefinition[],
    category: ComponentCategoryType,
    valueBase: number,
): ComponentImprovementEntry[] {
    return generateOrderedComponentListByCategory(definitions, category, valueBase, true).map(
        componentImprovementFromComponent,
    );
}

// ---------------------------------------------------------------------------
// ComponentImprovement.cs: ComponentImprovement(Component) ctor / IsPlanetDestroyer
// ---------------------------------------------------------------------------

// Port of ComponentImprovement.cs ComponentImprovement(Component) constructor (24).
export function componentImprovementFromComponent(def: ComponentDefinition): ComponentImprovementEntry {
    return {
        improvedComponent: def,
        techLevel: def.techLevel,
        value1: def.value1,
        value2: def.value2,
        value3: def.value3,
        value4: def.value4,
        value5: def.value5,
        value6: def.value6,
        value7: def.value7,
    };
}

const PLANET_DESTROYER_TYPES = new Set<ComponentType>([
    ComponentType.WeaponSuperBeam,
    ComponentType.WeaponSuperTorpedo,
    ComponentType.WeaponSuperMissile,
    ComponentType.WeaponSuperPhaser,
    ComponentType.WeaponSuperRailGun,
]);

// Port of ComponentImprovement.cs IsPlanetDestroyer (59).
export function isPlanetDestroyer(ci: ComponentImprovementEntry): boolean {
    if (ci.improvedComponent && PLANET_DESTROYER_TYPES.has(ci.improvedComponent.type)) {
        return ci.value1 >= 10000;
    }
    return false;
}

// ---------------------------------------------------------------------------
// Component.cs: EvaluateLatest / EvaluateNext
// ---------------------------------------------------------------------------

// Port of Component.cs EvaluateLatest(ComponentType, double) (59).
export function evaluateLatestByType(
    definitions: ComponentDefinition[],
    componentType: ComponentType,
    techLevel: number,
): ComponentDefinition | null {
    let bestTechLevel = -1;
    let latest: ComponentDefinition | null = null;
    for (const def of definitions) {
        if (def.type === componentType && def.techLevel <= techLevel && def.techLevel > bestTechLevel) {
            latest = def;
            bestTechLevel = def.techLevel;
        }
    }
    return latest;
}

// Port of Component.cs EvaluateLatest(ComponentCategoryType, double) (74).
export function evaluateLatestByCategory(
    definitions: ComponentDefinition[],
    category: ComponentCategoryType,
    techLevel: number,
): ComponentDefinition | null {
    let bestTechLevel = -1;
    let latest: ComponentDefinition | null = null;
    for (const def of definitions) {
        if (
            checkComponentDefinitionMatchesCategoryStrict(def, category) &&
            def.techLevel <= techLevel &&
            def.techLevel > bestTechLevel
        ) {
            latest = def;
            bestTechLevel = def.techLevel;
        }
    }
    return latest;
}

// Port of Component.cs EvaluateNext(ComponentCategoryType, double) (91). Note: uses
// loose Category equality (not CheckComponentMatchesCategoryStrict), exactly as C#.
export function evaluateNextByCategory(
    definitions: ComponentDefinition[],
    category: ComponentCategoryType,
    techLevel: number,
): ComponentDefinition | null {
    let bestTechLevel = Number.MAX_SAFE_INTEGER;
    let next: ComponentDefinition | null = null;
    for (const def of definitions) {
        if (def.category === category && def.techLevel > techLevel && def.techLevel <= bestTechLevel) {
            next = def;
            bestTechLevel = def.techLevel;
        }
    }
    return next;
}

// ---------------------------------------------------------------------------
// buildComponentStatic
// ---------------------------------------------------------------------------

export interface BuildComponentStaticOptions {
    hyperDriveSpeedMultiplier?: number;
    baseTechCost?: number;
}

// Port of the InitializeData (Galaxy.3.cs:4868) / SetHyperDriveSpeeds (Galaxy.3.cs:5735)
// order of operations: build component definitions, assign research tech levels and
// costs, apply the hyperdrive speed multiplier, then build the ordered component lists
// (GenerateOrderedComponentLists, Galaxy.3.cs:2229) from the final (post-multiplier)
// definitions.
export function buildComponentStatic(gameData: GameData, opts: BuildComponentStaticOptions = {}): ComponentStatic {
    const baseTechCost = opts.baseTechCost ?? DEFAULT_BASE_TECH_COST;
    const multiplier = opts.hyperDriveSpeedMultiplier ?? DEFAULT_HYPERDRIVE_SPEED_MULTIPLIER;

    const definitions = buildComponentDefinitions(gameData.components);
    const byId = new Map<number, ComponentDefinition>(definitions.map((d) => [d.componentId, d]));

    const researchProjects = applyResearchCostsAndTechLevels(byId, gameData.research, baseTechCost);
    const researchCostByProjectId = new Map<number, number>(researchProjects.map((p) => [p.projectId, p.cost]));

    const componentStatic: ComponentStatic = {
        definitions,
        byId,
        researchProjects,
        researchCostByProjectId,
        componentsWeaponBeamOrderedByRange: [],
        componentsWeaponTorpedoOrderedByRange: [],
        componentsWeaponAreaOrderedByRange: [],
        componentsWeaponBeamOrderedByPower: [],
        componentsWeaponTorpedoOrderedByPower: [],
        componentsWeaponAreaOrderedByPower: [],
        componentsReactorOrderedByEfficiency: [],
        componentsReactorOrderedByPower: [],
        componentsEngineMainThrustOrderedByPower: [],
        componentsEngineVectoringOrderedByPower: [],
        componentsEngineMainThrustOrderedByEfficiency: [],
        componentsEngineVectoringOrderedByEfficiency: [],
        componentsHyperdriveOrderedByPower: [],
        componentsHyperdriveOrderedByEfficiency: [],
        componentsHyperdriveOrderedByJumpInitiation: [],
    };

    applyHyperDriveSpeedMultiplier(componentStatic, multiplier);

    const C = ComponentCategoryType;
    const T = ComponentType;

    componentStatic.componentsWeaponBeamOrderedByRange = generateOrderedComponentListByCategory(definitions, C.WeaponBeam, 2);
    componentStatic.componentsWeaponTorpedoOrderedByRange = generateOrderedComponentListByCategory(definitions, C.WeaponTorpedo, 2);
    componentStatic.componentsWeaponAreaOrderedByRange = generateOrderedComponentListByType(definitions, T.WeaponAreaDestruction, 2);
    componentStatic.componentsWeaponBeamOrderedByPower = generateOrderedComponentListByCategory(definitions, C.WeaponBeam, 1);
    componentStatic.componentsWeaponTorpedoOrderedByPower = generateOrderedComponentListByCategory(definitions, C.WeaponTorpedo, 1);
    componentStatic.componentsWeaponAreaOrderedByPower = generateOrderedComponentListByType(definitions, T.WeaponAreaDestruction, 1);
    // C#: GenerateOrderedComponentList(Reactor, 3, 2) is already highest-to-lowest
    // (the ratio overload always reverses internally); the extra .Reverse() call in
    // GenerateOrderedComponentLists flips it back to ascending (lowest-efficiency-first).
    componentStatic.componentsReactorOrderedByEfficiency = generateOrderedComponentListByCategoryRatio(definitions, C.Reactor, 3, 2).reverse();
    componentStatic.componentsReactorOrderedByPower = generateOrderedComponentListByCategory(definitions, C.Reactor, 1);
    componentStatic.componentsEngineMainThrustOrderedByPower = generateOrderedComponentListByType(definitions, T.EngineMainThrust, 1);
    componentStatic.componentsEngineVectoringOrderedByPower = generateOrderedComponentListByType(definitions, T.EngineVectoring, 1);
    componentStatic.componentsEngineMainThrustOrderedByEfficiency = generateOrderedComponentListByTypeRatio(definitions, T.EngineMainThrust, 1, 2);
    componentStatic.componentsEngineVectoringOrderedByEfficiency = generateOrderedComponentListByTypeRatio(definitions, T.EngineVectoring, 1, 2);
    componentStatic.componentsHyperdriveOrderedByPower = generateOrderedComponentListByCategory(definitions, C.HyperDrive, 1);
    componentStatic.componentsHyperdriveOrderedByEfficiency = generateOrderedComponentListByCategoryRatio(definitions, C.HyperDrive, 1, 2);
    componentStatic.componentsHyperdriveOrderedByJumpInitiation = generateOrderedComponentListByCategory(definitions, C.HyperDrive, 3, false);

    return componentStatic;
}
