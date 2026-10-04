import { beforeAll, describe, expect, it } from 'vitest';
import type { GameData } from '../src/sim/data/gameData';
import { colonyInfluenceAtPoint, fillTerritoryCells, territoryColonyList, TERRITORY_INDEX_SIZE } from '../src/sim/territory';
import type { Habitat } from '../src/sim/types';
import { cachedTickGame } from './helpers/gameCache';
import { loadGameDataFs } from './helpers/loadGameDataFs';

// Perf (soak 2026-10-04): fillTerritoryCells is the cell pass of EmpireTerritory.CalculateEmpireTerritoryGridIndex with
// colonyInfluenceAtPoint inlined and the colonies that are certainly zero on a row / column range skipped. It must give
// exactly the grid of the per-cell loop it replaced, kept here as the reference.

type Entry = { colony: Habitat; overlapping: Habitat[] };

/** The per-cell loop of EmpireTerritory.cs CalculateEmpireTerritoryGridIndex as first ported (territory.ts before the perf pass). */
function referenceFill(influence: Uint8Array[], list: readonly Entry[], cellSizeX: number, cellSizeY: number, num1: number, size: number): void {
    const num6 = Math.fround(num1);
    for (const { colony, overlapping } of list) {
        const num9 = colony.empire !== null ? colony.empire.empireId + 1 : 0;
        const indexX = Math.trunc(colony.xpos / cellSizeX);
        const indexY = Math.trunc(colony.ypos / cellSizeY);
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
}

const grid = (size: number): Uint8Array[] => Array.from({ length: size }, () => new Uint8Array(size));

function firstDifference(a: Uint8Array[], b: Uint8Array[]): string | null {
    for (let x = 0; x < a.length; x++) for (let y = 0; y < a[x].length; y++) if (a[x][y] !== b[x][y]) return `cell ${x},${y}: ${a[x][y]} vs ${b[x][y]}`;
    return null;
}

/** Deterministic test PRNG (mulberry32). */
function prng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

describe('fillTerritoryCells equals the per-cell reference loop', () => {
    it('random colony sets (positions on / off the grid, radii from 0 to beyond the galaxy, no-empire colonies, arbitrary overlap lists)', () => {
        for (let scenario = 0; scenario < 40; scenario++) {
            const rnd = prng(1000 + scenario);
            const size = scenario < 4 ? 400 : 60 + Math.floor(rnd() * 140);
            const sizeX = [20_000_000, 1_400_000, 7_777_777.5, 300_000][scenario % 4];
            const sizeY = scenario % 3 === 0 ? sizeX : sizeX * (0.5 + rnd());
            const num1 = sizeX / size;
            const n = 1 + Math.floor(rnd() * 60);
            const colonies: Habitat[] = [];
            for (let i = 0; i < n; i++) {
                const kind = rnd();
                const radius =
                    kind < 0.08 ? 0 : kind < 0.16 ? rnd() * num1 * 1.5 : kind < 0.22 ? sizeX * (1 + rnd()) : kind < 0.3 ? Math.fround(num1 * Math.floor(rnd() * 20)) : rnd() * sizeX * 0.25;
                const empireId = Math.floor(rnd() * 12);
                colonies.push({
                    xpos: rnd() < 0.05 ? -rnd() * num1 * 3 : rnd() < 0.05 ? sizeX + rnd() * num1 * 3 : rnd() < 0.1 ? Math.round(rnd() * size) * num1 : rnd() * sizeX,
                    ypos: rnd() < 0.05 ? sizeY + rnd() * num1 : rnd() * sizeY,
                    colonyInfluenceRadius: radius,
                    empire: rnd() < 0.06 ? null : { empireId },
                } as unknown as Habitat);
            }
            if (n > 2 && rnd() < 0.3) colonies[1] = { ...colonies[0], empire: { empireId: 3 } } as unknown as Habitat; // same spot, another owner (ties)
            const list: Entry[] = colonies.map((colony) => ({
                colony,
                overlapping: colonies.filter((o) => o !== colony && rnd() < 0.6).sort(() => rnd() - 0.5),
            }));
            const a = grid(size);
            const b = grid(size);
            // A partly pre-claimed grid (ReviewEmpireTerritoryUpdate passes the previous one).
            if (scenario % 5 === 4) {
                for (let k = 0; k < size * 3; k++) {
                    const x = Math.floor(rnd() * size);
                    const y = Math.floor(rnd() * size);
                    a[x][y] = b[x][y] = 1 + Math.floor(rnd() * 9);
                }
            }
            referenceFill(a, list, sizeX / size, sizeY / size, num1, size);
            fillTerritoryCells(b, list, sizeX / size, sizeY / size, num1, size);
            expect(firstDifference(a, b), `scenario ${scenario}`).toBeNull();
        }
    });
});

describe('fillTerritoryCells on a real game', () => {
    let gameData: GameData;
    beforeAll(async () => {
        gameData = await loadGameDataFs();
    }, 60000);

    it('seed-1 harness game: the full-galaxy grid and a section update match the reference', () => {
        const game = cachedTickGame(gameData, { age: 3 });
        const g = game.galaxy;
        const size = TERRITORY_INDEX_SIZE;
        const num1 = g.sizeX / size;
        const full = territoryColonyList(g, { x: 0, y: 0, w: g.sizeX, h: g.sizeY }, false);
        expect(full.length).toBeGreaterThan(20);
        expect(full.some((e) => e.overlapping.length > 0)).toBe(true);
        const a = grid(size);
        const b = grid(size);
        referenceFill(a, full, g.sizeX / size, g.sizeY / size, num1, size);
        fillTerritoryCells(b, full, g.sizeX / size, g.sizeY / size, num1, size);
        expect(firstDifference(a, b)).toBeNull();
        let claimed = 0;
        for (const row of b) for (const v of row) if (v !== 0) claimed++;
        expect(claimed).toBeGreaterThan(1000);
        // ReviewEmpireTerritoryUpdate: a section around one colony, onto the previous grid.
        const c = full[Math.floor(full.length / 2)].colony;
        const section = { x: Math.trunc(c.xpos) - 1600000, y: Math.trunc(c.ypos) - 1600000, w: 3200000, h: 3200000 };
        const part = territoryColonyList(g, section, false);
        const a2 = a.map((r) => r.slice());
        const b2 = b.map((r) => r.slice());
        for (let x = 0; x < size; x += 3) a2[x].fill(0, 0, size >> 1), b2[x].fill(0, 0, size >> 1);
        referenceFill(a2, part, g.sizeX / size, g.sizeY / size, num1, size);
        fillTerritoryCells(b2, part, g.sizeX / size, g.sizeY / size, num1, size);
        expect(firstDifference(a2, b2)).toBeNull();
    });
});
