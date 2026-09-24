// Port of DistantWorlds.Types.DesignSpecification (DesignSpecification.cs) and
// DesignSpecificationComponentRule (DesignSpecificationComponentRule.cs),
// plus the file-parsing half of DesignSpecification.LoadFromFile. The C#
// LoadFromFile resolves designTemplates/<race>/<subRole>.txt (with pirate/
// subfolder and customization-set fallback); here the caller passes the file
// text directly, so parseDesignSpecification takes (text, subRoleName, ...).
// Pure parsing — no fs. Handles UTF-8 BOM and CRLF.

import { BuiltObjectSubRole } from './names';
import { ComponentType } from './components';

// Port of DistantWorlds.Types.ComponentCategoryType (ComponentCategoryType.cs).
// TODO(port): full enum not yet ported; only the members referenced by
// DesignSpecification are declared here. Member order is the exact C#
// declaration order: Undefined, WeaponBeam, WeaponTorpedo, WeaponPointDefense,
// AssaultPod, Shields, ShieldRecharge, HyperDrive, Reactor.
export enum ComponentCategoryType {
    Undefined = 0,
    WeaponBeam,
    WeaponTorpedo,
    WeaponPointDefense,
    AssaultPod,
    Shields,
    ShieldRecharge,
    HyperDrive,
    Reactor,
}

// Port of DistantWorlds.Types.BuiltObjectRole (BuiltObjectRole.cs).
// Member order is the exact C# declaration order: Undefined, Military,
// Exploration, Freight, Colony, Passenger, Build, Resource, Base.
export enum BuiltObjectRole {
    Undefined = 0,
    Military,
    Exploration,
    Freight,
    Colony,
    Passenger,
    Build,
    Resource,
    Base,
}

// Port of DistantWorlds.Types.BattleTactics (BattleTactics.cs).
export enum BattleTactics {
    Undefined = 0,
    Evade,
    Standoff,
    AllWeapons,
    PointBlank,
}

// Port of DistantWorlds.Types.InvasionTactics (InvasionTactics.cs).
export enum InvasionTactics {
    Undefined = 0,
    DoNotInvade,
    InvadeWhenClear,
    InvadeImmediately,
}

// Port of DistantWorlds.Types.BuiltObjectFleeWhen (BuiltObjectFleeWhen.cs).
export enum BuiltObjectFleeWhen {
    Undefined = 0,
    EnemyMilitarySighted,
    Attacked,
    Shields50,
    Shields20,
    Armor50,
    Never,
}

// Port of DistantWorlds.Types.DesignImageScalingMode (DesignImageScalingMode.cs).
export enum DesignImageScalingMode {
    Absolute = 0,
    Scaled,
}

// Port of DistantWorlds.Types.DesignSpecificationComponentRuleType
// (DesignSpecificationComponentRuleType.cs).
export enum DesignSpecificationComponentRuleType {
    MustNotHave = 0,
    ShouldNotHave,
    ShouldHave,
    MustHave,
}

// Port of DistantWorlds.Types.DesignSpecificationComponentRule
// (DesignSpecificationComponentRule.cs). The C# class has two constructors,
// one taking a ComponentCategoryType and one a ComponentType. TypeScript
// cannot overload on parameter type alone, so the single constructor takes
// an explicit `kind` discriminator (mirroring which C# constructor was used)
// rather than dispatching on the argument's runtime type.
export class DesignSpecificationComponentRule {
    private componentRuleType: DesignSpecificationComponentRuleType;
    private componentCategory: ComponentCategoryType;
    private componentType: ComponentType;
    private amount: number;

    constructor(
        componentRuleType: DesignSpecificationComponentRuleType,
        kind: 'category' | 'type',
        component: ComponentCategoryType | ComponentType,
        amount: number
    ) {
        this.componentRuleType = componentRuleType;
        if (kind === 'type') {
            this.componentType = component as ComponentType;
            this.componentCategory = resolveComponentCategory(this.componentType);
        } else {
            this.componentCategory = component as ComponentCategoryType;
            this.componentType = ComponentType.Undefined;
        }
        this.amount = amount;
    }

    get Amount(): number {
        return this.amount;
    }
    set Amount(value: number) {
        this.amount = value;
    }

    get ComponentRuleType(): DesignSpecificationComponentRuleType {
        return this.componentRuleType;
    }
    set ComponentRuleType(value: DesignSpecificationComponentRuleType) {
        this.componentRuleType = value;
    }

    get ComponentCategory(): ComponentCategoryType {
        return this.componentCategory;
    }

    get ComponentType(): ComponentType {
        return this.componentType;
    }
}

// Port of ComponentDefinition.cs ResolveComponentCategory (line ~130): maps a
// concrete ComponentType to its ComponentCategoryType. Only the categories
// declared in this module are resolvable; other types map to Undefined until
// the full ComponentCategoryType enum is ported.
function resolveComponentCategory(componentType: ComponentType): ComponentCategoryType {
    switch (componentType) {
        case ComponentType.WeaponBeam:
            return ComponentCategoryType.WeaponBeam;
        case ComponentType.WeaponTorpedo:
            return ComponentCategoryType.WeaponTorpedo;
        case ComponentType.WeaponPointDefense:
            return ComponentCategoryType.WeaponPointDefense;
        case ComponentType.AssaultPod:
            return ComponentCategoryType.AssaultPod;
        case ComponentType.Shields:
            return ComponentCategoryType.Shields;
        case ComponentType.ShieldRecharge:
            return ComponentCategoryType.ShieldRecharge;
        case ComponentType.HyperDrive:
            return ComponentCategoryType.HyperDrive;
        case ComponentType.Reactor:
            return ComponentCategoryType.Reactor;
        default:
            return ComponentCategoryType.Undefined;
    }
}

// Port of DistantWorlds.Types.DesignSpecification (DesignSpecification.cs).
export class DesignSpecification {
    private builtObjectSubRole: BuiltObjectSubRole;
    private builtObjectRole: BuiltObjectRole;
    private componentRules: DesignSpecificationComponentRule[];
    private mobile: boolean;

    // [OptionalField] properties, kept as public fields like the C# original.
    ImageScalingMode: DesignImageScalingMode;
    ImageScalingFactor: number;
    TacticsStronger: BattleTactics;
    TacticsWeaker: BattleTactics;
    TacticsInvasion: InvasionTactics;
    FleeWhen: BuiltObjectFleeWhen;

    constructor(subRole: BuiltObjectSubRole, mobile: boolean) {
        this.componentRules = [];
        this.builtObjectSubRole = subRole;
        this.builtObjectRole = DesignSpecification.ResolveRole(subRole);
        this.mobile = mobile;
        this.ImageScalingMode = DesignImageScalingMode.Absolute;
        this.ImageScalingFactor = 1;
        this.TacticsStronger = BattleTactics.Undefined;
        this.TacticsWeaker = BattleTactics.Undefined;
        this.TacticsInvasion = InvasionTactics.Undefined;
        this.FleeWhen = BuiltObjectFleeWhen.Undefined;
    }

    // Port of DesignSpecification.Clone: copies sub-role, mobile flag and all
    // component rules (re-resolving category from type, or keeping category).
    Clone(): DesignSpecification {
        const clone = new DesignSpecification(this.builtObjectSubRole, this.mobile);
        for (const rule of this.componentRules) {
            if (rule.ComponentType !== ComponentType.Undefined) {
                clone.componentRules.push(
                    new DesignSpecificationComponentRule(rule.ComponentRuleType, 'type', rule.ComponentType, rule.Amount)
                );
            } else {
                clone.componentRules.push(
                    new DesignSpecificationComponentRule(rule.ComponentRuleType, 'category', rule.ComponentCategory, rule.Amount)
                );
            }
        }
        return clone;
    }

    // Port of DesignSpecification.Contains(ComponentType).
    Contains(componentType: ComponentType): boolean {
        for (const rule of this.componentRules) {
            if (rule.ComponentType === componentType) {
                return true;
            }
        }
        return false;
    }

    get SubRole(): BuiltObjectSubRole {
        return this.builtObjectSubRole;
    }
    set SubRole(value: BuiltObjectSubRole) {
        this.builtObjectSubRole = value;
        this.builtObjectRole = DesignSpecification.ResolveRole(value);
    }

    get Role(): BuiltObjectRole {
        return this.builtObjectRole;
    }

    get ComponentRules(): DesignSpecificationComponentRule[] {
        return this.componentRules;
    }
    set ComponentRules(value: DesignSpecificationComponentRule[]) {
        this.componentRules = value;
    }

    get Mobile(): boolean {
        return this.mobile;
    }
    set Mobile(value: boolean) {
        this.mobile = value;
    }

    // Port of DesignSpecification.ResolveRole (exact switch, including the
    // "Unknown built object sub role type." throw for unhandled sub-roles).
    static ResolveRole(subRole: BuiltObjectSubRole): BuiltObjectRole {
        switch (subRole) {
            case BuiltObjectSubRole.Escort:
            case BuiltObjectSubRole.Frigate:
            case BuiltObjectSubRole.Destroyer:
            case BuiltObjectSubRole.Cruiser:
            case BuiltObjectSubRole.CapitalShip:
            case BuiltObjectSubRole.TroopTransport:
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
                return BuiltObjectRole.Base;
            default:
                throw new Error('Unknown built object sub role type.');
        }
    }
}

// Port of DesignSpecification.ResolveComponentTypeFromName (private static).
// Returns the resolved (type, category) pair; both start as Undefined and at
// most one is set per name, exactly like the C# out parameters.
function resolveComponentTypeFromName(componentName: string): {
    type: ComponentType;
    category: ComponentCategoryType;
} {
    let type = ComponentType.Undefined;
    let category = ComponentCategoryType.Undefined;
    switch (componentName) {
        case 'weaponarea':
            type = ComponentType.WeaponAreaDestruction;
            break;
        case 'weaponbeam':
            category = ComponentCategoryType.WeaponBeam;
            break;
        case 'weapontorpedo':
            category = ComponentCategoryType.WeaponTorpedo;
            break;
        case 'weaponmissile':
            type = ComponentType.WeaponMissile;
            break;
        case 'weaponbombard':
            type = ComponentType.WeaponBombard;
            break;
        case 'weaponphaser':
            type = ComponentType.WeaponPhaser;
            break;
        case 'weaponrailgun':
            type = ComponentType.WeaponRailGun;
            break;
        case 'weapontractorbeam':
            type = ComponentType.WeaponTractorBeam;
            break;
        case 'weapongravitonbeam':
            type = ComponentType.WeaponGravityBeam;
            break;
        case 'weaponareagravity':
            type = ComponentType.WeaponAreaGravity;
            break;
        case 'assaultpod':
            category = ComponentCategoryType.AssaultPod;
            break;
        case 'pointdefense':
            category = ComponentCategoryType.WeaponPointDefense;
            break;
        case 'ioncannon':
            type = ComponentType.WeaponIonCannon;
            break;
        case 'ionpulse':
            type = ComponentType.WeaponIonPulse;
            break;
        case 'iondefense':
            type = ComponentType.WeaponIonDefense;
            break;
        case 'hyperdeny':
            type = ComponentType.HyperDeny;
            break;
        case 'gravitywellprojector':
            type = ComponentType.HyperStop;
            break;
        case 'weaponsuperbeam':
            type = ComponentType.WeaponSuperBeam;
            break;
        case 'weaponsupertorpedo':
            type = ComponentType.WeaponSuperTorpedo;
            break;
        case 'weaponsuperrailgun':
            type = ComponentType.WeaponSuperRailGun;
            break;
        case 'weaponsuperphaser':
            type = ComponentType.WeaponSuperPhaser;
            break;
        case 'weaponsupermissile':
            type = ComponentType.WeaponSuperMissile;
            break;
        case 'fighterbay':
            type = ComponentType.FighterBay;
            break;
        case 'armor':
            type = ComponentType.Armor;
            break;
        case 'shields':
            category = ComponentCategoryType.Shields;
            break;
        case 'areashieldrecharge':
            category = ComponentCategoryType.ShieldRecharge;
            break;
        case 'engine':
            type = ComponentType.EngineMainThrust;
            break;
        case 'vectoringengine':
            type = ComponentType.EngineVectoring;
            break;
        case 'hyperdrive':
            category = ComponentCategoryType.HyperDrive;
            break;
        case 'reactor':
            category = ComponentCategoryType.Reactor;
            break;
        case 'energycollector':
            type = ComponentType.EnergyCollector;
            break;
        case 'energytofuelconverter':
            type = ComponentType.EnergyToFuel;
            break;
        case 'miningengine':
            type = ComponentType.ExtractorMine;
            break;
        case 'gasextractor':
            type = ComponentType.ExtractorGasExtractor;
            break;
        case 'luxuryresourceextractor':
            type = ComponentType.ExtractorLuxury;
            break;
        case 'weaponsmanufacturingplant':
            type = ComponentType.ManufacturerWeaponsPlant;
            break;
        case 'energymanufacturingplant':
            type = ComponentType.ManufacturerEnergyPlant;
            break;
        case 'hightechmanufacturingplant':
            type = ComponentType.ManufacturerHighTechPlant;
            break;
        case 'fuelcell':
            type = ComponentType.StorageFuel;
            break;
        case 'cargobay':
            type = ComponentType.StorageCargo;
            break;
        case 'troopcompartment':
            type = ComponentType.StorageTroop;
            break;
        case 'passengercompartment':
            type = ComponentType.StoragePassenger;
            break;
        case 'dockingbay':
            type = ComponentType.StorageDockingBay;
            break;
        case 'proximityarray':
            type = ComponentType.SensorProximityArray;
            break;
        case 'resourceprofilesensor':
            type = ComponentType.SensorResourceProfileSensor;
            break;
        case 'longrangescanner':
            type = ComponentType.SensorLongRange;
            break;
        case 'tracescanner':
            type = ComponentType.SensorTraceScanner;
            break;
        case 'scannerjammer':
            type = ComponentType.SensorScannerJammer;
            break;
        case 'stealthcloak':
            type = ComponentType.SensorStealth;
            break;
        case 'combattargettingsystem':
            type = ComponentType.ComputerTargetting;
            break;
        case 'countermeasuressystem':
            type = ComponentType.ComputerCountermeasures;
            break;
        case 'commandcenter':
            type = ComponentType.ComputerCommandCenter;
            break;
        case 'commercecenter':
            type = ComponentType.ComputerCommerceCenter;
            break;
        case 'fleettargettingsystem':
            type = ComponentType.ComputerTargettingFleet;
            break;
        case 'fleetcountermeasuressystem':
            type = ComponentType.ComputerCountermeasuresFleet;
            break;
        case 'weaponsresearchlab':
            type = ComponentType.LabsWeaponsLab;
            break;
        case 'energyresearchlab':
            type = ComponentType.LabsEnergyLab;
            break;
        case 'hightechresearchlab':
            type = ComponentType.LabsHighTechLab;
            break;
        case 'constructionyard':
            type = ComponentType.ConstructionBuild;
            break;
        case 'damagecontrol':
            type = ComponentType.DamageControl;
            break;
        case 'lifesupport':
            type = ComponentType.HabitationLifeSupport;
            break;
        case 'habmodule':
            type = ComponentType.HabitationHabModule;
            break;
        case 'medicalcenter':
            type = ComponentType.HabitationMedicalCenter;
            break;
        case 'recreationcenter':
            type = ComponentType.HabitationRecreationCenter;
            break;
        case 'colonizationmodule':
            type = ComponentType.HabitationColonization;
            break;
    }
    return { type, category };
}

function stripBom(text: string): string {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// Port of the line loop in DesignSpecification.LoadFromFile (the
// applicationPath/customPath/File.Exists resolution is replaced by the
// caller-supplied text; the standAlone/Galaxy.DesignSpecifications.GetBySubRole
// fallback when the file is missing is the caller's concern).
//
// @param text File content of designTemplates/<race>/<subRole>.txt
// @param subRoleName Name of the sub-role file (used only in error messages)
// @param subRole The BuiltObjectSubRole this specification describes
// @param isMobile Whether the design is for a mobile (space) object
export function parseDesignSpecification(
    text: string,
    subRoleName: string,
    subRole: BuiltObjectSubRole,
    isMobile: boolean
): DesignSpecification {
    const spec = new DesignSpecification(subRole, isMobile);

    // Always present once a file exists: command center, plus hyperdrive for
    // mobile objects (added before any file lines are read).
    spec.ComponentRules.push(
        new DesignSpecificationComponentRule(
            DesignSpecificationComponentRuleType.MustHave,
            'type',
            ComponentType.ComputerCommandCenter,
            1
        )
    );
    if (isMobile) {
        spec.ComponentRules.push(
            new DesignSpecificationComponentRule(
                DesignSpecificationComponentRuleType.MustHave,
                'category',
                ComponentCategoryType.HyperDrive,
                1
            )
        );
    }

    let num = 0;
    for (const rawLine of stripBom(text).split(/\r\n|\r|\n/)) {
        ++num;
        const line = rawLine.trim();
        if (line === '' || line.substring(0, 1) === "'") {
            continue;
        }
        const sep = line.indexOf(';');
        if (sep < 0) {
            continue;
        }
        const key = line.substring(0, sep).trim().toLowerCase();
        const value = line.substring(sep + 1).trim();

        if (key === 'tacticsweaker') {
            switch (value.toLowerCase()) {
                case 'evade':
                    spec.TacticsWeaker = BattleTactics.Evade;
                    break;
                case 'standoff':
                    spec.TacticsWeaker = BattleTactics.Standoff;
                    break;
                case 'allweapons':
                    spec.TacticsWeaker = BattleTactics.AllWeapons;
                    break;
                case 'pointblank':
                    spec.TacticsWeaker = BattleTactics.PointBlank;
                    break;
            }
        } else if (key === 'tacticsstronger') {
            switch (value.toLowerCase()) {
                case 'evade':
                    spec.TacticsStronger = BattleTactics.Evade;
                    break;
                case 'standoff':
                    spec.TacticsStronger = BattleTactics.Standoff;
                    break;
                case 'allweapons':
                    spec.TacticsStronger = BattleTactics.AllWeapons;
                    break;
                case 'pointblank':
                    spec.TacticsStronger = BattleTactics.PointBlank;
                    break;
            }
        } else if (key === 'tacticsinvasion') {
            switch (value.toLowerCase()) {
                case 'donotinvade':
                    spec.TacticsInvasion = InvasionTactics.DoNotInvade;
                    break;
                case 'invadewhenclear':
                    spec.TacticsInvasion = InvasionTactics.InvadeWhenClear;
                    break;
                case 'invadeimmediately':
                    spec.TacticsInvasion = InvasionTactics.InvadeImmediately;
                    break;
            }
        } else if (key === 'fleewhen') {
            switch (value.toLowerCase()) {
                case 'enemymilitarysighted':
                    spec.FleeWhen = BuiltObjectFleeWhen.EnemyMilitarySighted;
                    break;
                case 'attacked':
                    spec.FleeWhen = BuiltObjectFleeWhen.Attacked;
                    break;
                case 'shields50':
                    spec.FleeWhen = BuiltObjectFleeWhen.Shields50;
                    break;
                case 'shields20':
                    spec.FleeWhen = BuiltObjectFleeWhen.Shields20;
                    break;
                case 'armor50':
                    spec.FleeWhen = BuiltObjectFleeWhen.Armor50;
                    break;
                case 'never':
                    spec.FleeWhen = BuiltObjectFleeWhen.Never;
                    break;
            }
        } else if (key === 'imagescaling') {
            const lower = value.toLowerCase();
            if (lower.startsWith('absolute')) {
                const factor = parseFloat(lower.substring('absolute'.length).trim());
                if (Number.isNaN(factor)) {
                    throw new Error(
                        `Error reading Image Scaling Factor in line ${num} of file ${subRoleName}.txt`
                    );
                }
                if (factor < 10 || factor > 1000) {
                    throw new Error(
                        `Invalid Image Scaling Factor (when mode is Absolute should be between 10 and 1000) in line ${num} of file ${subRoleName}.txt`
                    );
                }
                spec.ImageScalingMode = DesignImageScalingMode.Absolute;
                spec.ImageScalingFactor = factor;
            } else {
                if (!lower.startsWith('scaled')) {
                    throw new Error(
                        `Invalid Image Scaling Mode (should be Absolute or Scaled) in line ${num} of file ${subRoleName}.txt`
                    );
                }
                const factor = parseFloat(lower.substring('scaled'.length).trim());
                if (Number.isNaN(factor)) {
                    throw new Error(
                        `Error reading Image Scaling Factor in line ${num} of file ${subRoleName}.txt`
                    );
                }
                if (factor < 0.05 || factor > 10.0) {
                    throw new Error(
                        `Invalid Image Scaling Factor (when mode is Scaled should be between 0.05 and 10.0) in line ${num} of file ${subRoleName}.txt`
                    );
                }
                spec.ImageScalingMode = DesignImageScalingMode.Scaled;
                spec.ImageScalingFactor = factor;
            }
        } else {
            // A component rule: the value must be a positive integer count.
            const amount = parseInt(value, 10);
            if (!Number.isNaN(amount) && amount > 0) {
                const { type, category } = resolveComponentTypeFromName(key);
                if (type !== ComponentType.ComputerCommandCenter && category !== ComponentCategoryType.HyperDrive) {
                    if (type !== ComponentType.Undefined) {
                        spec.ComponentRules.push(
                            new DesignSpecificationComponentRule(
                                DesignSpecificationComponentRuleType.MustHave,
                                'type',
                                type,
                                amount
                            )
                        );
                    } else if (category !== ComponentCategoryType.Undefined) {
                        spec.ComponentRules.push(
                            new DesignSpecificationComponentRule(
                                DesignSpecificationComponentRuleType.MustHave,
                                'category',
                                category,
                                amount
                            )
                        );
                    }
                }
            }
        }
    }

    return spec;
}