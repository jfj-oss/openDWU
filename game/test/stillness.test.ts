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
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../src/sim/diplomacy';
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
    ACTION_BUILD, ACTION_OFF, ACTION_ON, LAW_DEMOLISH_STILL, SP, STILL_KEY, beaconFinished, cannotBuild, engineOf, engineProgress, engineRunning, startEngine, stillState, stillnessActive,
    stillnessFactor, stillnessKnowledgeRows, stillnessStep, switchEngine, scrapEngine, peekStill,
} from '../src/sim/scenario/threats/giantworks/stillness';

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
