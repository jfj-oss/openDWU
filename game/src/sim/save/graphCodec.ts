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

    encode(value: unknown, path = '$'): Encoded {
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
                throw new Error(`Cannot serialize a ${typeof value} at ${path}.`);
        }
        if (value === null) return null;
        const obj = value as object;

        const external = this.externals.get(obj);
        if (external !== undefined) return { $x: external.kind, k: external.key };
        const ref = this.memo.get(obj);
        if (ref !== undefined) return { $ref: ref };
        this.memo.set(obj, this.memo.size);

        if (Array.isArray(obj)) {
            return obj.map((item, i) => this.encode(item, `${path}[${i}]`));
        }
        if (obj instanceof Map) {
            const entries: Encoded[] = [];
            let i = 0;
            for (const [k, v] of obj) {
                entries.push([this.encode(k, `${path}.<key ${i}>`), this.encode(v, `${path}.<value ${i}>`)]);
                i++;
            }
            return { $map: entries };
        }
        if (obj instanceof Set) {
            const items: Encoded[] = [];
            let i = 0;
            for (const v of obj) items.push(this.encode(v, `${path}.<item ${i++}>`));
            return { $set: items };
        }
        for (const [tag, ctor] of TYPED_ARRAYS) {
            if (obj instanceof ctor) return { [tag]: Array.from(obj as ArrayLike<number>) };
        }

        const proto = Object.getPrototypeOf(obj) as object | null;
        if (proto === null || proto === Object.prototype) {
            const out: { [key: string]: Encoded } = {};
            for (const key of Object.keys(obj)) {
                if (key.startsWith('$')) throw new Error(`Plain-object key ${key} at ${path} must not start with '$'.`);
                out[key] = this.encode((obj as Record<string, unknown>)[key], `${path}.${key}`);
            }
            return out;
        }
        const name = this.nameByPrototype.get(proto);
        if (name === undefined) {
            const ctorName = (proto as { constructor?: { name?: string } }).constructor?.name ?? '?';
            throw new Error(`Cannot serialize an instance of ${ctorName} at ${path}: class not registered with the save codec.`);
        }
        const skip = this.skipFields.get(proto);
        let keys = Object.keys(obj);
        if (skip !== undefined) keys = keys.filter((key) => !skip.has(key));
        const id = this.shapeId(proto, name, keys);
        const values: Encoded[] = new Array<Encoded>(keys.length);
        for (let i = 0; i < keys.length; i++) values[i] = this.encode((obj as Record<string, unknown>)[keys[i]], `${path}.${keys[i]}`);
        return { $s: id, $v: values };
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

    constructor(
        private readonly options: GraphCodecOptions,
        private readonly resolveExternal: (ref: ExternalRef) => unknown,
        /** The encoder's shape table (GraphEncoder.shapes) for {$s, $v} instances; absent in older saves. */
        private readonly shapes: ShapeTable = [],
    ) {}

    decode(value: Encoded, path = '$'): unknown {
        if (value === null || typeof value !== 'object') return value;
        if (Array.isArray(value)) {
            const out: unknown[] = [];
            this.memo.push(out);
            for (let i = 0; i < value.length; i++) out.push(this.decode(value[i], `${path}[${i}]`));
            return out;
        }
        const keys = Object.keys(value);
        const tag = keys.length > 0 && keys[0].startsWith('$') ? keys[0] : null;
        if (tag === null) {
            const out: Record<string, unknown> = {};
            this.memo.push(out);
            for (const key of keys) out[key] = this.decode(value[key], `${path}.${key}`);
            return out;
        }
        switch (tag) {
            case '$u':
                return undefined;
            case '$n':
                return Number(value.$n);
            case '$ref': {
                const index = value.$ref as number;
                if (index >= this.memo.length) throw new Error(`Forward reference ${index} at ${path}.`);
                return this.memo[index];
            }
            case '$x': {
                const resolved = this.resolveExternal({ kind: value.$x as string, key: value.k as string | number });
                if (resolved === undefined) throw new Error(`Unresolved external ${String(value.$x)}:${String(value.k)} at ${path}.`);
                return resolved;
            }
            case '$map': {
                const out = new Map<unknown, unknown>();
                this.memo.push(out);
                const entries = value.$map as Encoded[][];
                for (let i = 0; i < entries.length; i++) {
                    const k = this.decode(entries[i][0], `${path}.<key ${i}>`);
                    out.set(k, this.decode(entries[i][1], `${path}.<value ${i}>`));
                }
                return out;
            }
            case '$set': {
                const out = new Set<unknown>();
                this.memo.push(out);
                const items = value.$set as Encoded[];
                for (let i = 0; i < items.length; i++) out.add(this.decode(items[i], `${path}.<item ${i}>`));
                return out;
            }
            case '$s': {
                const shape = this.shapes[value.$s as number];
                if (shape === undefined) throw new Error(`Unknown shape ${String(value.$s)} at ${path}.`);
                const proto = this.options.classes[shape[0]];
                if (proto === undefined) throw new Error(`Unknown class ${shape[0]} at ${path}.`);
                const out = Object.create(proto) as Record<string, unknown>;
                this.options.revive?.get(proto)?.(out);
                this.memo.push(out);
                const values = value.$v as Encoded[];
                // Defined, not assigned: see '$t' below.
                for (let i = 0; i < values.length; i++) {
                    const key = shape[i + 1];
                    Object.defineProperty(out, key, { value: this.decode(values[i], `${path}.${key}`), writable: true, enumerable: true, configurable: true });
                }
                return out;
            }
            case '$t': {
                const name = value.$t as string;
                const proto = this.options.classes[name];
                if (proto === undefined) throw new Error(`Unknown class ${name} at ${path}.`);
                const out = Object.create(proto) as Record<string, unknown>;
                this.options.revive?.get(proto)?.(out);
                this.memo.push(out);
                const fields = value.$f as { [key: string]: Encoded };
                // Defined rather than assigned: the same data property an assignment creates (no setter on the
                // prototype chain is involved in either the save's own fields or here), but V8 keeps an instance whose
                // many fields are added by computed-key assignment in dictionary mode — a loaded game then ticked
                // ~2-3x slower than a new one — while defined properties stay fast, on shared maps.
                for (const key of Object.keys(fields)) {
                    Object.defineProperty(out, key, { value: this.decode(fields[key], `${path}.${key}`), writable: true, enumerable: true, configurable: true });
                }
                return out;
            }
            default: {
                for (const [t, ctor] of TYPED_ARRAYS) {
                    if (tag === t) {
                        const out = new ctor(value[t] as number[]);
                        this.memo.push(out);
                        return out;
                    }
                }
                throw new Error(`Unknown tag ${tag} at ${path}.`);
            }
        }
    }
}
