// Research trading: Galaxy.4.cs 4310 ResolveTradeableItemsResearchProjects / 4551 ValueResearchProjectForEmpire and the
// GiveTradeableItem ResearchProject case (Galaxy.4.cs 4005-4036), on a createGame galaxy (seed 1).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame } from './helpers/tickGame';
import type { GameData } from '../src/sim/data/gameData';
import { TradeableItem, TradeableItemType, giveTradeableItem, resolveTradeableItemsResearchProjects, valueResearchProjectForEmpire } from '../src/sim/tradeItems';
import { resolveMoreAdvancedProjectsIncludeSpecial } from '../src/sim/espionage';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

describe('research trading', () => {
    it('offers only self-researched projects the receiver can research next, valued > 0', () => {
        const g = createTickGame(gameData).galaxy;
        const [giver, receiver] = g.empires;
        const advanced = resolveMoreAdvancedProjectsIncludeSpecial(receiver, giver, false);
        const items = resolveTradeableItemsResearchProjects(g, giver, receiver, false, false);
        expect(items.length).toBeGreaterThan(0); // seed 1: 3 more-advanced projects, 1 tradeable
        for (const n of advanced) expect(valueResearchProjectForEmpire(g, n, receiver)).toBeGreaterThanOrEqual(0);
        for (const item of items) {
            expect(item.type).toBe(TradeableItemType.ResearchProject);
            expect(advanced).toContain(item.item);
            expect(item.value).toBeGreaterThan(0);
        }
    });

    it('GiveTradeableItem ResearchProject researches the equivalent receiver node (not self-researched)', () => {
        const g = createTickGame(gameData).galaxy;
        const [giver, receiver] = g.empires;
        const node = receiver.research.techTree.find((n) => !n.isResearched && receiver.research.canResearchNode(n))!;
        const giverNode = giver.research.techTree[node.def.projectId];
        giveTradeableItem(g, giver, receiver, new TradeableItem(TradeableItemType.ResearchProject, giverNode, 100), null);
        expect(node.isResearched).toBe(true);
        expect(node.selfResearched).toBe(false);
    });
});
