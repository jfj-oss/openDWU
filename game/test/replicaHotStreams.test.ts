// Sim worker replica codec (src/simworker/replicaSync.ts), the per-field stream routing added for the Main View
// (docs/sim-worker.md §9 chunk 2):
// - hotStreamFields: fields of a cold class that always travel hot, compared every step for touched objects
//   (touch / touchId from onHotPass) and for the targets of relatedFields — applied at once, never overwritten by an
//   older queued cold part;
// - mixedStreamFields: cold from the cold pass, hot from a touch (re-sent whole when one went cold since; the decoder
//   drops an older queued cold set);
// - coldStreamFields: pinned fields of a fixed hot class that travel cold (so what they reference is born cold, with
//   no hot birth burst and no cold dependency);
// - a gate's child containers travel hot (a new child is born in the hot stream); gate `lists` are compared with
//   the gate, without their elements;
// - a hot part that depends on a queued cold part applies only that part's births (its body stays queued).
// Plus a fuzz of all of it with cold parts lagging by random amounts: after a full compare the replica equals the source.
import { describe, expect, it } from 'vitest';
import { ReplicaDecoder, ReplicaEncoder, type ReplicaDelta, type ReplicaEncoderOptions } from '../src/simworker/replicaSync';

class Ship {
    x = 0;
    y = 0;
    lastTouch = 0;
    hasBeenDestroyed = false;
    plan: Plan | null = null;
    target: object | null = null;
    guns: Gun[] = [];
    attackers: Ship[] = [];
    log: number[] = [];
}
class Gun {
    heat = 0;
    aim: object | null = null;
}
class Plan {
    steps: number[][] = [];
    note = '';
}
class Planet {
    x = 0;
    angle = 0;
    hit: number[] | null = null;
    name = '';
    cannon: Gun | null = null;
}
class Root {
    ships: Ship[] = [];
    planets: Planet[] = [];
    misc: unknown[] = [];
    clock = 0;
}
const CLASSES = { Ship: Ship.prototype, Gun: Gun.prototype, Plan: Plan.prototype, Planet: Planet.prototype, Root: Root.prototype };

function options(extra: Partial<ReplicaEncoderOptions> = {}): ReplicaEncoderOptions {
    return {
        classes: CLASSES,
        skipFields: new Map(),
        externals: new Map(),
        hotClasses: [Ship.prototype, Root.prototype],
        childHotClasses: [Gun.prototype],
        hotContainers: new Set(['Root.ships', 'Planet.hit']),
        alwaysHotFields: new Set(['Ship.x', 'Ship.y', 'Ship.plan', 'Ship.target', 'Gun.heat', 'Gun.aim', 'Root.clock']),
        fixedHotClasses: ['Ship', 'Gun'],
        gates: { Ship: { gate: 'lastTouch', children: ['guns'], lists: ['attackers'] } },
        hotStreamFields: new Set(['Planet.x', 'Planet.hit', 'Planet.cannon']),
        mixedStreamFields: new Set(['Planet.angle']),
        coldStreamFields: new Set(['Ship.plan']),
        relatedFields: new Set(['Gun.aim']),
        touchChildren: { Planet: ['cannon'] },
        coldMaxSets: 12,
        minColdSlices: 40,
        markEveryCycles: 2,
        markBudgetMs: 0.01,
        ...extra,
    };
}

function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

/** Class names of the shells in a part (kind 0 = class: kind, id, shape). */
function shellClasses(d: ReplicaDelta, part: 'hot' | 'cold', shapes: Map<number, string>): string[] {
    for (const [id, sh] of d.shapes) shapes.set(id, sh[1]);
    const s = d[part].shells;
    const out: string[] = [];
    for (let i = 0; i < s.length; ) {
        const kind = s[i];
        if (kind === 0 || kind === 1) {
            out.push(kind === 0 ? shapes.get(s[i + 2])! : 'plain');
            i += 3;
        } else if (kind === 2) i += 3;
        else if (kind === 5) i += 4;
        else i += 2;
    }
    return out;
}

function setup(extra: Partial<ReplicaEncoderOptions> = {}): { root: Root; enc: ReplicaEncoder; dec: ReplicaDecoder; rep: Root } {
    const root = new Root();
    for (let i = 0; i < 4; i++) {
        const s = new Ship();
        s.guns.push(new Gun());
        root.ships.push(s);
        const p = new Planet();
        p.name = `p${i}`;
        root.planets.push(p);
    }
    root.planets[0].cannon = new Gun();
    const enc = new ReplicaEncoder(options(extra), [root]);
    const dec = new ReplicaDecoder({ classes: CLASSES, externals: new Map(), sliceRecords: 1, mixedFields: new Set(['Planet.angle']) });
    dec.apply(structuredClone(enc.diff(true)), true);
    return { root, enc, dec, rep: dec.object(0) as Root };
}

describe('replica sync: per-field streams', () => {
    it('hot-stream fields of touched cold objects apply at once and are never overwritten by a lagging cold part', () => {
        const { root, enc, dec, rep } = setup();
        const touched: Planet[] = [];
        enc.onHotPass = (e) => {
            for (const p of touched) e.touch(p);
        };
        for (let step = 1; step <= 60; step++) {
            touched.length = 0;
            // Every planet moves; only some are "processed" (touched) this step — the others' moves reach the replica
            // through the cold pass (but still in the hot stream).
            for (let i = 0; i < root.planets.length; i++) {
                const p = root.planets[i];
                p.x = step * 10 + i;
                p.angle = step * 0.1;
                p.name = `p${i}-${step}`; // a cold field
                if ((step + i) % 2 === 0) touched.push(p);
            }
            const d = enc.diff(false, () => 0);
            expect(d.coldDep).toBe(-1);
            dec.apply(structuredClone(d));
            // The cold queue is never pumped here: hot data must not wait for it.
            for (const p of touched) {
                const i = root.planets.indexOf(p);
                expect(rep.planets[i].x).toBe(p.x);
                expect(rep.planets[i].angle).toBe(p.angle);
            }
            if (step % 7 === 0) {
                // Pump everything queued: the hot-stream values must survive it (no older cold set of the same field).
                dec.pumpCold(Infinity);
                for (let i = 0; i < root.planets.length; i++) {
                    if (!touched.includes(root.planets[i])) continue;
                    expect(rep.planets[i].x).toBe(root.planets[i].x);
                    expect(rep.planets[i].angle).toBe(root.planets[i].angle);
                }
            }
        }
        dec.apply(structuredClone(enc.diff(true)), true);
        for (let i = 0; i < root.planets.length; i++) {
            expect(rep.planets[i].x).toBe(root.planets[i].x);
            expect(rep.planets[i].name).toBe(root.planets[i].name);
        }
    });

    it('a touched object’s children (a planet’s cannon shot) are compared with it, in the hot stream', () => {
        const { root, enc, dec, rep } = setup();
        const p = root.planets[0];
        enc.onHotPass = (e) => e.touch(p);
        p.cannon!.heat = 42;
        p.hit = [1, 2];
        dec.apply(structuredClone(enc.diff(false, () => 0)));
        expect(rep.planets[0].cannon!.heat).toBe(42);
        expect(rep.planets[0].hit).toEqual([1, 2]);
        // The new array was born in the hot stream (no cold dependency), and then compared as a hot container.
        p.hit!.push(3);
        enc.onHotPass = null;
        dec.apply(structuredClone(enc.diff(false, () => 0)));
        expect(rep.planets[0].hit).toEqual([1, 2, 3]);
    });

    it('relatedFields: a shot’s target is compared when the shot is, so the hit shows in the same delta', () => {
        const { root, enc, dec, rep } = setup();
        const s = root.ships[0];
        const p = root.planets[2];
        s.guns[0].aim = p;
        s.lastTouch++;
        dec.apply(structuredClone(enc.diff(false, () => 0)));
        expect(rep.ships[0].guns[0].aim).toBe(rep.planets[2]);
        // The target planet is hit while the firer is processed; the planet itself is not touched.
        p.hit = [7];
        p.x = 99;
        s.lastTouch++;
        s.guns[0].heat = 1;
        const d = enc.diff(false, () => 0);
        dec.apply(structuredClone(d));
        expect(rep.planets[2].hit).toEqual([7]);
        expect(rep.planets[2].x).toBe(99);
        // A hot-class target: its hot slots (not its gate) are compared — the gate is still seen moving later.
        const t = root.ships[1];
        s.guns[0].aim = t;
        s.lastTouch++;
        dec.apply(structuredClone(enc.diff(false, () => 0)));
        t.x = 5;
        t.lastTouch = 77;
        t.guns[0].heat = 9;
        s.lastTouch++;
        dec.apply(structuredClone(enc.diff(false, () => 0)));
        expect(rep.ships[1].x).toBe(5);
        expect(rep.ships[1].lastTouch).toBe(77);
        expect(rep.ships[1].guns[0].heat).toBe(9);
    });

    it('cold-stream fields: a new plan is born in the cold part, the hot part neither carries nor waits for it', () => {
        const { root, enc, dec, rep } = setup();
        const shapes = new Map<number, string>();
        const s = root.ships[0];
        const plan = new Plan();
        plan.steps = [[1, 2], [3]];
        plan.note = 'go';
        s.plan = plan;
        s.x = 3;
        s.lastTouch++;
        const d = enc.diff(false, () => 0);
        expect(shellClasses(d, 'hot', shapes)).not.toContain('Plan');
        expect(shellClasses(d, 'cold', shapes)).toContain('Plan');
        expect(d.coldDep).toBe(-1);
        dec.apply(structuredClone(d));
        expect(rep.ships[0].x).toBe(3);
        expect(rep.ships[0].plan).toBeNull();
        dec.pumpCold(Infinity);
        expect(rep.ships[0].plan).toBeInstanceOf(Plan);
        expect(rep.ships[0].plan!.steps).toEqual([[1, 2], [3]]);
    });

    it('a gate’s child list travels hot: a new gun is born in the hot part; a gate list is compared with the gate', () => {
        const { root, enc, dec, rep } = setup();
        const s = root.ships[1];
        s.guns.push(new Gun());
        s.attackers.push(root.ships[2]);
        s.lastTouch++;
        const d = enc.diff(false, () => 0);
        expect(d.coldDep).toBe(-1);
        dec.apply(structuredClone(d));
        // Applied with the hot part alone (nothing pumped): born in the hot stream.
        expect(rep.ships[1].guns.length).toBe(2);
        expect(rep.ships[1].guns[1]).toBeInstanceOf(Gun);
        dec.pumpCold(Infinity);
        expect(rep.ships[1].attackers).toEqual([rep.ships[2]]);
        // Without the gate moving, a list change waits for the cold pass (and the cold stream).
        s.attackers.length = 0;
        dec.apply(structuredClone(enc.diff(false, () => 0)));
        expect(rep.ships[1].attackers.length).toBe(1);
        dec.apply(structuredClone(enc.diff(true)), true);
        expect(rep.ships[1].attackers.length).toBe(0);
    });

    it('mixed fields: cold from the cold pass, hot when touched, and a lagging cold set never overwrites the hot one', () => {
        const { root, enc, dec, rep } = setup();
        const p = root.planets[1];
        let touch = false;
        enc.onHotPass = (e) => {
            if (touch) e.touch(p);
        };
        // Untouched: the cold pass sends it cold (not applied until pumped).
        p.angle = 1;
        dec.apply(structuredClone(enc.diff(true)));
        expect(rep.planets[1].angle).toBe(0);
        // Touched with no further change: the queued cold value is re-sent hot.
        touch = true;
        dec.apply(structuredClone(enc.diff(false, () => 0)));
        expect(rep.planets[1].angle).toBe(1);
        // Touched with a change: hot at once; then the old cold part (angle 1) is pumped and dropped.
        p.angle = 2;
        dec.apply(structuredClone(enc.diff(false, () => 0)));
        expect(rep.planets[1].angle).toBe(2);
        dec.pumpCold(Infinity);
        expect(rep.planets[1].angle).toBe(2);
        // Untouched again: a newer cold set applies normally.
        touch = false;
        p.angle = 3;
        dec.apply(structuredClone(enc.diff(true)));
        dec.pumpCold(Infinity);
        expect(rep.planets[1].angle).toBe(3);
    });

    it('a hot part depending on a queued cold part applies only that part’s births (its body stays queued)', () => {
        const { root, enc, dec, rep } = setup();
        // A new object reached first through a cold container: born in the cold part (which is not pumped).
        const x = new Plan();
        x.note = 'deep';
        x.steps = [[9]];
        root.misc.push(x);
        dec.apply(structuredClone(enc.diff(true)));
        expect(rep.misc.length).toBe(0);
        // Next step a hot field points at it: the hot part depends on that cold part's births.
        root.ships[0].target = x;
        root.ships[0].lastTouch++;
        const d = enc.diff(false, () => 0);
        expect(d.coldDep).toBeGreaterThanOrEqual(0);
        const st = dec.apply(structuredClone(d));
        expect(st.bornParts).toBeGreaterThanOrEqual(1);
        expect(st.coldParts).toBe(0);
        const rx = rep.ships[0].target as Plan;
        expect(rx).toBeInstanceOf(Plan);
        expect(rx.note).toBe('deep');
        expect(rx.steps).toEqual([[9]]);
        // The cold part's body (the misc push) is still queued, then lands with the same identity.
        expect(rep.misc.length).toBe(0);
        dec.pumpCold(Infinity);
        expect(rep.misc[0]).toBe(rx);
    });

    for (const seed of [1, 2, 3, 4]) {
        it(`randomized mutations with per-field streams stay in sync (seed ${seed})`, () => {
            const r = rng(seed);
            const { root, enc, dec, rep } = setup();
            const touched: Planet[] = [];
            enc.onHotPass = (e) => {
                for (const p of touched) e.touch(p);
            };
            for (let step = 0; step < 300; step++) {
                root.clock++;
                touched.length = 0;
                for (let k = 0; k < 8; k++) {
                    const ships = root.ships;
                    const s = ships[Math.floor(r() * ships.length)];
                    const p = root.planets[Math.floor(r() * root.planets.length)];
                    const q = r();
                    if (q < 0.15) {
                        s.x += 1;
                        s.lastTouch = root.clock;
                        for (const g of s.guns) g.heat += r() < 0.5 ? 1 : 0;
                    } else if (q < 0.2) {
                        s.plan = r() < 0.3 ? null : Object.assign(new Plan(), { steps: [[r()], [r(), r()]], note: `n${step}` });
                        s.lastTouch = root.clock;
                    } else if (q < 0.25) s.plan?.steps.push([r()]);
                    else if (q < 0.3) s.target = r() < 0.5 ? p : (root.misc[0] as object | undefined) ?? null;
                    else if (q < 0.35) s.guns[0] !== undefined && (s.guns[0].aim = r() < 0.5 ? p : ships[0]);
                    else if (q < 0.4) s.guns.push(new Gun());
                    else if (q < 0.42) s.guns.pop();
                    else if (q < 0.47) s.attackers.push(ships[Math.floor(r() * ships.length)]);
                    else if (q < 0.5) s.attackers.length = 0;
                    else if (q < 0.55) {
                        p.x += 1;
                        p.angle = r();
                        touched.push(p);
                    } else if (q < 0.6) p.hit = r() < 0.3 ? null : [r()];
                    else if (q < 0.63) p.hit?.push(r());
                    else if (q < 0.66) p.cannon = r() < 0.5 ? null : new Gun();
                    else if (q < 0.7) p.cannon !== null && (p.cannon.heat += 1);
                    else if (q < 0.74) p.name = `p${Math.floor(r() * 100)}`;
                    else if (q < 0.78) root.misc.push(r() < 0.5 ? new Plan() : [s, p]);
                    else if (q < 0.8) root.misc.shift();
                    else if (q < 0.84) {
                        const n = new Ship();
                        n.guns.push(new Gun());
                        root.ships.push(n);
                    } else if (q < 0.86 && ships.length > 2) root.ships.splice(Math.floor(r() * ships.length), 1);
                    else if (q < 0.9) s.log.push(step);
                    else if (q < 0.93) {
                        const np = new Planet();
                        root.planets.push(np);
                    }
                    if (r() < 0.2) s.lastTouch = root.clock;
                }
                const d: ReplicaDelta = structuredClone(enc.diff(false, () => step * 1e-3));
                dec.apply(d);
                for (const p of touched) {
                    const i = root.planets.indexOf(p);
                    if (rep.planets[i] !== undefined && rep.planets[i] instanceof Planet) {
                        expect(rep.planets[i].x).toBe(p.x);
                        expect(rep.planets[i].angle).toBe(p.angle);
                    }
                }
                if (r() < 0.5) {
                    let clock = 0;
                    dec.pumpCold(r() < 0.2 ? Infinity : 0.5, () => (clock += r() < 0.7 ? 0 : 1));
                }
                // Nothing half-built is reachable from the replica's hot objects.
                for (const s of rep.ships) {
                    expect(s).toBeInstanceOf(Ship);
                    for (const g of s.guns) expect(typeof g.heat).toBe('number');
                    if (s.plan !== null) expect(Array.isArray(s.plan.steps)).toBe(true);
                }
            }
            dec.apply(structuredClone(enc.diff(true)), true);
            expect(JSON.stringify(rep, replacerFor())).toBe(JSON.stringify(root, replacerFor()));
            enc.mark();
            dec.apply(structuredClone(enc.diff(true)), true);
            expect(JSON.stringify(rep, replacerFor())).toBe(JSON.stringify(root, replacerFor()));
        });
    }
});

/** JSON with cycles broken by first-seen path (structure and sharing both compared). */
function replacerFor(): (k: string, v: unknown) => unknown {
    const seen = new Map<object, number>();
    return (_k, v) => {
        if (v === null || typeof v !== 'object') return v;
        const n = seen.get(v);
        if (n !== undefined) return `#${n}`;
        seen.set(v, seen.size);
        return Array.isArray(v) ? v : { $c: (v as object).constructor?.name, ...(v as object) };
    };
}
