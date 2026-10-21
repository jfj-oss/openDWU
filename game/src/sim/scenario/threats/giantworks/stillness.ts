// The Harvest Cycle, Age 2: the Stillness Engine (flag gwHarvestCycle, Age 2 galaxies). Not a port; made of stock mechanics (a base of the builder's own, the research
// tick, the war declaration, the Diet). Design: the plan's "Stillness Engine" section, user-decided 2026-10-20.
//
//   ONE PER GALAXY  any empire may start it (a human from the colony menu on one of its own colonies, an isolationist AI by its own review: stillnessAi.ts); while one is
//                   under construction or standing nobody else can start another. A Diet "Demolish the Stillness Engine" (stillnessDiet.ts) bans it for good.
//   BUILDING        a base of the builder's own (the Defensive Base design, a fresh one named "Stillness Engine"; no new art) placed at the colony, paid up front (stillnessCost).
//                   It takes stillnessYears (5) game years: a plain timer, the base renamed by stage. It is not invulnerable; a base lost while building ends the project.
//   RUNNING         research is slowed by stillnessSlowPct (50%) for EVERY empire, the owner too, EXCEPT what the Severance blueprint sink takes (researchSlowdownFactor
//                   is applied after researchSinkShare). The player who owns it switches it off or on at will (an order on the base); an AI owner only by a Diet vote.
//   SCRAPPED        when the Beacon of the age is finished (phase leaves 'watching') the Engine is removed, its effect ends, the news says so.
// Rnd: none (the AI's rolls come from the module's own stream, stillnessAi.ts).

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { BuiltObject } from '../../../builtObject';
import type { Habitat } from '../../../types';
import { BuiltObjectSubRole } from '../../../builtObjectTypes';
import { EmpireMessageType } from '../../../messages';
import { YEAR_LENGTH } from '../../../galaxyTime';
import { galaxyStarDate } from '../../../tick/simTime';
import { isHumanEmpire } from '../../../humanEmpires';
import { resolveSectorDescription } from '../../../empireEvents';
import { builtObjectCompleteTeardown } from '../../../combat/teardown';
import { getEmpireById } from '../../../logistics/contracts';
import { GAME_DAY_LENGTH, registerScenarioEvent, registerScenarioFramePeriodic, registerScenarioQuery } from '../../hooks';
import { registerScenarioMapFeatures, type ScenarioMapFeatures } from '../../mapFeatures';
import { scenarioMessage, scenarioNews, scenarioText as T } from '../../messages';
import { scenarioParam, scenarioState } from '../../state';
import { registerThreatAction } from '../framework';
import { dietCouncil } from '../../charactersVictory/diet/diet';
import { inDiet } from '../../charactersVictory/diet/dietAi';
import { lawInForce, peekDietState } from '../../charactersVictory/diet/dietState';
import { factionDesign, placeObject } from './lifecycle';
import { peekBeaconState } from './beaconState';
import { HARVEST_CYCLE_FLAG, AGE_PREPARATION, galaxyAgeOf } from './longNightState';
import { isHoldout } from './age2Holdouts';
import { ordinaryEmpires } from './state';

export const STILL_KEY = 'stillness';
export const STILL_TAG = 'Stillness';
/** The player's orders (ShipActionType.ScenarioThreatAction extraData): build on a colony; switch the Engine off / on (target: its base). */
export const ACTION_BUILD = 'stillnessBuild';
export const ACTION_OFF = 'stillnessOff';
export const ACTION_ON = 'stillnessOn';
/** The Diet law "Demolish the Stillness Engine": destroying it is legal (no war needed for a member). */
export const LAW_DEMOLISH_STILL = 'stillnessDemolish';
export const STILL_HANDLER_IDS = ['stillness.step', 'stillness.review', 'stillness.killed', 'stillness.owner'] as const;
export const STILL_QUERY_IDS = ['stillness.slow'] as const;

const p = (g: Galaxy, name: string, fallback: number): number => scenarioParam(g, name, fallback);
/** Parameters (scenario params; code defaults, none in the add-on manifest). */
export const SP = {
    /** Money paid up front by the builder. */
    cost: (g: Galaxy) => p(g, 'stillnessCost', 1500000),
    /** Game years of construction. */
    years: (g: Galaxy) => Math.max(0.05, p(g, 'stillnessYears', 5)),
    /** Percent every empire's research is slowed by while it runs. */
    slowPct: (g: Galaxy) => Math.max(0, Math.min(100, p(g, 'stillnessSlowPct', 50))),
};

export type EngineStatus = 'building' | 'running' | 'off';
export type EngineSide = 'protect' | 'destroy';

export interface EngineRec {
    ownerId: number;
    ownerName: string;
    base: BuiltObject | null;
    /** Where it stands (the base's place at the start; the base's own position is read while it lives). */
    x: number;
    y: number;
    status: EngineStatus;
    start: number;
    /** Star date it finished (0: still building). */
    done: number;
    /** The last stage the base was named for. */
    stage: number;
    /** The empire that destroyed the base (empire id), once it fell; -1 unknown. */
    killedBy: number;
    /** AI empire id -> its side, as the last review saw it. */
    sides: Record<string, EngineSide>;
    /** AI empire ids that went to war with the owner over it. */
    warOver: number[];
    /** Empire id -> star date a strike was last sent. */
    strikes: Record<string, number>;
}

export interface StillnessState {
    engine: EngineRec | null;
    /** The Diet banned it: no new one can ever be built in this galaxy. */
    banned: boolean;
    /** The first star date the module ran in this galaxy. */
    start: number;
    /** The AI stream's counter. */
    rolls: number;
    stats: { built: number; finished: number; lost: number; scrapped: number; silenced: number; wars: number };
}

export function peekStill(galaxy: Galaxy): StillnessState | null {
    const s = galaxy.scenario?.state[STILL_KEY];
    return s === undefined || s === null ? null : (s as StillnessState);
}

export function stillState(galaxy: Galaxy): StillnessState {
    const st = scenarioState<StillnessState>(galaxy, STILL_KEY, () => ({ engine: null, banned: false, start: galaxyStarDate(galaxy), rolls: 0, stats: { built: 0, finished: 0, lost: 0, scrapped: 0, silenced: 0, wars: 0 } }));
    st.stats ??= { built: 0, finished: 0, lost: 0, scrapped: 0, silenced: 0, wars: 0 };
    return st;
}

/** The Engine exists in this game: the Harvest Cycle is on and the galaxy is in Age 2 or later. Pure. */
export function stillnessActive(galaxy: Galaxy): boolean {
    return galaxy.scenario !== null && galaxy.scenario.flags[HARVEST_CYCLE_FLAG] === true && galaxyAgeOf(galaxy) >= AGE_PREPARATION;
}

/** The Engine record while one is building or standing. Pure. */
export function engineOf(galaxy: Galaxy): EngineRec | null {
    return peekStill(galaxy)?.engine ?? null;
}

/** The owner of the Engine (null: none, or the owner is gone). Pure. */
export function engineOwner(galaxy: Galaxy, eng: EngineRec | null = engineOf(galaxy)): Empire | null {
    if (eng === null) return null;
    const e = getEmpireById(galaxy, eng.ownerId);
    return e !== null && e.active ? e : null;
}

/** The Engine runs (finished and not switched off). Pure. */
export function engineRunning(galaxy: Galaxy): boolean {
    return engineOf(galaxy)?.status === 'running';
}

/** Where the Engine stands. Pure. */
export function enginePosition(eng: EngineRec): { x: number; y: number } {
    const b = eng.base;
    return b !== null && !b.hasBeenDestroyed ? { x: b.xpos, y: b.ypos } : { x: eng.x, y: eng.y };
}

/** The factor on every empire's research while the Engine runs (1 otherwise). Pure. */
export function stillnessFactor(galaxy: Galaxy): number {
    if (!stillnessActive(galaxy) || !engineRunning(galaxy)) return 1;
    return 1 - SP.slowPct(galaxy) / 100;
}

/** An empire that may own an Engine or go against it: an ordinary active empire, not a holdout. Pure. */
export function stillnessPlayer(galaxy: Galaxy, e: Empire | null): e is Empire {
    return e !== null && e.active && e.dominantRace !== null && ordinaryEmpires(galaxy).includes(e) && !isHoldout(galaxy, e);
}

/** Empires that may take part (galaxy.empires order). Pure. */
export function stillnessPlayers(galaxy: Galaxy): Empire[] {
    return ordinaryEmpires(galaxy).filter((e) => e.active && e.dominantRace !== null && !isHoldout(galaxy, e));
}

/** The Diet has made destroying the Engine legal and `e` is a member: it needs no war to strike it. Pure. */
export function demolishLegal(galaxy: Galaxy, e: Empire): boolean {
    if (lawInForce(peekDietState(galaxy), LAW_DEMOLISH_STILL) === null) return false;
    const c = dietCouncil(galaxy);
    return c !== null && inDiet(galaxy, c, e);
}

// ---------------------------------------------------------------------------------------------------------------
// Starting it
// ---------------------------------------------------------------------------------------------------------------

export type CannotBuild = 'off' | 'banned' | 'exists' | 'empire' | 'colony' | 'funds' | 'design';

/** Why `e` cannot start an Engine at `colony` (null: it can). Pure. */
export function cannotBuild(galaxy: Galaxy, e: Empire, colony: Habitat | null): CannotBuild | null {
    if (!stillnessActive(galaxy)) return 'off';
    const st = peekStill(galaxy);
    if (st !== null && st.banned) return 'banned';
    if (st !== null && st.engine !== null) return 'exists';
    if (!stillnessPlayer(galaxy, e)) return 'empire';
    if (colony !== null && (colony.empire !== e || colony.hasBeenDestroyed || (colony.population?.totalAmount ?? 0) <= 0)) return 'colony';
    if (e.stateMoney < SP.cost(galaxy)) return 'funds';
    return null;
}

function stageName(progress: number): string {
    return T(`Giantworks Stage ${Math.min(3, Math.max(0, Math.floor(progress * 4)))}`);
}

function baseNameFor(progress: number, done: boolean): string {
    return done ? T(`${STILL_TAG} Base Name Done`) : T(`${STILL_TAG} Base Name`, stageName(progress));
}

function tellHuman(galaxy: Galaxy, e: Empire | null, title: string, body: string, opts: { good?: boolean; bad?: boolean; popup?: boolean; subject?: unknown } = {}): void {
    if (e === null || !isHumanEmpire(galaxy, e)) return;
    scenarioMessage(galaxy, e, title, body, {
        type: opts.good === true ? EmpireMessageType.GeneralGoodEvent : opts.bad === true ? EmpireMessageType.GeneralBadEvent : EmpireMessageType.GeneralNeutralEvent,
        ...(opts.popup === true ? { popupMode: 'force' as const } : { popup: false }),
        ...(opts.subject !== undefined ? { subject: opts.subject } : {}),
    });
}

/**
 * Starts the Engine for `owner` at its colony `colony`: the cost is paid, a fresh Defensive Base design named for the Engine is placed at the colony (parked in
 * its system), the record is made and the galaxy told. Returns whether it started.
 */
export function startEngine(galaxy: Galaxy, owner: Empire, colony: Habitat): boolean {
    if (cannotBuild(galaxy, owner, colony) !== null) return false;
    const design = factionDesign(galaxy, owner, BuiltObjectSubRole.DefensiveBase, true);
    if (design === null) return false;
    design.name = T(`${STILL_TAG} Design Name`);
    const st = stillState(galaxy);
    owner.stateMoney -= SP.cost(galaxy);
    const base = placeObject(galaxy, owner, design, colony, baseNameFor(0, false), true);
    const now = galaxyStarDate(galaxy);
    st.engine = { ownerId: owner.empireId, ownerName: owner.name, base, x: base.xpos, y: base.ypos, status: 'building', start: now, done: 0, stage: 0, killedBy: -1, sides: {}, warOver: [], strikes: {} };
    st.stats.built++;
    const sector = resolveSectorDescription(galaxy, base.xpos, base.ypos);
    scenarioNews(galaxy, null, T(`${STILL_TAG} Started News`, owner.name, sector, Math.round(SP.years(galaxy) * 10) / 10), () => true, base);
    tellHuman(galaxy, owner, T(`${STILL_TAG} Started Title`), T(`${STILL_TAG} Started`, sector, Math.round(SP.years(galaxy) * 10) / 10, Math.round(SP.slowPct(galaxy))), { good: true, subject: base });
    return true;
}

// ---------------------------------------------------------------------------------------------------------------
// The daily step
// ---------------------------------------------------------------------------------------------------------------

/** The Beacon of this age is finished: the Reclamation has begun (the Engine no longer matters). Pure. */
export function beaconFinished(galaxy: Galaxy): boolean {
    const b = peekBeaconState(galaxy);
    return b !== null && b.phase !== 'watching';
}

function removeBase(galaxy: Galaxy, eng: EngineRec): void {
    const b = eng.base;
    if (b !== null && !b.hasBeenDestroyed) builtObjectCompleteTeardown(galaxy, b);
    eng.base = null;
}

/** The Engine is scrapped: removed, the effect ends. `why` 'beacon' (the Beacon is finished). */
export function scrapEngine(galaxy: Galaxy): void {
    const st = peekStill(galaxy);
    if (st === null || st.engine === null) return;
    const eng = st.engine;
    const sector = resolveSectorDescription(galaxy, eng.x, eng.y);
    removeBase(galaxy, eng);
    st.engine = null;
    st.stats.scrapped++;
    scenarioNews(galaxy, null, T(`${STILL_TAG} Scrapped News`, sector));
}

/** The base fell (destroyed, or scrapped by its owner): the project ends and a new one may start. */
function engineLost(galaxy: Galaxy, st: StillnessState, eng: EngineRec): void {
    const by = eng.killedBy >= 0 ? getEmpireById(galaxy, eng.killedBy) : null;
    const sector = resolveSectorDescription(galaxy, eng.x, eng.y);
    st.engine = null;
    st.stats.lost++;
    scenarioNews(galaxy, null, by !== null ? T(`${STILL_TAG} Lost News`, sector, by.name) : T(`${STILL_TAG} Lost News Unknown`, sector));
    tellHuman(galaxy, getEmpireById(galaxy, eng.ownerId), T(`${STILL_TAG} Lost Title`), T(`${STILL_TAG} Lost`, sector), { bad: true, popup: true });
}

/** The owner's base was captured or given: the new owner holds the Engine. */
function followOwner(galaxy: Galaxy, eng: EngineRec): void {
    const b = eng.base;
    if (b === null || b.hasBeenDestroyed) return;
    const o = b.actualEmpire;
    if (o === null || o.empireId === eng.ownerId) return;
    eng.ownerId = o.empireId;
    eng.ownerName = o.name;
    eng.sides = {};
    eng.warOver = [];
    scenarioNews(galaxy, null, T(`${STILL_TAG} Taken News`, o.name, resolveSectorDescription(galaxy, b.xpos, b.ypos)), () => true, b);
}

/** Daily: the construction timer, the loss of the base, the Beacon's end. */
export function stillnessStep(galaxy: Galaxy): void {
    if (!stillnessActive(galaxy)) return;
    const st = stillState(galaxy);
    const eng = st.engine;
    if (eng === null) return;
    if (beaconFinished(galaxy)) {
        scrapEngine(galaxy);
        return;
    }
    const b = eng.base;
    if (b === null || b.hasBeenDestroyed) {
        engineLost(galaxy, st, eng);
        return;
    }
    followOwner(galaxy, eng);
    if (eng.status !== 'building') return;
    const now = galaxyStarDate(galaxy);
    const progress = Math.max(0, Math.min(1, (now - eng.start) / (SP.years(galaxy) * YEAR_LENGTH)));
    if (progress >= 1) {
        eng.status = 'running';
        eng.done = now;
        eng.stage = 4;
        b.name = baseNameFor(1, true);
        st.stats.finished++;
        const sector = resolveSectorDescription(galaxy, b.xpos, b.ypos);
        scenarioNews(galaxy, null, T(`${STILL_TAG} Done News`, eng.ownerName, sector, Math.round(SP.slowPct(galaxy))), () => true, b);
        tellHuman(galaxy, getEmpireById(galaxy, eng.ownerId), T(`${STILL_TAG} Done Title`), T(`${STILL_TAG} Done`, sector, Math.round(SP.slowPct(galaxy))), { good: true, subject: b });
        return;
    }
    const stage = Math.min(3, Math.floor(progress * 4));
    if (stage !== eng.stage) {
        eng.stage = stage;
        b.name = baseNameFor(progress, false);
    }
}

/** 0..1 through the construction (1 when finished). Pure. */
export function engineProgress(galaxy: Galaxy, eng: EngineRec): number {
    if (eng.status !== 'building') return 1;
    return Math.max(0, Math.min(1, (galaxyStarDate(galaxy) - eng.start) / (SP.years(galaxy) * YEAR_LENGTH)));
}

// ---------------------------------------------------------------------------------------------------------------
// Switching off (the owner; the Diet silences an AI owner: stillnessDiet.ts)
// ---------------------------------------------------------------------------------------------------------------

/** Switches the running Engine off, or the one switched off back on. `by` is the empire that did it (the owner); null = the Diet silenced it. Returns whether it changed. */
export function switchEngine(galaxy: Galaxy, on: boolean, by: Empire | null): boolean {
    const st = peekStill(galaxy);
    const eng = st?.engine ?? null;
    if (st === null || eng === null || !stillnessActive(galaxy)) return false;
    if (eng.status !== (on ? 'off' : 'running')) return false;
    eng.status = on ? 'running' : 'off';
    const sector = resolveSectorDescription(galaxy, eng.x, eng.y);
    if (!on) st.stats.silenced++;
    scenarioNews(galaxy, null, by === null && !on ? T(`${STILL_TAG} Silenced News`, eng.ownerName, sector) : T(`${STILL_TAG} ${on ? 'On' : 'Off'} News`, by !== null ? by.name : eng.ownerName, sector), () => true, eng.base);
    return true;
}

// ---------------------------------------------------------------------------------------------------------------
// The player's orders (the order menu: right click an own colony; right click the Engine's base)
// ---------------------------------------------------------------------------------------------------------------

function isColony(t: unknown): t is Habitat {
    return typeof t === 'object' && t !== null && 'population' in t && 'baseQuality' in t;
}

function isEngineBase(galaxy: Galaxy, t: unknown): boolean {
    const eng = engineOf(galaxy);
    return eng !== null && eng.base !== null && eng.base === t;
}

const CANNOT_TEXT: Record<CannotBuild, string> = { off: 'Off', banned: 'Banned', exists: 'Exists', empire: 'Empire', colony: 'Colony', funds: 'Funds', design: 'Design' };

function registerActions(): void {
    registerThreatAction(ACTION_BUILD, {
        available: (g, e, t) => stillnessActive(g) && isColony(t) && t.empire === e && (t.population?.totalAmount ?? 0) > 0 && engineOf(g) === null && peekStill(g)?.banned !== true && stillnessPlayer(g, e),
        run: (g, e, t) => {
            if (!isColony(t)) return false;
            const why = cannotBuild(g, e, t);
            if (why !== null) {
                tellHuman(g, e, T(`${STILL_TAG} Cannot Title`), T(`${STILL_TAG} Cannot ${CANNOT_TEXT[why]}`, Math.round(SP.cost(g))), { bad: true });
                return false;
            }
            if (!startEngine(g, e, t)) {
                tellHuman(g, e, T(`${STILL_TAG} Cannot Title`), T(`${STILL_TAG} Cannot Design`, Math.round(SP.cost(g))), { bad: true });
                return false;
            }
            return true;
        },
        label: () => T(`${STILL_TAG} Action Build`),
    });
    registerThreatAction(ACTION_OFF, {
        available: (g, e, t) => stillnessActive(g) && isEngineBase(g, t) && engineOf(g)!.ownerId === e.empireId && engineOf(g)!.status === 'running',
        run: (g, e) => switchEngine(g, false, e),
        label: () => T(`${STILL_TAG} Action Off`),
    });
    registerThreatAction(ACTION_ON, {
        available: (g, e, t) => stillnessActive(g) && isEngineBase(g, t) && engineOf(g)!.ownerId === e.empireId && engineOf(g)!.status === 'off' && !beaconFinished(g),
        run: (g, e) => switchEngine(g, true, e),
        label: () => T(`${STILL_TAG} Action On`),
    });
}

// ---------------------------------------------------------------------------------------------------------------
// Events, the map, the queries
// ---------------------------------------------------------------------------------------------------------------

function onKilledBy(galaxy: Galaxy, bo: BuiltObject, destroyer: Empire | null): void {
    const eng = engineOf(galaxy);
    if (eng === null || eng.base !== bo) return;
    eng.killedBy = destroyer !== null ? destroyer.empireId : -1;
}

/** The map marker (small, in the threat-marker style): the Engine's place, known to every empire. */
export function stillnessMapFeatures(galaxy: Galaxy, viewer: Empire | null): ScenarioMapFeatures | null {
    const eng = engineOf(galaxy);
    if (viewer === null || eng === null || eng.base === null || eng.base.hasBeenDestroyed) return null;
    const at = enginePosition(eng);
    return { markers: [{ x: at.x, y: at.y, label: T(`${STILL_TAG} Marker`), color: eng.status === 'off' ? 0x6f7885 : 0x8fa3c2 }], routes: [] };
}

export interface StillnessRow {
    key: string;
    what: string;
    where: string;
    status: string;
    goTo: BuiltObject | null;
    point: { x: number; y: number } | null;
}

function names(galaxy: Galaxy, ids: Iterable<string | number>): string {
    const out: string[] = [];
    for (const id of ids) {
        const e = getEmpireById(galaxy, Number(id));
        if (e !== null) out.push(e.name);
    }
    return out.join(', ');
}

/** The Knowledge page's rows for the Engine (everyone knows it: it is public). Pure. */
export function stillnessKnowledgeRows(galaxy: Galaxy): StillnessRow[] {
    const st = peekStill(galaxy);
    if (st === null || !stillnessActive(galaxy)) return [];
    const rows: StillnessRow[] = [];
    const eng = st.engine;
    if (eng !== null) {
        const at = enginePosition(eng);
        const sector = resolveSectorDescription(galaxy, at.x, at.y);
        const status = eng.status === 'building' ? T(`${STILL_TAG} Row Building`, Math.round(engineProgress(galaxy, eng) * 100)) : eng.status === 'running' ? T(`${STILL_TAG} Row Running`) : T(`${STILL_TAG} Row Off`);
        rows.push({ key: 'still:engine', what: T(`${STILL_TAG} Row Engine`), where: sector, status, goTo: eng.base !== null && !eng.base.hasBeenDestroyed ? eng.base : null, point: at });
        rows.push({ key: 'still:owner', what: T(`${STILL_TAG} Row Owner`), where: '', status: eng.ownerName, goTo: null, point: null });
        rows.push({ key: 'still:effect', what: T(`${STILL_TAG} Row Effect`), where: '', status: eng.status === 'running' ? T(`${STILL_TAG} Row Effect On`, Math.round(SP.slowPct(galaxy))) : T(`${STILL_TAG} Row Effect None`), goTo: null, point: null });
        const protect = Object.keys(eng.sides).filter((k) => eng.sides[k] === 'protect');
        const destroy = Object.keys(eng.sides).filter((k) => eng.sides[k] === 'destroy');
        if (protect.length > 0) rows.push({ key: 'still:protect', what: T(`${STILL_TAG} Row Protectors`), where: '', status: names(galaxy, protect), goTo: null, point: null });
        if (destroy.length > 0) rows.push({ key: 'still:destroy', what: T(`${STILL_TAG} Row Attackers`), where: '', status: names(galaxy, destroy), goTo: null, point: null });
        if (eng.warOver.length > 0) rows.push({ key: 'still:wars', what: T(`${STILL_TAG} Row Wars`), where: '', status: names(galaxy, eng.warOver), goTo: null, point: null });
    }
    if (st.banned) rows.push({ key: 'still:banned', what: T(`${STILL_TAG} Row Banned`), where: '', status: T(`${STILL_TAG} Row Banned Status`), goTo: null, point: null });
    return rows;
}

export function registerStillness(): void {
    registerActions();
    registerScenarioFramePeriodic({ id: 'stillness.step', flag: HARVEST_CYCLE_FLAG, order: 29, periodDays: 1, run: (g) => stillnessStep(g) });
    registerScenarioEvent({ id: 'stillness.killed', flag: HARVEST_CYCLE_FLAG, event: 'builtObjectKilledBy', run: (g, e) => onKilledBy(g, e.builtObject, e.destroyer) });
    registerScenarioQuery({ id: 'stillness.slow', flag: HARVEST_CYCLE_FLAG, query: 'researchSlowdownFactor', run: (g, v) => v * stillnessFactor(g) });
    registerScenarioMapFeatures('stillness', stillnessMapFeatures);
}

void GAME_DAY_LENGTH;
