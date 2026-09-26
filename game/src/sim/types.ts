// Core model types. Ports of DistantWorlds.Types:
// HabitatType.cs, HabitatCategoryType.cs, GalaxyShape.cs,
// HabitatAtmosphereType.cs, and the Habitat constructors (Habitat.cs).

import { PopulationList } from './population';
import type { Creature } from './creature';
import type { CargoList, TroopList } from './cargo';
import type { BuiltObject, DockingBay } from './builtObject';
import type { Empire } from './empire';
import type { Ruin } from './ruins';
import type { PlanetaryFacility } from './construction/facilities';
import { PirateColonyControlList } from './pirates/pirateColonyControl';
import type { Weapon } from './weapon';
import { MIN_TIME } from './tick/simTime';

// Port of DistantWorlds.Types.HabitatType (HabitatType.cs)
export enum HabitatType {
    Undefined,
    MainSequence,
    RedGiant,
    SuperGiant,
    WhiteDwarf,
    Neutron,
    BlackHole,
    SuperNova,
    Volcanic,
    Desert,
    MarshySwamp,
    Continental,
    Ocean,
    BarrenRock,
    Ice,
    GasGiant,
    FrozenGasGiant,
    Hydrogen,
    Helium,
    Argon,
    Ammonia,
    CarbonDioxide,
    Oxygen,
    NitrogenOxygen,
    Chlorine,
    Metal,
}

// Port of DistantWorlds.Types.IndustryType (IndustryType.cs). Only the
// members referenced by Galaxy.5.cs SetResearchBonus are known/ported;
// TODO(port): remaining IndustryType members if a future task needs them.
export enum IndustryType {
    Undefined,
    Weapon,
    Energy,
    HighTech,
}

// Port of Galaxy.4.cs Galaxy.ResolveColonyHabitatTypeByIndexDesertBeforeOcean
// (Galaxy.4.cs:746). Maps a race file's NativePlanetType index to the
// corresponding colony habitat type; out-of-range values fall back to
// Continental.
export function resolveColonyHabitatTypeByIndexDesertBeforeOcean(index: number): HabitatType {
    switch (index) {
        case 0:
            return HabitatType.Continental;
        case 1:
            return HabitatType.MarshySwamp;
        case 2:
            return HabitatType.Desert;
        case 3:
            return HabitatType.Ocean;
        case 4:
            return HabitatType.Ice;
        case 5:
            return HabitatType.Volcanic;
        default:
            return HabitatType.Continental;
    }
}

// Port of Galaxy.4.cs Galaxy.ResolveColonyIndexByHabitatTypeDesertBeforeOcean
// (inverse of the above); non-colony types map to -1.
export function resolveColonyIndexByHabitatTypeDesertBeforeOcean(type: HabitatType): number {
    switch (type) {
        case HabitatType.Continental:
            return 0;
        case HabitatType.MarshySwamp:
            return 1;
        case HabitatType.Desert:
            return 2;
        case HabitatType.Ocean:
            return 3;
        case HabitatType.Ice:
            return 4;
        case HabitatType.Volcanic:
            return 5;
        default:
            return -1;
    }
}

// Port of DistantWorlds.Types.HabitatCategoryType (HabitatCategoryType.cs)
export enum HabitatCategoryType {
    Star,
    Planet,
    Moon,
    Asteroid,
    GasCloud,
}

// Port of DistantWorlds.Types.GalaxyShape (GalaxyShape.cs)
export enum GalaxyShape {
    Spiral,
    Elliptical,
    Irregular,
    Ring,
    ClustersEven,
    ClustersVaried,
}

// Port of DistantWorlds.Types.HabitatAtmosphereType (HabitatAtmosphereType.cs)
export enum HabitatAtmosphereType {
    None,
    NitrogenOxygen,
    Oxygen,
    CarbonDioxide,
    HydrogenHelium,
    SulphurDioxide,
    NitrogenArgonMethane,
}

// Port of Galaxy.3.cs Galaxy.ReduceAngle
export function reduceAngle(currentAngle: number): number {
    if (currentAngle >= Math.PI * 2.0) {
        currentAngle -= Math.PI * 2.0;
    }
    return currentAngle;
}

// Port of Galaxy.3.cs Galaxy.IncreaseAngle
export function increaseAngle(currentAngle: number): number {
    if (currentAngle <= Math.PI * 2.0) {
        currentAngle += Math.PI * 2.0;
    }
    return currentAngle;
}

// Port of DistantWorlds.Types.Habitat (constructors from Habitat.cs).
// The C# Galaxy parameter is omitted (headless sim): the galaxy-time parts
// of the constructor and Move are noted as TODO(port) below.
export class Habitat {
    name: string;
    category: HabitatCategoryType;
    type: HabitatType;
    xpos = 0;
    ypos = 0;
    parent: Habitat | null;
    orbitAngle = 0;
    orbitDirection = false;
    orbitDistance = 0; // C#: short _OrbitDistance
    orbitSpeed = 0; // C#: byte _OrbitSpeed
    private _anglePerSecond = 0;

    // Plain fields set later by generation (Galaxy.5/6.cs).
    // C#: short Diameter / float BaseQuality — properties whose setters call RecalculateMaximumPopulation
    // (Habitat.cs 976-985 / 213-224 → BaconHabitat.cs 233; M4j, see recalculateMaximumPopulation below the class).
    private _diameter = 0;
    get diameter(): number {
        return this._diameter;
    }
    set diameter(value: number) {
        this._diameter = value;
        recalculateMaximumPopulation(this);
    }
    pictureRef = 0; // C#: short
    landscapePictureRef = 0; // C#: short
    private _baseQuality = 1; // C#: float _BaseQuality = 1f
    get baseQuality(): number {
        return this._baseQuality;
    }
    // Habitat.cs 217-223: _BaseQuality = value; RecalculateQuality() (quality is a live getter here);
    // RecalculateMaximumPopulation().
    set baseQuality(value: number) {
        this._baseQuality = value;
        recalculateMaximumPopulation(this);
    }
    atmosphere = HabitatAtmosphereType.None;
    atmosphereDensity = 0; // C#: int
    systemIndex = 0;
    habitatIndex = 0;
    scenicFactor = 0; // C#: float
    scenicFeature = ''; // C#: string ScenicFeature (Galaxy.5.cs SetScenicFactor)
    researchBonus = 0; // C#: byte
    researchBonusIndustry = IndustryType.Undefined; // C#: IndustryType (Galaxy.5.cs SetResearchBonus)
    hasRings = false; // C#: bool HasRings (Galaxy.5.cs SetupSolarSystem)
    novaProgression = 0; // C#: float NovaProgression (supernovae; Galaxy.5.cs SetupSun)
    novaImageIndexMajor = 0; // C#: short NovaImageIndexMajor
    novaImageIndexMinor = 0; // C#: short NovaImageIndexMinor
    // Port of Habitat.cs Resources (HabitatResourceList). Abundance is 0-1000.
    resources: { resourceId: number; abundance: number }[] = [];
    // Port of Habitat.cs Population (PopulationList, populated by
    // Galaxy.SelectPopulation — Galaxy.6.cs:1218).
    population = new PopulationList();
    // Port of Habitat.cs Cargo (CargoList) and Troops (TroopList); the C#
    // fields are nullable, so null until first use (Empire ctor sets them).
    cargo: CargoList | null = null;
    troops: TroopList | null = null;
    // C#: BuiltObjectList _BasesAtHabitat = new BuiltObjectList() (Habitat ctor, Habitat.cs 6284).
    basesAtHabitat: BuiltObject[] = [];
    // Port of Habitat.cs field `int _DevelopmentLevel = 1` (101), set via SetDevelopmentLevel
    // (5589) / read by GetDevelopmentLevel (5602). The DevelopmentLevel property (447)
    // is developmentLevel.ts habitatDevelopmentLevel.
    developmentLevel = 1;

    // --- Colony fields (task C2a, Habitat.cs) ---
    // C#: Empire Owner / Empire Empire (both set by Empire.TakeOwnershipOfColony).
    owner: Empire | null = null;
    empire: Empire | null = null;
    // C#: bool IsRefuellingDepot.
    isRefuellingDepot = false;
    // C#: float Damage (0 at generation); Quality = BaseQuality * (1 - Damage).
    damage = 0;
    // C#: TroopsToRecruit / InvadingTroops (TroopList, nullable).
    troopsToRecruit: TroopList | null = null;
    invadingTroops: TroopList | null = null;
    // C#: float _ColonyInfluenceRadius (Habitat.RecalculateColonyInfluenceRadius, territory.ts).
    colonyInfluenceRadius = 0;
    // C#: PlanetaryFacilityList Facilities (construction/facilities.ts, M4i).
    facilities: PlanetaryFacility[] | null = null;
    // Task M3b (colony economy, forceStructure.ts): C# double _AnnualTaxRevenue
    // (a snapshot written by Habitat.RecalculateAnnualTaxRevenue), float _TaxRate
    // (written by Empire.SetColonyTaxRate, taxes.ts) and float _DistanceFactor = 1f
    // (Habitat.RecalculateDistanceFactor).
    annualTaxRevenue = 0;
    taxRate = 0;
    distanceFactor = 1;
    // C#: Ruin _Ruin (Habitat.cs Ruin; set by Galaxy.SelectRuins / SelectRuinsUnlockTech, ruins.ts).
    ruin: Ruin | null = null;
    // Colony approval / tax model (taxes.ts, Habitat.cs):
    // C# int _DevelopmentLevelBaseline (Habitat.RecalculateDevelopmentLevelBaseline 5575).
    // Note: `developmentLevel` above is C# _DevelopmentLevel (SetDevelopmentLevel);
    // the C# DevelopmentLevel property (Habitat.cs 447) is developmentLevel.ts habitatDevelopmentLevel.
    developmentLevelBaseline = 0;
    // C# float _HappinessModifier (written by CheckForSpacePortFacilities 2729).
    happinessModifier = 0;
    // C# bool HasSpacePort (Habitat.cs 191, written by CheckForSpacePortFacilities).
    hasSpacePort = false;
    // C# ResourceBonusList _ResourceBonuses = new ResourceBonusList() (Habitat.cs 187),
    // double _GrowthFactor = 1.0 / _IncomeFactor = 1.0 (181/184); written by
    // RecalculateCriticalResourceSupplyBonuses / ...Factors (5087/5124).
    resourceBonuses: { resourceId: number; effect: number; value: number; appliesOnlyToSources: boolean }[] = [];
    growthFactor = 1.0;
    incomeFactor = 1.0;
    // C# ColonyPopulationPolicy ColonyPopulationPolicy / ColonyPopulationPolicyRaceFamily
    // (Habitat.cs 75/77, byte enum; default Assimilate = 0; set by TakeOwnershipOfColony).
    colonyPopulationPolicy = 0;
    colonyPopulationPolicyRaceFamily = 0;

    // Port of Habitat.cs Quality (_Quality, kept equal to
    // BaseQuality * (1 - Damage) by the BaseQuality setter / RecalculateQuality).
    get quality(): number {
        return Math.fround(Math.fround(this.baseQuality) * Math.fround(1 - this.damage));
    }

    // Port of Habitat.cs SetDevelopmentLevel (5589): clamped to 0..50.
    setDevelopmentLevel(level: number): void {
        this.developmentLevel = level;
        if (this.developmentLevel > 50) {
            this.developmentLevel = 50;
        } else if (this.developmentLevel < 0) {
            this.developmentLevel = 0;
        }
    }

    // TODO(port): _LastHugeTouch/_LastLongTouch/_LastPeriodicTouch/_LastTouch
    // (galaxy time), _BasesAtHabitat list and
    // RecalculateCriticalResourceSupplyBonuses() from the C# ctor —
    // Habitat.cs:ctor — need Galaxy and the list types.

    // Port of Habitat.cs ctor Habitat(galaxy, category, type, name, x, y)
    constructor(category: HabitatCategoryType, type: HabitatType, name: string, x: number, y: number);
    // Port of Habitat.cs ctor Habitat(galaxy, category, type, name, parent, orbitangle, orbitdirection, orbitdistance, orbitspeed)
    constructor(
        category: HabitatCategoryType,
        type: HabitatType,
        name: string,
        parent: Habitat | null,
        orbitAngle: number,
        orbitDirection: boolean,
        orbitDistance: number,
        orbitSpeed: number,
    );
    // Port of Habitat.cs ctor Habitat(..., doInitialMove)
    constructor(
        category: HabitatCategoryType,
        type: HabitatType,
        name: string,
        parent: Habitat | null,
        orbitAngle: number,
        orbitDirection: boolean,
        orbitDistance: number,
        orbitSpeed: number,
        doInitialMove: boolean,
    );
    constructor(
        category: HabitatCategoryType,
        type: HabitatType,
        name: string,
        parentOrX: Habitat | null | number,
        orbitAngleOrY: number,
        orbitDirectionOrDistance?: boolean | number,
        orbitDistanceOrSpeed?: number,
        orbitSpeed?: number,
        doInitialMove = true,
    ) {
        // Port of the category/type validation switch in the C# ctor.
        const valid =
            category === HabitatCategoryType.Asteroid
                ? type === HabitatType.BarrenRock || type === HabitatType.Ice || type === HabitatType.Metal
                : category === HabitatCategoryType.GasCloud
                    ? type >= HabitatType.Hydrogen && type <= HabitatType.Chlorine
                    : category === HabitatCategoryType.Moon
                        ? type >= HabitatType.Volcanic && type <= HabitatType.Ice
                        : category === HabitatCategoryType.Planet
                            ? type >= HabitatType.Volcanic && type <= HabitatType.FrozenGasGiant
                            : category === HabitatCategoryType.Star
                                ? type >= HabitatType.MainSequence && type <= HabitatType.SuperNova
                                : false;
        if (!valid) {
            throw new Error('Invalid habitat category/type combination.');
        }
        this.name = name;
        this.category = category;
        this.type = type;
        if (typeof parentOrX === 'number') {
            // Top-level habitat: the C# x/y ctor delegates to the orbit ctor
            // with parent=null, orbitangle=0, direction=true, distance=0,
            // speed=0, then sets Xpos/Ypos.
            this.parent = null;
            this.xpos = parentOrX;
            this.ypos = orbitAngleOrY;
            return;
        }
        this.parent = parentOrX;
        this.orbitAngle = orbitAngleOrY;
        this.orbitDirection = orbitDirectionOrDistance as boolean;
        this.orbitDistance = orbitDistanceOrSpeed ?? 0;
        this.orbitSpeed = orbitSpeed ?? 0;
        const orbitPathLength = this.calculateOrbitPathLength();
        if (this.parent !== null) {
            this._anglePerSecond = (Math.PI * 2.0) / (orbitPathLength / this.orbitSpeed);
        }
        if (doInitialMove) {
            // Habitat.cs 6297-6303: _LastTouch = now.AddSeconds(-30) (kept: the first DoTasks moves another 30 s), then
            // Move(galaxy) with (_tempNow - _LastTouch).TotalSeconds = 30 when there is a parent. `now` is generation
            // time 0 (see the M4a touch fields below).
            this.lastTouch = -30000;
            if (this.parent !== null) this.move(30);
        }
    }

    // Port of Habitat.cs CalculateOrbitPathLength
    calculateOrbitPathLength(): number {
        return Math.PI * this.orbitDistance * 2.0;
    }

    // Public wrapper around the private move() (task 07a): Galaxy.step
    // advances every orbiting habitat by game-time seconds. The C# call is
    // Habitat.Move(galaxy) with totalSeconds = (_tempNow - _LastTouch).TotalSeconds.
    advanceOrbit(totalSeconds: number): void {
        this.move(totalSeconds);
    }

    // Port of Habitat.cs Move (Habitat.Move(Galaxy)). totalSeconds stands in
    // for (_tempNow - _LastTouch).TotalSeconds; the C#
    // Galaxy.ConditionCheckLimit(angle-cond, 20, ref count) loop is inlined.
    private move(totalSeconds: number): void {
        if (this.parent === null) {
            return;
        }
        const px = this.parent.xpos;
        const py = this.parent.ypos;
        if (this.orbitDirection) {
            this.orbitAngle += this._anglePerSecond * totalSeconds;
            let iterationCount = 0;
            while (iterationCount < 20 && this.orbitAngle >= Math.PI * 2.0) {
                iterationCount++;
                this.orbitAngle = reduceAngle(this.orbitAngle);
            }
        } else {
            this.orbitAngle -= this._anglePerSecond * totalSeconds;
            let iterationCount = 0;
            while (iterationCount < 20 && this.orbitAngle <= Math.PI * -2.0) {
                iterationCount++;
                this.orbitAngle = increaseAngle(this.orbitAngle);
            }
        }
        const y = py + Math.sin(this.orbitAngle) * this.orbitDistance;
        const x = px + Math.cos(this.orbitAngle) * this.orbitDistance;
        this.ypos = y;
        this.xpos = x;
    }

    // ---- M4a fields (tick core; tick/habitatTick.ts) ----
    // Habitat.cs 147-155 _LastTouch / _LastIntermediateTouch / _LastPeriodicTouch / _LastLongTouch / _LastHugeTouch
    // (game ms). The ctor (Habitat.cs 6184-6187) sets huge/long/periodic/touch = CurrentDateTime and leaves
    // _LastIntermediateTouch = MinValue (6297-6299: touch = now − 30 s with doInitialMove); every TS habitat is built
    // during generation at game time 0.
    lastTouch = 0;
    lastIntermediateTouch = MIN_TIME;
    lastPeriodicTouch = 0;
    lastLongTouch = 0;
    lastHugeTouch = 0;
    /** StellarObject.HasBeenDestroyed. */
    hasBeenDestroyed = false;
    /** Habitat.DoingTasks / DoingRemove. */
    doingTasks = false;
    doingRemove = false;
    /** StellarObject.IsShipYard (set every periodic Habitat tick, Habitat.cs 1484-1491). */
    isShipYard = false;
    /** Habitat.Explosion / Explosions (M4o owns the element type). */
    explosion: unknown = null;
    explosions: unknown[] | null = null;
    // ---- M4b fields (missions) ----
    /** StellarObject.DockingBays / DockingBayWaitQueue on a planet (read by ClearPreviousMissionRequirements / ClearParent; M4e fills them). */
    dockingBays: DockingBay[] | null = null;
    dockingBayWaitQueue: BuiltObject[] | null = null;
    // ---- M4c fields (movement, fuel) ----
    // Habitat radiation (read by PerformEnergyCollection and the Bacon star gravity wells) is declared in the M4g block.
    // ---- M4d fields (orders, colony supply) ----
    // ---- M4e fields (docking) ----
    // ---- M4f fields (civilian mission AI) ----
    /** Habitat.cs CurrentDefensiveForceAssigned (int; reset and summed by AssignShipMissions, Empire.4.cs 4798-4815). */
    currentDefensiveForceAssigned = 0;
    // ---- M4g fields (extraction, industry) ----
    /** Habitat.cs 1033/1045/1057 _SolarRadiation / _XrayRadiation / _MicrowaveRadiation (byte; set on stars and gas clouds at generation, read by BuiltObject.IndustrialProcessing). */
    solarRadiation = 0;
    microwaveRadiation = 0;
    xrayRadiation = 0;
    /** Habitat._ManufacturingQueue (ManufacturingQueue; null until M4g creates it). */
    manufacturingQueue: unknown = null;
    // ---- M4h fields (construction queues) ----
    /** Habitat.ConstructionQueue (ConstructionQueue; null until M4h creates it). */
    constructionQueue: unknown = null;
    // ---- M4i fields (facilities, wonders) ----
    /** Habitat.cs 61 PlanetaryShieldPresent (ReviewPlanetaryFacilities). */
    planetaryShieldPresent = false;
    /** Habitat.cs GiantIonCannonPresent / GiantIonCannon (Weapon) (ReviewPlanetaryFacilities). */
    giantIonCannonPresent = false;
    giantIonCannon: Weapon | null = null;
    /** Habitat.cs DefensiveFortressBonus (byte; ReviewPlanetaryFacilities). */
    defensiveFortressBonus = 0;
    /** Habitat.cs 178 WonderForDevelopment (ReviewPlanetaryFacilities; read by DevelopmentLevel). */
    wonderForDevelopment: PlanetaryFacility | null = null;
    // ---- M4j fields (colony growth, happiness) ----
    /** Habitat.cs 53 _MaxPopulation (long; BaconHabitat.RecalculateMaximumPopulation, read by GrowPopulation). */
    maxPopulation = 0;
    /** Habitat.cs 99 _MigrationFactor (float; CalculateMigrationFactor). */
    migrationFactor = 0;
    /** Habitat.cs 103 _RestrictedResourcesPresent (EvaluateColonyVariables; read by DevelopmentLevel). */
    restrictedResourcesPresent = false;
    /** Habitat.cs 117 ConqueredFactor (float; UpdateConqueredFactor; set negative on conquest by M4q). */
    conqueredFactor = 0;
    /** Habitat.cs 170 _WarWithOurRace (float; CalculateWarWithOurRace). */
    warWithOurRace = 0;
    /** Habitat.cs 79 SlaveryBonusFactor = 1f (float; ReviewColonyPopulationPolicy). */
    slaveryBonusFactor = 1;
    /**
     * Habitat.cs 91/93 PlagueId = -1 (short) / PlagueTimeRemaining (float). Read by GrowPopulation; the plague model
     * (ProcessPlague) is M4u's — kept here so the growth guard reads the real fields.
     */
    plagueId = -1;
    plagueTimeRemaining = 0;
    /**
     * Habitat.cs 211 BaconValues (Dictionary<string, object>, null until first use): "marketcash", "resourcePriceList",
     * "infrastructure" (M4j, BaconHabitat economy), "piratebase" (M4s), "capturedSpies" (M4q).
     */
    baconValues: Map<string, unknown> | null = null;
    // ---- M4k fields (research) ----
    // ---- M4l fields (fleets) ----
    // ---- M4m fields (military AI) ----
    // ---- M4n fields (threats) ----
    // ---- M4o fields (weapons, damage) ----
    // Habitat.cs 63 GiantIonCannonPresent / GiantIonCannon and 61 PlanetaryShieldPresent: declared in the M4i block.
    /** StellarObject.Attackers on a planet (StellarObjectList; read by Habitat.ShouldAttack, Habitat.cs 2707). */
    attackers: unknown[] | null = null;
    /** Habitat.cs 203 TeardownEmpire (the empire that fired the planet destroyer; read by DoPlanetRemove, ClearColony in CompleteTeardown). */
    teardownEmpire: Empire | null = null;
    /** Habitat.cs _DestroyedAsteroidFieldGenerated (DoExplosion 6362). */
    destroyedAsteroidFieldGenerated = false;
    // ---- M4p fields (fighters) ----
    // ---- M4q fields (invasion, troops) ----
    /** Habitat.cs InvasionStats (combat/invasion.ts InvasionStats; null outside an invasion). */
    invasionStats: unknown = null;
    /** StellarObject.RaidCountdown (byte; set to 60 by a successful raid, counted down by UpdateRaidCountdown, M4s). */
    raidCountdown = 0;
    /** Habitat.ColonyInvasion (ColonyInvasion.cs; null = no invasion in progress). */
    colonyInvasion: unknown = null;
    /** Habitat.cs 194/197 InvasionSpaceControlStrengthDefenders / Attackers = -1. */
    invasionSpaceControlStrengthDefenders = -1;
    invasionSpaceControlStrengthAttackers = -1;
    // ---- M4r fields (diplomacy) ----
    // ---- M4s fields (pirates) ----
    /** Habitat.cs 67 _PirateColonyControl (GetPirateControl(); pirates/pirateColonyControl.ts). */
    pirateColonyControl = new PirateColonyControlList();
    // StellarObject.RaidCountdown: declared in the M4q block (UpdateRaidCountdown counts it down).
    // ---- M4t fields (exploration) ----
    /** Habitat.cs 107 _CulturalDistressFactor (float; ExertCulturalInfluence Empire.cs 4734). */
    culturalDistressFactor = 0;
    /**
     * Habitat.cs 119 IsBlockaded (written by the blockade code, M4m). Declared here because UpdateSystemInfo (M4t)
     * reads it (as it reads PlagueId, declared in the M4j block).
     */
    isBlockaded = false;
    // ---- M4u fields (events, rebellion, plague) ----
    /** Habitat.cs 109 _Rebelling. */
    rebelling = false;
    /** Habitat.RaceEventType (events.ts RaceEventType; set by race events, cleared by Empire.ResetRaceEvents). */
    raceEventType = 0;
    // Habitat.cs 203 TeardownEmpire (ClearColony(TeardownEmpire) in CompleteTeardown): declared in the M4o block.
    // ---- M4z3 fields (story, scripted game events) ----
    /** StellarObject.cs 19 GameEventId = short.MinValue (a scenario GameEvent trigger on this habitat). */
    gameEventId = -32768;
}

/**
 * M4j: BaconHabitat.cs 233 RecalculateMaximumPopulation(planet) (via Habitat.cs 6160). Called by the Diameter /
 * BaseQuality setters, RegenerateDamage, TerraformColony (colonyTick.ts) and ConstructFacilities.
 */
export function recalculateMaximumPopulation(planet: Habitat): void {
    const f32 = Math.fround;
    // (double)Math.Max(0.01f, planet.BaseQuality * (1f - planet.Damage)) — float arithmetic.
    const num = Math.max(f32(0.01), f32(f32(planet.baseQuality) * f32(1 - f32(planet.damage))));
    const diameter = planet.diameter;
    planet.maxPopulation = Math.trunc(diameter * diameter * 250000.0 * (num * num));
    const population = planet.population as PopulationList | undefined;
    const dominantRace = population != null ? population.dominantRace : null;
    if (population != null && dominantRace !== null && dominantRace.nativeHabitatType === planet.type) {
        planet.maxPopulation = Math.trunc(planet.maxPopulation * 1.1);
    }
    planet.maxPopulation = Math.max(planet.maxPopulation, 100);
}

export interface SystemInfo {
    systemStar: Habitat;
    habitats: Habitat[];
    sector: { x: number; y: number };
    // Port of Galaxy.cs System.Creatures (CreatureList). Populated by
    // Galaxy.GenerateCreatureAtHabitat (Galaxy.6.cs:723) when the creature's
    // habitat belongs to a built system; undefined until then.
    creatures?: Creature[];
    // Galaxy.1.cs DetermineSystemInfo fields (task C2c-2; set by Galaxy.updateSystemInfo).
    planetCount?: number;
    moonCount?: number;
    independentColonyCount?: number;
    dominantEmpire?: { empire: Empire; colonyCount: number; totalStrategicValue: number } | null;
    otherEmpires?: { empire: Empire; colonyCount: number; totalStrategicValue: number }[] | null;
    // C#: SystemInfo.HasResearchBonus (bool, default false; set by Start.2.cs 1172, startHabitats.ts).
    hasResearchBonus?: boolean;
    // Galaxy.1.cs DetermineSystemInfo (873) remaining SystemInfo fields (task M4t; SystemInfo.cs CopyFromOther).
    hasRuins?: boolean;
    hasScenery?: boolean;
    blockadeCount?: number;
    plagueId?: number;
    isDisputed?: boolean;
    playerPotentialColonies?: boolean;
}

/**
 * C# `SystemInfo.Habitats` — the system's planets, moons and asteroid fields, WITHOUT the star (Galaxy.4.cs 2340
 * `systemInfo.Habitats = DetermineHabitatsInSystem(star)`; Galaxy.6.cs 4611 collects the habitats after the star in
 * Galaxy.Habitats whose Parent != null). The TS `SystemInfo.habitats` array also holds the star at [0]: read it directly
 * only where the C# covers the star too (generation, Galaxy.Habitats-wide index rebuilds, UI lookups).
 */
export function planetsOf(system: SystemInfo): Habitat[] {
    return system.habitats.filter((h) => h !== system.systemStar);
}
