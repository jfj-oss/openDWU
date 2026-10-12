// Scenario package 19a — rim patrols, escorts for the Concord's construction ships, and its explorers (flag
// rimTraderPassive, param rimTraderPatrolSquadrons > 0). A layer over the passive posture (passive.ts), not a port.
//
//   Presence: the Concord's colonised systems AND the systems holding one of its bases (passive.ts concordPresenceStars).
//     With patrols on the passive rules treat presence as home: warships take missions there (defend, attack intruders,
//     hunt pirates), the leash lets them stay; everywhere else the old rules (retaliation range only) hold.
//   Patrols: up to rimTraderPatrolSquadrons squadrons of rimTraderPatrolShips warships each (never more than the
//     (100 - rimTraderPatrolHomeGuardPct) % of the navy the home guard can spare, counting strike fleets) are taken out
//     of AI control like the strike fleets and sent round the presence systems: a Patrol mission on the system star (on
//     a Concord base in a system with no colony) for rimTraderPatrolDwellDays, then on to the next system (unoccupied
//     and in fuel range first). A hostile in the system — a pirate ship or base, a hunting creature, a ship of an
//     empire the Concord is angered at — is attacked first, the squadron then resumes its patrol.
//   Escorts: a Concord construction ship bound to a build site outside its presence gets one idle warship as an Escort
//     (the stock mission; the stock AI's own escort choice is allowed too, passive.ts) when rimTraderEscortConstruction
//     is 1.
// Rnd: none drawn here; the mission assignments draw what the ported assignment draws.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { BuiltObject } from '../../builtObject';
import type { Habitat } from '../../types';
import type { Creature } from '../../creature';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../../missions/mission';
import { assignMission } from '../../missions/assign';
import { leaveShipGroup } from '../../fleets/shipGroup';
import { withinFuelRangeAndRefuel } from '../../movement';
import { purchaseNewBuiltObject } from '../../construction/empireConstruction';
import { findNewestCanBuild } from '../../designGeneration';
import { HabitatCategoryType } from '../../types';
import { galaxyStarDate } from '../../tick/simTime';
import { GAME_DAY_LENGTH, registerScenarioEvent, registerScenarioPeriodic, registerScenarioYearly } from '../hooks';
import { scenarioFlag, scenarioParam, scenarioState } from '../state';
import { isRimTraderAI, rimAngeredAt, rimTraderEmpire } from './common';
import {
    PASSIVE_FLAG,
    PATROL_SQUADRONS_DEFAULT,
    concordPresenceStars,
    inConcordPresence,
    isPatrolShip,
    isStrikeShip,
    missionPoint,
    patrolOn,
    strikeCapable,
    type RimPatrolSquadron,
    type RimPatrolState,
} from './passive';

/** Manifest defaults (scenario.json) — the fallbacks of scenarioParam. */
export const PATROL_PARAM_DEFAULTS = {
    rimTraderPatrolSquadrons: PATROL_SQUADRONS_DEFAULT,
    rimTraderPatrolShips: 6,
    rimTraderPatrolHomeGuardPct: 40,
    rimTraderPatrolDwellDays: 45,
    rimTraderEscortConstruction: 1,
    rimTraderExplorers: 4,
    rimTraderOutpostBases: 6,
    rimTraderOutpostReserve: 1000000,
} as const;

export function patrolParam(galaxy: Galaxy, name: keyof typeof PATROL_PARAM_DEFAULTS): number {
    return scenarioParam(galaxy, name, PATROL_PARAM_DEFAULTS[name]);
}

export function rimPatrolState(galaxy: Galaxy): RimPatrolState {
    return scenarioState<RimPatrolState>(galaxy, 'rimPatrol', () => ({ squads: [], stats: { engagements: 0, pirateKills: 0, creatureKills: 0, escorted: 0, rotations: 0 }, escortedIds: [] }));
}

/** The Concord when the AI runs it with the passive posture and the patrols on; null otherwise. Pure. */
function patrolConcord(galaxy: Galaxy): Empire | null {
    if (!scenarioFlag(galaxy, 'rimTrader') || !scenarioFlag(galaxy, PASSIVE_FLAG) || !patrolOn(galaxy)) return null;
    const r = rimTraderEmpire(galaxy);
    return r !== null && isRimTraderAI(galaxy, r) ? r : null;
}

/** What a squadron patrols in `star`'s system: the star (circles the colonies), or a Concord base where it has no colony. Pure. */
function patrolTarget(galaxy: Galaxy, r: Empire, star: Habitat): Habitat | BuiltObject {
    if (r.colonies.some((c) => !c.hasBeenDestroyed && galaxy.determineHabitatSystemStar(c) === star)) return star;
    const base = [...r.builtObjects, ...r.privateBuiltObjects].find((b) => b !== null && !b.hasBeenDestroyed && b.role === BuiltObjectRole.Base && b.builtAt === null && b.nearestSystemStar === star);
    return base ?? star;
}

type Hostile = BuiltObject | Creature;

/** The nearest hostile inside `star`'s system: a pirate ship or base, an angered empire's ship, a hunting creature. Pure. */
function hostileAt(galaxy: Galaxy, star: Habitat): Hostile | null {
    const range = galaxy.maxSolarSystemSize;
    let best: Hostile | null = null;
    let bd = Number.POSITIVE_INFINITY;
    const consider = (o: Hostile): void => {
        const d = galaxy.calculateDistance(o.xpos, o.ypos, star.xpos, star.ypos);
        if (d <= range && d < bd) {
            bd = d;
            best = o;
        }
    };
    for (const pe of galaxy.pirateEmpires) {
        if (pe === null || !pe.active) continue;
        for (const b of pe.builtObjects) if (b !== null && !b.hasBeenDestroyed && b.actualEmpire === pe) consider(b);
    }
    for (const e of galaxy.empires) {
        if (e === null || !e.active || !rimAngeredAt(galaxy, e)) continue;
        for (const b of e.builtObjects) if (b !== null && !b.hasBeenDestroyed && b.role !== BuiltObjectRole.Base && b.builtAt === null) consider(b);
    }
    for (const c of galaxy.creatures) if (!c.hasBeenDestroyed && !c.isBenign && c.attackStrength > 0) consider(c);
    return best;
}

/** A warship in AI control that is idle: nothing, or the stock tidy-up missions. Pure. */
function missionIdle(b: BuiltObject): boolean {
    const m = builtObjectMission(b.mission);
    return m === null || m.type === BuiltObjectMissionType.Undefined;
}

/** The next stop for a squadron: unoccupied and reachable first, then any reachable; null when none. Pure. */
function nextStop(galaxy: Galaxy, st: RimPatrolState, q: RimPatrolSquadron, stops: Habitat[]): Habitat | null {
    const lead = q.ships.find((b) => !b.hasBeenDestroyed) ?? null;
    if (lead === null || stops.length === 0) return null;
    const i = q.stop === null ? -1 : stops.indexOf(q.stop);
    const taken = new Set<Habitat>();
    for (const o of st.squads) if (o !== q && o.stop !== null) taken.add(o.stop);
    let any: Habitat | null = null;
    for (let k = 1; k <= stops.length; k++) {
        const c = stops[(((i + k) % stops.length) + stops.length) % stops.length];
        if (c === q.stop && stops.length > 1) continue;
        if (lead.fuelCapacity > 0 && !withinFuelRangeAndRefuel(galaxy, lead, c.xpos, c.ypos, 0.1)) continue;
        if (!taken.has(c)) return c;
        any ??= c;
    }
    return any;
}

/**
 * The patrol review (every 5 days: once per long block). Prunes the squadrons, forms new ones from the warships the home
 * guard can spare, attacks a hostile in each squadron's system, rotates squadrons to the next presence system after the
 * dwell, and re-issues the Patrol mission to ships that finished a fight. Draws what the mission assignment draws.
 * Returns the ships in squadrons.
 */
export function rimPatrolReview(galaxy: Galaxy): number {
    const r = patrolConcord(galaxy);
    if (r === null) return 0;
    const st = rimPatrolState(galaxy);
    for (const q of st.squads) q.ships = q.ships.filter((b) => !b.hasBeenDestroyed && b.actualEmpire === r);
    st.squads = st.squads.filter((q) => q.ships.length > 0);
    const stops = concordPresenceStars(galaxy, r);
    if (stops.length === 0) return 0;
    const now = galaxyStarDate(galaxy);
    const warships = r.builtObjects.filter((b) => b !== null && !b.hasBeenDestroyed && b.role === BuiltObjectRole.Military);
    const guardPct = Math.min(100, Math.max(0, patrolParam(galaxy, 'rimTraderPatrolHomeGuardPct')));
    const maxAway = Math.floor((warships.length * (100 - guardPct)) / 100);
    const strikeAway = warships.filter((b) => isStrikeShip(galaxy, b)).length;
    const nSquads = Math.max(0, Math.trunc(patrolParam(galaxy, 'rimTraderPatrolSquadrons')));
    const perSquad = Math.max(1, Math.trunc(patrolParam(galaxy, 'rimTraderPatrolShips')));
    // New squadrons from the idle, AI-controlled warships nearest the capital.
    while (st.squads.length < nSquads) {
        const away = st.squads.reduce((n, q) => n + q.ships.length, 0) + strikeAway;
        const size = Math.min(perSquad, maxAway - away);
        if (size <= 0) break;
        const home = r.capital;
        const pool = warships.filter((b) => strikeCapable(galaxy, b) && !isPatrolShip(galaxy, b));
        if (pool.length === 0) break;
        if (home !== null) pool.sort((a, b) => galaxy.calculateDistance(a.xpos, a.ypos, home.xpos, home.ypos) - galaxy.calculateDistance(b.xpos, b.ypos, home.xpos, home.ypos) || a.builtObjectID - b.builtObjectID);
        const ships = pool.slice(0, size);
        for (const b of ships) {
            if (b.shipGroup !== null) leaveShipGroup(galaxy, b);
            b.isAutoControlled = false;
        }
        st.squads.push({ ships, stop: null, since: now });
    }
    // A squadron that outgrew the home guard (the navy shrank) hands its surplus back to the AI.
    let over = st.squads.reduce((n, q) => n + q.ships.length, 0) + strikeAway - maxAway;
    for (let i = st.squads.length - 1; i >= 0 && over > 0; i--) {
        const q = st.squads[i];
        while (q.ships.length > 0 && over > 0) {
            const b = q.ships.pop()!;
            b.isAutoControlled = true;
            over--;
        }
    }
    st.squads = st.squads.filter((q) => q.ships.length > 0);
    const dwell = patrolParam(galaxy, 'rimTraderPatrolDwellDays') * GAME_DAY_LENGTH;
    for (const q of st.squads) {
        if (q.stop !== null && !stops.includes(q.stop)) q.stop = null; // that presence is gone
        const hostile = q.stop === null ? null : hostileAt(galaxy, q.stop);
        if (hostile !== null) {
            let fresh = false;
            for (const b of q.ships) {
                const m = builtObjectMission(b.mission);
                if (m !== null && m.type === BuiltObjectMissionType.Attack && (m.targetBuiltObject === hostile || m.targetCreature === hostile)) continue;
                if (m !== null && (m.type === BuiltObjectMissionType.Refuel || m.type === BuiltObjectMissionType.Repair)) continue;
                assignMission(galaxy, b, BuiltObjectMissionType.Attack, hostile, null, BuiltObjectMissionPriority.High);
                fresh = true;
            }
            if (fresh) st.stats.engagements++;
            continue;
        }
        if (q.stop === null || now - q.since >= dwell) {
            const next = nextStop(galaxy, st, q, stops);
            if (next === null) continue;
            if (q.stop !== null) st.stats.rotations++;
            q.stop = next;
            q.since = now;
            const target = patrolTarget(galaxy, r, next);
            for (const b of q.ships) {
                const m = builtObjectMission(b.mission);
                if (m !== null && (m.type === BuiltObjectMissionType.Refuel || m.type === BuiltObjectMissionType.Repair)) continue;
                assignMission(galaxy, b, BuiltObjectMissionType.Patrol, target, null, BuiltObjectMissionPriority.Low);
            }
            continue;
        }
        // Mid-dwell: ships that finished a fight (or lost their mission) patrol again.
        const target = patrolTarget(galaxy, r, q.stop);
        for (const b of q.ships) {
            const m = builtObjectMission(b.mission);
            if (m !== null && m.type !== BuiltObjectMissionType.Undefined && m.type !== BuiltObjectMissionType.Attack) continue;
            assignMission(galaxy, b, BuiltObjectMissionType.Patrol, target, null, BuiltObjectMissionPriority.Low);
        }
    }
    escortConstructionShips(galaxy, r, st, warships);
    outpostBases(galaxy, r, stops);
    return st.squads.reduce((n, q) => n + q.ships.length, 0);
}

/**
 * A Concord construction ship bound for a build site outside its presence gets an escort: the stock AI's own
 * (a warship already on an Escort mission for it) or, failing that, the idle AI-controlled warship nearest it that can
 * reach the site on its fuel. Each construction ship is counted once in stats.escorted.
 */
function escortConstructionShips(galaxy: Galaxy, r: Empire, st: RimPatrolState, warships: BuiltObject[]): void {
    if (patrolParam(galaxy, 'rimTraderEscortConstruction') < 1) return;
    const escorting = new Set<BuiltObject>();
    for (const w of warships) {
        const m = builtObjectMission(w.mission);
        if (m !== null && m.type === BuiltObjectMissionType.Escort && m.targetBuiltObject !== null) escorting.add(m.targetBuiltObject);
    }
    for (const c of r.builtObjects) {
        if (c === null || c.hasBeenDestroyed || c.subRole !== BuiltObjectSubRole.ConstructionShip || c.builtAt !== null) continue;
        const m = builtObjectMission(c.mission);
        if (m === null || m.type !== BuiltObjectMissionType.Build) continue;
        const p = missionPoint(m.targetHabitat ?? m.targetBuiltObject ?? m.targetCreature, m.x, m.y);
        if (p === null || inConcordPresence(galaxy, r, p.x, p.y)) continue;
        if (!escorting.has(c)) {
            let best: BuiltObject | null = null;
            let bd = Number.POSITIVE_INFINITY;
            for (const w of warships) {
                if (!strikeCapable(galaxy, w) || isPatrolShip(galaxy, w) || !missionIdle(w)) continue;
                if (w.fuelCapacity > 0 && !withinFuelRangeAndRefuel(galaxy, w, p.x, p.y, 0.1)) continue;
                const d = galaxy.calculateDistance(w.xpos, w.ypos, c.xpos, c.ypos);
                if (d < bd || (d === bd && best !== null && w.builtObjectID < best.builtObjectID)) {
                    bd = d;
                    best = w;
                }
            }
            if (best === null) continue;
            assignMission(galaxy, best, BuiltObjectMissionType.Escort, c, null, BuiltObjectMissionPriority.Normal);
            escorting.add(c);
        }
        if (!st.escortedIds.includes(c.builtObjectID)) {
            st.escortedIds.push(c.builtObjectID);
            st.stats.escorted++;
        }
    }
}

/**
 * Outposts beyond the colonies: an idle Concord construction ship builds a listening post (MonitoringStation) in a presence
 * system that has none, outposts (systems with no colony of its own) first, while the Concord has fewer than
 * rimTraderOutpostBases of them and the treasury keeps rimTraderOutpostReserve. The stock AI builds the mining stations
 * (the private sector pays) and research stations; bases never count toward the colony cap. Draws the build point.
 */
function outpostBases(galaxy: Galaxy, r: Empire, stops: Habitat[]): void {
    const cap = Math.trunc(patrolParam(galaxy, 'rimTraderOutpostBases'));
    if (cap <= 0) return;
    const posts = [...r.builtObjects, ...r.privateBuiltObjects].filter((b) => b !== null && !b.hasBeenDestroyed && b.subRole === BuiltObjectSubRole.MonitoringStation);
    if (posts.length >= cap) return;
    const design = findNewestCanBuild(r.designs, BuiltObjectSubRole.MonitoringStation, r);
    if (design === null || r.stateMoney - design.calculateCurrentPurchasePrice(galaxy) < patrolParam(galaxy, 'rimTraderOutpostReserve')) return;
    const colonised = new Set(r.colonies.filter((c) => !c.hasBeenDestroyed).map((c) => galaxy.determineHabitatSystemStar(c)));
    const bare = stops.filter((s) => !posts.some((b) => galaxy.calculateDistance(b.xpos, b.ypos, s.xpos, s.ypos) <= galaxy.maxSolarSystemSize));
    const building = new Set<Habitat>();
    for (const c of r.builtObjects) {
        const m = c === null ? null : builtObjectMission(c.mission);
        if (m !== null && m.type === BuiltObjectMissionType.Build && m.design !== null && m.design.subRole === BuiltObjectSubRole.MonitoringStation && m.targetHabitat !== null) building.add(m.targetHabitat);
    }
    for (const ship of r.builtObjects) {
        if (ship === null || ship.hasBeenDestroyed || ship.subRole !== BuiltObjectSubRole.ConstructionShip || ship.builtAt !== null || !ship.isAutoControlled || !missionIdle(ship)) continue;
        const reach = bare.filter((s) => !building.has(s) && (ship.fuelCapacity <= 0 || withinFuelRangeAndRefuel(galaxy, ship, s.xpos, s.ypos, 0.1)));
        if (reach.length === 0) return;
        reach.sort((a, b) => Number(colonised.has(a)) - Number(colonised.has(b)) || galaxy.calculateDistance(ship.xpos, ship.ypos, a.xpos, a.ypos) - galaxy.calculateDistance(ship.xpos, ship.ypos, b.xpos, b.ypos) || a.systemIndex - b.systemIndex);
        const star = reach[0];
        const pt = galaxy.selectRelativeParkingPoint(star.category === HabitatCategoryType.Star ? star.diameter : 200);
        assignMission(galaxy, ship, BuiltObjectMissionType.Build, star, null, BuiltObjectMissionPriority.Normal, { design, x: pt.x, y: pt.y });
        building.add(star);
        if (posts.length + building.size >= cap) return;
    }
}

/** Yearly: the Concord keeps at least rimTraderExplorers exploration ships (the stock force structure usually already does). */
export function concordExplorersYear(galaxy: Galaxy): number {
    const r = patrolConcord(galaxy);
    const want = Math.trunc(patrolParam(galaxy, 'rimTraderExplorers'));
    if (r === null || want <= 0) return 0;
    let have = r.builtObjects.filter((b) => b !== null && !b.hasBeenDestroyed && b.subRole === BuiltObjectSubRole.ExplorationShip).length;
    const design = findNewestCanBuild(r.designs, BuiltObjectSubRole.ExplorationShip, r);
    const yards = r.spacePorts.filter((p) => !p.hasBeenDestroyed && p.isShipYard);
    let bought = 0;
    for (let y = 0; have < want && design !== null && yards.length > 0 && y < yards.length; y++) {
        if (r.stateMoney - design.calculateCurrentPurchasePrice(galaxy) < patrolParam(galaxy, 'rimTraderOutpostReserve')) break;
        if (purchaseNewBuiltObject(galaxy, r, design, yards[y], true, true) === null) continue;
        have++;
        bought++;
    }
    return bought;
}

registerScenarioYearly({ id: 'rimTrade.patrol.explorers', flag: PASSIVE_FLAG, order: 14, run: (g) => void concordExplorersYear(g) });
registerScenarioPeriodic({ id: 'rimTrade.patrol', flag: PASSIVE_FLAG, periodDays: 5, run: (g) => void rimPatrolReview(g) });
// Patrol results: pirates and creatures the Concord destroys inside its presence (counted once the squadrons exist).
registerScenarioEvent({
    id: 'rimTrade.patrol.pirateKill',
    flag: PASSIVE_FLAG,
    event: 'builtObjectKilledBy',
    run: (g, p) => {
        const r = patrolConcord(g);
        if (r === null || p.destroyer !== r || !('rimPatrol' in g.scenario!.state)) return;
        const v = p.builtObject;
        if (v.actualEmpire !== null && v.actualEmpire.pirateEmpireBaseHabitat !== null && inConcordPresence(g, r, v.xpos, v.ypos)) rimPatrolState(g).stats.pirateKills++;
    },
});
registerScenarioEvent({
    id: 'rimTrade.patrol.creatureKill',
    flag: PASSIVE_FLAG,
    event: 'creatureKilled',
    run: (g, p) => {
        const r = patrolConcord(g);
        if (r === null || p.empire !== r || !('rimPatrol' in g.scenario!.state)) return;
        if (inConcordPresence(g, r, p.creature.xpos, p.creature.ypos)) rimPatrolState(g).stats.creatureKills++;
    },
});
