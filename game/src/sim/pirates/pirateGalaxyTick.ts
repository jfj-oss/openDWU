// M4s — galaxy-level pirate steps: s2 (terminate / merge / eliminate factions, new pirate ships, super pirates; stubs)
// and s1 ReviewPirateEmpireActivities (marketplace expiry of accepted missions).
//
// Stubs created by M4a (tasks/M4-plan.md §3.1): the tick skeletons in src/sim/tick/ call these entry points in C#
// order. Each is a no-op that does NOT draw Galaxy.Rnd (a `RND:` note marks C# draw sites that are skipped until the
// owning package ports the body) and records a TODO hit (tick/todo.ts). The owning package replaces the bodies in
// place, keeping the signatures (or adjusting the skeleton call in the same change).

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { EmpireMessageType, sendMessageToEmpire } from '../messages';
import { obtainPirateRelation } from '../pirateRelations';
import { galaxyStarDate } from '../tick/simTime';
import { gameText } from '../colonyTick';
import { EmpireActivityType, type EmpireActivity } from './empireActivity';
import type { BuiltObject } from '../builtObject';
import { determineBuiltObjectIsState } from '../builtObject';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { BuiltObjectFleeWhen, BuiltObjectRole } from '../data/designSpecifications';
import { BuiltObjectStance } from '../design';
import { PirateRelationType } from '../pirateRelations';
import { findNearestPirateFaction, pirateReviewColoniesToControl } from '../pirates';
import { identifyPirateBase } from '../characters';
import { countBySubRole, totalMobileMilitaryFirepower } from '../forceStructure';
import { calculateAnnualCashflow } from '../treasury';
import { calculateAccurateAnnualCashflow } from '../construction/empireConstruction';
import { getPrivateAnnualCashflow } from '../civilianAI';
import { takeOwnershipOfBuiltObject } from '../combat/invasion';
import { builtObjectCompleteTeardown } from '../combat/teardown';
import { empireCompleteTeardown, EventMessageType, sendEventMessageToEmpire } from '../events';
import { clearPreviousMissionRequirements } from '../missions/assign';
import { mergeGalaxyMap } from '../exploration';
import { PlanetaryFacilityType } from '../researchSystem';
import { checkRemoveFacilityTracking, type PlanetaryFacility } from '../construction/facilities';
import { countSpaceports } from './pirateShipMissions';
import { price0, resourceName, smugglingCompletedPirateText } from './missionsMarket';
import { ShipGroup, empireShipGroups, shipGroupAssignMission } from '../fleets/shipGroup';
import { addShipsToShipGroup, compareShipGroups } from '../fleets/shipGroupTasks';
import { FleetPosture } from '../diplomacyTick';
import { BuiltObjectMissionPriority, BuiltObjectMissionType } from '../missions/mission';
import { netSort } from '../netSort';
import { findNearestBaseForPirateAttack } from './pirateAI';
import { formatGameTextNow } from '../textResolver';

const f = Math.fround;
const BYTE_MAX = 255;
/** int.MaxValue. */
const INT_MAX = 2147483647;

/** Galaxy.8.cs 3053 CheckPirateEmpireTerminated(pirateFaction). No Rnd. */
export function checkPirateEmpireTerminated(galaxy: Galaxy, pirateFaction: Empire | null): boolean {
    void galaxy;
    if (pirateFaction !== null) {
        const builtObject = identifyPirateBase(pirateFaction);
        if (builtObject === null && (pirateFaction.colonies == null || pirateFaction.colonies.length <= 0) && countBySubRole(pirateFaction.builtObjects, BuiltObjectSubRole.ConstructionShip) <= 0 && countBySubRole(pirateFaction.builtObjects, BuiltObjectSubRole.ResupplyShip) <= 0) {
            return true;
        }
    }
    return false;
}

/** Galaxy.8.cs 3380 ClearFromKnownPirateBases(pirateEmpire). No Rnd. */
export function clearFromKnownPirateBases(galaxy: Galaxy, pirateEmpire: Empire): void {
    for (let i = 0; i < galaxy.empires.length; i++) {
        const empire = galaxy.empires[i];
        let builtObject: BuiltObject | null = null;
        for (let j = 0; j < empire.knownPirateBases.length; j++) {
            const builtObject2 = empire.knownPirateBases[j];
            if (builtObject2.empire === pirateEmpire) {
                builtObject = builtObject2;
                break;
            }
        }
        if (builtObject !== null) {
            const idx = empire.knownPirateBases.indexOf(builtObject);
            if (idx >= 0) empire.knownPirateBases.splice(idx, 1);
        }
    }
}

/** Galaxy.8.cs 3268 CheckForTerminatedPirateEmpires. Rnd: Next(0, 2) per military ship of a terminated faction with a neighbour. */
export function checkForTerminatedPirateEmpires(galaxy: Galaxy): void {
    const empireList: Empire[] = [];
    for (let i = 0; i < galaxy.pirateEmpires.length; i++) {
        const empire = galaxy.pirateEmpires[i];
        if (!checkPirateEmpireTerminated(galaxy, empire)) continue;
        // `if (empire == PlayerEmpire) OnGameEnd(Defeat)` — UI game-over event (M9).
        const empire2 = findNearestPirateFaction(galaxy, empire.pirateEmpireBaseHabitat!.xpos, empire.pirateEmpireBaseHabitat!.ypos, empire, true);
        const builtObjectList: BuiltObject[] = [];
        builtObjectList.push(...empire.builtObjects);
        builtObjectList.push(...empire.privateBuiltObjects);
        for (let j = 0; j < builtObjectList.length; j++) {
            const builtObject = builtObjectList[j];
            switch (builtObject.subRole) {
                case BuiltObjectSubRole.SmallFreighter:
                case BuiltObjectSubRole.MediumFreighter:
                case BuiltObjectSubRole.LargeFreighter:
                    takeOwnershipOfBuiltObject(galaxy, galaxy.independentEmpire!, builtObject, galaxy.independentEmpire!, false);
                    break;
                case BuiltObjectSubRole.Escort:
                case BuiltObjectSubRole.Frigate:
                case BuiltObjectSubRole.Destroyer:
                case BuiltObjectSubRole.Cruiser:
                case BuiltObjectSubRole.CapitalShip:
                case BuiltObjectSubRole.TroopTransport:
                case BuiltObjectSubRole.Carrier:
                case BuiltObjectSubRole.ResupplyShip:
                    if (empire2 !== null) {
                        if (galaxy.rnd.next(0, 2) === 1) {
                            const description2 = gameText('Pirate Ship Joins Us', builtObject.name, builtObject.empire?.name ?? '');
                            takeOwnershipOfBuiltObject(galaxy, empire2, builtObject, empire2, false);
                            sendMessageToEmpire(empire2, empire2, EmpireMessageType.Informational, builtObject, description2);
                        } else {
                            builtObjectCompleteTeardown(galaxy, builtObject);
                        }
                    } else {
                        builtObjectCompleteTeardown(galaxy, builtObject);
                    }
                    break;
                case BuiltObjectSubRole.ConstructionShip:
                case BuiltObjectSubRole.GasMiningShip:
                case BuiltObjectSubRole.MiningShip:
                case BuiltObjectSubRole.GasMiningStation:
                case BuiltObjectSubRole.MiningStation:
                case BuiltObjectSubRole.ResortBase:
                case BuiltObjectSubRole.EnergyResearchStation:
                case BuiltObjectSubRole.WeaponsResearchStation:
                case BuiltObjectSubRole.HighTechResearchStation:
                    // IndependentEmpire.TakeOwnershipOfBuiltObject(builtObject, null).
                    takeOwnershipOfBuiltObject(galaxy, galaxy.independentEmpire!, builtObject, null, false);
                    break;
                default:
                    builtObjectCompleteTeardown(galaxy, builtObject);
                    break;
            }
        }
        clearFromKnownPirateBases(galaxy, empire);
        empireList.push(empire);
    }
    for (const item of empireList) {
        for (let k = 0; k < galaxy.empires.length; k++) {
            const empire3 = galaxy.empires[k];
            const idx = empire3.knownPirateEmpires.indexOf(item);
            if (idx >= 0) empire3.knownPirateEmpires.splice(idx, 1);
        }
        const pidx = galaxy.pirateEmpires.indexOf(item);
        if (pidx >= 0) galaxy.pirateEmpires.splice(pidx, 1);
        empireCompleteTeardown(galaxy, item, null, true, false);
    }
}

/** Galaxy.8.cs 2774 GenerateNewPirateShips — an empty method in the C#. */
export function generateNewPirateShips(galaxy: Galaxy): void {
    void galaxy;
}

/** Galaxy.9.cs 208 DoSuperPirateTasks(): DoSuperPirateTasks(empire) for every super-pirate faction, in PirateEmpires order. */
export function doSuperPirateTasks(galaxy: Galaxy): void {
    for (let i = 0; i < galaxy.pirateEmpires.length; i++) {
        const empire = galaxy.pirateEmpires[i];
        if (empire.pirateEmpireSuperPirates) {
            doSuperPirateTasksForFaction(galaxy, empire);
        }
    }
}

/**
 * Galaxy.9.cs 284 DoSuperPirateTasks(superPirateFaction): gather every idle, undamaged, non-escort warship into the single
 * "Phantom Fleet" (ShipGroups[0]), keep it on Attack posture with unlimited range, and send it against the nearest foreign
 * base (FindNearestBaseForPirateAttack from the faction's base) whenever it has no mission.
 * Rnd: only in callees — AddShipsToShipGroup (per ship AssignFleetWaypointMission) and ShipGroup.AssignMission (per-ship
 * SelectRelativePoint + ResolveCommandsForMission).
 */
export function doSuperPirateTasksForFaction(galaxy: Galaxy, superPirateFaction: Empire): void {
    // 286-289: ShipGroups is never null in TS (Empire field initialiser); the null check has nothing to do.
    const shipGroups = empireShipGroups(superPirateFaction);
    // 290-298
    const builtObjectList: BuiltObject[] = [];
    for (let i = 0; i < superPirateFaction.builtObjects.length; i++) {
        const builtObject = superPirateFaction.builtObjects[i];
        if (builtObject.role === BuiltObjectRole.Military && builtObject.builtAt === null && builtObject.shipGroup === null && builtObject.topSpeed > 0 && builtObject.damagedComponentCount === 0 && builtObject.subRole !== BuiltObjectSubRole.Escort) {
            builtObjectList.push(builtObject);
        }
    }
    // 299
    const builtObject2 = identifyPirateBase(superPirateFaction);
    // 300-314: the first time, form the Phantom Fleet at the pirate base.
    if (shipGroups.length === 0 && builtObjectList.length > 0) {
        const shipGroup = new ShipGroup(galaxy);
        shipGroup.empire = superPirateFaction;
        shipGroup.shipTargetAmount = INT_MAX;
        shipGroup.troopTargetStrength = 0;
        shipGroup.gatherPoint = builtObject2;
        addShipsToShipGroup(galaxy, superPirateFaction, shipGroup, builtObjectList, INT_MAX, true, builtObject2);
        if (shipGroup.ships.length > 0) {
            shipGroup.name = formatGameTextNow('Phantom Fleet'); // Galaxy.9.cs 310
            shipGroups.push(shipGroup);
            netSort(shipGroups, compareShipGroups);
        }
    }
    // 315-323
    if (shipGroups.length <= 0) {
        return;
    }
    const shipGroup2 = shipGroups[0];
    if (shipGroup2 == null) {
        return;
    }
    // 324-329
    shipGroup2.posture = FleetPosture.Attack;
    shipGroup2.postureRangeSquared = Number.MAX_VALUE;
    if (builtObjectList.length > 0) {
        addShipsToShipGroup(galaxy, superPirateFaction, shipGroup2, builtObjectList, INT_MAX, true, builtObject2);
    }
    // 330-337
    if ((shipGroup2.mission === null || shipGroup2.mission.type === BuiltObjectMissionType.Undefined) && builtObject2 !== null) {
        const builtObject3 = findNearestBaseForPirateAttack(galaxy, builtObject2.xpos, builtObject2.ypos, superPirateFaction);
        if (builtObject3 !== null) {
            shipGroupAssignMission(galaxy, shipGroup2, BuiltObjectMissionType.Attack, builtObject3, null, BuiltObjectMissionPriority.High, false);
        }
    }
}

/** Galaxy.8.cs 2950 FindNearestPirateFactionKnownToFaction(x, y, pirateFaction, pirateFactionsToCheck, out nearestDistanceSquared). No Rnd. */
function findNearestPirateFactionKnownToFaction(galaxy: Galaxy, x: number, y: number, pirateFaction: Empire, pirateFactionsToCheck: Empire[] | null): { empire: Empire | null; nearestDistanceSquared: number } {
    let empire: Empire | null = null;
    let nearestDistanceSquared = Number.MAX_VALUE;
    if (pirateFactionsToCheck !== null) {
        for (let i = 0; i < pirateFactionsToCheck.length; i++) {
            const empire2 = pirateFactionsToCheck[i];
            if (empire2 == null || empire2.pirateEmpireBaseHabitat === null) continue;
            const pirateRelation = obtainPirateRelation(pirateFaction, empire2);
            if (pirateRelation.type !== PirateRelationType.NotMet) {
                const num = galaxy.calculateDistanceSquared(x, y, empire2.pirateEmpireBaseHabitat.xpos, empire2.pirateEmpireBaseHabitat.ypos);
                if (empire === null || num < nearestDistanceSquared) {
                    empire = empire2;
                    nearestDistanceSquared = num;
                }
            }
        }
    }
    return { empire, nearestDistanceSquared };
}

/** Galaxy.8.cs 2976 CheckPirateFactionCanAcceptMerge(pirateFaction). No Rnd. */
function checkPirateFactionCanAcceptMerge(galaxy: Galaxy, pirateFaction: Empire | null): boolean {
    if (pirateFaction !== null && pirateFaction.builtObjects != null) {
        const num = totalMobileMilitaryFirepower(pirateFaction.builtObjects);
        const num2 = countSpaceports(pirateFaction.builtObjects);
        const num3 = calculateAnnualCashflow(galaxy, pirateFaction);
        if (num > 200 && num2 >= 1 && pirateFaction.stateMoney > 0.0 && num3 > 0.0) return true;
    }
    return false;
}

/** Galaxy.8.cs 2991 CheckPirateFactionShouldBeMerged(pirateFaction). No Rnd. */
function checkPirateFactionShouldBeMerged(galaxy: Galaxy, pirateFaction: Empire | null): boolean {
    if (pirateFaction !== null && pirateFaction.builtObjects != null) {
        const num = totalMobileMilitaryFirepower(pirateFaction.builtObjects);
        const num2 = countSpaceports(pirateFaction.builtObjects);
        const num3 = calculateAnnualCashflow(galaxy, pirateFaction);
        if (num < 200 && num2 <= 0 && pirateFaction.stateMoney < 0.0 && num3 < 0.0) return true;
    }
    return false;
}

/** Galaxy.8.cs 2907 CheckMergePirateFactions. No Rnd of its own (EliminatePirateFaction's callees). */
export function checkMergePirateFactions(galaxy: Galaxy): void {
    const empireList: Empire[] = [];
    const empireList2: Empire[] = [];
    for (let i = 0; i < galaxy.pirateEmpires.length; i++) {
        const empire = galaxy.pirateEmpires[i];
        if (empire != null && empire.active) {
            if (checkPirateFactionShouldBeMerged(galaxy, empire)) empireList.push(empire);
            else if (checkPirateFactionCanAcceptMerge(galaxy, empire)) empireList2.push(empire);
        }
    }
    if (empireList.length <= 0 || empireList2.length <= 0) return;
    for (let j = 0; j < empireList.length; j++) {
        const empire2 = empireList[j];
        if (empire2 != null && empire2 !== galaxy.playerEmpire && empire2.pirateEmpireBaseHabitat !== null) {
            const r = findNearestPirateFactionKnownToFaction(galaxy, empire2.pirateEmpireBaseHabitat.xpos, empire2.pirateEmpireBaseHabitat.ypos, empire2, empireList2);
            const empire3 = r.empire;
            if (empire3 !== null && r.nearestDistanceSquared < 64000000000000.0) {
                const habitat = galaxy.determineHabitatSystemStar(empire2.pirateEmpireBaseHabitat);
                const message = gameText('Weak Pirate Faction Joins', empire2.name, habitat.name);
                eliminatePirateFaction(galaxy, empire2, empire3);
                const text = gameText('Pirate Faction Joins Your Empire');
                sendEventMessageToEmpire(empire3, EventMessageType.PirateFactionJoinsYou, text, message, empire2, habitat);
            }
        }
    }
}

/** Galaxy.8.cs 3398 ReviewPirateEmpireActivities (Galaxy long block): expire accepted Attack / Smuggle missions. No Rnd. */
export function reviewPirateEmpireActivities(galaxy: Galaxy): void {
    const currentStarDate = galaxyStarDate(galaxy);
    const empireActivityList: EmpireActivity[] = [];
    for (let i = 0; i < galaxy.pirateEmpires.length; i++) {
        const empire = galaxy.pirateEmpires[i];
        if (empire == null || empire.pirateEmpireSuperPirates) continue;
        const empireList: Empire[] = [];
        const empireActivityList2: EmpireActivity[] = [];
        for (let j = 0; j < empire.pirateMissions.count; j++) {
            const empireActivity = empire.pirateMissions.at(j);
            if (empireActivity === null || empireActivity.expiryDate > currentStarDate) continue;
            if (empireActivity.requestingEmpire !== null && !empireList.includes(empireActivity.requestingEmpire)) empireList.push(empireActivity.requestingEmpire);
            switch (empireActivity.type) {
                case EmpireActivityType.Attack:
                    if (empireActivity.target !== null && !empireActivity.target.hasBeenDestroyed && empireActivity.target.empire !== empireActivity.assignedEmpire) {
                        const pirateRelation = obtainPirateRelation(empireActivity.requestingEmpire!, empire);
                        pirateRelation.evaluationPirateMissionsFail = f(pirateRelation.evaluationPirateMissionsFail - 15);
                        if (empireActivity.assignedEmpire !== null) {
                            let description2 = gameText('Pirate Attack Mission Failed Pirate', empireActivity.requestingEmpire!.name, empireActivity.target.name, price0(empireActivity.price));
                            sendMessageToEmpire(empireActivity.assignedEmpire, empireActivity.assignedEmpire, EmpireMessageType.PirateAttackMissionFailed, empireActivity.target, description2);
                            description2 = gameText('Pirate Attack Mission Failed Other', empireActivity.assignedEmpire.name, empireActivity.target.name, price0(empireActivity.price));
                            sendMessageToEmpire(empireActivity.requestingEmpire, empireActivity.requestingEmpire, EmpireMessageType.PirateAttackMissionFailed, empireActivity.target, description2);
                        }
                    }
                    break;
                case EmpireActivityType.Smuggle:
                    if (empireActivity.target !== null) {
                        sendMessageToEmpire(empire, empire, EmpireMessageType.PirateSmugglingMissionCompleted, empireActivity.target, smugglingCompletedPirateText(galaxy, empireActivity));
                    }
                    if (!empireActivityList.includes(empireActivity)) empireActivityList.push(empireActivity);
                    break;
            }
            if (empireActivity.type === EmpireActivityType.Attack || empireActivity.type === EmpireActivityType.Smuggle) empireActivityList2.push(empireActivity);
        }
        for (let k = 0; k < empireActivityList2.length; k++) {
            const empireActivity2 = empireActivityList2[k];
            if (empireActivity2.type === EmpireActivityType.Smuggle && empireActivity2.relatedOrder !== null) empireActivity2.relatedOrder.expiryDate = galaxyStarDate(galaxy);
            empire.pirateMissions.remove(empireActivity2);
            if (empireActivity2.requestingEmpire !== null && empireActivity2.requestingEmpire.pirateMissions != null) empireActivity2.requestingEmpire.pirateMissions.removeEquivalent(empireActivity2);
            galaxy.pirateMissions.removeEquivalent(empireActivity2);
        }
    }
    for (let l = 0; l < empireActivityList.length; l++) {
        const empireActivity3 = empireActivityList[l];
        if (empireActivity3.target !== null && empireActivity3.requestingEmpire !== null && empireActivity3.requestingEmpire !== galaxy.independentEmpire) {
            const empty2 =
                empireActivity3.resourceId !== BYTE_MAX
                    ? gameText('Pirate Smuggle Mission Completed Other', empireActivity3.target.name, resourceName(galaxy, empireActivity3.resourceId))
                    : gameText('Pirate Smuggle Mission Completed Other All Resources', empireActivity3.target.name);
            sendMessageToEmpire(empireActivity3.requestingEmpire, empireActivity3.requestingEmpire, EmpireMessageType.PirateSmugglingMissionCompleted, empireActivity3.target, empty2);
        }
    }
}

// ---- Galaxy.8.cs 3021 / 3026 EliminatePirateFaction (also called from combat/damage.ts, M4o) ----

/** Galaxy.8.cs 3021 EliminatePirateFaction(pirateFaction): the nearest other faction conquers it. */
export function eliminatePirateFactionNearest(galaxy: Galaxy, pirateFaction: Empire): void {
    const conqueror = findNearestPirateFaction(galaxy, pirateFaction.pirateEmpireBaseHabitat!.xpos, pirateFaction.pirateEmpireBaseHabitat!.ypos, pirateFaction, true);
    eliminatePirateFaction(galaxy, pirateFaction, conqueror);
}

/** Galaxy.8.cs 3026 EliminatePirateFaction(pirateFaction, conqueror). No Rnd of its own (TakeOwnershipOfBuiltObject / teardown callees). */
export function eliminatePirateFaction(galaxy: Galaxy, pirateFaction: Empire, conqueror: Empire | null): void {
    // `if (pirateFaction == PlayerEmpire) OnGameEnd(Defeat)` — UI game-over event (M9).
    let num = 0.0;
    let num2 = 0.0;
    if (conqueror !== null) {
        num = calculateAccurateAnnualCashflow(galaxy, conqueror);
        num2 = getPrivateAnnualCashflow(galaxy, conqueror);
    }
    let flag = true;
    if (conqueror !== null && conqueror.pirateEmpireBaseHabitat === null) flag = false;
    let num3 = 0.0;
    let num4 = 0.0;
    const builtObjectList: BuiltObject[] = [];
    builtObjectList.push(...pirateFaction.builtObjects);
    builtObjectList.push(...pirateFaction.privateBuiltObjects);
    for (const item of builtObjectList) {
        let flag2 = true;
        if (determineBuiltObjectIsState(item.subRole) || flag) {
            if (num3 + item.annualSupportCost > num) flag2 = false;
            else num3 += item.annualSupportCost;
        } else if (num4 + item.annualSupportCost > num2) {
            flag2 = false;
        } else {
            num4 += item.annualSupportCost;
        }
        if (!flag2) {
            builtObjectCompleteTeardown(galaxy, item);
        } else if (conqueror !== null) {
            if (!flag) {
                if (item.role === BuiltObjectRole.Military) {
                    item.stance = BuiltObjectStance.AttackEnemies;
                    item.fleeWhen = BuiltObjectFleeWhen.Shields20;
                    item.design!.stance = BuiltObjectStance.AttackEnemies;
                    item.design!.fleeWhen = BuiltObjectFleeWhen.Shields20;
                } else {
                    item.stance = BuiltObjectStance.AttackIfAttacked;
                    item.fleeWhen = BuiltObjectFleeWhen.Shields20;
                    item.design!.stance = BuiltObjectStance.AttackIfAttacked;
                    item.design!.fleeWhen = BuiltObjectFleeWhen.Shields20;
                }
            }
            switch (item.subRole) {
                case BuiltObjectSubRole.SmallFreighter:
                case BuiltObjectSubRole.MediumFreighter:
                case BuiltObjectSubRole.LargeFreighter:
                    clearPreviousMissionRequirements(galaxy, item);
                    takeOwnershipOfBuiltObject(galaxy, galaxy.independentEmpire!, item, galaxy.independentEmpire!, false);
                    break;
                case BuiltObjectSubRole.Escort:
                case BuiltObjectSubRole.Frigate:
                case BuiltObjectSubRole.Destroyer:
                case BuiltObjectSubRole.Cruiser:
                case BuiltObjectSubRole.CapitalShip:
                case BuiltObjectSubRole.TroopTransport:
                case BuiltObjectSubRole.Carrier:
                case BuiltObjectSubRole.ResupplyShip: {
                    clearPreviousMissionRequirements(galaxy, item);
                    const description3 = gameText('Pirate Ship Joins Us', item.name, item.empire?.name ?? '');
                    takeOwnershipOfBuiltObject(galaxy, conqueror, item, conqueror, true);
                    sendMessageToEmpire(conqueror, conqueror, EmpireMessageType.Informational, item, description3);
                    break;
                }
                case BuiltObjectSubRole.ConstructionShip:
                case BuiltObjectSubRole.GasMiningShip:
                case BuiltObjectSubRole.MiningShip:
                case BuiltObjectSubRole.GasMiningStation:
                case BuiltObjectSubRole.MiningStation:
                case BuiltObjectSubRole.ResortBase:
                case BuiltObjectSubRole.EnergyResearchStation:
                case BuiltObjectSubRole.WeaponsResearchStation:
                case BuiltObjectSubRole.HighTechResearchStation:
                    // IndependentEmpire.TakeOwnershipOfBuiltObject(item, null).
                    takeOwnershipOfBuiltObject(galaxy, galaxy.independentEmpire!, item, null, false);
                    break;
                case BuiltObjectSubRole.SmallSpacePort:
                case BuiltObjectSubRole.MediumSpacePort:
                case BuiltObjectSubRole.LargeSpacePort:
                case BuiltObjectSubRole.DefensiveBase: {
                    if (item.parentHabitat !== null && conqueror.resourceMap != null) conqueror.resourceMap.setResourcesKnown(item.parentHabitat, true);
                    const description2 = gameText('Pirate Ship Joins Us', item.name, item.empire?.name ?? '');
                    takeOwnershipOfBuiltObject(galaxy, conqueror, item, conqueror, true);
                    sendMessageToEmpire(conqueror, conqueror, EmpireMessageType.Informational, item, description2);
                    break;
                }
                default:
                    builtObjectCompleteTeardown(galaxy, item);
                    break;
            }
        } else {
            builtObjectCompleteTeardown(galaxy, item);
        }
    }
    clearPirateColonyFacilities(galaxy, pirateFaction, conqueror);
    if (conqueror !== null && conqueror.pirateEmpireBaseHabitat !== null) mergeGalaxyMap(galaxy, pirateFaction, conqueror);
    clearFromKnownPirateBases(galaxy, pirateFaction);
    for (let i = 0; i < galaxy.empires.length; i++) {
        const empire = galaxy.empires[i];
        const idx = empire.knownPirateEmpires.indexOf(pirateFaction);
        if (idx >= 0) empire.knownPirateEmpires.splice(idx, 1);
    }
    const pidx = galaxy.pirateEmpires.indexOf(pirateFaction);
    if (pidx >= 0) galaxy.pirateEmpires.splice(pidx, 1);
    if (conqueror !== null) sendMessageToEmpire(conqueror, pirateFaction, EmpireMessageType.EmpireDefeated, pirateFaction, gameText('You have been defeated!'));
    else sendMessageToEmpire(pirateFaction, pirateFaction, EmpireMessageType.EmpireDefeated, pirateFaction, gameText('You have been defeated!'));
    empireCompleteTeardown(galaxy, pirateFaction, conqueror, true, false);
}

/** Galaxy.8.cs 3183 ClearPirateColonyFacilities(pirateFaction, conqueror). No Rnd. */
export function clearPirateColonyFacilities(galaxy: Galaxy, pirateFaction: Empire, conqueror: Empire | null): void {
    // `pirateFaction.PirateReviewColoniesToControl()` — the result is discarded; it rebuilds pirateFaction.Colonies.
    pirateReviewColoniesToControl(galaxy, pirateFaction, galaxy.independentColonies);
    if (conqueror === null || conqueror.pirateEmpireBaseHabitat === null) {
        for (let i = 0; i < pirateFaction.colonies.length; i++) {
            const habitat = pirateFaction.colonies[i];
            if (habitat == null || habitat.hasBeenDestroyed) continue;
            const byFaction = habitat.pirateColonyControl.getByFaction(pirateFaction);
            if (byFaction === null) continue;
            if (byFaction.hasFacilityControl) {
                const planetaryFacilityList: PlanetaryFacility[] = [];
                const facilities = habitat.facilities!;
                for (let j = 0; j < facilities.length; j++) {
                    const planetaryFacility = facilities[j];
                    if (planetaryFacility != null) {
                        switch (planetaryFacility.type) {
                            case PlanetaryFacilityType.PirateBase:
                            case PlanetaryFacilityType.PirateFortress:
                            case PlanetaryFacilityType.PirateCriminalNetwork:
                                planetaryFacilityList.push(planetaryFacility);
                                break;
                        }
                    }
                }
                for (let k = 0; k < planetaryFacilityList.length; k++) {
                    const idx = facilities.indexOf(planetaryFacilityList[k]);
                    if (idx >= 0) facilities.splice(idx, 1);
                    checkRemoveFacilityTracking(habitat, planetaryFacilityList[k]);
                }
                byFaction.hasFacilityControl = false;
            }
            habitat.pirateColonyControl.remove(byFaction);
        }
        pirateFaction.colonies.length = 0;
        return;
    }
    for (let l = 0; l < pirateFaction.colonies.length; l++) {
        const habitat2 = pirateFaction.colonies[l];
        if (habitat2 == null || habitat2.hasBeenDestroyed) continue;
        const byFaction2 = habitat2.pirateColonyControl.getByFaction(pirateFaction);
        const byFaction3 = habitat2.pirateColonyControl.getByFaction(conqueror);
        if (byFaction2 === null) continue;
        if (byFaction3 === null) {
            byFaction2.empireId = conqueror.empireId & 0xff;
        } else {
            byFaction3.controlLevel = Math.max(byFaction3.controlLevel, byFaction2.controlLevel);
            if (byFaction2.hasFacilityControl) {
                byFaction2.hasFacilityControl = false;
                byFaction3.hasFacilityControl = true;
            }
            habitat2.pirateColonyControl.remove(byFaction2);
        }
        if (!conqueror.colonies.includes(habitat2)) conqueror.colonies.push(habitat2);
    }
    pirateFaction.colonies.length = 0;
}
