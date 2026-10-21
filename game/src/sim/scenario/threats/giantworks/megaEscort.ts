// The Severance's escorts (the mega-station, megaStation.ts; Giantworks Beacon, flag gwBeacon). Not a port: new scenario behaviour built from the stock
// Escort and Patrol missions (missions/assign.ts), the way rimTrade/patrol.ts escorts a Concord construction ship.
//
//   GROUPS    one escort group per CONTRIBUTING AI empire, never one per freighter (freighters leave one at a time; a group per freighter would be
//             hundreds of tiny fleets). Contributing: pledged to the structure, not a human, and it has a freighter on the way or sent one within
//             megaActiveWindowDays. When it stops contributing (or the structure is done, or goes dormant) its group is released.
//   ROUTE     the line from the empire's nearest colony (its capital if it has none) to the structure. The group guards the structure's arrival point:
//             it Patrols the structure, and while a freighter of the empire is within five megaEscortNear of it, takes that one on an Escort mission
//             (stock: it follows the freighter in). It does not chase a freighter across the hyperjumps of the route (see escortFor).
//   DANGER    the group wants 0 ships when the route is safe. Otherwise: megaEscortBase, plus megaEscortBlockade when a hostile armed force holds
//             the structure's orbit (megaStation.ts megaBlockader), plus one ship per average warship of the empire's firepower that pirates or
//             empires at war with it hold near the route (the worst of three sample points). At most megaEscortMax. A group whose danger has gone
//             lingers megaEscortLingerDays before it goes home.
//   FLEETS    the stock maintainShipGroups folds an idle warship into a fleet, and a fleet's refuel and waypoint missions override its members: a
//             group ship is never folded into one (maintainShipGroups leaves it out, the shipFleetExempt query), and a warship already in a fleet is not
//             recruited (it is the fleet's; a group ship that joins one leaves the group).
//   SPARES    only idle warships of the empire (no mission at all, not in a fleet) that it can spare: it keeps megaEscortHomePct % of its idle warships
//             at home (the floor is counted over the ships at home, not over all its warships), and, while it is at war, never takes one near a war
//             front (hostile firepower within megaEscortRange). It never takes one on a war mission (Attack, Blockade, Refuel...). A group ship left on
//             an Undefined, Escort, Patrol or Move mission (the stock AI sends an idle ship home by a Move) is re-tasked; a fight, a repair or a refuel
//             is left alone.
//   KEEP      a freighter's mission ends when it arrives, a moment before its delivery is counted, and the stock Escort command would end with it
//             and hand the escort to automation: the command is held while the freight is at the structure (escortHeld, cmdEscort). A delivered
//             freighter's escort (a group ship, or a player's order still on Escort to it) goes on Patrol of the structure at once
//             (keepEscortsOnDelivery). A player's escort is a guard only while its record is live (MegaRec.guards: no order change, in the base area, within megaGuardDays of its last delivery); a guard is supplied and not refuelled, as a group's ships are (escortsFreight).
//   CREDIT    an arrival with an armed warship within megaEscortNear of it that really escorts THAT freighter (an Escort mission to it, or a group ship
//             of the freighter's own empire; counted by assignment, so a group ship re-tasked a moment before still counts), of its own empire or of an
//             empire not at war with it, is an escorted delivery: the escort's owner gets war credit (beaconWarCredit.ts), and the structure counts it
//             (MegaRec.escorted). One credit at most per delivery. Freight is a contract freighter only (freightTarget).
// Rnd: none (fixed iteration orders: contributors in pledge order, ships by builtObjectID; the stock mission assignments draw what they draw).

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { BuiltObject } from '../../../builtObject';
import type { Habitat } from '../../../types';
import { BuiltObjectRole } from '../../../data/designSpecifications';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../../../missions/mission';
import { assignMission, clearPreviousMissionRequirements } from '../../../missions/assign';
import { isAiControlled, markPlayerOrder } from '../../../missions/playerOrder';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../../../diplomacy';
import { getEmpireById } from '../../../logistics/contracts';
import { getNearbyBuiltObjects } from '../../../pirates/pirateAI';
import { isHumanEmpire } from '../../../humanEmpires';
import { GAME_DAY_LENGTH } from '../../hooks';
import { firepowerByEmpireNear } from '../../orbital/orbitalSuperiority';
import { P, peekBeaconState, type MegaEscortGroup, type MegaGuard, type MegaRec } from './beaconState';
import { galaxyStarDate } from '../../../tick/simTime';
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

/** The firepower of the pirates and the empires at war with `e` within `range` of (x, y). Pure apart from the relation records. */
function hostileFireNear(galaxy: Galaxy, e: Empire, x: number, y: number, range: number): number {
    const compact = compactFaction(galaxy);
    let sum = 0;
    for (const [o, v] of firepowerByEmpireNear(galaxy, x, y, range)) {
        if (o === e || o === compact || o === galaxy.independentEmpire || !o.active) continue;
        if (o.pirateEmpireBaseHabitat !== null || obtainDiplomaticRelation(e, o).type === DiplomaticRelationType.War) sum += v;
    }
    return sum;
}

/** The most hostile firepower on the route, at its three inner sample points (the worst one). Pure apart from the relation records. */
function routeHostileFire(galaxy: Galaxy, e: Empire, route: { x: number; y: number }, base: BuiltObject): number {
    const range = P.megaEscortRange(galaxy);
    let worst = 0;
    for (const f of [0.25, 0.5, 0.75]) {
        worst = Math.max(worst, hostileFireNear(galaxy, e, route.x + (base.xpos - route.x) * f, route.y + (base.ypos - route.y) * f, range));
    }
    return worst;
}

/** `e` is at war with a real empire (a pirate is hostile without it). Pure apart from the relation records. */
function atWarWithAnyone(galaxy: Galaxy, e: Empire): boolean {
    return galaxy.empires.some((o) => o !== null && o !== e && o.active && o !== galaxy.independentEmpire && obtainDiplomaticRelation(e, o).type === DiplomaticRelationType.War);
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
 * An idle warship of `e` that may take an escort: AI-controlled, no mission at all, not in a stock fleet (a fleet's ships are the fleet's), and, while `e`
 * is at war, not near a war front (hostile firepower within megaEscortRange of it). Its fuel is not checked: the structure lies beyond any warship's
 * range from the colonies, and the freight it guards is supplied the same way (sendTo / stepContracts keep a contract freighter's fuel full).
 */
function spareShips(galaxy: Galaxy, e: Empire, near: { x: number; y: number }, taken: ReadonlySet<BuiltObject>): BuiltObject[] {
    const out: BuiltObject[] = [];
    const atWar = atWarWithAnyone(galaxy, e);
    for (const w of warshipsOf(e)) {
        if (taken.has(w) || !isAiControlled(w) || w.shipGroup !== null) continue;
        const m = builtObjectMission(w.mission);
        if (m !== null && m.type !== BuiltObjectMissionType.Undefined) continue;
        if (atWar && hostileFireNear(galaxy, e, w.xpos, w.ypos, P.megaEscortRange(galaxy)) > 0) continue;
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

/** A player's escort on guard may be this far from the structure (the base area; the guard is kept to it). */
function guardRange(galaxy: Galaxy): number {
    return 5 * P.megaEscortNear(galaxy);
}

/**
 * A player's escort on guard that is still a guard: it has a live record (no new delivery for megaGuardDays runs out), its order is still the player's
 * Patrol of the structure, and it is in the base area. Pure.
 */
function guardLive(galaxy: Galaxy, mega: MegaRec, g: MegaGuard, now: number): boolean {
    const bo = g.ship;
    const base = mega.base;
    if (bo.hasBeenDestroyed || base === undefined || base === null || base.hasBeenDestroyed || now - g.since > P.megaGuardDays(galaxy) * DAY) return false;
    const m = builtObjectMission(bo.mission);
    if (m === null || m.type !== BuiltObjectMissionType.Patrol || m.targetBuiltObject !== base || m.playerOrdered !== true) return false;
    return galaxy.calculateDistance(bo.xpos, bo.ypos, base.xpos, base.ypos) <= guardRange(galaxy);
}

/** Records a player's escort as a guard of the structure from `now` (keepEscortsOnDelivery). Rnd: none. */
function addGuard(galaxy: Galaxy, mega: MegaRec, bo: BuiltObject): void {
    const now = galaxyStarDate(galaxy);
    mega.guards ??= [];
    const g = mega.guards.find((x) => x.ship === bo);
    if (g !== undefined) g.since = now;
    else mega.guards.push({ ship: bo, since: now });
}

/** Drops the guard records that no longer hold (the order was changed, the ship left the base area, or its guard time ran out). */
function pruneGuards(galaxy: Galaxy, mega: MegaRec, now: number): void {
    if (mega.guards === undefined) return;
    mega.guards = mega.guards.filter((g) => guardLive(galaxy, mega, g, now));
    if (mega.guards.length === 0) delete mega.guards;
}

/**
 * The stock refuel leaves a warship alone while it is one of the Severance's escorts: an AI group ship, a player's escort on an Escort mission to a
 * contract freighter (on its way to it), or a player's escort on guard at the structure (a live guard record, see addGuard). The rest of the map is the
 * stock's: a player's Patrol elsewhere, or one without a delivery to guard, is not exempt. Pure.
 */
export function escortsFreight(galaxy: Galaxy, bo: BuiltObject): boolean {
    const mega = peekBeaconState(galaxy)?.mega;
    if (mega === undefined || mega.status === 'dormant' || mega.status === 'fired' || !P.megaEscortOn(galaxy)) return false;
    if (Object.values(mega.escorts ?? {}).some((g) => g.ships.includes(bo))) return true; // an AI escort group: its ships are supplied for the run
    const m = builtObjectMission(bo.mission);
    if (m === null) return false;
    if (m.type === BuiltObjectMissionType.Patrol) {
        const g = mega.guards?.find((x) => x.ship === bo);
        return g !== undefined && guardLive(galaxy, mega, g, galaxyStarDate(galaxy));
    }
    if (m.type !== BuiltObjectMissionType.Escort || m.targetBuiltObject === null) return false;
    return freightTarget(galaxy, mega, m.targetBuiltObject);
}

/**
 * A freighter of the Severance's freight: one on its way or arrived and not yet counted (a contract). Any other ship near the structure is not freight
 * (a warship parked there does not hold an escort, nor does its escort get fuel or a credit). Pure.
 */
function freightTarget(galaxy: Galaxy, mega: MegaRec, t: BuiltObject): boolean {
    void galaxy;
    return mega.contracts.some((c) => c.ship === t);
}

/**
 * The stock Escort command ends once its freighter's mission has ended (cmdEscort), and a freighter's mission ends when it arrives at the structure, a
 * moment before its delivery is counted (megaStep, daily). So a group ship or a player's escort still on its Escort to a freighter of the Severance's
 * freight keeps the command there; the delivery then puts it on Patrol (keepEscortsOnDelivery). Pure.
 */
export function escortHeld(galaxy: Galaxy, bo: BuiltObject, target: BuiltObject): boolean {
    const mega = peekBeaconState(galaxy)?.mega;
    if (mega === undefined || mega.status === 'dormant' || mega.status === 'fired' || !P.megaEscortOn(galaxy)) return false;
    const m = builtObjectMission(bo.mission);
    const ours = (m !== null && m.playerOrdered === true) || Object.values(mega.escorts ?? {}).some((g) => g.ships.includes(bo));
    return ours && freightTarget(galaxy, mega, target);
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
    for (const g of mega.guards ?? []) {
        const w = g.ship;
        if (!w.hasBeenDestroyed && w.fuelCapacity > 0 && escortsFreight(galaxy, w)) w.currentFuel = w.fuelCapacity;
    }
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
    if (grp !== undefined) grp.ships = grp.ships.filter((w) => !w.hasBeenDestroyed && w.actualEmpire === e && w.shipGroup === null); // (a ship that joined a fleet leaves the group, its fleet's)
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
    // recruit: idle spares nearest the route's start, but only the share beyond the home floor, counted over the ships AT HOME (the idle warships
    // with no mission, not in a group), so a fleet away on missions does not let the group take the home ships
    const have = grp.ships.length;
    if (have < want) {
        const taken = new Set(grp.ships);
        const atHome = warshipsOf(e).filter((w) => !taken.has(w) && (builtObjectMission(w.mission)?.type ?? BuiltObjectMissionType.Undefined) === BuiltObjectMissionType.Undefined).length;
        const floor = Math.ceil((atHome * P.megaEscortHomePct(galaxy)) / 100);
        const allowance = atHome - floor;
        const fresh = spareShips(galaxy, e, route, taken).slice(0, Math.max(0, Math.min(want - have, allowance)));
        for (const w of fresh) grp.ships.push(w);
    }
    // shrink: the latest recruits go first
    while (grp.ships.length > want) {
        const w = grp.ships.pop()!;
        freeEscort(galaxy, w);
    }
    // point the group: its freighter on the last stretch to the structure (within five megaEscortNear of it), else the structure. A group ship sent
    // after a freighter across a hyperjump was left stranded far behind it (the freight's hyperspace exit is not the escort's), so the escort keeps
    // to the structure's arrival point and goes out to meet the freight only as it comes in. Fuel kept full, as the freight's is.
    const nearest = escortTarget(mega, e, base, galaxy);
    const target = nearest !== null && galaxy.calculateDistance(nearest.xpos, nearest.ypos, base.xpos, base.ypos) <= 5 * P.megaEscortNear(galaxy) ? nearest : null;
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
    if (!P.megaEscortOn(galaxy)) {
        releaseEscorts(galaxy, mega); // switched off mid-game: the groups go home at this step
        delete mega.guards;
        return;
    }
    pruneGuards(galaxy, mega, now);
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
 * The escorts of a freighter that has just delivered stay on guard at the structure. The stock Escort command ends by itself once its freighter's mission is
 * cleared (cmdEscort), and a command that has ended hands its warship back to automation, which reassigned a player's escort in a full tick. So each
 * warship still on an Escort mission to the freighter that is a group ship or a player's order is put on Patrol of the structure before the freighter is
 * released; a player's order stays a player's order. Empires by index, ships by array order. Rnd: none.
 */
export function keepEscortsOnDelivery(galaxy: Galaxy, mega: MegaRec, base: BuiltObject, freighter: BuiltObject): void {
    const members = new Set<BuiltObject>(Object.values(mega.escorts ?? {}).flatMap((g) => g.ships));
    for (const e of galaxy.empires) {
        if (e === null) continue;
        for (const w of e.builtObjects) {
            if (w == null || w.hasBeenDestroyed) continue;
            const m = builtObjectMission(w.mission);
            if (m === null || m.type !== BuiltObjectMissionType.Escort || m.targetBuiltObject !== freighter) continue;
            const player = m.playerOrdered === true;
            if (!player && !members.has(w)) continue;
            assignMission(galaxy, w, BuiltObjectMissionType.Patrol, base, null, BuiltObjectMissionPriority.Normal);
            if (player) {
                markPlayerOrder(w);
                addGuard(galaxy, mega, w);
            }
        }
    }
}

/**
 * The escort that is with a freighter as it arrives: the nearest armed warship within megaEscortNear of it that really escorts THAT freighter (on an
 * Escort mission to it, or a group ship of the freighter's own empire), and that is of the freighter's own empire or of an empire not at war with it
 * (no pirate or enemy credit). Returns the empire that controls it (the war credit's owner), or null. One credit at most per delivery.
 */
export function escortAtArrival(galaxy: Galaxy, mega: MegaRec, freighter: BuiltObject): Empire | null {
    const range = P.megaEscortNear(galaxy);
    const owner = freighter.actualEmpire;
    const group = owner === null ? undefined : escortGroupOf(mega, owner);
    let best: BuiltObject | null = null;
    let bd = Number.MAX_VALUE;
    for (const w of getNearbyBuiltObjects(galaxy, freighter.xpos, freighter.ypos, range)) {
        if (w == null || w === freighter || w.hasBeenDestroyed || !(w.firepowerRaw > 0) || w.actualEmpire === null) continue;
        const m = builtObjectMission(w.mission);
        const real = (m !== null && m.type === BuiltObjectMissionType.Escort && m.targetBuiltObject === freighter) || (group !== undefined && group.ships.includes(w));
        if (!real) continue;
        const e = w.actualEmpire;
        if (e !== owner && (e.pirateEmpireBaseHabitat !== null || (owner !== null && obtainDiplomaticRelation(e, owner).type === DiplomaticRelationType.War))) continue;
        const d = galaxy.calculateDistance(w.xpos, w.ypos, freighter.xpos, freighter.ypos);
        if (d < bd || (d === bd && best !== null && w.builtObjectID < best.builtObjectID)) {
            bd = d;
            best = w;
        }
    }
    return best === null ? null : best.actualEmpire;
}
