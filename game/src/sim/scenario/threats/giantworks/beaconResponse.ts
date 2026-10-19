// The Beacon, part 4: the Reclaimers' response fleets and patrols (Giantworks wonder, flag gwBeacon). Not a port: new scenario behaviour composed of the
// stock Patrol / Move missions the rest of the Reclamation uses (beaconFleet.ts patrol).
//
// Before this, every Reclaimer warship that was not attacking sat on one post (a conquered world's garrison, the Beacon guard, a Watcher fleet at a core): nobody
// helped a world under attack and nothing moved between their systems. Now:
//   RESERVES: one fleet per beaconResponseWorldsPer held worlds (at least one) waits at a post near a harvest core. When a held world is threatened (enemy
//     warships within beaconResponseThreatRange, or enemy troops landed) the nearest reserve that, with the ships already there, outweighs the enemy by
//     beaconResponseRatioPct % goes to it (Patrol: the stock mission engages whatever is in the system); no reserve goes to a hopeless fight (counted, the
//     coalition's bait stays a bait). It returns to its post beaconResponseCalmDays after the threat is gone (or when it has lost beaconResponseMaxLossPct %).
//   PATROLS: small groups that fly a route of nearby held worlds, a few days at each (beaconPatrolDwellDays), engaging what they meet as a Patrol does. A
//     patrol that meets a superior force reports it: the nearest held world is then a threat the reserves may answer.
//   FUNDING: beaconResponseSharePct % and beaconPatrolSharePct % of every season's budget are taken from the strike groups (allotResponse) and banked; the
//     fleets are built from the bank at the Beacon, paid like every other Reclaimer ship (the free share, then the fleet biofuel).
// Rnd: none (fixed iteration orders: fleets in creation order, worlds in processing order).

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { BuiltObject } from '../../../builtObject';
import type { Habitat } from '../../../types';
import { BuiltObjectRole } from '../../../data/designSpecifications';
import { BuiltObjectSubRole } from '../../../builtObjectTypes';
import { galaxyStarDate } from '../../../tick/simTime';
import { GAME_DAY_LENGTH } from '../../hooks';
import { P, aliveShips, beaconPosition, type BeaconState, type ResponseFleet, type ResponseRec } from './beaconState';
import { ENGAGE_RANGE, WAVE_CYCLE, defencePosts, designFor, distTo, enemyStrengthNear, groupCountFor, patrol, processingWorlds, scriptedBudget, spawnShip, strengthOf } from './beaconFleet';
import { freeShare, fuelOf, liveCores, payFleet } from './beaconHarvest';

/** Most ships one fleet is built to, and ships one fleet takes from the bank in one pass. */
const FLEET_SHIPS_MAX = 24;
const BUILD_PER_PASS = 8;
/** An alert (a patrol's report) stands this many days. */
const ALERT_DAYS = 30;

function days(n: number): number {
    return n * GAME_DAY_LENGTH;
}

export function responseOf(st: BeaconState): ResponseRec {
    return (st.response ??= { fleets: [], nextId: 1, reserveAllow: 0, patrolAllow: 0, alerts: [], hopeless: [], stats: {} });
}

function stat(rs: ResponseRec, key: string, by = 1): void {
    rs.stats[key] = (rs.stats[key] ?? 0) + by;
}

/** Every ship of the response fleets and patrols (the other passes treat them as busy). Pure. */
export function responseShips(st: BeaconState): BuiltObject[] {
    return (st.response?.fleets ?? []).flatMap((f) => f.ships);
}

/**
 * A season's budget less the share put to the response fleets and patrols (banked for them): what the strike groups get. Called once a season is
 * going to be made (beginSeason, fireBeam). With the response switched off the whole budget stays with the strike groups.
 */
export function allotResponse(galaxy: Galaxy, st: BeaconState, budget: number): number {
    if (!P.respOn(galaxy) || !(budget > 0)) return budget;
    const rs = responseOf(st);
    const r = (budget * P.respSharePct(galaxy)) / 100;
    const pa = P.patrolMax(galaxy) > 0 ? (budget * P.patrolSharePct(galaxy)) / 100 : 0;
    // a bank bigger than two seasons' share is not grown any further (the fleets that do not exist or are full leave it unspent)
    const cap = 2 * budget;
    rs.reserveAllow = Math.min(cap, rs.reserveAllow + r);
    rs.patrolAllow = Math.min(cap, rs.patrolAllow + pa);
    stat(rs, 'allotted', r + pa);
    return budget - r - pa;
}

function fleetStrength(f: ResponseFleet): number {
    let s = 0;
    for (const b of f.ships) if (!b.hasBeenDestroyed) s += strengthOf(b);
    return s;
}

function lead(f: ResponseFleet): BuiltObject | null {
    return f.ships.find((b) => !b.hasBeenDestroyed) ?? null;
}

/** The strength one fleet of its kind is built to: a share of one strike group's quota of the scripted season strength. Pure. */
export function fleetWanted(galaxy: Galaxy, st: BeaconState, kind: 'reserve' | 'patrol'): number {
    const n = Math.max(1, st.stats.seasons);
    const quota = scriptedBudget(galaxy, st, n) / Math.max(1, groupCountFor(galaxy, st, n));
    return (quota * (kind === 'reserve' ? P.respFleetPct(galaxy) : P.patrolFleetPct(galaxy))) / 100;
}

/** How many reserve fleets and patrols the holdings call for. Pure. */
export function fleetCounts(galaxy: Galaxy, st: BeaconState): { reserves: number; patrols: number } {
    const held = processingWorlds(st).length;
    const reserves = Math.max(1, Math.ceil(held / P.respWorldsPer(galaxy)));
    const patrols = held >= 3 ? Math.min(P.patrolMax(galaxy), Math.ceil(held / P.patrolWorldsPer(galaxy))) : 0;
    return { reserves, patrols };
}

/** Builds ships for a fleet from its bank at the Beacon (paid: the free share, then the fleet biofuel). Returns the strength made. */
function build(galaxy: Galaxy, st: BeaconState, rs: ResponseRec, f: ResponseFleet, want: number): number {
    const faction = st.faction!;
    const pos = beaconPosition(st);
    if (pos === null || st.beaconDestroyed) return 0;
    const key = f.kind === 'reserve' ? 'reserveAllow' : 'patrolAllow';
    let made = 0;
    let have = fleetStrength(f);
    for (let i = 0; i < BUILD_PER_PASS && have < want && f.ships.length < FLEET_SHIPS_MAX && st.stats.spawned < 1_000_000; i++) {
        if (!(rs[key] > 0)) break;
        const sub = WAVE_CYCLE[f.ships.length % WAVE_CYCLE.length];
        const design = designFor(galaxy, faction, sub) ?? designFor(galaxy, faction, BuiltObjectSubRole.Cruiser);
        if (design === null) break;
        // paid like every other Reclaimer ship: the free share comes for nothing, the rest from the fleet biofuel (an empty account ends the building)
        if (freeShare(galaxy) < 1 && fuelOf(st).fleet <= 0) break;
        const bo = spawnShip(galaxy, faction, design, pos.x, pos.y);
        const s = strengthOf(bo);
        const paid = s * (1 - freeShare(galaxy));
        payFleet(st, paid);
        rs[key] = Math.max(0, rs[key] - s);
        f.ships.push(bo);
        made += s;
        have += s;
        st.stats.spawned++;
        stat(rs, 'built');
        stat(rs, 'builtStrength', s);
        if (!(s > 0)) break;
    }
    return made;
}

/** The enemy troops landed on `h` (not the Reclaimers'). Pure. */
function enemyLanded(st: BeaconState, h: Habitat): boolean {
    const inv = h.invadingTroops;
    if (inv === null || inv === undefined) return false;
    return inv.items.some((t) => (t.empire as Empire | null) !== st.faction);
}

/** The strength of the Reclaimers' warships near `h` that are not in `except`. Pure. */
function localDefence(galaxy: Galaxy, st: BeaconState, h: Habitat, range: number, except: ReadonlySet<BuiltObject>): number {
    const faction = st.faction!;
    let s = 0;
    for (const b of faction.builtObjects) {
        if (b.hasBeenDestroyed || b.role !== BuiltObjectRole.Military || b.topSpeed <= 0 || b.subRole === BuiltObjectSubRole.TroopTransport || except.has(b)) continue;
        if (distTo(galaxy, b, h.xpos, h.ypos) <= range) s += strengthOf(b);
    }
    return s;
}

interface Threat {
    world: Habitat;
    enemy: number;
    core: boolean;
}

/** The held worlds an enemy fleet or landing threatens now, and the ones a patrol reported; cores first, then the stronger enemy. */
function threatsOf(galaxy: Galaxy, st: BeaconState, rs: ResponseRec, now: number): Threat[] {
    const range = P.respThreatRange(galaxy);
    const cores = new Set(liveCores(st).map((c) => c.colony));
    const out: Threat[] = [];
    const seen = new Set<Habitat>();
    for (const r of processingWorlds(st)) {
        const h = r.colony;
        const e = enemyStrengthNear(galaxy, st, h.xpos, h.ypos, range);
        if (e > 0 || enemyLanded(st, h)) {
            out.push({ world: h, enemy: e, core: cores.has(h) });
            seen.add(h);
        }
    }
    rs.alerts = rs.alerts.filter((a) => now - a.date <= days(ALERT_DAYS) && a.world.empire === st.faction);
    for (const a of rs.alerts) {
        if (seen.has(a.world)) continue;
        seen.add(a.world);
        out.push({ world: a.world, enemy: a.enemy, core: cores.has(a.world) });
    }
    out.sort((a, b) => Number(b.core) - Number(a.core) || b.enemy - a.enemy || a.world.habitatIndex - b.world.habitatIndex);
    return out;
}

function orderAll(galaxy: Galaxy, f: ResponseFleet, where: Habitat): void {
    for (const b of f.ships) patrol(galaxy, b, where);
}

/** The reserve fleet's post for its index: the cores in turn (the Watcher fleets' defence posts), else the Beacon's star. */
function postFor(galaxy: Galaxy, st: BeaconState, i: number): Habitat | null {
    const posts = defencePosts(galaxy, st);
    return posts.length === 0 ? null : posts[i % posts.length];
}

function respondOutcome(rs: ResponseRec, f: ResponseFleet, key: string): void {
    stat(rs, key);
    f.mode = 'return';
}

// ---------------------------------------------------------------------------------------------------------------
// Reserves
// ---------------------------------------------------------------------------------------------------------------

function driveReserves(galaxy: Galaxy, st: BeaconState, rs: ResponseRec, now: number): void {
    const faction = st.faction!;
    const reserves = rs.fleets.filter((f) => f.kind === 'reserve');
    const posts = reserves.map((f) => f.post);
    reserves.forEach((f, i) => {
        // a fleet's post follows the cores: one lost or retaken is replaced
        if (f.post === null || f.post.empire !== faction || f.post.hasBeenDestroyed) f.post = postFor(galaxy, st, i);
        void posts;
    });
    const calm = days(P.respCalmDays(galaxy));
    const ratio = P.respRatioPct(galaxy) / 100;
    // the fleets already on their way or there
    for (const f of reserves) {
        const l = lead(f);
        if (l === null) continue;
        if (f.mode === 'respond') {
            const t = f.target!;
            if (t.hasBeenDestroyed || t.empire !== faction) {
                respondOutcome(rs, f, 'respLostWorld');
                if (f.post !== null) orderAll(galaxy, f, f.post);
                continue;
            }
            const e = enemyStrengthNear(galaxy, st, t.xpos, t.ypos, P.respThreatRange(galaxy));
            if (e > 0 || enemyLanded(st, t)) f.threatSeen = now;
            const s = fleetStrength(f);
            if (s < f.startStrength * (1 - P.respMaxLossPct(galaxy) / 100)) {
                respondOutcome(rs, f, 'respBeaten');
                if (f.post !== null) orderAll(galaxy, f, f.post);
            } else if (distTo(galaxy, l, t.xpos, t.ypos) <= ENGAGE_RANGE && e > s * ratio * 2.5) {
                // arrived to find far more than was reported: not a fight to take
                respondOutcome(rs, f, 'respAborted');
                if (f.post !== null) orderAll(galaxy, f, f.post);
            } else if (now - f.threatSeen >= calm) {
                respondOutcome(rs, f, 'respCleared');
                if (f.post !== null) orderAll(galaxy, f, f.post);
            }
        } else if (f.mode === 'return') {
            const post = f.post;
            if (post === null || distTo(galaxy, l, post.xpos, post.ypos) <= ENGAGE_RANGE) {
                f.mode = 'post';
                f.modeDate = now;
                f.target = null;
                stat(rs, 'returns');
            } else orderAll(galaxy, f, post);
        } else if (f.post !== null) orderAll(galaxy, f, f.post);
    }
    // dispatch: threats, cores first; the nearest reserve at its post that is strong enough
    const threats = threatsOf(galaxy, st, rs, now);
    const reach = P.respReachSectors(galaxy) * galaxy.sectorSize;
    const range = P.respThreatRange(galaxy);
    const mine = new Set<BuiltObject>(responseShips(st));
    const hopeless: Habitat[] = [];
    for (const th of threats) {
        const h = th.world;
        // ships there already (the garrison fleet, a Watcher fleet, the guard, reserves that have arrived) count, a reserve under way counts as it comes
        let there = localDefence(galaxy, st, h, range, mine);
        for (const f of rs.fleets) if (f.mode === 'respond' && f.target === h) there += fleetStrength(f);
        for (const f of rs.fleets) if (f.mode !== 'respond' || f.target !== h) {
            const l = lead(f);
            if (l !== null && distTo(galaxy, l, h.xpos, h.ypos) <= range) there += fleetStrength(f);
        }
        if (there >= th.enemy * ratio && th.enemy > 0) continue; // held already
        let best: ResponseFleet | null = null;
        let bd = Infinity;
        let strongEnough = false;
        for (const f of reserves) {
            const l = lead(f);
            if (l === null || f.mode !== 'post') continue;
            const d = distTo(galaxy, l, h.xpos, h.ypos);
            if (d > reach) continue;
            if (fleetStrength(f) + there < th.enemy * ratio) continue;
            strongEnough = true;
            if (d < bd) {
                bd = d;
                best = f;
            }
        }
        if (best === null) {
            if (!strongEnough && reserves.some((f) => f.mode === 'post' && lead(f) !== null)) {
                hopeless.push(h);
                if (!rs.hopeless.includes(h)) stat(rs, 'respRefused');
            }
            continue;
        }
        best.mode = 'respond';
        best.target = h;
        best.modeDate = now;
        best.threatSeen = now;
        best.startStrength = fleetStrength(best);
        orderAll(galaxy, best, h);
        stat(rs, 'respDispatches');
    }
    rs.hopeless = hopeless;
}

// ---------------------------------------------------------------------------------------------------------------
// Patrols
// ---------------------------------------------------------------------------------------------------------------

/** A route of up to beaconPatrolRouteLen held worlds from `seed`, each the nearest not yet taken and within beaconPatrolHopSectors of the last. Pure. */
export function patrolRoute(galaxy: Galaxy, held: readonly Habitat[], seed: Habitat, len: number, hop: number): Habitat[] {
    const route = [seed];
    while (route.length < len) {
        const last = route[route.length - 1];
        let next: Habitat | null = null;
        let bd = Infinity;
        for (const h of held) {
            if (route.includes(h)) continue;
            const d = galaxy.calculateDistance(last.xpos, last.ypos, h.xpos, h.ypos);
            if (d <= hop && d < bd) {
                bd = d;
                next = h;
            }
        }
        if (next === null) break;
        route.push(next);
    }
    return route;
}

function drivePatrols(galaxy: Galaxy, st: BeaconState, rs: ResponseRec, now: number): void {
    const faction = st.faction!;
    const held = processingWorlds(st).map((r) => r.colony);
    const patrols = rs.fleets.filter((f) => f.kind === 'patrol');
    const hop = P.patrolHopSectors(galaxy) * galaxy.sectorSize;
    const dwell = days(P.patrolDwellDays(galaxy));
    for (const f of patrols) {
        const l = lead(f);
        if (l === null) continue;
        f.route = f.route.filter((h) => !h.hasBeenDestroyed && h.empire === faction);
        if (f.route.length === 0 && held.length > 0) {
            // a new route: from the held world furthest from the other patrols' routes (nearest to this fleet among equals)
            const others = patrols.filter((o) => o !== f).flatMap((o) => o.route);
            let seed: Habitat | null = null;
            let bs = -Infinity;
            for (const h of held) {
                let m = Infinity;
                for (const o of others) m = Math.min(m, galaxy.calculateDistance(h.xpos, h.ypos, o.xpos, o.ypos));
                const score = (Number.isFinite(m) ? m : 1e9) - distTo(galaxy, l, h.xpos, h.ypos) * 1e-3;
                if (score > bs) {
                    bs = score;
                    seed = h;
                }
            }
            if (seed !== null) {
                f.route = patrolRoute(galaxy, held, seed, P.patrolRouteLen(galaxy), hop);
                f.leg = 0;
                f.arrivedAt = 0;
            }
        }
        if (f.route.length === 0) continue;
        if (f.leg >= f.route.length) f.leg = 0;
        const wp = f.route[f.leg];
        if (f.arrivedAt <= 0 && distTo(galaxy, l, wp.xpos, wp.ypos) <= ENGAGE_RANGE) f.arrivedAt = now;
        else if (f.arrivedAt > 0 && now - f.arrivedAt >= dwell && f.route.length > 1) {
            f.leg = (f.leg + 1) % f.route.length;
            f.arrivedAt = 0;
            stat(rs, 'patrolLegs');
        }
        orderAll(galaxy, f, f.route[f.leg]);
        // contact: an encounter is counted when it begins; a superior force is reported (the nearest held world is then a threat the reserves may answer)
        const e = enemyStrengthNear(galaxy, st, l.xpos, l.ypos, ENGAGE_RANGE * 1.5);
        if (e > 0 && !f.engaged) {
            f.engaged = true;
            stat(rs, 'patrolEncounters');
            if (e * 100 > fleetStrength(f) * P.patrolReportPct(galaxy)) {
                stat(rs, 'patrolReports');
                let near: Habitat | null = null;
                let nd = Infinity;
                for (const h of held) {
                    const d = distTo(galaxy, l, h.xpos, h.ypos);
                    if (d < nd) {
                        nd = d;
                        near = h;
                    }
                }
                if (near !== null && nd <= P.respThreatRange(galaxy) * 2) {
                    const a = rs.alerts.find((x) => x.world === near);
                    if (a === undefined) rs.alerts.push({ world: near, date: now, enemy: e });
                    else {
                        a.date = now;
                        a.enemy = Math.max(a.enemy, e);
                    }
                }
            }
        } else if (e <= 0) f.engaged = false;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// The driver
// ---------------------------------------------------------------------------------------------------------------

/** Every reclamation pass: the fleets are kept at the number the holdings call for, built from the banks, and driven. */
export function driveResponse(galaxy: Galaxy, st: BeaconState, now: number): void {
    const faction = st.faction;
    if (faction === null || !P.respOn(galaxy) || (st.response === undefined && st.warStarted === false)) return;
    const rs = responseOf(st);
    // losses
    for (let i = rs.fleets.length - 1; i >= 0; i--) {
        const f = rs.fleets[i];
        const before = f.ships.length;
        f.ships = aliveShips(f.ships, faction);
        if (before > f.ships.length) stat(rs, 'shipsLost', before - f.ships.length);
        if (f.ships.length === 0 && f.mode === 'respond') stat(rs, 'respDestroyed');
    }
    // the number of fleets: new empty ones as the holdings grow; an empty fleet that is no longer wanted is dropped
    const want = fleetCounts(galaxy, st);
    for (const kind of ['reserve', 'patrol'] as const) {
        const mine = rs.fleets.filter((f) => f.kind === kind);
        const n = kind === 'reserve' ? want.reserves : want.patrols;
        for (let i = mine.length; i < n; i++) {
            rs.fleets.push({ id: rs.nextId++, kind, ships: [], post: kind === 'reserve' ? postFor(galaxy, st, i) : null, mode: 'post', target: null, modeDate: now, startStrength: 0, threatSeen: 0, route: [], leg: 0, arrivedAt: 0, engaged: false });
        }
        const spare = mine.filter((f) => f.ships.length === 0);
        for (let i = mine.length - n; i > 0 && spare.length > 0; i--) rs.fleets.splice(rs.fleets.indexOf(spare.pop()!), 1);
    }
    // building: the fleets furthest below their strength first
    for (const kind of ['reserve', 'patrol'] as const) {
        const w = fleetWanted(galaxy, st, kind);
        const fleets = rs.fleets.filter((f) => f.kind === kind && f.mode !== 'respond').sort((a, b) => fleetStrength(a) - fleetStrength(b) || a.id - b.id);
        for (const f of fleets) {
            if (fleetStrength(f) >= w) continue;
            const before = f.ships.length;
            build(galaxy, st, rs, f, w);
            if (f.ships.length > before && f.kind === 'reserve' && f.post !== null) for (const b of f.ships.slice(before)) patrol(galaxy, b, f.post);
        }
    }
    driveReserves(galaxy, st, rs, now);
    drivePatrols(galaxy, st, rs, now);
}

/** A one-line account of the response (the soak hook and the tests). Pure. */
export function responseSummary(st: BeaconState): { fleets: number; reserves: number; patrols: number; ships: number; responding: number; reserveAllow: number; patrolAllow: number; stats: Record<string, number> } {
    const rs = st.response;
    if (rs === undefined) return { fleets: 0, reserves: 0, patrols: 0, ships: 0, responding: 0, reserveAllow: 0, patrolAllow: 0, stats: {} };
    return {
        fleets: rs.fleets.length,
        reserves: rs.fleets.filter((f) => f.kind === 'reserve').length,
        patrols: rs.fleets.filter((f) => f.kind === 'patrol').length,
        ships: rs.fleets.reduce((s, f) => s + f.ships.length, 0),
        responding: rs.fleets.filter((f) => f.mode === 'respond').length,
        reserveAllow: Math.round(rs.reserveAllow),
        patrolAllow: Math.round(rs.patrolAllow),
        stats: { ...rs.stats },
    };
}
