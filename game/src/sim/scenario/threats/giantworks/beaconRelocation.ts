// The Beacon, part 7: population relocation (Giantworks wonder, flag gwBeacon). Not a port: a player and AI order composed of the stock passenger
// ships, Transport mission and docking commands (civilianAI.ts assignMissionPassengerShip, missions/cmdDocking.ts cmdLoad / cmdUnload).
//
// THE ORDER: "relocate N people from colony A to colony B" (both the empire's own; one order at a time per source world). It costs
// beaconRelocCostPer10Bn per 10 billion people (linear, paid from the state treasury on the order), and a small approval hit at both worlds
// (beaconRelocApprovalHit, fading over beaconRelocApprovalDays). A full evacuation (every person of the source) abandons the colony: the stock
// rule clears a colony that has no people left. Only races that may live at the destination (acceptsPopulation) move, up to its free room.
// THE CARRIERS: only real private passenger ships (never spawned): an idle one takes the order's next load instead of a stock migration or
// tourism trip, and on a relocation run packs beaconRelocLoadX times its normal passenger capacity (never on normal migration). Each trip rolls
// beaconRelocLossChancePct % to lose beaconRelocLossSharePct % of its people to disease and starvation (a message to the owner). Idle warships
// near a laden transport take stock Escort jobs for it (beaconRelocEscorts at most).
// THE RECEIVING WORLD earns less: income x (1 - beaconRelocIncomeCutPct/100 x min(1, intake / the population before the intake)) until
// beaconRelocIncomeYears after the last intake (refreshed by every new one, not stacked). The Diet's evacuation uses the same rule (beaconDiet.ts).
// THE AI uses the order only for threatened colonies (enemy warships near, a blockade, the Reclaimers' wave), once per source every beaconRelocAiCooldownDays.
// Rnd: galaxy.rnd draws one double per trip (the loss roll); nothing else.
// State (scenarioState 'beaconRelocation', created by the first order only: a game that never orders one is untouched): orders, runs, intakes, approval hits.

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { Habitat } from '../../../types';
import type { BuiltObject } from '../../../builtObject';
import type { Race } from '../../../data/races';
import { BuiltObjectRole } from '../../../data/designSpecifications';
import { BuiltObjectSubRole } from '../../../builtObjectTypes';
import { Population, PopulationList } from '../../../population';
import { galaxyStarDate } from '../../../tick/simTime';
import { YEAR_LENGTH } from '../../../galaxyTime';
import { isHumanEmpire } from '../../../humanEmpires';
import { recalculateEmpirePopulation } from '../../../taxes';
import { withinFuelRangeAndRefuel } from '../../../movement';
import { isAiControlled } from '../../../missions/playerOrder';
import { assignMission } from '../../../missions/assign';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission, isHabitat } from '../../../missions/mission';
import { acceptsPopulation, checkMilitaryShipWelcomeAtTerritoryLocation } from '../../../civilianAI';
import { GAME_DAY_LENGTH, registerScenarioEvent, registerScenarioPeriodic, registerScenarioQuery, scenarioQuery } from '../../hooks';
import { scenarioMessage, scenarioText as T } from '../../messages';
import { EmpireMessageType } from '../../../messages';
import { scenarioFlag, scenarioParam, scenarioState } from '../../state';
import { blockadeInfo } from '../../blockades/blockadesBite';
import { calculateOverallStrengthFactorWithoutShields } from '../../../diplomacyTick';
import { DiplomaticRelationType } from '../../../diplomacy';
import { BEACON_FLAG, peekBeaconState, warOn } from './beaconState';

const KEY = 'beaconRelocation';

/** Smallest load / order: below it nothing is sent. */
export const RELOC_MIN_PEOPLE = 1_000_000;
/** A finished order is kept this long in the list (days), for the colony screen's line. */
const KEEP_DONE_DAYS = 360;
/** A planned load that was never picked up (the ship was sent elsewhere, lost its order) is given back after this many days. */
const PLAN_STALE_DAYS = 90;

// ---------------------------------------------------------------------------------------------------------------
// Parameters (the Giantworks manifest declares the same names and defaults)
// ---------------------------------------------------------------------------------------------------------------

function p(g: Galaxy, name: string, fallback: number): number {
    return scenarioParam(g, name, fallback);
}

export const RELOC = {
    /** $ per 10 billion people moved (linear, paid on the order). */
    costPer10Bn: (g: Galaxy) => Math.max(0, p(g, 'beaconRelocCostPer10Bn', 1_000_000)),
    /** A relocation run carries this many times the ship's normal passenger capacity. */
    loadX: (g: Galaxy) => Math.max(1, p(g, 'beaconRelocLoadX', 10)),
    lossChancePct: (g: Galaxy) => Math.max(0, Math.min(100, p(g, 'beaconRelocLossChancePct', 10))),
    lossSharePct: (g: Galaxy) => Math.max(0, Math.min(100, p(g, 'beaconRelocLossSharePct', 20))),
    /** The receiving world's income cut at an intake as large as its population (x min(1, intake / population)). */
    incomeCutPct: (g: Galaxy) => Math.max(0, Math.min(100, p(g, 'beaconRelocIncomeCutPct', 50))),
    incomeYears: (g: Galaxy) => Math.max(0.1, p(g, 'beaconRelocIncomeYears', 10)),
    approvalHit: (g: Galaxy) => Math.max(0, p(g, 'beaconRelocApprovalHit', 3)),
    approvalDays: (g: Galaxy) => Math.max(1, p(g, 'beaconRelocApprovalDays', 720)),
    escorts: (g: Galaxy) => Math.max(0, Math.trunc(p(g, 'beaconRelocEscorts', 2))),
    escortSectors: (g: Galaxy) => Math.max(1, p(g, 'beaconRelocEscortSectors', 3)),
    aiOn: (g: Galaxy) => p(g, 'beaconRelocAiOn', 1) >= 1,
    aiThreatSectors: (g: Galaxy) => Math.max(0.5, p(g, 'beaconRelocAiThreatSectors', 3)),
    aiSharePct: (g: Galaxy) => Math.max(1, Math.min(100, p(g, 'beaconRelocAiSharePct', 50))),
    aiCooldownDays: (g: Galaxy) => Math.max(1, p(g, 'beaconRelocAiCooldownDays', 720)),
    aiDestSectors: (g: Galaxy) => Math.max(1, p(g, 'beaconRelocAiDestSectors', 14)),
    aiMinPeople: (g: Galaxy) => Math.max(RELOC_MIN_PEOPLE, p(g, 'beaconRelocAiMinPeople', 100_000_000)),
};

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------

/** One relocation order. */
export interface RelocOrder {
    id: number;
    empireId: number;
    from: Habitat;
    to: Habitat;
    /** People ordered (a full evacuation: those the source had that could move; its people keep being moved until it is empty). */
    total: number;
    abandon: boolean;
    /** Planned on ships that have not loaded yet; aboard ships; delivered; lost to disease and wrecks; taken by the Reclaimers. */
    planned: number;
    aboard: number;
    moved: number;
    lost: number;
    seized: number;
    start: number;
    cost: number;
    /** The star date it finished (0: under way) and the reason. */
    doneDate: number;
    ended?: 'done' | 'cancelled' | 'full' | 'lost';
    /** Trips made / lost to disease (for the report). */
    trips: number;
}

/** A transport on a relocation run. 'toLoad': on its way to the source; 'laden': people aboard, on its way to the destination. */
export interface RelocRun {
    ship: BuiltObject;
    orderId: number;
    stage: 'toLoad' | 'laden';
    /** People by race name: planned (toLoad) or aboard (laden). */
    load: { race: string; amount: number }[];
    amount: number;
    date: number;
    /** Warships escorting it. */
    escorts?: BuiltObject[];
}

export interface RelocIntake {
    colony: Habitat;
    /** People taken in since the effect began, and the population before the first of them. */
    amount: number;
    basePop: number;
    until: number;
}

export interface RelocHit {
    colony: Habitat;
    until: number;
}

export interface RelocState {
    orders: RelocOrder[];
    runs: RelocRun[];
    intakes: RelocIntake[];
    hits: RelocHit[];
    nextId: number;
    /** Empire id -> source habitatIndex -> star date of the AI's last order from it. */
    aiLast: Record<string, Record<string, number>>;
    stats: Record<string, number>;
}

function fresh(): RelocState {
    return { orders: [], runs: [], intakes: [], hits: [], nextId: 1, aiLast: {}, stats: {} };
}

export function peekRelocation(g: Galaxy): RelocState | null {
    const s = g.scenario;
    if (s === null) return null;
    return (s.state[KEY] ?? null) as RelocState | null;
}

function relocState(g: Galaxy): RelocState {
    return scenarioState<RelocState>(g, KEY, fresh);
}

function stat(st: RelocState, key: string, by = 1): void {
    st.stats[key] = (st.stats[key] ?? 0) + by;
}

/** The order is available in this game (the Beacon add-on is on). */
export function relocationOn(g: Galaxy): boolean {
    return scenarioFlag(g, BEACON_FLAG);
}

function days(n: number): number {
    return n * GAME_DAY_LENGTH;
}

function millions(n: number): string {
    return Math.max(0, Math.round(n / 1e6)).toLocaleString('en-US');
}

function human(g: Galaxy, e: Empire | null): e is Empire {
    return e !== null && isHumanEmpire(g, e);
}

function empireOf(g: Galaxy, id: number): Empire | null {
    return (g.empires.find((e) => e !== null && e.empireId === id) ?? null) as Empire | null;
}

function raceNamed(g: Galaxy, name: string): Race | null {
    return (g.races.find((r) => r !== null && r.name === name) ?? null) as Race | null;
}

function liveOrders(st: RelocState): RelocOrder[] {
    return st.orders.filter((o) => o.doneDate === 0);
}

function orderOf(st: RelocState, id: number): RelocOrder | null {
    return st.orders.find((o) => o.id === id) ?? null;
}

function runOf(st: RelocState, ship: BuiltObject): RelocRun | null {
    return st.runs.find((r) => r.ship === ship) ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// What can move
// ---------------------------------------------------------------------------------------------------------------

/** The people at `from` of races that may live at `to` (race name -> amount). Pure. */
export function movablePeople(g: Galaxy, empire: Empire, from: Habitat, to: Habitat): { race: string; amount: number }[] {
    const out: { race: string; amount: number }[] = [];
    for (const pop of from.population?.items ?? []) {
        if (pop.amount > 0 && acceptsPopulation(g, to, empire, pop.race)) out.push({ race: pop.race.name, amount: pop.amount });
    }
    return out;
}

function sum(list: readonly { amount: number }[]): number {
    let s = 0;
    for (const x of list) s += x.amount;
    return s;
}

/** People still to arrive at `h` under live orders (not yet delivered). Pure. */
function inboundTo(st: RelocState | null, h: Habitat): number {
    if (st === null) return 0;
    let n = 0;
    for (const o of liveOrders(st)) if (o.to === h) n += Math.max(0, o.total - o.moved - o.lost - o.seized);
    return n;
}

/** The free room at `h` for people: its maximum population less its population and the people already on their way. Pure. */
export function relocationRoom(g: Galaxy, h: Habitat): number {
    const cap = g.scenario !== null ? scenarioQuery(g, 'colonyMaxPopulation', h.maxPopulation, { habitat: h }) : h.maxPopulation;
    return Math.max(0, Math.floor(cap - (h.population?.totalAmount ?? 0) - inboundTo(peekRelocation(g), h)));
}

/** The cost in money of moving `people` (linear). Pure. */
export function relocationCost(g: Galaxy, people: number): number {
    return Math.ceil((Math.max(0, people) * RELOC.costPer10Bn(g)) / 1e10);
}

export interface RelocationPlan {
    error: string | null;
    /** The people the order would move (clipped to what can move and the room), its cost, and whether it abandons the source. */
    amount: number;
    cost: number;
    abandon: boolean;
    /** The most that can be moved now (movable people, clipped to the room). */
    max: number;
}

/** Checks (and sizes) an order of `amount` people from `from` to `to`. Pure. */
export function relocationPlan(g: Galaxy, empire: Empire, from: Habitat, to: Habitat, amount: number): RelocationPlan {
    const none = (error: string, max = 0): RelocationPlan => ({ error, amount: 0, cost: 0, abandon: false, max });
    if (!relocationOn(g)) return none('off');
    if (from === to || from.hasBeenDestroyed || to.hasBeenDestroyed || from.empire !== empire || to.empire !== empire) return none('colonies');
    const st = peekRelocation(g);
    if (st !== null && liveOrders(st).some((o) => o.from === from)) return none('busy');
    const movable = sum(movablePeople(g, empire, from, to));
    if (movable < RELOC_MIN_PEOPLE) return none('nobody');
    const max = Math.min(movable, relocationRoom(g, to));
    if (max < RELOC_MIN_PEOPLE) return none('room', max);
    if (!(amount >= RELOC_MIN_PEOPLE)) return none('amount', max);
    const total = from.population?.totalAmount ?? 0;
    const n = Math.min(Math.floor(amount), max);
    const abandon = n >= total || (movable >= total && n >= movable);
    const cost = relocationCost(g, n);
    if (empire.stateMoney < cost) return { error: 'funds', amount: n, cost, abandon, max };
    return { error: null, amount: n, cost, abandon, max };
}

// ---------------------------------------------------------------------------------------------------------------
// The order
// ---------------------------------------------------------------------------------------------------------------

function hit(g: Galaxy, st: RelocState, h: Habitat, now: number): void {
    const until = now + days(RELOC.approvalDays(g));
    const rec = st.hits.find((x) => x.colony === h);
    if (rec !== undefined) rec.until = Math.max(rec.until, until);
    else st.hits.push({ colony: h, until });
}

/** Places an order (player command and AI). Returns false when it is not allowed (see relocationPlan). */
export function startRelocation(g: Galaxy, empire: Empire, from: Habitat, to: Habitat, amount: number): boolean {
    const plan = relocationPlan(g, empire, from, to, amount);
    if (plan.error !== null) return false;
    const st = relocState(g);
    const now = galaxyStarDate(g);
    empire.stateMoney -= plan.cost;
    st.orders.push({ id: st.nextId++, empireId: empire.empireId, from, to, total: plan.amount, abandon: plan.abandon, planned: 0, aboard: 0, moved: 0, lost: 0, seized: 0, start: now, cost: plan.cost, doneDate: 0, trips: 0 });
    hit(g, st, from, now);
    hit(g, st, to, now);
    stat(st, 'orders');
    if (plan.abandon) stat(st, 'evacuations');
    return true;
}

/** Cancels an order of `empire`: nothing more is sent (people aboard still arrive; the money is not given back). */
export function cancelRelocation(g: Galaxy, empire: Empire, id: number): boolean {
    const st = peekRelocation(g);
    if (st === null) return false;
    const o = orderOf(st, id);
    if (o === null || o.doneDate !== 0 || o.empireId !== empire.empireId) return false;
    finish(g, st, o, 'cancelled');
    return true;
}

function finish(g: Galaxy, st: RelocState, o: RelocOrder, why: NonNullable<RelocOrder['ended']>): void {
    o.doneDate = galaxyStarDate(g);
    o.ended = why;
    const e = empireOf(g, o.empireId);
    if (why === 'done' || why === 'full') {
        stat(st, 'done');
        if (human(g, e)) scenarioMessage(g, e, T('Beacon Reloc Done Title'), T('Beacon Reloc Done', o.from.name, o.to.name, millions(o.moved), millions(o.lost), millions(o.seized)), { type: EmpireMessageType.GeneralGoodEvent, subject: o.to, popup: false });
    }
    // planned loads that were not picked up are given back; ships already on their way keep their orders
    for (const r of st.runs) {
        if (r.orderId === o.id && r.stage === 'toLoad') {
            o.planned = Math.max(0, o.planned - r.amount);
            r.amount = 0;
            r.load = [];
        }
    }
    st.runs = st.runs.filter((r) => !(r.orderId === o.id && r.stage === 'toLoad'));
}

/** How many people of the order are still to be sent (planned loads and people aboard excluded). Pure. */
function remainingToSend(g: Galaxy, empire: Empire, o: RelocOrder): number {
    const movable = sum(movablePeople(g, empire, o.from, o.to));
    const sentOrDone = o.planned + o.aboard + o.moved + o.lost + o.seized;
    let want = o.abandon ? movable - o.planned : o.total - sentOrDone;
    // never more than the source can still give, nor than the destination can still take
    want = Math.min(want, movable - o.planned);
    const room = Math.max(0, Math.floor((g.scenario !== null ? scenarioQuery(g, 'colonyMaxPopulation', o.to.maxPopulation, { habitat: o.to }) : o.to.maxPopulation) - (o.to.population?.totalAmount ?? 0) - inboundTo(peekRelocation(g), o.to) + Math.max(0, o.total - o.moved - o.lost - o.seized - o.planned - o.aboard)));
    return Math.max(0, Math.min(want, room));
}

// ---------------------------------------------------------------------------------------------------------------
// The carriers: an idle private passenger ship takes the next load (civilianAI.ts assignMissionPassengerShip, first)
// ---------------------------------------------------------------------------------------------------------------

/** Passenger ship `ship` of `empire` is idle: gives it a relocation run when an order waits (true: it has its mission). No Rnd. */
export function assignRelocationRun(g: Galaxy, empire: Empire, ship: BuiltObject): boolean {
    const st = peekRelocation(g);
    if (st === null || st.orders.length === 0 || ship.subRole !== BuiltObjectSubRole.PassengerShip || ship.owner !== null || !(ship.populationCapacity > 0)) return false;
    if (!relocationOn(g) || runOf(st, ship) !== null) return false;
    let best: RelocOrder | null = null;
    let bd = Infinity;
    for (const o of liveOrders(st)) {
        if (o.empireId !== empire.empireId || o.from.hasBeenDestroyed || o.to.hasBeenDestroyed || o.from.empire !== empire || o.to.empire !== empire) continue;
        if (remainingToSend(g, empire, o) < RELOC_MIN_PEOPLE) continue;
        if (!withinFuelRangeAndRefuel(g, ship, o.from.xpos, o.from.ypos, 0)) continue;
        const d = g.calculateDistance(ship.xpos, ship.ypos, o.from.xpos, o.from.ypos);
        if (d < bd) {
            bd = d;
            best = o;
        }
    }
    if (best === null) return false;
    const want = Math.min(ship.populationCapacity * RELOC.loadX(g), remainingToSend(g, empire, best));
    if (want < RELOC_MIN_PEOPLE) return false;
    // each race by its share of the people that may move
    const movable = movablePeople(g, empire, best.from, best.to);
    const total = sum(movable);
    if (!(total > 0)) return false;
    const load = movable.map((x) => ({ race: x.race, amount: Math.floor((want * x.amount) / total) })).filter((x) => x.amount > 0);
    const planned = sum(load);
    if (planned < RELOC_MIN_PEOPLE) return false;
    const race = raceNamed(g, load[0].race);
    if (race === null) return false;
    const list = new PopulationList();
    list.add(new Population(race, planned, g));
    assignMission(g, ship, BuiltObjectMissionType.Transport, best.from, best.to, BuiltObjectMissionPriority.Normal, { population: list });
    const m = builtObjectMission(ship.mission);
    if (m === null || m.type !== BuiltObjectMissionType.Transport) return false; // refused (a scenario veto, a precondition)
    st.runs.push({ ship, orderId: best.id, stage: 'toLoad', load, amount: planned, date: galaxyStarDate(g) });
    best.planned += planned;
    stat(st, 'runs');
    return true;
}

/** True when `ship` is on a relocation run (cmdUnload leaves the Diet's evacuation count and the stock migration hooks alone). Pure. */
export function isRelocationShip(g: Galaxy, ship: BuiltObject): boolean {
    const st = peekRelocation(g);
    return st !== null && st.runs.length > 0 && runOf(st, ship) !== null;
}

// ---------------------------------------------------------------------------------------------------------------
// Docking: the load (cmdLoad's population branch) and the arrival (cmdUnload's)
// ---------------------------------------------------------------------------------------------------------------

/** The people aboard (the ship's own list: the stock unload and the wipe after it read it). */
function putAboard(g: Galaxy, bo: BuiltObject, load: readonly { race: string; amount: number }[]): void {
    const list = bo.population ?? new PopulationList();
    list.items.length = 0;
    for (const x of load) {
        const race = raceNamed(g, x.race);
        if (race !== null) list.add(new Population(race, x.amount, g));
    }
    list.recalculateTotalAmount();
    bo.population = list;
}

/**
 * cmdLoad hook (the ship is docked at `dockedAt` with a free bay): a relocation ship takes its people aboard, up to beaconRelocLoadX times its capacity
 * (the stock load takes at most its capacity, and leaves a world 30 million people it will not empty). 'done' completes the Load command (loaded, or
 * nothing to load); null: not a relocation run (the stock load goes on). No Rnd.
 */
export function relocationLoad(g: Galaxy, bo: BuiltObject, dockedAt: unknown): 'done' | null {
    const st = peekRelocation(g);
    if (st === null) return null;
    const run = runOf(st, bo);
    if (run === null) return null;
    if (run.stage === 'laden') {
        // a re-issued run: the people are aboard already (the stock load emptied the ship's list just before this hook)
        putAboard(g, bo, run.load);
        return 'done';
    }
    const o = orderOf(st, run.orderId);
    const empire = bo.empire as Empire | null;
    const endRun = (): 'done' => {
        if (o !== null) o.planned = Math.max(0, o.planned - run.amount);
        st.runs.splice(st.runs.indexOf(run), 1);
        stat(st, 'runsEmpty');
        return 'done';
    };
    if (o === null || o.doneDate !== 0 || empire === null || !isHabitat(dockedAt) || dockedAt !== o.from || o.from.empire !== empire) return endRun();
    const pop = o.from.population;
    if (pop === null) return endRun();
    // what goes: each planned race, up to the people it still has; a world is not emptied unless the order is a full evacuation
    const load: { race: string; amount: number }[] = [];
    let aboard = 0;
    const cap = bo.populationCapacity * RELOC.loadX(g);
    const keep = o.abandon ? 0 : RELOC_MIN_PEOPLE;
    for (const x of run.load) {
        const item = pop.items.find((i) => i.race.name === x.race);
        if (item === undefined) continue;
        const take = Math.max(0, Math.min(x.amount, item.amount - (o.abandon ? 0 : Math.min(keep, item.amount)), cap - aboard));
        if (take <= 0) continue;
        item.amount -= take;
        load.push({ race: x.race, amount: take });
        aboard += take;
    }
    pop.items = pop.items.filter((i) => i.amount > 0);
    pop.recalculateTotalAmount();
    if (aboard < 1) return endRun();
    recalculateEmpirePopulation(empire);
    putAboard(g, bo, load);
    o.planned = Math.max(0, o.planned - run.amount);
    o.aboard += aboard;
    o.trips++;
    run.stage = 'laden';
    run.load = load;
    run.amount = aboard;
    run.date = galaxyStarDate(g);
    stat(st, 'loads');
    stat(st, 'peopleLoaded', aboard);
    return 'done';
}

/**
 * cmdUnload hook (inside the docked population branch): a relocation ship's people reach the destination. They may be hit by disease and starvation on
 * the way (one roll a trip); the rest join the colony and count as an intake (it earns less for years). True: handled (the stock settling is skipped).
 * Draws one galaxy.rnd double.
 */
export function relocationArrive(g: Galaxy, bo: BuiltObject, dockedAt: unknown): boolean {
    const st = peekRelocation(g);
    if (st === null) return false;
    const run = runOf(st, bo);
    if (run === null || run.stage !== 'laden') return false;
    st.runs.splice(st.runs.indexOf(run), 1);
    const o = orderOf(st, run.orderId);
    const empire = (o !== null ? empireOf(g, o.empireId) : null) ?? (bo.empire as Empire | null);
    const aboard = run.amount;
    if (o !== null) o.aboard = Math.max(0, o.aboard - aboard);
    // the trip's roll
    let lost = 0;
    const load = run.load.map((x) => ({ ...x }));
    if (g.rnd.nextDouble() * 100 < RELOC.lossChancePct(g)) {
        const frac = RELOC.lossSharePct(g) / 100;
        for (const x of load) {
            const cut = Math.floor(x.amount * frac);
            x.amount -= cut;
            lost += cut;
        }
        stat(st, 'tripsDiseased');
        stat(st, 'peopleDied', lost);
        if (o !== null) o.lost += lost;
        if (human(g, empire)) {
            scenarioMessage(g, empire, T('Beacon Reloc Losses Title'), T('Beacon Reloc Losses', bo.name, o?.from.name ?? '', o?.to.name ?? '', millions(lost), Math.round(RELOC.lossSharePct(g))), {
                type: EmpireMessageType.GeneralBadEvent,
                subject: bo,
                popup: false,
            });
        }
    }
    const arrived = sum(load);
    const dest = isHabitat(dockedAt) ? dockedAt : null;
    if (dest !== null && dest.empire !== null && dest.empire === bo.empire && arrived > 0) {
        const before = dest.population?.totalAmount ?? 0;
        if (dest.population == null) dest.population = new PopulationList();
        for (const x of load) {
            const race = raceNamed(g, x.race);
            if (race !== null) dest.population.add(new Population(race, x.amount, g));
        }
        dest.population.recalculateTotalAmount();
        recalculateEmpirePopulation(dest.empire);
        if (o !== null) o.moved += arrived;
        noteIntake(g, st, dest, arrived, before);
        stat(st, 'peopleMoved', arrived);
    } else {
        // the destination is gone or changed hands: the people are lost with the trip
        if (o !== null) o.lost += arrived;
        stat(st, 'peopleStranded', arrived);
    }
    bo.population?.items.splice(0);
    bo.population?.recalculateTotalAmount();
    return true;
}

/** People reached `h`: its income is cut for years in proportion (refreshed, not stacked). */
function noteIntake(g: Galaxy, st: RelocState, h: Habitat, amount: number, before: number): void {
    const now = galaxyStarDate(g);
    st.intakes = st.intakes.filter((r) => r.until > now && !r.colony.hasBeenDestroyed);
    let rec = st.intakes.find((r) => r.colony === h);
    if (rec === undefined) {
        rec = { colony: h, amount: 0, basePop: Math.max(1, before), until: 0 };
        st.intakes.push(rec);
    }
    rec.amount += amount;
    rec.until = now + RELOC.incomeYears(g) * YEAR_LENGTH;
}

/** The receiving world's income factor under relocation intakes: 1 - cut x min(1, intake / the population before it). Pure. */
export function relocationIncomeFactor(g: Galaxy, h: Habitat): number {
    const st = peekRelocation(g);
    if (st === null || st.intakes.length === 0) return 1;
    const now = galaxyStarDate(g);
    for (const r of st.intakes) if (r.colony === h && now < r.until) return 1 - (RELOC.incomeCutPct(g) / 100) * Math.min(1, r.amount / Math.max(1, r.basePop));
    return 1;
}

/** The approval hit now at `h` (a positive number to subtract). Pure. */
export function relocationApprovalHit(g: Galaxy, h: Habitat): number {
    const st = peekRelocation(g);
    if (st === null || st.hits.length === 0) return 0;
    const now = galaxyStarDate(g);
    for (const r of st.hits) if (r.colony === h && now < r.until) return RELOC.approvalHit(g);
    return 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Seizure by the Reclaimers' interceptors (beaconInterceptors.ts)
// ---------------------------------------------------------------------------------------------------------------

/** The relocation transports at sea with people aboard (the interceptors' prey). Pure. */
export function ladenTransports(g: Galaxy): BuiltObject[] {
    const st = peekRelocation(g);
    if (st === null) return [];
    return st.runs.filter((r) => r.stage === 'laden' && !r.ship.hasBeenDestroyed).map((r) => r.ship);
}

/** A transport was taken: its run is closed and the people aboard and the world they left are returned (for the pens); null when it was not a laden relocation ship. */
export function relocationSeized(g: Galaxy, ship: BuiltObject, by: Empire): { people: { race: string; amount: number }[]; from: Habitat | null } | null {
    const st = peekRelocation(g);
    if (st === null) return null;
    const run = runOf(st, ship);
    if (run === null || run.stage !== 'laden') return null;
    st.runs.splice(st.runs.indexOf(run), 1);
    const o = orderOf(st, run.orderId);
    const people = run.load.filter((x) => x.amount > 0);
    const n = sum(people);
    if (o !== null) {
        o.aboard = Math.max(0, o.aboard - n);
        o.seized += n;
    }
    stat(st, 'transportsSeized');
    stat(st, 'peopleSeized', n);
    const owner = o !== null ? empireOf(g, o.empireId) : null;
    if (human(g, owner)) {
        scenarioMessage(g, owner, T('Beacon Reloc Seized Title'), T('Beacon Reloc Seized', ship.name, millions(n), o?.from.name ?? '', o?.to.name ?? '', by.name), {
            type: EmpireMessageType.GeneralBadEvent,
            subject: ship,
            popupMode: 'quiet',
        });
    }
    return { people, from: o?.from ?? null };
}

// ---------------------------------------------------------------------------------------------------------------
// The periodic pass: wrecks, stale plans, finished orders, escorts, and the AI's orders
// ---------------------------------------------------------------------------------------------------------------

function missionIdle(b: BuiltObject): boolean {
    const m = builtObjectMission(b.mission);
    return m === null || m.type === BuiltObjectMissionType.Undefined;
}

function escortingNow(g: Galaxy, run: RelocRun): BuiltObject[] {
    run.escorts = (run.escorts ?? []).filter((b) => {
        if (b.hasBeenDestroyed) return false;
        const m = builtObjectMission(b.mission);
        return m !== null && m.type === BuiltObjectMissionType.Escort && m.targetBuiltObject === run.ship;
    });
    void g;
    return run.escorts;
}

/** Idle warships of the transport's empire near a laden transport take stock Escort jobs for it. */
function assignEscorts(g: Galaxy, st: RelocState, run: RelocRun): void {
    const want = RELOC.escorts(g);
    const ship = run.ship;
    const empire = ship.empire as Empire | null;
    if (want <= 0 || empire === null) return;
    const have = escortingNow(g, run);
    if (have.length >= want) return;
    const reach = RELOC.escortSectors(g) * g.sectorSize;
    const cands: BuiltObject[] = [];
    for (const b of empire.builtObjects as BuiltObject[]) {
        if (b === null || b.hasBeenDestroyed || b.role !== BuiltObjectRole.Military || b.topSpeed <= 0 || b.shipGroup !== null || b.troops !== null && b.subRole === BuiltObjectSubRole.TroopTransport) continue;
        if (b.subRole !== BuiltObjectSubRole.Frigate && b.subRole !== BuiltObjectSubRole.Destroyer && b.subRole !== BuiltObjectSubRole.Cruiser && b.subRole !== BuiltObjectSubRole.Escort) continue;
        if (!isAiControlled(b) || !missionIdle(b) || have.includes(b)) continue;
        if (g.calculateDistance(b.xpos, b.ypos, ship.xpos, ship.ypos) > reach) continue;
        cands.push(b);
    }
    cands.sort((a, b) => g.calculateDistance(a.xpos, a.ypos, ship.xpos, ship.ypos) - g.calculateDistance(b.xpos, b.ypos, ship.xpos, ship.ypos) || a.builtObjectID - b.builtObjectID);
    for (const b of cands) {
        if (have.length >= want) break;
        if (!withinFuelRangeAndRefuel(g, b, ship.xpos, ship.ypos, 0.1)) continue;
        if (!checkMilitaryShipWelcomeAtTerritoryLocation(g, ship.xpos, ship.ypos, empire)) break;
        assignMission(g, b, BuiltObjectMissionType.Escort, ship, null, BuiltObjectMissionPriority.Normal);
        have.push(b);
        stat(st, 'escortJobs');
    }
    run.escorts = have;
}

/** Every 5 days: the runs and orders are kept in order, laden transports get escorts. */
export function relocationPass(g: Galaxy): void {
    const st = peekRelocation(g);
    if (st === null || (st.orders.length === 0 && st.runs.length === 0)) return;
    const now = galaxyStarDate(g);
    // wrecks and strays
    for (const run of [...st.runs]) {
        const o = orderOf(st, run.orderId);
        const gone = run.ship.hasBeenDestroyed;
        const taken = !gone && o !== null && run.ship.empire !== null && run.ship.empire.empireId !== o.empireId;
        if (gone || taken) {
            st.runs.splice(st.runs.indexOf(run), 1);
            if (o !== null) {
                if (run.stage === 'laden') {
                    o.aboard = Math.max(0, o.aboard - run.amount);
                    o.lost += run.amount;
                    stat(st, 'transportsLost');
                    stat(st, 'peopleDied', run.amount);
                    const owner = empireOf(g, o.empireId);
                    if (human(g, owner)) scenarioMessage(g, owner, T('Beacon Reloc Wreck Title'), T('Beacon Reloc Wreck', run.ship.name, millions(run.amount), o.from.name, o.to.name), { type: EmpireMessageType.GeneralBadEvent, popup: false });
                } else o.planned = Math.max(0, o.planned - run.amount);
            }
            continue;
        }
        if (run.stage === 'toLoad' && now - run.date > days(PLAN_STALE_DAYS)) {
            if (o !== null) o.planned = Math.max(0, o.planned - run.amount);
            st.runs.splice(st.runs.indexOf(run), 1);
            stat(st, 'plansStale');
            continue;
        }
        if (run.stage === 'laden') {
            // a laden ship that lost its mission is sent on again (the Load of the new Transport passes through: relocationLoad)
            const m = builtObjectMission(run.ship.mission);
            if ((m === null || m.type === BuiltObjectMissionType.Undefined) && o !== null && isAiControlled(run.ship)) {
                const list = new PopulationList();
                const race = raceNamed(g, run.load[0]?.race ?? '');
                if (race !== null) {
                    list.add(new Population(race, Math.max(1, run.amount), g));
                    assignMission(g, run.ship, BuiltObjectMissionType.Transport, o.from, o.to, BuiltObjectMissionPriority.Normal, { population: list });
                }
            }
            assignEscorts(g, st, run);
        }
    }
    // orders that ran their course
    for (const o of liveOrders(st)) {
        const empire = empireOf(g, o.empireId);
        if (empire === null || !empire.active || o.to.hasBeenDestroyed || o.to.empire !== empire) {
            finish(g, st, o, 'lost');
            continue;
        }
        if (o.from.hasBeenDestroyed || o.from.empire !== empire) {
            finish(g, st, o, o.moved > 0 ? 'done' : 'lost');
            continue;
        }
        if (o.planned > 0 || o.aboard > 0) continue;
        const left = remainingToSend(g, empire, o);
        if (left >= RELOC_MIN_PEOPLE) continue;
        // nothing more can be sent: the order is complete (a full evacuation also needs the source empty; if the destination filled up it ends short)
        const empty = o.abandon && (o.from.population?.totalAmount ?? 0) <= 0;
        finish(g, st, o, o.abandon && !empty ? 'full' : 'done');
    }
    // the old
    st.orders = st.orders.filter((o) => o.doneDate === 0 || now - o.doneDate < days(KEEP_DONE_DAYS));
    st.intakes = st.intakes.filter((r) => r.until > now && !r.colony.hasBeenDestroyed);
    st.hits = st.hits.filter((r) => r.until > now && !r.colony.hasBeenDestroyed);
}

// ---------------------------------------------------------------------------------------------------------------
// The AI's use: only a threatened colony
// ---------------------------------------------------------------------------------------------------------------

function strengthNear(g: Galaxy, e: Empire | null, x: number, y: number, range: number, hostileTo: Empire | null): number {
    if (e === null) return 0;
    let s = 0;
    const r2 = range * range;
    for (const b of e.builtObjects as BuiltObject[]) {
        if (b === null || b.hasBeenDestroyed || b.role !== BuiltObjectRole.Military || b.topSpeed <= 0 || b.subRole === BuiltObjectSubRole.TroopTransport) continue;
        if (g.calculateDistanceSquared(b.xpos, b.ypos, x, y) > r2) continue;
        s += Math.max(0, calculateOverallStrengthFactorWithoutShields(b));
    }
    void hostileTo;
    return s;
}

/** `h` (of AI empire `e`) is threatened: enemy warships near it that outweigh its own, a blockade, or the Reclaimers' wave near it. Pure. */
export function colonyThreatened(g: Galaxy, e: Empire, h: Habitat): boolean {
    if (blockadeInfo(g, h) !== null) return true;
    const range = RELOC.aiThreatSectors(g) * g.sectorSize;
    const mine = strengthNear(g, e, h.xpos, h.ypos, range, null);
    let theirs = 0;
    const st = peekBeaconState(g);
    if (st !== null && st.faction !== null && warOn(st)) theirs += strengthNear(g, st.faction, h.xpos, h.ypos, range, e);
    for (const r of e.diplomaticRelations ?? []) {
        if (r.type !== DiplomaticRelationType.War || r.otherEmpire === null || r.otherEmpire === st?.faction) continue;
        theirs += strengthNear(g, r.otherEmpire as Empire, h.xpos, h.ypos, range, e);
    }
    return theirs > 0 && theirs > mine;
}

/** Monthly: an AI empire moves part of the people of each threatened colony to its safest roomy colony within reach. */
export function relocationAiMonthly(g: Galaxy): void {
    if (!relocationOn(g) || !RELOC.aiOn(g)) return;
    const now = galaxyStarDate(g);
    for (const e of g.empires as (Empire | null)[]) {
        if (e === null || !e.active || e === g.independentEmpire || e.pirateEmpireBaseHabitat !== null || isHumanEmpire(g, e) || e.colonies.length < 2) continue;
        const st0 = peekRelocation(g);
        for (const h of e.colonies) {
            if (h.hasBeenDestroyed || h.empire !== e || (h.population?.totalAmount ?? 0) < RELOC.aiMinPeople(g)) continue;
            const last = st0?.aiLast[String(e.empireId)]?.[String(h.habitatIndex)] ?? -1e18;
            if (now - last < days(RELOC.aiCooldownDays(g))) continue;
            if (st0 !== null && liveOrders(st0).some((o) => o.from === h)) continue;
            if (!colonyThreatened(g, e, h)) continue;
            // the destination: the roomiest colony of ours within reach that is not threatened and not a source itself
            let best: Habitat | null = null;
            let bestRoom = RELOC.aiMinPeople(g) / 2;
            const reach = RELOC.aiDestSectors(g) * g.sectorSize;
            for (const d of e.colonies) {
                if (d === h || d.hasBeenDestroyed || d.empire !== e) continue;
                if (g.calculateDistance(d.xpos, d.ypos, h.xpos, h.ypos) > reach) continue;
                const room = relocationRoom(g, d);
                if (room <= bestRoom || colonyThreatened(g, e, d)) continue;
                if (sum(movablePeople(g, e, h, d)) < RELOC_MIN_PEOPLE) continue;
                best = d;
                bestRoom = room;
            }
            if (best === null) continue;
            const amount = Math.floor(((h.population?.totalAmount ?? 0) * RELOC.aiSharePct(g)) / 100);
            if (startRelocation(g, e, h, best, amount)) {
                const st = relocState(g);
                (st.aiLast[String(e.empireId)] ??= {})[String(h.habitatIndex)] = now;
                stat(st, 'aiOrders');
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// The colony screen's view (pure; creates nothing)
// ---------------------------------------------------------------------------------------------------------------

export interface RelocationView {
    /** The order from this colony: progress in people. */
    order: { id: number; to: string; total: number; moved: number; aboard: number; lost: number; seized: number; abandon: boolean; done: boolean; ended: string | null } | null;
    /** People moved in under a live income cut, and the income factor now. */
    incomeFactor: number;
    intake: number;
    /** The people the colony still has. */
    people: number;
}

export function relocationView(g: Galaxy, h: Habitat): RelocationView {
    const st = peekRelocation(g);
    let order: RelocationView['order'] = null;
    if (st !== null) {
        const os = st.orders.filter((o) => o.from === h);
        const o = os.find((x) => x.doneDate === 0) ?? os[os.length - 1] ?? null;
        if (o !== null) order = { id: o.id, to: o.to.name, total: o.total, moved: o.moved, aboard: o.aboard, lost: o.lost, seized: o.seized, abandon: o.abandon, done: o.doneDate !== 0, ended: o.ended ?? null };
    }
    const now = galaxyStarDate(g);
    const rec = st?.intakes.find((r) => r.colony === h && now < r.until) ?? null;
    return { order, incomeFactor: relocationIncomeFactor(g, h), intake: rec?.amount ?? 0, people: h.population?.totalAmount ?? 0 };
}

/** The colonies `empire` may send people from `from` to, with the most each can take (for the colony screen's picker). Pure. */
export function relocationTargets(g: Galaxy, empire: Empire, from: Habitat): { habitat: Habitat; max: number }[] {
    const out: { habitat: Habitat; max: number }[] = [];
    if (!relocationOn(g) || from.empire !== empire) return out;
    for (const d of empire.colonies) {
        if (d === from || d.hasBeenDestroyed || d.empire !== empire) continue;
        const max = Math.min(sum(movablePeople(g, empire, from, d)), relocationRoom(g, d));
        if (max >= RELOC_MIN_PEOPLE) out.push({ habitat: d, max });
    }
    out.sort((a, b) => g.calculateDistance(a.habitat.xpos, a.habitat.ypos, from.xpos, from.ypos) - g.calculateDistance(b.habitat.xpos, b.habitat.ypos, from.xpos, from.ypos) || a.habitat.habitatIndex - b.habitat.habitatIndex);
    return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------------------------

registerScenarioPeriodic({ id: 'beacon.relocation', flag: BEACON_FLAG, order: 26, periodDays: 5, run: (g) => relocationPass(g) });
registerScenarioPeriodic({ id: 'beacon.relocationAi', flag: BEACON_FLAG, order: 27, periodDays: 30, run: (g) => relocationAiMonthly(g) });
registerScenarioQuery({ id: 'beacon.relocIncome', flag: BEACON_FLAG, query: 'colonyTaxRevenue', run: (g, v, { habitat }) => (v > 0 ? v * relocationIncomeFactor(g, habitat) : v) });
registerScenarioQuery({
    id: 'beacon.relocApproval',
    flag: BEACON_FLAG,
    query: 'empireApprovalRating',
    run: (g, v, { habitat }) => {
        const k = relocationApprovalHit(g, habitat);
        return k > 0 ? v - k : v;
    },
});
void registerScenarioEvent;
