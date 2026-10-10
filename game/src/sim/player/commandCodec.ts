// Command-log argument codec (tasks/M4-agent-brief.md "Command log"): the arguments of a player command, as the
// executor receives them (sim objects, ShipAction, plain data), become JSON that a fresh game built from the same seed
// resolves back to the same objects at the same frame boundary.
//
// - Sim entities are references by a stable key that exists in the save too (codec version 2, COMMAND_CODEC_VERSION):
//   BuiltObject → builtObjectID ('bo'), Empire → Empire.empireId ('eid'), ShipGroup / Design / Character / Troop / Habitat
//   → its stable ref id (entityRefs.ts; 'sgid' / 'did' / 'chid' / 'trid' / 'hid'), Creature → creatureId ('crid'),
//   SystemInfo → systemIndex ('sys'; the systems list never changes), TechNode → owner empire + index in its research
//   tree ('tn'; the tree is fixed per empire), a queued advisor suggestion → owner empire + its stable id ('advid'),
//   Fighter → its carrier's builtObjectID + its fighterID ('fi'). Every key is resolved back when it is written and must
//   give the same object, else the command is not replayable (throws). Such a key still names an object only while it
//   is in its list (a design in an empire's designs, a troop in an empire's troops, …), as before.
// - Version 1 (log entries without `codec`, from before the stable ids) named Empire by its index in the flat empire
//   list ('e'), Habitat by habitatIndex ('h'), ShipGroup / Design / Character / Troop by owner empire + index in its list
//   ('sg' / 'd' / 'ch' / 'tr') and Creature by its galaxy.creatures index ('cr'). Those keys moved when a list changed
//   between issuing and applying (lockstep applies a command `inputDelay` frames after it was issued). They still decode,
//   and encodeCommandArg(…, 1) writes them, for the replay check of an old entry.
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
import { entityRefId } from '../entityRefs';

/** The argument encoding new log entries are written in (PlayerLogEntry.codec). */
export const COMMAND_CODEC_VERSION = 2;

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

/** The stable ref id of `v` (in its list, found by the caller), or CommandEncodeError when it has none yet. */
function refIdOf(v: object, what: string): number {
    const id = entityRefId(v);
    if (id < 0) throw new CommandEncodeError(`command argument: a ${what} without a stable id (entityRefs.ts sweep missed it)`);
    return id;
}

function findByRefId(lists: Iterable<readonly unknown[] | null | undefined>, id: number): object | null {
    for (const l of lists) {
        if (l == null) continue;
        for (const o of l) if (o != null && typeof o === 'object' && (o as { refId?: number }).refId === id) return o;
    }
    return null;
}

/** Entity reference → [kind, key] in codec version 2, or null when `v` is not an entity kind. */
function entityKey(galaxy: Galaxy, v: object, version: number): [string, number | number[]] | null {
    if (version < 2) return entityKeyV1(galaxy, v);
    const empires = flatEmpireList(galaxy);
    if (v instanceof BuiltObject) return ['bo', v.builtObjectID];
    if (v instanceof Habitat) return galaxy.habitats[v.habitatIndex] === v || galaxy.habitats.includes(v) ? ['hid', refIdOf(v, 'Habitat')] : ['hid', -1];
    if (v instanceof Empire) return ['eid', empires.includes(v) ? v.empireId : -1];
    if (v instanceof ShipGroup) {
        const e = v.empire;
        if (e == null || !empires.includes(e) || !e.shipGroups.includes(v)) return ['sgid', -1];
        return ['sgid', refIdOf(v, 'ShipGroup')];
    }
    if (v instanceof Design) {
        for (const e of empires) if (e.designs.includes(v)) return ['did', refIdOf(v, 'Design')];
        return null; // a draft not in any list: by value
    }
    if (v instanceof Character) {
        for (const e of empires) if (e.characters.includes(v)) return ['chid', refIdOf(v, 'Character')];
        throw new CommandEncodeError('command argument: a Character in no empire list');
    }
    if (v instanceof Troop) {
        for (const e of empires) if (e.troops.items.includes(v)) return ['trid', refIdOf(v, 'Troop')];
        throw new CommandEncodeError('command argument: a Troop in no empire list');
    }
    if (v instanceof Creature) return ['crid', galaxy.creatures.includes(v) ? v.creatureId : -1];
    return entityKeyShared(galaxy, v, empires, 2);
}

/** The version-1 keys (see the file header): list positions. */
function entityKeyV1(galaxy: Galaxy, v: object): [string, number | number[]] | null {
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
    if (v instanceof Creature) return ['cr', galaxy.creatures.indexOf(v)];
    return entityKeyShared(galaxy, v, empires, 1);
}

/**
 * The kinds both versions name alike; the owner empire of a suggestion or tech node is its flat-list index in version 1
 * ('adv' / 'advid' / 'tn'), its empireId in version 2 ('adv2' / 'advid2' / 'tn2').
 */
function entityKeyShared(galaxy: Galaxy, v: object, empires: Empire[], version: number): [string, number | number[]] | null {
    const owner = (i: number): number => (version < 2 ? i : empires[i].empireId);
    const tag = (kind: string): string => (version < 2 ? kind : `${kind}2`);
    if (v instanceof EmpireMessage) {
        // A queued advisor suggestion (Empire.advisorSuggestions) by its stable id (advisorQueue.ts; 'advid'), or by
        // position when it has none (a suggestion queued without addAdvisorSuggestion; logs from before the ids also
        // say 'adv'); any other message by value.
        for (let i = 0; i < empires.length; i++) {
            const j = (empires[i].advisorSuggestions as unknown[]).indexOf(v);
            if (j < 0) continue;
            return typeof v.advisorSuggestionId === 'number' ? [tag('advid'), [owner(i), v.advisorSuggestionId]] : [tag('adv'), [owner(i), j]];
        }
        return null;
    }
    if (v instanceof Fighter) {
        const carrier = v.parentBuiltObject;
        if (carrier === null) throw new CommandEncodeError('command argument: a Fighter with no carrier');
        return ['fi', [carrier.builtObjectID, v.fighterID]];
    }
    if (isSystemInfo(galaxy, v)) return ['sys', v.systemStar.systemIndex];
    if (isTechNode(v)) {
        for (let i = 0; i < empires.length; i++) {
            const j = empires[i].research.techTree.indexOf(v);
            if (j >= 0) return [tag('tn'), [owner(i), j]];
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
    const byId = (k: number | number[]): [Empire | undefined, number] => {
        const [id, j] = k as number[];
        return [empires.find((e) => e.empireId === id), j];
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
        // Version 2 (stable ids).
        case 'eid':
            return empires.find((e) => e.empireId === key) ?? null;
        case 'hid':
            return findByRefId([galaxy.habitats], key as number);
        case 'sgid':
            return findByRefId(empires.map((e) => e.shipGroups), key as number);
        case 'did':
            return findByRefId(empires.map((e) => e.designs), key as number);
        case 'chid':
            return findByRefId(empires.map((e) => e.characters), key as number);
        case 'trid':
            return findByRefId(empires.map((e) => e.troops.items), key as number);
        case 'crid':
            return galaxy.creatures.find((c) => c.creatureId === key) ?? null;
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
        case 'adv2': {
            const [e, j] = byId(key);
            return (e?.advisorSuggestions as unknown[] | undefined)?.[j] ?? null;
        }
        case 'advid2': {
            const [e, id] = byId(key);
            return e === undefined ? null : findAdvisorSuggestion(e, id);
        }
        case 'tn2': {
            const [e, j] = byId(key);
            return e?.research.techTree[j] ?? null;
        }
    }
    throw new CommandEncodeError(`command log: unknown reference kind ${kind}`);
}

/**
 * Encode one command argument (see the file header) in codec `version` (default: the current one; 1 only to check an
 * old log entry). Throws CommandEncodeError when it cannot be replayed.
 */
export function encodeCommandArg(galaxy: Galaxy, value: unknown, version: number = COMMAND_CODEC_VERSION): EncodedArg {
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
        const ek = entityKey(galaxy, o, version);
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
            for (const k of Object.keys(o)) {
                // A by-value copy never carries a stable id (entityRefs.ts): it would be a second object with the id.
                if (k === 'refId' && proto !== Object.prototype && proto !== null) continue;
                fields[k] = enc((o as Record<string, unknown>)[k], `${path}.${k}`);
            }
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
