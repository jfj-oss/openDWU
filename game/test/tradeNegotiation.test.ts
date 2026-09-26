// Task 17e2: the player's trade negotiation (src/sim/player/tradeNegotiation.ts) against the C# — the DiplomacyTradeTree
// item lists (DistantWorlds.Controls/Controls/DiplomacyTradeTree.cs Reset / PopulateTradeableItems / MouseClick over
// Galaxy.4.cs:4406 ResolveTradeableItems), Empire.7.cs:1779 EvaluateTradeOffer, Main.Part10.cs:4334 DEAL_OFFER and
// Galaxy.4.cs:3857 GiveTradeableItem — on the harness game.
import { beforeEach, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { GameData } from '../src/sim/data/gameData';
import type { TechNode } from '../src/sim/researchSystem';
import { DiplomaticRelationType, obtainDiplomaticRelation, obtainEmpireEvaluation } from '../src/sim/diplomacy';
import { aggressionLevel, friendlinessLevel } from '../src/sim/diplomacyTick';
import {
    TradeableItem,
    TradeableItemType,
    TradeOfferResponse,
    evaluateTradeOffer,
    isTechNode,
    refactorValueForEmpire,
    tradeableItemsTotalValue,
    valueEndWarAgainstUs,
    valueGalaxyMapForEmpire,
    valueTerritoryMapForEmpire,
} from '../src/sim/tradeItems';
import {
    addTradeItem,
    beginTradeNegotiation,
    clearTradeItems,
    offerDealOptions,
    offeredItemsValue,
    removeTradeItem,
    submitTradeOffer,
    tradeItemLabel,
    tradeTreeRows,
    tradeableItems,
    type TradeNegotiation,
    type TradeTree,
} from '../src/sim/player/tradeNegotiation';
import { submitProposal } from '../src/sim/player/diplomacyProposals';
import { SystemVisibilityStatus } from '../src/sim/visibility';

let gameData: GameData;
let galaxy: Galaxy;
let player: Empire;
let ai: Empire;

function setRelation(a: Empire, b: Empire, type: DiplomaticRelationType): void {
    for (const [x, y] of [[a, b], [b, a]] as const) {
        const r = obtainDiplomaticRelation(x, y);
        r.type = type;
        r.initiator = a;
        r.locked = false;
    }
}

/** Pin `of`'s OverallAttitude towards `to` (EmpireEvaluation.OverallAttitude is derived; the gates only read it). */
function setAttitude(of: Empire, to: Empire, value: number): void {
    Object.defineProperty(obtainEmpireEvaluation(galaxy, of, to), 'overallAttitude', { get: () => value, configurable: true });
}

const types = (l: readonly TradeableItem[]): TradeableItemType[] => [...new Set(l.map((t) => t.type))];
const node = (e: Empire, t: TradeableItem): TechNode => e.research.techTree[(t.item as TechNode).def.projectId];
const rowItems = (tree: TradeTree): TradeableItem[] => tradeTreeRows(galaxy, tree).flatMap((g) => g.rows.map((r) => r.item));
const findRow = (tree: TradeTree, pred: (t: TradeableItem) => boolean): TradeableItem => rowItems(tree).find(pred)!;
const moneyRow = (tree: TradeTree, amount: number): TradeableItem => findRow(tree, (t) => t.type === TradeableItemType.Money && t.item === amount);

/** Empire.7.cs:1795-1797: the acceptance factor max(0.97, (100 + (Aggression - Friendliness) / 2) / 100). */
function acceptFactor(e: Empire): number {
    return Math.max(0.97, (100 + Math.trunc((aggressionLevel(e) - friendlinessLevel(e)) / 2)) / 100.0);
}

/** Add money lines to `tree` until the offered money reaches `amount` (largest listed line first). */
function offerMoney(tree: TradeTree, amount: number): void {
    const lines = [100000, 10000, 1000, 100, 10];
    let guard = 0;
    while (offeredItemsValue(tree) < amount && guard++ < 1000) {
        const need = amount - offeredItemsValue(tree);
        const line = lines.find((l) => l <= need) ?? 10;
        expect(addTradeItem(galaxy, tree, moneyRow(tree, line))).toBe(true);
    }
}

beforeEach(async () => {
    gameData ??= await loadGameDataFs();
    galaxy = cachedTickGame(gameData).galaxy;
    player = galaxy.playerEmpire!;
    // An AI that drives a harder bargain than face value (acceptance factor > 1) and wants one of the player's techs.
    ai = galaxy.empires.find(
        (e) =>
            e !== player && e.pirateEmpireBaseHabitat === null && e !== galaxy.independentEmpire && e.active &&
            aggressionLevel(e) - friendlinessLevel(e) >= 10,
    )!;
    ai.reclusive = false;
    setRelation(player, ai, DiplomaticRelationType.None);
});

describe('tradeable item lists (DiplomacyTradeTree.Reset → ResolveTradeableItems)', () => {
    it('our side: money lines, both maps unrefactored, our techs they lack, both threats (includeAllItems)', () => {
        const { us } = tradeableItems(galaxy, player, ai);
        const money = us.filter((t) => t.type === TradeableItemType.Money);
        expect(money.map((t) => [t.item, t.value])).toEqual([[10, 10], [100, 100], [1000, 1000], [10000, 10000], [100000, 100000]]);
        expect(us.find((t) => t.type === TradeableItemType.TerritoryMap)!.value).toBe(valueTerritoryMapForEmpire(galaxy, player, ai));
        expect(us.find((t) => t.type === TradeableItemType.GalaxyMap)!.value).toBe(valueGalaxyMapForEmpire(galaxy, player, ai));
        const techs = us.filter((t) => t.type === TradeableItemType.ResearchProject);
        expect(techs.length).toBeGreaterThan(0);
        for (const t of techs) {
            expect(isTechNode(t.item)).toBe(true);
            expect(node(player, t).isResearched && node(player, t).selfResearched).toBe(true);
            expect(node(ai, t).isResearched).toBe(false);
            expect(t.value).toBeGreaterThan(0);
        }
        expect(types(us)).toContain(TradeableItemType.ThreatenWar);
        expect(types(us)).toContain(TradeableItemType.ThreatenTradeSanctions);
        expect(types(us)).not.toContain(TradeableItemType.EndWar);
    });

    it('their side: maps from attitude 5, techs from 25 (x difficulty), special techs from 50; no rnd', () => {
        expect(obtainEmpireEvaluation(galaxy, ai, player).overallAttitude).toBeLessThan(5);
        const before = galaxy.rnd.drawCount;
        expect(types(tradeableItems(galaxy, player, ai).them)).toEqual([TradeableItemType.Money, TradeableItemType.ThreatenWar, TradeableItemType.ThreatenTradeSanctions]);
        setAttitude(ai, player, 5);
        expect(types(tradeableItems(galaxy, player, ai).them)).toEqual([TradeableItemType.Money, TradeableItemType.TerritoryMap, TradeableItemType.GalaxyMap, TradeableItemType.ThreatenWar, TradeableItemType.ThreatenTradeSanctions]);
        setAttitude(ai, player, 25 * galaxy.difficultyLevel);
        const them = tradeableItems(galaxy, player, ai).them;
        const techs = them.filter((t) => t.type === TradeableItemType.ResearchProject);
        expect(techs.length).toBeGreaterThan(0);
        for (const t of techs) {
            expect(node(ai, t).isResearched && node(ai, t).selfResearched).toBe(true);
            expect(node(player, t).isResearched).toBe(false);
        }
        // Maps are refactored for the player (Galaxy.4.cs:4377 with refactorValuesForEmpire).
        expect(them.find((t) => t.type === TradeableItemType.TerritoryMap)!.value).toBe(refactorValueForEmpire(galaxy, valueTerritoryMapForEmpire(galaxy, ai, player), player, ai));
        setAttitude(ai, player, 50 * galaxy.difficultyLevel);
        expect(tradeableItems(galaxy, player, ai).them.filter((t) => t.type === TradeableItemType.ResearchProject).length).toBeGreaterThanOrEqual(techs.length);
        expect(galaxy.rnd.drawCount).toBe(before);
    });

    it('colonies: only a disputed colony in a system the player dominates (BaconGalaxy.cs:165, tradeEverything off)', () => {
        setAttitude(ai, player, 30);
        expect(types(tradeableItems(galaxy, player, ai).them)).not.toContain(TradeableItemType.Colony);
        const colony = ai.colonies.find((c) => c !== ai.capital) ?? ai.colonies[0];
        const star = galaxy.determineHabitatSystemStar(colony);
        const sys = galaxy.systems[star.systemIndex];
        sys.dominantEmpire = { empire: player, colonyCount: 1, totalStrategicValue: 0 };
        sys.otherEmpires = [{ empire: ai, colonyCount: 1, totalStrategicValue: 0 }];
        player.visibility.setSystemVisibility(star, SystemVisibilityStatus.Explored);
        const colonies = tradeableItems(galaxy, player, ai).them.filter((t) => t.type === TradeableItemType.Colony);
        expect(colonies.map((t) => t.item)).toContain(colony);
        const rows = tradeTreeRows(galaxy, beginTradeNegotiation(galaxy, player, ai, 'trade')!.them);
        expect(rows.find((g) => g.heading === 'Disputed Colonies')!.rows[0].label.text).toMatch(/^Trade Description Colony NAME PLANETTYPE SYSTEMNAME\|/);
    });

    it('tree rows: an AI keeps max(10,000, 10%) back from the money lines; maps and threats exclude each other once offered', () => {
        ai.stateMoney = 28000;
        player.stateMoney = 50000;
        setAttitude(ai, player, 5);
        const n = beginTradeNegotiation(galaxy, player, ai, 'trade')!;
        const money = (t: TradeTree): unknown[] => tradeTreeRows(galaxy, t)[0].rows.map((r) => r.item.item);
        expect(money(n.them)).toEqual([10, 100, 1000, 10000]); // <= 28,000 - 10,000
        expect(money(n.us)).toEqual([10, 100, 1000, 10000]); // the player keeps nothing back: <= 50,000
        const headings = (t: TradeTree): string[] => tradeTreeRows(galaxy, t).map((g) => g.heading);
        expect(headings(n.them)).not.toContain('Threaten War unless you agree');
        expect(headings(n.us).slice(-2)).toEqual(['Threaten Trade Sanctions unless you agree', 'Threaten War unless you agree']);
        addTradeItem(galaxy, n.them, findRow(n.them, (t) => t.type === TradeableItemType.TerritoryMap));
        expect(rowItems(n.them).some((t) => t.type === TradeableItemType.GalaxyMap || t.type === TradeableItemType.TerritoryMap)).toBe(false);
        addTradeItem(galaxy, n.us, findRow(n.us, (t) => t.type === TradeableItemType.ThreatenWar));
        expect(headings(n.us)).not.toContain('Threaten Trade Sanctions unless you agree');
        expect(removeTradeItem(n.us, 0)).toBe(true);
        expect(headings(n.us)).toContain('Threaten Trade Sanctions unless you agree');
    });

    it('money selection: an AI gives at most StateMoney - max(20,000, 30%); lines accumulate into one entry', () => {
        ai.stateMoney = 28000;
        player.stateMoney = 50000;
        const n = beginTradeNegotiation(galaxy, player, ai, 'trade')!;
        expect(addTradeItem(galaxy, n.them, moneyRow(n.them, 10000))).toBe(true);
        expect(n.them.selected.map((t) => [t.item, t.value])).toEqual([[8000, 8000]]); // 28,000 - 20,000
        expect(addTradeItem(galaxy, n.them, moneyRow(n.them, 10))).toBe(true);
        expect(n.them.selected.map((t) => [t.item, t.value])).toEqual([[8000, 8000]]); // capped again
        for (let i = 0; i < 6; i++) addTradeItem(galaxy, n.us, moneyRow(n.us, 10000));
        expect(n.us.selected.map((t) => [t.item, t.value])).toEqual([[50000, 50000]]); // all of the player's 50,000
        expect(offeredItemsValue(n.us)).toBe(50000);
        expect(tradeItemLabel(galaxy, n.us.selected[0])).toEqual({ text: 'Trade Description Money|50,000', value: null });
        clearTradeItems(n.us);
        expect(n.us.selected).toEqual([]);
    });
});

describe('proposing (Main.Part10.cs:4334 DEAL_OFFER → Empire.7.cs:1779 EvaluateTradeOffer)', () => {
    function techDeal(): { n: TradeNegotiation; tech: TradeableItem } {
        setAttitude(ai, player, 25 * galaxy.difficultyLevel);
        const n = beginTradeNegotiation(galaxy, player, ai, 'trade')!;
        const tech = findRow(n.them, (t) => t.type === TradeableItemType.ResearchProject);
        expect(addTradeItem(galaxy, n.them, tech)).toBe(true);
        return { n, tech };
    }

    it('a lopsided offer is refused: 10 credits for a tech (offered > 0 and requested/offered >= 0.5 → Refuse), nothing moves, no rnd', () => {
        const { n, tech } = techDeal();
        addTradeItem(galaxy, n.us, moneyRow(n.us, 10));
        const pm = player.stateMoney;
        const am = ai.stateMoney;
        const before = galaxy.rnd.drawCount;
        const r = submitTradeOffer(galaxy, n);
        expect(r).toMatchObject({ ok: true, response: TradeOfferResponse.Refuse, accepted: false, reply: 'DEAL_REJECT', nextOptionLabel: 'Would you accept this trade?' });
        expect(galaxy.rnd.drawCount).toBe(before);
        expect([player.stateMoney, ai.stateMoney]).toEqual([pm, am]);
        expect(node(player, tech).isResearched).toBe(false);
    });

    it('an offer between face value and value x acceptance factor asks for more (PromptForImprovement)', () => {
        const { n, tech } = techDeal();
        const f = acceptFactor(ai);
        expect(f).toBeGreaterThan(1.0);
        player.stateMoney = tech.value * 3 + 100000;
        offerMoney(n.us, tech.value);
        expect(offeredItemsValue(n.us)).toBeLessThan(Math.trunc(tech.value * f));
        const r = submitTradeOffer(galaxy, n);
        expect(r).toMatchObject({ ok: true, response: TradeOfferResponse.PromptForImprovement, reply: 'DEAL_IMPROVE', nextOptionLabel: 'How about this trade then?' });
        expect(node(player, tech).isResearched).toBe(false);
    });

    it('a generous offer is accepted: the tech joins the player\'s research (not self-researched, out of the queues) and the money moves', () => {
        const { n, tech } = techDeal();
        const f = acceptFactor(ai);
        const num = Math.trunc(tech.value * f); // Empire.7.cs:1797
        player.stateMoney = tech.value * 3 + 100000;
        offerMoney(n.us, num);
        const offered = offeredItemsValue(n.us);
        expect(offered).toBeGreaterThanOrEqual(num);
        const pm = player.stateMoney;
        const am = ai.stateMoney;
        const ev = obtainEmpireEvaluation(galaxy, ai, player);
        const incident = ev.incidentEvaluationRaw;
        const r = submitTradeOffer(galaxy, n);
        expect(r).toMatchObject({ ok: true, response: TradeOfferResponse.Accept, accepted: true, reply: 'DEAL_ACCEPT', nextOptionLabel: '' });
        expect(player.stateMoney).toBeCloseTo(pm - offered, 6);
        expect(ai.stateMoney).toBeCloseTo(am + offered, 6);
        const pn = node(player, tech);
        expect(pn.isResearched).toBe(true);
        expect(pn.selfResearched).toBe(false);
        const q = player.research;
        for (const queue of [q.researchQueueEnergy, q.researchQueueHighTech, q.researchQueueWeapons]) expect(queue.some((x) => x.def.projectId === pn.def.projectId)).toBe(false);
        // Empire.7.cs:1949-1956: a surplus of 1,000+ pleases them by surplus^(1/8) - 1.37.
        const surplus = offered - num;
        if (surplus >= 1000) expect(ev.incidentEvaluationRaw).toBeCloseTo(Math.min(80, incident + (Math.sqrt(Math.sqrt(Math.sqrt(surplus))) - 1.37)), 9);
        else expect(ev.incidentEvaluationRaw).toBe(incident);
    });

    it('money moves the other way: the player sells a tech for their money', () => {
        ai.stateMoney = 28000;
        const n = beginTradeNegotiation(galaxy, player, ai, 'trade')!;
        const tech = findRow(n.us, (t) => t.type === TradeableItemType.ResearchProject);
        addTradeItem(galaxy, n.us, tech);
        addTradeItem(galaxy, n.them, moneyRow(n.them, 10000)); // capped at 8,000
        expect(tech.value).toBeGreaterThanOrEqual(Math.trunc(8000 * acceptFactor(ai)));
        const pm = player.stateMoney;
        const r = submitTradeOffer(galaxy, n);
        expect(r.reply).toBe('DEAL_ACCEPT');
        expect(player.stateMoney).toBeCloseTo(pm + 8000, 6);
        expect(ai.stateMoney).toBeCloseTo(20000, 6);
        expect(node(ai, tech).isResearched).toBe(true);
    });

    it('their capital is never on the table (CheckForCriticalTradeItems → Refuse) whatever the price', () => {
        const capital = ai.capital!;
        const requested = [new TradeableItem(TradeableItemType.Colony, capital, 1000)];
        const offered = [new TradeableItem(TradeableItemType.Money, 1e9, 1_000_000_000)];
        expect(evaluateTradeOffer(galaxy, ai, player, offered, requested, true)).toBe(TradeOfferResponse.Refuse);
        expect(tradeableItemsTotalValue(offered)).toBe(1_000_000_000);
    });

    it('a stale pick is refused: money no longer there', () => {
        const n = beginTradeNegotiation(galaxy, player, ai, 'trade')!;
        player.stateMoney = 20000;
        addTradeItem(galaxy, n.us, moneyRow(n.us, 10000));
        player.stateMoney = 5000;
        expect(submitTradeOffer(galaxy, n)).toMatchObject({ ok: false, reply: null, message: 'No longer on offer' });
    });
});

describe('negotiated end of war (Main.Part9.cs:229 DEAL_BEGIN with RelatedInfo)', () => {
    it('their EndWar is a required item valued ValueEndWarAgainstUs refactored; ours is hidden; paying enough ends the war', () => {
        setRelation(player, ai, DiplomaticRelationType.War);
        const res = submitProposal(galaxy, player, ai, 'DEAL_BEGIN:end-war');
        expect(res).toMatchObject({ ok: true, reply: 'DEAL_BEGIN' });
        const n = res.trade!;
        expect(n.kind).toBe('end-war');
        const value = refactorValueForEmpire(galaxy, valueEndWarAgainstUs(galaxy, ai, player), player, ai);
        expect(n.them.selected.map((t) => [t.type, t.item, t.value])).toEqual([[TradeableItemType.EndWar, ai, value]]);
        expect(removeTradeItem(n.them, 0)).toBe(false);
        clearTradeItems(n.them);
        expect(n.them.selected.length).toBe(1);
        expect(tradeTreeRows(galaxy, n.us).map((g) => g.heading)).not.toContain('End War with Your Empire');
        player.stateMoney = value * 3 + 100000;
        offerMoney(n.us, Math.trunc(value * acceptFactor(ai)));
        const r = submitTradeOffer(galaxy, n);
        expect(r.reply).toBe('DEAL_ACCEPT');
        expect(obtainDiplomaticRelation(player, ai).type).toBe(DiplomaticRelationType.None);
        expect(obtainDiplomaticRelation(ai, player).type).toBe(DiplomaticRelationType.None);
        // The war is over: the negotiation cannot be proposed again.
        expect(submitTradeOffer(galaxy, n).ok).toBe(false);
    });
});

describe('"Swap maps or tech" (OFFER_DEAL, Main.Part9.cs:273 / Main.Part10.cs:4230-4323)', () => {
    it('lists the two map swaps and up to three techs to sell; the reply is OFFER_DEAL_RESPONSE', () => {
        const res = submitProposal(galaxy, player, ai, 'OFFER_DEAL');
        expect(res).toMatchObject({ ok: true, reply: 'OFFER_DEAL_RESPONSE' });
        const opts = offerDealOptions(galaxy, player, ai);
        expect(res.followUps.map((o) => o.id)).toEqual(opts.map((o) => o.id));
        expect(opts.slice(0, 2).map((o) => [o.id, o.cost])).toEqual([
            ['OFFER_DEAL_TERRITORYMAP', valueTerritoryMapForEmpire(galaxy, player, ai)],
            ['OFFER_DEAL_GALAXYMAP', valueGalaxyMapForEmpire(galaxy, player, ai)],
        ]);
        expect(opts.length).toBeLessThanOrEqual(5);
    });

    it('territory maps: refused below attitude 5; accepted above it when our map is worth 75% of theirs, both sides explore', () => {
        expect(submitProposal(galaxy, player, ai, 'OFFER_DEAL_TERRITORYMAP')).toMatchObject({ ok: true, accepted: false, reply: 'DEAL_REJECT' });
        setAttitude(ai, player, 10);
        const theirValue = Math.trunc(refactorValueForEmpire(galaxy, valueTerritoryMapForEmpire(galaxy, ai, player), player, ai) * 0.75);
        const ours = valueTerritoryMapForEmpire(galaxy, player, ai);
        const r = submitProposal(galaxy, player, ai, 'OFFER_DEAL_TERRITORYMAP');
        expect(r.accepted).toBe(ours >= theirValue);
        if (r.accepted) {
            expect(r.reply).toBe('DEAL_ACCEPT');
            const star = galaxy.determineHabitatSystemStar(ai.capital!);
            expect(player.visibility.checkSystemExplored(star.systemIndex)).toBe(true);
        }
    });

    it('selling a tech: one NextDouble, the buyer researches it and pays the price', () => {
        // Techs are offered from the player's own attitude 25 towards them (ResolveTradeableItems(player, other), not includeAllItems).
        expect(offerDealOptions(galaxy, player, ai).some((o) => o.part === 'OFFER_DEAL_COMPONENT')).toBe(false);
        setAttitude(player, ai, 25);
        const opt = offerDealOptions(galaxy, player, ai).find((o) => o.part === 'OFFER_DEAL_COMPONENT')!;
        ai.stateMoney = opt.cost + 5000;
        const pm = player.stateMoney;
        const before = galaxy.rnd.drawCount;
        const r = submitProposal(galaxy, player, ai, opt.id);
        expect(r).toMatchObject({ ok: true, accepted: true, reply: 'DEAL_ACCEPT' });
        expect(galaxy.rnd.drawCount).toBeGreaterThanOrEqual(before + 1);
        expect(ai.stateMoney).toBeCloseTo(5000, 6);
        expect(player.stateMoney).toBeCloseTo(pm + opt.cost, 6);
        expect(node(ai, opt.item).isResearched).toBe(true);
        // Too dear: refused without a draw.
        const opt2 = offerDealOptions(galaxy, player, ai).find((o) => o.part === 'OFFER_DEAL_COMPONENT');
        if (opt2 !== undefined) {
            ai.stateMoney = opt2.cost - 1;
            const b2 = galaxy.rnd.drawCount;
            expect(submitProposal(galaxy, player, ai, opt2.id)).toMatchObject({ accepted: false, reply: 'DEAL_REJECT' });
            expect(galaxy.rnd.drawCount).toBe(b2);
        }
    });
});

describe('trade panel helpers ([tradenego] tradePanel.ts)', () => {
    it('label text appends the value; reply class follows the result', async () => {
        const { tradeLabelText, tradeReplyClass } = await import('../src/ui/screens/tradePanel');
        expect(tradeLabelText({ text: 'Gravitic Weapons', value: 284292 })).toBe('Gravitic Weapons (284,292)');
        expect(tradeLabelText({ text: 'Money', value: null })).toBe('Money');
        expect(tradeReplyClass(null)).toBe('trade-reply');
        const n = beginTradeNegotiation(galaxy, player, ai, 'trade')!;
        addTradeItem(galaxy, n.us, moneyRow(n.us, 10));
        expect(tradeReplyClass(submitTradeOffer(galaxy, n))).toBe('trade-reply trade-reply-accepted');
    });
});
