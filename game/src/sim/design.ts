// Ship/base designs (task D2). Port of the parts of Design.cs / DesignList.cs
// that design generation needs: the component list and identity fields, the
// energy helpers used by PlaceComponentsOnDesign, IsEquivalent,
// QuickCalculateSize, and the DesignList Find* lookups, plus the Galaxy.8.cs
// DetermineLifeSupportRequired / DetermineHabModulesRequired helpers.
// TODO(port): Design.ReDefine (speeds, firepower, weapons, shields, price …).
// Until it lands, FirepowerRaw stays 0 and Weapons is empty, so IsPlanetDestroyer
// is false, exactly as for a C# design that has not been ReDefined.

import { BuiltObjectSubRole } from './builtObjectTypes';
import type { ComponentDefinition, ComponentImprovementEntry } from './componentStatic';
import { ComponentType } from './data/components';
import { ComponentCategoryType } from './data/policies';
import { BattleTactics, BuiltObjectFleeWhen, BuiltObjectRole, DesignImageScalingMode, InvasionTactics } from './data/designSpecifications';

// Port of BuiltObjectStance.cs (member order exact).
export enum BuiltObjectStance {
    Undefined,
    AttackUnallied,
    AttackEnemies,
    AttackIfAttacked,
    DoNotAttack,
}

/** Minimal owner surface Design needs (avoids importing Empire). */
export interface DesignOwner {
    readonly empireId: number;
}

export class Design {
    name: string;
    role: BuiltObjectRole = 0 as BuiltObjectRole;
    subRole: BuiltObjectSubRole = BuiltObjectSubRole.Undefined;
    components: ComponentDefinition[] = [];
    dateCreated = 0;
    empire: DesignOwner | null = null;
    imageScalingType: DesignImageScalingMode = 0 as DesignImageScalingMode;
    imageScalingFactor = 0;
    stance: BuiltObjectStance = BuiltObjectStance.Undefined;
    fleeWhen: BuiltObjectFleeWhen = 0 as BuiltObjectFleeWhen;
    tacticsStrongerShips: BattleTactics = 0 as BattleTactics;
    tacticsWeakerShips: BattleTactics = 0 as BattleTactics;
    tacticsInvasion: InvasionTactics = 0 as InvasionTactics;
    pictureRef = 0;
    size = 0;
    buildCount = 0;
    isObsolete = false;
    isManuallyCreated = false;
    optimizedDesign = 0;
    /** Set by ReDefine (not ported yet). */
    firepowerRaw = 0;

    // Design.cs Design(string name).
    constructor(name: string) {
        this.name = name;
    }

    /** Design.IsPlanetDestroyer: FirepowerRaw >= 10000 and a super weapon with RawDamage >= 10000 (needs ReDefine). */
    get isPlanetDestroyer(): boolean {
        return false; // TODO(port): Weapons list from ReDefine.
    }

    // Design.cs IsEquivalent (878): same component ids in the same order.
    isEquivalent(other: Design | null): boolean {
        if (other === null) return false;
        if (other.components.length !== this.components.length) return false;
        for (let i = 0; i < other.components.length; i++) {
            if (this.components[i].componentId !== other.components[i].componentId) return false;
        }
        return true;
    }

    // Design.cs QuickCalculateSize (1151).
    quickCalculateSize(): number {
        let num = 0;
        for (const c of this.components) num += c.size;
        return num;
    }
}

// Design.cs CalculateWeaponEnergyUsePerSecond (1078).
export function calculateWeaponEnergyUsePerSecond(weapon: ComponentImprovementEntry): number {
    return weapon.value6 > 0 ? weapon.value3 / (weapon.value6 / 1000.0) : 0.0;
}

// Design.cs DetermineComponentEnergyRequirements (992).
export function determineComponentEnergyRequirements(c: ComponentImprovementEntry): number {
    const T = ComponentType;
    switch (c.improvedComponent.type) {
        case T.WeaponBeam:
        case T.WeaponTorpedo:
        case T.WeaponBombard:
        case T.WeaponMissile:
        case T.WeaponPointDefense:
        case T.WeaponIonCannon:
        case T.WeaponIonPulse:
        case T.WeaponTractorBeam:
        case T.WeaponGravityBeam:
        case T.WeaponAreaGravity:
        case T.HyperDeny:
        case T.WeaponAreaDestruction:
        case T.WeaponSuperBeam:
        case T.WeaponSuperArea:
        case T.WeaponPhaser:
        case T.WeaponRailGun:
        case T.WeaponSuperTorpedo:
        case T.WeaponSuperMissile:
        case T.WeaponSuperPhaser:
        case T.WeaponSuperRailGun:
            return c.value6 > 0 ? calculateWeaponEnergyUsePerSecond(c) : c.improvedComponent.energyUsed;
        case T.EngineMainThrust:
            return c.value4;
        case T.EngineVectoring:
            return c.value2;
        case T.HyperDrive:
            return c.value2;
        default:
            return c.improvedComponent.energyUsed;
    }
}

// Design.cs DetermineComponentEnergyRequirementsExcludeHyperdrive (982).
export function determineComponentEnergyRequirementsExcludeHyperdrive(c: ComponentImprovementEntry): number {
    return c.improvedComponent.category !== ComponentCategoryType.HyperDrive ? determineComponentEnergyRequirements(c) : 0.0;
}

// Design.cs CalculateStaticEnergyUsage (1033).
export function calculateStaticEnergyUsage(components: ComponentDefinition[] | null): number {
    let num = 0.0;
    if (components !== null) for (const c of components) num += c.energyUsed;
    return num;
}

// Design.cs DetermineComponentEnergyOutput (1050): reactors only.
export function determineComponentEnergyOutput(c: ComponentImprovementEntry): number {
    return c.improvedComponent.category === ComponentCategoryType.Reactor ? c.value1 : 0.0;
}

// ComponentList.ResolveComponentCountsByType (270): counts indexed by component id.
export function resolveComponentCountsByType(components: ComponentDefinition[], componentCount: number): number[] {
    const counts = new Array<number>(componentCount).fill(0);
    for (const c of components) counts[c.componentId]++;
    return counts;
}

// ComponentList.GetFirstByType (93).
export function getFirstByType(components: ComponentDefinition[], type: ComponentType): ComponentDefinition | null {
    for (const c of components) if (c.type === type) return c;
    return null;
}

// Galaxy.8.cs DetermineLifeSupportRequired / DetermineHabModulesRequired (2261/2296):
// identical integer maths on the component's Value1 (bases count half their size).
function modulesRequired(component: ComponentImprovementEntry | null, designSize: number, designIsBase: boolean): number {
    let num = 0;
    let num2 = 0;
    if (component !== null) {
        const size = designIsBase ? Math.trunc(designSize / 2) : designSize;
        num = Math.trunc(size / component.value1) + 1;
        num2 = size % component.value1;
        if (num2 === 0) num--;
    }
    return num;
}
export function determineLifeSupportRequired(lifeSupport: ComponentImprovementEntry | null, design: Design): number {
    return modulesRequired(lifeSupport, design.quickCalculateSize(), design.role === BuiltObjectRole.Base);
}
export function determineHabModulesRequired(habModule: ComponentImprovementEntry | null, design: Design): number {
    return modulesRequired(habModule, design.quickCalculateSize(), design.role === BuiltObjectRole.Base);
}

// DesignList.cs FindNewest (83): newest non-obsolete design of the sub-role (DateCreated > 0).
export function findNewest(designs: Design[], subRole: BuiltObjectSubRole): Design | null {
    let num = 0;
    let newest: Design | null = null;
    for (const d of designs) {
        if (d.subRole === subRole && d.dateCreated > num && !d.isObsolete) {
            num = d.dateCreated;
            newest = d;
        }
    }
    return newest;
}

// DesignList.cs FindNewestIncludingObsolete (66) default overload.
export function findNewestIncludingObsolete(designs: Design[], subRole: BuiltObjectSubRole): Design | null {
    let num = 0;
    let newest: Design | null = null;
    for (const d of designs) {
        if (d.subRole === subRole && d.dateCreated > num) {
            num = d.dateCreated;
            newest = d;
        }
    }
    return newest;
}
