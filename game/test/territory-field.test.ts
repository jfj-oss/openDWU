// Empire territory overlay geometry (src/render/territoryField.ts): the marching-squares mesh must reproduce the
// original's per-pixel ownership rule (EmpireTerritory.cs CalculateEmpireTerritoryGrid + CalculateColonyInfluenceAtPoint:
// the colony with the highest r²/d² among those whose circle holds the point wins), with smooth, gap-free contested
// borders, and only for colonies in systems the viewer has explored.

import { describe, expect, it } from 'vitest';
import {
    TerritoryGrid,
    buildTerritoryMeshes,
    buildTerritoryMeshesSync,
    collectTerritorySources,
    territoryOwnerAt,
    territorySignature,
    type TerritoryMeshData,
    type TerritorySource,
} from '../src/render/territoryField';
import { colonyInfluenceAtPoint } from '../src/sim/territory';
import { SystemVisibilityStatus } from '../src/sim/visibility';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import { Random } from '../src/sim/random';

/** Empires (mesh owners) whose triangles contain (x, y). */
function meshOwnersAt(meshes: TerritoryMeshData[], x: number, y: number): number[] {
    const owners: number[] = [];
    for (const m of meshes) {
        const p = m.positions;
        const idx = m.indices;
        for (let t = 0; t < idx.length; t += 3) {
            const ax = p[idx[t] * 2], ay = p[idx[t] * 2 + 1];
            const bx = p[idx[t + 1] * 2], by = p[idx[t + 1] * 2 + 1];
            const cx = p[idx[t + 2] * 2], cy = p[idx[t + 2] * 2 + 1];
            const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by);
            const d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy);
            const d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay);
            const neg = d1 < 0 || d2 < 0 || d3 < 0;
            const pos = d1 > 0 || d2 > 0 || d3 > 0;
            if (!(neg && pos)) {
                owners.push(m.owner);
                break;
            }
        }
    }
    return owners;
}

function meshArea(m: TerritoryMeshData): number {
    let a = 0;
    const p = m.positions;
    for (let t = 0; t < m.indices.length; t += 3) {
        const i = m.indices[t] * 2, j = m.indices[t + 1] * 2, k = m.indices[t + 2] * 2;
        a += Math.abs((p[j] - p[i]) * (p[k + 1] - p[i + 1]) - (p[k] - p[i]) * (p[j + 1] - p[i + 1])) / 2;
    }
    return a;
}

/** Distance from (x, y) to the nearest ownership change of the reference rule (coarse radial probe). */
function nearBorder(sources: TerritorySource[], x: number, y: number, eps: number): boolean {
    const o = territoryOwnerAt(sources, x, y);
    for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        if (territoryOwnerAt(sources, x + Math.cos(ang) * eps, y + Math.sin(ang) * eps) !== o) return true;
    }
    return false;
}

const SIZE = 8_000_000;

describe('territoryOwnerAt (reference rule)', () => {
    it('matches the sim port of CalculateColonyInfluenceAtPoint: highest r²/d² wins, nothing outside every circle', () => {
        const s: TerritorySource[] = [
            { x: 1_000_000, y: 1_000_000, r: 800_000, owner: 0 },
            { x: 2_000_000, y: 1_000_000, r: 400_000, owner: 1 },
        ];
        // The Apollonius border: r1/d1 = r2/d2 -> on the centre line at d1 = 2/3 of the 1M gap.
        expect(territoryOwnerAt(s, 1_660_000, 1_000_000)).toBe(0);
        expect(territoryOwnerAt(s, 1_680_000, 1_000_000)).toBe(1);
        expect(territoryOwnerAt(s, 1_000_000, 1_900_000)).toBe(-1);
        const a = colonyInfluenceAtPoint(800_000, 1_000_000, 1_000_000, 1_666_667, 1_000_000);
        const b = colonyInfluenceAtPoint(400_000, 2_000_000, 1_000_000, 1_666_667, 1_000_000);
        expect(Math.abs(a - b) / a).toBeLessThan(0.001);
    });
});

describe('buildTerritoryMeshes', () => {
    const grid = new TerritoryGrid(SIZE, SIZE, 256);

    it('a lone colony is a disc of the influence radius (area within 0.5%)', () => {
        const r = 900_000;
        const meshes = buildTerritoryMeshesSync([{ x: 3_000_000, y: 4_000_000, r, owner: 2 }], grid);
        expect(meshes.length).toBe(1);
        expect(meshes[0].owner).toBe(2);
        expect(Math.abs(meshArea(meshes[0]) / (Math.PI * r * r) - 1)).toBeLessThan(0.005);
    });

    it('overlapping rival colonies: every point away from a border has the reference owner, and no point has two', () => {
        const rnd = new Random(7);
        const sources: TerritorySource[] = [];
        for (let i = 0; i < 24; i++) {
            sources.push({ x: 1_000_000 + rnd.nextDouble() * 6_000_000, y: 1_000_000 + rnd.nextDouble() * 6_000_000, r: 300_000 + rnd.nextDouble() * 900_000, owner: i % 4 });
        }
        const meshes = buildTerritoryMeshesSync(sources, grid);
        expect(new Set(meshes.map((m) => m.owner)).size).toBe(4);
        let checked = 0;
        let mismatched = 0;
        const tol = grid.cell * 0.25;
        for (let k = 0; k < 3000; k++) {
            const x = rnd.nextDouble() * SIZE;
            const y = rnd.nextDouble() * SIZE;
            const got = meshOwnersAt(meshes, x, y);
            expect(got.length).toBeLessThanOrEqual(1);
            if (nearBorder(sources, x, y, tol)) continue;
            checked++;
            const want = territoryOwnerAt(sources, x, y);
            if ((got[0] ?? -1) !== want) mismatched++;
        }
        expect(checked).toBeGreaterThan(2000);
        // Sub-cell slivers at three-way junctions may be dropped; anything else must match exactly.
        expect(mismatched / checked).toBeLessThan(0.002);
    });

    it('a contested border has no gap: points straddling it are always owned by one side', () => {
        const sources: TerritorySource[] = [
            { x: 3_000_000, y: 4_000_000, r: 1_000_000, owner: 0 },
            { x: 4_200_000, y: 4_100_000, r: 700_000, owner: 1 },
        ];
        const meshes = buildTerritoryMeshesSync(sources, grid);
        // Walk the line between the colonies finely; inside both circles every sample must be owned by someone.
        for (let t = 0.3; t <= 0.7; t += 0.0005) {
            const x = 3_000_000 + 1_200_000 * t;
            const y = 4_000_000 + 100_000 * t;
            expect(meshOwnersAt(meshes, x, y).length).toBe(1);
        }
    });

    it('same-empire colonies merge into one mesh; the stronger colony wins inside a weaker rival circle', () => {
        const sources: TerritorySource[] = [
            { x: 2_000_000, y: 2_000_000, r: 800_000, owner: 0 },
            { x: 2_900_000, y: 2_000_000, r: 800_000, owner: 0 },
            { x: 2_450_000, y: 2_500_000, r: 200_000, owner: 1 },
        ];
        const meshes = buildTerritoryMeshesSync(sources, grid);
        expect(meshes.map((m) => m.owner)).toEqual([0, 1]);
        // Owner 1's own centre is its (r²/d² is huge there).
        expect(meshOwnersAt(meshes, 2_450_000, 2_500_000)).toEqual([1]);
        // Midway between empire 0's colonies and 1's colony, 0's two discs out-influence 1.
        expect(meshOwnersAt(meshes, 2_450_000, 2_150_000)).toEqual([0]);
    });

    it('is time-sliced: yields before finishing a large build and gives the same result as the sync run', () => {
        const big = new TerritoryGrid(SIZE, SIZE, 1024);
        const rnd = new Random(3);
        const sources: TerritorySource[] = [];
        for (let i = 0; i < 60; i++) sources.push({ x: rnd.nextDouble() * SIZE, y: rnd.nextDouble() * SIZE, r: 500_000 + rnd.nextDouble() * 500_000, owner: i % 6 });
        const gen = buildTerritoryMeshes(sources, big);
        let yields = 0;
        let r = gen.next();
        while (r.done !== true) {
            yields++;
            r = gen.next();
        }
        expect(yields).toBeGreaterThan(4);
        const sync = buildTerritoryMeshesSync(sources, big);
        expect(r.value.map((m) => m.indices.length)).toEqual(sync.map((m) => m.indices.length));
    });

    it('never draws past the galaxy edge (EmpireTerritory.cs 389-393 clamp to the galaxy), even when the size is not a whole number of cells', () => {
        const sx = 8_000_000;
        const sy = 5_910_000;
        const g = new TerritoryGrid(sx, sy, 256);
        expect(g.ny * g.cell).toBeGreaterThan(sy); // last row reaches past the edge
        const r = 1_000_000;
        const sources: TerritorySource[] = [
            { x: 0, y: 0, r, owner: 0 }, // corner at the origin: a quarter disc
            { x: sx, y: sy, r, owner: 1 }, // far corner: a quarter disc
            { x: sx - 200_000, y: 3_000_000, r, owner: 2 }, // right edge
            { x: 4_000_000, y: sy - 300_000, r, owner: 3 }, // bottom edge
        ];
        const meshes = buildTerritoryMeshesSync(sources, g);
        expect(meshes.length).toBe(4);
        for (const m of meshes) {
            for (let i = 0; i < m.positions.length; i += 2) {
                expect(m.positions[i]).toBeGreaterThanOrEqual(0);
                expect(m.positions[i]).toBeLessThanOrEqual(sx);
                expect(m.positions[i + 1]).toBeGreaterThanOrEqual(0);
                expect(m.positions[i + 1]).toBeLessThanOrEqual(sy);
            }
        }
        const quarter = (Math.PI * r * r) / 4;
        expect(Math.abs(meshArea(meshes[0]) / quarter - 1)).toBeLessThan(0.01);
        expect(Math.abs(meshArea(meshes[1]) / quarter - 1)).toBeLessThan(0.01);
    });

    it('no sources, no meshes', () => {
        expect(buildTerritoryMeshesSync([], grid)).toEqual([]);
    });
});

describe('territorySignature', () => {
    const base: TerritorySource[] = [{ x: 1_000_000, y: 1_000_000, r: 500_000, owner: 1 }];
    it('ignores sub-cell orbital creep but changes with owner, radius growth and new sources', () => {
        const cell = 30_000;
        const sig = territorySignature(base, cell);
        expect(territorySignature([{ ...base[0], x: base[0].x + 2_000 }], cell)).toBe(sig);
        expect(territorySignature([{ ...base[0], owner: 2 }], cell)).not.toBe(sig);
        expect(territorySignature([{ ...base[0], r: base[0].r + 40_000 }], cell)).not.toBe(sig);
        expect(territorySignature([...base, { x: 5, y: 5, r: 100_000, owner: 1 }], cell)).not.toBe(sig);
    });
});

describe('collectTerritorySources (EmpireTerritory.cs CalculateEmpireTerritoryGrid 394-437)', () => {
    function stubGalaxy(): { galaxy: Galaxy; viewer: Empire } {
        const mk = (id: number, active = true) => ({ empireId: id, active, colonies: [] as unknown[] }) as unknown as Empire;
        const a = mk(0);
        const b = mk(1);
        const dead = mk(2, false);
        const col = (owner: Empire, sys: number, r: number, extra: Record<string, unknown> = {}) => {
            const c = { owner, empire: owner, systemIndex: sys, xpos: sys * 1e6, ypos: 0, colonyInfluenceRadius: r, hasBeenDestroyed: false, ...extra };
            (owner.colonies as unknown[]).push(c);
            return c;
        };
        col(a, 1, 500_000);
        col(a, 2, 500_000);
        col(b, 3, 700_000);
        col(b, 4, 0); // no influence (empty colony)
        col(b, 5, 600_000, { hasBeenDestroyed: true });
        col(b, 6, 600_000, { owner: a }); // stale list entry: owned by someone else now
        col(dead, 1, 900_000);
        const explored = new Set([1, 3]);
        const viewer = {
            visibility: { checkSystemVisibilityStatus: (i: number) => (explored.has(i) ? SystemVisibilityStatus.Explored : SystemVisibilityStatus.Unexplored) },
        } as unknown as Empire;
        return { galaxy: { empires: [a, b, dead] } as unknown as Galaxy, viewer };
    }

    it('god mode: active empires, owned, live colonies with a radius', () => {
        const { galaxy } = stubGalaxy();
        expect(collectTerritorySources(galaxy, null).map((s) => [s.owner, s.x])).toEqual([[0, 1e6], [0, 2e6], [1, 3e6]]);
    });
    it('a viewer only sees (and is only contested by) colonies in systems it has explored', () => {
        const { galaxy, viewer } = stubGalaxy();
        expect(collectTerritorySources(galaxy, viewer).map((s) => [s.owner, s.x])).toEqual([[0, 1e6], [1, 3e6]]);
    });
});
