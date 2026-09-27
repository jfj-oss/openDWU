// M4a skeleton: BuiltObject.DoTasks (BuiltObject.cs 3609-3853), ships and bases. Statement-for-statement in C#
// order. Intervals are TimeSpan `>=` tests; the touch for a block is written AFTER that block (3768/3796/3812).
// The first call back-dates the touches so every block fires (3618-3633).

import type { Galaxy } from '../galaxy';
import type { BuiltObject } from '../builtObject';
import {
    INTERMEDIATE_PROCESSING_SPAN_MS,
    LONG_PROCESSING_SPAN_MS,
    MIN_TIME,
    PERIODIC_PROCESSING_SPAN_MS,
    spanSeconds,
} from './simTime';
import { csInt } from '../builtObjectComponent';
import { BuiltObjectMissionType, builtObjectMission } from '../missions/mission';
import type { ShipGroup } from '../fleets/shipGroup';
import { performFleetTasks, reviewFleetBonuses } from '../fleets/shipGroup';
// Existing ports.
import { captainBonuses, reviewCaptainBonuses } from '../characters';
// Package stubs.
import { executeCommands } from '../missions/executeCommands';
import { checkHyperjumpPending, detectHyperDeny, doDeployment, performEnergyCollection, rechargeReactors, updateIndexesForMovement } from '../movement';
import { checkForUnownedCargoBuiltObject } from '../logistics/orders';
import { checkClearDocking, checkForShipsNoLongerDockingBuiltObject, checkRemoveInvalidDockingShipsFromWaitQueue } from '../logistics/docking';
import { checkForFuelOrdering, checkForRefuelling } from '../logistics/refuel';
import { industrialProcessing } from '../industry';
import { checkWhetherStillBeingBuilt } from '../construction/constructionYard';
import { reviewRetrofitConstructionQueue } from '../construction/retrofit';
import { checkForRepairs, checkRepairMissionStillValid, doRepairs } from '../construction/repair';
import { fleeFromHopelessBattle, threatEvaluation } from '../combat/threats';
import { checkForAttack, checkForRandomAttackTargets, checkNearTarget, modifyAttackRangeByTargetSpeed, setAttackRangeWhenNoMission } from '../combat/attackAI';
import {
    checkForPlanetDestroyerWeaponFiringDelayOnHyperExit,
    checkNearbyBuiltObjectsForShieldAreaRecharge,
    checkShieldAreaRechargeReset,
    defendBase,
    defendShipFromAttackers,
    handleWeaponsFiringBuiltObject,
    interceptMissiles,
    rechargeShields,
} from '../combat/weapons';
import { checkSelfDestruct, doExplosionsBuiltObject, reviewDisabledComponents } from '../combat/damage';
import { buildNewFighters, checkFightersNeedUpgrading, fighterDoTasks, fireAtNearbyFighters, launchAllFighters, manufactureRepairFighters } from '../combat/fighters';
import { scanForNewOwnerBuiltObject } from '../combat/invasion';
import {
    baconBuiltObjectHugeProcessingSpanActions,
    fireAtAssaultPods,
    fireTractorBeamsAtInvadingTroopTransports,
    handleAssaultPodMovement,
    processBoardingAssault,
    resetAssaultPods,
} from '../combat/boarding';
import { healTroops } from '../combat/troopsRuntime';
import { pirateBaseDiscovery, updateRaidCountdownBuiltObject } from '../pirates/pirateAI';
import { reviewSystemVisibilityForPreWarpShip, scanArea, scanForLocations } from '../exploration';
import { applyLocationEffects, doLocationEffects } from '../events';
import { baconSettings } from '../data/baconSettings';

/** Galaxy.ConditionCheckLimit (Galaxy.7.cs 569). */
export function conditionCheckLimit(condition: boolean, maximumIterations: number, counter: { count: number }): boolean {
    if (counter.count >= maximumIterations) {
        return false;
    }
    counter.count++;
    return condition;
}

/** StellarObjectList.CheckForNonDestroyedObjects (StellarObjectList.cs 87). */
function checkForNonDestroyedObjects(list: unknown[]): boolean {
    for (let index = 0; index < list.length; ++index) {
        const stellarObject = list[index] as { hasBeenDestroyed: boolean } | null;
        if (stellarObject != null && !stellarObject.hasBeenDestroyed) {
            return true;
        }
    }
    return false;
}

/** BuiltObject.CaptainShipEnergyUsageBonus (BuiltObject.cs 596): (double)(int)_CaptainShipEnergyUsageBonus / 100.0, default byte 100. */
function captainShipEnergyUsageBonus(builtObject: BuiltObject): number {
    const bonuses = captainBonuses(builtObject);
    return (bonuses !== null ? bonuses.shipEnergyUsage : 100) / 100.0;
}

/** BuiltObject.cs 3609 / 3614 DoTasks(time, starDate[, inView]); `time` in game ms, `starDate` = Galaxy.CurrentStarDate. */
export function builtObjectDoTasks(galaxy: Galaxy, builtObject: BuiltObject, time: number, starDate: number, inView = false): boolean {
    const bo = builtObject;
    // 3616-3617
    bo.inView = inView;
    const tempNow = time;
    // 3618-3633
    if (bo.lastTouch === MIN_TIME) {
        bo.lastTouch = tempNow;
    }
    if (bo.lastIntermediateTouch === MIN_TIME) {
        bo.lastIntermediateTouch = tempNow - INTERMEDIATE_PROCESSING_SPAN_MS;
    }
    if (bo.lastPeriodicTouch === MIN_TIME) {
        bo.lastPeriodicTouch = tempNow - PERIODIC_PROCESSING_SPAN_MS;
    }
    if (bo.lastLongTouch === MIN_TIME) {
        bo.lastLongTouch = tempNow - LONG_PROCESSING_SPAN_MS;
    }
    // 3634-3649
    if (tempNow - bo.lastTouch < 0) bo.lastTouch = tempNow;
    if (tempNow - bo.lastIntermediateTouch < 0) bo.lastIntermediateTouch = tempNow;
    if (tempNow - bo.lastPeriodicTouch < 0) bo.lastPeriodicTouch = tempNow;
    if (tempNow - bo.lastLongTouch < 0) bo.lastLongTouch = tempNow;
    // 3650
    const num = spanSeconds(tempNow, bo.lastTouch);
    // 3651-3658
    if (Number.isNaN(bo.currentFuel)) bo.currentFuel = 0.0;
    if (bo.currentFuel < 0.0) bo.currentFuel = 0.0;
    // 3659-3662
    doDeployment(galaxy, bo, num);
    rechargeShields(galaxy, bo, num);
    updateIndexesForMovement(galaxy, bo, galaxy.resolveIndexX(bo.xpos), galaxy.resolveIndexY(bo.ypos), false);
    // 3663-3667
    if (bo.threats === null) {
        bo.threats = new Array<BuiltObject | null>(20).fill(null);
        bo.threatLevels = new Array<number>(20).fill(0);
    }
    // 3668-3675
    const mission = builtObjectMission(bo.mission);
    if (
        (bo.attackers !== null && bo.attackers.length > 0 && checkForNonDestroyedObjects(bo.attackers)) ||
        (mission !== null &&
            (mission.type === BuiltObjectMissionType.Attack ||
                mission.type === BuiltObjectMissionType.Escape ||
                mission.type === BuiltObjectMissionType.Bombard ||
                mission.type === BuiltObjectMissionType.Capture ||
                mission.type === BuiltObjectMissionType.Raid))
    ) {
        bo.inBattle = true;
    } else {
        bo.inBattle = false;
    }
    // 3676-3677
    bo.hyperjumpAboutToEnter = false;
    bo.hyperjumpJustExited = false;
    // 3678-3682
    if (bo.scanHabitatIndex >= 0 && bo.lastScanTime < starDate - 2000) {
        bo.scanHabitatIndex = -1;
        bo.lastScanTime = 0;
    }
    // 3683-3695
    if (mission === null || mission.type === BuiltObjectMissionType.Undefined) {
        if (bo.currentSpeed > Math.fround(Math.max(bo.topSpeed, bo.cruiseSpeed))) {
            bo.currentSpeed = bo.cruiseSpeed;
            checkForPlanetDestroyerWeaponFiringDelayOnHyperExit(galaxy, bo, time);
        }
        if (bo.shipPullAmountLocation <= 0) {
            bo.targetSpeed = 0;
            bo.preferredSpeed = 0;
        }
    }
    // 3696-3705 ExecuteCommands loop (≤ 50 iterations).
    let num2 = num;
    const iterationCount = { count: 0 };
    while (conditionCheckLimit(num2 > 0.0, 50, iterationCount)) {
        num2 = executeCommands(galaxy, bo, num2, time, starDate);
        if (num2 > num) {
            num2 = 0.0;
        }
    }
    // 3706-3710
    if (bo.empire !== null) {
        handleWeaponsFiringBuiltObject(galaxy, bo, num, time);
        handleAssaultPodMovement(galaxy, bo, num);
    }
    // 3711-3717
    if (bo.fighters !== null && bo.fighters.length > 0) {
        for (let i = 0; i < bo.fighters.length; i++) {
            fighterDoTasks(galaxy, bo.fighters[i], time, inView);
        }
    }
    // 3718-3725
    if (bo.explosions.length > 0) {
        doExplosionsBuiltObject(galaxy, bo);
        if (bo.hasBeenDestroyed) {
            bo.shipPullAmountLocation = Math.fround(bo.shipPullAmountLocation / 2);
        }
    }
    // 3726
    doLocationEffects(galaxy, bo, num, time);
    // 3727-3733
    if (bo.assaultOwnershipChangeCounter > 0) {
        const num3 = num * 1000.0;
        let val = csInt(bo.assaultOwnershipChangeCounter - num3);
        val = Math.min(3000, Math.max(0, val));
        bo.assaultOwnershipChangeCounter = val; // (short), within [0, 3000]
    }
    // 3734-3769 intermediate block.
    if (tempNow - bo.lastIntermediateTouch >= INTERMEDIATE_PROCESSING_SPAN_MS) {
        checkNearTarget(galaxy, bo);
        if (bo.empire !== null) {
            scanArea(galaxy, bo);
        }
        if (bo.inBattle && !checkHyperjumpPending(galaxy, bo)) {
            launchAllFighters(galaxy, bo);
        }
        setAttackRangeWhenNoMission(galaxy, bo);
        checkShieldAreaRechargeReset(galaxy, bo, time);
        const timePassed = spanSeconds(tempNow, bo.lastIntermediateTouch);
        applyLocationEffects(galaxy, bo, timePassed, time);
        reviewDisabledComponents(galaxy, bo, timePassed);
        threatEvaluation(galaxy, bo, time);
        modifyAttackRangeByTargetSpeed(galaxy, bo);
        scanForNewOwnerBuiltObject(galaxy, bo);
        scanForLocations(galaxy, bo);
        if (bo.empire !== null && bo.inBattle) {
            checkForAttack(galaxy, bo);
        }
        if (!bo.canHyperJump && bo.warpSpeed > 0 && !detectHyperDeny(galaxy, bo)) {
            bo.canHyperJump = true;
        }
        if (bo.isAutoControlled) {
            checkForRandomAttackTargets(galaxy, bo);
        }
        doRepairs(galaxy, bo, timePassed);
        processBoardingAssault(galaxy, bo, time, timePassed);
        bo.lastIntermediateTouch = tempNow;
    }
    // 3770-3797 periodic block.
    if (tempNow - bo.lastPeriodicTouch >= PERIODIC_PROCESSING_SPAN_MS) {
        const timePassed2 = spanSeconds(tempNow, bo.lastPeriodicTouch);
        checkRepairMissionStillValid(galaxy, bo);
        checkClearDocking(galaxy, bo);
        checkWhetherStillBeingBuilt(galaxy, bo);
        if (bo.empire !== null) {
            fleeFromHopelessBattle(galaxy, bo);
            reviewFleetBonuses(galaxy, bo);
            checkNearbyBuiltObjectsForShieldAreaRecharge(galaxy, bo, time);
            checkFightersNeedUpgrading(galaxy, bo);
            buildNewFighters(galaxy, bo);
            manufactureRepairFighters(galaxy, bo, timePassed2);
            industrialProcessing(galaxy, bo, timePassed2, time);
            reviewRetrofitConstructionQueue(galaxy, bo, time, starDate);
            checkForRefuelling(galaxy, bo, true);
            if (bo.isAutoControlled) {
                checkForRepairs(galaxy, bo);
            }
            checkForFuelOrdering(galaxy, bo);
            healTroops(galaxy, bo, timePassed2);
            pirateBaseDiscovery(galaxy, bo);
            performFleetTasks(galaxy, bo);
        }
        bo.lastPeriodicTouch = tempNow;
    }
    // 3798-3813 long block.
    if (tempNow - bo.lastLongTouch >= LONG_PROCESSING_SPAN_MS) {
        baconBuiltObjectHugeProcessingSpanActions(galaxy, bo);
        checkForShipsNoLongerDockingBuiltObject(galaxy, bo);
        checkForUnownedCargoBuiltObject(galaxy, bo);
        reviewCaptainBonuses(bo);
        checkForRefuelling(galaxy, bo, false);
        // 3804 AnnualSupportCost = (int)(Design.CalculateCurrentPurchasePrice(_Galaxy) / Galaxy.ShipMarkupFactor) + 1.
        bo.annualSupportCost = csInt(bo.design.calculateCurrentPurchasePrice(galaxy) / baconSettings.shipMarkupFactor) + 1;
        reviewSystemVisibilityForPreWarpShip(galaxy, bo);
        const timePassed3 = spanSeconds(tempNow, bo.lastLongTouch);
        updateRaidCountdownBuiltObject(galaxy, bo, timePassed3);
        checkRemoveInvalidDockingShipsFromWaitQueue(galaxy, bo);
        checkSelfDestruct(galaxy, bo);
        resetAssaultPods(galaxy, bo);
        bo.lastLongTouch = tempNow;
    }
    // 3814-3822
    if (bo.empire !== null) {
        defendBase(galaxy, bo, time);
        defendShipFromAttackers(galaxy, bo, time);
        fireAtAssaultPods(galaxy, bo, time, inView);
        interceptMissiles(galaxy, bo, time, inView);
        fireAtNearbyFighters(galaxy, bo, time, inView);
        fireTractorBeamsAtInvadingTroopTransports(galaxy, bo, time, inView);
    }
    // 3823-3834 static energy consumption.
    if (bo.empire !== null) {
        let num4 = bo.staticEnergyConsumption * num;
        const shipGroup = bo.shipGroup as ShipGroup | null;
        if (shipGroup !== null) {
            num4 /= shipGroup.shipEnergyUsageBonus;
        }
        num4 /= captainShipEnergyUsageBonus(bo);
        bo.currentEnergy -= num4;
        performEnergyCollection(galaxy, bo, num);
        rechargeReactors(galaxy, bo, num);
    }
    // 3835-3850
    if (Number.isNaN(bo.currentFuel)) bo.currentFuel = 0.0;
    if (bo.currentFuel < 0.0) bo.currentFuel = 0.0;
    if (Number.isNaN(bo.targetHeading)) bo.targetHeading = 0;
    if (Number.isNaN(bo.heading)) bo.heading = 0;
    // 3851-3852
    bo.lastTouch = tempNow;
    return true;
}
