// Scenario package 19g-7b "new fauna" (tasks/19-mod-layer-scenarios.md §19g item 7, "19g-7b New fauna"): the creature-
// VARIANT table over the ported CreatureTypes and the 19g-7 herd model, params, the saved state and the pure lookups the
// query hooks and the renderer call. Not a port: every variant creature is a ported Creature (creature.ts; its base
// type keeps the ported per-type rules — Creature.cs ctor stats, Move, InitiateWander, DamageCreature, DamageTarget)
// grouped in a 19g-7 RimHerd (rimFauna/common.ts). Nothing in this file draws galaxy.rnd.

import type { Galaxy } from '../../galaxy';
import type { BuiltObject } from '../../builtObject';
import type { Creature } from '../../creature';
import { CreatureType } from '../../creature';
import type { GalaxyLocation } from '../../galaxyLocation';
import { GalaxyLocationType } from '../../galaxyLocation';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { scenarioFlag, scenarioParam, scenarioState } from '../state';
import { peekRimFaunaState, rimHerdOfCreature, type RimHerd } from '../rimFauna/common';
import { herderColonies, isHerderEmpire } from '../rimHerders/common';

/** Flag name (scenarios/new-fauna/scenario.json). */
export const NEW_FAUNA_FLAG = 'newFauna';
/** scenarioState key. */
export const NEW_FAUNA_STATE = 'newFauna';

/** The eight variants (tasks §19g-7b numbering). */
export enum FaunaVariant {
    VoidWhale = 1,
    HunterPack = 2,
    HullGrazer = 3,
    StormDrifter = 4,
    LanternShoal = 5,
    NestMother = 6,
    Scavenger = 7,
    BroodCarrier = 8,
}

/**
 * One row of the variant table: the ported base CreatureType, the herd shape, the stats laid over the base type's
 * Creature.cs ctor values, the behaviour switches and the look (a creatureRig.ts body definition id).
 */
export interface FaunaVariantDef {
    variant: FaunaVariant;
    name: string;
    baseType: CreatureType;
    /** creatureRig.ts FAUNA_BODIES key ('lantern' is the particle swarm). */
    look: string;
    groupMin: number;
    groupMax: number;
    sizeMin: number;
    sizeMax: number;
    maxSize: number;
    leaderSpeed: number;
    followerSpeed: number;
    /** Creature.HyperSpeed while it travels between systems (0 = never leaves its range). */
    hyperSpeed: number;
    /** AttackStrength = trunc(size / attackDiv) (Creature.cs ctor pattern); 0 = no attack. */
    attackDiv: number;
    /** DamageKillThreshhold = trunc(size × killMul) (Creature.cs ctor pattern). */
    killMul: number;
    /** Creature.AttackRange (the ported CheckTargetInRange reach). */
    attackRange: number;
    /** Never starts a fight (the ported CheckForAttackers still makes it hit back). */
    harmless: boolean;
    /** Spawns only at or beyond this radius fraction. */
    minRadius: number;
    /** Spawn weight among the variants allowed at a radius. */
    weight: number;
    /** Herders can tame it (docile flags). */
    tameable: boolean;
    /** The 19g-7 herd tick grazes / migrates it (else this package steers it). */
    grazes: boolean;
}

/**
 * The variant table. Base types: herd grazers and packs on the Kaltor (its herd goods are the herders' harvest), the
 * latching grazer on the Space Slug, the scavenger on the Sand Slug, the travellers (drifter, nest, brood) on the
 * hyper-travelling Ardilus. A function, not a module constant: CreatureType is read at call time (module cycles).
 */
export function faunaVariantTable(): readonly FaunaVariantDef[] {
    if (table !== null) return table;
    table = [
        { variant: FaunaVariant.VoidWhale, name: 'Void Whale', baseType: CreatureType.Kaltor, look: 'voidWhale', groupMin: 1, groupMax: 3, sizeMin: 1000, sizeMax: 1400, maxSize: 1800, leaderSpeed: 14, followerSpeed: 18, hyperSpeed: 0, attackDiv: 40, killMul: 3.0, attackRange: 800, harmless: true, minRadius: 0.55, weight: 3, tameable: true, grazes: true },
        { variant: FaunaVariant.HunterPack, name: 'Hunter Pack', baseType: CreatureType.Kaltor, look: 'hunter', groupMin: 4, groupMax: 6, sizeMin: 45, sizeMax: 70, maxSize: 120, leaderSpeed: 70, followerSpeed: 78, hyperSpeed: 4000, attackDiv: 6, killMul: 1.2, attackRange: 3000, harmless: false, minRadius: 0.5, weight: 3, tameable: true, grazes: false },
        { variant: FaunaVariant.HullGrazer, name: 'Hull Grazer', baseType: CreatureType.RockSpaceSlug, look: 'hullGrazer', groupMin: 1, groupMax: 2, sizeMin: 110, sizeMax: 160, maxSize: 300, leaderSpeed: 20, followerSpeed: 22, hyperSpeed: 0, attackDiv: 30, killMul: 1.6, attackRange: 600, harmless: true, minRadius: 0.5, weight: 2, tameable: false, grazes: false },
        { variant: FaunaVariant.StormDrifter, name: 'Storm Drifter', baseType: CreatureType.Ardilus, look: 'stormDrifter', groupMin: 1, groupMax: 2, sizeMin: 260, sizeMax: 380, maxSize: 600, leaderSpeed: 16, followerSpeed: 18, hyperSpeed: 6000, attackDiv: 0, killMul: 2.0, attackRange: 800, harmless: true, minRadius: 0.6, weight: 2, tameable: false, grazes: false },
        { variant: FaunaVariant.LanternShoal, name: 'Lantern Shoal', baseType: CreatureType.Kaltor, look: 'lantern', groupMin: 1, groupMax: 1, sizeMin: 180, sizeMax: 260, maxSize: 400, leaderSpeed: 30, followerSpeed: 30, hyperSpeed: 3000, attackDiv: 0, killMul: 0.8, attackRange: 800, harmless: true, minRadius: 0.45, weight: 2, tameable: false, grazes: false },
        { variant: FaunaVariant.NestMother, name: 'Nest Mother', baseType: CreatureType.Ardilus, look: 'nestMother', groupMin: 1, groupMax: 1, sizeMin: 1600, sizeMax: 2200, maxSize: 2600, leaderSpeed: 4, followerSpeed: 60, hyperSpeed: 0, attackDiv: 25, killMul: 4.0, attackRange: 15000, harmless: false, minRadius: 0.7, weight: 1, tameable: false, grazes: false },
        { variant: FaunaVariant.Scavenger, name: 'Scavenger', baseType: CreatureType.DesertSpaceSlug, look: 'scavenger', groupMin: 1, groupMax: 3, sizeMin: 90, sizeMax: 150, maxSize: 260, leaderSpeed: 36, followerSpeed: 40, hyperSpeed: 3000, attackDiv: 0, killMul: 1.4, attackRange: 800, harmless: true, minRadius: 0.45, weight: 2, tameable: false, grazes: false },
        { variant: FaunaVariant.BroodCarrier, name: 'Brood Carrier', baseType: CreatureType.Ardilus, look: 'broodCarrier', groupMin: 1, groupMax: 1, sizeMin: 700, sizeMax: 950, maxSize: 1200, leaderSpeed: 18, followerSpeed: 18, hyperSpeed: 8000, attackDiv: 60, killMul: 2.4, attackRange: 800, harmless: true, minRadius: 0.6, weight: 1, tameable: false, grazes: false },
    ];
    return table;
}
let table: FaunaVariantDef[] | null = null;

export function faunaVariantDef(v: FaunaVariant): FaunaVariantDef {
    return faunaVariantTable()[v - 1];
}

/** The young of a nest mother: small hunters (the renderer draws them with the hunter body, smaller). */
export const NEST_YOUNG = { sizeMin: 30, sizeMax: 50, speed: 60, attackDiv: 8, killMul: 1.0 } as const;

/** Manifest defaults (scenario.json) — the fallbacks of scenarioParam. */
export const NEW_FAUNA_PARAM_DEFAULTS = {
    newFaunaDensity: 0.6,
    newFaunaMaxGroups: 60,
    newFaunaWhaleKillHaul: 40,
    newFaunaHunterStalkRange: 40000,
    newFaunaHunterFleeRange: 25000,
    newFaunaHunterFleeDistance: 60000,
    newFaunaGrazerRange: 60000,
    newFaunaGrazerDrain: 3,
    newFaunaDrifterCloudRadius: 30000,
    newFaunaDrifterScanFactor: 0.1,
    newFaunaDrifterHopChance: 0.05,
    newFaunaLanternLureRadius: 40000,
    newFaunaNestYoungDays: 120,
    newFaunaNestMaxYoung: 6,
    newFaunaNestGuardRange: 15000,
    newFaunaScavengeRange: 120000,
    newFaunaScavengeRate: 20,
    newFaunaBroodRange: 400000,
    newFaunaBroodSeedRange: 20000,
    newFaunaBroodSeedDays: 180,
    newFaunaBroodMaxPacks: 30,
    newFaunaHerderTames: 1,
    newFaunaTameRange: 60000,
} as const;
export type NewFaunaParam = keyof typeof NEW_FAUNA_PARAM_DEFAULTS;

export function newFaunaParam(galaxy: Galaxy, name: NewFaunaParam): number {
    return scenarioParam(galaxy, name, NEW_FAUNA_PARAM_DEFAULTS[name]);
}

/** Distance (world units) at which a hull grazer is latched on and feeding. */
export const GRAZER_LATCH_DIST = 1500;
/** Distance at which a scavenger eats a wreck. */
export const SCAVENGE_EAT_DIST = 2500;
/** A wreck site stays this long (game days) before it has drifted apart. */
export const WRECK_DAYS = 720;
/** Wreck sites kept at most (oldest dropped). */
export const MAX_WRECKS = 200;
/** Salvage of a stock debris field (Steel units). */
export const DEBRIS_FIELD_SALVAGE = 300;

/** A salvage stack (resource id, units). */
export interface Salvage {
    resourceId: number;
    amount: number;
}

/** A wreck a scavenger can eat: a torn-down ship / base, or a stock debris field. */
export interface WreckSite {
    x: number;
    y: number;
    salvage: Salvage[];
    /** Star date it appeared. */
    date: number;
}

/** Per variant herd (keyed by RimHerd id). */
export interface FaunaHerdInfo {
    variant: FaunaVariant;
    /** creatureIds of the members configured as this variant (new calves get adopted). */
    members: number[];
    /** Behaviour target: storm / shoal / nest site / brood destination point (null = none yet). */
    target: { x: number; y: number } | null;
    /** Brood destination system (-1 = none). */
    destSystem: number;
    /** Next nest young / brood seeding (star date). */
    nextAt: number;
    /** Hull grazer: the station it is latched on. */
    latched: BuiltObject | null;
    /** Hunter pack: fleeing a warship (last tick). */
    fleeing: boolean;
    /** Scavenger: salvage carried. */
    salvage: Salvage[];
    /** Empire id of the herder owner that tamed it (-1 = wild). */
    tamedBy: number;
}

export interface NewFaunaStats {
    spawned: number[];
    grazeTicks: number;
    stalks: number;
    flees: number;
    hullDrained: number;
    misfires: number;
    lures: number;
    young: number;
    salvageEaten: number;
    salvageDropped: number;
    seeded: number;
    tamed: number;
    killHaul: number;
}

/** Saved state (`scenarioState(galaxy, 'newFauna')`): plain data and graph references. */
export interface NewFaunaState {
    herds: Record<number, FaunaHerdInfo>;
    wrecks: WreckSite[];
    /** Living freighters: a tamed creature that walks with a herder freighter. */
    caravans: { ship: BuiltObject; creature: Creature }[];
    rev: number;
    stats: NewFaunaStats;
}

export function newFaunaState(galaxy: Galaxy): NewFaunaState {
    return scenarioState<NewFaunaState>(galaxy, NEW_FAUNA_STATE, () => ({
        herds: {},
        wrecks: [],
        caravans: [],
        rev: 0,
        stats: { spawned: [0, 0, 0, 0, 0, 0, 0, 0, 0], grazeTicks: 0, stalks: 0, flees: 0, hullDrained: 0, misfires: 0, lures: 0, young: 0, salvageEaten: 0, salvageDropped: 0, seeded: 0, tamed: 0, killHaul: 0 },
    }));
}

/** The state if the package has run (never creates it: safe from pure query handlers and the renderer). */
export function peekNewFaunaState(galaxy: Galaxy): NewFaunaState | null {
    const s = galaxy.scenario;
    if (s === null || !(NEW_FAUNA_STATE in s.state)) return null;
    return s.state[NEW_FAUNA_STATE] as NewFaunaState;
}

// ---------------------------------------------------------------------------------------------------------------
// Pure lookups (never draw, never write)
// ---------------------------------------------------------------------------------------------------------------

/** The variant info of a RimHerd (null: a plain 19g-7 herd or no package state). */
export function faunaHerdInfo(galaxy: Galaxy, herd: RimHerd): FaunaHerdInfo | null {
    return peekNewFaunaState(galaxy)?.herds[herd.id] ?? null;
}

/** A creature's variant and whether it is its herd's leader (null: not a variant creature). */
export function faunaVariantOfCreature(galaxy: Galaxy, c: Creature): { variant: FaunaVariant; herd: RimHerd; leader: boolean } | null {
    const st = peekNewFaunaState(galaxy);
    if (st === null) return null;
    const herd = rimHerdOfCreature(galaxy, c);
    if (herd === null) return null;
    const info = st.herds[herd.id];
    if (info === undefined) return null;
    return { variant: info.variant, herd, leader: herd.leader === c };
}

/** The display name of a creature's variant ("Void Whale"; nest mother young are "Nest Young"), or null. */
export function faunaVariantName(galaxy: Galaxy, c: Creature): string | null {
    const v = faunaVariantOfCreature(galaxy, c);
    if (v === null) return null;
    if (v.variant === FaunaVariant.NestMother && !v.leader) return 'Nest Young';
    return faunaVariantDef(v.variant).name;
}

/** Empire ids that are herders: herder colonies' owners and symbiotic (herder) empires. */
export function herderEmpireIds(galaxy: Galaxy): number[] {
    const out: number[] = [];
    for (const hc of herderColonies(galaxy)) {
        const e = hc.colony.empire;
        if (e !== null && !out.includes(e.empireId)) out.push(e.empireId);
    }
    for (const e of galaxy.empires) if (e != null && e.active && isHerderEmpire(galaxy, e) && !out.includes(e.empireId)) out.push(e.empireId);
    return out;
}

/**
 * Tamed look: the creature's herd is docile to a herder (19j rimHerdDocileTo / setRimHerdDocile). Any herd creature
 * counts (Kaltor herds of 19j too), only while the newFauna flag is on.
 */
export function creatureTamedByHerders(galaxy: Galaxy, c: Creature): boolean {
    if (!scenarioFlag(galaxy, NEW_FAUNA_FLAG)) return false;
    const herd = rimHerdOfCreature(galaxy, c);
    if (herd === null || herd.docileEmpireIds.length === 0) return false;
    const ids = herderEmpireIds(galaxy);
    return herd.docileEmpireIds.some((id) => ids.includes(id));
}

/** Private freighters (a function: enums are read at call time). */
export function isFreighterShip(bo: BuiltObject): boolean {
    return bo.role === BuiltObjectRole.Freight;
}

export function isWarship(bo: BuiltObject): boolean {
    return bo.role === BuiltObjectRole.Military;
}

const liveCache = new WeakMap<Galaxy, { frev: number; nrev: number; byVariant: Creature[][] }>();

/** Live members of every variant herd, by variant (cached on the herd revisions). */
export function faunaCreaturesByVariant(galaxy: Galaxy): Creature[][] {
    const st = peekNewFaunaState(galaxy);
    const fs = peekRimFaunaState(galaxy);
    if (st === null || fs === null) return [];
    const c = liveCache.get(galaxy);
    if (c !== undefined && c.frev === fs.rev && c.nrev === st.rev) return c.byVariant;
    const byVariant: Creature[][] = [[], [], [], [], [], [], [], [], []];
    for (const herd of fs.herds) {
        const info = st.herds[herd.id];
        if (info === undefined) continue;
        if (herd.leader !== null) byVariant[info.variant].push(herd.leader);
        for (const f of herd.followers) byVariant[info.variant].push(f);
    }
    liveCache.set(galaxy, { frev: fs.rev, nrev: st.rev, byVariant });
    return byVariant;
}

function alive(c: Creature): boolean {
    return !c.hasBeenDestroyed;
}

/** 19h sensor query: the scan-range multiplier toward (x, y) — the drifter-cloud factor inside a storm drifter's cloud. */
export function drifterScanMultiplier(galaxy: Galaxy, x: number, y: number): number {
    const list = faunaCreaturesByVariant(galaxy)[FaunaVariant.StormDrifter];
    if (list === undefined || list.length === 0) return 1;
    const r = newFaunaParam(galaxy, 'newFaunaDrifterCloudRadius');
    for (const c of list) {
        if (!alive(c)) continue;
        const dx = c.xpos - x;
        const dy = c.ypos - y;
        if (dx * dx + dy * dy <= r * r) return newFaunaParam(galaxy, 'newFaunaDrifterScanFactor');
    }
    return 1;
}

/**
 * Perf pre-filter for segmentEntry: false when the circle (cx, cy, r) is certainly not entered by the segment. An entry
 * point lies on the segment (t in [0, len]) at distance r from the centre (up to float rounding: a few units at galaxy
 * coordinates < 1e9, far below the 1000 + r/1000 slack), so a centre farther than that from the segment's bounding box
 * on either axis has no entry.
 */
function segmentMayEnter(x0: number, y0: number, x1: number, y1: number, cx: number, cy: number, r: number): boolean {
    const m = r + 1000 + r / 1000;
    return !(cx < Math.min(x0, x1) - m || cx > Math.max(x0, x1) + m || cy < Math.min(y0, y1) - m || cy > Math.max(y0, y1) + m);
}

/** Where the segment (x0, y0)→(x1, y1) first enters the circle (cx, cy, r): parameter t in [0, len], or -1. */
function segmentEntry(x0: number, y0: number, x1: number, y1: number, cx: number, cy: number, r: number): { t: number; len: number; dx: number; dy: number } | null {
    let dx = x1 - x0;
    let dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (!(len > 0)) return null;
    dx /= len;
    dy /= len;
    const mx = x0 - cx;
    const my = y0 - cy;
    const c = mx * mx + my * my - r * r;
    if (c <= 0) return null; // starts inside: never stopped by it
    const b = mx * dx + my * dy;
    const disc = b * b - c;
    if (disc < 1.0) return null;
    const t = -b - Math.sqrt(disc);
    if (t < 0 || t > len) return null;
    return { t, len, dx, dy };
}

/** Deterministic 0..1 from two ids (no Rnd: query handlers are pure). */
export function hash01(a: number, b: number): number {
    let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

/**
 * 19h hyperjump query, storm drifter: a jump step that enters a drifter's cloud misfires — the ship drops out of
 * hyperspace inside the cloud, part-way to the drifter (a per-ship / per-drifter fraction), where its sensors are blind.
 */
export function drifterMisfireStop(galaxy: Galaxy, ship: BuiltObject, fromX: number, fromY: number, toX: number, toY: number, exitX: number, exitY: number): { x: number; y: number } | null {
    const list = faunaCreaturesByVariant(galaxy)[FaunaVariant.StormDrifter];
    if (list === undefined || list.length === 0) return null;
    const r = newFaunaParam(galaxy, 'newFaunaDrifterCloudRadius');
    let best: { x: number; y: number } | null = null;
    let bestT = Number.MAX_VALUE;
    let toExit = -1; // Perf: Math.hypot(exitX - fromX, exitY - fromY), computed once on first use (pure)
    for (const c of list) {
        if (!alive(c)) continue;
        if (!segmentMayEnter(fromX, fromY, toX, toY, c.xpos, c.ypos, r)) continue;
        const e = segmentEntry(fromX, fromY, toX, toY, c.xpos, c.ypos, r);
        if (e === null || e.t >= bestT) continue;
        if (toExit < 0) toExit = Math.hypot(exitX - fromX, exitY - fromY);
        if (e.t > toExit) continue;
        bestT = e.t;
        const ex = fromX + e.dx * (e.t + 1);
        const ey = fromY + e.dy * (e.t + 1);
        const k = 0.2 + 0.6 * hash01(ship.builtObjectID, c.creatureId);
        best = { x: ex + (c.xpos - ex) * k, y: ey + (c.ypos - ey) * k };
    }
    return best;
}

/**
 * 19h hyperjump query, lantern shoal: a civilian ship's jump step that passes within the lure radius of a lantern shoal
 * stops there (ships follow the lights; the lanterns drift into the gravity shoals). A step that starts inside the lure
 * radius is not stopped again.
 */
export function lanternLureStop(galaxy: Galaxy, ship: BuiltObject, fromX: number, fromY: number, toX: number, toY: number, exitX: number, exitY: number): { x: number; y: number } | null {
    if (isWarship(ship)) return null;
    const list = faunaCreaturesByVariant(galaxy)[FaunaVariant.LanternShoal];
    if (list === undefined || list.length === 0) return null;
    const r = newFaunaParam(galaxy, 'newFaunaLanternLureRadius');
    if (r <= 0) return null;
    let best: { x: number; y: number } | null = null;
    let bestT = Number.MAX_VALUE;
    const toExit = Math.hypot(exitX - fromX, exitY - fromY);
    for (const c of list) {
        if (!alive(c)) continue;
        if (!segmentMayEnter(fromX, fromY, toX, toY, c.xpos, c.ypos, r)) continue;
        const e = segmentEntry(fromX, fromY, toX, toY, c.xpos, c.ypos, r);
        if (e === null) continue;
        // Stop at the closest approach to the lantern (inside the lure radius).
        const t = Math.min(e.len, toExit, Math.max(e.t + 1, (c.xpos - fromX) * e.dx + (c.ypos - fromY) * e.dy));
        if (t > toExit || t >= bestT) continue;
        bestT = t;
        best = { x: fromX + e.dx * t, y: fromY + e.dy * t };
    }
    return best;
}

/** The gravity shoals of 19h (rimFrontier state) when that package ran; else the black holes (stock gravity wells). */
export function gravityShoals(galaxy: Galaxy): readonly GalaxyLocation[] {
    const s = galaxy.scenario;
    const rf = s !== null ? (s.state['rimFrontier'] as { shoals?: GalaxyLocation[] } | undefined) : undefined;
    if (rf !== undefined && rf.shoals !== undefined && rf.shoals.length > 0) return rf.shoals;
    return galaxy.galaxyLocations.filter((l) => l.type === GalaxyLocationType.BlackHole);
}

/** Centre of a location (its box centre). */
export function locationCentre(l: GalaxyLocation): { x: number; y: number } {
    return { x: l.xpos + l.width / 2, y: l.ypos + l.height / 2 };
}
