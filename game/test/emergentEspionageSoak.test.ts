// @slow
// 19d3 espionage consequences soak (tasks/19d3-espionage-consequences.md §8): seed 1 with the flag on over many game
// years — crises open only between empires not at war, stolen tech changes hands, no exceptions; false-flag counts are
// logged (framed vs unframed pairs reaching sanctions / war). Years and seeds: DWU_ESPIONAGE_SOAK_YEARS (default 5),
// DWU_ESPIONAGE_SOAK_SEEDS (default "1"). The §8 acceptance counts (≥ 1 crisis and ≥ 1 stolen-tech transfer) are asserted
// with DWU_ESPIONAGE_SOAK_STRICT=1 (use with 30 years): on seed 1 the AIs run no offensive missions against normal empires
// in the first 5 years (every agent is on counter-intelligence), so a short run has nothing to count.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import { runGameSeconds } from '../src/sim/tick/harness';
import { registerScenarioYearly } from '../src/sim/scenario/hooks';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { DiplomaticRelationType } from '../src/sim/diplomacy';
import { espionageState } from '../src/sim/scenario/emergent/espionage';

const YEARS = Number(process.env.DWU_ESPIONAGE_SOAK_YEARS ?? 5);
const STRICT = process.env.DWU_ESPIONAGE_SOAK_STRICT === '1';
const SEEDS = (process.env.DWU_ESPIONAGE_SOAK_SEEDS ?? '1').split(',').map(Number);

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

describe('espionage consequences soak', () => {
    for (const seed of SEEDS) {
        it(`seed ${seed}, ${YEARS} years: crises, stolen-tech transfers, framed pairs`, () => {
            const { game } = createScenarioGame(base, {
                scenario: 'espionage-consequences',
                params: { falseFlagAiChance: 1, techLeakChance: 1 },
                options: (o) => ({ ...o, seed }),
            });
            const g = game.galaxy;
            // Crises never open between empires at war: checked right after the package's yearly review (order 30).
            let atWarOpenings = 0;
            let errors = 0;
            const off = registerScenarioYearly({
                id: 'test.soak.check',
                flag: 'espionageConsequences',
                order: 31,
                run: (gx) => {
                    const now = galaxyStarDate(gx);
                    for (const c of espionageState(gx).crises) {
                        if (c.opened === now && c.victim.diplomaticRelations.byEmpire(c.offender)?.type === DiplomaticRelationType.War) atWarOpenings++;
                    }
                },
            });
            try {
                for (let y = 0; y < YEARS; y++) runGameSeconds(game, 600);
            } catch (e) {
                errors++;
                throw e;
            } finally {
                off();
            }
            expect(errors).toBe(0);
            expect(atWarOpenings).toBe(0);
            const st = espionageState(g);
            const transfers = st.stolen.reduce((n, s) => n + s.holders.length - 1, 0);
            const framedPairs = new Set(Object.keys(st.lastFramed));
            const framedEscalated = st.crises.filter((c) => (c.stage === 'sanctions' || c.stage === 'war' || c.resolution !== '') && framedPairs.has(String(c.offender.empireId))).length;
            const summary = {
                seed,
                years: YEARS,
                exposures: st.exposures.length,
                crises: st.crises.map((c) => `${c.offender.name}->${c.victim.name}:${c.stage}/${c.demand}/${c.response}/${c.severity}`),
                stolen: st.stolen.length,
                transfers,
                framed: Object.keys(st.lastFramed).length,
                framedEscalated,
            };
            process.stdout.write(`[19d3 soak] ${JSON.stringify(summary)}\n`);
            if (STRICT) {
                expect(st.crises.length).toBeGreaterThan(0);
                expect(transfers).toBeGreaterThan(0);
            }
        }, 7200000);
    }
});
