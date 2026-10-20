// The Beacon, part 2: the Reclamation (Giantworks wonder, flag gwBeacon). Not a port: new scenario behaviour composed of ported
// functions (each composed step cites its stock analogue). Registered from beacon.ts; every handler is gated by the gwBeacon flag.
//
// FIRST SEASON: the Great Work's completion starts a 10-day countdown, not a war: the Watchers gather, cloaked, round the Beacon. Then the first MEGA
// BEAM (fireBeam): the war is declared, the Watchers decloak and lead Watcher fleets (escorts made at the Beacon), and season 1's strike groups arrive
// through the beam just outside their targets' systems at full strength (no spawning at the Beacon, no staging). Later seasons are as below.
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
    type WatcherFleet,
    type WatcherRec,
    isBeamCountdown,
    warOn,
} from './beaconState';
import { scenarioText as T } from '../../messages';
import { allotResponse, driveResponse } from './beaconResponse';
import { beginLongNight } from './longNight';
import { isPursuing } from './beaconPursuit';
import { noteFirstBeam, partsPass } from './beaconComponents';
import { buildPoint, capitalAlone, foundryBatch, foundryStat, noteBirth } from './beaconFoundry';
import { freeShare, fuelOf, harvestMonthly, liveCores, harvestPeriodic, onCattleKilled, onCoreRetaken, onHarvesterLost, payFleet, payTroops, troopSourceCore, troopsAffordable } from './beaconHarvest';

const TAG = 'Beacon';
/** A fleet this close to a target is "on station"; defenders this close block a landing. */
const STATION_RANGE = 8000;
/** Warships engage from their weapons range: a group this close to its target has arrived and counts as on station. */
export const ENGAGE_RANGE = 24000;
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

/** Tech of the Reclaimers' ships: the generator's maximum (beaconTechMax, the default), else the galaxy's average + 1 (the Watchers: + beaconWatcherTechBonus), within the generator's range. */
export function reclaimerLevel(galaxy: Galaxy, faction: Empire | null, bonus = 1): number {
    const max = maxDesignTechLevel(galaxy);
    // beaconTechMax: every Reclaimer design (Watchers, warships, cattle ships, harvesters, the Beacon's defences) is made at the generator's top tech level
    if (P.techMax(galaxy) && max > 0) return max;
    const avg = faction !== null ? averageTechLevel(galaxy, faction) : 1;
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

export function strengthOf(bo: BuiltObject): number {
    return Math.max(0, calculateOverallStrengthFactorWithoutShields(bo));
}

function move(galaxy: Galaxy, bo: BuiltObject, x: number, y: number): void {
    if (isPursuing(galaxy, bo)) return;
    const m = builtObjectMission(bo.mission);
    if (m !== null && m.type === BuiltObjectMissionType.Move && m.targetHabitat === null && m.targetBuiltObject === null && Math.abs(m.x - x) < 1 && Math.abs(m.y - y) < 1) return;
    bo.isAutoControlled = false;
    assignMission(galaxy, bo, BuiltObjectMissionType.Move, null, null, BuiltObjectMissionPriority.High, { x, y, manuallyAssigned: true });
}

function moveTo(galaxy: Galaxy, bo: BuiltObject, target: Habitat): void {
    if (isPursuing(galaxy, bo)) return;
    const m = builtObjectMission(bo.mission);
    if (m !== null && m.type === BuiltObjectMissionType.Move && m.targetHabitat === target) return;
    bo.isAutoControlled = false;
    assignMission(galaxy, bo, BuiltObjectMissionType.Move, target, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
}

function attackOrder(galaxy: Galaxy, bo: BuiltObject, target: Habitat, done: Set<ShipGroup>): void {
    if (isPursuing(galaxy, bo)) return;
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

export function patrol(galaxy: Galaxy, bo: BuiltObject, where: Habitat): void {
    if (isPursuing(galaxy, bo)) return; // a capital's pursuit (beaconPursuit.ts) holds its ships' orders until it ends
    const m = builtObjectMission(bo.mission);
    if (m !== null && m.type === BuiltObjectMissionType.Patrol && m.targetHabitat === where) return;
    bo.isAutoControlled = false;
    assignMission(galaxy, bo, BuiltObjectMissionType.Patrol, where, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
}

export function distTo(galaxy: Galaxy, bo: { xpos: number; ypos: number }, x: number, y: number): number {
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
    // ONE WAVE ROLLING OUT FROM THE BEACON: only the nearest ring of worlds (about twice the groups, at least six) is considered, the weight falls
    // steeply with the distance beyond the nearest one, and each pick after the first favours worlds near the first, so a season's groups strike one region.
    const sector = Math.max(1, galaxy.sectorSize);
    const byDist = cands.map((h) => ({ h, d: galaxy.calculateDistance(pos.x, pos.y, h.xpos, h.ypos) })).sort((a, b) => a.d - b.d || a.h.habitatIndex - b.h.habitatIndex);
    const ring = byDist.slice(0, Math.max(6, 2 * k + 2));
    const d0 = ring[0].d;
    const scored = ring.map(({ h, d }) => {
        const def = defenceOf(galaxy, h);
        const near = 1 / (1 + Math.pow(Math.max(0, d - d0) / (1.5 * sector), 2));
        const w = Math.pow(1 + h.population.totalAmount / 1e6, P.targetPopPct(galaxy) / 100) * near * (1 / (1 + def / Math.max(1, share * 1.5)));
        return { habitat: h, defence: def, w };
    });
    const picked: PickedTarget[] = [];
    const usedOwners = new Set<Empire | null>();
    for (let pass = 1; pass < 2 && picked.length < k; pass++) { // (one pass: the owners are NOT spread, the wave takes what lies nearest the Beacon, whoever holds it)
        const pool = scored.filter((s) => !picked.some((p) => p.habitat === s.habitat) && (pass === 1 || !usedOwners.has(s.habitat.empire)));
        while (picked.length < k && pool.length > 0) {
            // later picks cluster round the first one (within a few sectors of it)
            const f = picked.length > 0 ? picked[0].habitat : null;
            const cw = (s: { habitat: Habitat; w: number }): number => (f === null ? s.w : s.w / (1 + Math.pow(galaxy.calculateDistance(f.xpos, f.ypos, s.habitat.xpos, s.habitat.ypos) / (3 * sector), 2)));
            const total = pool.reduce((a, s) => a + cw(s), 0);
            let r = rnd.nextDouble() * total;
            let idx = 0;
            for (; idx < pool.length - 1; idx++) {
                r -= cw(pool[idx]);
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

/** How far from its target's world a group comes out of the beam: outside the system (SYSTEM_RADIUS), clear of the transports' holding point. */
const BEAM_STANDOFF = 70000;

/** Where a group arrives through the beam: BEAM_STANDOFF from its target on the side of the Beacon, inside the galaxy. Pure. */
export function arrivalPoint(galaxy: Galaxy, st: BeaconState, target: Habitat): { x: number; y: number } {
    const pos = beaconPosition(st);
    let dx = pos !== null ? pos.x - target.xpos : 1;
    let dy = pos !== null ? pos.y - target.ypos : 0;
    const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    dx /= len;
    dy /= len;
    return { x: Math.min(galaxy.sizeX - 1000, Math.max(1000, target.xpos + dx * BEAM_STANDOFF)), y: Math.min(galaxy.sizeY - 1000, Math.max(1000, target.ypos + dy * BEAM_STANDOFF)) };
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

export function groupCountFor(galaxy: Galaxy, st: BeaconState, n: number): number {
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
    if (faction === null || pos === null) return false;
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
    // the response fleets' and patrols' share is taken from the strike groups' (beaconResponse.ts)
    const strikeBudget = allotResponse(galaxy, st, budget);
    const staged = stagingPointsFor(galaxy, st, targets.map((t) => t.habitat), P.stagingPoints(galaxy));
    const staging: StagingPoint[] = staged.points.map((pt, i) => ({ index: i, x: pt.x, y: pt.y, name: stagingName(i), knowledge: [], strength: 0, startStrength: 0 }));
    const prep = P.prepMinDays(galaxy) + rnd.nextDouble() * Math.max(0, P.prepMaxDays(galaxy) - P.prepMinDays(galaxy));
    const season: Season = {
        n, phase: 'prep', start: now, end: now + days(prep), staging, groups: [], budget: strikeBudget, spawned: 0, departed: 0, departures: [], plannedTravelDays: 0, prepStart: now, launchAt: now + days(prep),
        freeLeft: Math.min(strikeBudget, P.fundingModel(galaxy) === 1 ? strikeBudget : (scripted * freeShare(galaxy) * strikeBudget) / Math.max(1, budget)),
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
export const WAVE_CYCLE: readonly BuiltObjectSubRole[] = [
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
    batch = foundryBatch(st, batch); // the foundries make the ships from season 2 on: what is made per pass is the living share of the baseline
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
        const at = buildPoint(st, pos);
        const bo = spawnShip(galaxy, faction, design, at.x, at.y);
        noteBirth(st, at, bo);
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
 * all of it; model 0: none). The Beacon's own (drones, BattleBots) are made at `madeAt` when given (the beam brought them in beside the group),
 * else at the Beacon. Returns the strength added.
 */
export function supplyTroops(galaxy: Galaxy, st: BeaconState, g: StrikeGroup, destX: number, destY: number, madeAt: { x: number; y: number } | null = null): number {
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
        for (let i = 0; i < n; i++) ships.push(spawnShip(galaxy, faction, design, from?.xpos ?? (madeAt ?? pos).x, from?.ypos ?? (madeAt ?? pos).y));
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
        for (let i = 0; i < n; i++) ships.push(spawnShip(galaxy, faction, design, (madeAt ?? pos).x, (madeAt ?? pos).y));
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
    spawnWave(galaxy, st, season, season.budget * frac, Math.ceil(WAVE_PER_PASS * passDays(st, now) / 5));
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
    // The Watchers lead the biggest groups' escorts, which stay home as Watcher fleets (they depart only on their own, rarer offensives).
    claimForWatcherFleets(galaxy, st, departing);
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

// ---------------------------------------------------------------------------------------------------------------
// The first mega beam: the war begins, the Watchers decloak, season 1's groups come through
// ---------------------------------------------------------------------------------------------------------------

/**
 * Season 1's countdown (the Great Work is finished): the first mega beam fires in beaconBeamDelayDays (fireBeam). No groups, no staging points: the
 * season is a beam season (isBeamCountdown).
 */
export function startBeamCountdown(galaxy: Galaxy, st: BeaconState): Season {
    const now = galaxyStarDate(galaxy);
    const end = now + days(P.beamDelayDays(galaxy));
    const season: Season = { n: 1, phase: 'prep', start: now, end, staging: [], groups: [], budget: 0, spawned: 0, departed: 0, departures: [], plannedTravelDays: 0, prepStart: now, launchAt: end };
    st.season = season;
    st.seasons.push(season);
    st.stats.seasons++;
    return season;
}

function newGroup(st: BeaconState, season: Season, target: Habitat | null): StrikeGroup {
    return {
        id: target !== null ? st.nextGroupId++ : 0, season: season.n, state: 'gather', target, staging: 0, ships: [], transports: [], lead: null, departDate: 0, arriveDate: 0, siegeStart: 0, landings: 0, fails: 0,
        committed: false, destroyer: null, targetPop: target !== null ? target.population.totalAmount : 0, troopsDone: false, lastReinforce: 0, rolled: false,
    };
}

/**
 * The war begins (the first mega beam, or the Beacon's fall before it): the Reclaimers are at war with every empire, and the Watchers that were
 * mustering decloak (the decloak the art and the pulse follow) to lead their fleets (startWatcherFleets). Idempotent; a save from before the beam is
 * at war already.
 */
export function startWar(galaxy: Galaxy, st: BeaconState): void {
    const faction = st.faction;
    if (faction === null || st.warStarted !== false) return;
    st.warStarted = true;
    const now = galaxyStarDate(galaxy);
    for (const e of normalEmpires(galaxy, faction)) lockWar(galaxy, faction, e);
    startWatcherFleets(galaxy, st);
    st.nextOfferDate = now + days(P.offerFirstDays(galaxy));
}

/**
 * The Watcher fleets that take a share of the beam's budget as escorts (spawned at the Beacon, beside their Watcher). At least one group always
 * strikes (`k` groups planned). Pure.
 */
function escortClaimants(st: BeaconState, k: number): WatcherFleet[] {
    const out: WatcherFleet[] = [];
    for (const f of st.watcherFleets ?? []) {
        if (out.length >= k - 1) break;
        if (liveWatcherShip(st, f) !== null && f.ships.length === 0) out.push(f);
    }
    return out;
}

/**
 * THE FIRST MEGA BEAM (season 1's countdown ended): the war begins (startWar), and the Beacon sends the season's strike groups through: one per
 * target world, each at the full strength of its share of the budget (the free share, then the fleet biofuel), made BEAM_STANDOFF from its world on
 * the Beacon's side, with its troops. The Watcher fleets' escorts are made at the Beacon from the same budget (the share of up to two groups). A
 * season that cannot be paid for or has no target does not come: the beam fires all the same and the next season (a preparation, as every later
 * season) follows the quiet delay. Private Random for the targets only.
 */
export function fireBeam(galaxy: Galaxy, st: BeaconState, season: Season): void {
    const faction = st.faction!;
    const now = galaxyStarDate(galaxy);
    const first = st.warStarted === false;
    startWar(galaxy, st);
    noteFirstBeam(galaxy, st);
    const n = season.n;
    const fullBudget = seasonBudget(galaxy, st, n);
    let budget = fullBudget;
    const scripted = scriptedBudget(galaxy, st, n);
    const kFull = groupCountFor(galaxy, st, n);
    const affordable = P.fundingModel(galaxy) === 1 || budget >= P.minSeasonStrength(galaxy);
    // the response fleets' and patrols' share is taken from the strike groups' (beaconResponse.ts)
    if (affordable) budget = allotResponse(galaxy, st, fullBudget);
    const k = P.fundingModel(galaxy) === 1 ? kFull : Math.max(1, Math.min(kFull, Math.round(budget / Math.max(1, scripted / kFull))));
    const claimants = affordable ? escortClaimants(st, k) : [];
    const targets = affordable ? pickTargets(galaxy, st, k - claimants.length, budget, now) : [];
    season.budget = budget;
    season.spawned = 0;
    season.freeLeft = Math.min(budget, P.fundingModel(galaxy) === 1 ? budget : (scripted * freeShare(galaxy) * budget) / Math.max(1, fullBudget));
    const groups = targets.map((t) => newGroup(st, season, t.habitat));
    const escorts = claimants.map(() => newGroup(st, season, null));
    const pos = beaconPosition(st)!;
    const total = groups.length + escorts.length;
    if (total > 0) {
        const all = [...groups, ...escorts];
        const quota = budget / total;
        const placeOf = (g: StrikeGroup): { x: number; y: number } => (g.target === null ? pos : arrivalPoint(galaxy, st, g.target));
        for (let i = 0; i < 5000 && season.spawned < season.budget && st.stats.spawned < 1_000_000; i++) {
            // paid for: the season's free share first, then the fleet biofuel (an empty account ends the wave)
            if ((season.freeLeft ?? Infinity) <= 0 && fuelOf(st).fleet <= 0) break;
            // the group furthest below its quota gets the next ship
            let g: StrikeGroup | null = null;
            let low = Infinity;
            for (const x of all) {
                const gs = groupStrength(x);
                if (gs < quota && gs < low) {
                    low = gs;
                    g = x;
                }
            }
            if (g === null) break;
            if (aliveShips(g.ships, faction).length >= P.maxSeasonShips(galaxy) / Math.max(1, total) + 6) break;
            const sub = g.ships.length === 0 ? BuiltObjectSubRole.CapitalShip : WAVE_CYCLE[(g.ships.length - 1) % WAVE_CYCLE.length];
            const design = designFor(galaxy, faction, sub) ?? designFor(galaxy, faction, BuiltObjectSubRole.Cruiser);
            if (design === null) break;
            const at = placeOf(g);
            const bo = spawnShip(galaxy, faction, design, at.x, at.y);
            g.ships.push(bo);
            if (g.lead === null || g.lead.hasBeenDestroyed) g.lead = bo;
            const s = strengthOf(bo);
            season.spawned += s;
            if (season.freeLeft !== undefined) {
                const free = Math.min(season.freeLeft, s);
                season.freeLeft -= free;
                if (s > free) payFleet(st, s - free);
            }
            st.stats.spawned++;
            if (!(s > 0)) break;
        }
    }
    claimants.forEach((f, i) => {
        const ships = aliveShips(escorts[i].ships, faction);
        if (ships.length === 0) return;
        for (const b of ships) f.ships.push(b);
        f.formed = f.formed > 0 ? f.formed : now;
        st.stats.wfFormed = (st.stats.wfFormed ?? 0) + 1;
    });
    const departing: StrikeGroup[] = [];
    for (const g of groups) {
        prune(g, faction);
        if (g.ships.length === 0) {
            g.state = 'done';
            continue;
        }
        const hold = holdingPoint(galaxy, g);
        g.troopsDone = true;
        supplyTroops(galaxy, st, g, hold.x, hold.y, arrivalPoint(galaxy, st, g.target!));
        season.groups.push(g);
        departing.push(g);
    }
    // the beam fired, so it is the first launch even if nothing came through (a victory is possible from now on)
    if (first || departing.length > 0) {
        st.launches = (st.launches ?? 0) + 1;
        st.lastLaunchDate = now;
        season.departed = now;
    }
    if (departing.length === 0) {
        // nothing came: the next season (a preparation at staging points) begins after a quiet spell
        season.phase = 'quiet';
        season.start = now;
        season.end = now + days(60);
        st.nextRaidDate = now + days(10);
        return;
    }
    let maxDays = 0;
    for (const g of departing) {
        g.state = 'travel';
        g.departDate = now;
        g.committed = false;
        season.departures.push(now);
        const speed = Math.min(...g.ships.map((b) => b.warpSpeed).filter((sp) => sp > 0), 1e9);
        const lead = g.lead!;
        maxDays = Math.max(maxDays, travelDays(Math.min(speed, 1e8), distTo(galaxy, lead, g.target!.xpos, g.target!.ypos)));
        orderGroup(galaxy, g);
        for (const b of [...g.ships, ...g.transports]) if (distTo(galaxy, b, lead.xpos, lead.ypos) <= 20000) b.beamArrival = now; // the arrival flash (render only)
    }
    season.plannedTravelDays = maxDays;
    season.phase = 'offensive';
    season.start = now;
    season.end = now + days(Math.min(P.offensiveMaxDays(galaxy), Math.max(P.offensiveMinDays(galaxy), maxDays * 1.35 + 60)));
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Beam', onceKey: `Beam${season.n}`, textTag: `${TAG} Beam News`, args: [departing.length] });
    for (const e of normalEmpires(galaxy, faction)) {
        if (!isHumanEmpire(galaxy, e)) continue;
        const mine = departing.filter((g) => g.target?.empire === e);
        if (mine.length > 0) arcMessage(galaxy, st.sentStages, [e], { prefix: TAG, stage: 'Beam Inbound', onceKey: `BeamInbound${season.n}:${e.empireId}`, args: [mine.map((g) => g.target!.name).join(', ')], type: EmpireMessageType.GeneralBadEvent });
    }
    risingWorlds(galaxy, st, season);
}

/**
 * Every game day (a frame periodic: the 5-day pass runs once per stock long block, 36 days at 1x): the first beam fires on the day its countdown
 * ends, so ten days means ten days. The pass itself would fire it late, never early.
 */
export function beamPass(galaxy: Galaxy): void {
    const st = (galaxy.scenario?.state['beacon'] ?? null) as BeaconState | null;
    if (st === null || st.phase !== 'reclamation' || st.faction === null || !st.faction.active || st.beaconDestroyed) return;
    const season = st.season;
    if (season === null || !isBeamCountdown(season)) return;
    if (galaxyStarDate(galaxy) < (season.launchAt ?? season.end)) return;
    if (st.beacon !== null && st.beacon.hasBeenDestroyed) return; // (the pass notices: no beam)
    fireBeam(galaxy, st, season);
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
    // a capital never fights without escorts (foundries, beaconFoundry.ts): with its escorts gone the group falls back to the Beacon
    if (capitalAlone(galaxy, st, g)) {
        foundryStat(st, 'capitalFallbacks');
        return retreat(galaxy, st, g);
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
    if (now < st.nextRaidDate || st.raids.length >= 3) return;
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
    if (foundryBatch(st, 1) < 1) return; // no foundry can make a raider now
    const at = buildPoint(st, pos);
    const ships = designs.slice(0, 2).map((d) => spawnShip(galaxy, faction, d, at.x, at.y));
    for (const b of ships) noteBirth(st, at, b);
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
    if (warOn(st)) {
        for (const e of normalEmpires(galaxy, faction)) {
            if (sparedOrAllied(st, e, now)) continue;
            if (obtainDiplomaticRelation(faction, e).type !== DiplomaticRelationType.War) lockWar(galaxy, faction, e);
        }
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
    // The Harvest Cycle (option gwHarvestCycle): the Long Night begins instead of the end; the galaxy is replaced by the next cycle's (longNight.ts).
    if (beginLongNight(galaxy, st)) return;
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
    const makes = foundryBatch(st, 12);
    for (let i = 0; i < makes && have < want; i++) {
        const paid = have >= freeTo;
        if (paid && fuelOf(st).fleet <= 0) break;
        const sub = WAVE_CYCLE[(st.guards.length + i) % WAVE_CYCLE.length];
        const d = designFor(galaxy, faction, sub);
        if (d === null) break;
        const at = buildPoint(st, pos);
        const bo = spawnShip(galaxy, faction, d, at.x, at.y);
        noteBirth(st, at, bo);
        st.guards.push(bo);
        st.stats.spawned++;
        if (paid) payFleet(st, strengthOf(bo));
        have += strengthOf(bo);
        if (!(strengthOf(bo) > 0)) break;
    }
}

/** Days a roaming guard ship stays on one world's patrol before it moves on to the next. */
const GUARD_ROAM_DAYS = 20;

/**
 * The guard patrols the Beacon's system instead of sitting on the station: one ship in three holds the Beacon's own orbit, the rest take the
 * system's worlds in turn (every GUARD_ROAM_DAYS they shift one world along, so each world and approach is covered), engaging intruders as a
 * stock patrol does. A guard that has strayed far (a chase that ended, a stranded ship) is called back the same way. Rnd: none.
 */
function guardPatrols(galaxy: Galaxy, st: BeaconState): void {
    const pos = beaconPosition(st);
    if (pos === null) return;
    const system = st.site?.system ?? null;
    const star = system?.systemStar ?? null;
    if (star === null) return;
    const hold = st.site?.habitat ?? star;
    const worlds = (system?.habitats ?? []).filter((h) => !h.hasBeenDestroyed && h !== hold);
    const turn = Math.floor((galaxyStarDate(galaxy) - st.completeDate) / days(GUARD_ROAM_DAYS));
    st.guards = aliveShips(st.guards, st.faction);
    st.guards.forEach((b, i) => {
        const strayed = distTo(galaxy, b, pos.x, pos.y) > 40000;
        const m = builtObjectMission(b.mission);
        if (strayed && m !== null && m.type === BuiltObjectMissionType.Attack && m.targetBuiltObject !== null && !m.targetBuiltObject.hasBeenDestroyed) return; // still on a chase
        const to = i % 3 === 0 || worlds.length === 0 ? hold : worlds[(i + turn) % worlds.length];
        patrol(galaxy, b, to);
    });
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
        arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Beacon Destroyed', textTag: `${TAG} Beacon Destroyed News`, args: [empireName(galaxy, st.beaconKillerId)] });
    }
    // the Beacon fell before the first beam: the Reclaimers are at war all the same (the Watchers decloak and lead their fleets), but no launch was ever made
    if (st.beaconDestroyed && st.warStarted === false) startWar(galaxy, st);
    // the Beacon is gone and the Reclamation goes on: its yard, the asset measure, the planet's reveal (beaconComponents.ts)
    partsPass(galaxy, st, now);
    st.reserve = aliveShips(st.reserve, faction);
    const season = st.season;
    if (season === null) {
        if (now >= st.completeDate + days(P.startDelayDays(galaxy))) beginSeason(galaxy, st, 1);
    } else if (isBeamCountdown(season)) {
        if (st.beaconDestroyed) {
            // the Beacon fell before it could fire: no beam; the quiet delay, then the preparation of season 1 as any season
            season.phase = 'quiet';
            season.start = now;
            season.end = now + days(P.quietDays(galaxy));
        } else if (now >= (season.launchAt ?? season.end)) fireBeam(galaxy, st, season); // (beamPass fires it on the day: this is the fallback)
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
        if (now >= season.end) {
            if (!beginSeason(galaxy, st, season.n + 1)) season.end = now + days(60); // nothing to strike: wait a little
        }
    }
    harvestPeriodic(galaxy, st);
    // Groups of every recent season go on until they are done (a siege runs past its season's end).
    for (const s of st.seasons) for (const g of s.groups) if (g.state !== 'gather' && g.state !== 'done') driveGroup(galaxy, st, g);
    drivePlanetDestroyers(galaxy, st);
    driveWatcherFleets(galaxy, st, now);
    driveResponse(galaxy, st, now);
    if (!st.beaconDestroyed && now - (st.guardDate ?? 0) >= days(60)) {
        st.guardDate = now;
        topUpGuard(galaxy, st);
    }
    if (!st.beaconDestroyed) guardPatrols(galaxy, st);
    void faction;
}

// ---------------------------------------------------------------------------------------------------------------
// The Watcher fleets: each living Watcher leads the escorts of one of the two biggest strike groups, defensively
// ---------------------------------------------------------------------------------------------------------------

const YEAR_DAYS = 360;

function watcherOfFleet(st: BeaconState, f: WatcherFleet): WatcherRec | undefined {
    return st.watchers.find((w) => w.index === f.index);
}

function liveWatcherShip(st: BeaconState, f: WatcherFleet): BuiltObject | null {
    const w = watcherOfFleet(st, f);
    if (w === undefined || w.dead || w.ship === null || w.ship.hasBeenDestroyed || w.ship.actualEmpire !== st.faction) return null;
    return w.ship;
}

/** The strength of a Watcher fleet: the Watcher and its live escorts. */
export function watcherFleetStrength(st: BeaconState, f: WatcherFleet): number {
    let s = 0;
    const ws = liveWatcherShip(st, f);
    if (ws !== null) s += strengthOf(ws);
    for (const b of f.ships) if (!b.hasBeenDestroyed) s += strengthOf(b);
    return s;
}

/** The Watcher fleet `ship` leads or belongs to (null when it is none's): the strength of its Watcher and escorts together, for the coalition's odds. */
export function watcherFleetStrengthOf(st: BeaconState, ship: BuiltObject): number | null {
    for (const f of st.watcherFleets ?? []) if (watcherOfFleet(st, f)?.ship === ship) return watcherFleetStrength(st, f);
    return null;
}

/** The next offensive's date: 3 to 4 years from `now` (beaconWatcherFleetOffMinYears..MaxYears), drawn with the Beacon's private Random. */
function nextOffensiveDate(galaxy: Galaxy, st: BeaconState, now: number): number {
    const lo = P.wfOffMinYears(galaxy);
    const hi = P.wfOffMaxYears(galaxy);
    const rnd = beaconRandom(galaxy, st, 301);
    return now + days((lo + rnd.nextDouble() * (hi - lo)) * YEAR_DAYS);
}

/**
 * The first mega beam: every living Watcher decloaks (it was mustering, cloaked, round the Beacon) and becomes the flagship of a Watcher fleet. It
 * has no escorts yet (the beam's budget gives them, at the Beacon, fireBeam; if it gives none, the first departure's biggest groups do): until then
 * it holds the Beacon. No more corruption trips or sightings. With the fleets switched off the Watchers go back to their dark space, still cloaked.
 */
export function startWatcherFleets(galaxy: Galaxy, st: BeaconState): void {
    if (st.faction === null) return;
    const now = galaxyStarDate(galaxy);
    if (!P.wfEnabled(galaxy)) {
        for (const w of st.watchers) if (w.mode === 'muster') {
            w.mode = 'return';
            w.modeDate = now;
        }
        return;
    }
    st.watcherFleets ??= [];
    const star = st.site?.system.systemStar ?? null;
    for (const w of st.watchers) {
        if (w.dead || w.ship === null || w.ship.hasBeenDestroyed || w.ship.actualEmpire !== st.faction) continue;
        if (st.watcherFleets.some((f) => f.index === w.index)) continue;
        w.mode = 'lead';
        w.modeDate = now;
        w.target = null;
        w.attackerShips = [];
        w.prevMode = undefined;
        w.ship.cloaked = false;
        st.watcherFleets.push({ index: w.index, ships: [], mode: 'defence', modeDate: now, nextOffensive: nextOffensiveDate(galaxy, st, now), post: star, target: null, offensives: 0, formed: 0 });
    }
}

/**
 * At a season's departure: each Watcher fleet short of escorts takes the biggest group still departing (its warships; the transports go to
 * the reserve, a later season uses them). The group is done. At least one group always departs. Mutates `departing`.
 */
export function claimForWatcherFleets(galaxy: Galaxy, st: BeaconState, departing: StrikeGroup[]): void {
    const fleets = st.watcherFleets ?? [];
    for (const f of fleets) {
        if (departing.length <= 1) return;
        if (liveWatcherShip(st, f) === null) continue;
        let big: StrikeGroup | null = null;
        let bs = -1;
        for (const g of departing) {
            const s = groupStrength(g);
            if (s > bs) {
                bs = s;
                big = g;
            }
        }
        if (big === null) return;
        const have = f.ships.reduce((a, b) => a + (b.hasBeenDestroyed ? 0 : strengthOf(b)), 0);
        if (f.ships.length > 0 && have >= (bs * P.wfTopUpPct(galaxy)) / 100) continue; // strong enough: it keeps what it has
        departing.splice(departing.indexOf(big), 1);
        for (const b of big.ships) if (!b.hasBeenDestroyed) f.ships.push(b);
        for (const b of big.transports) if (!b.hasBeenDestroyed) st.reserve.push(b);
        big.ships = [];
        big.transports = [];
        big.state = 'done';
        f.formed = f.formed > 0 ? f.formed : galaxyStarDate(galaxy);
        st.stats.wfFormed = (st.stats.wfFormed ?? 0) + 1;
    }
}

/** Enemy (non-Reclaimer, normal empire) warship strength within `range` of a point. Pure. */
export function enemyStrengthNear(galaxy: Galaxy, st: BeaconState, x: number, y: number, range: number): number {
    let s = 0;
    for (const e of normalEmpires(galaxy, st.faction)) {
        for (const b of e.builtObjects) {
            if (b.hasBeenDestroyed || b.role !== BuiltObjectRole.Military || b.topSpeed <= 0 || b.subRole === BuiltObjectSubRole.TroopTransport) continue;
            if (galaxy.calculateDistance(b.xpos, b.ypos, x, y) <= range) s += strengthOf(b);
        }
    }
    return s;
}

/** The worlds a Watcher fleet defends, the default first: the live harvest cores (most people first), else the Beacon's star, else a world the Reclaimers hold. */
export function defencePosts(galaxy: Galaxy, st: BeaconState): Habitat[] {
    const cores = [...liveCores(st)].sort((a, b) => b.waiting + b.received - (a.waiting + a.received) || a.colony.habitatIndex - b.colony.habitatIndex).map((c) => c.colony);
    if (cores.length > 0) return cores;
    const star = st.site?.system.systemStar ?? null;
    if (star !== null && !st.beaconDestroyed) return [star];
    return processingWorlds(st).map((r) => r.colony);
}

/** What a world is worth to an offensive: its people (to the beaconTargetPopPct power, in millions) plus its defenders' strength (in 5 % of the reference military). Pure. */
export function watcherTargetValue(galaxy: Galaxy, st: BeaconState, h: Habitat): number {
    const unit = Math.max(1, referenceMilitary(galaxy, st.faction) * 0.05);
    return Math.pow(1 + h.population.totalAmount / 1e6, P.targetPopPct(galaxy) / 100) + defenceOf(galaxy, h) / unit;
}

/** The most valuable world within reach that is worth the offensive and whose defence the fleet outweighs by beaconWatcherFleetRatioPct %. Pure. */
export function pickWatcherTarget(galaxy: Galaxy, st: BeaconState, f: WatcherFleet, now: number): Habitat | null {
    const ws = liveWatcherShip(st, f);
    if (ws === null) return null;
    const strength = watcherFleetStrength(st, f);
    const reach = P.wfReachSectors(galaxy) * galaxy.sectorSize;
    const taken = new Set<Habitat>();
    for (const o of st.watcherFleets ?? []) if (o !== f && o.target !== null) taken.add(o.target);
    for (const s of st.seasons) for (const g of s.groups) if (g.state !== 'done' && g.target !== null) taken.add(g.target);
    let best: Habitat | null = null;
    let bv = -1;
    for (const h of targetCandidates(galaxy, st, now)) {
        if (taken.has(h) || galaxy.calculateDistance(ws.xpos, ws.ypos, h.xpos, h.ypos) > reach) continue;
        const value = watcherTargetValue(galaxy, st, h);
        if (value < P.wfMinTargetValue(galaxy) || strength * 100 < defenceOf(galaxy, h) * P.wfRatioPct(galaxy)) continue;
        // the wave rolls out from the Beacon: among the worlds worth it, the nearer to the Beacon the better
        const home = beaconPosition(st);
        const score = home === null ? value : value / (1 + Math.pow(galaxy.calculateDistance(home.x, home.y, h.xpos, h.ypos) / (6 * Math.max(1, galaxy.sectorSize)), 2));
        if (score > bv) {
            bv = score;
            best = h;
        }
    }
    return best;
}

function fleetUnits(st: BeaconState, f: WatcherFleet): BuiltObject[] {
    const ws = liveWatcherShip(st, f);
    return ws === null ? f.ships : [ws, ...f.ships];
}

function endOffensive(galaxy: Galaxy, st: BeaconState, f: WatcherFleet, now: number): void {
    st.stats.wfOffensiveDays = (st.stats.wfOffensiveDays ?? 0) + Math.round((now - f.modeDate) / GAME_DAY_LENGTH);
    f.mode = 'defence';
    f.modeDate = now;
    f.target = null;
    f.arrived = 0;
    f.nextOffensive = nextOffensiveDate(galaxy, st, now);
}

/** A Watcher fleet whose Watcher is gone is a normal fleet again: its escorts go home and join the next season's groups. */
function revertWatcherFleet(galaxy: Galaxy, st: BeaconState, f: WatcherFleet): void {
    const home = beaconPosition(st);
    for (const b of f.ships) {
        if (b.hasBeenDestroyed) continue;
        if (home !== null) move(galaxy, b, home.x, home.y);
        st.reserve.push(b);
    }
    f.ships = [];
    st.stats.wfReverted = (st.stats.wfReverted ?? 0) + 1;
}

/** Every pass: each Watcher fleet defends (Patrol) a core, goes to a core an enemy fleet threatens, and now and then goes on an offensive. */
export function driveWatcherFleets(galaxy: Galaxy, st: BeaconState, now: number): void {
    const fleets = st.watcherFleets;
    const faction = st.faction;
    if (fleets === undefined || faction === null || fleets.length === 0) return;
    const posts = defencePosts(galaxy, st);
    const range = P.wfCoreRange(galaxy);
    const worlds = new Map<Habitat, number>();
    const threatened: Habitat[] = [];
    for (const h of posts) {
        const e = enemyStrengthNear(galaxy, st, h.xpos, h.ypos, range);
        worlds.set(h, e);
        if (e > 0) threatened.push(h);
    }
    const covered = new Set<Habitat>();
    for (let i = fleets.length - 1; i >= 0; i--) {
        const f = fleets[i];
        const ws = liveWatcherShip(st, f);
        const before = f.ships.length;
        f.ships = aliveShips(f.ships, faction);
        st.stats.wfShipsLost = (st.stats.wfShipsLost ?? 0) + (before - f.ships.length);
        if (ws === null) {
            revertWatcherFleet(galaxy, st, f);
            fleets.splice(i, 1);
            continue;
        }
        const w = watcherOfFleet(st, f)!;
        if (w.mode !== 'lead') {
            w.mode = 'lead';
            w.attackerShips = [];
        }
        ws.cloaked = false;
    }
    fleets.forEach((f, i) => {
        const ws = liveWatcherShip(st, f)!;
        const units = fleetUnits(st, f);
        if (f.mode === 'offensive') {
            const t = f.target;
            const strength = watcherFleetStrength(st, f);
            const done =
                t === null ||
                t.hasBeenDestroyed ||
                t.empire === faction ||
                now - f.modeDate > days(P.wfOffDays(galaxy)) ||
                strength < (f.startStrength ?? 0) * (1 - P.wfMaxLossPct(galaxy) / 100) ||
                (f.arrived !== undefined && f.arrived > 0 && now - f.arrived > days(15) && defendersNear(galaxy, t.empire, t) <= 0);
            if (done) {
                endOffensive(galaxy, st, f, now);
            } else {
                if ((f.arrived ?? 0) <= 0 && distTo(galaxy, ws, t.xpos, t.ypos) <= ENGAGE_RANGE) f.arrived = now;
                const sg = new Set<ShipGroup>();
                for (const b of units) attackOrder(galaxy, b, t, sg);
                return;
            }
        }
        // DEFENCE: a core an enemy fleet is near (the nearest one nobody else is covering), else the fleet's own core
        let post: Habitat | null = null;
        let bd = Infinity;
        for (const h of threatened) {
            if (covered.has(h)) continue;
            const d = distTo(galaxy, ws, h.xpos, h.ypos);
            if (d < bd) {
                bd = d;
                post = h;
            }
        }
        if (post !== null) {
            if (f.post !== post) st.stats.wfResponses = (st.stats.wfResponses ?? 0) + 1;
        } else if (posts.length > 0) post = posts[i % posts.length];
        if (post === null) post = f.post;
        if (post !== null) covered.add(post);
        f.post = post;
        if (post !== null) for (const b of units) patrol(galaxy, b, post);
        // The offensive: every 3 to 4 years, at the most valuable world within reach that is worth it (else it keeps waiting and looking each pass).
        if (now >= f.nextOffensive && f.ships.length > 0 && !(worlds.get(post as Habitat) ?? 0)) {
            const t = pickWatcherTarget(galaxy, st, f, now);
            if (t !== null) {
                f.mode = 'offensive';
                f.modeDate = now;
                f.target = t;
                f.arrived = 0;
                f.offensives++;
                f.startStrength = watcherFleetStrength(st, f);
                st.stats.wfOffensives = (st.stats.wfOffensives ?? 0) + 1;
                const sg = new Set<ShipGroup>();
                for (const b of units) attackOrder(galaxy, b, t, sg);
                arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Watcher Offensive', onceKey: `WatcherOffensive${f.index}:${f.offensives}`, textTag: `${TAG} Watcher Offensive News`, args: [t.name] });
            }
        }
    });
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

/** The name of the empire with this id ('' for none). */
function empireName(galaxy: Galaxy, id: number | undefined): string {
    return id === undefined ? '' : (galaxy.empires.find((e) => e !== null && e.empireId === id)?.name ?? '');
}
