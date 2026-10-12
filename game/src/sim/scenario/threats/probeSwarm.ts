// Dead Probe Swarm (docs/NEW_THREATS.md §3). Not a port: new scenario behaviour composed of ported functions.
// Registered from scenario/packages.ts; every handler is gated by the `threatProbeSwarm` flag (and the threat
// framework's existence lottery), so with the flag off nothing here runs and nothing draws.
//
// A long-dead civilisation's self-replicating probes: a pirate-kind faction (createThreatFaction kind 'pirate', the
// stock pirate base as its mothercore) that is NOT a pirate — the pirateFactionPassive query (tick/pirateTick.ts)
// switches off the pirate AI's raids, mission bids, extortion, trade, offers, fleet tasks and construction; the
// pirateProtectionDesired query keeps the empires from buying protection. This module drives it instead:
//   - budget probeSwarmBudget + probeSwarmBudgetPerStation per mining station a year (at most probeSwarmBudgetCap),
//     spent only on warships and mining stations (design purchase price);
//   - expansion: a mining / gas mining station at the free asteroid field or gas giant nearest the mothercore, within
//     probeSwarmExpandRangePct of the galaxy width of a swarm station, in a system no empire has a colony in;
//   - defence: any ship (any owner) inside a system with a swarm station is attacked by the nearest swarm warships;
//   - the mothercore: destroying it ends the expansion (and, as for any pirate faction whose base is gone, the stock
//     checkForTerminatedPirateEmpires dissolves the faction: its stations go independent). Its killer salvages
//     probeSwarmSalvageResearch points of drone tech and (with Archive Cores) an Archive Core.
//
// Rnd: placement picks are deterministic (best score, then habitat index). Stock functions called here (faction
// creation, design generation, ship / station names) draw galaxy.rnd. Fixed iteration orders: galaxy.habitats,
// galaxy.empires then builtObjects list order, the swarm's lists in push order.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Design } from '../../design';
import { BuiltObject } from '../../builtObject';
import { Habitat, HabitatCategoryType, HabitatType } from '../../types';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { ResourceGroup } from '../../resourceSystem';
import { habitatResourcesContainsGroup } from '../../stationPlacement';
import { identifyPirateBase } from '../../characters';
import { generateNewBuiltObject } from '../../empireEvents';
import { generateDesignFromSpec } from '../../designGeneration';
import { galaxyDesignSpecificationBySubRole } from '../../gameStartTail';
import { takeOwnershipOfBuiltObject } from '../../combat/ownership';
import { assignMission } from '../../missions/assign';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../../missions/mission';
import { SystemVisibilityStatus } from '../../visibility';
import { EmpireMessageType } from '../../messages';
import { startStarDateForAge } from '../../galaxyTime';
import { galaxyStarDate } from '../../tick/simTime';
import { GAME_DAY_LENGTH, gameYear, registerScenarioEvent, registerScenarioPeriodic, registerScenarioQuery } from '../hooks';
import { scenarioMessage, scenarioText } from '../messages';
import { scenarioParam } from '../state';
import { isHumanEmpire } from '../../humanEmpires';
import { grantArchiveCore, grantResearchPoints } from './archiveCores';
import { raiseFactionTech } from './robotMutiny';
import {
    KNOWLEDGE_CONFIRMED,
    arcNews,
    createThreatFaction,
    knowledgeLevel,
    normalEmpires,
    pastThreatMinYear,
    peekThreatState,
    registerThreatExistence,
    registerThreatKnownSites,
    revealTo,
    threatExists,
    threatState,
    type KnownThreatSite,
    type SentStages,
    type ThreatKnowledge,
} from './framework';

export const PROBE_SWARM_KEY = 'probeSwarm';
export const PROBE_SWARM_FLAG = 'threatProbeSwarm';
const TAG = 'ProbeSwarm';
const PERIOD_DAYS = 10;
/** Galaxy.MaxSolarSystemSize (resourceTargets.ts): a ship this close to a system's star is inside the system. */
const SYSTEM_RADIUS = 23000;
const MAX_BUILDS_PER_PERIOD = 3;
const MAX_INTRUDERS_PER_PERIOD = 12;

export interface ProbeSwarmYearRow {
    year: number;
    stations: number;
    ships: number;
    budget: number;
}

export interface ProbeSwarmState {
    phase: 'waiting' | 'active' | 'ended';
    faction: Empire | null;
    home: Habitat | null;
    mothercore: BuiltObject | null;
    stations: BuiltObject[];
    ships: BuiltObject[];
    budget: number;
    lastBudgetDate: number;
    /** Star date of the last new station (one every probeSwarmStationDays). */
    lastStationDate: number;
    mothercoreDestroyed: boolean;
    mothercoreKiller: Empire | null;
    mothercoreDate: number;
    stationsBuilt: number;
    shipsBuilt: number;
    /** Intruder engagements ordered (one per intruder per period). */
    engagements: number;
    /** Swarm ships / stations destroyed, and kills by the swarm. */
    losses: number;
    kills: number;
    history: ProbeSwarmYearRow[];
    sentStages: SentStages;
    knowledge: ThreatKnowledge[];
}

function newState(): ProbeSwarmState {
    return {
        phase: 'waiting', faction: null, home: null, mothercore: null, stations: [], ships: [], budget: 0, lastBudgetDate: 0, lastStationDate: 0,
        mothercoreDestroyed: false, mothercoreKiller: null, mothercoreDate: 0, stationsBuilt: 0, shipsBuilt: 0, engagements: 0, losses: 0, kills: 0,
        history: [], sentStages: {}, knowledge: [],
    };
}

export function probeSwarmState(galaxy: Galaxy): ProbeSwarmState {
    return threatState(galaxy, PROBE_SWARM_KEY, newState);
}

export function peekProbeSwarmState(galaxy: Galaxy): ProbeSwarmState | null {
    return peekThreatState<ProbeSwarmState>(galaxy, PROBE_SWARM_KEY);
}

function p(galaxy: Galaxy, name: string, fallback: number): number {
    return scenarioParam(galaxy, name, fallback);
}
const P = {
    year: (g: Galaxy) => p(g, 'probeSwarmYear', 6),
    techLevel: (g: Galaxy) => Math.trunc(p(g, 'probeSwarmTechLevel', 3)),
    budget: (g: Galaxy) => p(g, 'probeSwarmBudget', 60000),
    perStation: (g: Galaxy) => p(g, 'probeSwarmBudgetPerStation', 15000),
    cap: (g: Galaxy) => p(g, 'probeSwarmBudgetCap', 250000),
    startShips: (g: Galaxy) => Math.trunc(p(g, 'probeSwarmStartShips', 4)),
    shipsPerStation10: (g: Galaxy) => p(g, 'probeSwarmShipsPerStation', 5),
    maxStations: (g: Galaxy) => Math.trunc(p(g, 'probeSwarmMaxStations', 30)),
    expandRange: (g: Galaxy) => (p(g, 'probeSwarmExpandRangePct', 6) * g.sizeX) / 100,
    minCapitalDistance: (g: Galaxy) => (p(g, 'probeSwarmMinCapitalDistancePct', 15) * g.sizeX) / 100,
    salvage: (g: Galaxy) => p(g, 'probeSwarmSalvageResearch', 60000),
    stationDays: (g: Galaxy) => p(g, 'probeSwarmStationDays', 75),
};

const WARSHIP_SUBROLES = [BuiltObjectSubRole.Frigate, BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.Escort, BuiltObjectSubRole.Frigate, BuiltObjectSubRole.Cruiser];

function alive(bo: BuiltObject | null, faction: Empire | null): bo is BuiltObject {
    return bo !== null && !bo.hasBeenDestroyed && faction !== null && bo.actualEmpire === faction;
}

function yearsIn(galaxy: Galaxy): number {
    return gameYear(galaxyStarDate(galaxy)) - gameYear(startStarDateForAge(galaxy.age));
}

function isMiningSite(h: Habitat): boolean {
    return h.category === HabitatCategoryType.Asteroid || h.type === HabitatType.GasGiant || h.type === HabitatType.FrozenGasGiant;
}

/** Systems (system index) holding any empire's colony. Pure. */
function colonisedSystems(galaxy: Galaxy): Set<number> {
    const out = new Set<number>();
    for (const e of galaxy.empires) {
        if (e === null || !e.active) continue;
        for (const c of e.colonies) out.add(c.systemIndex);
    }
    return out;
}

function siteFree(h: Habitat): boolean {
    return !h.hasBeenDestroyed && h.empire === null && h.population.totalAmount <= 0 && (h.basesAtHabitat == null || h.basesAtHabitat.length === 0);
}

/**
 * The swarm's home: a free asteroid in an uncolonised system at least probeSwarmMinCapitalDistancePct of the galaxy
 * width from every normal empire's capital, with the most mining sites within one expansion step (then habitat index).
 * Without such a site, the qualifying asteroid farthest from the capitals. Pure.
 */
export function probeSwarmHomeSite(galaxy: Galaxy): Habitat | null {
    const capitals = normalEmpires(galaxy).map((e) => e.capital).filter((c): c is Habitat => c !== null);
    const colonised = colonisedSystems(galaxy);
    const minD = P.minCapitalDistance(galaxy);
    const range = P.expandRange(galaxy);
    // Per system (system-index order): its free mining sites and its first free asteroid; the score counts the sites of
    // every system within one expansion step (systems, not habitats, keep this O(systems²)).
    const systems = new Map<number, { star: Habitat; sites: number; asteroid: Habitat | null }>();
    for (const h of galaxy.habitats) {
        if (h === null || !isMiningSite(h) || !siteFree(h) || colonised.has(h.systemIndex)) continue;
        let s = systems.get(h.systemIndex);
        if (s === undefined) {
            const star = galaxy.determineHabitatSystemStar(h);
            if (star === null) continue;
            s = { star, sites: 0, asteroid: null };
            systems.set(h.systemIndex, s);
        }
        s.sites++;
        if (s.asteroid === null && h.category === HabitatCategoryType.Asteroid) s.asteroid = h;
    }
    const list = [...systems.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
    let best: Habitat | null = null;
    let bestScore = -1;
    let far: Habitat | null = null;
    let farD = -1;
    for (const s of list) {
        if (s.asteroid === null) continue;
        let dCap = Number.MAX_VALUE;
        for (const c of capitals) dCap = Math.min(dCap, galaxy.calculateDistance(s.star.xpos, s.star.ypos, c.xpos, c.ypos));
        if (dCap > farD) {
            farD = dCap;
            far = s.asteroid;
        }
        if (dCap < minD) continue;
        let n = 0;
        for (const o of list) if (galaxy.calculateDistance(s.star.xpos, s.star.ypos, o.star.xpos, o.star.ypos) <= range) n += o.sites;
        if (n > bestScore) {
            bestScore = n;
            best = s.asteroid;
        }
    }
    return best ?? far;
}

function swarmDesigns(galaxy: Galaxy, faction: Empire, lvl: number): Map<BuiltObjectSubRole, Design> {
    raiseFactionTech(galaxy, faction, lvl);
    const now = galaxyStarDate(galaxy);
    const out = new Map<BuiltObjectSubRole, Design>();
    for (const sub of [...new Set(WARSHIP_SUBROLES), BuiltObjectSubRole.MiningStation, BuiltObjectSubRole.GasMiningStation]) {
        const spec = faction.designSpecifications.find((s) => s !== null && s.subRole === sub) ?? galaxyDesignSpecificationBySubRole(sub);
        let d: Design | null = null;
        if (spec !== null && spec !== undefined) {
            try {
                d = generateDesignFromSpec(galaxy, faction, spec, lvl, now);
            } catch {
                d = null;
            }
        }
        if (d === null) d = faction.designs.filter((x) => x.subRole === sub).at(-1) ?? null;
        if (d === null) continue;
        if (!faction.designs.includes(d)) faction.designs.push(d);
        out.set(sub, d);
    }
    return out;
}

function designFor(faction: Empire, sub: BuiltObjectSubRole): Design | null {
    return faction.designs.filter((d) => d.subRole === sub).at(-1) ?? null;
}

/** Wakes the swarm at `home` (tests force it). Returns false when no faction could be created. */
export function probeSwarmWake(galaxy: Galaxy, st: ProbeSwarmState, home: Habitat): boolean {
    const race = galaxy.races.find((r) => r !== null && r.name === 'Mechanoid') ?? galaxy.races.find((r) => r !== null) ?? null;
    if (race === null) return false;
    const lvl = P.techLevel(galaxy);
    const faction = createThreatFaction(galaxy, { kind: 'pirate', race, name: scenarioText(`${TAG} Faction Name`), home, techLevel: lvl });
    if (faction === null) return false;
    st.faction = faction;
    st.home = home;
    st.mothercore = identifyPirateBase(faction);
    if (st.mothercore !== null) st.mothercore.name = scenarioText(`${TAG} Mothercore Name`);
    swarmDesigns(galaxy, faction, lvl);
    for (const b of faction.builtObjects) {
        if (b.hasBeenDestroyed) continue;
        if (b.role === BuiltObjectRole.Military && b.topSpeed > 0) st.ships.push(b);
        else if (b.subRole === BuiltObjectSubRole.MiningStation || b.subRole === BuiltObjectSubRole.GasMiningStation) st.stations.push(b);
        b.supportCostFactor = 0;
    }
    for (let i = 0; i < P.startShips(galaxy); i++) spawnWarship(galaxy, st, i);
    st.phase = 'active';
    st.lastBudgetDate = galaxyStarDate(galaxy);
    return true;
}

function spawnWarship(galaxy: Galaxy, st: ProbeSwarmState, i: number): BuiltObject | null {
    const faction = st.faction!;
    const src = st.mothercore ?? st.home;
    if (src === null) return null;
    const design = designFor(faction, WARSHIP_SUBROLES[i % WARSHIP_SUBROLES.length]) ?? designFor(faction, BuiltObjectSubRole.Frigate) ?? designFor(faction, BuiltObjectSubRole.Escort);
    if (design === null) return null;
    const pt = galaxy.selectRelativeParkingPoint();
    const bo = generateNewBuiltObject(galaxy, faction, design, null, src.xpos + pt.x, src.ypos + pt.y);
    takeOwnershipOfBuiltObject(galaxy, faction, bo, faction, false);
    bo.supportCostFactor = 0;
    st.ships.push(bo);
    return bo;
}

/** As independents.ts placeIndependentStation (Galaxy.8.cs 835 CreateMiningStation's body) for the swarm. */
function placeStation(galaxy: Galaxy, st: ProbeSwarmState, habitat: Habitat, design: Design): BuiltObject {
    const faction = st.faction!;
    const pt = galaxy.selectRelativeHabitatSurfacePoint(habitat);
    design.buildCount++;
    const bo = new BuiltObject(design, galaxy.generateBuiltObjectName(design, habitat), galaxy, true);
    bo.purchasePrice = design.calculateCurrentPurchasePrice(galaxy);
    bo.parentHabitat = habitat;
    bo.parentOffsetX = pt.x;
    bo.parentOffsetY = pt.y;
    bo.heading = galaxy.selectRandomHeading();
    bo.targetHeading = bo.heading;
    bo.reDefine();
    bo.currentFuel = bo.fuelCapacity;
    bo.currentShields = bo.shieldsCapacity;
    bo.nearestSystemStar = galaxy.determineHabitatSystemStar(habitat);
    bo.supportCostFactor = 0;
    faction.addBuiltObjectToGalaxy(bo, habitat, false, true, Math.trunc(bo.parentOffsetX), Math.trunc(bo.parentOffsetY));
    st.stations.push(bo);
    return bo;
}

function stationDesignFor(galaxy: Galaxy, faction: Empire, h: Habitat): Design | null {
    let d: Design | null = null;
    if (habitatResourcesContainsGroup(galaxy, h, ResourceGroup.Gas)) d = designFor(faction, BuiltObjectSubRole.GasMiningStation);
    if (habitatResourcesContainsGroup(galaxy, h, ResourceGroup.Mineral)) d = designFor(faction, BuiltObjectSubRole.MiningStation);
    return d;
}

/** The next expansion site: the free mining site nearest the mothercore within one step of a swarm station. Pure. */
export function probeSwarmNextSite(galaxy: Galaxy, st: ProbeSwarmState): Habitat | null {
    const faction = st.faction;
    const home = st.home;
    if (faction === null || home === null) return null;
    const anchors = [...(st.mothercore !== null ? [st.mothercore] : []), ...st.stations];
    const range = P.expandRange(galaxy);
    const colonised = colonisedSystems(galaxy);
    let best: Habitat | null = null;
    let bestD = Number.MAX_VALUE;
    for (const h of galaxy.habitats) {
        if (h === null || !isMiningSite(h) || !siteFree(h) || colonised.has(h.systemIndex)) continue;
        let near = false;
        for (const a of anchors) {
            if (galaxy.calculateDistance(a.xpos, a.ypos, h.xpos, h.ypos) <= range) {
                near = true;
                break;
            }
        }
        if (!near) continue;
        const d = galaxy.calculateDistance(home.xpos, home.ypos, h.xpos, h.ypos);
        if (d < bestD && stationDesignFor(galaxy, faction, h) !== null) {
            bestD = d;
            best = h;
        }
    }
    return best;
}

function wantedShips(galaxy: Galaxy, st: ProbeSwarmState): number {
    return P.startShips(galaxy) + Math.ceil((st.stations.length * P.shipsPerStation10(galaxy)) / 10);
}

/** Yearly income for the current station count. Pure. */
export function probeSwarmIncome(galaxy: Galaxy, st: ProbeSwarmState): number {
    return Math.min(P.cap(galaxy), P.budget(galaxy) + P.perStation(galaxy) * st.stations.length);
}

function spend(galaxy: Galaxy, st: ProbeSwarmState): void {
    if (st.mothercoreDestroyed || st.mothercore === null) return;
    const faction = st.faction!;
    for (let k = 0; k < MAX_BUILDS_PER_PERIOD; k++) {
        if (st.ships.length < wantedShips(galaxy, st)) {
            const design = designFor(faction, WARSHIP_SUBROLES[st.shipsBuilt % WARSHIP_SUBROLES.length]) ?? designFor(faction, BuiltObjectSubRole.Frigate);
            if (design === null) break;
            const cost = design.calculateCurrentPurchasePrice(galaxy);
            if (st.budget < cost) break;
            if (spawnWarship(galaxy, st, st.shipsBuilt) === null) break;
            st.budget -= cost;
            st.shipsBuilt++;
            continue;
        }
        if (st.stations.length >= P.maxStations(galaxy)) break;
        if (galaxyStarDate(galaxy) - st.lastStationDate < P.stationDays(galaxy) * GAME_DAY_LENGTH) break;
        const site = probeSwarmNextSite(galaxy, st);
        if (site === null) break;
        const design = stationDesignFor(galaxy, faction, site)!;
        const cost = design.calculateCurrentPurchasePrice(galaxy);
        if (st.budget < cost) break;
        placeStation(galaxy, st, site, design);
        st.lastStationDate = galaxyStarDate(galaxy);
        st.budget -= cost;
        st.stationsBuilt++;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Defence: attack any ship inside a system the swarm holds
// ---------------------------------------------------------------------------------------------------------------

function heldSystems(st: ProbeSwarmState): Map<number, Habitat> {
    const out = new Map<number, Habitat>();
    for (const b of [...(st.mothercore !== null && !st.mothercore.hasBeenDestroyed ? [st.mothercore] : []), ...st.stations]) {
        const star = b.nearestSystemStar ?? null;
        if (star !== null) out.set(star.systemIndex, star);
    }
    return out;
}

function defend(galaxy: Galaxy, st: ProbeSwarmState): void {
    const faction = st.faction!;
    const held = heldSystems(st);
    if (held.size === 0) return;
    const intruders: BuiltObject[] = [];
    for (const e of [...galaxy.empires, ...galaxy.pirateEmpires]) {
        if (e === null || e === faction || !e.active) continue;
        for (const list of [e.builtObjects, e.privateBuiltObjects]) {
            for (const b of list) {
                if (b.hasBeenDestroyed || b.topSpeed <= 0 || b.role === BuiltObjectRole.Base) continue;
                const star = b.nearestSystemStar;
                if (star === null || !held.has(star.systemIndex)) continue;
                if (galaxy.calculateDistance(b.xpos, b.ypos, star.xpos, star.ypos) > SYSTEM_RADIUS) continue;
                intruders.push(b);
                if (intruders.length >= MAX_INTRUDERS_PER_PERIOD) break;
            }
        }
    }
    const free = st.ships.filter((s) => {
        const m = builtObjectMission(s.mission);
        return m === null || m.type !== BuiltObjectMissionType.Attack || m.targetBuiltObject === null || m.targetBuiltObject.hasBeenDestroyed;
    });
    for (const target of intruders) {
        for (let k = 0; k < 2 && free.length > 0; k++) {
            let bi = 0;
            let bd = Number.MAX_VALUE;
            for (let i = 0; i < free.length; i++) {
                const d = galaxy.calculateDistance(free[i].xpos, free[i].ypos, target.xpos, target.ypos);
                if (d < bd) {
                    bd = d;
                    bi = i;
                }
            }
            const s = free.splice(bi, 1)[0];
            assignMission(galaxy, s, BuiltObjectMissionType.Attack, target, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
        }
        st.engagements++;
        const owner = target.actualEmpire;
        if (owner !== null && isHumanEmpire(galaxy, owner) && !(st.sentStages[`Engaged:${owner.empireId}`] ?? []).length) {
            st.sentStages[`Engaged:${owner.empireId}`] = [owner.empireId];
            scenarioMessage(galaxy, owner, scenarioText(`${TAG} Engaged Title`), scenarioText(`${TAG} Engaged`, target.name), { type: EmpireMessageType.GeneralWarning, subject: target, popup: false });
        }
    }
    // Idle warships patrol the stations (round robin).
    const posts = [...(st.mothercore !== null && !st.mothercore.hasBeenDestroyed ? [st.mothercore] : []), ...st.stations];
    let i = 0;
    for (const s of free) {
        const m = builtObjectMission(s.mission);
        if (m !== null && m.type !== BuiltObjectMissionType.Undefined && m.type !== BuiltObjectMissionType.Hold) continue;
        if (posts.length === 0) break;
        assignMission(galaxy, s, BuiltObjectMissionType.Patrol, posts[i++ % posts.length], null, BuiltObjectMissionPriority.Normal, { manuallyAssigned: true });
    }
}

function checkDiscovery(galaxy: Galaxy, st: ProbeSwarmState): void {
    const home = st.home;
    if (home === null) return;
    for (const e of normalEmpires(galaxy)) {
        if (knowledgeLevel(st, e) >= KNOWLEDGE_CONFIRMED) continue;
        const status = e.systemVisibility[home.systemIndex]?.status;
        if (status === SystemVisibilityStatus.Explored || status === SystemVisibilityStatus.Visible) {
            revealTo(galaxy, st, e, KNOWLEDGE_CONFIRMED);
            if (isHumanEmpire(galaxy, e)) scenarioMessage(galaxy, e, scenarioText(`${TAG} Found Title`), scenarioText(`${TAG} Found`, home.name), { type: EmpireMessageType.GeneralWarning, subject: st.mothercore ?? home, popup: false });
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Periodic driver
// ---------------------------------------------------------------------------------------------------------------

export function probeSwarmPeriodic(galaxy: Galaxy): void {
    if (!threatExists(galaxy, PROBE_SWARM_KEY)) return; // §0 rarity: not this game — no state, no draws.
    const st = probeSwarmState(galaxy);
    if (st.phase === 'ended') return;
    if (st.phase === 'waiting') {
        if (yearsIn(galaxy) < P.year(galaxy) || !pastThreatMinYear(galaxy, PROBE_SWARM_KEY)) return;
        const home = probeSwarmHomeSite(galaxy);
        if (home === null || !probeSwarmWake(galaxy, st, home)) st.phase = 'ended';
        return;
    }
    const faction = st.faction;
    if (faction === null || !faction.active) {
        st.phase = 'ended';
        return;
    }
    st.stations = st.stations.filter((b) => alive(b, faction));
    st.ships = st.ships.filter((b) => alive(b, faction));
    if (st.mothercore !== null && !alive(st.mothercore, faction)) mothercoreLost(galaxy, st, null);
    const now = galaxyStarDate(galaxy);
    const days = (now - st.lastBudgetDate) / GAME_DAY_LENGTH;
    st.lastBudgetDate = now;
    if (!st.mothercoreDestroyed) st.budget = Math.min(2 * P.cap(galaxy), st.budget + (probeSwarmIncome(galaxy, st) * days) / 360);
    spend(galaxy, st);
    defend(galaxy, st);
    checkDiscovery(galaxy, st);
    const y = yearsIn(galaxy);
    if (st.history.length === 0 || st.history[st.history.length - 1].year < y) st.history.push({ year: y, stations: st.stations.length, ships: st.ships.length, budget: Math.round(st.budget) });
}

function mothercoreLost(galaxy: Galaxy, st: ProbeSwarmState, killer: Empire | null): void {
    if (st.mothercoreDestroyed) return;
    const mc = st.mothercore;
    st.mothercoreDestroyed = true;
    st.mothercoreKiller = killer;
    st.mothercoreDate = galaxyStarDate(galaxy);
    st.mothercore = null;
    if (killer !== null && killer.active && killer !== galaxy.independentEmpire && killer.pirateEmpireBaseHabitat === null) {
        const pts = grantResearchPoints(galaxy, killer, P.salvage(galaxy));
        if (isHumanEmpire(galaxy, killer)) scenarioMessage(galaxy, killer, scenarioText(`${TAG} Salvage Title`), scenarioText(`${TAG} Salvage`, Math.round(pts).toLocaleString('en-US')), { type: EmpireMessageType.GeneralGoodEvent, popup: false });
        grantArchiveCore(galaxy, killer, 'mothercore', mc?.name ?? scenarioText(`${TAG} Mothercore Name`));
    }
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Mothercore', textTag: `${TAG} Mothercore News`, args: [killer?.name ?? ''] });
}

function onKilledBy(galaxy: Galaxy, bo: BuiltObject, destroyer: Empire | null): void {
    const st = peekProbeSwarmState(galaxy);
    if (st === null || st.faction === null) return;
    if (bo.actualEmpire === st.faction) st.losses++;
    else if (destroyer === st.faction) st.kills++;
    if (bo === st.mothercore) mothercoreLost(galaxy, st, destroyer);
}

// ---------------------------------------------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------------------------------------------

export function probeSwarmKnownSites(galaxy: Galaxy, empire: Empire): KnownThreatSite[] {
    const st = peekProbeSwarmState(galaxy);
    if (st === null || st.phase !== 'active' || st.mothercore === null) return [];
    const level = knowledgeLevel(st, empire);
    if (level <= 0) return [];
    return [{ threat: PROBE_SWARM_KEY, kind: 'ship', target: st.mothercore, level, label: scenarioText(`${TAG} Site Row`) }];
}

// ---------------------------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------------------------

function isSwarm(galaxy: Galaxy, e: Empire | null): boolean {
    const st = peekProbeSwarmState(galaxy);
    return st !== null && e !== null && st.faction === e;
}

export const PROBE_SWARM_HANDLER_IDS = ['probeSwarm.periodic', 'probeSwarm.killedBy'] as const;

export function registerProbeSwarm(): void {
    registerThreatExistence(PROBE_SWARM_KEY, PROBE_SWARM_FLAG);
    registerScenarioPeriodic({ id: 'probeSwarm.periodic', flag: PROBE_SWARM_FLAG, periodDays: PERIOD_DAYS, order: 14, run: (g) => probeSwarmPeriodic(g) });
    registerScenarioEvent({ id: 'probeSwarm.killedBy', flag: PROBE_SWARM_FLAG, event: 'builtObjectKilledBy', run: (g, e) => onKilledBy(g, e.builtObject, e.destroyer) });
    registerScenarioQuery({ id: 'probeSwarm.passive', flag: PROBE_SWARM_FLAG, query: 'pirateFactionPassive', run: (g, v, a) => v || isSwarm(g, a.empire) });
    registerScenarioQuery({ id: 'probeSwarm.noProtection', flag: PROBE_SWARM_FLAG, query: 'pirateProtectionDesired', run: (g, v, a) => v && !isSwarm(g, a.pirate) });
    registerThreatKnownSites(PROBE_SWARM_KEY, probeSwarmKnownSites);
}

registerProbeSwarm();
