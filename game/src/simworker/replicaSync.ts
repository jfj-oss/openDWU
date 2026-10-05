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

/**
 * Value tags. A value is its tag code, then its payload: Num — the next number of the stream's f64 lane; F32 — one
 * code holding the float32 bits (a number Math.fround leaves unchanged: the sim's C# `float` fields); Int — one code
 * holding the number (an integer in [0, 2^32): ids, counters, game-ms timestamps); Str / Ext — one code, the index
 * into the part's strings; Ref — one code, the sync id; True / False / Null / Undef — none. Every number keeps its
 * exact value (the lanes are chosen by what represents it exactly), so the replica is exact.
 */
const enum Tag {
    Num = 0,
    Str = 1,
    True = 2,
    False = 3,
    Null = 4,
    Undef = 5,
    Ref = 6,
    Ext = 7,
    F32 = 8,
    Int = 9,
}

/** Bits of a Set pair's key code below the slot (the value's tag). */
const TAG_BITS = 4;
/** Highest shape slot / array index a Set pair can name (the key code is slot · 16 + tag, a uint32). */
const MAX_SLOT = 2 ** (32 - TAG_BITS) - 1;
/** Bits of a record header below its count (header = op + n · 8). */
const OP_BITS = 3;
const MAX_COUNT = 2 ** (32 - OP_BITS) - 1;

/**
 * Record opcodes of the births / body streams. A record is a header code (`op + n · 8`) and the object's id, then:
 */
const enum Op {
    /** n values: the fields (shape order) / elements / [k, v] pairs / items of a new object, or of an existing Map /
     *  Set / reshaped object (refill). */
    Fill = 1,
    /** n (key, value) pairs, key = slot · 16 + tag: fields (shape slots) or array elements of one object, in the order
     *  compared (consecutive sets of one object share one record). */
    Set = 2,
    /** (n = 0) length: an array's new length (before its element sets). */
    Len = 3,
    /** (n = 0) typed payload index: a typed array's new contents (same length). */
    Typed = 4,
    /** (n = 0) shape: an object's field list changed (followed by a Fill with the new shape's values). */
    Reshape = 5,
}

/** Float32 bits ↔ number (the F32 tag's payload code). */
const F32_BOX = new Float32Array(1);
const F32_BITS = new Uint32Array(F32_BOX.buffer);

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
 * One stream's share of a delta. Records are uint32 codes (`Op`, `Tag`); the numbers that need all 64 bits ride in an
 * f64 lane beside each code stream, strings and typed-array contents beside them. All of it is transferable / cheap
 * to structured-clone.
 */
export interface ReplicaPart {
    /** Shell records: kind, id, then Class/Plain: shape · Array: length · Map/Set: — · Typed: ctor, payload index. */
    shells: Uint32Array;
    /** Fill records of the objects born in this part (applied before `body`: until `body` references them, a
     *  half-filled newborn is invisible, so a cold part may be paused anywhere in here), and their f64 numbers. */
    births: Uint32Array;
    birthNums: Float64Array;
    body: Uint32Array;
    bodyNums: Float64Array;
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

/** A record stream under construction: uint32 codes and their f64 lane, plus the Set record still open for appending. */
class RecordWriter {
    readonly codes = new U32Stream();
    readonly nums = new F64Stream();
    /** The open Set record: its header's index, its object, and where the codes ended after its last pair (-1: none). */
    openAt = -1;
    openId = -1;
    openEnd = -1;
    reset(): void {
        this.openAt = this.openId = this.openEnd = -1;
    }
}

/** One stream's writer (ReplicaPart under construction). */
class PartWriter {
    shells = new U32Stream();
    births = new RecordWriter();
    body = new RecordWriter();
    strs: string[] = [];
    typed: AnyTyped[] = [];
    drops: number[] = [];
    take(): ReplicaPart {
        const out: ReplicaPart = {
            shells: this.shells.take(),
            births: this.births.codes.take(),
            birthNums: this.births.nums.take(),
            body: this.body.codes.take(),
            bodyNums: this.body.nums.take(),
            strs: this.strs,
            typed: this.typed,
            drops: this.drops,
        };
        this.births.reset();
        this.body.reset();
        this.strs = [];
        this.typed = [];
        this.drops = [];
        return out;
    }
}

function partBytes(p: ReplicaPart): number {
    let bytes = (p.shells.length + p.births.length + p.body.length) * 4 + (p.birthNums.length + p.bodyNums.length) * 8 + p.drops.length * 8;
    for (const s of p.strs) bytes += s.length * 2 + 8;
    for (const t of p.typed) bytes += t.byteLength;
    return bytes;
}

/** Whether a part carries nothing. */
export function partEmpty(p: ReplicaPart): boolean {
    return p.shells.length === 0 && p.births.length === 0 && p.body.length === 0 && p.drops.length === 0;
}

/** Stream buffers above this many elements are shrunk when a take used under a quarter of them. */
const SHRINK_ABOVE = 1 << 16;

/** The least power of two >= n (n >= 1). */
function ceilPow2(n: number): number {
    return n <= 1 ? 1 : 2 ** (32 - Math.clz32(n - 1));
}

/** A growable Float64 stream. */
class F64Stream {
    buf = new Float64Array(1 << 12);
    n = 0;
    push(x: number): void {
        if (this.n === this.buf.length) this.grow();
        this.buf[this.n++] = x;
    }
    private grow(): void {
        const b = new Float64Array(this.buf.length * 2);
        b.set(this.buf);
        this.buf = b;
    }
    take(): Float64Array {
        const out = this.buf.slice(0, this.n);
        // Shrink a buffer grown far past what deltas now need (U32Stream.take).
        if (this.buf.length > SHRINK_ABOVE && this.n < this.buf.length >>> 2) this.buf = new Float64Array(Math.max(1 << 12, ceilPow2(this.n)));
        this.n = 0;
        return out;
    }
}

/** A growable uint32 stream (values are stored as uint32: callers pass integers in [0, 2^32)). */
class U32Stream {
    buf = new Uint32Array(1 << 14);
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
    push3(a: number, b: number, c: number): void {
        if (this.n + 3 > this.buf.length) this.grow();
        this.buf[this.n++] = a;
        this.buf[this.n++] = b;
        this.buf[this.n++] = c;
    }
    private grow(): void {
        const b = new Uint32Array(this.buf.length * 2);
        b.set(this.buf);
        this.buf = b;
    }
    take(): Uint32Array {
        const out = this.buf.slice(0, this.n);
        // A buffer grown far past what deltas now need is shrunk: the snapshot (every object's birth) grew each stream to
        // hundreds of MB that were kept for the whole game — ~500 MB of the renderer's memory on a 100k-habitat galaxy.
        if (this.buf.length > SHRINK_ABOVE && this.n < this.buf.length >>> 2) this.buf = new Uint32Array(Math.max(1 << 14, ceilPow2(this.n)));
        this.n = 0;
        return out;
    }
}

/** Record header code. */
function header(op: Op, n: number): number {
    if (n > MAX_COUNT) throw new Error(`replica sync: a record of ${n} values is too long`);
    return op + n * (1 << OP_BITS);
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
    gates?: Record<string, { gate: string; children: readonly string[]; lists?: readonly string[] }>;
    /**
     * `Class.field`s whose changes always travel in the HOT stream, whatever their object's own stream: rarely changing
     * fields of cold classes the view needs at once (a habitat's explosions, a system's visibility). They are compared in the cold
     * cycle like any field, and every step for the objects named by touch() / touchId() / relatedFields. A class-wide,
     * fixed choice, so each field's updates stay in order.
     */
    hotStreamFields?: ReadonlySet<string>;
    /**
     * `Class.field`s of cold classes that travel COLD when the cold pass finds them changed, and HOT when touch() /
     * relatedFields compares them: a habitat's orbit pair and position, needed at once only where a ship parked at the
     * habitat moved with it (its parent's position must arrive with its own), and otherwise a thousand changes a step
     * not worth the hot stream. Ordering: a touch re-sends all of an object's mixed fields hot whenever one of them
     * went cold since its last hot send, and the decoder (ReplicaDecoderOptions.mixedFields) drops a queued cold set of
     * a mixed field older than the object's last hot one.
     */
    mixedStreamFields?: ReadonlySet<string>;
    /**
     * `Class.field`s of fixed hot classes compared every step with the hot fields, whose changes travel in the COLD
     * stream: references to objects that are expensive to give birth to in the hot stream (a new mission and its command
     * list) or that are usually born in a cold part (a new design, a new fleet) — sent cold, they neither inflate the hot
     * part nor make it depend on a queued cold part. Also a fixed choice per field.
     */
    coldStreamFields?: ReadonlySet<string>;
    /**
     * `Class.field`s whose referenced object is compared (its touch slots: the hot fields of a hot class without its
     * gate, the hotStreamFields and mixedStreamFields of a cold class) whenever the holder is hot-compared — a shot's, fighter's or
     * creature's target, so what the hit does to it (a shield strike, a bombardment explosion) shows at once rather
     * than when the target is next processed.
     */
    relatedFields?: ReadonlySet<string>;
    /** Class name → fields compared, with the hot-class instances in them, by touch() (what a touched cold object
     *  animates: a habitat's giant ion cannon shot). */
    touchChildren?: Record<string, readonly string[]>;
    /** `Class.field`s of gated classes compared every step even while the gate has not moved (default:
     *  `<Class>.hasBeenDestroyed` of each gated class). */
    ungatedFields?: ReadonlySet<string>;
    /** Hot class names whose hot fields are exactly their alwaysHotFields (no adaptive fields). */
    fixedHotClasses?: readonly string[];
    /**
     * `Class.field` → `guard`: a fixed hot field compared by the hot and touch compares only while the object's
     * `guard` field is ≥ 0 — a flag that only matters to the view while the object is drawn (a shot in flight:
     * Weapon.resetNext flips on every touch of an idle weapon, distanceTravelled −1). The cold pass still compares it
     * (in the hot stream, as every slot of a fixed hot class's pinned fields), so the replica stays exact within a
     * cold cycle, and the moment the guard turns ≥ 0 the field is compared with it.
     */
    hotFieldGuards?: Readonly<Record<string, string>>;
    /** Probe gated hot objects and hot arrays through their dense registries (default true; false: compare each in
     *  full every step, as before — A/B measurements). */
    hotRegistries?: boolean;
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
    /** Gated shapes: slots holding containers compared (whole, without their elements) when the gate moves. */
    listSlots: number[];
    /** Slots whose sets always travel hot (hotStreamFields; null: none). */
    hotStream: Uint8Array | null;
    /** Slots that travel hot from touch compares and cold from the cold pass (mixedStreamFields; null: none). */
    mixed: Uint8Array | null;
    mixedSlots: number[];
    /** Slots whose sets always travel cold (coldStreamFields; null: none). */
    coldStream: Uint8Array | null;
    /** Compare for touch() / relatedFields (hot slots without the gate, or the hot-stream and mixed slots; null: nothing). */
    touchDiff: DiffFn | null;
    /** Slots whose referenced object is touch-compared along with this one (relatedFields). */
    relatedSlots: number[];
    /** Slots compared with their hot-class contents by touch() (touchChildren). */
    touchChildSlots: number[];
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

/** A registry entry's "never compared" marker (ungated values) — differs from every value. */
const INVALID: unique symbol = Symbol('replica sync: not compared');
/** A registry entry's "a number, in the f64 lane" marker. */
const NUM: unique symbol = Symbol('replica sync: number');

/**
 * Hot objects of one gated class, densely (docs/sim-worker.md §3.2 "Gates"): each with the values its ungated fields
 * (the gate, ungatedFields) had at its last gate compare. The hot pass probes them here — one read of the object, none
 * of its shadow — and runs the gate compare only for those that changed: on a late galaxy the sim touches about a tenth
 * of the ships a step, and the shadow / shape lookups of the others were most of the hot pass (cache misses over
 * 2.4 M-entry tables). Exact: an entry is valid only while no other compare changed the object's shadow since
 * (emitSet / writeContents invalidate it), so "unchanged since the last gate compare" means "equal to the shadow".
 */
interface GateRegistry {
    /** Ungated field names (the gate first). */
    names: string[];
    objs: (object | null)[];
    ids: number[];
    /** Per entry × names: the value at the last gate compare, NUM (then in `num`), or INVALID. */
    seen: unknown[];
    num: Float64Array;
    probe: (o: object, seen: unknown[], num: Float64Array, base: number, NUMS: symbol) => boolean;
    record: (o: object, seen: unknown[], num: Float64Array, base: number, NUMS: symbol) => void;
}

function makeGateRegistry(names: string[]): GateRegistry {
    const access = (k: string): string => (/^[A-Za-z_$][\w$]*$/.test(k) ? `.${k}` : `[${JSON.stringify(k)}]`);
    // SameValue against the recorded value: numbers in the f64 lane (no boxed doubles to chase), the rest by identity.
    const probe = names.map((k, u) => `v = o${access(k)}; if (typeof v === 'number' ? seen[b + ${u}] !== NUMS || (v !== num[b + ${u}] || (v === 0 && 1 / v !== 1 / num[b + ${u}])) : seen[b + ${u}] !== v) return true;`);
    const record = names.map((k, u) => `v = o${access(k)}; if (typeof v === 'number') { seen[b + ${u}] = NUMS; num[b + ${u}] = v; } else seen[b + ${u}] = v;`);
    return {
        names,
        objs: [],
        ids: [],
        seen: [],
        num: new Float64Array(1024),
        probe: new Function('o', 'seen', 'num', 'b', 'NUMS', `let v;\n${probe.join('\n')}\nreturn false;`) as GateRegistry['probe'],
        record: new Function('o', 'seen', 'num', 'b', 'NUMS', `let v;\n${record.join('\n')}`) as GateRegistry['record'],
    };
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
    /** Labels of gated classes' child containers (`Class.field`): compared through their gate, streamed hot. */
    private readonly childLabels = new Set<string>();
    private readonly alwaysHot: ReadonlySet<string>;
    /** Hot objects compared every step that are in no registry below (non-gated hot classes, Maps / Sets / plain
     *  hot containers). */
    private hotIds: number[] = [];
    /** Gated hot objects, by class (GateRegistry), and per id its registry (1 + index into gateRegs; 0: none, see
     *  regOf) and entry. */
    private readonly gateRegs: GateRegistry[] = [];
    private readonly gateRegByClass = new Map<string, number>();
    /**
     * Hot arrays (hot containers), densely, with their length at the last compare (−1: invalid). An array that was
     * empty then and is empty now is unchanged without reading its shadow (most ships' explosion lists).
     */
    private arrObjs: (unknown[] | null)[] = [];
    private arrIds: number[] = [];
    private arrLen: Int32Array = new Int32Array(1024);
    /** Per id: its registry (0 none, 1 hot arrays, 2 + g gate registry g) and its entry there. */
    private regOf: Uint8Array = new Uint8Array(1 << 16);
    private regAt: Int32Array = new Int32Array(1 << 16).fill(-1);
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
    /** Diff call number, and per object the call in which touch() / relatedFields last compared it (once per step). */
    private stamp = 0;
    private touchStamp: Int32Array = new Int32Array(1 << 16);
    /** 1: a mixed field of the object went cold since its mixed fields were last sent hot (mixedStreamFields). */
    private mixedCold: Uint8Array = new Uint8Array(1 << 16);
    /** Inside a touch compare (mixed fields go hot). */
    private touching = false;
    /** Called during diff() right after the hot pass (and before the cold slice): the binding's own per-step compares
     *  (touch() / touchId() of the objects the sim processed this step that no gate sees). */
    onHotPass: ((enc: ReplicaEncoder) => void) | null = null;
    /**
     * Called when the round-robin cold pass starts a new cycle, before it compares the cycle's first object (inside
     * diff()): the binding recollects what it keeps outside the graph (the side tables) here, so every cycle compares
     * the values as of its own start. Recollecting at the next diff instead left the objects the new cycle had already
     * compared in the same call (the side root and its tables have low ids) a cycle behind — and a paused game, which
     * stops diffing one full cycle after the last change, then never sent the last values.
     */
    onCycleStart: ((enc: ReplicaEncoder) => void) | null = null;

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
        for (const [name, g] of Object.entries(opts.gates ?? {})) for (const c of g.children) this.childLabels.add(`${name}.${c}`);
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
        let n = this.hotIds.length;
        for (const o of this.arrObjs) if (o !== null) n++;
        for (const r of this.gateRegs) for (const o of r.objs) if (o !== null) n++;
        return n;
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

    /**
     * Compare `o` whole now, outside the cold round-robin, plus (`depth` > 0) the synced objects its fields hold
     * directly (a ship's mission, its queues). For what a player command touched: its effect then travels in the next
     * delta instead of waiting for the cold cycle to reach the object (docs/sim-worker.md §4.3, onApplied). Unknown
     * objects are ignored (they are born when something synced references them). Read-only on the sim, as every
     * compare.
     */
    compareNow(o: object, depth = 1): void {
        const id = this.ids.get(o);
        if (id === undefined) return;
        // A class instance that gained (or lost) an own field since it was shaped — a `declare`d field set lazily,
        // e.g. Empire.constructionBoard / fleetDesigns on the first job / template — gets its new shape (the
        // round-robin pass assumes a class keeps its shape; revalidateShapes is the whole-graph version).
        if (this.kinds[id] === Kind.Class && this.objs[id] !== null && this.shadows[id] !== undefined && this.shapeChanged(id)) this.reshape(id, this.objs[id]!);
        else this.compare(id);
        if (depth <= 0) return;
        const sh = this.shadows[id];
        if (sh === undefined || this.kinds[id] === Kind.Typed) return;
        for (let i = 0; i < sh.length; i++) {
            const v = sh[i];
            if (v !== null && typeof v === 'object') this.compareNow(v as object, depth - 1);
        }
    }

    /**
     * Compare `roots` whole now, and the synced objects they reach, breadth-first, up to `maxDepth` references away
     * and `maxObjects` objects in all (the galaxy / side-table roots are compared but not expanded). Their changes
     * travel in the next delta instead of waiting for the round-robin cold pass: what a player command just changed
     * (its arguments, its result, the issuing empire) or what a screen opening is about to show. Read-only, like every
     * compare. Returns the objects compared.
     */
    compareReach(roots: Iterable<object>, maxObjects = 3000, maxDepth = 3): number {
        const seen = new Set<number>();
        let level: number[] = [];
        for (const r of roots) {
            const id = this.ids.get(r);
            if (id !== undefined && !seen.has(id)) {
                seen.add(id);
                level.push(id);
            }
        }
        let n = 0;
        for (let depth = 0; level.length > 0 && n < maxObjects; depth++) {
            const next: number[] = [];
            for (let i = 0; i < level.length && n < maxObjects; i++) {
                const id = level[i];
                // A class instance that gained (or lost) an own field since it was shaped — a `declare`d field set
                // lazily, e.g. Empire.constructionBoard / fleetDesigns on the first job / template — gets its new shape
                // (the round-robin pass assumes a class keeps its shape; revalidateShapes is the whole-graph version).
                if (this.kinds[id] === Kind.Class && this.objs[id] !== null && this.shadows[id] !== undefined && this.shapeChanged(id)) this.reshape(id, this.objs[id]!);
                else this.compare(id);
                n++;
                if (depth >= maxDepth || id <= 1 || this.kinds[id] === Kind.Typed) continue;
                const sh = this.shadows[id];
                if (sh === undefined) continue;
                for (let k = 0; k < sh.length; k++) {
                    const v = sh[k];
                    if (v === null || typeof v !== 'object') continue;
                    const cid = this.ids.get(v as object);
                    if (cid !== undefined && !seen.has(cid)) {
                        seen.add(cid);
                        next.push(cid);
                    }
                }
            }
            level = next;
        }
        this.flushPending();
        this.stats.coldCompared += n;
        return n;
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
        this.stamp++;
        const hotN = this.hotPass();
        this.stats.hotCompared += hotN;
        if (this.onHotPass !== null) this.onHotPass(this);
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
            if (this.onCycleStart !== null) this.onCycleStart(this);
        } else {
            const minSlice = Math.ceil(cold.length / this.minColdSlices);
            const setsAtCold = this.stats.sets + this.stats.newObjects;
            while (n < cold.length) {
                if (this.coldCursor >= cold.length) {
                    this.coldCursor = 0;
                    this.endCycle();
                    if (this.onCycleStart !== null) this.onCycleStart(this);
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

    /** The per-step compare of every hot object (diff): the gate registries' probes, the hot arrays, the rest.
     *  Returns the objects compared. */
    private hotPass(): number {
        let n = 0;
        for (const r of this.gateRegs) {
            const objs = r.objs;
            const u = r.names.length;
            const probe = r.probe;
            for (let k = 0; k < objs.length; k++) {
                const o = objs[k];
                if (o === null) continue;
                const b = k * u;
                if (!probe(o, r.seen, r.num, b, NUM)) continue;
                this.compareHot(r.ids[k]);
                r.record(o, r.seen, r.num, b, NUM);
                n++;
            }
        }
        const arrs = this.arrObjs;
        for (let k = 0; k < arrs.length; k++) {
            const a = arrs[k];
            if (a === null || (a.length === 0 && this.arrLen[k] === 0)) continue;
            this.compare(this.arrIds[k]);
            this.arrLen[k] = a.length;
            n++;
        }
        const hotIds = this.hotIds;
        for (let i = 0; i < hotIds.length; i++) this.compareHot(hotIds[i]);
        return n + hotIds.length;
    }

    /** Register hot object `id` (idOf): a gated class instance with a gate, a hot array, or the plain hot list. */
    private registerHot(id: number, o: object, kind: Kind, info: ShapeInfo | null): void {
        if (this.opts.hotRegistries === false) {
            this.hotIds.push(id);
            return;
        }
        if (kind === Kind.Array) {
            const k = this.arrObjs.length;
            this.arrObjs.push(o as unknown[]);
            this.arrIds.push(id);
            if (k >= this.arrLen.length) {
                const a = new Int32Array(this.arrLen.length * 2);
                a.set(this.arrLen);
                this.arrLen = a;
            }
            this.arrLen[k] = -1;
            this.regOf[id] = 1;
            this.regAt[id] = k;
            return;
        }
        if (kind === Kind.Class && info !== null && info.gateDiff !== null) {
            const name = this.nameByProto.get(info.proto!)!;
            let g = this.gateRegByClass.get(name);
            if (g === undefined) {
                const gate = this.opts.gates![name].gate;
                const names = [gate, ...info.keys.filter((key, i) => info.ungated[i] === 1 && key !== gate)];
                g = this.gateRegs.length;
                this.gateRegs.push(makeGateRegistry(names));
                this.gateRegByClass.set(name, g);
            }
            const r = this.gateRegs[g];
            const k = r.objs.length;
            r.objs.push(o);
            r.ids.push(id);
            const u = r.names.length;
            for (let x = 0; x < u; x++) r.seen.push(INVALID);
            if ((k + 1) * u > r.num.length) {
                const a = new Float64Array(Math.max(r.num.length * 2, (k + 1) * u));
                a.set(r.num);
                r.num = a;
            }
            this.regOf[id] = 2 + g;
            this.regAt[id] = k;
            return;
        }
        this.hotIds.push(id);
    }

    /** Object `id`'s shadow changed outside its registry's own compare: its registry entry no longer tells. */
    private invalidate(id: number): void {
        const r = this.regOf[id];
        if (r === 0) return;
        const k = this.regAt[id];
        if (r === 1) this.arrLen[k] = -1;
        else {
            const g = this.gateRegs[r - 2];
            g.seen[k * g.names.length] = INVALID;
        }
    }

    /** Drop object `id` from its registry (swept, or reshaped out of its gate). */
    private unregister(id: number): void {
        const r = this.regOf[id];
        if (r === 0) return;
        const k = this.regAt[id];
        if (r === 1) this.arrObjs[k] = null;
        else this.gateRegs[r - 2].objs[k] = null;
        this.regOf[id] = 0;
        this.regAt[id] = -1;
    }

    /** Compact the registries after a sweep. */
    private compactRegistries(): void {
        const objs: (unknown[] | null)[] = [];
        const ids: number[] = [];
        const len = new Int32Array(Math.max(1024, this.arrObjs.length));
        for (let k = 0; k < this.arrObjs.length; k++) {
            const a = this.arrObjs[k];
            if (a === null) continue;
            const id = this.arrIds[k];
            len[objs.length] = this.arrLen[k];
            this.regAt[id] = objs.length;
            objs.push(a);
            ids.push(id);
        }
        this.arrObjs = objs;
        this.arrIds = ids;
        this.arrLen = len;
        for (const r of this.gateRegs) {
            const u = r.names.length;
            const o2: (object | null)[] = [];
            const i2: number[] = [];
            const seen: unknown[] = [];
            const num = new Float64Array(Math.max(1024, r.objs.length * u));
            for (let k = 0; k < r.objs.length; k++) {
                const o = r.objs[k];
                if (o === null) continue;
                const id = r.ids[k];
                const b = o2.length * u;
                for (let x = 0; x < u; x++) {
                    seen.push(r.seen[k * u + x]);
                    num[b + x] = r.num[k * u + x];
                }
                this.regAt[id] = o2.length;
                o2.push(o);
                i2.push(id);
            }
            r.objs = o2;
            r.ids = i2;
            r.seen = seen;
            r.num = num;
        }
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
                this.unregister(id);
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
            this.compactRegistries();
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
            const ts = new Int32Array(n);
            ts.set(this.touchStamp);
            this.touchStamp = ts;
            const mc = new Uint8Array(n);
            mc.set(this.mixedCold);
            this.mixedCold = mc;
            const ro = new Uint8Array(n);
            ro.set(this.regOf);
            this.regOf = ro;
            const ra = new Int32Array(n).fill(-1);
            ra.set(this.regAt);
            this.regAt = ra;
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
        // A gated object's child containers (a ship's weapons and fighters lists) travel hot like the instances in
        // them: a new fighter or weapon is born in the hot stream, so its first hot compare needs no cold part.
        const childList = kind !== Kind.Class && this.childLabels.has(label);
        this.streamOf[id] = (hot || childHot || childList) && !coldStream ? 0 : 1;
        // Born in the stream of the record that referenced it first (the roots: hot).
        if (this.curStream === 1) this.coldBirth[id] = this.seq;
        this.labels[id] = label;
        if (this.profile !== null) {
            const name = `new ${KIND_NAMES[kind]} ${label}`;
            this.profile[name] = (this.profile[name] ?? 0) + 1;
        }
        // Hot containers are compared whole every step; hot-class instances compare their hot slots every step and
        // everything in the cold cycle.
        if (hot) this.registerHot(id, o, kind, kind === Kind.Class ? this.shapes[shape] : null);
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
        if (this.regOf[id] !== 0) this.invalidate(id);
        if (kind === Kind.Typed) {
            // A copy of the same kind (compare reads / writes it by index): compact, and its bytes are outside the JS heap —
            // as Array.from the shadows of a late galaxy's typed arrays were ~100 MB of boxed numbers in the worker's heap
            // (which shares its pointer-compression cage with the page).
            this.shadows[id] = (o as AnyTyped).slice() as unknown as unknown[];
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
        b.codes.push2(header(Op.Fill, vals.length), id);
        for (let i = 0; i < vals.length; i++) this.writeValue(vals[i], id, i, b, 0);
    }

    /** The discovery label of a container found at `slot` of object `owner` (see hotContainers). */
    labelOf(owner: number, slot: number): string {
        const k = this.kinds[owner];
        if (k === Kind.Class || k === Kind.Plain) return `${this.labels[owner]}.${this.shapes[this.shapeOf[owner]].keys[slot]}`;
        if (k === Kind.Map) return `${this.labels[owner]}{}`;
        return `${this.labels[owner]}[]`;
    }

    /** Write value `v` (field / element `slot` of `owner`) as its tag code `key + tag` and its payload (Tag). `key`:
     *  0 for a Fill's values, slot · 16 for a Set pair. */
    private writeValue(v: unknown, owner: number, slot: number, b: RecordWriter, key: number): void {
        const w = this.cur;
        const c = b.codes;
        switch (typeof v) {
            case 'number':
                // The narrowest lane that holds the number exactly (-0 is not an Int: the sign bit is state).
                if ((v >>> 0) === v && (v !== 0 || 1 / v > 0)) c.push2(key + Tag.Int, v);
                else if (Math.fround(v) === v) {
                    F32_BOX[0] = v;
                    c.push2(key + Tag.F32, F32_BITS[0]);
                } else {
                    c.push(key + Tag.Num);
                    b.nums.push(v);
                }
                return;
            case 'string':
                c.push2(key + Tag.Str, w.strs.length);
                w.strs.push(v);
                return;
            case 'boolean':
                c.push(key + (v ? Tag.True : Tag.False));
                return;
            case 'undefined':
                c.push(key + Tag.Undef);
                return;
            case 'object': {
                if (v === null) {
                    c.push(key + Tag.Null);
                    return;
                }
                const known = this.ids.get(v);
                if (known !== undefined) {
                    if (this.markPhase !== MarkPhase.Idle) this.markGrey(known);
                    if (this.curStream === 0) this.noteHotUse(known);
                    c.push2(key + Tag.Ref, known);
                    return;
                }
                const ext = this.opts.externals.get(v);
                if (ext !== undefined) {
                    c.push2(key + Tag.Ext, w.strs.length);
                    w.strs.push(`${ext.kind}:${ext.key}`);
                    return;
                }
                // A new object: its shell goes to this part's shells now, its contents to its births (flushPending).
                const id = this.idOf(v, this.labelOf(owner, slot));
                c.push2(key + Tag.Ref, id);
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
        const slotsOf = (set: ReadonlySet<string> | undefined): number[] => (plain || set === undefined ? [] : keys.flatMap((k, i) => (set.has(`${name}.${k}`) ? [i] : [])));
        const maskOf = (slots: readonly number[]): Uint8Array | null => {
            if (slots.length === 0) return null;
            const m = new Uint8Array(keys.length);
            for (const i of slots) m[i] = 1;
            return m;
        };
        const hotStreamSlots = slotsOf(this.opts.hotStreamFields);
        const mixedSlots = hotClass ? [] : slotsOf(this.opts.mixedStreamFields).filter((i) => !hotStreamSlots.includes(i));
        // Cold-stream fields only mean something for the pinned slots of a fixed hot class (the rest travel cold anyway).
        const coldStreamSlots = fixed ? slotsOf(this.opts.coldStreamFields).filter((i) => pinned[i] === 1) : [];
        // touch() / relatedFields compare: a hot class's hot slots minus its gate (the gate itself must be seen moving by
        // the hot pass, which then compares the children), else a cold class's hot-stream slots.
        const touchSlots = hotClass ? (fixed ? hotSlots.filter((i) => i !== gateSlot) : []) : [...hotStreamSlots, ...mixedSlots].sort((a, b) => a - b);
        const childNames = plain ? undefined : this.opts.touchChildren?.[name];
        // Guarded hot slots (hotFieldGuards): compared hot only while the guard field is ≥ 0.
        let guards: Map<number, string> | undefined;
        if (fixed && this.opts.hotFieldGuards !== undefined) {
            for (const i of hotSlots) {
                const g = this.opts.hotFieldGuards[`${name}.${keys[i]}`];
                if (g !== undefined && keys.includes(g)) (guards ??= new Map()).set(i, g);
            }
        }
        const info: ShapeInfo = {
            id,
            proto,
            keys,
            diff: makeDiffFn(keys, null),
            // Until a cold cycle has seen which fields change, a new (adaptive) hot shape compares everything every step.
            hotDiff: hotClass ? makeDiffFn(keys, fixed ? hotSlots : null, guards) : null,
            hotSlots: hotClass && !fixed ? keys.map((_, i) => i) : hotSlots,
            fixed,
            gateDiff: gateSlot >= 0 ? makeGateFn(keys, ungated, gateSlot) : null,
            childSlots: gateSlot >= 0 ? gate!.children.map((c) => keys.indexOf(c)).filter((i) => i >= 0) : [],
            counts: new Uint32Array(keys.length),
            lastChanged: new Int32Array(keys.length).fill(-1),
            pinned,
            ungated,
            listSlots: gateSlot >= 0 ? (gate!.lists ?? []).map((c) => keys.indexOf(c)).filter((i) => i >= 0) : [],
            hotStream: maskOf(hotStreamSlots),
            mixed: maskOf(mixedSlots),
            mixedSlots,
            coldStream: maskOf(coldStreamSlots),
            touchDiff: touchSlots.length > 0 ? makeDiffFn(keys, touchSlots, guards) : null,
            relatedSlots: slotsOf(this.opts.relatedFields),
            touchChildSlots: childNames === undefined ? [] : childNames.map((c) => keys.indexOf(c)).filter((i) => i >= 0),
        };
        this.shapes.push(info);
        list.push(info);
        this.newShapes.push([id, [plain ? Kind.Plain : Kind.Class, name, ...keys]]);
        return info;
    }

    // --- compare -------------------------------------------------------------------------------------------------

    /** Called by the generated diff functions: field `slot` of object `id` changed from `old` to `v`. */
    emitSet(id: number, slot: number, v: unknown, old: unknown): void {
        if (this.regOf[id] !== 0) this.invalidate(id);
        this.target(id);
        if (this.kinds[id] === Kind.Class) {
            // A fixed-hot-field class's other fields (found by the cold pass) travel cold, and so do its coldStreamFields;
            // hotStreamFields travel hot whatever the object's stream. Each is a fixed choice per shape slot, so each
            // field's updates stay in order.
            const info = this.shapes[this.shapeOf[id]];
            if (info.hotStream !== null && info.hotStream[slot] === 1) {
                this.curStream = 0;
                this.cur = this.parts[0];
            } else if (info.mixed !== null && info.mixed[slot] === 1) {
                // Hot from a touch compare, else cold (and remembered: the next touch re-sends the mixed fields hot).
                const hot = this.touching;
                this.curStream = hot ? 0 : 1;
                this.cur = this.parts[this.curStream];
                if (!hot) this.mixedCold[id] = 1;
            } else if (this.curStream === 0 && ((info.fixed && info.pinned[slot] === 0) || (info.coldStream !== null && info.coldStream[slot] === 1))) {
                this.curStream = 1;
                this.cur = this.parts[1];
            }
        }
        if (this.curStream === 0) this.noteHotUse(id);
        const b = this.cur.body;
        const c = b.codes;
        // Consecutive sets of one object share a Set record: append while nothing else was written to this stream.
        if (b.openId !== id || b.openEnd !== c.n) {
            b.openAt = c.n;
            b.openId = id;
            c.push2(header(Op.Set, 0), id);
        }
        if (slot > MAX_SLOT) throw new Error(`replica sync: slot ${slot} out of range`);
        if (this.markPhase === MarkPhase.Marking) this.greyValue(old);
        this.writeValue(v, id, slot, b, slot * (1 << TAG_BITS));
        c.buf[b.openAt] += 1 << OP_BITS;
        b.openEnd = c.n;
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
            if (info.relatedSlots.length > 0) this.touchRelated(info, sh);
            return;
        }
        if (!info.gateDiff(o as Record<string, unknown>, sh, this, id)) return;
        info.hotDiff!(o as Record<string, unknown>, sh, this, id);
        this.stats.gated++;
        const ids = this.ids;
        for (const slot of info.childSlots) this.compareChild(sh[slot]);
        for (const slot of info.listSlots) {
            const c = sh[slot];
            if (c === null || typeof c !== 'object') continue;
            const cid = ids.get(c as object);
            if (cid !== undefined) this.compare(cid);
        }
        if (info.relatedSlots.length > 0) this.touchRelated(info, sh);
    }

    /** A gated / touched object's child: a container (compared, with the hot-class instances in it) or an instance. */
    private compareChild(c: unknown): void {
        if (c === null || typeof c !== 'object') return;
        const ids = this.ids;
        const cid = ids.get(c as object);
        if (cid === undefined) return;
        if (this.kinds[cid] === Kind.Class) {
            if (this.shapes[this.shapeOf[cid]].hotDiff !== null) this.compareHot(cid);
            return;
        }
        this.compare(cid);
        const csh = this.shadows[cid];
        if (csh === undefined || this.kinds[cid] === Kind.Typed) return;
        for (let i = 0; i < csh.length; i++) {
            const e = csh[i];
            if (e === null || typeof e !== 'object') continue;
            const eid = ids.get(e as object);
            if (eid !== undefined && this.kinds[eid] === Kind.Class && this.shapes[this.shapeOf[eid]].hotDiff !== null) this.compareHot(eid);
        }
    }

    /** relatedFields: touch-compare the objects a just-compared object refers to (its shadow, now current). */
    private touchRelated(info: ShapeInfo, sh: unknown[]): void {
        for (const slot of info.relatedSlots) {
            const t = sh[slot];
            if (t === null || typeof t !== 'object') continue;
            const tid = this.ids.get(t as object);
            if (tid !== undefined) this.touchCompare(tid, false);
        }
    }

    /** Compare an object's touch slots (once per step), and with `children` its touchChildren. */
    private touchCompare(id: number, children: boolean): void {
        if (this.kinds[id] !== Kind.Class || this.touchStamp[id] === this.stamp) return;
        const o = this.objs[id];
        const sh = this.shadows[id];
        if (o === null || sh === undefined) return;
        this.touchStamp[id] = this.stamp;
        const info = this.shapes[this.shapeOf[id]];
        if (info.touchDiff !== null) {
            this.touching = true;
            try {
                info.touchDiff(o as Record<string, unknown>, sh, this, id);
                if (this.mixedCold[id] === 1) {
                    // A mixed field went cold since the last hot send and may still be queued on the main thread:
                    // send them all hot now (the decoder then drops the older cold sets), so this touch's view of the
                    // object is complete.
                    this.mixedCold[id] = 0;
                    for (const slot of info.mixedSlots) this.emitSet(id, slot, sh[slot], sh[slot]);
                }
            } finally {
                this.touching = false;
            }
        }
        if (children) for (const slot of info.touchChildSlots) this.compareChild(sh[slot]);
    }

    /**
     * The sim may have changed `o` this step though no gate sees it (a habitat firing its giant ion cannon, the player's
     * system visibility): compare its touch slots now (a cold class's hot-stream and mixed fields, a fixed hot class's
     * hot fields), and its
     * touchChildren with the hot-class instances in them. Only from onHotPass (inside diff()).
     */
    touch(o: object): void {
        const id = this.ids.get(o);
        if (id !== undefined) this.touchCompare(id, true);
    }

    /** touch() by sync id (a binding that caches ids of objects it touches every step). */
    touchId(id: number): void {
        if (id >= 0 && id < this.objs.length) this.touchCompare(id, true);
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
                    this.cur.body.codes.push3(header(Op.Len, 0), id, n);
                    if (this.regOf[id] !== 0) this.invalidate(id);
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
                    w.body.codes.push3(header(Op.Typed, 0), id, w.typed.length);
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
        // A gate registry entry probes by field name; one whose new shape has no gate is compared in full every step.
        if (this.regOf[id] >= 2 && info.gateDiff === null) {
            this.unregister(id);
            this.hotIds.push(id);
        }
        this.target(id);
        this.cur.body.codes.push3(header(Op.Reshape, 0), id, info.id);
        this.writeContents(id);
        this.stats.sets++;
    }

    /**
     * Re-check every class instance's own field list (fields added or removed after construction; rare). The compare
     * passes assume a class instance keeps its shape. Tools / tests; returns the objects reshaped.
     */
    /** Whether class instance `id`'s own field list differs from its shape's. */
    private shapeChanged(id: number): boolean {
        const o = this.objs[id]!;
        const info = this.shapes[this.shapeOf[id]];
        const keys = this.keysOf(o, info.proto);
        if (keys.length !== info.keys.length) return true;
        for (let i = 0; i < keys.length; i++) if (keys[i] !== info.keys[i]) return true;
        return false;
    }

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
 *  see the file header); a slot in `guards` is compared only while that guard field is ≥ 0 (hotFieldGuards). */
function makeDiffFn(keys: readonly string[], slots: readonly number[] | null, guards?: ReadonlyMap<number, string>): DiffFn {
    const access = (k: string): string => (/^[A-Za-z_$][\w$]*$/.test(k) ? `.${k}` : `[${JSON.stringify(k)}]`);
    const which = slots ?? keys.map((_, i) => i);
    const lines = which.map((i) => {
        const line = `v = o${access(keys[i])}; w = s[${i}]; if (v !== w ? v === v || w === w : v === 0 && 1 / v !== 1 / w) { s[${i}] = v; enc.emitSet(id, ${i}, v, w); }`;
        const g = guards?.get(i);
        return g === undefined ? line : `if (o${access(g)} >= 0) { ${line} }`;
    });
    try {
        return new Function('o', 's', 'enc', 'id', `let v, w;\n${lines.join('\n')}`) as DiffFn;
    } catch {
        return (o, s, enc, id) => {
            for (const i of which) {
                const g = guards?.get(i);
                if (g !== undefined && !((o[g] as number) >= 0)) continue;
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
    /** The encoder's mixedStreamFields (`Class.field`): a queued cold set of one of them older than the object's last
     *  hot set of one of them is dropped. */
    mixedFields?: ReadonlySet<string>;
}

interface DecShape {
    kind: Kind;
    proto: object | null;
    keys: string[];
    /** Slots of mixedFields (null: none). */
    mixed: Uint8Array | null;
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
    /** Cold parts applied by this call (the per-frame pump, or all of them for a full apply). */
    coldParts: number;
    /** Cold parts whose births alone a hot part's dependency applied ahead of the pump. */
    bornParts: number;
    /**
     * apply() with a budget: the delta's hot part is not applied yet — the births of the cold parts it depends on did
     * not fit (they continue at the next call with the same delta; until then its newborns are unreferenced shells).
     */
    pending: boolean;
}

function emptyApplyStats(): ApplyStats {
    return { applyMs: 0, newObjects: 0, sets: 0, drops: 0, coldParts: 0, bornParts: 0, pending: false };
}

/** A cold part queued on the main thread, applied in order, possibly over several frames. */
interface QueuedPart {
    seq: number;
    part: ReplicaPart;
    /** 0 shells, 1 births, 2 body, 3 drops. */
    phase: number;
    /** Index into the phase's code stream, and into its f64 lane. */
    i: number;
    j: number;
}

/** A delta whose hot part waits for the births of the cold parts it depends on (apply with a budget). */
interface StagedDelta {
    d: ReplicaDelta;
    /** Objects created so far (onNewObject runs once the hot part is applied). */
    fresh: object[];
    /** Its own cold part is queued already (a dependency on its own births). */
    ownQueued: boolean;
}

/** Cold-pump budget multiplier for `queued` parts waiting: ×1 up to 2 parts, +0.5 per part beyond, at most ×8 — the
 *  pump keeps up with what the worker sends with a short queue (a command reply waits for the queue: §3.3). */
export function coldPumpScale(queued: number): number {
    return Math.min(8, 1 + Math.max(0, queued - 2) * 0.5);
}

export class ReplicaDecoder {
    /** By sync id. Kept dense (filled with null ahead of the ids not born here yet: a cold part's newborns arrive after
     *  a later hot part's), so the array never turns sparse (a dictionary-mode array made every lookup a hash probe). */
    private objs: (object | null)[] = [];
    private kinds: Uint8Array = new Uint8Array(1 << 16);
    private shapeOf: Int32Array = new Int32Array(1 << 16);
    private readonly shapes: DecShape[] = [];
    /** Replica object → sync id. A Map, not a WeakMap: entries are deleted with their drop anyway, and at 2.4 M keys a
     *  WeakMap insert cost ~5 µs with GC stalls up to a second under churn (a Map: ~0.2 µs; growing it rehashes, ~20 ms
     *  once per million or so births). */
    private readonly idByObj = new Map<object, number>();
    private readonly coldQueue: QueuedPart[] = [];
    /** Mixed fields: per object, the seq of the last hot part that set one of them. */
    private readonly mixedHotSeq = new Map<number, number>();
    /** Seq of the last cold part applied completely. */
    private coldApplied = -1;
    /** Seq of the last cold part whose shells and births are applied (≥ coldApplied: a hot part's dependency applies
     *  only those, see apply). */
    private coldBorn = -1;
    /** The delta being applied over several calls (apply with a budget), else null. */
    private staged: StagedDelta | null = null;
    private readonly scratch: unknown[] = [];
    /** Where the last bodyOf stopped in the f64 lane. */
    private numsAt = 0;
    /** Called with each new object once it is filled (e.g. to wire a new Empire's visibility hooks). */
    onNewObject: ((o: object) => void) | null = null;
    /** Dev-only (writeDetector.ts, docs/sim-worker.md §9 chunk 0): called with an object's id right before each shell /
     *  record that creates or changes it, so the detector can check it against the values last applied; `slot` is the
     *  shape slot of a class / plain object's field set (fieldName), -1 for any other record. Null: off. */
    watch: ((id: number, slot: number) => void) | null = null;
    private stats: ApplyStats = emptyApplyStats();

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

    /** Whether a delta's hot part is waiting for its dependencies' births (apply with a budget returned pending). */
    get applying(): boolean {
        return this.staged !== null;
    }

    /** Whether every cold part up to delta `seq`'s is applied completely (what a command reply needs, §4.3). */
    coldThrough(seq: number): boolean {
        return this.coldQueue.length === 0 || this.coldQueue[0].seq > seq;
    }

    /**
     * Apply a delta: its shapes, its hot part now (after the births of the cold parts it depends on), and queue its
     * cold part — or apply everything now with `all` (the snapshot, tests, a save). With a finite `budgetMs`, the births
     * of the cold parts the hot part depends on are applied for up to that long; when they do not fit, the call returns
     * with `pending` and the next call with the same delta continues (nothing references the newborns until the hot
     * body is applied, so readers never see a half-filled object; the pump waits meanwhile). Returns this call's stats.
     */
    apply(d: ReplicaDelta, all = false, now: () => number = () => performance.now(), budgetMs = Infinity): ApplyStats {
        const t0 = now();
        this.stats = emptyApplyStats();
        let st = this.staged;
        if (st !== null && st.d !== d) throw new Error(`replica sync: delta ${d.seq} applied while delta ${st.d.seq} is still being applied`);
        if (st === null) {
            for (const [id, shape] of d.shapes) this.addShape(id, shape);
            st = { d, fresh: [], ownQueued: false };
            this.shellsOf(d.hot, 0, Infinity, st.fresh, now);
            // The hot part names objects born in cold parts up to coldDep (possibly this delta's own). Only their births
            // are needed (shells, then the newborns' first contents): the bodies — sets on objects that already existed —
            // stay queued for the pump, so a dependency costs the births it needs, not whole parts.
            if (d.coldDep >= 0 && d.coldDep > this.coldBorn && d.coldDep >= d.seq) {
                this.coldQueue.push({ seq: d.seq, part: d.cold, phase: 0, i: 0, j: 0 });
                st.ownQueued = true;
            }
            this.staged = st;
        }
        if (d.coldDep >= 0 && d.coldDep > this.coldBorn) {
            const deadline = budgetMs === Infinity || all ? Infinity : t0 + budgetMs;
            if (!this.bornUntil(d.coldDep, st.fresh, deadline, now)) {
                this.stats.pending = true;
                this.stats.applyMs = now() - t0;
                return this.stats;
            }
        }
        this.staged = null;
        this.numsAt = 0;
        this.bodyOf(d.hot, d.hot.births, d.hot.birthNums, 0, Infinity, now, false, d.seq, true);
        this.numsAt = 0;
        this.bodyOf(d.hot, d.hot.body, d.hot.bodyNums, 0, Infinity, now, false, d.seq, true);
        if (!st.ownQueued) {
            if (!partEmpty(d.cold)) this.coldQueue.push({ seq: d.seq, part: d.cold, phase: 0, i: 0, j: 0 });
            else if (this.coldQueue.length === 0) this.coldApplied = this.coldBorn = d.seq;
        }
        if (all) this.pumpColdUntil(Infinity, st.fresh, now);
        if (this.onNewObject !== null) for (const o of st.fresh) this.onNewObject(o);
        this.stats.applyMs = now() - t0;
        return this.stats;
    }

    /**
     * Apply queued cold parts, in order, for up to `budgetMs` (a part may be left half-applied and resumed). The budget
     * grows with the backlog (coldPumpScale; `scale` false: exactly `budgetMs`), so the replica's cold data never falls
     * far behind. With `throughSeq`, only the parts up to that delta's (what a command reply waits for). While a delta's
     * hot part waits for its dependencies' births (apply with a budget), nothing is pumped: those births come first.
     */
    pumpCold(budgetMs: number, now: () => number = () => performance.now(), throughSeq = Infinity, scale = true): ApplyStats {
        const t0 = now();
        this.stats = emptyApplyStats();
        if (this.staged !== null) return this.stats;
        if (scale) budgetMs *= coldPumpScale(this.coldQueue.length);
        const fresh: object[] = [];
        const deadline = t0 + budgetMs;
        while (this.coldQueue.length > 0 && this.coldQueue[0].seq <= throughSeq) {
            if (!this.advance(this.coldQueue[0], deadline, fresh, now)) break;
            this.partDone(this.coldQueue.shift()!.seq);
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
            this.partDone(this.coldQueue.shift()!.seq);
            this.stats.coldParts++;
        }
    }

    private partDone(seq: number): void {
        this.coldApplied = seq;
        if (seq > this.coldBorn) this.coldBorn = seq;
    }

    /**
     * Apply the shells and births of the queued cold parts up to `seq`, in order, leaving their bodies and drops to the
     * pump, until `deadline` (false: not done, continue later). Safe out of order with those bodies: a part's births
     * only fill objects born in it (with what it and the parts before it know), and a body only sets fields of objects
     * that existed before its part.
     */
    private bornUntil(seq: number, fresh: object[], deadline: number, now: () => number): boolean {
        for (const q of this.coldQueue) {
            if (q.seq > seq) break;
            if (q.phase === 0) {
                q.i = this.shellsOf(q.part, q.i, deadline, fresh, now);
                if (q.i < q.part.shells.length) return false;
                q.phase = 1;
                q.i = q.j = 0;
            }
            if (q.phase === 1) {
                this.numsAt = q.j;
                q.i = this.bodyOf(q.part, q.part.births, q.part.birthNums, q.i, deadline, now, true, q.seq, false);
                q.j = this.numsAt;
                if (q.i < q.part.births.length) return false;
                q.phase = 2;
                q.i = q.j = 0;
                this.stats.bornParts++;
            }
            if (q.seq > this.coldBorn) this.coldBorn = q.seq;
        }
        return true;
    }

    /** Continue a queued part until done (true) or the deadline (false). */
    private advance(q: QueuedPart, deadline: number, fresh: object[], now: () => number): boolean {
        if (q.phase === 0) {
            q.i = this.shellsOf(q.part, q.i, deadline, fresh, now);
            if (q.i < q.part.shells.length) return false;
            q.phase = 1;
            q.i = q.j = 0;
        }
        if (q.phase === 1) {
            this.numsAt = q.j;
            q.i = this.bodyOf(q.part, q.part.births, q.part.birthNums, q.i, deadline, now, true, q.seq, false);
            q.j = this.numsAt;
            if (q.i < q.part.births.length) return false;
            q.phase = 2;
            q.i = q.j = 0;
        }
        if (q.phase === 2) {
            this.numsAt = q.j;
            q.i = this.bodyOf(q.part, q.part.body, q.part.bodyNums, q.i, deadline, now, false, q.seq, false);
            q.j = this.numsAt;
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

    /** Room for sync id `id`: `objs` filled densely with null up to it, the per-id typed arrays grown. */
    private reserve(id: number): void {
        const objs = this.objs;
        while (objs.length <= id) objs.push(null);
        if (id >= this.kinds.length) {
            const n = Math.max(this.kinds.length * 2, id + 1);
            const k = new Uint8Array(n);
            k.set(this.kinds);
            this.kinds = k;
            const sh = new Int32Array(n);
            sh.set(this.shapeOf);
            this.shapeOf = sh;
        }
    }

    /** Create the shells of a part from index `i` (every new object exists before any reference to it resolves). */
    private shellsOf(p: ReplicaPart, i: number, deadline: number, fresh: object[], now: () => number): number {
        const sh = p.shells;
        let k = 0;
        const every = this.opts.sliceRecords ?? 32;
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
                    if (id >= this.shapeOf.length) this.reserve(id);
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
            if (id >= this.objs.length) this.reserve(id);
            this.objs[id] = o;
            this.kinds[id] = kind;
            this.idByObj.set(o, id);
            if (this.watch !== null) this.watch(id, -1);
            fresh.push(o);
            this.stats.newObjects++;
            if (++k % every === 0 && deadline !== Infinity && now() >= deadline) break;
        }
        return i;
    }

    /**
     * Apply the records of a part's births / body stream (`c`, its f64 lane `nums` from this.numsAt) from code index
     * `start`; returns where it stopped (the end when done; this.numsAt: the lane's position). `anywhere`: may stop
     * between any two records (the births stream), else only between objects. `seq` / `hot`: the delta and stream of the
     * part (mixed fields: a hot set is remembered, an older cold one dropped).
     */
    private bodyOf(p: ReplicaPart, c: Uint32Array, nums: Float64Array, start: number, deadline: number, now: () => number, anywhere: boolean, seq: number, hot: boolean): number {
        const mixedHot = this.mixedHotSeq;
        const strs = p.strs;
        const ext = this.opts.externals;
        const objs = this.objs;
        const kinds = this.kinds;
        const shapeOf = this.shapeOf;
        const shapes = this.shapes;
        let i = start;
        let j = this.numsAt;
        let k = 0;
        const every = this.opts.sliceRecords ?? 64;
        let nextCheck = every;
        // A value's payload, after its tag (wire format: Tag).
        const payload = (tag: number): unknown => {
            switch (tag) {
                case Tag.Num:
                    return nums[j++];
                case Tag.Int:
                    return c[i++];
                case Tag.F32:
                    F32_BITS[0] = c[i++];
                    return F32_BOX[0];
                case Tag.Ref: {
                    const id = c[i++];
                    const o = objs[id];
                    if (o == null) throw new Error(`replica sync: reference to unknown id ${id}`);
                    return o;
                }
                case Tag.Str:
                    return strs[c[i++]];
                case Tag.True:
                    return true;
                case Tag.False:
                    return false;
                case Tag.Null:
                    return null;
                case Tag.Undef:
                    return undefined;
                case Tag.Ext: {
                    const key = strs[c[i++]];
                    const o = ext.get(key);
                    if (o === undefined) throw new Error(`replica sync: unknown static ${key}`);
                    return o;
                }
            }
            throw new Error(`replica sync: bad value tag ${tag}`);
        };
        const scratch = this.scratch;
        const watch = this.watch;
        while (i < c.length) {
            const h = c[i];
            const op = h & ((1 << OP_BITS) - 1);
            const n = h >>> OP_BITS;
            const id = c[i + 1];
            i += 2;
            const o = objs[id];
            if (o == null) throw new Error(`replica sync: op ${op} on unknown id ${id}`);
            switch (op) {
                case Op.Set: {
                    const kind = kinds[id];
                    if (kind === Kind.Array) {
                        if (watch !== null) watch(id, -1);
                        const a = o as unknown[];
                        for (let x = 0; x < n; x++) {
                            const key = c[i++];
                            a[key >>> TAG_BITS] = payload(key & ((1 << TAG_BITS) - 1));
                        }
                    } else {
                        const shape = shapes[shapeOf[id]];
                        const mixed = shape.mixed;
                        for (let x = 0; x < n; x++) {
                            const key = c[i++];
                            const slot = key >>> TAG_BITS;
                            if (watch !== null) watch(id, slot);
                            const v = payload(key & ((1 << TAG_BITS) - 1));
                            if (mixed !== null && mixed[slot] === 1) {
                                if (hot) mixedHot.set(id, seq);
                                else {
                                    // A cold set older than the object's last hot send of its mixed fields: superseded.
                                    const hs = mixedHot.get(id);
                                    if (hs !== undefined && hs > seq) continue;
                                }
                            }
                            shape.set(o as Record<string, unknown>, slot, v);
                        }
                    }
                    this.stats.sets += n;
                    break;
                }
                case Op.Fill: {
                    if (watch !== null) watch(id, -1);
                    const kind = kinds[id];
                    if (kind === Kind.Class || kind === Kind.Plain) {
                        scratch.length = n;
                        for (let x = 0; x < n; x++) scratch[x] = payload(c[i++]);
                        shapes[shapeOf[id]].fill(o as Record<string, unknown>, scratch);
                    } else if (kind === Kind.Array) {
                        const a = o as unknown[];
                        a.length = n;
                        for (let x = 0; x < n; x++) a[x] = payload(c[i++]);
                    } else if (kind === Kind.Map) {
                        const m = o as Map<unknown, unknown>;
                        m.clear();
                        for (let x = 0; x < n; x += 2) {
                            const key = payload(c[i++]);
                            m.set(key, payload(c[i++]));
                        }
                    } else if (kind === Kind.Set) {
                        const st = o as Set<unknown>;
                        st.clear();
                        for (let x = 0; x < n; x++) st.add(payload(c[i++]));
                    }
                    break;
                }
                case Op.Len:
                    if (watch !== null) watch(id, -1);
                    (o as unknown[]).length = c[i++];
                    break;
                case Op.Typed:
                    if (watch !== null) watch(id, -1);
                    (o as AnyTyped).set(p.typed[c[i++]] as never);
                    this.stats.sets++;
                    break;
                case Op.Reshape: {
                    if (watch !== null) watch(id, -1);
                    const s = c[i++];
                    const old = shapes[shapeOf[id]];
                    // Drop every old field: the Fill that follows re-adds them in the new shape's order (key order is
                    // state — a plain object's keys are saved in order).
                    for (const key of old.keys) delete (o as Record<string, unknown>)[key];
                    shapeOf[id] = s;
                    break;
                }
                default:
                    throw new Error(`replica sync: bad op ${op}`);
            }
            // Stop only between objects (never between an array's new length and its element sets), so a half-applied
            // cold part never shows a half-updated object.
            k++;
            if (deadline !== Infinity && k >= nextCheck && i < c.length && (anywhere || c[i + 1] !== id)) {
                nextCheck = k + every;
                if (now() >= deadline) break;
            }
        }
        this.numsAt = j;
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
        const dec = makeDecShape(kind, proto, keys, proto === null ? undefined : this.opts.revive?.get(proto));
        const mixedFields = this.opts.mixedFields;
        if (mixedFields !== undefined && kind === Kind.Class && keys.some((k) => mixedFields.has(`${name}.${k}`))) {
            const m = new Uint8Array(keys.length);
            keys.forEach((k, i) => {
                if (mixedFields.has(`${name}.${k}`)) m[i] = 1;
            });
            dec.mixed = m;
        }
        this.shapes[id] = dec;
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
    return { kind, proto, keys, mixed: null, ctor, fill, set };
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
        out.push(p.shells.buffer as ArrayBuffer, p.births.buffer as ArrayBuffer, p.birthNums.buffer as ArrayBuffer, p.body.buffer as ArrayBuffer, p.bodyNums.buffer as ArrayBuffer);
        for (const t of p.typed) if (!out.includes(t.buffer as ArrayBuffer)) out.push(t.buffer as ArrayBuffer);
    }
    return out;
}

export type { Encoded };
