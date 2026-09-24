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

// TODO(port): Troop class (Troop.cs: race, strength, ...) — only the list
// wrapper is needed by the Empire constructors.
export interface Troop {
    [key: string]: unknown;
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
}