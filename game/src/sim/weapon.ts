// Ports of Weapon.cs (construction, ReviewValues, Reset, value accessors) and
// WeaponList.cs (task M3a). Firing (Weapon.Fire / FireInternal, which draw from
// Galaxy.Rnd) belongs to combat and is not ported yet.
// TODO(port): Weapon.Fire / FireInternal / IsAvailable — Weapon.cs (combat).

import { BuiltObjectComponent, ComponentStatus } from './builtObjectComponent';
import { componentImprovementFromComponent, type ComponentDefinition, type ComponentImprovementEntry } from './componentStatic';
import { ComponentType } from './data/components';
import { ComponentCategoryType } from './data/policies';

/** The Empire surface Weapon.ReviewValues needs (Empire.Research). */
export interface WeaponEmpire {
    readonly research: { resolveImprovedComponentValues(component: ComponentDefinition): ComponentImprovementEntry } | null;
}

function isSuperWeaponType(type: ComponentType): boolean {
    switch (type) {
        case ComponentType.WeaponSuperBeam:
        case ComponentType.WeaponSuperTorpedo:
        case ComponentType.WeaponSuperMissile:
        case ComponentType.WeaponSuperPhaser:
        case ComponentType.WeaponSuperRailGun:
            return true;
        default:
            return false;
    }
}

// Port of Weapon.cs.
export class Weapon {
    power = 0; // float
    headingMissFactor = 0; // float
    lastFired = 0; // DateTime (ticks)
    distanceTravelled = -1; // float
    distanceFromTarget = Math.fround(2e9); // float
    willHitTarget = false;
    x = -1.0;
    y = -1.0;
    heading = 0; // float
    hasMissed = false;
    private _isPlanetDestroyer = false;
    private _soundEffectPlayed = false;
    private _resetNext = false;
    private _builtObjectComponent: BuiltObjectComponent;
    target: unknown = null; // StellarObject
    targetWeapon: Weapon | null = null;
    /** C# [NonSerialized] public ComponentImprovement _ImprovedComponent. */
    _improvedComponent: ComponentImprovementEntry;

    private constructor(builtObjectComponent: BuiltObjectComponent, improved: ComponentImprovementEntry, isPlanetDestroyer: boolean) {
        this._builtObjectComponent = builtObjectComponent;
        this._improvedComponent = improved;
        this._isPlanetDestroyer = isPlanetDestroyer;
    }

    // Weapon(BuiltObjectComponent) (Weapon.cs 111). Note: the improved values are
    // the component's own (new ComponentImprovement(new Component(id))), not research's.
    static fromBuiltObjectComponent(builtObjectComponent: BuiltObjectComponent): Weapon {
        const C = ComponentCategoryType;
        const cat = builtObjectComponent.category;
        if (cat !== C.WeaponTorpedo && cat !== C.WeaponBeam && cat !== C.WeaponSuperArea && cat !== C.WeaponSuperBeam && cat !== C.WeaponSuperTorpedo && cat !== C.WeaponArea && cat !== C.WeaponPointDefense && cat !== C.WeaponIon && cat !== C.WeaponGravity && cat !== C.AssaultPod) {
            throw new Error('This component is not a weapon.');
        }
        let pd = false;
        if (isSuperWeaponType(builtObjectComponent.type) && builtObjectComponent.value1 >= 10000) pd = true;
        return new Weapon(builtObjectComponent, componentImprovementFromComponent(builtObjectComponent.def), pd);
    }

    // Weapon(ComponentImprovement) (Weapon.cs 131).
    static fromComponentImprovement(componentImprovement: ComponentImprovementEntry): Weapon {
        const improvedComponent = componentImprovement.improvedComponent;
        const category = improvedComponent.category;
        const type = improvedComponent.type;
        const num = improvedComponent.value1;
        const C = ComponentCategoryType;
        switch (category) {
            case C.WeaponBeam:
            case C.WeaponTorpedo:
            case C.WeaponArea:
            case C.WeaponPointDefense:
            case C.WeaponIon:
            case C.WeaponGravity:
            case C.AssaultPod:
            case C.WeaponSuperBeam:
            case C.WeaponSuperArea:
            case C.WeaponSuperTorpedo: {
                let pd = false;
                if (isSuperWeaponType(type) && num >= 10000) pd = true;
                return new Weapon(new BuiltObjectComponent(improvedComponent, ComponentStatus.Normal), componentImprovement, pd);
            }
            default:
                throw new Error('This component is not a weapon.');
        }
    }

    // Weapon.ReviewValues (Weapon.cs 166).
    reviewValues(empire: WeaponEmpire | null): void {
        const component = this._builtObjectComponent.def;
        if (empire !== null && empire.research !== null) this._improvedComponent = empire.research.resolveImprovedComponentValues(component);
        else this._improvedComponent = componentImprovementFromComponent(component);
    }

    // Weapon.Reset (Weapon.cs 300).
    reset(): void {
        this.distanceTravelled = -1;
        this.target = null;
        this.targetWeapon = null;
        this.x = -2000000100.0;
        this.y = -2000000100.0;
        this.heading = 0;
        this.headingMissFactor = 0;
        this.distanceFromTarget = Math.fround(2e9);
        this.willHitTarget = false;
        this.hasMissed = false;
        this.power = 0;
        this._soundEffectPlayed = false;
        this._resetNext = false;
    }

    get isPlanetDestroyer(): boolean { return this._isPlanetDestroyer; }
    set isPlanetDestroyer(v: boolean) { this._isPlanetDestroyer = v; }
    get component(): BuiltObjectComponent { return this._builtObjectComponent; }
    get rawDamage(): number { return this._improvedComponent.value1; }
    get range(): number { return this._improvedComponent.value2; }
    get energyRequired(): number { return this._improvedComponent.value3; }
    get speed(): number { return this._improvedComponent.value4; }
    get damageLoss(): number { return this._improvedComponent.value5; }
    get fireRate(): number { return this._improvedComponent.value6; }
    get bombardDamage(): number { return this._improvedComponent.value7; }
    get soundEffectPlayed(): boolean { return this._soundEffectPlayed; }
    set soundEffectPlayed(v: boolean) { this._soundEffectPlayed = v; }
    get resetNext(): boolean { return this._resetNext; }
    set resetNext(v: boolean) { this._resetNext = v; }
}

// WeaponList.QuickCompareEquivalent (WeaponList.cs 38).
export function weaponsQuickCompareEquivalent(list: Weapon[], weapons: Weapon[] | null): boolean {
    if (weapons === null || list.length !== weapons.length) return false;
    for (let i = 0; i < list.length; i++) {
        if (list[i].component.componentId !== weapons[i].component.componentId) return false;
    }
    return true;
}

// WeaponList.DetermineWeaponsNotInSuppliedList (WeaponList.cs 48).
export function weaponsDetermineNotInSuppliedList(list: Weapon[], weapons: Weapon[]): Weapon[] {
    const notInSuppliedList = list.slice();
    for (let index1 = 0; index1 < weapons.length; ++index1) {
        let index2 = -1;
        for (let index3 = 0; index3 < notInSuppliedList.length; ++index3) {
            if (notInSuppliedList[index3].component.componentId === weapons[index1].component.componentId) {
                index2 = index3;
                break;
            }
        }
        if (index2 >= 0) notInSuppliedList.splice(index2, 1);
        if (notInSuppliedList.length <= 0) break;
    }
    return notInSuppliedList;
}

// WeaponList.RemoveAndResetFirstMatchingWeaponById (WeaponList.cs 70).
export function weaponsRemoveAndResetFirstMatchingWeaponById(list: Weapon[], weaponToRemove: Weapon | null): void {
    if (weaponToRemove === null) return;
    let index1 = -1;
    for (let index2 = 0; index2 < list.length; ++index2) {
        const weapon = list[index2];
        if (weapon !== null && weapon.component.componentId === weaponToRemove.component.componentId) {
            index1 = index2;
            break;
        }
    }
    if (index1 < 0 || index1 >= list.length) return;
    list[index1].reset();
    list.splice(index1, 1);
}
