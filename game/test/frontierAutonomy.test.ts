// 19g-5 frontier autonomy (tasks/19-mod-layer-scenarios.md §19g item 5): the drift maths and its "frontier" ledger term,
// a frontier sector forming under a sector governor, each governor power (local tax override, militia purchase, trade
// compact, refused order), loose vs tight rule (and rim herd tolerance), a breakaway producing a new empire (and the
// answers that stop it), the AI's responses by temper, flags-off byte identity and a save round trip.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGameRun } from './helpers/gameCache';
import { createScenarioGame } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { Habitat } from '../src/sim/types';
import { CharacterRole, generateNewCharacter } from '../src/sim/characters';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateDigest } from '../src/sim/tick/digest';
import { scenarioQuery } from '../src/sim/scenario/hooks';
import { GalaxyTime, REAL_SECONDS_IN_GALACTIC_YEAR } from '../src/sim/galaxyTime';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import { obtainEmpireEvaluation } from '../src/sim/diplomacy';
import { empireApprovalRating } from '../src/sim/taxes';
import { runPlayerCommand } from '../src/sim/player/playerCommands';
import { isPoliticalEmpire, politicsEntry, politicsYear } from '../src/sim/scenario/emergent/politics';
import { honorCharacter } from '../src/sim/scenario/emergent/politicsActions';
import { colonyLedger } from '../src/sim/scenario/security/security';
import { peekSecurityState, securityState } from '../src/sim/scenario/security/registry';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { courtState, rulingHouse } from '../src/sim/scenario/court/court';
import { rimFaunaState } from '../src/sim/scenario/rimFauna/common';
import {
    aiRespond,
    aiTemper,
    autonomyDrift,
    breakawayDeterred,
    buyMilitia,
    colonyGovernorOf,
    frontierEvents,
    concedeSector,
    empireTypicalWarp,
    entryOf,
    frontierState,
    governorLoyaltyYear,
    herdToleranceTerm,
    militiaDesign,
    nearbyFleet,
    orderSector,
    peekFrontierState,
    peekLead,
    refuseChance,
    reviewBreakaway,
    reviewGovernor,
    reviewSectors,
    sectorAutonomy,
    sectorCoords,
    sectorTaxTerm,
    setSectorTax,
    signDeal,
    travelDaysToCapital,
    type FrontierSector,
} from '../src/sim/scenario/frontier/frontier';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const SC = 'frontier-autonomy';
/** Every flag the scenario (with its includes) carries, off. */
const ALL_OFF: Record<string, boolean> = {
    frontierAutonomy: false,
    courtDynasties: false,
    courtIntrigue: false,
    internalSecurity: false,
    internalPolitics: false,
    livingCharacters: false,
    resourceCrises: false,
    espionageConsequences: false,
    refugees: false,
    rimFauna: false,
    cult: false,
    doppelgangers: false,
    hive: false,
    greyTide: false,
    threatCorporateCoup: false,
};
const ON = { ...ALL_OFF, frontierAutonomy: true, courtDynasties: true, internalPolitics: true, internalSecurity: true };
/** One colony is a sector (the seed-1 empires are small); no warship counts as near (range 0) unless a test widens it. */
const TEST_PARAMS = { cultSeedYear: 200, frontierSectorMinColonies: 1, frontierFleetRangePct: 0, frontierDealPct: 0 };

function frontierGame(params: Record<string, number> = {}): { game: Game; gameData: GameData } {
    return createScenarioGame(base, {
        scenario: SC,
        flags: ON,
        params: { ...TEST_PARAMS, ...params },
        options: (o) => ({ ...o, galaxyAge: 3, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) }),
    });
}

function political(g: Galaxy): Empire[] {
    return g.empires.filter((e) => isPoliticalEmpire(g, e));
}

function outerColonies(e: Empire): Habitat[] {
    return e.colonies.filter((h) => h !== null && h.empire === e && h !== e.capital);
}

/** Makes the biggest group of `e`'s non-capital colonies in one galaxy sector autonomous and forms its sector. */
function setupSector(g: Galaxy, e: Empire, autonomy = 80): FrontierSector {
    const groups = new Map<string, Habitat[]>();
    for (const h of outerColonies(e)) {
        const { sx, sy } = sectorCoords(g, h);
        const k = `${sx},${sy}`;
        groups.set(k, [...(groups.get(k) ?? []), h]);
    }
    const group = [...groups.values()].sort((a, b) => b.length - a.length)[0];
    group.forEach((h, i) => (entryOf(g, h).autonomy = autonomy - i));
    const year = politicsYear(g);
    reviewSectors(g, year);
    const s = frontierState(g).sectors.find((x) => x.empire === e && x.colonies.includes(group[0]))!;
    reviewGovernor(g, s, year);
    return s;
}

describe('flags off = faithful game', () => {
    it('the scenario with every flag off runs byte-identical to the plain seed-1 game', () => {
        const ref = cachedTickGameRun(base, { seconds: 900 });
        const { game } = createScenarioGame(base, { scenario: SC, flags: ALL_OFF });
        expect(Object.keys(game.galaxy.scenario!.flags).sort()).toEqual(Object.keys(ALL_OFF).sort());
        runGameSeconds(game, 900);
        expect(stateDigest(game.galaxy)).toBe(stateDigest(ref.game.galaxy));
        expect(game.galaxy.rnd.drawCount).toBe(ref.game.galaxy.rnd.drawCount);
        expect('frontier' in game.galaxy.scenario!.state).toBe(false);
    }, 1200000);
});

describe('drift, sectors, powers and rule (one age-3 game)', () => {
    let game: Game;
    let g: Galaxy;
    let e: Empire;
    let s: FrontierSector;
    beforeAll(() => {
        game = frontierGame().game;
        g = game.galaxy;
        e = political(g).sort((a, b) => outerColonies(b).length - outerColonies(a).length)[0];
    }, 1200000);

    it('1. drift: travel time from distance / typical warp speed, fleet presence, race, approval, decay; the "frontier" ledger term', () => {
        const h = outerColonies(e)[0];
        // Travel time: HyperjumpInitiate seconds + distance / WarpSpeed seconds, in game days.
        const { speed, initiate } = empireTypicalWarp(g, e);
        expect(speed).toBeGreaterThan(0);
        const dist = g.calculateDistance(h.xpos, h.ypos, e.capital!.xpos, e.capital!.ypos);
        const days = travelDaysToCapital(g, e, h);
        expect(days).toBeCloseTo((initiate + dist / speed) / (REAL_SECONDS_IN_GALACTIC_YEAR / 360), 9);
        const entry = entryOf(g, h);
        entry.autonomy = 50;
        entry.presence = [1, 1, 0, 0];
        const { delta, causes } = autonomyDrift(g, h, entry);
        const by = (c: string): number => causes.find((x) => x.cause === c)?.amount ?? 0;
        expect(by('Travel time')).toBeCloseTo(2 * Math.min(3, days / 20), 9);
        expect(by('No warships')).toBeCloseTo(3 * 0.5, 9);
        expect(by('Decay')).toBeCloseTo(-5, 9);
        expect(by('Approval')).toBeCloseTo(-Math.max(-3, Math.min(3, empireApprovalRating(g, h) / 10)), 9);
        const race = h.population.dominantRace;
        if (race !== e.dominantRace) expect(by('Race')).toBeGreaterThanOrEqual(0);
        else expect(by('Race')).toBe(0);
        expect(delta).toBeCloseTo(causes.reduce((a, c) => a + c.amount, 0), 9);
        // A governor of the ruling house pulls the colony back.
        const gov = generateNewCharacter(g, e, CharacterRole.ColonyGovernor, h).character;
        courtState(g).members.set(gov, rulingHouse(g, e)!.id);
        expect(autonomyDrift(g, h, entry).causes.find((x) => x.cause === 'Ruling-house governor')?.amount).toBe(-4);
        // The ledger: −autonomy × 10% under cause "frontier", folded into the approval.
        const ledger = colonyLedger(g, h);
        const line = ledger.entries.find((x) => x.cause === 'frontier')!;
        expect(line.value).toBeCloseTo(-5, 9);
        expect(ledger.total).toBe(empireApprovalRating(g, h));
        entry.autonomy = 0;
        expect(colonyLedger(g, h).entries.some((x) => x.cause === 'frontier')).toBe(false);
        // The capital never drifts.
        expect(autonomyDrift(g, e.capital!, undefined).causes.map((c) => c.cause)).toEqual(['Capital']);
    });

    it('2. autonomous colonies of one galaxy sector form a frontier sector under a promoted sector governor', () => {
        s = setupSector(g, e);
        expect(s.colonies.length).toBeGreaterThan(0);
        expect(s.governor).not.toBeNull();
        expect(s.governor!.role).toBe(CharacterRole.ColonyGovernor);
        expect(s.seat).toBe(s.governor!.location);
        expect(s.colonies).toContain(s.seat);
        // The seat is the most autonomous colony with a governor (a new one is generated there when none governs).
        const st = frontierState(g);
        const seatA = st.colonies.get(s.seat!)!.autonomy;
        for (const h of s.colonies) if (h !== s.seat && colonyGovernorOf(h) !== null) expect(st.colonies.get(h)!.autonomy).toBeLessThanOrEqual(seatA);
        expect(st.events.some((x) => x.kind === 'formed' && x.sector === s.id)).toBe(true);
        expect(frontierEvents(g, e).some((x) => x.kind === 'formed')).toBe(true);
    });

    it('3a. power: the local tax override replaces the rate in RecalculateAnnualTaxRevenue (colonyTaxRate query) and enters the ledger', () => {
        s.rule = 'normal';
        setSectorTax(g, s);
        const h = s.seat!;
        const mean = s.colonies.reduce((a, x) => a + Math.fround(x.taxRate), 0) / s.colonies.length;
        expect(s.taxOverride).toBe(Math.round(mean * (1 - 0.5 * (sectorAutonomy(g, s) / 100)) * 100) / 100);
        expect(scenarioQuery(g, 'colonyTaxRate', Math.fround(h.taxRate), { habitat: h, empire: e })).toBe(s.taxOverride);
        const term = sectorTaxTerm(g, h);
        if (s.taxOverride! < Math.fround(h.taxRate)) expect(term!).toBeGreaterThan(0);
        // A colony outside every sector keeps the stock rate.
        const capital = e.capital!;
        expect(scenarioQuery(g, 'colonyTaxRate', 0.2, { habitat: capital, empire: e })).toBe(0.2);
    });

    it('3b. power: the militia is bought through PurchaseNewBuiltObject from the sector budget', () => {
        const design = militiaDesign(e)!;
        expect(design).not.toBeNull();
        const price = design.calculateCurrentPurchasePrice(g);
        s.budget = price * 1.5;
        e.stateMoney = Math.max(e.stateMoney, price * 10);
        const before = e.builtObjects.length;
        const bought = buyMilitia(g, s);
        expect(bought.length).toBe(1);
        expect(e.builtObjects.length).toBe(before + 1);
        expect(bought[0].design).toBe(design);
        expect(bought[0].builtAt).not.toBeNull(); // queued at a yard
        expect(s.budget).toBeCloseTo(price * 0.5, 3);
        expect(s.militia).toContain(bought[0]);
    });

    it('3c. power: a trade compact raises the local standing, the budget and the partner\'s attitude', () => {
        const partner = political(g).find((x) => x !== e && x.colonies.length > 0)!;
        const ev = obtainEmpireEvaluation(g, partner, e);
        const before = ev.incidentEvaluationRaw;
        const budget = s.budget;
        const deal = signDeal(g, s, partner.colonies[0], politicsYear(g));
        expect(deal.partner).toBe(partner);
        expect(deal.standing).toBe(10);
        expect(s.budget).toBeGreaterThanOrEqual(budget);
        expect(obtainEmpireEvaluation(g, partner, e).incidentEvaluationRaw).toBeCloseTo(before + 2, 6);
        expect(signDeal(g, s, partner.colonies[0], politicsYear(g)).standing).toBe(20);
        const indep = g.independentEmpire?.colonies[0];
        if (indep !== undefined) expect(signDeal(g, s, indep, politicsYear(g)).colony).toBe(indep);
    });

    it('3d. power: a disloyal, autonomous governor refuses unpopular orders (message); a loyal one obeys', () => {
        const gov = s.governor!;
        politicsEntry(g, gov).loyalty = 0;
        for (const h of s.colonies) entryOf(g, h).autonomy = 100;
        s.rule = 'normal';
        expect(refuseChance(g, s)).toBe(0.95);
        let refused = 0;
        for (let i = 0; i < 6; i++) if (orderSector(g, e, s.id, { kind: 'rule', rule: 'tight' }).refused) refused++;
        expect(refused).toBeGreaterThan(0);
        expect(s.refusals).toBe(refused);
        expect(frontierState(g).events.some((x) => x.kind === 'refused' && x.sector === s.id)).toBe(true);
        if (e === g.playerEmpire) expect((e.messages as { title: string }[]).some((m) => m.title === 'Order Refused')).toBe(true);
        // A popular order (loosening) is never refused; a loyal governor at low autonomy obeys.
        expect(orderSector(g, e, s.id, { kind: 'rule', rule: 'loose' })).toEqual({ ok: true, refused: false });
        politicsEntry(g, gov).loyalty = 100;
        expect(refuseChance(g, s)).toBe(0);
        expect(orderSector(g, e, s.id, { kind: 'rule', rule: 'tight' })).toEqual({ ok: true, refused: false });
        expect(s.rule).toBe('tight');
        // The same order through the player command queue (op frontierOrder) when this is the player's empire.
        if (e === g.playerEmpire) {
            const r = runPlayerCommand(g, e, 'frontierOrder', [s.id, { kind: 'rule', rule: 'normal' }]) as { ok: boolean };
            expect(r.ok).toBe(true);
        }
        s.rule = 'normal';
        for (const h of s.colonies) entryOf(g, h).autonomy = 80;
    });

    it('4. loose vs tight: tax collected, drift, governor loyalty, the unrest term; herd tolerance in a rim sector', () => {
        const h = s.seat!;
        setSectorTax(g, s);
        const override = s.taxOverride!;
        const entry = entryOf(g, h);
        s.rule = 'loose';
        expect(scenarioQuery(g, 'colonyTaxRate', Math.fround(h.taxRate), { habitat: h, empire: e })).toBeCloseTo(override * 0.8, 9);
        expect(autonomyDrift(g, h, entry).causes.find((c) => c.cause === 'Loose rule')?.amount).toBe(-2);
        expect(colonyLedger(g, h).entries.some((x) => x.cause === 'frontierRule')).toBe(false);
        const gov = s.governor!;
        politicsEntry(g, gov).loyalty = 50;
        for (const x of s.colonies) entryOf(g, x).autonomy = 40;
        governorLoyaltyYear(g, s);
        expect(politicsEntry(g, gov).loyalty).toBe(53);
        s.rule = 'tight';
        expect(scenarioQuery(g, 'colonyTaxRate', Math.fround(h.taxRate), { habitat: h, empire: e })).toBeCloseTo(override * 1.1, 9);
        expect(autonomyDrift(g, h, entry).causes.find((c) => c.cause === 'Tight rule')?.amount).toBe(2);
        expect(colonyLedger(g, h).entries.find((x) => x.cause === 'frontierRule')!.value).toBe(-3);
        governorLoyaltyYear(g, s);
        expect(politicsEntry(g, gov).loyalty).toBe(53);
        // Herd tolerance: rim sectors only; forgives half of the 19g-7 herd-loss unrest term.
        g.scenario!.params.frontierRimRadius = 1.01;
        expect(orderSector(g, e, s.id, { kind: 'herds', on: true }).ok).toBe(false);
        g.scenario!.params.frontierRimRadius = 0;
        s.rule = 'loose';
        expect(orderSector(g, e, s.id, { kind: 'herds', on: true }).ok).toBe(true);
        expect(s.herdTolerance).toBe(true);
        rimFaunaState(g).unrest.push({ colony: h, losses: 2 });
        expect(herdToleranceTerm(g, h)).toBeCloseTo(3 * 2 * 0.5, 9);
        s.rule = 'normal';
    });
});

describe('breakaway (player empire: no automatic answers)', () => {
    it('warnings with a sector-unrest lead, then a new empire of every sector colony under the governor', () => {
        const { game } = frontierGame({ frontierWarningYears: 2 });
        const g = game.galaxy;
        const e = g.playerEmpire!;
        const s = setupSector(g, e, 90);
        const gov = s.governor!;
        const colonies = [...s.colonies];
        politicsEntry(g, gov).loyalty = 0;
        const y = politicsYear(g);
        expect(breakawayDeterred(g, s)).toBe(false);
        expect(reviewBreakaway(g, s, y)).toBeNull();
        expect(s.unrestYears).toBe(1);
        expect((e.messages as { title: string }[]).some((m) => m.title === 'Sector Unrest')).toBe(true);
        expect(peekLead(g, s)!.level).toBe('suspected');
        expect(peekLead(g, s)!.kind).toBe('sectorUnrest');
        expect(reviewBreakaway(g, s, y + 1)).toBeNull();
        expect(peekLead(g, s)!.level).toBe('confirmed');
        const before = g.empires.length;
        const n = reviewBreakaway(g, s, y + 2)!;
        expect(n).not.toBeNull();
        expect(g.empires.length).toBe(before + 1);
        for (const h of colonies) expect(h.empire).toBe(n);
        expect(n.leader).toBe(gov);
        expect(gov.role).toBe(CharacterRole.Leader);
        expect(peekFrontierState(g)!.sectors.includes(s)).toBe(false);
        expect(peekFrontierState(g)!.events.at(-1)!.kind).toBe('breakaway');
        expect(peekSecurityState(g)!.leads.find((l) => l.kind === 'sectorUnrest')!.closed).toBe(true);
        // The game runs on with the new empire.
        runGameSeconds(game, 120);
        expect(n.active).toBe(true);
    }, 1200000);

    it('answers: a fleet holds the sector, honours or a concession calm it', () => {
        const { game } = frontierGame();
        const g = game.galaxy;
        const e = g.playerEmpire!;
        const s = setupSector(g, e, 90);
        const gov = s.governor!;
        politicsEntry(g, gov).loyalty = 0;
        const y = politicsYear(g);
        // A warship near the seat (range widened to reach one) holds the sector: no warning count.
        g.scenario!.params.frontierFleetRangePct = 100000;
        if (nearbyFleet(g, e, s.seat!) !== null) {
            expect(breakawayDeterred(g, s)).toBe(true);
            expect(reviewBreakaway(g, s, y)).toBeNull();
            expect(s.unrestYears).toBe(0);
            expect(peekFrontierState(g)!.events.at(-1)!.kind).toBe('deterred');
        }
        g.scenario!.params.frontierFleetRangePct = 0;
        // So does 19m martial law at the seat.
        securityState(g).martialLaw.set(s.seat!, galaxyStarDate(g) + 1e9);
        expect(breakawayDeterred(g, s)).toBe(true);
        expect(reviewBreakaway(g, s, y)).toBeNull();
        expect(s.unrestYears).toBe(0);
        securityState(g).martialLaw.delete(s.seat!);
        reviewBreakaway(g, s, y);
        expect(s.unrestYears).toBe(1);
        // A concession: loose rule, loyalty, the count restarts and the lead closes.
        expect(runPlayerCommand(g, e, 'frontierConcede', [s.id])).toEqual({ ok: true });
        expect(s.rule).toBe('loose');
        expect(s.unrestYears).toBe(0);
        expect(politicsEntry(g, gov).loyalty).toBeGreaterThanOrEqual(10);
        expect(peekLead(g, s)).toBeNull();
        // Honours lift the governor over the breakaway line: the pressure is gone.
        politicsEntry(g, gov).loyalty = 25;
        e.stateMoney = Math.max(e.stateMoney, 1e7);
        expect(honorCharacter(g, e, gov).ok).toBe(true);
        reviewBreakaway(g, s, y + 1);
        expect(s.unrestYears).toBe(0);
    }, 1200000);
});

describe('5. AI responses by temper', () => {
    it('aggressive rulers tighten and purge; cautious ones garrison, loosen and concede (once) — both can lose the sector', () => {
        const { game } = frontierGame({ frontierWarningYears: 1 });
        const g = game.galaxy;
        const ais = political(g).filter((x) => x !== g.playerEmpire && outerColonies(x).length > 0);
        expect(ais.length).toBeGreaterThanOrEqual(2);
        const [a, c] = ais;
        const saved = [a, c].map((x) => ({ race: x.dominantRace!, caution: x.dominantRace!.caution, aggression: x.dominantRace!.aggression }));
        try {
            a.dominantRace!.caution = 80;
            a.dominantRace!.aggression = 130;
            if (c.dominantRace !== a.dominantRace) {
                c.dominantRace!.caution = 130;
                c.dominantRace!.aggression = 80;
            }
            expect(aiTemper(a)).toBe('aggressive');
            const y = politicsYear(g);
            // Aggressive: new sectors start tight; the final warning purges the governor through the confirmed 19m lead.
            const sa = setupSector(g, a, 90);
            expect(sa.rule).toBe('tight');
            const govA = sa.governor!;
            politicsEntry(g, govA).loyalty = 0;
            reviewBreakaway(g, sa, y);
            expect(govA.active).toBe(false);
            expect(sa.governor).toBeNull();
            expect(peekFrontierState(g)!.events.some((x) => x.kind === 'purge' && x.sector === sa.id)).toBe(true);
            // ...and with the next disloyal governor it still breaks away: one purge per AI_RESPONSE_YEARS.
            reviewGovernor(g, sa, y + 1);
            const govA2 = sa.governor!;
            politicsEntry(g, govA2).loyalty = 0;
            expect(reviewBreakaway(g, sa, y + 1)).toBeNull(); // the final warning again, no second purge
            expect(govA2.active).toBe(true);
            const na = reviewBreakaway(g, sa, y + 2);
            expect(na).not.toBeNull();
            expect(na!.leader).toBe(govA2);

            if (c.dominantRace === a.dominantRace) return;
            expect(aiTemper(c)).toBe('cautious');
            const sc = setupSector(g, c, 90);
            expect(sc.rule).toBe('loose');
            sc.rule = 'normal';
            const govC = sc.governor!;
            politicsEntry(g, govC).loyalty = 0;
            reviewBreakaway(g, sc, y); // final warning: garrison + loosen + concede
            expect(sc.rule).toBe('loose');
            expect(sc.unrestYears).toBe(0);
            expect(sc.lastConcedeYear).toBe(politicsYear(g));
            const hasFleet = peekFrontierState(g)!.events.some((x) => x.kind === 'garrison' && x.sector === sc.id);
            if (hasFleet) expect(g.empires.includes(c)).toBe(true);
            // Still disloyal a year later (the fleet has not arrived: no ticks ran) — no second concession: lost.
            politicsEntry(g, govC).loyalty = 0;
            reviewBreakaway(g, sc, y + 1);
            expect(sc.unrestYears).toBe(1);
            const nc = reviewBreakaway(g, sc, y + 2);
            expect(nc).not.toBeNull();
            expect(nc!.leader).toBe(govC);
        } finally {
            for (const x of saved) {
                x.race.caution = x.caution;
                x.race.aggression = x.aggression;
            }
        }
    }, 1200000);

    it('aiRespond without a warning in flight is safe', () => {
        const { game } = frontierGame();
        const g = game.galaxy;
        const ai = political(g).find((x) => x !== g.playerEmpire && outerColonies(x).length > 0)!;
        const s = setupSector(g, ai, 50);
        aiRespond(g, s, false);
        expect(['loose', 'tight', 'normal']).toContain(s.rule);
        expect(concedeSector(g, ai, -1).ok).toBe(false);
    }, 1200000);
});

describe('yearly handler and save round trip', () => {
    function saveText(game: Game): string {
        const time = new GalaxyTime();
        time.togglePause();
        time.advance(game.galaxy.nowMs);
        return serializeGame(game as never, time, { ...defaultStartGameOptions(), seed: 1, scenario: { id: SC, flags: ON, params: TEST_PARAMS } });
    }

    it('autonomy, sectors, militia and deals survive save / load and the runs match', () => {
        const a = frontierGame();
        const g = a.game.galaxy;
        runGameSeconds(a.game, REAL_SECONDS_IN_GALACTIC_YEAR + 60); // a yearly tick with the handler
        const st = peekFrontierState(g)!;
        expect(st.colonies.size).toBeGreaterThan(0);
        const e = political(g).sort((x, y) => outerColonies(y).length - outerColonies(x).length)[0];
        const s = setupSector(g, e, 85);
        s.deals.push({ partner: null, colony: g.independentEmpire?.colonies[0] ?? null, standing: 30, year: politicsYear(g) });
        const text = saveText(a.game);
        const loaded = deserializeGame(text, a.gameData);
        const g2 = loaded.game.galaxy;
        const st2 = peekFrontierState(g2)!;
        expect(st2.sectors.map((x) => `${x.id}:${x.name}:${x.empire.name}:${x.colonies.length}:${x.governor?.name}:${x.rule}`)).toEqual(
            st.sectors.map((x) => `${x.id}:${x.name}:${x.empire.name}:${x.colonies.length}:${x.governor?.name}:${x.rule}`),
        );
        expect([...st2.colonies.values()].map((x) => x.autonomy)).toEqual([...st.colonies.values()].map((x) => x.autonomy));
        expect(st2.sectors.find((x) => x.id === s.id)!.deals[0].standing).toBe(30);
        runGameSeconds(a.game, 700);
        runGameSeconds(loaded.game, 700);
        expect(stateDigest(loaded.game.galaxy)).toBe(stateDigest(a.game.galaxy));
        expect(saveText(loaded.game)).toBe(saveText(a.game));
    }, 1200000);
});
