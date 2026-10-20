// M4a: stable state digest for determinism tests and seed pins (tasks/M4-plan.md §5.2).
//
// Hashes (FNV-1a over float64 bit patterns, two 32-bit lanes) the galaxy clock and touch times, the Galaxy.Rnd
// internal state (SeedArray, inext, inextp, draw count), the frame-driver cursors, and per-empire / per-habitat /
// per-ship / per-creature key fields, iterated in C# list order.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { builtObjectMission } from '../missions/mission';

class Fnv {
    private a = 0x811c9dc5;
    private b = 0x01000193 ^ 0x5bd1e995;
    private readonly view = new DataView(new ArrayBuffer(8));

    num(x: number): void {
        // Every NaN hashes alike: a NaN computed in place (0 / 0 is the negative quiet NaN) and one a save wrote as null and read back differ in their bits
        // (the Long Night's pre-warp independent empire carries one: relativeEmpireSize).
        this.view.setFloat64(0, x !== x ? Number.NaN : x);
        for (let i = 0; i < 8; i++) {
            const byte = this.view.getUint8(i);
            this.a = Math.imul(this.a ^ byte, 0x01000193);
            this.b = Math.imul(this.b ^ byte, 0x01000193) ^ (this.b >>> 15);
        }
    }

    bool(x: boolean): void {
        this.num(x ? 1 : 0);
    }

    str(s: string): void {
        this.num(s.length);
        for (let i = 0; i < s.length; i++) this.num(s.charCodeAt(i));
    }

    hex(): string {
        return (this.a >>> 0).toString(16).padStart(8, '0') + (this.b >>> 0).toString(16).padStart(8, '0');
    }
}

function hashEmpire(h: Fnv, e: Empire): void {
    h.num(e.empireId);
    h.bool(e.active);
    h.num(e.stateMoney);
    h.num(e.privateMoney);
    h.num(e.totalPopulation);
    h.num(e.colonies.length);
    h.num(e.builtObjects.length);
    h.num(e.privateBuiltObjects.length);
    h.num(e.lastShortTouch);
    h.num(e.lastRegularTouch);
    h.num(e.lastPeriodicTouch);
    h.num(e.lastIntermediateTouch);
    h.num(e.lastLongTouch);
    h.num(e.lastHugeTouch);
    h.num(e.messages.length);
    h.num(e.relativeEmpireSize);
    h.num(e.colonizationTargets.length);
    h.num(e.resourceTargets.length);
    h.num(e.designs.length);
    h.num(e.corruption);
}

/** Digest of the simulation state (hex string). */
export function stateDigest(galaxy: Galaxy): string {
    const h = new Fnv();
    h.num(galaxy.nowMs);
    h.num(galaxy.lastGalaxyProcessTimeSensitive);
    h.num(galaxy.lastGalaxyProcessTime);
    h.num(galaxy.lastGalaxyHugeProcessTime);
    const rnd = galaxy.rnd.snapshotState();
    for (const v of rnd.seedArray) h.num(v);
    h.num(rnd.inext);
    h.num(rnd.inextp);
    h.num(galaxy.rnd.drawCount);
    const s = galaxy.scheduler;
    if (s !== null) {
        for (const v of [s.habitatCursor, s.inBattleCursor, s.builtObjectCursor, s.creatureCursor, s.empireCursor, s.empireFrameCounter, s.galaxyFrameCounter, s.fleetEmpireCursor, s.fleetFrameCounter, s.pirateCursor, s.pirateFrameCounter, s.frameCarry, s.frames]) h.num(v);
    }
    h.num(galaxy.empires.length);
    for (const e of galaxy.empires) hashEmpire(h, e);
    h.num(galaxy.pirateEmpires.length);
    for (const e of galaxy.pirateEmpires) hashEmpire(h, e);
    if (galaxy.independentEmpire !== null) hashEmpire(h, galaxy.independentEmpire);
    h.num(galaxy.habitats.length);
    for (const hab of galaxy.habitats) {
        h.num(hab.xpos);
        h.num(hab.ypos);
        h.num(hab.orbitAngle);
        h.num(hab.lastTouch);
        h.num(hab.lastIntermediateTouch);
        h.num(hab.lastPeriodicTouch);
        h.num(hab.lastLongTouch);
        h.num(hab.lastHugeTouch);
        h.num(hab.population.totalAmount);
        h.num(hab.developmentLevel);
        h.num(hab.annualTaxRevenue);
        h.num(hab.developmentLevelBaseline);
        h.num(hab.colonyInfluenceRadius);
        h.bool(hab.isShipYard);
        h.bool(hab.hasSpacePort);
        h.num(hab.troops !== null ? hab.troops.count : -1);
    }
    h.num(galaxy.builtObjects.length);
    for (const bo of galaxy.builtObjects) {
        // CompleteTeardown nulls the Galaxy.BuiltObjects slot (BuiltObject.2.cs 5171; combat/teardown.ts).
        if (bo == null) {
            h.num(-1);
            continue;
        }
        h.num(bo.builtObjectID);
        h.num(bo.xpos);
        h.num(bo.ypos);
        h.num(bo.currentFuel);
        h.num(bo.currentEnergy);
        h.num(bo.currentSpeed);
        h.bool(bo.inBattle);
        h.bool(bo.canHyperJump);
        h.num(builtObjectMission(bo.mission)?.type ?? -1);
        h.num(bo.lastTouch);
        h.num(bo.lastIntermediateTouch);
        h.num(bo.lastPeriodicTouch);
        h.num(bo.lastLongTouch);
        h.num(bo.annualSupportCostBase);
        h.num(bo.targetSpeed);
        h.num(bo.preferredSpeed);
    }
    h.num(galaxy.creatures.length);
    for (const c of galaxy.creatures) {
        h.num(c.creatureId);
        h.num(c.xpos);
        h.num(c.ypos);
        h.num(c.damage);
        h.bool(c.hasBeenDestroyed);
    }
    h.str(galaxy.orders.length.toString());
    return h.hex();
}

/** Entity counts reported next to the digest. */
export function stateCounts(galaxy: Galaxy): Record<string, number> {
    return {
        empires: galaxy.empires.length,
        pirateEmpires: galaxy.pirateEmpires.length,
        habitats: galaxy.habitats.length,
        builtObjects: galaxy.builtObjects.length,
        creatures: galaxy.creatures.length,
        colonies: galaxy.empires.reduce((n, e) => n + e.colonies.length, 0),
    };
}

// ---------------------------------------------------------------------------------------------------- deep digest
// MULTIPLAYER.md §27: a broader, per-subsystem hash the lockstep session compares every few digests. stateDigest above
// stays as it is (the seed pins). This one hashes each object's own primitive fields (numbers, booleans, strings;
// null / undefined count as absent) plus the length of each array field, order-independently per object, so it sees
// state the pinned digest does not name. Fields that are not simulation state
// (render / UI caches, lazily rebuilt lookups that a save does not carry) are skipped.

/** Field names (any object) that are caches or views, not simulation state: they differ after a save is loaded. */
const DEEP_SKIP = new Set<string>([]);

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
const keyHashes = new Map<string, number>();

function strHash(s: string): number {
    let x = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 0x01000193);
    return x >>> 0;
}

function keyHash(k: string): number {
    let v = keyHashes.get(k);
    if (v === undefined) {
        v = strHash(k);
        keyHashes.set(k, v);
    }
    return v;
}

function mix(a: number, b: number): number {
    let x = Math.imul(a ^ b, 0x9e3779b1);
    x ^= x >>> 15;
    x = Math.imul(x, 0x85ebca77);
    return (x ^ (x >>> 13)) >>> 0;
}

/**
 * One object's primitive fields: [lane a, lane b]. Order-independent (a sum and an xor of per-field hashes): a save
 * loaded elsewhere builds its objects with their fields in another order, and fields added lazily sit wherever they
 * were added. -0 counts as 0 and every NaN alike (a save writes them so); null / undefined count as absent.
 */
function objectHash(o: object): [number, number] {
    let sum = 0;
    let xr = 0;
    const rec = o as Record<string, unknown>;
    // for-in over own fields: V8's enum cache makes this fast for objects of one shape (no key array per object).
    for (const k in rec) {
        const v = rec[k];
        let x: number;
        let y: number;
        if (typeof v === 'number') {
            if (v === 0 || v !== v) {
                x = v === 0 ? 0 : 0x7ff80000;
                y = 0;
            } else {
                f64[0] = v;
                x = u32[0]!;
                y = u32[1]!;
            }
        } else if (typeof v === 'boolean') {
            x = v ? 1 : 2;
            y = 0x5bd1;
        } else if (typeof v === 'string') {
            x = strHash(v);
            y = v.length ^ 0x7a3c;
        } else if (Array.isArray(v)) {
            x = v.length;
            y = 0xa11a;
        } else {
            continue; // null / undefined (absent), nested objects (their own section or none), functions
        }
        if (DEEP_SKIP.has(k) || !Object.prototype.hasOwnProperty.call(rec, k)) continue;
        const kh = keyHash(k);
        const h = mix(mix(kh, x), y);
        sum = (sum + h) | 0;
        xr ^= Math.imul(h, 0x2c1b3c6d) ^ kh;
    }
    return [sum >>> 0, xr >>> 0];
}

class Lanes {
    a = 0x811c9dc5;
    b = 0x1b873593;
    add(o: object | null | undefined): void {
        if (o == null) {
            this.a = mix(this.a, 0xdead);
            return;
        }
        const [s, x] = objectHash(o);
        this.a = mix(this.a, s);
        this.b = mix(this.b ^ x, this.a);
    }
    num(n: number): void {
        f64[0] = n;
        this.a = mix(this.a, u32[0]!);
        this.b = mix(this.b, u32[1]!);
    }
    hex(): string {
        return (this.a >>> 0).toString(16).padStart(8, '0') + (this.b >>> 0).toString(16).padStart(8, '0');
    }
}

/** The subsystems deepDigest reports, in order. */
export const DEEP_SECTIONS = ['core', 'empires', 'pirates', 'habitats', 'ships', 'creatures'] as const;
export type DeepDigest = Record<(typeof DEEP_SECTIONS)[number], string>;

function empireLanes(l: Lanes, list: readonly Empire[]): void {
    l.num(list.length);
    for (const e of list) l.add(e);
}

/**
 * The per-subsystem digest (hex per section). `core`: the galaxy's own fields, the scheduler and the Rnd state.
 * `part` of `parts`: the habitats and ships hashed are those whose index ≡ part (mod parts) — the costly lists, spread
 * over `parts` calls (the lockstep session rotates `part` with the digest frame); the rest is hashed in full each time.
 */
export function deepDigest(galaxy: Galaxy, part = 0, parts = 1): DeepDigest {
    const core = new Lanes();
    core.add(galaxy);
    core.add(galaxy.scheduler);
    const rnd = galaxy.rnd.snapshotState();
    for (const v of rnd.seedArray) core.num(v);
    core.num(rnd.inext);
    core.num(rnd.inextp);
    core.num(galaxy.rnd.drawCount);
    const empires = new Lanes();
    empireLanes(empires, galaxy.empires);
    const pirates = new Lanes();
    empireLanes(pirates, galaxy.pirateEmpires);
    pirates.add(galaxy.independentEmpire);
    const habitats = new Lanes();
    const habs = galaxy.habitats;
    habitats.num(habs.length);
    for (let i = part; i < habs.length; i += parts) habitats.add(habs[i]);
    const ships = new Lanes();
    const bos = galaxy.builtObjects;
    ships.num(bos.length);
    for (let i = part; i < bos.length; i += parts) ships.add(bos[i]);
    const creatures = new Lanes();
    creatures.num(galaxy.creatures.length);
    for (const c of galaxy.creatures) creatures.add(c);
    return { core: core.hex(), empires: empires.hex(), pirates: pirates.hex(), habitats: habitats.hex(), ships: ships.hex(), creatures: creatures.hex() };
}
