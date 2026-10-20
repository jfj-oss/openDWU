// The Harvest Cycle, Age 2: what the Age 1 empires left in the world (longNightReset.ts seedAge2 runs the memory contributors' restore on the
// new galaxy). Not a port. Two pieces, both made of stock mechanics:
//
// 1. THE RUINS RACE. The capitals of the biggest Age 1 empires (and of any empire that died holding mega-station parts) become stock ruins
//    (ruins.ts Ruin, the stock investigation: money and research progress) on the same world in Age 2, or, where a survivor's home world or
//    home system is in the way, on the nearest free rocky world beyond. The first empire to survey one also gets the parts the dead empire held
//    (beaconState PartsRec), once; a human is told in a popup.
// 2. RECLAIMER HULKS. A few warships of the Reclaimers' kind (the Reclaimer fork-fleet art) are mixed into the world as stock abandoned ships,
//    placed near the Age 1 harvest scars and old capitals, heavily damaged (a costly repair) and claimable by the stock abandoned-ship
//    investigation (a quarter of them are a pirate ambush, as for any stock derelict).
//
// Header note: the fallen capitals' wrecks (placeBattles) are a third piece.
// Rnd: everything here draws from its own stream seeded from the galaxy seed (age2Random), except the stock abandoned-ship generator.
// Deterministic: the same memory and galaxy give the same world.

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { Habitat } from '../../../types';
import type { BuiltObject } from '../../../builtObject';
import type { Design } from '../../../design';
import { HabitatCategoryType, HabitatType } from '../../../types';
import { BuiltObjectSubRole } from '../../../builtObjectTypes';
import { Ruin, RuinType } from '../../../ruins';
import { EmpireMessageType } from '../../../messages';
import { isHumanEmpire } from '../../../humanEmpires';
import { generateDesignFromSpec } from '../../../designGeneration';
import { BuiltObjectEncounterAction, BuiltObjectEncounterEventType, damageBuiltObjectComponents, galaxyDesignSpecificationBySubRole, generateAbandonedBuiltObject } from '../../../gameStartTail';
import { galaxyStarDate } from '../../../tick/simTime';
import { registerScenarioEvent } from '../../hooks';
import { scenarioMessage, scenarioText as T } from '../../messages';
import { beaconState, peekBeaconState, type EmpireParts } from './beaconState';
import { HARVEST_CYCLE_FLAG, LN_TAG, memoryRecordOf, peekLongNight, registerMemoryContributor, AGE_PREPARATION, type MemoryRecord } from './longNightState';

export const AGE2_WORLD_ID = 'age2.world';
/** The scenario state key of the Age 2 world record (ruin sites and hulks). */
export const AGE2_WORLD_KEY = 'age2World';
/** Most capitals that become ruins by size (an empire that died holding parts is added on top). */
export const MAX_SIZE_RUINS = 8;
/** Fallen-capital systems that get wrecks (the earliest fallen first) and the wrecks per system (the claimable hulk included). */
export const MAX_BATTLE_SYSTEMS = 5;
export const WRECKS_MIN = 2;
export const WRECKS_MAX = 4;
export const FALLEN_ID = 'age2.fallen';
/** Age 1 scenario state key: the capitals that have fallen so far. */
export const FALLEN_KEY = 'age2Fallen';
/** Hulks: about this share of sqrt(star count), at least 2, at most 10. */
export const HULK_PER_ROOT_STAR = 0.3;
/** Weights of a place in picking where a hulk lies: a harvest scar, an old capital. */
const SCAR_WEIGHT = 3;
const CAPITAL_WEIGHT = 1;
/** Component share of a hulk left damaged (the stock DamageBuiltObjectComponents). */
const HULK_DAMAGE = 0.8;
/** The Reclaimers' warships a hulk is made as. */
const HULK_ROLES = [BuiltObjectSubRole.Cruiser, BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.CapitalShip, BuiltObjectSubRole.Frigate];
/** Tech levels beyond its research the hulks' designs are made at (the stock generator's techAdvanceAmount: Age 1 tech). */
const HULK_TECH_ADVANCE = 4;

/** An Age 1 capital as the Long Night remembers it (plain data; `parts` only for an empire that died holding mega-station parts). */
export interface OldCapitalRec {
    empire: string;
    race: string;
    /** Habitat name and system name; the position is what finds the world again. */
    name: string;
    systemName: string;
    x: number;
    y: number;
    /** Colonies the empire held when the Long Night began (0: it was dead). */
    size: number;
    parts?: EmpireParts;
}

/** One ruin of the Age 2 world, by its world's position. */
export interface RuinSite {
    habitat: Habitat;
    empire: string;
    race: string;
    /** The parts left here (empty when none or already taken). */
    parts: EmpireParts | null;
    /** An empire has surveyed this ruin (the parts went to the first). */
    surveyed: boolean;
}

/** A capital that fell during the Beacon war (Age 1), by position, as the Long Night remembers it. */
export interface FallenCapitalRec {
    empire: string;
    name: string;
    systemName: string;
    x: number;
    y: number;
    /** Star date it fell (the old galaxy's clock). */
    date: number;
    how: 'captured' | 'destroyed';
}

/** The wrecks of one fallen capital's system: at most one claimable hulk, the rest broken derelicts. */
export interface BattleSite {
    systemIndex: number;
    empire: string;
    how: FallenCapitalRec['how'];
    claimable: BuiltObject | null;
    wrecks: BuiltObject[];
}

export interface Age2WorldState {
    ruins: RuinSite[];
    /** Every Reclaimer hulk and wreck (abandoned ships, then whoever claimed them). */
    hulks: BuiltObject[];
    /** The battlefields of the fallen capitals (their ships are in `hulks`). */
    battles?: BattleSite[];
}

export function age2WorldOf(galaxy: Galaxy): Age2WorldState | null {
    const s = galaxy.scenario?.state[AGE2_WORLD_KEY];
    return s === undefined || s === null ? null : (s as Age2WorldState);
}

// ---------------------------------------------------------------------------------------------------------------
// Capture (the old galaxy, when the Long Night begins)
// ---------------------------------------------------------------------------------------------------------------

function isNormal(galaxy: Galaxy, e: Empire | null, faction: Empire | null): e is Empire {
    return e !== null && e !== faction && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null && e.dominantRace !== null;
}

function placeName(galaxy: Galaxy, h: Habitat): string {
    return galaxy.systems[h.systemIndex]?.systemStar?.name ?? h.name;
}

function hasParts(p: EmpireParts | undefined): p is EmpireParts {
    return p !== undefined && (p.beamLens === true || p.linkConduit === true || p.cloakLattice === true || (p.mindFragments ?? 0) > 0 || (p.voidFrames ?? 0) > 0);
}

/**
 * The capitals of the Age 1 empires worth a ruin: the biggest (most colonies) up to MAX_SIZE_RUINS, and every empire that died (no colony
 * left) holding mega-station parts, so the parts are not lost. A living empire's parts are its own to carry across (a human's by name: longNight.ts
 * captureParts). Pure.
 */
export function captureOldCapitals(galaxy: Galaxy): OldCapitalRec[] {
    const st = peekBeaconState(galaxy);
    const faction = st?.faction ?? null;
    const out: OldCapitalRec[] = [];
    const living: { e: Empire; size: number }[] = [];
    for (const e of galaxy.empires) {
        if (!isNormal(galaxy, e, faction) || e.capital === null) continue;
        const size = e.active ? e.colonies.length : 0;
        const parts = st?.parts?.held[String(e.empireId)];
        const rec: OldCapitalRec = { empire: e.name, race: e.dominantRace!.name, name: e.capital.name, systemName: placeName(galaxy, e.capital), x: e.capital.xpos, y: e.capital.ypos, size };
        if (size > 0) {
            living.push({ e, size });
        } else if (hasParts(parts) && !isHumanEmpire(galaxy, e)) {
            out.push({ ...rec, parts: JSON.parse(JSON.stringify(parts)) as EmpireParts });
        }
    }
    living.sort((a, b) => b.size - a.size || a.e.empireId - b.e.empireId);
    for (const { e, size } of living.slice(0, MAX_SIZE_RUINS)) {
        out.push({ empire: e.name, race: e.dominantRace!.name, name: e.capital!.name, systemName: placeName(galaxy, e.capital!), x: e.capital!.xpos, y: e.capital!.ypos, size });
    }
    return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The fallen capitals (Age 1: recorded as they fall)
// ---------------------------------------------------------------------------------------------------------------

function fallenList(galaxy: Galaxy): FallenCapitalRec[] | null {
    const sc = galaxy.scenario;
    if (sc === null) return null;
    return ((sc.state[FALLEN_KEY] as FallenCapitalRec[] | undefined) ??= []);
}

function noteFallen(galaxy: Galaxy, e: Empire, h: Habitat, how: FallenCapitalRec['how']): void {
    const list = fallenList(galaxy);
    if (list === null || list.some((r) => r.x === h.xpos && r.y === h.ypos) || e.dominantRace === null) return;
    list.push({ empire: e.name, name: h.name, systemName: placeName(galaxy, h), x: h.xpos, y: h.ypos, date: galaxyStarDate(galaxy), how });
}

/** capitalLost: a capital the Reclaimers took. */
export function onCapitalLost(galaxy: Galaxy, e: Empire, colony: Habitat, capturer: Empire | null): void {
    const st = peekBeaconState(galaxy);
    if (st === null || st.faction === null || capturer !== st.faction || e === st.faction) return;
    noteFallen(galaxy, e, colony, 'captured');
}

/** habitatDestroyed: a capital destroyed in the Beacon war. */
export function onCapitalDestroyed(galaxy: Galaxy, habitat: Habitat): void {
    const st = peekBeaconState(galaxy);
    const e = habitat.empire;
    if (st === null || st.phase !== 'reclamation' || e === null || e === st.faction || e.capital !== habitat) return;
    noteFallen(galaxy, e, habitat, 'destroyed');
}

/** The capitals that fell, for the memory record. Pure. */
export function captureFallen(galaxy: Galaxy): FallenCapitalRec[] | undefined {
    const list = (galaxy.scenario?.state[FALLEN_KEY] as FallenCapitalRec[] | undefined) ?? [];
    return list.length > 0 ? JSON.parse(JSON.stringify(list)) as FallenCapitalRec[] : undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// Placement helpers
// ---------------------------------------------------------------------------------------------------------------

/** A stream of its own (mulberry32) seeded from the galaxy seed and a salt, so the world's content does not move galaxy.rnd. */
export function age2Random(seed: number, salt: number): () => number {
    let a = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(salt | 0, 0x85ebca6b)) >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const RUIN_TYPES = new Set<HabitatType>([HabitatType.Continental, HabitatType.MarshySwamp, HabitatType.Desert, HabitatType.Ocean, HabitatType.Ice, HabitatType.Volcanic, HabitatType.BarrenRock]);

/** The systems of the empires' home worlds (a ruin or a hulk is never put on a survivor's doorstep). Pure. */
function homeSystems(galaxy: Galaxy): Set<number> {
    const out = new Set<number>();
    for (const e of galaxy.empires) if (e !== null && e !== galaxy.independentEmpire && e.capital !== null) out.add(e.capital.systemIndex);
    return out;
}

function freeOfOwners(h: Habitat, galaxy: Galaxy): boolean {
    return h.owner === null && (h.empire === null || h.empire === galaxy.independentEmpire);
}

function dist2(h: Habitat, x: number, y: number): number {
    return (h.xpos - x) * (h.xpos - x) + (h.ypos - y) * (h.ypos - y);
}

/** Habitats sorted by distance from (x, y) that pass `ok`. */
function nearest(galaxy: Galaxy, x: number, y: number, ok: (h: Habitat) => boolean, limit: number): Habitat[] {
    const list: { h: Habitat; d: number }[] = [];
    for (const h of galaxy.habitats) if (ok(h)) list.push({ h, d: dist2(h, x, y) });
    list.sort((a, b) => a.d - b.d);
    return list.slice(0, limit).map((v) => v.h);
}

// ---------------------------------------------------------------------------------------------------------------
// The ruins
// ---------------------------------------------------------------------------------------------------------------

/** Where an old capital's ruin goes: its own world when that is free and not in a home system, else the nearest free rocky world not in one. Pure. */
export function ruinHabitatFor(galaxy: Galaxy, rec: OldCapitalRec, homes: ReadonlySet<number>): Habitat | null {
    const ok = (h: Habitat): boolean =>
        h.ruin === null &&
        (h.category === HabitatCategoryType.Planet || h.category === HabitatCategoryType.Moon) &&
        RUIN_TYPES.has(h.type) &&
        h.diameter >= 60 &&
        !homes.has(h.systemIndex) &&
        freeOfOwners(h, galaxy);
    return nearest(galaxy, rec.x, rec.y, ok, 1)[0] ?? null;
}

function placeRuin(galaxy: Galaxy, habitat: Habitat, rec: OldCapitalRec, rnd: () => number): RuinSite {
    const range = Math.max(1, habitat.diameter - 10) / 2;
    const ang = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * range;
    const ruin = new Ruin(T(`${LN_TAG} Ruin Name`, rec.empire), Math.floor(rnd() * 16), 0.1 + rnd() * 0.2, Math.cos(ang) * r, Math.sin(ang) * r, 60000 + Math.floor(rnd() * 60000), 0, 4000 + Math.floor(rnd() * 6000));
    ruin.type = RuinType.Standard;
    ruin.description = T(`${LN_TAG} Ruin Description`, rec.empire, rec.race, rec.name);
    habitat.ruin = ruin;
    galaxy.ruinCount++;
    if (!galaxy.ruinsHabitats.includes(habitat)) galaxy.ruinsHabitats.push(habitat);
    return { habitat, empire: rec.empire, race: rec.race, parts: rec.parts === undefined ? null : JSON.parse(JSON.stringify(rec.parts)), surveyed: false };
}

/** The ruins of the old capitals in the new galaxy. */
export function placeRuins(galaxy: Galaxy, recs: readonly OldCapitalRec[]): RuinSite[] {
    const homes = homeSystems(galaxy);
    const rnd = age2Random(galaxy.randomSeed, 1);
    const out: RuinSite[] = [];
    for (const rec of recs) {
        const h = ruinHabitatFor(galaxy, rec, homes);
        if (h === null) continue;
        out.push(placeRuin(galaxy, h, rec, rnd));
    }
    return out;
}

const PART_KEYS = ['beamLens', 'linkConduit', 'cloakLattice', 'mindFragments', 'voidFrames'] as const;

/** Hands `parts` to `e` (flags join, counts add) into the Beacon state's record. Returns whether anything was handed over. */
function giveParts(galaxy: Galaxy, e: Empire, parts: EmpireParts): boolean {
    const st = beaconState(galaxy);
    st.parts ??= { held: {}, peakAssets: 0, lastAssets: 0, shipUnit: 0, firstBeam: 0, revealDate: 0, visited: [] };
    const mine = (st.parts.held[String(e.empireId)] ??= {});
    let any = false;
    for (const k of PART_KEYS) {
        const v = parts[k];
        if (v === true) {
            mine[k as 'beamLens'] = true;
            any = true;
        } else if (typeof v === 'number' && v > 0) {
            const key = k as 'mindFragments';
            mine[key] = (mine[key] ?? 0) + v;
            any = true;
        }
    }
    return any;
}

/** The parts of `p` as a sentence fragment ("the beam lens, 7 mind fragments"). */
function partsList(p: EmpireParts): string {
    const out: string[] = [];
    if (p.beamLens === true) out.push(T('Beacon Part Beam Lens'));
    if (p.linkConduit === true) out.push(T('Beacon Part Link Conduit'));
    if (p.cloakLattice === true) out.push(T('Beacon Part Cloak Lattice'));
    if ((p.mindFragments ?? 0) > 0) out.push(`${p.mindFragments} ${T('Beacon Part Mind Fragments')}`);
    if ((p.voidFrames ?? 0) > 0) out.push(`${p.voidFrames} ${T('Beacon Part Void Frames')}`);
    return out.join(', ');
}

/**
 * exploration.ts investigateRuins (top, before the stock outcome, which pays the money and research bonuses): an empire surveys an old
 * capital's ruin. The first to do so gets the parts the dead empire held (once); a human empire is told, in a popup the first time it surveys
 * one. A pirate faction or the independents get nothing here.
 */
export function onRuinSurveyed(galaxy: Galaxy, empire: Empire, habitat: Habitat): void {
    const ln = peekLongNight(galaxy);
    const w = age2WorldOf(galaxy);
    if (ln === null || ln.age < AGE_PREPARATION || w === null) return;
    const site = w.ruins.find((s) => s.habitat === habitat);
    if (site === undefined || !empire.active || empire === galaxy.independentEmpire || empire.pirateEmpireBaseHabitat !== null) return;
    const first = !site.surveyed;
    site.surveyed = true;
    let gave = false;
    let list = '';
    if (site.parts !== null && giveParts(galaxy, empire, site.parts)) {
        gave = true;
        list = partsList(site.parts);
        site.parts = null;
    }
    if (!isHumanEmpire(galaxy, empire) || !(first || gave)) return;
    if (gave) scenarioMessage(galaxy, empire, T(`${LN_TAG} Ruin Parts Title`), T(`${LN_TAG} Ruin Parts Body`, site.empire, habitat.name, list), { type: EmpireMessageType.GeneralGoodEvent, subject: habitat, popupMode: 'force' });
    else scenarioMessage(galaxy, empire, T(`${LN_TAG} Ruin Survey Title`), T(`${LN_TAG} Ruin Survey Body`, site.empire, habitat.name), { type: EmpireMessageType.GeneralGoodEvent, subject: habitat, popupMode: 'force' });
}

// ---------------------------------------------------------------------------------------------------------------
// The hulks
// ---------------------------------------------------------------------------------------------------------------

/** Hulks to place in a galaxy of `starCount` stars. */
export function hulkCount(starCount: number): number {
    return Math.max(2, Math.min(10, Math.round(Math.sqrt(starCount) * HULK_PER_ROOT_STAR)));
}

function hulkDesign(galaxy: Galaxy, by: Empire, sub: BuiltObjectSubRole): Design | null {
    const spec = by.designSpecifications.find((s) => s !== null && s.subRole === sub) ?? galaxyDesignSpecificationBySubRole(sub);
    if (spec === null || spec === undefined) return null;
    try {
        return generateDesignFromSpec(galaxy, by, spec, HULK_TECH_ADVANCE, galaxyStarDate(galaxy));
    } catch {
        return null;
    }
}

/** The places hulks lie near, with weights: the harvest scars, then the old capitals. Pure. */
export function hulkSources(memory: MemoryRecord, capitals: readonly OldCapitalRec[]): { x: number; y: number; w: number }[] {
    return [...memory.scars.map((s) => ({ x: s.x, y: s.y, w: SCAR_WEIGHT })), ...capitals.map((c) => ({ x: c.x, y: c.y, w: CAPITAL_WEIGHT }))];
}

function systemOfPoint(galaxy: Galaxy, x: number, y: number): number | null {
    let best: number | null = null;
    let bd = Infinity;
    for (const sys of galaxy.systems) {
        const star = sys?.systemStar;
        if (star === undefined || star === null) continue;
        const d = (star.xpos - x) * (star.xpos - x) + (star.ypos - y) * (star.ypos - y);
        if (d < bd) {
            bd = d;
            best = star.systemIndex;
        }
    }
    return best;
}

/**
 * The battlefields of the capitals that fell: in each such system (the earliest MAX_BATTLE_SYSTEMS) WRECKS_MIN..WRECKS_MAX Reclaimer hulks scattered
 * about its worlds, at most ONE claimable (the stock Acquire derelict, damaged); the rest are broken beyond repair and booby-trapped with their
 * live reactors (the stock "abandoned ship explodes" outcome), so they are scenery that bites, never a prize.
 */
export function placeBattles(galaxy: Galaxy, fallen: readonly FallenCapitalRec[], by: Empire): BattleSite[] {
    const out: BattleSite[] = [];
    const rnd = age2Random(galaxy.randomSeed, 3);
    const seen = new Set<number>();
    for (const f of [...fallen].sort((a, b) => a.date - b.date)) {
        if (out.length >= MAX_BATTLE_SYSTEMS) break;
        const si = systemOfPoint(galaxy, f.x, f.y);
        if (si === null || seen.has(si)) continue;
        const spots = galaxy.systemHabitatsOf(si).filter((h): h is Habitat => h !== null && h.category !== HabitatCategoryType.Star);
        if (spots.length === 0) continue;
        seen.add(si);
        const site: BattleSite = { systemIndex: si, empire: f.empire, how: f.how, claimable: null, wrecks: [] };
        const n = WRECKS_MIN + Math.floor(rnd() * (WRECKS_MAX - WRECKS_MIN + 1));
        for (let i = 0; i < n; i++) {
            const design = hulkDesign(galaxy, by, HULK_ROLES[Math.floor(rnd() * HULK_ROLES.length)]);
            if (design === null) continue;
            const bo = generateAbandonedBuiltObject(galaxy, spots[Math.floor(rnd() * spots.length)], design, false, false, BuiltObjectEncounterAction.Prompt);
            bo.name = T(`${LN_TAG} Hulk Name`, bo.name);
            if (i === 0) {
                bo.encounterEventType = BuiltObjectEncounterEventType.Acquire;
                damageBuiltObjectComponents(bo, HULK_DAMAGE);
                site.claimable = bo;
            } else {
                bo.encounterEventType = BuiltObjectEncounterEventType.Explodes;
                damageBuiltObjectComponents(bo, 1);
                site.wrecks.push(bo);
            }
        }
        if (site.claimable !== null || site.wrecks.length > 0) out.push(site);
    }
    return out;
}

/** Mixes Reclaimer hulks into the world as stock abandoned ships. Returns them. */
export function placeHulks(galaxy: Galaxy, memory: MemoryRecord, capitals: readonly OldCapitalRec[], taken: ReadonlySet<number> = new Set(), already = 0): BuiltObject[] {
    const out: BuiltObject[] = [];
    const by = galaxy.empires.find((e) => e !== null && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null && e.designSpecifications.length > 0) ?? null;
    if (by === null) return out;
    const homes = homeSystems(galaxy);
    const sources = hulkSources(memory, capitals);
    const total = sources.reduce((a, s) => a + s.w, 0);
    const rnd = age2Random(galaxy.randomSeed, 2);
    const usedSystems = new Set<number>(taken);
    const want = Math.max(0, hulkCount(galaxy.starCount) - already);
    for (let i = 0, tries = 0; out.length < want && tries < want * 6; tries++) {
        // where: a weighted old place, else anywhere
        let x: number;
        let y: number;
        if (total > 0) {
            let pick = rnd() * total;
            let s = sources[0];
            for (const c of sources) {
                s = c;
                pick -= c.w;
                if (pick < 0) break;
            }
            x = s.x;
            y = s.y;
        } else {
            const h = galaxy.habitats[Math.floor(rnd() * galaxy.habitats.length)];
            if (h === undefined) break;
            x = h.xpos;
            y = h.ypos;
        }
        const ok = (h: Habitat): boolean => h.category !== HabitatCategoryType.Star && !homes.has(h.systemIndex) && !usedSystems.has(h.systemIndex) && freeOfOwners(h, galaxy);
        const near = nearest(galaxy, x, y, ok, 6);
        const habitat = near[Math.floor(rnd() * near.length)];
        if (habitat === undefined) continue;
        const design = hulkDesign(galaxy, by, HULK_ROLES[i % HULK_ROLES.length]);
        if (design === null) continue;
        const bo = generateAbandonedBuiltObject(galaxy, habitat, design, false, false, BuiltObjectEncounterAction.Prompt);
        bo.encounterEventType = galaxy.piratePrevalence > 0 && rnd() < 0.25 ? BuiltObjectEncounterEventType.PirateAmbush : BuiltObjectEncounterEventType.Acquire;
        bo.name = T(`${LN_TAG} Hulk Name`, bo.name);
        damageBuiltObjectComponents(bo, HULK_DAMAGE);
        usedSystems.add(habitat.systemIndex);
        out.push(bo);
        i++;
    }
    return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------------------------------------------

/** The new galaxy, once built: the ruins of the old capitals and the Reclaimer hulks. Skipped without a Harvest Cycle scenario. */
function restoreWorld(galaxy: Galaxy, data: unknown): void {
    const memory = memoryRecordOf(galaxy);
    if (galaxy.scenario === null || memory === null) return;
    const capitals = Array.isArray(data) ? (data as OldCapitalRec[]) : [];
    const fallen = Array.isArray(memory.extra[FALLEN_ID]) ? (memory.extra[FALLEN_ID] as FallenCapitalRec[]) : [];
    const ruins = placeRuins(galaxy, capitals);
    const by = galaxy.empires.find((e) => e !== null && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null && e.designSpecifications.length > 0) ?? null;
    const battles = by === null ? [] : placeBattles(galaxy, fallen, by);
    const hulks = battles.flatMap((b) => [...(b.claimable === null ? [] : [b.claimable]), ...b.wrecks]);
    // the claimable one of each battlefield counts toward the total; the population-weighted hulks never go into a battlefield's system
    const claimables = battles.filter((b) => b.claimable !== null).length;
    hulks.push(...placeHulks(galaxy, memory, capitals, new Set(battles.map((b) => b.systemIndex)), claimables));
    galaxy.scenario.state[AGE2_WORLD_KEY] = { ruins, hulks, battles } satisfies Age2WorldState;
}

export function registerAge2World(): void {
    registerMemoryContributor({ id: FALLEN_ID, capture: captureFallen });
    registerMemoryContributor({ id: AGE2_WORLD_ID, capture: captureOldCapitals, restore: restoreWorld });
    registerScenarioEvent({ id: 'longNight.capitalLost', flag: HARVEST_CYCLE_FLAG, event: 'capitalLost', run: (g, e) => onCapitalLost(g, e.empire, e.colony, e.capturer) });
    registerScenarioEvent({ id: 'longNight.capitalDestroyed', flag: HARVEST_CYCLE_FLAG, event: 'habitatDestroyed', run: (g, e) => onCapitalDestroyed(g, e.habitat) });
    registerScenarioEvent({ id: 'longNight.ruins', flag: HARVEST_CYCLE_FLAG, event: 'ruinsInvestigated', run: (g, e) => onRuinSurveyed(g, e.empire, e.habitat) });
}
