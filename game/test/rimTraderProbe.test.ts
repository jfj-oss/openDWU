import { it } from 'vitest';
import { appendFileSync } from 'node:fs';
const LOG='/tmp/claude-1000/-home-justinf/1eafa9b6-aa74-5148-afe4-ed417f2fbdf0/scratchpad/probe.log';
const log=(...a: unknown[])=>appendFileSync(LOG, a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')+'\n');
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame } from './helpers/scenarioGame';
import { radiusFraction } from '../src/sim/scenario';
import { runGameSeconds } from '../src/sim/tick/harness';
import { rimTradeState, rimTraderEmpire, rimTraderPort, rimGoodIds, rareGoodIds } from '../src/sim/scenario/rimTrade/common';
import { rimTraderPortStock } from '../src/sim/scenario/rimTrade/rimTrader';
import { obtainDiplomaticRelation } from '../src/sim/diplomacy';
it('probe', async () => {
    const base = await loadGameDataFs();
    const { game } = createScenarioGame(base, { scenario: 'rimTrade', options: (o) => ({ ...o, aiEmpires: [{ ...o.aiEmpires[0], race: 'Oranthi' }, ...o.aiEmpires.slice(1)] }) });
    const g = game.galaxy;
    const R = rimTraderEmpire(g)!;
    const port = rimTraderPort(g)!;
    log('R', R.name, 'port', port.name, (port as any).isSpacePort, 'cap res', R.capital!.resources);
    for (let q = 1; q <= 8; q++) {
        runGameSeconds(g, 150);
        const st = rimTradeState(g);
        log('q', q, 'money', Math.round(R.stateMoney), 'cols', R.colonies.length, 'stats', st.stats, 'ledger', st.ledger,
            'rare@port', rareGoodIds(g).map((id) => rimTraderPortStock(g, id)), 'rim@port', rimGoodIds(g).map((id) => rimTraderPortStock(g, id)),
            'rel', g.empires.filter((e) => e && e !== R).map((e) => { const d = obtainDiplomaticRelation(R, e!); return [e!.empireId, d.type, d.supplyRestrictedResources]; }),
            'orders', g.orders.getOrdersForBuiltObject(port as any).items.map((o) => [o.commodityResource?.resourceId, o.amountRequested, o.amountOutstandingToContract]));
    }
}, 1200000);
