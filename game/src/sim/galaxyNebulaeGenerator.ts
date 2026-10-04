import { Random } from './random';
import { GalaxyLocation, GalaxyLocationEffectType, GalaxyLocationType } from './galaxyLocation';
import { GalaxyShape } from './types';

// Port of GalaxyNebulaeGenerator.cs (generateImage=false path only).
// The generator uses its own Random instance seeded from the galaxy's
// RandomSeed (C# `this._Rnd = new Random(randomSeed)` inside
// GenerateGalaxyNebulae), independent of the galaxy's main Rnd stream.
// The bitmap/image drawing (generateImage=true) is not ported: FbmNoise,
// cloud tinting/rotation, and cloud-image sampling methods only run on
// that path and never touch _Rnd, so skipping them doesn't change the
// RNG stream. `cloudImageCount` stands in for `cloudImages.Length`
// (the renderer should pass the actual count of
// /assets/dwu/images/environment/nebulae/*.png; pictureRef only selects
// which cloud image to draw, and Next(0, N) consumes one sample
// regardless of N, so any positive count keeps the stream identical).

export class GalaxyNebulaeGenerator {
    private rnd: Random = new Random(0);
    private cloudImageCount: number;
    private systemNames: string[];
    private sizeX = 0;
    private sizeY = 0;

    constructor(cloudImageCount: number, systemNames: string[]) {
        this.cloudImageCount = cloudImageCount;
        this.systemNames = systemNames;
    }

    // Port of GalaxyNebulaeGenerator.GenerateGalaxyNebulae
    // (generateImage=false path; width/height/galaxyBackground are
    // image-path parameters in the source and are omitted; starCount is
    // dead on this path, kept for API fidelity).
    generateGalaxyNebulae(randomSeed: number, starCount: number, galaxyShape: GalaxyShape, sizeX: number, sizeY: number): GalaxyLocation[] {
        this.rnd = new Random(randomSeed);
        this.sizeX = sizeX;
        this.sizeY = sizeY;
        void starCount; // dead on the generateImage=false path

        // C# int division (sizeX/35 etc. are int ops in the source). Custom size (not a port): the C# galaxy is square;
        // on a non-square one the cloud sizes scale with sqrt(sizeX * sizeY) (Galaxy.sizeScale; = sizeX when square).
        const scale = sizeX === sizeY ? sizeX : Math.sqrt(sizeX * sizeY);
        const minSize1 = Math.trunc(scale / 35);
        const maxSize1 = Math.trunc(scale / 15);
        const minSize2 = Math.trunc(scale / 30);
        const maxSize2 = Math.trunc(scale / 15);
        const maxValue = Math.trunc(scale / 30);
        const maximumCloudSize = Math.trunc(scale / 10);

        const locations: GalaxyLocation[] = [];
        if (galaxyShape === GalaxyShape.Elliptical || galaxyShape === GalaxyShape.Spiral) {
            this.drawSpiralArms(sizeX, sizeY, maximumCloudSize, locations);
        }

        // Cluster clouds.
        const clusterCount = this.rnd.next(20, 40);
        for (let i = 0; i < clusterCount; i++) {
            const items: GalaxyLocation[] = [];
            let flag = true;
            const num4 = this.rnd.next(3, 10);
            let num5 = Math.trunc((num4 - 1) / 2);
            const num6 = this.rnd.next(0, sizeX);
            const num7 = this.rnd.next(0, sizeY);
            const cloudName = this.generateCloudName(GalaxyLocationEffectType.None);
            for (let index2 = 0; index2 < num4; index2++) {
                const x = num6 + this.rnd.next(-maxValue, maxValue);
                const y = num7 + this.rnd.next(-maxValue, maxValue);
                let name = cloudName;
                let effectType = GalaxyLocationEffectType.None;
                let showName = false;
                if (this.rnd.next(0, 15) === 1) {
                    effectType = this.selectEffect();
                    name = this.generateCloudName(effectType);
                    showName = true;
                    if (index2 === num5) {
                        num5++;
                    }
                }
                if (index2 === num5) {
                    showName = true;
                }
                const nebulaCloud = this.generateNebulaCloud(x, y, minSize2, maxSize2, name, showName);
                if (effectType !== GalaxyLocationEffectType.None) {
                    nebulaCloud.effect = effectType;
                }
                if (!this.checkWithinGalaxyBounds(nebulaCloud)) {
                    num5++;
                } else {
                    items.push(nebulaCloud);
                    if (this.checkOverlapExistingLocation(nebulaCloud, locations)) {
                        flag = false;
                        break;
                    }
                }
            }
            if (flag) {
                locations.push(...items);
            }
        }

        // Scattered clouds.
        const scatteredCount = this.rnd.next(40, 60);
        for (let i = 0; i < scatteredCount; i++) {
            const x = this.rnd.next(0, sizeX);
            const y = this.rnd.next(0, sizeY);
            let cloudName = this.generateCloudName(GalaxyLocationEffectType.None);
            let effectType = GalaxyLocationEffectType.None;
            if (this.rnd.next(0, 10) === 1) {
                effectType = this.selectEffect();
                cloudName = this.generateCloudName(effectType);
            }
            const nebulaCloud = this.generateNebulaCloud(x, y, minSize1, maxSize1, cloudName, true);
            if (effectType !== GalaxyLocationEffectType.None) {
                nebulaCloud.effect = effectType;
            }
            if (!this.checkOverlapExistingLocation(nebulaCloud, locations) && this.checkWithinGalaxyBounds(nebulaCloud)) {
                locations.push(nebulaCloud);
            }
        }

        return locations;
    }

    // Port of GalaxyNebulaeGenerator.DrawSpiralArms (generateImage=false
    // path; Graphics/galaxyScaleFactor parameters are image-path only).
    private drawSpiralArms(sizeX: number, sizeY: number, maximumCloudSize: number, locations: GalaxyLocation[]): void {
        // C# `new Size(width, height)` with width=sizeX, height=sizeY;
        // size.Width/2 and size.Width/27 are C# int divisions.
        const x = Math.trunc(sizeX / 2);
        const y = Math.trunc(sizeY / 2);
        const startRadius = Math.trunc(sizeX / 27);
        // Custom size (not a port): a non-square galaxy squashes the arms' y offsets by sizeY / sizeX (1 when square).
        const yScale = sizeX === sizeY ? 1 : sizeY / sizeX;
        this.drawSpiralArm(0.0, startRadius, x, y, 0, 1, maximumCloudSize, locations, yScale);
        this.drawSpiralArm(Math.PI, startRadius, x, y, 0, -1, maximumCloudSize, locations, yScale);
    }

    // Port of GalaxyNebulaeGenerator.DrawSpiralArm (generateImage=false
    // path).
    private drawSpiralArm(
        startAngle: number,
        startRadius: number,
        x: number,
        y: number,
        offsetChangeX: number,
        offsetChangeY: number,
        maximumCloudSize: number,
        locations: GalaxyLocation[],
        yScale = 1,
    ): void {
        const armName = this.generateArmName();
        const num1 = 3;
        let num2 = 3;
        let num3 = 0;
        const num4 = 1.6;
        let num5 = startRadius;
        const num6 = Math.PI / 2;
        let num7 = startAngle;
        let num8 = startAngle;
        const num9 = startAngle - (33.0 * Math.PI) / 10.0;
        while (num8 > num9) {
            const num10 = num5 / startRadius;
            const num11 = (3 * Math.PI) / 10 / num10;
            let num12 = (9 * Math.PI) / 20 / num10;
            if (this.rnd.next(0, 5) === 1) {
                num12 = (3 * Math.PI) / 4 / num10;
            }
            const num13 = num12 - num11;
            const num14 = num11 + this.rnd.nextDouble() * num13;
            num8 -= num14;
            if (num8 <= num7 - num6) {
                const num15 = num5 * num4;
                const num16 = num15 - num5;
                num5 = num15;
                num7 -= num6;
                x += offsetChangeX * num16;
                y += yScale === 1 ? offsetChangeY * num16 : offsetChangeY * num16 * yScale;
                switch (offsetChangeX) {
                    case -1:
                        offsetChangeX = 0;
                        offsetChangeY = 1;
                        break;
                    case 1:
                        offsetChangeX = 0;
                        offsetChangeY = -1;
                        break;
                    default:
                        switch (offsetChangeY) {
                            case -1:
                                offsetChangeX = -1;
                                offsetChangeY = 0;
                                break;
                            case 1:
                                offsetChangeX = 1;
                                offsetChangeY = 0;
                                break;
                        }
                        break;
                }
            }
            const x1 = Math.trunc(x + Math.cos(num8) * num5);
            const y1 = Math.trunc(yScale === 1 ? y + Math.sin(num8) * num5 : y + Math.sin(num8) * num5 * yScale);
            const num17 = Math.trunc(maximumCloudSize * (0.6 + this.rnd.nextDouble() * 0.4));
            let name = armName;
            let effectType = GalaxyLocationEffectType.None;
            let showName = false;
            if (this.rnd.next(0, 15) === 1) {
                effectType = this.selectEffect();
                name = this.generateCloudName(effectType);
                showName = true;
                if (num3 === num2) {
                    num2++;
                }
            }
            if (num3 === num2) {
                showName = true;
                num2 += num1;
            }
            const nebulaCloud = this.generateNebulaCloud(x1, y1, num17, num17, name, showName);
            if (effectType !== GalaxyLocationEffectType.None) {
                nebulaCloud.effect = effectType;
            }
            if (this.checkWithinGalaxyBounds(nebulaCloud)) {
                locations.push(nebulaCloud);
                num3++;
            }
        }
    }

    // Port of GalaxyNebulaeGenerator.GenerateNebulaCloud
    private generateNebulaCloud(x: number, y: number, minSize: number, maxSize: number, name: string, showName: boolean): GalaxyLocation {
        const num = this.rnd.next(minSize, maxSize);
        // C# int division (num/2).
        const x1 = x - Math.trunc(num / 2);
        const y1 = y - Math.trunc(num / 2);
        const pictureRef = this.selectRandomCloudIndex();
        const location = new GalaxyLocation(name, GalaxyLocationType.NebulaCloud, x1, y1, num, num, pictureRef);
        location.showName = showName;
        location.effect = GalaxyLocationEffectType.MovementSlowed;
        return location;
    }

    // Port of GalaxyNebulaeGenerator.SelectRandomCloudIndex
    private selectRandomCloudIndex(): number {
        return this.rnd.next(0, this.cloudImageCount);
    }

    // Port of GalaxyNebulaeGenerator.SelectEffect
    private selectEffect(): GalaxyLocationEffectType {
        switch (this.rnd.next(0, 2)) {
            case 0:
                return GalaxyLocationEffectType.LightningDamage;
            case 1:
                return GalaxyLocationEffectType.ShieldReduction;
        }
        return GalaxyLocationEffectType.None;
    }

    // Port of GalaxyNebulaeGenerator.GenerateArmName
    private generateArmName(): string {
        return this.systemNames[this.rnd.next(0, this.systemNames.length)] + ' Arm';
    }

    // Port of GalaxyNebulaeGenerator.GenerateCloudName
    private generateCloudName(effectType: GalaxyLocationEffectType, lastName = ''): string {
        let words: string[];
        switch (effectType) {
            case GalaxyLocationEffectType.HyperjumpDisabled:
                words = ['Mire', 'Halt', 'Labyrinth', 'Morass', 'Maze', 'Impasse', 'Deep'];
                break;
            case GalaxyLocationEffectType.LightningDamage:
                words = ['Storm', 'Tempest', 'Typhoon', 'Squall', 'Turmoil', 'Maelstrom'];
                break;
            case GalaxyLocationEffectType.ShieldReduction:
                words = ['Desolation', 'Void', 'Waste'];
                break;
            default:
                words = ['Cluster', 'Cloud', 'Expanse', 'Nebula', 'Murk', 'Gloom', 'Fog', 'Zone', 'Region', 'Drift', 'Corridor'];
                break;
        }
        const systemName = this.systemNames[this.rnd.next(0, this.systemNames.length)];
        const index = this.rnd.next(0, words.length);
        if (lastName === '') {
            lastName = words[index];
        }
        return systemName + ' ' + lastName;
    }

    // Port of GalaxyNebulaeGenerator.CheckOverlapExistingLocation
    // (System.Drawing Rectangle.IntersectsWith semantics on the
    // Math.trunc-cast coordinates, as in the C# (int) casts).
    private checkOverlapExistingLocation(newLocation: GalaxyLocation, existingLocations: GalaxyLocation[]): boolean {
        const aLeft = Math.trunc(newLocation.xpos);
        const aTop = Math.trunc(newLocation.ypos);
        const aRight = aLeft + Math.trunc(newLocation.width);
        const aBottom = aTop + Math.trunc(newLocation.height);
        for (const existing of existingLocations) {
            const bLeft = Math.trunc(existing.xpos);
            const bTop = Math.trunc(existing.ypos);
            const bRight = bLeft + Math.trunc(existing.width);
            const bBottom = bTop + Math.trunc(existing.height);
            if (!(aRight <= bLeft || bRight <= aLeft || aBottom <= bTop || bBottom <= aTop)) {
                return true;
            }
        }
        return false;
    }

    // Port of GalaxyNebulaeGenerator.CheckWithinGalaxyBounds
    // (C# compares against the static Galaxy.SizeX/SizeY, which equal
    // the sizeX/sizeY captured here).
    private checkWithinGalaxyBounds(location: GalaxyLocation): boolean {
        return location.xpos >= 0.0 && location.ypos >= 0.0 && location.xpos + location.width <= this.sizeX && location.ypos + location.height <= this.sizeY;
    }
}