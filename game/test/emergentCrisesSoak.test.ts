// 19d2 Resource crises soak (tasks/19d2-resource-crises.md §7/§8): seed 1 with the resource-crises scenario at its
// defaults for SOAK_YEARS game years (default 30; DWU_CRISES_SOAK_YEARS overrides). Checks the reserve calibration over
// the first five years, then the §8 acceptance: at least one depletion and one crisis price, no NaN prices, no resource
// flipping crisis ↔ normal at every review, no empire held at the approval floor by shortages for more than 10 years,
// every open crisis visible in the Empire Summary block.
// @slow
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Empire } from '../src/sim/empire';
import type { Habitat } from '../src/sim/types';
import { runGameSeconds } from '../src/sim/tick/harness';
import { galaxyResourceCurrentPrices } from '../src/sim/design';
import { empireApprovalRating } from '../src/sim/taxes';
import { crisesState, crisesSummaryRows, crisisPriceIndex, empireCrises, shortageTerm } from '../src/sim/scenario/emergent/crises';

const SOAK_YEARS = Number(process.env.DWU_CRISES_SOAK_YEARS ?? 30);
const DEFAULT_RESERVE = 250; // scenario.json reserveUnitsPerAbundance default

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

// Opt-in (DWU_CRISES_SOAK=1): the first 30-year run (2815 s wall) died inside the base sim with
// "TODO(port) M4d: component cargo" (manufacturingQueue.ts ManufacturingQueue.clear via assign.ts
// clearPreviousMissionRequirements) before the acceptance asserts; see tasks/19d2-resource-crises.md §11.
describe.skipIf(process.env.DWU_CRISES_SOAK !== '1')('resource crises soak', () => {
    it(`${SOAK_YEARS} years on seed 1: calibration, depletions, crisis prices, bounded unrest`, () => {
        const { game } = createScenarioGame(base, { scenario: 'resource-crises' });
        const g = game.galaxy;
        const key = (h: Habitat, r: number) => `${g.habitats.indexOf(h)}#${r}`;
        let snap1: Map<string, number> | null = null;
        const rates: number[] = [];
        const floorYears = new Map<Empire, number>();
        const maxFloorRun = new Map<Empire, number>();
        const inCrisisHistory = new Map<number, boolean[]>();
        let sawCrisisPrice = false;
        for (let y = 1; y <= SOAK_YEARS; y++) {
            for (let k = 0; k < 10; k++) {
                runGameSeconds(game, 60);
                if (!sawCrisisPrice && crisisPriceIndex(g).some((p) => p.inCrisis)) sawCrisisPrice = true;
            }
            const st = crisesState(g);
            // Calibration (§7): units extracted per abundance point per year, sources seen at years 1 and 5.
            if (y === 1 || y === 5) {
                const m = new Map<string, number>();
                for (const [h, byRes] of st.extracted) for (const [r, u] of byRes) m.set(key(h, r), u);
                if (y === 1) snap1 = m;
                else {
                    for (const [h, byRes] of st.extracted) {
                        for (const [r, u] of byRes) {
                            const s = snap1!.get(key(h, r));
                            const a = st.baseAbundance.get(h)?.get(r) ?? 0;
                            if (s !== undefined && a > 0 && u > s) rates.push((u - s) / 4 / a);
                        }
                    }
                }
            }
            // No NaN prices.
            for (const p of galaxyResourceCurrentPrices(g)) expect(Number.isNaN(p)).toBe(false);
            for (const p of crisisPriceIndex(g)) {
                const hist = inCrisisHistory.get(p.resourceId) ?? [];
                hist.push(p.inCrisis);
                inCrisisHistory.set(p.resourceId, hist);
                if (p.inCrisis) sawCrisisPrice = true;
            }
            // Approval floor held by shortages: mean colony approval below −15 (angry) with a shortage term in it.
            for (const e of g.empires) {
                if (e == null || !e.active || e === g.independentEmpire || e.colonies.length === 0) continue;
                let sum = 0;
                let short = 0;
                for (const h of e.colonies) {
                    sum += empireApprovalRating(g, h);
                    short += shortageTerm(g, h);
                }
                const atFloor = sum / e.colonies.length < -15 && short < 0 && (sum - short) / e.colonies.length >= -15;
                const run = atFloor ? (floorYears.get(e) ?? 0) + 1 : 0;
                floorYears.set(e, run);
                maxFloorRun.set(e, Math.max(maxFloorRun.get(e) ?? 0, run));
                // Every open crisis has an Empire Summary line.
                const rows = crisesSummaryRows(g, e);
                expect(rows.find((r) => r.label === 'Crises')!.value).toBe(String(empireCrises(g, e).length));
            }
        }
        rates.sort((a, b) => a - b);
        const median = rates[Math.floor(rates.length / 2)];
        const life = DEFAULT_RESERVE / median;
        // Measured on seed 1 (years 1→5, 217 sources, reserves off): units extracted per abundance point per year
        // p10 0, median 3.52, p90 14.8, max 24 (base abundance median 610, 200–996). Default 2000 would give a median
        // life of ~570 years, so the default is 250 (median life ~60–70 years; the fastest sources ~10–17 years).
        expect(rates.length).toBeGreaterThan(20);
        expect(life).toBeGreaterThanOrEqual(40);
        expect(life).toBeLessThanOrEqual(80);
        const st = crisesState(g);
        if (SOAK_YEARS >= 30) {
            expect(st.crises.some((c) => c.kind === 'depletion' || c.kind === 'shock')).toBe(true);
            expect(sawCrisisPrice).toBe(true);
        }
        for (const [, run] of maxFloorRun) expect(run).toBeLessThanOrEqual(10);
        // No resource flips crisis ↔ normal at every review for 5 reviews running.
        for (const [, hist] of inCrisisHistory) {
            let flips = 0;
            let worst = 0;
            for (let i = 1; i < hist.length; i++) {
                flips = hist[i] !== hist[i - 1] ? flips + 1 : 0;
                worst = Math.max(worst, flips);
            }
            expect(worst).toBeLessThan(5);
        }
    }, 3 * 3600 * 1000);
});
