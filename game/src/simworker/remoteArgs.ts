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
}

/** Encode one argument on the main thread. */
export function encodeRemoteArg(value: unknown, naming: RemoteNaming): RemoteArg {
    const t = classes();
    const stack = new Set<object>();
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
        if (stack.has(o)) throw new RemoteArgError(`command argument ${path}: cyclic value`);
        stack.add(o);
        try {
            if (Array.isArray(o)) return { a: o.map((x, i) => enc(x, `${path}[${i}]`)) };
            const fields: Record<string, RemoteArg> = {};
            for (const k of Object.keys(o)) fields[k] = enc((o as Record<string, unknown>)[k], `${path}.${k}`);
            const proto = Object.getPrototypeOf(o) as object | null;
            if (proto === Object.prototype || proto === null) return { o: fields };
            const name = t.nameByProto.get(proto);
            if (name === undefined) throw new RemoteArgError(`command argument ${path}: unregistered class ${(proto as { constructor?: { name?: string } }).constructor?.name ?? '?'}`);
            return { c: name, f: fields };
        } finally {
            stack.delete(o);
        }
    };
    return enc(value, '$');
}

/** How the decoding side (worker) resolves names. */
export interface RemoteResolving {
    object(syncId: number): object | null;
    external(kind: string, key: string | number): object | undefined;
}

/** Decode one argument in the worker. */
export function decodeRemoteArg(value: RemoteArg, resolving: RemoteResolving): unknown {
    const t = classes();
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
        if ('a' in o) return (o.a as unknown[]).map(dec);
        if ('o' in o) {
            const out: Record<string, unknown> = {};
            for (const [k, x] of Object.entries(o.o as Record<string, unknown>)) out[k] = dec(x);
            return out;
        }
        if ('c' in o) {
            const proto = t.protoByName.get(o.c as string);
            if (proto === undefined) throw new RemoteArgError(`command argument: unknown class ${String(o.c)}`);
            const out = Object.create(proto) as Record<string, unknown>;
            for (const [k, x] of Object.entries(o.f as Record<string, unknown>)) out[k] = dec(x);
            return out;
        }
        throw new RemoteArgError(`command argument: bad value ${JSON.stringify(v)}`);
    };
    return dec(value);
}
