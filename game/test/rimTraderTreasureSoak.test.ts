// @slow
// Scenario 19a follow-up soak (tasks/M4-deferred-plan.md "19a follow-up"): 5 game years of the standard seed-1 game with
// the rimTrade scenario (Oranthi forced as the first AI) and the addendum on (contact broadcast, treasure fleet). At
// least one non-pirate empire must gain access to the Concord's rare goods. Prints a yearly summary and, from the
// freight-flow recorder (19e-9), where the rim goods flowed (seller → buyer).
import { beforeAll, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Empire } from '../src/sim/empire';
import { runGameSeconds } from '../src/sim/tick/harness';
import { YEAR_LENGTH } from '../src/sim/galaxyTime';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { enableTradeFlowRecording } from '../src/sim/logistics/tradeFlows';
import { rimGoodIds, rimTradeState, rimTraderEmpire } from '../src/sim/scenario/rimTrade/common';
import { treasureState } from '../src/sim/scenario/rimTrade/treasureFleet';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

describe('19a follow-up soak', () => {
    it('5 years: at least one non-pirate empire gains access to the rare goods', () => {
        const { game } = createScenarioGame(base, { scenario: 'rimTrade', options: (o) => ({ ...o, aiEmpires: [{ ...o.aiEmpires[0], race: 'Oranthi' }, ...o.aiEmpires.slice(1)] }) });
        const g = game.galaxy;
        const r = rimTraderEmpire(g)!;
        const flows = enableTradeFlowRecording(g, 0);
        const rim = rimGoodIds(g);
        const everOpen = new Set<string>();
        const summary: string[] = [];
        for (let year = 1; year <= 5; year++) {
            runGameSeconds(g, YEAR_LENGTH / 1000);
            const st = rimTradeState(g);
            const ts = treasureState(g);
            const others = g.empires.filter((e): e is Empire => e !== null && e !== r && e.active && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null);
            const met = others.filter((e) => obtainDiplomaticRelation(r, e).type !== DiplomaticRelationType.NotMet).length;
            const open = others.filter((e) => obtainDiplomaticRelation(r, e).supplyRestrictedResources).map((e) => e.name);
            for (const n of open) everOpen.add(n);
            // Access is also gained when an empire actually buys rare goods (a debit in its ledger row): with the rare price
            // factor (ee02693: buyers pay 2x, so a treasure-ship stop spends the whole standing) the treasure fleet's
            // sale takes the standing back under the grant threshold before the yearly sample, so the diplomatic flag alone
            // is not a reliable witness (it was open at a year end only in worlds where the sale left standing >= 0).
            for (const e of others) if ((st.ledger[e.empireId]?.debit ?? 0) > 0) everOpen.add(e.name);
            summary.push(
                `year ${year}: met ${met}/${others.length}, money ${Math.round(r.stateMoney)}, rim buys ${st.stats.rimBuys} (${st.stats.rimUnits} u, ${Math.round(st.stats.rimValue)} cr), rare sales ${st.stats.rareSales} (${st.stats.rareUnits} u), ` +
                    `fleet ${ts.ships.length} ships, voyages ${ts.stats.voyages}, stops ${ts.stats.stops}, fleet rim ${ts.stats.rimUnits} u, fleet rare ${ts.stats.rareUnits} u, lost ${ts.stats.lost}, capped ${ts.researchCapped}, open: ${open.join(', ') || '-'}, ` +
                    `ledger ${JSON.stringify(Object.fromEntries(Object.entries(st.ledger).map(([k, v]) => [k, [Math.round(v.credit), Math.round(v.debit)]])))}`,
            );
        }
        // Where the rim goods flowed (freight overlay data).
        const bySeller = new Map<string, number>();
        for (const e of flows.entries) {
            if (!rim.includes(e.resourceId)) continue;
            let v = 0;
            for (let i = 0; i < e.value.length; i++) v += e.value[i];
            const key = `${[...e.sellers].map((x) => x.name).join('/')} → ${[...e.buyers].map((x) => x.name).join('/')}`;
            bySeller.set(key, (bySeller.get(key) ?? 0) + v);
        }
        summary.push('rim-good flows (last 13 months): ' + ([...bySeller].map(([k, v]) => `${k}: ${Math.round(v)} cr`).join('; ') || '-'));
        console.log(summary.join('\n'));
        if (process.env.DWU_SOAK_OUT) writeFileSync(process.env.DWU_SOAK_OUT, summary.join('\n') + '\n');
        expect(everOpen.size).toBeGreaterThanOrEqual(1);
    }, 3600000);
});
