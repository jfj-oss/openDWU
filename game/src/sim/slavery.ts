// Slavery (scenarios/slavery, a standalone add-on; docs/DARK_THEMES.md §1). Not a port. With the add-on on it
// OVERWRITES DW:U 1.9.5's own enslavement, built on its pieces:
//   - the switch is the stock empire policy "Use Penal Colonies to implement 'Enslave' policy"
//     (EmpirePolicy.implementEnslavementWithPenalColonies);
//   - who is enslaved is the stock per-colony population policy (ColonyPopulationPolicy.Enslave, for the race family
//     or all other races);
//   - the penal colonies are the stock Empire.penalColonies list; the stock auto-selection (colonyTick.ts
//     identifyBestNewPenalColonies, cap 5, and its Enslave → Resettle reset) and the stock SlaveryBonusFactor income
//     are gated off (colonyTick.ts reviewColonyPopulationPolicy) and replaced by this module and slaveryReview.ts. The
//     stock slaveryOffense diplomacy line stays.
// With the add-on off nothing here runs (every stock hook checks Habitat.slavery / Empire.slavery, which only the
// add-on's review creates), so the stock enslavement is untouched.
//
// A PENAL COLONY (one on the stock list, adopted by the add-on: Habitat.slavery):
//   - WORKERS are its people under the Enslave population policy. The STAFFING share is workers / target workers
//     (PENAL_TARGET_SHARE of the planet's maximum population, clamped to PENAL_TARGET_MIN..MAX);
//   - its luxury and restricted ("rare") extraction is × (1 + (PENAL_RESOURCE_MAX_FACTOR − 1) × staffing), up to ×6
//     (industry.ts extractResources), and its tax × (1 + (PENAL_TAX_MAX_FACTOR − 1) × staffing), up to ×2
//     (forceStructure.ts recalculateAnnualTaxRevenue): an unstaffed penal colony earns little more than a free one;
//   - its approval −PENAL_APPROVAL_PENALTY, and the empire's other colonies of an enslaved race −PENAL_KIN_APPROVAL_PENALTY
//     (taxes.ts empireApprovalRatingStock);
//   - unrest that grows with the years it has been a penal colony and is held down only by a garrison scaled by its
//     workers (penalGarrisonRequired, which troops.ts troopLevelRequired raises the garrison target to); the unrest the
//     garrison cannot hold enters the stock revolt check (colonyTick.ts checkSatisfaction), so an under-garrisoned
//     penal colony rebels (militia, no extraction) and, with its troops gone, breaks away (stock leaveEmpire);
//   - workers die off by PENAL_WORKER_DEATH_PER_YEAR and are resupplied by labour convoys of enslaved people from the
//     empire's other colonies (slaveryReview.ts; the source colonies lose them).
//
// This module holds the pure helpers the stock code reads (no imports of the stock modules, so no cycles); the review
// (AI choice, designations, convoys, the reputation stain) is slaveryReview.ts. Rnd: none. State: the `slavery` fields
// below on Empire / Habitat / BuiltObject (`declare`d, absent until the add-on uses them).

import type { Galaxy } from './galaxy';
import type { Empire } from './empire';
import type { Habitat } from './types';
import type { BuiltObject } from './builtObject';
import { YEAR_LENGTH } from './galaxyTime';
import { galaxyStarDate } from './tick/simTime';
import { ResourceGroup, resourceGroupOf } from './resourceSystem';
import { ColonyPopulationPolicy } from './data/policies';
import type { Race } from './data/races';

/** Every number of the policy (docs/DARK_THEMES.md §1 lists them). */
export const SLAVERY_PARAMS = {
    /** Luxury and restricted extraction at a fully staffed penal colony (1 + (this − 1) × staffing). */
    PENAL_RESOURCE_MAX_FACTOR: 6,
    /** Tax at a fully staffed penal colony (1 + (this − 1) × staffing). */
    PENAL_TAX_MAX_FACTOR: 2,
    /** Target workers: this share of the planet's maximum population... */
    PENAL_TARGET_SHARE: 0.25,
    /** ...clamped to this range (people). */
    PENAL_TARGET_MIN: 50_000_000,
    PENAL_TARGET_MAX: 400_000_000,
    /** Workers lost a year to the conditions (a share of the workers; Voidbloom worlds lose far more). */
    PENAL_WORKER_DEATH_PER_YEAR: 0.05,
    /** Approval at the penal colony itself. */
    PENAL_APPROVAL_PENALTY: 10,
    /** Approval at the owner's other colonies whose dominant race is enslaved somewhere. */
    PENAL_KIN_APPROVAL_PENALTY: 4,
    /** Unrest (approval points in the revolt check) of a new penal colony with no garrison... */
    PENAL_UNREST_BASE: 12,
    /** ...growing by this much a year... */
    PENAL_UNREST_GROWTH_PER_YEAR: 4,
    /** ...up to this. */
    PENAL_UNREST_MAX: 40,
    /** Garrison (troop defend strength, the units of COLONY_MAXIMUM_TROOP_STRENGTH) a penal colony needs: this much... */
    PENAL_GARRISON_BASE: 40_000,
    /** ...plus this per billion workers... */
    PENAL_GARRISON_PER_BILLION: 300_000,
    /** ...times (1 + this × years as a penal colony), at most PENAL_GARRISON_GROWTH_CAP. */
    PENAL_GARRISON_GROWTH_PER_YEAR: 0.1,
    PENAL_GARRISON_GROWTH_CAP: 2,
    /** Labour convoy: people per ship, cost to the state, and game days between two convoys to one colony. */
    PENAL_CONVOY_SIZE: 20_000_000,
    PENAL_CONVOY_COST: 4000,
    PENAL_CONVOY_INTERVAL_DAYS: 20,
    /** A source colony keeps at least this share of each non-dominant people it holds. */
    PENAL_SOURCE_KEEP_SHARE: 0.3,
    /** Attitude lost per year and per penal colony by every empire that does not allow slavery. */
    REPUTATION_STAIN_PER_YEAR: 6,
    /** AI: adopts the policy at this species + government score or more (slaveryReview.ts aiSlaveryScore). */
    AI_ADOPT_SCORE: 2,
    /** AI: at most this many penal colonies. */
    AI_MAX_PENAL_COLONIES: 3,
    /** AI: a candidate holds at least this summed abundance of luxury / restricted resources... */
    AI_MIN_RESOURCE_ABUNDANCE: 30,
    /** ...and the empire can staff it (workers there + enslavable people elsewhere not yet promised) to this share of the target. */
    AI_MIN_STAFF_SHARE: 0.4,
    /** AI: the garrison's upkeep may take at most this share of the colony's extra tax plus resource value. */
    AI_MAX_GARRISON_COST_SHARE: 0.6,
    /** AI: gives a colony up when its garrison is under this share of the need while it rebels. */
    AI_RELEASE_GARRISON_SHARE: 0.4,
} as const;

/** Per-empire record (saved on Empire.slavery). */
export interface SlaveryEmpireState {
    /** The empire's penal colonies (it may have lost some: slaveryReview.ts drops them). */
    penal: Habitat[];
    /** Dominant races of its penal colonies (names; the kin approval term). */
    races: string[];
    /** Star date of the last AI review (-1: never). */
    lastAiReview: number;
    /** Star date the AI adopted the policy (-1: never / a human). */
    adoptedAt: number;
    /** Labour convoys at sea (ships carry `slavery` too). */
    convoys: PenalConvoy[];
    stats: { designated: number; released: number; revolts: number; breakaways: number; extraLuxury: number; taxPeak: number; convoys: number; convoysLost: number; workersShipped: number; workersDied: number; peakFactor: number };
}

export interface PenalConvoy {
    ship: BuiltObject;
    world: Habitat;
    raceName: string;
    amount: number;
}

/** Per-colony record (saved on Habitat.slavery). */
export interface SlaveryHabitatState {
    empireId: number;
    since: number;
    /** Star date of the last labour convoy sent here (-1: none). */
    lastConvoy: number;
    workersArrived: number;
    extraLuxury: number;
}

declare module './types' {
    interface Habitat {
        slavery?: SlaveryHabitatState;
    }
}
declare module './builtObject' {
    interface BuiltObject {
        /** A labour convoy: 'sea' until it unloads ('done') or docks elsewhere ('lost'). */
        slavery?: 'sea' | 'done' | 'lost';
    }
}
declare module './empire' {
    interface Empire {
        slavery?: SlaveryEmpireState;
    }
}

export const SLAVERY_FLAG = 'slavery';

/** The Slavery add-on runs. */
export function slaveryOn(galaxy: Galaxy | null | undefined): boolean {
    return galaxy != null && galaxy.scenario != null && galaxy.scenario.flags[SLAVERY_FLAG] === true;
}

/** The switch: the stock "Use Penal Colonies to implement 'Enslave' policy". */
export function slaveryAllowed(e: Empire | null): boolean {
    return e !== null && e.policy != null && e.policy.implementEnslavementWithPenalColonies === true;
}

/** The stock population policy that applies to `race` at `h` (colonyTick.ts reviewColonyPopulationPolicy's choice). */
export function populationPolicyFor(h: Habitat, race: Race): ColonyPopulationPolicy {
    const d = h.empire !== null ? h.empire.dominantRace : null;
    if (d === null || race === d) return ColonyPopulationPolicy.Assimilate;
    return race.raceFamily === d.raceFamily ? h.colonyPopulationPolicyRaceFamily : h.colonyPopulationPolicy;
}

/** A live penal colony: on its owner's stock penalColonies list, adopted by the add-on, the switch on. */
export function isPenalColony(h: Habitat): boolean {
    const s = h.slavery;
    if (s === undefined) return false;
    const e = h.empire;
    return e !== null && e.empireId === s.empireId && slaveryAllowed(e) && e.penalColonies.includes(h);
}

export function penalYears(galaxy: Galaxy, h: Habitat): number {
    const s = h.slavery;
    return s === undefined ? 0 : Math.max(0, (galaxyStarDate(galaxy) - s.since) / YEAR_LENGTH);
}

/** Luxury or restricted (Resource.cs 34 IsRestrictedResource: SuperLuxuryBonusAmount > 0). */
export function isPenalResource(galaxy: Galaxy, resourceId: number): boolean {
    const r = galaxy.resourceSystem.byId.get(resourceId);
    return r !== undefined && (resourceGroupOf(r) === ResourceGroup.Luxury || r.superLuxuryBonusAmount > 0);
}

/** Enslaved workers at a colony: its people under the stock Enslave population policy. */
export function penalWorkers(h: Habitat): number {
    if (h.empire === null || h.population == null) return 0;
    let n = 0;
    for (const p of h.population.items) if (populationPolicyFor(h, p.race) === ColonyPopulationPolicy.Enslave) n += p.amount;
    return n;
}

/** Workers a penal colony is built for (sized to the planet). */
export function penalTargetWorkers(h: Habitat): number {
    const p = SLAVERY_PARAMS;
    return Math.min(p.PENAL_TARGET_MAX, Math.max(p.PENAL_TARGET_MIN, p.PENAL_TARGET_SHARE * h.maxPopulation));
}

/** Workers / target, 0..1. */
export function penalStaffing(h: Habitat, workers = penalWorkers(h)): number {
    return Math.min(1, workers / penalTargetWorkers(h));
}

/** The luxury / restricted extraction multiplier a penal colony reaches at this staffing. */
export function penalResourceMultiplier(staffing: number): number {
    return 1 + (SLAVERY_PARAMS.PENAL_RESOURCE_MAX_FACTOR - 1) * staffing;
}

/** Extraction factor for one resource at a colony (1 unless a penal colony's luxury / restricted resource). */
export function penalResourceFactor(galaxy: Galaxy, h: Habitat, resourceId: number): number {
    return isPenalColony(h) && isPenalResource(galaxy, resourceId) ? penalResourceMultiplier(penalStaffing(h)) : 1;
}

export function penalTaxFactor(h: Habitat): number {
    return isPenalColony(h) ? 1 + (SLAVERY_PARAMS.PENAL_TAX_MAX_FACTOR - 1) * penalStaffing(h) : 1;
}

/** Troop defend strength a penal colony with `workers` needs after `years` (pure). */
export function penalGarrisonFor(workers: number, years: number): number {
    const p = SLAVERY_PARAMS;
    const grow = Math.min(p.PENAL_GARRISON_GROWTH_CAP, 1 + p.PENAL_GARRISON_GROWTH_PER_YEAR * years);
    return Math.trunc((p.PENAL_GARRISON_BASE + (p.PENAL_GARRISON_PER_BILLION * workers) / 1e9) * grow);
}

/** Troop defend strength a penal colony needs (0 for any other colony). */
export function penalGarrisonRequired(galaxy: Galaxy, h: Habitat): number {
    return isPenalColony(h) ? penalGarrisonFor(penalWorkers(h), penalYears(galaxy, h)) : 0;
}

/** Garrison held / needed (1 = fully held). */
export function penalGarrisonShare(galaxy: Galaxy, h: Habitat): number {
    const need = penalGarrisonRequired(galaxy, h);
    if (need <= 0) return 1;
    const have = h.troops !== null ? h.troops.totalDefendStrength : 0;
    return Math.min(1, have / need);
}

/** Unrest the garrison does not hold down (approval points the revolt check loses; 0 for any other colony). */
export function penalUnrest(galaxy: Galaxy, h: Habitat): number {
    if (!isPenalColony(h)) return 0;
    const p = SLAVERY_PARAMS;
    const u = Math.min(p.PENAL_UNREST_MAX, p.PENAL_UNREST_BASE + p.PENAL_UNREST_GROWTH_PER_YEAR * penalYears(galaxy, h));
    return u * (1 - penalGarrisonShare(galaxy, h));
}

/** The approval term (≤ 0): the enslaved colony, and its race's kin elsewhere in the empire. */
export function slaveryApprovalTerm(h: Habitat): number {
    const e = h.empire;
    if (e === null || e.slavery === undefined || e.slavery.penal.length === 0) return 0;
    if (isPenalColony(h)) return -SLAVERY_PARAMS.PENAL_APPROVAL_PENALTY;
    const race = h.population != null ? h.population.dominantRace : null;
    if (race !== null && slaveryAllowed(e) && e.slavery.races.includes(race.name)) return -SLAVERY_PARAMS.PENAL_KIN_APPROVAL_PENALTY;
    return 0;
}

/** Counts the extra luxury a penal colony's chains produced (soak / Galactopedia statistics). */
export function notePenalExtraction(h: Habitat, extra: number): void {
    const e = h.empire;
    if (e === null || e.slavery === undefined || extra <= 0) return;
    e.slavery.stats.extraLuxury += extra;
    if (h.slavery !== undefined) h.slavery.extraLuxury += extra;
}

/** cmdLoad (missions/cmdDocking.ts): a labour convoy is pre-loaded (its workers left their colony when it sailed). */
export function penalConvoySkipLoad(bo: BuiltObject): boolean {
    return bo.slavery === 'sea';
}

/** cmdUnload (before bo.population is cleared): the stock unload settled the workers; slaveryReview.ts sweeps the ship. */
export function settlePenalConvoyArrival(bo: BuiltObject, dockedAt: unknown): void {
    if (bo.slavery !== 'sea') return;
    bo.slavery = dockedAt !== null && typeof dockedAt === 'object' && (dockedAt as Habitat).slavery !== undefined ? 'done' : 'lost';
}
