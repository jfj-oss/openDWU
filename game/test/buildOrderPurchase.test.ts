// Purchase follow-up: the Build Order panel's rows → method_643 lists → Empire.6.cs 3017 BuildNewShips on the shared
// harness game (seed 1, the human player's start), as btnBuildOrderPurchase_Click (Main.Part2.cs 1135) drives it.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { builtObjectCompleteTeardown } from '../src/sim/combat/teardown';
import { setAutoRebuild } from '../src/sim/player/autoRebuild';
import { processAutoRebuild } from '../src/sim/player/autoRebuildTick';
import { DEFAULT_CONSTRUCTION_PRIORITY, constructionPriorityOf, movedConstructionPriority, setConstructionPriority, type ConstructionPriorityCategory } from '../src/sim/player/constructionPriority';
import { runPlayerCommand } from '../src/sim/player/playerCommands';
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

    function destroyEscort(g: ReturnType<typeof cachedTickGame>['galaxy'], e: ReturnType<typeof cachedTickGame>['playerEmpire']): void {
        const ship = e.builtObjects.find((b) => b.role === BuiltObjectRole.Military && b.owner === e && b.design !== null && b.unbuiltComponentCount === 0);
        expect(ship).toBeDefined();
        ship!.hasBeenDestroyed = true; // as combat marks it before the teardown
        builtObjectCompleteTeardown(g, ship!);
    }
    function queuedCount(e: ReturnType<typeof cachedTickGame>['playerEmpire']): number {
        return e.spacePorts.reduce((n, p) => {
            const q = queueOf(p)!;
            return n + (q.constructionWaitQueue ?? []).length + (q.constructionYards ?? []).filter((y) => y.shipUnderConstruction).length;
        }, 0);
    }
    it('auto-rebuild ships: a destroyed ship is re-queued once with the switch on, nothing with it off', () => {
        const off = cachedTickGame(gameData);
        off.playerEmpire.stateMoney = 1e9;
        const before = queuedCount(off.playerEmpire);
        destroyEscort(off.galaxy, off.playerEmpire);
        processAutoRebuild(off.galaxy, off.playerEmpire);
        expect(off.playerEmpire.autoRebuild).toBeUndefined();
        expect(queuedCount(off.playerEmpire)).toBe(before);

        const { galaxy: g, playerEmpire: e } = cachedTickGame(gameData);
        e.stateMoney = 1e9;
        expect(setAutoRebuild(g, e, 'ships', true)).toBe(true);
        const q0 = queuedCount(e);
        destroyEscort(g, e);
        expect(e.autoRebuild!.losses.length).toBe(1);
        processAutoRebuild(g, e);
        expect(queuedCount(e)).toBe(q0 + 1);
        expect(e.autoRebuild!.losses.length).toBe(0);
        processAutoRebuild(g, e);
        expect(queuedCount(e)).toBe(q0 + 1);
    });
    it('auto-rebuild ships: waits without debt, ignores scrapped ships and the stations switch', () => {
        const { galaxy: g, playerEmpire: e } = cachedTickGame(gameData);
        setAutoRebuild(g, e, 'ships', true);
        e.stateMoney = 1e9;
        const scrapped = e.builtObjects.find((b) => b.role === BuiltObjectRole.Military && b.owner === e)!;
        builtObjectCompleteTeardown(g, scrapped); // not marked destroyed: scrapped / retired
        expect(e.autoRebuild!.losses.length).toBe(0);
        destroyEscort(g, e);
        e.stateMoney = 0;
        const q0 = queuedCount(e);
        processAutoRebuild(g, e);
        expect(queuedCount(e)).toBe(q0);
        expect(e.stateMoney).toBe(0);
        expect(e.autoRebuild!.losses.length).toBe(1);
        setAutoRebuild(g, e, 'ships', false);
        expect(e.autoRebuild!.losses.length).toBe(0);
    });
    it('construction priority: new games use the default order, older saves the stock one; journaled, human empires only', () => {
        // The cached game went through save / load, so the new-game mark survives a save.
        const { galaxy: g, playerEmpire: e } = cachedTickGame(gameData);
        expect(g.constructionPriorityDefault).toBe(true);
        expect(constructionPriorityOf(g, e)).toEqual(['researchResort', 'mining', 'other']);
        const ai = g.empires.find((x) => x !== e && x.capital !== null)!;
        expect(constructionPriorityOf(g, ai)).toBeNull();
        expect(setConstructionPriority(g, ai, ['mining', 'researchResort', 'other'])).toBe(false);
        expect(setConstructionPriority(g, e, ['mining', 'mining', 'other'] as ConstructionPriorityCategory[])).toBe(false);
        const moved = movedConstructionPriority(DEFAULT_CONSTRUCTION_PRIORITY, 0, 1)!;
        expect(moved).toEqual(['mining', 'researchResort', 'other']);
        expect(movedConstructionPriority(DEFAULT_CONSTRUCTION_PRIORITY, 0, -1)).toBeNull();
        expect(runPlayerCommand(g, e, 'setConstructionPriority', [moved])).toBe(true);
        expect(constructionPriorityOf(g, e)).toEqual(moved);
        expect(runPlayerCommand(g, e, 'setConstructionPriority', ['stock'])).toBe(true);
        expect(constructionPriorityOf(g, e)).toBeNull();
        // A save from before the setting: no mark, no order of its own -> the stock order.
        const old = cachedTickGame(gameData);
        delete old.galaxy.constructionPriorityDefault;
        expect(constructionPriorityOf(old.galaxy, old.playerEmpire)).toBeNull();
    });
});
