// The Severance's escorts (the mega-station, megaStation.ts; Giantworks Beacon, flag gwBeacon). Not a port: new scenario behaviour built from the stock
// Escort and Patrol missions (missions/assign.ts), the way rimTrade/patrol.ts escorts a Concord construction ship.
//
//   GROUPS    one escort group per CONTRIBUTING AI empire, never one per freighter (freighters leave one at a time; a group per freighter would be
//             hundreds of tiny fleets). Contributing: pledged to the structure, not a human, and it has a freighter on the way or sent one within
//             megaActiveWindowDays. When it stops contributing (or the structure is done, or goes dormant) its group is released.
//   ROUTE     the line from the empire's nearest colony (its capital if it has none) to the structure. Its escort works the route: while one of its
//             freighters is on the way the group takes the one nearest the structure on an Escort mission (stock: it follows the freighter in);
//             between freighters it Patrols the structure, guarding the arrival point.
//   DANGER    the group wants 0 ships when the route is safe. Otherwise: megaEscortBase, plus megaEscortBlockade when a hostile armed force holds
//             the structure's orbit (megaStation.ts megaBlockader), plus one ship per average warship of the empire's firepower that pirates or
//             empires at war with it hold near the route (the worst of three sample points). At most megaEscortMax. A group whose danger has gone
//             lingers megaEscortLingerDays before it goes home.
//   SPARES    only idle warships of the empire (no mission) that it can spare: it keeps megaEscortHomePct % of its warships at home, and never takes
//             one on a war mission (Attack, Blockade, Refuel...). A group ship left on an Undefined, Escort, Patrol or Move mission (the stock AI
//             sends an idle ship home by a Move) is re-tasked; a fight, a repair or a refuel is left alone.
//   CREDIT    an arrival with an Escort-mission warship (any empire's) within megaEscortNear of it is an escorted delivery: the escort's owner gets
//             war credit (beaconWarCredit.ts), and the structure counts it (MegaRec.escorted).
// Rnd: none (fixed iteration orders: contributors in pledge order, ships by builtObjectID; the stock mission assignments draw what they draw).

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { BuiltObject } from '../../../builtObject';
import type { Habitat } from '../../../types';
import { BuiltObjectRole } from '../../../data/designSpecifications';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../../../missions/mission';
import { assignMission, clearPreviousMissionRequirements } from '../../../missions/assign';
import { isAiControlled } from '../../../missions/playerOrder';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../../../diplomacy';
import { getEmpireById } from '../../../logistics/contracts';
import { getNearbyBuiltObjects } from '../../../pirates/pirateAI';
import { isHumanEmpire } from '../../../humanEmpires';
import { GAME_DAY_LENGTH } from '../../hooks';
import { firepowerByEmpireNear } from '../../orbital/orbitalSuperiority';
import { P, peekBeaconState, type MegaEscortGroup, type MegaRec } from './beaconState';
import { compactFaction } from './state';

const DAY = GAME_DAY_LENGTH;

/** The escort group of `e` (its record in mega.escorts), if it has one. */
export function escortGroupOf(mega: MegaRec, e: Empire): MegaEscortGroup | undefined {
    return mega.escorts?.[String(e.empireId)];
}

/** The number of empires with an escort group right now (one per empire, by construction). */
export function escortGroupCount(mega: MegaRec): number {
    return Object.keys(mega.escorts ?? {}).length;
}

/** `e` is contributing to the structure: an AI contributor with a freighter on the way or one sent within the active window. Pure. */
export function escortContributing(galaxy: Galaxy, mega: MegaRec, e: Empire, now: number): boolean {
    if (!mega.contributors.includes(e.empireId) || !e.active || e === galaxy.independentEmpire || e.pirateEmpireBaseHabitat !== null) return false;
    if (isHumanEmpire(galaxy, e)) return false; // a human's escort is the player's own order
    if (mega.contracts.some((c) => c.empireId === e.empireId)) return true;
    const sent = mega.lastSentBy?.[String(e.empireId)] ?? 0;
    return sent > 0 && now - sent <= P.megaActiveWindowDays(galaxy) * DAY;
}

/** Where the route starts: the nearest colony of `e` to the structure (its capital when it has none). Pure. */
function routeStart(galaxy: Galaxy, e: Empire, base: BuiltObject): { x: number; y: number } | null {
    let best: Habitat | null = null;
    let bd = Number.MAX_VALUE;
    for (const h of e.colonies) {
        if (h === null || h.empire !== e) continue;
        const d = galaxy.calculateDistance(h.xpos, h.ypos, base.xpos, base.ypos);
        if (d < bd) {
            bd = d;
            best = h;
        }
    }
    const from = best ?? e.capital;
    return from === null ? null : { x: from.xpos, y: from.ypos };
}

/** The warships of `e` (armed, built, its own): the ones it could spare and the ones it has. */
function warshipsOf(e: Empire): BuiltObject[] {
    return e.builtObjects.filter((b) => b !== null && !b.hasBeenDestroyed && b.role === BuiltObjectRole.Military && b.topSpeed > 0 && b.firepowerRaw > 0 && b.builtAt == null && b.actualEmpire === e);
}

/** The most hostile firepower on the route, at its three inner sample points (the worst one). Pure apart from the relation records. */
function routeHostileFire(galaxy: Galaxy, e: Empire, route: { x: number; y: number }, base: BuiltObject): number {
    const range = P.megaEscortRange(galaxy);
    const compact = compactFaction(galaxy);
    let worst = 0;
    for (const f of [0.25, 0.5, 0.75]) {
        const x = route.x + (base.xpos - route.x) * f;
        const y = route.y + (base.ypos - route.y) * f;
        let sum = 0;
        for (const [o, v] of firepowerByEmpireNear(galaxy, x, y, range)) {
            if (o === e || o === compact || o === galaxy.independentEmpire || !o.active) continue;
            if (o.pirateEmpireBaseHabitat !== null || obtainDiplomaticRelation(e, o).type === DiplomaticRelationType.War) sum += v;
        }
        worst = Math.max(worst, sum);
    }
    return worst;
}

/** The ships the group wants on the route now: 0 when it is safe. Pure apart from the relation records. */
export function escortWant(galaxy: Galaxy, e: Empire, base: BuiltObject, route: { x: number; y: number }, blockade: boolean): number {
    const hostile = routeHostileFire(galaxy, e, route, base);
    if (hostile <= 0 && !blockade) return 0;
    const ships = warshipsOf(e);
    const unit = ships.length > 0 ? Math.max(1, ships.reduce((a, b) => a + b.firepowerRaw, 0) / ships.length) : 1;
    const want = P.megaEscortBase(galaxy) + (blockade ? P.megaEscortBlockade(galaxy) : 0) + Math.ceil(hostile / unit);
    return Math.min(P.megaEscortMax(galaxy), Math.max(1, want));
}

/**
 * An idle warship of `e` that may take an escort: AI-controlled, no mission at all. Its fuel is not checked: the structure lies beyond any warship's
 * range from the colonies, and the freight it guards is supplied the same way (sendTo / stepContracts keep a contract freighter's fuel full).
 */
function spareShips(galaxy: Galaxy, e: Empire, near: { x: number; y: number }, taken: ReadonlySet<BuiltObject>): BuiltObject[] {
    const out: BuiltObject[] = [];
    for (const w of warshipsOf(e)) {
        if (taken.has(w) || !isAiControlled(w)) continue;
        const m = builtObjectMission(w.mission);
        if (m !== null && m.type !== BuiltObjectMissionType.Undefined) continue;
        out.push(w);
    }
    const d = (w: BuiltObject): number => galaxy.calculateDistance(w.xpos, w.ypos, near.x, near.y);
    return out.sort((a, b) => d(a) - d(b) || a.builtObjectID - b.builtObjectID);
}

/** Hands one escort back to its owner's stock control (only a group's own Escort / Patrol mission is cleared). */
function freeEscort(galaxy: Galaxy, w: BuiltObject): void {
    if (w.hasBeenDestroyed) return;
    const m = builtObjectMission(w.mission);
    if (m === null || (m.type !== BuiltObjectMissionType.Escort && m.type !== BuiltObjectMissionType.Patrol)) return;
    clearPreviousMissionRequirements(galaxy, w);
    m.clear();
    w.firstExecutionOfCommand = true;
}

/**
 * The stock refuel leaves a warship alone while it escorts a contract freighter of the Severance: the refuelling point is far from the structure, so
 * the stock rule (refuel once the fuel is below the way back) would pull every escort off its freight; the freight is supplied (supplyEscorts). Pure.
 */
export function escortsFreight(galaxy: Galaxy, bo: BuiltObject): boolean {
    const mega = peekBeaconState(galaxy)?.mega;
    if (mega === undefined || mega.status === 'dormant' || mega.status === 'fired') return false;
    if (Object.values(mega.escorts ?? {}).some((g) => g.ships.includes(bo))) return true; // an AI escort group: its ships are supplied for the run
    const m = builtObjectMission(bo.mission);
    if (m === null || m.type !== BuiltObjectMissionType.Escort || m.targetBuiltObject === null) return false;
    return freightTarget(galaxy, mega, m.targetBuiltObject);
}

/**
 * A freighter of the Severance's freight: one on its way (a contract), or one that has just delivered and waits by the structure (within
 * megaEscortNear of it: its escort is still with it). Pure.
 */
function freightTarget(galaxy: Galaxy, mega: MegaRec, t: BuiltObject): boolean {
    if (mega.contracts.some((c) => c.ship === t)) return true;
    const base = mega.base;
    return base !== undefined && base !== null && !base.hasBeenDestroyed && galaxy.calculateDistance(t.xpos, t.ypos, base.xpos, base.ypos) <= P.megaEscortNear(galaxy);
}

/**
 * The escorts of the freight are supplied as the freight is (stepContracts keeps a contract freighter's fuel full): an Escort-mission warship, of any
 * empire, within megaEscortNear of a contract freighter has its fuel kept full, so the stock refuel does not pull it off the escort on the way in.
 */
export function supplyEscorts(galaxy: Galaxy, mega: MegaRec): void {
    const base = mega.base;
    const freight = new Set<BuiltObject>(mega.contracts.map((c) => c.ship));
    if (base !== undefined && base !== null && !base.hasBeenDestroyed) {
        for (const f of getNearbyBuiltObjects(galaxy, base.xpos, base.ypos, P.megaEscortNear(galaxy))) if (f != null && f.role === BuiltObjectRole.Freight && freightTarget(galaxy, mega, f)) freight.add(f);
    }
    for (const g of Object.values(mega.escorts ?? {})) for (const w of g.ships) if (!w.hasBeenDestroyed && w.fuelCapacity > 0) w.currentFuel = w.fuelCapacity;
    for (const f of freight) {
        if (f.hasBeenDestroyed) continue;
        for (const w of getNearbyBuiltObjects(galaxy, f.xpos, f.ypos, P.megaEscortNear(galaxy))) {
            if (w == null || w === f || w.hasBeenDestroyed || !(w.fuelCapacity > 0)) continue;
            const m = builtObjectMission(w.mission);
            if (m !== null && m.type === BuiltObjectMissionType.Escort && m.targetBuiltObject === f) w.currentFuel = w.fuelCapacity;
        }
    }
}

/** Releases `e`'s group (the group record goes; its ships go back to their empire's stock control). */
function releaseGroup(galaxy: Galaxy, mega: MegaRec, key: string): void {
    const grp = mega.escorts?.[key];
    if (grp === undefined) return;
    for (const w of grp.ships) freeEscort(galaxy, w);
    delete mega.escorts![key];
}

/** Releases every group (the structure is done, dormant or gone). */
export function releaseEscorts(galaxy: Galaxy, mega: MegaRec): void {
    for (const key of Object.keys(mega.escorts ?? {})) releaseGroup(galaxy, mega, key);
}

/** The freighter of `e` on the way that is nearest the structure (the group's escort target), or null. */
function escortTarget(mega: MegaRec, e: Empire, base: BuiltObject, galaxy: Galaxy): BuiltObject | null {
    let best: BuiltObject | null = null;
    let bd = Number.MAX_VALUE;
    for (const c of mega.contracts) {
        const b = c.ship;
        if (c.empireId !== e.empireId || b.hasBeenDestroyed || b.actualEmpire !== e) continue;
        const d = galaxy.calculateDistance(b.xpos, b.ypos, base.xpos, base.ypos);
        if (d < bd) {
            bd = d;
            best = b;
        }
    }
    return best;
}

/** One empire's group for the day: sized to its danger, recruited from its spares, pointed at the route. */
function escortFor(galaxy: Galaxy, mega: MegaRec, e: Empire, base: BuiltObject, now: number, blockade: boolean): void {
    const key = String(e.empireId);
    const route = routeStart(galaxy, e, base);
    let grp = escortGroupOf(mega, e);
    if (grp !== undefined) grp.ships = grp.ships.filter((w) => !w.hasBeenDestroyed && w.actualEmpire === e);
    let want = route === null ? 0 : escortWant(galaxy, e, base, route, blockade);
    if (want === 0 && grp !== undefined && grp.ships.length > 0) {
        if (grp.quietSince === 0) grp.quietSince = now;
        want = now - grp.quietSince < P.megaEscortLingerDays(galaxy) * DAY ? grp.ships.length : 0;
    } else if (grp !== undefined) {
        grp.quietSince = 0;
    }
    if (want === 0) {
        if (grp !== undefined) releaseGroup(galaxy, mega, key);
        return;
    }
    if (route === null) return;
    if (grp === undefined) {
        grp = { ships: [], since: now, quietSince: 0 };
        mega.escorts ??= {};
        mega.escorts[key] = grp;
    }
    // recruit: idle spares beyond the home share, nearest the route's start
    const have = grp.ships.length;
    if (have < want) {
        const warships = warshipsOf(e).length;
        const floor = Math.ceil((warships * P.megaEscortHomePct(galaxy)) / 100);
        const allowance = warships - have - floor;
        const taken = new Set(grp.ships);
        const fresh = spareShips(galaxy, e, route, taken).slice(0, Math.max(0, Math.min(want - have, allowance)));
        for (const w of fresh) grp.ships.push(w);
    }
    // shrink: the latest recruits go first
    while (grp.ships.length > want) {
        const w = grp.ships.pop()!;
        freeEscort(galaxy, w);
    }
    // point the group: its freighter on the way, else the structure (fuel kept full, as the freight's is)
    const target = escortTarget(mega, e, base, galaxy);
    for (const w of grp.ships) {
        if (w.fuelCapacity > 0) w.currentFuel = w.fuelCapacity;
        w.refuelForNextMission = false; // (the civilian AI would send a flagged idle ship to refuel)
        const m = builtObjectMission(w.mission);
        const t = m === null ? BuiltObjectMissionType.Undefined : m.type;
        if (t !== BuiltObjectMissionType.Undefined && t !== BuiltObjectMissionType.Escort && t !== BuiltObjectMissionType.Patrol && t !== BuiltObjectMissionType.Move) continue; // a fight, a repair or a refuel stays as it is
        if (target !== null) {
            if (t === BuiltObjectMissionType.Escort && m!.targetBuiltObject === target) continue;
            assignMission(galaxy, w, BuiltObjectMissionType.Escort, target, null, BuiltObjectMissionPriority.Normal);
        } else {
            if (t === BuiltObjectMissionType.Patrol && m!.targetBuiltObject === base) continue;
            assignMission(galaxy, w, BuiltObjectMissionType.Patrol, base, null, BuiltObjectMissionPriority.Normal);
        }
    }
    if (grp.ships.length === 0) delete mega.escorts![key];
}

/**
 * The daily step (megaStep, after the arrivals and before the firing): releases the groups of the empires that stopped contributing, then sizes
 * and points each contributing AI empire's group. Nothing happens without an escort switch, a structure with a base, or a contributor.
 */
export function escortStep(galaxy: Galaxy, mega: MegaRec, base: BuiltObject, now: number, blockade: boolean): void {
    if (!P.megaEscortOn(galaxy)) return;
    for (const key of Object.keys(mega.escorts ?? {})) {
        const e = getEmpireById(galaxy, Number(key));
        if (e === null || !escortContributing(galaxy, mega, e, now)) releaseGroup(galaxy, mega, key);
    }
    for (const id of mega.contributors) {
        const e = getEmpireById(galaxy, id);
        if (e === null || !escortContributing(galaxy, mega, e, now)) continue;
        escortFor(galaxy, mega, e, base, now, blockade);
    }
}

/**
 * The escort that is with a freighter as it arrives: the nearest warship within megaEscortNear of it on an Escort mission (any empire's), or null.
 * Returns the empire that controls it (the war credit's owner).
 */
export function escortAtArrival(galaxy: Galaxy, freighter: BuiltObject): Empire | null {
    const range = P.megaEscortNear(galaxy);
    let best: BuiltObject | null = null;
    let bd = Number.MAX_VALUE;
    for (const w of getNearbyBuiltObjects(galaxy, freighter.xpos, freighter.ypos, range)) {
        if (w == null || w === freighter || w.hasBeenDestroyed || !(w.firepowerRaw > 0) || w.actualEmpire === null) continue;
        const m = builtObjectMission(w.mission);
        if (m === null || m.type !== BuiltObjectMissionType.Escort) continue;
        const d = galaxy.calculateDistance(w.xpos, w.ypos, freighter.xpos, freighter.ypos);
        if (d < bd || (d === bd && best !== null && w.builtObjectID < best.builtObjectID)) {
            bd = d;
            best = w;
        }
    }
    return best === null ? null : best.actualEmpire;
}
