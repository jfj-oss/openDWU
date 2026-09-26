// M4s (s1) — pirate mission marketplace (EmpireActivity): offers, bidding, mission reviews, relations.
//
// Ports (C# `this` first, plan §3.1 rule 2):
//   Galaxy.9.cs 527 ReviewPirateMissionsAndAssign, 469 RemovePirateSmugglingMissionFromAllEmpires,
//     576 CheckCancelAttackMissionsForBuiltObject
//   Galaxy.cs 3203 IndependentColoniesMakeDefendOffersToPirates, 3237 IndependentColoniesMakeSmugglingOffersToPirates
//   Galaxy.8.cs 3488 CancelPirateMissionsForTarget (3398 ReviewPirateEmpireActivities is in pirateGalaxyTick.ts)
//   Galaxy.7.cs 279 DetermineSpacePortAtColonyIncludingUnderConstruction, 960/1015 FindNearestKnownBase(InSet)
//   Empire.2.cs 1138-2146: MakeDefendOffersToPirates, DetermineOfferPirateDefendMissionToPirateFaction,
//     IdentifyMostAtRiskColoniesBases, ReviewPirateDefendMissions, ReviewPirateSmugglingMissions,
//     MakeSmugglingOffersToPirates, IdentifyResourceDeficientColony, DetermineColonyDeficientInResources,
//     DetermineColonyDeficientInResource, MakeAttackOffersToPirates, PiratesMakeAttackOffers,
//     PirateCheckMissionsOnOffer, PirateCheckAcceptDefendMission, PirateCheckAcceptAttackMission,
//     IdentifyPirateAttackTargetForRelation (both), CalculatePirateMissionPriceWillingToBidFor,
//     CalculatePirateAttackPrice, CalculatePirateDefendPrice, CalculatePirateSmugglePricePerUnit
//   Empire.2.cs 2401 ReviewPirateRelations
//   Empire.4.cs 1543 CompletePirateMission
//   Empire.9.cs 3019 IsObjectAreaKnownToThisEmpire; Empire.6.cs 1299 CountIdleFreighters
//   EmpireActivityList.cs 25 CountMissionsInSameSystem, 315 ResolveByTypeKnownTarget,
//     329 ResolveByAllowedDefendTargetsNotRequestedBy, 406 ResolveByKnownAttackTargetsNotRequestedBy
//   EmpireEvaluationList.cs 42 GetLowestEvaluationKnownEmpire
//   BuiltObjectList.cs 146 TotalMobileMilitaryFirepowerNotAttackingDefending; ShipGroupList.cs 55 IdentifyLargestFleet
//   BuiltObject.1.cs 2263-2313 CalculateOverallStrengthFactor (+ Shield / Firepower / Fighter factors)
// Message texts are TextResolver keys (gameText) until M9 localises them. The C# advisor texts
// (GenerateAutomationMessage*) only feed the player prompt in CheckTaskAuthorized and are not built.

import type { Galaxy } from '../galaxy';
import { AutomationLevel, empireGovernmentAttributes, type Empire } from '../empire';
import { BuiltObject } from '../builtObject';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { Habitat, HabitatType } from '../types';
import { ResourceRef } from '../cargo';
import { BuiltObjectRole } from '../data/designSpecifications';
import { galaxyResourceCurrentPrices, type Design } from '../design';
import { findNewestCanBuild } from '../designGeneration';
import { DiplomaticRelationType, DiplomaticStrategy, obtainDiplomaticRelation, type DiplomaticRelation, type EmpireEvaluation } from '../diplomacy';
import { annualPrivateMaintenanceExcludingUnderConstruction, annualTaxRevenue, checkAtWar, checkEmpireHasHyperDriveTech, privateAnnualRevenue } from '../forceStructure';
import { REAL_SECONDS_IN_GALACTIC_YEAR } from '../galaxyTime';
import { isObjectVisibleToThisEmpire } from '../independentTraders';
import { EmpireMessageType, sendMessageToEmpire } from '../messages';
import { BuiltObjectMissionType, builtObjectMission } from '../missions/mission';
import { PiratePlayStyle } from '../pirates';
import { PirateRelation, PirateRelationEvaluationType, PirateRelationList, PirateRelationType, changePirateEvaluation, changePirateRelation, obtainPirateRelation } from '../pirateRelations';
import { Random } from '../random';
import { csInt } from '../builtObjectComponent';
import { galaxyStarDate } from '../tick/simTime';
import { gameText } from '../colonyTick';
import { calculateAnnualCashflow } from '../treasury';
import { estimatedDefensiveForceRequired } from '../troops';
import { CharacterRole, getCharactersByRole, type Character } from '../characters';
import { empireShipGroups, shipGroupTotalOverallStrengthFactor, type ShipGroup } from '../fleets/shipGroup';
import { identifyMechanoidEmpire } from '../fleets/militaryAI';
import { calculateResourceLevelHabitat, determineCriticalResources, determineSpacePortAtHabitat } from '../logistics/colonySupply';
import {
    MINIMUM_CONTRACT_SIZE,
    Order,
    OrderList,
    OrderType,
    calculateMaximumOrderFulfillmentDistance,
    calculateOrderPlacementDate,
    cargoAvailable,
    cargoGetCargoById,
    checkTaskAuthorized,
    countResourceSupplyLocations,
} from '../logistics/orders';
import { thisYearsPrivateFuelCosts } from '../logistics/refuel';
import { determineDesirePirateProtection } from './pirateAI';
import { PirateIncomeType } from './pirateEconomy';
import { EmpireActivity, EmpireActivityList, EmpireActivityType, type ActivityTarget } from './empireActivity';
import { crisesBlocksSmuggleOffer, crisesOn, crisisSmuggleCap, empireHasColonyCrisis } from '../scenario/emergent/crisesCore';

export { EmpireActivity, EmpireActivityList, EmpireActivityType };

const f = Math.fround;
const BYTE_MAX = 255;

// ---------------------------------------------------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------------------------------------------------

/** StellarObject.Empire (Habitat.Empire / BuiltObject.Empire). */
function targetEmpireOf(target: ActivityTarget): Empire | null {
    return target.empire;
}

/** `new Resource(id).Name` for message texts. */
export function resourceName(galaxy: Galaxy, resourceId: number): string {
    return galaxy.resourceSystem.byId.get(resourceId)?.name ?? '';
}

/** C# `double.ToString("0")` for message texts (the formatter rounds half away from zero). */
export function price0(value: number): string {
    return (Math.sign(value) * Math.round(Math.abs(value))).toFixed(0);
}

function isSpacePortSubRole(subRole: BuiltObjectSubRole): boolean {
    return subRole === BuiltObjectSubRole.SmallSpacePort || subRole === BuiltObjectSubRole.MediumSpacePort || subRole === BuiltObjectSubRole.LargeSpacePort;
}

/**
 * Empire.LatestDesigns.FindNewestCanBuild(subRole, empire) (DesignList.cs 156). LatestDesigns is indexed by sub-role
 * and holds nulls, which DesignList skips (same as pirates.ts latestDesignsFindNewestCanBuild).
 */
function latestDesignsFindNewestCanBuild(empire: Empire, subRole: BuiltObjectSubRole): Design | null {
    const latest = empire.latestDesigns.filter((d): d is Design => d !== null);
    return findNewestCanBuild(latest, subRole, empire);
}

/** Galaxy.cs 1765 CreateOrder(colony, resource, amount, isState, expiryDate) = Empire.4.cs 4063 (Type Standard). */
export function createOrderWithExpiry(galaxy: Galaxy, colony: Habitat, resourceId: number, amount: number, isState: boolean, type: OrderType, expiryDate: number): Order {
    const maximumFulfillmentDistance = calculateMaximumOrderFulfillmentDistance(galaxy, colony.xpos, colony.ypos);
    const order = new Order(galaxy, colony, new ResourceRef(resourceId), amount, expiryDate, maximumFulfillmentDistance);
    order.type = type;
    order.minimumContractSize = MINIMUM_CONTRACT_SIZE;
    order.isStateOrder = isState;
    galaxy.orders.add(order);
    return order;
}

/** Orders of a colony plus its space port's orders (the repeated DetermineColonyDeficient* / IdentifyResourceDeficientColony prologue). */
function colonyAndSpacePortOrders(orders: OrderList, colony: Habitat): OrderList {
    let builtObject: BuiltObject | null = null;
    if (colony.hasSpacePort) builtObject = determineSpacePortAtHabitat(colony);
    const orders2 = orders.getOrdersForHabitat(colony);
    if (builtObject !== null && builtObject.isSpacePort) {
        const orders3 = orders.getOrdersForBuiltObject(builtObject);
        if (orders3.count > 0) orders2.addRange(orders3);
    }
    return orders2;
}

/** Empire.9.cs 3019 IsObjectAreaKnownToThisEmpire(stellarObject). No Rnd. */
export function isObjectAreaKnownToThisEmpire(galaxy: Galaxy, empire: Empire, stellarObject: ActivityTarget): boolean {
    const habitat = galaxy.findNearestHabitatOfType(stellarObject.xpos, stellarObject.ypos, HabitatType.Undefined);
    if (habitat !== null) {
        const num = galaxy.calculateDistance(stellarObject.xpos, stellarObject.ypos, habitat.xpos, habitat.ypos);
        if (num <= galaxy.maxSolarSystemSize * 2.1 && empire.visibility.checkSystemExplored(habitat.systemIndex)) return true;
    }
    if (isObjectVisibleToThisEmpire(galaxy, empire, stellarObject)) return true;
    return false;
}

/** BuiltObject.1.cs 2263 CalculateShieldStrengthFactor: (int)(CurrentShields / 20f). */
function calculateShieldStrengthFactor(builtObject: BuiltObject): number {
    return csInt(f(f(builtObject.currentShields) / 20));
}

/** BuiltObject.1.cs 2281 CalculateFighterFactor. Fighters are M4p; the TS list is loosely typed. */
function calculateFighterFactor(builtObject: BuiltObject): number {
    let num = 0;
    const fighters = builtObject.fighters as ({ hasBeenDestroyed: boolean; underConstruction: boolean; firepowerRaw: number } | null)[] | null;
    if (fighters != null) {
        for (let i = 0; i < fighters.length; i++) {
            const fighter = fighters[i];
            if (fighter != null && !fighter.hasBeenDestroyed && !fighter.underConstruction) num = (num + fighter.firepowerRaw) | 0;
        }
    }
    return num;
}

/** BuiltObject.1.cs 2298 CalculateFirepowerFactor (float accumulation). */
function calculateFirepowerFactor(builtObject: BuiltObject): number {
    let num = 0;
    if (builtObject.weapons != null) {
        for (let i = 0; i < builtObject.weapons.length; i++) {
            const weapon = builtObject.weapons[i];
            if (weapon != null) num = f(num + f(f(weapon.rawDamage) / f(f(weapon.fireRate) / 1000)));
        }
    }
    return csInt(num);
}

/** BuiltObject.1.cs 2268 CalculateOverallStrengthFactor. No Rnd. */
export function calculateOverallStrengthFactor(builtObject: BuiltObject): number {
    const num = calculateShieldStrengthFactor(builtObject);
    const num2 = calculateFirepowerFactor(builtObject);
    const num3 = calculateFighterFactor(builtObject);
    return (num + num2 + num3) | 0;
}

/** ShipGroupList.cs 55 IdentifyLargestFleet. */
function identifyLargestFleet(shipGroups: (ShipGroup | null)[]): ShipGroup | null {
    let shipGroup: ShipGroup | null = null;
    for (let index = 0; index < shipGroups.length; ++index) {
        if (shipGroup === null || shipGroups[index]!.ships.length > shipGroup.ships.length) shipGroup = shipGroups[index];
    }
    return shipGroup;
}

/** BuiltObjectList.cs 146 TotalMobileMilitaryFirepowerNotAttackingDefending(out shipCount). */
export function totalMobileMilitaryFirepowerNotAttackingDefending(builtObjects: readonly (BuiltObject | null)[]): { firepower: number; shipCount: number } {
    let num = 0;
    let shipCount = 0;
    for (let i = 0; i < builtObjects.length; i++) {
        const builtObject = builtObjects[i];
        if (builtObject == null || builtObject.hasBeenDestroyed || builtObject.role !== BuiltObjectRole.Military || builtObject.unbuiltComponentCount > 0 || !(builtObject.topSpeed > 0)) continue;
        const mission = builtObjectMission(builtObject.mission);
        if (
            mission === null ||
            (mission.type !== BuiltObjectMissionType.Attack &&
                mission.type !== BuiltObjectMissionType.Bombard &&
                mission.type !== BuiltObjectMissionType.WaitAndAttack &&
                mission.type !== BuiltObjectMissionType.WaitAndBombard &&
                mission.type !== BuiltObjectMissionType.Capture &&
                mission.type !== BuiltObjectMissionType.Raid &&
                mission.type !== BuiltObjectMissionType.MoveAndWait)
        ) {
            num = (num + builtObject.firepowerRaw) | 0;
            shipCount++;
        }
    }
    return { firepower: num, shipCount };
}

/** Empire.6.cs 1299 CountIdleFreighters. */
export function countIdleFreighters(empire: Empire): number {
    let num = 0;
    for (let i = 0; i < empire.privateBuiltObjects.length; i++) {
        const builtObject = empire.privateBuiltObjects[i];
        if (builtObject == null || builtObject.hasBeenDestroyed || builtObject.unbuiltComponentCount > 0 || builtObject.role !== BuiltObjectRole.Freight) continue;
        const mission = builtObjectMission(builtObject.mission);
        if (mission === null || mission.type === BuiltObjectMissionType.Undefined) num++;
    }
    return num;
}

/** Galaxy.7.cs 279 DetermineSpacePortAtColonyIncludingUnderConstruction(colony). */
export function determineSpacePortAtColonyIncludingUnderConstruction(colony: Habitat): BuiltObject | null {
    if (colony.basesAtHabitat != null && colony.basesAtHabitat.length > 0) {
        for (let i = 0; i < colony.basesAtHabitat.length; i++) {
            const builtObject = colony.basesAtHabitat[i];
            if (builtObject != null && isSpacePortSubRole(builtObject.subRole)) return builtObject;
        }
    }
    return null;
}

/** Galaxy.7.cs 1015 FindNearestKnownBaseInSet(requester, x, y, builtObjects, out nearestDistanceSquared, maximumOverallStrength). */
function findNearestKnownBaseInSet(galaxy: Galaxy, requester: Empire | null, x: number, y: number, builtObjects: readonly (BuiltObject | null)[] | null, maximumOverallStrength: number): { builtObject: BuiltObject | null; nearestDistanceSquared: number } {
    let builtObject: BuiltObject | null = null;
    let nearestDistanceSquared = Number.MAX_VALUE;
    if (requester !== null && builtObjects != null) {
        for (let i = 0; i < builtObjects.length; i++) {
            const builtObject2 = builtObjects[i];
            if (builtObject2 == null || builtObject2.hasBeenDestroyed || calculateOverallStrengthFactor(builtObject2) > maximumOverallStrength) continue;
            const num = galaxy.calculateDistanceSquared(x, y, builtObject2.xpos, builtObject2.ypos);
            if (builtObject !== null && !(num < nearestDistanceSquared)) continue;
            if (isSpacePortSubRole(builtObject2.subRole)) {
                if (isObjectAreaKnownToThisEmpire(galaxy, requester, builtObject2)) {
                    builtObject = builtObject2;
                    nearestDistanceSquared = num;
                }
            } else if (isObjectVisibleToThisEmpire(galaxy, requester, builtObject2, true, false)) {
                builtObject = builtObject2;
                nearestDistanceSquared = num;
            }
        }
    }
    return { builtObject, nearestDistanceSquared };
}

/** Galaxy.7.cs 960 FindNearestKnownBase(requester, x, y, targetEmpire, maximumOverallStrength). No Rnd. */
export function findNearestKnownBase(galaxy: Galaxy, requester: Empire | null, x: number, y: number, targetEmpire: Empire | null, maximumOverallStrength: number): BuiltObject | null {
    let result: BuiltObject | null = null;
    if (requester !== null && targetEmpire !== null) {
        let b1: BuiltObject | null = null;
        let b2: BuiltObject | null = null;
        let b3: BuiltObject | null = null;
        let b4: BuiltObject | null = null;
        let d1 = Number.MAX_VALUE;
        let d2 = Number.MAX_VALUE;
        let d3 = Number.MAX_VALUE;
        let d4 = Number.MAX_VALUE;
        if (targetEmpire.spacePorts != null) ({ builtObject: b1, nearestDistanceSquared: d1 } = findNearestKnownBaseInSet(galaxy, requester, x, y, targetEmpire.spacePorts, maximumOverallStrength));
        if (targetEmpire.miningStations != null) ({ builtObject: b2, nearestDistanceSquared: d2 } = findNearestKnownBaseInSet(galaxy, requester, x, y, targetEmpire.miningStations, maximumOverallStrength));
        if (targetEmpire.resortBases != null) ({ builtObject: b3, nearestDistanceSquared: d3 } = findNearestKnownBaseInSet(galaxy, requester, x, y, targetEmpire.resortBases as (BuiltObject | null)[], maximumOverallStrength));
        if (targetEmpire.researchFacilities != null) ({ builtObject: b4, nearestDistanceSquared: d4 } = findNearestKnownBaseInSet(galaxy, requester, x, y, targetEmpire.researchFacilities as (BuiltObject | null)[], maximumOverallStrength));
        if (b1 !== null && d1 < d2 && d1 < d3 && d1 < d4) result = b1;
        else if (b2 !== null && d2 < d1 && d2 < d3 && d2 < d4) result = b2;
        else if (b3 !== null && d3 < d1 && d3 < d2 && d3 < d4) result = b3;
        else if (b4 !== null && d4 < d1 && d4 < d2 && d4 < d3) result = b4;
    }
    return result;
}

// ---------------------------------------------------------------------------------------------------------------------
// EmpireActivityList methods that need galaxy helpers (EmpireActivityList.cs)
// ---------------------------------------------------------------------------------------------------------------------

/** EmpireActivityList.cs 25 CountMissionsInSameSystem(systemStar, type, requestingEmpire). */
export function countMissionsInSameSystem(galaxy: Galaxy, list: EmpireActivityList, systemStar: Habitat | null, type: EmpireActivityType, requestingEmpire: Empire | null): number {
    let num = 0;
    for (let index = 0; index < list.count; ++index) {
        const a = list.at(index);
        if (a === null || a.type !== type || a.requestingEmpire !== requestingEmpire) continue;
        let habitat: Habitat | null = null;
        if (a.target instanceof Habitat) habitat = galaxy.determineHabitatSystemStar(a.target);
        else if (a.target instanceof BuiltObject) habitat = a.target.nearestSystemStar;
        if (habitat !== null && habitat === systemStar) ++num;
    }
    return num;
}

/** EmpireActivityList.cs 315 ResolveByTypeKnownTarget(type, empire) (UI list; no Rnd). */
export function resolveByTypeKnownTarget(galaxy: Galaxy, list: EmpireActivityList, type: EmpireActivityType, empire: Empire | null): EmpireActivityList {
    const result = new EmpireActivityList();
    if (empire !== null) {
        for (let index = 0; index < list.count; ++index) {
            const a = list.at(index);
            if (a !== null && a.type === type && isObjectAreaKnownToThisEmpire(galaxy, empire, a.target!)) result.add(a);
        }
    }
    return result;
}

/** EmpireActivityList.cs 329 ResolveByAllowedDefendTargetsNotRequestedBy(pirateEmpire) (UI list; no Rnd). */
export function resolveByAllowedDefendTargetsNotRequestedBy(galaxy: Galaxy, list: EmpireActivityList, pirateEmpire: Empire | null): EmpireActivityList {
    const result = new EmpireActivityList();
    if (pirateEmpire !== null) {
        for (let index = 0; index < list.count; ++index) {
            const a = list.at(index);
            if (a !== null && a.type === EmpireActivityType.Defend && a.requestingEmpire !== pirateEmpire && a.target !== null && isObjectAreaKnownToThisEmpire(galaxy, pirateEmpire, a.target) && determineOfferPirateDefendMissionToPirateFaction(galaxy, a.requestingEmpire!, pirateEmpire)) result.add(a);
        }
    }
    return result;
}

/** EmpireActivityList.cs 406 ResolveByKnownAttackTargetsNotRequestedBy(empire) (UI list; no Rnd). */
export function resolveByKnownAttackTargetsNotRequestedBy(galaxy: Galaxy, list: EmpireActivityList, empire: Empire | null): EmpireActivityList {
    const result = new EmpireActivityList();
    if (empire !== null) {
        for (let index = 0; index < list.count; ++index) {
            const a = list.at(index);
            if (a !== null && a.type === EmpireActivityType.Attack && a.target !== null && a.requestingEmpire !== empire && isObjectAreaKnownToThisEmpire(galaxy, empire, a.target)) result.add(a);
        }
    }
    return result;
}

// Added by M4d (Empire.4.cs 735 CheckMarketOrders smuggling branch, logistics/freight.ts); now the real class.
export type EmpireActivityRef = EmpireActivity;

/** Empire._PirateMissions.ResolveActivitiesByType(type) (EmpireActivityList.cs 50) as an array (M4d freight.ts). */
export function resolvePirateMissionsByType(galaxy: Galaxy, empire: Empire, type: number): EmpireActivity[] {
    void galaxy;
    return empire.pirateMissions.resolveActivitiesByType(type as EmpireActivityType).items as EmpireActivity[];
}

// ---------------------------------------------------------------------------------------------------------------------
// Galaxy: marketplace bookkeeping
// ---------------------------------------------------------------------------------------------------------------------

/** Galaxy.9.cs 527 ReviewPirateMissionsAndAssign(starDate, timePassed) — every frame (DoTasksTimeSensitive). No Rnd. */
export function reviewPirateMissionsAndAssign(galaxy: Galaxy, starDate: number, timePassed: number): void {
    const empireActivityList: EmpireActivity[] = [];
    const empireActivityList2: EmpireActivity[] = [];
    const pirateMissions = galaxy.pirateMissions;
    for (let i = 0; i < pirateMissions.count; i++) {
        const empireActivity = pirateMissions.at(i);
        if (empireActivity === null || (empireActivity.type !== EmpireActivityType.Attack && empireActivity.type !== EmpireActivityType.Defend)) continue;
        if (empireActivity.assignedEmpire !== null) {
            const num = Math.trunc(timePassed * 1000.0);
            empireActivity.bidTimeRemaining -= num;
            if (empireActivity.bidTimeRemaining <= 0) {
                empireActivity.bidTimeRemaining = 0;
                empireActivity.expiryDate = starDate + Math.trunc(2.0 * REAL_SECONDS_IN_GALACTIC_YEAR * 1000.0);
                empireActivity.assignedEmpire.pirateMissions.add(empireActivity);
                empireActivityList.push(empireActivity);
            }
        } else if (empireActivity.expiryDate < starDate) {
            empireActivityList2.push(empireActivity);
        }
    }
    for (let j = 0; j < empireActivityList.length; j++) pirateMissions.remove(empireActivityList[j]);
    for (let k = 0; k < empireActivityList2.length; k++) {
        const empireActivity2 = empireActivityList2[k];
        if (empireActivity2.assignedEmpire !== null) completePirateMission(galaxy, empireActivity2.assignedEmpire, empireActivity2);
        if (empireActivity2.requestingEmpire !== null && empireActivity2.requestingEmpire.pirateMissions != null) empireActivity2.requestingEmpire.pirateMissions.remove(empireActivity2);
        pirateMissions.remove(empireActivity2);
    }
}

/** The "Pirate Smuggle Mission Completed Pirate[ Independent][ All Resources]" text (Galaxy.9.cs 477 / Galaxy.8.cs 3443). */
export function smugglingCompletedPirateText(galaxy: Galaxy, m: EmpireActivity): string {
    const name = m.target !== null ? m.target.name : '';
    if (m.requestingEmpire === galaxy.independentEmpire) {
        return m.resourceId !== BYTE_MAX ? gameText('Pirate Smuggle Mission Completed Pirate Independent', name, resourceName(galaxy, m.resourceId)) : gameText('Pirate Smuggle Mission Completed Pirate Independent All Resources', name);
    }
    return m.resourceId !== BYTE_MAX
        ? gameText('Pirate Smuggle Mission Completed Pirate', name, resourceName(galaxy, m.resourceId), m.requestingEmpire!.name)
        : gameText('Pirate Smuggle Mission Completed Pirate All Resources', name, m.requestingEmpire!.name);
}

/** Galaxy.9.cs 469 RemovePirateSmugglingMissionFromAllEmpires(smugglingMission). No Rnd. */
export function removePirateSmugglingMissionFromAllEmpires(galaxy: Galaxy, smugglingMission: EmpireActivity): void {
    for (let i = 0; i < galaxy.pirateEmpires.length; i++) {
        const empire = galaxy.pirateEmpires[i];
        if (empire != null && empire.active && empire.pirateMissions != null && empire.pirateMissions.containsEquivalentTarget(smugglingMission.target, smugglingMission.type)) {
            sendMessageToEmpire(empire, empire, EmpireMessageType.PirateSmugglingMissionCompleted, smugglingMission.target, smugglingCompletedPirateText(galaxy, smugglingMission));
            empire.pirateMissions.removeEquivalent(smugglingMission);
        }
    }
}

/** Galaxy.9.cs 576 CheckCancelAttackMissionsForBuiltObject(builtObject, empireToExclude). No Rnd. */
export function checkCancelAttackMissionsForBuiltObject(galaxy: Galaxy, builtObject: BuiltObject, empireToExclude: Empire | null): boolean {
    let result = false;
    for (let i = 0; i < galaxy.pirateEmpires.length; i++) {
        const empire = galaxy.pirateEmpires[i];
        if (empire == null || !empire.active || empire.pirateMissions == null || (empireToExclude !== null && empire === empireToExclude)) continue;
        const byAttackTarget = empire.pirateMissions.getByAttackTarget(builtObject, empire);
        if (byAttackTarget === null) continue;
        empire.pirateMissions.remove(byAttackTarget);
        if (byAttackTarget.requestingEmpire !== null && byAttackTarget.requestingEmpire.pirateMissions != null) byAttackTarget.requestingEmpire.pirateMissions.remove(byAttackTarget);
        if (byAttackTarget.assignedEmpire !== null && byAttackTarget.assignedEmpire.pirateMissions != null) byAttackTarget.assignedEmpire.pirateMissions.remove(byAttackTarget);
        if (byAttackTarget.requestingEmpire !== null) {
            let description = gameText('Pirate Attack Mission Cancelled Pirate', byAttackTarget.target!.name, byAttackTarget.requestingEmpire.name);
            sendMessageToEmpire(empire, empire, EmpireMessageType.PirateAttackMissionCompleted, byAttackTarget.target, description);
            description = gameText('Pirate Attack Mission Cancelled Other', byAttackTarget.target!.name, empire.name);
            sendMessageToEmpire(byAttackTarget.requestingEmpire, byAttackTarget.requestingEmpire, EmpireMessageType.PirateAttackMissionCompleted, byAttackTarget.target, description);
        }
        result = true;
    }
    return result;
}

/** Galaxy.8.cs 3488 CancelPirateMissionsForTarget(target, type). No Rnd. */
export function cancelPirateMissionsForTarget(galaxy: Galaxy, target: ActivityTarget, type: EmpireActivityType): void {
    const strip = (list: EmpireActivityList): void => {
        const found = list.resolveByTypeAndTarget(type, target);
        for (let i = 0; i < found.count; i++) {
            const a = found.at(i);
            if (a === null) continue;
            list.remove(a);
            if (a.type === EmpireActivityType.Smuggle && a.relatedOrder !== null) a.relatedOrder.expiryDate = galaxyStarDate(galaxy);
        }
    };
    if (galaxy.independentEmpire !== null && galaxy.independentEmpire.pirateMissions != null) strip(galaxy.independentEmpire.pirateMissions);
    for (let j = 0; j < galaxy.empires.length; j++) {
        const empire = galaxy.empires[j];
        if (empire != null && empire.pirateMissions != null) strip(empire.pirateMissions);
    }
    for (let l = 0; l < galaxy.pirateEmpires.length; l++) {
        const empire2 = galaxy.pirateEmpires[l];
        if (empire2 != null && empire2.pirateMissions != null) strip(empire2.pirateMissions);
    }
    strip(galaxy.pirateMissions);
}

// ---------------------------------------------------------------------------------------------------------------------
// Galaxy: independent colony offers (Galaxy long block)
// ---------------------------------------------------------------------------------------------------------------------

/** Galaxy.cs 3203 IndependentColoniesMakeDefendOffersToPirates(starDate). Rnd: Next(0, 30) per live independent colony. */
export function independentColoniesMakeDefendOffersToPirates(galaxy: Galaxy, starDate: number): void {
    const independentEmpire = galaxy.independentEmpire;
    for (let i = 0; i < galaxy.independentColonies.length; i++) {
        const habitat = galaxy.independentColonies[i];
        if (habitat == null || habitat.hasBeenDestroyed || habitat.empire !== independentEmpire || galaxy.rnd.next(0, 30) !== 1) continue;
        const attackPrice = calculatePirateDefendPrice(galaxy, independentEmpire!, habitat);
        if (galaxy.pirateEmpires.length <= 0) continue;
        const expiryDate = starDate + Math.trunc(1.0 * REAL_SECONDS_IN_GALACTIC_YEAR * 1000.0);
        const empireActivity = new EmpireActivity(independentEmpire, independentEmpire, expiryDate, EmpireActivityType.Defend, habitat, attackPrice);
        if (independentEmpire!.pirateMissions.containsEquivalentTarget(empireActivity.target, empireActivity.type)) continue;
        independentEmpire!.pirateMissions.add(empireActivity);
        galaxy.pirateMissions.add(empireActivity);
        for (let j = 0; j < galaxy.pirateEmpires.length; j++) {
            const empire = galaxy.pirateEmpires[j];
            if (empire != null && empire.pirateEmpireBaseHabitat !== null && isObjectAreaKnownToThisEmpire(galaxy, empire, habitat)) {
                const description = gameText('Pirate Defend Mission Available Independent', habitat.name);
                sendMessageToEmpire(empire, empire, EmpireMessageType.PirateDefendMissionAvailable, empireActivity, description);
            }
        }
    }
}

/**
 * Galaxy.cs 3237 IndependentColoniesMakeSmugglingOffersToPirates(starDate). Rnd: Next(0, 2) per populated independent
 * colony, then Next(0, orders) inside DetermineColonyDeficientInResources for each colony passing it.
 */
export function independentColoniesMakeSmugglingOffersToPirates(galaxy: Galaxy, starDate: number): void {
    const independentEmpire = galaxy.independentEmpire!;
    const orders = galaxy.orders.getOrdersForEmpire(independentEmpire);
    const maximumOrderTimeLength = Math.trunc(REAL_SECONDS_IN_GALACTIC_YEAR * 1000.0 * 0.25);
    const maximumAmountOutstanding = 100;
    for (let i = 0; i < galaxy.independentColonies.length; i++) {
        const habitat = galaxy.independentColonies[i];
        if (habitat == null || habitat.hasBeenDestroyed || habitat.population == null || habitat.population.items.length <= 0 || habitat.empire !== independentEmpire || galaxy.rnd.next(0, 2) !== 1) continue;
        const deficient = determineColonyDeficientInResources(galaxy, independentEmpire, habitat, orders, true, maximumOrderTimeLength, maximumAmountOutstanding);
        if (!deficient.deficient) continue;
        const deficientResourceId = deficient.deficientResourceId;
        const attackPrice = calculatePirateSmugglePricePerUnit(galaxy, independentEmpire, habitat, deficientResourceId);
        const expiryDate = starDate + Math.trunc(3.0 * REAL_SECONDS_IN_GALACTIC_YEAR * 1000.0);
        const empireActivity = new EmpireActivity(independentEmpire, independentEmpire, expiryDate, EmpireActivityType.Smuggle, habitat, attackPrice);
        empireActivity.resourceId = deficientResourceId;
        if (independentEmpire.pirateMissions.containsEquivalentTarget(empireActivity.target, empireActivity.type)) continue;
        empireActivity.relatedOrder = createOrderWithExpiry(galaxy, habitat, deficientResourceId, 10000, true, OrderType.Standard, expiryDate);
        independentEmpire.pirateMissions.add(empireActivity);
        galaxy.pirateMissions.add(empireActivity);
        for (let j = 0; j < galaxy.pirateEmpires.length; j++) {
            const empire = galaxy.pirateEmpires[j];
            if (empire != null && empire.pirateEmpireBaseHabitat !== null && isObjectAreaKnownToThisEmpire(galaxy, empire, habitat)) {
                const empty =
                    empireActivity.resourceId !== BYTE_MAX
                        ? gameText('Pirate Smuggle Mission Available Independent', habitat.name, resourceName(galaxy, empireActivity.resourceId))
                        : gameText('Pirate Smuggle Mission Available Independent All Resources', habitat.name);
                sendMessageToEmpire(independentEmpire, empire, EmpireMessageType.PirateSmugglingMissionAvailable, empireActivity, empty);
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Empire: prices
// ---------------------------------------------------------------------------------------------------------------------

/** Empire.2.cs 2244 CalculatePirateAttackPrice(target): double.MaxValue for non-ships. */
export function calculatePirateAttackPrice(galaxy: Galaxy, empire: Empire, target: ActivityTarget): number {
    let result = Number.MAX_VALUE;
    if (target instanceof BuiltObject) {
        if (isObjectVisibleToThisEmpire(galaxy, empire, target)) {
            const num = (target.firepowerRaw + target.currentEscortForceAssigned) | 0;
            result = 100.0 * Math.max(num, target.size * 0.1);
        } else {
            result = 100.0 * Math.max(target.firepowerRaw, target.size * 0.1);
        }
    }
    return result;
}

/** Empire.2.cs 2262 CalculatePirateDefendPrice(target). */
export function calculatePirateDefendPrice(galaxy: Galaxy, empire: Empire, target: ActivityTarget): number {
    let result = 0.0;
    if (target instanceof BuiltObject) {
        const firepowerRaw = target.firepowerRaw;
        const num = Math.trunc(target.size / 10);
        const num2 = Math.max(5, num - firepowerRaw);
        if (num2 > 0) result = Math.max(1000.0, Math.min(8000.0, num2 * 200.0));
    } else if (target instanceof Habitat) {
        const num3 = estimatedDefensiveForceRequired(galaxy, target, checkAtWar(empire), galaxy.difficultyLevel);
        const num4 = num3;
        if (num4 > 0) result = Math.max(5000.0, Math.min(30000.0, 200.0 * num4));
    }
    return result;
}

/** Empire.2.cs 2288 CalculatePirateSmugglePricePerUnit(colony, resourceId). */
export function calculatePirateSmugglePricePerUnit(galaxy: Galaxy, empire: Empire, colony: Habitat, resourceId: number): number {
    void empire;
    void colony;
    const num2 = galaxyResourceCurrentPrices(galaxy)[resourceId];
    // 19d2 resource crises (scenario flag): crisis-priced goods fetch more than the stock 5-credit cap.
    if (galaxy.scenario !== null && crisesOn(galaxy)) return Math.min(crisisSmuggleCap(galaxy), Math.max(0.1, num2 * 0.5));
    return Math.min(5.0, Math.max(0.1, num2 * 0.5));
}

/**
 * Empire.2.cs 2224 CalculatePirateMissionPriceWillingToBidFor(mission). Uses a target-seeded
 * `new Random((int)Target.Xpos + EmpireId)` (deterministic; not Galaxy.Rnd).
 */
export function calculatePirateMissionPriceWillingToBidFor(galaxy: Galaxy, empire: Empire, mission: EmpireActivity | null): number {
    let result = 0.0;
    if (mission !== null && mission.target !== null) {
        let num = 0.0;
        const random = new Random((csInt(mission.target.xpos) + empire.empireId) | 0);
        switch (mission.type) {
            case EmpireActivityType.Attack:
                num = calculatePirateAttackPrice(galaxy, empire, mission.target);
                break;
            case EmpireActivityType.Defend:
                num = calculatePirateDefendPrice(galaxy, empire, mission.target);
                break;
        }
        result = num * 0.4 + random.nextDouble() * num * 0.35;
    }
    return result;
}

// ---------------------------------------------------------------------------------------------------------------------
// Empire: completion / reviews
// ---------------------------------------------------------------------------------------------------------------------

/** Empire.4.cs 1543 CompletePirateMission(mission) (`this` = the pirate faction being paid). No Rnd. */
export function completePirateMission(galaxy: Galaxy, empire: Empire, mission: EmpireActivity | null): void {
    if (mission === null || mission.requestingEmpire === null) return;
    changePirateEvaluation(mission.requestingEmpire, empire, 10, PirateRelationEvaluationType.PirateMissionsSucceed);
    mission.requestingEmpire.stateMoney -= mission.price;
    empire.stateMoney += mission.price;
    empire.pirateEconomy.performIncome(mission.price, PirateIncomeType.Missions, galaxyStarDate(galaxy));
    switch (mission.type) {
        case EmpireActivityType.Attack:
            empire.counters.completedPirateMissionAttackCount++;
            break;
        case EmpireActivityType.Defend:
            empire.counters.completedPirateMissionDefendCount++;
            break;
    }
    empire.pirateMissions.remove(mission);
    mission.requestingEmpire.pirateMissions.remove(mission);
    if (mission.assignedEmpire !== null && mission.assignedEmpire.pirateMissions != null) mission.assignedEmpire.pirateMissions.remove(mission);
    const targetName = mission.target !== null ? mission.target.name : '';
    let description = '';
    let messageType = EmpireMessageType.PirateAttackMissionCompleted;
    switch (mission.type) {
        case EmpireActivityType.Attack:
            description = gameText('Pirate Attack Mission Completed Pirate', mission.requestingEmpire.name, targetName, price0(mission.price));
            messageType = EmpireMessageType.PirateAttackMissionCompleted;
            break;
        case EmpireActivityType.Defend:
            description = gameText('Pirate Defend Mission Completed Pirate', mission.requestingEmpire.name, targetName, price0(mission.price));
            messageType = EmpireMessageType.PirateDefendMissionCompleted;
            break;
    }
    sendMessageToEmpire(empire, empire, messageType, mission.target, description);
    description = '';
    switch (mission.type) {
        case EmpireActivityType.Attack:
            description = gameText('Pirate Attack Mission Completed Other', empire.name, targetName, price0(mission.price));
            break;
        case EmpireActivityType.Defend:
            description = gameText('Pirate Defend Mission Completed Other', empire.name, targetName, price0(mission.price));
            break;
    }
    sendMessageToEmpire(mission.requestingEmpire, mission.requestingEmpire, messageType, mission.target, description);
}

/** Empire.2.cs 1313 ReviewPirateDefendMissions(starDate) (Empire periodic block; Galaxy long block for the independents). No Rnd. */
export function reviewPirateDefendMissions(galaxy: Galaxy, empire: Empire, starDate: number): void {
    const empireActivityList = empire.pirateMissions.resolveActivitiesByType(EmpireActivityType.Defend);
    const empireActivityList2: EmpireActivity[] = [];
    if (empireActivityList.count <= 0) return;
    for (let i = 0; i < empireActivityList.count; i++) {
        const empireActivity = empireActivityList.at(i);
        if (empireActivity === null || empireActivity.assignedEmpire === null || empireActivity.requestingEmpire !== empire || empireActivity.target === null || empireActivity.bidTimeRemaining !== 0 || !(starDate >= empireActivity.expiryDate)) continue;
        let flag = true;
        if (empireActivity.target.hasBeenDestroyed) flag = false;
        if (targetEmpireOf(empireActivity.target) !== empireActivity.requestingEmpire) flag = false;
        if (flag) {
            completePirateMission(galaxy, empireActivity.assignedEmpire, empireActivity);
        } else {
            // Empire.2.cs 1339: RequestingEmpire.ObtainPirateRelation(this) with this == RequestingEmpire — a throwaway
            // self relation, so the -20 is lost (C# oddity, kept).
            const pirateRelation = obtainPirateRelation(empireActivity.requestingEmpire, empire);
            pirateRelation.evaluationPirateMissionsFail = f(pirateRelation.evaluationPirateMissionsFail - 20);
            let description = gameText('Pirate Defend Mission Failed Pirate', empireActivity.requestingEmpire.name, empireActivity.target.name, price0(empireActivity.price));
            sendMessageToEmpire(empireActivity.assignedEmpire, empireActivity.assignedEmpire, EmpireMessageType.PirateDefendMissionFailed, empireActivity.target, description);
            description = gameText('Pirate Defend Mission Failed Other', empireActivity.assignedEmpire.name, empireActivity.target.name, price0(empireActivity.price));
            sendMessageToEmpire(empireActivity.requestingEmpire, empireActivity.requestingEmpire, EmpireMessageType.PirateDefendMissionFailed, empireActivity.target, description);
        }
        empireActivityList2.push(empireActivity);
    }
    for (let j = 0; j < empireActivityList2.length; j++) {
        empireActivityList2[j].assignedEmpire!.pirateMissions.removeEquivalent(empireActivityList2[j]);
        empireActivityList2[j].requestingEmpire!.pirateMissions.removeEquivalent(empireActivityList2[j]);
    }
}

/** Empire.2.cs 1358 ReviewPirateSmugglingMissions(starDate). Rnd: DetermineColonyDeficientInResources for "any resource" offers. */
export function reviewPirateSmugglingMissions(galaxy: Galaxy, empire: Empire, starDate: number): void {
    if (empire.controlOfferPirateMissions !== AutomationLevel.FullyAutomated) return;
    const orders = galaxy.orders.getOrdersForEmpire(empire);
    const num = privateAnnualRevenue(galaxy, empire) - (annualPrivateMaintenanceExcludingUnderConstruction(empire) + annualTaxRevenue(galaxy, empire) + thisYearsPrivateFuelCosts(galaxy, empire));
    const empireActivityList = empire.pirateMissions.resolveActivitiesByType(EmpireActivityType.Smuggle);
    const empireActivityList2: EmpireActivity[] = [];
    if (empireActivityList.count <= 0) return;
    for (let i = 0; i < empireActivityList.count; i++) {
        const empireActivity = empireActivityList.at(i);
        if (empireActivity === null || empireActivity.target === null || !(empireActivity.target instanceof Habitat) || empireActivity.bidTimeRemaining > 0) continue;
        let flag = false;
        const colony = empireActivity.target;
        if (empireActivity.requestingEmpire !== galaxy.independentEmpire) {
            let flag2 = true;
            if (empireActivity.resourceId === BYTE_MAX) {
                flag2 = determineColonyDeficientInResources(galaxy, empire, colony, orders, false, 0, 0).deficient;
            } else {
                flag2 = determineColonyDeficientInResource(galaxy, colony, empireActivity.resourceId, 0, 0, empireActivity.relatedOrder, galaxy.orders);
            }
            if (!flag2) flag = true;
            else if (empire.stateMoney < 0.0 || empire.privateMoney < 0.0 || empire.privateMoney < num * 2.0) flag = true;
            else if (empireActivity.expiryDate < starDate) flag = true;
        }
        if (flag) empireActivityList2.push(empireActivity);
    }
    for (let j = 0; j < empireActivityList2.length; j++) {
        const a = empireActivityList2[j];
        removePirateSmugglingMissionFromAllEmpires(galaxy, a);
        empire.pirateMissions.removeEquivalent(a);
        if (galaxy.pirateMissions.containsEquivalentTarget(a.target, a.type)) galaxy.pirateMissions.removeEquivalentTarget(a.target, a.type);
        if (a.relatedOrder !== null) a.relatedOrder.expiryDate = galaxyStarDate(galaxy);
    }
}

/**
 * Empire.2.cs 1592 DetermineColonyDeficientInResources(colony, empireOrders, checkForExistingSmugglingMission,
 * maximumOrderTimeLength, maximumAmountOutstanding, out deficientResourceId). Rnd: Next(0, orders.Count) once the
 * colony passes the owner / existing-mission checks (drawn even for 0 orders).
 */
export function determineColonyDeficientInResources(
    galaxy: Galaxy,
    empire: Empire,
    colony: Habitat | null,
    empireOrders: OrderList,
    checkForExistingSmugglingMission: boolean,
    maximumOrderTimeLength: number,
    maximumAmountOutstanding: number,
): { deficient: boolean; deficientResourceId: number } {
    if (colony !== null && !colony.hasBeenDestroyed && colony.empire === empire && (!checkForExistingSmugglingMission || !empire.pirateMissions.containsEquivalentTarget(colony, EmpireActivityType.Smuggle))) {
        const orders = colonyAndSpacePortOrders(empireOrders, colony);
        const num = galaxy.rnd.next(0, orders.count);
        const check = (order: Order | null): number => {
            if (order == null || order.commodityResource == null) return -1;
            const resourceId = order.commodityResource.resourceId;
            if (colony.resources.some((r) => r.resourceId === resourceId)) return -1;
            const amountOutstandingToContract = order.amountOutstandingToContract;
            if (amountOutstandingToContract > maximumAmountOutstanding) {
                const { timeSinceOrderPlacement } = calculateOrderPlacementDate(galaxy, order);
                if (timeSinceOrderPlacement > maximumOrderTimeLength) return resourceId;
            }
            return -1;
        };
        for (let i = num; i < orders.count; i++) {
            const id = check(orders.at(i));
            if (id >= 0) return { deficient: true, deficientResourceId: id };
        }
        for (let j = 0; j < num; j++) {
            const id = check(orders.at(j));
            if (id >= 0) return { deficient: true, deficientResourceId: id };
        }
    }
    return { deficient: false, deficientResourceId: BYTE_MAX };
}

/** Empire.2.cs 1671/1676 DetermineColonyDeficientInResource(colony, resourceId, maximumOrderTimeLength, maximumAmountOutstanding, relatedOrder[, orders]). No Rnd. */
export function determineColonyDeficientInResource(galaxy: Galaxy, colony: Habitat, resourceId: number, maximumOrderTimeLength: number, maximumAmountOutstanding: number, relatedOrder: Order | null, orders: OrderList): boolean {
    const orders2 = colonyAndSpacePortOrders(orders, colony);
    let num = 0;
    let num2 = 0;
    let flag = false;
    for (let i = 0; i < orders2.count; i++) {
        const order = orders2.at(i);
        if (order != null && order.commodityResource != null && order.commodityResource.resourceId === resourceId && order !== relatedOrder) {
            num = (num + order.amountOutstandingToContract) | 0;
            num2 = (num2 + order.amountStillToArrive) | 0;
            const { timeSinceOrderPlacement } = calculateOrderPlacementDate(galaxy, order);
            if (timeSinceOrderPlacement > maximumOrderTimeLength) flag = true;
        }
    }
    return flag && (num >= maximumAmountOutstanding || num2 >= maximumAmountOutstanding);
}

/** Empire.2.cs 1518 IdentifyResourceDeficientColony(out deficientColony, out deficientResourceId, out deficientResourceCount). No Rnd. */
function identifyResourceDeficientColony(galaxy: Galaxy, empire: Empire): { deficientColony: Habitat | null; deficientResourceId: number; deficientResourceCount: number } {
    let deficientColony: Habitat | null = null;
    let deficientResourceId = BYTE_MAX;
    let deficientResourceCount = 0;
    const num = Math.trunc(0.5 * REAL_SECONDS_IN_GALACTIC_YEAR * 1000.0);
    const orders = galaxy.orders.getOrdersForEmpire(empire);
    let habitat: Habitat | null = null;
    let b = 0;
    let num2 = 0.0;
    const habitatList = empire !== galaxy.independentEmpire ? empire.colonies : galaxy.independentColonies;
    for (let i = 0; i < habitatList.length; i++) {
        const habitat2 = habitatList[i];
        if (habitat2 == null || habitat2.hasBeenDestroyed || habitat2.empire !== empire || empire.pirateMissions.containsEquivalentTarget(habitat2, EmpireActivityType.Smuggle)) continue;
        const resourceList = determineCriticalResources(galaxy, habitat2);
        const orders2 = colonyAndSpacePortOrders(orders, habitat2);
        for (let j = 0; j < orders2.count; j++) {
            const order = orders2.at(j);
            if (order == null || order.commodityResource == null) continue;
            const amountOutstandingToContract = order.amountOutstandingToContract;
            if (amountOutstandingToContract <= 100) continue;
            const { timeSinceOrderPlacement } = calculateOrderPlacementDate(galaxy, order);
            if (timeSinceOrderPlacement <= num) continue;
            let num3 = 0;
            // C# habitat2.Cargo.GetCargo(resource, EmpireId) (an owned colony always has a Cargo list).
            const cargo = habitat2.cargo !== null ? cargoGetCargoById(habitat2.cargo, order.commodityResource.resourceId, empire.empireId) : null;
            if (cargo !== null) num3 = cargoAvailable(cargo);
            const isCriticalResource = resourceList.includes(order.commodityResource.resourceId);
            const num4 = calculateResourceLevelHabitat(galaxy, order.commodityResource.resourceId, habitat2, false, false, isCriticalResource, 0);
            const num5 = csInt(num4 * 0.6);
            if (num3 < num5) {
                deficientResourceCount++;
                const num6 = (timeSinceOrderPlacement / 1000.0) * amountOutstandingToContract;
                if (num6 > num2) {
                    habitat = habitat2;
                    b = order.commodityResource.resourceId;
                    num2 = num6;
                }
            }
        }
    }
    if (num2 > 0.0 && habitat !== null) {
        deficientColony = habitat;
        deficientResourceId = b;
    }
    return { deficientColony, deficientResourceId, deficientResourceCount };
}

// ---------------------------------------------------------------------------------------------------------------------
// Empire: offers (Empire long block, when CheckHaveMetPirates)
// ---------------------------------------------------------------------------------------------------------------------

/** Empire.2.cs 1233 DetermineOfferPirateDefendMissionToPirateFaction(pirateFaction). */
export function determineOfferPirateDefendMissionToPirateFaction(galaxy: Galaxy, empire: Empire, pirateFaction: Empire | null): boolean {
    if (empire === galaxy.independentEmpire) return true;
    if (pirateFaction !== null && pirateFaction.pirateEmpireBaseHabitat !== null) {
        switch (empire.policy!.offerDefensivePirateMissions) {
            case 0:
                return false;
            case 1: {
                const pirateRelation2 = obtainPirateRelation(empire, pirateFaction);
                if (pirateRelation2.type === PirateRelationType.Protection && pirateRelation2.evaluation >= 15) return true;
                break;
            }
            case 2: {
                const pirateRelation = obtainPirateRelation(empire, pirateFaction);
                if (pirateRelation.type === PirateRelationType.Protection) return true;
                break;
            }
        }
    }
    return false;
}

/** Empire.2.cs 1266 IdentifyMostAtRiskColoniesBases. */
export function identifyMostAtRiskColoniesBases(galaxy: Galaxy, empire: Empire): ActivityTarget[] {
    void galaxy;
    const stellarObjectList: ActivityTarget[] = [];
    for (let i = 0; i < empire.diplomaticRelations.count; i++) {
        const diplomaticRelation = empire.diplomaticRelations.at(i);
        if (diplomaticRelation != null && diplomaticRelation.type !== DiplomaticRelationType.NotMet) {
            const diplomaticRelation2 = obtainDiplomaticRelation(diplomaticRelation.otherEmpire!, empire);
            if (diplomaticRelation2.strategy === DiplomaticStrategy.Conquer) {
                stellarObjectList.push(...diplomaticRelation2.warObjectiveBases.slice());
                stellarObjectList.push(...diplomaticRelation2.warObjectiveColonies.slice());
            }
        }
    }
    if (stellarObjectList.length <= 0 && !checkEmpireHasHyperDriveTech(empire) && empire.capital !== null) {
        const builtObject = determineSpacePortAtColonyIncludingUnderConstruction(empire.capital);
        if (builtObject !== null) stellarObjectList.push(builtObject);
    }
    return stellarObjectList;
}

/** Empire.2.cs 1138 MakeDefendOffersToPirates(starDate). No Rnd. */
export function makeDefendOffersToPirates(galaxy: Galaxy, empire: Empire, starDate: number): void {
    let flag = false;
    switch (empire.policy!.offerDefensivePirateMissionsSituation) {
        case 0:
            flag = false;
            break;
        case 1:
            if (checkAtWar(empire)) flag = true;
            break;
        case 2:
            flag = true;
            break;
    }
    if (!flag || empire.policy!.offerDefensivePirateMissions <= 0) return;
    const relationsByType = empire.pirateRelations.getRelationsByType(PirateRelationType.Protection);
    const relationsAbove15 = empire.pirateRelations.getRelationsAboveThresholdAndByType(15, PirateRelationType.Protection);
    const relationsAbove30 = empire.pirateRelations.getRelationsAboveThresholdAndByType(30, PirateRelationType.Protection);
    if (relationsByType.count <= 0) return;
    const stellarObjectList = identifyMostAtRiskColoniesBases(galaxy, empire);
    let num = empire.pirateMissions.calculateTotalDefendCosts(empire);
    if (stellarObjectList.length <= 0) return;
    for (let i = 0; i < stellarObjectList.length; i++) {
        const stellarObject = stellarObjectList[i];
        if (stellarObject == null || stellarObject.hasBeenDestroyed || targetEmpireOf(stellarObject) !== empire) continue;
        const num2 = calculatePirateDefendPrice(galaxy, empire, stellarObject);
        if (!(num + num2 < empire.stateMoney)) continue;
        let systemStar: Habitat | null = null;
        let pirateRelationList = new PirateRelationList();
        if (stellarObject instanceof BuiltObject) {
            systemStar = stellarObject.nearestSystemStar;
            switch (stellarObject.subRole) {
                case BuiltObjectSubRole.GasMiningStation:
                case BuiltObjectSubRole.MiningStation:
                case BuiltObjectSubRole.ResortBase:
                    pirateRelationList = relationsByType;
                    break;
                case BuiltObjectSubRole.SmallSpacePort:
                case BuiltObjectSubRole.MediumSpacePort:
                case BuiltObjectSubRole.LargeSpacePort:
                    pirateRelationList = stellarObject.parentHabitat === null || stellarObject.parentHabitat !== empire.capital ? relationsAbove15 : relationsAbove30;
                    break;
                case BuiltObjectSubRole.EnergyResearchStation:
                case BuiltObjectSubRole.WeaponsResearchStation:
                case BuiltObjectSubRole.HighTechResearchStation:
                    pirateRelationList = relationsAbove15;
                    break;
            }
        } else if (stellarObject instanceof Habitat) {
            systemStar = galaxy.determineHabitatSystemStar(stellarObject);
            pirateRelationList = stellarObject !== empire.capital ? relationsAbove15 : relationsAbove30;
        }
        if (pirateRelationList.count <= 0) continue;
        const expiryDate = starDate + Math.trunc(1.0 * REAL_SECONDS_IN_GALACTIC_YEAR * 1000.0);
        const empireActivity = new EmpireActivity(empire, empire, expiryDate, EmpireActivityType.Defend, stellarObject, num2);
        if (empire.pirateMissions.containsEquivalentTarget(empireActivity.target, empireActivity.type)) continue;
        const num3 = countMissionsInSameSystem(galaxy, empire.pirateMissions, systemStar, EmpireActivityType.Defend, empire);
        if (num3 > 2) continue;
        if (!checkTaskAuthorized(galaxy, empire, empire.controlOfferPirateMissions, empireActivity)) continue;
        empire.pirateMissions.add(empireActivity);
        galaxy.pirateMissions.add(empireActivity);
        num += num2;
        for (let j = 0; j < pirateRelationList.count; j++) {
            const pirateRelation = pirateRelationList.get(j);
            if (pirateRelation != null && pirateRelation.otherEmpire !== null && pirateRelation.otherEmpire.pirateEmpireBaseHabitat !== null && isObjectAreaKnownToThisEmpire(galaxy, pirateRelation.otherEmpire, stellarObject)) {
                const description = gameText('Pirate Defend Mission Available', empire.name, stellarObject.name);
                sendMessageToEmpire(empire, pirateRelation.otherEmpire, EmpireMessageType.PirateDefendMissionAvailable, empireActivity, description);
            }
        }
    }
}

/** Empire.2.cs 1426 MakeSmugglingOffersToPirates(starDate). No Rnd. */
export function makeSmugglingOffersToPirates(galaxy: Galaxy, empire: Empire, starDate: number): void {
    let flag = false;
    if (empire === galaxy.independentEmpire) {
        flag = true;
    } else {
        switch (empire.policy!.offerSmugglingPirateMissions) {
            case 1:
                if (checkAtWar(empire)) flag = true;
                // 19d2 resource crises (scenario flag): a war-only empire also offers while a colony is in crisis. No Rnd.
                else if (galaxy.scenario !== null && crisesOn(galaxy) && empireHasColonyCrisis(galaxy, empire)) flag = true;
                break;
            case 2:
                flag = true;
                break;
        }
    }
    if (!flag) return;
    const num = privateAnnualRevenue(galaxy, empire) - (annualPrivateMaintenanceExcludingUnderConstruction(empire) + annualTaxRevenue(galaxy, empire) + thisYearsPrivateFuelCosts(galaxy, empire));
    const { deficientColony, deficientResourceId, deficientResourceCount } = identifyResourceDeficientColony(galaxy, empire);
    if (deficientColony === null) return;
    // 19d2 AI rule 3 (scenario flag): no smuggling offer for a resource the empire exports to a partner in crisis.
    if (galaxy.scenario !== null && deficientResourceCount === 1 && empire !== galaxy.playerEmpire && crisesBlocksSmuggleOffer(galaxy, empire, deficientResourceId)) return;
    let num2 = 1.0;
    if (deficientResourceCount === 1) num2 = calculatePirateSmugglePricePerUnit(galaxy, empire, deficientColony, deficientResourceId);
    const num3 = num2 * 500.0;
    let num4 = empire.privateMoney;
    if (empire === galaxy.independentEmpire) {
        num4 = Number.MAX_VALUE;
    } else {
        const governmentAttributes = empireGovernmentAttributes(empire);
        if (governmentAttributes !== null && governmentAttributes.specialFunctionCode === 1) num4 = empire.stateMoney;
    }
    if (!(num4 > num3) || !(empire.privateMoney > num * 2.0)) return;
    const expiryDate = starDate + Math.trunc(3.0 * REAL_SECONDS_IN_GALACTIC_YEAR * 1000.0);
    const empireActivity = new EmpireActivity(empire, empire, expiryDate, EmpireActivityType.Smuggle, deficientColony, num2);
    empireActivity.resourceId = deficientResourceCount > 1 ? BYTE_MAX : deficientResourceId;
    if (empire.pirateMissions.containsEquivalentTarget(empireActivity.target, empireActivity.type)) return;
    if (empire !== galaxy.independentEmpire && !checkTaskAuthorized(galaxy, empire, empire.controlOfferPirateMissions, empireActivity)) return;
    if (empireActivity.resourceId !== BYTE_MAX) {
        empireActivity.relatedOrder = createOrderWithExpiry(galaxy, deficientColony, empireActivity.resourceId, 10000, true, OrderType.Standard, expiryDate);
    }
    empire.pirateMissions.add(empireActivity);
    galaxy.pirateMissions.add(empireActivity);
    if (empire === galaxy.independentEmpire) {
        for (let i = 0; i < galaxy.pirateEmpires.length; i++) {
            const pirate = galaxy.pirateEmpires[i];
            if (pirate != null && pirate.pirateEmpireBaseHabitat !== null && isObjectAreaKnownToThisEmpire(galaxy, pirate, deficientColony)) {
                const empty =
                    empireActivity.resourceId !== BYTE_MAX
                        ? gameText('Pirate Smuggle Mission Available Independent', deficientColony.name, resourceName(galaxy, empireActivity.resourceId))
                        : gameText('Pirate Smuggle Mission Available Independent All Resources', deficientColony.name);
                sendMessageToEmpire(empire, pirate, EmpireMessageType.PirateSmugglingMissionAvailable, empireActivity, empty);
            }
        }
        return;
    }
    for (let j = 0; j < empire.pirateRelations.count; j++) {
        const pirateRelation = empire.pirateRelations.get(j);
        if (pirateRelation != null && pirateRelation.otherEmpire !== null && pirateRelation.otherEmpire.pirateEmpireBaseHabitat !== null && pirateRelation.type === PirateRelationType.Protection && isObjectAreaKnownToThisEmpire(galaxy, pirateRelation.otherEmpire, deficientColony)) {
            const description = gameText('Pirate Smuggle Mission Available', empire.name, deficientColony.name);
            sendMessageToEmpire(empire, pirateRelation.otherEmpire, EmpireMessageType.PirateSmugglingMissionAvailable, empireActivity, description);
        }
    }
}

/** Empire.2.cs 2146 IdentifyPirateAttackTargetForRelation(PirateRelation relation, int maximumFirepower). */
function identifyPirateAttackTargetForPirateRelation(galaxy: Galaxy, empire: Empire, relation: PirateRelation | null, maximumFirepower: number): BuiltObject | null {
    if (relation !== null && relation.type !== PirateRelationType.NotMet) {
        if (empire.knownPirateBases != null) {
            for (let i = 0; i < empire.knownPirateBases.length; i++) {
                const builtObject = empire.knownPirateBases[i];
                if (builtObject != null && !builtObject.hasBeenDestroyed && calculateOverallStrengthFactor(builtObject) <= maximumFirepower && builtObject.empire === relation.otherEmpire) return builtObject;
            }
        }
        if (empire.pirateEmpireBaseHabitat !== null) return findNearestKnownBase(galaxy, empire, empire.pirateEmpireBaseHabitat.xpos, empire.pirateEmpireBaseHabitat.ypos, relation.otherEmpire, maximumFirepower);
        if (empire.capital !== null) return findNearestKnownBase(galaxy, empire, empire.capital.xpos, empire.capital.ypos, relation.otherEmpire, maximumFirepower);
    }
    return null;
}

/**
 * Empire.2.cs 2174 IdentifyPirateAttackTargetForRelation(DiplomaticRelation relation, int maximumOverallStrength). Every
 * strategy branch ends in the same FindNearestKnownBase from Capital; the C# would throw on a null Capital — TS
 * returns null then (no Rnd either way).
 */
function identifyPirateAttackTargetForDiplomaticRelation(galaxy: Galaxy, empire: Empire, relation: DiplomaticRelation | null, maximumOverallStrength: number): BuiltObject | null {
    if (relation !== null && relation.otherEmpire !== empire && relation.type !== DiplomaticRelationType.NotMet) {
        if (relation.strategy === DiplomaticStrategy.Conquer && relation.warObjectiveBases != null) {
            for (let i = 0; i < relation.warObjectiveBases.length; i++) {
                const builtObject2 = relation.warObjectiveBases[i];
                if (builtObject2 != null && !builtObject2.hasBeenDestroyed && builtObject2.empire === relation.otherEmpire && calculateOverallStrengthFactor(builtObject2) <= maximumOverallStrength && (builtObject2.parentHabitat === null || builtObject2.parentHabitat.empire !== relation.otherEmpire)) return builtObject2;
            }
        }
        if (empire.capital === null) return null;
        const builtObject = findNearestKnownBase(galaxy, empire, empire.capital.xpos, empire.capital.ypos, relation.otherEmpire, maximumOverallStrength);
        if (builtObject !== null) return builtObject;
    }
    return null;
}

/** Largest fleet's TotalOverallStrengthFactor, 100 without fleets (Empire.2.cs 1723-1731 / 1872-1880). */
function largestFleetStrength(galaxy: Galaxy, empire: Empire): number {
    let num = 100;
    const shipGroups = empireShipGroups(empire);
    if (shipGroups != null) {
        const shipGroup = identifyLargestFleet(shipGroups);
        if (shipGroup !== null) num = shipGroupTotalOverallStrengthFactor(galaxy, shipGroup);
    }
    return num;
}

/** EmpireEvaluationList.cs 42 GetLowestEvaluationKnownEmpire(empire, excludeEmpires). */
export function getLowestEvaluationKnownEmpire(empire: Empire, excludeEmpires: Empire[]): { empire: Empire; overallAttitude: number } | null {
    let best: Empire | null = null;
    let bestAttitude = 0;
    const evaluations = empire.empireEvaluations as (EmpireEvaluation | null)[];
    for (let index = 0; index < evaluations.length; ++index) {
        const ev = evaluations[index];
        if (ev == null || excludeEmpires.includes(ev.empire!)) continue;
        // EmpireEvaluation.cs 91 OverallAttitude — M4r's real getter (diplomacy.ts).
        const attitude = ev.overallAttitude;
        if ((best === null || bestAttitude > attitude) && empire.pirateEmpireBaseHabitat === null && ev.empire!.pirateEmpireBaseHabitat === null && obtainDiplomaticRelation(empire, ev.empire).type !== DiplomaticRelationType.NotMet) {
            best = ev.empire;
            bestAttitude = attitude;
        }
    }
    return best !== null ? { empire: best, overallAttitude: bestAttitude } : null;
}

/** Shared tail of MakeAttackOffersToPirates (1804-1845) / PiratesMakeAttackOffers (1889-1941): post the Attack offers. */
function postAttackOffers(galaxy: Galaxy, empire: Empire, starDate: number, stellarObjectList: BuiltObject[], relationsAboveThreshold: PirateRelationList, useActualEmpire: boolean): void {
    let num2 = empire.pirateMissions.calculateTotalAttackCosts(empire);
    for (let i = 0; i < stellarObjectList.length; i++) {
        const stellarObject3 = stellarObjectList[i];
        if (stellarObject3 == null || stellarObject3.hasBeenDestroyed || stellarObject3.empire === empire) continue;
        let targetEmpire = stellarObject3.empire;
        if (useActualEmpire) {
            // PiratesMakeAttackOffers only (1899-1907): the target empire is the ship's ActualEmpire.
            targetEmpire = stellarObject3.actualEmpire;
            if (targetEmpire === empire) continue;
        }
        const num3 = calculatePirateAttackPrice(galaxy, empire, stellarObject3);
        if (!(num2 + num3 < empire.stateMoney)) continue;
        const expiryDate = starDate + Math.trunc(1.0 * REAL_SECONDS_IN_GALACTIC_YEAR * 1000.0);
        const empireActivity = new EmpireActivity(targetEmpire, empire, expiryDate, EmpireActivityType.Attack, stellarObject3, num3);
        if (empire.pirateMissions.containsEquivalentTarget(empireActivity.target, empireActivity.type)) continue;
        if (!checkTaskAuthorized(galaxy, empire, empire.controlOfferPirateMissions, empireActivity)) continue;
        empire.pirateMissions.add(empireActivity);
        galaxy.pirateMissions.add(empireActivity);
        num2 += num3;
        for (let j = 0; j < relationsAboveThreshold.count; j++) {
            const pirateRelation = relationsAboveThreshold.get(j);
            if (pirateRelation != null && pirateRelation.otherEmpire !== null && pirateRelation.otherEmpire.pirateEmpireBaseHabitat !== null && isObjectAreaKnownToThisEmpire(galaxy, pirateRelation.otherEmpire, stellarObject3)) {
                const description = gameText('Pirate Attack Mission Available', empire.name, stellarObject3.name);
                sendMessageToEmpire(empire, pirateRelation.otherEmpire, EmpireMessageType.PirateAttackMissionAvailable, empireActivity, description);
            }
        }
    }
}

/** Empire.2.cs 1719 MakeAttackOffersToPirates(starDate). No Rnd. */
export function makeAttackOffersToPirates(galaxy: Galaxy, empire: Empire, starDate: number): void {
    const stellarObjectList: BuiltObject[] = [];
    const relationsAboveThreshold = empire.pirateRelations.getRelationsAboveThreshold(-50);
    const num = largestFleetStrength(galaxy, empire);
    const empireList = empire.pirateMissions.resolveAttackTargettedEmpires();
    const mechanoid = identifyMechanoidEmpire(galaxy);
    if (mechanoid !== null && !empireList.includes(mechanoid)) empireList.push(mechanoid);
    const lowest = getLowestEvaluationKnownEmpire(empire, empireList);
    let flag = false;
    if (lowest !== null) {
        switch (empire.policy!.offerPirateAttackMissions) {
            case 0:
                flag = false;
                break;
            case 1:
                if (empire.pirateEmpireBaseHabitat === null && lowest.empire.pirateEmpireBaseHabitat === null) {
                    const diplomaticRelation = obtainDiplomaticRelation(empire, lowest.empire);
                    if (diplomaticRelation.type === DiplomaticRelationType.War) flag = true;
                }
                break;
            case 2:
                if (lowest.overallAttitude <= -5) flag = true;
                break;
            case 3:
                flag = true;
                break;
        }
        if (flag) {
            const relation = obtainDiplomaticRelation(empire, lowest.empire);
            const stellarObject = identifyPirateAttackTargetForDiplomaticRelation(galaxy, empire, relation, num);
            if (stellarObject !== null) stellarObjectList.push(stellarObject);
        }
    }
    const relationWithLowestEvaluation = empire.pirateRelations.getRelationWithLowestEvaluation();
    if (relationWithLowestEvaluation !== null) {
        flag = false;
        switch (empire.policy!.offerPirateAttackMissions) {
            case 0:
            case 1:
                flag = false;
                break;
            case 2:
                if (relationWithLowestEvaluation.evaluation <= -5) flag = true;
                break;
            case 3:
                flag = true;
                break;
        }
        if (flag) {
            const stellarObject2 = identifyPirateAttackTargetForPirateRelation(galaxy, empire, relationWithLowestEvaluation, num);
            if (stellarObject2 !== null) stellarObjectList.push(stellarObject2);
        }
    }
    postAttackOffers(galaxy, empire, starDate, stellarObjectList, relationsAboveThreshold, false);
}

/** Empire.2.cs 1847 PiratesMakeAttackOffers(starDate) (pirate long block). No Rnd. */
export function piratesMakeAttackOffers(galaxy: Galaxy, empire: Empire, starDate: number): void {
    const stellarObjectList: BuiltObject[] = [];
    const relationsAboveThreshold = empire.pirateRelations.getRelationsAboveThreshold(-50);
    const relationWithLowestEvaluation = empire.pirateRelations.getRelationWithLowestEvaluation();
    let flag = false;
    if (relationWithLowestEvaluation !== null) {
        switch (empire.policy!.offerPirateAttackMissions) {
            case 0:
                flag = false;
                break;
            case 1:
                if (relationWithLowestEvaluation.type === PirateRelationType.None && relationWithLowestEvaluation.evaluation < 0) flag = true;
                break;
            case 2:
                if (relationWithLowestEvaluation.evaluation <= -5) flag = true;
                break;
            case 3:
                flag = true;
                break;
        }
        if (flag) {
            const maximumFirepower = largestFleetStrength(galaxy, empire);
            const stellarObject = identifyPirateAttackTargetForPirateRelation(galaxy, empire, relationWithLowestEvaluation, maximumFirepower);
            if (stellarObject !== null) stellarObjectList.push(stellarObject);
        }
    }
    postAttackOffers(galaxy, empire, starDate, stellarObjectList, relationsAboveThreshold, true);
}

// ---------------------------------------------------------------------------------------------------------------------
// Pirate faction: bidding (pirate regular block)
// ---------------------------------------------------------------------------------------------------------------------

/** Empire.2.cs 2045 PirateCheckAcceptDefendMission(defendMission, pirateEmpireStrength). No Rnd. */
export function pirateCheckAcceptDefendMission(galaxy: Galaxy, empire: Empire, defendMission: EmpireActivity | null, pirateEmpireStrength: number): boolean {
    const baseHabitat = empire.pirateEmpireBaseHabitat;
    if (baseHabitat === null || defendMission === null || defendMission.requestingEmpire === null || defendMission.target === null || !(empireShipGroups(empire).length > 0) || !determineOfferPirateDefendMissionToPirateFaction(galaxy, defendMission.requestingEmpire, empire)) return false;
    let num = Math.max(galaxy.sectorSize * 2.0, galaxy.sizeX * 0.2);
    if (empire.piratePlayStyle === PiratePlayStyle.Mercenary) num *= 1.5;
    if (targetEmpireOf(defendMission.target) === empire) return false;
    let pirateRelation: PirateRelation | null = null;
    if (defendMission.requestingEmpire !== galaxy.independentEmpire && defendMission.requestingEmpire !== null) pirateRelation = obtainPirateRelation(empire, defendMission.requestingEmpire);
    if (!(defendMission.requestingEmpire === galaxy.independentEmpire || (pirateRelation !== null && pirateRelation.type !== PirateRelationType.NotMet && pirateRelation.evaluation >= -30))) return false;
    let pirateRelation2: PirateRelation | null = null;
    if (defendMission.targetEmpire !== galaxy.independentEmpire && defendMission.targetEmpire !== null) pirateRelation2 = obtainPirateRelation(empire, defendMission.targetEmpire);
    if (!(defendMission.targetEmpire === galaxy.independentEmpire || (pirateRelation2 !== null && pirateRelation2.type === PirateRelationType.Protection))) return false;
    const coords = defendMission.resolveTargetCoordinates();
    if (!coords.ok) return false;
    const num2 = galaxy.calculateDistance(baseHabitat.xpos, baseHabitat.ypos, coords.x, coords.y);
    if (!(num2 < num)) return false;
    let num3 = 0;
    if (defendMission.target instanceof BuiltObject) num3 = Math.trunc(defendMission.target.size / 20);
    else if (defendMission.target instanceof Habitat) num3 = estimatedDefensiveForceRequired(galaxy, defendMission.target, false, galaxy.difficultyLevel);
    return pirateEmpireStrength > num3;
}

/** Empire.2.cs 2100 PirateCheckAcceptAttackMission(attackMission, pirateEmpireStrength). No Rnd. */
export function pirateCheckAcceptAttackMission(galaxy: Galaxy, empire: Empire, attackMission: EmpireActivity | null, pirateEmpireStrength: number): boolean {
    const baseHabitat = empire.pirateEmpireBaseHabitat;
    if (baseHabitat === null || attackMission === null || attackMission.target === null || !(empireShipGroups(empire).length > 0)) return false;
    let num = Math.max(galaxy.sectorSize * 3.0, galaxy.sizeX * 0.3);
    if (empire.piratePlayStyle === PiratePlayStyle.Mercenary) num *= 1.5;
    let targetEmpire = targetEmpireOf(attackMission.target);
    if (attackMission.target instanceof BuiltObject) targetEmpire = attackMission.target.actualEmpire;
    if (targetEmpire === empire || attackMission.requestingEmpire === null) return false;
    const pirateRelation = obtainPirateRelation(empire, attackMission.requestingEmpire);
    if (!(pirateRelation.type !== PirateRelationType.NotMet && pirateRelation.evaluation >= -50 && targetEmpire !== null)) return false;
    const pirateRelation2 = obtainPirateRelation(empire, targetEmpire);
    if (pirateRelation2.type === PirateRelationType.Protection) return false;
    const coords = attackMission.resolveTargetCoordinates();
    if (!coords.ok) return false;
    const num2 = galaxy.calculateDistance(baseHabitat.xpos, baseHabitat.ypos, coords.x, coords.y);
    if (!(num2 < num)) return false;
    let num3 = 0;
    if (attackMission.target instanceof BuiltObject) num3 = (attackMission.target.firepowerRaw + attackMission.target.currentEscortForceAssigned) | 0;
    return pirateEmpireStrength > num3;
}

/** The Attack / Defend bid (Empire.2.cs 1972-1989 / 2000-2017); true when the bid was placed. */
function placeBid(galaxy: Galaxy, empire: Empire, empireActivity: EmpireActivity): boolean {
    const num8 = empireActivity.price * 0.9;
    const num9 = calculatePirateMissionPriceWillingToBidFor(galaxy, empire, empireActivity);
    if (!(num9 <= num8)) return false;
    empireActivity.assignedEmpire = empire;
    if (empireActivity.bidTimeRemaining < 0) {
        empireActivity.bidTimeRemaining = 60000;
    } else {
        empireActivity.price = num8;
        if (empireActivity.bidTimeRemaining < 10000) empireActivity.bidTimeRemaining += 10000;
    }
    return true;
}

/** Empire.2.cs 1943 PirateCheckMissionsOnOffer(starDate) (pirate regular block). No Galaxy.Rnd (bid prices use a target-seeded Random). */
export function pirateCheckMissionsOnOffer(galaxy: Galaxy, empire: Empire, starDate: number): void {
    void starDate;
    const policy = empire.policy!;
    if (!policy.bidOnPirateAttackMissions && !policy.bidOnPirateDefendMissions && !policy.acceptPirateSmugglingMissions) return;
    const pirateEmpireStrength = totalMobileMilitaryFirepowerNotAttackingDefending(empire.builtObjects).firepower;
    let num = empire.pirateMissions.countByType(EmpireActivityType.Attack);
    let num2 = empire.pirateMissions.countByType(EmpireActivityType.Defend);
    let num3 = 0;
    const shipGroups = empireShipGroups(empire);
    if (shipGroups != null) num3 = shipGroups.length;
    for (let i = 0; i < galaxy.pirateMissions.count; i++) {
        const empireActivity = galaxy.pirateMissions.at(i);
        if (empireActivity === null || empireActivity.requestingEmpire === empire || empire.pirateMissions.containsEquivalentTarget(empireActivity.target, empireActivity.type)) continue;
        switch (empireActivity.type) {
            case EmpireActivityType.Attack:
                if (!policy.bidOnPirateAttackMissions || num + num2 >= num3 || empireActivity.assignedEmpire === empire || !pirateCheckAcceptAttackMission(galaxy, empire, empireActivity, pirateEmpireStrength)) break;
                if (placeBid(galaxy, empire, empireActivity)) num++;
                break;
            case EmpireActivityType.Defend:
                if (!policy.bidOnPirateDefendMissions || num + num2 >= num3 || empireActivity.assignedEmpire === empire || !pirateCheckAcceptDefendMission(galaxy, empire, empireActivity, pirateEmpireStrength)) break;
                if (placeBid(galaxy, empire, empireActivity)) num2++;
                break;
            case EmpireActivityType.Smuggle: {
                if (!policy.acceptPirateSmugglingMissions || !isObjectAreaKnownToThisEmpire(galaxy, empire, empireActivity.target!)) break;
                const num4 = countIdleFreighters(empire);
                let num5 = 1;
                if (empireActivity.resourceId !== BYTE_MAX) num5 = countResourceSupplyLocations(galaxy, empire, empireActivity.resourceId, true);
                if (num4 > 0 && num5 > 0) {
                    if (checkTaskAuthorized(galaxy, empire, empire.controlOfferPirateMissions, empireActivity)) empire.pirateMissions.add(empireActivity);
                }
                break;
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Empire: pirate relations upkeep (Empire long block)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Empire.2.cs 2401 ReviewPirateRelations(starDate, timePassed). Rnd: one NextDouble (2427).
 * C# oddities kept: num5 is RealSecondsInGalacticYear * 0.25 in *seconds* while num2 is in ms, and timePassed (the
 * long-block span in seconds) is divided by the year length in ms.
 */
export function reviewPirateRelations(galaxy: Galaxy, empire: Empire, starDate: number, timePassed: number): void {
    if (empire.pirateRelations == null) return;
    let flag = false;
    const design = latestDesignsFindNewestCanBuild(empire, BuiltObjectSubRole.Escort);
    if (design !== null && design.firepowerRaw > 0 && design.shieldsCapacity > 0) flag = true;
    let num = 0.5;
    if (!flag) num = 0.85;
    let num2 = Math.trunc(REAL_SECONDS_IN_GALACTIC_YEAR * 1.0 * 1000.0);
    let num3 = galaxy.pirateEmpires.length;
    if (empire.pirateRelations != null) num3 = empire.pirateRelations.countKnownPirateFactions();
    const num4 = Math.min(7.0, Math.max(1.0, num3 / 3.0));
    num2 = Math.trunc(num2 * num4);
    const num5 = Math.trunc(REAL_SECONDS_IN_GALACTIC_YEAR * 0.25);
    const num6 = Math.trunc((num5 * 0.5 + num5 * 0.5 * galaxy.rnd.nextDouble()) * num4);
    num2 += num6;
    const num7 = starDate - num2;
    const charactersByRole = getCharactersByRole((empire.characters ?? []) as Character[], CharacterRole.Leader);
    let num8 = -100;
    for (let i = 0; i < charactersByRole.length; i++) {
        const character = charactersByRole[i];
        if (character != null && character.role === CharacterRole.Leader) num8 = Math.max(num8, character.diplomacy);
    }
    if (num8 <= -100) num8 = 0;
    const diplomacyFactor = f(1 + f(f(num8) / 100));
    const pirateRelationList: PirateRelation[] = [];
    for (let j = 0; j < empire.pirateRelations.count; j++) {
        const pirateRelation = empire.pirateRelations.get(j);
        if (pirateRelation == null || pirateRelation.type === PirateRelationType.NotMet) continue;
        if (pirateRelation.otherEmpire === null || !pirateRelation.otherEmpire.active || pirateRelation.thisEmpire === null || !pirateRelation.thisEmpire.active) {
            pirateRelationList.push(pirateRelation);
            continue;
        }
        pirateRelation.diplomacyFactor = diplomacyFactor;
        const neutralizationAmount = f(5.0 * (timePassed / (REAL_SECONDS_IN_GALACTIC_YEAR * 1000.0)));
        pirateRelation.neutralizeEvaluation(neutralizationAmount);
        if (empire.controlDiplomacyTreaties === AutomationLevel.Undefined) continue; // AutomationLevel.Manual
        if (pirateRelation.type !== PirateRelationType.Protection || empire.pirateEmpireBaseHabitat !== null) continue;
        let num9 = 0.0;
        const pirateRelation2 = obtainPirateRelation(pirateRelation.otherEmpire, empire);
        if (pirateRelation2 != null) num9 = pirateRelation2.monthlyProtectionFeeToThisEmpire * 12.0;
        const num10 = calculateAnnualCashflow(galaxy, empire);
        const num11 = num10 * num;
        let cancel = false;
        if (num9 > num11) {
            cancel = pirateRelation.lastChangeDate < num7;
        } else if (!determineDesirePirateProtection(galaxy, empire, pirateRelation.otherEmpire) && pirateRelation.lastChangeDate < num7) {
            cancel = true;
        }
        // GenerateAutomationMessageCancelPirateProtection(otherEmpire, monthlyFee): advisor text (UI).
        if (cancel && checkTaskAuthorized(galaxy, empire, empire.controlDiplomacyTreaties, pirateRelation.otherEmpire)) {
            changePirateRelation(empire, pirateRelation.otherEmpire, PirateRelationType.None, starDate);
            sendMessageToEmpire(empire, pirateRelation.otherEmpire, EmpireMessageType.CancelPirateProtection, empire, gameText('Cancel Pirate Protection'));
        }
    }
    for (let k = 0; k < pirateRelationList.length; k++) empire.pirateRelations.remove(pirateRelationList[k]);
}
