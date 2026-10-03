// Sim worker: player-command arguments across the thread boundary (docs/sim-worker.md §4).
//
// The main thread issues commands with REPLICA objects as arguments (the selected ship, a target planet, a design).
// Each is sent as its replica sync id ({s: id}); the worker resolves that id to the authoritative object it synced the
// replica from — exact identity, whatever list the object is in and however stale the replica's cold data is. Static
// data travels as the save's externals ({x, k}); anything else (a ShipAction the order menu built, plain option
// objects, arrays) by value with its class name, as player/commandCodec.ts does. The worker then issues the command
// on the real galaxy with issuePlayerCommand, which journals it with the ordinary command-log codec — so the command
// log and replays are identical to in-thread play.
//
// No DOM / Pixi imports.

import { saveClassPrototypes } from '../sim/save/galaxySave';
import { ShipAction } from '../sim/player/shipAction';
import { TradeableItem } from '../sim/tradeItems';

export type RemoteArg = null | boolean | number | string | { [key: string]: unknown };

export class RemoteArgError extends Error {}

let classTables: { nameByProto: Map<object, string>; protoByName: Map<string, object> } | null = null;

function classes(): NonNullable<typeof classTables> {
    if (classTables === null) {
        const all: Record<string, object> = { ...saveClassPrototypes(), ShipAction: ShipAction.prototype, TradeableItem: TradeableItem.prototype };
        const nameByProto = new Map<object, string>();
        const protoByName = new Map<string, object>();
        for (const [name, proto] of Object.entries(all)) {
            nameByProto.set(proto, name);
            protoByName.set(name, proto);
        }
        classTables = { nameByProto, protoByName };
    }
    return classTables;
}

/** How the encoding side names objects: a replica sync id (≥ 0, else -1) or a static external (else undefined). */
export interface RemoteNaming {
    syncId(o: object): number;
    external(o: object): { kind: string; key: string | number } | undefined;
    /**
     * The main thread's identity of a by-value object (≥ 0, stable for the object's life; docs/sim-worker.md §4.3).
     * Without it (the worker's own encoding) a value shared within one argument still travels once.
     */
    valueId?(o: object): number;
}

/**
 * Encode one argument on the main thread.
 *
 * By-value objects keep their identity (docs/sim-worker.md §4.3): each carries a value id `v`. A second occurrence
 * in the same argument travels as `{v}` alone (shared and cyclic values decode to the same object, as the executor
 * would see them in-thread), and the worker decodes the same main-thread object sent by several commands to one
 * object (RemoteValues; e.g. a mission assigned by one command and framed by the next).
 */
export function encodeRemoteArg(value: unknown, naming: RemoteNaming): RemoteArg {
    const t = classes();
    const seen = new Map<object, number>();
    let local = 0;
    const enc = (v: unknown, path: string): RemoteArg => {
        if (v === null) return null;
        switch (typeof v) {
            case 'undefined':
                return { u: 1 };
            case 'boolean':
            case 'string':
                return v;
            case 'number':
                return Number.isFinite(v) ? v : { n: String(v) };
            case 'object':
                break;
            default:
                throw new RemoteArgError(`command argument ${path}: cannot send a ${typeof v}`);
        }
        const o = v as object;
        const ext = naming.external(o);
        if (ext !== undefined) return { x: ext.kind, k: ext.key };
        const id = naming.syncId(o);
        if (id >= 0) return { s: id };
        const again = seen.get(o);
        if (again !== undefined) return { v: again };
        const vid = naming.valueId !== undefined ? naming.valueId(o) : -++local;
        seen.set(o, vid);
        if (Array.isArray(o)) return { a: o.map((x, i) => enc(x, `${path}[${i}]`)), v: vid };
        const fields: Record<string, RemoteArg> = {};
        for (const k of Object.keys(o)) fields[k] = enc((o as Record<string, unknown>)[k], `${path}.${k}`);
        const proto = Object.getPrototypeOf(o) as object | null;
        if (proto === Object.prototype || proto === null) return { o: fields, v: vid };
        const name = t.nameByProto.get(proto);
        if (name === undefined) throw new RemoteArgError(`command argument ${path}: unregistered class ${(proto as { constructor?: { name?: string } }).constructor?.name ?? '?'}`);
        return { c: name, f: fields, v: vid };
    };
    return enc(value, '$');
}

/**
 * The worker's memory of the by-value objects it decoded recently, by main-thread value id (SimHost keeps one). In-thread
 * the UI and the executors hold one object: a mission the form built is assigned by one command and framed by the next;
 * the sim may change it after the first. So the same main-thread object sent again decodes to the same worker object:
 * - before its first command was applied (same boundary): refilled with the contents sent last (the executors see the
 *   UI's latest state, as in-thread at that boundary);
 * - after (a later boundary, within `keepBoundaries`): only the fields the main thread changed since it last sent the
 *   object are written, so the sim's own changes stay (what the shared object would hold in-thread).
 * Older entries are forgotten: an object sent again later is a fresh copy.
 */
export class RemoteValues {
    private readonly entries = new Map<number, { obj: object; sent: Map<string, string>; age: number }>();

    constructor(private readonly keepBoundaries = 2) {}

    /** A command boundary applied the commands decoded so far. */
    boundary(): void {
        for (const [vid, e] of this.entries) {
            if (++e.age > this.keepBoundaries) this.entries.delete(vid);
        }
    }

    get size(): number {
        return this.entries.size;
    }

    /** @internal decodeRemoteArg */
    entry(vid: number): { obj: object; sent: Map<string, string>; age: number } | undefined {
        return this.entries.get(vid);
    }

    /** @internal decodeRemoteArg */
    remember(vid: number, obj: object, sent: Map<string, string>): void {
        const e = this.entries.get(vid);
        if (e !== undefined && e.obj === obj) e.sent = sent;
        else this.entries.set(vid, { obj, sent, age: 0 });
    }
}

/** How the decoding side (worker) resolves names. */
export interface RemoteResolving {
    object(syncId: number): object | null;
    external(kind: string, key: string | number): object | undefined;
    /** Recent by-value objects (see RemoteValues); without it every by-value form decodes to a new object. */
    values?: RemoteValues;
}

/** Decode one argument in the worker. */
export function decodeRemoteArg(value: RemoteArg, resolving: RemoteResolving): unknown {
    const t = classes();
    const local = new Map<number, object>();
    const values = resolving.values;
    /**
     * Decode a by-value form into its object: a new one, or the recent one of the same value id and kind (RemoteValues).
     * `parts` are the form's fields (an array: one part, '' = the elements).
     */
    const byValue = (
        vid: number | undefined,
        make: () => object,
        sameKind: (o: object) => boolean,
        parts: Record<string, unknown>,
        assign: (out: object, changed: Map<string, unknown>, removed: string[]) => void,
        decodePart: (x: unknown) => unknown = dec,
    ): object => {
        const prev = vid !== undefined && vid >= 0 ? values?.entry(vid) : undefined;
        const reuse = prev !== undefined && sameKind(prev.obj) ? prev : undefined;
        const out = reuse?.obj ?? make();
        if (vid !== undefined) local.set(vid, out);
        const sent = new Map<string, string>();
        const changed = new Map<string, unknown>();
        for (const [k, x] of Object.entries(parts)) {
            const decoded = decodePart(x);
            const text = JSON.stringify(x);
            sent.set(k, text);
            // Applied already: only what the main thread changed since it last sent the object.
            if (reuse === undefined || reuse.age === 0 || reuse.sent.get(k) !== text) changed.set(k, decoded);
        }
        const removed = reuse === undefined ? [] : [...(reuse.age === 0 ? Object.keys(out) : reuse.sent.keys())].filter((k) => !(k in parts));
        assign(out, changed, removed);
        if (vid !== undefined && vid >= 0) values?.remember(vid, out, sent);
        return out;
    };
    const assignFields = (out: object, changed: Map<string, unknown>, removed: string[]): void => {
        const o = out as Record<string, unknown>;
        for (const k of removed) delete o[k];
        for (const [k, x] of changed) o[k] = x;
    };
    const dec = (v: unknown): unknown => {
        if (v === null || typeof v !== 'object') return v;
        const o = v as Record<string, unknown>;
        if ('u' in o) return undefined;
        if ('n' in o) return Number(o.n);
        if ('s' in o) {
            const obj = resolving.object(o.s as number);
            if (obj === null) throw new RemoteArgError(`command argument: sync id ${String(o.s)} is no longer in the game`);
            return obj;
        }
        if ('x' in o) {
            const obj = resolving.external(o.x as string, o.k as string | number);
            if (obj === undefined) throw new RemoteArgError(`command argument: unknown static ${String(o.x)}:${String(o.k)}`);
            return obj;
        }
        const vid = o.v as number | undefined;
        if ('a' in o) {
            return byValue(
                vid,
                () => [],
                (p) => Array.isArray(p),
                { '': o.a },
                (out, changed) => {
                    const items = changed.get('');
                    if (items === undefined) return;
                    const arr = out as unknown[];
                    arr.length = 0;
                    for (const x of items as unknown[]) arr.push(x);
                },
                (x) => (x as unknown[]).map(dec),
            );
        }
        if ('o' in o) return byValue(vid, () => ({}), (p) => !Array.isArray(p) && Object.getPrototypeOf(p) === Object.prototype, o.o as Record<string, unknown>, assignFields);
        if ('c' in o) {
            const proto = t.protoByName.get(o.c as string);
            if (proto === undefined) throw new RemoteArgError(`command argument: unknown class ${String(o.c)}`);
            return byValue(vid, () => Object.create(proto) as object, (p) => Object.getPrototypeOf(p) === proto, o.f as Record<string, unknown>, assignFields);
        }
        if (vid !== undefined) {
            // A back-reference to a value met earlier in this argument.
            const obj = local.get(vid);
            if (obj === undefined) throw new RemoteArgError(`command argument: value ${vid} referenced before it was sent`);
            return obj;
        }
        throw new RemoteArgError(`command argument: bad value ${JSON.stringify(v)}`);
    };
    return dec(value);
}
