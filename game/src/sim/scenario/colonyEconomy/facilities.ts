// Colony Economy: private-sector facilities (docs/ECONOMY.md §3). Not a port. The private sector (Empire.PrivateMoney)
// buys facilities that fit a colony's designation from its SURPLUS — the money above a reserve of econReserveK plus a
// year of its own ship and base upkeep and of its facilities' upkeep — and only while its cashflow covers their
// upkeep. Rules:
//   - slots by colony size (population): 1 below econMediumPopM millions, 2 below econLargePopM, else 3;
//   - only facilities of the colony's own designation can be built (off-designation building is impossible), and a
//     designation change closes the others (designations.ts);
//   - exclusive pairs (Free Port / Customs Bureau) never stand together;
//   - the price is paid when construction starts; the build takes buildDays; upkeep is paid monthly from private
//     money; a facility whose upkeep could not be paid stops working, and closes after a year unpaid;
//   - the player's requests (journaled commands) wait until the private sector can afford them and go first; the
//     private sector also picks facilities by itself (the AI's always; the player's unless switched off).
// No Rnd: every pick is by score with index / id tie-breaks.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import { galaxyStarDate } from '../../tick/simTime';
import { annualPrivateMaintenance } from '../../forceStructure';
import { getPrivateAnnualCashflow } from '../../civilianAI';
import { registerScenarioPeriodic } from '../hooks';
import { isHumanEmpire } from '../../humanEmpires';
import {
    DAY,
    Designation,
    ECON_FAC_FLAG,
    ECON_FLAG,
    FACILITY_DEFS,
    activeFacilities,
    bumpEcon,
    colonyRecord,
    econOn,
    econParam,
    empireRecord,
    facilityDef,
    hasPrivateSector,
    peekColony,
    peekEconState,
    peekEmpire,
    type EconColony,
    type EconFacility,
    type EconFacilityDef,
    type FacilityId,
} from './common';
import { facilityValue } from './effects';

/** Review period of the private build loop (game days). */
export const FACILITY_REVIEW_DAYS = 30;
/** A facility unpaid this long closes (days). */
export const UNPAID_CLOSE_DAYS = 360;
/** The private sector's own picks per review at most. */
export const MAX_STARTS_PER_REVIEW = 3;

/** Facility slots at `h` by its population. Pure. */
export function colonySlots(galaxy: Galaxy, h: Habitat): number {
    const pop = h.population?.totalAmount ?? 0;
    if (pop >= econParam(galaxy, 'econLargePopM') * 1e6) return 3;
    if (pop >= econParam(galaxy, 'econMediumPopM') * 1e6) return 2;
    return 1;
}

export function colonySizeName(slots: number): string {
    return slots >= 3 ? 'large' : slots === 2 ? 'medium' : 'small';
}

/**
 * The price at `h`: the base price × the cost param × a size factor 1 + population / 4 bn (at most ×4), so a facility on
 * a big, rich world costs what the private sector there can raise (the sink grows with the economy).
 */
export function facilityPrice(galaxy: Galaxy, def: EconFacilityDef, h?: Habitat): number {
    const pop = h?.population?.totalAmount ?? 0;
    const size = 1 + Math.min(3, pop / 4e9);
    return Math.round((def.cost * size * econParam(galaxy, 'econFacilityCostPct')) / 100);
}

export function facilityBuildDays(galaxy: Galaxy, def: EconFacilityDef): number {
    return Math.max(1, Math.round((def.buildDays * econParam(galaxy, 'econFacilityBuildPct')) / 100));
}

/** Upkeep a year of every facility of `e` (built ones). Pure. */
export function annualFacilityUpkeep(galaxy: Galaxy, e: Empire): number {
    const st = peekEconState(galaxy);
    if (st === null) return 0;
    let s = 0;
    for (const h of e.colonies) {
        const c = st.colonies[h.habitatIndex];
        if (c === undefined) continue;
        for (const f of c.facilities) if (f.progress >= 1) s += f.cost * facilityDef(f.id).upkeepShare;
    }
    return s;
}

/** The private money above the reserve (≥ 0). Pure. */
export function privateSurplus(galaxy: Galaxy, e: Empire): number {
    if (!hasPrivateSector(galaxy, e)) return 0;
    const reserve = econParam(galaxy, 'econReserveK') * 1000 + 0.5 * annualPrivateMaintenance(e) + annualFacilityUpkeep(galaxy, e);
    return Math.max(0, e.privateMoney - reserve);
}

/** Built, working Investment Banks of `e` (bond rates). Pure. */
export function investmentBankCount(galaxy: Galaxy, e: Empire): number {
    let n = 0;
    for (const h of e.colonies) for (const f of activeFacilities(galaxy, h)) if (f.id === 'investmentBank') n++;
    return n;
}

/** Why `id` cannot be built at `h` now (null: it can, money aside). Pure. */
export function facilityRefusal(galaxy: Galaxy, e: Empire, h: Habitat, id: FacilityId): string | null {
    if (!econOn(galaxy, ECON_FAC_FLAG)) return 'Private facilities are off';
    if (h.empire !== e || !hasPrivateSector(galaxy, e)) return h.empire !== e ? 'Not your colony' : 'This government has no private sector';
    const def = facilityDef(id);
    const c = peekColony(galaxy, h);
    const d = c?.designation ?? Designation.None;
    if (d === Designation.None) return 'Designate the colony first';
    if (def.designation !== d) return 'Only facilities of this colony\'s designation can be built here';
    const facs = c?.facilities ?? [];
    if (facs.some((f) => f.id === id)) return 'Already built or under construction';
    if (def.exclusiveWith !== undefined && facs.some((f) => f.id === def.exclusiveWith)) return `Cannot stand beside the ${facilityDef(def.exclusiveWith).name}`;
    if (facs.length >= colonySlots(galaxy, h)) return `No free slot (a ${colonySizeName(colonySlots(galaxy, h))} colony has ${colonySlots(galaxy, h)})`;
    return null;
}

/** Player command: queue a facility request at `h`. */
export function requestFacility(galaxy: Galaxy, e: Empire, h: Habitat, id: FacilityId): boolean {
    if (facilityRefusal(galaxy, e, h, id) !== null) return false;
    const c = colonyRecord(galaxy, h);
    if (c.requests.includes(id)) return false;
    // Requests count against the slots and the exclusive pairs too.
    const def = facilityDef(id);
    if (c.facilities.length + c.requests.length >= colonySlots(galaxy, h)) return false;
    if (def.exclusiveWith !== undefined && c.requests.includes(def.exclusiveWith)) return false;
    c.requests.push(id);
    return true;
}

/** Player command: drop a waiting request. */
export function cancelFacilityRequest(galaxy: Galaxy, e: Empire, h: Habitat, id: FacilityId): boolean {
    if (!econOn(galaxy, ECON_FAC_FLAG) || h.empire !== e) return false;
    const c = peekColony(galaxy, h);
    if (c === null || !c.requests.includes(id)) return false;
    c.requests = c.requests.filter((x) => x !== id);
    return true;
}

/** Player command: the private sector also picks facilities by itself (default on). */
export function setAutoFacilities(galaxy: Galaxy, e: Empire, on: boolean): boolean {
    if (!econOn(galaxy, ECON_FAC_FLAG) || !hasPrivateSector(galaxy, e)) return false;
    empireRecord(galaxy, e).autoFacilities = on;
    return true;
}

function startFacility(galaxy: Galaxy, e: Empire, h: Habitat, c: EconColony, def: EconFacilityDef, requested: boolean): void {
    const price = facilityPrice(galaxy, def, h);
    e.privateMoney -= price;
    const r = empireRecord(galaxy, e);
    r.facilitySpend += price;
    c.facilities.push({ id: def.id, progress: 0, started: galaxyStarDate(galaxy), finished: 0, cost: price, requested, unpaidSince: 0 });
    c.requests = c.requests.filter((x) => x !== def.id);
    bumpEcon(galaxy);
}

/**
 * Room for one more facility's upkeep: the private cashflow, plus a tenth of the surplus (the idle money can carry ten
 * years of upkeep), minus the upkeep already owed.
 */
function upkeepRoom(galaxy: Galaxy, e: Empire): number {
    return getPrivateAnnualCashflow(galaxy, e) + privateSurplus(galaxy, e) / UPKEEP_SURPLUS_YEARS - annualFacilityUpkeep(galaxy, e);
}
/** The surplus may carry this many years of facility upkeep. */
export const UPKEEP_SURPLUS_YEARS = 10;

/** One empire's build review: progress, upkeep, then at most one new start (requests first). */
function reviewEmpire(galaxy: Galaxy, e: Empire): void {
    const st = peekEconState(galaxy);
    const now = galaxyStarDate(galaxy);
    const r = peekEmpire(galaxy, e);
    // 1. Progress and upkeep.
    if (st !== null) {
        let upkeep = 0;
        for (const h of e.colonies) {
            const c = st.colonies[h.habitatIndex];
            if (c === undefined || c.facilities.length === 0) continue;
            for (const f of c.facilities) {
                if (f.progress < 1) {
                    f.progress = Math.min(1, f.progress + (FACILITY_REVIEW_DAYS / facilityBuildDays(galaxy, facilityDef(f.id))) * buildSpeedFactor(galaxy, h));
                    if (f.progress >= 1) {
                        f.finished = now;
                        empireRecord(galaxy, e).facilitiesBuilt++;
                    }
                } else upkeep += (f.cost * facilityDef(f.id).upkeepShare * FACILITY_REVIEW_DAYS) / 360;
            }
        }
        if (upkeep > 0) {
            e.privateMoney -= upkeep;
            empireRecord(galaxy, e).facilityUpkeep += upkeep;
            const unpaid = e.privateMoney < 0;
            for (const h of e.colonies) {
                const c = st.colonies[h.habitatIndex];
                if (c === undefined) continue;
                for (const f of c.facilities) {
                    if (f.progress < 1) continue;
                    if (!unpaid) f.unpaidSince = 0;
                    else if (f.unpaidSince === 0) f.unpaidSince = now;
                }
                c.facilities = c.facilities.filter((f) => !(f.unpaidSince > 0 && now - f.unpaidSince > UNPAID_CLOSE_DAYS * DAY));
            }
        }
    }
    bumpEcon(galaxy);
    // 2. A new start, from the surplus only.
    const surplus = privateSurplus(galaxy, e);
    const budget = (surplus * econParam(galaxy, 'econSpendSharePct')) / 100;
    if (budget <= 0) return;
    const room = upkeepRoom(galaxy, e);
    const affordable = (def: EconFacilityDef, h: Habitat): boolean => facilityPrice(galaxy, def, h) <= budget && def.upkeepShare * facilityPrice(galaxy, def, h) < room;
    // Requests first, oldest colony index first.
    if (st !== null) {
        for (const h of e.colonies) {
            const c = st.colonies[h.habitatIndex];
            if (c === undefined || c.requests.length === 0) continue;
            for (const id of c.requests) {
                const def = facilityDef(id);
                if (facilityRefusalIgnoringRequests(galaxy, e, h, c, def) !== null) continue;
                if (!affordable(def, h)) return; // wait for the money: requests keep their turn
                startFacility(galaxy, e, h, c, def, true);
                return;
            }
        }
    }
    const auto = !isHumanEmpire(galaxy, e) || (r?.autoFacilities ?? true);
    if (!auto) return;
    // Up to MAX_STARTS_PER_REVIEW of the private sector's own picks, while the budget lasts.
    let left = budget;
    let room2 = room;
    for (let n = 0; n < MAX_STARTS_PER_REVIEW; n++) {
        let best: { h: Habitat; c: EconColony; def: EconFacilityDef; v: number } | null = null;
        for (const h of e.colonies) {
            const c = peekColony(galaxy, h);
            if (c === null || c.designation === Designation.None) continue;
            if (c.facilities.length + c.requests.length >= colonySlots(galaxy, h)) continue;
            for (const def of FACILITY_DEFS) {
                if (def.designation !== c.designation) continue;
                const price = facilityPrice(galaxy, def, h);
                if (price > left || def.upkeepShare * price >= room2) continue;
                if (facilityRefusalIgnoringRequests(galaxy, e, h, c, def) !== null) continue;
                if (def.exclusiveWith !== undefined && c.requests.includes(def.exclusiveWith)) continue;
                const v = facilityValue(galaxy, e, h, def.id);
                if (v <= 0) continue;
                if (best === null || v > best.v + 1e-9) best = { h, c, def, v };
            }
        }
        if (best === null) return;
        const price = facilityPrice(galaxy, best.def, best.h);
        startFacility(galaxy, e, best.h, best.c, best.def, false);
        left -= price;
        room2 -= best.def.upkeepShare * price;
    }
}

function facilityRefusalIgnoringRequests(galaxy: Galaxy, e: Empire, h: Habitat, c: EconColony, def: EconFacilityDef): string | null {
    void e;
    if (def.designation !== c.designation) return 'designation';
    if (c.facilities.some((f) => f.id === def.id)) return 'built';
    if (def.exclusiveWith !== undefined && c.facilities.some((f) => f.id === def.exclusiveWith)) return 'exclusive';
    if (c.facilities.length >= colonySlots(galaxy, h)) return 'slots';
    return null;
}

/** Facility construction goes faster at a colony with a faster construction queue (Industrial, Heavy Foundry). */
function buildSpeedFactor(galaxy: Galaxy, h: Habitat): number {
    void galaxy;
    void h;
    return 1;
}

function facilitiesTick(galaxy: Galaxy): void {
    bumpEcon(galaxy);
    for (const e of galaxy.empires) {
        if (!hasPrivateSector(galaxy, e)) continue;
        reviewEmpire(galaxy, e);
    }
}

registerScenarioPeriodic({ id: 'colonyEconomy.facilities', flag: ECON_FLAG, periodDays: FACILITY_REVIEW_DAYS, run: (g) => econOn(g, ECON_FAC_FLAG) && facilitiesTick(g) });

/** The colony screen's facility slots (UI). Pure. */
export interface FacilitySlotView {
    slots: number;
    size: string;
    built: { id: FacilityId; name: string; effect: string; progress: number; working: boolean; requested: boolean; unpaid: boolean }[];
    requests: { id: FacilityId; name: string }[];
    /** Facilities of the designation, with why each cannot be requested (null: it can). */
    options: { id: FacilityId; name: string; effect: string; price: number; buildDays: number; upkeep: number; refusal: string | null }[];
    surplus: number;
    autoFacilities: boolean;
}

export function facilitySlotView(galaxy: Galaxy, e: Empire, h: Habitat): FacilitySlotView {
    const c = peekColony(galaxy, h);
    const slots = colonySlots(galaxy, h);
    const d = c?.designation ?? Designation.None;
    const active = new Set(activeFacilities(galaxy, h));
    const built = (c?.facilities ?? []).map((f: EconFacility) => ({
        id: f.id,
        name: facilityDef(f.id).name,
        effect: facilityDef(f.id).effect,
        progress: f.progress,
        working: active.has(f),
        requested: f.requested,
        unpaid: f.unpaidSince > 0,
    }));
    const requests = (c?.requests ?? []).map((id) => ({ id, name: facilityDef(id).name }));
    const options = FACILITY_DEFS.filter((f) => f.designation === d).map((def) => {
        let refusal = facilityRefusal(galaxy, e, h, def.id);
        if (refusal === null && c !== null) {
            if (c.requests.includes(def.id)) refusal = 'Requested';
            else if (c.facilities.length + c.requests.length >= slots) refusal = 'No free slot (requests waiting)';
            else if (def.exclusiveWith !== undefined && c.requests.includes(def.exclusiveWith)) refusal = `Cannot stand beside the ${facilityDef(def.exclusiveWith).name}`;
        }
        const price = facilityPrice(galaxy, def, h);
        return { id: def.id, name: def.name, effect: def.effect, price, buildDays: facilityBuildDays(galaxy, def), upkeep: Math.round(price * def.upkeepShare), refusal };
    });
    return { slots, size: colonySizeName(slots), built, requests, options, surplus: privateSurplus(galaxy, e), autoFacilities: peekEmpire(galaxy, e)?.autoFacilities ?? true };
}

export type { EconFacility };
