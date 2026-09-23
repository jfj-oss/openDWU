// Galaxy skeleton: star generation (all GalaxyShape variants), system
// naming, and gas clouds. Ports of DistantWorlds.Types.Galaxy (Galaxy.cs /
// Galaxy.3.cs / Galaxy.4.cs / Galaxy.5.cs / Galaxy.6.cs). Planets, moons,
// asteroids, and nebula/galaxy-location generation are out of scope for
// this task — see the `TODO(01c)` markers below.

import { Random } from './random';
import {
    GalaxyShape,
    Habitat,
    HabitatCategoryType,
    HabitatType,
    type SystemInfo,
} from './types';

// Port of Galaxy.cs static fields (Galaxy.3.cs InitializeStatics sets
// these): SectorSizeX = SectorSizeY = 2_000_000, IndexSize = 400_000.
const SECTOR_SIZE = 2_000_000;
const INDEX_SIZE = 400_000;
// Port of Galaxy.3.cs InitializeStatics: MaxSolarSystemSize = 23000.
const MAX_SOLAR_SYSTEM_SIZE = 23000;

export interface GenerateGalaxyOptions {
    seed: number;
    shape: GalaxyShape;
    starCount: number;
    sectorWidth: number;
    sectorHeight: number;
    colonyPrevalence?: number;
    systemNames: string[];
}

export class Galaxy {
    rnd: Random;
    sizeX = 0;
    sizeY = 0;
    sectorSize = SECTOR_SIZE;
    sectorWidth: number;
    sectorHeight: number;
    starCount: number;
    galaxyShape: GalaxyShape;
    habitats: Habitat[] = [];
    systems: SystemInfo[] = [];

    // Port of Galaxy.cs _StarClusterLocations / _StarClusterPortions
    // (used by the ClustersEven/ClustersVaried shapes).
    private starClusterLocations: { x: number; y: number }[] = [];
    private starClusterPortions: number[] = [];

    // Port of Galaxy.4.cs SystemNames / SystemNamesUsedPlain / SystemNamesUsedAlternative.
    private systemNames: string[];
    private systemNamesUsedPlain: boolean[];
    private systemNamesUsedAlternative: boolean[];

    constructor(seed: number, shape: GalaxyShape, starCount: number, sectorWidth: number, sectorHeight: number, systemNames: string[]) {
        this.rnd = new Random(seed);
        this.galaxyShape = shape;
        this.starCount = starCount;
        this.sectorWidth = sectorWidth;
        this.sectorHeight = sectorHeight;
        this.systemNames = systemNames;
        this.systemNamesUsedPlain = new Array(systemNames.length).fill(false);
        this.systemNamesUsedAlternative = new Array(systemNames.length).fill(false);
        this.setGalaxyPhysicalDimensions(sectorWidth, sectorHeight);
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
    private obtainRandomGalaxyCoordinatesInRadius(radiusFromCenterMinimum: number, radiusFromCenterMaximum: number): { x: number; y: number } {
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
    private calculateDistance(x1: number, y1: number, x2: number, y2: number): number {
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

    // Port of Galaxy.5.cs SetupSun(galaxyShape).
    // Nebula clouds / GalaxyLocation generation aren't ported (no nebula
    // data structure exists yet), so the retry loop's nebula-avoidance
    // check (`flag`/`flag3`) is always satisfied and the black-hole/
    // supernova location objects at the end of the source method are
    // skipped — TODO(port): GalaxyLocation / nebula generation.
    private setupSun(galaxyShape: GalaxyShape): Habitat {
        let x = 0;
        let y = 0;
        const clusterBaseRadius = 300000.0 + 175000000.0 / Math.sqrt(this.starCount);
        const clusterCap =
            this.starCount >= 1400 ? 5000000.0 : this.starCount >= 1000 ? 4250000.0 : this.starCount >= 700 ? 3600000.0 : this.starCount < 400 ? 2000000.0 : 2700000.0;
        const clusterVal = Math.min(clusterBaseRadius, clusterCap);
        let attempts = 0;
        let boundsOk = false;
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
            const margin = MAX_SOLAR_SYSTEM_SIZE + 500.0;
            boundsOk = !(x < margin || x > this.sizeX - margin || y < margin || y > this.sizeY - margin);
            // Nearest gas-cloud/asteroid + nebula-avoidance checks from the
            // source are skipped here: at star-generation time no gas
            // clouds/asteroids exist yet, and nebulae aren't modeled.
            attempts++;
        } while (!boundsOk && attempts < 100);

        const { type, diameter, pictureRef } = this.selectStar();
        const star = new Habitat(HabitatCategoryType.Star, type, this.generateCodeName(), x, y);
        star.diameter = diameter;
        star.pictureRef = pictureRef;
        star.landscapePictureRef = -1;
        // TODO(port): black hole "Pull"/"Event Horizon" and supernova
        // GalaxyLocation objects — Galaxy.5.cs SetupSun:1329-1371 (needs
        // GalaxyLocation, not ported yet).
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
    // retry loop (against other gas clouds/asteroids), and orbitDirection
    // roll faithful to source. TODO(port): nebula-anchored placement,
    // SelectResources, radiation fields — need GalaxyLocation/resources.
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

    // Stub for Galaxy.5.cs SetupSolarSystem(galaxyShape): sets up the sun
    // and its naming/bonuses only. Planets are out of scope for this task.
    // TODO(01c): planets — Galaxy.5.cs:1386+ (SetupSolarSystem planet loop).
    setupSolarSystem(galaxyShape: GalaxyShape): Habitat {
        const star = this.setupSun(galaxyShape);
        // TODO(01c): planets — Galaxy.5.cs:1386+
        const planetCount = 0;
        this.assignSystemName(star, planetCount);
        this.setScenicFactor(star);
        this.setResearchBonus(star);
        return star;
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
    const { seed, shape, starCount, sectorWidth, sectorHeight, systemNames } = options;
    const galaxy = new Galaxy(seed, shape, starCount, sectorWidth, sectorHeight, systemNames);

    // Cluster setup (Galaxy.4.cs 2221-2276), only for the Clusters shapes.
    galaxy.setupStarClusters(shape, starCount);

    // Per-star loop (Galaxy.4.cs 2278-2296).
    const perStarHabitats: Habitat[][] = [];
    for (let i = 0; i < starCount; i++) {
        const star = galaxy.setupSolarSystem(shape);
        perStarHabitats.push([star]);
        galaxy.habitats.push(star);
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
