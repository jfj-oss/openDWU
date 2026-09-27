// Scenario package 19g-7 "rim fauna" (tasks/19-mod-layer-scenarios.md §19g item 7, "Rim fauna design"): hook
// registrations and the herd behaviour — rim-weighted herd spawning at game start, the periodic herd tick (cohesion,
// grazing, station feeding, the migration season), the yearly tick (breeding, unrest/pressure decay) and the pure query
// handlers (unrest term, extraction block, AI escort priority, docile herds). Not a port: every creature it makes and
// moves is a ported Creature (creature.ts) driven by the ported Creature.cs movement / wander / hyper-travel code; this
// package only sets their anchor points, speeds and hyper speed.
//
// Rnd: galaxy.rnd, only inside this package's gated handlers (game start runs after the whole faithful generation,
// incl. Galaxy.6.cs SelectCreatures; periodic / yearly handlers run from the long block). With the flag off, none of
// this code runs and no Creature is added, so the faithful Rnd stream is untouched.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { BuiltObject } from '../../builtObject';
import type { Habitat } from '../../types';
import { HabitatCategoryType } from '../../types';
import { CreatureType, resolveCreatureDescription, type Creature } from '../../creature';
import { generateCreaturesAtLocation } from '../../story/storyStart';
import { creatureDamageTarget } from '../../combat/damage';
import { notifyOfAttackBuiltObject } from '../../combat/attackAI';
import { cargoAvailable } from '../../logistics/orders';
import { EmpireMessageType } from '../../messages';
import { YEAR_LENGTH } from '../../galaxyTime';
import { galaxyStarDate } from '../../tick/simTime';
import {
    GAME_DAY_LENGTH,
    gameYear,
    radiusFraction,
    registerScenarioGameStart,
    registerScenarioPeriodic,
    registerScenarioQuery,
    registerScenarioYearly,
} from '../hooks';
import { registerStabilityTerm } from '../stability';
import { scenarioMessage, scenarioNews, scenarioText } from '../messages';
import {
    HERD_ATTACK_RANGE,
    HERD_COHESION,
    HERD_FEED_RANGE,
    HERD_FEED_TICKS,
    HERD_HYPER_SPEED,
    HERD_REST_RANGE,
    RIM_FAUNA_FLAG,
    type RimHerd,
    creatureAlive,
    faunaParam,
    herdDensityAt,
    herdMembers,
    rimFaunaPatrolPriority,
    rimFaunaStationBlocked,
    rimFaunaState,
    rimFaunaUnrest,
    rimHerdDocileTo,
    rimHerdFeedingSites,
    rimHerdOfCreature,
    stationAt,
} from './common';

/**
 * 19g-7b hand-off: another package (new fauna) may drive some herds itself. Pure lookups (no Rnd, no writes); each
 * returns false for a herd it does not own, so without that package every herd behaves as before.
 *   drives(herd)          — the herd tick only prunes it (no grazing, migration, breeding): the owner steers it.
 *   sparesStations(herd)  — it grazes and migrates here but never feeds on (damages) a mining station.
 */
export interface RimHerdDriver {
    drives: (galaxy: Galaxy, herd: RimHerd) => boolean;
    sparesStations: (galaxy: Galaxy, herd: RimHerd) => boolean;
}
const herdDrivers: RimHerdDriver[] = [];

export function registerRimHerdDriver(driver: RimHerdDriver): void {
    if (!herdDrivers.includes(driver)) herdDrivers.push(driver);
}

function herdDrivenElsewhere(galaxy: Galaxy, herd: RimHerd): boolean {
    for (const d of herdDrivers) if (d.drives(galaxy, herd)) return true;
    return false;
}

function herdSparesStations(galaxy: Galaxy, herd: RimHerd): boolean {
    for (const d of herdDrivers) if (d.sparesStations(galaxy, herd)) return true;
    return false;
}

/** Empires with a colony or mining station this close to a migration target get the warning message. */
const MIGRATION_WARN_RANGE = 150000;

function dist(galaxy: Galaxy, x1: number, y1: number, x2: number, y2: number): number {
    return galaxy.calculateDistance(x1, y1, x2, y2);
}

/** Active empires and pirate factions (both own mining stations and colonies). */
function activeEmpires(galaxy: Galaxy): Empire[] {
    return [...galaxy.empires, ...galaxy.pirateEmpires].filter((e): e is Empire => e !== null && e.active && e !== galaxy.independentEmpire);
}

// ---------------------------------------------------------------------------------------------------------------
// Herd creation
// ---------------------------------------------------------------------------------------------------------------

/**
 * A pasture point in a system: a random gas cloud / asteroid of the system when it has one (the pasture itself), else a
 * point 6000–12000 from its star. Draws galaxy.rnd.
 */
function pickRangePoint(galaxy: Galaxy, systemIndex: number): { x: number; y: number } {
    const sys = galaxy.systems[systemIndex];
    const star = sys.systemStar;
    const sites: Habitat[] = [];
    if (star.category === HabitatCategoryType.GasCloud) sites.push(star);
    for (const h of galaxy.systemHabitatsOf(systemIndex)) if (h.category === HabitatCategoryType.Asteroid || h.category === HabitatCategoryType.GasCloud) sites.push(h);
    if (sites.length > 0) {
        const s = sites[galaxy.rnd.next(0, sites.length)];
        return { x: s.xpos, y: s.ypos };
    }
    const angle = galaxy.rnd.nextDouble() * Math.PI * 2.0;
    const r = 6000 + galaxy.rnd.next(0, 6000);
    return { x: star.xpos + Math.cos(angle) * r, y: star.ypos + Math.sin(angle) * r };
}

/** Speeds / ranges of a herd member (leader or follower); hyper speed only while migrating. */
function configureMember(galaxy: Galaxy, c: Creature, leader: boolean, name: string): void {
    const speed = faunaParam(galaxy, leader ? 'rimFaunaLeaderSpeed' : 'rimFaunaFollowerSpeed');
    c.movementSpeed = speed;
    c.movementSpeedBase = speed;
    c.attackRange = HERD_ATTACK_RANGE;
    c.anchorRange = leader ? HERD_REST_RANGE : HERD_COHESION;
    c.locationLocked = true;
    c.name = name;
}

function herdName(galaxy: Galaxy, systemIndex: number): string {
    return scenarioText('Scenario RimFauna Herd Name', resolveCreatureDescription(CreatureType.Kaltor), galaxy.systems[systemIndex].systemStar.name);
}

/**
 * Spawns one herd in a system: `size` Kaltors anchored at a pasture point via the ported GenerateCreaturesAtLocation
 * (Galaxy.6.cs 800; location-locked, joined to the nearest system), the first one the leader. Draws galaxy.rnd.
 * Exported for tests and 19j (herder home ranges).
 */
export function spawnRimHerd(galaxy: Galaxy, systemIndex: number, size: number, at: { x: number; y: number } | null = null): RimHerd | null {
    const st = rimFaunaState(galaxy);
    const sys = galaxy.systems[systemIndex];
    if (sys === undefined || size < 1) return null;
    const p = at ?? pickRangePoint(galaxy, systemIndex);
    const list = generateCreaturesAtLocation(galaxy, CreatureType.Kaltor, size, p.x, p.y, HERD_COHESION, 800);
    if (list.length === 0) return null;
    const name = herdName(galaxy, systemIndex);
    list.forEach((c, i) => configureMember(galaxy, c, i === 0, name));
    const herd: RimHerd = {
        id: st.nextHerdId++,
        type: CreatureType.Kaltor,
        leader: list[0],
        followers: list.slice(1),
        homeSystemIndex: systemIndex,
        homeX: sys.systemStar.xpos,
        homeY: sys.systemStar.ypos,
        homeRange: faunaParam(galaxy, 'rimFaunaHomeRange'),
        birthSystemIndex: systemIndex,
        birthX: sys.systemStar.xpos,
        birthY: sys.systemStar.ypos,
        feedSite: null,
        feedTicks: 0,
        feedingStation: null,
        migration: null,
        docileEmpireIds: [],
        victimEmpireIds: [],
    };
    st.herds.push(herd);
    st.rev++;
    st.stats.herdsSpawned++;
    return herd;
}

/**
 * Game start (`rimFauna.spawn`): one pass over Galaxy.Systems in index order (stars and gas clouds); a system with no
 * empire colony at radius fraction f gets floor(d) + (NextDouble < frac(d)) herds, d = herdDensityAt(f), until the
 * herd cap. Runs after the faithful generation (the five CreatureTypes of Galaxy.6.cs SelectCreatures are untouched).
 */
export function rimFaunaGameStart(galaxy: Galaxy): void {
    const st = rimFaunaState(galaxy);
    const cap = Math.trunc(faunaParam(galaxy, 'rimFaunaMaxHerds'));
    const sizeMin = Math.max(1, Math.trunc(faunaParam(galaxy, 'rimFaunaHerdSizeMin')));
    const sizeMax = Math.max(sizeMin, Math.trunc(faunaParam(galaxy, 'rimFaunaHerdSizeMax')));
    for (let i = 0; i < galaxy.systems.length && st.herds.length < cap; i++) {
        const star = galaxy.systems[i].systemStar;
        const d = herdDensityAt(galaxy, radiusFraction(galaxy, star.xpos, star.ypos));
        if (d <= 0) continue;
        if (galaxy.systemHabitatsOf(i).some((h) => h.empire !== null && h.empire !== galaxy.independentEmpire)) continue;
        let n = Math.floor(d);
        if (galaxy.rnd.nextDouble() < d - n) n++;
        for (let k = 0; k < n && st.herds.length < cap; k++) spawnRimHerd(galaxy, i, galaxy.rnd.next(sizeMin, sizeMax + 1));
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Periodic herd tick
// ---------------------------------------------------------------------------------------------------------------

/**
 * Points a member's anchor (Creature.AnchorPoint) at (x, y); when it is outside its range and idle it starts moving
 * there (Creature.cs Move walks to AnchorPoint + ParentOffset, hyper-jumping past HyperJumpThreshhold when HyperSpeed>0).
 */
function steer(c: Creature, x: number, y: number, range: number): void {
    if (c.anchorPoint === null) c.anchorPoint = { x: Math.trunc(x), y: Math.trunc(y) };
    c.anchorPoint.x = Math.trunc(x);
    c.anchorPoint.y = Math.trunc(y);
    c.anchorRange = range;
    const dx = c.xpos - x;
    const dy = c.ypos - y;
    if (c.currentTarget === null && dx * dx + dy * dy > range * range * 0.25) {
        c.parentOffsetX = 0;
        c.parentOffsetY = 0;
        c.targetSpeed = c.movementSpeed;
    }
}

/** Drops dead members (promoting a follower when the leader died). Returns false when the herd is gone. */
function pruneHerd(galaxy: Galaxy, herd: RimHerd): boolean {
    const st = rimFaunaState(galaxy);
    const before = herdMembers(herd).length;
    herd.followers = herd.followers.filter((c) => creatureAlive(galaxy, c));
    if (herd.leader !== null && !creatureAlive(galaxy, herd.leader)) herd.leader = null;
    if (herd.leader === null && herd.followers.length > 0) {
        herd.leader = herd.followers.shift()!;
        configureMember(galaxy, herd.leader, true, herd.leader.name);
    }
    if (herdMembers(herd).length !== before) st.rev++;
    return herd.leader !== null;
}

/** A herd was wiped out: the loss stops; the empires it fed on are told. */
function herdKilled(galaxy: Galaxy, herd: RimHerd): void {
    const st = rimFaunaState(galaxy);
    st.stats.herdsKilled++;
    herd.feedingStation = null;
    const where = galaxy.systems[herd.homeSystemIndex]?.systemStar.name ?? '';
    for (const e of activeEmpires(galaxy)) {
        if (!herd.victimEmpireIds.includes(e.empireId)) continue;
        scenarioMessage(galaxy, e, scenarioText('Scenario RimFauna Title'), scenarioText('Scenario RimFauna Herd Killed', where), { type: EmpireMessageType.GeneralGoodEvent });
    }
}

/** Weighted pasture pick in the home range (station habitats × rimFaunaStationAttraction). Draws one NextDouble. */
function pickPasture(galaxy: Galaxy, herd: RimHerd): Habitat | null {
    const sites = rimHerdFeedingSites(galaxy, herd);
    if (sites.length === 0) return null;
    const attraction = faunaParam(galaxy, 'rimFaunaStationAttraction');
    const w = sites.map((h) => (stationAt(h) !== null ? attraction : 1));
    const total = w.reduce((a, b) => a + b, 0);
    let roll = galaxy.rnd.nextDouble() * total;
    for (let i = 0; i < sites.length; i++) {
        roll -= w[i];
        if (roll < 0) return sites[i];
    }
    return sites[sites.length - 1];
}

/** Charges one station loss: pressure on the station (AI hook), unrest at the owner's nearest colony. */
function recordStationLoss(galaxy: Galaxy, herd: RimHerd, station: BuiltObject, now: number): void {
    const st = rimFaunaState(galaxy);
    st.stats.stationLosses++;
    const p = st.pressured.find((x) => x.station === station);
    if (p !== undefined) p.lastLoss = now;
    else st.pressured.push({ station, lastLoss: now });
    const empire = station.empire!;
    if (!herd.victimEmpireIds.includes(empire.empireId)) herd.victimEmpireIds.push(empire.empireId);
    let colony: Habitat | null = null;
    let best = Number.MAX_VALUE;
    for (const c of empire.colonies) {
        const d = dist(galaxy, station.xpos, station.ypos, c.xpos, c.ypos);
        if (d < best) {
            best = d;
            colony = c;
        }
    }
    if (colony === null) return;
    const row = st.unrest.find((u) => u.colony === colony);
    if (row !== undefined) row.losses += 1;
    else st.unrest.push({ colony, losses: 1 });
}

/**
 * One feeding tick at a mining station: eats rimFaunaFeedRate of every available resource stock in its hold, damages it
 * through the ported Creature.cs 1347 DamageTarget (combat/damage.ts creatureDamageTarget) and raises the ported
 * distress path (attackAI.ts notifyOfAttackBuiltObject, as Creature.cs 1206 CheckForTargets does), then charges a loss.
 */
function feedOnStation(galaxy: Galaxy, herd: RimHerd, station: BuiltObject, first: boolean): void {
    const st = rimFaunaState(galaxy);
    const leader = herd.leader!;
    const rate = faunaParam(galaxy, 'rimFaunaFeedRate');
    if (station.cargo !== null) {
        for (const c of station.cargo.items) {
            if (c.commodityComponent !== null) continue;
            const eat = Math.trunc(cargoAvailable(c) * rate);
            if (eat <= 0) continue;
            c.amount -= eat;
            st.stats.stockEaten += eat;
        }
    }
    const now = galaxyStarDate(galaxy);
    const empire = station.empire!;
    if (first) {
        const where = galaxy.systems[herd.homeSystemIndex]?.systemStar.name ?? '';
        scenarioMessage(galaxy, empire, scenarioText('Scenario RimFauna Title'), scenarioText('Scenario RimFauna Station Grazed', station.name, where), { type: EmpireMessageType.GeneralBadEvent, subject: station });
    }
    recordStationLoss(galaxy, herd, station, now);
    notifyOfAttackBuiltObject(galaxy, leader, null, station, first);
    const damage = Math.trunc(faunaParam(galaxy, 'rimFaunaStationDamage'));
    if (damage > 0 && creatureDamageTarget(galaxy, leader, station, damage, Math.round(galaxy.currentTimeSeconds * 1000), 1)) {
        scenarioMessage(galaxy, empire, scenarioText('Scenario RimFauna Title'), scenarioText('Scenario RimFauna Station Destroyed', station.name), { type: EmpireMessageType.GeneralBadEvent, subject: station });
        herd.feedingStation = null;
        herd.feedSite = null;
    }
}

/** Grazing in the home range: leader to its pasture (or rest point), followers around the leader, feeding effects. */
function grazeHerd(galaxy: Galaxy, herd: RimHerd): void {
    const st = rimFaunaState(galaxy);
    const leader = herd.leader!;
    if (herd.feedSite !== null && (herd.feedSite.hasBeenDestroyed || !rimHerdFeedingSites(galaxy, herd).includes(herd.feedSite))) herd.feedSite = null;
    if (herd.feedSite === null) {
        herd.feedingStation = null;
        herd.feedTicks = 0;
        herd.feedSite = pickPasture(galaxy, herd);
    }
    const site = herd.feedSite;
    if (site !== null) steer(leader, site.xpos, site.ypos, HERD_FEED_RANGE);
    else steer(leader, leader.anchorPoint?.x ?? herd.homeX, leader.anchorPoint?.y ?? herd.homeY, HERD_REST_RANGE);
    for (const f of herd.followers) steer(f, leader.xpos, leader.ypos, HERD_COHESION);
    if (site === null) return;
    if (dist(galaxy, leader.xpos, leader.ypos, site.xpos, site.ypos) > HERD_FEED_RANGE * 2) {
        herd.feedingStation = null;
        return;
    }
    herd.feedTicks++;
    st.stats.feedTicks++;
    const station = stationAt(site);
    if (station !== null && !rimHerdDocileTo(herd, station.empire) && !herdSparesStations(galaxy, herd)) {
        const first = herd.feedingStation !== station;
        herd.feedingStation = station;
        feedOnStation(galaxy, herd, station, first);
    } else {
        herd.feedingStation = null;
    }
    if (herd.feedTicks >= HERD_FEED_TICKS) {
        // Pasture grazed out: move on next tick (the station is released).
        herd.feedSite = null;
        herd.feedingStation = null;
    }
}

/** Slot offset of member i around the migration target (leader at the centre). */
function slot(i: number, n: number): { x: number; y: number } {
    if (i === 0) return { x: 0, y: 0 };
    const a = (i * 2 * Math.PI) / Math.max(1, n - 1);
    return { x: Math.cos(a) * 800, y: Math.sin(a) * 800 };
}

/** Starts a migration: every member's anchor moves to the target, hyper speed on (Creature.cs Move hyper travel). */
export function startRimHerdMigration(galaxy: Galaxy, herd: RimHerd, toSystemIndex: number, homeward: boolean, at: { x: number; y: number } | null = null): void {
    const st = rimFaunaState(galaxy);
    const p = at ?? pickRangePoint(galaxy, toSystemIndex);
    herd.migration = { toSystemIndex, x: p.x, y: p.y, startDate: galaxyStarDate(galaxy), homeward };
    herd.feedSite = null;
    herd.feedingStation = null;
    herd.feedTicks = 0;
    for (const c of herdMembers(herd)) c.hyperSpeed = HERD_HYPER_SPEED;
    st.stats.migrations++;
    steerMigration(galaxy, herd);
}

/** Migration steering; on the leader's arrival the target system becomes the home range. */
function steerMigration(galaxy: Galaxy, herd: RimHerd): void {
    const m = herd.migration!;
    const members = herdMembers(herd);
    members.forEach((c, i) => {
        const o = slot(i, members.length);
        steer(c, m.x + o.x, m.y + o.y, HERD_COHESION);
    });
    const leader = herd.leader!;
    if (dist(galaxy, leader.xpos, leader.ypos, m.x, m.y) > HERD_REST_RANGE || leader.currentSpeed > leader.movementSpeed) return;
    const star = galaxy.systems[m.toSystemIndex].systemStar;
    herd.homeSystemIndex = m.toSystemIndex;
    herd.homeX = star.xpos;
    herd.homeY = star.ypos;
    herd.migration = null;
    for (const c of members) c.hyperSpeed = 0;
    steer(leader, m.x, m.y, HERD_REST_RANGE);
}

/** Inward migration target: a system within the migration radius, not further out than home and not inside the inner limit. */
function pickInwardSystem(galaxy: Galaxy, herd: RimHerd): number {
    const radius = faunaParam(galaxy, 'rimFaunaMigrationRadius');
    const inner = faunaParam(galaxy, 'rimFaunaMigrationInner');
    const fHome = radiusFraction(galaxy, herd.homeX, herd.homeY);
    const cand: number[] = [];
    const w: number[] = [];
    for (let i = 0; i < galaxy.systems.length; i++) {
        if (i === herd.homeSystemIndex) continue;
        const s = galaxy.systems[i];
        const star = s.systemStar;
        if (dist(galaxy, herd.homeX, herd.homeY, star.xpos, star.ypos) > radius) continue;
        const f = radiusFraction(galaxy, star.xpos, star.ypos);
        if (f > fHome || f < inner) continue;
        cand.push(i);
        // Settled (empire-dominated) systems pull harder: that is the rim-adjacent territory the herds push into.
        w.push(s.dominantEmpire != null && s.dominantEmpire.empire != null ? 3 : 1);
    }
    if (cand.length === 0) return -1;
    const total = w.reduce((a, b) => a + b, 0);
    let roll = galaxy.rnd.nextDouble() * total;
    for (let i = 0; i < cand.length; i++) {
        roll -= w[i];
        if (roll < 0) return cand[i];
    }
    return cand[cand.length - 1];
}

/** The migration season: each herd rolls rimFaunaMigrationChance; away herds go home, home herds push inward. */
export function rimFaunaMigrationSeason(galaxy: Galaxy): number {
    const st = rimFaunaState(galaxy);
    const chance = faunaParam(galaxy, 'rimFaunaMigrationChance');
    const started: RimHerd[] = [];
    for (const herd of st.herds) {
        if (herd.leader === null || herd.migration !== null || herdDrivenElsewhere(galaxy, herd)) continue;
        if (galaxy.rnd.nextDouble() >= chance) continue;
        if (herd.homeSystemIndex !== herd.birthSystemIndex) {
            startRimHerdMigration(galaxy, herd, herd.birthSystemIndex, true);
        } else {
            const to = pickInwardSystem(galaxy, herd);
            if (to < 0) continue;
            startRimHerdMigration(galaxy, herd, to, false);
        }
        started.push(herd);
    }
    if (started.length === 0) return 0;
    scenarioNews(galaxy, null, scenarioText('Scenario RimFauna News Migration', started.length));
    for (const e of activeEmpires(galaxy)) {
        const names: string[] = [];
        for (const herd of started) {
            const m = herd.migration;
            if (m === null || m.homeward) continue;
            const near =
                e.colonies.some((c) => dist(galaxy, c.xpos, c.ypos, m.x, m.y) <= MIGRATION_WARN_RANGE) ||
                e.miningStations.some((b) => b != null && dist(galaxy, b.xpos, b.ypos, m.x, m.y) <= MIGRATION_WARN_RANGE);
            const name = galaxy.systems[m.toSystemIndex].systemStar.name;
            if (near && !names.includes(name)) names.push(name);
        }
        if (names.length > 0) scenarioMessage(galaxy, e, scenarioText('Scenario RimFauna Title'), scenarioText('Scenario RimFauna Migration Warning', names.join(', ')), { type: EmpireMessageType.GeneralWarning });
    }
    return started.length;
}

/** Day of the game year (0-359) at a star date. */
function dayOfYear(starDate: number): number {
    return Math.floor((starDate - gameYear(starDate) * YEAR_LENGTH) / GAME_DAY_LENGTH);
}

/** The periodic herd tick (`rimFauna.herds`, every long block). Exported for tests. */
export function rimFaunaHerdTick(galaxy: Galaxy): void {
    const st = rimFaunaState(galaxy);
    const now = galaxyStarDate(galaxy);
    const year = gameYear(now);
    if (year > st.lastMigrationYear && dayOfYear(now) >= faunaParam(galaxy, 'rimFaunaMigrationDay')) {
        st.lastMigrationYear = year;
        rimFaunaMigrationSeason(galaxy);
    }
    for (const herd of [...st.herds]) {
        if (!pruneHerd(galaxy, herd)) {
            st.herds.splice(st.herds.indexOf(herd), 1);
            st.rev++;
            herdKilled(galaxy, herd);
            continue;
        }
        if (herdDrivenElsewhere(galaxy, herd)) continue;
        if (herd.migration !== null) steerMigration(galaxy, herd);
        else grazeHerd(galaxy, herd);
    }
}

/** The yearly tick (`rimFauna.year`): breeding (one follower per herd below max size, by chance), decay of unrest / pressure. */
export function rimFaunaYear(galaxy: Galaxy): void {
    const st = rimFaunaState(galaxy);
    const sizeMax = Math.trunc(faunaParam(galaxy, 'rimFaunaHerdSizeMax'));
    const chance = faunaParam(galaxy, 'rimFaunaBreedChance');
    for (const herd of st.herds) {
        const leader = herd.leader;
        if (leader === null || herd.migration !== null || !creatureAlive(galaxy, leader) || herdDrivenElsewhere(galaxy, herd)) continue;
        if (herdMembers(herd).length >= sizeMax || galaxy.rnd.nextDouble() >= chance) continue;
        const calf = generateCreaturesAtLocation(galaxy, CreatureType.Kaltor, 1, leader.xpos, leader.ypos, HERD_COHESION, 400);
        for (const c of calf) {
            configureMember(galaxy, c, false, leader.name);
            herd.followers.push(c);
            st.stats.births++;
        }
        st.rev++;
    }
    // TODO(19g-7): herds at max size could split into a new herd (population recovery); for now killing a herd is final.
    for (const u of st.unrest) u.losses *= 0.5;
    st.unrest = st.unrest.filter((u) => u.losses >= 0.25 && u.colony.empire !== null);
    const now = galaxyStarDate(galaxy);
    st.pressured = st.pressured.filter((p) => !p.station.hasBeenDestroyed && now - p.lastLoss <= YEAR_LENGTH);
}

// ---------------------------------------------------------------------------------------------------------------
// Registrations
// ---------------------------------------------------------------------------------------------------------------

registerScenarioGameStart({ id: 'rimFauna.spawn', flag: RIM_FAUNA_FLAG, run: (g) => rimFaunaGameStart(g) });
registerScenarioPeriodic({ id: 'rimFauna.herds', flag: RIM_FAUNA_FLAG, periodDays: 1, run: (g) => rimFaunaHerdTick(g) });
registerScenarioYearly({ id: 'rimFauna.year', flag: RIM_FAUNA_FLAG, run: (g) => rimFaunaYear(g) });
// Herd-loss unrest as a stability term (scenario/stability.ts; v + (-x) is v - x exactly, so the fold is unchanged).
registerStabilityTerm({
    id: 'rimFauna.unrest',
    flag: RIM_FAUNA_FLAG,
    cause: 'herdLosses',
    label: 'Herd losses',
    run: (g, h, empire) => (empire === null ? null : -rimFaunaUnrest(g, h)),
});
registerScenarioQuery({ id: 'rimFauna.blocked', flag: RIM_FAUNA_FLAG, query: 'extractionBlocked', run: (g, v, a) => v || rimFaunaStationBlocked(g, a.builtObject) });
registerScenarioQuery({
    id: 'rimFauna.escort',
    flag: RIM_FAUNA_FLAG,
    query: 'miningStationPatrolPriority',
    run: (g, v, a) => rimFaunaPatrolPriority(g, a.builtObject, v, galaxyStarDate(g)),
});
registerScenarioQuery({
    id: 'rimFauna.docile',
    flag: RIM_FAUNA_FLAG,
    query: 'creatureIgnoresTarget',
    run: (g, v, a) => {
        if (v) return v;
        const herd = rimHerdOfCreature(g, a.creature);
        if (herd === null || herd.docileEmpireIds.length === 0) return false;
        return rimHerdDocileTo(herd, (a.target as { empire?: Empire | null }).empire ?? null);
    },
});
