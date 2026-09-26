// 19d2 Resource crises (tasks/19d2-resource-crises.md §7): unit tests of the propagation formulas and harness tests on the
// seed-1 game with the `resource-crises` scenario (createScenarioGame) — one per crisis type: scarcity shock propagation
// through the private economy (source → prices → smuggling), luxury loss → unrest, fuel-out → grounded fleets, price
// spikes → smuggling — plus the §S6 checks (flags-off byte identity, determinism, save round trip mid-crisis).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame, cachedTickGameRun } from './helpers/gameCache';
import { createScenarioGame, loadScenarioOverlayFs, scenarioIndexFs } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { Habitat } from '../src/sim/types';
import type { BuiltObject } from '../src/sim/builtObject';
import { AutomationLevel } from '../src/sim/empire';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateCounts, stateDigest } from '../src/sim/tick/digest';
import { GalaxyTime, YEAR_LENGTH } from '../src/sim/galaxyTime';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import { createGalaxyScenario, pendingScenarioDecisions, answerScenarioDecision } from '../src/sim/scenario';
import { galaxyResourceCurrentPrices } from '../src/sim/design';
import { reviewResourcePrices } from '../src/sim/market';
import { Cargo, ResourceRef } from '../src/sim/cargo';
import { ResourceGroup, resourceGroupOf } from '../src/sim/resourceSystem';
import { empireApprovalRating } from '../src/sim/taxes';
import { EmpireMessageType, empireMessages } from '../src/sim/messages';
import { OrderType, empireCreateOrder } from '../src/sim/logistics/orders';
import { calculatePirateSmugglePricePerUnit, makeSmugglingOffersToPirates } from '../src/sim/pirates/missionsMarket';
import { EmpireActivityType } from '../src/sim/pirates/empireActivity';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { checkFuelHandicap } from '../src/sim/movement';
import { identifyResourceCentres } from '../src/sim/resourceTargets';
import { colonyRows } from '../src/ui/screens/coloniesList';
import {
    capitalPort,
    colonyInCrisis,
    colonyLuxuryIds,
    colonyShortageMarker,
    countGroundedShips,
    crisesState,
    crisisFuelAmount,
    crisisPrice,
    crisisPriceIndex,
    crisisSmuggleCap,
    crisesSummaryRows,
    empireCrises,
    FUEL_DECISION,
    recordExtraction,
    reviewCrises,
    reviewFuelCrisis,
    reviewReserves,
    reviewSupplyShock,
    shortageTerm,
    type Crisis,
} from '../src/sim/scenario/emergent/crises';

const SC = 'resource-crises';
let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

/** The cached seed-1 game with the resource-crises scenario attached (flag on unless overridden). */
function galaxyWithCrises(params: Record<string, number> = {}, flags: Record<string, boolean> = {}): Galaxy {
    const g = cachedTickGame(base).galaxy;
    g.scenario = createGalaxyScenario(loadScenarioOverlayFs(SC).manifest, { flags, params }, base.resources);
    return g;
}

function year(g: Galaxy): number {
    return Math.floor(galaxyStarDate(g) / YEAR_LENGTH);
}

function res(g: Galaxy, pred: (r: GameData['resources'][number]) => boolean) {
    const r = g.resourceSystem.resources.find(pred);
    if (r === undefined) throw new Error('no resource');
    return r;
}

function activeAi(g: Galaxy): Empire[] {
    return g.empires.filter((e): e is Empire => e != null && e.active && e !== g.independentEmpire && e !== g.playerEmpire && e.colonies.length > 0);
}

function clearFuel(g: Galaxy, e: Empire): void {
    const fuel = (id: number) => g.resourceSystem.byId.get(id)?.isFuel === true;
    for (const h of e.colonies) if (h.cargo !== null) for (const c of h.cargo.items) if (fuel(c.commodity.resourceId)) c.amount = 0;
    for (const p of e.spacePorts) if (p.cargo !== null) for (const c of p.cargo.items) if (fuel(c.commodity.resourceId)) c.amount = 0;
    for (const bo of e.builtObjects as BuiltObject[]) {
        bo.currentFuel = 0;
        bo.currentEnergy = 0;
    }
}

describe('scenario folder', () => {
    it('resource-crises is listed with its flag and params', () => {
        const m = scenarioIndexFs().find((x) => x.id === SC)!;
        expect(m.flags.map((f) => [f.name, f.default])).toEqual([['resourceCrises', true]]);
        expect(m.params.map((p) => [p.name, p.default])).toEqual([
            ['reserveUnitsPerAbundance', 250],
            ['crisisPriceCeiling', 1.5],
            ['shortageShockChance', 0.15],
            ['shortageUnrest', 6],
        ]);
        expect(m.files).toContain('GameText.txt');
    });
});

describe('propagation formulas (pure)', () => {
    it('crisisPrice: ported value above the shortage ratio; the C# step rule up to the crisis ceiling below it', () => {
        const g = galaxyWithCrises();
        const def = res(g, (r) => r.superLuxuryBonusAmount <= 0 && r.basePrice > 1);
        const b = Math.fround(def.basePrice);
        // Supply >= 25 % of demand: unchanged.
        expect(crisisPrice(g, def, 1000, 250, b * 0.35, b * 0.35)).toBe(b * 0.35);
        // Shortage: prev + min(quarter gap, prev / 2), capped at 1.5 × base.
        const prev = b * 0.35;
        const p1 = crisisPrice(g, def, 1000, 10, b * 0.35, prev);
        expect(p1).toBeCloseTo(prev + prev / 2, 9);
        let p = prev;
        for (let i = 0; i < 20; i++) p = crisisPrice(g, def, 1000, 10, Math.min(b * 0.35, p), p);
        expect(p).toBeCloseTo(b * 1.5, 9);
        // Target below the price: fall by half the gap, never below the ported floor or the ported value.
        const falling = crisisPrice(g, def, 100, 20, b * 0.35, b * 1.5);
        expect(falling).toBeGreaterThanOrEqual(b * 0.35);
        expect(crisisPrice(g, def, 1, 0.1, b * 0.1667, b * 0.1667)).toBeGreaterThanOrEqual(b * 0.1667);
        // Super-luxuries keep the ported band.
        const sl = g.resourceSystem.resources.find((r) => r.superLuxuryBonusAmount > 0);
        if (sl !== undefined) expect(crisisPrice(g, sl, 1000, 0, 7, 7)).toBe(7);
    });

    it('smuggle cap: 5 without the flag, 5 × ceiling / 0.35 with it', () => {
        const g = galaxyWithCrises();
        expect(crisisSmuggleCap(g)).toBeCloseTo((5 * 1.5) / 0.35, 9);
        const e = activeAi(g)[0];
        const rid = res(g, (r) => r.superLuxuryBonusAmount <= 0).resourceId;
        const prices = galaxyResourceCurrentPrices(g);
        const saved = prices[rid];
        prices[rid] = 100;
        expect(calculatePirateSmugglePricePerUnit(g, e, e.capital!, rid)).toBeCloseTo((5 * 1.5) / 0.35, 9);
        g.scenario = createGalaxyScenario(loadScenarioOverlayFs(SC).manifest, { flags: { resourceCrises: false } }, base.resources);
        expect(calculatePirateSmugglePricePerUnit(g, e, e.capital!, rid)).toBe(5);
        prices[rid] = saved;
    });

    it('shortage term: −shortageUnrest × count, decaying linearly to 0 over two years', () => {
        const g = galaxyWithCrises();
        const h = g.playerEmpire!.capital!;
        const now = galaxyStarDate(g) / YEAR_LENGTH;
        const st = crisesState(g);
        st.lostLuxuries.set(h, [{ year: now, count: 2, resourceIds: [1, 2] }]);
        expect(shortageTerm(g, h)).toBeCloseTo(-12, 9);
        st.lostLuxuries.set(h, [{ year: now - 1, count: 2, resourceIds: [1, 2] }]);
        expect(shortageTerm(g, h)).toBeCloseTo(-6, 9);
        st.lostLuxuries.set(h, [{ year: now - 2, count: 2, resourceIds: [1, 2] }]);
        expect(shortageTerm(g, h)).toBe(0);
        // Flag off: no term.
        st.lostLuxuries.set(h, [{ year: now, count: 2, resourceIds: [1, 2] }]);
        g.scenario!.flags.resourceCrises = false;
        expect(shortageTerm(g, h)).toBe(0);
    });

    it('reserves: 50 % → abundance 75 %, 80 % → 50 %, 100 % → the ported depletion event and a depletion crisis', () => {
        const g = galaxyWithCrises({ reserveUnitsPerAbundance: 100 });
        const e = g.playerEmpire!;
        const h = e.colonies.find((c) => c.resources.length > 0)!;
        const r = h.resources[0];
        const base0 = r.abundance;
        const reserve = base0 * 100;
        const y = year(g);
        recordExtraction(g, h, r.resourceId, Math.ceil(reserve * 0.5), e);
        reviewReserves(g, y);
        expect(r.abundance).toBe(Math.trunc(base0 * 0.75));
        expect(empireMessages(e).some((m) => m.messageType === EmpireMessageType.GeneralWarning && m.subject === h)).toBe(true);
        recordExtraction(g, h, r.resourceId, Math.ceil(reserve * 0.3), e);
        reviewReserves(g, y);
        expect(r.abundance).toBe(Math.trunc(base0 * 0.5));
        recordExtraction(g, h, r.resourceId, Math.ceil(reserve * 0.2) + 1, e);
        reviewReserves(g, y);
        expect(h.resources.some((x) => x.resourceId === r.resourceId)).toBe(false);
        const c = empireCrises(g, e).find((x) => x.kind === 'depletion')!;
        expect(c.resourceId).toBe(r.resourceId);
        expect(c.habitat).toBe(h);
        expect(c.empire).toBe(e);
        expect(c.resolvedYear).toBe(-1);
        // 0 = infinite reserves: nothing happens.
        const g2 = galaxyWithCrises({ reserveUnitsPerAbundance: 0 });
        const h2 = g2.playerEmpire!.colonies.find((c2) => c2.resources.length > 0)!;
        const r2 = h2.resources[0];
        recordExtraction(g2, h2, r2.resourceId, 1e12, g2.playerEmpire);
        reviewReserves(g2, year(g2));
        expect(h2.resources.includes(r2)).toBe(true);
    });
});

describe('crises on the seed-1 harness', () => {
    it('scarcity shock propagates through the private economy: source exhausted → crisis price → dearer smuggling', () => {
        const { game } = createScenarioGame(base, { scenario: SC, params: { shortageShockChance: 1 } });
        const g = game.galaxy;
        const y = year(g);
        const c = reviewSupplyShock(g, y)!;
        expect(c).not.toBeNull();
        expect(c.kind).toBe('shock');
        expect(c.habitat!.resources.some((r) => r.resourceId === c.resourceId)).toBe(false);
        const def = g.resourceSystem.byId.get(c.resourceId)!;
        expect(resourceGroupOf(def) === ResourceGroup.Luxury || def.isFuel).toBe(true);
        // The news reached every empire.
        const e = activeAi(g)[0];
        expect(empireMessages(e).some((m) => m.messageType === EmpireMessageType.GalacticNewsNet && m.description.includes(def.name))).toBe(true);
        // Private economy: stock of the resource is gone and colonies keep ordering it → the price passes the ported cap.
        for (const em of [...g.empires, ...g.pirateEmpires]) {
            if (em == null) continue;
            for (const h of em.colonies) if (h.cargo !== null) for (const cg of h.cargo.items) if (cg.commodity.resourceId === c.resourceId) cg.amount = 0;
            for (const bo of [...em.spacePorts, ...em.miningStations]) if (bo.cargo !== null) for (const cg of bo.cargo.items) if (cg.commodity.resourceId === c.resourceId) cg.amount = 0;
        }
        empireCreateOrder(g, e, e.capital!, new ResourceRef(c.resourceId), 50000, false, OrderType.Standard);
        const before = galaxyResourceCurrentPrices(g)[c.resourceId];
        const smuggleBefore = calculatePirateSmugglePricePerUnit(g, e, e.capital!, c.resourceId);
        for (let i = 0; i < 12; i++) reviewResourcePrices(g);
        const after = galaxyResourceCurrentPrices(g)[c.resourceId];
        const b = Math.fround(def.basePrice);
        expect(after).toBeGreaterThan(b * 0.35);
        expect(after).toBeLessThanOrEqual(b * 1.5 + 1e-9);
        expect(after).toBeGreaterThan(before);
        expect(crisisPriceIndex(g).find((p) => p.resourceId === c.resourceId)!.inCrisis).toBe(true);
        expect(calculatePirateSmugglePricePerUnit(g, e, e.capital!, c.resourceId)).toBeGreaterThan(smuggleBefore);
        // The yearly review announces the spike once.
        reviewCrises(g, y + 1);
        const spikes = (em: Empire) => empireMessages(em).filter((m) => m.messageType === EmpireMessageType.GalacticNewsNet && m.description.includes('Price spike') && m.description.includes(def.name)).length;
        expect(spikes(e)).toBe(1);
        reviewCrises(g, y + 1);
        expect(spikes(e)).toBe(1);
    }, 600000);

    it('luxury loss → unrest: the shortage term lowers approval at the next yearly review', () => {
        const { game } = createScenarioGame(base, { scenario: SC, params: { shortageShockChance: 0 } });
        const g = game.galaxy;
        const e = g.playerEmpire!;
        const h = e.capital!;
        const lux = res(g, (r) => resourceGroupOf(r) === ResourceGroup.Luxury && r.superLuxuryBonusAmount <= 0);
        h.cargo!.add(new Cargo(new ResourceRef(lux.resourceId), 5000, h.owner));
        const y = year(g);
        reviewCrises(g, y);
        expect(colonyLuxuryIds(g, h, h.owner)).toContain(lux.resourceId);
        const before = empireApprovalRating(g, h);
        for (const c of h.cargo!.items) if (resourceGroupOf(g.resourceSystem.byId.get(c.commodity.resourceId)!) === ResourceGroup.Luxury) c.amount = 0;
        const withoutTerm = empireApprovalRating(g, h);
        reviewCrises(g, y + 1);
        const lostCount = crisesState(g).lostLuxuries.get(h)![0].count;
        expect(lostCount).toBeGreaterThanOrEqual(1);
        expect(shortageTerm(g, h)).toBeCloseTo(-6 * lostCount, 6);
        const after = empireApprovalRating(g, h);
        expect(after).toBeCloseTo(withoutTerm - 6 * lostCount, 6);
        expect(after).toBeLessThan(before);
        // UI: shortage marker + approval breakdown.
        expect(colonyShortageMarker(g, h)).toContain(lux.name);
        const row = colonyRows(e, undefined, (x) => ({ shortage: colonyShortageMarker(g, x), approvalBreakdown: [{ label: 'Shortages', value: shortageTerm(g, x) }] })).find((r) => r.habitat === h)!;
        expect(row.shortage).toContain('Lost luxuries');
        expect(row.approvalBreakdown).toContain('Shortages');
    }, 600000);

    it('fuel-out → grounded fleets: a fuel crisis, the AI state order (rule 1) and the player decision', () => {
        const { game } = createScenarioGame(base, { scenario: SC, params: { shortageShockChance: 0 } });
        const g = game.galaxy;
        const y = year(g);
        const ai = activeAi(g).find((e) => (e.builtObjects as BuiltObject[]).some((b) => b.role === BuiltObjectRole.Military) && capitalPort(e) !== null)!;
        expect(ai).toBeDefined();
        clearFuel(g, ai);
        // The ported grounding (BaconBuiltObject.cs 4651) still does the slowing.
        const ship = (ai.builtObjects as BuiltObject[]).find((b) => b.role === BuiltObjectRole.Military)!;
        checkFuelHandicap(g, ship);
        expect(ship._fuelHandicapped).toBe(true);
        const r = countGroundedShips(g, ai);
        expect(r.grounded).toBe(r.military);
        const c = reviewFuelCrisis(g, ai, y)!;
        expect(c.kind).toBe('fuel');
        expect(c.empire).toBe(ai);
        expect(c.resolvedYear).toBe(-1);
        expect(g.resourceSystem.byId.get(c.resourceId)!.isFuel).toBe(true);
        expect(empireMessages(ai).some((m) => m.messageType === EmpireMessageType.GeneralWarning && m.subject !== null)).toBe(true);
        const port = capitalPort(ai)!;
        const amount = crisisFuelAmount(g, c.resourceId);
        const orders = g.orders.items.filter((o) => o.requestingBuiltObject === port && o.commodityResource?.resourceId === c.resourceId && o.isStateOrder);
        expect(orders.length).toBe(1);
        expect(orders[0].amountOutstandingToContract).toBe(amount);
        // Once per year, and no second order while one is open.
        expect(reviewFuelCrisis(g, ai, y)).toBe(c);
        expect(g.orders.items.filter((o) => o.requestingBuiltObject === port && o.commodityResource?.resourceId === c.resourceId && o.isStateOrder).length).toBe(1);
        expect(empireCrises(g, ai).filter((x) => x.kind === 'fuel').length).toBe(1);
        // Player: the crises.fuel decision; "Emergency purchase" buys the fuel into the capital port.
        const pl = g.playerEmpire!;
        clearFuel(g, pl);
        pl.stateMoney = 1e7;
        const pc = reviewFuelCrisis(g, pl, y);
        if (pc !== null) {
            const d = pendingScenarioDecisions(g, pl).find((x) => x.kind === FUEL_DECISION)!;
            expect(d.options.map((o) => o.id)).toEqual(['buy', 'smuggle', 'wait']);
            expect(d.defaultOption).toBe('wait');
            const money = pl.stateMoney;
            const target = capitalPort(pl)?.cargo ?? pl.capital!.cargo!;
            const stock = () => target.items.filter((x) => x.commodity.resourceId === pc.resourceId).reduce((s, x) => s + x.amount, 0);
            const s0 = stock();
            expect(answerScenarioDecision(g, d.id, 'buy', 'player')).toBe(true);
            expect(pl.stateMoney).toBeLessThan(money);
            expect(stock() - s0).toBe(d.context.amount);
        }
    }, 600000);

    it('price spikes → smuggling: a war-only empire posts a crisis-priced smuggle offer while a colony is in crisis', () => {
        const { game } = createScenarioGame(base, { scenario: SC, params: { shortageShockChance: 0 } });
        const g = game.galaxy;
        const e = activeAi(g)[0];
        e.policy!.offerSmugglingPirateMissions = 1;
        e.controlOfferPirateMissions = AutomationLevel.FullyAutomated;
        e.privateMoney = 1e9;
        const h = e.capital!;
        const lux = res(g, (r) => resourceGroupOf(r) === ResourceGroup.Luxury && r.superLuxuryBonusAmount <= 0 && !h.resources.some((x) => x.resourceId === r.resourceId));
        const order = empireCreateOrder(g, e, h, new ResourceRef(lux.resourceId), 5000, false, OrderType.Standard);
        order.expiryDate -= YEAR_LENGTH; // placed a year ago, unfilled
        for (const c of h.cargo!.items) if (c.commodity.resourceId === lux.resourceId) c.amount = 0;
        galaxyResourceCurrentPrices(g)[lux.resourceId] = Math.fround(lux.basePrice) * 1.5;
        const smuggles = () => e.pirateMissions.resolveActivitiesByType(EmpireActivityType.Smuggle).count;
        makeSmugglingOffersToPirates(g, e, galaxyStarDate(g));
        expect(smuggles()).toBe(0); // not at war, no crisis: the ported policy says no
        const crisis: Crisis = { id: 999, kind: 'blockade', resourceId: lux.resourceId, habitat: h, empire: e, startYear: year(g), severity: 1, resolvedYear: -1, okSinceYear: -1 };
        crisesState(g).crises.push(crisis);
        expect(colonyInCrisis(g, h)).toBe(crisis);
        makeSmugglingOffersToPirates(g, e, galaxyStarDate(g));
        expect(smuggles()).toBe(1);
        const a = e.pirateMissions.resolveActivitiesByType(EmpireActivityType.Smuggle).at(0)!;
        expect(a.target).toBe(h);
        expect(a.price).toBeCloseTo(Math.min(crisisSmuggleCap(g), Math.max(0.1, Math.fround(lux.basePrice) * 1.5 * 0.5)), 9);
        // Empire Summary block lists the crisis.
        const rows = crisesSummaryRows(g, e);
        expect(rows.find((r) => r.label === 'Crises')!.value).toBe('1');
    }, 600000);

    it('AI rule 3: no smuggling offer for a resource the empire exports to a partner in crisis', () => {
        const { game } = createScenarioGame(base, { scenario: SC, params: { shortageShockChance: 0 } });
        const g = game.galaxy;
        const [e, partner] = activeAi(g);
        e.policy!.offerSmugglingPirateMissions = 2;
        e.controlOfferPirateMissions = AutomationLevel.FullyAutomated;
        e.privateMoney = 1e9;
        const h = e.capital!;
        const lux = res(g, (r) => resourceGroupOf(r) === ResourceGroup.Luxury && r.superLuxuryBonusAmount <= 0 && !h.resources.some((x) => x.resourceId === r.resourceId));
        const order = empireCreateOrder(g, e, h, new ResourceRef(lux.resourceId), 5000, false, OrderType.Standard);
        order.expiryDate -= YEAR_LENGTH;
        for (const c of h.cargo!.items) if (c.commodity.resourceId === lux.resourceId) c.amount = 0;
        const st = crisesState(g);
        st.exports.set(e, [{ resourceId: lux.resourceId, buyer: partner, year: year(g) }]);
        st.crises.push({ id: 998, kind: 'raid', resourceId: lux.resourceId, habitat: partner.capital, empire: partner, startYear: year(g), severity: 1, resolvedYear: -1, okSinceYear: -1 });
        // Only this order may be the deficient one for the rule to apply; skip when the colony has others.
        makeSmugglingOffersToPirates(g, e, galaxyStarDate(g));
        const posted = e.pirateMissions.resolveActivitiesByType(EmpireActivityType.Smuggle);
        for (let i = 0; i < posted.count; i++) expect(posted.at(i)!.resourceId).not.toBe(lux.resourceId);
    }, 600000);

    it('AI rule 2: sources of a widely lost luxury head the mining targets', () => {
        const g = galaxyWithCrises();
        const e = activeAi(g)[0];
        const stock = identifyResourceCentres(g, e);
        const target = stock.find((p, i) => i > 0 && p.habitat !== null && p.habitat.resources.length > 0);
        if (target === undefined) return; // nothing to reorder on this seed
        const rid = target.habitat!.resources[0].resourceId;
        crisesState(g).miningPriority.set(e, [rid]);
        const reordered = identifyResourceCentres(g, e);
        expect(reordered.length).toBe(stock.length);
        expect(reordered[0].habitat!.resources.some((r) => r.resourceId === rid)).toBe(true);
    });
});

describe('§S6 checks', () => {
    it('flags off: the scenario with resourceCrises false runs byte-identical to the faithful game', () => {
        const ref = cachedTickGameRun(base, { seconds: 900 });
        const { game } = createScenarioGame(base, { scenario: SC, flags: { resourceCrises: false } });
        const run = runGameSeconds(game, 900);
        expect(stateDigest(game.galaxy)).toBe(stateDigest(ref.game.galaxy));
        expect(stateCounts(game.galaxy)).toEqual(stateCounts(ref.game.galaxy));
        expect(run.rndDraws).toBe(ref.run.rndDraws);
        expect(game.galaxy.rnd.drawCount).toBe(ref.game.galaxy.rnd.drawCount);
        expect('crises' in game.galaxy.scenario!.state).toBe(false);
    }, 1200000);

    function saveText(game: { galaxy: Galaxy; playerEmpire: unknown; viewX: number; viewY: number }): string {
        const time = new GalaxyTime();
        time.togglePause();
        time.advance(game.galaxy.nowMs);
        return serializeGame(game as never, time, { ...defaultStartGameOptions(), seed: 1, scenario: { id: SC, flags: { resourceCrises: true }, params: {} } });
    }

    it('determinism and save round trip mid-crisis: same seed twice, and saved/loaded runs match', () => {
        const run = () => {
            const { game, gameData } = createScenarioGame(base, { scenario: SC, params: { shortageShockChance: 1 } });
            runGameSeconds(game, 120);
            reviewCrises(game.galaxy, year(game.galaxy) + 1); // force a year's review (a shock) mid-run
            return { game, gameData };
        };
        const a = run();
        const b = run();
        expect(stateDigest(a.game.galaxy)).toBe(stateDigest(b.game.galaxy));
        const open = crisesState(a.game.galaxy).crises.filter((c) => c.resolvedYear < 0);
        expect(open.length).toBeGreaterThan(0);
        const text = saveText(a.game);
        expect(saveText(b.game)).toBe(text);
        const loaded = deserializeGame(text, a.gameData);
        expect(crisesState(loaded.game.galaxy).crises.length).toBe(crisesState(a.game.galaxy).crises.length);
        runGameSeconds(a.game, 300);
        runGameSeconds(loaded.game, 300);
        expect(stateDigest(loaded.game.galaxy)).toBe(stateDigest(a.game.galaxy));
        expect(saveText(loaded.game)).toBe(saveText(a.game));
    }, 1200000);
});
