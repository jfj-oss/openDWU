// Core model types. Ports of DistantWorlds.Types:
// HabitatType.cs, HabitatCategoryType.cs, GalaxyShape.cs,
// HabitatAtmosphereType.cs, and the Habitat constructors (Habitat.cs).

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
    diameter = 0; // C#: short
    pictureRef = 0; // C#: short
    landscapePictureRef = 0; // C#: short
    baseQuality = 1; // C#: float _BaseQuality = 1f
    atmosphere = HabitatAtmosphereType.None;
    atmosphereDensity = 0; // C#: int
    systemIndex = 0;
    habitatIndex = 0;
    scenicFactor = 0; // C#: float
    researchBonus = 0; // C#: byte
    hasRings = false; // C#: bool HasRings (Galaxy.5.cs SetupSolarSystem)

    // TODO(port): _LastHugeTouch/_LastLongTouch/_LastPeriodicTouch/_LastTouch
    // (galaxy time), Resources/Population/_BasesAtHabitat lists and
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
        if (doInitialMove && this.parent !== null) {
            // C# sets _LastTouch = now.AddSeconds(-30) then calls Move(galaxy),
            // so (_tempNow - _LastTouch).TotalSeconds is exactly 30.
            // TODO(port): per-tick Move(galaxy) driven by Galaxy time — Habitat.cs:Move
            this.move(30);
        }
    }

    // Port of Habitat.cs CalculateOrbitPathLength
    calculateOrbitPathLength(): number {
        return Math.PI * this.orbitDistance * 2.0;
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
}

export interface SystemInfo {
    systemStar: Habitat;
    habitats: Habitat[];
    sector: { x: number; y: number };
}