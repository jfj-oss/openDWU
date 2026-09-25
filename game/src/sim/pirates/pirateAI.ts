// M4s (s2) — pirate faction AI (missions, fleets, economy, construction, raids, control).
//
// Stubs created by M4a (tasks/M4-plan.md §3.1): the tick skeletons in src/sim/tick/ call these entry points in C#
// order. Each is a no-op that does NOT draw Galaxy.Rnd (a `RND:` note marks C# draw sites that are skipped until the
// owning package ports the body) and records a TODO hit (tick/todo.ts). The owning package replaces the bodies in
// place, keeping the signatures (or adjusting the skeleton call in the same change).

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { BuiltObject } from '../builtObject';
import type { Habitat } from '../types';
import { registerTodo, todo } from '../tick/todo';
import { BuiltObjectRole } from '../data/designSpecifications';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { HabitatType } from '../types';
import { getBuiltObjectsAtLocation } from '../stationPlacement';
import { MAX_SOLAR_SYSTEM_SIZE } from '../movement';
import { REAL_SECONDS_IN_GALACTIC_YEAR } from '../tick/simTime';
import { EmpireMessageType, resolveDescription, sendMessageToEmpire } from '../messages';
import { gameText } from '../colonyTick';
import { PlanetaryFacilityType } from '../researchSystem';
import { facilitiesCountByType, facilitiesFindBestPirateFacility } from '../construction/facilities';
import { getEmpireById } from '../logistics/contracts';
import { obtainPirateRelation, PirateRelationType } from '../pirateRelations';
import { PirateColonyControl, PirateColonyControlList } from './pirateColonyControl';

const f = Math.fround;
import { annualFacilityMaintenance, annualStateMaintenance, annualTroopMaintenance } from '../forceStructure';
import { annualStateMaintenanceExcludingUnderConstruction, calculatePirateIncome } from '../treasury';
import type { PirateExpenseType, PirateIncomeType } from './pirateEconomy';

const T_checkSendPirateRaid = registerTodo('M4s', 'checkSendPirateRaid');
/** Empire.1.cs 4065 CheckSendPirateRaid. */
export function checkSendPirateRaid(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4s */ todo(T_checkSendPirateRaid);
}

const T_pirateRecalculateEmpireCorruption = registerTodo('M4s', 'pirateRecalculateEmpireCorruption');
/** Empire.4.cs 3406 / BaconEmpire.cs 1253 PirateRecalculateEmpireCorruption. */
export function pirateRecalculateEmpireCorruption(galaxy: Galaxy, empire: Empire): void {
    // RND: 1 direct — not drawn until M4s.
    /* TODO(port) M4s */ todo(T_pirateRecalculateEmpireCorruption);
}

const T_pirateAssignShipMissions = registerTodo('M4s', 'pirateAssignShipMissions');
/** Empire.1.cs 4385 PirateAssignShipMissions(starDate). */
export function pirateAssignShipMissions(galaxy: Galaxy, empire: Empire, starDate: number): void {
    // RND: draws in callees (d≤3) — not drawn until M4s.
    /* TODO(port) M4s */ todo(T_pirateAssignShipMissions);
}

const T_pirateTaskFleets = registerTodo('M4s', 'pirateTaskFleets');
/** Empire.9.cs 904 PirateTaskFleets. */
export function pirateTaskFleets(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4s */ todo(T_pirateTaskFleets);
}

const T_pirateCollectIncomeFromControlledColonies = registerTodo('M4s', 'pirateCollectIncomeFromControlledColonies');
/** Empire.2.cs 2895 PirateCollectIncomeFromControlledColonies(timePassed). */
export function pirateCollectIncomeFromControlledColonies(galaxy: Galaxy, empire: Empire, timePassed: number): void {
    /* TODO(port) M4s */ todo(T_pirateCollectIncomeFromControlledColonies);
}

const T_pirateReviewSystemThreats = registerTodo('M4s', 'pirateReviewSystemThreats');
/** Empire.9.cs 4139 PirateReviewSystemThreats. */
export function pirateReviewSystemThreats(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4s */ todo(T_pirateReviewSystemThreats);
}

const T_pirateGenerateSellInfoOffers = registerTodo('M4s', 'pirateGenerateSellInfoOffers');
/** Empire.1.cs 4359 PirateGenerateSellInfoOffers. */
export function pirateGenerateSellInfoOffers(galaxy: Galaxy, empire: Empire): void {
    // RND: 1 direct — not drawn until M4s.
    /* TODO(port) M4s */ todo(T_pirateGenerateSellInfoOffers);
}

const T_reviewPirateSystemInfluence = registerTodo('M4s', 'reviewPirateSystemInfluence');
/** Empire.7.cs 2180 ReviewPirateSystemInfluence. */
export function reviewPirateSystemInfluence(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4s */ todo(T_reviewPirateSystemInfluence);
}

const T_doTaskPiratesLongInterval = registerTodo('M4s', 'doTaskPiratesLongInterval');
/** BaconEmpire.cs 1099 DoTaskPiratesLongInterval(empire). */
export function doTaskPiratesLongInterval(galaxy: Galaxy, empire: Empire): void {
    // RND: +clock×2 — not drawn until M4s.
    /* TODO(port) M4s */ todo(T_doTaskPiratesLongInterval);
}

const T_maintainPirateSpaceportResourceLevels = registerTodo('M4s', 'maintainPirateSpaceportResourceLevels');
/** Empire.4.cs 2399 MaintainPirateSpaceportResourceLevels. */
export function maintainPirateSpaceportResourceLevels(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4s */ todo(T_maintainPirateSpaceportResourceLevels);
}

const T_pirateReviewEmpireRelations = registerTodo('M4s', 'pirateReviewEmpireRelations');
/** Empire.2.cs 2510 PirateReviewEmpireRelations(starDate, timePassed). */
export function pirateReviewEmpireRelations(galaxy: Galaxy, empire: Empire, starDate: number, timePassed: number): void {
    /* TODO(port) M4s */ todo(T_pirateReviewEmpireRelations);
}

const T_pirateProjectForces = registerTodo('M4s', 'pirateProjectForces');
/** Empire.2.cs 766 PirateProjectForces(starDate). */
export function pirateProjectForces(galaxy: Galaxy, empire: Empire, starDate: number): void {
    /* TODO(port) M4s */ todo(T_pirateProjectForces);
}

const T_pirateDoConstruction = registerTodo('M4s', 'pirateDoConstruction');
/** Empire.2.cs 219 PirateDoConstruction. */
export function pirateDoConstruction(galaxy: Galaxy, empire: Empire): void {
    // RND: draws in callees (d≤3) — not drawn until M4s.
    /* TODO(port) M4s */ todo(T_pirateDoConstruction);
}

const T_pirateResetCivilianShipEmpireToIndependent = registerTodo('M4s', 'pirateResetCivilianShipEmpireToIndependent');
/** Empire.1.cs 4333 PirateResetCivilianShipEmpireToIndependent. */
export function pirateResetCivilianShipEmpireToIndependent(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4s */ todo(T_pirateResetCivilianShipEmpireToIndependent);
}

const T_pirateTradeItems = registerTodo('M4s', 'pirateTradeItems');
/** Empire.7.cs 2666 PirateTradeItems. */
export function pirateTradeItems(galaxy: Galaxy, empire: Empire): void {
    // RND: 2 direct — not drawn until M4s.
    /* TODO(port) M4s */ todo(T_pirateTradeItems);
}

const T_checkColoniesForPirateFacilitiesAndAttack = registerTodo('M4s', 'checkColoniesForPirateFacilitiesAndAttack');
/** Empire.1.cs 4328 / BaconEmpire.cs 1499 CheckColoniesForPirateFacilitiesAndAttack. */
export function checkColoniesForPirateFacilitiesAndAttack(galaxy: Galaxy, empire: Empire): void {
    // RND: draws in callees (d≤3) — not drawn until M4s.
    /* TODO(port) M4s */ todo(T_checkColoniesForPirateFacilitiesAndAttack);
}

/** BaconHabitat.cs 37 pirateMaxPopulationInfluence (long; BaconMain.cs 1016 settings override not ported). */
export const PIRATE_MAX_POPULATION_INFLUENCE = 1500000000;

/** Galaxy.5.cs 3067 GetNearbyBuiltObjects(x, y, range). No Rnd. */
export function getNearbyBuiltObjects(galaxy: Galaxy, x: number, y: number, range: number): BuiltObject[] {
    const builtObjectList: BuiltObject[] = [];
    const builtObjectsAtLocation = getBuiltObjectsAtLocation(galaxy, x, y, Math.trunc(range));
    const num = range * range;
    for (let i = 0; i < builtObjectsAtLocation.length; i++) {
        const builtObject = builtObjectsAtLocation[i];
        if (builtObject != null) {
            const num2 = galaxy.calculateDistanceSquared(x, y, builtObject.xpos, builtObject.ypos);
            if (num2 < num) builtObjectList.push(builtObject);
        }
    }
    return builtObjectList;
}

/** The facility-control floor of ReviewPirateControl (BaconHabitat.cs 1456-1470 / 1504-1517); clears HasFacilityControl with no pirate facility. */
function facilityControlFloor(planet: Habitat, control: PirateColonyControl): number {
    let floor = f(0);
    if (control.hasFacilityControl && planet.facilities !== null) {
        const num2 = facilitiesCountByType(planet.facilities, PlanetaryFacilityType.PirateBase);
        const num3 = facilitiesCountByType(planet.facilities, PlanetaryFacilityType.PirateFortress);
        const num4 = facilitiesCountByType(planet.facilities, PlanetaryFacilityType.PirateCriminalNetwork);
        if (num4 > 0) floor = f(1);
        else if (num3 > 0) floor = f(1);
        else if (num2 > 0) floor = f(0.5);
        if (num2 <= 0 && num3 <= 0 && num4 <= 0) control.hasFacilityControl = false;
    }
    return floor;
}

/** BaconHabitat.cs 1388 ReviewPirateControl(planet, timePassed) (Habitat.cs 1672 → Bacon). No Rnd. */
export function reviewPirateControl(galaxy: Galaxy, planet: Habitat, timePassed: number): void {
    // BaconBuiltObject.myMain?._Game is always set in the TS sim.
    if (planet.population == null || planet.population.totalAmount <= 0) return;
    let val1_1 = f(1);
    if (planet.population.totalAmount > PIRATE_MAX_POPULATION_INFLUENCE) {
        val1_1 = Math.min(f(1), Math.max(f(0), f(f(1) - f(f(planet.population.totalAmount - PIRATE_MAX_POPULATION_INFLUENCE) / f(2e9)))));
    }
    const colonyControlList1 = new PirateColonyControlList();
    const nearbyBuiltObjects = getNearbyBuiltObjects(galaxy, planet.xpos, planet.ypos, 1500.0);
    for (let index1 = 0; index1 < nearbyBuiltObjects.length; ++index1) {
        const builtObject = nearbyBuiltObjects[index1];
        if (builtObject != null && builtObject.role !== BuiltObjectRole.Base && builtObject.empire !== null && builtObject.empire.pirateEmpireBaseHabitat !== null) {
            const index2 = colonyControlList1.indexOfEmpireId(builtObject.empire.empireId);
            if (index2 >= 0) {
                const num = Math.max(f(1), f(builtObject.firepowerRaw));
                colonyControlList1.at(index2).controlLevel = colonyControlList1.at(index2).controlLevel + num;
            } else {
                colonyControlList1.add(new PirateColonyControl(builtObject.empire.empireId, f(builtObject.firepowerRaw)));
            }
        }
    }
    const byFacilityControl = planet.pirateColonyControl.getByFacilityControl();
    if (byFacilityControl !== null) {
        const completedPirateFacility = planet.facilities === null ? null : facilitiesFindBestPirateFacility(planet.facilities, true, true);
        if (completedPirateFacility !== null) {
            let num = f(0.5);
            let controlLevel = f(0);
            switch (completedPirateFacility.type) {
                case PlanetaryFacilityType.PirateBase:
                    num = f(0.5);
                    controlLevel = f(35);
                    break;
                case PlanetaryFacilityType.PirateFortress:
                    num = f(1);
                    controlLevel = f(70);
                    break;
                case PlanetaryFacilityType.PirateCriminalNetwork:
                    num = f(1);
                    controlLevel = f(100);
                    break;
            }
            if (byFacilityControl.controlLevel < num) {
                const index = colonyControlList1.indexOfEmpireId(byFacilityControl.empireId);
                if (index >= 0) colonyControlList1.at(index).controlLevel = colonyControlList1.at(index).controlLevel + controlLevel;
                else colonyControlList1.add(new PirateColonyControl(byFacilityControl.empireId, controlLevel));
            }
        }
    }
    colonyControlList1.sort();
    colonyControlList1.reverse();
    const colonyControlList2: PirateColonyControl[] = [];
    const pirateControl = planet.pirateColonyControl;
    for (let index = 0; index < pirateControl.count; ++index) {
        const pirateColonyControl = pirateControl.at(index);
        if (pirateColonyControl != null) {
            const num1 = colonyControlList1.indexOfEmpireId(pirateColonyControl.empireId);
            if (num1 < 0 || num1 >= 3) {
                const val1_2 = facilityControlFloor(planet, pirateColonyControl);
                const num5 = f(-0.5 * (timePassed / REAL_SECONDS_IN_GALACTIC_YEAR));
                const num6 = Math.max(val1_2, f(pirateColonyControl.controlLevel + num5));
                pirateColonyControl.controlLevel = num6;
                if (num6 <= 0.0) colonyControlList2.push(pirateColonyControl);
            }
        }
    }
    for (let index = 0; index < colonyControlList2.length; ++index) {
        const byEmpireId = galaxy.pirateEmpires.find((e) => e != null && e.empireId === colonyControlList2[index].empireId) ?? null;
        if (byEmpireId !== null) {
            const habitatSystemStar = galaxy.determineHabitatSystemStar(planet);
            const description = gameText('We have lost control of the colony X', resolveDescription(HabitatType as unknown as Record<number, string>, planet.type).toLowerCase(), planet.name, habitatSystemStar.name);
            sendMessageToEmpire(byEmpireId, byEmpireId, EmpireMessageType.ColonyLost, planet, description);
        }
        pirateControl.remove(colonyControlList2[index]);
        byEmpireId?.resolveSystemVisibility(planet.xpos, planet.ypos);
    }
    const num7 = Math.min(3, colonyControlList1.count);
    for (let index3 = 0; index3 < num7; ++index3) {
        const pirateColonyControl1 = colonyControlList1.at(index3);
        if (pirateColonyControl1 != null) {
            const index4 = pirateControl.indexOfEmpireId(pirateColonyControl1.empireId);
            if (index4 >= 0) {
                const pirateColonyControl2 = pirateControl.at(index4);
                if (pirateColonyControl2 != null && pirateColonyControl2.controlLevel < val1_1) {
                    const val1_3 = facilityControlFloor(planet, pirateColonyControl2);
                    const num11 = f(Math.max(f(0.5), Math.min(f(3), f(pirateColonyControl1.controlLevel / f(20)))) * f(0.5 * (timePassed / REAL_SECONDS_IN_GALACTIC_YEAR)));
                    const num12 = Math.max(val1_3, Math.min(val1_1, f(pirateControl.at(index4).controlLevel + num11)));
                    pirateControl.at(index4).controlLevel = num12;
                }
            } else if (pirateControl.count < 3 && val1_1 >= 0.0099999997764825821) {
                pirateControl.add(new PirateColonyControl(pirateColonyControl1.empireId, f(0.01)));
                const byEmpireId = galaxy.pirateEmpires.find((e) => e != null && e.empireId === pirateColonyControl1.empireId) ?? null;
                if (byEmpireId !== null) {
                    const habitatSystemStar = galaxy.determineHabitatSystemStar(planet);
                    const description = gameText('We have gained control of the colony X', resolveDescription(HabitatType as unknown as Record<number, string>, planet.type).toLowerCase(), planet.name, habitatSystemStar.name);
                    sendMessageToEmpire(byEmpireId, byEmpireId, EmpireMessageType.ColonyGained, planet, description);
                }
            }
        }
    }
    pirateControl.sort();
    pirateControl.reverse();
}

/** BuiltObject.1.cs 1889 PirateBaseDiscovery. No Rnd. */
export function pirateBaseDiscovery(galaxy: Galaxy, builtObject: BuiltObject): void {
    const empire = builtObject.empire;
    if (empire === null || empire.pirateEmpireBaseHabitat === null || (builtObject.subRole !== BuiltObjectSubRole.SmallSpacePort && builtObject.subRole !== BuiltObjectSubRole.MediumSpacePort && builtObject.subRole !== BuiltObjectSubRole.LargeSpacePort)) {
        return;
    }
    const range = MAX_SOLAR_SYSTEM_SIZE * 2 + 500;
    const builtObjectsAtLocation = getBuiltObjectsAtLocation(galaxy, builtObject.xpos, builtObject.ypos, range);
    for (let i = 0; i < builtObjectsAtLocation.length; i++) {
        const builtObject2 = builtObjectsAtLocation[i];
        if (builtObject2 != null && builtObject2.nearestSystemStar === builtObject.nearestSystemStar && builtObject2 !== builtObject && builtObject2.empire !== null && builtObject2.empire !== galaxy.independentEmpire && !builtObject2.empire.knownPirateBases.includes(builtObject)) {
            builtObject2.empire.knownPirateBases.push(builtObject);
        }
    }
}

/** BuiltObject.1.cs 2894 UpdateRaidCountdown(timePassed). No Rnd. */
export function updateRaidCountdownBuiltObject(galaxy: Galaxy, builtObject: BuiltObject, timePassed: number): void {
    void galaxy;
    if (builtObject.raidCountdown > 0) {
        const num = Math.trunc(timePassed / 10.0);
        let val = builtObject.raidCountdown - num;
        val = Math.min(255, Math.max(0, val));
        builtObject.raidCountdown = val;
    }
}

/** Habitat.cs 1608 UpdateRaidCountdown(timePassed). No Rnd. */
export function updateRaidCountdownHabitat(galaxy: Galaxy, habitat: Habitat, timePassed: number): void {
    void galaxy;
    if (habitat.raidCountdown > 0) {
        const num = Math.trunc(timePassed / 10.0);
        let val = habitat.raidCountdown - num;
        val = Math.min(255, Math.max(0, val));
        habitat.raidCountdown = val;
    }
}

// Added by M4d (Empire.4.cs 1164/1170 InitiateContract, logistics/contracts.ts); ported by M4s (s1).
/** PirateEconomy.cs 37 PerformIncome(amount, type, starDate) (bookkeeping only; no Rnd). `type` is PirateIncomeType. */
export function pirateEconomyPerformIncome(galaxy: Galaxy, empire: Empire, amount: number, type: number, starDate: number): void {
    void galaxy;
    empire.pirateEconomy.performIncome(amount, type as PirateIncomeType, starDate);
}

/** PirateEconomy.cs 28 PerformExpense(amount, type, starDate) (bookkeeping only; no Rnd). `type` is PirateExpenseType. */
export function pirateEconomyPerformExpense(galaxy: Galaxy, empire: Empire, amount: number, type: number, starDate: number): void {
    void galaxy;
    empire.pirateEconomy.performExpense(amount, type as PirateExpenseType, starDate);
}

// ---- stub added by M4s s1 (Empire.2.cs 2490 ReviewPirateRelations) ----
const T_determineDesirePirateProtection = registerTodo('M4s', 'determineDesirePirateProtection');
/**
 * Empire.2.cs 2754 DetermineDesirePirateProtection(otherEmpire). TODO(port) M4s2: needs
 * CalculatePirateProtectionPricePerMonth (Empire.2.cs 2653: TotalColonyStrategicValue, BuiltObjectList
 * CalculateAttackingFirepowerNearEmpireTargets, CalculateAccurateAnnualCashflowIncludingUnderConstruction),
 * CalculateDistanceToNearestColony, CheckSufficientCashflow. No Rnd. Stub: true (the protection agreement is kept).
 */
export function determineDesirePirateProtection(galaxy: Galaxy, empire: Empire, otherEmpire: Empire | null): boolean {
    /* TODO(port) M4s2 */ todo(T_determineDesirePirateProtection);
    return true;
}

// ---- stubs added by M4i (construction/facilities.ts: ConstructFacilities, PirateReviewColonyFacilities) ----

/** PirateColonyControl (pirates/pirateColonyControl.ts); the facility code (construction/facilities.ts) reads/writes these fields. */
export type PirateColonyControlView = PirateColonyControl;

/** Habitat.GetPirateControl().GetByFacilityControl() (PirateColonyControlList.cs 53). */
export function habitatPirateControlByFacilityControl(galaxy: Galaxy, habitat: Habitat): PirateColonyControl | null {
    void galaxy;
    return habitat.pirateColonyControl.getByFacilityControl();
}

/** Habitat.GetPirateControl().GetHighestControl() (PirateColonyControlList.cs 29). */
export function habitatPirateControlHighest(galaxy: Galaxy, habitat: Habitat): PirateColonyControl | null {
    void galaxy;
    return habitat.pirateColonyControl.getHighestControl();
}

/** PirateColonyControlList.cs 63 CheckEmpireHasRelationTypeWithAny(galaxy, empire, relationType). No Rnd. */
export function pirateControlCheckEmpireHasRelationTypeWithAny(galaxy: Galaxy, list: PirateColonyControlList, empire: Empire | null, relationType: PirateRelationType): boolean {
    if (galaxy != null && empire !== null) {
        for (let index = 0; index < list.count; ++index) {
            const pirateColonyControl = list.at(index);
            if (pirateColonyControl != null && pirateColonyControl.empireId !== empire.empireId) {
                const empireById = getEmpireById(galaxy, pirateColonyControl.empireId);
                if (empireById !== null) {
                    const pirateRelation = obtainPirateRelation(empire, empireById);
                    if (pirateRelation != null && pirateRelation.type === relationType) return true;
                }
            }
        }
    }
    return false;
}

/** Habitat.cs 1664 SetPirateControl(pirateFaction, controlLevel). No Rnd. */
export function habitatSetPirateControl(habitat: Habitat, pirateFaction: Empire | null, controlLevel: number): void {
    const list = habitat.pirateColonyControl;
    if (pirateFaction !== null && pirateFaction.pirateEmpireBaseHabitat !== null && list.count < 3 && !list.checkFactionHasControl(pirateFaction.empireId)) {
        list.add(new PirateColonyControl(pirateFaction.empireId, controlLevel));
    }
}

/** Empire.3.cs 4142 CalculatePirateCashflow(includeShipsUnderConstruction) = CalculatePirateIncome − CalculatePirateExpenses. */
export function calculatePirateCashflow(galaxy: Galaxy, empire: Empire, includeShipsUnderConstruction: boolean): number {
    const num = calculatePirateIncome(galaxy, empire);
    const num2 = calculatePirateExpenses(empire, includeShipsUnderConstruction);
    return num - num2;
}

/** Empire.3.cs 4154 CalculatePirateExpenses(includeShipsUnderConstruction). No Rnd. */
export function calculatePirateExpenses(empire: Empire, includeShipsUnderConstruction: boolean): number {
    const num = !includeShipsUnderConstruction
        ? annualStateMaintenanceExcludingUnderConstruction(empire) + annualFacilityMaintenance(empire)
        : annualStateMaintenance(empire) + annualFacilityMaintenance(empire);
    return num + annualTroopMaintenance(empire);
}

// ---- stubs added by M4l (ShipGroup.CheckForMissionCompletion, pirate fleets) ----

const T_findNearestBaseForPirateAttack = registerTodo('M4s', 'findNearestBaseForPirateAttack');
/** Galaxy.7.cs 1210 FindNearestBaseForPirateAttack(x, y, empireToExclude) — stub: null (super-pirate fleets get no follow-up target). */
export function findNearestBaseForPirateAttack(galaxy: Galaxy, x: number, y: number, empireToExclude: Empire | null): BuiltObject | null {
    /* TODO(port) M4s */ todo(T_findNearestBaseForPirateAttack);
    return null;
}

const T_findNearestKnownBaseOfEmpireForPirateAttack = registerTodo('M4s', 'findNearestKnownBaseOfEmpireForPirateAttack');
/** Galaxy.7.cs 1056 FindNearestKnownBaseOfEmpireForPirateAttack(attackingPirateEmpire, x, y, targetEmpire, attackStrength) — stub: null. */
export function findNearestKnownBaseOfEmpireForPirateAttack(galaxy: Galaxy, attackingPirateEmpire: Empire, x: number, y: number, targetEmpire: Empire, attackStrength: number): BuiltObject | null {
    /* TODO(port) M4s */ todo(T_findNearestKnownBaseOfEmpireForPirateAttack);
    return null;
}

// ---- stub added by M4f (called from missions/cmdReassign.ts, BuiltObject.2.cs 4017/4077/4126/4203/4219) ----

const T_pirateAssignShipMission = registerTodo('M4s', 'pirateAssignShipMission');
/** Empire.1.cs 4385-5505 PirateAssignShipMission(ship, starDate) (single-ship overload) — stub. RND: draws in the body — not drawn until M4s2. */
export function pirateAssignShipMission(galaxy: Galaxy, empire: Empire, ship: BuiltObject, starDate: number): void {
    /* TODO(port) M4s2 */ todo(T_pirateAssignShipMission);
}
