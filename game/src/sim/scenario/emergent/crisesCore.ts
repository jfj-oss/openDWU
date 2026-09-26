// 19d2 Resource crises — the light half (tasks/19d2-resource-crises.md §2): saved state, the pure propagation formulas
// (crisis prices, smuggle cap, shortage unrest) and the record hooks the ported code calls. Not a port. This module
// imports no sim logic beyond the price table so ported modules (market.ts, industry.ts, missionsMarket.ts, invasion.ts,
// cmdDocking.ts, resourceTargets.ts) can call it without import cycles; the yearly handler lives in crises.ts.
//
// Every entry point here is a no-op unless the game runs a scenario with the `resourceCrises` flag on. Rnd: none.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import type { Resource } from '../../data/resources';
import { galaxyResourceCurrentPrices } from '../../design';
import { YEAR_LENGTH } from '../../galaxyTime';
import { galaxyStarDate } from '../../tick/simTime';
import { scenarioFlag, scenarioParam, scenarioState } from '../state';

export const CRISES_FLAG = 'resourceCrises';

export type CrisisKind = 'depletion' | 'blockade' | 'raid' | 'shock' | 'fuel';

/** One open (resolvedYear -1) or resolved crisis. Plain data + graph objects (saved). */
export interface Crisis {
    id: number;
    kind: CrisisKind;
    resourceId: number;
    habitat: Habitat | null;
    empire: Empire | null;
    startYear: number;
    /** 0–1. */
    severity: number;
    /** -1 = open. */
    resolvedYear: number;
    /** First yearly review that found the resource back (-1: not back); resolves a full year later. */
    okSinceYear: number;
}

export interface LostLuxuryEntry {
    year: number;
    count: number;
    resourceIds: number[];
}

/** scenarioState(galaxy, 'crises'). */
export interface CrisesState {
    /** Units extracted per source habitat and resource since the first record. */
    extracted: Map<Habitat, Map<number, number>>;
    /** Abundance at the first record (the reserve basis). */
    baseAbundance: Map<Habitat, Map<number, number>>;
    /** Reserve stage reached (1: 50 % extracted, 2: 80 %). */
    reserveStage: Map<Habitat, Map<number, number>>;
    /** The empire that last extracted at a source (the recipient of its messages when the source is not a colony). */
    extractor: Map<Habitat, Empire>;
    crises: Crisis[];
    lostLuxuries: Map<Habitat, LostLuxuryEntry[]>;
    /** Luxury resource ids in the colony's cargo at the last yearly review. */
    lastLuxuries: Map<Habitat, number[]>;
    /** Luxury + race-critical resource ids in stock at the last yearly review (blockade trigger). */
    lastStock: Map<Habitat, number[]>;
    /** Resource ids looted by raids since the last yearly review. */
    raidLosses: Map<Habitat, number[]>;
    fuelReport: Map<Empire, { year: number; grounded: number; military: number }>;
    /** AI rule 2: resources an AI empire lost at >= 25 % of its colonies (mining targets put their sources first). */
    miningPriority: Map<Empire, number[]>;
    /** AI rule 3: contracts initiated this / last year, seller → (resourceId, buyer, year). */
    exports: Map<Empire, { resourceId: number; buyer: Empire; year: number }[]>;
    /** Units smugglers delivered into colonies with an open crisis (the "black market" line). */
    smuggledIn: Map<Empire, number>;
    /** Year of the last "price spike" news per resource. */
    priceNewsYear: Map<number, number>;
    nextCrisisId: number;
}

export function crisesState(galaxy: Galaxy): CrisesState {
    return scenarioState<CrisesState>(galaxy, 'crises', () => ({
        extracted: new Map(),
        baseAbundance: new Map(),
        reserveStage: new Map(),
        extractor: new Map(),
        crises: [],
        lostLuxuries: new Map(),
        lastLuxuries: new Map(),
        lastStock: new Map(),
        raidLosses: new Map(),
        fuelReport: new Map(),
        miningPriority: new Map(),
        exports: new Map(),
        smuggledIn: new Map(),
        priceNewsYear: new Map(),
        nextCrisisId: 1,
    }));
}

/** True when the crises package runs in this game. */
export function crisesOn(galaxy: Galaxy): boolean {
    return galaxy.scenario !== null && scenarioFlag(galaxy, CRISES_FLAG);
}

/** The state if the package runs and it exists (pure readers must not create it). */
function stateIfAny(galaxy: Galaxy): CrisesState | null {
    const s = galaxy.scenario;
    if (s === null || s.flags[CRISES_FLAG] !== true || !('crises' in s.state)) return null;
    return s.state.crises as CrisesState;
}

// ---------------------------------------------------------------------------
// Params (tasks/19d2 §1)
// ---------------------------------------------------------------------------

export function reserveUnitsPerAbundance(galaxy: Galaxy): number {
    return scenarioParam(galaxy, 'reserveUnitsPerAbundance', 250);
}
export function crisisPriceCeiling(galaxy: Galaxy): number {
    return scenarioParam(galaxy, 'crisisPriceCeiling', 1.5);
}
export function shortageShockChance(galaxy: Galaxy): number {
    return scenarioParam(galaxy, 'shortageShockChance', 0.15);
}
export function shortageUnrest(galaxy: Galaxy): number {
    return scenarioParam(galaxy, 'shortageUnrest', 6);
}

/** The fractional game year of the current star date. */
export function crisesYearNow(galaxy: Galaxy): number {
    return galaxyStarDate(galaxy) / YEAR_LENGTH;
}

// ---------------------------------------------------------------------------
// Record hooks (called from ported code; flag check + Map update, no allocation on the hot path once warmed, no Rnd)
// ---------------------------------------------------------------------------

/**
 * Trigger 1 bookkeeping: `units` of `resourceId` were extracted at `habitat` (industry.ts industrialProcessing /
 * extractResources, after each HabitatResource.Extract). Call sites guard with `galaxy.scenario !== null`.
 */
export function recordExtraction(galaxy: Galaxy, habitat: Habitat, resourceId: number, units: number, extractor: Empire | null): void {
    if (!crisesOn(galaxy)) return;
    const st = crisesState(galaxy);
    let byRes = st.extracted.get(habitat);
    if (byRes === undefined) {
        byRes = new Map();
        st.extracted.set(habitat, byRes);
    }
    const prev = byRes.get(resourceId);
    if (prev === undefined) {
        let base = st.baseAbundance.get(habitat);
        if (base === undefined) {
            base = new Map();
            st.baseAbundance.set(habitat, base);
        }
        if (!base.has(resourceId)) {
            const r = habitat.resources.find((x) => x.resourceId === resourceId);
            base.set(resourceId, r !== undefined ? r.abundance : 0);
        }
        byRes.set(resourceId, units);
    } else {
        byRes.set(resourceId, prev + units);
    }
    if (extractor !== null && extractor !== galaxy.independentEmpire && st.extractor.get(habitat) !== extractor) st.extractor.set(habitat, extractor);
}

/** Trigger 3 bookkeeping: a raid looted `resourceIds` from `colony` (or the space port at it). combat/invasion.ts doRaidBonuses. */
export function recordRaidLoss(galaxy: Galaxy, colony: Habitat | null, resourceIds: readonly number[]): void {
    if (colony === null || resourceIds.length === 0 || !crisesOn(galaxy)) return;
    const st = crisesState(galaxy);
    const list = st.raidLosses.get(colony) ?? [];
    for (const id of resourceIds) if (!list.includes(id)) list.push(id);
    st.raidLosses.set(colony, list);
}

/** §2.9: smugglers delivered `units` to `colony` (missions/cmdDocking.ts, the smuggling-mission payment). */
export function recordSmuggleDelivery(galaxy: Galaxy, colony: unknown, units: number): void {
    if (!crisesOn(galaxy) || units <= 0) return;
    const c = colonyInCrisis(galaxy, colony as Habitat);
    if (c === null || c.empire === null) return;
    const st = crisesState(galaxy);
    st.smuggledIn.set(c.empire, (st.smuggledIn.get(c.empire) ?? 0) + units);
}

// ---------------------------------------------------------------------------
// Propagation formulas (pure)
// ---------------------------------------------------------------------------

/** §2.6: supply below this share of demand lifts the ported price ceiling. */
export const CRISIS_SUPPLY_RATIO = 0.25;

/**
 * §2.6 crisis price, called by market.ts reviewResourcePrices (Galaxy.1.cs 1204) after the ported clamp. When supply is
 * below CRISIS_SUPPLY_RATIO × demand the ceiling becomes BasePrice × crisisPriceCeiling and the price moves toward
 * BasePrice × demand/supply with the C#'s step rule (rise by a quarter / fall by half of the gap, a rise capped at half
 * the current price); otherwise the ported value `clamped` stands (the ported clamp pulls a crisis price back).
 * Super-luxuries keep their ported band. Pure.
 */
export function crisisPrice(galaxy: Galaxy, def: Resource, demand: number, supply: number, clamped: number, previous: number): number {
    if (!crisesOn(galaxy) || def.superLuxuryBonusAmount > 0) return clamped;
    if (!(supply < demand * CRISIS_SUPPLY_RATIO)) return clamped;
    const basePrice = Math.fround(def.basePrice);
    const target = basePrice * (demand / Math.max(1.0, supply));
    let step = target - previous;
    step = !(step > 0.0) ? step / 2.0 : step / 4.0;
    if (step > previous / 2.0) step = previous / 2.0;
    let p = previous + step;
    p = Math.max(basePrice * 0.1667, Math.min(basePrice * crisisPriceCeiling(galaxy), p));
    if (Number.isNaN(p)) return clamped;
    return Math.max(clamped, p);
}

/** True when the current price of a normal resource is above the ported ceiling (0.35 × BasePrice). Pure. */
export function resourceAtCrisisPrice(def: Resource, price: number): boolean {
    if (def.superLuxuryBonusAmount > 0) return false;
    return price > Math.fround(def.basePrice) * 0.35 * 1.0001;
}

/** §2.9: the per-unit smuggle price cap, 5 × max(1, crisisPriceCeiling / 0.35) (the ported cap is 5). */
export function crisisSmuggleCap(galaxy: Galaxy): number {
    return 5.0 * Math.max(1.0, crisisPriceCeiling(galaxy) / 0.35);
}

/**
 * §2.7 shortage unrest (the `crises.shortage` approval term): −shortageUnrest × Σ count × (1 − age/2) over the colony's
 * luxury losses of the last two years. Pure (only saved state; no Rnd).
 */
export function shortageTerm(galaxy: Galaxy, h: Habitat): number {
    const st = stateIfAny(galaxy);
    if (st === null) return 0;
    const list = st.lostLuxuries.get(h);
    if (list === undefined || list.length === 0) return 0;
    const now = crisesYearNow(galaxy);
    let sum = 0;
    for (const e of list) {
        const age = Math.max(0, now - e.year);
        if (age >= 2) continue;
        sum += e.count * (1 - age / 2);
    }
    return sum === 0 ? 0 : -shortageUnrest(galaxy) * sum;
}

/** The approval breakdown lines this package adds (UI tooltip). */
export function crisesApprovalBreakdown(galaxy: Galaxy, h: Habitat): { label: string; value: number }[] {
    const v = shortageTerm(galaxy, h);
    return v === 0 ? [] : [{ label: 'Shortages', value: v }];
}

// ---------------------------------------------------------------------------
// Public accessors (§2.10, pure)
// ---------------------------------------------------------------------------

/** The open crisis at a colony (the first, by id), or null. */
export function colonyInCrisis(galaxy: Galaxy, h: Habitat | null): Crisis | null {
    const st = stateIfAny(galaxy);
    if (st === null || h === null) return null;
    for (const c of st.crises) if (c.resolvedYear < 0 && c.habitat === h && c.kind !== 'fuel') return c;
    return null;
}

/** True when any colony of `empire` has an open crisis. */
export function empireHasColonyCrisis(galaxy: Galaxy, empire: Empire): boolean {
    const st = stateIfAny(galaxy);
    if (st === null) return false;
    for (const c of st.crises) if (c.resolvedYear < 0 && c.habitat !== null && c.habitat.empire === empire && c.kind !== 'fuel') return true;
    return false;
}

/** Open crises of an empire (by crisis empire, or colonies it owns), oldest first. */
export function empireCrises(galaxy: Galaxy, e: Empire): Crisis[] {
    const st = stateIfAny(galaxy);
    if (st === null) return [];
    return st.crises.filter((c) => c.resolvedYear < 0 && (c.empire === e || (c.habitat !== null && c.habitat.empire === e)));
}

/** Every normal and super-luxury resource with its current and base price and whether it is at a crisis price. */
export function crisisPriceIndex(galaxy: Galaxy): { resourceId: number; price: number; base: number; inCrisis: boolean }[] {
    const prices = galaxyResourceCurrentPrices(galaxy);
    const out: { resourceId: number; price: number; base: number; inCrisis: boolean }[] = [];
    for (const def of galaxy.resourceSystem.resources) {
        const price = prices[def.resourceId];
        out.push({ resourceId: def.resourceId, price, base: Math.fround(def.basePrice), inCrisis: crisesOn(galaxy) && resourceAtCrisisPrice(def, price) });
    }
    return out;
}

/** Luxury ids the colony lost in the last two years (UI tooltip), newest first; [] with the package off. */
export function colonyRecentLostLuxuries(galaxy: Galaxy, h: Habitat): number[] {
    const st = stateIfAny(galaxy);
    if (st === null) return [];
    const list = st.lostLuxuries.get(h);
    if (list === undefined) return [];
    const now = crisesYearNow(galaxy);
    const out: number[] = [];
    for (let i = list.length - 1; i >= 0; i--) {
        if (now - list[i].year >= 2) continue;
        for (const id of list[i].resourceIds) if (!out.includes(id)) out.push(id);
    }
    return out;
}

/** AI rule 2 (resourceTargets.ts identifyResourceCentres): the resources whose sources an empire mines first. */
export function crisesMiningPriority(galaxy: Galaxy, empire: Empire): readonly number[] {
    const st = stateIfAny(galaxy);
    if (st === null) return [];
    return st.miningPriority.get(empire) ?? [];
}

/**
 * AI rule 3 (pirates/missionsMarket.ts makeSmugglingOffersToPirates): true when `empire` exported `resourceId` this or
 * last year to a trade partner that now has an open crisis — it does not then offer smuggling for that resource.
 */
export function crisesBlocksSmuggleOffer(galaxy: Galaxy, empire: Empire, resourceId: number): boolean {
    const st = stateIfAny(galaxy);
    if (st === null) return false;
    const ex = st.exports.get(empire);
    if (ex === undefined) return false;
    for (const x of ex) {
        if (x.resourceId === resourceId && x.buyer !== empire && (empireHasColonyCrisis(galaxy, x.buyer) || empireCrises(galaxy, x.buyer).length > 0)) return true;
    }
    return false;
}

// ---------------------------------------------------------------------------
// UI rows (pure; ui/screens/empireSummary.ts, ui/screens/coloniesList.ts)
// ---------------------------------------------------------------------------

const KIND_LABEL: Record<CrisisKind, string> = { depletion: 'Depleted', blockade: 'Blockade', raid: 'Raid', shock: 'Supply shock', fuel: 'Fuel' };

/**
 * The Empire Summary "Crises" block: open crises (kind, resource, place, years), grounded warships, the black-market
 * line and the resources at a crisis price. [] with the package off.
 */
export function crisesSummaryRows(galaxy: Galaxy, e: Empire): { label: string; value: string }[] {
    if (!crisesOn(galaxy)) return [];
    const rows: { label: string; value: string }[] = [];
    const open = empireCrises(galaxy, e);
    const year = Math.floor(crisesYearNow(galaxy));
    rows.push({ label: 'Crises', value: String(open.length) });
    for (const c of open) {
        const res = galaxy.resourceSystem.byId.get(c.resourceId)?.name ?? '?';
        const place = c.habitat?.name ?? e.name;
        const years = Math.max(0, year - c.startYear);
        rows.push({ label: `  ${KIND_LABEL[c.kind]}: ${res}`, value: `${place}, ${years} yr` });
    }
    const st = stateIfAny(galaxy);
    const fuel = st?.fuelReport.get(e);
    rows.push({ label: 'Grounded warships', value: fuel === undefined ? '0' : `${fuel.grounded} / ${fuel.military}` });
    const smuggled = st?.smuggledIn.get(e) ?? 0;
    if (smuggled > 0) rows.push({ label: 'Black market deliveries', value: String(Math.round(smuggled)) });
    const spikes = crisisPriceIndex(galaxy).filter((p) => p.inCrisis);
    if (spikes.length > 0) {
        rows.push({
            label: 'Crisis prices',
            value: spikes.map((p) => `${galaxy.resourceSystem.byId.get(p.resourceId)?.name ?? '?'} ${(p.price / p.base).toFixed(2)}x`).join(', '),
        });
    }
    return rows;
}

/** The Colonies list shortage marker: the tooltip text (lost luxuries, open crisis), or null when there is none. */
export function colonyShortageMarker(galaxy: Galaxy, h: Habitat): string | null {
    if (!crisesOn(galaxy)) return null;
    const lost = colonyRecentLostLuxuries(galaxy, h);
    const c = colonyInCrisis(galaxy, h);
    if (lost.length === 0 && c === null) return null;
    const parts: string[] = [];
    if (lost.length > 0) parts.push(`Lost luxuries: ${lost.map((id) => galaxy.resourceSystem.byId.get(id)?.name ?? '?').join(', ')}`);
    if (c !== null) parts.push(`${KIND_LABEL[c.kind]}: ${galaxy.resourceSystem.byId.get(c.resourceId)?.name ?? '?'}`);
    const term = shortageTerm(galaxy, h);
    if (term !== 0) parts.push(`Shortages ${term.toFixed(1)} approval`);
    return parts.join('\n');
}
