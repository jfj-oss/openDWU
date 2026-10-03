// Sim worker replica codec (src/simworker/replicaSync.ts): a randomized graph of class instances, arrays, Maps, Sets,
// plain objects and typed arrays is mutated step after step (fields, references, cycles, new and dropped objects,
// reshaped plain objects, NaN / undefined / ±Infinity), diffed with hot and cold objects, gates and the incremental
// mark, and applied on a replica whose cold parts lag by random amounts. After a full compare + flush the replica
// must equal the source structurally, with stable object identities.
import { describe, expect, it } from 'vitest';
import { ReplicaDecoder, ReplicaEncoder, type ReplicaDelta } from '../src/simworker/replicaSync';

class Ship {
    x = 0;
    y = 0;
    lastTouch = 0;
    hasBeenDestroyed = false;
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
    shot: number | undefined = undefined;
}
class Root {
    ships: Ship[] = [];
    misc: unknown[] = [];
    clock = 0;
    statics: object[] = [];
}
const STATIC_A = { static: 'a' };
const STATIC_B = { static: 'b' };
const CLASSES = { Ship: Ship.prototype, Gun: Gun.prototype, Root: Root.prototype };

function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

/** Structural comparison of two graphs (identity-aware: a cycle must map to the same partner). */
function sameGraph(a: unknown, b: unknown, seen = new Map<object, object>(), path = '$'): string | null {
    if (a === null || typeof a !== 'object') {
        if (Object.is(a, b)) return null;
        return `${path}: ${String(a)} vs ${String(b)}`;
    }
    if (b === null || typeof b !== 'object') return `${path}: object vs ${String(b)}`;
    const known = seen.get(a);
    if (known !== undefined) return known === b ? null : `${path}: identity differs`;
    seen.set(a, b);
    if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return `${path}: prototype differs`;
    if (a === STATIC_A || a === STATIC_B) return a === b ? null : `${path}: static differs`;
    if (ArrayBuffer.isView(a)) return JSON.stringify(Array.from(a as Float64Array)) === JSON.stringify(Array.from(b as Float64Array)) ? null : `${path}: typed differs`;
    if (a instanceof Map) {
        const ea = [...a], eb = [...(b as Map<unknown, unknown>)];
        if (ea.length !== eb.length) return `${path}: map size`;
        for (let i = 0; i < ea.length; i++) {
            const r = sameGraph(ea[i][0], eb[i][0], seen, `${path}<k${i}>`) ?? sameGraph(ea[i][1], eb[i][1], seen, `${path}<v${i}>`);
            if (r !== null) return r;
        }
        return null;
    }
    if (a instanceof Set) return sameGraph([...a], [...(b as Set<unknown>)], seen, `${path}<set>`);
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.join() !== kb.join()) return `${path}: keys ${ka.join()} vs ${kb.join()}`;
    for (const k of ka) {
        const r = sameGraph((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], seen, `${path}.${k}`);
        if (r !== null) return r;
    }
    return null;
}

function run(seed: number, steps: number): void {
    const r = rng(seed);
    const root = new Root();
    root.statics.push(STATIC_A);
    const pool: Ship[] = [];
    const newShip = (): Ship => {
        const s = new Ship();
        s.name = `s${pool.length}`;
        for (let i = 0; i < 1 + Math.floor(r() * 3); i++) s.weapons.push(new Gun());
        pool.push(s);
        return s;
    };
    for (let i = 0; i < 20; i++) root.ships.push(newShip());
    const opts = {
        classes: CLASSES,
        skipFields: new Map(),
        externals: new Map<object, { kind: string; key: string | number }>([[STATIC_A, { kind: 's', key: 0 }], [STATIC_B, { kind: 's', key: 1 }]]),
        hotClasses: [Ship.prototype, Root.prototype],
        childHotClasses: [Gun.prototype],
        hotContainers: new Set(['Root.ships']),
        alwaysHotFields: new Set(['Ship.x', 'Ship.y']),
        fixedHotClasses: ['Ship'],
        gates: { Ship: { gate: 'lastTouch', children: ['weapons'] } },
        coldMaxSets: 15,
        minColdSlices: 50,
        markEveryCycles: 2,
        markBudgetMs: 0.01,
    };
    const enc = new ReplicaEncoder(opts, [root]);
    const dec = new ReplicaDecoder({ classes: CLASSES, externals: new Map([['s:0', STATIC_A], ['s:1', STATIC_B]]) });
    dec.apply(structuredClone(enc.diff(true)), true);
    const replicaRoot = dec.object(0) as Root;
    const identity = new Map<number, object>();
    for (let step = 0; step < steps; step++) {
        // Mutate.
        root.clock++;
        for (let k = 0; k < 10; k++) {
            const live = root.ships;
            if (live.length === 0) break;
            const s = live[Math.floor(r() * live.length)];
            const p = r();
            if (p < 0.2) {
                s.x += 1;
                s.y -= 1;
                s.lastTouch = root.clock;
                for (const g of s.weapons) g.heat = r() < 0.5 ? g.heat + 1 : g.heat;
            } else if (p < 0.25) s.x = [NaN, Infinity, -Infinity, -0][Math.floor(r() * 4)];
            else if (p < 0.3) s.target = live[Math.floor(r() * live.length)];
            else if (p < 0.33) s.target = r() < 0.5 ? STATIC_B : null;
            else if (p < 0.38) s.cargo.set(`c${Math.floor(r() * 5)}`, r());
            else if (p < 0.41) s.cargo.delete(`c${Math.floor(r() * 5)}`);
            else if (p < 0.45) s.tags.add(r() < 0.5 ? live[0] : Math.floor(r() * 4));
            else if (p < 0.47) s.tags.clear();
            else if (p < 0.5) s.grid[Math.floor(r() * 4)] = r();
            else if (p < 0.55) s.note[`k${Math.floor(r() * 4)}`] = r() < 0.3 ? undefined : { deep: [r(), s] };
            else if (p < 0.57) delete s.note[`k${Math.floor(r() * 4)}`];
            else if (p < 0.6) s.weapons.push(new Gun());
            else if (p < 0.62) s.weapons.pop();
            else if (p < 0.64) s.hasBeenDestroyed = !s.hasBeenDestroyed;
            else if (p < 0.68) root.ships.push(newShip());
            else if (p < 0.72) root.ships.splice(Math.floor(r() * live.length), 1);
            else if (p < 0.75) root.misc.push(r() < 0.5 ? [s, { n: r() }] : new Map([[s, s.weapons]]));
            else if (p < 0.78) root.misc.shift();
            else if (p < 0.8) s.name = `n${Math.floor(r() * 1000)}`;
            else if (p < 0.82) (s.weapons[0] ?? new Gun()).shot = r() < 0.5 ? undefined : r();
        }
        const d: ReplicaDelta = structuredClone(enc.diff(false, () => step * 1e-3));
        dec.apply(d);
        // Cold parts lag by a random amount (0..several frames' worth of pump).
        if (r() < 0.6) dec.pumpCold(r() < 0.2 ? Infinity : 0.0001, () => (r() < 0.5 ? 0 : 1));
        // Identity: an id keeps naming the same replica object while it lives.
        for (let id = 0; id < 50; id++) {
            const o = dec.object(id);
            if (o === null) continue;
            const was = identity.get(id);
            if (was !== undefined) expect(o).toBe(was);
            identity.set(id, o);
        }
        expect(dec.object(0)).toBe(replicaRoot);
    }
    // Full compare + flush: the replica equals the source.
    dec.apply(structuredClone(enc.diff(true)), true);
    expect(sameGraph(root, replicaRoot)).toBeNull();
    // A completed mark drops what is unreachable (both sides) and the graph is still equal.
    enc.mark();
    dec.apply(structuredClone(enc.diff(true)), true);
    expect(sameGraph(root, replicaRoot)).toBeNull();
    expect(enc.size).toBeLessThanOrEqual(dec.size + 0);
}

describe('replica sync codec', () => {
    for (const seed of Array.from({ length: Number(process.env.FUZZ_SEEDS ?? 8) }, (_, i) => i + 1)) {
        it(`randomized graph mutations stay in sync (seed ${seed})`, () => run(seed, Number(process.env.FUZZ_STEPS ?? 400)));
    }

    it('writes nothing for an unchanged graph', () => {
        const root = new Root();
        root.ships.push(new Ship());
        const enc = new ReplicaEncoder({ classes: CLASSES, skipFields: new Map(), externals: new Map(), hotClasses: [Ship.prototype] }, [root]);
        enc.diff(true);
        const d = enc.diff(true);
        expect(d.stats.sets).toBe(0);
        expect(d.stats.newObjects).toBe(0);
    });
});
