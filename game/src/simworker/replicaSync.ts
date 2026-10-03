// Sim worker: the replica sync codec (docs/sim-worker.md §3).
//
// The worker owns the authoritative galaxy object graph. The main thread keeps a read-only REPLICA of it — the same
// classes (prototypes from the save registry), the same fields, the same object identities over time — so the ~90
// render / UI files that read live sim objects keep working unchanged. This module keeps the two in sync:
//
// - ReplicaEncoder (worker) knows every object of the graph by a sync id, with a SHADOW copy of each object's field
//   values as last sent. diff() compares objects with their shadows (no write tracking in the sim: the sim code is
//   untouched and runs at full speed) and writes the differences to a compact binary stream:
//     * HOT objects (ships, creatures, fighters, shots, habitats, fleets, the Galaxy, empires, and the arrays they own)
//       are compared after every step, so the main view moves at the step rate;
//     * everything else (COLD: designs, research trees, cargo, missions, diplomacy, ...) is compared round-robin in
//       slices, a full cycle every `coldCycleSteps` steps (~0.5 s), so UI screens see data at most one cycle old;
//     * objects first seen while writing a value (a new ship, a new array) are sent whole, recursively;
//     * a periodic MARK pass over the shadows drops objects no longer reachable from the roots (both sides forget
//       them, so neither leaks).
// - ReplicaDecoder (main) applies the stream to the replica: shells first (so every reference in the message
//   resolves, cycles included), then contents and field sets. Class instances are built by generated per-shape
//   constructors (one hidden class per shape, as graphCodec.ts does for loaded saves), and field sets go through
//   generated per-shape setters, so the replica is as fast to read as a loaded game.
//
// Reading is all the encoder does to the sim graph: own enumerable data properties (Object.keys order), array
// elements, Map / Set iteration, typed-array elements. No getter runs, nothing is written, no RNG is touched — so the
// sim's determinism (and the golden digests) cannot depend on whether it is synced. No DOM / Pixi imports.

import type { Encoded } from '../sim/save/graphCodec';

// ---------------------------------------------------------------------------------------------------------------
// Wire format
// ---------------------------------------------------------------------------------------------------------------

/** Object kinds (shell records). */
export const enum Kind {
    Class = 0,
    Plain = 1,
    Array = 2,
    Map = 3,
    Set = 4,
    Typed = 5,
}

/** Value tags (each value is a tag followed by one payload number). */
const enum Tag {
    Num = 0,
    Str = 1,
    True = 2,
    False = 3,
    Null = 4,
    Undef = 5,
    Ref = 6,
    Ext = 7,
}

/** Record opcodes of the body stream. */
const enum Op {
    /** id, n, n values: the fields (shape order) / elements / [k, v] pairs / items of a new object, or of an existing
     *  Map / Set / reshaped object (refill). */
    Fill = 1,
    /** id, slot, value: one field (shape slot) or array element. */
    Set = 2,
    /** id, length: an array's new length (before its element sets). */
    Len = 3,
    /** id, typed payload index: a typed array's new contents (same length). */
    Typed = 4,
    /** id, shape: an object's field list changed (followed by a Fill with the new shape's values). */
    Reshape = 5,
}

/** Typed-array constructors by index (shell / Typed records). */
const TYPED_CTORS = [Int8Array, Uint8Array, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, Uint8ClampedArray] as const;
type AnyTyped = InstanceType<(typeof TYPED_CTORS)[number]>;

function typedIndex(o: object): number {
    for (let i = 0; i < TYPED_CTORS.length; i++) if (o instanceof TYPED_CTORS[i]) return i;
    return -1;
}

/** A shape: [kind (Class / Plain), class name ('' for a plain object, '\0' for a null-prototype one), ...fields]. */
export type ReplicaShape = [Kind, string, ...string[]];

/**
 * One stream's share of a delta. `shells` and `body` are Float64 streams; strings and typed-array contents ride beside
 * them. All of it is transferable / cheap to structured-clone.
 */
export interface ReplicaPart {
    /** Shell records: kind, id, then Class/Plain: shape · Array: length · Map/Set: — · Typed: ctor, payload index. */
    shells: Float64Array;
    /** Fill records of the objects born in this part (applied before `body`: until `body` references them, a
     *  half-filled newborn is invisible, so a cold part may be paused anywhere in here). */
    births: Float64Array;
    body: Float64Array;
    strs: string[];
    typed: AnyTyped[];
    /** Ids no longer reachable (forgotten by the encoder; cold stream only). */
    drops: number[];
}

/**
 * One sync message (a step's delta, or the initial snapshot), in two streams (docs/sim-worker.md §3.3):
 * - `hot`: everything about hot objects (what the view draws every frame) — applied by the main thread at once;
 * - `cold`: everything about the other objects — the main thread may apply it later, in order, a slice per frame.
 * Every object's changes always travel in its own stream (so each object's updates stay in order), except its birth
 * (shell + first contents), which travels with whatever referenced it first. `coldDep` ≥ 0: this delta's hot part
 * refers to objects born in the cold parts up to that seq, which must be applied first (shells of `hot` first, then
 * those cold parts, then hot's body — see ReplicaDecoder.apply).
 */
export interface ReplicaDelta {
    seq: number;
    /** Shapes first used by this delta: [shapeId, shape] (registered on arrival, before either part). */
    shapes: [number, ReplicaShape][];
    hot: ReplicaPart;
    cold: ReplicaPart;
    coldDep: number;
    /** Stats for the sync-cost readout. */
    stats: DeltaStats;
}

export interface DeltaStats {
    newObjects: number;
    sets: number;
    hotCompared: number;
    /** Gated hot objects whose gate moved (fully hot-compared with their children). */
    gated: number;
    coldCompared: number;
    /** Wall ms of the diff that produced this delta (worker side), and of its hot part. */
    diffMs: number;
    hotMs: number;
    /** Approximate wire bytes (streams + strings + typed payloads), in all and of the hot part. */
    bytes: number;
    hotBytes: number;
}

/** One stream's writer (ReplicaPart under construction). */
class PartWriter {
    shells = new F64Stream();
    births = new F64Stream();
    body = new F64Stream();
    strs: string[] = [];
    typed: AnyTyped[] = [];
    drops: number[] = [];
    take(): ReplicaPart {
        const out: ReplicaPart = { shells: this.shells.take(), births: this.births.take(), body: this.body.take(), strs: this.strs, typed: this.typed, drops: this.drops };
        this.strs = [];
        this.typed = [];
        this.drops = [];
        return out;
    }
}

function partBytes(p: ReplicaPart): number {
    let bytes = (p.shells.length + p.births.length + p.body.length) * 8 + p.drops.length * 8;
    for (const s of p.strs) bytes += s.length * 2 + 8;
    for (const t of p.typed) bytes += t.byteLength;
    return bytes;
}

/** Whether a part carries nothing. */
export function partEmpty(p: ReplicaPart): boolean {
    return p.shells.length === 0 && p.births.length === 0 && p.body.length === 0 && p.drops.length === 0;
}

/** A growable Float64 stream. */
class F64Stream {
    buf = new Float64Array(1 << 14);
    n = 0;
    push(x: number): void {
        if (this.n === this.buf.length) this.grow();
        this.buf[this.n++] = x;
    }
    push2(a: number, b: number): void {
        if (this.n + 2 > this.buf.length) this.grow();
        this.buf[this.n++] = a;
        this.buf[this.n++] = b;
    }
    private grow(): void {
        const b = new Float64Array(this.buf.length * 2);
        b.set(this.buf);
        this.buf = b;
    }
    take(): Float64Array {
        const out = this.buf.slice(0, this.n);
        this.n = 0;
        return out;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Encoder (worker)
// ---------------------------------------------------------------------------------------------------------------

export interface ReplicaEncoderOptions {
    /** Class name → prototype (the save registry). */
    classes: Record<string, object>;
    /** Prototype → own fields never synced (static tables, closures, derived caches). */
    skipFields: Map<object, ReadonlySet<string>>;
    /** Static data referenced by `kind:key` instead of by value (the save's externals). */
    externals: Map<object, { kind: string; key: string | number }>;
    /** Prototypes whose instances have HOT FIELDS compared every step (see hotFieldCycles / alwaysHotFields). */
    hotClasses: readonly object[];
    /** Containers (arrays, Maps, Sets, plain objects) compared whole every step, by discovery label: `Class.field`
     *  for a container in a class instance's field, `<owner label>[]` for one inside an array / Set, `<owner label>{}`
     *  for a Map entry, `<owner label>.field` for a plain object's field (see ReplicaEncoder.labelOf). */
    hotContainers?: ReadonlySet<string>;
    /** `Class.field`s of hot classes that are always compared every step (state flips the view must show at once,
     *  e.g. a ship's destruction), whether or not they changed lately. */
    alwaysHotFields?: ReadonlySet<string>;
    /** A hot class's field is compared every step while it changed (in any instance) within this many cold cycles
     *  (default 4); other fields only in the cold cycle. */
    hotFieldCycles?: number;
    /** Wall ms per step for the cold compare (default 3). A cold cycle takes as many steps as it needs, but at least
     *  1/minColdSlices of the cold objects are compared per step (so a cycle is at most minColdSlices steps). */
    coldBudgetMs?: number;
    /** Default 1200 (20 s at 60 steps/s). */
    minColdSlices?: number;
    /** The cold compare of a step also stops once it has written this many field sets / new objects (default 6000), so
     *  the main thread's apply stays small; the minColdSlices floor still holds. */
    coldMaxSets?: number;
    /** Wall ms per step for the incremental reachability mark (default 1). */
    markBudgetMs?: number;
    /** Start a mark every this many cold cycles (default 8). */
    markEveryCycles?: number;
    /**
     * Gated hot classes: `Class` → { gate, children }. While the gate field (e.g. lastTouch) is unchanged since the
     * last compare, only the always-hot fields are compared each step (the sim did not process the object, so its
     * motion state did not move; anything else changed by others reaches the replica in the cold cycle). When the gate
     * moved, all the hot fields are compared, and so are the `children` fields' containers and the hot-class instances
     * in them (a ship's weapons and their shots, its fighters).
     */
    gates?: Record<string, { gate: string; children: readonly string[] }>;
    /** `Class.field`s of gated classes compared every step even while the gate has not moved (default:
     *  `<Class>.hasBeenDestroyed` of each gated class). */
    ungatedFields?: ReadonlySet<string>;
    /** Hot class names whose hot fields are exactly their alwaysHotFields (no adaptive fields). */
    fixedHotClasses?: readonly string[];
    /** Hot classes compared only as gated children (not on their own every step), e.g. Weapon. */
    childHotClasses?: readonly object[];
    /** A field becomes hot when, over a cold cycle, it changed (in any instance) at least this many times per step
     *  on average (default 0.25); it stays hot for hotFieldCycles cycles after it last did. */
    hotChangeRate?: number;
    /** Hot classes compared every step whose changes still travel in the cold stream (applied by the main thread a
     *  frame or so later, under its per-frame budget): what the view does not interpolate (empire money, fleets). */
    coldStreamClasses?: readonly object[];
    /** Classes whose live instances are kept in a list (ReplicaEncoder.instancesOf). */
    trackClasses?: readonly object[];
}

type DiffFn = (o: Record<string, unknown>, s: unknown[], enc: ReplicaEncoder, id: number) => void;

interface ShapeInfo {
    id: number;
    proto: object | null;
    keys: string[];
    /** Full compare (cold cycle). */
    diff: DiffFn;
    /** Hot-class shapes: compare of the hot slots only (null: not a hot class). */
    hotDiff: DiffFn | null;
    hotSlots: number[];
    /** Gated shapes: compare of the pinned slots, returning whether the gate slot changed (null: not gated). */
    gateDiff: ((o: Record<string, unknown>, s: unknown[], enc: ReplicaEncoder, id: number) => boolean) | null;
    /** Gated shapes: slots holding child containers (compared, with their hot-class elements, when the gate moves). */
    childSlots: number[];
    /** Changes per slot (any instance) in the current cold cycle. */
    counts: Uint32Array;
    /** Cold cycle in which each slot last qualified as hot (hotChangeRate), -1 never. */
    lastChanged: Int32Array;
    /** Hot fields fixed (fixedHotClasses): the pinned slots only. */
    fixed: boolean;
    /** Slots always hot (alwaysHotFields, and a gated shape's gate). */
    pinned: Uint8Array;
    /** Gated shapes: slots compared even while the gate has not moved (the gate, ungatedFields). */
    ungated: Uint8Array;
}

/** "Changed" by SameValue: NaN equals NaN, -0 differs from 0 (the state digest hashes the sign bit). */
function changed(a: unknown, b: unknown): boolean {
    // eslint-disable-next-line no-self-compare
    return a !== b ? a === a || b === b : a === 0 && 1 / (a as number) !== 1 / (b as number);
}

const KIND_NAMES = ['class', 'plain', 'array', 'map', 'set', 'typed'];

const enum MarkPhase {
    Idle = 0,
    Marking = 1,
    Sweeping = 2,
}

export class ReplicaEncoder {
    private readonly ids = new Map<object, number>();
    private objs: (object | null)[] = [];
    private kinds: number[] = [];
    private shapeOf: number[] = [];
    private shadows: (unknown[] | undefined)[] = [];
    /** 1: a hot-class instance (hot slots every step) or a hot container (whole, every step). */
    private hot: Uint8Array = new Uint8Array(1 << 16);
    /** Discovery label of each object (hotContainers, diagnostics). */
    private labels: string[] = [];
    private readonly hotContainers: ReadonlySet<string>;
    private readonly alwaysHot: ReadonlySet<string>;
    private hotIds: number[] = [];
    /** Every class instance / cold container (hot-class instances are here too: their full compare). */
    private coldIds: number[] = [];
    private coldCursor = 0;
    private cycles = 0;
    /** Stream of each object's own changes: 0 hot, 1 cold. */
    private streamOf: Uint8Array = new Uint8Array(1 << 16);
    /** Seq of the delta whose cold part carries the object's birth, -1 when born in a hot part. */
    private coldBirth: Int32Array = new Int32Array(1 << 16).fill(-1);
    private seq = 0;
    private coldDep = -1;

    private readonly nameByProto = new Map<object, string>();
    private readonly hotProtos: Set<object>;
    private readonly childHotProtos: Set<object>;
    private readonly coldStreamProtos: Set<object>;
    private readonly hotChangeRate: number;
    /** Steps (diff calls) in the current cold cycle. */
    private cycleStepCount = 0;
    private readonly shapes: ShapeInfo[] = [];
    private readonly shapesByProto = new Map<object | null, ShapeInfo[]>();
    private newShapes: [number, ReplicaShape][] = [];

    private readonly parts = [new PartWriter(), new PartWriter()] as const;
    /** The writer the current record goes to (an object's own stream, or a new object's birth stream). */
    private cur: PartWriter = this.parts[0];
    private curStream = 0;
    /** New objects whose contents are still to be written (BFS queue: id, birth stream). */
    private pending: number[] = [];
    private stats: DeltaStats = emptyStats();

    // Incremental mark (snapshot-at-the-beginning over the shadows, with a barrier on every reference written or
    // overwritten while it runs — see markGrey).
    private markPhase = MarkPhase.Idle;
    private markSeen: Uint8Array = new Uint8Array(0);
    private markStack: number[] = [];
    private sweepCursor = 0;
    private markStartedCycle = 0;
    private readonly tracked = new Map<object, Set<object>>();
    /** Objects dropped by the last completed mark. */
    lastDropped = 0;

    private readonly hotFieldCycles: number;
    private readonly coldBudgetMs: number;
    private readonly minColdSlices: number;
    private readonly coldMaxSets: number;
    private readonly markBudgetMs: number;
    readonly markEveryCycles: number;

    /** Diagnostics: field sets / new objects per label since the last reset (when not null). */
    profile: Record<string, number> | null = null;

    constructor(private readonly opts: ReplicaEncoderOptions, roots: readonly object[]) {
        for (const [name, proto] of Object.entries(opts.classes)) this.nameByProto.set(proto, name);
        this.hotProtos = new Set(opts.hotClasses);
        this.childHotProtos = new Set(opts.childHotClasses ?? []);
        this.coldStreamProtos = new Set(opts.coldStreamClasses ?? []);
        this.hotChangeRate = opts.hotChangeRate ?? 0.25;
        this.hotContainers = opts.hotContainers ?? new Set();
        this.alwaysHot = opts.alwaysHotFields ?? new Set();
        this.hotFieldCycles = Math.max(1, opts.hotFieldCycles ?? 4);
        this.coldBudgetMs = opts.coldBudgetMs ?? 3;
        this.minColdSlices = Math.max(1, opts.minColdSlices ?? 1200);
        this.coldMaxSets = opts.coldMaxSets ?? 6000;
        this.markBudgetMs = opts.markBudgetMs ?? 1;
        this.markEveryCycles = Math.max(1, opts.markEveryCycles ?? 8);
        for (const p of opts.trackClasses ?? []) this.tracked.set(p, new Set());
        roots.forEach((r, i) => this.idOf(r, `$root${i}`));
        this.flushPending();
    }

    /** Every live synced object (id order). */
    liveObjects(): object[] {
        const out: object[] = [];
        for (const o of this.objs) if (o !== null) out.push(o);
        return out;
    }

    /** Live synced instances of a trackClasses class (discovery order). */
    instancesOf(proto: object): Iterable<object> {
        return this.tracked.get(proto) ?? [];
    }

    /** Diagnostics: live objects per class / container label, with how many are hot. */
    census(): Record<string, { count: number; hot: number }> {
        const out: Record<string, { count: number; hot: number }> = {};
        for (let id = 0; id < this.objs.length; id++) {
            if (this.objs[id] === null) continue;
            const k = this.kinds[id];
            const name = k === Kind.Class ? this.labels[id] : `${KIND_NAMES[k]} ${this.labels[id]}`;
            const e = (out[name] ??= { count: 0, hot: 0 });
            e.count++;
            if (this.hot[id] === 1) e.hot++;
        }
        return out;
    }

    /** Diagnostics: the hot fields of each hot class now. */
    hotFields(): Record<string, string[]> {
        const out: Record<string, string[]> = {};
        for (const s of this.shapes) {
            if (s.hotDiff === null) continue;
            const name = this.nameByProto.get(s.proto!)!;
            out[`${name}#${s.id}`] = s.hotSlots.map((i) => s.keys[i]);
        }
        return out;
    }

    /** Number of live synced objects. */
    get size(): number {
        return this.ids.size;
    }

    get hotCount(): number {
        return this.hotIds.length;
    }

    /** Cold cycles completed. */
    get cycleCount(): number {
        return this.cycles;
    }

    /** The sync id of an object already known (or -1). */
    knownId(o: object): number {
        return this.ids.get(o) ?? -1;
    }

    /** The object with sync id `id` (null when unknown / dropped). */
    objectOf(id: number): object | null {
        return this.objs[id] ?? null;
    }

    /** Sync id of `o` for a reply / event, sending it as a new object (with everything new it reaches) when not known yet. */
    ensureId(o: object): number {
        // Named by a message the main thread resolves right after this delta's hot part: born in the hot stream, and a
        // known object born in a cold part makes that part a dependency of the hot one.
        this.curStream = 0;
        this.cur = this.parts[0];
        const known = this.ids.get(o);
        if (known !== undefined) {
            this.noteHotUse(known);
            return known;
        }
        const id = this.idOf(o, '$command');
        this.flushPending();
        return id;
    }

    /** Everything written since the last delta. */
    takeDelta(): ReplicaDelta {
        const hot = this.parts[0].take();
        const cold = this.parts[1].take();
        this.stats.hotBytes = partBytes(hot);
        this.stats.bytes = this.stats.hotBytes + partBytes(cold);
        const out: ReplicaDelta = { seq: this.seq, shapes: this.newShapes, hot, cold, coldDep: this.coldDep, stats: this.stats };
        this.seq++;
        this.coldDep = -1;
        this.newShapes = [];
        this.stats = emptyStats();
        return out;
    }

    /** Select the writer for records about object `id` (its own stream). */
    private target(id: number): void {
        const s = this.streamOf[id];
        this.curStream = s;
        this.cur = this.parts[s];
    }

    /** A record in the hot stream mentions object `id`: depend on its cold birth, if any. */
    private noteHotUse(id: number): void {
        const b = this.coldBirth[id];
        if (b >= 0 && b > this.coldDep) this.coldDep = b;
    }

    /**
     * Compare after a step: the hot fields of every hot-class instance and every hot container, then cold objects
     * (whole) for up to coldBudgetMs (`fullCold`: all of them, completing a cycle now), then a slice of the
     * incremental mark. Returns the delta.
     */
    diff(fullCold = false, now: () => number = () => performance.now()): ReplicaDelta {
        const t0 = now();
        this.cycleStepCount++;
        const hotIds = this.hotIds;
        for (let i = 0; i < hotIds.length; i++) this.compareHot(hotIds[i]);
        this.stats.hotCompared += hotIds.length;
        const t1 = now();
        this.stats.hotMs = t1 - t0;
        const cold = this.coldIds;
        let n = 0;
        if (fullCold) {
            // Everything, then a cycle boundary.
            for (let i = 0; i < cold.length; i++) this.compare(cold[i]);
            n = cold.length;
            this.coldCursor = 0;
            this.endCycle();
        } else {
            const minSlice = Math.ceil(cold.length / this.minColdSlices);
            const setsAtCold = this.stats.sets + this.stats.newObjects;
            while (n < cold.length) {
                if (this.coldCursor >= cold.length) {
                    this.coldCursor = 0;
                    this.endCycle();
                }
                this.compare(cold[this.coldCursor++]);
                n++;
                if (n >= minSlice && (this.stats.sets + this.stats.newObjects - setsAtCold >= this.coldMaxSets || ((n & 255) === 0 && now() - t1 >= this.coldBudgetMs))) break;
            }
        }
        this.stats.coldCompared += n;
        this.flushPending();
        if (this.markPhase !== MarkPhase.Idle) this.markStep(now, fullCold ? Infinity : this.markBudgetMs);
        const d = this.takeDelta();
        d.stats.diffMs = now() - t0;
        return d;
    }

    private endCycle(): void {
        this.cycles++;
        this.updateHotSlots();
        if (this.markPhase === MarkPhase.Idle && this.cycles % this.markEveryCycles === 0) this.startMark();
    }

    // --- hot slots -----------------------------------------------------------------------------------------------

    private updateHotSlots(): void {
        const steps = Math.max(1, this.cycleStepCount);
        this.cycleStepCount = 0;
        for (const s of this.shapes) {
            if (s.hotDiff === null || s.fixed) continue;
            const slots: number[] = [];
            for (let i = 0; i < s.keys.length; i++) {
                if (s.counts[i] >= this.hotChangeRate * steps) s.lastChanged[i] = this.cycles;
                s.counts[i] = 0;
                if (s.pinned[i] === 1 || (s.lastChanged[i] >= 0 && this.cycles - s.lastChanged[i] <= this.hotFieldCycles)) slots.push(i);
            }
            if (slots.length !== s.hotSlots.length || slots.some((x, i) => x !== s.hotSlots[i])) {
                s.hotSlots = slots;
                s.hotDiff = makeDiffFn(s.keys, slots);
            }
        }
    }

    // --- incremental mark ----------------------------------------------------------------------------------------

    /** Begin a reachability mark from the roots (ids 0, 1) over the shadows. */
    startMark(rootCount = 2): void {
        this.markSeen = new Uint8Array(this.objs.length + 1024);
        this.markStack = [];
        this.markPhase = MarkPhase.Marking;
        for (let r = 0; r < rootCount && r < this.objs.length; r++) if (this.objs[r] !== null) this.markGrey(r);
        this.markStartedCycle = this.cycles;
    }

    /** Barrier: `id` is reachable (while marking, pushed for scanning if not seen yet; while sweeping, kept). */
    private markGrey(id: number): void {
        if (id >= this.markSeen.length) this.growSeen(id);
        if (this.markSeen[id] === 0) {
            this.markSeen[id] = 1;
            if (this.markPhase === MarkPhase.Marking) this.markStack.push(id);
        }
    }

    /** `id` is live and needs no scan (created during the mark: its references are greyed as they are written). */
    private markBlack(id: number): void {
        if (id >= this.markSeen.length) this.growSeen(id);
        this.markSeen[id] = 1;
    }

    private growSeen(id: number): void {
        const s = new Uint8Array(Math.max(this.markSeen.length * 2, id + 1024));
        s.set(this.markSeen);
        this.markSeen = s;
    }

    private greyValue(v: unknown): void {
        if (v === null || typeof v !== 'object') return;
        const c = this.ids.get(v as object);
        if (c !== undefined) this.markGrey(c);
    }

    /** Run the mark / sweep for up to `budgetMs`. */
    private markStep(now: () => number, budgetMs: number): void {
        const t0 = now();
        let k = 0;
        if (this.markPhase === MarkPhase.Marking) {
            const stack = this.markStack;
            while (stack.length > 0) {
                const id = stack.pop()!;
                const sh = this.shadows[id];
                if (sh !== undefined && this.kinds[id] !== Kind.Typed) for (let i = 0; i < sh.length; i++) this.greyValue(sh[i]);
                if ((++k & 127) === 0 && now() - t0 >= budgetMs) return;
            }
            this.markPhase = MarkPhase.Sweeping;
            this.sweepCursor = 0;
            this.lastDropped = 0;
        }
        // Sweep: drop what the mark did not reach (objects created since the mark began were marked by the barrier).
        const seen = this.markSeen;
        while (this.sweepCursor < this.objs.length) {
            const id = this.sweepCursor++;
            const o = this.objs[id];
            if (o !== null && (id >= seen.length || seen[id] === 0)) {
                this.ids.delete(o);
                if (this.tracked.size > 0) this.tracked.get(Object.getPrototypeOf(o) as object)?.delete(o);
                this.objs[id] = null;
                this.shadows[id] = undefined;
                // Ids are never reused: a cold part still queued on the main thread may name this one.
                this.parts[1].drops.push(id);
                this.lastDropped++;
            }
            if ((++k & 1023) === 0 && now() - t0 >= budgetMs) return;
        }
        this.markPhase = MarkPhase.Idle;
        if (this.lastDropped > 0) {
            const live = (id: number): boolean => this.objs[id] !== null;
            const at = this.coldIds[this.coldCursor];
            this.hotIds = this.hotIds.filter(live);
            this.coldIds = this.coldIds.filter(live);
            // Keep the cold cursor near where it was.
            const i = at === undefined ? 0 : this.coldIds.indexOf(at);
            this.coldCursor = i < 0 ? 0 : i;
        }
    }

    /** Stop-the-world mark + sweep (tests / tools); returns the objects dropped. */
    mark(): number {
        if (this.markPhase === MarkPhase.Idle) this.startMark();
        this.markStep(() => 0, Infinity);
        return this.lastDropped;
    }

    // --- discovery -----------------------------------------------------------------------------------------------

    private idOf(o: object, label: string): number {
        const known = this.ids.get(o);
        if (known !== undefined) return known;
        const id = this.objs.length;
        this.ids.set(o, id);
        this.objs[id] = o;
        if (id >= this.hot.length) {
            const n = Math.max(this.hot.length * 2, id + 1);
            const h = new Uint8Array(n);
            h.set(this.hot);
            this.hot = h;
            const st = new Uint8Array(n);
            st.set(this.streamOf);
            this.streamOf = st;
            const cb = new Int32Array(n).fill(-1);
            cb.set(this.coldBirth);
            this.coldBirth = cb;
        }
        if (this.markPhase !== MarkPhase.Idle) {
            // Created during a mark: live by definition (and what it references is greyed as it is written).
            this.markBlack(id);
        }
        let kind: Kind;
        let shape = -1;
        let hot = this.hotContainers.has(label) || label === '$root0';
        let hotClass = false;
        let childHot = false;
        let coldStream = false;
        if (Array.isArray(o)) kind = Kind.Array;
        else if (o instanceof Map) kind = Kind.Map;
        else if (o instanceof Set) kind = Kind.Set;
        else if (ArrayBuffer.isView(o)) {
            kind = Kind.Typed;
            shape = typedIndex(o);
            if (shape < 0) throw new Error(`replica sync: unsupported typed array ${o.constructor.name}`);
        } else {
            const proto = Object.getPrototypeOf(o) as object | null;
            const plain = proto === null || proto === Object.prototype;
            kind = plain ? Kind.Plain : Kind.Class;
            if (!plain) {
                const name = this.nameByProto.get(proto!);
                if (name === undefined) throw new Error(`replica sync: class ${(proto as { constructor?: { name?: string } }).constructor?.name ?? '?'} not registered`);
                label = name;
                this.tracked.get(proto!)?.add(o);
                hotClass = this.hotProtos.has(proto!);
                hot = hotClass;
                childHot = this.childHotProtos.has(proto!);
                coldStream = this.coldStreamProtos.has(proto!);
            }
            shape = this.shapeFor(o, proto).id;
        }
        this.kinds[id] = kind;
        this.shapeOf[id] = shape;
        this.hot[id] = hot ? 1 : 0;
        this.streamOf[id] = (hot || childHot) && !coldStream ? 0 : 1;
        // Born in the stream of the record that referenced it first (the roots: hot).
        if (this.curStream === 1) this.coldBirth[id] = this.seq;
        this.labels[id] = label;
        if (this.profile !== null) {
            const name = `new ${KIND_NAMES[kind]} ${label}`;
            this.profile[name] = (this.profile[name] ?? 0) + 1;
        }
        // Hot containers are compared whole every step; hot-class instances compare their hot slots every step and
        // everything in the cold cycle.
        if (hot) this.hotIds.push(id);
        if (!hot || hotClass) this.coldIds.push(id);
        this.stats.newObjects++;
        this.pending.push(id, this.curStream);
        // Shell record.
        const sh = this.cur.shells;
        sh.push2(kind, id);
        if (kind === Kind.Class || kind === Kind.Plain) sh.push(shape);
        else if (kind === Kind.Array) sh.push((o as unknown[]).length);
        else if (kind === Kind.Typed) {
            sh.push(shape);
            sh.push(this.cur.typed.length);
            this.cur.typed.push((o as AnyTyped).slice() as AnyTyped);
        }
        return id;
    }

    private flushPending(): void {
        const p = this.pending;
        for (let k = 0; k < p.length; k += 2) {
            const s = p[k + 1];
            this.curStream = s;
            this.cur = this.parts[s];
            this.writeContents(p[k], true);
        }
        p.length = 0;
    }

    /** Fill record of a new (`birth`: in the part's births stream) or refilled object, and its shadow. */
    private writeContents(id: number, birth = false): void {
        const o = this.objs[id]!;
        const kind = this.kinds[id];
        if (kind === Kind.Typed) {
            this.shadows[id] = Array.from(o as AnyTyped);
            return;
        }
        if (this.curStream === 0) this.noteHotUse(id);
        const old = this.shadows[id];
        if (old !== undefined && this.markPhase === MarkPhase.Marking) for (let i = 0; i < old.length; i++) this.greyValue(old[i]);
        let vals: unknown[];
        if (kind === Kind.Class || kind === Kind.Plain) {
            const keys = this.shapes[this.shapeOf[id]].keys;
            vals = new Array(keys.length);
            for (let i = 0; i < keys.length; i++) vals[i] = (o as Record<string, unknown>)[keys[i]];
        } else if (kind === Kind.Array) {
            vals = (o as unknown[]).slice();
        } else if (kind === Kind.Map) {
            vals = [];
            for (const [k, v] of o as Map<unknown, unknown>) vals.push(k, v);
        } else {
            vals = [...(o as Set<unknown>)];
        }
        this.shadows[id] = vals;
        const b = birth ? this.cur.births : this.cur.body;
        b.push2(Op.Fill, id);
        b.push(vals.length);
        for (let i = 0; i < vals.length; i++) this.writeValue(vals[i], id, i, b);
    }

    /** The discovery label of a container found at `slot` of object `owner` (see hotContainers). */
    labelOf(owner: number, slot: number): string {
        const k = this.kinds[owner];
        if (k === Kind.Class || k === Kind.Plain) return `${this.labels[owner]}.${this.shapes[this.shapeOf[owner]].keys[slot]}`;
        if (k === Kind.Map) return `${this.labels[owner]}{}`;
        return `${this.labels[owner]}[]`;
    }

    private writeValue(v: unknown, owner: number, slot: number, b: F64Stream): void {
        const w = this.cur;
        switch (typeof v) {
            case 'number':
                b.push2(Tag.Num, v);
                return;
            case 'string':
                b.push2(Tag.Str, w.strs.length);
                w.strs.push(v);
                return;
            case 'boolean':
                b.push2(v ? Tag.True : Tag.False, 0);
                return;
            case 'undefined':
                b.push2(Tag.Undef, 0);
                return;
            case 'object': {
                if (v === null) {
                    b.push2(Tag.Null, 0);
                    return;
                }
                const known = this.ids.get(v);
                if (known !== undefined) {
                    if (this.markPhase !== MarkPhase.Idle) this.markGrey(known);
                    if (this.curStream === 0) this.noteHotUse(known);
                    b.push2(Tag.Ref, known);
                    return;
                }
                const ext = this.opts.externals.get(v);
                if (ext !== undefined) {
                    b.push2(Tag.Ext, w.strs.length);
                    w.strs.push(`${ext.kind}:${ext.key}`);
                    return;
                }
                b.push2(Tag.Ref, this.idOf(v, this.labelOf(owner, slot)));
                return;
            }
            default:
                throw new Error(`replica sync: cannot sync a ${typeof v}`);
        }
    }

    // --- shapes --------------------------------------------------------------------------------------------------

    private keysOf(o: object, proto: object | null): string[] {
        let keys = Object.keys(o);
        const skip = proto === null ? undefined : this.opts.skipFields.get(proto);
        if (skip !== undefined) keys = keys.filter((k) => !skip.has(k));
        return keys;
    }

    private shapeFor(o: object, proto: object | null): ShapeInfo {
        const keys = this.keysOf(o, proto);
        let list = this.shapesByProto.get(proto);
        if (list === undefined) this.shapesByProto.set(proto, (list = []));
        outer: for (const s of list) {
            if (s.keys.length !== keys.length) continue;
            for (let i = 0; i < keys.length; i++) if (s.keys[i] !== keys[i]) continue outer;
            return s;
        }
        const id = this.shapes.length;
        const plain = proto === null || proto === Object.prototype;
        const name = plain ? (proto === null ? '\0' : '') : this.nameByProto.get(proto!)!;
        const hotClass = !plain && (this.hotProtos.has(proto!) || this.childHotProtos.has(proto!));
        const pinned = new Uint8Array(keys.length);
        const gate = hotClass ? this.opts.gates?.[name] : undefined;
        const gateSlot = gate === undefined ? -1 : keys.indexOf(gate.gate);
        const ungated = new Uint8Array(keys.length);
        if (gateSlot >= 0) {
            pinned[gateSlot] = 1;
            ungated[gateSlot] = 1;
            keys.forEach((k, i) => {
                if (this.opts.ungatedFields !== undefined ? this.opts.ungatedFields.has(`${name}.${k}`) : k === 'hasBeenDestroyed') ungated[i] = 1;
            });
        }
        const hotSlots: number[] = [];
        if (hotClass) {
            keys.forEach((k, i) => {
                if (this.alwaysHot.has(`${name}.${k}`)) {
                    pinned[i] = 1;
                    hotSlots.push(i);
                }
            });
        }
        const fixed = hotClass && (this.opts.fixedHotClasses?.includes(name) ?? false);
        if (fixed && gateSlot >= 0 && !hotSlots.includes(gateSlot)) hotSlots.push(gateSlot);
        hotSlots.sort((a, b) => a - b);
        const info: ShapeInfo = {
            id,
            proto,
            keys,
            diff: makeDiffFn(keys, null),
            // Until a cold cycle has seen which fields change, a new (adaptive) hot shape compares everything every step.
            hotDiff: hotClass ? makeDiffFn(keys, fixed ? hotSlots : null) : null,
            hotSlots: hotClass && !fixed ? keys.map((_, i) => i) : hotSlots,
            fixed,
            gateDiff: gateSlot >= 0 ? makeGateFn(keys, ungated, gateSlot) : null,
            childSlots: gateSlot >= 0 ? gate!.children.map((c) => keys.indexOf(c)).filter((i) => i >= 0) : [],
            counts: new Uint32Array(keys.length),
            lastChanged: new Int32Array(keys.length).fill(-1),
            pinned,
            ungated,
        };
        this.shapes.push(info);
        list.push(info);
        this.newShapes.push([id, [plain ? Kind.Plain : Kind.Class, name, ...keys]]);
        return info;
    }

    // --- compare -------------------------------------------------------------------------------------------------

    /** Called by the generated diff functions: field `slot` of object `id` changed from `old` to `v`. */
    emitSet(id: number, slot: number, v: unknown, old: unknown): void {
        this.target(id);
        if (this.curStream === 0 && this.kinds[id] === Kind.Class) {
            // A fixed-hot-field class's other fields (found by the cold pass) travel cold: a fixed shape's slots never
            // change stream, so each field's updates stay in order.
            const info = this.shapes[this.shapeOf[id]];
            if (info.fixed && info.pinned[slot] === 0) {
                this.curStream = 1;
                this.cur = this.parts[1];
            }
        }
        if (this.curStream === 0) this.noteHotUse(id);
        const b = this.cur.body;
        b.push2(Op.Set, id);
        b.push(slot);
        if (this.markPhase === MarkPhase.Marking) this.greyValue(old);
        this.writeValue(v, id, slot, b);
        this.stats.sets++;
        const k = this.kinds[id];
        if (k === Kind.Class) this.shapes[this.shapeOf[id]].counts[slot]++;
        if (this.profile !== null) {
            const name = k === Kind.Class || k === Kind.Plain ? `${this.labels[id]}.${this.shapes[this.shapeOf[id]].keys[slot]}` : `${KIND_NAMES[k]} ${this.labels[id]}`;
            this.profile[name] = (this.profile[name] ?? 0) + 1;
        }
    }

    private compareHot(id: number): void {
        if (this.kinds[id] !== Kind.Class) {
            this.compare(id);
            return;
        }
        const o = this.objs[id];
        const sh = this.shadows[id];
        if (o === null || sh === undefined) return;
        const info = this.shapes[this.shapeOf[id]];
        if (info.gateDiff === null) {
            info.hotDiff!(o as Record<string, unknown>, sh, this, id);
            return;
        }
        if (!info.gateDiff(o as Record<string, unknown>, sh, this, id)) return;
        info.hotDiff!(o as Record<string, unknown>, sh, this, id);
        this.stats.gated++;
        const ids = this.ids;
        for (const slot of info.childSlots) {
            const c = sh[slot];
            if (c === null || typeof c !== 'object') continue;
            const cid = ids.get(c as object);
            if (cid === undefined) continue;
            this.compare(cid);
            const csh = this.shadows[cid];
            if (csh === undefined || this.kinds[cid] === Kind.Typed) continue;
            for (let i = 0; i < csh.length; i++) {
                const e = csh[i];
                if (e === null || typeof e !== 'object') continue;
                const eid = ids.get(e as object);
                if (eid !== undefined && this.kinds[eid] === Kind.Class && this.shapes[this.shapeOf[eid]].hotDiff !== null) this.compareHot(eid);
            }
        }
    }

    private compare(id: number): void {
        const o = this.objs[id];
        if (o === null) return;
        const sh = this.shadows[id];
        // Discovered during this pass: its whole contents are still to be written (pending).
        if (sh === undefined) return;
        switch (this.kinds[id]) {
            case Kind.Class: {
                this.shapes[this.shapeOf[id]].diff(o as Record<string, unknown>, sh, this, id);
                return;
            }
            case Kind.Plain: {
                const info = this.shapes[this.shapeOf[id]];
                const keys = Object.keys(o);
                let same = keys.length === info.keys.length;
                if (same) for (let i = 0; i < keys.length; i++) if (keys[i] !== info.keys[i]) { same = false; break; }
                if (same) info.diff(o as Record<string, unknown>, sh, this, id);
                else this.reshape(id, o);
                return;
            }
            case Kind.Array: {
                const a = o as unknown[];
                const n = a.length;
                if (n !== sh.length) {
                    this.target(id);
                    if (this.curStream === 0) this.noteHotUse(id);
                    const b = this.cur.body;
                    b.push2(Op.Len, id);
                    b.push(n);
                    if (n < sh.length && this.markPhase === MarkPhase.Marking) for (let i = n; i < sh.length; i++) this.greyValue(sh[i]);
                }
                const m = Math.min(n, sh.length);
                for (let i = 0; i < m; i++) {
                    const v = a[i];
                    const w = sh[i];
                    if (changed(v, w)) {
                        sh[i] = v;
                        this.emitSet(id, i, v, w);
                    }
                }
                for (let i = m; i < n; i++) {
                    sh[i] = a[i];
                    this.emitSet(id, i, a[i], undefined);
                }
                sh.length = n;
                return;
            }
            case Kind.Map: {
                const m = o as Map<unknown, unknown>;
                let same = m.size * 2 === sh.length;
                if (same) {
                    let i = 0;
                    for (const [k, v] of m) {
                        if (changed(k, sh[i]) || changed(v, sh[i + 1])) {
                            same = false;
                            break;
                        }
                        i += 2;
                    }
                }
                if (!same) this.refill(id);
                return;
            }
            case Kind.Set: {
                const s = o as Set<unknown>;
                let same = s.size === sh.length;
                if (same) {
                    let i = 0;
                    for (const v of s) {
                        if (changed(v, sh[i++])) {
                            same = false;
                            break;
                        }
                    }
                }
                if (!same) this.refill(id);
                return;
            }
            case Kind.Typed: {
                const t = o as AnyTyped;
                let same = true;
                for (let i = 0; i < t.length; i++) {
                    if (changed(t[i], sh[i])) {
                        same = false;
                        break;
                    }
                }
                if (!same) {
                    for (let i = 0; i < t.length; i++) sh[i] = t[i];
                    this.target(id);
                    if (this.curStream === 0) this.noteHotUse(id);
                    const w = this.cur;
                    w.body.push2(Op.Typed, id);
                    w.body.push(w.typed.length);
                    w.typed.push(t.slice() as AnyTyped);
                    this.stats.sets++;
                }
                return;
            }
        }
    }

    /** A Map / Set whose entries changed: send them all again. */
    private refill(id: number): void {
        this.target(id);
        this.writeContents(id);
        this.stats.sets++;
    }

    /** An object whose own field list changed: new shape, then all its values. */
    private reshape(id: number, o: object): void {
        const info = this.shapeFor(o, Object.getPrototypeOf(o) as object | null);
        this.shapeOf[id] = info.id;
        this.target(id);
        const b = this.cur.body;
        b.push2(Op.Reshape, id);
        b.push(info.id);
        this.writeContents(id);
        this.stats.sets++;
    }

    /**
     * Re-check every class instance's own field list (fields added or removed after construction; rare). The compare
     * passes assume a class instance keeps its shape. Tools / tests; returns the objects reshaped.
     */
    revalidateShapes(): number {
        let n = 0;
        for (let id = 0; id < this.objs.length; id++) {
            const o = this.objs[id];
            if (o === null || this.kinds[id] !== Kind.Class) continue;
            const info = this.shapes[this.shapeOf[id]];
            const keys = this.keysOf(o, info.proto);
            let same = keys.length === info.keys.length;
            if (same) for (let i = 0; i < keys.length; i++) if (keys[i] !== info.keys[i]) { same = false; break; }
            if (!same) {
                this.reshape(id, o);
                n++;
            }
        }
        this.flushPending();
        return n;
    }
}

function emptyStats(): DeltaStats {
    return { newObjects: 0, sets: 0, hotCompared: 0, gated: 0, coldCompared: 0, diffMs: 0, hotMs: 0, bytes: 0, hotBytes: 0 };
}

/** A generated compare of a gated shape's ungated slots that returns whether the gate slot changed. */
function makeGateFn(keys: readonly string[], pinned: Uint8Array, gateSlot: number): NonNullable<ShapeInfo['gateDiff']> {
    const access = (k: string): string => (/^[A-Za-z_$][\w$]*$/.test(k) ? `.${k}` : `[${JSON.stringify(k)}]`);
    const lines: string[] = [];
    for (let i = 0; i < keys.length; i++) {
        if (pinned[i] !== 1) continue;
        lines.push(`v = o${access(keys[i])}; w = s[${i}]; if (v !== w ? v === v || w === w : v === 0 && 1 / v !== 1 / w) { s[${i}] = v; enc.emitSet(id, ${i}, v, w);${i === gateSlot ? ' g = true;' : ''} }`);
    }
    return new Function('o', 's', 'enc', 'id', `let v, w, g = false;\n${lines.join('\n')}\nreturn g;`) as NonNullable<ShapeInfo['gateDiff']>;
}

/** A generated field-by-field compare for one shape — all of its fields, or only `slots` (monomorphic property loads;
 *  see the file header). */
function makeDiffFn(keys: readonly string[], slots: readonly number[] | null): DiffFn {
    const access = (k: string): string => (/^[A-Za-z_$][\w$]*$/.test(k) ? `.${k}` : `[${JSON.stringify(k)}]`);
    const which = slots ?? keys.map((_, i) => i);
    const lines = which.map((i) => `v = o${access(keys[i])}; w = s[${i}]; if (v !== w ? v === v || w === w : v === 0 && 1 / v !== 1 / w) { s[${i}] = v; enc.emitSet(id, ${i}, v, w); }`);
    try {
        return new Function('o', 's', 'enc', 'id', `let v, w;\n${lines.join('\n')}`) as DiffFn;
    } catch {
        return (o, s, enc, id) => {
            for (const i of which) {
                const v = o[keys[i]];
                const w = s[i];
                if (changed(v, w)) {
                    s[i] = v;
                    enc.emitSet(id, i, v, w);
                }
            }
        };
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Decoder (main thread)
// ---------------------------------------------------------------------------------------------------------------

export interface ReplicaDecoderOptions {
    /** Class name → prototype (the save registry). */
    classes: Record<string, object>;
    /** Prototype → hook run on each new instance before its fields are filled (the save's revive hooks). */
    revive?: Map<object, (instance: object) => void>;
    /** `kind:key` → static object (the replica's own GameData tables). */
    externals: Map<string, object>;
    /** The cold pump checks its deadline every this many records / shells (default 64 / 32; tests use 1). */
    sliceRecords?: number;
}

interface DecShape {
    kind: Kind;
    proto: object | null;
    keys: string[];
    ctor: (() => Record<string, unknown>) | null;
    fill: (o: Record<string, unknown>, v: unknown[]) => void;
    set: (o: Record<string, unknown>, slot: number, v: unknown) => void;
}

export interface ApplyStats {
    /** Wall ms spent applying (this call). */
    applyMs: number;
    newObjects: number;
    sets: number;
    drops: number;
    /** Cold parts applied by this call (a hot part's dependency, or the per-frame pump). */
    coldParts: number;
}

/** A cold part queued on the main thread, applied in order, possibly over several frames. */
interface QueuedPart {
    seq: number;
    part: ReplicaPart;
    /** 0 shells, 1 births, 2 body, 3 drops. */
    phase: number;
    /** Index into the phase's stream. */
    i: number;
}

export class ReplicaDecoder {
    private objs: (object | null)[] = [];
    private kinds: number[] = [];
    private shapeOf: number[] = [];
    private readonly shapes: DecShape[] = [];
    private readonly idByObj = new WeakMap<object, number>();
    private readonly coldQueue: QueuedPart[] = [];
    /** Seq of the last cold part applied completely. */
    private coldApplied = -1;
    private readonly scratch: unknown[] = [];
    /** Called with each new object once it is filled (e.g. to wire a new Empire's visibility hooks). */
    onNewObject: ((o: object) => void) | null = null;
    /** Dev-only (writeDetector.ts, docs/sim-worker.md §9 chunk 0): called with an object's id right before each shell /
     *  record that creates or changes it, so the detector can check it against the values last applied; `slot` is the
     *  shape slot of a class / plain object's field set (fieldName), -1 for any other record. Null: off. */
    watch: ((id: number, slot: number) => void) | null = null;
    private stats: ApplyStats = { applyMs: 0, newObjects: 0, sets: 0, drops: 0, coldParts: 0 };

    constructor(private readonly opts: ReplicaDecoderOptions) {}

    /** The replica object with sync id `id`. */
    object(id: number): object | null {
        return this.objs[id] ?? null;
    }

    /** The sync id of a replica object (-1 when it is not part of the replica). */
    idOf(o: object): number {
        return this.idByObj.get(o) ?? -1;
    }

    /** The field name of shape slot `slot` of class / plain object `id` (the write detector's per-field check). */
    fieldName(id: number, slot: number): string | undefined {
        return this.shapes[this.shapeOf[id]]?.keys[slot];
    }

    /** One past the highest sync id seen (ids are dense and never reused; dropped ids hold null). */
    get idLimit(): number {
        return this.objs.length;
    }

    get size(): number {
        let n = 0;
        for (const o of this.objs) if (o !== null && o !== undefined) n++;
        return n;
    }

    /** Cold parts waiting to be applied. */
    get coldBacklog(): number {
        return this.coldQueue.length;
    }

    /**
     * Apply a delta: its shapes, its hot part now (after the cold parts it depends on), and queue its cold part — or
     * apply everything now with `all` (the snapshot, tests, a save). Returns this call's stats.
     */
    apply(d: ReplicaDelta, all = false, now: () => number = () => performance.now()): ApplyStats {
        const t0 = now();
        this.stats = { applyMs: 0, newObjects: 0, sets: 0, drops: 0, coldParts: 0 };
        for (const [id, shape] of d.shapes) this.addShape(id, shape);
        const fresh: object[] = [];
        this.shellsOf(d.hot, 0, Infinity, fresh, now);
        if (d.coldDep >= 0 && d.coldDep > this.coldApplied) {
            // The hot part names objects born in cold parts up to coldDep (possibly this delta's own).
            if (d.coldDep >= d.seq) this.coldQueue.push({ seq: d.seq, part: d.cold, phase: 0, i: 0 });
            this.pumpColdUntil(d.coldDep, fresh, now);
            this.bodyOf(d.hot, d.hot.births, 0, Infinity, now);
            this.bodyOf(d.hot, d.hot.body, 0, Infinity, now);
            if (d.coldDep < d.seq && !partEmpty(d.cold)) this.coldQueue.push({ seq: d.seq, part: d.cold, phase: 0, i: 0 });
        } else {
            this.bodyOf(d.hot, d.hot.births, 0, Infinity, now);
            this.bodyOf(d.hot, d.hot.body, 0, Infinity, now);
            if (!partEmpty(d.cold)) this.coldQueue.push({ seq: d.seq, part: d.cold, phase: 0, i: 0 });
            else if (this.coldQueue.length === 0) this.coldApplied = d.seq;
        }
        if (all) this.pumpColdUntil(Infinity, fresh, now);
        if (this.onNewObject !== null) for (const o of fresh) this.onNewObject(o);
        this.stats.applyMs = now() - t0;
        return this.stats;
    }

    /**
     * Apply queued cold parts, in order, for up to `budgetMs` (a part may be left half-applied and resumed). The budget
     * grows with the backlog (+10% per part queued beyond 4, up to 4×), so the replica's cold data never falls far
     * behind.
     */
    pumpCold(budgetMs: number, now: () => number = () => performance.now()): ApplyStats {
        const t0 = now();
        budgetMs *= Math.min(4, 1 + Math.max(0, this.coldQueue.length - 4) * 0.1);
        this.stats = { applyMs: 0, newObjects: 0, sets: 0, drops: 0, coldParts: 0 };
        const fresh: object[] = [];
        const deadline = t0 + budgetMs;
        while (this.coldQueue.length > 0) {
            if (!this.advance(this.coldQueue[0], deadline, fresh, now)) break;
            this.coldApplied = this.coldQueue.shift()!.seq;
            this.stats.coldParts++;
            if (now() >= deadline) break;
        }
        if (this.onNewObject !== null) for (const o of fresh) this.onNewObject(o);
        this.stats.applyMs = now() - t0;
        return this.stats;
    }

    private pumpColdUntil(seq: number, fresh: object[], now: () => number): void {
        while (this.coldQueue.length > 0 && this.coldQueue[0].seq <= seq) {
            this.advance(this.coldQueue[0], Infinity, fresh, now);
            this.coldApplied = this.coldQueue.shift()!.seq;
            this.stats.coldParts++;
        }
    }

    /** Continue a queued part until done (true) or the deadline (false). */
    private advance(q: QueuedPart, deadline: number, fresh: object[], now: () => number): boolean {
        if (q.phase === 0) {
            q.i = this.shellsOf(q.part, q.i, deadline, fresh, now);
            if (q.i < q.part.shells.length) return false;
            q.phase = 1;
            q.i = 0;
        }
        if (q.phase === 1) {
            q.i = this.bodyOf(q.part, q.part.births, q.i, deadline, now, true);
            if (q.i < q.part.births.length) return false;
            q.phase = 2;
            q.i = 0;
        }
        if (q.phase === 2) {
            q.i = this.bodyOf(q.part, q.part.body, q.i, deadline, now);
            if (q.i < q.part.body.length) return false;
            q.phase = 3;
        }
        for (const id of q.part.drops) {
            const o = this.objs[id];
            if (o != null) this.idByObj.delete(o);
            this.objs[id] = null;
        }
        this.stats.drops += q.part.drops.length;
        return true;
    }

    /** Create the shells of a part from index `i` (every new object exists before any reference to it resolves). */
    private shellsOf(p: ReplicaPart, i: number, deadline: number, fresh: object[], now: () => number): number {
        const sh = p.shells;
        let k = 0;
        while (i < sh.length) {
            const kind = sh[i++] as Kind;
            const id = sh[i++];
            let o: object;
            switch (kind) {
                case Kind.Class:
                case Kind.Plain: {
                    const s = sh[i++];
                    const shape = this.shapes[s];
                    o = shape.ctor !== null ? shape.ctor() : this.slowShell(shape);
                    this.shapeOf[id] = s;
                    break;
                }
                case Kind.Array:
                    o = new Array(sh[i++]);
                    break;
                case Kind.Map:
                    o = new Map();
                    break;
                case Kind.Set:
                    o = new Set();
                    break;
                case Kind.Typed:
                    i++; // ctor index (the payload carries its own type)
                    o = p.typed[sh[i++]];
                    break;
                default:
                    throw new Error(`replica sync: bad shell kind ${String(kind)}`);
            }
            this.objs[id] = o;
            this.kinds[id] = kind;
            this.idByObj.set(o, id);
            if (this.watch !== null) this.watch(id, -1);
            fresh.push(o);
            this.stats.newObjects++;
            if (++k % (this.opts.sliceRecords ?? 32) === 0 && deadline !== Infinity && now() >= deadline) break;
        }
        return i;
    }

    /** Apply the records of a part's births / body stream `b` from index `start`; returns where it stopped (the end when
     *  done). `anywhere`: may stop between any two records (the births stream), else only between objects. */
    private bodyOf(p: ReplicaPart, b: Float64Array, start: number, deadline: number, now: () => number, anywhere = false): number {
        const strs = p.strs;
        const ext = this.opts.externals;
        const objs = this.objs;
        const kinds = this.kinds;
        const shapeOf = this.shapeOf;
        const shapes = this.shapes;
        let i = start;
        let k = 0;
        const every = this.opts.sliceRecords ?? 64;
        let nextCheck = every;
        const value = (): unknown => {
            const tag = b[i];
            const v = b[i + 1];
            i += 2;
            switch (tag) {
                case Tag.Num:
                    return v;
                case Tag.Ref: {
                    const o = objs[v];
                    if (o == null) throw new Error(`replica sync: reference to unknown id ${v}`);
                    return o;
                }
                case Tag.Str:
                    return strs[v];
                case Tag.True:
                    return true;
                case Tag.False:
                    return false;
                case Tag.Null:
                    return null;
                case Tag.Undef:
                    return undefined;
                case Tag.Ext: {
                    const o = ext.get(strs[v]);
                    if (o === undefined) throw new Error(`replica sync: unknown static ${strs[v]}`);
                    return o;
                }
            }
            throw new Error(`replica sync: bad value tag ${tag}`);
        };
        const scratch = this.scratch;
        const watch = this.watch;
        while (i < b.length) {
            const op = b[i];
            const id = b[i + 1];
            i += 2;
            const o = objs[id];
            if (o == null) throw new Error(`replica sync: op ${op} on unknown id ${id}`);
            if (watch !== null) watch(id, op === Op.Set && kinds[id] !== Kind.Array ? b[i] : -1);
            switch (op) {
                case Op.Set: {
                    const slot = b[i++];
                    const v = value();
                    if (kinds[id] === Kind.Array) (o as unknown[])[slot] = v;
                    else shapes[shapeOf[id]].set(o as Record<string, unknown>, slot, v);
                    this.stats.sets++;
                    break;
                }
                case Op.Fill: {
                    const n = b[i++];
                    const kind = kinds[id];
                    if (kind === Kind.Class || kind === Kind.Plain) {
                        scratch.length = n;
                        for (let x = 0; x < n; x++) scratch[x] = value();
                        shapes[shapeOf[id]].fill(o as Record<string, unknown>, scratch);
                    } else if (kind === Kind.Array) {
                        const a = o as unknown[];
                        a.length = n;
                        for (let x = 0; x < n; x++) a[x] = value();
                    } else if (kind === Kind.Map) {
                        const m = o as Map<unknown, unknown>;
                        m.clear();
                        for (let x = 0; x < n; x += 2) {
                            const key = value();
                            m.set(key, value());
                        }
                    } else if (kind === Kind.Set) {
                        const st = o as Set<unknown>;
                        st.clear();
                        for (let x = 0; x < n; x++) st.add(value());
                    }
                    break;
                }
                case Op.Len:
                    (o as unknown[]).length = b[i++];
                    break;
                case Op.Typed:
                    (o as AnyTyped).set(p.typed[b[i++]] as never);
                    this.stats.sets++;
                    break;
                case Op.Reshape: {
                    const s = b[i++];
                    const old = shapes[shapeOf[id]];
                    const next = shapes[s];
                    // Drop every old field: the Fill that follows re-adds them in the new shape's order (key order is
                    // state — a plain object's keys are saved in order).
                    for (const key of old.keys) delete (o as Record<string, unknown>)[key];
                    void next;
                    shapeOf[id] = s;
                    break;
                }
                default:
                    throw new Error(`replica sync: bad op ${op}`);
            }
            // Stop only between objects (never between an array's new length and its element sets), so a half-applied
            // cold part never shows a half-updated object.
            k++;
            if (deadline !== Infinity && k >= nextCheck && i < b.length && (anywhere || b[i + 1] !== id)) {
                nextCheck = k + every;
                if (now() >= deadline) break;
            }
        }
        return i;
    }

    private addShape(id: number, shape: ReplicaShape): void {
        const [kind, name, ...keys] = shape;
        let proto: object | null;
        if (kind === Kind.Plain) proto = name === '\0' ? null : Object.prototype;
        else {
            proto = this.opts.classes[name] ?? null;
            if (proto === null) throw new Error(`replica sync: unknown class ${name}`);
        }
        this.shapes[id] = makeDecShape(kind, proto, keys, proto === null ? undefined : this.opts.revive?.get(proto));
    }

    private slowShell(shape: DecShape): Record<string, unknown> {
        const o = Object.create(shape.proto) as Record<string, unknown>;
        if (shape.proto !== null) this.opts.revive?.get(shape.proto)?.(o);
        for (const k of shape.keys) Object.defineProperty(o, k, { value: undefined, writable: true, enumerable: true, configurable: true });
        return o;
    }
}

function makeDecShape(kind: Kind, proto: object | null, keys: string[], revive: ((o: object) => void) | undefined): DecShape {
    const access = (k: string): string => (/^[A-Za-z_$][\w$]*$/.test(k) ? `.${k}` : `[${JSON.stringify(k)}]`);
    const usable = new Set(keys).size === keys.length && keys.every((k) => k !== '__proto__' && !assignmentIntercepted(proto, k));
    let ctor: (() => Record<string, unknown>) | null = null;
    let fill: DecShape['fill'];
    let set: DecShape['set'];
    try {
        if (usable && revive === undefined) {
            const S = new Function(`return function Shape() {\n${keys.map((k) => `this${access(k)} = undefined;`).join('\n')}\n};`)() as { new (): Record<string, unknown>; prototype: object | null };
            S.prototype = proto as object;
            ctor = proto === null ? null : () => new S();
        }
        fill = new Function('o', 'v', keys.map((k, i) => `o${access(k)} = v[${i}];`).join('\n')) as DecShape['fill'];
        set = new Function('o', 's', 'v', `switch (s) {\n${keys.map((k, i) => `case ${i}: o${access(k)} = v; return;`).join('\n')}\n}`) as DecShape['set'];
    } catch {
        ctor = null;
        fill = (o, v) => {
            for (let i = 0; i < keys.length; i++) o[keys[i]] = v[i];
        };
        set = (o, s, v) => {
            o[keys[s]] = v;
        };
    }
    void kind;
    return { kind, proto, keys, ctor, fill, set };
}

/** Whether assigning `key` on an object with prototype `proto` could hit an accessor / read-only property. */
function assignmentIntercepted(proto: object | null, key: string): boolean {
    for (let o = proto; o !== null; o = Object.getPrototypeOf(o) as object | null) {
        const d = Object.getOwnPropertyDescriptor(o, key);
        if (d !== undefined) return d.get !== undefined || d.set !== undefined || d.writable === false;
    }
    return false;
}

/** Transferable buffers of a delta (for postMessage's transfer list). */
export function deltaTransferables(d: ReplicaDelta): ArrayBuffer[] {
    const out: ArrayBuffer[] = [];
    for (const p of [d.hot, d.cold]) {
        out.push(p.shells.buffer as ArrayBuffer, p.births.buffer as ArrayBuffer, p.body.buffer as ArrayBuffer);
        for (const t of p.typed) if (!out.includes(t.buffer as ArrayBuffer)) out.push(t.buffer as ArrayBuffer);
    }
    return out;
}

export type { Encoded };
