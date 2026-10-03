// Sim worker: the dev-only replica write detector (src/simworker/writeDetector.ts, docs/sim-worker.md §9 chunk 0).
// - the sync's own writes are never reported: a randomized graph (replicaSync.test.ts's kinds of mutation) synced with
//   lagging cold parts gives no finding, with compare-only and with every field trapped, and the replica still equals
//   the source;
// - main-thread writes are found: a field by the compare when the sync touches the object, by the sweep / checkAll
//   when it does not; array, Map, Set and typed-array writes; added and deleted keys; then the armed trap reports the
//   next write's stack; the allow-list keeps intended writes quiet; dispose restores the patched built-ins;
// - on a real game through SimHost + SimClientCore: a run reports nothing, a replica RNG draw and a messageHistory push
//   are found (with a stack on the next write), and with every field trapped the replica's save text and digest still
//   match the authoritative game's.
import { beforeAll, describe, expect, it } from 'vitest';
import { ReplicaDecoder, ReplicaEncoder, type ReplicaDelta } from '../src/simworker/replicaSync';
import { ReplicaWriteDetector, installReplicaWriteDetector, stackFrames, writeDetectorMode, type ReplicaWrite, type WatchedReplica } from '../src/simworker/writeDetector';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { FRAME_REAL_MS } from '../src/sim/tick/scheduler';
import { stateDigest } from '../src/sim/tick/digest';
import { galaxyToJSON } from '../src/sim/save/galaxySave';
import type { StartGameOptions } from '../src/sim/startGameOptions';
import { SimHost } from '../src/simworker/simHost';
import { SimClientCore } from '../src/simworker/clientCore';
import type { ToWorker } from '../src/simworker/protocol';

class Ship {
    x = 0;
    y = 0;
    lastTouch = 0;
    name = '';
    target: object | null = null;
    weapons: Gun[] = [];
    cargo: Map<string, number> = new Map();
    tags: Set<unknown> = new Set();
    grid = new Float64Array(4);
    note: Record<string, unknown> = {};
}
class Gun {
    heat = 0;
}
class Root {
    ships: Ship[] = [];
    misc: unknown[] = [];
    clock = 0;
}
const CLASSES = { Ship: Ship.prototype, Gun: Gun.prototype, Root: Root.prototype };

function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

/** Source graph + encoder, replica decoder, and the replica handle the detector wraps. */
function toy(): { root: Root; enc: ReplicaEncoder; dec: ReplicaDecoder; replica: WatchedReplica; rr: () => Root; sync: (full?: boolean) => void } {
    const root = new Root();
    for (let i = 0; i < 6; i++) {
        const s = new Ship();
        s.name = `s${i}`;
        s.weapons.push(new Gun(), new Gun());
        root.ships.push(s);
    }
    const enc = new ReplicaEncoder(
        {
            classes: CLASSES,
            skipFields: new Map(),
            externals: new Map(),
            hotClasses: [Ship.prototype, Root.prototype],
            childHotClasses: [Gun.prototype],
            hotContainers: new Set(['Root.ships']),
            alwaysHotFields: new Set(['Ship.x', 'Ship.y']),
            fixedHotClasses: ['Ship'],
            gates: { Ship: { gate: 'lastTouch', children: ['weapons'] } },
            coldMaxSets: 15,
            minColdSlices: 20,
        },
        [root],
    );
    const dec = new ReplicaDecoder({ classes: CLASSES, externals: new Map(), sliceRecords: 1 });
    const replica: WatchedReplica = { decoder: dec, apply: (d, all) => dec.apply(d, all), pumpCold: (b) => dec.pumpCold(b) };
    replica.apply(structuredClone(enc.diff(true)), true);
    let t = 0;
    const sync = (full = false): void => {
        replica.apply(structuredClone(enc.diff(full, () => (t += 1e-3))), full);
        replica.pumpCold(Infinity);
    };
    return { root, enc, dec, replica, rr: () => dec.object(0) as Root, sync };
}

/** Structural comparison of two graphs (identity-aware), as replicaSync.test.ts. */
function sameGraph(a: unknown, b: unknown, seen = new Map<object, object>(), path = '$'): string | null {
    if (a === null || typeof a !== 'object') return Object.is(a, b) ? null : `${path}: ${String(a)} vs ${String(b)}`;
    if (b === null || typeof b !== 'object') return `${path}: object vs ${String(b)}`;
    const known = seen.get(a);
    if (known !== undefined) return known === b ? null : `${path}: identity differs`;
    seen.set(a, b);
    if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return `${path}: prototype differs`;
    if (ArrayBuffer.isView(a)) return JSON.stringify(Array.from(a as Float64Array)) === JSON.stringify(Array.from(b as Float64Array)) ? null : `${path}: typed differs`;
    if (a instanceof Map) return sameGraph([...a], [...(b as Map<unknown, unknown>)], seen, `${path}<map>`);
    if (a instanceof Set) return sameGraph([...a], [...(b as Set<unknown>)], seen, `${path}<set>`);
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.join() !== kb.join()) return `${path}: keys ${ka.join()} vs ${kb.join()}`;
    for (const k of ka) {
        const r = sameGraph((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], seen, `${path}.${k}`);
        if (r !== null) return r;
    }
    return null;
}

function quiet(): { warned: ReplicaWrite[]; warn: (w: ReplicaWrite) => void } {
    const warned: ReplicaWrite[] = [];
    return { warned, warn: (w) => warned.push({ ...w }) };
}

/** The randomized mutations of replicaSync.test.ts (fields, references, containers, new / dropped objects, reshapes). */
function mutate(root: Root, r: () => number, step: number): void {
    root.clock = step;
    for (let k = 0; k < 8; k++) {
        const live = root.ships;
        if (live.length === 0) root.ships.push(new Ship());
        const s = live[Math.floor(r() * live.length)];
        const p = r();
        if (p < 0.15) {
            s.x += r();
            s.lastTouch = step;
            for (const g of s.weapons) g.heat += r() < 0.5 ? 1 : 0;
        } else if (p < 0.2) s.x = [NaN, Infinity, -0][Math.floor(r() * 3)];
        else if (p < 0.27) s.target = live[Math.floor(r() * live.length)];
        else if (p < 0.33) s.cargo.set(`c${Math.floor(r() * 5)}`, r());
        else if (p < 0.37) s.cargo.delete(`c${Math.floor(r() * 5)}`);
        else if (p < 0.42) s.tags.add(r() < 0.5 ? live[0] : Math.floor(r() * 4));
        else if (p < 0.44) s.tags.clear();
        else if (p < 0.5) s.grid[Math.floor(r() * 4)] = r();
        else if (p < 0.56) s.note[`k${Math.floor(r() * 4)}`] = r() < 0.3 ? undefined : { deep: [r(), s] };
        else if (p < 0.6) delete s.note[`k${Math.floor(r() * 4)}`];
        else if (p < 0.65) s.weapons.push(new Gun());
        else if (p < 0.68) s.weapons.pop();
        else if (p < 0.73) {
            const n = new Ship();
            n.weapons.push(new Gun());
            root.ships.push(n);
        } else if (p < 0.76 && live.length > 3) root.ships.splice(Math.floor(r() * live.length), 1);
        else if (p < 0.8) root.misc.push(r() < 0.5 ? [s, { n: r() }] : new Map([[s, s.weapons]]));
        else if (p < 0.83) root.misc.shift();
        else if (p < 0.88) s.name = `n${Math.floor(r() * 1000)}`;
    }
}

describe('replica write detector: the sync is never reported', () => {
    for (const trapAll of [false, true]) {
        it(`randomized graph, lagging cold parts, ${trapAll ? 'every field trapped' : 'compare only'}`, () => {
            const { root, enc, replica, rr } = toy();
            const q = quiet();
            const det = new ReplicaWriteDetector(replica, { classes: CLASSES, trapAll, sweepBudgetMs: Infinity, sweepMax: 40, warn: q.warn });
            try {
                const r = rng(7);
                for (let step = 1; step <= 300; step++) {
                    mutate(root, r, step);
                    const d: ReplicaDelta = structuredClone(enc.diff(false, () => step * 1e-3));
                    replica.apply(d);
                    if (r() < 0.6) replica.pumpCold(r() < 0.2 ? Infinity : 0.5);
                    if (step % 50 === 0) expect(det.checkAll()).toEqual([]);
                }
                replica.apply(structuredClone(enc.diff(true)), true);
                enc.mark();
                replica.apply(structuredClone(enc.diff(true)), true);
                expect(det.checkAll()).toEqual([]);
                expect(det.writes()).toEqual([]);
                expect(q.warned).toEqual([]);
                // Accessors (trapAll) keep the replica's keys, order and values: it still equals the source.
                expect(sameGraph(root, rr())).toBeNull();
                expect(Object.keys(rr().ships[0])).toEqual(Object.keys(root.ships[0]));
            } finally {
                det.dispose();
            }
        }, 120000);
    }
});

describe('replica write detector: main-thread writes are found', () => {
    it('a field: by the sync compare when the worker changes the object, by checkAll when it does not; then a trap with stack', () => {
        const { root, replica, rr, sync } = toy();
        const q = quiet();
        const det = new ReplicaWriteDetector(replica, { classes: CLASSES, sweepBudgetMs: 0, warn: q.warn });
        try {
            // The sync's next record on this ship finds the foreign value.
            rr().ships[0].x = 99;
            root.ships[0].x = 1;
            root.ships[0].lastTouch = 1;
            sync();
            let w = det.writes();
            expect(w.map((x) => [x.key, x.how])).toEqual([['Ship.x', 'sync']]);
            expect(w[0].detail).toContain('0 → 99');
            expect(w[0].stack).toBeNull();
            expect(rr().ships[0].x).toBe(1); // the sync overwrote it (as it would without the detector)
            // A field the worker never changes again: only a check finds it.
            rr().ships[1].name = 'mine';
            sync();
            expect(det.writes().map((x) => x.key)).toEqual(['Ship.x']);
            det.checkAll();
            w = det.writes();
            expect(w.map((x) => [x.key, x.how])).toEqual([['Ship.name', 'sweep'], ['Ship.x', 'sync']]);
            expect(rr().ships[1].name).toBe('mine'); // never overwritten: the stale-replica bug the detector exists for
            // Both keys are armed now: the next write anywhere on a Ship reports its stack (this file).
            rr().ships[2].name = 'again';
            w = det.writes();
            const name = w.find((x) => x.key === 'Ship.name')!;
            expect(name.byHow.trap).toBe(1);
            expect(name.stack).not.toBeNull();
            expect(stackFrames(name.stack!)[0]).toContain('replicaWriteDetector.test.ts');
            expect(q.warned.map((x) => x.key)).toEqual(['Ship.x', 'Ship.name', 'Ship.name']);
            expect(q.warned[2].stack).not.toBeNull();
            // The trapped write is not counted twice by a later compare.
            det.checkAll();
            expect(det.writes().find((x) => x.key === 'Ship.name')!.count).toBe(2);
            // The sync's writes through the accessor are not reported, and still land.
            root.ships[2].name = 'worker';
            sync(true);
            expect(rr().ships[2].name).toBe('worker');
            expect(det.writes().find((x) => x.key === 'Ship.name')!.count).toBe(2);
        } finally {
            det.dispose();
        }
    });

    it('containers: arrays (index, length, mutators), Maps, Sets, typed arrays, plain objects; added / deleted keys', () => {
        const { replica, rr } = toy();
        const q = quiet();
        const det = new ReplicaWriteDetector(replica, { classes: CLASSES, sweepBudgetMs: 0, warn: q.warn });
        try {
            const s = rr().ships[0];
            s.weapons[0] = new Gun();
            s.cargo.set('ore', 1);
            s.tags.add(3);
            s.grid[2] = 5;
            s.note.mine = 1;
            delete (s as Partial<Ship>).target;
            (s as unknown as Record<string, unknown>).added = true;
            rr().misc.push(1);
            det.checkAll();
            expect(det.writes().map((x) => x.key)).toEqual(['Root.misc[]', 'Ship.added', 'Ship.cargo{}', 'Ship.grid#', 'Ship.note.mine', 'Ship.tags{}', 'Ship.target', 'Ship.weapons[]']);
            expect(det.writes().find((x) => x.key === 'Ship.target')!.detail).toContain('deleted');
            expect(det.writes().find((x) => x.key === 'Ship.added')!.detail).toContain('added');
            // The container labels are armed: their mutators now report stacks (index writes cannot be trapped).
            rr().ships[3].weapons.push(new Gun());
            rr().ships[4].cargo.delete('x');
            rr().misc.splice(0, 1);
            rr().ships[1].grid.fill(1);
            for (const k of ['Ship.weapons[]', 'Ship.cargo{}', 'Root.misc[]', 'Ship.grid#']) {
                const w = det.writes().find((x) => x.key === k)!;
                expect(w.byHow.trap, k).toBe(1);
                expect(stackFrames(w.stack!)[0], k).toContain('replicaWriteDetector.test.ts');
            }
        } finally {
            det.dispose();
        }
    });

    it('the allow-list keeps intended client state quiet (counted, not warned, not trapped)', () => {
        const { replica, rr } = toy();
        const q = quiet();
        const det = new ReplicaWriteDetector(replica, { classes: CLASSES, sweepBudgetMs: 0, warn: q.warn, allow: ['Ship.name', 'Ship.note.*'] });
        try {
            rr().ships[0].name = 'x';
            rr().ships[0].note.k = 1;
            rr().ships[0].x = 4;
            det.checkAll();
            expect(det.unexpected().map((w) => w.key)).toEqual(['Ship.x']);
            expect(det.writes().filter((w) => w.allowed).map((w) => w.key)).toEqual(['Ship.name', 'Ship.note.k']);
            expect(q.warned.map((w) => w.key)).toEqual(['Ship.x']);
            expect(Object.getOwnPropertyDescriptor(rr().ships[0], 'name')).toHaveProperty('value');
            expect(Object.getOwnPropertyDescriptor(rr().ships[0], 'x')).toHaveProperty('get');
        } finally {
            det.dispose();
        }
    });

    it('the sweep checks a slice per cold pump; dispose unwraps and restores the built-ins', () => {
        const pushBefore = Array.prototype.push;
        const setBefore = Map.prototype.set;
        const { replica, rr, dec } = toy();
        const q = quiet();
        const det = new ReplicaWriteDetector(replica, { classes: CLASSES, warn: q.warn, sweepBudgetMs: Infinity, sweepMax: 1000 });
        rr().clock = 42;
        replica.pumpCold(0.5);
        expect(det.writes().map((w) => [w.key, w.how])).toEqual([['Root.clock', 'sweep']]);
        det.arm('Ship.weapons[]');
        expect(Array.prototype.push).not.toBe(pushBefore);
        det.dispose();
        expect(Array.prototype.push).toBe(pushBefore);
        expect(Map.prototype.set).toBe(setBefore);
        expect(dec.watch).toBeNull();
        expect(Object.prototype.hasOwnProperty.call(replica, 'apply')).toBe(false);
    });

    it('the URL flag', () => {
        expect(writeDetectorMode('?simWorker=1&detectWrites=1')).toBe('compare');
        expect(writeDetectorMode('?detectWrites=all')).toBe('all');
        expect(writeDetectorMode('?simWorker=1')).toBeNull();
        expect(writeDetectorMode('?detectWrites=0')).toBeNull();
    });
});

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

/** A fake wall clock: each tick is exactly one step's worth of real time, so the budget runs one step per tick. */
function fakeClock(): () => number {
    let t = 0;
    return () => (t += 0.001);
}

/** Host + client wired in-process (as test/simWorker.test.ts). */
function connect(game: Game, time: GalaxyTime): { host: SimHost; client: SimClientCore; tick: () => void } {
    const host = new SimHost(game, time, {} as StartGameOptions, { now: fakeClock() });
    const snap = structuredClone(host.snapshot());
    const toHost = (m: ToWorker): void => {
        const c = structuredClone(m);
        if (c.type === 'command') host.command(c);
        else if (c.type === 'clock') host.clock(c);
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
    return { host, client, tick };
}

describe('replica write detector on a game (SimHost + SimClientCore)', () => {
    it('a run reports nothing; a replica RNG draw and a messageHistory push are found, then trapped with a stack', () => {
        const game = cachedTickGame(gameData);
        const time = new GalaxyTime();
        time.paused = false;
        time.speed = 4;
        const w = connect(game, time);
        const q = quiet();
        const det = installReplicaWriteDetector(w.client.replica, { warn: q.warn, sweepBudgetMs: Infinity, sweepMax: 2000 });
        try {
            for (let i = 0; i < 240; i++) w.tick();
            expect(det.checkAll()).toEqual([]);
            const rg = w.client.galaxy;
            // The order menus' kind of write (audit §4 item 12): an RNG draw on the replica.
            rg.rnd.next(0, 100);
            rg.playerEmpire!.messageHistory.push({});
            for (let i = 0; i < 30; i++) w.tick();
            det.checkAll();
            const keys = det.unexpected().map((x) => x.key);
            expect(keys).toContain('Random.inext');
            expect(keys).toContain('Empire.messageHistory[]');
            // Armed: the next ones carry stacks.
            rg.rnd.next(0, 100);
            rg.playerEmpire!.messageHistory.push({});
            for (const k of ['Random.inext', 'Empire.messageHistory[]']) {
                const f = det.writes().find((x) => x.key === k)!;
                expect(f.stack, k).not.toBeNull();
                expect(stackFrames(f.stack!).some((l) => l.includes('replicaWriteDetector.test.ts')), k).toBe(true);
            }
        } finally {
            det.dispose();
            w.client.dispose();
            w.host.dispose();
        }
    }, 600000);

    it('with every field trapped, the replica still matches the authoritative game (save text, digest)', () => {
        const game = cachedTickGame(gameData);
        const time = new GalaxyTime();
        time.paused = false;
        time.speed = 2;
        const w = connect(game, time);
        const q = quiet();
        const det = installReplicaWriteDetector(w.client.replica, { warn: q.warn, trapAll: true, sweepBudgetMs: 0 });
        try {
            for (let i = 0; i < 120; i++) w.tick();
            w.client.replica.apply(structuredClone(w.host.sync.delta(true)), true);
            expect(det.checkAll()).toEqual([]);
            expect(q.warned).toEqual([]);
            expect(JSON.stringify(galaxyToJSON(w.client.galaxy)) === JSON.stringify(galaxyToJSON(game.galaxy))).toBe(true);
            expect(stateDigest(w.client.galaxy)).toBe(w.host.digest());
        } finally {
            det.dispose();
            w.client.dispose();
            w.host.dispose();
        }
    }, 600000);
});
