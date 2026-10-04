// Command-log argument codec (tasks/M4-agent-brief.md "Command log"): the arguments of a player command, as the
// executor receives them (sim objects, ShipAction, plain data), become JSON that a fresh game built from the same seed
// resolves back to the same objects at the same frame boundary.
//
// - Sim entities are references by a stable key that exists in the save too: BuiltObject → builtObjectID, Habitat →
//   habitatIndex, Empire → index in the flat empire list (galaxySave.flatEmpireList), ShipGroup / Design / Character /
//   Troop / TechNode → owner empire + index in its list, Creature / SystemInfo → galaxy list index, a queued advisor
//   suggestion → owner empire + its stable id (EmpireMessage.advisorSuggestionId), Fighter → its carrier's builtObjectID +
//   its fighterID (Galaxy.GetNextFighterID; a fighter lives only in its carrier's Fighters list). Every key is
//   resolved back when it is written and must give the same object, else the command is not replayable (throws).
// - Static data (races, components, facilities, plagues, …) → the save's externals ({kind, key}).
// - Other class instances of the save registry (plus ShipAction, TradeableItem) and plain objects / arrays → by value.
//
// Headless: no DOM / Pixi. Never touches galaxy.rnd.

import type { Galaxy } from '../galaxy';
import { Empire } from '../empire';
import { BuiltObject } from '../builtObject';
import { Habitat, type SystemInfo } from '../types';
import { ShipGroup } from '../fleets/shipGroup';
import { Design } from '../design';
import { Creature } from '../creature';
import { Fighter } from '../combat/fighters';
import { Character } from '../characters';
import { Troop } from '../cargo';
import { TradeableItem } from '../tradeItems';
import { EmpireMessage } from '../messages';
import { findAdvisorSuggestion } from '../advisorQueue';
import { ShipAction } from './shipAction';
import { flatEmpireList, galaxyExternals, saveClassPrototypes } from '../save/galaxySave';
import type { TechNode } from '../researchSystem';

/** JSON form of one argument. */
export type EncodedArg = null | boolean | number | string | { [key: string]: unknown };

export class CommandEncodeError extends Error {}

interface CodecTables {
    byObject: Map<object, { kind: string; key: string | number }>;
    byRef: Map<string, object>;
    nameByProto: Map<object, string>;
    protoByName: Map<string, object>;
}

const tablesByGalaxy = new WeakMap<Galaxy, CodecTables>();

function tables(galaxy: Galaxy): CodecTables {
    let t = tablesByGalaxy.get(galaxy);
    if (t === undefined) {
        const ext = galaxyExternals(galaxy);
        const nameByProto = new Map<object, string>();
        const protoByName = new Map<string, object>();
        const classes: Record<string, object> = { ...saveClassPrototypes(), ShipAction: ShipAction.prototype, TradeableItem: TradeableItem.prototype };
        for (const [name, proto] of Object.entries(classes)) {
            nameByProto.set(proto, name);
            protoByName.set(name, proto);
        }
        t = { byObject: ext.byObject, byRef: ext.byRef, nameByProto, protoByName };
        tablesByGalaxy.set(galaxy, t);
    }
    return t;
}

function isSystemInfo(galaxy: Galaxy, o: object): o is SystemInfo {
    const s = o as SystemInfo;
    return s.systemStar instanceof Habitat && Array.isArray(s.habitats) && galaxy.systems[s.systemStar.systemIndex] === o;
}

function isTechNode(o: object): o is TechNode {
    const n = o as TechNode;
    return Array.isArray(n.parentNodes) && typeof n.isResearched === 'boolean' && n.def !== undefined;
}

function findBuiltObject(galaxy: Galaxy, id: number): BuiltObject | null {
    for (const b of galaxy.builtObjects) if (b != null && b.builtObjectID === id) return b;
    for (const e of flatEmpireList(galaxy)) {
        for (const b of e.builtObjects) if (b != null && b.builtObjectID === id) return b;
        for (const b of e.privateBuiltObjects) if (b != null && b.builtObjectID === id) return b;
    }
    return null;
}

/** Entity reference → [kind, key], or null when `v` is not an entity kind. */
function entityKey(galaxy: Galaxy, v: object): [string, number | number[]] | null {
    const empires = flatEmpireList(galaxy);
    const ownerIndex = (e: Empire | null | undefined): number => (e == null ? -1 : empires.indexOf(e));
    if (v instanceof BuiltObject) return ['bo', v.builtObjectID];
    if (v instanceof Habitat) return ['h', v.habitatIndex];
    if (v instanceof Empire) return ['e', empires.indexOf(v)];
    if (v instanceof ShipGroup) {
        const ei = ownerIndex(v.empire);
        return ['sg', [ei, ei < 0 ? -1 : empires[ei].shipGroups.indexOf(v)]];
    }
    if (v instanceof Design) {
        for (let i = 0; i < empires.length; i++) {
            const j = empires[i].designs.indexOf(v);
            if (j >= 0) return ['d', [i, j]];
        }
        return null; // a draft not in any list: by value
    }
    if (v instanceof Character) {
        for (let i = 0; i < empires.length; i++) {
            const j = empires[i].characters.indexOf(v);
            if (j >= 0) return ['ch', [i, j]];
        }
        throw new CommandEncodeError('command argument: a Character in no empire list');
    }
    if (v instanceof Troop) {
        for (let i = 0; i < empires.length; i++) {
            const j = empires[i].troops.items.indexOf(v);
            if (j >= 0) return ['tr', [i, j]];
        }
        throw new CommandEncodeError('command argument: a Troop in no empire list');
    }
    if (v instanceof EmpireMessage) {
        // A queued advisor suggestion (Empire.advisorSuggestions) by its stable id (advisorQueue.ts; 'advid'), or by
        // position when it has none (a suggestion queued without addAdvisorSuggestion; logs from before the ids also
        // say 'adv'); any other message by value.
        for (let i = 0; i < empires.length; i++) {
            const j = (empires[i].advisorSuggestions as unknown[]).indexOf(v);
            if (j < 0) continue;
            return typeof v.advisorSuggestionId === 'number' ? ['advid', [i, v.advisorSuggestionId]] : ['adv', [i, j]];
        }
        return null;
    }
    if (v instanceof Creature) return ['cr', galaxy.creatures.indexOf(v)];
    if (v instanceof Fighter) {
        const carrier = v.parentBuiltObject;
        if (carrier === null) throw new CommandEncodeError('command argument: a Fighter with no carrier');
        return ['fi', [carrier.builtObjectID, v.fighterID]];
    }
    if (isSystemInfo(galaxy, v)) return ['sys', v.systemStar.systemIndex];
    if (isTechNode(v)) {
        for (let i = 0; i < empires.length; i++) {
            const j = empires[i].research.techTree.indexOf(v);
            if (j >= 0) return ['tn', [i, j]];
        }
        throw new CommandEncodeError('command argument: a TechNode in no empire research tree');
    }
    return null;
}

function resolveEntity(galaxy: Galaxy, kind: string, key: number | number[]): unknown {
    const empires = flatEmpireList(galaxy);
    const pair = (k: number | number[]): [Empire | undefined, number] => {
        const [i, j] = k as number[];
        return [empires[i], j];
    };
    switch (kind) {
        case 'bo':
            return findBuiltObject(galaxy, key as number);
        case 'h':
            return galaxy.habitats[key as number] ?? null;
        case 'e':
            return empires[key as number] ?? null;
        case 'sg': {
            const [e, j] = pair(key);
            return e?.shipGroups[j] ?? null;
        }
        case 'd': {
            const [e, j] = pair(key);
            return e?.designs[j] ?? null;
        }
        case 'ch': {
            const [e, j] = pair(key);
            return e?.characters[j] ?? null;
        }
        case 'tr': {
            const [e, j] = pair(key);
            return e?.troops.items[j] ?? null;
        }
        case 'adv': {
            const [e, j] = pair(key);
            return (e?.advisorSuggestions as unknown[] | undefined)?.[j] ?? null;
        }
        case 'advid': {
            const [e, id] = pair(key);
            return e === undefined ? null : findAdvisorSuggestion(e, id);
        }
        case 'cr':
            return galaxy.creatures[key as number] ?? null;
        case 'fi': {
            const [carrierId, fighterId] = key as number[];
            const carrier = findBuiltObject(galaxy, carrierId);
            return (carrier?.fighters as Fighter[] | null | undefined)?.find((f) => f.fighterID === fighterId) ?? null;
        }
        case 'sys':
            return galaxy.systems[key as number] ?? null;
        case 'tn': {
            const [e, j] = pair(key);
            return e?.research.techTree[j] ?? null;
        }
    }
    throw new CommandEncodeError(`command log: unknown reference kind ${kind}`);
}

/** Encode one command argument (see the file header). Throws CommandEncodeError when it cannot be replayed. */
export function encodeCommandArg(galaxy: Galaxy, value: unknown): EncodedArg {
    const t = tables(galaxy);
    const stack = new Set<object>();
    const enc = (v: unknown, path: string): EncodedArg => {
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
                throw new CommandEncodeError(`command argument ${path}: cannot encode a ${typeof v}`);
        }
        const o = v as object;
        const ext = t.byObject.get(o);
        if (ext !== undefined) return { x: ext.kind, k: ext.key };
        const ek = entityKey(galaxy, o);
        if (ek !== null) {
            if (resolveEntity(galaxy, ek[0], ek[1]) !== o) throw new CommandEncodeError(`command argument ${path}: ${ek[0]} ${JSON.stringify(ek[1])} does not resolve back to the same object`);
            return { r: ek[0], k: ek[1] };
        }
        if (stack.has(o)) throw new CommandEncodeError(`command argument ${path}: cyclic value`);
        stack.add(o);
        try {
            if (Array.isArray(o)) return { a: o.map((x, i) => enc(x, `${path}[${i}]`)) };
            const proto = Object.getPrototypeOf(o) as object | null;
            const fields: Record<string, EncodedArg> = {};
            for (const k of Object.keys(o)) fields[k] = enc((o as Record<string, unknown>)[k], `${path}.${k}`);
            if (proto === Object.prototype || proto === null) return { o: fields };
            const name = t.nameByProto.get(proto!);
            if (name === undefined) throw new CommandEncodeError(`command argument ${path}: unregistered class ${(proto as { constructor?: { name?: string } }).constructor?.name ?? '?'}`);
            return { c: name, f: fields };
        } finally {
            stack.delete(o);
        }
    };
    return enc(value, '$');
}

/** Decode an encodeCommandArg value against `galaxy` (the same state it was written at). */
export function decodeCommandArg(galaxy: Galaxy, value: EncodedArg): unknown {
    const t = tables(galaxy);
    const dec = (v: unknown): unknown => {
        if (v === null || typeof v !== 'object') return v;
        const o = v as Record<string, unknown>;
        if ('u' in o) return undefined;
        if ('n' in o) return Number(o.n);
        if ('x' in o) {
            const obj = t.byRef.get(`${String(o.x)}:${String(o.k)}`);
            if (obj === undefined) throw new CommandEncodeError(`command log: unknown static ${String(o.x)}:${String(o.k)}`);
            return obj;
        }
        if ('r' in o) {
            const obj = resolveEntity(galaxy, o.r as string, o.k as number | number[]);
            if (obj === null || obj === undefined) throw new CommandEncodeError(`command log: ${String(o.r)} ${JSON.stringify(o.k)} not found`);
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
            if (proto === undefined) throw new CommandEncodeError(`command log: unknown class ${String(o.c)}`);
            const out = Object.create(proto) as Record<string, unknown>;
            for (const [k, x] of Object.entries(o.f as Record<string, unknown>)) out[k] = dec(x);
            return out;
        }
        throw new CommandEncodeError(`command log: bad argument ${JSON.stringify(v)}`);
    };
    return dec(value);
}
