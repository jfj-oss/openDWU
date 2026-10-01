// Player fleet / ships-screen commands (the Ships and Bases window and the Fleets window of the original). Each function
// is one button of those windows; player/playerOps.ts registers them so the UI issues them through the command queue
// (applied at the next frame boundary and journaled). Headless: no DOM / Pixi.

import { markFleetPlayerOrder, markNewOrders, markPlayerOrder, snapshotOrders } from '../missions/playerOrder';
import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { BuiltObject } from '../builtObject';
import { Habitat } from '../types';
import { BuiltObjectRole } from '../data/designSpecifications';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, type StellarObject } from '../missions/mission';
import { assignMission, clearPreviousMissionRequirements } from '../missions/assign';
import { ShipGroup, empireShipGroups, forceCompleteMission, leaveShipGroup } from '../fleets/shipGroup';
import {
    compareShipGroups,
    getNextFleetNumberDescription,
    shipGroupAddShipToFleet,
    shipGroupAssignMission,
    shipGroupCalculateRequiredFuel,
    shipGroupTotalDamage,
    shipGroupUpdate,
} from '../fleets/shipGroupTasks';
import { assignFleetRetrofit, assignRetrofitMission, determineRetrofitAffordability, findNearestShipYard } from '../construction/empireConstruction';
import { findNewestCanBuildFullEvaluate } from '../designGeneration';
import type { Design } from '../design';
import { fastFindNearestRefuellingPoint } from '../movement';
import { determineFuelRequired } from '../logistics/refuel';
import { formatText } from '../diplomacyTick';
import { netSort } from '../netSort';
import { assignFleetLoadTroops } from './executeShipAction';

function sortShipGroups(empire: Empire): void {
    netSort(empireShipGroups(empire), compareShipGroups);
}

function stellar(o: StellarObject | null): BuiltObject | Habitat | null {
    return o instanceof BuiltObject || o instanceof Habitat ? o : null;
}

/** What the Set Fleet combo can be set to: a fleet, '(New Fleet)', or '(None)'/"Set Fleet..." (leave the fleet). */
export type SetFleetTarget = ShipGroup | 'new' | null;

/**
 * Main.Part6.cs cmbBuiltObjectSetFleet_SelectedIndexChanged (Ships and Bases window): put the selected Military ships
 * into a new fleet ('new': GatherPoint null, name "Nth Fleet"), into an existing fleet, or (null) take every selected
 * ship out of its fleet. Returns the fleet the ships ended up in (null for leave).
 */
export function setShipsFleet(galaxy: Galaxy, empire: Empire, ships: readonly BuiltObject[], target: SetFleetTarget): ShipGroup | null {
    const selected = ships.filter((s) => s !== null && s.empire === empire);
    if (selected.length <= 0) return null;
    if (target === 'new') {
        const shipGroup = new ShipGroup(galaxy);
        shipGroup.empire = selected[0].empire;
        shipGroup.gatherPoint = null;
        shipGroup.name = formatText('{0} Fleet', getNextFleetNumberDescription(selected[0].empire!));
        empireShipGroups(selected[0].empire!).push(shipGroup);
        for (const b of selected) if (b.role === BuiltObjectRole.Military) shipGroupAddShipToFleet(galaxy, shipGroup, b);
        shipGroupUpdate(galaxy, shipGroup);
        sortShipGroups(selected[0].empire!);
        return shipGroup;
    }
    if (target !== null) {
        if (!empireShipGroups(empire).includes(target)) return null;
        for (const b of selected) {
            if (b.role === BuiltObjectRole.Military && b.shipGroup !== target) shipGroupAddShipToFleet(galaxy, target, b);
        }
        return target;
    }
    for (const b of selected) leaveShipGroup(galaxy, b);
    return null;
}

/** Main.Part9.cs txtShipGroupName_Leave: rename (an empty / blank name is ignored). */
export function renameFleet(fleet: ShipGroup, name: string): boolean {
    if (name.trim() === '') return false;
    fleet.name = name;
    return true;
}

/** Main.Part6.cs btnShipGroupInfoSetHomeColony_Click: the fleet's GatherPoint becomes one of the empire's colonies. */
export function setFleetHomeColony(empire: Empire, fleet: ShipGroup, colony: Habitat): boolean {
    if (fleet.empire !== empire || !empire.colonies.includes(colony)) return false;
    fleet.gatherPoint = colony;
    return true;
}

/** Troop loadout percentages (Infantry / Armored / Artillery / Special Forces) or null = "Use Troop Loadouts" off (all 255). */
export interface TroopLoadout {
    infantry: number;
    armored: number;
    artillery: number;
    specialForces: number;
}

/**
 * Main.Part9.cs uuGypgjgrb (Use Troop Loadouts checkbox) and the four numShipGroupTroopLoadout*_ValueChanged handlers:
 * null switches the loadouts off (byte 255 each); ticking the box starts at 100% Infantry; the spinners set one byte
 * each (the panel keeps the sum at most 100).
 */
export function setFleetTroopLoadout(empire: Empire, fleet: ShipGroup, loadout: TroopLoadout | null): boolean {
    if (fleet.empire !== empire) return false;
    if (loadout === null) {
        fleet.troopLoadoutInfantry = 255;
        fleet.troopLoadoutArmored = 255;
        fleet.troopLoadoutArtillery = 255;
        fleet.troopLoadoutSpecialForces = 255;
        return true;
    }
    const clamp = (v: number): number => Math.max(0, Math.min(100, Math.trunc(v)));
    const inf = clamp(loadout.infantry);
    const arm = clamp(loadout.armored);
    const art = clamp(loadout.artillery);
    const sf = clamp(loadout.specialForces);
    if (inf + arm + art + sf > 100) return false;
    fleet.troopLoadoutInfantry = inf;
    fleet.troopLoadoutArmored = arm;
    fleet.troopLoadoutArtillery = art;
    fleet.troopLoadoutSpecialForces = sf;
    return true;
}

/** Main.Part3.cs XxYlcNpSu4_Click (btnShipGroupLoadTroops): AssignFleetLoadTroops(fleet, manuallyAssigned: true). */
export function fleetLoadTroops(galaxy: Galaxy, empire: Empire, fleet: ShipGroup): boolean {
    if (fleet.empire !== empire) return false;
    const snap = snapshotOrders([], [fleet]);
    const ok = assignFleetLoadTroops(galaxy, empire, fleet, null, true);
    markNewOrders(snap); // a player order: the AI leaves the (automated) fleet alone until it is done (playerOrder.ts)
    return ok;
}

/** Main.Part3.cs btnShipGroupRetrofit_Click: Empire.AssignFleetRetrofit(fleet, isAutoRetrofit: false). */
export function fleetRetrofit(galaxy: Galaxy, empire: Empire, fleet: ShipGroup): boolean {
    if (fleet.empire !== empire) return false;
    const snap = snapshotOrders([], [fleet]);
    const ok = assignFleetRetrofit(galaxy, empire, fleet, null, false);
    markNewOrders(snap); // a player order (playerOrder.ts)
    return ok;
}

/**
 * Main.Part3.cs btnShipGroupRepairAndRefuel_Click: an undamaged fleet is sent to refuel at the nearest refuelling point;
 * a damaged one to the nearest ship yard for repair, each damaged ship (in reach) repairing and each other warp-capable
 * ship refuelling there at VeryHigh priority.
 */
export function fleetRepairAndRefuel(galaxy: Galaxy, empire: Empire, fleet: ShipGroup): boolean {
    const lead = fleet.leadShip;
    if (fleet.empire !== empire || lead === null) return false;
    const yard = stellar(findNearestShipYard(galaxy, empire, lead, true, false));
    const fuelTypes = shipGroupCalculateRequiredFuel(fleet);
    const refuelPoint = stellar(fastFindNearestRefuellingPoint(galaxy, lead.xpos, lead.ypos, fuelTypes, fleet.empire, lead, true, null, fleet.ships.length));
    if (shipGroupTotalDamage(fleet) <= 0) {
        if (refuelPoint === null) return false;
        forceCompleteMission(galaxy, fleet);
        shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.Refuel, refuelPoint, null, BuiltObjectMissionPriority.Unavailable, true);
        markFleetPlayerOrder(fleet); // a player order (playerOrder.ts)
        return true;
    }
    if (yard === null) return false;
    forceCompleteMission(galaxy, fleet);
    shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.Repair, yard, null, BuiltObjectMissionPriority.Unavailable, true);
    for (const ship of [...fleet.ships]) {
        if (ship.damagedComponentCount > 0) {
            const d = galaxy.calculateDistance(ship.xpos, ship.ypos, yard.xpos, yard.ypos);
            if ((ship.topSpeed > 0 && d < 2000.0) || (ship.warpSpeed > 0 && ship.topSpeed > 0)) {
                clearPreviousMissionRequirements(galaxy, ship, true);
                assignMission(galaxy, ship, BuiltObjectMissionType.Repair, yard, null, BuiltObjectMissionPriority.VeryHigh);
            }
        } else if (ship.topSpeed > 0 && ship.warpSpeed > 0) {
            clearPreviousMissionRequirements(galaxy, ship, true);
            assignMission(galaxy, ship, BuiltObjectMissionType.Refuel, yard, null, BuiltObjectMissionPriority.VeryHigh);
        }
    }
    markFleetPlayerOrder(fleet); // a player order (playerOrder.ts)
    return true;
}

/** Main.Part3.cs btnBuiltObjectRefuelSelected_Click: each selected mobile non-base ship refuels at the nearest point. */
export function refuelSelectedShips(galaxy: Galaxy, empire: Empire, ships: readonly BuiltObject[]): number {
    let n = 0;
    for (const b of ships) {
        if (b.empire !== empire || !(b.topSpeed > 0 && b.owner !== null && b.role !== BuiltObjectRole.Base)) continue;
        const fuelTypes = determineFuelRequired(b, true);
        const point = stellar(fastFindNearestRefuellingPoint(galaxy, b.xpos, b.ypos, fuelTypes, b.actualEmpire, b));
        if (point !== null) {
            assignMission(galaxy, b, BuiltObjectMissionType.Refuel, point, null, BuiltObjectMissionPriority.Unavailable, { manuallyAssigned: true });
            markPlayerOrder(b); // a player order (playerOrder.ts)
            n++;
        }
    }
    return n;
}

/** Main.Part3.cs btnBuiltObjectRepairSelected_Click: each damaged mobile ship goes to the nearest yard (incl. very small). */
export function repairSelectedShips(galaxy: Galaxy, empire: Empire, ships: readonly BuiltObject[]): number {
    let n = 0;
    for (const b of ships) {
        if (b.empire !== empire || !(b.damagedComponentCount > 0 && b.topSpeed > 0)) continue;
        const yard = stellar(findNearestShipYard(galaxy, empire, b, true, true));
        if (yard !== null) {
            assignMission(galaxy, b, BuiltObjectMissionType.Repair, yard, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
            markPlayerOrder(b); // not IsAutoControlled = false: only the Automate toggle changes it (playerOrder.ts)
            n++;
        }
    }
    return n;
}

/** Main.Part3.cs btnBuiltObjectRetireSelected_Click: each mobile non-base ship with an owner is sent to retire at a yard. */
export function retireSelectedShips(galaxy: Galaxy, empire: Empire, ships: readonly BuiltObject[]): number {
    let n = 0;
    for (const b of ships) {
        if (b.empire !== empire || !(b.topSpeed > 0 && b.owner !== null && b.role !== BuiltObjectRole.Base)) continue;
        const yard = stellar(findNearestShipYard(galaxy, empire, b, true, true));
        if (yard !== null) {
            assignMission(galaxy, b, BuiltObjectMissionType.Retire, yard, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
            markPlayerOrder(b); // a player order (playerOrder.ts)
            n++;
        }
    }
    return n;
}

export type RetrofitSkipReason = 'private ship' | 'already refitting' | 'under construction' | 'immobile' | 'no buildable design' | 'already latest design' | 'not owned' | 'cannot afford' | 'no ship yard available';
export interface RetrofitPlanEntry {
    ship: BuiltObject;
    /** The newest buildable design of the ship's subrole, or null when the ship is skipped. */
    design: Design | null;
    cost: number;
    skip: RetrofitSkipReason | null;
}
export interface RetrofitResult {
    sent: number;
    skipped: Partial<Record<RetrofitSkipReason, number>>;
}

/**
 * Main.Part3.cs method_574/575 (btnBuiltObjectRetrofitSelected_Click) without a chosen design: per ship the newest
 * design the empire can build for its subrole (Designs.FindNewestCanBuildFullEvaluate(SubRole, ParentHabitat)), skipping
 * private ships and ships already retrofitting (method_579), ships under construction / immobile / already on that design
 * (Empire.5.cs AssignRetrofitMission). Read-only; `cost` is the DetermineRetrofitAffordability estimate.
 */
export function planRetrofit(galaxy: Galaxy, empire: Empire, ships: readonly BuiltObject[]): RetrofitPlanEntry[] {
    const seen = new Set<BuiltObject>();
    const out: RetrofitPlanEntry[] = [];
    for (const ship of ships) {
        if (ship === null || seen.has(ship)) continue;
        seen.add(ship);
        const entry = (skip: RetrofitSkipReason | null, design: Design | null = null, cost = 0): void => {
            out.push({ ship, design, cost, skip });
        };
        if (ship.empire !== empire) { entry('not owned'); continue; }
        if (ship.owner === null && ship.role !== BuiltObjectRole.Base) { entry('private ship'); continue; }
        if (ship.retrofitDesign !== null) { entry('already refitting'); continue; }
        if (ship.builtAt !== null) { entry('under construction'); continue; }
        if (ship.role !== BuiltObjectRole.Base && ship.topSpeed <= 0) { entry('immobile'); continue; }
        const design = findNewestCanBuildFullEvaluate(empire.designs, ship.subRole, ship.parentHabitat);
        if (design === null) { entry('no buildable design'); continue; }
        if (ship.design === design) { entry('already latest design', design); continue; }
        const aff = determineRetrofitAffordability(galaxy, empire, ship, design);
        entry(aff.result ? null : 'cannot afford', design, aff.cost);
    }
    return out;
}

/** Retrofit each eligible ship (planRetrofit) to its newest design, forcing use of a yard like the original's Go button. */
export function retrofitSelectedShips(galaxy: Galaxy, empire: Empire, ships: readonly BuiltObject[]): RetrofitResult {
    const result: RetrofitResult = { sent: 0, skipped: {} };
    const skip = (r: RetrofitSkipReason): void => {
        result.skipped[r] = (result.skipped[r] ?? 0) + 1;
    };
    for (const e of planRetrofit(galaxy, empire, ships)) {
        if (e.skip !== null) { skip(e.skip); continue; }
        const snap = snapshotOrders([e.ship], []);
        const ok = assignRetrofitMission(galaxy, empire, e.ship, e.design, null, true);
        markNewOrders(snap); // a player order (playerOrder.ts)
        if (ok) result.sent++;
        else skip('no ship yard available');
    }
    return result;
}
