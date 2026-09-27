// M4l — ShipGroup model (ShipGroup.cs, ShipGroupList.cs), the ShipGroup.DoTasks subroutines, AssignMission / QueueMission
// overloads, refuel / repair / attack checks, lead ship, fuel range; the Empire-side fleet maintenance (Empire.9.cs
// 2454-2900 MaintainShipGroups, UpdateFleetLeadShips, ReviewFleetPostures, AddShipsToShipGroup, SelectFleetBase, ...),
// Empire.8.cs 5145 DisbandShipGroup / 5217 FindAvailableMilitaryShip, Empire.2.cs 2944 ReviewFleetAdmiralBonuses; the
// BuiltObject-side fleet methods (BuiltObject.1.cs 42 LeaveShipGroup, BuiltObject.cs 1906 ReviewFleetBonuses / 3503
// PerformFleetTasks) and Galaxy.7.cs 4597 AssignFleetWaypointMission. Galaxy.ProcessPirateFleets (Galaxy.cs 3278) is in
// tick/galaxyTick.ts (M4a).
//
// Free functions, C# `this` first (plan §3.1 rule 2). Statement-for-statement port; C# float fields (AttackRangeSquared)
// are kept as float32 (Math.fround). Galaxy.Rnd draws happen only where the C# draws: AssignMission (Move to a star:
// NextDouble ×2), AssignMissionToShips (SelectRelativePoint per ship: NextDouble ×2), the BuiltObjectMission
// constructors (ResolveCommandsForMission), IdentifyFleetGatherLocation / AssignFleetWaypointMission
// (SelectRelativeParkingPoint: NextDouble, Next(0, 2), NextDouble), PerformFleetTasks (SelectRelativePoint) and
// SelectFleetBase (SelectRandomSpacePortColony / SelectRandomColony / SelectRandomSpacePort: Next(0, n)).
//
// Dead C# code not ported (no callers anywhere in DistantWorlds.Types / BaconDistantWorlds / DistantWorlds):
// ShipGroup.CheckForMissionCompletion_NEW (478), WarnIncomingFleet (413) + ResolveAttackWarningDescription (386),
// CheckForCommandCompletion (1893) + CompleteCommand (1862), CheckShouldClearBattleStats (224).
// ShipGroup.LoadTroopsIfNecessaryAndPossible (124) belongs to M4q (combat/troopsRuntime.ts).
//
// Module split: fleets/shipGroup.ts holds the ShipGroup class and light entry points with type-only imports of the
// sim modules; this module (which imports missions, movement, combat, diplomacy, ...) registers the ported bodies
// there at load (registerShipGroupTasks). empire.ts → pirateRelations.ts → fleets/shipGroup.ts is evaluated while
// empire.ts is still initialising, so fleets/shipGroup.ts must not pull the heavy modules in. tick/shipGroupTick.ts
// imports this module, so every sim path has the bodies registered.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { BuiltObject } from '../builtObject';
import type { Habitat } from '../types';
import { HabitatCategoryType, HabitatType } from '../types';
import type { CargoList, ResourceRef } from '../cargo';
import { TroopType } from '../cargo';
import type { Design } from '../design';
import { galaxyStarDate } from '../tick/simTime';
import {
    BuiltObjectMission,
    BuiltObjectMissionPriority,
    BuiltObjectMissionType,
    CommandAction,
    COORD_UNSET_DOUBLE,
    builtObjectMission,
    isBuiltObject,
    isCreature,
    isHabitat,
    isShipGroup,
    type MissionTarget,
    type StellarObject,
} from '../missions/mission';
import { assignMission, clearPreviousMissionRequirements, queueMission } from '../missions/assign';
import { BuiltObjectRole } from '../data/designSpecifications';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { netSort } from '../netSort';
import { FleetPosture, aggressionLevel, cautionLevel, compareDouble, formatText } from '../diplomacyTick';
import { DiplomaticRelationType, DiplomaticStrategy, obtainDiplomaticRelation } from '../diplomacy';
import { PirateRelationType } from '../pirateRelations';
import { CharacterRole, CharacterTraitType, identifyPirateBase, resolveLocationsToDefend, type Character } from '../characters';
import {
    type FuelTypeRef,
    calculateFuelPortionMarginFromRefuellingPoint,
    currentRange,
    fastFindNearestRefuellingPoint,
    maximumFuelRange,
    ultraFastFindNearestRefuellingLocation,
    withinFuelRange,
    withinFuelRangeAndRefuelAt,
    withinReducedFuelRange,
} from '../movement';
import { calculateOverallStrengthFactor, fastFindNearestColony, stellarEmpire } from '../combat/threats';
import { determineDestroyOrCaptureTargetCore, empireRaidStrengthFactor, weaponIsAvailableWithoutEnergyConsideration } from '../combat/attackAI';
import { finalizeShipGroupBattleStats, startNewShipGroupBattleStats } from '../combat/damage';
import { determineEmpiresAtWarWith } from '../treasury';
import { checkEmpireHasHyperDriveTech } from '../forceStructure';
import { selectRandomSpacePortColony } from '../construction/retrofit';
import { assignFleetRetrofit } from '../construction/empireConstruction';
import { assignRepairMission } from '../construction/repair';
import { assignLoadTroopsMission } from '../combat/troopsRuntime';
import { ComponentType } from '../data/components';
import {
    assignFleetAttackMission,
    assignFleetRefuelling,
    checkBombardEnemyColony,
    coordinateFleetAttacksWithAllies,
    coordinateFleetAttacksWithAlliesOf,
    ensureSingleStellarObjectPerSystem,
    identifyEmpireStrikePoints,
    implementBlockade,
    reviewDefensiveFleetLocations,
    selectDefensiveFleetBase,
    selectFleetWarAttackTarget,
    setDefendFleets,
} from './militaryAI';
import { findNearestBaseForPirateAttack, findNearestKnownBaseOfEmpireForPirateAttack } from '../pirates/pirateAI';
import { ShipGroup, empireShipGroups, registerShipGroupTasks, shipGroupWarpSpeed } from './shipGroup';
export { shipGroupWarpSpeed };

// ---------------------------------------------------------------------------------------------------------------
// Constants (Galaxy.3.cs 4972-5083 static readonly values)
// ---------------------------------------------------------------------------------------------------------------

/** Galaxy.ParentRelativeRange (Galaxy.3.cs 4988). */
const PARENT_RELATIVE_RANGE = 700;
/** Galaxy.MaxSolarSystemSize (Galaxy.3.cs 4978). */
const MAX_SOLAR_SYSTEM_SIZE = 23000;
/** Galaxy.ColonyMaximumTroopStrength (Galaxy.3.cs 5039). */
const COLONY_MAXIMUM_TROOP_STRENGTH = 150000;
/** Galaxy.FleetTypicalSize / StrikeForceTypicalSize (Galaxy.3.cs 5082-5083). */
const GALAXY_FLEET_TYPICAL_SIZE = 15;
const GALAXY_STRIKE_FORCE_TYPICAL_SIZE = 4;
/** Galaxy.FleetMaximumCount (Galaxy.3.cs 5051). */
const GALAXY_FLEET_MAXIMUM_COUNT = 30;
/** Galaxy.IndexSize (Galaxy.3.cs). */
const INDEX_SIZE = 400000;
/** 2.304E+09f (48000²) as the float32 it is. */
const ATTACK_RANGE_SQUARED_DEFAULT = Math.fround(2.304e9);

/** C# string.CompareTo (culture-sensitive; .NET 5+ ICU en-US collation, as galaxy.ts). */
const NAME_COLLATOR = new Intl.Collator('en-US');

/** ShipGroup.cs 3574 IComparable<ShipGroup>.CompareTo: SortTag, then Name (culture-sensitive). */
export function compareShipGroups(a: ShipGroup | null, b: ShipGroup | null): number {
    const num = compareDouble(a!.sortTag, b!.sortTag);
    if (num !== 0) return num;
    // string.CompareTo(null) is 1; a null Name on `this` throws in C# (never happens: every fleet is named before sorting).
    if (b!.name === null) return 1;
    return NAME_COLLATOR.compare(a!.name!, b!.name);
}

function shipOf(bo: BuiltObject | null | undefined): BuiltObject | null {
    return bo ?? null;
}

/** A mission's Type read afresh (Clear() resets it to Undefined behind TypeScript's narrowing). */
function currentMissionType(mission: BuiltObjectMission): BuiltObjectMissionType {
    return mission.type;
}

function missionOf(bo: BuiltObject): BuiltObjectMission | null {
    return builtObjectMission(bo.mission);
}

/** ShipGroup.cs 158 CalculateTimeToArrivalAtDestination (long ms). */
export function shipGroupCalculateTimeToArrivalAtDestination(galaxy: Galaxy, shipGroup: ShipGroup): number {
    let arrivalAtDestination = 0;
    if (shipGroup.mission !== null && shipGroup.mission.type !== BuiltObjectMissionType.Undefined && shipGroup.leadShip !== null) {
        const point = shipGroup.mission.resolveTargetCoordinates(shipGroup.mission);
        if (point.x > 0 && point.y > 0) {
            arrivalAtDestination = Math.trunc((galaxy.calculateDistance(shipGroup.leadShip.xpos, shipGroup.leadShip.ypos, point.x, point.y) / Math.max(30, shipGroupWarpSpeed(shipGroup))) * 1000.0);
        }
    }
    return arrivalAtDestination;
}

// ---------------------------------------------------------------------------------------------------------------
// ShipGroup.DoTasks subroutines (called by tick/shipGroupTick.ts, ShipGroup.cs 97-122)
// ---------------------------------------------------------------------------------------------------------------

/** ShipGroup.cs 170 CheckSendForAttack. */
export function checkSendForAttack(galaxy: Galaxy, shipGroup: ShipGroup): boolean {
    if (shipGroup.posture === FleetPosture.Attack && shipGroup.attackPoint !== null) {
        const attackPoint = shipGroup.attackPoint;
        if (shipGroup.mission === null || shipGroup.mission.type === BuiltObjectMissionType.Undefined || shipGroup.mission.priority === BuiltObjectMissionPriority.Low) {
            const empire = stellarEmpire(attackPoint);
            if (empire !== null && shipGroup.empire !== null && empire !== shipGroup.empire && checkAtWarWithEmpire(shipGroup.empire, empire) && shipGroupCheckFleetTargetWithinFuelRangeAndRefuel(galaxy, shipGroup, attackPoint.xpos, attackPoint.ypos, 0.1)) {
                let missionType = BuiltObjectMissionType.Attack;
                if (isHabitat(attackPoint) && checkBombardEnemyColony(galaxy, shipGroup.empire, attackPoint, shipGroup)) {
                    missionType = BuiltObjectMissionType.Bombard;
                }
                shipGroupAssignMission(galaxy, shipGroup, missionType, attackPoint, null, BuiltObjectMissionPriority.High, false);
                return true;
            }
        }
    }
    return false;
}

/** Attack, WaitAndAttack, Bombard, WaitAndBombard, Capture, Raid (the ShipGroup.cs combat-mission set). */
function isCombatMissionType(t: BuiltObjectMissionType): boolean {
    return t === BuiltObjectMissionType.Attack || t === BuiltObjectMissionType.WaitAndAttack || t === BuiltObjectMissionType.Bombard || t === BuiltObjectMissionType.WaitAndBombard || t === BuiltObjectMissionType.Capture || t === BuiltObjectMissionType.Raid;
}

/** ShipGroup.cs 191 CheckForCompletedBattle. */
export function checkForCompletedBattle(galaxy: Galaxy, shipGroup: ShipGroup): boolean {
    const battleStats = shipGroup.battleStats;
    if (battleStats !== null) {
        let flag = false;
        if (shipGroup.mission !== null && isCombatMissionType(shipGroup.mission.type)) {
            flag = true;
        }
        if (!flag) {
            for (let index = 0; index < shipGroup.ships.length; ++index) {
                const ship = shipOf(shipGroup.ships[index]);
                const m = ship !== null ? missionOf(ship) : null;
                if (ship !== null && m !== null && isCombatMissionType(m.type)) {
                    flag = true;
                    break;
                }
            }
        }
        if (!flag && shipGroup.leadShip !== null) {
            // 208-212: BattleStats.Location = ResolveNearestLocation(null, LeadShip, out nearby); NearLocation = nearby;
            // DoCharacterEvent(SpaceBattle, BattleStats, ObtainCharacters()) — the SpaceBattleStats type is M4o's.
            finalizeShipGroupBattleStats(galaxy, shipGroup, null);
            shipGroup.battleStats = null;
            return true;
        }
    }
    return false;
}

/** CharacterList.cs 297 GetFleetAdmiralsAndGenerals(fleet) over Empire.Characters. */
export function getFleetAdmiralsAndGenerals(characters: readonly unknown[], fleet: ShipGroup | null): Character[] {
    const admiralsAndGenerals: Character[] = [];
    if (fleet !== null) {
        for (let index = 0; index < characters.length; ++index) {
            const character = characters[index] as Character | null;
            if (character != null && (character.role === CharacterRole.FleetAdmiral || character.role === CharacterRole.TroopGeneral || character.role === CharacterRole.PirateLeader)) {
                const location = character.location;
                if (location !== null && isBuiltObject(location) && location.shipGroup === fleet) {
                    admiralsAndGenerals.push(character);
                }
            }
        }
    }
    return admiralsAndGenerals;
}

/** ShipGroup.cs 232 ReviewAdmiralBonuses. */
export function shipGroupReviewAdmiralBonuses(galaxy: Galaxy, shipGroup: ShipGroup): void {
    void galaxy;
    if (shipGroup.empire !== null && shipGroup.empire.characters !== null) {
        let t = -100;
        let c = -100;
        let m = -100;
        let f = -100;
        let e = -100;
        let wd = -100;
        let wr = -100;
        let s = -100;
        let dc = -100;
        let r = -100;
        let h = -100;
        const admiralsAndGenerals = getFleetAdmiralsAndGenerals(shipGroup.empire.characters, shipGroup);
        for (let index = 0; index < admiralsAndGenerals.length; ++index) {
            const character = admiralsAndGenerals[index];
            if (character != null && (character.role === CharacterRole.FleetAdmiral || character.role === CharacterRole.PirateLeader) && character.bonusesKnown) {
                t = Math.max(t, character.targeting);
                c = Math.max(c, character.countermeasures);
                m = Math.max(m, character.shipManeuvering);
                f = Math.max(f, character.fighters);
                e = Math.max(e, character.shipEnergyUsage);
                wd = Math.max(wd, character.weaponsDamage);
                wr = Math.max(wr, character.weaponsRange);
                s = Math.max(s, character.shieldRechargeRate);
                dc = Math.max(dc, character.damageControl);
                r = Math.max(r, character.repairBonus);
                h = Math.max(h, character.hyperjumpSpeed);
            }
        }
        if (t <= -100) t = 0;
        if (c <= -100) c = 0;
        if (m <= -100) m = 0;
        if (f <= -100) f = 0;
        if (e <= -100) e = 0;
        if (wd <= -100) wd = 0;
        if (wr <= -100) wr = 0;
        if (s <= -100) s = 0;
        if (dc <= -100) dc = 0;
        if (r <= -100) r = 0;
        if (h <= -100) h = 0;
        shipGroup.targetingBonusBase = 1.0 + t / 100.0;
        shipGroup.countermeasuresBonusBase = 1.0 + c / 100.0;
        shipGroup.shipManeuveringBonusBase = 1.0 + m / 100.0;
        shipGroup.fightersBonusBase = 1.0 + f / 100.0;
        shipGroup.shipEnergyUsageBonusBase = 1.0 + e / 100.0;
        shipGroup.weaponsDamageBonusBase = 1.0 + wd / 100.0;
        shipGroup.weaponsRangeBonusBase = 1.0 + wr / 100.0;
        shipGroup.shieldRechargeRateBonusBase = 1.0 + s / 100.0;
        shipGroup.damageControlBonusBase = 1.0 + dc / 100.0;
        shipGroup.repairBonusBase = 1.0 + r / 100.0;
        shipGroup.hyperjumpSpeedBonusBase = 1.0 + h / 100.0;
    } else {
        shipGroup.targetingBonusBase = 1.0;
        shipGroup.countermeasuresBonusBase = 1.0;
        shipGroup.shipManeuveringBonusBase = 1.0;
        shipGroup.fightersBonusBase = 1.0;
        shipGroup.shipEnergyUsageBonusBase = 1.0;
        shipGroup.weaponsDamageBonusBase = 1.0;
        shipGroup.weaponsRangeBonusBase = 1.0;
        shipGroup.shieldRechargeRateBonusBase = 1.0;
        shipGroup.damageControlBonusBase = 1.0;
        shipGroup.repairBonusBase = 1.0;
        shipGroup.hyperjumpSpeedBonusBase = 1.0;
    }
}

/** Galaxy.3.cs 574 FastFindBasesInSystem(empire, systemStar): the empire's state and private bases in the system. */
export function fastFindBasesInSystem(galaxy: Galaxy, empire: Empire | null, systemStar: Habitat | null): BuiltObject[] {
    void galaxy;
    const builtObjectList: BuiltObject[] = [];
    if (systemStar !== null && empire !== null) {
        if (empire.builtObjects !== null) {
            for (let i = 0; i < empire.builtObjects.length; i++) {
                const builtObject = empire.builtObjects[i];
                if (builtObject != null && !builtObject.hasBeenDestroyed && builtObject.role === BuiltObjectRole.Base && builtObject.nearestSystemStar === systemStar) {
                    builtObjectList.push(builtObject);
                }
            }
        }
        if (empire.privateBuiltObjects !== null) {
            for (let j = 0; j < empire.privateBuiltObjects.length; j++) {
                const builtObject2 = empire.privateBuiltObjects[j];
                if (builtObject2 != null && !builtObject2.hasBeenDestroyed && builtObject2.role === BuiltObjectRole.Base && builtObject2.nearestSystemStar === systemStar) {
                    builtObjectList.push(builtObject2);
                }
            }
        }
    }
    return builtObjectList;
}

/** ShipGroup.cs 316 ReviewCharacterLocationBonuses. */
export function reviewCharacterLocationBonuses(galaxy: Galaxy, shipGroup: ShipGroup): void {
    let flag1 = false;
    if (shipGroup.empire !== null && shipGroup.empire.characters !== null) {
        let flag2 = false;
        const admiralsAndGenerals = getFleetAdmiralsAndGenerals(shipGroup.empire.characters, shipGroup);
        for (let index = 0; index < admiralsAndGenerals.length; ++index) {
            const character = admiralsAndGenerals[index];
            if ((character.role === CharacterRole.FleetAdmiral || character.role === CharacterRole.PirateLeader) && character.traits.includes(CharacterTraitType.LocalDefenseTactics)) {
                flag2 = true;
                break;
            }
        }
        if (flag2) {
            let flag3 = false;
            const leadShip = shipGroup.leadShip;
            if (leadShip !== null) {
                const nearestColony = fastFindNearestColony(galaxy, leadShip.xpos, leadShip.ypos, shipGroup.empire, 0);
                if (nearestColony !== null && galaxy.calculateDistanceSquared(leadShip.xpos, leadShip.ypos, nearestColony.xpos, nearestColony.ypos) < 4000000.0) {
                    flag3 = true;
                }
                if (!flag3 && leadShip.nearestSystemStar !== null) {
                    const basesInSystem = fastFindBasesInSystem(galaxy, shipGroup.empire, leadShip.nearestSystemStar);
                    for (let index = 0; index < basesInSystem.length; ++index) {
                        const builtObject = basesInSystem[index];
                        if (galaxy.calculateDistanceSquared(leadShip.xpos, leadShip.ypos, builtObject.xpos, builtObject.ypos) < 4000000.0) {
                            flag3 = true;
                            break;
                        }
                    }
                }
            }
            if (flag3) {
                flag1 = true;
            }
        }
    }
    if (flag1) {
        shipGroup.targetingBonusExtra = 0.2;
        shipGroup.countermeasuresBonusExtra = 0.2;
    } else {
        shipGroup.targetingBonusExtra = 0.0;
        shipGroup.countermeasuresBonusExtra = 0.0;
    }
}

/** ShipGroup.cs 370 AddShipToFleet(ship). */
export function shipGroupAddShipToFleet(galaxy: Galaxy, shipGroup: ShipGroup, ship: BuiltObject): void {
    ship.attackRangeSquared = shipGroup.attackRangeSquared;
    if (ship.shipGroup !== null) {
        if (ship.shipGroup === shipGroup) {
            return;
        }
        leaveShipGroup(galaxy, ship);
    }
    ship.shipGroup = shipGroup;
    shipGroup.ships.push(ship);
    if (shipGroup.leadShip !== null) {
        return;
    }
    shipGroup.leadShip = ship;
}

/** ShipGroup.cs 457 CheckCloseToTargetAndStillTravellingToTarget(mission). */
function checkCloseToTargetAndStillTravellingToTarget(galaxy: Galaxy, shipGroup: ShipGroup, mission: BuiltObjectMission): boolean {
    let flag = true;
    const point1 = mission.resolveTargetCoordinates(mission);
    if (shipGroup.leadShip !== null && galaxy.calculateDistance(shipGroup.leadShip.xpos, shipGroup.leadShip.ypos, point1.x, point1.y) > MAX_SOLAR_SYSTEM_SIZE * 2.1) {
        flag = false;
    }
    if (flag) {
        return true;
    }
    for (let index = 0; index < shipGroup.ships.length; ++index) {
        const ship = shipGroup.ships[index];
        const m = missionOf(ship);
        if (ship.currentSpeed > 0.0 && ship.currentSpeed > ship.topSpeed && m !== null) {
            const point2 = m.resolveTargetCoordinates(m);
            if (galaxy.calculateDistance(point1.x, point1.y, point2.x, point2.y) < 1000.0) {
                return false;
            }
        }
    }
    return true;
}

/**
 * ShipGroup.cs 516 CheckForMissionCompletion. The C# `switch` arms end in `break` (fall out to the 1150 tail) or in
 * `if (... && CompleteMission()) return;`; the nested early `break`s of the Attack / Waypoint / Bombard / Move /
 * Capture / Raid arms are labelled-block breaks here.
 */
export function checkForMissionCompletion(galaxy: Galaxy, shipGroup: ShipGroup): void {
    const mission1 = shipGroup.mission;
    if (mission1 === null || mission1.type === BuiltObjectMissionType.Undefined) {
        return;
    }
    let x2 = -2000000001.0;
    let y2 = -2000000001.0;
    let num1 = 0;
    let flag1 = true;
    const parentRelativeRange = PARENT_RELATIVE_RANGE;
    let flag2 = false;
    let empire1: Empire | null = null;
    let attackedTarget: StellarObject | null = null;
    const targetBuiltObject = mission1.targetBuiltObject;
    const targetHabitat = mission1.targetHabitat;
    const ships = shipGroup.ships;
    switch (mission1.type) {
        case BuiltObjectMissionType.Patrol: {
            let num2 = 0;
            for (let index = 0; index < ships.length; ++index) {
                const ship = shipOf(ships[index]);
                if (ship !== null) {
                    const mission2 = missionOf(ship);
                    if (mission2 !== null && mission2.type === BuiltObjectMissionType.Patrol) ++num2;
                }
            }
            if (num2 === 0 && shipGroupCompleteMission(galaxy, shipGroup)) return;
            break;
        }
        case BuiltObjectMissionType.Attack:
        case BuiltObjectMissionType.WaitAndAttack: {
            attack: {
                if (mission1.targetBuiltObject !== null || mission1.targetHabitat !== null || mission1.targetShipGroup !== null) {
                    if (targetBuiltObject !== null) {
                        const builtObject = targetBuiltObject;
                        if (builtObject.hasBeenDestroyed) {
                            if (checkCloseToTargetAndStillTravellingToTarget(galaxy, shipGroup, mission1)) {
                                flag2 = true;
                                empire1 = builtObject.empire;
                                attackedTarget = builtObject;
                            }
                            break attack;
                        }
                        if (builtObject.empire === shipGroup.empire) {
                            if (checkCloseToTargetAndStillTravellingToTarget(galaxy, shipGroup, mission1)) {
                                flag2 = true;
                                attackedTarget = builtObject;
                            }
                            break attack;
                        }
                    }
                    if (mission1.targetCreature !== null) {
                        if (mission1.targetCreature.hasBeenDestroyed) {
                            if (checkCloseToTargetAndStillTravellingToTarget(galaxy, shipGroup, mission1)) {
                                forceCompleteMission(galaxy, shipGroup);
                            }
                            break attack;
                        }
                    } else if (targetHabitat !== null) {
                        const habitat = targetHabitat;
                        if (habitat.owner === shipGroup.empire || habitat.owner === null) {
                            if (checkCloseToTargetAndStillTravellingToTarget(galaxy, shipGroup, mission1)) {
                                flag2 = true;
                                attackedTarget = habitat;
                            }
                            break attack;
                        }
                        if (habitat.invadingTroops === null || habitat.invadingTroops.totalAttackStrength === 0) {
                            let flag3 = false;
                            let flag4 = false;
                            for (let index = 0; index < ships.length; ++index) {
                                const ship = shipOf(ships[index]);
                                if (ship !== null) {
                                    const mission3 = missionOf(ship);
                                    if (mission3 !== null && (mission3.type === BuiltObjectMissionType.Attack || mission3.type === BuiltObjectMissionType.WaitAndAttack) && mission3.targetHabitat === habitat && ship.troops !== null && ship.troops.totalAttackStrength > 0) {
                                        flag3 = true;
                                        break;
                                    }
                                    if (checkShipMissionContainsHyperAndOtherAction(ship, CommandAction.Attack, mission1.targetHabitat)) {
                                        flag4 = true;
                                        break;
                                    }
                                }
                            }
                            if (!flag3 && !flag4) {
                                flag2 = true;
                                empire1 = habitat.empire;
                                attackedTarget = habitat;
                                break attack;
                            }
                            if (shipGroupTotalTroopAttackStrength(shipGroup) === 0 && !flag4) {
                                if (checkCloseToTargetAndStillTravellingToTarget(galaxy, shipGroup, mission1)) {
                                    flag2 = true;
                                    empire1 = habitat.empire;
                                    attackedTarget = habitat;
                                }
                                break attack;
                            }
                        }
                    } else if (mission1.targetShipGroup !== null) {
                        let flag5 = false;
                        for (let index = 0; index < ships.length; ++index) {
                            const ship = shipOf(ships[index]);
                            if (ship !== null) {
                                const mission4 = missionOf(ship);
                                if (mission4 !== null && (mission4.type === BuiltObjectMissionType.Attack || mission4.type === BuiltObjectMissionType.WaitAndAttack) && (mission4.targetShipGroup === mission1.targetShipGroup || (mission4.targetBuiltObject !== null && mission4.targetBuiltObject.shipGroup === mission1.targetShipGroup))) {
                                    flag5 = true;
                                    break;
                                }
                            }
                        }
                        if (!flag5) {
                            flag2 = true;
                            empire1 = mission1.targetShipGroup.empire;
                            break attack;
                        }
                    }
                }
                for (let index = 0; index < ships.length; ++index) {
                    const ship = shipOf(ships[index]);
                    if (ship !== null && ship.isFunctional && ship.topSpeed > 0 && ship.dockedAt === null && ship.builtAt === null) {
                        const mission5 = missionOf(ship);
                        if (mission5 !== null && (mission5.type === BuiltObjectMissionType.Attack || mission5.type === BuiltObjectMissionType.WaitAndAttack)) {
                            if (targetHabitat !== null) {
                                if (targetHabitat === mission5.targetHabitat) ++num1;
                                else if (mission5.targetBuiltObject !== null && targetHabitat.basesAtHabitat !== null && targetHabitat.basesAtHabitat.includes(mission5.targetBuiltObject)) ++num1;
                            }
                            if (targetBuiltObject !== null && targetBuiltObject === mission5.targetBuiltObject) ++num1;
                            if (mission1.targetCreature !== null && mission1.targetCreature === mission5.targetCreature) ++num1;
                            if (mission1.targetShipGroup !== null) {
                                if (mission5.targetBuiltObject !== null) {
                                    if (mission5.targetBuiltObject.shipGroup === mission1.targetShipGroup) ++num1;
                                } else if (mission1.targetShipGroup === mission5.targetShipGroup) ++num1;
                            }
                        }
                    }
                }
                if (num1 === 0) {
                    flag2 = true;
                    if (mission1.targetHabitat !== null) attackedTarget = mission1.targetHabitat;
                    if (mission1.targetBuiltObject !== null) attackedTarget = mission1.targetBuiltObject;
                }
            }
            break;
        }
        case BuiltObjectMissionType.Escape: {
            let num3 = 0;
            for (let index = 0; index < ships.length; ++index) {
                const ship = shipOf(ships[index]);
                if (ship !== null) {
                    const mission6 = missionOf(ship);
                    if (mission6 !== null && mission6.type === BuiltObjectMissionType.Escape) ++num3;
                }
            }
            if (num3 === 0 && shipGroupCompleteMission(galaxy, shipGroup)) return;
            break;
        }
        case BuiltObjectMissionType.Retrofit: {
            let num4 = 0;
            for (let index = 0; index < ships.length; ++index) {
                const ship = shipOf(ships[index]);
                if (ship !== null) {
                    const mission7 = missionOf(ship);
                    if ((mission7 !== null && (mission7.type === BuiltObjectMissionType.Retrofit || mission7.type === BuiltObjectMissionType.Refuel)) || ship.dockedAt !== null || ship.builtAt !== null) ++num4;
                }
            }
            if (num4 <= 0 && shipGroupCompleteMission(galaxy, shipGroup)) return;
            break;
        }
        case BuiltObjectMissionType.Waypoint: {
            waypoint: {
                if (targetBuiltObject !== null || targetHabitat !== null || mission1.targetShipGroup !== null) {
                    if (targetBuiltObject !== null) {
                        x2 = targetBuiltObject.xpos;
                        y2 = targetBuiltObject.ypos;
                    } else if (targetHabitat !== null) {
                        x2 = targetHabitat.xpos;
                        y2 = targetHabitat.ypos;
                    } else if (mission1.targetShipGroup !== null) {
                        const targetShipGroup = mission1.targetShipGroup;
                        if (targetShipGroup.leadShip !== null) {
                            x2 = targetShipGroup.leadShip.xpos;
                            y2 = targetShipGroup.leadShip.ypos;
                        } else {
                            shipGroupCompleteMission(galaxy, shipGroup);
                            break waypoint;
                        }
                    }
                }
                if (mission1.x > -2000000000.0 && mission1.y > -2000000000.0) {
                    x2 = mission1.x;
                    y2 = mission1.y;
                }
                for (let index = 0; index < ships.length; ++index) {
                    const ship = shipOf(ships[index]);
                    if (ship !== null && shipGroupIsShipAvailable(ship)) {
                        const distance = galaxy.calculateDistance(ship.xpos, ship.ypos, x2, y2);
                        const mission8 = missionOf(ship);
                        if (distance > parentRelativeRange && mission8 !== null && mission8.type === BuiltObjectMissionType.Waypoint) {
                            flag1 = false;
                            break;
                        }
                    }
                }
                if (flag1 && shipGroupCompleteMission(galaxy, shipGroup)) return;
            }
            break;
        }
        case BuiltObjectMissionType.Hold:
            if (galaxyStarDate(galaxy) >= mission1.starDate && shipGroupCompleteMission(galaxy, shipGroup)) return;
            break;
        case BuiltObjectMissionType.WaitAndBombard:
        case BuiltObjectMissionType.Bombard: {
            bombard: {
                if (targetHabitat !== null) {
                    const habitat = targetHabitat;
                    if (habitat.owner === shipGroup.empire || habitat.owner === null) {
                        if (checkCloseToTargetAndStillTravellingToTarget(galaxy, shipGroup, mission1)) {
                            flag2 = true;
                            attackedTarget = habitat;
                        }
                        break bombard;
                    }
                    if (habitat.population === null || habitat.population.items.length === 0 || habitat.population.totalAmount <= 0) {
                        if (checkCloseToTargetAndStillTravellingToTarget(galaxy, shipGroup, mission1)) {
                            flag2 = true;
                            attackedTarget = habitat;
                        }
                        break bombard;
                    }
                }
                let flag6 = false;
                let num5 = 0;
                for (let index = 0; index < ships.length; ++index) {
                    const ship = shipOf(ships[index]);
                    if (ship !== null && ship.bombardWeaponPower > 0) {
                        const mission9 = missionOf(ship);
                        if (mission9 !== null && mission9.targetHabitat === targetHabitat && (mission9.type === BuiltObjectMissionType.Bombard || mission9.type === BuiltObjectMissionType.WaitAndBombard)) {
                            num5 += ship.bombardWeaponPower;
                        }
                    } else if (checkShipMissionContainsHyperAndOtherAction(ship, CommandAction.Bombard, targetHabitat)) {
                        flag6 = true;
                        break;
                    }
                }
                if (num5 === 0 && !flag6) {
                    flag2 = true;
                }
            }
            break;
        }
        case BuiltObjectMissionType.MoveAndWait:
            if (galaxyStarDate(galaxy) >= mission1.starDate && shipGroupCompleteMission(galaxy, shipGroup)) return;
            break;
        case BuiltObjectMissionType.Refuel: {
            let num6 = 0;
            let num7 = 0;
            const builtObjectList1: BuiltObject[] = [];
            const point = mission1.resolveTargetCoordinates(mission1);
            const num8 = 2304000000.0;
            for (let index = 0; index < ships.length; ++index) {
                const ship = shipOf(ships[index]);
                if (ship !== null) {
                    const mission10 = missionOf(ship);
                    if (mission10 !== null && mission10.type === BuiltObjectMissionType.Refuel && mission10.target === mission1.target) {
                        if (galaxy.calculateDistanceSquared(ship.xpos, ship.ypos, point.x, point.y) > num8) builtObjectList1.push(ship);
                        for (const showAllCommand of mission10.showAllCommands()) {
                            if (showAllCommand.action === CommandAction.Undock) {
                                ++num6;
                                break;
                            }
                        }
                    } else {
                        ++num7;
                    }
                }
            }
            if (num7 > Math.trunc(ships.length / 2) && builtObjectList1.length > 0) {
                let num9 = 0.26;
                if (ships.length > 10) num9 = 0.15;
                if (builtObjectList1.length / ships.length < num9) num6 = 0;
            }
            if (num6 === 0 && shipGroupCompleteMissionWith(galaxy, shipGroup, false)) return;
            break;
        }
        case BuiltObjectMissionType.LoadTroops: {
            let num10 = 0;
            for (let index = 0; index < ships.length; ++index) {
                const ship = shipOf(ships[index]);
                if (ship !== null) {
                    const mission11 = missionOf(ship);
                    if (mission11 !== null && mission11.type === BuiltObjectMissionType.LoadTroops) {
                        for (const showAllCommand of mission11.showAllCommands()) {
                            if (showAllCommand != null && showAllCommand.action === CommandAction.Undock) {
                                ++num10;
                                break;
                            }
                        }
                    }
                }
            }
            if (num10 === 0 && shipGroupCompleteMissionWith(galaxy, shipGroup, false)) return;
            break;
        }
        case BuiltObjectMissionType.UnloadTroops: {
            let num11 = 0;
            for (let index = 0; index < ships.length; ++index) {
                const ship = shipOf(ships[index]);
                if (ship !== null) {
                    const mission12 = missionOf(ship);
                    if (mission12 !== null && mission12.type === BuiltObjectMissionType.UnloadTroops) {
                        for (const showAllCommand of mission12.showAllCommands()) {
                            if (showAllCommand != null && showAllCommand.action === CommandAction.Undock) {
                                ++num11;
                                break;
                            }
                        }
                    }
                }
            }
            if (num11 === 0 && shipGroupCompleteMissionWith(galaxy, shipGroup, false)) return;
            break;
        }
        case BuiltObjectMissionType.Repair: {
            let num12 = 0;
            for (let index = 0; index < ships.length; ++index) {
                const ship = shipOf(ships[index]);
                if (ship !== null) {
                    const mission13 = missionOf(ship);
                    if ((mission13 !== null && (mission13.type === BuiltObjectMissionType.Repair || mission13.type === BuiltObjectMissionType.Refuel)) || ship.dockedAt !== null || ship.builtAt !== null) ++num12;
                }
            }
            if (num12 <= 0 && shipGroupCompleteMission(galaxy, shipGroup)) return;
            break;
        }
        case BuiltObjectMissionType.Move: {
            move: {
                if (targetBuiltObject !== null || targetHabitat !== null || mission1.targetShipGroup !== null) {
                    if (targetBuiltObject !== null) {
                        x2 = targetBuiltObject.xpos;
                        y2 = targetBuiltObject.ypos;
                    } else if (targetHabitat !== null) {
                        x2 = targetHabitat.xpos;
                        y2 = targetHabitat.ypos;
                    } else if (mission1.targetShipGroup !== null) {
                        const targetShipGroup = mission1.targetShipGroup;
                        if (targetShipGroup.leadShip !== null) {
                            x2 = targetShipGroup.leadShip.xpos;
                            y2 = targetShipGroup.leadShip.ypos;
                        } else {
                            shipGroupCompleteMission(galaxy, shipGroup);
                            break move;
                        }
                    }
                }
                if (mission1.x > -2000000000.0 && mission1.y > -2000000000.0) {
                    x2 = mission1.x;
                    y2 = mission1.y;
                }
                let num13 = 0;
                const builtObjectList2: BuiltObject[] = [];
                const num14 = 48000.0;
                for (let index = 0; index < ships.length; ++index) {
                    const ship = shipOf(ships[index]);
                    if (ship !== null && shipGroupIsShipAvailable(ship)) {
                        const distance = galaxy.calculateDistance(ship.xpos, ship.ypos, x2, y2);
                        if (distance > num14) builtObjectList2.push(ship);
                        else ++num13;
                        const mission14 = missionOf(ship);
                        if (distance > parentRelativeRange && mission14 !== null && mission14.type === BuiltObjectMissionType.Move) flag1 = false;
                    }
                }
                if (num13 > Math.trunc(ships.length / 2) && builtObjectList2.length > 0) {
                    let num15 = 0.26;
                    if (ships.length > 10) num15 = 0.15;
                    if (builtObjectList2.length / ships.length < num15 && !builtObjectList2.includes(shipGroup.leadShip as BuiltObject)) flag1 = true;
                }
                if (flag1 && shipGroupCompleteMissionWith(galaxy, shipGroup, false)) return;
            }
            break;
        }
        case BuiltObjectMissionType.Capture: {
            capture: {
                if (targetBuiltObject !== null) {
                    if (targetBuiltObject.hasBeenDestroyed) {
                        if (checkCloseToTargetAndStillTravellingToTarget(galaxy, shipGroup, mission1)) {
                            flag2 = true;
                            empire1 = targetBuiltObject.empire;
                            attackedTarget = targetBuiltObject;
                        }
                        break capture;
                    }
                    if (targetBuiltObject.empire === shipGroup.empire) {
                        if (checkCloseToTargetAndStillTravellingToTarget(galaxy, shipGroup, mission1)) {
                            flag2 = true;
                            attackedTarget = targetBuiltObject;
                        }
                        break capture;
                    }
                }
                for (let index = 0; index < ships.length; ++index) {
                    const ship = shipOf(ships[index]);
                    if (ship !== null && ship.isFunctional && ship.topSpeed > 0 && ship.dockedAt === null && ship.builtAt === null) {
                        const mission15 = missionOf(ship);
                        if (mission15 !== null && mission15.type === BuiltObjectMissionType.Capture && mission1.targetBuiltObject !== null && mission1.targetBuiltObject === mission15.targetBuiltObject) ++num1;
                    }
                }
                if (num1 === 0) {
                    flag2 = true;
                    if (targetBuiltObject !== null) attackedTarget = targetBuiltObject;
                }
            }
            break;
        }
        case BuiltObjectMissionType.Raid: {
            raid: {
                if (targetBuiltObject !== null) {
                    if (targetBuiltObject.hasBeenDestroyed) {
                        if (checkCloseToTargetAndStillTravellingToTarget(galaxy, shipGroup, mission1)) {
                            flag2 = true;
                            empire1 = targetBuiltObject.empire;
                            attackedTarget = targetBuiltObject;
                        }
                        break raid;
                    }
                    if (targetBuiltObject.empire === shipGroup.empire) {
                        if (checkCloseToTargetAndStillTravellingToTarget(galaxy, shipGroup, mission1)) {
                            flag2 = true;
                            attackedTarget = targetBuiltObject;
                        }
                        break raid;
                    }
                } else if (targetHabitat !== null) {
                    if (targetHabitat.hasBeenDestroyed) {
                        if (checkCloseToTargetAndStillTravellingToTarget(galaxy, shipGroup, mission1)) {
                            flag2 = true;
                            empire1 = targetHabitat.empire;
                            attackedTarget = targetHabitat;
                        }
                        break raid;
                    }
                    if (targetHabitat.empire === shipGroup.empire) {
                        if (checkCloseToTargetAndStillTravellingToTarget(galaxy, shipGroup, mission1)) {
                            flag2 = true;
                            attackedTarget = targetHabitat;
                        }
                        break raid;
                    }
                }
                for (let index = 0; index < ships.length; ++index) {
                    const ship = shipOf(ships[index]);
                    if (ship !== null && ship.isFunctional && ship.topSpeed > 0 && ship.dockedAt === null && ship.builtAt === null) {
                        const mission16 = missionOf(ship);
                        if (mission16 !== null && mission16.type === BuiltObjectMissionType.Raid) {
                            if (targetBuiltObject !== null) {
                                if (targetBuiltObject === mission16.targetBuiltObject) ++num1;
                            } else if (targetHabitat !== null && targetHabitat === mission16.targetHabitat) ++num1;
                        }
                    }
                }
                if (num1 === 0) {
                    flag2 = true;
                    if (targetBuiltObject !== null) attackedTarget = targetBuiltObject;
                    if (targetHabitat !== null) attackedTarget = targetHabitat;
                }
            }
            break;
        }
    }
    // 1150-1164
    let anotherMissionAssigned = false;
    if (flag2) {
        anotherMissionAssigned = forceCompleteMissionInform(galaxy, shipGroup);
    }
    if (flag2) {
        const battleStats = shipGroup.battleStats;
        if (battleStats !== null) {
            // BattleStats.Location = ResolveNearestLocation(attackedTarget, LeadShip, out nearby) + DoCharacterEvent(SpaceBattle) (M4o).
            finalizeShipGroupBattleStats(galaxy, shipGroup, attackedTarget);
            shipGroup.battleStats = null;
        }
    }
    if (anotherMissionAssigned) {
        return;
    }
    // 1165-1172
    const leadShip = shipGroup.leadShip;
    const refuellingPortion = shipGroupCalculateRefuellingPortion(galaxy, shipGroup, false);
    // mission1 is the (possibly just cleared) fleet mission object: its Type is re-read here.
    const mission1Type = currentMissionType(mission1);
    if ((mission1 === null || mission1Type === BuiltObjectMissionType.Undefined) && leadShip !== null && leadShip.isAutoControlled && shipGroupCheckShipsRequiringRefuelling(shipGroup, refuellingPortion).count > Math.trunc(ships.length * 0.0)) {
        const requiredFuel = shipGroupCalculateRequiredFuel(shipGroup);
        assignFleetRefuelling(galaxy, shipGroup.empire!, shipGroup, requiredFuel);
        return;
    }
    // 1175-1253
    if (flag2 && (shipGroup.posture === FleetPosture.Attack || (leadShip !== null && leadShip.isAutoControlled))) {
        if (shipGroup.empire !== null && shipGroup.empire.pirateEmpireBaseHabitat !== null) {
            if (shipGroup.empire.pirateEmpireSuperPirates) {
                const builtObject = identifyPirateBase(shipGroup.empire);
                if (builtObject !== null) {
                    const baseForPirateAttack = findNearestBaseForPirateAttack(galaxy, builtObject.xpos, builtObject.ypos, shipGroup.empire);
                    if (baseForPirateAttack !== null) {
                        shipGroupAssignMission(galaxy, shipGroup, BuiltObjectMissionType.Attack, baseForPirateAttack, null, BuiltObjectMissionPriority.High, false);
                        return;
                    }
                }
            } else if (empire1 !== null && empire1 !== shipGroup.empire && leadShip !== null) {
                const empireForPirateAttack = findNearestKnownBaseOfEmpireForPirateAttack(galaxy, shipGroup.empire, leadShip.xpos, leadShip.ypos, empire1, shipGroupTotalOverallStrengthFactor(galaxy, shipGroup));
                if (empireForPirateAttack !== null && !empireForPirateAttack.hasBeenDestroyed && galaxy.calculateDistance(empireForPirateAttack.xpos, empireForPirateAttack.ypos, leadShip.xpos, leadShip.ypos) < MAX_SOLAR_SYSTEM_SIZE * 2.1) {
                    shipGroupAssignMission(galaxy, shipGroup, determineDestroyOrCaptureTargetForFleet(galaxy, shipGroup.empire, shipGroup, empireForPirateAttack), empireForPirateAttack, null, BuiltObjectMissionPriority.High, false);
                    return;
                }
            }
        } else {
            if (empire1 === null && leadShip !== null) {
                const empiresAtWarWith = determineEmpiresAtWarWith(galaxy, shipGroup.empire!).empires;
                if (empiresAtWarWith !== null && empiresAtWarWith.length > 0) {
                    let empire2: Empire | null = null;
                    let num16 = Number.MAX_VALUE;
                    for (let index = 0; index < empiresAtWarWith.length; ++index) {
                        const empire3 = empiresAtWarWith[index];
                        if (empire3 != null && empire3.capital !== null) {
                            const distance = galaxy.calculateDistance(empire3.capital.xpos, empire3.capital.ypos, leadShip.xpos, leadShip.ypos);
                            if (distance < num16) {
                                num16 = distance;
                                empire2 = empire3;
                            }
                        }
                    }
                    empire1 = empire2;
                }
            }
            if (empire1 !== null && empire1 !== shipGroup.empire) {
                const r = selectFleetWarAttackTarget(galaxy, shipGroup.empire!, shipGroup, empire1);
                const stellarObject = r.target;
                const waypointing = r.waypointing;
                if (stellarObject !== null && !waypointing) {
                    let missionType = BuiltObjectMissionType.Attack;
                    if (isHabitat(stellarObject) && checkBombardEnemyColony(galaxy, shipGroup.empire!, stellarObject, shipGroup)) {
                        missionType = BuiltObjectMissionType.Bombard;
                    }
                    shipGroupAssignMission(galaxy, shipGroup, missionType, stellarObject, null, BuiltObjectMissionPriority.High, false);
                    return;
                }
                if (!waypointing) {
                    const targets = identifyEmpireStrikePoints(galaxy, shipGroup.empire!, empire1);
                    const refusalCount = { value: 0 };
                    assignFleetAttackMission(galaxy, shipGroup.empire!, shipGroup, targets, refusalCount);
                    return;
                }
            }
        }
    }
    // 1254-1278
    if (leadShip === null || !leadShip.isAutoControlled || (mission1 !== null && mission1Type !== BuiltObjectMissionType.Undefined)) {
        return;
    }
    const gatherPoint = shipGroup.gatherPoint;
    if (gatherPoint === null || (galaxy.calculateDistanceSquared(leadShip.xpos, leadShip.ypos, gatherPoint.xpos, gatherPoint.ypos) <= 9000000.0 && shipGroupCheckAllShipsHaveParent(shipGroup, gatherPoint))) {
        return;
    }
    let num17 = 0;
    let num18 = 0;
    for (let index = 0; index < ships.length; ++index) {
        const ship = shipOf(ships[index]);
        if (ship !== null) {
            const mission17 = missionOf(ship);
            if (mission17 !== null) {
                if (mission17.type === BuiltObjectMissionType.Attack || mission17.type === BuiltObjectMissionType.Bombard) ++num17;
                else if (mission17.type === BuiltObjectMissionType.Move && mission17.targetHabitat === gatherPoint) ++num18;
                else if (mission17.type === BuiltObjectMissionType.Move && mission17.targetBuiltObject === gatherPoint) ++num18;
            }
        }
    }
    if (num17 > 0 || num18 > 0) {
        return;
    }
    shipGroupAssignMission(galaxy, shipGroup, BuiltObjectMissionType.Move, gatherPoint, null, BuiltObjectMissionPriority.Normal, false);
}

/** ShipGroup.cs 1281 CheckAllShipsHaveParent(parent). */
export function shipGroupCheckAllShipsHaveParent(shipGroup: ShipGroup, parent: StellarObject): boolean {
    if (shipGroup.ships !== null) {
        if (isHabitat(parent)) {
            for (let index = 0; index < shipGroup.ships.length; ++index) {
                const ship = shipOf(shipGroup.ships[index]);
                if (ship !== null && !ship.hasBeenDestroyed && ship.builtAt === null && ship.parentHabitat !== parent) return false;
            }
        } else if (isBuiltObject(parent)) {
            for (let index = 0; index < shipGroup.ships.length; ++index) {
                const ship = shipOf(shipGroup.ships[index]);
                if (ship !== null && !ship.hasBeenDestroyed && ship.builtAt === null && ship.parentBuiltObject !== parent) return false;
            }
        }
    }
    return true;
}

/** ShipGroup.cs 1310 ObtainCharacters. */
export function shipGroupObtainCharacters(shipGroup: ShipGroup): Character[] {
    const characters: Character[] = [];
    if (shipGroup.ships !== null) {
        for (let index = 0; index < shipGroup.ships.length; ++index) {
            const ship = shipOf(shipGroup.ships[index]);
            if (ship !== null && ship.characters !== null && ship.characters.length > 0) {
                for (let i = 0; i < ship.characters.length; i++) characters.push(ship.characters[i] as Character);
            }
        }
    }
    return characters;
}

/** ShipGroup.cs 1325 CheckShipMissionContainsHyperAndOtherAction(ship, otherAction, actionTarget). */
function checkShipMissionContainsHyperAndOtherAction(ship: BuiltObject | null, otherAction: CommandAction, actionTarget: StellarObject | null): boolean {
    const mission = ship !== null ? missionOf(ship) : null;
    if (ship !== null && mission !== null) {
        const commandArray = mission.showAllCommands();
        let flag1 = false;
        let flag2 = false;
        for (let index = 0; index < commandArray.length; ++index) {
            if (commandArray[index].action === CommandAction.HyperTo || commandArray[index].action === CommandAction.ConditionalHyperTo) {
                flag1 = true;
            } else if (commandArray[index].action === otherAction) {
                if (actionTarget !== null && isHabitat(actionTarget)) {
                    if (commandArray[index].targetHabitat !== null && commandArray[index].targetHabitat === actionTarget) flag2 = true;
                } else if (actionTarget !== null && isBuiltObject(actionTarget)) {
                    if (commandArray[index].targetBuiltObject !== null && commandArray[index].targetBuiltObject === actionTarget) flag2 = true;
                } else if (actionTarget !== null && isCreature(actionTarget) && commandArray[index].targetCreature !== null && commandArray[index].targetCreature === actionTarget) {
                    flag2 = true;
                }
            }
            if (flag1 && flag2) return true;
        }
    }
    return false;
}

/** ResourceList.IndexOf(resourceId) over the fuel list. */
function fuelIndexOf(list: readonly FuelTypeRef[], resourceId: number): number {
    for (let index = 0; index < list.length; ++index) {
        if (list[index].resourceId === resourceId) return index;
    }
    return -1;
}

/**
 * ShipGroup.cs 1361/1368 CheckShipsRequiringRefuelling(requiredFuelLevel, out requiredFuel[, includeShipsAlreadyRefuelling]).
 * Returns the count and the `out` fuel list (Resource.SortTag = fuel needed).
 */
export function shipGroupCheckShipsRequiringRefuelling(shipGroup: ShipGroup, requiredFuelLevel: number, includeShipsAlreadyRefuelling = false): { count: number; requiredFuel: FuelTypeRef[] } {
    let num1 = 0;
    const requiredFuel: FuelTypeRef[] = [];
    for (let index1 = 0; index1 < shipGroup.ships.length; ++index1) {
        const ship = shipGroup.ships[index1];
        const m = missionOf(ship);
        if ((m === null || (m.type !== BuiltObjectMissionType.Refuel && m.type !== BuiltObjectMissionType.Repair) || includeShipsAlreadyRefuelling) && ship.builtAt === null) {
            const num2 = ship.fuelCapacity - Math.trunc(ship.currentFuel);
            let index2 = -1;
            if (ship.fuelType !== null) index2 = fuelIndexOf(requiredFuel, ship.fuelType.resourceId);
            if (index2 >= 0) requiredFuel[index2].sortTag += num2;
            else if (ship.fuelType !== null) requiredFuel.push({ resourceId: ship.fuelType.resourceId, sortTag: num2 });
            if (ship.currentFuel < ship.fuelCapacity * requiredFuelLevel) ++num1;
        }
    }
    return { count: num1, requiredFuel };
}

/** ShipGroup.cs 1398 CalculateRequiredFuel. */
export function shipGroupCalculateRequiredFuel(shipGroup: ShipGroup): FuelTypeRef[] {
    const requiredFuel: FuelTypeRef[] = [];
    for (let index1 = 0; index1 < shipGroup.ships.length; ++index1) {
        const ship = shipOf(shipGroup.ships[index1]);
        if (ship !== null && ship.builtAt === null) {
            const num = ship.fuelCapacity - Math.trunc(ship.currentFuel);
            let index2 = -1;
            if (ship.fuelType !== null) index2 = fuelIndexOf(requiredFuel, ship.fuelType.resourceId);
            if (index2 >= 0) requiredFuel[index2].sortTag += num;
            else if (ship.fuelType !== null) requiredFuel.push({ resourceId: ship.fuelType.resourceId, sortTag: num });
        }
    }
    return requiredFuel;
}

/** ShipGroup.cs 1422 ForceCompleteMission(). */
export function forceCompleteMission(galaxy: Galaxy, shipGroup: ShipGroup): void {
    forceCompleteMissionInform(galaxy, shipGroup);
}

/** ShipGroup.cs 1424 ForceCompleteMission(out anotherMissionAssigned) → anotherMissionAssigned. */
export function forceCompleteMissionInform(galaxy: Galaxy, shipGroup: ShipGroup): boolean {
    if (shipGroup.mission !== null) {
        shipGroup.mission.clear();
    }
    forceClearMissionFromShips(galaxy, shipGroup);
    if (!assignQueuedMission(galaxy, shipGroup)) {
        return false;
    }
    return true;
}

/** ShipGroup.cs 1439 AssignQueuedMission. */
function assignQueuedMission(galaxy: Galaxy, shipGroup: ShipGroup): boolean {
    if (shipGroup.subsequentMissions === null || shipGroup.subsequentMissions.length <= 0) {
        return false;
    }
    const subsequentMission = shipGroup.subsequentMissions[0];
    if (subsequentMission != null) {
        switch (subsequentMission.type) {
            case BuiltObjectMissionType.Blockade:
                if (subsequentMission.targetBuiltObject !== null) {
                    implementBlockade(galaxy, shipGroup.empire!, subsequentMission.targetBuiltObject, false, false);
                    shipGroupAssignMission(galaxy, shipGroup, BuiltObjectMissionType.Blockade, subsequentMission.targetBuiltObject, null, BuiltObjectMissionPriority.High, false);
                    break;
                }
                if (subsequentMission.targetHabitat !== null) {
                    implementBlockade(galaxy, shipGroup.empire!, subsequentMission.targetHabitat, false, false);
                    shipGroupAssignMission(galaxy, shipGroup, BuiltObjectMissionType.Blockade, subsequentMission.targetHabitat, null, BuiltObjectMissionPriority.High, false);
                    break;
                }
                break;
            case BuiltObjectMissionType.Retrofit:
                if (shipGroup.empire !== null) {
                    assignFleetRetrofit(galaxy, shipGroup.empire, shipGroup, null, !subsequentMission.manuallyAssigned);
                }
                break;
            default:
                shipGroupAssignMissionFull(galaxy, shipGroup, subsequentMission.type, subsequentMission.target, subsequentMission.secondaryTarget, subsequentMission.cargo, subsequentMission.design, subsequentMission.x, subsequentMission.y, subsequentMission.starDate, subsequentMission.priority, false);
                break;
        }
        const i = shipGroup.subsequentMissions.indexOf(subsequentMission);
        if (i >= 0) shipGroup.subsequentMissions.splice(i, 1);
    }
    return true;
}

/** Removes every listed mission from the subsequent missions (SyncList.Remove per entry, first occurrence). */
function removeSubsequentMissions(shipGroup: ShipGroup, list: BuiltObjectMission[]): void {
    for (const m of list) {
        const i = shipGroup.subsequentMissions.indexOf(m);
        if (i >= 0) shipGroup.subsequentMissions.splice(i, 1);
    }
}

/** ShipGroup.cs 1478/1480 ClearAllMissionsForTarget(shipGroup, Empire target[, missionType]). */
export function shipGroupClearAllMissionsForTargetEmpire(galaxy: Galaxy, shipGroup: ShipGroup | null, target: Empire | null, missionType: BuiltObjectMissionType = BuiltObjectMissionType.Undefined): void {
    if (shipGroup === null) return;
    const mission = shipGroup.mission;
    if (mission !== null && (missionType === BuiltObjectMissionType.Undefined || mission.type === missionType)) {
        if (BuiltObjectMission.resolveMissionTargetEmpire(mission) === target) forceCompleteMission(galaxy, shipGroup);
        if (BuiltObjectMission.resolveMissionSecondaryTargetEmpire(mission) === target) forceCompleteMission(galaxy, shipGroup);
    }
    const objectMissionList: BuiltObjectMission[] = [];
    if (shipGroup.subsequentMissions === null) return;
    for (let index = 0; index < shipGroup.subsequentMissions.length; ++index) {
        const subsequentMission = shipGroup.subsequentMissions[index];
        if (subsequentMission != null && (missionType === BuiltObjectMissionType.Undefined || subsequentMission.type === missionType)) {
            if (BuiltObjectMission.resolveMissionTargetEmpire(subsequentMission) === target) objectMissionList.push(subsequentMission);
            if (BuiltObjectMission.resolveMissionSecondaryTargetEmpire(subsequentMission) === target) objectMissionList.push(subsequentMission);
        }
    }
    removeSubsequentMissions(shipGroup, objectMissionList);
}

/** ShipGroup.cs 1513/1515 ClearAllMissionsForTarget(shipGroup, BuiltObject target[, missionType]). */
export function shipGroupClearAllMissionsForTargetBuiltObject(galaxy: Galaxy, shipGroup: ShipGroup | null, target: BuiltObject, missionType: BuiltObjectMissionType = BuiltObjectMissionType.Undefined): void {
    if (shipGroup === null) return;
    const mission = shipGroup.mission;
    if (mission !== null && (missionType === BuiltObjectMissionType.Undefined || mission.type === missionType)) {
        if (mission.targetBuiltObject !== null && mission.targetBuiltObject === target) forceCompleteMission(galaxy, shipGroup);
        if (mission.secondaryTargetBuiltObject !== null && mission.secondaryTargetBuiltObject === target) forceCompleteMission(galaxy, shipGroup);
    }
    const objectMissionList: BuiltObjectMission[] = [];
    if (shipGroup.subsequentMissions === null) return;
    for (let index = 0; index < shipGroup.subsequentMissions.length; ++index) {
        const subsequentMission = shipGroup.subsequentMissions[index];
        if (subsequentMission != null && (missionType === BuiltObjectMissionType.Undefined || subsequentMission.type === missionType)) {
            if (subsequentMission.targetBuiltObject !== null && subsequentMission.targetBuiltObject === target) objectMissionList.push(subsequentMission);
            if (subsequentMission.secondaryTargetBuiltObject !== null && subsequentMission.secondaryTargetBuiltObject === target) objectMissionList.push(subsequentMission);
        }
    }
    removeSubsequentMissions(shipGroup, objectMissionList);
}

/** ShipGroup.cs 1548/1550 ClearAllMissionsForTarget(shipGroup, Habitat target[, missionType]). */
export function shipGroupClearAllMissionsForTargetHabitat(galaxy: Galaxy, shipGroup: ShipGroup | null, target: Habitat, missionType: BuiltObjectMissionType = BuiltObjectMissionType.Undefined): void {
    if (shipGroup === null) return;
    const mission = shipGroup.mission;
    if (mission !== null && (missionType === BuiltObjectMissionType.Undefined || mission.type === missionType)) {
        if (mission.targetHabitat !== null && mission.targetHabitat === target) forceCompleteMission(galaxy, shipGroup);
        if (mission.secondaryTargetHabitat !== null && mission.secondaryTargetHabitat === target) forceCompleteMission(galaxy, shipGroup);
    }
    const objectMissionList: BuiltObjectMission[] = [];
    if (shipGroup.subsequentMissions === null) return;
    for (let index = 0; index < shipGroup.subsequentMissions.length; ++index) {
        const subsequentMission = shipGroup.subsequentMissions[index];
        if (subsequentMission != null && (missionType === BuiltObjectMissionType.Undefined || subsequentMission.type === missionType)) {
            if (subsequentMission.targetHabitat !== null && subsequentMission.targetHabitat === target) objectMissionList.push(subsequentMission);
            if (subsequentMission.secondaryTargetHabitat !== null && subsequentMission.secondaryTargetHabitat === target) objectMissionList.push(subsequentMission);
        }
    }
    removeSubsequentMissions(shipGroup, objectMissionList);
}

/** ShipGroup.cs 1583 DetermineFuelTypes. */
export function shipGroupDetermineFuelTypes(shipGroup: ShipGroup): FuelTypeRef[] {
    const fuelTypes: FuelTypeRef[] = [];
    for (let index = 0; index < shipGroup.ships.length; ++index) {
        const ship = shipOf(shipGroup.ships[index]);
        // ResourceList.Contains compares ResourceID; a new Resource has SortTag 0.
        if (ship !== null && !ship.hasBeenDestroyed && ship.fuelType !== null && fuelIndexOf(fuelTypes, ship.fuelType.resourceId) < 0) {
            fuelTypes.push({ resourceId: ship.fuelType.resourceId, sortTag: 0 });
        }
    }
    return fuelTypes;
}

/** ShipGroup.cs 1595 CheckRefuelManual(). */
export function checkRefuelManual(galaxy: Galaxy, shipGroup: ShipGroup): boolean {
    return shipGroup.leadShip !== null && !shipGroup.leadShip.isAutoControlled && checkRefuelManualAt(galaxy, shipGroup, Math.max(0.3, shipGroupCalculateRefuellingPortion(galaxy, shipGroup, false)));
}

/** A refuel mission to the refuelling point when it is in the lead ship's system (ShipGroup.cs 1624-1641 / 1643-1660). */
function refuelIfInLeadSystem(galaxy: Galaxy, shipGroup: ShipGroup, leadShip: BuiltObject, point: StellarObject | null): boolean {
    if (point !== null && isBuiltObject(point)) {
        if (point.nearestSystemStar === leadShip.nearestSystemStar) {
            shipGroupAssignMission(galaxy, shipGroup, BuiltObjectMissionType.Refuel, point, null, BuiltObjectMissionPriority.Unavailable, false);
            return true;
        }
    } else if (point !== null && isHabitat(point)) {
        if (galaxy.determineHabitatSystemStar(point) === leadShip.nearestSystemStar) {
            shipGroupAssignMission(galaxy, shipGroup, BuiltObjectMissionType.Refuel, point, null, BuiltObjectMissionPriority.Unavailable, false);
            return true;
        }
    }
    return false;
}

/** ShipGroup.cs 1597 CheckRefuelManual(requiredFuelLevel). */
function checkRefuelManualAt(galaxy: Galaxy, shipGroup: ShipGroup, requiredFuelLevel: number): boolean {
    const leadShip = shipGroup.leadShip;
    if (leadShip !== null && !leadShip.isAutoControlled) {
        let flag = false;
        if (shipGroup.mission === null) {
            flag = true;
        } else {
            switch (shipGroup.mission.type) {
                case BuiltObjectMissionType.Undefined:
                case BuiltObjectMissionType.Patrol:
                case BuiltObjectMissionType.Escort:
                case BuiltObjectMissionType.Blockade:
                case BuiltObjectMissionType.Hold:
                    flag = true;
                    break;
            }
            if (shipGroup.mission.priority === BuiltObjectMissionPriority.Low) flag = true;
        }
        if (flag && shipGroupCheckShipsRequiringRefuelling(shipGroup, requiredFuelLevel).count > 0) {
            const requiredFuel = shipGroupCalculateRequiredFuel(shipGroup);
            const nearestRefuellingPoint1 = fastFindNearestRefuellingPoint(galaxy, leadShip.xpos, leadShip.ypos, requiredFuel, shipGroup.empire, leadShip, true, null, shipGroup.ships.length);
            if (refuelIfInLeadSystem(galaxy, shipGroup, leadShip, nearestRefuellingPoint1)) return true;
            const nearestRefuellingPoint2 = fastFindNearestRefuellingPoint(galaxy, leadShip.xpos, leadShip.ypos, requiredFuel, shipGroup.empire, leadShip, true, null, 1);
            if (refuelIfInLeadSystem(galaxy, shipGroup, leadShip, nearestRefuellingPoint2)) return true;
        }
    }
    return false;
}

/** Empire.9.cs 1352 CheckAtWarWithEmpire(empire). */
export function checkAtWarWithEmpire(self: Empire, empire: Empire): boolean {
    const diplomaticRelation = obtainDiplomaticRelation(self, empire);
    return diplomaticRelation.type === DiplomaticRelationType.War;
}

/** ShipGroup.cs 1670 CheckRefuelRepairAttack(completedAttackMission, attackEmpire). */
export function checkRefuelRepairAttack(galaxy: Galaxy, shipGroup: ShipGroup, completedAttackMission: boolean, attackEmpire: Empire | null): boolean {
    let leadShip1 = shipGroup.leadShip;
    if (leadShip1 !== null && leadShip1.isAutoControlled && shipGroup.ships !== null) {
        // 1675-1694: damaged ships go for repair (or are dropped when immobile) and leave the fleet.
        const builtObjectList: BuiltObject[] = [];
        for (let index = 0; index < shipGroup.ships.length; ++index) {
            const ship = shipOf(shipGroup.ships[index]);
            if (ship !== null && ship.damagedComponentCount > 0 && shipGroup.empire !== null && shipGroup.empire.controlMilitaryFleets) {
                if (ship.topSpeed <= 0 || (ship.warpSpeed <= 0 && ship.design.warpSpeed > 0)) {
                    builtObjectList.push(ship);
                } else {
                    const m = missionOf(ship);
                    if ((m === null || m.type !== BuiltObjectMissionType.Repair) && ship.isAutoControlled) {
                        if (shipGroup.leadShip === ship) {
                            shipGroupDetermineLeadShip(galaxy, shipGroup, ship);
                            leadShip1 = shipGroup.leadShip;
                        }
                        builtObjectList.push(ship);
                        assignRepairMission(galaxy, shipGroup.empire, ship);
                    }
                }
            }
        }
        for (let index = 0; index < builtObjectList.length; ++index) {
            leaveShipGroup(galaxy, builtObjectList[index]);
        }
        // 1695-1726
        const refuellingPortion = shipGroupCalculateRefuellingPortion(galaxy, shipGroup, true);
        let flag = false;
        const mission1 = shipGroup.mission;
        if (mission1 === null) {
            flag = true;
        } else if (mission1.priority === BuiltObjectMissionPriority.Unavailable) {
            flag = false;
        } else {
            switch (mission1.type) {
                case BuiltObjectMissionType.Undefined:
                case BuiltObjectMissionType.Patrol:
                case BuiltObjectMissionType.Escort:
                case BuiltObjectMissionType.Blockade:
                case BuiltObjectMissionType.Hold:
                    flag = true;
                    break;
            }
            if (mission1.priority === BuiltObjectMissionPriority.Low) flag = true;
        }
        if (flag && leadShip1 !== null && leadShip1.isAutoControlled && shipGroupCheckShipsRequiringRefuelling(shipGroup, refuellingPortion).count > Math.trunc(shipGroup.ships.length * 0.0)) {
            const requiredFuel = shipGroupCalculateRequiredFuel(shipGroup);
            assignFleetRefuelling(galaxy, shipGroup.empire!, shipGroup, requiredFuel);
            return true;
        }
        // 1727-1774
        if (completedAttackMission && (shipGroup.posture === FleetPosture.Attack || (leadShip1 !== null && leadShip1.isAutoControlled))) {
            if (leadShip1 !== null && attackEmpire === null) {
                const empiresAtWarWith = determineEmpiresAtWarWith(galaxy, shipGroup.empire!).empires;
                if (empiresAtWarWith !== null && empiresAtWarWith.length > 0) {
                    let empire1: Empire | null = null;
                    let num = Number.MAX_VALUE;
                    for (let index = 0; index < empiresAtWarWith.length; ++index) {
                        const empire2 = empiresAtWarWith[index];
                        // ShipGroup.cs 1743 reads empire2.Capital.Xpos with no null check (unlike the
                        // analogous loop at ShipGroup.cs 1211 / CheckForMissionCompletion, guarded with
                        // `empire3 != null && empire3.Capital != null`, ported above at ~935). In the
                        // original engine that's safe: an empire that loses its last colony is torn down
                        // synchronously (Empire.1.cs TakeOwnershipOfColony → CompleteTeardown), which
                        // removes the War DiplomaticRelation from every other empire before their fleets'
                        // ShipGroup.DoTasks runs, so DetermineEmpiresAtWarWith() never returns a
                        // capital-less empire. Our takeOwnershipOfColony (empire.ts) doesn't yet port that
                        // teardown/elimination step (see its TODO), so a defeated empire with capital ===
                        // null can still show up here — guard it the same way the sibling loop does.
                        if (empire2 != null && empire2.capital !== null) {
                            const distance = galaxy.calculateDistance(empire2.capital.xpos, empire2.capital.ypos, leadShip1.xpos, leadShip1.ypos);
                            if (distance < num) {
                                num = distance;
                                empire1 = empire2;
                            }
                        }
                    }
                    attackEmpire = empire1;
                }
            }
            if (attackEmpire !== null && shipGroup.empire !== null && checkAtWarWithEmpire(shipGroup.empire, attackEmpire)) {
                const r = selectFleetWarAttackTarget(galaxy, shipGroup.empire, shipGroup, attackEmpire);
                const stellarObject = r.target;
                const waypointing = r.waypointing;
                if (stellarObject !== null && !waypointing) {
                    let missionType = BuiltObjectMissionType.Attack;
                    if (isHabitat(stellarObject) && checkBombardEnemyColony(galaxy, shipGroup.empire, stellarObject, shipGroup)) {
                        missionType = BuiltObjectMissionType.Bombard;
                    }
                    if (shipGroupCheckFleetTargetWithinFuelRangeAndRefuel(galaxy, shipGroup, stellarObject.xpos, stellarObject.ypos, 0.1)) {
                        shipGroupAssignMission(galaxy, shipGroup, missionType, stellarObject, null, BuiltObjectMissionPriority.High, false);
                    }
                } else if (!waypointing) {
                    const targets = identifyEmpireStrikePoints(galaxy, shipGroup.empire, attackEmpire);
                    const refusalCount = { value: 0 };
                    if (assignFleetAttackMission(galaxy, shipGroup.empire, shipGroup, targets, refusalCount)) {
                        return true;
                    }
                }
            }
        }
        // 1775-1776: Empire != null && ((Ships != null && Posture == Attack && LeadShip != null && LeadShip.IsAutoControlled
        //            && CoordinateFleetAttacksWithAllies(this, Empire, null)) || Empire.CoordinateFleetAttacksWithAllies(this))
        if (
            shipGroup.empire !== null &&
            ((shipGroup.ships !== null && shipGroup.posture === FleetPosture.Attack && shipGroup.leadShip !== null && shipGroup.leadShip.isAutoControlled && coordinateFleetAttacksWithAlliesOf(galaxy, shipGroup.empire, shipGroup, shipGroup.empire, null)) ||
                coordinateFleetAttacksWithAllies(galaxy, shipGroup.empire, shipGroup))
        ) {
            return true;
        }
        // 1777-1810
        const mission2 = shipGroup.mission;
        if (mission2 === null || mission2.type === BuiltObjectMissionType.Undefined) {
            const gatherPoint = shipGroup.gatherPoint;
            const leadShip2 = shipGroup.leadShip;
            if (gatherPoint !== null && leadShip2 !== null && (galaxy.calculateDistanceSquared(leadShip2.xpos, leadShip2.ypos, gatherPoint.xpos, gatherPoint.ypos) > 9000000.0 || !shipGroupCheckAllShipsHaveParent(shipGroup, gatherPoint))) {
                let num1 = 0;
                let num2 = 0;
                for (let index = 0; index < shipGroup.ships.length; ++index) {
                    const ship = shipOf(shipGroup.ships[index]);
                    if (ship !== null) {
                        const mission3 = missionOf(ship);
                        if (mission3 !== null) {
                            if (mission3.type === BuiltObjectMissionType.Attack || mission3.type === BuiltObjectMissionType.Bombard || mission3.type === BuiltObjectMissionType.Capture || mission3.type === BuiltObjectMissionType.Raid) ++num1;
                            else if (mission3.type === BuiltObjectMissionType.Move && mission3.targetHabitat === gatherPoint) ++num2;
                            else if (mission3.type === BuiltObjectMissionType.Move && mission3.targetBuiltObject === gatherPoint) ++num2;
                        }
                    }
                }
                if (num1 <= 0 && num2 <= 0 && shipGroupCheckFleetTargetWithinFuelRange(galaxy, shipGroup, gatherPoint.xpos, gatherPoint.ypos, 0.0)) {
                    shipGroupAssignMission(galaxy, shipGroup, BuiltObjectMissionType.Move, gatherPoint, null, BuiltObjectMissionPriority.Low, false);
                    return true;
                }
            }
        }
    }
    return false;
}

/** ShipGroup.cs 1814 CheckRefuelLocationRangeAcceptable(refuellingLocation). */
export function shipGroupCheckRefuelLocationRangeAcceptable(galaxy: Galaxy, shipGroup: ShipGroup, refuellingLocation: StellarObject | null): boolean {
    if (refuellingLocation !== null) {
        if (shipGroupWarpSpeed(shipGroup) <= 0) {
            if (!shipGroupCheckFleetTargetWithinFuelRange(galaxy, shipGroup, refuellingLocation.xpos, refuellingLocation.ypos, 0.0)) {
                const leadShip = shipGroup.leadShip;
                if (leadShip !== null && galaxy.calculateDistanceSquared(leadShip.xpos, leadShip.ypos, refuellingLocation.xpos, refuellingLocation.ypos) > 2304000000.0) return false;
            }
        } else if (shipGroupWarpSpeed(shipGroup) < 2500 && !shipGroupCheckFleetTargetWithinFuelRange(galaxy, shipGroup, refuellingLocation.xpos, refuellingLocation.ypos, 0.0)) {
            const leadShip = shipGroup.leadShip;
            if (leadShip !== null && galaxy.calculateDistanceSquared(leadShip.xpos, leadShip.ypos, refuellingLocation.xpos, refuellingLocation.ypos) > 2304000000.0) return false;
        }
    }
    return true;
}

/** ShipGroup.cs 1837 CompleteMission() → CompleteMission(true). */
export function shipGroupCompleteMission(galaxy: Galaxy, shipGroup: ShipGroup): boolean {
    return shipGroupCompleteMissionWith(galaxy, shipGroup, true);
}

/** ShipGroup.cs 1839 CompleteMission(clearShipMissions). */
export function shipGroupCompleteMissionWith(galaxy: Galaxy, shipGroup: ShipGroup, clearShipMissions: boolean): boolean {
    let objectMissionType = BuiltObjectMissionType.Undefined;
    if (shipGroup.mission !== null) {
        objectMissionType = shipGroup.mission.type;
        shipGroup.mission.resolveMissionTargetHabitatIfPossible();
        shipGroup.mission.clear();
    }
    if (clearShipMissions) {
        clearMissionFromShips(galaxy, shipGroup);
    }
    if (assignQueuedMission(galaxy, shipGroup)) {
        return true;
    }
    if (objectMissionType === BuiltObjectMissionType.Attack) {
        if (checkRefuelRepairAttack(galaxy, shipGroup, true, null)) return true;
    } else if (checkRefuelRepairAttack(galaxy, shipGroup, false, null)) {
        return true;
    }
    return false;
}

/** ShipGroup.cs 1870 ForceClearMissionFromShips. */
function forceClearMissionFromShips(galaxy: Galaxy, shipGroup: ShipGroup): void {
    for (let index = 0; index < shipGroup.ships.length; ++index) {
        const ship = shipOf(shipGroup.ships[index]);
        if (ship !== null && ship.builtAt === null) {
            clearPreviousMissionRequirements(galaxy, ship);
            ship.revertMission = null;
        }
    }
}

/** ShipGroup.cs 1883 ClearMissionFromShips. */
function clearMissionFromShips(galaxy: Galaxy, shipGroup: ShipGroup): void {
    for (let index = 0; index < shipGroup.ships.length; ++index) {
        const ship = shipGroup.ships[index];
        if (shipGroupIsShipAvailable(ship)) {
            clearPreviousMissionRequirements(galaxy, ship);
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// AssignMission / QueueMission (ShipGroup.cs 2028-2159, 2392-2455)
// ---------------------------------------------------------------------------------------------------------------

/**
 * ShipGroup.cs 2028-2084 AssignMission overloads (missionType, target, target2[, starDate | x, y], priority,
 * manuallyAssigned): cargo/design null, x/y -2000000001.0, starDate -1 unless given.
 */
export function shipGroupAssignMission(
    galaxy: Galaxy,
    shipGroup: ShipGroup,
    missionType: BuiltObjectMissionType,
    target: MissionTarget | null,
    target2: MissionTarget | null,
    priority: BuiltObjectMissionPriority,
    manuallyAssigned: boolean,
    coords: { x: number; y: number } | null = null,
    starDate = -1,
): boolean {
    const x = coords !== null ? coords.x : COORD_UNSET_DOUBLE;
    const y = coords !== null ? coords.y : COORD_UNSET_DOUBLE;
    return shipGroupAssignMissionFull(galaxy, shipGroup, missionType, target, target2, null, null, x, y, starDate, priority, manuallyAssigned);
}

/**
 * ShipGroup.cs 2097 AssignMission(missionType, target, target2, cargo, design, x, y, starDate, priority, manuallyAssigned).
 * Rnd: NextDouble ×2 for a Move to a star without coordinates; the fleet mission's ResolveCommandsForMission; per ship
 * SelectRelativePoint + the ship's own mission.
 */
export function shipGroupAssignMissionFull(
    galaxy: Galaxy,
    shipGroup: ShipGroup,
    missionType: BuiltObjectMissionType,
    target: MissionTarget | null,
    target2: MissionTarget | null,
    cargo: CargoList | null,
    design: Design | null,
    x: number,
    y: number,
    starDate: number,
    priority: BuiltObjectMissionPriority,
    manuallyAssigned: boolean,
): boolean {
    shipGroup.allowImmediateThreatEvaluation = false;
    let builtObject = shipGroup.leadShip;
    if (builtObject === null) {
        if (shipGroup.ships.length <= 0) {
            return false;
        }
        builtObject = shipGroup.ships[0];
    }
    // 2117-2137: a Move to a star parks at a random point around it.
    if (missionType === BuiltObjectMissionType.Move && target !== null && isHabitat(target)) {
        const habitat = target;
        if (habitat.category === HabitatCategoryType.Star) {
            let num1: number;
            let num2: number;
            if (x > -2000000001.0 && y > -2000000001.0) {
                num1 = x;
                num2 = y;
            } else {
                const num3 = galaxy.rnd.nextDouble() * Math.PI * 2.0;
                let num4: number;
                if (habitat.type !== HabitatType.BlackHole) {
                    if (habitat.type !== HabitatType.SuperNova) {
                        num4 = habitat.category !== HabitatCategoryType.Star ? habitat.diameter * 0.67 + galaxy.rnd.nextDouble() * 150.0 : habitat.diameter * 0.67 + galaxy.rnd.nextDouble() * 300.0;
                    } else {
                        num4 = galaxy.rnd.nextDouble() * 300.0;
                    }
                } else {
                    num4 = habitat.diameter * 0.7 + galaxy.rnd.nextDouble() * 500.0;
                }
                num1 = num4 * Math.sin(num3);
                num2 = num4 * Math.cos(num3);
            }
            x = num1;
            y = num2;
        }
    }
    if (target === null && target2 === null && x <= -2000000001.0 && y <= -2000000001.0) {
        return false;
    }
    // 2141: new BuiltObjectMission(..., priority, allowReprocessing: false, allowBuiltObjectChanges: false, specifiedAsFleetMission: true).
    const mission = new BuiltObjectMission(galaxy, builtObject, missionType, target, target2, priority, {
        cargo,
        design,
        x,
        y,
        starDate,
        allowReprocessing: false,
        allowBuiltObjectChanges: false,
        specifiedAsFleetMission: true,
    });
    shipGroup.mission = mission;
    if (!assignMissionToShips(galaxy, shipGroup, mission, manuallyAssigned)) {
        shipGroup.mission = null;
        return false;
    }
    setAttackRange(shipGroup, missionType, manuallyAssigned);
    if (isCombatMissionType(missionType)) {
        checkForCompletedBattle(galaxy, shipGroup);
        if (shipGroup.battleStats === null) {
            // BattleStats = new SpaceBattleStats() (M4o owns the type).
            startNewShipGroupBattleStats(galaxy, shipGroup);
        }
    }
    return true;
}

/** Position / strength / gather range of a target, as the switch arms of ShipGroup.cs 2161 / 2268 (Empire reads unused). */
function gatherTargetInfo(galaxy: Galaxy, target: MissionTarget | null): { x: number; y: number; strength: number; range: number } {
    let x = 0.0;
    let y = 0.0;
    let strength = 0;
    let range = 0;
    if (target !== null && isBuiltObject(target)) {
        x = target.xpos;
        y = target.ypos;
        strength = calculateOverallStrengthFactor(target);
        range = target.role === BuiltObjectRole.Base || target.topSpeed <= 0 ? target.maximumWeaponsRange + 100 : 5000;
    } else if (target !== null && isHabitat(target)) {
        x = target.xpos;
        y = target.ypos;
        if (target.basesAtHabitat !== null && target.basesAtHabitat.length > 0) {
            for (let index = 0; index < target.basesAtHabitat.length; ++index) strength += calculateOverallStrengthFactor(target.basesAtHabitat[index]);
        }
        range = 600;
    } else if (target !== null && isCreature(target)) {
        x = target.xpos;
        y = target.ypos;
        strength += target.attackStrength * 5;
        range = 1000;
    } else if (target !== null && isShipGroup(target)) {
        if (target.leadShip !== null) {
            x = target.leadShip.xpos;
            y = target.leadShip.ypos;
            strength += shipGroupTotalOverallStrengthFactor(galaxy, target);
        }
        range = 1000;
    }
    return { x, y, strength, range };
}

/** ShipGroup.cs 2161 CheckNeedGatherBeforeAttack(target, out targetGatherRange, out targetX, out targetY). */
export function shipGroupCheckNeedGatherBeforeAttack(galaxy: Galaxy, shipGroup: ShipGroup, target: MissionTarget | null): { result: boolean; targetGatherRange: number; targetX: number; targetY: number } {
    const info = gatherTargetInfo(galaxy, target);
    const num1 = info.strength;
    let num2 = 0;
    let num3 = 0;
    if (shipGroup.leadShip !== null) {
        for (let index = 0; index < shipGroup.ships.length; ++index) {
            const ship = shipGroup.ships[index];
            if (shipGroupIsShipAvailable(ship)) {
                if (galaxy.calculateDistanceSquared(ship.xpos, ship.ypos, shipGroup.leadShip.xpos, shipGroup.leadShip.ypos) > 2304000000.0) ++num2;
                else num3 += calculateOverallStrengthFactor(ship);
            }
        }
        if (num2 / shipGroup.ships.length > shipGroup.empire!.fleetAttackGatherPortion && num3 < num1) {
            return { result: true, targetGatherRange: info.range, targetX: info.x, targetY: info.y };
        }
    }
    return { result: false, targetGatherRange: info.range, targetX: info.x, targetY: info.y };
}

/** ShipGroup.cs 2233 IdentifyFleetGatherLocation(targetX, targetY, targetGatherRange, out gatherX, out gatherY). */
export function shipGroupIdentifyFleetGatherLocation(galaxy: Galaxy, shipGroup: ShipGroup, targetX: number, targetY: number, targetGatherRange: number): { gatherX: number; gatherY: number } {
    const leadShip = shipGroup.leadShip!;
    let gatherX = leadShip.xpos;
    let gatherY = leadShip.ypos;
    if (galaxy.calculateDistance(targetX, targetY, gatherX, gatherY) >= targetGatherRange) {
        return { gatherX, gatherY };
    }
    if (leadShip.nearestSystemStar !== null) {
        const system = galaxy.systems[leadShip.nearestSystemStar.systemIndex];
        if (system == null) {
            return { gatherX, gatherY };
        }
        const habitats = galaxy.systemHabitatsOf(leadShip.nearestSystemStar.systemIndex);
        if (habitats === null || habitats.length <= 0) {
            return { gatherX, gatherY };
        }
        const habitat = habitats[habitats.length - 1];
        if (habitat == null) {
            return { gatherX, gatherY };
        }
        const p = galaxy.selectRelativeParkingPoint(800.0);
        gatherX = habitat.xpos + p.x;
        gatherY = habitat.ypos + p.y;
    } else {
        const p = galaxy.selectRelativeParkingPoint(30000.0);
        gatherX = targetX + p.x;
        gatherY = targetY + p.y;
    }
    return { gatherX, gatherY };
}

/** ShipGroup.cs 2268 CheckNeedRefuelBeforeAttack(target). */
export function shipGroupCheckNeedRefuelBeforeAttack(galaxy: Galaxy, shipGroup: ShipGroup, target: MissionTarget | null): boolean {
    const info = gatherTargetInfo(galaxy, target);
    const r = countShipsWithinFuelRangeAndRefuel(galaxy, shipGroup, info.x, info.y, 0.05);
    return ((shipGroup.ships.length - r.count) / shipGroup.ships.length > shipGroup.empire!.fleetAttackRefuelPortion && r.firepowerWithinRange < info.strength) || !shipGroupCheckFleetTargetWithinFuelRange(galaxy, shipGroup, info.x, info.y, 0.0);
}

/** ShipGroup.cs 2321 SetAttackRange(missionType, manuallyAssigned). */
function setAttackRange(shipGroup: ShipGroup, missionType: BuiltObjectMissionType, manuallyAssigned: boolean): void {
    const empire = shipGroup.empire;
    if (empire === null) {
        return;
    }
    let num1 = empire.attackRangePatrol;
    let num2 = empire.attackRangeEscort;
    let num3 = empire.attackRangeAttack;
    let num4 = empire.attackRangeOther;
    const leadShip = shipGroup.leadShip;
    if ((leadShip !== null && !leadShip.isAutoControlled) || manuallyAssigned) {
        num1 = empire.attackRangePatrolManual;
        num2 = empire.attackRangeEscortManual;
        num3 = empire.attackRangeAttackManual;
        num4 = empire.attackRangeOtherManual;
    }
    const sq = (n: number): number => Math.fround(Math.fround(n) * Math.fround(n));
    if (missionType === BuiltObjectMissionType.Patrol && num1 >= 0) {
        shipGroup.attackRangeSquared = sq(num1);
        setShipAttackRanges(shipGroup, shipGroup.attackRangeSquared);
    } else if (missionType === BuiltObjectMissionType.Escort && num2 >= 0) {
        shipGroup.attackRangeSquared = sq(num2);
        setShipAttackRanges(shipGroup, shipGroup.attackRangeSquared);
    } else if (isCombatMissionType(missionType) && num3 >= 0) {
        shipGroup.attackRangeSquared = sq(num3);
        setShipAttackRanges(shipGroup, shipGroup.attackRangeSquared);
    } else if (num4 >= 0) {
        shipGroup.attackRangeSquared = sq(num4);
        setShipAttackRanges(shipGroup, shipGroup.attackRangeSquared);
    } else {
        if (shipGroup.attackRangeSquared >= 0.0 || leadShip === null || !leadShip.isAutoControlled) {
            return;
        }
        shipGroup.attackRangeSquared = ATTACK_RANGE_SQUARED_DEFAULT;
        setShipAttackRanges(shipGroup, shipGroup.attackRangeSquared);
    }
}

/** ShipGroup.cs 2366 SetShipAttackRanges(attackRangeSquared). */
function setShipAttackRanges(shipGroup: ShipGroup, attackRangeSquared: number): void {
    for (let index = 0; index < shipGroup.ships.length; ++index) {
        shipGroup.ships[index].attackRangeSquared = attackRangeSquared;
    }
}

/** ShipGroup.cs 2372 FindNearestAvailableShipToTarget(x, y). */
export function shipGroupFindNearestAvailableShipToTarget(galaxy: Galaxy, shipGroup: ShipGroup, x: number, y: number): BuiltObject | null {
    let num = Number.MAX_VALUE;
    let availableShipToTarget: BuiltObject | null = null;
    for (let index = 0; index < shipGroup.ships.length; ++index) {
        const ship = shipGroup.ships[index];
        if (shipGroupIsShipAvailable(ship)) {
            const distanceSquared = galaxy.calculateDistanceSquared(x, y, ship.xpos, ship.ypos);
            if (distanceSquared < num) {
                num = distanceSquared;
                availableShipToTarget = ship;
            }
        }
    }
    return availableShipToTarget;
}

/**
 * ShipGroup.cs 2392-2455 QueueMission overloads (missionType, target, target2[, design | x, y | cargo, design, x, y,
 * starDate], priority): a fleet mission appended to SubsequentMissions (BuiltObjectMission constructor with
 * allowReprocessing false, allowBuiltObjectChanges false, specifiedAsFleetMission true — Rnd through ResolveCommandsForMission).
 */
export function shipGroupQueueMission(
    galaxy: Galaxy,
    shipGroup: ShipGroup,
    missionType: BuiltObjectMissionType,
    target: MissionTarget | null,
    target2: MissionTarget | null,
    priority: BuiltObjectMissionPriority,
    args: { cargo?: CargoList | null; design?: Design | null; x?: number; y?: number; starDate?: number } = {},
): boolean {
    let builtObject = shipGroup.leadShip;
    if (builtObject === null) {
        if (shipGroup.ships.length <= 0) {
            return false;
        }
        builtObject = shipGroup.ships[0];
    }
    shipGroup.subsequentMissions.push(
        new BuiltObjectMission(galaxy, builtObject, missionType, target, target2, priority, {
            cargo: args.cargo ?? null,
            design: args.design ?? null,
            x: args.x ?? COORD_UNSET_DOUBLE,
            y: args.y ?? COORD_UNSET_DOUBLE,
            starDate: args.starDate ?? -1,
            allowReprocessing: false,
            allowBuiltObjectChanges: false,
            specifiedAsFleetMission: true,
        }),
    );
    return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Location / lead ship (ShipGroup.cs 2487-2726)
// ---------------------------------------------------------------------------------------------------------------

/** ShipGroup.cs 2487 IdentifyFleetSystem. */
export function shipGroupIdentifyFleetSystem(galaxy: Galaxy, shipGroup: ShipGroup): Habitat | null {
    const stellarObject = shipGroupIdentifyFleetLocation(shipGroup);
    if (stellarObject !== null && isHabitat(stellarObject)) return galaxy.determineHabitatSystemStar(stellarObject);
    if (stellarObject !== null && isBuiltObject(stellarObject)) return stellarObject.nearestSystemStar;
    if (stellarObject !== null && isCreature(stellarObject)) return stellarObject.nearestSystemStar;
    return null;
}

/** The mission types IdentifyFleetLocation keys on (ShipGroup.cs 2505 / 2530). */
function isFleetLocationMissionType(t: BuiltObjectMissionType): boolean {
    switch (t) {
        case BuiltObjectMissionType.Attack:
        case BuiltObjectMissionType.Blockade:
        case BuiltObjectMissionType.Bombard:
        case BuiltObjectMissionType.Hold:
        case BuiltObjectMissionType.Move:
        case BuiltObjectMissionType.MoveAndWait:
        case BuiltObjectMissionType.Patrol:
        case BuiltObjectMissionType.Refuel:
        case BuiltObjectMissionType.Repair:
        case BuiltObjectMissionType.Retrofit:
        case BuiltObjectMissionType.Capture:
        case BuiltObjectMissionType.Raid:
        case BuiltObjectMissionType.WaitAndAttack:
        case BuiltObjectMissionType.WaitAndBombard:
            return true;
        default:
            return false;
    }
}

/**
 * The shared body of IdentifyFleetLocation's two mission blocks (2507-2528 / 2532-2553). `undefined` = the block falls
 * through (a ship-group target without a lead ship falls through too; the C# `else if` then skips the habitat test).
 */
function fleetLocationFromMission(mission: BuiltObjectMission): StellarObject | undefined {
    if (mission.targetBuiltObject !== null) {
        const t = mission.targetBuiltObject;
        if (t.parentHabitat !== null) return t.parentHabitat;
        return t.nearestSystemStar !== null ? t.nearestSystemStar : t;
    }
    if (mission.targetCreature !== null) {
        const t = mission.targetCreature;
        if (t.parentHabitat !== null) return t.parentHabitat;
        return t.nearestSystemStar !== null ? t.nearestSystemStar : t;
    }
    if (mission.targetShipGroup !== null) {
        const lead = mission.targetShipGroup.leadShip;
        if (lead !== null) {
            if (lead.parentHabitat !== null) return lead.parentHabitat;
            return lead.nearestSystemStar !== null ? lead.nearestSystemStar : lead;
        }
    } else if (mission.targetHabitat !== null) {
        return mission.targetHabitat;
    }
    return undefined;
}

/** ShipGroup.cs 2503 IdentifyFleetLocation. */
export function shipGroupIdentifyFleetLocation(shipGroup: ShipGroup): StellarObject | null {
    if (shipGroup.mission !== null && isFleetLocationMissionType(shipGroup.mission.type)) {
        const r = fleetLocationFromMission(shipGroup.mission);
        if (r !== undefined) return r;
    }
    const leadShip = shipGroup.leadShip;
    if (leadShip === null) {
        return null;
    }
    const leadMission = missionOf(leadShip);
    if (leadMission !== null && isFleetLocationMissionType(leadMission.type)) {
        const r = fleetLocationFromMission(leadMission);
        if (r !== undefined) return r;
    }
    if (leadShip.parentHabitat !== null) return leadShip.parentHabitat;
    if (leadShip.parentBuiltObject !== null) return leadShip.parentBuiltObject;
    return leadShip.nearestSystemStar !== null ? leadShip.nearestSystemStar : leadShip;
}

/** GalaxyIndex (GalaxyIndex.cs: X, Y, SortTag). */
interface GalaxyIndex {
    x: number;
    y: number;
    sortTag: number;
}

/** ShipGroup.cs 2566 DetermineApproximateActualFleetLocation → Point. */
export function shipGroupDetermineApproximateActualFleetLocation(galaxy: Galaxy, shipGroup: ShipGroup): { x: number; y: number } {
    const leadShip = shipGroup.leadShip!;
    let x = leadShip.xpos;
    let y = leadShip.ypos;
    const r = determineIndexOfMostFleetShips(galaxy, shipGroup);
    const ofMostFleetShips = r.index!;
    const galaxyIndex = galaxy.resolveIndex(leadShip.xpos, leadShip.ypos);
    if ((ofMostFleetShips.x !== galaxyIndex.x || ofMostFleetShips.y !== galaxyIndex.y) && r.proportionInIndex > 0.66) {
        x = ofMostFleetShips.x * INDEX_SIZE - Math.trunc(INDEX_SIZE / 2);
        y = ofMostFleetShips.y * INDEX_SIZE - Math.trunc(INDEX_SIZE / 2);
    }
    return { x: Math.trunc(x), y: Math.trunc(y) };
}

/** ShipGroup.cs 2581 DetermineActualFleetLocation → Point. */
export function determineActualFleetLocation(galaxy: Galaxy, shipGroup: ShipGroup): { x: number; y: number } {
    const r = determineIndexOfMostFleetShips(galaxy, shipGroup);
    const leadShip = shipGroup.leadShip!;
    if (r.proportionInIndex <= 0.66) {
        return { x: Math.trunc(leadShip.xpos), y: Math.trunc(leadShip.ypos) };
    }
    const ofMostFleetShips = r.index!;
    let builtObject: BuiltObject | null = null;
    for (let index = 0; index < shipGroup.ships.length; ++index) {
        const ship = shipGroup.ships[index];
        const galaxyIndex = galaxy.resolveIndex(ship.xpos, ship.ypos);
        if (galaxyIndex.x === ofMostFleetShips.x && galaxyIndex.y === ofMostFleetShips.y && (builtObject === null || ship.size > builtObject.size)) {
            builtObject = ship;
        }
    }
    return builtObject !== null ? { x: Math.trunc(builtObject.xpos), y: Math.trunc(builtObject.ypos) } : { x: Math.trunc(leadShip.xpos), y: Math.trunc(leadShip.ypos) };
}

/** ShipGroup.cs 2598 DetermineIndexOfMostFleetShips(out proportionInIndex). */
function determineIndexOfMostFleetShips(galaxy: Galaxy, shipGroup: ShipGroup): { index: GalaxyIndex | null; proportionInIndex: number } {
    let proportionInIndex = 0.0;
    const galaxyIndexList: GalaxyIndex[] = [];
    for (let index1 = 0; index1 < shipGroup.ships.length; ++index1) {
        const ship = shipGroup.ships[index1];
        const r = galaxy.resolveIndex(ship.xpos, ship.ypos);
        const index2: GalaxyIndex = { x: r.x, y: r.y, sortTag: 0 };
        // GalaxyIndexList.Contains / IndexOf compare X and Y.
        let index3 = -1;
        for (let k = 0; k < galaxyIndexList.length; k++) {
            if (galaxyIndexList[k].x === index2.x && galaxyIndexList[k].y === index2.y) {
                index3 = k;
                break;
            }
        }
        if (index3 < 0) {
            index2.sortTag = 1;
            galaxyIndexList.push(index2);
        } else {
            ++galaxyIndexList[index3].sortTag;
        }
    }
    if (galaxyIndexList.length <= 0) {
        return { index: null, proportionInIndex };
    }
    // GalaxyIndex.CompareTo: SortTag.CompareTo; List.Sort (introsort) then Reverse.
    netSort(galaxyIndexList, (a, b) => (a.sortTag < b.sortTag ? -1 : a.sortTag > b.sortTag ? 1 : 0));
    galaxyIndexList.reverse();
    proportionInIndex = galaxyIndexList[0].sortTag / shipGroup.ships.length;
    return { index: galaxyIndexList[0], proportionInIndex };
}

/** ShipGroup.cs 2626 Update() → DetermineLeadShip(). */
export function shipGroupUpdate(galaxy: Galaxy, shipGroup: ShipGroup): void {
    shipGroupDetermineLeadShip(galaxy, shipGroup, null);
}

/** ShipGroup.cs 2628/2630 DetermineLeadShip([shipToExclude]). */
export function shipGroupDetermineLeadShip(galaxy: Galaxy, shipGroup: ShipGroup, shipToExclude: BuiltObject | null): void {
    let useFleetIndexing = true;
    const r = determineIndexOfMostFleetShips(galaxy, shipGroup);
    if (r.proportionInIndex < 0.4) {
        useFleetIndexing = false;
    }
    const strongestShip = shipGroupDetermineStrongestShip(galaxy, shipGroup, shipToExclude, useFleetIndexing, r.index);
    if (strongestShip !== null) {
        shipGroup.leadShip = strongestShip;
    } else {
        if (shipGroup.ships.length <= 0) {
            return;
        }
        shipGroup.leadShip = shipGroup.ships[0];
    }
}

/** ShipGroup.cs 2650 DetermineLargestShip(shipToExclude, useFleetIndexing, fleetIndex). */
export function shipGroupDetermineLargestShip(galaxy: Galaxy, shipGroup: ShipGroup, shipToExclude: BuiltObject | null, useFleetIndexing: boolean, fleetIndex: { x: number; y: number } | null): BuiltObject | null {
    let largestShip: BuiltObject | null = null;
    let num = 0;
    for (let index = 0; index < shipGroup.ships.length; ++index) {
        const ship = shipGroup.ships[index];
        if ((shipToExclude === null || ship !== shipToExclude) && ship.size > num) {
            if (useFleetIndexing) {
                const galaxyIndex = galaxy.resolveIndex(ship.xpos, ship.ypos);
                if (galaxyIndex.x === fleetIndex!.x && galaxyIndex.y === fleetIndex!.y) {
                    num = ship.size;
                    largestShip = ship;
                }
            } else {
                num = ship.size;
                largestShip = ship;
            }
        }
    }
    return largestShip;
}

/** ShipGroup.cs 2681 DetermineStrongestShip(shipToExclude, useFleetIndexing, fleetIndex). */
export function shipGroupDetermineStrongestShip(galaxy: Galaxy, shipGroup: ShipGroup, shipToExclude: BuiltObject | null, useFleetIndexing: boolean, fleetIndex: { x: number; y: number } | null): BuiltObject | null {
    let strongestShip: BuiltObject | null = null;
    let num = 0;
    for (let index = 0; index < shipGroup.ships.length; ++index) {
        const ship = shipGroup.ships[index];
        if ((shipToExclude === null || ship !== shipToExclude) && ship.firepowerRaw > num) {
            if (useFleetIndexing) {
                const galaxyIndex = galaxy.resolveIndex(ship.xpos, ship.ypos);
                if (galaxyIndex.x === fleetIndex!.x && galaxyIndex.y === fleetIndex!.y) {
                    num = ship.firepowerRaw;
                    strongestShip = ship;
                }
            } else {
                num = ship.firepowerRaw;
                strongestShip = ship;
            }
        }
    }
    return strongestShip;
}

/** ShipGroup.cs 2712 DetermineStrongestTroopTransport. */
export function shipGroupDetermineStrongestTroopTransport(shipGroup: ShipGroup): BuiltObject | null {
    let strongestTroopTransport: BuiltObject | null = null;
    let num = 0;
    for (let index = 0; index < shipGroup.ships.length; ++index) {
        const ship = shipGroup.ships[index];
        if (ship.troops !== null && ship.troops.totalAttackStrength > num) {
            strongestTroopTransport = ship;
            num = ship.troops.totalAttackStrength;
        }
    }
    return strongestTroopTransport;
}

// ---------------------------------------------------------------------------------------------------------------
// Totals / troops (ShipGroup.cs 2755-3224)
// ---------------------------------------------------------------------------------------------------------------

/** ShipGroup.cs 2755 TotalFuelCapacity. */
export function shipGroupTotalFuelCapacity(shipGroup: ShipGroup): number {
    let total = 0;
    for (let index = 0; index < shipGroup.ships.length; ++index) total += shipGroup.ships[index].fuelCapacity;
    return total;
}

/** ShipGroup.cs 2769 TotalTroopSpaceUsed. */
export function shipGroupTotalTroopSpaceUsed(shipGroup: ShipGroup): number {
    let total = 0;
    for (let index = 0; index < shipGroup.ships.length; ++index) {
        const ship = shipOf(shipGroup.ships[index]);
        if (ship !== null && ship.troops !== null) total += ship.troops.totalSize;
    }
    return total;
}

/** ShipGroup.cs 2784 TotalTroopSpaceRemaining. */
export function shipGroupTotalTroopSpaceRemaining(shipGroup: ShipGroup): number {
    let total = 0;
    for (let index = 0; index < shipGroup.ships.length; ++index) {
        const capacityRemaining = shipGroup.ships[index].troopCapacityRemaining;
        if (capacityRemaining >= 100) total += capacityRemaining;
    }
    return total;
}

/**
 * Galaxy.7.cs 5505 CalculateDefaultTroopMaintenanceMultiplier(troopType). A copy of troops.ts's port: importing troops.ts
 * here closes an import cycle (empire.ts → … → troops.ts → taxes.ts → empire.ts hooks) that breaks module init order.
 */
function calculateDefaultTroopMaintenanceMultiplier(troopType: TroopType): number {
    let result = 1.0;
    switch (troopType) {
        case TroopType.Infantry:
            result = 1.0;
            break;
        case TroopType.PirateRaider:
            result = 0.0;
            break;
        case TroopType.Armored:
            result = 2.0;
            break;
        case TroopType.Artillery:
            result = 4.0;
            break;
        case TroopType.SpecialForces:
            result = 2.0;
            break;
    }
    return result;
}

/** ShipGroup.cs 2799/2808 GetTroopLoadoutTargetAmounts([refactorForDisabledTroopTypes = true], out ...). */
export function shipGroupGetTroopLoadoutTargetAmounts(shipGroup: ShipGroup, refactorForDisabledTroopTypes = true): { infantryAmount: number; artilleryAmount: number; armorAmount: number; specialForcesAmount: number } {
    let infantryAmount = 0;
    let artilleryAmount = 0;
    let armorAmount = 0;
    let specialForcesAmount = 0;
    const out = (): { infantryAmount: number; artilleryAmount: number; armorAmount: number; specialForcesAmount: number } => ({ infantryAmount, artilleryAmount, armorAmount, specialForcesAmount });
    const num1 = Math.trunc(100.0 * calculateDefaultTroopMaintenanceMultiplier(TroopType.Infantry));
    const num2 = Math.trunc(100.0 * calculateDefaultTroopMaintenanceMultiplier(TroopType.Armored));
    const num3 = Math.trunc(100.0 * calculateDefaultTroopMaintenanceMultiplier(TroopType.Artillery));
    const num4 = Math.trunc(100.0 * calculateDefaultTroopMaintenanceMultiplier(TroopType.SpecialForces));
    const totalTroopCapacity = shipGroupTotalTroopCapacity(shipGroup);
    const inf = shipGroup.troopLoadoutInfantry;
    const arm = shipGroup.troopLoadoutArmored;
    const art = shipGroup.troopLoadoutArtillery;
    const sf = shipGroup.troopLoadoutSpecialForces;
    if (inf === 255 && art === 255 && arm === 255 && sf === 255) {
        infantryAmount = Math.trunc(totalTroopCapacity / num1);
        artilleryAmount = Math.trunc(totalTroopCapacity / num3);
        armorAmount = Math.trunc(totalTroopCapacity / num2);
        specialForcesAmount = Math.trunc(totalTroopCapacity / num4);
        return out();
    }
    let num5 = Math.fround(Math.fround(Math.fround(inf + art) + arm) + sf);
    if (num5 <= 0.0) num5 = 100;
    infantryAmount = Math.trunc(Math.trunc((inf / num5) * totalTroopCapacity) / num1);
    artilleryAmount = Math.trunc(Math.trunc((art / num5) * totalTroopCapacity) / num3);
    armorAmount = Math.trunc(Math.trunc((arm / num5) * totalTroopCapacity) / num2);
    specialForcesAmount = Math.trunc(Math.trunc((sf / num5) * totalTroopCapacity) / num4);
    const empire = shipGroup.empire;
    if (refactorForDisabledTroopTypes && empire !== null) {
        if (!empire.troopCanRecruitSpecialForces) {
            armorAmount += Math.trunc((specialForcesAmount * num4) / num2);
            specialForcesAmount = 0;
        }
        if (!empire.troopCanRecruitArmored) {
            infantryAmount += Math.trunc((armorAmount * num2) / num1);
            armorAmount = 0;
        }
        if (!empire.troopCanRecruitArtillery) {
            infantryAmount += Math.trunc((artilleryAmount * num3) / num1);
            artilleryAmount = 0;
        }
    }
    const num6 = infantryAmount * num1 + artilleryAmount * num3 + armorAmount * num2 + specialForcesAmount * num4;
    let num7 = totalTroopCapacity - num6;
    if (num7 < 100 || empire === null) return out();
    if (num7 >= num2 && empire.troopCanRecruitArmored && arm >= inf && arm >= art && arm >= sf) {
        const num8 = Math.trunc(num7 / num2);
        armorAmount += num8;
        num7 -= num8 * num2;
    }
    if (num7 >= num4 && empire.troopCanRecruitSpecialForces && sf >= inf && sf >= art && sf >= arm) {
        const num9 = Math.trunc(num7 / num4);
        specialForcesAmount += num9;
        num7 -= num9 * num4;
    }
    if (num7 >= num3 && empire.troopCanRecruitArtillery && art >= inf && art >= arm && art >= sf) {
        const num10 = Math.trunc(num7 / num3);
        artilleryAmount += num10;
        num7 -= num10 * num3;
    }
    if (num7 >= num1 && empire.troopCanRecruitInfantry && inf >= arm && inf >= art && inf >= sf) {
        const num11 = Math.trunc(num7 / num1);
        infantryAmount += num11;
        num7 -= num11 * num1;
    }
    if (num7 < 100) return out();
    const num12 = Math.trunc(num7 / num1);
    infantryAmount += num12;
    return out();
}

/** ShipGroup.cs 2894 GetTroopCountsByType(out ...). */
export function shipGroupGetTroopCountsByType(shipGroup: ShipGroup): { infantryCount: number; artilleryCount: number; armorCount: number; specialForcesCount: number } {
    let infantryCount = 0;
    let artilleryCount = 0;
    let armorCount = 0;
    let specialForcesCount = 0;
    for (let index1 = 0; index1 < shipGroup.ships.length; ++index1) {
        const ship = shipOf(shipGroup.ships[index1]);
        if (ship !== null && ship.troops !== null && ship.troops.count > 0) {
            for (let index2 = 0; index2 < ship.troops.count; ++index2) {
                const troop = ship.troops.items[index2];
                if (troop != null) {
                    switch (troop.type) {
                        case TroopType.Infantry:
                            ++infantryCount;
                            break;
                        case TroopType.Armored:
                            ++armorCount;
                            break;
                        case TroopType.Artillery:
                            ++artilleryCount;
                            break;
                        case TroopType.SpecialForces:
                            ++specialForcesCount;
                            break;
                    }
                }
            }
        }
    }
    return { infantryCount, artilleryCount, armorCount, specialForcesCount };
}

/** ShipGroup.cs 2937 TotalTroopCount. */
export function shipGroupTotalTroopCount(shipGroup: ShipGroup): number {
    let total = 0;
    for (let index = 0; index < shipGroup.ships.length; ++index) {
        const ship = shipGroup.ships[index];
        if (ship.troops !== null && ship.troops.count > 0) total += ship.troops.count;
    }
    return total;
}

/** ShipGroup.cs 2952 TotalTroopCapacity. */
export function shipGroupTotalTroopCapacity(shipGroup: ShipGroup): number {
    let total = 0;
    for (let index = 0; index < shipGroup.ships.length; ++index) {
        const ship = shipGroup.ships[index];
        if (ship.troopCapacity > 0) total += ship.troopCapacity;
    }
    return total;
}

/** ShipGroup.cs 2967 TotalTroopAttackStrength. */
export function shipGroupTotalTroopAttackStrength(shipGroup: ShipGroup): number {
    let total = 0;
    for (let index = 0; index < shipGroup.ships.length; ++index) {
        const ship = shipGroup.ships[index];
        if (ship.troops !== null && ship.troops.totalAttackStrength > 0) total += ship.troops.totalAttackStrength;
    }
    return total;
}

/** Lead-ship-relative "nearby" sum (ShipGroup.cs 2982 / 3014 / 3087 / 3118): within 48000 and fuel ≥ requiredFuelLevel. */
function sumNearby(galaxy: Galaxy, shipGroup: ShipGroup, requiredFuelLevel: number, value: (ship: BuiltObject) => number, include: (ship: BuiltObject) => boolean, fallback: () => number): number {
    let num = 0;
    const leadShip = shipGroup.leadShip;
    if (leadShip !== null) {
        for (let index = 0; index < shipGroup.ships.length; ++index) {
            const ship = shipGroup.ships[index];
            if (include(ship) && galaxy.calculateDistanceSquared(ship.xpos, ship.ypos, leadShip.xpos, leadShip.ypos) < 2304000000.0 && ship.currentFuel / Math.max(1.0, ship.fuelCapacity) >= requiredFuelLevel) {
                num += value(ship);
            }
        }
    } else {
        num = fallback();
    }
    return num;
}

/** ShipGroup.cs 2982 TotalTroopAttackStrengthNearby(requiredFuelLevel). */
export function shipGroupTotalTroopAttackStrengthNearby(galaxy: Galaxy, shipGroup: ShipGroup, requiredFuelLevel: number): number {
    return sumNearby(galaxy, shipGroup, requiredFuelLevel, (s) => s.troops!.totalAttackStrength, (s) => s.troops !== null && s.troops.totalAttackStrength > 0, () => shipGroupTotalTroopAttackStrength(shipGroup));
}

/** ShipGroup.cs 2999 TotalTroopDefendStrength. */
export function shipGroupTotalTroopDefendStrength(shipGroup: ShipGroup): number {
    let total = 0;
    for (let index = 0; index < shipGroup.ships.length; ++index) {
        const ship = shipGroup.ships[index];
        if (ship.troops !== null && ship.troops.totalDefendStrength > 0) total += ship.troops.totalDefendStrength;
    }
    return total;
}

/** ShipGroup.cs 3014 TotalTroopDefendStrengthNearby(requiredFuelLevel). */
export function shipGroupTotalTroopDefendStrengthNearby(galaxy: Galaxy, shipGroup: ShipGroup, requiredFuelLevel: number): number {
    return sumNearby(galaxy, shipGroup, requiredFuelLevel, (s) => s.troops!.totalDefendStrength, (s) => s.troops !== null && s.troops.totalDefendStrength > 0, () => shipGroupTotalTroopDefendStrength(shipGroup));
}

/** ShipGroup.cs 3031 TotalDamage. */
export function shipGroupTotalDamage(shipGroup: ShipGroup): number {
    let total = 0;
    for (let index = 0; index < shipGroup.ships.length; ++index) total += shipGroup.ships[index].damagedComponentCount;
    return total;
}

/** ShipGroup.cs 3045 TotalFighterCount. */
export function shipGroupTotalFighterCount(shipGroup: ShipGroup): number {
    let total = 0;
    for (let index = 0; index < shipGroup.ships.length; ++index) {
        const fighters = shipGroup.ships[index].fighters;
        if (fighters !== null) total += fighters.length;
    }
    return total;
}

/** ShipGroup.cs 3059 TotalOverallStrengthFactor. */
export function shipGroupTotalOverallStrengthFactor(galaxy: Galaxy, shipGroup: ShipGroup): number {
    void galaxy;
    let overallStrengthFactor = 0;
    // ListHelper.ToArrayThreadSafe(Ships): a snapshot.
    const ships = shipGroup.ships.slice();
    for (const builtObject of ships) {
        if (builtObject != null) overallStrengthFactor += calculateOverallStrengthFactor(builtObject);
    }
    return overallStrengthFactor;
}

/** ShipGroup.cs 3073 TotalFirepower. */
export function shipGroupTotalFirepower(shipGroup: ShipGroup): number {
    let total = 0;
    for (let index = 0; index < shipGroup.ships.length; ++index) total += shipGroup.ships[index].firepowerRaw;
    return total;
}

/** ShipGroup.cs 3087 TotalFirepowerNearby(requiredFuelLevel). */
export function shipGroupTotalFirepowerNearby(galaxy: Galaxy, shipGroup: ShipGroup, requiredFuelLevel: number): number {
    return sumNearby(galaxy, shipGroup, requiredFuelLevel, (s) => s.firepowerRaw, () => true, () => shipGroupTotalFirepower(shipGroup));
}

/** ShipGroup.cs 3104 TotalBombardPower. */
export function shipGroupTotalBombardPower(shipGroup: ShipGroup): number {
    let total = 0;
    for (let index = 0; index < shipGroup.ships.length; ++index) total += shipGroup.ships[index].bombardWeaponPower;
    return total;
}

/** ShipGroup.cs 3118 TotalBombardPowerNearby(requiredFuelLevel). */
export function shipGroupTotalBombardPowerNearby(galaxy: Galaxy, shipGroup: ShipGroup, requiredFuelLevel: number): number {
    return sumNearby(galaxy, shipGroup, requiredFuelLevel, (s) => s.bombardWeaponPower, () => true, () => shipGroupTotalBombardPower(shipGroup));
}

/** ShipGroup.cs 3135 TotalAssaultStrength. */
export function shipGroupTotalAssaultStrength(shipGroup: ShipGroup): number {
    let total = 0;
    for (let index = 0; index < shipGroup.ships.length; ++index) {
        const ship = shipOf(shipGroup.ships[index]);
        if (ship !== null && !ship.hasBeenDestroyed) total += Math.trunc(ship.assaultStrength);
    }
    return total;
}


/**
 * BuiltObject.1.cs 3342 CalculateAssaultPodAttackValues(time, out assaultPodCount, out assaultPodsAvailable). Shared
 * helper ported here (attackAI.ts has only the strength-only CalculateAvailableAssaultPodAttackStrength 3314).
 */
export function builtObjectCalculateAssaultPodAttackValues(bo: BuiltObject, time: number): { value: number; assaultPodCount: number; assaultPodsAvailable: number } {
    let num = 0;
    let assaultPodCount = 0;
    let assaultPodsAvailable = 0;
    if (bo.assaultRange > 0 && bo.assaultStrength > 0 && bo.weapons !== null) {
        let num2 = 1.0;
        let num3 = 1.0;
        if (bo.empire !== null) {
            num3 = bo.empire.boardingAttackFactor;
            num3 *= empireRaidStrengthFactor(bo.empire);
            if (bo.empire.dominantRace !== null) {
                num2 = bo.empire.dominantRace.troopStrength / 100.0;
            }
        }
        for (let i = 0; i < bo.weapons.length; i++) {
            const weapon = bo.weapons[i];
            if (weapon != null && weapon.component != null && weapon.component.type === ComponentType.AssaultPod) {
                assaultPodCount++;
                if (weaponIsAvailableWithoutEnergyConsideration(weapon, time)) {
                    assaultPodsAvailable++;
                    num += Math.trunc(weapon.rawDamage * num2 * num3);
                }
            }
        }
    }
    return { value: num, assaultPodCount, assaultPodsAvailable };
}

/** ShipGroup.cs 3203 CalculateAssaultPodAttackValues(time, out assaultPodCount, out assaultPodsAvailable). */
export function shipGroupCalculateAssaultPodAttackValues(shipGroup: ShipGroup, time: number): { value: number; assaultPodCount: number; assaultPodsAvailable: number } {
    let assaultPodAttackValues = 0;
    let assaultPodCount = 0;
    let assaultPodsAvailable = 0;
    for (let index = 0; index < shipGroup.ships.length; ++index) {
        const ship = shipOf(shipGroup.ships[index]);
        if (ship !== null && !ship.hasBeenDestroyed) {
            const r = builtObjectCalculateAssaultPodAttackValues(ship, time);
            assaultPodAttackValues += r.value;
            assaultPodCount += r.assaultPodCount;
            assaultPodsAvailable += r.assaultPodsAvailable;
        }
    }
    return { value: assaultPodAttackValues, assaultPodCount, assaultPodsAvailable };
}

/** ShipGroup.cs 3187 TotalAvailableBoardingAssaultStrength(time). */
export function shipGroupTotalAvailableBoardingAssaultStrength(shipGroup: ShipGroup, time: number): number {
    let num = 0;
    for (let index = 0; index < shipGroup.ships.length; ++index) {
        const ship = shipOf(shipGroup.ships[index]);
        if (ship !== null && !ship.hasBeenDestroyed) num += builtObjectCalculateAssaultPodAttackValues(ship, time).value;
    }
    return num;
}

/** Empire.2.cs 25 DetermineDestroyOrCaptureTarget(attackingFleet, target). */
export function determineDestroyOrCaptureTargetForFleet(galaxy: Galaxy, empire: Empire, attackingFleet: ShipGroup | null, target: BuiltObject): BuiltObjectMissionType {
    if (attackingFleet !== null) {
        const assaultStrength = shipGroupCalculateAssaultPodAttackValues(attackingFleet, galaxy.nowMs).value;
        return determineDestroyOrCaptureTargetCore(galaxy, empire, assaultStrength, shipGroupTotalOverallStrengthFactor(galaxy, attackingFleet), attackingFleet.empire, target, true, attackingFleet.leadShip);
    }
    return BuiltObjectMissionType.Attack;
}

// ---------------------------------------------------------------------------------------------------------------
// Speeds, fleet mission assignment to ships, fuel range (ShipGroup.cs 3226-3572)
// ---------------------------------------------------------------------------------------------------------------

/** ShipGroup.cs 3226 RemoveShipsWithoutHyperdrive. */
export function shipGroupRemoveShipsWithoutHyperdrive(galaxy: Galaxy, shipGroup: ShipGroup): void {
    if (shipGroupWarpSpeed(shipGroup) <= 0) return;
    const builtObjectList: BuiltObject[] = [];
    for (let index = 0; index < shipGroup.ships.length; ++index) {
        const ship = shipGroup.ships[index];
        if (ship.warpSpeed <= 0 && ship.builtAt === null) builtObjectList.push(ship);
    }
    for (let i = 0; i < builtObjectList.length; i++) leaveShipGroup(galaxy, builtObjectList[i]);
}

/** ShipGroup.cs 3258 CruiseSpeed. */
export function shipGroupCruiseSpeed(shipGroup: ShipGroup): number {
    if (shipGroup.ships.length <= 0) return 0;
    let cruiseSpeed = 536870911;
    for (let index = 0; index < shipGroup.ships.length; ++index) {
        const ship = shipGroup.ships[index];
        if (Math.trunc(ship.cruiseSpeed) < cruiseSpeed) cruiseSpeed = Math.trunc(ship.cruiseSpeed);
    }
    return cruiseSpeed;
}

/** ShipGroup.cs 3274 TopSpeed. */
export function shipGroupTopSpeed(shipGroup: ShipGroup): number {
    if (shipGroup.ships.length <= 0) return 0;
    let topSpeed = 536870911;
    for (let index = 0; index < shipGroup.ships.length; ++index) {
        const ship = shipGroup.ships[index];
        if (Math.trunc(ship.topSpeed) < topSpeed) topSpeed = Math.trunc(ship.topSpeed);
    }
    return topSpeed;
}

/** ShipGroup.cs 3292 AssignMissionToShips(mission, manuallyAssigned). Rnd: SelectRelativePoint per assigned ship (2 draws). */
function assignMissionToShips(galaxy: Galaxy, shipGroup: ShipGroup, mission: BuiltObjectMission, manuallyAssigned: boolean): boolean {
    let ships = false;
    for (let index = 0; index < shipGroup.ships.length; ++index) {
        const ship = shipGroup.ships[index];
        let flag = shipGroupIsShipAvailable(ship);
        if (manuallyAssigned && ship.builtAt === null) {
            flag = true;
        }
        if (flag || shipGroupIsShipAvailableAfterMission(ship)) {
            mission.resolveTargetCoordinates(mission);
            let x1 = mission.x;
            let y1 = mission.y;
            if (mission.x > -2000000000.0 && mission.y > -2000000000.0) {
                // 3306-3320: both C# branches (no target / a target) add the same random offset.
                const p = galaxy.selectRelativePoint(300.0);
                x1 += p.x;
                y1 += p.y;
            } else if (mission.type === BuiltObjectMissionType.Move) {
                const p = galaxy.selectRelativePoint(300.0);
                x1 = p.x;
                y1 = p.y;
            }
            let target: MissionTarget | null = null;
            let target2: MissionTarget | null = null;
            if (mission.targetBuiltObject !== null) target = mission.targetBuiltObject;
            else if (mission.targetHabitat !== null) target = mission.targetHabitat;
            else if (mission.targetCreature !== null) target = mission.targetCreature;
            else if (mission.targetShipGroup !== null) target = mission.targetShipGroup;
            if (mission.secondaryTargetBuiltObject !== null) target2 = mission.secondaryTargetBuiltObject;
            else if (mission.secondaryTargetHabitat !== null) target2 = mission.secondaryTargetHabitat;
            else if (mission.secondaryTargetCreature !== null) target2 = mission.secondaryTargetCreature;
            else if (mission.secondaryTargetShipGroup !== null) target2 = mission.secondaryTargetShipGroup;
            ship.revertMission = null;
            if (flag) {
                clearPreviousMissionRequirements(galaxy, ship);
                assignMission(galaxy, ship, mission.type, target, target2, mission.priority, {
                    cargo: mission.cargo,
                    troops: mission.troops,
                    population: mission.population,
                    design: mission.design,
                    x: x1,
                    y: y1,
                    starDate: mission.starDate,
                    allowReprocessing: true,
                    manuallyAssigned,
                });
                missionOf(ship)!.isShipGroupMission = true;
            } else {
                queueMission(galaxy, ship, mission.type, target, target2, mission.priority, { x: x1, y: y1, starDate: mission.starDate });
            }
            ships = true;
        }
    }
    return ships;
}

/** ShipGroup.cs 3366 CountShipsWithinFuelRange(x, y, fuelReservePortion, out firepowerWithinRange). */
export function shipGroupCountShipsWithinFuelRange(galaxy: Galaxy, shipGroup: ShipGroup, x: number, y: number, fuelReservePortion: number): { count: number; firepowerWithinRange: number } {
    let num = 0;
    let firepowerWithinRange = 0;
    for (let index = 0; index < shipGroup.ships.length; ++index) {
        const ship = shipGroup.ships[index];
        if (withinReducedFuelRange(galaxy, ship, x, y, fuelReservePortion)) {
            firepowerWithinRange += ship.firepowerRaw;
            ++num;
        }
    }
    return { count: num, firepowerWithinRange };
}

/** ShipGroup.cs 3386 CountShipsWithinFuelRangeAndRefuel(x, y, extraFuelPortionMargin, out firepowerWithinRange). */
function countShipsWithinFuelRangeAndRefuel(galaxy: Galaxy, shipGroup: ShipGroup, x: number, y: number, extraFuelPortionMargin: number): { count: number; firepowerWithinRange: number } {
    let num = 0;
    let firepowerWithinRange = 0;
    const fuelTypes = shipGroupDetermineFuelTypes(shipGroup);
    const nearestRefuellingPoint = fastFindNearestRefuellingPoint(galaxy, x, y, fuelTypes, shipGroup.empire, shipGroup.leadShip, true, null, shipGroup.ships.length);
    for (let index = 0; index < shipGroup.ships.length; ++index) {
        const ship = shipGroup.ships[index];
        if (withinFuelRangeAndRefuelAt(galaxy, ship, x, y, extraFuelPortionMargin, nearestRefuellingPoint)) {
            firepowerWithinRange += calculateOverallStrengthFactor(ship);
            ++num;
        }
    }
    return { count: num, firepowerWithinRange };
}

/** ShipGroup.cs 3408 CurrentRange. */
export function shipGroupCurrentRange(shipGroup: ShipGroup): number {
    let num1 = Number.MAX_VALUE;
    if (shipGroup.ships !== null) {
        for (let index = 0; index < shipGroup.ships.length; ++index) {
            const ship = shipOf(shipGroup.ships[index]);
            if (ship !== null) {
                const num2 = currentRange(ship);
                if (num2 < num1) num1 = num2;
            }
        }
    } else {
        num1 = 0.0;
    }
    return num1;
}

/** ShipGroup.cs 3429 MaximumRange. */
export function shipGroupMaximumRange(shipGroup: ShipGroup): number {
    let num1 = Number.MAX_VALUE;
    if (shipGroup.ships !== null) {
        for (let index = 0; index < shipGroup.ships.length; ++index) {
            const ship = shipOf(shipGroup.ships[index]);
            if (ship !== null) {
                const num2 = maximumFuelRange(ship);
                if (num2 < num1) num1 = num2;
            }
        }
    } else {
        num1 = 0.0;
    }
    return num1;
}

/** ShipGroup.cs 3450 CheckFleetTargetWithinFuelRange(x, y, fuelPortionMargin). */
export function shipGroupCheckFleetTargetWithinFuelRange(galaxy: Galaxy, shipGroup: ShipGroup, x: number, y: number, fuelPortionMargin: number): boolean {
    let num1 = 0;
    for (let index = 0; index < shipGroup.ships.length; ++index) {
        if (withinFuelRange(galaxy, shipGroup.ships[index], x, y, fuelPortionMargin)) ++num1;
    }
    const num2 = Math.trunc(shipGroup.ships.length * 1.0);
    return num1 >= num2;
}

/** ShipGroup.cs 3462/3464 CalculateRefuellingPortion([aggressiveRefuelling = true]). */
export function shipGroupCalculateRefuellingPortion(galaxy: Galaxy, shipGroup: ShipGroup, aggressiveRefuelling = true): number {
    const requiredFuel = shipGroupCalculateRequiredFuel(shipGroup);
    let refuellingPoint: StellarObject | null = null;
    const leadShip = shipGroup.leadShip;
    if (leadShip !== null) {
        refuellingPoint =
            shipGroup.empire === null
                ? fastFindNearestRefuellingPoint(galaxy, leadShip.xpos, leadShip.ypos, requiredFuel, shipGroup.empire, leadShip, true, null, shipGroup.ships.length)
                : ultraFastFindNearestRefuellingLocation(galaxy, shipGroup.empire, leadShip.xpos, leadShip.ypos, requiredFuel, leadShip, false, true, shipGroup.ships.length);
    }
    shipGroupCurrentRange(shipGroup);
    let refuellingPortion = 1.0;
    for (let index = 0; index < shipGroup.ships.length; ++index) {
        const ship = shipOf(shipGroup.ships[index]);
        if (ship !== null) {
            const refuellingPoints = calculateFuelPortionMarginFromRefuellingPoint(galaxy, ship, ship.xpos, ship.ypos, refuellingPoint);
            refuellingPortion = Math.min(refuellingPortion, refuellingPoints);
        }
    }
    if (aggressiveRefuelling) {
        const mission = shipGroup.mission;
        if (mission === null || mission.type === BuiltObjectMissionType.Undefined) {
            if (shipGroupCheckAnyShipsInBattle(shipGroup)) {
                refuellingPortion = Math.max(refuellingPortion, 0.2);
            } else {
                refuellingPortion = Math.max(refuellingPortion, 0.5);
                if (refuellingPoint !== null && leadShip !== null && galaxy.calculateDistance(leadShip.xpos, leadShip.ypos, refuellingPoint.xpos, refuellingPoint.ypos) < 48000.0) {
                    refuellingPortion = Math.max(refuellingPortion, 0.67);
                }
            }
        }
    }
    if (shipGroup.leadShip !== null) {
        refuellingPortion = !shipGroup.leadShip.isAutoControlled ? Math.min(0.5, refuellingPortion) : Math.max(0.05, refuellingPortion);
    }
    return refuellingPortion;
}

/** ShipGroup.cs 3504 CheckAnyShipsInBattle. */
export function shipGroupCheckAnyShipsInBattle(shipGroup: ShipGroup): boolean {
    for (let index = 0; index < shipGroup.ships.length; ++index) {
        const ship = shipOf(shipGroup.ships[index]);
        if (ship !== null) {
            const mission = missionOf(ship);
            if (mission !== null) {
                switch (mission.type) {
                    case BuiltObjectMissionType.Attack:
                    case BuiltObjectMissionType.WaitAndAttack:
                    case BuiltObjectMissionType.WaitAndBombard:
                    case BuiltObjectMissionType.Bombard:
                    case BuiltObjectMissionType.Capture:
                        return true;
                }
            }
        }
    }
    return false;
}

/** ShipGroup.cs 3531 CheckAnyShipsLoadingTroops. */
export function shipGroupCheckAnyShipsLoadingTroops(shipGroup: ShipGroup): boolean {
    for (let index = 0; index < shipGroup.ships.length; ++index) {
        const ship = shipOf(shipGroup.ships[index]);
        if (ship !== null) {
            const mission = missionOf(ship);
            if (mission !== null && mission.type === BuiltObjectMissionType.LoadTroops) return true;
        }
    }
    return false;
}

/** ShipGroup.cs 3546 CheckFleetTargetWithinFuelRangeAndRefuel(x, y, extraFuelPortionMargin). */
export function shipGroupCheckFleetTargetWithinFuelRangeAndRefuel(galaxy: Galaxy, shipGroup: ShipGroup, x: number, y: number, extraFuelPortionMargin: number): boolean {
    let num1 = 0;
    const requiredFuel = shipGroupCalculateRequiredFuel(shipGroup);
    const refuellingPoint =
        shipGroup.empire === null
            ? fastFindNearestRefuellingPoint(galaxy, x, y, requiredFuel, shipGroup.empire, shipGroup.leadShip, true, null, shipGroup.ships.length)
            : ultraFastFindNearestRefuellingLocation(galaxy, shipGroup.empire, x, y, requiredFuel, shipGroup.leadShip, false, true, shipGroup.ships.length);
    if (refuellingPoint !== null) {
        for (let index = 0; index < shipGroup.ships.length; ++index) {
            if (withinFuelRangeAndRefuelAt(galaxy, shipGroup.ships[index], x, y, extraFuelPortionMargin, refuellingPoint)) ++num1;
        }
        const num2 = Math.trunc(shipGroup.ships.length * 1.0);
        if (num1 >= num2) return true;
    }
    return false;
}

/** ShipGroup.cs 3568 IsShipAvailableAfterMission(ship). */
export function shipGroupIsShipAvailableAfterMission(ship: BuiltObject): boolean {
    return ship.builtAt === null;
}

/** ShipGroup.cs 3570 IsShipAvailable(ship). */
export function shipGroupIsShipAvailable(ship: BuiltObject): boolean {
    const m = missionOf(ship);
    return ship.builtAt === null && ship.retrofitDesign === null && (m === null || m.type !== BuiltObjectMissionType.Repair);
}

// ---------------------------------------------------------------------------------------------------------------
// ShipGroupList.cs (as functions over ShipGroup arrays)
// ---------------------------------------------------------------------------------------------------------------

/** ShipGroupList.cs 16 DetermineFleetsTravellingToLocation(x, y, acceptableRange). */
export function shipGroupListDetermineFleetsTravellingToLocation(list: readonly ShipGroup[], x: number, y: number, acceptableRange: number): ShipGroup[] {
    const num1 = Math.trunc(x - acceptableRange);
    const num2 = Math.trunc(x + acceptableRange);
    const num3 = Math.trunc(y - acceptableRange);
    const num4 = Math.trunc(y + acceptableRange);
    const travellingToLocation: ShipGroup[] = [];
    for (let index = 0; index < list.length; ++index) {
        const shipGroup = list[index];
        if (shipGroup.mission !== null && shipGroup.mission.type !== BuiltObjectMissionType.Undefined) {
            const xpos = Math.trunc(shipGroup.leadShip!.xpos);
            const ypos = Math.trunc(shipGroup.leadShip!.ypos);
            if (xpos <= num1 || xpos >= num2 || ypos <= num3 || ypos >= num4) {
                const point = shipGroup.mission.resolveTargetCoordinates(shipGroup.mission);
                if (point.x > num1 && point.x < num2 && point.y > num3 && point.y < num4) travellingToLocation.push(shipGroup);
            }
        }
    }
    return travellingToLocation;
}

/** ShipGroupList.cs 44 CountLargeFleets. */
export function shipGroupListCountLargeFleets(list: readonly ShipGroup[]): number {
    let num = 0;
    for (let index = 0; index < list.length; ++index) if (list[index].shipTargetAmount >= 10) ++num;
    return num;
}

/** ShipGroupList.cs 55 IdentifyLargestFleet. */
export function shipGroupListIdentifyLargestFleet(list: readonly ShipGroup[]): ShipGroup | null {
    let shipGroup: ShipGroup | null = null;
    for (let index = 0; index < list.length; ++index) {
        if (shipGroup === null || list[index].ships.length > shipGroup.ships.length) shipGroup = list[index];
    }
    return shipGroup;
}

/** ShipGroupList.cs 66 CountTotalFirepower. */
export function shipGroupListCountTotalFirepower(list: readonly ShipGroup[]): number {
    let num = 0;
    for (let index = 0; index < list.length; ++index) num += shipGroupTotalFirepower(list[index]);
    return num;
}

/** ShipGroupList.cs 74 CountTotalOverallStrengthFactor. */
export function shipGroupListCountTotalOverallStrengthFactor(galaxy: Galaxy, list: readonly ShipGroup[]): number {
    let num = 0;
    for (let index = 0; index < list.length; ++index) num += shipGroupTotalOverallStrengthFactor(galaxy, list[index]);
    return num;
}

/** Galaxy.CalculateDistanceStatic(x1, y1, x2, y2) = Math.Sqrt(dx * dx + dy * dy). */
function galaxyDistanceStatic(x1: number, y1: number, x2: number, y2: number): number {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * ShipGroupList.cs 82-243 ResolveFleetsWithAttackTarget(attackTarget[, out nearestDistance]): fleets whose mission is
 * attack-type (Attack/WaitAndAttack/Bombard/WaitAndBombard/Capture/Raid; only Attack/WaitAndAttack for a ship-group
 * target) at the target, with the nearest lead-ship distance (double.MaxValue if none); any other target type → empty.
 */
export function shipGroupListResolveFleetsWithAttackTarget(list: readonly ShipGroup[], attackTarget: MissionTarget | null): { fleets: ShipGroup[]; nearestDistance: number } {
    let nearestDistance = Number.MAX_VALUE;
    const shipGroupList: ShipGroup[] = [];
    if (attackTarget === null || !(isBuiltObject(attackTarget) || isHabitat(attackTarget) || isCreature(attackTarget) || isShipGroup(attackTarget))) {
        return { fleets: shipGroupList, nearestDistance };
    }
    for (let index = 0; index < list.length; ++index) {
        const shipGroup = list[index];
        if (shipGroup == null || shipGroup.leadShip === null || shipGroup.mission === null) continue;
        if (isShipGroup(attackTarget)) {
            if ((shipGroup.mission.type === BuiltObjectMissionType.Attack || shipGroup.mission.type === BuiltObjectMissionType.WaitAndAttack) && shipGroup.mission.targetShipGroup === attackTarget) {
                shipGroupList.push(shipGroup);
                if (attackTarget.leadShip !== null) {
                    const d = galaxyDistanceStatic(shipGroup.leadShip.xpos, shipGroup.leadShip.ypos, attackTarget.leadShip.xpos, attackTarget.leadShip.ypos);
                    if (d < nearestDistance) nearestDistance = d;
                }
            }
            continue;
        }
        if (!isCombatMissionType(shipGroup.mission.type)) continue;
        let match = false;
        if (isBuiltObject(attackTarget)) match = shipGroup.mission.targetBuiltObject === attackTarget;
        else if (isHabitat(attackTarget)) match = shipGroup.mission.targetHabitat === attackTarget;
        else if (isCreature(attackTarget)) match = shipGroup.mission.targetCreature === attackTarget;
        if (match) {
            shipGroupList.push(shipGroup);
            const d = galaxyDistanceStatic(shipGroup.leadShip.xpos, shipGroup.leadShip.ypos, attackTarget.xpos, attackTarget.ypos);
            if (d < nearestDistance) nearestDistance = d;
        }
    }
    return { fleets: shipGroupList, nearestDistance };
}

/** ShipGroupList.cs 245 ResolveFleetsWithWaitTarget(waitTarget). */
export function shipGroupListResolveFleetsWithWaitTarget(list: readonly ShipGroup[], waitTarget: StellarObject | null): ShipGroup[] {
    const shipGroupList: ShipGroup[] = [];
    for (let index = 0; index < list.length; ++index) {
        const shipGroup = list[index];
        if (shipGroup != null && shipGroup.leadShip !== null && shipGroup.mission !== null && shipGroup.mission.type === BuiltObjectMissionType.MoveAndWait) {
            if (waitTarget !== null && isBuiltObject(waitTarget)) {
                if (shipGroup.mission.targetBuiltObject === waitTarget) shipGroupList.push(shipGroup);
            } else if (waitTarget !== null && isHabitat(waitTarget)) {
                if (shipGroup.mission.targetHabitat === waitTarget) shipGroupList.push(shipGroup);
            } else if (waitTarget !== null && isCreature(waitTarget)) {
                if (shipGroup.mission.targetCreature === waitTarget) shipGroupList.push(shipGroup);
            }
        }
    }
    return shipGroupList;
}

/** ShipGroupList.cs 285 ClearSortTags. */
export function shipGroupListClearSortTags(list: readonly (ShipGroup | null)[]): void {
    for (let index = 0; index < list.length; ++index) {
        const shipGroup = list[index];
        if (shipGroup != null) shipGroup.sortTag = 0.0;
    }
}

/** ShipGroupList.cs 295 OrderByName: Array.Sort(names, fleets) (introsort keyed on the culture-sensitive name). */
export function shipGroupListOrderByName(list: readonly ShipGroup[]): ShipGroup[] {
    const pairs = list.map((shipGroup) => ({ name: shipGroup.name, shipGroup }));
    netSort(pairs, (a, b) => (a.name === null ? (b.name === null ? 0 : -1) : b.name === null ? 1 : NAME_COLLATOR.compare(a.name, b.name)));
    return pairs.map((p) => p.shipGroup);
}

// ---------------------------------------------------------------------------------------------------------------
// BuiltObject-side fleet methods
// ---------------------------------------------------------------------------------------------------------------

/** BuiltObject.1.cs 42 LeaveShipGroup. */
export function leaveShipGroup(galaxy: Galaxy, builtObject: BuiltObject): void {
    if (builtObject.shipGroup !== null) {
        const shipGroup = builtObject.shipGroup as ShipGroup;
        let flag = false;
        if (shipGroup.leadShip === builtObject) {
            flag = true;
        }
        const i = shipGroup.ships.indexOf(builtObject);
        if (i >= 0) shipGroup.ships.splice(i, 1);
        builtObject.shipGroup = null;
        if (flag) {
            shipGroupUpdate(galaxy, shipGroup);
        }
        if (shipGroup.ships.length <= 0) {
            disbandShipGroup(galaxy, builtObject.empire!, shipGroup);
        }
    }
}

/** BuiltObject.cs 1906 ReviewFleetBonuses. */
export function reviewFleetBonuses(galaxy: Galaxy, builtObject: BuiltObject): void {
    let num = 0;
    let num2 = 0;
    const shipGroup = builtObject.shipGroup as ShipGroup | null;
    if (shipGroup !== null && shipGroup.ships !== null) {
        for (let i = 0; i < shipGroup.ships.length; i++) {
            const builtObject2 = shipGroup.ships[i];
            if (builtObject2.fleetTargettingModifier > num || builtObject2.fleetCountermeasureModifier > num2) {
                const num3 = galaxy.calculateDistanceSquared(builtObject.xpos, builtObject.ypos, builtObject2.xpos, builtObject2.ypos);
                if (num3 <= 4000000.0) {
                    num = Math.max(num, builtObject2.fleetTargettingModifier);
                    num2 = Math.max(num2, builtObject2.fleetCountermeasureModifier);
                }
            }
        }
    }
    builtObject.fleetTargettingBonus = num;
    builtObject.fleetCountermeasureBonus = num2;
}

/** BuiltObject.cs 3503 PerformFleetTasks. Rnd: SelectRelativePoint (2 draws) when the ship is > 5000 from the fleet. */
export function performFleetTasks(galaxy: Galaxy, builtObject: BuiltObject): void {
    const shipGroup = builtObject.shipGroup as ShipGroup | null;
    if (shipGroup === null || builtObject.empire === null) {
        return;
    }
    const mission = missionOf(builtObject);
    if (
        (mission === null || mission.type === BuiltObjectMissionType.Undefined) &&
        builtObject.builtAt === null &&
        builtObject.retrofitDesign === null &&
        (!builtObject.isAutoControlled || builtObject.troops === null || builtObject.troopCapacity <= 0 || builtObject.troopCapacityRemaining < 100 || builtObject === shipGroup.leadShip || !assignLoadTroopsMission(galaxy, builtObject.empire, builtObject)) &&
        shipGroup.leadShip !== null &&
        shipGroup.leadShip !== builtObject
    ) {
        let point = { x: 0, y: 0 }; // Point.Empty
        const mission2 = shipGroup.mission;
        let builtObjectMission2: BuiltObjectMission | null = null;
        if (shipGroup.leadShip !== null) {
            builtObjectMission2 = missionOf(shipGroup.leadShip);
        }
        if (mission2 !== null && mission2.type !== BuiltObjectMissionType.Undefined) {
            point = mission2.resolveTargetCoordinates(mission2);
        } else if (builtObjectMission2 !== null && builtObjectMission2.type !== BuiltObjectMissionType.Undefined) {
            point = builtObjectMission2.resolveTargetCoordinates(builtObjectMission2);
        }
        if (point.x === 0 && point.y === 0 && shipGroup.leadShip !== null) {
            point = { x: Math.trunc(shipGroup.leadShip.xpos), y: Math.trunc(shipGroup.leadShip.ypos) };
        }
        const num = galaxy.calculateDistanceSquared(builtObject.xpos, builtObject.ypos, point.x, point.y);
        if (num > 25000000.0) {
            const p = galaxy.selectRelativePoint(300.0);
            assignMission(galaxy, builtObject, BuiltObjectMissionType.Move, null, null, BuiltObjectMissionPriority.Normal, { x: point.x + p.x, y: point.y + p.y, manuallyAssigned: false });
        }
    }
}

/** Galaxy.7.cs 4597 AssignFleetWaypointMission(builtObject, allowMissionOverride, waypoint). Rnd: SelectRelativeParkingPoint (3 draws). */
export function assignFleetWaypointMission(galaxy: Galaxy, builtObject: BuiltObject | null, allowMissionOverride: boolean, waypoint: StellarObject | null): boolean {
    if (builtObject !== null && builtObject.shipGroup !== null && builtObject.topSpeed > 0 && builtObject.role !== BuiltObjectRole.Base) {
        const bm = missionOf(builtObject);
        if (allowMissionOverride || bm === null || (bm !== null && bm.type === BuiltObjectMissionType.Undefined)) {
            const shipGroup = builtObject.shipGroup as ShipGroup;
            let obj: MissionTarget | null = waypoint;
            let point = { x: 0, y: 0 }; // Point.Empty
            if (obj === null) {
                if (shipGroup.leadShip !== null && shipGroup.leadShip !== builtObject) {
                    const leadShip = shipGroup.leadShip;
                    const lm = missionOf(leadShip);
                    if (
                        lm !== null &&
                        (lm.type === BuiltObjectMissionType.Blockade ||
                            lm.type === BuiltObjectMissionType.Move ||
                            lm.type === BuiltObjectMissionType.MoveAndWait ||
                            lm.type === BuiltObjectMissionType.Hold ||
                            lm.type === BuiltObjectMissionType.Retrofit ||
                            lm.type === BuiltObjectMissionType.Patrol ||
                            lm.type === BuiltObjectMissionType.Refuel ||
                            lm.type === BuiltObjectMissionType.Repair ||
                            lm.type === BuiltObjectMissionType.Waypoint)
                    ) {
                        if (lm.target !== null) {
                            obj = lm.target;
                        } else {
                            point = { x: Math.trunc(leadShip.xpos), y: Math.trunc(leadShip.ypos) };
                        }
                    } else if (leadShip.parentHabitat !== null) {
                        obj = leadShip.parentHabitat;
                    } else if (leadShip.parentBuiltObject !== null) {
                        obj = leadShip.parentBuiltObject;
                    } else if ((lm === null || lm.type === BuiltObjectMissionType.Undefined) && leadShip.currentSpeed <= 0) {
                        point = { x: Math.trunc(leadShip.xpos), y: Math.trunc(leadShip.ypos) };
                    } else {
                        obj = shipGroup.gatherPoint;
                    }
                } else {
                    obj = shipGroup.gatherPoint;
                }
            }
            const p = galaxy.selectRelativeParkingPoint();
            clearPreviousMissionRequirements(galaxy, builtObject);
            if (obj !== null) {
                assignMission(galaxy, builtObject, BuiltObjectMissionType.Move, obj, null, BuiltObjectMissionPriority.Low, { x: p.x, y: p.y, manuallyAssigned: false });
            } else if (!(point.x === 0 && point.y === 0)) {
                assignMission(galaxy, builtObject, BuiltObjectMissionType.Move, null, null, BuiltObjectMissionPriority.Low, { x: point.x + p.x, y: point.y + p.y, manuallyAssigned: false });
            }
            return true;
        }
    }
    return false;
}

// ---------------------------------------------------------------------------------------------------------------
// Empire-side fleet maintenance (Empire.9.cs 2454-2900, Empire.8.cs 5145/5217, Empire.2.cs 2944, Empire.cs 2352/3076)
// ---------------------------------------------------------------------------------------------------------------

/** Empire.9.cs 2454 ReviewFleetPostures. */
export function reviewFleetPostures(galaxy: Galaxy, empire: Empire): void {
    setDefendFleets(galaxy, empire, false, false);
    reviewDefensiveFleetLocations(galaxy, empire);
}

/** Empire.9.cs 2460 UpdateFleetLeadShips. */
export function updateFleetLeadShips(galaxy: Galaxy, empire: Empire): void {
    const shipGroups = empireShipGroups(empire);
    for (let i = 0; i < shipGroups.length; i++) {
        const shipGroup = shipGroups[i];
        if (shipGroup != null && shipGroup.leadShip !== null && shipGroup.leadShip.isAutoControlled) {
            shipGroupUpdate(galaxy, shipGroup);
        }
    }
}

/** Empire.2.cs 2944 ReviewFleetAdmiralBonuses. */
export function reviewFleetAdmiralBonuses(galaxy: Galaxy, empire: Empire): void {
    if (empire.shipGroups !== null) {
        const shipGroups = empireShipGroups(empire);
        for (let i = 0; i < shipGroups.length; i++) {
            shipGroupReviewAdmiralBonuses(galaxy, shipGroups[i]!);
        }
    }
}

/** Empire.cs 2352 FleetMaximumCount. */
export function empireFleetMaximumCount(empire: Empire): number {
    let num = GALAXY_FLEET_MAXIMUM_COUNT;
    if (empire.builtObjects !== null) {
        num = Math.min(100, Math.max(num, Math.trunc(empire.builtObjects.length / 10)));
    }
    return num;
}

/** Empire.cs 3076 GetNextFleetNumberDescription ("1st", "2nd", "11th", ...). */
export function getNextFleetNumberDescription(empire: Empire): string {
    empire.fleetIdentity++;
    let text = String(empire.fleetIdentity);
    switch (text.substring(text.length - 1)) {
        case '0':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9':
            text += 'th';
            break;
        case '1':
            text = empire.fleetIdentity % 100 !== 11 ? text + 'st' : text + 'th';
            break;
        case '2':
            text = empire.fleetIdentity % 100 !== 12 ? text + 'nd' : text + 'th';
            break;
        case '3':
            text = empire.fleetIdentity % 100 !== 13 ? text + 'rd' : text + 'th';
            break;
    }
    return text;
}

/** Empire.8.cs 5145 DisbandShipGroup(shipGroup). */
export function disbandShipGroup(galaxy: Galaxy, empire: Empire, shipGroup: ShipGroup): void {
    void galaxy;
    for (let i = 0; i < shipGroup.ships.length; i++) {
        const builtObject = shipGroup.ships[i];
        builtObject.shipGroup = null;
    }
    shipGroup.ships.length = 0;
    const shipGroups = empireShipGroups(empire);
    const index = shipGroups.indexOf(shipGroup);
    if (index >= 0) {
        shipGroups.splice(index, 1);
    }
}

/** Empire.9.cs 2732/2737 SortBuiltObjectsByDistance(builtObjects, x, y[, minimumFuelPortionFilter]): in place, by SortTag. */
export function sortBuiltObjectsByDistance(galaxy: Galaxy, builtObjects: BuiltObject[], x: number, y: number, minimumFuelPortionFilter = 0.0): BuiltObject[] {
    for (let i = 0; i < builtObjects.length; i++) {
        if (minimumFuelPortionFilter > 0.0) {
            let num = galaxy.calculateDistanceSquared(builtObjects[i].xpos, builtObjects[i].ypos, x, y);
            const num2 = builtObjects[i].currentFuel / Math.max(1, builtObjects[i].fuelCapacity);
            if (num2 < minimumFuelPortionFilter) {
                num *= 100.0;
            }
            builtObjects[i].sortTag = num;
        } else {
            builtObjects[i].sortTag = galaxy.calculateDistanceSquared(builtObjects[i].xpos, builtObjects[i].ypos, x, y);
        }
    }
    // BuiltObjectList.Sort(): BuiltObject.CompareTo = SortTag.CompareTo.
    netSort(builtObjects, (a, b) => compareDouble(a.sortTag, b.sortTag));
    return builtObjects;
}

/** Galaxy.7.cs 569 ConditionCheckLimit(condition, maximumIterations, ref iterationCount). */
function conditionCheckLimit(condition: boolean, maximumIterations: number, iterationCount: { value: number }): boolean {
    if (iterationCount.value >= maximumIterations) {
        return false;
    }
    iterationCount.value++;
    return condition;
}

/** Empire.8.cs 5217 FindAvailableMilitaryShip(x, y, militaryShips, mustCarryTroopsIfHaveTroopStorage, mustBeFullOfTroops, minimumFuelPortion, mustHaveHyperdrive). */
function findAvailableMilitaryShip(galaxy: Galaxy, x: number, y: number, militaryShips: BuiltObject[], mustCarryTroopsIfHaveTroopStorage: boolean, mustBeFullOfTroops: boolean, minimumFuelPortion: number, mustHaveHyperdrive: boolean | null): BuiltObject | null {
    for (let i = 0; i < militaryShips.length; i++) {
        const builtObject = militaryShips[i];
        const m = missionOf(builtObject);
        if (
            builtObject.shipGroup !== null ||
            builtObject.subRole === BuiltObjectSubRole.Escort ||
            builtObject.subRole === BuiltObjectSubRole.ResupplyShip ||
            builtObject.builtAt !== null ||
            (m !== null && m.type !== BuiltObjectMissionType.Undefined && m.priority !== BuiltObjectMissionPriority.Undefined && m.priority !== BuiltObjectMissionPriority.Low && m.priority !== BuiltObjectMissionPriority.Normal) ||
            !builtObject.isAutoControlled
        ) {
            continue;
        }
        let flag = true;
        if (mustHaveHyperdrive !== null) {
            if (mustHaveHyperdrive) {
                if (builtObject.warpSpeed <= 0) flag = false;
            } else if (builtObject.warpSpeed > 0) {
                flag = false;
            }
        }
        if (!flag) {
            continue;
        }
        const num = Math.fround(builtObject.currentFuel / builtObject.fuelCapacity);
        if (!(num >= minimumFuelPortion)) {
            continue;
        }
        let flag2 = true;
        if (x >= 0.0 && y >= 0.0) {
            flag2 = withinFuelRange(galaxy, builtObject, x, y, 0.0);
        }
        if (!flag2) {
            continue;
        }
        if (mustBeFullOfTroops) {
            if (builtObject.troops !== null && builtObject.troops.totalAttackStrength > 0 && builtObject.troopCapacityRemaining < 100) {
                return builtObject;
            }
            continue;
        }
        if (mustCarryTroopsIfHaveTroopStorage) {
            if (builtObject.troopCapacity <= 0) {
                return builtObject;
            }
            if (builtObject.troops === null || builtObject.troops.totalAttackStrength <= 0) {
                continue;
            }
            const num2 = Math.trunc(builtObject.troopCapacity / 2);
            if (builtObject.troopCapacityRemaining <= num2) {
                return builtObject;
            }
        } else if (builtObject.subRole === BuiltObjectSubRole.TroopTransport) {
            continue;
        }
        return builtObject;
    }
    return null;
}

/** Empire.9.cs 2763/2768 AddShipsToShipGroup(shipGroup, militaryShips, targetShipAmount, isNew, waypoint[, minimumFuelPortion = 0f]). */
export function addShipsToShipGroup(galaxy: Galaxy, empire: Empire, shipGroup: ShipGroup, militaryShips: BuiltObject[], targetShipAmount: number, isNew: boolean, waypoint: StellarObject | null, minimumFuelPortion = 0): void {
    minimumFuelPortion = Math.fround(minimumFuelPortion);
    let mustHaveHyperdrive: boolean | null = null;
    if (shipGroup.ships.length > 0) {
        mustHaveHyperdrive = shipGroupWarpSpeed(shipGroup) <= 0 ? false : true;
    }
    if (checkEmpireHasHyperDriveTech(empire)) {
        mustHaveHyperdrive = true;
    }
    const stellarObject = shipGroupIdentifyFleetLocation(shipGroup);
    let x: number;
    let y: number;
    if (stellarObject !== null) {
        x = stellarObject.xpos;
        y = stellarObject.ypos;
    } else if (shipGroup.leadShip !== null) {
        x = shipGroup.leadShip.xpos;
        y = shipGroup.leadShip.ypos;
    } else {
        x = -Number.MAX_VALUE; // double.MinValue
        y = -Number.MAX_VALUE;
    }
    if (shipGroup.ships.length < targetShipAmount) {
        const iterationCount = { value: 0 };
        while (conditionCheckLimit(shipGroup.ships.length < targetShipAmount, 200, iterationCount)) {
            const builtObject =
                shipGroupTotalTroopAttackStrength(shipGroup) >= shipGroup.troopTargetStrength
                    ? findAvailableMilitaryShip(galaxy, x, y, militaryShips, false, false, minimumFuelPortion, mustHaveHyperdrive)
                    : findAvailableMilitaryShip(galaxy, x, y, militaryShips, true, false, minimumFuelPortion, mustHaveHyperdrive);
            if (builtObject === null) {
                break;
            }
            shipGroupAddShipToFleet(galaxy, shipGroup, builtObject);
            assignFleetWaypointMission(galaxy, builtObject, true, waypoint);
            if (shipGroup.ships.length > 0) {
                mustHaveHyperdrive = shipGroupWarpSpeed(shipGroup) <= 0 ? false : true;
            }
        }
        if (isNew) {
            shipGroupUpdate(galaxy, shipGroup);
        }
    }
    if (shipGroupTotalTroopAttackStrength(shipGroup) >= shipGroup.troopTargetStrength) {
        return;
    }
    const iterationCount2 = { value: 0 };
    while (conditionCheckLimit(shipGroupTotalTroopAttackStrength(shipGroup) < shipGroup.troopTargetStrength, 100, iterationCount2)) {
        const builtObject2 = findAvailableMilitaryShip(galaxy, x, y, militaryShips, false, true, minimumFuelPortion, mustHaveHyperdrive);
        if (builtObject2 === null) {
            break;
        }
        shipGroupAddShipToFleet(galaxy, shipGroup, builtObject2);
        assignFleetWaypointMission(galaxy, builtObject2, true, waypoint);
        if (shipGroup.ships.length > 0) {
            mustHaveHyperdrive = shipGroupWarpSpeed(shipGroup) <= 0 ? false : true;
        }
    }
    if (isNew) {
        shipGroupUpdate(galaxy, shipGroup);
    }
}

/** Empire.9.cs 2232 FindNearestRefuellingPoint(x, y, fuelType, minimumDockingBays). */
export function empireFindNearestRefuellingPoint(galaxy: Galaxy, empire: Empire, x: number, y: number, fuelType: ResourceRef | null, minimumDockingBays: number): StellarObject | null {
    let result: StellarObject | null = null;
    let num = Number.MAX_VALUE;
    if (minimumDockingBays <= 3 && empire.pirateEmpireBaseHabitat === null) {
        for (let i = 0; i < empire.colonies.length; i++) {
            if (fuelType === null) {
                continue;
            }
            const num2 = empire.colonies[i].cargo!.indexOf(fuelType, empire);
            if (num2 >= 0) {
                const num3 = galaxy.calculateDistanceSquared(x, y, empire.colonies[i].xpos, empire.colonies[i].ypos);
                if (num3 < num) {
                    result = empire.colonies[i];
                    num = num3;
                }
            }
        }
    }
    for (let j = 0; j < empire.spacePorts.length; j++) {
        const sp = empire.spacePorts[j];
        if (sp.dockingBays !== null && sp.dockingBays.length >= minimumDockingBays) {
            const num4 = galaxy.calculateDistanceSquared(x, y, sp.xpos, sp.ypos);
            if (num4 < num) {
                result = sp;
                num = num4;
            }
        }
    }
    for (let k = 0; k < empire.miningStations.length; k++) {
        const ms = empire.miningStations[k];
        // HabitatResourceList.IndexOf(resourceId, 0) ≥ 0: the parent habitat has the resource.
        if (ms.dockingBays !== null && ms.dockingBays.length >= minimumDockingBays && fuelType !== null && ms.parentHabitat !== null && ms.parentHabitat.resources.findIndex((r) => r.resourceId === fuelType.resourceId) >= 0) {
            const num5 = galaxy.calculateDistanceSquared(x, y, ms.xpos, ms.ypos);
            if (num5 < num) {
                result = ms;
                num = num5;
            }
        }
    }
    return result;
}

/** Empire.9.cs 2283 IdentifyTargetEmpires. */
export function identifyTargetEmpires(empire: Empire): Empire[] {
    const empireList: Empire[] = [];
    if (empire.pirateEmpireBaseHabitat !== null) {
        for (let i = 0; i < empire.pirateRelations.count; i++) {
            const pirateRelation = empire.pirateRelations.get(i);
            if (pirateRelation != null && pirateRelation.otherEmpire !== null && pirateRelation.type === PirateRelationType.None) {
                empireList.push(pirateRelation.otherEmpire);
            }
        }
    } else {
        for (let j = 0; j < empire.diplomaticRelations.count; j++) {
            const diplomaticRelation = empire.diplomaticRelations.at(j);
            if (diplomaticRelation.type === DiplomaticRelationType.War && !empireList.includes(diplomaticRelation.otherEmpire!)) {
                empireList.push(diplomaticRelation.otherEmpire!);
            }
        }
        for (let k = 0; k < empire.diplomaticRelations.count; k++) {
            const diplomaticRelation2 = empire.diplomaticRelations.at(k);
            if (diplomaticRelation2.type !== DiplomaticRelationType.War && diplomaticRelation2.strategy === DiplomaticStrategy.Conquer && !empireList.includes(diplomaticRelation2.otherEmpire!)) {
                empireList.push(diplomaticRelation2.otherEmpire!);
            }
        }
    }
    return empireList;
}

/** Empire.9.cs 2319/2324 SelectRandomSpacePort([spacePortsToExclude]). Rnd: Next(0, SpacePorts.Count). */
export function selectRandomSpacePort(galaxy: Galaxy, empire: Empire, spacePortsToExclude: readonly StellarObject[] = []): BuiltObject | null {
    const spacePorts = empire.spacePorts;
    const num = galaxy.rnd.next(0, spacePorts.length);
    for (let i = num; i < spacePorts.length; i++) {
        if (spacePorts[i] != null && !spacePortsToExclude.includes(spacePorts[i])) {
            return spacePorts[i];
        }
    }
    for (let j = 0; j < num; j++) {
        if (spacePorts[j] != null && !spacePortsToExclude.includes(spacePorts[j])) {
            return spacePorts[j];
        }
    }
    return null;
}

/** Galaxy.7.cs 665 DetermineHabitatSystemStarForStellarObject(stellarObject). */
function determineHabitatSystemStarForStellarObject(galaxy: Galaxy, stellarObject: StellarObject): Habitat | null {
    let result: Habitat | null = null;
    if (isHabitat(stellarObject)) {
        result = galaxy.determineHabitatSystemStar(stellarObject);
    } else if (isBuiltObject(stellarObject)) {
        result = stellarObject.nearestSystemStar;
    }
    return result;
}

/** Galaxy.7.cs 637 RemoveObjectsWithSystemStar(stellarObjects, systemStar). */
function removeObjectsWithSystemStar(galaxy: Galaxy, stellarObjects: StellarObject[], systemStar: Habitat | null): StellarObject[] {
    const stellarObjectList: StellarObject[] = [];
    for (let i = 0; i < stellarObjects.length; i++) {
        const habitat = determineHabitatSystemStarForStellarObject(galaxy, stellarObjects[i]);
        if (habitat !== systemStar) {
            stellarObjectList.push(stellarObjects[i]);
        }
    }
    return stellarObjectList;
}

/** HabitatPrioritizationList.cs 58 FindNearestHabitat(x, y) over Empire._ColonizationTargets. */
function colonizationTargetsFindNearestHabitat(empire: Empire, x: number, y: number): Habitat | null {
    let nearestHabitat: Habitat | null = null;
    let num = Number.MAX_VALUE;
    for (let index = 0; index < empire.colonizationTargets.length; ++index) {
        const entry = empire.colonizationTargets[index];
        if (entry != null) {
            const habitat = entry.habitat;
            if (habitat != null && !habitat.hasBeenDestroyed) {
                // Galaxy.CalculateDistanceSquaredStatic.
                const dx = x - habitat.xpos;
                const dy = y - habitat.ypos;
                const distanceSquaredStatic = dx * dx + dy * dy;
                if (nearestHabitat === null || distanceSquaredStatic < num) {
                    nearestHabitat = habitat;
                    num = distanceSquaredStatic;
                }
            }
        }
    }
    return nearestHabitat;
}

/** Empire.9.cs 2038 SelectFleetBase(fleet). Rnd: SelectRandomSpacePortColony / SelectRandomColony / SelectRandomSpacePort (Next(0, n)). */
export function selectFleetBase(galaxy: Galaxy, empire: Empire, fleet: ShipGroup): StellarObject | null {
    const shipGroups = empireShipGroups(empire);
    if (fleet.posture === FleetPosture.Defend) {
        let stellarObjects: StellarObject[] = resolveLocationsToDefend(galaxy, empire, true);
        stellarObjects = ensureSingleStellarObjectPerSystem(galaxy, stellarObjects);
        for (let i = 0; i < shipGroups.length; i++) {
            const shipGroup = shipGroups[i];
            if (shipGroup != null && shipGroup.gatherPoint !== null && shipGroup.posture === FleetPosture.Defend) {
                let idx: number;
                while ((idx = stellarObjects.indexOf(shipGroup.gatherPoint)) >= 0) {
                    stellarObjects.splice(idx, 1);
                }
                const systemStar = determineHabitatSystemStarForStellarObject(galaxy, shipGroup.gatherPoint);
                stellarObjects = removeObjectsWithSystemStar(galaxy, stellarObjects, systemStar);
            }
        }
        return selectDefensiveFleetBase(galaxy, empire, fleet, stellarObjects, false);
    }
    const stellarObjectList: StellarObject[] = [];
    for (let j = 0; j < shipGroups.length; j++) {
        const shipGroup2 = shipGroups[j]!;
        if (shipGroup2.gatherPoint !== null && !stellarObjectList.includes(shipGroup2.gatherPoint)) {
            stellarObjectList.push(shipGroup2.gatherPoint);
        }
    }
    const stellarObjectList2: StellarObject[] = [];
    if (empire.capital !== null && !stellarObjectList.includes(empire.capital)) {
        stellarObjectList2.push(empire.capital);
    }
    if (empire.pirateEmpireBaseHabitat !== null) {
        const habitat = colonizationTargetsFindNearestHabitat(empire, empire.pirateEmpireBaseHabitat.xpos, empire.pirateEmpireBaseHabitat.ypos);
        if (habitat !== null && fleet.leadShip !== null) {
            const stellarObject = empireFindNearestRefuellingPoint(galaxy, empire, habitat.xpos, habitat.ypos, fleet.leadShip.fuelType, 4);
            if (stellarObject !== null) {
                stellarObjectList2.push(stellarObject);
            }
        }
    } else {
        const empireList = identifyTargetEmpires(empire);
        for (const item of empireList) {
            // C# reads Capital without a null check here.
            const habitat2 = fastFindNearestColony(galaxy, Math.trunc(empire.capital!.xpos), Math.trunc(empire.capital!.ypos), item, 0);
            if (habitat2 !== null && empire.visibility.checkSystemExplored(habitat2.systemIndex) && fleet.leadShip !== null) {
                const stellarObject2 = empireFindNearestRefuellingPoint(galaxy, empire, habitat2.xpos, habitat2.ypos, fleet.leadShip.fuelType, 4);
                if (stellarObject2 !== null) {
                    stellarObjectList2.push(stellarObject2);
                }
            }
        }
    }
    for (let k = 0; k < stellarObjectList2.length; k++) {
        if (!stellarObjectList.includes(stellarObjectList2[k]) && (fleet.gatherPoint === null || !stellarObjectList2.includes(fleet.gatherPoint))) {
            return stellarObjectList2[k];
        }
    }
    if (fleet.gatherPoint === null) {
        if (empire.pirateEmpireBaseHabitat === null) {
            const habitat3 = selectRandomSpacePortColony(galaxy, empire, stellarObjectList as unknown as (BuiltObject | Habitat)[]);
            if (habitat3 === null) {
                // SelectRandomColony: Colonies[Rnd.Next(0, Colonies.Count)] — the C# throws ArgumentOutOfRangeException for
                // an empire without colonies; the TS array read gives undefined, returned as null.
                return empire.selectRandomColony() ?? null;
            }
            return habitat3;
        }
        const builtObject = selectRandomSpacePort(galaxy, empire);
        if (builtObject !== null) {
            return builtObject;
        }
    }
    return fleet.gatherPoint;
}

/** The six sub-roles MaintainShipGroups gathers (Empire.9.cs 2474-2480). */
const FLEET_SUB_ROLES: readonly BuiltObjectSubRole[] = [BuiltObjectSubRole.Frigate, BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.Cruiser, BuiltObjectSubRole.CapitalShip, BuiltObjectSubRole.TroopTransport, BuiltObjectSubRole.Carrier];

/** Empire.9.cs 2472 MaintainShipGroups. */
export function maintainShipGroups(galaxy: Galaxy, empire: Empire): void {
    // 2474-2502: BuiltObjects.GetBuiltObjectsBySubRole(list) minus planet destroyers, player-controlled ships and ships already in a fleet.
    let builtObjectList: BuiltObject[] = [];
    for (let i = 0; i < empire.builtObjects.length; i++) {
        const bo = empire.builtObjects[i];
        if (bo != null && FLEET_SUB_ROLES.includes(bo.subRole)) builtObjectList.push(bo);
    }
    const builtObjectList2: BuiltObject[] = [];
    for (const item of builtObjectList) {
        if (item.isPlanetDestroyer) {
            builtObjectList2.push(item);
        } else if (!item.isAutoControlled) {
            builtObjectList2.push(item);
        } else if (item.shipGroup !== null) {
            builtObjectList2.push(item);
        }
    }
    for (const item2 of builtObjectList2) {
        const idx = builtObjectList.indexOf(item2);
        if (idx >= 0) builtObjectList.splice(idx, 1);
    }
    // 2503-2537
    let num = 0;
    for (let i = 0; i < empire.builtObjects.length; i++) {
        if (empire.builtObjects[i].role === BuiltObjectRole.Military) num++;
    }
    let val = (aggressionLevel(empire) + cautionLevel(empire)) / 200.0;
    val = Math.max(0.8, Math.min(1.2, val));
    let val2 = 0.6 * val;
    val2 = Math.max(0.5, Math.min(0.7, val2));
    val2 = Math.fround(Math.fround(empire.policy!.fleetMilitaryProportionForFleets) / 100);
    let num2 = Math.trunc(num * val2);
    if (num2 < 1) num2 = 1;
    let num3 = Math.trunc(GALAXY_FLEET_TYPICAL_SIZE * val);
    let num4 = Math.trunc(GALAXY_STRIKE_FORCE_TYPICAL_SIZE * val);
    num3 = empire.policy!.fleetTypicalSize;
    num4 = empire.policy!.fleetStrikeForceTypicalSize;
    if (num3 < 1) num3 = 1;
    if (num4 < 1) num4 = 1;
    const num5 = Math.trunc(galaxy.difficultyLevel * COLONY_MAXIMUM_TROOP_STRENGTH);
    let num6 = Math.trunc(num5 * val * 2.2);
    const troopTargetStrength = 0;
    if (empire.pirateEmpireBaseHabitat !== null && empire.troops.count <= 0) {
        num6 = 0;
    }
    // 2538-2545
    let num7 = 0;
    for (const item3 of builtObjectList) {
        const m = missionOf(item3);
        if (item3.shipGroup === null && (m === null || m.type === BuiltObjectMissionType.Undefined || m.priority === BuiltObjectMissionPriority.Low || m.priority === BuiltObjectMissionPriority.Normal)) {
            num7++;
        }
    }
    // 2546-2583
    const shipGroups = empireShipGroups(empire);
    let num8 = 0;
    let num9 = 0;
    for (let j = 0; j < shipGroups.length; j++) {
        if (shipGroups[j]!.shipTargetAmount >= 10) num8++;
        else num9++;
    }
    let num10 = num3;
    const num11 = num4;
    let num12 = (num2 * 0.75) / num3;
    let num13 = (num2 * 0.25) / num4;
    if (num12 > 0.1 && num12 < 1.0) {
        num12 = 1.0;
        num13 = 0.0;
        num10 = Math.min(num3, num7);
        num6 = Math.trunc(num6 / 2);
    }
    let num14 = Math.trunc(num12 + 0.5);
    let num15 = Math.trunc(num13 + 0.5);
    const num16 = num12 / (num12 + num13);
    const num17 = Math.max(1, Math.trunc(empireFleetMaximumCount(empire) * num16));
    const num18 = Math.max(1, empireFleetMaximumCount(empire) - num17);
    if (num14 > num17) num14 = num17;
    if (num15 > num18) num15 = num18;
    // 2584-2625: disband surplus idle fleets / strike forces.
    if (num8 > num14 && num8 + num9 > num14 + num15) {
        const num19 = num8 - num14;
        const shipGroupList: ShipGroup[] = [];
        for (let k = 0; k < shipGroups.length; k++) {
            const shipGroup = shipGroups[k]!;
            if (shipGroup.shipTargetAmount >= 10 && shipGroup.leadShip!.isAutoControlled && (shipGroup.mission === null || shipGroup.mission.type === BuiltObjectMissionType.Undefined)) {
                shipGroupList.push(shipGroup);
                if (shipGroupList.length >= num19) break;
            }
        }
        for (const item4 of shipGroupList) disbandShipGroup(galaxy, empire, item4);
    }
    if (num9 > num15 && num8 + num9 > num14 + num15) {
        const num20 = num9 - num15;
        const shipGroupList2: ShipGroup[] = [];
        for (let l = 0; l < shipGroups.length; l++) {
            const shipGroup2 = shipGroups[l]!;
            if (shipGroup2.shipTargetAmount < 10 && shipGroup2.leadShip!.isAutoControlled && (shipGroup2.mission === null || shipGroup2.mission.type === BuiltObjectMissionType.Undefined)) {
                shipGroupList2.push(shipGroup2);
                if (shipGroupList2.length >= num20) break;
            }
        }
        for (const item5 of shipGroupList2) disbandShipGroup(galaxy, empire, item5);
    }
    // 2626-2672: top up idle fleets; troop transports with space go to load troops.
    const builtObjectList3: BuiltObject[] = [];
    for (let m = 0; m < shipGroups.length; m++) {
        const shipGroup3 = shipGroups[m]!;
        if (!shipGroup3.leadShip!.isAutoControlled) {
            continue;
        }
        if (shipGroup3.mission === null || (shipGroup3.mission.type !== BuiltObjectMissionType.Attack && shipGroup3.mission.type !== BuiltObjectMissionType.WaitAndAttack)) {
            for (let n = 0; n < shipGroup3.ships.length; n++) {
                const builtObject = shipGroup3.ships[n];
                const bm = missionOf(builtObject);
                if (builtObject.subRole === BuiltObjectSubRole.TroopTransport && builtObject.isAutoControlled && builtObject.troopCapacityRemaining >= 100 && (bm === null || bm.type === BuiltObjectMissionType.Undefined || bm.priority === BuiltObjectMissionPriority.Undefined || bm.priority === BuiltObjectMissionPriority.Low)) {
                    builtObjectList3.push(builtObject);
                }
            }
        }
        const sm = shipGroup3.mission;
        if (sm === null || sm.type === BuiltObjectMissionType.Undefined || sm.type === BuiltObjectMissionType.Hold || sm.type === BuiltObjectMissionType.MoveAndWait || sm.type === BuiltObjectMissionType.Refuel || sm.type === BuiltObjectMissionType.Retrofit) {
            let targetShipAmount = num10;
            if (shipGroup3.shipTargetAmount < 10) {
                targetShipAmount = num11;
            }
            let stellarObject = shipGroupIdentifyFleetLocation(shipGroup3);
            if (stellarObject === null) {
                stellarObject = shipGroup3.leadShip;
            }
            if (stellarObject !== null) {
                builtObjectList = sortBuiltObjectsByDistance(galaxy, builtObjectList, stellarObject.xpos, stellarObject.ypos);
            }
            addShipsToShipGroup(galaxy, empire, shipGroup3, builtObjectList, targetShipAmount, false, null, 0.6);
        }
    }
    for (const item6 of builtObjectList3) {
        if (assignLoadTroopsMission(galaxy, empire, item6)) {
            leaveShipGroup(galaxy, item6);
        }
    }
    // 2673-2700: new fleets.
    let num21 = 0;
    while (num8 < num14 && num7 >= Math.trunc(num10 / 2) && num21 < 10) {
        const shipGroup4 = new ShipGroup(galaxy);
        shipGroup4.empire = empire;
        shipGroup4.shipTargetAmount = num3;
        shipGroup4.troopTargetStrength = num6;
        shipGroup4.gatherPoint = selectFleetBase(galaxy, empire, shipGroup4);
        if (shipGroup4.gatherPoint !== null) {
            builtObjectList = sortBuiltObjectsByDistance(galaxy, builtObjectList, shipGroup4.gatherPoint.xpos, shipGroup4.gatherPoint.ypos);
        }
        addShipsToShipGroup(galaxy, empire, shipGroup4, builtObjectList, num10, true, shipGroup4.gatherPoint, 0.6);
        if (shipGroup4.ships.length <= 0) {
            break;
        }
        const nextFleetNumberDescription = getNextFleetNumberDescription(empire);
        shipGroup4.name = formatText('{0} Fleet', nextFleetNumberDescription); // GameText "Nth Fleet"
        shipGroups.push(shipGroup4);
        netSort(shipGroups, compareShipGroups);
        num7 -= shipGroup4.ships.length;
        num8++;
        num21++;
        if (num8 >= num14) {
            break;
        }
    }
    // 2701-2729: new strike forces.
    num21 = 0;
    while (num9 < num15 && num7 >= num11 && num21 < 10) {
        const shipGroup5 = new ShipGroup(galaxy);
        shipGroup5.empire = empire;
        shipGroup5.shipTargetAmount = num4;
        shipGroup5.troopTargetStrength = troopTargetStrength;
        shipGroup5.gatherPoint = selectFleetBase(galaxy, empire, shipGroup5);
        if (shipGroup5.gatherPoint !== null) {
            builtObjectList = sortBuiltObjectsByDistance(galaxy, builtObjectList, shipGroup5.gatherPoint.xpos, shipGroup5.gatherPoint.ypos);
        }
        addShipsToShipGroup(galaxy, empire, shipGroup5, builtObjectList, num11, true, shipGroup5.gatherPoint, 0.6);
        if (shipGroup5.ships.length > 0) {
            const nextFleetNumberDescription2 = getNextFleetNumberDescription(empire);
            shipGroup5.name = formatText('{0} Strike Force', nextFleetNumberDescription2); // GameText "Nth Strike Force"
            shipGroups.push(shipGroup5);
            netSort(shipGroups, compareShipGroups);
            num7 -= shipGroup5.ships.length;
            num9++;
            num21++;
            if (num9 >= num15) {
                break;
            }
            continue;
        }
        break;
    }
}

// Register the ported bodies behind fleets/shipGroup.ts's entry points (see the module comment).
registerShipGroupTasks({
    checkForMissionCompletion,
    checkForCompletedBattle,
    checkRefuelManual,
    checkRefuelRepairAttack,
    checkSendForAttack,
    reviewCharacterLocationBonuses,
    maintainShipGroups,
    updateFleetLeadShips,
    reviewFleetPostures,
    reviewFleetAdmiralBonuses,
    reviewFleetBonuses,
    performFleetTasks,
    forceCompleteMission,
    determineActualFleetLocation,
    shipGroupTotalOverallStrengthFactor,
    shipGroupAssignMission,
    disbandShipGroup,
    assignFleetWaypointMission,
    leaveShipGroup,
    shipGroupCompleteMission,
});
