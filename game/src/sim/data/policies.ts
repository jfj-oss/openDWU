// Empire policy files (Policy/<race>.txt, Policy/pirate/<race>.txt).
// Only the research tech-focus fields are ported so far; they drive
// ResearchNodeDefinitionList.SetTechTreeStartingDefaults.
// Port of EmpirePolicy.cs LoadFromFile (229) / SetNameValuePair
// "ResearchDesignTechFocus1..6" and Galaxy.4.cs ResolveTechFocus (917) /
// ResolveTechFocuses (1030).
// TODO(port): the remaining EmpirePolicy fields.

import { ComponentType } from './components';

// Port of ComponentCategoryType.cs (enum member order exact).
export enum ComponentCategoryType {
    Undefined,
    WeaponBeam,
    WeaponTorpedo,
    WeaponArea,
    WeaponPointDefense,
    WeaponIon,
    WeaponGravity,
    Armor,
    AssaultPod,
    Fighter,
    Shields,
    ShieldRecharge,
    Engine,
    HyperDrive,
    HyperDisrupt,
    Reactor,
    EnergyCollector,
    Extractor,
    Manufacturer,
    Storage,
    Sensor,
    Computer,
    Labs,
    Construction,
    Habitation,
    WeaponSuperBeam,
    WeaponSuperArea,
    WeaponSuperTorpedo,
}

// Port of Galaxy.4.cs DetermineComponentCategoryByIndex (882): research.txt category column.
const CATEGORY_BY_INDEX: ComponentCategoryType[] = [
    ComponentCategoryType.Armor,
    ComponentCategoryType.AssaultPod,
    ComponentCategoryType.Computer,
    ComponentCategoryType.Construction,
    ComponentCategoryType.EnergyCollector,
    ComponentCategoryType.Engine,
    ComponentCategoryType.Extractor,
    ComponentCategoryType.Fighter,
    ComponentCategoryType.Habitation,
    ComponentCategoryType.HyperDisrupt,
    ComponentCategoryType.HyperDrive,
    ComponentCategoryType.Labs,
    ComponentCategoryType.Manufacturer,
    ComponentCategoryType.Reactor,
    ComponentCategoryType.Sensor,
    ComponentCategoryType.ShieldRecharge,
    ComponentCategoryType.Shields,
    ComponentCategoryType.Storage,
    ComponentCategoryType.WeaponArea,
    ComponentCategoryType.WeaponBeam,
    ComponentCategoryType.WeaponGravity,
    ComponentCategoryType.WeaponIon,
    ComponentCategoryType.WeaponPointDefense,
    ComponentCategoryType.WeaponSuperArea,
    ComponentCategoryType.WeaponSuperBeam,
    ComponentCategoryType.WeaponTorpedo,
    ComponentCategoryType.WeaponSuperTorpedo,
];
export function componentCategoryByIndex(index: number): ComponentCategoryType {
    return CATEGORY_BY_INDEX[index] ?? ComponentCategoryType.Undefined;
}

// Port of Galaxy.4.cs ResolveTechDisallow (592): race DisallowedResearchArea1..3.
export function resolveTechDisallow(index: number): ComponentCategoryType {
    switch (index) {
        case 1: return ComponentCategoryType.WeaponTorpedo;
        case 2: return ComponentCategoryType.WeaponPointDefense;
        case 3: return ComponentCategoryType.WeaponArea;
        case 4: return ComponentCategoryType.WeaponIon;
        case 5: return ComponentCategoryType.Fighter;
        case 6: return ComponentCategoryType.Armor;
        case 7: return ComponentCategoryType.HyperDisrupt;
        case 8: return ComponentCategoryType.Sensor;
        default: return ComponentCategoryType.Undefined;
    }
}

export interface TechFocus {
    category: ComponentCategoryType;
    type: ComponentType;
}

// Port of Galaxy.4.cs ResolveTechFocus (917).
export function resolveTechFocus(index: number): TechFocus {
    const C = ComponentCategoryType;
    const T = ComponentType;
    const cat = (category: ComponentCategoryType): TechFocus => ({ category, type: T.Undefined });
    const typ = (type: ComponentType): TechFocus => ({ category: C.Undefined, type });
    switch (index) {
        case 1: return cat(C.WeaponBeam);
        case 2: return typ(T.WeaponPhaser);
        case 3: return typ(T.WeaponRailGun);
        case 4: return cat(C.WeaponTorpedo);
        case 5: return typ(T.WeaponBombard);
        case 6: return typ(T.WeaponMissile);
        case 7: return cat(C.WeaponArea);
        case 8: return cat(C.WeaponIon);
        case 9: return cat(C.Fighter);
        case 10: return typ(T.Armor);
        case 11: return cat(C.Shields);
        case 12: return cat(C.Reactor);
        case 13: return typ(T.EngineMainThrust);
        case 14: return typ(T.EngineVectoring);
        case 15: return cat(C.HyperDrive);
        case 16: return cat(C.HyperDisrupt);
        case 17: return cat(C.Construction);
        case 18: return typ(T.DamageControl);
        case 19: return typ(T.ComputerTargetting);
        case 20: return typ(T.ComputerCountermeasures);
        case 21: return cat(C.Sensor);
        case 22: return typ(T.HabitationMedicalCenter);
        case 23: return typ(T.HabitationRecreationCenter);
        case 24: return typ(T.WeaponTractorBeam);
        case 25: return typ(T.AssaultPod);
        case 26: return typ(T.WeaponGravityBeam);
        case 27: return typ(T.WeaponAreaGravity);
        case 28: return typ(T.WeaponSuperBeam);
        case 29: return typ(T.WeaponSuperArea);
        case 30: return typ(T.WeaponSuperTorpedo);
        case 31: return typ(T.WeaponSuperMissile);
        case 32: return typ(T.WeaponSuperRailGun);
        case 33: return typ(T.WeaponSuperPhaser);
        default: return { category: C.Undefined, type: T.Undefined };
    }
}

export interface EmpirePolicy {
    /** ResearchDesignTechFocus1..6 (category + type per slot). */
    researchDesignTechFocus: TechFocus[];
}

export function defaultEmpirePolicy(): EmpirePolicy {
    return { researchDesignTechFocus: Array.from({ length: 6 }, () => ({ category: ComponentCategoryType.Undefined, type: ComponentType.Undefined })) };
}

// C# int.TryParse(NumberStyles.Any, Invariant) → 0 on failure.
function parseIntValue(value: string): number {
    const n = Number(value.trim());
    return Number.isInteger(n) ? n : 0;
}

// Port of EmpirePolicy.LoadFromFile: "name ;value" lines, "'" comments.
export function parseEmpirePolicy(text: string): EmpirePolicy {
    const policy = defaultEmpirePolicy();
    for (const line of text.split(/\r?\n/)) {
        if (line.trim() === '' || line.trim().substring(0, 1) === "'") continue;
        const i = line.indexOf(';');
        if (i < 0) continue;
        const name = line.substring(0, i).trim();
        const value = line.substring(i + 1).trim();
        const m = /^ResearchDesignTechFocus([1-6])$/.exec(name);
        if (m) policy.researchDesignTechFocus[Number(m[1]) - 1] = resolveTechFocus(parseIntValue(value));
    }
    return policy;
}

// Port of Galaxy.4.cs ResolveTechFocuses(policy): category wins over type per slot.
export function resolveTechFocuses(policy: EmpirePolicy | null): { categories: ComponentCategoryType[]; types: ComponentType[] } {
    const categories: ComponentCategoryType[] = [];
    const types: ComponentType[] = [];
    if (policy !== null) {
        for (const f of policy.researchDesignTechFocus) {
            if (f.category !== ComponentCategoryType.Undefined) categories.push(f.category);
            else if (f.type !== ComponentType.Undefined) types.push(f.type);
        }
    }
    return { categories, types };
}
