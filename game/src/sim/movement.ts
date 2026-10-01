// M4c — movement, hyperjump, gravity wells, fuel ranges, energy, index upkeep, system links / fuel status
// (tasks/M4-plan.md §3.3 M4c).
//
// Ported here (C# `this` first, free functions):
// - BuiltObject.2.cs: DoMovement 6851 (+ CheckForArrival 7183, CheckForDeceleration 7249, WillMeetDestination 7397,
//   CheckWhetherArrived 8131, EnsureWithinGalaxy 6983), AccelerateToTargetSpeed 7334, GetCurrentTurnRate 7372,
//   CalculateCurrentHeading 7433, ConsumeFuel 7131, UpdateIndexesForMovement 7163, PerformEnergyCollection 7765;
// - BuiltObject.1.cs 1737-1850 (DetectHyperDeny, CheckForHyperExitGravityWell(s)), 2310-2524 (fuel ranges,
//   refuelling-point margins, RechargeReactors); BuiltObject.cs 3473 DoDeployment, 4856 CheckRefuelLocationRangeAcceptable;
// - BaconBuiltObject.cs: UpdatePosition 4329, ExitHyperjump 4627, CheckFuelHandicap 4651, CheckHyperjumpPending 2539,
//   IsOutsideStarGravityWell 2493 (+ gravity-well helpers 2518, 3704-3858), CheckFightersOnboardAndRetrieve 2561,
//   stargate check 4338 (guard only: BaconMain.useStargates is off);
// - Galaxy.6.cs 3027-3445 (CheckEmpireCanRefuelAtEmpire, FastFindNearestRefuellingPoint[InIndex],
//   IdentifyWhetherSystemIsRefuellingPointForEmpire), 3446-3530 (CheckFuelSuppliedAtLocation, CheckSufficientFuelAvailable),
//   4626 SortStellarObjectsByDistanceThreadsafe; Galaxy.5.cs 2923 CheckShouldExplore; Galaxy.3.cs 783
//   FastFindNearestOtherSpacePort; Empire.6.cs 3737 UltraFastFindNearestRefuellingLocation; BuiltObjectList.cs 348
//   GetNearestBuiltObjectWithinRange;
// - Empire.9.cs 3225-3380 (EvaluateSystemLinks + helpers), Empire.2.cs 3784-3878 (UpdateSystemFuelSourceStatus,
//   UpdateSystemRefuellingStatus), Empire.4.cs 2516 CheckForStrandedShips; Habitat.cs 2007 ReviewWhetherRefuellingDepot.
// - ShipGroup.cs derived properties the movement code reads (WarpSpeed 3241, CruiseSpeed 3258, TopSpeed 3274,
//   ObtainCharacters 1310, RemoveShipsWithoutHyperdrive 3226).
// The ExecuteCommands movement cases are in missions/cmdMovement.ts.
//
// Rnd: HyperTo (cmdMovement.ts) draws Next(0, 2000) + SelectHyperJumpExitPoint; EvaluateSystemLinks draws
// Next(0, count) for a system not linked to the capital through a space port. Nothing else here draws.
//
// Bacon settings (BaconBuiltObject.cs 47-64, BaconMain.cs 82): the class defaults are used, as everywhere else in
// the port (BaconSettings.txt overrides are a TODO(port) of their own, see builtObject.ts). They live in
// `baconMovementSettings` so a settings loader can change them.

import { isAiControlled } from './missions/playerOrder';
import { scenarioQuery } from './scenario/hooks';
import type { Galaxy } from './galaxy';
import type { Empire } from './empire';
import type { BuiltObject } from './builtObject';
import { TurnDirection } from './builtObject';
import { HabitatCategoryType, HabitatType, planetsOf, type Habitat } from './types';
import type { Creature } from './creature';
import { determineAngle } from './creature';
import type { CargoList } from './cargo';
import { BuiltObjectSubRole } from './builtObjectTypes';
import { BuiltObjectRole } from './data/designSpecifications';
import { ComponentCategoryType } from './data/policies';
import { csInt, toShort } from './builtObjectComponent';
import { CharacterEventType, captainBonuses } from './characters';
import { GalaxyLocationEffectType } from './galaxyLocation';
import { SystemVisibilityStatus } from './visibility';
import { DiplomaticRelationType, obtainDiplomaticRelation } from './diplomacy';
import { PirateRelationType, obtainPirateRelation } from './pirateRelations';
import { isObjectVisibleToThisEmpire, isStellarObjectDockable } from './independentTraders';
import { determineEmpireSystems } from './forceStructure';
import { fastFindNearestSpacePort, getBuiltObjectsAtLocation } from './stationPlacement';
import { findNewestCanBuild, resolveSubRoleDescription } from './designGeneration';
import { gameText } from './colonyTick';
import { checkRuinsHaveBenefit } from './exploration';
import { EmpireMessageType, sendMessageToEmpire } from './messages';
import { doCharacterEventRuntime } from './events';
import { calculateResourceLevelBuiltObject, calculateResourceLevelHabitat } from './logistics/colonySupply';
import { cargoAvailable, cargoIndexOf } from './logistics/orders';
import { clearPreviousMissionRequirements, initiateUndeploy } from './missions/assign';
import { evaluateRelativeToParent } from './missions/executeCommands';
import { BuiltObjectMissionType, Command, CommandAction, builtObjectMission } from './missions/mission';
import type { ShipGroup } from './fleets/shipGroup';
import { shipGroupObtainCharacters } from './fleets/shipGroupTasks';
import { fighterReturnToCarrier } from './combat/fighters';

// ---------------------------------------------------------------------------------------------------------------
// Constants and settings
// ---------------------------------------------------------------------------------------------------------------

/** Galaxy.3.cs 4965 IndexSize. */
const INDEX_SIZE = 400000;
/** Galaxy.3.cs 4978 MaxSolarSystemSize. */
export const MAX_SOLAR_SYSTEM_SIZE = 23000;
/** Galaxy.3.cs 4980 MovementPrecision. */
export const MOVEMENT_PRECISION = 30;
/** Galaxy.3.cs 4984 MovementImpulseSpeed. */
export const MOVEMENT_IMPULSE_SPEED = 3;
/** Galaxy.3.cs 4987 ImpulseMargin. */
export const IMPULSE_MARGIN = 5;
/** Galaxy.3.cs 5018 MinimumLevelForRefuellingPoint. */
export const MINIMUM_LEVEL_FOR_REFUELLING_POINT = 600;

/**
 * Game statics the movement code reads that the Bacon mod lets BaconSettings.txt override (BaconMain.cs 606-631, 979)
 * — the class / Galaxy.InitializeStatics defaults here; baconSettings.ts baconInitializeSettings applies the file
 * (BaconSettings.txt of the stock install: HyperJumpThreshhold=4000, BaseHyperJumpAccuracy=666,
 * useStarGravityWells=false, sublightFuelBurnDivisor=20, noFuel* 0.90 / 0.90 / 0.50) once a game exists.
 */
export const baconMovementSettings = {
    /** Galaxy.3.cs 4971 HyperJumpThreshhold. */
    hyperJumpThreshhold: 12000,
    /** Galaxy.3.cs 4972 BaseHyperJumpAccuracy. */
    baseHyperJumpAccuracy: 3000.0,
    /** BaconBuiltObject.cs 49 useStarGravityWells. */
    useStarGravityWells: true,
    /** BaconBuiltObject.cs 50 smallShipsJumpSooner. */
    smallShipsJumpSooner: false,
    /** BaconBuiltObject.cs 52-54 noFuel*SpeedMultiplier (float 0.33f). */
    noFuelCruiseSpeedMultiplier: Math.fround(0.33),
    noFuelTopSpeedMultiplier: Math.fround(0.33),
    noFuelHyperSpeedMultiplier: Math.fround(0.33),
    /** BaconMain.cs 82 useStargates. */
    useStargates: false,
    /** BaconBuiltObject.cs 51 sublightFuelBurnDivisor (float 1f; BaconBuiltObject.ModMyShip divides sublight burn by it). */
    sublightFuelBurnDivisor: Math.fround(1),
};

/** The class / InitializeStatics defaults of baconMovementSettings (restored before a new game applies the file). */
export const BACON_MOVEMENT_SETTINGS_DEFAULTS: Readonly<typeof baconMovementSettings> = { ...baconMovementSettings };

/** BaconBuiltObject.cs 64 starGravityWellRangeSquared = MaxSolarSystemSize². */
const STAR_GRAVITY_WELL_RANGE_SQUARED = MAX_SOLAR_SYSTEM_SIZE * MAX_SOLAR_SYSTEM_SIZE;

const PI = Math.PI;
const f = Math.fround;

type StellarObject = BuiltObject | Habitat | Creature;

/** BuiltObject private fields the movement code writes (builtObject.ts keeps them private). */
interface BuiltObjectPrivate {
    _deployProgress: number;
    _isDeployed: boolean;
    energyCollection: number;
    _turnDirection: TurnDirection;
}
function priv(bo: BuiltObject): BuiltObjectPrivate {
    return bo as unknown as BuiltObjectPrivate;
}

function shipGroupOf(bo: BuiltObject): ShipGroup | null {
    return bo.shipGroup as ShipGroup | null;
}

// ---------------------------------------------------------------------------------------------------------------
// Bonuses and ship-group derived values
// ---------------------------------------------------------------------------------------------------------------

/** BuiltObject.cs 596 CaptainShipEnergyUsageBonus = _CaptainShipEnergyUsageBonus / 100.0 (byte, default 100). */
function captainShipEnergyUsageBonus(bo: BuiltObject): number {
    return (captainBonuses(bo)?.shipEnergyUsage ?? 100) / 100.0;
}

/** BuiltObject.cs CaptainShipManeuveringBonus = _CaptainShipManeuveringBonus / 100.0 (byte, default 100). */
function captainShipManeuveringBonus(bo: BuiltObject): number {
    return (captainBonuses(bo)?.shipManeuvering ?? 100) / 100.0;
}

/** ShipGroup.cs 87 HyperjumpSpeedBonus. */
function shipGroupHyperjumpSpeedBonus(shipGroup: ShipGroup): number {
    return shipGroup.hyperjumpSpeedBonus;
}

/** ShipGroup.cs 71 ShipManeuveringBonus. */
function shipGroupShipManeuveringBonus(shipGroup: ShipGroup): number {
    return shipGroup.shipManeuveringBonus;
}

// ShipGroup.cs 3241 WarpSpeed (fleets/shipGroup.ts), 3258 CruiseSpeed / 3274 TopSpeed / 1310 ObtainCharacters /
// 3226 RemoveShipsWithoutHyperdrive (fleets/shipGroupTasks.ts).

/** BuiltObject.cs 572 WarpSpeedWithBonuses. */
export function warpSpeedWithBonuses(builtObject: BuiltObject): number {
    let num = builtObject.warpSpeed;
    const shipGroup = shipGroupOf(builtObject);
    if (shipGroup != null) {
        num *= shipGroupHyperjumpSpeedBonus(shipGroup);
    }
    // BuiltObject.cs 608 CaptainHyperjumpSpeedBonus = _CaptainHyperjumpSpeedBonus / 100 (byte, default 100).
    num *= (captainBonuses(builtObject)?.hyperjumpSpeed ?? 100) / 100.0;
    return Math.trunc(num);
}

// ---------------------------------------------------------------------------------------------------------------
// Per-frame upkeep (BuiltObject.DoTasks)
// ---------------------------------------------------------------------------------------------------------------

/** BuiltObject.cs 3473 DoDeployment(timePassed). */
export function doDeployment(galaxy: Galaxy, builtObject: BuiltObject, timePassed: number): void {
    const p = priv(builtObject);
    if (p._deployProgress > 0) {
        p._deployProgress = f(p._deployProgress + f(f(timePassed) / 30));
        if (p._deployProgress >= 1.0) {
            p._isDeployed = true;
            p._deployProgress = 0;
        }
    } else if (p._deployProgress < 0) {
        if (builtObject.isDeployed) {
            initiateUndeploy(galaxy, builtObject);
        }
        p._deployProgress = f(p._deployProgress - f(f(timePassed) / 30));
        if (p._deployProgress <= -1.0) {
            p._deployProgress = 0;
        }
    }
}

/** BuiltObject.2.cs 6983 EnsureWithinGalaxy. */
function ensureWithinGalaxy(galaxy: Galaxy, bo: BuiltObject): void {
    if (bo.xpos < 0.0) bo.xpos = 0.0;
    if (bo.xpos > galaxy.sizeX - 1) bo.xpos = galaxy.sizeX - 1;
    if (bo.ypos < 0.0) bo.ypos = 0.0;
    if (bo.ypos > galaxy.sizeY - 1) bo.ypos = galaxy.sizeY - 1;
    let flag = false;
    if (Number.isNaN(bo.xpos) || Number.isNaN(bo.ypos)) {
        flag = true;
        if (bo.parentHabitat !== null) {
            bo.parentOffsetX = 0.0;
            bo.parentOffsetY = 0.0;
            bo.xpos = bo.parentHabitat.xpos + bo.parentOffsetX;
            bo.ypos = bo.parentHabitat.ypos + bo.parentOffsetY;
        } else if (bo.parentBuiltObject !== null) {
            bo.parentOffsetX = 0.0;
            bo.parentOffsetY = 0.0;
            bo.xpos = bo.parentBuiltObject.xpos + bo.parentOffsetX;
            bo.ypos = bo.parentBuiltObject.ypos + bo.parentOffsetY;
        }
    }
    if (flag) {
        bo.xpos = Math.max(bo.xpos, 0.0);
        bo.xpos = Math.min(bo.xpos, galaxy.sizeX - 1);
        bo.ypos = Math.max(bo.ypos, 0.0);
        bo.ypos = Math.min(bo.ypos, galaxy.sizeY - 1);
    }
}

/** `while (list.Contains(x)) list.Remove(x)`. */
function removeAllFromCell(cell: BuiltObject[], bo: BuiltObject): void {
    let i = cell.indexOf(bo);
    while (i >= 0) {
        cell.splice(i, 1);
        i = cell.indexOf(bo);
    }
}

/** BuiltObject.2.cs 7163 UpdateIndexesForMovement(oldIndexX, oldIndexY, galaxy, performIndexCheck). Allocation-free. */
export function updateIndexesForMovement(galaxy: Galaxy, builtObject: BuiltObject, indexX: number, indexY: number, performIndexCheck: boolean): void {
    ensureWithinGalaxy(galaxy, builtObject);
    // (int)Xpos / IndexSize + Galaxy.CorrectIndexCoords.
    let x = Math.trunc(Math.trunc(builtObject.xpos) / INDEX_SIZE);
    let y = Math.trunc(Math.trunc(builtObject.ypos) / INDEX_SIZE);
    const maxX = galaxy.indexMaxX;
    const maxY = galaxy.indexMaxY;
    if (x < 0) x = 0;
    else if (x >= maxX) x = maxX - 1;
    if (y < 0) y = 0;
    else if (y >= maxY) y = maxY - 1;
    const grid = galaxy.builtObjectIndexGrid;
    if (indexX !== x || indexY !== y) {
        removeAllFromCell(grid[indexX][indexY], builtObject);
        grid[x][y].push(builtObject);
    }
    if (performIndexCheck && !builtObject.hasBeenDestroyed && !grid[x][y].includes(builtObject)) {
        grid[x][y].push(builtObject);
    }
}

/** BuiltObject.2.cs 7765 PerformEnergyCollection(timePassed). */
export function performEnergyCollection(galaxy: Galaxy, builtObject: BuiltObject, timePassed: number): void {
    const bo = builtObject;
    if (!(bo.currentSpeed <= 0) || !bo.isEnergyCollector) {
        return;
    }
    const energyCollection = priv(bo).energyCollection;
    const star = bo.nearestSystemStar;
    if (star !== null) {
        let num = MAX_SOLAR_SYSTEM_SIZE + 500.0;
        if (star.category === HabitatCategoryType.GasCloud) {
            num = Math.trunc(star.diameter / 2) + 500.0;
        }
        const num2 = galaxy.calculateDistance(bo.xpos, bo.ypos, star.xpos, star.ypos);
        if (num2 <= num) {
            const num3 = (energyCollection * star.solarRadiation * 10.0 * timePassed) / 100.0;
            const num4 = (energyCollection * star.microwaveRadiation * 10.0 * timePassed) / 100.0;
            const num5 = (energyCollection * star.xrayRadiation * 10.0 * timePassed) / 100.0;
            let num6 = num3 + num4 + num5;
            num6 *= (num - num2 + 2000.0) / num;
            bo.currentEnergy += num6;
            if (bo.currentEnergy > bo.reactorStorageCapacity) {
                bo.currentEnergy = bo.reactorStorageCapacity;
            }
        }
    } else if (bo.hyperjumpDisabledLocation) {
        const num7 = 100.0;
        const num8 = (energyCollection * num7 * timePassed) / 100.0;
        bo.currentEnergy += num8;
        if (bo.currentEnergy > bo.reactorStorageCapacity) {
            bo.currentEnergy = bo.reactorStorageCapacity;
        }
    }
}

/** BuiltObject.1.cs 2509 RechargeReactors(timePassed). */
export function rechargeReactors(galaxy: Galaxy, builtObject: BuiltObject, timePassed: number): void {
    const bo = builtObject;
    if (bo.currentEnergy < bo.reactorStorageCapacity) {
        const num = fuelUnitPerEnergyUnit(bo);
        let num2 = Math.min(bo.reactorPowerOutput * timePassed, bo.reactorStorageCapacity - bo.currentEnergy);
        let num3 = num2 * num;
        if (num3 > bo.currentFuel) {
            num3 = bo.currentFuel;
            num2 = num3 / num;
        }
        // mod layer (19j tamed creatures): a self-fuelling ship burns no fuel; no-op without a scenario.
        if (!(galaxy.scenario !== null && scenarioQuery(galaxy, 'builtObjectSelfFuelling', false, { builtObject: bo }))) bo.currentFuel -= num3;
        bo.currentEnergy += num2;
    }
}

/** BuiltObject.2.cs 7131 ConsumeFuel(timePassed). */
export function consumeFuel(galaxy: Galaxy, bo: BuiltObject, timePassed: number): void {
    let num = 0.0;
    if (bo.currentSpeed > bo.topSpeed) {
        num = bo.warpSpeedFuelBurn * timePassed;
    } else if (bo.targetSpeed > bo.cruiseSpeed && bo.targetSpeed <= bo.topSpeed) {
        num = bo.topSpeedFuelBurn * timePassed;
    } else if (bo.targetSpeed >= MOVEMENT_IMPULSE_SPEED && bo.targetSpeed <= bo.cruiseSpeed) {
        num = bo.cruiseSpeedFuelBurn * timePassed;
    } else if (bo.targetSpeed > 0 && bo.targetSpeed <= MOVEMENT_IMPULSE_SPEED) {
        num = bo.impulseSpeedFuelBurn * timePassed;
    }
    const shipGroup = shipGroupOf(bo);
    if (shipGroup !== null) {
        num /= shipGroup.shipEnergyUsageBonus;
    }
    num /= captainShipEnergyUsageBonus(bo);
    bo.currentEnergy -= num;
}

/** BuiltObject.2.cs 7334 AccelerateToTargetSpeed(timePassed). CurrentSpeed / AccelerationRate are floats. */
export function accelerateToTargetSpeed(galaxy: Galaxy, builtObject: BuiltObject, timePassed: number): void {
    const bo = builtObject;
    if (bo.targetSpeed > bo.currentSpeed) {
        const num = bo.accelerationRate * timePassed;
        if (bo.currentSpeed + num >= bo.targetSpeed) {
            bo.currentSpeed = f(bo.targetSpeed);
        } else {
            bo.currentSpeed = f(bo.currentSpeed + f(num));
        }
    } else if (bo.targetSpeed < bo.currentSpeed) {
        const num2 = Math.max(1, bo.accelerationRate);
        const num3 = num2 * timePassed;
        if (bo.currentSpeed - num3 < bo.targetSpeed) {
            bo.currentSpeed = f(bo.targetSpeed);
        } else {
            bo.currentSpeed = f(bo.currentSpeed - f(num3));
        }
    }
    if (bo.currentSpeed < 0) {
        bo.currentSpeed = 0;
    }
}

/** BuiltObject.2.cs 7372/7377 GetCurrentTurnRate([speed]). */
export function getCurrentTurnRate(bo: BuiltObject, speed: number = bo.currentSpeed): number {
    let num = bo.turnRate;
    if (speed <= MOVEMENT_IMPULSE_SPEED * 2) {
        num *= 3.0;
    } else if (speed <= MOVEMENT_IMPULSE_SPEED * 3) {
        num *= 2.3;
    } else if (speed <= MOVEMENT_IMPULSE_SPEED * 4) {
        num *= 1.6;
    }
    const shipGroup = shipGroupOf(bo);
    if (shipGroup !== null) {
        num *= shipGroupShipManeuveringBonus(shipGroup);
    }
    return num * captainShipManeuveringBonus(bo);
}

/** Galaxy.7.cs 569 ConditionCheckLimit with a by-ref counter. */
function conditionCheckLimit(condition: boolean, maximumIterations: number, counter: { n: number }): boolean {
    if (counter.n >= maximumIterations) return false;
    counter.n++;
    return condition;
}
const headingCounter = { n: 0 };

/** BuiltObject.2.cs 7433 CalculateCurrentHeading(timePassed). Heading / TargetHeading are floats. */
export function calculateCurrentHeading(galaxy: Galaxy, builtObject: BuiltObject, timePassed: number): void {
    const bo = builtObject;
    if (bo.heading === bo.targetHeading) {
        return;
    }
    bo.headingChanged = true;
    const num = getCurrentTurnRate(bo) * timePassed;
    // `TargetHeading - Heading` is float arithmetic in C#, widened to double.
    let num2 = f(bo.targetHeading - bo.heading);
    if (num2 > PI) {
        num2 -= PI * 2.0;
    } else if (num2 < -PI) {
        num2 += PI * 2.0;
    }
    if ((num2 < 0.0 && num2 > -PI) || (num2 >= PI && num2 < PI * 2.0)) {
        if (Math.abs(num2) < Math.abs(num)) {
            bo.heading = bo.targetHeading;
            priv(bo)._turnDirection = TurnDirection.StraightAhead;
        } else {
            bo.heading = f(bo.heading - f(num));
            priv(bo)._turnDirection = TurnDirection.Left;
        }
        headingCounter.n = 0;
        while (conditionCheckLimit(bo.heading <= -PI, 20, headingCounter)) {
            // IncreaseAngle (7536).
            let a = bo.heading;
            if (a <= -PI) a += PI * 2.0;
            bo.heading = f(a);
        }
    } else {
        if (Math.abs(num2) < Math.abs(num)) {
            bo.heading = bo.targetHeading;
            priv(bo)._turnDirection = TurnDirection.StraightAhead;
        } else {
            bo.heading = f(bo.heading + f(num));
            priv(bo)._turnDirection = TurnDirection.Right;
        }
        headingCounter.n = 0;
        while (conditionCheckLimit(bo.heading >= PI, 20, headingCounter)) {
            // ReduceAngle (7527).
            let a = bo.heading;
            if (a >= PI) a -= PI * 2.0;
            bo.heading = f(a);
        }
    }
}

/** BuiltObject.2.cs 7397 WillMeetDestination(destinationX, destinationY, speed). */
function willMeetDestination(galaxy: Galaxy, bo: BuiltObject, destinationX: number, destinationY: number, speed: number): boolean {
    if (bo.turnDirection === TurnDirection.StraightAhead) {
        return true;
    }
    const currentTurnRate = getCurrentTurnRate(bo, speed);
    const num = (PI / currentTurnRate) * speed;
    const num2 = num / PI;
    let num3 = 0.0;
    switch (bo.turnDirection) {
        case TurnDirection.Left:
            num3 = bo.heading - PI / 2.0;
            break;
        case TurnDirection.Right:
            num3 = bo.heading + PI / 2.0;
            break;
    }
    const num4 = Math.cos(num3) * num2;
    const num5 = Math.tan(num3) * num4;
    const x = bo.xpos + num4;
    const y = bo.ypos + num5;
    const num6 = galaxy.calculateDistance(x, y, destinationX, destinationY);
    if (num6 < num2) {
        return false;
    }
    const num7 = determineAngle(bo.xpos, bo.ypos, destinationX, destinationY);
    const num8 = bo.heading - num7;
    const num9 = Math.abs((num8 / currentTurnRate) * speed);
    const num10 = galaxy.calculateDistance(bo.xpos, bo.ypos, destinationX, destinationY);
    if (num9 > num10 * 1.4) {
        return false;
    }
    return true;
}

/** BuiltObject.2.cs 8131 CheckWhetherArrived(currentX, currentY, targetX, targetY, allowance). */
export function checkWhetherArrived(galaxy: Galaxy, bo: BuiltObject, currentPositionX: number, currentPositionY: number, targetPositionX: number, targetPositionY: number, allowance: number): boolean {
    const num = galaxy.calculateDistance(currentPositionX, currentPositionY, targetPositionX, targetPositionY);
    if (num <= allowance) {
        bo.lastPositionX = currentPositionX;
        bo.lastPositionY = currentPositionY;
        return true;
    }
    const num2 = galaxy.calculateDistance(bo.lastPositionX, bo.lastPositionY, targetPositionX, targetPositionY);
    const num3 = galaxy.calculateDistance(bo.lastPositionX, bo.lastPositionY, currentPositionX, currentPositionY);
    bo.lastPositionX = currentPositionX;
    bo.lastPositionY = currentPositionY;
    if (num2 <= num3) {
        return true;
    }
    return false;
}

/** The actions after which CheckForArrival / CheckForDeceleration keep the ship at speed. */
function isMovementAction(action: CommandAction): boolean {
    return action === CommandAction.MoveTo || action === CommandAction.Attack || action === CommandAction.HyperTo || action === CommandAction.ConditionalHyperTo || action === CommandAction.SprintTo;
}

/** CheckForArrival's shared tail (BuiltObject.2.cs 7203-7223 / 7230-7250). */
function completeArrivalCommand(bo: BuiltObject): void {
    if (!bo.executingShipGroupCommand) {
        const mission = builtObjectMission(bo.mission)!;
        mission.completeCommand();
        bo.firstExecutionOfCommand = true;
        const command = mission.fastPeekCurrentCommand();
        if (command !== null) {
            if (!isMovementAction(command.action)) {
                bo.targetSpeed = 0;
                bo.preferredSpeed = 0;
            }
        } else {
            bo.targetSpeed = 0;
            bo.preferredSpeed = 0;
        }
    }
}

const arrivalOut = { distanceNotTravelled: 0.0 };

/** BuiltObject.2.cs 7183 CheckForArrival(...) → arrived; `out distanceNotTravelled` in `arrivalOut`. */
function checkForArrival(galaxy: Galaxy, bo: BuiltObject, currentDistance: number, distanceTravelled: number, relativeToParent: boolean, parentXPos: number, parentYPos: number, targetX: number, targetY: number, targetSize: number): boolean {
    arrivalOut.distanceNotTravelled = 0.0;
    const num = bo.dockedAt === null ? targetSize + MOVEMENT_PRECISION : targetSize + IMPULSE_MARGIN;
    const num2 = currentDistance - distanceTravelled;
    const currentPositionX = bo.xpos + Math.cos(bo.heading) * distanceTravelled;
    const currentPositionY = bo.ypos + Math.sin(bo.heading) * distanceTravelled;
    if (checkWhetherArrived(galaxy, bo, currentPositionX, currentPositionY, targetX, targetY, num)) {
        const distanceNotTravelled = num - num2;
        arrivalOut.distanceNotTravelled = distanceNotTravelled;
        distanceTravelled = !(num2 < num * -1.0) ? currentDistance - num2 : distanceTravelled - distanceNotTravelled;
        if (relativeToParent) {
            bo.parentOffsetX += Math.cos(bo.heading) * distanceTravelled;
            bo.parentOffsetY += Math.sin(bo.heading) * distanceTravelled;
            bo.xpos = parentXPos + bo.parentOffsetX;
            bo.ypos = parentYPos + bo.parentOffsetY;
        } else {
            bo.xpos += Math.cos(bo.heading) * distanceTravelled;
            bo.ypos += Math.sin(bo.heading) * distanceTravelled;
        }
        completeArrivalCommand(bo);
        return true;
    }
    return false;
}

/** CheckForDeceleration's orbit-speed floor (BuiltObject.2.cs 7272-7305 with the third case / 7314-7333 without). */
function orbitSpeedFloor(bo: BuiltObject, command: Command, includeParentBuiltObjectCase: boolean): void {
    const th = command.targetHabitat;
    const tb = command.targetBuiltObject;
    if (th !== null && bo.parentHabitat === null) {
        let num2 = th.orbitSpeed;
        if (th.parent !== null) num2 += th.parent.orbitSpeed;
        bo.targetSpeed = Math.max(bo.targetSpeed, num2 + MOVEMENT_IMPULSE_SPEED);
    } else if (tb !== null && tb.parentHabitat !== null && bo.parentBuiltObject === null) {
        let num3 = tb.parentHabitat.orbitSpeed;
        if (tb.parentHabitat.parent !== null) num3 += tb.parentHabitat.parent.orbitSpeed;
        bo.targetSpeed = Math.max(bo.targetSpeed, num3 + MOVEMENT_IMPULSE_SPEED);
    } else if (includeParentBuiltObjectCase && tb !== null && tb.parentBuiltObject !== null && tb.parentBuiltObject.parentHabitat !== null && bo.parentBuiltObject === null) {
        const h = tb.parentBuiltObject.parentHabitat;
        let num4 = h.orbitSpeed;
        if (h.parent !== null) num4 += h.parent.orbitSpeed;
        bo.targetSpeed = Math.max(bo.targetSpeed, num4 + MOVEMENT_IMPULSE_SPEED);
    }
}

/** BuiltObject.2.cs 7249 CheckForDeceleration(currentDistance, distanceTravelled). */
function checkForDeceleration(bo: BuiltObject, currentDistance: number, distanceTravelled: number): void {
    // (int)((double)((float)Math.Max((short)1, CruiseSpeed) / AccelerationRate) * ((double)Math.Max(1, CruiseSpeed) * 0.5) + CurrentSpeed)
    const cruise1 = Math.max(1, bo.cruiseSpeed);
    const num = csInt(f(f(cruise1) / bo.accelerationRate) * (cruise1 * 0.5) + bo.currentSpeed);
    if (currentDistance <= distanceTravelled + num + MOVEMENT_PRECISION) {
        const mission = builtObjectMission(bo.mission)!;
        const command = mission.fastPeekCurrentCommand();
        const command2 = mission.showNextCommand();
        if (command2 !== null) {
            if (isMovementAction(command2.action)) {
                return;
            }
            bo.targetSpeed = csInt(((currentDistance - (distanceTravelled + MOVEMENT_PRECISION)) / num) * bo.cruiseSpeed);
            if (bo.targetSpeed < MOVEMENT_IMPULSE_SPEED) {
                bo.targetSpeed = MOVEMENT_IMPULSE_SPEED;
            }
            if (command === null) {
                return;
            }
            orbitSpeedFloor(bo, command, true);
            return;
        }
        bo.targetSpeed = csInt(((currentDistance - (distanceTravelled + MOVEMENT_PRECISION)) / num) * bo.cruiseSpeed);
        if (bo.targetSpeed < MOVEMENT_IMPULSE_SPEED) {
            bo.targetSpeed = MOVEMENT_IMPULSE_SPEED;
        }
        if (command === null) {
            return;
        }
        orbitSpeedFloor(bo, command, false);
    } else {
        bo.targetSpeed = bo.cruiseSpeed;
    }
}

const relScratch = { parentXPos: 0.0, parentYPos: 0.0, targetArrivalDistance: 1.0 };

/**
 * BuiltObject.2.cs 6844/6851 DoMovement(timePassed, targetX, targetY, oldIndexX, oldIndexY, parentRelativeX,
 * parentRelativeY, galaxy, manageArrival, manageHeading, manageDeceleration[, out arrived]) → seconds left over.
 */
export function doMovement(
    galaxy: Galaxy,
    bo: BuiltObject,
    timePassed: number,
    targetX: number,
    targetY: number,
    oldIndexX: number,
    oldIndexY: number,
    parentRelativeX: number,
    parentRelativeY: number,
    manageArrival: boolean,
    manageHeading: boolean,
    manageDeceleration: boolean,
    out?: { arrived: boolean },
): number {
    let result = 0.0;
    if (out !== undefined) out.arrived = false;
    relScratch.parentXPos = 0.0;
    relScratch.parentYPos = 0.0;
    relScratch.targetArrivalDistance = 1.0;
    const flag = evaluateRelativeToParent(galaxy, bo, relScratch);
    const parentXPos = relScratch.parentXPos;
    const parentYPos = relScratch.parentYPos;
    let targetArrivalDistance = relScratch.targetArrivalDistance;
    bo.targetSpeed = Math.trunc(bo.preferredSpeed);
    let num: number;
    let num2: number;
    if (flag) {
        num = parentXPos + parentRelativeX;
        num2 = parentYPos + parentRelativeY;
    } else {
        num = targetX;
        num2 = targetY;
    }
    const num3 = bo.currentSpeed * timePassed;
    if (manageHeading) {
        if (flag) {
            bo.angle = f(determineAngle(bo.xpos, bo.ypos, parentXPos + parentRelativeX, parentYPos + parentRelativeY));
        } else {
            bo.angle = f(determineAngle(bo.xpos, bo.ypos, targetX, targetY));
        }
        bo.targetHeading = bo.angle;
    }
    calculateCurrentHeading(galaxy, bo, timePassed);
    let num4: number;
    let targetX2: number;
    let targetY2: number;
    if (flag) {
        if (parentRelativeX !== 0.0 && parentRelativeY !== 0.0) {
            targetArrivalDistance = 1.0;
        }
        num4 = galaxy.calculateDistance(bo.xpos, bo.ypos, parentXPos + parentRelativeX, parentYPos + parentRelativeY);
        targetX2 = parentXPos + parentRelativeX;
        targetY2 = parentYPos + parentRelativeY;
    } else {
        num4 = galaxy.calculateDistance(bo.xpos, bo.ypos, targetX, targetY);
        targetX2 = targetX;
        targetY2 = targetY;
    }
    if (manageDeceleration) {
        checkForDeceleration(bo, num4, num3);
    }
    if (!willMeetDestination(galaxy, bo, num, num2, bo.targetSpeed)) {
        if (bo.targetSpeed > MOVEMENT_IMPULSE_SPEED * 2) {
            bo.targetSpeed = MOVEMENT_IMPULSE_SPEED * 2;
        } else {
            bo.targetSpeed = Math.trunc(bo.targetSpeed / 2);
        }
        if (num4 > 10.0 && bo.targetSpeed < MOVEMENT_IMPULSE_SPEED) {
            bo.targetSpeed = MOVEMENT_IMPULSE_SPEED;
        }
    }
    accelerateToTargetSpeed(galaxy, bo, timePassed);
    let move = true;
    if (manageArrival) {
        if (checkForArrival(galaxy, bo, num4, num3, flag, parentXPos, parentYPos, targetX2, targetY2, targetArrivalDistance)) {
            if (out !== undefined) out.arrived = true;
            const distanceNotTravelled = arrivalOut.distanceNotTravelled;
            result = !(bo.currentSpeed > 0) || !(distanceNotTravelled > 0.0) ? 0.0 : distanceNotTravelled / bo.currentSpeed;
            move = false;
        }
    }
    if (move) {
        consumeFuel(galaxy, bo, timePassed);
        if (flag) {
            bo.parentOffsetX += Math.cos(bo.heading) * num3;
            bo.parentOffsetY += Math.sin(bo.heading) * num3;
            bo.xpos = parentXPos + bo.parentOffsetX;
            bo.ypos = parentYPos + bo.parentOffsetY;
        } else {
            bo.xpos += Math.cos(bo.heading) * num3;
            bo.ypos += Math.sin(bo.heading) * num3;
        }
    }
    checkFuelHandicap(galaxy, bo);
    updateIndexesForMovement(galaxy, bo, oldIndexX, oldIndexY, false);
    if ((num <= -2000000000.0 || num2 <= -2000000000.0) && !bo.executingShipGroupCommand) {
        bo.targetSpeed = 0;
        bo.preferredSpeed = 0;
        clearPreviousMissionRequirements(galaxy, bo);
    }
    return result;
}

/** BaconBuiltObject.cs 4329 UpdatePosition (BuiltObject.2.cs 7158). */
export function updatePosition(galaxy: Galaxy, builtObject: BuiltObject): void {
    const ship = builtObject;
    const nearestSystem = galaxy.fastFindNearestSystem(ship.xpos, ship.ypos);
    if (nearestSystem !== null && galaxy.calculateDistanceSquared(ship.xpos, ship.ypos, nearestSystem.xpos, nearestSystem.ypos) < (MAX_SOLAR_SYSTEM_SIZE + 500.0) * (MAX_SOLAR_SYSTEM_SIZE + 500.0)) {
        ship.nearestSystemStar = nearestSystem;
    }
    updateIndexesForMovement(galaxy, ship, galaxy.resolveIndexX(ship.xpos), galaxy.resolveIndexY(ship.ypos), false);
}

/** BaconBuiltObject.cs 4651 CheckFuelHandicap (BuiltObject.2.cs 6978). */
export function checkFuelHandicap(galaxy: Galaxy, ship: BuiltObject): void {
    if (ship.currentFuel <= 0.0 && ship.currentEnergy <= 0.0) {
        if (ship._fuelHandicapped) return;
        const s = baconMovementSettings;
        ship.topSpeed = toShort(csInt(ship.topSpeed * s.noFuelTopSpeedMultiplier));
        ship.cruiseSpeed = toShort(csInt(ship.cruiseSpeed * s.noFuelCruiseSpeedMultiplier));
        ship.warpSpeed = csInt(ship.warpSpeed * s.noFuelHyperSpeedMultiplier);
        if (ship.nearestSystemStar === null && warpSpeedWithBonuses(ship) > 0) {
            if (ship.currentSpeed > warpSpeedWithBonuses(ship)) ship.currentSpeed = f(warpSpeedWithBonuses(ship));
            if (ship.targetSpeed > warpSpeedWithBonuses(ship)) ship.targetSpeed = warpSpeedWithBonuses(ship);
        } else {
            if (ship.currentSpeed > ship.topSpeed) ship.currentSpeed = ship.topSpeed;
            if (ship.targetSpeed > ship.topSpeed) ship.targetSpeed = ship.topSpeed;
        }
        ship._fuelHandicapped = true;
    } else {
        if (!ship._fuelHandicapped) return;
        ship.reDefine();
        ship._fuelHandicapped = false;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Hyperjump: hyper deny, gravity wells, exits
// ---------------------------------------------------------------------------------------------------------------

/** BuiltObject.1.cs 1737 DetectHyperDeny(galaxy). */
export function detectHyperDeny(galaxy: Galaxy, builtObject: BuiltObject): boolean {
    const bo = builtObject;
    const galaxyLocationList = galaxy.determineGalaxyLocationsAtPoint(bo.xpos, bo.ypos);
    for (let i = 0; i < galaxyLocationList.length; i++) {
        const galaxyLocation = galaxyLocationList[i];
        if (galaxyLocation.effect === GalaxyLocationEffectType.HyperjumpDisabled) {
            // mod layer (19f the Silence): a scenario may exempt this ship from this zone's effect (e.g. pirates).
            if (galaxy.scenario !== null && scenarioQuery(galaxy, 'hyperDenyExempt', false, { builtObject: bo, location: galaxyLocation })) continue;
            bo.hyperjumpDisabledLocation = true;
            return true;
        }
    }
    bo.hyperjumpDisabledLocation = false;
    let num = 1200;
    num += MAX_SOLAR_SYSTEM_SIZE * 2;
    // GetBuiltObjectsAtLocationByArrays: the same cells in the same order as GetBuiltObjectsAtLocation.
    const list = getBuiltObjectsAtLocation(galaxy, bo.xpos, bo.ypos, num);
    for (let k = 0; k < list.length; k++) {
        const builtObject2 = list[k];
        if (builtObject2 != null && builtObject2.hyperDenyActive && checkWithinDistancePotential(builtObject2.weaponHyperDenyRange, bo.xpos, bo.ypos, builtObject2.xpos, builtObject2.ypos)) {
            const num3 = galaxy.calculateDistance(bo.xpos, bo.ypos, builtObject2.xpos, builtObject2.ypos);
            if (builtObject2.weaponHyperDenyRange >= num3) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Galaxy.7.cs 747 CheckWithinDistancePotential(distance, x1, y1, x2, y2): the cheap pre-test before CalculateDistance —
 * the distance is doubled and the axes are ORed (`|dx| < 2d || |dy| < 2d`). The one port; combat/damage.ts re-exports it.
 */
export function checkWithinDistancePotential(distance: number, x1: number, y1: number, x2: number, y2: number): boolean {
    distance += distance;
    return Math.abs(x1 - x2) < distance || Math.abs(y1 - y2) < distance;
}

/** BuiltObject.1.cs 1772 CheckForHyperExitGravityWell(x, y). */
export function checkForHyperExitGravityWell(galaxy: Galaxy, bo: BuiltObject, x: number, y: number): BuiltObject | null {
    const list = getBuiltObjectsAtLocation(galaxy, x, y, 4000);
    for (let j = 0; j < list.length; j++) {
        const builtObject = list[j];
        if (builtObject == null || builtObject.hyperStopRange <= 0 || builtObject.empire === null || builtObject.empire === bo.empire) {
            continue;
        }
        let flag = false;
        if (builtObject.empire.pirateEmpireBaseHabitat !== null) {
            const pirateRelation = obtainPirateRelation(bo.empire!, builtObject.empire);
            if (pirateRelation.type === PirateRelationType.None) {
                flag = true;
            }
        } else {
            const diplomaticRelation = obtainDiplomaticRelation(bo.empire!, builtObject.empire);
            if (diplomaticRelation.type === DiplomaticRelationType.War) {
                flag = true;
            }
        }
        if (flag || (bo.empire !== null && bo.empire.pirateEmpireBaseHabitat !== null)) {
            const num2 = galaxy.calculateDistance(builtObject.xpos, builtObject.ypos, x, y);
            if (num2 < builtObject.hyperStopRange) {
                return builtObject;
            }
        }
    }
    return null;
}

/** BuiltObject.1.cs 1834 CheckForHyperExitGravityWells(ref hyperExitX, ref hyperExitY). */
export function checkForHyperExitGravityWells(galaxy: Galaxy, bo: BuiltObject, exit: { x: number; y: number }): boolean {
    const builtObject = checkForHyperExitGravityWell(galaxy, bo, exit.x, exit.y);
    if (builtObject !== null) {
        const num = determineAngle(builtObject.xpos, builtObject.ypos, exit.x, exit.y);
        exit.x = builtObject.xpos + builtObject.hyperStopRange * Math.cos(num);
        exit.y = builtObject.ypos + builtObject.hyperStopRange * Math.sin(num);
        return true;
    }
    return false;
}

/** `_Galaxy.DoCharacterEvent(HyperjumpExit, this, ShipGroup == null ? Characters : ShipGroup.ObtainCharacters())`. */
export function doHyperjumpExitCharacterEvent(galaxy: Galaxy, ship: BuiltObject): void {
    const shipGroup = shipGroupOf(ship);
    if (shipGroup === null) {
        doCharacterEventRuntime(galaxy, CharacterEventType.HyperjumpExit, ship, ship.characters, false, null);
    } else {
        doCharacterEventRuntime(galaxy, CharacterEventType.HyperjumpExit, ship, shipGroupObtainCharacters(shipGroup), false, null);
    }
}

/** BaconBuiltObject.cs 4627 ExitHyperjump (BuiltObject.2.cs 394; called by the UI when the player stops a jump). */
export function exitHyperjump(galaxy: Galaxy, ship: BuiltObject): void {
    if (ship.warpSpeed <= 0 || ship.currentSpeed <= Math.trunc(ship.warpSpeed / 3)) return;
    ship.hyperjumpJustExited = true;
    ship.hyperExitStartAnimation = true;
    ship.hyperjumpPrepare = false;
    ship.hyperEnterStartAnimation = false;
    const exit = { x: ship.xpos, y: ship.ypos };
    checkForHyperExitGravityWells(galaxy, ship, exit);
    ship.xpos = exit.x;
    ship.ypos = exit.y;
    doHyperjumpExitCharacterEvent(galaxy, ship);
    const nearestSystem = galaxy.fastFindNearestSystem(ship.xpos, ship.ypos);
    if (nearestSystem !== null && galaxy.calculateDistanceSquared(ship.xpos, ship.ypos, nearestSystem.xpos, nearestSystem.ypos) < (MAX_SOLAR_SYSTEM_SIZE + 1000.0) * (MAX_SOLAR_SYSTEM_SIZE + 1000.0)) {
        ship.nearestSystemStar = nearestSystem;
    }
    const actualEmpire = ship.actualEmpire;
    if (actualEmpire !== null) actualEmpire.visibility.resolveSystemVisibilityForUnit(ship, false);
}

/** BaconBuiltObject.cs 2518 GetGravityWellMitigationForHyperDrive (allocation-free walk of the HyperDrive components). */
function getGravityWellMitigationForHyperDrive(ship: BuiltObject): number {
    let mitigationForHyperDrive = 1.0;
    const items = ship.components.items;
    for (let i = 0; i < items.length; i++) {
        const c = items[i];
        if (c.category !== ComponentCategoryType.HyperDrive) continue;
        const num1 = c.value4;
        const num2 = c.value5;
        if (num1 > 0 && num2 > 0) {
            const num3 = num1 / num2;
            if (num3 < mitigationForHyperDrive) mitigationForHyperDrive = num3;
        }
    }
    return mitigationForHyperDrive;
}

/** BaconBuiltObject.cs 3704 GetGravityWellReductionForSmallShip. */
function getGravityWellReductionForSmallShip(ship: BuiltObject): number {
    if (!baconMovementSettings.smallShipsJumpSooner) return 1.0;
    // TODO(port) M4c: the smallShipsJumpSooner branch (race ship-size factors, BaconRace multipliers,
    // Empire.MaximumConstructionSize) — BaconSettings option, off by default.
    void ship;
    throw new Error('TODO(port): BaconBuiltObject.GetGravityWellReductionForSmallShip with smallShipsJumpSooner');
}

/** Galaxy.CalculateDistanceSquaredStatic. */
function distSq(x1: number, y1: number, x2: number, y2: number): number {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return dx * dx + dy * dy;
}

/** The star's gravity-well radius² for this ship (BaconBuiltObject.cs 2515 / 3758). */
function gravityWellRangeSquared(ship: BuiltObject, habitat: Habitat): number {
    const reductionForSmallShip = getGravityWellReductionForSmallShip(ship);
    const mitigationForHyperDrive = getGravityWellMitigationForHyperDrive(ship);
    const num = habitat.solarRadiation + habitat.microwaveRadiation + habitat.xrayRadiation;
    return STAR_GRAVITY_WELL_RANGE_SQUARED * (num / 100.0) * (num / 100.0) * reductionForSmallShip * reductionForSmallShip * mitigationForHyperDrive * mitigationForHyperDrive;
}

/** Squared range IsOutsideStarGravityWell accepts the nearest system star within (BaconBuiltObject.cs 2500). */
const SYSTEM_RANGE_SQUARED = MAX_SOLAR_SYSTEM_SIZE * MAX_SOLAR_SYSTEM_SIZE + 1000000;

interface StarRangeCache {
    grid: readonly unknown[];
    systems: readonly unknown[];
    systemCount: number;
    maxX: number;
    maxY: number;
    /** Per index cell (x * maxY + y): the stars within SYSTEM_RANGE of some point of the cell. */
    cells: Habitat[][];
}
const starRangeCaches = new WeakMap<Galaxy, StarRangeCache>();

function starRangeCache(galaxy: Galaxy): StarRangeCache {
    const grid = galaxy.systemsIndexGrid;
    let cache = starRangeCaches.get(galaxy);
    if (cache !== undefined && cache.grid === grid && cache.systems === galaxy.systems && cache.systemCount === galaxy.systems.length && cache.maxX === galaxy.indexMaxX && cache.maxY === galaxy.indexMaxY) return cache;
    const maxX = galaxy.indexMaxX;
    const maxY = galaxy.indexMaxY;
    const cells: Habitat[][] = Array.from({ length: maxX * maxY }, () => []);
    // Pad the range by 2 so float rounding at cell borders can only add candidates, never drop one.
    const reach = Math.sqrt(SYSTEM_RANGE_SQUARED) + 2;
    for (const system of galaxy.systems) {
        const star = system.systemStar;
        const x0 = Math.max(0, Math.floor((star.xpos - reach) / INDEX_SIZE));
        const x1 = Math.min(maxX - 1, Math.floor((star.xpos + reach) / INDEX_SIZE));
        const y0 = Math.max(0, Math.floor((star.ypos - reach) / INDEX_SIZE));
        const y1 = Math.min(maxY - 1, Math.floor((star.ypos + reach) / INDEX_SIZE));
        for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) cells[cx * maxY + cy].push(star);
    }
    cache = { grid, systems: galaxy.systems, systemCount: galaxy.systems.length, maxX, maxY, cells };
    starRangeCaches.set(galaxy, cache);
    return cache;
}

/**
 * True unless no system star lies within SYSTEM_RANGE of (x, y) (conservative: true also outside the index area or when
 * the index is not built, where the caller runs the full search).
 */
export function anyStarWithinSystemRange(galaxy: Galaxy, x: number, y: number): boolean {
    if (galaxy.systemsIndexGrid.length === 0) return true;
    const cache = starRangeCache(galaxy);
    if (!(x >= 0 && y >= 0 && x < cache.maxX * INDEX_SIZE && y < cache.maxY * INDEX_SIZE)) return true;
    const cell = cache.cells[Math.floor(x / INDEX_SIZE) * cache.maxY + Math.floor(y / INDEX_SIZE)];
    for (const star of cell) {
        if (distSq(x, y, star.xpos, star.ypos) < SYSTEM_RANGE_SQUARED) return true;
    }
    return false;
}

/**
 * BaconBuiltObject.cs 2493 IsOutsideStarGravityWell. BaconBuiltObject.myMain (the UI Main) is set in any running game,
 * so its null checks are taken as not null (as in colonyTick.ts).
 */
export function isOutsideStarGravityWell(galaxy: Galaxy, ship: BuiltObject): boolean {
    let habitat = ship.nearestSystemStar;
    if (habitat === null) {
        // Perf (no behaviour change): the C# result only differs from `true` when some star lies within
        // sqrt(MaxSolarSystemSize² + 1e6) of the ship (the nearest system is then that close too). Ships in hyperspace
        // are almost never that close, so a per-index-cell list of the stars that close to the cell answers "none" without
        // the full FastFindNearestSystem ring search every frame; otherwise the original search runs unchanged.
        if (!anyStarWithinSystemRange(galaxy, ship.xpos, ship.ypos)) return true;
        const nearestSystem = galaxy.fastFindNearestSystem(ship.xpos, ship.ypos);
        if (nearestSystem !== null && distSq(ship.xpos, ship.ypos, nearestSystem.xpos, nearestSystem.ypos) < MAX_SOLAR_SYSTEM_SIZE * MAX_SOLAR_SYSTEM_SIZE + 1000000) {
            habitat = nearestSystem;
        }
        if (habitat === null) return true;
        ship.nearestSystemStar = habitat;
    }
    if (!baconMovementSettings.useStarGravityWells) return true;
    const range = gravityWellRangeSquared(ship, habitat);
    return habitat.category === HabitatCategoryType.GasCloud || distSq(ship.xpos, ship.ypos, habitat.xpos, habitat.ypos) > range;
}

/** BaconBuiltObject.cs 2539 CheckHyperjumpPending (BuiltObject.cs 3543). */
export function checkHyperjumpPending(galaxy: Galaxy, builtObject: BuiltObject): boolean {
    const ship = builtObject;
    const nearestSystemStar = ship.nearestSystemStar;
    const actualEmpire = ship.actualEmpire;
    if (nearestSystemStar !== null && actualEmpire !== null) {
        const sv = actualEmpire.systemVisibility[nearestSystemStar.systemIndex];
        if (sv.status === SystemVisibilityStatus.Unexplored || sv.status === SystemVisibilityStatus.Undefined) {
            sv.status = SystemVisibilityStatus.Visible;
            actualEmpire.visibility.resolveSystemVisibilityForUnit(ship, false);
        }
    }
    const mission = builtObjectMission(ship.mission);
    if (!isOutsideStarGravityWell(galaxy, ship) || mission === null) return false;
    if (mission.type === BuiltObjectMissionType.Escape) return true;
    if (mission.type === BuiltObjectMissionType.Refuel || mission.type === BuiltObjectMissionType.Repair || mission.type === BuiltObjectMissionType.Retrofit) {
        const point = mission.resolveTargetCoordinates(mission);
        const t = baconMovementSettings.hyperJumpThreshhold;
        if (distSq(ship.xpos, ship.ypos, point.x, point.y) > t * t && ship.warpSpeed > 0) return true;
    }
    const command = mission.fastPeekCurrentCommand();
    return command !== null && command.action === CommandAction.HyperTo;
}

/** Fighter fields the carrier-side movement code reads (Fighter.cs; M4p owns the type). */
interface FighterView {
    onboardCarrier: boolean;
    hasBeenDestroyed: boolean;
}

/** BaconBuiltObject.cs 2561 CheckFightersOnboardAndRetrieve. */
export function checkFightersOnboardAndRetrieve(galaxy: Galaxy, ship: BuiltObject): boolean {
    let flag = isOutsideStarGravityWell(galaxy, ship);
    if (!flag || ship.fighters === null || ship.fighters.length <= 0) return flag;
    for (let index = 0; index < ship.fighters.length; ++index) {
        const fighter = ship.fighters[index] as FighterView;
        if (!fighter.onboardCarrier && !fighter.hasBeenDestroyed) {
            flag = false;
            fighterReturnToCarrier(galaxy, fighter);
        }
    }
    return flag;
}

/** HyperTo first execution: recall launched fighters (BuiltObject.2.cs 3051-3061). */
export function returnLaunchedFighters(galaxy: Galaxy, ship: BuiltObject): void {
    if (ship.fighters !== null && ship.fighters.length > 0 && isOutsideStarGravityWell(galaxy, ship)) {
        for (let i = 0; i < ship.fighters.length; i++) {
            const fighter = ship.fighters[i] as FighterView;
            if (!fighter.onboardCarrier && !fighter.hasBeenDestroyed) {
                fighterReturnToCarrier(galaxy, fighter);
            }
        }
    }
}

/** BaconBuiltObject.cs 3775 FindRangeSquaredToTarget. */
function findRangeSquaredToTarget(ship: BuiltObject): number {
    let x2 = 0.0;
    let y2 = 0.0;
    const mission = builtObjectMission(ship.mission);
    if (mission !== null && mission.fastPeekCurrentCommand() !== null) {
        const cmd = mission.fastPeekCurrentCommand()!;
        if (mission.x > -1900010000.0 && mission.y > -1900010000.0 && mission.type === BuiltObjectMissionType.Move && mission.target === null) {
            x2 = mission.x;
            y2 = mission.y;
        } else if (cmd.xpos > -1900010000.0 && cmd.ypos > -1900010000.0) {
            x2 = cmd.xpos;
            y2 = cmd.ypos;
        } else if (mission.targetBuiltObject !== null) {
            x2 = mission.targetBuiltObject.xpos;
            y2 = mission.targetBuiltObject.ypos;
        } else if (mission.targetHabitat !== null) {
            x2 = mission.targetHabitat.xpos;
            y2 = mission.targetHabitat.ypos;
        } else if (mission.targetSector !== null) {
            x2 = mission.targetSector.x;
            y2 = mission.targetSector.y;
        } else if (mission.target !== null) {
            x2 = mission.x;
            y2 = mission.y;
        } else if (mission.targetCreature !== null) {
            x2 = mission.targetCreature.xpos;
            y2 = mission.targetCreature.ypos;
        } else if (mission.secondaryTargetBuiltObject !== null) {
            x2 = mission.secondaryTargetBuiltObject.xpos;
            y2 = mission.secondaryTargetBuiltObject.ypos;
        } else if (mission.secondaryTargetHabitat !== null) {
            x2 = mission.secondaryTargetHabitat.xpos;
            y2 = mission.secondaryTargetHabitat.ypos;
        } else if (mission.secondaryTarget !== null) {
            // `is BuiltObject / Habitat / Creature` (a ship group is none of them: stays 0, 0).
            const st = mission.secondaryTarget as unknown as { xpos?: number; ypos?: number; ships?: unknown };
            if (st.ships === undefined && st.xpos !== undefined && st.ypos !== undefined) {
                x2 = st.xpos;
                y2 = st.ypos;
            }
        } else if (mission.secondaryTargetCreature !== null) {
            x2 = mission.secondaryTargetCreature.xpos;
            y2 = mission.secondaryTargetCreature.ypos;
        }
        // else ++BaconBuiltObject.debugCounter (debug only).
    }
    return distSq(ship.xpos, ship.ypos, x2, y2);
}

/** BaconBuiltObject.cs 3744 ShouldSendShipTowardEdgeOfGravityWell. */
export function shouldSendShipTowardEdgeOfGravityWell(galaxy: Galaxy, ship: BuiltObject | null): boolean {
    return ship !== null && !isOutsideStarGravityWell(galaxy, ship) && ship.mission !== null && findRangeSquaredToTarget(ship) >= STAR_GRAVITY_WELL_RANGE_SQUARED * 1.3999999761581421;
}

/** BaconBuiltObject.cs 3746 SendShipTowardsEdgeOfGravityWell (the C# swallows exceptions; none are reachable here). */
export function sendShipTowardsEdgeOfGravityWell(galaxy: Galaxy, ship: BuiltObject): boolean {
    let flag = false;
    checkIfShouldUseStargateAndReassign(galaxy, ship);
    if (shouldSendShipTowardEdgeOfGravityWell(galaxy, ship)) {
        const nearestSystemStar = ship.nearestSystemStar!;
        const num2 = Math.sqrt(gravityWellRangeSquared(ship, nearestSystemStar));
        const num3 = Math.max(num2 * 1.03, num2 + 1000.0);
        const angle = determineAngle(ship.xpos, ship.ypos, nearestSystemStar.xpos, nearestSystemStar.ypos);
        const x = nearestSystemStar.xpos + num3 * Math.cos(angle + PI);
        const y = nearestSystemStar.ypos + num3 * Math.sin(angle + PI);
        const mission = builtObjectMission(ship.mission);
        if (mission !== null) mission.insertCommandAtTop(Command.at(CommandAction.MoveTo, x, y));
        flag = true;
    }
    return flag;
}

/**
 * BaconBuiltObject.cs 4338 CheckIfShouldUseStargateAndReassign: returns at once unless BaconMain.useStargates (off by
 * default) and the ship's empire name starts with "Romulan".
 */
function checkIfShouldUseStargateAndReassign(galaxy: Galaxy, ship: BuiltObject): void {
    if (ship.mission === null || !baconMovementSettings.useStargates || !ship.actualEmpire!.name.startsWith('Romulan')) return;
    // TODO(port) M4c: stargate teleport (BaconBuiltObject.cs 4285 TeleportToSystem, 4394/4433 reassign, 4497
    // FindMissionTargetXY; BaconGalaxy.FastFindNearestColonyAnyEmpire) — Bacon option, off by default.
    void galaxy;
    throw new Error('TODO(port): BaconBuiltObject stargates (useStargates)');
}

// ---------------------------------------------------------------------------------------------------------------
// Fuel ranges (BuiltObject.1.cs 2310-2507)
// ---------------------------------------------------------------------------------------------------------------

/** BuiltObject.1.cs 2338 FuelUnitPerEnergyUnit. */
export function fuelUnitPerEnergyUnit(builtObject: BuiltObject): number {
    return builtObject.reactorCycleFuelConsumption / 1000.0 / (builtObject.reactorStorageCapacity + 1.0);
}

/** BuiltObject.1.cs 2310 ReducedRange(fuelReservePortion). */
export function reducedRange(bo: BuiltObject, fuelReservePortion: number): number {
    const num = fuelUnitPerEnergyUnit(bo);
    if (bo.warpSpeed > 0) {
        return (Math.max(0.0, bo.currentFuel - bo.fuelCapacity * fuelReservePortion) / ((bo.warpSpeedFuelBurn + bo.staticEnergyConsumption) * num)) * warpSpeedWithBonuses(bo);
    }
    return (Math.max(0.0, bo.currentFuel - bo.fuelCapacity * fuelReservePortion) / ((bo.cruiseSpeedFuelBurn + bo.staticEnergyConsumption) * num)) * bo.cruiseSpeed;
}

/** BuiltObject.1.cs 2325 WithinReducedFuelRange(destinationX, destinationY, fuelReservePortion). */
export function withinReducedFuelRange(galaxy: Galaxy, bo: BuiltObject, destinationX: number, destinationY: number, fuelReservePortion: number): boolean {
    const num = reducedRange(bo, fuelReservePortion);
    const num2 = num * num;
    const num3 = galaxy.calculateDistanceSquared(bo.xpos, bo.ypos, destinationX, destinationY);
    return num3 <= num2;
}

/** BuiltObject.1.cs 2343/2348 CurrentRange([fuelPortionMargin]). */
export function currentRange(builtObject: BuiltObject, fuelPortionMargin = 0.0): number {
    const num = fuelUnitPerEnergyUnit(builtObject);
    let currentFuel = builtObject.currentFuel;
    currentFuel -= builtObject.fuelCapacity * fuelPortionMargin;
    currentFuel = Math.max(0.0, currentFuel);
    if (builtObject.warpSpeed > 0) {
        return (currentFuel / ((builtObject.warpSpeedFuelBurn + builtObject.staticEnergyConsumption) * num)) * warpSpeedWithBonuses(builtObject);
    }
    return (currentFuel / ((builtObject.cruiseSpeedFuelBurn + builtObject.staticEnergyConsumption) * num)) * builtObject.cruiseSpeed;
}

/** BuiltObject.1.cs 2362 MaximumFuelRange. */
export function maximumFuelRange(bo: BuiltObject): number {
    const num = fuelUnitPerEnergyUnit(bo);
    if (bo.warpSpeed > 0) {
        return (bo.fuelCapacity / ((bo.warpSpeedFuelBurn + bo.staticEnergyConsumption) * num)) * warpSpeedWithBonuses(bo);
    }
    return (bo.fuelCapacity / ((bo.cruiseSpeedFuelBurn + bo.staticEnergyConsumption) * num)) * bo.cruiseSpeed;
}

/** BuiltObject.1.cs 2379 WithinFuelRange(destinationX, destinationY, fuelPortionMargin, out rangeFactor). */
export function withinFuelRangeWithFactor(galaxy: Galaxy, builtObject: BuiltObject, destinationX: number, destinationY: number, fuelPortionMargin: number): { within: boolean; rangeFactor: number } {
    const num = currentRange(builtObject, fuelPortionMargin);
    const num2 = num * num;
    const num3 = galaxy.calculateDistanceSquared(builtObject.xpos, builtObject.ypos, destinationX, destinationY);
    const rangeFactor = num3 / num2;
    return { within: num3 <= num2, rangeFactor };
}

/** BuiltObject.1.cs 2373 WithinFuelRange(destinationX, destinationY, fuelPortionMargin). */
export function withinFuelRange(galaxy: Galaxy, builtObject: BuiltObject, destinationX: number, destinationY: number, fuelPortionMargin: number): boolean {
    const num = currentRange(builtObject, fuelPortionMargin);
    const num2 = num * num;
    const num3 = galaxy.calculateDistanceSquared(builtObject.xpos, builtObject.ypos, destinationX, destinationY);
    return num3 <= num2;
}

/** BuiltObject.1.cs 2391 WithinFuelRangeSupplyingCurrentRange(destinationX, destinationY, currentRange, fuelPortionMargin). */
export function withinFuelRangeSupplyingCurrentRange(galaxy: Galaxy, bo: BuiltObject, destinationX: number, destinationY: number, range: number, fuelPortionMargin: number): boolean {
    range -= range * fuelPortionMargin;
    const num = range * range;
    const num2 = galaxy.calculateDistanceSquared(bo.xpos, bo.ypos, destinationX, destinationY);
    return num2 <= num;
}

/** A Resource with its SortTag (the ResourceList entries of the fuel-margin / refuel code). */
export interface FuelTypeRef {
    resourceId: number;
    sortTag: number;
}

/** BuiltObject.1.cs 2409 CalculateFuelPortionMarginFromNearbyRefuellingPointsInformLocation(x, y, out refuellingLocation). */
export function calculateFuelPortionMarginFromNearbyRefuellingPointsInformLocation(galaxy: Galaxy, bo: BuiltObject, x: number, y: number): { margin: number; refuellingLocation: StellarObject | null } {
    const resourceList: FuelTypeRef[] = [];
    const fuelType = bo.fuelType;
    if (fuelType !== null) {
        resourceList.push({ resourceId: fuelType.resourceId, sortTag: bo.fuelCapacity - bo.currentFuel });
    }
    let includeResupplyShips = false;
    if (bo.role === BuiltObjectRole.Military) {
        includeResupplyShips = true;
    }
    let refuellingLocation: StellarObject | null;
    if (bo.empire !== null) {
        refuellingLocation = ultraFastFindNearestRefuellingLocation(galaxy, bo.empire, x, y, resourceList, bo, false, includeResupplyShips);
    } else {
        refuellingLocation = fastFindNearestRefuellingPoint(galaxy, x, y, resourceList, bo.empire, bo, includeResupplyShips, null);
    }
    if (checkRefuelLocationRangeAcceptable(galaxy, bo, refuellingLocation)) {
        return { margin: calculateFuelPortionMarginFromRefuellingPoint(galaxy, bo, x, y, refuellingLocation), refuellingLocation };
    }
    return { margin: 0.0, refuellingLocation };
}

/** BuiltObject.1.cs 2403 CalculateFuelPortionMarginFromNearbyRefuellingPoints(x, y). */
export function calculateFuelPortionMarginFromNearbyRefuellingPoints(galaxy: Galaxy, bo: BuiltObject, x: number, y: number): number {
    return calculateFuelPortionMarginFromNearbyRefuellingPointsInformLocation(galaxy, bo, x, y).margin;
}

/** BuiltObject.1.cs 2439 CalculateFuelPortionMarginFromNearbyRefuellingPoints(x, y, refuellingPoint). */
export function calculateFuelPortionMarginFromRefuellingPoint(galaxy: Galaxy, bo: BuiltObject, x: number, y: number, refuellingPoint: StellarObject | null): number {
    let num = 0.0;
    if (refuellingPoint !== null) {
        num = galaxy.calculateDistance(x, y, refuellingPoint.xpos, refuellingPoint.ypos);
    }
    const num2 = maximumFuelRange(bo);
    return num / num2;
}

/** BuiltObject.1.cs 2450 CalculateRefuellingPortion(refuellingLocation). */
export function calculateRefuellingPortionAt(galaxy: Galaxy, bo: BuiltObject, refuellingLocation: StellarObject | null): number {
    let val = calculateFuelPortionMarginFromRefuellingPoint(galaxy, bo, bo.xpos, bo.ypos, refuellingLocation);
    if (isAiControlled(bo)) {
        return Math.max(0.05, val);
    }
    val = Math.max(0.05, val);
    return Math.min(0.5, val);
}

/** BuiltObject.1.cs 2461/2467 CalculateRefuellingPortion([out refuellingLocation]). */
export function calculateRefuellingPortion(galaxy: Galaxy, bo: BuiltObject): { portion: number; refuellingLocation: StellarObject | null } {
    const r = calculateFuelPortionMarginFromNearbyRefuellingPointsInformLocation(galaxy, bo, bo.xpos, bo.ypos);
    let val = r.margin;
    if (isAiControlled(bo)) {
        return { portion: Math.max(0.05, val), refuellingLocation: r.refuellingLocation };
    }
    val = Math.max(0.05, val);
    return { portion: Math.min(0.5, val), refuellingLocation: r.refuellingLocation };
}

/** BuiltObject.1.cs 2479 WithinFuelRangeAndRefuel(destinationX, destinationY, extraFuelPortionMargin). */
export function withinFuelRangeAndRefuel(galaxy: Galaxy, builtObject: BuiltObject, destinationX: number, destinationY: number, extraFuelPortionMargin: number): boolean {
    const range = currentRange(builtObject);
    if (withinFuelRangeSupplyingCurrentRange(galaxy, builtObject, destinationX, destinationY, range, extraFuelPortionMargin)) {
        const num = calculateFuelPortionMarginFromNearbyRefuellingPoints(galaxy, builtObject, destinationX, destinationY);
        return withinFuelRangeSupplyingCurrentRange(galaxy, builtObject, destinationX, destinationY, range, num + extraFuelPortionMargin);
    }
    return false;
}

/** BuiltObject.1.cs 2490 WithinFuelRangeAndRefuel(destinationX, destinationY, extraFuelPortionMargin, refuellingPoint). */
export function withinFuelRangeAndRefuelAt(galaxy: Galaxy, bo: BuiltObject, destinationX: number, destinationY: number, extraFuelPortionMargin: number, refuellingPoint: StellarObject | null): boolean {
    const num = calculateFuelPortionMarginFromRefuellingPoint(galaxy, bo, destinationX, destinationY, refuellingPoint);
    return withinFuelRange(galaxy, bo, destinationX, destinationY, num + extraFuelPortionMargin);
}

/** BuiltObject.1.cs 2496 DistanceWithinRange(startX, startY, endX, endY, extraFuelPortionMargin). */
export function distanceWithinRange(galaxy: Galaxy, bo: BuiltObject, startX: number, startY: number, endX: number, endY: number, extraFuelPortionMargin: number): boolean {
    let num = maximumFuelRange(bo);
    num -= num * extraFuelPortionMargin;
    num *= num;
    const num2 = galaxy.calculateDistanceSquared(startX, startY, endX, endY);
    return num2 <= num;
}

/** BuiltObject.cs 4856 CheckRefuelLocationRangeAcceptable(refuellingLocation). */
export function checkRefuelLocationRangeAcceptable(galaxy: Galaxy, bo: BuiltObject, refuellingLocation: StellarObject | null): boolean {
    if (refuellingLocation !== null) {
        if (bo.warpSpeed <= 0) {
            const r = withinFuelRangeWithFactor(galaxy, bo, refuellingLocation.xpos, refuellingLocation.ypos, 0.0);
            if (!r.within && r.rangeFactor > 1.2) {
                const num = galaxy.calculateDistanceSquared(bo.xpos, bo.ypos, refuellingLocation.xpos, refuellingLocation.ypos);
                if (num > 2304000000.0) {
                    return false;
                }
            }
        } else if (bo.warpSpeed < 2500) {
            const r2 = withinFuelRangeWithFactor(galaxy, bo, refuellingLocation.xpos, refuellingLocation.ypos, 0.0);
            if (!r2.within && r2.rangeFactor > 2.0 && bo.nearestSystemStar !== null) {
                const num2 = galaxy.calculateDistanceSquared(bo.xpos, bo.ypos, refuellingLocation.xpos, refuellingLocation.ypos);
                if (num2 > 2304000000.0) {
                    return false;
                }
            }
        }
    }
    return true;
}

/** BuiltObjectList.cs 348 GetNearestBuiltObjectWithinRange(x, y, fuelPortionMargin, mustBeAvailable, out index). */
export function getNearestBuiltObjectWithinRange(galaxy: Galaxy, list: BuiltObject[], x: number, y: number, fuelPortionMargin: number, mustBeAvailable: boolean): BuiltObject | null {
    let result: BuiltObject | null = null;
    let num = Number.MAX_VALUE;
    for (let i = 0; i < list.length; i++) {
        const builtObject = list[i];
        if (builtObject == null) continue;
        const num2 = galaxy.calculateDistanceSquared(x, y, builtObject.xpos, builtObject.ypos);
        const num3 = currentRange(builtObject, fuelPortionMargin);
        const num4 = num3 * num3;
        if (num2 <= num4 && num2 < num && (!mustBeAvailable || missionIsIdle(builtObject))) {
            num = num2;
            result = builtObject;
        }
    }
    return result;
}

function missionIsIdle(bo: BuiltObject): boolean {
    const mission = builtObjectMission(bo.mission);
    return mission === null || mission.type === BuiltObjectMissionType.Undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// Refuelling-point search (Galaxy.6.cs 3027-3530, Empire.6.cs 3737)
// ---------------------------------------------------------------------------------------------------------------

function isBuiltObjectLocation(o: StellarObject): o is BuiltObject {
    return 'builtObjectID' in o;
}

function dockingBayCount(o: StellarObject): number {
    const bays = (o as { dockingBays?: unknown[] | null }).dockingBays;
    return bays == null ? -1 : bays.length;
}

/** Galaxy.6.cs 3027 CheckEmpireCanRefuelAtEmpire(shipToRefuel, empire, refuelingEmpire). */
export function checkEmpireCanRefuelAtEmpire(galaxy: Galaxy, shipToRefuel: BuiltObject | null, empire: Empire | null, refuelingEmpire: Empire | null): boolean {
    if (shipToRefuel === null) {
        return false;
    }
    if (shipToRefuel.role === BuiltObjectRole.Military) {
        if (empire === null || refuelingEmpire === null) return true;
        if (empire === refuelingEmpire) return true;
        if (empire === galaxy.independentEmpire) return true;
        if (refuelingEmpire === galaxy.independentEmpire) return true;
        if (empire.pirateEmpireBaseHabitat !== null) {
            return refuelingEmpire === empire || refuelingEmpire === galaxy.independentEmpire;
        }
        if (refuelingEmpire.pirateEmpireBaseHabitat !== null) {
            return empire === refuelingEmpire;
        }
        if (refuelingEmpire.policy !== null) {
            return obtainDiplomaticRelation(refuelingEmpire, empire)?.militaryRefuelingToOther ?? false;
        }
    }
    return true;
}

/** Galaxy.6.cs 3488 CheckSufficientFuelAvailable(fuellingEmpire, fuelTypes, fuelLocation, locationEmpire). */
export function checkSufficientFuelAvailable(galaxy: Galaxy, fuellingEmpire: Empire | null, fuelTypes: readonly FuelTypeRef[] | null, fuelLocation: BuiltObject | Habitat | null, locationEmpire: Empire | null): boolean {
    let result = true;
    if (fuelTypes !== null && fuelTypes.length > 0 && fuelLocation !== null && locationEmpire !== null) {
        result = false;
        for (let i = 0; i < fuelTypes.length; i++) {
            const resource = fuelTypes[i];
            if (resource == null) continue;
            let num = -1;
            if (fuelLocation.cargo !== null) {
                num = cargoIndexOf(fuelLocation.cargo, resource.resourceId, locationEmpire);
            }
            if (num < 0) continue;
            let num2 = cargoAvailable(fuelLocation.cargo!.items[num]);
            if (fuellingEmpire !== fuelLocation.empire) {
                let num3 = 0;
                if (isBuiltObjectLocation(fuelLocation)) {
                    num3 = calculateResourceLevelBuiltObject(galaxy, resource.resourceId, fuelLocation);
                } else {
                    num3 = calculateResourceLevelHabitat(galaxy, resource.resourceId, fuelLocation, false, false);
                }
                num2 -= num3;
            }
            if (num2 >= csInt(resource.sortTag)) {
                result = true;
                continue;
            }
            result = false;
            break;
        }
    }
    return result;
}

/** HabitatResourceList.ContainsId / IndexOf(resourceId, 0) >= 0. */
function habitatHasResource(habitat: Habitat, resourceId: number): boolean {
    for (let i = 0; i < habitat.resources.length; i++) {
        if (habitat.resources[i].resourceId === resourceId) return true;
    }
    return false;
}

/** Galaxy.6.cs 3446 CheckFuelSuppliedAtLocation(fuelTypes, builtObject, refuellingEmpire, mustHaveActualSupply). */
export function checkFuelSuppliedAtLocation(galaxy: Galaxy, fuelTypes: readonly FuelTypeRef[], builtObject: BuiltObject, refuellingEmpire: Empire, mustHaveActualSupply: boolean): boolean {
    let result = true;
    if (mustHaveActualSupply) {
        result = checkSufficientFuelAvailable(galaxy, refuellingEmpire, fuelTypes, builtObject, builtObject.actualEmpire);
    } else if (builtObject.subRole === BuiltObjectSubRole.GasMiningStation && builtObject.isResourceExtractor) {
        if (builtObject.parentHabitat !== null && builtObject.parentHabitat.resources !== null) {
            for (let i = 0; i < fuelTypes.length; i++) {
                if (!habitatHasResource(builtObject.parentHabitat, fuelTypes[i].resourceId)) {
                    result = false;
                    break;
                }
            }
        }
    } else if (
        refuellingEmpire.pirateEmpireBaseHabitat !== null &&
        (builtObject.subRole === BuiltObjectSubRole.SmallSpacePort || builtObject.subRole === BuiltObjectSubRole.MediumSpacePort || builtObject.subRole === BuiltObjectSubRole.LargeSpacePort) &&
        builtObject.isResourceExtractor &&
        builtObject.parentHabitat !== null &&
        builtObject.parentHabitat.resources !== null
    ) {
        let flag = true;
        for (let j = 0; j < fuelTypes.length; j++) {
            if (!habitatHasResource(builtObject.parentHabitat, fuelTypes[j].resourceId)) {
                flag = false;
                break;
            }
        }
        result = flag || checkSufficientFuelAvailable(galaxy, refuellingEmpire, fuelTypes, builtObject, builtObject.actualEmpire);
    } else {
        result = checkSufficientFuelAvailable(galaxy, refuellingEmpire, fuelTypes, builtObject, builtObject.actualEmpire);
    }
    return result;
}

/** Galaxy.6.cs 4626 SortStellarObjectsByDistanceThreadsafe: Array.Sort(keys, items) — .NET introsort on the keys. */
export function sortStellarObjectsByDistance<T extends { xpos: number; ypos: number }>(galaxy: Galaxy, x: number, y: number, stellarObjects: readonly T[]): T[] {
    const n = stellarObjects.length;
    const keys = new Array<number>(n);
    const items = stellarObjects.slice();
    for (let i = 0; i < n; i++) keys[i] = galaxy.calculateDistanceSquared(x, y, items[i].xpos, items[i].ypos);
    arraySortKeysItems(keys, items);
    return items;
}

// .NET ArraySortHelper<TKey, TValue>.IntrospectiveSort over parallel keys/items (Array.Sort(keys, items)) — the
// key/value twin of netSort.ts. Keys are finite doubles (Comparer<double>.Default ordering).
export function arraySortKeysItems<T>(keys: number[], items: T[]): void {
    if (keys.length > 1) {
        kvIntroSort(keys, items, 0, keys.length - 1, 2 * (31 - Math.clz32(keys.length) + 1));
    }
}
function kvSwapIfGreater<T>(keys: number[], items: T[], i: number, j: number): void {
    if (keys[i] > keys[j]) kvSwap(keys, items, i, j);
}
function kvSwap<T>(keys: number[], items: T[], i: number, j: number): void {
    const k = keys[i];
    keys[i] = keys[j];
    keys[j] = k;
    const v = items[i];
    items[i] = items[j];
    items[j] = v;
}
function kvIntroSort<T>(keys: number[], items: T[], lo: number, hi: number, depthLimit: number): void {
    while (hi > lo) {
        const partitionSize = hi - lo + 1;
        if (partitionSize <= 16) {
            if (partitionSize === 1) return;
            if (partitionSize === 2) {
                kvSwapIfGreater(keys, items, lo, hi);
                return;
            }
            if (partitionSize === 3) {
                kvSwapIfGreater(keys, items, lo, hi - 1);
                kvSwapIfGreater(keys, items, lo, hi);
                kvSwapIfGreater(keys, items, hi - 1, hi);
                return;
            }
            kvInsertionSort(keys, items, lo, hi);
            return;
        }
        if (depthLimit === 0) {
            kvHeapSort(keys, items, lo, hi);
            return;
        }
        depthLimit--;
        const p = kvPickPivotAndPartition(keys, items, lo, hi);
        kvIntroSort(keys, items, p + 1, hi, depthLimit);
        hi = p - 1;
    }
}
function kvPickPivotAndPartition<T>(keys: number[], items: T[], lo: number, hi: number): number {
    const middle = lo + ((hi - lo) >> 1);
    kvSwapIfGreater(keys, items, lo, middle);
    kvSwapIfGreater(keys, items, lo, hi);
    kvSwapIfGreater(keys, items, middle, hi);
    const pivot = keys[middle];
    kvSwap(keys, items, middle, hi - 1);
    let left = lo;
    let right = hi - 1;
    while (left < right) {
        while (keys[++left] < pivot);
        while (pivot < keys[--right]);
        if (left >= right) break;
        kvSwap(keys, items, left, right);
    }
    if (left !== hi - 1) kvSwap(keys, items, left, hi - 1);
    return left;
}
function kvHeapSort<T>(keys: number[], items: T[], lo: number, hi: number): void {
    const n = hi - lo + 1;
    for (let i = n >> 1; i >= 1; i--) kvDownHeap(keys, items, i, n, lo);
    for (let i = n; i > 1; i--) {
        kvSwap(keys, items, lo, lo + i - 1);
        kvDownHeap(keys, items, 1, i - 1, lo);
    }
}
function kvDownHeap<T>(keys: number[], items: T[], i: number, n: number, lo: number): void {
    const d = keys[lo + i - 1];
    const dv = items[lo + i - 1];
    while (i <= n >> 1) {
        let child = 2 * i;
        if (child < n && keys[lo + child - 1] < keys[lo + child]) child++;
        if (!(d < keys[lo + child - 1])) break;
        keys[lo + i - 1] = keys[lo + child - 1];
        items[lo + i - 1] = items[lo + child - 1];
        i = child;
    }
    keys[lo + i - 1] = d;
    items[lo + i - 1] = dv;
}
function kvInsertionSort<T>(keys: number[], items: T[], lo: number, hi: number): void {
    for (let i = lo; i < hi; i++) {
        let j = i;
        const t = keys[i + 1];
        const tv = items[i + 1];
        while (j >= lo && t < keys[j]) {
            keys[j + 1] = keys[j];
            items[j + 1] = items[j];
            j--;
        }
        keys[j + 1] = t;
        items[j + 1] = tv;
    }
}

/** Empire.6.cs 3727/3732/3737 UltraFastFindNearestRefuellingLocation(x, y, fuelTypes, shipToRefuel, mustHaveActualSupply[, includeResupplyShips[, shipsToRefuel]]). */
export function ultraFastFindNearestRefuellingLocation(
    galaxy: Galaxy,
    empire: Empire,
    x: number,
    y: number,
    fuelTypes: readonly FuelTypeRef[],
    shipToRefuel: BuiltObject | null,
    mustHaveActualSupply: boolean,
    includeResupplyShips = false,
    shipsToRefuel = 1,
): StellarObject | null {
    let result: StellarObject | null = null;
    let num = Number.MAX_VALUE;
    const num2 = 50;
    let stellarObject: StellarObject | null = null;
    if (includeResupplyShips) {
        const array = sortStellarObjectsByDistance(galaxy, x, y, empire.refuellingLocationsMilitaryOnly);
        for (let i = 0; i < array.length; i++) {
            const stellarObject2 = array[i];
            if (stellarObject2 == null || !isBuiltObjectLocation(stellarObject2)) continue;
            const builtObject = stellarObject2;
            if (checkFuelSuppliedAtLocation(galaxy, fuelTypes, builtObject, empire, mustHaveActualSupply)) {
                if (builtObject.dockingBayWaitQueue !== null && builtObject.dockingBayWaitQueue.length < num2 && builtObject.dockingBays !== null && builtObject.dockingBays.length > 0) {
                    result = builtObject;
                    num = galaxy.calculateDistance(x, y, builtObject.xpos, builtObject.ypos);
                    break;
                }
                if (stellarObject === null) stellarObject = builtObject;
            }
        }
    }
    const array2 = sortStellarObjectsByDistance(galaxy, x, y, empire.refuellingLocations);
    for (let j = 0; j < array2.length; j++) {
        const stellarObject3 = array2[j];
        if (stellarObject3 == null || !checkEmpireCanRefuelAtEmpire(galaxy, shipToRefuel, empire, stellarObject3.empire as Empire | null)) continue;
        if (isBuiltObjectLocation(stellarObject3)) {
            const builtObject2 = stellarObject3;
            if (!checkFuelSuppliedAtLocation(galaxy, fuelTypes, builtObject2, empire, mustHaveActualSupply)) continue;
            let flag = false;
            if (shipsToRefuel <= 1) {
                if ((builtObject2.dockingBays !== null && builtObject2.dockingBays.length >= 4) || (builtObject2.dockingBayWaitQueue !== null && builtObject2.dockingBayWaitQueue.length <= 3)) flag = true;
            } else if (builtObject2.dockingBays !== null && builtObject2.dockingBays.length >= 4) {
                flag = true;
            }
            if (!flag) continue;
            if (builtObject2.dockingBayWaitQueue !== null && builtObject2.dockingBayWaitQueue.length < num2 && builtObject2.dockingBays !== null && builtObject2.dockingBays.length > 0) {
                const num3 = galaxy.calculateDistance(x, y, builtObject2.xpos, builtObject2.ypos);
                if (num3 < num) return builtObject2;
                return result;
            }
            if (stellarObject === null) stellarObject = builtObject2;
        } else {
            const habitat = stellarObject3;
            if (!checkEmpireCanRefuelAtEmpire(galaxy, shipToRefuel, empire, habitat.empire) || !checkSufficientFuelAvailable(galaxy, empire, fuelTypes, habitat, habitat.empire)) continue;
            if (habitat.dockingBayWaitQueue !== null && habitat.dockingBayWaitQueue.length < num2) {
                const num4 = galaxy.calculateDistance(x, y, habitat.xpos, habitat.ypos);
                if (num4 < num) return habitat;
                return result;
            }
            if (stellarObject === null) stellarObject = habitat;
        }
    }
    if (stellarObject !== null) return stellarObject;
    return null;
}

type IndexEdges = { d: number; nx: number; ny: number };
/** Galaxy.7.cs DetermineClosestIndexEdges (private in galaxy.ts; the same function its ring search uses). */
function closestIndexEdges(galaxy: Galaxy, x: number, y: number, l: number, r: number, t: number, b: number): IndexEdges {
    return (galaxy as unknown as { determineClosestIndexEdges(x: number, y: number, l: number, r: number, t: number, b: number): IndexEdges }).determineClosestIndexEdges(x, y, l, r, t, b);
}

/**
 * Galaxy.6.cs 3075/3080/3085 FastFindNearestRefuellingPoint(x, y, fuelTypes, empire, shipToRefuel[, includeResupplyShips,
 * empireToExclude[, shipsToRefuel]]). The ring loop is Galaxy.7.cs DetermineSectorBoundaries 2513 +
 * BuildIndexListForSearching 2603 (as galaxy.ts ringSearch) with this search's own nearest-distance bookkeeping.
 */
export function fastFindNearestRefuellingPoint(
    galaxy: Galaxy,
    x: number,
    y: number,
    fuelTypes: readonly FuelTypeRef[],
    empire: Empire | null,
    shipToRefuel: BuiltObject | null,
    includeResupplyShips = false,
    empireToExclude: Empire | null = null,
    shipsToRefuel = 1,
): StellarObject | null {
    let num = Number.MAX_VALUE;
    let stellarObject: StellarObject | null = null;
    if (includeResupplyShips && empire !== null) {
        let num2 = Number.MAX_VALUE;
        for (let i = 0; i < empire.resupplyShips.length; i++) {
            const builtObject = empire.resupplyShips[i] as BuiltObject;
            if (builtObject.isFunctional && builtObject.isDeployed) {
                const num3 = galaxy.calculateDistanceSquared(x, y, builtObject.xpos, builtObject.ypos);
                if (num3 < num2 && checkSufficientFuelAvailable(galaxy, empire, fuelTypes, builtObject, builtObject.actualEmpire)) {
                    num2 = num3;
                    stellarObject = builtObject;
                }
            }
        }
        for (let j = 0; j < empire.refuellingDepots.length; j++) {
            const builtObject2 = empire.refuellingDepots[j] as BuiltObject;
            if ((builtObject2.subRole !== BuiltObjectSubRole.ResupplyShip || builtObject2.isDeployed) && builtObject2.parentHabitat === null && builtObject2.isFunctional) {
                const num4 = galaxy.calculateDistanceSquared(x, y, builtObject2.xpos, builtObject2.ypos);
                if (num4 < num2 && checkSufficientFuelAvailable(galaxy, empire, fuelTypes, builtObject2, builtObject2.actualEmpire)) {
                    num2 = num4;
                    stellarObject = builtObject2;
                }
            }
        }
        if (stellarObject !== null) {
            num = Math.sqrt(num2);
        }
    }
    const ix = Math.trunc(x);
    const iy = Math.trunc(y);
    const start = galaxy.resolveIndex(ix, iy);
    let l = start.x;
    let r = start.x;
    let t = start.y;
    let b = start.y;
    const indexMaxX = galaxy.indexMaxX;
    const indexMaxY = galaxy.indexMaxY;
    let num5 = 0;
    let num6 = 0;
    let iterationCount = 0;
    const dist = { value: 0 };
    const visit = (cx: number, cy: number): void => {
        // C# indexes the jagged arrays directly; -1 rows/cols never occur because both edges always move later.
        if (cx < 0 || cy < 0 || cx >= indexMaxX || cy >= indexMaxY) return;
        const stellarObject2 = fastFindNearestRefuellingPointInIndex(galaxy, ix, iy, cx, cy, dist, fuelTypes, empire, shipToRefuel, empireToExclude, shipsToRefuel, num);
        const distance = dist.value;
        if (!(distance < num)) return;
        if (shipsToRefuel <= 1) {
            stellarObject = stellarObject2;
            num = distance;
        } else if (stellarObject !== null && dockingBayCount(stellarObject) >= 4) {
            if (stellarObject2 !== null && dockingBayCount(stellarObject2) >= 4) {
                stellarObject = stellarObject2;
                num = distance;
            }
        } else {
            stellarObject = stellarObject2;
            num = distance;
        }
    };
    while (iterationCount < 10000 && (iterationCount++, num > num6)) {
        // DetermineSectorBoundaries
        let e = closestIndexEdges(galaxy, ix, iy, l, r, t, b);
        let row = -1;
        let col = -1;
        if (num5 === 0) {
            row = t;
            col = l;
            num6 = e.d;
        } else {
            if (e.nx === -1) {
                l--;
                if (l < 0) {
                    r++;
                    l = 0;
                    if (r > indexMaxX - 1) r = indexMaxX - 1;
                    col = r;
                } else col = l;
            } else if (e.nx === 1) {
                r++;
                if (r > indexMaxX - 1) {
                    l--;
                    r = indexMaxX - 1;
                    if (l < 0) l = 0;
                    col = l;
                } else col = r;
            }
            if (e.ny === -1) {
                t--;
                if (t < 0) {
                    b++;
                    t = 0;
                    if (b > indexMaxY - 1) b = indexMaxY - 1;
                    row = b;
                } else row = t;
            } else if (e.ny === 1) {
                b++;
                if (b > indexMaxY - 1) {
                    t--;
                    b = indexMaxY - 1;
                    if (t < 0) t = 0;
                    row = t;
                } else row = b;
            }
            e = closestIndexEdges(galaxy, ix, iy, l, r, t, b);
            num6 = e.d;
        }
        // BuildIndexListForSearching: the row cells, then the column cells (without the row's).
        for (let i = l; i <= r; i++) visit(i, row);
        for (let j = t; j <= b; j++) if (j !== row) visit(col, j);
        num5++;
        if (num5 > indexMaxX) break;
    }
    return stellarObject;
}

/** Galaxy.6.cs 3309 FastFindNearestRefuellingPointInIndex(x, y, index, out distance, ...). */
function fastFindNearestRefuellingPointInIndex(
    galaxy: Galaxy,
    x: number,
    y: number,
    indexX: number,
    indexY: number,
    distanceOut: { value: number },
    fuelTypes: readonly FuelTypeRef[],
    empire: Empire | null,
    shipToRefuel: BuiltObject | null,
    empireToExclude: Empire | null,
    shipsToRefuel: number,
    nearestDistance: number,
): StellarObject | null {
    let stellarObject: StellarObject | null = null;
    let distance = Number.MAX_VALUE;
    let num = Math.min(Number.MAX_VALUE, nearestDistance * nearestDistance);
    const systemInfoList = galaxy.systemsIndexGrid[indexX][indexY];
    for (let i = 0; i < systemInfoList.length; i++) {
        const systemInfo = systemInfoList[i];
        let systemVisibilityStatus = SystemVisibilityStatus.Visible;
        if (empire !== null && empire !== galaxy.independentEmpire) {
            systemVisibilityStatus = empire.visibility.checkSystemVisibilityStatus(systemInfo.systemStar.systemIndex);
        }
        if (systemVisibilityStatus !== SystemVisibilityStatus.Explored && systemVisibilityStatus !== SystemVisibilityStatus.Visible) continue;
        const num2 = galaxy.calculateDistanceSquared(x, y, systemInfo.systemStar.xpos, systemInfo.systemStar.ypos);
        if (!(num2 < num) && !(num2 < 2500000000.0)) continue;
        const star = systemInfo.systemStar;
        if (star.category === HabitatCategoryType.GasCloud && star.basesAtHabitat.length > 0) {
            for (let j = 0; j < star.basesAtHabitat.length; j++) {
                const builtObject = star.basesAtHabitat[j];
                if (!builtObject.isRefuellingDepot || builtObject.empire === null || (empireToExclude !== null && builtObject.empire === empireToExclude)) continue;
                let flag = true;
                if (empire !== null && empire.pirateEmpireBaseHabitat === null && empire !== galaxy.independentEmpire) {
                    flag = isObjectVisibleToThisEmpire(galaxy, empire, builtObject, true, false);
                }
                if (!flag || !isStellarObjectDockable(galaxy, builtObject, empire) || !checkEmpireCanRefuelAtEmpire(galaxy, shipToRefuel, empire, builtObject.empire)) continue;
                const num3 = galaxy.calculateDistanceSquared(x, y, builtObject.xpos, builtObject.ypos);
                if (!(num3 < distance) || !checkSufficientFuelAvailable(galaxy, empire, fuelTypes, builtObject, builtObject.actualEmpire)) continue;
                let flag2 = false;
                if (shipsToRefuel <= 1) {
                    if ((builtObject.dockingBays !== null && builtObject.dockingBays.length >= 4) || (builtObject.dockingBayWaitQueue !== null && builtObject.dockingBayWaitQueue.length <= 3)) flag2 = true;
                } else if (builtObject.dockingBays !== null && builtObject.dockingBays.length >= 4) {
                    flag2 = true;
                }
                if (flag2) {
                    distance = num3;
                    num = num3;
                    stellarObject = builtObject;
                }
            }
        }
        // Galaxy.6.cs 3375 systemInfo.Habitats: no star (a gas-cloud star's bases are the branch above).
        const sysHabitats = planetsOf(systemInfo);
        for (let k = 0; k < sysHabitats.length; k++) {
            const habitat = sysHabitats[k];
            const num4 = galaxy.calculateDistanceSquared(x, y, habitat.xpos, habitat.ypos);
            if (!(num4 < num)) continue;
            let flag3 = false;
            if (habitat.basesAtHabitat.length > 0) {
                for (let m = 0; m < habitat.basesAtHabitat.length; m++) {
                    const builtObject2 = habitat.basesAtHabitat[m];
                    if (!builtObject2.isRefuellingDepot || builtObject2.empire === null || (empireToExclude !== null && builtObject2.empire === empireToExclude) || !isStellarObjectDockable(galaxy, builtObject2, empire)) continue;
                    let flag4 = true;
                    if (
                        empire !== null &&
                        empire !== galaxy.independentEmpire &&
                        builtObject2.subRole !== BuiltObjectSubRole.SmallSpacePort &&
                        builtObject2.subRole !== BuiltObjectSubRole.MediumSpacePort &&
                        builtObject2.subRole !== BuiltObjectSubRole.LargeSpacePort
                    ) {
                        flag4 = isObjectVisibleToThisEmpire(galaxy, empire, builtObject2, true, false);
                    }
                    if (!flag4 || !checkEmpireCanRefuelAtEmpire(galaxy, shipToRefuel, empire, builtObject2.empire)) continue;
                    const num5 = galaxy.calculateDistanceSquared(x, y, builtObject2.xpos, builtObject2.ypos);
                    if (!(num5 < distance) || !checkSufficientFuelAvailable(galaxy, empire, fuelTypes, builtObject2, builtObject2.actualEmpire)) continue;
                    let flag5 = false;
                    if (shipsToRefuel <= 1) {
                        if ((builtObject2.dockingBays !== null && builtObject2.dockingBays.length >= 4) || (builtObject2.dockingBayWaitQueue !== null && builtObject2.dockingBayWaitQueue.length <= 0)) flag5 = true;
                    } else if (builtObject2.dockingBays !== null && builtObject2.dockingBays.length >= 4) {
                        flag5 = true;
                    }
                    if (flag5) {
                        distance = num5;
                        stellarObject = builtObject2;
                        num = num5;
                        flag3 = true;
                    }
                }
            }
            if (
                !flag3 &&
                habitat.population.items.length > 0 &&
                habitat.isRefuellingDepot &&
                habitat.empire !== null &&
                (empireToExclude === null || habitat.empire !== empireToExclude) &&
                isStellarObjectDockable(galaxy, habitat, empire) &&
                checkEmpireCanRefuelAtEmpire(galaxy, shipToRefuel, empire, habitat.empire)
            ) {
                const num6 = galaxy.calculateDistanceSquared(x, y, habitat.xpos, habitat.ypos);
                if (num6 < distance && checkSufficientFuelAvailable(galaxy, empire, fuelTypes, habitat, habitat.empire)) {
                    distance = num6;
                    stellarObject = habitat;
                    num = num6;
                }
            }
        }
    }
    if (stellarObject !== null) {
        distance = galaxy.calculateDistance(x, y, stellarObject.xpos, stellarObject.ypos);
    }
    distanceOut.value = distance;
    return stellarObject;
}

/** CargoList.IndexOf(fuelType, empire), with a null fuel type matching nothing. */
function indexOfFuel(cargo: CargoList | null, fuelTypeId: number | null, owner: Empire | null): number {
    // TODO(port) M4c: C# CargoList.IndexOf(null Resource, …) — a null design FuelType; unreachable (designs always have
    // a reactor fuel), read as no match.
    return cargo === null || fuelTypeId === null ? -1 : cargoIndexOf(cargo, fuelTypeId, owner);
}

/** Galaxy.6.cs 3172 IdentifyWhetherSystemIsRefuellingPointForEmpire(systemStar, empire, fuelType, testMilitaryShip). */
export function identifyWhetherSystemIsRefuellingPointForEmpire(galaxy: Galaxy, systemStar: Habitat, empire: Empire | null, fuelTypeId: number | null, testMilitaryShip: BuiltObject | null): boolean {
    let systemVisibilityStatus = SystemVisibilityStatus.Visible;
    if (empire !== null && empire !== galaxy.independentEmpire) {
        systemVisibilityStatus = empire.visibility.checkSystemVisibilityStatus(systemStar.systemIndex);
    }
    if (systemVisibilityStatus === SystemVisibilityStatus.Explored || systemVisibilityStatus === SystemVisibilityStatus.Visible) {
        if (systemStar.category === HabitatCategoryType.GasCloud && systemStar.basesAtHabitat.length > 0) {
            for (const item of systemStar.basesAtHabitat) {
                if (!item.isRefuellingDepot || item.empire === null) continue;
                let flag = true;
                if (empire !== null && empire !== galaxy.independentEmpire) {
                    flag = isObjectVisibleToThisEmpire(galaxy, empire, item, true, false);
                }
                if (!flag || !isStellarObjectDockable(galaxy, item, empire) || !checkEmpireCanRefuelAtEmpire(galaxy, testMilitaryShip, empire, item.empire)) continue;
                const num = indexOfFuel(item.cargo, fuelTypeId, item.empire);
                if (num >= 0) {
                    let num2 = cargoAvailable(item.cargo!.items[num]);
                    if (empire !== item.empire) {
                        const num3 = calculateResourceLevelBuiltObject(galaxy, fuelTypeId!, item);
                        num2 -= num3;
                    }
                    if (num2 >= MINIMUM_LEVEL_FOR_REFUELLING_POINT) return true;
                }
            }
        }
        // Galaxy.6.cs 3219 systemInfo.Habitats: no star (a gas-cloud star's bases are the branch above).
        const systemHabitats = planetsOf(galaxy.systems[systemStar.systemIndex]);
        for (let i = 0; i < systemHabitats.length; i++) {
            const habitat = systemHabitats[i];
            if (habitat.basesAtHabitat.length > 0) {
                for (const item2 of habitat.basesAtHabitat) {
                    if (!item2.isRefuellingDepot || item2.empire === null || !isStellarObjectDockable(galaxy, item2, empire)) continue;
                    let flag2 = true;
                    if (
                        empire !== null &&
                        empire !== galaxy.independentEmpire &&
                        item2.subRole !== BuiltObjectSubRole.SmallSpacePort &&
                        item2.subRole !== BuiltObjectSubRole.MediumSpacePort &&
                        item2.subRole !== BuiltObjectSubRole.LargeSpacePort
                    ) {
                        flag2 = isObjectVisibleToThisEmpire(galaxy, empire, item2, true, false);
                    }
                    if (!flag2 || !checkEmpireCanRefuelAtEmpire(galaxy, testMilitaryShip, empire, item2.empire)) continue;
                    const num4 = indexOfFuel(item2.cargo, fuelTypeId, item2.empire);
                    if (num4 >= 0) {
                        let num5 = cargoAvailable(item2.cargo!.items[num4]);
                        if (empire !== item2.empire) {
                            const num6 = calculateResourceLevelBuiltObject(galaxy, fuelTypeId!, item2);
                            num5 -= num6;
                        }
                        if (num5 >= MINIMUM_LEVEL_FOR_REFUELLING_POINT) return true;
                    }
                }
            } else {
                if (habitat.population.items.length <= 0 || habitat.empire === null || !isStellarObjectDockable(galaxy, habitat, empire) || !checkEmpireCanRefuelAtEmpire(galaxy, testMilitaryShip, empire, habitat.empire)) continue;
                const num7 = indexOfFuel(habitat.cargo, fuelTypeId, habitat.empire);
                if (num7 >= 0) {
                    let num8 = cargoAvailable(habitat.cargo!.items[num7]);
                    if (empire !== habitat.empire) {
                        const num9 = calculateResourceLevelHabitat(galaxy, fuelTypeId!, habitat, false, false);
                        num8 -= num9;
                    }
                    if (num8 >= MINIMUM_LEVEL_FOR_REFUELLING_POINT) return true;
                }
            }
        }
    }
    return false;
}

// ---------------------------------------------------------------------------------------------------------------
// Empire-level upkeep
// ---------------------------------------------------------------------------------------------------------------

/** FuelSourceSystem.cs: a system and its known fuel sources. */
export class FuelSourceSystem {
    systemStar: Habitat;
    knownFuelSources: Habitat[];
    constructor(systemStar: Habitat, fuelSources: Habitat[]) {
        this.systemStar = systemStar;
        this.knownFuelSources = fuelSources;
    }
}

/** FuelSourceSystemList.cs: the systems with known sources of one fuel resource. */
export class FuelSourceSystemList {
    resourceId = 0;
    items: FuelSourceSystem[] = [];
}

/** Galaxy.3.cs 783 FastFindNearestOtherSpacePort(x, y, empire, spacePortsToExclude). */
function fastFindNearestOtherSpacePort(galaxy: Galaxy, x: number, y: number, empire: Empire, spacePortsToExclude: BuiltObject[]): BuiltObject | null {
    let num = Number.MAX_VALUE;
    let result: BuiltObject | null = null;
    for (let i = 0; i < empire.spacePorts.length; i++) {
        const builtObject = empire.spacePorts[i];
        if (builtObject != null && !spacePortsToExclude.includes(builtObject)) {
            const num2 = galaxy.calculateDistanceSquared(x, y, builtObject.xpos, builtObject.ypos);
            if (num2 < num && builtObject.isSpacePort) {
                result = builtObject;
                num = num2;
            }
        }
    }
    return result;
}

/** Empire.9.cs 3225 CheckSystemLinkedToCapital(systemStar, capitalSystemStar, ref unlinkedSystemStars). */
function checkSystemLinkedToCapital(empire: Empire, systemStar: Habitat | null, capitalSystemStar: Habitat, unlinkedSystemStars: (Habitat | null)[]): boolean {
    unlinkedSystemStars.push(systemStar);
    const sv = empire.systemVisibility;
    if (systemStar !== null && sv !== null && sv[systemStar.systemIndex].linkSystemStars !== null) {
        const links = sv[systemStar.systemIndex].linkSystemStars;
        if (links.includes(capitalSystemStar) || systemStar === capitalSystemStar) {
            return true;
        }
        for (let i = 0; i < links.length; i++) {
            const habitat = links[i];
            if (!unlinkedSystemStars.includes(habitat) && checkSystemLinkedToCapital(empire, habitat, capitalSystemStar, unlinkedSystemStars)) {
                return true;
            }
        }
    }
    return false;
}

/** Empire.9.cs 3246 DetermineSpacePortSystemLink(spacePort, capitalSystemStar, spacePortsToExclude). */
function determineSpacePortSystemLink(galaxy: Galaxy, empire: Empire, spacePort: BuiltObject | null, capitalSystemStar: Habitat, spacePortsToExclude: BuiltObject[]): Habitat | null {
    if (spacePort !== null) {
        const builtObject = fastFindNearestOtherSpacePort(galaxy, Math.trunc(spacePort.xpos), Math.trunc(spacePort.ypos), empire, spacePortsToExclude);
        if (builtObject === null) {
            return capitalSystemStar;
        }
        if (builtObject.nearestSystemStar === spacePort.nearestSystemStar) {
            spacePortsToExclude.push(builtObject);
            return determineSpacePortSystemLink(galaxy, empire, spacePort, capitalSystemStar, spacePortsToExclude);
        }
        if (builtObject.nearestSystemStar !== null && empire.systemVisibility[builtObject.nearestSystemStar.systemIndex].linkSystemStars.includes(spacePort.nearestSystemStar as Habitat)) {
            spacePortsToExclude.push(builtObject);
            return determineSpacePortSystemLink(galaxy, empire, spacePort, capitalSystemStar, spacePortsToExclude);
        }
        if (builtObject.nearestSystemStar !== null) {
            return builtObject.nearestSystemStar;
        }
    }
    return capitalSystemStar;
}

/** Empire.9.cs 3273 EvaluateSystemLinks. Rnd: Next(0, unlinkedSystemStars.Count) per system not linked through a space port. */
export function evaluateSystemLinks(galaxy: Galaxy, empire: Empire): void {
    if (empire === galaxy.independentEmpire || empire.pirateEmpireBaseHabitat !== null) {
        return;
    }
    const sv = empire.systemVisibility;
    for (let i = 0; i < sv.length; i++) {
        const systemVisibility = sv[i];
        if (systemVisibility != null) {
            if (systemVisibility.linkSystemStars !== null) systemVisibility.linkSystemStars.length = 0;
            if (systemVisibility.reciprocalLinkSystemStars !== null) systemVisibility.reciprocalLinkSystemStars.length = 0;
        }
    }
    if (empire.capital === null) {
        return;
    }
    const habitat = galaxy.determineHabitatSystemStar(empire.capital);
    const habitatList = determineEmpireSystems(galaxy, empire);
    for (let j = 0; j < habitatList.length; j++) {
        const habitat2 = habitatList[j];
        if (habitat2 == null) continue;
        const builtObject = fastFindNearestSpacePort(galaxy, habitat2.xpos, habitat2.ypos, empire);
        if (builtObject !== null) {
            if (builtObject.nearestSystemStar !== habitat2) {
                // (a null NearestSystemStar is added as-is, as in the C#)
                sv[habitat2.systemIndex].linkSystemStars.push(builtObject.nearestSystemStar as Habitat);
                continue;
            }
            const builtObjectList: BuiltObject[] = [builtObject];
            sv[habitat2.systemIndex].linkSystemStars.push(determineSpacePortSystemLink(galaxy, empire, builtObject, habitat, builtObjectList) as Habitat);
        } else {
            sv[habitat2.systemIndex].linkSystemStars.push(habitat);
        }
    }
    for (let k = 0; k < habitatList.length; k++) {
        const habitat3 = habitatList[k];
        if (habitat3 == null) continue;
        const unlinkedSystemStars: (Habitat | null)[] = [];
        if (checkSystemLinkedToCapital(empire, habitat3, habitat, unlinkedSystemStars)) continue;
        let habitat4: Habitat | null = null;
        let num = Number.MAX_VALUE;
        for (let l = 0; l < unlinkedSystemStars.length; l++) {
            const habitat5 = unlinkedSystemStars[l];
            if (habitat5 == null) continue;
            const builtObject2 = fastFindNearestSpacePort(galaxy, habitat5.xpos, habitat5.ypos, empire);
            if (builtObject2 !== null && builtObject2.nearestSystemStar === habitat5) {
                const num2 = galaxy.calculateDistanceSquared(habitat5.xpos, habitat5.ypos, habitat.xpos, habitat.ypos);
                if (num2 < num) {
                    habitat4 = habitat5;
                    num = num2;
                }
            }
        }
        if (habitat4 === null) {
            habitat4 = unlinkedSystemStars[galaxy.rnd.next(0, unlinkedSystemStars.length)];
        }
        if (habitat4 !== null) {
            sv[habitat4.systemIndex].linkSystemStars.push(habitat);
        }
    }
    for (let m = 0; m < habitatList.length; m++) {
        const habitat6 = habitatList[m];
        if (habitat6 == null) continue;
        const links = sv[habitat6.systemIndex].linkSystemStars;
        for (let n = 0; n < links.length; n++) {
            const habitat7 = links[n];
            if (habitat7 != null && sv[habitat7.systemIndex].reciprocalLinkSystemStars !== null) {
                sv[habitat7.systemIndex].reciprocalLinkSystemStars.push(habitat6);
            }
        }
    }
}

/** Empire.2.cs 3784 UpdateSystemFuelSourceStatus. */
export function updateSystemFuelSourceStatus(galaxy: Galaxy, empire: Empire): void {
    empire.fuelSystemsUpdating = true;
    const fuelResources = galaxy.resourceSystem.fuelResources;
    if (empire.fuelSystemsSources === null || empire.fuelSystemsSources.length === 0) {
        empire.fuelSystemsSources = [];
        for (let i = 0; i < fuelResources.length; i++) {
            const resourceDefinition = fuelResources[i];
            if (resourceDefinition != null) {
                const fuelSourceSystemList = new FuelSourceSystemList();
                fuelSourceSystemList.resourceId = resourceDefinition.resourceId;
                empire.fuelSystemsSources.push(fuelSourceSystemList);
            }
        }
    }
    for (let j = 0; j < empire.fuelSystemsSources.length; j++) {
        empire.fuelSystemsSources[j].items.length = 0;
    }
    const svList = empire.systemVisibility;
    const resourceMap = empire.resourceMap;
    for (let k = 0; k < svList.length; k++) {
        const systemVisibility = svList[k];
        if ((systemVisibility.status !== SystemVisibilityStatus.Explored && systemVisibility.status !== SystemVisibilityStatus.Visible) || systemVisibility.fuelSourcesFinalized) {
            continue;
        }
        const array: Habitat[][] = new Array(fuelResources.length);
        for (let l = 0; l < array.length; l++) array[l] = [];
        const star = systemVisibility.systemStar;
        if (star.category === HabitatCategoryType.GasCloud && (systemVisibility.totallyExplored || (resourceMap != null && resourceMap.checkResourcesKnown(star)))) {
            for (let m = 0; m < fuelResources.length; m++) {
                if (habitatHasResource(star, fuelResources[m].resourceId) && !array[m].includes(star)) {
                    array[m].push(star);
                }
            }
        }
        const habitats = planetsOf(galaxy.systems[star.systemIndex]); // Empire.2.cs 3828 Systems[].Habitats: no star
        for (let n = 0; n < habitats.length; n++) {
            const habitat = habitats[n];
            if ((habitat.category !== HabitatCategoryType.GasCloud && habitat.type !== HabitatType.GasGiant) || (!systemVisibility.totallyExplored && (resourceMap == null || !resourceMap.checkResourcesKnown(habitat)))) {
                continue;
            }
            for (let num2 = 0; num2 < fuelResources.length; num2++) {
                if (habitatHasResource(habitat, fuelResources[num2].resourceId) && !array[num2].includes(habitat)) {
                    array[num2].push(habitat);
                }
            }
        }
        for (let num4 = 0; num4 < fuelResources.length; num4++) {
            empire.fuelSystemsSources[num4].items.push(new FuelSourceSystem(star, array[num4]));
        }
        if (systemVisibility.totallyExplored) {
            systemVisibility.fuelSourcesFinalized = true;
        }
    }
    empire.fuelSystemsUpdating = false;
}

/** Empire.2.cs 3856 UpdateSystemRefuellingStatus. */
export function updateSystemRefuellingStatus(galaxy: Galaxy, empire: Empire): void {
    let fuelTypeId: number | null = galaxy.resourceSystem.fuelResources[0].resourceId;
    // DesignList.FindNewestCanBuild(subRole) (DesignList.cs 140): the empire of the list's first design.
    const designs = empire.designs;
    const designEmpire = designs.length > 0 && designs[0] != null ? (designs[0].empire as Empire | null) : null;
    const design = findNewestCanBuild(designs, BuiltObjectSubRole.Frigate, designEmpire);
    if (design !== null) {
        fuelTypeId = design.fuelType !== null ? design.fuelType.resourceId : null;
    }
    let testMilitaryShip: BuiltObject | null = null;
    for (let i = 0; i < empire.builtObjects.length; i++) {
        if (empire.builtObjects[i].role === BuiltObjectRole.Military) {
            testMilitaryShip = empire.builtObjects[i];
            break;
        }
    }
    const sv = empire.systemVisibility;
    for (let j = 0; j < sv.length; j++) {
        const systemVisibility = sv[j];
        systemVisibility.isRefuellingPoint = identifyWhetherSystemIsRefuellingPointForEmpire(galaxy, systemVisibility.systemStar, empire, fuelTypeId, testMilitaryShip);
    }
}

/** Empire.4.cs 2516 CheckForStrandedShips. */
export function checkForStrandedShips(galaxy: Galaxy, empire: Empire): void {
    const check = (builtObject: BuiltObject): void => {
        if (builtObject.damagedComponentCount > 0 && builtObject.role !== BuiltObjectRole.Base && builtObject.warpSpeed <= 0 && builtObject.builtAt === null && !builtObject.strandedMessageSent) {
            let arg = '';
            if (builtObject.nearestSystemStar !== null) {
                arg = builtObject.nearestSystemStar.name;
            }
            // string.Format(TextResolver.GetText("Stranded Ship SHIPTYPE NAME SYSTEM"), ResolveDescription(SubRole), Name, arg).
            const description = gameText('Stranded Ship SHIPTYPE NAME SYSTEM', resolveSubRoleDescription(builtObject.subRole), builtObject.name, arg);
            sendMessageToEmpire(empire, empire, EmpireMessageType.ShipNeedsRepair, builtObject, description);
            builtObject.strandedMessageSent = true;
        }
    };
    for (let i = 0; i < empire.builtObjects.length; i++) check(empire.builtObjects[i]);
    for (let j = 0; j < empire.privateBuiltObjects.length; j++) check(empire.privateBuiltObjects[j]);
}

/** Habitat.cs 2007 ReviewWhetherRefuellingDepot. */
export function reviewWhetherRefuellingDepot(galaxy: Galaxy, habitat: Habitat): void {
    if (habitat.population !== null && habitat.population.items.length > 0 && habitat.cargo !== null) {
        habitat.isRefuellingDepot = true;
    } else {
        habitat.isRefuellingDepot = false;
    }
}

/** Galaxy.5.cs 2923 CheckShouldExplore(empire, habitat). */
export function checkShouldExplore(galaxy: Galaxy, empire: Empire, habitat: Habitat): boolean {
    if (habitat.ruin !== null && (checkRuinsHaveBenefit(galaxy, habitat.ruin, empire) || (empire === galaxy.playerEmpire && (habitat.ruin.storyClueLevel >= 0 || !habitat.ruin.playerEmpireEncountered)))) {
        return true;
    }
    if (empire.resourceMap != null && empire.resourceMap.checkResourcesKnown(habitat)) {
        return false;
    }
    return true;
}
