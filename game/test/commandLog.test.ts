// Command log (tasks/M4-agent-brief.md "Command log"): player commands are queued, applied at the next frame
// boundary with the sim time stamped, journaled with their arguments encoded, and seed + log replays the game. The 600 s
// soak is commandReplay.test.ts; this is the fast tier (60 s script, queue and codec unit checks).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import { tickGameOptions } from './helpers/tickGame';
import { commandScript, createdFleets, fullDigest, runScripted, setRunId } from './helpers/commandScript';
import type { GameData } from '../src/sim/data/gameData';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { stateDigest } from '../src/sim/tick/digest';
import { runGameSeconds } from '../src/sim/tick/harness';
import { SimDriver, runSimFrame } from '../src/sim/tick/scheduler';
import { enterSimFrame, leaveSimFrame } from '../src/sim/tick/commandBoundary';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { commandLog, type PlayerLogEntry } from '../src/sim/player/commandLog';
import { decodeCommandArg, encodeCommandArg } from '../src/sim/player/commandCodec';
import { commandLogReplayWarnings, flushPlayerCommands, issuePlayerCommand, noteSimView, pendingPlayerCommands, replayCommandLog, runPlayerCommand } from '../src/sim/player/playerCommands';
import { ShipAction, ShipActionType, createMissionShipActionAt, createShipAction } from '../src/sim/player/shipAction';
import { BuiltObjectMissionType } from '../src/sim/missions/mission';
import { empireShipGroups } from '../src/sim/fleets/shipGroup';
import type { StartGameOptions } from '../src/sim/startGameOptions';
import { createScenarioGame } from './helpers/scenarioGame';
import { pendingScenarioDecisions, raiseScenarioDecision, registerScenarioDecision } from '../src/sim/scenario/decisions';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

describe('command queue: applied at the next frame boundary, stamped with the sim time', () => {
    it('a DOM-style issue changes nothing until the next frame starts; then it applies before the clock advances', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const p = game.playerEmpire;
        runGameSeconds(g, 1);
        const before = g.nowMs;
        const policy = p.policy;
        let applied: boolean | null = null;
        issuePlayerCommand(g, p, 'setPolicy', [{ ...p.policy!, researchPriority: 1.5 }], (r) => {
            applied = r;
            // Inside the boundary: the frame has not advanced the clock yet.
            expect(g.nowMs).toBe(before);
        });
        expect(p.policy).toBe(policy);
        expect(pendingPlayerCommands(g)).toBe(1);
        expect(commandLog(g)).toHaveLength(0);
        runSimFrame(g, 17);
        expect(applied).toBe(true);
        expect(p.policy!.researchPriority).toBe(1.5);
        expect(pendingPlayerCommands(g)).toBe(0);
        const [e] = commandLog(g) as PlayerLogEntry[];
        expect(e).toMatchObject({ source: 'player', op: 'setPolicy', nowMs: before });
        expect(e.starDate).toBeLessThanOrEqual(galaxyStarDate(g));
        expect(g.nowMs).toBe(before + 17);
    }, 300000);

    it('while paused, the driver applies queued orders at once (the frozen clock is the boundary)', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const p = game.playerEmpire;
        const driver = new SimDriver(g, 1, true);
        const now = g.nowMs;
        issuePlayerCommand(g, p, 'automationOff', ['Colony Tax Rates']);
        expect(driver.advance(100)).toBe(0);
        expect(p.controlColonyTaxRates).toBe(false);
        expect(g.nowMs).toBe(now);
        expect((commandLog(g) as PlayerLogEntry[]).map((e) => [e.op, e.nowMs])).toEqual([['automationOff', now]]);
    }, 300000);

    it('commands cannot be issued or flushed inside a sim frame', () => {
        const game = cachedTickGame(gameData);
        enterSimFrame();
        try {
            expect(() => issuePlayerCommand(game.galaxy, game.playerEmpire, 'automationOff', ['Colonization'])).toThrow(/inside a sim frame/);
            expect(() => flushPlayerCommands(game.galaxy)).toThrow(/inside a sim frame/);
        } finally {
            leaveSimFrame();
        }
    }, 300000);

    it('no commands: no log, and the frames are exactly the plain scheduler frames', () => {
        const a = cachedTickGame(gameData).galaxy;
        const b = cachedTickGame(gameData).galaxy;
        flushPlayerCommands(a); // a drainer with an empty queue
        issuePlayerCommand(a, a.playerEmpire!, 'automationOff', ['nothing']); // an op that changes nothing
        runGameSeconds(a, 5);
        runGameSeconds(b, 5);
        expect(stateDigest(a)).toBe(stateDigest(b));
        expect(commandLog(b)).toHaveLength(0);
    }, 300000);

    it('runPlayerCommand (async callers: advisor chat, diplomat counter) applies at once and journals', () => {
        const game = cachedTickGame(gameData);
        const r = runPlayerCommand(game.galaxy, game.playerEmpire, 'setEmpireControl', ['controlResearch', false]);
        expect(r).toBe(true);
        expect(game.playerEmpire.controlResearch).toBe(false);
        expect(runPlayerCommand(game.galaxy, game.playerEmpire, 'setEmpireControl', ['stateMoney', 1e9])).toBe(false); // only control* fields
        expect(commandLog(game.galaxy)).toHaveLength(2);
    }, 300000);
});

describe('camera LOD pass (?simView=1) in the log', () => {
    it('switching it on is journaled once and makes a replay warn', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        noteSimView(g, false); // the default: nothing logged
        expect(commandLog(g)).toHaveLength(0);
        noteSimView(g, true);
        noteSimView(g, true);
        expect(commandLog(g).map((e) => e.source)).toEqual(['view']);
        const warnings = commandLogReplayWarnings(commandLog(g));
        expect(warnings).toHaveLength(1);
        const { seed, ...options } = tickGameOptions(gameData);
        const seen: string[] = [];
        replayCommandLog(seed, options, commandLog(g), g.nowMs, (m) => seen.push(m));
        expect(seen).toEqual(warnings);
    }, 300000);
});

describe('command codec', () => {
    it('sim objects encode as stable references and resolve back to the same objects; orders by value', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const p = game.playerEmpire;
        const ship = p.builtObjects.find((b) => b !== null)!;
        const capital = p.capital!;
        const other = g.empires.find((e) => e !== p)!;
        const design = p.designs[0];
        const node = p.research.techTree[3];
        const action = createMissionShipActionAt(BuiltObjectMissionType.Move, capital, Math.trunc(capital.xpos) + 5, Math.trunc(capital.ypos));
        action.isSubsequentAction = true;
        for (const v of [ship, capital, other, p, design, node, g.systems[2], [ship, capital], { x: 1, y: 2 }, null, undefined, 'x', 3.5, true]) {
            const enc = encodeCommandArg(g, v);
            expect(JSON.parse(JSON.stringify(enc))).toEqual(enc);
            expect(decodeCommandArg(g, enc)).toEqual(v);
            if (v !== null && typeof v === 'object' && !Array.isArray(v) && !('x' in v)) expect(decodeCommandArg(g, enc)).toBe(v);
        }
        const back = decodeCommandArg(g, encodeCommandArg(g, action)) as ShipAction;
        expect(back).toBeInstanceOf(ShipAction);
        expect(back.target).toBe(capital);
        expect(back.position).toEqual({ x: 5, y: 0 });
        expect(back.isSubsequentAction).toBe(true);
        // Static data (a race) is an external of the save.
        expect(decodeCommandArg(g, encodeCommandArg(g, p.dominantRace))).toBe(p.dominantRace);
    }, 300000);

    it('an argument the log cannot write is still applied, and the entry says why it cannot be replayed', () => {
        const game = cachedTickGame(gameData);
        const p = game.playerEmpire;
        class Unregistered {
            v = 1;
        }
        // The op ignores the extra field; the log cannot encode the Unregistered instance.
        issuePlayerCommand(game.galaxy, p, 'setPolicy', [{ ...p.policy!, researchPriority: 0.5, extra: new Unregistered() } as never]);
        flushPlayerCommands(game.galaxy);
        expect(p.policy!.researchPriority).toBe(0.5);
        const [e] = commandLog(game.galaxy) as PlayerLogEntry[];
        expect(e.error).toMatch(/unregistered class Unregistered/);
        const { seed, ...options } = tickGameOptions(gameData);
        expect(() => replayCommandLog(seed, options, commandLog(game.galaxy))).toThrow(/not journaled replayably/);
    }, 300000);
});

describe('seed + command log → the same game (60 s script)', () => {
    const SCRIPT = commandScript(0.1);
    const END = 60_000;
    let live: { digest: string; save: string };

    it('scripted run, replay from createGame, and save/load half-way all give the identical game', () => {
        const game = cachedTickGame(gameData);
        setRunId(game.galaxy, 'fast-live');
        runScripted(SCRIPT, game, END);
        expect(empireShipGroups(game.playerEmpire)).toContain(createdFleets.get(game.galaxy));
        const log = commandLog(game.galaxy);
        expect(log.filter((e) => e.source === 'player').every((e) => (e as PlayerLogEntry).error === undefined)).toBe(true);
        live = fullDigest(game);

        const { seed, ...options } = tickGameOptions(gameData);
        const replay = fullDigest(replayCommandLog(seed, options, log, END));
        expect(replay.digest).toBe(live.digest);
        expect(replay.save === live.save).toBe(true);

        const half = cachedTickGame(gameData);
        setRunId(half.galaxy, 'fast-half');
        runScripted(SCRIPT, half, END / 2);
        const time = new GalaxyTime();
        time.bindGalaxy(half.galaxy);
        const loaded = deserializeGame(serializeGame(half, time, {} as StartGameOptions), gameData).game;
        setRunId(loaded.galaxy, 'fast-half');
        runScripted(SCRIPT, loaded, END);
        const cont = fullDigest(loaded);
        expect(cont.digest).toBe(live.digest);
        expect(cont.save === live.save).toBe(true);
    }, 900000);

    it('the same order issued a frame later is a different game (the sim time is what matters)', () => {
        const a = cachedTickGame(gameData);
        const b = cachedTickGame(gameData);
        const order = (game: typeof a) => {
            const p = game.playerEmpire;
            const ships = p.builtObjects.filter((x) => x !== null && x.shipGroup === null && x.topSpeed > 0 && x.builtAt === null);
            issuePlayerCommand(game.galaxy, p, 'shipAction', [ships, createShipAction(ShipActionType.CreateNewFleet, null), false]);
        };
        runGameSeconds(a.galaxy, 1);
        order(a);
        runGameSeconds(a.galaxy, 4);
        runGameSeconds(b.galaxy, 2);
        order(b);
        runGameSeconds(b.galaxy, 3);
        expect(a.galaxy.nowMs).toBe(b.galaxy.nowMs);
        expect(stateDigest(a.galaxy)).not.toBe(stateDigest(b.galaxy));
    }, 300000);
});

describe('scenario decisions are player commands (mod layer)', () => {
    it('answering a decision from its popup is queued, applied at the next boundary and journaled', () => {
        const { game } = createScenarioGame(gameData, { scenario: 'example', flags: { exampleFlag: true } });
        const g = game.galaxy;
        const p = game.playerEmpire;
        const resolved: string[] = [];
        const off = registerScenarioDecision({ id: 'test.cmd', flag: 'exampleFlag', kind: 'test.cmd', resolve: (_g, d, o) => resolved.push(`${d.id}:${o}`) });
        try {
            const d = raiseScenarioDecision(g, p, { kind: 'test.cmd', title: 'Q', text: 'Yes?', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] });
            issuePlayerCommand(g, p, 'answerScenarioDecision', [d.id, 'yes']);
            expect(resolved).toEqual([]);
            expect(pendingPlayerCommands(g)).toBe(1);
            runSimFrame(g, 17);
            expect(resolved).toEqual([`${d.id}:yes`]);
            expect(pendingScenarioDecisions(g, p)).toHaveLength(0);
            const e = commandLog(g).at(-1) as PlayerLogEntry;
            expect(e).toMatchObject({ source: 'player', op: 'answerScenarioDecision', args: [d.id, 'yes'] });
            expect(e.error).toBeUndefined();
            // A stale / foreign answer is a journaled no-op.
            expect(runPlayerCommand(g, p, 'answerScenarioDecision', [d.id, 'no'])).toBe(false);
            expect(resolved).toHaveLength(1);
        } finally {
            off();
        }
    }, 300000);
});
