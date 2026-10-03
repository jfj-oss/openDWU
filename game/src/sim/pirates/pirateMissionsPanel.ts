// The left sidebar's "Pirate Missions" panel (Main.Part11.cs method_163 AddPanel "Pirate Missions", EmpireActivity rows):
// the list (BaconMain.cs 2253 PopulateListsOnLefthandSide, the "Pirate Missions" branches), the per-row counts the rows
// show (ItemListPanel.cs 1577 method_7: Galaxy.9.cs CountPirateFactionsAcceptedSmugglingMission /
// CountPirateEmpiresConsideringMission, Empire.6.cs CountShipsAssignedToMission) and the row's right-hand button (Bid /
// Accept Smuggling Mission / Cancel: Main.Part12.cs 2591-2678 method_78, the BidButtonClicked branch).
//
// Building the list and the "considering" counts obtains pirate relation records (ObtainPirateRelation adds a NotMet
// record), as the C# UI does while drawing; from the UI those lookups are read-only (sim/readOnlyQuery.ts) and the
// records are added by an obtainUiRecords command. The button is a player command (player/playerOps.ts `pirateMissionButton`). No Rnd anywhere here.
//
// No DOM / Pixi imports.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { BuiltObject } from '../builtObject';
import type { Habitat } from '../types';
import { BuiltObjectRole } from '../data/designSpecifications';
import { BuiltObjectMissionType, builtObjectMission } from '../missions/mission';
import { totalMobileMilitaryFirepower } from '../forceStructure';
import { galaxyStarDate } from '../tick/simTime';
import { EmpireActivity, EmpireActivityList, EmpireActivityType, type ActivityTarget } from './empireActivity';
import {
    pirateCheckAcceptAttackMission,
    pirateCheckAcceptDefendMission,
    isObjectAreaKnownToThisEmpire,
    removePirateSmugglingMissionFromAllEmpires,
    resolveByAllowedDefendTargetsNotRequestedBy,
    resolveByKnownAttackTargetsNotRequestedBy,
    resolveByTypeKnownTarget,
    calculatePirateSmugglePricePerUnit,
    createOrderWithExpiry,
} from './missionsMarket';
import { OrderType } from '../logistics/orders';
import { REAL_SECONDS_IN_GALACTIC_YEAR } from '../galaxyTime';

/** The panel's two toggle buttons (Main.Part11.cs method_163): status All / Accepted / Open, type All / Smuggling / Attack / Defend. */
export const PIRATE_MISSIONS_STATUS_TOGGLE = ['Pirate Missions List Status All', 'Pirate Missions List Status Accepted', 'Pirate Missions List Status Open'] as const;
export const PIRATE_MISSIONS_TYPE_TOGGLE = ['Pirate Missions List Type All', 'Pirate Missions List Type Smuggling', 'Pirate Missions List Type Attack', 'Pirate Missions List Type Defend'] as const;

function addAll(out: EmpireActivity[], list: EmpireActivityList): void {
    for (const a of list.items) out.push(a!);
}

/**
 * BaconMain.cs 2253 PopulateListsOnLefthandSide, "Pirate Missions": for a pirate faction, the missions it holds (not its
 * own requests; status All / Accepted), then (status All / Open) the galaxy's open attack missions on known targets not
 * requested by it nor against it, the defend missions it may take, and the smuggling missions on known targets it has
 * not accepted yet; for a standard empire, the missions it requested (all / assigned / unassigned), by type.
 */
export function pirateMissionsPanelItems(galaxy: Galaxy, player: Empire, toggleButtonState: number, typeToggle: number): EmpireActivity[] {
    const out: EmpireActivity[] = [];
    if (player.pirateEmpireBaseHabitat !== null) {
        const toggleButtonState3 = toggleButtonState;
        const toggleButtonState4 = typeToggle;
        if (toggleButtonState3 >>> 0 <= 1) {
            const empireActivityList = player.pirateMissions.resolveWhereRequestingEmpireNot(player);
            switch (toggleButtonState4) {
                case 0:
                    addAll(out, empireActivityList);
                    break;
                case 1:
                    addAll(out, empireActivityList.resolveActivitiesByType(EmpireActivityType.Smuggle));
                    break;
                case 2:
                    addAll(out, empireActivityList.resolveActivitiesByType(EmpireActivityType.Attack));
                    break;
                case 3:
                    addAll(out, empireActivityList.resolveActivitiesByType(EmpireActivityType.Defend));
                    break;
            }
        }
        if (toggleButtonState3 === 0 || toggleButtonState3 === 2) {
            if (toggleButtonState4 === 0 || toggleButtonState4 === 2) {
                const empireActivityList2 = resolveByKnownAttackTargetsNotRequestedBy(galaxy, galaxy.pirateMissions, player);
                empireActivityList2.stripMissionsWithTargetEmpire(player);
                addAll(out, empireActivityList2);
            }
            if (toggleButtonState4 === 0 || toggleButtonState4 === 3) {
                addAll(out, resolveByAllowedDefendTargetsNotRequestedBy(galaxy, galaxy.pirateMissions, player));
            }
            if (toggleButtonState4 === 0 || toggleButtonState4 === 1) {
                const empireActivityList3 = resolveByTypeKnownTarget(galaxy, galaxy.pirateMissions, EmpireActivityType.Smuggle, player);
                for (let j = 0; j < empireActivityList3.count; j++) {
                    if (!player.pirateMissions.containsEquivalent(empireActivityList3.at(j))) out.push(empireActivityList3.at(j)!);
                }
            }
        }
    } else {
        let empireActivityList4 = new EmpireActivityList();
        switch (toggleButtonState) {
            case 0:
                empireActivityList4 = player.pirateMissions;
                break;
            case 1:
                empireActivityList4 = player.pirateMissions.resolveAssigned();
                break;
            case 2:
                empireActivityList4 = player.pirateMissions.resolveUnassigned();
                break;
        }
        switch (typeToggle) {
            case 0:
                addAll(out, empireActivityList4);
                break;
            case 1:
                addAll(out, empireActivityList4.resolveActivitiesByType(EmpireActivityType.Smuggle));
                break;
            case 2:
                addAll(out, empireActivityList4.resolveActivitiesByType(EmpireActivityType.Attack));
                break;
            case 3:
                addAll(out, empireActivityList4.resolveActivitiesByType(EmpireActivityType.Defend));
                break;
        }
    }
    return out;
}

/** Galaxy.9.cs 455 CountPirateFactionsAcceptedSmugglingMission(target). */
export function countPirateFactionsAcceptedSmugglingMission(galaxy: Galaxy, target: ActivityTarget | null): number {
    let num = 0;
    for (let i = 0; i < galaxy.pirateEmpires.length; i++) {
        const empire = galaxy.pirateEmpires[i];
        if (empire != null && empire.active && empire.pirateMissions != null && empire.pirateMissions.getFirstByTargetAndType(target, EmpireActivityType.Smuggle) !== null) num++;
    }
    return num;
}

/** Galaxy.9.cs 483 CountPirateEmpiresConsideringMission(mission, pirateEmpireToExclude) (obtains pirate relations). */
export function countPirateEmpiresConsideringMission(galaxy: Galaxy, mission: EmpireActivity | null, pirateEmpireToExclude: Empire | null): number {
    let num = 0;
    if (mission !== null) {
        for (let i = 0; i < galaxy.pirateEmpires.length; i++) {
            const empire = galaxy.pirateEmpires[i];
            if (empire == null || !empire.active || empire === pirateEmpireToExclude) continue;
            switch (mission.type) {
                case EmpireActivityType.Attack: {
                    const pirateEmpireStrength2 = totalMobileMilitaryFirepower(empire.builtObjects);
                    if (pirateCheckAcceptAttackMission(galaxy, empire, mission, pirateEmpireStrength2)) num++;
                    break;
                }
                case EmpireActivityType.Defend: {
                    const pirateEmpireStrength = totalMobileMilitaryFirepower(empire.builtObjects);
                    if (pirateCheckAcceptDefendMission(galaxy, empire, mission, pirateEmpireStrength)) num++;
                    break;
                }
                case EmpireActivityType.Smuggle:
                    if (empire.policy!.acceptPirateSmugglingMissions && isObjectAreaKnownToThisEmpire(galaxy, empire, mission.target!) && empire.freighters != null && empire.freighters.length > 0) num++;
                    break;
            }
        }
    }
    return num;
}

/** Empire.6.cs 1259 CheckShipPerformingMission(builtObject, mission). */
export function checkShipPerformingMission(galaxy: Galaxy, builtObject: BuiltObject | null, mission: EmpireActivity | null): boolean {
    if (builtObject !== null && !builtObject.hasBeenDestroyed && mission !== null) {
        const m = builtObjectMission(builtObject.mission);
        switch (mission.type) {
            case EmpireActivityType.Smuggle:
                if (
                    builtObject.role === BuiltObjectRole.Freight &&
                    m !== null &&
                    m.type === BuiltObjectMissionType.Transport &&
                    m.secondaryTargetHabitat === mission.target &&
                    (mission.resourceId === 255 || cargoIndexOfResourceId(m.cargo, mission.resourceId) >= 0)
                ) {
                    return true;
                }
                break;
            case EmpireActivityType.Attack:
                if (builtObject.role === BuiltObjectRole.Military && m !== null && (m.type === BuiltObjectMissionType.Attack || m.type === BuiltObjectMissionType.Capture) && m.target === mission.target) return true;
                break;
            case EmpireActivityType.Defend:
                if (builtObject.role !== BuiltObjectRole.Military) break;
                if (m !== null && m.type === BuiltObjectMissionType.MoveAndWait && m.target === mission.target) return true;
                if (builtObject.builtAt === null && mission.target !== null) {
                    const num = galaxy.calculateDistanceSquared(mission.target.xpos, mission.target.ypos, builtObject.xpos, builtObject.ypos);
                    if (num < 2250000.0) return true;
                }
                break;
        }
    }
    return false;
}

/** CargoList.cs 701 IndexOf(byte resourceId): the first resource cargo of that resource, any empire. */
function cargoIndexOfResourceId(cargo: { items: { commodity: { resourceId: number } | null }[] } | null | undefined, resourceId: number): number {
    if (cargo == null) return -1;
    for (let i = 0; i < cargo.items.length; i++) {
        const c = cargo.items[i].commodity;
        if (c != null && c.resourceId === resourceId) return i;
    }
    return -1;
}

/** Empire.6.cs 1233 DetermineShipsAssignedToMission(mission): state, then private ships performing it. */
export function determineShipsAssignedToMission(galaxy: Galaxy, empire: Empire, mission: EmpireActivity | null): BuiltObject[] {
    const builtObjectList: BuiltObject[] = [];
    if (mission !== null) {
        for (const b of empire.builtObjects) if (checkShipPerformingMission(galaxy, b, mission)) builtObjectList.push(b);
        for (const b of empire.privateBuiltObjects) if (checkShipPerformingMission(galaxy, b, mission)) builtObjectList.push(b);
    }
    return builtObjectList;
}

/** Empire.6.cs 1226 CountShipsAssignedToMission(mission, out firepowerAssigned). */
export function countShipsAssignedToMission(galaxy: Galaxy, empire: Empire, mission: EmpireActivity | null): { count: number; firepower: number } {
    const builtObjectList = determineShipsAssignedToMission(galaxy, empire, mission);
    return { count: builtObjectList.length, firepower: totalMobileMilitaryFirepower(builtObjectList) };
}

/** What the sidebar's query returns: the rows and, per row, CountPirateEmpiresConsideringMission (method_7's cached
 *  DisplayExtraData). */
export interface PirateMissionsPanelData {
    items: EmpireActivity[];
    considering: number[];
}

/** The panel's data: the list and its "considering" counts. */
export function pirateMissionsPanelData(galaxy: Galaxy, player: Empire, statusToggle: number, typeToggle: number): PirateMissionsPanelData {
    const items = pirateMissionsPanelItems(galaxy, player, statusToggle, typeToggle);
    const considering = items.map((a) => countPirateEmpiresConsideringMission(galaxy, a, player));
    return { items, considering };
}

/** method_7 / Main.Part12.cs 2601-2615: the row's mission is one the player requested and may cancel (an open attack /
 *  defend request still on the galaxy market, or any smuggling request). */
export function pirateMissionCancellable(galaxy: Galaxy, player: Empire, a: EmpireActivity): boolean {
    if (player !== a.requestingEmpire) return false;
    switch (a.type) {
        case EmpireActivityType.Attack:
        case EmpireActivityType.Defend:
            return galaxy.pirateMissions.containsEquivalent(a);
        case EmpireActivityType.Smuggle:
            return true;
    }
    return false;
}

/** The row's button (method_7 flag / flag2 / flag3): 'cancel', 'bid', 'alreadyBid', or 'none'. */
export function pirateMissionButtonKind(galaxy: Galaxy, player: Empire, a: EmpireActivity): 'cancel' | 'bid' | 'alreadyBid' | 'none' {
    if (pirateMissionCancellable(galaxy, player, a)) return 'cancel';
    let flag2 = true;
    let flag3 = true;
    if (player.pirateEmpireBaseHabitat === null) flag2 = false;
    else if (player === a.requestingEmpire) flag2 = false;
    else if (a.assignedEmpire === player) flag3 = false;
    // 1671-1683: a smuggling mission the faction already accepted has no button.
    if (a.type === EmpireActivityType.Smuggle && player.pirateEmpireBaseHabitat !== null && player.pirateMissions.containsEquivalent(a)) flag2 = false;
    if (!flag2) return 'none';
    return flag3 ? 'bid' : 'alreadyBid';
}

/** ItemListPanel.cs 2248-2286: whether a click at the row's right edge hits the bid button (the zone exists only while the
 *  mission is unassigned or still bidding). */
export function pirateMissionBidZoneActive(player: Empire, a: EmpireActivity): boolean {
    if (!(a.assignedEmpire === null || a.bidTimeRemaining > 0)) return false;
    if (a.requestingEmpire === player) return true;
    if (player.pirateEmpireBaseHabitat === null) return false;
    if (player === a.requestingEmpire) return false;
    if (player === a.assignedEmpire) return false;
    return true;
}

/** Find the mission a row shows (the panel's list holds the galaxy's or the faction's own records; the command names it by
 *  its equivalence fields — EmpireActivity.CheckEquivalent — so the command log can resolve it). */
export function findPirateMission(galaxy: Galaxy, player: Empire, target: ActivityTarget | null, type: EmpireActivityType, requestingEmpire: Empire | null, targetEmpire: Empire | null): EmpireActivity | null {
    const match = (a: EmpireActivity | null): a is EmpireActivity => a !== null && a.target === target && a.type === type && a.requestingEmpire === requestingEmpire && a.targetEmpire === targetEmpire;
    for (const a of player.pirateMissions.items) if (match(a)) return a;
    for (const a of galaxy.pirateMissions.items) if (match(a)) return a;
    return null;
}

/**
 * Port of Main.Part12.cs 2591-2678 (method_78, an EmpireActivity row's BidButtonClicked): cancel a mission the player
 * requested (attack / defend: off the market and the assignee's list; smuggling: from every faction, the player's list
 * and the galaxy market, expiring its order), or else bid on an attack / defend mission (the player becomes the
 * assignee: a first bid starts the 60 s auction, a later one cuts the price by 10 % and adds 10 s under 10 s left) or
 * accept a smuggling mission. Returns false when the mission is gone.
 */
export function pirateMissionButton(galaxy: Galaxy, player: Empire, target: ActivityTarget | null, type: EmpireActivityType, requestingEmpire: Empire | null, targetEmpire: Empire | null): boolean {
    const empireActivity = findPirateMission(galaxy, player, target, type, requestingEmpire, targetEmpire);
    if (empireActivity === null) return false;
    let flag = false;
    if (empireActivity.requestingEmpire === player) {
        switch (empireActivity.type) {
            case EmpireActivityType.Attack:
            case EmpireActivityType.Defend:
                if (galaxy.pirateMissions.containsEquivalent(empireActivity)) flag = true;
                break;
            case EmpireActivityType.Smuggle:
                flag = true;
                break;
        }
    }
    if (flag) {
        switch (empireActivity.type) {
            case EmpireActivityType.Attack:
            case EmpireActivityType.Defend:
                if (empireActivity.assignedEmpire !== null) empireActivity.assignedEmpire.pirateMissions.removeEquivalent(empireActivity);
                galaxy.pirateMissions.removeEquivalent(empireActivity);
                player.pirateMissions.removeEquivalent(empireActivity);
                empireActivity.assignedEmpire = null;
                break;
            case EmpireActivityType.Smuggle: {
                removePirateSmugglingMissionFromAllEmpires(galaxy, empireActivity);
                player.pirateMissions.removeEquivalent(empireActivity);
                const firstByTargetAndType = galaxy.pirateMissions.getFirstByTargetAndType(empireActivity.target, EmpireActivityType.Smuggle);
                if (firstByTargetAndType !== null) {
                    galaxy.pirateMissions.remove(firstByTargetAndType);
                    if (firstByTargetAndType.relatedOrder !== null) firstByTargetAndType.relatedOrder.expiryDate = galaxyStarDate(galaxy);
                }
                break;
            }
        }
    } else {
        switch (empireActivity.type) {
            case EmpireActivityType.Attack:
            case EmpireActivityType.Defend:
                empireActivity.assignedEmpire = player;
                if (empireActivity.bidTimeRemaining < 0) {
                    empireActivity.bidTimeRemaining = 60000;
                    break;
                }
                empireActivity.price *= 0.9;
                if (empireActivity.bidTimeRemaining < 10000) empireActivity.bidTimeRemaining += 10000;
                break;
            case EmpireActivityType.Smuggle:
                if (!player.pirateMissions.containsEquivalent(empireActivity)) player.pirateMissions.add(empireActivity);
                break;
        }
    }
    return true;
}

/**
 * Port of Main.Part8.cs 5094 btnPirateSmugglingMissionAssign_Click (the pnlPirateSmugglingMissionResourceSelection panel's
 * Assign Mission): a smuggling request to the pirates for `habitat`, for one resource (priced by
 * CalculatePirateSmugglePricePerUnit, with a 10000-unit state order expiring with the mission) or for all resources (null:
 * ResourceId 255, price 1.0, no order), lasting three years; added to the player's and the galaxy's lists unless the player
 * already has an equivalent request (then nothing happens). Returns whether a request was added.
 */
export function assignPirateSmugglingMission(galaxy: Galaxy, player: Empire, habitat: Habitat, resourceId: number | null): boolean {
    let attackPrice = 1.0;
    if (resourceId !== null) attackPrice = calculatePirateSmugglePricePerUnit(galaxy, player, habitat, resourceId);
    const expiryDate = galaxyStarDate(galaxy) + Math.trunc(3.0 * REAL_SECONDS_IN_GALACTIC_YEAR * 1000.0);
    const empireActivity = new EmpireActivity(habitat.empire, player, expiryDate, EmpireActivityType.Smuggle, habitat, attackPrice);
    if (resourceId !== null) empireActivity.resourceId = resourceId;
    if (resourceId !== null) empireActivity.relatedOrder = createOrderWithExpiry(galaxy, habitat, resourceId, 10000, true, OrderType.Standard, expiryDate);
    if (player.pirateMissions.containsEquivalent(empireActivity)) return false;
    player.pirateMissions.add(empireActivity);
    if (!galaxy.pirateMissions.containsEquivalent(empireActivity)) galaxy.pirateMissions.add(empireActivity);
    return true;
}

/** Main.Part8.cs 5132 cmbPirateSmugglingMissionResourceSelection_SelectedIndexChanged: the price per 100 units shown next
 *  to the picker (CalculatePirateSmugglePricePerUnit × 100; 1.0 × 100 for all resources). */
export function pirateSmugglingPricePer100(galaxy: Galaxy, player: Empire, habitat: Habitat, resourceId: number | null): number {
    return (resourceId !== null ? calculatePirateSmugglePricePerUnit(galaxy, player, habitat, resourceId) : 1.0) * 100.0;
}
