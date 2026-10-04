// Sim worker sync performance (docs/sim-worker.md §9 chunk 9), the codec and main-thread parts:
// - the compact wire format (uint32 codes, an f64 lane for the numbers that need it, one Set record per object) keeps
//   every value exactly: integers, float32-exact numbers, -0, NaN, ±Infinity, doubles, strings, refs, statics;
// - hotFieldGuards: a guarded hot field travels at the step rate only while its guard is ≥ 0, and the cold pass still
//   brings it (in the hot stream);
// - the hot pass's registries (gated objects probed by their ungated fields, empty hot arrays) are exact: a value that
//   changed and changed back between two hot passes, while another compare sent the middle value, still arrives;
// - a hot part that depends on cold births applies under a budget, over several calls, without exposing a half-built
//   object, and the pump waits for it;
// - a command reply waits for the cold parts through its delta (pumped under the reply budget), not applied at once.
import { beforeAll, describe, expect, it } from 'vitest';
import { ReplicaDecoder, ReplicaEncoder, type ReplicaDelta, type ReplicaEncoderOptions } from '../src/simworker/replicaSync';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { FRAME_REAL_MS } from '../src/sim/tick/scheduler';
import { issuePlayerCommand } from '../src/sim/player/playerCommands';
import type { StartGameOptions } from '../src/sim/startGameOptions';
import { SimHost } from '../src/simworker/simHost';
import { SimClientCore } from '../src/simworker/clientCore';
import type { StepMessage, ToWorker } from '../src/simworker/protocol';

class Ship {
    x = 0;
    y = 0;
    lastTouch = 0;
    hasBeenDestroyed = false;
    guns: Gun[] = [];
    booms: number[] = [];
    cargo: Bag | null = null;
}
class Gun {
    dist = -1;
    reset = false;
    heat = 0;
}
class Bag {
    items: unknown[] = [];
    note = '';
}
class Root {
    ships: Ship[] = [];
    misc: unknown[] = [];
    clock = 0;
    any: unknown = null;
}
const CLASSES = { Ship: Ship.prototype, Gun: Gun.prototype, Bag: Bag.prototype, Root: Root.prototype };
const STATIC = { kind: 'static' };

function options(extra: Partial<ReplicaEncoderOptions> = {}): ReplicaEncoderOptions {
    return {
        classes: CLASSES,
        skipFields: new Map(),
        externals: new Map([[STATIC, { kind: 's', key: 0 }]]),
        hotClasses: [Ship.prototype, Root.prototype],
        childHotClasses: [Gun.prototype],
        hotContainers: new Set(['Root.ships', 'Ship.booms']),
        alwaysHotFields: new Set(['Ship.x', 'Ship.y', 'Gun.dist', 'Gun.reset', 'Gun.heat', 'Root.clock', 'Root.any']),
        fixedHotClasses: ['Ship', 'Gun'],
        gates: { Ship: { gate: 'lastTouch', children: ['guns'] } },
        hotFieldGuards: { 'Gun.reset': 'dist' },
        minColdSlices: 1000,
        ...extra,
    };
}

function setup(extra: Partial<ReplicaEncoderOptions> = {}): { root: Root; enc: ReplicaEncoder; dec: ReplicaDecoder; rep: Root } {
    const root = new Root();
    for (let i = 0; i < 3; i++) {
        const s = new Ship();
        s.guns.push(new Gun());
        root.ships.push(s);
    }
    const enc = new ReplicaEncoder(options(extra), [root]);
    const dec = new ReplicaDecoder({ classes: CLASSES, externals: new Map([['s:0', STATIC]]), sliceRecords: 1 });
    dec.apply(structuredClone(enc.diff(true)), true);
    return { root, enc, dec, rep: dec.object(0) as Root };
}

/** One step: the hot part applied, the cold part only queued. */
function hotStep(enc: ReplicaEncoder, dec: ReplicaDecoder): ReplicaDelta {
    const d = structuredClone(enc.diff(false, () => 0));
    dec.apply(d);
    return d;
}

describe('replica sync, chunk 9: compact wire format', () => {
    it('keeps every value exactly, in fills and in sets', () => {
        const { root, enc, dec, rep } = setup();
        const values: unknown[] = [0, -0, 1, 7, 2 ** 31, 2 ** 32 - 1, 2 ** 32, 2 ** 53 - 1, -1, -(2 ** 40), 0.5, Math.fround(0.1), 0.1, 1e300, -1e-300, 5e-324, NaN, Infinity, -Infinity, '', 'x', true, false, null, undefined, STATIC];
        // A new object (a Fill in the births) and later sets on it.
        const bag = new Bag();
        bag.items = [...values, root.ships[0]];
        root.misc.push(bag);
        dec.apply(structuredClone(enc.diff(true)), true);
        const rb = (rep.misc[0] as Bag).items;
        expect(rb.length).toBe(values.length + 1);
        values.forEach((v, i) => expect(Object.is(rb[i], v), `fill ${String(v)}`).toBe(true));
        expect(rb[values.length]).toBe(rep.ships[0]);
        // Sets (an element per value, rotated so every slot changes) and a hot field taking each value in turn.
        for (let r = 1; r <= values.length; r++) {
            for (let i = 0; i < values.length; i++) bag.items[i] = values[(i + r) % values.length];
            root.any = values[r % values.length];
            dec.apply(structuredClone(enc.diff(true)), true);
            for (let i = 0; i < values.length; i++) expect(Object.is(rb[i], values[(i + r) % values.length]), `set ${String(values[(i + r) % values.length])}`).toBe(true);
            expect(Object.is(rep.any, values[r % values.length])).toBe(true);
        }
    });

    it('sends consecutive sets of one object as one record: a moved ship costs a few bytes per field', () => {
        const { root, enc, dec, rep } = setup();
        hotStep(enc, dec);
        for (const s of root.ships) {
            s.x = 123456.789012345; // a double: f64 lane
            s.y = 2.5; // float32-exact
            s.lastTouch = 1000; // integer
        }
        const d = hotStep(enc, dec);
        // 3 ships × (header 2 codes + 3 pairs of key + payload), the double's payload in the f64 lane.
        expect(d.hot.body.length).toBe(3 * (2 + 3 * 2) - 3);
        expect(d.hot.bodyNums.length).toBe(3);
        expect(rep.ships.map((s) => [s.x, s.y, s.lastTouch])).toEqual(root.ships.map((s) => [s.x, s.y, s.lastTouch]));
    });
});

describe('replica sync, chunk 9: hot field guards', () => {
    it('compares a guarded field at the step rate only while its guard is ≥ 0; the cold pass still brings it', () => {
        // One cold object a step (the round-robin reaches the gun only after these steps).
        const { root, enc, dec, rep } = setup({ coldMaxSets: 0 });
        const g = root.ships[0].guns[0];
        const rg = rep.ships[0].guns[0];
        // An idle gun's flag flips on every touch: not sent hot.
        for (let k = 1; k <= 4; k++) {
            root.ships[0].lastTouch = k;
            g.reset = k % 2 === 1;
            hotStep(enc, dec);
            expect(rg.reset).toBe(false);
        }
        // Fired (guard ≥ 0): the flag comes with the shot, at once.
        root.ships[0].lastTouch = 5;
        g.dist = 10;
        g.reset = true;
        hotStep(enc, dec);
        expect([rg.dist, rg.reset]).toEqual([10, true]);
        // Reset again: the guard drops below 0, the flag's flip stays behind…
        root.ships[0].lastTouch = 6;
        g.dist = -1;
        g.reset = false;
        hotStep(enc, dec);
        expect(rg.dist).toBe(-1);
        expect(rg.reset).toBe(true);
        // …until the cold pass compares the gun: in the hot stream (no cold pump needed).
        const d = structuredClone(enc.diff(true));
        dec.apply(d);
        expect(rg.reset).toBe(false);
    });
});

describe('replica sync, chunk 9: hot pass registries', () => {
    it('a gated object whose ungated field changed back after another compare sent the middle value still arrives', () => {
        const { root, enc, dec, rep } = setup();
        const s = root.ships[1];
        hotStep(enc, dec);
        hotStep(enc, dec);
        s.hasBeenDestroyed = true;
        enc.compareNow(s, 0); // sends `true` (its shadow now holds it)
        s.hasBeenDestroyed = false; // and back, before the next hot pass
        hotStep(enc, dec);
        expect(rep.ships[1].hasBeenDestroyed).toBe(false);
        // The gate itself: a touch is seen however many hot passes it waited.
        for (let k = 0; k < 3; k++) hotStep(enc, dec);
        s.lastTouch = 77;
        s.x = 5;
        hotStep(enc, dec);
        expect([rep.ships[1].lastTouch, rep.ships[1].x]).toEqual([77, 5]);
    });

    it('an empty hot array that filled and emptied again while another compare sent it arrives empty', () => {
        const { root, enc, dec, rep } = setup();
        const booms = root.ships[2].booms;
        hotStep(enc, dec);
        hotStep(enc, dec);
        booms.push(1, 2);
        enc.compareNow(booms, 0);
        booms.length = 0;
        hotStep(enc, dec);
        expect(rep.ships[2].booms).toEqual([]);
        booms.push(3);
        hotStep(enc, dec);
        expect(rep.ships[2].booms).toEqual([3]);
        booms.length = 0;
        hotStep(enc, dec);
        expect(rep.ships[2].booms).toEqual([]);
    });

    it('registry on and off give the same replica over a randomized run', () => {
        for (const seed of [1, 2, 3]) {
            let s = seed;
            const r = (): number => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
            const a = setup();
            const b = setup({ hotRegistries: false });
            for (let step = 0; step < 200; step++) {
                // The same mutations on both sides.
                const mut = Array.from({ length: 6 }, () => [r(), r(), r()]);
                for (const side of [a, b]) {
                    const root = side.root;
                    for (const [p, q, v] of mut) {
                        const ship = root.ships[Math.floor(q * root.ships.length)];
                        if (p < 0.3) {
                            ship.x += v;
                            ship.lastTouch = step;
                        } else if (p < 0.4) ship.hasBeenDestroyed = v < 0.5;
                        else if (p < 0.55) ship.booms.push(step);
                        else if (p < 0.7) ship.booms.length = 0;
                        else if (p < 0.8) side.enc.compareNow(ship, 1);
                        else if (p < 0.85) root.ships.push(Object.assign(new Ship(), { guns: [new Gun()] }));
                        else if (p < 0.9) ship.guns[0] !== undefined && ((ship.guns[0].dist = v < 0.5 ? -1 : v), (ship.guns[0].reset = v < 0.3));
                    }
                    hotStep(side.enc, side.dec);
                }
                // Hot data the view reads matches on both sides after the hot part alone.
                expect(JSON.stringify(a.rep.ships.map((x) => [x.x, x.lastTouch, x.hasBeenDestroyed, x.booms]))).toBe(JSON.stringify(b.rep.ships.map((x) => [x.x, x.lastTouch, x.hasBeenDestroyed, x.booms])));
            }
            for (const side of [a, b]) side.dec.apply(structuredClone(side.enc.diff(true)), true);
            expect(JSON.stringify(a.rep)).toBe(JSON.stringify(a.root));
            expect(JSON.stringify(b.rep)).toBe(JSON.stringify(b.root));
        }
    });
});

describe('replica sync, chunk 9: budgeted dependency births', () => {
    it('a hot part depending on a big cold birth applies over several calls, never showing a half-built object', () => {
        const { root, enc, dec, rep } = setup();
        // A big new object reached first through a cold container: born in the cold part, which is not pumped.
        const bag = new Bag();
        bag.items = Array.from({ length: 400 }, (_, i) => Object.assign(new Bag(), { note: `n${i}`, items: [i, [i]] }));
        bag.note = 'big';
        root.misc.push(bag);
        hotStep(enc, dec);
        expect(rep.misc.length).toBe(0);
        // The next hot part points a hot field at it: it depends on that cold part's births.
        root.any = bag;
        const d = structuredClone(enc.diff(false, () => 0));
        expect(d.coldDep).toBeGreaterThanOrEqual(0);
        let clock = 0;
        const now = (): number => (clock += 1);
        let calls = 0;
        for (;;) {
            calls++;
            const st = dec.apply(d, false, now, 3);
            if (!st.pending) break;
            // Meanwhile the hot field still holds the old value, and the pump waits for the births.
            expect(rep.any).toBe(null);
            expect(dec.applying).toBe(true);
            expect(dec.pumpCold(Infinity).coldParts).toBe(0);
            expect(() => dec.apply(structuredClone(d))).toThrow();
        }
        expect(calls).toBeGreaterThan(3);
        expect(dec.applying).toBe(false);
        const rb = rep.any as Bag;
        expect(rb).toBeInstanceOf(Bag);
        expect(rb.note).toBe('big');
        expect(rb.items.length).toBe(400);
        expect((rb.items[399] as Bag).items).toEqual([399, [399]]);
        // The cold body (the misc push) lands with the pump, with the same identity.
        dec.pumpCold(Infinity);
        expect(rep.misc[0]).toBe(rb);
        dec.apply(structuredClone(enc.diff(true)), true);
        expect(JSON.stringify(rep)).toBe(JSON.stringify(root));
    });
});

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

describe('sim worker, chunk 9: command replies wait for their cold parts, under a budget', () => {
    it('the reply runs once the cold parts through its delta are applied, over several frames, in issue order', () => {
        const game = cachedTickGame(gameData);
        const time = new GalaxyTime();
        time.paused = false;
        let ht = 0;
        const host = new SimHost(game, time, {} as StartGameOptions, { now: () => (ht += 0.001) });
        const toHost = (m: ToWorker): void => {
            const c = structuredClone(m);
            if (c.type === 'command') host.command(c);
            else if (c.type === 'clock') host.clock(c);
        };
        let ct = 0;
        // A tiny pump and reply budget (fake clock: 0.001 ms per read): the queue drains a few records per frame.
        const client = new SimClientCore(gameData, structuredClone(host.snapshot()), { post: toHost, now: () => (ct += 0.001), coldBudgetMs: 0, replyBudgetMs: 0.004 });
        const ui = new GalaxyTime();
        ui.bindGalaxy(client.galaxy);
        ui.paused = false;
        const replySeq = new Map<number, number>();
        const tick = (): void => {
            client.syncClock(ui);
            const m = host.tick(FRAME_REAL_MS);
            if (m !== null) {
                const c = structuredClone(m) as StepMessage;
                for (const r of c.results) replySeq.set(r.id, c.delta.seq);
                client.receive(c);
            }
            client.frame(ui);
        };
        for (let i = 0; i < 20; i++) tick();
        expect(client.replica.decoder.coldBacklog).toBeGreaterThan(0);
        const order: number[] = [];
        let waitedFrames = 0;
        for (let k = 0; k < 3; k++) {
            issuePlayerCommand(client.galaxy, client.game.playerEmpire, 'obtainUiRecords', [[]], () => {
                // Only once every cold part through the reply's delta is in.
                const seq = [...replySeq.values()][k];
                expect(client.replica.decoder.coldThrough(seq)).toBe(true);
                order.push(k);
            });
        }
        for (let f = 0; f < 2000 && order.length < 3; f++) {
            tick();
            if (order.length === 0 && client.settlingMessages > 0) waitedFrames++;
        }
        expect(order).toEqual([0, 1, 2]);
        // It did wait (the old path applied the whole backlog in the frame the reply arrived).
        expect(waitedFrames).toBeGreaterThan(0);
        expect(client.pendingReplies).toBe(0);
        client.dispose();
        host.dispose();
    }, 300000);
});
