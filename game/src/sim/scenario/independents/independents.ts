// Scenario package 19k items 2-3 (tasks/19-mod-layer-scenarios.md §19k): independents as actors and independent leagues.
// Not a port — it drives ported code: ship creation as Galaxy.8.cs 939 CreateStateShips (builtObjectPlacement.ts
// createStartingShip body), fleets as Galaxy.9.cs 300-314 DoSuperPirateTasks (new ShipGroup + ShipGroups.Add), station
// placement as Galaxy.8.cs 835 CreateMiningStation (stationPlacement.ts createMiningStation body), designs as
// Galaxy.7.cs 4390 GenerateIndependentTraders' fallback (GenerateDesignFromSpec over the independent's specifications),
// the colony as the colonize command (cmdTroops.ts makeHabitatIntoColonyRuntime, the pirate branch that hands the colony
// to the independent empire), and the protectorate as Empire.8.cs ChangeDiplomaticRelation.
//
// Item 2 (flag independentActors), per independent colony, scaled by population like the freighter rule (Galaxy.7.cs
// 4354: population / 20,000,000 freighters, ≤ 15 per colony): (a) a militia of escorts / frigates, one Defend-posture
// fleet parked at home; (b) one construction ship placing mining stations in the home system and unclaimed systems within
// the station radius (stations only), friction when another empire claims a station's system; (c) freighters stay the
// ported GenerateIndependentTraders; (d) the militia / construction ship are rebuilt every militia refresh period.
// Hard rule: no colony ships here — the only colony ship is a league's single extra colony (item 3).
// Herder colonies (19j, free status) get their ships tagged as tamed creatures (rimHerdersState().tamed).
//
// Item 3 (flag independentLeagues): formation, pooled defence, shared stations / income, one extra colony, bloc
// diplomacy, dissolution, herd pooling, the 19a trading-bloc hook.
//
// Rnd: only inside this package's gated handlers (game start, the periodic tick, the yearly tick, decision resolution).
// Event handlers (habitatAttacked, colonyOwnerChanged, colonyFounded) only record; they never draw.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import { BuiltObject } from '../../builtObject';
import { HabitatCategoryType, HabitatType, type Habitat } from '../../types';
import type { Design } from '../../design';
import { getDesignsBySubRoles } from '../../design';
import type { DesignSpecification } from '../../data/designSpecifications';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { generateDesignFromSpec } from '../../designGeneration';
import { galaxyStarDate } from '../../tick/simTime';
import { EmpireMessageType } from '../../messages';
import { DiplomaticRelationType, obtainDiplomaticRelation, obtainEmpireEvaluation } from '../../diplomacy';
import { FleetPosture, changeDiplomaticRelation } from '../../diplomacyTick';
import { raceAggressionLevel, raceFriendlinessLevel } from '../../colonyTick';
import { ShipGroup, empireShipGroups, shipGroupAssignMission } from '../../fleets/shipGroup';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission, isBuiltObject } from '../../missions/mission';
import { assignMission } from '../../missions/assign';
import { makeHabitatIntoColonyRuntime } from '../../missions/cmdTroops';
import { canBuiltObjectColonizeHabitat } from '../../construction/constructionQueue';
import { checkSystemOwnership, habitatResourcesContainsGroup, resolveRetrofitResourcesForBase } from '../../stationPlacement';
import { ResourceGroup } from '../../resourceSystem';
import { takeOwnershipOfBuiltObject } from '../../combat/ownership';
import { builtObjectCompleteTeardown } from '../../combat/teardown';
import { GAME_DAY_LENGTH, gameYear, registerScenarioEvent, registerScenarioGameStart, registerScenarioPeriodic, registerScenarioYearly } from '../hooks';
import { scenarioFlag } from '../state';
import { registerScenarioDecision, raiseScenarioDecision, type ScenarioDecision } from '../decisions';
import { scenarioMessage, scenarioNews, scenarioText } from '../messages';
import { createEmpireMidGame } from '../empireMidGame';
import { YEAR_LENGTH } from '../../galaxyTime';
import { herderColonyHerds, herderColonyOf, peekRimHerdersState, rimHerdersState, RIM_HERDERS_FLAG } from '../rimHerders/common';
import { setRimHerdDocile } from '../rimFauna/common';
import {
    ACTORS_FLAG,
    ARRIVE_RANGE,
    COHESION_DRIFT,
    COHESION_START,
    type FrictionRecord,
    type IndependentActor,
    type IndependentLeague,
    independentStationFriction,
    independentsState,
    indParam,
    JOB_TIMEOUT_DAYS,
    LEAGUES_FLAG,
    leagueById,
    leagueOf,
    leagueOnRim,
    POP_PER_STATION,
    POP_PER_WARSHIP,
    PROSPEROUS_POP,
    PULL_BONUS,
    SECTOR_SIZE,
    STANDING_ACCEPT,
    STANDING_NEIGHBOUR,
    STANDING_OFFER,
    STANDING_RAID,
    STATION_INCOME,
    THREAT_DAYS,
    actorOf,
} from './common';

const DECISION_FRICTION = 'independents.friction';
const DECISION_OFFER = 'independents.offer';

function title(): string {
    return scenarioText('Scenario Independents Title');
}

function dist(g: Galaxy, a: { xpos: number; ypos: number }, b: { xpos: number; ypos: number }): number {
    return g.calculateDistance(a.xpos, a.ypos, b.xpos, b.ypos);
}

function alive(bo: BuiltObject | null, owner: Empire | null): bo is BuiltObject {
    return bo !== null && !bo.hasBeenDestroyed && bo.empire === owner;
}

function normalEmpire(galaxy: Galaxy, e: Empire | null): e is Empire {
    return e !== null && e.active && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null;
}

function empireById(galaxy: Galaxy, id: number): Empire | null {
    return galaxy.empires.find((e) => e !== null && e.empireId === id) ?? null;
}

function now(galaxy: Galaxy): number {
    return galaxyStarDate(galaxy);
}

// ---------------------------------------------------------------------------------------------------------------
// Designs: the independent empire's own (Galaxy.7.cs 4390 GenerateIndependentTraders fallback pattern)
// ---------------------------------------------------------------------------------------------------------------

function specBySubRole(list: (DesignSpecification | null)[], subRole: BuiltObjectSubRole): DesignSpecification | null {
    for (const spec of list) if (spec !== null && spec.subRole === subRole) return spec;
    return null;
}

/** The independent's design of a sub-role: its newest existing one, else one generated from its specification (kept). */
export function independentDesign(galaxy: Galaxy, subRole: BuiltObjectSubRole): Design | null {
    const ind = galaxy.independentEmpire;
    if (ind === null) return null;
    const have = getDesignsBySubRoles(ind.designs, [subRole]);
    if (have.length > 0) return have[have.length - 1];
    const spec = specBySubRole(ind.designSpecifications, subRole);
    if (spec === null) return null;
    const d = generateDesignFromSpec(galaxy, ind, spec, 0.0, now(galaxy));
    if (d === null) return null;
    ind.designs.push(d);
    return d;
}

// ---------------------------------------------------------------------------------------------------------------
// §19k tech-follow addendum: the independent empire's tech tree drifts with the galaxy instead of staying frozen
// at its Empire.cs 4146 initializeIndependentCtor start (SetTechTreeStartingDefaults, race null): unlike a normal
// empire it has no researchTick advancing it turn to turn, so without this every militia / station design keeps
// using start-tech components forever. Rnd: galaxy.rnd only inside independentsTick (this package's gated periodic
// tick — this package's Rnd policy, top of file), and only setTechTreeLevel's own draw for a fractional target
// (its `techLevel - lvl > rnd.nextDouble()` roll per node, short-circuited away entirely for an integer target).
// ---------------------------------------------------------------------------------------------------------------

/** An empire's tech level for the follow rule: the highest tech level among its researched nodes (darkFarms.ts
 *  hostTechLevel's "highest researched level" pattern), 0 if none — the same units as setTechTreeLevel's techLevel. */
function empireTechLevel(empire: Empire): number {
    let max = 0;
    for (const n of empire.research.techTree) if (n.isResearched && n.def.techLevel > max) max = n.def.techLevel;
    return max;
}

function median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Regenerates the independent empire's specification designs (militia warship, constructor, stations, and the
 * league colony ship when 19k-3 is on) from its current research so new builds use the new components — the same
 * generateDesignFromSpec(galaxy, ind, spec, 0.0, now) call independentDesign's fallback makes. Existing ships keep
 * their own Design objects; independentDesign picks the newest match by push order, so these new ones (pushed last)
 * are what the next build uses.
 */
function regenerateIndependentDesigns(galaxy: Galaxy): void {
    const ind = galaxy.independentEmpire;
    if (ind === null) return;
    for (const spec of ind.designSpecifications) {
        if (spec === null) continue;
        const d = generateDesignFromSpec(galaxy, ind, spec, 0.0, now(galaxy));
        if (d !== null) ind.designs.push(d);
    }
}

/**
 * Independent tech follow: target = median tech level of normal (non-pirate, non-independent, active) empires ×
 * independentTechFollowPct / 100; if the independent empire is below it, raises it with the same
 * research.setTechTreeLevel(rnd, race, level, isPirate) → research.update → reviewResearchAbilities →
 * reviewDesignsBuiltObjectsImprovedComponents → reviewTroopTypes path empireMidGame.ts's adoptEmpire uses for a
 * mid-game empire's tech level, then regenerates the specification designs. Never lowers (only called when the
 * current level is below target); no-op (false, no draw, no news) with no normal empires or no advance. Returns
 * whether the level actually changed (the caller's news-once-per-refresh gate).
 */
export function refreshIndependentTech(galaxy: Galaxy): boolean {
    const ind = galaxy.independentEmpire;
    if (ind === null || galaxy.researchStatic === null) return false;
    const levels: number[] = [];
    for (const e of galaxy.empires) if (normalEmpire(galaxy, e)) levels.push(empireTechLevel(e));
    if (levels.length === 0) return false;
    const pct = indParam(galaxy, 'independentTechFollowPct');
    const target = median(levels) * (pct / 100);
    if (empireTechLevel(ind) >= target) return false;
    // setTechTreeLevel(techLevel === 0.5) is the special LoadEmpirePolicy branch (throws without a race); the
    // independent empire's dominantRace is null (Empire.cs 4146), so nudge off that exact value — negligible next
    // to the level units above (1 = "Level 1").
    const level = target === 0.5 ? 0.5 + 1e-9 : target;
    ind.research.setTechTreeLevel(galaxy.rnd, ind.dominantRace, level, false);
    ind.research.update(ind.dominantRace);
    ind.reviewResearchAbilities();
    ind.reviewDesignsBuiltObjectsImprovedComponents();
    ind.reviewTroopTypes();
    regenerateIndependentDesigns(galaxy);
    independentsState(galaxy).stats.techRefreshes++;
    scenarioNews(galaxy, null, scenarioText('Scenario Independents Tech Caught Up'));
    return true;
}

/**
 * A new independent ship at `colony` — the loop body of Galaxy.8.cs 939 CreateStateShips (builtObjectPlacement.ts
 * createStartingShip) with the colony given instead of SelectRandomColony, owned by the independent empire (state-owned).
 */
function createIndependentShip(galaxy: Galaxy, design: Design, colony: Habitat): BuiltObject {
    const ind = galaxy.independentEmpire!;
    const purchasePrice = design.calculateCurrentPurchasePrice(galaxy);
    design.buildCount++;
    const bo = new BuiltObject(design, galaxy.generateBuiltObjectName(design), galaxy, true);
    bo.purchasePrice = purchasePrice;
    bo.reDefine();
    bo.currentFuel = bo.fuelCapacity;
    bo.currentShields = bo.shieldsCapacity;
    bo.heading = galaxy.selectRandomHeading();
    bo.targetHeading = bo.heading;
    const p = galaxy.selectRelativeParkingPoint();
    bo.name = galaxy.generateBuiltObjectName(design, colony);
    bo.nearestSystemStar = galaxy.determineHabitatSystemStar(colony);
    ind.addBuiltObjectToGalaxy(bo, colony, false, true, Math.trunc(p.x), Math.trunc(p.y));
    return bo;
}

/** Herder colonies (19j, free) field tamed creatures: tag the ship in the herders' tamed list. */
function tagIfHerder(galaxy: Galaxy, colony: Habitat, bo: BuiltObject): void {
    if (!scenarioFlag(galaxy, RIM_HERDERS_FLAG)) return;
    const hc = herderColonyOf(galaxy, colony);
    if (hc === null || hc.status !== 'free') return;
    const st = rimHerdersState(galaxy);
    if (!st.tamed.includes(bo)) {
        st.tamed.push(bo);
        st.rev++;
    }
}

export function isHerderActor(galaxy: Galaxy, a: IndependentActor): boolean {
    return herderColonyOf(galaxy, a.colony)?.status === 'free';
}

// ---------------------------------------------------------------------------------------------------------------
// Actors
// ---------------------------------------------------------------------------------------------------------------

function newActor(colony: Habitat): IndependentActor {
    return {
        colony,
        status: 'active',
        fleet: [],
        group: null,
        builder: null,
        jobHabitat: null,
        jobSince: 0,
        stations: [],
        raids: [],
        lastExpansion: 0,
        lastHerdLoss: 0,
        leagueId: -1,
        income: 0,
        shipsBuilt: 0,
    };
}

/** Adds actors for new independent colonies (galaxy list order); marks colonies the independent empire lost. No Rnd. */
export function syncActors(galaxy: Galaxy): void {
    const st = independentsState(galaxy);
    const ind = galaxy.independentEmpire;
    for (const colony of galaxy.independentColonies) {
        if (colony.empire !== ind || colony.population.items.length === 0) continue;
        if (!st.actors.some((a) => a.colony === colony)) st.actors.push(newActor(colony));
    }
    for (const a of st.actors) {
        if (a.status === 'active' && (a.colony.empire !== ind || a.colony.population.items.length === 0)) a.status = 'lost';
        else if (a.status === 'lost' && a.colony.empire === ind && a.colony.population.items.length > 0) a.status = 'active';
    }
}

/** Militia size of a colony: 1 warship per POP_PER_WARSHIP (at least 1), capped; × the league multiplier in a league. */
export function militiaTarget(galaxy: Galaxy, a: IndependentActor): number {
    const cap = Math.max(0, Math.trunc(indParam(galaxy, 'independentActorsFleetCap')));
    if (cap === 0) return 0;
    const byPop = Math.max(1, Math.trunc(a.colony.population.totalAmount / POP_PER_WARSHIP));
    const inLeague = scenarioFlag(galaxy, LEAGUES_FLAG) && leagueOf(galaxy, a.colony) !== null;
    const mult = inLeague ? indParam(galaxy, 'independentLeaguesFleetMultiplier') : 1;
    return Math.trunc(Math.min(cap, byPop) * mult);
}

/** Station quota of a colony: 1 + 1 per POP_PER_STATION, capped by stations per colony. */
export function stationQuota(galaxy: Galaxy, a: IndependentActor): number {
    const cap = Math.max(0, Math.trunc(indParam(galaxy, 'independentActorsStationsPerColony')));
    return Math.min(cap, 1 + Math.trunc(a.colony.population.totalAmount / POP_PER_STATION));
}

/** Station reach (units): the radius param, × √members inside a league (shared stations). */
export function stationRadius(galaxy: Galaxy, a: IndependentActor): number {
    let r = indParam(galaxy, 'independentActorsStationRadius') * SECTOR_SIZE;
    const l = scenarioFlag(galaxy, LEAGUES_FLAG) ? leagueOf(galaxy, a.colony) : null;
    if (l !== null) r *= Math.sqrt(l.members.length);
    return r;
}

/** The colony's Defend-posture militia fleet (Galaxy.9.cs 300-314: new ShipGroup, empire, gather point, name, ShipGroups.Add). */
function militiaGroup(galaxy: Galaxy, a: IndependentActor): ShipGroup {
    const ind = galaxy.independentEmpire!;
    if (a.group !== null && empireShipGroups(ind).includes(a.group)) return a.group;
    const g = new ShipGroup(galaxy);
    g.empire = ind;
    g.gatherPoint = a.colony;
    g.posture = FleetPosture.Defend;
    g.postureRangeSquared = 0;
    g.name = scenarioText('Scenario Independents Militia Name', a.colony.name);
    empireShipGroups(ind).push(g);
    a.group = g;
    return g;
}

function joinGroup(g: ShipGroup, bo: BuiltObject): void {
    if (g.ships.includes(bo)) return;
    g.ships.push(bo);
    bo.shipGroup = g;
    if (g.leadShip === null || g.leadShip.hasBeenDestroyed) g.leadShip = bo;
}

/** (a) + (d): builds the militia up to its target (escorts, frigates when the colony is populous) and the construction ship. */
export function refreshMilitia(galaxy: Galaxy, a: IndependentActor, isRefresh: boolean): number {
    const ind = galaxy.independentEmpire;
    if (ind === null || a.status !== 'active') return 0;
    const st = independentsState(galaxy);
    a.fleet = a.fleet.filter((b) => alive(b, ind));
    const target = militiaTarget(galaxy, a);
    let built = 0;
    const g = target > 0 ? militiaGroup(galaxy, a) : null;
    if (g !== null) {
        g.ships = g.ships.filter((b) => !b.hasBeenDestroyed);
        if (g.leadShip !== null && g.leadShip.hasBeenDestroyed) g.leadShip = g.ships[0] ?? null;
    }
    while (a.fleet.length < target) {
        const sub = a.fleet.length % 2 === 1 && a.colony.population.totalAmount >= POP_PER_WARSHIP * 2 ? BuiltObjectSubRole.Frigate : BuiltObjectSubRole.Escort;
        const design = independentDesign(galaxy, sub) ?? independentDesign(galaxy, BuiltObjectSubRole.Escort);
        if (design === null) break;
        const bo = createIndependentShip(galaxy, design, a.colony);
        a.fleet.push(bo);
        joinGroup(g!, bo);
        tagIfHerder(galaxy, a.colony, bo);
        a.shipsBuilt++;
        built++;
        if (isRefresh) st.stats.militiaRefreshed++;
        else st.stats.militiaBuilt++;
    }
    // (b) the construction ship, while the colony still has stations to place.
    a.stations = a.stations.filter((b) => alive(b, ind));
    if (!alive(a.builder, ind) && a.stations.length < stationQuota(galaxy, a)) {
        const design = independentDesign(galaxy, BuiltObjectSubRole.ConstructionShip);
        if (design !== null) {
            a.builder = createIndependentShip(galaxy, design, a.colony);
            a.jobHabitat = null;
            tagIfHerder(galaxy, a.colony, a.builder);
            st.stats.constructorsBuilt++;
        }
    }
    return built;
}

// ---------------------------------------------------------------------------------------------------------------
// (b) Stations
// ---------------------------------------------------------------------------------------------------------------

/** Unclaimed: no owner, or only the independents (a system with an independent colony). */
function systemUnclaimed(galaxy: Galaxy, h: Habitat): boolean {
    const owner = checkSystemOwnership(galaxy, galaxy.determineHabitatSystemStar(h)).empire;
    return owner === null || owner === galaxy.independentEmpire;
}

function stationDesignFor(galaxy: Galaxy, h: Habitat): Design | null {
    // Galaxy.8.cs 846-847: gas → GasMiningStation, mineral → MiningStation (mineral wins).
    let d: Design | null = null;
    if (habitatResourcesContainsGroup(galaxy, h, ResourceGroup.Gas)) d = independentDesign(galaxy, BuiltObjectSubRole.GasMiningStation);
    if (habitatResourcesContainsGroup(galaxy, h, ResourceGroup.Mineral)) d = independentDesign(galaxy, BuiltObjectSubRole.MiningStation);
    return d;
}

function stationSiteFree(h: Habitat): boolean {
    return h.empire === null && h.population.items.length === 0 && h.category !== HabitatCategoryType.Star && (h.basesAtHabitat == null || h.basesAtHabitat.length === 0);
}

/** Nearest free mining site in the home system or an unclaimed system within the station radius (no Rnd). */
export function selectStationSite(galaxy: Galaxy, a: IndependentActor): Habitat | null {
    const st = independentsState(galaxy);
    const radius = stationRadius(galaxy, a);
    const taken = new Set(st.actors.map((x) => x.jobHabitat).filter((h): h is Habitat => h !== null));
    let best: Habitat | null = null;
    let bestD = Number.MAX_VALUE;
    for (const sys of galaxy.systems) {
        const star = sys.systemStar;
        if (star === null) continue;
        const home = star.systemIndex === a.colony.systemIndex;
        if (!home && dist(galaxy, star, a.colony) > radius) continue;
        for (const h of galaxy.systemHabitatsOf(star.systemIndex)) {
            if (!stationSiteFree(h) || taken.has(h)) continue;
            if (!home && !systemUnclaimed(galaxy, h)) continue;
            if (stationDesignFor(galaxy, h) === null) continue;
            // Home system first, then the nearest.
            const d = (home ? 0 : SECTOR_SIZE * 100) + dist(galaxy, h, a.colony);
            if (d < bestD) {
                bestD = d;
                best = h;
            }
        }
    }
    return best;
}

/**
 * Places an independent mining station at `habitat` — the body of Galaxy.8.cs 835 CreateMiningStation (stationPlacement.ts
 * createMiningStation) for the independent empire, without the territory test (the site is unclaimed by construction).
 */
export function placeIndependentStation(galaxy: Galaxy, habitat: Habitat): BuiltObject | null {
    const ind = galaxy.independentEmpire;
    if (ind === null || !stationSiteFree(habitat)) return null;
    const design = stationDesignFor(galaxy, habitat);
    if (design === null) return null;
    const p = galaxy.selectRelativeHabitatSurfacePoint(habitat);
    design.buildCount++;
    const purchasePrice = design.calculateCurrentPurchasePrice(galaxy);
    const bo = new BuiltObject(design, galaxy.generateBuiltObjectName(design, habitat), galaxy, true);
    bo.purchasePrice = purchasePrice;
    bo.parentHabitat = habitat;
    bo.parentOffsetX = p.x;
    bo.parentOffsetY = p.y;
    bo.heading = galaxy.selectRandomHeading();
    bo.targetHeading = bo.heading;
    bo.reDefine();
    bo.currentFuel = bo.fuelCapacity;
    bo.currentShields = bo.shieldsCapacity;
    bo.nearestSystemStar = galaxy.determineHabitatSystemStar(habitat);
    // State-owned (C#: private): an independent private base would count against GenerateIndependentTraders' freighter
    // budget (Galaxy.7.cs 4366 CountNonPirates), so the ported freighters (c) stay as they are.
    ind.addBuiltObjectToGalaxy(bo, habitat, false, true, Math.trunc(bo.parentOffsetX), Math.trunc(bo.parentOffsetY));
    if (bo.cargo !== null) {
        const cargoList = resolveRetrofitResourcesForBase(galaxy, ind);
        for (let i = 0; i < cargoList.items.length; i++) bo.cargo.add(cargoList.items[i]);
    }
    return bo;
}

function missionIdle(bo: BuiltObject): boolean {
    const m = builtObjectMission(bo.mission);
    return m === null || m.type === BuiltObjectMissionType.Undefined;
}

/** (b) The construction ship's job: pick a site, fly there (Move, as civilianAI assigns Build targets), place the station. */
export function runConstruction(galaxy: Galaxy, a: IndependentActor): void {
    const ind = galaxy.independentEmpire;
    if (ind === null || a.status !== 'active' || !alive(a.builder, ind)) return;
    const st = independentsState(galaxy);
    const ship = a.builder;
    const t = now(galaxy);
    a.stations = a.stations.filter((b) => alive(b, ind));
    if (a.stations.length >= stationQuota(galaxy, a)) {
        a.jobHabitat = null;
        return;
    }
    if (a.jobHabitat !== null && (!stationSiteFree(a.jobHabitat) || t - a.jobSince > JOB_TIMEOUT_DAYS * GAME_DAY_LENGTH)) a.jobHabitat = null;
    if (a.jobHabitat === null) {
        const site = selectStationSite(galaxy, a);
        if (site === null) return;
        a.jobHabitat = site;
        a.jobSince = t;
        assignMission(galaxy, ship, BuiltObjectMissionType.Move, site, null, BuiltObjectMissionPriority.Normal);
        return;
    }
    const site = a.jobHabitat;
    if (dist(galaxy, ship, site) <= ARRIVE_RANGE) {
        const station = placeIndependentStation(galaxy, site);
        a.jobHabitat = null;
        if (station !== null) {
            a.stations.push(station);
            st.stats.stationsBuilt++;
        }
        assignMission(galaxy, ship, BuiltObjectMissionType.Move, a.colony, null, BuiltObjectMissionPriority.Normal);
    } else if (missionIdle(ship)) {
        assignMission(galaxy, ship, BuiltObjectMissionType.Move, site, null, BuiltObjectMissionPriority.Normal);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// (b) Friction: a station in a system another empire claims
// ---------------------------------------------------------------------------------------------------------------

function stationPrice(galaxy: Galaxy, station: BuiltObject): number {
    return Math.max(1, Math.round(station.purchasePrice > 0 ? station.purchasePrice : (station.design?.calculateCurrentPurchasePrice(galaxy) ?? 1000)));
}

/** Raises the friction point for `empire` (hook + decision). No Rnd. */
export function raiseStationFriction(galaxy: Galaxy, a: IndependentActor | null, station: BuiltObject, empire: Empire): FrictionRecord {
    const st = independentsState(galaxy);
    const rec: FrictionRecord = { station, colony: a?.colony ?? null, empireId: empire.empireId, status: 'pending', date: now(galaxy) };
    st.friction.push(rec);
    st.stats.frictions++;
    independentStationFriction(galaxy, galaxy.independentEmpire!, empire, station);
    const where = station.parentHabitat?.name ?? '';
    raiseScenarioDecision(galaxy, empire, {
        kind: DECISION_FRICTION,
        title: scenarioText('Scenario Independents Friction Title'),
        text: scenarioText('Scenario Independents Friction', station.name, where),
        options: [
            { id: 'buyout', label: scenarioText('Scenario Independents Buyout', String(stationPrice(galaxy, station))) },
            { id: 'tolerate', label: scenarioText('Scenario Independents Tolerate') },
            { id: 'clear', label: scenarioText('Scenario Independents Clear') },
        ],
        defaultOption: 'tolerate',
        expiresDays: 60,
        context: { frictionIndex: st.friction.length - 1 },
    });
    return rec;
}

/** Every independent station whose system a normal empire claims now gets one friction point per claimant. */
export function checkStationFriction(galaxy: Galaxy): number {
    const st = independentsState(galaxy);
    const ind = galaxy.independentEmpire;
    let raised = 0;
    for (const a of st.actors) {
        for (const station of a.stations) {
            if (!alive(station, ind) || station.parentHabitat === null) continue;
            const owner = checkSystemOwnership(galaxy, galaxy.determineHabitatSystemStar(station.parentHabitat)).empire;
            if (!normalEmpire(galaxy, owner)) continue;
            if (st.friction.some((f) => f.station === station && f.empireId === owner.empireId)) continue;
            raiseStationFriction(galaxy, a, station, owner);
            raised++;
        }
    }
    return raised;
}

/** Applies a friction answer. */
export function resolveFriction(galaxy: Galaxy, rec: FrictionRecord, option: string): void {
    const st = independentsState(galaxy);
    const e = empireById(galaxy, rec.empireId);
    const ind = galaxy.independentEmpire;
    if (rec.status !== 'pending') return;
    if (e === null || !alive(rec.station, ind)) {
        rec.status = 'tolerate';
        return;
    }
    const league = rec.colony !== null ? leagueOf(galaxy, rec.colony) : null;
    if (option === 'buyout') {
        const price = stationPrice(galaxy, rec.station);
        if (e.stateMoney >= price) {
            e.stateMoney -= price;
            takeOwnershipOfBuiltObject(galaxy, ind!, rec.station, e);
            rec.status = 'buyout';
            st.stats.buyouts++;
            return;
        }
        option = 'tolerate';
    }
    if (option === 'clear') {
        builtObjectCompleteTeardown(galaxy, rec.station);
        rec.status = 'clear';
        st.stats.cleared++;
        if (league !== null) league.standing[e.empireId] = (league.standing[e.empireId] ?? 0) - STANDING_RAID;
        const a = rec.colony !== null ? actorOf(galaxy, rec.colony) : null;
        if (a !== null) a.lastExpansion = now(galaxy);
        return;
    }
    rec.status = 'tolerate';
    st.stats.tolerated++;
    if (league !== null) league.standing[e.empireId] = (league.standing[e.empireId] ?? 0) + STANDING_NEIGHBOUR;
}

/** AI rule: buy out when rich (money ≥ 3 × price), clear when aggressive, else tolerate. */
export function aiFrictionChoice(galaxy: Galaxy, e: Empire, station: BuiltObject): string {
    if (e.stateMoney >= stationPrice(galaxy, station) * 3) return 'buyout';
    if (e.dominantRace !== null && raceAggressionLevel(galaxy, e.dominantRace) >= 120) return 'clear';
    return 'tolerate';
}

// ---------------------------------------------------------------------------------------------------------------
// Raids: own militia answers; league militias answer raids on any member
// ---------------------------------------------------------------------------------------------------------------

/** habitatAttacked: record the raid (answered in the periodic tick; no Rnd here). */
export function onHabitatAttacked(galaxy: Galaxy, ev: { habitat: Habitat; attacker: unknown; attackingEmpire: Empire | null }): void {
    const a = actorOf(galaxy, ev.habitat);
    if (a === null || a.status !== 'active' || !isBuiltObject(ev.attacker)) return;
    const attacker = ev.attacker;
    if (attacker.empire === galaxy.independentEmpire) return;
    const t = now(galaxy);
    const last = a.raids[a.raids.length - 1];
    if (last !== undefined && last.attacker === attacker && t - last.date < GAME_DAY_LENGTH * 5) return;
    a.raids.push({ attacker, empireId: attacker.empire?.empireId ?? -1, date: t, answered: false });
    if (a.raids.length > 20) a.raids.splice(0, a.raids.length - 20);
}

function sendGroup(galaxy: Galaxy, a: IndependentActor, target: BuiltObject): boolean {
    const g = a.group;
    if (g === null || g.ships.every((b) => b.hasBeenDestroyed)) return false;
    return shipGroupAssignMission(galaxy, g, BuiltObjectMissionType.Attack, target, null, BuiltObjectMissionPriority.High, false);
}

/** Answers open raids: the colony's militia, and in a league every member's militia. */
export function answerRaids(galaxy: Galaxy): number {
    const st = independentsState(galaxy);
    let answered = 0;
    for (const a of st.actors) {
        for (const r of a.raids) {
            if (r.answered) continue;
            r.answered = true;
            if (r.attacker.hasBeenDestroyed) continue;
            const responders: IndependentActor[] = [a];
            const league = scenarioFlag(galaxy, LEAGUES_FLAG) ? leagueOf(galaxy, a.colony) : null;
            if (league !== null) {
                for (const m of league.members) {
                    const ma = actorOf(galaxy, m);
                    if (ma !== null && ma !== a && ma.status === 'active') responders.push(ma);
                }
                if (r.empireId >= 0) league.standing[r.empireId] = (league.standing[r.empireId] ?? 0) - STANDING_RAID;
            }
            for (const x of responders) if (sendGroup(galaxy, x, r.attacker)) answered++;
        }
    }
    st.stats.raidsAnswered += answered;
    return answered;
}

// ---------------------------------------------------------------------------------------------------------------
// Item 3: leagues
// ---------------------------------------------------------------------------------------------------------------

function threatened(galaxy: Galaxy, a: IndependentActor, t: number): boolean {
    const w = THREAT_DAYS * GAME_DAY_LENGTH;
    return a.raids.some((r) => t - r.date <= w) || (a.lastExpansion > 0 && t - a.lastExpansion <= w) || (a.lastHerdLoss > 0 && t - a.lastHerdLoss <= w);
}

function prosperous(a: IndependentActor): boolean {
    return a.colony.population.totalAmount >= PROSPEROUS_POP;
}

/** Same race, or both attitudes (aggression, friendliness) within 40 of each other. */
export function attitudesCompatible(galaxy: Galaxy, x: Habitat, y: Habitat): boolean {
    const rx = x.population.dominantRace;
    const ry = y.population.dominantRace;
    if (rx === null || ry === null) return false;
    if (rx === ry) return true;
    return Math.abs(raceAggressionLevel(galaxy, rx) - raceAggressionLevel(galaxy, ry)) <= 40 && Math.abs(raceFriendlinessLevel(galaxy, rx) - raceFriendlinessLevel(galaxy, ry)) <= 40;
}

/** Herd losses (19j): a herd kill in the colony's system this year marks the colony threatened. */
function reviewHerdLosses(galaxy: Galaxy): void {
    const hs = peekRimHerdersState(galaxy);
    if (hs === null) return;
    for (const a of independentsState(galaxy).actors) {
        for (const k of hs.kills) if (k.systemIndex === a.colony.systemIndex && k.date > a.lastHerdLoss) a.lastHerdLoss = k.date;
    }
}

/** Forms a league (members[0] is the council seat). Draws the league colour (NextDouble-free: one Next). */
export function formLeague(galaxy: Galaxy, members: Habitat[]): IndependentLeague | null {
    const st = independentsState(galaxy);
    const actors = members.map((m) => actorOf(galaxy, m));
    if (members.length < 2 || actors.some((a) => a === null || a.status !== 'active' || a.leagueId >= 0)) return null;
    const founder = members[0];
    const race = founder.population.dominantRace;
    const league: IndependentLeague = {
        id: st.nextLeagueId++,
        name: scenarioText('Scenario Independents League Name', founder.name),
        colour: galaxy.rnd.next(0, 0x1000000),
        flagShape: race?.defaultFlagDesign ?? -1,
        founder,
        members: [...members],
        status: 'active',
        formedDate: now(galaxy),
        cohesion: COHESION_START,
        standing: {},
        offered: [],
        tradePartners: [],
        extraSent: false,
        colonyShip: null,
        colonyTarget: null,
        colonySince: 0,
        extraColony: null,
        protectorId: -1,
        protectorateEmpireId: -1,
        tradeBloc: false,
    };
    for (const a of actors) a!.leagueId = league.id;
    st.leagues.push(league);
    st.stats.leaguesFormed++;
    poolLeagueHerds(galaxy, league);
    scenarioNews(galaxy, null, scenarioText('Scenario Independents League Formed', league.name, members.map((m) => m.name).join(', '), founder.name));
    return league;
}

/** Yearly formation: colonies (list order) under threat or prosperous, with compatible neighbours in the league radius. */
export function reviewLeagueFormation(galaxy: Galaxy): IndependentLeague[] {
    const st = independentsState(galaxy);
    const t = now(galaxy);
    const radius = indParam(galaxy, 'independentLeaguesRadius') * SECTOR_SIZE;
    const minMembers = Math.max(2, Math.trunc(indParam(galaxy, 'independentLeaguesMinMembers')));
    const chance = indParam(galaxy, 'independentLeaguesChance');
    const formed: IndependentLeague[] = [];
    const eligible = (a: IndependentActor): boolean => a.status === 'active' && a.leagueId < 0 && (threatened(galaxy, a, t) || prosperous(a));
    for (const f of st.actors) {
        if (!eligible(f)) continue;
        const group = [f.colony];
        for (const o of st.actors) {
            if (o === f || !eligible(o)) continue;
            if (dist(galaxy, o.colony, f.colony) > radius || !attitudesCompatible(galaxy, f.colony, o.colony)) continue;
            group.push(o.colony);
        }
        if (group.length < minMembers) continue;
        if (galaxy.rnd.nextDouble() >= chance) continue;
        // Council seat: the most populous member.
        group.sort((x, y) => y.population.totalAmount - x.population.totalAmount);
        const l = formLeague(galaxy, group);
        if (l !== null) formed.push(l);
    }
    return formed;
}

/** Herder leagues pool herds: every member herd is docile to the union of the members' herds' docile empires. */
export function poolLeagueHerds(galaxy: Galaxy, league: IndependentLeague): number {
    if (!scenarioFlag(galaxy, RIM_HERDERS_FLAG)) return 0;
    const herds = league.members.flatMap((m) => {
        const hc = herderColonyOf(galaxy, m);
        return hc === null ? [] : herderColonyHerds(galaxy, hc);
    });
    const ids = new Set<number>();
    for (const h of herds) for (const id of h.docileEmpireIds) ids.add(id);
    for (const h of herds) for (const id of ids) if (!h.docileEmpireIds.includes(id)) setRimHerdDocile(galaxy, h, id, true);
    return herds.length;
}

/** Dissolves a league: members back to isolated behaviour (the extra colony stays independent). */
export function dissolveLeague(galaxy: Galaxy, league: IndependentLeague, status: 'dissolved' | 'joined' = 'dissolved'): void {
    if (league.status !== 'active') return;
    const st = independentsState(galaxy);
    league.status = status;
    for (const a of st.actors) if (a.leagueId === league.id) a.leagueId = -1;
    if (status === 'dissolved') {
        st.stats.leaguesDissolved++;
        scenarioNews(galaxy, null, scenarioText('Scenario Independents League Dissolved', league.name));
    }
}

function removeMember(galaxy: Galaxy, league: IndependentLeague, colony: Habitat): void {
    const i = league.members.indexOf(colony);
    if (i >= 0) league.members.splice(i, 1);
    const a = actorOf(galaxy, colony);
    if (a !== null && a.leagueId === league.id) a.leagueId = -1;
}

/** colonyOwnerChanged: a member conquered (taken by anyone but the league's own protectorate) dissolves the league. No Rnd. */
export function onColonyOwnerChanged(galaxy: Galaxy, ev: { colony: Habitat; from: Empire | null; to: Empire | null }): void {
    const a = actorOf(galaxy, ev.colony);
    if (a === null) return;
    if (ev.to !== galaxy.independentEmpire) a.status = 'lost';
    const league = leagueById(galaxy, a.leagueId);
    if (league === null || league.status !== 'active' || ev.to === galaxy.independentEmpire) return;
    if (ev.to !== null && ev.to.empireId === league.protectorateEmpireId) return;
    if (league.protectorId >= 0 && league.protectorateEmpireId < 0) return; // a protectorate adoption in progress
    dissolveLeague(galaxy, league);
}

/** colonyFounded: a neighbour's expansion near an independent colony (inside the league radius) is a threat. No Rnd. */
export function onColonyFounded(galaxy: Galaxy, ev: { colony: Habitat; empire: Empire }): void {
    if (ev.empire === galaxy.independentEmpire) return;
    const st = independentsState(galaxy);
    const radius = Math.max(indParam(galaxy, 'independentLeaguesRadius'), indParam(galaxy, 'independentActorsStationRadius')) * SECTOR_SIZE;
    const t = now(galaxy);
    for (const a of st.actors) if (a.status === 'active' && dist(galaxy, a.colony, ev.colony) <= radius) a.lastExpansion = t;
}

/** Yearly standing: peaceful neighbours (a colony within 2 × league radius of a member) gain goodwill. */
function reviewStanding(galaxy: Galaxy, league: IndependentLeague): void {
    const radius = 2 * indParam(galaxy, 'independentLeaguesRadius') * SECTOR_SIZE;
    for (const e of galaxy.empires) {
        if (!normalEmpire(galaxy, e)) continue;
        const near = e.colonies.some((c) => league.members.some((m) => dist(galaxy, c, m) <= radius));
        if (near) league.standing[e.empireId] = (league.standing[e.empireId] ?? 0) + STANDING_NEIGHBOUR;
    }
}

/** Yearly cohesion: threatened / prosperous leagues hold together; idle ones drift apart and dissolve at 0. */
function reviewCohesion(galaxy: Galaxy, league: IndependentLeague): void {
    const t = now(galaxy);
    const live = league.members.filter((m) => {
        const a = actorOf(galaxy, m);
        return a !== null && a.status === 'active';
    });
    if (live.length < 2) {
        dissolveLeague(galaxy, league);
        return;
    }
    const held = live.some((m) => {
        const a = actorOf(galaxy, m)!;
        return threatened(galaxy, a, t) || prosperous(a);
    });
    league.cohesion = Math.min(COHESION_START, league.cohesion + (held ? COHESION_DRIFT : -COHESION_DRIFT));
    if (league.cohesion <= 0) dissolveLeague(galaxy, league);
}

/** Shared income: station income of all members pooled and split evenly (bookkeeping). */
function shareIncome(galaxy: Galaxy): void {
    const st = independentsState(galaxy);
    const ind = galaxy.independentEmpire;
    for (const a of st.actors) {
        if (a.status !== 'active' || leagueOf(galaxy, a.colony) !== null) continue;
        a.income += a.stations.filter((b) => alive(b, ind)).length * STATION_INCOME;
    }
    for (const l of st.leagues) {
        if (l.status !== 'active') continue;
        const members = l.members.map((m) => actorOf(galaxy, m)).filter((a): a is IndependentActor => a !== null && a.status === 'active');
        const pot = members.reduce((s, a) => s + a.stations.filter((b) => alive(b, ind)).length * STATION_INCOME, 0);
        for (const a of members) a.income += pot / Math.max(1, members.length);
    }
}

// ---- the one extra colony -------------------------------------------------------------------------------------

const COLONY_TYPES = (): HabitatType[] => [HabitatType.Continental, HabitatType.MarshySwamp, HabitatType.Ocean, HabitatType.Desert, HabitatType.Ice, HabitatType.Volcanic];

/** Best unclaimed world near the league (native type × 2, quality, nearer is better). No Rnd. */
export function selectLeagueColonyTarget(galaxy: Galaxy, league: IndependentLeague): Habitat | null {
    const race = league.founder.population.dominantRace;
    const radius = indParam(galaxy, 'independentLeaguesRadius') * SECTOR_SIZE;
    const types = COLONY_TYPES();
    let best: Habitat | null = null;
    let bestScore = 0;
    for (const sys of galaxy.systems) {
        const star = sys.systemStar;
        if (star === null) continue;
        const d = Math.min(...league.members.map((m) => dist(galaxy, star, m)));
        if (d > radius) continue;
        for (const h of galaxy.systemHabitatsOf(star.systemIndex)) {
            if (h.empire !== null || h.population.items.length > 0 || !types.includes(h.type)) continue;
            if (h.category !== HabitatCategoryType.Planet && h.category !== HabitatCategoryType.Moon) continue;
            if (!systemUnclaimed(galaxy, h)) continue;
            const score = Math.max(0.01, h.quality) * (race !== null && h.type === race.nativeHabitatType ? 2 : 1) / (1 + dist(galaxy, h, league.founder) / SECTOR_SIZE);
            if (score > bestScore) {
                bestScore = score;
                best = h;
            }
        }
    }
    return best;
}

/** Sends the league's single colony ship (once ever; never again, even if it is lost). */
export function sendLeagueColonyShip(galaxy: Galaxy, league: IndependentLeague): BuiltObject | null {
    if (league.status !== 'active' || league.extraSent || indParam(galaxy, 'independentLeaguesOneColony') < 0.5) return null;
    const target = selectLeagueColonyTarget(galaxy, league);
    if (target === null) return null;
    const design = independentDesign(galaxy, BuiltObjectSubRole.ColonyShip);
    if (design === null) return null;
    league.extraSent = true;
    const ship = createIndependentShip(galaxy, design, league.founder);
    league.colonyShip = ship;
    league.colonyTarget = target;
    league.colonySince = now(galaxy);
    assignMission(galaxy, ship, BuiltObjectMissionType.Move, target, null, BuiltObjectMissionPriority.Normal);
    return ship;
}

/** The colony ship arrives: the world becomes an independent colony (makeHabitatIntoColonyRuntime) and joins the league. */
export function runLeagueColonyShip(galaxy: Galaxy, league: IndependentLeague): Habitat | null {
    const ind = galaxy.independentEmpire;
    const ship = league.colonyShip;
    if (ind === null || ship === null) return null;
    if (!alive(ship, ind)) {
        league.colonyShip = null; // lost: colonisation stops (extraSent stays true)
        return null;
    }
    const target = league.colonyTarget;
    if (target === null || target.empire !== null || target.population.items.length > 0) {
        builtObjectCompleteTeardown(galaxy, ship);
        league.colonyShip = null;
        return null;
    }
    if (dist(galaxy, ship, target) > ARRIVE_RANGE) {
        if (missionIdle(ship)) assignMission(galaxy, ship, BuiltObjectMissionType.Move, target, null, BuiltObjectMissionPriority.Normal);
        return null;
    }
    const race = league.founder.population.dominantRace;
    if (race === null) return null;
    // cmdTroops.ts Colonize (the pirate branch): the independent empire takes the world with the ship's colonists.
    makeHabitatIntoColonyRuntime(galaxy, ind, target, ind, race, Math.max(1_000_000, canBuiltObjectColonizeHabitat(galaxy, ind, ship, target).newPopulationAmount));
    builtObjectCompleteTeardown(galaxy, ship);
    league.colonyShip = null;
    league.extraColony = target;
    if (!galaxy.independentColonies.includes(target)) galaxy.independentColonies.push(target);
    syncActors(galaxy);
    const a = actorOf(galaxy, target);
    if (a !== null) a.leagueId = league.id;
    if (league.status === 'active' && !league.members.includes(target)) league.members.push(target);
    independentsState(galaxy).stats.extraColonies++;
    scenarioNews(galaxy, null, scenarioText('Scenario Independents League Colony', league.name, target.name));
    return target;
}

// ---- bloc diplomacy --------------------------------------------------------------------------------------------

export type OfferOutcome = 'refused' | 'accepted' | 'split' | 'trade';

/**
 * An offer to a league goes to its council. Protectorate: the council seat joins (a protectorate empire adopting it,
 * createEmpireMidGame adoptOnly + Empire.8.cs ChangeDiplomaticRelation Protectorate); every other member follows with
 * the pull chance (relation bonus toward the offerer) or refuses and leaves (the league splits). Trade: the bloc trades
 * with the offerer (standing up for every member). Draws one NextDouble per other member (protectorate only).
 */
export function offerToLeague(galaxy: Galaxy, league: IndependentLeague, e: Empire, kind: 'protectorate' | 'trade'): OfferOutcome {
    const st = independentsState(galaxy);
    if (league.status !== 'active') return 'refused';
    const standing = league.standing[e.empireId] ?? 0;
    if (kind === 'trade') {
        if (standing < 0) return 'refused';
        if (!league.tradePartners.includes(e.empireId)) league.tradePartners.push(e.empireId);
        league.standing[e.empireId] = standing + STANDING_NEIGHBOUR;
        st.stats.tradeDeals++;
        scenarioMessage(galaxy, e, title(), scenarioText('Scenario Independents Trade Accepted', league.name), { type: EmpireMessageType.GeneralGoodEvent, subject: league.founder });
        return 'trade';
    }
    if (standing < STANDING_ACCEPT) {
        league.standing[e.empireId] = standing - 5;
        scenarioMessage(galaxy, e, title(), scenarioText('Scenario Independents Offer Refused', league.name), { type: EmpireMessageType.GeneralBadEvent, subject: league.founder });
        return 'refused';
    }
    const pull = indParam(galaxy, 'independentLeaguesPullChance');
    const joining: Habitat[] = [league.founder];
    const refusing: Habitat[] = [];
    for (const m of league.members) {
        if (m === league.founder) continue;
        if (galaxy.rnd.nextDouble() < pull) joining.push(m);
        else refusing.push(m);
    }
    const ind = galaxy.independentEmpire!;
    const ships: BuiltObject[] = [];
    for (const m of joining) {
        const a = actorOf(galaxy, m);
        if (a === null) continue;
        for (const b of [...a.fleet, ...a.stations, a.builder]) if (alive(b, ind) && !ships.includes(b)) ships.push(b);
        const hc = herderColonyOf(galaxy, m);
        if (hc !== null && hc.status === 'free') hc.status = 'protectorate';
    }
    const race = league.founder.population.dominantRace;
    league.protectorId = e.empireId; // before the adoption: its colonyOwnerChanged events are not a conquest
    const protectorate = createEmpireMidGame(galaxy, {
        race: race ?? 'Human',
        name: scenarioText('Scenario Independents League Protectorate Name', league.name),
        adoptOnly: true,
        adopt: { colonies: joining, builtObjects: ships },
        techLevel: 0.3,
    });
    if (protectorate === null) {
        league.protectorId = -1;
        return 'refused';
    }
    league.protectorateEmpireId = protectorate.empireId;
    changeDiplomaticRelation(galaxy, e, obtainDiplomaticRelation(e, protectorate), DiplomaticRelationType.Protectorate);
    const ev = obtainEmpireEvaluation(galaxy, protectorate, e);
    ev.incidentEvaluation = ev.incidentEvaluationRaw + PULL_BONUS;
    for (const m of refusing) removeMember(galaxy, league, m);
    for (const m of joining) removeMember(galaxy, league, m);
    dissolveLeague(galaxy, league, 'joined');
    st.stats.protectorates++;
    if (refusing.length > 0) st.stats.splits++;
    // The refusing members may regroup as their own (smaller) league later (formation review).
    scenarioMessage(galaxy, e, title(), scenarioText('Scenario Independents Offer Accepted', league.name, String(joining.length), protectorate.name), { type: EmpireMessageType.GeneralGoodEvent, subject: league.founder });
    if (refusing.length > 0) scenarioMessage(galaxy, e, title(), scenarioText('Scenario Independents Offer Split', league.name, String(refusing.length)), { type: EmpireMessageType.GeneralNeutralEvent, subject: league.founder });
    return refusing.length > 0 ? 'split' : 'accepted';
}

/** Yearly: the neighbour with the best standing ≥ STANDING_OFFER (not yet asked) is asked whether to make an offer. */
export function reviewLeagueOffers(galaxy: Galaxy): number {
    let raised = 0;
    for (const league of independentsState(galaxy).leagues) {
        if (league.status !== 'active') continue;
        let best: Empire | null = null;
        let bestS = STANDING_OFFER - 1;
        for (const e of galaxy.empires) {
            if (!normalEmpire(galaxy, e) || league.offered.includes(e.empireId)) continue;
            const s = league.standing[e.empireId] ?? 0;
            if (s > bestS) {
                bestS = s;
                best = e;
            }
        }
        if (best === null) continue;
        league.offered.push(best.empireId);
        raiseScenarioDecision(galaxy, best, {
            kind: DECISION_OFFER,
            title: scenarioText('Scenario Independents Offer Title'),
            text: scenarioText('Scenario Independents Offer', league.name, String(league.members.length)),
            options: [
                { id: 'protectorate', label: scenarioText('Scenario Independents Offer Protectorate') },
                { id: 'trade', label: scenarioText('Scenario Independents Offer Trade') },
                { id: 'ignore', label: scenarioText('Scenario Independents Offer Ignore') },
            ],
            defaultOption: 'ignore',
            expiresDays: 90,
            context: { leagueId: league.id },
        });
        raised++;
    }
    return raised;
}

/** AI rule: a protectorate for peaceable empires, trade for the rest. */
export function aiOfferChoice(galaxy: Galaxy, e: Empire): string {
    if (e.dominantRace !== null && raceAggressionLevel(galaxy, e.dominantRace) < 110) return 'protectorate';
    return 'trade';
}

// ---------------------------------------------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------------------------------------------

/** Game start (after the herders' start): actors, full militias and construction ships. */
export function independentsGameStart(galaxy: Galaxy): void {
    if (galaxy.independentEmpire === null) return;
    const st = independentsState(galaxy);
    syncActors(galaxy);
    for (const a of st.actors) refreshMilitia(galaxy, a, false);
    st.lastMilitia = now(galaxy);
    st.lastTechRefresh = now(galaxy);
    st.started = true;
}

/** Periodic tick (daily): actors, raids, militia refresh when due, tech follow when due, construction jobs, the league colony ship, friction. */
export function independentsTick(galaxy: Galaxy): void {
    if (galaxy.independentEmpire === null) return;
    const st = independentsState(galaxy);
    const t = now(galaxy);
    syncActors(galaxy);
    if (!st.started) {
        independentsGameStart(galaxy);
    } else if (t - st.lastMilitia >= Math.max(1, indParam(galaxy, 'independentActorsMilitiaDays')) * GAME_DAY_LENGTH) {
        st.lastMilitia = t;
        for (const a of st.actors) refreshMilitia(galaxy, a, true);
    }
    if (st.started && t - st.lastTechRefresh >= Math.max(1, indParam(galaxy, 'independentTechRefreshYears')) * YEAR_LENGTH) {
        st.lastTechRefresh = t;
        refreshIndependentTech(galaxy);
    }
    answerRaids(galaxy);
    for (const a of st.actors) runConstruction(galaxy, a);
    if (scenarioFlag(galaxy, LEAGUES_FLAG)) {
        for (const l of st.leagues) {
            if (l.status !== 'active') continue;
            if (!l.extraSent) sendLeagueColonyShip(galaxy, l);
            else if (l.colonyShip !== null) runLeagueColonyShip(galaxy, l);
        }
    }
    checkStationFriction(galaxy);
}

/** Yearly tick: income; with leagues — herd losses, standing, cohesion / dissolution, formation, herd pooling, offers, 19a bloc. */
export function independentsYear(galaxy: Galaxy, year: number): void {
    void year;
    if (galaxy.independentEmpire === null) return;
    syncActors(galaxy);
    if (scenarioFlag(galaxy, LEAGUES_FLAG)) {
        reviewHerdLosses(galaxy);
        for (const l of independentsState(galaxy).leagues) {
            if (l.status !== 'active') continue;
            reviewStanding(galaxy, l);
            reviewCohesion(galaxy, l);
        }
        reviewLeagueFormation(galaxy);
        for (const l of independentsState(galaxy).leagues) {
            if (l.status !== 'active') continue;
            poolLeagueHerds(galaxy, l);
            l.tradeBloc = scenarioFlag(galaxy, 'rimTrader') && leagueOnRim(galaxy, l);
        }
        reviewLeagueOffers(galaxy);
    }
    shareIncome(galaxy);
}

function resolveFrictionDecision(galaxy: Galaxy, d: ScenarioDecision, option: string): void {
    const rec = independentsState(galaxy).friction[d.context.frictionIndex as number];
    if (rec !== undefined) resolveFriction(galaxy, rec, option);
}

function resolveOfferDecision(galaxy: Galaxy, d: ScenarioDecision, option: string): void {
    if (option !== 'protectorate' && option !== 'trade') return;
    const league = leagueById(galaxy, d.context.leagueId as number);
    if (league === null || !d.empire.active) return;
    offerToLeague(galaxy, league, d.empire, option);
}

/** The game year (for callers / tests). */
export function independentsYearOf(galaxy: Galaxy): number {
    return gameYear(now(galaxy));
}

registerScenarioGameStart({ id: 'independents.start', order: 10, flag: ACTORS_FLAG, run: (g) => independentsGameStart(g) });
registerScenarioPeriodic({ id: 'independents.tick', order: 10, flag: ACTORS_FLAG, periodDays: 1, run: (g) => independentsTick(g) });
registerScenarioYearly({ id: 'independents.year', order: 10, flag: ACTORS_FLAG, run: (g, y) => independentsYear(g, y) });
registerScenarioEvent({ id: 'independents.raid', flag: ACTORS_FLAG, event: 'habitatAttacked', run: onHabitatAttacked });
registerScenarioEvent({ id: 'independents.owner', flag: ACTORS_FLAG, event: 'colonyOwnerChanged', run: onColonyOwnerChanged });
registerScenarioEvent({ id: 'independents.founded', flag: ACTORS_FLAG, event: 'colonyFounded', run: onColonyFounded });
registerScenarioDecision({
    id: DECISION_FRICTION,
    kind: DECISION_FRICTION,
    flag: ACTORS_FLAG,
    resolve: resolveFrictionDecision,
    aiChoose: (g, d) => {
        const rec = independentsState(g).friction[d.context.frictionIndex as number];
        return rec === undefined ? 'tolerate' : aiFrictionChoice(g, d.empire, rec.station);
    },
});
registerScenarioDecision({ id: DECISION_OFFER, kind: DECISION_OFFER, flag: LEAGUES_FLAG, resolve: resolveOfferDecision, aiChoose: (g, d) => aiOfferChoice(g, d.empire) });
