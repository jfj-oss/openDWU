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
import { registerTodo, todo } from '../tick/todo';
import { EmpireActivityType, type EmpireActivity } from './empireActivity';
import { price0, resourceName, smugglingCompletedPirateText } from './missionsMarket';

const f = Math.fround;
const BYTE_MAX = 255;

const T_checkForTerminatedPirateEmpires = registerTodo('M4s', 'checkForTerminatedPirateEmpires');
/** Galaxy.8.cs 3268 CheckForTerminatedPirateEmpires. */
export function checkForTerminatedPirateEmpires(galaxy: Galaxy): void {
    // RND: 1 direct, +clock×3 — not drawn until M4s.
    /* TODO(port) M4s */ todo(T_checkForTerminatedPirateEmpires);
}

const T_generateNewPirateShips = registerTodo('M4s', 'generateNewPirateShips');
/** Galaxy.8.cs 2774 GenerateNewPirateShips. */
export function generateNewPirateShips(galaxy: Galaxy): void {
    /* TODO(port) M4s */ todo(T_generateNewPirateShips);
}

const T_doSuperPirateTasks = registerTodo('M4s', 'doSuperPirateTasks');
/** Galaxy.9.cs 208 DoSuperPirateTasks. */
export function doSuperPirateTasks(galaxy: Galaxy): void {
    // RND: draws in callees (d≤3) — not drawn until M4s.
    /* TODO(port) M4s */ todo(T_doSuperPirateTasks);
}

const T_checkMergePirateFactions = registerTodo('M4s', 'checkMergePirateFactions');
/** Galaxy.8.cs 2907 CheckMergePirateFactions. */
export function checkMergePirateFactions(galaxy: Galaxy): void {
    // RND: draws in callees (d≤3) — not drawn until M4s.
    /* TODO(port) M4s */ todo(T_checkMergePirateFactions);
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

// ---- stub added by M4o (called from combat/damage.ts FearfulPirateFactionJoinsPlayer / ProvideBonusFromPirateBase) ----

const T_eliminatePirateFaction = registerTodo('M4s', 'eliminatePirateFaction');
/** Galaxy.8.cs 3026 EliminatePirateFaction(pirateFaction, conqueror) — stub: the faction keeps its assets. */
export function eliminatePirateFaction(galaxy: Galaxy, pirateFaction: Empire, conqueror: Empire | null): void {
    void galaxy; void pirateFaction; void conqueror;
    /* TODO(port) M4s */ todo(T_eliminatePirateFaction);
}
