// Task 19g-3 "War goals & peace terms" — scenario lively-galaxy, flag warGoals.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { Game } from '../src/sim/game';
import type { Habitat } from '../src/sim/types';
import type { BuiltObject } from '../src/sim/builtObject';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { DiplomaticRelationType, obtainDiplomaticRelation, obtainEmpireEvaluation } from '../src/sim/diplomacy';
import { considerTreatyProposals, declareWar, endWarRequest } from '../src/sim/diplomacyTick';
import { inflictWarDamageBuiltObject } from '../src/sim/combat/damage';
import { takeOwnershipOfColonyFull } from '../src/sim/combat/ownership';
import { assignMission } from '../src/sim/missions/assign';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../src/sim/missions/mission';
import { runPlayerCommand } from '../src/sim/player/playerCommands';
import { commandLog } from '../src/sim/player/commandLog';
import { GalaxyTime, YEAR_LENGTH } from '../src/sim/galaxyTime';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import { pendingScenarioDecisions, scenarioQuery } from '../src/sim/scenario';
import {
    breakDemilitarisation,
    checkDemilitarisation,
    holdsCasusBelli,
    humiliation,
    peekWarLedger,
    sideOf,
    sideScore,
    warGoalCandidates,
    warGoalsState,
    pairKey,
    type PeaceTerms,
} from '../src/sim/scenario/lively/warGoals';
import { applyTerms, peaceOffer, PEACE_DECISION, statusQuo, warView } from '../src/sim/scenario/lively/peaceTerms';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const FLAGS = { ambitionPressure: false, borderFriction: false, smallerInvasions: false, warGoals: true };

function warGame(params: Record<string, number> = {}): { game: Game; gameData: GameData; g: Galaxy } {
    const { game, gameData } = createScenarioGame(base, { scenario: 'lively-galaxy', flags: FLAGS, params });
    return { game, gameData, g: game.galaxy };
}

function aiEmpires(g: Galaxy): Empire[] {
    return g.empires.filter((e) => e !== null && e.active && e !== g.playerEmpire && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null);
}

function meet(a: Empire, b: Empire): void {
    obtainDiplomaticRelation(a, b).type = DiplomaticRelationType.None;
    obtainDiplomaticRelation(b, a).type = DiplomaticRelationType.None;
}

/** A non-capital colony of `e` (takes an independent colony for it if it has none). */
function spareColony(g: Galaxy, e: Empire): Habitat {
    const own = e.colonies.find((c) => c !== null && c !== e.capital && c.empire === e);
    if (own !== undefined) return own;
    const cap = e.capital!;
    const ind = g.habitats.filter((h) => h.empire === g.independentEmpire && h.empire !== null);
    ind.sort((a, b) => Math.hypot(a.xpos - cap.xpos, a.ypos - cap.ypos) - Math.hypot(b.xpos - cap.xpos, b.ypos - cap.ypos));
    takeOwnershipOfColonyFull(g, e, ind[0], e, false, false);
    expect(ind[0].empire).toBe(e);
    return ind[0];
}

function warships(e: Empire): BuiltObject[] {
    return e.builtObjects.filter((b) => b !== null && b.role === BuiltObjectRole.Military && !b.hasBeenDestroyed && b.topSpeed > 0);
}

/** Ages the war between a and b so the stock minimum war length (Galaxy.3.cs 5122, 0.5 years) and proposal gaps pass. */
function ageWar(a: Empire, b: Empire): void {
    for (const r of [obtainDiplomaticRelation(a, b), obtainDiplomaticRelation(b, a)]) {
        r.startDateOfLastChange -= 2 * YEAR_LENGTH;
        r.lastDiplomacyTradeOfferDate -= 10 * YEAR_LENGTH;
    }
}

function saveText(game: Game): string {
    const time = new GalaxyTime();
    time.togglePause();
    time.advance(game.galaxy.nowMs);
    return serializeGame(game as never, time, { ...defaultStartGameOptions(), seed: 1, scenario: { id: 'lively-galaxy', flags: FLAGS, params: {} } });
}

describe('19g-3 war goals', () => {
    it('each side records a goal at war start; the player picks from a decision answered through the command queue', () => {
        const { g } = warGame();
        const [a, b] = aiEmpires(g);
        meet(a, b);
        declareWar(g, a, b);
        const l = peekWarLedger(g, a, b)!;
        expect(l).not.toBeNull();
        expect(l.attacker).toBe(a);
        expect(sideOf(l, a).chosenBy).toBe('ai');
        expect(sideOf(l, a).goal.kind).toBe(warGoalCandidates(g, a, b, a)[0].kind);
        // The attacked side can always punish the aggressor, so it never falls back to "humiliate".
        expect(['casusBelli', 'conquest', 'border', 'freeSubject', 'punish']).toContain(sideOf(l, b).goal.kind);

        const player = g.playerEmpire!;
        const c = aiEmpires(g).find((x) => x !== a && x !== b) ?? a;
        meet(player, c);
        declareWar(g, c, player);
        const pl = peekWarLedger(g, player, c)!;
        expect(sideOf(pl, player).chosenBy).toBe('pending');
        const d = pendingScenarioDecisions(g, player).find((x) => x.kind === 'lively.warGoal')!;
        expect(d).toBeDefined();
        expect(d.options.length).toBeGreaterThanOrEqual(2); // punish + humiliate at least
        const last = d.options[d.options.length - 1];
        expect(runPlayerCommand(g, player, 'answerDecision', [d.id, last.id])).toBe(true);
        expect(sideOf(pl, player).goal.kind).toBe('humiliate');
        expect(sideOf(pl, player).chosenBy).toBe('player');
        expect(commandLog(g).some((e) => (e as { op?: string }).op === 'answerDecision')).toBe(true);
    }, 180000);

    it('the war score moves on a destroyed ship and a captured colony', () => {
        const { g } = warGame();
        const [a, b] = aiEmpires(g);
        meet(a, b);
        const target = spareColony(g, b);
        declareWar(g, a, b);
        const l = peekWarLedger(g, a, b)!;
        const s0 = sideScore(g, l, sideOf(l, a));
        const ship = warships(b)[0];
        inflictWarDamageBuiltObject(g, a, ship); // Galaxy.3.cs 529 InflictWarDamage (the ship-destroyed site)
        expect(sideOf(l, a).shipsDestroyed).toBe(1);
        expect(sideOf(l, a).shipValue).toBeGreaterThan(0);
        const s1 = sideScore(g, l, sideOf(l, a));
        expect(s1).toBeGreaterThan(s0);
        takeOwnershipOfColonyFull(g, a, target, a, false, false); // Empire.1.cs 64 TakeOwnershipOfColony
        expect(sideOf(l, a).coloniesTaken).toBe(1);
        expect(sideScore(g, l, sideOf(l, a))).toBeGreaterThan(s1);
        expect(sideScore(g, l, sideOf(l, b))).toBe(sideOf(l, b).bonus);
    }, 180000);
});

describe('19g-3 peace terms', () => {
    it('an AI accepts a peace ceding a colony with reparations (ConsiderTreatyProposals), and the terms apply', () => {
        const { g } = warGame();
        const [a, b] = aiEmpires(g);
        meet(a, b);
        const colony = spareColony(g, b);
        declareWar(g, a, b);
        ageWar(a, b);
        const l = peekWarLedger(g, a, b)!;
        sideOf(l, a).shipValue = 5000; // a is well ahead
        b.warWearinessRaw = 39; // weary: ConsiderEndWar says end (Empire.8.cs 904: weariness > 25 × aggression / 100)
        b.stateMoney = 100000;
        endWarRequest(g, a, b); // Empire.8.cs 1550 → peaceProposed stores a's terms
        expect(b.proposedDiplomaticRelations.byEmpire(a)).not.toBeNull();
        expect(peaceOffer(g, a, b)).not.toBeNull();
        const terms: PeaceTerms = { cede: [{ colony, from: b, to: a }], reparations: { payer: b, payee: a, lump: 10000, perYear: 2000, years: 3 }, demilitarise: null, release: null };
        warGoalsState(g).offers[pairKey(a, b)] = terms;
        const moneyA = a.stateMoney;
        const moneyB = b.stateMoney;
        considerTreatyProposals(g, b); // Empire.3.cs 3651: accept → peaceSigned applies the terms
        expect(obtainDiplomaticRelation(a, b).type).toBe(DiplomaticRelationType.None);
        expect(colony.empire).toBe(a);
        expect(a.stateMoney - moneyA).toBeCloseTo(10000, 0);
        expect(moneyB - b.stateMoney).toBeCloseTo(10000, 0);
        expect(warGoalsState(g).reparations).toEqual([{ payer: b, payee: a, perYear: 2000, yearsLeft: 3 }]);
        expect(humiliation(g, b, a)).toBeGreaterThan(0);
        expect(peekWarLedger(g, a, b)).toBeNull();
    }, 180000);

    it('a weak offer is refused while the stock verdict says fight on', () => {
        const { g } = warGame();
        const [a, b] = aiEmpires(g);
        meet(a, b);
        const colony = spareColony(g, b);
        declareWar(g, a, b);
        ageWar(a, b);
        // Even score, no weariness: b will not give up a colony for nothing.
        const terms: PeaceTerms = { cede: [{ colony, from: b, to: a }], reparations: null, demilitarise: null, release: null };
        expect(scenarioQuery(g, 'endWarAcceptance', true, { empire: b, other: a })).toBe(true); // status quo, stock says end
        warGoalsState(g).offers[pairKey(a, b)] = terms;
        expect(scenarioQuery(g, 'endWarAcceptance', true, { empire: b, other: a })).toBe(false);
    }, 180000);

    it('a demilitarised system refuses the restricted warships (AssignMission query); leaving it open elsewhere', () => {
        const { g } = warGame();
        const [a, b] = aiEmpires(g);
        meet(a, b);
        const colony = spareColony(g, b);
        const star = g.systems[colony.systemIndex].systemStar;
        applyTerms(g, { ...statusQuo(), demilitarise: { empire: b, beneficiary: a, systems: [star], years: 10 } }, a, b);
        expect(warGoalsState(g).treaties.length).toBe(1);
        const ship = warships(b).find((s) => Math.hypot(s.xpos - star.xpos, s.ypos - star.ypos) > g.maxSolarSystemSize)!;
        assignMission(g, ship, BuiltObjectMissionType.Move, colony, null, BuiltObjectMissionPriority.High);
        expect(builtObjectMission(ship.mission)?.targetHabitat ?? null).not.toBe(colony);
        const home = b.capital!;
        assignMission(g, ship, BuiltObjectMissionType.Move, home, null, BuiltObjectMissionPriority.High);
        expect(builtObjectMission(ship.mission)?.targetHabitat).toBe(home);
        // Other empires' warships are not restricted.
        expect(scenarioQuery(g, 'assignMissionAllowed', true, { builtObject: warships(a)[0], missionType: BuiltObjectMissionType.Move, target: colony, x: -2000000001, y: -2000000001 })).toBe(true);
    }, 180000);

    it('broken demilitarisation is a casus belli: relation drop, war-review relaxation and a free war goal', () => {
        const { g } = warGame({ demilGraceDays: 0 });
        const [a, b] = aiEmpires(g);
        meet(a, b);
        const colony = spareColony(g, b);
        const star = g.systems[colony.systemIndex].systemStar;
        applyTerms(g, { ...statusQuo(), demilitarise: { empire: b, beneficiary: a, systems: [star], years: 10 } }, a, b);
        const ship = warships(b)[0];
        ship.xpos = star.xpos + 100;
        ship.ypos = star.ypos + 100;
        const before = obtainEmpireEvaluation(g, a, b).incidentEvaluationRaw;
        const relaxBefore = scenarioQuery(g, 'warReviewAttitudeRelax', 0, { empire: a, other: b });
        checkDemilitarisation(g);
        expect(warGoalsState(g).treaties.length).toBe(0);
        expect(holdsCasusBelli(g, a, b)).toBe(true);
        expect(obtainEmpireEvaluation(g, a, b).incidentEvaluationRaw).toBeLessThan(before);
        expect(scenarioQuery(g, 'warReviewAttitudeRelax', 0, { empire: a, other: b })).toBeGreaterThan(relaxBefore);
        declareWar(g, a, b);
        const l = peekWarLedger(g, a, b)!;
        expect(sideOf(l, a).goal.kind).toBe('casusBelli');
        expect(sideOf(l, a).bonus).toBe(150);
        expect(holdsCasusBelli(g, a, b)).toBe(false); // spent
        void breakDemilitarisation;
    }, 180000);

    it('the player answers an AI offer through the decision (command queue), and counters through proposePeaceTerms', () => {
        const { g } = warGame();
        const player = g.playerEmpire!;
        const ai = aiEmpires(g)[0];
        meet(player, ai);
        const colony = spareColony(g, ai);
        declareWar(g, ai, player);
        ageWar(ai, player);
        // The player demands a colony for nothing at an even score: refused, the AI counters.
        const demand: PeaceTerms = { cede: [{ colony, from: ai, to: player }], reparations: null, demilitarise: null, release: null };
        const res = runPlayerCommand(g, player, 'proposePeaceTerms', [ai, demand]);
        expect(res.ok).toBe(true);
        expect(res.accepted).toBe(false);
        expect(res.counter).not.toBeNull();
        expect(obtainDiplomaticRelation(player, ai).type).toBe(DiplomaticRelationType.War);
        expect(player.proposedDiplomaticRelations.byEmpire(ai)).not.toBeNull();
        const d = pendingScenarioDecisions(g, player).find((x) => x.kind === PEACE_DECISION)!;
        expect(d).toBeDefined();
        const view = warView(g, player, ai)!;
        expect(view.theirOffer).not.toBeNull();
        expect(view.decisionId).toBe(d.id);
        expect(runPlayerCommand(g, player, 'answerDecision', [d.id, 'accept'])).toBe(true);
        expect(obtainDiplomaticRelation(player, ai).type).toBe(DiplomaticRelationType.None);
        expect(obtainDiplomaticRelation(ai, player).type).toBe(DiplomaticRelationType.None);
        expect(peekWarLedger(g, player, ai)).toBeNull();
        expect(colony.empire).toBe(ai);
        const ops = commandLog(g).map((e) => (e as { op?: string }).op);
        expect(ops).toContain('proposePeaceTerms');
        expect(ops).toContain('answerDecision');
    }, 180000);

    it('an AI offer to the player raises a peace decision (EndWarRequest → peaceProposed)', () => {
        const { g } = warGame();
        const player = g.playerEmpire!;
        const ai = aiEmpires(g)[0];
        meet(player, ai);
        declareWar(g, ai, player);
        ageWar(ai, player);
        const l = peekWarLedger(g, player, ai)!;
        sideOf(l, ai).shipValue = 4000;
        player.stateMoney = 50000;
        endWarRequest(g, ai, player);
        const offer = peaceOffer(g, ai, player)!;
        expect(offer).not.toBeNull();
        expect(offer.reparations?.payer).toBe(player);
        expect(pendingScenarioDecisions(g, player).some((x) => x.kind === PEACE_DECISION)).toBe(true);
        const before = player.stateMoney;
        const d = pendingScenarioDecisions(g, player).find((x) => x.kind === PEACE_DECISION)!;
        runPlayerCommand(g, player, 'answerDecision', [d.id, 'accept']);
        expect(obtainDiplomaticRelation(player, ai).type).toBe(DiplomaticRelationType.None);
        expect(player.stateMoney).toBeLessThan(before);
        expect(humiliation(g, player, ai)).toBeGreaterThan(0);
    }, 180000);
});

describe('19g-3 flags and saves', () => {
    it('the manifest adds warGoals off by default', () => {
        const g = createScenarioGame(base, { scenario: 'lively-galaxy' }).game.galaxy;
        expect(g.scenario!.flags.warGoals).toBe(false);
        expect(g.scenario!.params.termMoneyPerPoint).toBe(25);
        // Off: no ledger, no query effect.
        const [a, b] = aiEmpires(g);
        meet(a, b);
        declareWar(g, a, b);
        expect('warGoals' in g.scenario!.state).toBe(false);
        expect(scenarioQuery(g, 'endWarAcceptance', true, { empire: b, other: a })).toBe(true);
    }, 180000);

    it('a mid-war save round trips the ledger, offers and treaties (graph references included)', () => {
        const { game, gameData, g } = warGame();
        const [a, b, c] = aiEmpires(g);
        meet(a, b);
        declareWar(g, a, b);
        inflictWarDamageBuiltObject(g, a, warships(b)[0]);
        endWarRequest(g, a, b);
        if (c !== undefined) {
            meet(a, c);
            const colony = spareColony(g, c);
            applyTerms(g, { ...statusQuo(), demilitarise: { empire: c, beneficiary: a, systems: [g.systems[colony.systemIndex].systemStar], years: 5 } }, a, c);
        }
        const text = saveText(game);
        const loaded = deserializeGame(text, gameData);
        const lg = loaded.game.galaxy;
        const la = lg.empires.find((e) => e !== null && e.empireId === a.empireId)!;
        const lb = lg.empires.find((e) => e !== null && e.empireId === b.empireId)!;
        const ll = peekWarLedger(lg, la, lb)!;
        expect(ll).not.toBeNull();
        expect(sideOf(ll, la).empire).toBe(la);
        expect(sideOf(ll, la).shipsDestroyed).toBe(1);
        expect(sideOf(ll, la).goal.kind).toBe(sideOf(peekWarLedger(g, a, b)!, a).goal.kind);
        if (c !== undefined) expect(warGoalsState(lg).treaties[0].systems[0]).toBe(lg.systems[warGoalsState(g).treaties[0].systems[0].systemIndex].systemStar);
        expect(saveText(loaded.game)).toBe(text);
        expect(galaxyStarDate(lg)).toBe(galaxyStarDate(g));
    }, 1800000);
});
