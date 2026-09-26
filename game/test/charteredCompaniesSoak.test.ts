// @slow — soak: 3 game years (1800 s) of the seed-1 harness game with the chartered-companies scenario and AI charters.
// Scenario package 19c (tasks/19c-chartered-companies.md §9.10): AI empires found companies; no AI side of a
// company–founder pair declares war while the charter is active; tariffs are never negative; empire slots respected.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import { runGameSeconds } from '../src/sim/tick/harness';
import { registerScenarioEvent } from '../src/sim/scenario/hooks';
import { DiplomaticRelationType } from '../src/sim/diplomacy';
import { activeCharterOfCompany, allCharters, empireById } from '../src/sim/scenario/charteredCompanies/charters';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

describe('chartered companies soak', () => {
    it('AI empires charter companies that live as ordinary AI empires under their treaty', () => {
        const { game } = createScenarioGame(base, {
            scenario: 'chartered-companies',
            flags: { charteredCompanies: true, aiCharters: true },
            params: { charterFee: 5000, aiCharterChancePct: 100 },
        });
        const g = game.galaxy;
        const wars: string[] = [];
        const off = registerScenarioEvent({
            id: 'test.soak.wars',
            flag: 'charteredCompanies',
            event: 'diplomaticRelationChanged',
            run: (gal, ev) => {
                if (ev.to !== DiplomaticRelationType.War || ev.empire === gal.playerEmpire) return;
                const c = activeCharterOfCompany(gal, ev.empire) ?? activeCharterOfCompany(gal, ev.other);
                if (c !== null && (c.founderId === ev.other.empireId || c.founderId === ev.empire.empireId)) wars.push(`${ev.empire.name} → ${ev.other.name}`);
            },
        });
        try {
            runGameSeconds(g, 1800);
        } finally {
            off();
        }
        const cs = allCharters(g);
        expect(cs.length).toBeGreaterThan(0);
        expect(wars).toEqual([]);
        for (const c of cs) {
            expect(c.tariffTotal).toBeGreaterThanOrEqual(0);
            const company = empireById(g, c.companyId);
            if (c.status === 'active') expect(company?.active).toBe(true);
        }
        expect(g.nextEmpireId).toBeLessThanOrEqual(g.maximumEmpireCount);
        console.log(`charters: ${cs.map((c) => `${c.companyId}<-${c.founderId}:${c.status}:${Math.round(c.tariffTotal)}`).join(', ')}; ids left ${g.maximumEmpireCount - g.nextEmpireId}`);
    }, 2400000);
});
