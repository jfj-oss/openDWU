// Port of Galaxy.4.cs Galaxy.ResolveTechFocus(int index, out ComponentCategoryType
// category, out ComponentType type): maps a ResearchDesignTechFocusN policy
// index to the (category, type) pair it names (exactly one of the two is set
// per index; both stay Undefined for index 0 or any unrecognized index).
// Pure function — no fs, no Galaxy state.

import { ComponentCategoryType } from './designTemplates';
import { ComponentType } from './components';

export interface TechFocus {
    category: ComponentCategoryType;
    type: ComponentType;
}

export function resolveTechFocus(index: number): TechFocus {
    let category = ComponentCategoryType.Undefined;
    let type = ComponentType.Undefined;
    switch (index) {
        case 1:
            category = ComponentCategoryType.WeaponBeam;
            break;
        case 2:
            type = ComponentType.WeaponPhaser;
            break;
        case 3:
            type = ComponentType.WeaponRailGun;
            break;
        case 4:
            category = ComponentCategoryType.WeaponTorpedo;
            break;
        case 5:
            type = ComponentType.WeaponBombard;
            break;
        case 6:
            type = ComponentType.WeaponMissile;
            break;
        case 7:
            category = ComponentCategoryType.WeaponArea;
            break;
        case 8:
            category = ComponentCategoryType.WeaponIon;
            break;
        case 9:
            category = ComponentCategoryType.Fighter;
            break;
        case 10:
            type = ComponentType.Armor;
            break;
        case 11:
            category = ComponentCategoryType.Shields;
            break;
        case 12:
            category = ComponentCategoryType.Reactor;
            break;
        case 13:
            type = ComponentType.EngineMainThrust;
            break;
        case 14:
            type = ComponentType.EngineVectoring;
            break;
        case 15:
            category = ComponentCategoryType.HyperDrive;
            break;
        case 16:
            category = ComponentCategoryType.HyperDisrupt;
            break;
        case 17:
            category = ComponentCategoryType.Construction;
            break;
        case 18:
            type = ComponentType.DamageControl;
            break;
        case 19:
            type = ComponentType.ComputerTargetting;
            break;
        case 20:
            type = ComponentType.ComputerCountermeasures;
            break;
        case 21:
            category = ComponentCategoryType.Sensor;
            break;
        case 22:
            type = ComponentType.HabitationMedicalCenter;
            break;
        case 23:
            type = ComponentType.HabitationRecreationCenter;
            break;
        case 24:
            type = ComponentType.WeaponTractorBeam;
            break;
        case 25:
            type = ComponentType.AssaultPod;
            break;
        case 26:
            type = ComponentType.WeaponGravityBeam;
            break;
        case 27:
            type = ComponentType.WeaponAreaGravity;
            break;
        case 28:
            type = ComponentType.WeaponSuperBeam;
            break;
        case 29:
            type = ComponentType.WeaponSuperArea;
            break;
        case 30:
            type = ComponentType.WeaponSuperTorpedo;
            break;
        case 31:
            type = ComponentType.WeaponSuperMissile;
            break;
        case 32:
            type = ComponentType.WeaponSuperRailGun;
            break;
        case 33:
            type = ComponentType.WeaponSuperPhaser;
            break;
    }
    return { category, type };
}
