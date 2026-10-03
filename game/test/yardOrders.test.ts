// Construction Yards screen orders (sim/player/yardOrders.ts) on the seed-1 harness game, through the player command queue.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { BuiltObject } from '../src/sim/builtObject';
import type { ConstructionQueue } from '../src/sim/construction/constructionQueue';
import { issuePlayerCommand, flushPlayerCommands } from '../src/sim/player/playerCommands';
import { constructionSites, purchaserChecks, purchaserDesigns, siteQueue, siteTarget, type ConstructionSite } from '../src/ui/screens/constructionYards';
import { removeFromYardQueue } from '../src/sim/player/yardOrders';
import { renameShip } from '../src/sim/player/fleetOps';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

function yardSite(g: Game): ConstructionSite {
    const e = g.playerEmpire;
    const sites = constructionSites(e);
    const site = sites.find((s) => s.kind === 'builtObject') ?? sites.find((s) => s.kind === 'colony' && siteQueue(s) !== null);
    if (!site) throw new Error('no construction site');
    return site;
}

describe('yard orders', () => {
    it('purchase at a yard queues the design there and charges its price; remove refunds half', () => {
        const g = cachedTickGame(gameData);
        const e = g.playerEmpire;
        const galaxy = g.galaxy;
        const site = yardSite(g);
        const designs = purchaserDesigns(e.designs, site, purchaserChecks(e));
        expect(designs.length).toBeGreaterThan(0);
        const d = designs[0];
        e.stateMoney = Math.max(e.stateMoney, d.calculateCurrentPurchasePrice(galaxy) * 4);
        const money0 = e.stateMoney;
        const price = d.calculateCurrentPurchasePrice(galaxy);
        let bought: BuiltObject | null = null;
        issuePlayerCommand(galaxy, e, 'yardPurchase', [d, siteTarget(site)], (r) => (bought = r));
        flushPlayerCommands(galaxy);
        expect(bought).not.toBeNull();
        const ship = bought! as BuiltObject;
        expect(ship.builtAt).toBe(siteTarget(site));
        expect(e.stateMoney).toBeCloseTo(money0 - price, 6);
        const q = siteQueue(site) as ConstructionQueue;
        const inYard = (q.constructionYards ?? []).some((y) => y?.shipUnderConstruction === ship);
        const waiting = (q.constructionWaitQueue ?? []).includes(ship);
        expect(inYard || waiting).toBe(true);
        if (waiting) {
            const m1 = e.stateMoney;
            expect(removeFromYardQueue(galaxy, siteTarget(site), ship)).toBe(true);
            expect(q.constructionWaitQueue).not.toContain(ship);
            expect(e.stateMoney).toBeCloseTo(m1 + ship.purchasePrice * 0.5, 6);
        }
    }, 300000);

    it('unaffordable: nothing queued', () => {
        const g = cachedTickGame(gameData);
        const e = g.playerEmpire;
        const site = yardSite(g);
        const d = purchaserDesigns(e.designs, site, purchaserChecks(e))[0];
        e.stateMoney = 0;
        let res: BuiltObject | null | undefined;
        issuePlayerCommand(g.galaxy, e, 'yardPurchase', [d, siteTarget(site)], (r) => (res = r));
        flushPlayerCommands(g.galaxy);
        expect(res).toBeNull();
        expect(e.stateMoney).toBe(0);
    }, 300000);

    it('rename ignores blanks, trims, and only renames the empire\'s own ships', () => {
        const mine = {} as Parameters<typeof renameShip>[0];
        const other = {} as Parameters<typeof renameShip>[0];
        const ship = { name: 'A', empire: mine } as unknown as BuiltObject;
        expect(renameShip(mine, ship, '  ')).toBe(false);
        expect(renameShip(other, ship, 'X')).toBe(false);
        expect(renameShip(mine, ship, ' B ')).toBe(true);
        expect(ship.name).toBe('B');
    });
});
