// Void Whale (Galactic Threats expansion, scenarios/void-whale). Not a port: new scenario behaviour that drives ONE
// unique ported Creature (creature.ts, base type Ardilus: the ported Move / hyper travel / combat / DamageCreature
// stay in charge of movement and fights). Every handler is gated by the `threatVoidWhale` flag (and the threat
// framework's existence lottery), so with the flag off nothing here runs, nothing draws and nothing is saved.
//
// The beast (named "the Leviathan" in game so it is never taken for a New Fauna void whale): from voidWhaleYear years in
// it appears at the galaxy edge and cycles
//   HUNT  fly (sublight, hyper over distance) to the nearest eligible station and SWALLOW it: mining / gas mining /
//         research / monitoring stations, resort and generic bases and small space ports whose system has little
//         defence (never colonies or planets; medium / large ports and defensive bases only while enraged);
//   FLEE  right after feeding it hyper-lunges away (voidWhaleFleeHyperMul x the fastest warship's hyperdrive, spool 1 s;
//         x spoolFactor under a defensive jump-interdiction field) to a quiet, empty system;
//   REST  voidWhaleRestDays there, then hunts again.
// It heals voidWhaleHealPctPerYear of its health a year and a little on each feeding: damage PERSISTS (the stock
// Creature heal is switched off), so repeated fights grind it down. At voidWhaleDeepPct damage it flees to a nebula
// or the galaxy rim, rests voidWhaleDeepRestMonths, and returns enraged for voidWhaleRevengeYears against the empire
// that hurt it most (it may then take defended stations and ports). The empire landing the killing blow gets
// voidWhaleBounty, every other empire thinks better of it (reputation ledger or the stock incident path) and the
// carcass leaves a salvage field (Wreckage & Salvage) or a one-time cargo grant. Each feeding is galaxy news; the
// map shows only the last feeding place and the jump direction.
// AI: empires holding stations in the system of the last feeding keep a defensive base there
// (defensiveBaseLocations); strong AIs near a sighting send idle warships to attack it.
//
// Rnd: only the ported creature code and the creature's construction draw galaxy.rnd, and only in games with the
// add-on (its handlers cannot run otherwise). Picks are deterministic: stations by distance then id, systems by a
// score then index, empires and ships in list order.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { BuiltObject } from '../../builtObject';
import { Creature, CreatureType } from '../../creature';
import { Cargo, ResourceRef } from '../../cargo';
import { Habitat, HabitatCategoryType } from '../../types';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { GalaxyLocationType } from '../../galaxyLocation';
import { stellarAttackers, stellarPursuers } from '../../combat/threats';
import { builtObjectCompleteTeardown } from '../../combat/teardown';
import { assignMission } from '../../missions/assign';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../../missions/mission';
import { startStarDateForAge } from '../../galaxyTime';
import { galaxyStarDate } from '../../tick/simTime';
import { GAME_DAY_LENGTH, gameYear, registerScenarioEvent, registerScenarioFramePeriodic, registerScenarioQuery } from '../hooks';
import { scenarioMessage, scenarioNews, scenarioText } from '../messages';
import { scenarioFlag, scenarioParam } from '../state';
import { isHumanEmpire } from '../../humanEmpires';
import { EmpireMessageType } from '../../messages';
import { applyReputation } from '../reputation/ledger';
import { createWreckField, wreckageState, type WreckRecord } from '../wreckage/common';
import { wreckRecordOf } from '../wreckage/wreckage';
import { interdictingBasesInSystem, interdictionRadius, jumpInterdictionOn, spoolFactor } from '../interdiction/jumpInterdiction';
import { normalEmpires, pastThreatMinYear, peekThreatState, registerThreatExistence, threatExists, threatState } from './framework';

export const VOID_WHALE_KEY = 'voidWhale';
export const VOID_WHALE_FLAG = 'threatVoidWhale';
const TAG = 'VoidWhale';
const WRECKAGE_FLAG = 'wreckage';
/** The creature's in-game name (a New Fauna "Void Whale" is a different, harmless animal). */
export const VOID_WHALE_NAME = 'The Leviathan';
/** Within this of its prey (hyper exit scatter is 3000) the beast swallows. */
const SWALLOW_RANGE = 6000;
const ARRIVE_RANGE = 9000;
const MS_PER_YEAR_DAYS = 360;

export type WhaleMode = 'hunt' | 'flee' | 'rest' | 'deep' | 'deepRest';

export interface WhaleSighting {
    x: number;
    y: number;
    systemIndex: number;
    date: number;
    /** Unit vector of the jump away. */
    dx: number;
    dy: number;
    seq: number;
}

export interface VoidWhaleState {
    phase: 'waiting' | 'active' | 'ended';
    creature: Creature | null;
    mode: WhaleMode;
    modeDate: number;
    restUntil: number;
    target: BuiltObject | null;
    destX: number;
    destY: number;
    /** Largest share of its health ever lost (0..1): the wounds that exist. */
    peakFrac: number;
    lastDamageFrac: number;
    grudge: { empireId: number; damage: number }[];
    lastDamagerId: number;
    revengeEmpireId: number;
    revengeUntil: number;
    lastSeen: WhaleSighting | null;
    sightSeq: number;
    huntedSeq: number;
    swallowed: number;
    swallowedNames: string[];
    embedded: WreckRecord[];
    /** Render cues: bumped on each swallow / jump; the layer plays the animation when it changes. */
    lungeSeq: number;
    jumpSeq: number;
    lastDay: number;
    interdictedJumps: number;
    killer: Empire | null;
    killDate: number;
    bountyPaid: number;
    history: { year: number; swallowed: number; damagePct: number; mode: WhaleMode }[];
}

function newState(): VoidWhaleState {
    return {
        phase: 'waiting', creature: null, mode: 'hunt', modeDate: 0, restUntil: 0, target: null, destX: 0, destY: 0, peakFrac: 0, lastDamageFrac: 0,
        grudge: [], lastDamagerId: -1, revengeEmpireId: -1, revengeUntil: 0, lastSeen: null, sightSeq: 0, huntedSeq: 0, swallowed: 0, swallowedNames: [],
        embedded: [], lungeSeq: 0, jumpSeq: 0, lastDay: 0, interdictedJumps: 0, killer: null, killDate: 0, bountyPaid: 0, history: [],
    };
}

export function voidWhaleState(galaxy: Galaxy): VoidWhaleState {
    return threatState(galaxy, VOID_WHALE_KEY, newState);
}

export function peekVoidWhaleState(galaxy: Galaxy): VoidWhaleState | null {
    return peekThreatState<VoidWhaleState>(galaxy, VOID_WHALE_KEY);
}

function p(galaxy: Galaxy, name: string, fallback: number): number {
    return scenarioParam(galaxy, name, fallback);
}
const P = {
    year: (g: Galaxy) => p(g, 'voidWhaleYear', 5),
    size: (g: Galaxy) => Math.trunc(p(g, 'voidWhaleSize', 2800)),
    maxSize: (g: Galaxy) => Math.trunc(p(g, 'voidWhaleMaxSize', 4500)),
    growPct: (g: Galaxy) => p(g, 'voidWhaleGrowPct', 4),
    strengthDiv: (g: Galaxy) => Math.max(1, p(g, 'voidWhaleStrengthDiv', 14)),
    healthMul: (g: Galaxy) => Math.max(0.1, p(g, 'voidWhaleHealthMul', 10)),
    speed: (g: Galaxy) => p(g, 'voidWhaleSpeed', 60),
    huntHyper: (g: Galaxy) => p(g, 'voidWhaleHuntHyperSpeed', 9000),
    fleeMul: (g: Galaxy) => p(g, 'voidWhaleFleeHyperMul', 3),
    restDays: (g: Galaxy) => p(g, 'voidWhaleRestDays', 90),
    healFeedPct: (g: Galaxy) => p(g, 'voidWhaleHealPerFeedPct', 6),
    healYearPct: (g: Galaxy) => p(g, 'voidWhaleHealPctPerYear', 15),
    deepPct: (g: Galaxy) => p(g, 'voidWhaleDeepPct', 70),
    deepRestDays: (g: Galaxy) => p(g, 'voidWhaleDeepRestMonths', 18) * 30,
    revengeDays: (g: Galaxy) => p(g, 'voidWhaleRevengeYears', 2) * MS_PER_YEAR_DAYS,
    bounty: (g: Galaxy) => p(g, 'voidWhaleBounty', 500000),
    repBoost: (g: Galaxy) => p(g, 'voidWhaleRepBoost', 10),
    carcassResources: (g: Galaxy) => p(g, 'voidWhaleCarcassResources', 6000),
    carcassValue: (g: Galaxy) => p(g, 'voidWhaleCarcassValue', 400000),
    maxFirepower: (g: Galaxy) => p(g, 'voidWhaleMaxTargetFirepower', 400),
    huntRange: (g: Galaxy) => (p(g, 'voidWhaleHuntRangePct', 30) * g.sizeX) / 100,
    huntMinShips: (g: Galaxy) => Math.trunc(p(g, 'voidWhaleHuntMinShips', 6)),
    huntShips: (g: Galaxy) => Math.trunc(p(g, 'voidWhaleHuntShips', 8)),
};

/** Stations a calm beast takes; enraged it also takes the rest of the bases (not planets or colonies). */
const CALM_PREY = new Set<BuiltObjectSubRole>([
    BuiltObjectSubRole.GasMiningStation,
    BuiltObjectSubRole.MiningStation,
    BuiltObjectSubRole.EnergyResearchStation,
    BuiltObjectSubRole.WeaponsResearchStation,
    BuiltObjectSubRole.HighTechResearchStation,
    BuiltObjectSubRole.MonitoringStation,
    BuiltObjectSubRole.ResortBase,
    BuiltObjectSubRole.GenericBase,
    BuiltObjectSubRole.SmallSpacePort,
]);

function yearsIn(galaxy: Galaxy): number {
    return gameYear(galaxyStarDate(galaxy)) - gameYear(startStarDateForAge(galaxy.age));
}

function dist(g: Galaxy, ax: number, ay: number, bx: number, by: number): number {
    return g.calculateDistance(ax, ay, bx, by);
}

function hash01(a: number, b: number): number {
    let h = Math.imul(a * 2654435761 + b * 40503 + 1, 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 15), 0xc2b2ae35);
    h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
}

function healthFrac(c: Creature): number {
    return c.damageKillThreshold > 0 ? Math.max(0, Math.min(1.5, c.damage / c.damageKillThreshold)) : 0;
}

function allEmpires(galaxy: Galaxy): Empire[] {
    return [...galaxy.empires, ...galaxy.pirateEmpires].filter((e): e is Empire => e != null);
}

function empireById(galaxy: Galaxy, id: number): Empire | null {
    return id < 0 ? null : (allEmpires(galaxy).find((e) => e.empireId === id) ?? null);
}

function systemHasColony(galaxy: Galaxy, systemIndex: number): boolean {
    for (const h of galaxy.systemHabitatsOf(systemIndex)) {
        if ((h.category === HabitatCategoryType.Planet || h.category === HabitatCategoryType.Moon) && h.empire !== null && h.empire !== galaxy.independentEmpire && h.population.totalAmount > 0) return true;
    }
    return false;
}

// ---------------------------------------------------------------------------------------------------------------
// The creature
// ---------------------------------------------------------------------------------------------------------------

function applyStats(galaxy: Galaxy, c: Creature): void {
    c.size = Math.min(c.size, P.maxSize(galaxy));
    c.maxSize = P.maxSize(galaxy);
    c.attackStrength = Math.trunc(c.size / P.strengthDiv(galaxy));
    c.damageKillThreshold = Math.trunc(c.size * P.healthMul(galaxy));
    c.healRate = 0; // damage persists: this module heals it (voidWhaleHealPctPerYear)
    const speed = Math.fround(P.speed(galaxy));
    c.movementSpeed = speed;
    c.movementSpeedBase = speed;
    c.accelerationRate = 12;
    c.turnRate = Math.fround(0.6);
    c.attackRange = 2500;
    c.locationLocked = true;
    c.canHide = false;
    c.isVisible = true;
    c.lungeSpeed = 0;
    c.lungeSpeedBase = 0;
    c.name = VOID_WHALE_NAME;
}

/** The galaxy-edge system farthest from the centre with no colony and no empire base (index order breaks ties). Pure. */
export function voidWhaleSpawnSystem(galaxy: Galaxy): Habitat | null {
    const cx = galaxy.sizeX / 2;
    const cy = galaxy.sizeY / 2;
    const busy = new Set<number>();
    for (const bo of galaxy.builtObjects) {
        if (bo != null && !bo.hasBeenDestroyed && bo.role === BuiltObjectRole.Base && bo.nearestSystemStar !== null) busy.add(bo.nearestSystemStar.systemIndex);
    }
    let best: Habitat | null = null;
    let bestD = -1;
    for (let i = 0; i < galaxy.systems.length; i++) {
        const star = galaxy.systems[i].systemStar;
        if (busy.has(i) || systemHasColony(galaxy, i)) continue;
        const d = dist(galaxy, star.xpos, star.ypos, cx, cy);
        if (d > bestD) {
            bestD = d;
            best = star;
        }
    }
    return best;
}

function registerInSystem(galaxy: Galaxy, c: Creature): void {
    const star = galaxy.fastFindNearestSystem(c.xpos, c.ypos);
    if (star !== null && dist(galaxy, c.xpos, c.ypos, star.xpos, star.ypos) < 25000) {
        c.nearestSystemStar = star;
        const sys = galaxy.systems[star.systemIndex];
        if (!sys.creatures) sys.creatures = [];
        if (!sys.creatures.includes(c)) sys.creatures.push(c);
    }
}

/** Wakes the beast at `star` (tests force it). */
export function voidWhaleWake(galaxy: Galaxy, st: VoidWhaleState, star: Habitat): boolean {
    const x = star.xpos + 16000;
    const y = star.ypos;
    const c = new Creature(galaxy, CreatureType.Ardilus, null, 0, 0, { x: Math.trunc(x), y: Math.trunc(y) }, 4000);
    c.xpos = x;
    c.ypos = y;
    c.size = P.size(galaxy);
    applyStats(galaxy, c);
    c.hyperSpeed = P.huntHyper(galaxy);
    galaxy.creatures.push(c);
    registerInSystem(galaxy, c);
    st.creature = c;
    st.phase = 'active';
    st.mode = 'rest';
    st.modeDate = galaxyStarDate(galaxy);
    st.restUntil = st.modeDate + 20 * GAME_DAY_LENGTH;
    return true;
}

function setDestination(c: Creature, x: number, y: number, range: number): void {
    if (c.anchorPoint === null) c.anchorPoint = { x: Math.trunc(x), y: Math.trunc(y) };
    c.anchorPoint.x = Math.trunc(x);
    c.anchorPoint.y = Math.trunc(y);
    c.anchorRange = range;
    c.anchorHabitat = null;
    if (c.currentSpeed <= c.movementSpeed) c.parentHabitat = null;
    c.parentOffsetX = 0;
    c.parentOffsetY = 0;
    c.targetSpeed = c.movementSpeed;
}

function endFight(c: Creature): void {
    const t = c.currentTarget;
    if (t !== null) {
        const pu = stellarPursuers(t);
        const at = stellarAttackers(t);
        const i = pu.indexOf(c);
        if (i >= 0) pu.splice(i, 1);
        const j = at.indexOf(c);
        if (j >= 0) at.splice(j, 1);
    }
    c.currentTarget = null;
    c.attackers.length = 0;
}

/** The fastest hyperdrive among the empires' warships (floor 4000): "normal hyper speed" for the flee jump. Pure. */
export function referenceHyperSpeed(galaxy: Galaxy): number {
    let best = 4000;
    for (const e of galaxy.empires) {
        if (e == null || !e.active) continue;
        for (const b of e.builtObjects) if (b.role === BuiltObjectRole.Military && b.warpSpeed > best) best = b.warpSpeed;
    }
    return best;
}

// ---------------------------------------------------------------------------------------------------------------
// Hunting
// ---------------------------------------------------------------------------------------------------------------

function systemDefence(galaxy: Galaxy): Map<number, number> {
    const out = new Map<number, number>();
    for (const bo of galaxy.builtObjects) {
        if (bo == null || bo.hasBeenDestroyed || bo.role !== BuiltObjectRole.Base || bo.nearestSystemStar === null) continue;
        const i = bo.nearestSystemStar.systemIndex;
        out.set(i, (out.get(i) ?? 0) + bo.firepowerRaw);
    }
    return out;
}

function enraged(galaxy: Galaxy, st: VoidWhaleState): boolean {
    return st.revengeEmpireId >= 0 && galaxyStarDate(galaxy) < st.revengeUntil;
}

/** The next prey: the nearest eligible station (revenge: the grudge empire's first). Pure. */
export function voidWhalePickTarget(galaxy: Galaxy, st: VoidWhaleState): BuiltObject | null {
    const c = st.creature;
    if (c === null) return null;
    const rage = enraged(galaxy, st);
    const defence = systemDefence(galaxy);
    const maxFp = P.maxFirepower(galaxy);
    let best: BuiltObject | null = null;
    let bestKey = Number.MAX_VALUE;
    for (const bo of galaxy.builtObjects) {
        if (bo == null || bo.hasBeenDestroyed || bo.role !== BuiltObjectRole.Base) continue;
        const owner = bo.actualEmpire;
        if (owner === null || owner === galaxy.independentEmpire || bo.nearestSystemStar === null) continue;
        if (!rage && !CALM_PREY.has(bo.subRole)) continue;
        if (rage && (bo.subRole === BuiltObjectSubRole.Undefined || bo.parentHabitat === null)) continue;
        const sys = bo.nearestSystemStar.systemIndex;
        if (!rage && ((defence.get(sys) ?? 0) > maxFp || systemHasColony(galaxy, sys))) continue;
        let key = dist(galaxy, c.xpos, c.ypos, bo.xpos, bo.ypos);
        if (rage && owner.empireId === st.revengeEmpireId) key -= 1e12;
        if (key < bestKey || (key === bestKey && best !== null && bo.builtObjectID < best.builtObjectID)) {
            bestKey = key;
            best = bo;
        }
    }
    return best;
}

function compass(dx: number, dy: number): string {
    // Screen / galaxy y grows downward: north is -y.
    const ang = Math.atan2(-dy, dx);
    const names = ['east', 'northeast', 'north', 'northwest', 'west', 'southwest', 'south', 'southeast'];
    return names[((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8];
}

/** A quiet destination: an empty, base-free system 8-50% of the galaxy width away (score: little population, then a hash). Pure. */
export function voidWhaleQuietSystem(galaxy: Galaxy, st: VoidWhaleState): Habitat | null {
    const c = st.creature;
    if (c === null) return null;
    const busy = new Map<number, number>();
    for (const bo of galaxy.builtObjects) {
        if (bo != null && !bo.hasBeenDestroyed && bo.nearestSystemStar !== null && bo.role === BuiltObjectRole.Base) busy.set(bo.nearestSystemStar.systemIndex, (busy.get(bo.nearestSystemStar.systemIndex) ?? 0) + 1);
    }
    const lo = 0.08 * galaxy.sizeX;
    const hi = 0.5 * galaxy.sizeX;
    let best: Habitat | null = null;
    let bestScore = Number.MAX_VALUE;
    for (let pass = 0; pass < 2 && best === null; pass++) {
        for (let i = 0; i < galaxy.systems.length; i++) {
            const star = galaxy.systems[i].systemStar;
            const d = dist(galaxy, c.xpos, c.ypos, star.xpos, star.ypos);
            if (pass === 0 && (d < lo || d > hi)) continue;
            if (d < 20000 || systemHasColony(galaxy, i)) continue;
            let pop = 0;
            for (const h of galaxy.systemHabitatsOf(i)) pop += h.population.totalAmount;
            const score = pop / 1000 + (busy.get(i) ?? 0) * 1000 + hash01(st.swallowed + 1, i) * 50;
            if (score < bestScore) {
                bestScore = score;
                best = star;
            }
        }
    }
    return best;
}

/** Deep space: the nearest nebula to the galaxy rim, else the rim point farthest from every colony. Pure. */
export function voidWhaleDeepPoint(galaxy: Galaxy, st: VoidWhaleState): { x: number; y: number } {
    const c = st.creature!;
    let best: { x: number; y: number } | null = null;
    let bestD = Number.MAX_VALUE;
    for (const loc of galaxy.galaxyLocations) {
        if (loc.type !== GalaxyLocationType.NebulaCloud) continue;
        const ctr = loc.resolveLocationCenter();
        const d = dist(galaxy, c.xpos, c.ypos, ctr.x, ctr.y);
        if (d > 0.05 * galaxy.sizeX && d < bestD) {
            bestD = d;
            best = { x: ctr.x, y: ctr.y };
        }
    }
    if (best !== null) return best;
    // Rim: the point on the galaxy edge opposite the nearest colony cluster is too fancy; use the corner farthest from the capitals.
    const corners = [
        { x: 0.04 * galaxy.sizeX, y: 0.04 * galaxy.sizeY },
        { x: 0.96 * galaxy.sizeX, y: 0.04 * galaxy.sizeY },
        { x: 0.04 * galaxy.sizeX, y: 0.96 * galaxy.sizeY },
        { x: 0.96 * galaxy.sizeX, y: 0.96 * galaxy.sizeY },
    ];
    let bestMin = -1;
    for (const k of corners) {
        let m = Number.MAX_VALUE;
        for (const e of normalEmpires(galaxy)) if (e.capital !== null) m = Math.min(m, dist(galaxy, k.x, k.y, e.capital.xpos, e.capital.ypos));
        if (m > bestMin) {
            bestMin = m;
            best = k;
        }
    }
    return best!;
}

function startFlee(galaxy: Galaxy, st: VoidWhaleState, c: Creature, x: number, y: number, mode: 'flee' | 'deep'): void {
    endFight(c);
    st.target = null;
    st.mode = mode;
    st.modeDate = galaxyStarDate(galaxy);
    st.destX = x;
    st.destY = y;
    const fleeSpeed = Math.round(referenceHyperSpeed(galaxy) * P.fleeMul(galaxy));
    c.hyperSpeed = Math.max(c.hyperSpeed, fleeSpeed);
    // Near-instant spool (1 s); a defensive jump-interdiction field around it multiplies the spool like any hostile ship's.
    let spoolMs = 1000;
    if (jumpInterdictionOn(galaxy) && c.nearestSystemStar !== null) {
        for (const b of interdictingBasesInSystem(galaxy, c.nearestSystemStar.systemIndex)) {
            if (dist(galaxy, c.xpos, c.ypos, b.xpos, b.ypos) <= interdictionRadius(galaxy, b)) {
                spoolMs = Math.round(spoolMs * spoolFactor(galaxy));
                st.interdictedJumps++;
                break;
            }
        }
    }
    c.hyperCountdown = spoolMs;
    setDestination(c, x, y, 3000);
    st.jumpSeq++;
}

function swallow(galaxy: Galaxy, st: VoidWhaleState, c: Creature, prey: BuiltObject): void {
    const now = galaxyStarDate(galaxy);
    const star = prey.nearestSystemStar;
    const systemName = star !== null ? star.name : '?';
    const preyName = prey.name;
    const owner = prey.actualEmpire;
    const px = prey.xpos;
    const py = prey.ypos;
    const sys = star !== null ? star.systemIndex : -1;
    if (scenarioFlag(galaxy, WRECKAGE_FLAG) && st.embedded.length < 14) {
        const rec = wreckRecordOf(galaxy, prey, wreckageState(galaxy).nextWreckId);
        if (rec !== null) {
            wreckageState(galaxy).nextWreckId++;
            st.embedded.push(rec);
        }
    }
    // The prey is removed whole (no wreck, no killed-by event): the beast has it.
    builtObjectCompleteTeardown(galaxy, prey);
    st.swallowed++;
    st.swallowedNames.push(preyName);
    if (st.swallowedNames.length > 12) st.swallowedNames.shift();
    st.lungeSeq++;
    // Heals a bit and grows slightly (capped).
    c.damage = Math.max(0, c.damage - (c.damageKillThreshold * P.healFeedPct(galaxy)) / 100);
    c.size = Math.min(P.maxSize(galaxy), Math.round(c.size * (1 + P.growPct(galaxy) / 100)));
    c.attackStrength = Math.trunc(c.size / P.strengthDiv(galaxy));
    c.damageKillThreshold = Math.trunc(c.size * P.healthMul(galaxy));
    // Flee to a quiet system.
    const dest = voidWhaleQuietSystem(galaxy, st);
    const ang = hash01(st.swallowed, 7) * Math.PI * 2;
    const tx = dest !== null ? dest.xpos + Math.cos(ang) * 14000 : c.xpos + 400000;
    const ty = dest !== null ? dest.ypos + Math.sin(ang) * 14000 : c.ypos;
    const len = Math.max(1, dist(galaxy, c.xpos, c.ypos, tx, ty));
    const dx = (tx - c.xpos) / len;
    const dy = (ty - c.ypos) / len;
    st.lastSeen = { x: px, y: py, systemIndex: sys, date: now, dx, dy, seq: ++st.sightSeq };
    scenarioNews(galaxy, null, scenarioText(`${TAG} Swallowed`, preyName, systemName, compass(dx, dy)), () => true, null);
    if (owner !== null && isHumanEmpire(galaxy, owner)) {
        scenarioMessage(galaxy, owner, scenarioText(`${TAG} Lost Title`), scenarioText(`${TAG} Lost`, preyName, systemName), { type: EmpireMessageType.GeneralBadEvent, popup: false });
    }
    startFlee(galaxy, st, c, tx, ty, 'flee');
    huntOrders(galaxy, st);
}

function chooseHunt(galaxy: Galaxy, st: VoidWhaleState): void {
    st.mode = 'hunt';
    st.modeDate = galaxyStarDate(galaxy);
    st.target = voidWhalePickTarget(galaxy, st);
    const c = st.creature!;
    c.hyperSpeed = P.huntHyper(galaxy);
    if (st.target === null) {
        st.mode = 'rest';
        st.restUntil = st.modeDate + 15 * GAME_DAY_LENGTH;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// AI response
// ---------------------------------------------------------------------------------------------------------------

/** Strong AIs near a fresh sighting send idle warships after the beast (once per sighting). Deterministic. */
function huntOrders(galaxy: Galaxy, st: VoidWhaleState): void {
    const c = st.creature;
    const seen = st.lastSeen;
    if (c === null || seen === null || st.huntedSeq >= seen.seq) return;
    st.huntedSeq = seen.seq;
    const range = P.huntRange(galaxy);
    for (const e of galaxy.empires) {
        if (e == null || !e.active || isHumanEmpire(galaxy, e) || e === galaxy.independentEmpire || e.capital === null) continue;
        if (dist(galaxy, e.capital.xpos, e.capital.ypos, seen.x, seen.y) > range) continue;
        const ships = e.builtObjects.filter((b) => !b.hasBeenDestroyed && b.role === BuiltObjectRole.Military && b.topSpeed > 0);
        if (ships.length < P.huntMinShips(galaxy)) continue;
        let sent = 0;
        for (const s of ships) {
            if (sent >= P.huntShips(galaxy)) break;
            const m = builtObjectMission(s.mission);
            if (m !== null && m.type !== BuiltObjectMissionType.Undefined && m.type !== BuiltObjectMissionType.Hold && m.type !== BuiltObjectMissionType.Patrol) continue;
            assignMission(galaxy, s, BuiltObjectMissionType.Attack, c, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
            sent++;
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Death and rewards
// ---------------------------------------------------------------------------------------------------------------

function addToHold(bo: BuiltObject, resourceId: number, amount: number): number {
    if (bo.cargo === null || resourceId < 0 || amount <= 0) return 0;
    const a = Math.trunc(amount);
    const have = bo.cargo.items.find((c) => c.commodity.resourceId === resourceId && c.commodityComponent === null && c.empire === bo.empire);
    if (have !== undefined) have.amount += a;
    else bo.cargo.add(new Cargo(new ResourceRef(resourceId), a, bo.empire));
    return a;
}

function resourceIdByName(galaxy: Galaxy, name: string): number {
    const r = galaxy.resourceSystem.resources.find((x) => x !== null && x !== undefined && x.name === name);
    return r === undefined ? -1 : r.resourceId;
}

function topGrudge(st: VoidWhaleState): number {
    let best = -1;
    let bestD = 0;
    for (const g of st.grudge) {
        if (g.damage > bestD || (g.damage === bestD && best >= 0 && g.empireId < best)) {
            bestD = g.damage;
            best = g.empireId;
        }
    }
    return best;
}

/** The kill: bounty to the killer, reputation from the others, the carcass (salvage field or cargo), news. Idempotent. */
export function voidWhaleSlain(galaxy: Galaxy, st: VoidWhaleState, killer: Empire | null, x: number, y: number): void {
    if (st.phase === 'ended') return;
    st.phase = 'ended';
    st.killDate = galaxyStarDate(galaxy);
    const real = killer !== null && killer.active && killer !== galaxy.independentEmpire && killer.pirateEmpireBaseHabitat === null ? killer : null;
    st.killer = real;
    if (real !== null) {
        const bounty = P.bounty(galaxy);
        real.stateMoney += bounty;
        st.bountyPaid = bounty;
        for (const e of normalEmpires(galaxy, real)) applyReputation(galaxy, e, real, P.repBoost(galaxy), { cause: 'voidWhale.slayer', labelKey: 'Reputation Cause voidWhale.slayer', source: 'void-whale', legacy: 'factored', decayPerYear: 1 });
        if (isHumanEmpire(galaxy, real)) scenarioMessage(galaxy, real, scenarioText(`${TAG} Bounty Title`), scenarioText(`${TAG} Bounty`, Math.round(bounty).toLocaleString('en-US')), { type: EmpireMessageType.GeneralGoodEvent, popup: false });
    }
    if (scenarioFlag(galaxy, WRECKAGE_FLAG)) {
        const w = wreckageState(galaxy);
        const field = createWreckField(galaxy, x, y);
        const steel = resourceIdByName(galaxy, 'Steel');
        const parts = 6;
        const now = galaxyStarDate(galaxy);
        for (let i = 0; i < parts; i++) {
            field.wrecks.push({
                id: w.nextWreckId++, builtObjectId: -1, name: scenarioText(`${TAG} Carcass Part`, i + 1), designName: scenarioText(`${TAG} Carcass Design`), role: 0, subRole: 0,
                ownerEmpireId: -1, ownerName: '', x, y, size: 1000, componentIds: [],
                resources: steel >= 0 ? [{ resourceId: steel, amount: Math.round(P.carcassResources(galaxy) / parts) }] : [],
                value: Math.round(P.carcassValue(galaxy) / parts), starDate: now,
            });
            w.stats.wrecks++;
        }
        for (const rec of st.embedded) {
            rec.id = w.nextWreckId++;
            rec.x = x;
            rec.y = y;
            rec.starDate = now;
            field.wrecks.push(rec);
            w.stats.wrecks++;
        }
        st.embedded = [];
    } else {
        // No salvage add-on: a one-time grant of the carcass haul into the killer's nearest holds.
        const ships = real !== null ? real.builtObjects.filter((b) => !b.hasBeenDestroyed && b.cargo !== null && b.cargoCapacity > 0) : [];
        let nearest: BuiltObject | null = null;
        let nd = Number.MAX_VALUE;
        for (const s of ships) {
            const d = dist(galaxy, s.xpos, s.ypos, x, y);
            if (d < nd) {
                nd = d;
                nearest = s;
            }
        }
        if (nearest !== null) addToHold(nearest, resourceIdByName(galaxy, 'Steel'), P.carcassResources(galaxy));
        else if (real !== null) real.stateMoney += P.carcassValue(galaxy);
    }
    scenarioNews(galaxy, null, scenarioText(`${TAG} Slain`, real?.name ?? scenarioText(`${TAG} Unknown Slayer`)), () => true, null);
}

// ---------------------------------------------------------------------------------------------------------------
// Periodic driver (daily)
// ---------------------------------------------------------------------------------------------------------------

function trackDamage(galaxy: Galaxy, st: VoidWhaleState, c: Creature): void {
    const f = healthFrac(c);
    if (f > st.peakFrac) st.peakFrac = Math.min(1, f);
    st.lastDamageFrac = f;
}

export function voidWhalePeriodic(galaxy: Galaxy): void {
    if (!threatExists(galaxy, VOID_WHALE_KEY)) return;
    const st = voidWhaleState(galaxy);
    if (st.phase === 'ended') return;
    const now = galaxyStarDate(galaxy);
    if (st.phase === 'waiting') {
        if (yearsIn(galaxy) < P.year(galaxy) || !pastThreatMinYear(galaxy, VOID_WHALE_KEY)) return;
        const star = voidWhaleSpawnSystem(galaxy);
        if (star === null || !voidWhaleWake(galaxy, st, star)) st.phase = 'ended';
        st.lastDay = now;
        return;
    }
    const c = st.creature;
    if (c === null) {
        st.phase = 'ended';
        return;
    }
    if (c.hasBeenDestroyed || !galaxy.creatures.includes(c)) {
        const killer = empireById(galaxy, st.lastDamagerId);
        voidWhaleSlain(galaxy, st, c.hasBeenDestroyed ? killer : null, c.xpos, c.ypos);
        return;
    }
    // Slow persistent healing (twice as fast resting, three times as fast in a deep rest).
    const days = Math.max(0, (now - st.lastDay) / GAME_DAY_LENGTH);
    st.lastDay = now;
    if (c.damage > 0 && days > 0) {
        const mul = st.mode === 'deepRest' ? 3 : st.mode === 'rest' ? 2 : 1;
        c.damage = Math.max(0, c.damage - (c.damageKillThreshold * P.healYearPct(galaxy) * mul * days) / (100 * MS_PER_YEAR_DAYS));
    }
    trackDamage(galaxy, st, c);
    const frac = healthFrac(c);
    // Badly hurt: break off and run for deep space.
    if (st.mode !== 'deep' && st.mode !== 'deepRest' && frac >= P.deepPct(galaxy) / 100) {
        const pt = voidWhaleDeepPoint(galaxy, st);
        startFlee(galaxy, st, c, pt.x, pt.y, 'deep');
        scenarioNews(galaxy, null, scenarioText(`${TAG} Wounded`), () => true, null);
        return;
    }
    const arrived = dist(galaxy, c.xpos, c.ypos, st.destX, st.destY) < ARRIVE_RANGE && c.currentSpeed <= c.movementSpeed;
    switch (st.mode) {
        case 'flee':
            // A defended beast keeps its heading; one that was caught in a fight stays with it.
            if (c.currentTarget !== null && c.currentSpeed <= c.movementSpeed) endFight(c);
            if (c.targetSpeed <= 0 && c.currentSpeed <= 0) setDestination(c, st.destX, st.destY, 3000);
            if (arrived) {
                c.hyperSpeed = P.huntHyper(galaxy);
                st.mode = 'rest';
                st.modeDate = now;
                st.restUntil = now + P.restDays(galaxy) * GAME_DAY_LENGTH;
                c.anchorRange = 6000;
            }
            break;
        case 'deep':
            if (c.currentTarget !== null && c.currentSpeed <= c.movementSpeed) endFight(c);
            if (c.targetSpeed <= 0 && c.currentSpeed <= 0) setDestination(c, st.destX, st.destY, 3000);
            if (arrived) {
                c.hyperSpeed = P.huntHyper(galaxy);
                st.mode = 'deepRest';
                st.modeDate = now;
                st.restUntil = now + P.deepRestDays(galaxy) * GAME_DAY_LENGTH;
                c.anchorRange = 6000;
            }
            break;
        case 'rest':
        case 'deepRest':
            if (now >= st.restUntil) {
                if (st.mode === 'deepRest') {
                    const id = topGrudge(st);
                    st.revengeEmpireId = id;
                    st.revengeUntil = now + P.revengeDays(galaxy) * GAME_DAY_LENGTH;
                    const target = empireById(galaxy, id);
                    if (target !== null) scenarioNews(galaxy, null, scenarioText(`${TAG} Returns`, target.name), () => true, null);
                }
                chooseHunt(galaxy, st);
            }
            break;
        case 'hunt': {
            const prey = st.target;
            if (prey === null || prey.hasBeenDestroyed) {
                chooseHunt(galaxy, st);
                break;
            }
            if (dist(galaxy, c.xpos, c.ypos, prey.xpos, prey.ypos) <= SWALLOW_RANGE && c.currentSpeed <= c.movementSpeed) {
                swallow(galaxy, st, c, prey);
                break;
            }
            // A fight in progress is left to the ported creature code; otherwise keep flying at the prey.
            if (c.currentTarget === null) setDestination(c, prey.xpos, prey.ypos, 3000);
            break;
        }
    }
    if (st.history.length === 0 || st.history[st.history.length - 1].year < yearsIn(galaxy)) {
        st.history.push({ year: yearsIn(galaxy), swallowed: st.swallowed, damagePct: Math.round(frac * 100), mode: st.mode });
    }
}

function onDamaged(galaxy: Galaxy, creature: Creature, empire: Empire | null, amount: number): void {
    const st = peekVoidWhaleState(galaxy);
    if (st === null || st.creature !== creature || empire === null) return;
    st.lastDamagerId = empire.empireId;
    const row = st.grudge.find((g) => g.empireId === empire.empireId);
    if (row !== undefined) row.damage += amount;
    else st.grudge.push({ empireId: empire.empireId, damage: amount });
    const f = healthFrac(creature);
    if (f > st.peakFrac) st.peakFrac = Math.min(1, f);
}

function onKilled(galaxy: Galaxy, creature: Creature, empire: Empire | null): void {
    const st = peekVoidWhaleState(galaxy);
    if (st === null || st.creature !== creature || st.phase === 'ended') return;
    voidWhaleSlain(galaxy, st, empire ?? empireById(galaxy, st.lastDamagerId), creature.xpos, creature.ypos);
}

/** Defensive bases at the system of a recent feeding, for empires that hold stations there (AI only: buildDefensiveBases). */
function defendLastSeen(galaxy: Galaxy, empire: Empire, locations: unknown[]): void {
    const st = peekVoidWhaleState(galaxy);
    const seen = st?.lastSeen ?? null;
    if (st === null || seen === null || st.phase !== 'active' || seen.systemIndex < 0) return;
    if (galaxyStarDate(galaxy) - seen.date > 3 * MS_PER_YEAR_DAYS * GAME_DAY_LENGTH) return;
    for (const b of empire.builtObjects) {
        if (b.hasBeenDestroyed || b.role !== BuiltObjectRole.Base || b.nearestSystemStar === null || b.nearestSystemStar.systemIndex !== seen.systemIndex) continue;
        const h = b.parentHabitat;
        if (h !== null && !locations.includes(h)) locations.push(h);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------------------------

export const VOID_WHALE_HANDLER_IDS = ['voidWhale.periodic', 'voidWhale.damaged', 'voidWhale.killed', 'voidWhale.ignore', 'voidWhale.defend'] as const;

export function registerVoidWhale(): void {
    registerThreatExistence(VOID_WHALE_KEY, VOID_WHALE_FLAG);
    registerScenarioFramePeriodic({ id: 'voidWhale.periodic', flag: VOID_WHALE_FLAG, periodDays: 1, order: 15, run: (g) => voidWhalePeriodic(g) });
    registerScenarioEvent({ id: 'voidWhale.damaged', flag: VOID_WHALE_FLAG, event: 'creatureDamaged', run: (g, e) => onDamaged(g, e.creature, e.empire, e.amount) });
    registerScenarioEvent({ id: 'voidWhale.killed', flag: VOID_WHALE_FLAG, event: 'creatureKilled', run: (g, e) => onKilled(g, e.creature, e.empire) });
    // The beast does not pick fights with bystanders on its own; it hits back at whoever attacks it (ported CheckForAttackers).
    registerScenarioQuery({ id: 'voidWhale.ignore', flag: VOID_WHALE_FLAG, query: 'creatureIgnoresTarget', run: (g, v, a) => v || peekVoidWhaleState(g)?.creature === a.creature });
    registerScenarioEvent({ id: 'voidWhale.defend', flag: VOID_WHALE_FLAG, event: 'defensiveBaseLocations', run: (g, e) => defendLastSeen(g, e.empire, e.locations) });
}

registerVoidWhale();
