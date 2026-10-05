// Sim worker: the restart after the worker stopped (src/simworker/restart.ts, docs/sim-worker.md §4.6). A simulated
// crash with orders in flight: every waiting callback fails once (the failure value) and promises reject; the restart
// sources come best first — the worker's own last state (sent with its fatal error), the replica serialized on the main
// thread, this game's last autosave — and a source that cannot be had or loaded gives way to the next; the game
// restarts in a new worker host + replica, paused, and is playable (the clock runs, orders apply and reply).
import type { SaveText } from '../src/saveData';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/toast', () => ({ showToast: vi.fn() }));

import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { FRAME_REAL_MS } from '../src/sim/tick/scheduler';
import { stateDigest } from '../src/sim/tick/digest';
import { commandLog } from '../src/sim/player/commandLog';
import { issuePlayerCommand } from '../src/sim/player/playerCommands';
import { serializeGame } from '../src/sim/save/gameSave';
import type { StartGameOptions } from '../src/sim/startGameOptions';
import { SimHost } from '../src/simworker/simHost';
import { SimClientCore } from '../src/simworker/clientCore';
import type { ToWorker, WorkerEvent } from '../src/simworker/protocol';
import { remoteSimHost } from '../src/simworker/remoteHost';
import { bootWorkerGame } from '../src/simworker/workerBoot';
import { restartFromSources, restartPromptText, restartSources, type RestartSource } from '../src/simworker/restart';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);
afterEach(() => {
    vi.restoreAllMocks();
});

const START_OPTIONS = {} as StartGameOptions;

function fakeClock(): () => number {
    let t = 0;
    return () => (t += 0.001);
}

interface Session {
    host: SimHost;
    client: SimClientCore;
    ui: GalaxyTime;
    events: WorkerEvent[];
    /** One worker tick and one main-thread frame. */
    tick: () => void;
    /** Messages to the worker are delivered (false: held, a worker that stopped answering). */
    deliver: { on: boolean };
}

/** A worker host and its replica, in-process (messages structured-cloned as postMessage would). */
function session(game: Game, paused: boolean): Session {
    const time = new GalaxyTime();
    time.paused = paused;
    const host = new SimHost(game, time, START_OPTIONS, { now: fakeClock() });
    const deliver = { on: true };
    const toHost = (m0: ToWorker): void => {
        if (!deliver.on) return;
        const m = structuredClone(m0);
        if (m.type === 'command') host.command(m);
        else if (m.type === 'clock') host.clock(m);
        else if (m.type === 'refresh') host.refresh(m);
        else if (m.type === 'hostOp') host.hostOp(m);
    };
    const events: WorkerEvent[] = [];
    let wall = 0;
    const client = new SimClientCore(gameData, structuredClone(host.snapshot()), { post: toHost, now: () => wall, onEvent: (e) => events.push(e) });
    const ui = new GalaxyTime();
    ui.bindGalaxy(client.galaxy);
    ui.speed = time.speed;
    ui.paused = paused;
    const tick = (): void => {
        wall += FRAME_REAL_MS;
        client.syncClock(ui);
        const m = host.tick(FRAME_REAL_MS);
        if (m !== null) client.receive(structuredClone(m));
        client.frame(ui);
    };
    return { host, client, ui, events, tick, deliver };
}

/** The restart's boot: the save text into a new worker host (bootWorkerGame, as worker.ts) and its replica, paused. */
async function bootSession(text: SaveText): Promise<Session> {
    const booted = await bootWorkerGame(typeof text === 'string' ? { kind: 'load', text } : { kind: 'load', blob: text }, { baseData: async () => gameData, overlays: async () => new Map() });
    return session(booted.game, true);
}

const flushMicrotasks = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('sim worker: restart after the worker stopped', () => {
    it('a crash with orders in flight: each fails once; the restart from the worker\'s last state is exact, paused and playable', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const a = session(cachedTickGame(gameData), false);
        const p = a.client.game.playerEmpire;
        for (let i = 0; i < 20; i++) a.tick();
        // An autosave taken a while ago (the worker's own save, as autosave.ts stores it).
        const autosaveText = a.host.save();
        for (let i = 0; i < 20; i++) a.tick();
        // Orders in flight when the worker dies (it stops answering, then reports the fatal error).
        a.deliver.on = false;
        const calls: unknown[] = [];
        issuePlayerCommand(a.client.galaxy, p, 'renameColony', [p.colonies[0], 'Lost In The Crash'], (r) => calls.push(r));
        issuePlayerCommand(a.client.galaxy, p, 'setEmpireControl', ['controlColonyTaxRates', false], (r) => calls.push(r));
        const promised = remoteSimHost(a.client.galaxy)!.command(p, 'empireRename', ['Lost']).then(() => 'resolved', (e: Error) => e.message);
        for (let i = 0; i < 3; i++) a.tick();
        expect(a.client.pendingReplies).toBe(3);
        // worker.ts fatal: the worker saves its game for the restart (without the orders not applied yet — they are
        // failed on the main thread), then the main thread stops it. One of them reached the worker before it died.
        a.host.command({ type: 'command', id: 999, empire: a.host.sync.encoder.knownId(a.host.game.playerEmpire), op: 'empireRename', args: ['Arrived Too Late'] });
        const crashedDigest = a.host.digest();
        const rescue = a.host.rescueSave();
        expect(rescue).not.toBeNull();
        expect(a.host.game.playerEmpire.name).not.toBe('Arrived Too Late');
        a.client.workerFailed('step loop: simulated crash');
        expect(calls).toEqual([false, false]);
        expect(await promised).toMatch(/worker stopped/);
        expect(a.client.pendingReplies).toBe(0);
        expect(a.events.filter((e) => e.kind === 'workerStopped')).toHaveLength(1);
        // Later orders fail at once (never sent).
        issuePlayerCommand(a.client.galaxy, p, 'renameColony', [p.colonies[0], 'After'], (r) => calls.push(r));
        await flushMicrotasks();
        expect(calls).toEqual([false, false, false]);

        const savedAt = Date.now() - 12 * 60000;
        const sources = restartSources({
            rescue,
            replica: () => serializeGame(a.client.game, a.ui, START_OPTIONS),
            autosave: { name: 'autosave-1', savedAt, read: async () => autosaveText },
            now: () => savedAt + 12 * 60000,
        });
        expect(sources.map((s) => s.kind)).toEqual(['worker', 'replica', 'autosave']);
        const prompt = restartPromptText('step loop: simulated crash', sources);
        expect(prompt).toContain("Restart from the simulation's last state");
        expect(prompt).toContain('autosave-1, 12 minutes ago');
        expect(prompt).toContain('resumes paused');

        const r = await restartFromSources(sources, (text) => bootSession(text));
        expect(r.result).not.toBeNull();
        if (r.result === null) return;
        expect('source' in r && r.source.kind).toBe('worker');
        const b = r.result;
        // Exact: the worker's last state, paused.
        expect(b.host.digest()).toBe(crashedDigest);
        expect(b.host.time.paused).toBe(true);
        expect(b.ui.paused).toBe(true);
        expect(b.client.game.playerEmpire.colonies[0].name).not.toBe('Lost In The Crash');
        // Playable: the clock runs once resumed, orders apply and reply.
        const t0 = b.host.galaxy.nowMs;
        b.ui.paused = false;
        for (let i = 0; i < 10; i++) b.tick();
        expect(b.host.galaxy.nowMs).toBeGreaterThan(t0);
        expect(b.client.galaxy.nowMs).toBe(b.host.galaxy.nowMs);
        const rp = b.client.game.playerEmpire;
        const after: unknown[] = [];
        issuePlayerCommand(b.client.galaxy, rp, 'renameColony', [rp.colonies[0], 'Restarted'], (x) => after.push(x));
        for (let i = 0; i < 3; i++) b.tick();
        expect(after).toEqual([true]);
        expect(rp.colonies[0].name).toBe('Restarted');
        expect(commandLog(b.host.galaxy).some((e) => e.source === 'player' && e.op === 'renameColony')).toBe(true);
        expect(b.client.pendingReplies).toBe(0);
        a.client.dispose();
        a.host.dispose();
        b.client.dispose();
        b.host.dispose();
    }, 600000);

    it('without the worker\'s save: the replica (exact after a full compare); a source that cannot be had or loaded gives way to the next', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const a = session(cachedTickGame(gameData), false);
        for (let i = 0; i < 30; i++) a.tick();
        a.ui.paused = true;
        for (let i = 0; i < 3; i++) a.tick();
        // The replica as exact as a settled paused game makes it (every cold object compared).
        a.client.replica.apply(structuredClone(a.host.sync.delta(true)), true);
        const autosaveText = a.host.save();
        a.client.workerFailed('uncaught error in the worker: simulated');
        const replicaText = serializeGame(a.client.game, a.ui, START_OPTIONS);

        // The replica: loaded in a new worker, the authoritative state (the replica's save text has no command log).
        const viaReplica = await restartFromSources(restartSources({ rescue: null, replica: () => replicaText, autosave: null }), (text) => bootSession(text));
        expect(viaReplica.result).not.toBeNull();
        if (viaReplica.result === null) return;
        expect('source' in viaReplica && viaReplica.source.kind).toBe('replica');
        expect(stateDigest(viaReplica.result.host.galaxy)).toBe(a.host.digest());
        viaReplica.result.client.dispose();
        viaReplica.result.host.dispose();

        // The replica's save fails (throws), then a corrupt text does not load: the autosave is used.
        const chain: RestartSource[] = [
            { kind: 'replica', label: 'the game as last shown', text: () => {
                throw new Error('cannot serialize');
            } },
            { kind: 'worker', label: 'a corrupt save', text: () => '{"version":' },
            ...restartSources({ rescue: null, replica: null, autosave: { name: 'autosave-2', savedAt: Date.now(), read: async () => autosaveText } }),
        ];
        const viaAutosave = await restartFromSources(chain, (text) => bootSession(text));
        expect(viaAutosave.failed.map((f) => f.source.label)).toEqual(['the game as last shown', 'a corrupt save']);
        expect(viaAutosave.failed[0].error).toMatch(/could not be made/);
        expect(viaAutosave.failed[1].error).toMatch(/could not be loaded/);
        expect(viaAutosave.result).not.toBeNull();
        if (viaAutosave.result === null) return;
        expect('source' in viaAutosave && viaAutosave.source.kind).toBe('autosave');
        expect(viaAutosave.result.host.digest()).toBe(a.host.digest());
        viaAutosave.result.client.dispose();
        viaAutosave.result.host.dispose();

        // Nothing loads: no result, every failure listed (main.ts then returns to the main menu).
        const none = await restartFromSources([{ kind: 'autosave', label: 'gone', text: async () => null }], (text) => bootSession(text));
        expect(none.result).toBeNull();
        expect(none.failed).toHaveLength(1);
        expect(restartPromptText('x', [])).toContain('return to the main menu');
        a.client.dispose();
        a.host.dispose();
    }, 600000);
});
