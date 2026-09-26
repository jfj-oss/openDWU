// Scenario package 19c — chartered companies (tasks/19c-chartered-companies.md §9). The scenario folder
// scenarios/chartered-companies/ over the seed-1 harness game: eligibility, chartering (C2) and the company settling its
// rim world, tribute (stock ProcessSubjugationTribute), tariff (C3), war rules (C4), the yearly handler (C5 / C6),
// AI charters (C1), save round trip, the command-log path (player charters and decision answers are journaled and
// replay), and flags off = the faithful game.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGameRun } from './helpers/gameCache';
import { createScenarioGame } from './helpers/scenarioGame';
import { tickGameOptions } from './helpers/tickGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { Game } from '../src/sim/game';
import type { Habitat } from '../src/sim/types';
import { HabitatCategoryType } from '../src/sim/types';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateCounts, stateDigest } from '../src/sim/tick/digest';
import { GalaxyTime, REAL_SECONDS_IN_GALACTIC_YEAR } from '../src/sim/galaxyTime';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { gameYear } from '../src/sim/scenario/hooks';
import { scenarioEmit } from '../src/sim/scenario/hooks';
import { pendingScenarioDecisions } from '../src/sim/scenario/decisions';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { changeDiplomaticRelation, declareWar } from '../src/sim/diplomacyTick';
import { processSubjugationTribute } from '../src/sim/treasury';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { BuiltObjectMissionType, builtObjectMission } from '../src/sim/missions/mission';
import { SystemVisibilityStatus } from '../src/sim/visibility';
import { EmpireMessageType, empireMessages } from '../src/sim/messages';
import { commandLog, type PlayerLogEntry } from '../src/sim/player/commandLog';
import { issuePlayerCommand, flushPlayerCommands, replayCommandLog, runPlayerCommand } from '../src/sim/player/playerCommands';
import {
    aiExpiryChoice,
    allCharters,
    charterEligibility,
    charterOfCompany,
    charterTargets,
    chartersOf,
    chartersYearly,
    defaultCharterTerms,
    estimatedTribute,
    grantCharter,
    isCompany,
    isRimWorld,
    nationaliseCompany,
    releaseCompany,
    type Charter,
} from '../src/sim/scenario/charteredCompanies/charters';
import { charterButtonState, charterDialogModel, charterRows, companyHeaderLine, companyTag } from '../src/ui/screens/charters';

const SCENARIO = 'chartered-companies';
const FLAGS = { charteredCompanies: true, aiCharters: false, companyHqExportOnly: false };
const ALL_OFF = { charteredCompanies: false, aiCharters: false, companyHqExportOnly: false };

let base: GameData;
let scenarioData: GameData;
/** The scenario game at 300 s (empires have explored their neighbourhood), saved once; each test loads a copy. */
let snapshot: string;

function saveText(game: Game, flags: Record<string, boolean> = FLAGS, params: Record<string, number> = {}): string {
    const time = new GalaxyTime();
    time.togglePause();
    time.advance(game.galaxy.nowMs);
    return serializeGame(game, time, { ...defaultStartGameOptions(), seed: 1, scenario: { id: SCENARIO, flags, params } });
}

function fresh(): Game {
    return deserializeGame(snapshot, scenarioData).game;
}

/** The AI founder used throughout: the first AI empire with a rim world among its charter targets. */
function rimFounder(g: Galaxy): { founder: Empire; target: Habitat } {
    for (const e of g.empires) {
        if (e === g.playerEmpire) continue;
        e.stateMoney = Math.max(e.stateMoney, 1e6);
        const t = charterTargets(g, e).find((h) => isRimWorld(g, h));
        if (t !== undefined) return { founder: e, target: t };
    }
    throw new Error('no AI empire with a rim charter target');
}

function exploreAll(g: Galaxy, e: Empire): void {
    for (const sys of g.systems) e.visibility.setSystemVisibility(sys.systemStar, SystemVisibilityStatus.Explored);
}

function allShips(e: Empire) {
    return [...e.builtObjects, ...e.privateBuiltObjects].filter((b) => b !== null && !b.hasBeenDestroyed);
}

beforeAll(async () => {
    base = await loadGameDataFs();
    const { game, gameData } = createScenarioGame(base, { scenario: SCENARIO, flags: FLAGS });
    scenarioData = gameData;
    runGameSeconds(game, 300);
    snapshot = saveText(game);
}, 2400000);

describe('eligibility (§4.2)', () => {
    it('each failing condition gives its reason; a good target passes', () => {
        const game = fresh();
        const g = game.galaxy;
        const { founder, target } = rimFounder(g);
        expect(charterEligibility(g, founder, target)).toEqual({ ok: true, reason: '' });
        const reason = (h: Habitat, e: Empire = founder) => charterEligibility(g, e, h).reason;
        expect(reason(founder.capital!)).toMatch(/already owned/);
        const asteroid = g.habitats.find((h) => h.category === HabitatCategoryType.Asteroid && founder.visibility.checkSystemExplored(h.systemIndex))!;
        expect(reason(asteroid)).toMatch(/planets and moons/);
        const unexplored = g.habitats.find((h) => h.category === HabitatCategoryType.Planet && h.empire === null && !founder.visibility.checkSystemExplored(h.systemIndex))!;
        expect(reason(unexplored)).toMatch(/not been explored/);
        const money = founder.stateMoney;
        founder.stateMoney = 100;
        expect(reason(target)).toMatch(/Not enough money/);
        founder.stateMoney = money;
        const next = g.nextEmpireId;
        g.nextEmpireId = g.maximumEmpireCount;
        expect(reason(target)).toMatch(/No room/);
        g.nextEmpireId = next;
        g.scenario!.params.maxCompaniesPerFounder = 1;
        expect(grantCharter(g, founder, target, defaultCharterTerms(g)).ok).toBe(true);
        const other = charterTargets(g, founder)[0] ?? target;
        expect(reason(other)).toMatch(/Maximum number of companies|already owned|colony in this system/);
        expect(reason(target)).toMatch(/Maximum number of companies/);
        expect(reason(target, g.empires.find((e) => isCompany(g, e))!)).toMatch(/A company cannot/);
        g.scenario!.flags.charteredCompanies = false;
        expect(charterEligibility(g, founder, target).ok).toBe(false);
        expect(charterTargets(g, founder)).toEqual([]);
    }, 600000);
});

describe('chartering a company (C2) and its rim colony', () => {
    it('creates the company at the untouched target with the relation, refuelling, money and expedition', () => {
        const game = fresh();
        const g = game.galaxy;
        const { founder, target } = rimFounder(g);
        expect(isRimWorld(g, target)).toBe(true);
        const kept = { diameter: target.diameter, baseQuality: target.baseQuality, resources: target.resources.map((r) => ({ ...r })) };
        const money = founder.stateMoney;
        const n = g.empires.length;
        const res = grantCharter(g, founder, target, { kind: 'dominion', tariffPct: 20, durationYears: 10 });
        expect(res.ok).toBe(true);
        const company = res.company!;
        expect(g.empires.length).toBe(n + 1);
        expect(company.name).toBe(`${g.systems[target.systemIndex].systemStar.name} Company`);
        expect(company.dominantRace).toBe(founder.dominantRace);
        expect(company.capital).toBe(target);
        expect(target.empire).toBe(company);
        expect({ diameter: target.diameter, baseQuality: target.baseQuality, resources: target.resources }).toEqual(kept);
        expect(target.population.totalAmount).toBeGreaterThan(50e6 * 0.85);
        expect(target.population.totalAmount).toBeLessThan(50e6 * 1.15);
        expect(founder.stateMoney).toBe(money - 30000);
        expect(company.stateMoney).toBe(18000);
        expect(company.privateMoney).toBe(12000);
        // Relation: SubjugatedDominion, initiated by the founder on both sides; refuelling both ways.
        const fr = obtainDiplomaticRelation(founder, company);
        const cr = obtainDiplomaticRelation(company, founder);
        expect(fr.type).toBe(DiplomaticRelationType.SubjugatedDominion);
        expect(cr.type).toBe(DiplomaticRelationType.SubjugatedDominion);
        expect(fr.initiator).toBe(founder);
        expect(cr.initiator).toBe(founder);
        expect(fr.militaryRefuelingToOther).toBe(true);
        expect(cr.militaryRefuelingToOther).toBe(true);
        // Expedition: colony ship, construction ship, escorts and freighters, all the company's and moving to the target.
        const ships = allShips(company);
        const count = (r: BuiltObjectSubRole) => ships.filter((b) => b.subRole === r).length;
        expect(count(BuiltObjectSubRole.ColonyShip)).toBe(1);
        expect(count(BuiltObjectSubRole.ConstructionShip)).toBe(1);
        expect(count(BuiltObjectSubRole.Escort) + count(BuiltObjectSubRole.Frigate)).toBeLessThanOrEqual(3);
        expect(count(BuiltObjectSubRole.Escort) + count(BuiltObjectSubRole.Frigate)).toBeGreaterThan(0);
        expect(count(BuiltObjectSubRole.SmallFreighter) + count(BuiltObjectSubRole.MediumFreighter)).toBeLessThanOrEqual(2);
        for (const b of ships) {
            expect(b.actualEmpire).toBe(company);
            const m = builtObjectMission(b.mission);
            expect(m?.type).toBe(BuiltObjectMissionType.Move);
        }
        // Records, news and the founder's message.
        const c = charterOfCompany(g, company)!;
        expect(c).toMatchObject({ founderId: founder.empireId, kind: 'dominion', tariffPct: 20, durationYears: 10, status: 'active', feePaid: 30000 });
        expect(chartersOf(g, founder)).toEqual([c]);
        expect(empireMessages(founder).some((m) => m.messageType === EmpireMessageType.GalacticNewsNet && m.description.includes(`${company.name} has been chartered`))).toBe(true);

        // The company settles and runs as an ordinary AI empire: after a while it still holds its rim world.
        runGameSeconds(g, 120);
        expect(company.active).toBe(true);
        expect(company.colonies).toContain(target);
        expect(target.empire).toBe(company);
        expect(isRimWorld(g, company.capital!)).toBe(true);
    }, 600000);
});

describe('income: tribute and tariff', () => {
    it('dominion pays the stock tribute; a protectorate pays none', () => {
        const game = fresh();
        const g = game.galaxy;
        const { founder, target } = rimFounder(g);
        const company = grantCharter(g, founder, target, defaultCharterTerms(g)).company!;
        runGameSeconds(g, 60);
        // A 50 M settlement's tax revenue does not yet cover its colony support cost (Habitat.cs 6083
        // RecalculateAnnualTaxRevenue), so the stock tribute is 0 at first; give the capital a revenue snapshot.
        company.capital!.annualTaxRevenue = 40000;
        const est = estimatedTribute(g, company);
        expect(est).toBeGreaterThan(0);
        const f0 = founder.stateMoney;
        const c0 = company.stateMoney;
        processSubjugationTribute(g, company, REAL_SECONDS_IN_GALACTIC_YEAR);
        expect(founder.stateMoney - f0).toBeCloseTo(est, 6);
        expect(c0 - company.stateMoney).toBeCloseTo(est, 6);

        const game2 = fresh();
        const g2 = game2.galaxy;
        const r2 = rimFounder(g2);
        const prot = grantCharter(g2, r2.founder, r2.target, { ...defaultCharterTerms(g2), kind: 'protectorate' }).company!;
        expect(obtainDiplomaticRelation(r2.founder, prot).type).toBe(DiplomaticRelationType.Protectorate);
        expect(estimatedTribute(g2, prot)).toBe(0);
        const pf = r2.founder.stateMoney;
        processSubjugationTribute(g2, prot, REAL_SECONDS_IN_GALACTIC_YEAR);
        expect(r2.founder.stateMoney).toBe(pf);
    }, 600000);

    it('a contracted sale moves tariffPct % from the company private money to the founder (C3)', () => {
        const game = fresh();
        const g = game.galaxy;
        const { founder, target } = rimFounder(g);
        const company = grantCharter(g, founder, target, { kind: 'dominion', tariffPct: 20, durationYears: 20 }).company!;
        const buyer = g.empires.find((e) => e !== founder && e !== company && e.pirateEmpireBaseHabitat === null)!;
        const sale = (b: Empire, resourceId: number, value: number) =>
            scenarioEmit(g, 'contractInitiated', { seller: company, buyer: b, sellingPoint: target, destination: null, resourceId, componentId: -1, amount: 10, value, isState: false, freighter: null });
        const f0 = founder.stateMoney;
        const p0 = company.privateMoney;
        sale(buyer, 3, 1000);
        expect(founder.stateMoney - f0).toBeCloseTo(200, 9);
        expect(p0 - company.privateMoney).toBeCloseTo(200, 9);
        const c = charterOfCompany(g, company)!;
        expect(c.tariffThisYear).toBeCloseTo(200, 9);
        expect(c.tariffTotal).toBeCloseTo(200, 9);
        // Sales to the founder and component sales are not taxed; nor are sales of a released company.
        sale(founder, 3, 1000);
        scenarioEmit(g, 'contractInitiated', { seller: company, buyer, sellingPoint: target, destination: null, resourceId: -1, componentId: 5, amount: 1, value: 1000, isState: false, freighter: null });
        expect(c.tariffTotal).toBeCloseTo(200, 9);
        // The yearly handler rolls the year's tariff and messages the founder.
        chartersYearly(g, gameYear(galaxyStarDate(g)) + 1);
        expect(c.tariffLastYear).toBeCloseTo(200, 9);
        expect(c.tariffThisYear).toBe(0);
        expect(releaseCompany(g, founder, company)).toBe(true);
        sale(buyer, 3, 1000);
        expect(c.tariffTotal).toBeCloseTo(200, 9);
        // Flag off: the listener is not called.
        const game2 = fresh();
        const g2 = game2.galaxy;
        const r2 = rimFounder(g2);
        const co2 = grantCharter(g2, r2.founder, r2.target, defaultCharterTerms(g2)).company!;
        g2.scenario!.flags.charteredCompanies = false;
        const m2 = r2.founder.stateMoney;
        scenarioEmit(g2, 'contractInitiated', { seller: co2, buyer: g2.empires[0], sellingPoint: r2.target, destination: null, resourceId: 3, componentId: -1, amount: 10, value: 1000, isState: false, freighter: null });
        expect(r2.founder.stateMoney).toBe(m2);
    }, 600000);
});

describe('subject relationship: war rules (C4), autonomy (C6), expiry (C5)', () => {
    it('an AI company never declares war on its founder, an AI founder never on its company; a player founder can', () => {
        const game = fresh();
        const g = game.galaxy;
        const { founder, target } = rimFounder(g);
        const company = grantCharter(g, founder, target, defaultCharterTerms(g)).company!;
        declareWar(g, company, founder);
        declareWar(g, founder, company);
        expect(obtainDiplomaticRelation(founder, company).type).toBe(DiplomaticRelationType.SubjugatedDominion);
        chartersYearly(g, gameYear(galaxyStarDate(g)) + 1);
        expect(charterOfCompany(g, company)!.status).toBe('active');

        const p = game.playerEmpire;
        p.stateMoney = 1e6;
        exploreAll(g, p);
        const pt = charterTargets(g, p)[0];
        expect(pt).toBeDefined();
        const pc = grantCharter(g, p, pt, defaultCharterTerms(g)).company!;
        declareWar(g, pc, p);
        expect(obtainDiplomaticRelation(p, pc).type).toBe(DiplomaticRelationType.SubjugatedDominion);
        declareWar(g, p, pc);
        expect(obtainDiplomaticRelation(p, pc).type).toBe(DiplomaticRelationType.War);
        chartersYearly(g, gameYear(galaxyStarDate(g)) + 2);
        expect(charterOfCompany(g, pc)!.status).toBe('revoked');
    }, 600000);

    it('a relation leaving the chartered kind makes the charter autonomous once, with one news item', () => {
        const game = fresh();
        const g = game.galaxy;
        const { founder, target } = rimFounder(g);
        const company = grantCharter(g, founder, target, defaultCharterTerms(g)).company!;
        changeDiplomaticRelation(g, founder, obtainDiplomaticRelation(founder, company), DiplomaticRelationType.None);
        const news = () => empireMessages(founder).filter((m) => m.description.includes('declared autonomy')).length;
        const before = news();
        const y = gameYear(galaxyStarDate(g));
        chartersYearly(g, y + 1);
        expect(charterOfCompany(g, company)!.status).toBe('autonomous');
        chartersYearly(g, y + 2);
        expect(news()).toBe(before + 1);
    }, 600000);

    it('at expiry an AI founder renews (tariffs ≥ fee), nationalises (≥ 3× stronger) or releases', () => {
        const game = fresh();
        const g = game.galaxy;
        g.scenario!.params.maxCompaniesPerFounder = 6;
        const { founder } = rimFounder(g);
        const terms = { kind: 'dominion' as const, tariffPct: 15, durationYears: 1 };
        const targets = charterTargets(g, founder);
        const a = grantCharter(g, founder, targets[0], terms).company!;
        const ca = charterOfCompany(g, a)!;
        ca.tariffTotal = ca.feePaid; // renew
        const y = gameYear(galaxyStarDate(g));
        chartersYearly(g, y + 1);
        expect(ca.status).toBe('active');
        expect(ca.startYear).toBe(y); // renewed from the current game year

        // Nationalise: the founder is far stronger than the fresh company (tariffs below the fee).
        const colonies = [...a.colonies];
        ca.tariffTotal = 0;
        expect(aiExpiryChoice(g, founder, a, ca)).toBe('nationalise');
        chartersYearly(g, y + 2);
        expect(ca.status).toBe('nationalised');
        expect(a.active).toBe(false);
        expect(g.empires).not.toContain(a);
        for (const col of colonies) expect(col.empire).toBe(founder);

        // Release: the rule with the strength reversed; and the release itself ends the treaty.
        const cfake: Charter = { ...ca, status: 'active', tariffTotal: 0 };
        expect(aiExpiryChoice(g, g.empires.find((e) => e !== founder && e.pirateEmpireBaseHabitat === null && e.builtObjects.length === 0) ?? a, founder, cfake)).toBe('release');
        const next = charterTargets(g, founder)[0];
        const b = grantCharter(g, founder, next, terms).company!;
        expect(releaseCompany(g, founder, b)).toBe(true);
        expect(charterOfCompany(g, b)!.status).toBe('released');
        expect(obtainDiplomaticRelation(founder, b).type).toBe(DiplomaticRelationType.None);
        expect(nationaliseCompany(g, founder, b)).toBe(false);
    }, 600000);

    it('a player founder gets a decision at expiry; the answer is a journaled player command', () => {
        const game = fresh();
        const g = game.galaxy;
        const p = game.playerEmpire;
        p.stateMoney = 1e6;
        exploreAll(g, p);
        const company = grantCharter(g, p, charterTargets(g, p)[0], { kind: 'dominion', tariffPct: 15, durationYears: 1 }).company!;
        const y = gameYear(galaxyStarDate(g));
        chartersYearly(g, y + 1);
        const [d] = pendingScenarioDecisions(g, p);
        expect(d.kind).toBe('charters.expiry');
        expect(d.context.companyId).toBe(company.empireId);
        expect(empireMessages(p).at(-1)!.messageType).toBe(EmpireMessageType.GeneralDecision);
        chartersYearly(g, y + 1); // raised once per term
        expect(pendingScenarioDecisions(g, p)).toHaveLength(1);

        // Another empire cannot answer the player's question.
        expect(runPlayerCommand(g, g.empires.find((e) => e !== p)!, 'answerScenarioDecision', [d.id, 'release'])).toBe(false);
        // The popup path: issued, applied at the next boundary, journaled.
        let applied: boolean | null = null;
        issuePlayerCommand(g, p, 'answerScenarioDecision', [d.id, 'release'], (r) => (applied = r));
        expect(charterOfCompany(g, company)!.status).toBe('active');
        flushPlayerCommands(g);
        expect(applied).toBe(true);
        expect(charterOfCompany(g, company)!.status).toBe('released');
        const e = commandLog(g).at(-1) as PlayerLogEntry;
        expect(e).toMatchObject({ source: 'player', op: 'answerScenarioDecision', args: [d.id, 'release'] });
        expect(pendingScenarioDecisions(g, p)).toHaveLength(0);
    }, 600000);
});

describe('AI charters (C1)', () => {
    it('with chance 100 each qualifying AI founder charters its best target once a year, up to the max; chance 0 none', () => {
        const game = fresh();
        const g = game.galaxy;
        g.scenario!.flags.aiCharters = true;
        g.scenario!.params.aiCharterChancePct = 0;
        for (const e of g.empires) if (e !== g.playerEmpire) e.stateMoney = 1e6;
        const y = gameYear(galaxyStarDate(g));
        chartersYearly(g, y + 1);
        expect(allCharters(g)).toHaveLength(0);

        g.scenario!.params.aiCharterChancePct = 100;
        g.scenario!.params.maxCompaniesPerFounder = 1;
        const expected = new Map<number, Habitat>();
        for (const e of g.empires) {
            if (e === g.playerEmpire) continue;
            const t = charterTargets(g, e, 20);
            if (t.length > 0) expected.set(e.empireId, t[0]);
        }
        expect(expected.size).toBeGreaterThan(0);
        chartersYearly(g, y + 2);
        const cs = allCharters(g);
        expect(cs.every((c) => c.founderId !== game.playerEmpire.empireId)).toBe(true);
        // Founders charter in list order, so a later founder may lose its first pick to an earlier one's company.
        expect(cs.length).toBeGreaterThan(0);
        expect(cs.length).toBeLessThanOrEqual(expected.size);
        expect(g.habitats[cs[0].targetIndex]).toBe(expected.get(cs[0].founderId));
        chartersYearly(g, y + 3);
        expect(allCharters(g)).toHaveLength(cs.length); // max 1 per founder
        for (const c of cs) expect(isCompany(g, g.empires.find((e) => e.empireId === c.companyId)!)).toBe(true);
    }, 600000);
});

describe('UI models (Charters screen, dialog, selection button)', () => {
    it('build rows, the dialog model and the button state from the sim', () => {
        const game = fresh();
        const g = game.galaxy;
        const p = game.playerEmpire;
        p.stateMoney = 1e6;
        exploreAll(g, p);
        const target = charterTargets(g, p)[0];
        expect(charterButtonState(g, p, target)).toEqual({ visible: true, enabled: true, title: 'Charter a company to settle this world' });
        expect(charterButtonState(g, p, p.capital!)).toMatchObject({ visible: true, enabled: false });
        const m = charterDialogModel(g, p, target);
        expect(m).toMatchObject({ targetName: target.name, fee: 30000, eligible: true, defaults: { kind: 'dominion', tariffPct: 15, durationYears: 20 } });
        expect(m.expedition.filter((s) => s.role === 'Colony ship')).toHaveLength(1);
        expect(runPlayerCommand(g, p, 'charterCompany', [target, { kind: 'protectorate', tariffPct: 25, durationYears: 30 }])).toBe(true);
        const [row] = charterRows(g, p);
        expect(row).toMatchObject({ kindLabel: 'Protectorate', status: 'active', yearsLeft: 30, tariffPct: 25, colonies: 1, capitalName: target.name, tribute: 0, actionable: true });
        expect(companyTag(g, row.company!)).toBe(`Company of ${p.name}`);
        expect(companyTag(g, p)).toBe('');
        expect(companyHeaderLine(g, row.company!)).toBe(`Chartered by ${p.name}, expires in 30 years, tariff 25 %`);
        expect(runPlayerCommand(g, p, 'charterNationalise', [row.company!])).toBe(true);
        expect(charterRows(g, p)[0]).toMatchObject({ status: 'nationalised', actionable: false });
        g.scenario!.flags.charteredCompanies = false;
        expect(charterButtonState(g, p, target).visible).toBe(false);
    }, 600000);
});

describe('determinism, save and replay', () => {
    it('save after a charter, load, run: same digest as the uninterrupted run; charter state intact', () => {
        const game = fresh();
        const g = game.galaxy;
        const { founder, target } = rimFounder(g);
        grantCharter(g, founder, target, defaultCharterTerms(g));
        const text = saveText(game);
        runGameSeconds(g, 60);
        const loaded = deserializeGame(text, scenarioData).game;
        expect(allCharters(loaded.galaxy)).toEqual(allCharters(deserializeGame(text, scenarioData).game.galaxy));
        runGameSeconds(loaded.galaxy, 60);
        expect(stateDigest(loaded.galaxy)).toBe(stateDigest(g));
        expect(allCharters(loaded.galaxy)).toEqual(allCharters(g));
    }, 900000);

    it('a charter issued as a player command replays from seed + command log', () => {
        const params = { charterFee: 5000 };
        const { game, gameData } = createScenarioGame(base, { scenario: SCENARIO, flags: FLAGS, params });
        const g = game.galaxy;
        runGameSeconds(g, 240);
        const founder = g.empires.find((e) => e !== g.playerEmpire && e.stateMoney >= 5000 && charterTargets(g, e).length > 0)!;
        expect(founder).toBeDefined();
        const target = charterTargets(g, founder)[0];
        expect(runPlayerCommand(g, founder, 'charterCompany', [target, { kind: 'protectorate', tariffPct: 10, durationYears: 5 }])).toBe(true);
        runGameSeconds(g, 30);
        const log = commandLog(g);
        expect(log.map((e) => (e.source === 'player' ? e.op : e.source))).toEqual(['charterCompany']);
        const { seed, ...options } = { ...tickGameOptions(gameData), scenarioFlags: FLAGS, scenarioParams: params };
        const replay = replayCommandLog(seed, options, log, g.nowMs);
        expect(stateDigest(replay.galaxy)).toBe(stateDigest(g));
        expect(allCharters(replay.galaxy)).toEqual(allCharters(g));
    }, 900000);
});

describe('flags off = faithful game', () => {
    it('the scenario with every flag off runs 600 s byte-identical to the plain seed-1 game', () => {
        const ref = cachedTickGameRun(base, { seconds: 600 });
        const { game } = createScenarioGame(base, { scenario: SCENARIO, flags: ALL_OFF });
        const run = runGameSeconds(game, 600);
        expect(stateDigest(game.galaxy)).toBe(stateDigest(ref.game.galaxy));
        expect(stateCounts(game.galaxy)).toEqual(stateCounts(ref.game.galaxy));
        expect(run.rndDraws).toBe(ref.run.rndDraws);
        expect(game.galaxy.rnd.drawCount).toBe(ref.game.galaxy.rnd.drawCount);
        expect(allCharters(game.galaxy)).toEqual([]);
        expect(game.galaxy.empires.length).toBe(ref.game.galaxy.empires.length);
    }, 1200000);
});
