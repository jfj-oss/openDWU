// The Beacon, part 2: the Reclamation (Giantworks wonder, flag gwBeacon). Not a port: new scenario behaviour composed of ported
// functions (each composed step cites its stock analogue). Registered from beacon.ts; every handler is gated by the gwBeacon flag.
//
// When the Beacon is finished (beacon.ts onComplete → startReclamation) the machine faction (one empire: "the Watchers" before,
// "the Reclaimers" from now on) wages campaign SEASONS:
//   PREPARATION (4-6 months): waves spawn at the Beacon and fly to 2-3 deep-space STAGING POINTS, one strike group per target
//     world; the staging fleets can be seen by any empire whose sensors reach them (a Threats & Leads row) and can be hit, which
//     thins the season. Troops for each group: Thrall regiments from the processing worlds' pools (carried by transports that
//     fly from the world to the staging point, so they can be intercepted), the rest BattleBots made at the Beacon.
//   OFFENSIVE: every strike group DEPARTS ON THE SAME DAY toward its own target; arrivals and landings are not simultaneous.
//     The season runs until the groups have arrived and fought (their travel time, 90 to 360 days). A group lands its troops
//     (invadeFromInside: the stock ground war decides) only once its escort holds the orbit and the troops beat the defence by
//     the margin; a failed landing raises the margin and brings a reinforcing transport; a long siege of a world the troops
//     cannot take ends, rarely, in a planet strike (the stock planet destroyer, as the Purifier's).
//   QUIET (about a year): only raids by pairs of ships.
// THE HARVEST (beaconHarvest.ts): the conquered worlds' people are carried in cattle ships to harvest cores and rendered into biofuel,
// which pays for the troops (Thrall regiments made at the nearest core) and, by the funding model (beaconFundingModel), the fleets.
// Retaking a world stops its harvest; retaking a core (or destroying its harvester) frees its pens.
// Corrupted worlds (beacon.ts) rise from inside at the start of an offensive (invadeFromInside).
// LOSS: the game is lost when the Reclaimers have ELIMINATED beaconLossPct % of the galaxy's population (drained or destroyed,
// against the population when the Reclamation began).
//
// Rnd: this module's decisions use the private beaconRandom; the stock functions it calls (ship, design, troop generation)
// draw galaxy.rnd. Fixed iteration orders: seasons, groups, ships in list order, galaxy.empires order.

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { Design } from '../../../design';
import type { BuiltObject } from '../../../builtObject';
import type { Habitat } from '../../../types';
import type { Race } from '../../../data/races';
import { BuiltObjectSubRole } from '../../../builtObjectTypes';
import { ComponentType } from '../../../data/components';
import { BattleTactics, BuiltObjectFleeWhen, BuiltObjectRole } from '../../../data/designSpecifications';
import { EmpireMessageType } from '../../../messages';
import { galaxyStarDate } from '../../../tick/simTime';
import { generateNewBuiltObject } from '../../../empireEvents';
import { createNewDesigns, generateDesignFromSpec, generatePlanetDestroyerDesign } from '../../../designGeneration';
import { galaxyDesignSpecificationBySubRole } from '../../../gameStartTail';
import { takeOwnershipOfBuiltObject } from '../../../combat/ownership';
import { builtObjectCompleteTeardown } from '../../../combat/teardown';
import { canDestroyHabitat } from '../../../combat/attackAI';
import { calculateOverallStrengthFactorWithoutShields, militaryPotency } from '../../../diplomacyTick';
import { isObjectVisibleToThisEmpire } from '../../../independentTraders';
import { assignMission } from '../../../missions/assign';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../../../missions/mission';
import { shipGroupAssignMission, type ShipGroup } from '../../../fleets/shipGroup';
import { designsFindNewestCanBuild } from '../../../stationPlacement';
import { TroopList } from '../../../cargo';
import { isHumanEmpire } from '../../../humanEmpires';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../../../diplomacy';
import { GAME_DAY_LENGTH } from '../../hooks';
import { GameEndOutcome } from '../../../victory';
import { empireTechLevel, maxDesignTechLevel, raiseFactionTech } from '../robotMutiny';
import { averageTechLevel } from '../factionNavy';
import { makeTroopOfStrength, makeTroopsSplit } from '../factionNavy';
import { genShipsAssaultStrengths, genShipsAssaultWins } from '../generationShips';
import {
    KNOWLEDGE_CONFIRMED,
    arcMessage,
    arcNews,
    invadeFromInside,
    knowledgeLevel,
    loadTroopsOnto,
    lockWar,
    normalEmpires,
    revealTo,
    threatGameEnd,
} from '../framework';
import {
    BEACON_CODE_LOST,
    P,
    SYSTEM_RADIUS,
    activeCorruption,
    aliveShips,
    beaconPosition,
    beaconRandom,
    salvageStepsOf,
    type BeaconState,
    type ProcessRec,
    type Season,
    type StagingPoint,
    type StrikeGroup,
} from './beaconState';
import { scenarioText as T } from '../../messages';
import { freeShare, fuelOf, harvestMonthly, harvestPeriodic, onCattleKilled, onCoreRetaken, onHarvesterLost, payFleet, payTroops, troopSourceCore, troopsAffordable } from './beaconHarvest';

const TAG = 'Beacon';
/** A fleet this close to a target is "on station"; defenders this close block a landing. */
const STATION_RANGE = 8000;
/** Warships engage from their weapons range: a group this close to its target has arrived and counts as on station. */
const ENGAGE_RANGE = 24000;
/** Transports this close to the target land. */
const LANDING_RANGE = 3000;
/** Staging gather radius. */
const GATHER_RANGE = 25000;
/** Units per game day of a warp-speed-1 ship (YEAR 600 s, 360 days): speed is units per game second. */
const SECONDS_PER_DAY = 600 / 360;
const WAVE_PER_PASS = 14;

// ---------------------------------------------------------------------------------------------------------------
// The faction, its tech and designs
// ---------------------------------------------------------------------------------------------------------------

/** The machine race: Mechanoid when the galaxy has it (the Purifier's fallback too), else the first race. */
export function machineRace(galaxy: Galaxy): Race | null {
    return galaxy.races.find((r) => r !== null && r.name === 'Mechanoid') ?? galaxy.races.find((r) => r !== null) ?? null;
}

/** Tech of the Reclaimers' ships: the galaxy's average + 1 (the Watchers: + beaconWatcherTechBonus), within the generator's range. */
export function reclaimerLevel(galaxy: Galaxy, faction: Empire | null, bonus = 1): number {
    const avg = faction !== null ? averageTechLevel(galaxy, faction) : 1;
    const max = maxDesignTechLevel(galaxy);
    const lvl = Math.max(1, Math.trunc(avg + bonus));
    return max > 0 ? Math.min(lvl, max) : lvl;
}

/** Raises the faction's research to `lvl` and regenerates its designs when that changed anything. Returns true if raised. */
export function syncReclaimerTech(galaxy: Galaxy, faction: Empire, lvl: number, force = false): boolean {
    if (empireTechLevel(faction) >= lvl && !force) return false;
    raiseFactionTech(galaxy, faction, lvl);
    const now = galaxyStarDate(galaxy);
    createNewDesigns(galaxy, faction, now, now, true);
    return true;
}

/** The faction's newest design for `sub` (generated from the sub-role's template when it has none). */
export function designFor(galaxy: Galaxy, faction: Empire, sub: BuiltObjectSubRole): Design | null {
    const found = designsFindNewestCanBuild(faction.designs, sub);
    if (found !== null && !found.isPlanetDestroyer) return found;
    const spec = faction.designSpecifications.find((s) => s !== null && s.subRole === sub) ?? galaxyDesignSpecificationBySubRole(sub);
    if (spec === null || spec === undefined) return null;
    try {
        const d = generateDesignFromSpec(galaxy, faction, spec, Math.max(1, empireTechLevel(faction)), galaxyStarDate(galaxy));
        if (d !== null && !faction.designs.includes(d)) faction.designs.push(d);
        return d;
    } catch {
        return null;
    }
}

/**
 * Plating: copies of the best armour / shield part among `sources` adding about armourPct / shieldPct % of the design's size
 * (as Generation Ships' mothership), then the stock ReDefine. Pure apart from `d`.
 */
export function addPlating(d: Design, sources: readonly Design[], armourPct: number, shieldPct: number): void {
    let added = 0;
    for (const [type, pct] of [[ComponentType.Armor, armourPct], [ComponentType.Shields, shieldPct]] as const) {
        if (pct <= 0) continue;
        let part = null as (typeof d.components)[number] | null;
        for (const src of sources) {
            for (const c of src.components) {
                if (c.type === type && c.size > 0 && (part === null || c.value1 + c.value2 > part.value1 + part.value2)) part = c;
            }
        }
        if (part === null) continue;
        const n = Math.round((d.size * pct) / 100 / part.size);
        for (let i = 0; i < n; i++) d.components.push(part);
        added += n;
    }
    if (added > 0) d.reDefine();
}

// ---------------------------------------------------------------------------------------------------------------
// Ships
// ---------------------------------------------------------------------------------------------------------------

/** A Reclaimer ship of `design` at (x, y): GenerateNewBuiltObject + TakeOwnershipOfBuiltObject (as robotMutiny's beacon spawn), no upkeep, machine-fed. */
export function spawnShip(galaxy: Galaxy, faction: Empire, design: Design, x: number, y: number): BuiltObject {
    const pt = galaxy.selectRelativeParkingPoint();
    const bo = generateNewBuiltObject(galaxy, faction, design, null, x + pt.x, y + pt.y);
    takeOwnershipOfBuiltObject(galaxy, faction, bo, faction, false);
    bo.supportCostFactor = 0;
    bo.isAutoControlled = false;
    if (bo.fuelCapacity > 0) bo.currentFuel = bo.fuelCapacity;
    if (bo.role === BuiltObjectRole.Military) {
        // Machines do not retreat or stand off: the stock fleeWhen / tactics would send a battered group wandering off its target.
        bo.fleeWhen = BuiltObjectFleeWhen.Never;
        bo.tacticsStrongerShips = BattleTactics.AllWeapons;
        bo.tacticsWeakerShips = BattleTactics.AllWeapons;
    }
    return bo;
}

function strengthOf(bo: BuiltObject): number {
    return Math.max(0, calculateOverallStrengthFactorWithoutShields(bo));
}

function move(galaxy: Galaxy, bo: BuiltObject, x: number, y: number): void {
    const m = builtObjectMission(bo.mission);
    if (m !== null && m.type === BuiltObjectMissionType.Move && m.targetHabitat === null && m.targetBuiltObject === null && Math.abs(m.x - x) < 1 && Math.abs(m.y - y) < 1) return;
    bo.isAutoControlled = false;
    assignMission(galaxy, bo, BuiltObjectMissionType.Move, null, null, BuiltObjectMissionPriority.High, { x, y, manuallyAssigned: true });
}

function moveTo(galaxy: Galaxy, bo: BuiltObject, target: Habitat): void {
    const m = builtObjectMission(bo.mission);
    if (m !== null && m.type === BuiltObjectMissionType.Move && m.targetHabitat === target) return;
    bo.isAutoControlled = false;
    assignMission(galaxy, bo, BuiltObjectMissionType.Move, target, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
}

function attackOrder(galaxy: Galaxy, bo: BuiltObject, target: Habitat, done: Set<ShipGroup>): void {
    const sg = bo.shipGroup as ShipGroup | null;
    if (sg !== null && sg !== undefined) {
        if (done.has(sg)) return;
        done.add(sg);
        const m = sg.mission;
        if (m === null || m.type !== BuiltObjectMissionType.Attack || m.targetHabitat !== target) shipGroupAssignMission(galaxy, sg, BuiltObjectMissionType.Attack, target, null, BuiltObjectMissionPriority.High, true);
        return;
    }
    const m = builtObjectMission(bo.mission);
    if (m === null || m.type !== BuiltObjectMissionType.Attack || m.targetHabitat !== target) {
        // Not automated: the stock AI would fold an automated warship into a fleet of its own and send it elsewhere.
        bo.isAutoControlled = false;
        assignMission(galaxy, bo, BuiltObjectMissionType.Attack, target, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
    }
}

function patrol(galaxy: Galaxy, bo: BuiltObject, where: Habitat): void {
    const m = builtObjectMission(bo.mission);
    if (m !== null && m.type === BuiltObjectMissionType.Patrol && m.targetHabitat === where) return;
    bo.isAutoControlled = false;
    assignMission(galaxy, bo, BuiltObjectMissionType.Patrol, where, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
}

function distTo(galaxy: Galaxy, bo: { xpos: number; ypos: number }, x: number, y: number): number {
    return galaxy.calculateDistance(bo.xpos, bo.ypos, x, y);
}

/** Days a ship of this warp speed needs for `distance` (units). */
export function travelDays(speed: number, distance: number): number {
    return speed > 0 ? distance / (speed * SECONDS_PER_DAY) : 9999;
}

/** Machine-fed: every Reclaimer ship is topped up with fuel. */
function refuelAll(faction: Empire): void {
    for (const b of faction.builtObjects) if (!b.hasBeenDestroyed && b.fuelCapacity > 0 && b.currentFuel < b.fuelCapacity) b.currentFuel = b.fuelCapacity;
}

// ---------------------------------------------------------------------------------------------------------------
// The reference military and the season budget
// ---------------------------------------------------------------------------------------------------------------

/** The mean of the three strongest normal empires' militaryPotency (the Purifier's and Generation Ships' measure). */
export function referenceMilitary(galaxy: Galaxy, faction: Empire | null): number {
    const v = normalEmpires(galaxy, faction).map((e) => militaryPotency(e)).sort((a, b) => b - a).slice(0, 3);
    return v.length === 0 ? 0 : v.reduce((s, x) => s + x, 0) / v.length;
}

export function processingWorlds(st: BeaconState): ProcessRec[] {
    return st.processing.filter((r) => !r.colony.hasBeenDestroyed && r.colony.empire === st.faction);
}

/**
 * The SCRIPTED strength of season n: referenceMilitary x (k strike groups x (strengthPct + growth per season) + per processing
 * world), capped. strengthPct is PER GROUP (season 1) so a galaxy with more worlds to strike meets a bigger campaign. Pure.
 */
export function scriptedBudget(galaxy: Galaxy, st: BeaconState, n: number): number {
    const worlds = processingWorlds(st).length;
    const k = groupCountFor(galaxy, st, n);
    const pct = Math.min(P.strengthCapPct(galaxy), k * (P.strengthPct(galaxy) + P.strengthGrowthPct(galaxy) * (n - 1)) + P.strengthPerWorldPct(galaxy) * worlds);
    return Math.max(P.minSeasonStrength(galaxy), (referenceMilitary(galaxy, st.faction) * pct) / 100);
}

/**
 * The strength season n may spawn, by the funding model: 1 scripted (scriptedBudget); 0 harvest only (the fleet biofuel); 2 combined (the
 * trickle, beaconTricklePct % of the scripted, plus the fleet biofuel). Capped at beaconFuelCapPct % of the scripted strength. Pure.
 */
export function seasonBudget(galaxy: Galaxy, st: BeaconState, n: number): number {
    const s = scriptedBudget(galaxy, st, n);
    if (P.fundingModel(galaxy) === 1) return s;
    // biofuel raises a season to at most beaconFuelCapPct % of the scripted one (the rest stays banked for the next)
    const cap = (s * P.fuelCapPct(galaxy)) / 100;
    return Math.min(cap, s * freeShare(galaxy) + Math.max(0, fuelOf(st).fleet));
}

// ---------------------------------------------------------------------------------------------------------------
// Targets and staging points
// ---------------------------------------------------------------------------------------------------------------

/** A world's defence: its garrison plus the warships of its owner near it. Pure. */
export function defenceOf(galaxy: Galaxy, h: Habitat): number {
    let s = h.troops !== null ? h.troops.totalDefendStrength / 100 : 0;
    const owner = h.empire;
    if (owner !== null && owner !== galaxy.independentEmpire) {
        for (const b of owner.builtObjects) {
            if (b.hasBeenDestroyed || b.role !== BuiltObjectRole.Military || b.topSpeed <= 0) continue;
            if (galaxy.calculateDistance(b.xpos, b.ypos, h.xpos, h.ypos) <= 30000) s += strengthOf(b);
        }
    }
    return s;
}

function sparedOrAllied(st: BeaconState, e: Empire | null, now: number): boolean {
    if (e === null) return false;
    for (const b of st.bargains) if (b.empireId === e.empireId && !b.ended && (b.kind === 'protectorate' || b.until > now)) return true;
    return false;
}

/** Colonies the Reclaimers may strike: populated, not theirs, not corrupted, of an empire not spared or in their pocket. Pure. */
export function targetCandidates(galaxy: Galaxy, st: BeaconState, now: number): Habitat[] {
    const out: Habitat[] = [];
    const corrupt = new Set<Habitat>(activeCorruption(st).map((c) => c.colony));
    const take = (c: Habitat): void => {
        if (c.hasBeenDestroyed || c.population.totalAmount <= 0 || corrupt.has(c) || c.empire === st.faction) return;
        out.push(c);
    };
    for (const e of normalEmpires(galaxy, st.faction)) {
        if (sparedOrAllied(st, e, now)) continue;
        for (const c of e.colonies) take(c);
    }
    for (const c of galaxy.independentColonies) take(c);
    return out;
}

/** Regiments one group's transports can carry at most (beaconMaxTransports of them, a regiment is 100 of a transport's troop capacity). */
export function groupCarryRegiments(galaxy: Galaxy, faction: Empire): number {
    const d = transportDesign(galaxy, faction);
    if (d === null) return 0;
    return P.maxTransports(galaxy) * Math.max(1, Math.floor(d.troopCapacity / 100));
}

/** Troop strength one group's transports can carry at most (the regiments at their largest). */
export function groupCarryCapacity(galaxy: Galaxy, faction: Empire): number {
    return groupCarryRegiments(galaxy, faction) * P.regimentNatural(galaxy) * 100;
}

export interface LandingPlan {
    /** Total strength the landing needs to beat the defence by the margin (with a tenth to spare). */
    strength: number;
    /** Regiments it needs: the ground war's attrition is in readiness points taken from one random regiment per tick, so staying power is the NUMBER of regiments. */
    regiments: number;
}

/**
 * What a landing at `h` needs: the strength that beats its defence by `marginPct`, in at least as many regiments as the strength needs
 * at the regiment cap and beaconHpPct % of the defenders' regiments (the garrison and those recruiting, plus a couple to spare).
 */
export function landingPlan(galaxy: Galaxy, faction: Empire, h: Habitat, marginPct: number): LandingPlan {
    const strength = troopNeed(galaxy, faction, h, marginPct) * 1.1;
    const defenders = (h.troops?.count ?? 0) + (h.troopsToRecruit?.count ?? 0) + 2;
    const regiments = Math.max(1, Math.ceil(strength / (P.regimentNatural(galaxy) * 100)), Math.ceil((P.hpPct(galaxy) / 100) * defenders));
    return { strength, regiments };
}

/** True when the landing that beats `h` by the assault margin fits on one group's transports. */
function troopsFit(galaxy: Galaxy, st: BeaconState, h: Habitat): boolean {
    const faction = st.faction;
    if (faction === null) return false;
    const plan = landingPlan(galaxy, faction, h, P.assaultMarginPct(galaxy));
    return plan.regiments <= groupCarryRegiments(galaxy, faction);
}

export interface PickedTarget {
    habitat: Habitat;
    defence: number;
}

/**
 * The season's targets: up to `k`, at most one per empire until every empire has one (spread over the galaxy), weighted by
 * population and nearness to the Beacon and by how beatable the world is for a share of `budget`. Uses the private Random.
 */
export function pickTargets(galaxy: Galaxy, st: BeaconState, k: number, budget: number, now: number): PickedTarget[] {
    const pos = beaconPosition(st);
    if (pos === null) return [];
    const rnd = beaconRandom(galaxy, st, 11);
    const cands = targetCandidates(galaxy, st, now);
    if (cands.length === 0) return [];
    const share = budget / Math.max(1, k);
    const scored = cands.map((h) => {
        const def = defenceOf(galaxy, h);
        const d = galaxy.calculateDistance(pos.x, pos.y, h.xpos, h.ypos);
        const w = Math.pow(1 + h.population.totalAmount / 1e6, P.targetPopPct(galaxy) / 100) * (1 / (1 + d / 6e6)) * (1 / (1 + def / Math.max(1, share * 1.5)));
        return { habitat: h, defence: def, w };
    });
    const picked: PickedTarget[] = [];
    const usedOwners = new Set<Empire | null>();
    for (let pass = 0; pass < 2 && picked.length < k; pass++) {
        const pool = scored.filter((s) => !picked.some((p) => p.habitat === s.habitat) && (pass === 1 || !usedOwners.has(s.habitat.empire)));
        while (picked.length < k && pool.length > 0) {
            const total = pool.reduce((a, s) => a + s.w, 0);
            let r = rnd.nextDouble() * total;
            let idx = 0;
            for (; idx < pool.length - 1; idx++) {
                r -= pool[idx].w;
                if (r <= 0) break;
            }
            const s = pool.splice(idx, 1)[0];
            if (!troopsFit(galaxy, st, s.habitat)) continue; // more troops than a group's transports can carry: not a target for them
            picked.push({ habitat: s.habitat, defence: s.defence });
            usedOwners.add(s.habitat.empire);
            if (pass === 0) for (let i = pool.length - 1; i >= 0; i--) if (pool[i].habitat.empire === s.habitat.empire) pool.splice(i, 1);
        }
    }
    return picked;
}

function nearestStarDistance(galaxy: Galaxy, x: number, y: number): number {
    let best = Infinity;
    for (const sys of galaxy.systems) {
        const s = sys?.systemStar ?? null;
        if (s === null) continue;
        const d = galaxy.calculateDistance(x, y, s.xpos, s.ypos);
        if (d < best) best = d;
    }
    return best;
}

/**
 * Staging points: the targets are split by bearing from the Beacon into `count` clusters; each cluster's point lies in deep
 * space about 60 % of the way to its centroid (nudged off any system). Pure (no Rnd).
 */
export function stagingPointsFor(galaxy: Galaxy, st: BeaconState, targets: readonly Habitat[], count: number): { points: { x: number; y: number }[]; of: number[] } {
    const pos = beaconPosition(st)!;
    const idx = targets.map((_, i) => i).sort((a, b) => Math.atan2(targets[a].ypos - pos.y, targets[a].xpos - pos.x) - Math.atan2(targets[b].ypos - pos.y, targets[b].xpos - pos.x) || a - b);
    const n = Math.max(1, Math.min(count, targets.length));
    const of: number[] = new Array(targets.length).fill(0);
    const points: { x: number; y: number }[] = [];
    for (let c = 0; c < n; c++) {
        const chunk = idx.slice(Math.floor((c * idx.length) / n), Math.floor(((c + 1) * idx.length) / n));
        let cx = 0;
        let cy = 0;
        for (const i of chunk) {
            cx += targets[i].xpos;
            cy += targets[i].ypos;
            of[i] = c;
        }
        cx /= Math.max(1, chunk.length);
        cy /= Math.max(1, chunk.length);
        let x = pos.x + (cx - pos.x) * 0.6;
        let y = pos.y + (cy - pos.y) * 0.6;
        const dx = cx - pos.x;
        const dy = cy - pos.y;
        const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        for (let tries = 0; tries < 8 && nearestStarDistance(galaxy, x, y) < 3 * SYSTEM_RADIUS; tries++) {
            x += (dx / len) * 60000;
            y += (dy / len) * 60000;
        }
        x = Math.min(galaxy.sizeX - 1000, Math.max(1000, x));
        y = Math.min(galaxy.sizeY - 1000, Math.max(1000, y));
        points.push({ x, y });
    }
    return { points, of };
}

// ---------------------------------------------------------------------------------------------------------------
// Troops
// ---------------------------------------------------------------------------------------------------------------

/** Strength (the invasion measure) of the troops needed to beat `target` by `marginPct`, from a trial regiment (no Rnd beyond troop naming). Pure for the sim. */
export function troopNeed(galaxy: Galaxy, faction: Empire, target: Habitat, marginPct: number): number {
    const trial = makeTroopOfStrength(galaxy, faction, 1_000_000, 'trial', null);
    const s = genShipsAssaultStrengths(galaxy, target, faction, [trial]);
    if (!(s.attacking > 0)) return 0;
    // attacking = (what 1M of troops add) + the population's share on the attackers' side (a rising); defending = garrison + bonuses
    return Math.max(1_000_000, Math.ceil((s.defending * marginPct) / 100 / (s.attacking / 1_000_000)));
}

function transportDesign(galaxy: Galaxy, faction: Empire): Design | null {
    return designFor(galaxy, faction, BuiltObjectSubRole.TroopTransport);
}

function loadedStrength(bo: BuiltObject): number {
    return bo.troops === null ? 0 : bo.troops.totalAttackStrength;
}

/** Fills `transports` with `count` regiments sharing `strength` (BattleBots, or Thralls of `race`). Returns the strength and the regiments loaded. */
function loadSplit(galaxy: Galaxy, faction: Empire, transports: readonly BuiltObject[], strength: number, count: number, race: Race | null, name: string): { strength: number; regiments: number } {
    const troops = makeTroopsSplit(galaxy, faction, strength, count, name, race);
    let loaded = 0;
    let regiments = 0;
    let ti = 0;
    for (const t of troops) {
        let placed = false;
        for (let tries = 0; tries < transports.length && !placed; tries++) {
            const bo = transports[(ti + tries) % transports.length];
            if (bo.troopCapacityRemaining >= t.size) {
                loadTroopsOnto(bo, faction, [t]);
                loaded += t.attackStrength * (t.readiness / 100) * 1;
                regiments++;
                ti = (ti + tries + 1) % transports.length;
                placed = true;
            }
        }
        if (!placed) break;
    }
    return { strength: loaded, regiments };
}

/** The transports needed to carry `regiments` regiments. */
function transportsFor(galaxy: Galaxy, faction: Empire, regiments: number): number {
    const d = transportDesign(galaxy, faction);
    if (d === null) return 0;
    const per = Math.max(1, Math.floor(d.troopCapacity / 100));
    return Math.max(1, Math.ceil(regiments / per));
}

function loadedRegiments(bo: BuiltObject): number {
    return bo.troops === null ? 0 : bo.troops.count;
}

// ---------------------------------------------------------------------------------------------------------------
// Seasons
// ---------------------------------------------------------------------------------------------------------------

function days(n: number): number {
    return n * GAME_DAY_LENGTH;
}

function groupCountFor(galaxy: Galaxy, st: BeaconState, n: number): number {
    // one more group every two seasons, and more for a bigger galaxy: one per beaconGroupColonies colonies of the empires and independents
    // (0: one per eight empires, the original rule), so a big galaxy has more worlds struck at once
    const per = P.groupColonies(galaxy);
    let extra: number;
    if (per > 0) {
        let colonies = galaxy.independentColonies.length;
        for (const e of normalEmpires(galaxy, st.faction)) colonies += e.colonies.length;
        extra = Math.floor(colonies / per);
    } else extra = Math.floor(normalEmpires(galaxy, st.faction).length / 8);
    return Math.min(P.groupsMax(galaxy), P.groupsBase(galaxy) + Math.floor((n - 1) / 2) + extra);
}

function stagingName(index: number): string {
    return T('Beacon Staging Name', String.fromCharCode(65 + index));
}

/**
 * Begins season `n`: targets, staging points, one group per target. Returns false when there is nothing to strike (the
 * Reclaimers wait a quiet period and try again).
 */
export function beginSeason(galaxy: Galaxy, st: BeaconState, n: number): boolean {
    const faction = st.faction;
    const pos = beaconPosition(st);
    if (faction === null || pos === null || st.beaconDestroyed) return false;
    const now = galaxyStarDate(galaxy);
    const budget = seasonBudget(galaxy, st, n);
    const scripted = scriptedBudget(galaxy, st, n);
    const kFull = groupCountFor(galaxy, st, n);
    // Paid for by biofuel (models 0 and 2): a season the Reclaimers cannot afford waits; a thin one strikes fewer worlds.
    if (P.fundingModel(galaxy) !== 1 && budget < P.minSeasonStrength(galaxy)) return false;
    const k = P.fundingModel(galaxy) === 1 ? kFull : Math.max(1, Math.min(kFull, Math.round(budget / Math.max(1, scripted / kFull))));
    const rnd = beaconRandom(galaxy, st, 21);
    const targets = pickTargets(galaxy, st, k, budget, now);
    if (targets.length === 0) return false;
    const staged = stagingPointsFor(galaxy, st, targets.map((t) => t.habitat), P.stagingPoints(galaxy));
    const staging: StagingPoint[] = staged.points.map((pt, i) => ({ index: i, x: pt.x, y: pt.y, name: stagingName(i), knowledge: [], strength: 0, startStrength: 0 }));
    const prep = P.prepMinDays(galaxy) + rnd.nextDouble() * Math.max(0, P.prepMaxDays(galaxy) - P.prepMinDays(galaxy));
    const season: Season = {
        n, phase: 'prep', start: now, end: now + days(prep), staging, groups: [], budget, spawned: 0, departed: 0, departures: [], plannedTravelDays: 0, prepStart: now, launchAt: now + days(prep),
        freeLeft: Math.min(budget, P.fundingModel(galaxy) === 1 ? budget : scripted * freeShare(galaxy)),
    };
    targets.forEach((t, i) => {
        season.groups.push({
            id: st.nextGroupId++, season: n, state: 'gather', target: t.habitat, staging: staged.of[i], ships: [], transports: [], lead: null, departDate: 0, arriveDate: 0, siegeStart: 0, landings: 0, fails: 0,
            committed: false, destroyer: null, targetPop: t.habitat.population.totalAmount, troopsDone: false, lastReinforce: 0, rolled: false,
        });
    });
    // The reserve (raiders back, survivors) joins the new groups first.
    const reserve = aliveShips(st.reserve, faction);
    st.reserve = [];
    let gi = 0;
    for (const b of reserve) {
        if (b.troopCapacity > 0 && b.subRole === BuiltObjectSubRole.TroopTransport) season.groups[gi % season.groups.length].transports.push(b);
        else season.groups[gi % season.groups.length].ships.push(b);
        season.spawned += b.troopCapacity > 0 ? 0 : strengthOf(b);
        gi++;
    }
    // Step 4 of the salvage ladder: the Beacon's signal is traced, the staging points are known to the empire as they form.
    for (const e of normalEmpires(galaxy, faction)) {
        if (salvageStepsOf(st, e) < 4) continue;
        for (const sp of staging) {
            if (revealTo(galaxy, sp, e, KNOWLEDGE_CONFIRMED) && isHumanEmpire(galaxy, e)) arcMessage(galaxy, st.sentStages, [e], { prefix: TAG, stage: 'Staging Seen', onceKey: `Staging${n}:${sp.index}:${e.empireId}`, args: [sp.name], type: EmpireMessageType.GeneralWarning });
        }
    }
    st.season = season;
    st.seasons.push(season);
    if (st.seasons.length > 6) st.seasons.splice(0, st.seasons.length - 6);
    st.stats.seasons++;
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Season', onceKey: `Season${n}`, textTag: `${TAG} Season News`, args: [n, season.groups.length] });
    return true;
}

/** Warship roles of a wave, in order (the cycle after the flagship): heavy and medium hulls with a carrier and screens. */
const WAVE_CYCLE: readonly BuiltObjectSubRole[] = [
    BuiltObjectSubRole.Cruiser,
    BuiltObjectSubRole.CapitalShip,
    BuiltObjectSubRole.Cruiser,
    BuiltObjectSubRole.Destroyer,
    BuiltObjectSubRole.Carrier,
    BuiltObjectSubRole.Destroyer,
    BuiltObjectSubRole.Frigate,
];

function groupStrength(g: StrikeGroup): number {
    let s = 0;
    for (const b of g.ships) if (!b.hasBeenDestroyed) s += strengthOf(b);
    return s;
}

function stagingOf(season: Season, g: StrikeGroup): StagingPoint {
    return season.staging[Math.min(g.staging, season.staging.length - 1)];
}

/** Spawns warships at the Beacon for the groups, up to `until` of the season's budget, a batch per pass. */
function spawnWave(galaxy: Galaxy, st: BeaconState, season: Season, until: number, batch = WAVE_PER_PASS): number {
    const faction = st.faction!;
    const pos = beaconPosition(st);
    if (pos === null || season.groups.length === 0) return 0;
    let spawnedNow = 0;
    const quota = season.budget / season.groups.length;
    for (let i = 0; i < batch && season.spawned < until && st.stats.spawned < 1_000_000; i++) {
        // paid for: the season's free share first, then the fleet biofuel (an empty account ends the wave)
        if ((season.freeLeft ?? Infinity) <= 0 && fuelOf(st).fleet <= 0) break;
        // the group furthest below its quota gets the next ship
        let g: StrikeGroup | null = null;
        let low = Infinity;
        for (const x of season.groups) {
            const s = groupStrength(x);
            if (s < quota && s < low) {
                low = s;
                g = x;
            }
        }
        if (g === null) break;
        if (aliveShips(g.ships, faction).length >= P.maxSeasonShips(galaxy) / Math.max(1, season.groups.length) + 6) break;
        const sub = g.ships.length === 0 ? BuiltObjectSubRole.CapitalShip : WAVE_CYCLE[(g.ships.length - 1) % WAVE_CYCLE.length];
        const design = designFor(galaxy, faction, sub) ?? designFor(galaxy, faction, BuiltObjectSubRole.Cruiser);
        if (design === null) break;
        const bo = spawnShip(galaxy, faction, design, pos.x, pos.y);
        g.ships.push(bo);
        if (g.lead === null || g.lead.hasBeenDestroyed) g.lead = bo;
        const s = strengthOf(bo);
        season.spawned += s;
        if (season.freeLeft !== undefined) {
            const free = Math.min(season.freeLeft, s);
            season.freeLeft -= free;
            if (s > free) payFleet(st, s - free);
        }
        spawnedNow++;
        st.stats.spawned++;
        const sp = stagingOf(season, g);
        move(galaxy, bo, sp.x, sp.y);
        if (!(s > 0)) break;
    }
    return spawnedNow;
}

/**
 * Troops for one group (called once its warships are spawned and again to reinforce): the landing plan the target needs (strength in
 * enough regiments, landingPlan) minus what the group already carries. First the troops biofuel pays for: Thrall regiments raised at the
 * nearest harvest core, on transports that fly from the core to `(destX, destY)` (the ones a player can intercept), or drones made at the
 * Beacon while no core works. Then free BattleBots from the Beacon for the funding model's free share of what is still missing (model 1:
 * all of it; model 0: none). Returns the strength added.
 */
export function supplyTroops(galaxy: Galaxy, st: BeaconState, g: StrikeGroup, destX: number, destY: number): number {
    const faction = st.faction!;
    const target = g.target;
    const pos = beaconPosition(st);
    if (target === null || pos === null) return 0;
    const margin = P.assaultMarginPct(galaxy) + Math.min(120, g.fails * P.assaultFailStepPct(galaxy));
    const plan = landingPlan(galaxy, faction, target, margin);
    const carried = g.transports.reduce((s, b) => s + (b.hasBeenDestroyed ? 0 : loadedStrength(b)), 0);
    const carriedRegs = g.transports.reduce((s, b) => s + (b.hasBeenDestroyed ? 0 : loadedRegiments(b)), 0);
    let needS = plan.strength - carried;
    let needN = plan.regiments - carriedRegs;
    if (!(needS > 0) && needN <= 0) return 0;
    needS = Math.max(0, needS);
    needN = Math.max(0, needN);
    const design = transportDesign(galaxy, faction);
    if (design === null) return 0;
    const cap = P.regimentNatural(galaxy) * 100;
    // a landing short only of staying power still gets its regiments: a token regiment is 20 000 strong
    const wantS = Math.max(needS, needN * 20_000);
    let added = 0;
    // 1. Paid: Thralls from the nearest working core (drones from the Beacon while none works)
    const paidS = Math.min(wantS, troopsAffordable(galaxy, st));
    const room0 = Math.max(0, P.maxTransports(galaxy) - g.transports.length);
    if (paidS >= 20_000 && room0 > 0) {
        const core = troopSourceCore(galaxy, st, destX, destY);
        const from = core !== null ? core.colony : null;
        const regs = Math.max(1, Math.ceil(paidS / cap), Math.round(needN * (wantS > 0 ? paidS / wantS : 1)));
        const n = Math.min(transportsFor(galaxy, faction, regs), room0);
        const ships: BuiltObject[] = [];
        for (let i = 0; i < n; i++) ships.push(spawnShip(galaxy, faction, design, from?.xpos ?? pos.x, from?.ypos ?? pos.y));
        const race = from !== null ? ((from.population?.dominantRace ?? machineRace(galaxy)) as Race | null) : null;
        const got = loadSplit(galaxy, faction, ships, paidS, regs, race, T(from !== null ? 'Beacon Thrall Name' : 'Beacon Drone Name'));
        if (got.strength <= 0) for (const b of ships) builtObjectCompleteTeardown(galaxy, b);
        else {
            payTroops(galaxy, st, got.strength);
            needS -= got.strength;
            needN -= got.regiments;
            added += got.strength;
            for (const b of ships) {
                g.transports.push(b);
                if (from !== null) st.thrallShips.push(b);
                move(galaxy, b, destX, destY);
            }
            if (from !== null) st.stats.thrallConvoys++;
            st.stats.transportsSpawned += ships.length;
        }
    }
    // 2. Free: BattleBots from the Beacon for the free share of what is still missing
    const share = freeShare(galaxy);
    const room = Math.max(0, P.maxTransports(galaxy) - g.transports.length);
    if (share > 0 && (needS > 0 || needN > 0) && room > 0) {
        const strength = Math.max(needS, needN * 20_000) * share;
        const regs = Math.max(1, Math.round(needN * share), Math.ceil(strength / cap));
        const n = Math.min(transportsFor(galaxy, faction, regs), room);
        const ships: BuiltObject[] = [];
        for (let i = 0; i < n; i++) ships.push(spawnShip(galaxy, faction, design, pos.x, pos.y));
        const got = loadSplit(galaxy, faction, ships, strength, regs, null, T('Beacon Drone Name'));
        for (const b of ships) {
            g.transports.push(b);
            move(galaxy, b, destX, destY);
        }
        added += got.strength;
        st.stats.transportsSpawned += ships.length;
    }
    return added;
}

// ---------------------------------------------------------------------------------------------------------------
// Preparation: waves, gathering, the staging points' visibility, the simultaneous departure
// ---------------------------------------------------------------------------------------------------------------

function stagingFleet(galaxy: Galaxy, season: Season, sp: StagingPoint): BuiltObject[] {
    const out: BuiltObject[] = [];
    for (const g of season.groups) {
        if (g.staging !== sp.index || g.state !== 'gather') continue;
        for (const b of [...g.ships, ...g.transports]) if (!b.hasBeenDestroyed && distTo(galaxy, b, sp.x, sp.y) <= GATHER_RANGE) out.push(b);
    }
    return out;
}

/** Empires with a sensor on the gathered fleet learn the staging point; hits on it are counted. */
function watchStaging(galaxy: Galaxy, st: BeaconState, season: Season): void {
    const faction = st.faction!;
    for (const sp of season.staging) {
        const fleet = stagingFleet(galaxy, season, sp);
        const strength = fleet.reduce((s, b) => s + strengthOf(b), 0);
        if (sp.startStrength === 0 || strength > sp.startStrength) sp.startStrength = strength;
        else if (sp.startStrength > 0 && strength < sp.strength * 0.9) st.stats.stagingHits++;
        sp.strength = strength;
        if (fleet.length === 0) continue;
        const sample = fleet[0];
        const rnd = beaconRandom(galaxy, st, 131 + sp.index);
        for (const e of normalEmpires(galaxy, faction)) {
            if (knowledgeLevel(sp, e) >= KNOWLEDGE_CONFIRMED) continue;
            if (!isObjectVisibleToThisEmpire(galaxy, e, sample) && !noticedGathering(galaxy, st, e, sp, rnd)) continue;
            if (revealTo(galaxy, sp, e, KNOWLEDGE_CONFIRMED)) {
                st.stats.stagingSeen = (st.stats.stagingSeen ?? 0) + 1;
                if (isHumanEmpire(galaxy, e)) arcMessage(galaxy, st.sentStages, [e], { prefix: TAG, stage: 'Staging Seen', onceKey: `Staging${season.n}:${sp.index}:${e.empireId}`, args: [sp.name], type: EmpireMessageType.GeneralWarning, subject: sample });
            }
        }
    }
}

/**
 * The staging fleets lie in deep space, far from every sensor, so sight alone would never find them. Traders, pickets and listening
 * posts of the neighbouring empires do: an empire with a colony within beaconStagingDetectSectors of the point notices the gathering
 * with beaconStagingDetectPct % per pass at the colony's door, falling to nothing at the range. Draws the private Random only.
 */
export function noticedGathering(galaxy: Galaxy, st: BeaconState, e: Empire, sp: StagingPoint, rnd: ReturnType<typeof beaconRandom>): boolean {
    const range = P.stagingDetectSectors(galaxy) * galaxy.sectorSize;
    if (!(range > 0)) return false;
    let best = Infinity;
    for (const c of e.colonies) {
        const d = galaxy.calculateDistance(c.xpos, c.ypos, sp.x, sp.y);
        if (d < best) best = d;
    }
    if (best >= range) return false;
    void st;
    return rnd.nextDouble() * 100 < P.stagingDetectPct(galaxy) * (1 - best / range);
}

function gatherProgress(galaxy: Galaxy, season: Season, g: StrikeGroup): number {
    const sp = stagingOf(season, g);
    const all = [...g.ships, ...g.transports].filter((b) => !b.hasBeenDestroyed);
    if (all.length === 0) return 1;
    return all.filter((b) => distTo(galaxy, b, sp.x, sp.y) <= GATHER_RANGE).length / all.length;
}

function prune(g: StrikeGroup, faction: Empire): void {
    g.ships = aliveShips(g.ships, faction);
    g.transports = aliveShips(g.transports, faction);
    if (g.lead === null || g.lead.hasBeenDestroyed || g.lead.actualEmpire !== faction) g.lead = g.ships.slice().sort((a, b) => strengthOf(b) - strengthOf(a))[0] ?? null;
}

function prepPass(galaxy: Galaxy, st: BeaconState, season: Season): void {
    const faction = st.faction!;
    const now = galaxyStarDate(galaxy);
    for (const g of season.groups) prune(g, faction);
    const total = season.end - season.start;
    const spawnWindow = total * 0.5;
    const frac = Math.min(1, Math.max(0, (now - season.start) / Math.max(1, spawnWindow)));
    // A batch per 5 days since the last pass: the periodic runs once per stock long block (36 days at 1x), not every 5 days.
    if (!st.beaconDestroyed) spawnWave(galaxy, st, season, season.budget * frac, Math.ceil(WAVE_PER_PASS * passDays(st, now) / 5));
    // Troops once the warships are spawned (half way through the preparation).
    if (now - season.start >= spawnWindow) {
        for (const g of season.groups) {
            if (g.state !== 'gather' || g.target === null || g.ships.length === 0 || g.fails < 0) continue;
            if (g.troopsDone) continue;
            g.troopsDone = true;
            const sp = stagingOf(season, g);
            supplyTroops(galaxy, st, g, sp.x, sp.y);
        }
    }
    watchStaging(galaxy, st, season);
    // Departure: at the planned date once the groups have gathered (or 60 days past it).
    if (now >= season.end) {
        const ready = season.groups.every((g) => gatherProgress(galaxy, season, g) >= 0.8);
        if (ready || now >= season.end + days(60)) depart(galaxy, st, season);
    }
}

/** Every strike group leaves ON THE SAME DAY: this pass issues all the orders. A group too thin to matter is cancelled. */
function depart(galaxy: Galaxy, st: BeaconState, season: Season): void {
    const faction = st.faction!;
    const now = galaxyStarDate(galaxy);
    const quota = season.budget / Math.max(1, season.groups.length);
    let maxDays = 0;
    const departing: StrikeGroup[] = [];
    for (const g of season.groups) {
        prune(g, faction);
        const t = g.target;
        if (t === null || g.ships.length === 0 || groupStrength(g) < quota * 0.25 || t.hasBeenDestroyed) {
            for (const b of [...g.ships, ...g.transports]) st.reserve.push(b);
            g.ships = [];
            g.transports = [];
            g.state = 'done';
            continue;
        }
        departing.push(g);
    }
    for (const g of departing) {
        g.state = 'travel';
        g.departDate = now;
        g.committed = false;
        season.departures.push(now);
        const speed = Math.min(...g.ships.map((b) => b.warpSpeed).filter((s) => s > 0), 1e9);
        const lead = g.lead!;
        maxDays = Math.max(maxDays, travelDays(Math.min(speed, 1e8), distTo(galaxy, lead, g.target!.xpos, g.target!.ypos)));
        orderGroup(galaxy, g);
    }
    season.departed = departing.length > 0 ? now : 0;
    if (departing.length > 0) {
        st.launches = (st.launches ?? 0) + 1;
        st.lastLaunchDate = now;
    }
    season.plannedTravelDays = maxDays;
    season.phase = 'offensive';
    season.start = now;
    season.end = now + days(Math.min(P.offensiveMaxDays(galaxy), Math.max(P.offensiveMinDays(galaxy), maxDays * 1.35 + 60)));
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Offensive', onceKey: `Offensive${season.n}`, textTag: `${TAG} Offensive News`, args: [departing.length, Math.round(maxDays)] });
    for (const e of normalEmpires(galaxy, faction)) {
        if (!isHumanEmpire(galaxy, e)) continue;
        const mine = departing.filter((g) => g.target?.empire === e);
        if (mine.length > 0) arcMessage(galaxy, st.sentStages, [e], { prefix: TAG, stage: 'Inbound', onceKey: `Inbound${season.n}:${e.empireId}`, args: [mine.map((g) => g.target!.name).join(', ')], type: EmpireMessageType.GeneralBadEvent });
    }
    risingWorlds(galaxy, st, season);
}

/** Issues the orders that send a group at its target. */
function orderGroup(galaxy: Galaxy, g: StrikeGroup): void {
    const t = g.target;
    if (t === null) return;
    const done = new Set<ShipGroup>();
    for (const b of g.ships) attackOrder(galaxy, b, t, done);
    const hold = holdingPoint(galaxy, g);
    for (const b of g.transports) move(galaxy, b, hold.x, hold.y);
}

/** Where the transports wait: short of the target, on the side the group comes from. */
function holdingPoint(galaxy: Galaxy, g: StrikeGroup): { x: number; y: number } {
    const t = g.target!;
    const from = g.lead ?? g.ships[0] ?? null;
    let dx = from !== null ? from.xpos - t.xpos : 1;
    let dy = from !== null ? from.ypos - t.ypos : 0;
    const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    dx /= len;
    dy /= len;
    void galaxy;
    return { x: t.xpos + dx * STATION_RANGE * 7, y: t.ypos + dy * STATION_RANGE * 7 };
}

// ---------------------------------------------------------------------------------------------------------------
// The offensive: sieges and landings
// ---------------------------------------------------------------------------------------------------------------

function defendersNear(galaxy: Galaxy, holder: Empire | null, target: Habitat): number {
    let s = 0;
    if (holder === null || holder === galaxy.independentEmpire) return 0;
    for (const b of holder.builtObjects) {
        if (b.hasBeenDestroyed || b.role !== BuiltObjectRole.Military || b.topSpeed <= 0) continue;
        if (galaxy.calculateDistance(b.xpos, b.ypos, target.xpos, target.ypos) <= ENGAGE_RANGE) s += strengthOf(b);
    }
    return s;
}

function loadedTroopsOf(g: StrikeGroup): import('../../../cargo').Troop[] {
    const out: import('../../../cargo').Troop[] = [];
    for (const b of g.transports) if (!b.hasBeenDestroyed && b.troops !== null) out.push(...b.troops.items);
    return out;
}

function marginFor(galaxy: Galaxy, g: StrikeGroup): number {
    return P.assaultMarginPct(galaxy) + Math.min(120, g.fails * P.assaultFailStepPct(galaxy));
}

/** The nearest colony of the target's owner the group's troops could take instead (nearest first, beatable with the margin). */
function fallbackTarget(galaxy: Galaxy, st: BeaconState, g: StrikeGroup, troops: readonly import('../../../cargo').Troop[]): Habitat | null {
    const faction = st.faction!;
    const ref = g.target;
    if (ref === null || troops.length === 0) return null;
    const pool = targetCandidates(galaxy, st, galaxyStarDate(galaxy)).filter((c) => c !== ref && (c.empire === ref.empire || ref.empire === null));
    let best: Habitat | null = null;
    let bs = Infinity;
    for (const c of pool) {
        const d = galaxy.calculateDistance(ref.xpos, ref.ypos, c.xpos, c.ypos);
        if (d > 3 * galaxy.sectorSize) continue;
        if (!genShipsAssaultWins(galaxy, c, faction, troops, marginFor(galaxy, g))) continue;
        if (d < bs) {
            bs = d;
            best = c;
        }
    }
    return best;
}

/** One strike group's turn (every pass, whichever phase the season is in). */
function driveGroup(galaxy: Galaxy, st: BeaconState, g: StrikeGroup): void {
    const faction = st.faction!;
    const now = galaxyStarDate(galaxy);
    prune(g, faction);
    const target = g.target;
    if (g.state === 'done' || g.state === 'gather' || target === null) return;
    if (g.ships.length === 0 && g.transports.every((b) => loadedStrength(b) <= 0)) {
        g.state = 'done';
        for (const b of g.transports) builtObjectCompleteTeardown(galaxy, b);
        g.transports = [];
        return;
    }
    if (g.ships.length === 0) {
        // The escort is gone: the surviving transports fall back to the reserve (a later season uses their troops).
        for (const b of g.transports) {
            const home = beaconPosition(st);
            if (home !== null) move(galaxy, b, home.x, home.y);
            st.reserve.push(b);
        }
        g.transports = [];
        g.state = 'done';
        return;
    }
    if (target.hasBeenDestroyed) {
        const nearest = fallbackTarget(galaxy, st, g, loadedTroopsOf(g));
        if (nearest === null) return retreat(galaxy, st, g);
        g.target = nearest;
        g.state = 'travel';
        g.committed = false;
        return;
    }
    if (target.empire !== null && sparedOrAllied(st, target.empire, now)) return retreat(galaxy, st, g); // a bargain was struck: the group is called off
    if (target.empire === faction) {
        // Taken (by this group or another): the escort holds the world as its garrison fleet.
        g.state = 'done';
        garrisonFleet(galaxy, st, g, target);
        return;
    }
    const done = new Set<ShipGroup>();
    const lead = g.lead!;
    for (const b of g.ships) attackOrder(galaxy, b, target, done);
    if (g.state === 'travel') {
        if (distTo(galaxy, lead, target.xpos, target.ypos) > ENGAGE_RANGE) {
            const hold = holdingPoint(galaxy, g);
            for (const b of g.transports) if (b.troops !== null && b.troops.count > 0) move(galaxy, b, hold.x, hold.y);
            return;
        }
        g.state = 'siege';
        g.arriveDate = now;
        g.siegeStart = now;
        const owner = target.empire;
        if (owner !== null && isHumanEmpire(galaxy, owner)) arcMessage(galaxy, st.sentStages, [owner], { prefix: TAG, stage: 'Arrived', onceKey: `Arrived${g.id}`, args: [target.name], type: EmpireMessageType.GeneralBadEvent, subject: target });
    }
    // SIEGE: the escort must hold the orbit before the troops go down.
    let onStation = 0;
    let onStationStrength = 0;
    for (const b of g.ships) {
        if (distTo(galaxy, b, target.xpos, target.ypos) <= ENGAGE_RANGE) {
            onStation++;
            onStationStrength += strengthOf(b);
        }
    }
    const defenders = defendersNear(galaxy, target.empire, target);
    const superior = onStationStrength > 0 && onStationStrength >= defenders * 1.5 && onStation * 2 >= g.ships.length;
    const troops = loadedTroopsOf(g);
    // Enough staying power: at least 80 % of the regiments the plan wants (the ground war's attrition is per regiment, not per strength)
    const regsOk = troops.length >= Math.ceil(0.8 * landingPlan(galaxy, faction, target, marginFor(galaxy, g)).regiments);
    if (g.state === 'landed') {
        const troopsLeft = g.transports.some((b) => loadedStrength(b) > 0) || (target.invadingTroops !== null && target.invadingTroops.items.some((t) => t.empire === faction));
        if (target.empire === faction) {
            g.state = 'done';
            garrisonFleet(galaxy, st, g, target);
            return;
        }
        if (!troopsLeft) {
            g.fails++;
            st.stats.landingsLost++;
            g.state = 'siege';
            g.committed = false;
            reinforce(galaxy, st, g);
        }
        return;
    }
    if (superior || g.committed) {
        if (troops.length > 0 && (regsOk || g.committed) && genShipsAssaultWins(galaxy, target, faction, troops, g.committed ? 100 : marginFor(galaxy, g))) g.committed = true;
        else {
            g.committed = false;
            if (troops.length === 0 || now - g.siegeStart > days(30)) reinforce(galaxy, st, g);
        }
    }
    const hold = holdingPoint(galaxy, g);
    if (g.committed) {
        const landing: BuiltObject[] = [];
        for (const b of g.transports) {
            if (loadedStrength(b) <= 0) continue;
            if (distTo(galaxy, b, target.xpos, target.ypos) <= LANDING_RANGE) landing.push(b);
            else moveTo(galaxy, b, target);
        }
        if (landing.length > 0 && landing.length === g.transports.filter((b) => loadedStrength(b) > 0).length) {
            // all at once: the coordinated landing
            const list: import('../../../cargo').Troop[] = [];
            for (const b of landing) {
                list.push(...b.troops!.items);
                b.troops!.clear();
            }
            for (const t of list) t.builtObject = null;
            invadeFromInside(galaxy, target, faction, list);
            g.landings++;
            g.state = 'landed';
            st.stats.landingsWon++;
        }
    } else {
        for (const b of g.transports) if (loadedStrength(b) > 0 && distTo(galaxy, b, hold.x, hold.y) > LANDING_RANGE) move(galaxy, b, hold.x, hold.y);
    }
    // A long siege that the troops cannot end: fall back to a beatable neighbour, or (rarely) a planet strike, or give up.
    const siegeLen = now - g.siegeStart;
    if (!g.committed && siegeLen > days(P.siegeDays(galaxy))) {
        const fb = troops.length > 0 ? fallbackTarget(galaxy, st, g, troops) : null;
        if (fb !== null) {
            g.target = fb;
            g.state = 'travel';
            g.siegeStart = 0;
            return;
        }
        if (!g.rolled && siegeLen > days(P.siegeDays(galaxy)) * 1.2) {
            g.rolled = true;
            const rnd = beaconRandom(galaxy, st, 33 + g.id);
            if (rnd.nextDouble() * 100 < P.destroyPct(galaxy)) planetStrike(galaxy, st, g);
        }
        if (siegeLen > days(P.siegeDays(galaxy)) * 2.4) retreat(galaxy, st, g);
    }
}

/** More troops for a group that failed a landing or whose troops fell short: BattleBots from the Beacon (or Thralls), once per 45 days. */
function reinforce(galaxy: Galaxy, st: BeaconState, g: StrikeGroup): void {
    const now = galaxyStarDate(galaxy);
    if (now - g.lastReinforce < days(45) || g.target === null) return;
    g.lastReinforce = now;
    const hold = holdingPoint(galaxy, g);
    supplyTroops(galaxy, st, g, hold.x, hold.y);
}

/** The group goes home to the reserve. */
function retreat(galaxy: Galaxy, st: BeaconState, g: StrikeGroup): void {
    const home = beaconPosition(st);
    for (const b of [...g.ships, ...g.transports]) {
        if (loadedStrength(b) <= 0 && b.subRole === BuiltObjectSubRole.TroopTransport) {
            builtObjectCompleteTeardown(galaxy, b);
            continue;
        }
        if (home !== null) move(galaxy, b, home.x, home.y);
        st.reserve.push(b);
    }
    g.ships = [];
    g.transports = [];
    g.state = 'done';
}

/** A planet destroyer (the stock design, as the Purifier's) is made at the Beacon and sent at the world; the escort keeps the siege. */
export function planetStrike(galaxy: Galaxy, st: BeaconState, g: StrikeGroup): void {
    const faction = st.faction!;
    const pos = beaconPosition(st);
    const target = g.target;
    if (pos === null || target === null) return;
    const now = galaxyStarDate(galaxy);
    const design = generatePlanetDestroyerDesign(galaxy, P.destroyerPct(galaxy) / 100, faction, now);
    faction.designs.push(design);
    const pd = spawnShip(galaxy, faction, design, pos.x, pos.y);
    if (!pd.isPlanetDestroyer || !canDestroyHabitat(galaxy, pd, target)) {
        builtObjectCompleteTeardown(galaxy, pd);
        return;
    }
    g.destroyer = pd;
    g.targetPop = target.population.totalAmount;
    pd.isAutoControlled = false; // driven by drivePlanetDestroyers (the stock AI would take it for its own errands)
    assignMission(galaxy, pd, BuiltObjectMissionType.Attack, target, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Destroyer', onceKey: `Destroyer${g.id}`, textTag: `${TAG} Destroyer News`, args: [target.name] });
}

/**
 * Every pass: a planet destroyer sent at a world keeps its Attack order (a mission lost to a refuel or a retreat is given again) until the
 * world is gone or it is. The planet destroyer fires from its own weapons range once the Attack command has set the colony (cmdAttack.ts).
 */
export function drivePlanetDestroyers(galaxy: Galaxy, st: BeaconState): void {
    for (const s of st.seasons) {
        for (const g of s.groups) {
            const pd = g.destroyer;
            if (pd === null || pd.hasBeenDestroyed || pd.actualEmpire !== st.faction) continue;
            const t = g.target;
            if (t === null || t.hasBeenDestroyed || t.empire === st.faction) {
                g.destroyer = null;
                const home = beaconPosition(st);
                if (home !== null) move(galaxy, pd, home.x, home.y);
                st.reserve.push(pd);
                continue;
            }
            const m = builtObjectMission(pd.mission);
            if (m === null || m.type !== BuiltObjectMissionType.Attack || m.targetHabitat !== t) {
                pd.isAutoControlled = false;
                assignMission(galaxy, pd, BuiltObjectMissionType.Attack, t, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
            }
        }
    }
}

/** The group's surviving warships stay at the conquered world (Patrol) as its fleet. */
function garrisonFleet(galaxy: Galaxy, st: BeaconState, g: StrikeGroup, world: Habitat): void {
    void st;
    for (const b of g.ships) patrol(galaxy, b, world);
    for (const b of g.transports) {
        // spare troops land as the garrison; the empty transport has done its work
        if (b.troops !== null && b.troops.count > 0) {
            world.troops ??= new TroopList();
            for (const t of [...b.troops.items]) {
                b.troops.remove(t);
                t.builtObject = null;
                t.colony = world;
                world.troops.add(t);
            }
        }
        builtObjectCompleteTeardown(galaxy, b);
    }
    g.transports = [];
}

// ---------------------------------------------------------------------------------------------------------------
// Corrupted worlds rise
// ---------------------------------------------------------------------------------------------------------------

/** At the departure, a share of the corrupted worlds rise from inside (invadeFromInside); a failed rising ends that corruption. */
function risingWorlds(galaxy: Galaxy, st: BeaconState, season: Season): void {
    const faction = st.faction!;
    const rnd = beaconRandom(galaxy, st, 41);
    const share = Math.min(0.9, 0.45 + 0.1 * season.n);
    for (const c of activeCorruption(st)) {
        const h = c.colony;
        if (h.empire === faction || rnd.nextDouble() > share) continue;
        if (h.invadingTroops !== null && h.invadingTroops.items.some((t) => t.empire === faction)) continue;
        const race = (h.population?.dominantRace ?? null) as Race | null;
        const owner = h.empire;
        const rising = makeTroopsSplit(galaxy, faction, P.riseStrength(galaxy) * (1 + 0.15 * season.n), P.riseRegiments(galaxy), T('Beacon Rising Name'), race);
        invadeFromInside(galaxy, h, faction, rising);
        c.ended = 'rose';
        c.endDate = galaxyStarDate(galaxy);
        st.stats.rose++;
        if (owner !== null && owner !== galaxy.independentEmpire) {
            arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Rising', onceKey: `Rising:${st.corrupted.indexOf(c)}`, textTag: `${TAG} Rising News`, args: [h.name, owner.name] });
            if (isHumanEmpire(galaxy, owner)) arcMessage(galaxy, st.sentStages, [owner], { prefix: TAG, stage: 'Rising', onceKey: `RisingMsg:${st.corrupted.indexOf(c)}`, args: [h.name], type: EmpireMessageType.GeneralBadEvent, subject: h });
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Quiet: raids by pairs
// ---------------------------------------------------------------------------------------------------------------

function quietPass(galaxy: Galaxy, st: BeaconState, season: Season): void {
    const faction = st.faction!;
    const now = galaxyStarDate(galaxy);
    st.raids = st.raids.filter((r) => {
        r.ships = aliveShips(r.ships, faction);
        if (r.ships.length === 0) return false;
        if (now >= r.until) {
            const home = beaconPosition(st);
            for (const b of r.ships) {
                if (home !== null) move(galaxy, b, home.x, home.y);
                st.reserve.push(b);
            }
            return false;
        }
        const t = r.target;
        if (t !== null && !t.hasBeenDestroyed) {
            const done = new Set<ShipGroup>();
            for (const b of r.ships) attackOrder(galaxy, b, t, done);
        }
        return true;
    });
    if (st.beaconDestroyed || now < st.nextRaidDate || st.raids.length >= 3) return;
    const pos = beaconPosition(st);
    if (pos === null) return;
    const rnd = beaconRandom(galaxy, st, 51);
    st.nextRaidDate = now + days(P.raidDays(galaxy) * (0.7 + 0.6 * rnd.nextDouble()));
    const cands = targetCandidates(galaxy, st, now).filter((c) => !st.raids.some((r) => r.target === c));
    if (cands.length === 0) return;
    // weakly defended worlds nearest the Beacon, at random among the nearest few
    cands.sort((a, b) => galaxy.calculateDistance(pos.x, pos.y, a.xpos, a.ypos) - galaxy.calculateDistance(pos.x, pos.y, b.xpos, b.ypos));
    const target = cands[rnd.next(0, Math.min(8, cands.length))];
    const designs = [designFor(galaxy, faction, BuiltObjectSubRole.Cruiser), designFor(galaxy, faction, BuiltObjectSubRole.Destroyer)].filter((d): d is Design => d !== null);
    if (designs.length === 0) return;
    // raiders are paid from the fleet biofuel unless the model is the scripted one
    const paid = P.fundingModel(galaxy) !== 1;
    if (paid && fuelOf(st).fleet <= 0) return;
    const ships = designs.slice(0, 2).map((d) => spawnShip(galaxy, faction, d, pos.x, pos.y));
    if (paid) payFleet(st, ships.reduce((a, b) => a + strengthOf(b), 0));
    st.stats.spawned += ships.length;
    st.stats.raids++;
    const done = new Set<ShipGroup>();
    for (const b of ships) attackOrder(galaxy, b, target, done);
    st.raids.push({ ships, target, start: now, until: now + days(P.raidLifeDays(galaxy)) });
    if (target.empire !== null && isHumanEmpire(galaxy, target.empire)) arcMessage(galaxy, st.sentStages, [target.empire], { prefix: TAG, stage: 'Raid', onceKey: `Raid${st.stats.raids}`, args: [target.name], type: EmpireMessageType.GeneralWarning, subject: target });
    void season;
}

// ---------------------------------------------------------------------------------------------------------------
// Processing: the monthly drain, the Thrall pools
// ---------------------------------------------------------------------------------------------------------------

/**
 * A held world the cattle ships have emptied stays empty: what regrows is cut back (taken to the harvest uncounted: it never had time to
 * grow up). Returns nothing; no Rnd.
 */
export function holdEmpty(rec: ProcessRec): void {
    const h = rec.colony;
    if (!rec.done || h.population === null || h.population.totalAmount <= 0) return;
    const floor = Math.max(1, rec.popStart * 0.01);
    const total = h.population.totalAmount;
    if (total > floor * 1.5) {
        const keep = floor / total;
        for (const p of h.population.items) p.amount = Math.floor(p.amount * keep);
        h.population.recalculateTotalAmount();
    }
}

/** Monthly: garrisons settled, emptied worlds kept empty, the harvest (processing, biofuel, the troop pass), wars, the losing check. */
export function reclamationMonthly(galaxy: Galaxy): void {
    const st = (galaxy.scenario?.state['beacon'] ?? null) as BeaconState | null;
    if (st === null || st.phase !== 'reclamation' || st.faction === null || !st.faction.active) return;
    const faction = st.faction;
    st.processing = st.processing.filter((r) => !r.colony.hasBeenDestroyed && r.colony.empire === faction);
    for (const rec of st.processing) {
        if (rec.garrisoned !== true && rec.colony.invadingTroops?.items.every((t) => t.empire === faction) !== false) {
            rec.garrisoned = true;
            setGarrison(galaxy, faction, rec.colony, st);
        }
        holdEmpty(rec);
    }
    harvestMonthly(galaxy, st);
    faction.stateMoney = Math.max(faction.stateMoney, 5_000_000);
    refuelAll(faction);
    st.thrallShips = st.thrallShips.filter((b) => !b.hasBeenDestroyed);
    // Normal empires made after the Reclamation began are at war with it as well (unless spared or in its pocket).
    const now = galaxyStarDate(galaxy);
    for (const e of normalEmpires(galaxy, faction)) {
        if (sparedOrAllied(st, e, now)) continue;
        if (obtainDiplomaticRelation(faction, e).type !== DiplomaticRelationType.War) lockWar(galaxy, faction, e);
    }
    lossCheck(galaxy, st);
}

export function lossCheck(galaxy: Galaxy, st: BeaconState): void {
    if (st.ended || st.popBaseline <= 0) return;
    const pct = (100 * st.popEliminated) / st.popBaseline;
    if (pct < P.lossPct(galaxy)) return;
    st.ended = true;
    st.phase = 'ended';
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Lost', textTag: `${TAG} Lost News`, args: [Math.round(pct)] });
    const player = galaxy.playerEmpire;
    threatGameEnd(galaxy, player, GameEndOutcome.Defeat, T('Beacon Defeat Title'), BEACON_CODE_LOST, false);
}

/** The share (0-100) of the starting population the Reclaimers have eliminated. Pure. */
export function eliminatedPct(st: BeaconState): number {
    return st.popBaseline > 0 ? (100 * st.popEliminated) / st.popBaseline : 0;
}

// ---------------------------------------------------------------------------------------------------------------
// The Beacon's guard
// ---------------------------------------------------------------------------------------------------------------

function topUpGuard(galaxy: Galaxy, st: BeaconState): void {
    const faction = st.faction!;
    const pos = beaconPosition(st);
    if (pos === null || st.beaconDestroyed) return;
    st.guards = aliveShips(st.guards, faction);
    const n = Math.max(1, st.stats.seasons);
    let want = (scriptedBudget(galaxy, st, n) / Math.max(1, groupCountFor(galaxy, st, n))) * P.guardGroups(galaxy);
    // The guard is raised over the first beaconGuardRampDays after completion (30 % at the start): the empires get a window to strike before it is full.
    const ramp = P.guardRampDays(galaxy);
    if (ramp > 0) want *= Math.min(1, 0.3 + (0.7 * Math.max(0, galaxyStarDate(galaxy) - st.completeDate)) / days(ramp));
    // The guard never outgrows what the world's empires could ever field against it (else the Beacon could not be beaten at all).
    const capPct = P.guardCapPct(galaxy);
    if (capPct > 0) {
        let total = 0;
        for (const e of normalEmpires(galaxy, faction)) total += militaryPotency(e);
        want = Math.min(want, Math.max(P.minSeasonStrength(galaxy), (total * capPct) / 100));
    }
    let have = st.guards.reduce((s, b) => s + strengthOf(b), 0);
    // The funding model's free share of the guard comes for nothing; the rest is paid from the fleet biofuel.
    const freeTo = want * freeShare(galaxy);
    for (let i = 0; i < 12 && have < want; i++) {
        const paid = have >= freeTo;
        if (paid && fuelOf(st).fleet <= 0) break;
        const sub = WAVE_CYCLE[(st.guards.length + i) % WAVE_CYCLE.length];
        const d = designFor(galaxy, faction, sub);
        if (d === null) break;
        const bo = spawnShip(galaxy, faction, d, pos.x, pos.y);
        st.guards.push(bo);
        st.stats.spawned++;
        if (paid) payFleet(st, strengthOf(bo));
        have += strengthOf(bo);
        if (!(strengthOf(bo) > 0)) break;
    }
    // Hold station at the Beacon: Patrol its star.
    const star = st.site?.system.systemStar ?? null;
    if (star !== null) for (const b of st.guards) if (distTo(galaxy, b, pos.x, pos.y) <= 40000) patrol(galaxy, b, star);
}

// ---------------------------------------------------------------------------------------------------------------
// The driver
// ---------------------------------------------------------------------------------------------------------------

/** Days since the last reclamation pass (5 to 60): the scenario periodics run once per stock long block, so a pass can stand for weeks. */
export function passDays(st: BeaconState, now: number): number {
    const last = st.lastPassDate ?? now - days(5);
    return Math.max(5, Math.min(60, (now - last) / GAME_DAY_LENGTH));
}

/** Every 5 days (at most once per stock long block): the season state machine and every strike group. */
export function reclamationPeriodic(galaxy: Galaxy): void {
    const st = (galaxy.scenario?.state['beacon'] ?? null) as BeaconState | null;
    if (st === null || st.phase !== 'reclamation' || st.faction === null || !st.faction.active) return;
    const faction = st.faction;
    const now = galaxyStarDate(galaxy);
    reclamationPass(galaxy, st, now);
    st.lastPassDate = now;
    void faction;
}

function reclamationPass(galaxy: Galaxy, st: BeaconState, now: number): void {
    const faction = st.faction!;
    if (st.beacon !== null && st.beacon.hasBeenDestroyed && !st.beaconDestroyed) {
        st.beaconDestroyed = true;
        arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Beacon Destroyed', textTag: `${TAG} Beacon Destroyed News` });
    }
    st.reserve = aliveShips(st.reserve, faction);
    const season = st.season;
    if (season === null) {
        if (now >= st.completeDate + days(P.startDelayDays(galaxy)) && !st.beaconDestroyed) beginSeason(galaxy, st, 1);
    } else if (season.phase === 'prep') prepPass(galaxy, st, season);
    else if (season.phase === 'offensive') {
        if (season.groups.every((g) => g.state === 'done') || now >= season.end) {
            season.phase = 'quiet';
            season.start = now;
            season.end = now + days(P.quietDays(galaxy));
            st.nextRaidDate = now + days(10);
            arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Quiet', onceKey: `Quiet${season.n}`, textTag: `${TAG} Quiet News` });
        }
    } else if (season.phase === 'quiet') {
        quietPass(galaxy, st, season);
        if (now >= season.end && !st.beaconDestroyed) {
            if (!beginSeason(galaxy, st, season.n + 1)) season.end = now + days(60); // nothing to strike: wait a little
        }
    }
    harvestPeriodic(galaxy, st);
    // Groups of every recent season go on until they are done (a siege runs past its season's end).
    for (const s of st.seasons) for (const g of s.groups) if (g.state !== 'gather' && g.state !== 'done') driveGroup(galaxy, st, g);
    drivePlanetDestroyers(galaxy, st);
    if (!st.beaconDestroyed && now - (st.guardDate ?? 0) >= days(60)) {
        st.guardDate = now;
        topUpGuard(galaxy, st);
    }
    void faction;
}

// ---------------------------------------------------------------------------------------------------------------
// Events: conquest, retaking, destruction
// ---------------------------------------------------------------------------------------------------------------

/**
 * A world the Reclaimers hold is garrisoned at exactly beaconGarrison (in beaconGarrisonRegiments regiments), whatever mix of
 * survivors the landing left: more is sent home (a stronger garrison than a landing's leftovers would make retaking hopeless for
 * every AI), less is topped up. No Rnd beyond troop naming.
 */
export function setGarrison(galaxy: Galaxy, faction: Empire, colony: Habitat, st: BeaconState | null = null): void {
    colony.troops ??= new TroopList();
    const full = P.garrisonStrength(galaxy);
    const have = colony.troops.totalDefendStrength;
    if (have >= full * 0.8 && have <= full * 1.25) return;
    // Short of it: the funding model's free share is raised for nothing, the rest paid from the troop biofuel (as far as it goes).
    let want = full;
    if (have < full * 0.8 && st !== null) {
        const free = (full - have) * freeShare(galaxy);
        const paid = Math.min(full - have - free, troopsAffordable(galaxy, st));
        payTroops(galaxy, st, paid);
        want = have + free + paid;
        if (want <= have) return;
    }
    for (const t of [...colony.troops.items]) {
        const e = t.empire as Empire | null;
        if (e !== null && e.troops != null) e.troops.remove(t);
    }
    colony.troops.clear();
    if (!(want > 0)) return;
    const race = (colony.population?.dominantRace ?? null) as Race | null;
    for (const t of makeTroopsSplit(galaxy, faction, want, P.garrisonRegiments(galaxy), T('Beacon Thrall Name'), race)) {
        t.colony = colony;
        colony.troops.add(t);
    }
}

/** colonyOwnerChanged: a world falls to the Reclaimers (processing begins), or is retaken from them (the survivors are saved). */
export function onColonyOwnerChanged(galaxy: Galaxy, st: BeaconState, colony: Habitat, from: Empire | null, to: Empire | null): void {
    const faction = st.faction;
    if (faction === null) return;
    const now = galaxyStarDate(galaxy);
    if (to === faction) {
        if (faction.capital === null || faction.capital.empire !== faction) faction.capital = colony;
        if (!st.processing.some((r) => r.colony === colony)) {
            // the first cattle ship leaves after a part of the interval (staggered by the world's index, no Rnd)
            const first = now + days(P.cattleDays(galaxy) * (0.3 + (colony.habitatIndex % 7) / 7));
            st.processing.push({ colony, since: now, popStart: colony.population.totalAmount, drained: 0, pool: 0, done: false, nextConvoy: first });
            st.stats.conquests++;
        }
        if (from !== null && from !== galaxy.independentEmpire && from.pirateEmpireBaseHabitat === null && st.ceding !== true) st.lostBy[String(from.empireId)] = (st.lostBy[String(from.empireId)] ?? 0) + 1;
        const ex = st.corrupted.find((c) => c.colony === colony && c.ended === null);
        if (ex !== undefined) {
            ex.ended = 'rose';
            ex.endDate = now;
        }
        arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Conquered', onceKey: `Conquered:${colony.name}:${st.stats.conquests}`, textTag: `${TAG} Conquered News`, args: [colony.name, from?.name ?? T('Beacon Independents')] });
        if (from !== null && isHumanEmpire(galaxy, from)) arcMessage(galaxy, st.sentStages, [from], { prefix: TAG, stage: 'Processing', onceKey: `Processing:${colony.name}:${st.stats.conquests}`, args: [colony.name], type: EmpireMessageType.GeneralBadEvent, subject: colony });
        // a garrison of Thrall regiments (free upkeep): the world is held at beaconGarrison, however many invaders survived
        setGarrison(galaxy, faction, colony, st);
    } else if (from === faction) {
        const i = st.processing.findIndex((r) => r.colony === colony);
        if (i >= 0) {
            const rec = st.processing[i];
            st.processing.splice(i, 1);
            st.stats.retaken = (st.stats.retaken ?? 0) + 1;
            const saved = colony.population.totalAmount;
            onCoreRetaken(galaxy, st, colony, to);
            arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Retaken', onceKey: `Retaken:${colony.name}:${rec.since}`, textTag: `${TAG} Retaken News`, args: [colony.name, to?.name ?? T('Beacon Independents'), Math.round(saved / 1e6)] });
            if (to !== null && isHumanEmpire(galaxy, to)) arcMessage(galaxy, st.sentStages, [to], { prefix: TAG, stage: 'Retaken Msg', onceKey: `RetakenMsg:${colony.name}:${rec.since}`, args: [colony.name, Math.round(saved / 1e6), Math.round(rec.drained / 1e6)], type: EmpireMessageType.GeneralGoodEvent, subject: colony });
        }
    }
}

/** habitatDestroyed: the Reclaimers destroyed a world: its people are eliminated. */
export function onHabitatDestroyed(galaxy: Galaxy, st: BeaconState, habitat: Habitat, destroyer: Empire | null): void {
    if (st.faction === null || destroyer !== st.faction) return;
    let pop = habitat.population?.totalAmount ?? 0;
    for (const s of st.seasons) for (const g of s.groups) if (g.target === habitat && g.targetPop > pop) pop = g.targetPop;
    st.popEliminated += pop;
    st.stats.popDestroyed += pop;
    st.stats.planetsDestroyed++;
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Planet Destroyed', onceKey: `PlanetDestroyed${st.stats.planetsDestroyed}`, textTag: `${TAG} Planet Destroyed News`, args: [habitat.name, Math.round(pop / 1e6)] });
    lossCheck(galaxy, st);
}

/** A Reclaimer ship was destroyed: a Thrall transport lost counts as an interception. */
export function onShipKilled(galaxy: Galaxy, st: BeaconState, bo: BuiltObject, destroyer: Empire | null): void {
    if (destroyer === null || destroyer === st.faction) return;
    if (st.thrallShips.includes(bo)) st.stats.thrallIntercepted++;
    // a cattle ship: its captives die with it; a harvester: its core is broken and the pens freed toward the attacker
    if (onCattleKilled(galaxy, st, bo)) return;
    const core = (st.cores ?? []).find((c) => c.ended === null && c.harvester === bo);
    if (core !== undefined) onHarvesterLost(galaxy, st, core, destroyer);
    // a warship sunk at a staging point while the season is still gathering: the staging fleet was hit
    const season = st.season;
    if (season !== null && season.phase === 'prep' && bo.role === BuiltObjectRole.Military && bo.subRole !== BuiltObjectSubRole.TroopTransport) {
        for (const sp of season.staging) if (distTo(galaxy, bo, sp.x, sp.y) <= 2 * GATHER_RANGE) st.stats.stagingKills = (st.stats.stagingKills ?? 0) + 1;
    }
}
