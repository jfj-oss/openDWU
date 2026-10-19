// The Beacon, part 4: the siphon, the dwell and the purge (Giantworks wonder, flag gwBeacon). Not a port.
//   SIPHON: every world the Watchers corrupted siphons the tech-5 knowledge of the empire that owns it (the nearest empire when it is
//     independent): beaconSiphonRate points a month per tech-5 technology that empire has unlocked. The Beacon can be COMPLETED only once
//     beaconSiphonRequired points have been taken (lifecycle.addProgress asks beaconKind.canComplete).
//   DWELL: a Watcher hangs over a world for 30 days (a small colony) up to 150 days (a big one) before it is corrupted.
//   PURGE: no cost. The purge makes the world REBEL (the stock rebellion: independent troops invade from inside with habitat.rebelling set; the
//     stock ground battle, the stock messages and Ground Report). The owner wins the battle: the corruption ends and the Watchers must come back
//     and re-seed it with a new dwell. The rebels win: the world secedes and stays corrupted.
// Rnd: the private Random only (rebel troops are made by the stock troop generator, which draws nothing).

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { Habitat } from '../../../types';
import type { Race } from '../../../data/races';
import { EmpireMessageType } from '../../../messages';
import { galaxyStarDate } from '../../../tick/simTime';
import { isHumanEmpire } from '../../../humanEmpires';
import { TroopList } from '../../../cargo';
import { GAME_DAY_LENGTH } from '../../hooks';
import { scenarioMessage, scenarioText as T } from '../../messages';
import { makeTroopsSplit } from '../factionNavy';
import { BEACON_FLAG, P, siphonGateOpen, siphonOf, type BeaconState, type CorruptRec } from './beaconState';

const TAG = 'Beacon';

function days(n: number): number {
    return n * GAME_DAY_LENGTH;
}

// ---------------------------------------------------------------------------------------------------------------
// The dwell
// ---------------------------------------------------------------------------------------------------------------

/** Days a Watcher hangs over a world of `pop` people before corrupting it: beaconDwellDays at beaconDwellPopLow up to beaconDwellMaxDays at beaconDwellPopHigh (log scale). Pure. */
export function dwellDaysFor(galaxy: Galaxy, pop: number): number {
    const lo = P.dwellPopLow(galaxy);
    const hi = P.dwellPopHigh(galaxy);
    const f = Math.max(0, Math.min(1, (Math.log(Math.max(1, pop)) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))));
    return P.dwellDays(galaxy) + (P.dwellMaxDays(galaxy) - P.dwellDays(galaxy)) * f;
}

// ---------------------------------------------------------------------------------------------------------------
// The siphon
// ---------------------------------------------------------------------------------------------------------------

/** The tech-5 technologies `e` has unlocked. Pure. */
export function tech5Count(e: Empire): number {
    let n = 0;
    for (const t of e.research.techTree) if (t.isResearched && t.def.techLevel === 5) n++;
    return n;
}

function normalFor(galaxy: Galaxy, st: BeaconState, e: Empire | null): e is Empire {
    return e !== null && e.active && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null && e !== st.faction;
}

/** The empire a corrupted world siphons from: its owner, else the empire with the nearest colony. Pure. */
export function siphonDonor(galaxy: Galaxy, st: BeaconState, colony: Habitat): Empire | null {
    if (normalFor(galaxy, st, colony.empire)) return colony.empire;
    let best: Empire | null = null;
    let bd = Infinity;
    for (const e of galaxy.empires) {
        if (!normalFor(galaxy, st, e)) continue;
        for (const c of e.colonies) {
            if (c.hasBeenDestroyed) continue;
            const d = galaxy.calculateDistance(c.xpos, c.ypos, colony.xpos, colony.ypos);
            if (d < bd) {
                bd = d;
                best = e;
            }
        }
    }
    return best;
}

/** Points a month `rec` siphons now. Pure. */
export function siphonRateOf(galaxy: Galaxy, st: BeaconState, rec: CorruptRec, cache?: Map<Empire, number>): number {
    const donor = siphonDonor(galaxy, st, rec.colony);
    if (donor === null) return 0;
    let n = cache?.get(donor);
    if (n === undefined) {
        n = tech5Count(donor);
        cache?.set(donor, n);
    }
    return P.siphonRate(galaxy) * n;
}

/** Credits the days since the last pass to every active corruption (before the Reclamation only). */
export function siphonPass(galaxy: Galaxy, st: BeaconState): void {
    if (st.phase !== 'watching') return;
    const rec = siphonOf(galaxy, st);
    const now = galaxyStarDate(galaxy);
    const dt = rec.last < 0 ? 0 : Math.max(0, now - rec.last) / GAME_DAY_LENGTH;
    rec.last = now;
    st.rollDate ??= now;
    const cache = new Map<Empire, number>();
    let rate = 0;
    for (const c of st.corrupted) {
        if (c.ended !== null || c.colony.hasBeenDestroyed) continue;
        const r = siphonRateOf(galaxy, st, c, cache);
        rate += r;
        if (dt <= 0 || r <= 0) continue;
        const take = (r * dt) / 30;
        c.siphoned = (c.siphoned ?? 0) + take;
        rec.total += take;
        const donor = siphonDonor(galaxy, st, c.colony);
        if (donor !== null) rec.byEmpire[String(donor.empireId)] = (rec.byEmpire[String(donor.empireId)] ?? 0) + take;
        st.stats.siphoned = (st.stats.siphoned ?? 0) + take;
    }
    // the slow baseline, for a galaxy with no tech-5 empire (or no corruptible world) for a long time
    const sinceRoll = (now - st.rollDate) / (360 * GAME_DAY_LENGTH);
    if (dt > 0 && P.siphonBaseline(galaxy) > 0 && sinceRoll >= P.siphonBaselineYears(galaxy)) {
        const take = (P.siphonBaseline(galaxy) * dt) / 30;
        rec.total += take;
        rate += P.siphonBaseline(galaxy);
        st.stats.siphoned = (st.stats.siphoned ?? 0) + take;
    }
    rec.rate = rate;
    if (rec.gateDate === 0 && siphonGateOpen(galaxy, st)) rec.gateDate = now;
}

/** The status line of the siphon for the corrupted-world row (empires that know the corruption for certain). Pure. */
export function siphonStatus(galaxy: Galaxy, st: BeaconState, c: CorruptRec): string {
    const rec = siphonOf(galaxy, st);
    const need = Math.max(1, P.siphonRequired(galaxy));
    return T(`${TAG} Siphon Status`, Math.round(c.siphoned ?? 0), Math.min(100, Math.floor((100 * rec.total) / need)), Math.round(rec.total), Math.round(need));
}

// ---------------------------------------------------------------------------------------------------------------
// The purge
// ---------------------------------------------------------------------------------------------------------------

/** The rebels' ground strength on `colony`: beaconPurgeRebelStrength for a colony of beaconPurgeRebelPopFull people, falling linearly with the population to the beaconPurgeRebelMin floor. Pure. */
export function purgeRebelStrength(galaxy: Galaxy, colony: Habitat, resistance: number): number {
    const f = Math.max(0, Math.min(1, (colony.population?.totalAmount ?? 0) / P.purgeRebelPopFull(galaxy)));
    const top = P.purgeRebelStrength(galaxy);
    const floor = Math.min(top, P.purgeRebelMin(galaxy));
    return (floor + (top - floor) * f) * resistance;
}

/** The strength of what stands against the rebels on the ground at `h` (its garrison). Pure. */
export function garrisonStrength(h: Habitat): number {
    return h.troops === null ? 0 : h.troops.totalDefendStrength;
}

export function isRebel(galaxy: Galaxy, t: { empire: unknown }): boolean {
    return t.empire === galaxy.independentEmpire || t.empire === null;
}

export function rebelsOn(galaxy: Galaxy, h: Habitat): number {
    return h.invadingTroops === null ? 0 : h.invadingTroops.items.filter((t) => isRebel(galaxy, t)).length;
}

/**
 * The purge attempt: the corrupted world rebels. Independent troops of `strength` rise on it; its owner's garrison (and what lands) fights them in
 * the stock ground battle. Returns false when the world is not the empire's, not corrupted, or a battle is already on.
 */
export function startPurge(galaxy: Galaxy, st: BeaconState, rec: CorruptRec, by: Empire, resistance: number): boolean {
    const h = rec.colony;
    if (rec.ended !== null || rec.purge !== undefined || h.hasBeenDestroyed || h.empire !== by) return false;
    if (h.invadingTroops !== null && h.invadingTroops.count > 0) return false;
    const strength = purgeRebelStrength(galaxy, h, resistance);
    const race = (h.population?.dominantRace ?? null) as Race | null;
    const rebels = makeTroopsSplit(galaxy, galaxy.independentEmpire!, strength, P.purgeRebelRegiments(galaxy), T(`${TAG} Rebels Name`), race);
    if (h.invadingTroops === null) h.invadingTroops = new TroopList();
    for (const t of rebels) {
        t.colony = h;
        h.invadingTroops.add(t);
    }
    h.rebelling = true;
    const defence = garrisonStrength(h);
    rec.purge = { by: by.empireId, start: galaxyStarDate(galaxy), strength, defence };
    st.stats.purgeTried = (st.stats.purgeTried ?? 0) + 1;
    if (isHumanEmpire(galaxy, by)) {
        scenarioMessage(galaxy, by, T(`${TAG} Purge Started Title`, h.name), T(`${TAG} Purge Started`, h.name, Math.round(strength).toLocaleString('en-US'), Math.round(defence).toLocaleString('en-US')), { type: EmpireMessageType.GeneralWarning, popup: false, subject: h });
    }
    return true;
}

/** True when the AI may try a purge of `rec`: its garrison outweighs the rebels by beaconAiPurgeMarginPct. Pure. */
export function aiMayPurge(galaxy: Galaxy, rec: CorruptRec, resistance: number): boolean {
    if (rec.purge !== undefined) return false;
    const need = purgeRebelStrength(galaxy, rec.colony, resistance) * (P.aiPurgeMarginPct(galaxy) / 100);
    return garrisonStrength(rec.colony) >= need;
}

function endPurgeFailed(galaxy: Galaxy, st: BeaconState, rec: CorruptRec, byE: Empire | undefined): void {
    st.stats.purgeFailed = (st.stats.purgeFailed ?? 0) + 1;
    rec.purge = undefined;
    if (byE !== undefined && isHumanEmpire(galaxy, byE)) {
        scenarioMessage(galaxy, byE, T(`${TAG} Purge Failed Title`, rec.colony.name), T(`${TAG} Purge Failed`, rec.colony.name), { type: EmpireMessageType.GeneralBadEvent, popup: false, subject: rec.colony });
    }
}

/** Resolves the purge battles (every pass): the rebels beaten = purged; the world lost = failed (it stays corrupted). */
export function purgePass(galaxy: Galaxy, st: BeaconState): void {
    const now = galaxyStarDate(galaxy);
    for (const rec of st.corrupted) {
        const pg = rec.purge;
        if (pg === undefined) continue;
        const h = rec.colony;
        const byE = galaxy.empires.find((e) => e !== null && e.empireId === pg.by) ?? undefined;
        if (rec.ended !== null || h.hasBeenDestroyed) {
            rec.purge = undefined;
            continue;
        }
        if (h.empire !== byE) {
            endPurgeFailed(galaxy, st, rec, byE ?? undefined);
            continue;
        }
        if (rebelsOn(galaxy, h) > 0) {
            h.rebelling = true; // (the colony tick clears it when approval is fine: the battle is a rebellion all the same)
            if (now - pg.start > days(360) && h.invadingTroops !== null) {
                for (const t of h.invadingTroops.items.filter((x) => isRebel(galaxy, x))) h.invadingTroops.remove(t);
                h.rebelling = false;
                endPurgeFailed(galaxy, st, rec, byE);
            }
            continue;
        }
        // the rebels are gone and the colony is still the owner's: the corruption is rooted out
        h.rebelling = false;
        rec.purge = undefined;
        rec.ended = 'purged';
        rec.endDate = now;
        st.stats.purged++;
        if (byE !== undefined && isHumanEmpire(galaxy, byE)) {
            scenarioMessage(galaxy, byE, T(`${TAG} Purged Title`, h.name), T(`${TAG} Purged`, h.name), { type: EmpireMessageType.GeneralGoodEvent, popup: false, subject: h });
        }
    }
}

/** A purged world is left alone by the Watchers for beaconReseedDays; after that they may come back and re-seed it (a new dwell). Pure. */
export function recentlyPurged(galaxy: Galaxy, st: BeaconState, colony: Habitat): boolean {
    const now = galaxyStarDate(galaxy);
    return st.corrupted.some((c) => c.colony === colony && c.ended === 'purged' && now - c.endDate < days(P.reseedDays(galaxy)));
}

void BEACON_FLAG;
