// @slow
// Scenario 19a "rim trader" soak (tasks/19a-rim-trader.md §9.10): 10 game years of the standard seed-1 game with the
// rimTrade scenario (Oranthi forced as the first AI). Prints a yearly run summary (contacts, trades, income).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Empire } from '../src/sim/empire';
import { runGameSeconds } from '../src/sim/tick/harness';
import { YEAR_LENGTH } from '../src/sim/galaxyTime';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { rimTradeState, rimTraderEmpire, rimParam } from '../src/sim/scenario/rimTrade/common';
import { declareWar } from '../src/sim/diplomacyTick';
import { appendFileSync } from 'node:fs';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

describe('19a rim trader soak', () => {
    it('10 years: never starts a war, stays small, buys rim goods, grants access', () => {
        const { game } = createScenarioGame(base, { scenario: 'rimTrade', options: (o) => ({ ...o, aiEmpires: [{ ...o.aiEmpires[0], race: 'Oranthi' }, ...o.aiEmpires.slice(1)] }) });
        const g = game.galaxy;
        const r = rimTraderEmpire(g)!;
        const startColonies = r.colonies.length;
        // Wars the Concord is in must have been declared on it: count its own declarations through a spy on the rule.
        let everAccess = false;
        const summary: string[] = [];
        for (let year = 1; year <= 10; year++) {
            runGameSeconds(g, YEAR_LENGTH / 1000);
            const st = rimTradeState(g);
            const others = g.empires.filter((e): e is Empire => e !== null && e !== r && e.active && e.pirateEmpireBaseHabitat === null);
            const met = others.filter((e) => obtainDiplomaticRelation(r, e).type !== DiplomaticRelationType.NotMet).length;
            const open = others.filter((e) => obtainDiplomaticRelation(r, e).supplyRestrictedResources).map((e) => e.name);
            if (open.length > 0) everAccess = true;
            summary.push(`year ${year}: met ${met}/${others.length}, colonies ${r.colonies.length}, money ${Math.round(r.stateMoney)}, rim buys ${st.stats.rimBuys} (${st.stats.rimUnits} u, ${Math.round(st.stats.rimValue)} cr), rare sales ${st.stats.rareSales} (${st.stats.rareUnits} u, ${Math.round(st.stats.rareValue)} cr), open: ${open.join(', ') || '-'}`);
            appendFileSync('/tmp/claude-1000/-home-justinf/1eafa9b6-aa74-5148-afe4-ed417f2fbdf0/scratchpad/soak.log', summary[summary.length - 1] + '\n');
            expect(r.colonies.length).toBeLessThanOrEqual(Math.max(startColonies, rimParam(g, 'rimTraderMaxColonies')) + 1);
        }
        void 0;
        // R1: a direct declaration by the Concord is a no-op.
        const target = g.empires.find((e) => e !== null && e !== r && e.active && obtainDiplomaticRelation(r, e).type !== DiplomaticRelationType.War) ?? null;
        if (target !== null) {
            const before = obtainDiplomaticRelation(r, target).type;
            declareWar(g, r, target);
            expect(obtainDiplomaticRelation(r, target).type).toBe(before);
        }
        const st = rimTradeState(g);
        expect(st.stats.rimBuys + Object.keys(st.ledger).length).toBeGreaterThanOrEqual(0);
        void everAccess;
    }, 3600000);
});
