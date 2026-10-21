// The Harvest Cycle, Age 2: the Precursor holdouts. Not a port. A few small empires of the age before that never fell to the Reclaimers, left
// to themselves behind old shields and old guns (seedAge2 runs the memory contributors' restore on the new galaxy, as age2World.ts does).
// Everything here is made of stock mechanics:
//
//  * Each holdout is a mid-game empire (scenario/empireMidGame.ts, the Exchange / Founders' Compact pattern): a CORE world (its capital) and a
//    few colonies founded before the stock set-up equips them (space ports, garrisons), at a clearly higher tech level than the pre-warp
//    empires (shields, reactors, beams). The stock AI runs it for defence, with colonisation, offence and treaties switched off, so it never
//    expands, never declares war and never signs a treaty (no peaceful route: the only way to its tech is conquest). Defence bases on top.
//  * The core is SHIELDED from invasion (query invasionBlocked, combat/invasion.ts: landings on it are wiped out and its garrison is untouched)
//    until every one of its colonies is gone: taken, destroyed or lost. Then the shield drops, with a message.
//  * Each non-core colony is rigged with chance holdoutRiggedPct: when an enemy takes it, it is destroyed (timeBomb.ts detonateHabitat, the
//    planet-destroyer explosion) a day later. The warning: when an armed ship of an empire at war with the holdout arrives over a rigged colony,
//    evacuation freighters lift off and a message tells the arriving human the colonists are fleeing.
//  * Whoever conquers the core is handed every technology the holdout had (the techs the holdout knows that they do not).
//
// Rnd: placement uses its own stream (age2Random); the empire's creation and the explosions draw galaxy.rnd inside the restore / the gated
// daily handler, as the other Age 2 content does. Scenario state `age2Holdouts` (plain data plus Empire / Habitat / BuiltObject references).

import { GAME_DAY_LENGTH, registerScenarioEvent, registerScenarioFramePeriodic, registerScenarioQuery } from '../../hooks';
import { scenarioParam, scenarioState } from '../../state';
import { scenarioMessage, scenarioNews, scenarioText as T } from '../../messages';
import { HARVEST_CYCLE_FLAG, memoryRecordOf, registerMemoryContributor } from './longNightState';
import type { Galaxy } from '../../../galaxy';
import type { ShipGroup } from '../../../fleets/shipGroup';
import type { Empire } from '../../../empire';
import { AutomationLevel } from '../../../empire';
import type { Race } from '../../../data/races';
import type { BuiltObject } from '../../../builtObject';
import { HabitatCategoryType, HabitatType, type Habitat } from '../../../types';
import { BuiltObjectRole } from '../../../data/designSpecifications';
import { BuiltObjectSubRole } from '../../../builtObjectTypes';
import { EmpireMessageType } from '../../../messages';
import { isHumanEmpire, humanEmpires } from '../../../humanEmpires';
import { galaxyStarDate } from '../../../tick/simTime';
import { makeHabitatIntoColony } from '../../../colony';
import { builtObjectCompleteTeardown } from '../../../combat/teardown';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../../../missions/mission';
import { assignMission } from '../../../missions/assign';
import { obtainDiplomaticRelation, DiplomaticRelationType } from '../../../diplomacy';
import { createEmpireMidGame } from '../../empireMidGame';
import { registerCouncilExtension } from '../../emergent/council';
import { calculateOverallStrengthFactor } from '../../../combat/threats';
import { shipGroupTotalOverallStrengthFactor } from '../../../fleets/shipGroup';
import { maxDesignTechLevel, empireTechLevel } from '../robotMutiny';
import { detonateHabitat } from '../timeBomb';
import { age2Random } from './age2World';
import { inForeignTerritory, capitals } from './founders';
import { factionDesign, introduce, peacefulPolicy, placeObject } from './lifecycle';
import { ordinaryEmpires } from './state';

export const HOLDOUTS_ID = 'age2.holdouts';
/** The scenario state key. */
export const HOLDOUTS_KEY = 'age2Holdouts';
export const HOLDOUT_TAG = 'Holdout';

const DEFAULTS = {
    /** Most holdouts (the count scales with the galaxy's size up to this). */
    holdoutMax: 5,
    /** Chance (percent) that a non-core colony is rigged. */
    holdoutRiggedPct: 20,
    /** Tech levels above the best ordinary empire the holdouts have (at least 4 in all; capped by the best the design generator reaches). */
    holdoutTechBonus: 3,
    /** Defence bases at the core (each colony gets one fewer, at least one). */
    holdoutDefences: 3,
    /** Sectors a holdout's colonies lie within of its core. */
    holdoutColonySectors: 2,
    /** The home fleet's size at the start (a roll between the two), in warships. */
    holdoutFleetMin: 15,
    holdoutFleetMax: 20,
    /** Days between two free rebuilds at the core (a roll between the two, each time). */
    holdoutRebuildMin: 90,
    holdoutRebuildMax: 120,
    /** An AI fleet invades a holdout world only when it is at least this percent of the holdout's whole home fleet plus its defence bases (the stock check sees only the ships in the system). */
    holdoutAiRatioPct: 125,
} as const;
export type HoldoutParamName = keyof typeof DEFAULTS;

export function holdoutParam(galaxy: Galaxy, name: HoldoutParamName): number {
    return scenarioParam(galaxy, name, DEFAULTS[name]);
}

/** The holdouts' lowest tech level (Age 1's shields, reactors and beams all exist from here). */
export const HOLDOUT_MIN_TECH = 4;
/** Fewest and most colonies a holdout is given besides its core. */
export const COLONIES_MIN = 2;
export const COLONIES_MAX = 3;
/** Sectors a holdout keeps from every capital, Scar and the old Beacon site, and from the other holdouts. */
const KEEP_CAPITAL_SECTORS = 2;
const KEEP_SCAR_SECTORS = 1;
const KEEP_OTHER_SECTORS = 3;
/** A rigged colony is destroyed this long after it is taken (days). */
export const BLOW_DELAY_DAYS = 1;
/** An armed ship of an enemy within this many sectors of a rigged colony sets its evacuation off. */
export const WARN_SECTORS = 0.3;
/** Freighters that leave a rigged colony, and the days they stay before they are gone. */
export const EVAC_FREIGHTERS = 3;
export const EVAC_DAYS = 15;
/** The warship mix of a home fleet, by slot (cycled): heavy, medium and light ships. */
export const FLEET_MIX: readonly BuiltObjectSubRole[] = [BuiltObjectSubRole.Cruiser, BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.Frigate, BuiltObjectSubRole.Escort, BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.Frigate];
/** A patrolling ship further than this many sectors from every world of its holdout is called back. */
export const STRAY_SECTORS = 0.6;
/** Salt of the rebuild rolls (age2Random). */
const REBUILD_SALT = 5000;
/** Days between two "the shield holds" notes to one empire. */
const HELD_NOTE_DAYS = 10;

export interface HoldoutColony {
    habitat: Habitat;
    rigged: boolean;
    /** The colonists have been evacuated (the warning was given). */
    fled: boolean;
    /** held until it is taken (the empire that holds it now is `habitat.empire`), 'blown' once the rig has destroyed it. */
    fate: 'held' | 'taken' | 'blown';
}

export interface HoldoutRec {
    id: number;
    empire: Empire;
    core: Habitat;
    colonies: HoldoutColony[];
    /** The core's shield stands (until every colony is gone). */
    shield: boolean;
    /** The core was conquered / destroyed: its tech handed over once. */
    coreFate: 'held' | 'taken' | 'destroyed';
    /** The empire the core's tech went to (empire id), -1 none. */
    techTo: number;
    /** The home fleet: one slot per ship it started with (a lost ship leaves its slot empty until the core rebuilds it). */
    fleet: FleetSlot[];
    /** Star date of the next free rebuild at the core, -1 none due. */
    nextRebuild: number;
    /** Rebuilds so far (keys the rebuild rolls). */
    rebuilds: number;
    /** The core's shield dropped: no more rebuilding, for good. */
    rebuildStopped: boolean;
}

export interface FleetSlot {
    role: BuiltObjectSubRole;
    ship: BuiltObject | null;
    /** The index (into the holdout's worlds, core first) of the world it patrols next / now. */
    stop: number;
}

export interface Evacuee {
    ship: BuiltObject;
    until: number;
}

export interface HoldoutsState {
    holdouts: HoldoutRec[];
    evacuees: Evacuee[];
    /** Rigged colonies taken and waiting to blow: habitat → star date due. Plain list so a save keeps it. */
    pending: { habitat: Habitat; due: number; by: Empire | null }[];
    /** Star date a "the shield holds" note last went to an empire, by empire id. */
    heldNote: Record<string, number>;
}

export function holdoutsState(galaxy: Galaxy): HoldoutsState {
    return scenarioState<HoldoutsState>(galaxy, HOLDOUTS_KEY, () => ({ holdouts: [], evacuees: [], pending: [], heldNote: {} }));
}

/** The state if the game has one (a read never creates it). */
export function peekHoldouts(galaxy: Galaxy): HoldoutsState | null {
    const s = galaxy.scenario?.state[HOLDOUTS_KEY];
    return s === undefined || s === null ? null : (s as HoldoutsState);
}

export function holdoutOf(galaxy: Galaxy, empire: Empire | null): HoldoutRec | null {
    if (empire === null) return null;
    return peekHoldouts(galaxy)?.holdouts.find((h) => h.empire === empire) ?? null;
}

/** True for a holdout empire. */
export function isHoldout(galaxy: Galaxy, empire: Empire | null): boolean {
    return holdoutOf(galaxy, empire) !== null;
}

// ---------------------------------------------------------------------------------------------------------------
// Shield
// ---------------------------------------------------------------------------------------------------------------

/** A colony of the holdout is gone from it: taken, destroyed or lost. Pure. */
export function colonyGone(rec: HoldoutRec, c: HoldoutColony): boolean {
    return c.fate !== 'held' || c.habitat.hasBeenDestroyed || c.habitat.empire !== rec.empire;
}

/** Colonies the holdout still holds. Pure. */
export function coloniesLeft(rec: HoldoutRec): number {
    return rec.colonies.filter((c) => !colonyGone(rec, c)).length;
}

/** True while the core's shield stands: it is still the holdout's and a colony remains. Pure. */
export function coreShielded(rec: HoldoutRec): boolean {
    return rec.shield && rec.coreFate === 'held' && !rec.core.hasBeenDestroyed && rec.core.empire === rec.empire;
}

// ---------------------------------------------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------------------------------------------

/** Holdouts for a galaxy of `starCount` stars: about a quarter of the square root, 2 to `max`. Pure. */
export function holdoutCount(starCount: number, max: number = DEFAULTS.holdoutMax): number {
    return Math.max(2, Math.min(max, Math.round(Math.sqrt(Math.max(0, starCount)) / 4)));
}

const CORE_TYPES: ReadonlySet<HabitatType> = new Set([HabitatType.Continental, HabitatType.Ocean, HabitatType.MarshySwamp, HabitatType.Desert, HabitatType.Ice, HabitatType.Volcanic, HabitatType.BarrenRock]);

function isWorld(h: Habitat): boolean {
    return h.category === HabitatCategoryType.Planet && CORE_TYPES.has(h.type);
}

function untouched(galaxy: Galaxy, h: Habitat): boolean {
    return !h.hasBeenDestroyed && h.empire === null && h.owner === null && h.ruin === null && (h.population?.totalAmount ?? 0) <= 0 && h.quality >= 0.5;
}

/** The peoples a holdout can be made of, by the world type they call home. */
function racesByType(galaxy: Galaxy): Map<HabitatType, Race> {
    const out = new Map<HabitatType, Race>();
    for (const r of galaxy.races) {
        if (r === null || !r.playable || !r.canBeNormalEmpire) continue;
        if (!out.has(r.nativeHabitatType)) out.set(r.nativeHabitatType, r as Race);
    }
    return out;
}

function systemsHeldByEmpires(galaxy: Galaxy): Set<number> {
    const out = new Set<number>();
    for (const h of galaxy.habitats) if (h.empire !== null && h.empire !== galaxy.independentEmpire) out.add(h.systemIndex);
    return out;
}

/**
 * The core worlds and their peoples, best first: free habitable planets (the type of a people's homeland) in systems no empire holds, outside
 * foreign territory, at least KEEP_CAPITAL_SECTORS from every capital and KEEP_SCAR_SECTORS from every place in `avoid` (Scars, the old Beacon
 * site), KEEP_OTHER_SECTORS from each other, with at least COLONIES_MIN free worlds within the colony range. Each pick is one of the farthest
 * few from everything (the quiet regions), drawn with `rnd`. Pure but for `rnd`.
 */
export function pickCores(galaxy: Galaxy, avoid: readonly { x: number; y: number }[], count: number, rnd: () => number, colonySectors: number = DEFAULTS.holdoutColonySectors): { core: Habitat; race: Race }[] {
    const sector = galaxy.sectorSize;
    const races = racesByType(galaxy);
    const caps = capitals(galaxy);
    const held = systemsHeldByEmpires(galaxy);
    const worlds = galaxy.habitats.filter((h) => isWorld(h) && untouched(galaxy, h));
    const out: { core: Habitat; race: Race }[] = [];
    const far = (x: number, y: number, pts: readonly { x: number; y: number }[]): number => {
        let d = Infinity;
        for (const p of pts) d = Math.min(d, galaxy.calculateDistance(x, y, p.x, p.y));
        return d;
    };
    for (let n = 0; n < count; n++) {
        const picked = out.map((o) => ({ x: o.core.xpos, y: o.core.ypos }));
        const cands: { h: Habitat; race: Race; score: number }[] = [];
        for (const h of worlds) {
            const race = races.get(h.type);
            if (race === undefined || held.has(h.systemIndex) || out.some((o) => o.core.systemIndex === h.systemIndex)) continue;
            if (far(h.xpos, h.ypos, caps) < KEEP_CAPITAL_SECTORS * sector || far(h.xpos, h.ypos, avoid) < KEEP_SCAR_SECTORS * sector || far(h.xpos, h.ypos, picked) < KEEP_OTHER_SECTORS * sector) continue;
            if (inForeignTerritory(galaxy, h.xpos, h.ypos)) continue;
            let near = 0;
            for (const w of worlds) {
                if (w === h || galaxy.calculateDistance(w.xpos, w.ypos, h.xpos, h.ypos) > colonySectors * sector) continue;
                if (++near >= COLONIES_MIN) break;
            }
            if (near < COLONIES_MIN) continue;
            cands.push({ h, race, score: Math.min(far(h.xpos, h.ypos, caps), far(h.xpos, h.ypos, avoid), far(h.xpos, h.ypos, picked)) });
        }
        if (cands.length === 0) break;
        cands.sort((a, b) => b.score - a.score || a.h.habitatIndex - b.h.habitatIndex);
        const top = cands.slice(0, 4);
        const pick = top[Math.floor(rnd() * top.length)];
        out.push({ core: pick.h, race: pick.race });
    }
    return out;
}

/** The tech level the holdouts are made at: the best ordinary empire's plus the bonus, at least HOLDOUT_MIN_TECH, at most the generator's top. Pure. */
export function holdoutTechLevel(galaxy: Galaxy): number {
    let best = 1;
    for (const e of ordinaryEmpires(galaxy)) if (!isHoldout(galaxy, e)) best = Math.max(best, empireTechLevel(e));
    const top = Math.max(HOLDOUT_MIN_TECH, maxDesignTechLevel(galaxy));
    return Math.min(top, Math.max(HOLDOUT_MIN_TECH, best + Math.trunc(holdoutParam(galaxy, 'holdoutTechBonus'))));
}

/** Founds up to `want` colonies for `r` within the colony range of its capital (Habitat.quality >= 0.5, a type it can live on, in a system no other empire holds), nearest first. Draws galaxy.rnd. */
function foundColonies(galaxy: Galaxy, r: Empire, want: number, sectors: number): Habitat[] {
    const capital = r.capital;
    const race = r.dominantRace;
    if (capital === null || race === null || want <= 0) return [];
    const types = r.colonizableHabitatTypesForEmpire();
    if (!types.includes(race.nativeHabitatType)) types.push(race.nativeHabitatType);
    const limit = galaxy.sectorSize * sectors;
    const foreign = new Map<number, boolean>();
    const cands: { h: Habitat; d: number }[] = [];
    for (const h of galaxy.habitats) {
        if (h.category !== HabitatCategoryType.Planet && h.category !== HabitatCategoryType.Moon) continue;
        if (h === capital || h.hasBeenDestroyed || h.empire !== null || h.owner !== null || h.ruin !== null || h.population.totalAmount > 0) continue;
        if (!types.includes(h.type) || !(h.quality >= 0.5)) continue;
        const d = galaxy.calculateDistance(capital.xpos, capital.ypos, h.xpos, h.ypos);
        if (d > limit) continue;
        let f = foreign.get(h.systemIndex);
        if (f === undefined) {
            f = galaxy.systemHabitatsOf(h.systemIndex).some((x) => x.empire !== null && x.empire !== r && x.empire !== galaxy.independentEmpire);
            foreign.set(h.systemIndex, f);
        }
        if (f || !galaxy.checkEmpireTerritoryCanColonizeHabitat(r, h)) continue;
        cands.push({ h, d });
    }
    cands.sort((a, b) => a.d - b.d || a.h.habitatIndex - b.h.habitatIndex);
    const out: Habitat[] = [];
    for (const { h } of cands.slice(0, want)) {
        makeHabitatIntoColony(galaxy, h, r, 1, race, 1.0, false);
        const i = galaxy.independentColonies.indexOf(h);
        if (i >= 0) galaxy.independentColonies.splice(i, 1);
        galaxy.empireTerritory.reviewEmpireTerritoryUpdate(galaxy, { x: Math.trunc(h.xpos) - 1600000, y: Math.trunc(h.ypos) - 1600000, w: 3200000, h: 3200000 });
        out.push(h);
    }
    return out;
}

/** The stock AI kept for defence; colonisation, offence, treaties and gifts off (the Exchange / Compact precedent). */
function switchOffExpansion(faction: Empire): void {
    faction.controlColonization = AutomationLevel.Undefined;
    faction.controlDiplomacyGifts = AutomationLevel.Undefined;
    faction.controlDiplomacyOffense = AutomationLevel.Undefined;
    faction.controlDiplomacyTreaties = AutomationLevel.Undefined;
}

function addDefences(galaxy: Galaxy, e: Empire, core: Habitat, colonies: readonly Habitat[]): void {
    const design = factionDesign(galaxy, e, BuiltObjectSubRole.DefensiveBase, true);
    if (design === null) return;
    const perCore = Math.max(0, Math.trunc(holdoutParam(galaxy, 'holdoutDefences')));
    for (const [h, n] of [[core, perCore], ...colonies.map((c) => [c, Math.max(1, perCore - 1)] as const)] as const) {
        for (let i = 0; i < n; i++) {
            const bo = placeObject(galaxy, e, design, h, null, true);
            bo.supportCostFactor = 1;
        }
    }
}

/**
 * Makes one holdout empire at `core` (the people `race`). Returns its record, or null when the galaxy has no empire id left. Draws galaxy.rnd
 * (the empire, its colonies, the defence bases) and `rnd` (which colonies are rigged).
 */
export function createHoldout(galaxy: Galaxy, core: Habitat, race: Race, rnd: () => number): HoldoutRec | null {
    const st = holdoutsState(galaxy);
    let founded: Habitat[] = [];
    const want = COLONIES_MIN + Math.floor(rnd() * (COLONIES_MAX - COLONIES_MIN + 1));
    const empire = createEmpireMidGame(galaxy, {
        race,
        home: core,
        name: T(`${HOLDOUT_TAG} Empire Name`, race.name),
        age: 1,
        techLevel: holdoutTechLevel(galaxy),
        homeSystemFavourability: 'Normal',
        setup: true,
        configurePolicy: peacefulPolicy,
        beforeSetup: (e) => {
            founded = foundColonies(galaxy, e, want, holdoutParam(galaxy, 'holdoutColonySectors'));
        },
    });
    if (empire === null) return null;
    switchOffExpansion(empire);
    empire.stateMoney = Math.max(empire.stateMoney, 3_000_000);
    for (const e of ordinaryEmpires(galaxy)) introduce(empire, e);
    addDefences(galaxy, empire, empire.capital ?? core, founded);
    const home = empire.capital ?? core;
    const pct = holdoutParam(galaxy, 'holdoutRiggedPct');
    const colonies = empire.colonies.filter((c) => c !== home).map((h): HoldoutColony => ({ habitat: h, rigged: rnd() * 100 < pct, fled: false, fate: 'held' }));
    const rec: HoldoutRec = { id: st.holdouts.length, empire, core: home, colonies, shield: colonies.length > 0, coreFate: 'held', techTo: -1, fleet: [], nextRebuild: -1, rebuilds: 0, rebuildStopped: false };
    st.holdouts.push(rec);
    raiseFleet(galaxy, rec, rnd);
    return rec;
}

/** Places the holdouts of a new Age 2 galaxy: `count` of them (default: by galaxy size), clear of `avoid`. Returns their records. */
export function placeHoldouts(galaxy: Galaxy, avoid: readonly { x: number; y: number }[], count: number = Math.min(holdoutCount(galaxy.starCount, Math.trunc(holdoutParam(galaxy, 'holdoutMax'))), Math.trunc(holdoutParam(galaxy, 'holdoutMax')))): HoldoutRec[] {
    const rnd = age2Random(galaxy.randomSeed, 4);
    const out: HoldoutRec[] = [];
    for (const { core, race } of pickCores(galaxy, avoid, count, rnd, holdoutParam(galaxy, 'holdoutColonySectors'))) {
        const rec = createHoldout(galaxy, core, race, rnd);
        if (rec === null) break;
        out.push(rec);
    }
    return out;
}

function restoreHoldouts(galaxy: Galaxy): void {
    const memory = memoryRecordOf(galaxy);
    if (galaxy.scenario === null || memory === null) return;
    const avoid = [...memory.scars.map((s) => ({ x: s.x, y: s.y })), ...(memory.beaconSite != null ? [{ x: memory.beaconSite.x, y: memory.beaconSite.y }] : [])];
    holdoutsState(galaxy);
    placeHoldouts(galaxy, avoid);
}


// ---------------------------------------------------------------------------------------------------------------
// The home fleet
// ---------------------------------------------------------------------------------------------------------------

/** The worlds the holdout still holds, the core first. Pure. */
export function holdoutWorlds(rec: HoldoutRec): Habitat[] {
    const out: Habitat[] = [];
    if (!rec.core.hasBeenDestroyed && rec.core.empire === rec.empire) out.push(rec.core);
    for (const c of rec.colonies) if (!colonyGone(rec, c)) out.push(c.habitat);
    return out;
}

/** Ships of the home fleet afloat. Pure. */
export function fleetAlive(rec: HoldoutRec): BuiltObject[] {
    const out: BuiltObject[] = [];
    for (const f of rec.fleet) if (f.ship !== null && !f.ship.hasBeenDestroyed && f.ship.empire === rec.empire) out.push(f.ship);
    return out;
}

/** The home fleet's strength (the stock overall strength factor summed). Pure. */
export function fleetStrength(rec: HoldoutRec): number {
    let sum = 0;
    for (const b of fleetAlive(rec)) sum += calculateOverallStrengthFactor(b);
    return sum;
}

/** The holdout's defence bases still standing (Pure). */
export function basesAlive(rec: HoldoutRec): BuiltObject[] {
    return rec.empire.builtObjects.filter((b) => !b.hasBeenDestroyed && b.subRole === BuiltObjectSubRole.DefensiveBase);
}

/** What an attacker faces: the home fleet and the defence bases (Pure). */
export function defenceStrength(rec: HoldoutRec): number {
    let sum = fleetStrength(rec);
    for (const b of basesAlive(rec)) sum += calculateOverallStrengthFactor(b);
    return sum;
}

function fleetDesign(galaxy: Galaxy, e: Empire, role: BuiltObjectSubRole): ReturnType<typeof factionDesign> {
    return factionDesign(galaxy, e, role) ?? factionDesign(galaxy, e, BuiltObjectSubRole.Destroyer) ?? factionDesign(galaxy, e, BuiltObjectSubRole.Frigate);
}

/**
 * One warship of `role` at `at`: the holdout's own frozen-tech design, state-owned (no upkeep) and kept off the empire AI's hands, so that only
 * the daily patrol orders move it (a patrolling ship still answers any attack: the stock threat evaluation).
 */
function buildWarship(galaxy: Galaxy, rec: HoldoutRec, role: BuiltObjectSubRole, at: Habitat): BuiltObject | null {
    const design = fleetDesign(galaxy, rec.empire, role);
    if (design === null) return null;
    const bo = placeObject(galaxy, rec.empire, design, at, null, true);
    bo.isAutoControlled = false;
    return bo;
}

/** The starting fleet: `holdoutFleetMin`..`holdoutFleetMax` ships in the FLEET_MIX, slot i starting at world i (round the core and the colonies). Draws `rnd` once and galaxy.rnd (the ships). */
function raiseFleet(galaxy: Galaxy, rec: HoldoutRec, rnd: () => number): void {
    const lo = Math.max(0, Math.trunc(holdoutParam(galaxy, 'holdoutFleetMin')));
    const hi = Math.max(lo, Math.trunc(holdoutParam(galaxy, 'holdoutFleetMax')));
    const size = lo + Math.floor(rnd() * (hi - lo + 1));
    const worlds = holdoutWorlds(rec);
    for (let i = 0; i < size; i++) {
        const role = FLEET_MIX[i % FLEET_MIX.length];
        const stop = worlds.length === 0 ? 0 : i % worlds.length;
        rec.fleet.push({ role, ship: worlds.length === 0 ? null : buildWarship(galaxy, rec, role, worlds[stop]), stop });
    }
}

function isIdle(bo: BuiltObject): boolean {
    const m = builtObjectMission(bo.mission);
    return m === null || m.type === BuiltObjectMissionType.Undefined || m.type === BuiltObjectMissionType.Hold;
}

/** Orders the ship round to `worlds[stop]` (Patrol: the stock orbit, a dozen loops). */
function patrol(galaxy: Galaxy, bo: BuiltObject, worlds: readonly Habitat[], stop: number): void {
    assignMission(galaxy, bo, BuiltObjectMissionType.Patrol, worlds[stop], null, BuiltObjectMissionPriority.Normal, { manuallyAssigned: true });
}

/** True when `bo` is further than STRAY_SECTORS from every world in `worlds`. */
function strayed(galaxy: Galaxy, bo: BuiltObject, worlds: readonly Habitat[]): boolean {
    const limit = galaxy.sectorSize * STRAY_SECTORS;
    return !worlds.some((w) => galaxy.calculateDistance(bo.xpos, bo.ypos, w.xpos, w.ypos) <= limit);
}

/**
 * The patrol rotation: a ship with nothing to do (its round done), or called off its worlds (a chase), or on a world that is gone, is ordered
 * to the next world of the holdout (core, colonies, core ...). Ships stay topped up on fuel (the old drives; they never need the port).
 */
function patrolFleet(galaxy: Galaxy, rec: HoldoutRec): void {
    const worlds = holdoutWorlds(rec);
    if (worlds.length === 0) return;
    for (const slot of rec.fleet) {
        const bo = slot.ship;
        if (bo === null || bo.hasBeenDestroyed) continue;
        if (bo.currentFuel < bo.fuelCapacity * 0.5) bo.currentFuel = bo.fuelCapacity;
        const m = builtObjectMission(bo.mission);
        const onWorld = m !== null && m.type === BuiltObjectMissionType.Patrol && m.targetHabitat !== null && worlds.includes(m.targetHabitat);
        if (isIdle(bo)) {
            slot.stop = (slot.stop + 1) % worlds.length;
            patrol(galaxy, bo, worlds, slot.stop);
        } else if (!onWorld && m !== null && m.type === BuiltObjectMissionType.Patrol) {
            slot.stop = slot.stop % worlds.length;
            patrol(galaxy, bo, worlds, slot.stop);
        } else if (strayed(galaxy, bo, worlds)) {
            slot.stop = slot.stop % worlds.length;
            patrol(galaxy, bo, worlds, slot.stop);
        }
    }
}

/** Days until the next rebuild: a roll in [holdoutRebuildMin, holdoutRebuildMax] keyed by the holdout and its rebuild count (pure, no galaxy.rnd; a save repeats it). */
export function rebuildDays(galaxy: Galaxy, rec: HoldoutRec): number {
    const lo = Math.max(1, Math.trunc(holdoutParam(galaxy, 'holdoutRebuildMin')));
    const hi = Math.max(lo, Math.trunc(holdoutParam(galaxy, 'holdoutRebuildMax')));
    return lo + Math.floor(age2Random(galaxy.randomSeed, REBUILD_SALT + rec.id * 1009 + rec.rebuilds)() * (hi - lo + 1));
}

/** Free rebuilds: one lost ship comes back at the core every rebuildDays, until the starting size is back. They stop for good once the core's shield drops. */
function rebuildFleet(galaxy: Galaxy, rec: HoldoutRec, now: number): void {
    if (rec.rebuildStopped) return;
    if (!coreShielded(rec)) {
        rec.rebuildStopped = true;
        rec.nextRebuild = -1;
        return;
    }
    const slot = rec.fleet.find((f) => f.ship === null || f.ship.hasBeenDestroyed || f.ship.empire !== rec.empire);
    if (slot === undefined) {
        rec.nextRebuild = -1;
        return;
    }
    if (rec.nextRebuild < 0) rec.nextRebuild = now + rebuildDays(galaxy, rec) * GAME_DAY_LENGTH;
    if (now < rec.nextRebuild) return;
    slot.ship = buildWarship(galaxy, rec, slot.role, rec.core);
    slot.stop = 0;
    rec.rebuilds++;
    rec.nextRebuild = -1;
}

// ---------------------------------------------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------------------------------------------

function systemName(galaxy: Galaxy, h: Habitat): string {
    return galaxy.determineHabitatSystemStar(h).name;
}

function human(galaxy: Galaxy, e: Empire | null): e is Empire {
    return e !== null && e.active && isHumanEmpire(galaxy, e);
}

/** A human empire that knows the holdout's core system (explored it): for news lines. */
function knownTo(galaxy: Galaxy, rec: HoldoutRec): Empire[] {
    return humanEmpires(galaxy).filter((e) => e.active && e.visibility.checkSystemExplored(rec.core.systemIndex));
}

// ---------------------------------------------------------------------------------------------------------------
// The shield (query invasionBlocked)
// ---------------------------------------------------------------------------------------------------------------

/** invasionBlocked: a landing on a shielded core fails; a human invader is told, at most once per HELD_NOTE_DAYS. */
export function onInvasionBlocked(galaxy: Galaxy, habitat: Habitat, invader: Empire | null): boolean {
    const st = peekHoldouts(galaxy);
    if (st === null) return false;
    const rec = st.holdouts.find((h) => h.core === habitat);
    if (rec === undefined || !coreShielded(rec)) return false;
    if (human(galaxy, invader)) {
        const now = galaxyStarDate(galaxy);
        const last = st.heldNote[String(invader.empireId)];
        if (last === undefined || now - last >= HELD_NOTE_DAYS * GAME_DAY_LENGTH) {
            st.heldNote[String(invader.empireId)] = now;
            scenarioMessage(galaxy, invader, T(`${HOLDOUT_TAG} Shield Held Title`), T(`${HOLDOUT_TAG} Shield Held Body`, habitat.name, rec.empire.name, coloniesLeft(rec)), { type: EmpireMessageType.GeneralBadEvent, subject: habitat });
        }
    }
    return true;
}

/** Re-checks the shield: it falls when no colony is left. Tells the humans who know the holdout. */
export function reviewShield(galaxy: Galaxy, rec: HoldoutRec, by: Empire | null): void {
    for (const c of rec.colonies) if (c.fate === 'held' && (c.habitat.hasBeenDestroyed || c.habitat.empire !== rec.empire)) c.fate = c.habitat.hasBeenDestroyed ? 'blown' : 'taken';
    if (!rec.shield || coloniesLeft(rec) > 0) return;
    rec.shield = false;
    if (rec.coreFate !== 'held') return;
    const place = systemName(galaxy, rec.core);
    if (human(galaxy, by)) scenarioMessage(galaxy, by, T(`${HOLDOUT_TAG} Shield Down Title`, rec.core.name), T(`${HOLDOUT_TAG} Shield Down Body`, rec.core.name, rec.empire.name, place), { type: EmpireMessageType.GeneralGoodEvent, subject: rec.core, popupMode: 'force' });
    scenarioNews(galaxy, rec.empire, T(`${HOLDOUT_TAG} News Shield Down`, rec.core.name, rec.empire.name), (e) => e !== by && knownTo(galaxy, rec).includes(e), rec.core);
}

// ---------------------------------------------------------------------------------------------------------------
// Conquest: the core's tech, the rigged colonies
// ---------------------------------------------------------------------------------------------------------------

/**
 * Hands `to` every technology `from` has researched that `to` lacks (with the parents they need; not the special techs, and not those the
 * people of `to` may not research), then refreshes `to`'s abilities and designs. Returns the names of the techs handed over, best first.
 */
export function grantTech(galaxy: Galaxy, from: Empire, to: Empire): string[] {
    const mine = new Map<number, (typeof to.research.techTree)[number]>();
    for (const n of to.research.techTree) mine.set(n.def.projectId, n);
    const allowed = galaxy.researchStatic?.allowedRaces;
    const race = to.dominantRace;
    const given: (typeof to.research.techTree)[number][] = [];
    const mark = (n: (typeof to.research.techTree)[number]): void => {
        if (n.isResearched) return;
        const a = allowed?.get(n.def.projectId);
        if (a !== undefined && a.size > 0 && (race === null || !a.has(race.name))) return;
        for (const p of n.parentNodes ?? []) mark(p);
        n.isResearched = true;
        n.selfResearched = true;
        n.isEnabled = true;
        n.progress = n.cost;
        given.push(n);
    };
    for (const n of from.research.techTree) {
        if (!n.isResearched || n.def.techLevel >= 100) continue;
        const t = mine.get(n.def.projectId);
        if (t !== undefined) mark(t);
    }
    if (given.length === 0) return [];
    to.research.update(race);
    to.reviewResearchAbilities();
    to.reviewDesignsBuiltObjectsImprovedComponents();
    return given.sort((a, b) => b.def.techLevel - a.def.techLevel || a.def.projectId - b.def.projectId).map((n) => n.def.name);
}

/** colonyOwnerChanged: a holdout world changed hands. */
export function onColonyOwnerChanged(galaxy: Galaxy, colony: Habitat, from: Empire | null, to: Empire | null): void {
    const st = peekHoldouts(galaxy);
    if (st === null || from === null || to === null || to === from) return;
    const rec = st.holdouts.find((h) => h.empire === from);
    if (rec === undefined) return;
    if (colony === rec.core) {
        if (rec.coreFate !== 'held') return;
        rec.coreFate = 'taken';
        rec.techTo = to.empireId;
        const names = to === galaxy.independentEmpire || to.pirateEmpireBaseHabitat !== null ? [] : grantTech(galaxy, from, to);
        const best = names.slice(0, 3).join(', ');
        if (human(galaxy, to)) {
            scenarioMessage(galaxy, to, T(`${HOLDOUT_TAG} Core Taken Title`, colony.name), T(`${HOLDOUT_TAG} Core Taken Body`, colony.name, from.name, names.length, best), { type: EmpireMessageType.GeneralGoodEvent, subject: colony, popupMode: 'force' });
        }
        scenarioNews(galaxy, from, T(`${HOLDOUT_TAG} News Core Taken`, colony.name, from.name, to.name), (e) => e !== to && knownTo(galaxy, rec).includes(e), colony);
        return;
    }
    const c = rec.colonies.find((x) => x.habitat === colony);
    if (c === undefined || c.fate !== 'held') return;
    c.fate = 'taken';
    if (c.rigged && to !== galaxy.independentEmpire && to.pirateEmpireBaseHabitat === null) st.pending.push({ habitat: colony, due: galaxyStarDate(galaxy) + BLOW_DELAY_DAYS * GAME_DAY_LENGTH, by: to });
    reviewShield(galaxy, rec, to);
}

/** The rigs go off: a rigged colony taken a day ago is destroyed (the planet-destroyer explosion). */
function blowDue(galaxy: Galaxy, st: HoldoutsState, now: number): void {
    const keep: HoldoutsState['pending'] = [];
    for (const p of st.pending) {
        if (p.due > now) {
            keep.push(p);
            continue;
        }
        const h = p.habitat;
        if (h.hasBeenDestroyed) continue;
        const rec = st.holdouts.find((r) => r.colonies.some((c) => c.habitat === h));
        const owner = h.empire;
        const name = h.name;
        const place = systemName(galaxy, h);
        detonateHabitat(galaxy, h);
        const col = rec?.colonies.find((c) => c.habitat === h);
        if (col !== undefined) col.fate = 'blown';
        if (human(galaxy, owner)) scenarioMessage(galaxy, owner, T(`${HOLDOUT_TAG} Colony Blown Title`, name), T(`${HOLDOUT_TAG} Colony Blown Body`, name, place), { type: EmpireMessageType.GeneralBadEvent, subject: h, popupMode: 'force' });
        if (rec !== undefined) reviewShield(galaxy, rec, p.by);
    }
    st.pending = keep;
}

// ---------------------------------------------------------------------------------------------------------------
// The warning: evacuation freighters
// ---------------------------------------------------------------------------------------------------------------

function atWarWith(a: Empire, b: Empire): boolean {
    return obtainDiplomaticRelation(a, b).type === DiplomaticRelationType.War;
}

/** The first armed ship of an empire at war with `rec`'s empire within `range` of `h` (null: none). */
function enemyNear(galaxy: Galaxy, rec: HoldoutRec, h: Habitat, range: number): { ship: BuiltObject; empire: Empire } | null {
    for (const e of galaxy.empires) {
        if (e === null || e === rec.empire || !e.active || e === galaxy.independentEmpire || !atWarWith(rec.empire, e)) continue;
        for (const b of e.builtObjects) {
            if (b.hasBeenDestroyed || b.role !== BuiltObjectRole.Military) continue;
            if (galaxy.calculateDistance(b.xpos, b.ypos, h.xpos, h.ypos) <= range) return { ship: b, empire: e };
        }
    }
    return null;
}

/** Evacuation freighters lift off `c` (the stock freighters of the holdout, bound for its core) and the arriving human is told. */
export function evacuate(galaxy: Galaxy, st: HoldoutsState, rec: HoldoutRec, c: HoldoutColony, enemy: Empire): number {
    c.fled = true;
    const design = factionDesign(galaxy, rec.empire, BuiltObjectSubRole.SmallFreighter) ?? factionDesign(galaxy, rec.empire, BuiltObjectSubRole.MediumFreighter);
    let sent = 0;
    if (design !== null) {
        const until = galaxyStarDate(galaxy) + EVAC_DAYS * GAME_DAY_LENGTH;
        for (let i = 0; i < EVAC_FREIGHTERS; i++) {
            const bo = placeObject(galaxy, rec.empire, design, c.habitat, null, true);
            assignMission(galaxy, bo, BuiltObjectMissionType.Move, rec.core, null, BuiltObjectMissionPriority.Normal, { manuallyAssigned: true });
            st.evacuees.push({ ship: bo, until });
            sent++;
        }
    }
    if (human(galaxy, enemy)) scenarioMessage(galaxy, enemy, T(`${HOLDOUT_TAG} Rigged Title`, c.habitat.name), T(`${HOLDOUT_TAG} Rigged Body`, c.habitat.name, rec.empire.name, systemName(galaxy, c.habitat)), { type: EmpireMessageType.GeneralBadEvent, subject: c.habitat, popupMode: 'force' });
    return sent;
}

function warnArrivals(galaxy: Galaxy, st: HoldoutsState): void {
    const range = galaxy.sectorSize * WARN_SECTORS;
    for (const rec of st.holdouts) {
        if (!rec.empire.active) continue;
        for (const c of rec.colonies) {
            if (!c.rigged || c.fled || colonyGone(rec, c)) continue;
            const near = enemyNear(galaxy, rec, c.habitat, range);
            if (near !== null) evacuate(galaxy, st, rec, c, near.empire);
        }
    }
}

function clearEvacuees(galaxy: Galaxy, st: HoldoutsState, now: number): void {
    st.evacuees = st.evacuees.filter((v) => {
        if (v.ship.hasBeenDestroyed) return false;
        if (v.until > now) return true;
        builtObjectCompleteTeardown(galaxy, v.ship);
        return false;
    });
}

// ---------------------------------------------------------------------------------------------------------------
// Daily handler
// ---------------------------------------------------------------------------------------------------------------

export function holdoutsDaily(galaxy: Galaxy): void {
    const st = peekHoldouts(galaxy);
    if (st === null || st.holdouts.length === 0) return;
    const now = galaxyStarDate(galaxy);
    blowDue(galaxy, st, now);
    warnArrivals(galaxy, st);
    clearEvacuees(galaxy, st, now);
    for (const rec of st.holdouts) {
        if (rec.coreFate === 'held' && (rec.core.hasBeenDestroyed || (rec.core.empire !== rec.empire && rec.core.empire !== null))) {
            rec.coreFate = rec.core.hasBeenDestroyed ? 'destroyed' : 'taken';
        }
        reviewShield(galaxy, rec, null);
        if (rec.empire.active) {
            rebuildFleet(galaxy, rec, now);
            patrolFleet(galaxy, rec);
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Knowledge page rows (ui/knowledgeView.ts)
// ---------------------------------------------------------------------------------------------------------------

/** One row of the Knowledge page. */
export interface HoldoutRow {
    key: string;
    what: string;
    where: string;
    status: string;
    goTo: Habitat;
}

/** The holdouts' worlds `viewer` has explored the system of: the cores with the shield's state, then their colonies. Pure, read-only. */
export function holdoutKnowledgeRows(galaxy: Galaxy, viewer: Empire): HoldoutRow[] {
    const st = peekHoldouts(galaxy);
    if (st === null) return [];
    const rows: HoldoutRow[] = [];
    for (const rec of st.holdouts) {
        const seen = (h: Habitat): boolean => viewer.visibility.checkSystemExplored(h.systemIndex);
        if (seen(rec.core)) {
            const status =
                rec.coreFate === 'destroyed'
                    ? T(`${HOLDOUT_TAG} Row Core Destroyed`)
                    : rec.coreFate === 'taken'
                      ? T(`${HOLDOUT_TAG} Row Core Taken`, rec.core.empire?.name ?? '')
                      : coreShielded(rec)
                        ? T(`${HOLDOUT_TAG} Row Core Shielded`, coloniesLeft(rec))
                        : T(`${HOLDOUT_TAG} Row Core Open`);
            const alive = fleetAlive(rec).length;
            const fleet = rec.coreFate === 'held' ? '; ' + (alive === 0 ? T(`${HOLDOUT_TAG} Row Fleet None`) : T(`${HOLDOUT_TAG} Row Fleet`, Math.max(5, Math.round(alive / 5) * 5))) : '';
            rows.push({ key: `holdout:${rec.id}:core`, what: T(`${HOLDOUT_TAG} Row Core`, rec.core.name, rec.empire.name), where: systemName(galaxy, rec.core), status: status + fleet, goTo: rec.core });
        }
        for (const [i, c] of rec.colonies.entries()) {
            if (!seen(c.habitat)) continue;
            const status = c.fate === 'blown' || c.habitat.hasBeenDestroyed ? T(`${HOLDOUT_TAG} Row Colony Blown`) : colonyGone(rec, c) ? T(`${HOLDOUT_TAG} Row Colony Taken`) : c.fled ? T(`${HOLDOUT_TAG} Row Colony Fled`) : T(`${HOLDOUT_TAG} Row Colony Held`);
            rows.push({ key: `holdout:${rec.id}:c${i}`, what: T(`${HOLDOUT_TAG} Row Colony`, c.habitat.name), where: systemName(galaxy, c.habitat), status, goTo: c.habitat });
        }
    }
    return rows;
}

// ---------------------------------------------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------------------------------------------

/** A holdout never invades; nobody sends troops at a shielded core (AI fleets skip it). */
function targetOk(galaxy: Galaxy, value: boolean, empire: Empire, target: Habitat): boolean {
    if (!value) return false;
    const st = peekHoldouts(galaxy);
    if (st === null) return true;
    if (st.holdouts.some((h) => h.empire === empire)) return false;
    const rec = st.holdouts.find((h) => h.core === target);
    if (rec !== undefined && coreShielded(rec)) return false;
    return true;
}

/** AI sanity: an AI fleet goes for a holdout's world only when it is clearly stronger (holdoutAiRatioPct) than the holdout's whole home fleet and defence bases (the stock test sees just the ships in the system). */
function fleetStrongEnough(galaxy: Galaxy, fleet: ShipGroup, target: Habitat): boolean {
    const rec = holdoutOf(galaxy, target.empire);
    if (rec === null) return true;
    const need = defenceStrength(rec) * (holdoutParam(galaxy, 'holdoutAiRatioPct') / 100);
    return need <= 0 || shipGroupTotalOverallStrengthFactor(galaxy, fleet) >= need;
}

export function registerAge2Holdouts(): void {
    registerMemoryContributor({ id: 'age2.holdouts', capture: () => undefined, restore: (g, _data: unknown) => restoreHoldouts(g) });
    registerScenarioQuery({ id: 'age2.holdouts.shield', flag: HARVEST_CYCLE_FLAG, query: 'invasionBlocked', run: (g, v, a) => v || onInvasionBlocked(g, a.habitat, a.invader) });
    registerScenarioQuery({ id: 'age2.holdouts.targets', flag: HARVEST_CYCLE_FLAG, query: 'invasionTargetOrbitOk', run: (g, v, a) => targetOk(g, v, a.empire, a.target) && (!v || fleetStrongEnough(g, a.fleet, a.target)) });
    registerScenarioQuery({ id: 'age2.holdouts.victory', flag: HARVEST_CYCLE_FLAG, query: 'victoryExcluded', run: (g, v, a) => v || isHoldout(g, a.empire) });
    registerCouncilExtension({ id: 'age2.holdouts', excluded: (g, e) => isHoldout(g, e) }); // not Diet members: no seat, vote or dues (the Ancient Guardians' rule)
    registerScenarioEvent({ id: 'age2.holdouts.owner', flag: HARVEST_CYCLE_FLAG, event: 'colonyOwnerChanged', run: (g, e) => onColonyOwnerChanged(g, e.colony, e.from, e.to) });
    registerScenarioFramePeriodic({ id: 'age2.holdouts.daily', flag: HARVEST_CYCLE_FLAG, order: 27, periodDays: 1, run: (g) => holdoutsDaily(g) });
}

