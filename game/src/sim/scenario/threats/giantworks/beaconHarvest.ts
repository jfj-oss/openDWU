// The Beacon, part 5: the harvest (Giantworks wonder, flag gwBeacon). Not a port: new scenario behaviour composed of ported functions.
//
// The Reclaimers do not drain a world where they took it. Once they hold worlds they designate HARVEST CORES among them (by the
// galaxy's size: 2 below beaconCoresMidStars stars, 3 below beaconCoresBigStars, then rising to beaconCoresMax in the biggest galaxies;
// never more than one per beaconCoreWorldsPer held worlds): the most populous held worlds, spread across their holdings (a candidate's
// pull falls off within beaconCoreSpreadSectors of an existing core). A HARVESTER, a plated machine base, orbits each core and does the work.
//   CATTLE SHIPS: every other held world launches a huge armoured freighter every beaconCattleDays with beaconCattleLoadPct % of the people
//     it had when taken; the people leave the world at the launch and are penned at the nearest core when the ship docks. A cattle ship
//     destroyed kills its captives (they count as eliminated; no reputation is lost for it); one boarded and taken frees them (rescueCattle,
//     the hook for a future shared capture feature) to the taker's nearest worlds.
//   PROCESSING (monthly): once its harvester is built (beaconCoreBuildDays), a core renders beaconCoreProcessPct % of its pens, and its own people over beaconCoreDrainMonths, into BIOFUEL:
//     beaconFuelPerBillionPct % of the reference military in fleet strength per billion people. Processed people are eliminated
//     (the 80 % loss measure). A core whose harvester is destroyed is BROKEN, and one retaken is lost: either way its pens are freed and
//     return as population to the nearest worlds of the liberator (or of the world's owner), and another held world becomes a core (a
//     broken world only after beaconCoreBanDays).
//   BIOFUEL pays for the Reclaimers' TROOPS (Thrall regiments for the landings, carried from the nearest core in interceptable transports,
//     and the garrisons: a monthly pass tops up threatened worlds first, then the cores, then the rest) and, by the funding model
//     (beaconFundingModel), their FLEETS: 0 harvest only (an awakening reserve starts season 1; cut the harvest and they starve), 1 scripted
//     (the season strength grows by itself as before; the biofuel buys troops), 2 combined (a guaranteed trickle of beaconTricklePct % of the
//     scripted strength, biofuel on top).
//
// Rnd: none of its own (the stock ship, design and troop generation it calls draw galaxy.rnd as usual). Fixed iteration orders.

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { Habitat } from '../../../types';
import type { BuiltObject } from '../../../builtObject';
import type { Design } from '../../../design';
import type { Race } from '../../../data/races';
import { BuiltObjectSubRole } from '../../../builtObjectTypes';
import { ComponentType } from '../../../data/components';
import { BuiltObjectRole } from '../../../data/designSpecifications';
import { EmpireMessageType } from '../../../messages';
import { galaxyStarDate } from '../../../tick/simTime';
import { generateNewBuiltObject } from '../../../empireEvents';
import { generateDesignFromSpec } from '../../../designGeneration';
import { galaxyDesignSpecificationBySubRole } from '../../../gameStartTail';
import { takeOwnershipOfBuiltObject } from '../../../combat/ownership';
import { builtObjectCompleteTeardown } from '../../../combat/teardown';
import { calculateOverallStrengthFactorWithoutShields } from '../../../diplomacyTick';
import { assignMission } from '../../../missions/assign';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../../../missions/mission';
import { Population, PopulationList } from '../../../population';
import { recalculateEmpirePopulation } from '../../../taxes';
import { TroopList } from '../../../cargo';
import { isHumanEmpire } from '../../../humanEmpires';
import { GAME_DAY_LENGTH, registerScenarioQuery } from '../../hooks';
import { scenarioNews, scenarioText as T } from '../../messages';
import { empireTechLevel } from '../robotMutiny';
import { makeTroopsSplit } from '../factionNavy';
import { arcMessage, arcNews, normalEmpires } from '../framework';
import { BEACON_FLAG, P, peekBeaconState, type BeaconArtInfo, type BeaconState, type Captive, type CattleRec, type CoreRec, type FuelRec, type InterceptRec, type ProcessRec } from './beaconState';
import { addPlating, designFor, processingWorlds, referenceMilitary, scriptedBudget, spawnShip } from './beaconFleet';

const TAG = 'Beacon';
/** A cattle ship this close to its core docks. */
const DOCK_RANGE = 6000;
/** Enemy warships this close to a held world threaten it (the troop pass raises its garrison). */
const THREAT_RANGE = 30000;
const MAX_ENDED_CORES = 40;

function days(n: number): number {
    return n * GAME_DAY_LENGTH;
}

function strengthOf(bo: BuiltObject): number {
    return Math.max(0, calculateOverallStrengthFactorWithoutShields(bo));
}

// ---------------------------------------------------------------------------------------------------------------
// The funding model and the biofuel accounts
// ---------------------------------------------------------------------------------------------------------------

/** The share of the scripted strength the Reclaimers get for nothing: 0 (harvest only), 1 (scripted), the trickle (combined). Pure. */
export function freeShare(galaxy: Galaxy): number {
    const m = P.fundingModel(galaxy);
    if (m === 0) return 0;
    if (m === 1) return 1;
    return Math.max(0, Math.min(1, P.tricklePct(galaxy) / 100));
}

/** The biofuel accounts (made on first use; an old save has none). */
export function fuelOf(st: BeaconState): FuelRec {
    return (st.fuel ??= { fleet: 0, troops: 0, income: 0, spentShips: 0, spentTroops: 0, startGrant: 0, monthly: [] });
}

export function coresOf(st: BeaconState): CoreRec[] {
    return (st.cores ??= []);
}

export function cattleOf(st: BeaconState): CattleRec[] {
    return (st.cattle ??= []);
}

/**
 * The awakening reserve, when the Reclamation begins: models 0 and 2 get beaconFuelStartPct % of season 1's scripted strength less the
 * trickle's share in the fleet account (so season 1 is as strong as the scripted one), and the troop share of that on top for the
 * first landings. Model 1 needs none.
 */
export function initHarvest(galaxy: Galaxy, st: BeaconState): void {
    const fuel = fuelOf(st);
    coresOf(st);
    cattleOf(st);
    if (fuel.startGrant > 0 || P.fundingModel(galaxy) === 1) return;
    const grant = (scriptedBudget(galaxy, st, 1) * P.fuelStartPct(galaxy) * (1 - freeShare(galaxy))) / 100;
    if (!(grant > 0)) return;
    fuel.startGrant = grant;
    fuel.fleet += grant;
    fuel.troops += (grant * P.fuelTroopPct(galaxy)) / 100;
}

/** Spends up to `s` of fleet biofuel; returns what was paid. */
export function payFleet(st: BeaconState, s: number): number {
    const fuel = fuelOf(st);
    const paid = Math.max(0, Math.min(fuel.fleet, s));
    fuel.fleet -= paid;
    fuel.spentShips += paid;
    st.stats.fuelShips = (st.stats.fuelShips ?? 0) + paid;
    return paid;
}

/** Troop strength the troop account can still buy. Pure. */
export function troopsAffordable(galaxy: Galaxy, st: BeaconState): number {
    return Math.max(0, fuelOf(st).troops) * P.troopsPerFuel(galaxy);
}

/** Pays for `strength` of troops (at most what the account holds). */
export function payTroops(galaxy: Galaxy, st: BeaconState, strength: number): void {
    const fuel = fuelOf(st);
    const cost = Math.max(0, Math.min(fuel.troops, strength / P.troopsPerFuel(galaxy)));
    fuel.troops -= cost;
    fuel.spentTroops += cost;
    st.stats.fuelTroops = (st.stats.fuelTroops ?? 0) + cost;
}

/**
 * Biofuel made from `people` processed: beaconFuelPerBillionPct % of the reference military per billion (an absolute measure: a share of the
 * starting or of the living population over-pays a young galaxy or under-pays a crowded one). Split between the accounts by the funding model.
 */
export function earn(galaxy: Galaxy, st: BeaconState, people: number): number {
    if (!(people > 0)) return 0;
    const fuel = fuelOf(st);
    const made = (people / 1e9) * (P.fuelPerBillionPct(galaxy) / 100) * referenceMilitary(galaxy, st.faction);
    if (!(made > 0)) return 0;
    const toTroops = P.fundingModel(galaxy) === 1 ? made : (made * P.fuelTroopPct(galaxy)) / 100;
    fuel.troops += toTroops;
    fuel.fleet += made - toTroops;
    fuel.income += made;
    st.stats.fuelIncome = (st.stats.fuelIncome ?? 0) + made;
    return made;
}

/** Models 0 and 2: a troop account beyond what two garrisons of every held world (and a dozen landings') would cost spills into the fleet. */
function spillTroops(galaxy: Galaxy, st: BeaconState): void {
    if (P.fundingModel(galaxy) === 1) return;
    const fuel = fuelOf(st);
    const cap = (P.garrisonStrength(galaxy) * 2 * (processingWorlds(st).length + 12)) / P.troopsPerFuel(galaxy);
    if (fuel.troops > cap) {
        fuel.fleet += fuel.troops - cap;
        fuel.troops = cap;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Cores: how many, which, the harvester
// ---------------------------------------------------------------------------------------------------------------

/** The most cores the galaxy's size allows (2 / 3 under the thresholds; from beaconCoresBig rising to beaconCoresMax at beaconCoresHugeStars). Pure. */
export function coreTarget(galaxy: Galaxy): number {
    const stars = galaxy.starCount;
    if (stars < P.coresMidStars(galaxy)) return P.coresSmall(galaxy);
    if (stars < P.coresBigStars(galaxy)) return P.coresMid(galaxy);
    const lo = P.coresBigStars(galaxy);
    const hi = P.coresHugeStars(galaxy);
    const big = P.coresBig(galaxy);
    const max = Math.max(big, P.coresMax(galaxy));
    if (stars >= hi || hi <= lo) return max;
    return Math.max(big, Math.min(max, Math.round(big + ((max - big) * (stars - lo)) / (hi - lo))));
}

/** Cores wanted while `held` worlds are held: the galaxy's target, at most one per beaconCoreWorldsPer held worlds (at least one). Pure. */
export function coreCountFor(galaxy: Galaxy, held: number): number {
    if (held <= 0) return 0;
    return Math.min(coreTarget(galaxy), Math.max(1, Math.ceil(held / P.coreWorldsPer(galaxy))));
}

/** The live cores (held by the faction, not ended). */
export function liveCores(st: BeaconState): CoreRec[] {
    return coresOf(st).filter((c) => c.ended === null && !c.colony.hasBeenDestroyed && c.colony.empire === st.faction);
}

function isCore(st: BeaconState, h: Habitat): boolean {
    return coresOf(st).some((c) => c.ended === null && c.colony === h);
}

function banned(st: BeaconState, h: Habitat, now: number): boolean {
    return (st.coreBans ?? []).some((b) => b.colony === h && b.until > now);
}

/**
 * The next core among the held worlds: the most populous (square root of the people), its pull falling off within beaconCoreSpreadSectors
 * of the cores already chosen, so they spread across the holdings. Pure (no Rnd); ties by habitat index.
 */
export function pickCore(galaxy: Galaxy, st: BeaconState, now: number): Habitat | null {
    const cores = liveCores(st).map((c) => c.colony);
    const range = Math.max(1, P.coreSpreadSectors(galaxy) * galaxy.sectorSize);
    let best: Habitat | null = null;
    let bs = -1;
    for (const r of processingWorlds(st)) {
        const h = r.colony;
        if (cores.includes(h) || banned(st, h, now) || h.population === null || h.population.totalAmount <= 0) continue;
        let spread = 1;
        if (cores.length > 0) {
            let dmin = Infinity;
            for (const c of cores) dmin = Math.min(dmin, galaxy.calculateDistance(h.xpos, h.ypos, c.xpos, c.ypos));
            spread = dmin / (dmin + range);
        }
        const score = Math.sqrt(1 + h.population.totalAmount / 1e6) * spread;
        if (score > bs || (score === bs && best !== null && h.habitatIndex < best.habitatIndex)) {
            bs = score;
            best = h;
        }
    }
    return best;
}

const WEAPONS: ReadonlySet<ComponentType> = new Set([ComponentType.WeaponBeam, ComponentType.WeaponTorpedo, ComponentType.WeaponMissile, ComponentType.WeaponIonCannon]);

function namedDesign(faction: Empire, name: string): Design | null {
    for (const d of faction.designs) if (d !== null && d.name === name) return d;
    return null;
}

/** The harvester design: the faction's defensive base, plated (beaconHarvesterArmourPct / ShieldPct) and with more guns; never an AI build. */
export function harvesterDesign(galaxy: Galaxy, faction: Empire): Design | null {
    const name = T('Beacon Harvester Design');
    const have = namedDesign(faction, name);
    if (have !== null) return have;
    const spec = faction.designSpecifications.find((s) => s !== null && s.subRole === BuiltObjectSubRole.DefensiveBase) ?? galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.DefensiveBase);
    if (spec === null || spec === undefined) return null;
    try {
        const d = generateDesignFromSpec(galaxy, faction, spec, Math.max(1, empireTechLevel(faction)), galaxyStarDate(galaxy));
        if (d === null) return null;
        addPlating(d, [d], P.harvesterArmourPct(galaxy), P.harvesterShieldPct(galaxy));
        const guns = d.components.filter((c) => WEAPONS.has(c.type));
        const n = Math.round((guns.length * P.harvesterGunsPct(galaxy)) / 100);
        for (let i = 0; i < n && guns.length > 0; i++) d.components.push(guns[i % guns.length]);
        if (n > 0) d.reDefine();
        d.name = name;
        d.isObsolete = true;
        faction.designs.push(d);
        return d;
    } catch {
        return null;
    }
}

/**
 * The cattle ship design: the faction's large freighter template, plated with beaconCattleArmourPct % of armour (the best armour part of its
 * own warships) and a little shielding, then grown by beaconCattleHoldPct % in passenger holds: a huge box of a ship, slow to spool its drive. Never an AI build. Art key 'cattle' (beaconShipRole).
 */
export function cattleDesign(galaxy: Galaxy, faction: Empire): Design | null {
    const name = T('Beacon Cattle Design');
    const have = namedDesign(faction, name);
    if (have !== null) return have;
    const spec = faction.designSpecifications.find((s) => s !== null && s.subRole === BuiltObjectSubRole.LargeFreighter) ?? galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.LargeFreighter);
    if (spec === null || spec === undefined) return null;
    try {
        const d = generateDesignFromSpec(galaxy, faction, spec, Math.max(1, empireTechLevel(faction)), galaxyStarDate(galaxy));
        if (d === null) return null;
        const war = designFor(galaxy, faction, BuiltObjectSubRole.CapitalShip);
        addPlating(d, war !== null ? [d, war] : [d], P.cattleArmourPct(galaxy), 30);
        // the holds: passenger compartments (cargo bays when the faction has none) adding beaconCattleHoldPct % of its size: a huge box of a ship
        const pax = designFor(galaxy, faction, BuiltObjectSubRole.PassengerShip);
        const hold = [d, pax].flatMap((x) => x?.components ?? []).find((c) => c.type === ComponentType.StoragePassenger && c.size > 0) ?? d.components.find((c) => c.type === ComponentType.StorageCargo && c.size > 0) ?? null;
        if (hold !== null) {
            const n = Math.round((d.size * P.cattleHoldPct(galaxy)) / 100 / hold.size);
            for (let i = 0; i < n; i++) d.components.push(hold);
            if (n > 0) d.reDefine();
        }
        d.name = name;
        d.isObsolete = true;
        faction.designs.push(d);
        return d;
    } catch {
        return null;
    }
}

function spawnHarvester(galaxy: Galaxy, st: BeaconState, colony: Habitat): BuiltObject | null {
    const faction = st.faction!;
    const d = harvesterDesign(galaxy, faction);
    if (d === null) return null;
    const bo = generateNewBuiltObject(galaxy, faction, d, colony);
    takeOwnershipOfBuiltObject(galaxy, faction, bo, faction, false);
    bo.supportCostFactor = 0;
    bo.isAutoControlled = false;
    bo.name = T('Beacon Harvester Name', colony.name);
    return bo;
}

/** Makes `colony` a core (its harvester spawned in orbit). */
export function designateCore(galaxy: Galaxy, st: BeaconState, colony: Habitat): CoreRec {
    const now = galaxyStarDate(galaxy);
    const rec: CoreRec = {
        colony, since: now, harvester: spawnHarvester(galaxy, st, colony), pens: [], waiting: 0, received: 0, processed: 0, popStart: colony.population?.totalAmount ?? 0, ended: null, endDate: 0,
        readyDate: now + days(P.coreBuildDays(galaxy)),
    };
    coresOf(st).push(rec);
    st.stats.coresDesignated = (st.stats.coresDesignated ?? 0) + 1;
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Core', onceKey: `Core:${colony.habitatIndex}:${st.stats.coresDesignated}`, textTag: `${TAG} Core News`, args: [colony.name], subject: colony });
    return rec;
}

/** Ends a core: `why` and its harvester gone; the pens freed toward `to` (null: kept at the world, which is no longer theirs). */
function endCore(galaxy: Galaxy, st: BeaconState, core: CoreRec, why: 'retaken' | 'broken' | 'lost', to: Empire | null): number {
    const now = galaxyStarDate(galaxy);
    core.ended = why;
    core.endDate = now;
    const hv = core.harvester;
    if (hv !== null && !hv.hasBeenDestroyed) builtObjectCompleteTeardown(galaxy, hv);
    core.harvester = null;
    let freed = 0;
    if (why !== 'lost' || !core.colony.hasBeenDestroyed) {
        freed = core.waiting;
        if (freed > 0) releaseCaptives(galaxy, st, core.pens, core.colony, to, why === 'retaken' ? core.colony : null);
        st.stats.captivesFreed = (st.stats.captivesFreed ?? 0) + freed;
    } else if (core.waiting > 0) {
        // the world itself was destroyed with its pens
        st.popEliminated += core.waiting;
        st.stats.captivesKilled = (st.stats.captivesKilled ?? 0) + core.waiting;
    }
    core.pens = [];
    core.waiting = 0;
    if (why === 'retaken') st.stats.coresRetaken = (st.stats.coresRetaken ?? 0) + 1;
    else if (why === 'broken') {
        st.stats.coresBroken = (st.stats.coresBroken ?? 0) + 1;
        (st.coreBans ??= []).push({ colony: core.colony, until: now + days(P.coreBanDays(galaxy)) });
    } else st.stats.coresLost = (st.stats.coresLost ?? 0) + 1;
    const cores = coresOf(st);
    const ended = cores.filter((c) => c.ended !== null);
    if (ended.length > MAX_ENDED_CORES) st.cores = cores.filter((c) => c.ended === null || ended.indexOf(c) >= ended.length - MAX_ENDED_CORES);
    return freed;
}

// ---------------------------------------------------------------------------------------------------------------
// People: taking, penning, freeing
// ---------------------------------------------------------------------------------------------------------------

function sumOf(list: readonly Captive[]): number {
    let s = 0;
    for (const c of list) s += c.amount;
    return s;
}

function addTo(list: Captive[], race: string, amount: number): void {
    if (!(amount > 0)) return;
    const x = list.find((c) => c.race === race);
    if (x !== undefined) x.amount += amount;
    else list.push({ race, amount });
}

/** Takes `amount` people off `h` (each race by its share): returns them by race. */
function takePeople(h: Habitat, amount: number): Captive[] {
    const out: Captive[] = [];
    const pop = h.population;
    if (pop === null || pop.totalAmount <= 0 || !(amount > 0)) return out;
    const frac = Math.min(1, amount / pop.totalAmount);
    for (const p of pop.items) {
        const cut = Math.floor(p.amount * frac);
        if (cut <= 0) continue;
        p.amount -= cut;
        addTo(out, p.race.name, cut);
    }
    pop.items = pop.items.filter((p) => p.amount > 0);
    pop.recalculateTotalAmount();
    return out;
}

/** Removes `amount` from the pens (each race by its share): returns what was removed. */
function takeFromPens(core: CoreRec, amount: number): number {
    const total = core.waiting;
    if (!(total > 0) || !(amount > 0)) return 0;
    const frac = Math.min(1, amount / total);
    let removed = 0;
    for (const c of core.pens) {
        const cut = frac >= 1 ? c.amount : Math.floor(c.amount * frac);
        c.amount -= cut;
        removed += cut;
    }
    core.pens = core.pens.filter((c) => c.amount > 0);
    core.waiting = sumOf(core.pens);
    return removed;
}

function raceNamed(galaxy: Galaxy, name: string): Race | null {
    return (galaxy.races.find((r) => r !== null && r.name === name) ?? null) as Race | null;
}

function addPeople(galaxy: Galaxy, h: Habitat, race: Race, amount: number): void {
    if (h.population == null) h.population = new PopulationList();
    h.population.add(new Population(race, amount, galaxy));
    h.population.recalculateTotalAmount();
}

/**
 * Freed people go home as population: to `first` (a retaken core keeps its own pens), then the nearest worlds of `to` with room, else the
 * nearest world of any empire not the Reclaimers'. Whatever finds no room goes to the first receiver anyway. Returns the people placed.
 */
export function releaseCaptives(galaxy: Galaxy, st: BeaconState, load: readonly Captive[], near: { xpos: number; ypos: number }, to: Empire | null, first: Habitat | null): number {
    const total = sumOf(load);
    if (!(total > 0)) return 0;
    const ok = (h: Habitat): boolean => !h.hasBeenDestroyed && h.empire !== null && h.empire !== st.faction && h.empire.active;
    const dist = (h: Habitat): number => galaxy.calculateDistance(h.xpos, h.ypos, near.xpos, near.ypos);
    const recv: Habitat[] = [];
    if (first !== null && ok(first)) recv.push(first);
    const own = to !== null && to !== st.faction ? to.colonies.filter((h) => ok(h) && !recv.includes(h)) : [];
    own.sort((a, b) => dist(a) - dist(b) || a.habitatIndex - b.habitatIndex);
    for (const h of own) if (recv.length < 4) recv.push(h);
    if (recv.length === 0) {
        let best: Habitat | null = null;
        for (const e of normalEmpires(galaxy, st.faction)) for (const h of e.colonies) if (ok(h) && (best === null || dist(h) < dist(best))) best = h;
        if (best !== null) recv.push(best);
    }
    if (recv.length === 0) return 0;
    const touched = new Set<Empire>();
    let placed = 0;
    for (const c of load) {
        const race = raceNamed(galaxy, c.race) ?? recv[0].population?.dominantRace ?? null;
        if (race === null) continue;
        let left = c.amount;
        for (const h of recv) {
            if (left <= 0) break;
            const room = Math.max(0, Math.floor(h.maxPopulation - (h.population?.totalAmount ?? 0)));
            const put = Math.min(left, room);
            if (put <= 0) continue;
            addPeople(galaxy, h, race, put);
            left -= put;
            placed += put;
            if (h.empire !== null) touched.add(h.empire);
        }
        if (left > 0) {
            addPeople(galaxy, recv[0], race, left);
            placed += left;
            if (recv[0].empire !== null) touched.add(recv[0].empire);
        }
    }
    for (const e of touched) if (e !== galaxy.independentEmpire) recalculateEmpirePopulation(e);
    return placed;
}

// ---------------------------------------------------------------------------------------------------------------
// Cattle ships
// ---------------------------------------------------------------------------------------------------------------

function nearestCore(galaxy: Galaxy, st: BeaconState, x: number, y: number): CoreRec | null {
    let best: CoreRec | null = null;
    let bd = Infinity;
    for (const c of liveCores(st)) {
        const d = galaxy.calculateDistance(x, y, c.colony.xpos, c.colony.ypos);
        if (d < bd || (d === bd && best !== null && c.colony.habitatIndex < best.colony.habitatIndex)) {
            bd = d;
            best = c;
        }
    }
    return best;
}

function sail(galaxy: Galaxy, bo: BuiltObject, target: Habitat): void {
    const m = builtObjectMission(bo.mission);
    if (m !== null && m.type === BuiltObjectMissionType.Move && m.targetHabitat === target) return;
    bo.isAutoControlled = false;
    assignMission(galaxy, bo, BuiltObjectMissionType.Move, target, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
}

/** A held world (not a core) launches a cattle ship to the nearest core with beaconCattleLoadPct % of its people at the conquest. */
export function launchCattle(galaxy: Galaxy, st: BeaconState, rec: ProcessRec): CattleRec | null {
    const faction = st.faction;
    const h = rec.colony;
    if (faction === null || h.population === null) return null;
    const floor = Math.max(1, rec.popStart * 0.01);
    const total = h.population.totalAmount;
    if (total <= floor * 1.05) {
        rec.done = true;
        return null;
    }
    const core = nearestCore(galaxy, st, h.xpos, h.ypos);
    const d = core !== null ? cattleDesign(galaxy, faction) : null;
    if (core === null || d === null) return null;
    const load = takePeople(h, Math.min(total - floor, Math.max(1, (rec.popStart * P.cattleLoadPct(galaxy)) / 100)));
    const n = sumOf(load);
    if (n <= 0) return null;
    const ship = spawnShip(galaxy, faction, d, h.xpos, h.ypos);
    ship.name = T('Beacon Cattle Name', h.name);
    sail(galaxy, ship, core.colony);
    const c: CattleRec = { ship, from: h, core: core.colony, load, total: n, launched: galaxyStarDate(galaxy) };
    cattleOf(st).push(c);
    assignEscorts(galaxy, st, c);
    rec.drained += n;
    st.stats.cattleLaunched = (st.stats.cattleLaunched ?? 0) + 1;
    if (h.population.totalAmount <= floor * 1.05) rec.done = true;
    return c;
}

/** A cattle ship was destroyed: its captives die with it (beaconCattleDeadCountPct % of them count as eliminated by the Reclaimers). No reputation is lost for it. */
export function onCattleKilled(galaxy: Galaxy, st: BeaconState, bo: BuiltObject): boolean {
    const list = cattleOf(st);
    const i = list.findIndex((c) => c.ship === bo);
    if (i < 0) return false;
    const c = list[i];
    list.splice(i, 1);
    noteIntercept(galaxy, st, c.from);
    releaseEscorts(galaxy, st, c, true);
    cattleDestroyed(galaxy, st, c, bo);
    st.stats.cattleKilled = (st.stats.cattleKilled ?? 0) + 1;
    return true;
}

/**
 * The world the escape pods of a destroyed cattle ship reach: the world the people were taken from when it is not held by the Reclaimers, else
 * the nearest non-Reclaimer colony of their (largest) race, else the nearest non-Reclaimer colony of any race. Pure.
 */
export function podWorld(galaxy: Galaxy, st: BeaconState, c: CattleRec, near: { xpos: number; ypos: number }): Habitat | null {
    const ok = (h: Habitat): boolean => !h.hasBeenDestroyed && h.empire !== null && h.empire !== st.faction && h.empire.active;
    if (ok(c.from)) return c.from;
    const top = c.load.reduce<Captive | null>((b, x) => (b === null || x.amount > b.amount ? x : b), null);
    let race: Habitat | null = null;
    let any: Habitat | null = null;
    let rd = Infinity;
    let ad = Infinity;
    const all: Habitat[] = [];
    for (const e of normalEmpires(galaxy, st.faction)) for (const h of e.colonies) if (ok(h)) all.push(h);
    for (const h of galaxy.independentColonies) if (ok(h) && h.empire === galaxy.independentEmpire) all.push(h);
    for (const h of all) {
        const d = galaxy.calculateDistance(h.xpos, h.ypos, near.xpos, near.ypos);
        if (d < ad) {
            ad = d;
            any = h;
        }
        if (top !== null && h.population?.dominantRace?.name === top.race && d < rd) {
            rd = d;
            race = h;
        }
    }
    return race ?? any;
}

/**
 * A cattle ship was destroyed: beaconCattleSurvivePct % of its captives escape in pods to a world (podWorld) and count as rescued; the rest die
 * (beaconCattleDeadCountPct % of those count as eliminated by the Reclaimers). The destroyer loses no reputation.
 */
function cattleDestroyed(galaxy: Galaxy, st: BeaconState, c: CattleRec, near: { xpos: number; ypos: number }): void {
    const frac = Math.max(0, Math.min(1, P.cattleSurvivePct(galaxy) / 100));
    const world = frac > 0 ? podWorld(galaxy, st, c, near) : null;
    let saved = 0;
    if (world !== null) {
        const pods = c.load.map((x) => ({ race: x.race, amount: x.amount * frac }));
        saved = releaseCaptives(galaxy, st, pods, near, null, world);
    }
    const dead = Math.max(0, c.total - saved);
    st.popEliminated += (dead * P.cattleDeadCountPct(galaxy)) / 100;
    st.stats.captivesKilled = (st.stats.captivesKilled ?? 0) + dead;
    st.stats.captivesRescued = (st.stats.captivesRescued ?? 0) + saved;
    if (world !== null && saved > 0) scenarioNews(galaxy, null, T('Beacon Pods News', world.name, Math.max(1, Math.round(saved / 1e6)).toLocaleString('en-US'), c.from.name), (e) => isHumanEmpire(galaxy, e), world);
}

/**
 * The capture hook: a cattle ship disabled and taken by `by` (boarding; a future shared capture feature calls this too) frees its captives
 * to `by`'s nearest worlds; the empty ship is the taker's. Returns the people freed (0: not a cattle ship of the Reclaimers in flight).
 */
export function rescueCattle(galaxy: Galaxy, st: BeaconState, bo: BuiltObject, by: Empire | null): number {
    const list = cattleOf(st);
    const i = list.findIndex((c) => c.ship === bo);
    if (i < 0) return 0;
    const c = list[i];
    list.splice(i, 1);
    noteIntercept(galaxy, st, c.from);
    releaseEscorts(galaxy, st, c, true);
    const placed = releaseCaptives(galaxy, st, c.load, bo, by, null);
    st.stats.cattleBoarded = (st.stats.cattleBoarded ?? 0) + 1;
    st.stats.captivesRescued = (st.stats.captivesRescued ?? 0) + c.total;
    if (by !== null && isHumanEmpire(galaxy, by)) arcMessage(galaxy, st.sentStages, [by], { prefix: TAG, stage: 'Rescued', onceKey: `Rescued:${bo.builtObjectID}`, args: [Math.round(c.total / 1e6), c.from.name], type: EmpireMessageType.GeneralGoodEvent, subject: bo });
    return placed;
}

// ---------------------------------------------------------------------------------------------------------------
// Cattle escorts, with escalation
// ---------------------------------------------------------------------------------------------------------------

export function interceptsOf(st: BeaconState): InterceptRec[] {
    return (st.intercepts ??= []);
}

/** The interceptions (destroyed or boarded cattle ships) now counted against `colony` (decayed). Pure. */
export function interceptsAt(st: BeaconState, colony: Habitat): number {
    return interceptsOf(st).find((r) => r.colony === colony)?.n ?? 0;
}

/** A cattle ship from `colony` was destroyed or boarded. */
export function noteIntercept(galaxy: Galaxy, st: BeaconState, colony: Habitat): void {
    const now = galaxyStarDate(galaxy);
    const list = interceptsOf(st);
    const r = list.find((x) => x.colony === colony);
    if (r === undefined) list.push({ colony, n: 1, date: now });
    else {
        r.n += 1;
        r.date = now;
    }
}

/** The counts slowly decay: 1 per beaconEscortDecayDays. */
function decayIntercepts(galaxy: Galaxy, st: BeaconState): void {
    const now = galaxyStarDate(galaxy);
    const list = interceptsOf(st);
    for (const r of list) {
        r.n = Math.max(0, r.n - (now - r.date) / days(P.escortDecayDays(galaxy)));
        r.date = now;
    }
    st.intercepts = list.filter((r) => r.n > 0.02 && !r.colony.hasBeenDestroyed);
}

const TIERS: readonly BuiltObjectSubRole[] = [BuiltObjectSubRole.Frigate, BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.Cruiser];

/** The escort a cattle ship from `from` should get: the world with the most interceptions the heaviest (destroyers, then cruisers), the rest light (1-2 frigates). Pure. */
export function escortPlan(galaxy: Galaxy, st: BeaconState, from: Habitat, serial: number): { tier: 0 | 1 | 2; count: number } {
    const list = interceptsOf(st).filter((r) => r.n >= 0.5);
    const top = list.reduce<InterceptRec | null>((b, r) => (b === null || r.n > b.n ? r : b), null);
    if (top !== null && top.colony === from) {
        if (top.n >= P.escortCruiserAt(galaxy) - 0.5) return { tier: 2, count: 2 };
        if (top.n >= P.escortDestroyerAt(galaxy) - 0.5) return { tier: 1, count: 2 };
    }
    return { tier: 0, count: list.some((r) => r.colony === from) ? 2 : 1 + (serial % 2) };
}

/** Warships of the Reclaimers that are free: not in a strike group, a Watcher fleet, the guard, a raid or an escort (the reserve, and any other idle or patrolling one). */
function freeWarships(galaxy: Galaxy, st: BeaconState, sub: BuiltObjectSubRole): BuiltObject[] {
    const faction = st.faction;
    if (faction === null) return [];
    const busy = new Set<BuiltObject>();
    for (const s of st.seasons) for (const g of s.groups) for (const b of [...g.ships, ...g.transports, ...(g.destroyer !== null ? [g.destroyer] : [])]) busy.add(b);
    for (const f of st.watcherFleets ?? []) for (const b of f.ships) busy.add(b);
    for (const b of st.guards) busy.add(b);
    for (const r of st.raids) for (const b of r.ships) busy.add(b);
    for (const b of st.thrallShips) busy.add(b);
    for (const c of cattleOf(st)) for (const b of c.escorts ?? []) busy.add(b);
    for (const w of st.watchers) if (w.ship !== null) busy.add(w.ship);
    if (st.beacon !== null) busy.add(st.beacon);
    const out: BuiltObject[] = [];
    for (const b of faction.builtObjects) {
        if (b.hasBeenDestroyed || b.role !== BuiltObjectRole.Military || b.subRole !== sub || busy.has(b) || b.shipGroup !== null || b.actualEmpire !== faction) continue;
        const m = builtObjectMission(b.mission);
        if (m !== null && m.type !== BuiltObjectMissionType.Patrol && m.type !== BuiltObjectMissionType.Undefined && m.type !== BuiltObjectMissionType.Hold && m.type !== BuiltObjectMissionType.Move && m.type !== BuiltObjectMissionType.MoveAndWait) continue;
        out.push(b);
    }
    return out;
}

function escortOrder(galaxy: Galaxy, bo: BuiltObject, target: BuiltObject): void {
    const m = builtObjectMission(bo.mission);
    if (m !== null && m.type === BuiltObjectMissionType.Escort && m.targetBuiltObject === target) return;
    bo.isAutoControlled = false;
    assignMission(galaxy, bo, BuiltObjectMissionType.Escort, target, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
}

/** Builds an escort of `sub` from the fleet biofuel at `from` (null when it cannot be paid). */
function buildEscort(galaxy: Galaxy, st: BeaconState, sub: BuiltObjectSubRole, from: Habitat): BuiltObject | null {
    const faction = st.faction;
    if (faction === null) return null;
    const design = designFor(galaxy, faction, sub);
    if (design === null) return null;
    const bo = spawnShip(galaxy, faction, design, from.xpos, from.ypos);
    const cost = strengthOf(bo);
    if (fuelOf(st).fleet < cost) {
        builtObjectCompleteTeardown(galaxy, bo);
        return null;
    }
    payFleet(st, cost);
    st.stats.escortBuilt = (st.stats.escortBuilt ?? 0) + 1;
    return bo;
}

/**
 * A cattle ship has launched: the Reclaimers' nearest free warships of the tier the world's record calls for are ordered to escort it (the stock
 * Escort job); with none free, escorts are built from the fleet biofuel. A tier that cannot be had falls back to the next lighter one.
 */
export function assignEscorts(galaxy: Galaxy, st: BeaconState, c: CattleRec): void {
    if (!P.escortsOn(galaxy)) return;
    const plan = escortPlan(galaxy, st, c.from, st.stats.cattleLaunched ?? 0);
    c.escorts = [];
    c.built = [];
    for (let tier = plan.tier; tier >= 0; tier--) {
        const sub = TIERS[tier];
        const free = freeWarships(galaxy, st, sub).sort((a, b) => galaxy.calculateDistance(a.xpos, a.ypos, c.from.xpos, c.from.ypos) - galaxy.calculateDistance(b.xpos, b.ypos, c.from.xpos, c.from.ypos));
        const got: BuiltObject[] = free.slice(0, plan.count);
        const fresh: BuiltObject[] = [];
        while (got.length < plan.count) {
            const b = buildEscort(galaxy, st, sub, c.from);
            if (b === null) break;
            got.push(b);
            fresh.push(b);
        }
        if (got.length === 0) continue;
        for (const b of got) escortOrder(galaxy, b, c.ship);
        for (const b of got) {
            const i = st.reserve.indexOf(b);
            if (i >= 0) st.reserve.splice(i, 1);
        }
        c.escorts = got;
        c.built = fresh;
        if (tier === 0) st.stats.escortLight = (st.stats.escortLight ?? 0) + 1;
        else if (tier === 1) st.stats.escortMid = (st.stats.escortMid ?? 0) + 1;
        else st.stats.escortHeavy = (st.stats.escortHeavy ?? 0) + 1;
        return;
    }
}

/** Keeps the escorts on the job (a lost order is given again, the dead are dropped). */
function driveEscorts(galaxy: Galaxy, c: CattleRec): void {
    if (c.escorts === undefined || c.escorts.length === 0) return;
    c.escorts = c.escorts.filter((b) => !b.hasBeenDestroyed);
    for (const b of c.escorts) escortOrder(galaxy, b, c.ship);
}

/** The cattle ship docked or was lost: its escorts go back to patrol (the world the ship sailed from) and are free again (the reserve). */
export function releaseEscorts(galaxy: Galaxy, st: BeaconState, c: CattleRec, lost: boolean): void {
    const faction = st.faction;
    const list = c.escorts ?? [];
    c.escorts = [];
    c.built = [];
    if (list.length === 0 || faction === null) return;
    const home = c.core.hasBeenDestroyed ? c.from : c.core;
    for (const b of list) {
        if (b.hasBeenDestroyed) {
            if (lost) st.stats.escortLost = (st.stats.escortLost ?? 0) + 1;
            continue;
        }
        if (b.actualEmpire !== faction) continue;
        b.isAutoControlled = false;
        assignMission(galaxy, b, BuiltObjectMissionType.Patrol, home, null, BuiltObjectMissionPriority.Normal, { manuallyAssigned: true });
        if (!st.reserve.includes(b)) st.reserve.push(b);
    }
}

/** Every 5 days: cattle ships sail on, dock at their core (the people are penned), or find another core when theirs is gone. */
function driveCattle(galaxy: Galaxy, st: BeaconState): void {
    const faction = st.faction!;
    const keep: CattleRec[] = [];
    for (const c of cattleOf(st)) {
        const bo = c.ship;
        if (bo.hasBeenDestroyed) {
            // destroyed without a kill event (a collision, a teardown): the captives are lost all the same
            noteIntercept(galaxy, st, c.from);
            releaseEscorts(galaxy, st, c, true);
            cattleDestroyed(galaxy, st, c, bo);
            st.stats.cattleKilled = (st.stats.cattleKilled ?? 0) + 1;
            continue;
        }
        if (bo.actualEmpire !== faction) {
            noteIntercept(galaxy, st, c.from);
            releaseEscorts(galaxy, st, c, true);
            const placed = releaseCaptives(galaxy, st, c.load, bo, bo.actualEmpire, null);
            void placed;
            st.stats.cattleBoarded = (st.stats.cattleBoarded ?? 0) + 1;
            st.stats.captivesRescued = (st.stats.captivesRescued ?? 0) + c.total;
            continue;
        }
        let core = coresOf(st).find((x) => x.ended === null && x.colony === c.core && x.colony.empire === faction) ?? null;
        if (core === null) {
            core = nearestCore(galaxy, st, bo.xpos, bo.ypos);
            if (core === null) {
                // no core left: the people go back into the nearest held world's population (penned there), or go free when none is held
                let home: Habitat | null = null;
                for (const r of processingWorlds(st)) if (home === null || galaxy.calculateDistance(bo.xpos, bo.ypos, r.colony.xpos, r.colony.ypos) < galaxy.calculateDistance(bo.xpos, bo.ypos, home.xpos, home.ypos)) home = r.colony;
                if (home !== null && galaxy.calculateDistance(bo.xpos, bo.ypos, home.xpos, home.ypos) > DOCK_RANGE) {
                    sail(galaxy, bo, home);
                    keep.push(c);
                    continue;
                }
                if (home !== null) {
                    for (const x of c.load) {
                        const race = raceNamed(galaxy, x.race);
                        if (race !== null) addPeople(galaxy, home, race, x.amount);
                    }
                } else {
                    releaseCaptives(galaxy, st, c.load, bo, null, null);
                    st.stats.captivesFreed = (st.stats.captivesFreed ?? 0) + c.total;
                }
                builtObjectCompleteTeardown(galaxy, bo);
                continue;
            }
            c.core = core.colony;
        }
        if (galaxy.calculateDistance(bo.xpos, bo.ypos, core.colony.xpos, core.colony.ypos) <= DOCK_RANGE) {
            for (const x of c.load) addTo(core.pens, x.race, x.amount);
            core.waiting = sumOf(core.pens);
            core.received += c.total;
            st.stats.cattleArrived = (st.stats.cattleArrived ?? 0) + 1;
            releaseEscorts(galaxy, st, c, false);
            builtObjectCompleteTeardown(galaxy, bo);
            continue;
        }
        sail(galaxy, bo, core.colony);
        driveEscorts(galaxy, c);
        keep.push(c);
    }
    st.cattle = keep;
    decayIntercepts(galaxy, st);
}

// ---------------------------------------------------------------------------------------------------------------
// The periodic pass (every 5 days) and the monthly processing
// ---------------------------------------------------------------------------------------------------------------

/** Every 5 days: cores kept up (lost ones ended, broken ones found, new ones designated), cattle ships launched and sailed, the art's lists. */
export function harvestPeriodic(galaxy: Galaxy, st: BeaconState): void {
    const faction = st.faction;
    if (faction === null) return;
    const now = galaxyStarDate(galaxy);
    for (const core of coresOf(st)) {
        if (core.ended !== null) continue;
        if (core.colony.hasBeenDestroyed) endCore(galaxy, st, core, 'lost', null);
        else if (core.colony.empire !== faction) endCore(galaxy, st, core, 'retaken', core.colony.empire);
        else if (core.harvester !== null && (core.harvester.hasBeenDestroyed || core.harvester.actualEmpire !== faction)) onHarvesterLost(galaxy, st, core, core.harvester.actualEmpire !== faction ? core.harvester.actualEmpire : null);
    }
    const held = processingWorlds(st);
    const want = coreCountFor(galaxy, held.length);
    for (let guard = 0; guard < 8 && liveCores(st).length < want; guard++) {
        const h = pickCore(galaxy, st, now);
        if (h === null) break;
        designateCore(galaxy, st, h);
    }
    const cap = P.cattleMax(galaxy);
    // (catching up, up to 3 a world a pass: the periodic runs once per stock long block, 36 days at 1x)
    for (const rec of held) {
        if (isCore(st, rec.colony)) continue;
        for (let k = 0; k < 3 && !rec.done && (rec.nextConvoy ?? 0) <= now && cattleOf(st).length < cap; k++) {
            rec.nextConvoy = Math.max((rec.nextConvoy ?? 0) + days(P.cattleDays(galaxy)), now - days(P.cattleDays(galaxy) * 2));
            launchCattle(galaxy, st, rec);
        }
    }
    driveCattle(galaxy, st);
    st.coreWorlds = liveCores(st).map((c) => c.colony);
    st.cattleShips = cattleOf(st).map((c) => c.ship);
    st.harvesters = liveCores(st).map((c) => c.harvester).filter((b): b is BuiltObject => b !== null && !b.hasBeenDestroyed);
    st.art = beaconArtInfo(galaxy, st);
}

/** The harvester was destroyed (or taken): the core is broken, its pens freed toward the attacker (or the world's first owner). */
export function onHarvesterLost(galaxy: Galaxy, st: BeaconState, core: CoreRec, by: Empire | null): void {
    if (core.ended !== null) return;
    const freed = endCore(galaxy, st, core, 'broken', by);
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Harvester', onceKey: `Harvester:${core.colony.habitatIndex}:${core.since}`, textTag: `${TAG} Harvester Destroyed News`, args: [core.colony.name, by?.name ?? T(`${TAG} Independents`), Math.round(freed / 1e6)], subject: core.colony });
    if (by !== null && isHumanEmpire(galaxy, by)) arcMessage(galaxy, st.sentStages, [by], { prefix: TAG, stage: 'Freed', onceKey: `Freed:${core.colony.habitatIndex}:${core.since}`, args: [Math.round(freed / 1e6), core.colony.name], type: EmpireMessageType.GeneralGoodEvent, subject: core.colony });
}

/** A core world changed hands away from the Reclaimers: the core ends and its pens go to the new owner. Returns the people freed. */
export function onCoreRetaken(galaxy: Galaxy, st: BeaconState, colony: Habitat, to: Empire | null): number {
    const core = coresOf(st).find((c) => c.ended === null && c.colony === colony);
    if (core === undefined) return 0;
    const freed = endCore(galaxy, st, core, 'retaken', to);
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Core Retaken', onceKey: `CoreRetaken:${colony.habitatIndex}:${core.since}`, textTag: `${TAG} Core Retaken News`, args: [colony.name, to?.name ?? T(`${TAG} Independents`), Math.round(freed / 1e6)], subject: colony });
    if (to !== null && isHumanEmpire(galaxy, to)) arcMessage(galaxy, st.sentStages, [to], { prefix: TAG, stage: 'Freed', onceKey: `Freed:${colony.habitatIndex}:${core.since}`, args: [Math.round(freed / 1e6), colony.name], type: EmpireMessageType.GeneralGoodEvent, subject: colony });
    return freed;
}

/** A core's own people, processed over beaconCoreDrainMonths (down to 1 % of them). Returns the people taken. */
function drainCoreWorld(galaxy: Galaxy, core: CoreRec): number {
    const h = core.colony;
    const pop = h.population;
    if (pop === null || pop.totalAmount <= 0) return 0;
    const floor = Math.max(1, core.popStart * 0.01);
    if (pop.totalAmount <= floor) return 0;
    const step = Math.min(pop.totalAmount - floor, Math.max(1, core.popStart / P.coreDrainMonths(galaxy)));
    return sumOf(takePeople(h, step));
}

/**
 * Monthly: every working core processes a share of its pens and of its own people into biofuel (the processed are eliminated), the
 * troop pass, the record of the month's income. Returns the people processed.
 */
export function harvestMonthly(galaxy: Galaxy, st: BeaconState): number {
    const faction = st.faction;
    if (faction === null) return 0;
    if (st.fuel === undefined) initHarvest(galaxy, st);
    const fuel = fuelOf(st);
    const before = fuel.income;
    let people = 0;
    const now = galaxyStarDate(galaxy);
    for (const core of liveCores(st)) {
        if (core.harvester !== null && core.harvester.hasBeenDestroyed) continue;
        if ((core.readyDate ?? 0) > now) continue; // the harvester is still being built
        const pens = takeFromPens(core, Math.max(Math.min(core.waiting, 1_000_000), (core.waiting * P.coreProcessPct(galaxy)) / 100));
        const own = drainCoreWorld(galaxy, core);
        core.processed += pens + own;
        people += pens + own;
    }
    if (people > 0) {
        st.popEliminated += people;
        st.stats.popDrained += people;
        st.stats.processed = (st.stats.processed ?? 0) + people;
        earn(galaxy, st, people);
    }
    troopPass(galaxy, st);
    spillTroops(galaxy, st);
    fuel.monthly.push(Math.round(fuel.income - before));
    if (fuel.monthly.length > 24) fuel.monthly.splice(0, fuel.monthly.length - 24);
    return people;
}

// ---------------------------------------------------------------------------------------------------------------
// Troops: the garrisons
// ---------------------------------------------------------------------------------------------------------------

/** A held world is threatened: troops of another empire on its ground, or warships of a normal empire close by. */
function threatenedWorlds(galaxy: Galaxy, st: BeaconState, worlds: readonly Habitat[]): Set<Habitat> {
    const out = new Set<Habitat>();
    for (const h of worlds) if (h.invadingTroops !== null && h.invadingTroops.items.some((t) => t.empire !== st.faction)) out.add(h);
    for (const e of normalEmpires(galaxy, st.faction)) {
        for (const b of e.builtObjects) {
            if (b.hasBeenDestroyed || b.role !== BuiltObjectRole.Military || b.topSpeed <= 0) continue;
            for (const h of worlds) if (!out.has(h) && galaxy.calculateDistance(b.xpos, b.ypos, h.xpos, h.ypos) <= THREAT_RANGE) out.add(h);
        }
    }
    return out;
}

/** The garrison a held world should have (beaconGarrison; a core's and a threatened world's are raised). Pure. */
export function garrisonTarget(galaxy: Galaxy, st: BeaconState, h: Habitat, threatened: boolean): number {
    let t = P.garrisonStrength(galaxy);
    if (isCore(st, h)) t = (t * P.coreGarrisonPct(galaxy)) / 100;
    if (threatened) t = (t * P.threatGarrisonPct(galaxy)) / 100;
    return t;
}

/**
 * Monthly: biofuel raises Thrall regiments where the garrisons are short: threatened worlds first, then the cores, then the rest (by how
 * short they are). Paid from the troop account; none is free.
 */
export function troopPass(galaxy: Galaxy, st: BeaconState): number {
    const faction = st.faction!;
    const worlds = processingWorlds(st).map((r) => r.colony);
    if (worlds.length === 0) return 0;
    const threat = threatenedWorlds(galaxy, st, worlds);
    const rows = worlds.map((h) => {
        const target = garrisonTarget(galaxy, st, h, threat.has(h));
        const have = h.troops?.totalDefendStrength ?? 0;
        return { h, target, short: target - have, rank: (threat.has(h) ? 0 : isCore(st, h) ? 1 : 2) };
    });
    rows.sort((a, b) => a.rank - b.rank || b.short / Math.max(1, b.target) - a.short / Math.max(1, a.target) || a.h.habitatIndex - b.h.habitatIndex);
    let raised = 0;
    for (const r of rows) {
        // over 1.6 x its target with no landing under way (the spare troops of the strike groups land as garrisons): the surplus goes home,
        // or no empire could ever retake the world
        if (-r.short > r.target * 0.6 && !threat.has(r.h)) trimGarrison(r.h, r.target * 1.25);
        if (r.short < r.target * 0.1) continue;
        const buy = Math.min(r.short, troopsAffordable(galaxy, st));
        if (buy < 20_000) break;
        const regs = Math.max(1, Math.round((P.garrisonRegiments(galaxy) * buy) / Math.max(1, P.garrisonStrength(galaxy))));
        const race = (r.h.population?.dominantRace ?? null) as Race | null;
        r.h.troops ??= new TroopList();
        for (const t of makeTroopsSplit(galaxy, faction, buy, regs, T('Beacon Thrall Name'), race)) {
            t.colony = r.h;
            r.h.troops.add(t);
        }
        payTroops(galaxy, st, buy);
        raised += regs;
    }
    st.stats.troopRegiments = (st.stats.troopRegiments ?? 0) + raised;
    return raised;
}

// ---------------------------------------------------------------------------------------------------------------
// Troops for the landings: from the nearest core
// ---------------------------------------------------------------------------------------------------------------

/** Removes regiments (the last first) until the garrison's defence is at most `to` (at least one regiment stays). */
function trimGarrison(h: Habitat, to: number): void {
    const list = h.troops;
    if (list === null) return;
    for (let i = list.items.length - 1; i > 0 && list.totalDefendStrength > to; i--) {
        const t = list.items[i];
        const e = t.empire as Empire | null;
        if (e !== null && e.troops != null) e.troops.remove(t);
        list.remove(t);
    }
}

/** The live, working core nearest (x, y) (null: none). */
export function troopSourceCore(galaxy: Galaxy, st: BeaconState, x: number, y: number): CoreRec | null {
    let best: CoreRec | null = null;
    let bd = Infinity;
    for (const c of liveCores(st)) {
        if (c.harvester !== null && c.harvester.hasBeenDestroyed) continue;
        const d = galaxy.calculateDistance(x, y, c.colony.xpos, c.colony.ypos);
        if (d < bd) {
            bd = d;
            best = c;
        }
    }
    return best;
}

// ---------------------------------------------------------------------------------------------------------------
// The art (render only)
// ---------------------------------------------------------------------------------------------------------------

/** The Beacon's state for the art: the season's phase and dates, the launch moment, the station's damage. Pure. */
export function beaconArtInfo(galaxy: Galaxy, st: BeaconState): BeaconArtInfo {
    const now = galaxyStarDate(galaxy);
    const beacon = st.beacon;
    let stationDamage = 0;
    let stationShields = 0;
    if (beacon !== null && !beacon.hasBeenDestroyed) {
        const n = beacon.components?.count ?? 0;
        stationDamage = n > 0 ? Math.min(1, (beacon.damagedComponentCount ?? 0) / n) : 0;
        stationShields = beacon.shieldsCapacity > 0 ? Math.max(0, Math.min(1, beacon.currentShields / beacon.shieldsCapacity)) : 0;
    }
    const out: BeaconArtInfo = { phase: 'dormant', season: 0, phaseStart: 0, phaseEnd: 0, progress: 0, launchAt: 0, launched: 0, stationDamage, stationShields };
    if (st.phase === 'watching') return out;
    if (st.phase === 'ended' || st.beaconDestroyed || beacon === null || beacon.hasBeenDestroyed) {
        out.phase = 'dead';
        return out;
    }
    const s = st.season;
    if (s === null) {
        out.phase = 'awakening';
        out.phaseStart = st.completeDate;
        out.phaseEnd = st.completeDate + days(P.startDelayDays(galaxy));
    } else {
        out.phase = s.phase;
        out.season = s.n;
        out.phaseStart = s.phase === 'prep' ? s.prepStart ?? s.start : s.start;
        out.phaseEnd = s.end;
        out.launchAt = s.launchAt ?? (s.phase === 'prep' ? s.end : 0);
        out.launched = s.departed;
    }
    out.progress = out.phaseEnd > out.phaseStart ? Math.max(0, Math.min(1, (now - out.phaseStart) / (out.phaseEnd - out.phaseStart))) : 0;
    return out;
}

/** A cattle ship spools its hyperdrive beaconCattleSpoolFactor times as long as a warship (a huge hulk: it sits exposed at the world it leaves). */
export function registerHarvest(): void {
    registerScenarioQuery({
        id: 'beacon.cattleSpool',
        flag: BEACON_FLAG,
        query: 'hyperjumpSpoolFactor',
        run: (g, v, a) => {
            const st = peekBeaconState(g);
            if (st === null || st.cattle === undefined || st.cattle.length === 0 || a.ship.actualEmpire !== st.faction) return v;
            return st.cattle.some((c) => c.ship === a.ship) ? v * Math.max(1, P.cattleSpoolFactor(g)) : v;
        },
    });
}

void strengthOf;
