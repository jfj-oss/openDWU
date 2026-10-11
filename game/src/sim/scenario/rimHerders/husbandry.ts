// Scenario package 19j "rim herders" — husbandry (tasks/19-mod-layer-scenarios.md §19j, user additions 2026-10-11): herds
// regrow, mature with age and gain herder-bred traits, wild herds stampede to a herder colony's defence, and herd goods
// get their own luxury order slot. Not a port: the creatures stay ported Kaltors (Creature.cs) / 19g-7b variants, only
// their stock stats (Size, AttackStrength = Size / 20, DamageKillThreshhold = Size × 1.4, HealRate) move along the
// stock formulas.
//
// Values (documented here and in scenarios/rim-herders/scenario.json):
//   Regrowth  — every herd already breeds one calf a year at rimFaunaBreedChance (19g-7, up to rimFaunaHerdSizeMax);
//               a herder herd in "fast" husbandry (a protectorate, or a neighbour in good standing with a drover) and
//               safe (no attack on its colony this past year) rolls a second calf. A free / protectorate colony with no
//               herd gets a young herd (rimFaunaHerdSizeMin calves of Size HERD_YOUNG_SIZE) after rimHerdersRegrowYears
//               (half in fast husbandry). Never while conquered or lost (feral).
//   Maturity  — yearly, each member of a free / protectorate colony's herd grows by (MaxSize − young size) /
//               rimHerdersMatureYears (× 1.5 in fast husbandry); AttackStrength and DamageKillThreshhold follow the
//               creature's own formula (Kaltor /20 and ×1.4; a 19g-7b variant its attackDiv / killMul) and never drop.
//               A mature herd of 7 Kaltors (Size 600): 7 × 30 = 210 damage a second, 7 × 840 = 5 880 hit points.
//   Traits    — Size ≥ TRAIT_HEAL_AT × MaxSize: HealRate HEAL_RATE = 2.0 (stock Kaltor 0.2) — "thick hide".
//               Size ≥ TRAIT_PIERCE_AT × MaxSize: rimHerdersPierceShare of every hit skips the armour pass (the stock
//               creature attack never reads shields — Creature.cs 1347 DamageTarget — so the armour reactive rating is
//               what stops it; ships' rail guns / gravitons bypass shields the same way, BuiltObject.2.cs ~6380).
//   Stampede  — when a free / protectorate colony's defence starts (rimHerdersOnHabitatAttacked, or its herd attacked),
//               up to rimHerdersStampedeHerds wild herds within rimHerdersStampedeRange rally to it for
//               rimHerdersStampedeDays and hunt the attacker's ships, then return to their pastures; once per
//               rimHerdersStampedeCooldown days per colony, never against the protector or a friendly empire. With
//               19g-7b on, wild hunter packs and void whales rally too; passive variants never do.
//   Demand    — herd goods are luxuries priced 30 / 35, so the stock cheapest-first luxury loop never reaches them;
//               the extraLuxuryOrders query gives them their own slot at colonies of empires that have explored a herder
//               colony (free or protectorate) and stand at ≥ 0 with the herders.
//
// Rnd: galaxy.rnd only in the yearly handler (calf and young-herd spawns). The tick steering and queries never draw.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { BuiltObject } from '../../builtObject';
import { CreatureType, type Creature } from '../../creature';
import { YEAR_LENGTH } from '../../galaxyTime';
import { galaxyStarDate } from '../../tick/simTime';
import { GAME_DAY_LENGTH } from '../hooks';
import { HERD_ATTACK_RANGE, HERD_HYPER_SPEED, HERD_REST_RANGE, faunaParam, herdMembers, peekRimFaunaState, rimHerdOfCreature, setRimHerdDocile, type RimHerd } from '../rimFauna/common';
import { addRimHerdCalf, spawnRimHerd } from '../rimFauna/rimFauna';
import { FaunaVariant, faunaHerdInfo, faunaVariantDef } from '../newFauna/common';
import { type HerderColony, harvestResourceIds, herderColonyHerds, herderColonyOfHerd, herderParam, isHerderEmpire, peekRimHerdersState, rimHerdersState } from './common';

/** Size of a regrown herd's calves (the stock Kaltor ctor rolls 80–190). */
export const HERD_YOUNG_SIZE = 60;
/** Maturity share (Size / MaxSize) that unlocks each bred trait. */
export const TRAIT_HEAL_AT = 0.5;
export const TRAIT_PIERCE_AT = 0.67;
/** "Thick hide": HealRate of a herd past TRAIT_HEAL_AT (damage healed per second; stock Kaltor 0.2). */
export const HEAL_RATE = 2.0;

/** A wild herd rallying to a herder colony (saved; plain data and graph references). */
export interface HerderRally {
    herdId: number;
    colonyIndex: number;
    attackerId: number;
    until: number;
    returning: boolean;
}

function rallies(galaxy: Galaxy): HerderRally[] {
    const st = rimHerdersState(galaxy) as { rallies?: HerderRally[] };
    return (st.rallies ??= []);
}

function owned(hc: HerderColony): boolean {
    return (hc.status === 'free' || hc.status === 'protectorate') && !hc.colony.hasBeenDestroyed && hc.colony.empire !== null;
}

/**
 * "Fast" husbandry: a protectorate, or a neighbour of the colony in good standing (≥ rimHerdersCharacterStanding) with an
 * active herder drover. Pure.
 */
export function fastHusbandry(galaxy: Galaxy, hc: HerderColony): boolean {
    if (hc.status === 'protectorate') return true;
    const st = peekRimHerdersState(galaxy);
    if (st === null) return false;
    const need = herderParam(galaxy, 'rimHerdersCharacterStanding');
    return st.characters.some((c) => c.kind === 'drover' && c.character.active && hc.neighbourSince[c.empireId] !== undefined && (st.standing[c.empireId] ?? 0) >= need);
}

/** The creature's own strength formula: Kaltor Size / 20 and Size × 1.4; a 19g-7b variant its attackDiv / killMul. */
function strengthFor(galaxy: Galaxy, herd: RimHerd, size: number): { attack: number; kill: number } {
    const info = faunaHerdInfo(galaxy, herd);
    if (info !== null) {
        const def = faunaVariantDef(info.variant);
        return { attack: def.attackDiv > 0 ? Math.trunc(size / def.attackDiv) : 0, kill: Math.trunc(size * def.killMul) };
    }
    return { attack: Math.trunc(size / 20.0), kill: Math.trunc(size * 1.4) };
}

/** Yearly maturity growth of one herd (no Rnd). */
export function matureHerd(galaxy: Galaxy, herd: RimHerd, fast: boolean): void {
    const years = Math.max(1, herderParam(galaxy, 'rimHerdersMatureYears'));
    for (const c of herdMembers(herd)) {
        if (c.size >= c.maxSize) continue;
        const step = Math.max(1, Math.round(((c.maxSize - HERD_YOUNG_SIZE) / years) * (fast ? 1.5 : 1)));
        c.size = Math.min(c.maxSize, c.size + step);
        const s = strengthFor(galaxy, herd, c.size);
        c.attackStrength = Math.max(c.attackStrength, s.attack);
        c.damageKillThreshold = Math.max(c.damageKillThreshold, s.kill);
        if (c.size >= c.maxSize * TRAIT_HEAL_AT) c.healRate = Math.max(c.healRate, Math.fround(HEAL_RATE));
    }
}

/** A regrown young herd for a herdless colony: rimFaunaHerdSizeMin small Kaltors, docile to the colony's herders. Rnd. */
function regrowHerd(galaxy: Galaxy, hc: HerderColony): RimHerd | null {
    const n = Math.max(1, Math.trunc(faunaParam(galaxy, 'rimFaunaHerdSizeMin')));
    const angle = galaxy.rnd.nextDouble() * Math.PI * 2.0;
    const herd = spawnRimHerd(galaxy, hc.colony.systemIndex, n, { x: hc.colony.xpos + Math.cos(angle) * 3000, y: hc.colony.ypos + Math.sin(angle) * 3000 });
    if (herd === null) return null;
    for (const c of herdMembers(herd)) {
        c.size = HERD_YOUNG_SIZE;
        const s = strengthFor(galaxy, herd, c.size);
        c.attackStrength = s.attack;
        c.damageKillThreshold = s.kill;
    }
    hc.herdIds.push(herd.id);
    setRimHerdDocile(galaxy, herd, hc.colony.empire!.empireId, true);
    if (hc.protectorId >= 0) setRimHerdDocile(galaxy, herd, hc.protectorId, true);
    const st = rimHerdersState(galaxy);
    st.rev++;
    st.stats.regrown = (st.stats.regrown ?? 0) + 1;
    return herd;
}

/** The yearly husbandry pass (`rimHerders.year`): extra calves, regrown herds, maturity. Rnd (calf rolls, spawns). */
export function rimHerdersHusbandryYear(galaxy: Galaxy): void {
    const st = rimHerdersState(galaxy);
    const now = galaxyStarDate(galaxy);
    const sizeMax = Math.trunc(faunaParam(galaxy, 'rimFaunaHerdSizeMax'));
    const chance = faunaParam(galaxy, 'rimFaunaBreedChance');
    const regrowYears = herderParam(galaxy, 'rimHerdersRegrowYears');
    for (const hc of st.colonies) {
        if (!owned(hc)) {
            hc.herdlessSince = undefined;
            continue;
        }
        const fast = fastHusbandry(galaxy, hc);
        const herds = herderColonyHerds(galaxy, hc);
        if (herds.length === 0) {
            if (hc.herdlessSince === undefined) hc.herdlessSince = now;
            else if (now - hc.herdlessSince >= regrowYears * (fast ? 0.5 : 1) * YEAR_LENGTH) {
                if (regrowHerd(galaxy, hc) !== null) hc.herdlessSince = undefined;
            }
            continue;
        }
        hc.herdlessSince = undefined;
        const safe = hc.defendUntil <= now - YEAR_LENGTH + 30 * GAME_DAY_LENGTH;
        for (const herd of herds) {
            if (fast && safe && herd.migration === null && herdMembers(herd).length < sizeMax && galaxy.rnd.nextDouble() < chance) {
                if (addRimHerdCalf(galaxy, herd) !== null) st.stats.calves = (st.stats.calves ?? 0) + 1;
            }
            matureHerd(galaxy, herd, fast);
        }
    }
}

/** creatureArmorPierce: a free / protectorate herder herd member past TRAIT_PIERCE_AT maturity. Pure. */
export function herderArmorPierce(galaxy: Galaxy, creature: Creature): number {
    if (creature.size < creature.maxSize * TRAIT_PIERCE_AT) return 0;
    const herd = rimHerdOfCreature(galaxy, creature);
    if (herd === null) return 0;
    const hc = herderColonyOfHerd(galaxy, herd);
    return hc !== null && owned(hc) ? herderParam(galaxy, 'rimHerdersPierceShare') : 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Stampede
// ---------------------------------------------------------------------------------------------------------------

/** Wild herds that may rally: plain 19g-7 herds and, with 19g-7b, untamed hunter packs and void whales. Pure. */
function canRally(galaxy: Galaxy, herd: RimHerd): boolean {
    if (herd.leader === null || herd.migration !== null || herd.docileEmpireIds.length > 0 || herderColonyOfHerd(galaxy, herd) !== null) return false;
    const info = faunaHerdInfo(galaxy, herd);
    if (info === null) return herd.type === CreatureType.Kaltor;
    return info.tamedBy < 0 && (info.variant === FaunaVariant.HunterPack || info.variant === FaunaVariant.VoidWhale);
}

/**
 * Stampede: up to rimHerdersStampedeHerds wild herds within rimHerdersStampedeRange of the colony rally against
 * `attacker`'s empire (nearest first). `friendly` = the protector and the colony's friendly empires (never a target).
 * Returns the herds rallied. No Rnd.
 */
export function startStampede(galaxy: Galaxy, hc: HerderColony, attacker: Empire, friendly: readonly Empire[]): number {
    const now = galaxyStarDate(galaxy);
    if ((hc.stampedeReadyAt ?? 0) > now || friendly.includes(attacker) || attacker === hc.colony.empire || isHerderEmpire(galaxy, attacker)) return 0;
    const fs = peekRimFaunaState(galaxy);
    if (fs === null) return 0;
    const st = rimHerdersState(galaxy);
    const colonyIndex = st.colonies.indexOf(hc);
    const list = rallies(galaxy);
    const range = herderParam(galaxy, 'rimHerdersStampedeRange');
    const cand: { herd: RimHerd; d: number }[] = [];
    for (const herd of fs.herds) {
        if (!canRally(galaxy, herd) || list.some((r) => r.herdId === herd.id)) continue;
        const d = galaxy.calculateDistance(herd.leader!.xpos, herd.leader!.ypos, hc.colony.xpos, hc.colony.ypos);
        if (d <= range) cand.push({ herd, d });
    }
    cand.sort((a, b) => a.d - b.d || a.herd.id - b.herd.id);
    const n = Math.min(cand.length, Math.max(0, Math.trunc(herderParam(galaxy, 'rimHerdersStampedeHerds'))));
    const until = now + herderParam(galaxy, 'rimHerdersStampedeDays') * GAME_DAY_LENGTH;
    for (let i = 0; i < n; i++) list.push({ herdId: cand[i].herd.id, colonyIndex, attackerId: attacker.empireId, until, returning: false });
    hc.stampedeReadyAt = now + herderParam(galaxy, 'rimHerdersStampedeCooldown') * GAME_DAY_LENGTH;
    if (n > 0) st.stats.stampedes = (st.stats.stampedes ?? 0) + 1;
    st.stats.stampedeHerds = (st.stats.stampedeHerds ?? 0) + n;
    return n;
}

function steerTo(c: Creature, x: number, y: number, range: number, hyper: boolean): void {
    if (c.anchorPoint === null) c.anchorPoint = { x: Math.trunc(x), y: Math.trunc(y) };
    c.anchorPoint.x = Math.trunc(x);
    c.anchorPoint.y = Math.trunc(y);
    c.anchorRange = range;
    c.hyperSpeed = hyper ? HERD_HYPER_SPEED : 0;
}

/** Rally steering (every rimHerders tick): go, hunt the attacker's ships near the colony, then go home. No Rnd. */
export function rimHerdersStampedeTick(galaxy: Galaxy, setTarget: (c: Creature, target: BuiltObject) => void): void {
    const st = peekRimHerdersState(galaxy) as { rallies?: HerderRally[]; colonies: HerderColony[] } | null;
    const list = st?.rallies;
    const fs = peekRimFaunaState(galaxy);
    if (st === null || list === undefined || list.length === 0 || fs === null) return;
    const now = galaxyStarDate(galaxy);
    const defend = Math.max(herderParam(galaxy, 'rimHerdersDefendRange'), 20000);
    for (const r of [...list]) {
        const herd = fs.herds.find((h) => h.id === r.herdId);
        const hc = st.colonies[r.colonyIndex];
        if (herd === undefined || herd.leader === null || herd.migration !== null || hc === undefined) {
            list.splice(list.indexOf(r), 1);
            continue;
        }
        const members = herdMembers(herd);
        const leader = herd.leader;
        const attacker = galaxy.empires.find((e) => e !== null && e.empireId === r.attackerId) ?? galaxy.pirateEmpires.find((e) => e !== null && e.empireId === r.attackerId) ?? null;
        if (!r.returning && (r.until <= now || !owned(hc) || attacker === null || !attacker.active)) r.returning = true;
        if (r.returning) {
            const d = galaxy.calculateDistance(leader.xpos, leader.ypos, herd.homeX, herd.homeY);
            const home = d <= HERD_REST_RANGE * 3;
            for (const c of members) {
                if (c.currentTarget !== null && isRallyTarget(c.currentTarget, r.attackerId)) c.currentTarget = null;
                steerTo(c, herd.homeX, herd.homeY, HERD_REST_RANGE, !home);
                if (faunaHerdInfo(galaxy, herd) === null) c.attackRange = HERD_ATTACK_RANGE;
            }
            if (home) list.splice(list.indexOf(r), 1);
            continue;
        }
        const d = galaxy.calculateDistance(leader.xpos, leader.ypos, hc.colony.xpos, hc.colony.ypos);
        const there = d <= defend;
        let best: BuiltObject | null = null;
        if (there) {
            let bestD = defend * 2;
            for (const bo of attacker!.builtObjects) {
                if (bo == null || bo.hasBeenDestroyed) continue;
                const dd = galaxy.calculateDistance(bo.xpos, bo.ypos, hc.colony.xpos, hc.colony.ypos);
                if (dd < bestD) {
                    bestD = dd;
                    best = bo;
                }
            }
        }
        for (const c of members) {
            steerTo(c, hc.colony.xpos, hc.colony.ypos, defend, !there);
            c.attackRange = Math.max(c.attackRange, defend);
            if (best !== null && (c.currentTarget === null || (c.currentTarget as { hasBeenDestroyed?: boolean }).hasBeenDestroyed)) setTarget(c, best);
        }
    }
}

function isRallyTarget(t: unknown, empireId: number): boolean {
    const e = (t as { empire?: Empire | null }).empire ?? null;
    return e !== null && e.empireId === empireId;
}

/** A rallied herd member (the creature-side hostility override: it hunts the rally's attacker). Pure. */
export function rallyAttackerOf(galaxy: Galaxy, creature: Creature): number {
    const st = peekRimHerdersState(galaxy) as { rallies?: HerderRally[] } | null;
    if (st?.rallies === undefined || st.rallies.length === 0) return -1;
    const herd = rimHerdOfCreature(galaxy, creature);
    if (herd === null) return -1;
    const r = st.rallies.find((x) => x.herdId === herd.id && !x.returning);
    return r === undefined ? -1 : r.attackerId;
}

// ---------------------------------------------------------------------------------------------------------------
// Herd-good demand
// ---------------------------------------------------------------------------------------------------------------

const NONE: readonly number[] = [];
const knownCache = new WeakMap<Galaxy, { at: number; known: Map<number, boolean> }>();

/** extraLuxuryOrders: herd goods for colonies of empires that know a herder port and stand at ≥ 0. Pure. */
export function herdGoodLuxuryOrders(galaxy: Galaxy, empire: Empire): readonly number[] {
    const st = peekRimHerdersState(galaxy);
    if (st === null || st.colonies.length === 0 || isHerderEmpire(galaxy, empire) || (st.standing[empire.empireId] ?? 0) < 0) return NONE;
    let c = knownCache.get(galaxy);
    if (c === undefined || c.at !== galaxy.nowMs) {
        c = { at: galaxy.nowMs, known: new Map() };
        knownCache.set(galaxy, c);
    }
    let known = c.known.get(empire.empireId);
    if (known === undefined) {
        known = st.colonies.some((hc) => owned(hc) && empire.visibility.checkSystemExplored(hc.colony.systemIndex));
        c.known.set(empire.empireId, known);
    }
    return known ? harvestResourceIds(galaxy) : NONE;
}
