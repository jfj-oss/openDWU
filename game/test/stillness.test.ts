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
import { GAME_DAY_LENGTH, scenarioQuery } from '../src/sim/scenario/hooks';
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
    LAW_DEMOLISH_STILL, STILL_KEY, demolishLegal, peekStill, stillnessFactor, stillnessKnowledgeRows, stillnessStep,
} from '../src/sim/scenario/threats/giantworks/stillness';
import { AP, aiMaybeBuild, attackEngine, engineLean, isolationist, sendPatrol, sideOf, stillnessReview } from '../src/sim/scenario/threats/giantworks/stillnessAi';
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
        expect(empireMessages(s.me).slice(before).some((m) => m.description.includes(`${a.name} declares war on ${owner.name} because of the Stillness Engine`))).toBe(true);
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
