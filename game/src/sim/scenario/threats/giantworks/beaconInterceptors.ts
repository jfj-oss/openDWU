// The Beacon, part 8: the Reclaimers' refugee interceptors (Giantworks wonder, flag gwBeacon). Not a port: new scenario behaviour composed of the stock
// Patrol / Capture / Raid / Escort missions, the stock boarding (assault pods, combat/boarding.ts) and the capitals' pull-out (beaconPursuit.ts pullOut).
//
// Small GROUPS of 1 cruiser (a Reclaimer design variant that carries assault pods) + 1 destroyer + 2 frigates, their number rising with the worlds the
// Reclaimers hold (one per beaconInterceptorWorldsPer, at most beaconInterceptorMax), built one ship at a time from the fleet biofuel like the response
// fleets (beaconResponse.ts: the free share, then the account; an empty account ends the building).
//   PATROL  - a group flies a route of held worlds (a few days at each) as a response patrol does.
//   RAID    - at low priority (every beaconInterceptorRaidIntervalDays, only when no refugee is to be chased) the cruiser raids a private station of an
//             empire near its route (the stock Raid mission: assault pods), the rest escort it, for beaconInterceptorRaidDays.
//   CHASE   - it drops whatever it does to chase any DETECTED relocation transport (beaconRelocation.ts) laden with people within beaconInterceptorChaseSectors
//             of Reclaimer-held space: the cruiser takes the stock Capture mission against it, the others escort the cruiser; their hyperjumps are re-aimed at
//             the runner each step and spool beaconPursuitSpoolPct % of the stock time, and the cruiser drags a transport in warp out of it (the capitals'
//             pull-out, its own cooldown beaconInterceptorPullCooldownDays). Only these groups chase refugees: no strike group or response fleet does.
//   SEIZURE - a transport boarded and taken (the stock boarding) becomes the Reclaimers' ship: its people are captives (beaconHarvest.ts penSeizedTransport),
//             flown to the nearest harvest core's pens; a seized transport recaptured before it docks frees them (cattleTaken); one destroyed
//             costs them but for the escape pods (cattleDestroyed). A transport destroyed because the boarding failed is lost with its people.
// Rnd: none of its own (the stock ship, design and combat code it calls draw galaxy.rnd as usual). Fixed iteration orders.

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { Habitat } from '../../../types';
import type { BuiltObject } from '../../../builtObject';
import type { Design } from '../../../design';
import { BuiltObjectRole } from '../../../data/designSpecifications';
import { BuiltObjectSubRole } from '../../../builtObjectTypes';
import { ComponentType } from '../../../data/components';
import { galaxyStarDate } from '../../../tick/simTime';
import { generateDesignFromSpec, componentDefinitionsStatic, getHighestTechByType } from '../../../designGeneration';
import { galaxyDesignSpecificationBySubRole } from '../../../gameStartTail';
import { isObjectVisibleToThisEmpire } from '../../../independentTraders';
import { assignMission } from '../../../missions/assign';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../../../missions/mission';
import { GAME_DAY_LENGTH, registerScenarioEvent, registerScenarioFramePeriodic, registerScenarioQuery } from '../../hooks';
import { scenarioParam } from '../../state';
import { scenarioText as T } from '../../messages';
import { empireTechLevel } from '../robotMutiny';
import { BEACON_FLAG, P, peekBeaconState, warOn, type BeaconState, type InterceptorGroup, type InterceptorRec } from './beaconState';
import { ENGAGE_RANGE, designFor, distTo, enemyStrengthNear, patrol, processingWorlds, spawnShip, strengthOf } from './beaconFleet';
import { freeShare, fuelOf, payFleet, penSeizedTransport } from './beaconHarvest';
import { patrolRoute } from './beaconResponse';
import { inWarp, pullOut, pursuitOf, steer } from './beaconPursuit';
import { ladenTransports, relocationSeized } from './beaconRelocation';

/** The composition of a group, in build order: the cruiser first (it leads, boards and drags). */
export const GROUP_SHIPS: readonly BuiltObjectSubRole[] = [BuiltObjectSubRole.Cruiser, BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.Frigate, BuiltObjectSubRole.Frigate];

/** The chase and raid steps (days) and the build / route pass (days). */
const STEP_DAYS = 1;
const BUILD_DAYS = 5;
/** Raids are looked for within this many sectors of the group's waypoint. */
const RAID_LOOK_SECTORS = 6;

function days(n: number): number {
    return n * GAME_DAY_LENGTH;
}

function p(g: Galaxy, name: string, fallback: number): number {
    return scenarioParam(g, name, fallback);
}

export const INTERCEPT = {
    on: (g: Galaxy) => p(g, 'beaconInterceptorOn', 1) >= 1,
    /** One group per this many held worlds (at least one once any is held), at most max. */
    worldsPer: (g: Galaxy) => Math.max(1, p(g, 'beaconInterceptorWorldsPer', 4)),
    max: (g: Galaxy) => Math.max(0, Math.trunc(p(g, 'beaconInterceptorMax', 3))),
    /** Assault pods on the cruiser. */
    pods: (g: Galaxy) => Math.max(1, Math.trunc(p(g, 'beaconInterceptorPods', 8))),
    /** A relocation transport within this many sectors of Reclaimer-held space is chased. */
    chaseSectors: (g: Galaxy) => Math.max(1, p(g, 'beaconInterceptorChaseSectors', 6)),
    giveUpDays: (g: Galaxy) => Math.max(1, p(g, 'beaconInterceptorGiveUpDays', 60)),
    pullCooldownDays: (g: Galaxy) => Math.max(0, p(g, 'beaconInterceptorPullCooldownDays', 20)),
    raidIntervalDays: (g: Galaxy) => Math.max(1, p(g, 'beaconInterceptorRaidIntervalDays', 60)),
    raidDays: (g: Galaxy) => Math.max(1, p(g, 'beaconInterceptorRaidDays', 15)),
    /** Ships built per group per build pass. */
    buildPerPass: (g: Galaxy) => Math.max(1, Math.trunc(p(g, 'beaconInterceptorBuildPerPass', 2))),
};

export function interceptorsOf(st: BeaconState): InterceptorRec {
    return (st.interceptors ??= { groups: [], nextId: 1, lastBuild: -1e18, stats: {} });
}

function stat(r: InterceptorRec, key: string, by = 1): void {
    r.stats[key] = (r.stats[key] ?? 0) + by;
}

/** Every ship of the interceptor groups (the other Reclaimer passes treat them as busy). Pure. */
export function interceptorShips(st: BeaconState): BuiltObject[] {
    return (st.interceptors?.groups ?? []).flatMap((g) => g.ships);
}

/** `bo` is an interceptor group's ship that is chasing a transport (its jumps spool faster). Pure. */
function chasingShip(st: BeaconState | null, bo: BuiltObject): boolean {
    for (const g of st?.interceptors?.groups ?? []) if (g.mode === 'chase' && g.ships.includes(bo)) return true;
    return false;
}

// ---------------------------------------------------------------------------------------------------------------
// The cruiser variant
// ---------------------------------------------------------------------------------------------------------------

/** The interceptor cruiser: the faction's cruiser template with beaconInterceptorPods assault pods added (a variant; never an AI build). */
export function interceptorDesign(galaxy: Galaxy, faction: Empire): Design | null {
    const name = T('Beacon Interceptor Design');
    for (const d of faction.designs) if (d !== null && d.name === name) return d;
    const spec = faction.designSpecifications.find((s) => s !== null && s.subRole === BuiltObjectSubRole.Cruiser) ?? galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.Cruiser);
    if (spec === null || spec === undefined) return null;
    try {
        const d = generateDesignFromSpec(galaxy, faction, spec, Math.max(1, empireTechLevel(faction)), galaxyStarDate(galaxy));
        if (d === null) return null;
        const pod = faction.research?.getLatestComponent(ComponentType.AssaultPod) ?? getHighestTechByType(ComponentType.AssaultPod, componentDefinitionsStatic(galaxy));
        if (pod === null || pod === undefined) return null;
        const n = INTERCEPT.pods(galaxy);
        for (let i = 0; i < n; i++) d.components.push(pod);
        d.reDefine();
        d.name = name;
        d.isObsolete = true;
        faction.designs.push(d);
        return d;
    } catch {
        return null;
    }
}

function designOfSlot(galaxy: Galaxy, faction: Empire, slot: number): Design | null {
    const sub = GROUP_SHIPS[slot];
    return slot === 0 ? (interceptorDesign(galaxy, faction) ?? designFor(galaxy, faction, sub)) : designFor(galaxy, faction, sub);
}

// ---------------------------------------------------------------------------------------------------------------
// Groups: how many, building, losses
// ---------------------------------------------------------------------------------------------------------------

/** The groups the holdings call for. Pure. */
export function groupCount(galaxy: Galaxy, st: BeaconState): number {
    const held = processingWorlds(st).length;
    return held <= 0 ? 0 : Math.min(INTERCEPT.max(galaxy), Math.ceil(held / INTERCEPT.worldsPer(galaxy)));
}

/** The slot of `GROUP_SHIPS` that a group's ships leave empty (the first), or -1 when it is full. Pure. */
function missingSlot(g: InterceptorGroup): number {
    const have = new Map<BuiltObjectSubRole, number>();
    for (const b of g.ships) have.set(b.subRole, (have.get(b.subRole) ?? 0) + 1);
    const used = new Map<BuiltObjectSubRole, number>();
    for (let i = 0; i < GROUP_SHIPS.length; i++) {
        const s = GROUP_SHIPS[i];
        const u = (used.get(s) ?? 0) + 1;
        used.set(s, u);
        if ((have.get(s) ?? 0) < u) return i;
    }
    return -1;
}

function buildShips(galaxy: Galaxy, st: BeaconState, rec: InterceptorRec, g: InterceptorGroup): void {
    const faction = st.faction!;
    const at = g.route[0] ?? processingWorlds(st)[0]?.colony ?? null;
    if (at === null) return;
    for (let n = 0; n < INTERCEPT.buildPerPass(galaxy); n++) {
        const slot = missingSlot(g);
        if (slot < 0 || st.stats.spawned >= 1_000_000) return;
        const design = designOfSlot(galaxy, faction, slot);
        if (design === null) return;
        // paid like every other Reclaimer ship: the free share comes for nothing, the rest from the fleet biofuel (an empty account ends the building)
        if (freeShare(galaxy) < 1 && fuelOf(st).fleet <= 0) return;
        const bo = spawnShip(galaxy, faction, design, at.xpos, at.ypos);
        payFleet(st, strengthOf(bo) * (1 - freeShare(galaxy)));
        if (slot === 0) g.ships.unshift(bo);
        else g.ships.push(bo);
        st.stats.spawned++;
        stat(rec, 'built');
    }
}

function cruiserOf(g: InterceptorGroup): BuiltObject | null {
    return g.ships.find((b) => !b.hasBeenDestroyed && b.subRole === BuiltObjectSubRole.Cruiser) ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------------------------------------------

function holdOrder(galaxy: Galaxy, b: BuiltObject, type: BuiltObjectMissionType, target: BuiltObject): void {
    const m = builtObjectMission(b.mission);
    if (m !== null && m.type === type && m.targetBuiltObject === target) return;
    b.isAutoControlled = false;
    assignMission(galaxy, b, type, target, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
}

/** The cruiser takes `type` (Capture / Raid) against `target`; the rest escort the cruiser. */
function strike(galaxy: Galaxy, g: InterceptorGroup, type: BuiltObjectMissionType, target: BuiltObject): void {
    const cruiser = cruiserOf(g);
    if (cruiser === null) return;
    for (const b of g.ships) {
        if (b.hasBeenDestroyed) continue;
        if (b === cruiser) holdOrder(galaxy, b, type, target);
        else holdOrder(galaxy, b, BuiltObjectMissionType.Escort, cruiser);
    }
}

function topUpFuel(g: InterceptorGroup): void {
    for (const b of g.ships) if (!b.hasBeenDestroyed && b.fuelCapacity > 0 && b.currentFuel < b.fuelCapacity) b.currentFuel = b.fuelCapacity;
}

/** Back to the route: the next drive re-issues the Patrol orders (which replace any Capture / Raid / Escort one). */
function toPatrol(g: InterceptorGroup, now: number): void {
    g.mode = 'patrol';
    g.modeDate = now;
    g.target = null;
    g.arrivedAt = 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Patrol
// ---------------------------------------------------------------------------------------------------------------

function drivePatrol(galaxy: Galaxy, st: BeaconState, rec: InterceptorRec, g: InterceptorGroup, now: number): void {
    const held = processingWorlds(st).map((r) => r.colony);
    const lead = g.ships.find((b) => !b.hasBeenDestroyed) ?? null;
    if (lead === null || held.length === 0) return;
    g.route = g.route.filter((h) => !h.hasBeenDestroyed && h.empire === st.faction);
    if (g.route.length === 0) {
        // a route from the held world furthest from the other groups' routes
        const others = rec.groups.filter((o) => o !== g).flatMap((o) => o.route);
        let seed: Habitat | null = null;
        let bs = -Infinity;
        for (const h of held) {
            let m = Infinity;
            for (const o of others) m = Math.min(m, galaxy.calculateDistance(h.xpos, h.ypos, o.xpos, o.ypos));
            const score = (Number.isFinite(m) ? m : 1e9) - distTo(galaxy, lead, h.xpos, h.ypos) * 1e-3;
            if (score > bs) {
                bs = score;
                seed = h;
            }
        }
        if (seed === null) return;
        g.route = patrolRoute(galaxy, held, seed, P.patrolRouteLen(galaxy), P.patrolHopSectors(galaxy) * galaxy.sectorSize);
        g.leg = 0;
        g.arrivedAt = 0;
    }
    if (g.leg >= g.route.length) g.leg = 0;
    const wp = g.route[g.leg];
    if (g.arrivedAt <= 0 && distTo(galaxy, lead, wp.xpos, wp.ypos) <= ENGAGE_RANGE) g.arrivedAt = now;
    else if (g.arrivedAt > 0 && now - g.arrivedAt >= days(P.patrolDwellDays(galaxy)) && g.route.length > 1) {
        g.leg = (g.leg + 1) % g.route.length;
        g.arrivedAt = 0;
        stat(rec, 'patrolLegs');
    }
    for (const b of g.ships) if (!b.hasBeenDestroyed) patrol(galaxy, b, g.route[g.leg]);
}

// ---------------------------------------------------------------------------------------------------------------
// Raids (low priority)
// ---------------------------------------------------------------------------------------------------------------

/** A private station of an ordinary empire near (x, y), the nearest the group can handle. Pure. */
function raidTarget(galaxy: Galaxy, st: BeaconState, g: InterceptorGroup, x: number, y: number): BuiltObject | null {
    let mine = 0;
    for (const b of g.ships) if (!b.hasBeenDestroyed) mine += strengthOf(b);
    const reach = RAID_LOOK_SECTORS * galaxy.sectorSize;
    let best: BuiltObject | null = null;
    let bd = Infinity;
    for (const e of galaxy.empires as (Empire | null)[]) {
        if (e === null || !e.active || e === st.faction || e === galaxy.independentEmpire || e.pirateEmpireBaseHabitat !== null) continue;
        for (const b of e.privateBuiltObjects as BuiltObject[]) {
            if (b === null || b.hasBeenDestroyed || b.role !== BuiltObjectRole.Base || b.owner !== null || !b.isFunctional) continue;
            const d = galaxy.calculateDistance(b.xpos, b.ypos, x, y);
            if (d > reach || d >= bd) continue;
            if (enemyStrengthNear(galaxy, st, b.xpos, b.ypos, ENGAGE_RANGE) > mine * 0.8) continue;
            best = b;
            bd = d;
        }
    }
    return best;
}

function driveRaid(galaxy: Galaxy, st: BeaconState, rec: InterceptorRec, g: InterceptorGroup, now: number): void {
    const t = g.target;
    if (t === null || t.hasBeenDestroyed || now - g.modeDate > days(INTERCEPT.raidDays(galaxy)) || cruiserOf(g) === null) {
        stat(rec, 'raidsEnded');
        toPatrol(g, now);
        return;
    }
    strike(galaxy, g, BuiltObjectMissionType.Raid, t);
}

// ---------------------------------------------------------------------------------------------------------------
// Chase
// ---------------------------------------------------------------------------------------------------------------

function nearHeldSpace(galaxy: Galaxy, st: BeaconState, b: BuiltObject): boolean {
    const reach = INTERCEPT.chaseSectors(galaxy) * galaxy.sectorSize;
    for (const r of processingWorlds(st)) if (distTo(galaxy, b, r.colony.xpos, r.colony.ypos) <= reach) return true;
    return false;
}

function endChase(galaxy: Galaxy, rec: InterceptorRec, g: InterceptorGroup, why: string, now: number): void {
    stat(rec, `chaseEnd_${why}`);
    toPatrol(g, now);
}

function driveChase(galaxy: Galaxy, st: BeaconState, rec: InterceptorRec, g: InterceptorGroup, now: number): void {
    const t = g.target;
    const cruiser = cruiserOf(g);
    if (t === null || cruiser === null) {
        endChase(galaxy, rec, g, cruiser === null ? 'cruiserLost' : 'noTarget', now);
        return;
    }
    if (t.hasBeenDestroyed) {
        endChase(galaxy, rec, g, 'destroyed', now);
        return;
    }
    if (t.actualEmpire === st.faction) {
        endChase(galaxy, rec, g, 'seized', now);
        return;
    }
    if (!ladenTransports(galaxy).includes(t)) {
        endChase(galaxy, rec, g, 'arrived', now);
        return;
    }
    if (now - g.modeDate > days(INTERCEPT.giveUpDays(galaxy)) || !nearHeldSpace(galaxy, st, t)) {
        endChase(galaxy, rec, g, 'lost', now);
        return;
    }
    topUpFuel(g);
    strike(galaxy, g, BuiltObjectMissionType.Capture, t);
    const unit = g.ships.filter((b) => !b.hasBeenDestroyed);
    steer(unit, t);
    // the cruiser drags a runner in warp out of it (the capitals' pull-out; the group's own cooldown)
    if (inWarp(t) && inWarp(cruiser) && now >= g.pullReady && galaxy.calculateDistance(cruiser.xpos, cruiser.ypos, t.xpos, t.ypos) <= Math.max(P.pursuitPullRange(galaxy), t.currentSpeed * 0.5)) {
        pullOut(galaxy, st, pursuitOf(st), t, now);
        g.pullReady = now + days(INTERCEPT.pullCooldownDays(galaxy));
        stat(rec, 'pulls');
    }
}

/** A chase starts: the group nearest the transport that is free of another chase. */
function startChases(galaxy: Galaxy, st: BeaconState, rec: InterceptorRec, now: number): void {
    const faction = st.faction!;
    const chased = new Set<BuiltObject>();
    for (const g of rec.groups) if (g.mode === 'chase' && g.target !== null) chased.add(g.target);
    for (const t of ladenTransports(galaxy)) {
        if (chased.has(t) || !nearHeldSpace(galaxy, st, t)) continue;
        if (!isObjectVisibleToThisEmpire(galaxy, faction, t)) continue; // only a DETECTED transport is chased
        let best: InterceptorGroup | null = null;
        let bd = Infinity;
        for (const g of rec.groups) {
            if (g.mode === 'chase') continue;
            const c = cruiserOf(g);
            if (c === null) continue;
            const d = distTo(galaxy, c, t.xpos, t.ypos);
            if (d < bd) {
                bd = d;
                best = g;
            }
        }
        if (best === null) continue;
        best.mode = 'chase';
        best.modeDate = now;
        best.target = t;
        best.arrivedAt = 0;
        chased.add(t);
        stat(rec, 'chases');
        driveChase(galaxy, st, rec, best, now);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------------------------------------------

/** Every STEP_DAYS: groups kept at the number the holdings call for, built, and driven; refugees chased first. */
export function interceptorTick(galaxy: Galaxy): void {
    const st = peekBeaconState(galaxy);
    if (st === null || st.faction === null || !st.faction.active || !warOn(st) || !INTERCEPT.on(galaxy)) return;
    // nothing before a relocation exists and no group has been made: the groups come with the first holdings (they patrol and raid on their own)
    const now = galaxyStarDate(galaxy);
    const rec = interceptorsOf(st);
    const faction = st.faction;
    for (const g of rec.groups) {
        const before = g.ships.length;
        g.ships = g.ships.filter((b) => !b.hasBeenDestroyed && b.actualEmpire === faction);
        if (before > g.ships.length) stat(rec, 'shipsLost', before - g.ships.length);
        if (g.mode === 'raid' && g.target !== null && g.target.hasBeenDestroyed) toPatrol(g, now);
    }
    if (now - rec.lastBuild >= days(BUILD_DAYS)) {
        rec.lastBuild = now;
        const want = groupCount(galaxy, st);
        while (rec.groups.length < want) {
            rec.groups.push({ id: rec.nextId++, ships: [], mode: 'patrol', modeDate: now, route: [], leg: 0, arrivedAt: 0, target: null, pullReady: 0, lastRaid: now });
            stat(rec, 'groups');
        }
        // a group no longer wanted that has no ships is dropped
        for (let i = rec.groups.length - 1; i >= want && i >= 0; i--) if (rec.groups[i].ships.length === 0) rec.groups.splice(i, 1);
        for (const g of rec.groups) if (g.mode !== 'chase') buildShips(galaxy, st, rec, g);
    }
    startChases(galaxy, st, rec, now);
    for (const g of rec.groups) {
        if (g.ships.length === 0) continue;
        if (g.mode === 'chase') driveChase(galaxy, st, rec, g, now);
        else if (g.mode === 'raid') driveRaid(galaxy, st, rec, g, now);
        else {
            drivePatrol(galaxy, st, rec, g, now);
            // low priority: a raid on a private station near the route, when the group has been at peace long enough
            const c = cruiserOf(g);
            if (c !== null && g.arrivedAt > 0 && now - g.lastRaid >= days(INTERCEPT.raidIntervalDays(galaxy)) && g.ships.length >= GROUP_SHIPS.length) {
                const wp = g.route[g.leg];
                const t = wp !== undefined ? raidTarget(galaxy, st, g, wp.xpos, wp.ypos) : null;
                if (t !== null) {
                    g.mode = 'raid';
                    g.modeDate = now;
                    g.target = t;
                    g.lastRaid = now;
                    stat(rec, 'raids');
                }
            }
        }
    }
}

/** A transport the interceptors boarded and took: its people are the Reclaimers' captives (the pens of the nearest core). */
export function onTransportBoarded(galaxy: Galaxy, bo: BuiltObject, to: Empire): void {
    const st = peekBeaconState(galaxy);
    if (st === null || st.faction === null || to !== st.faction) return;
    const seized = relocationSeized(galaxy, bo, to);
    if (seized === null) return;
    const rec = interceptorsOf(st);
    const penned = penSeizedTransport(galaxy, st, bo, seized.from, seized.people);
    stat(rec, penned ? 'seizedPenned' : 'seizedNoCore');
    // the stock capture policy would scrap or retrofit a civilian ship it cannot use: the Reclaimers keep what they seize as it is (read right after this event)
    const pol = to.policy;
    if (pol !== null && pol !== undefined) {
        pol.captureEnlistCivilianShip = 0;
        pol.upgradeEnlistedCivilianShips = false;
    }
    // no core is live (or no world to name): the people are not penned; the ship carries none
    if (!penned && bo.population !== null) {
        bo.population.items.length = 0;
        bo.population.recalculateTotalAmount();
    }
}

/** Summary for the soaks and the tests. Pure. */
export function interceptorSummary(st: BeaconState): { groups: number; ships: number; chasing: number; stats: Record<string, number> } {
    const r = st.interceptors;
    if (r === undefined) return { groups: 0, ships: 0, chasing: 0, stats: {} };
    return { groups: r.groups.length, ships: r.groups.reduce((s, g) => s + g.ships.length, 0), chasing: r.groups.filter((g) => g.mode === 'chase').length, stats: { ...r.stats } };
}

export function registerInterceptors(): void {
    registerScenarioFramePeriodic({ id: 'beacon.interceptors', flag: BEACON_FLAG, order: 25, periodDays: STEP_DAYS, run: (g) => interceptorTick(g) });
    // the chasers' jumps spool a fraction of the stock time, as the capitals' pursuit
    registerScenarioQuery({
        id: 'beacon.interceptorSpool',
        flag: BEACON_FLAG,
        order: 101,
        query: 'hyperjumpSpoolFactor',
        run: (g, v, a) => (chasingShip(peekBeaconState(g), a.ship) ? Math.min(v, P.pursuitSpoolPct(g) / 100) : v),
    });
    // a relocation transport boarded and taken
    registerScenarioEvent({ id: 'beacon.interceptSeized', flag: BEACON_FLAG, order: 5, event: 'builtObjectOwnerChanged', run: (g, e) => (e.to !== null ? onTransportBoarded(g, e.builtObject, e.to) : undefined) });
}

registerInterceptors();
