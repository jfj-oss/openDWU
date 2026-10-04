// The left sidebar's "Enemy Targets" panel (ItemListCollectionPanel, typeof(PrioritizedTarget)): the list it shows
// (Main.Part11.cs 5081 method_205, bound by BaconMain.cs 2298 PopulateListsOnLefthandSide), the fleet already sent at a
// target (ItemListCollectionPanel.cs 822 ResolveAssignedFleet) and the click orders (Main.Part12.cs 2469 method_78).
//
// method_205 draws galaxy.rnd (IdentifyEmpireStrikePoints: Next(0, 3) per enemy when the player race's aggression is
// over 115), exactly as the C# UI does every time the panel is rebound. A UI read must not write the game outside the
// journaled command queue (sim/readOnlyQuery.ts, docs/sim-worker.md §4.4), so when the list would draw
// (enemyTargetListDrawsRandom) the panel asks for it with the journaled 'enemyTargetList' command and shows its reply;
// otherwise it reads it directly (no write). The click orders are player commands ('enemyTargetAttack' /
// 'enemyTargetCancel').
// Headless: no DOM / Pixi.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { BuiltObject } from '../builtObject';
import { BuiltObjectRole } from '../data/designSpecifications';
import { BuiltObjectMissionPriority, BuiltObjectMissionType } from '../missions/mission';
import { empireShipGroups, forceCompleteMission, shipGroupAssignMission, type ShipGroup } from '../fleets/shipGroup';
import { PrioritizedTarget, prioritizedTargetListAdd, sortPrioritizedTargets, type PrioritizedTargetObject } from '../civilianAI';
import { calculateDistanceFactor, identifyEmpireStrikePoints, identifyNearestAvailableFleet } from '../fleets/militaryAI';
import { aggressionLevel, determineEmpiresAtWarWith } from '../diplomacyTick';
import { PirateRelationType } from '../pirateRelations';
import { isObjectVisibleToThisEmpire } from '../independentTraders';

/**
 * Port of Main.Part11.cs 5081 method_205: the strike points of every empire the player is at war with
 * (Empire.IdentifyEmpireStrikePoints, AddRange: no de-duplication across empires), then the known or visible bases of
 * every pirate faction the player has no agreement with (PirateRelationType.None), priority 1 + 500000 / distance
 * factor from the pirate base habitat (a pirate player) or the capital; sorted by weighted priority, highest first.
 * Rnd: IdentifyEmpireStrikePoints per enemy (see the file header).
 */
export function enemyTargetList(galaxy: Galaxy, player: Empire | null): PrioritizedTarget[] {
    const prioritizedTargetList: PrioritizedTarget[] = [];
    if (player === null) return prioritizedTargetList;
    const empireList = determineEmpiresAtWarWith(player);
    for (let i = 0; i < empireList.length; i++) {
        prioritizedTargetList.push(...identifyEmpireStrikePoints(galaxy, player, empireList[i]));
    }
    for (let j = 0; j < player.pirateRelations.count; j++) {
        const pirateRelation = player.pirateRelations.get(j);
        if (pirateRelation == null || pirateRelation.type !== PirateRelationType.None || pirateRelation.otherEmpire === null || pirateRelation.otherEmpire === galaxy.independentEmpire) continue;
        const builtObjectList: BuiltObject[] = [];
        builtObjectList.push(...pirateRelation.otherEmpire.builtObjects);
        builtObjectList.push(...pirateRelation.otherEmpire.privateBuiltObjects);
        for (let k = 0; k < builtObjectList.length; k++) {
            const builtObject = builtObjectList[k];
            if (builtObject != null && !builtObject.hasBeenDestroyed && builtObject.role === BuiltObjectRole.Base && (player.knownPirateBases.includes(builtObject) || isObjectVisibleToThisEmpire(galaxy, player, builtObject))) {
                let distance = 0.0;
                if (player.pirateEmpireBaseHabitat !== null) {
                    distance = galaxy.calculateDistance(player.pirateEmpireBaseHabitat.xpos, player.pirateEmpireBaseHabitat.ypos, builtObject.xpos, builtObject.ypos);
                } else if (player.capital !== null) {
                    distance = galaxy.calculateDistance(player.capital.xpos, player.capital.ypos, builtObject.xpos, builtObject.ypos);
                }
                const priority = 1 + Math.trunc(500000.0 / calculateDistanceFactor(distance));
                prioritizedTargetListAdd(prioritizedTargetList, new PrioritizedTarget(builtObject, priority));
            }
        }
    }
    sortPrioritizedTargets(prioritizedTargetList);
    prioritizedTargetList.reverse();
    return prioritizedTargetList;
}

/** Whether building method_205's list draws galaxy.rnd (IdentifyEmpireStrikePoints' AggressionLevel > 115 test, run
 *  once per empire at war with the player). */
export function enemyTargetListDrawsRandom(player: Empire | null): boolean {
    return player !== null && player.dominantRace !== null && determineEmpiresAtWarWith(player).length > 0 && aggressionLevel(player) > 115;
}

/** method_205's targets as the objects they name (what the sim query returns; the panel rebuilds its rows from them). */
export function enemyTargetObjects(galaxy: Galaxy, player: Empire | null): PrioritizedTargetObject[] {
    const out: PrioritizedTargetObject[] = [];
    for (const t of enemyTargetList(galaxy, player)) {
        const o = t.target;
        if (o !== null) out.push(o);
    }
    return out;
}

function isAttackMission(type: BuiltObjectMissionType): boolean {
    return type === BuiltObjectMissionType.Attack || type === BuiltObjectMissionType.Bombard || type === BuiltObjectMissionType.WaitAndAttack || type === BuiltObjectMissionType.WaitAndBombard;
}

/**
 * Port of ItemListCollectionPanel.cs 822 ResolveAssignedFleet: the player's first fleet whose mission is an attack /
 * bombard (or wait-and-) on `target` (missionQueueIndex 0), else the first whose queued missions hold one
 * (missionQueueIndex = its position + 1). Null when no fleet is assigned. No Rnd.
 */
export function resolveAssignedFleet(player: Empire, target: PrioritizedTargetObject | null): { fleet: ShipGroup; missionQueueIndex: number } | null {
    const shipGroups = empireShipGroups(player);
    for (let i = 0; i < shipGroups.length; i++) {
        const sg = shipGroups[i];
        if (sg == null) continue;
        if (sg.mission === null || !isAttackMission(sg.mission.type) || sg.mission.target !== target) {
            if (sg.subsequentMissions == null || sg.subsequentMissions.length <= 0) continue;
            for (let j = 0; j < sg.subsequentMissions.length; j++) {
                const m = sg.subsequentMissions[j];
                if (m != null && isAttackMission(m.type) && m.target === target) return { fleet: sg, missionQueueIndex: j + 1 };
            }
            continue;
        }
        return { fleet: sg, missionQueueIndex: 0 };
    }
    return null;
}

/** PrioritizedTarget.ResolveTargetCoordinates for a target object. */
function targetCoordinates(target: PrioritizedTargetObject): { x: number; y: number } {
    if ('leadShip' in target) return target.leadShip !== null ? { x: target.leadShip.xpos, y: target.leadShip.ypos } : { x: 0.0, y: 0.0 };
    return { x: target.xpos, y: target.ypos };
}

/**
 * Main.Part12.cs 2469 method_78, a left click on an Enemy Targets row with no fleet assigned to it yet (the UI selects
 * the assigned fleet itself otherwise): with one of the player's fleets selected, send it to attack the target (unless
 * it is already attacking / bombarding it); else send the nearest available fleet (first within fuel range, then any)
 * — AssignMission(Attack, target, null, High, manuallyAssigned: true). Returns the fleet sent, or null.
 * Rnd: ShipGroup.AssignMission (per ship SelectRelativePoint and the ship's mission); IdentifyNearestAvailableFleet
 * draws none.
 */
export function enemyTargetAttack(galaxy: Galaxy, player: Empire, target: PrioritizedTargetObject | null, selectedFleet: ShipGroup | null): ShipGroup | null {
    if (target === null) return null;
    if (resolveAssignedFleet(player, target) !== null) return null;
    if (selectedFleet !== null && selectedFleet.empire === player) {
        const m = selectedFleet.mission;
        if (m === null || m.target !== target || !isAttackMission(m.type)) {
            shipGroupAssignMission(galaxy, selectedFleet, BuiltObjectMissionType.Attack, target, null, BuiltObjectMissionPriority.High, true);
        }
        return selectedFleet;
    }
    const { x: num, y: num2 } = targetCoordinates(target);
    let shipGroup3 = identifyNearestAvailableFleet(galaxy, player, num, num2, false, true, 0.0);
    if (shipGroup3 === null) shipGroup3 = identifyNearestAvailableFleet(galaxy, player, num, num2, false, false, 0.0);
    if (shipGroup3 !== null) shipGroupAssignMission(galaxy, shipGroup3, BuiltObjectMissionType.Attack, target, null, BuiltObjectMissionPriority.High, true);
    return shipGroup3;
}

/**
 * Main.Part12.cs 2469 method_78, a right click: when the fleet assigned to the target is on it now (missionQueueIndex
 * 0), ShipGroup.ForceCompleteMission. Returns whether a mission was cancelled.
 */
export function enemyTargetCancel(galaxy: Galaxy, player: Empire, target: PrioritizedTargetObject | null): boolean {
    if (target === null) return false;
    const a = resolveAssignedFleet(player, target);
    if (a === null || a.missionQueueIndex !== 0) return false;
    forceCompleteMission(galaxy, a.fleet);
    return true;
}
