import { beforeAll, describe, expect, it } from 'vitest';
import { createGame, type CreateGameOptions } from '../src/sim/game';
import { GalaxyShape } from '../src/sim/types';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import { empireGovernmentAttributes } from '../src/sim/empire';
import { annualTaxRevenue } from '../src/sim/forceStructure';
import {
    empireApprovalRating,
    gameStartColonyRecalc,
    gameStartReviewTaxes,
    habitatDevelopmentLevel,
    netRound,
    taxComplianceRate,
} from '../src/sim/taxes';

// Empire.10.cs ReviewTaxes / Empire.9.cs SetColonyTaxRate / Habitat.cs EmpireApprovalRating,
// run as Start.2.cs 1109-1115 and 1318-1339 do.
let gameData: GameData;
beforeAll(async () => { gameData = await loadGameDataFs(); }, 60000);

function opts(): CreateGameOptions {
    const ai = (race: string) => ({ race, homeSystemFavourability: 'Normal' as const, proximityDistance: 'Random', age: 1, techLevel: 0.5 });
    return {
        seed: 1, shape: GalaxyShape.Spiral, starCount: 300, sectorWidth: 8, sectorHeight: 8,
        systemNames: Array.from({ length: 300 }, (_, i) => `S${i}`), gameData,
        player: { race: 'Human', homeSystemFavourability: 'Normal', startLocation: '(Random)', age: 1, techLevel: 0.5 },
        aiEmpires: [ai('(Random)'), ai('(Random)'), ai('(Random)')],
    };
}

// Counts Galaxy.Rnd draws by wrapping the sampling entry points.
function countDraws(g: Galaxy): { count: () => number } {
    let n = 0;
    const rnd = g.rnd as unknown as Record<string, (...a: unknown[]) => unknown>;
    for (const k of ['next', 'nextDouble', 'nextBytes']) {
        const f = rnd[k];
        if (typeof f !== 'function') continue;
        rnd[k] = function (this: unknown, ...a: unknown[]) { n++; return f.apply(this, a); };
    }
    return { count: () => n };
}

function run() {
    const galaxy = createGame(opts()).galaxy;
    const empires = galaxy.empires;
    const rndBefore = JSON.stringify(galaxy.rnd);
    const counter = countDraws(galaxy);
    for (const e of empires) gameStartColonyRecalc(galaxy, e);
    for (const e of empires) gameStartReviewTaxes(galaxy, e, galaxy.age);
    const draws = counter.count();
    const rndAfter = JSON.stringify(galaxy.rnd);
    const colonies = empires.flatMap((e) => e.colonies.map((c) => ({
        empire: e.name,
        pop: c.population.totalAmount,
        dev: habitatDevelopmentLevel(c),
        taxRate: c.taxRate,
        approval: empireApprovalRating(galaxy, c),
        compliance: taxComplianceRate(galaxy, c),
        revenue: c.annualTaxRevenue,
        sfc: empireGovernmentAttributes(e)?.specialFunctionCode ?? 0,
        smallPolicy: e.policy!.colonyTaxRateSmallColony,
    })));
    const totals = empires.map((e) => ({ pop: e.totalPopulation, corruption: e.corruption, tax: annualTaxRevenue(galaxy, e) }));
    return { galaxy, colonies, totals, draws, rndBefore, rndAfter };
}

describe('taxes (ReviewTaxes at game start)', () => {
    it('sets tax rates per SetColonyTaxRate, positive revenue, no Rnd, deterministic', () => {
        const a = run();
        // No Galaxy.Rnd draws anywhere in the tax / approval model.
        expect(a.draws).toBe(0);
        expect(a.rndAfter).toBe(a.rndBefore);
        expect(a.colonies.length).toBeGreaterThan(0);
        // Pinned for seed 1 (TS port state: one ~10B-pop capital per empire, Large policy → target
        // approval 10; two ReviewTaxes passes). Re-pin if colony generation changes upstream.
        expect(a.colonies.map((c) => c.taxRate)).toEqual([0.23, 0.16, 0.14, 0.25].map(Math.fround));
        for (const c of a.colonies) {
            // Rounded to 2 decimals (Math.Round(num3, 2)) and stored as float.
            expect(Math.fround(netRound(c.taxRate, 2))).toBe(c.taxRate);
            if (c.sfc === 1) {
                expect(c.taxRate).toBe(Math.fround(1.0));
            } else {
                expect(c.taxRate).toBeGreaterThanOrEqual(0);
                expect(c.taxRate).toBeLessThanOrEqual(Math.fround(0.5));
                // Policy.ColonyTaxRateSmallColony = 0 → num6 = 0 for colonies <= 200M.
                if (c.pop <= 200000000 && c.smallPolicy === 0) expect(c.taxRate).toBe(0);
            }
            expect(c.compliance).toBeGreaterThanOrEqual(0);
            expect(c.compliance).toBeLessThanOrEqual(1);
            expect(Number.isFinite(c.approval)).toBe(true);
            if (c.taxRate > 0) expect(c.revenue).toBeGreaterThan(0);
        }
        // Every empire's populated capital is taxed.
        for (const t of a.totals) {
            expect(t.pop).toBeGreaterThan(0);
            expect(t.tax).toBeGreaterThan(0);
            expect(t.corruption).toBeGreaterThanOrEqual(0);
        }
        const b = run();
        expect(b.colonies).toEqual(a.colonies);
        expect(b.totals).toEqual(a.totals);
    }, 120000);

    it('createGame sets DevelopmentLevelBaseline and the DoTasks population/corruption caches', () => {
        const galaxy = createGame(opts()).galaxy;
        for (const e of galaxy.empires) {
            // Empire.1.cs 268 / Habitat.cs 1070 RecalculateDevelopmentLevelBaseline (developmentLevel.ts).
            for (const c of e.colonies) {
                expect(c.developmentLevelBaseline).toBe(Math.trunc(50 * Math.min(1, c.population.totalAmount / 500000000)));
                // Habitat.cs 447: the property adds the baseline to _DevelopmentLevel (+ bonuses).
                expect(habitatDevelopmentLevel(c)).toBeGreaterThanOrEqual(c.developmentLevelBaseline + c.developmentLevel);
            }
            // Empire.1.cs 3531/3533 (GenerateEmpire's DoTasks periodic block): _TotalPopulation and
            // Corruption are written before the projections read them.
            expect(e.totalPopulation).toBeGreaterThan(0);
            expect(e.corruption).toBeGreaterThan(0);
        }
    }, 120000);

    it('netRound matches .NET Math.Round(x, 2) (MidpointRounding.ToEven)', () => {
        expect(netRound(0.125, 2)).toBe(0.12);
        expect(netRound(0.135, 2)).toBe(0.14);
        expect(netRound(0.2349, 2)).toBe(0.23);
        expect(netRound(0.5, 0)).toBe(0);
        expect(netRound(1.5, 0)).toBe(2);
    });
});
