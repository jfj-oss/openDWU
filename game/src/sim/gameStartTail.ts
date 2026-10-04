// Game-start tail: port of DistantWorlds/Start.2.cs CreateGameFromSettings from the end of
// the ruins blocks (1567) to the creation of the Game object (2016), plus the Galaxy / Empire
// methods those blocks call that were not ported yet:
//   Galaxy.5.cs GenerateAbandonedBuiltObject (2150), GenerateUnownedBuiltObjectFromDesign
//     (2523), AddCargoBaysToDesign (2123), FindNearestRuin (4709/4729), GenerateSpecialBonusRuins
//     (5518); Galaxy.cs GenerateRuin (5247);
//   Galaxy.7.cs DamageBuiltObjectComponents (4814), FindNearestHabitatEmptySystem (1656) +
//     InIndex (2125), SetEmpireKnownGalacticHistoryLocations (4883);
//   Galaxy.3.cs FindLonelyHabitat family (1393-1540), FindLonelyDeepSpaceLocation (1356),
//     CheckNearEmpireColony (1057);
//   Galaxy.4.cs SetRestrictedResources (3074) / SetSingleRestrictedResource (3120);
//   Galaxy.6.cs SelectSpecialRuins (80), SelectRace (321-343), GenerateSilverMistRuins (344) /
//     GenerateSilverMistRuin (362);
//   Empire.10.cs GetMonitoringStationDesignSpec (1080); Design.cs Clone (1986);
//   ComponentList.cs RemoveAllByComponentCategory (200); HabitatList.cs GetFurthestHabitat (520);
//   Start.2.cs method_85 (2230), method_87 (2447), method_93 (2725).
//
// Blocks (in C# order; gameStartTail() runs them all):
//   1568-1583 capitalCreatureTeardown          no Rnd
//   1585-1729 homeAsteroidFieldsAtStart          (galaxy.Age == 0) Rnd — see the function
//   1730-1767 shakturiStoryAtStart               story only → story/storyStart.ts (M4z3)
//   1768-1844 distantWorldsStoryCluesAtStart     story only → story/storyStart.ts (M4z3)
//   1845-1852 setKnownGalacticHistoryLocationsAtStart  no Rnd
//   1853-1856 setRestrictedResources             Rnd
//   1857-1860 generateSilverMistRuins            Rnd
//   1861-1864 generateSpecialBonusRuins          Rnd
//   1865-1967 placeSpecialRuinsAtStart           Rnd (Origins sub-block: story/storyStart.ts, M4z3)
//   1968-2010 debrisFieldsAtStart                story only → story/storyStart.ts (M4z3)
//   2011      abandonedShipsAtStart (method_87)  Rnd
//   2012      asteroidAbandonedShipsAtStart (method_85) Rnd
//   2013-2016 method_86                          story only → story/storyStart.ts (M4z3)
//   2017-2038 gameObjectAtStart                  DeferEventsForGameStart, Game flags; the player capital's
//             Habitat.DoTasks (2035-2038) runs in game.ts once the caller has applied the returned flags.
//
// Story blocks: Galaxy.StoryReturnOfTheShakturiEnabled / StoryDistantWorldsEnabled default to
// false on the TS Galaxy (C#: VictoryConditions.EnableStoryEvents / the wizard's DW story box;
// createGame's story options set them); the blocks are ported in story/storyStart.ts (M4z3).
//
// "gameStartResets_0 == null || GalaxyFilepath empty || Reset*" conditions are always true for a
// new game (no galaxy file) and are not modelled.
//
// TextResolver: English GameText.txt strings are used directly (ruins.ts convention).
// ShipImageHelper.Resolve*ShipImageIndex draws from ShipImageHelper._Rnd (not Galaxy.Rnd) and
// only picks a picture: TODO(port), pictureRef left as generated.

import type { Galaxy } from './galaxy';
import type { Empire } from './empire';
import type { Race } from './data/races';
import type { RaceFamily } from './data/raceFamilies';
import type { Government } from './data/governments';
import { getGovernmentsStatic } from './empire';
import { BuiltObject } from './builtObject';
import { BuiltObjectSubRole } from './builtObjectTypes';
import { ComponentStatus } from './builtObjectComponent';
import { Cargo, ResourceRef } from './cargo';
import { CreatureType } from './creature';
import {
    BuiltObjectRole,
    DesignSpecificationComponentRuleType,
    buildDefaultDesignSpecifications,
    getDefaultDesignSpecificationBySubRole,
    newComponentRuleByCategory,
    newComponentRuleByType,
    newDesignSpecification,
    type DesignSpecification,
} from './data/designSpecifications';
import { ComponentType } from './data/components';
import { ComponentCategoryType } from './data/policies';
import { Design, findNewest } from './design';
import { generateDesignFromSpec } from './designGeneration';
import { GalaxyLocationType, type GalaxyLocation } from './galaxyLocation';
import { galaxyCurrentStarDate } from './pirateRelations';
import { generatePirateBaseName, selectRandomRace } from './pirates';
import { Ruin, RuinType, generateRuinName, selectRuinDescription, selectRuins } from './ruins';
import { HabitatCategoryType, HabitatType, type Habitat } from './types';
import { determineGalaxyLocationsInRangeAtPoint } from './visibility';
import * as storyStart from './story/storyStart';

// ---------------------------------------------------------------------------
// BuiltObject encounter members (BuiltObject.cs 311-319, 505-507). Not on the TS BuiltObject
// class yet (builtObject.ts is owned elsewhere): added by module augmentation and initialised
// to the C# field defaults by generateUnownedBuiltObjectFromDesign.
// ---------------------------------------------------------------------------

// BuiltObjectEncounterAction.cs (byte enum; member order exact).
export enum BuiltObjectEncounterAction {
    Prompt,
    Notify,
    None,
}

// BuiltObjectEncounterEventType.cs (byte enum; member order exact).
export enum BuiltObjectEncounterEventType {
    Acquire,
    PirateAmbush,
    Explodes,
}

declare module './builtObject' {
    interface BuiltObject {
        playerEmpireEncounterAction?: BuiltObjectEncounterAction;
        encounterEventType?: BuiltObjectEncounterEventType;
        encounterExplorationBonus?: number; // short
        encounterMoneyBonus?: number; // int
        encounterGovernmentTypeId?: number; // byte, default byte.MaxValue
        encounterDescription?: string | null;
        encounterTechAdvanceCount?: number; // int
    }
}

// EventMessageType.cs members used by SelectSpecialRuins (names only; values not needed).
export enum SpecialRuinsEventType {
    ExoticTechDiscovered,
    GalacticRefugees,
    LostBuiltObjectCoordinates,
    LostColonyCoordinates,
    OriginsDiscovery,
    SleepersAwake,
    SpecialGovernmentType,
}

const TEXT_ANCIENT_RUINS = 'Ancient Ruins';
const TEXT_PREWARP_ABANDONED_SHIP_ENCOUNTER = "A radio transmission from the ship repeats over and over: 'This mission is too important for me to allow you to jeopardize it'";

// C# (short)/(int) of values that stay in range here.
const toShort = (v: number): number => (v << 16) >> 16;

// Galaxy.7.cs 569 ConditionCheckLimit(condition, maximumIterations, ref iterationCount).
function conditionCheckLimit(condition: boolean, maximumIterations: number, iterationCount: { value: number }): boolean {
    if (iterationCount.value >= maximumIterations) return false;
    iterationCount.value++;
    return condition;
}

// DesignSpecificationList.GetBySubRole: first match (empire list may hold nulls).
function getBySubRole(list: readonly (DesignSpecification | null)[], subRole: BuiltObjectSubRole): DesignSpecification | null {
    for (const spec of list) if (spec !== null && spec.subRole === subRole) return spec;
    return null;
}

// Galaxy.DesignSpecifications (static, Galaxy.3.cs 4960-5721).
let galaxyDesignSpecifications: DesignSpecification[] | null = null;
export function galaxyDesignSpecificationBySubRole(subRole: BuiltObjectSubRole): DesignSpecification | null {
    if (galaxyDesignSpecifications === null) galaxyDesignSpecifications = buildDefaultDesignSpecifications();
    return getDefaultDesignSpecificationBySubRole(galaxyDesignSpecifications, subRole);
}

function requireDesign(design: Design | null, what: string): Design {
    if (design === null) throw new Error(`${what}: GenerateDesignFromSpec returned null (C# NullReferenceException)`);
    return design;
}

/** ComponentList.cs 200 RemoveAllByComponentCategory (removes every component of the category, order kept). */
export function removeAllByComponentCategory(design: Design, category: ComponentCategoryType): void {
    const componentList = design.components.filter((c) => c.category === category);
    for (let index = 0; index < componentList.length; ++index) {
        const i = design.components.indexOf(componentList[index]);
        if (i >= 0) design.components.splice(i, 1);
    }
}

/** Design.cs 1986 Clone (Components.Clone() makes new Component(id) per entry: same definitions here). */
export function cloneDesign(source: Design): Design {
    const design = new Design(source.name);
    design.imageScalingType = source.imageScalingType;
    design.imageScalingFactor = source.imageScalingFactor;
    design.dateCreated = source.dateCreated;
    design.empire = source.empire;
    design.role = source.role;
    design.subRole = source.subRole;
    design.stance = source.stance;
    design.fleeWhen = source.fleeWhen;
    design.tacticsStrongerShips = source.tacticsStrongerShips;
    design.tacticsWeakerShips = source.tacticsWeakerShips;
    design.tacticsInvasion = source.tacticsInvasion;
    design.pictureRef = source.pictureRef;
    design.buildCount = source.buildCount;
    design.components = source.components.slice();
    design.isObsolete = source.isObsolete;
    design.isManuallyCreated = source.isManuallyCreated;
    design.allowAutoRetrofit = source.allowAutoRetrofit;
    design.repaitPriorityTemplateName = source.repaitPriorityTemplateName;
    design.reDefine();
    return design;
}

/**
 * Galaxy.5.cs 2123 AddCargoBaysToDesign. ComponentDefinition.GetLowestTechByType (376) tests
 * `lowestTechByType != null && ...` on a variable that starts null, so it always returns null:
 * no bay is ever added and only ReDefine runs.
 */
export function addCargoBaysToDesign(design: Design | null, cargoBayAmount: number): void {
    if (design === null) return;
    void cargoBayAmount;
    design.reDefine();
}

/** Empire.10.cs 1080 GetMonitoringStationDesignSpec. */
export function getMonitoringStationDesignSpec(): DesignSpecification {
    const T = DesignSpecificationComponentRuleType;
    const s = newDesignSpecification(BuiltObjectSubRole.GenericBase, false);
    s.componentRules.push(newComponentRuleByType(T.MustHave, ComponentType.ComputerCommandCenter, 1));
    s.componentRules.push(newComponentRuleByCategory(T.MustHave, ComponentCategoryType.Reactor, 2));
    s.componentRules.push(newComponentRuleByType(T.MustHave, ComponentType.StorageFuel, 2));
    s.componentRules.push(newComponentRuleByType(T.MustHave, ComponentType.StorageDockingBay, 1));
    s.componentRules.push(newComponentRuleByType(T.MustHave, ComponentType.StorageCargo, 4));
    s.componentRules.push(newComponentRuleByCategory(T.MustHave, ComponentCategoryType.EnergyCollector, 3));
    s.componentRules.push(newComponentRuleByType(T.MustHave, ComponentType.ComputerCommerceCenter, 1));
    s.componentRules.push(newComponentRuleByType(T.ShouldHave, ComponentType.HabitationMedicalCenter, 1));
    s.componentRules.push(newComponentRuleByType(T.ShouldHave, ComponentType.HabitationRecreationCenter, 1));
    s.componentRules.push(newComponentRuleByType(T.ShouldHave, ComponentType.SensorProximityArray, 1));
    s.componentRules.push(newComponentRuleByType(T.ShouldHave, ComponentType.ComputerTargetting, 1));
    s.componentRules.push(newComponentRuleByType(T.ShouldHave, ComponentType.ComputerCountermeasures, 1));
    s.componentRules.push(newComponentRuleByType(T.MustHave, ComponentType.SensorLongRange, 1));
    s.componentRules.push(newComponentRuleByType(T.ShouldHave, ComponentType.Armor, 6));
    s.componentRules.push(newComponentRuleByCategory(T.ShouldHave, ComponentCategoryType.Shields, 6));
    s.componentRules.push(newComponentRuleByCategory(T.ShouldHave, ComponentCategoryType.WeaponBeam, 6));
    s.componentRules.push(newComponentRuleByType(T.ShouldHave, ComponentType.DamageControl, 1));
    s.componentRules.push(newComponentRuleByType(T.ShouldHave, ComponentType.SensorStealth, 1));
    return s;
}

// ---------------------------------------------------------------------------
// Galaxy helpers
// ---------------------------------------------------------------------------

/** HabitatList.cs 520 GetFurthestHabitat(x, y, type, minimumRange). */
export function getFurthestHabitat(habitats: readonly Habitat[], x: number, y: number, type: HabitatType, minimumRange: number): Habitat | null {
    const num1 = minimumRange * minimumRange;
    let furthestHabitat: Habitat | null = null;
    let num2 = 0.0;
    for (let index = 0; index < habitats.length; ++index) {
        const habitat = habitats[index];
        if (habitat != null && habitat.type === type) {
            const dx = x - habitat.xpos;
            const dy = y - habitat.ypos;
            const distanceSquaredStatic = dx * dx + dy * dy;
            if (distanceSquaredStatic >= num1 && (furthestHabitat === null || distanceSquaredStatic > num2)) {
                num2 = distanceSquaredStatic;
                furthestHabitat = habitat;
            }
        }
    }
    return furthestHabitat;
}

/** C# `galaxy.Systems[systemStar]` (SystemInfoList indexer by star) → its Habitats (star excluded). */
function systemHabitatsByStar(galaxy: Galaxy, systemStar: Habitat): Habitat[] | null {
    const systemInfo = galaxy.systems.find((s) => s.systemStar === systemStar);
    if (systemInfo === undefined) return null;
    return systemInfo.habitats.filter((h) => h !== systemInfo.systemStar);
}

/** Galaxy.5.cs 4729 / 4709 FindNearestRuin(x, y[, ruinType]) over Galaxy.RuinsHabitats. No Rnd. */
export function findNearestRuin(galaxy: Galaxy, x: number, y: number, ruinType?: RuinType): Habitat | null {
    let result: Habitat | null = null;
    let num = Number.MAX_VALUE;
    for (let i = 0; i < galaxy.ruinsHabitats.length; i++) {
        const habitat = galaxy.ruinsHabitats[i];
        if (habitat.ruin !== null && (ruinType === undefined || habitat.ruin.type === ruinType)) {
            const num2 = galaxy.calculateDistanceSquared(x, y, habitat.xpos, habitat.ypos);
            if (num2 < num) {
                num = num2;
                result = habitat;
            }
        }
    }
    return result;
}

/** Galaxy.7.cs 4814 DamageBuiltObjectComponents. No Rnd. */
export function damageBuiltObjectComponents(builtObject: BuiltObject, damagePortion: number): void {
    damagePortion = Math.min(1.0, Math.max(damagePortion, 0.0));
    let num = Math.trunc(builtObject.components.count * damagePortion);
    if (num >= builtObject.components.count) num = builtObject.components.count - 1;
    let num2 = 0;
    for (let i = 0; i < builtObject.components.count; i++) {
        builtObject.components.items[i].status = ComponentStatus.Damaged;
        num2++;
        if (num2 >= num) break;
    }
    builtObject.reDefine();
}

/**
 * Galaxy.5.cs 2523 GenerateUnownedBuiltObjectFromDesign(design, name, parentHabitat[, x, y]).
 * Rnd: base at a star → SelectRelativeParkingPoint(min) (NextDouble, Next(0,2), NextDouble);
 * base at a planet → SelectRelativeHabitatSurfacePoint (NextDouble, NextDouble); ship at a star
 * or planet → SelectRelativeParkingPoint; then SelectRandomHeading (NextDouble); a colony ship
 * without a native race → SelectRandomRace(0).
 */
export function generateUnownedBuiltObjectFromDesign(galaxy: Galaxy, design: Design, name: string, parentHabitat: Habitat | null, x = -2000000001.0, y = -2000000001.0): BuiltObject {
    const builtObject = new BuiltObject(design, name, galaxy, true, true);
    // BuiltObject.cs field defaults of the encounter members (see the module augmentation above).
    builtObject.playerEmpireEncounterAction = BuiltObjectEncounterAction.Prompt;
    builtObject.encounterEventType = BuiltObjectEncounterEventType.Acquire;
    builtObject.encounterExplorationBonus = 0;
    builtObject.encounterMoneyBonus = 0;
    builtObject.encounterGovernmentTypeId = 255;
    builtObject.encounterDescription = null;
    builtObject.encounterTechAdvanceCount = 0;
    for (let i = 0; i < builtObject.components.count; i++) builtObject.components.items[i].status = ComponentStatus.Normal;
    builtObject.builtObjectID = galaxy.getNextBuiltObjectID();
    builtObject.empire = null;
    builtObject.owner = null;
    builtObject.dateBuilt = galaxyCurrentStarDate(galaxy);
    builtObject.parentHabitat = parentHabitat;
    if (parentHabitat !== null) {
        let p: { x: number; y: number };
        if (design.role === BuiltObjectRole.Base) {
            if (parentHabitat.category === HabitatCategoryType.Star) {
                let minimumDistance = parentHabitat.diameter;
                if (parentHabitat.type === HabitatType.BlackHole) minimumDistance = parentHabitat.diameter * 0.6;
                else if (parentHabitat.type === HabitatType.SuperNova) minimumDistance = parentHabitat.diameter * 0.55;
                p = galaxy.selectRelativeParkingPoint(minimumDistance);
            } else {
                p = galaxy.selectRelativeHabitatSurfacePoint(parentHabitat);
                if (parentHabitat.basesAtHabitat == null) parentHabitat.basesAtHabitat = [];
                parentHabitat.basesAtHabitat.push(builtObject);
            }
        } else if (parentHabitat.category === HabitatCategoryType.Star) {
            let minimumDistance2 = parentHabitat.diameter;
            if (parentHabitat.type === HabitatType.BlackHole) minimumDistance2 = parentHabitat.diameter * 0.6;
            p = galaxy.selectRelativeParkingPoint(minimumDistance2);
        } else {
            p = galaxy.selectRelativeParkingPoint();
        }
        builtObject.parentOffsetX = p.x;
        builtObject.parentOffsetY = p.y;
        builtObject.xpos = parentHabitat.xpos + p.x;
        builtObject.ypos = parentHabitat.ypos + p.y;
    } else {
        builtObject.xpos = x;
        builtObject.ypos = y;
    }
    builtObject.heading = galaxy.selectRandomHeading();
    builtObject.targetHeading = builtObject.heading;
    builtObject.supportCostFactor = 0.5;
    if (builtObject.subRole === BuiltObjectSubRole.ColonyShip) {
        if (parentHabitat !== null && parentHabitat.population != null && parentHabitat.population.dominantRace != null) {
            builtObject.nativeRace = parentHabitat.population.dominantRace;
        } else {
            builtObject.nativeRace = selectRandomRace(galaxy, 0);
        }
    }
    builtObject.reDefine();
    builtObject.currentFuel = builtObject.fuelCapacity;
    builtObject.currentShields = Math.fround(builtObject.shieldsCapacity);
    galaxy.builtObjects.push(builtObject);
    const gi = galaxy.resolveIndex(builtObject.xpos, builtObject.ypos);
    galaxy.builtObjectIndexGrid[gi.x][gi.y].push(builtObject);
    const habitat = galaxy.fastFindNearestSystem(builtObject.xpos, builtObject.ypos);
    if (habitat !== null) {
        const num = galaxy.calculateDistance(builtObject.xpos, builtObject.ypos, habitat.xpos, habitat.ypos);
        if (num < galaxy.maxSolarSystemSize + 1000.0) builtObject.nearestSystemStar = habitat;
    }
    builtObject.reDefine();
    return builtObject;
}

/**
 * Galaxy.5.cs 2140-2150 GenerateAbandonedBuiltObject(habitat, design[, allowCreatures = true
 * [, allowNegativeEffects = true, encounterAction = Prompt]]).
 * Rnd: SelectUniqueBuiltObjectName (sub-role dependent), GenerateUnownedBuiltObjectFromDesign,
 * [allowNegativeEffects: Next(0,3), ==1 → Next(0,2)], [allowCreatures: Next(0,3), ==1 &&
 * CreaturePrevalence > 0 && AllowGiantKaltorGeneration → GenerateCreatureAtHabitat(Kaltor)].
 */
export function generateAbandonedBuiltObject(
    galaxy: Galaxy,
    habitat: Habitat,
    design: Design,
    allowCreatures = true,
    allowNegativeEffects = true,
    encounterAction: BuiltObjectEncounterAction = BuiltObjectEncounterAction.Prompt,
): BuiltObject {
    const name = galaxy.selectUniqueBuiltObjectName(design, habitat);
    const builtObject = generateUnownedBuiltObjectFromDesign(galaxy, design, name, habitat);
    builtObject.isAutoControlled = false;
    builtObject.playerEmpireEncounterAction = encounterAction;
    let builtObjectEncounterEventType = BuiltObjectEncounterEventType.Acquire;
    let encounterDescription = '';
    let flag = false;
    if (
        design.subRole === BuiltObjectSubRole.ColonyShip ||
        design.subRole === BuiltObjectSubRole.ConstructionShip ||
        design.subRole === BuiltObjectSubRole.ExplorationShip ||
        design.subRole === BuiltObjectSubRole.GasMiningShip ||
        design.subRole === BuiltObjectSubRole.MiningShip ||
        design.subRole === BuiltObjectSubRole.CapitalShip ||
        design.subRole === BuiltObjectSubRole.ResupplyShip ||
        design.role === BuiltObjectRole.Base
    ) {
        flag = true;
    }
    if (allowNegativeEffects && galaxy.rnd.next(0, 3) === 1) {
        switch (galaxy.rnd.next(0, 2)) {
            case 0:
                builtObjectEncounterEventType = BuiltObjectEncounterEventType.Explodes;
                encounterDescription = '';
                break;
            case 1:
                if (!flag && galaxy.piratePrevalence > 0.0) {
                    builtObjectEncounterEventType = BuiltObjectEncounterEventType.PirateAmbush;
                    encounterDescription = '';
                }
                break;
        }
    }
    if (builtObject.role === BuiltObjectRole.Base && builtObjectEncounterEventType === BuiltObjectEncounterEventType.PirateAmbush) {
        builtObjectEncounterEventType = BuiltObjectEncounterEventType.Acquire;
        encounterDescription = '';
    }
    builtObject.encounterEventType = builtObjectEncounterEventType;
    builtObject.encounterDescription = encounterDescription;
    if (allowCreatures && galaxy.rnd.next(0, 3) === 1 && galaxy.creaturePrevalence > 0.0 && galaxy.allowGiantKaltorGeneration) {
        galaxy.generateCreatureAtHabitat(CreatureType.Kaltor, habitat, true);
    }
    if (
        (builtObject.subRole === BuiltObjectSubRole.SmallSpacePort || builtObject.subRole === BuiltObjectSubRole.MediumSpacePort || builtObject.subRole === BuiltObjectSubRole.LargeSpacePort) &&
        builtObject.cargo !== null
    ) {
        const list = galaxy.resourceSystem.strategicResourcesOrderedByRelativeImportance;
        for (let i = 0; i < list.length; i++) {
            const resourceDefinition = list[i];
            if (resourceDefinition != null) {
                let amount = 300;
                if (resourceDefinition.isFuel) amount = 3000;
                builtObject.cargo.add(new Cargo(new ResourceRef(resourceDefinition.resourceId), amount, galaxy.independentEmpire));
            }
        }
    }
    galaxy.abandonedBuiltObjects.push(builtObject);
    galaxy.abandonedShipCount++;
    return builtObject;
}

/** Galaxy.3.cs 1057 CheckNearEmpireColony (FindNearestColony(x, y, null, 0) includes independents). */
function checkNearEmpireColony(galaxy: Galaxy, x: number, y: number, minimumRange: number): boolean {
    const habitat = galaxy.findNearestColony(x, y, null, true);
    if (habitat !== null) {
        const num = galaxy.calculateDistance(x, y, habitat.xpos, habitat.ypos);
        if (num < minimumRange) return true;
    }
    return false;
}

/** Galaxy.7.cs 1656 FindNearestHabitatEmptySystem(x, y) + FindNearestHabitatEmptySystemInIndex (2125). No Rnd. */
export function findNearestHabitatEmptySystem(galaxy: Galaxy, x: number, y: number): Habitat | null {
    const ix = Math.trunc(x);
    const iy = Math.trunc(y);
    return galaxy.ringSearch(ix, iy, (cx, cy) => {
        let habitat: Habitat | null = null;
        const habitatList = galaxy.habitatIndexGrid[cx][cy];
        let distance = Number.MAX_VALUE;
        let num = -1;
        let flag = false;
        for (let i = 0; i < habitatList.length; i++) {
            const h = habitatList[i];
            if ((h.category !== HabitatCategoryType.Planet && h.category !== HabitatCategoryType.Moon) || h.type === HabitatType.FrozenGasGiant || h.type === HabitatType.GasGiant || h.diameter < 60) continue;
            if (num !== h.systemIndex) {
                const dominantEmpire = galaxy.systems[h.systemIndex].dominantEmpire;
                flag = dominantEmpire != null && dominantEmpire.empire != null ? true : false;
                num = h.systemIndex;
            }
            if (flag || (h.empire !== null && h.empire !== galaxy.independentEmpire)) continue;
            const num2 = galaxy.calculateDistanceSquared(ix, iy, h.xpos, h.ypos);
            if (!(num2 < distance)) continue;
            const star = galaxy.systems[h.systemIndex].systemStar;
            // C# FindNearestBuiltObject(int, int, (Empire)null) (Galaxy.7.cs 795).
            const builtObject = galaxy.findNearestBuiltObjectOfEmpire(Math.trunc(star.xpos), Math.trunc(star.ypos), null);
            if (builtObject !== null && builtObject.empire !== null && builtObject.empire !== galaxy.independentEmpire) {
                const num3 = galaxy.calculateDistance(star.xpos, star.ypos, builtObject.xpos, builtObject.ypos);
                if (num3 < galaxy.maxSolarSystemSize * 2.1) continue;
            }
            habitat = h;
            distance = num2;
        }
        if (habitat !== null) distance = galaxy.calculateDistance(ix, iy, habitat.xpos, habitat.ypos);
        return { item: habitat, distance };
    });
}

/** Galaxy.3.cs 1524 FindLonelyHabitat(x, y[, habitatTypeToExclude = Undefined]). No Rnd. */
export function findLonelyHabitatAt(galaxy: Galaxy, x: number, y: number, habitatTypeToExclude: HabitatType = HabitatType.Undefined): Habitat | null {
    let habitat = findNearestHabitatEmptySystem(galaxy, x, y);
    if (habitat === null || (habitatTypeToExclude !== HabitatType.Undefined && habitat.type === habitatTypeToExclude)) habitat = galaxy.findNearestUncolonizedHabitat(x, y, HabitatType.Desert);
    if (habitat === null || (habitatTypeToExclude !== HabitatType.Undefined && habitat.type === habitatTypeToExclude)) habitat = galaxy.findNearestUncolonizedHabitat(x, y, HabitatType.Ice);
    if (habitat === null || (habitatTypeToExclude !== HabitatType.Undefined && habitat.type === habitatTypeToExclude)) habitat = galaxy.findNearestUncolonizedHabitat(x, y, HabitatType.Volcanic);
    return habitat;
}

/** Galaxy.3.cs 1487 FindNearestUncolonizedHabitatNonBarrenRock. No Rnd. */
function findNearestUncolonizedHabitatNonBarrenRock(galaxy: Galaxy, x: number, y: number): Habitat | null {
    let num = Number.MAX_VALUE;
    let num2 = Number.MAX_VALUE;
    let num3 = Number.MAX_VALUE;
    const habitat = galaxy.findNearestUncolonizedHabitat(x, y, HabitatType.Desert);
    const habitat2 = galaxy.findNearestUncolonizedHabitat(x, y, HabitatType.Ice);
    const habitat3 = galaxy.findNearestUncolonizedHabitat(x, y, HabitatType.Volcanic);
    if (habitat !== null) num = galaxy.calculateDistanceSquared(x, y, habitat.xpos, habitat.ypos);
    if (habitat2 !== null) num2 = galaxy.calculateDistanceSquared(x, y, habitat2.xpos, habitat2.ypos);
    if (habitat3 !== null) num3 = galaxy.calculateDistanceSquared(x, y, habitat3.xpos, habitat3.ypos);
    if (habitat3 !== null && num3 < num && num3 < num2) return habitat3;
    if (habitat !== null && num < num3 && num < num2) return habitat;
    if (habitat2 !== null && num2 < num && num2 < num3) return habitat2;
    return findLonelyHabitatAt(galaxy, x, y);
}

/**
 * Galaxy.3.cs 1425 FindLonelyHabitat(galaxyRadiusMinimum, galaxyRadiusMaximum, ruinTypeToExclude,
 * habitatTypeToExclude) — the 1410/1415/1420/1383/1388 overloads call it with (0,1) or (0.85,1).
 * habitatTypeToExclude is not read by this overload (as in C#).
 * Rnd: ObtainRandomGalaxyCoordinates(min,max) (NextDouble ×2); then, if any non-independent
 * colony exists, up to 120 more ObtainRandomGalaxyCoordinates (NextDouble ×2 each) while the
 * best point is within num2 (5,000,000 × 0.97^n) of a colony or excluded by a nearby ruin.
 */
export function findLonelyHabitat(galaxy: Galaxy, galaxyRadiusMinimum = 0.0, galaxyRadiusMaximum = 1.0, ruinTypeToExclude: RuinType = RuinType.Undefined, habitatTypeToExclude: HabitatType = HabitatType.Undefined): Habitat | null {
    void habitatTypeToExclude;
    let habitat: Habitat | null = null;
    let num = 0;
    const range = 800000.0;
    let val = Math.sqrt(1400.0) / Math.sqrt(galaxy.starCount);
    val = Math.max(1.0, Math.min(val, 2.5));
    void val;
    let num2 = 5000000.0;
    let p = galaxy.obtainRandomGalaxyCoordinatesInRadius(galaxyRadiusMinimum, galaxyRadiusMaximum);
    let x = p.x;
    let y = p.y;
    let num3 = 0.0;
    let x2 = x;
    let y2 = y;
    let habitat2 = galaxy.findNearestColony(x, y, null, false);
    if (habitat2 !== null) {
        let num4 = galaxy.calculateDistance(x, y, habitat2.xpos, habitat2.ypos);
        let flag = false;
        while ((num4 < num2 || !flag) && num < 120) {
            p = galaxy.obtainRandomGalaxyCoordinatesInRadius(galaxyRadiusMinimum, galaxyRadiusMaximum);
            x = p.x;
            y = p.y;
            habitat = findNearestHabitatEmptySystem(galaxy, x, y);
            if (habitat !== null) {
                x = habitat.xpos;
                y = habitat.ypos;
            }
            habitat2 = galaxy.findNearestColony(x, y, null, false);
            // C# dereferences habitat2 unconditionally (a colony existed at the first probe).
            num4 = galaxy.calculateDistance(x, y, habitat2!.xpos, habitat2!.ypos);
            flag = true;
            if (ruinTypeToExclude !== RuinType.Undefined) {
                const habitat3 = findNearestRuin(galaxy, x, y, ruinTypeToExclude);
                if (habitat3 !== null && habitat3.ruin !== null && habitat3.ruin.type === ruinTypeToExclude) {
                    const num5 = galaxy.calculateDistance(x, y, habitat3.xpos, habitat3.ypos);
                    if (num5 < 2000000.0) flag = false;
                }
            }
            if (flag && num4 > num3) {
                const galaxyLocationList = determineGalaxyLocationsInRangeAtPoint(galaxy, x, y, range, GalaxyLocationType.DebrisField);
                const galaxyLocationList2 = determineGalaxyLocationsInRangeAtPoint(galaxy, x, y, range, GalaxyLocationType.PlanetDestroyer);
                if ((galaxyLocationList == null || galaxyLocationList.length === 0) && (galaxyLocationList2 == null || galaxyLocationList2.length === 0)) {
                    num3 = num4;
                    x2 = x;
                    y2 = y;
                }
            }
            num++;
            num2 *= 0.97;
        }
    }
    return findNearestUncolonizedHabitatNonBarrenRock(galaxy, x2, y2);
}

/** Galaxy.3.cs 1383/1388 FindLonelyHabitatGalacticEdge(ruinTypeToExclude[, habitatTypeToExclude]). */
export function findLonelyHabitatGalacticEdge(galaxy: Galaxy, ruinTypeToExclude: RuinType, habitatTypeToExclude: HabitatType = HabitatType.Undefined): Habitat | null {
    return findLonelyHabitat(galaxy, 0.85, 1.0, ruinTypeToExclude, habitatTypeToExclude);
}

/**
 * Galaxy.3.cs 1356 FindLonelyDeepSpaceLocation(out x, out y).
 * Rnd: FindLonelyHabitat() (repeated while null, ≤ 200), up to 50 more FindLonelyHabitat() while
 * within 300,000 of a colony (independents included), SelectRelativeParkingPoint(150000)
 * (NextDouble, Next(0,2), NextDouble); if no habitat: NextDouble ×2.
 */
export function findLonelyDeepSpaceLocation(galaxy: Galaxy): { x: number; y: number } {
    let habitat = findLonelyHabitat(galaxy);
    const iterationCount = { value: 0 };
    while (conditionCheckLimit(habitat === null, 200, iterationCount)) habitat = findLonelyHabitat(galaxy);
    if (habitat !== null) {
        let num = 0;
        while (checkNearEmpireColony(galaxy, habitat.xpos, habitat.ypos, 300000.0) && num < 50) {
            habitat = findLonelyHabitat(galaxy)!;
            num++;
        }
        const p = galaxy.selectRelativeParkingPoint(150000.0);
        return { x: p.x + habitat.xpos, y: p.y + habitat.ypos };
    }
    const x = galaxy.rnd.nextDouble() * galaxy.sizeX;
    const y = galaxy.rnd.nextDouble() * galaxy.sizeY;
    return { x, y };
}

/** C# `if (!_RuinsHabitats.Contains(habitat)) _RuinsHabitats.Add(habitat);` */
function addRuinsHabitat(galaxy: Galaxy, habitat: Habitat): void {
    if (!galaxy.ruinsHabitats.includes(habitat)) galaxy.ruinsHabitats.push(habitat);
}

/** Galaxy.cs 5247 GenerateRuin(habitat, name, pictureRef, type). Rnd: surface point (NextDouble ×2), NextDouble. */
function generateRuin(galaxy: Galaxy, habitat: Habitat, name: string, pictureRef: number, type: RuinType): Ruin {
    galaxy.determineHabitatSystemStar(habitat);
    const p = galaxy.selectRelativeHabitatSurfacePoint(habitat);
    const ruin = new Ruin(name, pictureRef, 0.1 + galaxy.rnd.nextDouble() * 0.2, p.x, p.y, 0, 0, 0);
    ruin.type = type;
    return ruin;
}

/** Galaxy.6.cs 331 SelectRace(nativeHabitatType, raceFamilyIdsToExclude). Rnd: Next(0,20) per try (≤ 100). */
function selectRace(galaxy: Galaxy, nativeHabitatType: HabitatType, raceFamilyIdsToExclude: readonly number[]): Race | null {
    let race: Race | null = null;
    let num = 0;
    while ((race === null || race.nativeHabitatType !== nativeHabitatType || raceFamilyIdsToExclude.includes(race.raceFamily) || !race.playable) && num < 100) {
        const index = galaxy.rnd.next(0, 20);
        race = galaxy.races[index];
        num++;
    }
    return race;
}

/** RaceFamilyList.cs 18 GetIdsBySpecialFunctionCode. */
function raceFamilyIdsBySpecialFunctionCode(raceFamilies: readonly RaceFamily[], specialFunctionCode: number): number[] {
    const ids: number[] = [];
    for (const raceFamily of raceFamilies) if (raceFamily != null && raceFamily.specialFunctionCode === specialFunctionCode) ids.push(raceFamily.raceFamilyId);
    return ids;
}

/** GovernmentAttributesList.cs 30 GetFirstByAvailability. */
function governmentFirstByAvailability(availability: number): Government | null {
    for (const g of getGovernmentsStatic()) if (g !== null && g.availability === availability) return g;
    return null;
}

/**
 * Galaxy.6.cs 65-80 SelectSpecialRuins(habitat, eventMessageType[, race, specialValue]
 * [, allowCreatures = true]). Returns false only for a null habitat; true without change when the
 * habitat already has a ruin.
 * Rnd: surface point (NextDouble ×2), development bonus NextDouble; per type:
 * ExoticTechDiscovered Next(0,n), Next(0,2) (else GenerateRuinName); SleepersAwake SelectRace
 * draws [+ Next(0,20)], quality NextDouble when Quality < 0.5; SpecialGovernmentType Ancients:
 * Next(100,1000); Lost*: GenerateRuinName; then SelectRuinDescription; creatures: when
 * Owner == null && allowCreatures: Next(0,3), ==1 && CreaturePrevalence > 0 → Next(0,3)
 * [case 2: Next(2,4)] + GenerateCreatureAtHabitat draws.
 */
export function selectSpecialRuins(galaxy: Galaxy, habitat: Habitat | null, eventMessageType: SpecialRuinsEventType, raceFamilies: readonly RaceFamily[] | undefined, race: Race | null = null, specialValue = 0, allowCreatures = true): boolean {
    if (habitat === null) return false;
    if (habitat.ruin !== null) return true;
    let name = TEXT_ANCIENT_RUINS;
    let pictureRef = 0;
    const habitat2 = galaxy.determineHabitatSystemStar(habitat);
    const p = galaxy.selectRelativeHabitatSurfacePoint(habitat);
    const ruin = new Ruin(name, 0, 0.1 + galaxy.rnd.nextDouble() * 0.2, p.x, p.y, 0, 0, 0);
    let num = 0;
    switch (eventMessageType) {
        case SpecialRuinsEventType.ExoticTechDiscovered: {
            let num3 = 0;
            const researchNodeDefinitionList = (galaxy.researchStatic?.definitions ?? []).filter((d) => d.specialFunctionCode === 3);
            if (researchNodeDefinitionList.length > 0) {
                const index = galaxy.rnd.next(0, researchNodeDefinitionList.length);
                num3 = researchNodeDefinitionList[index].projectId;
                switch (galaxy.rnd.next(0, 2)) {
                    case 0:
                        name = `Hidden Fortress of ${habitat2.name}`;
                        pictureRef = 14;
                        break;
                    case 1:
                        name = 'Nexus of the Red Claw';
                        pictureRef = 7;
                        break;
                }
                ruin.type = RuinType.Component;
                ruin.researchProjectId = num3;
            } else {
                const r = generateRuinName(galaxy, habitat);
                name = r.name;
                pictureRef = r.pictureRef;
            }
            break;
        }
        case SpecialRuinsEventType.GalacticRefugees:
            ruin.type = RuinType.Refugees;
            ruin.refugeesGenerated = false;
            name = `Great Beacon of ${habitat2.name}`;
            pictureRef = 6;
            break;
        case SpecialRuinsEventType.LostBuiltObjectCoordinates: {
            ruin.type = RuinType.LostBuiltObject;
            ruin.lostBuiltObjectGenerated = false;
            const r = generateRuinName(galaxy, habitat);
            name = r.name;
            pictureRef = r.pictureRef;
            break;
        }
        case SpecialRuinsEventType.LostColonyCoordinates: {
            ruin.type = RuinType.LostColony;
            ruin.lostColonyGenerated = false;
            const r = generateRuinName(galaxy, habitat);
            name = r.name;
            pictureRef = r.pictureRef;
            break;
        }
        case SpecialRuinsEventType.OriginsDiscovery:
            ruin.originsRace = race;
            ruin.type = RuinType.Origins;
            ruin.originsApprovalRatingBonus = specialValue;
            name = `Great Archives of ${habitat2.name}`;
            pictureRef = 10;
            break;
        case SpecialRuinsEventType.SleepersAwake: {
            // Galaxy.RaceFamilies: ctx.raceFamilies, else galaxy.raceFamilies (empty unless createGame
            // copied GameData.raceFamilies there — then no family is excluded).
            if (raceFamilies === undefined) raceFamilies = galaxy.raceFamilies;
            let race2: Race | null = null;
            const iterationCount = { value: 0 };
            while (conditionCheckLimit(race2 === null || raceFamilyIdsBySpecialFunctionCode(raceFamilies, 1).includes(race2.raceFamily) || !race2.playable, 100, iterationCount)) {
                race2 = selectRace(galaxy, habitat.type, raceFamilyIdsBySpecialFunctionCode(raceFamilies, 1));
                if (race2 === null) {
                    num = galaxy.rnd.next(0, 20);
                    race2 = galaxy.races[num];
                }
            }
            if (race2 === null) race2 = galaxy.races[0];
            ruin.type = RuinType.NewPopulation;
            ruin.habitatNewRace = race2;
            if (habitat.quality < Math.fround(0.5)) habitat.baseQuality = Math.fround(0.5 + galaxy.rnd.nextDouble() * 0.3);
            if (race2 !== null) name = `Silent Chamber of the ${race2.name}s`;
            pictureRef = habitat.type !== HabitatType.Ice ? 1 : 0;
            break;
        }
        case SpecialRuinsEventType.SpecialGovernmentType: {
            let num2 = -1;
            const firstByAvailability = governmentFirstByAvailability(2);
            const firstByAvailability2 = governmentFirstByAvailability(3);
            if (firstByAvailability !== null && firstByAvailability2 !== null) {
                if (galaxy.ruinsGovernmentWayOfAncients < galaxy.ruinsGovernmentWayOfDarkness) {
                    num2 = firstByAvailability.governmentId;
                    galaxy.ruinsGovernmentWayOfAncients++;
                    name = `Imperial Archive ${galaxy.rnd.next(100, 1000).toString()}`;
                    pictureRef = 11;
                } else {
                    num2 = firstByAvailability2.governmentId;
                    galaxy.ruinsGovernmentWayOfDarkness++;
                    name = 'Temple of Eternal Blackness';
                    pictureRef = 12;
                }
                ruin.type = RuinType.Government;
                ruin.specialGovernmentId = num2;
            }
            break;
        }
    }
    void num;
    ruin.name = name;
    ruin.pictureRef = pictureRef;
    ruin.description = selectRuinDescription(galaxy, habitat);
    galaxy.ruinCount++;
    addRuinsHabitat(galaxy, habitat);
    if (habitat.owner === null && allowCreatures && galaxy.rnd.next(0, 3) === 1 && galaxy.creaturePrevalence > 0.0) {
        switch (galaxy.rnd.next(0, 3)) {
            case 0:
                galaxy.generateCreatureAtHabitat(CreatureType.Ardilus, habitat, true);
                break;
            case 1:
                if (galaxy.allowGiantKaltorGeneration) galaxy.generateCreatureAtHabitat(CreatureType.Kaltor, habitat, true);
                break;
            case 2:
                if (galaxy.allowGiantKaltorGeneration) {
                    const num4 = galaxy.rnd.next(2, 4);
                    for (let i = 0; i < num4; i++) galaxy.generateCreatureAtHabitat(CreatureType.Kaltor, habitat, true);
                }
                break;
        }
    }
    habitat.ruin = ruin;
    return true;
}

// ---------------------------------------------------------------------------
// Start.2.cs blocks
// ---------------------------------------------------------------------------

export interface GameStartTailContext {
    /** Start.2.cs empire2 (the player's empire). */
    playerEmpire: Empire;
    /** Start.2.cs empireList (the starting empires, player first). Default: galaxy.empires. */
    empireList?: readonly Empire[];
    /** Start.2.cs double_2 (wizard creature prevalence; = Galaxy.CreaturePrevalence, method_78 106). Default galaxy.creaturePrevalence. */
    creaturePrevalence?: number;
    /** Start.2.cs int_1 (wizard star count). Default galaxy.starCount. */
    starCount?: number;
    /** Our addition: scale the Distant Worlds debris fields with the star count (storyStart.debrisFieldCounts). Default false. */
    scaleDebrisFields?: boolean;
    /** Start.2.cs xpos / ypos: the player's start (capital, or pirate base) — read by the story blocks. Default 0. */
    xpos?: number;
    ypos?: number;
    /** empireStart_0.TechLevel (player tech level; only read with the Shakturi story). */
    playerTechLevel?: number;
    /** empireStart_0.Age (Game.AgeOfShadows when 0). Default galaxy.age. */
    playerAge?: number;
    /** Start.2.cs bool_2 PlayAsAPirate. */
    playAsPirate?: boolean;
    /** VictoryConditions.EnableStoryEventsShadows. */
    enableStoryEventsShadows?: boolean;
    /** Start.2.cs bool_3: the wizard's Shadows playstyles (Start.cs btnStartNewGameYourEmpireTypeNormalShadows / PirateShadows)
     *  start an Age of Shadows game whatever the player's age (2020-2023 only adds Age == 0). Default false. */
    ageOfShadows?: boolean;
    /** Galaxy.RaceFamilies (GameData.raceFamilies): SelectSpecialRuins(SleepersAwake) reads SpecialFunctionCode 1 families. Default galaxy.raceFamilies. */
    raceFamilies?: readonly RaceFamily[];
}

export interface GameStartTailResult {
    /** Game.AgeOfShadows (Start.2.cs 2020-2024: set when empireStart_0.Age == 0). */
    ageOfShadows: boolean;
    /** Game.PlayAsAPirate. */
    playAsAPirate: boolean;
    /** Start.2.cs 2031-2034: set PlayerEmpire.PreWarpProgressEventOccurredSendPirateRaid = false. */
    clearPreWarpSendPirateRaid: boolean;
}

/**
 * Start.2.cs 1568-1583: for every empire in Galaxy.Empires, tear down all creatures in its
 * capital's system (copied first; Creature.CompleteTeardown, creature.ts). No Rnd.
 */
export function capitalCreatureTeardown(galaxy: Galaxy): void {
    for (const empire9 of galaxy.empires) {
        const systemInfo2 = galaxy.systems[empire9.capital!.systemIndex];
        if (systemInfo2.creatures == null || systemInfo2.creatures.length <= 0) continue;
        const creatureList = systemInfo2.creatures.slice();
        for (const item10 of creatureList) item10.completeTeardown();
    }
}

/**
 * Start.2.cs 1585-1729 `if (galaxy.Age == 0)`: per Galaxy.Empires empire with a capital —
 * a home asteroid field (80-149 asteroids at 6000-13999 from the home star), 2 rock space slugs
 * on it (creature prevalence > 0), a definite scenic factor on the first BarrenRock planet or
 * Volcanic/Desert/MarshySwamp/Ocean/Ice planet/moon and a definite research bonus on the first
 * FrozenGasGiant (Systems[star].Habitats order, asteroids last), an abandoned hyperdrive-less
 * Frigate at the home system's (frozen) gas giant, a damaged hyperdrive-less Destroyer at the
 * nearest ruin when it is in the home system, and a definite ruin on the furthest
 * Volcanic/Desert/Ice/MarshySwamp/BarrenRock habitat ≥ 4000 from the capital.
 *
 * Rnd per empire, in order: Next(6000,14000), NextDouble (angle), Next(80,150) (count),
 * GenerateAsteroidField (per asteroid: Next(10,25), Next(0,30)[, Next(26,45)], Next(0,10),
 * NextDouble ×4 [+ NextDouble ×2], GenerateCodeName, SelectResources, SelectHabitatPictures,
 * Next(0,1300)[→ treasure]); [2 × (Next(0,count) + GenerateCreatureAtHabitat)]; SetScenicFactor /
 * SetResearchBonus draws; GenerateDesignFromSpec(Frigate) draws; [abandoned frigate: name,
 * parking point, heading]; GenerateDesignFromSpec(Destroyer) draws; [abandoned destroyer: name,
 * parking point, heading, Next(0,3) (+ Next(3,5) | NextDouble)]; [SelectRuins draws].
 */
export function homeAsteroidFieldsAtStart(galaxy: Galaxy, creaturePrevalence: number = galaxy.creaturePrevalence): void {
    if (galaxy.age !== 0) return;
    for (const empire10 of galaxy.empires) {
        if (empire10.capital === null) continue;
        const capital = empire10.capital;
        const habitat14 = galaxy.determineHabitatSystemStar(capital);
        const num48 = galaxy.rnd.next(6000, 14000);
        const num49 = galaxy.rnd.nextDouble() * Math.PI * 2.0;
        const num50 = habitat14.xpos + Math.cos(num49) * num48;
        const num51 = habitat14.ypos + Math.sin(num49) * num48;
        const habitatList2 = galaxy.generateAsteroidField(galaxy.rnd.next(80, 150), num50, num51, habitat14, true, 2, Math.trunc(num48), 1.0, 1.0, HabitatType.BarrenRock);
        // C# Monitor.Enter(galaxy._LockObject) around AddAsteroidField — no-op here.
        galaxy.addAsteroidField(habitatList2, habitat14);
        for (let num52 = 0; num52 < habitatList2.length; num52++) empire10.resourceMap.setResourcesKnown(habitatList2[num52], false);
        if (creaturePrevalence > 0.0) {
            for (let num53 = 0; num53 < 2; num53++) {
                const index2 = galaxy.rnd.next(0, habitatList2.length);
                galaxy.generateCreatureAtHabitat(CreatureType.RockSpaceSlug, habitatList2[index2], true, 0, 0);
            }
        }
        let num54 = 0;
        let num55 = 0;
        const systemInfo3Habitats = systemHabitatsByStar(galaxy, habitat14);
        if (systemInfo3Habitats !== null) {
            for (let num56 = 0; num56 < systemInfo3Habitats.length; num56++) {
                const habitat15 = systemInfo3Habitats[num56];
                if (habitat15 == null) continue;
                switch (habitat15.type) {
                    case HabitatType.BarrenRock:
                        if (habitat15.category === HabitatCategoryType.Planet && num55 <= 0) {
                            galaxy.setScenicFactor(habitat15, true);
                            num55++;
                        }
                        break;
                    case HabitatType.Volcanic:
                    case HabitatType.Desert:
                    case HabitatType.MarshySwamp:
                    case HabitatType.Ocean:
                    case HabitatType.Ice:
                        if ((habitat15.category === HabitatCategoryType.Planet || habitat15.category === HabitatCategoryType.Moon) && num55 <= 0) {
                            galaxy.setScenicFactor(habitat15, true);
                            num55++;
                        }
                        break;
                    case HabitatType.FrozenGasGiant:
                        if (num54 <= 0) {
                            galaxy.setResearchBonus(habitat15, true);
                            num54++;
                        }
                        break;
                }
            }
        }
        const currentStarDate = galaxyCurrentStarDate(galaxy);
        const design = requireDesign(generateDesignFromSpec(galaxy, empire10, getBySubRole(empire10.designSpecifications, BuiltObjectSubRole.Frigate), 1.0, currentStarDate), 'Start.2.cs 1664');
        // design.PictureRef = ShipImageHelper.ResolveMinorShipImageIndex(design.SubRole, largeShips: false);
        // TODO(port): ShipImageHelper (own _Rnd, picture only).
        removeAllByComponentCategory(design, ComponentCategoryType.HyperDrive);
        design.reDefine();
        let habitat16 = galaxy.findNearestHabitatOfType(capital.xpos, capital.ypos, HabitatType.FrozenGasGiant);
        if (habitat16 === null || habitat16.systemIndex !== habitat14.systemIndex) habitat16 = galaxy.findNearestHabitatOfType(capital.xpos, capital.ypos, HabitatType.GasGiant);
        if (habitat16 !== null && habitat16.systemIndex === habitat14.systemIndex) {
            const builtObject = generateAbandonedBuiltObject(galaxy, habitat16, design, false, false, BuiltObjectEncounterAction.Prompt);
            builtObject.encounterEventType = BuiltObjectEncounterEventType.Acquire;
            builtObject.encounterDescription = TEXT_PREWARP_ABANDONED_SHIP_ENCOUNTER;
        }
        const design2 = requireDesign(generateDesignFromSpec(galaxy, empire10, getBySubRole(empire10.designSpecifications, BuiltObjectSubRole.Destroyer), 3.0, currentStarDate), 'Start.2.cs 1678');
        removeAllByComponentCategory(design2, ComponentCategoryType.HyperDrive);
        design2.reDefine();
        habitat16 = findNearestRuin(galaxy, capital.xpos, capital.ypos);
        if (habitat16 !== null && habitat16.systemIndex === habitat14.systemIndex) {
            const builtObject2 = generateAbandonedBuiltObject(galaxy, habitat16, design2, false, false, BuiltObjectEncounterAction.Prompt);
            damageBuiltObjectComponents(builtObject2, 0.5);
            builtObject2.encounterEventType = BuiltObjectEncounterEventType.Acquire;
            switch (galaxy.rnd.next(0, 3)) {
                case 0:
                    builtObject2.encounterExplorationBonus = toShort(galaxy.rnd.next(3, 5));
                    break;
                case 1:
                    builtObject2.encounterMoneyBonus = Math.trunc(2000.0 + galaxy.rnd.nextDouble() * 2000.0);
                    break;
                case 2:
                    builtObject2.encounterTechAdvanceCount = 1;
                    break;
            }
        }
        const sys = systemInfo3Habitats!; // C# dereferences systemInfo3.Habitats here unconditionally.
        let habitat17 = getFurthestHabitat(sys, capital.xpos, capital.ypos, HabitatType.Volcanic, 4000.0);
        if (habitat17 === null) {
            habitat17 = getFurthestHabitat(sys, capital.xpos, capital.ypos, HabitatType.Desert, 4000.0);
            if (habitat17 === null) {
                habitat17 = getFurthestHabitat(sys, capital.xpos, capital.ypos, HabitatType.Ice, 4000.0);
                if (habitat17 === null || habitat17.category === HabitatCategoryType.Asteroid) {
                    habitat17 = getFurthestHabitat(sys, capital.xpos, capital.ypos, HabitatType.MarshySwamp, 4000.0);
                    if (habitat17 === null) {
                        habitat17 = getFurthestHabitat(sys, capital.xpos, capital.ypos, HabitatType.BarrenRock, 4000.0);
                        if (habitat17 === null || habitat17.category === HabitatCategoryType.Asteroid) habitat17 = null;
                    }
                }
            }
        }
        if (habitat17 !== null && habitat17.ruin === null) selectRuins(galaxy, habitat17, true, false, false, false);
    }
}

/**
 * Start.2.cs 1730-1767 `if (empireStart_0.TechLevel != 0.0 && galaxy.StoryReturnOfTheShakturiEnabled)`: the Ancient Guardians
 * on "Utopia" near the player's start (xpos, ypos) — story/storyStart.ts (M4z3).
 */
export function shakturiStoryAtStart(galaxy: Galaxy, playerTechLevel: number, xpos = 0.0, ypos = 0.0): void {
    storyStart.shakturiStoryAtStart(galaxy, playerTechLevel, xpos, ypos);
}

/**
 * Start.2.cs 1768-1844: the Distant Worlds story clue locations and special zones; returns galaxyLocationList3 (the
 * restricted zones created) — story/storyStart.ts (M4z3).
 */
export function distantWorldsStoryCluesAtStart(galaxy: Galaxy, xpos = 0.0, ypos = 0.0): GalaxyLocation[] {
    return storyStart.distantWorldsStoryCluesAtStart(galaxy, xpos, ypos);
}

/**
 * Galaxy.7.cs 4883 SetEmpireKnownGalacticHistoryLocations(empire, amount, x, y, locationsToExclude):
 * the empire learns its `amount` nearest RestrictedArea locations (distance to the location's
 * Xpos/Ypos corner). No Rnd.
 */
export function setEmpireKnownGalacticHistoryLocations(galaxy: Galaxy, empire: Empire, amount: number, x: number, y: number, locationsToExclude: readonly GalaxyLocation[]): void {
    if (amount <= 0) return;
    const galaxyLocationList = galaxy.galaxyLocations.filter((l) => l.type === GalaxyLocationType.RestrictedArea);
    if (galaxyLocationList.length <= 0) return;
    const known = empire.visibility.knownGalaxyLocations;
    for (let i = 0; i < amount; i++) {
        let galaxyLocation: GalaxyLocation | null = null;
        let num = Number.MAX_VALUE;
        for (let j = 0; j < galaxyLocationList.length; j++) {
            const galaxyLocation2 = galaxyLocationList[j];
            if (galaxyLocation2 != null && !locationsToExclude.includes(galaxyLocation2) && !known.includes(galaxyLocation2)) {
                const num2 = galaxy.calculateDistance(x, y, galaxyLocation2.xpos, galaxyLocation2.ypos);
                if (num2 < num) {
                    galaxyLocation = galaxyLocation2;
                    num = num2;
                }
            }
        }
        if (galaxyLocation !== null) {
            if (!known.includes(galaxyLocation)) known.push(galaxyLocation);
            galaxyLocationList.splice(galaxyLocationList.indexOf(galaxyLocation), 1);
        }
    }
}

/** Race.cs 216 KnownStartingGalacticHistoryLocations (race file key; clamped 0-10 by Race.cs 1595). Not a TS Race field: read from Race.extra. */
function knownStartingGalacticHistoryLocations(race: Race): number {
    const raw = race.extra?.['KnownStartingGalacticHistoryLocations'];
    if (raw === undefined) return 0;
    const v = parseInt(raw.trim(), 10);
    return Math.min(10, Math.max(0, Number.isNaN(v) ? 0 : v));
}

/** Start.2.cs 1845-1852: empires whose race knows starting galactic history locations learn them. No Rnd. */
export function setKnownGalacticHistoryLocationsAtStart(galaxy: Galaxy, empireList: readonly Empire[], galaxyLocationList3: readonly GalaxyLocation[]): void {
    for (let num68 = 0; num68 < empireList.length; num68++) {
        const empire7 = empireList[num68];
        if (empire7 != null && empire7.dominantRace !== null && knownStartingGalacticHistoryLocations(empire7.dominantRace) > 0) {
            setEmpireKnownGalacticHistoryLocations(galaxy, empire7, knownStartingGalacticHistoryLocations(empire7.dominantRace), empire7.capital!.xpos, empire7.capital!.ypos, galaxyLocationList3);
        }
    }
}

/**
 * Galaxy.4.cs 3120 SetSingleRestrictedResource(resourceId, habitatType, nameIfMoon, out nameUsed).
 * Rnd: FindLonelyDeepSpaceLocation; per retry (≤ 100): Next(700,1000) on success, else another
 * FindLonelyDeepSpaceLocation.
 */
function setSingleRestrictedResource(galaxy: Galaxy, resourceId: number, habitatType: HabitatType, nameIfMoon: string): boolean {
    let nameUsed = false;
    let p = findLonelyDeepSpaceLocation(galaxy);
    let habitat = galaxy.findNearestHabitatOfType(p.x, p.y, habitatType);
    let flag = false;
    let num = 0;
    while (!flag && num < 100) {
        if (habitat !== null) {
            let flag2 = true;
            const habitat2 = galaxy.findNearestColony(habitat.xpos, habitat.ypos, null, false);
            if (habitat2 !== null) {
                const num2 = galaxy.calculateDistance(habitat2.xpos, habitat2.ypos, habitat.xpos, habitat.ypos);
                if (num2 < galaxy.maxSolarSystemSize * 2.1) flag2 = false;
            }
            if (habitat.resources.length >= 5) flag2 = false;
            // HabitatResourceList.IndexOf(resourceId, 0) (125) >= 0 ⇔ the resource is present.
            const num3 = habitat.resources.findIndex((r) => r.resourceId === resourceId);
            if (num3 >= 0) flag2 = false;
            if (flag2) {
                habitat.resources.push({ resourceId, abundance: toShort(galaxy.rnd.next(700, 1000)) });
                flag = true;
                if (nameIfMoon !== '' && habitat.category === HabitatCategoryType.Moon) {
                    habitat.name = nameIfMoon;
                    nameUsed = true;
                }
            } else {
                p = findLonelyDeepSpaceLocation(galaxy);
                habitat = galaxy.findNearestHabitatOfType(p.x, p.y, habitatType);
            }
        }
        num++;
    }
    return nameUsed;
}

// Galaxy.4.cs 774 ResolveHabitatTypeByIndexIncludeGasClouds (resources.txt SubType → HabitatType).
function resolveHabitatTypeByIndexIncludeGasClouds(galaxy: Galaxy, index: number): HabitatType {
    return (galaxy as unknown as { resolveHabitatTypeByIndexIncludeGasClouds(i: number): HabitatType }).resolveHabitatTypeByIndexIncludeGasClouds(index);
}

/**
 * Start.2.cs 1853-1856 → Galaxy.4.cs 3074 SetRestrictedResources: for each super-luxury resource
 * and each of its prevalence entries, max(1, (int)(Prevalence * (StarCount / 700f))) (float math)
 * single restricted deposits; planet/moon entries of Korabbian Spice / Loros Fruit / Zentabia
 * Fluid rename the first moon they land on. Rnd: see setSingleRestrictedResource.
 */
export function setRestrictedResources(galaxy: Galaxy): void {
    const list = galaxy.resourceSystem.superLuxuryResources;
    for (let i = 0; i < list.length; i++) {
        const resourceDefinition = list[i];
        if (resourceDefinition == null || resourceDefinition.distributions == null) continue;
        for (let j = 0; j < resourceDefinition.distributions.length; j++) {
            const dist = resourceDefinition.distributions[j];
            if (dist == null) continue;
            // ResourcePrevalence (ResourceSystem.cs 571-587): Type 1 asteroid, 2 gas cloud; float Prevalence.
            const habitatIsAsteroid = dist.type === 1;
            const habitatIsGasCloud = dist.type === 2;
            const habitatType = resolveHabitatTypeByIndexIncludeGasClouds(galaxy, dist.subType);
            const prevalence = Math.fround(dist.prevalence);
            const num = Math.max(1, Math.trunc(Math.fround(prevalence * Math.fround(Math.fround(galaxy.starCount) / Math.fround(700)))));
            let nameUsed = false;
            let nameIfMoon = '';
            if (!habitatIsAsteroid && !habitatIsGasCloud) {
                switch (resourceDefinition.name) {
                    case 'Korabbian Spice':
                        nameIfMoon = 'Korabbia';
                        break;
                    case 'Loros Fruit':
                        nameIfMoon = 'Loros';
                        break;
                    case 'Zentabia Fluid':
                        nameIfMoon = 'Zentabia';
                        break;
                }
            }
            for (let k = 0; k < num; k++) {
                if (nameUsed) nameIfMoon = '';
                nameUsed = setSingleRestrictedResource(galaxy, resourceDefinition.resourceId, habitatType, nameIfMoon);
            }
        }
    }
}

/**
 * Start.2.cs 1857-1860 → Galaxy.6.cs 344 GenerateSilverMistRuins: when GameDisasterEventsEnabled
 * and CreaturePrevalence > 0, max(1, min(3, StarCount / 450)) lonely CreatureSwarmSilverMist ruins.
 * Rnd per ruin: FindLonelyHabitat(SilverMist); SelectRuinDescription, GenerateRuinName, surface
 * point (NextDouble ×2), NextDouble.
 */
export function generateSilverMistRuins(galaxy: Galaxy): void {
    if (!galaxy.gameDisasterEventsEnabled || !(galaxy.creaturePrevalence > 0.0)) return;
    const num = Math.max(1, Math.min(3, Math.trunc(galaxy.starCount / 450)));
    for (let i = 0; i < num; i++) {
        const habitat = findLonelyHabitat(galaxy, 0.0, 1.0, RuinType.CreatureSwarmSilverMist);
        if (habitat !== null) {
            generateSilverMistRuin(galaxy, habitat);
            galaxy.silverMistCreatureRuinsHabitat = habitat;
        }
    }
}

/** Galaxy.6.cs 362 GenerateSilverMistRuin. */
export function generateSilverMistRuin(galaxy: Galaxy, habitat: Habitat): void {
    const description = selectRuinDescription(galaxy, habitat);
    const r = generateRuinName(galaxy, habitat);
    const p = galaxy.selectRelativeHabitatSurfacePoint(habitat);
    const ruin = new Ruin(r.name, r.pictureRef, 0.1 + galaxy.rnd.nextDouble() * 0.2, p.x, p.y, 0, 0, 0);
    ruin.type = RuinType.CreatureSwarmSilverMist;
    ruin.description = description;
    habitat.ruin = ruin;
    galaxy.ruinCount++;
    addRuinsHabitat(galaxy, habitat);
}

/**
 * Start.2.cs 1861-1864 → Galaxy.5.cs 5518 GenerateSpecialBonusRuins: seven lonely EmpireBonus
 * ruins (BarrenRock excluded), description "" (RuinCount not incremented, as in C#).
 * Rnd per ruin: FindLonelyHabitat(EmpireBonus), GenerateRuin (NextDouble ×3).
 */
export function generateSpecialBonusRuins(galaxy: Galaxy): void {
    const specs: [string, number, (ruin: Ruin) => void][] = [
        ['Energy Engineering Facility', 7, (r) => (r.bonusResearchEnergy = 0.5)],
        ['Techno Nexus', 7, (r) => (r.bonusResearchHighTech = 0.5)],
        ['Carida Armaments Installation', 7, (r) => (r.bonusResearchWeapons = 0.5)],
        ['Unity Forum', 3, (r) => (r.bonusDiplomacy = 0.2)],
        ['Garden of Arcadia', 0, (r) => (r.bonusHappiness = 0.1)],
        ['Great Mercantile Exchange', 8, (r) => (r.bonusWealth = 0.1)],
        ['Fortress of Torak', 14, (r) => (r.bonusDefensive = 1.0)],
    ];
    for (const [name, pictureRef, setBonus] of specs) {
        const habitat = findLonelyHabitat(galaxy, 0.0, 1.0, RuinType.EmpireBonus, HabitatType.BarrenRock);
        if (habitat !== null) {
            habitat.ruin = generateRuin(galaxy, habitat, name, pictureRef, RuinType.EmpireBonus);
            setBonus(habitat.ruin);
            habitat.ruin.description = '';
            addRuinsHabitat(galaxy, habitat);
        }
    }
}

/**
 * Start.2.cs 1865-1967: special ruins, counts from int_1 (star count):
 *   num74 = max(1, min(2, n/350)) × 2 Government (SpecialGovernmentType; `while (!flag6)` retries
 *   only on a null habitat), num75 × 2 Component (ExoticTechDiscovered), num69 = max(1, n/270)
 *   Refugees at the galactic edge, num70 = max(1, n/110) LostBuiltObject, num71 = max(1, n/170)
 *   LostColony, [story: num72 = min(6, max(1, n/160)) Origins], num73 = max(1, n/140) NewPopulation
 *   (SleepersAwake). Rnd: FindLonelyHabitat + SelectSpecialRuins draws per ruin.
 * The Origins sub-block (StoryDistantWorldsEnabled) is story/storyStart.ts originsRuinsAtStart (M4z3).
 */
export function placeSpecialRuinsAtStart(galaxy: Galaxy, int1: number = galaxy.starCount, raceFamilies?: readonly RaceFamily[]): void {
    const num69 = Math.max(1, Math.trunc(int1 / 270.0));
    const num70 = Math.max(1, Math.trunc(int1 / 110.0));
    const num71 = Math.max(1, Math.trunc(int1 / 170.0));
    const num72 = Math.min(6, Math.max(1, Math.trunc(int1 / 160.0)));
    const num73 = Math.max(1, Math.trunc(int1 / 140.0));
    const num74 = Math.max(1, Math.min(2, Math.trunc(int1 / 350.0)));
    const num75 = Math.max(1, Math.min(2, Math.trunc(int1 / 350.0)));
    let habitat20: Habitat | null = null;
    let flag6 = false;
    for (let num76 = 0; num76 < num74; num76++) {
        while (!flag6) {
            habitat20 = findLonelyHabitat(galaxy, 0.0, 1.0, RuinType.Government, HabitatType.BarrenRock);
            flag6 = selectSpecialRuins(galaxy, habitat20, SpecialRuinsEventType.SpecialGovernmentType, raceFamilies);
        }
        flag6 = false;
        while (!flag6) {
            habitat20 = findLonelyHabitat(galaxy, 0.0, 1.0, RuinType.Government, HabitatType.BarrenRock);
            flag6 = selectSpecialRuins(galaxy, habitat20, SpecialRuinsEventType.SpecialGovernmentType, raceFamilies);
        }
    }
    flag6 = false;
    for (let num77 = 0; num77 < num75; num77++) {
        while (!flag6) {
            habitat20 = findLonelyHabitat(galaxy, 0.0, 1.0, RuinType.Component, HabitatType.BarrenRock);
            flag6 = selectSpecialRuins(galaxy, habitat20, SpecialRuinsEventType.ExoticTechDiscovered, raceFamilies);
        }
        flag6 = false;
        while (!flag6) {
            habitat20 = findLonelyHabitat(galaxy, 0.0, 1.0, RuinType.Component, HabitatType.BarrenRock);
            flag6 = selectSpecialRuins(galaxy, habitat20, SpecialRuinsEventType.ExoticTechDiscovered, raceFamilies);
        }
    }
    flag6 = false;
    void flag6;
    for (let num78 = 0; num78 < num69; num78++) {
        habitat20 = findLonelyHabitatGalacticEdge(galaxy, RuinType.Refugees, HabitatType.BarrenRock);
        selectSpecialRuins(galaxy, habitat20, SpecialRuinsEventType.GalacticRefugees, raceFamilies);
    }
    for (let num79 = 0; num79 < num70; num79++) {
        habitat20 = findLonelyHabitat(galaxy, 0.0, 1.0, RuinType.LostBuiltObject);
        selectSpecialRuins(galaxy, habitat20, SpecialRuinsEventType.LostBuiltObjectCoordinates, raceFamilies);
    }
    for (let num80 = 0; num80 < num71; num80++) {
        habitat20 = findLonelyHabitat(galaxy, 0.0, 1.0, RuinType.LostColony);
        selectSpecialRuins(galaxy, habitat20, SpecialRuinsEventType.LostColonyCoordinates, raceFamilies);
    }
    storyStart.originsRuinsAtStart(galaxy, num72, raceFamilies); // 1921-1961 (Distant Worlds story; story/storyStart.ts)
    for (let num82 = 0; num82 < num73; num82++) {
        habitat20 = findLonelyHabitat(galaxy, 0.0, 1.0, RuinType.NewPopulation, HabitatType.BarrenRock);
        selectSpecialRuins(galaxy, habitat20, SpecialRuinsEventType.SleepersAwake, raceFamilies);
    }
}

/**
 * Start.2.cs 1968-2010: `galaxyLocationList4 = GalaxyLocations.FindLocations(DebrisField)`; when StoryDistantWorldsEnabled:
 * large/small debris fields and planet destroyers by the wizard star count (int_1) — story/storyStart.ts (M4z3).
 */
export function debrisFieldsAtStart(galaxy: Galaxy, int1: number = galaxy.starCount, scale = false): void {
    storyStart.debrisFieldsAtStart(galaxy, int1, scale);
}

/** Start.2.cs 2725 method_93(galaxy, min, max): random point in a ring around the galaxy centre. Rnd: NextDouble ×2, Next(0,2) ×2. */
export function method93(galaxy: Galaxy, double1: number, double2: number): { x: number; y: number } {
    const num = galaxy.sizeX / 2.0;
    const num2 = galaxy.sizeY / 2.0;
    const num3 = galaxy.sizeX / 2.0;
    const num4 = num3 * double1;
    const num5 = galaxy.rnd.nextDouble() * num3 * (double2 - double1);
    const num6 = num4 + num5;
    const num7 = galaxy.rnd.nextDouble() * Math.PI * 2.0;
    let num8 = Math.cos(num7) * num6;
    let num9 = Math.sin(num7) * num6;
    // Custom size (not a port): a non-square galaxy stretches the ring's y offset by SizeY / SizeX (the C# galaxy is square).
    if (galaxy.sizeX !== galaxy.sizeY) num9 *= galaxy.sizeY / galaxy.sizeX;
    if (galaxy.rnd.next(0, 2) === 1) num8 *= -1.0;
    if (galaxy.rnd.next(0, 2) === 1) num9 *= -1.0;
    return { x: num + num8, y: num2 + num9 };
}

/**
 * Start.2.cs 2011 → method_87 (2447): (int)(sqrt(StarCount) * 0.7) abandoned ships/bases scattered
 * around the galaxy (≤ 5000 tries), each from a random empire's newest design (mining / gas mining
 * station at a strategic resource, colony ship, destroyer/cruiser/capital ship, or a monitoring
 * station), placed only when > 2.1 × MaxSolarSystemSize from the nearest non-independent colony
 * (measured from (Xpos, Xpos) — C# typo kept) and no base within 500.
 * Rnd per try: method_93 (NextDouble ×2, Next(0,2) ×2), Next(0,4), Next(0,Empires.Count) [or
 * pirates], case draws (Next(0,2), Next(0,n) | Next(0,3) | monitoring-station design), [pirate
 * GenerateDesignFromSpec], [GenerateAbandonedBuiltObject(habitat, clone) with creatures and
 * negative effects].
 */
export function abandonedShipsAtStart(galaxy: Galaxy): void {
    const num = Math.trunc(Math.sqrt(galaxy.starCount) * 0.7);
    let num2 = 0;
    let num3 = 0;
    while (num2 < num && num3 < 5000) {
        const d = method93(galaxy, 0.0, 1.05);
        let habitat = galaxy.findNearestColony(d.x, d.y, null, false);
        let habitat2: Habitat | null = null;
        let design: Design | null = null;
        let num4 = 0;
        const num5 = galaxy.rnd.next(0, 4);
        let subRole = BuiltObjectSubRole.Undefined;
        let empire: Empire | null = null;
        if (galaxy.empires.length > 0) {
            num4 = galaxy.rnd.next(0, galaxy.empires.length);
            empire = galaxy.empires[num4];
        } else if (galaxy.pirateEmpires.length > 0) {
            num4 = galaxy.rnd.next(0, galaxy.pirateEmpires.length);
            empire = galaxy.pirateEmpires[num4];
        }
        if (empire !== null && empire.designs != null) {
            switch (num5) {
                case 0: {
                    let resourceId: number | null = null;
                    if (galaxy.rnd.next(0, 2) === 1) {
                        if (galaxy.resourceSystem.mineralStrategicResources.length > 0) {
                            const index = galaxy.rnd.next(0, galaxy.resourceSystem.mineralStrategicResources.length);
                            resourceId = galaxy.resourceSystem.mineralStrategicResources[index].resourceId;
                            design = findNewest(empire.designs, BuiltObjectSubRole.MiningStation);
                            subRole = BuiltObjectSubRole.MiningStation;
                        }
                    } else if (galaxy.resourceSystem.gasStrategicResources.length > 0) {
                        const index2 = galaxy.rnd.next(0, galaxy.resourceSystem.gasStrategicResources.length);
                        resourceId = galaxy.resourceSystem.gasStrategicResources[index2].resourceId;
                        design = findNewest(empire.designs, BuiltObjectSubRole.GasMiningStation);
                        subRole = BuiltObjectSubRole.GasMiningStation;
                    }
                    if (resourceId !== null) habitat2 = galaxy.findNearestHabitatWithResource(d.x, d.y, resourceId);
                    break;
                }
                case 1:
                    design = findNewest(empire.designs, BuiltObjectSubRole.ColonyShip);
                    if (design !== null && design.warpSpeed <= 0) design = null;
                    subRole = BuiltObjectSubRole.ColonyShip;
                    habitat2 = galaxy.findNearestHabitatOfType(d.x, d.y, HabitatType.Undefined);
                    break;
                case 2:
                    switch (galaxy.rnd.next(0, 3)) {
                        case 0:
                            design = findNewest(empire.designs, BuiltObjectSubRole.Destroyer);
                            subRole = BuiltObjectSubRole.Destroyer;
                            break;
                        case 1:
                            design = findNewest(empire.designs, BuiltObjectSubRole.Cruiser);
                            subRole = BuiltObjectSubRole.Cruiser;
                            break;
                        case 2:
                            design = findNewest(empire.designs, BuiltObjectSubRole.CapitalShip);
                            subRole = BuiltObjectSubRole.CapitalShip;
                            break;
                    }
                    if (design !== null && design.warpSpeed <= 0) design = null;
                    habitat2 = galaxy.findNearestHabitatOfType(d.x, d.y, HabitatType.Undefined);
                    break;
                case 3: {
                    const monitoringStationDesignSpec = getMonitoringStationDesignSpec();
                    design = requireDesign(generateDesignFromSpec(galaxy, empire, monitoringStationDesignSpec, 3.0, galaxyCurrentStarDate(galaxy)), 'Start.2.cs 2536');
                    subRole = BuiltObjectSubRole.MonitoringStation;
                    design.name = 'Monitoring Station';
                    habitat2 = galaxy.findNearestHabitatOfType(d.x, d.y, HabitatType.Undefined);
                    break;
                }
            }
        }
        if (design === null) {
            let empire2: Empire | null = null;
            for (let i = 0; i < galaxy.pirateEmpires.length; i++) {
                if (galaxy.pirateEmpires[i] !== galaxy.playerEmpire) {
                    empire2 = galaxy.pirateEmpires[i];
                    break;
                }
            }
            if (empire2 !== null) design = generateDesignFromSpec(galaxy, empire2, galaxyDesignSpecificationBySubRole(subRole), 2.0, galaxyCurrentStarDate(galaxy));
        }
        if (design !== null && habitat2 !== null) {
            habitat = galaxy.findNearestColony(habitat2.xpos, habitat2.xpos, null, false);
            if (habitat !== null) {
                const num6 = galaxy.calculateDistance(habitat2.xpos, habitat2.ypos, habitat.xpos, habitat.ypos);
                if (num6 > galaxy.maxSolarSystemSize * 2.1) {
                    let flag = true;
                    if (design.role === BuiltObjectRole.Base) {
                        const builtObject = galaxy.findNearestBuiltObject(Math.trunc(habitat2.xpos), Math.trunc(habitat2.ypos), BuiltObjectRole.Base);
                        if (builtObject !== null) {
                            const num7 = galaxy.calculateDistance(habitat2.xpos, habitat2.ypos, builtObject.xpos, builtObject.ypos);
                            if (num7 < 500.0) flag = false;
                        }
                    }
                    if (flag) {
                        design = cloneDesign(design);
                        // design.PictureRef = ShipImageHelper.ResolveMinorShipImageIndex(design.SubRole, largeShips: true);
                        // TODO(port): ShipImageHelper (own _Rnd, picture only).
                        generateAbandonedBuiltObject(galaxy, habitat2, design);
                        num2++;
                    }
                }
            } else {
                num2++;
            }
        }
        num3++;
    }
}

/**
 * Start.2.cs 2012 → method_85 (2230): one abandoned ship/base in each of AsteroidFields.Count / 4
 * distinct asteroid belts (frigate, mining station, small space port "<star> Outpost|Depot|...",
 * or a pirate space port), half of them damaged ("Notify"), some with exploration / money / tech
 * rewards. Rnd per field: Next(0,fields) [+ Next(0,belt)] per try (≤ 50), Next(0,Empires.Count),
 * Next(0,4), case draws (SelectRandomUniqueMilitaryShipName | Next(0,5) | Next(0,pirates) +
 * GeneratePirateBaseName), [pirate GenerateDesignFromSpec], Next(0,2), [GenerateAbandonedBuiltObject
 * (creatures; negative effects unless damaged)], [damaged: Next(4,count-1), per component
 * Next(0,count) + NextDouble], Next(0,3) [==1: Next(0,3) + Next(4,9) | Next(5000,15000)].
 */
export function asteroidAbandonedShipsAtStart(galaxy: Galaxy): void {
    const fields = galaxy.asteroidFields;
    const num = Math.trunc(fields.length / 4);
    const array = new Array<boolean>(fields.length).fill(false);
    let num2 = 0;
    let num3 = 0;
    let design: Design | null = null;
    for (let i = 0; i < num; i++) {
        let flag = false;
        let habitat: Habitat | null = null;
        let num4 = 0;
        while (!flag && num4 < 50) {
            const num5 = galaxy.rnd.next(0, fields.length);
            habitat = null;
            flag = false;
            if (!array[num5]) {
                const index = galaxy.rnd.next(0, fields[num5].length);
                habitat = fields[num5][index];
                flag = true;
                array[num5] = true;
            }
            num4++;
        }
        if (habitat === null) continue;
        num2 = galaxy.rnd.next(0, galaxy.empires.length);
        num3 = galaxy.rnd.next(0, 4);
        let text = '';
        const habitat2 = galaxy.determineHabitatSystemStar(habitat);
        let subRole: BuiltObjectSubRole;
        let pirateCase = false;
        if (galaxy.empires.length <= 0) {
            num3 = 3;
            subRole = BuiltObjectSubRole.Undefined;
            pirateCase = true;
        } else {
            subRole = BuiltObjectSubRole.Undefined;
            switch (num3) {
                case 0:
                    design = findNewest(galaxy.empires[num2].designs, BuiltObjectSubRole.Frigate);
                    subRole = BuiltObjectSubRole.Frigate;
                    if (design !== null && design.warpSpeed <= 0) design = null;
                    text = galaxy.selectRandomUniqueMilitaryShipName(null);
                    break;
                case 1:
                    design = findNewest(galaxy.empires[num2].designs, BuiltObjectSubRole.MiningStation);
                    subRole = BuiltObjectSubRole.MiningStation;
                    text = `${habitat2.name} Mining Station`;
                    break;
                case 2: {
                    design = findNewest(galaxy.empires[num2].designs, BuiltObjectSubRole.SmallSpacePort);
                    subRole = BuiltObjectSubRole.SmallSpacePort;
                    text = habitat2.name + ' ';
                    const array2 = ['Outpost', 'Depot', 'Station', 'Base', 'Facility'];
                    const text2 = array2[galaxy.rnd.next(0, array2.length)];
                    text += text2;
                    break;
                }
                case 3:
                    pirateCase = true;
                    break;
            }
        }
        if (pirateCase) {
            // C# falls through to this block for case 3 (and when there are no empires).
            if (galaxy.pirateEmpires != null && galaxy.pirateEmpires.length > 0) {
                const index2 = galaxy.rnd.next(0, galaxy.pirateEmpires.length);
                design = findNewest(galaxy.pirateEmpires[index2].designs, BuiltObjectSubRole.SmallSpacePort);
                text = generatePirateBaseName(galaxy, null);
            }
        }
        // IL_028e
        if (design === null) {
            let empire: Empire | null = null;
            for (let j = 0; j < galaxy.pirateEmpires.length; j++) {
                if (galaxy.pirateEmpires[j] !== galaxy.playerEmpire) {
                    empire = galaxy.pirateEmpires[j];
                    break;
                }
            }
            if (empire !== null) design = generateDesignFromSpec(galaxy, empire, galaxyDesignSpecificationBySubRole(subRole), 2.0, galaxyCurrentStarDate(galaxy));
        }
        let flag2 = false;
        let encounterAction = BuiltObjectEncounterAction.Prompt;
        if (galaxy.rnd.next(0, 2) === 1) {
            flag2 = true;
            encounterAction = BuiltObjectEncounterAction.Notify;
        }
        if (design === null) continue;
        design = cloneDesign(design);
        if (design.subRole === BuiltObjectSubRole.SmallSpacePort || design.subRole === BuiltObjectSubRole.MediumSpacePort || design.subRole === BuiltObjectSubRole.LargeSpacePort) {
            addCargoBaysToDesign(design, 10);
        }
        // design.PictureRef = ShipImageHelper.ResolveMinorShipImageIndex(design.SubRole, largeShips: true);
        // TODO(port): ShipImageHelper (own _Rnd, picture only).
        const builtObject = generateAbandonedBuiltObject(galaxy, habitat, design, true, !flag2, encounterAction);
        builtObject.isAutoControlled = true;
        if (text !== '') builtObject.name = text;
        if (flag2) {
            const num7 = galaxy.rnd.next(4, builtObject.components.count - 1);
            for (let k = 0; k < num7; k++) {
                const index3 = galaxy.rnd.next(0, builtObject.components.count);
                builtObject.components.items[index3].status = ComponentStatus.Damaged;
                builtObject.reDefine();
                builtObject.currentFuel = builtObject.fuelCapacity * 0.2 + galaxy.rnd.nextDouble() * 0.7 * builtObject.fuelCapacity;
            }
        }
        if (galaxy.rnd.next(0, 3) === 1) {
            switch (galaxy.rnd.next(0, 3)) {
                case 0:
                    builtObject.encounterExplorationBonus = toShort(galaxy.rnd.next(4, 9));
                    break;
                case 1:
                    builtObject.encounterMoneyBonus = galaxy.rnd.next(5000, 15000);
                    break;
                case 2:
                    builtObject.encounterTechAdvanceCount = 1;
                    break;
            }
        }
    }
    void num2;
}

/**
 * Start.2.cs 2013-2016 `if (galaxy.StoryReturnOfTheShakturiEnabled) method_86(galaxy)` (2390): (int)(sqrt(StarCount) * 0.3)
 * abandoned Shakturi warships — story/storyStart.ts (M4z3).
 */
export function shakturiAbandonedShipsAtStart(galaxy: Galaxy): void {
    storyStart.shakturiAbandonedShipsAtStart(galaxy);
}

/**
 * Start.2.cs 2017-2038 (sim-state parts): DeferEventsForGameStart = true; Game.AgeOfShadows when
 * empireStart_0.Age == 0; Game.PlayAsAPirate; PlayerEmpire.PlayableInScenario = true (not modelled
 * on the TS Empire); PreWarpProgressEventOccurredSendPirateRaid = false when !pirate &&
 * ageOfShadows && EnableStoryEventsShadows (returned for the caller: the TS Empire keeps one
 * combined pre-warp flag).
 * 2035-2038 PlayerEmpire.Capital.DoTasks(galaxy.CurrentDateTime) follows in game.ts createGame (after the caller
 * applies the pre-warp flag and GlobalVictoryConditions, as in the C#: tick/gameStart.ts runGameStartHabitatTick).
 * Game.Version / view / GameOptions copies (2019-2146) are UI state.
 */
export function gameObjectAtStart(galaxy: Galaxy, playerAge: number, playAsPirate: boolean, enableStoryEventsShadows: boolean, bool3 = false): GameStartTailResult {
    galaxy.deferEventsForGameStart = true;
    let ageOfShadows = bool3; // Start.2.cs bool_3 (Shadows playstyle)
    if (playerAge === 0) ageOfShadows = true;
    const clearPreWarpSendPirateRaid = !playAsPirate && ageOfShadows && enableStoryEventsShadows;
    return { ageOfShadows, playAsAPirate: playAsPirate, clearPreWarpSendPirateRaid };
}

/** Start.2.cs 1568-2038: every block above in C# order. Call right after the ruins blocks (clearRuinBonusesForAge). */
export function gameStartTail(galaxy: Galaxy, ctx: GameStartTailContext): GameStartTailResult {
    const empireList = ctx.empireList ?? galaxy.empires;
    capitalCreatureTeardown(galaxy); // 1568-1583
    homeAsteroidFieldsAtStart(galaxy, ctx.creaturePrevalence ?? galaxy.creaturePrevalence); // 1585-1729
    shakturiStoryAtStart(galaxy, ctx.playerTechLevel ?? 0.0, ctx.xpos ?? 0.0, ctx.ypos ?? 0.0); // 1730-1767
    const galaxyLocationList3 = distantWorldsStoryCluesAtStart(galaxy, ctx.xpos ?? 0.0, ctx.ypos ?? 0.0); // 1768-1844
    setKnownGalacticHistoryLocationsAtStart(galaxy, empireList, galaxyLocationList3); // 1845-1852
    setRestrictedResources(galaxy); // 1853-1856
    generateSilverMistRuins(galaxy); // 1857-1860
    generateSpecialBonusRuins(galaxy); // 1861-1864
    placeSpecialRuinsAtStart(galaxy, ctx.starCount ?? galaxy.starCount, ctx.raceFamilies); // 1865-1967
    debrisFieldsAtStart(galaxy, ctx.starCount ?? galaxy.starCount, ctx.scaleDebrisFields ?? false); // 1968-2010
    abandonedShipsAtStart(galaxy); // 2011 method_87
    asteroidAbandonedShipsAtStart(galaxy); // 2012 method_85
    shakturiAbandonedShipsAtStart(galaxy); // 2013-2016 method_86
    void ctx.playerEmpire;
    return gameObjectAtStart(galaxy, ctx.playerAge ?? galaxy.age, ctx.playAsPirate ?? false, ctx.enableStoryEventsShadows ?? false, ctx.ageOfShadows ?? false); // 2017-2038
}
