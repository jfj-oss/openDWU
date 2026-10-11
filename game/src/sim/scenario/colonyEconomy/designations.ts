// Colony Economy: colony designations (docs/ECONOMY.md §2). Not a port. Setting one (player command or AI), the change
// cooldown, the suggestion from the colony's resources / quality / luxuries / location, and the AI's designation
// review. The bonuses and drawbacks are in effects.ts. No Rnd anywhere here (every pick is by score with id tie-breaks).

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import { resourceGroupOf, ResourceGroup } from '../../resourceSystem';
import { galaxyStarDate } from '../../tick/simTime';
import {
    DAY,
    DESIGNATIONS,
    DESIGNATION_NAMES,
    Designation,
    ECON_DESIG_FLAG,
    ECON_FLAG,
    YEAR,
    bumpEcon,
    colonyRecord,
    econOn,
    econParam,
    facilityDef,
    isEconEmpire,
    peekColony,
    type EconColony,
} from './common';
import { registerScenarioEvent, registerScenarioPeriodic } from '../hooks';
import { isHumanEmpire } from '../../humanEmpires';
import { performPrivateTransaction } from '../../treasury';

/** Share of a closed facility's price the private sector gets back. */
export const CLOSE_REFUND = 0.25;

/** Ranges (galaxy units; a sector is 2,000,000). */
export const SECTOR = 2_000_000;

export interface DesignationScore {
    designation: Designation;
    score: number;
    reasons: string[];
}

function dist(a: { xpos: number; ypos: number }, b: { xpos: number; ypos: number }): number {
    return Math.hypot(a.xpos - b.xpos, a.ypos - b.ypos);
}

function groupOfId(galaxy: Galaxy, resourceId: number): ResourceGroup {
    const r = galaxy.resources[resourceId] ?? galaxy.resources.find((x) => x.resourceId === resourceId);
    return r === undefined ? ResourceGroup.Undefined : resourceGroupOf(r);
}

/** Scores of every designation for `h` (higher = better fit, 0-100ish), best first. Pure. */
export function designationScores(galaxy: Galaxy, h: Habitat): DesignationScore[] {
    const e = h.empire;
    const pop = h.population?.totalAmount ?? 0;
    const quality = h.quality;
    const scenic = h.scenicFactor;
    let luxuries = 0;
    let minerals = 0;
    for (const r of h.resources) {
        const g = groupOfId(galaxy, r.resourceId);
        if (g === ResourceGroup.Luxury) luxuries++;
        else if (g === ResourceGroup.Mineral || g === ResourceGroup.Gas) minerals += r.abundance;
    }
    // Uncolonised deposits in the system (what mining stations here would work).
    let systemDeposits = 0;
    for (const o of galaxy.systemHabitatsOf(h.systemIndex)) {
        if (o === h || (o.empire !== null && o.empire !== galaxy.independentEmpire)) continue;
        for (const r of o.resources) {
            const g = groupOfId(galaxy, r.resourceId);
            if (g === ResourceGroup.Mineral || g === ResourceGroup.Gas) systemDeposits += r.abundance;
        }
    }
    let stationsNear = 0;
    let coloniesNear = 0;
    let foreignNear = 0;
    if (e !== null) {
        for (const m of e.miningStations) if (m !== null && !m.hasBeenDestroyed && Math.hypot(m.xpos - h.xpos, m.ypos - h.ypos) < 2 * SECTOR) stationsNear++;
        for (const c of e.colonies) if (c !== h && dist(c, h) < 3 * SECTOR) coloniesNear++;
        for (const o of galaxy.empires) {
            if (o === e || !o.active || o.colonies.length === 0) continue;
            const hostile = o.pirateEmpireBaseHabitat !== null;
            for (const c of o.colonies) {
                if (dist(c, h) < 2 * SECTOR) {
                    foreignNear += hostile ? 2 : 1;
                    break;
                }
            }
        }
    }
    const isCapital = e !== null && e.capital === h;
    const dCap = e !== null && e.capital !== null && !isCapital ? dist(e.capital, h) : 0;
    const width = Math.max(1, galaxy.sizeX);
    const port = h.hasSpacePort || h.basesAtHabitat.some((b) => b !== null && !b.hasBeenDestroyed && b.isSpacePort);
    const yard = h.basesAtHabitat.some((b) => b !== null && !b.hasBeenDestroyed && b.isShipYard);
    const cl = (x: number) => Math.max(0, Math.min(1, x));
    const out: DesignationScore[] = [];
    const add = (designation: Designation, parts: [number, string][]) => {
        let score = 0;
        const reasons: string[] = [];
        for (const [v, why] of parts) {
            score += v;
            if (v >= 8) reasons.push(why);
        }
        out.push({ designation, score: Math.round(score), reasons });
    };
    add(Designation.Industrial, [
        [yard ? 30 : port ? 15 : 0, 'has a shipyard'],
        [25 * cl(pop / 3e9), 'large workforce'],
        [15 * cl(minerals / 1500), 'minerals on the planet'],
        [10 * cl(stationsNear / 3), 'mining stations nearby'],
    ]);
    add(Designation.TradeHub, [
        [port ? 25 : 0, 'has a space port'],
        [25 * cl(coloniesNear / 6), 'central to your colonies'],
        [15 * cl(luxuries / 2), 'luxury resources'],
        [e !== null && e.capital !== null ? 10 * cl(1 - dCap / (0.25 * width)) : 0, 'close to the capital'],
    ]);
    add(Designation.Resort, [
        [50 * cl(scenic / 1.5), 'scenic'],
        [20 * cl(quality), 'high quality'],
        [12 * cl(luxuries / 2), 'luxury resources'],
    ]);
    // The bonus works on mining stations: without any nearby, rich deposits count for half.
    add(Designation.MiningHub, [
        [35 * cl(stationsNear / 4), 'mining stations nearby'],
        [(stationsNear > 0 ? 25 : 12) * cl(systemDeposits / 10000), 'rich deposits in the system'],
        [10 * cl(minerals / 1500), 'minerals on the planet'],
        [-10 * cl(quality), ''],
    ]);
    add(Designation.CoreWorld, [
        [isCapital ? 60 : 0, 'the capital'],
        [30 * cl(pop / 5e9), 'large population'],
        [20 * cl(quality), 'high quality'],
    ]);
    add(Designation.Frontier, [
        [40 * cl(dCap / (0.35 * width)), 'far from the capital'],
        [15 * Math.min(2, foreignNear), 'foreign or pirate colonies nearby'],
        [-20 * cl(quality), ''],
        [isCapital ? -50 : 0, ''],
    ]);
    out.sort((a, b) => b.score - a.score || a.designation - b.designation);
    return out;
}

/** The suggested designation and why (the colony screen). Pure. */
export function suggestDesignation(galaxy: Galaxy, h: Habitat): DesignationScore {
    return designationScores(galaxy, h)[0];
}

/** Days left on the colony's designation change cooldown (0: may change). Pure. */
export function designationCooldownDays(galaxy: Galaxy, h: Habitat): number {
    const c = peekColony(galaxy, h);
    if (c === null || c.changedAt < 0) return 0;
    const until = c.changedAt + econParam(galaxy, 'econCooldownYears') * YEAR;
    return Math.max(0, Math.ceil((until - galaxyStarDate(galaxy)) / DAY));
}

/** Why `empire` may not set `d` at `h` now (null: it may). Pure. */
export function designationRefusal(galaxy: Galaxy, empire: Empire, h: Habitat, d: Designation): string | null {
    if (!econOn(galaxy, ECON_DESIG_FLAG)) return 'Colony designations are off';
    if (h.empire !== empire || !isEconEmpire(galaxy, empire)) return 'Not your colony';
    if (!DESIGNATIONS.includes(d) && d !== Designation.None) return 'Unknown designation';
    const c = peekColony(galaxy, h);
    if ((c?.designation ?? Designation.None) === d) return 'Already designated';
    const left = designationCooldownDays(galaxy, h);
    if (left > 0) return `The designation can change again in ${left} days`;
    return null;
}

/** Facilities a change to `d` would close (off-designation facilities cannot stand). Pure. */
export function facilitiesLostByChange(galaxy: Galaxy, h: Habitat, d: Designation): string[] {
    const c = peekColony(galaxy, h);
    if (c === null) return [];
    return c.facilities.filter((f) => facilityDef(f.id).designation !== d).map((f) => facilityDef(f.id).name);
}

/**
 * Sets the designation (player command or AI). Facilities of another designation close (the private sector gets a
 * quarter of their price back); waiting requests of another designation are dropped. Returns false when refused.
 */
export function setDesignation(galaxy: Galaxy, empire: Empire, h: Habitat, d: Designation): boolean {
    if (designationRefusal(galaxy, empire, h, d) !== null) return false;
    const c = colonyRecord(galaxy, h);
    applyDesignation(galaxy, h, c, d);
    return true;
}

function applyDesignation(galaxy: Galaxy, h: Habitat, c: EconColony, d: Designation): void {
    const e = h.empire;
    const keep = c.facilities.filter((f) => facilityDef(f.id).designation === d);
    if (e !== null) {
        for (const f of c.facilities) if (!keep.includes(f)) performPrivateTransaction(e, f.cost * CLOSE_REFUND);
    }
    c.facilities = keep;
    c.requests = c.requests.filter((id) => facilityDef(id).designation === d);
    c.designation = d;
    c.changedAt = galaxyStarDate(galaxy);
    bumpEcon(galaxy);
}

// ---------------------------------------------------------------------------------------------------------------
// AI designation review (every AI empire, and the player's colonies only when the player asks — never automatic)
// ---------------------------------------------------------------------------------------------------------------

/** Minimum population (individuals) before the AI designates a colony. */
export const AI_MIN_POPULATION = 40_000_000;
/** The AI designates when the best score reaches this, and re-designates only for a much better fit. */
export const AI_MIN_SCORE = 30;
export const AI_REDESIGNATE_RATIO = 1.6;

/** The AI's pick for `h` (null: keep what it has). Same-designation crowding lowers a score a little. Pure. */
export function aiDesignationChoice(galaxy: Galaxy, e: Empire, h: Habitat, counts: ReadonlyMap<Designation, number>): Designation | null {
    if ((h.population?.totalAmount ?? 0) < AI_MIN_POPULATION && e.capital !== h) return null;
    const cur = peekColony(galaxy, h);
    const current = cur?.designation ?? Designation.None;
    if (current !== Designation.None && designationCooldownDays(galaxy, h) > 0) return null;
    const n = Math.max(1, e.colonies.length);
    const scores = designationScores(galaxy, h).map((s) => {
        const same = counts.get(s.designation) ?? 0;
        // Spread: past a fair share of the empire's colonies, each further one of a kind scores lower.
        const crowd = Math.max(0, same - Math.ceil(n / 6)) * 15;
        return { ...s, score: s.designation === current ? s.score : s.score - crowd };
    });
    scores.sort((a, b) => b.score - a.score || a.designation - b.designation);
    const best = scores[0];
    if (best.score < AI_MIN_SCORE) return null;
    if (current === Designation.None) return best.designation;
    if (best.designation === current) return null;
    const curScore = scores.find((s) => s.designation === current)?.score ?? 0;
    // A colony with facilities keeps its designation unless the fit is far better.
    const built = (cur?.facilities.length ?? 0) > 0;
    if (best.score >= Math.max(1, curScore) * (built ? AI_REDESIGNATE_RATIO * 1.5 : AI_REDESIGNATE_RATIO)) return best.designation;
    return null;
}

/** One AI empire's designation review: at most `maxChanges` changes, best gains first. */
export function reviewAiDesignations(galaxy: Galaxy, e: Empire, maxChanges = 3): number {
    const counts = new Map<Designation, number>();
    for (const h of e.colonies) {
        const d = peekColony(galaxy, h)?.designation ?? Designation.None;
        counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    let changes = 0;
    const colonies = [...e.colonies].sort((a, b) => (b.population?.totalAmount ?? 0) - (a.population?.totalAmount ?? 0) || a.habitatIndex - b.habitatIndex);
    for (const h of colonies) {
        if (changes >= maxChanges) break;
        const d = aiDesignationChoice(galaxy, e, h, counts);
        if (d === null) continue;
        const old = peekColony(galaxy, h)?.designation ?? Designation.None;
        if (!setDesignation(galaxy, e, h, d)) continue;
        counts.set(old, (counts.get(old) ?? 1) - 1);
        counts.set(d, (counts.get(d) ?? 0) + 1);
        changes++;
    }
    return changes;
}

function designationReview(galaxy: Galaxy): void {
    for (const e of galaxy.empires) {
        if (!isEconEmpire(galaxy, e) || isHumanEmpire(galaxy, e)) continue;
        reviewAiDesignations(galaxy, e);
    }
}

// A colony that changes hands keeps its designation and facilities (the buildings stand), but the new owner may
// re-designate at once; a destroyed / abandoned colony loses its record.
function onOwnerChanged(galaxy: Galaxy, p: { colony: Habitat; from: Empire | null; to: Empire | null }): void {
    bumpEcon(galaxy);
    const c = peekColony(galaxy, p.colony);
    if (c === null) {
        if (p.to !== null && isEconEmpire(galaxy, p.to)) colonyRecord(galaxy, p.colony).foundedAt = galaxyStarDate(galaxy);
        return;
    }
    if (p.to === null || !isEconEmpire(galaxy, p.to)) {
        c.designation = Designation.None;
        c.facilities = [];
        c.requests = [];
        c.changedAt = -1;
        return;
    }
    c.changedAt = -1;
    c.requests = [];
    c.foundedAt = galaxyStarDate(galaxy);
}

function onColonyFounded(galaxy: Galaxy, p: { colony: Habitat; empire: Empire }): void {
    if (!isEconEmpire(galaxy, p.empire)) return;
    colonyRecord(galaxy, p.colony).foundedAt = galaxyStarDate(galaxy);
}

registerScenarioPeriodic({ id: 'colonyEconomy.designations', flag: ECON_FLAG, periodDays: 180, run: (g) => econOn(g, ECON_DESIG_FLAG) && designationReview(g) });
registerScenarioEvent({ id: 'colonyEconomy.owner', flag: ECON_FLAG, event: 'colonyOwnerChanged', run: onOwnerChanged });
registerScenarioEvent({ id: 'colonyEconomy.founded', flag: ECON_FLAG, event: 'colonyFounded', run: onColonyFounded });

export { DESIGNATION_NAMES };
