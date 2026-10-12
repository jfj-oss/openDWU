// Colony Economy phase 4: keeping the refinement chain supplied (docs/ECONOMY.md §5, the user's decisions B). Not a
// port. Every rule here is new.
//   - AI design fallback (aiBuildDesign): an AI that cannot supply a design's hard goods (no working refinery of the
//     good and too little in stock at its yards) queues the newest older design of the same sub-role it can supply.
//   - AI commissions (every 30 days): ahead of its research reaching the tech level that needs a good, an AI empire
//     without a refinery of that good commissions one at a colony of the refinery's designation (designating a colony
//     when it has none): the treasury pays what the private surplus cannot (facilities.ts startCommission).
//   - Protection: the AI's mining stations within 2 sectors of a refinery want 50 % more escort (the inputs' lanes).
//   - Supply alerts: the player is warned once per good when research is about to need a good no refinery of theirs
//     makes.
// No Rnd: picks by score with index tie-breaks.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import type { BuiltObject } from '../../builtObject';
import type { Design } from '../../design';
import { canBuildDesign } from '../../designGeneration';
import { calculateAnnualCashflow } from '../../treasury';
import { annualStateExpenses } from './bonds';
import { isHumanEmpire } from '../../humanEmpires';
import { EmpireMessageType } from '../../messages';
import { registerScenarioPeriodic, registerScenarioQuery } from '../hooks';
import { scenarioMessage } from '../messages';
import { Designation, DESIGNATION_NAMES, ECON_DESIG_FLAG, ECON_FLAG, activeFacilities, colonyRecord, econOn, empireRecord, facilityDef, hasPrivateSector, isEconEmpire, peekColony, peekEmpire, type FacilityId } from './common';
import { GOODS, G_EXOTICS, G_PRECISION, designNeed, goodIds, heldAt, refinementActive, tradingPostOf } from './refinement';
import { commissionStateShare, facilityPrice, facilityRefusal, startCommission } from './facilities';
import { AI_MIN_POPULATION, designationScores, designationCooldownDays, homeColony, setDesignation, SECTOR } from './designations';

export const SUPPLY_RULES = {
    reviewDays: 30,
    /** A design counts as suppliable from stock when the empire's yards hold this many builds' worth of a good. */
    stockBuilds: 2,
    /** The AI commissions a refinery while its treasury holds this many times the state's share. */
    commissionMoneyFactor: 1.2,
    /** At most this many commissions a review (the hard-tier goods first). */
    commissionsPerReview: 2,
    /** ...and keeps this many months of state expenses (at least reserveMin) after paying its share. */
    reserveMonths: 6,
    reserveMin: 20000,
    /** Once a good is needed at a soft tier (3-4): one more refinery of it per this many shipyards, at most maxPerGood. */
    yardsPerRefinery: 4,
    maxPerGood: 3,
    /** Once a good is needed (or about to be) at a hard tier (5+): one more per this many shipyards, at most maxPerGoodHard. */
    yardsPerRefineryHard: 2,
    maxPerGoodHard: 6,
    /** Exotics and Precision Components (small needs): one more per this many shipyards, at most maxPerGoodTop. */
    yardsPerRefineryTop: 5,
    maxPerGoodTop: 3,
    /** An empire whose researched components reach this tier plans its Exotics Lab and Precision Works (tech 7 is next). */
    planAheadTier: 5,
    /** Research this close to a good's need triggers the commission / the alert: the next projects reach the tier. */
    patrolRange: 2 * SECTOR,
    patrolFactor: 1.5,
};

/** Working refineries of `e` by GOODS index; with `planned`, also those building or requested. Pure. */
export function refineryCounts(galaxy: Galaxy, e: Empire, planned = false): number[] {
    const n = GOODS.map(() => 0);
    for (const h of e.colonies) {
        if (planned) {
            const c = peekColony(galaxy, h);
            if (c === null) continue;
            for (const id of [...c.facilities.map((f) => f.id), ...c.requests]) {
                const gi = GOODS.findIndex((g) => g.facility === id);
                if (gi >= 0) n[gi]++;
            }
            continue;
        }
        for (const f of activeFacilities(galaxy, h)) {
            const gi = GOODS.findIndex((g) => g.facility === f.id);
            if (gi >= 0) n[gi]++;
        }
    }
    return n;
}

/** Refined goods `e`'s yards hold, by GOODS index; with `posts`, also its colonies' trading posts (refinery output). Pure. */
export function yardStock(galaxy: Galaxy, e: Empire, posts = false): number[] {
    const ids = goodIds(galaxy);
    const s = GOODS.map(() => 0);
    if (ids === null) return s;
    for (const y of e.spacePorts as BuiltObject[]) {
        if (y === null || y.hasBeenDestroyed || !y.isShipYard) continue;
        for (let gi = 0; gi < GOODS.length; gi++) s[gi] += heldAt(y, ids[gi], e);
    }
    if (posts) {
        for (const h of e.colonies) {
            const p = tradingPostOf(h);
            if (p !== h && (p as BuiltObject).isShipYard) continue; // counted above
            for (let gi = 0; gi < GOODS.length; gi++) s[gi] += heldAt(p, ids[gi], e);
        }
    }
    return s;
}

/**
 * `e` can supply `design`'s hard goods: a refinery of each (the AI's check counts one building or requested: the supply
 * is coming), or enough in stock. Pure.
 */
export function canSupply(galaxy: Galaxy, e: Empire, design: Design, refs?: number[], stock?: number[]): boolean {
    const n = designNeed(design);
    if (!n.anyHard) return true;
    const r = refs ?? refineryCounts(galaxy, e);
    const s = stock ?? yardStock(galaxy, e);
    for (let gi = 0; gi < GOODS.length; gi++) {
        if (n.hard[gi] <= 0) continue;
        if (r[gi] > 0) continue;
        if (s[gi] < n.hard[gi] * SUPPLY_RULES.stockBuilds) return false;
    }
    return true;
}

/** The AI's design for a build: `design`, or the newest older one of its sub-role it can supply (one tier lower). Pure. */
export function suppliableDesign(galaxy: Galaxy, e: Empire, design: Design): Design {
    if (!designNeed(design).anyHard) return design;
    // Only when supply is impossible: no refinery of a needed good built, building or requested, and too little of it
    // anywhere in the empire (its yards and its refineries' trading posts).
    const refs = refineryCounts(galaxy, e, true);
    const stock = yardStock(galaxy, e, true);
    if (canSupply(galaxy, e, design, refs, stock)) return design;
    let best: Design | null = null;
    for (const d of e.designs as Design[]) {
        if (d === null || d === design || d.subRole !== design.subRole || d.isPlanetDestroyer) continue;
        if (best !== null && d.dateCreated <= best.dateCreated) continue;
        if (!canSupply(galaxy, e, d, refs, stock) || !canBuildDesign(e, d, true, null)) continue;
        best = d;
    }
    return best ?? design;
}

function aiDesign(galaxy: Galaxy, design: Design, e: Empire): Design {
    if (!refinementActive(galaxy) || !isEconEmpire(galaxy, e) || isHumanEmpire(galaxy, e)) return design;
    const d = suppliableDesign(galaxy, e, design);
    if (d !== design) {
        const r = empireRecord(galaxy, e);
        r.designFallbacks = (r.designFallbacks ?? 0) + 1;
    }
    return d;
}

/** The tier at which good `gi` is needed (Precision Components: 7; the others: 3). */
function needTier(gi: number): number {
    return gi === G_PRECISION ? 7 : 3;
}

/**
 * Goods `e` should have more refineries of (by GOODS index): one ahead of research reaching the good's tier, and once a
 * researched component needs it, one more per 4 shipyards (at most 3). Refineries built, building or requested count.
 * Pure.
 */
export function goodsWanted(galaxy: Galaxy, e: Empire): number[] {
    const r = peekEmpire(galaxy, e);
    if (r === null || r.goodsNext === undefined) return [];
    let yards = 0;
    for (const y of e.spacePorts as BuiltObject[]) if (y !== null && !y.hasBeenDestroyed && y.isShipYard) yards++;
    const R = SUPPLY_RULES;
    const era = Math.max(0, ...(r.goodsNow ?? []));
    const out: number[] = [];
    const urgent: number[] = [];
    const planned: number[] = [];
    for (let gi = 0; gi < GOODS.length; gi++) {
        const tNow = r.goodsNow?.[gi] ?? 0;
        const tNext = r.goodsNext[gi] ?? 0;
        const now = tNow >= needTier(gi);
        const soon = tNext >= needTier(gi);
        const top = gi === G_EXOTICS || gi === G_PRECISION;
        // Throughput for the shipyards: the hard tiers (5+) need two to four units a component, so more refineries a yard.
        const hard = Math.max(tNow, tNext) >= 5;
        let target = 0;
        if (top && (now || soon)) target = Math.min(R.maxPerGoodTop, 1 + Math.floor(yards / R.yardsPerRefineryTop));
        else if (hard) target = Math.min(R.maxPerGoodHard, 1 + Math.floor(yards / R.yardsPerRefineryHard));
        else if (now) target = Math.min(R.maxPerGood, 1 + Math.floor(yards / R.yardsPerRefinery));
        else if (soon) target = 1;
        // Ahead of tech 7: an empire in the tech-5 era plans its Exotics Lab and Precision Works (the Works needs both
        // refined inputs, so it takes the longest to come into supply).
        if (top && era >= R.planAheadTier) target = Math.max(target, 1);
        if (target === 0) continue;
        const fid = GOODS[gi].facility;
        let have = 0;
        for (const h of e.colonies) {
            const c = peekColony(galaxy, h);
            if (c === null) continue;
            have += c.facilities.filter((f) => f.id === fid).length + c.requests.filter((x) => x === fid).length;
        }
        if (have >= target) continue;
        // The goods researched components need now at a hard tier with no refinery at all first, then the rest; the
        // Exotics Lab / Precision Works planned ahead of their tier last (before 2026-10-11 they counted as urgent and
        // took the Core World sites and the treasury ahead of the Electronics Fab the yards were waiting for).
        if (have === 0 && (top ? now : tNow >= 5)) urgent.push(gi);
        else if (top && !now) planned.push(gi);
        else out.push(gi);
    }
    return [...urgent, ...out, ...planned];
}

/** The colony where `e` would place refinery `fid` (its designation, a free slot; most populous first). Pure. */
function commissionSite(galaxy: Galaxy, e: Empire, fid: FacilityId): Habitat | null {
    let best: Habitat | null = null;
    for (const h of e.colonies) {
        if (facilityRefusal(galaxy, e, h, fid) !== null) continue;
        if (best === null || (h.population?.totalAmount ?? 0) > (best.population?.totalAmount ?? 0)) best = h;
    }
    return best;
}

/**
 * A colony (cooldown over) that fits designation `d` best, to designate for a refinery: an undesignated one, else one of
 * another designation with no facility to lose (2026-10-11: the AI designates every colony early, so an empire often had
 * no undesignated colony left and never got a Core World for its Electronics Fab). Pure.
 */
function designateSite(galaxy: Galaxy, e: Empire, d: Designation): Habitat | null {
    let best: { h: Habitat; s: number } | null = null;
    const home = homeColony(e);
    for (let pass = 0; pass < 2 && best === null; pass++) {
        for (const h of e.colonies) {
            // Never the home world (the designation review gives it its best fit), never a colony too small to designate.
            if (h === home || (h.population?.totalAmount ?? 0) < AI_MIN_POPULATION) continue;
            const c = peekColony(galaxy, h);
            const cur = c?.designation ?? Designation.None;
            if (cur === d || designationCooldownDays(galaxy, h) > 0) continue;
            if (pass === 0 ? cur !== Designation.None : (c?.facilities.length ?? 0) > 0 || (c?.requests.length ?? 0) > 0) continue;
            const s = designationScores(galaxy, h).find((x) => x.designation === d)?.score ?? 0;
            if (best === null || s > best.s) best = { h, s };
        }
    }
    return best?.h ?? null;
}

/**
 * Money the AI keeps in its treasury after a commission: SUPPLY_RULES.reserveMonths of state expenses (2026-10-11: the
 * treasury paid down to a fifth of the share, and the next months' upkeep left it in the red). Pure.
 */
export function commissionReserve(galaxy: Galaxy, e: Empire): number {
    return Math.max(SUPPLY_RULES.reserveMin, (annualStateExpenses(galaxy, e) / 12) * SUPPLY_RULES.reserveMonths);
}

function aiCommission(galaxy: Galaxy, e: Empire): void {
    let started = 0;
    for (const gi of goodsWanted(galaxy, e)) {
        const fid = GOODS[gi].facility;
        const def = facilityDef(fid);
        let h = commissionSite(galaxy, e, fid);
        if (h === null && econOn(galaxy, ECON_DESIG_FLAG)) {
            const site = designateSite(galaxy, e, def.designation);
            if (site !== null && setDesignation(galaxy, e, site, def.designation)) h = commissionSite(galaxy, e, fid);
        }
        if (h === null) continue;
        const share = commissionStateShare(galaxy, e, def, h);
        // Only what the treasury can afford beyond a safe reserve, and never while it runs a deficit.
        if (e.stateMoney - share < commissionReserve(galaxy, e) || e.stateMoney < share * SUPPLY_RULES.commissionMoneyFactor) continue;
        if (calculateAnnualCashflow(galaxy, e) < 0) return;
        if (startCommission(galaxy, e, h, colonyRecord(galaxy, h), def, false) && ++started >= SUPPLY_RULES.commissionsPerReview) return;
    }
}

function alertPlayer(galaxy: Galaxy, e: Empire): void {
    const r = empireRecord(galaxy, e);
    const done = (r.alerted ??= []);
    for (const gi of goodsWanted(galaxy, e)) {
        const g = GOODS[gi];
        if (done.includes(g.key)) continue;
        if (e.colonies.some((h) => { const c = peekColony(galaxy, h); return c !== null && (c.facilities.some((f) => f.id === g.facility) || c.requests.includes(g.facility)); })) continue;
        done.push(g.key);
        const def = facilityDef(g.facility);
        const now = (r.goodsNow?.[gi] ?? 0) >= needTier(gi);
        const text = `${now ? 'Your shipyards now need' : 'Your research will soon need'} ${g.name}, and no ${def.name} of yours makes it. Request one at a ${DESIGNATION_NAMES[def.designation]} (Colony screen → Economy; the treasury can fund it, about ${Math.round(facilityPrice(galaxy, def) / 1000)}k). Builds with tech-5+ components wait at the yard until their goods arrive.`;
        scenarioMessage(galaxy, e, `Supply alert: ${g.name}`, text, { type: EmpireMessageType.GeneralWarning, subject: e.capital });
    }
}

function supplyTick(galaxy: Galaxy): void {
    if (!refinementActive(galaxy)) return;
    for (const e of galaxy.empires) {
        if (!hasPrivateSector(galaxy, e)) continue;
        if (isHumanEmpire(galaxy, e)) alertPlayer(galaxy, e);
        else aiCommission(galaxy, e);
    }
}

/** Escort wanted at `station`: ×1.5 within 2 sectors of an own working refinery (AI empires). */
function patrolPriority(galaxy: Galaxy, v: number, station: BuiltObject, e: Empire): number {
    if (!refinementActive(galaxy) || !isEconEmpire(galaxy, e) || isHumanEmpire(galaxy, e)) return v;
    const r2 = SUPPLY_RULES.patrolRange * SUPPLY_RULES.patrolRange;
    for (const h of e.colonies) {
        if ((h.xpos - station.xpos) ** 2 + (h.ypos - station.ypos) ** 2 > r2) continue;
        if (activeFacilities(galaxy, h).some((f) => GOODS.some((g) => g.facility === f.id))) return v * SUPPLY_RULES.patrolFactor;
    }
    return v;
}

registerScenarioPeriodic({ id: 'colonyEconomy.supply', flag: ECON_FLAG, periodDays: SUPPLY_RULES.reviewDays, run: (g) => supplyTick(g) });
registerScenarioQuery({ id: 'colonyEconomy.aiDesign', flag: ECON_FLAG, query: 'aiBuildDesign', run: (g, v, a) => aiDesign(g, v, a.empire) });
registerScenarioQuery({ id: 'colonyEconomy.patrol', flag: ECON_FLAG, query: 'miningStationPatrolPriority', run: (g, v, a) => patrolPriority(g, v, a.builtObject, a.empire) });
