// Sim worker: the dev-only replica WRITE DETECTOR (docs/sim-worker.md §9 chunk 0).
//
// In worker mode the main thread's sim objects are a read-only replica (§4.2): a main-thread write to one is never
// seen by the worker and is overwritten by the next sync of that field (or never, if the worker's value does not
// change). The audit (sim-worker-consumer-audit.md §4) lists the writes it found by reading the code; this finds the
// rest at run time, the indirect ones included (a sim query the UI calls that caches onto an object, an RNG draw, ...).
//
// How it works (on the main thread, only when asked for: `?simWorker=1&detectWrites=1`, or a test installing it):
// - MIRROR. For every replica object the detector keeps the values the decoder last applied: a class instance's or
//   plain object's own enumerable keys and values, an array's elements, a Map's entries, a Set's items, a typed
//   array's contents (compared with SameValue).
// - CHECK ON SYNC. The decoder calls `watch(id)` right before each record that changes an object
//   (replicaSync.ts ReplicaDecoder.watch). The first time an object is touched in an apply / pump, the detector
//   compares it with its mirror: any difference was made by someone else, on the main thread. At the end of the apply
//   or pump, the mirrors of the touched objects are refreshed.
// - SWEEP. Objects the sync never touches again (the worker's value did not change) are compared round-robin at the
//   start of every cold pump, under a small time budget (`sweepBudgetMs`), and all at once by `checkAll()`.
// - TRAPS (stack traces). A compare tells WHAT was written, not WHO. Once a key is found, the detector arms a trap on
//   it (`autoTrap`, on by default): the field becomes an accessor on every live and future replica object with that
//   label, and container labels get their mutator methods (push / splice / set / add / ...) watched, so the NEXT write
//   reports its stack. `trapAll` arms everything from the start (stack on the first write; heavy — every field of every
//   object becomes an accessor). Index writes `a[i] = v` and key additions / deletions cannot be trapped: those are
//   found by the compare only.
// - Writes made while the replica applies a delta (the decoder, GalaxyReplica.afterApply's static wiring and side
//   tables) are the sync's own and never reported. Intended client-side state is listed in REPLICA_WRITE_ALLOW.
//
// Keys: `Class.field` for a class instance's field (class names from the save registry), `<label>.field` for a plain
// object's, `<label>[]` for an array (element, length or a mutator), `<label>{}` for a Map / Set, `<label>#` for a
// typed array. A container's label is where it was first found: `Class.field`, `<label>[]` (an element), `<label>{}`
// (a Map value / Set item), `<label>{key}` (a Map key); the side-tables root is `sideTables`.
//
// The detector only reads the replica (and, with traps armed, moves armed fields behind accessors that read and write
// the same values); with it off nothing changes: the decoder's `watch` is null. No DOM / Pixi imports.

import type { ApplyStats, ReplicaDecoder, ReplicaDelta } from './replicaSync';
import { replicaCodecOptions } from '../sim/save/galaxySave';

/** How a write was found: by the compare when the sync touched the object, by the sweep, or by a trap (with stack). */
export type WriteHow = 'sync' | 'sweep' | 'trap';

export interface ReplicaWrite {
    /** `Class.field`, `<label>.field`, `<label>[]`, `<label>{}` or `<label>#` (see the header). */
    key: string;
    /** Writes found (a compare counts one per object and check; a trap one per write). */
    count: number;
    /** How it was first found, and how often each way. */
    how: WriteHow;
    byHow: Record<WriteHow, number>;
    /** The first finding, e.g. `#123 Empire: 5 → 7`, `#88 Empire.messageHistory: push`. */
    detail: string;
    /** The first trapped write's stack (null until a trap caught one). */
    stack: string | null;
    /** On the allow-list (intended client-side state): counted, not warned. */
    allowed: boolean;
}

/**
 * Intended client-side state: main-thread writes to replica objects that are correct by design (the worker never
 * needs them, and the sync overwriting them is harmless). Every entry needs a reason. A key is allowed when it is
 * listed, or when its label (the part before the last `.field` / `[]` / `{}` / `#`) is listed with `.*`.
 */
export const REPLICA_WRITE_ALLOW: ReadonlyMap<string, string> = new Map<string, string>([
    // (filled from the smoke runs; see docs/sim-worker.md §9 chunk 0 for the findings)
]);

export interface WriteDetectorOptions {
    /** Class name → prototype (the save registry; names the class instances in keys). */
    classes: Record<string, object>;
    /** Allowed keys (default REPLICA_WRITE_ALLOW's). */
    allow?: Iterable<string>;
    /** Arm a trap on a key once a compare finds it, so its next write reports a stack (default true). */
    autoTrap?: boolean;
    /** Trap every field and container from the start (stack on the first write; slow, heavy). */
    trapAll?: boolean;
    /** Sweep budget per cold pump, wall ms (default 0.25; 0: no sweep). */
    sweepBudgetMs?: number;
    /** Most objects swept per cold pump (default unlimited; tests). */
    sweepMax?: number;
    now?: () => number;
    /** Called once per new, not-allowed key (default console.warn). */
    warn?: (w: ReplicaWrite) => void;
}

/** What the detector wraps: the replica's decoder and its apply / pump entry points (GalaxyReplica's shape). */
export interface WatchedReplica {
    readonly decoder: ReplicaDecoder;
    apply(d: ReplicaDelta, all?: boolean): ApplyStats;
    pumpCold(budgetMs: number): ApplyStats;
}

const enum MK {
    Obj = 0,
    Arr = 1,
    Map = 2,
    Set = 3,
    Typed = 4,
}

interface Mirror {
    kind: MK;
    /** Obj: own enumerable keys (Object.keys order); else null. */
    keys: string[] | null;
    /** Obj: values in `keys` order (PENDING: being set by the sync in this apply); Arr / Set / Typed: elements;
     *  Map: [k, v, k, v, ...]. */
    vals: unknown[];
}

/** A mirror value the sync is setting in the current apply (refreshed when it ends). */
const PENDING = Symbol('pending');

type AnyTyped = Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array | Uint8ClampedArray;

const STORE = Symbol('replicaWriteTrap');

// Container traps: the mutator methods are patched once (while any detector arms a container) and check a WeakMap of
// trapped containers. Reads are not patched.
const ARRAY_MUTATORS = ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin'] as const;
const MAP_MUTATORS = ['set', 'delete', 'clear'] as const;
const SET_MUTATORS = ['add', 'delete', 'clear'] as const;
const TYPED_MUTATORS = ['set', 'fill', 'copyWithin', 'sort', 'reverse'] as const;
const trappedContainers = new WeakMap<object, ReplicaWriteDetector>();
let patchCount = 0;
const patchedOriginals: [object, string, unknown][] = [];

function patchContainerMutators(): void {
    if (patchCount++ > 0) return;
    const typedProto = Object.getPrototypeOf(Int8Array.prototype) as object;
    const groups: [object, readonly string[]][] = [
        [Array.prototype, ARRAY_MUTATORS],
        [Map.prototype, MAP_MUTATORS],
        [Set.prototype, SET_MUTATORS],
        [typedProto, TYPED_MUTATORS],
    ];
    for (const [proto, names] of groups) {
        for (const name of names) {
            const desc = Object.getOwnPropertyDescriptor(proto, name)!;
            const orig = desc.value as (...a: unknown[]) => unknown;
            patchedOriginals.push([proto, name, orig]);
            const patched = function (this: object): unknown {
                // eslint-disable-next-line prefer-rest-params
                const r = orig.apply(this, arguments as unknown as unknown[]);
                const d = trappedContainers.get(this);
                if (d !== undefined) d.containerTrapped(this, name);
                return r;
            };
            Object.defineProperty(proto, name, { ...desc, value: patched });
        }
    }
}

function unpatchContainerMutators(): void {
    if (patchCount === 0 || --patchCount > 0) return;
    for (const [proto, name, orig] of patchedOriginals) {
        const desc = Object.getOwnPropertyDescriptor(proto, name)!;
        Object.defineProperty(proto, name, { ...desc, value: orig });
    }
    patchedOriginals.length = 0;
}

export class ReplicaWriteDetector {
    private readonly mirrors: (Mirror | undefined)[] = [];
    private readonly classNames = new Map<object, string>();
    /** Where a non-class object was first found: [parent, suffix]. */
    private readonly parentOf = new WeakMap<object, [object, string]>();
    private readonly labelOverride = new WeakMap<object, string>();
    private readonly found = new Map<string, ReplicaWrite>();
    private readonly allow: Set<string>;
    /** Objects touched whole (any record but a field set) in this apply, and their epoch mark. */
    private readonly touched: number[] = [];
    private readonly touchMark: number[] = [];
    /** Fields set by the sync in this apply (objects not touched whole): [id, mirror index] pairs, marked PENDING. */
    private readonly pending: number[] = [];
    /** Whether snap() records parent links (labels of non-class objects); turned on by the first label needed. */
    private linksLive = false;
    private readonly labelCache = new WeakMap<object, string>();
    private epoch = 1;
    /** > 0 while the replica applies a delta (the sync's own writes). */
    private depth = 0;
    private sweepCursor = 0;
    private readonly autoTrap: boolean;
    private readonly trapAll: boolean;
    private readonly sweepBudgetMs: number;
    private readonly sweepMax: number;
    private readonly now: () => number;
    private readonly warn: (w: ReplicaWrite) => void;
    /** Armed object labels → field names, and armed container labels. */
    private readonly armedFields = new Map<string, Set<string>>();
    private readonly armedContainers = new Set<string>();
    /** Whether an armed field label is a plain object's (not a class name). */
    private armedPlain = false;
    private readonly classNameSet = new Set<string>();
    private patched = false;
    private readonly accessors = new Map<string, PropertyDescriptor>();
    private readonly restore: (() => void)[] = [];
    private disposed = false;

    constructor(
        private readonly replica: WatchedReplica,
        opts: WriteDetectorOptions,
    ) {
        for (const [name, proto] of Object.entries(opts.classes)) {
            if (!this.classNames.has(proto)) this.classNames.set(proto, name);
            this.classNameSet.add(name);
        }
        this.allow = new Set(opts.allow ?? REPLICA_WRITE_ALLOW.keys());
        this.autoTrap = opts.autoTrap ?? true;
        this.trapAll = opts.trapAll ?? false;
        this.sweepBudgetMs = opts.sweepBudgetMs ?? 0.25;
        this.sweepMax = opts.sweepMax ?? Infinity;
        this.now = opts.now ?? (() => performance.now());
        this.warn = opts.warn ?? defaultWarn;
        const dec = replica.decoder;
        const side = dec.object(1);
        if (side !== null) this.labelOverride.set(side, 'sideTables');
        if (this.trapAll) this.ensurePatched();
        // Everything the replica holds now (the snapshot) is the sync's.
        const all: number[] = [];
        for (let id = 0; id < dec.idLimit; id++) if (dec.object(id) !== null) all.push(id);
        this.refreshAll(all);
        // Wrap the replica's entry points (instance properties shadow the prototype methods; dispose removes them).
        const r = replica as { apply: WatchedReplica['apply']; pumpCold: WatchedReplica['pumpCold'] };
        const apply = r.apply;
        const pump = r.pumpCold;
        r.apply = (d, all2) => this.during(() => apply.call(replica, d, all2));
        r.pumpCold = (budgetMs) => {
            this.sweep();
            return this.during(() => pump.call(replica, budgetMs));
        };
        // The decoder itself too (callers that bypass the replica wrapper, tests).
        const dr = dec as { apply: ReplicaDecoder['apply']; pumpCold: ReplicaDecoder['pumpCold'] };
        const dApply = dr.apply;
        const dPump = dr.pumpCold;
        dr.apply = (d, all2, now) => this.during(() => dApply.call(dec, d, all2, now));
        dr.pumpCold = (b, now) => this.during(() => dPump.call(dec, b, now));
        dec.watch = (id, slot) => this.watch(id, slot);
        this.restore.push(() => {
            delete (r as Partial<typeof r>).apply;
            delete (r as Partial<typeof r>).pumpCold;
            delete (dr as Partial<typeof dr>).apply;
            delete (dr as Partial<typeof dr>).pumpCold;
            dec.watch = null;
        });
    }

    // -----------------------------------------------------------------------------------------------------------
    // Findings
    // -----------------------------------------------------------------------------------------------------------

    /** Every key found so far (not-allowed first, then by key). */
    writes(): ReplicaWrite[] {
        return [...this.found.values()].sort((a, b) => Number(a.allowed) - Number(b.allowed) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    }

    /** Not-allowed keys found so far. */
    unexpected(): ReplicaWrite[] {
        return this.writes().filter((w) => !w.allowed);
    }

    /** Forget the findings (mirrors and armed traps stay). */
    reset(): void {
        this.found.clear();
    }

    /** One line per key: `key ×count (how) detail`, then the first stack line outside this file. */
    summary(): string {
        return this.writes()
            .map((w) => `${w.allowed ? '(allowed) ' : ''}${w.key} ×${w.count} [${Object.entries(w.byHow).filter(([, n]) => n > 0).map(([h, n]) => `${h} ${n}`).join(', ')}] ${w.detail}${w.stack !== null ? `\n    at ${stackFrames(w.stack, 4).join('\n    at ')}` : ''}`)
            .join('\n');
    }

    /** Compare every replica object with its mirror now (tests, the `__dwuWriteDetector` hook). */
    checkAll(): ReplicaWrite[] {
        if (this.depth > 0) throw new Error('replica write detector: checkAll during an apply');
        const dec = this.replica.decoder;
        for (let id = 0; id < dec.idLimit; id++) this.sweepOne(id);
        return this.unexpected();
    }

    /** Arm a trap on a key now (`Class.field`, `<label>.field`, `<label>[]`, `<label>{}`, `<label>#`). */
    arm(key: string): void {
        const m = /^(.*?)(\[\]|\{\}|#)$/.exec(key);
        const dec = this.replica.decoder;
        if (m !== null) {
            if (this.armedContainers.has(m[1])) return;
            this.armedContainers.add(m[1]);
            this.ensurePatched();
            for (let id = 0; id < dec.idLimit; id++) {
                const o = dec.object(id);
                const mi = this.mirrors[id];
                if (o !== null && mi !== undefined && mi.kind !== MK.Obj && this.labelOf(o) === m[1]) trappedContainers.set(o, this);
            }
            return;
        }
        const dot = key.lastIndexOf('.');
        if (dot < 0) return;
        const label = key.slice(0, dot);
        const field = key.slice(dot + 1);
        let set = this.armedFields.get(label);
        if (set === undefined) this.armedFields.set(label, (set = new Set()));
        if (!this.classNameSet.has(label)) this.armedPlain = true;
        if (set.has(field)) return;
        set.add(field);
        for (let id = 0; id < dec.idLimit; id++) {
            const o = dec.object(id);
            const mi = this.mirrors[id];
            if (o !== null && mi !== undefined && mi.kind === MK.Obj && this.labelOf(o) === label) this.trapField(o, field);
        }
    }

    /** Stop watching: unwrap the replica, unpatch the container mutators. Armed fields stay accessors (same values). */
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const f of this.restore) f();
        if (this.patched) unpatchContainerMutators();
        this.patched = false;
    }

    // -----------------------------------------------------------------------------------------------------------
    // Sync hooks
    // -----------------------------------------------------------------------------------------------------------

    private during<T>(fn: () => T): T {
        this.depth++;
        try {
            return fn();
        } finally {
            if (--this.depth === 0) this.finish();
        }
    }

    // (The decoder's entry points are wrapped, so watch runs inside during(): the mirrors refresh when it ends.)
    private watch(id: number, slot: number): void {
        if (this.touchMark[id] === this.epoch) return;
        if (slot >= 0) {
            // A field set: check (and later refresh) that field only — a ship's hot set must not cost all its fields.
            const m = this.mirrors[id];
            if (m !== undefined && m.kind === MK.Obj) {
                const k = this.replica.decoder.fieldName(id, slot);
                const keys = m.keys!;
                const i = k === undefined ? -1 : keys[slot] === k ? slot : keys.indexOf(k);
                if (i >= 0) {
                    const was = m.vals[i];
                    if (was === PENDING) return;
                    const o = this.replica.decoder.object(id) as Record<string, unknown>;
                    const v = o[k!];
                    if (!Object.is(v, was)) this.report(`${this.labelOf(o)}.${k!}`, 'sync', `#${id}: ${fmt(was)} → ${fmt(v)}`, null);
                    m.vals[i] = PENDING;
                    this.pending.push(id, i);
                    return;
                }
            }
        }
        this.touchMark[id] = this.epoch;
        this.touched.push(id);
        this.check(id, 'sync');
    }

    private finish(): void {
        const p = this.pending;
        if (this.touched.length === 0 && p.length === 0) return;
        const dec = this.replica.decoder;
        for (let x = 0; x < p.length; x += 2) {
            const id = p[x];
            if (this.touchMark[id] === this.epoch) continue; // refreshed whole below
            const m = this.mirrors[id];
            const o = dec.object(id) as Record<string, unknown> | null;
            if (m === undefined || o === null) continue;
            const v = o[m.keys![p[x + 1]]];
            m.vals[p[x + 1]] = v;
            if (this.linksLive && v !== null && typeof v === 'object') this.linkChild(o, v, `.${m.keys![p[x + 1]]}`);
        }
        p.length = 0;
        const ids = this.touched.splice(0);
        this.epoch++;
        this.refreshAll(ids);
    }

    private refreshAll(ids: number[]): void {
        const dec = this.replica.decoder;
        const fresh: object[] = [];
        for (const id of ids) {
            const o = dec.object(id);
            if (o === null) {
                this.mirrors[id] = undefined;
                continue;
            }
            const isNew = this.mirrors[id] === undefined;
            this.mirrors[id] = this.snap(o, true);
            if (isNew || this.mirrors[id]!.kind === MK.Obj) fresh.push(o);
        }
        // Traps after every parent link of the batch is known (a label is resolved through the parents).
        if (this.trapAll || this.armedFields.size > 0 || this.armedContainers.size > 0) for (const o of fresh) this.trapNew(o);
    }

    /** Sweep a slice of the replica (start of each cold pump). */
    private sweep(): void {
        if (this.sweepBudgetMs <= 0 || this.depth > 0) return;
        const dec = this.replica.decoder;
        const limit = dec.idLimit;
        if (limit === 0) return;
        const deadline = this.now() + this.sweepBudgetMs;
        const max = Math.min(this.sweepMax, limit);
        for (let n = 0; n < max; n++) {
            if (this.sweepCursor >= limit) this.sweepCursor = 0;
            this.sweepOne(this.sweepCursor++);
            if ((n & 63) === 63 && this.now() >= deadline) break;
        }
    }

    private sweepOne(id: number): void {
        const m = this.mirrors[id];
        if (m === undefined) return;
        const o = this.replica.decoder.object(id);
        if (o === null) {
            this.mirrors[id] = undefined;
            return;
        }
        if (this.check(id, 'sweep')) this.mirrors[id] = this.snap(o, false);
    }

    // -----------------------------------------------------------------------------------------------------------
    // Mirrors and compare
    // -----------------------------------------------------------------------------------------------------------

    /** The object's current contents; `link`: record it as the parent of the non-class objects it holds. */
    /** Record `parent` as where non-class replica object `v` was first found (its label's source). */
    private linkChild(parent: object, v: unknown, suffix: string): void {
        if (v === null || typeof v !== 'object' || this.parentOf.has(v) || this.classNames.has(Object.getPrototypeOf(v) as object)) return;
        if (this.replica.decoder.idOf(v) >= 0) this.parentOf.set(v, [parent, suffix]);
    }

    private snap(o: object, linkAsked: boolean): Mirror {
        const link = linkAsked && this.linksLive;
        if (Array.isArray(o)) {
            const vals = o.slice();
            if (link) for (const v of vals) if (v !== null && typeof v === 'object') this.linkChild(o, v, '[]');
            return { kind: MK.Arr, keys: null, vals };
        }
        if (o instanceof Map) {
            const vals: unknown[] = [];
            for (const [k, v] of o) {
                vals.push(k, v);
                if (link) {
                    this.linkChild(o, k, '{key}');
                    this.linkChild(o, v, '{}');
                }
            }
            return { kind: MK.Map, keys: null, vals };
        }
        if (o instanceof Set) {
            const vals = [...o];
            if (link) for (const v of vals) this.linkChild(o, v, '{}');
            return { kind: MK.Set, keys: null, vals };
        }
        if (ArrayBuffer.isView(o)) return { kind: MK.Typed, keys: null, vals: Array.from(o as AnyTyped) };
        const keys = Object.keys(o);
        const rec = o as Record<string, unknown>;
        const vals = new Array<unknown>(keys.length);
        for (let i = 0; i < keys.length; i++) {
            const v = rec[keys[i]];
            vals[i] = v;
            if (link && v !== null && typeof v === 'object') this.linkChild(o, v, `.${keys[i]}`);
        }
        return { kind: MK.Obj, keys, vals };
    }

    /** Compare object `id` with its mirror; report what differs (PENDING fields: the sync already set them). True when
     *  something did. */
    private check(id: number, how: WriteHow): boolean {
        const m = this.mirrors[id];
        if (m === undefined) return false;
        const o = this.replica.decoder.object(id);
        if (o === null) return false;
        if (m.kind === MK.Obj) {
            const rec = o as Record<string, unknown>;
            const keys = Object.keys(o);
            const mk = m.keys!;
            let any = false;
            const mv = m.vals;
            if (keys.length === mk.length && keys.every((k, i) => k === mk[i])) {
                for (let i = 0; i < mk.length; i++) {
                    const k = mk[i];
                    const v = rec[k];
                    if (!Object.is(v, mv[i]) && mv[i] !== PENDING) {
                        this.report(`${this.labelOf(o)}.${k}`, how, `#${id}: ${fmt(mv[i])} → ${fmt(v)}`, null);
                        any = true;
                    }
                }
                return any;
            }
            const was = new Map(mk.map((k, i) => [k, mv[i]]));
            const now = new Set(keys);
            for (const k of keys) {
                const w = was.get(k);
                if (w === PENDING) continue;
                if (!was.has(k)) this.report(`${this.labelOf(o)}.${k}`, how, `#${id}: added ${fmt(rec[k])}`, null);
                else if (!Object.is(rec[k], w)) this.report(`${this.labelOf(o)}.${k}`, how, `#${id}: ${fmt(w)} → ${fmt(rec[k])}`, null);
                else continue;
                any = true;
            }
            for (const k of mk) {
                if (!now.has(k)) {
                    this.report(`${this.labelOf(o)}.${k}`, how, `#${id}: deleted`, null);
                    any = true;
                }
            }
            if (!any) this.report(`${this.labelOf(o)}.*`, how, `#${id}: keys reordered`, null);
            return true;
        }
        let cur: ArrayLike<unknown>;
        if (m.kind === MK.Arr) cur = o as unknown[];
        else if (m.kind === MK.Map) {
            const flat: unknown[] = [];
            for (const [k, v] of o as Map<unknown, unknown>) flat.push(k, v);
            cur = flat;
        } else if (m.kind === MK.Set) cur = [...(o as Set<unknown>)];
        else cur = o as AnyTyped;
        const suffix = m.kind === MK.Arr ? '[]' : m.kind === MK.Typed ? '#' : '{}';
        if (cur.length !== m.vals.length) {
            this.report(`${this.labelOf(o)}${suffix}`, how, `#${id}: ${m.kind === MK.Map ? 'size' : 'length'} ${sizeOf(m.kind, m.vals.length)} → ${sizeOf(m.kind, cur.length)}`, null);
            return true;
        }
        for (let i = 0; i < cur.length; i++) {
            if (!Object.is(cur[i], m.vals[i])) {
                const at = m.kind === MK.Map ? `${i % 2 === 0 ? 'key' : 'value'} ${i >> 1}` : `[${i}]`;
                this.report(`${this.labelOf(o)}${suffix}`, how, `#${id}${at}: ${fmt(m.vals[i])} → ${fmt(cur[i])}`, null);
                return true;
            }
        }
        return false;
    }

    // -----------------------------------------------------------------------------------------------------------
    // Labels and reports
    // -----------------------------------------------------------------------------------------------------------

    /** The object's label: its class, else where it was first found (see the header). */
    labelOf(o: object): string {
        const name0 = this.classNames.get(Object.getPrototypeOf(o) as object);
        if (name0 !== undefined) return name0;
        const cached = this.labelCache.get(o);
        if (cached !== undefined) return cached;
        if (!this.linksLive) this.linkAll();
        const label = this.labelUncached(o);
        if (!label.includes('#')) this.labelCache.set(o, label); // (an unlinked one may get its parent later)
        return label;
    }

    /** Turn parent links on: link every mirrored object's children now (once; snap() keeps them up to date after). */
    private linkAll(): void {
        this.linksLive = true;
        const dec = this.replica.decoder;
        for (let id = 0; id < dec.idLimit; id++) {
            const o = dec.object(id);
            if (o !== null && this.mirrors[id] !== undefined) this.linkChildren(o);
        }
    }

    private linkChildren(o: object): void {
        if (Array.isArray(o)) {
            for (const v of o) if (v !== null && typeof v === 'object') this.linkChild(o, v, '[]');
        } else if (o instanceof Map) {
            for (const [k, v] of o) {
                this.linkChild(o, k, '{key}');
                this.linkChild(o, v, '{}');
            }
        } else if (o instanceof Set) {
            for (const v of o) this.linkChild(o, v, '{}');
        } else if (!ArrayBuffer.isView(o)) {
            const rec = o as Record<string, unknown>;
            for (const k of Object.keys(o)) {
                const v = rec[k];
                if (v !== null && typeof v === 'object') this.linkChild(o, v, `.${k}`);
            }
        }
    }

    private labelUncached(o: object): string {
        let suffix = '';
        let cur: object = o;
        for (let depth = 0; depth < 12; depth++) {
            const over = this.labelOverride.get(cur);
            if (over !== undefined) return over + suffix;
            const name = this.classNames.get(Object.getPrototypeOf(cur) as object);
            if (name !== undefined) return name + suffix;
            const p = this.parentOf.get(cur);
            if (p === undefined) {
                const base = Array.isArray(cur) ? 'Array' : cur instanceof Map ? 'Map' : cur instanceof Set ? 'Set' : ArrayBuffer.isView(cur) ? 'Typed' : 'Object';
                return `${base}#${this.replica.decoder.idOf(cur)}${suffix}`;
            }
            suffix = p[1] + suffix;
            cur = p[0];
        }
        return `…${suffix}`;
    }

    private allowed(key: string): boolean {
        if (this.allow.has(key)) return true;
        const m = /^(.*?)(\.[^.[\]{}#]*|\[\]|\{\}|#)$/.exec(key);
        return m !== null && this.allow.has(`${m[1]}.*`);
    }

    private report(key: string, how: WriteHow, detail: string, stack: string | null): void {
        let w = this.found.get(key);
        if (w === undefined) {
            w = { key, count: 0, how, byHow: { sync: 0, sweep: 0, trap: 0 }, detail, stack: null, allowed: this.allowed(key) };
            this.found.set(key, w);
            if (!w.allowed) {
                if (stack !== null) w.stack = stack;
                this.warn(w);
                if (this.autoTrap && how !== 'trap') this.arm(key);
            }
        } else if (w.stack === null && stack !== null && !w.allowed) {
            w.stack = stack;
            w.detail = `${w.detail}; trapped: ${detail}`;
            this.warn(w);
        }
        w.count++;
        w.byHow[how]++;
    }

    // -----------------------------------------------------------------------------------------------------------
    // Traps
    // -----------------------------------------------------------------------------------------------------------

    private ensurePatched(): void {
        if (this.patched) return;
        this.patched = true;
        patchContainerMutators();
    }

    private trapNew(o: object): void {
        if (Array.isArray(o) || o instanceof Map || o instanceof Set || ArrayBuffer.isView(o)) {
            if (this.trapAll || (this.armedContainers.size > 0 && this.armedContainers.has(this.labelOf(o)))) trappedContainers.set(o, this);
            return;
        }
        if (this.trapAll) {
            for (const k of Object.keys(o)) this.trapField(o, k);
            return;
        }
        // (A plain object's label needs the parent links: only resolve it when a plain-object label is armed.)
        const cls = this.classNames.get(Object.getPrototypeOf(o) as object);
        if (cls === undefined && !this.armedPlain) return;
        const fields = this.armedFields.get(cls ?? this.labelOf(o));
        if (fields !== undefined) for (const k of fields) this.trapField(o, k);
    }

    /** Move own enumerable data property `k` behind an accessor (same value, same enumerability). */
    private trapField(o: object, k: string): void {
        const d = Object.getOwnPropertyDescriptor(o, k);
        if (d === undefined || !('value' in d) || !d.enumerable || !d.writable || !d.configurable) return;
        let store = (o as Record<symbol, Record<string, unknown>>)[STORE];
        if (store === undefined) {
            store = Object.create(null) as Record<string, unknown>;
            Object.defineProperty(o, STORE, { value: store, enumerable: false, writable: false, configurable: true });
        }
        store[k] = d.value;
        Object.defineProperty(o, k, this.accessorFor(k));
    }

    private accessorFor(k: string): PropertyDescriptor {
        let a = this.accessors.get(k);
        if (a !== undefined) return a;
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const det = this;
        a = {
            get(this: Record<symbol, Record<string, unknown>>): unknown {
                return this[STORE][k];
            },
            set(this: Record<symbol, Record<string, unknown>>, v: unknown): void {
                const store = this[STORE];
                if (det.depth === 0 && !det.disposed) det.fieldTrapped(this as unknown as object, k, store[k], v);
                store[k] = v;
            },
            enumerable: true,
            configurable: true,
        };
        this.accessors.set(k, a);
        return a;
    }

    private fieldTrapped(o: object, k: string, was: unknown, v: unknown): void {
        const id = this.replica.decoder.idOf(o);
        this.report(`${this.labelOf(o)}.${k}`, 'trap', `#${id}: ${fmt(was)} → ${fmt(v)}${Object.is(was, v) ? ' (same value)' : ''}`, new Error('replica write').stack ?? '');
        // The compare must not count this write again.
        const m = id >= 0 ? this.mirrors[id] : undefined;
        if (m !== undefined && m.kind === MK.Obj) {
            const i = m.keys!.indexOf(k);
            if (i >= 0 && m.vals[i] !== PENDING) m.vals[i] = v;
        }
    }

    /** A trapped container's mutator ran (called by the patched prototype methods). */
    containerTrapped(c: object, method: string): void {
        if (this.depth > 0 || this.disposed) return;
        const id = this.replica.decoder.idOf(c);
        const suffix = Array.isArray(c) ? '[]' : ArrayBuffer.isView(c) ? '#' : '{}';
        this.report(`${this.labelOf(c)}${suffix}`, 'trap', `#${id}: ${method}()`, new Error('replica write').stack ?? '');
        if (id >= 0 && this.mirrors[id] !== undefined) this.mirrors[id] = this.snap(c, false);
    }
}

function sizeOf(kind: MK, n: number): number {
    return kind === MK.Map ? n / 2 : n;
}

function fmt(v: unknown): string {
    if (v === null || v === undefined) return String(v);
    if (typeof v === 'string') return JSON.stringify(v.length > 40 ? `${v.slice(0, 40)}…` : v);
    if (typeof v !== 'object') return Object.is(v, -0) ? '-0' : String(v);
    if (Array.isArray(v)) return `Array(${v.length})`;
    if (v instanceof Map) return `Map(${v.size})`;
    if (v instanceof Set) return `Set(${v.size})`;
    const name = (Object.getPrototypeOf(v) as { constructor?: { name?: string } } | null)?.constructor?.name;
    return name !== undefined && name !== '' ? `<${name}>` : '<object>';
}

/** The stack's frames, without the detector's own. */
export function stackFrames(stack: string, max = 8): string[] {
    return stack
        .split('\n')
        .slice(1)
        .map((l) => l.trim().replace(/^at /, ''))
        .filter((l) => l !== '' && !/writeDetector\.ts/.test(l))
        .slice(0, max);
}

function defaultWarn(w: ReplicaWrite): void {
    console.warn(`[replica write] ${w.key} (${w.how}) ${w.detail}${w.stack !== null ? `\n    at ${stackFrames(w.stack).join('\n    at ')}` : ' — trap armed; the next write reports its stack'}`);
}

/** `detectWrites=1` (compare, traps armed on what it finds) or `detectWrites=all` (trap everything from the start). */
export function writeDetectorMode(search: string): 'compare' | 'all' | null {
    const q = new URLSearchParams(search).get('detectWrites');
    if (q === '1' || q === 'true' || q === 'compare') return 'compare';
    if (q === 'all' || q === 'stack') return 'all';
    return null;
}

/** A detector on a Galaxy replica (GalaxyReplica / SimClientCore.replica), with the save registry's class names. */
export function installReplicaWriteDetector(replica: WatchedReplica, opts: Partial<WriteDetectorOptions> = {}): ReplicaWriteDetector {
    return new ReplicaWriteDetector(replica, { classes: replicaCodecOptions().classes, ...opts });
}
