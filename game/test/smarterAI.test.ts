// Smarter AI add-on (scenarios/smarter-ai; src/sim/scenario/smarterAI/): flags off = the faithful game; AI empires get
// the three research orders (Efficient HyperDrives 11th in Energy), the player and pirates do not; the threat / reach
// rules move the right projects; growth taxes (0% below the threshold, stock above, the debt override fullest first);
// the flags / params / orders survive a save; the wizard's Other Empires choice reaches StartGameOptions.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGameRun } from './helpers/gameCache';
import { createScenarioGame, scenarioIndexFs } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateDigest } from '../src/sim/tick/digest';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { defaultStartGameOptions, toCreateGameOptions } from '../src/sim/startGameOptions';
import { scenarioQuery } from '../src/sim/scenario/hooks';
import { IndustryType } from '../src/sim/types';
import { reviewTaxes } from '../src/sim/taxes';
import { COMPOSITE_SCENARIO_ID, addonCatalog, defaultSmarterAIChoice } from '../src/sim/scenario/addons';
import { isSmarterAIEmpire, smarterAIState, type SmarterAIState } from '../src/sim/scenario/smarterAI/common';
import { PULL_PLACES, dynamicOrders, ensureResearchOrders, pullForward, reachSignal } from '../src/sim/scenario/smarterAI/research';
import { colonyFullness, planGrowthTaxes } from '../src/sim/scenario/smarterAI/taxes';
import { addonChoiceFor } from '../src/ui/screens/newGameWizard';
import type { Habitat } from '../src/sim/types';
import type { Design } from '../src/sim/design';
import { CharacterRole, generateNewCharacter, getEmpireCharacters } from '../src/sim/characters';
import { IntelligenceMissionType, characterMission } from '../src/sim/espionage';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { WonderType } from '../src/sim/researchSystem';
import { determineResearchStationLocation } from '../src/sim/stationPlacement';
import { assignScientists, atResearchCap, bestKnownBonus, improvingLocations, locationBonus } from '../src/sim/scenario/smarterAI/researchStations';
import { ensureWonderPlan, pickWonder, wonderFit, wonderPath } from '../src/sim/scenario/smarterAI/wonders';
import { counterIntelShare, steerAgents } from '../src/sim/scenario/smarterAI/espionage';
import { protectionWorthIt, sharedThreatPlans } from '../src/sim/scenario/smarterAI/diplomacy';
import { planetaryFacilityDefinitionsStatic } from '../src/sim/construction/facilities';

const SC = 'smarter-ai';
const ALL_OFF = { smarterAI: false, smarterAIResearch: false, smarterAIGrowthTax: false, smarterAIBudget: false, smarterAIRetrofit: false, smarterAIDefence: false, smarterAIPirates: false, smarterAIColonies: false, smarterAIIndependents: false, smarterAIResearchStations: false, smarterAIWonders: false, smarterAIEspionage: false, smarterAIDiplomacy: false };
const STATECRAFT_ON = { smarterAIResearchStations: true, smarterAIWonders: true, smarterAIEspionage: true, smarterAIDiplomacy: true };

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

let shared: { game: Game; gameData: GameData } | null = null;
function smartGame(): { game: Game; gameData: GameData } {
    if (shared === null) shared = createScenarioGame(base, { scenario: SC });
    return shared;
}
const aiEmpires = (g: Galaxy): Empire[] => g.empires.filter((e) => isSmarterAIEmpire(g, e));
const peek = (g: Galaxy): SmarterAIState | undefined => g.scenario!.state.smarterAI as SmarterAIState | undefined;

describe('flags off = faithful game', () => {
    it('the add-on with every flag off runs 600 s byte-identical to the plain seed-1 game', () => {
        const ref = cachedTickGameRun(base, { seconds: 600 });
        const { game } = createScenarioGame(base, { scenario: SC, flags: ALL_OFF });
        runGameSeconds(game, 600);
        expect(stateDigest(game.galaxy)).toBe(stateDigest(ref.game.galaxy));
        expect(game.galaxy.rnd.drawCount).toBe(ref.game.galaxy.rnd.drawCount);
        expect('smarterAI' in game.galaxy.scenario!.state).toBe(false);
        expect('smarterAIStatecraft' in game.galaxy.scenario!.state).toBe(false);
    }, 1200000);
});

describe('1. optimised research order', () => {
    it('AI empires get the three orders (Efficient HyperDrives 11th in Energy); the player and pirates do not', () => {
        const g = smartGame().game.galaxy;
        const st = peek(g)!;
        const ais = aiEmpires(g);
        expect(ais.length).toBeGreaterThan(0);
        for (const e of ais) {
            const o = st.orders[String(e.empireId)];
            expect(o).toBeDefined();
            const rs = e.research;
            const specials = rs.techTree.filter((n) => n.def.industry === 1 && rs.raceSpecialFor(n, e.dominantRace!)).length;
            expect(o.base.energy.indexOf(163)).toBe(10 + specials);
            expect(o.base.energy.slice(0, 5)).toEqual([363, 166, 362, 105, 95]);
            // Every researchable project of each industry, once.
            for (const [ind, list] of [[0, o.base.weapons], [1, o.base.energy], [2, o.base.highTech]] as const) {
                const want = rs.techTree.filter((n) => n.def.industry === ind && rs.raceMayResearch(n, e.dominantRace!)).map((n) => n.def.projectId);
                expect([...list].sort((a, b) => a - b)).toEqual([...new Set(want)].sort((a, b) => a - b));
            }
            expect(o.base.highTech[0]).toBe(212); // Enhanced Resource Exploration
            const w = o.base.weapons;
            expect(w.indexOf(67)).toBeLessThan(w.indexOf(330)); // Armor Plating before the ground troops
            expect(w.indexOf(330)).toBeLessThan(w.indexOf(51)); // ... before point defence
            expect(scenarioQuery(g, 'researchProjectOrder', [], { empire: e, industry: IndustryType.Energy })).toBe(o.current.energy);
        }
        const player = g.playerEmpire!;
        expect(st.orders[String(player.empireId)]).toBeUndefined();
        expect(scenarioQuery(g, 'researchProjectOrder', [], { empire: player, industry: IndustryType.Energy })).toEqual([]);
        for (const p of g.pirateEmpires) {
            expect(st.orders[String(p.empireId)]).toBeUndefined();
            expect(scenarioQuery(g, 'researchProjectOrder', [], { empire: p, industry: IndustryType.Weapon })).toEqual([]);
        }
    }, 600000);

    it('threat pulls shields / damage control and armour / point defence forward; low reach pulls the hyperdrive fuel techs', () => {
        expect(pullForward([1, 2, 3, 4, 5, 6, 7, 8], () => false, [[7]])).toEqual([1, 7, 2, 3, 4, 5, 6, 8]);
        expect(pullForward([1, 2, 3, 4, 5, 6, 7, 8], (id) => id === 7, [[7, 8]])).toEqual([1, 8, 2, 3, 4, 5, 6]);
        const g = smartGame().game.galaxy;
        const e = aiEmpires(g)[0];
        const o = ensureResearchOrders(g, e);
        const calm = dynamicOrders(e, o.base, false, false);
        const threat = dynamicOrders(e, o.base, true, false);
        const reach = dynamicOrders(e, o.base, false, true);
        const done = (id: number): boolean => e.research.techTree.some((n) => n.def.projectId === id && n.isResearched);
        const first = (seq: number[]): number => seq.find((id) => !done(id))!;
        const moved = (a: number[], b: number[], id: number): number => a.indexOf(id) - b.indexOf(id);
        expect(moved(calm.energy, threat.energy, first([96, 97, 92, 89]))).toBeGreaterThan(0);
        expect(moved(calm.energy, threat.energy, first([113, 114]))).toBeGreaterThan(0);
        expect(moved(calm.weapons, threat.weapons, first([67, 68, 69, 70]))).toBeGreaterThan(0);
        expect(moved(calm.weapons, threat.weapons, first([51, 52, 53, 54, 55, 56]))).toBeGreaterThan(0);
        expect(moved(calm.energy, threat.energy, first([96, 97, 92, 89]))).toBeLessThanOrEqual(PULL_PLACES + 1);
        if (!done(163)) expect(moved(calm.energy, reach.energy, 163)).toBeGreaterThan(0);
        expect(moved(calm.energy, reach.energy, 164)).toBe(PULL_PLACES);
        expect(threat.highTech).toEqual(calm.highTech);
        // The reach signal: a huge required density is low density; a lax one with no spread is not.
        expect(reachSignal(g, e, { jumpRange: 1, spreadRange: 1e12, minSystems: 1 })).toBe(true);
        expect(reachSignal(g, e, { jumpRange: 1e12, spreadRange: 1e12, minSystems: 0 })).toBe(false);
        expect(reachSignal(g, e, { jumpRange: 1e12, spreadRange: 0, minSystems: 0 })).toBe(e.colonies.some((h) => h !== e.capital));
    }, 600000);
});

describe('2. growth taxes', () => {
    it('the debt override taxes the fullest growing colonies first, until the shortfall is covered', () => {
        const cs = [
            { fullness: 0.2, contribution: 100 },
            { fullness: 0.6, contribution: 50 },
            { fullness: 0.4, contribution: 80 },
        ];
        expect(planGrowthTaxes(cs, 0)).toEqual([]);
        expect(planGrowthTaxes(cs, 40)).toEqual([1]);
        expect(planGrowthTaxes(cs, 60)).toEqual([1, 2]);
        expect(planGrowthTaxes(cs, 1e9)).toEqual([1, 2, 0]);
    });

    it('below the threshold 0%, above it the stock rate; in debt the stock rate; the player is untouched', () => {
        const g = smartGame().game.galaxy;
        const s = g.scenario!;
        const e = aiEmpires(g).find((x) => x.colonies.some((h) => colonyFullness(h) < 1 && h.population.totalAmount > 0))!;
        expect(e).toBeDefined();
        const empires = [e, g.playerEmpire!];
        const snap = empires.map((x) => x.colonies.map((h) => h.taxRate));
        const restore = (): void => empires.forEach((x, i) => x.colonies.forEach((h, j) => (h.taxRate = snap[i][j])));
        const review = (): number[][] => {
            restore();
            delete (s.state.smarterAI as SmarterAIState).debt[String(e.empireId)];
            for (const x of empires) reviewTaxes(g, x);
            return empires.map((x) => x.colonies.map((h) => h.taxRate));
        };
        const money = e.stateMoney;
        e.stateMoney = 1e12;
        s.flags.smarterAIGrowthTax = false;
        const stock = review();
        s.flags.smarterAIGrowthTax = true;
        s.params.smarterAIGrowthTaxThreshold = 0;
        expect(review()).toEqual(stock);
        s.params.smarterAIGrowthTaxThreshold = 100;
        const growth = review();
        e.colonies.forEach((h, j) => expect(growth[0][j]).toBe(colonyFullness(h) < 1 ? 0 : stock[0][j]));
        expect(growth[1]).toEqual(stock[1]);
        expect(stock[0].some((r, j) => r > 0 && colonyFullness(e.colonies[j]) < 1)).toBe(true);
        e.stateMoney = -1e12;
        expect(review()[0]).toEqual(stock[0]);
        expect(smarterAIState(g).debt[String(e.empireId)]).toBe(true);
        e.stateMoney = money;
        s.params.smarterAIGrowthTaxThreshold = 70;
        restore();
    }, 600000);
});

describe('save round trip', () => {
    it('the flags, params and research orders survive save / load', () => {
        const a = createScenarioGame(base, { scenario: SC, flags: { smarterAIGrowthTax: false }, params: { smarterAIGrowthTaxThreshold: 55 } });
        const g = a.game.galaxy;
        const time = new GalaxyTime();
        time.togglePause();
        time.advance(g.nowMs);
        const text = serializeGame(a.game as never, time, { ...defaultStartGameOptions(), seed: 1, scenario: { id: SC, flags: { ...g.scenario!.flags }, params: { ...g.scenario!.params } } });
        const g2 = deserializeGame(text, a.gameData).game.galaxy;
        expect(g2.scenario!.id).toBe(SC);
        expect(g2.scenario!.flags).toMatchObject({ smarterAI: true, smarterAIResearch: true, smarterAIGrowthTax: false, ...STATECRAFT_ON });
        expect(g2.scenario!.params).toEqual({ smarterAIGrowthTaxThreshold: 55 });
        expect(peek(g2)!.orders).toEqual(peek(g)!.orders);
        // A save without the orders (an older one) rebuilds them on first use, identically.
        delete peek(g2)!.orders[String(aiEmpires(g2)[0].empireId)];
        expect(ensureResearchOrders(g2, aiEmpires(g2)[0]).base).toEqual(peek(g)!.orders[String(aiEmpires(g)[0].empireId)].base);
    }, 600000);
});

describe('wizard', () => {
    it("the Other Empires page's Smarter AI choice reaches StartGameOptions and createGame's options", () => {
        const cat = addonCatalog(scenarioIndexFs());
        const none = { flags: {}, params: {} };
        expect(addonChoiceFor(cat, [], none, defaultSmarterAIChoice())).toBeNull(); // off by default
        const smart = { enabled: true, research: true, growthTaxes: false, growthTaxThreshold: 55 };
        const choice = addonChoiceFor(cat, [], none, smart)!;
        expect(choice).toMatchObject({ id: SC, flags: { smarterAI: true, smarterAIResearch: true, smarterAIGrowthTax: false, ...STATECRAFT_ON }, params: { smarterAIGrowthTaxThreshold: 55 }, addons: [SC] });
        const opts = toCreateGameOptions({ ...defaultStartGameOptions(), seed: 3, scenario: choice, smarterAI: smart }, base, ['A']);
        expect(opts.scenarioFlags).toEqual(choice.flags);
        expect(opts.scenarioParams).toEqual(choice.params);
        // With a Scenario-page add-on: a composite that includes it.
        const both = addonChoiceFor(cat, ['reputation'], none, smart)!;
        expect(both.id).toBe(COMPOSITE_SCENARIO_ID);
        expect(both.addons).toContain(SC);
        expect(both.flags.smarterAI).toBe(true);
        expect(both.flags.reputationLedger).toBe(true);
        // Unticked on the Other Empires page: dropped even if an old choice listed it.
        expect(addonChoiceFor(cat, [SC], none, { ...smart, enabled: false })).toBeNull();
        // The statecraft sub-switches.
        expect(addonChoiceFor(cat, [], none, { ...smart, wonders: false, espionage: false })!.flags).toMatchObject({ smarterAIWonders: false, smarterAIEspionage: false, smarterAIResearchStations: true, smarterAIDiplomacy: true });
    });
});

describe('7. smarter research stations', () => {
    it('keeps only locations that beat the field best, best first; no plain stations at the cap; best scientists spread by rank', () => {
        const loc = (bonus: number, industry: IndustryType): Habitat => ({ researchBonus: bonus, researchBonusIndustry: industry }) as unknown as Habitat;
        const a = loc(10, IndustryType.Energy);
        const b = loc(30, IndustryType.Energy);
        const c = loc(20, IndustryType.Weapon);
        const best = new Map([[IndustryType.Weapon, 0.25], [IndustryType.Energy, 0.15], [IndustryType.HighTech, 0]]);
        expect(improvingLocations([a, b, c], best)).toEqual([b]);
        // Two scientists strongest in Energy: the second-best goes to Weapons where 8 / 1 beats 9 / 2.
        expect([...assignScientists([[0, 10, 0], [8, 9, 0], [0, 0, 5]], [true, true, false]).entries()]).toEqual([[0, 1], [1, 0]]);
        const g = smartGame().game.galaxy;
        const s = g.scenario!;
        const e = aiEmpires(g)[0];
        const on = determineResearchStationLocation(g, e, false, true, false);
        const kb = bestKnownBonus(g, e);
        for (const h of on) expect(locationBonus(h, h.researchBonusIndustry)).toBeGreaterThan(kb.get(h.researchBonusIndustry)!);
        s.flags.smarterAIResearchStations = false;
        const off = determineResearchStationLocation(g, e, false, true, false);
        s.flags.smarterAIResearchStations = true;
        expect(off.length).toBeGreaterThanOrEqual(on.length);
        // Plain stations: allowed below the cap, refused at it (no improving location).
        const design = {} as Design;
        const habitats = e.researchHabitats;
        const pop = e.totalPopulation;
        e.researchHabitats = [];
        const args = { empire: e, weapons: null, energy: null, highTech: null };
        expect(atResearchCap(e)).toBe(false);
        expect(scenarioQuery(g, 'researchStationDesign', design, args)).toBe(design);
        e.totalPopulation = 1000;
        expect(atResearchCap(e)).toBe(true);
        expect(scenarioQuery(g, 'researchStationDesign', design, args)).toBeNull();
        e.totalPopulation = pop;
        e.researchHabitats = habitats;
    }, 600000);
});

describe('8. pursue wonders', () => {
    it('peaceful empires pick research / economy wonders, aggressive ones military; the research order leads to it', () => {
        expect(wonderFit(WonderType.EmpireResearchEnergy, false)).toBeGreaterThan(wonderFit(WonderType.ColonyDefense, false));
        expect(wonderFit(WonderType.ColonyDefense, true)).toBeGreaterThan(wonderFit(WonderType.EmpireResearchEnergy, true));
        const g = smartGame().game.galaxy;
        const e = aiEmpires(g)[0];
        const typeOf = (id: number): WonderType => planetaryFacilityDefinitionsStatic(g).find((f) => f.facilityId === id)!.wonderType as WonderType;
        const calm = pickWonder(g, e, false)!;
        const war = pickWonder(g, e, true)!;
        expect(calm).not.toBeNull();
        expect(war).not.toBeNull();
        if (typeOf(calm.facilityId) !== WonderType.RaceAchievement) expect(wonderFit(typeOf(calm.facilityId), false)).toBe(5);
        if (typeOf(war.facilityId) !== WonderType.RaceAchievement) expect(wonderFit(typeOf(war.facilityId), true)).toBe(5);
        const plan = ensureWonderPlan(g, e)!;
        const node = e.research.techTree.find((n) => n.def.projectId === plan.projectId)!;
        const path = wonderPath(e, node);
        expect(path.length).toBeGreaterThan(0);
        for (const ind of [IndustryType.Weapon, IndustryType.Energy, IndustryType.HighTech]) {
            const first = path.find((n) => n.def.industry === ind);
            const order = scenarioQuery(g, 'researchProjectOrder', [], { empire: e, industry: ind });
            if (first !== undefined) expect(order[0]).toBe(first.def.projectId);
        }
        // The wonder gets the whole treasury as its budget.
        const w = planetaryFacilityDefinitionsStatic(g).find((f) => f.facilityId === plan.facilityId)!;
        expect(scenarioQuery(g, 'wonderBudget', e.stateMoney / 1.5, { empire: e, wonder: w })).toBe(e.stateMoney);
        delete (g.scenario!.state.smarterAIStatecraft as { wonders: Record<string, unknown> }).wonders[String(e.empireId)];
    }, 600000);
});

describe('9. use spies well', () => {
    it('raises counter-intelligence under hostile spying and sends free agents to steal from the rival ahead', () => {
        expect(counterIntelShare(0.3, 0)).toBe(0.3);
        expect(counterIntelShare(0.3, 1)).toBeGreaterThan(0.3);
        expect(counterIntelShare(0.3, 99)).toBeLessThanOrEqual(0.75);
        const g = smartGame().game.galaxy;
        const [e, r] = aiEmpires(g);
        const base = scenarioQuery(g, 'counterIntelligenceProportion', 0.3, { empire: e });
        e.recentSpyingEmpires.push(r);
        expect(scenarioQuery(g, 'counterIntelligenceProportion', 0.3, { empire: e })).toBeGreaterThan(base);
        e.recentSpyingEmpires.pop();
        // A rival met and ahead in research; capable agents with nothing to do.
        const rel = obtainDiplomaticRelation(e, r);
        const relType = rel.type;
        rel.type = DiplomaticRelationType.None;
        if (e.research.nextProjects === null) e.research.refreshLatestNextProjects(e.dominantRace);
        const ahead = e.research.nextProjects!.find((n) => e.research.allowedRacesCount(n) <= 0)!;
        const theirs = r.research.techTree[ahead.def.projectId];
        const was = theirs.isResearched;
        theirs.isResearched = true;
        while (getEmpireCharacters(e).filter((c) => c.role === CharacterRole.IntelligenceAgent).length < 3) generateNewCharacter(g, e, CharacterRole.IntelligenceAgent, e.capital);
        const agents = getEmpireCharacters(e).filter((c) => c.role === CharacterRole.IntelligenceAgent);
        const saved = agents.map((c) => ({ c, m: c.mission, skills: Array.from((c as unknown as { skillBase: Int8Array }).skillBase) }));
        for (const c of agents) {
            c.mission = null;
            (c as unknown as { skillBase: Int8Array }).skillBase.fill(100);
        }
        expect(steerAgents(g, e)).toBeGreaterThan(0);
        expect(agents.some((c) => characterMission(c)?.type === IntelligenceMissionType.StealTechData && characterMission(c)!.targetEmpire === r)).toBe(true);
        for (const { c, m, skills } of saved) {
            c.mission = m;
            (c as unknown as { skillBase: Int8Array }).skillBase.set(skills);
        }
        theirs.isResearched = was;
        rel.type = relType;
    }, 600000);
});

describe('11. diplomacy with purpose', () => {
    it('courts empires facing the same runaway (trade, then defence); pays pirates only when cheaper than the losses', () => {
        expect(protectionWorthIt(100, 2000, 1e6)).toBe(true);
        expect(protectionWorthIt(100, 1000, 1e6)).toBe(false);
        expect(protectionWorthIt(100, 2000, 50)).toBe(false);
        const g = smartGame().game.galaxy;
        const [e, q, r] = aiEmpires(g);
        expect(r).toBeDefined();
        const rels = [obtainDiplomaticRelation(e, q), obtainDiplomaticRelation(e, r)];
        const saved = { types: rels.map((x) => x.type), scores: [e.score, q.score, r.score] };
        rels[0].type = DiplomaticRelationType.None;
        rels[1].type = DiplomaticRelationType.None;
        e.score = 100;
        q.score = 100;
        r.score = 100;
        r.score = 1000;
        expect(sharedThreatPlans(g, e).find((p) => p.partner === q)?.offer).toBe(DiplomaticRelationType.FreeTradeAgreement);
        rels[0].type = DiplomaticRelationType.FreeTradeAgreement;
        expect(sharedThreatPlans(g, e).find((p) => p.partner === q)?.offer).toBe(DiplomaticRelationType.MutualDefensePact);
        expect(sharedThreatPlans(g, e).some((p) => p.partner === r)).toBe(false);
        rels.forEach((x, i) => (x.type = saved.types[i]));
        [e.score, q.score, r.score] = saved.scores;
    }, 600000);
});
