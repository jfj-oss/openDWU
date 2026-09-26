// [fix6ui] Ship-order hotkeys and the selection history (playtest 2026-09-25-b, N2 / #12).
//
// Ports of the Main.Part7.cs 2186 Main_KeyUp branches for the selected ship / fleet keys (Bacon key map defaults):
//   E  ShipEscapeCommand      Main.Part7.cs 2710-2748
//   R  RefuelShip             Main.Part7.cs 2987-3045
//   A  EnableAuto             Main.Part7.cs 2640-2665
//   S  StopShip               Main.Part7.cs 3046-3084
//   ,  CycleShipEngagmentRange Main.Part7.cs 3362-3368 → 2053 RrhupiLdOr
//   Z  FindNearestMilitaryShip Main.Part7.cs 3180 → Main.Part4.cs 2330 kouhXgMiyR
//   N  CycleSelectionForward  Main.Part7.cs 2914 → Main.Part10.cs 1505 btnSelectionForward_Click
//   B  CycleSelectionBackward Main.Part7.cs 2666 → Main.Part10.cs 1535 btnSelectionBack_Click
//   L  ToggleViewLock         Main.Part7.cs 2857 → Main.Part9.cs 3165 btnLockView_Click
// Each key does what its C# handler does (the handlers call the sim directly, not method_347, so the key and the
// selection-panel button of the same name differ in small ways, e.g. R picks the nearest refuelling point itself).
// Headless: no DOM / Pixi imports here, so the mapping is unit-tested (test/fix6ui.test.ts).

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { BuiltObject } from '../builtObject';
import { Habitat } from '../types';
import { BuiltObjectRole } from '../data/designSpecifications';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission, type StellarObject } from '../missions/mission';
import { assignMission, clearPreviousMissionRequirements } from '../missions/assign';
import { ShipGroup, forceCompleteMission } from '../fleets/shipGroup';
import { shipGroupAssignMission, shipGroupCalculateRequiredFuel } from '../fleets/shipGroupTasks';
import { decideBestFleetRefuelPoint } from '../fleets/militaryAI';
import { evaluateThreats } from '../combat/threats';
import { exitHyperjump, fastFindNearestRefuellingPoint } from '../movement';
import { determineFuelRequired } from '../logistics/refuel';
import { assignMissionToBuiltObject } from '../civilianAI';
import { pirateAssignShipMission } from '../pirates/pirateAI';
import { galaxyStarDate } from '../tick/simTime';
import type { ShipActionSelection } from './executeShipAction';

/** The binding actions (keyboard.ts KEY_BINDINGS) that act on the selected ship / fleet. */
export type ShipOrderKeyAction = 'commandEscape' | 'commandRefuel' | 'automateShip' | 'stopShip' | 'cycleEngagementStance';

export const SHIP_ORDER_KEY_ACTIONS: readonly ShipOrderKeyAction[] = [
    'commandEscape',
    'commandRefuel',
    'automateShip',
    'stopShip',
    'cycleEngagementStance',
];

export function isShipOrderKeyAction(action: string): action is ShipOrderKeyAction {
    return (SHIP_ORDER_KEY_ACTIONS as readonly string[]).includes(action);
}

/** Main.Part7.cs 2053 RrhupiLdOr: 0 → 4,000,000 → 2.304E+09 → 0; anything else → 2.304E+09 (C# floats, exact here). */
export function nextAttackRangeSquared(current: number): number {
    if (current === 0) return 4000000;
    if (current === 4000000) return 2304000000;
    if (current === 2304000000) return 0;
    return 2304000000;
}

/** Main.Part7.cs 1855 method_348(shipGroup, automated): every ship's IsAutoControlled. */
function setFleetAutomated(sg: ShipGroup, automated: boolean): void {
    for (const ship of sg.ships) ship.isAutoControlled = automated;
}

function asStellarTarget(o: StellarObject | null): BuiltObject | Habitat | null {
    return o instanceof BuiltObject || o instanceof Habitat ? o : null;
}

/**
 * Run one ship-order hotkey on `_Game.SelectedObject` for `_Game.PlayerEmpire`, as Main_KeyUp does. Returns true when
 * the key changed something (the caller refreshes the selection panel), false when the C# handler does nothing for
 * this selection (not the player's, nothing to escape from, no refuelling point...).
 */
export function executeShipOrderKey(galaxy: Galaxy, player: Empire, selected: ShipActionSelection, action: ShipOrderKeyAction): boolean {
    switch (action) {
        case 'commandEscape': {
            // Main.Part7.cs 2710-2748: ships only (a fleet selection does nothing).
            if (!(selected instanceof BuiltObject) || selected.owner === null || selected.owner !== player) return false;
            let target: StellarObject | null = null;
            const attackers = selected.attackers ?? [];
            if (attackers.length > 0) {
                target = attackers[0] as StellarObject;
                clearPreviousMissionRequirements(galaxy, selected, true);
            } else {
                const threats = evaluateThreats(galaxy, selected).threats;
                if (threats === null || threats.length <= 0) return false;
                target = threats[0];
                clearPreviousMissionRequirements(galaxy, selected, true);
            }
            clearPreviousMissionRequirements(galaxy, selected, true);
            assignMission(galaxy, selected, BuiltObjectMissionType.Escape, target, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
            selected.isAutoControlled = false;
            return true;
        }
        case 'commandRefuel': {
            // Main.Part7.cs 2987-3045.
            if (selected instanceof BuiltObject) {
                if (selected.owner === null || selected.owner !== player) return false;
                clearPreviousMissionRequirements(galaxy, selected, true);
                const fuelTypes = determineFuelRequired(selected);
                const so =
                    selected.role !== BuiltObjectRole.Military
                        ? fastFindNearestRefuellingPoint(galaxy, selected.xpos, selected.ypos, fuelTypes, selected.actualEmpire, selected)
                        : fastFindNearestRefuellingPoint(galaxy, selected.xpos, selected.ypos, fuelTypes, selected.actualEmpire, selected, true, null);
                const target = asStellarTarget(so);
                if (target === null) return false;
                assignMission(galaxy, selected, BuiltObjectMissionType.Refuel, target, null, BuiltObjectMissionPriority.Normal, { manuallyAssigned: true });
                selected.isAutoControlled = false;
                return true;
            }
            if (selected instanceof ShipGroup) {
                const lead = selected.leadShip;
                if (selected.empire === null || selected.empire !== player || lead === null) return false;
                const required = shipGroupCalculateRequiredFuel(selected);
                let so: StellarObject | null = decideBestFleetRefuelPoint(galaxy, player, lead.xpos, lead.ypos, selected.empire, required, null);
                if (so === null) so = fastFindNearestRefuellingPoint(galaxy, lead.xpos, lead.ypos, required, selected.empire, lead, true, null, selected.ships.length);
                const target = asStellarTarget(so);
                if (target === null) return false;
                shipGroupAssignMission(galaxy, selected, BuiltObjectMissionType.Refuel, target, null, BuiltObjectMissionPriority.Unavailable, true);
                setFleetAutomated(selected, false);
                return true;
            }
            return false;
        }
        case 'automateShip': {
            // Main.Part7.cs 2640-2665 (EnableAuto).
            if (selected instanceof BuiltObject) {
                const owner = selected.owner;
                if (owner === null || owner !== player) return false;
                selected.isAutoControlled = true;
                if (owner.pirateEmpireBaseHabitat === null) {
                    assignMissionToBuiltObject(galaxy, owner, selected, false, null);
                } else {
                    pirateAssignShipMission(galaxy, owner, selected, galaxyStarDate(galaxy));
                }
                return true;
            }
            if (selected instanceof ShipGroup) {
                if (selected.empire !== player) return false;
                setFleetAutomated(selected, true);
                return true;
            }
            return false;
        }
        case 'stopShip': {
            // Main.Part7.cs 3046-3084.
            if (selected instanceof BuiltObject) {
                if (selected.builtAt !== null || selected.owner === null || selected.owner !== player) return false;
                exitHyperjump(galaxy, selected);
                clearPreviousMissionRequirements(galaxy, selected, true);
                selected.targetSpeed = 0;
                selected.preferredSpeed = 0;
                selected.isAutoControlled = false;
                return true;
            }
            if (selected instanceof ShipGroup) {
                // The C# does not test the fleet's owner here.
                for (const ship of selected.ships) {
                    clearPreviousMissionRequirements(galaxy, ship);
                    ship.targetSpeed = 0;
                    ship.preferredSpeed = 0;
                }
                forceCompleteMission(galaxy, selected);
                setFleetAutomated(selected, false);
                return true;
            }
            return false;
        }
        case 'cycleEngagementStance': {
            // Main.Part7.cs 2053 RrhupiLdOr.
            if (selected instanceof BuiltObject) {
                if (selected.empire !== player || selected.role !== BuiltObjectRole.Military) return false;
                selected.attackRangeSquared = nextAttackRangeSquared(selected.attackRangeSquared);
                return true;
            }
            if (selected instanceof ShipGroup) {
                if (selected.empire !== player) return false;
                selected.attackRangeSquared = nextAttackRangeSquared(selected.attackRangeSquared);
                for (const ship of selected.ships) ship.attackRangeSquared = selected.attackRangeSquared;
                return true;
            }
            return false;
        }
    }
}

/**
 * Galaxy.3.cs 823/838 FastFindNearestAvailableMilitaryShip(x, y, empire) with its defaults (minimumFirepower 1,
 * includeUnAutomatedShips, allowShipsInFleets and includeBusyShips all true): the nearest finished, functional
 * military ship (no troop transports / resupply ships) that is not on an Attack mission or a High / VeryHigh one.
 */
export function fastFindNearestAvailableMilitaryShip(galaxy: Galaxy, x: number, y: number, empire: Empire): BuiltObject | null {
    let best = Number.MAX_VALUE;
    let result: BuiltObject | null = null;
    for (const bo of empire.builtObjects) {
        if (
            bo === null ||
            bo === undefined ||
            bo.role !== BuiltObjectRole.Military ||
            bo.firepowerRaw < 1 ||
            bo.unbuiltComponentCount > 0 ||
            bo.builtAt !== null ||
            bo.subRole === BuiltObjectSubRole.TroopTransport ||
            bo.subRole === BuiltObjectSubRole.ResupplyShip ||
            !bo.isFunctional
        ) {
            continue;
        }
        const m = builtObjectMission(bo.mission);
        if (
            m !== null &&
            (m.type === BuiltObjectMissionType.Attack || m.priority === BuiltObjectMissionPriority.VeryHigh || m.priority === BuiltObjectMissionPriority.High)
        ) {
            continue;
        }
        const d = galaxy.calculateDistanceSquared(x, y, bo.xpos, bo.ypos);
        if (d < best) {
            best = d;
            result = bo;
        }
    }
    return result;
}

/** What the selection history can hold (_Game.SelectedObject kinds the streamlined HUD selects). */
export type HistoryEntry = BuiltObject | Habitat | ShipGroup;

/**
 * Main.Part10.cs selection history: list_5 (capacity int_23 = 100, Main.Part13.cs 169) and its cursor int_22.
 * `push` is the method_209(obj, bool_28: true) tail (1445-1498); `forward` / `back` are btnSelectionForward_Click /
 * btnSelectionBack_Click with method_211 / method_210 dropping entries that are gone (`isValid` = not destroyed and
 * visible; a fleet needs ships).
 */
export class SelectionHistory {
    readonly entries: HistoryEntry[] = [];
    index = 0;
    constructor(readonly capacity = 100) {}

    push(obj: HistoryEntry): void {
        const list = this.entries;
        if (list.length > 0 && list[this.index] === obj) return;
        if (this.index + 1 < list.length && list[this.index + 1] === obj) {
            this.index++;
            return;
        }
        if (this.index < list.length - 1) {
            this.index++;
            list.splice(this.index, 0, obj);
        } else if (list.length >= this.capacity) {
            for (let k = 0; k < list.length - 1; k++) list[k] = list[k + 1];
            list[list.length - 1] = obj;
            this.index = list.length - 1;
        } else {
            list.push(obj);
            this.index = list.length - 1;
        }
    }

    /** btnSelectionForward_Click: the entry to select (null: clear the selection). */
    forward(hasSelection: boolean, isValid: (o: HistoryEntry) => boolean): HistoryEntry | null {
        const list = this.entries;
        if (hasSelection || list.length <= 0) {
            if (this.index < list.length - 1) this.index++;
            else if (list.length > 0) this.index = 0;
        }
        if (this.index >= list.length) this.index = list.length - 1;
        this.index = this.skipForward(this.index, isValid);
        if (this.index < 0) {
            this.index = 0;
            return null;
        }
        return this.index < list.length ? list[this.index] : null;
    }

    /** btnSelectionBack_Click. */
    back(hasSelection: boolean, isValid: (o: HistoryEntry) => boolean): HistoryEntry | null {
        const list = this.entries;
        if (hasSelection || list.length <= 0) {
            if (this.index > 0) this.index--;
            else if (list.length > 0) this.index = list.length - 1;
        }
        this.index = this.skipBackward(this.index, isValid);
        if (this.index < 0) {
            this.index = 0;
            return null;
        }
        return list[this.index];
    }

    /** method_211: drop invalid entries at i (the next ones slide down) until a valid one; -1 when empty. */
    private skipForward(i: number, isValid: (o: HistoryEntry) => boolean): number {
        const list = this.entries;
        while (i < list.length) {
            if (list.length <= 0) return -1;
            if (isValid(list[i])) return i;
            list.splice(i, 1);
        }
        return list.length <= 0 ? -1 : 0;
    }

    /** method_210: drop invalid entries walking backwards; -1 when empty. */
    private skipBackward(i: number, isValid: (o: HistoryEntry) => boolean): number {
        const list = this.entries;
        while (i >= 0) {
            if (list.length <= 0) return -1;
            if (isValid(list[i])) return i;
            list.splice(i, 1);
            i--;
        }
        return list.length <= 0 ? -1 : 0;
    }
}
