// M4s (s2) — PirateColonyControl.cs / PirateColonyControlList.cs: a pirate faction's control of a colony
// (Habitat._PirateColonyControl, Habitat.cs 67). Runtime-dependency-free apart from netSort (type imports only) so
// types.ts can create the list in its Habitat field initializer. CheckEmpireHasRelationTypeWithAny needs galaxy helpers
// and lives in pirateAI.ts (pirateControlCheckEmpireHasRelationTypeWithAny).

import { netSort } from '../netSort';
import type { Empire } from '../empire';

const f = Math.fround;

// PirateColonyControl.cs.
export class PirateColonyControl {
    /** byte. */
    empireId = 0;
    /** float. */
    private _controlLevel = 0;
    hasFacilityControl = false;

    // PirateColonyControl.cs 19 / 24 (empireId, controlLevel[, hasFacilityControl]): empireId > 255 leaves every field default.
    constructor(empireId: number, controlLevel: number, hasFacilityControl = false) {
        if (empireId > 255) return;
        this.empireId = empireId & 0xff;
        this.controlLevel = controlLevel;
        this.hasFacilityControl = hasFacilityControl;
    }

    get controlLevel(): number {
        return this._controlLevel;
    }
    set controlLevel(v: number) {
        this._controlLevel = f(v);
    }
}

/** IComparable<PirateColonyControl>.CompareTo: ControlLevel.CompareTo(other.ControlLevel) (float.CompareTo, NaN lowest). */
function compareControl(a: PirateColonyControl, b: PirateColonyControl): number {
    const x = a.controlLevel;
    const y = b.controlLevel;
    if (x < y) return -1;
    if (x > y) return 1;
    if (x === y) return 0;
    if (Number.isNaN(x)) return Number.isNaN(y) ? 0 : -1;
    return 1;
}

// PirateColonyControlList.cs (List<PirateColonyControl>).
export class PirateColonyControlList {
    items: PirateColonyControl[] = [];

    get count(): number {
        return this.items.length;
    }
    at(index: number): PirateColonyControl {
        return this.items[index];
    }
    add(item: PirateColonyControl): void {
        this.items.push(item);
    }
    /** List.Remove (first occurrence). */
    remove(item: PirateColonyControl | null): boolean {
        const i = item === null ? -1 : this.items.indexOf(item);
        if (i < 0) return false;
        this.items.splice(i, 1);
        return true;
    }
    /** List.Sort() (introsort, unstable) by ControlLevel. */
    sort(): void {
        netSort(this.items, compareControl);
    }
    reverse(): void {
        this.items.reverse();
    }

    /** PirateColonyControlList.cs 15 IndexOf(empireId). */
    indexOfEmpireId(empireId: number): number {
        for (let index = 0; index < this.items.length; ++index) {
            if (this.items[index].empireId === empireId) return index;
        }
        return -1;
    }

    /** PirateColonyControlList.cs 25/27 CheckFactionHasControl(pirateFaction | id). */
    checkFactionHasControl(pirateFaction: Empire | number | null): boolean {
        if (pirateFaction === null) return false;
        return this.getByFaction(typeof pirateFaction === 'number' ? pirateFaction : pirateFaction.empireId) !== null;
    }

    /** PirateColonyControlList.cs 29 GetHighestControl. */
    getHighestControl(): PirateColonyControl | null {
        let highestControl: PirateColonyControl | null = null;
        for (let index = 0; index < this.items.length; ++index) {
            const pirateColonyControl = this.items[index];
            if (pirateColonyControl != null && (highestControl === null || pirateColonyControl.controlLevel > highestControl.controlLevel)) {
                highestControl = pirateColonyControl;
            }
        }
        return highestControl;
    }

    /** PirateColonyControlList.cs 41/43 GetByFaction(pirateFaction | id). */
    getByFaction(pirateFaction: Empire | number | null): PirateColonyControl | null {
        if (pirateFaction === null) return null;
        const pirateFactionId = typeof pirateFaction === 'number' ? pirateFaction : pirateFaction.empireId;
        for (let index = 0; index < this.items.length; ++index) {
            if (this.items[index].empireId === pirateFactionId) return this.items[index];
        }
        return null;
    }

    /** PirateColonyControlList.cs 53 GetByFacilityControl. */
    getByFacilityControl(): PirateColonyControl | null {
        for (let index = 0; index < this.items.length; ++index) {
            if (this.items[index].hasFacilityControl) return this.items[index];
        }
        return null;
    }
}

/**
 * Habitat.cs 6070 CheckColonyRevenueFromPirateControl(revenueEmpire): true when a pirate faction draws revenue from a
 * colony it does not own. No Rnd.
 */
export function checkColonyRevenueFromPirateControl(habitat: { empire: Empire | null }, revenueEmpire: Empire | null): boolean {
    if (revenueEmpire !== null && revenueEmpire.pirateEmpireBaseHabitat !== null) {
        if (habitat.empire === revenueEmpire) return false;
        return true;
    }
    return false;
}
