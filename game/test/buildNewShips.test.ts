// 17a buildorder: the player's Build Order purchase — Main.Part2.cs 1135 btnBuildOrderPurchase_Click (affordability check
// against method_632's total, ported as buildOrderTotalCost) → Empire.6.cs 3017 BuildNewShips — driven from the shared
// harness game (seed 1, the human player's start: one ship yard, "Sol 2 Space Port").
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame } from './helpers/tickGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import { BuiltObject } from '../src/sim/builtObject';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { findNewestCanBuild } from '../src/sim/designGeneration';
import { stateDigest } from '../src/sim/tick/digest';
import {
    buildNewShips,
    buildOrderTotalCost,
    builtObjectsFindShortestConstructionWaitQueue,
    designCalculateMaintenanceCosts,
    habitatsFindShortestConstructionWaitQueue,
    queueOf,
} from '../src/sim/construction/empireConstruction';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

function newGame(): Game {
    return createTickGame(gameData);
}

/** Galaxy.4.cs GenerateBuiltObjectName numbered names: BuildCount as "000". */
function numbered(name: string, n: number): string {
    return name + ' ' + String(n).padStart(3, '0');
}

describe('buildNewShips (Empire.6.cs 3017 BuildNewShips)', () => {
    it('2 escorts of the newest buildable design queue at the shortest-wait yard, named, charged exactly', () => {
        const { galaxy: g, playerEmpire: e } = newGame();
        const d = findNewestCanBuild(e.designs, BuiltObjectSubRole.Escort, e)!;
        expect(d).not.toBeNull();
        const price = d.calculateCurrentPurchasePrice(g);
        const buildCount0 = d.buildCount;
        const money0 = e.stateMoney;
        // The yard SpacePorts.FindShortestConstructionWaitQueue(…, includeVerySmallYards: false) picks (no Rnd, no side
        // effects: a probe BuiltObject is not added to the galaxy).
        const yard = builtObjectsFindShortestConstructionWaitQueue(e.spacePorts, new BuiltObject(d, 'probe', g), false).builtObject!;
        expect(yard).not.toBeNull();
        const q = queueOf(yard)!;
        const wait0 = q.constructionWaitQueue!.length;
        const bos0 = g.builtObjects.length;
        const draws0 = g.rnd.drawCount;

        const r = buildNewShips(g, e, [d], [2]);

        expect(r.ok).toBe(true);
        expect(r.message).toBeUndefined();
        expect(r.built.length).toBe(2);
        // Escort names are numbered (Galaxy.4.cs GenerateBuiltObjectName flag = true): "<design> <BuildCount:000>".
        expect(r.built.map((b) => b.name)).toEqual([numbered(d.name, buildCount0 + 1), numbered(d.name, buildCount0 + 2)]);
        expect(d.buildCount).toBe(buildCount0 + 2);
        for (const b of r.built) {
            expect(b.builtAt).toBe(yard);
            expect(b.parentBuiltObject).toBe(yard);
            expect(b.purchasePrice).toBe(price);
            expect(b.owner).toBe(e);
            expect(e.builtObjects).toContain(b);
            expect(g.builtObjects).toContain(b);
        }
        expect(q.constructionWaitQueue!.slice(wait0)).toEqual(r.built);
        expect(g.builtObjects.length).toBe(bos0 + 2);
        // StateMoney -= num, num = 0 + price + price (Empire.6.cs 3045 / 3084 / 3107).
        expect(e.stateMoney).toBe(money0 - (0.0 + price + price));
        // Rnd: 0 draws. Per escort the C# calls GenerateBuiltObjectName(design) and GenerateBuiltObjectName(design,
        // yard.ParentHabitat) — escorts take the numbered branch (no SelectUniqueBuiltObjectName, no GetCustomName Rnd) —
        // and AddBuiltObjectToGalaxy(…, offsetLocationFromParent: false, …) with a BuiltObject parent (no NextDouble).
        // ProcureConstructionComponents / CreateOrder draw nothing.
        expect(g.rnd.drawCount - draws0).toBe(0);
    }, 300000);

    it('an exploration ship draws the C# name Rnd: 2 × SelectRandomUniqueStandardShipName = 7 draws', () => {
        const { galaxy: g, playerEmpire: e } = newGame();
        const d = findNewestCanBuild(e.designs, BuiltObjectSubRole.ExplorationShip, e)!;
        expect(d).not.toBeNull();
        const money0 = e.stateMoney;
        const price = d.calculateCurrentPurchasePrice(g);
        const draws0 = g.rnd.drawCount;
        const r = buildNewShips(g, e, [d], [1]);
        expect(r.ok).toBe(true);
        expect(r.built.length).toBe(1);
        expect(e.stateMoney).toBe(money0 - (0.0 + price));
        // Galaxy.5.cs 2356 SelectRandomUniqueStandardShipName: Next(0, 127), Next(0, 125), Next(0, 7) (plus Next(0, 3) when the
        // last one is < 2: once on this seed) — once for the constructor's GenerateBuiltObjectName(design) and once for the
        // rename at the yard's colony (Empire.6.cs 3088). AddBuiltObjectToGalaxy draws nothing (offsetLocationFromParent: false).
        expect(g.rnd.drawCount - draws0).toBe(7);
    }, 300000);

    it('a construction ship is queued at the shortest-wait colony (long wait queues allowed)', () => {
        const { galaxy: g, playerEmpire: e } = newGame();
        const d = findNewestCanBuild(e.designs, BuiltObjectSubRole.ConstructionShip, e)!;
        expect(d).not.toBeNull();
        const colony = habitatsFindShortestConstructionWaitQueue(g, e.colonies, new BuiltObject(d, 'probe', g), true).habitat!;
        expect(colony).not.toBeNull();
        const money0 = e.stateMoney;
        const price = d.calculateCurrentPurchasePrice(g);
        const r = buildNewShips(g, e, [d], [1]);
        expect(r.ok).toBe(true);
        expect(r.built.length).toBe(1);
        const b = r.built[0];
        expect(b.builtAt).toBe(colony);
        expect(b.parentHabitat).toBe(colony);
        expect(queueOf(colony)!.constructionWaitQueue).toContain(b);
        expect(e.stateMoney).toBe(money0 - (0.0 + price));
    }, 300000);

    it('an unaffordable order returns the original message and changes nothing', () => {
        const { galaxy: g, playerEmpire: e } = newGame();
        const d = findNewestCanBuild(e.designs, BuiltObjectSubRole.Escort, e)!;
        const price = d.calculateCurrentPurchasePrice(g);
        const n = Math.ceil(e.stateMoney / price) + 1;
        const total = buildOrderTotalCost(g, e, [d], [n]).total;
        expect(total).toBeGreaterThan(e.stateMoney);
        const digest0 = stateDigest(g);
        const draws0 = g.rnd.drawCount;
        const money0 = e.stateMoney;
        const buildCount0 = d.buildCount;
        const bos0 = g.builtObjects.length;
        const orders0 = g.orders.count;

        const r = buildNewShips(g, e, [d], [n]);

        expect(r.ok).toBe(false);
        expect(r.built).toEqual([]);
        // Main.Part2.cs 1141: string.Format(GetText("Build Order Purchase Cannot Afford"), num.ToString("###,###,###,##0"),
        // StateMoney.ToString("###,###,###,##0")) in a "Cannot afford build order" message box.
        expect(r.message).toBe(`Build Order Purchase Cannot Afford|${Math.round(total).toLocaleString('en-US')}|${Math.round(money0).toLocaleString('en-US')}`);
        expect(r.title).toBe('Cannot afford build order');
        expect(e.stateMoney).toBe(money0);
        expect(d.buildCount).toBe(buildCount0);
        expect(g.builtObjects.length).toBe(bos0);
        expect(g.orders.count).toBe(orders0);
        expect(g.rnd.drawCount).toBe(draws0);
        expect(stateDigest(g)).toBe(digest0);
    }, 300000);
});

describe('buildOrderTotalCost (Main.Part2.cs 929 method_632)', () => {
    it('sums amount × purchase price; maintenance skips the civilian rows', () => {
        const { galaxy: g, playerEmpire: e } = newGame();
        const esc = findNewestCanBuild(e.designs, BuiltObjectSubRole.Escort, e)!;
        const frt = findNewestCanBuild(e.designs, BuiltObjectSubRole.SmallFreighter, e)!;
        expect(frt).not.toBeNull();
        const r = buildOrderTotalCost(g, e, [esc, frt], [2, 3]);
        expect(r.total).toBe(0.0 + 2 * esc.calculateCurrentPurchasePrice(g) + 3 * frt.calculateCurrentPurchasePrice(g));
        expect(r.maintenance).toBe(0.0 + designCalculateMaintenanceCosts(g, esc, e) * 2);
        expect(buildOrderTotalCost(g, e, [], [])).toEqual({ total: 0, maintenance: 0 });
    }, 300000);
});
