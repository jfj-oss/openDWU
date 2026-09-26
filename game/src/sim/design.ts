// Ship/base designs (task D2). Port of the parts of Design.cs / DesignList.cs
// that design generation needs: the component list and identity fields, the
// energy helpers used by PlaceComponentsOnDesign, IsEquivalent,
// QuickCalculateSize, and the DesignList Find* lookups, plus the Galaxy.8.cs
// DetermineLifeSupportRequired / DetermineHabModulesRequired helpers.
// Task M3a: Design.ReDefine (Design.cs 1240) with its derived stats and Weapons
// list, IsPlanetDestroyer (233), CalculateCurrentPurchasePrice (1143) and the
// Galaxy.ComponentCurrentPrices start-of-game values it reads.

import { BuiltObjectSubRole } from './builtObjectTypes';
import { csInt, toByte, toShort } from './builtObjectComponent';
import { ResourceRef } from './cargo';
import { componentImprovementFromComponent, type ComponentDefinition, type ComponentImprovementEntry, type ComponentStatic } from './componentStatic';
import { ComponentType } from './data/components';
import { ComponentCategoryType } from './data/policies';
import { BattleTactics, BuiltObjectFleeWhen, BuiltObjectRole, DesignImageScalingMode, InvasionTactics } from './data/designSpecifications';
import type { Resource } from './data/resources';
import { Weapon } from './weapon';
import { baconSettings } from './data/baconSettings';

// Port of BuiltObjectStance.cs (member order exact).
export enum BuiltObjectStance {
    Undefined,
    AttackUnallied,
    AttackEnemies,
    AttackIfAttacked,
    DoNotAttack,
}

/** Minimal owner surface Design needs (avoids importing Empire; Empire satisfies it). */
export interface DesignOwner {
    readonly empireId: number;
    /** Empire.Research (ReDefine resolves improved component values through it). */
    readonly research?: { resolveImprovedComponentValues(component: ComponentDefinition): ComponentImprovementEntry } | null;
    /** Empire.PirateEmpireBaseHabitat (CalculateCurrentPurchasePrice markup). */
    readonly pirateEmpireBaseHabitat?: unknown;
    /** Empire.BuiltObjects / PrivateBuiltObjects (BaconDesign.Redefine re-ReDefines ships of this design). */
    readonly builtObjects?: unknown[];
    readonly privateBuiltObjects?: unknown[];
}

// Galaxy.cs static ShipMarkupFactor / ShipMarkupFactorPirates (Galaxy.3.cs 5070-5071): BaconSettings.txt statics
// (BaconMain.cs 770 / 774), read from `baconSettings` — the class defaults while a galaxy is generated, the file's
// values once the game starts (sim/baconInitialize.ts).

/** Galaxy surface for Galaxy.ComponentCurrentPrices. */
export interface ComponentPriceGalaxy {
    readonly researchStatic: { readonly componentStatic: ComponentStatic | null } | null;
    readonly resourceSystem: { readonly resources: Resource[] };
}

const componentCurrentPricesByGalaxy = new WeakMap<object, number[]>();

// Galaxy.ComponentCurrentPrices (Galaxy.cs:567) as initialised in the Galaxy
// constructor (Galaxy.4.cs:2179-2188): for each ComponentDefinitionsStatic entry
// (list position), Σ RequiredResources[i].BasePrice * Quantity, where
// Resource.BasePrice = (int)ResourceSystemStatic.Resources[ResourceID].BasePrice
// (Resource.cs:40, a float truncated to int). Built lazily on first use (the TS
// Galaxy gets its component/resource data after construction) and cached per galaxy.
// Start.2.cs:1103-1107 then runs ReviewResourcePrices + ReviewComponentPrices
// (Galaxy.1.cs:1204/1027) 20 times after the starting colonies exist; those are
// ported in src/sim/market.ts (reviewResourcePrices / reviewComponentPrices) and
// update this same cached array in place, so CalculateCurrentPurchasePrice sees
// the reviewed prices once they have run.
export function galaxyComponentCurrentPrices(galaxy: ComponentPriceGalaxy): number[] {
    let prices = componentCurrentPricesByGalaxy.get(galaxy);
    if (prices === undefined) {
        prices = [];
        const defs = galaxy.researchStatic?.componentStatic?.definitions ?? [];
        const resources = galaxy.resourceSystem.resources;
        for (const componentDefinition of defs) {
            const count = prices.length;
            prices.push(0.0);
            for (const requiredResource of componentDefinition.resourceRequirements) {
                const basePrice = Math.trunc(Math.fround(resources[requiredResource.resourceId].basePrice));
                prices[count] += basePrice * requiredResource.amount;
            }
        }
        // Only cache once the static component data exists (it is loaded after construction).
        if (galaxy.researchStatic?.componentStatic) componentCurrentPricesByGalaxy.set(galaxy, prices);
    }
    return prices;
}

const resourceCurrentPricesByGalaxy = new WeakMap<object, number[]>();

// Galaxy.ResourceCurrentPrices (Galaxy.cs:565) as initialised in the Galaxy
// constructor (Galaxy.4.cs:2175-2178): one entry per ResourceSystem.Resources
// item, ResourceDefinition.BasePrice (a C# float widened to double). Built
// lazily and cached per galaxy once its resource data exists; ReviewResourcePrices
// (src/sim/market.ts) mutates this same array in place.
export function galaxyResourceCurrentPrices(galaxy: ComponentPriceGalaxy): number[] {
    let prices = resourceCurrentPricesByGalaxy.get(galaxy);
    if (prices === undefined) {
        prices = [];
        for (const resource of galaxy.resourceSystem.resources) prices.push(Math.fround(resource.basePrice));
        if (galaxy.resourceSystem.resources.length > 0) resourceCurrentPricesByGalaxy.set(galaxy, prices);
    }
    return prices;
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
    allowAutoRetrofit = true;

    // Derived by ReDefine (Design.cs field order).
    topSpeed = 0;
    cruiseSpeed = 0;
    warpSpeed = 0;
    hyperjumpInitiate = 0;
    // Design.cs _MaxFuel / _Firepower / _MaxShields / _Price: serialized legacy fields that no C# code assigns
    // (only Load/Save touch them, Design.cs 631-639 / 766-774), so they stay 0. Firepower shown in the UI and
    // read by the AI is FirepowerRaw (set by ReDefine; e.g. Main.Part9.cs 5081 lblDesignWeaponFirepowerValue).
    maxFuel = 0;
    firepower = 0;
    maxShields = 0;
    price = 0;
    cargoCapacity = 0;
    isSpacePort = false;
    isRefuellingDepot = false;
    isResearchLab = false;
    isShipYard = false;
    isResourceExtractor = false;
    isManufacturer = false;
    staticEnergyConsumption = 0;
    reactorPowerOutput = 0;
    reactorStorageCapacity = 0;
    reactorCycleFuelConsumption = 0;
    currentReactorStorage = 0;
    targetSpeed = 0;
    currentSpeed = 0;
    troopCapacity = 0;
    fighterCapacity = 0;
    heading = 0;
    targetHeading = 0;
    turnRate = 0;
    armor = 0;
    armorReactive = 0;
    targettingModifier = 0;
    fleetTargettingModifier = 0; // short
    countermeasureModifier = 0;
    fleetCountermeasureModifier = 0; // short
    maintenanceSavings = 0;
    tradeBonuses = 0;
    medicalCapacity = 0;
    recreationCapacity = 0;
    firepowerRaw = 0;
    bombardPower = 0;
    shieldsCapacity = 0;
    shieldRechargeRate = 0;
    shieldAreaRechargeRange = 0; // short
    shieldAreaRechargeCapacity = 0; // short
    shieldAreaRechargeEnergyRequired = 0; // short
    population = 0;
    sensorProximityArrayRange = 0;
    sensorResourceProfileSensorRange = 0;
    sensorLongRange = 0;
    weaponHyperDenyRange = 0;
    hyperStopRange = 0; // short
    maximumWeaponsRange = 0;
    minimumWeaponsRange = 0;
    pointDefenseWeaponsRange = 0;
    ionDefense = 0;
    ionWeaponPower = 0;
    ionWeaponRange = 0;
    tractorBeamRange = 0; // short
    assaultStrength = 0; // short
    assaultRange = 0; // short
    assaultShieldPenetration = 0; // short
    isColony = false;
    isEnergyCollector = false;
    researchWeapons = 0;
    researchEnergy = 0;
    researchHighTech = 0;
    extractionMine = 0;
    extractionGas = 0;
    extractionLuxury = 0;
    manufactureWeapons = 0;
    manufactureEnergy = 0;
    manufactureHighTech = 0;
    energyCollection = 0;
    fuelType: ResourceRef | null = null;
    fuelCapacity = 0;
    topSpeedFuelBurn = 0;
    cruiseSpeedFuelBurn = 0;
    warpSpeedFuelBurn = 0;
    impulseSpeedFuelBurn = 0;
    accelerationRate = 0;
    dockingBayCount = 0;
    constructionYardCount = 0;
    hyperDriveIndex = 0;
    private _damageReduction = 0;
    private _damageRepair = 0;
    private _stealth = 1.0;
    weapons: Weapon[] = [];

    // Design.cs Design(string name).
    constructor(name: string) {
        this.name = name;
    }

    get stealth(): number { return this._stealth; }
    get damageRepair(): number { return this._damageRepair; }
    get damageReduction(): number { return this._damageReduction; }

    // Design.cs IsPlanetDestroyer (233).
    get isPlanetDestroyer(): boolean {
        if (this.firepowerRaw >= 10000) {
            for (let i = 0; i < this.weapons.length; i++) {
                const weapon = this.weapons[i];
                if (weapon !== null && weapon.component !== null) {
                    const t = weapon.component.type;
                    if ((t === ComponentType.WeaponSuperBeam || t === ComponentType.WeaponSuperTorpedo || t === ComponentType.WeaponSuperMissile || t === ComponentType.WeaponSuperRailGun || t === ComponentType.WeaponSuperPhaser) && weapon.rawDamage >= 10000) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    // Design.cs CalculateCurrentPurchasePrice (1143).
    calculateCurrentPurchasePrice(galaxy: ComponentPriceGalaxy): number {
        const prices = galaxyComponentCurrentPrices(galaxy);
        let num = 0.0;
        for (let i = 0; i < this.components.length; i++) num += prices[this.components[i].componentId];
        if (this.empire !== null && this.empire.pirateEmpireBaseHabitat != null) return num * baconSettings.shipMarkupFactorPirates;
        return num * baconSettings.shipMarkupFactor;
    }

    // Design.cs FuelUnitPerEnergyUnit (1164).
    fuelUnitPerEnergyUnit(): number {
        return this.reactorCycleFuelConsumption / 1000.0 / this.reactorStorageCapacity;
    }

    // Design.cs MaximumRange (1169).
    maximumRange(): number {
        const num = this.fuelUnitPerEnergyUnit();
        if (this.warpSpeed > 0) return (this.fuelCapacity / ((this.warpSpeedFuelBurn + this.staticEnergyConsumption) * num)) * this.warpSpeed;
        return (this.fuelCapacity / ((this.cruiseSpeedFuelBurn + this.staticEnergyConsumption) * num)) * this.cruiseSpeed;
    }

    // Design.cs ReDefine (1240). No Galaxy.Rnd use.
    reDefine(): void {
        const T = ComponentType;
        const C = ComponentCategoryType;
        let flag = false;
        let flag2 = false;
        let flag3 = false;
        let flag4 = false;
        let flag5 = false;
        let flag6 = false;
        let flag7 = false;
        let flag8 = false;
        let flag9 = false;
        let flag10 = false;
        let flag11 = false;
        let flag12 = false;
        let flag13 = false;
        this.reactorPowerOutput = 0;
        this.reactorStorageCapacity = 0;
        this.reactorCycleFuelConsumption = 0;
        this.staticEnergyConsumption = 0;
        this.sensorProximityArrayRange = 0;
        this.sensorResourceProfileSensorRange = 0;
        this.sensorLongRange = 0;
        this.weaponHyperDenyRange = 0;
        this.hyperStopRange = 0;
        this.maximumWeaponsRange = 0;
        this.minimumWeaponsRange = 100000;
        this.pointDefenseWeaponsRange = 0;
        this.ionDefense = 0;
        this.ionWeaponPower = 0;
        this.ionWeaponRange = 0;
        this.tractorBeamRange = 0;
        this.assaultStrength = 0;
        this.assaultRange = 0;
        this.assaultShieldPenetration = 0;
        this.armor = 0;
        this.armorReactive = 0;
        this.dockingBayCount = 0;
        this.constructionYardCount = 0;
        this._stealth = 1.0;
        this._damageReduction = 0.0;
        this.isColony = false;
        this.isEnergyCollector = false;
        this.isManufacturer = false;
        this.isRefuellingDepot = false;
        this.isResearchLab = false;
        this.isResourceExtractor = false;
        this.isShipYard = false;
        this.isSpacePort = false;
        this.researchWeapons = 0;
        this.researchEnergy = 0;
        this.researchHighTech = 0;
        this.extractionMine = 0;
        this.extractionGas = 0;
        this.extractionLuxury = 0;
        this.manufactureWeapons = 0;
        this.manufactureEnergy = 0;
        this.manufactureHighTech = 0;
        this.energyCollection = 0;
        this.medicalCapacity = 0;
        this.recreationCapacity = 0;
        this.fleetCountermeasureModifier = 0;
        this.countermeasureModifier = 0;
        this.fleetTargettingModifier = 0;
        this.targettingModifier = 0;
        this.maintenanceSavings = 0.0;
        this.tradeBonuses = 0.0;
        this.shieldAreaRechargeRange = 0;
        this.shieldAreaRechargeCapacity = 0;
        this.shieldAreaRechargeEnergyRequired = 0;
        let num = 0;
        let num2 = 0;
        let num3 = 0;
        let num4 = 0;
        let num5 = 0;
        let num6 = 0;
        let num7 = 0;
        let num8 = 0;
        let num9 = 0;
        let num10 = 0.0;
        let num11 = 0;
        let num12 = 0;
        let num13 = 0;
        let num14 = 0;
        let num15 = 0;
        let num16 = 0;
        let num17 = 0;
        let num18 = 0;
        let num19 = 0;
        let num20 = 0;
        let num21 = 0;
        let num22 = 2147483647;
        let num23 = 0;
        let num24 = 0;
        let num25 = 0;
        let num26 = 0;
        let num27 = 0;
        this.weapons.length = 0;
        let num28 = 0;
        // Shared (int)(((V1 - V2/100*V5/2) * V2 * (1000/V6))) term (num6 is never read afterwards).
        const num6Term = (ci: ComponentImprovementEntry): number => csInt((ci.value1 - (ci.value2 / 100.0) * ci.value5 / 2.0) * ci.value2 * (1000.0 / ci.value6));
        for (let i = 0; i < this.components.length; i++) {
            num23 += this.components[i].size;
            this.staticEnergyConsumption += this.components[i].energyUsed;
            const research = this.empire?.research ?? null;
            const componentImprovement: ComponentImprovementEntry =
                this.empire === null || research === null ? componentImprovementFromComponent(this.components[i]) : research.resolveImprovedComponentValues(this.components[i]);
            switch (componentImprovement.improvedComponent.category) {
                case C.AssaultPod: {
                    if (componentImprovement.improvedComponent.type !== T.AssaultPod) break;
                    this.assaultStrength = toShort(this.assaultStrength + toShort(componentImprovement.value1));
                    if (componentImprovement.value2 > 0) {
                        if (this.assaultRange > 0) this.assaultRange = Math.min(this.assaultRange, toShort(componentImprovement.value2));
                        else this.assaultRange = toShort(componentImprovement.value2);
                    }
                    if (componentImprovement.value5 > 0) {
                        if (this.assaultShieldPenetration > 0) this.assaultShieldPenetration = Math.max(this.assaultShieldPenetration, toShort(componentImprovement.value5));
                        else this.assaultShieldPenetration = toShort(componentImprovement.value5);
                    }
                    this.weapons.push(Weapon.fromComponentImprovement(componentImprovement));
                    break;
                }
                case C.Fighter:
                    if (componentImprovement.improvedComponent.type === T.FighterBay) num3 += componentImprovement.value1;
                    break;
                case C.Engine:
                    switch (componentImprovement.improvedComponent.type) {
                        case T.EngineMainThrust:
                            num14 += componentImprovement.value1;
                            num16 += componentImprovement.value2;
                            num15 += componentImprovement.value3;
                            num17 += componentImprovement.value4;
                            break;
                        case T.EngineVectoring:
                            num18 += componentImprovement.value1;
                            num19 += componentImprovement.value2;
                            break;
                    }
                    break;
                case C.HyperDrive:
                    if (componentImprovement.value1 > num20) num20 = componentImprovement.value1;
                    if (componentImprovement.value2 > num21) num21 = componentImprovement.value2;
                    if (componentImprovement.value3 < num22) num22 = componentImprovement.value3;
                    // Galaxy.9.cs ResolveHyperDriveIndex (3382): component.SpecialImageIndex.
                    this.hyperDriveIndex = componentImprovement.improvedComponent.specialImageIndex;
                    break;
                case C.HyperDisrupt:
                    if (componentImprovement.improvedComponent.type === T.HyperDeny) {
                        if (componentImprovement.value2 > this.weaponHyperDenyRange) this.weaponHyperDenyRange = componentImprovement.value2;
                    } else if (componentImprovement.improvedComponent.type === T.HyperStop && componentImprovement.value2 > this.hyperStopRange) {
                        this.hyperStopRange = toShort(componentImprovement.value2);
                    }
                    break;
                case C.ShieldRecharge:
                    if (toShort(componentImprovement.value1) > this.shieldAreaRechargeRange) {
                        this.shieldAreaRechargeRange = toShort(componentImprovement.value1);
                        this.shieldAreaRechargeCapacity = toShort(componentImprovement.value2);
                        this.shieldAreaRechargeEnergyRequired = toShort(componentImprovement.value3);
                    }
                    break;
                case C.Shields:
                    num9 += componentImprovement.value1;
                    num10 += componentImprovement.value2 / 10.0;
                    break;
                case C.Reactor:
                    this.reactorPowerOutput += componentImprovement.value1;
                    this.reactorStorageCapacity += componentImprovement.value2;
                    this.reactorCycleFuelConsumption += componentImprovement.value3;
                    this.fuelType = new ResourceRef(toByte(componentImprovement.value4));
                    break;
                case C.WeaponPointDefense: {
                    if (componentImprovement.value1 > 0 && componentImprovement.value2 > this.pointDefenseWeaponsRange) this.pointDefenseWeaponsRange = componentImprovement.value2;
                    this.weapons.push(Weapon.fromComponentImprovement(componentImprovement));
                    break;
                }
                case C.WeaponArea:
                case C.WeaponSuperArea: {
                    const item = Weapon.fromComponentImprovement(componentImprovement);
                    if (item.rawDamage > 0) {
                        num5 += componentImprovement.value1;
                        num6 = (num6 + num6Term(componentImprovement)) | 0;
                        if (componentImprovement.value2 > this.maximumWeaponsRange) this.maximumWeaponsRange = componentImprovement.value2;
                        if (componentImprovement.value2 < this.minimumWeaponsRange) this.minimumWeaponsRange = componentImprovement.value2;
                    }
                    if (item.bombardDamage > 0) num7 += item.bombardDamage;
                    this.weapons.push(item);
                    break;
                }
                case C.WeaponBeam:
                case C.WeaponSuperBeam:
                case C.WeaponTorpedo:
                case C.WeaponSuperTorpedo: {
                    // Design.cs 1473-1531: the beam and torpedo cases are identical.
                    if (componentImprovement.value1 > 0) {
                        num5 += componentImprovement.value1;
                        num6 = (num6 + num6Term(componentImprovement)) | 0;
                        if (componentImprovement.value2 > this.maximumWeaponsRange) this.maximumWeaponsRange = componentImprovement.value2;
                        if (componentImprovement.value2 < this.minimumWeaponsRange) this.minimumWeaponsRange = componentImprovement.value2;
                    }
                    if (componentImprovement.value7 > 0) num7 += componentImprovement.value7;
                    this.weapons.push(Weapon.fromComponentImprovement(componentImprovement));
                    break;
                }
                case C.Labs:
                    flag9 = true;
                    switch (componentImprovement.improvedComponent.type) {
                        case T.LabsEnergyLab:
                            this.researchEnergy += componentImprovement.value1;
                            break;
                        case T.LabsHighTechLab:
                            this.researchHighTech += componentImprovement.value1;
                            break;
                        case T.LabsWeaponsLab:
                            this.researchWeapons += componentImprovement.value1;
                            break;
                    }
                    break;
                case C.Extractor:
                    flag11 = true;
                    switch (componentImprovement.improvedComponent.type) {
                        case T.ExtractorGasExtractor:
                            this.extractionGas += componentImprovement.value1;
                            break;
                        case T.ExtractorMine:
                            this.extractionMine += componentImprovement.value1;
                            break;
                        case T.ExtractorLuxury:
                            this.extractionLuxury += componentImprovement.value1;
                            break;
                    }
                    break;
                case C.Manufacturer:
                    flag12 = true;
                    switch (componentImprovement.improvedComponent.type) {
                        case T.ManufacturerEnergyPlant:
                            this.manufactureEnergy += componentImprovement.value1;
                            break;
                        case T.ManufacturerHighTechPlant:
                            this.manufactureHighTech += componentImprovement.value1;
                            break;
                        case T.ManufacturerWeaponsPlant:
                            this.manufactureWeapons += componentImprovement.value1;
                            break;
                    }
                    break;
                case C.EnergyCollector:
                    flag13 = true;
                    if (componentImprovement.improvedComponent.type === T.EnergyCollector) this.energyCollection += componentImprovement.value1;
                    break;
                case C.Armor:
                    if (componentImprovement.improvedComponent.type === T.Armor) {
                        this.armor += componentImprovement.value1;
                        if (componentImprovement.value2 > this.armorReactive) this.armorReactive = componentImprovement.value2;
                    }
                    break;
                case C.Construction:
                    switch (componentImprovement.improvedComponent.type) {
                        case T.ConstructionBuild:
                            this.constructionYardCount++;
                            break;
                        case T.DamageControl:
                            if (componentImprovement.value1 > num26) num26 = componentImprovement.value1;
                            if (componentImprovement.value2 > 0 && (num28 === 0 || componentImprovement.value2 < num28)) num28 = componentImprovement.value2;
                            break;
                    }
                    break;
                case C.Computer:
                    switch (componentImprovement.improvedComponent.type) {
                        case T.ComputerTargettingFleet:
                            if (componentImprovement.value1 > this.targettingModifier) this.targettingModifier = toShort(componentImprovement.value1);
                            if (componentImprovement.value2 > this.fleetTargettingModifier) this.fleetTargettingModifier = toShort(componentImprovement.value2);
                            break;
                        case T.ComputerTargetting:
                            if (componentImprovement.value1 > this.targettingModifier) this.targettingModifier = componentImprovement.value1;
                            break;
                        case T.ComputerCountermeasuresFleet:
                            if (componentImprovement.value1 > this.countermeasureModifier) this.countermeasureModifier = toShort(componentImprovement.value1);
                            if (componentImprovement.value2 > this.fleetCountermeasureModifier) this.fleetCountermeasureModifier = toShort(componentImprovement.value2);
                            break;
                        case T.ComputerCountermeasures:
                            if (componentImprovement.value1 > this.countermeasureModifier) this.countermeasureModifier = componentImprovement.value1;
                            break;
                        case T.ComputerCommandCenter: {
                            const num30 = componentImprovement.value1 / 100.0;
                            if (num30 > this.maintenanceSavings) this.maintenanceSavings = num30;
                            break;
                        }
                        case T.ComputerCommerceCenter: {
                            const num29 = componentImprovement.value1 / 1000.0;
                            if (num29 > this.tradeBonuses) this.tradeBonuses = num29;
                            break;
                        }
                    }
                    break;
                case C.Sensor:
                    switch (componentImprovement.improvedComponent.type) {
                        case T.SensorStealth:
                            if (componentImprovement.value1 > num27) num27 = componentImprovement.value1;
                            break;
                        case T.SensorProximityArray:
                            if (componentImprovement.value1 > this.sensorProximityArrayRange) this.sensorProximityArrayRange = componentImprovement.value1;
                            break;
                        case T.SensorResourceProfileSensor:
                            if (componentImprovement.value1 > this.sensorResourceProfileSensorRange) this.sensorResourceProfileSensorRange = componentImprovement.value1;
                            break;
                        case T.SensorLongRange:
                            if (componentImprovement.value1 > this.sensorLongRange) this.sensorLongRange = componentImprovement.value1;
                            break;
                    }
                    break;
                case C.Habitation:
                    switch (componentImprovement.improvedComponent.type) {
                        case T.HabitationHabModule:
                            num25 += componentImprovement.value1;
                            break;
                        case T.HabitationLifeSupport:
                            num24 += componentImprovement.value1;
                            break;
                        case T.HabitationMedicalCenter:
                            if (componentImprovement.value1 > this.medicalCapacity) this.medicalCapacity = componentImprovement.value1;
                            break;
                        case T.HabitationRecreationCenter:
                            if (componentImprovement.value1 > this.recreationCapacity) this.recreationCapacity = componentImprovement.value1;
                            break;
                        case T.HabitationColonization:
                            this.isColony = true;
                            break;
                    }
                    break;
            }
            switch (componentImprovement.improvedComponent.type) {
                case T.WeaponTractorBeam: {
                    if (componentImprovement.value1 > 0) {
                        if (componentImprovement.value2 > this.maximumWeaponsRange) this.maximumWeaponsRange = componentImprovement.value2;
                        if (componentImprovement.value2 < this.minimumWeaponsRange) this.minimumWeaponsRange = componentImprovement.value2;
                        if (componentImprovement.value2 > this.tractorBeamRange) this.tractorBeamRange = toShort(componentImprovement.value2);
                    }
                    this.weapons.push(Weapon.fromComponentImprovement(componentImprovement));
                    break;
                }
                case T.WeaponGravityBeam:
                case T.WeaponAreaGravity: {
                    // Design.cs 1742-1781: the two cases are identical.
                    if (componentImprovement.value1 > 0) {
                        num5 += componentImprovement.value1;
                        num6 = (num6 + num6Term(componentImprovement)) | 0;
                        if (componentImprovement.value2 > this.maximumWeaponsRange) this.maximumWeaponsRange = componentImprovement.value2;
                        if (componentImprovement.value2 < this.minimumWeaponsRange) this.minimumWeaponsRange = componentImprovement.value2;
                    }
                    this.weapons.push(Weapon.fromComponentImprovement(componentImprovement));
                    break;
                }
                case T.WeaponIonDefense:
                    if (componentImprovement.value1 > this.ionDefense) this.ionDefense = componentImprovement.value1;
                    break;
                case T.WeaponIonPulse: {
                    const item = Weapon.fromComponentImprovement(componentImprovement);
                    this.weapons.push(item);
                    if (item.rawDamage > 0) {
                        num8 += componentImprovement.value1;
                        num5 += componentImprovement.value1;
                        if (componentImprovement.value2 > this.ionWeaponRange) this.ionWeaponRange = componentImprovement.value2;
                        if (componentImprovement.value2 > this.maximumWeaponsRange) this.maximumWeaponsRange = componentImprovement.value2;
                        if (componentImprovement.value2 < this.minimumWeaponsRange) this.minimumWeaponsRange = componentImprovement.value2;
                    }
                    break;
                }
                case T.WeaponIonCannon: {
                    if (componentImprovement.value1 > 0) {
                        num8 += componentImprovement.value1;
                        num5 += componentImprovement.value1;
                        if (componentImprovement.value2 > this.ionWeaponRange) this.ionWeaponRange = componentImprovement.value2;
                        if (componentImprovement.value2 > this.maximumWeaponsRange) this.maximumWeaponsRange = componentImprovement.value2;
                        if (componentImprovement.value2 < this.minimumWeaponsRange) this.minimumWeaponsRange = componentImprovement.value2;
                    }
                    this.weapons.push(Weapon.fromComponentImprovement(componentImprovement));
                    break;
                }
                case T.ConstructionBuild:
                    flag10 = true;
                    break;
                case T.ComputerCommerceCenter:
                    flag2 = true;
                    break;
                case T.StorageFuel:
                    flag3 = true;
                    num4 += componentImprovement.value1;
                    break;
                case T.StorageDockingBay:
                    flag4 = true;
                    this.dockingBayCount++;
                    break;
                case T.StorageCargo:
                    flag5 = true;
                    num += componentImprovement.value1;
                    break;
                case T.StorageTroop:
                    num2 += componentImprovement.value1;
                    break;
                case T.ComputerCommandCenter:
                    flag6 = true;
                    break;
                case T.HabitationLifeSupport:
                    flag7 = true;
                    break;
                case T.HabitationHabModule:
                    flag8 = true;
                    break;
            }
        }
        void num6;
        void num19;
        if (flag6 && flag7 && flag8) flag = true;
        if (flag && flag3 && flag4) this.isRefuellingDepot = true;
        if (this.isRefuellingDepot && flag2 && flag5) this.isSpacePort = true;
        if (flag && flag9) this.isResearchLab = true;
        if (flag && flag11) this.isResourceExtractor = true;
        if (flag && flag12) this.isManufacturer = true;
        if (flag && flag10 && flag12) this.isShipYard = true;
        if (flag && flag13) this.isEnergyCollector = true;
        // Design.cs 1851-1855: `if (IsResourceExtractor) { _ = Role; _ = 8; }` (no effect).
        if (num27 > 0) {
            const num31 = num27 / num23;
            this._stealth = Math.min(1.0, 0.5 / num31);
        }
        if (num26 > 0) this._damageReduction = num26 / 1000.0;
        const num32 = this.reactorPowerOutput - this.staticEnergyConsumption;
        num13 = num20;
        num11 = Math.trunc(num14 / Math.max(1, num23));
        num12 = Math.trunc(num15 / Math.max(1, num23));
        let num33: number;
        let num34: number;
        let num35: number;
        if (this.reactorPowerOutput > 0) {
            num33 = num21 / num32;
            num34 = num16 / num32;
            num35 = num17 / num32;
        } else {
            num33 = 1000000.0;
            num34 = 1000000.0;
            num35 = 1000000.0;
        }
        if (num33 > 1.0) {
            num13 = csInt(num13 / num33);
            num21 = csInt(num21 / num33);
        }
        if (num34 > 1.0) {
            num11 = csInt(num11 / num34);
            num16 = csInt(num16 / num34);
        }
        if (num35 > 1.0) {
            num12 = csInt(num12 / num35);
            num17 = csInt(num17 / num35);
        }
        if (this.minimumWeaponsRange >= 100000) this.minimumWeaponsRange = 0;
        this.size = num23;
        this.cargoCapacity = num;
        this.troopCapacity = num2;
        this.fighterCapacity = num3;
        this.fuelCapacity = num4;
        this.firepowerRaw = num5;
        this.bombardPower = num7;
        this.ionWeaponPower = num8;
        this.shieldsCapacity = num9;
        this.shieldRechargeRate = num10;
        this.population = Math.min(num25, num24);
        this.topSpeed = num11;
        this.topSpeedFuelBurn = num16;
        this.cruiseSpeed = num12;
        this.cruiseSpeedFuelBurn = num17;
        this.warpSpeed = num13;
        this.warpSpeedFuelBurn = num21;
        this.impulseSpeedFuelBurn = Math.trunc(this.cruiseSpeedFuelBurn / 4);
        this.hyperjumpInitiate = Math.min(15, num22);
        this.turnRate = 0.1 + (num18 * 2.0) / num23;
        const num36 = this.reactorPowerOutput - this.staticEnergyConsumption;
        let num37 = num36 / num16;
        if (num37 > 1.0) {
            num37 = Math.sqrt(Math.sqrt(num37));
            num37 = Math.min(num37, 2.0);
        }
        this.accelerationRate = (num11 / 8.0 + 0.5) * num37;
        this._damageRepair = num28;
        baconDesignRedefine(this);
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

    /**
     * Design.cs CalculateTechLevel(empire, galaxy) (959). `componentMaxTechPoints` is
     * ResearchSystem.ComponentMaxTechPoints (static in C#; see designGeneration.ts
     * researchComponentMaxTechPoints). `galaxy` is only null-checked by the C# callers.
     * C# accumulates into a long: exact in a JS double while < 2^53 (max points ~2^31 × size).
     */
    calculateTechLevel(empire: DesignOwner | null, componentMaxTechPoints: number[]): number {
        let result = 1.0;
        if (empire !== null) {
            let num = 0;
            for (let i = 0; i < this.components.length; i++) {
                const component = this.components[i];
                if (component != null && empire.research != null) {
                    const num2 = componentMaxTechPoints[component.componentId];
                    num += num2 * component.size;
                }
            }
            let num3 = this.size;
            if (num3 <= 0) {
                num3 = this.quickCalculateSize();
            }
            result = num / num3;
        }
        return result;
    }
}

// BaconDesign.Redefine (BaconDesign.cs 138): re-ReDefine the owner's (private)
// built objects of this design. C# swallows any exception (try/catch).
function baconDesignRedefine(design: Design): void {
    const empire = design.empire;
    if (empire === null) return;
    try {
        for (const x of empire.builtObjects ?? []) {
            const bo = x as { design?: Design; reDefine?: () => void };
            if (bo.design !== design) continue;
            bo.reDefine?.();
        }
        for (const x of empire.privateBuiltObjects ?? []) {
            const bo = x as { design?: Design; reDefine?: () => void };
            if (bo.design !== design) continue;
            bo.reDefine?.();
        }
    } catch {
        // C#: catch (Exception) { }
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
