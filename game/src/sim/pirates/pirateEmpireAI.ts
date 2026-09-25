// M4s (s2) — pirate faction empire-level AI: the small DoTasksPirates entry points and the normal-empire pirate checks.
//   Empire.1.cs 4065 CheckSendPirateRaid, 4333 PirateResetCivilianShipEmpireToIndependent;
//   BaconEmpire.cs 1253 PirateRecalculateEmpireCorruption, 1099-1180 DoTaskPiratesLongInterval
//     (CheckPiratesBuildConstructionShipsAtIndependentPlanet, CheckPirateReinforcePirateBases),
//     1499 CheckColoniesForPirateFacilitiesAndAttack; BaconHabitat.cs 1066 BuildShipForPirate;
//   Empire.2.cs 2840 PirateCollectTaxes, 2895 PirateCollectIncomeFromControlledColonies;
//   Empire.9.cs 4139 PirateReviewSystemThreats; Empire.7.cs 2180 ReviewPirateSystemInfluence;
//   Empire.4.cs 2399 MaintainPirateSpaceportResourceLevels (+ 2426 CheckAndOrderResourcePirates, 2441
//     CheckResourceMeetsMinimumLevel, Galaxy.cs 1659 CalculateResourceLevelPirates);
//   Galaxy.6.cs 4696 DetermineDefendingFirepower; Habitat.cs 6538 CheckFacilityOwner, 6561 CheckPirateFacilityToAttack,
//     3299 CheckCanInitiateAttackAgainstPirateFacilities, 3312 InitiateAttackAgainstPirateFacilities.
//
// Free functions, C# `this` first (plan §3.1). Clock-seeded `new Random()` (BaconEmpire.cs 1122 / 1156) → the galaxy-seeded
// stream galaxy.baconPirateClockRnd (plan §0); galaxy.rnd is never touched by those draws.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { AutomationLevel } from '../empire';
import { BuiltObject } from '../builtObject';
import type { Habitat } from '../types';
import { checkColonyRevenueFromPirateControl } from './pirateColonyControl';
import type { Design } from '../design';
import { Random } from '../random';
import { ComponentStatus, csInt } from '../builtObjectComponent';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { BuiltObjectRole } from '../data/designSpecifications';
import { BuiltObjectMissionPriority, BuiltObjectMissionType } from '../missions/mission';
import { assignMission, clearPreviousMissionRequirements } from '../missions/assign';
import { empireShipGroups, shipGroupAssignMission } from '../fleets/shipGroup';
import { findNearestPirateFaction } from '../pirates';
import { findNewestCanBuild } from '../designGeneration';
import { REAL_SECONDS_IN_GALACTIC_YEAR, galaxyStarDate } from '../tick/simTime';
import { applyCorruptionToIncome, MINIMUM_CONTRACT_SIZE, MINIMUM_RESTRICTED_RESOURCE_REORDER_AMOUNT, OrderType, cargoAvailable, cargoGetExists, cargoIndexOf, empireCreateOrder, isRestrictedResource, type OrderList } from '../logistics/orders';
import { ResourceRef } from '../cargo';
import { galaxyResourceCurrentPrices } from '../design';
import { checkAtWar, colonyCorruptionFactor, colonyIncomeFactor, getPrivateFunds, habitatAnnualRevenue, privateAnnualRevenue, annualTaxRevenue, recalculateColonyTaxRevenues } from '../forceStructure';
import { reviewTaxes } from '../taxes';
import { calculatePirateIncome } from '../treasury';
import { AdvisorMessageType, checkTaskAuthorized, type RefCount } from '../diplomacyTick';
import { gameText } from '../colonyTick';
import { PlanetaryFacilityType } from '../researchSystem';
import { facilitiesFindBestPirateFacility, type PlanetaryFacility } from '../construction/facilities';
import { getEmpireById } from '../logistics/contracts';
import { InvasionStats, generateDefensivePirateRaiders } from '../combat/invasion';
import { PirateIncomeType } from './pirateEconomy';

const f = Math.fround;

/** BaconHabitat.cs 33 pirateControlLevelToBuildShipsAtIndependentPlanets (float 0.9f; BaconMain settings override not ported). */
export const PIRATE_CONTROL_LEVEL_TO_BUILD_SHIPS_AT_INDEPENDENT_PLANETS = f(0.9);
/** BaconHabitat.cs 34-36 pirateBaseTroops / pirateFortressTroops / pirateCriminalNetworkTroops. */
export const PIRATE_BASE_TROOPS = 7;
export const PIRATE_FORTRESS_TROOPS = 12;
export const PIRATE_CRIMINAL_NETWORK_TROOPS = 18;

/** The clock-seeded `new Random()` of BaconEmpire.cs 1122 / 1156 — one galaxy-seeded stream (plan §0). */
function baconPirateClockRnd(galaxy: Galaxy): Random {
    if (galaxy.baconPirateClockRnd === null) galaxy.baconPirateClockRnd = new Random((galaxy.randomSeed ^ 0x1122b0) | 0);
    return galaxy.baconPirateClockRnd;
}

/** DesignList.FindNewestCanBuild(subRole) (DesignList.cs 148: the list's first design's empire). */
export function designsFindNewestCanBuild(designs: Design[], subRole: BuiltObjectSubRole): Design | null {
    const listEmpire = designs.length > 0 && designs[0] != null ? (designs[0].empire as Empire | null) : null;
    return findNewestCanBuild(designs, subRole, listEmpire);
}

/** Empire.1.cs 4065 CheckSendPirateRaid. No Rnd. */
export function checkSendPirateRaidCore(galaxy: Galaxy, empire: Empire): void {
    if (empire.preWarpProgressEventsOccurred || empire.preWarpProgressEventOccurredSendPirateRaid || empire.capital === null) return;
    const capital = empire.capital;
    const empire2 = findNearestPirateFaction(galaxy, capital.xpos, capital.ypos, galaxy.playerEmpire, false);
    if (empire2 === null) return;
    const shipGroups = empireShipGroups(empire2);
    if (shipGroups != null && shipGroups.length > 0) {
        const shipGroup = shipGroups[0];
        if (shipGroup != null) shipGroupAssignMission(galaxy, shipGroup, BuiltObjectMissionType.Raid, capital, null, BuiltObjectMissionPriority.High, true);
    } else {
        for (let i = 0; i < empire2.builtObjects.length; i++) {
            const builtObject = empire2.builtObjects[i];
            if (builtObject != null && !builtObject.hasBeenDestroyed && builtObject.builtAt === null && builtObject.unbuiltComponentCount <= 0 && builtObject.role === BuiltObjectRole.Military && builtObject.subRole !== BuiltObjectSubRole.ResupplyShip) {
                clearPreviousMissionRequirements(galaxy, builtObject);
                assignMission(galaxy, builtObject, BuiltObjectMissionType.Raid, capital, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
            }
        }
    }
    empire.preWarpProgressEventOccurredSendPirateRaid = true;
}

/** BaconEmpire.cs 1253 PirateRecalculateEmpireCorruption(empire). Rnd: one NextDouble. */
export function pirateRecalculateEmpireCorruptionCore(galaxy: Galaxy, empire: Empire): void {
    const pirateIncome = calculatePirateIncome(galaxy, empire);
    let num1 = pirateIncome;
    if (num1 > 25000.0) num1 = Math.min(pirateIncome, Math.sqrt(pirateIncome / 1000.0) * 5000.0);
    const num2 = num1 + num1 * (0.05 * (galaxy.rnd.nextDouble() - 1.0));
    let num3 = 1.0;
    if (pirateIncome > 0.0) num3 = Math.min(1.0, Math.max(0.0, num2 / pirateIncome));
    let num4 = (1.0 - num3) * colonyCorruptionFactor(empire);
    if (num4 > 0.9) num4 = 0.9;
    empire.corruption = num4;
}

/** Empire.2.cs 2840 PirateCollectTaxes(timePassed). No Rnd. */
function pirateCollectTaxes(galaxy: Galaxy, empire: Empire, timePassed: number): void {
    const privateAnnualRevenueValue = privateAnnualRevenue(galaxy, empire);
    let num = privateAnnualRevenueValue * (timePassed / REAL_SECONDS_IN_GALACTIC_YEAR);
    if (Number.isNaN(num)) num = 0.0;
    empire.counters.processColonyRevenue(num);
    empire.privateMoney += num;
    const annualTaxRevenueValue = annualTaxRevenue(galaxy, empire);
    let val = annualTaxRevenueValue * (timePassed / REAL_SECONDS_IN_GALACTIC_YEAR);
    val = Math.max(0.0, val);
    if (Number.isNaN(val)) val = 0.0;
    val = applyCorruptionToIncome(empire, val);
    empire.stateMoney += val;
    empire.privateMoney -= val;
    empire.pirateEconomy.performIncome(val, PirateIncomeType.ControlColony, galaxyStarDate(galaxy));
    if (Number.isNaN(empire.stateMoney)) empire.stateMoney = 0.0;
    if (Number.isNaN(empire.privateMoney)) empire.privateMoney = 0.0;
}

/** Empire.2.cs 2895 PirateCollectIncomeFromControlledColonies(timePassed). No Rnd. */
export function pirateCollectIncomeFromControlledColoniesCore(galaxy: Galaxy, empire: Empire, timePassed: number): void {
    let num = 0.0;
    const num2 = timePassed / REAL_SECONDS_IN_GALACTIC_YEAR;
    let flag = false;
    for (let i = 0; i < empire.colonies.length; i++) {
        const habitat = empire.colonies[i];
        if (habitat == null || habitat.hasBeenDestroyed) continue;
        if (habitat.empire === empire && !checkColonyRevenueFromPirateControl(habitat, empire)) {
            flag = true;
            continue;
        }
        const byFaction = habitat.pirateColonyControl.getByFaction(empire);
        if (byFaction === null) continue;
        let num3 = 1.0;
        if (habitat.facilities != null) {
            const planetaryFacility = facilitiesFindBestPirateFacility(habitat.facilities, true, true);
            if (planetaryFacility !== null) num3 += planetaryFacility.value2 / 100.0;
        }
        let num4 = num2 * Math.max(0.0, habitatAnnualRevenue(galaxy, habitat)) * byFaction.controlLevel * 1.2 * num3;
        num4 *= colonyIncomeFactor(empire);
        num += num4;
    }
    num = applyCorruptionToIncome(empire, num);
    empire.stateMoney += num;
    empire.pirateEconomy.performIncome(num, PirateIncomeType.ControlColony, galaxyStarDate(galaxy));
    if (flag) {
        recalculateColonyTaxRevenues(galaxy, empire);
        if (empire.controlColonyTaxRates) reviewTaxes(galaxy, empire);
        pirateCollectTaxes(galaxy, empire, timePassed);
    }
}

/** Empire.9.cs 4139 PirateReviewSystemThreats. No Rnd. */
export function pirateReviewSystemThreatsCore(galaxy: Galaxy, empire: Empire): void {
    void galaxy;
    const systemVisibilityList = empire.visibility.systemVisibility;
    if (systemVisibilityList == null || empire.builtObjects == null || empire.dominantRace === null) return;
    for (let i = 0; i < systemVisibilityList.length; i++) {
        const systemVisibility = systemVisibilityList[i];
        if (systemVisibility != null) systemVisibility.empireStrength = 0;
    }
    for (let j = 0; j < empire.builtObjects.length; j++) {
        const builtObject = empire.builtObjects[j];
        if (builtObject != null && builtObject.firepowerRaw > 0 && builtObject.nearestSystemStar !== null && builtObject.nearestSystemStar.systemIndex >= 0 && builtObject.nearestSystemStar.systemIndex < systemVisibilityList.length) {
            systemVisibilityList[builtObject.nearestSystemStar.systemIndex].empireStrength += builtObject.firepowerRaw;
        }
    }
}

/** Empire.7.cs 2180 ReviewPirateSystemInfluence. No Rnd. */
export function reviewPirateSystemInfluenceCore(galaxy: Galaxy, empire: Empire): void {
    void galaxy;
    const list: number[] = [];
    if (empire.pirateEmpireBaseHabitat !== null) {
        for (let i = 0; i < empire.colonies.length; i++) {
            const habitat = empire.colonies[i];
            if (habitat != null && !habitat.hasBeenDestroyed && habitat.pirateColonyControl.getByFaction(empire) !== null && !list.includes(habitat.systemIndex)) list.push(habitat.systemIndex);
        }
        for (let j = 0; j < empire.spacePorts.length; j++) {
            const builtObject = empire.spacePorts[j];
            if (builtObject != null && !builtObject.hasBeenDestroyed && builtObject.empire === empire && builtObject.nearestSystemStar !== null && !list.includes(builtObject.nearestSystemStar.systemIndex)) list.push(builtObject.nearestSystemStar.systemIndex);
        }
    }
    empire.pirateInfluenceSystemIds = list;
}

/** Empire.1.cs 4333 PirateResetCivilianShipEmpireToIndependent. No Rnd. */
export function pirateResetCivilianShipEmpireToIndependentCore(galaxy: Galaxy, empire: Empire): void {
    if (empire.pirateEmpireBaseHabitat === null || empire.privateBuiltObjects == null) return;
    for (let i = 0; i < empire.privateBuiltObjects.length; i++) {
        const builtObject = empire.privateBuiltObjects[i];
        if (builtObject != null && !builtObject.hasBeenDestroyed && builtObject.pirateEmpireId === empire.empireId && builtObject.empire === empire) {
            switch (builtObject.subRole) {
                case BuiltObjectSubRole.SmallFreighter:
                case BuiltObjectSubRole.MediumFreighter:
                case BuiltObjectSubRole.LargeFreighter:
                case BuiltObjectSubRole.PassengerShip:
                case BuiltObjectSubRole.GasMiningShip:
                case BuiltObjectSubRole.MiningShip:
                    builtObject.empire = galaxy.independentEmpire;
                    break;
            }
        }
    }
}

/** Galaxy.6.cs 4696 DetermineDefendingFirepower(habitat, empire) (+ 4708 DetermineBaseFirepowerAtHabitat, 4721 DetermineShipFirepowerNearHabitat). No Rnd. */
export function determineDefendingFirepower(galaxy: Galaxy, habitat: Habitat | null, empire: Empire | null): number {
    let num = 0;
    if (habitat !== null) {
        // DetermineShipFirepowerNearHabitat.
        let shipFirepower = 0;
        const num2 = f(4000000);
        const habitat2 = galaxy.determineHabitatSystemStar(habitat);
        if (empire !== null && empire.builtObjects != null) {
            for (let i = 0; i < empire.builtObjects.length; i++) {
                const b = empire.builtObjects[i];
                if (b.nearestSystemStar === habitat2 && b.role !== BuiltObjectRole.Base && b.builtAt === null) {
                    if (b.parentHabitat === habitat || b.attackRangeSquared > num2) shipFirepower += b.firepowerRaw;
                }
            }
        }
        num += shipFirepower;
        // DetermineBaseFirepowerAtHabitat.
        let baseFirepower = 0;
        if (habitat.basesAtHabitat != null && habitat.basesAtHabitat.length > 0) {
            for (let i = 0; i < habitat.basesAtHabitat.length; i++) baseFirepower += habitat.basesAtHabitat[i].firepowerRaw;
        }
        num += baseFirepower;
    }
    return num;
}

/** BaconHabitat.cs 1066 BuildShipForPirate(planet, pirateEmpire, design, shipType). Rnd: GenerateBuiltObjectName, SelectRandomHeading (+ AddBuiltObjectToGalaxy's). */
export function buildShipForPirate(galaxy: Galaxy, planet: Habitat, pirateEmpire: Empire, design: Design | null, shipType: BuiltObjectSubRole = BuiltObjectSubRole.ConstructionShip): void {
    if (planet.empire === null || planet.empire !== galaxy.independentEmpire) return;
    const pirateControl = planet.pirateColonyControl;
    if (pirateControl == null || pirateControl.count < 1 || !pirateControl.checkFactionHasControl(pirateEmpire)) {
        // PauseAndShowMessageBox (UI only).
        return;
    }
    const pirateColonyControl = pirateControl.getByFaction(pirateEmpire.empireId);
    if (pirateColonyControl === null || pirateColonyControl.controlLevel < PIRATE_CONTROL_LEVEL_TO_BUILD_SHIPS_AT_INDEPENDENT_PLANETS) {
        // PauseAndShowMessageBox (UI only).
        return;
    }
    if (design === null) design = designsFindNewestCanBuild(pirateEmpire.designs, shipType);
    if (design === null) {
        // PauseAndShowMessageBox (UI only; the C# message dereferences the null design).
        return;
    }
    const currentPurchasePrice = design.calculateCurrentPurchasePrice(galaxy);
    const builtObject = new BuiltObject(design, galaxy.generateBuiltObjectName(design), galaxy);
    builtObject.purchasePrice = currentPurchasePrice;
    builtObject.isAutoControlled = true;
    builtObject.parentHabitat = planet;
    builtObject.parentOffsetX = 0.0;
    builtObject.parentOffsetY = 0.0;
    builtObject.heading = galaxy.selectRandomHeading();
    builtObject.targetHeading = builtObject.heading;
    builtObject.nearestSystemStar = galaxy.determineHabitatSystemStar(planet);
    // Components.ForEach(Status = Damaged | Normal): the player's pirate ships arrive damaged.
    const status = pirateEmpire === galaxy.playerEmpire ? ComponentStatus.Damaged : ComponentStatus.Normal;
    for (const c of builtObject.components.items) c.status = status;
    const queue = planet.constructionQueue as { addBuiltObjectToRepair(bo: BuiltObject): boolean } | null;
    // planet.ConstructionQueue.AddBuiltObjectToRepair(builtObject) (the C# dereferences the queue unconditionally).
    queue!.addBuiltObjectToRepair(builtObject);
    pirateEmpire.stateMoney -= currentPurchasePrice;
    pirateEmpire.addBuiltObjectToGalaxy(builtObject, planet, true, true);
}


/** BaconEmpire.cs 1108 CheckPiratesBuildConstructionShipsAtIndependentPlanet(main, empire). Clock Rnd: Next(0, 100), Next(0, candidates). */
function checkPiratesBuildConstructionShipsAtIndependentPlanet(galaxy: Galaxy, empire: Empire): void {
    let constructionShipCount = 0;
    for (const x of empire.builtObjects) {
        if (x.subRole === BuiltObjectSubRole.ConstructionShip && x.warpSpeed >= 1000 && x.damagedComponentCount < 10) constructionShipCount++;
    }
    if (PIRATE_CONTROL_LEVEL_TO_BUILD_SHIPS_AT_INDEPENDENT_PLANETS > 100.0 || constructionShipCount > 20) return;
    const stateMoney = empire.stateMoney;
    const newestCanBuild = designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.ConstructionShip);
    if (newestCanBuild === null) return;
    let num1 = newestCanBuild.calculateCurrentPurchasePrice(galaxy);
    if (num1 < 1000.0) num1 = 1000.0;
    const num2 = stateMoney / num1;
    const random = baconPirateClockRnd(galaxy);
    if (random.next(0, 100) >= num2) return;
    const habitatList: Habitat[] = [];
    for (const colony of empire.colonies) {
        const pirateColonyControl = colony.pirateColonyControl.items.find((x) => x.empireId === empire.empireId) ?? null;
        if (pirateColonyControl !== null && pirateColonyControl.controlLevel > PIRATE_CONTROL_LEVEL_TO_BUILD_SHIPS_AT_INDEPENDENT_PLANETS && determineDefendingFirepower(galaxy, colony, empire) > 250) habitatList.push(colony);
    }
    if (habitatList.length > 0) {
        const index = random.next(0, habitatList.length);
        const planet = habitatList[index];
        // BaconHabitat.cs 1057 BuildShipForPirate(planet, pirateEmpire, shipType): FindNewestCanBuild(shipType) then the core.
        buildShipForPirate(galaxy, planet, empire, designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.ConstructionShip), BuiltObjectSubRole.ConstructionShip);
        // BaconMain.isDebugging message (debug only).
    }
}

/** BaconEmpire.cs 1143 CheckPirateReinforcePirateBases(main, pirateEmpire). Clock Rnd: Next(0, candidates), NextDouble. */
function checkPirateReinforcePirateBases(galaxy: Galaxy, pirateEmpire: Empire): void {
    if (pirateEmpire === galaxy.playerEmpire) return;
    const habitatList: Habitat[] = [];
    for (const colony of pirateEmpire.colonies) {
        if (colony.owner !== pirateEmpire && colony.facilities !== null && facilitiesFindBestPirateFacility(colony.facilities, true) !== null && colony.pirateColonyControl.items.some((x) => x.empireId === pirateEmpire.empireId)) habitatList.push(colony);
    }
    if (habitatList.length <= 0) return;
    const random = baconPirateClockRnd(galaxy);
    const index = random.next(0, habitatList.length);
    const habitat = habitatList[index];
    const val1 = 125000;
    // `(int)(NextDouble() * StateMoney / 10.0)` inside try/catch: an out-of-range double → int cast does not throw in C#
    // (unchecked), so the catch never runs; (int) of NaN / out-of-range is int.MinValue on x64 (csInt) → Max(0, ...) = 0.
    const num1 = Math.max(0, Math.min(val1, csInt((random.nextDouble() * pirateEmpire.stateMoney) / 10.0)));
    if (num1 <= 0) return;
    let num2 = 0;
    if (habitat.baconValues === null) habitat.baconValues = new Map<string, unknown>();
    if (habitat.baconValues.has('piratebase')) num2 = habitat.baconValues.get('piratebase') as number;
    else habitat.baconValues.set('piratebase', 0);
    habitat.baconValues.set('piratebase', (num2 + num1) | 0);
}

/** BaconEmpire.cs 1099 DoTaskPiratesLongInterval(empire). Clock Rnd only (galaxy.baconPirateClockRnd). */
export function doTaskPiratesLongIntervalCore(galaxy: Galaxy, empire: Empire): void {
    if (empire === galaxy.playerEmpire) return;
    checkPiratesBuildConstructionShipsAtIndependentPlanet(galaxy, empire);
    checkPirateReinforcePirateBases(galaxy, empire);
}

/** Galaxy.cs 1659 CalculateResourceLevelPirates(resource, pirateSpaceport). */
function calculateResourceLevelPirates(galaxy: Galaxy, resourceId: number, pirateSpaceport: BuiltObject | null): number {
    const relativeImportance = galaxy.resourceSystem.relativeImportance.get(resourceId) ?? 0;
    const isFuel = galaxy.resourceSystem.byId.get(resourceId)?.isFuel ?? false;
    const num = relativeImportance > f(0.4) || isFuel ? 4000.0 : relativeImportance > f(0.25) ? 2000.0 : !(relativeImportance > f(0.1)) ? 500.0 : 1000.0;
    let num2 = 1.0;
    if (pirateSpaceport !== null) {
        switch (pirateSpaceport.subRole) {
            case BuiltObjectSubRole.SmallSpacePort:
                num2 = 1.0;
                break;
            case BuiltObjectSubRole.MediumSpacePort:
                num2 = 2.0;
                break;
            case BuiltObjectSubRole.LargeSpacePort:
                num2 = 4.0;
                break;
        }
    }
    return Math.trunc(num * num2);
}

/** Empire.4.cs 2441 CheckResourceMeetsMinimumLevel(resource, min, max, pirateSpaceport, spaceportOrders, out amountToOrder). */
function checkResourceMeetsMinimumLevelPirates(galaxy: Galaxy, resourceId: number, minimumResourceLevel: number, maximumResourceLevel: number, pirateSpaceport: BuiltObject, spaceportOrders: OrderList): { meets: boolean; amountToOrder: number } {
    let result = false;
    let num2 = 0;
    let num4 = -1;
    if (pirateSpaceport.cargo !== null && cargoGetExists(pirateSpaceport.cargo, resourceId)) num4 = cargoIndexOf(pirateSpaceport.cargo, resourceId, pirateSpaceport.owner);
    if (num4 >= 0) num2 = cargoAvailable(pirateSpaceport.cargo!.items[num4]);
    for (let num5 = spaceportOrders.indexOfResourceId(resourceId, 0); num5 >= 0; num5 = spaceportOrders.indexOfResourceId(resourceId, num5)) {
        num2 = (num2 + spaceportOrders.items[num5].amountRequested) | 0;
        num5++;
    }
    let amountToOrder = Math.max(0, maximumResourceLevel - num2);
    if (amountToOrder > 0) {
        if (isRestrictedResource(galaxy, resourceId)) amountToOrder = Math.max(amountToOrder, MINIMUM_RESTRICTED_RESOURCE_REORDER_AMOUNT);
        else amountToOrder = Math.max(amountToOrder, MINIMUM_CONTRACT_SIZE);
    }
    if (num2 >= minimumResourceLevel) result = true;
    return { meets: result, amountToOrder };
}

/** Empire.4.cs 2426 CheckAndOrderResourcePirates(spaceportOrders, pirateSpaceport, resource). No Rnd. */
function checkAndOrderResourcePirates(galaxy: Galaxy, empire: Empire, spaceportOrders: OrderList, pirateSpaceport: BuiltObject, resourceId: number): void {
    const num = calculateResourceLevelPirates(galaxy, resourceId, pirateSpaceport);
    const minimumResourceLevel = Math.trunc(num * 0.6);
    const r = checkResourceMeetsMinimumLevelPirates(galaxy, resourceId, minimumResourceLevel, num, pirateSpaceport, spaceportOrders);
    if (!r.meets) {
        const num2 = r.amountToOrder * galaxyResourceCurrentPrices(galaxy)[resourceId];
        if (num2 < getPrivateFunds(empire)) empireCreateOrder(galaxy, empire, pirateSpaceport, new ResourceRef(resourceId), r.amountToOrder, false, OrderType.Standard);
    }
}

/** Empire.4.cs 2399 MaintainPirateSpaceportResourceLevels. No Rnd. */
export function maintainPirateSpaceportResourceLevelsCore(galaxy: Galaxy, empire: Empire): void {
    if (empire.pirateEmpireBaseHabitat === null || empire.spacePorts == null) return;
    for (let i = 0; i < empire.spacePorts.length; i++) {
        const builtObject = empire.spacePorts[i];
        if (builtObject == null || builtObject.hasBeenDestroyed || !builtObject.isFunctional || !builtObject.isSpacePort) continue;
        const orders = galaxy.orders.getOrdersForBuiltObject(builtObject);
        const ordered = galaxy.resourceSystem.strategicResourcesOrderedByRelativeImportance;
        for (let j = 0; j < ordered.length; j++) {
            const resourceDefinition = ordered[j];
            if (resourceDefinition != null) checkAndOrderResourcePirates(galaxy, empire, orders, builtObject, resourceDefinition.resourceId);
        }
    }
}

/** Habitat.cs 6538 CheckFacilityOwner(facility). No Rnd. */
export function checkFacilityOwner(galaxy: Galaxy, habitat: Habitat, facility: PlanetaryFacility | null): Empire | null {
    let result: Empire | null = null;
    if (facility !== null && habitat.facilities !== null && habitat.facilities.includes(facility)) {
        switch (facility.type) {
            case PlanetaryFacilityType.PirateBase:
            case PlanetaryFacilityType.PirateFortress:
            case PlanetaryFacilityType.PirateCriminalNetwork: {
                const byFacilityControl = habitat.pirateColonyControl.getByFacilityControl();
                result = byFacilityControl === null ? habitat.owner : getEmpireById(galaxy, byFacilityControl.empireId);
                break;
            }
            default:
                result = habitat.owner;
                break;
        }
    }
    return result;
}

/** Habitat.cs 6561 CheckPirateFacilityToAttack(out pirateFaction). No Rnd. */
function checkPirateFacilityToAttack(galaxy: Galaxy, habitat: Habitat): { facility: PlanetaryFacility | null; pirateFaction: Empire | null } {
    if (habitat.facilities !== null && habitat.empire !== null) {
        const planetaryFacility = facilitiesFindBestPirateFacility(habitat.facilities, true, true);
        if (planetaryFacility !== null) {
            const empire = checkFacilityOwner(galaxy, habitat, planetaryFacility);
            if (empire !== habitat.owner) return { facility: planetaryFacility, pirateFaction: empire };
        }
    }
    return { facility: null, pirateFaction: null };
}

/** Habitat.cs 3299 CheckCanInitiateAttackAgainstPirateFacilities(attackingEmpire, pirateFacility). No Rnd. */
function checkCanInitiateAttackAgainstPirateFacilities(galaxy: Galaxy, habitat: Habitat, attackingEmpire: Empire, pirateFacility: PlanetaryFacility): boolean {
    if (habitat.empire === attackingEmpire && habitat.troops !== null && habitat.troops.count > 0 && habitat.invadingTroops !== null && habitat.invadingTroops.count <= 0) {
        const empire = checkFacilityOwner(galaxy, habitat, pirateFacility);
        if (empire !== null && empire.dominantRace !== null && empire !== attackingEmpire) return true;
    }
    return false;
}

/** Habitat.cs 3312 InitiateAttackAgainstPirateFacilities(attackingEmpire, pirateFacility). Rnd: GenerateDefensivePirateRaiders' Next(0, 3) (combat/invasion.ts). */
function initiateAttackAgainstPirateFacilities(galaxy: Galaxy, habitat: Habitat, attackingEmpire: Empire, pirateFacility: PlanetaryFacility): void {
    if (checkCanInitiateAttackAgainstPirateFacilities(galaxy, habitat, attackingEmpire, pirateFacility)) {
        const empire = checkFacilityOwner(galaxy, habitat, pirateFacility);
        generateDefensivePirateRaiders(galaxy, habitat, empire, true);
        if (habitat.invasionStats === null) habitat.invasionStats = new InvasionStats(habitat, attackingEmpire, empire);
    }
}

/** Empire.10.cs 3897 GenerateAutomationMessageAttackPirateFacility(colony, pirateFaction, pirateFacility) — advisor text. */
function generateAutomationMessageAttackPirateFacility(galaxy: Galaxy, colony: Habitat, pirateFaction: Empire, pirateFacility: PlanetaryFacility): string {
    const systemStar = galaxy.determineHabitatSystemStar(colony);
    return gameText('Automation Attack Pirate Facility', pirateFaction.name, pirateFacility.name, colony.name, systemStar.name);
}

/** BaconEmpire.cs 1499 CheckColoniesForPirateFacilitiesAndAttack(empire) (Empire.1.cs 4328). No Rnd (callees: M4q). */
export function checkColoniesForPirateFacilitiesAndAttackCore(galaxy: Galaxy, empire: Empire): void {
    if (empire === galaxy.independentEmpire || empire.pirateEmpireBaseHabitat !== null || empire.colonies == null) return;
    for (let index = 0; index < empire.colonies.length; ++index) {
        const colony = empire.colonies[index];
        if (colony != null && !colony.hasBeenDestroyed && colony.empire === empire) {
            const r = checkPirateFacilityToAttack(galaxy, colony);
            const attack = r.facility;
            const pirateFaction = r.pirateFaction;
            if (attack !== null && pirateFaction !== null) {
                let num1 = 0;
                switch (attack.type) {
                    case PlanetaryFacilityType.PirateBase:
                        num1 = 1 + Math.trunc(PIRATE_BASE_TROOPS * 0.67000001668930054);
                        break;
                    case PlanetaryFacilityType.PirateFortress:
                        num1 = 1 + Math.trunc(PIRATE_FORTRESS_TROOPS * 0.67000001668930054);
                        break;
                    case PlanetaryFacilityType.PirateCriminalNetwork:
                        num1 = 1 + Math.trunc(PIRATE_CRIMINAL_NETWORK_TROOPS * 0.67000001668930054);
                        break;
                }
                const num2 = num1 * 50 * 100;
                if (colony.troops !== null && colony.troops.totalAttackStrength > num2) {
                    const refusalCount: RefCount = { value: 0 };
                    if (checkTaskAuthorized(galaxy, empire, empire.controlMilitaryAttacks, refusalCount, generateAutomationMessageAttackPirateFacility(galaxy, colony, pirateFaction, attack), colony, AdvisorMessageType.PirateFacilityEradicate, null, attack, pirateFaction)) {
                        initiateAttackAgainstPirateFacilities(galaxy, colony, empire, attack);
                    }
                } else if (empire.controlMilitaryAttacks === AutomationLevel.FullyAutomated && !checkAtWar(empire)) {
                    if (empire.coloniesNeedingTroops === null) empire.coloniesNeedingTroops = [];
                    if (!empire.coloniesNeedingTroops.includes(colony)) empire.coloniesNeedingTroops.push(colony);
                }
            }
        }
    }
}
