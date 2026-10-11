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
        expect(ids).toHaveLength(5);
        expect(g.resources.length).toBe(gameData.resources.length + 5);
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
        const held = ids.map((id) => R.heldAt(yard, id, e));
        // The yard's own goods (the smelter may sit at this very port): empty it for the baseline.
        yard.cargo!.items = yard.cargo!.items.filter((c) => !ids.includes(c.commodity.resourceId));
        expect(R.yardGoodsFactor(g, yard), JSON.stringify(held)).toBeCloseTo(0.95, 5);
        for (let i = 0; i < 4; i++) yard.cargo!.add(new Cargo(new ResourceRef(ids[i]), 60, e));
        expect(R.yardGoodsFactor(g, yard)).toBeCloseTo(1.2, 5);
    });

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
