// The Stillness Engine (threats/giantworks/stillness*.ts) and the Diet's preparation votes (agePrep.ts): the gate, the player's orders, the construction timer, the research
// slowdown (the Severance sink is not slowed), the loss and the scrapping, the AI's sides / patrols / wars / builders, the Diet motions (silence, demolish and its ban), the
// Recognise / Guard laws and the Severance, the Knowledge rows and the save round trip.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { Habitat } from '../src/sim/types';
import type { CreateGameOptions, Game } from '../src/sim/game';
import { comboOverlayFs, createScenarioGame } from './helpers/scenarioGame';
import { GAME_DAY_LENGTH, scenarioEmit, scenarioQuery } from '../src/sim/scenario/hooks';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { YEAR_LENGTH, GalaxyTime } from '../src/sim/galaxyTime';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import type { StartGameOptions } from '../src/sim/startGameOptions';
import { empireMessages } from '../src/sim/messages';
import { DiplomaticRelationType, obtainDiplomaticRelation, obtainEmpireEvaluation } from '../src/sim/diplomacy';
import { CharacterTraitType } from '../src/sim/data/races';
import { empireShipGroups } from '../src/sim/fleets/shipGroup';
import { BuiltObjectMissionType } from '../src/sim/missions/mission';
import { councilState, type Council } from '../src/sim/scenario/emergent/council';
import { dietMotionKindDef, dietState, lawInForce, peekDietState, type DietMotion } from '../src/sim/scenario/charactersVictory/diet/dietState';
import { beaconRolled } from '../src/sim/scenario/threats/giantworks/beacon';
import { peekBeaconState } from '../src/sim/scenario/threats/giantworks/beaconState';
import { heldParts, partsOf } from '../src/sim/scenario/threats/giantworks/beaconComponents';
import { performResearchProjects } from '../src/sim/researchTick';
import { IndustryType } from '../src/sim/types';
import type { GreatWorkSite } from '../src/sim/scenario/threats/giantworks/framework';
import { availableThreatActions, runThreatAction } from '../src/sim/scenario/threats/framework';
import { longNightState } from '../src/sim/scenario/threats/giantworks/longNightState';
import {
    ACTION_BUILD, ACTION_OFF, ACTION_ON, SP, beaconFinished, cannotBuild, engineOf, engineProgress, engineRunning, startEngine, stillState, stillnessActive,
    LAW_DEMOLISH_STILL, STILL_KEY, switchEngine, demolishLegal, peekStill, stillnessFactor, stillnessKnowledgeRows, stillnessStep,
} from '../src/sim/scenario/threats/giantworks/stillness';
import { AP, aiMaybeBuild, attackEngine, engineEnded, engineLean, peaceStep, protectorsReact, isolationist, sendPatrol, sideOf, stillnessReview } from '../src/sim/scenario/threats/giantworks/stillnessAi';
import { rebuildIndexes } from '../src/sim/indexRebuild';
import { assignRetrofitMission, assignScrapMission } from '../src/sim/construction/empireConstruction';
import { scrapBuiltObjects } from '../src/sim/player/yardOrders';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { takeOwnershipOfBuiltObject } from '../src/sim/combat/ownership';
import { runGameSeconds } from '../src/sim/tick/harness';
import { dietCouncil } from '../src/sim/scenario/charactersVictory/diet/diet';
import { dietVoteScore } from '../src/sim/scenario/charactersVictory/diet/dietAi';
import { MOTION_RECOGNISE, MOTION_GUARD, LAW_GUARD, LAW_RECOGNISE, harvestPledges, harvestRecognised, scarsGuarded, severanceVoteBonus } from '../src/sim/scenario/threats/giantworks/agePrep';
import { MOTION_MEGA, peekMega } from '../src/sim/scenario/threats/giantworks/megaStation';
import { partTradeAllowed } from '../src/sim/scenario/threats/giantworks/beaconComponents';
import { reputationOn, reputationSum } from '../src/sim/scenario/reputation/ledger';
import type { ShipGroup } from '../src/sim/fleets/shipGroup';
import { dietView } from '../src/sim/scenario/charactersVictory/diet/dietView';
import { MOTION_DEMOLISH, MOTION_SILENCE } from '../src/sim/scenario/threats/giantworks/stillnessDiet';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });
const ids = ['threat-framework', 'giantworks', 'characters-victory'];
const DAY = GAME_DAY_LENGTH;

interface Setup {
    game: Game;
    gameData: GameData;
    g: Galaxy;
    me: Empire;
    ais: Empire[];
}

let saved: string;
let savedData: GameData;

/** A seed-1 Giantworks game in Age 2 with the Harvest Cycle and the Diet on (a council of every empire) and the Beacon rolled. */
function build(): Setup {
    const { game, gameData } = createScenarioGame(base, { scenario: comboOverlayFs(ids), flags: { charactersVictory: true, cvCouncil: true, galacticCouncil: true }, options: age3 });
    const g = game.galaxy;
    g.scenario!.flags.gwBeacon = true;
    g.scenario!.flags.gwHarvestCycle = true;
    const site = { id: 0, system: g.systems.find((s) => s !== null)!, habitat: null, base: null, progress: 0, stage: 0, wonder: 'beacon', founders: [], startDate: galaxyStarDate(g), completeDate: null, destroyedBy: null } as GreatWorkSite;
    beaconRolled(g, site);
    const st = peekBeaconState(g)!;
    const members = g.empires.filter((e): e is Empire => e !== null && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e.active && e !== st.faction);
    const cs = councilState(g);
    const c: Council = { id: cs.nextId++, name: 'Interstellar Diet', foundedYear: 0, members: [...members], chair: null, motion: null, results: [], blocs: [], coLosses: {}, losses: {}, sanctions: [], threats: [], recognised: [], condemned: {}, splitFrom: 0 };
    cs.councils.push(c);
    dietState(g);
    longNightState(g).age = 2;
    const me = g.playerEmpire!;
    for (const e of members) e.stateMoney = 50_000_000;
    savedData = gameData;
    return { game, gameData, g, me, ais: members.filter((e) => e !== me) };
}

beforeAll(() => {
    const s = build();
    saved = serializeGame(s.game, new GalaxyTime(), {} as StartGameOptions);
}, 900000);

function setup(): Setup {
    const { game } = deserializeGame(saved, savedData);
    const g = game.galaxy;
    const me = g.playerEmpire!;
    const st = peekBeaconState(g)!;
    const ais = g.empires.filter((e): e is Empire => e !== null && e !== g.independentEmpire && e !== me && e.pirateEmpireBaseHabitat === null && e.active && e !== st.faction);
    return { game, gameData: savedData, g, me, ais };
}

/** A motion of `kind` by `proposer` passes: the kind's effect runs with a law-maker like the Diet's. */
function pass(g: Galaxy, kind: string, proposer: Empire): void {
    const st = dietState(g);
    const m = { id: 1, kind, proposer, target: proposer, other: null, colony: null, resourceId: -1, text: kind, votes: [], status: 'passed', yes: 1, no: 0 } as unknown as DietMotion;
    dietMotionKindDef(kind)!.apply(g, st, m, (k, empire, other, colony, until) => {
        const law = { id: st.nextId++, kind: k, empire, other, colony, since: galaxyStarDate(g), until, text: kind };
        st.laws.push(law);
        return law;
    });
}

const advance = (g: Galaxy, days: number): void => {
    g.nowMs += days * DAY;
};
const colonyOf = (e: Empire): Habitat => e.capital!;
const popups = (e: Empire, title: string) => empireMessages(e).filter((m) => m.title === title);

describe('the gate', () => {
    it('exists only in an Age 2 galaxy with the Harvest Cycle on', () => {
        const s = setup();
        expect(stillnessActive(s.g)).toBe(true);
        expect(cannotBuild(s.g, s.me, colonyOf(s.me))).toBeNull();
        longNightState(s.g).age = 1;
        expect(stillnessActive(s.g)).toBe(false);
        expect(cannotBuild(s.g, s.me, colonyOf(s.me))).toBe('off');
        expect(availableThreatActions(s.g, s.me, colonyOf(s.me)).some((a) => a.kind === ACTION_BUILD)).toBe(false);
        longNightState(s.g).age = 2;
        s.g.scenario!.flags.gwHarvestCycle = false;
        expect(stillnessActive(s.g)).toBe(false);
    });
});

describe('building it', () => {
    it('the player starts it from an own colony: paid up front, a base of its own named by stage, no design added, one per galaxy', () => {
        const s = setup();
        const colony = colonyOf(s.me);
        const designs = s.me.designs.length;
        const money = s.me.stateMoney;
        expect(availableThreatActions(s.g, s.me, colony).some((a) => a.kind === ACTION_BUILD)).toBe(true);
        expect(availableThreatActions(s.g, s.me, colonyOf(s.ais[0])).some((a) => a.kind === ACTION_BUILD)).toBe(false); // not an own colony
        expect(runThreatAction(s.g, s.me, ACTION_BUILD, colony)).toBe(true);
        const eng = engineOf(s.g)!;
        expect(eng.status).toBe('building');
        expect(eng.ownerId).toBe(s.me.empireId);
        expect(s.me.stateMoney).toBe(money - SP.cost(s.g));
        expect(eng.base!.empire).toBe(s.me);
        expect(eng.base!.hasBeenDestroyed).toBe(false);
        expect(eng.base!.name).toContain('Stillness Engine');
        expect(s.me.designs.length).toBe(designs);
        expect(popups(s.me, 'The Stillness Engine').length).toBe(1);
        // one per galaxy: nobody else can start while it builds, and the order is gone
        expect(cannotBuild(s.g, s.ais[0], colonyOf(s.ais[0]))).toBe('exists');
        expect(startEngine(s.g, s.ais[0], colonyOf(s.ais[0]))).toBe(false);
        expect(availableThreatActions(s.g, s.ais[0], colonyOf(s.ais[0])).some((a) => a.kind === ACTION_BUILD)).toBe(false);
        expect(stillState(s.g).stats.built).toBe(1);
    });

    it('is refused without the money, with a message', () => {
        const s = setup();
        s.me.stateMoney = SP.cost(s.g) - 1;
        expect(cannotBuild(s.g, s.me, colonyOf(s.me))).toBe('funds');
        expect(runThreatAction(s.g, s.me, ACTION_BUILD, colonyOf(s.me))).toBe(false);
        expect(engineOf(s.g)).toBeNull();
        expect(popups(s.me, 'The Stillness Engine cannot be built').length).toBe(1);
    });

    it('takes stillnessYears: the base is renamed by stage, then it runs', () => {
        const s = setup();
        startEngine(s.g, s.me, colonyOf(s.me));
        const eng = engineOf(s.g)!;
        const first = eng.base!.name;
        advance(s.g, 360 * 5 * 0.3);
        stillnessStep(s.g);
        expect(eng.status).toBe('building');
        expect(eng.base!.name).not.toBe(first);
        expect(engineProgress(s.g, eng)).toBeGreaterThan(0.25);
        expect(stillnessFactor(s.g)).toBe(1);
        advance(s.g, 360 * 5 * 0.8);
        stillnessStep(s.g);
        expect(eng.status).toBe('running');
        expect(eng.base!.name).toBe('Stillness Engine');
        expect(engineRunning(s.g)).toBe(true);
        expect(stillnessFactor(s.g)).toBeCloseTo(0.5);
        expect(stillState(s.g).stats.finished).toBe(1);
        expect(popups(s.me, 'The Stillness Engine runs').length).toBe(1);
    });
});

describe('the slowdown', () => {
    it('halves every empire\'s research and nothing else; the owner switches it off and on, others cannot', () => {
        const s = setup();
        startEngine(s.g, s.me, colonyOf(s.me));
        advance(s.g, 360 * 5 + 1);
        stillnessStep(s.g);
        for (const e of [s.me, ...s.ais]) expect(scenarioQuery(s.g, 'researchSlowdownFactor', 1, { empire: e, industry: 0 })).toBeCloseTo(0.5);
        const base = engineOf(s.g)!.base!;
        expect(availableThreatActions(s.g, s.ais[0], base).some((a) => a.kind === ACTION_OFF)).toBe(false);
        expect(availableThreatActions(s.g, s.me, base).map((a) => a.kind)).toContain(ACTION_OFF);
        expect(runThreatAction(s.g, s.ais[0], ACTION_OFF, base)).toBe(false);
        expect(runThreatAction(s.g, s.me, ACTION_OFF, base)).toBe(true);
        expect(engineOf(s.g)!.status).toBe('off');
        expect(stillnessFactor(s.g)).toBe(1);
        expect(availableThreatActions(s.g, s.me, base).map((a) => a.kind)).toContain(ACTION_ON);
        // while it stands, switched off, nobody else may start another
        expect(cannotBuild(s.g, s.ais[0], colonyOf(s.ais[0]))).toBe('exists');
        expect(runThreatAction(s.g, s.me, ACTION_ON, base)).toBe(true);
        expect(stillnessFactor(s.g)).toBeCloseTo(0.5);
    });
});

describe('the end of it', () => {
    it('a destroyed base ends the project and frees the slot; the Beacon finished scraps it', () => {
        const s = setup();
        startEngine(s.g, s.me, colonyOf(s.me));
        const eng = engineOf(s.g)!;
        eng.base!.hasBeenDestroyed = true;
        eng.killedBy = s.ais[0].empireId;
        stillnessStep(s.g);
        expect(engineOf(s.g)).toBeNull();
        expect(stillState(s.g).stats.lost).toBe(1);
        expect(cannotBuild(s.g, s.ais[0], colonyOf(s.ais[0]))).toBeNull();
        // a new one, scrapped when the Beacon is finished
        expect(startEngine(s.g, s.ais[0], colonyOf(s.ais[0]))).toBe(true);
        advance(s.g, 360 * 5 + 1);
        stillnessStep(s.g);
        expect(engineRunning(s.g)).toBe(true);
        expect(beaconFinished(s.g)).toBe(false);
        peekBeaconState(s.g)!.phase = 'reclamation';
        stillnessStep(s.g);
        expect(engineOf(s.g)).toBeNull();
        expect(stillnessFactor(s.g)).toBe(1);
        expect(stillState(s.g).stats.scrapped).toBe(1);
    });
});

describe('the Severance sink is not slowed', () => {
    it('the blueprint takes the same research with the Engine running; the projects get half of what is left', () => {
        const run = (engine: boolean): { node: number; blueprint: number } => {
            const s = setup();
            const st = peekBeaconState(s.g)!;
            partsOf(st).held[String(s.me.empireId)] = { blueprint: { since: 1, progress: 0, sharePct: 25, done: false } };
            if (engine) {
                startEngine(s.g, s.me, colonyOf(s.me));
                advance(s.g, 360 * 5 + 1);
                stillnessStep(s.g);
                expect(engineRunning(s.g)).toBe(true);
            }
            const node = s.me.research.techTree.find((n) => !n.isResearched)!;
            node.cost = 1e12; // never finishes
            const before = node.progress;
            performResearchProjects(s.g, s.me, 1000, [node], 1000, IndustryType.Energy, false);
            return { node: node.progress - before, blueprint: heldParts(st, s.me)!.blueprint!.progress };
        };
        const plain = run(false);
        const slow = run(true);
        expect(plain.blueprint).toBeGreaterThan(0);
        expect(slow.blueprint).toBeCloseTo(plain.blueprint, 6);
        expect(slow.node).toBeCloseTo(plain.node * 0.5, 4);
        expect(plain.node).toBeGreaterThan(0);
    });
});

/** Makes `e` lean to destroy (an expansionist leader) or protect (an isolationist one), whatever its people. */
function lean(e: Empire, to: 'destroy' | 'protect'): void {
    const leader = e.leader!;
    leader.traits = leader.traits.filter((t) => t !== CharacterTraitType.Expansionist && t !== CharacterTraitType.Isolationist);
    leader.traits.push(to === 'destroy' ? CharacterTraitType.Expansionist : CharacterTraitType.Isolationist);
    e.dominantRace = { ...e.dominantRace!, expanding: to === 'destroy', aggression: to === 'destroy' ? 140 : 60 };
}

function standing(g: Galaxy, a: Empire, of: Empire, bias: number): void {
    obtainEmpireEvaluation(g, a, of).bias = bias;
}

describe('the AI takes a side', () => {
    it('expansionists lean to destroy and isolationists to protect, shifted by how they rate the owner', () => {
        const s = setup();
        const [owner, a, b] = s.ais;
        lean(a, 'destroy');
        lean(b, 'protect');
        standing(s.g, a, owner, -40);
        standing(s.g, b, owner, 40);
        expect(engineLean(s.g, a, owner)).toBeGreaterThan(AP.sideAt(s.g));
        expect(sideOf(s.g, a, owner)).toBe('destroy');
        expect(sideOf(s.g, b, owner)).toBe('protect');
        // the same people: a liked owner is less attacked, a hated one more
        standing(s.g, a, owner, 90);
        const liked = engineLean(s.g, a, owner);
        standing(s.g, a, owner, -90);
        expect(engineLean(s.g, a, owner)).toBeGreaterThan(liked + 20);
        standing(s.g, b, owner, -90);
        const hated = engineLean(s.g, b, owner);
        standing(s.g, b, owner, 90);
        expect(engineLean(s.g, b, owner)).toBeLessThan(hated);
        expect(isolationist(s.g, b)).toBe(true);
        expect(isolationist(s.g, a)).toBe(false);
    });

    it('the review records the sides; protectors and attackers show on the Knowledge page', () => {
        const s = setup();
        const [owner, a, b] = s.ais;
        lean(a, 'destroy');
        lean(b, 'protect');
        standing(s.g, a, owner, -40);
        standing(s.g, b, owner, 40);
        s.g.scenario!.params.stillnessAiStrikeMarginPct = 100000; // no strike this month: the sides only
        expect(startEngine(s.g, owner, colonyOf(owner))).toBe(true);
        stillnessReview(s.g);
        const eng = engineOf(s.g)!;
        expect(eng.sides[String(a.empireId)]).toBe('destroy');
        expect(eng.sides[String(b.empireId)]).toBe('protect');
        expect(eng.sides[String(owner.empireId)]).toBeUndefined();
        const rows = stillnessKnowledgeRows(s.g);
        expect(rows.find((r) => r.key === 'still:protect')!.status).toContain(b.name);
        expect(rows.find((r) => r.key === 'still:destroy')!.status).toContain(a.name);
        expect(rows.find((r) => r.key === 'still:engine')!.goTo).toBe(eng.base);
        expect(rows.find((r) => r.key === 'still:owner')!.status).toBe(owner.name);
        // a switched off Engine is left alone
        eng.status = 'off';
        const wars = stillState(s.g).stats.wars;
        stillnessReview(s.g);
        expect(stillState(s.g).stats.wars).toBe(wars);
    });
});

describe('the attackers', () => {
    it('an attacker not at war declares it over the Engine (a stated reason), then strikes the base; the Diet raises no emergency', () => {
        const s = setup();
        const [owner, a] = s.ais;
        lean(a, 'destroy');
        standing(s.g, a, owner, -60);
        for (const x of [owner, a]) for (const y of [owner, a]) if (x !== y) obtainDiplomaticRelation(x, y).type = DiplomaticRelationType.None;
        s.g.scenario!.params.stillnessAiStrikeMarginPct = 1;
        expect(startEngine(s.g, owner, colonyOf(owner))).toBe(true);
        const eng = engineOf(s.g)!;
        const before = empireMessages(s.me).length;
        expect(attackEngine(s.g, a, owner, eng)).toBe(true);
        expect(obtainDiplomaticRelation(a, owner).type).toBe(DiplomaticRelationType.War);
        expect(eng.warOver).toContain(a.empireId);
        expect(empireMessages(s.me).slice(before).some((m) => m.description.includes(`The ${a.name} have declared war on the ${owner.name} over the Stillness Engine`))).toBe(true);
        expect(peekDietState(s.g)!.pendingEmergency ?? null).toBeNull();
        const missions = empireShipGroups(a).filter((grp) => grp !== null && grp.mission !== null && grp.mission.targetBuiltObject === eng.base);
        expect(missions.length).toBeGreaterThan(0);
        expect(stillnessKnowledgeRows(s.g).some((r) => r.key === 'still:wars')).toBe(true);
    });

    it('does not declare war when it has no force that can win', () => {
        const s = setup();
        const [owner, a] = s.ais;
        for (const x of [owner, a]) for (const y of [owner, a]) if (x !== y) obtainDiplomaticRelation(x, y).type = DiplomaticRelationType.None;
        s.g.scenario!.params.stillnessAiStrikeMarginPct = 1e9;
        startEngine(s.g, owner, colonyOf(owner));
        expect(attackEngine(s.g, a, owner, engineOf(s.g)!)).toBe(false);
        expect(obtainDiplomaticRelation(a, owner).type).toBe(DiplomaticRelationType.None);
        expect(engineOf(s.g)!.warOver).toEqual([]);
    });

    it('with the Diet\'s demolition in force a member strikes without a war', () => {
        const s = setup();
        const [owner, a] = s.ais;
        for (const x of [owner, a]) for (const y of [owner, a]) if (x !== y) obtainDiplomaticRelation(x, y).type = DiplomaticRelationType.None;
        s.g.scenario!.params.stillnessAiStrikeMarginPct = 1;
        startEngine(s.g, owner, colonyOf(owner));
        const eng = engineOf(s.g)!;
        expect(demolishLegal(s.g, a)).toBe(false);
        pass(s.g, MOTION_DEMOLISH, s.me);
        expect(demolishLegal(s.g, a)).toBe(true);
        expect(attackEngine(s.g, a, owner, eng)).toBe(true);
        expect(obtainDiplomaticRelation(a, owner).type).toBe(DiplomaticRelationType.None); // no war
        expect(eng.warOver).toEqual([]);
    });
});

describe('the protectors', () => {
    it('keep one patrol fleet at the base', () => {
        const s = setup();
        const [owner, b] = s.ais;
        startEngine(s.g, owner, colonyOf(owner));
        const eng = engineOf(s.g)!;
        const groups = empireShipGroups(b).filter((x) => x !== null).length;
        const sent = sendPatrol(s.g, b, eng.base!);
        if (groups >= 3) {
            expect(sent).toBe(true);
            expect(empireShipGroups(b).some((grp) => grp !== null && grp.mission !== null && grp.mission.type === BuiltObjectMissionType.Patrol && grp.mission.targetBuiltObject === eng.base)).toBe(true);
        } else expect(sent).toBe(false);
    });
});

describe('the AI builders', () => {
    it('only an isolationist AI at peace with the money, after the first years, by a low roll; never a human; never when banned', () => {
        const s = setup();
        const [x, y, z] = s.ais;
        lean(x, 'protect');
        lean(y, 'destroy');
        lean(z, 'destroy');
        s.g.scenario!.params.stillnessAiChancePct = 100;
        s.g.scenario!.params.stillnessAiMinYears = 3;
        for (const e of s.ais) for (const o of s.ais) if (e !== o) obtainDiplomaticRelation(e, o).type = DiplomaticRelationType.None;
        expect(aiMaybeBuild(s.g)).toBe(false); // too early in the age
        advance(s.g, 360 * 3 + 5);
        stillState(s.g).start = galaxyStarDate(s.g) - 3 * YEAR_LENGTH - 1;
        x.stateMoney = SP.cost(s.g) * 2; // not enough
        expect(aiMaybeBuild(s.g)).toBe(false);
        x.stateMoney = SP.cost(s.g) * 4;
        stillState(s.g).banned = true;
        expect(aiMaybeBuild(s.g)).toBe(false);
        stillState(s.g).banned = false;
        expect(aiMaybeBuild(s.g)).toBe(true);
        expect(engineOf(s.g)!.ownerId).toBe(x.empireId);
        expect(aiMaybeBuild(s.g)).toBe(false); // one per galaxy
        expect(s.me.stateMoney).toBeGreaterThan(0);
    });

    it('the chance is low by default', () => {
        const s = setup();
        const [x] = s.ais;
        lean(x, 'protect');
        stillState(s.g).start = galaxyStarDate(s.g) - 20 * YEAR_LENGTH;
        let n = 0;
        for (let i = 0; i < 200 && engineOf(s.g) === null; i++) if (aiMaybeBuild(s.g)) n++;
        expect(n).toBeLessThanOrEqual(1);
        expect(AP.chancePct(s.g)).toBeLessThanOrEqual(2);
    });
});

/** An AI-owned Engine, running. */
function runningEngine(s: Setup, owner: Empire = s.ais[0]): void {
    startEngine(s.g, owner, colonyOf(owner));
    advance(s.g, 360 * 5 + 1);
    stillnessStep(s.g);
    expect(engineRunning(s.g)).toBe(true);
}

describe('Silence the Stillness Engine', () => {
    it('may be moved for a running Engine of an AI owner only; the owner votes no, the destroyers yes, the protectors no; it switches the Engine off', () => {
        const s = setup();
        const [owner, a, b] = s.ais;
        const def = dietMotionKindDef(MOTION_SILENCE)!;
        expect(def.proposable!(s.g)).toBe(false); // no Engine
        startEngine(s.g, owner, colonyOf(owner));
        expect(def.proposable!(s.g)).toBe(false); // still building
        advance(s.g, 360 * 5 + 1);
        stillnessStep(s.g);
        expect(def.proposable!(s.g)).toBe(true);
        expect(dietView(s.g, s.me)!.proposable.some((k) => k.kind === MOTION_SILENCE)).toBe(true);
        lean(a, 'destroy');
        lean(b, 'protect');
        standing(s.g, a, owner, -40);
        standing(s.g, b, owner, 40);
        const m = { id: 1, kind: MOTION_SILENCE, proposer: s.me, target: null, other: null, colony: null, resourceId: -1, text: '', votes: [], status: 'voting', yes: 0, no: 0 } as unknown as DietMotion;
        expect(def.voteScore(s.g, dietState(s.g), owner, m)).toBe(-100);
        expect(def.voteScore(s.g, dietState(s.g), s.me, m)).toBe(100);
        expect(def.voteScore(s.g, dietState(s.g), a, m)).toBeGreaterThan(5);
        expect(def.voteScore(s.g, dietState(s.g), b, m)).toBeLessThan(-5);
        expect(def.candidates!(s.g, dietState(s.g), a).length).toBe(1);
        expect(def.candidates!(s.g, dietState(s.g), b)).toEqual([]);
        pass(s.g, MOTION_SILENCE, s.me);
        expect(engineOf(s.g)!.status).toBe('off');
        expect(stillnessFactor(s.g)).toBe(1);
        expect(def.proposable!(s.g)).toBe(false);
    });

    it('is not offered for the player\'s own Engine (the player switches it off at will)', () => {
        const s = setup();
        runningEngine(s, s.me);
        expect(dietMotionKindDef(MOTION_SILENCE)!.proposable!(s.g)).toBe(false);
    });
});

describe('Demolish the Stillness Engine', () => {
    it('makes destroying it legal for members and bans a new one for ever, even if the law is repealed', () => {
        const s = setup();
        const def = dietMotionKindDef(MOTION_DEMOLISH)!;
        expect(def.proposable!(s.g)).toBe(false); // nothing to demolish
        runningEngine(s);
        expect(def.proposable!(s.g)).toBe(true);
        const [owner, a, b] = s.ais;
        lean(a, 'destroy');
        lean(b, 'protect');
        standing(s.g, a, owner, -60);
        standing(s.g, b, owner, 60);
        const m = { id: 1, kind: MOTION_DEMOLISH, proposer: a, target: null, other: null, colony: null, resourceId: -1, text: '', votes: [], status: 'voting', yes: 0, no: 0 } as unknown as DietMotion;
        expect(def.voteScore(s.g, dietState(s.g), owner, m)).toBe(-100);
        expect(def.voteScore(s.g, dietState(s.g), b, m)).toBeLessThan(-5);
        expect(def.candidates!(s.g, dietState(s.g), a).length).toBe(1);
        expect(demolishLegal(s.g, a)).toBe(false);
        pass(s.g, MOTION_DEMOLISH, a);
        expect(lawInForce(peekDietState(s.g), LAW_DEMOLISH_STILL)).not.toBeNull();
        expect(demolishLegal(s.g, a)).toBe(true);
        expect(demolishLegal(s.g, s.me)).toBe(true);
        expect(stillState(s.g).banned).toBe(true);
        expect(def.proposable!(s.g)).toBe(false);
        // destroyed: no new one, ever
        const eng = engineOf(s.g)!;
        eng.base!.hasBeenDestroyed = true;
        stillnessStep(s.g);
        expect(engineOf(s.g)).toBeNull();
        expect(cannotBuild(s.g, b, colonyOf(b))).toBe('banned');
        expect(startEngine(s.g, b, colonyOf(b))).toBe(false);
        expect(availableThreatActions(s.g, s.me, colonyOf(s.me)).some((x) => x.kind === ACTION_BUILD)).toBe(false);
        expect(aiMaybeBuild(s.g)).toBe(false);
        peekDietState(s.g)!.laws = [];
        expect(cannotBuild(s.g, b, colonyOf(b))).toBe('banned');
        expect(stillnessKnowledgeRows(s.g).some((r) => r.key === 'still:banned')).toBe(true);
    });
});

describe('the Knowledge page rows', () => {
    it('list the Engine, its owner, status and effect; nothing before it exists', () => {
        const s = setup();
        expect(stillnessKnowledgeRows(s.g)).toEqual([]);
        startEngine(s.g, s.ais[0], colonyOf(s.ais[0]));
        const rows = stillnessKnowledgeRows(s.g);
        expect(rows.map((r) => r.key)).toEqual(['still:engine', 'still:owner', 'still:effect']);
        expect(rows[0].status).toContain('under construction');
        advance(s.g, 360 * 5 + 1);
        stillnessStep(s.g);
        const done = stillnessKnowledgeRows(s.g);
        expect(done[0].status).toBe('running');
        expect(done[2].status).toContain('50%');
        engineOf(s.g)!.status = 'off';
        expect(stillnessKnowledgeRows(s.g)[0].status).toBe('switched off');
    });
});

describe('the save', () => {
    it('keeps the Engine, its sides, the ban and the clock through a round trip', () => {
        const s = setup();
        runningEngine(s);
        const eng = engineOf(s.g)!;
        eng.sides = { '1': 'protect', '2': 'destroy' };
        eng.warOver = [2];
        stillState(s.g).banned = true;
        const back = deserializeGame(serializeGame(s.game, new GalaxyTime(), {} as StartGameOptions), savedData).game.galaxy;
        const st = back.scenario!.state[STILL_KEY] as NonNullable<ReturnType<typeof peekStill>>;
        expect(st.banned).toBe(true);
        expect(st.engine!.status).toBe('running');
        expect(st.engine!.ownerId).toBe(eng.ownerId);
        expect(st.engine!.sides).toEqual({ '1': 'protect', '2': 'destroy' });
        expect(st.engine!.warOver).toEqual([2]);
        expect(st.engine!.base).not.toBeNull();
        expect(st.engine!.base!.hasBeenDestroyed).toBe(false);
        expect(back.empires.some((e) => e !== null && e.builtObjects.includes(st.engine!.base!))).toBe(true);
        expect(stillnessFactor(back)).toBeCloseTo(0.5);
        stillnessStep(back); // keeps running after the load
        expect(engineRunning(back)).toBe(true);
    });
});

// ---------------------------------------------------------------------------------------------------------------
// The preparation votes
// ---------------------------------------------------------------------------------------------------------------

/** The player holds an Age 1 memory record whose Scars are the capitals of the first two AI empires (scar worlds held by Diet members). */
function withMemory(s: Setup): Habitat[] {
    const scars = [s.ais[0].capital!, s.ais[1].capital!];
    longNightState(s.g).memory = {
        age: 2, seed: 1, fromDate: 0, eliminatedPct: 50,
        scars: scars.map((h) => ({ name: h.name, systemName: h.name, x: h.xpos, y: h.ypos, fate: 'live' as const, knownToPlayer: true })),
        foundries: { located: [], destroyed: [] }, megaStation: { components: {}, blueprintPoints: 0 }, truths: [], player: null, extra: {},
    };
    return scars;
}

describe('Recognise the Harvest', () => {
    it('only a human holding the memory record may move it; once at a time', () => {
        const s = setup();
        const def = dietMotionKindDef(MOTION_RECOGNISE)!;
        expect(def.proposable!(s.g)).toBe(false); // no memory record
        withMemory(s);
        expect(def.proposable!(s.g)).toBe(true);
        expect(def.proposableBy!(s.g, s.me)).toBe(true);
        for (const ai of s.ais) expect(def.proposableBy!(s.g, ai)).toBe(false);
        expect(dietView(s.g, s.me)!.proposable.some((k) => k.kind === MOTION_RECOGNISE)).toBe(true);
        longNightState(s.g).age = 1;
        expect(def.proposable!(s.g)).toBe(false);
        longNightState(s.g).age = 2;
        pass(s.g, MOTION_RECOGNISE, s.me);
        expect(harvestRecognised(s.g)).toBe(true);
        expect(def.proposable!(s.g)).toBe(false);
    });

    it('AI members vote by their caution and their standing with the proposer', () => {
        const s = setup();
        withMemory(s);
        const def = dietMotionKindDef(MOTION_RECOGNISE)!;
        const [a] = s.ais;
        const m = { id: 1, kind: MOTION_RECOGNISE, proposer: s.me, target: s.me, other: null, colony: null, resourceId: -1, text: '', votes: [], status: 'voting', yes: 0, no: 0 } as unknown as DietMotion;
        expect(def.voteScore(s.g, dietState(s.g), s.me, m)).toBe(100);
        const cautious = (c: number): number => {
            a.dominantRace = { ...a.dominantRace!, caution: c };
            return def.voteScore(s.g, dietState(s.g), a, m);
        };
        expect(cautious(140)).toBeGreaterThan(cautious(60) + 10);
        // the proposer's standing is the Diet's own addition to every score
        standing(s.g, a, s.me, 80);
        const liked = dietVoteScore(s.g, dietCouncil(s.g)!, dietState(s.g), a, m);
        standing(s.g, a, s.me, -80);
        expect(liked).toBeGreaterThan(dietVoteScore(s.g, dietCouncil(s.g)!, dietState(s.g), a, m) + 10);
    });

    it('once passed, the AI value the Scar worlds higher as targets; the player\'s view and other worlds are unchanged', () => {
        const s = setup();
        const scars = withMemory(s);
        const other = s.ais[2].capital!;
        const val = (e: Empire, h: Habitat): number => scenarioQuery(s.g, 'colonizationTargetValue', 100, { empire: e, habitat: h, filterOutDangerousTargets: false });
        expect(val(s.ais[2], scars[0])).toBe(100);
        pass(s.g, MOTION_RECOGNISE, s.me);
        expect(val(s.ais[2], scars[0])).toBeCloseTo(150);
        expect(val(s.ais[2], other)).toBe(100);
        expect(val(s.me, scars[0])).toBe(100);
    });

    it('the AI members contribute to the Severance: a higher vote score, and their parts are handed over even when the part-trade attitude rule says no', () => {
        const s = setup();
        withMemory(s);
        const bs = peekBeaconState(s.g)!;
        const [a] = s.ais;
        partsOf(bs).held[String(s.me.empireId)] = { blueprint: { since: 1, progress: 1, sharePct: 25, done: true } };
        partsOf(bs).held[String(a.empireId)] = { cloakLattice: true };
        obtainDiplomaticRelation(a, s.me).type = DiplomaticRelationType.None;
        standing(s.g, a, s.me, -80); // it dislikes the builder: it refuses parts
        expect(partTradeAllowed(s.g, a, s.me)).toBe(false);
        const mega = dietMotionKindDef(MOTION_MEGA)!;
        const m = { id: 1, kind: MOTION_MEGA, proposer: s.me, target: s.me, other: null, colony: null, resourceId: -1, text: '', votes: [{ empire: a, vote: 'yes', weight: 1, score: 0 }], status: 'passed', yes: 1, no: 0, place: { x: s.g.sizeX / 2, y: s.g.sizeY / 2 } } as unknown as DietMotion;
        const before = mega.voteScore(s.g, dietState(s.g), a, m);
        pass(s.g, MOTION_RECOGNISE, s.me);
        expect(mega.voteScore(s.g, dietState(s.g), a, m)).toBeCloseTo(before + 30);
        expect(mega.voteScore(s.g, dietState(s.g), s.me, m)).toBe(100);
        expect(severanceVoteBonus(s.g, s.me)).toBe(0);
        expect(harvestPledges(s.g, a, s.me)).toBe(true);
        obtainDiplomaticRelation(a, s.me).type = DiplomaticRelationType.War;
        expect(harvestPledges(s.g, a, s.me)).toBe(false); // not at war with the builder
        obtainDiplomaticRelation(a, s.me).type = DiplomaticRelationType.None;
        const startMegaApply = (): void => mega.apply(s.g, dietState(s.g), m, (() => undefined) as never);
        startMegaApply();
        const pool = peekMega(s.g)!.pool;
        expect(pool[a.name]?.cloakLattice).toBe(true);
        expect(peekMega(s.g)!.contributors).toContain(a.empireId);
    });
});

describe('Guard the Scars', () => {
    it('may be moved only once the Harvest is recognised; holders of Scars and the cautious vote for it, the covetous against', () => {
        const s = setup();
        const scars = withMemory(s);
        void scars;
        const def = dietMotionKindDef(MOTION_GUARD)!;
        expect(def.proposable!(s.g)).toBe(false);
        pass(s.g, MOTION_RECOGNISE, s.me);
        expect(def.proposable!(s.g)).toBe(true);
        expect(dietView(s.g, s.me)!.proposable.some((k) => k.kind === MOTION_GUARD)).toBe(true);
        const [holder, , bystander] = s.ais;
        const m = { id: 1, kind: MOTION_GUARD, proposer: s.me, target: null, other: null, colony: null, resourceId: -1, text: '', votes: [], status: 'voting', yes: 0, no: 0 } as unknown as DietMotion;
        holder.dominantRace = { ...holder.dominantRace!, aggression: 100, caution: 100, friendliness: 100 };
        bystander.dominantRace = { ...bystander.dominantRace!, aggression: 140, caution: 100, friendliness: 100 };
        expect(def.voteScore(s.g, dietState(s.g), holder, m)).toBeGreaterThan(20);
        expect(def.voteScore(s.g, dietState(s.g), bystander, m)).toBeLessThan(0);
        expect(def.candidates!(s.g, dietState(s.g), holder).length).toBe(1);
        expect(def.candidates!(s.g, dietState(s.g), s.me)).toEqual([]); // a human moves its own
        pass(s.g, MOTION_GUARD, holder);
        expect(scarsGuarded(s.g)).toBe(true);
        expect(def.proposable!(s.g)).toBe(false);
    });

    it('AI members take no hostile mission against another member\'s Scar world and do not invade it; a human is free, other worlds are free; only while the law stands', () => {
        const s = setup();
        const [x, y, z] = s.ais;
        const scars = withMemory(s);
        const hab = scars[0];
        expect(hab.empire).toBe(x);
        const ship = (e: Empire) => e.builtObjects.find((b) => !b.hasBeenDestroyed && b.topSpeed > 0)!;
        const may = (e: Empire, target: Habitat, type = BuiltObjectMissionType.Attack): boolean =>
            scenarioQuery(s.g, 'assignMissionAllowed', true, { builtObject: ship(e), missionType: type, target, x: -2000000001, y: -2000000001 });
        pass(s.g, MOTION_RECOGNISE, s.me);
        expect(may(y, hab)).toBe(true); // not guarded yet
        pass(s.g, MOTION_GUARD, y);
        expect(may(y, hab)).toBe(false);
        expect(may(y, hab, BuiltObjectMissionType.UnloadTroops)).toBe(false);
        expect(may(y, hab, BuiltObjectMissionType.Move)).toBe(true);
        expect(may(x, hab)).toBe(true); // its own world
        expect(may(y, z.capital!)).toBe(true); // not a Scar
        expect(may(s.me, hab)).toBe(true); // a human decides for itself
        const fleet = {} as ShipGroup;
        expect(scenarioQuery(s.g, 'invasionTargetOrbitOk', true, { empire: y, fleet, target: hab })).toBe(false);
        expect(scenarioQuery(s.g, 'invasionTargetOrbitOk', true, { empire: y, fleet, target: z.capital! })).toBe(true);
        expect(scenarioQuery(s.g, 'invasionTargetOrbitOk', true, { empire: s.me, fleet, target: hab })).toBe(true);
        peekDietState(s.g)!.laws = peekDietState(s.g)!.laws.filter((l) => l.kind !== LAW_GUARD);
        expect(may(y, hab)).toBe(true);
    });

    it('a member that takes a member\'s Scar world breaks the law: the violation path (grievance, standing with every member), once a year per world', () => {
        const s = setup();
        const [x, y] = s.ais;
        const scars = withMemory(s);
        pass(s.g, MOTION_RECOGNISE, s.me);
        pass(s.g, MOTION_GUARD, y);
        const st = dietState(s.g);
        const g0 = st.grievances[y.empireId] ?? 0;
        const rep = (a: Empire, b: Empire): number => reputationSum(s.g, a, b);
        const r0 = rep(s.ais[2], y);
        scenarioEmit(s.g, 'colonyOwnerChanged', { colony: scars[0], from: x, to: y });
        expect(st.grievances[y.empireId] ?? 0).toBe(g0 + 40);
        if (reputationOn(s.g)) expect(rep(s.ais[2], y)).toBeLessThan(r0);
        scenarioEmit(s.g, 'colonyOwnerChanged', { colony: scars[0], from: y, to: x });
        scenarioEmit(s.g, 'colonyOwnerChanged', { colony: scars[0], from: x, to: y }); // again within the year
        expect(st.grievances[y.empireId] ?? 0).toBe(g0 + 40);
        advance(s.g, 361);
        scenarioEmit(s.g, 'colonyOwnerChanged', { colony: scars[0], from: x, to: y });
        expect(st.grievances[y.empireId] ?? 0).toBe(g0 + 80);
        // a world that is no Scar, or taken from a non-member, costs nothing
        scenarioEmit(s.g, 'colonyOwnerChanged', { colony: s.ais[2].capital!, from: s.ais[2], to: y });
        scenarioEmit(s.g, 'colonyOwnerChanged', { colony: scars[1], from: null, to: y });
        expect(st.grievances[y.empireId] ?? 0).toBe(g0 + 80);
    });
});

describe('in a running game', () => {
    it('an isolationist AI builds it, the sides form, wars and strikes follow, and the clock keeps the research slowed (a short run)', () => {
        const s = setup();
        const [x, y, z] = s.ais;
        lean(x, 'protect');
        lean(y, 'destroy');
        lean(z, 'destroy');
        standing(s.g, y, x, -80);
        standing(s.g, z, x, -80);
        Object.assign(s.g.scenario!.params, { stillnessAiChancePct: 100, stillnessAiMinYears: 0, stillnessYears: 0.02, stillnessAiStrikeMarginPct: 1 });
        for (const e of s.ais) e.stateMoney = 1e9;
        const state = stillState(s.g);
        state.start = galaxyStarDate(s.g) - YEAR_LENGTH;
        runGameSeconds(s.game, 120);
        expect(state.stats.built).toBe(1);
        const eng = engineOf(s.g)!;
        expect(eng.ownerId).toBe(x.empireId);
        expect(eng.status).toBe('running');
        expect(stillnessFactor(s.g)).toBeCloseTo(0.5);
        expect(eng.sides).toEqual({ [String(y.empireId)]: 'destroy', [String(z.empireId)]: 'destroy' });
        expect([...eng.warOver].sort()).toEqual([y.empireId, z.empireId].sort());
        expect(obtainDiplomaticRelation(y, x).type).toBe(DiplomaticRelationType.War);
    }, 90000);
});

describe('a captured base', () => {
  it('passes the Engine to the capturer, the sides start over; a faction that is no player ends the project', () => {
    const s = setup();
    const [owner, a] = s.ais;
    runningEngine(s, owner);
    const eng = engineOf(s.g)!;
    eng.sides = { '9': 'destroy' };
    takeOwnershipOfBuiltObject(s.g, a, eng.base!, a, false);
    stillnessStep(s.g);
    expect(engineOf(s.g)!.ownerId).toBe(a.empireId);
    expect(engineOf(s.g)!.sides).toEqual({});
    const faction = peekBeaconState(s.g)!.faction!;
    takeOwnershipOfBuiltObject(s.g, faction, eng.base!, faction, false);
    stillnessStep(s.g);
    expect(engineOf(s.g)).toBeNull();
  });
});

describe('the laws can be repealed', () => {
  it('a repeal vote weighs each law by interest, not a fixed 100; the ban outlives the Demolish law', () => {
    const s = setup();
    const scars = withMemory(s);
    void scars;
    const [owner, a, b] = s.ais;
    lean(a, 'destroy');
    lean(b, 'protect');
    standing(s.g, a, owner, -60);
    standing(s.g, b, owner, 60);
    runningEngine(s, owner);
    pass(s.g, MOTION_DEMOLISH, a);
    pass(s.g, MOTION_RECOGNISE, s.me);
    pass(s.g, MOTION_GUARD, a);
    const st = dietState(s.g);
    const council = dietCouncil(s.g)!;
    const repeal = (kind: string, voter: Empire): number => {
      const law = lawInForce(st, kind)!;
      const m = { id: 7, kind: 'repeal', proposer: s.me, target: null, other: null, colony: null, resourceId: law.id, text: '', votes: [], status: 'voting', yes: 0, no: 0 } as unknown as DietMotion;
      return dietVoteScore(s.g, council, st, voter, m);
    };
    expect(repeal(LAW_DEMOLISH_STILL, owner)).toBeGreaterThan(50); // the owner wants it gone
    expect(repeal(LAW_DEMOLISH_STILL, b)).toBeGreaterThan(5); // a protector votes to repeal it
    expect(repeal(LAW_DEMOLISH_STILL, a)).toBe(-100); // its mover keeps it
    expect(repeal(LAW_GUARD, b)).toBeLessThan(99);
    expect(repeal(LAW_GUARD, b)).toBeGreaterThan(-99);
    expect(repeal(LAW_RECOGNISE, b)).toBeGreaterThan(-99);
    expect(repeal(LAW_RECOGNISE, b)).toBeLessThan(99);
    // repealed: destroying is no longer legal, the ban stays
    st.laws = st.laws.filter((l) => l.kind !== LAW_DEMOLISH_STILL);
    expect(demolishLegal(s.g, a)).toBe(false);
    expect(stillState(s.g).banned).toBe(true);
  });
});

describe('the base is locked', () => {
  it('is neither retrofitted nor scrapped by the AI, nor by its owner (a message); the name stays fixed', () => {
    const s = setup();
    startEngine(s.g, s.me, colonyOf(s.me));
    const eng = engineOf(s.g)!;
    const base = eng.base!;
    expect(scenarioQuery(s.g, 'builtObjectLocked', false, { builtObject: base })).toBe(true);
    expect(scenarioQuery(s.g, 'builtObjectLocked', false, { builtObject: s.me.builtObjects.find((b) => b !== base)! })).toBe(false);
    const other = s.me.designs.find((d) => d !== null && d !== base.design && d.subRole === base.subRole) ?? s.me.designs.find((d) => d !== null && d !== base.design)!;
    expect(assignRetrofitMission(s.g, s.me, base, other, null, true)).toBe(false);
    expect(base.retrofitDesign).toBeNull();
    expect(assignScrapMission(s.g, s.me, base)).toBe(false);
    expect(base.hasBeenDestroyed).toBe(false);
    expect(scrapBuiltObjects(s.g, s.me, [base])).toBe(0);
    expect(base.hasBeenDestroyed).toBe(false);
    expect(popups(s.me, 'The Stillness Engine cannot be altered').length).toBeGreaterThanOrEqual(1);
    base.name = 'Renamed';
    stillnessStep(s.g);
    expect(base.name).toContain('Stillness Engine');
  });
});

describe('wars over the Engine', () => {
  it('end with it: the declarer proposes peace; a human gets the stock proposal, a few times at most', () => {
    const s = setup();
    const [x, a] = s.ais;
    for (const o of [x, a]) for (const p of [s.me, x, a]) if (o !== p) obtainDiplomaticRelation(o, p).type = DiplomaticRelationType.None;
    s.g.scenario!.params.stillnessAiStrikeMarginPct = 1;
    startEngine(s.g, s.me, colonyOf(s.me));
    const eng = engineOf(s.g)!;
    expect(attackEngine(s.g, a, s.me, eng)).toBe(true);
    const st = stillState(s.g);
    expect(st.wars).toEqual([{ a: a.empireId, b: s.me.empireId, kind: 'attack', tries: 0 }]);
    peaceStep(s.g); // the Engine stands: the war goes on
    expect(st.wars![0].tries).toBe(0);
    eng.base!.hasBeenDestroyed = true;
    stillnessStep(s.g);
    expect(engineEnded(s.g)).toBe(true);
    advance(s.g, 400);
    const before = s.me.proposedDiplomaticRelations.length;
    peaceStep(s.g);
    expect(st.wars![0].tries).toBe(1);
    expect(s.me.proposedDiplomaticRelations.length).toBeGreaterThan(before);
    expect(obtainDiplomaticRelation(a, s.me).type).toBe(DiplomaticRelationType.War); // an offer, not a forced peace
    for (let i = 0; i < 5; i++) peaceStep(s.g);
    expect(st.wars).toEqual([]); // three tries to a human, then dropped
    // a war already ended is simply dropped
    st.wars = [{ a: a.empireId, b: x.empireId, kind: 'attack', tries: 0 }];
    obtainDiplomaticRelation(a, x).type = DiplomaticRelationType.None;
    peaceStep(s.g);
    expect(st.wars).toEqual([]);
  });

  it('an Engine silenced by the Diet (AI owner) ends them too; one switched off by a player does not', () => {
    const s = setup();
    runningEngine(s, s.ais[0]);
    expect(engineEnded(s.g)).toBe(false);
    switchEngine(s.g, false, null);
    expect(engineEnded(s.g)).toBe(true);
    const t = setup();
    runningEngine(t, t.me);
    switchEngine(t.g, false, t.me);
    expect(engineEnded(t.g)).toBe(false);
  });

  it('protectors with a fleet at the base declare on an empire that actually strikes it, never on a mere declaration, under the caps', () => {
    const s = setup();
    const [x, a, b] = s.ais;
    for (const o of [x, a, b, s.me]) for (const p of [x, a, b, s.me]) if (o !== p) obtainDiplomaticRelation(o, p).type = DiplomaticRelationType.None;
    s.g.scenario!.params.stillnessAiStrikeMarginPct = 1;
    startEngine(s.g, x, colonyOf(x));
    const eng = engineOf(s.g)!;
    eng.sides = { [String(b.empireId)]: 'protect', [String(a.empireId)]: 'destroy' };
    const guard = b.builtObjects.find((o) => !o.hasBeenDestroyed && o.topSpeed > 0 && o.role === BuiltObjectRole.Military)!;
    guard.xpos = eng.base!.xpos;
    guard.ypos = eng.base!.ypos;
    rebuildIndexes(s.g);
    attackEngine(s.g, a, x, eng); // a declares on the owner: b does not follow
    protectorsReact(s.g);
    expect(obtainDiplomaticRelation(b, a).type).toBe(DiplomaticRelationType.None);
    // the cap: already in two wars
    obtainDiplomaticRelation(b, s.me).type = DiplomaticRelationType.War;
    obtainDiplomaticRelation(b, x).type = DiplomaticRelationType.War;
    eng.struck = [a.empireId];
    s.g.scenario!.params.stillnessAiStrikeMarginPct = 1e9;
    protectorsReact(s.g);
    expect(obtainDiplomaticRelation(b, a).type).toBe(DiplomaticRelationType.None);
    expect(eng.answered).toEqual([a.empireId]);
    // free: a strikes, b answers
    obtainDiplomaticRelation(b, s.me).type = DiplomaticRelationType.None;
    obtainDiplomaticRelation(b, x).type = DiplomaticRelationType.None;
    eng.answered = [];
    const before = empireMessages(s.me).length;
    protectorsReact(s.g);
    expect(obtainDiplomaticRelation(b, a).type).toBe(DiplomaticRelationType.War);
    expect(stillState(s.g).wars!.some((w) => w.a === b.empireId && w.b === a.empireId && w.kind === 'protect')).toBe(true);
    expect(empireMessages(s.me).slice(before).some((m) => m.description.includes(`The ${b.name} have declared war on the ${a.name} for striking the Stillness Engine`))).toBe(true);
    // too weak against the attacker: no
    obtainDiplomaticRelation(b, a).type = DiplomaticRelationType.None;
    stillState(s.g).wars = [];
    eng.answered = [];
    s.g.scenario!.params.stillnessAiStrikeMarginPct = 0;
    protectorsReact(s.g);
    expect(obtainDiplomaticRelation(b, a).type).toBe(DiplomaticRelationType.None);
  });

  it('the hit on the base is recorded as a strike by the attacking empire only', () => {
    const s = setup();
    const [x, a] = s.ais;
    startEngine(s.g, x, colonyOf(x));
    const eng = engineOf(s.g)!;
    scenarioEmit(s.g, 'builtObjectAttacked', { builtObject: eng.base!, attacker: null, attackingEmpire: x });
    expect(eng.struck ?? []).toEqual([]); // the owner itself
    scenarioEmit(s.g, 'builtObjectAttacked', { builtObject: eng.base!, attacker: null, attackingEmpire: a });
    scenarioEmit(s.g, 'builtObjectAttacked', { builtObject: eng.base!, attacker: null, attackingEmpire: a });
    expect(eng.struck).toEqual([a.empireId]);
  });
});
