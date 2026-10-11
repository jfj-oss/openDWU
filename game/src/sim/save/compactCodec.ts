// Save format 3: the compact encoding of the galaxy object graph (graphCodec.ts is format 2, still read).
//
// The same graph walk as graphCodec.ts — every object is visited once in the same depth-first order and gets the same
// implicit reference id (its visit index), instances are rebuilt without their constructors, static data are externals
// — but each value is spelled with far fewer characters. A 2-year 2500-star save was 449 MB of format-2 text, ~2/3 of it
// per-instance `{"$s":n,"$v":[…]}` wrappers, `{"$x":"componentDef","k":12}` externals, `{"$ref":n}` references and field
// values repeating the previous instance's. The text is still JSON (one JSON.parse, gzip as before), written straight
// to UTF-8 bytes (ByteWriter: no intermediate strings or encoded tree).
//
// Encoding of one value (E):
//   null / boolean / string / finite number   as is
//   {"k": E, ...}                             a plain object, written out (the first object with its key list); the
//                                             key list is then registered (when the object is complete) under the
//                                             next keyset id
//   [E, ...]                                  an array whose first element is not a number (or empty)
//   [tag, ...] (a JSON array starting with a number: the tag)
//     0  [0, E...]                            an array whose first element is a number
//     1  [1, id]                              an already-visited object (reference id)
//     2  [2]                                  undefined
//     3 / 4 / 5  [3] [4] [5]                  NaN / Infinity / -Infinity
//     6  [6, k, v, k, v, ...]                 Map
//     7  [7, E...]                            Set
//     8..15  [8+i, n...]                      typed array (TYPED_ARRAYS order; a non-finite element as "NaN" / ...)
//     16 [16, keyset, E...]                   a plain object with a registered key list
//     17 [17, kind, key]                      external (kind: index into the save's `kinds`)
//     18 [18, shape, n, C...]                 an array of n instances of one shape whose fields are all leaves
//                                             (primitives, externals, references to objects visited before the array),
//                                             column by column: one C per field (see writeColumn)
//     64 + 2s  [64+2s, E...]                  an instance of shape s, every field in shape order
//     65 + 2s  [65+2s, mask, E...]            an instance of shape s with only the fields whose bit is set in `mask`
//                                             (a string, 6 fields per character, BASE64 alphabet, low bit first;
//                                             fields past its end are unset): every other field is a primitive equal
//                                             (Object.is, -0 read as 0) to that field of the previous instance of
//                                             shape s completed (in the walk order, tables excepted), and is read from
//                                             that decoded instance
//
// Reference ids are those of the format-2 walk (arrays, plain objects, maps, sets, typed arrays and instances, each
// when first visited; a table's array, then its rows in order); every reference names an object visited earlier. The
// shape table and the external kinds are stored next to the graph (GalaxySaveJSON.shapes / .kinds).
//
// Headless: no DOM / Node APIs.

import type { Encoded, ExternalRef, GraphCodecOptions, ShapeTable } from './graphCodec';

const T_ARRAY = 0;
const T_REF = 1;
const T_UNDEF = 2;
const T_NAN = 3;
const T_INF = 4;
const T_NINF = 5;
const T_MAP = 6;
const T_SET = 7;
const T_TYPED = 8;
const T_KEYED = 16;
const T_EXT = 17;
const T_TABLE = 18;
const T_SHAPE = 64;

const TYPED: { new (values: ArrayLike<number>): ArrayLike<number>; prototype: object }[] = [Int8Array, Uint8Array, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array];

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const BASE64_VALUE = (() => {
    const t = new Int8Array(128).fill(-1);
    for (let i = 0; i < 64; i++) t[BASE64.charCodeAt(i)] = i;
    return t;
})();

/**
 * Whether a field may be left out of a sparse row: its value and the previous instance's are primitives, equal once
 * -0 is read as 0 (as it is written). The reader takes an unset field from the previous instance of the shape — the
 * decoded object itself, whose field holds that primitive.
 */
function sameInline(v: unknown, prev: unknown): boolean {
    return isPrimitive(v) && isPrimitive(prev) && Object.is(v === 0 ? 0 : v, prev === 0 ? 0 : prev);
}

// ---------------------------------------------------------------------------------------------------------------------
// ByteWriter
// ---------------------------------------------------------------------------------------------------------------------

/**
 * JSON text as UTF-8 bytes, in chunks of `chunkBytes` (handed to `flush` as they fill, and at `end`): the text is never
 * a JS string, so a big save's peak is the game plus its bytes.
 */
export class ByteWriter {
    private buf: Uint8Array<ArrayBuffer>;
    private pos = 0;
    private readonly enc = new TextEncoder();

    constructor(
        private readonly flush: (chunk: Uint8Array<ArrayBuffer>) => void,
        private readonly chunkBytes = 1 << 22,
    ) {
        this.buf = new Uint8Array(Math.max(16, chunkBytes));
    }

    private room(n: number): void {
        if (this.pos + n <= this.buf.length) return;
        this.end();
        if (n > this.buf.length) this.buf = new Uint8Array(n);
    }

    /** One ASCII character (by code). */
    byte(c: number): void {
        if (this.pos >= this.buf.length) this.end();
        this.buf[this.pos++] = c;
    }

    /** An ASCII string. */
    ascii(s: string): void {
        const n = s.length;
        this.room(n);
        const b = this.buf;
        let p = this.pos;
        for (let i = 0; i < n; i++) b[p++] = s.charCodeAt(i);
        this.pos = p;
    }

    /** A finite number as JSON writes it (String(x)). */
    num(x: number): void {
        if (x >= 0 && x < 1e9 && (x | 0) === x) {
            // Fast path: small non-negative integers, digit by digit.
            this.room(10);
            const b = this.buf;
            if (x < 10) {
                b[this.pos++] = 48 + x;
                return;
            }
            let digits = 0;
            for (let t = x; t > 0; t = (t / 10) | 0) digits++;
            let p = this.pos + digits;
            this.pos = p;
            for (let t = x; t > 0; t = (t / 10) | 0) b[--p] = 48 + (t % 10);
            return;
        }
        this.ascii(String(x));
    }

    /** A string as JSON writes it (JSON.stringify), UTF-8 encoded. */
    str(s: string): void {
        const n = s.length;
        let plain = true;
        for (let i = 0; i < n; i++) {
            const c = s.charCodeAt(i);
            if (c < 0x20 || c > 0x7e || c === 34 || c === 92) {
                plain = false;
                break;
            }
        }
        if (plain) {
            this.room(n + 2);
            const b = this.buf;
            let p = this.pos;
            b[p++] = 34;
            for (let i = 0; i < n; i++) b[p++] = s.charCodeAt(i);
            b[p++] = 34;
            this.pos = p;
            return;
        }
        const json = JSON.stringify(s);
        this.room(json.length * 3);
        this.pos += this.enc.encodeInto(json, this.buf.subarray(this.pos)).written;
    }

    /** Hand what is buffered to `flush` (nothing when empty). */
    end(): void {
        if (this.pos === 0) return;
        const full = this.pos > this.buf.length >> 1;
        // A mostly full buffer is handed over as it is (a view, no copy); a short tail is copied out.
        this.flush(full ? this.buf.subarray(0, this.pos) : this.buf.slice(0, this.pos));
        if (full) this.buf = new Uint8Array(Math.max(16, this.chunkBytes));
        this.pos = 0;
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Encoder
// ---------------------------------------------------------------------------------------------------------------------

const F_ARRAY = 0; // children: obj[j] (holes: null); `sep` says whether the first child takes a comma
const F_LIST = 1; // children: items[j], each after a comma (map entries flattened, set items, instance values, keyed plain values)
const F_PLAIN = 2; // a written-out plain object: children items[j] after "key":
const F_INSTANCE = 3; // F_LIST + the instance is the shape's previous one once complete

class EncFrame {
    i = 0;
    constructor(
        readonly kind: number,
        readonly obj: object,
        readonly items: unknown[] | null,
        readonly n: number,
        /** F_ARRAY: whether the first element is written after a comma (a tagged array). */
        readonly sep: boolean,
        /** F_PLAIN: the keys; F_INSTANCE: the labels of the written fields (error paths). */
        readonly keys: string[] | null,
        /** F_INSTANCE: the shape id; F_PLAIN: -1 (registers `keysetKey` at close). */
        readonly shape: number,
        readonly keysetKey: string | null,
    ) {}
}

function typedIndex(obj: object): number {
    if (!ArrayBuffer.isView(obj)) return -1;
    for (let i = 0; i < TYPED.length; i++) if (obj instanceof TYPED[i]) return i;
    return -1;
}

function isPrimitive(v: unknown): boolean {
    const t = typeof v;
    return v === null || (t !== 'object' && t !== 'function' && t !== 'symbol' && t !== 'bigint');
}

function digitCount(x: number): number {
    let a = x < 0 ? -x : x;
    let n = x < 0 ? 2 : 1;
    while (a >= 10) {
        a = Math.floor(a / 10);
        n++;
    }
    return n;
}

export class CompactEncoder {
    /** Object → its reference id (≥ 0, visited), or -(i + 1) for externals[i] — one lookup answers both. */
    private readonly ids = new Map<object, number>();
    private readonly externalList: ExternalRef[] = [];
    private nextId = 0;
    private readonly nameByPrototype = new Map<object, string>();
    private readonly skipFields: Map<object, ReadonlySet<string>>;
    /** Every shape written so far, in first-use order (the save's shape table, as graphCodec.ts). */
    readonly shapes: ShapeTable = [];
    /** The external kinds named so far (`[17, kind, key]` indexes this). */
    readonly kinds: string[] = [];
    private readonly kindIds = new Map<string, number>();
    private readonly shapesByPrototype = new Map<object, { keys: string[]; id: number }[]>();
    private readonly keysets = new Map<string, number>();
    /** Per shape, the instance last completed (sparse rows are against it). */
    private readonly prevObjects: (Record<string, unknown> | undefined)[] = [];

    constructor(options: GraphCodecOptions, externals: Map<object, ExternalRef>) {
        for (const name of Object.keys(options.classes)) this.nameByPrototype.set(options.classes[name], name);
        this.skipFields = options.skipFields ?? new Map();
        for (const [obj, ref] of externals) this.ids.set(obj, -this.externalList.push(ref));
    }

    /** Every object encoded so far (not externals), in visit order. */
    *visited(): IterableIterator<object> {
        for (const [obj, id] of this.ids) if (id >= 0) yield obj;
    }

    /** The external `v` is, if it is one. */
    private externalOf(v: unknown): ExternalRef | undefined {
        if (v === null || typeof v !== 'object') return undefined;
        const id = this.ids.get(v);
        return id !== undefined && id < 0 ? this.externalList[-id - 1] : undefined;
    }

    /** Write the encoding of `value` (see the file header) to `out`. Iterative (a late-game graph nests thousands deep). */
    encodeJson(value: unknown, out: ByteWriter, path = '$'): void {
        const stack: EncFrame[] = [];
        this.open(value, out, stack, path);
        while (stack.length > 0) {
            const f = stack[stack.length - 1];
            if (f.i < f.n) {
                const j = f.i++;
                switch (f.kind) {
                    case F_ARRAY: {
                        if (j > 0 || f.sep) out.byte(44);
                        const arr = f.obj as unknown[];
                        if (!(j in arr)) {
                            out.ascii('null');
                            continue;
                        }
                        this.open(arr[j], out, stack, path);
                        continue;
                    }
                    case F_PLAIN:
                        if (j > 0) out.byte(44);
                        out.str(f.keys![j]);
                        out.byte(58);
                        break;
                    default:
                        out.byte(44);
                }
                this.open(f.items![j], out, stack, path);
                continue;
            }
            stack.pop();
            if (f.kind === F_PLAIN) {
                out.byte(125);
                if (f.keysetKey !== null && !this.keysets.has(f.keysetKey)) this.keysets.set(f.keysetKey, this.keysets.size);
            } else {
                out.byte(93);
                if (f.kind === F_INSTANCE) this.prevObjects[f.shape] = f.obj as Record<string, unknown>;
            }
        }
    }

    /** Write a leaf, or an object's opening (its frame pushed on `stack`). */
    private open(value: unknown, out: ByteWriter, stack: EncFrame[], basePath: string): void {
        switch (typeof value) {
            case 'undefined':
                out.ascii('[2]');
                return;
            case 'boolean':
                out.ascii(value ? 'true' : 'false');
                return;
            case 'string':
                out.str(value);
                return;
            case 'number':
                if (Number.isFinite(value)) out.num(value);
                else out.ascii(Number.isNaN(value) ? '[3]' : value > 0 ? '[4]' : '[5]');
                return;
            case 'object':
                break;
            default:
                throw new Error(`Cannot serialize a ${typeof value} at ${encPath(basePath, stack)}.`);
        }
        if (value === null) {
            out.ascii('null');
            return;
        }
        const obj = value as object;
        const ref = this.ids.get(obj);
        if (ref !== undefined) {
            if (ref < 0) this.writeExternal(this.externalList[-ref - 1], out);
            else {
                out.ascii('[1,');
                out.num(ref);
                out.byte(93);
            }
            return;
        }
        this.ids.set(obj, this.nextId++);
        const ti = typedIndex(obj);
        if (ti >= 0) {
            const a = obj as ArrayLike<number>;
            out.byte(91);
            out.num(T_TYPED + ti);
            for (let i = 0; i < a.length; i++) {
                const x = a[i];
                out.byte(44);
                if (Number.isFinite(x)) out.num(x);
                else out.ascii(Number.isNaN(x) ? '"NaN"' : x > 0 ? '"Infinity"' : '"-Infinity"');
            }
            out.byte(93);
            return;
        }
        if (Array.isArray(obj)) {
            const arr = obj as unknown[];
            if (arr.length === 0) {
                out.ascii('[]');
                return;
            }
            if (arr.length >= 2 && this.tryTable(arr, out)) return;
            out.byte(91);
            const first = 0 in arr ? arr[0] : null;
            const tagged = typeof first === 'number' && Number.isFinite(first);
            if (tagged) out.byte(48);
            stack.push(new EncFrame(F_ARRAY, arr, null, arr.length, tagged, null, -1, null));
            return;
        }
        if (obj instanceof Map) {
            const items: unknown[] = [];
            for (const [k, v] of obj as Map<unknown, unknown>) items.push(k, v);
            out.ascii('[6');
            stack.push(new EncFrame(F_LIST, obj, items, items.length, true, null, -1, null));
            return;
        }
        if (obj instanceof Set) {
            const items = Array.from(obj as Set<unknown>);
            out.ascii('[7');
            stack.push(new EncFrame(F_LIST, obj, items, items.length, true, null, -1, null));
            return;
        }
        const proto = Object.getPrototypeOf(obj) as object | null;
        if (proto === null || proto === Object.prototype) {
            const keys = Object.keys(obj);
            if (keys.length === 0) {
                out.ascii('{}');
                return;
            }
            for (const key of keys) {
                if (key.charCodeAt(0) === 36) throw new Error(`Plain-object key ${key} at ${encPath(basePath, stack)} must not start with '$'.`);
            }
            const rec = obj as Record<string, unknown>;
            const items = keys.map((k) => rec[k]);
            const ks = JSON.stringify(keys);
            const id = this.keysets.get(ks);
            if (id !== undefined) {
                out.ascii('[16,');
                out.num(id);
                stack.push(new EncFrame(F_LIST, obj, items, items.length, true, keys, -1, null));
                return;
            }
            out.byte(123);
            stack.push(new EncFrame(F_PLAIN, obj, items, items.length, false, keys, -1, ks));
            return;
        }
        const name = this.nameByPrototype.get(proto);
        if (name === undefined) {
            const ctorName = (proto as { constructor?: { name?: string } }).constructor?.name ?? '?';
            throw new Error(`Cannot serialize an instance of ${ctorName} at ${encPath(basePath, stack)}: class not registered with the save codec.`);
        }
        const keys = this.instanceKeys(obj, proto);
        const s = this.shapeId(proto, name, keys);
        const k = keys.length;
        const rec = obj as Record<string, unknown>;
        const values = new Array<unknown>(k);
        const prev = this.prevObjects[s];
        let omit = 0;
        for (let j = 0; j < k; j++) {
            const v = rec[keys[j]];
            values[j] = v;
            if (prev !== undefined && sameInline(v, prev[keys[j]])) omit++;
        }
        // A sparse row costs its mask (a character per 6 fields, quotes, comma); every field left out saves a value
        // and a comma (at least 2 characters).
        if (omit > 0 && 2 * omit > Math.ceil(k / 6) + 3) {
            let mask = '';
            let last = 0;
            const present: unknown[] = [];
            const labels: string[] = [];
            for (let c = 0; c * 6 < k; c++) {
                let bits = 0;
                for (let b = 0; b < 6 && c * 6 + b < k; b++) {
                    const j = c * 6 + b;
                    if (sameInline(values[j], prev![keys[j]])) continue;
                    bits |= 1 << b;
                    present.push(values[j]);
                    labels.push(keys[j]);
                }
                mask += BASE64[bits];
                if (bits !== 0) last = c + 1;
            }
            out.byte(91);
            out.num(T_SHAPE + 2 * s + 1);
            out.byte(44);
            out.str(mask.slice(0, last));
            stack.push(new EncFrame(F_INSTANCE, obj, present, present.length, true, labels, s, null));
            return;
        }
        out.byte(91);
        out.num(T_SHAPE + 2 * s);
        stack.push(new EncFrame(F_INSTANCE, obj, values, k, true, keys, s, null));
    }

    private writeExternal(ext: ExternalRef, out: ByteWriter): void {
        out.ascii('[17,');
        out.num(this.kindId(ext.kind));
        out.byte(44);
        if (typeof ext.key === 'number') out.num(ext.key);
        else out.str(ext.key);
        out.byte(93);
    }

    private kindId(kind: string): number {
        let id = this.kindIds.get(kind);
        if (id === undefined) {
            id = this.kinds.length;
            this.kinds.push(kind);
            this.kindIds.set(kind, id);
        }
        return id;
    }

    private instanceKeys(obj: object, proto: object): string[] {
        const keys = Object.keys(obj);
        const skip = this.skipFields.get(proto);
        return skip === undefined ? keys : keys.filter((key) => !skip.has(key));
    }

    /** A leaf for a table: a primitive, an external, or an object already visited. */
    private isLeaf(v: unknown): boolean {
        if (isPrimitive(v)) return true;
        if (typeof v !== 'object') return false;
        return this.ids.has(v as object);
    }

    /**
     * The array (just memoed) as a table (tag 18) when it is n ≥ 2 distinct new instances of one class and field list
     * whose fields are all leaves; false (nothing written) otherwise. The rows are memoed in order, after the array.
     */
    private tryTable(arr: unknown[], out: ByteWriter): boolean {
        const first = arr[0];
        if (first === null || typeof first !== 'object' || Array.isArray(first) || this.ids.has(first)) return false;
        const proto = Object.getPrototypeOf(first) as object | null;
        if (proto === null || proto === Object.prototype || proto === Map.prototype || proto === Set.prototype || ArrayBuffer.isView(first)) return false;
        const name = this.nameByPrototype.get(proto);
        if (name === undefined) return false;
        const keys = this.instanceKeys(first, proto);
        const k = keys.length;
        const n = arr.length;
        const rec0 = first as Record<string, unknown>;
        for (let j = 0; j < k; j++) if (!this.isLeaf(rec0[keys[j]])) return false;
        const vals = new Array<unknown>(n * k);
        const seen = new Set<object>();
        for (let i = 0; i < n; i++) {
            if (!(i in arr)) return false;
            const e = arr[i];
            if (e === null || typeof e !== 'object' || Object.getPrototypeOf(e) !== proto || this.ids.has(e) || seen.has(e)) return false;
            seen.add(e);
            const rec = e as Record<string, unknown>;
            if (i > 0) {
                const ek = this.instanceKeys(e, proto);
                if (ek.length !== k) return false;
                for (let j = 0; j < k; j++) if (ek[j] !== keys[j]) return false;
            }
            for (let j = 0; j < k; j++) {
                const v = rec[keys[j]];
                if (!this.isLeaf(v)) return false;
                // -0 is written as 0 (and read back as 0): the columns compare it as 0 too, or a column with a -0 would be
                // written one way and its reloaded copy (all 0) another — a save that did not re-serialize identically.
                vals[i * k + j] = v === 0 ? 0 : v;
            }
        }
        const s = this.shapeId(proto, name, keys);
        for (let i = 0; i < n; i++) this.ids.set(arr[i] as object, this.nextId++);
        out.ascii('[18,');
        out.num(s);
        out.byte(44);
        out.num(n);
        for (let j = 0; j < k; j++) {
            out.byte(44);
            this.writeColumn(vals, j, k, n, out);
        }
        out.byte(93);
        return true;
    }

    /**
     * Field j of a table's n rows:
     *   a primitive (not an array / object)   every row's value (Object.is-equal)
     *   {"c": E}                              every row's value, a non-primitive leaf
     *   {"x": kind, "k": [key, ...]}          externals of one kind
     *   {"d": [v0, d1, d2, ...]}              safe integers, as the first and the differences
     *   [E, ...]                              one leaf per row
     */
    private writeColumn(vals: unknown[], j: number, k: number, n: number, out: ByteWriter): void {
        const v0 = vals[j];
        let same = true;
        for (let i = 1; i < n && same; i++) same = Object.is(vals[i * k + j], v0);
        if (same) {
            if (v0 === null || typeof v0 === 'string' || typeof v0 === 'boolean' || (typeof v0 === 'number' && Number.isFinite(v0))) {
                this.writeLeaf(v0, out);
                return;
            }
            out.ascii('{"c":');
            this.writeLeaf(v0, out);
            out.byte(125);
            return;
        }
        // One external kind.
        const e0 = this.externalOf(v0);
        if (e0 !== undefined) {
            let one = true;
            for (let i = 1; i < n && one; i++) {
                const v = vals[i * k + j];
                one = this.externalOf(v)?.kind === e0.kind;
            }
            if (one) {
                out.ascii('{"x":');
                out.num(this.kindId(e0.kind));
                out.ascii(',"k":[');
                for (let i = 0; i < n; i++) {
                    if (i > 0) out.byte(44);
                    const key = this.externalOf(vals[i * k + j])!.key;
                    if (typeof key === 'number') out.num(key);
                    else out.str(key);
                }
                out.ascii(']}');
                return;
            }
        }
        // Integers: the differences when they are shorter.
        let ints = true;
        let plainLen = 0;
        let deltaLen = 0;
        for (let i = 0; i < n && ints; i++) {
            const v = vals[i * k + j];
            if (typeof v !== 'number' || !Number.isSafeInteger(v) || Object.is(v, -0)) {
                ints = false;
                break;
            }
            plainLen += digitCount(v);
            const d = i === 0 ? v : v - (vals[(i - 1) * k + j] as number);
            if (!Number.isSafeInteger(d)) ints = false;
            else deltaLen += digitCount(d);
        }
        if (ints && deltaLen + 6 < plainLen) {
            out.ascii('{"d":[');
            for (let i = 0; i < n; i++) {
                if (i > 0) out.byte(44);
                const v = vals[i * k + j] as number;
                out.num(i === 0 ? v : v - (vals[(i - 1) * k + j] as number));
            }
            out.ascii(']}');
            return;
        }
        out.byte(91);
        for (let i = 0; i < n; i++) {
            if (i > 0) out.byte(44);
            this.writeLeaf(vals[i * k + j], out);
        }
        out.byte(93);
    }

    /** A table leaf (isLeaf). */
    private writeLeaf(v: unknown, out: ByteWriter): void {
        switch (typeof v) {
            case 'undefined':
                out.ascii('[2]');
                return;
            case 'boolean':
                out.ascii(v ? 'true' : 'false');
                return;
            case 'string':
                out.str(v);
                return;
            case 'number':
                if (Number.isFinite(v)) out.num(v);
                else out.ascii(Number.isNaN(v) ? '[3]' : v > 0 ? '[4]' : '[5]');
                return;
        }
        if (v === null) {
            out.ascii('null');
            return;
        }
        const id = this.ids.get(v as object)!;
        if (id < 0) {
            this.writeExternal(this.externalList[-id - 1], out);
            return;
        }
        out.ascii('[1,');
        out.num(id);
        out.byte(93);
    }

    private shapeId(proto: object, name: string, keys: string[]): number {
        let known = this.shapesByPrototype.get(proto);
        if (known === undefined) {
            known = [];
            this.shapesByPrototype.set(proto, known);
        }
        outer: for (const shape of known) {
            if (shape.keys.length !== keys.length) continue;
            for (let i = 0; i < keys.length; i++) if (shape.keys[i] !== keys[i]) continue outer;
            return shape.id;
        }
        const id = this.shapes.length;
        this.shapes.push([name, ...keys]);
        known.push({ keys, id });
        return id;
    }
}

/** The path of the value being written (built only for an error message). */
function encPath(base: string, stack: readonly EncFrame[]): string {
    let p = base;
    for (const f of stack) {
        const j = f.i - 1;
        if (f.kind === F_ARRAY) p += `[${j}]`;
        else if (f.keys !== null) p += `.${f.keys[j] ?? j}`;
        else p += `.<${j}>`;
    }
    return p;
}

// ---------------------------------------------------------------------------------------------------------------------
// Decoder
// ---------------------------------------------------------------------------------------------------------------------

/** A shape's generated constructor: `new S(v, o, f)` sets field i to f(v[o + i]) — f = inlineOrNull for encodings, the
 *  identity for decoded values (a table's rows). One constructor, so every instance of the shape has one hidden class. */
type ShapeCtor = new (v: readonly unknown[], o: number, f: (e: unknown) => unknown) => Record<string, unknown>;

const D_ARRAY = 0;
const D_PLAIN = 1;
const D_INSTANCE = 2;
const D_DEFINED = 3;
const D_MAP = 4;
const D_SET = 5;

class DecFrame {
    i = 0;
    key: unknown = undefined;
    constructor(
        readonly kind: number,
        readonly out: unknown,
        /** Child j is src[base + j]. */
        readonly src: readonly unknown[],
        readonly base: number,
        readonly n: number,
        readonly keys: readonly string[] | null,
        /** D_INSTANCE / D_DEFINED: the shape (the instance becomes its previous one at close); D_PLAIN: 1 when written out
         *  (its key list registers at close). */
        readonly shape: number,
    ) {}
}

function assignmentIntercepted(proto: object | null, key: string): boolean {
    for (let o = proto; o !== null; o = Object.getPrototypeOf(o) as object | null) {
        const d = Object.getOwnPropertyDescriptor(o, key);
        if (d !== undefined) return d.get !== undefined || d.set !== undefined || d.writable === false;
    }
    return false;
}

const PENDING: unique symbol = Symbol('pending');

export class CompactDecoder {
    private readonly memo: unknown[] = [];
    private readonly keysets: string[][] = [];
    private readonly keysetIds = new Set<string>();
    /** Per shape, the instance last completed (sparse rows are against it). */
    private readonly prevObjects: (Record<string, unknown> | undefined)[] = [];
    private readonly ctors: (ShapeCtor | null | undefined)[] = [];
    /** The field names of each shape (its row without the class name). */
    private readonly fieldNames: string[][] = [];
    private readonly kindCache: Map<unknown, unknown>[] = [];
    /** The value of a leaf encoding, else null (a shape constructor's placeholder until the child is decoded). */
    private readonly leafOrNull = (e: unknown): unknown => {
        if (e === null || typeof e !== 'object') return e;
        const a = e as unknown[];
        switch (a[0]) {
            case T_REF:
                return this.ref(a[1] as number);
            case T_UNDEF:
                return undefined;
            case T_NAN:
                return NaN;
            case T_INF:
                return Infinity;
            case T_NINF:
                return -Infinity;
            case T_EXT:
                return this.external(a[1] as number, a[2]);
        }
        return null;
    };

    /** A shape constructor's field value: an inline encoding's value (leafOrNull, but not a reference: a reference may
     *  name an object an earlier field of the same instance is still to build), else the null placeholder. */
    private readonly inlineOrNull = (e: unknown): unknown => {
        if (e === null || typeof e !== 'object') return e;
        return (e as unknown[])[0] === T_REF ? null : this.leafOrNull(e);
    };

    constructor(
        private readonly options: GraphCodecOptions,
        private readonly resolveExternal: (ref: ExternalRef) => unknown,
        private readonly shapes: ShapeTable,
        private readonly kinds: readonly string[],
        /** Drop each encoded value from the parsed tree as it is read (the tree is the decoder's to consume). */
        private readonly consume = false,
    ) {}

    private ref(id: number): unknown {
        if (!(id < this.memo.length)) throw new Error(`Forward reference ${id}.`);
        return this.memo[id];
    }

    private external(kind: number, key: unknown): unknown {
        let cache = this.kindCache[kind];
        if (cache === undefined) cache = this.kindCache[kind] = new Map();
        let v = cache.get(key);
        if (v === undefined) {
            const name = this.kinds[kind];
            v = name === undefined ? undefined : this.resolveExternal({ kind: name, key: key as string | number });
            if (v === undefined) throw new Error(`Unresolved external ${String(name)}:${String(key)}.`);
            cache.set(key, v);
        }
        return v;
    }

    /** Shape s's generated constructor (one hidden class per shape, as graphCodec.ts shapeFactory), or null for the
     *  defineProperty path (a revive hook, a key an assignment would not simply define, no code generation). */
    private shapeCtor(s: number, proto: object): ShapeCtor | null {
        const known = this.ctors[s];
        if (known !== undefined) return known;
        const keys = this.fields(s);
        let c: ShapeCtor | null = null;
        const usable =
            this.options.shapeConstructors !== false &&
            this.options.revive?.has(proto) !== true &&
            new Set(keys).size === keys.length &&
            keys.every((k) => k !== '__proto__' && !assignmentIntercepted(proto, k));
        if (usable) {
            try {
                const lhs = keys.map((k) => `this${/^[A-Za-z_$][\w$]*$/.test(k) ? `.${k}` : `[${JSON.stringify(k)}]`}`);
                const S = new Function(`return function Shape(v, o, f) {\n${lhs.map((l, i) => `${l} = f(v[o + ${i}]);`).join('\n')}\n};`)() as ShapeCtor & { prototype: object };
                S.prototype = proto;
                c = S;
            } catch {
                c = null;
            }
        }
        this.ctors[s] = c;
        return c;
    }

    private readonly protos: (object | undefined)[] = [];

    private proto(s: number): object {
        const known = this.protos[s];
        if (known !== undefined) return known;
        const shape = this.shapes[s];
        if (shape === undefined) throw new Error(`Unknown shape ${s}.`);
        const proto = this.options.classes[shape[0]];
        if (proto === undefined) throw new Error(`Unknown class ${shape[0]}.`);
        this.protos[s] = proto;
        return proto;
    }

    private fields(s: number): string[] {
        return (this.fieldNames[s] ??= this.shapes[s].slice(1));
    }

    /** The value `value` encodes (see the file header). Iterative, in the encoder's order. */
    decode(value: Encoded, path = '$'): unknown {
        const stack: DecFrame[] = [];
        try {
            const first = this.open(value, stack);
            if (first !== PENDING) return first;
            for (;;) {
                const f = stack[stack.length - 1];
                if (f.i < f.n) {
                    const j = f.i++;
                    const e = f.src[f.base + j];
                    // (Consuming: the encoded child is dropped from the tree once read, so the decoded part of a big
                    // save's parsed tree is garbage while the rest is decoded.)
                    if (this.consume && e !== null && typeof e === 'object') (f.src as unknown[])[f.base + j] = null;
                    if (f.kind === D_INSTANCE && isInline(e)) continue; // set by the shape constructor
                    const v = this.open(e, stack);
                    if (v !== PENDING) this.put(f, j, v);
                    continue;
                }
                stack.pop();
                if (f.kind === D_INSTANCE || f.kind === D_DEFINED) this.prevObjects[f.shape] = f.out as Record<string, unknown>;
                else if (f.kind === D_PLAIN && f.shape === 1) {
                    const ks = JSON.stringify(f.keys);
                    if (!this.keysetIds.has(ks)) {
                        this.keysetIds.add(ks);
                        this.keysets.push(f.keys as string[]);
                    }
                }
                if (stack.length === 0) return f.out;
                const p = stack[stack.length - 1];
                this.put(p, p.i - 1, f.out);
            }
        } catch (err) {
            if (err instanceof Error && !err.message.includes(' at ')) err.message = `${err.message.replace(/\.$/, '')} at ${decPath(path, stack)}.`;
            throw err;
        }
    }

    private put(f: DecFrame, j: number, v: unknown): void {
        switch (f.kind) {
            case D_ARRAY:
                (f.out as unknown[]).push(v);
                return;
            case D_PLAIN:
            case D_INSTANCE:
                (f.out as Record<string, unknown>)[f.keys![j]] = v;
                return;
            case D_MAP:
                if ((j & 1) === 0) f.key = v;
                else (f.out as Map<unknown, unknown>).set(f.key, v);
                return;
            case D_SET:
                (f.out as Set<unknown>).add(v);
                return;
            default:
                Object.defineProperty(f.out, f.keys![j], { value: v, writable: true, enumerable: true, configurable: true });
        }
    }

    private open(e: unknown, stack: DecFrame[]): unknown {
        if (e === null || typeof e !== 'object') return e;
        if (!Array.isArray(e)) {
            const keys = Object.keys(e);
            const out: Record<string, unknown> = {};
            this.memo.push(out);
            if (keys.length === 0) return out;
            const rec = e as Record<string, unknown>;
            stack.push(new DecFrame(D_PLAIN, out, keys.map((k) => rec[k]), 0, keys.length, keys, 1));
            return PENDING;
        }
        const a = e as unknown[];
        const tag = a.length === 0 ? -1 : a[0];
        if (typeof tag !== 'number' || tag < 0) {
            const out: unknown[] = [];
            this.memo.push(out);
            stack.push(new DecFrame(D_ARRAY, out, a, 0, a.length, null, -1));
            return PENDING;
        }
        if (tag >= T_SHAPE) return this.openInstance(a, tag, stack);
        switch (tag) {
            case T_ARRAY: {
                const out: unknown[] = [];
                this.memo.push(out);
                stack.push(new DecFrame(D_ARRAY, out, a, 1, a.length - 1, null, -1));
                return PENDING;
            }
            case T_REF:
            case T_UNDEF:
            case T_NAN:
            case T_INF:
            case T_NINF:
            case T_EXT:
                return this.leafOrNull(a);
            case T_MAP: {
                const out = new Map<unknown, unknown>();
                this.memo.push(out);
                stack.push(new DecFrame(D_MAP, out, a, 1, a.length - 1, null, -1));
                return PENDING;
            }
            case T_SET: {
                const out = new Set<unknown>();
                this.memo.push(out);
                stack.push(new DecFrame(D_SET, out, a, 1, a.length - 1, null, -1));
                return PENDING;
            }
            case T_KEYED: {
                const keys = this.keysets[a[1] as number];
                if (keys === undefined) throw new Error(`Unknown keyset ${String(a[1])}.`);
                const out: Record<string, unknown> = {};
                this.memo.push(out);
                stack.push(new DecFrame(D_PLAIN, out, a, 2, keys.length, keys, 0));
                return PENDING;
            }
            case T_TABLE:
                return this.table(a);
        }
        if (tag >= T_TYPED && tag < T_TYPED + TYPED.length) {
            const out = new TYPED[tag - T_TYPED](a.slice(1) as number[]);
            this.memo.push(out);
            return out;
        }
        throw new Error(`Unknown tag ${tag}.`);
    }

    private openInstance(a: unknown[], tag: number, stack: DecFrame[]): unknown {
        const s = (tag - T_SHAPE) >> 1;
        const proto = this.proto(s);
        const keys = this.fields(s);
        const k = keys.length;
        let src: readonly unknown[] = a;
        let base = 1;
        if ((tag & 1) === 1) {
            // Sparse: an unset field is the previous instance's (a primitive: sameInline).
            const prev = this.prevObjects[s];
            if (prev === undefined) throw new Error(`Sparse instance of shape ${s} without a previous one.`);
            const mask = a[1] as string;
            const vals = new Array<unknown>(k);
            let p = 2;
            for (let j = 0; j < k; j++) {
                const c = (j / 6) | 0;
                const bits = c < mask.length ? BASE64_VALUE[mask.charCodeAt(c)] : 0;
                vals[j] = (bits >> (j % 6)) & 1 ? a[p++] : prev[keys[j]];
            }
            if (p !== a.length) throw new Error(`Sparse instance of shape ${s}: ${a.length - 2} values for its mask.`);
            src = vals;
            base = 0;
        } else if (a.length !== k + 1) throw new Error(`Instance of shape ${s}: ${a.length - 1} values for ${k} fields.`);
        const c = this.shapeCtor(s, proto);
        if (c !== null) {
            const out = new c(src, base, this.inlineOrNull);
            this.memo.push(out);
            stack.push(new DecFrame(D_INSTANCE, out, src, base, k, keys, s));
            return PENDING;
        }
        const out = Object.create(proto) as Record<string, unknown>;
        this.options.revive?.get(proto)?.(out);
        this.memo.push(out);
        stack.push(new DecFrame(D_DEFINED, out, src, base, k, keys, s));
        return PENDING;
    }

    /** A table (tag 18): the array, then its rows, each built whole. */
    private table(a: unknown[]): unknown {
        const s = a[1] as number;
        const n = a[2] as number;
        const proto = this.proto(s);
        const keys = this.fields(s);
        const k = keys.length;
        if (a.length !== 3 + k) throw new Error(`Table of shape ${s}: ${a.length - 3} columns for ${k} fields.`);
        const out: unknown[] = [];
        this.memo.push(out);
        const cols: unknown[][] = [];
        const consts: unknown[] = [];
        for (let j = 0; j < k; j++) {
            const c = a[3 + j];
            if (c === null || typeof c !== 'object') {
                cols.push(null as unknown as unknown[]);
                consts.push(c);
            } else if (Array.isArray(c)) {
                if (c.length !== n) throw new Error(`Table column ${keys[j]}: ${c.length} rows for ${n}.`);
                cols.push(c.map(this.leafOrNull));
                consts.push(undefined);
            } else {
                const d = c as { c?: unknown; x?: number; k?: unknown[]; d?: number[] };
                if ('c' in d) {
                    cols.push(null as unknown as unknown[]);
                    consts.push(this.leafOrNull(d.c));
                } else if (d.x !== undefined && Array.isArray(d.k)) {
                    const kind = d.x;
                    cols.push(d.k.map((key) => this.external(kind, key)));
                    consts.push(undefined);
                } else if (Array.isArray(d.d)) {
                    const col = new Array<unknown>(n);
                    let acc = 0;
                    for (let i = 0; i < n; i++) col[i] = acc += d.d[i];
                    cols.push(col);
                    consts.push(undefined);
                } else throw new Error(`Bad table column ${keys[j]}.`);
            }
        }
        const ctor = this.shapeCtor(s, proto);
        const row = new Array<unknown>(k);
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < k; j++) row[j] = cols[j] === null ? consts[j] : cols[j][i];
            let inst: Record<string, unknown>;
            if (ctor !== null) inst = new ctor(row, 0, identity);
            else {
                inst = Object.create(proto) as Record<string, unknown>;
                this.options.revive?.get(proto)?.(inst);
                for (let j = 0; j < k; j++) Object.defineProperty(inst, keys[j], { value: row[j], writable: true, enumerable: true, configurable: true });
            }
            this.memo.push(inst);
            out.push(inst);
        }
        return out;
    }
}

const identity = (v: unknown): unknown => v;

/** Whether an encoding is inline (its value set by a shape constructor: a primitive, an external, a constant — not a
 *  reference, which is resolved in field order). */
function isInline(e: unknown): boolean {
    if (e === null || typeof e !== 'object') return true;
    if (!Array.isArray(e)) return false;
    const t = e[0];
    return typeof t === 'number' && ((t >= T_UNDEF && t <= T_NINF) || t === T_EXT);
}

function decPath(base: string, stack: readonly DecFrame[]): string {
    let p = base;
    for (const f of stack) p += f.keys !== null ? `.${f.keys[f.i - 1] ?? f.i - 1}` : `[${f.i - 1}]`;
    return p;
}

/**
 * One field of an encoded format-3 instance (a full row, or a sparse row's set field), without decoding the graph;
 * undefined when `encoded` is not an instance, has no such field, or leaves it unset.
 */
export function compactField(shapes: ShapeTable, encoded: unknown, field: string): Encoded | undefined {
    if (!Array.isArray(encoded) || typeof encoded[0] !== 'number' || encoded[0] < T_SHAPE) return undefined;
    const tag = encoded[0];
    const shape = shapes[(tag - T_SHAPE) >> 1];
    const i = shape === undefined ? -1 : shape.indexOf(field, 1);
    if (i < 1) return undefined;
    if ((tag & 1) === 0) return encoded[i] as Encoded;
    const mask = encoded[1] as string;
    let p = 2;
    for (let j = 0; j < i - 1; j++) {
        const c = Math.floor(j / 6);
        if (c < mask.length && (BASE64_VALUE[mask.charCodeAt(c)] >> (j % 6)) & 1) p++;
    }
    const j = i - 1;
    const c = Math.floor(j / 6);
    return c < mask.length && (BASE64_VALUE[mask.charCodeAt(c)] >> (j % 6)) & 1 ? (encoded[p] as Encoded) : undefined;
}
