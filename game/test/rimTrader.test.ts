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
} from '../src/sim/scenario/rimTrade/common';
import { rimTraderPortStock, rimTraderYear } from '../src/sim/scenario/rimTrade/rimTrader';
import { rimTraderTermsRows } from '../src/ui/scenario/rimTraderRows';

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

    it('creates the Concord when the random AI races did not pick it; inert when no ring home exists', () => {
        const { game: g1 } = createScenarioGame(base, { scenario: 'rimTrade' });
        const r = rimTraderEmpire(g1.galaxy)!;
        expect(r).not.toBeNull();
        expect(r.dominantRace!.name).toBe('Oranthi');
        expect(rimTradeState(g1.galaxy).empireId).toBe(r.empireId);
        const ov = loadScenarioOverlayFs('rimTrade');
        const noRing = { ...ov, manifest: { ...ov.manifest, homePlacement: [{ race: 'Oranthi', minRadius: 5, maxRadius: 6 }] } };
        const { game: g2 } = createScenarioGame(base, { scenario: noRing });
        expect(rimTradeState(g2.galaxy).empireId).toBe(-1);
        expect(rimTraderEmpire(g2.galaxy)).toBeNull();
        expect(g2.galaxy.empires.some((e) => e?.dominantRace?.name === 'Oranthi')).toBe(false);
    }, 600000);
});

describe('19a rim trader — ledger, access and AI rules', () => {
    let game: Game;
    let g: Galaxy;
    let r: Empire;
    let human: Empire;
    beforeAll(() => {
        game = rimGame();
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
        emit(human, r, rim, 3000);
        expect(rimTraderStanding(g, human.empireId)).toBe(3000);
        reviewRestrictedResourceTrading(g, r);
        expect(obtainDiplomaticRelation(r, human).supplyRestrictedResources).toBe(false);
        emit(human, r, rim, 2500);
        reviewRestrictedResourceTrading(g, r);
        expect(obtainDiplomaticRelation(r, human).supplyRestrictedResources).toBe(true);
        expect(count(EmpireMessageType.GeneralGoodEvent)).toBe(1);
        reviewRestrictedResourceTrading(g, r); // no flip, no second message
        expect(count(EmpireMessageType.GeneralGoodEvent)).toBe(1);
        emit(r, human, rare, 5000); // S = 500: stays open (≥ 0)
        reviewRestrictedResourceTrading(g, r);
        expect(obtainDiplomaticRelation(r, human).supplyRestrictedResources).toBe(true);
        emit(r, human, rare, 1000); // S = −500: closed
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
        expect(rimTraderStanding(g, human.empireId)).toBeGreaterThanOrEqual(5000);
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
        expect(rows.threshold).toBe(5000);
        expect(rimTraderTermsRows(g, g.empires.find((e) => e !== null && e !== r && e !== human)!)).not.toBeNull();
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
    it('two fresh games agree after a year; a save at 6 months resumes identically', () => {
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
    }, 1200000);

    it('with rimTrader off, no package code runs (the Oranthi are an ordinary AI)', () => {
        const game = rimGame({ rimTrader: false });
        runGameSeconds(game.galaxy, YEAR_LENGTH / 1000);
        expect('rimTrade' in game.galaxy.scenario!.state).toBe(false);
        expect(rimTraderEmpire(game.galaxy)).toBeNull();
        expect(game.galaxy.empires.some((e) => e?.dominantRace?.name === 'Oranthi')).toBe(true);
    }, 1200000);
});
