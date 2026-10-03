// Sim worker chunk 6 (docs/sim-worker.md §9): the empire-management screens' orders through the worker host.
// - every command a screen issues (Colonies, Construction Yards, Build Order / Queue, Ships & Bases, Designs + Design
//   Editor, Fleets + Fleet Designs, Troops, Research, Empire Policy / Game Options, Expansion Planner, Empire
//   Summary), issued on the REPLICA with the screen's own argument shapes (by-value DesignDraft, EmpirePolicy,
//   ShipAction, troop loadouts, …), gives the in-thread state digest and command log, tick for tick, and its onApplied
//   reply resolves to the matching replica objects;
// - a reply runs only once the replica holds what the command changed (compareNow in the worker + the reply waiting
//   for its delta's cold part), and a refresh request brings an object's cold data at once;
// - the screens' read paths (their models and the sim queries they run) leave the replica exactly as the worker's
//   game: no write, no RNG draw.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { FRAME_REAL_MS } from '../src/sim/tick/scheduler';
import { stateDigest } from '../src/sim/tick/digest';
import { commandLog } from '../src/sim/player/commandLog';
import { issuePlayerCommand } from '../src/sim/player/playerCommands';
import { createSimLoop } from '../src/simLoop';
import { galaxyToJSON } from '../src/sim/save/galaxySave';
import type { Camera } from '../src/render/camera';
import type { StartGameOptions } from '../src/sim/startGameOptions';
import { SimHost } from '../src/simworker/simHost';
import { SimClientCore } from '../src/simworker/clientCore';
import type { ToWorker } from '../src/simworker/protocol';
import { isReplicaGalaxy, requestSimRefresh } from '../src/simworker/refresh';
import { readOnlyQuery } from '../src/sim/readOnlyQuery';
import { moneyPanelIncome } from '../src/sim/treasury';
import { screenOrders, screenReads, type ScreenOrder } from './helpers/screenOrders';

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

interface Wired {
    host: SimHost;
    client: SimClientCore;
    tick: () => void;
    time: GalaxyTime;
}

/** Host + client wired in-process (messages structured-cloned as postMessage would). */
function connect(game: Game, time: GalaxyTime): Wired {
    const host = new SimHost(game, time, START_OPTIONS, { now: fakeClock() });
    const snap = structuredClone(host.snapshot());
    const toHost = (m: ToWorker): void => {
        const c = structuredClone(m);
        if (c.type === 'command') host.command(c);
        else if (c.type === 'clock') host.clock(c);
        else if (c.type === 'refresh') host.refresh(c);
    };
    const client = new SimClientCore(gameData, snap, { post: toHost, now: fakeClock() });
    const uiTime = new GalaxyTime();
    uiTime.bindGalaxy(client.galaxy);
    uiTime.speed = time.speed;
    uiTime.paused = time.paused;
    const tick = (): void => {
        client.syncClock(uiTime);
        const m = host.tick(FRAME_REAL_MS);
        if (m !== null) client.receive(structuredClone(m));
        client.frame(uiTime);
    };
    return { host, client, tick, time: uiTime };
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
        for (const k of ['builtObjectID', 'habitatIndex', 'empireId', 'shipGroupId', 'projectId']) if (typeof o[k] === 'number') return `${name}#${k}=${String(o[k])}`;
        if (typeof o.name === 'string') return `${name}:${o.name}`;
        return `${name}{}`;
    }
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) out[k] = describeValue(o[k], depth + 1);
    return out;
}

/** Every sim object a reply names (to check the worker's reply resolves to replica objects). */
function objectsIn(v: unknown, out: object[] = [], depth = 0): object[] {
    if (v === null || typeof v !== 'object' || depth > 3) return out;
    const proto = Object.getPrototypeOf(v) as object | null;
    if (Array.isArray(v)) for (const x of v) objectsIn(x, out, depth + 1);
    else if (proto === Object.prototype || proto === null) for (const x of Object.values(v as Record<string, unknown>)) objectsIn(x, out, depth + 1);
    else out.push(v as object);
    return out;
}

interface RunResult {
    digest: string;
    log: string;
    replies: Map<string, unknown>;
    skipped: string[];
    foreignReplies: string[];
}

/** In-thread reference: the real app loop (simLoop.ts), one render frame of exactly FRAME_REAL_MS per tick. */
function runInThread(game: Game, orders: readonly ScreenOrder[], ticks: number): RunResult {
    const time = new GalaxyTime();
    time.paused = false;
    const loop = createSimLoop(game.galaxy, time, {} as Camera, false);
    (loop.budget as { now: () => number }).now = fakeClock();
    const replies = new Map<string, unknown>();
    const skipped: string[] = [];
    for (let t = 0; t < ticks; t++) {
        for (const o of orders) {
            if (o.tick !== t) continue;
            const issued = o.issue(game.galaxy, game.playerEmpire, (r) => replies.set(o.what, describeValue(r)));
            if (!issued) skipped.push(o.what);
        }
        loop.tick(FRAME_REAL_MS);
    }
    return { digest: stateDigest(game.galaxy), log: JSON.stringify(commandLog(game.galaxy)), replies, skipped, foreignReplies: [] };
}

/** The same orders issued on the replica, through the host; the host's game digest and log. */
function runWorker(game: Game, orders: readonly ScreenOrder[], ticks: number, extraTicks = 40): RunResult & { w: Wired } {
    const time = new GalaxyTime();
    time.paused = false;
    const w = connect(game, time);
    const rg = w.client.galaxy;
    const replies = new Map<string, unknown>();
    const skipped: string[] = [];
    const foreign: string[] = [];
    for (let t = 0; t < ticks; t++) {
        const due = orders.filter((o) => o.tick === t);
        if (due.length > 0) {
            // The screen reads an exactly-current replica here (a full compare), as the in-thread screen reads the game.
            w.client.replica.apply(structuredClone(w.host.sync.delta(true)), true);
            expect(rg.nowMs).toBe(game.galaxy.nowMs);
            for (const o of due) {
                const issued = o.issue(rg, w.client.game.playerEmpire, (r) => {
                    replies.set(o.what, describeValue(r));
                    for (const x of objectsIn(r)) if (w.client.replica.decoder.idOf(x) < 0) foreign.push(`${o.what}: ${String(describeValue(x))}`);
                });
                if (!issued) skipped.push(o.what);
            }
        }
        w.tick();
    }
    const digest = w.host.digest();
    const log = JSON.stringify(commandLog(game.galaxy));
    // Let the last replies arrive (they run once their delta is applied).
    w.time.paused = true;
    for (let t = 0; t < extraTicks; t++) w.tick();
    return { digest, log, replies, skipped, foreignReplies: foreign, w };
}

describe('sim worker chunk 6: empire-management screen orders through the host', () => {
    it('every screen order issued on the replica gives the in-thread digest, command log and replies', () => {
        const orders = screenOrders();
        const ticks = Math.max(...orders.map((o) => o.tick)) + 30;
        const ref = runInThread(cachedTickGame(gameData), orders, ticks);
        const wk = runWorker(cachedTickGame(gameData), orders, ticks);
        expect(wk.skipped).toEqual(ref.skipped);
        // Each order found its targets (the script exercises every op it lists).
        expect(ref.skipped).toEqual([]);
        expect(wk.log).toBe(ref.log);
        expect(wk.digest).toBe(ref.digest);
        const logged = new Set((JSON.parse(ref.log) as { op?: string }[]).map((e) => e.op));
        for (const o of orders) for (const op of o.ops) expect(logged.has(op), `op ${op} (${o.what}) journaled`).toBe(true);
        // Replies: the same values, naming the same objects, all of them replica objects.
        expect(ref.replies.size).toBe(orders.length);
        expect(Object.fromEntries(wk.replies)).toEqual(Object.fromEntries(ref.replies));
        expect(wk.foreignReplies).toEqual([]);
        // And the replica ends exactly as the worker's game.
        wk.w.client.replica.apply(structuredClone(wk.w.host.sync.delta(true)), true);
        expect(stateDigest(wk.w.client.galaxy)).toBe(wk.w.host.digest());
        wk.w.client.dispose();
        wk.w.host.dispose();
    }, 600000);
});

describe('sim worker chunk 6: replies and refreshes see current cold data', () => {
    it('a rename reply sees the new name (compareNow + the reply waiting for its cold part)', () => {
        const game = cachedTickGame(gameData);
        const time = new GalaxyTime();
        time.paused = false;
        // Huge cold cycle (tiny budget): without compareNow the habitat would not be compared for many ticks.
        const host = new SimHost(game, time, START_OPTIONS, { now: fakeClock(), sync: { coldBudgetMs: 0, coldMaxSets: 1 } });
        const snap = structuredClone(host.snapshot());
        const client = new SimClientCore(gameData, snap, {
            post: (m) => {
                const c = structuredClone(m);
                if (c.type === 'command') host.command(c);
                else if (c.type === 'refresh') host.refresh(c);
            },
            now: fakeClock(),
            coldBudgetMs: 0.002,
        });
        const ui = new GalaxyTime();
        ui.bindGalaxy(client.galaxy);
        ui.paused = false;
        const tick = (): void => {
            const m = host.tick(FRAME_REAL_MS);
            if (m !== null) client.receive(structuredClone(m));
            client.frame(ui);
        };
        expect(isReplicaGalaxy(client.galaxy)).toBe(true);
        expect(isReplicaGalaxy(game.galaxy)).toBe(false);
        const p = client.game.playerEmpire;
        const colony = p.colonies[0];
        let seen: string | null = null;
        tick();
        issuePlayerCommand(client.galaxy, p, 'renameColony', [colony, 'Worker Prime'], () => {
            seen = colony.name;
        });
        for (let i = 0; i < 40 && seen === null; i++) tick();
        expect(seen).toBe('Worker Prime');
        expect(game.playerEmpire.colonies[0].name).toBe('Worker Prime');

        // A refresh request: a field changed behind the replica's back (as a sim step would) arrives at once.
        const auth = game.playerEmpire.colonies[0];
        auth.taxRate = 0.31;
        let fresh = false;
        requestSimRefresh(client.galaxy, [colony], () => {
            fresh = true;
        });
        for (let i = 0; i < 40 && !fresh; i++) tick();
        expect(fresh).toBe(true);
        expect(colony.taxRate).toBe(auth.taxRate);
        // In-thread a refresh is a no-op (the callback never runs).
        let ran = false;
        requestSimRefresh(game.galaxy, [auth], () => {
            ran = true;
        });
        expect(ran).toBe(false);
        client.dispose();
        host.dispose();
    }, 600000);
});

describe('sim worker chunk 6: screen reads leave the replica untouched', () => {
    it('the screens\' models and sim queries do not write the replica or draw its RNG', () => {
        const game = cachedTickGame(gameData);
        const time = new GalaxyTime();
        time.paused = false;
        const w = connect(game, time);
        for (let i = 0; i < 120; i++) w.tick();
        w.client.replica.apply(structuredClone(w.host.sync.delta(true)), true);
        const rg = w.client.galaxy;
        const before = JSON.stringify(galaxyToJSON(rg));
        expect(before === JSON.stringify(galaxyToJSON(game.galaxy))).toBe(true);
        const ran = screenReads(rg, w.client.game.playerEmpire);
        expect(ran.length).toBeGreaterThan(10);
        const after = JSON.stringify(galaxyToJSON(rg));
        if (after !== before) {
            // Name the first differing region for the failure message.
            let i = 0;
            while (i < after.length && after[i] === before[i]) i++;
            expect(after.slice(Math.max(0, i - 200), i + 200)).toBe(before.slice(Math.max(0, i - 200), i + 200));
        }
        expect(after === before).toBe(true);
        expect(stateDigest(rg)).toBe(w.host.digest());
        w.client.dispose();
        w.host.dispose();
    }, 600000);

    it('in-thread, the same reads (in the scope the screens run them) leave the game untouched', () => {
        const game = cachedTickGame(gameData, { seconds: 30 });
        const g = game.galaxy;
        const before = JSON.stringify(galaxyToJSON(g));
        const digest = stateDigest(g);
        expect(screenReads(g, game.playerEmpire).length).toBeGreaterThan(10);
        expect(stateDigest(g)).toBe(digest);
        expect(JSON.stringify(galaxyToJSON(g)) === before).toBe(true);
    }, 600000);

    it('without the read-only scope those queries do write (the scope is what keeps the screens clean)', () => {
        const game = cachedTickGame(gameData, { seconds: 30 });
        const g = game.galaxy;
        const p = game.playerEmpire;
        // The money panel's CheckAgeVariableIncome switches the empire to averaged variable income on first use.
        expect(p.useAveragedVariableIncome).toBe(false);
        readOnlyQuery(() => moneyPanelIncome(g, p));
        expect(p.useAveragedVariableIncome).toBe(false);
        moneyPanelIncome(g, p);
        expect(p.useAveragedVariableIncome).toBe(true);
    }, 600000);
});
