// Port of components.txt loader: ComponentDefinitionList.cs LoadFromFile (line 73).
// Pure parsing — no fs. Handles UTF-8 BOM, `'`-comment lines, and CRLF.
//
// Column order (per LoadFromFile): ComponentId, Name, PictureRef, SpecialImageIndex,
// SoundEffectFilename, Type (code byte, resolved via ResolveComponentTypeFromCode),
// Size, EnergyUsed, Value1..Value7, then (ResourceId, Amount) pairs (trailing comma).

// Port of ComponentType.cs (enum member order exact).
export enum ComponentType {
    Undefined = 0,
    WeaponBeam,
    WeaponTorpedo,
    WeaponBombard,
    WeaponMissile,
    WeaponPointDefense,
    WeaponIonCannon,
    WeaponIonPulse,
    WeaponIonDefense,
    WeaponTractorBeam,
    WeaponGravityBeam,
    WeaponAreaGravity,
    AssaultPod,
    HyperDeny,
    HyperStop,
    WeaponAreaDestruction,
    WeaponSuperBeam,
    WeaponSuperArea,
    FighterBay,
    Armor,
    Shields,
    ShieldRecharge,
    EngineMainThrust,
    EngineVectoring,
    HyperDrive,
    Reactor,
    EnergyCollector,
    ExtractorMine,
    ExtractorGasExtractor,
    ExtractorLuxury,
    ManufacturerWeaponsPlant,
    ManufacturerEnergyPlant,
    ManufacturerHighTechPlant,
    StorageFuel,
    StorageCargo,
    StorageTroop,
    StoragePassenger,
    StorageDockingBay,
    SensorProximityArray,
    SensorResourceProfileSensor,
    SensorLongRange,
    SensorTraceScanner,
    SensorScannerJammer,
    SensorStealth,
    ComputerTargetting,
    ComputerTargettingFleet,
    ComputerCountermeasures,
    ComputerCountermeasuresFleet,
    ComputerCommandCenter,
    ComputerCommerceCenter,
    LabsWeaponsLab,
    LabsEnergyLab,
    LabsHighTechLab,
    ConstructionBuild,
    HabitationLifeSupport,
    HabitationHabModule,
    DamageControl,
    HabitationMedicalCenter,
    HabitationRecreationCenter,
    HabitationColonization,
    WeaponPhaser,
    WeaponRailGun,
    EnergyToFuel,
    WeaponSuperTorpedo,
    WeaponSuperMissile,
    WeaponSuperPhaser,
    WeaponSuperRailGun,
}

// Port of ComponentDefinition.cs ResolveComponentTypeFromCode (line 130).
export function resolveComponentTypeFromCode(code: number): ComponentType {
    switch (code) {
        case 0: return ComponentType.ShieldRecharge;
        case 1: return ComponentType.Armor;
        case 2: return ComponentType.AssaultPod;
        case 3: return ComponentType.StorageCargo;
        case 4: return ComponentType.HabitationColonization;
        case 5: return ComponentType.ComputerCommandCenter;
        case 6: return ComponentType.ComputerCommerceCenter;
        case 7: return ComponentType.ConstructionBuild;
        case 8: return ComponentType.ComputerCountermeasures;
        case 9: return ComponentType.ComputerCountermeasuresFleet;
        case 10: return ComponentType.DamageControl;
        case 11: return ComponentType.StorageDockingBay;
        case 12: return ComponentType.EnergyCollector;
        case 13: return ComponentType.EnergyToFuel;
        case 14: return ComponentType.EngineMainThrust;
        case 15: return ComponentType.EngineVectoring;
        case 16: return ComponentType.ExtractorGasExtractor;
        case 17: return ComponentType.ExtractorLuxury;
        case 18: return ComponentType.ExtractorMine;
        case 19: return ComponentType.FighterBay;
        case 20: return ComponentType.StorageFuel;
        case 21: return ComponentType.HabitationHabModule;
        case 22: return ComponentType.HyperDeny;
        case 23: return ComponentType.HyperDrive;
        case 24: return ComponentType.HyperStop;
        case 25: return ComponentType.HabitationLifeSupport;
        case 26: return ComponentType.SensorLongRange;
        case 27: return ComponentType.ManufacturerEnergyPlant;
        case 28: return ComponentType.ManufacturerHighTechPlant;
        case 29: return ComponentType.ManufacturerWeaponsPlant;
        case 30: return ComponentType.HabitationMedicalCenter;
        case 31: return ComponentType.StoragePassenger;
        case 32: return ComponentType.SensorProximityArray;
        case 33: return ComponentType.Reactor;
        case 34: return ComponentType.HabitationRecreationCenter;
        case 35: return ComponentType.LabsEnergyLab;
        case 36: return ComponentType.LabsHighTechLab;
        case 37: return ComponentType.LabsWeaponsLab;
        case 38: return ComponentType.SensorResourceProfileSensor;
        case 39: return ComponentType.SensorScannerJammer;
        case 40: return ComponentType.Shields;
        case 41: return ComponentType.SensorStealth;
        case 42: return ComponentType.ComputerTargetting;
        case 43: return ComponentType.ComputerTargettingFleet;
        case 44: return ComponentType.SensorTraceScanner;
        case 45: return ComponentType.StorageTroop;
        case 46: return ComponentType.WeaponAreaDestruction;
        case 47: return ComponentType.WeaponAreaGravity;
        case 48: return ComponentType.WeaponBeam;
        case 49: return ComponentType.WeaponBombard;
        case 50: return ComponentType.WeaponGravityBeam;
        case 51: return ComponentType.WeaponIonCannon;
        case 52: return ComponentType.WeaponIonDefense;
        case 53: return ComponentType.WeaponIonPulse;
        case 54: return ComponentType.WeaponMissile;
        case 55: return ComponentType.WeaponPhaser;
        case 56: return ComponentType.WeaponPointDefense;
        case 57: return ComponentType.WeaponRailGun;
        case 58: return ComponentType.WeaponSuperArea;
        case 59: return ComponentType.WeaponSuperBeam;
        case 60: return ComponentType.WeaponTorpedo;
        case 61: return ComponentType.WeaponTractorBeam;
        case 62: return ComponentType.WeaponSuperTorpedo;
        case 63: return ComponentType.WeaponSuperMissile;
        case 64: return ComponentType.WeaponSuperRailGun;
        case 65: return ComponentType.WeaponSuperPhaser;
        default:
            return ComponentType.Undefined;
    }
}

export interface ComponentResourceRequirement {
    resourceId: number;
    amount: number;
}

export interface Component {
    componentId: number;
    name: string;
    pictureRef: number;
    specialImageIndex: number;
    soundEffectFilename: string;
    type: ComponentType;
    size: number;
    energyUsed: number;
    value1: number;
    value2: number;
    value3: number;
    value4: number;
    value5: number;
    value6: number;
    value7: number;
    resourceRequirements: ComponentResourceRequirement[];
}

function stripBom(text: string): string {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// Port of ComponentDefinitionList.cs LoadFromFile (line 73).
export function parseComponents(text: string): Component[] {
    const components: Component[] = [];
    const lines = stripBom(text).split(/\r\n|\r|\n/);

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (line === '' || line.substring(0, 1) === "'") {
            continue;
        }

        const parts = line.split(',').map((p) => p.trim());
        // 15 fields through Value7 (index 0-14); resource pairs follow at index 15+.
        if (parts.length < 15) {
            continue;
        }

        const componentId = parseInt(parts[0], 10);
        const name = parts[1];
        const pictureRef = parseInt(parts[2], 10);
        const specialImageIndex = parseInt(parts[3], 10);
        const soundEffectFilename = parts[4];
        const type = resolveComponentTypeFromCode(parseInt(parts[5], 10));
        if (type === ComponentType.Undefined) {
            // C# throws "Invalid Type"; the TS loader skips bad lines instead.
            continue;
        }
        const size = parseInt(parts[6], 10);
        const energyUsed = parseInt(parts[7], 10);
        const value1 = parseInt(parts[8], 10);
        const value2 = parseInt(parts[9], 10);
        const value3 = parseInt(parts[10], 10);
        const value4 = parseInt(parts[11], 10);
        const value5 = parseInt(parts[12], 10);
        const value6 = parseInt(parts[13], 10);
        const value7 = parseInt(parts[14], 10);

        if (
            Number.isNaN(componentId) ||
            Number.isNaN(pictureRef) ||
            Number.isNaN(specialImageIndex) ||
            Number.isNaN(size) ||
            Number.isNaN(energyUsed) ||
            Number.isNaN(value1) ||
            Number.isNaN(value2) ||
            Number.isNaN(value3) ||
            Number.isNaN(value4) ||
            Number.isNaN(value5) ||
            Number.isNaN(value6) ||
            Number.isNaN(value7)
        ) {
            continue;
        }

        // Required resources: (ResourceId byte, Amount int) pairs after Value7.
        // C# throws if an Amount is <= 0 or > 32767; the TS loader skips bad pairs.
        const resourceRequirements: ComponentResourceRequirement[] = [];
        for (let i = 15; i + 1 < parts.length; i += 2) {
            const resourceId = parseInt(parts[i], 10);
            const amount = parseInt(parts[i + 1], 10);
            if (!Number.isNaN(resourceId) && !Number.isNaN(amount) && amount > 0 && amount <= 32767) {
                resourceRequirements.push({ resourceId, amount });
            }
        }

        components.push({
            componentId,
            name,
            pictureRef,
            specialImageIndex,
            soundEffectFilename,
            type,
            size,
            energyUsed,
            value1,
            value2,
            value3,
            value4,
            value5,
            value6,
            value7,
            resourceRequirements,
        });
    }

    return components;
}