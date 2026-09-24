// Port of ForceStructureProjection.cs and ForceStructureProjectionList.cs
// (task M3b). Kept free of Empire/Galaxy imports so empire.ts can hold the
// lists as fields without an import cycle.

import { BuiltObjectSubRole } from './builtObjectTypes';

// Port of ForceStructureProjection.cs.
export class ForceStructureProjection {
    private readonly _projectionDate: number; // C#: long
    private readonly _subRole: BuiltObjectSubRole;
    private _amount: number; // C#: int

    constructor(subRole: BuiltObjectSubRole, amount: number, projectionDate: number) {
        this._subRole = subRole;
        this._amount = amount;
        this._projectionDate = projectionDate;
    }

    get projectionDate(): number {
        return this._projectionDate;
    }

    get subRole(): BuiltObjectSubRole {
        return this._subRole;
    }

    get amount(): number {
        return this._amount;
    }

    set amount(value: number) {
        this._amount = value | 0; // C# int field
    }

    // ForceStructureProjection.cs ObtainWeighting.
    private obtainWeighting(forceStructureProjection: ForceStructureProjection): number {
        const S = BuiltObjectSubRole;
        switch (forceStructureProjection.subRole) {
            case S.Escort:
                return 20;
            case S.Frigate:
                return 19;
            case S.Destroyer:
                return 18;
            case S.Cruiser:
                return 16;
            case S.CapitalShip:
                return 15;
            case S.TroopTransport:
                return 14;
            case S.Carrier:
                return 17;
            case S.ResupplyShip:
                return 21;
            case S.ExplorationShip:
                return 13;
            case S.SmallFreighter:
                return 8;
            case S.MediumFreighter:
                return 7;
            case S.LargeFreighter:
                return 6;
            case S.ColonyShip:
                return 9;
            case S.ConstructionShip:
                return 1;
            case S.GasMiningShip:
                return 4;
            case S.MiningShip:
                return 4;
            case S.GasMiningStation:
                return 2;
            case S.MiningStation:
                return 2;
            case S.SmallSpacePort:
                return 12;
            case S.MediumSpacePort:
                return 11;
            case S.LargeSpacePort:
                return 10;
            default:
                return 100;
        }
    }

    // ForceStructureProjection.cs CompareTo (int.CompareTo of the weightings).
    compareTo(other: ForceStructureProjection): number {
        const a = this.obtainWeighting(this);
        const b = this.obtainWeighting(other);
        return a < b ? -1 : a > b ? 1 : 0;
    }
}

// Port of ForceStructureProjectionList.cs (a SyncList<ForceStructureProjection>).
export class ForceStructureProjectionList implements Iterable<ForceStructureProjection> {
    items: ForceStructureProjection[] = [];

    get count(): number {
        return this.items.length;
    }

    get(index: number): ForceStructureProjection {
        return this.items[index];
    }

    add(item: ForceStructureProjection): void {
        this.items.push(item);
    }

    addRange(items: Iterable<ForceStructureProjection>): void {
        for (const item of items) this.items.push(item);
    }

    clear(): void {
        this.items.length = 0;
    }

    [Symbol.iterator](): Iterator<ForceStructureProjection> {
        return this.items[Symbol.iterator]();
    }

    // ForceStructureProjectionList.cs Diff: one entry per BuiltObjectSubRole in
    // Enum.GetValues order (ascending value), amount = max(0, this - other).
    diff(forceStructureProjectionList: ForceStructureProjectionList): ForceStructureProjectionList {
        const structureProjectionList = new ForceStructureProjectionList();
        for (const subRole of builtObjectSubRoleValues()) {
            let num1 = 0;
            let num2 = 0;
            const bySubRole1 = this.getBySubRole(subRole);
            if (bySubRole1 !== null) num1 = bySubRole1.amount;
            const bySubRole2 = forceStructureProjectionList.getBySubRole(subRole);
            if (bySubRole2 !== null) num2 = bySubRole2.amount;
            const amount = Math.max(0, num1 - num2);
            structureProjectionList.add(new ForceStructureProjection(subRole, amount, -1));
        }
        return structureProjectionList;
    }

    // ForceStructureProjectionList.cs GetBySubRole (first match).
    getBySubRole(subRole: BuiltObjectSubRole): ForceStructureProjection | null {
        for (const p of this.items) {
            if (p.subRole === subRole) return p;
        }
        return null;
    }

    // ForceStructureProjectionList.cs TotalAmount.
    get totalAmount(): number {
        let totalAmount = 0;
        for (let index = 0; index < this.items.length; ++index) {
            const p = this.items[index];
            if (p != null) totalAmount = (totalAmount + p.amount) | 0;
        }
        return totalAmount;
    }

    // ForceStructureProjectionList.cs Clone.
    clone(): ForceStructureProjectionList {
        const structureProjectionList = new ForceStructureProjectionList();
        for (let index = 0; index < this.items.length; ++index) {
            const p = this.items[index];
            if (p != null) structureProjectionList.add(new ForceStructureProjection(p.subRole, p.amount, p.projectionDate));
        }
        return structureProjectionList;
    }
}

// Enum.GetValues(typeof(BuiltObjectSubRole)): the numeric members, ascending.
let subRoleValues: BuiltObjectSubRole[] | null = null;
function builtObjectSubRoleValues(): BuiltObjectSubRole[] {
    if (subRoleValues === null) {
        subRoleValues = Object.values(BuiltObjectSubRole)
            .filter((v): v is BuiltObjectSubRole => typeof v === 'number')
            .sort((a, b) => a - b);
    }
    return subRoleValues;
}
