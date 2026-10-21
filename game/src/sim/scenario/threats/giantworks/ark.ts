// Giantworks wonder: The Ark Engine, the independents' walking ark (flag gwArk). Not a port; composed of ported functions.
// Registered from scenario/packages.ts through registerGreatWork; every handler is gated by the Giantworks flag, so with the
// add-on off nothing here runs, draws or is saved.
//
//   The Ark   - when the Great Work is finished the scaffold becomes a colossal machine-world SHIP of the Founders' Compact (one
//               BuiltObject: a capital-ship template plated up to about gwArkShields shields and gwArkArmourPct armour, extra
//               guns, its engines cut to gwArkSpeedPct of the template's speed), planet-sized to the eye (ARK_VISUAL_SCALE) and slow.
//               The Great Work's base is the Ark from then on, so the framework's destroy / seize rules apply to it.
//   Roaming   - it goes from empire to empire (never the same empire twice running). At each empire it picks ONE colony that
//               used to be independent (the record taken at game start, below) and parks gwArkParkSectors from it.
//   Siphon    - the colony's owner is asked what to do (a decision pop-up; an AI empire answers by personality and strength):
//               Accommodate (the Compact's favour and a free-trade treaty) or Refuse (it siphons anyway; the owner may attack).
//               Every gwArkLaunchDays a FREE Compact passenger ship launches from the colony carrying a slice (gwArkSlicePct of
//               the species' people at the start, within gwArkSliceMinM..gwArkSliceMaxM million) of one of the colony's ORIGINAL
//               independent species. The people leave the colony at the launch and join the Ark when the ship ARRIVES; a ship
//               shot down on the way loses them (and costs its killer standing). When every original species has fallen below
//               gwArkGonePct of its start (or gwArkMinSpeciesM million), or after gwArkMaxSiphonDays, it moves on and does not come back for that species (a colony remnant regrows fast).
//   Aboard    - the Ark keeps every person it gathered, per species, and they KEEP GROWING (the race's own yearly growth surplus x
//               gwArkGrowthPct % (20: a good colony's 2 to 6 % a year); no population cap).
//   Fight     - anyone who attacks the Ark stops the siphoning and puts it in FIGHT mode: it holds, and its weapons answer the
//               attackers (attackWithoutWar). gwArkFightQuietDays without an attack ends it, and the siphoning resumes.
//   Escape    - when its shields break (down to 2 %) it limps away to an EMPTY system about gwArkEscapeSectors sectors away and
//               stays there while its shields refill over gwArkRechargeDays (shields.ts: the stock recharge cannot beat the
//               schedule), then goes roaming again. It flees only once per break: found at its escape system it fights back
//               there. The record keeps `breached` (shields broken, not yet whole) and the escape: capture.ts lets troops land
//               on it at its escape system while the shields are down (the Great Work capture).
//   Lost      - destroyed: its people die, the killer loses standing with everybody, the news says so (and the framework's war
//               crime for destroying a Great Work applies unless the Diet authorised it).
//
// Art hooks for the later art agent: ARK_ART_KEY ('ark'), ARK_VISUAL_SCALE / ARK_REF_SIZE (minimumSizeScale), arkLooks(galaxy),
// the Ark's design name ("Giantworks Ark Design"), and the state bag galaxy.scenario.state.giantworksArk (ARK_KEY).
//
// Rnd: the choice of the next empire draws the add-on's own Random (state.ts ownRandom, a fixed salt per visit); the stock
// functions called (spawnShip, placeObject, generateNewBuiltObject names, the free-trade treaty) draw galaxy.rnd inside this
// module's gated handlers only.

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { Habitat } from '../../../types';
import type { Design } from '../../../design';
import type { Race } from '../../../data/races';
import type { BuiltObject } from '../../../builtObject';
import { HabitatCategoryType, HabitatType } from '../../../types';
import { BuiltObjectSubRole } from '../../../builtObjectTypes';
import { reviewCaptainBonuses } from '../../../characters';
import { ComponentType } from '../../../data/components';
import { generateDesignFromSpec } from '../../../designGeneration';
import { galaxyDesignSpecificationBySubRole } from '../../../gameStartTail';
import { builtObjectCompleteTeardown } from '../../../combat/teardown';
import { calculateOverallStrengthFactor } from '../../../combat/threats';
import { militaryPotency } from '../../../diplomacyTick';
import { changeDiplomaticRelation } from '../../../diplomacyTick';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../../../diplomacy';
import { assignMission } from '../../../missions/assign';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../../../missions/mission';
import { EmpireMessageType } from '../../../messages';
import { isHumanEmpire } from '../../../humanEmpires';
import { galaxyStarDate } from '../../../tick/simTime';
import { YEAR_LENGTH } from '../../../galaxyTime';
import { raceReproductiveRate } from '../../../racePeriodic';
import { recalculateEmpirePopulation } from '../../../taxes';
import { GAME_DAY_LENGTH, registerScenarioEvent, registerScenarioFramePeriodic, registerScenarioGameStart, registerScenarioQuery, type HomePlacementHelpers } from '../../hooks';
import { registerScenarioDecision, raiseScenarioDecision, type ScenarioDecision } from '../../decisions';
import { scenarioMessage, scenarioNews, scenarioText } from '../../messages';
import { scenarioFlag, scenarioParam, scenarioState } from '../../state';
import { applyReputation } from '../../reputation/ledger';
import { SMARTER_AI_FLAG, isSmarterAIStrategist } from '../../smarterAI/common';
import { peekThreatState } from '../framework';
import { maxDesignTechLevel, raiseFactionTech } from '../robotMutiny';
import { demolitionAuthorised, isActor } from './actions';
import { WAR_CRIMES_FLAG } from '../../charactersVictory/diet/warCrimes';
import { personality, sendStrike } from './ai';
import { spawnShip } from './beaconFleet';
import { topTechLevel } from './casino';
import { compactFaction, greatWorks, kindName, registerGreatWork, type GreatWorkRecord } from './framework';
import { factionDesign, placeObject } from './lifecycle';
import { breakShields, plateDesignTo, shieldBreakOf, shieldsDown } from './shields';
import { systemsWithBases } from './founders';
import { GW_FLAG, TAG, isCompact, logGw, ordinaryEmpires, ownRandom } from './state';
import type { GreatWorkSite } from './types';

export const ARK_ID = 'ark';
export const ARK_KEY = 'giantworksArk';
export const ARK_FLAG = 'gwArk';
export const ARK_DECISION_KIND = 'giantworks.ark';

/** The art key of the Ark (the render side looks the Ark up through arkLooks / the state bag and draws its own frame). */
export const ARK_ART_KEY = 'ark';
/** The Ark is drawn at least as large as a ARK_REF_SIZE hull drawn ARK_VISUAL_SCALE x (render.threatArt.minimumSizeScale): planet-sized. */
export const ARK_VISUAL_SCALE = 7;
export const ARK_REF_SIZE = 4000;

// ---------------------------------------------------------------------------------------------------------------
// Parameters (scenarios/giantworks/scenario.json; the defaults here are the same values)
// ---------------------------------------------------------------------------------------------------------------

const DEFAULTS = {
    gwArkShields: 30000,
    gwArkArmour: 30000,
    gwArkGuns: 2,
    gwArkSpeedPct: 50,
    gwArkRechargeDays: 360,
    gwArkEscapeSectors: 2,
    gwArkDepartDays: 30,
    gwArkParkSectors: 0.3,
    gwArkLaunchDays: 3,
    gwArkSlicePct: 1,
    gwArkSliceMinM: 10,
    gwArkSliceMaxM: 60,
    gwArkMaxInFlight: 10,
    gwArkMinColonyM: 100,
    gwArkMinSpeciesM: 5,
    gwArkGonePct: 3,
    gwArkMaxSiphonDays: 540,
    gwArkGrowthPct: 20,
    gwArkFightQuietDays: 10,
    gwArkOwnerWaitDays: 30,
    gwArkFavour: 8,
    gwArkTransportRep: 0.5,
    gwArkTransportCompactRep: 2,
    gwArkDestroyRep: 25,
    gwArkAiMarginPct: 300,
    gwArkAiReviewDays: 60,
    gwArkAiAttackAggression: 20,
} as const;

export type ArkParamName = keyof typeof DEFAULTS;

export function arkParam(galaxy: Galaxy, name: ArkParamName): number {
    return scenarioParam(galaxy, name, DEFAULTS[name]);
}

/** The Ark counts as arrived within this distance of its goal (world units). */
const ARRIVE = 30000;
/** Transports deliver within this distance of the Ark. */
const DELIVER = 30000;
/** Visits kept in the record. */
const MAX_VISITS = 80;
/** Days between looks for a colony to visit when there is none. */
const RETRY_DAYS = 30;
/** Days between two growth updates of the people aboard. */
const GROWTH_STEP_DAYS = 5;
/** Days an attack on a transport is remembered for the standing penalty (one penalty per killer in this span). */
const REP_SPAN_DAYS = 10;

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------

/** A colony that was independent, and the species its people were then (race names). */
export interface ArkOrigin {
    habitat: Habitat;
    races: string[];
}

/** The people of one species being taken from the visited colony. */
export interface ArkSpeciesTake {
    race: string;
    /** People at the start of the siphon, and taken so far. */
    start: number;
    taken: number;
}

export type ArkDecision = 'none' | 'pending' | 'accommodate' | 'refuse';

/** The colony being siphoned (or approached). */
export interface ArkTarget {
    empire: Empire;
    colony: Habitat;
    parkX: number;
    parkY: number;
    species: ArkSpeciesTake[];
    /** Star date the Ark arrived (-1: still on its way) and the siphon began (-1: waiting for the owner's answer). */
    arrivedAt: number;
    startedAt: number;
    decision: ArkDecision;
    decisionId: number;
    nextLaunch: number;
    launched: number;
    /** The AI owner's plan: accommodate, ignore (refuse and leave it) or attack. */
    plan: 'accommodate' | 'ignore' | 'attack' | null;
    nextReview: number;
    /** True when every species is gone (or the cap came): waiting for the ships in the air. */
    finishing: boolean;
    finishedAt: number;
}

/** A free passenger ship on its way from a colony to the Ark with its slice of a species. */
export interface ArkTransport {
    ship: BuiltObject;
    from: Habitat;
    race: string;
    amount: number;
    launchedAt: number;
}

export interface ArkVisit {
    empire: string;
    empireId: number;
    colony: string;
    start: number;
    end: number;
    taken: number;
    lost: number;
    why: string;
}

export type ArkPhase = 'idle' | 'roaming' | 'siphoning' | 'escaping' | 'repairing' | 'seized' | 'lost';

export interface ArkRec {
    workId: number;
    phase: ArkPhase;
    ship: BuiltObject | null;
    /** Roaming resumes (or starts) at this star date. */
    waitUntil: number;
    target: ArkTarget | null;
    lastEmpire: Empire | null;
    /** Where the Ark is told to be (a Move order is kept up to date), and whether it was ordered to hold for a fight. */
    goalX: number;
    goalY: number;
    held: boolean;
    /** FIGHT mode: the siphoning is stopped and the Ark fires back at the attackers (attackWithoutWar). */
    fight: boolean;
    attackers: number[];
    lastAttack: number;
    /** The shield level and damaged-component count at the last step (a drop is an attack the events missed). */
    lastShields: number;
    lastDamaged: number;
    fightSince: number;
    fights: number;
    /** The shields broke and are not whole yet (the capture feature's hook), and the escape: the empty system it fled to. */
    breached: boolean;
    escapeStar: Habitat | null;
    escapes: number;
    lastEscape: number;
    /** People aboard by species (race name): what it gathered plus what grew. Not an integer. */
    aboard: Record<string, number>;
    grownAt: number;
    transports: ArkTransport[];
    visits: ArkVisit[];
    stats: { launched: number; landed: number; lost: number; taken: number; grown: number; siphoned: number };
    /** Killer empire id -> star date of the last standing penalty for shooting a transport. */
    repAt: Record<string, number>;
    seizedBy: Empire | null;
    destroyedBy: Empire | null;
    /** The people that died with it. */
    died: number;
    completedAt: number;
}

export interface ArkState {
    /** The colonies that were independent, with their original species. `tracked`: taken at game start (exact); otherwise a guess. */
    origins: ArkOrigin[];
    tracked: boolean;
    arks: ArkRec[];
}

function newState(): ArkState {
    return { origins: [], tracked: false, arks: [] };
}

export function arkState(galaxy: Galaxy): ArkState {
    return scenarioState<ArkState>(galaxy, ARK_KEY, newState);
}

export function peekArkState(galaxy: Galaxy): ArkState | null {
    return peekThreatState<ArkState>(galaxy, ARK_KEY);
}

/** The Ark record of a Great Work (null: none). Pure. */
export function arkRecOf(galaxy: Galaxy, workId: number): ArkRec | null {
    return peekArkState(galaxy)?.arks.find((r) => r.workId === workId) ?? null;
}

/** The live Ark ships (the art reads them). Pure. */
export function arkShips(galaxy: Galaxy): BuiltObject[] {
    const out: BuiltObject[] = [];
    for (const r of peekArkState(galaxy)?.arks ?? []) if (r.ship !== null && !r.ship.hasBeenDestroyed) out.push(r.ship);
    return out;
}

/** What the renderer needs: the Arks, and the wonder's art key / scale constants. Pure. */
export function arkLooks(galaxy: Galaxy): { ships: BuiltObject[]; key: string; scale: number; refSize: number } {
    return { ships: arkShips(galaxy), key: ARK_ART_KEY, scale: ARK_VISUAL_SCALE, refSize: ARK_REF_SIZE };
}

/** The people aboard, all species (rounded down). Pure. */
export function arkPopulation(rec: ArkRec): number {
    let n = 0;
    for (const k of Object.keys(rec.aboard)) n += rec.aboard[k];
    return Math.trunc(n);
}

function workOf(galaxy: Galaxy, rec: ArkRec): GreatWorkRecord | null {
    return greatWorks(galaxy).find((w) => w.id === rec.workId) ?? null;
}

function raceByName(galaxy: Galaxy, name: string): Race | null {
    return (galaxy.races.find((r) => r !== null && r.name === name) as Race | undefined) ?? null;
}

function daysOf(n: number): number {
    return n * GAME_DAY_LENGTH;
}

function M(n: number): number {
    return Math.round(n / 1e5) / 10;
}

// ---------------------------------------------------------------------------------------------------------------
// The record of former independents (game start) and their species
// ---------------------------------------------------------------------------------------------------------------

function raceNames(h: Habitat, skip: string | null): string[] {
    const out: string[] = [];
    for (const p of h.population?.items ?? []) if (p.race != null && p.amount > 0 && p.race.name !== skip && !out.includes(p.race.name)) out.push(p.race.name);
    return out;
}

/**
 * Game start: every colony that is independent now, and the independents an older start's settling gave to an empire (their
 * people other than the settler's own race), with the species they hold. Exact: nothing is guessed.
 */
function recordOrigins(galaxy: Galaxy, ctx: HomePlacementHelpers): void {
    if (!scenarioFlag(galaxy, ARK_FLAG)) return;
    const st = arkState(galaxy);
    if (st.tracked) return;
    st.tracked = true;
    st.origins = [];
    for (const h of galaxy.independentColonies) {
        if (h.hasBeenDestroyed || h.population == null || h.population.totalAmount <= 0) continue;
        st.origins.push({ habitat: h, races: raceNames(h, null) });
    }
    for (const h of ctx.settledIndependents ?? []) {
        const owner = h.empire;
        if (h.hasBeenDestroyed || owner === null || owner === galaxy.independentEmpire || st.origins.some((o) => o.habitat === h)) continue;
        const races = raceNames(h, owner.dominantRace?.name ?? null);
        if (races.length > 0) st.origins.push({ habitat: h, races });
    }
}

/** A Game Editor spawn in a game without the record: the independents now, and the colonies holding a people no empire has. */
function guessOrigins(galaxy: Galaxy): void {
    const st = arkState(galaxy);
    if (st.tracked || st.origins.length > 0) return;
    const empireRaces = new Set<string>();
    for (const e of galaxy.empires) if (e !== null && e !== galaxy.independentEmpire && e.dominantRace != null) empireRaces.add(e.dominantRace.name);
    for (const h of galaxy.independentColonies) {
        if (!h.hasBeenDestroyed && h.population != null && h.population.totalAmount > 0) st.origins.push({ habitat: h, races: raceNames(h, null) });
    }
    for (const e of ordinaryEmpires(galaxy)) {
        for (const h of e.colonies) {
            if (h.hasBeenDestroyed || h.empire !== e || h.population == null || st.origins.some((o) => o.habitat === h)) continue;
            const races = raceNames(h, null).filter((n) => !empireRaces.has(n));
            if (races.length > 0) st.origins.push({ habitat: h, races });
        }
    }
}

/** The original species of `h` still in it, and how many (people of the owner's own race are never taken). Pure. */
export function siphonable(galaxy: Galaxy, h: Habitat): { race: string; amount: number }[] {
    const st = peekArkState(galaxy);
    const o = st?.origins.find((x) => x.habitat === h);
    const owner = h.empire;
    if (o === undefined || owner === null || owner === galaxy.independentEmpire || h.hasBeenDestroyed || h.population == null) return [];
    const own = owner.dominantRace?.name ?? null;
    const out: { race: string; amount: number }[] = [];
    for (const p of h.population.items) {
        if (p.race != null && p.race.name !== own && p.amount > 0 && o.races.includes(p.race.name)) out.push({ race: p.race.name, amount: p.amount });
    }
    return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The Ark's design
// ---------------------------------------------------------------------------------------------------------------

const WEAPONS: ReadonlySet<ComponentType> = new Set([ComponentType.WeaponBeam, ComponentType.WeaponTorpedo, ComponentType.WeaponMissile, ComponentType.WeaponIonCannon, ComponentType.WeaponSuperBeam]);

/** Copies of the design's own weapons, `extra` times their number. */
function boostWeapons(d: Design, extra: number): void {
    const guns = d.components.filter((c) => WEAPONS.has(c.type));
    if (guns.length === 0 || extra <= 0) return;
    const n = Math.round(guns.length * extra);
    for (let i = 0; i < n; i++) d.components.push(guns[i % guns.length]);
    if (n > 0) d.reDefine();
}

/** The Ark's design: the capital-ship template at the best tech level, plated, armed and slowed (see the file comment). */
function arkDesign(galaxy: Galaxy, faction: Empire): Design | null {
    const spec = faction.designSpecifications.find((s) => s !== null && s.subRole === BuiltObjectSubRole.CapitalShip) ?? galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.CapitalShip);
    if (spec === null || spec === undefined) return null;
    const lvl = Math.max(1, Math.min(topTechLevel(galaxy), maxDesignTechLevel(galaxy) > 0 ? maxDesignTechLevel(galaxy) : 99));
    raiseFactionTech(galaxy, faction, lvl);
    try {
        const d = generateDesignFromSpec(galaxy, faction, spec, lvl, galaxyStarDate(galaxy));
        if (d === null) return null;
        // The ship's armour is a short (BuiltObject.armor): it must stay under 32767 or it wraps negative.
        plateDesignTo(d, ComponentType.Armor, Math.min(32000, arkParam(galaxy, 'gwArkArmour')), (x) => x.armor);
        plateDesignTo(d, ComponentType.Shields, arkParam(galaxy, 'gwArkShields'), (x) => x.shieldsCapacity);
        boostWeapons(d, arkParam(galaxy, 'gwArkGuns'));
        d.name = scenarioText(`${TAG} Ark Design`);
        d.isObsolete = true; // never an AI build
        faction.designs.push(d);
        return d;
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Wonder hooks
// ---------------------------------------------------------------------------------------------------------------

function newRec(workId: number, now: number): ArkRec {
    return {
        workId,
        phase: 'idle',
        ship: null,
        waitUntil: now,
        target: null,
        lastEmpire: null,
        goalX: 0,
        goalY: 0,
        held: false,
        fight: false,
        attackers: [],
        lastAttack: -1,
        lastShields: -1,
        lastDamaged: 0,
        fightSince: -1,
        fights: 0,
        breached: false,
        escapeStar: null,
        escapes: 0,
        lastEscape: -1,
        aboard: {},
        grownAt: now,
        transports: [],
        visits: [],
        stats: { launched: 0, landed: 0, lost: 0, taken: 0, grown: 0, siphoned: 0 },
        repAt: {},
        seizedBy: null,
        destroyedBy: null,
        died: 0,
        completedAt: now,
    };
}

function onRolled(galaxy: Galaxy, site: GreatWorkSite): void {
    void site;
    guessOrigins(galaxy);
}

/** The wonder activates: the scaffold becomes the Ark and, after gwArkDepartDays, it departs. */
function onComplete(galaxy: Galaxy, site: GreatWorkSite): void {
    const w = site as GreatWorkRecord;
    const st = arkState(galaxy);
    guessOrigins(galaxy);
    if (st.arks.some((r) => r.workId === w.id)) return;
    const now = galaxyStarDate(galaxy);
    const rec = newRec(w.id, now);
    st.arks.push(rec);
    const compact = compactFaction(galaxy);
    const old = w.base;
    const design = compact !== null ? arkDesign(galaxy, compact) : null;
    if (compact === null || design === null || old === null || old.hasBeenDestroyed) {
        rec.phase = 'lost';
        logGw(galaxy, now, `ark ${w.id}: no Ark could be built (${compact === null ? 'no Compact' : design === null ? 'no design' : 'no base'})`);
        return;
    }
    const ark = spawnShip(galaxy, compact, design, old.xpos, old.ypos);
    ark.name = scenarioText(`${TAG} Ark Name`);
    ark.isAutoControlled = false;
    rec.ship = ark;
    reviewCaptainBonuses(ark); // the speed governor below reads the record
    rec.goalX = ark.xpos;
    rec.goalY = ark.ypos;
    rec.waitUntil = now + daysOf(arkParam(galaxy, 'gwArkDepartDays'));
    w.base = ark; // the Great Work is the Ark from now on (destroy / seize rules, Intelligence rows)
    for (const g of w.guards) if (!g.hasBeenDestroyed) builtObjectCompleteTeardown(galaxy, g);
    w.guards = [];
    builtObjectCompleteTeardown(galaxy, old);
    logGw(galaxy, now, `ark ${w.id} built: size ${ark.size}, shields ${Math.round(ark.shieldsCapacity)}, armour ${Math.round(ark.armor)}, firepower ${Math.round(ark.firepowerRaw)}, warp ${ark.warpSpeed}; ${st.origins.length} former independents on record${st.tracked ? '' : ' (guessed)'}`);
}

/** The Great Work was destroyed (the framework's step, after the Ark died): the record is closed. */
function onDestroyed(galaxy: Galaxy, site: GreatWorkSite, by: Empire | null): void {
    const rec = arkRecOf(galaxy, site.id);
    if (rec === null) return;
    closeAsLost(galaxy, rec, by);
}

// ---------------------------------------------------------------------------------------------------------------
// Moving
// ---------------------------------------------------------------------------------------------------------------

function idle(bo: BuiltObject): boolean {
    const m = builtObjectMission(bo.mission);
    return m === null || m.type === BuiltObjectMissionType.Undefined || m.type === BuiltObjectMissionType.Hold;
}

/** Orders the Ark to (x, y) (nothing changes when it is already going there). */
function sendTo(galaxy: Galaxy, bo: BuiltObject, x: number, y: number): void {
    const m = builtObjectMission(bo.mission);
    if (m !== null && m.type === BuiltObjectMissionType.Move && m.targetHabitat === null && m.targetBuiltObject === null && Math.abs(m.x - x) < 1 && Math.abs(m.y - y) < 1) return;
    bo.isAutoControlled = false;
    assignMission(galaxy, bo, BuiltObjectMissionType.Move, null, null, BuiltObjectMissionPriority.High, { x, y, manuallyAssigned: true });
}

function distanceTo(galaxy: Galaxy, bo: BuiltObject, x: number, y: number): number {
    return galaxy.calculateDistance(bo.xpos, bo.ypos, x, y);
}

// ---------------------------------------------------------------------------------------------------------------
// People aboard
// ---------------------------------------------------------------------------------------------------------------

/** The people aboard grow at gwArkGrowthPct % of their race's yearly growth surplus (a good colony's rate), with no cap. */
function growAboard(galaxy: Galaxy, rec: ArkRec, now: number): void {
    const dt = (now - rec.grownAt) / YEAR_LENGTH;
    if (dt <= 0) return;
    rec.grownAt = now;
    const k = arkParam(galaxy, 'gwArkGrowthPct') / 100;
    for (const name of Object.keys(rec.aboard)) {
        const race = raceByName(galaxy, name);
        const rate = race === null ? 1.02 : raceReproductiveRate(galaxy, race);
        const add = rec.aboard[name] * Math.max(0, rate - 1) * dt * k;
        rec.aboard[name] += add;
        rec.stats.grown += add;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Choosing the next colony
// ---------------------------------------------------------------------------------------------------------------

function planTarget(galaxy: Galaxy, rec: ArkRec, ark: BuiltObject): ArkTarget | null {
    const minColony = arkParam(galaxy, 'gwArkMinColonyM') * 1e6;
    const options: { empire: Empire; colony: Habitat; d: number }[] = [];
    for (const e of ordinaryEmpires(galaxy)) {
        if (e === rec.lastEmpire) continue;
        let best: { colony: Habitat; score: number } | null = null;
        for (const h of e.colonies) {
            if (h === null || h.empire !== e) continue;
            const sp = siphonable(galaxy, h);
            if (sp.length === 0) continue;
            const amount = sp.reduce((a, s) => a + s.amount, 0);
            if (amount < minColony) continue;
            // The juiciest colony that is not too far: its people over (1 + its distance in sectors / 3).
            const score = amount / (1 + galaxy.calculateDistance(ark.xpos, ark.ypos, h.xpos, h.ypos) / galaxy.sectorSize / 3);
            if (best === null || score > best.score || (score === best.score && h.habitatIndex < best.colony.habitatIndex)) best = { colony: h, score };
        }
        if (best !== null) options.push({ empire: e, colony: best.colony, d: galaxy.calculateDistance(ark.xpos, ark.ypos, best.colony.xpos, best.colony.ypos) });
    }
    if (options.length === 0) return null;
    options.sort((a, b) => a.d - b.d || a.empire.empireId - b.empire.empireId);
    const rnd = ownRandom(galaxy, 9700 + rec.workId * 977 + rec.visits.length);
    const pick = options[Math.min(options.length - 1, Math.floor(rnd.nextDouble() * Math.min(3, options.length)))];
    const h = pick.colony;
    // The parking spot: arkParkSectors from the colony, on the side the Ark comes from.
    let dx = ark.xpos - h.xpos;
    let dy = ark.ypos - h.ypos;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) {
        dx = 1;
        dy = 0;
    } else {
        dx /= len;
        dy /= len;
    }
    const park = arkParam(galaxy, 'gwArkParkSectors') * galaxy.sectorSize;
    return {
        empire: pick.empire,
        colony: h,
        parkX: Math.min(galaxy.sizeX - 1000, Math.max(1000, h.xpos + dx * park)),
        parkY: Math.min(galaxy.sizeY - 1000, Math.max(1000, h.ypos + dy * park)),
        species: siphonable(galaxy, h).map((s) => ({ race: s.race, start: s.amount, taken: 0 })),
        arrivedAt: -1,
        startedAt: -1,
        decision: 'none',
        decisionId: -1,
        nextLaunch: 0,
        launched: 0,
        plan: null,
        nextReview: 0,
        finishing: false,
        finishedAt: -1,
    };
}

function beginRoaming(galaxy: Galaxy, rec: ArkRec, ark: BuiltObject, now: number): void {
    const t = planTarget(galaxy, rec, ark);
    if (t === null) {
        rec.phase = 'idle';
        rec.target = null;
        rec.waitUntil = now + daysOf(RETRY_DAYS);
        return;
    }
    rec.target = t;
    rec.phase = 'roaming';
    rec.goalX = t.parkX;
    rec.goalY = t.parkY;
    rec.held = false;
    sendTo(galaxy, ark, t.parkX, t.parkY);
    logGw(galaxy, now, `ark ${rec.workId}: bound for ${t.colony.name} (${t.empire.name}), ${t.species.map((s) => `${s.race} ${M(s.start)}M`).join(', ')}`);
}

function endVisit(galaxy: Galaxy, rec: ArkRec, why: string, now: number): void {
    const t = rec.target;
    if (t === null) return;
    const taken = t.species.reduce((a, s) => a + s.taken, 0);
    rec.visits.push({ empire: t.empire.name, empireId: t.empire.empireId, colony: t.colony.name, start: t.arrivedAt, end: now, taken, lost: 0, why });
    if (rec.visits.length > MAX_VISITS) rec.visits.splice(0, rec.visits.length - MAX_VISITS);
    if (t.startedAt >= 0) rec.stats.siphoned++;
    rec.lastEmpire = t.empire;
    const owner = t.colony.empire;
    if (t.startedAt >= 0 && owner !== null && isHumanEmpire(galaxy, owner)) {
        scenarioMessage(galaxy, owner, scenarioText(`${TAG} Ark Left Title`), scenarioText(`${TAG} Ark Left`, t.colony.name, M(taken)), { type: EmpireMessageType.GeneralNeutralEvent, subject: t.colony, popup: false });
    }
    logGw(galaxy, now, `ark ${rec.workId}: leaves ${t.colony.name} (${why}); took ${M(taken)}M, aboard ${M(arkPopulation(rec))}M`);
    // A species it has had its fill of is struck off the record: a colony's remnant regrows fast, and the Ark does not come back for it.
    if (t.startedAt >= 0 && why !== 'shields broken') {
        const o = peekArkState(galaxy)?.origins.find((x) => x.habitat === t.colony);
        if (o !== undefined) o.races = o.races.filter((n) => !t.species.some((s) => s.race === n));
    }
    rec.target = null;
}

// ---------------------------------------------------------------------------------------------------------------
// The owner's answer
// ---------------------------------------------------------------------------------------------------------------

function compactFavour(galaxy: Galaxy, e: Empire, value: number, cause: string): void {
    const c = compactFaction(galaxy);
    if (c === null) return;
    applyReputation(galaxy, c, e, value, { cause, labelKey: `Reputation Cause ${cause}`, source: 'giantworks', decayPerYear: 0.5 });
}

/** The AI's reading of the Ark: accommodate, ignore it (refuse, leave it) or attack it, by personality and strength. Pure. */
export function arkAiChoice(galaxy: Galaxy, rec: ArkRec, e: Empire): 'accommodate' | 'ignore' | 'attack' {
    const ark = rec.ship;
    if (ark === null || ark.hasBeenDestroyed) return 'accommodate';
    const pr = personality(e);
    const need = (calculateOverallStrengthFactor(ark) * arkParam(galaxy, 'gwArkAiMarginPct')) / 100;
    const strong = militaryPotency(e) >= need;
    // Destroying a Great Work is a war crime unless the Diet authorised it: a cautious empire does not risk the tribunal.
    const crime = scenarioFlag(galaxy, WAR_CRIMES_FLAG) && !demolitionAuthorised(galaxy);
    if (strong && pr.aggression >= arkParam(galaxy, 'gwArkAiAttackAggression') / 100 && !(crime && pr.caution > 0.4)) return 'attack';
    if (pr.aggression >= -0.2 && pr.friendly < 0) return 'ignore';
    return 'accommodate';
}

function raiseOwnerDecision(galaxy: Galaxy, rec: ArkRec, t: ArkTarget): void {
    const owner = t.colony.empire;
    if (owner === null) {
        t.decision = 'refuse';
        return;
    }
    t.decision = 'pending';
    const species = t.species.map((s) => s.race).join(', ');
    const d = raiseScenarioDecision(galaxy, owner, {
        kind: ARK_DECISION_KIND,
        title: scenarioText(`${TAG} Ark Decision Title`),
        text: scenarioText(`${TAG} Ark Decision`, t.colony.name, species, M(t.species.reduce((a, s) => a + s.start, 0))),
        options: [
            { id: 'accommodate', label: scenarioText(`${TAG} Ark Option Accommodate`) },
            { id: 'refuse', label: scenarioText(`${TAG} Ark Option Refuse`) },
        ],
        defaultOption: 'accommodate',
        expiresDays: arkParam(galaxy, 'gwArkOwnerWaitDays'),
        context: { workId: rec.workId },
    });
    if (t.decision === 'pending') t.decisionId = d.id; // an AI empire has answered already (resolve ran inside raise)
}

/** Free-trade treaty between the Compact and `e` when they have none (a stock treaty; the Compact is introduced to every empire). */
function tradeDeal(galaxy: Galaxy, e: Empire): boolean {
    const c = compactFaction(galaxy);
    if (c === null) return false;
    const r = obtainDiplomaticRelation(c, e);
    if (r.type !== DiplomaticRelationType.None) return false;
    return changeDiplomaticRelation(galaxy, c, r, DiplomaticRelationType.FreeTradeAgreement);
}

function resolveDecision(galaxy: Galaxy, d: ScenarioDecision, optionId: string): void {
    const workId = typeof d.context.workId === 'number' ? d.context.workId : -1;
    const rec = arkRecOf(galaxy, workId);
    const t = rec?.target ?? null;
    if (rec === null || t === null || t.empire !== d.empire) return;
    const now = galaxyStarDate(galaxy);
    const owner = d.empire;
    if (optionId === 'accommodate') {
        t.decision = 'accommodate';
        compactFavour(galaxy, owner, arkParam(galaxy, 'gwArkFavour'), 'giantworks.ark');
        const deal = tradeDeal(galaxy, owner);
        if (isHumanEmpire(galaxy, owner)) {
            scenarioMessage(galaxy, owner, scenarioText(`${TAG} Ark Accommodated Title`), scenarioText(`${TAG} Ark Accommodated`, t.colony.name, deal ? scenarioText(`${TAG} Ark Trade Deal`) : ''), { type: EmpireMessageType.GeneralGoodEvent, subject: t.colony, popup: false });
        }
    } else {
        t.decision = 'refuse';
        if (isHumanEmpire(galaxy, owner)) {
            scenarioMessage(galaxy, owner, scenarioText(`${TAG} Ark Refused Title`), scenarioText(`${TAG} Ark Refused`, t.colony.name), { type: EmpireMessageType.GeneralWarning, subject: t.colony, popup: false });
        }
    }
    t.startedAt = now;
    t.nextLaunch = now;
    logGw(galaxy, now, `ark ${rec.workId}: ${owner.name} ${optionId}s at ${t.colony.name} (${d.answeredBy ?? '-'})`);
}

function aiChoose(galaxy: Galaxy, d: ScenarioDecision): string {
    const workId = typeof d.context.workId === 'number' ? d.context.workId : -1;
    const rec = arkRecOf(galaxy, workId);
    if (rec === null) return d.defaultOption;
    const plan = arkAiChoice(galaxy, rec, d.empire);
    if (rec.target !== null) rec.target.plan = plan;
    return plan === 'accommodate' ? 'accommodate' : 'refuse';
}

/** The popup's recommendation: aiChoose without its side effect (it stores the plan on the target). Pure. */
function recommendArk(galaxy: Galaxy, d: ScenarioDecision): string {
    const workId = typeof d.context.workId === 'number' ? d.context.workId : -1;
    const rec = arkRecOf(galaxy, workId);
    if (rec === null) return d.defaultOption;
    return arkAiChoice(galaxy, rec, d.empire) === 'accommodate' ? 'accommodate' : 'refuse';
}

// ---------------------------------------------------------------------------------------------------------------
// The siphon
// ---------------------------------------------------------------------------------------------------------------

/** Takes `amount` people of `race` out of the colony (the species stays at least at the stock minimum so the colony is never emptied). */
function takePeople(h: Habitat, race: string, amount: number): number {
    const pop = h.population;
    if (pop == null) return 0;
    const item = pop.items.find((p) => p.race != null && p.race.name === race);
    if (item === undefined) return 0;
    const floor = 1_000_000;
    const take = Math.max(0, Math.min(amount, item.amount - floor));
    if (take <= 0) return 0;
    item.amount -= take;
    pop.recalculateTotalAmount();
    if (h.empire !== null) recalculateEmpirePopulation(h.empire);
    return take;
}

function remaining(h: Habitat, race: string): number {
    const item = h.population?.items.find((p) => p.race != null && p.race.name === race);
    return item === undefined ? 0 : item.amount;
}

function gone(galaxy: Galaxy, s: ArkSpeciesTake, h: Habitat): boolean {
    const left = remaining(h, s.race);
    return left <= arkParam(galaxy, 'gwArkMinSpeciesM') * 1e6 + 1_000_000 || left <= (s.start * arkParam(galaxy, 'gwArkGonePct')) / 100;
}

function launchOne(galaxy: Galaxy, rec: ArkRec, t: ArkTarget, ark: BuiltObject, compact: Empire, now: number): boolean {
    // The species with the most people left.
    let pick: ArkSpeciesTake | null = null;
    let most = 0;
    for (const s of t.species) {
        if (gone(galaxy, s, t.colony)) continue;
        const left = remaining(t.colony, s.race);
        if (left > most) {
            most = left;
            pick = s;
        }
    }
    if (pick === null) return false;
    const design = factionDesign(galaxy, compact, BuiltObjectSubRole.PassengerShip);
    if (design === null) return false;
    const slice = Math.min(arkParam(galaxy, 'gwArkSliceMaxM') * 1e6, Math.max(arkParam(galaxy, 'gwArkSliceMinM') * 1e6, (pick.start * arkParam(galaxy, 'gwArkSlicePct')) / 100));
    const taken = takePeople(t.colony, pick.race, slice);
    if (taken <= 0) return false;
    pick.taken += taken;
    const ship = placeObject(galaxy, compact, design, t.colony, null, true);
    ship.isAutoControlled = false;
    rec.transports.push({ ship, from: t.colony, race: pick.race, amount: taken, launchedAt: now });
    rec.stats.launched++;
    t.launched++;
    assignMission(galaxy, ship, BuiltObjectMissionType.Move, ark, null, BuiltObjectMissionPriority.Normal, { manuallyAssigned: true });
    return true;
}

/** Moves the transports: arrivals join the Ark, the shot down lose their passengers, the lost ones are sent on. */
function stepTransports(galaxy: Galaxy, rec: ArkRec, ark: BuiltObject, compact: Empire): void {
    const keep: ArkTransport[] = [];
    for (const x of rec.transports) {
        const b = x.ship;
        if (b.hasBeenDestroyed || b.actualEmpire !== compact) {
            rec.stats.lost++;
            continue;
        }
        if (distanceTo(galaxy, b, ark.xpos, ark.ypos) <= DELIVER) {
            rec.aboard[x.race] = (rec.aboard[x.race] ?? 0) + x.amount;
            rec.stats.landed++;
            rec.stats.taken += x.amount;
            builtObjectCompleteTeardown(galaxy, b);
            continue;
        }
        b.currentFuel = b.fuelCapacity;
        const m = builtObjectMission(b.mission);
        if (idle(b) || (m as { targetBuiltObject?: BuiltObject | null } | null)?.targetBuiltObject !== ark) assignMission(galaxy, b, BuiltObjectMissionType.Move, ark, null, BuiltObjectMissionPriority.Normal, { manuallyAssigned: true });
        keep.push(x);
    }
    rec.transports = keep;
}

function stepSiphon(galaxy: Galaxy, rec: ArkRec, t: ArkTarget, ark: BuiltObject, compact: Empire, now: number): void {
    const h = t.colony;
    if (t.startedAt < 0) return; // waiting for the owner's answer
    if (rec.fight) return; // fight mode: no launches
    if (h.hasBeenDestroyed) {
        t.finishing = true;
        t.finishedAt = now;
        return;
    }
    if (!t.finishing) {
        const allGone = t.species.every((s) => gone(galaxy, s, h));
        const capped = now - t.startedAt >= daysOf(arkParam(galaxy, 'gwArkMaxSiphonDays'));
        if (allGone || capped || t.species.every((s) => remaining(h, s.race) <= 1_000_000)) {
            t.finishing = true;
            t.finishedAt = now;
            return;
        }
        if (now >= t.nextLaunch && rec.transports.length < arkParam(galaxy, 'gwArkMaxInFlight')) {
            if (launchOne(galaxy, rec, t, ark, compact, now)) {
                const rnd = ownRandom(galaxy, 9800 + rec.workId * 31 + t.launched);
                t.nextLaunch = now + daysOf(arkParam(galaxy, 'gwArkLaunchDays')) * (0.7 + rnd.nextDouble() * 0.6);
            } else t.nextLaunch = now + daysOf(1);
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Fight and escape
// ---------------------------------------------------------------------------------------------------------------

/** FIGHT mode starts (or goes on) with an attack on the Ark; `attacker` null: damage was seen but no event named the attacker. */
function noteAttack(galaxy: Galaxy, rec: ArkRec, attacker: Empire | null): void {
    const now = galaxyStarDate(galaxy);
    rec.lastAttack = now;
    if (attacker !== null && !rec.attackers.includes(attacker.empireId)) rec.attackers.push(attacker.empireId);
    if (!rec.fight) {
        rec.fight = true;
        rec.fightSince = now;
        rec.fights++;
        rec.held = false;
        const w = workOf(galaxy, rec);
        if (attacker !== null) scenarioNews(galaxy, null, scenarioText(`${TAG} Ark Fight News`, attacker.name, w !== null ? kindName(w.wonder) : ''), () => true, rec.ship);
        const t = rec.target;
        if (t !== null && t.startedAt >= 0) logGw(galaxy, now, `ark ${rec.workId}: attacked by ${attacker?.name ?? '?'} at ${t.colony.name}; siphoning stops`);
    }
}

function emptySystems(galaxy: Galaxy): Habitat[] {
    const bases = systemsWithBases(galaxy);
    const out: Habitat[] = [];
    for (const sys of galaxy.systems) {
        if (sys === null || sys === undefined) continue;
        const star = sys.systemStar;
        if (star === null || star === undefined || star.hasBeenDestroyed || star.category !== HabitatCategoryType.Star) continue;
        if (star.type === HabitatType.BlackHole || star.type === HabitatType.SuperNova || star.type === HabitatType.Neutron) continue;
        if (bases.has(star.systemIndex) || (sys.creatures?.length ?? 0) > 0) continue;
        let free = true;
        for (const h of galaxy.systemHabitatsOf(star.systemIndex)) {
            if (h.empire !== null || (h.population != null && h.population.totalAmount > 0)) {
                free = false;
                break;
            }
        }
        if (free) out.push(star);
    }
    return out;
}

/** The empty system (no colony of anyone, no base, no monsters) whose distance from (x, y) is closest to gwArkEscapeSectors sectors. Pure. */
export function escapeSystem(galaxy: Galaxy, x: number, y: number, except: Habitat | null = null): Habitat | null {
    const want = arkParam(galaxy, 'gwArkEscapeSectors') * galaxy.sectorSize;
    let best: Habitat | null = null;
    let bs = Number.MAX_VALUE;
    for (const star of emptySystems(galaxy)) {
        if (star === except) continue;
        const d = galaxy.calculateDistance(star.xpos, star.ypos, x, y);
        const s = Math.abs(d - want) + (d < want * 0.4 ? want : 0); // too close is no escape
        if (s < bs || (s === bs && best !== null && star.systemIndex < best.systemIndex)) {
            bs = s;
            best = star;
        }
    }
    return best;
}

function startEscape(galaxy: Galaxy, rec: ArkRec, ark: BuiltObject, now: number, again: boolean): void {
    const star = escapeSystem(galaxy, ark.xpos, ark.ypos, again ? rec.escapeStar : null);
    if (!again) {
        breakShields(galaxy, ark, arkParam(galaxy, 'gwArkRechargeDays'));
        rec.breached = true;
        rec.escapes++;
        if (rec.target !== null) {
            const owner = rec.target.colony.empire;
            if (rec.target.startedAt >= 0 && owner !== null && isHumanEmpire(galaxy, owner)) {
                scenarioMessage(galaxy, owner, scenarioText(`${TAG} Ark Broken Title`), scenarioText(`${TAG} Ark Broken Msg`, rec.target.colony.name), { type: EmpireMessageType.GeneralGoodEvent, subject: ark, popup: false });
            }
            endVisit(galaxy, rec, 'shields broken', now);
        }
        const w = workOf(galaxy, rec);
        scenarioNews(galaxy, null, scenarioText(`${TAG} Ark Broken News`, w !== null ? kindName(w.wonder) : '', star !== null ? star.name : ''), () => true, ark);
    }
    rec.lastEscape = now;
    rec.escapeStar = star;
    rec.phase = 'escaping';
    rec.held = false;
    if (star !== null) {
        rec.goalX = star.xpos;
        rec.goalY = star.ypos;
        sendTo(galaxy, ark, star.xpos, star.ypos);
    }
    logGw(galaxy, now, `ark ${rec.workId}: shields broken, escaping to ${star?.name ?? 'nowhere'}`);
}

// ---------------------------------------------------------------------------------------------------------------
// Lost and seized
// ---------------------------------------------------------------------------------------------------------------

function dropTransports(galaxy: Galaxy, rec: ArkRec): void {
    for (const x of rec.transports) if (!x.ship.hasBeenDestroyed) builtObjectCompleteTeardown(galaxy, x.ship);
    rec.stats.lost += rec.transports.length;
    rec.transports = [];
}

function closeAsLost(galaxy: Galaxy, rec: ArkRec, by: Empire | null): void {
    if (rec.phase === 'lost') return;
    rec.phase = 'lost';
    rec.destroyedBy = by;
    rec.target = null;
    rec.fight = false;
    rec.breached = false;
    dropTransports(galaxy, rec);
    rec.died = arkPopulation(rec);
    rec.aboard = {};
}

/** The Ark died: its people die with it; whoever did it loses standing with everybody. */
function onArkKilled(galaxy: Galaxy, rec: ArkRec, destroyer: Empire | null): void {
    if (rec.phase === 'lost') return;
    const now = galaxyStarDate(galaxy);
    const actor = isActor(galaxy, destroyer) ? destroyer : null;
    closeAsLost(galaxy, rec, destroyer);
    if (actor !== null) {
        const rep = arkParam(galaxy, 'gwArkDestroyRep');
        for (const e of ordinaryEmpires(galaxy)) {
            if (e === actor) continue;
            applyReputation(galaxy, e, actor, -rep, { cause: 'giantworks.arkKiller', labelKey: 'Reputation Cause giantworks.arkKiller', source: 'giantworks', decayPerYear: 0.5 });
        }
        compactFavour(galaxy, actor, -2 * arkParam(galaxy, 'gwArkTransportCompactRep'), 'giantworks.arkKiller');
    }
    scenarioNews(galaxy, null, destroyer === null ? scenarioText(`${TAG} Ark Destroyed News Unknown`, M(rec.died)) : scenarioText(`${TAG} Ark Destroyed News`, destroyer.name, M(rec.died)), () => true, null);
    logGw(galaxy, now, `ark ${rec.workId}: destroyed by ${destroyer?.name ?? 'unknown'}; ${M(rec.died)}M people died`);
}

function onTransportKilled(galaxy: Galaxy, rec: ArkRec, x: ArkTransport, killer: Empire | null): void {
    if (!isActor(galaxy, killer)) return;
    const now = galaxyStarDate(galaxy);
    const last = rec.repAt[killer.empireId];
    if (last !== undefined && now - last < daysOf(REP_SPAN_DAYS)) return;
    rec.repAt[killer.empireId] = now;
    const rep = arkParam(galaxy, 'gwArkTransportRep');
    for (const e of ordinaryEmpires(galaxy)) {
        if (e === killer) continue;
        applyReputation(galaxy, e, killer, -rep, { cause: 'giantworks.arkTransport', labelKey: 'Reputation Cause giantworks.arkTransport', source: 'giantworks', decayPerYear: 1 });
    }
    compactFavour(galaxy, killer, -arkParam(galaxy, 'gwArkTransportCompactRep'), 'giantworks.arkTransport');
    if (isHumanEmpire(galaxy, killer)) {
        scenarioMessage(galaxy, killer, scenarioText(`${TAG} Ark Transport Title`), scenarioText(`${TAG} Ark Transport`, x.from.name), { type: EmpireMessageType.GeneralWarning, subject: x.from, popup: false });
    }
}

// ---------------------------------------------------------------------------------------------------------------
// The step (every game day)
// ---------------------------------------------------------------------------------------------------------------

function stepAi(galaxy: Galaxy, rec: ArkRec, t: ArkTarget, w: GreatWorkRecord, now: number): void {
    if (t.plan !== 'attack' || t.startedAt < 0 || !scenarioFlag(galaxy, SMARTER_AI_FLAG) || now < t.nextReview) return;
    const e = t.empire;
    if (isHumanEmpire(galaxy, e) || !isSmarterAIStrategist(galaxy, e)) return;
    if (w.captureBy === e.empireId) return; // it chose to take the Ark by ground war (capture.ts): no more strikes
    t.nextReview = now + daysOf(arkParam(galaxy, 'gwArkAiReviewDays'));
    if (sendStrike(galaxy, w, e, arkParam(galaxy, 'gwArkAiMarginPct'))) logGw(galaxy, now, `${e.name} sends a strike at the Ark ${w.id}`);
}

function stepArk(galaxy: Galaxy, rec: ArkRec, compact: Empire, now: number): void {
    const w = workOf(galaxy, rec);
    const ark = rec.ship;
    if (w === null || ark === null || rec.phase === 'lost' || rec.phase === 'seized') return;
    if (ark.hasBeenDestroyed) {
        onArkKilled(galaxy, rec, w.destroyedBy ?? null);
        return;
    }
    if (ark.actualEmpire !== compact) {
        rec.phase = 'seized';
        rec.seizedBy = ark.actualEmpire;
        rec.target = null;
        rec.fight = false;
        dropTransports(galaxy, rec);
        logGw(galaxy, now, `ark ${rec.workId}: seized by ${ark.actualEmpire?.name ?? '?'}; ${M(arkPopulation(rec))}M aboard`);
        return;
    }
    if (ark.fuelCapacity > 0) ark.currentFuel = ark.fuelCapacity;
    if (now - rec.grownAt >= daysOf(GROWTH_STEP_DAYS)) growAboard(galaxy, rec, now);
    stepTransports(galaxy, rec, ark, compact);

    // The shield schedule ends: no longer breached.
    if (rec.breached && shieldBreakOf(galaxy, ark) === null && !shieldsDown(ark)) rec.breached = false;
    // Damage taken since the last step is an attack still going on (the attack events only come now and then in a long battle).
    if (rec.lastShields >= 0 && (ark.currentShields < rec.lastShields - ark.shieldsCapacity * 0.002 || ark.damagedComponentCount > rec.lastDamaged)) noteAttack(galaxy, rec, null);
    rec.lastShields = ark.currentShields;
    rec.lastDamaged = ark.damagedComponentCount;
    // Fight mode ends after a quiet spell.
    if (rec.fight && now - rec.lastAttack >= daysOf(arkParam(galaxy, 'gwArkFightQuietDays'))) {
        rec.fight = false;
        rec.attackers = [];
        rec.held = false;
        logGw(galaxy, now, `ark ${rec.workId}: the fight is over`);
    }
    // The shields break: it flees once. At its escape system it stays while they mend, found or not: crippled, it can be
    // boarded there by ground troops (capture.ts; the landing window is the recharge year), and fights back where it is.
    if (rec.fight && shieldBreakOf(galaxy, ark) === null && shieldsDown(ark) && rec.phase !== 'escaping') startEscape(galaxy, rec, ark, now, false);

    if (rec.fight && rec.phase !== 'escaping') {
        // Fight mode: it holds where it is and fights back.
        if (!rec.held) {
            rec.held = true;
            sendTo(galaxy, ark, ark.xpos, ark.ypos);
        }
        return;
    }
    switch (rec.phase) {
        case 'idle': {
            if (now < rec.waitUntil) return;
            beginRoaming(galaxy, rec, ark, now);
            return;
        }
        case 'roaming': {
            const t = rec.target;
            if (t === null || t.colony.hasBeenDestroyed || t.colony.empire === null || siphonable(galaxy, t.colony).length === 0) {
                if (t !== null) endVisit(galaxy, rec, 'colony lost', now);
                beginRoaming(galaxy, rec, ark, now);
                return;
            }
            if (distanceTo(galaxy, ark, t.parkX, t.parkY) <= ARRIVE) {
                rec.phase = 'siphoning';
                t.arrivedAt = now;
                raiseOwnerDecision(galaxy, rec, t);
                scenarioNews(galaxy, null, scenarioText(`${TAG} Ark Arrived News`, t.colony.name, t.empire.name, t.species.map((s) => s.race).join(', ')), () => true, t.colony);
                logGw(galaxy, now, `ark ${rec.workId}: arrives at ${t.colony.name}`);
                return;
            }
            sendTo(galaxy, ark, t.parkX, t.parkY);
            return;
        }
        case 'siphoning': {
            const t = rec.target;
            if (t === null) {
                beginRoaming(galaxy, rec, ark, now);
                return;
            }
            if (!rec.held && distanceTo(galaxy, ark, t.parkX, t.parkY) > ARRIVE * 3) sendTo(galaxy, ark, t.parkX, t.parkY); // back to its place after a fight
            stepAi(galaxy, rec, t, w, now);
            stepSiphon(galaxy, rec, t, ark, compact, now);
            if (t.finishing && (rec.transports.length === 0 || now - t.finishedAt > daysOf(40))) {
                endVisit(galaxy, rec, t.species.every((s) => gone(galaxy, s, t.colony)) ? 'species gone' : 'time is up', now);
                beginRoaming(galaxy, rec, ark, now);
            }
            return;
        }
        case 'escaping': {
            if (rec.escapeStar === null) {
                rec.phase = 'repairing';
                return;
            }
            if (distanceTo(galaxy, ark, rec.goalX, rec.goalY) <= ARRIVE) rec.phase = 'repairing';
            else sendTo(galaxy, ark, rec.goalX, rec.goalY);
            return;
        }
        case 'repairing': {
            if (rec.breached) return; // stays until the shields are whole
            beginRoaming(galaxy, rec, ark, now);
            return;
        }
        default:
            return;
    }
}

/** The frame periodic (every game day): every Ark's step. */
export function arkPeriodic(galaxy: Galaxy): void {
    const st = peekArkState(galaxy);
    if (st === null || st.arks.length === 0) return;
    const compact = compactFaction(galaxy);
    if (compact === null) return;
    const now = galaxyStarDate(galaxy);
    for (const rec of st.arks) stepArk(galaxy, rec, compact, now);
}

// ---------------------------------------------------------------------------------------------------------------
// Events and queries
// ---------------------------------------------------------------------------------------------------------------

function recOfShip(galaxy: Galaxy, bo: BuiltObject): ArkRec | null {
    const st = peekArkState(galaxy);
    if (st === null) return null;
    for (const r of st.arks) if (r.ship === bo) return r;
    return null;
}

function onAttacked(galaxy: Galaxy, bo: BuiltObject, attacker: Empire | null): void {
    if (attacker === null || isCompact(galaxy, attacker)) return;
    const rec = recOfShip(galaxy, bo);
    if (rec === null || rec.phase === 'lost' || rec.phase === 'seized') return;
    noteAttack(galaxy, rec, attacker);
}

function onKilledBy(galaxy: Galaxy, bo: BuiltObject, destroyer: Empire | null): void {
    const st = peekArkState(galaxy);
    if (st === null || st.arks.length === 0) return;
    for (const rec of st.arks) {
        if (rec.ship === bo) {
            onArkKilled(galaxy, rec, destroyer);
            return;
        }
        const x = rec.transports.find((t) => t.ship === bo);
        if (x !== undefined) onTransportKilled(galaxy, rec, x, destroyer);
    }
}

/** True when the Compact's ships may open fire on `target` without a war: it attacked a Ark that is in FIGHT mode. Pure. */
export function arkFightsAgainst(galaxy: Galaxy, empire: Empire, target: Empire): boolean {
    const st = peekArkState(galaxy);
    if (st === null || st.arks.length === 0 || !isCompact(galaxy, empire)) return false;
    for (const r of st.arks) if (r.fight && r.attackers.includes(target.empireId)) return true;
    return false;
}

// ---------------------------------------------------------------------------------------------------------------
// Registration (module load; imported from scenario/packages.ts)
// ---------------------------------------------------------------------------------------------------------------

registerGreatWork({
    id: ARK_ID,
    flag: ARK_FLAG,
    weight: 12,
    // The first tag is the most general (shared with the other heavy builds), the last the giveaway.
    hintTags: ['slag', 'stasis', 'engines'],
    onRolled,
    onComplete,
    onDestroyed,
    // Should the Ark ever count as hostile (the framework's AI then strikes it): the ship alone, no garrison.
    aiStrike: (g, site) => {
        const ark = (site as GreatWorkRecord).base;
        return ark === null || ark.hasBeenDestroyed ? null : { target: ark, defenders: [], marginPct: arkParam(g, 'gwArkAiMarginPct') };
    },
});

registerScenarioGameStart({ id: 'giantworks.ark.start', flag: GW_FLAG, order: 30, run: (g, ctx) => recordOrigins(g, ctx) });
registerScenarioFramePeriodic({ id: 'giantworks.ark.step', flag: GW_FLAG, periodDays: 1, order: 22, run: (g) => arkPeriodic(g) });
registerScenarioEvent({ id: 'giantworks.ark.attacked', flag: GW_FLAG, event: 'builtObjectAttacked', run: (g, e) => onAttacked(g, e.builtObject, e.attackingEmpire) });
registerScenarioEvent({ id: 'giantworks.ark.killed', flag: GW_FLAG, event: 'builtObjectKilledBy', run: (g, e) => onKilledBy(g, e.builtObject, e.destroyer) });
// A big, slow ship: the stock captain bonus for hyperjump speed (BuiltObject.cs WarpSpeedWithBonuses) holds the Ark's warp speed to gwArkSpeedPct %.
registerScenarioQuery({
    id: 'giantworks.ark.speed',
    flag: GW_FLAG,
    query: 'captainBonuses',
    run: (g, v, a) => (recOfShip(g, a.builtObject) !== null ? { ...v, hyperjumpSpeed: Math.min(v.hyperjumpSpeed, arkParam(g, 'gwArkSpeedPct')) } : v),
});
registerScenarioQuery({ id: 'giantworks.ark.fights', flag: GW_FLAG, query: 'attackWithoutWar', run: (g, v, a) => v || arkFightsAgainst(g, a.empire, a.target) });
registerScenarioDecision({ id: 'giantworks.ark.decision', kind: ARK_DECISION_KIND, alwaysAsk: true, recommend: recommendArk, flag: GW_FLAG, resolve: resolveDecision, aiChoose });

export const ARK_HANDLER_IDS = ['giantworks.ark.start', 'giantworks.ark.step', 'giantworks.ark.attacked', 'giantworks.ark.killed'] as const;
export const ARK_QUERY_IDS = ['giantworks.ark.speed', 'giantworks.ark.fights'] as const;

