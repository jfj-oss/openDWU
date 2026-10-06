// Generic object-graph codec for the save format (task: M3 save/load).
//
// The sim model is a cyclic graph of class instances (Galaxy → Empire →
// BuiltObject → Design → Empire ...) that C# serializes with reference
// tracking. This mirrors that: every non-primitive value is visited once, in a
// fixed depth-first order, and gets an implicit reference id (its visit
// index); later encounters encode as {$ref: id}. Both sides walk the graph in
// the same order, so ids never need to be stored. Class instances are rebuilt
// with Object.create(prototype) (no constructor runs — constructors consume
// Galaxy.Rnd and rebuild derived state) and their own fields are assigned in
// the saved order, so re-serializing a loaded graph gives the same key order
// and therefore the same JSON text.
//
// Static data (races, component definitions, ...) is not part of the graph:
// the caller registers those objects as "externals" and they encode as
// {$x: kind, k: key}, resolved against gameData on load.
//
// Encoding of one value:
//   null / boolean / string / finite number  → as is
//   undefined                                → {$u: 1}
//   NaN / ±Infinity                          → {$n: "NaN" | "Infinity" | "-Infinity"}
//   already-visited object                   → {$ref: n}
//   external                                 → {$x: kind, k: key}
//   Array                                    → [ ... ]
//   plain object                             → { ... } (keys must not start with '$')
//   Map / Set                                → {$map: [[k, v], ...]} / {$set: [...]}
//   Int8Array / Uint8Array / ...             → {$i8: [...]}, {$u8: [...]}, {$f32: ...}, ...
//   registered class instance                → {$s: shape, $v: [value, ...]}
//                                               (older saves: {$t: name, $f: { field: value, ... }}, still read)
//
// Shapes: a class instance's field names are written once per distinct (class, field list) — the encoder's `shapes`
// table, [className, field, field, ...] per shape id, which the caller stores next to the graph and hands back to the
// decoder. A 1400-star galaxy has ~840k instances but under 100 shapes; spelling the field names out per instance
// was ~2/3 of the save text (a 300M-char save after one game year, close to V8's ~537M-char string limit).

export type Encoded = null | boolean | number | string | Encoded[] | { [key: string]: Encoded };

export interface ExternalRef {
    kind: string;
    key: string | number;
}

export interface GraphCodecOptions {
    /** Class name → prototype for every class that may appear in the graph. */
    classes: Record<string, object>;
    /** Prototype → own fields to leave out (rebuilt by the caller after load). */
    skipFields?: Map<object, ReadonlySet<string>>;
    /** Prototype → hook run on each rebuilt instance right after Object.create, before its saved fields are
     *  assigned: restores state a constructor sets up that is not an own enumerable field (e.g. non-enumerable
     *  counters defined with Object.defineProperty). */
    revive?: Map<object, (instance: object) => void>;
    /** Rebuild {$s, $v} instances with one generated constructor per shape (see GraphDecoder.shapeFactory). Default
     *  true; false keeps Object.create + defineProperty for every instance (same graph, same key order). */
    shapeConstructors?: boolean;
}

/** A shape's generated constructor: `new S(values)` gives an instance of the shape's class with every field assigned in
 *  shape order — primitives (and the {$n} / {$u} number / undefined encodings) from `values`, null for the rest. */
type ShapeConstructor = new (values: Encoded[]) => Record<string, unknown>;

/** Whether an encoded value is decoded without memo entries or allocation (a primitive, {$n}, {$u}). */
function inlineValue(e: Encoded): boolean {
    if (e === null || typeof e !== 'object') return true;
    if (Array.isArray(e)) return false;
    for (const k in e) return k === '$n' || k === '$u';
    return false;
}

/** The value of an inline encoding (inlineValue), else the null placeholder the decoder overwrites. */
function inlineOrNull(e: Encoded): unknown {
    if (e === null || typeof e !== 'object') return e;
    if (Array.isArray(e)) return null;
    for (const k in e) {
        if (k === '$n') return Number((e as { $n: string }).$n);
        if (k === '$u') return undefined;
        return null;
    }
    return null;
}

/** Whether assigning `key` on an object with prototype `proto` could do anything but create a plain own data
 *  property: an accessor or a read-only property of that name on the prototype chain. */
function assignmentIntercepted(proto: object | null, key: string): boolean {
    for (let o = proto; o !== null; o = Object.getPrototypeOf(o) as object | null) {
        const d = Object.getOwnPropertyDescriptor(o, key);
        if (d !== undefined) return d.get !== undefined || d.set !== undefined || d.writable === false;
    }
    return false;
}

const TYPED_ARRAYS: [string, { new (values: ArrayLike<number>): ArrayLike<number>; prototype: object }][] = [
    ['$i8', Int8Array],
    ['$u8', Uint8Array],
    ['$i16', Int16Array],
    ['$u16', Uint16Array],
    ['$i32', Int32Array],
    ['$u32', Uint32Array],
    ['$f32', Float32Array],
    ['$f64', Float64Array],
];

/** Shape table: shapes[id] = [className, ...fieldNames] (see the file header). */
export type ShapeTable = string[][];

/**
 * JSON text in pieces (GraphEncoder.encodeJson): the pieces are joined and handed to `flush` every `chunkChars`
 * characters (and at `end`), so a caller can move each chunk out of the JS heap (encode it to bytes, a Blob) while the
 * rest is written.
 */
export class JsonWriter {
    private parts: string[] = [];
    private chars = 0;

    constructor(
        private readonly flush: (chunk: string) => void,
        private readonly chunkChars = 1 << 22,
    ) {}

    write(s: string): void {
        this.parts.push(s);
        this.chars += s.length;
        if (this.chars >= this.chunkChars) this.end();
    }

    /** Hand what is buffered to `flush` (nothing when empty). */
    end(): void {
        if (this.chars === 0) return;
        const chunk = this.parts.join('');
        this.parts = [];
        this.chars = 0;
        this.flush(chunk);
    }
}

/** The tag of a typed array ($i8 …), else null. */
function typedArrayTag(obj: object): string | null {
    if (!ArrayBuffer.isView(obj)) return null;
    for (const [tag, ctor] of TYPED_ARRAYS) if (obj instanceof ctor) return tag;
    return null;
}

/** A child not encoded / decoded yet: its frame is on the stack. */
const PENDING: unique symbol = Symbol('pending');

// Frame kinds of the iterative walks (GraphEncoder.encode / encodeJson, GraphDecoder.decode).
const F_ARRAY = 0;
const F_MAP = 1;
const F_SET = 2;
const F_PLAIN = 3;
const F_INSTANCE = 4;
/** Decoder only: an instance whose fields are defined (Object.defineProperty) as they are decoded. */
const F_DEFINED = 5;

/** One object being encoded: its children (child(j), j < n) are visited in order, i is the next one. */
class EncodeFrame {
    i = 0;
    /** encode only: store child j's encoding / the object's encoding once every child is done. */
    put: (j: number, v: Encoded) => void = () => undefined;
    finish: () => Encoded = () => null;
    constructor(
        readonly kind: number,
        readonly obj: object,
        /** Children: elements, map entries × 2 (key, value), set items, keys. */
        readonly n: number,
        readonly keys: string[] | null,
        readonly shape: number,
        readonly child: (j: number) => unknown,
    ) {}
}

/** The label of child j of a frame of `kind` (error paths: `[3]`, `.field`, `.<key 1>`). */
function childLabel(kind: number, j: number, keys: readonly string[] | null): string {
    switch (kind) {
        case F_ARRAY:
            return `[${j}]`;
        case F_MAP:
            return (j & 1) === 0 ? `.<key ${j >> 1}>` : `.<value ${j >> 1}>`;
        case F_SET:
            return `.<item ${j}>`;
        default:
            return `.${keys?.[j] ?? j}`;
    }
}

/** The path of the value being visited (built only for an error message). */
function encodePath(base: string, stack: readonly EncodeFrame[]): string {
    let p = base;
    for (const f of stack) p += childLabel(f.kind, f.i - 1, f.keys);
    return p;
}

export class GraphEncoder {
    private readonly memo = new Map<object, number>();
    private readonly nameByPrototype = new Map<object, string>();
    private readonly skipFields: Map<object, ReadonlySet<string>>;
    /** Every shape written so far, in first-use order (the save's shape table). */
    readonly shapes: ShapeTable = [];
    /** Prototype → its shapes so far ({field list, id}); an instance's field list is matched element-wise. */
    private readonly shapesByPrototype = new Map<object, { keys: string[]; id: number }[]>();

    constructor(options: GraphCodecOptions, private readonly externals: Map<object, ExternalRef>) {
        for (const name of Object.keys(options.classes)) this.nameByPrototype.set(options.classes[name], name);
        this.skipFields = options.skipFields ?? new Map();
    }

    /** Every object encoded so far (not externals), in visit order. */
    visited(): IterableIterator<object> {
        return this.memo.keys();
    }

    /**
     * The encoding of `value` (see the file header). Iterative, not recursive: the graph is walked depth first, and a
     * late-game galaxy's walk goes thousands of objects deep (empire → visibility → threat → ship → cargo → empire …:
     * ~2500 nested values in a 300 MB save); one JS call per level overflowed a worker's stack. The visit order — so
     * the memo ids and the shapes — is the recursive walk's.
     */
    encode(value: unknown, path = '$'): Encoded {
        const stack: EncodeFrame[] = [];
        const first = this.openValue(value, stack, path);
        if (first !== PENDING) return first;
        for (;;) {
            const f = stack[stack.length - 1];
            if (f.i < f.n) {
                const j = f.i++;
                if (f.kind === F_ARRAY && !(j in (f.obj as unknown[]))) continue; // a hole stays a hole (JSON: null)
                const v = this.openValue(f.child(j), stack, path);
                if (v !== PENDING) f.put(j, v);
                continue;
            }
            stack.pop();
            const done = f.finish();
            if (stack.length === 0) return done;
            const p = stack[stack.length - 1];
            p.put(p.i - 1, done);
        }
    }

    /** The encoding of a leaf value (returned), or PENDING with a frame for the object pushed on `stack`. */
    private openValue(value: unknown, stack: EncodeFrame[], basePath: string): Encoded | typeof PENDING {
        switch (typeof value) {
            case 'undefined':
                return { $u: 1 };
            case 'boolean':
            case 'string':
                return value;
            case 'number':
                if (Number.isFinite(value)) return value;
                return { $n: Number.isNaN(value) ? 'NaN' : value > 0 ? 'Infinity' : '-Infinity' };
            case 'object':
                break;
            default:
                throw new Error(`Cannot serialize a ${typeof value} at ${encodePath(basePath, stack)}.`);
        }
        if (value === null) return null;
        const obj = value as object;
        const external = this.externals.get(obj);
        if (external !== undefined) return { $x: external.kind, k: external.key };
        const ref = this.memo.get(obj);
        if (ref !== undefined) return { $ref: ref };
        this.memo.set(obj, this.memo.size);
        const typed = typedArrayTag(obj);
        if (typed !== null) return { [typed]: Array.from(obj as ArrayLike<number>) };
        const f = this.frameFor(obj, stack, basePath);
        if (f.kind === F_ARRAY) {
            const out = new Array<Encoded>((obj as unknown[]).length);
            f.put = (j, v) => (out[j] = v);
            f.finish = () => out;
        } else if (f.kind === F_MAP) {
            const entries: Encoded[] = [];
            let key: Encoded = null;
            f.put = (j, v) => {
                if ((j & 1) === 0) key = v;
                else entries.push([key, v]);
            };
            f.finish = () => ({ $map: entries });
        } else if (f.kind === F_SET) {
            const items: Encoded[] = [];
            f.put = (_j, v) => items.push(v);
            f.finish = () => ({ $set: items });
        } else if (f.kind === F_PLAIN) {
            const out: { [key: string]: Encoded } = {};
            const keys = f.keys!;
            f.put = (j, v) => (out[keys[j]] = v);
            f.finish = () => out;
        } else {
            const values: Encoded[] = new Array<Encoded>(f.n);
            const id = f.shape;
            f.put = (j, v) => (values[j] = v);
            f.finish = () => ({ $s: id, $v: values });
        }
        stack.push(f);
        return PENDING;
    }

    /** The frame of a (newly memoed, non-typed-array) object: its kind, children and labels; put / finish unset. */
    private frameFor(obj: object, stack: EncodeFrame[], basePath: string): EncodeFrame {
        if (Array.isArray(obj)) return new EncodeFrame(F_ARRAY, obj, obj.length, null, -1, (j) => (obj as unknown[])[j]);
        if (obj instanceof Map) {
            const entries = Array.from(obj as Map<unknown, unknown>);
            return new EncodeFrame(F_MAP, obj, entries.length * 2, null, -1, (j) => entries[j >> 1][j & 1]);
        }
        if (obj instanceof Set) {
            const items = Array.from(obj as Set<unknown>);
            return new EncodeFrame(F_SET, obj, items.length, null, -1, (j) => items[j]);
        }
        const proto = Object.getPrototypeOf(obj) as object | null;
        if (proto === null || proto === Object.prototype) {
            const keys = Object.keys(obj);
            for (const key of keys) {
                if (key.startsWith('$')) throw new Error(`Plain-object key ${key} at ${encodePath(basePath, stack)} must not start with '$'.`);
            }
            return new EncodeFrame(F_PLAIN, obj, keys.length, keys, -1, (j) => (obj as Record<string, unknown>)[keys[j]]);
        }
        const name = this.nameByPrototype.get(proto);
        if (name === undefined) {
            const ctorName = (proto as { constructor?: { name?: string } }).constructor?.name ?? '?';
            throw new Error(`Cannot serialize an instance of ${ctorName} at ${encodePath(basePath, stack)}: class not registered with the save codec.`);
        }
        const skip = this.skipFields.get(proto);
        let keys = Object.keys(obj);
        if (skip !== undefined) keys = keys.filter((key) => !skip.has(key));
        const id = this.shapeId(proto, name, keys);
        return new EncodeFrame(F_INSTANCE, obj, keys.length, keys, id, (j) => (obj as Record<string, unknown>)[keys[j]]);
    }

    /**
     * `JSON.stringify(this.encode(value, path))` written straight to `out`, without building the encoded tree: the same
     * visit order (memo ids, shapes) and exactly the same text. A late-game galaxy's encoded tree was several hundred MB
     * of short-lived objects on top of the game itself — with the final string, the save's peak memory (a 100k-habitat
     * autosave pushed the page past V8's heap cage and crashed it). Iterative, as encode.
     */
    encodeJson(value: unknown, out: JsonWriter, path = '$'): void {
        const stack: EncodeFrame[] = [];
        if (!this.openJson(value, out, stack, path)) return;
        for (;;) {
            const f = stack[stack.length - 1];
            if (f.i < f.n) {
                const j = f.i++;
                switch (f.kind) {
                    case F_ARRAY:
                        if (j > 0) out.write(',');
                        // (encode keeps holes, which JSON.stringify then writes as null.)
                        if (!(j in (f.obj as unknown[]))) {
                            out.write('null');
                            continue;
                        }
                        break;
                    case F_MAP:
                        out.write(j === 0 ? '[' : (j & 1) === 0 ? '],[' : ',');
                        break;
                    case F_PLAIN:
                        out.write(j === 0 ? `${JSON.stringify(f.keys![j])}:` : `,${JSON.stringify(f.keys![j])}:`);
                        break;
                    default:
                        if (j > 0) out.write(',');
                }
                this.openJson(f.child(j), out, stack, path);
                continue;
            }
            stack.pop();
            switch (f.kind) {
                case F_ARRAY:
                    out.write(']');
                    break;
                case F_MAP:
                    out.write(f.n > 0 ? ']]}' : ']}');
                    break;
                case F_PLAIN:
                    out.write('}');
                    break;
                default:
                    out.write(']}');
            }
            if (stack.length === 0) return;
        }
    }

    /** Write a leaf value (false), or an object's opening and push its frame (true). */
    private openJson(value: unknown, out: JsonWriter, stack: EncodeFrame[], basePath: string): boolean {
        switch (typeof value) {
            case 'undefined':
                out.write('{"$u":1}');
                return false;
            case 'boolean':
                out.write(value ? 'true' : 'false');
                return false;
            case 'string':
                out.write(JSON.stringify(value));
                return false;
            case 'number':
                if (Number.isFinite(value)) out.write(String(value));
                else out.write(Number.isNaN(value) ? '{"$n":"NaN"}' : value > 0 ? '{"$n":"Infinity"}' : '{"$n":"-Infinity"}');
                return false;
            case 'object':
                break;
            default:
                throw new Error(`Cannot serialize a ${typeof value} at ${encodePath(basePath, stack)}.`);
        }
        if (value === null) {
            out.write('null');
            return false;
        }
        const obj = value as object;
        const external = this.externals.get(obj);
        if (external !== undefined) {
            out.write(`{"$x":${JSON.stringify(external.kind)},"k":${JSON.stringify(external.key)}}`);
            return false;
        }
        const ref = this.memo.get(obj);
        if (ref !== undefined) {
            out.write(`{"$ref":${ref}}`);
            return false;
        }
        this.memo.set(obj, this.memo.size);
        const typed = typedArrayTag(obj);
        if (typed !== null) {
            const a = obj as ArrayLike<number>;
            out.write(`{"${typed}":[`);
            // (JSON.stringify writes a non-finite element as null.)
            for (let i = 0; i < a.length; i++) {
                const x = a[i];
                out.write(i > 0 ? (Number.isFinite(x) ? `,${x}` : ',null') : Number.isFinite(x) ? String(x) : 'null');
            }
            out.write(']}');
            return false;
        }
        const f = this.frameFor(obj, stack, basePath);
        switch (f.kind) {
            case F_ARRAY:
                out.write('[');
                break;
            case F_MAP:
                out.write('{"$map":[');
                break;
            case F_SET:
                out.write('{"$set":[');
                break;
            case F_PLAIN:
                out.write('{');
                break;
            default:
                out.write(`{"$s":${f.shape},"$v":[`);
        }
        stack.push(f);
        return true;
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

export class GraphDecoder {
    private readonly memo: unknown[] = [];
    /** shapeFactory results by shape id (null: use Object.create + defineProperty for that shape). */
    private readonly factories: (ShapeConstructor | null)[] = [];

    constructor(
        private readonly options: GraphCodecOptions,
        private readonly resolveExternal: (ref: ExternalRef) => unknown,
        /** The encoder's shape table (GraphEncoder.shapes) for {$s, $v} instances; absent in older saves. */
        private readonly shapes: ShapeTable = [],
    ) {}

    /**
     * Perf: a generated constructor for a shape (`this.f0 = …; this.f1 = …` in shape order, prototype = the class's),
     * so every instance of the shape is built on one hidden class with its fields stored in the object itself. Object.create
     * + defineProperty per field gave each instance a map grown field by field with almost every field out-of-object
     * (72 maps for the built objects of a 2-year 2500-star save): a loaded game ticked 15-45% slower than the same
     * state built in place (megamorphic, extra-indirection field loads in every hot sim loop). The result is the same
     * graph: the same own enumerable writable configurable data properties, in the same order, with the same values,
     * and the same memo order (the instance is registered before its object-valued fields are decoded, in field order;
     * inline values push nothing). Null — the defineProperty path — for shapes with a revive hook, a key an assignment
     * would not simply define (an accessor / read-only property up the chain, `__proto__`, a duplicate), or no Function.
     */
    private shapeFactory(id: number, shape: string[], proto: object): ShapeConstructor | null {
        const known = this.factories[id];
        if (known !== undefined) return known;
        let S: ShapeConstructor | null = null;
        const keys = shape.slice(1);
        const usable =
            this.options.shapeConstructors !== false &&
            this.options.revive?.has(proto) !== true &&
            new Set(keys).size === keys.length &&
            keys.every((k) => k !== '__proto__' && !assignmentIntercepted(proto, k));
        if (usable) {
            try {
                const body = keys.map((k, i) => `this${/^[A-Za-z_$][\w$]*$/.test(k) ? `.${k}` : `[${JSON.stringify(k)}]`} = f(v[${i}]);`).join('\n');
                const make = new Function('f', `return function Shape(v) {\n${body}\n};`) as (f: typeof inlineOrNull) => ShapeConstructor & { prototype: object };
                const ctor = make(inlineOrNull);
                ctor.prototype = proto;
                S = ctor;
            } catch {
                S = null; // e.g. code generation disallowed: the defineProperty path
            }
        }
        this.factories[id] = S;
        return S;
    }

    /**
     * The value `value` encodes. Iterative, not recursive (see GraphEncoder.encode: a late-game save nests thousands of
     * values deep, and one JS call per level overflowed the worker's stack — "Maximum call stack size exceeded" loading
     * a 300 MB save). The same order as the recursive walk: an object is registered (memo) before its children, its
     * children are decoded in order, and each is stored as soon as it is complete.
     */
    decode(value: Encoded, path = '$'): unknown {
        const stack: DecodeFrame[] = [];
        const first = this.openValue(value, stack, path);
        if (first !== PENDING) return first;
        for (;;) {
            const f = stack[stack.length - 1];
            if (f.i < f.n) {
                const j = f.i++;
                const e = f.kind === F_MAP ? (f.src[j >> 1] as Encoded[])[j & 1] : f.src[j];
                if (f.kind === F_INSTANCE && inlineValue(e)) continue; // set by the shape constructor
                const v = this.openValue(e, stack, path);
                if (v !== PENDING) putDecoded(f, j, v);
                continue;
            }
            stack.pop();
            if (stack.length === 0) return f.out;
            const p = stack[stack.length - 1];
            putDecoded(p, p.i - 1, f.out);
        }
    }

    /** A leaf's value (returned), or PENDING with the new object's frame pushed on `stack` (the object is memoed). */
    private openValue(value: Encoded, stack: DecodeFrame[], basePath: string): unknown {
        if (value === null || typeof value !== 'object') return value;
        if (Array.isArray(value)) {
            const out: unknown[] = [];
            this.memo.push(out);
            stack.push(new DecodeFrame(F_ARRAY, out, value, value.length, null, 0));
            return PENDING;
        }
        const keys = Object.keys(value);
        const tag = keys.length > 0 && keys[0].startsWith('$') ? keys[0] : null;
        if (tag === null) {
            const out: Record<string, unknown> = {};
            this.memo.push(out);
            stack.push(new DecodeFrame(F_PLAIN, out, keys.map((k) => value[k]), keys.length, keys, 0));
            return PENDING;
        }
        switch (tag) {
            case '$u':
                return undefined;
            case '$n':
                return Number(value.$n);
            case '$ref': {
                const index = value.$ref as number;
                if (index >= this.memo.length) throw new Error(`Forward reference ${index} at ${decodePath(basePath, stack)}.`);
                return this.memo[index];
            }
            case '$x': {
                const resolved = this.resolveExternal({ kind: value.$x as string, key: value.k as string | number });
                if (resolved === undefined) throw new Error(`Unresolved external ${String(value.$x)}:${String(value.k)} at ${decodePath(basePath, stack)}.`);
                return resolved;
            }
            case '$map': {
                const out = new Map<unknown, unknown>();
                this.memo.push(out);
                const entries = value.$map as Encoded[];
                stack.push(new DecodeFrame(F_MAP, out, entries, entries.length * 2, null, 0));
                return PENDING;
            }
            case '$set': {
                const out = new Set<unknown>();
                this.memo.push(out);
                const items = value.$set as Encoded[];
                stack.push(new DecodeFrame(F_SET, out, items, items.length, null, 0));
                return PENDING;
            }
            case '$s': {
                const shape = this.shapes[value.$s as number];
                if (shape === undefined) throw new Error(`Unknown shape ${String(value.$s)} at ${decodePath(basePath, stack)}.`);
                const proto = this.options.classes[shape[0]];
                if (proto === undefined) throw new Error(`Unknown class ${shape[0]} at ${decodePath(basePath, stack)}.`);
                const S = this.shapeFactory(value.$s as number, shape, proto);
                const values = value.$v as Encoded[];
                if (S !== null) {
                    const out = new S(values);
                    this.memo.push(out);
                    stack.push(new DecodeFrame(F_INSTANCE, out, values, values.length, shape, 1));
                    return PENDING;
                }
                const out = Object.create(proto) as Record<string, unknown>;
                this.options.revive?.get(proto)?.(out);
                this.memo.push(out);
                // Defined, not assigned: see '$t' below.
                stack.push(new DecodeFrame(F_DEFINED, out, values, values.length, shape, 1));
                return PENDING;
            }
            case '$t': {
                const name = value.$t as string;
                const proto = this.options.classes[name];
                if (proto === undefined) throw new Error(`Unknown class ${name} at ${decodePath(basePath, stack)}.`);
                const out = Object.create(proto) as Record<string, unknown>;
                this.options.revive?.get(proto)?.(out);
                this.memo.push(out);
                const fields = value.$f as { [key: string]: Encoded };
                // Defined rather than assigned: the same data property an assignment creates (no setter on the
                // prototype chain is involved in either the save's own fields or here), but V8 keeps an instance whose
                // many fields are added by computed-key assignment in dictionary mode — a loaded game then ticked
                // ~2-3x slower than a new one — while defined properties stay fast, on shared maps.
                const fieldKeys = Object.keys(fields);
                stack.push(new DecodeFrame(F_DEFINED, out, fieldKeys.map((k) => fields[k]), fieldKeys.length, fieldKeys, 0));
                return PENDING;
            }
            default: {
                for (const [t, ctor] of TYPED_ARRAYS) {
                    if (tag === t) {
                        const out = new ctor(value[t] as number[]);
                        this.memo.push(out);
                        return out;
                    }
                }
                throw new Error(`Unknown tag ${tag} at ${decodePath(basePath, stack)}.`);
            }
        }
    }
}

/** One object being decoded: child j (j < n) is src[j] (a map: entry j >> 1, key / value j & 1), i the next one. */
class DecodeFrame {
    i = 0;
    /** A map's key, decoded, waiting for its value. */
    key: unknown = undefined;
    constructor(
        readonly kind: number,
        readonly out: unknown,
        readonly src: readonly Encoded[],
        readonly n: number,
        /** Field names (child j: keys[j + off]; a shape row starts with its class name: off 1). */
        readonly keys: readonly string[] | null,
        readonly off: number,
    ) {}
}

/** Store child j's value in the frame's object (as the recursive decoder did once the child had returned). */
function putDecoded(f: DecodeFrame, j: number, v: unknown): void {
    switch (f.kind) {
        case F_ARRAY:
            (f.out as unknown[]).push(v);
            return;
        case F_PLAIN:
        case F_INSTANCE:
            (f.out as Record<string, unknown>)[f.keys![j + f.off]] = v;
            return;
        case F_MAP:
            if ((j & 1) === 0) f.key = v;
            else (f.out as Map<unknown, unknown>).set(f.key, v);
            return;
        case F_SET:
            (f.out as Set<unknown>).add(v);
            return;
        default:
            Object.defineProperty(f.out, f.keys![j + f.off], { value: v, writable: true, enumerable: true, configurable: true });
    }
}

/** The path of the value being decoded (built only for an error message). */
function decodePath(base: string, stack: readonly DecodeFrame[]): string {
    let p = base;
    for (const f of stack) p += childLabel(f.kind === F_DEFINED ? F_INSTANCE : f.kind, f.i - 1 + f.off, f.keys);
    return p;
}
