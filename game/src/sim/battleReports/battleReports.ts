// Battle reports — an Improvement inspired by Distant Worlds 2's battle reports. NOT in DW:U (no C# source): a mod-layer
// observer that watches the fights the player takes part in and writes a summary when each one is over.
//
// Determinism. The observer runs inside the sim tick (scheduler.ts runSimFrameBody, after the frame's work) and from the
// two teardown hooks (hooks.ts), so the worker and in-thread modes, headless replays of seed + command log and a game
// continued from a save all record exactly the same reports. It only READS the game (plain fields, no getter with side
// effects, no Rnd) and writes its own state, which lives outside everything the state digest hashes: a per-galaxy
// side table (save/galaxySave.ts SideTables.battleReports). The side table is created at the first battle, so a game
// that never fought writes the same save text as before (the seed pins hash a generation-time save: 0 pin changes).
// The sim worker's replica gets it like every side table (replicaGalaxy.ts refreshSideTables / applySideTables), so the
// UI reads `battleReportState(galaxy)` the same way in both modes.
//
// Detection (once per game second, `SCAN_MS`; nothing else runs per frame):
// - a battle opens when one of the player's ships / bases / colonies shows combat activity: the battle-icon signals
//   (render/battleIcons.ts: weapon fired, shield struck) plus a hull hit in progress (explosions), a boarding assault
//   (AssaultAttackValue) or a ground invasion (InvadingTroops); a combat kill seen at teardown (hooks.ts) opens one too;
// - its combatants are found from the active objects' Attackers lists and their weapons' targets (the objects the sim
//   itself says are fighting), breadth-first inside the battle area (the system — star distance ≤ MaxSolarSystemSize +
//   2000 — or `DEEP_SPACE_RADIUS` around the first contact). Each side's armed ships, bases and colonies present in the
//   area when the side joins are listed as its starting forces. Nearby engagements join the open battle there;
// - a battle ends `QUIET_MS` after the last combat activity of any of its units. Fights with no ship, base or colony
//   destroyed / captured / disabled and fewer than `SKIRMISH_DAMAGE` damaged components are skirmishes: kept in a quiet
//   log (`skirmishes`), no notification.
// Kept: the last `MAX_REPORTS` reports and `MAX_SKIRMISHES` skirmishes.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { BuiltObject } from '../builtObject';
import type { Creature } from '../creature';
import type { Habitat } from '../types';
import { isBuiltObject, isCreature, isHabitat } from '../missions/mission';
import { calculateOverallStrengthFactor } from '../combat/threats';
import { BuiltObjectRole } from '../data/designSpecifications';
import { galaxyStarDate, MIN_TIME } from '../tick/simTime';
import { MAX_SOLAR_SYSTEM_SIZE } from '../visibility';
import { battleReportHooks, battleReportsEnabled } from './hooks';

export { battleReportsEnabled, setBattleReportsEnabled } from './hooks';

// ---------------------------------------------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------------------------------------------

/** Game ms between two scans. */
export const SCAN_MS = 1000;
/** An object counts as fighting when its last combat activity is at most this old. */
export const ACTIVE_WINDOW_MS = 3000;
/** A battle ends after this long without combat activity among its units. */
export const QUIET_MS = 15000;
/** A deep-space battle's area: this far around its first contact. */
export const DEEP_SPACE_RADIUS = 20000;
/** A system battle's area: this far from the star. */
export const SYSTEM_BATTLE_RADIUS = MAX_SOLAR_SYSTEM_SIZE + 2000;
/** Fewer damaged components than this (and nothing destroyed / captured / disabled): a skirmish. */
export const SKIRMISH_DAMAGE = 3;
export const MAX_REPORTS = 50;
export const MAX_SKIRMISHES = 50;
/** Units tracked per battle at most (bounds the scan and the saved report). */
export const MAX_UNITS = 300;

// ---------------------------------------------------------------------------------------------------------------
// Report data (plain JSON: saved, synced to the replica, read by the UI)
// ---------------------------------------------------------------------------------------------------------------

export type BattleUnitKind = 'ship' | 'base' | 'creature' | 'colony';
export type BattleFate = 'intact' | 'damaged' | 'disabled' | 'destroyed' | 'captured';
export type BattleSideKind = 'player' | 'empire' | 'pirate' | 'independent' | 'creatures';
/** Which camp a side fought in: the player's (the player and sides that fought the player's enemies but never the
 *  player), the player's enemies, or neither. */
export type BattleCamp = 'player' | 'enemy' | 'other';
/** The battle's outcome for the player. */
export type BattleResult = 'victory' | 'defeat' | 'draw' | 'retreat';

export interface BattleUnit {
    kind: BattleUnitKind;
    /** BuiltObjectID / CreatureId (-1 for a colony). */
    id: number;
    name: string;
    side: string;
    /** BuiltObjectSubRole (ships / bases; -1 otherwise). */
    subRole: number;
    /** CreatureType (creatures; -1 otherwise). */
    creatureType: number;
    designName: string;
    /** Game ms it joined the battle (the battle's start for the starting forces). */
    joinedMs: number;
    /** Fired, was fired at or was hit (false: only present). */
    engaged: boolean;
    /** First seen already destroyed: the start values are its design's. */
    estimated: boolean;
    /** FirepowerRaw (+ its fighters'), creatures AttackStrength × 5 (attackAI.ts attackerStrength). */
    startFirepower: number;
    endFirepower: number;
    /** CalculateOverallStrengthFactor (shields / 20 + weapons + fighters), creatures as firepower. */
    startStrength: number;
    endStrength: number;
    /** Damaged components (ships, bases); a creature's Damage. */
    startDamage: number;
    endDamage: number;
    startFighters: number;
    endFighters: number;
    /** Colonies: population and troop count. */
    startPopulation: number;
    endPopulation: number;
    startTroops: number;
    endTroops: number;
    fate: BattleFate;
    /** The new owner's name when captured ('' = abandoned / none). */
    capturedBy: string;
    /** Alive with its side but outside the battle area at the end (retreated, or left). */
    withdrew: boolean;
    x: number;
    y: number;
}

export interface BattleSide {
    /** `e<empireId>` or `creatures`. */
    key: string;
    name: string;
    kind: BattleSideKind;
    empireId: number;
    /** Empire.MainColor (0xRRGGBB). */
    color: number;
    camp: BattleCamp;
    units: number;
    firepowerStart: number;
    firepowerEnd: number;
    strengthStart: number;
    strengthEnd: number;
    fightersStart: number;
    fightersEnd: number;
    destroyed: number;
    captured: number;
    disabled: number;
    damaged: number;
    withdrew: number;
}

export interface BattleReport {
    id: number;
    /** A skirmish (quiet log, no notification). */
    minor: boolean;
    startMs: number;
    endMs: number;
    startStarDate: number;
    endStarDate: number;
    /** galaxy.systems index, -1 in deep space. */
    systemIndex: number;
    /** The system's star name, or the nearest system's for deep space. */
    locationName: string;
    deepSpace: boolean;
    /** The planet / moon nearest the first contact (systems), '' otherwise. */
    nearName: string;
    /** First contact (Go To). */
    x: number;
    y: number;
    result: BattleResult;
    sides: BattleSide[];
    units: BattleUnit[];
}

/** A unit while its battle is open: the report record plus the live object (graph reference, saved with the game). */
interface OpenUnit {
    rec: BattleUnit;
    obj: BuiltObject | Creature | Habitat;
    startEmpire: Empire | null;
    /** Damage signal at the last scan (damaged components / creature damage). */
    lastSig: number;
    /** Torn down (fate settled at the teardown hook). */
    gone: boolean;
    /** Was functional at the start (a ship that is not afterwards was disabled). */
    startFunctional: boolean;
    /** Game ms of the last scan that saw it inside the battle area (it withdrew if it left before the fighting stopped). */
    seenInArea: number;
}

interface OpenBattle {
    id: number;
    startMs: number;
    lastActivityMs: number;
    startStarDate: number;
    systemIndex: number;
    locationName: string;
    deepSpace: boolean;
    nearName: string;
    x: number;
    y: number;
    sides: BattleSide[];
    units: OpenUnit[];
    /** Side pairs seen fighting each other, `a|b` with a < b. */
    hostile: string[];
}

export interface BattleReportState {
    version: 1;
    nextId: number;
    /** Reports finalised so far (non-skirmish); the UI notifies when it grows. */
    serial: number;
    open: OpenBattle[];
    /** Oldest first, at most MAX_REPORTS. */
    reports: BattleReport[];
    /** Oldest first, at most MAX_SKIRMISHES. */
    skirmishes: BattleReport[];
}

// ---------------------------------------------------------------------------------------------------------------
// State (a side table: save/galaxySave.ts collectSideTables / restoreSideTables)
// ---------------------------------------------------------------------------------------------------------------

const states = new WeakMap<Galaxy, BattleReportState>();

/** The galaxy's battle-report state (undefined until its first battle). Read-only for the UI. */
export function battleReportState(galaxy: Galaxy | null | undefined): BattleReportState | undefined {
    return galaxy == null ? undefined : states.get(galaxy);
}

/** Save / replica restore (galaxySave.ts restoreSideTables). */
export function restoreBattleReportState(galaxy: Galaxy, state: BattleReportState): void {
    states.set(galaxy, state);
}

function ensureState(galaxy: Galaxy): BattleReportState {
    let st = states.get(galaxy);
    if (st === undefined) {
        st = { version: 1, nextId: 1, serial: 0, open: [], reports: [], skirmishes: [] };
        states.set(galaxy, st);
    }
    return st;
}

/** The finished reports, newest first (skirmishes too when `withSkirmishes`). */
export function battleReports(galaxy: Galaxy | null | undefined, withSkirmishes = false): BattleReport[] {
    const st = battleReportState(galaxy);
    if (st === undefined) return [];
    const list = withSkirmishes ? [...st.reports, ...st.skirmishes] : [...st.reports];
    list.sort((a, b) => b.endMs - a.endMs || b.id - a.id);
    return list;
}

/** Battles still being fought (for the UI: "in progress"). */
export function openBattleCount(galaxy: Galaxy | null | undefined): number {
    return battleReportState(galaxy)?.open.length ?? 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Reads (pure)
// ---------------------------------------------------------------------------------------------------------------

type Unit = BuiltObject | Creature | Habitat;

interface WeaponLike {
    lastFired: number;
    target: unknown;
}
interface FighterLike {
    fighterID: number;
    hasBeenDestroyed: boolean;
    firepowerRaw: number;
    parentBuiltObject: BuiltObject | null;
    empire: Empire | null;
    weapons: WeaponLike[];
    lastShieldStrike: number;
}

function isFighterLike(o: unknown): o is FighterLike {
    return o !== null && typeof o === 'object' && 'fighterID' in o && 'parentBuiltObject' in o;
}

function fightersOf(bo: BuiltObject): FighterLike[] {
    return (bo.fighters as FighterLike[] | null) ?? [];
}

function liveFighters(bo: BuiltObject): number {
    let n = 0;
    for (const f of fightersOf(bo)) if (f != null && !f.hasBeenDestroyed) n++;
    return n;
}

function boFirepower(bo: BuiltObject): number {
    let n = bo.firepowerRaw;
    for (const f of fightersOf(bo)) if (f != null && !f.hasBeenDestroyed) n += f.firepowerRaw;
    return n;
}

/** Game ms of a ship's / base's last combat activity (MIN_TIME: none). */
function builtObjectActivity(bo: BuiltObject, now: number): number {
    let last = bo.lastShieldStrike;
    for (const w of bo.weapons as WeaponLike[]) if (w != null && w.lastFired > last) last = w.lastFired;
    for (const f of fightersOf(bo)) {
        if (f == null || f.hasBeenDestroyed) continue;
        if (f.lastShieldStrike > last) last = f.lastShieldStrike;
        for (const w of f.weapons) if (w.lastFired > last) last = w.lastFired;
    }
    // A planet destroyer's hyper-exit delay writes LastFired ahead of the clock (weapons.ts 1302).
    if (last > now) last = now;
    if (bo.explosions.length > 0 || bo.assaultAttackValue > 0) last = now;
    return last;
}

function colonyActive(h: Habitat): boolean {
    return (h.explosions !== null && h.explosions.length > 0) || (h.invadingTroops !== null && h.invadingTroops.count > 0);
}

function unitEmpire(o: Unit): Empire | null {
    if (isCreature(o)) return null;
    return o.empire;
}

function sideKeyOf(galaxy: Galaxy, o: Unit): string | null {
    if (isCreature(o)) return 'creatures';
    const e = o.empire;
    if (e === null) return null;
    void galaxy;
    return `e${e.empireId}`;
}

function unitPos(o: Unit): { x: number; y: number } {
    return { x: o.xpos, y: o.ypos };
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
}

function inArea(galaxy: Galaxy, b: OpenBattle, o: Unit): boolean {
    if (isHabitat(o)) return b.systemIndex >= 0 && o.systemIndex === b.systemIndex;
    if (b.systemIndex >= 0) {
        const star = galaxy.systems[b.systemIndex]?.systemStar;
        if (star == null) return false;
        return dist2(star.xpos, star.ypos, o.xpos, o.ypos) <= SYSTEM_BATTLE_RADIUS * SYSTEM_BATTLE_RADIUS;
    }
    return dist2(b.x, b.y, o.xpos, o.ypos) <= DEEP_SPACE_RADIUS * DEEP_SPACE_RADIUS;
}

/** The system an object is in (index into galaxy.systems), -1 in deep space. */
function systemIndexOf(galaxy: Galaxy, o: Unit): number {
    if (isHabitat(o)) return o.systemIndex;
    const star = o.nearestSystemStar;
    if (star === null) return -1;
    if (dist2(star.xpos, star.ypos, o.xpos, o.ypos) > SYSTEM_BATTLE_RADIUS * SYSTEM_BATTLE_RADIUS) return -1;
    const sys = galaxy.systems[star.systemIndex];
    return sys !== undefined && sys.systemStar === star ? star.systemIndex : -1;
}

// ---------------------------------------------------------------------------------------------------------------
// Battles
// ---------------------------------------------------------------------------------------------------------------

function openBattle(galaxy: Galaxy, st: BattleReportState, o: Unit, now: number, startMs: number): OpenBattle {
    const p = unitPos(o);
    const systemIndex = systemIndexOf(galaxy, o);
    let locationName = '';
    let nearName = '';
    if (systemIndex >= 0) {
        const sys = galaxy.systems[systemIndex];
        locationName = sys.systemStar.name;
        let best = Infinity;
        for (const h of sys.habitats) {
            if (h == null || h === sys.systemStar) continue;
            const d = dist2(h.xpos, h.ypos, p.x, p.y);
            if (d < best) {
                best = d;
                nearName = h.name;
            }
        }
    } else {
        let best = Infinity;
        for (const sys of galaxy.systems) {
            const s = sys?.systemStar;
            if (s == null) continue;
            const d = dist2(s.xpos, s.ypos, p.x, p.y);
            if (d < best) {
                best = d;
                locationName = s.name;
            }
        }
    }
    const b: OpenBattle = {
        id: st.nextId++,
        startMs,
        lastActivityMs: Math.max(startMs, now - ACTIVE_WINDOW_MS),
        startStarDate: galaxyStarDate(galaxy) - (now - startMs),
        systemIndex,
        locationName,
        deepSpace: systemIndex < 0,
        nearName,
        x: p.x,
        y: p.y,
        sides: [],
        units: [],
        hostile: [],
    };
    st.open.push(b);
    return b;
}

function sideOf(b: OpenBattle, key: string): BattleSide | null {
    for (const s of b.sides) if (s.key === key) return s;
    return null;
}

function newSide(galaxy: Galaxy, key: string, empire: Empire | null): BattleSide {
    let kind: BattleSideKind;
    if (empire === null) kind = 'creatures';
    else if (empire === galaxy.playerEmpire) kind = 'player';
    else if (empire === galaxy.independentEmpire) kind = 'independent';
    else if (empire.pirateEmpireBaseHabitat !== null) kind = 'pirate';
    else kind = 'empire';
    return {
        key,
        name: empire !== null ? empire.name : 'Creatures',
        kind,
        empireId: empire !== null ? empire.empireId : -1,
        color: empire !== null ? empire.mainColor : 0xc0c0c0,
        camp: 'other',
        units: 0,
        firepowerStart: 0,
        firepowerEnd: 0,
        strengthStart: 0,
        strengthEnd: 0,
        fightersStart: 0,
        fightersEnd: 0,
        destroyed: 0,
        captured: 0,
        disabled: 0,
        damaged: 0,
        withdrew: 0,
    };
}

/** Per-scan lookup: live object → its battle and unit. */
type Tracked = Map<object, { b: OpenBattle; u: OpenUnit }>;

function unitRecord(galaxy: Galaxy, o: Unit, side: string, now: number, engaged: boolean): { rec: BattleUnit; startEmpire: Empire | null; sig: number; functional: boolean } {
    void galaxy;
    const rec: BattleUnit = {
        kind: 'ship',
        id: -1,
        name: o.name,
        side,
        subRole: -1,
        creatureType: -1,
        designName: '',
        joinedMs: now,
        engaged,
        estimated: false,
        startFirepower: 0,
        endFirepower: 0,
        startStrength: 0,
        endStrength: 0,
        startDamage: 0,
        endDamage: 0,
        startFighters: 0,
        endFighters: 0,
        startPopulation: 0,
        endPopulation: 0,
        startTroops: 0,
        endTroops: 0,
        fate: 'intact',
        capturedBy: '',
        withdrew: false,
        x: o.xpos,
        y: o.ypos,
    };
    let sig = 0;
    let functional = true;
    if (isBuiltObject(o)) {
        rec.kind = o.role === BuiltObjectRole.Base ? 'base' : 'ship';
        rec.id = o.builtObjectID;
        rec.subRole = o.subRole;
        rec.designName = o.design?.name ?? '';
        functional = o.isFunctional;
        if (o.hasBeenDestroyed) {
            // First seen already destroyed (its components are gone): its design's values.
            rec.estimated = true;
            const d = o.design;
            rec.startFirepower = d !== null ? d.firepowerRaw : 0;
            rec.startStrength = d !== null ? d.firepowerRaw + Math.trunc(d.shieldsCapacity / 20) : 0;
            functional = true;
        } else {
            rec.startFirepower = boFirepower(o);
            rec.startStrength = calculateOverallStrengthFactor(o);
            rec.startFighters = liveFighters(o);
        }
        rec.startDamage = o.damagedComponentCount;
        sig = o.damagedComponentCount;
    } else if (isCreature(o)) {
        rec.kind = 'creature';
        rec.id = o.creatureId;
        rec.creatureType = o.type;
        rec.startFirepower = o.attackStrength * 5;
        rec.startStrength = o.attackStrength * 5;
        rec.startDamage = o.damage;
        sig = o.damage;
    } else {
        rec.kind = 'colony';
        rec.startPopulation = o.population !== null ? o.population.totalAmount : 0;
        rec.startTroops = o.troops !== null ? o.troops.count : 0;
    }
    return { rec, startEmpire: unitEmpire(o), sig, functional };
}

/** Add `o` to battle `b` (registering its side, and that side's forces in the area, when new). Null when it cannot join. */
function addUnit(galaxy: Galaxy, b: OpenBattle, o: Unit, now: number, tracked: Tracked, engaged: boolean): OpenUnit | null {
    const known = tracked.get(o);
    if (known !== undefined) {
        if (engaged) known.u.rec.engaged = true;
        return known.b === b ? known.u : null;
    }
    if (b.units.length >= MAX_UNITS) return null;
    const key = sideKeyOf(galaxy, o);
    if (key === null) return null;
    let side = sideOf(b, key);
    const isNewSide = side === null;
    if (side === null) {
        side = newSide(galaxy, key, unitEmpire(o));
        b.sides.push(side);
    }
    const r = unitRecord(galaxy, o, key, now, engaged);
    const u: OpenUnit = { rec: r.rec, obj: o, startEmpire: r.startEmpire, lastSig: r.sig, gone: false, startFunctional: r.functional, seenInArea: now };
    b.units.push(u);
    tracked.set(o, { b, u });
    if (isNewSide) addSideForces(galaxy, b, unitEmpire(o), now, tracked);
    return u;
}

/** A side joining the battle: its armed ships, its bases and its colonies in the area (its forces at the start). */
function addSideForces(galaxy: Galaxy, b: OpenBattle, empire: Empire | null, now: number, tracked: Tracked): void {
    if (empire === null) return;
    for (const list of [empire.builtObjects, empire.privateBuiltObjects]) {
        for (const bo of list) {
            if (bo == null || bo.hasBeenDestroyed || tracked.has(bo)) continue;
            if (bo.role !== BuiltObjectRole.Base && bo.firepowerRaw <= 0 && liveFighters(bo) === 0) continue;
            if (!inArea(galaxy, b, bo)) continue;
            addUnit(galaxy, b, bo, now, tracked, false);
        }
    }
    if (b.systemIndex >= 0) {
        for (const h of empire.colonies) {
            if (h == null || tracked.has(h) || h.systemIndex !== b.systemIndex) continue;
            addUnit(galaxy, b, h, now, tracked, false);
        }
    }
}

function noteHostile(b: OpenBattle, a: string, c: string): void {
    if (a === c) return;
    const k = a < c ? `${a}|${c}` : `${c}|${a}`;
    if (!b.hostile.includes(k)) b.hostile.push(k);
}

/** The objects `o` is fighting (its attackers, its weapons' recent targets, a creature's prey), as battle units. */
function opponentsOf(o: Unit, now: number): Unit[] {
    const out: Unit[] = [];
    const push = (x: unknown): void => {
        if (x == null) return;
        let u: unknown = x;
        if (isFighterLike(u)) u = u.parentBuiltObject;
        if (u == null || u === o) return;
        if ((isBuiltObject(u) || isCreature(u) || isHabitat(u)) && !out.includes(u)) out.push(u);
    };
    if (isBuiltObject(o)) {
        if (o.attackers !== null) for (const a of o.attackers) push(a);
        for (const w of o.weapons as WeaponLike[]) if (w != null && w.lastFired >= now - ACTIVE_WINDOW_MS) push(w.target);
        for (const f of fightersOf(o)) {
            if (f == null || f.hasBeenDestroyed) continue;
            for (const w of f.weapons) if (w.lastFired >= now - ACTIVE_WINDOW_MS) push(w.target);
        }
    } else if (isCreature(o)) {
        for (const a of o.attackers) push(a);
        push(o.currentTarget);
    } else if (o.attackers !== null) {
        for (const a of o.attackers) push(a);
    }
    return out;
}

/** Breadth-first from active combatants: their opponents in the area join (engaged), and are expanded in turn. */
function expand(galaxy: Galaxy, b: OpenBattle, seeds: Unit[], now: number, tracked: Tracked): void {
    const queue = seeds.slice();
    const seen = new Set<Unit>(queue);
    while (queue.length > 0) {
        const o = queue.shift()!;
        const ko = sideKeyOf(galaxy, o);
        for (const x of opponentsOf(o, now)) {
            const kx = sideKeyOf(galaxy, x);
            if (kx === null || kx === ko) continue;
            if (isBuiltObject(x) && x.hasBeenDestroyed && !tracked.has(x) && x.explosions.length === 0) continue;
            if (!inArea(galaxy, b, x)) continue;
            if (ko !== null) noteHostile(b, ko, kx);
            const u = addUnit(galaxy, b, x, now, tracked, true);
            if (u !== null && !seen.has(x)) {
                seen.add(x);
                queue.push(x);
            }
        }
    }
}

/** The unit's combat activity this scan (game ms; MIN_TIME none), updating its damage signal. */
function unitActivity(u: OpenUnit, now: number): number {
    const o = u.obj;
    if (isBuiltObject(o)) {
        let t = builtObjectActivity(o, now);
        if (o.damagedComponentCount > u.lastSig || o.hasBeenDestroyed) t = now;
        u.lastSig = o.damagedComponentCount;
        return t;
    }
    if (isCreature(o)) {
        let t = MIN_TIME;
        if (o.damage > u.lastSig || o.hasBeenDestroyed) t = now;
        u.lastSig = o.damage;
        const target = o.currentTarget;
        if (target !== null && dist2(o.xpos, o.ypos, target.xpos, target.ypos) <= (o.attackRange + 500) * (o.attackRange + 500)) t = now;
        return t;
    }
    return colonyActive(o) ? now : MIN_TIME;
}

function buildTracked(st: BattleReportState | undefined): Tracked {
    const tracked: Tracked = new Map();
    if (st !== undefined) for (const b of st.open) for (const u of b.units) tracked.set(u.obj, { b, u });
    return tracked;
}

function findBattleFor(galaxy: Galaxy, st: BattleReportState, o: Unit): OpenBattle | null {
    for (const b of st.open) if (inArea(galaxy, b, o)) return b;
    return null;
}

/** Join `o` (fighting since `since`) to the open battle around it, or open one. */
function joinOrOpen(galaxy: Galaxy, o: Unit, now: number, since: number, tracked: Tracked): OpenBattle | null {
    const st = ensureState(galaxy);
    const b = findBattleFor(galaxy, st, o) ?? openBattle(galaxy, st, o, now, Math.min(now, since));
    const u = addUnit(galaxy, b, o, now, tracked, true);
    if (u === null && b.units.length === 0) {
        st.open.splice(st.open.indexOf(b), 1);
        return null;
    }
    if (since > b.lastActivityMs) b.lastActivityMs = Math.min(now, since);
    expand(galaxy, b, [o], now, tracked);
    return b;
}

// ---------------------------------------------------------------------------------------------------------------
// The scan (scheduler.ts, end of each sim frame)
// ---------------------------------------------------------------------------------------------------------------

/** End of a sim frame: one scan per SCAN_MS of game time (else a single comparison). */
export function battleReportsFrameEnd(galaxy: Galaxy, frameMs: number): void {
    if (!battleReportsEnabled()) return;
    const now = galaxy.nowMs;
    if (Math.floor(now / SCAN_MS) === Math.floor((now - frameMs) / SCAN_MS)) return;
    scanBattles(galaxy, now);
}

/** One scan: update the open battles, open new ones from the player's fighting objects, close the quiet ones. */
export function scanBattles(galaxy: Galaxy, now: number): void {
    const player = galaxy.playerEmpire;
    if (player === null) return;
    let st = states.get(galaxy);
    const tracked = buildTracked(st);
    // 1. Open battles: activity of their units, new combatants.
    if (st !== undefined) {
        for (const b of st.open) {
            const active: Unit[] = [];
            for (const u of b.units) {
                if (u.gone) continue;
                if (inArea(galaxy, b, u.obj) && unitEmpire(u.obj) === u.startEmpire) u.seenInArea = now;
                const t = unitActivity(u, now);
                if (t >= now - ACTIVE_WINDOW_MS) {
                    u.rec.engaged = true;
                    if (t > b.lastActivityMs) b.lastActivityMs = t;
                    active.push(u.obj);
                }
            }
            if (active.length > 0) expand(galaxy, b, active, now, tracked);
        }
    }
    // 2. The player's objects fighting outside any battle.
    for (const list of [player.builtObjects, player.privateBuiltObjects]) {
        for (const bo of list) {
            if (bo == null || tracked.has(bo)) continue;
            const t = builtObjectActivity(bo, now);
            if (t < now - ACTIVE_WINDOW_MS) continue;
            joinOrOpen(galaxy, bo, now, t, tracked);
        }
    }
    for (const h of player.colonies) {
        if (h == null || tracked.has(h) || !colonyActive(h)) continue;
        joinOrOpen(galaxy, h, now, now, tracked);
    }
    // 3. Quiet battles end.
    st = states.get(galaxy);
    if (st === undefined) return;
    for (let i = 0; i < st.open.length; ) {
        const b = st.open[i];
        if (now - b.lastActivityMs >= QUIET_MS) {
            st.open.splice(i, 1);
            finalizeBattle(galaxy, st, b, now);
        } else i++;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Teardown hooks (hooks.ts): kills between two scans, and the fate of tracked units that are removed
// ---------------------------------------------------------------------------------------------------------------

function attackedByPlayer(galaxy: Galaxy, attackers: readonly unknown[] | null): boolean {
    const player = galaxy.playerEmpire;
    if (attackers === null || player === null) return false;
    for (const a of attackers) {
        if (a == null) continue;
        if (isFighterLike(a) ? a.empire === player : isBuiltObject(a) && a.empire === player) return true;
    }
    return false;
}

function onRemoved(galaxy: Galaxy, o: BuiltObject | Creature, destroyed: boolean): void {
    if (!battleReportsEnabled()) return;
    const now = galaxy.nowMs;
    const st = states.get(galaxy);
    if (st !== undefined) {
        for (const b of st.open) {
            for (const u of b.units) {
                if (u.obj !== o || u.gone) continue;
                settleUnit(galaxy, b, u, destroyed ? 'destroyed' : 'removed');
                u.gone = true;
                if (destroyed) b.lastActivityMs = now;
                return;
            }
        }
    }
    if (!destroyed) return;
    const player = galaxy.playerEmpire;
    if (player === null) return;
    const involved = (isBuiltObject(o) && o.empire === player) || attackedByPlayer(galaxy, o.attackers);
    const key = sideKeyOf(galaxy, o);
    let battle: OpenBattle | null = null;
    if (st !== undefined) for (const b of st.open) if (inArea(galaxy, b, o) && (involved || (key !== null && sideOf(b, key) !== null))) battle = battle ?? b;
    if (battle === null && !involved) return;
    const tracked = buildTracked(st);
    const b = battle ?? openBattle(galaxy, ensureState(galaxy), o, now, now);
    const u = addUnit(galaxy, b, o, now, tracked, true);
    if (u === null) {
        const open = ensureState(galaxy).open;
        if (b.units.length === 0) open.splice(open.indexOf(b), 1);
        return;
    }
    b.lastActivityMs = now;
    expand(galaxy, b, [o], now, tracked);
    settleUnit(galaxy, b, u, 'destroyed');
    u.gone = true;
}

battleReportHooks.builtObjectTeardown = (galaxy, bo) => onRemoved(galaxy, bo, bo.hasBeenDestroyed);
battleReportHooks.creatureTeardown = (galaxy, c) => onRemoved(galaxy, c, c.hasBeenDestroyed);

// ---------------------------------------------------------------------------------------------------------------
// End of a battle
// ---------------------------------------------------------------------------------------------------------------

/** Fill a unit's end values and fate. `how`: 'destroyed' / 'removed' from the teardown hook, else read the object. */
function settleUnit(galaxy: Galaxy, b: OpenBattle, u: OpenUnit, how: 'destroyed' | 'removed' | 'end'): void {
    const o = u.obj;
    const r = u.rec;
    r.x = o.xpos;
    r.y = o.ypos;
    r.endFirepower = 0;
    r.endStrength = 0;
    r.endFighters = 0;
    if (how === 'destroyed') {
        r.fate = 'destroyed';
        if (isBuiltObject(o)) r.endDamage = o.damagedComponentCount;
        else if (isCreature(o)) r.endDamage = o.damage;
        return;
    }
    if (how === 'removed') {
        // Retired / scrapped / merged during the battle: not a combat loss.
        r.fate = 'intact';
        r.withdrew = true;
        return;
    }
    if (isBuiltObject(o)) {
        r.endDamage = o.damagedComponentCount;
        if (o.hasBeenDestroyed) {
            r.fate = 'destroyed';
            return;
        }
        if (o.empire !== u.startEmpire) {
            r.fate = 'captured';
            r.capturedBy = o.empire !== null ? o.empire.name : '';
            return;
        }
        r.endFirepower = boFirepower(o);
        r.endStrength = calculateOverallStrengthFactor(o);
        r.endFighters = liveFighters(o);
        const ion = o.disabledComponentIndexes !== null && o.disabledComponentIndexes.length > 0;
        if (ion || (u.startFunctional && !o.isFunctional)) r.fate = 'disabled';
        else if (o.damagedComponentCount > r.startDamage) r.fate = 'damaged';
        else r.fate = 'intact';
        r.withdrew = withdrewFrom(b, u);
        return;
    }
    if (isCreature(o)) {
        r.endDamage = o.damage;
        if (o.hasBeenDestroyed) {
            r.fate = 'destroyed';
            return;
        }
        r.endFirepower = o.attackStrength * 5;
        r.endStrength = o.attackStrength * 5;
        r.fate = o.damage > r.startDamage ? 'damaged' : 'intact';
        r.withdrew = withdrewFrom(b, u);
        return;
    }
    r.endPopulation = o.population !== null ? o.population.totalAmount : 0;
    r.endTroops = o.troops !== null ? o.troops.count : 0;
    if (o.hasBeenDestroyed || (r.startPopulation > 0 && r.endPopulation <= 0)) r.fate = 'destroyed';
    else if (o.empire !== u.startEmpire) {
        r.fate = 'captured';
        r.capturedBy = o.empire !== null ? o.empire.name : '';
    } else if (r.endPopulation < r.startPopulation * 0.99 || r.endTroops < r.startTroops) r.fate = 'damaged';
    else r.fate = 'intact';
}

/** Left the battle area before the fighting there stopped (leaving afterwards — going home after a win — is not). */
function withdrewFrom(b: OpenBattle, u: OpenUnit): boolean {
    return u.seenInArea < b.lastActivityMs - SCAN_MS;
}

const lost = (u: BattleUnit): boolean => u.fate === 'destroyed' || u.fate === 'captured';

/** The camps (BattleSide.camp) from the side pairs seen fighting. */
function assignCamps(b: OpenBattle, playerKey: string | null): void {
    const hostile = (a: string, c: string): boolean => b.hostile.includes(a < c ? `${a}|${c}` : `${c}|${a}`);
    if (playerKey === null) return;
    const enemies = new Set<string>();
    for (const s of b.sides) if (s.key !== playerKey && hostile(playerKey, s.key)) enemies.add(s.key);
    for (const s of b.sides) {
        if (s.key === playerKey) s.camp = 'player';
        else if (enemies.has(s.key)) s.camp = 'enemy';
        else if ([...enemies].some((e) => hostile(e, s.key))) s.camp = 'player';
        else s.camp = 'other';
    }
}

/** A unit's weight in the loss comparison: its start strength (at least 10); a colony 200. */
function unitValue(u: BattleUnit): number {
    return u.kind === 'colony' ? 200 : Math.max(10, u.startStrength);
}

/** The outcome for the player (see the file header). */
export function battleResult(sides: readonly BattleSide[], units: readonly BattleUnit[]): BattleResult {
    const camp = new Map(sides.map((s) => [s.key, s.camp] as const));
    const mine = units.filter((u) => camp.get(u.side) === 'player');
    const theirs = units.filter((u) => camp.get(u.side) === 'enemy');
    if (mine.length === 0 || theirs.length === 0) return 'draw';
    const alive = (l: BattleUnit[]): BattleUnit[] => l.filter((u) => !lost(u));
    const present = (l: BattleUnit[]): BattleUnit[] => alive(l).filter((u) => !u.withdrew);
    const pAlive = alive(mine).length > 0;
    const eAlive = alive(theirs).length > 0;
    if (!pAlive && eAlive) return 'defeat';
    if (pAlive && !eAlive) return 'victory';
    if (!pAlive && !eAlive) return 'draw';
    const pPresent = present(mine).length > 0;
    const ePresent = present(theirs).length > 0;
    if (!pPresent && ePresent) return 'retreat';
    if (pPresent && !ePresent) return 'victory';
    const frac = (l: BattleUnit[]): number => {
        let total = 0;
        let gone = 0;
        for (const u of l) {
            total += unitValue(u);
            if (lost(u)) gone += unitValue(u);
            else if (u.fate === 'disabled') gone += unitValue(u) / 2;
        }
        return total > 0 ? gone / total : 0;
    };
    const d = frac(theirs) - frac(mine);
    if (d > 0.2) return 'victory';
    if (d < -0.2) return 'defeat';
    return 'draw';
}

function finalizeBattle(galaxy: Galaxy, st: BattleReportState, b: OpenBattle, now: number): void {
    for (const u of b.units) if (!u.gone) settleUnit(galaxy, b, u, 'end');
    const units = b.units.map((u) => u.rec);
    const player = galaxy.playerEmpire;
    const playerKey = player !== null && sideOf(b, `e${player.empireId}`) !== null ? `e${player.empireId}` : null;
    assignCamps(b, playerKey);
    let damage = 0;
    let losses = false;
    for (const s of b.sides) {
        for (const u of units) {
            if (u.side !== s.key) continue;
            s.units++;
            s.firepowerStart += u.startFirepower;
            s.firepowerEnd += u.endFirepower;
            s.strengthStart += u.startStrength;
            s.strengthEnd += u.endStrength;
            s.fightersStart += u.startFighters;
            s.fightersEnd += u.endFighters;
            if (u.fate === 'destroyed') s.destroyed++;
            else if (u.fate === 'captured') s.captured++;
            else if (u.fate === 'disabled') s.disabled++;
            else if (u.fate === 'damaged') s.damaged++;
            if (u.withdrew && !lost(u)) s.withdrew++;
        }
    }
    for (const u of units) {
        if (u.fate === 'destroyed' || u.fate === 'captured' || u.fate === 'disabled') losses = true;
        if (u.kind === 'ship' || u.kind === 'base') damage += Math.max(0, u.endDamage - u.startDamage);
    }
    const report: BattleReport = {
        id: b.id,
        minor: !losses && damage < SKIRMISH_DAMAGE,
        startMs: b.startMs,
        endMs: b.lastActivityMs,
        startStarDate: b.startStarDate,
        endStarDate: galaxyStarDate(galaxy) - (now - b.lastActivityMs),
        systemIndex: b.systemIndex,
        locationName: b.locationName,
        deepSpace: b.deepSpace,
        nearName: b.nearName,
        x: b.x,
        y: b.y,
        result: battleResult(b.sides, units),
        sides: b.sides,
        units,
    };
    if (report.minor) {
        st.skirmishes.push(report);
        while (st.skirmishes.length > MAX_SKIRMISHES) st.skirmishes.shift();
    } else {
        st.reports.push(report);
        while (st.reports.length > MAX_REPORTS) st.reports.shift();
        st.serial++;
    }
}
