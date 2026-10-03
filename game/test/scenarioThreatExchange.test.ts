// 19f #8 The Exchange (tasks/19f-hidden-threats.md §8): flag off byte-identical; the forced appearance on seed 1 (a
// real faction: station, stand-in capital, stock AI off, tech level, pacts, no wars); the purse (income schedule,
// reserve); underdog funding; agent missions and a caught agent opening / confirming a 19m lead; the map gift; the
// intel market (AI purchase, the player's decision); pirate contracts (type / requester / target, paid through the
// stock completion paths); the blockade end. Direct calls on one shared game (tests run in order). The 2-year fleet /
// guard run and the research-potential numbers are the soak in scenarioThreatExchangeSoak.test.ts.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Game, CreateGameOptions } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import { AutomationLevel } from '../src/sim/empire';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateDigest } from '../src/sim/tick/digest';
import { gameYear, scenarioEmit, registerScenarioEvent, registerScenarioGameStart, registerScenarioPeriodic, registerScenarioQuery, registerScenarioYearly } from '../src/sim/scenario/hooks';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { setGameEndHandler, type GameEndEventArgs } from '../src/sim/victory';
import { declareWar } from '../src/sim/diplomacyTick';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { PirateRelationType, changePirateRelation, obtainPirateRelation } from '../src/sim/pirateRelations';
import { EmpireActivityType, EmpireActivity } from '../src/sim/pirates/empireActivity';
import { totalMobileMilitaryFirepowerNotAttackingDefending, completePirateMission, pirateCheckAcceptDefendMission, pirateCheckMissionsOnOffer, reviewPirateDefendMissions, reviewPirateMissionsAndAssign, calculatePirateDefendPrice } from '../src/sim/pirates/missionsMarket';
import { ShipGroup, empireShipGroups } from '../src/sim/fleets/shipGroup';
import { BuiltObject } from '../src/sim/builtObject';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { latestDesignsFindNewestCanBuild } from '../src/sim/pirates';
import { applyReputation } from '../src/sim/scenario/reputation/ledger';
import { councilState, type Council } from '../src/sim/scenario/emergent/council';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { estimatedDefensiveForceRequired } from '../src/sim/troops';
import { cancelBlockadeBuiltObject, setupBlockadeBuiltObject } from '../src/sim/fleets/blockades';
import { characterMission } from '../src/sim/espionage';
import { answerScenarioDecision, pendingScenarioDecisions } from '../src/sim/scenario/decisions';
import { peekSecurityState } from '../src/sim/scenario/security/registry';
import { annualResearchPotential } from '../src/sim/researchTick';
import { CharacterRole, CharacterTraitType, checkCharactersForTrait, getEmpireCharacters } from '../src/sim/characters';
import {
    EXCHANGE_BUY_INTEL_DECISION,
    EXCHANGE_GRUDGE,
    accrueGrudgesPeriodic,
    exchangeGrudge,
    exchangeGrudgeYearly,
    exchangeMissionTargets,
    exchangePostContract,
    exchangeIsGrudged,
    EXCHANGE_CODE_CONTAINED,
    EXCHANGE_HANDLER_IDS,
    EXCHANGE_QUERY_IDS,
    aiIntelSales,
    assignAgents,
    exchangeAgentCaught,
    exchangeBaseIncome,
    exchangeBlockadeCheck,
    exchangeIntelPrice,
    exchangeKnownSites,
    exchangeSpendable,
    exchangeState,
    exchangeWarPairs,
    exchangeYearly,
    flushTraces,
    fundUnderdogs,
    giftMaps,
    offerPlayerIntel,
    peekExchangeState,
    postContracts,
    registerExchange,
    sellIntel,
    type ExchangeState,
} from '../src/sim/scenario/threats/exchange';
import { KNOWLEDGE_CONFIRMED, KNOWLEDGE_SUSPECTED, knowledgeLevel, normalEmpires, revealTo } from '../src/sim/scenario/threats/framework';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });

function exGame(flags: Record<string, boolean> = {}, params: Record<string, number> = {}, older = true): { game: Game; g: Galaxy } {
    const { game } = createScenarioGame(base, { scenario: 'exchange', flags: { threatExchange: true, ...flags }, params: { exchangeYear: 0, exchangeExistChancePct: 100, exchangeMinYear: 0, ...params }, options: older ? age3 : undefined });
    return { game, g: game.galaxy };
}

function forceYear(g: Galaxy): void {
    g.scenario!.lastYear = gameYear(galaxyStarDate(g)) - 1;
}

function unregisterExchange(): void {
    for (const id of EXCHANGE_HANDLER_IDS) {
        registerScenarioGameStart({ id, run: () => undefined })();
        registerScenarioYearly({ id, run: () => undefined })();
        registerScenarioPeriodic({ id, periodDays: 1, run: () => undefined })();
        registerScenarioEvent({ id, event: 'builtObjectRemoved', run: () => undefined })();
    }
    for (const id of EXCHANGE_QUERY_IDS) registerScenarioQuery({ id, query: 'declareWarBlocked', run: (_g, v) => v })();
}

describe('The Exchange: flag off', () => {
    it('flag off: no state, and the same draws and digest as the game without the package', () => {
        const a = exGame({ threatExchange: false }, {}, false).game;
        runGameSeconds(a, 125);
        expect(peekExchangeState(a.galaxy)).toBeNull();
        unregisterExchange();
        try {
            const b = exGame({ threatExchange: false }, {}, false).game;
            runGameSeconds(b, 125);
            expect(b.galaxy.rnd.drawCount).toBe(a.galaxy.rnd.drawCount);
            expect(stateDigest(b.galaxy)).toBe(stateDigest(a.galaxy));
        } finally {
            registerExchange();
        }
    }, 1200000);
});

describe('The Exchange: forced appearance on seed 1 (shared game, in order)', () => {
    let game: Game;
    let g: Galaxy;
    let st: ExchangeState;
    let f: Empire;
    /** Two AI empires with colonies put at war: [weaker, stronger] as the Exchange sees them. */
    let weaker: Empire;
    let stronger: Empire;

    const year = (): number => gameYear(galaxyStarDate(g));

    it('appearance: a real faction with the station as base, stand-in capital, stock AI off, start tech + 1, pacts', () => {
        ({ game, g } = exGame());
        g.scenario!.flags['internalSecurity'] = true; // 19m leads (tests below)
        forceYear(g);
        runGameSeconds(game, 65);
        st = exchangeState(g);
        expect(st.placed).toBe(true);
        f = st.faction!;
        expect(f).not.toBeNull();
        expect(g.empires).toContain(f);
        expect(f.pirateEmpireBaseHabitat).toBeNull();
        expect(f.name.length).toBeGreaterThan(0);
        expect(f.leader).not.toBeNull(); // stock starting characters (portrait)
        expect(st.station!.bo.actualEmpire).toBe(f);
        expect(st.station!.bo.isResearchLab).toBe(true); // lab components on the station
        expect(f.capital).toBe(st.habitat);
        expect(st.habitat!.empire).toBeNull();
        expect(f.colonies.length).toBe(0);
        expect(f.initiateConstruction).toBe(false);
        expect(f.controlColonization).toBe(AutomationLevel.Undefined);
        expect(f.controlMilitaryAttacks).toBe(AutomationLevel.Undefined);
        expect(f.controlMilitaryFleets).toBe(false);
        expect(f.controlAgentAssignment).toBe(AutomationLevel.Undefined);
        expect(st.startTechLevel).toBe(0.5);
        expect(st.techLevel).toBe(1.5);
        for (const pf of g.pirateEmpires.filter((x) => x.active && x.pirateEmpireBaseHabitat !== null)) {
            expect(obtainPirateRelation(pf, f).type).toBe(PirateRelationType.Protection);
            expect(obtainPirateRelation(pf, f).monthlyProtectionFeeToThisEmpire).toBe(0);
        }
        expect(st.appearedYear).toBe(year());
        expect(st.incomeLog.length).toBe(1);
        expect(st.incomeLog[0].base).toBe(100000);
        expect(st.agentTarget).toBe(6);
        // Research potential: the stock pirate-faction branch (√ built objects × 10000 + half the labs of its research
        // stations; the first period may already have bought them; × 1.2 with an UltraGenius scientist, as on seed 1 since
        // the orbit-spacing deviation), not the population formula.
        const labs = st.researchStations.reduce((s: number, b) => s + 0.5 * (b.researchEnergy + b.researchHighTech + b.researchWeapons), 0);
        const genius = checkCharactersForTrait(getEmpireCharacters(f), CharacterRole.Scientist, CharacterTraitType.UltraGenius) ? 1.2 : 1.0;
        expect(annualResearchPotential(f)).toBeCloseTo((Math.sqrt(f.builtObjects.length) * 10000 + labs) * f.economyEfficiency * genius, 0);
    }, 600000);

    it('no wars: declarations by or on the Exchange are blocked; it never colonises', () => {
        const other = normalEmpires(g, f)[0];
        declareWar(g, other, f);
        declareWar(g, f, other);
        expect(obtainDiplomaticRelation(other, f).type).not.toBe(DiplomaticRelationType.War);
        expect(obtainDiplomaticRelation(f, other).type).not.toBe(DiplomaticRelationType.War);
        const [a, b] = normalEmpires(g, f).filter((e) => e !== g.playerEmpire && e.colonies.length > 0);
        declareWar(g, a, b);
        const w = exchangeWarPairs(g).find((x) => (x.weaker === a && x.stronger === b) || (x.weaker === b && x.stronger === a))!;
        expect(w).toBeDefined();
        weaker = w.weaker;
        stronger = w.stronger;
    }, 600000);

    it('income schedule and reserve: step × years since appearance, capped; the reserve is 20% of the year', () => {
        const y0 = st.appearedYear;
        expect(exchangeBaseIncome(g, st, y0)).toBe(100000);
        expect(exchangeBaseIncome(g, st, y0 + 1)).toBe(200000);
        expect(exchangeBaseIncome(g, st, y0 + 4)).toBe(500000);
        expect(exchangeBaseIncome(g, st, y0 + 9)).toBe(1000000);
        expect(exchangeBaseIncome(g, st, y0 + 30)).toBe(1000000);
        exchangeYearly(g, y0 + 1);
        expect(st.incomeLog.at(-1)).toEqual({ year: y0 + 1, base: 200000 });
        expect(st.reserve).toBeCloseTo(0.2 * st.incomeThisYear, 6);
        expect(st.incomeThisYear).toBeGreaterThanOrEqual(200000);
        exchangeYearly(g, y0 + 2);
        expect(st.incomeLog.at(-1)).toEqual({ year: y0 + 2, base: 300000 });
        expect(st.reserve).toBeCloseTo(0.2 * st.incomeThisYear, 6);
        expect(st.purse).toBeGreaterThanOrEqual(st.reserve - 1e-6);
        expect(st.agentTarget).toBeGreaterThanOrEqual(7); // +1 a year while income allows
    }, 600000);

    it('underdog funding: the weaker side gets 5% of its treasury, and funding stops at the reserve', () => {
        weaker.stateMoney = 400000;
        st.purse = st.reserve + 1000000;
        const before = weaker.stateMoney;
        const purseBefore = st.purse;
        const total = fundUnderdogs(g, st);
        expect(weaker.stateMoney - before).toBeCloseTo(0.05 * before, 6);
        expect(purseBefore - st.purse).toBeCloseTo(total, 6);
        expect(st.fundLog.some((x) => x.empireId === weaker.empireId)).toBe(true);
        // A nearly empty purse: every war together gets at most what is above the reserve.
        st.purse = st.reserve + 500;
        const got = fundUnderdogs(g, st);
        expect(got).toBeLessThanOrEqual(500 + 1e-6);
        expect(st.purse).toBeGreaterThanOrEqual(st.reserve - 1e-6);
        expect(fundUnderdogs(g, st)).toBe(0);
    }, 600000);

    it('map gift: the weaker side receives the stronger side\'s galaxy and operations maps', () => {
        const n = weaker.empiresViewable.filter((e) => e === stronger).length;
        giftMaps(g, st, year());
        expect(weaker.empiresViewable.filter((e) => e === stronger).length).toBe(n + 1); // StealOperationsMap
        expect(st.giftLog.at(-1)).toMatchObject({ weakerId: weaker.empireId, strongerId: stronger.empireId });
    }, 600000);

    it('intel market: an AI at war buys when its treasury exceeds 4 × the price; the rival learns on discovery', () => {
        const buyer = weaker !== g.playerEmpire ? weaker : stronger;
        const rival = buyer === weaker ? stronger : weaker;
        const price = exchangeIntelPrice(g, rival);
        expect(price).toBe(Math.round(20000 * Math.max(1, Math.sqrt(rival.colonies.length))));
        buyer.stateMoney = price * 3; // not enough
        const n = st.sales.length;
        aiIntelSales(g, st);
        expect(st.sales.filter((s) => s.buyerId === buyer.empireId).length).toBe(st.sales.slice(0, n).filter((s) => s.buyerId === buyer.empireId).length);
        buyer.stateMoney = price * 10;
        const purse = st.purse;
        aiIntelSales(g, st);
        const sale = st.sales.at(-1)!;
        expect(sale).toMatchObject({ buyerId: buyer.empireId, rivalId: rival.empireId, price, by: 'ai' });
        expect(buyer.stateMoney).toBeCloseTo(price * 9, 6);
        expect(st.purse - purse).toBeGreaterThanOrEqual(price - 1e-6);
        const trace = st.traces.find((t) => t.victimId === rival.empireId && t.actorId === buyer.empireId);
        expect(trace).toBeDefined();
        flushTraces(g, st);
        expect(st.traces).toContain(trace); // the rival does not know the Exchange yet
        revealTo(g, st.station!, rival, KNOWLEDGE_SUSPECTED);
        flushTraces(g, st); // (every period)
        expect(st.traces).not.toContain(trace);
    }, 600000);

    it('player decision: "Buy intelligence on <rival> for N credits", answered through the decision path', () => {
        const player = g.playerEmpire!;
        const rival = normalEmpires(g, f).find((e) => e !== player && e.colonies.length > 0)!;
        if (obtainDiplomaticRelation(player, rival).type !== DiplomaticRelationType.War) declareWar(g, player, rival);
        player.stateMoney = 10000000;
        const d = offerPlayerIntel(g, st)!;
        expect(d).not.toBeNull();
        expect(d.kind).toBe(EXCHANGE_BUY_INTEL_DECISION);
        const price = exchangeIntelPrice(g, rival);
        expect(d.title).toContain(String(price));
        expect(d.title).toContain(rival.name);
        expect(pendingScenarioDecisions(g, player).some((x) => x.id === d.id)).toBe(true);
        expect(answerScenarioDecision(g, d.id, 'galaxyMap', 'player')).toBe(true);
        expect(st.sales.at(-1)).toMatchObject({ buyerId: player.empireId, rivalId: rival.empireId, item: 'galaxyMap', by: 'player', price });
        expect(player.stateMoney).toBeCloseTo(10000000 - price, 6);
        expect(sellIntel(g, st, player, rival, 'operationsMap', 1e12, 'player')).toBe(false); // cannot pay
    }, 600000);

    it('contracts: Defend on the weaker side, Attack on the stronger side, in the Exchange\'s name, paid through the stock paths', () => {
        const pf = g.pirateEmpires.find((x) => x.active && x.pirateEmpireBaseHabitat !== null)!;
        changePirateRelation(pf, weaker, PirateRelationType.Protection, galaxyStarDate(g), 0);
        st.purse = st.reserve + 10000000;
        const posted = postContracts(g, st);
        expect(posted).toBeGreaterThan(0);
        const mine = f.pirateMissions.items.filter((a) => a !== null && a.requestingEmpire === f);
        const defend = mine.filter((a) => a!.type === EmpireActivityType.Defend);
        const attack = mine.filter((a) => a!.type === EmpireActivityType.Attack);
        expect(defend.length).toBeGreaterThan(0);
        expect(attack.length).toBeGreaterThan(0);
        expect(defend.some((a) => a!.targetEmpire === weaker)).toBe(true);
        for (const a of defend) {
            const client = a!.targetEmpire!;
            expect(exchangeWarPairs(g).map((w) => w.weaker)).toContain(client);
            expect([...client.colonies, ...client.spacePorts]).toContain(a!.target);
            expect(g.pirateMissions.items).toContain(a);
        }
        const strongSides = exchangeWarPairs(g).map((w) => w.stronger);
        expect(attack.some((a) => a!.targetEmpire === stronger)).toBe(true);
        for (const a of attack) {
            expect(strongSides).toContain(a!.targetEmpire);
            expect(a!.targetEmpire!.builtObjects).toContain(a!.target);
        }
        expect(postContracts(g, st)).toBe(0); // no duplicates
        expect(exchangeSpendable(st)).toBeGreaterThanOrEqual(0);
        // Attack paid on completion (Empire.4.cs 1543 CompletePirateMission): from the Exchange's treasury → the purse.
        const atk = attack.find((a) => a!.targetEmpire === stronger)!;
        atk.assignedEmpire = pf;
        const pirateMoney = pf.stateMoney;
        const purse = st.purse;
        completePirateMission(g, pf, atk);
        expect(pf.stateMoney - pirateMoney).toBeCloseTo(atk.price, 6);
        expect(f.stateMoney).toBeCloseTo(-atk.price, 6);
        // The period sweeps the treasury into the purse:
        st.purse += f.stateMoney;
        f.stateMoney = 0;
        expect(purse - st.purse).toBeCloseTo(atk.price, 6);
        // Defend completes (not fails) though the target is the client's: the pirateDefendClient query.
        const def = defend.find((a) => a!.targetEmpire === weaker)!;
        def.assignedEmpire = pf;
        def.bidTimeRemaining = 0;
        def.expiryDate = galaxyStarDate(g) - 1;
        pf.pirateMissions.add(def);
        const before = pf.stateMoney;
        reviewPirateDefendMissions(g, f, galaxyStarDate(g));
        expect(pf.stateMoney - before).toBeCloseTo(def.price, 6);
    }, 600000);

    it('agents: idle agents run stock missions back to back; a caught agent opens a lead, a second catch confirms it', () => {
        st.purse = st.reserve + 10000000;
        for (const c of st.missions) c.agent.mission = null;
        st.missions = [];
        const n = assignAgents(g, st);
        expect(n).toBeGreaterThan(0);
        for (const m of st.missions) {
            expect(characterMission(m.agent)).toBe(m.mission);
            expect(m.mission.targetEmpire).toBe(m.victim);
            expect(m.mission.timeLength).toBeGreaterThan(0);
        }
        // The stock resolution runs them (PerformIntelligenceMissions); run until a target's counter-intelligence
        // or a detected outcome catches one (seed 1: within the first year; the trajectory moves with sim changes).
        const caughtBefore = st.caughtLog.length;
        for (let i = 0; i < 30 && st.caughtLog.length === caughtBefore; i++) runGameSeconds(game, 60);
        expect(st.caughtLog.length).toBeGreaterThan(caughtBefore);
        const victim = g.empires.find((e) => e.empireId === st.caughtLog.at(-1)!.victimId)!;
        const sec = peekSecurityState(g)!;
        const lead = () => sec.leads.find((l) => l.kind === 'exchangeAgent' && l.empire === victim && !l.closed);
        expect(lead()).toBeDefined();
        expect(knowledgeLevel(st.station!, victim)).toBeGreaterThanOrEqual(KNOWLEDGE_SUSPECTED);
        if ((st.catches[victim.empireId] ?? 0) < 2) exchangeAgentCaught(g, st, victim, 5);
        expect(lead()!.level).toBe('confirmed');
        expect(knowledgeLevel(st.station!, victim)).toBe(KNOWLEDGE_CONFIRMED);
        expect(exchangeKnownSites(g, victim).some((s) => s.target === st.station!.bo)).toBe(true);
    }, 1200000);

    it('blockade end: an empire that confirmed it blockades the station for 120 days; the faction is torn down', () => {
        const by = normalEmpires(g, f).find((e) => knowledgeLevel(st.station!, e) >= KNOWLEDGE_CONFIRMED)!;
        expect(by).toBeDefined();
        const ends: GameEndEventArgs[] = [];
        setGameEndHandler(g, (e) => ends.push(e));
        expect(setupBlockadeBuiltObject(g, by, st.station!.bo)).toBe(true);
        for (let i = 0; i < 3; i++) exchangeBlockadeCheck(g);
        expect(st.ended).toBe(false);
        exchangeBlockadeCheck(g);
        expect(st.ended).toBe(true);
        expect(f.active).toBe(false);
        expect(st.purse).toBe(0);
        expect(st.fleets.length).toBe(0);
        expect(ends.map((e) => e.code)).toEqual([EXCHANGE_CODE_CONTAINED]);
        setGameEndHandler(g, null);
        runGameSeconds(game, 65); // the galaxy runs on without it
        expect(peekExchangeState(g)!.ended).toBe(true);
    }, 600000);
});

describe('The Exchange: Defend contracts for any client, grudges (shared game, in order)', () => {
    let game: Game;
    let g: Galaxy;
    let st: ExchangeState;
    let f: Empire;
    const now = (): number => galaxyStarDate(g);

    it('setup: forced appearance', () => {
        ({ game, g } = exGame());
        forceYear(g);
        runGameSeconds(game, 65);
        st = exchangeState(g);
        f = st.faction!;
        expect(f).not.toBeNull();
    }, 600000);

    it('Defend: a pirate bids on an Exchange-financed contract for a colony it does not protect, and is paid; a normal empire\'s is refused', () => {
        // A pirate faction with fleets and a client colony within its stock defend range (Empire.2.cs 2045) it does not protect.
        // The nearest in-range unprotected client colony of a pirate faction (Empire.2.cs 2045's range), the one needing
        // the least defence; the faction gets warships (its own newest design, bought at its base) until it is strong enough.
        let pick: { pf: Empire; client: Empire; colony: (typeof f.colonies)[number]; need: number } | null = null;
        const range = Math.max(g.sectorSize * 2.0, g.sizeX * 0.2);
        for (const pf of g.pirateEmpires.filter((x) => x.active && x.pirateEmpireBaseHabitat !== null)) {
            for (const client of normalEmpires(g, f)) {
                if (obtainPirateRelation(pf, client).type === PirateRelationType.Protection) continue;
                for (const h of client.colonies) {
                    const d = g.calculateDistance(pf.pirateEmpireBaseHabitat!.xpos, pf.pirateEmpireBaseHabitat!.ypos, h.xpos, h.ypos);
                    const need = estimatedDefensiveForceRequired(g, h, false, g.difficultyLevel);
                    if (d < range && (pick === null || need < pick.need)) pick = { pf, client, colony: h, need };
                }
            }
        }
        expect(pick).not.toBeNull();
        const { pf, client, colony, need } = pick!;
        const design = latestDesignsFindNewestCanBuild(pf, BuiltObjectSubRole.Frigate) ?? latestDesignsFindNewestCanBuild(pf, BuiltObjectSubRole.Escort)!;
        const fleet = new ShipGroup(g);
        fleet.empire = pf;
        for (let i = 0; i < 60 && totalMobileMilitaryFirepowerNotAttackingDefending(pf.builtObjects).firepower <= need; i++) {
            const bo = new BuiltObject(design, `Test raider ${i}`, g, true);
            bo.empire = pf;
            pf.addBuiltObjectToGalaxy(bo, pf.pirateEmpireBaseHabitat, false, true, -2000000001, -2000000001, false);
            fleet.ships.push(bo);
            bo.shipGroup = fleet;
        }
        fleet.leadShip = fleet.ships[0] ?? null;
        empireShipGroups(pf).push(fleet);
        expect(totalMobileMilitaryFirepowerNotAttackingDefending(pf.builtObjects).firepower).toBeGreaterThan(need);
        const price = calculatePirateDefendPrice(g, f, colony);
        // A normal empire's own Defend contract on the same colony: refused (no protection pact).
        const own = new EmpireActivity(client, client, now() + 600000, EmpireActivityType.Defend, colony, price);
        expect(pirateCheckAcceptDefendMission(g, pf, own, 1e12)).toBe(false);
        // The Exchange's: accepted by the same stock check (the distance / strength tests still apply).
        st.purse = st.reserve + 10000000;
        expect(exchangePostContract(g, st, 'defend', client, colony, price)).toBe(true);
        const act = f.pirateMissions.items.find((a) => a !== null && a.target === colony && a.type === EmpireActivityType.Defend)!;
        expect(pirateCheckAcceptDefendMission(g, pf, act, 1e12)).toBe(true);
        // Too far: the same contract on a colony outside the faction's range is refused.
        const far = normalEmpires(g, f).flatMap((e) => e.colonies).find((h) => g.calculateDistance(pf.pirateEmpireBaseHabitat!.xpos, pf.pirateEmpireBaseHabitat!.ypos, h.xpos, h.ypos) >= Math.max(g.sectorSize * 2.0, g.sizeX * 0.2));
        if (far !== undefined) expect(pirateCheckAcceptDefendMission(g, pf, new EmpireActivity(far.empire, f, now() + 600000, EmpireActivityType.Defend, far, price), 1e12)).toBe(false);
        // The stock bid (pirate regular block), the stock assignment after the bid time, the stock completion.
        pf.policy!.bidOnPirateDefendMissions = true;
        for (const a of [...pf.pirateMissions.items]) if (a !== null && a.type !== EmpireActivityType.Smuggle) pf.pirateMissions.remove(a); // free a fleet slot
        pirateCheckMissionsOnOffer(g, pf, now());
        expect(act.assignedEmpire).toBe(pf);
        reviewPirateMissionsAndAssign(g, now(), 61);
        expect(act.bidTimeRemaining).toBe(0);
        expect(pf.pirateMissions.items).toContain(act);
        act.expiryDate = now() - 1;
        const before = pf.stateMoney;
        reviewPirateDefendMissions(g, f, now());
        expect(pf.stateMoney - before).toBeCloseTo(act.price, 6);
    }, 600000);

    it('grudges accrue from every source and decay yearly', () => {
        const others = normalEmpires(g, f).filter((e) => e !== g.playerEmpire);
        const [e1, e2, e3, e4] = [others[0], others[1], others[2 % others.length], others[others.length - 1]];
        st.grudges = {};
        const gr = (e: Empire): number => exchangeGrudge(st, e);
        // A caught agent.
        exchangeAgentCaught(g, st, e1, 5);
        expect(gr(e1)).toBe(EXCHANGE_GRUDGE.catch);
        // A blockade of the station (per period it stands).
        expect(setupBlockadeBuiltObject(g, e2, st.station!.bo)).toBe(true);
        accrueGrudgesPeriodic(g, st);
        expect(gr(e2)).toBe(EXCHANGE_GRUDGE.blockade);
        cancelBlockadeBuiltObject(g, e2, st.station!.bo);
        // An attack: the stock kill signal on one of its objects.
        const before3 = gr(e3);
        scenarioEmit(g, 'builtObjectKilledBy', { builtObject: st.station!.bo, destroyer: e3 });
        expect(gr(e3) - before3).toBe(EXCHANGE_GRUDGE.attack);
        // A council sanction (counted once per sanction, for every member).
        const c = { id: 991, members: [e1, e4], sanctions: [{ target: f, kind: 'sanction', resourceId: -1, year: gameYear(now()) }] } as unknown as Council;
        councilState(g).councils.push(c);
        const b1 = gr(e1);
        const b4 = gr(e4);
        accrueGrudgesPeriodic(g, st);
        accrueGrudgesPeriodic(g, st);
        expect(gr(e1) - b1).toBe(EXCHANGE_GRUDGE.sanction);
        expect(gr(e4) - b4).toBe(EXCHANGE_GRUDGE.sanction);
        councilState(g).councils.splice(councilState(g).councils.indexOf(c), 1);
        // The player refusing the intel offer repeatedly (the second refusal on).
        const player = g.playerEmpire!;
        const rival = others.find((e) => e.colonies.length > 0)!;
        if (obtainDiplomaticRelation(player, rival).type !== DiplomaticRelationType.War) declareWar(g, player, rival);
        const d1 = offerPlayerIntel(g, st)!;
        answerScenarioDecision(g, d1.id, 'decline', 'player');
        expect(gr(player)).toBe(0);
        const d2 = offerPlayerIntel(g, st)!;
        answerScenarioDecision(g, d2.id, 'decline', 'player');
        expect(gr(player)).toBe(EXCHANGE_GRUDGE.refusal);
        // The worst 19o ledger standing toward the Exchange, and the yearly decay.
        g.scenario!.flags['reputationLedger'] = true;
        applyReputation(g, e4, f, -70, { cause: 'exchange.agentCaught', source: '19f' });
        const snap = { ...st.grudges };
        exchangeGrudgeYearly(g, st);
        for (const [id, v] of Object.entries(snap)) {
            const want = v * 0.8 + (Number(id) === e4.empireId ? 70 : 0);
            expect(st.grudges![Number(id)]).toBeCloseTo(want, 6);
        }
        expect(st.grudgeLog!.map((x) => x.source)).toEqual(expect.arrayContaining(['catch', 'blockade', 'attack', 'sanction', 'refusal', 'reputation']));
        g.scenario!.flags['reputationLedger'] = false;
    }, 600000);

    it('targeting: a grudged empire at peace gets missions and Attack contracts first; a non-grudged peaceful one none; never funded or sold to', () => {
        const peaceful = normalEmpires(g, f).filter((e) => e !== g.playerEmpire && e.colonies.length > 0 && !normalEmpires(g, f).some((o) => o !== e && obtainDiplomaticRelation(e, o).type === DiplomaticRelationType.War));
        st.grudges = {};
        const baseTargets = exchangeMissionTargets(g, f);
        const p2 = peaceful.find((e) => !baseTargets.includes(e));
        const p1 = peaceful.find((e) => e !== p2);
        expect(p1).toBeDefined();
        expect(p2).toBeDefined();
        st.grudges[p1!.empireId] = 500;
        expect(exchangeIsGrudged(g, st, p1!)).toBe(true);
        expect(exchangeMissionTargets(g, f)[0]).toBe(p1);
        expect(exchangeMissionTargets(g, f)).not.toContain(p2);
        // Agents: all free, a rich purse.
        for (const m of st.missions) m.agent.mission = null;
        st.missions = [];
        st.purse = st.reserve + 10000000;
        const n = assignAgents(g, st);
        expect(n).toBeGreaterThan(0);
        expect(st.missions.every((m) => m.victim === p1)).toBe(true);
        expect(st.missions.some((m) => m.victim === p2)).toBe(false);
        const T = [5, 10, 4, 1]; // SabotageColony, AssassinateCharacter, StealTechData, SabotageConstruction
        expect(st.missions.every((m) => T.includes(m.mission.type))).toBe(true);
        // Contracts: Attack on the grudged empire's bases (at peace), nothing on the non-grudged one.
        postContracts(g, st);
        const mine = f.pirateMissions.items.filter((a) => a !== null && a.requestingEmpire === f);
        if (g.pirateEmpires.some((pf) => pf.active && obtainPirateRelation(pf, p1!).type !== PirateRelationType.Protection) && p1!.builtObjects.some((b) => b.role === BuiltObjectRole.Base && !b.hasBeenDestroyed)) {
            expect(mine.some((a) => a!.type === EmpireActivityType.Attack && a!.targetEmpire === p1)).toBe(true);
        }
        expect(mine.some((a) => a!.targetEmpire === p2)).toBe(false);
        // Never sold intel.
        p1!.stateMoney = 1e9;
        expect(sellIntel(g, st, p1!, p2!, 'galaxyMap', 1000, 'ai')).toBe(false);
    }, 600000);
});
