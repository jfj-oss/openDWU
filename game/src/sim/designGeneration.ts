// Empire design generation (task D4). Ports of
//   BaconEmpire.CreateNewDesigns (BaconEmpire.cs 713, via Empire.10.cs 3261)
//   Empire.3.cs ReviewDesignComponentsAvailable (1770)
//   Empire.10.cs CheckDesignComponentsAvailable (1417), CanBuildDesignTech (255),
//     CheckDesignWithinConstructionSize (282), CanBuildDesign (413-450),
//     CheckDesignSubRoleShouldBeUpgraded (3082), ReviewRemoveObsoleteDesignsForSubRole (3266)
//   DesignList.cs FindNewestCanBuild (160) / FindNewestCanBuildFullEvaluate (214)
//   Galaxy.8.cs ResolveLegacySubRole (2232), Galaxy.2.cs ResolveDescription(subRole) (2133)
//   Empire.10.cs GenerateDesignFromSpec (3387), Galaxy.8.cs AddComponentsToDesign (2320),
//     GetPlanetDestroyerComponents (2362), Galaxy.7.cs GeneratePlanetDestroyerDesign (4862),
//     DesignList.cs FindNewestPlanetDestroyer (98), ComponentDefinition.cs GetHighestTechByType (393)
//   ResearchSystem.cs CalculateComponentMinMaxTechPoints (1290) / CalculateMaxTechPoints (1305)
//     / CalculateMinTechPoints (1192) (static ComponentMax/MinTechPoints, 53-54)
// Rnd: GenerateDesignName (designNames.ts) and the pirate PictureRef branch below; the
// placement code only draws in SelectPreferredSuperWeapon.
// TODO(port): LoadOptimizedDesignsForEmpire / ResolveOptimizedDesigns (optimized designs
// are loaded from files C# ships per race; none are loaded, so the list is empty — the
// OptimizedDesign > 0 branch of FindNewestCanBuildFullEvaluate is ported but unreachable),
// minor ship images (ShipImageHelper's own clock-seeded Random), CheckDesignInUse (no
// BuiltObjects yet → never in use).

import { raceAggressionLevel, raceCautionLevel } from './racePeriodic';
import { BuiltObjectSubRole } from './builtObjectTypes';
import { csInt } from './builtObjectComponent';
import { componentImprovementFromComponent, evaluateLatestByCategory, evaluateLatestByType, generateOrderedComponentImprovementList, type ComponentDefinition, type ComponentImprovementEntry } from './componentStatic';
import { ComponentType } from './data/components';
import type { ResearchNode as ResearchNodeDefinition } from './data/research';
import { BattleTactics, BuiltObjectFleeWhen, BuiltObjectRole, InvasionTactics, type DesignSpecification } from './data/designSpecifications';
import { ComponentCategoryType, resolveTechFocuses } from './data/policies';
import { designLineOwnsSubRole } from './player/designLineUpgrade';
import { Design, BuiltObjectStance, determineHabModulesRequired, determineLifeSupportRequired, findNewest } from './design';
import { generateDesignName, type PreviousDesignForNaming } from './designNames';
import { placeComponentsOnDesignSized, placeComponentsOnDesignWithTech, selectPreferredSuperWeapon, type DesignPlacementEmpire } from './designPlacement';
import { Empire, raceDesignPictureFamilyIndexPirates } from './empire';
import type { Galaxy } from './galaxy';
import { ShipDesignFocus, type ResearchStatic, type ResearchSystem } from './researchSystem';
import type { Habitat } from './types';
import { scenarioQuery } from './scenario/hooks';

// Galaxy.3.cs 5021 / 5138.
const MINIMUM_DESIGN_REVIEW_INTERVAL_YEARS = 0.5;
const REAL_SECONDS_IN_GALACTIC_YEAR = 600;
// ShipImageHelper.cs 25 / 43.
const SHIP_SET_IMAGE_COUNT = 24;
const STANDARD_SHIP_IMAGE_START_INDEX = 72;

// Galaxy.2.cs ResolveDescription(BuiltObjectSubRole) — GameText.txt "Ship SubRole *" values.
const SUBROLE_DESCRIPTION: Partial<Record<BuiltObjectSubRole, string>> = {
    [BuiltObjectSubRole.Carrier]: 'Carrier',
    [BuiltObjectSubRole.CapitalShip]: 'Capital Ship',
    [BuiltObjectSubRole.ColonyShip]: 'Colony Ship',
    [BuiltObjectSubRole.ConstructionShip]: 'Construction Ship',
    [BuiltObjectSubRole.Cruiser]: 'Cruiser',
    [BuiltObjectSubRole.DefensiveBase]: 'Defensive Base',
    [BuiltObjectSubRole.Destroyer]: 'Destroyer',
    [BuiltObjectSubRole.EnergyResearchStation]: 'Energy Research Station',
    [BuiltObjectSubRole.Escort]: 'Escort',
    [BuiltObjectSubRole.ExplorationShip]: 'Exploration Ship',
    [BuiltObjectSubRole.Frigate]: 'Frigate',
    [BuiltObjectSubRole.GasMiningShip]: 'Gas Mining Ship',
    [BuiltObjectSubRole.GasMiningStation]: 'Gas Mining Station',
    [BuiltObjectSubRole.GenericBase]: 'Star Base',
    [BuiltObjectSubRole.HighTechResearchStation]: 'HighTech Research Station',
    [BuiltObjectSubRole.LargeFreighter]: 'Large Freighter',
    [BuiltObjectSubRole.LargeSpacePort]: 'Large Space Port',
    [BuiltObjectSubRole.MediumFreighter]: 'Medium Freighter',
    [BuiltObjectSubRole.MediumSpacePort]: 'Medium Space Port',
    [BuiltObjectSubRole.MiningShip]: 'Mining Ship',
    [BuiltObjectSubRole.MiningStation]: 'Mining Station',
    [BuiltObjectSubRole.MonitoringStation]: 'Monitoring Station',
    [BuiltObjectSubRole.PassengerShip]: 'Passenger Ship',
    [BuiltObjectSubRole.ResortBase]: 'Resort Base',
    [BuiltObjectSubRole.ResupplyShip]: 'Resupply Ship',
    [BuiltObjectSubRole.SmallFreighter]: 'Small Freighter',
    [BuiltObjectSubRole.SmallSpacePort]: 'Small Space Port',
    [BuiltObjectSubRole.TroopTransport]: 'Troop Transport',
    [BuiltObjectSubRole.WeaponsResearchStation]: 'Weapons Research Station',
    [BuiltObjectSubRole.Undefined]: 'None',
};
export function resolveSubRoleDescription(subRole: BuiltObjectSubRole): string {
    return SUBROLE_DESCRIPTION[subRole] ?? BuiltObjectSubRole[subRole];
}

// Galaxy.8.cs ResolveLegacySubRole.
export function resolveLegacySubRole(subRole: BuiltObjectSubRole): BuiltObjectSubRole {
    switch (subRole) {
        case BuiltObjectSubRole.EnergyResearchStation:
        case BuiltObjectSubRole.WeaponsResearchStation:
        case BuiltObjectSubRole.HighTechResearchStation:
        case BuiltObjectSubRole.MonitoringStation:
            return BuiltObjectSubRole.GenericBase;
        case BuiltObjectSubRole.DefensiveBase:
            return BuiltObjectSubRole.MediumSpacePort;
        default:
            return subRole;
    }
}

function standardPictureRef(family: number, subRole: BuiltObjectSubRole): number {
    return STANDARD_SHIP_IMAGE_START_INDEX + family * SHIP_SET_IMAGE_COUNT + (resolveLegacySubRole(subRole) - 1);
}

/** The DesignPlacementEmpire view of an Empire (Race fields renamed to the C# names). */
export function placementView(empire: Empire, galaxy: Galaxy): DesignPlacementEmpire {
    const race = empire.dominantRace;
    return {
        research: empire.research,
        policy: empire.policy,
        dominantRace: race === null ? null : { aggressionLevel: raceAggressionLevel(galaxy, race), intelligenceLevel: race.intelligence }, // Race.AggressionLevel (periodic)
        componentDefinitions: galaxy.researchStatic?.componentStatic?.definitions ?? [],
        hasHyperDriveTech: empire.hasHyperDriveTech,
        maximumConstructionSize: (s) => empire.maximumConstructionSize(s),
        maximumConstructionSizeBase: (s) => empire.maximumConstructionSizeBase(s),
        isPirate: empire.pirateEmpireBaseHabitat !== null,
        rnd: galaxy.rnd,
    };
}

// Empire.10.cs CheckDesignComponentsAvailable (1417).
export function checkDesignComponentsAvailable(empire: Empire, role: BuiltObjectRole, subRole: BuiltObjectSubRole): boolean {
    const T = ComponentType;
    const C = ComponentCategoryType;
    const R = BuiltObjectRole;
    const S = BuiltObjectSubRole;
    const researched = empire.research.researchedComponents;
    const list: ComponentType[] = [T.ComputerCommandCenter, T.StorageFuel, T.HabitationLifeSupport, T.HabitationHabModule];
    const list2: ComponentCategoryType[] = [C.Reactor];
    switch (role) {
        case R.Military:
        case R.Exploration:
        case R.Freight:
        case R.Passenger:
        case R.Colony:
        case R.Build:
        case R.Resource:
            list.push(T.EngineMainThrust, T.EngineVectoring);
            break;
        case R.Base:
            list.push(T.StorageDockingBay);
            break;
    }
    switch (role) {
        case R.Build:
            list.push(T.StorageDockingBay, T.StorageCargo, T.ConstructionBuild, T.ManufacturerEnergyPlant, T.ManufacturerHighTechPlant, T.ManufacturerWeaponsPlant);
            break;
        case R.Colony:
            list.push(T.HabitationColonization);
            break;
        case R.Exploration:
            list.push(T.SensorResourceProfileSensor);
            break;
        case R.Passenger:
            list.push(T.StoragePassenger);
            break;
        case R.Freight:
            list.push(T.StorageCargo);
            break;
        case R.Resource:
            list.push(T.StorageCargo);
            list2.push(C.Extractor);
            break;
    }
    switch (subRole) {
        case S.TroopTransport:
            list.push(T.StorageTroop);
            break;
        case S.Carrier:
            list.push(T.FighterBay);
            break;
        case S.ResupplyShip:
            list.push(T.ExtractorGasExtractor, T.StorageCargo, T.StorageDockingBay);
            break;
        case S.GasMiningStation:
            list.push(T.ExtractorGasExtractor, T.ComputerCommerceCenter, T.StorageCargo);
            break;
        case S.MiningStation:
            list.push(T.ExtractorMine, T.ComputerCommerceCenter, T.StorageCargo);
            break;
        case S.SmallSpacePort:
        case S.MediumSpacePort:
        case S.LargeSpacePort:
            list.push(T.ComputerCommerceCenter, T.ConstructionBuild, T.ManufacturerEnergyPlant, T.ManufacturerHighTechPlant, T.ManufacturerWeaponsPlant);
            break;
        case S.EnergyResearchStation:
            list.push(T.LabsEnergyLab);
            break;
        case S.WeaponsResearchStation:
            list.push(T.LabsWeaponsLab);
            break;
        case S.HighTechResearchStation:
            list.push(T.LabsHighTechLab);
            break;
        case S.MonitoringStation:
            list.push(T.SensorLongRange);
            break;
        case S.ResortBase:
            list.push(T.ComputerCommerceCenter, T.HabitationRecreationCenter);
            break;
        case S.GenericBase:
            list.push(T.StorageCargo);
            break;
    }
    for (const cat of list2) if (!researched.some((c) => c.category === cat)) return false;
    for (const type of list) if (!researched.some((c) => c.type === type)) return false;
    switch (subRole) {
        case S.Escort:
        case S.Frigate:
        case S.Destroyer:
        case S.Cruiser:
        case S.CapitalShip:
        case S.DefensiveBase:
            if (
                !researched.some(
                    (c) =>
                        c.category === C.WeaponBeam ||
                        c.category === C.WeaponTorpedo ||
                        c.category === C.WeaponArea ||
                        c.category === C.WeaponIon ||
                        c.category === C.WeaponSuperArea ||
                        c.category === C.WeaponSuperBeam ||
                        c.category === C.WeaponSuperTorpedo ||
                        c.type === T.WeaponAreaGravity ||
                        c.type === T.WeaponGravityBeam,
                )
            )
                return false;
            break;
    }
    return true;
}

// Empire.3.cs ReviewDesignComponentsAvailable (1770): order of the C# checks.
const COMPONENTS_AVAILABLE_ORDER: [BuiltObjectRole, BuiltObjectSubRole][] = (() => {
    const R = BuiltObjectRole;
    const S = BuiltObjectSubRole;
    return [
        [R.Military, S.CapitalShip], [R.Military, S.Carrier], [R.Colony, S.ColonyShip], [R.Build, S.ConstructionShip],
        [R.Military, S.Cruiser], [R.Base, S.DefensiveBase], [R.Military, S.Destroyer], [R.Base, S.EnergyResearchStation],
        [R.Military, S.Escort], [R.Exploration, S.ExplorationShip], [R.Military, S.Frigate], [R.Resource, S.GasMiningShip],
        [R.Base, S.GasMiningStation], [R.Base, S.GenericBase], [R.Base, S.HighTechResearchStation], [R.Freight, S.LargeFreighter],
        [R.Base, S.LargeSpacePort], [R.Freight, S.MediumFreighter], [R.Base, S.MediumSpacePort], [R.Resource, S.MiningShip],
        [R.Base, S.MiningStation], [R.Base, S.MonitoringStation], [R.Passenger, S.PassengerShip], [R.Base, S.ResortBase],
        [R.Military, S.ResupplyShip], [R.Freight, S.SmallFreighter], [R.Base, S.SmallSpacePort], [R.Military, S.TroopTransport],
        [R.Base, S.WeaponsResearchStation],
    ] as [BuiltObjectRole, BuiltObjectSubRole][];
})();
export function reviewDesignComponentsAvailable(empire: Empire): void {
    for (const [role, subRole] of COMPONENTS_AVAILABLE_ORDER) {
        if (!empire.componentsAvailable[subRole]) empire.componentsAvailable[subRole] = checkDesignComponentsAvailable(empire, role, subRole);
    }
}

// Empire.10.cs CanBuildDesignTech (255).
export function canBuildDesignTech(empire: Empire, design: Design): boolean {
    const seen = new Set<number>();
    for (const c of design.components) {
        if (seen.has(c.componentId)) continue; // GetDistinctComponentList
        seen.add(c.componentId);
        if (!empire.research.checkComponentResearched(c)) return false;
    }
    if (design.subRole === BuiltObjectSubRole.Carrier) return empire.canBuildCarriers;
    if (design.subRole === BuiltObjectSubRole.ResupplyShip) return empire.canBuildResupplyShips;
    return true;
}

// Empire.10.cs CheckDesignWithinConstructionSize(design, colony) (282).
export function checkDesignWithinConstructionSize(empire: Empire, design: Design, colony: Habitat | null): boolean {
    const S = BuiltObjectSubRole;
    let num = 0;
    if (design.role === BuiltObjectRole.Base) {
        const unlimitedBase =
            design.subRole !== S.GasMiningStation &&
            design.subRole !== S.GenericBase &&
            design.subRole !== S.MiningStation &&
            design.subRole !== S.EnergyResearchStation &&
            design.subRole !== S.WeaponsResearchStation &&
            design.subRole !== S.HighTechResearchStation &&
            design.subRole !== S.MonitoringStation &&
            design.subRole !== S.DefensiveBase &&
            design.subRole !== S.ResortBase;
        if (unlimitedBase) num = 2147483647;
        else num = colony === null || colony.empire !== empire || colony.population.totalAmount <= 0 ? empire.maximumConstructionSizeBase(design.subRole) : 2147483647;
    } else if (design.isPlanetDestroyer) {
        num = empire.maximumConstructionSizeBase();
    } else {
        num = empire.maximumConstructionSize(design.subRole);
        if (design.subRole === S.ColonyShip || design.subRole === S.ConstructionShip || design.subRole === S.ResupplyShip) num = empire.maximumConstructionSizeBase(design.subRole);
    }
    return !(design.size > num);
}

// Empire.10.cs CanBuildDesign(design, includeSizeCheck, colony) (430).
export function canBuildDesign(empire: Empire, design: Design, includeSizeCheck = true, colony: Habitat | null = null): boolean {
    if (!canBuildDesignTech(empire, design)) return false;
    if (includeSizeCheck && !checkDesignWithinConstructionSize(empire, design, colony)) return false;
    return true;
}

/**
 * DesignList.cs 375 / 388 GetBuildableDesignsBySubRoles(subRoles, empire[, colony]): non-obsolete designs of the
 * sub-roles that empire.CanBuildDesign(design, true, colony) (colony null for the two-argument overload). No Rnd.
 */
export function getBuildableDesignsBySubRoles(designs: readonly Design[], subRoles: readonly BuiltObjectSubRole[], empire: Empire, colony: Habitat | null = null): Design[] {
    const result: Design[] = [];
    for (const design of designs) {
        if (subRoles.includes(design.subRole) && !design.isObsolete && canBuildDesign(empire, design, true, colony)) result.push(design);
    }
    return result;
}

// --- ResearchSystem static tech points -------------------------------------------------
// ResearchSystem.cs static int[] ComponentMaxTechPoints / ComponentMinTechPoints (53-54),
// filled once by CalculateComponentMinMaxTechPoints(baseTechCost, ResearchNodeDefinitionsStatic)
// from Galaxy.SetResearchComponentMaxTechPoints (Galaxy.3.cs 1927), which the Galaxy ctor
// calls (Galaxy.4.cs 2136) right after SetResearchRaceSpecialProjects (so AllowedRaces is the
// ResearchStatic.allowedRaces map). The TS port computes it lazily per ResearchStatic (pure,
// no Rnd) from galaxy.baseTechCost — the Galaxy ctor's (int)baseTechCost (Start.2.cs 489 / Galaxy.4.cs
// 2136), the same value componentStatic.ts bakes into this ResearchStatic's research costs.

export interface ComponentTechPoints {
    max: number[];
    min: number[];
}

const allowedRacesCount = (allowedRaces: Map<number, Set<string>>, node: ResearchNodeDefinition): number => allowedRaces.get(node.projectId)?.size ?? 0;

// ResearchSystem.cs CalculateMaxTechPoints(component, baseTechCost, techTree) (1305).
export function calculateMaxTechPoints(componentId: number, baseTechCost: number, techTree: ResearchNodeDefinition[], allowedRaces: Map<number, Set<string>>): number {
    let num1 = 0;
    let flag = false;
    let val1 = 0;
    for (let index1 = 0; index1 < techTree.length; ++index1) {
        if (techTree[index1].techLevel < 100) val1 = Math.max(val1, techTree[index1].techLevel);
        if (techTree[index1].components != null && techTree[index1].components.length > 0) {
            for (let index2 = 0; index2 < techTree[index1].components.length; ++index2) {
                if (techTree[index1].components[index2] === componentId && techTree[index1].techLevel > num1) {
                    num1 = techTree[index1].techLevel;
                    flag = false;
                    if (allowedRacesCount(allowedRaces, techTree[index1]) > 0) flag = true;
                }
            }
        }
        if (techTree[index1].componentImprovements != null && techTree[index1].componentImprovements.length > 0) {
            for (let index3 = 0; index3 < techTree[index1].componentImprovements.length; ++index3) {
                if (techTree[index1].componentImprovements[index3].componentId === componentId && techTree[index1].techLevel > num1) {
                    num1 = techTree[index1].techLevel;
                    flag = false;
                    if (allowedRacesCount(allowedRaces, techTree[index1]) > 0) flag = true;
                }
            }
        }
    }
    if (num1 >= 100) num1 = val1 + 1;
    let maxTechPoints = 0.0;
    for (let index = num1; index > 0; --index) {
        const num2 = Math.pow(2.0, index - 1);
        maxTechPoints += num2 * baseTechCost;
    }
    if (flag) ++maxTechPoints;
    return csInt(maxTechPoints);
}

// ResearchSystem.cs CalculateMinTechPoints(component, baseTechCost, techTree) (1192).
export function calculateMinTechPoints(componentId: number, baseTechCost: number, techTree: ResearchNodeDefinition[], allowedRaces: Map<number, Set<string>>): number {
    let num1 = 100;
    let flag = false;
    let val1 = 0;
    for (let index1 = 0; index1 < techTree.length; ++index1) {
        if (techTree[index1].techLevel < 100) val1 = Math.max(val1, techTree[index1].techLevel);
        if (techTree[index1].components != null && techTree[index1].components.length > 0) {
            for (let index2 = 0; index2 < techTree[index1].components.length; ++index2) {
                if (techTree[index1].components[index2] === componentId && techTree[index1].techLevel < num1) {
                    num1 = techTree[index1].techLevel;
                    flag = false;
                    if (allowedRacesCount(allowedRaces, techTree[index1]) > 0) flag = true;
                }
            }
        }
        if (techTree[index1].componentImprovements != null && techTree[index1].componentImprovements.length > 0) {
            for (let index3 = 0; index3 < techTree[index1].componentImprovements.length; ++index3) {
                if (techTree[index1].componentImprovements[index3].componentId === componentId && techTree[index1].techLevel < num1) {
                    num1 = techTree[index1].techLevel;
                    flag = false;
                    if (allowedRacesCount(allowedRaces, techTree[index1]) > 0) flag = true;
                }
            }
        }
    }
    if (num1 >= 100) num1 = val1 + 1;
    let minTechPoints = 0.0;
    for (let index = num1; index > 0; --index) {
        const num2 = Math.pow(2.0, index - 1);
        minTechPoints += num2 * baseTechCost;
    }
    if (flag) ++minTechPoints;
    return csInt(minTechPoints);
}

// ResearchSystem.cs CalculateComponentMinMaxTechPoints(baseTechCost, techTree) (1290):
// arrays sized Galaxy.ComponentDefinitionsStatic.Length, indexed by ComponentID.
export function calculateComponentMinMaxTechPoints(baseTechCost: number, techTree: ResearchNodeDefinition[], allowedRaces: Map<number, Set<string>>, componentCount: number): ComponentTechPoints {
    const max = new Array<number>(componentCount).fill(0);
    const min = new Array<number>(componentCount).fill(0);
    for (let componentID = 0; componentID < componentCount; ++componentID) {
        max[componentID] = calculateMaxTechPoints(componentID, baseTechCost, techTree, allowedRaces);
        min[componentID] = calculateMinTechPoints(componentID, baseTechCost, techTree, allowedRaces);
    }
    return { max, min };
}

const techPointsCache = new WeakMap<ResearchStatic, ComponentTechPoints>();
const EMPTY_TECH_POINTS: ComponentTechPoints = { max: [], min: [] };

/** ResearchSystem.ComponentMaxTechPoints / ComponentMinTechPoints for this galaxy's static research data. */
export function researchComponentTechPoints(galaxy: Galaxy): ComponentTechPoints {
    const stat = galaxy.researchStatic;
    if (stat === null) return EMPTY_TECH_POINTS; // no game data: C# always has the statics
    let tp = techPointsCache.get(stat);
    if (tp === undefined) {
        const componentCount = stat.componentStatic?.definitions.length ?? stat.componentsById.size;
        tp = calculateComponentMinMaxTechPoints(galaxy.baseTechCost, stat.definitions, stat.allowedRaces, componentCount);
        techPointsCache.set(stat, tp);
    }
    return tp;
}
export const researchComponentMaxTechPoints = (galaxy: Galaxy): number[] => researchComponentTechPoints(galaxy).max;

// Design.CalculateTechLevel(design.Empire, design.Empire.Galaxy) as DesignList.cs calls it
// (guarded by `Empire != null && Empire.Galaxy != null`, else 0.0).
function designTechLevelForOwner(design: Design): number {
    const owner = design.empire as Empire | null;
    if (owner !== null && owner.galaxy != null) {
        return design.calculateTechLevel(owner, researchComponentMaxTechPoints(owner.galaxy));
    }
    return 0.0;
}

// DesignList.cs FindNewestCanBuildFullEvaluate(subRole, colony, out, out, includePlanetDestroyers) (240).
export function findNewestCanBuildFullEvaluate(designs: Design[], subRole: BuiltObjectSubRole, colony: Habitat | null, includePlanetDestroyers = true): Design | null {
    let num1 = 0;
    let num2 = 0.0;
    let design1: Design | null = null;
    let num3 = 0.0;
    let design2: Design | null = null;
    for (let index = 0; index < designs.length; ++index) {
        const design3 = designs[index];
        const owner = design3 != null ? (design3.empire as Empire | null) : null;
        if (design3 != null && design3.subRole === subRole && !design3.isObsolete && (design3.dateCreated > num1 || design3.optimizedDesign > 0) && owner !== null && canBuildDesign(owner, design3, true, colony) && (includePlanetDestroyers || !design3.isPlanetDestroyer)) {
            if (design3.optimizedDesign > 0) {
                const num4 = designTechLevelForOwner(design3);
                if (num4 > num2) {
                    num2 = num4;
                    design1 = design3;
                }
            } else {
                num1 = design3.dateCreated;
                const num5 = designTechLevelForOwner(design3);
                num3 = num5;
                design2 = design3;
            }
        }
    }
    let buildFullEvaluate = design2;
    if (design1 !== null && design2 !== design1 && num3 / num2 < 1.5) buildFullEvaluate = design1;
    return buildFullEvaluate;
}

// DesignList.cs FindNewestCanBuild(subRole, empire, colony, includePlanetDestroyers) (160).
export function findNewestCanBuild(designs: Design[], subRole: BuiltObjectSubRole, empire: Empire | null, colony: Habitat | null = null, includePlanetDestroyers = false): Design | null {
    let design: Design | null = null;
    if (designs.length > 0 && empire !== null) {
        design = (empire.latestDesigns[subRole] as Design | null) ?? null;
        if (design !== null && !checkDesignWithinConstructionSize(empire, design, colony)) design = null;
        if (subRole === BuiltObjectSubRole.Carrier && !empire.canBuildCarriers) design = null;
        else if (subRole === BuiltObjectSubRole.ResupplyShip && !empire.canBuildResupplyShips) design = null;
        if (!includePlanetDestroyers && design !== null && design.isPlanetDestroyer) design = null;
    }
    if (design === null) design = findNewestCanBuildFullEvaluate(designs, subRole, colony);
    return design;
}

// Empire.10.cs CheckDesignSubRoleShouldBeUpgraded (3082).
export function checkDesignSubRoleShouldBeUpgraded(empire: Empire, subRole: BuiltObjectSubRole): boolean {
    const p = empire.policy;
    if (p === null) return true;
    const S = BuiltObjectSubRole;
    switch (subRole) {
        case S.Escort: return p.designUpgradeEscort;
        case S.Frigate: return p.designUpgradeFrigate;
        case S.Destroyer: return p.designUpgradeDestroyer;
        case S.Cruiser: return p.designUpgradeCruiser;
        case S.CapitalShip: return p.designUpgradeCapitalShip;
        case S.TroopTransport: return p.designUpgradeTroopTransport;
        case S.Carrier: return p.designUpgradeCarrier;
        case S.ResupplyShip: return p.designUpgradeResupplyShip;
        case S.ExplorationShip: return p.designUpgradeExplorationShip;
        case S.ColonyShip: return p.designUpgradeColonyShip;
        case S.ConstructionShip: return p.designUpgradeConstructionShip;
        case S.SmallSpacePort: return p.designUpgradeSmallSpacePort;
        case S.MediumSpacePort: return p.designUpgradeMediumSpacePort;
        case S.LargeSpacePort: return p.designUpgradeLargeSpacePort;
        case S.ResortBase: return p.designUpgradeResortBase;
        case S.GenericBase: return p.designUpgradeGenericBase;
        case S.EnergyResearchStation: return p.designUpgradeEnergyResearchStation;
        case S.WeaponsResearchStation: return p.designUpgradeWeaponsResearchStation;
        case S.HighTechResearchStation: return p.designUpgradeHighTechResearchStation;
        case S.MonitoringStation: return p.designUpgradeMonitoringStation;
        case S.DefensiveBase: return p.designUpgradeDefensiveBase;
        case S.SmallFreighter: return p.designUpgradeSmallFreighter;
        case S.MediumFreighter: return p.designUpgradeMediumFreighter;
        case S.LargeFreighter: return p.designUpgradeLargeFreighter;
        case S.PassengerShip: return p.designUpgradePassengerShip;
        case S.GasMiningShip: return p.designUpgradeGasMiningShip;
        case S.MiningShip: return p.designUpgradeMiningShip;
        case S.GasMiningStation: return p.designUpgradeGasMiningStation;
        case S.MiningStation: return p.designUpgradeMiningStation;
        default: return true;
    }
}

// Empire.10.cs ReviewRemoveObsoleteDesignsForSubRole (3266): marks the sub-role's designs obsolete and removes those
// no live ship uses (CheckDesignInUse). The base sub-roles' `_ = Capital` (3287-3293) is a no-op read.
export function reviewRemoveObsoleteDesignsForSubRole(empire: Empire, subRole: BuiltObjectSubRole, designToExclude: Design | null, removeManualDesigns: boolean): void {
    const remove: Design[] = [];
    for (const d of empire.designs as Design[]) {
        if (d == null || d.subRole !== subRole || (designToExclude !== null && d === designToExclude)) continue;
        const manual = d.isManuallyCreated && d.optimizedDesign === 0;
        if (removeManualDesigns || !manual) {
            d.isObsolete = true;
            if (!checkDesignInUse(empire, d)) remove.push(d);
        }
    }
    for (const d of remove) {
        const i = (empire.designs as Design[]).indexOf(d);
        if (i >= 0) empire.designs.splice(i, 1);
    }
}

// Empire.10.cs CheckDesignInUse (3307): a live (not destroyed) state or private ship built to, or retrofitting to, the design.
export function checkDesignInUse(empire: Empire, design: Design): boolean {
    for (const list of [empire.builtObjects, empire.privateBuiltObjects]) {
        for (let i = 0; i < list.length; i++) {
            const builtObject = list[i];
            if (builtObject != null && !builtObject.hasBeenDestroyed && (builtObject.design === design || builtObject.retrofitDesign === design)) return true;
        }
    }
    return false;
}

function applySubRoleBehaviour(empire: Empire, design: Design, spec: DesignSpecification, fleeWhen6: BuiltObjectFleeWhen, militaryFleeWhen: BuiltObjectFleeWhen): void {
    const S = BuiltObjectSubRole;
    const set = (stance: BuiltObjectStance, flee: BuiltObjectFleeWhen, stronger: BattleTactics, weaker: BattleTactics, invasion: InvasionTactics) => {
        design.stance = stance;
        design.fleeWhen = flee;
        design.tacticsStrongerShips = stronger;
        design.tacticsWeakerShips = weaker;
        design.tacticsInvasion = invasion;
    };
    const B = BattleTactics;
    const I = InvasionTactics;
    const F = BuiltObjectFleeWhen;
    const St = BuiltObjectStance;
    switch (spec.subRole) {
        case S.Escort:
        case S.Frigate:
        case S.Destroyer:
        case S.Cruiser:
        case S.CapitalShip:
            set(St.AttackEnemies, militaryFleeWhen, B.Standoff, B.AllWeapons, I.InvadeWhenClear);
            break;
        case S.TroopTransport:
            set(St.AttackEnemies, fleeWhen6, B.Evade, B.AllWeapons, I.InvadeImmediately);
            break;
        case S.Carrier:
            set(St.AttackEnemies, fleeWhen6, B.Evade, B.AllWeapons, I.InvadeWhenClear);
            break;
        case S.ResupplyShip:
            set(St.AttackEnemies, fleeWhen6, B.Evade, B.AllWeapons, I.DoNotInvade);
            break;
        case S.ExplorationShip:
            set(St.AttackIfAttacked, F.EnemyMilitarySighted, B.Evade, B.Evade, I.DoNotInvade);
            break;
        case S.SmallFreighter:
        case S.MediumFreighter:
        case S.LargeFreighter:
            set(design.firepowerRaw > 0 ? St.AttackIfAttacked : St.DoNotAttack, F.EnemyMilitarySighted, B.Evade, B.Evade, I.DoNotInvade);
            break;
        case S.ColonyShip:
        case S.PassengerShip:
        case S.ConstructionShip:
        case S.GasMiningShip:
        case S.MiningShip:
            set(St.DoNotAttack, F.EnemyMilitarySighted, B.Evade, B.Evade, I.DoNotInvade);
            break;
        case S.GasMiningStation:
        case S.MiningStation:
            set(St.AttackIfAttacked, F.Never, B.PointBlank, B.PointBlank, I.DoNotInvade);
            break;
        case S.SmallSpacePort:
        case S.MediumSpacePort:
        case S.LargeSpacePort:
        case S.ResortBase:
        case S.GenericBase:
        case S.EnergyResearchStation:
        case S.WeaponsResearchStation:
        case S.HighTechResearchStation:
        case S.MonitoringStation:
        case S.DefensiveBase:
            set(St.AttackEnemies, F.Never, B.PointBlank, B.PointBlank, I.DoNotInvade);
            break;
        default:
            set(St.DoNotAttack, F.Attacked, B.Standoff, B.AllWeapons, I.DoNotInvade);
            break;
    }
    if (spec.tacticsStronger !== 0) design.tacticsStrongerShips = spec.tacticsStronger;
    if (spec.tacticsWeaker !== 0) design.tacticsWeakerShips = spec.tacticsWeaker;
    if (spec.tacticsInvasion !== 0) design.tacticsInvasion = spec.tacticsInvasion;
    if (spec.fleeWhen !== 0) design.fleeWhen = spec.fleeWhen;
    void empire;
}

// BaconEmpire.CreateNewDesigns(empire, designDate, forceUpdate, designRoleToChange = -1).
// `currentStarDate` = Galaxy.CurrentStarDate (not tracked on the TS Galaxy yet).
export function createNewDesigns(galaxy: Galaxy, empire: Empire, designDate: number, currentStarDate: number, forceUpdate = false, designRoleToChange = -1): void {
    let num1 = 0;
    let num2 = empire.designSpecifications.length;
    if (designRoleToChange > -1) {
        num1 = designRoleToChange;
        num2 = designRoleToChange + 1;
    }
    let num3 = Math.trunc(MINIMUM_DESIGN_REVIEW_INTERVAL_YEARS * REAL_SECONDS_IN_GALACTIC_YEAR * 1000.0);
    if (!empire.initiateConstruction || forceUpdate) num3 = 0;
    empire.research.update(empire.dominantRace);
    reviewDesignComponentsAvailable(empire);
    const militaryFleeWhen = empire.policy?.defaultMilitaryFleeWhen ?? BuiltObjectFleeWhen.Shields20;
    const race = empire.dominantRace!;
    let fleeWhen6 = BuiltObjectFleeWhen.Shields50;
    if (raceCautionLevel(galaxy, race) < 80) fleeWhen6 = BuiltObjectFleeWhen.Shields20; // Race.CautionLevel (periodic)
    const view = placementView(empire, galaxy);
    // BaconEmpire.cs 748: Galaxy.GenerateOrderedComponentImprovementList(WeaponTorpedo, 1), built once per review.
    const componentImprovementList = generateOrderedComponentImprovementList(componentDefinitionsStatic(galaxy), ComponentCategoryType.WeaponTorpedo, 1);
    const designs = empire.designs as Design[];
    // DesignList source1 = empire.Designs.ResolveOptimizedDesigns(): always empty (see header).
    for (let index1 = num1; index1 < num2; ++index1) {
        const spec = empire.designSpecifications[index1]!;
        if (!empire.componentsAvailable[spec.subRole]) continue;
        let flag1 = true;
        if (spec.subRole === BuiltObjectSubRole.Carrier && !empire.canBuildCarriers) flag1 = false;
        else if (spec.subRole === BuiltObjectSubRole.ResupplyShip && !empire.canBuildResupplyShips) flag1 = false;
        if (!flag1 || !checkDesignSubRoleShouldBeUpgraded(empire, spec.subRole)) continue;
        let design1 = empire.pirateEmpireBaseHabitat === null ? findNewestCanBuild(designs, spec.subRole, empire, empire.capital, false) : findNewestCanBuild(designs, spec.subRole, null, null, false);
        const design2: Design | null = null; // optimized-design candidate (none)
        let num5 = 0;
        if (design1 !== null && !design1.isObsolete) {
            num5 = design1.dateCreated + num3;
            empire.latestDesigns[design1.subRole] = design1;
        }
        if (!(currentStarDate >= num5)) continue;
        // [improvements] designLineUpgrade: a player-owned design type is upgraded along its tech lines instead
        // (player/designLineUpgrade.ts); false unless the UI switched it on for the player empire.
        if (designLineOwnsSubRole(galaxy, empire, spec.subRole)) continue;
        const name = `${race.name} ${resolveSubRoleDescription(spec.subRole)}`;
        if (spec.subRole === BuiltObjectSubRole.MonitoringStation && empire.research.evaluateDesiredComponent(ComponentType.SensorLongRange, ShipDesignFocus.Balanced) === null) continue;
        if (spec.subRole === BuiltObjectSubRole.Carrier && empire.research.evaluateDesiredComponent(ComponentType.FighterBay, ShipDesignFocus.Balanced) === null) continue;
        const design4 = new Design(name);
        design4.role = spec.role;
        design4.subRole = spec.subRole;
        design4.imageScalingType = spec.imageScalingMode;
        design4.imageScalingFactor = spec.imageScalingFactor;
        const maxShipSize = empire.maximumConstructionSize(design4.subRole);
        const maxBaseSize = empire.maximumConstructionSizeBase(design4.subRole);
        const tweak = galaxy.scenario !== null ? scenarioQuery(galaxy, 'aiDesignTweak', null, { empire, spec }) : null; // [scenario] Smarter AI ship design
        const design5 = placeComponentsOnDesignSized(view, design4, tweak?.spec ?? spec, componentImprovementList, maxShipSize, maxBaseSize, design1, tweak);
        if (design5 === null) continue;
        applySubRoleBehaviour(empire, design5, spec, fleeWhen6, militaryFleeWhen);
        const design6 = design1;
        if (design1 === null) design1 = findNewest(designs, spec.subRole);
        if (design5.isEquivalent(design1)) continue;
        let flag3 = true;
        void design2;
        if (design6 !== null) {
            design5.size = design5.quickCalculateSize();
            const ok = empire.pirateEmpireBaseHabitat === null ? canBuildDesign(empire, design5, true, empire.capital) : canBuildDesign(empire, design5);
            if (!ok) flag3 = false;
        }
        if (!flag3) continue;
        const reactor = empire.research.evaluateDesiredComponentByCategory(ComponentCategoryType.Reactor, ShipDesignFocus.Balanced);
        design5.name = generateDesignName(
            galaxy,
            empire.designNameState,
            { designNamesIndex: empire.designNamesIndex, designNames: galaxy.designNames, existingDesigns: designs, latestReactorComponentId: reactor?.componentId ?? null },
            spec.subRole,
            design1,
        );
        design5.dateCreated = designDate;
        design5.empire = empire;
        if (empire.pirateEmpireBaseHabitat === null) {
            design5.pictureRef = standardPictureRef(empire.designPictureFamilyIndex, design5.subRole);
        } else {
            const num6 = empire.dominantRace !== null ? raceDesignPictureFamilyIndexPirates(empire.dominantRace) : -1;
            if (num6 >= 0) {
                design5.pictureRef = standardPictureRef(num6, design5.subRole);
            } else {
                const S = BuiltObjectSubRole;
                const minor = [S.Escort, S.Frigate, S.Destroyer, S.Cruiser, S.CapitalShip, S.ColonyShip, S.GasMiningStation, S.MiningStation, S.SmallSpacePort, S.GenericBase];
                if (minor.includes(design5.subRole)) {
                    design5.pictureRef = 0; // TODO(port): ShipImageHelper.ResolveMinorShipImageIndex (own clock-seeded Random)
                } else {
                    // label_77: a random playable race other than the player's (Galaxy.Rnd).
                    const races = galaxy.races.filter((r) => r.playable && r !== galaxy.playerEmpire?.dominantRace);
                    if (races.length > 0) {
                        const r = races[galaxy.rnd.next(0, races.length)];
                        design5.pictureRef = standardPictureRef(r.designsPictureFamilyIndex, design5.subRole);
                    } else design5.pictureRef = 0;
                }
            }
        }
        design5.role = spec.role;
        design5.subRole = spec.subRole;
        design5.reDefine();
        reviewRemoveObsoleteDesignsForSubRole(empire, spec.subRole, null, false);
        designs.push(design5);
        if (!design5.isPlanetDestroyer) empire.latestDesigns[design5.subRole] = design5;
    }
    // Planet destroyers (BaconEmpire.cs 1039-1091).
    if (!(empire.policy?.buildPlanetDestroyers ?? false) || !checkDesignSubRoleShouldBeUpgraded(empire, BuiltObjectSubRole.CapitalShip)) return;
    const { categories, types } = resolveTechFocuses(empire.policy);
    if (selectPreferredSuperWeapon(view, categories, types, true) !== null) {
        let design7: Design | null;
        if (empire.planetDestroyerDesignSpecification !== null) {
            design7 = generateDesignFromSpec(galaxy, empire, empire.planetDestroyerDesignSpecification, 0.0, currentStarDate);
            if (design7 !== null) {
                design7.name = 'World Destroyer'; // TextResolver.GetText("World Destroyer") (GameText.txt 2111)
                design7.stance = BuiltObjectStance.AttackEnemies;
                design7.fleeWhen = BuiltObjectFleeWhen.Shields20;
                design7.tacticsStrongerShips = BattleTactics.Standoff;
                design7.tacticsWeakerShips = BattleTactics.AllWeapons;
                design7.tacticsInvasion = InvasionTactics.DoNotInvade;
                design7.pictureRef = SHIP_IMAGE_PLANET_DESTROYER;
            }
        } else {
            design7 = generatePlanetDestroyerDesign(galaxy, 1.0, empire, currentStarDate);
        }
        if (design7 !== null) {
            let flag = false;
            let design8: Design | null = null;
            if (canBuildDesign(empire, design7)) {
                design8 = findNewestPlanetDestroyer(designs);
                if (design8 !== null) {
                    flag = false;
                    if (canBuildDesign(empire, design8)) {
                        if (!design7.isEquivalent(design8)) flag = true;
                    } else {
                        flag = true;
                    }
                } else {
                    flag = true;
                }
            }
            if (flag) {
                if (design8 !== null) {
                    if (design8.buildCount <= 0) {
                        const i = designs.indexOf(design8);
                        if (i >= 0) designs.splice(i, 1);
                    } else {
                        design8.isObsolete = true;
                    }
                }
                designs.push(design7);
            }
        }
    }
}

// ShipImageHelper.cs PlanetDestroyer (= 0).
export const SHIP_IMAGE_PLANET_DESTROYER = 0;

// Empire.cs GenerateDesignName(subRole, previousDesign) (3208) — the call shape shared by
// CreateNewDesigns and GenerateDesignFromSpec (Rnd: see designNames.ts).
function empireGenerateDesignName(galaxy: Galaxy, empire: Empire, subRole: BuiltObjectSubRole, previousDesign: PreviousDesignForNaming | null): string {
    const reactor = empire.research.evaluateDesiredComponentByCategory(ComponentCategoryType.Reactor, ShipDesignFocus.Balanced);
    return generateDesignName(
        galaxy,
        empire.designNameState,
        { designNamesIndex: empire.designNamesIndex, designNames: galaxy.designNames, existingDesigns: empire.designs as Design[], latestReactorComponentId: reactor?.componentId ?? null },
        subRole,
        previousDesign,
    );
}

// Empire.10.cs GenerateDesignFromSpec(designSpec, techAdvanceAmount) (3387-3538).
// `currentStarDate` = Galaxy.CurrentStarDate (not tracked on the TS Galaxy; callers pass it).
// Rnd: SelectPreferredSuperWeapon inside PlaceComponentsOnDesign (capital ships of aggressive
// and intelligent races), then GenerateDesignName.
export function generateDesignFromSpec(galaxy: Galaxy, empire: Empire, designSpec: DesignSpecification | null, techAdvanceAmount: number, currentStarDate: number): Design | null {
    let design: Design | null = null;
    const fleeWhen = BuiltObjectFleeWhen.Shields20;
    const stance = BuiltObjectStance.AttackEnemies;
    const fleeWhen2 = BuiltObjectFleeWhen.EnemyMilitarySighted;
    const stance2 = BuiltObjectStance.DoNotAttack;
    const fleeWhen3 = BuiltObjectFleeWhen.EnemyMilitarySighted;
    const stance3 = BuiltObjectStance.DoNotAttack;
    const fleeWhen4 = BuiltObjectFleeWhen.EnemyMilitarySighted;
    const stance4 = BuiltObjectStance.AttackIfAttacked;
    const fleeWhen5 = BuiltObjectFleeWhen.EnemyMilitarySighted;
    const stance5 = BuiltObjectStance.DoNotAttack;
    const fleeWhen6 = BuiltObjectFleeWhen.EnemyMilitarySighted;
    const stance6 = BuiltObjectStance.DoNotAttack;
    const fleeWhen7 = BuiltObjectFleeWhen.Shields50;
    const stance7 = BuiltObjectStance.AttackEnemies;
    if (designSpec !== null) {
        let previousDesign: Design | null = null;
        const designs = empire.designs as Design[];
        if (designs != null) {
            // DesignList.FindNewestCanBuild(subRole) (140): empire = this[0].Empire.
            const designsEmpire = designs.length > 0 && designs[0] != null ? (designs[0].empire as Empire | null) : null;
            previousDesign = findNewestCanBuild(designs, designSpec.subRole, designsEmpire);
        }
        const text = resolveSubRoleDescription(designSpec.subRole);
        let empty = '';
        empty = empire.dominantRace === null ? text : empire.dominantRace.name + ' ' + text;
        design = new Design(empty);
        design.role = designSpec.role;
        design.subRole = designSpec.subRole;
        design.imageScalingType = designSpec.imageScalingMode;
        design.imageScalingFactor = designSpec.imageScalingFactor;
        design = placeComponentsOnDesignWithTech(placementView(empire, galaxy), design, designSpec, null, techAdvanceAmount);
        // C# dereferences the result unconditionally (NullReferenceException when
        // PlaceComponentsOnDesign returns null: a military spec with no weapon or fighter bay).
        if (design === null) throw new Error('GenerateDesignFromSpec: PlaceComponentsOnDesign returned null (C# NullReferenceException)');
        const S = BuiltObjectSubRole;
        const B = BattleTactics;
        const I = InvasionTactics;
        switch (designSpec.subRole) {
            case S.SmallSpacePort:
            case S.MediumSpacePort:
            case S.LargeSpacePort:
            case S.GenericBase:
            case S.EnergyResearchStation:
            case S.WeaponsResearchStation:
            case S.HighTechResearchStation:
            case S.MonitoringStation:
            case S.DefensiveBase:
                design.stance = BuiltObjectStance.AttackEnemies;
                design.fleeWhen = BuiltObjectFleeWhen.Never;
                design.tacticsStrongerShips = B.PointBlank;
                design.tacticsWeakerShips = B.PointBlank;
                design.tacticsInvasion = I.DoNotInvade;
                break;
            case S.GasMiningStation:
            case S.MiningStation:
                design.stance = BuiltObjectStance.AttackIfAttacked;
                design.fleeWhen = BuiltObjectFleeWhen.Never;
                design.tacticsStrongerShips = B.PointBlank;
                design.tacticsWeakerShips = B.PointBlank;
                design.tacticsInvasion = I.DoNotInvade;
                break;
            case S.Escort:
            case S.Frigate:
            case S.Destroyer:
            case S.Cruiser:
            case S.CapitalShip:
                design.stance = stance;
                design.fleeWhen = fleeWhen;
                design.tacticsStrongerShips = B.Standoff;
                design.tacticsWeakerShips = B.AllWeapons;
                design.tacticsInvasion = I.InvadeWhenClear;
                break;
            case S.Carrier:
                design.stance = stance7;
                design.fleeWhen = fleeWhen7;
                design.tacticsStrongerShips = B.Evade;
                design.tacticsWeakerShips = B.AllWeapons;
                design.tacticsInvasion = I.InvadeWhenClear;
                break;
            case S.SmallFreighter:
            case S.MediumFreighter:
            case S.LargeFreighter:
                design.stance = stance2;
                design.fleeWhen = fleeWhen2;
                design.tacticsStrongerShips = B.Evade;
                design.tacticsWeakerShips = B.Evade;
                design.tacticsInvasion = I.DoNotInvade;
                break;
            case S.ExplorationShip:
                design.stance = stance4;
                design.fleeWhen = fleeWhen4;
                design.tacticsStrongerShips = B.Evade;
                design.tacticsWeakerShips = B.Evade;
                design.tacticsInvasion = I.DoNotInvade;
                break;
            case S.ColonyShip:
                design.stance = stance5;
                design.fleeWhen = fleeWhen5;
                design.tacticsStrongerShips = B.Evade;
                design.tacticsWeakerShips = B.Evade;
                design.tacticsInvasion = I.DoNotInvade;
                break;
            case S.ConstructionShip:
                design.stance = stance6;
                design.fleeWhen = fleeWhen6;
                design.tacticsStrongerShips = B.Evade;
                design.tacticsWeakerShips = B.Evade;
                design.tacticsInvasion = I.DoNotInvade;
                break;
            case S.GasMiningShip:
            case S.MiningShip:
                design.stance = stance3;
                design.fleeWhen = fleeWhen3;
                design.tacticsStrongerShips = B.Evade;
                design.tacticsWeakerShips = B.Evade;
                design.tacticsInvasion = I.DoNotInvade;
                break;
            case S.TroopTransport:
                design.stance = stance7;
                design.fleeWhen = fleeWhen7;
                design.tacticsStrongerShips = B.Evade;
                design.tacticsWeakerShips = B.AllWeapons;
                design.tacticsInvasion = I.InvadeImmediately;
                break;
            case S.ResupplyShip:
                design.stance = stance7;
                design.fleeWhen = fleeWhen7;
                design.tacticsStrongerShips = B.Evade;
                design.tacticsWeakerShips = B.AllWeapons;
                design.tacticsInvasion = I.DoNotInvade;
                break;
            default:
                design.stance = BuiltObjectStance.DoNotAttack;
                design.fleeWhen = BuiltObjectFleeWhen.Attacked;
                design.tacticsStrongerShips = B.Standoff;
                design.tacticsWeakerShips = B.AllWeapons;
                design.tacticsInvasion = I.DoNotInvade;
                break;
        }
        let num = empire.designPictureFamilyIndex;
        if (empire.dominantRace !== null && empire.pirateEmpireBaseHabitat !== null) {
            num = raceDesignPictureFamilyIndexPirates(empire.dominantRace);
            if (num < 0) {
                num = empire.dominantRace.designsPictureFamilyIndex;
            }
        }
        empty = design.name = empireGenerateDesignName(galaxy, empire, designSpec.subRole, previousDesign);
        void empty;
        design.dateCreated = currentStarDate;
        design.empire = empire;
        design.pictureRef = standardPictureRef(num, designSpec.subRole);
        design.role = designSpec.role;
        design.subRole = designSpec.subRole;
        design.reDefine();
    }
    return design;
}

/** C# ComponentList as built by the Get*Components helpers: `Add(null)` keeps the null slot. */
export type NullableComponentList = (ComponentDefinition | null)[];

/** Galaxy.ComponentDefinitionsStatic. */
export function componentDefinitionsStatic(galaxy: Galaxy): ComponentDefinition[] {
    return galaxy.researchStatic?.componentStatic?.definitions ?? [];
}

// Galaxy.8.cs AddComponentsToDesign(design, components, research) (2320). No Rnd.
export function addComponentsToDesign(galaxy: Galaxy, design: Design, components: NullableComponentList, research: ResearchSystem | null): Design {
    for (const component3 of components) {
        if (component3 != null) {
            design.components.push(component3);
        }
    }
    const defs = componentDefinitionsStatic(galaxy);
    const component = evaluateLatestByType(defs, ComponentType.HabitationHabModule, 1000000.0);
    // new ComponentImprovement(component): C# dereferences component (never null with the
    // stock component set at tech 1,000,000).
    let componentImprovement: ComponentImprovementEntry = componentImprovementFromComponent(component!);
    const component2 = evaluateLatestByType(defs, ComponentType.HabitationLifeSupport, 1000000.0);
    let componentImprovement2: ComponentImprovementEntry = componentImprovementFromComponent(component2!);
    if (research !== null) {
        if (component !== null) {
            componentImprovement = research.resolveImprovedComponentValues(component);
        }
        if (component2 !== null) {
            componentImprovement2 = research.resolveImprovedComponentValues(component2);
        }
    }
    const num = determineHabModulesRequired(componentImprovement, design);
    const num2 = determineLifeSupportRequired(componentImprovement2, design);
    for (let i = 0; i < num; i++) {
        design.components.push(componentImprovement.improvedComponent);
    }
    for (let j = 0; j < num2; j++) {
        design.components.push(componentImprovement2.improvedComponent);
    }
    return design;
}

// ComponentDefinition.cs GetHighestTechByType(type, definitions) (393).
export function getHighestTechByType(type: ComponentType, definitions: ComponentDefinition[]): ComponentDefinition | null {
    let highestTechByType: ComponentDefinition | null = null;
    for (let index = 0; index < definitions.length; ++index) {
        const definition = definitions[index];
        if (definition != null && definition.type === type && (highestTechByType === null || definition.techLevel > highestTechByType.techLevel)) {
            highestTechByType = definition;
        }
    }
    return highestTechByType;
}

// Galaxy.8.cs GetPlanetDestroyerComponents(overpowerFactor, empire) (2362). No Rnd.
export function getPlanetDestroyerComponents(galaxy: Galaxy, overpowerFactor: number, empire: Empire | null): NullableComponentList {
    const componentList: NullableComponentList = [];
    const num = csInt(30.0 * overpowerFactor);
    const num2 = csInt(18.0 * overpowerFactor);
    const num3 = csInt(12.0 * overpowerFactor);
    const num4 = csInt(8.0 * overpowerFactor);
    const num5 = csInt(16.0 * overpowerFactor);
    const num6 = csInt(12.0 * overpowerFactor);
    const num7 = csInt(5.0 * overpowerFactor);
    const num8 = csInt(6.0 * overpowerFactor);
    const num9 = csInt(14.0 * overpowerFactor);
    const T = ComponentType;
    const C = ComponentCategoryType;
    const defs = componentDefinitionsStatic(galaxy);
    if (empire !== null && empire.research != null) {
        const r = empire.research;
        const lt = (t: ComponentType) => r.getLatestComponent(t);
        const lc = (c: ComponentCategoryType) => r.getLatestComponent(c, true);
        componentList.push(lt(T.ComputerCommandCenter));
        componentList.push(lt(T.ComputerCommandCenter));
        componentList.push(lt(T.DamageControl));
        componentList.push(lt(T.DamageControl));
        componentList.push(lt(T.DamageControl));
        componentList.push(lt(T.DamageControl));
        for (let i = 0; i < num8; i++) componentList.push(lt(T.Reactor));
        for (let j = 0; j < 60; j++) componentList.push(lt(T.StorageFuel));
        for (let k = 0; k < 60; k++) componentList.push(lt(T.StorageCargo));
        componentList.push(lt(T.StorageDockingBay));
        componentList.push(lt(T.StorageDockingBay));
        componentList.push(lt(T.StorageDockingBay));
        componentList.push(lt(T.StorageDockingBay));
        componentList.push(lt(T.ComputerCommerceCenter));
        componentList.push(lt(T.HabitationMedicalCenter));
        componentList.push(lt(T.HabitationRecreationCenter));
        componentList.push(lt(T.SensorProximityArray));
        componentList.push(lt(T.ComputerTargetting));
        componentList.push(lt(T.ComputerCountermeasures));
        componentList.push(lt(T.ComputerTargettingFleet));
        componentList.push(lt(T.ComputerCountermeasuresFleet));
        componentList.push(lt(T.SensorLongRange));
        for (let l = 0; l < num; l++) componentList.push(lt(T.Armor));
        for (let m = 0; m < num2; m++) componentList.push(lc(C.Shields));
        for (let n = 0; n < num9; n++) componentList.push(lt(T.EnergyCollector));
        for (let num10 = 0; num10 < num5; num10++) componentList.push(lt(T.EngineMainThrust));
        for (let num11 = 0; num11 < 1; num11++) componentList.push(lt(T.EngineVectoring));
        for (let num12 = 0; num12 < num3; num12++) componentList.push(lc(C.WeaponBeam));
        for (let num13 = 0; num13 < num6; num13++) componentList.push(lc(C.WeaponPointDefense));
        for (let num14 = 0; num14 < num4; num14++) componentList.push(lc(C.WeaponTorpedo));
        componentList.push(lt(T.WeaponTractorBeam));
        componentList.push(lt(T.WeaponTractorBeam));
        componentList.push(lt(T.WeaponTractorBeam));
        componentList.push(lt(T.WeaponTractorBeam));
        for (let num15 = 0; num15 < num7; num15++) componentList.push(lt(T.FighterBay));
        componentList.push(lt(T.WeaponAreaDestruction));
        const highestTechByType = getHighestTechByType(T.WeaponSuperBeam, defs);
        if (highestTechByType !== null) componentList.push(highestTechByType);
        componentList.push(lt(T.WeaponIonDefense));
        componentList.push(lc(C.HyperDrive));
    } else {
        const lt = (t: ComponentType, tech: number) => evaluateLatestByType(defs, t, tech);
        const lc = (c: ComponentCategoryType, tech: number) => evaluateLatestByCategory(defs, c, tech);
        componentList.push(lt(T.ComputerCommandCenter, 1000000.0));
        componentList.push(lt(T.ComputerCommandCenter, 1000000.0));
        componentList.push(lt(T.DamageControl, 1000000.0));
        componentList.push(lt(T.DamageControl, 1000000.0));
        componentList.push(lt(T.DamageControl, 1000000.0));
        componentList.push(lt(T.DamageControl, 1000000.0));
        for (let num16 = 0; num16 < num8; num16++) componentList.push(lt(T.Reactor, 1000000.0));
        for (let num17 = 0; num17 < 60; num17++) componentList.push(lt(T.StorageFuel, 1000000.0));
        for (let num18 = 0; num18 < 60; num18++) componentList.push(lt(T.StorageCargo, 1000000.0));
        componentList.push(lt(T.StorageDockingBay, 1000000.0));
        componentList.push(lt(T.StorageDockingBay, 1000000.0));
        componentList.push(lt(T.StorageDockingBay, 1000000.0));
        componentList.push(lt(T.StorageDockingBay, 1000000.0));
        componentList.push(lt(T.ComputerCommerceCenter, 1000000.0));
        componentList.push(lt(T.HabitationMedicalCenter, 1000000.0));
        componentList.push(lt(T.HabitationRecreationCenter, 1000000.0));
        componentList.push(lt(T.SensorProximityArray, 1000000.0));
        componentList.push(lt(T.ComputerTargetting, 1000000.0));
        componentList.push(lt(T.ComputerCountermeasures, 1000000.0));
        componentList.push(lt(T.ComputerTargettingFleet, 1000000.0));
        componentList.push(lt(T.ComputerCountermeasuresFleet, 1000000.0));
        componentList.push(lt(T.SensorLongRange, 1000000.0));
        for (let num19 = 0; num19 < num; num19++) componentList.push(lt(T.Armor, 1000000.0));
        for (let num20 = 0; num20 < num2; num20++) componentList.push(lc(C.Shields, 6.0));
        for (let num21 = 0; num21 < num9; num21++) componentList.push(lt(T.EnergyCollector, 1000000.0));
        for (let num22 = 0; num22 < num5; num22++) componentList.push(lt(T.EngineMainThrust, 6.0));
        for (let num23 = 0; num23 < 1; num23++) componentList.push(lt(T.EngineVectoring, 6.0));
        for (let num24 = 0; num24 < num3; num24++) componentList.push(lc(C.WeaponBeam, 6.0));
        for (let num25 = 0; num25 < num6; num25++) componentList.push(lc(C.WeaponPointDefense, 6.0));
        for (let num26 = 0; num26 < num4; num26++) componentList.push(lc(C.WeaponTorpedo, 6.0));
        componentList.push(lt(T.WeaponTractorBeam, 6.0));
        componentList.push(lt(T.WeaponTractorBeam, 6.0));
        componentList.push(lt(T.WeaponTractorBeam, 6.0));
        componentList.push(lt(T.WeaponTractorBeam, 6.0));
        for (let num27 = 0; num27 < num7; num27++) componentList.push(lt(T.FighterBay, 6.0));
        componentList.push(lt(T.WeaponAreaDestruction, 6.0));
        const highestTechByType2 = getHighestTechByType(T.WeaponSuperBeam, defs);
        if (highestTechByType2 !== null) componentList.push(highestTechByType2);
        componentList.push(lt(T.WeaponIonDefense, 6.0));
        componentList.push(lc(C.HyperDrive, 6.0));
    }
    return componentList;
}

// Galaxy.7.cs GeneratePlanetDestroyerDesign(overpowerFactor, empire) (4862). No Rnd.
// `currentStarDate` = Galaxy.CurrentStarDate.
export function generatePlanetDestroyerDesign(galaxy: Galaxy, overpowerFactor: number, empire: Empire | null, currentStarDate: number): Design {
    const planetDestroyerComponents = getPlanetDestroyerComponents(galaxy, overpowerFactor, empire);
    const text = 'World Destroyer'; // TextResolver.GetText("World Destroyer")
    let design = new Design(text);
    design.role = BuiltObjectRole.Military;
    design.subRole = BuiltObjectSubRole.CapitalShip;
    design = addComponentsToDesign(galaxy, design, planetDestroyerComponents, null);
    design.stance = BuiltObjectStance.AttackEnemies;
    design.fleeWhen = BuiltObjectFleeWhen.Shields20;
    design.tacticsStrongerShips = BattleTactics.Standoff;
    design.tacticsWeakerShips = BattleTactics.AllWeapons;
    design.tacticsInvasion = InvasionTactics.DoNotInvade;
    design.name = text;
    design.dateCreated = currentStarDate;
    design.empire = empire;
    design.pictureRef = SHIP_IMAGE_PLANET_DESTROYER;
    design.reDefine();
    return design;
}

// DesignList.cs FindNewestPlanetDestroyer (98).
export function findNewestPlanetDestroyer(designs: Design[]): Design | null {
    let num = 0;
    let newestPlanetDestroyer: Design | null = null;
    for (const design of designs) {
        if (design.role !== BuiltObjectRole.Base && design.dateCreated > num && !design.isObsolete && design.isPlanetDestroyer) {
            num = design.dateCreated;
            newestPlanetDestroyer = design;
        }
    }
    return newestPlanetDestroyer;
}
