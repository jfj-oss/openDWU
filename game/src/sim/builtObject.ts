// Ships and bases (task M3a). Port of the BuiltObject.cs parts needed at game
// start: the fields later code reads/sets, the constructors
// BuiltObject(design, name, galaxy[, fullyBuilt[, doNotAssignEmpire]])
// (BuiltObject.cs 1550-1628) and BuiltObject.ReDefine (2045-3413) with what it
// calls: BuiltObjectComponent(List) (builtObjectComponent.ts), Weapon/WeaponList
// (weapon.ts), DockingBay/DockingBayList, ReviewWeaponsComponentValues,
// ActualEmpire, and BaconBuiltObject.ModMyShip / ModWeaponRangeForBases /
// CargoBayCapacityMultiplier / IsMyShip.
// Rnd: none — neither the constructors nor ReDefine draw from Galaxy.Rnd.
// Subsystems not ported yet are TODO(port) at the exact spot, with the value C#
// sees at game start: ConstructionQueue / ManufacturingQueue (created by
// ReDefine for shipyards / manufacturers), fighters (FighterList), characters,
// contracts, missions, UpdatePosition, the AnnualSupportCost getter.

import { BuiltObjectSubRole } from './builtObjectTypes';
import { BuiltObjectComponent, BuiltObjectComponentList, ComponentStatus, csInt, toByte, toShort } from './builtObjectComponent';
import { CargoList, ResourceRef, TroopList, type Troop } from './cargo';
import { componentImprovementFromComponent, type ComponentImprovementEntry } from './componentStatic';
import { ComponentType } from './data/components';
import { BattleTactics, BuiltObjectFleeWhen, BuiltObjectRole, InvasionTactics } from './data/designSpecifications';
import { ComponentCategoryType, type EmpirePolicy } from './data/policies';
import type { Race } from './data/races';
import { BuiltObjectStance, galaxyComponentCurrentPrices, type Design } from './design';
import type { Empire } from './empire';
import type { Galaxy } from './galaxy';
import { PopulationList } from './population';
import type { Habitat } from './types';
import { Weapon, weaponsDetermineNotInSuppliedList, weaponsQuickCompareEquivalent, weaponsRemoveAndResetFirstMatchingWeaponById } from './weapon';

// Port of EngineType.cs (byte enum, member order exact).
export enum EngineType {
    Undefined,
    Proton,
    Quantum,
    Acceleros,
    Vortex,
    StarBurner,
    TurboThruster,
}

// Port of TurnDirection.cs (member order exact).
export enum TurnDirection {
    Undefined,
    StraightAhead,
    Left,
    Right,
}

// Port of DockingBay.cs.
export class DockingBay {
    private _dockedShip: BuiltObject | null = null;
    _capacity: number;
    private _componentId: number; // short
    private _builtObjectComponentId: number; // short

    constructor(componentId: number, builtObjectComponentId: number, capacity: number) {
        this._capacity = capacity;
        this._componentId = toShort(componentId);
        this._builtObjectComponentId = builtObjectComponentId;
    }

    get parentBuiltObjectComponentId(): number { return this._builtObjectComponentId; }
    get parentComponentId(): number { return this._componentId; }
    get dockedShip(): BuiltObject | null { return this._dockedShip; }
    set dockedShip(v: BuiltObject | null) { this._dockedShip = v; }
    get capacity(): number { return this._capacity; }
}

// DockingBayList.IndexOf(BuiltObjectComponent) (DockingBayList.cs 91).
function dockingBayIndexOf(list: DockingBay[], builtObjectComponent: BuiltObjectComponent | null): number {
    if (builtObjectComponent !== null && builtObjectComponent.builtObjectComponentId >= 0) {
        for (let index = 0; index < list.length; ++index) {
            if (builtObjectComponent.builtObjectComponentId === list[index].parentBuiltObjectComponentId) return index;
        }
    }
    return -1;
}

// Race.cs SpaceportArmorStrengthFactor (default 1.0; parsed values clamped to
// [0.3, 3.0], Race.cs:1579), read from the race file's extra keys.
function raceSpaceportArmorStrengthFactor(race: Race): number {
    const raw = race.extra?.['SpaceportArmorStrengthFactor'];
    if (raw === undefined) return 1.0;
    return Math.min(3.0, Math.max(0.3, Number(raw)));
}

// C# Convert.ToInt32(float): round half to even.
function convertToInt32(f: number): number {
    const r = Math.round(f);
    return (Math.abs(f % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r) | 0;
}

// Empire.cs:367 AttackRangeOther (default 48000; Empire.SetAutomationSettings copies
// GameOptions.AttackRangeOther, also 48000 by default — GameOptions.cs:56).
// TODO(port): Empire.AttackRangeOther field (read here when present).
function empireAttackRangeOther(empire: Empire): number {
    return (empire as Empire & { attackRangeOther?: number }).attackRangeOther ?? 48000;
}

// Port of BuiltObject.cs (StellarObject.cs base fields included).
export class BuiltObject {
    // --- StellarObject.cs ---
    xpos = 0;
    ypos = 0;
    gameEventId = -32768; // short.MinValue
    cargo: CargoList | null = null;
    population: PopulationList | null = null;
    empire: Empire | null = null;
    owner: Empire | null = null;
    dockingBays: DockingBay[] | null = null;
    // TODO(port): ConstructionQueue (ConstructionQueue.cs) — see ReDefine.
    constructionQueue: unknown = null;
    isRefuellingDepot = false;
    isShipYard = false;
    troops: TroopList | null = null;
    characters: unknown[] | null = null; // CharacterList
    name = '';
    dockingBayWaitQueue: BuiltObject[] | null = null;
    stealth = 1; // float
    sortTag = 0;
    raidCountdown = 0; // byte
    attackers: unknown[] | null = null; // StellarObjectList
    pursuers: unknown[] | null = null; // StellarObjectList
    firepowerRaw = 0;
    topSpeed = 0; // short
    isFunctional = false;
    hasBeenDestroyed = false;
    currentSpeed = 0; // float
    targetHeading = 0; // float
    parentHabitat: Habitat | null = null;
    parentBuiltObject: BuiltObject | null = null;
    currentTarget: unknown = null; // StellarObject
    size = 0;

    // --- BuiltObject.cs ---
    builtObjectID = 0;
    inView = false;
    private _isPlanetDestroyer = false;
    private _deployProgress = 0; // float
    private _isDeployed = false;
    firstExecutionOfCommand = true;
    private _isIndependentOrPirate = false;
    private _topSpeedBase = 0; // short
    topSpeedFuelBurn = 0; // short
    private _cruiseSpeedBase = 0; // short
    cruiseSpeed = 0; // short
    cruiseSpeedFuelBurn = 0; // short
    warpSpeed = 0;
    warpSpeedFuelBurn = 0;
    hyperjumpInitiate = 0; // short
    impulseSpeedFuelBurn = 0; // short
    engineType = EngineType.Undefined;
    accelerationRate = 0; // float
    currentFuel = 0;
    _fuelHandicapped = false;
    fuelCapacity = 0;
    attackRangeSquared = 0; // float
    currentEnergy = 0;
    staticEnergyConsumption = 0;
    reactorPowerOutput = 0;
    reactorStorageCapacity = 0;
    reactorCycleFuelConsumption = 0;
    currentReactorStorage = 0;
    targetSpeedChanged = false;
    preferredSpeed = 0; // float
    private _cargoCapacity = 0;
    troopCapacity = 0;
    role: BuiltObjectRole = 0 as BuiltObjectRole;
    subRole: BuiltObjectSubRole = BuiltObjectSubRole.Undefined;
    private _heading = 0; // float
    headingChanged = true;
    turnRate = 0; // float
    private _turnDirection = TurnDirection.StraightAhead;
    overlayChanged = true;
    lightChanged = true;
    lightsOn = false;
    stance: BuiltObjectStance = BuiltObjectStance.Undefined;
    purchasePrice = 0;
    currentYearsIncome = 0;
    dateOfLastIncome = 0;
    consecutiveUnprofitableYears = 0;
    scrap = false;
    private _annualSupportCost = 0;
    private _supportCostFactor = 1; // float
    tacticsStrongerShips: BattleTactics = 0 as BattleTactics;
    tacticsWeakerShips: BattleTactics = 0 as BattleTactics;
    tacticsInvasion: InvasionTactics = 0 as InvasionTactics;
    fleeWhen: BuiltObjectFleeWhen = 0 as BuiltObjectFleeWhen;
    dateBuilt = 0;
    dateRetrofit = 0;
    currentShields = 0; // float
    shieldsCapacity = 0;
    shieldRechargeRate = 0; // float
    shieldAreaRechargeRange = 0; // short
    shieldAreaRechargeCapacity = 0; // short
    shieldAreaRechargeEnergyRequired = 0; // short
    shieldAreaRechargeTarget: BuiltObject | null = null;
    armor = 0; // short
    armorReactive = 0; // short
    armorReinforcingFactor = 0; // short
    targettingModifier = 0; // short
    countermeasureModifier = 0; // short
    fleetTargettingModifier = 0; // short
    fleetCountermeasureModifier = 0; // short
    fleetTargettingBonus = 0; // short
    fleetCountermeasureBonus = 0; // short
    maintenanceSavings = 0; // float
    tradeBonuses = 0; // float
    pictureRef = 0;
    isSpacePort = false;
    isColony = false;
    isResearchLab = false;
    researchWeapons = 0;
    researchEnergy = 0;
    researchHighTech = 0;
    isResourceExtractor = false;
    extractionMine = 0; // short
    extractionGas = 0; // short
    extractionLuxury = 0; // short
    energyToFuelRate = 0; // short
    isManufacturer = false;
    isEnergyCollector = false;
    private energyCollection = 0;
    sensorProximityArrayRange = 0;
    sensorJumpIntercept = 0; // byte
    sensorResourceProfileSensorRange = 0;
    sensorLongRange = 0;
    sensorTraceScannerRange = 0; // short
    sensorTraceScannerPower = 0; // short
    sensorTraceScannerJamming = 0; // short
    maxPopulation = 0;
    populationCapacity = 0;
    medicalCapacity = 0;
    recreationCapacity = 0;
    parentOffsetX = -2000000001.0;
    parentOffsetY = -2000000001.0;
    suppressAutoRetrofit = false;
    hyperDenyActive = false;
    weaponHyperDenyRange = 0;
    hyperStopRange = 0; // short
    canHyperJump = true;
    maximumWeaponsRange = 0;
    minimumWeaponsRange = 0;
    pointDefenseWeaponsRange = 0;
    planetDestroyerWeaponsRange = 0;
    bombardWeaponPower = 0;
    bombardRange = 0;
    ionWeaponPower = 0;
    ionWeaponRange = 0;
    ionDefense = 0;
    tractorBeamRange = 0; // short
    assaultStrength = 0; // short
    assaultRange = 0; // short
    assaultShieldPenetration = 0; // short
    assaultAttackValue = 0; // short
    assaultDefenseValue = 0; // short
    assaultAttackEmpireId = 0; // byte
    assaultIsRaid = false;
    pirateEmpireId = 0; // byte
    private _damageReduction = 0; // float
    private _damageRepair = 0; // short
    lastRepair = 0;
    standoffWeaponsMaxRange = 0;
    beamWeaponsMinRange = 0;
    currentEscortForceAssigned = 0;
    refuelForNextMission = false;
    retireForNextMission = false;
    retrofitForNextMission = false;
    repairForNextMission = false;
    strandedMessageSent = false;
    private _isBlockaded = false;
    isAutoControlled = true;
    inBattle = false;
    private _targetSpeed = 0;
    troopLoadoutInfantry = 0; // byte
    troopLoadoutArmored = 0; // byte
    troopLoadoutArtillery = 0; // byte
    troopLoadoutSpecialForces = 0; // byte
    unbuiltComponentCount = 0;
    damagedComponentCount = 0;
    undamagedComponentSize = 0;
    /** C#: public Galaxy _Galaxy. */
    _galaxy: Galaxy;
    fuelType: ResourceRef | null = null;
    // TODO(port): ManufacturingQueue (ManufacturingQueue.cs) — see ReDefine.
    private _manufacturingQueue: unknown = null;
    // TODO(port): Fighter / FighterList (Fighter.cs) — only the list is created.
    fighters: unknown[] | null = null;
    fighterCapacity = 0;
    fighterRepairRate = 0;
    design: Design;
    shipGroup: unknown = null; // TODO(port): ShipGroup (fleets).
    nativeRace: Race | null = null;
    // TODO(port): ContractList (Contract.cs) — empty list at construction.
    private _contractsToFulfill: unknown[] = [];
    retrofitDesign: Design | null = null;
    nearestSystemStar: Habitat | null = null;
    // TODO(port): BuiltObjectMission (BuiltObjectMission.cs) — null at game start.
    mission: unknown = null;
    subsequentMissions: unknown[] = [];
    components: BuiltObjectComponentList;
    disabledComponentIndexes: number[] | null = null;
    disabledComponentDurations: number[] | null = null;
    weapons: Weapon[];
    captainName = '';
    /** C#: StellarObject BuiltAt (the yard building it); null for ships created fully built. */
    builtAt: unknown = null;

    /**
     * BaconBuiltObject.myMain._Game.Galaxy, read by BaconBuiltObject.ModMyShip. It is
     * null during game-start generation (Start.cs:1871 assigns main._Game only after
     * the galaxy is fully set up), which is when this port runs.
     */
    static baconMainGameGalaxy: Galaxy | null = null;

    // BuiltObject(Design, string, Galaxy[, bool fullyBuilt = false[, bool doNotAssignEmpire = false]])
    // (BuiltObject.cs 1550-1628). No Galaxy.Rnd use.
    constructor(design: Design, name: string, galaxy: Galaxy, fullyBuilt = false, doNotAssignEmpire = false) {
        this._galaxy = galaxy;
        this.design = design;
        this.components = new BuiltObjectComponentList();
        if (fullyBuilt) {
            for (let i = 0; i < design.components.length; i++) {
                const component = design.components[i];
                this.components.add(new BuiltObjectComponent(component, ComponentStatus.Normal));
            }
        } else {
            for (let j = 0; j < design.components.length; j++) {
                const component3 = design.components[j];
                this.components.add(new BuiltObjectComponent(component3, ComponentStatus.Unbuilt));
            }
        }
        this.dockingBays = null;
        this.dockingBayWaitQueue = null;
        this.constructionQueue = null;
        this._manufacturingQueue = null;
        this.weapons = [];
        this.attackers = [];
        this.pursuers = [];
        this.troops = null;
        this.characters = []; // TODO(port): CharacterList (characters).
        this._contractsToFulfill = [];
        this.purchasePrice = design.calculateCurrentPurchasePrice(this._galaxy);
        this.name = name;
        if (!doNotAssignEmpire) {
            this.empire = design.empire as Empire | null;
            if (design.empire !== null && design.empire.pirateEmpireBaseHabitat != null) {
                this.pirateEmpireId = toByte(design.empire.empireId);
            }
        }
        this.firstExecutionOfCommand = true;
        this.pictureRef = design.pictureRef;
        this.role = design.role;
        this.subRole = design.subRole;
        this.stance = design.stance;
        this.fleeWhen = design.fleeWhen;
        if ((this.role === BuiltObjectRole.Military || this.role === BuiltObjectRole.Base) && this.empire !== null) {
            const attackRangeOther = empireAttackRangeOther(this.empire);
            if (attackRangeOther < 0) this.attackRangeSquared = Math.fround(2.304e9);
            else this.attackRangeSquared = Math.fround(Math.fround(attackRangeOther) * Math.fround(attackRangeOther));
        }
        this.currentFuel = 0.0;
        this.heading = Math.fround(Math.fround(-Math.fround(Math.PI)) / 2);
        this.targetHeading = this.heading;
        if (this.empire === this._galaxy.independentEmpire || (this.empire !== null && this._galaxy.pirateEmpires.includes(this.empire))) {
            this._isIndependentOrPirate = true;
        }
        this.suppressAutoRetrofit = !this.design.allowAutoRetrofit;
    }

    // --- Properties (BuiltObject.cs 600-900) ---
    get cargoCapacity(): number { return this._cargoCapacity; }
    get supportCostFactor(): number { return this._supportCostFactor; }
    set supportCostFactor(v: number) { this._supportCostFactor = Math.fround(v); }
    get turnDirection(): TurnDirection { return this._turnDirection; }
    get manufacturingQueue(): unknown { return this._manufacturingQueue; }
    get unbuiltOrDamagedComponentCount(): number { return this.unbuiltComponentCount + this.damagedComponentCount; }
    get isBlockaded(): boolean { return this._isBlockaded; }
    set isBlockaded(v: boolean) { this._isBlockaded = v; }
    get contractsToFulfill(): unknown[] { return this._contractsToFulfill; }
    set contractsToFulfill(v: unknown[]) { this._contractsToFulfill = v; }
    get heading(): number { return this._heading; }
    set heading(value: number) {
        if (this._heading !== value) this.headingChanged = true;
        this._heading = value;
    }
    get isPlanetDestroyer(): boolean { return this._isPlanetDestroyer; }
    get deployProgress(): number { return this._deployProgress; }
    get isDeployed(): boolean { return this._isDeployed; }
    get damageReduction(): number { return this._damageReduction; }
    get damageRepair(): number { return this._damageRepair; }
    get isIndependentOrPirate(): boolean { return this._isIndependentOrPirate; }
    get targetSpeed(): number { return this._targetSpeed; }
    set targetSpeed(value: number) {
        if (this._targetSpeed !== value) this.targetSpeedChanged = true;
        this._targetSpeed = value;
    }
    get topSpeedBase(): number { return this._topSpeedBase; }
    get cruiseSpeedBase(): number { return this._cruiseSpeedBase; }
    /** C# private _AnnualSupportCost (what the AnnualSupportCost setter stores). */
    get annualSupportCostBase(): number { return this._annualSupportCost; }
    // BuiltObject.AnnualSupportCost setter. TODO(port): the getter (BuiltObject.cs 770) needs
    // ShipMaintenanceCostPerSizeUnit, colony resource bonuses, characters, government
    // maintenance factors and the empire state/private maintenance factors.
    set annualSupportCost(value: number) { this._annualSupportCost = value; }

    // BuiltObject.PopulationCapacityRemaining.
    get populationCapacityRemaining(): number {
        let num = 0;
        if (this.population !== null) num = Math.trunc(this.population.totalAmount);
        return Math.max(0, this.populationCapacity - num);
    }

    // BuiltObject.CargoSpace.
    get cargoSpace(): number {
        if (this.role === BuiltObjectRole.Base && this.parentHabitat !== null && this.parentHabitat.population.totalAmount > 0) return 536870911;
        if (this.empire !== null && (this.subRole === BuiltObjectSubRole.SmallSpacePort || this.subRole === BuiltObjectSubRole.MediumSpacePort || this.subRole === BuiltObjectSubRole.LargeSpacePort)) return 536870911;
        let num = 0;
        if (this.cargo !== null) for (const c of this.cargo.items) num += c.amount;
        num = Math.max(0, num);
        let num2 = this.cargoCapacity - num;
        if (num2 < 0) num2 = 0;
        return num2;
    }

    // BuiltObject.ActualEmpire.
    get actualEmpire(): Empire | null {
        let empire = this.empire;
        if (this.pirateEmpireId > 0 && empire !== null && empire.empireId !== this.pirateEmpireId) {
            // PirateEmpires.GetByEmpireId (EmpireList.cs).
            empire = this._galaxy.pirateEmpires.find((e) => e.empireId === this.pirateEmpireId) ?? null;
        }
        return empire;
    }

    // BuiltObject.TroopCapacityRemaining (BuiltObject.cs 768).
    get troopCapacityRemaining(): number {
        let num = 0;
        if (this.troops !== null) num = this.troops.totalSize;
        const val = this.troopCapacity - num;
        return Math.max(0, val);
    }

    // Port of BuiltObject.SetTroopLoadoutsFromPolicy(EmpirePolicy) (BuiltObject.cs 1630-1713),
    // with Galaxy.CalculateDefaultTroopMaintenanceMultiplier (Galaxy.7.cs 5505: Infantry 1,
    // Armored 2, Artillery 4, SpecialForces 2). No Rnd.
    setTroopLoadoutsFromPolicy(policy: EmpirePolicy | null): void {
        if (policy === null) return;
        const f = Math.fround;
        if (policy.troopUseDefaultTransportLoadout) {
            const num = Math.trunc(100.0 * 1.0);
            const num2 = Math.trunc(100.0 * 2.0);
            const num3 = Math.trunc(100.0 * 4.0);
            const num4 = Math.trunc(100.0 * 2.0);
            const troopCapacity = this.troopCapacity;
            const inf = f(policy.troopDefaultTransportLoadoutInfantry);
            const arm = f(policy.troopDefaultTransportLoadoutArmor);
            const art = f(policy.troopDefaultTransportLoadoutArtillery);
            const spf = f(policy.troopDefaultTransportLoadoutSpecialForces);
            const num5 = f(f(f(inf + arm) + art) + spf);
            const num6 = f(1 / num5);
            let num7 = csInt(f(f(f(troopCapacity) * inf) * num6));
            let num8 = csInt(f(f(f(troopCapacity) * arm) * num6));
            let num9 = csInt(f(f(f(troopCapacity) * art) * num6));
            let num10 = csInt(f(f(f(troopCapacity) * spf) * num6));
            if (num10 < num4) {
                num7 += num10;
                num10 = 0;
            }
            if (num9 < num3) {
                num7 += num9;
                num9 = 0;
            }
            if (num8 < num2) {
                num7 += num8;
                num8 = 0;
            }
            num7 = Math.trunc(num7 / num) * num;
            num8 = Math.trunc(num8 / num2) * num2;
            num9 = Math.trunc(num9 / num3) * num3;
            num10 = Math.trunc(num10 / num4) * num4;
            const num11 = num7 + num9 + num8 + num10;
            let num12 = troopCapacity - num11;
            if (num12 >= 100 && this.empire !== null) {
                const e = this.empire;
                if (num12 >= num2 && e.troopCanRecruitArmored && this.troopLoadoutArmored >= this.troopLoadoutInfantry && this.troopLoadoutArmored >= this.troopLoadoutArtillery && this.troopLoadoutArmored >= this.troopLoadoutSpecialForces) {
                    const num13 = Math.trunc(num12 / num2);
                    num8 += num13 * num2;
                    num12 -= num13 * num2;
                }
                if (num12 >= num4 && e.troopCanRecruitSpecialForces && this.troopLoadoutSpecialForces >= this.troopLoadoutInfantry && this.troopLoadoutSpecialForces >= this.troopLoadoutArtillery && this.troopLoadoutSpecialForces >= this.troopLoadoutArmored) {
                    const num14 = Math.trunc(num12 / num4);
                    num10 += num14 * num4;
                    num12 -= num14 * num4;
                }
                if (num12 >= num3 && e.troopCanRecruitArtillery && this.troopLoadoutArtillery >= this.troopLoadoutInfantry && this.troopLoadoutArtillery >= this.troopLoadoutArmored && this.troopLoadoutArtillery >= this.troopLoadoutSpecialForces) {
                    const num15 = Math.trunc(num12 / num3);
                    num9 += num15 * num3;
                    num12 -= num15 * num3;
                }
                if (num12 >= num && e.troopCanRecruitInfantry && this.troopLoadoutInfantry >= this.troopLoadoutArmored && this.troopLoadoutInfantry >= this.troopLoadoutArtillery && this.troopLoadoutInfantry >= this.troopLoadoutSpecialForces) {
                    const num16 = Math.trunc(num12 / num);
                    num7 += num16 * num;
                    num12 -= num16 * num;
                }
                if (num12 >= 100) {
                    const num17 = Math.trunc(num12 / num);
                    num7 += num17 * num;
                    num12 -= num17 * num;
                }
            }
            this.troopLoadoutInfantry = toByte(Math.trunc(num7 / num));
            this.troopLoadoutArmored = toByte(Math.trunc(num8 / num2));
            this.troopLoadoutArtillery = toByte(Math.trunc(num9 / num3));
            this.troopLoadoutSpecialForces = toByte(Math.trunc(num10 / num4));
        } else {
            this.troopLoadoutInfantry = 255;
            this.troopLoadoutArmored = 255;
            this.troopLoadoutArtillery = 255;
            this.troopLoadoutSpecialForces = 255;
        }
    }

    // BuiltObject.ReviewWeaponsComponentValues (2033).
    reviewWeaponsComponentValues(): void {
        if (this.weapons !== null && this.weapons.length > 0) {
            for (let i = 0; i < this.weapons.length; i++) this.weapons[i].reviewValues(this.empire);
        }
    }

    // BuiltObject.ReDefine (BuiltObject.cs 2045-3413). No Galaxy.Rnd use.
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
        const sensorLongRange = this.sensorLongRange;
        this.reactorPowerOutput = 0;
        this.reactorStorageCapacity = 0;
        this.reactorCycleFuelConsumption = 0;
        this.staticEnergyConsumption = 0;
        this.sensorProximityArrayRange = 0;
        this.sensorResourceProfileSensorRange = 0;
        this.sensorLongRange = 0;
        this.sensorTraceScannerRange = 0;
        this.sensorTraceScannerPower = 0;
        this.sensorTraceScannerJamming = 0;
        this.weaponHyperDenyRange = 0;
        this.hyperStopRange = 0;
        this.maximumWeaponsRange = 0;
        this.minimumWeaponsRange = 100000;
        this.standoffWeaponsMaxRange = 0;
        this.beamWeaponsMinRange = 100000;
        this.pointDefenseWeaponsRange = 0;
        this.ionDefense = 0;
        this.ionWeaponPower = 0;
        this.ionWeaponRange = 0;
        this.armor = 0;
        this.armorReactive = 0;
        this.armorReinforcingFactor = 0;
        this.stealth = 1;
        this._damageReduction = 0;
        this._damageRepair = 0;
        this.isColony = false;
        this.isEnergyCollector = false;
        this.isFunctional = false;
        this.isManufacturer = false;
        this.isRefuellingDepot = false;
        this.isResearchLab = false;
        this.isResourceExtractor = false;
        this.isShipYard = false;
        this.isSpacePort = false;
        this.hyperDenyActive = false;
        this._isPlanetDestroyer = false;
        this.researchWeapons = 0;
        this.researchEnergy = 0;
        this.researchHighTech = 0;
        this.extractionMine = 0;
        this.extractionGas = 0;
        this.extractionLuxury = 0;
        this.energyToFuelRate = 0;
        this.energyCollection = 0;
        this.medicalCapacity = 0;
        this.recreationCapacity = 0;
        this.countermeasureModifier = 0;
        this.targettingModifier = 0;
        this.fleetTargettingModifier = 0;
        this.fleetCountermeasureModifier = 0;
        this.maintenanceSavings = 0;
        this.tradeBonuses = 0;
        this.shieldAreaRechargeRange = 0;
        this.shieldAreaRechargeCapacity = 0;
        this.shieldAreaRechargeEnergyRequired = 0;
        this.shieldAreaRechargeTarget = null;
        this.tractorBeamRange = 0;
        this.assaultStrength = 0;
        this.assaultRange = 0;
        this.assaultShieldPenetration = 0;
        let num = 0;
        let num2 = 0;
        let num3 = 0;
        let num4 = 0;
        let num5 = 0;
        let num6 = 0;
        let num7 = 10000;
        let num8 = 0;
        let num9 = 0;
        let num10 = 0; // float
        let num11 = 0; // short
        let num12 = 0; // short
        let num13 = 0;
        let num14 = 0;
        let num15 = 0;
        let num16 = 0;
        let num17 = 0;
        let num18 = 0;
        let num19 = 0;
        let num20 = 0;
        let num21 = 0;
        let num22 = 32767; // short.MaxValue
        let num23 = 0;
        let num24 = 0;
        let num25 = 0;
        let num26 = 0;
        let num27 = 0;
        let num28 = 0.0;
        let num29 = 0;
        let num30 = 0;
        let num31 = 0; // short
        let num32 = 0;
        let num33 = 0;
        let num34 = 0;
        let num35 = 0;
        let num36 = 0;
        let num37 = 0;
        let num38 = 0;
        let num39 = 0;
        let num40 = 0;
        let num41 = 0;
        const weaponList: Weapon[] = [];
        const componentCurrentPrices = galaxyComponentCurrentPrices(this._galaxy);
        const isSuperWeaponPlanetDestroyer = (ci: ComponentImprovementEntry): boolean => {
            const t = ci.improvedComponent.type;
            return (t === T.WeaponSuperBeam || t === T.WeaponSuperTorpedo || t === T.WeaponSuperMissile || t === T.WeaponSuperRailGun || t === T.WeaponSuperPhaser) && ci.improvedComponent.value1 >= 10000;
        };
        for (let i = 0; i < this.components.count; i++) {
            const comp = this.components.items[i];
            num28 += componentCurrentPrices[comp.componentId];
            num23 += comp.size;
            this.staticEnergyConsumption += comp.energyUsed;
            if (comp.status === ComponentStatus.Normal) {
                num32 += comp.size;
                let flag11 = false;
                if (this.disabledComponentIndexes !== null && this.disabledComponentIndexes.length > 0 && this.disabledComponentIndexes.includes(toShort(i))) flag11 = true;
                if (flag11) continue;
                const actualEmpire = this.actualEmpire;
                const componentImprovement: ComponentImprovementEntry =
                    actualEmpire === null || actualEmpire.research === null ? componentImprovementFromComponent(comp.def) : actualEmpire.research.resolveImprovedComponentValues(comp.def);
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
                        weaponList.push(Weapon.fromComponentImprovement(componentImprovement));
                        break;
                    }
                    case C.Fighter:
                        if (componentImprovement.improvedComponent.type === T.FighterBay) {
                            num33 += componentImprovement.value1;
                            num34 += componentImprovement.value2;
                        }
                        break;
                    case C.Engine:
                        switch (componentImprovement.improvedComponent.type) {
                            case T.EngineMainThrust:
                                num14 += componentImprovement.value1;
                                num16 += componentImprovement.value2;
                                num15 += componentImprovement.value3;
                                num17 += componentImprovement.value4;
                                switch (componentImprovement.improvedComponent.specialImageIndex) {
                                    case 0: num35++; break;
                                    case 1: num36++; break;
                                    case 2: num37++; break;
                                    case 3: num38++; break;
                                    case 4: num39++; break;
                                    case 5: num40++; break;
                                }
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
                        if (componentImprovement.value3 < num22) num22 = toShort(componentImprovement.value3);
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
                        num10 = Math.fround(num10 + Math.fround(Math.fround(componentImprovement.value2) / 10));
                        break;
                    case C.Reactor:
                        this.reactorPowerOutput += componentImprovement.value1;
                        this.reactorStorageCapacity += componentImprovement.value2;
                        this.reactorCycleFuelConsumption += componentImprovement.value3;
                        this.fuelType = new ResourceRef(toByte(componentImprovement.value4));
                        break;
                    case C.WeaponArea:
                    case C.WeaponSuperArea: {
                        const item = Weapon.fromComponentImprovement(componentImprovement);
                        weaponList.push(item);
                        if (item.rawDamage > 0) {
                            num5 += componentImprovement.value1;
                            if (componentImprovement.value2 > this.standoffWeaponsMaxRange) this.standoffWeaponsMaxRange = componentImprovement.value2;
                            if (componentImprovement.value2 > this.maximumWeaponsRange) this.maximumWeaponsRange = componentImprovement.value2;
                            if (componentImprovement.value2 < this.minimumWeaponsRange) this.minimumWeaponsRange = componentImprovement.value2;
                        }
                        if (item.bombardDamage > 0) {
                            num6 += componentImprovement.value7;
                            if (componentImprovement.value2 < num7) num7 = componentImprovement.value2;
                        }
                        break;
                    }
                    case C.WeaponPointDefense: {
                        if (componentImprovement.value1 > 0 && componentImprovement.value2 > this.pointDefenseWeaponsRange) this.pointDefenseWeaponsRange = componentImprovement.value2;
                        weaponList.push(Weapon.fromComponentImprovement(componentImprovement));
                        break;
                    }
                    case C.WeaponBeam:
                    case C.WeaponSuperBeam: {
                        if (componentImprovement.value1 > 0) {
                            num5 += componentImprovement.value1;
                            if (componentImprovement.value2 < this.beamWeaponsMinRange) this.beamWeaponsMinRange = componentImprovement.value2;
                            if (componentImprovement.value2 > this.maximumWeaponsRange) this.maximumWeaponsRange = componentImprovement.value2;
                            if (componentImprovement.value2 < this.minimumWeaponsRange) this.minimumWeaponsRange = componentImprovement.value2;
                        }
                        if (componentImprovement.value7 > 0) {
                            num6 += componentImprovement.value7;
                            if (componentImprovement.value2 < num7) num7 = componentImprovement.value2;
                        }
                        weaponList.push(Weapon.fromComponentImprovement(componentImprovement));
                        if (isSuperWeaponPlanetDestroyer(componentImprovement)) {
                            this.planetDestroyerWeaponsRange = csInt(componentImprovement.value2 * 0.9);
                            if (this.role === BuiltObjectRole.Military) this._isPlanetDestroyer = true;
                        }
                        break;
                    }
                    case C.WeaponTorpedo:
                    case C.WeaponSuperTorpedo: {
                        if (componentImprovement.value1 > 0) {
                            num5 += componentImprovement.value1;
                            if (componentImprovement.value2 > this.standoffWeaponsMaxRange) this.standoffWeaponsMaxRange = componentImprovement.value2;
                            if (componentImprovement.value2 > this.maximumWeaponsRange) this.maximumWeaponsRange = componentImprovement.value2;
                            if (componentImprovement.value2 < this.minimumWeaponsRange) this.minimumWeaponsRange = componentImprovement.value2;
                        }
                        if (componentImprovement.value7 > 0) {
                            num6 += componentImprovement.value7;
                            if (componentImprovement.value2 < num7) num7 = componentImprovement.value2;
                        }
                        weaponList.push(Weapon.fromComponentImprovement(componentImprovement));
                        if (isSuperWeaponPlanetDestroyer(componentImprovement)) {
                            this.planetDestroyerWeaponsRange = csInt(componentImprovement.value2 * 0.9);
                            if (this.role === BuiltObjectRole.Military) this._isPlanetDestroyer = true;
                        }
                        break;
                    }
                    case C.Labs:
                        flag6 = true;
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
                        flag8 = true;
                        switch (componentImprovement.improvedComponent.type) {
                            case T.ExtractorGasExtractor:
                                this.extractionGas = toShort(this.extractionGas + toShort(componentImprovement.value1));
                                break;
                            case T.ExtractorMine:
                                this.extractionMine = toShort(this.extractionMine + toShort(componentImprovement.value1));
                                break;
                            case T.ExtractorLuxury:
                                this.extractionLuxury = toShort(this.extractionLuxury + toShort(componentImprovement.value1));
                                break;
                        }
                        break;
                    case C.Manufacturer:
                        flag9 = true;
                        break;
                    case C.EnergyCollector:
                        flag10 = true;
                        switch (componentImprovement.improvedComponent.type) {
                            case T.EnergyCollector:
                                this.energyCollection += componentImprovement.value1;
                                break;
                            case T.EnergyToFuel: {
                                const val = this.energyToFuelRate + componentImprovement.value1;
                                this.energyToFuelRate = toShort(Math.min(32767, val));
                                break;
                            }
                        }
                        break;
                    case C.Armor:
                        if (componentImprovement.improvedComponent.type === T.Armor) {
                            this.armor = toShort(this.armor + toShort(componentImprovement.value1));
                            if (componentImprovement.value2 > this.armorReactive) this.armorReactive = toShort(componentImprovement.value2);
                        }
                        break;
                    case C.Construction: {
                        const type = componentImprovement.improvedComponent.type;
                        if (type !== T.ConstructionBuild && type === T.DamageControl) {
                            if (componentImprovement.value1 > num26) num26 = componentImprovement.value1;
                            if (componentImprovement.value2 > 0 && (num31 === 0 || componentImprovement.value2 < num31)) num31 = toShort(componentImprovement.value2);
                        }
                        break;
                    }
                    case C.Computer:
                        switch (componentImprovement.improvedComponent.type) {
                            case T.ComputerTargettingFleet:
                                if (componentImprovement.value1 > this.targettingModifier) this.targettingModifier = toShort(componentImprovement.value1);
                                if (componentImprovement.value2 > this.fleetTargettingModifier) this.fleetTargettingModifier = toShort(componentImprovement.value2);
                                break;
                            case T.ComputerTargetting:
                                if (componentImprovement.value1 > this.targettingModifier) this.targettingModifier = toShort(componentImprovement.value1);
                                break;
                            case T.ComputerCountermeasuresFleet:
                                if (componentImprovement.value1 > this.countermeasureModifier) this.countermeasureModifier = toShort(componentImprovement.value1);
                                if (componentImprovement.value2 > this.fleetCountermeasureModifier) this.fleetCountermeasureModifier = toShort(componentImprovement.value2);
                                break;
                            case T.ComputerCountermeasures:
                                if (componentImprovement.value1 > this.countermeasureModifier) this.countermeasureModifier = toShort(componentImprovement.value1);
                                break;
                            case T.ComputerCommandCenter: {
                                const num43 = Math.fround(Math.fround(componentImprovement.value1) / 100);
                                if (num43 > this.maintenanceSavings) this.maintenanceSavings = num43;
                                break;
                            }
                            case T.ComputerCommerceCenter: {
                                const num42 = Math.fround(Math.fround(componentImprovement.value1) / 1000);
                                if (num42 > this.tradeBonuses) this.tradeBonuses = num42;
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
                                if (toByte(componentImprovement.value2) > this.sensorJumpIntercept) this.sensorJumpIntercept = toByte(componentImprovement.value2);
                                break;
                            case T.SensorResourceProfileSensor:
                                if (componentImprovement.value1 > this.sensorResourceProfileSensorRange) this.sensorResourceProfileSensorRange = componentImprovement.value1;
                                break;
                            case T.SensorLongRange:
                                if (componentImprovement.value1 > this.sensorLongRange) this.sensorLongRange = componentImprovement.value1;
                                break;
                            case T.SensorTraceScanner:
                                if (componentImprovement.value1 > this.sensorTraceScannerRange) {
                                    this.sensorTraceScannerRange = toShort(componentImprovement.value1);
                                    this.sensorTraceScannerPower = toShort(componentImprovement.value2);
                                }
                                break;
                            case T.SensorScannerJammer:
                                // BuiltObject.cs 2602: compares Value2 but stores Value1 (source quirk).
                                if (componentImprovement.value2 > this.sensorTraceScannerJamming) this.sensorTraceScannerJamming = toShort(componentImprovement.value1);
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
                        weaponList.push(Weapon.fromComponentImprovement(componentImprovement));
                        break;
                    }
                    case T.WeaponGravityBeam: {
                        if (componentImprovement.value1 > 0) {
                            num5 += componentImprovement.value1;
                            if (componentImprovement.value2 < this.beamWeaponsMinRange) this.beamWeaponsMinRange = componentImprovement.value2;
                            if (componentImprovement.value2 > this.maximumWeaponsRange) this.maximumWeaponsRange = componentImprovement.value2;
                            if (componentImprovement.value2 < this.minimumWeaponsRange) this.minimumWeaponsRange = componentImprovement.value2;
                        }
                        weaponList.push(Weapon.fromComponentImprovement(componentImprovement));
                        break;
                    }
                    case T.WeaponAreaGravity: {
                        if (componentImprovement.value1 > 0) {
                            num5 += componentImprovement.value1;
                            if (componentImprovement.value2 > this.standoffWeaponsMaxRange) this.standoffWeaponsMaxRange = componentImprovement.value2;
                            if (componentImprovement.value2 > this.maximumWeaponsRange) this.maximumWeaponsRange = componentImprovement.value2;
                            if (componentImprovement.value2 < this.minimumWeaponsRange) this.minimumWeaponsRange = componentImprovement.value2;
                        }
                        weaponList.push(Weapon.fromComponentImprovement(componentImprovement));
                        break;
                    }
                    case T.WeaponIonDefense:
                        if (componentImprovement.value1 > this.ionDefense) this.ionDefense = componentImprovement.value1;
                        break;
                    case T.WeaponIonPulse: {
                        const item = Weapon.fromComponentImprovement(componentImprovement);
                        weaponList.push(item);
                        if (item.rawDamage > 0) {
                            num8 += componentImprovement.value1;
                            num5 += componentImprovement.value1;
                            if (componentImprovement.value2 > this.ionWeaponRange) this.ionWeaponRange = componentImprovement.value2;
                            if (componentImprovement.value2 > this.standoffWeaponsMaxRange) this.standoffWeaponsMaxRange = componentImprovement.value2;
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
                            if (componentImprovement.value2 < this.beamWeaponsMinRange) this.beamWeaponsMinRange = componentImprovement.value2;
                            if (componentImprovement.value2 > this.maximumWeaponsRange) this.maximumWeaponsRange = componentImprovement.value2;
                            if (componentImprovement.value2 < this.minimumWeaponsRange) this.minimumWeaponsRange = componentImprovement.value2;
                        }
                        weaponList.push(Weapon.fromComponentImprovement(componentImprovement));
                        break;
                    }
                    case T.ConstructionBuild:
                        flag7 = true;
                        break;
                    case T.ComputerCommerceCenter:
                        flag = true;
                        break;
                    case T.StorageFuel:
                        num4 += componentImprovement.value1;
                        break;
                    case T.StorageDockingBay:
                        flag2 = true;
                        break;
                    case T.StoragePassenger:
                        num2 += componentImprovement.value1;
                        break;
                    case T.StorageCargo:
                        num += componentImprovement.value1;
                        break;
                    case T.StorageTroop:
                        num3 += componentImprovement.value1;
                        break;
                    case T.ComputerCommandCenter:
                        flag3 = true;
                        break;
                    case T.HabitationLifeSupport:
                        flag4 = true;
                        break;
                    case T.HabitationHabModule:
                        flag5 = true;
                        break;
                }
            } else if (comp.status === ComponentStatus.Unbuilt) {
                num29++;
            } else if (comp.status === ComponentStatus.Damaged) {
                num30++;
                switch (comp.category) {
                    case C.WeaponBeam:
                    case C.WeaponTorpedo:
                    case C.WeaponArea:
                    case C.WeaponPointDefense:
                    case C.WeaponIon:
                    case C.WeaponGravity:
                    case C.WeaponSuperBeam:
                    case C.WeaponSuperArea:
                    case C.WeaponSuperTorpedo:
                        num41++;
                        break;
                }
            }
        }
        void num19;
        void num41;
        // (Weapons is never null here: the constructor creates it.)
        if (!weaponsQuickCompareEquivalent(this.weapons, weaponList)) {
            const weaponList2 = weaponsDetermineNotInSuppliedList(weaponList, this.weapons);
            const weaponList3 = weaponsDetermineNotInSuppliedList(this.weapons, weaponList);
            for (let j = 0; j < weaponList3.length; j++) weaponsRemoveAndResetFirstMatchingWeaponById(this.weapons, weaponList3[j]);
            for (let k = 0; k < weaponList2.length; k++) this.weapons.push(weaponList2[k]);
        }
        this.undamagedComponentSize = num32;
        if (num2 > 0) {
            this.populationCapacity = num2;
            if (this.population === null) this.population = new PopulationList();
        } else {
            this.populationCapacity = 0;
            this.population = null;
        }
        if (num > 0) {
            if (this.cargo === null) this.cargo = new CargoList();
        } else {
            this.cargo = null;
        }
        if (num3 > 0) {
            if (this.troops === null) this.troops = new TroopList();
        } else {
            if (this.troops !== null && this.troops.items.length > 0) {
                // TODO(port): Troop model (Troop.cs) — fields accessed loosely.
                for (let l = 0; l < this.troops.items.length; l++) {
                    const troop = this.troops.items[l] as Troop & { empire?: { troops?: TroopList | null } | null; builtObject?: unknown; colony?: unknown };
                    if (troop.empire != null && troop.empire.troops != null) troop.empire.troops.remove(troop);
                    troop.builtObject = null;
                    troop.colony = null;
                    troop.empire = null;
                }
                this.troops.items = [];
            }
            this.troops = null;
        }
        if (this.armor > 0 && (this.subRole === BuiltObjectSubRole.SmallSpacePort || this.subRole === BuiltObjectSubRole.MediumSpacePort || this.subRole === BuiltObjectSubRole.LargeSpacePort) && this.parentHabitat !== null && this.parentHabitat.population !== null && this.parentHabitat.population.dominantRace !== null) {
            const dominantRace = this.parentHabitat.population.dominantRace;
            const factor = raceSpaceportArmorStrengthFactor(dominantRace);
            if (factor !== 0.0) this.armorReinforcingFactor = toShort(csInt(100.0 * factor));
        }
        this.fighterCapacity = num33;
        this.fighterRepairRate = num34;
        if (num33 > 0) {
            if (this.fighters === null) this.fighters = [];
        } else if (this.fighters !== null && this.fighters.length <= 0) {
            this.fighters = null;
        } else if (this.fighters !== null && this.fighters.length > 0) {
            // TODO(port): Fighter.CompleteTeardown(_Galaxy) for each fighter (Fighter.cs).
            throw new Error('TODO(port): Fighter.CompleteTeardown');
        }
        const actualEmpireForCargo = this.actualEmpire;
        if (this.parentHabitat !== null && this.role === BuiltObjectRole.Base && this.parentHabitat.population.items.length > 0 && this.parentHabitat.empire === actualEmpireForCargo) {
            if (this.parentHabitat.cargo === null) this.parentHabitat.cargo = new CargoList();
            this.cargo = this.parentHabitat.cargo;
        }
        if (this.parentHabitat !== null) {
            if (this.role === BuiltObjectRole.Base && this.parentHabitat.population.items.length > 0 && this.parentHabitat.empire === this.actualEmpire) num = 536870911;
            else if (this.role === BuiltObjectRole.Base) num *= 4;
        } else if (this.role === BuiltObjectRole.Base) {
            num *= 4;
        }
        this._cargoCapacity = num;
        if (flag3 && flag4 && flag5) this.isFunctional = true;
        if (this.isFunctional && this.cargoCapacity > 0 && flag2) this.isRefuellingDepot = true;
        if (this.isRefuellingDepot && flag && this.cargoCapacity > 0) this.isSpacePort = true;
        if (this.isFunctional && flag6) this.isResearchLab = true;
        if (this.isFunctional && flag8) this.isResourceExtractor = true;
        if (this.isFunctional && flag9) this.isManufacturer = true;
        if (this.isFunctional && flag7 && flag9) this.isShipYard = true;
        if (this.isFunctional && flag10) this.isEnergyCollector = true;
        // BuiltObject.cs 2947-2951: `if (IsResourceExtractor) { _ = Role; _ = 8; }` (no effect).
        if (num27 > 0) {
            const num44 = num27 / num23;
            this.stealth = Math.fround(Math.min(1.0, 0.5 / num44));
        }
        if (num26 > 0) this._damageReduction = Math.fround(Math.fround(num26) / 1000);
        this.reviewWeaponsComponentValues();
        const num45 = this.reactorPowerOutput - this.staticEnergyConsumption;
        num13 = num20;
        num11 = toShort(Math.trunc(num14 / Math.max(1, num23)));
        num12 = toShort(Math.trunc(num15 / Math.max(1, num23)));
        let num46: number;
        let num47: number;
        let num48: number;
        if (this.reactorPowerOutput > 0) {
            num46 = num21 / num45;
            num47 = num16 / num45;
            num48 = num17 / num45;
        } else {
            num46 = 1000000.0;
            num47 = 1000000.0;
            num48 = 1000000.0;
        }
        if (num46 > 1.0) {
            num13 = csInt(num13 / num46);
            if (num20 > 0 && this.reactorPowerOutput > 0) num13 = Math.max(num13, 600);
            num21 = csInt(num21 / num46);
        }
        if (num47 > 1.0) {
            num11 = toShort(csInt(num11 / num47));
            num16 = toShort(csInt(num16 / num47));
        }
        if (num48 > 1.0) {
            num12 = toShort(csInt(num12 / num48));
            num17 = toShort(csInt(num17 / num48));
        }
        // List<int>{num35..num40}.Sort(); .Reverse(); → list[0] is the maximum.
        const list = [num35, num36, num37, num38, num39, num40];
        list.sort((a, b) => a - b);
        list.reverse();
        if (list[0] === num35) this.engineType = EngineType.Proton;
        else if (list[0] === num36) this.engineType = EngineType.Quantum;
        else if (list[0] === num37) this.engineType = EngineType.Acceleros;
        else if (list[0] === num38) this.engineType = EngineType.Vortex;
        else if (list[0] === num39) this.engineType = EngineType.StarBurner;
        else if (list[0] === num40) this.engineType = EngineType.TurboThruster;
        else this.engineType = EngineType.Proton;
        this.size = num23;
        this.troopCapacity = num3;
        this.fuelCapacity = num4;
        this.firepowerRaw = num5;
        this.ionWeaponPower = num8;
        this.bombardWeaponPower = num6;
        if (num7 < 10000) this.bombardRange = num7;
        else this.bombardRange = 0;
        this.shieldsCapacity = num9;
        this.shieldRechargeRate = num10;
        this.maxPopulation = Math.min(num25, num24);
        this.topSpeed = num11;
        this._topSpeedBase = num11;
        this.topSpeedFuelBurn = toShort(num16);
        this.cruiseSpeed = num12;
        this._cruiseSpeedBase = num12;
        this.cruiseSpeedFuelBurn = toShort(num17);
        this.warpSpeed = num13;
        this.warpSpeedFuelBurn = num21;
        this.impulseSpeedFuelBurn = toShort(Math.trunc(this.cruiseSpeedFuelBurn / 4));
        this.hyperjumpInitiate = Math.min(15, num22);
        this._damageRepair = num31;
        this.turnRate = Math.fround(Math.fround(0.1) + Math.fround(Math.fround(Math.fround(num18) * 2) / Math.fround(num23)));
        const num49 = this.reactorPowerOutput - this.staticEnergyConsumption;
        let num50 = num49 / num16;
        if (num50 > 1.0) {
            num50 = Math.sqrt(Math.sqrt(num50));
            num50 = Math.min(num50, 2.0);
        }
        this.accelerationRate = Math.fround(Math.fround(Math.fround(num11 / 8) + 0.5) * Math.fround(num50));
        if (this.role !== BuiltObjectRole.Base) {
            this.accelerationRate = Math.min(this.accelerationRate, this.topSpeed);
            this.accelerationRate = Math.max(this.accelerationRate, 1);
        }
        this._fuelHandicapped = false;
        if (this.currentSpeed > this.topSpeed || this.targetSpeed > this.topSpeed || this.preferredSpeed > this.topSpeed) {
            this.targetSpeed = this.topSpeed;
            this.preferredSpeed = this.topSpeed;
            // TODO(port): UpdatePosition() (BuiltObject movement) — unreachable for a new
            // ship (CurrentSpeed / TargetSpeed / PreferredSpeed are 0, TopSpeed >= 0).
            throw new Error('TODO(port): BuiltObject.UpdatePosition');
        }
        if (this.minimumWeaponsRange >= 100000) this.minimumWeaponsRange = 0;
        if (this.beamWeaponsMinRange >= 100000) this.beamWeaponsMinRange = 0;
        for (let n = 0; n < this.components.count; n++) {
            const builtObjectComponent = this.components.items[n];
            if (builtObjectComponent.type !== T.StorageDockingBay) continue;
            if (this.dockingBays === null) this.dockingBays = [];
            if (this.dockingBayWaitQueue === null) this.dockingBayWaitQueue = [];
            const num51 = dockingBayIndexOf(this.dockingBays, builtObjectComponent);
            if (builtObjectComponent.status === ComponentStatus.Damaged || builtObjectComponent.status === ComponentStatus.Unbuilt) {
                if (num51 < 0) continue;
                if (this.dockingBays[num51].dockedShip !== null) {
                    let flag12 = false;
                    for (let num52 = 0; num52 < this.dockingBays.length; num52++) {
                        const dockingBay = this.dockingBays[num52];
                        const builtObjectComponent2 = this.components.findComponentByBuiltObjectComponentId(dockingBay.parentBuiltObjectComponentId);
                        if (builtObjectComponent2 !== null && builtObjectComponent2.status === ComponentStatus.Normal && dockingBay.dockedShip === null) {
                            dockingBay.dockedShip = this.dockingBays[num51].dockedShip;
                            flag12 = true;
                            break;
                        }
                    }
                    if (!flag12) {
                        // TODO(port): DockedShip.ClearPreviousMissionRequirements() (missions).
                        throw new Error('TODO(port): BuiltObject.ClearPreviousMissionRequirements');
                    }
                    this.dockingBays[num51].dockedShip = null;
                }
                this.dockingBays.splice(num51, 1);
            } else if (num51 < 0) {
                const item2 = new DockingBay(builtObjectComponent.componentId, builtObjectComponent.builtObjectComponentId, builtObjectComponent.value1 * baconCargoBayCapacityMultiplier(this));
                this.dockingBays.push(item2);
            }
        }
        if (this.unbuiltComponentCount !== num29 || this.damagedComponentCount !== num30) this.overlayChanged = true;
        this.unbuiltComponentCount = num29;
        this.damagedComponentCount = num30;
        if (this.damagedComponentCount === 0) this.strandedMessageSent = false;
        // TODO(port): ConstructionQueue (ConstructionQueue.cs 71/200, BaconConstructionQueue
        // ReviewConstructionSpeed): with flag7 (a ConstructionBuild component) C# creates
        // `new ConstructionQueue(this, _Galaxy)` and keeps it while Redefine finds a built
        // yard; otherwise it is dropped. No Rnd. Left null here.
        void flag7;
        // TODO(port): ManufacturingQueue (ManufacturingQueue.cs): with flag9 (a manufacturer
        // component) C# creates `new ManufacturingQueue(this, _Galaxy)` the same way. No Rnd.
        this.annualSupportCost = csInt(num28);
        const actualEmpire2 = this.actualEmpire;
        if (actualEmpire2 === null) return;
        if (this.isManufacturer && !this.hasBeenDestroyed) {
            if (!actualEmpire2.manufacturers.includes(this)) actualEmpire2.manufacturers.push(this);
        } else {
            // BuiltObject.cs 3217: removes from Empire (not ActualEmpire).
            const num53 = this.empire!.manufacturers.indexOf(this);
            if (num53 >= 0) this.empire!.manufacturers.splice(num53, 1);
        }
        if (this.isRefuellingDepot && !this.hasBeenDestroyed && this.dockingBays !== null && this.dockingBays.length > 0) {
            if (!actualEmpire2.refuellingDepots.includes(this)) actualEmpire2.refuellingDepots.push(this);
        } else {
            removeFrom(actualEmpire2.refuellingDepots, this);
        }
        if (this.isResourceExtractor && !this.hasBeenDestroyed) {
            if (!actualEmpire2.resourceExtractors.includes(this)) actualEmpire2.resourceExtractors.push(this);
            if (this.role === BuiltObjectRole.Base && !actualEmpire2.miningStations.includes(this)) actualEmpire2.miningStations.push(this);
        } else {
            removeFrom(actualEmpire2.resourceExtractors, this);
            if (this.role === BuiltObjectRole.Base) removeFrom(actualEmpire2.miningStations, this);
        }
        if (this.isSpacePort && !this.hasBeenDestroyed && this.dockingBays !== null && this.dockingBays.length > 0) {
            if (this.parentHabitat !== null && (this.subRole === BuiltObjectSubRole.SmallSpacePort || this.subRole === BuiltObjectSubRole.MediumSpacePort || this.subRole === BuiltObjectSubRole.LargeSpacePort) && !actualEmpire2.spacePorts.includes(this)) {
                actualEmpire2.spacePorts.push(this);
            }
        } else {
            removeFrom(actualEmpire2.spacePorts, this);
        }
        if (this.isShipYard && !this.hasBeenDestroyed) {
            if (!actualEmpire2.constructionYards.includes(this)) actualEmpire2.constructionYards.push(this);
        } else {
            removeFrom(actualEmpire2.constructionYards, this);
        }
        if (this.role === BuiltObjectRole.Freight && !this.hasBeenDestroyed) {
            if (!actualEmpire2.freighters.includes(this)) actualEmpire2.freighters.push(this);
        } else {
            removeFrom(actualEmpire2.freighters, this);
        }
        if (this.subRole === BuiltObjectSubRole.ConstructionShip && !this.hasBeenDestroyed) {
            if (!actualEmpire2.constructionShips.includes(this)) actualEmpire2.constructionShips.push(this);
        } else {
            removeFrom(actualEmpire2.constructionShips, this);
        }
        // Galaxy.OnRefreshView calls for the player's long range scanners (BuiltObject.cs
        // 3303-3326) only redraw galaxy backdrops (UI), so they are omitted.
        void sensorLongRange;
        if (this.sensorLongRange > 0 && !this.hasBeenDestroyed) {
            if (!actualEmpire2.longRangeScanners.includes(this)) actualEmpire2.longRangeScanners.push(this);
        } else {
            removeFrom(actualEmpire2.longRangeScanners, this);
        }
        if (this.subRole === BuiltObjectSubRole.ResupplyShip && this.isFunctional && this.dockingBays !== null && this.dockingBays.length > 0 && this.cargoCapacity > 0 && this.extractionGas > 0) {
            if (!actualEmpire2.resupplyShips.includes(this)) actualEmpire2.resupplyShips.push(this);
        } else {
            removeFrom(actualEmpire2.resupplyShips, this);
        }
        if (this.isFunctional && this.recreationCapacity > 0 && this.subRole === BuiltObjectSubRole.ResortBase) {
            if (!actualEmpire2.resortBases.includes(this)) actualEmpire2.resortBases.push(this);
        } else {
            removeFrom(actualEmpire2.resortBases, this);
        }
        if ((this.researchEnergy > 0 || this.researchHighTech > 0 || this.researchWeapons > 0) && !this.hasBeenDestroyed) {
            if (!actualEmpire2.researchFacilities.includes(this)) actualEmpire2.researchFacilities.push(this);
        } else {
            removeFrom(actualEmpire2.researchFacilities, this);
        }
        if (this.isPlanetDestroyer && this.isFunctional && this.topSpeed > 0 && this.warpSpeed > 0 && !this.hasBeenDestroyed) {
            if (!actualEmpire2.planetDestroyers.includes(this)) {
                actualEmpire2.planetDestroyers.push(this);
                return;
            }
        } else {
            removeFrom(actualEmpire2.planetDestroyers, this);
        }
        baconModMyShip(this);
    }
}

// `int i = list.IndexOf(this); if (i >= 0) list.RemoveAt(i);`
function removeFrom(list: unknown[], item: unknown): void {
    const index = list.indexOf(item);
    if (index >= 0) list.splice(index, 1);
}

// BaconBuiltObject static settings (BaconBuiltObject.cs 47-55). BaconMain.BaconInitialize
// overrides some from BaconSettings.txt, but only once a game exists (after game-start
// generation). TODO(port): BaconSettings.txt overrides (BaconMain.cs:640/821).
const MY_CARGO_BAY_CAPACITY_MULTIPLIER = 5;
const SUBLIGHT_FUEL_BURN_DIVISOR = Math.fround(1);
const WEAPON_RANGE_MULTIPLIER_FOR_BASES = Math.fround(1);

function nameContainsRomulan(empire: Empire | null): boolean {
    return empire !== null && empire.name.includes('Romulan');
}

// BaconBuiltObject.IsMyShip (BaconBuiltObject.cs 86).
function baconIsMyShip(ship: BuiltObject | null): boolean {
    return (ship !== null && nameContainsRomulan(ship.empire)) || (ship !== null && nameContainsRomulan(ship.actualEmpire)) || (ship !== null && nameContainsRomulan(ship.owner));
}

// BaconBuiltObject.CargoBayCapacityMultiplier (BaconBuiltObject.cs 104).
function baconCargoBayCapacityMultiplier(target: BuiltObject | null): number {
    let num = 1;
    if (target !== null && nameContainsRomulan(target.empire)) num = MY_CARGO_BAY_CAPACITY_MULTIPLIER;
    return num;
}

// BaconBuiltObject.ModWeaponRangeForBases (BaconBuiltObject.cs 2909).
function baconModWeaponRangeForBases(ship: BuiltObject): void {
    if (ship.weapons === null || ship.weapons.length === 0) return;
    for (const weapon of ship.weapons) {
        const range = weapon.range;
        if (weapon.component !== null) {
            const ci = componentImprovementFromComponent(weapon.component.def);
            ci.value2 = convertToInt32(Math.fround(Math.fround(range) * WEAPON_RANGE_MULTIPLIER_FOR_BASES));
            ci.value4 = weapon._improvedComponent.value4 * 2;
            weapon._improvedComponent = ci;
        }
    }
    if (ship.weapons === null || ship.weapons.length <= 0) return;
    // Weapons.OrderByDescending(x => x.Range).ToList()[0].Range: the maximum range.
    let max = ship.weapons[0].range;
    for (const w of ship.weapons) if (w.range > max) max = w.range;
    ship.maximumWeaponsRange = max;
}

// BaconBuiltObject.ModMyShip (BaconBuiltObject.cs 2810).
function baconModMyShip(ship: BuiltObject): void {
    if (Math.abs(SUBLIGHT_FUEL_BURN_DIVISOR - 1) > 0.01 && Math.abs(SUBLIGHT_FUEL_BURN_DIVISOR) > 0.01) {
        const val1_1 = Math.fround(Math.fround(ship.cruiseSpeedFuelBurn) / SUBLIGHT_FUEL_BURN_DIVISOR);
        const val1_2 = Math.fround(Math.fround(ship.topSpeedFuelBurn) / SUBLIGHT_FUEL_BURN_DIVISOR);
        ship.cruiseSpeedFuelBurn = Math.max(toShort(csInt(val1_1)), 1);
        ship.topSpeedFuelBurn = Math.max(toShort(csInt(val1_2)), 1);
    }
    const actual = ship.actualEmpire!;
    const mainGalaxy = BuiltObject.baconMainGameGalaxy;
    if (actual.pirateEmpireBaseHabitat !== null && ship.role === BuiltObjectRole.Freight && ship.empire === actual && mainGalaxy !== null && mainGalaxy.independentEmpire !== null) {
        ship.empire = mainGalaxy.independentEmpire;
    }
    if (ship.role === BuiltObjectRole.Base) baconModWeaponRangeForBases(ship);
    if (baconIsMyShip(ship)) {
        // TODO(port): the "Romulan" empire bonuses (BaconBuiltObject.cs 2823-2905) need
        // Empire.CountResourceSupplyLocations; no generated empire name contains "Romulan".
        throw new Error('TODO(port): BaconBuiltObject.ModMyShip Romulan bonuses');
    }
}
