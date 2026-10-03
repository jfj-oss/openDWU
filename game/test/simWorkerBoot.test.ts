// Sim worker chunk 1 (docs/sim-worker.md §9): clock, boot and persistence edges, with the host and the replica client
// driven in-process as test/simWorker.test.ts does, but with the messages queued so the round trip can be delayed:
// - the optimistic pause: the replica (nowMs, render time) stands still from the frame the player paused until the
//   worker acknowledges, then takes the steps that were in flight; resuming before the ack releases it; a stalled
//   worker times it out;
// - clock writes post at once (bindClock), the worker's own pause (game end) is adopted without being echoed back;
// - a save loads in the worker without the main thread parsing it (bootWorkerGame reads the scenario from the save; the
//   snapshot names it), with a scenario, and with the errors main.ts showed before;
// - create / generate boots build the games main.ts builds in-thread (the generated galaxy runs to the in-thread digest);
// - the `__dwu.sim` / `simBudget` / `commands.log` debug requests.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import { createScenarioGame, inlineOverlay, scenarioGameData } from './helpers/scenarioGame';
import { tickGameOptions } from './helpers/tickGame';
import type { GameData } from '../src/sim/data/gameData';
import { createGame, type Game } from '../src/sim/game';
import { generateGalaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { FRAME_REAL_MS } from '../src/sim/tick/scheduler';
import { stateDigest } from '../src/sim/tick/digest';
import { commandLog } from '../src/sim/player/commandLog';
import { issuePlayerCommand } from '../src/sim/player/playerCommands';
import { serializeGame } from '../src/sim/save/gameSave';
import { createSimLoop } from '../src/simLoop';
import type { Camera } from '../src/render/camera';
import { GalaxyShape } from '../src/sim/types';
import type { StartGameOptions } from '../src/sim/startGameOptions';
import type { ScenarioOverlay } from '../src/sim/scenario/overlay';
import { SimHost } from '../src/simworker/simHost';
import { SimClientCore } from '../src/simworker/clientCore';
import { bootWorkerGame, type WorkerBootDeps } from '../src/simworker/workerBoot';
import { workerCreateOptions } from '../src/simworker/bootOptions';
import type { StepMessage, ToWorker } from '../src/simworker/protocol';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

const START_OPTIONS = { seed: 7 } as StartGameOptions;

/** A fake wall clock: each read is 1 µs later (the budget then runs exactly one step per FRAME_REAL_MS tick). */
function fakeClock(): () => number {
    let t = 0;
    return () => (t += 0.001);
}

/**
 * Host and client with queued messages (postMessage order, delivered when the test says): `toHost` (clock, commands)
 * and `toClient` (step messages) model the round trip. The client's wall clock is `wall.ms` (the pause hold timeout).
 */
function link(game: Game, time: GalaxyTime, start = START_OPTIONS) {
    const host = new SimHost(game, time, start, { now: fakeClock() });
    const toHost: ToWorker[] = [];
    const toClient: StepMessage[] = [];
    const wall = { ms: 0 };
    const client = new SimClientCore(gameData, structuredClone(host.snapshot()), { post: (m) => toHost.push(structuredClone(m)), now: () => wall.ms });
    const ui = new GalaxyTime();
    ui.bindGalaxy(client.galaxy);
    ui.speed = client.clock.speed;
    ui.paused = client.clock.paused;
    client.bindClock(ui);
    const deliverToHost = (): void => {
        for (const m of toHost.splice(0)) {
            if (m.type === 'clock') host.clock(m);
            else if (m.type === 'command') host.command(m);
        }
    };
    const hostTick = (): void => {
        const m = host.tick(FRAME_REAL_MS);
        if (m !== null) toClient.push(structuredClone(m));
    };
    const deliverToClient = (): void => {
        for (const m of toClient.splice(0)) client.receive(m);
    };
    const frame = (): void => {
        wall.ms += FRAME_REAL_MS;
        client.frame(ui);
    };
    /** One round trip with no latency: the clock reaches the host, it ticks, its message is applied this frame. */
    const cycle = (): void => {
        deliverToHost();
        hostTick();
        deliverToClient();
        frame();
    };
    return { host, client, ui, toHost, toClient, wall, deliverToHost, hostTick, deliverToClient, frame, cycle };
}

describe('sim worker chunk 1: the clock', () => {
    it('an optimistic pause holds the replica from the press until the ack, then lands the in-flight steps', () => {
        const game = cachedTickGame(gameData);
        const time = new GalaxyTime();
        time.paused = false;
        const w = link(game, time);
        for (let i = 0; i < 40; i++) w.cycle();
        expect(w.client.galaxy.nowMs).toBe(game.galaxy.nowMs);
        expect(w.client.renderTime.alpha).toBeGreaterThanOrEqual(0);
        // Two steps the worker ran before the pause reached it, still in flight when the player pauses.
        w.hostTick();
        w.hostTick();
        const before = w.client.galaxy.nowMs;
        const serialBefore = w.client.renderTime.stepSerial;
        w.ui.togglePause();
        // Posted at once (bindClock), not at the next frame.
        expect(w.toHost.map((m) => m.type)).toEqual(['clock']);
        expect(w.client.pauseHeld).toBe(true);
        // The in-flight steps arrive; the replica and the render time stand still, drawn as paused.
        w.deliverToClient();
        for (let i = 0; i < 3; i++) {
            w.frame();
            expect(w.client.galaxy.nowMs).toBe(before);
            expect(w.client.renderTime.stepSerial).toBe(serialBefore);
            expect(w.client.renderTime.alpha).toBe(0);
            expect(w.client.renderTime.renderNowMs).toBe(before);
            expect(w.ui.currentStarDate).toBe(w.ui.startStarDate + before);
        }
        // The worker takes the pause and acknowledges it at once (a tick with no step).
        w.deliverToHost();
        w.hostTick();
        w.deliverToClient();
        w.frame();
        expect(w.client.pauseHeld).toBe(false);
        expect(w.client.stats.pauseHolds).toBe(1);
        expect(w.client.stats.lastPauseInFlightSteps).toBe(2);
        expect(w.client.galaxy.nowMs).toBe(game.galaxy.nowMs);
        expect(game.galaxy.nowMs).toBeGreaterThan(before);
        expect(w.client.renderTime.stepSerial).toBe(w.host.serial);
        expect(w.ui.paused).toBe(true);
        expect(w.host.time.paused).toBe(true);
        // Paused for good: nothing moves, and nothing is echoed back to the worker.
        const settled = game.galaxy.nowMs;
        for (let i = 0; i < 20; i++) w.cycle();
        expect(game.galaxy.nowMs).toBe(settled);
        expect(w.client.galaxy.nowMs).toBe(settled);
        expect(w.toHost.length).toBe(0);
        // Resume: the worker runs again and the replica follows.
        w.ui.paused = false;
        for (let i = 0; i < 10; i++) w.cycle();
        expect(game.galaxy.nowMs).toBeGreaterThan(settled);
        expect(w.client.galaxy.nowMs).toBe(game.galaxy.nowMs);
        w.client.dispose();
        w.host.dispose();
    }, 600000);

    it('resuming before the ack releases the hold; a stalled worker times it out', () => {
        const game = cachedTickGame(gameData);
        const time = new GalaxyTime();
        time.paused = false;
        const w = link(game, time);
        for (let i = 0; i < 10; i++) w.cycle();
        w.hostTick();
        w.ui.paused = true;
        w.ui.paused = false;
        expect(w.client.pauseHeld).toBe(false);
        w.deliverToClient();
        w.frame();
        expect(w.client.galaxy.nowMs).toBe(game.galaxy.nowMs);
        // The worker saw pause then resume: it keeps running.
        for (let i = 0; i < 5; i++) w.cycle();
        expect(w.host.time.paused).toBe(false);
        expect(w.client.galaxy.nowMs).toBe(game.galaxy.nowMs);

        // A pause the worker never acknowledges: held, then released after pauseHoldMaxMs (500 ms of wall time).
        w.hostTick();
        w.ui.paused = true;
        w.deliverToClient();
        const held = w.client.galaxy.nowMs;
        w.frame();
        expect(w.client.galaxy.nowMs).toBe(held);
        w.wall.ms += 600;
        w.frame();
        expect(w.client.pauseHeld).toBe(false);
        expect(w.client.galaxy.nowMs).toBe(game.galaxy.nowMs);
        w.client.dispose();
        w.host.dispose();
    }, 600000);

    it("the worker's own pause (game end, sim error) is adopted, not echoed; dispose unbinds the clock", () => {
        const game = cachedTickGame(gameData);
        const time = new GalaxyTime();
        time.paused = false;
        const w = link(game, time);
        for (let i = 0; i < 5; i++) w.cycle();
        w.ui.faster();
        expect(w.toHost.length).toBe(1);
        w.cycle();
        expect(w.host.time.speed).toBe(2);
        // Paused inside the worker (empireComparison / simHost game-end handler: time.paused = true in a tick).
        w.host.time.paused = true;
        w.cycle();
        expect(w.ui.paused).toBe(true);
        expect(w.ui.speed).toBe(2);
        expect(w.client.pauseHeld).toBe(false);
        expect(w.toHost.length).toBe(0);
        w.client.dispose();
        const d = Object.getOwnPropertyDescriptor(w.ui, 'paused');
        expect(d?.writable).toBe(true);
        expect(w.ui.paused).toBe(true);
        w.ui.paused = false;
        expect(w.toHost.length).toBe(0);
        w.host.dispose();
    }, 600000);
});

/** Boot deps over the fs-loaded data (worker.ts uses fetch-based ones). */
function deps(overlays: ReadonlyMap<string, ScenarioOverlay> = new Map()): WorkerBootDeps & { steps: string[] } {
    const steps: string[] = [];
    return {
        steps,
        baseData: async () => gameData,
        overlays: async () => overlays,
        progress: (step) => steps.push(step),
        now: fakeClock(),
    };
}

describe('sim worker chunk 1: boot and load', () => {
    it('a save loads in the worker without a main-thread parse: same game, start options from the save', async () => {
        const game = cachedTickGame(gameData);
        const time = new GalaxyTime();
        time.paused = false;
        time.speed = 2;
        const a = link(game, time);
        for (let i = 0; i < 120; i++) a.cycle();
        const text = a.host.save();
        const d = deps();
        const booted = await bootWorkerGame({ kind: 'load', text }, d);
        expect(booted.scenario).toBeNull();
        expect(booted.startOptions).toEqual(START_OPTIONS);
        expect(booted.time.speed).toBe(2);
        expect(booted.time.paused).toBe(false);
        expect(d.steps.some((s) => s.startsWith('Reading save'))).toBe(true);
        // The worker's host from it: its snapshot builds the replica the main thread would (gameData chosen from the
        // snapshot's scenario, as main.ts gameDataForScenario does), and it continues with the original.
        const host = new SimHost(booted.game, booted.time, booted.startOptions!, { now: fakeClock() });
        const snap = structuredClone({ ...host.snapshot(), scenario: booted.scenario });
        expect(snap.startOptions).toEqual(START_OPTIONS);
        expect(snap.scenario).toBeNull();
        const client = new SimClientCore(gameData, snap, { post: () => undefined, now: fakeClock() });
        expect(stateDigest(client.galaxy)).toBe(host.digest());
        expect(host.save()).toBe(text);
        for (let i = 0; i < 60; i++) {
            a.cycle();
            const m = host.tick(FRAME_REAL_MS);
            if (m !== null) client.receive(structuredClone(m));
            client.frame({ speed: 2, paused: false });
        }
        expect(host.digest()).toBe(a.host.digest());
        client.replica.apply(structuredClone(host.sync.delta(true)), true);
        expect(stateDigest(client.galaxy)).toBe(host.digest());
        for (const c of [a.client, client]) c.dispose();
        a.host.dispose();
        host.dispose();
    }, 600000);

    it('a scenario save: the worker reads its scenario, applies the overlay, and names it in the snapshot', async () => {
        const overlay = inlineOverlay({ id: 'sw-chunk1', name: 'Sim worker test' });
        const { game } = createScenarioGame(gameData, { scenario: overlay, options: (o) => ({ ...o, starCount: 80, sectorWidth: 4, sectorHeight: 4, systemNames: o.systemNames.slice(0, 80) }) });
        const text = serializeGame(game, new GalaxyTime().bindGalaxy(game.galaxy), START_OPTIONS);
        const booted = await bootWorkerGame({ kind: 'load', text }, deps(new Map([['sw-chunk1', overlay]])));
        expect(booted.scenario).toEqual({ id: 'sw-chunk1', include: null });
        expect(booted.gameData.scenario?.manifest.id).toBe('sw-chunk1');
        expect(stateDigest(booted.game.galaxy)).toBe(stateDigest(game.galaxy));
        // The replica on the main thread: the same overlay over the base data.
        const host = new SimHost(booted.game, booted.time, booted.startOptions!, { now: fakeClock() });
        const client = new SimClientCore(scenarioGameData(gameData, overlay), structuredClone(host.snapshot()), { post: () => undefined, now: fakeClock() });
        expect(stateDigest(client.galaxy)).toBe(host.digest());
        client.dispose();
        host.dispose();
        // Without the overlay: main.ts's error, now raised by the worker.
        await expect(bootWorkerGame({ kind: 'load', text }, deps())).rejects.toThrow('Scenario "sw-chunk1" is not available; cannot load this game.');
    }, 600000);

    it('bad save text, and a load by URL (the worker fetches the save)', async () => {
        await expect(bootWorkerGame({ kind: 'load', text: '{"version": 1, ' }, deps())).rejects.toThrow(/^Not a save file/);
        await expect(bootWorkerGame({ kind: 'load' }, deps())).rejects.toThrow(/without a save/);
        const game = cachedTickGame(gameData);
        const text = serializeGame(game, new GalaxyTime().bindGalaxy(game.galaxy), START_OPTIONS);
        const urls: string[] = [];
        const booted = await bootWorkerGame({ kind: 'load', url: 'http://x/dev-saves/a.dwusave' }, { ...deps(), fetchSave: async (u) => (urls.push(u), text) });
        expect(urls).toEqual(['http://x/dev-saves/a.dwusave']);
        expect(stateDigest(booted.game.galaxy)).toBe(stateDigest(game.galaxy));
    }, 600000);

    it('a create boot builds the game createGame builds here, with the wizard flag applied after', async () => {
        const opts = { ...tickGameOptions(gameData), starCount: 80, sectorWidth: 4, sectorHeight: 4 };
        const here = createGame(opts);
        here.playerEmpire.flagShape = 5;
        const booted = await bootWorkerGame({ kind: 'create', options: structuredClone(workerCreateOptions(opts)), scenario: null, flagShapeIndex: 5 }, deps());
        expect(booted.game.playerEmpire.flagShape).toBe(5);
        expect(booted.time.paused).toBe(true);
        const t = (g: Game): string => serializeGame(g, new GalaxyTime().bindGalaxy(g.galaxy), START_OPTIONS);
        expect(t(booted.game) === t(here)).toBe(true);
    }, 600000);

    it('a generate boot (bootGameWithOptions without ?autostart) runs to the in-thread digest; its replica matches', async () => {
        const gen = { seed: 3, shape: GalaxyShape.Spiral, starCount: 120, sectorWidth: 4, sectorHeight: 4, systemNames: Array.from({ length: 120 }, (_, i) => `G${i}`) };
        // In-thread: main.ts bootGameWithOptions (generateGalaxy + createSimLoop), running.
        const ref = generateGalaxy({ ...gen, gameData });
        const refTime = new GalaxyTime();
        refTime.paused = false;
        const loop = createSimLoop(ref, refTime, {} as Camera, false);
        (loop.budget as { now: () => number }).now = fakeClock();
        for (let i = 0; i < 90; i++) loop.tick(FRAME_REAL_MS);

        const booted = await bootWorkerGame({ kind: 'generate', options: structuredClone(gen), viewX: 0, viewY: 0 }, deps());
        expect(booted.game.playerEmpire as Empire | null).toBeNull();
        const time = booted.time;
        expect(time.paused).toBe(true);
        const w = link(booted.game, time);
        w.ui.paused = false;
        for (let i = 0; i < 90; i++) w.cycle();
        expect(booted.game.galaxy.nowMs).toBe(ref.nowMs);
        expect(w.host.digest()).toBe(stateDigest(ref));
        w.client.replica.apply(structuredClone(w.host.sync.delta(true)), true);
        expect(stateDigest(w.client.galaxy)).toBe(stateDigest(ref));
        w.client.dispose();
        w.host.dispose();
    }, 600000);
});

describe('sim worker chunk 1: the __dwu debug requests', () => {
    it('sim / simBudget get, set and call; advance steps reach the replica; the command log is the worker one', () => {
        const game = cachedTickGame(gameData);
        const time = new GalaxyTime();
        time.paused = false;
        const w = link(game, time);
        for (let i = 0; i < 5; i++) w.cycle();
        const got = w.host.debug({ type: 'debug', id: 1, target: 'sim', op: 'get', name: 'maxFrames' });
        expect(got.value).toBe(4);
        expect(got.state.speed).toBe(1);
        expect(got.state.paused).toBe(false);
        expect('galaxy' in got.state).toBe(false);
        const set = w.host.debug({ type: 'debug', id: 2, target: 'sim', op: 'set', name: 'maxFrames', value: 90 });
        expect(set.state.maxFrames).toBe(90);
        expect(w.host.driver.maxFrames).toBe(90);
        const budget = w.host.debug({ type: 'debug', id: 3, target: 'simBudget', op: 'get' });
        expect(typeof budget.state.backlogMs).toBe('number');
        expect(typeof budget.state.budgetMsAt1x).toBe('number');
        // `__dwu.sim.advance(1000)`: the worker runs the steps; they count in the next step message.
        const before = game.galaxy.nowMs;
        const adv = w.host.debug({ type: 'debug', id: 4, target: 'sim', op: 'call', name: 'advance', args: [1000] });
        expect(adv.error).toBeUndefined();
        expect(adv.value as number).toBeGreaterThan(0);
        expect(game.galaxy.nowMs).toBeGreaterThan(before);
        w.cycle();
        expect(w.client.galaxy.nowMs).toBe(game.galaxy.nowMs);
        expect(w.client.renderTime.stepSerial).toBe(w.host.serial);
        const bad = w.host.debug({ type: 'debug', id: 5, target: 'sim', op: 'call', name: 'nope' });
        expect(bad.error).toMatch(/not a function/);
        // The command log request: the authoritative journal (the replica has none), as plain data.
        issuePlayerCommand(w.client.galaxy, w.client.game.playerEmpire, 'automationOff', ['Colony Tax Rates']);
        for (let i = 0; i < 3; i++) w.cycle();
        const log = w.host.commandLog();
        expect(JSON.stringify(log)).toBe(JSON.stringify(commandLog(game.galaxy)));
        expect(structuredClone(log)).toEqual(log);
        expect(commandLog(w.client.galaxy).length).toBe(0);
        w.client.dispose();
        w.host.dispose();
    }, 600000);
});
