// Galaxy generation: star generation (all GalaxyShape variants), system
// naming, gas clouds, and solar-system contents (planets, moons, asteroid
// fields, resources, treasure asteroids). Ports of
// DistantWorlds.Types.Galaxy (Galaxy.cs / Galaxy.3.cs / Galaxy.4.cs /
// Galaxy.5.cs / Galaxy.6.cs / Galaxy.9.cs). Nebula/galaxy-location
// generation is ported (01e: GalaxyNebulaeGenerator + GalaxyLocation);
// population and creatures remain out of scope — see the `TODO(port)`
// markers below.

import { Random } from './random';
import { GalaxyLocation, GalaxyLocationEffectType, GalaxyLocationShape, GalaxyLocationType } from './galaxyLocation';
import { GalaxyNebulaeGenerator } from './galaxyNebulaeGenerator';
import { setupAlienRacePopulations, type EmpireStart } from './raceRegions';
import { Population, PopulationList } from './population';
import {
    GalaxyShape,
    Habitat,
    HabitatCategoryType,
    HabitatType,
    type SystemInfo,
} from './types';
import type { Race } from './data/races';
import type { Resource } from './data/resources';
import type { GameData } from './data/gameData';

// Port of Galaxy.cs static fields (Galaxy.3.cs InitializeStatics sets
// these): SectorSizeX = SectorSizeY = 2_000_000, IndexSize = 400_000.
const SECTOR_SIZE = 2_000_000;
const INDEX_SIZE = 400_000;
// Port of Galaxy.3.cs InitializeStatics: MaxSolarSystemSize = 23000.
const MAX_SOLAR_SYSTEM_SIZE = 23000;
// Port of Galaxy.3.cs InitializeStatics: MaxMoonOrbitSize = 1200.
const MAX_MOON_ORBIT_SIZE = 1200;

// Default cloud-image count for the nebula generator. The renderer
// should pass the actual number of
// /assets/dwu/images/environment/nebulae/*.png files via
// GenerateGalaxyOptions.cloudImageCount; pictureRef only selects
// which cloud image to draw, and Next(0, N) consumes one RNG sample
// regardless of N, so the generation stream is unaffected by the
// count.
const DEFAULT_CLOUD_IMAGE_COUNT = 40;

export interface GenerateGalaxyOptions {
    seed: number;
    shape: GalaxyShape;
    starCount: number;
    sectorWidth: number;
    sectorHeight: number;
    colonyPrevalence?: number;
    systemNames: string[];
    // Parsed game data (resource definitions, ...). When omitted, no
    // resources are generated (pre-01d behavior).
    gameData?: GameData;
    // Number of nebula cloud images available to the renderer (see
    // DEFAULT_CLOUD_IMAGE_COUNT). Only affects pictureRef values, not
    // the RNG stream.
    cloudImageCount?: number;
    // Port of Galaxy.4.cs ctor: AggressionLevel (default 1.0) drives
    // aggressiveRacesRequired = 3/2/1/0 for >= 1.5 / >= 1.3 / >= 1.1 / else.
    aggressionLevel?: number;
    // Empire starts (resolved race + projected colony amount each). When
    // omitted/empty no race regions are created and SetupAlienRacePopulations
    // consumes zero Rnd calls (pre-01f1 behavior).
    empireStarts?: EmpireStart[];
}

export class Galaxy {
    rnd: Random;
    // Port of Galaxy.cs static CryptoRnd (CryptoRandom, unseeded). The C#
    // class uses an unseeded static RNG for resource prevalence/abundance
    // rolls and the random resource ordering; to keep generation
    // deterministic we substitute a second seeded stream derived from the
    // galaxy seed. (Documented deviation.)
    cryptoRnd: Random;
    // Parsed resource definitions (ResourceSystem.Resources), passed in via
    // GenerateGalaxyOptions.gameData.
    resources: Resource[] = [];
    sizeX = 0;
    sizeY = 0;
    sectorSize = SECTOR_SIZE;
    sectorWidth: number;
    sectorHeight: number;
    starCount: number;
    galaxyShape: GalaxyShape;
    habitats: Habitat[] = [];
    systems: SystemInfo[] = [];
    // Port of Galaxy.cs RandomSeed (the seed the main Rnd and the
    // nebula generator are both seeded from).
    randomSeed: number;
    // Port of Galaxy.cs _GalaxyLocations.
    galaxyLocations: GalaxyLocation[] = [];
    // Port of Galaxy.cs _GalaxyLocationIndex ([IndexMaxX][IndexMaxY]
    // grid of GalaxyLocation lists, IndexSize = 400_000).
    private galaxyLocationIndex: GalaxyLocation[][][] = [];
    // Port of Galaxy.cs _ColonyPrevalence (defaults to 1.0).
    colonyPrevalence = 1.0;
    // Port of Galaxy.cs Races (RaceList, loaded from GameData in the ctor).
    races: Race[] = [];
    // Port of Galaxy.cs habitat-race lists (_ContinentalRaces etc.),
    // populated by SetupAlienRacePopulations (raceRegions.ts).
    continentalRaces: Race[] = [];
    marshySwampRaces: Race[] = [];
    desertRaces: Race[] = [];
    oceanRaces: Race[] = [];
    iceRaces: Race[] = [];
    volcanicRaces: Race[] = [];
    barrenRockRaces: Race[] = [];

    // Port of Galaxy.cs _StarClusterLocations / _StarClusterPortions
    // (used by the ClustersEven/ClustersVaried shapes).
    private starClusterLocations: { x: number; y: number }[] = [];
    private starClusterPortions: number[] = [];

    // Port of Galaxy.4.cs SystemNames / SystemNamesUsedPlain / SystemNamesUsedAlternative.
    private systemNames: string[];
    private systemNamesUsedPlain: boolean[];
    private systemNamesUsedAlternative: boolean[];

    // Port of Galaxy.6.cs SelectPopulation state (Galaxy.cs fields):
    // _RaceUsed (bool[Races.Count], lazily allocated),
    // _RaceIndependentColonyCount (List<int>, lazily allocated — note the
    // source sizes it by Races.Count but indexes it by race.PictureRef, a
    // quirk preserved here). IndependentCount is public in C# and exposed
    // here for tests; _LifePrevalence defaults to 1000 in the C# ctor.
    private raceUsed: boolean[] | null = null;
    private raceIndependentColonyCount: number[] | null = null;
    independentCount = 0;
    lifePrevalence = 1000;
    age = 0; // C#: _Age (always 0 in new-game generation; set from galaxy age at load time only)

    constructor(seed: number, shape: GalaxyShape, starCount: number, sectorWidth: number, sectorHeight: number, systemNames: string[], colonyPrevalence?: number) {
        this.randomSeed = seed;
        this.rnd = new Random(seed);
        this.cryptoRnd = new Random(Math.imul(seed, 0x5bd1e995) | 0);
        this.galaxyShape = shape;
        this.starCount = starCount;
        this.sectorWidth = sectorWidth;
        this.sectorHeight = sectorHeight;
        this.systemNames = systemNames;
        if (colonyPrevalence !== undefined) {
            this.colonyPrevalence = colonyPrevalence;
        }
        this.systemNamesUsedPlain = new Array(systemNames.length).fill(false);
        this.systemNamesUsedAlternative = new Array(systemNames.length).fill(false);
        this.setGalaxyPhysicalDimensions(sectorWidth, sectorHeight);
        // Port of the C# ctor's field initializers (_Age = 0,
        // _RaceUsed = null, _RaceIndependentColonyCount = null,
        // IndependentCount = 0, _LifePrevalence = 1000). The class-field
        // initializers above run before the ctor body, so reset them here
        // for parity with a freshly constructed Galaxy.
        this.raceUsed = null;
        this.raceIndependentColonyCount = null;
        this.independentCount = 0;
        this.lifePrevalence = 1000;
        this.age = 0;
    }

    // Port of Galaxy.3.cs SetGalaxyPhysicalDimensions
    private setGalaxyPhysicalDimensions(sectorWidth: number, sectorHeight: number): void {
        sectorWidth = Math.max(4, Math.min(15, sectorWidth));
        sectorHeight = Math.max(4, Math.min(15, sectorHeight));
        this.sectorWidth = sectorWidth;
        this.sectorHeight = sectorHeight;
        this.sizeX = sectorWidth * SECTOR_SIZE;
        this.sizeY = sectorHeight * SECTOR_SIZE;
    }

    // Port of Galaxy.5.cs ObtainRandomGalaxyCoordinates(out x, out y)
    obtainRandomGalaxyCoordinates(): { x: number; y: number } {
        return { x: this.rnd.nextDouble() * this.sizeX, y: this.rnd.nextDouble() * this.sizeY };
    }

    // Port of Galaxy.5.cs ObtainRandomGalaxyCoordinates(radiusFromCenterMinimum, radiusFromCenterMaximum, out x, out y)
    obtainRandomGalaxyCoordinatesInRadius(radiusFromCenterMinimum: number, radiusFromCenterMaximum: number): { x: number; y: number } {
        const halfX = this.sizeX / 2.0;
        const halfY = this.sizeY / 2.0;
        const radiusBase = this.sizeX / 2.0;
        const minRadius = radiusBase * radiusFromCenterMinimum;
        const extraRadius = this.rnd.nextDouble() * radiusBase * (radiusFromCenterMaximum - radiusFromCenterMinimum);
        const radius = minRadius + extraRadius;
        const angle = this.rnd.nextDouble() * Math.PI * 2.0;
        const x = halfX + Math.cos(angle) * radius;
        const y = halfY + Math.sin(angle) * radius;
        return { x, y };
    }

    // Port of Galaxy.6.cs CalculateDistance
    calculateDistance(x1: number, y1: number, x2: number, y2: number): number {
        const dx = x1 - x2;
        const dy = y1 - y2;
        return Math.sqrt(dx * dx + dy * dy);
    }

    // Port of Galaxy.5.cs SelectClusterIndex
    private selectClusterIndex(selection: number): number {
        let sum = 0;
        for (let i = 0; i < this.starClusterPortions.length; i++) {
            if (selection >= sum && selection < sum + this.starClusterPortions[i]) {
                return i;
            }
            sum += this.starClusterPortions[i];
        }
        return -1;
    }

    // Simplified port of Galaxy.6.cs FindNearestSystemGasCloudAsteroid.
    // The original walks a spatial GalaxyIndex grid of sectors; that index
    // structure isn't ported yet, so this does a linear scan over the
    // already-placed gas-cloud/asteroid habitats. Semantically equivalent
    // (same nearest-neighbor result), just O(n) instead of index-accelerated.
    // TODO(port): rebuild via GalaxyIndex sectors if this becomes a perf issue.
    private findNearestSystemGasCloudAsteroid(x: number, y: number): Habitat | null {
        let best: Habitat | null = null;
        let bestDistance = Number.MAX_VALUE;
        for (const habitat of this.habitats) {
            if (habitat.category !== HabitatCategoryType.GasCloud && habitat.category !== HabitatCategoryType.Asteroid) {
                continue;
            }
            const distance = this.calculateDistance(x, y, habitat.xpos, habitat.ypos);
            if (distance < bestDistance) {
                bestDistance = distance;
                best = habitat;
            }
        }
        return best;
    }

    // Port of Galaxy.6.cs SelectStar
    private selectStar(): { type: HabitatType; diameter: number; pictureRef: number } {
        const roll = this.rnd.next(0, 77);
        let type: HabitatType;
        let diameter: number;
        let pictureRef: number;
        if (roll >= 0 && roll <= 61) {
            type = HabitatType.MainSequence;
            diameter = this.rnd.next(950, 1400);
            pictureRef = diameter <= 1200 ? 83 : 84;
            this.rnd.next(0, 4); // mapPictureRef roll — MapPictureRef not modeled yet
            this.rnd.next(40, 60); // solarRadiation
            this.rnd.next(5, 20); // microwaveRadiation
            this.rnd.next(5, 12); // xrayRadiation
        } else if (roll >= 62 && roll <= 66) {
            type = HabitatType.RedGiant;
            diameter = this.rnd.next(1450, 1620);
            pictureRef = 85;
            this.rnd.next(0, 3);
            this.rnd.next(70, 95);
            this.rnd.next(5, 20);
            this.rnd.next(5, 12);
        } else if (roll >= 67 && roll <= 69) {
            type = HabitatType.SuperGiant;
            diameter = this.rnd.next(1620, 1950);
            pictureRef = 86;
            this.rnd.next(0, 3);
            this.rnd.next(80, 100);
            this.rnd.next(5, 20);
            this.rnd.next(5, 12);
        } else if (roll >= 70 && roll <= 72) {
            type = HabitatType.WhiteDwarf;
            diameter = this.rnd.next(260, 350);
            pictureRef = 87;
            this.rnd.next(0, 3);
            this.rnd.next(10, 30);
            this.rnd.next(20, 40);
            this.rnd.next(40, 60);
        } else if (roll >= 73 && roll <= 74) {
            type = HabitatType.Neutron;
            diameter = this.rnd.next(180, 230);
            pictureRef = 88;
            this.rnd.next(1, 5);
            this.rnd.next(60, 90);
            this.rnd.next(120, 200);
        } else if (roll === 75) {
            type = HabitatType.BlackHole;
            diameter = this.rnd.next(4500, 6500);
            pictureRef = 95;
            this.rnd.next(10, 15);
            this.rnd.next(60, 80);
            this.rnd.next(90, 130);
        } else {
            type = HabitatType.SuperNova;
            diameter = this.rnd.next(300, 900);
            pictureRef = 0;
            this.rnd.next(60, 80);
            this.rnd.next(70, 110);
            this.rnd.next(160, 220);
        }
        return { type, diameter, pictureRef };
    }

    // Port of Galaxy.4.cs GenerateNebulae (generateImage=false call) plus
    // the constructor wiring (Galaxy.4.cs ~2190: _GalaxyLocations =
    // locations, index-grid re-init, AddGalaxyLocationIndex per location).
    generateNebulae(cloudImageCount: number): void {
        const generator = new GalaxyNebulaeGenerator(cloudImageCount, this.systemNames);
        this.galaxyLocations = generator.generateGalaxyNebulae(this.randomSeed, this.starCount, this.galaxyShape, this.sizeX, this.sizeY);
        const indexMaxX = Math.trunc(this.sizeX / INDEX_SIZE);
        const indexMaxY = Math.trunc(this.sizeY / INDEX_SIZE);
        const grid: GalaxyLocation[][][] = [];
        for (let i = 0; i < indexMaxX; i++) {
            const row: GalaxyLocation[][] = [];
            for (let j = 0; j < indexMaxY; j++) {
                row.push([]);
            }
            grid.push(row);
        }
        this.galaxyLocationIndex = grid;
        for (const location of this.galaxyLocations) {
            this.addGalaxyLocationIndex(location);
        }
    }

    // Port of Galaxy.4.cs AddGalaxyLocationIndex
    addGalaxyLocationIndex(location: GalaxyLocation): void {
        const point = this.resolveGalaxyLocationIndexes(location.xpos, location.ypos);
        const point2 = this.resolveGalaxyLocationIndexes(location.xpos + location.width, location.ypos + location.height);
        for (let i = point.x; i <= point2.x; i++) {
            for (let j = point.y; j <= point2.y; j++) {
                const cell = this.galaxyLocationIndex[i][j];
                if (!cell.includes(location)) {
                    cell.push(location);
                }
            }
        }
    }

    // Port of Galaxy.4.cs RemoveGalaxyLocationIndex
    removeGalaxyLocationIndex(location: GalaxyLocation): void {
        const point = this.resolveGalaxyLocationIndexes(location.xpos, location.ypos);
        const point2 = this.resolveGalaxyLocationIndexes(location.xpos + location.width, location.ypos + location.height);
        for (let i = point.x; i <= point2.x; i++) {
            for (let j = point.y; j <= point2.y; j++) {
                const cell = this.galaxyLocationIndex[i][j];
                const index = cell.indexOf(location);
                if (index >= 0) {
                    cell.splice(index, 1);
                }
            }
        }
    }

    // Port of Galaxy.4.cs ResolveGalaxyLocationIndexes
    private resolveGalaxyLocationIndexes(x: number, y: number): { x: number; y: number } {
        // C# (int) casts truncate toward zero, then int division.
        const coords = {
            x: Math.trunc(Math.trunc(x) / INDEX_SIZE),
            y: Math.trunc(Math.trunc(y) / INDEX_SIZE),
        };
        this.correctIndexCoords(coords);
        return coords;
    }

    // Port of Galaxy.6.cs CorrectIndexCoords (clamps to
    // [0, IndexMaxX-1] / [0, IndexMaxY-1]).
    private correctIndexCoords(coords: { x: number; y: number }): void {
        const indexMaxX = Math.trunc(this.sizeX / INDEX_SIZE);
        const indexMaxY = Math.trunc(this.sizeY / INDEX_SIZE);
        if (coords.x < 0) {
            coords.x = 0;
        } else if (coords.x >= indexMaxX) {
            coords.x = indexMaxX - 1;
        }
        if (coords.y < 0) {
            coords.y = 0;
        } else if (coords.y >= indexMaxY) {
            coords.y = indexMaxY - 1;
        }
    }

    // Port of Galaxy.4.cs DetermineGalaxyLocationsAtPoint(x, y, type);
    // type defaults to Undefined (no filter), matching the 2-arg overload.
    determineGalaxyLocationsAtPoint(x: number, y: number, type: GalaxyLocationType = GalaxyLocationType.Undefined): GalaxyLocation[] {
        const result: GalaxyLocation[] = [];
        const point = this.resolveGalaxyLocationIndexes(x, y);
        for (const location of this.galaxyLocationIndex[point.x][point.y]) {
            const num = location.width / 2.0;
            const num2 = num * num;
            if (type === GalaxyLocationType.Undefined || location.type === type) {
                const num3 = this.calculateDistanceSquared(x, y, location.xpos + num, location.ypos + location.height / 2.0);
                if (num3 < num2) {
                    result.push(location);
                }
            }
        }
        return result;
    }

    // Port of Galaxy.6.cs CalculateDistanceSquared
    private calculateDistanceSquared(x1: number, y1: number, x2: number, y2: number): number {
        const dx = x1 - x2;
        const dy = y1 - y2;
        return dx * dx + dy * dy;
    }

    // Port of Galaxy.5.cs SetupSun(galaxyShape).
    private setupSun(galaxyShape: GalaxyShape): Habitat {
        let x = 0;
        let y = 0;
        const clusterBaseRadius = 300000.0 + 175000000.0 / Math.sqrt(this.starCount);
        const clusterCap =
            this.starCount >= 1400 ? 5000000.0 : this.starCount >= 1000 ? 4250000.0 : this.starCount >= 700 ? 3600000.0 : this.starCount < 400 ? 2000000.0 : 2700000.0;
        const clusterVal = Math.min(clusterBaseRadius, clusterCap);
        let num5 = 0;
        let num6 = 0.0;
        let flag = false;
        let flag2 = false;
        let flag3 = false;
        do {
            switch (galaxyShape) {
                case GalaxyShape.ClustersEven:
                case GalaxyShape.ClustersVaried: {
                    if (this.rnd.next(0, 10) === 1) {
                        x = this.sizeX * 0.02 + this.rnd.nextDouble() * (this.sizeX * 0.96);
                        y = this.sizeY * 0.02 + this.rnd.nextDouble() * (this.sizeY * 0.96);
                        break;
                    }
                    const clusterIndex = this.selectClusterIndex(this.rnd.nextDouble());
                    if (clusterIndex >= 0) {
                        const clusterDiameter = Math.sqrt(this.starClusterPortions[clusterIndex]) * clusterVal * 3.0;
                        const clusterRadius = this.rnd.nextDouble() * (clusterDiameter / 2.0);
                        const angle = this.rnd.nextDouble() * Math.PI * 2.0;
                        const dy = Math.sin(angle) * clusterRadius;
                        const dx = Math.cos(angle) * clusterRadius;
                        x = this.starClusterLocations[clusterIndex].x + dy;
                        y = this.starClusterLocations[clusterIndex].y + dx;
                    } else {
                        x = this.sizeX * 0.02 + this.rnd.nextDouble() * (this.sizeX * 0.96);
                        y = this.sizeY * 0.02 + this.rnd.nextDouble() * (this.sizeY * 0.96);
                    }
                    break;
                }
                case GalaxyShape.Ring: {
                    const roll = this.rnd.next(0, 20);
                    if (roll >= 3) {
                        const radius = this.sizeX / 2 - (this.sizeX / 2) * this.rnd.nextDouble() * 0.15;
                        const angle = this.rnd.nextDouble() * Math.PI * 2.0;
                        const dy = Math.sin(angle) * radius;
                        const dx = Math.cos(angle) * radius;
                        x = this.sizeY / 2 + dy;
                        y = this.sizeX / 2 + dx;
                        break;
                    }
                    const spreadX = (this.rnd.next(2, 10) / 10.0) * (this.rnd.next(2, 10) / 10.0) * this.rnd.nextDouble() * this.sizeX / 2.0;
                    const spreadY = (this.rnd.next(2, 10) / 10.0) * (this.rnd.next(2, 10) / 10.0) * this.rnd.nextDouble() * this.sizeY / 2.0;
                    switch (this.rnd.next(1, 3)) {
                        case 1:
                            x = this.sizeX / 2 + spreadX;
                            break;
                        case 2:
                            x = this.sizeX / 2 - spreadX;
                            break;
                    }
                    switch (this.rnd.next(1, 3)) {
                        case 1:
                            y = this.sizeY / 2 + spreadY;
                            break;
                        case 2:
                            y = this.sizeY / 2 - spreadY;
                            break;
                    }
                    break;
                }
                case GalaxyShape.Elliptical: {
                    const roll = this.rnd.next(0, 16);
                    if (roll >= 10) {
                        const spreadX = (this.rnd.next(2, 10) / 10.0) * (this.rnd.next(2, 10) / 10.0) * this.rnd.nextDouble() * this.sizeX / 2.0;
                        const spreadY = (this.rnd.next(2, 10) / 10.0) * (this.rnd.next(2, 10) / 10.0) * this.rnd.nextDouble() * this.sizeY / 2.0;
                        switch (this.rnd.next(1, 3)) {
                            case 1:
                                x = this.sizeX / 2 + spreadX;
                                break;
                            case 2:
                                x = this.sizeX / 2 - spreadX;
                                break;
                        }
                        switch (this.rnd.next(1, 3)) {
                            case 1:
                                y = this.sizeY / 2 + spreadY;
                                break;
                            case 2:
                                y = this.sizeY / 2 - spreadY;
                                break;
                        }
                    } else if (roll >= 5) {
                        const radius = this.sizeX / 2 - (this.sizeX / 2) * this.rnd.nextDouble() * 0.1;
                        const angle = this.rnd.nextDouble() * Math.PI * 2.0;
                        const dy = Math.sin(angle) * radius;
                        const dx = Math.cos(angle) * radius;
                        x = this.sizeY / 2 + dy;
                        y = this.sizeX / 2 + dx;
                    } else {
                        const radius = (this.sizeX / 2) * (0.25 + this.rnd.nextDouble() * 0.6);
                        const angle = this.rnd.nextDouble() * Math.PI * 2.0;
                        const dy = Math.sin(angle) * radius;
                        const dx = Math.cos(angle) * radius;
                        x = this.sizeY / 2 + dy;
                        y = this.sizeX / 2 + dx;
                    }
                    break;
                }
                case GalaxyShape.Spiral: {
                    const spreadX = this.rnd.nextDouble() * this.rnd.nextDouble() * this.sizeX / 2.0;
                    const spreadY = this.rnd.nextDouble() * this.rnd.nextDouble() * this.sizeY / 2.0;
                    switch (this.rnd.next(1, 3)) {
                        case 1:
                            x = this.sizeX / 2 + spreadX;
                            break;
                        case 2:
                            x = this.sizeX / 2 - spreadX;
                            break;
                    }
                    switch (this.rnd.next(1, 3)) {
                        case 1:
                            y = this.sizeY / 2 + spreadY;
                            break;
                        case 2:
                            y = this.sizeY / 2 - spreadY;
                            break;
                    }
                    break;
                }
                case GalaxyShape.Irregular:
                    x = this.rnd.nextDouble() * this.sizeX;
                    y = this.rnd.nextDouble() * this.sizeY;
                    break;
            }
            flag2 = true;
            const margin = MAX_SOLAR_SYSTEM_SIZE + 500.0;
            if (x < margin || x > this.sizeX - margin || y < margin || y > this.sizeY - margin) {
                flag2 = false;
            }
            const nearest = this.findNearestSystemGasCloudAsteroid(x, y);
            num6 = nearest === null ? Number.MAX_VALUE : this.calculateDistance(x, y, nearest.xpos, nearest.ypos);
            const nebulae = this.determineGalaxyLocationsAtPoint(x, y, GalaxyLocationType.NebulaCloud);
            if (nebulae.length > 0) {
                if (this.rnd.next(0, 15) === 1) {
                    flag = true;
                    for (const location of nebulae) {
                        if (location.effect === GalaxyLocationEffectType.LightningDamage) {
                            flag3 = true;
                            break;
                        }
                    }
                } else {
                    flag = false;
                }
            } else {
                flag = true;
            }
            num5++;
        } while ((num6 < MAX_SOLAR_SYSTEM_SIZE * 4 || !flag || !flag2) && num5 < 100);

        // C# re-rolls the star type until it's compatible with any
        // LightningDamage nebula the star landed in (flag3 is sticky for
        // the whole SetupSun call, matching the source).
        let type: HabitatType;
        let diameter: number;
        let pictureRef: number;
        let flag4 = false;
        do {
            const selected = this.selectStar();
            type = selected.type;
            diameter = selected.diameter;
            pictureRef = selected.pictureRef;
            flag4 = true;
            if (flag3) {
                switch (type) {
                    case HabitatType.MainSequence:
                    case HabitatType.RedGiant:
                    case HabitatType.SuperGiant:
                        flag4 = false;
                        break;
                }
            }
        } while (!flag4);
        const star = new Habitat(HabitatCategoryType.Star, type, this.generateCodeName(), x, y);
        star.diameter = diameter;
        star.pictureRef = pictureRef;
        star.landscapePictureRef = -1;
        if (type === HabitatType.BlackHole) {
            // Port of Galaxy.5.cs SetupSun black-hole GalaxyLocations
            // (1329-1352). C# renames the star via GenerateBlackHoleName()
            // (not ported — see the assignSystemName TODO); the star's
            // existing name is used for the location prefixes instead.
            const pullSize = star.diameter * 1.1;
            const pull = new GalaxyLocation(star.name + ' Pull', GalaxyLocationType.BlackHole, x - pullSize / 2.0, y - pullSize / 2.0, pullSize, pullSize, -1);
            pull.showName = false;
            pull.effect = GalaxyLocationEffectType.ShipPull;
            pull.effectAmount = Math.fround(star.diameter / 600);
            this.galaxyLocations.push(pull);
            this.addGalaxyLocationIndex(pull);
            const horizonSize = star.diameter * 0.04;
            const horizon = new GalaxyLocation(star.name + ' Event Horizon', GalaxyLocationType.BlackHole, x - horizonSize / 2.0, y - horizonSize / 2.0, horizonSize, horizonSize, -1);
            horizon.showName = false;
            horizon.effect = GalaxyLocationEffectType.ShipDamage;
            horizon.effectAmount = Math.fround(star.diameter);
            this.galaxyLocations.push(horizon);
            this.addGalaxyLocationIndex(horizon);
        } else if (type === HabitatType.SuperNova) {
            // Port of Galaxy.5.cs SetupSun supernova branch (1353-1371).
            // TextResolver.GetText("HabitatType SuperNova") = "Super Nova"
            // (TextResolver not ported — literal used).
            star.name = 'Super Nova ' + this.generateCodeName();
            // C# field is float — round to float32 for fidelity.
            star.novaProgression = Math.fround(30000 + this.rnd.nextDouble() * 60000);
            star.novaImageIndexMajor = this.rnd.next(0, 20); // GalaxyImages.NovaImageCountMajor
            star.novaImageIndexMinor = this.rnd.next(0, 56); // GalaxyImages.NovaImageCountMinor
            star.diameter = Math.trunc(Math.trunc(star.novaProgression * 2.0) / 10);
            // Port of Galaxy.5.cs SetupSun supernova GalaxyLocation.
            const num20 = Math.trunc(star.novaProgression * 2.0);
            const location = new GalaxyLocation(star.name, GalaxyLocationType.SuperNova, x - num20 / 2.0, y - num20 / 2.0, num20, num20, -1);
            location.showName = false;
            location.shape = GalaxyLocationShape.Circular;
            location.effect = GalaxyLocationEffectType.ShieldReduction;
            this.galaxyLocations.push(location);
            this.addGalaxyLocationIndex(location);
        }
        return star;
    }

    // Port of Galaxy.4.cs GenerateCodeName
    generateCodeName(): string {
        const letters = String.fromCharCode(this.rnd.next(65, 91)) + String.fromCharCode(this.rnd.next(65, 91));
        return letters + this.rnd.next(1, 1000);
    }

    // Port of Galaxy.4.cs AssignSystemName(Habitat habitat, int PlanetCount)
    assignSystemName(habitat: Habitat, planetCount: number): boolean {
        let name = '';
        if (planetCount <= 0) {
            // TODO(port): GenerateBlackHoleName for HabitatType.BlackHole — Galaxy.4.cs.
            name = this.generateCodeName();
        } else {
            if (this.systemNames.length === 0) {
                return false;
            }
            let attempts = 0;
            let index = this.rnd.next(0, this.systemNames.length);
            while (this.systemNamesUsedPlain[index] && attempts < 100) {
                index = this.rnd.next(0, this.systemNames.length);
                attempts++;
            }
            if (this.systemNamesUsedPlain[index]) {
                if (this.systemNamesUsedAlternative[index]) {
                    return false;
                }
                name = this.systemNames[index];
                switch (this.rnd.next(0, 4)) {
                    case 0:
                        name += ' Major';
                        break;
                    case 1:
                        name += ' Minor';
                        break;
                    case 2:
                        name += ' Junction';
                        break;
                    case 3:
                        name += ' Prime';
                        break;
                }
                this.systemNamesUsedAlternative[index] = true;
            } else {
                name = this.systemNames[index];
                this.systemNamesUsedPlain[index] = true;
            }
        }
        habitat.name = name;
        return true;
    }

    // Port of Galaxy.5.cs SetResearchBonus(Habitat, bool definitelySet).
    // ResearchBonusIndustry isn't modeled on Habitat yet (out of scope),
    // so only the numeric bonus is applied. TODO(port): ResearchBonusIndustry.
    setResearchBonus(habitat: Habitat, definitelySet = false): void {
        switch (habitat.type) {
            case HabitatType.Neutron:
            case HabitatType.BlackHole:
            case HabitatType.SuperNova:
                if (definitelySet || this.rnd.next(0, 4) > 0) {
                    habitat.researchBonus = this.rnd.next(5, 16);
                    this.rnd.next(0, 3); // researchBonusIndustry roll
                }
                break;
            case HabitatType.Volcanic:
            case HabitatType.GasGiant:
            case HabitatType.FrozenGasGiant:
                if (definitelySet || this.rnd.next(0, 40) === 1) {
                    habitat.researchBonus = this.rnd.next(10, 31);
                    this.rnd.next(0, 3); // researchBonusIndustry roll
                }
                break;
        }
    }

    // Port of Galaxy.5.cs SetScenicFactor(Habitat, bool definitelySet).
    // ScenicFeature/HasRings text/flags aren't modeled on Habitat yet
    // (out of scope) — only scenicFactor is applied.
    // TODO(port): ScenicFeature strings, HasRings — Galaxy.5.cs SetScenicFactor.
    setScenicFactor(habitat: Habitat, definitelySet = false): void {
        switch (habitat.type) {
            case HabitatType.BarrenRock:
                if ((habitat.category === HabitatCategoryType.Planet || habitat.category === HabitatCategoryType.Moon) && (definitelySet || this.rnd.next(0, 600) === 1)) {
                    habitat.scenicFactor = 0.1 + this.rnd.nextDouble() * 0.3;
                }
                break;
            case HabitatType.MarshySwamp:
            case HabitatType.Continental:
                if (definitelySet || this.rnd.next(0, 70) === 1) {
                    habitat.scenicFactor = 0.2 + this.rnd.nextDouble() * 0.4;
                    this.rnd.next(0, 2);
                }
                break;
            case HabitatType.Ocean:
                if (definitelySet || this.rnd.next(0, 100) === 1) {
                    habitat.scenicFactor = 0.1 + this.rnd.nextDouble() * 0.3;
                }
                break;
            case HabitatType.Ice:
                if (definitelySet || this.rnd.next(0, 200) === 1) {
                    habitat.scenicFactor = 0.2 + this.rnd.nextDouble() * 0.4;
                }
                break;
            case HabitatType.Volcanic:
            case HabitatType.Desert:
                if (definitelySet || this.rnd.next(0, 200) === 1) {
                    habitat.scenicFactor = 0.2 + this.rnd.nextDouble() * 0.4;
                    this.rnd.next(0, 2);
                }
                break;
            // TODO(port): remaining scenic-feature cases (Galaxy.5.cs
            // SetScenicFactor continues past line 2060) — out of scope here.
        }
    }

    // Port of Galaxy.4.cs GenerateGasCloud().
    // The original anchors gas clouds inside existing NebulaCloud
    // GalaxyLocations; nebulae aren't modeled yet, so this places the
    // cloud at a uniform-random galaxy coordinate instead (documented
    // deviation) while keeping the type roll, diameter roll, min-distance
    // retry loop (against other gas clouds/asteroids), SelectResources,
    // radiation rolls, and orbitDirection roll faithful to source.
    // TODO(port): nebula-anchored placement — needs GalaxyLocation.
    generateGasCloud(): Habitat {
        let habitatType = HabitatType.Ammonia;
        switch (this.rnd.next(0, 15)) {
            case 0:
                habitatType = HabitatType.Ammonia;
                break;
            case 1:
                habitatType = HabitatType.Argon;
                break;
            case 2:
                habitatType = HabitatType.CarbonDioxide;
                break;
            case 3:
                habitatType = HabitatType.Chlorine;
                break;
            case 4:
            case 5:
                habitatType = HabitatType.Helium;
                break;
            case 6:
            case 7:
            case 8:
                habitatType = HabitatType.Hydrogen;
                break;
            case 9:
            case 10:
            case 11:
            case 12:
                habitatType = HabitatType.NitrogenOxygen;
                break;
            case 13:
            case 14:
                habitatType = HabitatType.Oxygen;
                break;
        }
        let distance = 0;
        let attempts = 0;
        let habitat: Habitat;
        do {
            const { x, y } = this.obtainRandomGalaxyCoordinates();
            habitat = new Habitat(HabitatCategoryType.GasCloud, habitatType, this.generateCodeName(), x, y);
            habitat.diameter = this.rnd.next(8000, 32000);
            const nearest = this.findNearestSystemGasCloudAsteroid(habitat.xpos, habitat.ypos);
            distance = nearest === null ? Number.MAX_VALUE : this.calculateDistance(habitat.xpos, habitat.ypos, nearest.xpos, nearest.ypos);
            attempts++;
        } while (distance < MAX_SOLAR_SYSTEM_SIZE * 4 && attempts < 200);

        this.rnd.next(40, 60); // solarRadiation
        this.rnd.next(1, 5); // microwaveRadiation
        this.rnd.next(0, 3); // xrayRadiation

        this.selectResources(habitat);

        switch (habitat.type) {
            case HabitatType.Hydrogen:
            case HabitatType.Helium:
                habitat.pictureRef = habitat.diameter < 1750 ? 79 : habitat.diameter < 3000 ? 80 : habitat.diameter < 4250 ? 81 : 82;
                break;
            case HabitatType.Argon:
            case HabitatType.Ammonia:
            case HabitatType.CarbonDioxide:
                habitat.pictureRef = habitat.diameter < 1750 ? 75 : habitat.diameter < 3000 ? 76 : habitat.diameter < 4250 ? 77 : 78;
                break;
            case HabitatType.Oxygen:
            case HabitatType.NitrogenOxygen:
            case HabitatType.Chlorine:
                habitat.pictureRef = habitat.diameter < 1750 ? 71 : habitat.diameter < 3000 ? 72 : habitat.diameter < 4250 ? 73 : 74;
                break;
        }
        habitat.landscapePictureRef = -1;
        if (this.rnd.next(0, 5) === 2) {
            habitat.orbitDirection = false;
        }
        return habitat;
    }

    // Port of Galaxy.5.cs CheckOrbitOverlap
    private checkOrbitOverlap(existingMin: number, existingMax: number, newMin: number, newMax: number): boolean {
        if (newMin >= existingMin && newMin <= existingMax) {
            return true;
        }
        if (newMax >= existingMin && newMax <= existingMax) {
            return true;
        }
        if (newMin < existingMin && newMax > existingMax) {
            return true;
        }
        return false;
    }

    // Port of Galaxy.6.cs CalculateAngleFromCoords
    private calculateAngleFromCoords(x: number, y: number, centerX: number, centerY: number, distance: number): number {
        const halfPi = Math.PI / 2.0;
        const negHalfPi = -halfPi;
        if (x < centerX) {
            if (y < centerY) {
                return negHalfPi - (halfPi + Math.asin((y - centerY) / distance));
            }
            return halfPi + (halfPi - Math.asin((y - centerY) / distance));
        }
        if (y < centerY) {
            return Math.asin((y - centerY) / distance) * -1.0;
        }
        return Math.asin((y - centerY) / distance);
    }

    // Port of Galaxy.6.cs SelectBarrenRockPlanet(diameter, out pictureRef, out landscapePictureRef)
    private selectBarrenRockPictures(): { pictureRef: number; landscapePictureRef: number } {
        return { pictureRef: 100 + this.rnd.next(0, 10), landscapePictureRef: 200 + this.rnd.next(0, 10) };
    }

    // Port of Galaxy.6.cs SelectBarrenRockPlanet(out type, out pictureRef, out diameter, out minOrbitDistance, out maxOrbitDistance, out landscapePictureRef)
    private selectBarrenRockPlanet(): { type: HabitatType; diameter: number; minOrbitDistance: number; maxOrbitDistance: number; pictureRef: number; landscapePictureRef: number } {
        const diameter = this.rnd.next(80, 340);
        const minOrbitDistance = 2500;
        const maxOrbitDistance = 11500;
        const { pictureRef, landscapePictureRef } = this.selectBarrenRockPictures();
        return { type: HabitatType.BarrenRock, diameter, minOrbitDistance, maxOrbitDistance, pictureRef, landscapePictureRef };
    }

    // Port of Galaxy.6.cs SelectContinentalPlanet
    private selectContinentalPlanet(): { type: HabitatType; diameter: number; minOrbitDistance: number; maxOrbitDistance: number; pictureRef: number; landscapePictureRef: number } {
        const diameter = this.rnd.next(200, 320);
        const pictureRef = 300 + this.rnd.next(0, 10);
        const landscapePictureRef = 400 + this.rnd.next(0, 10);
        return { type: HabitatType.Continental, diameter, minOrbitDistance: 5000, maxOrbitDistance: 10000, pictureRef, landscapePictureRef };
    }

    // Port of Galaxy.6.cs SelectIcePlanet
    private selectIcePlanet(): { type: HabitatType; diameter: number; minOrbitDistance: number; maxOrbitDistance: number; pictureRef: number; landscapePictureRef: number } {
        const diameter = this.rnd.next(180, 320);
        const pictureRef = 500 + this.rnd.next(0, 10);
        const landscapePictureRef = 600 + this.rnd.next(0, 10);
        return { type: HabitatType.Ice, diameter, minOrbitDistance: 18000, maxOrbitDistance: 23000, pictureRef, landscapePictureRef };
    }

    // Port of Galaxy.6.cs SelectMarshySwampPlanet
    private selectMarshySwampPlanet(): { type: HabitatType; diameter: number; minOrbitDistance: number; maxOrbitDistance: number; pictureRef: number; landscapePictureRef: number } {
        const diameter = this.rnd.next(200, 320);
        const pictureRef = 700 + this.rnd.next(0, 10);
        const landscapePictureRef = 800 + this.rnd.next(0, 10);
        return { type: HabitatType.MarshySwamp, diameter, minOrbitDistance: 5000, maxOrbitDistance: 9500, pictureRef, landscapePictureRef };
    }

    // Port of Galaxy.6.cs SelectOceanPlanet
    private selectOceanPlanet(): { type: HabitatType; diameter: number; minOrbitDistance: number; maxOrbitDistance: number; pictureRef: number; landscapePictureRef: number } {
        const diameter = this.rnd.next(200, 320);
        const pictureRef = 900 + this.rnd.next(0, 10);
        const landscapePictureRef = 1000 + this.rnd.next(0, 10);
        return { type: HabitatType.Ocean, diameter, minOrbitDistance: 5000, maxOrbitDistance: 10000, pictureRef, landscapePictureRef };
    }

    // Port of Galaxy.6.cs SelectDesertPlanet
    private selectDesertPlanet(): { type: HabitatType; diameter: number; minOrbitDistance: number; maxOrbitDistance: number; pictureRef: number; landscapePictureRef: number } {
        const diameter = this.rnd.next(180, 330);
        const pictureRef = 1100 + this.rnd.next(0, 10);
        const landscapePictureRef = 1200 + this.rnd.next(0, 10);
        return { type: HabitatType.Desert, diameter, minOrbitDistance: 3000, maxOrbitDistance: 10300, pictureRef, landscapePictureRef };
    }

    // Port of Galaxy.6.cs SelectVolcanicPlanet
    private selectVolcanicPlanet(): { type: HabitatType; diameter: number; minOrbitDistance: number; maxOrbitDistance: number; pictureRef: number; landscapePictureRef: number } {
        const diameter = this.rnd.next(160, 330);
        const pictureRef = 1300 + this.rnd.next(0, 10);
        const landscapePictureRef = 1400 + this.rnd.next(0, 10);
        return { type: HabitatType.Volcanic, diameter, minOrbitDistance: 1250, maxOrbitDistance: 3500, pictureRef, landscapePictureRef };
    }

    // Port of Galaxy.6.cs SelectGasGiantPlanet
    private selectGasGiantPlanet(): { type: HabitatType; diameter: number; minOrbitDistance: number; maxOrbitDistance: number; pictureRef: number; landscapePictureRef: number } {
        const diameter = this.rnd.next(550, 970);
        const pictureRef = 1500 + this.rnd.next(0, 10);
        const landscapePictureRef = 1600 + this.rnd.next(0, 10);
        return { type: HabitatType.GasGiant, diameter, minOrbitDistance: 12000, maxOrbitDistance: 17000, pictureRef, landscapePictureRef };
    }

    // Port of Galaxy.6.cs SelectFrozenGasGiantPlanet
    private selectFrozenGasGiantPlanet(): { type: HabitatType; diameter: number; minOrbitDistance: number; maxOrbitDistance: number; pictureRef: number; landscapePictureRef: number } {
        const diameter = this.rnd.next(480, 680);
        const pictureRef = 1700 + this.rnd.next(0, 10);
        const landscapePictureRef = 1800 + this.rnd.next(0, 10);
        return { type: HabitatType.FrozenGasGiant, diameter, minOrbitDistance: 17500, maxOrbitDistance: 22000, pictureRef, landscapePictureRef };
    }

    // Port of Galaxy.6.cs CalculatePlanetTypePrevalenceByStarType (line 2307).
    // colonyPrevalence defaults to 1.0 (matches _ColonyPrevalence's default
    // when GenerateGalaxyOptions.colonyPrevalence is unset).
    private calculatePlanetTypePrevalenceByStarType(starType: HabitatType): number[] {
        let thresholds: number[];
        switch (starType) {
            case HabitatType.MainSequence:
            case HabitatType.RedGiant:
            case HabitatType.SuperGiant:
                thresholds = [0.213, 0.015, 0.019, 0.029, 0.036, 0.058, 0.062, 0.281, 0.287];
                break;
            case HabitatType.WhiteDwarf:
                thresholds = [0.216, 0.0, 0.0, 0.0, 0.0, 0.176, 0.098, 0.0, 0.51];
                break;
            case HabitatType.Neutron:
                thresholds = [0.0, 0.0, 0.0, 0.0, 0.0, 0.333, 0.118, 0.0, 0.549];
                break;
            default:
                thresholds = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
                break;
        }
        const colonyPrevalence = this.colonyPrevalence;
        const num = 1.0 - (1.0 - colonyPrevalence) / 2.0;
        thresholds[1] *= colonyPrevalence;
        thresholds[2] *= colonyPrevalence;
        thresholds[7] *= num;
        return thresholds;
    }

    // Port of Galaxy.6.cs SelectPlanetType (line 2365)
    private selectPlanetType(parentStarType: HabitatType): {
        type: HabitatType;
        pictureRef: number;
        diameter: number;
        minOrbitDistance: number;
        maxOrbitDistance: number;
        landscapePictureRef: number;
    } {
        const prevalenceThresholds = this.calculatePlanetTypePrevalenceByStarType(parentStarType);
        const num = this.rnd.nextDouble();
        let sumLow = 0.0;
        let sumHigh = 0.0;
        let result: { type: HabitatType; diameter: number; minOrbitDistance: number; maxOrbitDistance: number; pictureRef: number; landscapePictureRef: number } | null = null;
        for (let i = 0; i < prevalenceThresholds.length; i++) {
            sumLow = sumHigh;
            sumHigh += prevalenceThresholds[i];
            if (num >= sumLow && num < sumHigh) {
                switch (i) {
                    case 0:
                        result = this.selectFrozenGasGiantPlanet();
                        break;
                    case 1:
                        result = this.selectContinentalPlanet();
                        break;
                    case 2:
                        result = this.selectMarshySwampPlanet();
                        break;
                    case 3:
                        result = this.selectOceanPlanet();
                        break;
                    case 4:
                        result = this.selectDesertPlanet();
                        break;
                    case 5:
                        result = this.selectIcePlanet();
                        break;
                    case 6:
                        result = this.selectVolcanicPlanet();
                        break;
                    case 7:
                        result = this.selectGasGiantPlanet();
                        break;
                    case 8:
                        result = this.selectBarrenRockPlanet();
                        break;
                    default:
                        result = this.selectBarrenRockPlanet();
                        break;
                }
                break;
            }
        }
        if (result === null || result.diameter <= 0) {
            result = this.selectBarrenRockPlanet();
        }
        return result;
    }

    // Port of Galaxy.6.cs CalculateMoonTypePrevalenceByPlanetType (line 1809)
    private calculateMoonTypePrevalenceByPlanetType(planetDiameter: number, planetType: HabitatType): number[] {
        let thresholds: number[];
        if (planetDiameter >= 430) {
            thresholds = planetType === HabitatType.FrozenGasGiant
                ? [0.15, 0.0, 0.0, 0.0, 0.0, 0.0, 0.85]
                : [0.08, 0.024, 0.024, 0.062, 0.062, 0.086, 0.662];
        } else if (planetDiameter >= 340) {
            thresholds = planetType === HabitatType.FrozenGasGiant
                ? [0.15, 0.0, 0.0, 0.0, 0.0, 0.0, 0.85]
                : [0.093, 0.0, 0.0, 0.093, 0.093, 0.093, 0.628];
        } else {
            thresholds = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0];
        }
        const colonyPrevalence = this.colonyPrevalence;
        thresholds[1] *= colonyPrevalence;
        thresholds[2] *= colonyPrevalence;
        return thresholds;
    }

    // Port of Galaxy.6.cs SelectMoonType (line 1873)
    private selectMoonType(parentDiameter: number, parentType: HabitatType): {
        type: HabitatType;
        diameter: number;
        pictureRef: number;
        landscapePictureRef: number;
    } {
        const prevalenceThresholds = this.calculateMoonTypePrevalenceByPlanetType(parentDiameter, parentType);
        const num = this.rnd.nextDouble();
        let sumLow = 0.0;
        let sumHigh = 0.0;
        let result: { type: HabitatType; diameter: number; pictureRef: number; landscapePictureRef: number } | null = null;
        for (let i = 0; i < prevalenceThresholds.length; i++) {
            sumLow = sumHigh;
            sumHigh += prevalenceThresholds[i];
            if (num >= sumLow && num < sumHigh) {
                switch (i) {
                    case 0:
                        result = this.selectIcePlanet();
                        break;
                    case 1:
                        result = this.selectContinentalPlanet();
                        break;
                    case 2:
                        result = this.selectMarshySwampPlanet();
                        break;
                    case 3:
                        result = this.selectOceanPlanet();
                        break;
                    case 4:
                        result = this.selectDesertPlanet();
                        break;
                    case 5:
                        result = this.selectVolcanicPlanet();
                        break;
                    case 6:
                        result = this.selectBarrenRockPlanet();
                        break;
                    default:
                        result = this.selectBarrenRockPlanet();
                        break;
                }
                break;
            }
        }
        if (result === null || result.diameter <= 0) {
            result = this.selectBarrenRockPlanet();
        }
        let diameter = result.diameter;
        if (diameter > parentDiameter * 0.33) {
            diameter = Math.trunc(parentDiameter * (this.rnd.next(28, 33) * 0.01));
        }
        return { type: result.type, diameter, pictureRef: result.pictureRef, landscapePictureRef: result.landscapePictureRef };
    }

    // Port of Galaxy.4.cs ResolveHabitatTypeByIndexIncludeGasClouds (line 774).
    // resources.txt distribution subType is a compact index, not the
    // HabitatType enum value.
    private resolveHabitatTypeByIndexIncludeGasClouds(index: number): HabitatType {
        switch (index) {
            case 0:
                return HabitatType.Continental;
            case 1:
                return HabitatType.MarshySwamp;
            case 2:
                return HabitatType.Ocean;
            case 3:
                return HabitatType.Desert;
            case 4:
                return HabitatType.Ice;
            case 5:
                return HabitatType.Volcanic;
            case 6:
                return HabitatType.BarrenRock;
            case 7:
                return HabitatType.GasGiant;
            case 8:
                return HabitatType.FrozenGasGiant;
            case 9:
                return HabitatType.Metal;
            case 10:
                return HabitatType.Ammonia;
            case 11:
                return HabitatType.Argon;
            case 12:
                return HabitatType.CarbonDioxide;
            case 13:
                return HabitatType.Chlorine;
            case 14:
                return HabitatType.Helium;
            case 15:
                return HabitatType.Hydrogen;
            case 16:
                return HabitatType.NitrogenOxygen;
            case 17:
                return HabitatType.Oxygen;
            default:
                return HabitatType.Continental;
        }
    }

    // Port of ResourceDefinitionList.cs CheckPrevalenceValidForHabitat
    // (line 56). Distribution type: 0=Planet/Moon, 1=Asteroid, 2=GasCloud.
    private checkPrevalenceValidForHabitat(habitat: Habitat, dist: Resource['distributions'][number]): boolean {
        if (this.resolveHabitatTypeByIndexIncludeGasClouds(dist.subType) !== habitat.type) {
            return false;
        }
        let valid = false;
        switch (habitat.category) {
            case HabitatCategoryType.Planet:
            case HabitatCategoryType.Moon:
                valid = dist.type !== 1 && dist.type !== 2;
                break;
            case HabitatCategoryType.Asteroid:
                // C#: this.Type == 1 && this.Type != 2 (the second
                // conjunct is redundant for a single value).
                valid = dist.type === 1;
                break;
            case HabitatCategoryType.GasCloud:
                // C#: this.Type == 2 && this.Type != 1.
                valid = dist.type === 2;
                break;
        }
        return valid;
    }

    // Port of ResourceSystem.cs GenerateRandomOrderedResources (line 225):
    // Fisher-Yates-style partial shuffle using the (substituted) CryptoRnd.
    private generateRandomOrderedResources(): Resource[] {
        const list = this.resources.slice();
        const ordered: Resource[] = [];
        while (list.length > 0) {
            const index = this.cryptoRnd.next(0, list.length);
            if (index >= 0 && index < list.length) {
                ordered.push(list[index]);
                list.splice(index, 1);
            }
        }
        return ordered;
    }

    // Port of ResourceDefinitionList.cs GetByName.
    private getResourceByName(name: string): Resource | null {
        for (const resource of this.resources) {
            if (resource.name === name) {
                return resource;
            }
        }
        return null;
    }

    // C# Resource.Name is a computed property: ResourceSystemStatic.Resources
    // [ResourceID].Name (Resource.cs:26).
    private getResourceName(resourceId: number): string {
        for (const resource of this.resources) {
            if (resource.resourceId === resourceId) {
                return resource.name;
            }
        }
        return '';
    }

    // Port of Galaxy.4.cs SelectResources (line 3270, all overloads collapse
    // into default parameters here). Prevalence/abundance rolls use the
    // (substituted) CryptoRnd stream; the resource-count roll uses Galaxy.Rnd.
    // C# HabitatResourceList.Add rejects duplicate resource IDs, but the
    // abundance roll happens before Add — so the roll is always performed
    // and only the push is skipped on duplicates (keeps the RNG sequence).
    selectResources(
        habitat: Habitat,
        minimumResourceCount = 0,
        dominantRace: object | null = null,
        minimumCriticalResourceCount = 0,
        randomOrderedResources: Resource[] | null = null,
    ): Habitat {
        let num = 0;
        if (this.starCount <= 250) {
            num = 1;
        }
        let num2: number;
        if (habitat.diameter >= 85) {
            if (habitat.diameter < 130) {
                num2 = this.rnd.next(0, 3 + num);
            } else if (habitat.diameter >= 170) {
                num2 = this.rnd.next(1 + num, 6);
            } else {
                num2 = this.rnd.next(0, 4 + num);
            }
        } else {
            num2 = this.rnd.next(0, 2 + num);
            if (habitat.category === HabitatCategoryType.Asteroid) {
                num2 = 0;
                if (this.rnd.next(0, 3) === 1) {
                    num2 = this.rnd.next(0, 2 + num);
                }
            }
        }
        if (num2 < minimumResourceCount) {
            num2 = minimumResourceCount;
        }
        minimumCriticalResourceCount = Math.min(minimumCriticalResourceCount, num2);
        if (dominantRace !== null && minimumResourceCount > 0) {
            // TODO(port): critical resources from dominantRace's
            // colonyGrowthResourceLevels (Rnd.Next(200, 800) abundances) —
            // Galaxy.4.cs SelectResources. dominantRace is always null at
            // every call site ported so far.
        }
        if (randomOrderedResources === null || randomOrderedResources.length <= 0) {
            randomOrderedResources = this.generateRandomOrderedResources();
        }
        for (let k = 0; k < randomOrderedResources.length; k++) {
            if (habitat.resources.length >= 5) {
                break;
            }
            const resourceDefinition = randomOrderedResources[k];
            if (
                resourceDefinition === null ||
                resourceDefinition.colonyManufacturingLevel > 0 ||
                resourceDefinition.distributions.length <= 0 ||
                resourceDefinition.superLuxuryBonusAmount > 0
            ) {
                continue;
            }
            for (let l = 0; l < resourceDefinition.distributions.length; l++) {
                const dist = resourceDefinition.distributions[l];
                if (dist === null || !this.checkPrevalenceValidForHabitat(habitat, dist)) {
                    continue;
                }
                // C#: float num3 = (float)CryptoRnd.NextDouble(); compared
                // against the float prevalence.
                const num3 = Math.fround(this.cryptoRnd.nextDouble());
                if (num3 < Math.fround(dist.prevalence)) {
                    let val = Math.trunc(Math.fround(dist.abundanceMin) * 1000);
                    let val2 = Math.trunc(Math.fround(dist.abundanceMax) * 1000);
                    val = Math.max(0, Math.min(1000, val));
                    val2 = Math.max(0, Math.min(1000, val2));
                    if (val > val2) {
                        val = val2;
                    }
                    const abundance = this.cryptoRnd.next(val, val2);
                    if (!habitat.resources.some((r) => r.resourceId === resourceDefinition.resourceId)) {
                        habitat.resources.push({ resourceId: resourceDefinition.resourceId, abundance });
                    }
                }
            }
        }
        return habitat;
    }

    // Port of Galaxy.6.cs SelectHabitatPictures (line 2062).
    selectHabitatPictures(habitat: Habitat): void {
        if (habitat.category === HabitatCategoryType.Asteroid) {
            switch (habitat.type) {
                case HabitatType.BarrenRock:
                    habitat.pictureRef = 2000 + this.rnd.next(0, 10);
                    habitat.landscapePictureRef = 200 + this.rnd.next(0, 10);
                    break;
                case HabitatType.Ice:
                    habitat.pictureRef = 2100 + this.rnd.next(0, 10);
                    habitat.landscapePictureRef = 200 + this.rnd.next(0, 10);
                    break;
                case HabitatType.Metal:
                    habitat.pictureRef = 2200 + this.rnd.next(0, 10);
                    habitat.landscapePictureRef = 200 + this.rnd.next(0, 10);
                    break;
                default:
                    habitat.pictureRef = 2000 + this.rnd.next(0, 10);
                    habitat.landscapePictureRef = 200 + this.rnd.next(0, 10);
                    break;
            }
            return;
        }
        switch (habitat.type) {
            case HabitatType.BarrenRock:
                habitat.pictureRef = 100 + this.rnd.next(0, 10);
                habitat.landscapePictureRef = 200 + this.rnd.next(0, 10);
                break;
            case HabitatType.Continental:
                habitat.pictureRef = 300 + this.rnd.next(0, 10);
                habitat.landscapePictureRef = 400 + this.rnd.next(0, 10);
                break;
            case HabitatType.FrozenGasGiant:
                // Port of Galaxy.6.cs SelectHabitatPictures FrozenGasGiant
                // case (2097-2143). GalaxyImages constants: landscape
                // 9+Next(0,2); pictures Argon 67/10, Helium 77/10, Krypton
                // 87/11, Tyderios 98/13, Any 111/10.
                habitat.landscapePictureRef = 9 + this.rnd.next(0, 2);
                if (habitat.resources.length > 0) {
                    if (this.rnd.next(0, 5) === 1) {
                        habitat.pictureRef = 111 + this.rnd.next(0, 10);
                        break;
                    }
                    let text2 = 'Tyderios';
                    let num2 = 0;
                    for (const resource of habitat.resources) {
                        if (resource.abundance > num2) {
                            text2 = this.getResourceName(resource.resourceId);
                            num2 = resource.abundance;
                        }
                    }
                    switch (text2.toLowerCase()) {
                        case 'argon':
                            habitat.pictureRef = 67 + this.rnd.next(0, 10);
                            break;
                        case 'helium':
                            habitat.pictureRef = 77 + this.rnd.next(0, 10);
                            break;
                        case 'krypton':
                            habitat.pictureRef = 87 + this.rnd.next(0, 11);
                            break;
                        case 'tyderios':
                            habitat.pictureRef = 98 + this.rnd.next(0, 13);
                            break;
                        default:
                            habitat.pictureRef = 67 + this.rnd.next(0, 10 + 10 + 11 + 13 + 10);
                            break;
                    }
                } else {
                    habitat.pictureRef = 67 + this.rnd.next(0, 10 + 10 + 11 + 13 + 10);
                }
                break;
            case HabitatType.GasGiant:
                // Port of Galaxy.6.cs SelectHabitatPictures GasGiant case
                // (2144-2193). GalaxyImages constants: landscape 11+Next(0,6);
                // pictures Argon 121/5, Caslon 126/5, Helium 131/8, Hydrogen
                // 139/8, Krypton 147/5, Any 152/2.
                habitat.landscapePictureRef = 11 + this.rnd.next(0, 6);
                if (habitat.resources.length > 0) {
                    if (this.rnd.next(0, 5) === 1) {
                        habitat.pictureRef = 152 + this.rnd.next(0, 2);
                        break;
                    }
                    let text = 'Hydrogen';
                    let num = 0;
                    for (const resource of habitat.resources) {
                        if (resource.abundance > num) {
                            text = this.getResourceName(resource.resourceId);
                            num = resource.abundance;
                        }
                    }
                    switch (text.toLowerCase()) {
                        case 'argon':
                            habitat.pictureRef = 121 + this.rnd.next(0, 5);
                            break;
                        case 'helium':
                            habitat.pictureRef = 131 + this.rnd.next(0, 8);
                            break;
                        case 'krypton':
                            habitat.pictureRef = 147 + this.rnd.next(0, 5);
                            break;
                        case 'caslon':
                            habitat.pictureRef = 126 + this.rnd.next(0, 5);
                            break;
                        case 'hydrogen':
                            habitat.pictureRef = 139 + this.rnd.next(0, 8);
                            break;
                        default:
                            habitat.pictureRef = 121 + this.rnd.next(0, 2 + 5 + 5 + 8 + 8 + 5);
                            break;
                    }
                } else {
                    habitat.pictureRef = 121 + this.rnd.next(0, 2 + 5 + 5 + 8 + 8 + 5);
                }
                break;
            case HabitatType.Ice:
                habitat.pictureRef = 500 + this.rnd.next(0, 10);
                habitat.landscapePictureRef = 600 + this.rnd.next(0, 10);
                break;
            case HabitatType.MarshySwamp:
                habitat.pictureRef = 700 + this.rnd.next(0, 10);
                habitat.landscapePictureRef = 800 + this.rnd.next(0, 10);
                break;
            case HabitatType.Ocean:
                habitat.pictureRef = 900 + this.rnd.next(0, 10);
                habitat.landscapePictureRef = 1000 + this.rnd.next(0, 10);
                break;
            case HabitatType.Desert:
                habitat.pictureRef = 1100 + this.rnd.next(0, 10);
                habitat.landscapePictureRef = 1200 + this.rnd.next(0, 10);
                break;
            case HabitatType.Volcanic:
                habitat.pictureRef = 1300 + this.rnd.next(0, 10);
                habitat.landscapePictureRef = 1400 + this.rnd.next(0, 10);
                break;
            // MainSequence/RedGiant/SuperGiant/WhiteDwarf/Neutron/BlackHole
            // (stars) and SuperNova aren't reachable here: SetupSolarSystem
            // only calls SelectHabitatPictures for planets/moons/asteroids.
        }
    }

    // Port of Galaxy.4.cs SelectHabitatQuality (line 3170)
    selectHabitatQuality(habitat: Habitat, colonyPrevalence: number): number {
        let base = 0;
        let spread = 0;
        let lifeChance = 0;
        switch (habitat.type) {
            case HabitatType.BarrenRock:
                base = 0;
                spread = 0.02;
                lifeChance = 0;
                break;
            case HabitatType.Continental:
                base = 1;
                spread = 0.2;
                lifeChance = 0;
                break;
            case HabitatType.Ice:
                base = 0.3;
                spread = 0.18;
                lifeChance = 0.11 * colonyPrevalence;
                break;
            case HabitatType.MarshySwamp:
                base = 0.85;
                spread = 0.15;
                lifeChance = 0;
                break;
            case HabitatType.Ocean: {
                base = 0.8;
                spread = 0.75;
                const diff = base - 0.5;
                base = diff * colonyPrevalence + 0.5;
                lifeChance = 0.03 * colonyPrevalence;
                break;
            }
            case HabitatType.Desert: {
                base = 0.75;
                spread = 0.72;
                const diff = base - 0.5;
                base = diff * colonyPrevalence + 0.5;
                lifeChance = 0.08 * colonyPrevalence;
                break;
            }
            case HabitatType.Volcanic:
                base = 0.25;
                spread = 0.18;
                lifeChance = 0.18 * colonyPrevalence;
                break;
            default:
                base = 0;
                spread = 0;
                lifeChance = 0;
                break;
        }
        let quality = base - this.rnd.nextDouble() * spread;
        if (this.rnd.nextDouble() < lifeChance) {
            quality = 0.5 + this.rnd.nextDouble() * 0.5;
        }
        if (quality >= 0.5 && quality < 0.6 && this.rnd.next(0, 5) > 0) {
            quality = 0.6 + this.rnd.nextDouble() * 0.12;
        }
        return Math.min(1, Math.max(0, quality));
    }

    // Port of Galaxy.9.cs GenerateTreasureAsteroid.
    // TextResolver.GetText("Asteroid") = "Asteroid" (TextResolver not ported —
    // literal used). GalaxyImages: LandscapeImageOffsetBarrenRock=0,
    // LandscapeImageCountBarrenRock=4; HabitatImageOffsetAsteroidsGold=649,
    // HabitatImageCountAsteroidsGold=8; HabitatImageOffsetAsteroidsCrystal=657,
    // HabitatImageCountAsteroidsCrystal=8.
    private generateTreasureAsteroid(
        sun: Habitat,
        orbitAngle: number,
        orbitDistance: number,
        orbitDirection: boolean,
        orbitSpeed: number,
        doInitialMove: boolean,
    ): Habitat | null {
        const byName = this.getResourceByName('Gold');
        const byName2 = this.getResourceByName('Dilithium Crystal');
        if (byName === null && byName2 === null) {
            return null;
        }
        const habitat = new Habitat(HabitatCategoryType.Asteroid, HabitatType.Metal, 'Asteroid', sun, orbitAngle, orbitDirection, orbitDistance, orbitSpeed, doInitialMove);
        habitat.diameter = this.rnd.next(35, 50);
        habitat.landscapePictureRef = 0 + this.rnd.next(0, 4);
        const abundance = this.rnd.next(800, 1000);
        if (byName2 === null) {
            // byName is non-null: the both-null case returned above.
            habitat.pictureRef = 649 + this.rnd.next(0, 8);
            habitat.resources.push({ resourceId: byName!.resourceId, abundance });
            habitat.name = this.generateGoldAsteroidName(sun);
        } else if (byName === null) {
            habitat.pictureRef = 657 + this.rnd.next(0, 8);
            habitat.resources.push({ resourceId: byName2.resourceId, abundance });
            habitat.name = this.generateCrystalAsteroidName(sun);
        } else if (this.rnd.next(0, 2) === 1) {
            habitat.pictureRef = 649 + this.rnd.next(0, 8);
            habitat.resources.push({ resourceId: byName.resourceId, abundance });
            habitat.name = this.generateGoldAsteroidName(sun);
        } else {
            habitat.pictureRef = 657 + this.rnd.next(0, 8);
            habitat.resources.push({ resourceId: byName2.resourceId, abundance });
            habitat.name = this.generateCrystalAsteroidName(sun);
        }
        habitat.scenicFactor = 0.3 + this.rnd.nextDouble() * 0.3;
        return habitat;
    }

    // Port of Galaxy.9.cs GenerateGoldAsteroidName.
    private generateGoldAsteroidName(sun: Habitat | null): string {
        const array = ['Concealed', 'Lost', 'Golden', 'Precious', 'Glittering', 'Hidden', "Miner's"];
        const array2 = ['Hoard', 'Rock', 'Treasure', 'Nugget', 'Fortune', 'Folly', 'Legend', 'Star', 'Prize'];
        if (sun !== null && sun.type !== HabitatType.SuperNova && this.rnd.next(0, 3) === 1) {
            if (this.rnd.next(0, 2) === 1) {
                return sun.name + ' ' + array2[this.rnd.next(0, array2.length)];
            }
            return array2[this.rnd.next(0, array2.length)] + ' of ' + sun.name;
        }
        return array[this.rnd.next(0, array.length)] + ' ' + array2[this.rnd.next(0, array2.length)];
    }

    // Port of Galaxy.9.cs GenerateCrystalAsteroidName.
    private generateCrystalAsteroidName(sun: Habitat | null): string {
        const array = ['Concealed', 'Lost', 'Shining', 'Precious', 'Glittering', 'Hidden', "Miner's", 'Crystal'];
        const array2 = ['Hoard', 'Rock', 'Treasure', 'Jewel', 'Fortune', 'Folly', 'Legend', 'Star', 'Prize', 'Gem'];
        if (sun !== null && sun.type !== HabitatType.SuperNova && this.rnd.next(0, 3) === 1) {
            if (this.rnd.next(0, 2) === 1) {
                return sun.name + ' ' + array2[this.rnd.next(0, array2.length)];
            }
            return array2[this.rnd.next(0, array2.length)] + ' of ' + sun.name;
        }
        return array[this.rnd.next(0, array.length)] + ' ' + array2[this.rnd.next(0, array2.length)];
    }

    // Port of Galaxy.9.cs GenerateAsteroidField (line 3482 overload; the
    // simpler overloads at 3463/3470 that resolve nearestSystemStar/
    // orbitDistance via FindNearestSystemGasCloudAsteroid aren't ported —
    // SetupSolarSystem always supplies nearestSystemStar/orbitDistance
    // directly). `randomOrderedResources` defaults to null, in which case
    // SelectResources shuffles all resources (C#
    // GenerateRandomOrderedResources).
    private generateAsteroidFieldAt(
        asteroidCount: number,
        x: number,
        y: number,
        nearestSystemStar: Habitat,
        orbitDirection: boolean,
        orbitSpeed: number,
        orbitDistance: number,
        distanceSpreadFactor: number,
        arcSpreadFactor: number,
        type: HabitatType,
        randomOrderedResources?: Resource[] | null,
    ): Habitat[] {
        const result: Habitat[] = [];
        const baseAngle = this.calculateAngleFromCoords(x, y, nearestSystemStar.xpos, nearestSystemStar.ypos, orbitDistance);
        let arcSpread = arcSpreadFactor * arcSpreadFactor;
        let val = (MAX_SOLAR_SYSTEM_SIZE - orbitDistance) / (MAX_SOLAR_SYSTEM_SIZE / 3);
        val = Math.min(3.0, Math.max(0.3, val));
        arcSpread *= val;
        const distSpread = Math.max(0.06, 0.13 * (asteroidCount / 350.0));
        const distRange = Math.max(250.0, 500.0 * (asteroidCount / 350.0) * distanceSpreadFactor);
        const negHalf = -0.4;
        let minDist = orbitDistance + negHalf * distRange * distanceSpreadFactor;
        let maxDist = orbitDistance + 0.4 * distRange * distanceSpreadFactor;
        let minAngle = baseAngle + negHalf * distSpread * arcSpread;
        let maxAngle = baseAngle + 0.4 * distSpread * arcSpread;
        if (minAngle > maxAngle) {
            const tmp = maxAngle;
            maxAngle = minAngle;
            minAngle = tmp;
        }
        for (let i = 0; i < asteroidCount; i++) {
            let diameter = this.rnd.next(10, 25);
            if (this.rnd.next(0, 30) === 5) {
                diameter = this.rnd.next(26, 45);
            }
            const pictureRef = 2000 + this.rnd.next(0, 10);
            let dist = orbitDistance + Math.trunc((this.rnd.nextDouble() - 0.5) * this.rnd.nextDouble() * 2.0 * distRange * distanceSpreadFactor);
            let angle = baseAngle + (this.rnd.nextDouble() - 0.5) * this.rnd.nextDouble() * 2.0 * distSpread * arcSpread;
            if (dist > minDist && dist < maxDist && angle > minAngle && angle < maxAngle) {
                const distFrac = this.rnd.nextDouble() * 0.8 - 0.4;
                const angleFrac = this.rnd.nextDouble() * 0.8 - 0.4;
                dist = orbitDistance + Math.trunc(distFrac * distRange * distanceSpreadFactor);
                angle = baseAngle + angleFrac * distSpread * arcSpread;
            }
            const name = this.generateCodeName() + ', Asteroid Field';
            const asteroid = new Habitat(HabitatCategoryType.Asteroid, HabitatType.BarrenRock, name, nearestSystemStar, angle, orbitDirection, dist, orbitSpeed, false);
            asteroid.diameter = diameter;
            asteroid.pictureRef = pictureRef;
            asteroid.landscapePictureRef = -1;
            let minimumResourceCount = 0;
            if (type === HabitatType.Metal && this.rnd.next(0, 3) > 0) {
                minimumResourceCount = 1;
            }
            // C# calls SelectResources(habitat, minimumResourceCount, null, 0,
            // randomOrderedResources) while habitat.Type is still BarrenRock,
            // then sets habitat.Type = type.
            this.selectResources(asteroid, minimumResourceCount, null, 0, randomOrderedResources ?? null);
            asteroid.type = type;
            this.selectHabitatPictures(asteroid);
            if (this.rnd.next(0, 1300) === 1) {
                const treasure = this.generateTreasureAsteroid(nearestSystemStar, angle, dist, orbitDirection, orbitSpeed, false);
                if (treasure !== null) {
                    // C# replaces the asteroid with the treasure habitat (it
                    // would add null if GenerateTreasureAsteroid returned
                    // null); we keep the original asteroid in that case.
                    result.push(treasure);
                    continue;
                }
            }
            result.push(asteroid);
        }
        return result;
    }

    // Port of Galaxy.4.cs DetermineNearestRaceRegion(x, y) (Galaxy.4.cs:1919).
    // Returns the RaceRegion GalaxyLocation whose center is closest to (x, y),
    // or null when there are no race regions.
    determineNearestRaceRegion(x: number, y: number): GalaxyLocation | null {
        let result: GalaxyLocation | null = null;
        let num = Number.MAX_VALUE;
        for (let i = 0; i < this.galaxyLocations.length; i++) {
            if (this.galaxyLocations[i].type === GalaxyLocationType.RaceRegion) {
                const center = this.galaxyLocations[i].resolveLocationCenter();
                const num2 = this.calculateDistanceSquared(x, y, center.x, center.y);
                if (num2 < num) {
                    result = this.galaxyLocations[i];
                    num = num2;
                }
            }
        }
        return result;
    }

    // Port of Galaxy.6.cs CheckIndependentColonyLimitForRace(race)
    // (Galaxy.6.cs:1273). _LifePrevalence defaults to 1000 (C# ctor), so the
    // limit is (int)(Math.Sqrt(StarCount) / 3.5 * _LifePrevalence / 1000.0).
    private checkIndependentColonyLimitForRace(race: Race): boolean {
        const num = this.lifePrevalence / 1000.0;
        const num2 = Math.trunc(Math.sqrt(this.starCount) / 3.5 * num);
        if (this.raceIndependentColonyCount === null || this.raceIndependentColonyCount.length === 0) {
            this.raceIndependentColonyCount = [];
            for (let i = 0; i < this.races.length; i++) {
                this.raceIndependentColonyCount.push(0);
            }
        }
        // C# indexes by race.PictureRef (list sized Races.Count — quirk kept).
        const num3 = this.raceIndependentColonyCount[race.pictureIndex] ?? 0;
        return num3 >= num2;
    }

    // Port of Galaxy.6.cs RenameSystemIfHome(sun, race) (Galaxy.6.cs:1320).
    // The first native population of a given race renames its star system to
    // the race's HomeSystemName and marks that race as used.
    private renameSystemIfHome(sun: Habitat, race: Race, raceUsed: boolean[]): void {
        const pictureRef = race.pictureIndex;
        if (!raceUsed[pictureRef]) {
            sun.name = race.homeSystemName;
            raceUsed[pictureRef] = true;
        }
    }

    // Port of Galaxy.6.cs CalculatePopulationAmount(habitat, race)
    // (Galaxy.6.cs:1330). habitat.Quality reduces to BaseQuality at
    // generation time (no bases/creatures yet).
    private calculatePopulationAmount(habitat: Habitat, race: Race): number {
        let num = habitat.baseQuality * 1000;
        if (habitat.type === race.nativePlanetType) {
            num *= 1.5;
        }
        let num2 = 0;
        const num3 = this.rnd.next(0, 30);
        num2 = num3 < 0 || num3 > 6 ? this.rnd.next(100000, 300000) * num : this.rnd.next(300000, 600000) * num;
        if (this.age > 0) {
            num2 = Math.trunc(num2 * Math.pow(1.2, this.age));
        }
        return num2;
    }

    // Port of Galaxy.6.cs SelectPopulation(habitat, sun) (Galaxy.6.cs:1218).
    // Places an independent (native) population on the habitat when the
    // nearest race region's race natively inhabits this habitat type and the
    // per-race independent-colony limit hasn't been reached. Every Rnd call
    // goes through this.rnd in source order.
    selectPopulation(habitat: Habitat, sun: Habitat): void {
        if (habitat.diameter < 75) {
            return;
        }
        if (this.raceUsed === null) {
            this.raceUsed = new Array(this.races.length).fill(false);
        }
        const raceUsed = this.raceUsed;
        let race: Race | null = null;
        const galaxyLocation = this.determineNearestRaceRegion(habitat.xpos, habitat.ypos);
        if (galaxyLocation !== null) {
            race = galaxyLocation.relatedRace;
        }
        if (race !== null && race.nativePlanetType === habitat.type && !this.checkIndependentColonyLimitForRace(race)) {
            if (habitat.baseQuality < 0.6) {
                // C#: habitat.BaseQuality = 0.5f + (float)(Rnd.NextDouble() * 0.4)
                // (float casts throughout — Math.fround matches).
                habitat.baseQuality = Math.fround(0.5 + Math.fround(this.rnd.nextDouble() * 0.4));
            }
            const num = 1;
            for (let i = 0; i < num; i++) {
                this.independentCount++;
                const amount = this.calculatePopulationAmount(habitat, race);
                const population = new Population(race, amount);
                // C#: population.GrowthRate = 1f + ((float)race.ReproductiveRate - 1f) / 3f
                population.growthRate = Math.fround(1 + (Math.fround(race.reproductionRate) - 1) / 3);
                if (this.raceIndependentColonyCount !== null) {
                    const idx = race.pictureIndex;
                    if (idx < this.raceIndependentColonyCount.length) {
                        this.raceIndependentColonyCount[idx]++;
                    }
                }
                habitat.population.add(population);
                this.renameSystemIfHome(sun, race, raceUsed);
            }
            habitat.population.recalculateTotalAmount();
        }
    }

    // Port of Galaxy.5.cs SetupSolarSystem(galaxyShape, sunHabitat, out
    // asteroidField) (lines 1386-1945). colonyPrevalence (this.colonyPrevalence)
    // stands in for Galaxy._ColonyPrevalence.
    //
    // Not ported (out of scope per task 01c): SelectCreatures,
    // DockingBay/Cargo/Troop/Character/Construction/
    // Manufacturing list setup, DoTasks. SelectPopulation was ported in
    // task 01f2 (see selectPopulation below). Every call site that would
    // have called one of the skipped functions is noted in the Worker report
    // together with the (data-dependent, non-fixed) number of Rnd calls it
    // would have consumed in the original — the ported Rnd sequence
    // diverges from the original from the first such call site onward.
    setupSolarSystem(galaxyShape: GalaxyShape): { habitats: Habitat[]; asteroidField: Habitat[] | null } {
        let allowCreatures = true; // C#: flag
        const habitatList: Habitat[] = []; // C#: habitatList (planets/moons/asteroids, unordered)
        const habitatList2: Habitat[] = []; // C#: habitatList2 (final ordered return list)
        let asteroidField: Habitat[] | null = null;
        const minValue = 0; // sunHabitat is always null at this call site (see Galaxy.5.cs sunHabitat==null branch).
        const sunHabitat = this.setupSun(galaxyShape);

        let maxValue = 0;
        let planetCount = 0;
        switch (sunHabitat.type) {
            case HabitatType.MainSequence:
            case HabitatType.RedGiant:
            case HabitatType.SuperGiant:
                maxValue = 12;
                if (this.starCount <= 400) {
                    switch (this.rnd.next(minValue, 8)) {
                        case 0:
                            planetCount = 0;
                            break;
                        case 1:
                        case 2:
                            planetCount = this.rnd.next(1, 4);
                            break;
                        case 3:
                        case 4:
                            planetCount = this.rnd.next(2, 7);
                            break;
                        case 5:
                        case 6:
                            planetCount = this.rnd.next(5, 10);
                            break;
                        case 7:
                            planetCount = this.rnd.next(6, 16);
                            break;
                    }
                } else if (this.starCount <= 1000) {
                    switch (this.rnd.next(minValue, 7)) {
                        case 0:
                            planetCount = 0;
                            break;
                        case 1:
                        case 2:
                            planetCount = this.rnd.next(1, 4);
                            break;
                        case 3:
                        case 4:
                            planetCount = this.rnd.next(3, 7);
                            break;
                        case 5:
                            planetCount = this.rnd.next(4, 9);
                            break;
                        case 6:
                            planetCount = this.rnd.next(5, 15);
                            break;
                    }
                } else {
                    switch (this.rnd.next(minValue, 5)) {
                        case 0:
                            planetCount = 0;
                            break;
                        case 1:
                            planetCount = this.rnd.next(1, 3);
                            break;
                        case 2:
                            planetCount = this.rnd.next(2, 5);
                            break;
                        case 3:
                            planetCount = this.rnd.next(3, 7);
                            break;
                        case 4:
                            planetCount = this.rnd.next(4, 11);
                            break;
                    }
                }
                break;
            case HabitatType.WhiteDwarf:
                maxValue = 3;
                switch (this.rnd.next(minValue, 6)) {
                    case 0:
                    case 1:
                    case 2:
                    case 3:
                        planetCount = 0;
                        break;
                    case 4:
                    case 5:
                        planetCount = this.rnd.next(1, 3);
                        break;
                }
                break;
            case HabitatType.Neutron:
                maxValue = 24;
                switch (this.rnd.next(minValue, 6)) {
                    case 0:
                    case 1:
                    case 2:
                    case 3:
                        planetCount = 0;
                        break;
                    case 4:
                    case 5:
                        planetCount = 1;
                        break;
                }
                break;
            case HabitatType.SuperNova:
                maxValue = 2;
                allowCreatures = false;
                planetCount = 0;
                break;
        }

        if (planetCount > 0) {
            let attempts = 0;
            for (;;) {
                if (attempts < 20) {
                    if (this.assignSystemName(sunHabitat, planetCount)) {
                        break;
                    }
                    attempts++;
                    continue;
                }
                sunHabitat.name = this.generateCodeName();
                break;
            }
        }
        this.setScenicFactor(sunHabitat);
        this.setResearchBonus(sunHabitat);
        habitatList2.push(sunHabitat);

        if (planetCount > 0) {
            for (let i = 0; i < planetCount; i++) {
                let habitat: Habitat = sunHabitat;
                const { type, pictureRef, diameter, minOrbitDistance, maxOrbitDistance, landscapePictureRef } = this.selectPlanetType(habitat.type);
                const halfSpacing = Math.trunc(diameter / 4);
                let attempts = 0;
                let orbitDistance = this.rnd.next(minOrbitDistance, maxOrbitDistance);
                let newMin = orbitDistance - (Math.trunc(diameter / 2) + halfSpacing);
                let newMax = orbitDistance + (Math.trunc(diameter / 2) + halfSpacing);
                let overlap = true;
                while (overlap && attempts < 50) {
                    overlap = false;
                    for (const existing of habitatList) {
                        const existingMin = existing.orbitDistance - (Math.trunc(existing.diameter / 2) + halfSpacing);
                        const existingMax = existing.orbitDistance + (Math.trunc(existing.diameter / 2) + halfSpacing);
                        if (this.checkOrbitOverlap(existingMin, existingMax, newMin, newMax)) {
                            orbitDistance = this.rnd.next(minOrbitDistance, maxOrbitDistance);
                            newMin = orbitDistance - (Math.trunc(diameter / 2) + halfSpacing);
                            newMax = orbitDistance + (Math.trunc(diameter / 2) + halfSpacing);
                            overlap = true;
                            break;
                        }
                    }
                    attempts++;
                }
                let planet = new Habitat(
                    HabitatCategoryType.Planet,
                    type,
                    'Planet',
                    habitat,
                    this.rnd.nextDouble() * Math.PI * 2.0,
                    true,
                    orbitDistance,
                    this.rnd.next(2, 5),
                );
                planet.diameter = diameter;
                planet.pictureRef = pictureRef;
                planet.landscapePictureRef = landscapePictureRef;
                planet.baseQuality = this.selectHabitatQuality(planet, this.colonyPrevalence);
                // TODO(port): DoTasks(CurrentDateTime) — Habitat.DoTasks (galaxy-time driven; out of scope).
                this.selectResources(planet);
                this.setScenicFactor(planet);
                this.setResearchBonus(planet);
                this.selectHabitatPictures(planet);
                if (this.rnd.next(0, 5) === 2) {
                    planet.orbitDirection = false;
                }
                if (planet.type === HabitatType.GasGiant && planet.diameter < 760) {
                    planet.hasRings = true;
                }
                let populationRolls = 1;
                if (this.rnd.next(0, 4) === 1) {
                    populationRolls++;
                }
                for (let p = 0; p < populationRolls; p++) {
                    this.selectPopulation(planet, sunHabitat);
                }
                // TODO(port): population-driven DockingBay/Cargo/Troop/etc setup vs. SelectCreatures(habitat2) — Galaxy.6.cs:654 (SelectCreatures). Data-dependent Rnd-call count; see Worker report.
                habitatList.push(planet);
                habitat = planet;

                let moonCount = 0;
                if (this.starCount <= 400) {
                    if (planet.diameter <= 370) {
                        moonCount = planet.diameter > 260 ? this.rnd.next(0, 3) : planet.diameter > 150 ? this.rnd.next(0, 2) : 0;
                    } else {
                        moonCount = this.rnd.next(0, Math.min(5, Math.trunc(planet.diameter / 165)));
                    }
                } else if (this.starCount <= 1000) {
                    if (planet.diameter <= 370) {
                        moonCount = planet.diameter > 260 ? this.rnd.next(0, 3) : planet.diameter > 165 ? this.rnd.next(0, 2) : 0;
                    } else {
                        moonCount = this.rnd.next(0, Math.min(5, Math.trunc(planet.diameter / 180)));
                    }
                } else if (planet.diameter <= 370) {
                    moonCount = planet.diameter > 260 ? this.rnd.next(0, 3) : planet.diameter > 180 ? this.rnd.next(0, 2) : 0;
                } else {
                    moonCount = this.rnd.next(0, Math.min(5, Math.trunc(planet.diameter / 180)));
                }

                const moonsForThisPlanet: Habitat[] = [];
                for (let l = 0; l < moonCount; l++) {
                    const moonSel = this.selectMoonType(habitat.diameter, habitat.type);
                    let moonDiameter = moonSel.diameter;
                    let moon = new Habitat(
                        HabitatCategoryType.Moon,
                        moonSel.type,
                        this.generateCodeName(),
                        habitat,
                        this.rnd.nextDouble() * Math.PI * 2.0,
                        true,
                        this.rnd.next(5, 32),
                        this.rnd.next(4, 9),
                    );
                    if (moonDiameter < 15) {
                        moonDiameter = 15;
                    }
                    moon.diameter = moonDiameter;
                    moon.pictureRef = moonSel.pictureRef;
                    moon.landscapePictureRef = moonSel.landscapePictureRef;
                    moon.baseQuality = this.selectHabitatQuality(moon, this.colonyPrevalence);

                    const minMoonOrbit = Math.max(150, Math.trunc(habitat.diameter * 0.75));
                    let maxMoonOrbit = Math.trunc(habitat.diameter * 3.3);
                    if (maxMoonOrbit > MAX_MOON_ORBIT_SIZE) {
                        maxMoonOrbit = MAX_MOON_ORBIT_SIZE;
                    }
                    const moonSpacing = 5;
                    let moonAttempts = 0;
                    let moonOrbitDistance = this.rnd.next(minMoonOrbit, maxMoonOrbit);
                    let moonNewMin = moonOrbitDistance - (Math.trunc(moonDiameter / 2) + moonSpacing);
                    let moonNewMax = moonOrbitDistance + (Math.trunc(moonDiameter / 2) + moonSpacing);
                    let moonOverlap = true;
                    while (moonOverlap && moonAttempts < 50) {
                        moonOverlap = false;
                        for (const existingMoon of moonsForThisPlanet) {
                            const existingMin = existingMoon.orbitDistance - (Math.trunc(existingMoon.diameter / 2) + moonSpacing);
                            const existingMax = existingMoon.orbitDistance + (Math.trunc(existingMoon.diameter / 2) + moonSpacing);
                            if (this.checkOrbitOverlap(existingMin, existingMax, moonNewMin, moonNewMax)) {
                                moonOrbitDistance = this.rnd.next(minMoonOrbit, maxMoonOrbit);
                                moonNewMin = moonOrbitDistance - (Math.trunc(moonDiameter / 2) + moonSpacing);
                                moonNewMax = moonOrbitDistance + (Math.trunc(moonDiameter / 2) + moonSpacing);
                                moonOverlap = true;
                                break;
                            }
                        }
                        moonAttempts++;
                    }
                    moonsForThisPlanet.push(moon);
                    moon.orbitDistance = moonOrbitDistance;
                    // TODO(port): DoTasks(CurrentDateTime) — out of scope (galaxy time).
                    this.selectResources(moon);
                    this.setScenicFactor(moon);
                    this.setResearchBonus(moon);
                    this.selectHabitatPictures(moon);
                    if (this.rnd.next(0, 5) === 2) {
                        moon.orbitDirection = false;
                    }
                    let moonPopulationRolls = 1;
                    if (this.rnd.next(0, 4) === 1 && moon.type !== HabitatType.BarrenRock) {
                        moonPopulationRolls++;
                    }
                    for (let p = 0; p < moonPopulationRolls; p++) {
                        this.selectPopulation(moon, sunHabitat);
                    }
                    // TODO(port): population-driven setup vs. SelectCreatures(habitat2) — Galaxy.6.cs:654. Data-dependent Rnd-call count; see Worker report.
                    habitatList.push(moon);
                }
            }

            // Extra un-clustered asteroids directly orbiting the star.
            const extraAsteroidCount = this.rnd.next(0, Math.trunc(planetCount * 4.5));
            for (let i = 0; i < extraAsteroidCount; i++) {
                const name = this.generateCodeName();
                const diameter = this.rnd.next(20, 35);
                const pictureRef = 2000 + this.rnd.next(0, 10);
                const orbitAngle = this.rnd.nextDouble() * Math.PI * 2.0;
                const asteroid = new Habitat(
                    HabitatCategoryType.Asteroid,
                    HabitatType.BarrenRock,
                    name,
                    sunHabitat,
                    orbitAngle,
                    true,
                    this.rnd.next(10500, 11500),
                    this.rnd.next(2, 8),
                );
                asteroid.diameter = diameter;
                asteroid.pictureRef = pictureRef;
                asteroid.landscapePictureRef = -1;
                asteroid.baseQuality = this.selectHabitatQuality(asteroid, this.colonyPrevalence);
                this.selectResources(asteroid);
                this.selectHabitatPictures(asteroid);
                if (this.rnd.next(0, 5) === 2) {
                    asteroid.orbitDirection = false;
                }
                // TODO(port): SelectCreatures(habitat2) — Galaxy.6.cs:654. Data-dependent Rnd-call count; see Worker report.
                habitatList.push(asteroid);
            }
        }

        // Main asteroid field (Galaxy.5.cs 1813-1909: inlined equivalent of
        // GenerateAsteroidField, kept in-line here to match source exactly;
        // the standalone generateAsteroidFieldAt() helper above ports
        // Galaxy.9.cs GenerateAsteroidField for API completeness but isn't
        // called from here since SetupSolarSystem doesn't call it).
        if (this.rnd.next(0, maxValue) === 1) {
            let fieldCount = 1;
            if (sunHabitat.type === HabitatType.SuperNova && this.rnd.next(0, 2) === 1) {
                fieldCount = 2;
            }
            for (let f = 0; f < fieldCount; f++) {
                const fieldAsteroids: Habitat[] = [];
                const asteroidCount = this.rnd.next(80, 350);
                const baseAngle = this.rnd.nextDouble() * Math.PI * 2.0;
                let baseOrbitDistance = this.rnd.next(9500, 10500);
                let fieldType = HabitatType.BarrenRock;
                switch (this.rnd.next(0, 4)) {
                    case 1:
                        fieldType = HabitatType.Metal;
                        break;
                    case 2:
                        fieldType = HabitatType.Ice;
                        break;
                }
                if (sunHabitat.type === HabitatType.SuperNova) {
                    fieldType = HabitatType.Metal;
                }
                if (fieldType === HabitatType.Ice) {
                    baseOrbitDistance = this.rnd.next(17200, 22200);
                }
                const orbitSpeed = this.rnd.next(1, 4);
                let orbitDirection = true;
                if (this.rnd.next(0, 4) === 2) {
                    orbitDirection = false;
                }
                const arcSpread = Math.max(0.06, 0.13 * (asteroidCount / 350.0));
                const distRange = Math.max(250.0, 500.0 * (asteroidCount / 350.0));
                const negHalf = -0.4;
                const minDist = baseOrbitDistance + negHalf * distRange;
                const maxDist = baseOrbitDistance + 0.4 * distRange;
                let minAngle = baseAngle + negHalf * arcSpread;
                let maxAngle = baseAngle + 0.4 * arcSpread;
                if (minAngle > maxAngle) {
                    const tmp = maxAngle;
                    maxAngle = minAngle;
                    minAngle = tmp;
                }
                for (let a = 0; a < asteroidCount; a++) {
                    let name = this.generateCodeName();
                    name = name + ', Asteroid Field';
                    let diameter = this.rnd.next(10, 25);
                    if (this.rnd.next(0, 30) === 5) {
                        diameter = this.rnd.next(26, 45);
                    }
                    const pictureRef = 2000 + this.rnd.next(0, 10);
                    let dist = baseOrbitDistance + Math.trunc((this.rnd.nextDouble() - 0.5) * this.rnd.nextDouble() * 2.0 * distRange);
                    let angle = baseAngle + (this.rnd.nextDouble() - 0.5) * this.rnd.nextDouble() * 2.0 * arcSpread;
                    if (dist > minDist && dist < maxDist && angle > minAngle && angle < maxAngle) {
                        const distFrac = this.rnd.nextDouble() * 0.8 - 0.4;
                        const angleFrac = this.rnd.nextDouble() * 0.8 - 0.4;
                        dist = baseOrbitDistance + Math.trunc(distFrac * distRange);
                        angle = baseAngle + angleFrac * arcSpread;
                    }
                    const asteroid = new Habitat(HabitatCategoryType.Asteroid, HabitatType.BarrenRock, name, sunHabitat, angle, orbitDirection, dist, orbitSpeed);
                    asteroid.diameter = diameter;
                    asteroid.pictureRef = pictureRef;
                    asteroid.landscapePictureRef = -1;
                    asteroid.baseQuality = this.selectHabitatQuality(asteroid, this.colonyPrevalence);
                    let minimumResourceCount = 0;
                    if (fieldType === HabitatType.Metal && this.rnd.next(0, 3) > 0) {
                        minimumResourceCount = 1;
                    }
                    // C# sets habitat3.Type = fieldType (Galaxy.5.cs:1894)
                    // before SelectResources(habitat3, minimumResourceCount)
                    // (1895).
                    asteroid.type = fieldType;
                    this.selectResources(asteroid, minimumResourceCount);
                    this.selectHabitatPictures(asteroid);
                    if (allowCreatures) {
                        // TODO(port): SelectCreatures(habitat3) — Galaxy.6.cs:654. Data-dependent Rnd-call count; see Worker report.
                    }
                    let toAdd = asteroid;
                    if (this.rnd.next(0, 1300) === 1) {
                        const treasure = this.generateTreasureAsteroid(sunHabitat, angle, dist, orbitDirection, orbitSpeed, true);
                        if (treasure !== null) {
                            // C# replaces the asteroid with the treasure
                            // habitat (it would add null if
                            // GenerateTreasureAsteroid returned null); we
                            // keep the original asteroid in that case.
                            toAdd = treasure;
                        }
                    }
                    fieldAsteroids.push(toAdd);
                    habitatList.push(toAdd);
                }
                asteroidField = fieldAsteroids;
            }
        }

        // Sort planets/asteroids by orbit distance, assign final names, and
        // build the ordered return list (Galaxy.5.cs 1910-1944).
        const orderable = habitatList.filter((h) => h.category === HabitatCategoryType.Planet || h.category === HabitatCategoryType.Asteroid);
        orderable.sort((a, b) => a.orbitDistance - b.orbitDistance);
        let planetNumber = 1;
        for (const h of orderable) {
            if (h.category === HabitatCategoryType.Planet) {
                h.name = sunHabitat.name + ' ' + planetNumber;
                planetNumber++;
            }
            if (!habitatList2.includes(h)) {
                habitatList2.push(h);
            }
            for (const moon of habitatList) {
                if (moon.parent === h) {
                    // Port of Galaxy.4.cs GenerateMoonName: not fully ported
                    // (depends on DetermineHabitatSystemStar/GenerateRandomNameAlt
                    // string generators, out of scope) — a code name is used
                    // instead. TODO(port): GenerateMoonName — Galaxy.4.cs:2533.
                    moon.name = this.generateCodeName();
                    habitatList2.push(moon);
                }
            }
        }

        return { habitats: habitatList2, asteroidField };
    }

    // Port of the star-cluster setup portion of the Galaxy.4.cs constructor
    // (2221-2276), only used for the Clusters shapes.
    setupStarClusters(shape: GalaxyShape, starCount: number): void {
        if (shape !== GalaxyShape.ClustersEven && shape !== GalaxyShape.ClustersVaried) {
            return;
        }
        const clusterCount = Math.min(20, Math.max(5, Math.trunc(starCount / 55)));
        const minSeparation = this.sizeX / (Math.sqrt(clusterCount) * 3.0);
        let portionTotal = 0.0;
        for (let i = 0; i < clusterCount; i++) {
            let placed = false;
            let attempts = 0;
            while (!placed && attempts < 50) {
                placed = true;
                let portion = 1.0 / clusterCount;
                if (shape === GalaxyShape.ClustersVaried) {
                    const minPortion = portion / 2.0;
                    if (this.rnd.next(0, 2) !== 1) {
                        const factor = 1.0 + this.rnd.nextDouble() * 4.0;
                        portion *= factor;
                        portion = Math.max(portion, minPortion);
                    }
                }
                const x = this.sizeX * 0.1 + this.rnd.nextDouble() * (this.sizeX * 0.8);
                const y = this.sizeY * 0.1 + this.rnd.nextDouble() * (this.sizeY * 0.8);
                for (let j = 0; j < this.starClusterLocations.length; j++) {
                    const loc = this.starClusterLocations[j];
                    const dist = this.calculateDistance(x, y, loc.x, loc.y);
                    const existingRadius = Math.sqrt(this.starClusterPortions[j]) * this.sizeX * 0.4;
                    if (dist < minSeparation + existingRadius) {
                        placed = false;
                        break;
                    }
                }
                if (placed) {
                    portionTotal += portion;
                    this.starClusterPortions.push(portion);
                    this.starClusterLocations.push({ x, y });
                }
                attempts++;
            }
        }
        if (portionTotal > 1.0) {
            for (let i = 0; i < this.starClusterPortions.length; i++) {
                this.starClusterPortions[i] /= portionTotal;
            }
        }
    }
}

// Port of Galaxy.4.cs Galaxy constructor (star-cluster setup, star loop,
// gas-cloud loop, sort/re-index, Systems build — Galaxy.4.cs 2221-2347).
// colonyPrevalence is accepted for API compatibility with the eventual
// full generator but unused here (no colonies are generated in 01b/01c
// scope yet). TODO(port): colony placement — later task.
export function generateGalaxy(options: GenerateGalaxyOptions): Galaxy {
    const { seed, shape, starCount, sectorWidth, sectorHeight, systemNames, colonyPrevalence, gameData, cloudImageCount } = options;
    const galaxy = new Galaxy(seed, shape, starCount, sectorWidth, sectorHeight, systemNames, colonyPrevalence);
    // ResourceSystem.Resources (Galaxy.4.cs ctor loads it before generation).
    galaxy.resources = gameData?.resources ?? [];
    // Port of Galaxy.cs Races (loaded from GameData in the ctor).
    galaxy.races = gameData?.races ?? [];

    // Nebulae / galaxy locations (Galaxy.4.cs ctor: GenerateNebulae + index
    // grid + AddGalaxyLocationIndex), generated before star placement so
    // SetupSun can avoid/enter them.
    galaxy.generateNebulae(cloudImageCount ?? DEFAULT_CLOUD_IMAGE_COUNT);

    // Cluster setup (Galaxy.4.cs 2221-2276), only for the Clusters shapes.
    galaxy.setupStarClusters(shape, starCount);

    // Race regions (Galaxy.4.cs ~2205-2220: SetupAlienRacePopulations is
    // called before the star loop). aggressiveRacesRequired = 3/2/1/0 for
    // AggressionLevel >= 1.5 / >= 1.3 / >= 1.1 / else. With no empireStarts
    // this consumes zero Rnd calls (pre-01f1 behavior).
    const aggressionLevel = options.aggressionLevel ?? 1.0;
    const aggressiveRacesRequired = aggressionLevel >= 1.5 ? 3 : aggressionLevel >= 1.3 ? 2 : aggressionLevel >= 1.1 ? 1 : 0;
    setupAlienRacePopulations(galaxy, options.empireStarts ?? [], aggressiveRacesRequired);

    // Per-star loop (Galaxy.4.cs 2278-2296). Each system's habitat list
    // (star + planets + moons + asteroids, from setupSolarSystem) forms one
    // group; asteroidField is the subset used for the main asteroid belt
    // (not separately tracked at this level — it's a sub-list of habitats).
    const perStarHabitats: Habitat[][] = [];
    for (let i = 0; i < starCount; i++) {
        const { habitats } = galaxy.setupSolarSystem(shape);
        perStarHabitats.push(habitats);
        galaxy.habitats.push(...habitats);
    }

    // Gas-cloud loop (Galaxy.4.cs 2297-2313).
    const gasCloudCount = galaxy.rnd.next(Math.trunc(starCount / 5), Math.trunc(starCount / 2));
    const gasCloudGroups: Habitat[][] = [];
    for (let i = 0; i < gasCloudCount; i++) {
        const cloud = galaxy.generateGasCloud();
        gasCloudGroups.push([cloud]);
        galaxy.habitats.push(cloud);
    }

    // Sort + re-index (Galaxy.4.cs 2314-2334): the source sorts the list of
    // per-system HabitatLists and rebuilds Habitats/HabitatIndex from that
    // order. There's no cross-system ordering comparator ported (relies on
    // HabitatList.Sort()/IComparable, out of scope), so system groups are
    // emitted in their original generation order, which is a superset of
    // determinism (same seed -> identical order) even if it doesn't match
    // the original in-memory ordering exactly.
    const allGroups = [...perStarHabitats, ...gasCloudGroups];
    galaxy.habitats = [];
    for (const group of allGroups) {
        for (const habitat of group) {
            habitat.habitatIndex = galaxy.habitats.length;
            galaxy.habitats.push(habitat);
        }
    }

    // Build Systems (Galaxy.4.cs 2335-2347): one SystemInfo per star. Only
    // stars are systems; gas clouds are standalone habitats (no
    // moons/planets/asteroids yet — see setupSolarSystem TODO).
    for (const group of perStarHabitats) {
        const star = group[0];
        const systemIndex = galaxy.systems.length;
        star.systemIndex = systemIndex;
        for (const habitat of group) {
            habitat.systemIndex = systemIndex;
        }
        galaxy.systems.push({
            systemStar: star,
            habitats: group,
            sector: {
                x: Math.trunc(star.xpos / galaxy.sectorSize),
                y: Math.trunc(star.ypos / galaxy.sectorSize),
            },
        });
    }

    return galaxy;
}
