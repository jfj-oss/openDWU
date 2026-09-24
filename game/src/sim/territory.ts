// Empire territory (task C2c-2). Ports of DistantWorlds.Types EmpireTerritory.cs
// (CheckLocationOwnership, CalculateTerritoryIndexesForGalaxyPosition,
// CalculateEmpireTerritoryGridIndex, BuildColonyIndex, ObtainColoniesNearLocation,
// DetermineOverlappingColonies, CalculateColonyInfluenceAtPoint) and
// Habitat.cs RecalculateColonyInfluenceRadius + StrategicValue (with the
// BaconHabitat.TerritoryMultipler mod hook it calls). No Rnd anywhere.

import type { Galaxy } from './galaxy';
import type { Habitat } from './types';
import { habitatDevelopmentLevel, recalculateDevelopmentLevelBaseline } from './developmentLevel';

export const TERRITORY_INDEX_SIZE = 2000;
// BaconHabitat.myTerritoryMultiplier (BaconDistantWorlds/BaconHabitat.cs:21).
const BACON_ROMULAN_TERRITORY_MULTIPLIER = 2;

// Port of Habitat.cs StrategicValue (309). Line 313 reads the DevelopmentLevel property (447).
export function strategicValue(h: Habitat): number {
    // C# int * (int)(long / 1000000): unchecked int arithmetic.
    const val = Math.imul(habitatDevelopmentLevel(h), Math.trunc(h.population.totalAmount / 1000000) | 0);
    return Math.max(10000, val);
}

// Port of BaconHabitat.TerritoryMultipler.
function territoryMultiplier(h: Habitat): number {
    let num = 1;
    if (h.empire !== null && h.empire.name.includes('Romulan')) num = BACON_ROMULAN_TERRITORY_MULTIPLIER;
    if (h.population.totalAmount < 1000000) num = 0;
    return num;
}

// Port of Habitat.cs RecalculateColonyInfluenceRadius(empireHasWarptech) (1066).
export function recalculateColonyInfluenceRadius(galaxy: Galaxy, h: Habitat, empireHasWarptech: boolean): void {
    let r = 0;
    if (h.empire !== null && h.empire !== galaxy.independentEmpire && h.population != null) {
        // Habitat.cs 1070.
        recalculateDevelopmentLevelBaseline(h);
        if (h.population.totalAmount > 0) {
            // Habitat.cs 1073 reads the DevelopmentLevel property (447).
            const num = Math.max(10, habitatDevelopmentLevel(h)) * Math.trunc(h.population.totalAmount / 1000000);
            if (h.empire.dominantRace !== null && !h.empire.dominantRace.expanding) {
                r = Math.fround(200000 + Math.max(0, Math.min(150000, Math.fround(Math.sqrt(strategicValue(h)) * 700.0))));
            } else {
                const num2 = Math.trunc(num);
                const num3 = 700000;
                if (num2 > num3) {
                    const num4 = Math.fround(500000 + Math.max(0, Math.min(1000000, Math.fround(Math.sqrt(num2) * 700.0))));
                    const num5 = Math.fround(Math.sqrt(num2 - num3) * 100.0);
                    r = Math.fround(num4 + num5);
                } else {
                    r = Math.fround(500000 + Math.max(0, Math.min(1000000, Math.fround(Math.sqrt(num2) * 700.0))));
                }
            }
        }
    }
    if (galaxy.empireTerritoryColonyInfluenceRangeFactor <= 0) {
        let val = Math.sqrt(((galaxy.sectorWidth * galaxy.sectorHeight) / galaxy.starCount) * 7.0);
        val = Math.max(0.5, Math.min(2.0, val));
        galaxy.empireTerritoryColonyInfluenceRangeFactor = Math.fround(val);
    }
    r = Math.fround(Math.fround(r * galaxy.empireTerritoryColonyInfluenceRangeFactor) * territoryMultiplier(h));
    if (!empireHasWarptech) r = Math.min(100000, r);
    h.colonyInfluenceRadius = r;
}

// Port of EmpireTerritory.CalculateColonyInfluenceAtPoint(galaxy, radius, cx, cy, x, y) (float math).
export function colonyInfluenceAtPoint(influenceRadius: number, colonyX: number, colonyY: number, x: number, y: number): number {
    const num1 = Math.fround(Math.fround(colonyX) - Math.fround(x));
    const num2 = Math.fround(Math.fround(colonyY) - Math.fround(y));
    const num3 = Math.max(1, Math.fround(num2 * num2 + num1 * num1));
    const num4 = Math.fround(influenceRadius * influenceRadius);
    return num4 >= num3 ? Math.fround(num4 / num3) : 0;
}

interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}
// .NET Rectangle.IntersectsWith.
function intersects(a: Rect, b: Rect): boolean {
    return b.x < a.x + a.w && a.x < b.x + b.w && b.y < a.y + a.h && a.y < b.y + b.h;
}

export class EmpireTerritory {
    private territory: Uint8Array[] | null = null;

    // Port of CheckLocationOwnership: owning EmpireId, or -1.
    checkLocationOwnership(galaxy: Galaxy, x: number, y: number): number {
        if (this.territory !== null) {
            const ix = Math.trunc(x / (galaxy.sizeX / TERRITORY_INDEX_SIZE));
            const iy = Math.trunc(y / (galaxy.sizeY / TERRITORY_INDEX_SIZE));
            if (ix >= 0 && ix < TERRITORY_INDEX_SIZE && iy >= 0 && iy < TERRITORY_INDEX_SIZE) return this.territory[ix][iy] - 1;
        }
        return -1;
    }

    // Port of ReviewEmpireTerritory(galaxy) — whole galaxy, fresh grid.
    reviewEmpireTerritory(galaxy: Galaxy): void {
        this.territory = calculateEmpireTerritoryGridIndex(galaxy, { x: 0, y: 0, w: galaxy.sizeX, h: galaxy.sizeY }, null);
    }

    // Port of ReviewEmpireTerritory(galaxy, onlySystems) (EmpireTerritory.cs 38) — whole galaxy, fresh grid; with
    // onlySystems only the cell of each system star is claimed (task M4t, Galaxy.cs 3376 ReviewEmpireTerritory(true)).
    reviewEmpireTerritoryOnlySystems(galaxy: Galaxy, onlySystems: boolean): void {
        this.territory = calculateEmpireTerritoryGridIndex(galaxy, { x: 0, y: 0, w: galaxy.sizeX, h: galaxy.sizeY }, null, onlySystems);
    }

    // Port of ReviewEmpireTerritoryUpdate(galaxy, galaxySection) — incremental.
    reviewEmpireTerritoryUpdate(galaxy: Galaxy, section: Rect): void {
        this.territory = calculateEmpireTerritoryGridIndex(galaxy, section, this.territory);
    }
}

// Port of EmpireTerritory.CalculateEmpireTerritoryGridIndex(galaxy, section,
// 2000, 2000, influence, onlySystems) (EmpireTerritory.cs 105).
function calculateEmpireTerritoryGridIndex(galaxy: Galaxy, section: Rect, influence: Uint8Array[] | null, onlySystems = false): Uint8Array[] {
    const size = TERRITORY_INDEX_SIZE;
    if (influence === null) influence = Array.from({ length: size }, () => new Uint8Array(size));
    const num1 = galaxy.sizeX / size;
    for (const empire of galaxy.empires) {
        if (empire.active) {
            for (const c of empire.colonies) recalculateColonyInfluenceRadius(galaxy, c, empire.hasHyperDriveTech);
        }
    }
    // BuildColonyIndex (sector grid).
    const colonyIndex: Habitat[][][] = Array.from({ length: galaxy.sectorWidth }, () => Array.from({ length: galaxy.sectorHeight }, () => []));
    const sectorOf = (x: number, y: number) => ({
        x: Math.max(0, Math.min(galaxy.sectorWidth - 1, Math.trunc(Math.trunc(x) / galaxy.sectorSize))),
        y: Math.max(0, Math.min(galaxy.sectorHeight - 1, Math.trunc(Math.trunc(y) / galaxy.sectorSize))),
    });
    for (const empire of galaxy.empires) {
        if (!empire.active) continue;
        for (const c of empire.colonies) {
            const s = sectorOf(c.xpos, c.ypos);
            colonyIndex[s.x][s.y].push(c);
        }
    }
    const list: { colony: Habitat; overlapping: Habitat[] }[] = [];
    for (const empire of galaxy.empires) {
        if (!empire.active) continue;
        for (const colony of empire.colonies) {
            if (colony.owner !== empire) continue;
            const r = Math.trunc(colony.colonyInfluenceRadius);
            if (!intersects(section, { x: Math.trunc(colony.xpos) - r, y: Math.trunc(colony.ypos) - r, w: r * 2, h: r * 2 })) continue;
            if (onlySystems) {
                // EmpireTerritory.cs 152: no overlapping-colony list in the systems-only pass.
                list.push({ colony, overlapping: [] });
                continue;
            }
            // DetermineOverlappingColonies(rectangular, all empires).
            const s = sectorOf(colony.xpos, colony.ypos);
            const near: Habitat[] = [];
            for (let i = Math.max(0, s.x - 2); i <= Math.min(galaxy.sectorWidth - 1, s.x + 2); i++) {
                for (let j = Math.max(0, s.y - 2); j <= Math.min(galaxy.sectorHeight - 1, s.y + 2); j++) near.push(...colonyIndex[i][j]);
            }
            const r1 = colony.colonyInfluenceRadius;
            const rect: Rect = { x: Math.trunc(colony.xpos - r1), y: Math.trunc(colony.ypos - r1), w: Math.trunc(r1 * 2.0), h: Math.trunc(r1 * 2.0) };
            const overlapping: Habitat[] = [];
            for (const n of near) {
                if (n === colony) continue;
                const r2 = n.colonyInfluenceRadius;
                if (intersects(rect, { x: Math.trunc(n.xpos - r2), y: Math.trunc(n.ypos - r2), w: Math.trunc(r2 * 2.0), h: Math.trunc(r2 * 2.0) })) overlapping.push(n);
            }
            list.push({ colony, overlapping });
        }
    }
    if (onlySystems) {
        // EmpireTerritory.cs 162-201: claim each system star's cell for the colony with the highest influence there.
        let num4 = 0;
        for (let index3 = 0; index3 < galaxy.systems.length; index3++) {
            const system = galaxy.systems[index3];
            if (system == null || system.systemStar == null) continue;
            // Rectangle.Contains(Point((int)Xpos, (int)Ypos)).
            const px = Math.trunc(system.systemStar.xpos);
            const py = Math.trunc(system.systemStar.ypos);
            if (!(px >= section.x && px < section.x + section.w && py >= section.y && py < section.y + section.h)) continue;
            const indexX = Math.trunc(system.systemStar.xpos / (galaxy.sizeX / size));
            const indexY = Math.trunc(system.systemStar.ypos / (galaxy.sizeY / size));
            if (influence[indexX][indexY] !== 0) continue;
            let num5 = 0;
            for (const { colony } of list) {
                if (colony.empire === null) continue;
                const influenceAtPoint = colonyInfluenceAtPoint(colony.colonyInfluenceRadius, colony.xpos, colony.ypos, system.systemStar.xpos, system.systemStar.ypos);
                if (influenceAtPoint > num5) {
                    num4 = colony.empire.empireId + 1;
                    num5 = influenceAtPoint;
                }
            }
            if (num5 > 0) influence[indexX][indexY] = num4;
        }
        return influence;
    }
    const num6 = Math.fround(num1);
    for (const { colony, overlapping } of list) {
        const num9 = colony.empire !== null ? colony.empire.empireId + 1 : 0;
        const indexX = Math.trunc(colony.xpos / (galaxy.sizeX / size));
        const indexY = Math.trunc(colony.ypos / (galaxy.sizeY / size));
        const num10 = Math.trunc(colony.colonyInfluenceRadius / num1);
        const radius = colony.colonyInfluenceRadius;
        const num11 = num10 * 2 + 2;
        const num13 = Math.max(indexX - num10, 0);
        const num14 = Math.max(indexY - num10, 0);
        const num17 = num13 + (Math.min(size, num13 + num11) - num13);
        const num18 = num14 + (Math.min(size, num14 + num11) - num14);
        for (let i6 = num13; i6 < num17; i6++) {
            const x2 = Math.fround(i6 * num6);
            for (let i7 = num14; i7 < num18; i7++) {
                if (influence[i6][i7] !== 0) continue;
                const y2 = Math.fround(i7 * num6);
                let num19 = colonyInfluenceAtPoint(radius, colony.xpos, colony.ypos, x2, y2);
                if (num19 > 0) {
                    let num20 = num9;
                    for (const o of overlapping) {
                        if (o.empire === null) continue;
                        const inf = colonyInfluenceAtPoint(o.colonyInfluenceRadius, o.xpos, o.ypos, x2, y2);
                        if (inf > num19) {
                            num19 = inf;
                            num20 = o.empire.empireId + 1;
                        }
                    }
                    if (num19 > 0) influence[i6][i7] = num20;
                }
            }
        }
    }
    return influence;
}
