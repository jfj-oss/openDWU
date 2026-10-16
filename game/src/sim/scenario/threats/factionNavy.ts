// The Cult's and the Hive's economy and navy (Galactic Threats add-on; not a port). Shared by cult.ts and hive.ts, which
// call it from their own flag-gated handlers, so with both flags off nothing here runs and nothing draws.
//
// A threat faction is created by createThreatFaction as an adopt-only empire: no ships, no capital, 30k money and the
// fallback tech level 0.5. This gives it a real footing once it rises:
//   - TECH: its research is raised to the galaxy's average empireTechLevel (never above it) and re-synced yearly, its designs
//     regenerated each time (robotMutiny.ts raiseFactionTech / empireTechLevel, as the Purifier does);
//   - MONEY: <prefix>StateMoney / <prefix>PrivateMoney at the rising, and a monthly income floor <prefix>IncomeFloor (the
//     month's net change below it is topped up) until the faction is gone;
//   - SPACE PORTS (no upkeep): a medium port on the first world, small ports on up to <prefix>SmallPorts others;
//   - STARTING SHIPS: <prefix>NavyPct % of a reference military (the host's / the empires' average militaryPotency), built at
//     the faction's tech, no upkeep, formed into Defend fleets at its first world (the stock fleet AI tasks them);
//   - TROOPS: no upkeep (the troopMaintenanceFactor query answers 0 for the faction);
//   - MINING: the host's mining / gas stations in the colony's system (else the nearest <prefix>StationCount) change hands.
// Rnd (§0.4): ship, port and design generation draw (stock functions); the rest draws nothing.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Design } from '../../design';
import type { BuiltObject } from '../../builtObject';
import type { Habitat } from '../../types';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { galaxyStarDate } from '../../tick/simTime';
import { generateNewBuiltObject } from '../../empireEvents';
import { createNewDesigns, generateDesignFromSpec } from '../../designGeneration';
import { galaxyDesignSpecificationBySubRole } from '../../gameStartTail';
import { takeOwnershipOfBuiltObject } from '../../combat/ownership';
import { FleetPosture, calculateOverallStrengthFactorWithoutShields, militaryPotency } from '../../diplomacyTick';
import { designsFindNewestCanBuild, placeSpacePortAtColony } from '../../stationPlacement';
import { builtObjectMission } from '../../missions/mission';
import { scenarioParam } from '../state';
import { empireTechLevel, formBeaconFleets, maxDesignTechLevel, raiseFactionTech } from './robotMutiny';
import { normalEmpires } from './framework';

export type NavyPrefix = 'cult' | 'hive';

/** Saved per-faction bookkeeping (plain data; lives in the Cult's / Hive's state bag as `navy`). */
export interface NavyState {
    /** Starting-ship strength still to be spawned (0: done / none wanted). Spawned at the first world the faction holds. */
    pendingStrength: number;
    /** Money + private money at the last income-floor check (-1: not taken yet). */
    lastWealth: number;
    /** Colonies given a space port, in order (the first is the medium one). */
    portColonies: Habitat[];
    /** Last game year the tech was synced. */
    techYear: number;
    shipsSpawned: number;
    stationsTaken: number;
}

export function newNavyState(): NavyState {
    return { pendingStrength: 0, lastWealth: -1, portColonies: [], techYear: -1, shipsSpawned: 0, stationsTaken: 0 };
}

const P = {
    stateMoney: (g: Galaxy, k: NavyPrefix) => scenarioParam(g, `${k}StateMoney`, 1000000),
    privateMoney: (g: Galaxy, k: NavyPrefix) => scenarioParam(g, `${k}PrivateMoney`, 10000000),
    incomeFloor: (g: Galaxy, k: NavyPrefix) => scenarioParam(g, `${k}IncomeFloor`, 50000),
    navyPct: (g: Galaxy, k: NavyPrefix) => scenarioParam(g, `${k}NavyPct`, k === 'cult' ? 30 : 100),
    smallPorts: (g: Galaxy, k: NavyPrefix) => Math.max(0, Math.trunc(scenarioParam(g, `${k}SmallPorts`, 3))),
    constructionShips: (g: Galaxy, k: NavyPrefix) => Math.max(0, Math.trunc(scenarioParam(g, `${k}ConstructionShips`, 2))),
    stationCount: (g: Galaxy, k: NavyPrefix) => Math.max(0, Math.trunc(scenarioParam(g, `${k}StationCount`, 3))),
};

/** Most ships one rising may spawn (a safety cap). */
const MAX_START_SHIPS = 150;

// ---------------------------------------------------------------------------------------------------------------
// Tech
// ---------------------------------------------------------------------------------------------------------------

/** The galaxy's average empireTechLevel over the normal empires (excluding `faction`), floored, at least 1, within the generator's range. */
export function averageTechLevel(galaxy: Galaxy, faction: Empire): number {
    const normals = normalEmpires(galaxy, faction);
    if (normals.length === 0) return 1;
    const avg = normals.reduce((s, e) => s + empireTechLevel(e), 0) / normals.length;
    const max = maxDesignTechLevel(galaxy);
    let lvl = Math.max(1, Math.floor(avg));
    if (max > 0) lvl = Math.min(lvl, max);
    return lvl;
}

/** Raises the faction's research to the average (never above) and regenerates its designs when that changed anything. Returns true if raised. */
export function syncFactionTech(galaxy: Galaxy, faction: Empire, force = false): boolean {
    const lvl = averageTechLevel(galaxy, faction);
    if (empireTechLevel(faction) >= lvl && !force) return false;
    raiseFactionTech(galaxy, faction, lvl);
    const now = galaxyStarDate(galaxy);
    createNewDesigns(galaxy, faction, now, now, true);
    return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Rising: money, tech, pending navy
// ---------------------------------------------------------------------------------------------------------------

/** The faction has just been created: tech, money, and the starting-ship strength (spawned once it holds a world). */
export function navyRise(galaxy: Galaxy, k: NavyPrefix, faction: Empire, navy: NavyState, referenceMilitary: number): void {
    syncFactionTech(galaxy, faction, true);
    faction.stateMoney = Math.max(faction.stateMoney, P.stateMoney(galaxy, k));
    faction.privateMoney = Math.max(faction.privateMoney, P.privateMoney(galaxy, k));
    navy.lastWealth = faction.stateMoney + faction.privateMoney;
    navy.pendingStrength = Math.max(0, (referenceMilitary * P.navyPct(galaxy, k)) / 100);
}

/** The average militaryPotency of the normal empires (the Hive's reference). */
export function averageMilitary(galaxy: Galaxy, faction: Empire | null): number {
    const normals = normalEmpires(galaxy, faction);
    return normals.length === 0 ? 0 : normals.reduce((s, e) => s + militaryPotency(e), 0) / normals.length;
}

// ---------------------------------------------------------------------------------------------------------------
// Monthly: income floor, pending ships
// ---------------------------------------------------------------------------------------------------------------

/** The month's net change in money is topped up to the floor. */
export function applyIncomeFloor(galaxy: Galaxy, k: NavyPrefix, faction: Empire, navy: NavyState): void {
    const wealth = faction.stateMoney + faction.privateMoney;
    if (navy.lastWealth >= 0) {
        const income = wealth - navy.lastWealth;
        const floor = P.incomeFloor(galaxy, k);
        if (income < floor) faction.stateMoney += floor - income;
    }
    navy.lastWealth = faction.stateMoney + faction.privateMoney;
}

function biggestColony(faction: Empire): Habitat | null {
    let best: Habitat | null = null;
    for (const c of faction.colonies) {
        if (c.hasBeenDestroyed) continue;
        if (best === null || c.population.totalAmount > best.population.totalAmount) best = c;
    }
    return best;
}

function warDesign(galaxy: Galaxy, faction: Empire, sub: BuiltObjectSubRole, lvl: number): Design | null {
    const found = designsFindNewestCanBuild(faction.designs, sub);
    if (found !== null && !found.isPlanetDestroyer) return found;
    const spec = faction.designSpecifications.find((s) => s !== null && s.subRole === sub) ?? galaxyDesignSpecificationBySubRole(sub);
    if (spec === null || spec === undefined) return null;
    try {
        const d = generateDesignFromSpec(galaxy, faction, spec, lvl, galaxyStarDate(galaxy));
        if (d !== null && !faction.designs.includes(d)) faction.designs.push(d);
        return d;
    } catch {
        return null;
    }
}

/**
 * The stock AI builds mining stations with its own working construction ships (isShipYard). Ships that came with a seized world
 * are often not, so a faction without enough of them gets new ones of its own design at its biggest world.
 */
export function ensureConstructionShips(galaxy: Galaxy, k: NavyPrefix, faction: Empire): number {
    const want = P.constructionShips(galaxy, k);
    if (want <= 0) return 0;
    const home = biggestColony(faction);
    if (home === null) return 0;
    const have = (faction.constructionShips as BuiltObject[]).filter((b) => !b.hasBeenDestroyed && b.isShipYard).length;
    if (have >= want) return 0;
    const design = designsFindNewestCanBuild(faction.designs, BuiltObjectSubRole.ConstructionShip);
    if (design === null) return 0;
    for (let i = have; i < want; i++) {
        const pt = galaxy.selectRelativeParkingPoint();
        const bo = generateNewBuiltObject(galaxy, faction, design, null, home.xpos + pt.x, home.ypos + pt.y);
        takeOwnershipOfBuiltObject(galaxy, faction, bo, faction, false);
        bo.isAutoControlled = true;
    }
    return want - have;
}

/** Most worlds the starting fleet is spread over. */
const MAX_FLEET_WORLDS = 8;

/**
 * Spawns the pending starting ships, spread evenly (by firepower) over the faction's biggest worlds (once it holds one), one
 * Defend fleet at each (the stock fleet AI tasks them). Returns the ships.
 */
export function spawnPendingNavy(galaxy: Galaxy, faction: Empire, navy: NavyState): BuiltObject[] {
    if (!(navy.pendingStrength > 0)) return [];
    const worlds = [...faction.colonies].filter((c) => !c.hasBeenDestroyed).sort((a, b) => b.population.totalAmount - a.population.totalAmount).slice(0, MAX_FLEET_WORLDS);
    if (worlds.length === 0) return [];
    const lvl = empireTechLevel(faction);
    const subs = [BuiltObjectSubRole.Cruiser, BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.CapitalShip, BuiltObjectSubRole.Cruiser, BuiltObjectSubRole.Frigate, BuiltObjectSubRole.Destroyer];
    const designs: Design[] = [];
    for (const sub of subs) {
        const d = warDesign(galaxy, faction, sub, lvl);
        if (d !== null && d.role === BuiltObjectRole.Military) designs.push(d);
    }
    const want = navy.pendingStrength;
    navy.pendingStrength = 0;
    if (designs.length === 0) return [];
    const all: BuiltObject[] = [];
    const perWorld = want / worlds.length;
    const capPerWorld = Math.ceil(MAX_START_SHIPS / worlds.length);
    for (const home of worlds) {
        const ships: BuiltObject[] = [];
        let strength = 0;
        for (let i = 0; i < capPerWorld && strength < perWorld; i++) {
            const pt = galaxy.selectRelativeParkingPoint();
            const bo = generateNewBuiltObject(galaxy, faction, designs[(all.length + i) % designs.length], null, home.xpos + pt.x, home.ypos + pt.y);
            takeOwnershipOfBuiltObject(galaxy, faction, bo, faction, false);
            bo.supportCostFactor = 0;
            bo.isAutoControlled = true;
            ships.push(bo);
            const fp = calculateOverallStrengthFactorWithoutShields(bo);
            if (!(fp > 0)) break;
            strength += fp;
        }
        formBeaconFleets(galaxy, faction, home, ships, FleetPosture.Defend);
        all.push(...ships);
    }
    navy.shipsSpawned += all.length;
    return all;
}

// ---------------------------------------------------------------------------------------------------------------
// Space ports
// ---------------------------------------------------------------------------------------------------------------

/** Port at `colony` if the faction still wants one (the first medium, then up to <prefix>SmallPorts small). Returns the port. */
export function givePortAt(galaxy: Galaxy, k: NavyPrefix, faction: Empire, navy: NavyState, colony: Habitat): BuiltObject | null {
    if (colony.hasBeenDestroyed || colony.empire !== faction || navy.portColonies.includes(colony)) return null;
    // A port that came with the colony counts as its port (and loses its upkeep).
    const existing = faction.spacePorts.find((b) => !b.hasBeenDestroyed && b.parentHabitat === colony);
    if (existing !== undefined) {
        existing.supportCostFactor = 0;
        navy.portColonies.push(colony);
        return existing;
    }
    const first = navy.portColonies.length === 0;
    if (!first && navy.portColonies.length >= 1 + P.smallPorts(galaxy, k)) return null;
    const design = first
        ? (designsFindNewestCanBuild(faction.designs, BuiltObjectSubRole.MediumSpacePort) ?? designsFindNewestCanBuild(faction.designs, BuiltObjectSubRole.SmallSpacePort))
        : designsFindNewestCanBuild(faction.designs, BuiltObjectSubRole.SmallSpacePort);
    if (design === null) return null;
    const port = placeSpacePortAtColony(galaxy, faction, colony, design);
    port.supportCostFactor = 0;
    navy.portColonies.push(colony);
    return port;
}

/** Ports on the faction's biggest worlds that have none yet, up to the wanted number (the Hive's top-up). */
export function topUpPorts(galaxy: Galaxy, k: NavyPrefix, faction: Empire, navy: NavyState): void {
    const max = 1 + P.smallPorts(galaxy, k);
    const order = [...faction.colonies].filter((c) => !c.hasBeenDestroyed).sort((a, b) => b.population.totalAmount - a.population.totalAmount);
    for (const c of order) {
        if (navy.portColonies.length >= max) break;
        givePortAt(galaxy, k, faction, navy, c);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Mining stations
// ---------------------------------------------------------------------------------------------------------------

/**
 * The host's mining / gas stations nearest `colony` change hands to the faction: every one in the colony's system, else the
 * nearest <prefix>StationCount. No upkeep. Returns how many.
 */
export function takeMiningStationsNear(galaxy: Galaxy, k: NavyPrefix, faction: Empire, navy: NavyState, host: Empire, colony: Habitat): number {
    if (host === faction || !host.active) return 0;
    const dist = (b: BuiltObject) => galaxy.calculateDistance(b.xpos, b.ypos, colony.xpos, colony.ypos);
    const stations = host.miningStations.filter((b) => !b.hasBeenDestroyed && b.actualEmpire === host).sort((a, b) => dist(a) - dist(b));
    if (stations.length === 0) return 0;
    const star = galaxy.determineHabitatSystemStar(colony);
    let chosen = stations.filter((b) => b.nearestSystemStar === star);
    if (chosen.length === 0) chosen = stations.slice(0, P.stationCount(galaxy, k));
    for (const bo of chosen) {
        takeOwnershipOfBuiltObject(galaxy, host, bo, faction, false, true);
        bo.supportCostFactor = 0;
    }
    // The host's freighters and miners bound for a station that is now the enemy's drop that mission (flying on into its guns is fatal).
    for (const list of [host.builtObjects, host.privateBuiltObjects]) {
        for (const ship of list) {
            const mission = builtObjectMission(ship.mission);
            if (mission !== null && mission.targetBuiltObject !== null && chosen.includes(mission.targetBuiltObject)) mission.clear();
        }
    }
    navy.stationsTaken += chosen.length;
    return chosen.length;
}
