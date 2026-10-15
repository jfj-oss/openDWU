// Mothballing (scenarios/mothballing, flags mothballing + mothballingAI). Not in the original: an opt-in gameplay change
// on top of the faithful upkeep and AI.
//
// Upkeep in the original: every ship and base costs BuiltObject.AnnualSupportCost a year (BuiltObject.cs 782-830: the
// design's support cost plus Bacon's ShipMaintenanceCostPerSizeUnit × size, ×0.8 without a hyperdrive, minus the
// maintenance savings of resources / race events / characters, × the government's MaintenanceCosts and the pirate
// factors); Empire.4.cs 1743 PayMaintenanceForBuiltObjects charges the state treasury
// AnnualStateMaintenanceExcludingUnderConstruction (BaconEmpire.cs 608: the sum over the built ships, less
// Empire.ShipMaintenanceSavings) every tick, pro rata. The reserve discount is one factor on that per-ship cost through
// the mod layer's `shipMaintenanceFactor` query (builtObject.ts annualSupportCost, after every stock term), so every
// reader — the treasury charge, the AI's budget and force-structure sums, the Empire screen — sees the same number and
// the formula is not forked.
//
// Rules (every number a manifest param):
//   - Mothball: an own fleet or lone warship is sent to an own space port (Move, High priority); within
//     mothballArriveDistance it enters reserve: it parks by the port (a Hold order, kept next to the port as it orbits),
//     upkeep × mothballUpkeepPct %, no mission is accepted (query assignMissionAllowed — so no AI, automation, retreat or
//     counter-attack), its weapons stay cold (builtObjectTick skips the firing step) and Intercept / Defend / Watch never
//     pick it (player/intercept.ts). The trip is given up after mothballTravelDays, when the port is lost, or when the
//     player gives the force another order on the way.
//   - Reactivate: mothballReactivationDays × clamp(size / mothballReactivationRefSize, min %, max %) game days per ship
//     (a fleet is ready when its slowest ship is), at full upkeep, still immobile but with its weapons manned.
//   - The port: a reserve ship is a sitting duck if the port is attacked (it does not fire back and cannot flee). If the
//     port is destroyed (or left without an owner) its reserve ships start an emergency reactivation; if it changes hands
//     (captured or given away) the uncrewed reserve ships there go with it (Empire.1.cs 524 TakeOwnershipOfBuiltObject).
//     Reactivating ships are crewed and stay with their empire.
//   - AI (flag mothballingAI; AI empires only, never pirates or a human seat), reviewed every mothballAIReviewDays: a
//     war warning is a war with anyone, a met empire whose attitude toward it is below mothballAIHostileAttitude, or a
//     met empire whose military potency grew mothballAIArmingPct % within a year and is at least half its own. A warning
//     (or a declared war, at once) starts the reactivation of all its reserve. After mothballAIPeaceYears without a
//     warning and on a tight budget (cashflow below zero, or a treasury under mothballAITightBudgetYears of ship upkeep)
//     it sends its weakest idle fleets (at most mothballAIFleetsPerReview per review) to the nearest space port, up to
//     mothballAIMaxReservePct % of its warship strength; the rest is the home guard (at least one fleet stays active).
//   - War weighing: Empire.7.cs 4975 DetermineRelativeStrength reads the rival's MilitaryPotency through the query
//     `rivalMilitaryPotency`: a rival's ship in reserve counts mothballReserveStrengthPct %, a reactivating one rises
//     linearly to 100 % as it nears readiness — a surprise war on a mothballed navy looks tempting.
// State: BuiltObject.mothball (absent unless used) and scenario.state.mothballing (the registry of mothballed ships, the
// AI's alarm dates and potency snapshots, statistics). Rnd: none, except what the ported calls draw (mission
// assignment, TakeOwnershipOfBuiltObject), and only with the flag on. No transcendental Math functions.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { BuiltObject } from '../../builtObject';
import { ShipGroup, empireShipGroups, forceCompleteMission, leaveShipGroup, shipGroupAssignMission } from '../../fleets/shipGroup';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { forceMotion, forceTravelMs } from '../../player/intercept';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission, type BuiltObjectMission } from '../../missions/mission';
import { assignMission } from '../../missions/assign';
import { markFleetPlayerOrder, markPlayerOrder } from '../../missions/playerOrder';
import { DiplomaticRelationType, empireEvaluationByEmpire, empireEvaluationsOf } from '../../diplomacy';
import { calculateOverallStrengthFactorWithoutShields, militaryPotency } from '../../diplomacyTick';
import { calculateAnnualCashflow } from '../../treasury';
import { annualStateMaintenance } from '../../forceStructure';
import { takeOwnershipOfBuiltObject } from '../../combat/ownership';
import { isHumanEmpire } from '../../humanEmpires';
import { EmpireMessageType } from '../../messages';
import { YEAR_LENGTH } from '../../galaxyTime';
import { galaxyStarDate } from '../../tick/simTime';
import { GAME_DAY_LENGTH, registerScenarioEvent, registerScenarioFramePeriodic, registerScenarioQuery } from '../hooks';
import { scenarioFlag, scenarioParam, scenarioState } from '../state';
import { scenarioMessage } from '../messages';
import { MOTHBALL_REACTIVATING, MOTHBALL_RESERVE, MOTHBALL_TRAVEL, type MothballState } from './types';

export { isMothballed, inReserve, fleetMothballed, MOTHBALL_TRAVEL, MOTHBALL_RESERVE, MOTHBALL_REACTIVATING } from './types';

export const MOTHBALL_FLAG = 'mothballing';
export const MOTHBALL_AI_FLAG = 'mothballingAI';
const STATE_KEY = 'mothballing';

/** The manifest params (scenarios/mothballing/scenario.json), with their defaults. */
export const MOTHBALL_PARAMS = {
    upkeepPct: (g: Galaxy) => scenarioParam(g, 'mothballUpkeepPct', 15),
    reactivationDays: (g: Galaxy) => scenarioParam(g, 'mothballReactivationDays', 240),
    portCapacity: (g: Galaxy) => scenarioParam(g, 'mothballPortCapacity', 6),
    travelWeightPct: (g: Galaxy) => scenarioParam(g, 'mothballPortTravelWeightPct', 25),
    refSize: (g: Galaxy) => scenarioParam(g, 'mothballReactivationRefSize', 400),
    minPct: (g: Galaxy) => scenarioParam(g, 'mothballReactivationMinPct', 50),
    maxPct: (g: Galaxy) => scenarioParam(g, 'mothballReactivationMaxPct', 200),
    arriveDistance: (g: Galaxy) => scenarioParam(g, 'mothballArriveDistance', 2500),
    travelDays: (g: Galaxy) => scenarioParam(g, 'mothballTravelDays', 180),
    reserveStrengthPct: (g: Galaxy) => scenarioParam(g, 'mothballReserveStrengthPct', 25),
    aiReviewDays: (g: Galaxy) => scenarioParam(g, 'mothballAIReviewDays', 30),
    aiPeaceYears: (g: Galaxy) => scenarioParam(g, 'mothballAIPeaceYears', 5),
    aiTightBudgetYears: (g: Galaxy) => scenarioParam(g, 'mothballAITightBudgetYears', 3),
    aiMaxReservePct: (g: Galaxy) => scenarioParam(g, 'mothballAIMaxReservePct', 30),
    aiFleetsPerReview: (g: Galaxy) => scenarioParam(g, 'mothballAIFleetsPerReview', 2),
    aiHostileAttitude: (g: Galaxy) => scenarioParam(g, 'mothballAIHostileAttitude', -15),
    aiArmingPct: (g: Galaxy) => scenarioParam(g, 'mothballAIArmingPct', 30),
    warStatPct: (g: Galaxy) => scenarioParam(g, 'mothballWarStatPct', 20),
};
const P = MOTHBALL_PARAMS;

/**
 * Parking rings, sized in DRAWN world units (render/builtObjectLayer.ts: a ship sprite is sqrt(size × areaRatio × 8) across,
 * zoom-independent; areaRatio of the stock hulls is 1.9 to 3.6, so 4 is used here as an upper bound). The slot spacing is
 * the largest parked ship's drawn side × PARK_SPACING_K + PARK_GAP, so no two sprites overlap, and ring 0 starts beyond
 * both the port's drawn disc and its planet's disc (the port is drawn over its planet).
 */
const PARK_SPACING_K = 1.1;
const PARK_GAP = 12;
const PARK_DRAW_FACTOR = 8 * 4;
/** Drawn side of a ship / port of `size` (world units, upper bound). */
export function drawnDiameter(size: number): number {
    return Math.sqrt(Math.max(0, size) * PARK_DRAW_FACTOR);
}
/** Radius around the port that its own sprite and its planet's disc cover (parked ships stay outside it). */
export function portClearRadius(port: BuiltObject): number {
    let r = drawnDiameter(port.size) / 2;
    const h = port.parentHabitat ?? null;
    if (h !== null) r = Math.max(r, dist(h, port.xpos, port.ypos) + h.diameter / 2);
    return r;
}
const TAU = 2 * Math.PI;

export interface MothballStats {
    /** Wars declared (any empires). */
    warsDeclared: number;
    /** ...of which on an empire with at least mothballWarStatPct % of its warship strength mothballed. */
    warsVsMothballed: number;
    /** Credits of upkeep not paid by ships in reserve (all empires). */
    upkeepSaved: number;
    /** AI forces sent into reserve / reactivated. */
    aiMothballed: number;
    aiReactivated: number;
    /** Reserve ships taken with a captured port. */
    captured: number;
    /** AI review outcomes (war / hostile / arming warnings, peaceTooShort, noPort, budgetOk, noNavy, considered). */
    reviews: Record<string, number>;
}

interface EmpireAIState {
    /** Star date of the last war warning (reactivation trigger); the first review anchors it. */
    alarmAt: number;
    /** empireId → a met empire's potency snapshot (refreshed yearly). */
    snaps: Record<string, { at: number; potency: number }>;
}

export interface MothballGlobalState {
    /** Every ship with a mothball state (pruned daily). */
    ships: BuiltObject[];
    /** Port → parking slot spacing (grows with the largest ship parked there; absent until a ship parks). */
    spacing?: Map<BuiltObject, number>;
    ai: Record<string, EmpireAIState>;
    /** Star date of the last AI reserve review (-1: none yet; the first daily run anchors it). */
    lastAiReview: number;
    stats: MothballStats;
}

function state(galaxy: Galaxy): MothballGlobalState {
    return scenarioState<MothballGlobalState>(galaxy, STATE_KEY, () => ({
        ships: [],
        ai: {},
        lastAiReview: -1,
        stats: { warsDeclared: 0, warsVsMothballed: 0, upkeepSaved: 0, aiMothballed: 0, aiReactivated: 0, captured: 0, reviews: {} },
    }));
}

/** The state without creating it (UI reads, read-only galaxies). */
export function peekMothballState(galaxy: Galaxy): MothballGlobalState | null {
    const s = galaxy.scenario;
    if (s === null || !(STATE_KEY in s.state)) return null;
    return s.state[STATE_KEY] as MothballGlobalState;
}

export function mothballingOn(galaxy: Galaxy): boolean {
    return scenarioFlag(galaxy, MOTHBALL_FLAG);
}

// ---------------------------------------------------------------------------------------------------------------
// Forces and ports
// ---------------------------------------------------------------------------------------------------------------

export type MothballForce = ShipGroup | BuiltObject;

function shipsOf(f: MothballForce): BuiltObject[] {
    return f instanceof ShipGroup ? f.ships.filter((b) => b !== null && !b.hasBeenDestroyed) : f.hasBeenDestroyed ? [] : [f];
}

function leadOf(f: MothballForce): BuiltObject | null {
    if (f instanceof ShipGroup) return f.leadShip !== null ? f.leadShip : f.ships.length > 0 ? f.ships[0] : null;
    return f;
}

function nameOf(f: MothballForce): string {
    return (f instanceof ShipGroup ? f.name : f.name) ?? '';
}

function missionOf(f: MothballForce): BuiltObjectMission | null {
    return f instanceof ShipGroup ? f.mission : builtObjectMission(f.mission);
}

function dist(a: { xpos: number; ypos: number }, x: number, y: number): number {
    const dx = a.xpos - x;
    const dy = a.ypos - y;
    return Math.sqrt(dx * dx + dy * dy);
}

/** A usable reserve port of `empire`: its own built space port. */
function portUsable(port: BuiltObject, empire: Empire): boolean {
    return !port.hasBeenDestroyed && port.empire === empire && port.unbuiltComponentCount <= 0;
}

/** `empire`'s usable space ports (in list order). Read-only. */
export function mothballPorts(galaxy: Galaxy, empire: Empire, force: MothballForce): BuiltObject[] {
    void galaxy;
    void force;
    return empire.spacePorts.filter((p) => p !== null && portUsable(p, empire));
}

/** Reserve capacity of a port (ships): mothballPortCapacity for a small space port, ×2 medium, ×4 large. */
export function portCapacity(galaxy: Galaxy, port: BuiltObject): number {
    const n = Math.max(0, Math.round(P.portCapacity(galaxy)));
    if (port.subRole === BuiltObjectSubRole.LargeSpacePort) return 4 * n;
    if (port.subRole === BuiltObjectSubRole.MediumSpacePort) return 2 * n;
    return n;
}

/** Ships in reserve at, reactivating at or on their way to `port`. Read-only. */
export function portReserveCount(galaxy: Galaxy, port: BuiltObject): number {
    const s = peekMothballState(galaxy);
    if (s === null) return 0;
    let n = 0;
    for (const b of s.ships) if (b.mothball !== undefined && b.mothball.port === port && !b.hasBeenDestroyed) n++;
    return n;
}

/** Relations under which another empire's colonies are not a border threat (treaties). */
function friendlyRelation(t: DiplomaticRelationType): boolean {
    return t === DiplomaticRelationType.FreeTradeAgreement || t === DiplomaticRelationType.MutualDefensePact || t === DiplomaticRelationType.Protectorate || t === DiplomaticRelationType.SubjugatedDominion;
}

/**
 * The points a reserve port should be far from: colonies of every other empire without a treaty with `empire` (at
 * war, unmet, no treaty, sanctions, truce) and pirate bases. Read-only.
 */
function borderPoints(galaxy: Galaxy, empire: Empire): { x: number; y: number }[] {
    const pts: { x: number; y: number }[] = [];
    for (const o of galaxy.empires) {
        if (o === null || o === empire || !o.active || o === galaxy.independentEmpire) continue;
        if (o.pirateEmpireBaseHabitat === null && friendlyRelation(obtainRelationType(empire, o))) continue;
        for (const h of o.colonies) if (h !== null && !h.hasBeenDestroyed) pts.push({ x: h.xpos, y: h.ypos });
    }
    for (const o of galaxy.pirateEmpires) {
        const h = o?.pirateEmpireBaseHabitat ?? null;
        if (o !== null && o.active && h !== null) pts.push({ x: h.xpos, y: h.ypos });
    }
    return pts;
}

function obtainRelationType(empire: Empire, other: Empire): DiplomaticRelationType {
    for (const r of empire.diplomaticRelations.toArray()) if (r.otherEmpire === other) return r.type;
    return DiplomaticRelationType.NotMet;
}

export interface MothballPortChoice {
    port: BuiltObject;
    /** Distance from the force's lead ship. */
    distance: number;
    /** Travel time estimate (game ms; player/intercept.ts forceTravelMs). */
    etaMs: number;
    /** Distance to the nearest border point (colony of an empire without a treaty, pirate base): safety. */
    safety: number;
    used: number;
    capacity: number;
    /** Why it cannot take the force (null: it can). */
    full: string | null;
    score: number;
}

/**
 * `empire`'s space ports for `force`, best first: interior ports (far from the nearest border point) over border ones,
 * the trip as the secondary term — score = safety − mothballPortTravelWeightPct % × distance; ties by id. Ports
 * without room for the whole force are listed last with the reason. The AI picks the same way. Read-only.
 */
export function mothballPortChoices(galaxy: Galaxy, empire: Empire, force: MothballForce): MothballPortChoice[] {
    const lead = leadOf(force);
    if (lead === null) return [];
    const need = shipsOf(force).filter((b) => b.mothball === undefined).length;
    const border = borderPoints(galaxy, empire);
    const far = galaxy.sizeX + galaxy.sizeY;
    const w = P.travelWeightPct(galaxy) / 100;
    const motion = forceMotion(force as ShipGroup | BuiltObject);
    const out: MothballPortChoice[] = [];
    for (const port of mothballPorts(galaxy, empire, force)) {
        let safety = far;
        for (const q of border) {
            const d = dist(port, q.x, q.y);
            if (d < safety) safety = d;
        }
        const distance = dist(lead, port.xpos, port.ypos);
        const used = portReserveCount(galaxy, port);
        const capacity = portCapacity(galaxy, port);
        const full = used + need > capacity ? `full (${used} / ${capacity} ships in reserve)` : null;
        out.push({ port, distance, etaMs: forceTravelMs(motion, distance), safety, used, capacity, full, score: safety - w * distance });
    }
    out.sort((a, b) => (a.full === null ? 0 : 1) - (b.full === null ? 0 : 1) || b.score - a.score || a.port.builtObjectID - b.port.builtObjectID);
    return out;
}

/** Why the force cannot be sent into reserve (null: it can). Read-only. */
export function mothballUnavailableReason(galaxy: Galaxy, empire: Empire, force: MothballForce): string | null {
    if (!mothballingOn(galaxy)) return 'Mothballing is off in this game';
    const ships = shipsOf(force);
    if (ships.length === 0) return 'No ships';
    for (const b of ships) {
        if (b.empire !== empire) return 'Not your ship';
        if (b.mothball !== undefined) return 'Already mothballed';
        if (b.role !== BuiltObjectRole.Military) return `${b.name} is not a warship`;
        if (b.builtAt !== null || b.unbuiltComponentCount > 0) return `${b.name} is still being built`;
        if (b.topSpeed <= 0) return `${b.name} cannot move`;
    }
    const choices = mothballPortChoices(galaxy, empire, force);
    if (choices.length === 0) return 'You have no space port';
    if (choices[0].full !== null) return `Every space port is full (${choices[0].used} / ${choices[0].capacity} at the best)`;
    return null;
}

/** Reactivation time of one ship (game days). */
export function reactivationDays(galaxy: Galaxy, bo: BuiltObject): number {
    const base = P.reactivationDays(galaxy);
    const ref = P.refSize(galaxy);
    if (ref <= 0) return Math.max(1, Math.round(base));
    const k = Math.min(P.maxPct(galaxy) / 100, Math.max(P.minPct(galaxy) / 100, bo.size / ref));
    return Math.max(1, Math.round(base * k));
}

// ---------------------------------------------------------------------------------------------------------------
// Mission gate and orders
// ---------------------------------------------------------------------------------------------------------------

/** True while this package gives its own orders (the gate lets them through). */
let ownOrder = false;

function withOwnOrder<T>(fn: () => T): T {
    const prev = ownOrder;
    ownOrder = true;
    try {
        return fn();
    } finally {
        ownOrder = prev;
    }
}

/** Mission types the fleet machinery uses to carry the trip (an AI force on its way takes no others). */
// (Built on first use: UI modules may import this one while the mission enum's module is still initialising.)
let TRAVEL_TYPES: ReadonlySet<number> | null = null;
function travelTypes(): ReadonlySet<number> {
    TRAVEL_TYPES ??= new Set([BuiltObjectMissionType.Undefined, BuiltObjectMissionType.Move, BuiltObjectMissionType.MoveAndWait, BuiltObjectMissionType.Hold, BuiltObjectMissionType.Refuel]);
    return TRAVEL_TYPES;
}

/** assignMissionAllowed (BuiltObject.2.cs 7620): a ship in reserve or reactivating takes no mission. Pure. */
function missionAllowed(galaxy: Galaxy, value: boolean, args: { builtObject: BuiltObject; missionType: number }): boolean {
    if (!value || ownOrder) return value;
    const m = args.builtObject.mothball;
    if (m === undefined) return value;
    if (m.phase === MOTHBALL_TRAVEL) return isHumanEmpire(galaxy, args.builtObject.empire) || travelTypes().has(args.missionType);
    return false;
}

function moveForce(galaxy: Galaxy, f: MothballForce, port: BuiltObject, human: boolean): BuiltObjectMission | null {
    withOwnOrder(() => {
        const coords = { x: port.xpos, y: port.ypos };
        if (f instanceof ShipGroup) {
            shipGroupAssignMission(galaxy, f, BuiltObjectMissionType.Move, null, null, BuiltObjectMissionPriority.High, human, coords);
            if (human) markFleetPlayerOrder(f);
        } else {
            assignMission(galaxy, f, BuiltObjectMissionType.Move, null, null, BuiltObjectMissionPriority.High, { x: coords.x, y: coords.y, manuallyAssigned: human });
            if (human) markPlayerOrder(f);
        }
    });
    return missionOf(f);
}

/** A Hold to star date `until` (cmdHold, BuiltObject.2.cs 1207: holds until then): keeps the force parked and not idle
 *  (an idle AI-controlled fleet is disbanded by Empire.8.cs MaintainShipGroups). `until` 0 releases it. */
function holdForce(galaxy: Galaxy, f: MothballForce, human: boolean, until: number): void {
    withOwnOrder(() => {
        if (f instanceof ShipGroup) {
            if (until <= 0) forceCompleteMission(galaxy, f);
            else {
                // A fleet mission needs a target or a point (ShipGroup.cs AssignMission): hold where the lead ship is.
                const lead = leadOf(f);
                if (lead !== null) shipGroupAssignMission(galaxy, f, BuiltObjectMissionType.Hold, null, null, BuiltObjectMissionPriority.High, human, { x: lead.xpos, y: lead.ypos }, until);
            }
        } else {
            assignMission(galaxy, f, BuiltObjectMissionType.Hold, null, null, BuiltObjectMissionPriority.High, { manuallyAssigned: human, starDate: until });
        }
    });
}

function holdingFor(f: MothballForce): boolean {
    const m = missionOf(f);
    return m !== null && m.type === BuiltObjectMissionType.Hold;
}

/** Hold "for good" (a thousand years). */
function holdUntil(now: number): number {
    return now + 1000 * YEAR_LENGTH;
}

/**
 * sin / cos from + − × only (range-reduced Taylor series to x^21, error < 1e-12): the parking positions are sim state
 * and must be bit-identical on every platform, which Math.sin / Math.cos are not.
 */
export function detSinCos(a: number): { s: number; c: number } {
    let x = a % TAU;
    if (x > Math.PI) x -= TAU;
    else if (x < -Math.PI) x += TAU;
    const x2 = x * x;
    let sn = 0;
    let cs = 0;
    let term = x;
    for (let k = 1; k <= 21; k += 2) {
        sn += term;
        term *= -x2 / ((k + 1) * (k + 2));
    }
    term = 1;
    for (let k = 0; k <= 20; k += 2) {
        cs += term;
        term *= -x2 / ((k + 1) * (k + 2));
    }
    return { s: sn, c: cs };
}

/** The parking slot `slot` around a port: rings of radius r0 = clearRadius + 0.6 spacing, r0 + spacing, …, each holding ⌊2π r / spacing⌋ ships. */
export function parkingSlotPoint(slot: number, clearRadius: number, spacing: number): { dx: number; dy: number; angle: number; ring: number } {
    let r = clearRadius + spacing * 0.6;
    let i = slot;
    for (let ring = 0; ; ring++) {
        const cap = Math.max(1, Math.floor((TAU * r) / spacing));
        if (i < cap) {
            const angle = (TAU * i) / cap;
            const sc = detSinCos(angle);
            return { dx: r * sc.c, dy: r * sc.s, angle, ring };
        }
        i -= cap;
        r += spacing;
    }
}

/** Ships parked at `port` (reserve or reactivating, with a slot). */
function parkedAt(galaxy: Galaxy, port: BuiltObject): BuiltObject[] {
    const out: BuiltObject[] = [];
    for (const b of state(galaxy).ships) if (b.mothball !== undefined && b.mothball.port === port && b.mothball.slot !== undefined && !b.hasBeenDestroyed) out.push(b);
    return out;
}

/** Puts a parked ship on its slot, facing the port, stopped (follows the port as it orbits). */
function placeParked(bo: BuiltObject, port: BuiltObject, spacing: number): void {
    const m = bo.mothball;
    if (m === undefined || m.slot === undefined) return;
    const p = parkingSlotPoint(m.slot, portClearRadius(port), spacing);
    const x = port.xpos + p.dx;
    const y = port.ypos + p.dy;
    if (bo.xpos !== x) bo.xpos = x;
    if (bo.ypos !== y) bo.ypos = y;
    // Facing the port: the slot's angle + π, in the sim's (−π, π] float heading.
    let h = p.angle + Math.PI;
    if (h > Math.PI) h -= TAU;
    const hf = Math.fround(h);
    if (bo.heading !== hf) bo.heading = hf;
    bo.targetHeading = hf;
    bo.targetSpeed = 0;
    bo.preferredSpeed = 0;
    bo.currentSpeed = 0;
}

/**
 * Parks the arriving ships at `port`: slot spacing from the largest ship parked there (the layout is re-packed — every
 * parked ship re-placed — only when an arrival makes it larger); the arrivals (sorted by id, a fleet together) take the
 * first run of free consecutive slots. Slots free up when ships leave (reactivated, destroyed, captured).
 */
function parkArrivals(galaxy: Galaxy, port: BuiltObject, arrivals: BuiltObject[]): void {
    const s = state(galaxy);
    s.spacing ??= new Map();
    const parked = parkedAt(galaxy, port).filter((b) => !arrivals.includes(b));
    let need = 0;
    for (const b of parked.concat(arrivals)) need = Math.max(need, drawnDiameter(b.size) * PARK_SPACING_K + PARK_GAP);
    const old = s.spacing.get(port) ?? 0;
    const spacing = Math.max(old, need);
    s.spacing.set(port, spacing);
    const used = new Set<number>();
    for (const b of parked) used.add(b.mothball!.slot!);
    const sorted = arrivals.slice().sort((a, b) => a.builtObjectID - b.builtObjectID);
    // The first run of free consecutive slots that stays inside one ring (a fleet side by side); else the first free run.
    const ringOf = (slot: number): number => parkingSlotPoint(slot, portClearRadius(port), spacing).ring;
    const fits = (start: number, sameRing: boolean): boolean => {
        for (let k = 0; k < sorted.length; k++) if (used.has(start + k) || (sameRing && ringOf(start + k) !== ringOf(start))) return false;
        return true;
    };
    let start = 0;
    while (!fits(start, true) && start < 4096) start++;
    if (start >= 4096) {
        start = 0;
        while (!fits(start, false)) start++;
    }
    sorted.forEach((b, k) => { b.mothball!.slot = start + k; });
    if (spacing !== old) for (const b of parked) placeParked(b, port, spacing);
    for (const b of sorted) placeParked(b, port, spacing);
}

/** Keeps the parked ships on their slots (the port orbits with its planet). */
function keepParked(galaxy: Galaxy, bo: BuiltObject): void {
    const m = bo.mothball;
    if (m === undefined) return;
    const spacing = state(galaxy).spacing?.get(m.port);
    if (spacing === undefined || m.slot === undefined) return;
    placeParked(bo, m.port, spacing);
}

function register(galaxy: Galaxy, bo: BuiltObject): void {
    const s = state(galaxy);
    if (!s.ships.includes(bo)) s.ships.push(bo);
}

function enterReserve(galaxy: Galaxy, f: MothballForce, port: BuiltObject): void {

    const now = galaxyStarDate(galaxy);
    const ships = shipsOf(f);
    const human = ships.length > 0 && isHumanEmpire(galaxy, ships[0].empire);
    holdForce(galaxy, f, human, holdUntil(now));
    const arrivals: BuiltObject[] = [];
    ships.forEach((b) => {
        if (b.mothball === undefined) return;
        arrivals.push(b);
        b.mothball.phase = MOTHBALL_RESERVE;
        b.mothball.since = now;
        if (b.mothball.auto === undefined) b.mothball.auto = b.isAutoControlled;
        b.isAutoControlled = false;
        b.mothball.mission = null;
    });
    parkArrivals(galaxy, port, arrivals);
    if (human && ships.length > 0) scenarioMessage(galaxy, ships[0].empire!, 'In reserve', `${nameOf(f)} is now in reserve at ${port.name}: upkeep ${P.upkeepPct(galaxy)}% until it is reactivated.`, { subject: port, popup: false });
}

export interface MothballCommandResult {
    ok: boolean;
    message: string;
}

/**
 * Player command 'mothball' (and the AI's order): send `force` into reserve at `port` (null: the nearest own space
 * port). Within mothballArriveDistance it enters reserve at once.
 */
export function issueMothball(galaxy: Galaxy, empire: Empire, force: MothballForce, port: BuiltObject | null): MothballCommandResult {
    const why = mothballUnavailableReason(galaxy, empire, force);
    if (why !== null) return { ok: false, message: why };
    const choices = mothballPortChoices(galaxy, empire, force);
    const pick = port === null ? choices[0] : choices.find((c) => c.port === port);
    if (pick === undefined) return { ok: false, message: 'Not one of your space ports' };
    if (pick.full !== null) return { ok: false, message: `${pick.port.name} is ${pick.full}` };
    const target = pick.port;
    const human = isHumanEmpire(galaxy, empire);
    const now = galaxyStarDate(galaxy);
    const ships = shipsOf(force);
    const fleet = force instanceof ShipGroup ? force : null;
    const arrive = P.arriveDistance(galaxy);
    const there = ships.every((b) => dist(b, target.xpos, target.ypos) <= arrive);
    const mission = there ? null : moveForce(galaxy, force, target, human);
    for (const b of ships) {
        // Automation off for the whole mothball (restored when ready, or when the trip is called off): the AI's fleet
        // upkeep (Empire.8.cs MaintainShipGroups disbands / top-ups, damaged ships leaving for repair) leaves it alone.
        const m: MothballState = { phase: MOTHBALL_TRAVEL, port: target, fleet, since: now, readyAt: 0, mission, auto: b.isAutoControlled };
        b.isAutoControlled = false;
        b.mothball = m;
        register(galaxy, b);
    }
    if (there) enterReserve(galaxy, force, target);
    return { ok: true, message: there ? `${nameOf(force)} is in reserve at ${target.name}` : `${nameOf(force)} is on its way to reserve at ${target.name}` };
}

function startReactivation(galaxy: Galaxy, bo: BuiltObject, now: number): void {
    const m = bo.mothball;
    if (m === undefined) return;
    if (m.phase === MOTHBALL_TRAVEL) {
        if (m.auto !== undefined) bo.isAutoControlled = m.auto;
        delete bo.mothball;
        return;
    }
    if (m.phase === MOTHBALL_REACTIVATING) return;
    m.phase = MOTHBALL_REACTIVATING;
    m.since = now;
    m.readyAt = now + reactivationDays(galaxy, bo) * GAME_DAY_LENGTH;
}

/** Player command 'reactivate' (and the AI's order): start the force's reactivation (a trip under way is called off). */
export function issueReactivate(galaxy: Galaxy, empire: Empire, force: MothballForce): MothballCommandResult {
    if (!mothballingOn(galaxy)) return { ok: false, message: 'Mothballing is off in this game' };
    const ships = shipsOf(force).filter((b) => b.empire === empire && b.mothball !== undefined);
    if (ships.length === 0) return { ok: false, message: 'Not mothballed' };
    const now = galaxyStarDate(galaxy);
    for (const b of ships) startReactivation(galaxy, b, now);
    const days = forceReadyDays(galaxy, force);
    return { ok: true, message: days > 0 ? `${nameOf(force)}: reactivating, ready in ${days} days` : `${nameOf(force)}: reserve order cancelled` };
}

// ---------------------------------------------------------------------------------------------------------------
// Status (read-only)
// ---------------------------------------------------------------------------------------------------------------

/** The force's mothball phase (-1: none): travel if any ship travels, else reactivating if any, else reserve. */
export function forceMothballPhase(force: MothballForce): number {
    let phase = -1;
    for (const b of shipsOf(force)) {
        const m = b.mothball;
        if (m === undefined) continue;
        if (m.phase === MOTHBALL_TRAVEL) return MOTHBALL_TRAVEL;
        if (m.phase === MOTHBALL_REACTIVATING) phase = MOTHBALL_REACTIVATING;
        else if (phase < 0) phase = MOTHBALL_RESERVE;
    }
    return phase;
}

/** Game days until the force's slowest reactivating ship is ready (0: none reactivating). */
export function forceReadyDays(galaxy: Galaxy, force: MothballForce): number {
    const now = galaxyStarDate(galaxy);
    let ms = 0;
    for (const b of shipsOf(force)) if (b.mothball !== undefined && b.mothball.phase === MOTHBALL_REACTIVATING) ms = Math.max(ms, b.mothball.readyAt - now);
    return ms > 0 ? Math.ceil(ms / GAME_DAY_LENGTH - 1e-6) : 0;
}

function forcePort(force: MothballForce): BuiltObject | null {
    for (const b of shipsOf(force)) if (b.mothball !== undefined) return b.mothball.port;
    return null;
}

/** "In reserve at Sol Port" / "Reactivating: 23 days" / "To reserve at Sol Port" ('' when not mothballed). */
export function mothballStatusText(galaxy: Galaxy, force: MothballForce): string {
    const phase = forceMothballPhase(force);
    const port = forcePort(force);
    const at = port !== null ? port.name : 'port';
    if (phase === MOTHBALL_TRAVEL) return `To reserve at ${at}`;
    if (phase === MOTHBALL_RESERVE) return `In reserve at ${at}`;
    if (phase === MOTHBALL_REACTIVATING) return `Reactivating: ${forceReadyDays(galaxy, force)} days`;
    return '';
}

/** The Mission cell of the Ships and Fleets screens: "Reserve (Sol Port)" / "Reactivating 87 d" / "To reserve (Sol Port)"; '' when not mothballed. */
export function mothballListText(galaxy: Galaxy, force: MothballForce): string {
    const phase = forceMothballPhase(force);
    if (phase < 0) return '';
    const port = forcePort(force);
    const at = port !== null ? port.name : 'port';
    if (phase === MOTHBALL_TRAVEL) return `To reserve (${at})`;
    if (phase === MOTHBALL_RESERVE) return `Reserve (${at})`;
    return `Reactivating ${forceReadyDays(galaxy, force)} d`;
}

/** Short tag for lists ("Reserve" / "Reactivating 23d" / "To reserve"; '' when not mothballed). */
export function mothballTag(galaxy: Galaxy, force: MothballForce): string {
    const phase = forceMothballPhase(force);
    if (phase === MOTHBALL_TRAVEL) return 'To reserve';
    if (phase === MOTHBALL_RESERVE) return 'Reserve';
    if (phase === MOTHBALL_REACTIVATING) return `Reactivating ${forceReadyDays(galaxy, force)}d`;
    return '';
}

/** Warship strength (MilitaryPotency terms) of `empire`: total and the part mothballed (reserve or reactivating). */
export function mothballStrength(empire: Empire): { total: number; reserve: number } {
    let total = 0;
    let reserve = 0;
    for (const b of empire.builtObjects) {
        if (b === null || b.hasBeenDestroyed) continue;
        const s = calculateOverallStrengthFactorWithoutShields(b);
        total += s;
        if (b.mothball !== undefined && b.mothball.phase !== MOTHBALL_TRAVEL) reserve += s;
    }
    return { total, reserve };
}

// ---------------------------------------------------------------------------------------------------------------
// Daily processing
// ---------------------------------------------------------------------------------------------------------------

function forceOfShip(bo: BuiltObject): MothballForce {
    const m = bo.mothball!;
    return m.fleet !== null && bo.shipGroup === m.fleet ? m.fleet : bo;
}

function cancelTrip(galaxy: Galaxy, f: MothballForce, why: string): void {
    const ships = shipsOf(f);
    for (const b of ships) {
        if (b.mothball === undefined || b.mothball.phase !== MOTHBALL_TRAVEL) continue;
        if (b.mothball.auto !== undefined) b.isAutoControlled = b.mothball.auto;
        delete b.mothball;
    }
    if (ships.length > 0 && ships[0].empire !== null && isHumanEmpire(galaxy, ships[0].empire)) scenarioMessage(galaxy, ships[0].empire, 'Reserve order cancelled', `${nameOf(f)}: ${why}.`, { popup: false });
}

function processTravel(galaxy: Galaxy, f: MothballForce, now: number): void {
    const ships = shipsOf(f).filter((b) => b.mothball !== undefined && b.mothball.phase === MOTHBALL_TRAVEL);
    if (ships.length === 0) return;
    const m = ships[0].mothball!;
    const empire = ships[0].empire;
    if (empire === null || !portUsable(m.port, empire)) return cancelTrip(galaxy, f, 'the space port is lost');
    if (now - m.since > P.travelDays(galaxy) * GAME_DAY_LENGTH) return cancelTrip(galaxy, f, 'it did not reach the port in time');
    const arrive = P.arriveDistance(galaxy);
    if (ships.every((b) => dist(b, m.port.xpos, m.port.ypos) <= arrive)) {
        enterReserve(galaxy, f, m.port);
        return;
    }
    const human = isHumanEmpire(galaxy, empire);
    const current = missionOf(f);
    if (human && m.mission !== null && current !== m.mission && current !== null && current.type !== BuiltObjectMissionType.Undefined) return cancelTrip(galaxy, f, 'it was given another order');
    if (current === null || current.type === BuiltObjectMissionType.Undefined || current !== m.mission) {
        const mission = moveForce(galaxy, f, m.port, human);
        for (const b of ships) b.mothball!.mission = mission;
    }
}

function processReserve(galaxy: Galaxy, s: MothballGlobalState, bo: BuiltObject, now: number, index: number, days: number): void {
    const m = bo.mothball!;
    const port = m.port;
    const empire = bo.empire!;
    if (port.hasBeenDestroyed || port.empire === null) {
        startReactivation(galaxy, bo, now);
        if (isHumanEmpire(galaxy, empire) && index === 0) scenarioMessage(galaxy, empire, 'Reserve port lost', `${port.name} is lost: the ships in reserve there begin an emergency reactivation.`, { type: EmpireMessageType.GeneralWarning, subject: bo });
        return;
    }
    if (port.empire !== empire) {
        const taker = port.empire;
        if (m.auto !== undefined) bo.isAutoControlled = m.auto;
        delete bo.mothball;
        takeOwnershipOfBuiltObject(galaxy, empire, bo, taker);
        s.stats.captured++;
        if (isHumanEmpire(galaxy, empire)) scenarioMessage(galaxy, empire, 'Reserve ship lost', `${bo.name} was in reserve at ${port.name} and is taken with the port by ${taker.name}.`, { type: EmpireMessageType.GeneralBadEvent, subject: bo });
        if (isHumanEmpire(galaxy, taker)) scenarioMessage(galaxy, taker, 'Reserve ship captured', `${bo.name} was in reserve at ${port.name} and is ours with the port.`, { type: EmpireMessageType.GeneralGoodEvent, subject: bo });
        return;
    }
    keepParked(galaxy, bo);
    // Statistics: the upkeep not paid (the discounted cost back to the full one).
    const pct = P.upkeepPct(galaxy) / 100;
    if (pct > 0) s.stats.upkeepSaved += (bo.annualSupportCost * (1 / pct - 1) * days) / 360;
}

/** Re-issues the force's Hold if something ended it (once per force per day). */
function keepHolding(galaxy: Galaxy, b: BuiltObject, now: number, seen: Set<MothballForce>): void {
    const f = forceOfShip(b);
    if (seen.has(f)) return;
    seen.add(f);
    if (!holdingFor(f)) holdForce(galaxy, f, b.empire !== null && isHumanEmpire(galaxy, b.empire), holdUntil(now));
}

function processDaily(galaxy: Galaxy, now: number): void {
    const s = state(galaxy);
    const ships = s.ships.filter((b) => b.mothball !== undefined && !b.hasBeenDestroyed && b.empire !== null);
    for (const b of s.ships) if (!ships.includes(b) && b.mothball !== undefined) delete b.mothball;
    s.ships = ships;
    const seen = new Set<MothballForce>();
    const parkIndex = new Map<BuiltObject, number>();
    const doneForces = new Set<MothballForce>();
    for (const b of ships) {
        const m = b.mothball;
        if (m === undefined) continue;
        if (m.phase === MOTHBALL_TRAVEL) {
            const f = forceOfShip(b);
            if (seen.has(f)) continue;
            seen.add(f);
            processTravel(galaxy, f, now);
        } else if (m.phase === MOTHBALL_RESERVE) {
            const i = parkIndex.get(m.port) ?? 0;
            parkIndex.set(m.port, i + 1);
            processReserve(galaxy, s, b, now, i, 1);
            if (b.mothball !== undefined) keepHolding(galaxy, b, now, seen);
        } else if (now < m.readyAt) {
            if (!m.port.hasBeenDestroyed) keepParked(galaxy, b);
            keepHolding(galaxy, b, now, seen);
        } else {
            const f = forceOfShip(b);
            if (m.auto !== undefined) b.isAutoControlled = m.auto;
            delete b.mothball;
            if (forceMothballPhase(f) < 0 && holdingFor(f)) holdForce(galaxy, f, b.empire !== null && isHumanEmpire(galaxy, b.empire), 0);
            if (b.empire !== null && isHumanEmpire(galaxy, b.empire) && forceMothballPhase(f) < 0 && !doneForces.has(f)) {
                doneForces.add(f);
                scenarioMessage(galaxy, b.empire, 'Reactivated', `${nameOf(f)} is back at full readiness.`, { type: EmpireMessageType.GeneralGoodEvent, subject: leadOf(f) });
            }
        }
    }
    s.ships = s.ships.filter((b) => b.mothball !== undefined);
    // A mothballed fleet takes no new ships (Empire.8.cs MaintainShipGroups tops up idle AI-controlled fleets): a ship
    // that joined it since leaves again.
    const fleets = new Set<ShipGroup>();
    for (const b of s.ships) if (b.shipGroup !== null) fleets.add(b.shipGroup as ShipGroup);
    for (const g of fleets) for (const b of g.ships.slice()) if (b.mothball === undefined) leaveShipGroup(galaxy, b);
    if (s.lastAiReview < 0) s.lastAiReview = now;
    else if (now - s.lastAiReview >= P.aiReviewDays(galaxy) * GAME_DAY_LENGTH) {
        s.lastAiReview = now;
        reviewAll(galaxy, now);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------------------------------------------

function aiEmpire(galaxy: Galaxy, e: Empire): boolean {
    return e.active && e.pirateEmpireBaseHabitat === null && e !== galaxy.independentEmpire && !isHumanEmpire(galaxy, e);
}

function aiState(galaxy: Galaxy, e: Empire, now: number): EmpireAIState {
    const s = state(galaxy);
    const key = String(e.empireId);
    let a = s.ai[key];
    if (a === undefined) {
        a = { alarmAt: now, snaps: {} };
        s.ai[key] = a;
    }
    return a;
}

/**
 * The empire's war warning (null: none): a war; a met empire at least half as strong whose attitude toward it is below
 * mothballAIHostileAttitude; or a met empire at least half as strong whose potency grew mothballAIArmingPct % faster
 * than its own over the last year (everyone grows; arming is outgrowing it). Refreshes the yearly snapshots.
 */
export function warWarning(galaxy: Galaxy, e: Empire, a: EmpireAIState, now: number): 'war' | 'hostile' | 'arming' | null {
    let warning: 'war' | 'hostile' | 'arming' | null = null;
    const own = Math.max(1, militaryPotency(e));
    const ownSnap = a.snaps.self;
    const refresh = ownSnap === undefined || now - ownSnap.at >= YEAR_LENGTH;
    const ownGrowth = ownSnap !== undefined ? own / Math.max(1, ownSnap.potency) : 1;
    const armingK = 1 + P.aiArmingPct(galaxy) / 100;
    for (const r of e.diplomaticRelations.toArray()) {
        const o = r.otherEmpire;
        if (o === null || o === undefined || !o.active || r.type === DiplomaticRelationType.NotMet) continue;
        if (r.type === DiplomaticRelationType.War) warning ??= 'war';
        if (o.pirateEmpireBaseHabitat !== null) continue;
        const key = String(o.empireId);
        const p = militaryPotency(o);
        if (p >= own / 2) {
            // Read the evaluation only if it exists (ObtainEmpireEvaluation would add one, changing the diplomacy state).
            const ev = o.empireEvaluations != null ? empireEvaluationByEmpire(empireEvaluationsOf(o), e) : null;
            if (warning === null && ev !== null && ev.overallAttitude < P.aiHostileAttitude(galaxy)) warning = 'hostile';
            const snap = a.snaps[key];
            if (warning === null && snap !== undefined && ownSnap !== undefined && p / Math.max(1, snap.potency) >= ownGrowth * armingK) warning = 'arming';
        }
        if (refresh) a.snaps[key] = { at: now, potency: p };
    }
    if (refresh) a.snaps.self = { at: now, potency: own };
    return warning;
}

function count(galaxy: Galaxy, key: string): void {
    const r = state(galaxy).stats.reviews;
    r[key] = (r[key] ?? 0) + 1;
}

let IDLE_FLEET_TYPES: ReadonlySet<number> | null = null;
function idleFleetTypes(): ReadonlySet<number> {
    IDLE_FLEET_TYPES ??= new Set([BuiltObjectMissionType.Undefined, BuiltObjectMissionType.Patrol, BuiltObjectMissionType.Hold, BuiltObjectMissionType.MoveAndWait]);
    return IDLE_FLEET_TYPES;
}

function aiReactivateAll(galaxy: Galaxy, e: Empire, now: number): number {
    const s = state(galaxy);
    const forces = new Set<MothballForce>();
    for (const b of s.ships) {
        if (b.empire !== e || b.mothball === undefined) continue;
        if (b.mothball.phase !== MOTHBALL_REACTIVATING) forces.add(forceOfShip(b));
        startReactivation(galaxy, b, now);
    }
    s.stats.aiReactivated += forces.size;
    return forces.size;
}

/** One AI empire's reserve review (flag mothballingAI). */
export function reviewEmpireReserve(galaxy: Galaxy, e: Empire, now: number): void {
    const a = aiState(galaxy, e, now);
    const warning = warWarning(galaxy, e, a, now);
    if (warning !== null) {
        count(galaxy, warning);
        a.alarmAt = now;
        aiReactivateAll(galaxy, e, now);
        return;
    }
    if (now - a.alarmAt < P.aiPeaceYears(galaxy) * YEAR_LENGTH) return count(galaxy, 'peaceTooShort');
    if (e.spacePorts.length === 0) return count(galaxy, 'noPort');
    const upkeep = annualStateMaintenance(e);
    const tight = calculateAnnualCashflow(galaxy, e) < 0 || e.stateMoney < P.aiTightBudgetYears(galaxy) * upkeep;
    if (!tight) return count(galaxy, 'budgetOk');
    const { total, reserve } = mothballStrength(e);
    if (total <= 0) return count(galaxy, 'noNavy');
    count(galaxy, 'considered');
    let room = (P.aiMaxReservePct(galaxy) / 100) * total - reserve;
    const fleets: { g: ShipGroup; s: number }[] = [];
    let active = 0;
    for (const g of empireShipGroups(e)) {
        if (g === null || g.ships.length === 0 || g.leadShip === null) continue;
        if (g.ships.some((b) => b.mothball !== undefined)) continue;
        active++;
        const m = g.mission;
        if (m !== null && !idleFleetTypes().has(m.type)) continue;
        if (mothballUnavailableReason(galaxy, e, g) !== null) continue;
        let s = 0;
        for (const b of g.ships) s += calculateOverallStrengthFactorWithoutShields(b);
        if (s > 0) fleets.push({ g, s });
    }
    fleets.sort((x, y) => x.s - y.s || x.g.leadShip!.builtObjectID - y.g.leadShip!.builtObjectID);
    let sent = 0;
    for (const { g, s } of fleets) {
        if (sent >= P.aiFleetsPerReview(galaxy) || active <= 1) break;
        if (s > room) continue;
        if (!issueMothball(galaxy, e, g, null).ok) continue;
        room -= s;
        active--;
        sent++;
        state(galaxy).stats.aiMothballed++;
    }
    count(galaxy, sent > 0 ? 'sent' : fleets.length === 0 ? 'noIdleFleet' : 'noRoom');
}

function reviewAll(galaxy: Galaxy, now: number): void {
    if (!scenarioFlag(galaxy, MOTHBALL_AI_FLAG)) return;
    for (const e of galaxy.empires) if (e !== null && aiEmpire(galaxy, e)) reviewEmpireReserve(galaxy, e, now);
}

// ---------------------------------------------------------------------------------------------------------------
// War weighing and war events
// ---------------------------------------------------------------------------------------------------------------

/** rivalMilitaryPotency (Empire.7.cs 4975 DetermineRelativeStrength): the rival's reserve counts reserveStrengthPct %. Pure. */
export function rivalPotency(galaxy: Galaxy, value: number, other: Empire): number {
    const s = peekMothballState(galaxy);
    if (s === null || s.ships.length === 0) return value;
    const now = galaxyStarDate(galaxy);
    const w0 = P.reserveStrengthPct(galaxy) / 100;
    let cut = 0;
    for (const b of s.ships) {
        const m = b.mothball;
        if (b.empire !== other || m === undefined || b.hasBeenDestroyed || m.phase === MOTHBALL_TRAVEL) continue;
        let w = w0;
        if (m.phase === MOTHBALL_REACTIVATING) {
            const span = m.readyAt - m.since;
            const prog = span > 0 ? Math.min(1, Math.max(0, (now - m.since) / span)) : 1;
            w = w0 + (1 - w0) * prog;
        }
        cut += calculateOverallStrengthFactorWithoutShields(b) * (1 - w);
    }
    return cut > 0 ? Math.max(1, value - cut) : value;
}

function onWarDeclared(galaxy: Galaxy, empire: Empire, target: Empire): void {
    const s = state(galaxy);
    s.stats.warsDeclared++;
    const { total, reserve } = mothballStrength(target);
    if (total > 0 && reserve >= (P.warStatPct(galaxy) / 100) * total) s.stats.warsVsMothballed++;
    const now = galaxyStarDate(galaxy);
    for (const e of [empire, target]) {
        if (scenarioFlag(galaxy, MOTHBALL_AI_FLAG) && aiEmpire(galaxy, e)) {
            aiState(galaxy, e, now).alarmAt = now;
            aiReactivateAll(galaxy, e, now);
        } else if (isHumanEmpire(galaxy, e)) {
            const n = s.ships.filter((b) => b.empire === e && b.mothball !== undefined && b.mothball.phase === MOTHBALL_RESERVE).length;
            if (n > 0) scenarioMessage(galaxy, e, 'War: ships in reserve', `War with ${(e === empire ? target : empire).name}: ${n} of your warships are in reserve. Reactivate them from the selection panel's More menu.`, { type: EmpireMessageType.GeneralWarning });
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------------------------

registerScenarioQuery({
    id: 'mothballing.upkeep',
    flag: MOTHBALL_FLAG,
    query: 'shipMaintenanceFactor',
    run: (g, v, a) => (a.builtObject.mothball !== undefined && a.builtObject.mothball.phase === MOTHBALL_RESERVE ? (v * P.upkeepPct(g)) / 100 : v),
});
registerScenarioQuery({ id: 'mothballing.missions', flag: MOTHBALL_FLAG, query: 'assignMissionAllowed', run: missionAllowed });
registerScenarioQuery({ id: 'mothballing.rivalPotency', flag: MOTHBALL_FLAG, query: 'rivalMilitaryPotency', run: (g, v, a) => rivalPotency(g, v, a.other) });
registerScenarioFramePeriodic({ id: 'mothballing.daily', flag: MOTHBALL_FLAG, periodDays: 1, run: processDaily });
/** The port orbits with its planet: the parked ships follow it every few game hours, not once a day. */
function followPorts(galaxy: Galaxy): void {
    const st = peekMothballState(galaxy);
    if (st === null) return;
    for (const b of st.ships) {
        const m = b.mothball;
        if (m !== undefined && m.slot !== undefined && (m.phase === MOTHBALL_RESERVE || m.phase === MOTHBALL_REACTIVATING) && !b.hasBeenDestroyed && !m.port.hasBeenDestroyed) keepParked(galaxy, b);
    }
}
registerScenarioFramePeriodic({ id: 'mothballing.follow', flag: MOTHBALL_FLAG, periodDays: 0.05, run: followPorts });
registerScenarioEvent({ id: 'mothballing.war', flag: MOTHBALL_FLAG, event: 'warDeclared', run: (g, p) => onWarDeclared(g, p.empire, p.target) });
