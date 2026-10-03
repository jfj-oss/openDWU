// Sim worker: failed commands (docs/sim-worker.md §4.4 "Failed commands"). Every command issued on a replica with a
// callback gets exactly one reply, as in-thread:
// - an executor's refusal (false / null / -1 / { ok: false }) reaches the callback as the same value in both modes;
// - an executor that throws, or an unknown op: in both modes the frame stops (pause, "Simulation error"), the callback
//   never runs, the command log is the same, and the commands after it apply at the next boundary;
// - what only worker mode can hit — an argument the replica or the worker no longer knows, a result that cannot cross
//   exactly, a lost reply (the timeout), the worker stopping, the game closed or reloaded — gives the op's failure value
//   (commandFailure.ts), never synchronously and never twice; promised replies reject; nothing is left waiting.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/toast', () => ({ showToast: vi.fn() }));

import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { FRAME_REAL_MS } from '../src/sim/tick/scheduler';
import { stateDigest } from '../src/sim/tick/digest';
import { commandLog } from '../src/sim/player/commandLog';
import { issuePlayerCommand } from '../src/sim/player/playerCommands';
import { PLAYER_OPS, type PlayerOpName } from '../src/sim/player/playerOps';
import { newDesignDraft } from '../src/sim/player/designEditor';
import { ShipActionType, createShipAction } from '../src/sim/player/shipAction';
import { Habitat } from '../src/sim/types';
import { createSimLoop } from '../src/simLoop';
import type { Camera } from '../src/render/camera';
import type { StartGameOptions } from '../src/sim/startGameOptions';
import { SimHost } from '../src/simworker/simHost';
import { SimClientCore } from '../src/simworker/clientCore';
import type { ToWorker, WorkerEvent } from '../src/simworker/protocol';
import { remoteSimHost } from '../src/simworker/remoteHost';
import { requestSimRefresh } from '../src/simworker/refresh';
import { COMMAND_FAILURE, commandFailureMessage, commandFailureValue } from '../src/simworker/commandFailure';
import { bootWorkerGame } from '../src/simworker/workerBoot';
import { showToast } from '../src/ui/toast';
import { recruitOptions } from '../src/ui/screens/troops';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

const START_OPTIONS = {} as StartGameOptions;

/** A fake wall clock: each tick is exactly one step's worth of real time, so the budget runs one step per tick. */
function fakeClock(): () => number {
    let t = 0;
    return () => (t += 0.001);
}

/** A reply in comparable form: sim objects by a stable key, values by value (depth-limited). */
function describeValue(v: unknown, depth = 0): unknown {
    if (v === null || typeof v !== 'object') return v === undefined ? '<undefined>' : v;
    if (depth > 3) return '…';
    if (Array.isArray(v)) return v.map((x) => describeValue(x, depth + 1));
    const proto = Object.getPrototypeOf(v) as object | null;
    const o = v as Record<string, unknown>;
    if (proto !== Object.prototype && proto !== null) {
        const name = (proto as { constructor?: { name?: string } }).constructor?.name ?? '?';
        for (const k of ['builtObjectID', 'habitatIndex', 'empireId', 'shipGroupId', 'designId']) if (typeof o[k] === 'number') return `${name}#${k}=${String(o[k])}`;
        if (typeof o.name === 'string') return `${name}:${o.name}`;
        return `${name}{}`;
    }
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) out[k] = describeValue(o[k], depth + 1);
    return out;
}

interface Wired {
    host: SimHost;
    client: SimClientCore;
    tick: () => void;
    ui: GalaxyTime;
    events: WorkerEvent[];
    /** Fake main-thread wall clock (ms): the reply timeout reads it. */
    wall: { t: number };
}

/**
 * Host + client in-process (messages structured-cloned as postMessage would). `intercept` may change or drop (null) a
 * message on its way to the worker (a lost or corrupt message).
 */
function connect(game: Game, opts: { intercept?: (m: ToWorker) => ToWorker | null; replyTimeoutMs?: number; paused?: boolean } = {}): Wired {
    const time = new GalaxyTime();
    time.paused = opts.paused ?? false;
    const host = new SimHost(game, time, START_OPTIONS, { now: fakeClock() });
    const snap = structuredClone(host.snapshot());
    const toHost = (m0: ToWorker): void => {
        const m = opts.intercept === undefined ? m0 : opts.intercept(m0);
        if (m === null) return;
        const c = structuredClone(m);
        if (c.type === 'command') host.command(c);
        else if (c.type === 'clock') host.clock(c);
        else if (c.type === 'refresh') host.refresh(c);
        else if (c.type === 'hostOp') host.hostOp(c);
    };
    const wall = { t: 0 };
    const events: WorkerEvent[] = [];
    const client = new SimClientCore(gameData, snap, { post: toHost, now: () => wall.t, replyTimeoutMs: opts.replyTimeoutMs, onEvent: (e) => events.push(e) });
    const ui = new GalaxyTime();
    ui.bindGalaxy(client.galaxy);
    ui.speed = time.speed;
    ui.paused = time.paused;
    const tick = (): void => {
        wall.t += FRAME_REAL_MS;
        client.syncClock(ui);
        const m = host.tick(FRAME_REAL_MS);
        if (m !== null) client.receive(structuredClone(m));
        client.frame(ui);
    };
    return { host, client, tick, ui, events, wall };
}

/** Callback calls per label (each must be exactly one, or none where in-thread has none). */
class Calls {
    readonly seen = new Map<string, unknown[]>();
    cb(what: string): (r: unknown) => void {
        this.seen.set(what, this.seen.get(what) ?? []);
        return (r) => this.seen.get(what)!.push(describeValue(r));
    }
    get(what: string): unknown[] {
        return this.seen.get(what) ?? [];
    }
    all(): Record<string, unknown[]> {
        return Object.fromEntries(this.seen);
    }
}

/** Orders whose executor REFUSES (its own failure value), issued at tick `tick`. */
interface FailingOrder {
    tick: number;
    what: string;
    issue: (g: Galaxy, p: Empire, cb: (r: unknown) => void) => void;
}

const ownColony = (p: Empire): Habitat => p.colonies[0];
const otherColony = (g: Galaxy, p: Empire): Habitat => g.empires.find((e) => e !== p && e.colonies.length > 0)!.colonies[0];

const REFUSED: FailingOrder[] = [
    // Design Editor Save with red warnings (a blank design): { ok: false, mustDo, message, title }.
    { tick: 1, what: 'saveDesign: blank design (red warnings)', issue: (g, p, cb) => issuePlayerCommand(g, p, 'saveDesign', [newDesignDraft(g, p, { kind: 'blank' })], cb) },
    // Recruit troops (the Troops screen's option, by value) at a colony that is not ours (the executor accepts it, as the
    // C# method_347 does not check the owner: kept for the recruit reply's parity).
    {
        tick: 1,
        what: 'shipAction: recruit at a foreign colony',
        issue: (g, p, cb) => {
            const o = recruitOptions(g, p, ownColony(p))[0];
            issuePlayerCommand(g, p, 'shipAction', [otherColony(g, p), o.action, false], cb);
        },
    },
    { tick: 2, what: 'renameColony: empty name', issue: (g, p, cb) => issuePlayerCommand(g, p, 'renameColony', [ownColony(p), '  '], cb) },
    { tick: 2, what: 'renameColony: a foreign colony', issue: (g, p, cb) => issuePlayerCommand(g, p, 'renameColony', [otherColony(g, p), 'Not Mine'], cb) },
    { tick: 2, what: 'empireRename: empty', issue: (g, p, cb) => issuePlayerCommand(g, p, 'empireRename', [''], cb) },
    { tick: 3, what: 'empireChangeGovernment: invalid id (-1)', issue: (g, p, cb) => issuePlayerCommand(g, p, 'empireChangeGovernment', [99999], cb) },
    { tick: 3, what: 'disbandTroops: none (-1)', issue: (g, p, cb) => issuePlayerCommand(g, p, 'disbandTroops', [[]], cb) },
    { tick: 3, what: 'setEmpireControl: not a control field', issue: (g, p, cb) => issuePlayerCommand(g, p, 'setEmpireControl', ['stateMoney', 5], cb) },
    {
        tick: 4,
        what: 'yardPurchase: too expensive (null)',
        issue: (g, p, cb) => {
            const d = [...p.designs].sort((a, b) => b.calculateCurrentPurchasePrice(g) - a.calculateCurrentPurchasePrice(g))[0];
            // Too expensive for the treasury: drained first (a command too).
            issuePlayerCommand(g, p, 'setEmpireControl', ['controlColonyTaxRates', false]);
            issuePlayerCommand(g, p, 'yardPurchase', [d, ownColony(p)], cb);
        },
    },
    { tick: 4, what: 'buildNewShips: nothing to build', issue: (g, p, cb) => issuePlayerCommand(g, p, 'buildNewShips', [[], []], cb) },
    { tick: 5, what: 'fleetTemplateRename: no such template', issue: (g, p, cb) => issuePlayerCommand(g, p, 'fleetTemplateRename', [424242, 'x'], cb) },
    { tick: 5, what: 'constructionJobCancel: no such job', issue: (g, p, cb) => issuePlayerCommand(g, p, 'constructionJobCancel', [424242], cb) },
];

/** In-thread reference: the real app loop (simLoop.ts), one render frame of exactly FRAME_REAL_MS per tick. */
function runInThread(game: Game, orders: readonly FailingOrder[], ticks: number): { calls: Calls; digest: string; log: string; paused: boolean } {
    const time = new GalaxyTime();
    time.paused = false;
    const loop = createSimLoop(game.galaxy, time, {} as Camera, false);
    (loop.budget as { now: () => number }).now = fakeClock();
    const calls = new Calls();
    for (let t = 0; t < ticks; t++) {
        for (const o of orders) if (o.tick === t) o.issue(game.galaxy, game.playerEmpire, calls.cb(o.what));
        loop.tick(FRAME_REAL_MS);
    }
    return { calls, digest: stateDigest(game.galaxy), log: JSON.stringify(commandLog(game.galaxy)), paused: time.paused };
}

/** The same orders on the replica, through the host. */
function runWorker(game: Game, orders: readonly FailingOrder[], ticks: number): { calls: Calls; digest: string; log: string; paused: boolean; w: Wired } {
    const w = connect(game);
    const rg = w.client.galaxy;
    const calls = new Calls();
    for (let t = 0; t < ticks; t++) {
        const due = orders.filter((o) => o.tick === t);
        if (due.length > 0) {
            // The orders read an exactly-current replica (a full compare), as in-thread they read the game.
            w.client.replica.apply(structuredClone(w.host.sync.delta(true)), true);
            for (const o of due) o.issue(rg, w.client.game.playerEmpire, calls.cb(o.what));
        }
        w.tick();
    }
    const digest = w.host.digest();
    const log = JSON.stringify(commandLog(game.galaxy));
    const paused = w.host.time.paused;
    // The last replies arrive.
    w.ui.paused = true;
    for (let t = 0; t < 40; t++) w.tick();
    return { calls, digest, log, paused, w };
}

/** Swap a player op's executor for a test (restored by afterEach). */
const swapped: [PlayerOpName, unknown][] = [];
function swapOp(op: PlayerOpName, fn: (...a: unknown[]) => unknown): void {
    swapped.push([op, PLAYER_OPS[op]]);
    (PLAYER_OPS as unknown as Record<string, unknown>)[op] = fn;
}
afterEach(() => {
    for (const [op, fn] of swapped.splice(0).reverse()) (PLAYER_OPS as unknown as Record<string, unknown>)[op] = fn;
    vi.restoreAllMocks();
});

const flushMicrotasks = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('sim worker: refused commands reach the callback as in-thread', () => {
    it('each refusal calls back once with the same value in both modes; the log and digest match', () => {
        const ticks = 12;
        const ref = runInThread(cachedTickGame(gameData), REFUSED, ticks);
        const wk = runWorker(cachedTickGame(gameData), REFUSED, ticks);
        for (const o of REFUSED) expect(ref.calls.get(o.what), `${o.what} (in-thread)`).toHaveLength(1);
        expect(wk.calls.all()).toEqual(ref.calls.all());
        // They are refusals: no ok / truthy success among them.
        for (const o of REFUSED) {
            if (o.what.startsWith('shipAction: recruit')) continue;
            const v = ref.calls.get(o.what)[0];
            const okish = v === true || (typeof v === 'object' && v !== null && (v as { ok?: unknown }).ok === true);
            expect(okish, `${o.what} is refused: ${JSON.stringify(v)}`).toBe(false);
        }
        expect(wk.log).toBe(ref.log);
        expect(wk.digest).toBe(ref.digest);
        expect(wk.paused).toBe(ref.paused);
        expect(wk.w.client.pendingReplies).toBe(0);
        expect(wk.w.host.commandsInFlight).toBe(0);
        wk.w.client.dispose();
        wk.w.host.dispose();
    }, 600000);
});

describe('sim worker: an executor that throws, an unknown op', () => {
    const THROWING: FailingOrder[] = [
        { tick: 1, what: 'before', issue: (g, p, cb) => issuePlayerCommand(g, p, 'renameColony', [ownColony(p), 'Before Throw'], cb) },
        { tick: 1, what: 'throws', issue: (g, p, cb) => issuePlayerCommand(g, p, 'empireRename', ['Boom'], cb) },
        // Same boundary, after the throw: in-thread it stays queued and applies at the next boundary.
        { tick: 1, what: 'after', issue: (g, p, cb) => issuePlayerCommand(g, p, 'renameColony', [ownColony(p), 'After Throw'], cb) },
        { tick: 4, what: 'unknown op', issue: (g, p, cb) => issuePlayerCommand(g, p, 'noSuchOp' as PlayerOpName, [] as never, cb) },
        { tick: 4, what: 'after unknown', issue: (g, p, cb) => issuePlayerCommand(g, p, 'empireRename', ['Still Here'], cb) },
    ];
    const boom = (): never => {
        throw new Error('test: executor failed');
    };

    it('in both modes: the frame stops and pauses with a simulation error, the callback never runs, the rest apply next boundary', () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const toast = vi.mocked(showToast);
        toast.mockClear();
        const realRename = PLAYER_OPS.empireRename as (...a: unknown[]) => unknown;
        // Throw only for the 'Boom' name, so 'Still Here' applies.
        swapOp('empireRename', (g, e, name) => (name === 'Boom' ? boom() : realRename(g, e, name)));
        const ref = runInThreadResuming(cachedTickGame(gameData), THROWING, 10);
        expect(toast).toHaveBeenCalled();
        const wk = runWorkerResuming(cachedTickGame(gameData), THROWING, 10);
        for (const what of ['throws', 'unknown op']) {
            expect(ref.calls.get(what), `${what} (in-thread)`).toEqual([]);
            expect(wk.calls.get(what), `${what} (worker)`).toEqual([]);
        }
        for (const what of ['before', 'after', 'after unknown']) {
            expect(ref.calls.get(what), `${what} (in-thread)`).toHaveLength(1);
            expect(wk.calls.get(what), `${what} (worker)`).toEqual(ref.calls.get(what));
        }
        expect(ref.pauses).toBe(2);
        expect(wk.pauses).toBe(2);
        expect(wk.simErrors).toBe(2);
        expect(wk.log).toBe(ref.log);
        expect(wk.digest).toBe(ref.digest);
        // Nothing left waiting on either side.
        expect(wk.w.client.pendingReplies).toBe(0);
        expect(wk.w.host.commandsInFlight).toBe(0);
        expect(err.mock.calls.some((c) => String(c[0]).includes('failed in the game'))).toBe(true);
        wk.w.client.dispose();
        wk.w.host.dispose();
    }, 600000);

    it('a promised command (remoteHost) rejects when its executor throws', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        swapOp('renameColony', boom);
        const w = connect(cachedTickGame(gameData));
        const p = w.client.game.playerEmpire;
        const done = remoteSimHost(w.client.galaxy)!.command(p, 'renameColony', [ownColony(p), 'X']);
        const outcome = done.then(() => 'resolved', (e: Error) => e.message);
        for (let i = 0; i < 5; i++) w.tick();
        expect(await outcome).toMatch(/failed in the game: test: executor failed/);
        expect(w.client.pendingReplies).toBe(0);
        w.client.dispose();
        w.host.dispose();
    }, 600000);

    /** runInThread, resuming the clock after each pause (counted). */
    function runInThreadResuming(game: Game, orders: readonly FailingOrder[], ticks: number) {
        const time = new GalaxyTime();
        time.paused = false;
        const loop = createSimLoop(game.galaxy, time, {} as Camera, false);
        (loop.budget as { now: () => number }).now = fakeClock();
        const calls = new Calls();
        let pauses = 0;
        for (let t = 0; t < ticks; t++) {
            for (const o of orders) if (o.tick === t) o.issue(game.galaxy, game.playerEmpire, calls.cb(o.what));
            loop.tick(FRAME_REAL_MS);
            if (time.paused) {
                pauses++;
                time.paused = false;
            }
        }
        return { calls, pauses, digest: stateDigest(game.galaxy), log: JSON.stringify(commandLog(game.galaxy)) };
    }

    function runWorkerResuming(game: Game, orders: readonly FailingOrder[], ticks: number) {
        const w = connect(game);
        const calls = new Calls();
        let pauses = 0;
        for (let t = 0; t < ticks; t++) {
            for (const o of orders) if (o.tick === t) o.issue(w.client.galaxy, w.client.game.playerEmpire, calls.cb(o.what));
            w.tick();
            if (w.host.time.paused) {
                pauses++;
                // Resume as the player would; the worker's own clock is the one that paused.
                w.host.time.paused = false;
                w.ui.paused = false;
            }
        }
        const digest = w.host.digest();
        const log = JSON.stringify(commandLog(game.galaxy));
        w.host.time.paused = true;
        for (let t = 0; t < 20; t++) w.tick();
        return { calls, pauses, simErrors: w.events.filter((e) => e.kind === 'simError').length, digest, log, w };
    }
});

describe('sim worker: failures only worker mode can hit give the op\'s failure value, once', () => {
    it('an argument the replica no longer knows (a ship destroyed meanwhile): the failure value, never synchronously', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const w = connect(cachedTickGame(gameData));
        const p = w.client.game.playerEmpire;
        const gone = Object.create(Habitat.prototype) as Habitat;
        const calls = new Calls();
        issuePlayerCommand(w.client.galaxy, p, 'renameColony', [gone, 'Nowhere'], calls.cb('renameColony'));
        issuePlayerCommand(w.client.galaxy, p, 'shipAction', [gone, createShipAction(ShipActionType.ColonyTaxUp1, gone), false], calls.cb('recruit'));
        issuePlayerCommand(w.client.galaxy, p, 'saveDesign', [{ design: Object.create(Habitat.prototype), mode: 'addnew', target: null, replaces: null } as never], calls.cb('saveDesign'));
        // An unregistered class as an argument cannot be sent either.
        issuePlayerCommand(w.client.galaxy, p, 'empireRename', [new (class NotSendable {})() as unknown as string], calls.cb('unsendable'));
        // Not inside the issue call (in-thread the callback runs at the next boundary).
        expect(calls.get('renameColony')).toEqual([]);
        await flushMicrotasks();
        expect(calls.get('renameColony')).toEqual([false]);
        expect(calls.get('unsendable')).toEqual([false]);
        const recruit = calls.get('recruit')[0] as { ok: boolean; message: string; automationPrompts: unknown[] };
        expect(recruit.ok).toBe(false);
        expect(recruit.automationPrompts).toEqual([]);
        expect(recruit.message).toMatch(/could not be carried out/);
        const save = calls.get('saveDesign')[0] as { ok: boolean; design: unknown; mustDo: unknown[]; title: string; message: string };
        expect(save).toMatchObject({ ok: false, design: null, mustDo: [], shouldDo: [], title: 'Cannot Save Design' });
        expect(save.message).toMatch(/no longer in the game/);
        for (let i = 0; i < 5; i++) w.tick();
        // Exactly once each, nothing sent, nothing waiting.
        for (const k of ['renameColony', 'recruit', 'saveDesign', 'unsendable']) expect(calls.get(k)).toHaveLength(1);
        expect(w.client.pendingReplies).toBe(0);
        expect(commandLog(w.host.galaxy).filter((e) => e.source === 'player')).toEqual([]);
        expect(warn).toHaveBeenCalled();
        // A promised command rejects instead.
        await expect(remoteSimHost(w.client.galaxy)!.command(p, 'renameColony', [gone, 'X'])).rejects.toThrow(/no longer in the game/);
        w.client.dispose();
        w.host.dispose();
    }, 600000);

    it('an argument the worker cannot resolve (a corrupt / stale sync id): an error reply, the failure value once', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const w = connect(cachedTickGame(gameData), {
            intercept: (m) => (m.type === 'command' && m.op === 'renameColony' ? { ...m, args: [{ s: 987654321 }, m.args[1]] } : m),
        });
        const p = w.client.game.playerEmpire;
        const calls = new Calls();
        issuePlayerCommand(w.client.galaxy, p, 'renameColony', [ownColony(p), 'Stale'], calls.cb('rename'));
        issuePlayerCommand(w.client.galaxy, p, 'empireRename', ['Unaffected'], calls.cb('next'));
        for (let i = 0; i < 5; i++) w.tick();
        expect(calls.get('rename')).toEqual([false]);
        expect(calls.get('next')).toEqual([true]);
        expect(w.client.pendingReplies).toBe(0);
        expect(w.host.commandsInFlight).toBe(0);
        w.client.dispose();
        w.host.dispose();
    }, 600000);

    it('a result that cannot cross exactly is still delivered (made plain, logged loudly), once', () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        class NotRegistered {
            a = 1;
            fn = (): number => 2;
        }
        swapOp('renameColony', () => new NotRegistered());
        const w = connect(cachedTickGame(gameData));
        const p = w.client.game.playerEmpire;
        const seen: unknown[] = [];
        issuePlayerCommand(w.client.galaxy, p, 'renameColony', [ownColony(p), 'Plain'], (r) => seen.push(r));
        for (let i = 0; i < 5; i++) w.tick();
        expect(seen).toEqual([{ a: 1, fn: undefined }]);
        expect(err.mock.calls.some((c) => String(c[0]).includes('parts made plain') && String(c[0]).includes('NotRegistered'))).toBe(true);
        w.client.dispose();
        w.host.dispose();
    }, 600000);

    it('a lost reply: the timeout fails it loudly with the failure value; a late reply is dropped', () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        let held: ToWorker | null = null;
        const w = connect(cachedTickGame(gameData), {
            replyTimeoutMs: 2000,
            intercept: (m) => {
                if (m.type === 'command' && m.op === 'renameColony') {
                    held = m; // lost on the way
                    return null;
                }
                return m;
            },
        });
        const p = w.client.game.playerEmpire;
        const calls = new Calls();
        issuePlayerCommand(w.client.galaxy, p, 'renameColony', [ownColony(p), 'Lost'], calls.cb('lost'));
        for (let i = 0; i < 10; i++) w.tick();
        expect(calls.get('lost')).toEqual([]);
        expect(w.client.pendingReplies).toBe(1);
        w.wall.t += 2500;
        w.tick();
        expect(calls.get('lost')).toEqual([false]);
        expect(w.client.pendingReplies).toBe(0);
        expect(err.mock.calls.some((c) => /no reply from the simulation worker after \d+ s/.test(String(c[0])))).toBe(true);
        // The message turns up after all: applied in the worker, but its reply is not delivered a second time.
        w.host.command(structuredClone(held!) as never);
        for (let i = 0; i < 5; i++) w.tick();
        expect(calls.get('lost')).toEqual([false]);
        expect(warn.mock.calls.some((c) => String(c[0]).includes('after its timeout'))).toBe(true);
        w.client.dispose();
        w.host.dispose();
    }, 600000);
});

describe('sim worker: pending replies when the worker stops, the game is closed or reloaded', () => {
    it('the worker stops: every waiting command gets its failure value once, promises reject, later commands fail at once', async () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const w = connect(cachedTickGame(gameData), { intercept: (m) => (m.type === 'clock' ? m : null) });
        const p = w.client.game.playerEmpire;
        const calls = new Calls();
        issuePlayerCommand(w.client.galaxy, p, 'saveDesign', [newDesignDraft(w.client.galaxy, p, { kind: 'copy', design: p.designs[0] })], calls.cb('save'));
        issuePlayerCommand(w.client.galaxy, p, 'renameColony', [ownColony(p), 'Waiting'], calls.cb('rename'));
        const promised = remoteSimHost(w.client.galaxy)!.command(p, 'empireRename', ['Promised']).then(() => 'resolved', (e: Error) => e.message);
        const hostOp = remoteSimHost(w.client.galaxy)!.hostOp('chronicleYear', [{ year: 1 } as never]).then(() => 'resolved', (e: Error) => e.message);
        const answered: unknown[] = [];
        issuePlayerCommand(w.client.galaxy, p, 'moneyPanel', [], (r) => answered.push(r));
        let fresh = 0;
        requestSimRefresh(w.client.galaxy, [p], () => fresh++);
        for (let i = 0; i < 3; i++) w.tick();
        expect(w.client.pendingReplies).toBe(6);
        w.client.workerFailed('test: worker crashed');
        expect(w.client.workerStopped).toBe(true);
        expect(w.client.pendingReplies).toBe(0);
        expect(calls.get('rename')).toEqual([false]);
        expect(calls.get('save')[0]).toMatchObject({ ok: false, design: null, title: 'Cannot Save Design' });
        expect(String((calls.get('save')[0] as { message: string }).message)).toMatch(/worker stopped/);
        expect(await promised).toMatch(/worker stopped/);
        expect(await hostOp).toMatch(/worker stopped/);
        // The money panel's command gets its failure value (nothing to show); a refresh never answers on failure (as
        // an in-thread refresh).
        expect(answered).toEqual([null]);
        expect(fresh).toBe(0);
        expect(w.events.filter((e) => e.kind === 'workerStopped')).toHaveLength(1);
        expect(err.mock.calls.some((c) => String(c[0]).includes('STOPPED'))).toBe(true);
        // After: a command fails at once (in a microtask), never sent.
        issuePlayerCommand(w.client.galaxy, p, 'renameColony', [ownColony(p), 'Later'], calls.cb('later'));
        expect(calls.get('later')).toEqual([]);
        await flushMicrotasks();
        expect(calls.get('later')).toEqual([false]);
        for (let i = 0; i < 3; i++) w.tick();
        for (const k of ['save', 'rename', 'later']) expect(calls.get(k)).toHaveLength(1);
        expect(w.client.pendingReplies).toBe(0);
        w.client.dispose();
        w.host.dispose();
    }, 600000);

    it('the game is reloaded with orders in flight: the old ones fail once (also when the old worker answers late), the new game works', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        // Old game: its worker is slow — nothing it gets is answered before the reload.
        let lateTo: ToWorker[] = [];
        const old = connect(cachedTickGame(gameData), {
            intercept: (m) => {
                if (m.type === 'command') {
                    lateTo.push(m);
                    return null;
                }
                return m;
            },
        });
        const p = old.client.game.playerEmpire;
        const calls = new Calls();
        issuePlayerCommand(old.client.galaxy, p, 'renameColony', [ownColony(p), 'Old Game'], calls.cb('old rename'));
        issuePlayerCommand(old.client.galaxy, p, 'shipAction', [ownColony(p), createShipAction(ShipActionType.ColonyTaxUp1, ownColony(p)), false], calls.cb('old recruit'));
        const promised = remoteSimHost(old.client.galaxy)!.command(p, 'empireRename', ['Old']).then(() => 'resolved', (e: Error) => e.message);
        old.tick();
        const text = old.host.save();
        // The reload (main.ts teardownActiveGameView → SimWorkerClient.dispose): the old client is closed.
        old.client.dispose();
        // After the teardown that disposed it (a microtask), not inside dispose().
        expect(calls.get('old rename')).toEqual([]);
        await flushMicrotasks();
        expect(calls.get('old rename')).toEqual([false]);
        expect((calls.get('old recruit')[0] as { ok: boolean }).ok).toBe(false);
        expect(await promised).toMatch(/game was closed/);
        expect(old.client.pendingReplies).toBe(0);
        // The old worker answers after all: nothing is called a second time.
        for (const m of lateTo) old.host.command(structuredClone(m) as never);
        lateTo = [];
        old.tick();
        expect(calls.get('old rename')).toHaveLength(1);
        expect(calls.get('old recruit')).toHaveLength(1);
        old.host.dispose();
        // Issuing on the closed replica (a screen left open) fails too, once.
        issuePlayerCommand(old.client.galaxy, p, 'renameColony', [ownColony(p), 'Closed'], calls.cb('closed'));
        await flushMicrotasks();
        expect(calls.get('closed')).toEqual([false]);

        // The new game (the save, loaded in a new worker host) takes orders as usual.
        const booted = await bootWorkerGame({ kind: 'load', text }, { baseData: async () => gameData, overlays: async () => new Map() });
        const host2 = new SimHost(booted.game, booted.time, START_OPTIONS, { now: fakeClock() });
        const client2 = new SimClientCore(gameData, structuredClone(host2.snapshot()), {
            post: (m) => {
                const c = structuredClone(m);
                if (c.type === 'command') host2.command(c);
            },
            now: fakeClock(),
        });
        const p2 = client2.game.playerEmpire;
        issuePlayerCommand(client2.galaxy, p2, 'renameColony', [ownColony(p2), 'New Game'], calls.cb('new rename'));
        const ui = new GalaxyTime();
        ui.bindGalaxy(client2.galaxy);
        ui.paused = booted.time.paused;
        for (let i = 0; i < 5; i++) {
            const m = host2.tick(FRAME_REAL_MS);
            if (m !== null) client2.receive(structuredClone(m));
            client2.frame(ui);
        }
        expect(calls.get('new rename')).toEqual([true]);
        expect(ownColony(p2).name).toBe('New Game');
        expect(client2.pendingReplies).toBe(0);
        client2.dispose();
        host2.dispose();
    }, 600000);

    it('a menu / panel command the worker cannot resolve gets its failure value, in order, and leaves nothing waiting', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const w = connect(cachedTickGame(gameData), {
            // A dispatch naming an object the worker does not know: its error reply.
            intercept: (m) => (m.type === 'command' && m.op === 'habitatDispatch' ? { ...m, args: [{ s: 987654321 }] } : m),
        });
        const p = w.client.game.playerEmpire;
        const answers: string[] = [];
        issuePlayerCommand(w.client.galaxy, p, 'habitatDispatch', [ownColony(p)], (r) => answers.push(`dispatch ${JSON.stringify(r)}`));
        issuePlayerCommand(w.client.galaxy, p, 'moneyPanel', [], () => answers.push('money'));
        for (let i = 0; i < 3; i++) w.tick();
        expect(answers).toEqual(['dispatch []', 'money']);
        expect(w.client.pendingReplies).toBe(0);
        w.client.dispose();
        w.host.dispose();
    }, 600000);
});

describe('sim worker: the failure-value table', () => {
    it('covers every player op with a value of the op\'s refusal shape', () => {
        const ops = Object.keys(PLAYER_OPS).sort();
        expect(Object.keys(COMMAND_FAILURE).sort()).toEqual(ops);
        const msg = commandFailureMessage('a|b');
        expect(msg).not.toContain('|');
        for (const op of ops) {
            const v = commandFailureValue(op, msg, op === 'advisorCommands' ? [{}, [{ id: 'c1' }]] : op === 'diplomatCounter' ? [{}, {}, 'k1'] : []);
            if (['investigateRuins', 'investigateEncounteredBuiltObject', 'warnTargetOfPirateAttackFunding', 'exposeUncoveredPlanetDestroyer'].includes(op)) expect(v).toBeUndefined();
            else expect(v, op).not.toBeUndefined();
            // Never a success.
            expect(v === true || (typeof v === 'object' && v !== null && ((v as { ok?: unknown }).ok === true || (v as { accepted?: unknown }).accepted === true)), op).toBe(false);
        }
        expect(commandFailureValue('advisorCommands', msg, [{}, [{ id: 'c1' }, { command: { id: 'c2' } }]])).toEqual([
            { id: 'c1', ok: false, status: 'failed', text: 'c1', message: msg },
            { id: 'c2', ok: false, status: 'failed', text: 'c2', message: msg },
        ]);
        expect(commandFailureValue('noSuchOp', msg, [])).toBeUndefined();
    });
});

describe('sim worker: failed commands keep the in-thread callback order', () => {
    it('a command that fails at once is answered after the commands issued before it, and a ship gone from a list is left out', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const w = connect(cachedTickGame(gameData));
        const p = w.client.game.playerEmpire;
        const order: string[] = [];
        const gone = Object.create(Habitat.prototype) as Habitat;
        issuePlayerCommand(w.client.galaxy, p, 'renameColony', [ownColony(p), 'First'], () => order.push('first'));
        issuePlayerCommand(w.client.galaxy, p, 'renameColony', [gone, 'Gone'], () => order.push('gone'));
        issuePlayerCommand(w.client.galaxy, p, 'empireRename', ['Third'], () => order.push('third'));
        await flushMicrotasks();
        // The failed one waits for 'first' (in flight to the worker).
        expect(order).toEqual([]);
        for (let i = 0; i < 5; i++) w.tick();
        expect(order).toEqual(['first', 'gone', 'third']);
        // A dropped ship in a ships list: the order goes for the others (in-thread the executor skips a dead ship).
        const ships = p.builtObjects.filter((b) => b != null && !b.hasBeenDestroyed).slice(0, 2);
        const deadShip = Object.create(Object.getPrototypeOf(ships[0]) as object) as typeof ships[0];
        let refuelled: unknown = null;
        issuePlayerCommand(w.client.galaxy, p, 'refuelShips', [[ships[0], deadShip, ships[1]]], (n) => (refuelled = n));
        for (let i = 0; i < 5; i++) w.tick();
        expect(typeof refuelled).toBe('number');
        expect(warn.mock.calls.some((c) => String(c[0]).includes('left out of the list'))).toBe(true);
        const logged = commandLog(w.host.galaxy).filter((e) => e.source === 'player' && e.op === 'refuelShips');
        expect(logged).toHaveLength(1);
        expect((logged[0] as { args: { a: unknown[] }[] }).args[0].a).toHaveLength(2);
        w.client.dispose();
        w.host.dispose();
    }, 600000);
});
