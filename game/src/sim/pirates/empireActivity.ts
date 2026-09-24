// M4s (s1) — EmpireActivity.cs, EmpireActivityType.cs, EmpireActivityList.cs: the pirate mission marketplace records
// (Empire._PirateMissions / Galaxy.PirateMissions). Runtime-dependency-free (type imports only) so empire.ts /
// galaxy.ts can create the lists in their field initializers. The list methods that need galaxy helpers
// (CountMissionsInSameSystem, ResolveByTypeKnownTarget, ResolveByAllowedDefendTargetsNotRequestedBy,
// ResolveByKnownAttackTargetsNotRequestedBy) are free functions in missionsMarket.ts.

import type { Empire } from '../empire';
import type { BuiltObject } from '../builtObject';
import type { Habitat } from '../types';
import type { Order } from '../logistics/orders';

/** C# StellarObject as an EmpireActivity target (Habitat or BuiltObject). */
export type ActivityTarget = Habitat | BuiltObject;

// EmpireActivityType.cs (declaration order = values).
export enum EmpireActivityType {
    Undefined,
    Attack,
    Defend,
    Smuggle,
}

// EmpireActivity.cs.
export class EmpireActivity {
    targetEmpire: Empire | null;
    requestingEmpire: Empire | null;
    /** long. */
    expiryDate: number;
    type: EmpireActivityType;
    target: ActivityTarget | null = null;
    /** byte; byte.MaxValue (255) = any resource. */
    resourceId = 255;
    relatedOrder: Order | null = null;
    price = 0.0;
    assignedEmpire: Empire | null = null;
    /** long; -1 = no bid yet. */
    bidTimeRemaining = -1;
    /** [NonSerialized] UI. */
    displayExtraData = -1;
    playerIncomeEarned = 0.0;
    playerAmountDelivered = 0;

    // EmpireActivity.cs 30 (targetEmpire, requestingEmpire, expiryDate, type) and 43 (+ attackTarget, attackPrice).
    constructor(targetEmpire: Empire | null, requestingEmpire: Empire | null, expiryDate: number, type: EmpireActivityType, attackTarget: ActivityTarget | null = null, attackPrice = 0.0) {
        this.targetEmpire = targetEmpire;
        this.requestingEmpire = requestingEmpire;
        this.expiryDate = expiryDate;
        this.type = type;
        this.target = attackTarget;
        this.price = attackPrice;
    }

    /** EmpireActivity.cs 55 ResolveTargetCoordinates(out x, out y). */
    resolveTargetCoordinates(): { ok: boolean; x: number; y: number } {
        if (this.target === null) return { ok: false, x: 0.0, y: 0.0 };
        return { ok: true, x: this.target.xpos, y: this.target.ypos };
    }

    /** EmpireActivity.cs 66 CheckEquivalent(EmpireActivity). */
    checkEquivalent(otherActivity: EmpireActivity | null): boolean {
        return otherActivity !== null && otherActivity.targetEmpire === this.targetEmpire && otherActivity.requestingEmpire === this.requestingEmpire && otherActivity.type === this.type && otherActivity.target === this.target;
    }

    /** EmpireActivity.cs 68 CheckEquivalent(target, type). */
    checkEquivalentTarget(target: ActivityTarget | null, type: EmpireActivityType): boolean {
        return target !== null && target === this.target && type === this.type;
    }
}

// EmpireActivityList.cs (SyncList<EmpireActivity>; the locks are no-ops single-threaded).
export class EmpireActivityList {
    items: (EmpireActivity | null)[] = [];

    get count(): number {
        return this.items.length;
    }
    /** Array-style alias. */
    get length(): number {
        return this.items.length;
    }
    at(index: number): EmpireActivity | null {
        return this.items[index];
    }
    add(activity: EmpireActivity | null): void {
        this.items.push(activity);
    }
    /** List<T>.Remove: first occurrence. */
    remove(activity: EmpireActivity | null): boolean {
        const i = this.items.indexOf(activity);
        if (i < 0) return false;
        this.items.splice(i, 1);
        return true;
    }
    /** List<T>.Contains (reference). */
    contains(activity: EmpireActivity | null): boolean {
        return this.items.indexOf(activity) >= 0;
    }

    /** EmpireActivityList.cs 14 this[Empire targetEmpire]. */
    getByTargetEmpire(targetEmpire: Empire | null): EmpireActivity | null {
        for (const a of this.items) {
            if (a!.targetEmpire === targetEmpire) return a;
        }
        return null;
    }

    /** EmpireActivityList.cs 50 ResolveActivitiesByType (no null check, as in C#). */
    resolveActivitiesByType(type: EmpireActivityType): EmpireActivityList {
        const list = new EmpireActivityList();
        for (let index = 0; index < this.items.length; ++index) {
            if (this.items[index]!.type === type) list.add(this.items[index]);
        }
        return list;
    }

    /** EmpireActivityList.cs 63 IndexOfTarget(targetEmpire, type). */
    indexOfTarget(targetEmpire: Empire | null, type: EmpireActivityType): number {
        for (let index = 0; index < this.items.length; ++index) {
            if (this.items[index]!.type === type && this.items[index]!.targetEmpire === targetEmpire) return index;
        }
        return -1;
    }

    /** EmpireActivityList.cs 76 IndexOfRequester(requestingEmpire, type). */
    indexOfRequester(requestingEmpire: Empire | null, type: EmpireActivityType): number {
        for (let index = 0; index < this.items.length; ++index) {
            if (this.items[index]!.type === type && this.items[index]!.requestingEmpire === requestingEmpire) return index;
        }
        return -1;
    }

    /** EmpireActivityList.cs 89 IndexOf(Empire). */
    indexOfEmpire(empire: Empire | null): number {
        for (let index = 0; index < this.items.length; ++index) {
            if (this.items[index]!.targetEmpire === empire) return index;
        }
        return -1;
    }

    /** EmpireActivityList.cs 102 Contains(targetEmpire, type). */
    containsTargetEmpire(targetEmpire: Empire | null, type: EmpireActivityType): boolean {
        for (const a of this.items) {
            if (a!.type === type && a!.targetEmpire === targetEmpire) return true;
        }
        return false;
    }

    /** EmpireActivityList.cs 112 Contains(Empire). */
    containsEmpire(empire: Empire | null): boolean {
        for (const a of this.items) {
            if (a!.targetEmpire === empire) return true;
        }
        return false;
    }

    /** EmpireActivityList.cs 122 RemoveEquivalent(EmpireActivity). */
    removeEquivalent(empireActivity: EmpireActivity | null): void {
        if (empireActivity === null) return;
        this.removeEquivalentTarget(empireActivity.target, empireActivity.type);
    }

    /** EmpireActivityList.cs 129 RemoveEquivalent(target, type). */
    removeEquivalentTarget(target: ActivityTarget | null, type: EmpireActivityType): void {
        const list: EmpireActivity[] = [];
        for (let index = 0; index < this.items.length; ++index) {
            const a = this.items[index];
            if (a !== null && a.checkEquivalentTarget(target, type)) list.push(a);
        }
        for (let index = 0; index < list.length; ++index) this.remove(list[index]);
    }

    /** EmpireActivityList.cs 142 StripMissionsWithTargetEmpire. */
    stripMissionsWithTargetEmpire(empire: Empire | null): void {
        if (empire === null) return;
        const list: EmpireActivity[] = [];
        for (let index = 0; index < this.items.length; ++index) {
            const a = this.items[index];
            if (a !== null && a.targetEmpire === empire) list.push(a);
        }
        for (let index = 0; index < list.length; ++index) this.remove(list[index]);
    }

    /** EmpireActivityList.cs 157 ContainsEquivalent(EmpireActivity). */
    containsEquivalent(empireActivity: EmpireActivity | null): boolean {
        for (let index = 0; index < this.items.length; ++index) {
            const a = this.items[index];
            if (a !== null && a.checkEquivalent(empireActivity)) return true;
        }
        return false;
    }

    /** EmpireActivityList.cs 168 ContainsEquivalent(target, type). */
    containsEquivalentTarget(target: ActivityTarget | null, type: EmpireActivityType): boolean {
        for (let index = 0; index < this.items.length; ++index) {
            const a = this.items[index];
            if (a !== null && a.checkEquivalentTarget(target, type)) return true;
        }
        return false;
    }

    /** EmpireActivityList.cs 179 CountByType. */
    countByType(type: EmpireActivityType): number {
        let num = 0;
        for (let index = 0; index < this.items.length; ++index) {
            const a = this.items[index];
            if (a !== null && a.type === type) ++num;
        }
        return num;
    }

    /** EmpireActivityList.cs 191 CalculateTotalAttackCosts. */
    calculateTotalAttackCosts(requester: Empire | null): number {
        let total = 0.0;
        for (let index = 0; index < this.items.length; ++index) {
            const a = this.items[index];
            if (a !== null && a.type === EmpireActivityType.Attack && a.assignedEmpire !== requester) total += a.price;
        }
        return total;
    }

    /** EmpireActivityList.cs 203 CalculateTotalDefendCosts. */
    calculateTotalDefendCosts(requester: Empire | null): number {
        let total = 0.0;
        for (let index = 0; index < this.items.length; ++index) {
            const a = this.items[index];
            if (a !== null && a.type === EmpireActivityType.Defend && a.assignedEmpire !== requester) total += a.price;
        }
        return total;
    }

    /** EmpireActivityList.cs 215 ResolveAttackTargettedEmpires. */
    resolveAttackTargettedEmpires(): Empire[] {
        const list: Empire[] = [];
        for (let index = 0; index < this.items.length; ++index) {
            const a = this.items[index];
            if (a !== null && a.targetEmpire !== null && a.type === EmpireActivityType.Attack && !list.includes(a.targetEmpire)) list.push(a.targetEmpire);
        }
        return list;
    }

    /** EmpireActivityList.cs 227 GetFirstByTargetAndType. */
    getFirstByTargetAndType(target: ActivityTarget | null, type: EmpireActivityType): EmpireActivity | null {
        for (let index = 0; index < this.items.length; ++index) {
            const a = this.items[index];
            if (a !== null && a.type === type && a.target === target) return a;
        }
        return null;
    }

    /** EmpireActivityList.cs 238 GetFirstByTargetAndTypeAssigned. */
    getFirstByTargetAndTypeAssigned(target: ActivityTarget | null, type: EmpireActivityType, requester: Empire | null): EmpireActivity | null {
        for (let index = 0; index < this.items.length; ++index) {
            const a = this.items[index];
            if (a !== null && a.type === type && a.target === target && a.requestingEmpire === requester && a.assignedEmpire !== null && a.assignedEmpire !== requester) return a;
        }
        return null;
    }

    /** EmpireActivityList.cs 252 GetByAttackTarget. */
    getByAttackTarget(attackTarget: BuiltObject | null, assignedEmpire: Empire | null): EmpireActivity | null {
        for (let index = 0; index < this.items.length; ++index) {
            const a = this.items[index];
            if (a !== null && a.type === EmpireActivityType.Attack && a.target === attackTarget && (assignedEmpire === null || a.assignedEmpire === assignedEmpire)) return a;
        }
        return null;
    }

    /** EmpireActivityList.cs 263 ResolveByType. */
    resolveByType(type: EmpireActivityType): EmpireActivityList {
        const list = new EmpireActivityList();
        for (let index = 0; index < this.items.length; ++index) {
            const a = this.items[index];
            if (a !== null && a.type === type) list.add(a);
        }
        return list;
    }

    /** EmpireActivityList.cs 275 ResolveByTypeAndRequester. */
    resolveByTypeAndRequester(type: EmpireActivityType, requestingEmpire: Empire | null): EmpireActivityList {
        const list = new EmpireActivityList();
        for (let index = 0; index < this.items.length; ++index) {
            const a = this.items[index];
            if (a !== null && a.type === type && a.requestingEmpire === requestingEmpire) list.add(a);
        }
        return list;
    }

    /** EmpireActivityList.cs 289 ResolveByTarget. */
    resolveByTarget(target: ActivityTarget | null): EmpireActivityList {
        const list = new EmpireActivityList();
        for (let index = 0; index < this.items.length; ++index) {
            const a = this.items[index];
            if (a !== null && a.target === target) list.add(a);
        }
        return list;
    }

    /** EmpireActivityList.cs 301 ResolveByTypeAndTarget (Undefined matches every type). */
    resolveByTypeAndTarget(type: EmpireActivityType, target: ActivityTarget | null): EmpireActivityList {
        const list = new EmpireActivityList();
        if (target !== null) {
            for (let index = 0; index < this.items.length; ++index) {
                const a = this.items[index];
                if (a !== null && (a.type === type || type === EmpireActivityType.Undefined) && a.target === target) list.add(a);
            }
        }
        return list;
    }

    /** EmpireActivityList.cs 344 ResolveWhereRequestingEmpireNot. */
    resolveWhereRequestingEmpireNot(empire: Empire | null): EmpireActivityList {
        const list = new EmpireActivityList();
        if (empire !== null) {
            for (let index = 0; index < this.items.length; ++index) {
                const a = this.items[index];
                if (a !== null && a.requestingEmpire !== empire) list.add(a);
            }
        }
        return list;
    }

    /** EmpireActivityList.cs 358 ResolveAssigned. */
    resolveAssigned(): EmpireActivityList {
        const list = new EmpireActivityList();
        for (let index = 0; index < this.items.length; ++index) {
            const a = this.items[index];
            if (a !== null) {
                if (a.type === EmpireActivityType.Smuggle) list.add(a);
                else if (a.assignedEmpire !== null && a.bidTimeRemaining === 0) list.add(a);
            }
        }
        return list;
    }

    /** EmpireActivityList.cs 375 ResolveUnassigned. */
    resolveUnassigned(): EmpireActivityList {
        const list = new EmpireActivityList();
        for (let index = 0; index < this.items.length; ++index) {
            const a = this.items[index];
            if (a !== null) {
                if (a.type === EmpireActivityType.Smuggle) list.add(a);
                else if (a.assignedEmpire === null || a.bidTimeRemaining !== 0) list.add(a);
            }
        }
        return list;
    }

    /** EmpireActivityList.cs 392 ResolveByTypeWhereRequestingEmpireNot. */
    resolveByTypeWhereRequestingEmpireNot(empire: Empire | null, type: EmpireActivityType): EmpireActivityList {
        const list = new EmpireActivityList();
        if (empire !== null) {
            for (let index = 0; index < this.items.length; ++index) {
                const a = this.items[index];
                if (a !== null && a.type === type && a.requestingEmpire !== empire) list.add(a);
            }
        }
        return list;
    }
}
