// Ports of ComponentStatus.cs, BuiltObjectComponent.cs, BuiltObjectComponentList.cs
// (task M3a), plus the C# integer-narrowing helpers the ReDefine ports need.
//
// C# Component/BuiltObjectComponent only store ComponentID and read every other
// property through Galaxy.ComponentDefinitionsStatic[ComponentID] (Component.cs).
// Here the component keeps a reference to that same static ComponentDefinition.

import type { ComponentDefinition } from './componentStatic';
import type { ComponentType } from './data/components';
import type { ComponentCategoryType } from './data/policies';

// C# `(short)x` on an int (unchecked): keep the low 16 bits, sign-extended.
export function toShort(x: number): number {
    return (x << 16) >> 16;
}

// C# `(byte)x` on an int (unchecked): keep the low 8 bits.
export function toByte(x: number): number {
    return x & 0xff;
}

// C# `(int)d` for a double (truncation). Out-of-range / NaN values give
// int.MinValue on x86/x64 (cvttsd2si), which is what .NET produces there.
export function csInt(d: number): number {
    if (!Number.isFinite(d) || d >= 2147483648 || d <= -2147483649) return -2147483648;
    return Math.trunc(d) | 0;
}

// Port of ComponentStatus.cs (byte enum, member order exact).
export enum ComponentStatus {
    Unbuilt,
    Normal,
    Damaged,
}

// Port of BuiltObjectComponent.cs.
export class BuiltObjectComponent {
    /** Galaxy.ComponentDefinitionsStatic[ComponentID]. */
    readonly def: ComponentDefinition;
    status: ComponentStatus;
    // C#: short BuiltObjectComponentId = -1 (assigned by BuiltObjectComponentList.Add).
    builtObjectComponentId = -1;

    // BuiltObjectComponent(int componentID, ComponentStatus componentStatus).
    constructor(def: ComponentDefinition, status: ComponentStatus) {
        this.def = def;
        this.status = status;
    }

    // Component.cs accessors (all via Galaxy.ComponentDefinitionsStatic[ComponentID]).
    get componentId(): number { return this.def.componentId; }
    get type(): ComponentType { return this.def.type; }
    get category(): ComponentCategoryType { return this.def.category; }
    get energyUsed(): number { return this.def.energyUsed; }
    get size(): number { return this.def.size; }
    get techLevel(): number { return this.def.techLevel; }
    get specialImageIndex(): number { return this.def.specialImageIndex; }
    get value1(): number { return this.def.value1; }
    get value2(): number { return this.def.value2; }
    get value3(): number { return this.def.value3; }
    get value4(): number { return this.def.value4; }
    get value5(): number { return this.def.value5; }
    get value6(): number { return this.def.value6; }
    get value7(): number { return this.def.value7; }

    // BuiltObjectComponent.Damage / Repair.
    damage(): void { this.status = ComponentStatus.Damaged; }
    repair(): void { this.status = ComponentStatus.Normal; }
}

// Port of BuiltObjectComponentList.cs (the members BuiltObject's ctor/ReDefine use).
export class BuiltObjectComponentList {
    items: BuiltObjectComponent[] = [];

    get count(): number {
        return this.items.length;
    }

    // BuiltObjectComponentList.FindHighestBuiltObjectComponentId (206).
    private findHighestBuiltObjectComponentId(): number {
        let id = -1;
        for (const c of this.items) if (c.builtObjectComponentId > id) id = c.builtObjectComponentId;
        return id;
    }

    // BuiltObjectComponentList.Add (216): components without an id get highest + 1.
    add(component: BuiltObjectComponent): void {
        this.items.push(component);
        if (component.builtObjectComponentId >= 0) return;
        component.builtObjectComponentId = toShort(this.findHighestBuiltObjectComponentId() + 1);
    }

    // BuiltObjectComponentList.FindComponentByBuiltObjectComponentId (193).
    findComponentByBuiltObjectComponentId(builtObjectComponentId: number): BuiltObjectComponent | null {
        if (builtObjectComponentId >= 0) {
            for (const c of this.items) if (c.builtObjectComponentId === builtObjectComponentId) return c;
        }
        return null;
    }

    // BuiltObjectComponentList.UnbuiltComponentCount / DamagedComponentCount.
    get unbuiltComponentCount(): number {
        let n = 0;
        for (const c of this.items) if (c.status === ComponentStatus.Unbuilt) n++;
        return n;
    }
    get damagedComponentCount(): number {
        let n = 0;
        for (const c of this.items) if (c.status === ComponentStatus.Damaged) n++;
        return n;
    }

    // BuiltObjectComponentList.ContainsComponentId.
    containsComponentId(componentId: number): boolean {
        for (const c of this.items) if (c.componentId === componentId) return true;
        return false;
    }

    // BuiltObjectComponentList.CountNormalComponentsByType / ByCategory.
    countNormalComponentsByType(type: ComponentType): number {
        let n = 0;
        for (const c of this.items) if (c.type === type && c.status === ComponentStatus.Normal) n++;
        return n;
    }
    countNormalComponentsByCategory(category: ComponentCategoryType): number {
        let n = 0;
        for (const c of this.items) if (c.category === category && c.status === ComponentStatus.Normal) n++;
        return n;
    }
}
