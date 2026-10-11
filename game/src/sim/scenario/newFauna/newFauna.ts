// Scenario package 19g-7b "new fauna" (tasks/19-mod-layer-scenarios.md §19g-7b): hook registrations and the variant
// behaviours, all behind the `newFauna` flag. Not a port. Every variant is a group of ported Creatures (creature.ts,
// Creature.cs) in a 19g-7 RimHerd; the ported per-tick creature code (Creature.cs DoTasks: Move / InitiateWander /
// CheckForAttackers / CheckForTargets / AttackTarget) keeps running them — this package only sets their stats, anchor
// points, targets and hyper speed, and adds the variant effects through existing paths:
//   1 Void whale      19g-7 grazing / migration (rimFauna.ts grazeHerd, sparing stations); harmless (creatureIgnoresTarget,
//                     Creature.cs 1245 ScanForTarget) unless attacked (Creature.cs 1196 CheckForAttackers hits back);
//                     big kill haul on the 19j creatureKilled event (BuiltObject.2.cs 6227 InflictDamage kill site).
//   2 Hunter pack     4–6 fast Kaltor-based hunters: stalk freighters (CurrentTarget + Pursuers as Creature.cs 1206
//                     CheckForTargets sets them), flee warships (targets dropped, anchor away); ignore everything else.
//   3 Hull grazer     latches onto a station and eats its hull through the shields: Creature.cs 1347 DamageTarget
//                     (combat/damage.ts creatureDamageTarget — armour first, then components; it never reads shields),
//                     with the distress path of Creature.cs 1206 (attackAI.ts notifyOfAttackBuiltObject).
//   4 Storm drifter   rides the storm clouds (LightningDamage NebulaClouds, the 19h storm belt); its cloud blinds ship
//                     sensors (19h scanRangeModifier, Empire.9.cs 3449 FindShipOutsideSystemWithScanRange) and makes jumps
//                     misfire (19h hyperjumpStop, BuiltObject.2.cs HyperTo in-flight step).
//   5 Lantern shoal   a harmless light swarm drifting into the 19h gravity shoals; civilian jumps that pass it stop at it
//                     (19h hyperjumpStop), so ships following the lights end up in a shoal.
//   6 Nest mother     a stationary giant guarding the richest habitat of a rim system (AttackRange = guard range, the
//                     ported CheckForTargets / AttackTarget do the fighting); spawns young (Galaxy.6.cs 800
//                     GenerateCreaturesAtLocation) that stay as her herd.
//   7 Scavenger       eats wreck debris (torn-down ships: combat/teardown.ts builtObjectRemoved; stock DebrisField
//                     locations) and carries the salvage; killing one drops it into the killer's hold.
//   8 Brood carrier   travels between systems (Creature.cs Move hyper travel) and seeds hunter packs at planets it passes.
// Herders (19j) tame whales and hunter packs (setRimHerdDocile; the herds join the herder colony's herdIds so the 19j
// harvest counts them — living miners) and pair tamed whales with the herders' tamed freighters (living freighters).
//
// Rnd: galaxy.rnd only inside this package's gated handlers (game start, the periodic tick). The query handlers and the
// event handlers never draw. With the flag off none of this runs; the rimFauna herd-driver lookups return false.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { BuiltObject } from '../../builtObject';
import type { Habitat } from '../../types';
import { HabitatCategoryType } from '../../types';
import type { Creature } from '../../creature';
import { CreatureType } from '../../creature';
import { GalaxyLocationEffectType, GalaxyLocationType } from '../../galaxyLocation';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { ComponentType } from '../../data/components';
import { ComponentStatus } from '../../builtObjectComponent';
import { Cargo, ResourceRef } from '../../cargo';
import { generateCreaturesAtLocation } from '../../story/storyStart';
import { creatureDamageTarget } from '../../combat/damage';
import { notifyOfAttackBuiltObject } from '../../combat/attackAI';
import { stellarAttackers, stellarPursuers } from '../../combat/threats';
import { isBuiltObject } from '../../missions/mission';
import { galaxyStarDate } from '../../tick/simTime';
import { GAME_DAY_LENGTH, radiusFraction, registerScenarioEvent, registerScenarioGameStart, registerScenarioPeriodic, registerScenarioQuery } from '../hooks';
import { scenarioFlag } from '../state';
import { scenarioMessage, scenarioNews, scenarioText } from '../messages';
import { EmpireMessageType } from '../../messages';
import { HERD_COHESION, HERD_HYPER_SPEED, HERD_REST_RANGE, herdDensityAt, herdMembers, peekRimFaunaState, rimFaunaState, rimHerdDocileTo, rimHerdOfCreature, setRimHerdDocile, type RimHerd } from '../rimFauna/common';
import { registerRimHerdDriver, startRimHerdMigration } from '../rimFauna/rimFauna';
import { herderColonies, peekRimHerdersState, type HerderColony } from '../rimHerders/common';
import {
    DEBRIS_FIELD_SALVAGE,
    FaunaVariant,
    GRAZER_HULL_OFFSET,
    GRAZER_LATCH_DIST,
    MAX_WRECKS,
    NEST_YOUNG,
    NEW_FAUNA_FLAG,
    SCAVENGE_EAT_DIST,
    WRECK_DAYS,
    type FaunaHerdInfo,
    type FaunaVariantDef,
    type Salvage,
    drifterMisfireStop,
    drifterScanMultiplier,
    faunaVariantDef,
    faunaVariantTable,
    gravityShoals,
    isFreighterShip,
    isWarship,
    lanternLureStop,
    locationCentre,
    newFaunaParam,
    newFaunaState,
    peekNewFaunaState,
} from './common';

function dist(galaxy: Galaxy, x1: number, y1: number, x2: number, y2: number): number {
    return galaxy.calculateDistance(x1, y1, x2, y2);
}

function now(galaxy: Galaxy): number {
    return galaxyStarDate(galaxy);
}

function resourceIdByName(galaxy: Galaxy, name: string): number {
    const r = galaxy.resourceSystem.resources.find((x) => x != null && x.name === name);
    return r === undefined ? -1 : r.resourceId;
}

// ---------------------------------------------------------------------------------------------------------------
// Members: variant stats over the base type's ctor values
// ---------------------------------------------------------------------------------------------------------------

/** Speeds / ranges of a member (no Rnd; re-applied every tick so the 19g-7 leader promotion cannot reset them). */
function applyVariant(c: Creature, def: FaunaVariantDef, leader: boolean, young: boolean): void {
    const speed = young ? NEST_YOUNG.speed : leader ? def.leaderSpeed : def.followerSpeed;
    c.movementSpeed = speed;
    c.movementSpeedBase = speed;
    c.attackRange = def.attackRange;
    c.locationLocked = true;
    // The slug bases hide (Creature.cs HideCreature); the variants never do.
    c.canHide = false;
    c.isVisible = true;
    c.lungeSpeed = 0;
    c.lungeSpeedBase = 0;
}

/** A new member: size and strength rolled from the variant (one galaxy.rnd draw), then applyVariant. */
function adoptMember(galaxy: Galaxy, info: FaunaHerdInfo, c: Creature, def: FaunaVariantDef, leader: boolean, name: string): void {
    const young = def.variant === FaunaVariant.NestMother && !leader;
    const lo = young ? NEST_YOUNG.sizeMin : def.sizeMin;
    const hi = young ? NEST_YOUNG.sizeMax : def.sizeMax;
    c.size = galaxy.rnd.next(lo, hi + 1);
    c.maxSize = Math.max(c.size, young ? NEST_YOUNG.sizeMax * 2 : def.maxSize);
    const div = young ? NEST_YOUNG.attackDiv : def.attackDiv;
    c.attackStrength = div > 0 ? Math.trunc(c.size / div) : 0;
    c.damageKillThreshold = Math.trunc(c.size * (young ? NEST_YOUNG.killMul : def.killMul));
    c.name = young ? `${name} (young)` : name;
    applyVariant(c, def, leader, young);
    if (!info.members.includes(c.creatureId)) info.members.push(c.creatureId);
}

function variantName(galaxy: Galaxy, def: FaunaVariantDef, systemIndex: number): string {
    const star = galaxy.systems[systemIndex]?.systemStar.name ?? 'Deep Space';
    return `${def.name} of ${star}`;
}

/** A point in a system: a random asteroid / gas cloud of it, else 6000–12000 from its star. Draws galaxy.rnd. */
function systemPoint(galaxy: Galaxy, systemIndex: number): { x: number; y: number } {
    const star = galaxy.systems[systemIndex].systemStar;
    const sites = galaxy.systemHabitatsOf(systemIndex).filter((h) => h.category === HabitatCategoryType.Asteroid || h.category === HabitatCategoryType.GasCloud);
    if (sites.length > 0) {
        const s = sites[galaxy.rnd.next(0, sites.length)];
        return { x: s.xpos, y: s.ypos };
    }
    const a = galaxy.rnd.nextDouble() * Math.PI * 2.0;
    const r = 6000 + galaxy.rnd.next(0, 6000);
    return { x: star.xpos + Math.cos(a) * r, y: star.ypos + Math.sin(a) * r };
}

/** The richest non-star habitat of a system (sum of resource abundance), for a nest. No Rnd. */
export function richestSite(galaxy: Galaxy, systemIndex: number): Habitat | null {
    let best: Habitat | null = null;
    let bestV = 0;
    for (const h of galaxy.systemHabitatsOf(systemIndex)) {
        if (h.category === HabitatCategoryType.Star || h.empire !== null) continue;
        let v = 0;
        for (const r of h.resources) v += r.abundance;
        if (v > bestV) {
            bestV = v;
            best = h;
        }
    }
    return best;
}

/** The storm cloud (LightningDamage NebulaCloud) nearest (x, y) within `range`, or null. No Rnd. */
function nearestStorm(galaxy: Galaxy, x: number, y: number, range: number, exclude: { x: number; y: number } | null = null): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null;
    let bestD = range;
    for (const l of galaxy.galaxyLocations) {
        if (l.type !== GalaxyLocationType.NebulaCloud || (l.effect & GalaxyLocationEffectType.LightningDamage) === 0) continue;
        const c = locationCentre(l);
        if (exclude !== null && Math.abs(c.x - exclude.x) < 1 && Math.abs(c.y - exclude.y) < 1) continue;
        const d = dist(galaxy, x, y, c.x, c.y);
        if (d < bestD) {
            bestD = d;
            best = c;
        }
    }
    return best;
}

/**
 * Spawns one variant group in a system as a 19g-7 RimHerd (the members via the ported GenerateCreaturesAtLocation,
 * Galaxy.6.cs 800, as rimFauna.spawnRimHerd does for Kaltors). Draws galaxy.rnd. Exported for tests.
 */
export function spawnVariantHerd(galaxy: Galaxy, variant: FaunaVariant, systemIndex: number, count: number | null = null, at: { x: number; y: number } | null = null): RimHerd | null {
    const fs = rimFaunaState(galaxy);
    const st = newFaunaState(galaxy);
    const def = faunaVariantDef(variant);
    const sys = galaxy.systems[systemIndex];
    if (sys === undefined) return null;
    const n = count ?? galaxy.rnd.next(def.groupMin, def.groupMax + 1);
    let p = at;
    let target: { x: number; y: number } | null = null;
    if (p === null) {
        if (variant === FaunaVariant.StormDrifter) {
            const storm = nearestStorm(galaxy, sys.systemStar.xpos, sys.systemStar.ypos, 400000);
            if (storm !== null) p = { ...storm };
        } else if (variant === FaunaVariant.NestMother) {
            const site = richestSite(galaxy, systemIndex);
            if (site !== null) p = { x: site.xpos + site.diameter, y: site.ypos };
        }
        if (p === null) p = systemPoint(galaxy, systemIndex);
    }
    if (variant === FaunaVariant.StormDrifter || variant === FaunaVariant.NestMother) target = { x: Math.trunc(p.x), y: Math.trunc(p.y) };
    const list = generateCreaturesAtLocation(galaxy, def.baseType, Math.max(1, n), p.x, p.y, HERD_COHESION, variant === FaunaVariant.NestMother ? 50 : 800);
    if (list.length === 0) return null;
    const herd: RimHerd = {
        id: fs.nextHerdId++,
        type: def.baseType,
        leader: list[0],
        followers: list.slice(1),
        homeSystemIndex: systemIndex,
        homeX: sys.systemStar.xpos,
        homeY: sys.systemStar.ypos,
        homeRange: variant === FaunaVariant.NestMother ? newFaunaParam(galaxy, 'newFaunaNestGuardRange') : 20000,
        birthSystemIndex: systemIndex,
        birthX: sys.systemStar.xpos,
        birthY: sys.systemStar.ypos,
        feedSite: null,
        feedTicks: 0,
        feedingStation: null,
        migration: null,
        docileEmpireIds: [],
        victimEmpireIds: [],
    };
    fs.herds.push(herd);
    fs.rev++;
    fs.stats.herdsSpawned++;
    const info: FaunaHerdInfo = { variant, members: [], target, destSystem: -1, nextAt: 0, latched: null, fleeing: false, salvage: [], tamedBy: -1 };
    st.herds[herd.id] = info;
    st.rev++;
    st.stats.spawned[variant]++;
    const name = variantName(galaxy, def, systemIndex);
    list.forEach((c, i) => adoptMember(galaxy, info, c, def, i === 0, name));
    if (variant === FaunaVariant.NestMother) info.nextAt = now(galaxy) + newFaunaParam(galaxy, 'newFaunaNestYoungDays') * GAME_DAY_LENGTH;
    if (variant === FaunaVariant.BroodCarrier) info.nextAt = now(galaxy);
    // The Ardilus ctor's HyperSpeed 10000 off: the ticks switch hyper travel on when a variant travels.
    for (const c of list) c.hyperSpeed = 0;
    return herd;
}

/** Weighted variant pick among those allowed at radius fraction f. One NextDouble. */
function pickVariant(galaxy: Galaxy, f: number): FaunaVariant | null {
    // Void whales are placed galaxy-wide on their own (newFaunaGameStart's whale pass).
    const rows = faunaVariantTable().filter((d) => f >= d.minRadius && d.variant !== FaunaVariant.VoidWhale);
    if (rows.length === 0) return null;
    const total = rows.reduce((a, d) => a + d.weight, 0);
    let roll = galaxy.rnd.nextDouble() * total;
    for (const d of rows) {
        roll -= d.weight;
        if (roll < 0) return d.variant;
    }
    return rows[rows.length - 1].variant;
}

/**
 * Game start (`newFauna.spawn`, after the 19g-7 herds and the 19j herder colonies): one pass over Galaxy.Systems in
 * index order; a system with no empire colony at radius fraction f gets floor(d) + (NextDouble < frac(d)) variant
 * groups, d = herdDensityAt(f) × newFaunaDensity (the 19g-7 rim density curve), until the cap; each group's variant is
 * a weighted pick among those allowed at f. Then the stock debris fields become wreck sites, and herders get their tamed
 * whales and hunter packs.
 */
export function newFaunaGameStart(galaxy: Galaxy): void {
    const st = newFaunaState(galaxy);
    const cap = Math.trunc(newFaunaParam(galaxy, 'newFaunaMaxGroups'));
    const mul = newFaunaParam(galaxy, 'newFaunaDensity');
    let groups = 0;
    for (let i = 0; i < galaxy.systems.length && groups < cap; i++) {
        const star = galaxy.systems[i].systemStar;
        const f = radiusFraction(galaxy, star.xpos, star.ypos);
        const d = herdDensityAt(galaxy, f) * mul;
        if (d <= 0) continue;
        if (galaxy.systemHabitatsOf(i).some((h) => h.empire !== null && h.empire !== galaxy.independentEmpire)) continue;
        let n = Math.floor(d);
        if (galaxy.rnd.nextDouble() < d - n) n++;
        for (let k = 0; k < n && groups < cap; k++) {
            const v = pickVariant(galaxy, f);
            if (v === null) break;
            if (spawnVariantHerd(galaxy, v, i) !== null) groups++;
        }
    }
    // Void whales: the same chance in every system of the galaxy (newFaunaWhaleDensity), their own cap.
    const whaleCap = Math.trunc(newFaunaParam(galaxy, 'newFaunaWhaleMaxGroups'));
    const whaleD = newFaunaParam(galaxy, 'newFaunaWhaleDensity');
    let whales = 0;
    for (let i = 0; i < galaxy.systems.length && whales < whaleCap && whaleD > 0; i++) {
        if (galaxy.systemHabitatsOf(i).some((h) => h.empire !== null && h.empire !== galaxy.independentEmpire)) continue;
        if (galaxy.rnd.nextDouble() >= whaleD) continue;
        if (spawnVariantHerd(galaxy, FaunaVariant.VoidWhale, i) !== null) whales++;
    }
    const steel = resourceIdByName(galaxy, 'Steel');
    for (const l of galaxy.galaxyLocations) {
        if (l.type !== GalaxyLocationType.DebrisField || steel < 0) continue;
        const c = locationCentre(l);
        st.wrecks.push({ x: c.x, y: c.y, salvage: [{ resourceId: steel, amount: DEBRIS_FIELD_SALVAGE }], date: now(galaxy) });
    }
    herderStartTames(galaxy);
}

// ---------------------------------------------------------------------------------------------------------------
// Herders: taming, living miners and freighters
// ---------------------------------------------------------------------------------------------------------------

/** Tames a whale / hunter herd for a herder colony's owner: docile flags (19j) and that colony's herd list. No Rnd. */
export function tameVariantHerd(galaxy: Galaxy, herd: RimHerd, owner: Empire, colony: HerderColony | null = null): boolean {
    const st = newFaunaState(galaxy);
    const info = st.herds[herd.id];
    if (info === undefined || !faunaVariantDef(info.variant).tameable || herd.docileEmpireIds.includes(owner.empireId)) return false;
    setRimHerdDocile(galaxy, herd, owner.empireId, true);
    info.tamedBy = owner.empireId;
    if (colony !== null && !colony.herdIds.includes(herd.id)) colony.herdIds.push(herd.id);
    // A tamed pack stops hunting.
    for (const c of herdMembers(herd)) dropTarget(c);
    st.stats.tamed++;
    st.rev++;
    return true;
}

/** Game start with rim herders: each free herder colony gets newFaunaHerderTames tamed whale herds and hunter packs. */
function herderStartTames(galaxy: Galaxy): void {
    const per = Math.trunc(newFaunaParam(galaxy, 'newFaunaHerderTames'));
    if (per <= 0) return;
    for (const hc of herderColonies(galaxy)) {
        const owner = hc.colony.empire;
        if (owner === null || hc.status !== 'free') continue;
        for (let k = 0; k < per; k++) {
            for (const v of [FaunaVariant.VoidWhale, FaunaVariant.HunterPack]) {
                const a = galaxy.rnd.nextDouble() * Math.PI * 2;
                const r = hc.colony.diameter + 3000;
                const herd = spawnVariantHerd(galaxy, v, hc.colony.systemIndex, v === FaunaVariant.VoidWhale ? 2 : null, { x: hc.colony.xpos + Math.cos(a) * r, y: hc.colony.ypos + Math.sin(a) * r });
                if (herd !== null) tameVariantHerd(galaxy, herd, owner, hc);
            }
        }
    }
}

/** Wild tameable herds that come within newFaunaTameRange of a free herder colony are tamed by it. No Rnd. */
function herderTameNearby(galaxy: Galaxy): void {
    const range = newFaunaParam(galaxy, 'newFaunaTameRange');
    const fs = peekRimFaunaState(galaxy);
    const st = newFaunaState(galaxy);
    if (fs === null || range <= 0) return;
    const colonies = herderColonies(galaxy).filter((hc) => hc.status === 'free' && hc.colony.empire !== null);
    if (colonies.length === 0) return;
    for (const herd of fs.herds) {
        const info = st.herds[herd.id];
        if (info === undefined || info.tamedBy >= 0 || herd.leader === null || !faunaVariantDef(info.variant).tameable) continue;
        for (const hc of colonies) {
            if (dist(galaxy, herd.leader.xpos, herd.leader.ypos, hc.colony.xpos, hc.colony.ypos) > range) continue;
            tameVariantHerd(galaxy, herd, hc.colony.empire!, hc);
            break;
        }
    }
}

/**
 * Living freighters: every tamed herder freighter (19j tamed ships) walks with a tamed whale of its owner; the whale's
 * anchor follows the ship (hyper travel on), so a herder convoy is a caravan of laden beasts. No Rnd.
 */
function herderCaravans(galaxy: Galaxy): void {
    const st = newFaunaState(galaxy);
    const hs = peekRimHerdersState(galaxy);
    const fs = peekRimFaunaState(galaxy);
    st.caravans = st.caravans.filter((p) => !p.ship.hasBeenDestroyed && !p.creature.hasBeenDestroyed && rimHerdOfCreature(galaxy, p.creature)?.docileEmpireIds.includes(p.ship.empire?.empireId ?? -1) === true);
    if (hs !== null && fs !== null) {
        for (const ship of hs.tamed) {
            if (ship.hasBeenDestroyed || ship.empire === null || st.caravans.some((p) => p.ship === ship)) continue;
            let pick: Creature | null = null;
            for (const herd of fs.herds) {
                const info = st.herds[herd.id];
                if (info === undefined || info.variant !== FaunaVariant.VoidWhale || !herd.docileEmpireIds.includes(ship.empire.empireId)) continue;
                pick = herdMembers(herd).find((c) => !st.caravans.some((p) => p.creature === c)) ?? null;
                if (pick !== null) break;
            }
            if (pick === null) break;
            st.caravans.push({ ship, creature: pick });
            st.rev++;
        }
    }
    for (const p of st.caravans) {
        p.creature.hyperSpeed = HERD_HYPER_SPEED;
        steer(p.creature, p.ship.xpos + 600, p.ship.ypos, 600);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Steering helpers
// ---------------------------------------------------------------------------------------------------------------

/** Anchor a member at (x, y) (Creature.AnchorPoint); starts it moving when outside the range and idle (as rimFauna steer). */
function steer(c: Creature, x: number, y: number, range: number): void {
    if (c.anchorPoint === null) c.anchorPoint = { x: Math.trunc(x), y: Math.trunc(y) };
    c.anchorPoint.x = Math.trunc(x);
    c.anchorPoint.y = Math.trunc(y);
    c.anchorRange = range;
    const dx = c.xpos - x;
    const dy = c.ypos - y;
    if (c.currentTarget === null && dx * dx + dy * dy > range * range * 0.25) {
        c.parentOffsetX = 0;
        c.parentOffsetY = 0;
        c.targetSpeed = c.movementSpeed;
    }
}

/** Target a ship the way Creature.cs 1206 CheckForTargets does (CurrentTarget, Pursuers, full speed). */
function setTarget(c: Creature, target: BuiltObject): void {
    if (c.currentTarget === target) return;
    dropTarget(c);
    c.currentTarget = target;
    const p = stellarPursuers(target);
    if (!p.includes(c)) p.push(c);
    c.targetSpeed = Math.fround(c.movementSpeed);
}

/** Drop the current target (Creature.cs CheckTargetInRange's release: out of the target's Pursuers / Attackers). */
function dropTarget(c: Creature): void {
    const t = c.currentTarget;
    if (t === null) return;
    const p = stellarPursuers(t);
    const i = p.indexOf(c);
    if (i >= 0) p.splice(i, 1);
    const a = stellarAttackers(t);
    const j = a.indexOf(c);
    if (j >= 0) a.splice(j, 1);
    c.currentTarget = null;
}

/** Nearest live built object matching `pred` within `range` of (x, y). No Rnd. */
function nearestShip(galaxy: Galaxy, x: number, y: number, range: number, pred: (b: BuiltObject) => boolean): BuiltObject | null {
    let best: BuiltObject | null = null;
    let bestD = range * range;
    for (const b of galaxy.builtObjects) {
        if (b == null || b.hasBeenDestroyed || b.empire === null) continue;
        const dx = b.xpos - x;
        const dy = b.ypos - y;
        const d = dx * dx + dy * dy;
        if (d >= bestD || !pred(b)) continue;
        bestD = d;
        best = b;
    }
    return best;
}

// ---------------------------------------------------------------------------------------------------------------
// Variant behaviours (the periodic tick)
// ---------------------------------------------------------------------------------------------------------------

/** 2 Hunter pack: flee a warship in range; else stalk the nearest freighter; else roam the home range. No Rnd. */
export function hunterPackTick(galaxy: Galaxy, herd: RimHerd, info: FaunaHerdInfo): void {
    const st = newFaunaState(galaxy);
    const leader = herd.leader!;
    const members = herdMembers(herd);
    for (const c of members) c.hyperSpeed = 0;
    if (info.tamedBy >= 0) {
        // A tamed pack stays with its herders (the 19j herd defence still sends it at attackers).
        info.fleeing = false;
        steer(leader, herd.homeX, herd.homeY, HERD_REST_RANGE);
        for (const c of herd.followers) steer(c, leader.xpos, leader.ypos, HERD_COHESION);
        return;
    }
    const threat = nearestShip(galaxy, leader.xpos, leader.ypos, newFaunaParam(galaxy, 'newFaunaHunterFleeRange'), (b) => isWarship(b) && !rimHerdDocileTo(herd, b.empire));
    if (threat !== null) {
        const dx = leader.xpos - threat.xpos;
        const dy = leader.ypos - threat.ypos;
        const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const run = newFaunaParam(galaxy, 'newFaunaHunterFleeDistance');
        const fx = leader.xpos + (dx / d) * run;
        const fy = leader.ypos + (dy / d) * run;
        for (const c of members) {
            dropTarget(c);
            steer(c, fx, fy, HERD_COHESION);
            c.targetSpeed = c.movementSpeed;
        }
        if (!info.fleeing) st.stats.flees++;
        info.fleeing = true;
        return;
    }
    info.fleeing = false;
    const current = leader.currentTarget;
    const prey =
        current !== null && isBuiltObject(current) && !current.hasBeenDestroyed && isFreighterShip(current)
            ? current
            : nearestShip(galaxy, leader.xpos, leader.ypos, newFaunaParam(galaxy, 'newFaunaHunterStalkRange'), (b) => isFreighterShip(b) && !rimHerdDocileTo(herd, b.empire));
    if (prey !== null) {
        if (leader.currentTarget !== prey) st.stats.stalks++;
        for (const c of members) {
            // Stalking: the anchor rides with the prey so the ported CheckTargetInRange keeps it in reach.
            steer(c, prey.xpos, prey.ypos, HERD_COHESION);
            setTarget(c, prey);
        }
        return;
    }
    steer(leader, herd.homeX, herd.homeY, herd.homeRange);
    for (const c of herd.followers) steer(c, leader.xpos, leader.ypos, HERD_COHESION);
}

/**
 * 3 Hull grazer — a parasite (user change 2026-10-11). A free grazer seeks the nearest non-docile host within
 * newFaunaGrazerRange: a civilian ship first (freighters, passenger, mining and construction ships: slow and lightly
 * armed), else a station. Within GRAZER_LATCH_DIST it latches on: it sits on the hull (GRAZER_HULL_OFFSET, inside the
 * host's own weapon range) and moves and warps with it (creatureAttachedHost query, creature.ts Move), the host's owner
 * gets the stock distress call once (attackAI.ts notifyOfAttackBuiltObject: the host, its escorts and nearby armed ships
 * and stations fight back — "harmless" only means a grazer never starts a fight). Every day it eats newFaunaGrazerDrain
 * of the hull through creatureDamageTarget (armour first, then components; shields never read; the host's damage
 * control reduces it, the stock DamageReduction path) and siphons newFaunaGrazerFuelSiphon of the host's fuel
 * capacity, and grows. Point defence fights it (newFaunaGrazerPDDamage per working PD component of the host a day, via
 * the stock Creature.DamageCreature). Docking at a space port or shipyard scrapes it off (destroyed); a space port host
 * scrapes its own at newFaunaGrazerPortScrape a day. It multiplies: see grazerSpread. Draws galaxy.rnd (DamageTarget's
 * component pick; the scrape and spread rolls).
 */
export function hullGrazerTick(galaxy: Galaxy, herd: RimHerd, info: FaunaHerdInfo): void {
    const st = newFaunaState(galaxy);
    const leader = herd.leader!;
    const members = herdMembers(herd);
    let host = info.latched;
    if (host !== null && (host.hasBeenDestroyed || host.empire === null || rimHerdDocileTo(herd, host.empire))) {
        host = null;
        detachGrazer(info);
    }
    if (host === null) {
        // Seek: civilian ships first, then stations.
        const range = newFaunaParam(galaxy, 'newFaunaGrazerRange');
        const target =
            nearestShip(galaxy, leader.xpos, leader.ypos, range, (b) => isCivilianHost(b) && !rimHerdDocileTo(herd, b.empire) && grazersOn(galaxy, b) < grazerHostCap(galaxy)) ??
            nearestShip(galaxy, leader.xpos, leader.ypos, range, (b) => b.role === BuiltObjectRole.Base && !rimHerdDocileTo(herd, b.empire) && grazersOn(galaxy, b) < grazerHostCap(galaxy));
        if (target === null) {
            steer(leader, herd.homeX, herd.homeY, herd.homeRange);
            for (const c of herd.followers) steer(c, leader.xpos, leader.ypos, HERD_COHESION);
            return;
        }
        for (const c of members) steer(c, target.xpos, target.ypos, 100);
        if (dist(galaxy, leader.xpos, leader.ypos, target.xpos, target.ypos) > GRAZER_LATCH_DIST) return;
        latchGrazer(galaxy, herd, info, target);
        host = target;
    }
    // Scraped off: the host docked at a space port / shipyard, or a port's own crews.
    const docked = host.dockedAt;
    if ((docked !== null && (isBuiltObject(docked) ? docked.isSpacePort || docked.role === BuiltObjectRole.Base : true)) || (host.isSpacePort && galaxy.rnd.nextDouble() < newFaunaParam(galaxy, 'newFaunaGrazerPortScrape'))) {
        st.stats.grazersScraped = (st.stats.grazersScraped ?? 0) + members.length;
        detachGrazer(info);
        for (const c of members) c.completeTeardown();
        return;
    }
    // Feeding: hull, fuel, growth.
    const drain = Math.trunc(newFaunaParam(galaxy, 'newFaunaGrazerDrain')) * members.length;
    if (drain > 0) {
        st.stats.hullDrained += drain;
        if (creatureDamageTarget(galaxy, leader, host, drain, Math.round(galaxy.currentTimeSeconds * 1000), 1)) {
            st.stats.hostsKilled = (st.stats.hostsKilled ?? 0) + 1;
            detachGrazer(info);
            return;
        }
    }
    const siphon = newFaunaParam(galaxy, 'newFaunaGrazerFuelSiphon') * host.fuelCapacity * members.length;
    if (siphon > 0 && host.currentFuel > 0) {
        const take = Math.min(host.currentFuel, siphon);
        host.currentFuel -= take;
        st.stats.fuelSiphoned = (st.stats.fuelSiphoned ?? 0) + take;
    }
    const def = faunaVariantDef(FaunaVariant.HullGrazer);
    for (const c of members) {
        if (c.size < c.maxSize) {
            c.size += 1;
            c.attackStrength = Math.trunc(c.size / def.attackDiv);
            c.damageKillThreshold = Math.max(c.damageKillThreshold, Math.trunc(c.size * def.killMul));
        }
    }
    // Point defence on the host picks it off.
    const pd = host.components.items.filter((x) => x.type === ComponentType.WeaponPointDefense && x.status === ComponentStatus.Normal).length;
    if (pd > 0) {
        const dmg = pd * newFaunaParam(galaxy, 'newFaunaGrazerPDDamage');
        for (const c of members) {
            if (c.damageCreature(host, dmg, null)) {
                c.completeTeardown();
                st.stats.grazersKilledPD = (st.stats.grazersKilledPD ?? 0) + 1;
            }
        }
        if (herdMembers(herd).length === 0) {
            detachGrazer(info);
            return;
        }
    }
    grazerSpread(galaxy, herd, info, host);
}

/** Civilian grazer hosts: freighters, passenger, mining and construction ships (moving, not warships, not bases). */
function isCivilianHost(b: BuiltObject): boolean {
    return b.role !== BuiltObjectRole.Military && b.role !== BuiltObjectRole.Base && b.topSpeed > 0;
}

function grazerHostCap(galaxy: Galaxy): number {
    return Math.trunc(newFaunaParam(galaxy, 'newFaunaGrazerHostCap'));
}

/** Grazer herds latched onto `host`. Pure. */
export function grazersOn(galaxy: Galaxy, host: BuiltObject): number {
    const st = peekNewFaunaState(galaxy);
    if (st === null) return 0;
    let n = 0;
    for (const key of Object.keys(st.herds)) if (st.herds[Number(key)].latched === host) n++;
    return n;
}

/** Live hull grazer creatures (all herds). Pure. */
export function grazerCount(galaxy: Galaxy): { total: number; bySystem: Map<number, number> } {
    const fs = peekRimFaunaState(galaxy);
    const st = peekNewFaunaState(galaxy);
    const bySystem = new Map<number, number>();
    let total = 0;
    if (fs === null || st === null) return { total, bySystem };
    for (const herd of fs.herds) {
        const info = st.herds[herd.id];
        if (info === undefined || info.variant !== FaunaVariant.HullGrazer || herd.leader === null) continue;
        const n = herdMembers(herd).length;
        total += n;
        const sys = herd.leader.nearestSystemStar?.systemIndex ?? -1;
        bySystem.set(sys, (bySystem.get(sys) ?? 0) + n);
    }
    return { total, bySystem };
}

function latchGrazer(galaxy: Galaxy, herd: RimHerd, info: FaunaHerdInfo, host: BuiltObject): void {
    const st = newFaunaState(galaxy);
    info.latched = host;
    const n = grazersOn(galaxy, host);
    const a = (n * 2.1 + herd.id * 0.7) % (Math.PI * 2);
    info.offset = { x: Math.round(Math.cos(a) * GRAZER_HULL_OFFSET), y: Math.round(Math.sin(a) * GRAZER_HULL_OFFSET) };
    st.stats.latches = (st.stats.latches ?? 0) + 1;
    for (const c of herdMembers(herd)) {
        c.hyperSpeed = 0;
        c.currentSpeed = 0;
        c.targetSpeed = 0;
    }
    // The owner's distress call, once per infestation (the host, its escorts and armed neighbours answer it).
    if (n === 0) {
        st.stats.infestations = (st.stats.infestations ?? 0) + 1;
        notifyOfAttackBuiltObject(galaxy, herd.leader!, null, host, true);
    }
}

function detachGrazer(info: FaunaHerdInfo): void {
    info.latched = null;
    info.offset = undefined;
}

/**
 * Multiplying: a latched grazer whose host is within newFaunaGrazerSpreadRange of another non-docile empire ship or
 * station rolls newFaunaGrazerSpreadChance (once per pair of hosts per newFaunaGrazerSpreadDays; once per grazer per
 * newFaunaGrazerSpreadDays): a new grazer (Size = sizeMin) latches onto that ship / station. Caps: newFaunaGrazerHostCap
 * per host, newFaunaGrazerSystemCap per system, newFaunaGrazerMaxCount in the galaxy. Draws galaxy.rnd (the roll).
 */
function grazerSpread(galaxy: Galaxy, herd: RimHerd, info: FaunaHerdInfo, host: BuiltObject): void {
    const t = now(galaxy);
    const days = newFaunaParam(galaxy, 'newFaunaGrazerSpreadDays') * GAME_DAY_LENGTH;
    if (t < info.nextAt) return;
    const range = newFaunaParam(galaxy, 'newFaunaGrazerSpreadRange');
    const r2 = range * range;
    info.spreadTried = (info.spreadTried ?? []).filter((p) => t - p.at < days && !p.other.hasBeenDestroyed);
    for (const other of galaxy.builtObjects) {
        if (other == null || other === host || other.hasBeenDestroyed || other.empire === null || rimHerdDocileTo(herd, other.empire)) continue;
        if (galaxy.calculateDistanceSquared(other.xpos, other.ypos, host.xpos, host.ypos) > r2) continue;
        if (info.spreadTried.some((p) => p.other === other)) continue;
        if (grazersOn(galaxy, other) >= grazerHostCap(galaxy)) continue;
        info.spreadTried.push({ other, at: t });
        if (galaxy.rnd.nextDouble() >= newFaunaParam(galaxy, 'newFaunaGrazerSpreadChance')) continue;
        const counts = grazerCount(galaxy);
        const sys = herd.leader!.nearestSystemStar?.systemIndex ?? -1;
        if (counts.total >= newFaunaParam(galaxy, 'newFaunaGrazerMaxCount') || (counts.bySystem.get(sys) ?? 0) >= newFaunaParam(galaxy, 'newFaunaGrazerSystemCap')) return;
        const child = spawnVariantHerd(galaxy, FaunaVariant.HullGrazer, sys >= 0 ? sys : herd.homeSystemIndex, 1, { x: other.xpos, y: other.ypos });
        if (child === null) return;
        const def = faunaVariantDef(FaunaVariant.HullGrazer);
        for (const c of herdMembers(child)) {
            c.size = def.sizeMin;
            c.attackStrength = Math.trunc(c.size / def.attackDiv);
            c.damageKillThreshold = Math.trunc(c.size * def.killMul);
        }
        const cinfo = newFaunaState(galaxy).herds[child.id];
        latchGrazer(galaxy, child, cinfo, other);
        cinfo.nextAt = t + days;
        info.nextAt = t + days;
        const st = newFaunaState(galaxy);
        st.stats.grazerBirths = (st.stats.grazerBirths ?? 0) + 1;
        return;
    }
}

/** creatureAttachedHost: a latched grazer sits on its host's hull (moves and warps with it). Pure. */
export function grazerAttachedPoint(galaxy: Galaxy, c: Creature): { x: number; y: number } | null {
    const st = peekNewFaunaState(galaxy);
    if (st === null) return null;
    const herd = rimHerdOfCreature(galaxy, c);
    if (herd === null) return null;
    const info = st.herds[herd.id];
    const host = info?.latched ?? null;
    if (info === undefined || info.variant !== FaunaVariant.HullGrazer || host === null || host.hasBeenDestroyed) return null;
    const o = info.offset ?? { x: 0, y: 0 };
    const k = c === herd.leader ? 0 : 25;
    return { x: host.xpos + o.x + k, y: host.ypos + o.y - k };
}

/** 4 Storm drifter: drifts in its storm cloud; now and then rides to another storm of the belt. Draws galaxy.rnd. */
export function stormDrifterTick(galaxy: Galaxy, herd: RimHerd, info: FaunaHerdInfo): void {
    const leader = herd.leader!;
    const def = faunaVariantDef(FaunaVariant.StormDrifter);
    if (info.target === null) info.target = { x: Math.trunc(leader.xpos), y: Math.trunc(leader.ypos) };
    const arrived = dist(galaxy, leader.xpos, leader.ypos, info.target.x, info.target.y) <= HERD_REST_RANGE;
    if (arrived && galaxy.rnd.nextDouble() < newFaunaParam(galaxy, 'newFaunaDrifterHopChance')) {
        const next = nearestStorm(galaxy, leader.xpos, leader.ypos, 300000, info.target);
        if (next !== null) info.target = { x: Math.trunc(next.x), y: Math.trunc(next.y) };
    }
    const travelling = dist(galaxy, leader.xpos, leader.ypos, info.target.x, info.target.y) > HERD_REST_RANGE * 4;
    for (const c of herdMembers(herd)) c.hyperSpeed = travelling ? def.hyperSpeed : 0;
    steer(leader, info.target.x, info.target.y, HERD_REST_RANGE);
    for (const c of herd.followers) steer(c, leader.xpos, leader.ypos, HERD_COHESION);
}

/** 5 Lantern shoal: drifts to the nearest gravity shoal (19h) and swirls inside it. No Rnd. */
export function lanternShoalTick(galaxy: Galaxy, herd: RimHerd, info: FaunaHerdInfo): void {
    const leader = herd.leader!;
    const def = faunaVariantDef(FaunaVariant.LanternShoal);
    let best: { x: number; y: number; r: number } | null = null;
    let bestD = Number.MAX_VALUE;
    for (const l of gravityShoals(galaxy)) {
        const c = locationCentre(l);
        const d = dist(galaxy, leader.xpos, leader.ypos, c.x, c.y);
        if (d < bestD) {
            bestD = d;
            best = { x: c.x, y: c.y, r: l.width / 2 };
        }
    }
    if (best === null) {
        steer(leader, herd.homeX, herd.homeY, herd.homeRange);
        return;
    }
    info.target = { x: Math.trunc(best.x), y: Math.trunc(best.y) };
    const inside = bestD <= best.r * 0.5;
    for (const c of herdMembers(herd)) {
        c.hyperSpeed = inside ? 0 : def.hyperSpeed;
        steer(c, best.x, best.y, Math.max(HERD_COHESION, best.r * 0.3));
    }
}

/**
 * 6 Nest mother: stays on her site (guarding it with her attack range) and every newFaunaNestYoungDays spawns one young
 * (Galaxy.6.cs 800 GenerateCreaturesAtLocation) up to newFaunaNestMaxYoung; the young circle the nest. Draws galaxy.rnd.
 */
export function nestMotherTick(galaxy: Galaxy, herd: RimHerd, info: FaunaHerdInfo): void {
    const st = newFaunaState(galaxy);
    const mother = herd.leader!;
    const def = faunaVariantDef(FaunaVariant.NestMother);
    if (info.target === null) info.target = { x: Math.trunc(mother.xpos), y: Math.trunc(mother.ypos) };
    if (nestMotherEscape(galaxy, herd, info)) return;
    const guard = newFaunaParam(galaxy, 'newFaunaNestGuardRange');
    mother.attackRange = guard;
    steer(mother, info.target.x, info.target.y, 400);
    for (const c of herd.followers) steer(c, info.target.x, info.target.y, Math.min(guard, 4000));
    const t = now(galaxy);
    if (t < info.nextAt) return;
    info.nextAt = t + newFaunaParam(galaxy, 'newFaunaNestYoungDays') * GAME_DAY_LENGTH;
    if (herd.followers.length >= Math.trunc(newFaunaParam(galaxy, 'newFaunaNestMaxYoung'))) return;
    const young = generateCreaturesAtLocation(galaxy, CreatureType.Kaltor, 1, info.target.x, info.target.y, HERD_COHESION, 1200);
    for (const c of young) {
        adoptMember(galaxy, info, c, def, false, mother.name);
        herd.followers.push(c);
        st.stats.young++;
    }
    peekRimFaunaState(galaxy)!.rev++;
    st.rev++;
}

/**
 * Nest mother escape (user change 2026-10-11): she never warps, but past newFaunaNestEscapeDamage of her hit points
 * lost she flees — slowly (newFaunaNestEscapeHyper, the ported Creature hyper travel) to a remote rim system (radius
 * fraction ≥ 0.7, no empire colony, at least newFaunaNestEscapeMin away; one galaxy.rnd pick) — her young with her,
 * and builds a new nest there (the nest tick rebuilds the young she lost). The empires with ships or colonies in the old
 * system get a message; the news reports it. True while she is travelling. Draws galaxy.rnd (the pick).
 */
function nestMotherEscape(galaxy: Galaxy, herd: RimHerd, info: FaunaHerdInfo): boolean {
    const st = newFaunaState(galaxy);
    const mother = herd.leader!;
    const members = herdMembers(herd);
    if (info.destSystem >= 0) {
        // Travelling.
        for (const c of members) {
            steer(c, info.target!.x, info.target!.y, c === mother ? 400 : 4000);
            c.hyperSpeed = newFaunaParam(galaxy, 'newFaunaNestEscapeHyper');
        }
        if (dist(galaxy, mother.xpos, mother.ypos, info.target!.x, info.target!.y) > HERD_REST_RANGE) return true;
        const star = galaxy.systems[info.destSystem].systemStar;
        herd.homeSystemIndex = info.destSystem;
        herd.homeX = star.xpos;
        herd.homeY = star.ypos;
        info.destSystem = -1;
        for (const c of members) c.hyperSpeed = 0;
        info.nextAt = now(galaxy) + newFaunaParam(galaxy, 'newFaunaNestYoungDays') * GAME_DAY_LENGTH;
        return false;
    }
    if (mother.damageKillThreshold <= 0 || mother.damage < mother.damageKillThreshold * newFaunaParam(galaxy, 'newFaunaNestEscapeDamage')) return false;
    const minD = newFaunaParam(galaxy, 'newFaunaNestEscapeMin');
    const cand: number[] = [];
    for (let i = 0; i < galaxy.systems.length; i++) {
        if (i === herd.homeSystemIndex) continue;
        const star = galaxy.systems[i].systemStar;
        if (radiusFraction(galaxy, star.xpos, star.ypos) < 0.7 || dist(galaxy, mother.xpos, mother.ypos, star.xpos, star.ypos) < minD) continue;
        if (galaxy.systemHabitatsOf(i).some((h) => h.empire !== null && h.empire !== galaxy.independentEmpire)) continue;
        cand.push(i);
    }
    if (cand.length === 0) return false;
    const to = cand[galaxy.rnd.next(0, cand.length)];
    const site = richestSite(galaxy, to);
    const p = site !== null ? { x: site.xpos + site.diameter, y: site.ypos } : systemPoint(galaxy, to);
    const fromName = galaxy.systems[herd.homeSystemIndex]?.systemStar.name ?? '';
    const toName = galaxy.systems[to].systemStar.name;
    info.destSystem = to;
    info.target = { x: Math.trunc(p.x), y: Math.trunc(p.y) };
    for (const c of members) {
        const t = c.currentTarget;
        if (t !== null) dropTarget(c);
        c.hyperSpeed = newFaunaParam(galaxy, 'newFaunaNestEscapeHyper');
        steer(c, p.x, p.y, 4000);
    }
    st.stats.nestEscapes = (st.stats.nestEscapes ?? 0) + 1;
    const told = new Set<Empire>();
    for (const b of galaxy.builtObjects) if (b != null && b.empire !== null && b.nearestSystemStar?.systemIndex === herd.homeSystemIndex) told.add(b.empire);
    for (const h of galaxy.systemHabitatsOf(herd.homeSystemIndex)) if (h.empire !== null && h.empire !== galaxy.independentEmpire) told.add(h.empire);
    for (const e of told) {
        if (e === galaxy.independentEmpire || !e.active) continue;
        scenarioMessage(galaxy, e, scenarioText('Scenario NewFauna Title'), scenarioText('Scenario NewFauna Nest Escape', mother.name, fromName, toName), { type: EmpireMessageType.GeneralNeutralEvent });
    }
    scenarioNews(galaxy, null, scenarioText('Scenario NewFauna Nest Escape News', fromName, toName));
    return true;
}

/** 7 Scavenger: to the nearest wreck in range, eat newFaunaScavengeRate salvage per tick into the herd's hold. No Rnd. */
export function scavengerTick(galaxy: Galaxy, herd: RimHerd, info: FaunaHerdInfo): void {
    const st = newFaunaState(galaxy);
    const leader = herd.leader!;
    const range = newFaunaParam(galaxy, 'newFaunaScavengeRange');
    let site = null as (typeof st.wrecks)[number] | null;
    let bestD = range;
    for (const w of st.wrecks) {
        const d = dist(galaxy, leader.xpos, leader.ypos, w.x, w.y);
        if (d < bestD) {
            bestD = d;
            site = w;
        }
    }
    const def = faunaVariantDef(FaunaVariant.Scavenger);
    if (site === null) {
        for (const c of herdMembers(herd)) c.hyperSpeed = 0;
        steer(leader, herd.homeX, herd.homeY, herd.homeRange);
        for (const c of herd.followers) steer(c, leader.xpos, leader.ypos, HERD_COHESION);
        return;
    }
    for (const c of herdMembers(herd)) {
        c.hyperSpeed = bestD > HERD_REST_RANGE * 4 ? def.hyperSpeed : 0;
        steer(c, site.x, site.y, 800);
    }
    if (bestD > SCAVENGE_EAT_DIST) return;
    let budget = Math.trunc(newFaunaParam(galaxy, 'newFaunaScavengeRate')) * herdMembers(herd).length;
    for (const s of site.salvage) {
        if (budget <= 0) break;
        const eat = Math.min(budget, s.amount);
        if (eat <= 0) continue;
        s.amount -= eat;
        budget -= eat;
        addSalvage(info.salvage, s.resourceId, eat);
        st.stats.salvageEaten += eat;
    }
    site.salvage = site.salvage.filter((s) => s.amount > 0);
    if (site.salvage.length === 0) st.wrecks.splice(st.wrecks.indexOf(site), 1);
}

function addSalvage(list: Salvage[], resourceId: number, amount: number): void {
    const s = list.find((x) => x.resourceId === resourceId);
    if (s !== undefined) s.amount += amount;
    else list.push({ resourceId, amount });
}

/**
 * 8 Brood carrier: travels from system to system within newFaunaBroodRange (hyper travel); passing within
 * newFaunaBroodSeedRange of a planet it seeds a hunter pack there (every newFaunaBroodSeedDays, up to
 * newFaunaBroodMaxPacks packs). Draws galaxy.rnd.
 */
export function broodCarrierTick(galaxy: Galaxy, herd: RimHerd, info: FaunaHerdInfo): void {
    const st = newFaunaState(galaxy);
    const c = herd.leader!;
    const def = faunaVariantDef(FaunaVariant.BroodCarrier);
    const atDest = info.target !== null && dist(galaxy, c.xpos, c.ypos, info.target.x, info.target.y) <= HERD_REST_RANGE * 2;
    if (info.target === null || atDest) {
        const range = newFaunaParam(galaxy, 'newFaunaBroodRange');
        const here = c.nearestSystemStar?.systemIndex ?? herd.homeSystemIndex;
        const cand: number[] = [];
        for (let i = 0; i < galaxy.systems.length; i++) {
            if (i === here || i === info.destSystem) continue;
            const s = galaxy.systems[i].systemStar;
            if (dist(galaxy, c.xpos, c.ypos, s.xpos, s.ypos) <= range) cand.push(i);
        }
        if (cand.length > 0) {
            const to = cand[galaxy.rnd.next(0, cand.length)];
            const planets = galaxy.systemHabitatsOf(to).filter((h) => h.category === HabitatCategoryType.Planet);
            const p = planets.length > 0 ? planets[galaxy.rnd.next(0, planets.length)] : galaxy.systems[to].systemStar;
            info.destSystem = to;
            info.target = { x: Math.trunc(p.xpos + p.diameter + 2000), y: Math.trunc(p.ypos) };
        }
    }
    if (info.target !== null) {
        c.hyperSpeed = def.hyperSpeed;
        steer(c, info.target.x, info.target.y, HERD_REST_RANGE);
    }
    // Seeding: a planet of the system it is in, within the seed range.
    const t = now(galaxy);
    if (t < info.nextAt || c.nearestSystemStar === null) return;
    const fs = peekRimFaunaState(galaxy)!;
    const packs = fs.herds.filter((h) => st.herds[h.id]?.variant === FaunaVariant.HunterPack).length;
    if (packs >= Math.trunc(newFaunaParam(galaxy, 'newFaunaBroodMaxPacks'))) return;
    const seedRange = newFaunaParam(galaxy, 'newFaunaBroodSeedRange');
    const planet = galaxy
        .systemHabitatsOf(c.nearestSystemStar.systemIndex)
        .find((h) => h.category === HabitatCategoryType.Planet && dist(galaxy, c.xpos, c.ypos, h.xpos, h.ypos) <= seedRange + h.diameter);
    if (planet === undefined) return;
    const pack = spawnVariantHerd(galaxy, FaunaVariant.HunterPack, planet.systemIndex, null, { x: planet.xpos + planet.diameter + 1500, y: planet.ypos });
    if (pack === null) return;
    info.nextAt = t + newFaunaParam(galaxy, 'newFaunaBroodSeedDays') * GAME_DAY_LENGTH;
    st.stats.seeded++;
}

/**
 * Void whale migration season (when the 19g-7 season ran): each wild whale group rolls newFaunaWhaleMigrationChance and
 * migrates to a random system within newFaunaWhaleMigrationRange, any direction (galaxy-wide wandering, not the rim
 * fauna's inward push), at the whales' slow hyper speed (the ported Creature Move hyper travel, as the 19g-7
 * migrations). Tamed whales go with their herders' freighters instead (herderCaravans). Draws galaxy.rnd.
 */
function voidWhaleSeason(galaxy: Galaxy): void {
    const fs = peekRimFaunaState(galaxy);
    const st = newFaunaState(galaxy);
    if (fs === null) return;
    const def = faunaVariantDef(FaunaVariant.VoidWhale);
    const range = newFaunaParam(galaxy, 'newFaunaWhaleMigrationRange');
    const chance = newFaunaParam(galaxy, 'newFaunaWhaleMigrationChance');
    for (const herd of fs.herds) {
        const info = st.herds[herd.id];
        if (info === undefined || info.variant !== FaunaVariant.VoidWhale || info.tamedBy >= 0 || herd.leader === null || herd.migration !== null || herd.docileEmpireIds.length > 0) continue;
        if (galaxy.rnd.nextDouble() >= chance) continue;
        const cand: number[] = [];
        for (let i = 0; i < galaxy.systems.length; i++) {
            if (i === herd.homeSystemIndex) continue;
            const star = galaxy.systems[i].systemStar;
            if (dist(galaxy, herd.homeX, herd.homeY, star.xpos, star.ypos) <= range) cand.push(i);
        }
        if (cand.length === 0) continue;
        startRimHerdMigration(galaxy, herd, cand[galaxy.rnd.next(0, cand.length)], false);
        for (const c of herdMembers(herd)) c.hyperSpeed = def.hyperSpeed;
        st.stats.whaleMigrations = (st.stats.whaleMigrations ?? 0) + 1;
    }
}

/** Whale herds: the 19g-7 tick grazes and migrates them; count the grazing and keep the member stats. No Rnd. */
function voidWhaleTick(galaxy: Galaxy, herd: RimHerd): void {
    if (herd.feedSite !== null && herd.migration === null) newFaunaState(galaxy).stats.grazeTicks++;
}

/** New members (19g-7 calves) join as the variant; stats re-applied (a promoted leader). Draws galaxy.rnd per calf. */
function adoptNewMembers(galaxy: Galaxy, herd: RimHerd, info: FaunaHerdInfo): void {
    const def = faunaVariantDef(info.variant);
    const name = herd.leader!.name.replace(/ \(young\)$/, '');
    for (const c of herdMembers(herd)) {
        const leader = c === herd.leader;
        if (!info.members.includes(c.creatureId)) adoptMember(galaxy, info, c, def, leader, name);
        else applyVariant(c, def, leader, def.variant === FaunaVariant.NestMother && !leader);
    }
}

/** The periodic tick (`newFauna.tick`, every long block, after the 19g-7 herd tick and the 19j tick). Exported for tests. */
export function newFaunaTick(galaxy: Galaxy): void {
    const st = newFaunaState(galaxy);
    const fs = peekRimFaunaState(galaxy);
    if (fs === null) return;
    // Herds the 19g-7 tick dropped (wiped out) leave the table.
    for (const key of Object.keys(st.herds)) {
        const id = Number(key);
        if (!fs.herds.some((h) => h.id === id)) {
            delete st.herds[id];
            st.rev++;
        }
    }
    const t = now(galaxy);
    if (fs.lastMigrationYear > (st.whaleSeasonYear ?? -1)) {
        st.whaleSeasonYear = fs.lastMigrationYear;
        voidWhaleSeason(galaxy);
    }
    st.wrecks = st.wrecks.filter((w) => t - w.date <= WRECK_DAYS * GAME_DAY_LENGTH);
    for (const herd of [...fs.herds]) {
        const info = st.herds[herd.id];
        if (info === undefined || herd.leader === null) continue;
        adoptNewMembers(galaxy, herd, info);
        switch (info.variant) {
            case FaunaVariant.VoidWhale:
                voidWhaleTick(galaxy, herd);
                break;
            case FaunaVariant.HunterPack:
                hunterPackTick(galaxy, herd, info);
                break;
            case FaunaVariant.HullGrazer:
                hullGrazerTick(galaxy, herd, info);
                break;
            case FaunaVariant.StormDrifter:
                stormDrifterTick(galaxy, herd, info);
                break;
            case FaunaVariant.LanternShoal:
                lanternShoalTick(galaxy, herd, info);
                break;
            case FaunaVariant.NestMother:
                nestMotherTick(galaxy, herd, info);
                break;
            case FaunaVariant.Scavenger:
                scavengerTick(galaxy, herd, info);
                break;
            case FaunaVariant.BroodCarrier:
                broodCarrierTick(galaxy, herd, info);
                break;
        }
    }
    if (herderColonies(galaxy).length > 0) {
        herderTameNearby(galaxy);
        herderCaravans(galaxy);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Events (no Rnd)
// ---------------------------------------------------------------------------------------------------------------

/** Adds `amount` of a resource to a ship's hold (merged into its stack). */
function addToHold(bo: BuiltObject, resourceId: number, amount: number): number {
    if (bo.cargo === null || resourceId < 0 || amount <= 0) return 0;
    const a = Math.trunc(amount);
    const have = bo.cargo.items.find((c) => c.commodity.resourceId === resourceId && c.commodityComponent === null && c.empire === bo.empire);
    if (have !== undefined) have.amount += a;
    else bo.cargo.add(new Cargo(new ResourceRef(resourceId), a, bo.empire));
    return a;
}

/**
 * creatureKilled (19j event, BuiltObject.2.cs 6227 InflictDamage kill site): a void whale's big haul (Zentabia Fluid —
 * "whale oil" — × newFaunaWhaleKillHaul) and a scavenger's carried salvage (its share) go into the killer's hold.
 */
export function newFaunaOnCreatureKilled(galaxy: Galaxy, ev: { creature: Creature; killer: unknown; empire: Empire | null }): void {
    const st = peekNewFaunaState(galaxy);
    if (st === null) return;
    const herd = rimHerdOfCreature(galaxy, ev.creature);
    if (herd === null) return;
    const info = st.herds[herd.id];
    if (info === undefined) return;
    const killer = isBuiltObject(ev.killer) ? ev.killer : null;
    if (info.variant === FaunaVariant.VoidWhale && killer !== null) {
        st.stats.killHaul += addToHold(killer, resourceIdByName(galaxy, 'Zentabia Fluid'), newFaunaParam(galaxy, 'newFaunaWhaleKillHaul'));
    } else if (info.variant === FaunaVariant.Scavenger) {
        const n = Math.max(1, herdMembers(herd).length);
        for (const s of info.salvage) {
            const share = Math.ceil(s.amount / n);
            s.amount -= share;
            if (killer !== null) st.stats.salvageDropped += addToHold(killer, s.resourceId, share);
        }
        info.salvage = info.salvage.filter((s) => s.amount > 0);
    }
}

/** builtObjectRemoved (combat/teardown.ts, BuiltObject.2.cs 5171 CompleteTeardown): a destroyed ship leaves a wreck. */
export function newFaunaOnBuiltObjectRemoved(galaxy: Galaxy, ev: { builtObject: BuiltObject }): void {
    const bo = ev.builtObject;
    if (!bo.hasBeenDestroyed) return;
    const st = newFaunaState(galaxy);
    const steel = resourceIdByName(galaxy, 'Steel');
    const salvage: Salvage[] = [];
    if (steel >= 0) salvage.push({ resourceId: steel, amount: Math.max(5, Math.trunc(bo.size / 10)) });
    if (bo.cargo !== null) {
        for (const c of bo.cargo.items) {
            if (c.commodityComponent !== null || c.amount <= 0) continue;
            addSalvage(salvage, c.commodity.resourceId, Math.trunc(c.amount / 2));
        }
    }
    const kept = salvage.filter((s) => s.amount > 0);
    if (kept.length === 0) return;
    st.wrecks.push({ x: bo.xpos, y: bo.ypos, salvage: kept, date: now(galaxy) });
    if (st.wrecks.length > MAX_WRECKS) st.wrecks.shift();
}

// ---------------------------------------------------------------------------------------------------------------
// Registrations
// ---------------------------------------------------------------------------------------------------------------

/** 19g-7 herd driver: this package steers its non-grazing variants; whales graze but spare stations. Pure. */
registerRimHerdDriver({
    drives: (g, herd) => {
        const info = peekNewFaunaState(g)?.herds[herd.id];
        return info !== undefined && !faunaVariantDef(info.variant).grazes;
    },
    sparesStations: (g, herd) => {
        const info = peekNewFaunaState(g)?.herds[herd.id];
        return info !== undefined && faunaVariantDef(info.variant).harmless;
    },
    // Void whales run their own galaxy-wide migration season (voidWhaleSeason), not the rim fauna's inward one.
    staysHome: (g, herd) => peekNewFaunaState(g)?.herds[herd.id]?.variant === FaunaVariant.VoidWhale,
});

registerScenarioGameStart({ id: 'newFauna.spawn', order: 10, flag: NEW_FAUNA_FLAG, run: (g) => newFaunaGameStart(g) });
registerScenarioPeriodic({ id: 'newFauna.tick', order: 1, flag: NEW_FAUNA_FLAG, periodDays: 1, run: (g) => newFaunaTick(g) });
registerScenarioEvent({ id: 'newFauna.kill', flag: NEW_FAUNA_FLAG, event: 'creatureKilled', run: newFaunaOnCreatureKilled });
registerScenarioEvent({ id: 'newFauna.wreck', flag: NEW_FAUNA_FLAG, event: 'builtObjectRemoved', run: newFaunaOnBuiltObjectRemoved });
registerScenarioQuery({
    id: 'newFauna.ignore',
    flag: NEW_FAUNA_FLAG,
    query: 'creatureIgnoresTarget',
    run: (g, v, a) => {
        if (v) return v;
        const st = peekNewFaunaState(g);
        if (st === null) return v;
        const herd = rimHerdOfCreature(g, a.creature);
        const info = herd === null ? undefined : st.herds[herd.id];
        if (info === undefined) return v;
        const def = faunaVariantDef(info.variant);
        // Harmless variants never start a fight; hunters only take freighters (their tick picks them); grazers only
        // eat stations (their tick drains them).
        if (def.harmless) return true;
        if (info.variant === FaunaVariant.HunterPack) return !(isBuiltObject(a.target) && isFreighterShip(a.target));
        return false;
    },
});
registerScenarioQuery({ id: 'newFauna.attach', flag: NEW_FAUNA_FLAG, query: 'creatureAttachedHost', run: (g, v, a) => v ?? grazerAttachedPoint(g, a.creature) });
registerScenarioQuery({
    id: 'newFauna.drifterFog',
    flag: NEW_FAUNA_FLAG,
    query: 'scanRangeModifier',
    run: (g, v, a) => v * drifterScanMultiplier(g, a.x, a.y),
});
registerScenarioQuery({
    id: 'newFauna.jumps',
    flag: NEW_FAUNA_FLAG,
    query: 'hyperjumpStop',
    run: (g, v, a) => {
        if (v !== null) return v;
        return drifterMisfireStop(g, a.ship, a.fromX, a.fromY, a.toX, a.toY, a.exitX, a.exitY) ?? lanternLureStop(g, a.ship, a.fromX, a.fromY, a.toX, a.toY, a.exitX, a.exitY);
    },
});

/** Test / tooling aid: the flag is on for this game. */
export function newFaunaOn(galaxy: Galaxy): boolean {
    return scenarioFlag(galaxy, NEW_FAUNA_FLAG);
}
