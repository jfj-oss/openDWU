// Beached ships (scenarios/beaching, flags beaching + beachingAI). Not in the original: an opt-in gameplay change.
//
// The order: a warship at one of its empire's own colonies is ordered to "Beach on colony" (the order menu of the
// selected ship or fleet; the AI only as a very last resort, below). The ship crash-lands and stays on the planet as a
// grounded fortress for good — it is never refloated. It keeps its BuiltObject (so its guns, armour and the space-control
// maths all work as for any ship) but is no longer a ship in any other sense: it leaves its fleet, takes no mission
// (query assignMissionAllowed, as in reserve), is not automated, sits on one of four slots around the planet and pays a
// part of its upkeep (beachUpkeepPct).
//
// Defence: its crew joins the colony's garrison as one real Armored troop unit (Troop.beached), so every stock reader sees
// it — the ground battle maths, the AI's troop estimates, the Troops screen. Its defend strength is the hull's:
// size × beachDefendPerSize + armour × beachDefendPerArmor, × the crew level (calculateCrewLevel: green −, average 1,
// each level above +beachCrewStepPct %), less up to half for a hull with all its parts damaged. The crew is never picked
// up by a transport, never garrison-reviewed away and costs no troop upkeep; its casualties are the stock battle's.
//
// Guns: a beached ship's weapons fire at hostile ships in orbit like a base's, but only while no ground battle runs on its
// colony (landed enemy troops, Habitat.InvadingTroops): the crew is fighting on the ground then (builtObjectTick asks
// beachedMayFire). They fire again as soon as the surface is clear — if the colony holds — and never again if it falls
// (a conquered colony takes its beached hulks with it: they are lost at the next daily review).
//
// The scar: every beached ship lowers the colony's BASE quality by beachLossSmallPct % (size ≤ beachSizeSmall) to
// beachLossLargePct % (size ≥ beachSizeLarge) of what it was before the first beaching, in between by size; at most
// beachMaxShips ships per colony and beachMaxLossPct % in all (a beaching past the cap is allowed, the cap only limits the
// loss). The loss is kept per colony (state.colonies), so it outlives a destroyed hull and passes to a conqueror.
//
// Cleanup: an empire with the terraforming technology (a buildable Terraforming Facility) can order "Clean up beaching
// damage" on a colony (the colony's order menu; AI empires do it by themselves when it is quiet and they can afford it).
// It costs beachCleanupCostPerPct credits per percentage point of lost quality (paid at once from the treasury) and
// restores the lost quality evenly over beachCleanupDays game days. The wrecks stay; only the quality is cleaned.
//
// AI (flag beachingAI; AI empires only, never pirates or a human seat), reviewed every beachAIReviewDays — a very, very
// last resort, ALL of these at once for a colony:
//   - it is valuable: the capital, or at least beachAIValuePct % of the empire's population;
//   - an overwhelming invasion is on it: hostile troops landed, or troop ships of an empire at war within beachAIRange,
//     carrying at least beachAITroopPct % of the colony's defending strength;
//   - its orbital forces will certainly be wiped out: the hostile ships near it have at least beachAIOrbitRatio times the
//     firepower of the empire's ships there;
//   - there is a ship to give: one of its warships at the colony that cannot get away (no hyperdrive, no engines, no fuel)
//     or is badly damaged (at least beachAIDamagedPct % of its parts), the smallest first.
// It beaches one ship (a second only for the capital against at least twice the defence), keeps the total loss under
// beachAIMaxLossPct % (beachAIMaxLossCapitalPct % for the capital) and waits beachAICooldownDays days between beachings of
// one colony.
// State: BuiltObject.beached, Troop.beached and scenario.state.beaching (the ships, the colonies' scars and cleanups, the AI
// statistics). Rnd: none. No transcendental Math functions (the slots are the diagonals).

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { BuiltObject } from '../../builtObject';
import type { Habitat } from '../../types';
import { Troop, TroopList, TroopType } from '../../cargo';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { leaveShipGroup } from '../../fleets/shipGroup';
import { BuiltObjectMissionPriority, BuiltObjectMissionType } from '../../missions/mission';
import { assignMission } from '../../missions/assign';
import { builtObjectCompleteTeardown } from '../../combat/teardown';
import { calculateCrewLevel } from '../../construction/repair';
import { facilityType, PlanetaryFacilityType } from '../../researchSystem';
import { DiplomaticRelationType } from '../../diplomacy';
import { isHumanEmpire } from '../../humanEmpires';
import { EmpireMessageType } from '../../messages';
import { getNearbyBuiltObjects } from '../../pirates/pirateAI';
import { updateIndexesForMovement } from '../../movement';
import { galaxyStarDate } from '../../tick/simTime';
import { GAME_DAY_LENGTH, registerScenarioFramePeriodic, registerScenarioEvent, registerScenarioQuery } from '../hooks';
import { scenarioParam, scenarioState } from '../state';
import { scenarioMessage } from '../messages';
import { registerThreatAction } from '../threats/framework';
import { groundBattleOn } from './types';

export { isBeached, groundBattleOn, beachedMayFire } from './types';

// Literal flag names (no import of a flags module: import cycles).
export const BEACHING_FLAG = 'beaching';
export const BEACHING_AI_FLAG = 'beachingAI';
const KEY = 'beaching';
/** The order kinds (ShipActionType.ScenarioThreatAction extraData). */
export const BEACH_ACTION = 'beaching.beach';
export const CLEANUP_ACTION = 'beaching.cleanup';

/** The manifest params (scenarios/beaching/scenario.json), with their defaults. */
export const BEACH_PARAMS = {
    maxShips: (g: Galaxy) => scenarioParam(g, 'beachMaxShips', 4),
    maxLossPct: (g: Galaxy) => scenarioParam(g, 'beachMaxLossPct', 20),
    lossSmallPct: (g: Galaxy) => scenarioParam(g, 'beachLossSmallPct', 2),
    lossLargePct: (g: Galaxy) => scenarioParam(g, 'beachLossLargePct', 8),
    sizeSmall: (g: Galaxy) => scenarioParam(g, 'beachSizeSmall', 150),
    sizeLarge: (g: Galaxy) => scenarioParam(g, 'beachSizeLarge', 900),
    range: (g: Galaxy) => scenarioParam(g, 'beachRange', 1500),
    defendPerSize: (g: Galaxy) => scenarioParam(g, 'beachDefendPerSize', 0.35),
    defendPerArmor: (g: Galaxy) => scenarioParam(g, 'beachDefendPerArmor', 0.5),
    crewStepPct: (g: Galaxy) => scenarioParam(g, 'beachCrewStepPct', 12),
    upkeepPct: (g: Galaxy) => scenarioParam(g, 'beachUpkeepPct', 50),
    cleanupDays: (g: Galaxy) => scenarioParam(g, 'beachCleanupDays', 360),
    cleanupCostPerPct: (g: Galaxy) => scenarioParam(g, 'beachCleanupCostPerPct', 25000),
    aiReviewDays: (g: Galaxy) => scenarioParam(g, 'beachAIReviewDays', 5),
    aiRange: (g: Galaxy) => scenarioParam(g, 'beachAIRange', 8000),
    aiValuePct: (g: Galaxy) => scenarioParam(g, 'beachAIValuePct', 12),
    aiTroopPct: (g: Galaxy) => scenarioParam(g, 'beachAITroopPct', 70),
    aiOrbitRatio: (g: Galaxy) => scenarioParam(g, 'beachAIOrbitRatio', 3),
    aiDamagedPct: (g: Galaxy) => scenarioParam(g, 'beachAIDamagedPct', 40),
    aiMaxLossPct: (g: Galaxy) => scenarioParam(g, 'beachAIMaxLossPct', 10),
    aiMaxLossCapitalPct: (g: Galaxy) => scenarioParam(g, 'beachAIMaxLossCapitalPct', 16),
    aiCooldownDays: (g: Galaxy) => scenarioParam(g, 'beachAICooldownDays', 30),
    aiCleanupFundsFactor: (g: Galaxy) => scenarioParam(g, 'beachAICleanupFundsFactor', 3),
};
const P = BEACH_PARAMS;

/** A colony's beaching scar. */
export interface ColonyScar {
    /** Base quality before the first beaching of the present scar. */
    base0: number;
    /** Base-quality units lost (and not yet cleaned up). */
    lost: number;
    /** The cleanup under way. */
    cleanup?: { owner: number; total: number; left: number; perDay: number; started: number; cost: number };
    /** Star date of the last AI beaching here (the cooldown). */
    lastAi?: number;
}

export interface BeachingStats {
    /** Ships beached, by who ordered it. */
    human: number;
    ai: number;
    /** ...of which AI beachings on a capital. */
    aiCapital: number;
    /** Quality lost to AI beachings, in % of the colonies' base quality (sum). */
    aiLossPct: number;
    /** Cleanups started, by who. */
    humanCleanups: number;
    aiCleanups: number;
    /** Beached hulks destroyed in space / lost with a conquered colony. */
    destroyed: number;
    conquered: number;
    /** Colonies with a beached ship that were invaded (troops landed) / lost afterwards. */
    invaded: number;
    invadedHeld: number;
    invadedLost: number;
    /** AI review outcomes (considered, notValuable, noInvasion, orbitOk, noShip, cooldown, lossCap, beached). */
    reviews: Record<string, number>;
}

export interface BeachingState {
    /** Every beached ship (pruned daily). */
    ships: BuiltObject[];
    /** The colonies' scars. */
    colonies: Map<Habitat, ColonyScar>;
    /** Colonies with a beached ship where a ground battle began (statistics): colony → the owner's empire id. */
    battles: Map<Habitat, number>;
    lastAiReview: number;
    stats: BeachingStats;
}

/** The state, created on first use (scenario code and tests). */
export function beachingState(galaxy: Galaxy): BeachingState {
    return scenarioState<BeachingState>(galaxy, KEY, () => ({
        ships: [],
        colonies: new Map(),
        battles: new Map(),
        lastAiReview: -1,
        stats: { human: 0, ai: 0, aiCapital: 0, aiLossPct: 0, humanCleanups: 0, aiCleanups: 0, destroyed: 0, conquered: 0, invaded: 0, invadedHeld: 0, invadedLost: 0, reviews: {} },
    }));
}

/** The state if it exists (never creates it). */
export function peekBeachingState(galaxy: Galaxy): BeachingState | null {
    return galaxy.scenario === null ? null : ((galaxy.scenario.state[KEY] as BeachingState | undefined) ?? null);
}

export function beachingOn(galaxy: Galaxy): boolean {
    const s = galaxy.scenario;
    return s !== null && s.flags[BEACHING_FLAG] === true;
}

function dist(a: { xpos: number; ypos: number }, x: number, y: number): number {
    return Math.hypot(a.xpos - x, a.ypos - y);
}

// ---------------------------------------------------------------------------------------------------------------
// The numbers
// ---------------------------------------------------------------------------------------------------------------

/** The quality a ship of `size` costs its colony, in % of the colony's base quality before the scar. */
export function beachLossPct(galaxy: Galaxy, size: number): number {
    const lo = P.sizeSmall(galaxy);
    const hi = Math.max(lo + 1, P.sizeLarge(galaxy));
    const t = Math.min(1, Math.max(0, (size - lo) / (hi - lo)));
    return P.lossSmallPct(galaxy) + (P.lossLargePct(galaxy) - P.lossSmallPct(galaxy)) * t;
}

const CREW_LEVELS = ['green', 'average', 'experienced', 'veteran', 'elite', 'legendary'];

/** The defend strength of the crew `ship` would put ashore (a Troop.defendStrength, 1..30000). */
export function beachCrewStrength(galaxy: Galaxy, ship: BuiltObject): number {
    const level = Math.max(0, CREW_LEVELS.indexOf(calculateCrewLevel(ship)));
    const k = Math.max(0.1, 1 + ((level - 1) * P.crewStepPct(galaxy)) / 100);
    const parts = ship.components?.items?.length ?? 0;
    const hurt = parts > 0 ? Math.min(1, ship.damagedComponentCount / parts) : 0;
    const raw = (ship.size * P.defendPerSize(galaxy) + ship.armor * P.defendPerArmor(galaxy)) * k * (1 - 0.5 * hurt);
    return Math.min(30000, Math.max(1, Math.trunc(raw)));
}

/** A colony's scar, if it has one. */
export function scarOf(galaxy: Galaxy, h: Habitat): ColonyScar | undefined {
    return peekBeachingState(galaxy)?.colonies.get(h);
}

/** The ships beached on `h` (alive). */
export function beachedAt(galaxy: Galaxy, h: Habitat): BuiltObject[] {
    const st = peekBeachingState(galaxy);
    if (st === null) return [];
    return st.ships.filter((b) => b.beached !== undefined && b.beached.colony === h && !b.hasBeenDestroyed);
}

/** The colony's lost quality in % of its base quality before the scar (0 without a scar). */
export function scarPct(galaxy: Galaxy, h: Habitat): number {
    const s = scarOf(galaxy, h);
    return s === undefined || s.base0 <= 0 ? 0 : (s.lost / s.base0) * 100;
}

/** The empire has the terraforming technology (a buildable Terraforming Facility). */
export function hasTerraformingTech(empire: Empire): boolean {
    const list = empire.research?.buildablePlanetaryFacilities;
    if (list === undefined || list === null) return false;
    for (const f of list) if (f != null && facilityType(f) === PlanetaryFacilityType.TerraformingFacility) return true;
    return false;
}

/** What the cleanup of `h`'s scar would cost now. */
export function cleanupCost(galaxy: Galaxy, h: Habitat): number {
    return Math.round(P.cleanupCostPerPct(galaxy) * scarPct(galaxy, h));
}

// ---------------------------------------------------------------------------------------------------------------
// Placing the hull
// ---------------------------------------------------------------------------------------------------------------

/** Heading toward the planet from each diagonal slot (atan2 of the inward direction; constants, no trig). */
const SLOT_HEADING = [-2.356194490192345, -0.7853981633974483, 0.7853981633974483, 2.356194490192345];
const SLOT_SIGN: readonly (readonly [number, number])[] = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
const SQRT_HALF = 0.7071067811865476;

function slotPoint(h: Habitat, size: number, slot: number): { x: number; y: number } {
    const r = (h.diameter / 2 + Math.sqrt(Math.max(0, size) * 32) / 2 + 10) * SQRT_HALF;
    const [sx, sy] = SLOT_SIGN[slot % 4];
    return { x: h.xpos + sx * r, y: h.ypos + sy * r };
}

/** Puts a beached ship on its slot, stopped (it follows the planet along its orbit). */
function placeHull(galaxy: Galaxy, bo: BuiltObject): void {
    const b = bo.beached;
    if (b === undefined) return;
    const p = slotPoint(b.colony, bo.size, b.slot);
    if (bo.xpos !== p.x || bo.ypos !== p.y) {
        // The spatial index follows the move (the stock tick re-registers from the position it is given as the old one).
        const ix = galaxy.resolveIndexX(bo.xpos);
        const iy = galaxy.resolveIndexY(bo.ypos);
        bo.xpos = p.x;
        bo.ypos = p.y;
        updateIndexesForMovement(galaxy, bo, ix, iy, false);
    }
    const hf = Math.fround(SLOT_HEADING[b.slot % 4]);
    if (bo.heading !== hf) bo.heading = hf;
    bo.targetHeading = hf;
    bo.targetSpeed = 0;
    bo.preferredSpeed = 0;
    bo.currentSpeed = 0;
}

let ownOrder = false;

/** assignMissionAllowed (BuiltObject.2.cs 7620): a beached ship takes no mission (but our own Hold). Pure. */
function missionAllowed(_galaxy: Galaxy, value: boolean, args: { builtObject: BuiltObject; missionType: number }): boolean {
    if (!value || ownOrder) return value;
    return args.builtObject.beached === undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// Beaching
// ---------------------------------------------------------------------------------------------------------------

export interface BeachResult {
    ok: boolean;
    message: string;
}

/** The own colony nearest to `ship` within beachRange (population on it), or null. */
export function beachColonyFor(galaxy: Galaxy, empire: Empire, ship: BuiltObject): Habitat | null {
    const range = P.range(galaxy);
    let best: Habitat | null = null;
    let bestD = range;
    for (const h of empire.colonies) {
        if (h === null || h.hasBeenDestroyed || h.empire !== empire || h.population === null || h.population.totalAmount <= 0) continue;
        const d = dist(h, ship.xpos, ship.ypos);
        if (d <= bestD) {
            bestD = d;
            best = h;
        }
    }
    return best;
}

/** Why `ship` cannot be beached on `colony` (null: it can). Pure. */
export function beachUnavailableReason(galaxy: Galaxy, empire: Empire, ship: BuiltObject, colony: Habitat | null): string | null {
    if (!beachingOn(galaxy)) return 'Beached ships is not on in this game';
    if (ship.empire !== empire || ship.hasBeenDestroyed) return 'Not your ship';
    if (ship.role !== BuiltObjectRole.Military) return 'Only warships can be beached';
    if (ship.beached !== undefined) return 'Already beached';
    if (ship.builtAt !== null || ship.retrofitDesign !== null) return 'The ship is under construction or refit';
    if (ship.mothball !== undefined) return 'The ship is mothballed';
    if (colony === null) return 'No colony of yours is near enough';
    if (colony.empire !== empire) return 'Not your colony';
    if (dist(colony, ship.xpos, ship.ypos) > P.range(galaxy)) return 'The ship is too far from the colony';
    if (beachedAt(galaxy, colony).length >= P.maxShips(galaxy)) return `${colony.name} already has ${P.maxShips(galaxy)} beached ships`;
    return null;
}

/** The scar the next beaching of `ship` on `colony` would add, in base-quality units (the cap applied). */
function nextLossUnits(galaxy: Galaxy, colony: Habitat, ship: BuiltObject): number {
    const s = scarOf(galaxy, colony);
    const base0 = s !== undefined && s.lost > 1e-9 ? s.base0 : colony.baseQuality;
    const lost = s !== undefined && s.lost > 1e-9 ? s.lost : 0;
    const want = (base0 * beachLossPct(galaxy, ship.size)) / 100;
    const room = (base0 * P.maxLossPct(galaxy)) / 100 - lost;
    return Math.max(0, Math.min(want, room, Math.max(0, colony.baseQuality - 0.01)));
}

/** The quality (% of the colony's base before the scar) the next beaching of `ship` would cost, with the cap applied. */
export function beachPreviewPct(galaxy: Galaxy, colony: Habitat, ship: BuiltObject): number {
    const s = scarOf(galaxy, colony);
    const base0 = s !== undefined && s.lost > 1e-9 ? s.base0 : colony.baseQuality;
    return base0 > 0 ? (nextLossUnits(galaxy, colony, ship) / base0) * 100 : 0;
}

/**
 * Beaches `ship` on `colony` (null: the nearest own colony in range). The one door for the player's order and the AI.
 * Rnd: none.
 */
export function beachShip(galaxy: Galaxy, empire: Empire, ship: BuiltObject, colony: Habitat | null, by: 'human' | 'ai'): BeachResult {
    const h = colony ?? beachColonyFor(galaxy, empire, ship);
    const why = beachUnavailableReason(galaxy, empire, ship, h);
    if (why !== null || h === null) return { ok: false, message: why ?? 'No colony' };
    const st = beachingState(galaxy);
    const now = galaxyStarDate(galaxy);
    // The scar.
    let scar = st.colonies.get(h);
    if (scar === undefined) {
        scar = { base0: h.baseQuality, lost: 0 };
        st.colonies.set(h, scar);
    } else if (scar.lost <= 1e-9) {
        scar.base0 = h.baseQuality;
        scar.lost = 0;
    }
    const units = nextLossUnits(galaxy, h, ship);
    scar.lost += units;
    h.baseQuality = Math.fround(h.baseQuality - units);
    // The crew joins the garrison.
    const strength = beachCrewStrength(galaxy, ship);
    const crew = new Troop(`${ship.name} crew`, TroopType.Armored, Math.max(1, Math.trunc(strength / 4)), strength, 200, 100, empire, empire.dominantRace);
    crew.maintenanceMultiplier = 0;
    crew.colony = h;
    crew.garrisoned = true;
    crew.beached = true;
    if (h.troops === null) h.troops = new TroopList();
    h.troops.add(crew);
    if (empire.troops != null) empire.troops.add(crew);
    // The hull.
    const used = new Set<number>();
    for (const b of beachedAt(galaxy, h)) used.add(b.beached!.slot);
    let slot = 0;
    while (used.has(slot) && slot < 3) slot++;
    const auto = ship.isAutoControlled;
    if (ship.shipGroup !== null) leaveShipGroup(galaxy, ship);
    ship.beached = { colony: h, since: now, slot, crew, lossUnits: units, auto };
    ship.isAutoControlled = false;
    ownOrder = true;
    try {
        assignMission(galaxy, ship, BuiltObjectMissionType.Hold, null, null, BuiltObjectMissionPriority.High, { manuallyAssigned: by === 'human', starDate: now + 1000 * 360 * GAME_DAY_LENGTH });
    } finally {
        ownOrder = false;
    }
    placeHull(galaxy, ship);
    if (!st.ships.includes(ship)) st.ships.push(ship);
    const pct = base0Pct(units, scar);
    if (by === 'human') st.stats.human++;
    else {
        st.stats.ai++;
        if (empire.capital === h) st.stats.aiCapital++;
        st.stats.aiLossPct += pct;
    }
    const text = `${ship.name} is beached on ${h.name}: its crew (${strength}) joins the garrison and its guns defend the orbit; ${h.name}'s quality falls by ${pct.toFixed(1)}%.`;
    if (isHumanEmpire(galaxy, empire)) scenarioMessage(galaxy, empire, 'Ship beached', text, { subject: h, type: EmpireMessageType.GeneralWarning });
    return { ok: true, message: text };
}

function base0Pct(units: number, scar: ColonyScar): number {
    return scar.base0 > 0 ? (units / scar.base0) * 100 : 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------------------------------------------

/** Why the cleanup of `h`'s scar cannot be ordered by `empire` (null: it can). Pure. */
export function cleanupUnavailableReason(galaxy: Galaxy, empire: Empire, h: Habitat): string | null {
    if (!beachingOn(galaxy)) return 'Beached ships is not on in this game';
    if (h.empire !== empire) return 'Not your colony';
    const s = scarOf(galaxy, h);
    if (s === undefined || s.lost <= 1e-9) return 'No beaching damage to clean up';
    if (s.cleanup !== undefined) return 'A cleanup is already under way';
    if (!hasTerraformingTech(empire)) return 'Cleaning up needs the terraforming technology';
    const cost = cleanupCost(galaxy, h);
    if (empire.stateMoney < cost) return `Not enough money (${cost} credits)`;
    return null;
}

/** Starts the cleanup of `h`'s scar (the player's order and the AI's). */
export function startCleanup(galaxy: Galaxy, empire: Empire, h: Habitat, by: 'human' | 'ai'): BeachResult {
    const why = cleanupUnavailableReason(galaxy, empire, h);
    if (why !== null) return { ok: false, message: why };
    const s = scarOf(galaxy, h)!;
    const cost = cleanupCost(galaxy, h);
    empire.stateMoney -= cost;
    const days = Math.max(1, P.cleanupDays(galaxy));
    s.cleanup = { owner: empire.empireId, total: s.lost, left: s.lost, perDay: s.lost / days, started: galaxyStarDate(galaxy), cost };
    const st = beachingState(galaxy);
    if (by === 'human') st.stats.humanCleanups++;
    else st.stats.aiCleanups++;
    const text = `Cleaning up the beaching damage on ${h.name}: ${scarPct(galaxy, h).toFixed(1)}% quality back over ${Math.round(days)} days, ${cost} credits.`;
    if (isHumanEmpire(galaxy, empire)) scenarioMessage(galaxy, empire, 'Cleanup begun', text, { subject: h, type: EmpireMessageType.GeneralGoodEvent, popup: false });
    return { ok: true, message: text };
}

/** Progress of the cleanup under way, 0..1 (null: none). */
export function cleanupProgress(galaxy: Galaxy, h: Habitat): number | null {
    const c = scarOf(galaxy, h)?.cleanup;
    return c === undefined ? null : c.total > 0 ? Math.min(1, Math.max(0, 1 - c.left / c.total)) : 1;
}

function stepCleanup(galaxy: Galaxy, st: BeachingState, h: Habitat, s: ColonyScar, days: number): void {
    const c = s.cleanup;
    if (c === undefined) return;
    if (h.hasBeenDestroyed || h.empire === null || h.empire.empireId !== c.owner) {
        delete s.cleanup; // the colony changed hands: the work stops
        return;
    }
    const step = Math.min(c.perDay * days, c.left, s.lost);
    if (step > 0) {
        h.baseQuality = Math.fround(h.baseQuality + step);
        s.lost -= step;
        c.left -= step;
    }
    if (c.left <= 1e-9 || s.lost <= 1e-9) {
        delete s.cleanup;
        if (s.lost <= 1e-9) s.lost = 0;
        if (isHumanEmpire(galaxy, h.empire)) scenarioMessage(galaxy, h.empire, 'Cleanup finished', `${h.name}'s beaching damage is cleaned up.`, { subject: h, type: EmpireMessageType.GeneralGoodEvent, popup: false });
    }
    void st;
}

// ---------------------------------------------------------------------------------------------------------------
// Text for the colony info panel
// ---------------------------------------------------------------------------------------------------------------

/** "Beached: 2 ships (−9% quality), cleanup 40%" for the colony info panel (null: nothing beached, no scar). */
export function beachedInfoLine(galaxy: Galaxy, h: Habitat, viewer: Empire | null): string | null {
    const s = scarOf(galaxy, h);
    const ships = beachedAt(galaxy, h).length;
    if (s === undefined || (ships === 0 && s.lost <= 1e-9)) return null;
    const pct = scarPct(galaxy, h);
    let line = ships > 0 ? `Beached: ${ships} ship${ships === 1 ? '' : 's'}` : 'Beached: no ships left';
    if (pct > 0.05) line += ` (−${Math.round(pct)}% quality)`;
    const prog = cleanupProgress(galaxy, h);
    if (prog !== null) line += `, cleanup ${Math.round(prog * 100)}%`;
    else if (pct > 0.05 && viewer !== null && h.empire === viewer && hasTerraformingTech(viewer)) line += `, cleanup costs ${formatCredits(cleanupCost(galaxy, h))}`;
    return line;
}

function formatCredits(n: number): string {
    return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n);
}

// ---------------------------------------------------------------------------------------------------------------
// Daily upkeep of the package
// ---------------------------------------------------------------------------------------------------------------

function removeCrew(bo: BuiltObject): void {
    const b = bo.beached;
    if (b === undefined || b.crew === null) return;
    b.colony.troops?.remove(b.crew);
    const e = b.crew.empire as Empire | null;
    if (e !== null && e.troops != null && e.troops.contains(b.crew)) e.troops.remove(b.crew);
    b.crew = null;
}

function processDaily(galaxy: Galaxy, now: number): void {
    const st = beachingState(galaxy);
    const alive: BuiltObject[] = [];
    for (const b of st.ships) {
        const bd = b.beached;
        if (bd === undefined) continue;
        if (b.hasBeenDestroyed || b.empire === null) {
            // A hull destroyed in orbit: its crew goes with it, the scar stays.
            removeCrew(b);
            delete b.beached;
            st.stats.destroyed++;
            continue;
        }
        const h = bd.colony;
        if (!st.battles.has(h) && groundBattleOn(h)) {
            st.battles.set(h, b.empire.empireId);
            st.stats.invaded++;
        }
        if (h.hasBeenDestroyed || h.empire !== b.empire) {
            // The colony fell: the hull goes with it.
            removeCrew(b);
            if (isHumanEmpire(galaxy, b.empire)) scenarioMessage(galaxy, b.empire, 'Beached ship lost', `${b.name}, beached on ${h.name}, is lost with the colony.`, { subject: h, type: EmpireMessageType.GeneralBadEvent });
            delete b.beached;
            st.stats.conquered++;
            builtObjectCompleteTeardown(galaxy, b);
            continue;
        }
        // The crew keeps its mark; one that was killed is not replaced.
        if (bd.crew !== null && (h.troops === null || !h.troops.contains(bd.crew))) bd.crew = null;
        alive.push(b);
    }
    st.ships = alive;
    // Statistics: a ground battle that began on a colony with a beached ship is held or lost when it ends.
    for (const [h, owner] of [...st.battles]) {
        if (groundBattleOn(h)) continue;
        st.battles.delete(h);
        if (!h.hasBeenDestroyed && h.empire !== null && h.empire.empireId === owner) st.stats.invadedHeld++;
        else st.stats.invadedLost++;
    }
    // Cleanups.
    for (const [h, s] of st.colonies) {
        if (s.cleanup !== undefined) stepCleanup(galaxy, st, h, s, 1);
        if (s.lost <= 1e-9 && s.cleanup === undefined && s.lastAi === undefined && !alive.some((b) => b.beached!.colony === h)) st.colonies.delete(h);
    }
    if (st.lastAiReview < 0) st.lastAiReview = now;
    else if (now - st.lastAiReview >= P.aiReviewDays(galaxy) * GAME_DAY_LENGTH) {
        st.lastAiReview = now;
        if (galaxy.scenario !== null && galaxy.scenario.flags[BEACHING_AI_FLAG] === true) reviewAll(galaxy, now);
    }
}

/** The hulks follow their planet along its orbit every few game hours. */
function followPlanets(galaxy: Galaxy): void {
    const st = peekBeachingState(galaxy);
    if (st === null) return;
    for (const b of st.ships) if (b.beached !== undefined && !b.hasBeenDestroyed) placeHull(galaxy, b);
}

// ---------------------------------------------------------------------------------------------------------------
// AI: a very, very last resort
// ---------------------------------------------------------------------------------------------------------------

function aiEmpire(galaxy: Galaxy, e: Empire): boolean {
    return e.active && e.pirateEmpireBaseHabitat === null && e !== galaxy.independentEmpire && !isHumanEmpire(galaxy, e);
}

function count(st: BeachingState, key: string): void {
    st.stats.reviews[key] = (st.stats.reviews[key] ?? 0) + 1;
}

/** `other` is hostile to `e`: at war with it, or a pirate faction. */
function hostileTo(e: Empire, other: Empire | null): boolean {
    if (other === null || other === e) return false;
    if (other.pirateEmpireBaseHabitat !== null) return true;
    for (const r of e.diplomaticRelations.toArray()) if (r.otherEmpire === other) return r.type === DiplomaticRelationType.War;
    return false;
}

export interface BeachThreat {
    /** Hostile troops landed on the colony plus hostile troop ships within range: their attack strength. */
    attackers: number;
    /** The colony's defending strength (stock total, readiness included). */
    defence: number;
    /** Hostile armed ships within orbit range / the empire's own firepower there. */
    enemyFirepower: number;
    ownFirepower: number;
    /** Hostile ships within the AI range. */
    hostileNear: number;
}

/** What threatens `h` now. Read-only. */
export function beachThreat(galaxy: Galaxy, e: Empire, h: Habitat): BeachThreat {
    let attackers = h.invadingTroops !== null ? h.invadingTroops.totalAttackStrength : 0;
    let enemyFirepower = 0;
    let ownFirepower = 0;
    let hostileNear = 0;
    const near = getNearbyBuiltObjects(galaxy, h.xpos, h.ypos, P.aiRange(galaxy));
    for (const b of near) {
        if (b == null || b.hasBeenDestroyed) continue;
        const owner = b.empire;
        const d = dist(b, h.xpos, h.ypos);
        if (owner === e) {
            if (d <= 2000 && b.firepowerRaw > 0) ownFirepower += b.firepowerRaw;
            continue;
        }
        if (!hostileTo(e, owner)) continue;
        hostileNear++;
        if (b.troops !== null && b.troops !== undefined && b.troops.count > 0) attackers += b.troops.totalAttackStrength;
        if (b.firepowerRaw > 0) enemyFirepower += b.firepowerRaw;
    }
    return { attackers, defence: h.troops !== null ? h.troops.totalDefendStrength : 0, enemyFirepower, ownFirepower, hostileNear };
}

/** The ship cannot get away: no hyperdrive, no engines, no fuel. */
export function cannotEscape(bo: BuiltObject): boolean {
    return !bo.canHyperJump || bo.topSpeed <= 0 || (bo.fuelCapacity > 0 && bo.currentFuel <= 0);
}

/** The share of the ship's parts that are damaged, 0..1. */
export function damagedShare(bo: BuiltObject): number {
    const parts = bo.components?.items?.length ?? 0;
    return parts > 0 ? Math.min(1, bo.damagedComponentCount / parts) : 0;
}

/** Colonies' share of the empire's population. */
function popShare(e: Empire, h: Habitat): number {
    let total = 0;
    for (const c of e.colonies) if (c !== null && !c.hasBeenDestroyed && c.population !== null) total += c.population.totalAmount;
    return total > 0 && h.population !== null ? h.population.totalAmount / total : 0;
}

/** AI: which ships (0..2) to beach on `h`, with the threat; empty when it is not the very last resort. */
export function aiBeachChoice(galaxy: Galaxy, e: Empire, h: Habitat, st: BeachingState | null, now: number): BuiltObject[] {
    const note = (k: string): void => {
        if (st !== null) count(st, k);
    };
    note('considered');
    const capital = e.capital === h;
    if (!capital && popShare(e, h) * 100 < P.aiValuePct(galaxy)) {
        note('notValuable');
        return [];
    }
    const t = beachThreat(galaxy, e, h);
    if (t.attackers <= 0 || t.attackers < (t.defence * P.aiTroopPct(galaxy)) / 100) {
        note('noInvasion');
        return [];
    }
    if (t.enemyFirepower < Math.max(1, t.ownFirepower) * P.aiOrbitRatio(galaxy)) {
        note('orbitOk');
        return [];
    }
    const scar = scarOf(galaxy, h);
    if (scar?.lastAi !== undefined && now - scar.lastAi < P.aiCooldownDays(galaxy) * GAME_DAY_LENGTH) {
        note('cooldown');
        return [];
    }
    // Candidates: warships of its own at the colony that cannot get away or are badly damaged; the smallest first.
    const badly = P.aiDamagedPct(galaxy) / 100;
    const cands: BuiltObject[] = [];
    for (const b of getNearbyBuiltObjects(galaxy, h.xpos, h.ypos, P.range(galaxy))) {
        if (b == null || b.empire !== e || beachUnavailableReason(galaxy, e, b, h) !== null) continue;
        if (b.firepowerRaw <= 0) continue;
        if (cannotEscape(b) || damagedShare(b) >= badly) cands.push(b);
    }
    if (cands.length === 0) {
        note('noShip');
        return [];
    }
    cands.sort((a, b) => damagedShare(b) - damagedShare(a) || a.size - b.size || a.builtObjectID - b.builtObjectID);
    const limit = capital ? P.aiMaxLossCapitalPct(galaxy) : P.aiMaxLossPct(galaxy);
    let lossPct = scarPct(galaxy, h);
    const wanted = capital && t.attackers >= 2 * Math.max(1, t.defence) ? 2 : 1;
    const picked: BuiltObject[] = [];
    for (const b of cands) {
        if (picked.length >= wanted) break;
        const add = beachPreviewPct(galaxy, h, b);
        if (lossPct + add > limit) continue;
        picked.push(b);
        lossPct += add;
    }
    if (picked.length === 0) note('lossCap');
    return picked;
}

export function reviewBeachingEmpire(galaxy: Galaxy, st: BeachingState, e: Empire, now: number): void {
    // Only at war (or with pirates about) is there anything to weigh.
    let hostile = false;
    for (const r of e.diplomaticRelations.toArray()) if (r.type === DiplomaticRelationType.War) hostile = true;
    if (!hostile) {
        for (const p of galaxy.pirateEmpires) if (p !== null && p !== undefined && p.active) hostile = true;
    }
    for (const h of e.colonies.slice()) {
        if (h === null || h.hasBeenDestroyed || h.empire !== e || h.population === null) continue;
        const scar = st.colonies.get(h);
        // Cleanup when quiet and affordable.
        if (scar !== undefined && scar.lost > 1e-9 && scar.cleanup === undefined && hasTerraformingTech(e)) {
            const cost = cleanupCost(galaxy, h);
            if (e.stateMoney >= cost * P.aiCleanupFundsFactor(galaxy) && beachThreat(galaxy, e, h).hostileNear === 0) {
                startCleanup(galaxy, e, h, 'ai');
                continue;
            }
        }
        if (!hostile) continue;
        // The cheap tests first: landed or arriving hostile troops decide whether anything is weighed at all.
        if (h.invadingTroops === null || h.invadingTroops.count === 0) {
            let any = false;
            for (const b of getNearbyBuiltObjects(galaxy, h.xpos, h.ypos, P.aiRange(galaxy))) {
                if (b != null && !b.hasBeenDestroyed && b.empire !== e && b.troops != null && b.troops.count > 0 && hostileTo(e, b.empire)) {
                    any = true;
                    break;
                }
            }
            if (!any) continue;
        }
        const ships = aiBeachChoice(galaxy, e, h, st, now);
        for (const b of ships) {
            const r = beachShip(galaxy, e, b, h, 'ai');
            if (r.ok) {
                count(st, 'beached');
                let s = st.colonies.get(h);
                if (s === undefined) {
                    s = { base0: h.baseQuality, lost: 0 };
                    st.colonies.set(h, s);
                }
                s.lastAi = now;
            }
        }
    }
}

function reviewAll(galaxy: Galaxy, now: number): void {
    const st = beachingState(galaxy);
    for (const e of galaxy.empires) {
        if (e === null || e === undefined || !aiEmpire(galaxy, e)) continue;
        reviewBeachingEmpire(galaxy, st, e, now);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------------------------

registerScenarioQuery({
    id: 'beaching.upkeep',
    flag: BEACHING_FLAG,
    query: 'shipMaintenanceFactor',
    run: (g, v, a) => (a.builtObject.beached !== undefined ? (v * P.upkeepPct(g)) / 100 : v),
});
registerScenarioQuery({ id: 'beaching.missions', flag: BEACHING_FLAG, query: 'assignMissionAllowed', run: missionAllowed });
registerScenarioFramePeriodic({ id: 'beaching.daily', flag: BEACHING_FLAG, periodDays: 1, run: processDaily });
registerScenarioFramePeriodic({ id: 'beaching.follow', flag: BEACHING_FLAG, periodDays: 0.05, run: followPlanets });
registerScenarioEvent({
    id: 'beaching.removed',
    flag: BEACHING_FLAG,
    event: 'builtObjectRemoved',
    run: (_g, p) => {
        if (p.builtObject.beached !== undefined) removeCrew(p.builtObject);
    },
});

// The player's orders (ShipActionType.ScenarioThreatAction, extraData = the kind): Beach on colony (target: the ship) and
// Clean up beaching damage (target: the colony). Both run at the command boundary, journaled with the shipAction command.
registerThreatAction(BEACH_ACTION, {
    available: (g, e, t) => beachingOn(g) && isShip(t) && t.empire === e && beachUnavailableReason(g, e, t, beachColonyFor(g, e, t)) === null,
    run: (g, e, t) => {
        if (!isShip(t)) return false;
        const r = beachShip(g, e, t, null, 'human');
        if (!r.ok && isHumanEmpire(g, e)) scenarioMessage(g, e, 'Cannot beach', r.message, { popup: false });
        return r.ok;
    },
    label: () => 'Beach on colony',
});
registerThreatAction(CLEANUP_ACTION, {
    available: (g, e, t) => beachingOn(g) && isColony(t) && t.empire === e && scarPct(g, t) > 0.05 && scarOf(g, t)?.cleanup === undefined,
    run: (g, e, t) => {
        if (!isColony(t)) return false;
        const r = startCleanup(g, e, t, 'human');
        if (!r.ok && isHumanEmpire(g, e)) scenarioMessage(g, e, 'Cannot clean up', r.message, { subject: t, popup: false });
        return r.ok;
    },
    label: () => 'Clean up beaching damage',
});

function isShip(t: unknown): t is BuiltObject {
    return typeof t === 'object' && t !== null && 'role' in t && 'firepowerRaw' in t && (t as BuiltObject).role !== BuiltObjectRole.Base;
}
function isColony(t: unknown): t is Habitat {
    return typeof t === 'object' && t !== null && 'population' in t && 'baseQuality' in t;
}
