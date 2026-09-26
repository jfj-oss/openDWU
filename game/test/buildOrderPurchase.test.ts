// Purchase follow-up: the Build Order panel's rows → method_643 lists → Empire.6.cs 3017 BuildNewShips on the shared
// harness game (seed 1, the human player's start), as btnBuildOrderPurchase_Click (Main.Part2.cs 1135) drives it.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { buildNewShips, buildOrderTotalCost, queueOf } from '../src/sim/construction/empireConstruction';
import { BUILD_ORDER_SUBROLES, buildOrderPurchaseLists, buildOrderRows, buildOrderTotals, purchaseResultText } from '../src/ui/screens/buildOrder';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

describe('Build Order purchase on the harness game', () => {
    it('queues the ordered escorts at the yard and charges the panel total', () => {
        const { galaxy: g, playerEmpire: e } = cachedTickGame(gameData);
        const rows = buildOrderRows(e, g);
        const amounts = rows.map(() => 0);
        const i = BUILD_ORDER_SUBROLES.indexOf(BuiltObjectSubRole.Escort);
        expect(rows[i].design).not.toBeNull();
        amounts[i] = 2;
        const totals = buildOrderTotals(g, e, rows, amounts);
        expect(totals.total).toBeCloseTo(2 * rows[i].unitCost, 6);
        expect(totals.maintenance).toBeCloseTo(2 * rows[i].unitMaintenance, 6);
        const lists = buildOrderPurchaseLists(rows, amounts);
        expect(buildOrderTotalCost(g, e, lists.designs, lists.amounts).total).toBeCloseTo(totals.total, 6);
        const money0 = e.stateMoney;
        const r = buildNewShips(g, e, lists.designs, lists.amounts);
        expect(r.ok).toBe(true);
        expect(r.built.length).toBe(2);
        expect(e.stateMoney).toBeCloseTo(money0 - totals.total, 6);
        for (const bo of r.built) {
            const yard = bo.builtAt as Parameters<typeof queueOf>[0];
            const q = queueOf(yard)!;
            expect([...(q.constructionWaitQueue ?? []), ...(q.constructionYards ?? []).map((y) => y.shipUnderConstruction)].filter(Boolean)).toContain(bo);
        }
        expect(purchaseResultText(r)).toBe('Build order placed: 2 ships queued for construction');
    });
    it('an order over StateMoney is refused with the cannot-afford message and changes nothing', () => {
        const { galaxy: g, playerEmpire: e } = cachedTickGame(gameData);
        const rows = buildOrderRows(e, g);
        const amounts = rows.map((r) => (r.design ? 1000 : 0));
        const lists = buildOrderPurchaseLists(rows, amounts);
        const money0 = e.stateMoney;
        const r = buildNewShips(g, e, lists.designs, lists.amounts);
        expect(r.ok).toBe(false);
        expect(r.built).toEqual([]);
        expect(e.stateMoney).toBe(money0);
        expect(purchaseResultText(r)).toContain('Cannot afford build order');
    });
});
