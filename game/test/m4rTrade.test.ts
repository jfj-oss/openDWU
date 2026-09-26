// M4r — trade subsystem (Empire.7.cs EvaluateTradeOffer / DetermineOfferedTradeItems / ReviewDisputedTerritory /
// ReviewEnemyHelpEnlistment, Galaxy.4.cs GiveTradeableItem, Empire.3.cs 4378 OfferTrade deals). Hand-worked expectations.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import { DiplomaticRelationType, DiplomaticStrategy, obtainDiplomaticRelation, obtainEmpireEvaluation } from '../src/sim/diplomacy';
import { processMessages } from '../src/sim/diplomacyTick';
import { EmpireMessage, EmpireMessageType, sendEmpireMessage } from '../src/sim/messages';
import {
    TradeOfferResponse,
    TradeableItem,
    TradeableItemType,
    determineOfferedTradeItems,
    evaluateTradeOffer,
    extractHighOrderedItemsByType,
    reviewDisputedTerritory,
    reviewEnemyHelpEnlistment,
    tradeableItemsTotalValue,
} from '../src/sim/tradeItems';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

function meetAll(g: Galaxy): void {
    for (const a of g.empires) for (const b of g.empires) if (a !== b) obtainDiplomaticRelation(a, b).type = DiplomaticRelationType.None;
}

const item = (type: TradeableItemType, value: number, payload: unknown = null): TradeableItem => new TradeableItem(type, payload, value);

describe('TradeableItemList helpers', () => {
    it('ExtractHighOrderedItemsByType returns the matching items by descending value; TotalValue sums', () => {
        const list = [item(TradeableItemType.Colony, 300), item(TradeableItemType.Base, 900), item(TradeableItemType.Colony, 500)];
        expect(extractHighOrderedItemsByType(list, [TradeableItemType.Colony]).map((i) => i.value)).toEqual([500, 300]);
        expect(tradeableItemsTotalValue(list)).toBe(1700);
    });
});

describe('DetermineOfferedTradeItems (Empire.7.cs 2485)', () => {
    it('adds colonies (highest first) while under the value and under 1.5× the value', () => {
        const { galaxy } = cachedTickGame(gameData);
        const self = galaxy.empires[0];
        self.stateMoney = 0;
        const items = [item(TradeableItemType.Colony, 300), item(TradeableItemType.Colony, 500), item(TradeableItemType.Base, 200)];
        // num = (int)(600 × 1.5) = 900: 500 (<600) → 500; 300 → 800 (<900); 800 ≥ 600 stops.
        expect(determineOfferedTradeItems(self, 600, items, 6)!.map((i) => i.value)).toEqual([500, 300]);
    });

    it('tops up with 20% of state money, else returns null', () => {
        const { galaxy } = cachedTickGame(gameData);
        const self = galaxy.empires[0];
        self.stateMoney = 10000; // num2 = 2000 ≥ 1000 → Money 1000
        const r = determineOfferedTradeItems(self, 1000, [], 6)!;
        expect(r.length).toBe(1);
        expect(r[0].type).toBe(TradeableItemType.Money);
        expect(r[0].value).toBe(1000);
        self.stateMoney = 1000; // num2 = 200 → 200 < 1000 → null
        expect(determineOfferedTradeItems(self, 1000, [], 6)).toBeNull();
    });

    it('an EndWar/LiftTradeSanctions set worth [value, 1.5 value) is offered alone', () => {
        const { galaxy } = cachedTickGame(gameData);
        const self = galaxy.empires[0];
        const items = [item(TradeableItemType.EndWar, 1200), item(TradeableItemType.Colony, 5000)];
        expect(determineOfferedTradeItems(self, 1000, items, 6)!.map((i) => i.type)).toEqual([TradeableItemType.EndWar]);
    });
});

describe('EvaluateTradeOffer (Empire.7.cs 1779)', () => {
    it('refuses null / self offers', () => {
        const { galaxy } = cachedTickGame(gameData);
        const [a] = galaxy.empires;
        expect(evaluateTradeOffer(galaxy, a, null, [], [], true)).toBe(TradeOfferResponse.Refuse);
        expect(evaluateTradeOffer(galaxy, a, a, [], [], true)).toBe(TradeOfferResponse.Refuse);
    });

    it('a generous offer is accepted and raises the incident evaluation by sqrt(sqrt(sqrt(surplus))) − 1.37', () => {
        const { galaxy } = cachedTickGame(gameData);
        meetAll(galaxy);
        const [a, b] = galaxy.empires.filter((e) => e !== galaxy.playerEmpire);
        const ev = obtainEmpireEvaluation(galaxy, a, b);
        ev.incidentEvaluation = 0;
        const draws = galaxy.rnd.drawCount;
        const r = evaluateTradeOffer(galaxy, a, b, [item(TradeableItemType.Money, 5000, 5000)], [], true);
        expect(r).toBe(TradeOfferResponse.Accept);
        expect(ev.incidentEvaluationRaw).toBeCloseTo(Math.sqrt(Math.sqrt(Math.sqrt(5000))) - 1.37, 12);
        expect(galaxy.rnd.drawCount).toBe(draws);
    });

    it('a demand for nothing costs min(num / 5000, 15) incident evaluation and is refused as unfair (or accepted under pressure)', () => {
        const { galaxy } = cachedTickGame(gameData);
        meetAll(galaxy);
        const [a, b] = galaxy.empires.filter((e) => e !== galaxy.playerEmpire);
        const ev = obtainEmpireEvaluation(galaxy, a, b);
        ev.incidentEvaluation = 0;
        const race = a.dominantRace!;
        const val = Math.max(0.97, (100 + Math.trunc((race.aggression - race.friendliness) / 2)) / 100.0);
        const num = Math.trunc(10000 * val);
        const r = evaluateTradeOffer(galaxy, a, b, [], [item(TradeableItemType.TerritoryMap, 10000)], true);
        expect([TradeOfferResponse.RefuseUnfair, TradeOfferResponse.AcceptUnfair]).toContain(r);
        expect(ev.incidentEvaluationRaw).toBeCloseTo(-Math.min(num / 5000.0, 15.0), 12);
    });

    it('asking for the capital is critical: Refuse', () => {
        const { galaxy } = cachedTickGame(gameData);
        meetAll(galaxy);
        const [a, b] = galaxy.empires.filter((e) => e !== galaxy.playerEmpire);
        const r = evaluateTradeOffer(galaxy, a, b, [item(TradeableItemType.Money, 1e9, 1e9)], [item(TradeableItemType.Colony, 10, a.capital)], true);
        expect(r).toBe(TradeOfferResponse.Refuse);
    });
});

describe('ProcessMessages OfferTrade deal (Empire.3.cs 4384)', () => {
    it('an accepted deal transfers the items and clears the queue', () => {
        const { galaxy } = cachedTickGame(gameData);
        meetAll(galaxy);
        const [a, b] = galaxy.empires.filter((e) => e !== galaxy.playerEmpire);
        (b.messages as EmpireMessage[]).length = 0;
        a.stateMoney = 20000;
        const moneyA = a.stateMoney;
        const moneyB = b.stateMoney;
        sendEmpireMessage(new EmpireMessage(a, EmpireMessageType.OfferTrade, [[item(TradeableItemType.Money, 5000, 5000)], []]), b);
        processMessages(galaxy, b);
        expect(a.stateMoney).toBe(moneyA - 5000);
        expect(b.stateMoney).toBe(moneyB + 5000);
        expect(b.messages.length).toBe(0);
    });
});

describe('ReviewEnemyHelpEnlistment / ReviewDisputedTerritory (Empire.7.cs 2060 / 2205)', () => {
    it('help requests carry [offered, requested] with a DeclareWarOther item; runs are deterministic', () => {
        const run = (): { draws: number; offers: number } => {
            const { galaxy } = cachedTickGame(gameData);
            meetAll(galaxy);
            const [a, b] = galaxy.empires.filter((e) => e !== galaxy.playerEmpire);
            obtainDiplomaticRelation(a, b).type = DiplomaticRelationType.War;
            obtainDiplomaticRelation(b, a).type = DiplomaticRelationType.War;
            obtainDiplomaticRelation(a, b).strategy = DiplomaticStrategy.Conquer;
            for (const e of galaxy.empires) (e.messages as EmpireMessage[]).length = 0;
            const d0 = galaxy.rnd.drawCount;
            reviewEnemyHelpEnlistment(galaxy, a);
            reviewDisputedTerritory(galaxy, a);
            let offers = 0;
            for (const e of galaxy.empires) {
                for (const m of e.messages as EmpireMessage[]) {
                    if (m.messageType !== EmpireMessageType.OfferTrade || m.sender !== a) continue;
                    offers++;
                    expect(Array.isArray(m.subject)).toBe(true);
                    const [offered, requested] = m.subject as TradeableItem[][];
                    expect(Array.isArray(offered)).toBe(true);
                    expect(requested.length).toBe(1);
                    expect([TradeableItemType.DeclareWarOther, TradeableItemType.Colony, TradeableItemType.Base]).toContain(requested[0].type);
                }
            }
            return { draws: galaxy.rnd.drawCount - d0, offers };
        };
        const r1 = run();
        expect(run()).toEqual(r1);
    });
});
