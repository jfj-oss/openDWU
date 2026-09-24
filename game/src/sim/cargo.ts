// Port of Cargo.cs / TroopList.cs (DistantWorlds.Types) — the minimal
// surface needed by the Empire constructors (task M2a): a Cargo item
// (commodity + amount + owning empire + reserved flag), a CargoList with
// IndexOf(resource, empire), and a TroopList.

import type { Resource } from './data/resources';

// Port of Cargo.cs Resource wrapper (C# `new Resource(resourceId)`): a
// commodity reference identified by its resource id. The C# class also
// carries the full definition; M2a only needs the id for IndexOf matching.
export class ResourceRef {
    resourceId: number;

    constructor(resourceId: number) {
        this.resourceId = resourceId;
    }
}

// TODO(port): full Cargo semantics — Cargo.cs: component commodities
// (ComponentDefinition), CommodityIsComponent/CommodityIsResource accessors,
// per-empire merging rules in Add, GetAmount, etc. Here the commodity is a
// parsed Resource definition; components are out of scope for M2a.
export class Cargo {
    commodity: ResourceRef;
    amount = 0; // C#: long _Amount
    empire: unknown; // C#: Empire _Empire (typed as unknown to avoid an import cycle)
    reserved = 0; // C#: int Reserved (Cargo.cs:21)

    constructor(commodity: ResourceRef, amount: number, empire?: unknown, reserved = 0) {
        this.commodity = commodity;
        this.amount = amount;
        if (empire !== undefined) {
            this.empire = empire;
        }
        this.reserved = reserved;
    }
}

// Port of CargoList.cs (subset). The C# list is keyed by (resource, empire);
// here items are plain entries and IndexOf filters on both.
export class CargoList {
    items: Cargo[] = [];

    // Port of CargoList.cs Add (line 183): cargo of the same empire and
    // resource merges into the existing entry (Amount and Reserved add up).
    // TODO(port): component cargo (CommodityComponent) — only resources here.
    add(cargo: Cargo): void {
        for (const c of this.items) {
            if (c.empire === cargo.empire && c.commodity.resourceId === cargo.commodity.resourceId) {
                c.amount += cargo.amount;
                c.reserved += cargo.reserved;
                return;
            }
        }
        this.items.push(cargo);
    }

    clear(): void {
        this.items = [];
    }

    remove(cargo: Cargo): boolean {
        const index = this.items.indexOf(cargo);
        if (index < 0) {
            return false;
        }
        this.items.splice(index, 1);
        return true;
    }

    // Port of CargoList.IndexOf(Resource, Empire): first entry carrying the
    // resource for the given empire, or -1.
    indexOf(resource: ResourceRef, empire: unknown): number {
        for (let i = 0; i < this.items.length; i++) {
            if (this.items[i].commodity.resourceId === resource.resourceId && this.items[i].empire === empire) {
                return i;
            }
        }
        return -1;
    }
}

// Port of TroopType.cs (byte enum, member order exact).
export enum TroopType {
    Undefined,
    Infantry,
    Armored,
    Artillery,
    SpecialForces,
    PirateRaider,
}

// Port of Troop.cs (task M3c): the constructor Troop(name, type, attackStrength,
// defendStrength, size, readiness, empire, race) (Troop.cs 92) and the property
// setters with side effects (BuiltObject / Colony, Troop.cs 134-158).
// Empire / BuiltObject / Habitat / Race are typed loosely to keep cargo.ts free of
// import cycles.
// TODO(port): CompareTo, Garrisoned/Readiness logic, OverallStrength etc.
export class Troop {
    name: string;
    private _type: TroopType;
    private _attackStrength: number; // short
    private _defendStrength: number; // short
    private _size: number; // short
    garrisoned = false;
    readiness: number; // float
    empire: ({ troops?: TroopList | null } & object) | null;
    awaitingPickup = false;
    private _atColony = false;
    private _builtObject: object | null = null;
    private _colony: object | null = null;
    race: object | null;
    pictureRef = 0;
    private _maintenanceMultiplier = 1; // float

    constructor(name: string, type: TroopType, attackStrength: number, defendStrength: number, size: number, readiness: number, empire: ({ troops?: TroopList | null } & object) | null, race: object | null) {
        this.name = name;
        this._type = type;
        this._attackStrength = toShort(attackStrength);
        this._defendStrength = toShort(defendStrength);
        this._size = toShort(size);
        this.readiness = Math.fround(readiness);
        this.empire = empire;
        this.race = race;
        this.awaitingPickup = false;
        this._maintenanceMultiplier = 1;
    }

    get type(): TroopType { return this._type; }
    get attackStrength(): number { return this._attackStrength; }
    get defendStrength(): number { return this._defendStrength; }
    get size(): number { return this._size; }
    get atColony(): boolean { return this._atColony; }
    get maintenanceMultiplier(): number { return this._maintenanceMultiplier; }
    set maintenanceMultiplier(v: number) { this._maintenanceMultiplier = Math.fround(v); }

    get builtObject(): object | null { return this._builtObject; }
    set builtObject(value: object | null) {
        this._builtObject = value;
        if (this._builtObject === null) return;
        this._atColony = false;
        this._colony = null;
    }

    get colony(): object | null { return this._colony; }
    set colony(value: object | null) {
        this._colony = value;
        if (this._colony === null) return;
        this._atColony = true;
        this._builtObject = null;
    }

    // Troop.cs SetAttackStrength / SetDefendStrength: (short) casts.
    setAttackStrength(attackStrength: number): void { this._attackStrength = toShort(attackStrength); }
    setDefendStrength(defendStrength: number): void { this._defendStrength = toShort(defendStrength); }
    // Troop.cs OverallAttackStrength / OverallDefendStrength / OverallDefendStrengthExcludeReadiness (double).
    get overallAttackStrength(): number { return this._attackStrength * this.readiness; }
    get overallDefendStrength(): number { return this._defendStrength * this.readiness; }
    get overallDefendStrengthExcludeReadiness(): number { return this._defendStrength * 100.0; }
    // Troop.cs BeingRecruited: _AtColony && _Colony.TroopsToRecruit.Contains(this).
    get beingRecruited(): boolean {
        const colony = this._colony as { troopsToRecruit?: TroopList | null } | null;
        return this._atColony && colony !== null && colony.troopsToRecruit != null && colony.troopsToRecruit.contains(this);
    }
}

// C# (short) cast: unchecked 16-bit wrap.
function toShort(v: number): number {
    return (Math.trunc(v) << 16) >> 16;
}

// Port of TroopList.cs (subset).
export class TroopList {
    items: Troop[] = [];

    add(troop: Troop): void {
        this.items.push(troop);
    }

    remove(troop: Troop): boolean {
        const index = this.items.indexOf(troop);
        if (index < 0) {
            return false;
        }
        this.items.splice(index, 1);
        return true;
    }

    // TroopList.cs TotalSize (485).
    get totalSize(): number {
        let totalSize = 0;
        for (const troop of this.items) totalSize += troop.size;
        return totalSize;
    }

    // --- troops.ts additions (TroopList.cs; SyncList Count / Contains / Clear) ---
    get count(): number { return this.items.length; }
    contains(troop: Troop): boolean { return this.items.indexOf(troop) >= 0; }
    clear(): void { this.items.length = 0; }

    // TroopList.cs CountByType(troopType) (186).
    countByType(troopType: TroopType): number {
        let num = 0;
        for (let index = 0; index < this.items.length; ++index) {
            const troop = this.items[index];
            if (troop != null && troop.type === troopType) ++num;
        }
        return num;
    }

    // TroopList.cs GetByType(troopType) (214).
    getByType(troopType: TroopType): TroopList {
        const byType = new TroopList();
        for (let index = 0; index < this.items.length; ++index) {
            const troop = this.items[index];
            if (troop != null && troop.type === troopType) byType.add(troop);
        }
        return byType;
    }

    // TroopList.cs TotalAttackStrength (285): (int) of a double sum of AttackStrength * Readiness.
    get totalAttackStrength(): number {
        let total = 0.0;
        for (const troop of this.items) total += troop.attackStrength * troop.readiness;
        return Math.trunc(total);
    }

    // TroopList.cs TotalDefendStrength (296).
    get totalDefendStrength(): number {
        let total = 0.0;
        for (const troop of this.items) total += troop.defendStrength * troop.readiness;
        return Math.trunc(total);
    }

    // TroopList.cs TotalDefendStrengthExcludeReadiness (307).
    get totalDefendStrengthExcludeReadiness(): number {
        let total = 0.0;
        for (const troop of this.items) total += troop.defendStrength * 100.0;
        return Math.trunc(total);
    }

    // TroopList.cs TotalDefendStrengthGarrisonedExcludeReadiness (360): int sum.
    get totalDefendStrengthGarrisonedExcludeReadiness(): number {
        let total = 0;
        for (const troop of this.items) if (troop.garrisoned) total += troop.defendStrength;
        return total;
    }
}