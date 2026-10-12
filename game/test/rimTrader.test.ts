// Scenario 19a "rim trader" (tasks/19a-rim-trader.md §9): data overlay, rim placement, the Concord's rare goods, the
// standing ledger and restricted-trade gating, AI rules R1–R7, yearly handler, determinism + save, faithful path.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame, loadScenarioOverlayFs, scenarioGameData } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { CreateGameOptions } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import { BuiltObject } from '../src/sim/builtObject';
import { radiusFraction, scenarioEmit, scenarioText } from '../src/sim/scenario';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateDigest } from '../src/sim/tick/digest';
import { GalaxyTime, YEAR_LENGTH } from '../src/sim/galaxyTime';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import { DiplomaticRelation, DiplomaticRelationType, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { considerTreatyProposals, declareWar, offerMutualDefense } from '../src/sim/diplomacyTick';
import { reviewRestrictedResourceTrading, cargoGetCargo } from '../src/sim/logistics/orders';
import { generateValidTradingPosts } from '../src/sim/logistics/freight';
import { initiateContract, Contract } from '../src/sim/logistics/contracts';
import { prepareColonyLuxuryResourceLists } from '../src/sim/logistics/colonySupply';
import { Cargo, ResourceRef } from '../src/sim/cargo';
import { EmpireMessageType, empireMessages } from '../src/sim/messages';
import { submitProposal } from '../src/sim/player/diplomacyProposals';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { SystemVisibilityStatus } from '../src/sim/visibility';
import {
    RARE_GOODS,
    RIM_GOODS,
    isRimTraderAI,
    rareGoodIds,
    rimGoodIds,
    rimTradeState,
    rimTraderEmpire,
    rimTraderPort,
    rimTraderStanding,
    rimTraderImportBlocked,
} from '../src/sim/scenario/rimTrade/common';
import { rimTraderPortStock, rimTraderYear } from '../src/sim/scenario/rimTrade/rimTrader';
import { rimTraderTermsRows } from '../src/ui/scenario/rimTraderRows';
import { porcelainApproval, rareContractAvailable, rareGoodEffects, rareGoodEffectText, rareGoodResourceBonuses, rareGoodsFirst, rareOrderCandidates, rareOrderMinDevelopment } from '../src/sim/scenario/rimTrade/rareGoods';
import { concordFallbackHome } from '../src/sim/scenario/rimTrade/rimTrader';
import { galaxyResourceCurrentPrices } from '../src/sim/design';
import { requestTreasureStop, treasureStopRequests } from '../src/sim/scenario/rimTrade/treasureFleet';
import { ColonyResourceEffect } from '../src/sim/developmentLevel';
import { hasBloomTech, vbColony, vbEmpire, vbState, voidbloomId, voidbloomStock } from '../src/sim/scenario/voidbloom/common';
import { fallbackStarter, garrisonNeeded, garrisonOf, supplyTick, worldYield } from '../src/sim/scenario/voidbloom/supply';
import { onContract, spreadTick, treasuryDrain, voidbloomApproval, voidbloomContractAvailable } from '../src/sim/scenario/voidbloom/trade';
import { concordHarm, crackdownDue, crackdownYear } from '../src/sim/scenario/voidbloom/crackdown';
import { concordDeclineIndex, unequalTerms } from '../src/sim/scenario/voidbloom/treaty';
import { describeTerms, sanitiseTerms, termsValueFor } from '../src/sim/scenario/lively/peaceTerms';
import { makeHabitatIntoColonyRuntime } from '../src/sim/missions/cmdTroops';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const forceOranthi = (o: CreateGameOptions): CreateGameOptions => ({ ...o, aiEmpires: [{ ...o.aiEmpires[0], race: 'Oranthi' }, ...o.aiEmpires.slice(1)] });

function rimGame(flags: Record<string, boolean> = {}, params: Record<string, number> = {}): Game {
    return createScenarioGame(base, { scenario: 'rimTrade', flags, params, options: forceOranthi }).game;
}

/** Puts `a` and `b` in contact (relation None both ways), as first contact would. */
function meet(a: Empire, b: Empire): void {
    obtainDiplomaticRelation(a, b).type = DiplomaticRelationType.None;
    obtainDiplomaticRelation(b, a).type = DiplomaticRelationType.None;
}

function saveText(game: Game, scenario: { id: string; flags: Record<string, boolean>; params: Record<string, number> }): string {
    const time = new GalaxyTime();
    time.togglePause();
    time.advance(game.galaxy.nowMs);
    return serializeGame(game as never, time, { ...defaultStartGameOptions(), seed: 1, scenario });
}

describe('19a rim trader — data overlay', () => {
    it('adds the Oranthi race, its policy, the rim and rare goods; no overlay warnings', () => {
        const gd = scenarioGameData(base, 'rimTrade');
        expect(gd.scenario!.warnings).toEqual([]);
        const race = gd.races.find((r) => r.name === 'Oranthi')!;
        expect(race).toBeDefined();
        expect(race.expanding).toBe(true); // a non-expanding race would be reclusive (no restricted trade)
        expect(race.tradeBonus).toBe(40);
        expect(race.canBePirate).toBe(false);
        expect(gd.raceBiases.names.length).toBe(gd.races.length);
        const p = gd.policies!.get('Oranthi')!;
        expect(p.tradeWithOtherEmpires).toBe(true);
        expect(p.tradePriority).toBe(4);
        expect(p.controlRestrictedResourcesPriority).toBe(4);
        expect(p.researchPriority).toBe(2);
        expect(p.warWillingness).toBe(0.5);
        expect(p.alliancePriority).toBe(0.5);
        expect(p.colonizeContinentalPriority).toBe(0.5);
        expect(p.homeworldDefensePriority).toBe(4);
        expect(p.colonyTaxRateLargeColony).toBe(3);
        expect(p.diplomacySendGiftsUpToAmount).toBe(0);
        expect(p.warAttacksHarassEnemies).toBe(false);
        expect(p.buildPlanetDestroyers).toBe(false);
        const names = gd.resources.filter((r) => r.resourceId >= 41 && r.resourceId <= 46).map((r) => r.name);
        expect(names).toEqual([...RIM_GOODS, ...RARE_GOODS]);
        for (const n of RARE_GOODS) {
            const r = gd.resources.find((x) => x.name === n)!;
            expect(r.superLuxuryBonusAmount).toBeGreaterThan(0);
            expect(r.distributions.length).toBe(0);
        }
        expect(scenarioText('Scenario RimTrade Treaty Refused', 'X')).toBe('The X bind themselves to no one. They will accept only free trade.');
    });
});

describe('19a rim trader — game start', () => {
    let game: Game;
    beforeAll(() => {
        game = rimGame();
    }, 600000);

    it('places the Concord on the rim with its port and the rare goods only there', () => {
        const g = game.galaxy;
        const r = rimTraderEmpire(g)!;
        expect(r).not.toBeNull();
        expect(r.dominantRace!.name).toBe('Oranthi');
        expect(isRimTraderAI(g, r)).toBe(true);
        expect(radiusFraction(g, r.capital!.xpos, r.capital!.ypos)).toBeGreaterThanOrEqual(0.8);
        expect(g.resourceSystem.superLuxuryResources.map((x) => x.resourceId)).toEqual(expect.arrayContaining(rareGoodIds(g)));
        const rare = rareGoodIds(g);
        for (const h of g.habitats) {
            const has = h.resources.filter((x) => rare.includes(x.resourceId)).length;
            if (h === r.capital) expect(has).toBe(3);
            else expect(has).toBe(0);
        }
        expect(r.capital!.resources.length).toBeLessThanOrEqual(5);
        const port = rimTraderPort(g)!;
        expect(port).toBeInstanceOf(BuiltObject);
        for (const id of rare) expect(rimTraderPortStock(g, id)).toBeGreaterThanOrEqual(300);
    });

    it('rim goods lie only in the outer ring (none in the core)', () => {
        const g = game.galaxy;
        const rim = rimGoodIds(g);
        let count = 0;
        for (const h of g.habitats) {
            if (!h.resources.some((x) => rim.includes(x.resourceId))) continue;
            count++;
            expect(radiusFraction(g, h.xpos, h.ypos)).toBeGreaterThanOrEqual(0.72);
        }
        expect(count).toBeGreaterThan(10);
    });

    it('creates the Concord when the random AI races did not pick it; with no ring home, at the outermost free world', () => {
        const { game: g1 } = createScenarioGame(base, { scenario: 'rimTrade' });
        const r = rimTraderEmpire(g1.galaxy)!;
        expect(r).not.toBeNull();
        expect(r.dominantRace!.name).toBe('Oranthi');
        expect(rimTradeState(g1.galaxy).empireId).toBe(r.empireId);
        const ov = loadScenarioOverlayFs('rimTrade');
        const noRing = { ...ov, manifest: { ...ov.manifest, homePlacement: [{ race: 'Oranthi', minRadius: 5, maxRadius: 6 }] } };
        // 2026-10-11 placement fallback (concordFallbackHome): no world in the ring → the outermost free one; the add-on runs.
        const { game: g2 } = createScenarioGame(base, { scenario: noRing });
        const r2 = rimTraderEmpire(g2.galaxy)!;
        expect(r2).not.toBeNull();
        expect(rimTradeState(g2.galaxy).empireId).toBe(r2.empireId);
        expect(radiusFraction(g2.galaxy, r2.capital!.xpos, r2.capital!.ypos)).toBeGreaterThan(0.5);
    }, 600000);
});

describe('19a rim trader — ledger, access and AI rules', () => {
    let game: Game;
    let g: Galaxy;
    let r: Empire;
    let human: Empire;
    beforeAll(() => {
        // Price factor 1, exchange rate 1: these checks follow the stock contract values (the factor is tested in rimTraderConcord.test.ts).
        game = rimGame({}, { rimTraderRarePriceMult: 1, rimTraderExchangeRate: 1 });
        g = game.galaxy;
        r = rimTraderEmpire(g)!;
        human = g.playerEmpire!;
    }, 600000);

    it('R3: standing from rim-good sales opens restricted trade at the threshold and closes it when spent', () => {
        meet(r, human);
        const rim = rimGoodIds(g)[0];
        const rare = rareGoodIds(g)[0];
        const title = scenarioText('Scenario RimTrade Terms Title');
        const count = (type: EmpireMessageType) => empireMessages(human).filter((m) => m.title === title && m.messageType === type).length;
        const emit = (seller: Empire, buyer: Empire, resourceId: number, value: number) =>
            scenarioEmit(g, 'contractInitiated', { seller, buyer, sellingPoint: null, destination: null, resourceId, componentId: -1, amount: 100, value, isState: true, freighter: null });
        emit(human, r, rim, 1000);
        expect(rimTraderStanding(g, human.empireId)).toBe(1000);
        reviewRestrictedResourceTrading(g, r);
        expect(obtainDiplomaticRelation(r, human).supplyRestrictedResources).toBe(false);
        emit(human, r, rim, 5000);
        reviewRestrictedResourceTrading(g, r);
        expect(obtainDiplomaticRelation(r, human).supplyRestrictedResources).toBe(true);
        expect(count(EmpireMessageType.GeneralGoodEvent)).toBe(1);
        reviewRestrictedResourceTrading(g, r); // no flip, no second message
        expect(count(EmpireMessageType.GeneralGoodEvent)).toBe(1);
        emit(r, human, rare, 5000); // S = 1000: stays open (≥ 0)
        reviewRestrictedResourceTrading(g, r);
        expect(obtainDiplomaticRelation(r, human).supplyRestrictedResources).toBe(true);
        emit(r, human, rare, 1500); // S = −500: closed
        expect(rimTraderStanding(g, human.empireId)).toBe(-500);
        reviewRestrictedResourceTrading(g, r);
        expect(obtainDiplomaticRelation(r, human).supplyRestrictedResources).toBe(false);
        expect(count(EmpireMessageType.GeneralBadEvent)).toBe(1);
        // War / sanctions / pirates never get access.
        rimTradeState(g).ledger[human.empireId] = { credit: 1e6, debit: 0 };
        obtainDiplomaticRelation(r, human).type = DiplomaticRelationType.TradeSanctions;
        reviewRestrictedResourceTrading(g, r);
        expect(obtainDiplomaticRelation(r, human).supplyRestrictedResources).toBe(false);
        meet(r, human);
        rimTradeState(g).ledger[human.empireId] = { credit: 0, debit: 0 };
    });

    it('a player empire that supplies rim goods is paid, earns standing and gets the rare goods', () => {
        meet(r, human);
        const rim = rimGoodIds(g)[1];
        const seller = human.spacePorts[0] as BuiltObject;
        const freighter = (human.freighters as BuiltObject[])[0];
        expect(seller).toBeDefined();
        expect(freighter).toBeDefined();
        seller.cargo!.add(new Cargo(new ResourceRef(rim), 1000, human));
        const before = { human: human.stateMoney, r: r.stateMoney };
        const contract = new Contract(seller, 1000, rim, -1, r.empireId);
        contract.freighter = freighter;
        const value = 6000;
        initiateContract(g, r, seller, rimTraderPort(g) as BuiltObject, r, true, new ResourceRef(rim), null, value, contract, human, galaxyStarDate(g));
        expect(r.stateMoney).toBeCloseTo(before.r - value, 3);
        expect(human.stateMoney).toBeGreaterThan(before.human); // the seller's trade income (state share)
        expect(rimTradeState(g).ledger[human.empireId].credit).toBe(value);
        expect(rimTraderStanding(g, human.empireId)).toBeGreaterThanOrEqual(1500);
        reviewRestrictedResourceTrading(g, r);
        expect(obtainDiplomaticRelation(r, human).supplyRestrictedResources).toBe(true);
        // The player's colonies now see the Concord's rare goods as available restricted luxuries.
        const lists = prepareColonyLuxuryResourceLists(g, human);
        expect(lists.resourceList2.some((id) => rareGoodIds(g).includes(id))).toBe(true);
    });

    it('R1: the Concord never declares war, but others can declare war on it', () => {
        const other = g.empires.find((e) => e !== null && e !== r && e !== human && e.active && e.pirateEmpireBaseHabitat === null)!;
        meet(r, other);
        declareWar(g, r, other);
        expect(obtainDiplomaticRelation(r, other).type).toBe(DiplomaticRelationType.None);
        declareWar(g, other, r);
        expect(obtainDiplomaticRelation(r, other).type).toBe(DiplomaticRelationType.War);
    });

    it('R7: MDP proposals are refused (AI and player paths); the Concord never offers MDP', () => {
        meet(r, human);
        const now = galaxyStarDate(g);
        const other = g.empires.find((e) => e !== null && e !== r && e !== human && e.active && e.pirateEmpireBaseHabitat === null && obtainDiplomaticRelation(r, e).type !== DiplomaticRelationType.War)!;
        meet(r, other);
        r.proposedDiplomaticRelations.add(new DiplomaticRelation(DiplomaticRelationType.MutualDefensePact, other, other, r, now, false));
        considerTreatyProposals(g, r);
        expect(r.proposedDiplomaticRelations.count).toBe(0);
        expect(obtainDiplomaticRelation(r, other).type).toBe(DiplomaticRelationType.None);
        expect(empireMessages(other).some((m) => m.description === scenarioText('Scenario RimTrade Treaty Refused', r.name))).toBe(true);
        const before = human.proposedDiplomaticRelations.count;
        offerMutualDefense(g, r, human);
        expect(human.proposedDiplomaticRelations.count).toBe(before);
        const res = submitProposal(g, human, r, 'OFFER_MUTUALDEFENSE');
        expect(res.accepted).toBe(false);
        if (res.ok) {
            expect(res.reply).toBe('MUTUALDEFENSE_REJECT');
            expect(res.message).toBe(scenarioText('Scenario RimTrade Treaty Refused', r.name));
        }
        expect(obtainDiplomaticRelation(human, r).type).not.toBe(DiplomaticRelationType.MutualDefensePact);
    });

    it('R4/R5: the yearly handler consumes rim goods and orders up to the quota at the port', () => {
        const port = rimTraderPort(g) as BuiltObject;
        const rim = rimGoodIds(g);
        for (const id of rim) {
            const c = cargoGetCargo(port.cargo!, id, r);
            if (c !== null) c.amount = 250;
            else port.cargo!.add(new Cargo(new ResourceRef(id), 250, r));
        }
        rimTradeState(g).ledger[human.empireId] = { credit: 1000, debit: 400 };
        rimTraderYear(g);
        expect(rimTradeState(g).ledger[human.empireId]).toEqual({ credit: 500, debit: 200 }); // decay 0.5
        const orders = g.orders.getOrdersForBuiltObject(port).items;
        for (const id of rim) {
            expect(rimTraderPortStock(g, id)).toBe(50); // 250 − 200 consumed
            const outstanding = orders.filter((o) => o.commodityResource?.resourceId === id && o.isStateOrder).reduce((s, o) => s + o.amountOutstandingToContract, 0);
            expect(outstanding + 50).toBeGreaterThanOrEqual(400);
        }
        // Imports are bought from foreign sellers only.
        const imp = orders.find((o) => o.commodityResource?.resourceId === rim[0])!;
        expect(rimTraderImportBlocked(g, imp, r)).toBe(true);
        expect(rimTraderImportBlocked(g, imp, human)).toBe(false);
        const n = orders.length;
        rimTraderYear(g); // 50 more consumed per good: one top-up order each for the 50 units
        const after = g.orders.getOrdersForBuiltObject(port).items;
        expect(after.length).toBeLessThanOrEqual(n + rim.length);
        for (const id of rim) {
            expect(rimTraderPortStock(g, id)).toBe(0);
            const outstanding = after.filter((o) => o.commodityResource?.resourceId === id && o.isStateOrder).reduce((s, o) => s + o.amountOutstandingToContract, 0);
            expect(outstanding).toBeGreaterThanOrEqual(400);
        }
    });

    it('R6: a foreign empire sees at most one Concord trading post: its port', () => {
        meet(r, human);
        const port = rimTraderPort(g);
        for (const b of [...r.spacePorts, ...r.miningStations]) {
            const si = (b as BuiltObject).nearestSystemStar?.systemIndex;
            if (si !== undefined) human.visibility.systemVisibility[si].status = SystemVisibilityStatus.Explored;
        }
        const posts = generateValidTradingPosts(g, human, human).items.map((x) => x.stellarObject).filter((s) => s.empire === r);
        expect(posts.length).toBeLessThanOrEqual(1);
        expect(posts.every((p) => p === port)).toBe(true);
        expect(r.spacePorts.length + r.miningStations.length).toBeGreaterThan(1); // the rule filtered something
    });

    it('terms rows for the diplomacy screen', () => {
        meet(r, human);
        rimTradeState(g).ledger[human.empireId] = { credit: 2000, debit: 500 };
        const rows = rimTraderTermsRows(g, human)!;
        expect(rows.wanted.map((x) => x.name)).toEqual([...RIM_GOODS]);
        expect(rows.offered.map((x) => x.name)).toEqual([...RARE_GOODS]);
        expect(rows.standing).toBe(1500);
        expect(rows.threshold).toBe(1500);
        expect(rimTraderTermsRows(g, g.empires.find((e) => e !== null && e !== r && e !== human)!)).not.toBeNull();
    });
});

describe('19a rim trader — rare-good effects, ordering priority, treasure stop requests (2026-10-10)', () => {
    let g: Galaxy;
    let r: Empire;
    let human: Empire;
    beforeAll(() => {
        g = rimGame().galaxy;
        r = rimTraderEmpire(g)!;
        human = g.playerEmpire!;
    }, 600000);

    it('a colony holding a rare good: +20 development over the stock +30 (bonus 50), and that good\'s own effect', () => {
        const colony = human.capital!;
        const [porcelain, moonsilk, tea] = RARE_GOODS.map((n) => g.resourceSystem.resources.find((x) => x.name === n)!.resourceId);
        expect(g.resourceSystem.byId.get(porcelain)!.superLuxuryBonusAmount).toBe(50);
        expect(rareGoodEffects(g, colony)).toEqual([]);
        expect(porcelainApproval(g, colony)).toBeNull();
        colony.cargo!.add(new Cargo(new ResourceRef(porcelain), 50, human));
        colony.cargo!.add(new Cargo(new ResourceRef(moonsilk), 50, human));
        colony.cargo!.add(new Cargo(new ResourceRef(tea), 50, human));
        const fx = rareGoodEffects(g, colony);
        expect(fx.map((e) => [e.kind, e.value])).toEqual([['development', 20], ['approval', 8], ['income', 15], ['growth', 25]]);
        expect(porcelainApproval(g, colony)).toBe(8);
        const bonuses = rareGoodResourceBonuses(g, [], colony);
        expect(bonuses.map((b) => [b.effect, b.value])).toEqual([[ColonyResourceEffect.Development, 20], [ColonyResourceEffect.IncomeBoost, 15], [ColonyResourceEffect.PopulationGrowthRate, 25]]);
        expect(rareGoodEffectText(g, moonsilk)).toContain('colony income +15%');
        for (const id of [porcelain, moonsilk, tea]) cargoGetCargo(colony.cargo!, id, human)!.amount = 0;
    });

    it('ordering priority: the rare goods take the 3 restricted slots first while access is open and the port holds them', () => {
        meet(r, human);
        const rare = rareGoodIds(g);
        const stock = g.resourceSystem.superLuxuryResources.map((x) => x.resourceId).filter((id) => !rare.includes(id));
        expect(rareGoodsFirst(g, stock.slice(0, 3), human)).toEqual(stock.slice(0, 3)); // access shut: stock list
        obtainDiplomaticRelation(r, human).supplyRestrictedResources = true;
        expect(rareGoodsFirst(g, stock.slice(0, 3), human)).toEqual(rare); // 3 rare goods: all 3 slots
        // Ordering: the most-lacking rare good while any needs ordering, else the stock goods in the slots left.
        expect(rareOrderCandidates(g, stock, { available: [rare[0], stock[0], stock[1]], amountToOrder: () => 100 })).toEqual([rare[0]]);
        expect(rareOrderCandidates(g, stock, { available: [rare[0], stock[0], stock[1]], amountToOrder: () => 0 })).toEqual(stock.slice(0, 2));
        obtainDiplomaticRelation(r, human).supplyRestrictedResources = false;
    });

    it('reach and standing (2026-10-11): rare goods ordered from development 60; contracts capped by the buyer\'s standing', () => {
        const rare = rareGoodIds(g);
        expect(rareOrderMinDevelopment(g, 80, [rare[0]])).toBe(60);
        const stock = g.resourceSystem.superLuxuryResources.map((x) => x.resourceId).filter((id) => !rare.includes(id));
        expect(rareOrderMinDevelopment(g, 80, stock)).toBe(80);
        const price = galaxyResourceCurrentPrices(g)[rare[0]] * 1.5; // rimTraderRarePriceMult 1.5
        rimTradeState(g).ledger[human.empireId] = { credit: (price * 10.5) / 2.5, debit: 0 }; // rimTraderExchangeRate 2.5
        expect(rareContractAvailable(g, 500, { seller: r, buyer: human, resourceId: rare[0] })).toBe(10);
        rimTradeState(g).ledger[human.empireId] = { credit: 0, debit: 100 };
        expect(rareContractAvailable(g, 500, { seller: r, buyer: human, resourceId: rare[0] })).toBe(0);
        expect(rareContractAvailable(g, 500, { seller: r, buyer: r, resourceId: rare[0] })).toBe(500); // its own colonies
        expect(rareContractAvailable(g, 500, { seller: human, buyer: r, resourceId: rare[0] })).toBe(500);
        rimTradeState(g).ledger[human.empireId] = { credit: 0, debit: 0 };
    });

    it('placement fallback: the outermost free native-type world when the ring has none', () => {
        const helpers = { randomPointInRing: () => ({ x: 0, y: 0 }), inNebula: () => false };
        const h = concordFallbackHome(g, r.dominantRace!.nativeHabitatType, helpers)!;
        expect(h).not.toBeNull();
        expect(h.empire).toBeNull();
        expect(h.type).toBe(r.dominantRace!.nativeHabitatType);
    });

    it('requestTreasureStop: only the empire\'s own space port; the player\'s stop is in the next circuit only on request', () => {
        const mine = human.spacePorts.find((p) => p !== null && !p.hasBeenDestroyed && p.isSpacePort)!;
        const theirs = g.empires.find((e) => e !== null && e !== r && e !== human && e.spacePorts.length > 0)!.spacePorts[0];
        expect(requestTreasureStop(g, human, theirs)).toBe(false);
        meet(r, human);
        expect(treasureStopRequests(g, r, r.capital!).some((q) => q.empire === human)).toBe(false);
        expect(requestTreasureStop(g, human, mine)).toBe(true);
        const q = treasureStopRequests(g, r, r.capital!).find((x) => x.empire === human)!;
        expect(q.port).toBe(mine);
        expect(q.player).toBe(true);
        // One port per empire.
        const owners = treasureStopRequests(g, r, r.capital!).map((x) => x.empire);
        expect(new Set(owners).size).toBe(owners.length);
    });
});

describe('19a rim trader — AI colony cap', () => {
    it('R2: at the cap the Concord has no colonization targets', () => {
        const game = rimGame({}, { rimTraderMaxColonies: 1 });
        const g = game.galaxy;
        const r = rimTraderEmpire(g)!;
        runGameSeconds(g, 130);
        expect(r.colonies.length).toBeGreaterThanOrEqual(1);
        expect(r.colonizationTargets).toEqual([]);
    }, 600000);
});

describe('19a rim trader — determinism, save, faithful path', () => {
    it('two fresh games agree after a year; a save at 6 months resumes identically', { tags: ['slow'], timeout: 1200000 }, () => {
        const a = rimGame();
        const b = rimGame();
        runGameSeconds(a.galaxy, YEAR_LENGTH / 2000);
        const text = saveText(a, { id: 'rimTrade', flags: { rimTrader: true, rimTraderSinglePort: true }, params: {} });
        runGameSeconds(a.galaxy, YEAR_LENGTH / 2000);
        runGameSeconds(b.galaxy, YEAR_LENGTH / 1000);
        expect(stateDigest(a.galaxy)).toBe(stateDigest(b.galaxy));
        const loaded = deserializeGame(text, scenarioGameData(base, 'rimTrade'));
        expect(rimTradeState(loaded.game.galaxy).empireId).toBe(rimTradeState(a.galaxy).empireId);
        runGameSeconds(loaded.game.galaxy, YEAR_LENGTH / 2000);
        expect(stateDigest(loaded.game.galaxy)).toBe(stateDigest(a.galaxy));
        expect(JSON.stringify(rimTradeState(loaded.game.galaxy).ledger)).toBe(JSON.stringify(rimTradeState(a.galaxy).ledger));
    });

    it('with rimTrader off, no package code runs (the Oranthi are an ordinary AI)', () => {
        const game = rimGame({ rimTrader: false });
        runGameSeconds(game.galaxy, YEAR_LENGTH / 1000);
        expect('rimTrade' in game.galaxy.scenario!.state).toBe(false);
        expect(rimTraderEmpire(game.galaxy)).toBeNull();
        expect(game.galaxy.empires.some((e) => e?.dominantRace?.name === 'Oranthi')).toBe(true);
    }, 1200000);
});

// ---------------------------------------------------------------------------------------------------------------
// The Voidbloom War (docs/VOIDBLOOM_WAR.md): a Rim add-on on top of the Concord.
// ---------------------------------------------------------------------------------------------------------------
describe('The Voidbloom War', () => {
    let game: Game;
    let g: Galaxy;
    const vbFlags = { rimTrader: true, voidbloom: true };
    beforeAll(() => {
        game = createScenarioGame(base, { scenario: 'voidbloom', flags: vbFlags, params: { voidbloomWorlds: 3 }, options: forceOranthi }).game;
        g = game.galaxy;
    }, 1200000);

    it('picks rim Voidbloom worlds at game start and clears every starting stock', () => {
        const st = vbState(g);
        expect(st.worlds.length).toBe(3);
        for (const w of st.worlds) {
            expect(w.habitat.empire).toBeNull();
            expect(radiusFraction(g, w.habitat.xpos, w.habitat.ypos)).toBeGreaterThanOrEqual(0.7);
            expect(w.habitat.baseQuality).toBeGreaterThanOrEqual(0.55);
        }
        const id = voidbloomId(g);
        expect(id).toBeGreaterThan(0);
        expect(g.habitats.some((h) => h?.cargo?.items.some((c) => c.commodity.resourceId === id) === true)).toBe(false);
    });

    it('the supply gate: no grower and no cartel before a tech-4 hostile-environment project', () => {
        const st = vbState(g);
        const normal = g.empires.filter((x) => x !== null && x !== rimTraderEmpire(g) && x !== g.independentEmpire && x.dominantRace !== null);
        expect(normal.some((x) => hasBloomTech(g, x!))).toBe(false);
        // No fixed year: decades on, the cartel still waits for somebody's research.
        g.nowMs += 30 * YEAR_LENGTH;
        fallbackStarter(g, 30);
        g.nowMs -= 30 * YEAR_LENGTH;
        expect(st.cartel).toBeNull();
        expect(st.gateOpened ?? -1).toBeLessThan(0);
        // A worked world grows nothing without the tech.
        const w = st.worlds[0];
        const e = g.empires.find((x) => x !== null && x !== rimTraderEmpire(g) && x !== g.independentEmpire && x !== g.playerEmpire && x.dominantRace !== null && x.colonies.length > 0)!;
        makeHabitatIntoColonyRuntime(g, e, w.habitat, e, e.dominantRace!, 30_000_000);
        expect(worldYield(g, w)).toBe(0);
        // Biological Workshops (Habitation, tech 4) opens it; the cartel clock starts with the first such empire.
        const node = e.research.techTree.find((n) => n.def.category === 8 && n.def.techLevel === 4 && n.def.facilityId != null)!;
        expect(node).toBeDefined();
        node.isResearched = true;
        expect(hasBloomTech(g, e)).toBe(true);
        expect(worldYield(g, w)).toBeGreaterThan(0);
        fallbackStarter(g, 1);
        expect(st.gateOpened).toBeGreaterThan(0);
        expect(st.cartel).toBeNull(); // a world is worked, and the gate has stood open less than voidbloomFallbackYear
    });

    it('a colony on a world harvests it; the climate kills; garrison levies; labour convoys sail', () => {
        const w = vbState(g).worlds[0];
        const e = w.habitat.empire!;
        e.stateMoney += 200_000;
        const pop0 = w.habitat.population.totalAmount;
        supplyTick(g);
        expect(voidbloomStock(g, w.habitat)).toBeGreaterThan(0);
        expect(w.habitat.population.totalAmount).toBeLessThan(pop0);
        expect(garrisonOf(w.habitat)).toBeGreaterThanOrEqual(1);
        expect(garrisonNeeded(g, w.habitat)).toBeGreaterThanOrEqual(2);
        expect(worldYield(g, w)).toBeGreaterThan(0);
    });

    it('legal and black-market sellers: only smugglers sell into the Concord; a banning empire sells none', () => {
        const r = rimTraderEmpire(g)!;
        const id = voidbloomId(g);
        const seller = vbState(g).worlds[0].habitat.empire!;
        vbEmpire(g, seller).policy = 'legal';
        expect(voidbloomContractAvailable(g, 100, { seller, buyer: r, resourceId: id })).toBe(0);
        vbEmpire(g, seller).policy = 'smuggle';
        expect(voidbloomContractAvailable(g, 100, { seller, buyer: r, resourceId: id })).toBe(100);
        vbEmpire(g, seller).policy = 'ban';
        expect(voidbloomContractAvailable(g, 100, { seller, buyer: g.independentEmpire, resourceId: id })).toBe(0);
        expect(voidbloomContractAvailable(g, 100, { seller: g.independentEmpire, buyer: r, resourceId: id })).toBe(100);
        vbEmpire(g, seller).policy = 'smuggle';
    });

    it('a black-market sale drains the Concord: premium, the state share, the smugglers\' cut, the first taste', () => {
        const r = rimTraderEmpire(g)!;
        const seller = vbState(g).worlds[0].habitat.empire!;
        const dest = r.colonies[0];
        const s0 = r.stateMoney;
        const p0 = r.privateMoney;
        const ss0 = seller.stateMoney;
        onContract(g, { seller, buyer: r, destination: dest, resourceId: voidbloomId(g), amount: 100, value: 12_000, freighter: null });
        // The export duty: the seller's state takes 35 % of the total from its private sector.
        expect(seller.stateMoney).toBeCloseTo(ss0 + 21_000 * 0.35, 3);
        expect(vbEmpire(g, seller).duty).toBeCloseTo(21_000 * 0.35, 3);
        const st = vbState(g);
        expect(st.stats.blackSales).toBe(100);
        // The Concord's state carries 35 % (others 15 %).
        expect(st.stats.stateDrain).toBeCloseTo(21_000 * 0.35, 3);
        expect(r.stateMoney).toBeCloseTo(s0 - 21_000 * 0.35, 3);
        expect(r.privateMoney).toBeLessThan(p0);
        expect(st.arcStarted).toBeGreaterThan(0);
        expect(vbColony(g, dest).tasted).toBeGreaterThan(0);
    });

    it('the spread reaches the Concord\'s Canton market first; supplied colonies grow addicted', () => {
        const r = rimTraderEmpire(g)!;
        for (let i = 0; i < 6; i++) spreadTick(g);
        const c = vbColony(g, r.colonies[0]);
        expect(c.a).toBeGreaterThan(0);
        expect(voidbloomApproval(g, r.colonies[0])).not.toBeNull();
        // The court's habit: a share of the treasury itself, paid to the sellers.
        const seller = vbState(g).worlds[0].habitat.empire!;
        const s0 = r.stateMoney;
        const p0 = seller.privateMoney;
        const out = treasuryDrain(g);
        expect(out).toBeGreaterThan(0);
        expect(out).toBeLessThan(s0 * 0.25 / 12 + 1);
        expect(r.stateMoney).toBeCloseTo(s0 - out, 3);
        expect(seller.privateMoney).toBeGreaterThan(p0);
    });

    it('the tolerance phase: small harm is tolerated; a new leader past the panic line starts a moral panic', () => {
        const r = rimTraderEmpire(g)!;
        const st = vbState(g);
        const saved = r.colonies.map((h) => vbColony(g, h).a);
        const drains = st.drainByYear.splice(0);
        for (const h of r.colonies) vbColony(g, h).a = 0.05;
        expect(concordHarm(g)).toBeLessThan(0.55);
        st.concordLeader = 'Someone Else';
        expect(crackdownDue(g)).toBe(''); // the officials look away, whoever rules
        for (const h of r.colonies) vbColony(g, h).a = 0.2;
        const harm = concordHarm(g);
        expect(harm).toBeGreaterThanOrEqual(0.55);
        expect(harm).toBeLessThan(1);
        st.concordLeader = 'Someone Else';
        if (r.leader !== null) expect(crackdownDue(g)).toBe('panic:leader');
        expect(st.crackdownStarted).toBeLessThan(0);
        st.drainByYear.push(...drains);
        r.colonies.forEach((h, i) => (vbColony(g, h).a = saved[i]));
    });

    it('the crackdown: a commissioner and a crisis the AI answers; inspections seize cargo', () => {
        const r = rimTraderEmpire(g)!;
        for (const h of r.colonies) vbColony(g, h).a = 0.5;
        const seller = vbState(g).worlds[0].habitat.empire!;
        crackdownYear(g);
        const st = vbState(g);
        expect(st.crackdownStarted).toBeGreaterThan(0);
        expect(st.commissioner).not.toBeNull();
        const cd = st.crackdowns.find((c) => c.targetId === seller.empireId)!;
        expect(cd).toBeDefined();
        expect(['tolerated', 'war', 'paid', 'backedDown']).toContain(cd.status);
        expect(st.stats.crises).toBeGreaterThanOrEqual(1);
    });

    it('unequal-treaty terms: Concord-only extra terms survive sanitising and count in the terms\' value', () => {
        const r = rimTraderEmpire(g)!;
        const e = vbState(g).worlds[0].habitat.empire!;
        const res = unequalTerms(g, e, r, 1000, false);
        expect(res.extra.map((x) => x.kind)).toContain('voidbloom.legalise');
        const t = { cede: [], reparations: null, demilitarise: null, release: null, extra: [...res.extra, { kind: 'voidbloom.toll', from: e, to: r }] };
        const clean = sanitiseTerms(g, t, e, r);
        expect(clean.extra!.every((x) => x.from === r)).toBe(true);
        expect(termsValueFor(g, clean, e)).toBeGreaterThan(0);
        expect(describeTerms(clean).length).toBe(clean.extra!.length);
        expect(concordDeclineIndex(g)).toBeGreaterThanOrEqual(0);
    });

    it('saves and loads its state identically', () => {
        const scenario = { id: 'voidbloom', flags: vbFlags, params: { voidbloomWorlds: 3 } };
        const text = saveText(game, scenario);
        const loaded = deserializeGame(text, scenarioGameData(base, 'voidbloom'));
        expect(saveText(loaded.game, scenario)).toBe(text);
        expect(vbState(loaded.game.galaxy).worlds.length).toBe(3);
    }, 1200000);

    it('with voidbloom off nothing runs: no state, no Voidbloom worlds', () => {
        const off = createScenarioGame(base, { scenario: 'voidbloom', flags: { rimTrader: true, voidbloom: false }, options: forceOranthi }).game;
        runGameSeconds(off.galaxy, YEAR_LENGTH / 4000);
        expect('voidbloom' in off.galaxy.scenario!.state).toBe(false);
    }, 1200000);
});
