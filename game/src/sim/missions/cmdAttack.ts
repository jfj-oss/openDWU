// M4n — ExecuteCommands cases Attack / Bombard / Capture / Raid: one shared case body, BuiltObject.2.cs 1698-2730.
//
// Handler contract: executeCommands.ts (M4b) passes the shared locals as `CommandContext` (bo = this, mission, command,
// timePassed / time / starDate, targetX / targetY = num / num2, indexX / indexY = x / y) and the handler returns the C#
// `result`. Every C# `break` out of the switch is a `return result` here.
//
// Galaxy.Rnd, in C# order:
//   2050 `num66 > Galaxy.Rnd.NextDouble()` — the SensorJumpIntercept roll before a warp pursuit (only when flag23);
//   2358 `Galaxy.Rnd.NextDouble() * 100.0 < val2` and 2362 `num87 * Galaxy.Rnd.NextDouble()` per landing troop;
//   2379 `Galaxy.Rnd.Next(0, list.Count)` only when Habitat.ColonyInvasion != null (the UI invasion view; always null headless).
// Weapon firing, bombardment and planet-destroyer fire are in combat/weapons.ts; assault pods, invasion stats and
// character landing in combat/boarding.ts and combat/invasion.ts; DoMovement in movement.ts.

import type { BuiltObject } from '../builtObject';
import type { Habitat } from '../types';
import type { Empire } from '../empire';
import { AutomationLevel } from '../empire';
import type { Galaxy } from '../galaxy';
import { TroopType, type Troop, TroopList } from '../cargo';
import { CharacterRole, countCharactersByRole, stellarObjectCharacters, type Character } from '../characters';
import { EmpireMessageType, sendMessageToEmpire } from '../messages';
import { gameText } from '../colonyTick';
import { calculatePirateProtectionPricePerMonth } from '../pirates/pirateRelationsAI';
import { PirateRelationType, changePirateRelation, obtainPirateRelation } from '../pirateRelations';
import { strategicValue } from '../territory';
import { baconMovementSettings, doMovement, withinFuelRange } from '../movement';
import { declareWar } from '../diplomacyTick';
import { bombardTarget, firePlanetDestroyerAtHabitat, fireWeaponsAtTarget, modifyDiplomacyFromAttackEmpire } from '../combat/weapons';
import { checkLaunchAssaultPodsAtTarget, shipGroupTotalAvailableBoardingAssaultStrengthCapturingTarget } from '../combat/boarding';
import { addInvasionStatsTroopsDamageToInvaders, characterCompleteLocationTransferInvading, habitatStopRebelling, targetInvadingShips } from '../combat/invasion';
import { builtObjectThreats, builtObjectThreatLevels, determineShipGroupTarget, shipGroupOf, shouldInvadeColony, stellarAttackers, stellarCurrentSpeed, stellarCurrentTarget, stellarEmpire, stellarFirepowerRaw, stellarTopSpeed, type Threat } from '../combat/threats';
import {
    INVASION_DROPOFF_RANGE,
    MOVEMENT_DECELERATION_RANGE_INVASION,
    MOVEMENT_IMPULSE_SPEED,
    calculateAvailableAssaultPodAttackStrength,
    canDestroyHabitat,
    checkForHyperExitGravityWell,
    checkOurEmpireOverwhelmingBoarding,
    determineAngle,
    determineSpacePortAtColony,
    habitatPlanetaryShieldPresent,
    notifyOfAttackBuiltObject,
    notifyOfAttackHabitat,
    setOptimalAttackRanges,
    setOptimalAttackRangesBoarding,
    shouldAttack,
    stellarParentBuiltObject,
} from '../combat/attackAI';
import { BuiltObjectMissionType, Command, CommandAction, builtObjectMission, isBuiltObject, isCreature, type StellarObject } from './mission';
import type { CommandHandler } from './executeCommands';

/** The threat-slot rejection test repeated at 1743 / 1774 / 1860 / 2004 / 2094 / 2270. */
function threatRejected(bo: BuiltObject, t: Threat | null): boolean {
    return t === null || t.hasBeenDestroyed || stellarEmpire(t) === bo.empire || (bo.pirateEmpireId > 0 && isBuiltObject(t) && t.pirateEmpireId === bo.pirateEmpireId);
}

/**
 * The `while (rejected(_Threats[n])) { _Threats[n] = null; n++; if (n >= Length) { n = 0; break; } }` scan (1743-1757 and
 * twins): the index of the first acceptable threat, or -1 when the scan wrapped (slot 0 was nulled, so the re-check fails).
 */
function firstAcceptableThreatIndex(bo: BuiltObject): number {
    const threats = builtObjectThreats(bo);
    let n = 0;
    while (threatRejected(bo, threats[n])) {
        threats[n] = null;
        n++;
        if (n >= threats.length) {
            return -1;
        }
    }
    return n;
}

/** `Characters != null && Characters.Count > 0 && Characters.CountCharactersByRole(TroopGeneral) > 0`. */
function hasTroopGeneral(bo: BuiltObject): boolean {
    const chars = stellarObjectCharacters(bo);
    return chars !== null && chars.length > 0 && countCharactersByRole(chars, CharacterRole.TroopGeneral) > 0;
}

/** `Characters != null && Characters.Count > 0`. */
function hasCharacters(bo: BuiltObject): boolean {
    const chars = stellarObjectCharacters(bo);
    return chars !== null && chars.length > 0;
}

/** `Attackers.Contains(x) → Attackers.Remove(x)` (List.Remove: first occurrence). */
function removeFromList(list: unknown[] | null, item: unknown): void {
    if (list === null) return;
    const i = list.indexOf(item);
    if (i >= 0) list.splice(i, 1);
}

/** StellarObject.TargetHeading (float) — BuiltObject / Creature. */
function stellarTargetHeading(o: StellarObject): number {
    if (isBuiltObject(o) || isCreature(o)) return o.targetHeading;
    return 0;
}

/** StellarObject.ParentHabitat — BuiltObject / Creature. */
function stellarParentHabitat(o: StellarObject): Habitat | null {
    if (isBuiltObject(o) || isCreature(o)) return o.parentHabitat;
    return null;
}

/** BuiltObject.2.cs 1698 case Attack / Bombard / Capture / Raid. */
export const cmdAttackBombardCaptureRaid: CommandHandler = (ctx) => {
    const { galaxy, bo, mission, command, timePassed, time, starDate } = ctx;
    const num = ctx.targetX;
    const num2 = ctx.targetY;
    const x = ctx.indexX;
    const y = ctx.indexY;
    let result = 0.0;

    bo.hyperDenyActive = true;
    if (bo.firstExecutionOfCommand) {
        bo.lastInvasionDistance = 536870911.0;
        if (command.targetBuiltObject === null && command.targetHabitat === null && command.targetShipGroup === null && command.targetCreature === null) {
            if (mission.targetBuiltObject === null && mission.targetHabitat === null && mission.targetCreature === null && mission.targetShipGroup === null) {
                bo.currentTarget = null;
                mission.completeCommand();
                bo.firstExecutionOfCommand = true;
                result = timePassed;
                return result;
            }
            if (mission.targetHabitat !== null) {
                if (mission.targetHabitat.empire !== bo.empire) {
                    if ((mission.targetHabitat.empire === null && command.action !== CommandAction.Bombard) || mission.targetHabitat.hasBeenDestroyed) {
                        bo.currentTarget = null;
                        mission.completeCommand();
                        bo.firstExecutionOfCommand = true;
                        result = timePassed;
                        return result;
                    }
                    let flag20 = true;
                    const shipGroup = shipGroupOf(bo);
                    if (shipGroup !== null && shipGroup.mission !== null && shipGroup.mission.type === BuiltObjectMissionType.Bombard && bo.bombardWeaponPower <= 0 && bo.troops !== null && bo.troops.count > 0) {
                        flag20 = false;
                    }
                    if (flag20) {
                        command.targetHabitat = mission.targetHabitat;
                        bo.colonyToAttack = mission.targetHabitat;
                    }
                } else if (builtObjectThreats(bo).length > 0) {
                    const num60 = firstAcceptableThreatIndex(bo);
                    if (num60 < 0) {
                        result = 0.0;
                        return result;
                    }
                    const t = builtObjectThreats(bo)[num60]!;
                    if (shouldAttack(galaxy, bo, t, time)) {
                        if (isBuiltObject(t)) {
                            command.targetBuiltObject = t;
                        } else if (isCreature(t) && command.action !== CommandAction.Capture && command.action !== CommandAction.Raid) {
                            command.targetCreature = t;
                        }
                    }
                }
            } else if (builtObjectThreats(bo).length > 0) {
                const num61 = firstAcceptableThreatIndex(bo);
                if (num61 < 0) {
                    result = 0.0;
                    return result;
                }
                const t = builtObjectThreats(bo)[num61]!;
                if (shouldAttack(galaxy, bo, t, time)) {
                    if (isBuiltObject(t)) {
                        command.targetBuiltObject = t;
                    } else if (isCreature(t) && command.action !== CommandAction.Capture && command.action !== CommandAction.Raid) {
                        command.targetCreature = t;
                    }
                }
            }
        }
        if (command.targetBuiltObject === null && command.targetHabitat === null && command.targetCreature === null && command.targetShipGroup === null) {
            bo.currentTarget = null;
            mission.completeCommand();
            bo.firstExecutionOfCommand = true;
            result = timePassed;
            return result;
        }
        let empire: Empire | null = null;
        if (command.targetBuiltObject !== null) {
            bo.currentTarget = command.targetBuiltObject;
            notifyOfAttackBuiltObject(galaxy, bo, bo.empire, command.targetBuiltObject, true);
            empire = command.targetBuiltObject.empire;
        } else if (command.targetCreature !== null) {
            bo.currentTarget = command.targetCreature;
        } else if (command.targetShipGroup !== null) {
            const targetShipGroup3 = command.targetShipGroup;
            bo.currentTarget = determineShipGroupTarget(galaxy, bo, targetShipGroup3, time);
            if (bo.currentTarget !== null && isBuiltObject(bo.currentTarget)) {
                notifyOfAttackBuiltObject(galaxy, bo, bo.empire, bo.currentTarget, true);
            }
            empire = targetShipGroup3.empire;
        } else {
            if (command.targetHabitat === null) {
                throw new Error('Invalid attack target');
            }
            let flag21 = true;
            const shipGroup = shipGroupOf(bo);
            if (shipGroup !== null && shipGroup.mission !== null && shipGroup.mission.targetHabitat === command.targetHabitat && (shipGroup.mission.type === BuiltObjectMissionType.Bombard || shipGroup.mission.type === BuiltObjectMissionType.WaitAndBombard) && ((bo.troops !== null && bo.troops.count > 0) || hasTroopGeneral(bo)) && (command.action === CommandAction.Attack || command.action === CommandAction.Bombard) && bo.bombardRange <= 0) {
                flag21 = false;
            }
            if ((bo.troops === null || bo.troops.totalAttackStrength <= 0) && !hasTroopGeneral(bo) && (!bo.isPlanetDestroyer || command.targetHabitat.hasBeenDestroyed) && command.action !== CommandAction.Bombard && command.action !== CommandAction.Raid) {
                flag21 = false;
            }
            if (!flag21) {
                bo.colonyToAttack = null;
                const targetHabitat8 = command.targetHabitat;
                const builtObject7 = determineSpacePortAtColony(galaxy, targetHabitat8);
                if (builtObject7 !== null) {
                    bo.currentTarget = builtObject7;
                    notifyOfAttackBuiltObject(galaxy, bo, bo.empire, builtObject7, true);
                    empire = builtObject7.empire;
                } else if (builtObjectThreats(bo).length > 0) {
                    const num62 = firstAcceptableThreatIndex(bo);
                    if (num62 < 0) {
                        result = 0.0;
                        return result;
                    }
                    const t = builtObjectThreats(bo)[num62]!;
                    if (shouldAttack(galaxy, bo, t, time)) {
                        bo.currentTarget = t;
                        setOptimalAttackRanges(galaxy, bo, t, command.action);
                        if (isBuiltObject(t)) {
                            const builtObject8 = t;
                            notifyOfAttackBuiltObject(galaxy, bo, bo.empire, builtObject8, true);
                            empire = builtObject8.empire;
                        }
                    }
                }
            } else {
                if (command.targetHabitat.empire === bo.empire) {
                    bo.colonyToAttack = null;
                    bo.currentTarget = null;
                    mission.completeCommand();
                    bo.firstExecutionOfCommand = true;
                    result = timePassed;
                    return result;
                }
                notifyOfAttackHabitat(galaxy, bo, bo.empire, command.targetHabitat, false, true, false);
                empire = command.targetHabitat.empire;
            }
        }
        bo.preferredSpeed = Math.fround(bo.topSpeed);
        bo.targetSpeed = Math.trunc(bo.preferredSpeed);
        if (bo.currentTarget !== null) {
            setOptimalAttackRanges(galaxy, bo, bo.currentTarget as StellarObject, command.action);
        }
        if (empire !== null && !empire.pirateExtortionOfferMade && bo.empire !== null && bo.empire.pirateEmpireBaseHabitat !== null) {
            if (empire === galaxy.playerEmpire && empire.pirateEmpireBaseHabitat === null) {
                // TextResolver "Pirate Protection Extortion" (GameText.txt 5186). Its {0} is the monthly fee: the C# passes the
                // unformatted text, so fill it with the protection price the pirates would ask (the offer path's figure).
                const text = gameText('Pirate Protection Extortion', Math.trunc(calculatePirateProtectionPricePerMonth(galaxy, bo.empire, empire).price));
                sendMessageToEmpire(bo.empire, empire, EmpireMessageType.PirateOfferProtection, null, text, { x: 0, y: 0 }, 'extort');
            }
            empire.pirateExtortionOfferMade = true;
        }
        bo.firstExecutionOfCommand = false;
    }
    let currentTarget = bo.currentTarget as StellarObject | null;
    if (currentTarget === null) {
        if ((command.targetHabitat === null || command.action !== CommandAction.Raid || calculateAvailableAssaultPodAttackStrength(galaxy, bo, time) <= 0) && (command.targetHabitat === null || ((bo.troops === null || bo.troops.totalAttackStrength <= 0) && !hasTroopGeneral(bo) && !bo.isPlanetDestroyer && command.action !== CommandAction.Bombard) || command.targetHabitat.owner === bo.empire)) {
            if (mission.targetShipGroup !== null) {
                const targetShipGroup4 = mission.targetShipGroup;
                bo.currentTarget = determineShipGroupTarget(galaxy, bo, targetShipGroup4, time);
                command.targetShipGroup = targetShipGroup4;
                if (bo.currentTarget !== null) {
                    bo.firstExecutionOfCommand = true;
                    result = timePassed;
                    return result;
                }
                bo.currentTarget = null;
                mission.completeCommand();
                result = timePassed;
                bo.firstExecutionOfCommand = true;
            } else {
                bo.currentTarget = null;
                mission.completeCommand();
                bo.firstExecutionOfCommand = true;
                result = timePassed;
            }
            return result;
        }
    } else if (currentTarget.hasBeenDestroyed || stellarEmpire(currentTarget) === bo.empire || (bo.pirateEmpireId > 0 && isBuiltObject(currentTarget) && currentTarget.pirateEmpireId === bo.pirateEmpireId)) {
        if (mission.targetShipGroup !== null) {
            const targetShipGroup5 = mission.targetShipGroup;
            bo.currentTarget = determineShipGroupTarget(galaxy, bo, targetShipGroup5, time);
            command.targetShipGroup = targetShipGroup5;
            if (bo.currentTarget !== null) {
                bo.firstExecutionOfCommand = true;
                result = timePassed;
                return result;
            }
            bo.currentTarget = null;
            mission.completeCommand();
            result = timePassed;
            bo.firstExecutionOfCommand = true;
        } else {
            bo.currentTarget = null;
            if (bo.colonyToAttack === null && command.targetHabitat === null) {
                mission.completeCommand();
                result = timePassed;
            } else {
                result = 0.0;
            }
            bo.firstExecutionOfCommand = true;
        }
        return result;
    }
    currentTarget = bo.currentTarget as StellarObject | null;
    let num63 = 0.0;
    if (currentTarget !== null && !currentTarget.hasBeenDestroyed) {
        num63 = galaxy.calculateDistance(bo.xpos, bo.ypos, currentTarget.xpos, currentTarget.ypos);
    }
    if (num63 > baconMovementSettings.hyperJumpThreshhold) {
        // currentTarget is non-null here (num63 > 0 requires it).
        const ct = currentTarget!;
        if (bo.warpSpeed > 0) {
            let flag22 = false;
            const builtObject9 = checkForHyperExitGravityWell(galaxy, bo, ct.xpos, ct.ypos);
            if (builtObject9 !== null) {
                const num64 = galaxy.calculateDistance(bo.xpos, bo.ypos, builtObject9.xpos, builtObject9.ypos);
                const num65 = num64 / builtObject9.hyperStopRange;
                if (num65 < 2.0) {
                    flag22 = true;
                }
            }
            if (!flag22) {
                if (num63 > bo.sensorProximityArrayRange || (mission !== null && mission.type === BuiltObjectMissionType.Blockade)) {
                    if (mission.targetShipGroup !== null) {
                        const targetShipGroup6 = mission.targetShipGroup;
                        bo.currentTarget = determineShipGroupTarget(galaxy, bo, targetShipGroup6, time);
                        command.targetShipGroup = targetShipGroup6;
                        if (bo.currentTarget !== null) {
                            bo.firstExecutionOfCommand = true;
                            result = 0.0;
                            return result;
                        }
                    }
                    bo.currentTarget = null;
                    if (mission.targetHabitat !== null && !mission.targetHabitat.hasBeenDestroyed && mission.targetHabitat.empire !== bo.empire && ((bo.troops !== null && bo.troops.totalAttackStrength > 0) || mission.type === BuiltObjectMissionType.Raid)) {
                        result = 0.0;
                    } else {
                        mission.completeCommand();
                        result = timePassed;
                    }
                    bo.firstExecutionOfCommand = true;
                    return result;
                }
                let flag23 = true;
                if (isBuiltObject(ct)) {
                    const builtObject10 = ct;
                    if (builtObject10.nearestSystemStar !== bo.nearestSystemStar || (builtObject10.warpSpeed > 0 && builtObject10.currentSpeed > Math.fround(builtObject10.topSpeed))) {
                        flag23 = false;
                        if (mission.manuallyAssigned) {
                            flag23 = true;
                        }
                    }
                }
                const num66 = Math.trunc(bo.sensorJumpIntercept) / 100.0;
                // 2050: `!flag23 || !(num66 > Galaxy.Rnd.NextDouble())` — the draw happens only when flag23 is true.
                if (!flag23 || !(num66 > galaxy.rnd.nextDouble())) {
                    if (mission.targetShipGroup !== null) {
                        const targetShipGroup7 = mission.targetShipGroup;
                        bo.currentTarget = determineShipGroupTarget(galaxy, bo, targetShipGroup7, time);
                        command.targetShipGroup = targetShipGroup7;
                        if (bo.currentTarget !== null) {
                            bo.firstExecutionOfCommand = true;
                            result = 0.0;
                            return result;
                        }
                    }
                    bo.currentTarget = null;
                    if (mission.targetHabitat !== null && !mission.targetHabitat.hasBeenDestroyed && mission.targetHabitat.empire !== bo.empire && bo.troops !== null && bo.troops.totalAttackStrength > 0) {
                        result = 0.0;
                    } else {
                        mission.completeCommand();
                        result = timePassed;
                    }
                    bo.firstExecutionOfCommand = true;
                    return result;
                }
                let targetMission = null;
                if (isBuiltObject(ct)) {
                    targetMission = builtObjectMission(ct.mission);
                }
                if (targetMission !== null && targetMission.type !== BuiltObjectMissionType.Undefined && targetMission.showCurrentCommand() !== null && targetMission.showCurrentCommand()!.action === CommandAction.HyperTo) {
                    let num67 = ct.xpos;
                    let num68 = ct.ypos;
                    const command6 = targetMission.showCurrentCommand();
                    if (command6 !== null) {
                        if (command6.targetHabitat !== null) {
                            const targetHabitat9 = command6.targetHabitat;
                            num67 = targetHabitat9.xpos;
                            num68 = targetHabitat9.ypos;
                        } else if (command6.targetBuiltObject !== null) {
                            const targetBuiltObject8 = command6.targetBuiltObject;
                            num67 = targetBuiltObject8.xpos;
                            num68 = targetBuiltObject8.ypos;
                        } else if (command6.targetShipGroup !== null) {
                            const targetShipGroup8 = command6.targetShipGroup;
                            num67 = targetShipGroup8.leadShip!.xpos;
                            num68 = targetShipGroup8.leadShip!.ypos;
                        } else if (command6.targetCreature !== null) {
                            const targetCreature3 = command6.targetCreature;
                            num67 = targetCreature3.xpos;
                            num68 = targetCreature3.ypos;
                        }
                        if (command6.xpos > -2e9 && command6.ypos > -2e9) {
                            num67 = command6.xpos;
                            num68 = command6.ypos;
                        }
                    }
                    if (num67 < -2000000000.0 || num68 < -2000000000.0) {
                        bo.currentTarget = null;
                        mission.completeCommand();
                        bo.firstExecutionOfCommand = true;
                        result = timePassed;
                        return result;
                    }
                    if (bo.nearestSystemStar !== null && !mission.manuallyAssigned) {
                        const num69 = galaxy.calculateDistance(bo.nearestSystemStar.xpos, bo.nearestSystemStar.ypos, num67, num68);
                        if (num69 > galaxy.maxSolarSystemSize + 500.0) {
                            num67 = ct.xpos;
                            num68 = ct.ypos;
                        }
                    }
                    const num70 = galaxy.calculateDistance(bo.xpos, bo.ypos, num67, num68);
                    if (num70 > baconMovementSettings.hyperJumpThreshhold) {
                        if (bo.warpSpeed > 0) {
                            const command7 = Command.at(CommandAction.ConditionalHyperTo, num67, num68);
                            mission.insertCommandAtTop(command7);
                            bo.firstExecutionOfCommand = true;
                            result = timePassed;
                        } else if (!withinFuelRange(galaxy, bo, num67, num68, 0.0) && !mission.manuallyAssigned) {
                            bo.currentTarget = null;
                            mission.completeCommand();
                            bo.firstExecutionOfCommand = true;
                            result = timePassed;
                        }
                    }
                    return result;
                }
                if (bo.currentTarget !== null) {
                    if (bo.warpSpeed > 0) {
                        const command8 = Command.at(CommandAction.ConditionalHyperTo, ct.xpos, ct.ypos);
                        mission.insertCommandAtTop(command8);
                        bo.firstExecutionOfCommand = true;
                        result = timePassed;
                        return result;
                    }
                    if (!withinFuelRange(galaxy, bo, ct.xpos, ct.ypos, 0.0) && !mission.manuallyAssigned) {
                        bo.currentTarget = null;
                        mission.completeCommand();
                        bo.firstExecutionOfCommand = true;
                        result = timePassed;
                        return result;
                    }
                }
            }
        } else if (!withinFuelRange(galaxy, bo, ct.xpos, ct.ypos, 0.0) && !mission.manuallyAssigned) {
            bo.currentTarget = null;
            mission.completeCommand();
            bo.firstExecutionOfCommand = true;
            result = timePassed;
            return result;
        }
    }
    if (command.targetHabitat !== null && ((bo.troops !== null && bo.troops.totalAttackStrength > 0) || hasTroopGeneral(bo) || bo.isPlanetDestroyer || command.action === CommandAction.Bombard || (command.action === CommandAction.Raid && bo.assaultStrength > 0)) && command.targetHabitat.owner !== bo.empire) {
        bo.colonyToAttack = command.targetHabitat;
    }
    if (command.action === CommandAction.Bombard && bo.bombardWeaponPower > 0 && bo.colonyToAttack !== null && !bo.colonyToAttack.hasBeenDestroyed) {
        const colony = bo.colonyToAttack;
        doMovement(galaxy, bo, timePassed, colony.xpos, colony.ypos, x, y, 0.0, 0.0, false, true, false);
        const num71 = galaxy.calculateDistance(bo.xpos, bo.ypos, colony.xpos, colony.ypos);
        const num72 = bo.bombardRange;
        if (num71 <= num72) {
            notifyOfAttackHabitat(galaxy, bo, bo.empire, colony, true, false, true);
            if (colony.parent !== null) {
                bo.preferredSpeed = Math.fround(Math.trunc((colony.orbitSpeed + colony.parent.orbitSpeed) * 1.2) + 2);
            } else {
                bo.preferredSpeed = Math.fround(Math.trunc(Math.trunc(colony.orbitSpeed) * 1.2) + 2);
            }
            if (num71 < num72 / 1.3) {
                bo.preferredSpeed = 0;
            }
            bo.preferredSpeed = Math.fround(Math.min(bo.preferredSpeed, Math.fround(bo.topSpeed)));
            bo.targetSpeed = Math.trunc(bo.preferredSpeed);
            bombardTarget(galaxy, bo, num71, colony);
            if (colony.population === null || colony.population.items.length === 0 || colony.population.totalAmount <= 0) {
                bo.colonyToAttack = null;
                bo.currentTarget = null;
                mission.completeCommand();
                result = timePassed;
                bo.firstExecutionOfCommand = true;
                return result;
            }
        } else {
            bo.preferredSpeed = Math.fround(bo.topSpeed);
            bo.targetSpeed = Math.trunc(bo.preferredSpeed);
        }
    } else if (command.action === CommandAction.Raid && shouldInvadeColony(galaxy, bo, BuiltObjectMissionType.Raid)) {
        if (bo.colonyToAttack !== null) {
            const colony = bo.colonyToAttack;
            targetInvadingShips(galaxy, colony, bo, time);
            doMovement(galaxy, bo, timePassed, colony.xpos, colony.ypos, x, y, 0.0, 0.0, false, true, false);
            const num73 = calculateAvailableAssaultPodAttackStrength(galaxy, bo, time);
            if (num73 > 0) {
                const num74 = galaxy.calculateDistance(bo.xpos, bo.ypos, colony.xpos, colony.ypos);
                setOptimalAttackRangesBoarding(bo);
                if (num74 < bo.assaultRange) {
                    checkLaunchAssaultPodsAtTarget(galaxy, bo, time, colony);
                }
            } else {
                setOptimalAttackRanges(galaxy, bo, colony);
            }
        }
    } else if (command.action !== CommandAction.Bombard && shouldInvadeColony(galaxy, bo)) {
        const colony = bo.colonyToAttack!;
        targetInvadingShips(galaxy, colony, bo, time);
        doMovement(galaxy, bo, timePassed, colony.xpos, colony.ypos, x, y, 0.0, 0.0, false, true, false);
        const lastInvasionDistance = bo.lastInvasionDistance;
        const num75 = (bo.lastInvasionDistance = galaxy.calculateDistance(bo.xpos, bo.ypos, colony.xpos, colony.ypos));
        let num76: number = MOVEMENT_DECELERATION_RANGE_INVASION;
        let num77: number = INVASION_DROPOFF_RANGE;
        if (!bo.inView) {
            num76 *= 2.0;
            num77 *= 3.0;
        }
        if (num75 < num76) {
            if (num75 < num77 || lastInvasionDistance < num75) {
                if (colony.owner !== null) {
                    galaxy.invasionAttempts++;
                    notifyOfAttackHabitat(galaxy, bo, bo.empire, colony, false, true, true);
                    if (colony.owner !== bo.actualEmpire) {
                        habitatStopRebelling(galaxy, colony);
                    }
                    bo.preferredSpeed = 0;
                    bo.targetSpeed = Math.trunc(bo.preferredSpeed);
                    if ((bo.troops !== null && bo.troops.count > 0) || hasCharacters(bo)) {
                        if (colony.invadingTroops !== null && colony.invadingTroops.count > 0) {
                            const array2 = colony.invadingTroops.items.slice();
                            const troopList4: Troop[] = [];
                            for (const troop3 of array2) {
                                if (troop3 != null && troop3.empire !== null && troop3.type === TroopType.PirateRaider && troop3.empire === bo.empire) {
                                    troopList4.push(troop3);
                                }
                            }
                            for (let num79 = 0; num79 < troopList4.length; num79++) {
                                colony.invadingTroops.remove(troopList4[num79]);
                            }
                        }
                        const list: unknown[] = [];
                        let num80 = 0;
                        let num81 = 0;
                        if (colony.basesAtHabitat !== null && colony.basesAtHabitat.length > 0) {
                            for (let num82 = 0; num82 < colony.basesAtHabitat.length; num82++) {
                                if (colony.basesAtHabitat[num82].firepowerRaw > 0) {
                                    num80 += colony.basesAtHabitat[num82].firepowerRaw;
                                    list.push(colony.basesAtHabitat[num82]);
                                    num81++;
                                }
                            }
                        }
                        if (habitatPlanetaryShieldPresent(colony)) {
                            num80 += 1000;
                            num81++;
                        }
                        let num83 = 0;
                        let num84 = 0;
                        const num85 = num80;
                        // 2321: _ColonyToAttack.Troops.GetByType(Artillery) — dereferenced unguarded in the C#.
                        const byType = colony.troops!.getByType(TroopType.Artillery);
                        num83 = byType.totalDefendStrength;
                        if (byType.count > 0) {
                            if (colony.empire !== null) {
                                num83 = Math.trunc(Math.fround(Math.fround(num83) * Math.fround(colony.empire.troopAttackStrengthBonusFactorArtillery)));
                                num84 = Math.trunc(Math.fround(Math.fround(num83) * Math.fround(colony.empire.troopPlanetaryDefenseInterceptBonusFactor)));
                            }
                            num80 += Math.trunc(num83 / 20);
                            list.push(...byType.items);
                            num81 += byType.count;
                        }
                        num80 = Math.min(3000, num80);
                        num81 = Math.min(10, num81);
                        let val = Math.sqrt(num80) * Math.sqrt(num81);
                        val = Math.min(90.0, val);
                        const num86 = Math.trunc(num84 / 20) + num85;
                        let val2 = Math.sqrt(num86) * Math.sqrt(num81);
                        val2 = Math.min(95.0, val2);
                        if (bo.troops !== null) {
                            for (const troop7 of bo.troops.items) {
                                troop7.colony = colony;
                                if (colony.invadingTroops === null) {
                                    colony.invadingTroops = new TroopList();
                                }
                                colony.invadingTroops.add(troop7);
                                // 2348-2351: _ColonyToAttack.ColonyInvasion.AddInvaderLanding(troop7) — the UI invasion view (null headless).
                                let num87 = val;
                                let num88 = val2;
                                if (troop7.type === TroopType.SpecialForces) {
                                    num87 /= 3.0;
                                    num88 /= 3.0;
                                }
                                void num88;
                                if (!(galaxy.rnd.nextDouble() * 100.0 < val2)) {
                                    continue;
                                }
                                let val3 = num87 * galaxy.rnd.nextDouble();
                                val3 = Math.min(Math.fround(troop7.readiness * Math.fround(0.9)), val3);
                                troop7.readiness = Math.fround(troop7.readiness - Math.fround(val3));
                                addInvasionStatsTroopsDamageToInvaders(galaxy, colony, bo.empire, Math.fround(val3));
                                // 2375-2383: ColonyInvasion.AddInvaderLandingExplosion(troop7, list[Galaxy.Rnd.Next(0, list.Count)], Galaxy.Rnd) —
                                // RND: only when the UI ColonyInvasion exists (always null headless); not drawn.
                                if (colony.colonyInvasion !== null) {
                                    throw new Error('TODO(port) M4q: Habitat.ColonyInvasion.AddInvaderLandingExplosion (UI invasion view)');
                                }
                            }
                            bo.troops.clear();
                        }
                        const chars = stellarObjectCharacters(bo);
                        if (chars !== null) {
                            for (const character2 of chars.slice() as Character[]) {
                                if (character2.role === CharacterRole.TroopGeneral) {
                                    characterCompleteLocationTransferInvading(galaxy, character2, colony);
                                    // 2395-2398: ColonyInvasion.AddInvaderLanding(character2) — UI (null headless).
                                }
                            }
                        }
                        if (colony.empire !== galaxy.independentEmpire) {
                            const evaluationImpact = Math.min(200, Math.max(70, Math.trunc(strategicValue(colony) / 1000)));
                            modifyDiplomacyFromAttackEmpire(galaxy, bo, colony.empire, evaluationImpact);
                            // 2405-2415: the C# dereferences _ColonyToAttack.Empire unguarded here.
                            const colonyEmpire = colony.empire!;
                            if (colonyEmpire.pirateEmpireBaseHabitat !== null) {
                                if (bo.empire !== null && obtainPirateRelation(colonyEmpire, bo.empire).type === PirateRelationType.Protection) {
                                    changePirateRelation(colonyEmpire, bo.empire, PirateRelationType.None, starDate);
                                }
                            } else if ((strategicValue(colony) > 50000 || (colony.empire !== null && colony.empire.capitals !== null && colony.empire.capitals.includes(colony))) && bo.empire !== null && bo.empire.pirateEmpireBaseHabitat === null && colonyEmpire.controlDiplomacyOffense === AutomationLevel.FullyAutomated && colonyEmpire.pirateEmpireBaseHabitat === null) {
                                declareWar(galaxy, colonyEmpire, bo.empire);
                            }
                        }
                    }
                }
                bo.lastInvasionDistance = 536870911.0;
                bo.currentTarget = null;
                bo.colonyToAttack = null;
                bo.firstExecutionOfCommand = true;
            }
            bo.preferredSpeed = Math.fround(Math.trunc((num75 / num77) * bo.topSpeed));
            if (bo.preferredSpeed < Math.fround(MOVEMENT_IMPULSE_SPEED)) {
                bo.preferredSpeed = MOVEMENT_IMPULSE_SPEED;
            }
            bo.targetSpeed = Math.trunc(bo.preferredSpeed);
        } else {
            bo.preferredSpeed = Math.fround(bo.topSpeed);
            bo.targetSpeed = Math.trunc(bo.preferredSpeed);
        }
    } else if (bo.isPlanetDestroyer && bo.colonyToAttack !== null && canDestroyHabitat(galaxy, bo, bo.colonyToAttack) && !bo.colonyToAttack.hasBeenDestroyed) {
        const colony = bo.colonyToAttack;
        const num89 = galaxy.calculateDistance(bo.xpos, bo.ypos, colony.xpos, colony.ypos);
        if (num89 <= bo.planetDestroyerWeaponsRange) {
            bo.preferredSpeed = 0;
            firePlanetDestroyerAtHabitat(galaxy, bo, num89, colony);
        } else {
            bo.targetHeading = Math.fround(determineAngle(bo.xpos, bo.ypos, colony.xpos, colony.ypos));
            bo.preferredSpeed = Math.fround(bo.topSpeed);
        }
        bo.targetSpeed = Math.trunc(bo.preferredSpeed);
        doMovement(galaxy, bo, timePassed, num, num2, x, y, command.targetRelativeXpos, command.targetRelativeYpos, false, false, false);
    } else {
        const threats = builtObjectThreats(bo);
        if (bo.currentTarget === null && threats.length > 0 && threats[0] !== null && !threats[0].hasBeenDestroyed && shouldAttack(galaxy, bo, threats[0], time)) {
            bo.currentTarget = threats[0];
            setOptimalAttackRanges(galaxy, bo, threats[0]);
        }
        let stellarObject3 = bo.currentTarget as StellarObject | null;
        let num90 = 0;
        if (stellarObject3 !== null) {
            const soEmpire = stellarEmpire(stellarObject3);
            if (soEmpire !== null) {
                num90 = soEmpire.empireId;
            }
            if (isBuiltObject(stellarObject3)) {
                const builtObject11 = stellarObject3;
                if (builtObject11.pirateEmpireId > 0) {
                    num90 = builtObject11.pirateEmpireId;
                }
            }
        }
        let num91 = 536870911.0;
        if (stellarObject3 !== null && !stellarObject3.hasBeenDestroyed) {
            num91 = galaxy.calculateDistance(bo.xpos, bo.ypos, stellarObject3.xpos, stellarObject3.ypos);
            if (num91 >= bo.optimalMinimumAttackRange && num91 <= bo.optimalMaximumAttackRange) {
                const parentBuiltObject = stellarParentBuiltObject(stellarObject3);
                const parentHabitat = stellarParentHabitat(stellarObject3);
                if (parentBuiltObject !== null) {
                    bo.targetHeading = parentBuiltObject.heading;
                    if (bo.topSpeed >= Math.trunc(parentBuiltObject.currentSpeed * 1.2) + 2) {
                        bo.preferredSpeed = Math.fround(Math.trunc(parentBuiltObject.currentSpeed * 1.2) + 2);
                    } else {
                        bo.preferredSpeed = Math.fround(bo.topSpeed);
                    }
                    bo.targetSpeed = Math.trunc(bo.preferredSpeed);
                } else if (parentHabitat !== null) {
                    bo.targetHeading = Math.fround(determineAngle(bo.xpos, bo.ypos, stellarObject3.xpos, stellarObject3.ypos));
                    if (parentHabitat.parent !== null) {
                        bo.preferredSpeed = Math.fround(Math.trunc((parentHabitat.orbitSpeed + parentHabitat.parent.orbitSpeed) * 1.2) + 2);
                    } else {
                        bo.preferredSpeed = Math.fround(Math.trunc(Math.trunc(parentHabitat.orbitSpeed) * 1.2) + 2);
                    }
                    bo.preferredSpeed = Math.fround(Math.min(bo.preferredSpeed, Math.fround(bo.topSpeed)));
                    bo.targetSpeed = Math.trunc(bo.preferredSpeed);
                } else {
                    bo.targetHeading = stellarTargetHeading(stellarObject3);
                    if (stellarCurrentTarget(stellarObject3) === bo && stellarFirepowerRaw(stellarObject3) < Math.trunc(bo.firepowerRaw * 0.9)) {
                        bo.preferredSpeed = MOVEMENT_IMPULSE_SPEED * 2;
                    } else {
                        bo.preferredSpeed = Math.fround(Math.trunc(stellarCurrentSpeed(stellarObject3)));
                        bo.preferredSpeed = Math.fround(Math.min(bo.preferredSpeed, Math.fround(bo.topSpeed)));
                    }
                    bo.targetSpeed = Math.trunc(bo.preferredSpeed);
                }
            } else {
                if (isCreature(stellarObject3) && num91 < bo.optimalMaximumAttackRange + 50.0 && num91 > bo.optimalMaximumAttackRange) {
                    bo.targetHeading = Math.fround(determineAngle(bo.xpos, bo.ypos, stellarObject3.xpos, stellarObject3.ypos));
                    bo.preferredSpeed = Math.fround(bo.topSpeed);
                } else if (stellarTopSpeed(stellarObject3) <= 0 && num91 < bo.optimalMaximumAttackRange + 50.0 && num91 > bo.optimalMaximumAttackRange) {
                    bo.targetHeading = Math.fround(determineAngle(bo.xpos, bo.ypos, stellarObject3.xpos, stellarObject3.ypos));
                    bo.preferredSpeed = Math.fround(Math.trunc(bo.cruiseSpeed / 2));
                    const parentHabitat = stellarParentHabitat(stellarObject3);
                    const parentBuiltObject = stellarParentBuiltObject(stellarObject3);
                    if (parentHabitat !== null) {
                        bo.preferredSpeed = Math.fround(bo.preferredSpeed + Math.trunc(parentHabitat.orbitSpeed));
                    } else if (parentBuiltObject !== null && parentBuiltObject.parentHabitat !== null) {
                        bo.preferredSpeed = Math.fround(bo.preferredSpeed + Math.trunc(parentBuiltObject.parentHabitat.orbitSpeed));
                    }
                } else if (num91 > bo.optimalMaximumAttackRange) {
                    bo.targetHeading = Math.fround(determineAngle(bo.xpos, bo.ypos, stellarObject3.xpos, stellarObject3.ypos));
                    bo.preferredSpeed = Math.fround(bo.topSpeed);
                } else if (num91 < bo.optimalMinimumAttackRange) {
                    bo.targetHeading = Math.fround(Math.PI + determineAngle(bo.xpos, bo.ypos, stellarObject3.xpos, stellarObject3.ypos));
                    bo.preferredSpeed = Math.fround(bo.topSpeed);
                }
                bo.targetSpeed = Math.trunc(bo.preferredSpeed);
            }
        } else {
            if (mission.targetShipGroup !== null) {
                const targetShipGroup9 = mission.targetShipGroup;
                bo.currentTarget = determineShipGroupTarget(galaxy, bo, targetShipGroup9, time);
                setOptimalAttackRanges(galaxy, bo, bo.currentTarget as StellarObject | null);
                command.targetShipGroup = targetShipGroup9;
                stellarObject3 = bo.currentTarget as StellarObject | null;
                bo.firstExecutionOfCommand = true;
                result = timePassed;
            }
            if (mission.targetHabitat !== null && bo.colonyToAttack !== null) {
                bo.currentTarget = null;
                stellarObject3 = null;
                result = 0.0;
                return result;
            }
            const ct2 = bo.currentTarget as StellarObject | null;
            if (ct2 === null || ct2.hasBeenDestroyed || stellarEmpire(ct2) === bo.empire || (bo.pirateEmpireId > 0 && isBuiltObject(ct2) && ct2.pirateEmpireId === bo.pirateEmpireId)) {
                if (bo.colonyToAttack === null) {
                    bo.currentTarget = null;
                    stellarObject3 = null;
                    mission.completeCommand();
                    result = timePassed;
                    bo.firstExecutionOfCommand = true;
                }
                return result;
            }
        }
        doMovement(galaxy, bo, timePassed, num, num2, x, y, command.targetRelativeXpos, command.targetRelativeYpos, false, false, false);
        if (stellarObject3 !== null) {
            if (num91 <= bo.maximumWeaponsRange) {
                let flag24 = true;
                if (isBuiltObject(stellarObject3)) {
                    const builtObject12 = stellarObject3;
                    if (builtObject12.empire === bo.empire || (bo.pirateEmpireId > 0 && builtObject12.pirateEmpireId === bo.pirateEmpireId)) {
                        removeFromList(bo.attackers, builtObject12);
                        bo.currentTarget = null;
                        removeFromList(builtObject12.attackers, bo);
                        removeFromList(builtObject12.pursuers, bo);
                        stellarObject3 = null;
                        flag24 = false;
                    } else if ((command.action === CommandAction.Capture || command.action === CommandAction.Raid) && ((bo.empire !== null && checkOurEmpireOverwhelmingBoarding(bo.empire, builtObject12)) || builtObject12.currentShields < Math.fround(Math.max(15, Math.trunc(bo.assaultShieldPenetration))))) {
                        flag24 = false;
                    }
                }
                if (flag24) {
                    let mayModifyDiplomacy = true;
                    const targetAttackers = stellarAttackers(stellarObject3!);
                    for (let num92 = 0; num92 < targetAttackers.length; num92++) {
                        const stellarObject4 = targetAttackers[num92];
                        if (stellarObject4 != null && stellarEmpire(stellarObject4) === bo.empire) {
                            mayModifyDiplomacy = false;
                            break;
                        }
                    }
                    fireWeaponsAtTarget(galaxy, bo, num91, stellarObject3!, time, mayModifyDiplomacy);
                }
            }
            if (command.action === CommandAction.Capture || command.action === CommandAction.Raid) {
                let flag25 = false;
                if (bo.assaultStrength > 0 && bo.assaultRange > 0) {
                    flag25 = true;
                }
                let flag26 = false;
                const shipGroup = shipGroupOf(bo);
                if (shipGroup !== null && shipGroupTotalAvailableBoardingAssaultStrengthCapturingTarget(galaxy, shipGroup, time, stellarObject3) > 0) {
                    flag26 = true;
                }
                if ((flag25 || flag26) && num90 !== bo.actualEmpire!.empireId && stellarObject3 !== null && isBuiltObject(stellarObject3)) {
                    const builtObject13 = stellarObject3;
                    if (builtObject13.currentShields < Math.fround(Math.max(15, Math.trunc(bo.assaultShieldPenetration)))) {
                        const num93 = calculateAvailableAssaultPodAttackStrength(galaxy, bo, time);
                        if (num93 > 0) {
                            setOptimalAttackRangesBoarding(bo);
                            if (num91 < bo.assaultRange) {
                                checkLaunchAssaultPodsAtTarget(galaxy, bo, time, builtObject13);
                            }
                        } else if (!flag26) {
                            removeFromList(bo.attackers, bo.currentTarget);
                            bo.currentTarget = null;
                            if (bo.colonyToAttack === null) {
                                command.targetHabitat = null;
                            }
                            mission.completeCommand();
                            bo.firstExecutionOfCommand = true;
                        }
                    }
                } else {
                    removeFromList(bo.attackers, bo.currentTarget);
                    bo.currentTarget = null;
                    if (bo.colonyToAttack === null) {
                        command.targetHabitat = null;
                    }
                    mission.completeCommand();
                    bo.firstExecutionOfCommand = true;
                }
            }
        } else if (Math.trunc(bo.currentEnergy) > Math.trunc(bo.reactorStorageCapacity / 4) && bo.threats !== null) {
            const threatLevels = builtObjectThreatLevels(bo);
            for (let num94 = 0; num94 < threats.length && threatLevels[num94] > 0 && threats[num94] !== null; num94++) {
                const t = threats[num94]!;
                const num95 = galaxy.calculateDistance(bo.xpos, bo.ypos, t.xpos, t.ypos);
                if (num95 <= bo.maximumWeaponsRange && shouldAttack(galaxy, bo, t, time)) {
                    let mayModifyDiplomacy2 = false;
                    if (!stellarAttackers(t).includes(bo)) {
                        mayModifyDiplomacy2 = true;
                    }
                    fireWeaponsAtTarget(galaxy, bo, num95, t, time, mayModifyDiplomacy2);
                    break;
                }
            }
        }
    }
    const ct3 = bo.currentTarget as StellarObject | null;
    if (ct3 !== null && ct3.hasBeenDestroyed) {
        removeFromList(bo.attackers, ct3);
        bo.currentTarget = null;
        if (bo.colonyToAttack === null) {
            command.targetHabitat = null;
        }
        bo.firstExecutionOfCommand = true;
    }
    if (bo.currentFuel <= 0.0 && bo.currentEnergy <= 0.0 && bo.colonyToAttack === null) {
        bo.currentTarget = null;
        mission.completeCommand();
        bo.firstExecutionOfCommand = true;
    }
    return result;
};
