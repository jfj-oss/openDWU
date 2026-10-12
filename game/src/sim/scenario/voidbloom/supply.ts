// The Voidbloom War — supply (docs/VOIDBLOOM_WAR.md, user decisions 1, 8, 11): the Voidbloom worlds, the harvest, the
// deadly climate, labour convoys, garrisons and revolts, the AI's hunger for the worlds and the fallback starter (a rim
// cartel settles a world when no empire has). Not a port: every stock call is ported code (generateDesignFromSpec /
// generateNewBuiltObject / assignMission Transport as the Refugees add-on's convoys, generateNewTroop as Start.2.cs's
// troops, TakeOwnershipOfColony, MakeHabitatIntoColony, FindNearestAvailableFleet + ShipGroup.AssignMission).
//
// Rnd: galaxy.rnd only in this module's gated handlers (game start: the world picks; the 30-day tick: revolts; the
// yearly tick: the cartel's world). Queries never draw.

import { isPenalColony } from '../../slavery';
import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import type { BuiltObject } from '../../builtObject';
import type { Race } from '../../data/races';
import { HabitatCategoryType, HabitatType } from '../../types';
import { Cargo, ResourceRef, TroopList, TroopType } from '../../cargo';
import { Population, PopulationList } from '../../population';
import { recalculateEmpirePopulation } from '../../taxes';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { generateDesignFromSpec } from '../../designGeneration';
import { generateNewBuiltObject } from '../../empireEvents';
import { assignMission } from '../../missions/assign';
import { BuiltObjectMissionPriority, BuiltObjectMissionType } from '../../missions/mission';
import { builtObjectCompleteTeardown } from '../../combat/teardown';
import { takeOwnershipOfColonyFull } from '../../combat/ownership';
import { makeHabitatIntoColonyRuntime } from '../../missions/cmdTroops';
import { calculateTroopMaintenanceMultiplier, generateNewTroop } from '../../builtObjectPlacement';
import { EmpireMessageType } from '../../messages';
import { galaxyStarDate } from '../../tick/simTime';
import { YEAR_LENGTH } from '../../galaxyTime';
import { findNearestAvailableFleet } from '../../fleets/militaryAI';
import { shipGroupAssignMission } from '../../fleets/shipGroup';
import { FleetPosture } from '../../diplomacyTick';
import { DiplomaticRelationType } from '../../diplomacy';
import { detPow } from '../../detMath';
import { GAME_DAY_LENGTH, gameYear, radiusFraction, registerScenarioEvent, registerScenarioGameStart, registerScenarioPeriodic, registerScenarioQuery, registerScenarioYearly } from '../hooks';
import { scenarioMessage, scenarioNews, scenarioText } from '../messages';
import { registerContraband, registerScenarioGoods } from '../scenarioGoods';
import { rimTraderEmpire } from '../rimTrade/common';
import {
    VOIDBLOOM_FLAG,
    VOIDBLOOM_GOOD,
    addHistory,
    hasBloomTech,
    bloomWorldOf,
    concord,
    fmt,
    isHuman,
    isNormal,
    normalEmpires,
    peekVbState,
    vbEmpire,
    vbOn,
    vbParam,
    vbState,
    voidbloomId,
    voidbloomStock,
    removeVoidbloom,
    type BloomWorld,
    type LabourConvoy,
} from './common';

// Galaxy generation draws the same with and without the add-on (galaxy.ts generateRandomOrderedResources).
registerScenarioGoods([VOIDBLOOM_GOOD]);
registerContraband([VOIDBLOOM_GOOD]);

/** Most Voidbloom a colony stockpiles (units); the harvest stops above it. */
export const STOCK_CAP = 4000;
/** Population floor of a Voidbloom world (the climate never empties it). */
const POP_FLOOR = 1_000_000;
const PERIOD_DAYS = 30;

const BLOOM_TYPES: readonly HabitatType[] = [HabitatType.MarshySwamp, HabitatType.Volcanic, HabitatType.Desert, HabitatType.Ice, HabitatType.Ocean, HabitatType.Continental];

// ---------------------------------------------------------------------------------------------------------------
// Game start: the worlds
// ---------------------------------------------------------------------------------------------------------------

/** The rim planets that may become Voidbloom worlds (fixed habitat order). Pure. */
function candidates(galaxy: Galaxy): Habitat[] {
    const inner = vbParam(galaxy, 'voidbloomRimInner');
    const r = rimTraderEmpire(galaxy);
    const concordSystems = new Set<number>((r?.colonies ?? []).map((c) => c.systemIndex));
    const out: Habitat[] = [];
    for (const h of galaxy.habitats) {
        if (h === null || h.hasBeenDestroyed || h.category !== HabitatCategoryType.Planet || !BLOOM_TYPES.includes(h.type)) continue;
        if (h.empire !== null || (h.population?.totalAmount ?? 0) > 0 || concordSystems.has(h.systemIndex)) continue;
        if (radiusFraction(galaxy, h.xpos, h.ypos) < inner) continue;
        out.push(h);
    }
    return out;
}

/** Picks the Voidbloom worlds (game start; draws galaxy.rnd): spread out, swamps first. */
export function pickBloomWorlds(galaxy: Galaxy): Habitat[] {
    const st = vbState(galaxy);
    if (st.worlds.length > 0 || voidbloomId(galaxy) < 0) return st.worlds.map((w) => w.habitat);
    let want = Math.trunc(vbParam(galaxy, 'voidbloomWorlds'));
    if (want <= 0) want = Math.max(3, Math.round(galaxy.starCount / 140));
    const pool = candidates(galaxy);
    const minGap = galaxy.sectorSize * 5;
    const picked: Habitat[] = [];
    for (let pass = 0; pass < 2 && picked.length < want; pass++) {
        const list = pool.filter((h) => (pass === 0 ? h.type === HabitatType.MarshySwamp || h.type === HabitatType.Volcanic : true) && !picked.includes(h));
        // Fisher–Yates on galaxy.rnd (fixed list order in, so the picks follow the seed).
        for (let i = list.length - 1; i > 0; i--) {
            const j = galaxy.rnd.next(0, i + 1);
            const t = list[i];
            list[i] = list[j];
            list[j] = t;
        }
        for (const h of list) {
            if (picked.length >= want) break;
            if (picked.some((p) => galaxy.calculateDistance(p.xpos, p.ypos, h.xpos, h.ypos) < minGap)) continue;
            picked.push(h);
        }
    }
    for (const h of picked) {
        // Fertile spore soil: a quality the stock colonisation filter accepts (CivilianAI's quality >= 0.5 test).
        if (!(h.baseQuality >= 0.55)) h.baseQuality = 0.55;
        st.worlds.push({ habitat: h, burnedUntil: -1, produced: 0, revolts: 0, lastConvoy: -1, ownerSince: 0 });
    }
    return picked;
}

// ---------------------------------------------------------------------------------------------------------------
// The harvest and the climate
// ---------------------------------------------------------------------------------------------------------------

function popM(h: Habitat): number {
    return Math.max(0, h.population?.totalAmount ?? 0) / 1_000_000;
}

/** Units a world grows in 30 days now (0 unowned, occupied by the Concord or empty). Pure. */
export function worldYield(galaxy: Galaxy, w: BloomWorld): number {
    const h = w.habitat;
    if (h.hasBeenDestroyed || h.empire === null) return 0;
    if (h.empire === rimTraderEmpire(galaxy)) return 0; // the Concord holds it: the fields lie fallow
    // The supply gate: without the hostile-environment tech nobody can work the spore fields (independents — the rim
    // cartel, workers who rose — farm it the old way).
    if (h.empire !== galaxy.independentEmpire && !hasBloomTech(galaxy, h.empire)) return 0;
    const m = popM(h);
    if (m <= 0) return 0;
    let y = vbParam(galaxy, 'voidbloomYield') * detPow(m, vbParam(galaxy, 'voidbloomYieldExponent'));
    if (galaxyStarDate(galaxy) < w.burnedUntil) y *= vbParam(galaxy, 'voidbloomBurnYieldPct') / 100;
    return Math.max(0, Math.floor(y));
}

/** Troops a world needs to hold its forced workers down. Pure. */
export function garrisonNeeded(galaxy: Galaxy, h: Habitat): number {
    return Math.ceil(vbParam(galaxy, 'voidbloomGarrisonBase') + (vbParam(galaxy, 'voidbloomGarrisonPer10M') * popM(h)) / 10);
}

export function garrisonOf(h: Habitat): number {
    return h.troops?.count ?? 0;
}

/** Shrinks every population item by `share` (never below the floor in total). */
function shrinkPopulation(h: Habitat, share: number): number {
    const pop = h.population;
    if (pop === null || pop.totalAmount <= POP_FLOOR || share <= 0) return 0;
    const room = pop.totalAmount - POP_FLOOR;
    let lost = 0;
    for (const p of pop.items) {
        const cut = Math.min(Math.floor(p.amount * share), Math.max(0, room - lost));
        if (cut <= 0) continue;
        p.amount -= cut;
        lost += cut;
    }
    pop.recalculateTotalAmount();
    return lost;
}

function harvestWorld(galaxy: Galaxy, w: BloomWorld): void {
    const h = w.habitat;
    const owner = h.empire;
    if (owner === null || h.cargo === null) return;
    const id = voidbloomId(galaxy);
    const y = worldYield(galaxy, w);
    if (y > 0 && voidbloomStock(galaxy, h) < STOCK_CAP) {
        h.cargo.add(new Cargo(new ResourceRef(id), y, owner));
        w.produced += y;
        vbState(galaxy).stats.produced += y;
    }
    // The climate: a steady death toll, and the world kills off any crowd it cannot feed (migrants beyond 1.5 × the
    // labour target lose half the excess a month).
    let share = Math.min(0.95, vbParam(galaxy, 'voidbloomDeathPctYear') / 100) * (PERIOD_DAYS / 360);
    const total = h.population?.totalAmount ?? 0;
    const crowd = vbParam(galaxy, 'voidbloomLabourTarget') * 1_500_000;
    if (total > crowd) share = Math.max(share, (0.5 * (total - crowd)) / total);
    if (shrinkPopulation(h, share) > 0 && owner !== galaxy.independentEmpire) recalculateEmpirePopulation(owner);
}

// ---------------------------------------------------------------------------------------------------------------
// Garrisons and revolts
// ---------------------------------------------------------------------------------------------------------------

/** One garrison levy: a troop raised at the world (state money). Returns true when raised. */
export function levyGarrison(galaxy: Galaxy, e: Empire, h: Habitat): boolean {
    const cost = vbParam(galaxy, 'voidbloomGarrisonCost');
    const race = e.dominantRace;
    if (race === null || e.stateMoney < cost) return false;
    if (h.troops === null) h.troops = new TroopList();
    const troop = generateNewTroop(e.generateTroopDescription(), TroopType.Infantry, race.troopStrength, e, race);
    troop.maintenanceMultiplier = calculateTroopMaintenanceMultiplier(race);
    troop.pictureRef = race.pictureIndex;
    troop.colony = h;
    troop.readiness = 100;
    h.troops.add(troop);
    e.troops.add(troop);
    e.stateMoney -= cost;
    vbEmpire(galaxy, e).levies++;
    vbState(galaxy).stats.levies++;
    return true;
}

/** The workers rise when the garrison is short (draws galaxy.rnd once per short world). */
function revoltCheck(galaxy: Galaxy, w: BloomWorld): void {
    const h = w.habitat;
    const owner = h.empire;
    // A world the Concord holds lies fallow: no forced workers left to rise.
    if (!isNormal(galaxy, owner) || galaxy.independentEmpire === null || owner === rimTraderEmpire(galaxy)) return;
    const need = garrisonNeeded(galaxy, h);
    const have = garrisonOf(h);
    if (have >= need) return;
    const chance = (vbParam(galaxy, 'voidbloomRevoltPct') / 100) * ((need - have) / need);
    if (!(galaxy.rnd.nextDouble() < chance)) return;
    // The workers overrun the guards and hold the world for themselves (an independent colony; they keep the stock).
    w.revolts++;
    vbState(galaxy).stats.revolts++;
    takeOwnershipOfColonyFull(galaxy, owner, h, galaxy.independentEmpire, false, true);
    scenarioMessage(galaxy, owner, scenarioText('Voidbloom Revolt Title'), scenarioText('Voidbloom Revolt', h.name, have, need), { type: EmpireMessageType.GeneralBadEvent, subject: h, popup: true });
    scenarioNews(galaxy, owner, scenarioText('Voidbloom Revolt News', h.name, owner.name), (x) => x !== owner, h);
    addHistory(galaxy, scenarioText('Voidbloom History Revolt', h.name, owner.name, gameYear(galaxyStarDate(galaxy))));
}

// ---------------------------------------------------------------------------------------------------------------
// Labour convoys (the Refugees add-on's population convoys: a passenger ship on a Transport mission)
// ---------------------------------------------------------------------------------------------------------------

function passengerSpec(e: Empire): import('../../data/designSpecifications').DesignSpecification | null {
    for (const s of e.designSpecifications) if (s !== null && s.subRole === BuiltObjectSubRole.PassengerShip) return s;
    return null;
}

/** The colony and race a convoy draws its workers from: penal colonies first, then conquered peoples, then the empire's own. Pure. */
export function labourSource(galaxy: Galaxy, e: Empire, world: Habitat, amount: number): { colony: Habitat; race: Race } | null {
    let best: { colony: Habitat; race: Race; score: number } | null = null;
    for (const c of e.colonies) {
        if (c.hasBeenDestroyed || c === world || bloomWorldOf(galaxy, c) !== null || c.population === null) continue;
        if (c.population.totalAmount < amount * 3) continue;
        for (const p of c.population.items) {
            if (p.amount < amount * 1.5) continue;
            const conquered = p.race !== e.dominantRace;
            // "Allow slavery" (slavery.ts): a penal colony's chained workers are sent first.
            const score = (c.slavery !== undefined && isPenalColony(c) ? 2e13 : 0) + (conquered ? 1e13 : 0) + p.amount;
            if (best === null || score > best.score || (score === best.score && c.habitatIndex < best.colony.habitatIndex)) best = { colony: c, race: p.race, score };
        }
    }
    return best === null ? null : { colony: best.colony, race: best.race };
}

/** Sends a labour convoy to `world` (player order or AI). False when no source, ship design or money. */
export function sendLabourConvoy(galaxy: Galaxy, e: Empire, world: Habitat): boolean {
    if (!vbOn(galaxy) || world.empire !== e || bloomWorldOf(galaxy, world) === null || galaxy.independentEmpire === null) return false;
    const amount = Math.trunc(vbParam(galaxy, 'voidbloomConvoySize') * 1_000_000);
    const cost = vbParam(galaxy, 'voidbloomConvoyCost');
    if (e.stateMoney < cost) return false;
    const src = labourSource(galaxy, e, world, amount);
    if (src === null) return false;
    const design = generateDesignFromSpec(galaxy, e, passengerSpec(e), 3.0, galaxyStarDate(galaxy));
    if (design === null) return false;
    const item = src.colony.population!.items.find((p) => p.race === src.race);
    if (item === undefined) return false;
    item.amount -= amount;
    src.colony.population!.recalculateTotalAmount();
    recalculateEmpirePopulation(e);
    e.stateMoney -= cost;
    const ship = generateNewBuiltObject(galaxy, galaxy.independentEmpire, design, src.colony);
    ship.name = scenarioText('Voidbloom Convoy Name', e.name);
    ship.population = new PopulationList();
    ship.population.add(new Population(src.race, amount, galaxy));
    ship.population.recalculateTotalAmount();
    const missionPopulation = new PopulationList();
    missionPopulation.add(new Population(src.race, amount, galaxy));
    assignMission(galaxy, ship, BuiltObjectMissionType.Transport, src.colony, world, BuiltObjectMissionPriority.Normal, { population: missionPopulation });
    const st = vbState(galaxy);
    st.convoys.push({ ship, world, empireId: e.empireId, raceName: src.race.name, amount, stage: 'sea' });
    const r = vbEmpire(galaxy, e);
    r.convoys++;
    r.labour += amount;
    st.stats.convoys++;
    const w = bloomWorldOf(galaxy, world);
    if (w !== null) w.lastConvoy = galaxyStarDate(galaxy);
    if (isHuman(galaxy, e)) scenarioMessage(galaxy, e, scenarioText('Voidbloom Convoy Title'), scenarioText('Voidbloom Convoy Sent', fmt(amount), src.race.name, src.colony.name, world.name), { subject: ship, popup: false });
    return true;
}

function convoyOf(galaxy: Galaxy, bo: BuiltObject): LabourConvoy | null {
    const st = peekVbState(galaxy);
    if (st === null) return null;
    for (const c of st.convoys) if (c.ship === bo) return c;
    return null;
}

/** cmdLoad hook: labour convoys are pre-loaded (the workers left their colony when it sailed), as refugee convoys. */
export function labourConvoySkipLoad(galaxy: Galaxy, bo: BuiltObject): boolean {
    if (!vbOn(galaxy)) return false;
    const c = convoyOf(galaxy, bo);
    return c !== null && c.stage === 'sea';
}

/** cmdUnload hook (before bo.population is cleared): the stock unload has settled the workers; count the arrival. */
export function settleLabourConvoyArrival(galaxy: Galaxy, bo: BuiltObject, dockedAt: unknown): void {
    if (!vbOn(galaxy)) return;
    const c = convoyOf(galaxy, bo);
    if (c === null || c.stage !== 'sea') return;
    c.stage = dockedAt === c.world ? 'done' : 'lost';
}

/** Convoys at sea that sank count as lost; settled ones are torn down (outside the docking command loop). */
function convoySweep(galaxy: Galaxy): void {
    const st = vbState(galaxy);
    for (const c of [...st.convoys]) {
        if (c.stage === 'sea' && c.ship.hasBeenDestroyed) c.stage = 'lost';
        if (c.stage === 'sea') continue;
        if (c.stage === 'done') {
            st.stats.convoysArrived = (st.stats.convoysArrived ?? 0) + 1;
            st.stats.workersArrived = (st.stats.workersArrived ?? 0) + c.amount;
        }
        if (c.stage === 'lost') {
            st.stats.convoysLost++;
            const e = galaxy.empires.find((x) => x !== null && x.empireId === c.empireId) ?? null;
            if (e !== null) vbEmpire(galaxy, e).convoysLost++;
        }
        st.convoys.splice(st.convoys.indexOf(c), 1);
        if (!c.ship.hasBeenDestroyed) builtObjectCompleteTeardown(galaxy, c.ship);
    }
}

/** Workers aboard convoys heading for `world` (people). Pure. */
export function labourAtSea(galaxy: Galaxy, world: Habitat): number {
    let n = 0;
    for (const c of peekVbState(galaxy)?.convoys ?? []) if (c.world === world && c.stage === 'sea') n += c.amount;
    return n;
}

/** The automatic upkeep of a world (AI, and the player's when its automation is on): convoys and levies. */
function upkeep(galaxy: Galaxy, w: BloomWorld): void {
    const h = w.habitat;
    const e = h.empire;
    if (!isNormal(galaxy, e) || e === rimTraderEmpire(galaxy)) return;
    const r = vbEmpire(galaxy, e);
    const human = isHuman(galaxy, e);
    if (!human || r.autoGarrison) {
        // Up to three troops a month until the garrison is full (a new world fills fast with migrants and convoys).
        const need = garrisonNeeded(galaxy, h) + 1;
        for (let i = 0; i < 3 && garrisonOf(h) < need; i++) if (!levyGarrison(galaxy, e, h)) break;
    }
    if (!human || r.autoLabour) {
        const now = galaxyStarDate(galaxy);
        const target = vbParam(galaxy, 'voidbloomLabourTarget') * 1_000_000;
        const due = w.lastConvoy < 0 || now - w.lastConvoy >= vbParam(galaxy, 'voidbloomConvoyDays') * GAME_DAY_LENGTH;
        if (due && (h.population?.totalAmount ?? 0) + labourAtSea(galaxy, h) < target) sendLabourConvoy(galaxy, e, h);
    }
}

export function supplyTick(galaxy: Galaxy): void {
    const st = vbState(galaxy);
    convoySweep(galaxy);
    for (const w of st.worlds) {
        if (w.habitat.hasBeenDestroyed) continue;
        harvestWorld(galaxy, w);
        upkeep(galaxy, w);
        revoltCheck(galaxy, w);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// The fallback starter (decision 11): a rim cartel settles a world when no empire grows Voidbloom
// ---------------------------------------------------------------------------------------------------------------

function cartelRace(galaxy: Galaxy): Race | null {
    const byName = (n: string): Race | null => galaxy.races?.find((r) => r.name === n) ?? null;
    const herder = byName('Ossuvan');
    if (herder !== null) return herder;
    for (const h of galaxy.habitats) if (h !== null && h.empire === galaxy.independentEmpire && h.population !== null && h.population.dominantRace !== null) return h.population.dominantRace;
    return galaxy.empires.find((e) => e !== null && e.dominantRace !== null && e !== rimTraderEmpire(galaxy))?.dominantRace ?? null;
}

/**
 * Yearly: once the supply gate has stood open voidbloomFallbackYear years (some empire holds the hostile-environment
 * tech, or the independents reached it themselves) and still no colony works any world, a rim cartel settles one
 * (draws galaxy.rnd). No fixed year: the cartel follows the galaxy's research.
 */
export function fallbackStarter(galaxy: Galaxy, year: number): void {
    const st = vbState(galaxy);
    const fy = vbParam(galaxy, 'voidbloomFallbackYear');
    if (st.cartel !== null || fy < 0 || galaxy.independentEmpire === null) return;
    const now = galaxyStarDate(galaxy);
    if (st.gateOpened === undefined || st.gateOpened < 0) {
        if (!normalEmpires(galaxy).some((e) => e !== rimTraderEmpire(galaxy) && hasBloomTech(galaxy, e)) && !hasBloomTech(galaxy, galaxy.independentEmpire)) return;
        st.gateOpened = now;
    }
    if (now - st.gateOpened < fy * YEAR_LENGTH) return;
    if (st.worlds.some((w) => w.habitat.empire !== null && !w.habitat.hasBeenDestroyed)) return;
    const free = st.worlds.filter((w) => w.habitat.empire === null && !w.habitat.hasBeenDestroyed);
    const race = cartelRace(galaxy);
    if (free.length === 0 || race === null) return;
    const w = free[galaxy.rnd.next(0, free.length)];
    const ind = galaxy.independentEmpire;
    makeHabitatIntoColonyRuntime(galaxy, ind, w.habitat, ind, race, 30_000_000);
    st.cartel = w.habitat;
    st.starter = st.starter === '' ? 'cartel' : st.starter;
    scenarioNews(galaxy, null, scenarioText('Voidbloom Cartel News', w.habitat.name), () => true, w.habitat);
    addHistory(galaxy, scenarioText('Voidbloom History Cartel', w.habitat.name, year));
}

// ---------------------------------------------------------------------------------------------------------------
// The AI wants the worlds badly (decision 8)
// ---------------------------------------------------------------------------------------------------------------

/** colonizationTargetValue: a Voidbloom world is worth voidbloomColonyValue × its stock value (never less than 1000). */
function colonyValue(galaxy: Galaxy, v: number, a: { empire: Empire; habitat: Habitat }): number {
    if (!vbOn(galaxy) || bloomWorldOf(galaxy, a.habitat) === null || a.empire === rimTraderEmpire(galaxy)) return v;
    // The supply gate: a deadly world is no colony target before the empire holds the hostile-environment tech.
    if (!hasBloomTech(galaxy, a.empire)) return -1;
    // Independents settle one only as the rim cartel would: once the gate has stood open voidbloomFallbackYear years.
    if (a.empire === galaxy.independentEmpire) {
        const st = vbState(galaxy);
        if (st.gateOpened === undefined || st.gateOpened < 0 || galaxyStarDate(galaxy) - st.gateOpened < vbParam(galaxy, 'voidbloomFallbackYear') * YEAR_LENGTH) return -1;
    }
    return Math.max(v * vbParam(galaxy, 'voidbloomColonyValue'), 1000);
}

/** Yearly: an AI empire at war with a world's holder sends a fleet against it; one held by independents is a target too. */
export function aiConquestYear(galaxy: Galaxy): number {
    const st = vbState(galaxy);
    const r = rimTraderEmpire(galaxy);
    let n = 0;
    for (const e of normalEmpires(galaxy)) {
        if (isHuman(galaxy, e) || e === r) continue;
        for (const w of st.worlds) {
            const h = w.habitat;
            const owner = h.empire;
            if (h.hasBeenDestroyed || owner === null || owner === e) continue;
            const rel = owner === galaxy.independentEmpire ? null : e.diplomaticRelations.byEmpire(owner);
            const atWar = rel !== null && rel.type === DiplomaticRelationType.War;
            // Independent holders (the cartel, revolted workers): within 25 sectors of the empire's capital.
            const near = owner === galaxy.independentEmpire && e.capital !== null && galaxy.calculateDistance(e.capital.xpos, e.capital.ypos, h.xpos, h.ypos) < 25 * galaxy.sectorSize;
            if (!atWar && !near) continue;
            const fleet = findNearestAvailableFleet(galaxy, e, h.xpos, h.ypos, BuiltObjectMissionPriority.Low, 0, FleetPosture.Attack, true, 0.1, false, false, false, true, 40000);
            if (fleet === null || fleet.leadShip === null) continue;
            if (shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.Attack, h, null, BuiltObjectMissionPriority.High, false)) n++;
            break;
        }
    }
    return n;
}

function onOwnerChanged(galaxy: Galaxy, p: { colony: Habitat; from: Empire | null; to: Empire | null }): void {
    const w = bloomWorldOf(galaxy, p.colony);
    if (w === null) return;
    w.ownerSince = galaxyStarDate(galaxy);
    const to = p.to;
    if (isNormal(galaxy, to) && to !== concord(galaxy)) {
        const r = vbEmpire(galaxy, to);
        // A new Voidbloom grower: the AI decides its policy at the next yearly review; tell the human.
        if (isHuman(galaxy, to)) scenarioMessage(galaxy, to, scenarioText('Voidbloom World Title'), scenarioText('Voidbloom World Gained', p.colony.name, garrisonNeeded(galaxy, p.colony)), { type: EmpireMessageType.GeneralNeutralEvent, subject: p.colony, popup: true });
        void r;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Registrations
// ---------------------------------------------------------------------------------------------------------------

/** Game start: no Voidbloom anywhere but on its worlds (the Ancient Guardians' capital starts with every resource). */
function clearStartingStock(galaxy: Galaxy): void {
    for (const h of galaxy.habitats) if (h !== null && h.cargo !== null) removeVoidbloom(galaxy, h);
    for (const e of [...galaxy.empires, ...galaxy.pirateEmpires]) for (const b of [...(e?.builtObjects ?? []), ...(e?.privateBuiltObjects ?? [])]) if (b !== null && b.cargo !== null) removeVoidbloom(galaxy, b);
}

registerScenarioGameStart({
    id: 'voidbloom.worlds',
    flag: VOIDBLOOM_FLAG,
    order: 50,
    run: (g) => {
        clearStartingStock(g);
        pickBloomWorlds(g);
    },
});
registerScenarioPeriodic({ id: 'voidbloom.supply', flag: VOIDBLOOM_FLAG, periodDays: PERIOD_DAYS, run: (g) => supplyTick(g) });
registerScenarioYearly({
    id: 'voidbloom.supply.year',
    flag: VOIDBLOOM_FLAG,
    order: 40,
    run: (g, y) => {
        fallbackStarter(g, y);
        aiConquestYear(g);
    },
});
registerScenarioQuery({ id: 'voidbloom.colonyValue', flag: VOIDBLOOM_FLAG, query: 'colonizationTargetValue', run: colonyValue });
// The climate: nobody is born on a Voidbloom world (growth runs against a cap of the people already there).
registerScenarioQuery({
    id: 'voidbloom.noGrowth',
    flag: VOIDBLOOM_FLAG,
    query: 'colonyMaxPopulation',
    run: (g, v, a) => (bloomWorldOf(g, a.habitat) !== null ? Math.min(v, a.habitat.population?.totalAmount ?? 0) : v),
});
registerScenarioEvent({ id: 'voidbloom.ownerChanged', flag: VOIDBLOOM_FLAG, event: 'colonyOwnerChanged', run: onOwnerChanged });
