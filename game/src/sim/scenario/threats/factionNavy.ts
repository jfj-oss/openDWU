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
import type { Race } from '../../data/races';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { ResourceGroup } from '../../resourceSystem';
import { calculateCurrentCompleteResourceValue, checkWhetherHabitatIsDangerous, determineMiningStationAtHabitat } from '../../resourceTargets';
import { galaxyStarDate } from '../../tick/simTime';
import { generateNewBuiltObject } from '../../empireEvents';
import { createNewDesigns, generateDesignFromSpec } from '../../designGeneration';
import { galaxyDesignSpecificationBySubRole } from '../../gameStartTail';
import { takeOwnershipOfBuiltObject } from '../../combat/ownership';
import { FleetPosture, calculateOverallStrengthFactorWithoutShields, militaryPotency } from '../../diplomacyTick';
import { createMiningStation, designsFindNewestCanBuild, habitatResourcesContainsGroup, placeSpacePortAtColony } from '../../stationPlacement';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../../missions/mission';
import { Troop, TroopList } from '../../cargo';
import { ShipGroup, empireShipGroups as shipGroupsOfEmpire } from '../../fleets/shipGroup';
import { shipGroupAssignMission, shipGroupCompleteMissionWith } from '../../fleets/shipGroupTasks';
import { troopEmpire } from '../../combat/invasion';
import { scenarioParam } from '../state';
import { empireTechLevel, formBeaconFleets, maxDesignTechLevel, raiseFactionTech } from './robotMutiny';
import { makeFactionTroop, threatEmpires } from './framework';

export type NavyPrefix = 'cult' | 'hive' | 'genShips';

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
    /** Garrison troops added over the run (top-ups), fleet orders given (defend / back on the offensive). */
    garrisonAdded?: number;
    defendOrders?: number;
    attackFlips?: number;
    /** Colonies that have had their first (full) garrison; later top-ups are the gradual monthly recovery. */
    garrisoned?: Habitat[];
    /** Colonies whose recovery was held back by an invasion (troops landed / transports bound for it), counted per monthly check. */
    garrisonHeld?: number;
    /** Warships bought by the monthly pump (also the cursor through the design cycle). */
    shipsPumped?: number;
    pumpBought?: number;
    /** Warships bought but not yet spawned: held back while every home is threatened, released together as one fleet (saved). */
    pumpBank?: number;
    /** The Cult's "secure home" opening phase (cult.ts): start / first-clear dates (star date; -1 none), set when it ended and why. Saved. */
    secure?: { start: number; clearSince: number; ended?: number; reason?: 'clear' | 'timeout' };
    /** Mean strength of the ships the pump last spawned (estimates a batch before it is bought). */
    pumpShipStrength?: number;
    /** Debug counters: months a purchase was banked, banked batches released. */
    pumpBanked?: number;
    pumpReleased?: number;
    /** Mining / gas stations the faction founded itself. */
    stationsFounded?: number;
    /** Debug counters of the station founder: months with no target, with no design, with no money. */
    founderNoTarget?: number;
    founderNoMoney?: number;
    founderFailed?: number;
}

export function newNavyState(): NavyState {
    return { pendingStrength: 0, lastWealth: -1, portColonies: [], techYear: -1, shipsSpawned: 0, stationsTaken: 0 };
}

const P = {
    stateMoney: (g: Galaxy, k: NavyPrefix) => scenarioParam(g, `${k}StateMoney`, 1000000),
    privateMoney: (g: Galaxy, k: NavyPrefix) => scenarioParam(g, `${k}PrivateMoney`, 10000000),
    incomeFloor: (g: Galaxy, k: NavyPrefix) => scenarioParam(g, `${k}IncomeFloor`, 50000),
    navyPct: (g: Galaxy, k: NavyPrefix) => scenarioParam(g, `${k}NavyPct`, k === 'cult' ? 50 : 100),
    smallPorts: (g: Galaxy, k: NavyPrefix) => Math.max(0, Math.trunc(scenarioParam(g, `${k}SmallPorts`, 3))),
    constructionShips: (g: Galaxy, k: NavyPrefix) => Math.max(0, Math.trunc(scenarioParam(g, `${k}ConstructionShips`, 2))),
    /** Ground defence strength (troops' total defend strength, the Ground Report measure: natural strength x 100 readiness) kept at every held colony. */
    garrison: (g: Galaxy, k: NavyPrefix) => Math.max(0, scenarioParam(g, `${k}Garrison`, 2000000)),
    /** Years an empty garrison takes to refill to the target (none while the colony is being invaded). */
    garrisonRefillYears: (g: Galaxy, k: NavyPrefix) => Math.max(0.1, scenarioParam(g, `${k}GarrisonRefillYears`, 2)),
    /** Distance (game units) within which an enemy warship / loaded troop ship counts as attacking a held world. */
    defendRadius: (g: Galaxy, k: NavyPrefix) => Math.max(0, scenarioParam(g, `${k}DefendRadius`, 4000)),
    /** Warships the monthly pump may buy per month. */
    pumpPerMonth: (g: Galaxy, k: NavyPrefix) => Math.max(0, Math.trunc(scenarioParam(g, `${k}PumpPerMonth`, 3))),
    /** The pump rebuilds the navy while its militaryPotency is below this % of the normal empires' average. */
    pumpPct: (g: Galaxy, k: NavyPrefix) => Math.max(0, scenarioParam(g, `${k}PumpPct`, k === 'cult' ? 50 : 100)),
    /** Most warships the pump keeps alive: a fixed number when set (> 0); by default it scales with the galaxy (pumpCapPct, pumpMinShips). */
    pumpMaxShips: (g: Galaxy, k: NavyPrefix) => Math.max(0, Math.trunc(scenarioParam(g, `${k}PumpMaxShips`, 0))),
    /** Default cap: this % of the largest normal empire's warship count (user 2026-10-16: scale it with the galaxy). */
    pumpCapPct: (g: Galaxy, k: NavyPrefix) => Math.max(0, scenarioParam(g, `${k}PumpCapPct`, 100)),
    /** ... but never below this many warships. */
    pumpMinShips: (g: Galaxy, k: NavyPrefix) => Math.max(0, Math.trunc(scenarioParam(g, `${k}PumpMinShips`, 30))),
    /** Home threat radius = defendRadius x this. */
    pumpThreatRadiusMult: (g: Galaxy, k: NavyPrefix) => Math.max(0, scenarioParam(g, `${k}PumpThreatRadiusMult`, 3)),
    /** A home is threatened when enemy warship strength within the radius exceeds this % of (batch + local friendly strength). */
    pumpThreatPct: (g: Galaxy, k: NavyPrefix) => Math.max(0, scenarioParam(g, `${k}PumpThreatPct`, 100)),
    /** Banked purchases are released at the least-threatened home once the bank reaches this size. */
    pumpBankMax: (g: Galaxy, k: NavyPrefix) => Math.max(1, Math.trunc(scenarioParam(g, `${k}PumpBankMax`, 10))),
    /** Mining / gas stations the faction founds itself per month at its best free resource bodies (0: none). */
    stationsPerMonth: (g: Galaxy, k: NavyPrefix) => Math.max(0, Math.trunc(scenarioParam(g, `${k}StationsPerMonth`, 1))),
    /** Most mining / gas stations it holds before it stops founding more. */
    stationMax: (g: Galaxy, k: NavyPrefix) => Math.max(0, Math.trunc(scenarioParam(g, `${k}StationMax`, 20))),
    stationCount: (g: Galaxy, k: NavyPrefix) => Math.max(0, Math.trunc(scenarioParam(g, `${k}StationCount`, 3))),
    /** The most warships the faction is handed when it wipes out an empire (stock: all of them; the strongest are kept, the rest scuttled). */
    capturedFleetMax: (g: Galaxy, k: NavyPrefix) => Math.max(0, Math.trunc(scenarioParam(g, `${k}CapturedFleetMax`, 10))),
};

/** Most ships one rising may spawn (a safety cap). */
const MAX_START_SHIPS = 150;

/** The faction's cap on the warships it takes from an empire it wipes out (events.ts conquestWarshipLimit). */
export function capturedFleetLimit(galaxy: Galaxy, k: NavyPrefix, conqueror: Empire, faction: Empire | null, value: number): number {
    return faction !== null && conqueror === faction ? Math.min(value, P.capturedFleetMax(galaxy, k)) : value;
}

// ---------------------------------------------------------------------------------------------------------------
// Tech
// ---------------------------------------------------------------------------------------------------------------

/** The galaxy's average empireTechLevel over the normal empires (excluding `faction`), floored, at least 1, within the generator's range. */
export function averageTechLevel(galaxy: Galaxy, faction: Empire): number {
    const normals = threatEmpires(galaxy, faction);
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
    const normals = threatEmpires(galaxy, faction);
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
// The monthly pump: warships bought outright (the stock AI builds almost none for a threat faction)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Buys up to `maxNew` warships, each paid from the faction's state money at its design's price and spawned at a port world
 * (`homes`, in turn), no upkeep, auto-controlled. `cycle` is the design sub-roles in order, `cursor` where to start in it;
 * `more` is asked before each purchase with the ships bought so far. Stops when the money runs out. Draws Rnd (stock ship
 * generation) only when it builds. Returns the ships (not yet in fleets) and the next cursor. Shared by Generation Ships.
 */
export function purchaseWarships(galaxy: Galaxy, faction: Empire, homes: readonly Habitat[], cycle: readonly BuiltObjectSubRole[], cursor: number, maxNew: number, more: (bought: readonly BuiltObject[]) => boolean): { ships: BuiltObject[]; homeOf: Habitat[]; cursor: number } {
    const ships: BuiltObject[] = [];
    const homeOf: Habitat[] = [];
    if (homes.length === 0) return { ships, homeOf, cursor };
    for (let i = 0; i < maxNew && more(ships); i++) {
        const design = designsFindNewestCanBuild(faction.designs, cycle[cursor % cycle.length]);
        if (design === null) {
            cursor++;
            continue;
        }
        const price = design.calculateCurrentPurchasePrice(galaxy);
        if (!(price >= 0) || faction.stateMoney < price) break;
        faction.stateMoney -= price;
        const home = homes[ships.length % homes.length];
        const pt = galaxy.selectRelativeParkingPoint();
        const bo = generateNewBuiltObject(galaxy, faction, design, null, home.xpos + pt.x, home.ypos + pt.y);
        takeOwnershipOfBuiltObject(galaxy, faction, bo, faction, false);
        bo.supportCostFactor = 0;
        bo.isAutoControlled = true;
        ships.push(bo);
        homeOf.push(home);
        cursor++;
    }
    return { ships, homeOf, cursor };
}

/** The pump's warship cap: <prefix>PumpMaxShips when set, else <prefix>PumpCapPct % of the largest normal empire's live warships, at least <prefix>PumpMinShips. Pure. */
export function pumpShipCap(galaxy: Galaxy, k: NavyPrefix, faction: Empire): number {
    const fixed = P.pumpMaxShips(galaxy, k);
    if (fixed > 0) return fixed;
    let largest = 0;
    for (const e of threatEmpires(galaxy, faction)) {
        let n = 0;
        for (const b of e.builtObjects) if (!b.hasBeenDestroyed && b.role === BuiltObjectRole.Military) n++;
        if (n > largest) largest = n;
    }
    return Math.max(P.pumpMinShips(galaxy, k), Math.round((largest * P.pumpCapPct(galaxy, k)) / 100));
}

const PUMP_CYCLE: readonly BuiltObjectSubRole[] = [BuiltObjectSubRole.Cruiser, BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.CapitalShip, BuiltObjectSubRole.Cruiser, BuiltObjectSubRole.Frigate, BuiltObjectSubRole.Destroyer];

/**
 * The navy's floor: each month, while the faction's militaryPotency is below <prefix>PumpPct % of the normal empires' average and
 * it has fewer than pumpShipCap warships, up to <prefix>PumpPerMonth warships of its current designs appear at its port
 * worlds (paid from state money, no upkeep), formed into fleets there (the fleet handler directs them). Returns the number bought.
 */
export function pumpNavy(galaxy: Galaxy, k: NavyPrefix, faction: Empire, navy: NavyState): number {
    const perMonth = P.pumpPerMonth(galaxy, k);
    if (perMonth <= 0 || navy.pendingStrength > 0) return 0;
    const homes: Habitat[] = [];
    for (const port of faction.spacePorts) {
        const h = port.parentHabitat;
        if (!port.hasBeenDestroyed && h !== null && !h.hasBeenDestroyed && h.empire === faction && !homes.includes(h)) homes.push(h);
    }
    if (homes.length === 0) {
        const biggest = biggestColony(faction);
        if (biggest === null) return 0;
        homes.push(biggest);
    }
    const target = (averageMilitary(galaxy, faction) * P.pumpPct(galaxy, k)) / 100;
    let strength = militaryPotency(faction);
    let live = 0;
    for (const b of faction.builtObjects) if (!b.hasBeenDestroyed && b.role === BuiltObjectRole.Military) live++;
    const cap = pumpShipCap(galaxy, k, faction);
    const cycle = PUMP_CYCLE.filter((sub) => designsFindNewestCanBuild(faction.designs, sub) !== null); // a missing design would use up a purchase
    if (cycle.length === 0) return 0;
    const bank = Math.max(0, navy.pumpBank ?? 0);
    // Estimated strength of one pumped ship (last batch; else the live fleet's mean).
    if (live > 0 && strength > 0) navy.pumpShipStrength = strength / live;
    const per = navy.pumpShipStrength ?? 0;
    // New purchases this month, within the same limits as buying (cap, strength target), the bank counted as already bought.
    let n = 0;
    while (n < perMonth && live + bank + n < cap && strength + (bank + n) * per < target) n++;
    if (bank + n === 0) return 0;
    // Rank the homes by enemy warship strength nearby (safest first, ties by population).
    const radius = P.defendRadius(galaxy, k) * P.pumpThreatRadiusMult(galaxy, k);
    const threat = new Map<Habitat, number>();
    for (const h of homes) threat.set(h, nearbyWarStrength(galaxy, h, radius, faction, false));
    homes.sort((a, b) => threat.get(a)! - threat.get(b)! || b.population.totalAmount - a.population.totalAmount);
    const best = homes[0];
    const batchStrength = (bank + n) * per + nearbyWarStrength(galaxy, best, P.defendRadius(galaxy, k), faction, true);
    const threatened = threat.get(best)! > (batchStrength * P.pumpThreatPct(galaxy, k)) / 100;
    if (threatened && bank + n < P.pumpBankMax(galaxy, k)) {
        navy.pumpBank = bank + n;
        if (n > 0) navy.pumpBanked = (navy.pumpBanked ?? 0) + 1;
        return 0;
    }
    let counted = 0;
    const res = purchaseWarships(galaxy, faction, [best], cycle, navy.shipsPumped ?? 0, bank + n, (bought) => {
        for (; counted < bought.length; counted++) strength += Math.max(0, calculateOverallStrengthFactorWithoutShields(bought[counted]));
        return live + bought.length < cap && strength < target;
    });
    navy.shipsPumped = res.cursor;
    // Left over only when stopped by money / designs (still wanted); a cap or target stop drops the rest.
    const wantedMore = live + res.ships.length < cap && strength < target;
    navy.pumpBank = wantedMore ? Math.max(0, bank + n - res.ships.length) : 0;
    if (bank > 0 && res.ships.length > 0) navy.pumpReleased = (navy.pumpReleased ?? 0) + 1;
    if (res.ships.length > 0) {
        let sum = 0;
        for (const b of res.ships) sum += Math.max(0, calculateOverallStrengthFactorWithoutShields(b));
        navy.pumpShipStrength = sum / res.ships.length;
        formBeaconFleets(galaxy, faction, best, res.ships, FleetPosture.Defend);
    }
    navy.pumpBought = (navy.pumpBought ?? 0) + res.ships.length;
    return res.ships.length;
}

/** Summed warship strength (no shields) within `radius` of `home`: the faction's own (friendly) or every other active empire's. */
function nearbyWarStrength(galaxy: Galaxy, home: Habitat, radius: number, faction: Empire, friendly: boolean): number {
    let sum = 0;
    const scan = (e: Empire): void => {
        for (const b of e.builtObjects) {
            if (b.hasBeenDestroyed || b.role !== BuiltObjectRole.Military) continue;
            if (galaxy.calculateDistance(b.xpos, b.ypos, home.xpos, home.ypos) <= radius) sum += Math.max(0, calculateOverallStrengthFactorWithoutShields(b));
        }
    };
    if (friendly) scan(faction);
    else for (const e of galaxy.empires) if (e !== faction && e.active && e !== galaxy.independentEmpire) scan(e);
    return sum;
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
    // A port the war destroyed is not replaced by the stock AI (a besieged world is "unsafe to build at"), and without a yard the
    // navy cannot be rebuilt or repaired: its colony goes back on the list.
    navy.portColonies = navy.portColonies.filter((c) => !c.hasBeenDestroyed && c.empire === faction && faction.spacePorts.some((b) => !b.hasBeenDestroyed && b.parentHabitat === c));
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

/** Free mineral / gas bodies the faction could mine, nearest to any of its colonies first (the stock rules for what is worth mining and safe). */
function stationCandidates(galaxy: Galaxy, faction: Empire): Habitat[] {
    const colonies = faction.colonies.filter((c) => !c.hasBeenDestroyed);
    if (colonies.length === 0) return [];
    const scored: { h: Habitat; d: number }[] = [];
    for (const h of galaxy.habitats) {
        if (h === null || h.hasBeenDestroyed || h.empire !== null || h.resources.length === 0) continue;
        let d = Infinity;
        for (const c of colonies) d = Math.min(d, galaxy.calculateDistance(h.xpos, h.ypos, c.xpos, c.ypos));
        scored.push({ h, d });
    }
    scored.sort((a, b) => a.d - b.d || galaxy.habitats.indexOf(a.h) - galaxy.habitats.indexOf(b.h));
    return scored.map((x) => x.h);
}

/**
 * The stock AI builds the faction's mining stations only with its construction ships, which the wars soon lose, and its own
 * target list is empty (a world inside another empire's territory may not build there, and these factions start inside one). So
 * the faction also founds them itself: each month up to <prefix>StationsPerMonth stations at the free resource bodies nearest its
 * colonies worth mining (the stock value threshold, not dangerous), by the stock createMiningStation (territory ignored), paid
 * from state money, no upkeep, until it holds <prefix>StationMax. Draws Rnd (stock station placement) only when it founds one.
 * Returns the number founded.
 */
export function foundMiningStations(galaxy: Galaxy, k: NavyPrefix, faction: Empire, navy: NavyState): number {
    const per = P.stationsPerMonth(galaxy, k);
    if (per <= 0) return 0;
    let live = faction.miningStations.filter((b) => !b.hasBeenDestroyed).length;
    const max = P.stationMax(galaxy, k);
    if (live >= max) return 0;
    let founded = 0;
    let tried = 0;
    for (const habitat of stationCandidates(galaxy, faction)) {
        if (founded >= per || live >= max || tried >= 60) break;
        if (determineMiningStationAtHabitat(habitat) !== null) continue;
        const mineral = habitatResourcesContainsGroup(galaxy, habitat, ResourceGroup.Mineral);
        const gas = habitatResourcesContainsGroup(galaxy, habitat, ResourceGroup.Gas);
        if (!mineral && !gas) continue;
        tried++;
        if (calculateCurrentCompleteResourceValue(galaxy, habitat) < MIN_STATION_VALUE || checkWhetherHabitatIsDangerous(galaxy, faction, habitat)) continue;
        const design = designsFindNewestCanBuild(faction.designs, mineral ? BuiltObjectSubRole.MiningStation : BuiltObjectSubRole.GasMiningStation);
        if (design === null) continue;
        const price = design.calculateCurrentPurchasePrice(galaxy);
        if (faction.stateMoney < price) {
            navy.founderNoMoney = (navy.founderNoMoney ?? 0) + 1;
            break;
        }
        const before = faction.miningStations.length;
        if (!createMiningStation(galaxy, habitat, faction, true, true)) {
            navy.founderFailed = (navy.founderFailed ?? 0) + 1;
            continue;
        }
        faction.stateMoney -= price;
        for (const b of faction.miningStations.slice(before)) b.supportCostFactor = 0;
        navy.stationsFounded = (navy.stationsFounded ?? 0) + 1;
        founded++;
        live++;
    }
    if (founded === 0) navy.founderNoTarget = (navy.founderNoTarget ?? 0) + 1;
    return founded;
}

/** The stock "worth a station" resource value (civilianAI MINING_STATION_RESOURCE_THRESHHOLD). */
const MIN_STATION_VALUE = 10;

// ---------------------------------------------------------------------------------------------------------------
// Garrisons (monthly top-up, free upkeep) and the strength of a troop force
// ---------------------------------------------------------------------------------------------------------------

/** Troop readiness is a percentage and strengths are multiplied by it, so the game's "strength" of a force is natural x 100. */
const READINESS = 100;
/** A troop's strengths are shorts. */
const MAX_NATURAL = 30000;

/** A troop whose total strength (the stock measure) is `strength`, attack and defence alike; bonus factors are not applied. */
export function makeTroopOfStrength(galaxy: Galaxy, faction: Empire, strength: number, name: string, race: Race | null): Troop {
    const natural = Math.max(1, Math.min(MAX_NATURAL, Math.round(strength / READINESS)));
    const troop = makeFactionTroop(galaxy, faction, natural, name, race);
    troop.setAttackStrength(natural);
    troop.setDefendStrength(natural);
    return troop;
}

/** Troops of the given total strength, in as few troops as the short range allows. */
export function makeTroopsOfStrength(galaxy: Galaxy, faction: Empire, strength: number, name: string, race: Race | null): Troop[] {
    const out: Troop[] = [];
    let left = strength;
    for (let i = 0; i < 100 && left >= READINESS; i++) {
        const part = Math.min(left, MAX_NATURAL * READINESS);
        out.push(makeTroopOfStrength(galaxy, faction, part, name, race));
        left -= part;
    }
    return out;
}

/**
 * `count` regiments sharing `strength` equally (each at most the short range allows): the ground war's attrition is in readiness
 * points taken from ONE random regiment per tick, whatever its strength, so a force's staying power is its number of regiments,
 * not its total strength (one huge regiment dies in a few ticks, the Beacon's first landings). The Beacon sizes its landings with this.
 */
export function makeTroopsSplit(galaxy: Galaxy, faction: Empire, strength: number, count: number, name: string, race: Race | null): Troop[] {
    const n = Math.max(1, Math.min(200, Math.trunc(count)));
    const each = Math.max(READINESS, Math.min(MAX_NATURAL * READINESS, strength / n));
    const out: Troop[] = [];
    for (let i = 0; i < n; i++) out.push(makeTroopOfStrength(galaxy, faction, each, name, race));
    return out;
}

/** Enemy troops are on the ground at `colony`, or a loaded enemy troop ship is bound for it within reach (an invasion under way). */
export function colonyBeingInvaded(galaxy: Galaxy, k: NavyPrefix, faction: Empire, colony: Habitat): boolean {
    const inv = colony.invadingTroops;
    if (inv !== null && inv.items.some((t) => troopEmpire(t) !== faction)) return true;
    const r = 2 * P.defendRadius(galaxy, k);
    for (const e of galaxy.empires) {
        if (e === faction || !e.active || e === galaxy.independentEmpire) continue;
        for (const bo of e.builtObjects) {
            if (bo.hasBeenDestroyed || bo.troops === null || bo.troops.count <= 0) continue;
            const m = builtObjectMission(bo.mission);
            if (m !== null && m.targetHabitat === colony && galaxy.calculateDistance(bo.xpos, bo.ypos, colony.xpos, colony.ypos) <= r) return true;
        }
    }
    return false;
}

/**
 * Garrisons, monthly. A colony new to the faction starts at the full <prefix>Garrison total defence strength; after that it
 * recovers target / (12 x <prefix>GarrisonRefillYears) per month (an empty one is full in that many years) up to it (free upkeep), and not at all while it is being
 * invaded (enemy troops landed, or loaded transports bound for it). Returns the number of colonies that gained troops. With `only`: just that colony, and only its first fill.
 */
export function topUpGarrisons(galaxy: Galaxy, k: NavyPrefix, faction: Empire, navy: NavyState, name: string, only: Habitat | null = null): number {
    const target = P.garrison(galaxy, k);
    if (!(target > 0)) return 0;
    const step = target / (12 * P.garrisonRefillYears(galaxy, k));
    navy.garrisoned ??= [];
    let n = 0;
    for (const h of faction.colonies) {
        if (h.hasBeenDestroyed || (only !== null && (h !== only || navy.garrisoned.includes(h)))) continue;
        h.troops ??= new TroopList();
        let goal = target;
        if (navy.garrisoned.includes(h)) {
            if (colonyBeingInvaded(galaxy, k, faction, h)) {
                navy.garrisonHeld = (navy.garrisonHeld ?? 0) + 1;
                continue;
            }
            goal = Math.min(target, h.troops.totalDefendStrength + step);
        }
        const deficit = goal - h.troops.totalDefendStrength;
        if (!navy.garrisoned.includes(h)) navy.garrisoned.push(h);
        if (!(deficit >= READINESS)) continue;
        const race = (h.population?.dominantRace ?? faction.dominantRace ?? null) as Race | null;
        for (const t of makeTroopsOfStrength(galaxy, faction, deficit, name, race)) {
            t.colony = h;
            h.troops.add(t);
            navy.garrisonAdded = (navy.garrisonAdded ?? 0) + 1;
        }
        n++;
    }
    return n;
}

// ---------------------------------------------------------------------------------------------------------------
// Fleets: defend a world under attack, attack when none is
// ---------------------------------------------------------------------------------------------------------------

/**
 * The faction's colonies under attack, with how many attackers each has: enemy troops landed (invadingTroops of another
 * empire), enemy warships within <prefix>DefendRadius, or loaded enemy troop ships within twice that (or bound for it).
 */
export function coloniesUnderAttack(galaxy: Galaxy, k: NavyPrefix, faction: Empire): Map<Habitat, number> {
    const out = new Map<Habitat, number>();
    const colonies = faction.colonies.filter((c) => !c.hasBeenDestroyed);
    if (colonies.length === 0) return out;
    const r = P.defendRadius(galaxy, k);
    for (const c of colonies) {
        const inv = c.invadingTroops;
        if (inv !== null && inv.items.some((t) => troopEmpire(t) !== faction)) out.set(c, (out.get(c) ?? 0) + 1000);
    }
    for (const e of galaxy.empires) {
        if (e === faction || !e.active || e === galaxy.independentEmpire) continue;
        for (const bo of e.builtObjects) {
            if (bo.hasBeenDestroyed) continue;
            const loaded = bo.troops !== null && bo.troops.count > 0;
            const armed = bo.role === BuiltObjectRole.Military;
            if (!loaded && !armed) continue;
            const m = loaded ? builtObjectMission(bo.mission) : null;
            for (const c of colonies) {
                const d = galaxy.calculateDistance(bo.xpos, bo.ypos, c.xpos, c.ypos);
                if ((armed && d <= r) || (loaded && (d <= 2 * r || (m !== null && m.targetHabitat === c && d <= 6 * r)))) out.set(c, (out.get(c) ?? 0) + 1);
            }
        }
    }
    return out;
}

/** The faction's fleets that have ships. */
function factionFleets(faction: Empire): ShipGroup[] {
    const out: ShipGroup[] = [];
    for (const g of shipGroupsOfEmpire(faction)) if (g !== null && g.leadShip !== null && g.ships.length > 0) out.push(g);
    return out;
}

/** A fleet's standing order from this module: a High-priority Move to one of the faction's own colonies. */
function isDefendOrder(fleet: ShipGroup, faction: Empire): boolean {
    const m = fleet.mission;
    return m !== null && m.type === BuiltObjectMissionType.Move && m.priority === BuiltObjectMissionPriority.High && m.targetHabitat !== null && m.targetHabitat.empire === faction;
}

/** Warships left without a fleet (the stock AI does not regroup them) form new fleets at the faction's nearest world. */
function regroupStragglers(galaxy: Galaxy, faction: Empire): void {
    const colonies = faction.colonies.filter((c) => !c.hasBeenDestroyed);
    if (colonies.length === 0) return;
    const byHome = new Map<Habitat, BuiltObject[]>();
    for (const b of faction.builtObjects) {
        if (b.hasBeenDestroyed || b.role !== BuiltObjectRole.Military || b.shipGroup !== null || !b.isAutoControlled) continue;
        let home = colonies[0];
        let best = Infinity;
        for (const c of colonies) {
            const d = galaxy.calculateDistance(b.xpos, b.ypos, c.xpos, c.ypos);
            if (d < best) {
                best = d;
                home = c;
            }
        }
        const list = byHome.get(home) ?? [];
        list.push(b);
        byHome.set(home, list);
    }
    for (const [home, ships] of byHome) formBeaconFleets(galaxy, faction, home, ships, FleetPosture.Attack);
}

export interface FleetDirection {
    threatened: number;
    defending: number;
    attacking: number;
}

/**
 * Under attack: every fleet goes to the nearest threatened world (posture Defend, gather point = that world, High-priority
 * Move). Nothing under attack: fleets still on a defend order are released and put on posture Attack, and the stock military
 * AI (identifyMilitaryObjectives / taskShipGroups, every tick) sends them at the enemy's nearby targets.
 */
export function directFleets(galaxy: Galaxy, k: NavyPrefix, faction: Empire, navy: NavyState, hold = false): FleetDirection {
    regroupStragglers(galaxy, faction);
    const threats = coloniesUnderAttack(galaxy, k, faction);
    const fleets = factionFleets(faction);
    const res: FleetDirection = { threatened: threats.size, defending: 0, attacking: 0 };
    if (threats.size === 0 && hold) {
        // Securing home: fleets stay on defend posture at their nearest own world (no offensive).
        const homes = faction.colonies.filter((c) => !c.hasBeenDestroyed);
        for (const f of fleets) {
            let home: Habitat | null = null;
            let bd = Infinity;
            for (const c of homes) {
                const d = galaxy.calculateDistance(f.leadShip!.xpos, f.leadShip!.ypos, c.xpos, c.ypos);
                if (d < bd) { bd = d; home = c; }
            }
            if (home === null) continue;
            res.defending++;
            const m = f.mission;
            const already = (m !== null && m.type === BuiltObjectMissionType.Move && m.targetHabitat === home) || bd < 1000;
            if (f.posture === FleetPosture.Defend && f.gatherPoint === home && already) continue;
            f.posture = FleetPosture.Defend;
            f.gatherPoint = home;
            f.postureRangeSquared = 250000000000.0;
            if (!already) shipGroupAssignMission(galaxy, f, BuiltObjectMissionType.Move, home, null, BuiltObjectMissionPriority.High, false);
        }
        return res;
    }
    if (threats.size === 0) {
        for (const f of fleets) {
            if (isDefendOrder(f, faction)) shipGroupCompleteMissionWith(galaxy, f, true);
            if (f.posture !== FleetPosture.Attack) {
                f.posture = FleetPosture.Attack;
                f.postureRangeSquared = Number.MAX_VALUE;
                navy.attackFlips = (navy.attackFlips ?? 0) + 1;
            }
            res.attacking++;
        }
        return res;
    }
    const worlds = [...threats.keys()];
    for (const f of fleets) {
        const lead = f.leadShip!;
        let best: Habitat | null = null;
        let bestScore = Infinity;
        for (const c of worlds) {
            const d = galaxy.calculateDistance(lead.xpos, lead.ypos, c.xpos, c.ypos) / Math.sqrt(1 + (threats.get(c) ?? 0));
            if (d < bestScore) {
                bestScore = d;
                best = c;
            }
        }
        if (best === null) continue;
        res.defending++;
        const m = f.mission;
        const already = m !== null && m.type === BuiltObjectMissionType.Move && m.targetHabitat === best;
        if (f.posture === FleetPosture.Defend && f.gatherPoint === best && already) continue;
        f.posture = FleetPosture.Defend;
        f.gatherPoint = best;
        f.postureRangeSquared = 250000000000.0;
        if (!already) shipGroupAssignMission(galaxy, f, BuiltObjectMissionType.Move, best, null, BuiltObjectMissionPriority.High, false);
        navy.defendOrders = (navy.defendOrders ?? 0) + 1;
    }
    return res;
}
