import { describe, expect, it } from 'vitest';
import { computeEconomyBreakdown } from '../src/sim/economyBreakdown';
import { economyBlockRows } from '../src/ui/screens/empireSummary';
import { cachedTickGame } from './helpers/gameCache';
import { loadGameDataFs } from './helpers/loadGameDataFs';

describe('economy breakdown', async () => {
    const gameData = await loadGameDataFs();
    const galaxy = cachedTickGame(gameData, { seconds: 30 }).galaxy;
    const empire = galaxy.playerEmpire!;

    it('lines sum to the totals and cashflow = income - expenses', () => {
        const b = computeEconomyBreakdown(galaxy, empire);
        const s = (a: { value: number }[]) => a.reduce((x, l) => x + l.value, 0);
        expect(b.state.totalIncome).toBeCloseTo(s(b.state.income));
        expect(b.state.totalExpenses).toBeCloseTo(s(b.state.expenses));
        expect(b.state.cashflow).toBeCloseTo(b.state.totalIncome - b.state.totalExpenses);
        expect(b.private.cashflow).toBeCloseTo(s(b.private.income) - s(b.private.expenses));
        expect(b.state.income.map((l) => l.label)).toEqual(['Colony Tax Revenue', 'Tribute From Others']);
        expect(b.state.expenses.map((l) => l.label)).toEqual(['Ship & Base Maintenance', 'Troop Maintenance', 'Facility Maintenance', 'Fuel Costs', 'Subjugation Tribute', 'Pirate Protection']);
        expect(b.private.expenses.map((l) => l.label)).toEqual(['Colony Taxes', 'Ship & Base Maintenance', 'Fuel Costs']);
        expect(economyBlockRows(b).length).toBeGreaterThan(15);
    });

    it('does not change sim state', () => {
        const snap = () =>
            JSON.stringify({
                m: [empire.stateMoney, empire.privateMoney, empire.useAveragedVariableIncome, empire.lastResortIncomeAddDate, empire.thisYearsResortIncomeValue],
                b: [...empire.spacePorts, ...empire.miningStations].map((b) => [b.currentYearsIncome, b.consecutiveUnprofitableYears, b.dateOfLastIncome]),
                p: empire.pirateRelations?.count ?? 0,
            });
        const before = snap();
        computeEconomyBreakdown(galaxy, empire);
        computeEconomyBreakdown(galaxy, empire);
        expect(snap()).toBe(before);
    });
});

// ---------------------------------------------------------------------------------------------------------------
// Colony Economy add-on (scenarios/colony-economy; docs/ECONOMY.md): flag-off identity, designations, facilities,
// bonds and the effect channels.
// ---------------------------------------------------------------------------------------------------------------
describe('Colony Economy add-on', async () => {
    const { createScenarioGame } = await import('./helpers/scenarioGame');
    const { cachedTickGameRun } = await import('./helpers/gameCache');
    const { runGameSeconds } = await import('../src/sim/tick/harness');
    const { stateDigest } = await import('../src/sim/tick/digest');
    const E = await import('../src/sim/scenario/colonyEconomy/index');
    const { BOND_RULES, bondQuote, outstanding } = await import('../src/sim/scenario/colonyEconomy/bonds');
    const { constructionFactor, colonyBonuses, extractionFactor } = await import('../src/sim/scenario/colonyEconomy/effects');
    const { scenarioQuery } = await import('../src/sim/scenario/hooks');
    const { ColonyResourceEffect } = await import('../src/sim/developmentLevel');
    const gameData = await loadGameDataFs();
    const SC = 'colony-economy';
    const ALL_OFF = { colonyEconomy: false, econDesignations: false, econFacilities: false, econBonds: false, econRefinement: false };
    const ON = { colonyEconomy: true, econDesignations: true, econFacilities: true, econBonds: true, econRefinement: true };

    it('flags off: byte-identical to the plain seed-1 game (digest, Rnd stream, no state)', () => {
        const ref = cachedTickGameRun(gameData, { seconds: 900 });
        const { game } = createScenarioGame(gameData, { scenario: SC, flags: ALL_OFF });
        expect(Object.keys(game.galaxy.scenario!.flags).sort()).toEqual(Object.keys(ALL_OFF).sort());
        runGameSeconds(game, 900);
        expect(stateDigest(game.galaxy)).toBe(stateDigest(ref.game.galaxy));
        expect(game.galaxy.rnd.drawCount).toBe(ref.game.galaxy.rnd.drawCount);
        expect(E.ECON_STATE_KEY in game.galaxy.scenario!.state).toBe(false);
        expect(Object.keys(game.galaxy.scenario!.periodicLast)).toEqual([]);
    }, 1200000);

    function econGame() {
        return createScenarioGame(gameData, { scenario: SC, flags: ON }).game;
    }

    it('designations: cooldown, refusal, effects through the stock channels', () => {
        const g = econGame().galaxy;
        const e = g.playerEmpire!;
        const h = e.capital!;
        expect(E.suggestDesignation(g, h).designation).toBe(E.Designation.CoreWorld);
        expect(constructionFactor(g, h, 'yard')).toBe(1);
        expect(E.setDesignation(g, e, h, E.Designation.Industrial)).toBe(true);
        expect(E.designationOf(g, h)).toBe(E.Designation.Industrial);
        expect(constructionFactor(g, h, 'yard')).toBeCloseTo(1.25, 5);
        expect(scenarioQuery(g, 'colonyConstructionFactor', 1, { habitat: h, kind: 'colony' })).toBeCloseTo(1.25, 5);
        // Locked for the cooldown.
        expect(E.designationCooldownDays(g, h)).toBeGreaterThan(1000);
        expect(E.setDesignation(g, e, h, E.Designation.TradeHub)).toBe(false);
        // A foreign colony is refused.
        const other = g.empires.find((x) => x !== e && x.capital !== null && x.pirateEmpireBaseHabitat === null)!;
        expect(E.designationRefusal(g, e, other.capital!, E.Designation.Resort)).not.toBeNull();
        // Trade Hub income goes through the IncomeBoost resource bonus.
        E.colonyRecord(g, h).changedAt = -1;
        expect(E.setDesignation(g, e, h, E.Designation.TradeHub)).toBe(true);
        const b = colonyBonuses(g, h);
        expect(b.some((x) => x.effect === ColonyResourceEffect.IncomeBoost && x.value > 0)).toBe(true);
        // Mining Hub: own stations nearby mine faster.
        E.colonyRecord(g, h).changedAt = -1;
        E.setDesignation(g, e, h, E.Designation.MiningHub);
        E.bumpEcon(g);
        const st = e.miningStations.find((m) => m !== null && Math.hypot(m.xpos - h.xpos, m.ypos - h.ypos) < 2_000_000);
        if (st !== undefined) expect(extractionFactor(g, st)).toBeGreaterThan(1);
    });

    it('facilities: designation only, slots, exclusive pairs, requests built from the private surplus', () => {
        const game = econGame();
        const g = game.galaxy;
        const e = g.playerEmpire!;
        const h = e.capital!;
        // No designation → nothing can be requested.
        expect(E.requestFacility(g, e, h, 'tradeExchange')).toBe(false);
        E.setDesignation(g, e, h, E.Designation.TradeHub);
        // Off-designation is impossible.
        expect(E.requestFacility(g, e, h, 'university')).toBe(false);
        expect(E.requestFacility(g, e, h, 'freePort')).toBe(true);
        // Free Port XOR Customs Bureau.
        expect(E.requestFacility(g, e, h, 'customsBureau')).toBe(false);
        const slots = E.colonySlots(g, h);
        expect(slots).toBeGreaterThanOrEqual(1);
        e.privateMoney = 2_000_000;
        runGameSeconds(game, 120);
        const rec = E.colonyRecord(g, h);
        expect(rec.facilities.map((f) => f.id)).toContain('freePort');
        expect(rec.requests).not.toContain('freePort');
        expect(rec.facilities.length).toBeLessThanOrEqual(slots);
        expect(rec.facilities.every((f) => E.facilityDef(f.id).designation === E.Designation.TradeHub)).toBe(true);
        // A change closes the facilities of the old designation.
        rec.changedAt = -1;
        expect(E.facilitiesLostByChange(g, h, E.Designation.Resort).length).toBe(rec.facilities.length);
        E.setDesignation(g, e, h, E.Designation.Resort);
        expect(E.colonyRecord(g, h).facilities.length).toBe(0);
    }, 300000);

    it('phase 2: the new exclusive pairs, and working facilities act through the stock channels', () => {
        const g = econGame().galaxy;
        const e = g.playerEmpire!;
        const h = e.capital!;
        E.setDesignation(g, e, h, E.Designation.TradeHub);
        expect(E.requestFacility(g, e, h, 'blackMarket')).toBe(true);
        expect(E.requestFacility(g, e, h, 'customsBureau')).toBe(false);
        const rec = E.colonyRecord(g, h);
        rec.requests = [];
        rec.changedAt = -1;
        E.setDesignation(g, e, h, E.Designation.Resort);
        rec.facilities.push({ id: 'spaceportCasino', progress: 1, started: 1, finished: 1, cost: 1, requested: false, unpaidSince: 0 });
        expect(E.requestFacility(g, e, h, 'naturePreserve')).toBe(false);
        // A working casino raises corruption (Habitat.cs 763 through colonyCorruptionFactor).
        E.bumpEcon(g);
        expect(scenarioQuery(g, 'colonyCorruptionFactor', 1, { habitat: h })).toBeGreaterThan(1);
        rec.facilities = [];
        rec.changedAt = -1;
        E.setDesignation(g, e, h, E.Designation.Frontier);
        rec.facilities.push({ id: 'fortressBunker', progress: 1, started: 1, finished: 1, cost: 1, requested: false, unpaidSince: 0 });
        E.bumpEcon(g);
        expect(scenarioQuery(g, 'colonyFortressBonus', 0, { habitat: h })).toBeGreaterThan(0);
        expect(scenarioQuery(g, 'colonyTaxRevenue', 1000, { habitat: h, empire: e })).toBe(1000);
        rec.facilities.push({ id: 'frontierCharter', progress: 1, started: 1, finished: 1, cost: 1, requested: false, unpaidSince: 0 });
        E.bumpEcon(g);
        expect(scenarioQuery(g, 'colonyTaxRevenue', 1000, { habitat: h, empire: e })).toBeLessThan(1000);
    });

    it('refinement: the goods exist only with the flag on; a smelter refines; yards build slower without goods, faster with', async () => {
        const R = await import('../src/sim/scenario/colonyEconomy/refinement');
        const off = createScenarioGame(gameData, { scenario: SC, flags: { ...ON, econRefinement: false } }).game.galaxy;
        expect(R.goodIds(off)).toBeNull();
        expect(off.resources.length).toBe(gameData.resources.length);
        const g = econGame().galaxy;
        const ids = R.goodIds(g)!;
        expect(ids).toHaveLength(6);
        expect(g.resources.length).toBe(gameData.resources.length + 6);
        const e = g.playerEmpire!;
        const h = e.capital!;
        E.setDesignation(g, e, h, E.Designation.MiningHub);
        E.colonyRecord(g, h).facilities.push({ id: 'smelter', progress: 1, started: 1, finished: 1, cost: 1, requested: false, unpaidSince: 0 });
        E.bumpEcon(g);
        const post = R.tradingPostOf(h);
        const steel = g.resources.find((r) => r.name === 'Steel')!.resourceId;
        const { Cargo, ResourceRef } = await import('../src/sim/cargo');
        post.cargo!.add(new Cargo(new ResourceRef(steel), 100, e));
        const before = R.heldAt(post, ids[0], e);
        R.refinementTick(g);
        expect(R.heldAt(post, ids[0], e)).toBeGreaterThan(before);
        const yard = e.spacePorts.find((b) => b !== null && b.isShipYard)!;
        // The yard's own goods (the smelter may sit at this very port): empty it for the baseline.
        yard.cargo!.items = yard.cargo!.items.filter((c) => !ids.includes(c.commodity.resourceId));
        // Phase 4: need by component tech level (0-2 none; 3-4 soft; 5-6 hard ×2 (+1 Electronics for weapons); 7+ hard).
        const { ComponentCategoryType: CC } = await import('../src/sim/data/policies');
        const fake = (comps: { techLevel: number; category: number }[], role = 0) => ({ components: comps, role }) as unknown as import('../src/sim/design').Design;
        expect(R.designNeed(fake([{ techLevel: 2, category: CC.Armor }])).any).toBe(false);
        const soft = fake([{ techLevel: 3, category: CC.Armor }, { techLevel: 4, category: CC.Armor }]);
        expect(R.designNeed(soft).soft[0]).toBe(2);
        expect(R.buildGoodsFactor(g, e, yard, soft)).toBeCloseTo(0.65, 5); // nothing held: (0.3 + 0.4) / 2
        yard.cargo!.add(new Cargo(new ResourceRef(ids[0]), 1, e));
        expect(R.buildGoodsFactor(g, e, yard, soft)).toBeCloseTo(0.825, 5); // half supplied: the penalty halves
        const hard = fake([{ techLevel: 5, category: CC.WeaponBeam }]);
        expect(R.designNeed(hard).hard[1]).toBe(3); // 2 + 1 Electronics
        expect(R.buildGoodsFactor(g, e, yard, hard)).toBe(0); // waits
        yard.cargo!.add(new Cargo(new ResourceRef(ids[1]), 3, e));
        expect(R.buildGoodsFactor(g, e, yard, hard)).toBe(1);
        const top = R.designNeed(fake([{ techLevel: 7, category: CC.Reactor }]));
        expect([top.hard[3], top.hard[4], top.hard[5]]).toEqual([4, 1, 1]);
        // Bases need half.
        expect(R.designNeed(fake([{ techLevel: 5, category: CC.Armor }, { techLevel: 5, category: CC.Armor }], 8)).hard[0]).toBe(2);
        // Early bonus: a design needing nothing builds up to 15 % faster with the common goods in stock.
        E.empireRecord(g, e).early = true;
        for (let i = 0; i < 4; i++) yard.cargo!.add(new Cargo(new ResourceRef(ids[i]), 60, e));
        expect(R.buildGoodsFactor(g, e, yard, fake([]))).toBeCloseTo(1.15, 5);
        // Refinery slot: a Mining Hub's extra slot takes a refinery beside full normal slots.
        const rec = E.colonyRecord(g, h);
        const slots = E.colonySlots(g, h);
        rec.facilities = [{ id: 'smelter', progress: 1, started: 1, finished: 1, cost: 1, requested: false, unpaidSince: 0 }];
        for (const id of ['miningConsortium', 'orbitalWarehouse', 'gasRefinery'].slice(0, slots)) rec.facilities.push({ id: id as 'miningConsortium', progress: 1, started: 1, finished: 1, cost: 1, requested: false, unpaidSince: 0 });
        expect(E.slotsUsed(E.Designation.MiningHub, rec.facilities.map((f) => f.id)).normal).toBe(slots);
        // Commission: the treasury funds a refinery request.
        rec.facilities = [];
        e.stateMoney = 10_000_000;
        expect(E.requestFacility(g, e, h, 'fuelRefinery', true)).toBe(true);
        expect(rec.commissioned).toContain('fuelRefinery');
    });

    it('phase 4: the AI falls back to a design it can supply; militia; Mining Hubs diminish; facility tax', async () => {
        const S = await import('../src/sim/scenario/colonyEconomy/supply');
        const B = await import('../src/sim/scenario/colonyEconomy/bounty');
        const { ComponentCategoryType: CC } = await import('../src/sim/data/policies');
        const game = econGame();
        const g = game.galaxy;
        const { canBuildDesign } = await import('../src/sim/designGeneration');
        const RR = await import('../src/sim/scenario/colonyEconomy/refinement');
        const e = g.playerEmpire!;
        const real = e.designs.find((d) => d.role === 1 && !RR.designNeed(d).anyHard && canBuildDesign(e, d, true, null))!;
        expect(real).toBeDefined();
        // A newer design of the same sub-role needing hard goods nobody makes: the AI queues the older one instead.
        const hard = { components: [{ techLevel: 5, category: CC.WeaponBeam, componentId: -1 }], role: 1, subRole: real.subRole, dateCreated: 1e15, isPlanetDestroyer: false } as unknown as import('../src/sim/design').Design;
        const ids = RR.goodIds(g)!;
        for (const y of e.spacePorts) if (y !== null && y.cargo !== null) y.cargo.items = y.cargo.items.filter((c) => !ids.includes(c.commodity.resourceId)); // the start-up stockpiles
        expect(S.canSupply(g, e, hard)).toBe(false);
        const pick = S.suppliableDesign(g, e, hard);
        expect(pick).not.toBe(hard);
        expect(pick.subRole).toBe(real.subRole);
        expect(S.suppliableDesign(g, e, real)).toBe(real);
        // Militia Yard: 2 ships per working yard.
        const h = e.colonies.find((c) => c !== e.capital) ?? e.capital!;
        E.colonyRecord(g, h).designation = E.Designation.Frontier;
        E.colonyRecord(g, h).facilities.push({ id: 'militiaYard', progress: 1, started: 1, finished: 1, cost: 1, requested: false, unpaidSince: 0 });
        e.privateMoney = 1_000_000;
        expect(B.militiaCap(g, e)).toBe(2);
        // Each further Mining Hub of the empire scores less for a colony not yet a hub.
        const p = g.playerEmpire!;
        const cap = p.capital!;
        const mh0 = E.designationScores(g, cap).find((x) => x.designation === E.Designation.MiningHub)!.score;
        const others = p.colonies.filter((c) => c !== cap);
        if (others.length > 0 && mh0 > 4) {
            for (const c of others) E.colonyRecord(g, c).designation = E.Designation.MiningHub;
            expect(E.designationScores(g, cap).find((x) => x.designation === E.Designation.MiningHub)!.score).toBeLessThan(mh0);
        }
        // Facility tax: a working facility moves a share of its price a year from private money to the state.
        const rec = E.colonyRecord(g, cap);
        rec.designation = E.Designation.CoreWorld;
        rec.facilities = [{ id: 'university', progress: 1, started: 1, finished: 1, cost: 900_000, requested: false, unpaidSince: 0 }];
        p.privateMoney = 5_000_000;
        E.empireRecord(g, p).autoFacilities = false;
        runGameSeconds(game, 120);
        expect(E.peekEmpire(g, p)!.facilityTax ?? 0).toBeGreaterThan(0);
    }, 300000);

    it('a torn-down or scrapped private ship leaves every private list (bounty hunters, company stations)', async () => {
        const { builtObjectCompleteTeardown } = await import('../src/sim/combat/teardown');
        const game = econGame();
        const g = game.galaxy;
        const e = g.empires.find((x) => x.privateBuiltObjects.filter((b) => b !== null && b.builtAt === null && b.role !== 0).length >= 2 && x.spacePorts.length > 0)!;
        const [a, b] = e.privateBuiltObjects.filter((x) => x !== null && x.builtAt === null && x.role !== 0);
        // Listed by a second empire too (a company's station): teardown takes it out of both.
        const other = g.empires.find((x) => x !== e)!;
        other.privateBuiltObjects.push(a);
        builtObjectCompleteTeardown(g, a);
        expect(e.privateBuiltObjects.includes(a) || other.privateBuiltObjects.includes(a)).toBe(false);
        // Scrapped at a yard (a retired hunter): ConstructionQueue.cs 584 tears it down with its empire's lists.
        const yard = e.spacePorts[0]!;
        b.dockedAt = yard;
        expect((yard.constructionQueue as { addBuiltObjectToScrap(o: unknown): boolean }).addBuiltObjectToScrap(b)).toBe(true);
        for (let i = 0; i < 40 && !b.hasBeenDestroyed; i++) runGameSeconds(game, 3);
        expect(b.hasBeenDestroyed).toBe(true);
        expect(e.privateBuiltObjects.includes(b)).toBe(false);
    }, 300000);

    it('bonds: limits, money moves between the private sector and the treasury, repayment', () => {
        const g = econGame().galaxy;
        const e = g.playerEmpire!;
        e.privateMoney = 5_000_000;
        const q = bondQuote(g, e);
        expect(q.refusal).toBeNull();
        expect(q.max).toBeGreaterThanOrEqual(BOND_RULES.MIN_BOND);
        const s0 = e.stateMoney;
        const p0 = e.privateMoney;
        const b = E.issueBond(g, e, 10_000_000)!;
        expect(b).not.toBeNull();
        expect(b.principal).toBeLessThanOrEqual(q.max);
        expect(e.stateMoney - s0).toBeCloseTo(b.principal, 3);
        expect(p0 - e.privateMoney).toBeCloseTo(b.principal, 3);
        // One issue per gap.
        expect(E.issueBond(g, e, 10_000)).toBeNull();
        expect(outstanding(E.peekEmpire(g, e))).toBeCloseTo(b.principal, 3);
        expect(E.repayBond(g, e, b.id)).toBe(true);
        expect(outstanding(E.peekEmpire(g, e))).toBe(0);
    });
});

describe('Colony Economy skill table', async () => {
    const { SKILL } = await import('../src/sim/scenario/colonyEconomy/common');
    const { CharacterSkillType } = await import('../src/sim/characters');
    it('matches CharacterSkillType', () => {
        for (const [k, v] of Object.entries(SKILL)) expect(CharacterSkillType[k as keyof typeof CharacterSkillType], k).toBe(v);
    });
});
