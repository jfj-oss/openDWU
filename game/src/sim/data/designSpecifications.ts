// Port of DesignSpecification.cs / DesignSpecificationComponentRule.cs /
// DesignSpecificationComponentRuleType.cs, plus the small enums they use
// (BattleTactics.cs, InvasionTactics.cs, BuiltObjectFleeWhen.cs,
// BuiltObjectRole.cs, DesignImageScalingMode.cs).
//
// Pure parsing — no fs/DOM. `ComponentType` comes from ./components and
// `ComponentCategoryType` from ./policies (not duplicated here).
// `BuiltObjectSubRole` lives in src/sim/builtObjectTypes.ts (no import cycle:
// that file has no imports of its own).

import { ComponentType } from './components';
import { ComponentCategoryType } from './policies';
import { resolveDataUrl } from './paths';
import { BuiltObjectSubRole } from '../builtObjectTypes';

// ---------------------------------------------------------------------------
// Enums (exact C# member order)
// ---------------------------------------------------------------------------

// Port of DesignSpecificationComponentRuleType.cs.
export enum DesignSpecificationComponentRuleType {
    MustNotHave,
    ShouldNotHave,
    ShouldHave,
    MustHave,
}

// Port of BattleTactics.cs.
export enum BattleTactics {
    Undefined,
    Evade,
    Standoff,
    AllWeapons,
    PointBlank,
}

// Port of InvasionTactics.cs.
export enum InvasionTactics {
    Undefined,
    DoNotInvade,
    InvadeWhenClear,
    InvadeImmediately,
}

// Port of BuiltObjectFleeWhen.cs.
export enum BuiltObjectFleeWhen {
    Undefined,
    EnemyMilitarySighted,
    Attacked,
    Shields50,
    Shields20,
    Never,
    Armor50,
}

// Port of BuiltObjectRole.cs. Not defined anywhere else in src/, so it lives
// here (DesignSpecification.Role is the only consumer ported so far).
export enum BuiltObjectRole {
    Undefined,
    Military,
    Exploration,
    Freight,
    Passenger,
    Colony,
    Build,
    Resource,
    Base,
}

// Port of DesignImageScalingMode.cs.
export enum DesignImageScalingMode {
    None,
    Absolute,
    Scaled,
}

// ---------------------------------------------------------------------------
// DesignSpecificationComponentRule.cs
// ---------------------------------------------------------------------------

export interface DesignSpecificationComponentRule {
    componentRuleType: DesignSpecificationComponentRuleType;
    componentCategory: ComponentCategoryType;
    componentType: ComponentType;
    amount: number;
}

// Port of ComponentDefinition.cs ResolveComponentCategory (line 271):
// used by the DesignSpecificationComponentRule(ruleType, componentType,
// amount) constructor to fill in ComponentCategory.
export function resolveComponentCategoryForType(componentType: ComponentType): ComponentCategoryType {
    switch (componentType) {
        case ComponentType.WeaponBeam:
        case ComponentType.WeaponPhaser:
        case ComponentType.WeaponRailGun:
            return ComponentCategoryType.WeaponBeam;
        case ComponentType.WeaponTorpedo:
        case ComponentType.WeaponBombard:
        case ComponentType.WeaponMissile:
            return ComponentCategoryType.WeaponTorpedo;
        case ComponentType.WeaponPointDefense:
            return ComponentCategoryType.WeaponPointDefense;
        case ComponentType.WeaponIonCannon:
        case ComponentType.WeaponIonPulse:
        case ComponentType.WeaponIonDefense:
            return ComponentCategoryType.WeaponIon;
        case ComponentType.WeaponTractorBeam:
        case ComponentType.WeaponGravityBeam:
        case ComponentType.WeaponAreaGravity:
            return ComponentCategoryType.WeaponGravity;
        case ComponentType.AssaultPod:
            return ComponentCategoryType.AssaultPod;
        case ComponentType.HyperDeny:
        case ComponentType.HyperStop:
            return ComponentCategoryType.HyperDisrupt;
        case ComponentType.WeaponAreaDestruction:
            return ComponentCategoryType.WeaponArea;
        case ComponentType.WeaponSuperBeam:
        case ComponentType.WeaponSuperPhaser:
        case ComponentType.WeaponSuperRailGun:
            return ComponentCategoryType.WeaponSuperBeam;
        case ComponentType.WeaponSuperArea:
            return ComponentCategoryType.WeaponSuperArea;
        case ComponentType.FighterBay:
            return ComponentCategoryType.Fighter;
        case ComponentType.Armor:
            return ComponentCategoryType.Armor;
        case ComponentType.Shields:
            return ComponentCategoryType.Shields;
        case ComponentType.ShieldRecharge:
            return ComponentCategoryType.ShieldRecharge;
        case ComponentType.EngineMainThrust:
        case ComponentType.EngineVectoring:
            return ComponentCategoryType.Engine;
        case ComponentType.HyperDrive:
            return ComponentCategoryType.HyperDrive;
        case ComponentType.Reactor:
            return ComponentCategoryType.Reactor;
        case ComponentType.EnergyCollector:
        case ComponentType.EnergyToFuel:
            return ComponentCategoryType.EnergyCollector;
        case ComponentType.ExtractorMine:
        case ComponentType.ExtractorGasExtractor:
        case ComponentType.ExtractorLuxury:
            return ComponentCategoryType.Extractor;
        case ComponentType.ManufacturerWeaponsPlant:
        case ComponentType.ManufacturerEnergyPlant:
        case ComponentType.ManufacturerHighTechPlant:
            return ComponentCategoryType.Manufacturer;
        case ComponentType.StorageFuel:
        case ComponentType.StorageCargo:
        case ComponentType.StorageTroop:
        case ComponentType.StoragePassenger:
        case ComponentType.StorageDockingBay:
            return ComponentCategoryType.Storage;
        case ComponentType.SensorProximityArray:
        case ComponentType.SensorResourceProfileSensor:
        case ComponentType.SensorLongRange:
        case ComponentType.SensorTraceScanner:
        case ComponentType.SensorScannerJammer:
        case ComponentType.SensorStealth:
            return ComponentCategoryType.Sensor;
        case ComponentType.ComputerTargetting:
        case ComponentType.ComputerTargettingFleet:
        case ComponentType.ComputerCountermeasures:
        case ComponentType.ComputerCountermeasuresFleet:
        case ComponentType.ComputerCommandCenter:
        case ComponentType.ComputerCommerceCenter:
            return ComponentCategoryType.Computer;
        case ComponentType.LabsWeaponsLab:
        case ComponentType.LabsEnergyLab:
        case ComponentType.LabsHighTechLab:
            return ComponentCategoryType.Labs;
        case ComponentType.ConstructionBuild:
        case ComponentType.DamageControl:
            return ComponentCategoryType.Construction;
        case ComponentType.HabitationLifeSupport:
        case ComponentType.HabitationHabModule:
        case ComponentType.HabitationMedicalCenter:
        case ComponentType.HabitationRecreationCenter:
        case ComponentType.HabitationColonization:
            return ComponentCategoryType.Habitation;
        case ComponentType.WeaponSuperTorpedo:
        case ComponentType.WeaponSuperMissile:
            return ComponentCategoryType.WeaponSuperTorpedo;
        default:
            // C# throws ApplicationException("Unknown component type."); a data
            // file with an unrecognized component name never reaches this path
            // (ResolveComponentTypeFromName already filters to known types), so
            // Undefined is a safe non-throwing fallback here.
            return ComponentCategoryType.Undefined;
    }
}

// Port of the DesignSpecificationComponentRule(ruleType, ComponentCategoryType, amount) ctor.
export function newComponentRuleByCategory(
    componentRuleType: DesignSpecificationComponentRuleType,
    componentCategory: ComponentCategoryType,
    amount: number,
): DesignSpecificationComponentRule {
    return { componentRuleType, componentCategory, componentType: ComponentType.Undefined, amount };
}

// Port of the DesignSpecificationComponentRule(ruleType, ComponentType, amount) ctor.
export function newComponentRuleByType(
    componentRuleType: DesignSpecificationComponentRuleType,
    componentType: ComponentType,
    amount: number,
): DesignSpecificationComponentRule {
    return {
        componentRuleType,
        componentType,
        componentCategory: resolveComponentCategoryForType(componentType),
        amount,
    };
}

// ---------------------------------------------------------------------------
// DesignSpecification.cs
// ---------------------------------------------------------------------------

export interface DesignSpecification {
    // BuiltObjectSubRole value (see file header note on why this is `number`).
    subRole: BuiltObjectSubRole;
    role: BuiltObjectRole;
    componentRules: DesignSpecificationComponentRule[];
    mobile: boolean;
    imageScalingMode: DesignImageScalingMode;
    imageScalingFactor: number;
    tacticsStronger: BattleTactics;
    tacticsWeaker: BattleTactics;
    tacticsInvasion: InvasionTactics;
    fleeWhen: BuiltObjectFleeWhen;
}

// Port of DesignSpecification.cs ResolveRole (line 96).
export function resolveBuiltObjectRole(subRole: BuiltObjectSubRole): BuiltObjectRole {
    switch (subRole) {
        case BuiltObjectSubRole.Escort:
        case BuiltObjectSubRole.Frigate:
        case BuiltObjectSubRole.Destroyer:
        case BuiltObjectSubRole.Cruiser:
        case BuiltObjectSubRole.CapitalShip:
        case BuiltObjectSubRole.TroopTransport:
        case BuiltObjectSubRole.Carrier:
        case BuiltObjectSubRole.ResupplyShip:
            return BuiltObjectRole.Military;
        case BuiltObjectSubRole.ExplorationShip:
            return BuiltObjectRole.Exploration;
        case BuiltObjectSubRole.SmallFreighter:
        case BuiltObjectSubRole.MediumFreighter:
        case BuiltObjectSubRole.LargeFreighter:
            return BuiltObjectRole.Freight;
        case BuiltObjectSubRole.ColonyShip:
            return BuiltObjectRole.Colony;
        case BuiltObjectSubRole.PassengerShip:
            return BuiltObjectRole.Passenger;
        case BuiltObjectSubRole.ConstructionShip:
            return BuiltObjectRole.Build;
        case BuiltObjectSubRole.GasMiningShip:
        case BuiltObjectSubRole.MiningShip:
            return BuiltObjectRole.Resource;
        case BuiltObjectSubRole.GasMiningStation:
        case BuiltObjectSubRole.MiningStation:
        case BuiltObjectSubRole.SmallSpacePort:
        case BuiltObjectSubRole.MediumSpacePort:
        case BuiltObjectSubRole.LargeSpacePort:
        case BuiltObjectSubRole.ResortBase:
        case BuiltObjectSubRole.GenericBase:
        case BuiltObjectSubRole.EnergyResearchStation:
        case BuiltObjectSubRole.WeaponsResearchStation:
        case BuiltObjectSubRole.HighTechResearchStation:
        case BuiltObjectSubRole.MonitoringStation:
        case BuiltObjectSubRole.DefensiveBase:
            return BuiltObjectRole.Base;
        default:
            // C# throws ApplicationException("Unknown built object sub role type.")
            // for BuiltObjectSubRole.Undefined (the only member not covered
            // above); Undefined is used instead so the data layer never
            // throws on a caller-supplied value.
            return BuiltObjectRole.Undefined;
    }
}

// Port of the DesignSpecification(BuiltObjectSubRole subRole, bool mobile) ctor.
export function newDesignSpecification(subRole: BuiltObjectSubRole, mobile: boolean): DesignSpecification {
    return {
        subRole,
        role: resolveBuiltObjectRole(subRole),
        componentRules: [],
        mobile,
        // [OptionalField] defaults from the C# field initializers.
        imageScalingMode: DesignImageScalingMode.None,
        imageScalingFactor: 1,
        tacticsStronger: BattleTactics.Undefined,
        tacticsWeaker: BattleTactics.Undefined,
        tacticsInvasion: InvasionTactics.Undefined,
        fleeWhen: BuiltObjectFleeWhen.Undefined,
    };
}

// Port of DesignSpecification.cs ResolveComponentTypeFromName (line ~430).
// componentName must already be lower-cased by the caller (as C# does with
// str4.ToLower(CultureInfo.InvariantCulture)).
function resolveComponentTypeFromName(
    componentName: string,
): { type: ComponentType; category: ComponentCategoryType } {
    let type = ComponentType.Undefined;
    let category = ComponentCategoryType.Undefined;
    switch (componentName) {
        case 'weaponarea': type = ComponentType.WeaponAreaDestruction; break;
        case 'weaponbeam': category = ComponentCategoryType.WeaponBeam; break;
        case 'weapontorpedo': category = ComponentCategoryType.WeaponTorpedo; break;
        case 'weaponmissile': type = ComponentType.WeaponMissile; break;
        case 'weaponbombard': type = ComponentType.WeaponBombard; break;
        case 'weaponphaser': type = ComponentType.WeaponPhaser; break;
        case 'weaponrailgun': type = ComponentType.WeaponRailGun; break;
        case 'weapontractorbeam': type = ComponentType.WeaponTractorBeam; break;
        case 'weapongravitonbeam': type = ComponentType.WeaponGravityBeam; break;
        case 'weaponareagravity': type = ComponentType.WeaponAreaGravity; break;
        case 'assaultpod': category = ComponentCategoryType.AssaultPod; break;
        case 'pointdefense': category = ComponentCategoryType.WeaponPointDefense; break;
        case 'ioncannon': type = ComponentType.WeaponIonCannon; break;
        case 'ionpulse': type = ComponentType.WeaponIonPulse; break;
        case 'iondefense': type = ComponentType.WeaponIonDefense; break;
        case 'hyperdeny': type = ComponentType.HyperDeny; break;
        case 'gravitywellprojector': type = ComponentType.HyperStop; break;
        case 'weaponsuperbeam': type = ComponentType.WeaponSuperBeam; break;
        case 'weaponsupertorpedo': type = ComponentType.WeaponSuperTorpedo; break;
        case 'weaponsuperrailgun': type = ComponentType.WeaponSuperRailGun; break;
        case 'weaponsuperphaser': type = ComponentType.WeaponSuperPhaser; break;
        case 'weaponsupermissile': type = ComponentType.WeaponSuperMissile; break;
        case 'fighterbay': type = ComponentType.FighterBay; break;
        case 'armor': type = ComponentType.Armor; break;
        case 'shields': category = ComponentCategoryType.Shields; break;
        case 'areashieldrecharge': category = ComponentCategoryType.ShieldRecharge; break;
        case 'engine': type = ComponentType.EngineMainThrust; break;
        case 'vectoringengine': type = ComponentType.EngineVectoring; break;
        case 'hyperdrive': category = ComponentCategoryType.HyperDrive; break;
        case 'reactor': category = ComponentCategoryType.Reactor; break;
        case 'energycollector': type = ComponentType.EnergyCollector; break;
        case 'energytofuelconverter': type = ComponentType.EnergyToFuel; break;
        case 'miningengine': type = ComponentType.ExtractorMine; break;
        case 'gasextractor': type = ComponentType.ExtractorGasExtractor; break;
        case 'luxuryresourceextractor': type = ComponentType.ExtractorLuxury; break;
        case 'weaponsmanufacturingplant': type = ComponentType.ManufacturerWeaponsPlant; break;
        case 'energymanufacturingplant': type = ComponentType.ManufacturerEnergyPlant; break;
        case 'hightechmanufacturingplant': type = ComponentType.ManufacturerHighTechPlant; break;
        case 'fuelcell': type = ComponentType.StorageFuel; break;
        case 'cargobay': type = ComponentType.StorageCargo; break;
        case 'troopcompartment': type = ComponentType.StorageTroop; break;
        case 'passengercompartment': type = ComponentType.StoragePassenger; break;
        case 'dockingbay': type = ComponentType.StorageDockingBay; break;
        case 'proximityarray': type = ComponentType.SensorProximityArray; break;
        case 'resourceprofilesensor': type = ComponentType.SensorResourceProfileSensor; break;
        case 'longrangescanner': type = ComponentType.SensorLongRange; break;
        case 'tracescanner': type = ComponentType.SensorTraceScanner; break;
        case 'scannerjammer': type = ComponentType.SensorScannerJammer; break;
        case 'stealthcloak': type = ComponentType.SensorStealth; break;
        case 'combattargettingsystem': type = ComponentType.ComputerTargetting; break;
        case 'countermeasuressystem': type = ComponentType.ComputerCountermeasures; break;
        case 'commandcenter': type = ComponentType.ComputerCommandCenter; break;
        case 'commercecenter': type = ComponentType.ComputerCommerceCenter; break;
        case 'fleettargettingsystem': type = ComponentType.ComputerTargettingFleet; break;
        case 'fleetcountermeasuressystem': type = ComponentType.ComputerCountermeasuresFleet; break;
        case 'weaponsresearchlab': type = ComponentType.LabsWeaponsLab; break;
        case 'energyresearchlab': type = ComponentType.LabsEnergyLab; break;
        case 'hightechresearchlab': type = ComponentType.LabsHighTechLab; break;
        case 'constructionyard': type = ComponentType.ConstructionBuild; break;
        case 'damagecontrol': type = ComponentType.DamageControl; break;
        case 'lifesupport': type = ComponentType.HabitationLifeSupport; break;
        case 'habmodule': type = ComponentType.HabitationHabModule; break;
        case 'medicalcenter': type = ComponentType.HabitationMedicalCenter; break;
        case 'recreationcenter': type = ComponentType.HabitationRecreationCenter; break;
        case 'colonizationmodule': type = ComponentType.HabitationColonization; break;
        default: break;
    }
    return { type, category };
}

function stripBom(text: string): string {
    return text.length > 0 && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

const TACTICS_MAP: Record<string, BattleTactics> = {
    evade: BattleTactics.Evade,
    standoff: BattleTactics.Standoff,
    allweapons: BattleTactics.AllWeapons,
    pointblank: BattleTactics.PointBlank,
};

const INVASION_TACTICS_MAP: Record<string, InvasionTactics> = {
    donotinvade: InvasionTactics.DoNotInvade,
    invadewhenclear: InvasionTactics.InvadeWhenClear,
    invadeimmediately: InvasionTactics.InvadeImmediately,
};

const FLEE_WHEN_MAP: Record<string, BuiltObjectFleeWhen> = {
    enemymilitarysighted: BuiltObjectFleeWhen.EnemyMilitarySighted,
    attacked: BuiltObjectFleeWhen.Attacked,
    shields50: BuiltObjectFleeWhen.Shields50,
    shields20: BuiltObjectFleeWhen.Shields20,
    armor50: BuiltObjectFleeWhen.Armor50,
    never: BuiltObjectFleeWhen.Never,
};

// Port of DesignSpecification.cs LoadFromFile (line ~230 onward — the file
// parsing loop itself, after the candidate path has already been chosen and
// read). `path` is only used in thrown error messages, matching the C#
// ApplicationException text (which names the file).
export function parseDesignSpecification(
    text: string,
    subRole: BuiltObjectSubRole,
    isMobile: boolean,
    path = '<design template>',
): DesignSpecification {
    const spec = newDesignSpecification(subRole, isMobile);
    // C#: designSpecification.ComponentRules.Add(new DesignSpecificationComponentRule(MustHave, ComponentType.ComputerCommandCenter, 1));
    spec.componentRules.push(newComponentRuleByType(DesignSpecificationComponentRuleType.MustHave, ComponentType.ComputerCommandCenter, 1));
    if (isMobile) {
        // C#: if (isMobile) ... Add(new DesignSpecificationComponentRule(MustHave, ComponentCategoryType.HyperDrive, 1));
        spec.componentRules.push(newComponentRuleByCategory(DesignSpecificationComponentRuleType.MustHave, ComponentCategoryType.HyperDrive, 1));
    }

    const lines = stripBom(text).split(/\r\n|\r|\n/);
    let lineNumber = 0;
    for (const line of lines) {
        lineNumber++;
        if (line == null || line.trim() === '' || line.trim().substring(0, 1) === "'") continue;

        const semiIndex = line.indexOf(';');
        if (semiIndex < 0) continue;
        const key = line.substring(0, semiIndex).trim();
        const value = line.substring(semiIndex + 1).trim();
        const keyLower = key.toLowerCase();

        if (keyLower === 'tacticsweaker') {
            spec.tacticsWeaker = TACTICS_MAP[value.trim().toLowerCase()] ?? BattleTactics.Undefined;
        } else if (keyLower === 'tacticsstronger') {
            spec.tacticsStronger = TACTICS_MAP[value.trim().toLowerCase()] ?? BattleTactics.Undefined;
        } else if (keyLower === 'tacticsinvasion') {
            spec.tacticsInvasion = INVASION_TACTICS_MAP[value.trim().toLowerCase()] ?? InvasionTactics.Undefined;
        } else if (keyLower === 'fleewhen') {
            spec.fleeWhen = FLEE_WHEN_MAP[value.trim().toLowerCase()] ?? BuiltObjectFleeWhen.Undefined;
        } else if (keyLower === 'imagescaling') {
            const ABSOLUTE = 'absolute';
            const SCALED = 'scaled';
            const valueLower = value.toLowerCase();
            let mode: DesignImageScalingMode;
            let factor: number;
            if (valueLower.startsWith(ABSOLUTE)) {
                mode = DesignImageScalingMode.Absolute;
                const numStr = value.substring(ABSOLUTE.length).trim();
                factor = Number(numStr);
                if (numStr === '' || Number.isNaN(factor)) {
                    throw new Error(`Error reading Image Scaling Factor in line ${lineNumber} of file ${path}`);
                }
                if (factor < 10 || factor > 1000) {
                    throw new Error(`Invalid Image Scaling Factor (when mode is Absolute should be between 10 and 1000) in line ${lineNumber} of file ${path}`);
                }
            } else if (valueLower.startsWith(SCALED)) {
                mode = DesignImageScalingMode.Scaled;
                const numStr = value.substring(SCALED.length).trim();
                factor = Number(numStr);
                if (numStr === '' || Number.isNaN(factor)) {
                    throw new Error(`Error reading Image Scaling Factor in line ${lineNumber} of file ${path}`);
                }
                if (factor < 0.05 || factor > 10) {
                    throw new Error(`Invalid Image Scaling Factor (when mode is Scaled should be between 0.05 and 10.0) in line ${lineNumber} of file ${path}`);
                }
            } else {
                throw new Error(`Invalid Image Scaling Mode (should be Absolute or Scaled) in line ${lineNumber} of file ${path}`);
            }
            spec.imageScalingMode = mode;
            spec.imageScalingFactor = factor;
        } else {
            const amount = Number(value);
            // C#: int.TryParse(s, out result) && result > 0 — a fractional or
            // non-integer string fails TryParse in C#, so require an integer here too.
            if (Number.isInteger(amount) && amount > 0 && /^-?\d+$/.test(value)) {
                const { type, category } = resolveComponentTypeFromName(keyLower);
                // C#: components already accounted for above (command center, hyperdrive)
                // are skipped if repeated in the file.
                if (type !== ComponentType.ComputerCommandCenter && category !== ComponentCategoryType.HyperDrive) {
                    if (type !== ComponentType.Undefined) {
                        spec.componentRules.push(newComponentRuleByType(DesignSpecificationComponentRuleType.MustHave, type, amount));
                    } else if (category !== ComponentCategoryType.Undefined) {
                        spec.componentRules.push(newComponentRuleByCategory(DesignSpecificationComponentRuleType.MustHave, category, amount));
                    }
                }
            }
        }
    }
    return spec;
}

// ---------------------------------------------------------------------------
// Galaxy.DesignSpecifications — port of the hardcoded default table built in
// Galaxy's static constructor (Galaxy.3.cs, lines ~4960-5721: from
// `DesignSpecifications = new DesignSpecificationList();` through the last
// `DesignSpecifications.Add(...)`). C#'s LoadFromFile falls back to
// `Galaxy.DesignSpecifications.GetBySubRole(subRole)` whenever no template
// file exists for a race (or when race is null); this table is that
// fallback, ported rule-for-rule and in the same Add() order.
// ---------------------------------------------------------------------------

// Port of the two shared `DesignSpecificationComponentRuleList` locals
// (Galaxy.3.cs ~5162-5170) that mobile/base specs start from via AddRange.
// Order matters (it is the order rules end up in ComponentRules).
function mobileBaseRules(): DesignSpecificationComponentRule[] {
    return [
        newComponentRuleByCategory(DesignSpecificationComponentRuleType.MustHave, ComponentCategoryType.HyperDrive, 1),
        newComponentRuleByType(DesignSpecificationComponentRuleType.MustHave, ComponentType.ComputerCommandCenter, 1),
    ];
}
function stationaryBaseRules(): DesignSpecificationComponentRule[] {
    return [
        newComponentRuleByType(DesignSpecificationComponentRuleType.MustHave, ComponentType.ComputerCommandCenter, 1),
    ];
}

const MH = DesignSpecificationComponentRuleType.MustHave;
const SH = DesignSpecificationComponentRuleType.ShouldHave;

// Shorthand ports of `new DesignSpecificationComponentRule(ruleType, ComponentType.X, n)`.
function rt(rule: DesignSpecificationComponentRuleType, type: ComponentType, amount: number): DesignSpecificationComponentRule {
    return newComponentRuleByType(rule, type, amount);
}
// Shorthand ports of `new DesignSpecificationComponentRule(ruleType, ComponentCategoryType.X, n)`.
function rc(rule: DesignSpecificationComponentRuleType, category: ComponentCategoryType, amount: number): DesignSpecificationComponentRule {
    return newComponentRuleByCategory(rule, category, amount);
}

// Port of Galaxy.3.cs static ctor, lines ~4960-5721.
export function buildDefaultDesignSpecifications(): DesignSpecification[] {
    const list: DesignSpecification[] = [];
    const add = (subRole: BuiltObjectSubRole, mobile: boolean, rules: DesignSpecificationComponentRule[]) => {
        const spec = newDesignSpecification(subRole, mobile);
        spec.componentRules.push(...rules);
        list.push(spec);
    };

    add(BuiltObjectSubRole.SmallSpacePort, false, [
        ...stationaryBaseRules(),
        rc(MH, ComponentCategoryType.Reactor, 1),
        rt(MH, ComponentType.StorageFuel, 2),
        rt(MH, ComponentType.StorageDockingBay, 6),
        rt(MH, ComponentType.StorageCargo, 6),
        rt(MH, ComponentType.EnergyCollector, 4),
        rt(MH, ComponentType.ComputerCommerceCenter, 1),
        rt(MH, ComponentType.ConstructionBuild, 3),
        rt(MH, ComponentType.HabitationMedicalCenter, 1),
        rt(MH, ComponentType.HabitationRecreationCenter, 1),
        rt(MH, ComponentType.LabsEnergyLab, 1),
        rt(MH, ComponentType.LabsHighTechLab, 1),
        rt(MH, ComponentType.LabsWeaponsLab, 1),
        rt(MH, ComponentType.ManufacturerEnergyPlant, 1),
        rt(MH, ComponentType.ManufacturerHighTechPlant, 1),
        rt(MH, ComponentType.ManufacturerWeaponsPlant, 1),
        rt(MH, ComponentType.DamageControl, 1),
        rt(SH, ComponentType.SensorProximityArray, 1),
        rt(MH, ComponentType.ComputerTargetting, 1),
        rt(MH, ComponentType.ComputerCountermeasures, 1),
        rt(MH, ComponentType.Armor, 15),
        rc(MH, ComponentCategoryType.Shields, 10),
        rc(MH, ComponentCategoryType.WeaponBeam, 12),
        rc(SH, ComponentCategoryType.WeaponTorpedo, 6),
        rc(MH, ComponentCategoryType.WeaponPointDefense, 4),
        rt(MH, ComponentType.WeaponIonDefense, 1),
    ]);

    add(BuiltObjectSubRole.MediumSpacePort, false, [
        ...stationaryBaseRules(),
        rc(MH, ComponentCategoryType.Reactor, 2),
        rt(MH, ComponentType.StorageFuel, 4),
        rt(MH, ComponentType.StorageDockingBay, 12),
        rt(MH, ComponentType.StorageCargo, 6),
        rt(MH, ComponentType.EnergyCollector, 6),
        rt(MH, ComponentType.ComputerCommerceCenter, 1),
        rt(MH, ComponentType.ConstructionBuild, 6),
        rt(MH, ComponentType.HabitationMedicalCenter, 1),
        rt(MH, ComponentType.HabitationRecreationCenter, 1),
        rt(MH, ComponentType.LabsEnergyLab, 3),
        rt(MH, ComponentType.LabsHighTechLab, 3),
        rt(MH, ComponentType.LabsWeaponsLab, 3),
        rt(MH, ComponentType.ManufacturerEnergyPlant, 2),
        rt(MH, ComponentType.ManufacturerHighTechPlant, 2),
        rt(MH, ComponentType.ManufacturerWeaponsPlant, 2),
        rt(MH, ComponentType.SensorProximityArray, 1),
        rt(MH, ComponentType.SensorTraceScanner, 1),
        rt(MH, ComponentType.DamageControl, 1),
        rt(MH, ComponentType.SensorLongRange, 1),
        rt(SH, ComponentType.EnergyToFuel, 1),
        rt(MH, ComponentType.ComputerTargetting, 1),
        rt(MH, ComponentType.ComputerCountermeasures, 1),
        rt(SH, ComponentType.HyperStop, 1),
        rt(MH, ComponentType.Armor, 30),
        rc(MH, ComponentCategoryType.Shields, 20),
        rt(SH, ComponentType.ShieldRecharge, 1),
        rt(MH, ComponentType.FighterBay, 2),
        rc(MH, ComponentCategoryType.WeaponBeam, 20),
        rc(MH, ComponentCategoryType.WeaponPointDefense, 8),
        rt(MH, ComponentType.WeaponIonCannon, 1),
        rt(MH, ComponentType.WeaponIonDefense, 1),
        rc(MH, ComponentCategoryType.WeaponTorpedo, 12),
        rt(MH, ComponentType.WeaponAreaDestruction, 1),
    ]);

    add(BuiltObjectSubRole.LargeSpacePort, false, [
        ...stationaryBaseRules(),
        rc(MH, ComponentCategoryType.Reactor, 4),
        rt(MH, ComponentType.StorageFuel, 8),
        rt(MH, ComponentType.StorageDockingBay, 24),
        rt(MH, ComponentType.StorageCargo, 8),
        rt(MH, ComponentType.EnergyCollector, 10),
        rt(MH, ComponentType.ComputerCommerceCenter, 1),
        rt(MH, ComponentType.ConstructionBuild, 12),
        rt(MH, ComponentType.HabitationMedicalCenter, 1),
        rt(MH, ComponentType.HabitationRecreationCenter, 1),
        rt(MH, ComponentType.LabsEnergyLab, 4),
        rt(MH, ComponentType.LabsHighTechLab, 4),
        rt(MH, ComponentType.LabsWeaponsLab, 4),
        rt(MH, ComponentType.ManufacturerEnergyPlant, 4),
        rt(MH, ComponentType.ManufacturerHighTechPlant, 4),
        rt(MH, ComponentType.ManufacturerWeaponsPlant, 4),
        rt(MH, ComponentType.SensorProximityArray, 1),
        rt(MH, ComponentType.SensorLongRange, 1),
        rt(MH, ComponentType.SensorTraceScanner, 1),
        rt(SH, ComponentType.EnergyToFuel, 1),
        rt(MH, ComponentType.ComputerTargetting, 1),
        rt(MH, ComponentType.ComputerCountermeasures, 1),
        rt(SH, ComponentType.HyperStop, 1),
        rt(MH, ComponentType.Armor, 60),
        rc(MH, ComponentCategoryType.Shields, 32),
        rt(MH, ComponentType.ShieldRecharge, 1),
        rt(MH, ComponentType.FighterBay, 4),
        rc(MH, ComponentCategoryType.WeaponBeam, 30),
        rc(MH, ComponentCategoryType.WeaponPointDefense, 12),
        rt(MH, ComponentType.WeaponIonCannon, 2),
        rt(MH, ComponentType.WeaponIonDefense, 1),
        rc(MH, ComponentCategoryType.WeaponTorpedo, 20),
        rt(MH, ComponentType.DamageControl, 2),
        rt(MH, ComponentType.WeaponAreaDestruction, 1),
        rt(SH, ComponentType.WeaponSuperArea, 1),
        rt(SH, ComponentType.WeaponSuperBeam, 1),
    ]);

    add(BuiltObjectSubRole.ResortBase, false, [
        ...stationaryBaseRules(),
        rc(MH, ComponentCategoryType.Reactor, 2),
        rt(MH, ComponentType.StorageFuel, 4),
        rt(MH, ComponentType.StorageDockingBay, 8),
        rt(MH, ComponentType.StorageCargo, 8),
        rt(MH, ComponentType.StoragePassenger, 10),
        rt(MH, ComponentType.EnergyCollector, 5),
        rt(MH, ComponentType.ComputerCommerceCenter, 1),
        rt(SH, ComponentType.HabitationMedicalCenter, 1),
        rt(MH, ComponentType.HabitationRecreationCenter, 1),
        rt(MH, ComponentType.SensorProximityArray, 1),
        rt(MH, ComponentType.DamageControl, 1),
        rt(MH, ComponentType.ComputerTargetting, 1),
        rt(MH, ComponentType.ComputerCountermeasures, 1),
        rt(MH, ComponentType.Armor, 10),
        rc(MH, ComponentCategoryType.Shields, 10),
        rc(MH, ComponentCategoryType.WeaponBeam, 8),
        rc(MH, ComponentCategoryType.WeaponPointDefense, 4),
        rc(SH, ComponentCategoryType.WeaponTorpedo, 4),
    ]);

    add(BuiltObjectSubRole.EnergyResearchStation, false, [
        rt(MH, ComponentType.ComputerCommandCenter, 1),
        rc(MH, ComponentCategoryType.Reactor, 1),
        rt(MH, ComponentType.StorageFuel, 2),
        rt(MH, ComponentType.StorageDockingBay, 1),
        rt(MH, ComponentType.StorageCargo, 4),
        rt(MH, ComponentType.EnergyCollector, 4),
        rt(MH, ComponentType.LabsEnergyLab, 6),
        rt(SH, ComponentType.HabitationMedicalCenter, 1),
        rt(SH, ComponentType.HabitationRecreationCenter, 1),
        rt(MH, ComponentType.SensorProximityArray, 1),
        rt(MH, ComponentType.ComputerTargetting, 1),
        rt(MH, ComponentType.ComputerCountermeasures, 1),
        rt(MH, ComponentType.Armor, 4),
        rc(MH, ComponentCategoryType.Shields, 4),
        rc(SH, ComponentCategoryType.WeaponBeam, 2),
        rt(MH, ComponentType.DamageControl, 1),
        rt(SH, ComponentType.SensorStealth, 1),
    ]);

    add(BuiltObjectSubRole.WeaponsResearchStation, false, [
        rt(MH, ComponentType.ComputerCommandCenter, 1),
        rc(MH, ComponentCategoryType.Reactor, 1),
        rt(MH, ComponentType.StorageFuel, 2),
        rt(MH, ComponentType.StorageDockingBay, 1),
        rt(MH, ComponentType.StorageCargo, 4),
        rt(MH, ComponentType.EnergyCollector, 4),
        rt(MH, ComponentType.LabsWeaponsLab, 6),
        rt(SH, ComponentType.HabitationMedicalCenter, 1),
        rt(SH, ComponentType.HabitationRecreationCenter, 1),
        rt(MH, ComponentType.SensorProximityArray, 1),
        rt(MH, ComponentType.ComputerTargetting, 1),
        rt(MH, ComponentType.ComputerCountermeasures, 1),
        rt(MH, ComponentType.Armor, 4),
        rc(MH, ComponentCategoryType.Shields, 4),
        rc(SH, ComponentCategoryType.WeaponBeam, 2),
        rt(MH, ComponentType.DamageControl, 1),
        rt(SH, ComponentType.SensorStealth, 1),
    ]);

    add(BuiltObjectSubRole.HighTechResearchStation, false, [
        rt(MH, ComponentType.ComputerCommandCenter, 1),
        rc(MH, ComponentCategoryType.Reactor, 1),
        rt(MH, ComponentType.StorageFuel, 2),
        rt(MH, ComponentType.StorageDockingBay, 1),
        rt(MH, ComponentType.StorageCargo, 4),
        rt(MH, ComponentType.EnergyCollector, 4),
        rt(MH, ComponentType.LabsHighTechLab, 6),
        rt(SH, ComponentType.HabitationMedicalCenter, 1),
        rt(SH, ComponentType.HabitationRecreationCenter, 1),
        rt(MH, ComponentType.SensorProximityArray, 1),
        rt(MH, ComponentType.ComputerTargetting, 1),
        rt(MH, ComponentType.ComputerCountermeasures, 1),
        rt(MH, ComponentType.Armor, 4),
        rc(MH, ComponentCategoryType.Shields, 4),
        rc(SH, ComponentCategoryType.WeaponBeam, 2),
        rt(MH, ComponentType.DamageControl, 1),
        rt(SH, ComponentType.SensorStealth, 1),
    ]);

    add(BuiltObjectSubRole.MonitoringStation, false, [
        rt(MH, ComponentType.ComputerCommandCenter, 1),
        rc(MH, ComponentCategoryType.Reactor, 2),
        rt(MH, ComponentType.StorageFuel, 2),
        rt(MH, ComponentType.StorageDockingBay, 1),
        rt(MH, ComponentType.StorageCargo, 4),
        rt(MH, ComponentType.EnergyCollector, 3),
        rt(MH, ComponentType.ComputerCommerceCenter, 1),
        rt(MH, ComponentType.SensorProximityArray, 1),
        rt(MH, ComponentType.ComputerTargetting, 1),
        rt(MH, ComponentType.ComputerCountermeasures, 1),
        rt(MH, ComponentType.SensorLongRange, 1),
        rt(MH, ComponentType.Armor, 6),
        rc(MH, ComponentCategoryType.Shields, 6),
        rc(SH, ComponentCategoryType.WeaponBeam, 6),
        rt(MH, ComponentType.DamageControl, 1),
        rt(SH, ComponentType.SensorStealth, 1),
    ]);

    add(BuiltObjectSubRole.DefensiveBase, false, [
        rt(MH, ComponentType.ComputerCommandCenter, 1),
        rc(MH, ComponentCategoryType.Reactor, 3),
        rt(MH, ComponentType.StorageFuel, 4),
        rt(MH, ComponentType.StorageDockingBay, 1),
        rt(MH, ComponentType.StorageCargo, 6),
        rt(MH, ComponentType.EnergyCollector, 2),
        rt(SH, ComponentType.SensorTraceScanner, 1),
        rt(MH, ComponentType.ComputerTargetting, 1),
        rt(MH, ComponentType.ComputerCountermeasures, 1),
        rt(MH, ComponentType.Armor, 30),
        rc(MH, ComponentCategoryType.Shields, 16),
        rt(SH, ComponentType.ShieldRecharge, 1),
        rt(MH, ComponentType.FighterBay, 2),
        rc(MH, ComponentCategoryType.WeaponBeam, 20),
        rc(MH, ComponentCategoryType.WeaponPointDefense, 10),
        rt(MH, ComponentType.WeaponIonCannon, 2),
        rt(MH, ComponentType.WeaponIonDefense, 1),
        rc(MH, ComponentCategoryType.WeaponTorpedo, 12),
        rc(SH, ComponentCategoryType.WeaponArea, 1),
        rt(MH, ComponentType.DamageControl, 1),
    ]);

    add(BuiltObjectSubRole.ResupplyShip, true, [
        ...mobileBaseRules(),
        rc(MH, ComponentCategoryType.Reactor, 3),
        rt(MH, ComponentType.EngineMainThrust, 16),
        rt(MH, ComponentType.EngineVectoring, 2),
        rt(MH, ComponentType.StorageFuel, 10),
        rt(MH, ComponentType.StorageCargo, 20),
        rt(MH, ComponentType.StorageDockingBay, 10),
        rt(MH, ComponentType.EnergyCollector, 4),
        rt(MH, ComponentType.ExtractorGasExtractor, 4),
        rt(SH, ComponentType.SensorResourceProfileSensor, 1),
        rt(MH, ComponentType.DamageControl, 1),
        rt(MH, ComponentType.ComputerCountermeasures, 1),
        rt(MH, ComponentType.ComputerTargetting, 1),
        rt(MH, ComponentType.SensorProximityArray, 1),
        rt(MH, ComponentType.SensorLongRange, 1),
        rc(MH, ComponentCategoryType.Shields, 10),
        rt(MH, ComponentType.FighterBay, 2),
        rc(MH, ComponentCategoryType.WeaponBeam, 12),
        rc(MH, ComponentCategoryType.WeaponPointDefense, 6),
        rt(SH, ComponentType.WeaponIonPulse, 1),
        rt(MH, ComponentType.WeaponIonDefense, 1),
        rc(MH, ComponentCategoryType.WeaponTorpedo, 6),
        rc(MH, ComponentCategoryType.Armor, 20),
    ]);

    add(BuiltObjectSubRole.ColonyShip, true, [
        ...mobileBaseRules(),
        rc(MH, ComponentCategoryType.Reactor, 1),
        rt(MH, ComponentType.EngineMainThrust, 10),
        rt(MH, ComponentType.EngineVectoring, 1),
        rt(MH, ComponentType.StorageFuel, 4),
        rt(MH, ComponentType.HabitationColonization, 1),
        rt(SH, ComponentType.SensorResourceProfileSensor, 1),
        rc(MH, ComponentCategoryType.Shields, 2),
        rt(MH, ComponentType.Armor, 2),
    ]);

    add(BuiltObjectSubRole.PassengerShip, true, [
        ...mobileBaseRules(),
        rc(MH, ComponentCategoryType.Reactor, 1),
        rt(MH, ComponentType.EngineMainThrust, 7),
        rt(MH, ComponentType.EngineVectoring, 1),
        rt(MH, ComponentType.StorageFuel, 4),
        rt(MH, ComponentType.EnergyCollector, 1),
        rt(MH, ComponentType.StoragePassenger, 10),
        rc(MH, ComponentCategoryType.Shields, 2),
        rt(MH, ComponentType.Armor, 2),
    ]);

    add(BuiltObjectSubRole.ConstructionShip, true, [
        ...mobileBaseRules(),
        rc(MH, ComponentCategoryType.Reactor, 2),
        rt(MH, ComponentType.EngineMainThrust, 10),
        rt(MH, ComponentType.EngineVectoring, 1),
        rt(MH, ComponentType.StorageFuel, 8),
        rt(MH, ComponentType.StorageCargo, 8),
        rt(MH, ComponentType.ConstructionBuild, 1),
        rt(MH, ComponentType.StorageDockingBay, 1),
        rt(MH, ComponentType.EnergyCollector, 3),
        rt(MH, ComponentType.ManufacturerEnergyPlant, 1),
        rt(MH, ComponentType.ManufacturerHighTechPlant, 1),
        rt(MH, ComponentType.ManufacturerWeaponsPlant, 1),
        rc(MH, ComponentCategoryType.Shields, 4),
        rc(MH, ComponentCategoryType.Armor, 2),
    ]);

    add(BuiltObjectSubRole.ExplorationShip, true, [
        ...mobileBaseRules(),
        rc(MH, ComponentCategoryType.Reactor, 1),
        rt(MH, ComponentType.EngineMainThrust, 8),
        rt(MH, ComponentType.EngineVectoring, 2),
        rt(MH, ComponentType.StorageFuel, 5),
        rt(MH, ComponentType.EnergyCollector, 1),
        rt(MH, ComponentType.SensorResourceProfileSensor, 1),
        rt(MH, ComponentType.SensorProximityArray, 1),
        rc(MH, ComponentCategoryType.Shields, 1),
        rt(MH, ComponentType.Armor, 1),
    ]);

    add(BuiltObjectSubRole.SmallFreighter, true, [
        ...mobileBaseRules(),
        rc(MH, ComponentCategoryType.Reactor, 1),
        rt(MH, ComponentType.EngineMainThrust, 4),
        rt(MH, ComponentType.EngineVectoring, 1),
        rt(MH, ComponentType.StorageFuel, 3),
        rt(MH, ComponentType.StorageCargo, 3),
        rt(MH, ComponentType.EnergyCollector, 1),
        rt(MH, ComponentType.Armor, 1),
        rc(MH, ComponentCategoryType.Shields, 1),
        rc(MH, ComponentCategoryType.WeaponBeam, 1),
    ]);

    add(BuiltObjectSubRole.MediumFreighter, true, [
        ...mobileBaseRules(),
        rc(MH, ComponentCategoryType.Reactor, 1),
        rt(MH, ComponentType.EngineMainThrust, 5),
        rt(MH, ComponentType.EngineVectoring, 1),
        rt(MH, ComponentType.StorageFuel, 3),
        rt(MH, ComponentType.StorageCargo, 6),
        rt(MH, ComponentType.EnergyCollector, 1),
        rt(MH, ComponentType.Armor, 1),
        rc(MH, ComponentCategoryType.Shields, 1),
        rc(MH, ComponentCategoryType.WeaponBeam, 1),
    ]);

    add(BuiltObjectSubRole.LargeFreighter, true, [
        ...mobileBaseRules(),
        rc(MH, ComponentCategoryType.Reactor, 1),
        rt(MH, ComponentType.EngineMainThrust, 5),
        rt(MH, ComponentType.EngineVectoring, 2),
        rt(MH, ComponentType.StorageFuel, 4),
        rt(MH, ComponentType.StorageCargo, 10),
        rt(MH, ComponentType.EnergyCollector, 1),
        rt(MH, ComponentType.Armor, 1),
        rc(MH, ComponentCategoryType.Shields, 2),
        rc(MH, ComponentCategoryType.WeaponBeam, 1),
    ]);

    add(BuiltObjectSubRole.Escort, true, [
        ...mobileBaseRules(),
        rc(MH, ComponentCategoryType.Reactor, 1),
        rc(MH, ComponentCategoryType.Shields, 1),
        rc(MH, ComponentCategoryType.WeaponBeam, 2),
        rc(MH, ComponentCategoryType.Armor, 3),
        rt(MH, ComponentType.EngineMainThrust, 6),
        rt(MH, ComponentType.EngineVectoring, 1),
        rt(MH, ComponentType.StorageFuel, 2),
        rt(MH, ComponentType.EnergyCollector, 1),
        rt(MH, ComponentType.DamageControl, 1),
        rt(MH, ComponentType.WeaponIonDefense, 1),
        rt(MH, ComponentType.ComputerCountermeasures, 1),
        rt(MH, ComponentType.ComputerTargetting, 1),
        rt(MH, ComponentType.SensorProximityArray, 1),
    ]);

    add(BuiltObjectSubRole.Frigate, true, [
        ...mobileBaseRules(),
        rc(MH, ComponentCategoryType.Reactor, 1),
        rc(MH, ComponentCategoryType.Shields, 2),
        rc(MH, ComponentCategoryType.WeaponBeam, 5),
        rc(MH, ComponentCategoryType.Armor, 6),
        rt(MH, ComponentType.EngineMainThrust, 8),
        rt(MH, ComponentType.EngineVectoring, 2),
        rt(MH, ComponentType.StorageFuel, 3),
        rt(MH, ComponentType.EnergyCollector, 1),
        rt(MH, ComponentType.DamageControl, 1),
        rt(MH, ComponentType.WeaponIonDefense, 1),
        rc(MH, ComponentCategoryType.WeaponPointDefense, 1),
        rt(MH, ComponentType.ComputerCountermeasures, 1),
        rt(MH, ComponentType.ComputerTargetting, 1),
        rt(MH, ComponentType.SensorProximityArray, 1),
    ]);

    add(BuiltObjectSubRole.Destroyer, true, [
        ...mobileBaseRules(),
        rc(MH, ComponentCategoryType.Reactor, 1),
        rc(MH, ComponentCategoryType.Shields, 3),
        rc(MH, ComponentCategoryType.WeaponBeam, 6),
        rc(MH, ComponentCategoryType.Armor, 10),
        rt(MH, ComponentType.EngineMainThrust, 7),
        rt(MH, ComponentType.EngineVectoring, 2),
        rt(MH, ComponentType.StorageFuel, 3),
        rt(MH, ComponentType.EnergyCollector, 1),
        rt(MH, ComponentType.DamageControl, 1),
        rt(MH, ComponentType.WeaponIonDefense, 1),
        rc(MH, ComponentCategoryType.WeaponPointDefense, 2),
        rc(MH, ComponentCategoryType.WeaponTorpedo, 2),
        rt(MH, ComponentType.ComputerCountermeasures, 1),
        rt(MH, ComponentType.ComputerTargetting, 1),
        rt(MH, ComponentType.SensorProximityArray, 1),
        rt(MH, ComponentType.StorageTroop, 1),
    ]);

    add(BuiltObjectSubRole.Cruiser, true, [
        ...mobileBaseRules(),
        rc(MH, ComponentCategoryType.Reactor, 2),
        rc(MH, ComponentCategoryType.Shields, 5),
        rc(MH, ComponentCategoryType.WeaponBeam, 8),
        rc(MH, ComponentCategoryType.Armor, 20),
        rt(MH, ComponentType.EngineMainThrust, 10),
        rt(MH, ComponentType.EngineVectoring, 2),
        rt(MH, ComponentType.StorageFuel, 5),
        rt(MH, ComponentType.EnergyCollector, 1),
        rc(MH, ComponentCategoryType.WeaponPointDefense, 4),
        rc(MH, ComponentCategoryType.WeaponTorpedo, 4),
        rt(MH, ComponentType.ComputerCountermeasures, 1),
        rt(MH, ComponentType.ComputerTargetting, 1),
        rt(MH, ComponentType.ComputerTargettingFleet, 1),
        rt(MH, ComponentType.ComputerCountermeasuresFleet, 1),
        rt(MH, ComponentType.SensorProximityArray, 1),
        rt(MH, ComponentType.StorageTroop, 1),
        rt(MH, ComponentType.DamageControl, 1),
        rt(MH, ComponentType.WeaponIonDefense, 1),
        rt(MH, ComponentType.FighterBay, 1),
    ]);

    add(BuiltObjectSubRole.CapitalShip, true, [
        ...mobileBaseRules(),
        rc(MH, ComponentCategoryType.Reactor, 3),
        rc(MH, ComponentCategoryType.Shields, 8),
        rt(MH, ComponentType.ShieldRecharge, 1),
        rc(MH, ComponentCategoryType.WeaponBeam, 12),
        rc(MH, ComponentCategoryType.Armor, 30),
        rt(MH, ComponentType.EngineMainThrust, 12),
        rt(MH, ComponentType.EngineVectoring, 3),
        rt(MH, ComponentType.StorageFuel, 6),
        rt(MH, ComponentType.EnergyCollector, 1),
        rc(MH, ComponentCategoryType.WeaponPointDefense, 8),
        rt(MH, ComponentType.WeaponIonCannon, 1),
        rc(MH, ComponentCategoryType.WeaponTorpedo, 6),
        rt(MH, ComponentType.HyperDeny, 1),
        rt(MH, ComponentType.ComputerCountermeasures, 1),
        rt(MH, ComponentType.ComputerTargetting, 1),
        rt(MH, ComponentType.ComputerTargettingFleet, 1),
        rt(MH, ComponentType.ComputerCountermeasuresFleet, 1),
        rt(MH, ComponentType.SensorProximityArray, 1),
        rt(MH, ComponentType.SensorTraceScanner, 1),
        rt(MH, ComponentType.StorageTroop, 2),
        rt(MH, ComponentType.DamageControl, 2),
        rt(MH, ComponentType.WeaponIonDefense, 1),
        rt(SH, ComponentType.HabitationMedicalCenter, 1),
        rt(MH, ComponentType.FighterBay, 2),
    ]);

    add(BuiltObjectSubRole.TroopTransport, true, [
        ...mobileBaseRules(),
        rc(MH, ComponentCategoryType.Reactor, 1),
        rt(MH, ComponentType.EngineMainThrust, 8),
        rt(MH, ComponentType.EngineVectoring, 1),
        rt(MH, ComponentType.StorageFuel, 3),
        rt(MH, ComponentType.EnergyCollector, 1),
        rc(MH, ComponentCategoryType.Armor, 20),
        rc(MH, ComponentCategoryType.Shields, 5),
        rc(MH, ComponentCategoryType.WeaponBeam, 2),
        rc(MH, ComponentCategoryType.WeaponPointDefense, 1),
        rt(MH, ComponentType.StorageTroop, 4),
        rt(SH, ComponentType.HabitationMedicalCenter, 1),
        rt(MH, ComponentType.DamageControl, 1),
        rt(MH, ComponentType.WeaponIonDefense, 1),
        rt(MH, ComponentType.ComputerCountermeasures, 1),
        rt(MH, ComponentType.SensorScannerJammer, 1),
    ]);

    add(BuiltObjectSubRole.Carrier, true, [
        ...mobileBaseRules(),
        rc(MH, ComponentCategoryType.Reactor, 2),
        rc(MH, ComponentCategoryType.Shields, 6),
        rc(MH, ComponentCategoryType.WeaponBeam, 2),
        rc(MH, ComponentCategoryType.Armor, 20),
        rt(MH, ComponentType.EngineMainThrust, 12),
        rt(MH, ComponentType.EngineVectoring, 2),
        rt(MH, ComponentType.StorageFuel, 5),
        rt(MH, ComponentType.EnergyCollector, 1),
        rc(MH, ComponentCategoryType.WeaponPointDefense, 8),
        rt(MH, ComponentType.ComputerCountermeasures, 1),
        rt(MH, ComponentType.ComputerTargetting, 1),
        rt(SH, ComponentType.ComputerTargettingFleet, 1),
        rt(SH, ComponentType.ComputerCountermeasuresFleet, 1),
        rt(MH, ComponentType.SensorProximityArray, 1),
        rt(SH, ComponentType.SensorTraceScanner, 1),
        rt(MH, ComponentType.DamageControl, 2),
        rt(MH, ComponentType.WeaponIonDefense, 1),
        rt(MH, ComponentType.FighterBay, 5),
    ]);

    add(BuiltObjectSubRole.GasMiningStation, false, [
        ...stationaryBaseRules(),
        rc(MH, ComponentCategoryType.Reactor, 1),
        rt(MH, ComponentType.ComputerCommerceCenter, 1),
        rt(MH, ComponentType.StorageFuel, 2),
        rt(MH, ComponentType.StorageDockingBay, 4),
        rt(MH, ComponentType.StorageCargo, 20),
        rt(MH, ComponentType.EnergyCollector, 3),
        rt(MH, ComponentType.ExtractorGasExtractor, 2),
        rt(MH, ComponentType.ExtractorLuxury, 1),
        rc(MH, ComponentCategoryType.WeaponBeam, 2),
        rc(MH, ComponentCategoryType.Shields, 2),
        rt(MH, ComponentType.Armor, 2),
    ]);

    add(BuiltObjectSubRole.MiningStation, false, [
        ...stationaryBaseRules(),
        rc(MH, ComponentCategoryType.Reactor, 1),
        rt(MH, ComponentType.ComputerCommerceCenter, 1),
        rt(MH, ComponentType.StorageFuel, 2),
        rt(MH, ComponentType.StorageDockingBay, 3),
        rt(MH, ComponentType.StorageCargo, 20),
        rt(MH, ComponentType.EnergyCollector, 3),
        rt(MH, ComponentType.ExtractorMine, 2),
        rt(MH, ComponentType.ExtractorLuxury, 1),
        rc(MH, ComponentCategoryType.WeaponBeam, 2),
        rc(MH, ComponentCategoryType.Shields, 2),
        rt(MH, ComponentType.Armor, 2),
    ]);

    add(BuiltObjectSubRole.GasMiningShip, true, [
        ...mobileBaseRules(),
        rc(MH, ComponentCategoryType.Reactor, 1),
        rt(MH, ComponentType.EngineMainThrust, 4),
        rt(MH, ComponentType.EngineVectoring, 1),
        rt(MH, ComponentType.StorageFuel, 3),
        rt(MH, ComponentType.EnergyCollector, 1),
        rt(MH, ComponentType.ExtractorGasExtractor, 1),
        rt(MH, ComponentType.ExtractorLuxury, 1),
        rt(MH, ComponentType.StorageCargo, 1),
        rc(MH, ComponentCategoryType.Armor, 1),
        rc(MH, ComponentCategoryType.Shields, 1),
    ]);

    add(BuiltObjectSubRole.MiningShip, true, [
        ...mobileBaseRules(),
        rc(MH, ComponentCategoryType.Reactor, 1),
        rt(MH, ComponentType.EngineMainThrust, 4),
        rt(MH, ComponentType.EngineVectoring, 1),
        rt(MH, ComponentType.StorageFuel, 3),
        rt(MH, ComponentType.EnergyCollector, 1),
        rt(MH, ComponentType.ExtractorMine, 1),
        rt(MH, ComponentType.ExtractorLuxury, 1),
        rt(MH, ComponentType.StorageCargo, 1),
        rc(MH, ComponentCategoryType.Armor, 1),
        rc(MH, ComponentCategoryType.Shields, 1),
    ]);

    return list;
}

let defaultDesignSpecificationsCache: DesignSpecification[] | null = null;
function defaultDesignSpecifications(): DesignSpecification[] {
    if (!defaultDesignSpecificationsCache) defaultDesignSpecificationsCache = buildDefaultDesignSpecifications();
    return defaultDesignSpecificationsCache;
}

// Port of DesignSpecificationList.GetBySubRole: a linear scan returning the
// *first* match's *same instance* (not a clone) — mirrored here by returning
// the same array element. Returns null when no spec has that SubRole (which
// never happens for the table above — Undefined and GenericBase are the
// only BuiltObjectSubRole values absent from it — but is possible for a
// caller-supplied custom list).
export function getDefaultDesignSpecificationBySubRole(
    list: DesignSpecification[],
    subRole: BuiltObjectSubRole,
): DesignSpecification | null {
    for (const spec of list) {
        if (spec.subRole === subRole) return spec;
    }
    return null;
}

// ---------------------------------------------------------------------------
// File path selection — port of DesignSpecification.cs LoadFromFile's path
// construction (lines ~192-215).
//
// C# priority order:
//   pirate:     customPath/<race>/pirate/<sub>.txt  (if customPath set and exists)
//            >  appPath/<race>/pirate/<sub>.txt
//            >  appPath/<race>/<sub>.txt                      (pirate file missing)
//   non-pirate: customPath/<race>/<sub>.txt         (if customPath set and exists)
//            >  appPath/<race>/<sub>.txt
//
// Note: unlike C# (case-insensitive on Windows), the served asset tree here
// (public/assets/dwu/designTemplates/...) uses lower-cased race and sub-role
// folder/file names, so raceNameOverride and subRoleName are lower-cased
// when building these paths.
//
// The decompiled LoadFromFile has NO "DEFAULT" race folder fallback: if the
// chosen file (per the priority order above) doesn't exist, or race is null,
// it falls straight to Galaxy.DesignSpecifications.GetBySubRole(subRole) (or
// null when standAlone) — see loadDesignSpecification below.
// ---------------------------------------------------------------------------

// Canonical (customization-set-independent) relative file paths to try, in
// priority order, for a given sub role / race / pirate combination.
/** designSpecificationTexts marker: the C# resolution found no file for this key (themes only, see data/gameData.ts). */
export const DESIGN_SPECIFICATION_MISSING = '\u0000missing';

export function designSpecificationFallbackFiles(
    subRoleName: string,
    raceNameOverride: string,
    isPirate: boolean,
): string[] {
    const race = raceNameOverride.toLowerCase();
    const sub = subRoleName.toLowerCase();
    const files: string[] = [];
    if (isPirate) {
        files.push(`designTemplates/${race}/pirate/${sub}.txt`);
        files.push(`designTemplates/${race}/${sub}.txt`);
    } else {
        files.push(`designTemplates/${race}/${sub}.txt`);
    }
    return files;
}

// Browser-fetch candidate URLs, in try order, honoring the customization set
// override the same way every other ./data loader does (resolveDataUrl).
export function designSpecificationCandidatePaths(
    subRoleName: string,
    raceNameOverride: string,
    isPirate: boolean,
    customizationSet?: string,
): string[] {
    if (!raceNameOverride || raceNameOverride.trim() === '') return [];
    const files = designSpecificationFallbackFiles(subRoleName, raceNameOverride, isPirate);
    return files.flatMap((file) => resolveDataUrl(file, customizationSet));
}

// Port of DesignSpecification.LoadFromFile, given a prefetched map of
// { canonical relative file path -> file text } (see GameData.designSpecificationTexts,
// built by data/gameData.ts). `race` is null-able the same way C#'s `Race race`
// parameter is (Start.2.cs calls LoadFromFile with race == null for the
// player-less "no race" case). When no template file is found (or race is
// null/empty), this falls back to Galaxy.DesignSpecifications.GetBySubRole
// (or null when standAlone), exactly like the C#.
export function loadDesignSpecification(
    texts: Map<string, string>,
    subRoleName: string,
    subRole: BuiltObjectSubRole,
    isMobile: boolean,
    raceNameOverride: string | null | undefined,
    isPirate: boolean,
    standAlone = false,
): DesignSpecification | null {
    if (raceNameOverride) {
        const files = designSpecificationFallbackFiles(subRoleName, raceNameOverride, isPirate);
        for (const file of files) {
            const text = texts.get(file);
            if (text === DESIGN_SPECIFICATION_MISSING) break; // theme: File.Exists(path4) false (data/gameData.ts)
            if (text !== undefined) {
                return parseDesignSpecification(text, subRole, isMobile, file);
            }
        }
    }
    return standAlone ? null : getDefaultDesignSpecificationBySubRole(defaultDesignSpecifications(), subRole);
}
