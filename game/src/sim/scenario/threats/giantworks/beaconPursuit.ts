// The Beacon, part 5: the capitals' pursuit (Giantworks wonder, flag gwBeacon). Not a port: new scenario behaviour composed of the stock
// hyperjump (cmdMovement.ts HyperTo), the stock Attack-a-ship mission and the stock "stop the ship" (movement.ts exitHyperjump), gated by the flag.
//
// A Reclaimer capital ship's hyperdrive is the best there is: when an enemy ship (or fleet) that was fighting it or its escorts runs away by hyperjump
// (the stock flee, the Retreats change, a player's order alike), the capital and some of its escorts go after it:
//   START   - the enemy (at war with the Reclaimers) fought a Reclaimer ship up to beaconPursuitContactDays before it went into warp; the nearest free
//             capital to that fight (not on cooldown, not committed to a siege / landing / staging / the Beacon's guard / a reserve answering a threat,
//             one capital per group) goes with up to beaconPursuitEscorts escorts, if the unit is not badly damaged (beaconPursuitMinHealthPct), is
//             faster than the enemy (beaconPursuitSpeedPct), can reach it before it comes out of warp, and the chase stays within
//             beaconPursuitMaxSectors of where it began. They are ordered to Attack the fleeing ship: the stock mission jumps to its CURRENT position
//             at every step (a pursuit curve), and the pursuers' jump spools beaconPursuitSpoolPct % of the stock time (query hyperjumpSpoolFactor).
//   PULL    - a pursuer in warp within beaconPursuitPullRange of the enemy in warp drags it (and its fleet's ships in warp) out of warp, as the player's
//             Stop does (exitHyperjump, clear its mission): it may not start another jump for beaconPursuitLockDays (query hyperjumpCountdown), and the
//             pursuers arrive and fight where it dropped. Not at a place where the enemy's defence outweighs the pursuers (beaconPursuitDefencePct): the
//             pursuit ends at the edge of a defended system.
//   END     - the enemy is destroyed; or beaconPursuitFightDays after the pull; or beaconPursuitGiveUpDays since the start; or it is too far
//             (beaconPursuitMaxSectors); or it stopped in a defended place before it was caught; or the capital is lost. The ships then take up the orders
//             they had; the capital rests beaconPursuitCooldownDays.
// A human's ship that is pulled gets a message. Rnd: none (fixed iteration orders: contacts in list order, chases in creation order).

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { BuiltObject } from '../../../builtObject';
import { BuiltObjectRole } from '../../../data/designSpecifications';
import { BuiltObjectSubRole } from '../../../builtObjectTypes';
import { EmpireMessageType } from '../../../messages';
import { galaxyStarDate } from '../../../tick/simTime';
import { exitHyperjump, warpSpeedWithBonuses } from '../../../movement';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../../../diplomacy';
import { assignMission, clearPreviousMissionRequirements } from '../../../missions/assign';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, CommandAction, builtObjectMission, isBuiltObject } from '../../../missions/mission';
import type { ShipGroup } from '../../../fleets/shipGroup';
import { forceCompleteMission } from '../../../fleets/shipGroupTasks';
import { isHumanEmpire } from '../../../humanEmpires';
import { GAME_DAY_LENGTH, registerScenarioFramePeriodic, registerScenarioQuery } from '../../hooks';
import { scenarioMessage, scenarioText as T } from '../../messages';
import { normalEmpires } from '../framework';
import { BEACON_FLAG, P, SYSTEM_RADIUS, peekBeaconState, warOn, type BeaconState, type PriorOrder, type PursuitChase, type PursuitRec } from './beaconState';
import { enemyStrengthNear, strengthOf } from './beaconFleet';

/** A Reclaimer ship this near a fighting ship answers for it: the capital of the fleet it belongs to is looked for within this range. */
const CAPITAL_RANGE = 80000;
/** Escorts are taken from within this range of the capital. */
const ESCORT_RANGE = 80000;
/** The fights are sampled every this many days; the chases driven every CHASE_DAYS. */
const SAMPLE_DAYS = 0.5;
const CHASE_DAYS = 0.1;
/** Contacts kept at most. */
const CONTACTS_MAX = 240;
/** A message of the pull-out kind goes to one empire at most every this many days. */
const MSG_DAYS = 20;
/** The defended-place check of a chase whose enemy has stopped is repeated at most every this many days. */
const DEF_DAYS = 2;

function days(n: number): number {
    return n * GAME_DAY_LENGTH;
}

export function pursuitOf(st: BeaconState): PursuitRec {
    return (st.pursuit ??= { chases: [], nextId: 1, sampled: -1e18, contacts: [], cooldown: [], locks: [], msgLast: {}, stats: {} });
}

function stat(pr: PursuitRec, key: string, by = 1): void {
    pr.stats[key] = (pr.stats[key] ?? 0) + by;
}

/** True when `bo` is in a pursuit now (the fleet passes leave its orders alone). Pure. */
export function isPursuing(galaxy: Galaxy, bo: BuiltObject): boolean {
    const chases = peekBeaconState(galaxy)?.pursuit?.chases;
    if (chases === undefined || chases.length === 0) return false;
    for (const c of chases) if (c.capital === bo || c.escorts.includes(bo)) return true;
    return false;
}

/** A ship in hyperspace: past its jump's spool and flying at warp speed. Pure. */
function inWarp(b: BuiltObject): boolean {
    return !b.hasBeenDestroyed && b.warpSpeed > 0 && !b.hyperjumpPrepare && b.currentSpeed > b.topSpeed;
}

function isCapital(st: BeaconState, b: BuiltObject): boolean {
    if (b.hasBeenDestroyed || b.actualEmpire !== st.faction || b.subRole !== BuiltObjectSubRole.CapitalShip || b.topSpeed <= 0 || b === st.beacon) return false;
    if (b.isPlanetDestroyer || st.watchers.some((w) => w.ship === b)) return false;
    return !(st.cattle ?? []).some((c) => c.ship === b) && !(st.cores ?? []).some((c) => c.harvester === b);
}

/** A ship the pursuit may chase: a mobile ship of an ordinary empire at war with the Reclaimers. Pure. */
function chaseable(galaxy: Galaxy, st: BeaconState, b: BuiltObject): boolean {
    if (b.hasBeenDestroyed || b.role === BuiltObjectRole.Base || b.warpSpeed <= 0) return false;
    const e = b.actualEmpire;
    if (e === null || e === st.faction || e === galaxy.independentEmpire || e.pirateEmpireBaseHabitat !== null || !e.active) return false;
    return obtainDiplomaticRelation(st.faction!, e).type === DiplomaticRelationType.War;
}

function shipGroupOf(b: BuiltObject): ShipGroup | null {
    return (b.shipGroup as ShipGroup | null) ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// Contacts: who fought a Reclaimer ship lately
// ---------------------------------------------------------------------------------------------------------------

function noteContact(pr: PursuitRec, victim: BuiltObject, by: BuiltObject, now: number): void {
    if (inWarp(victim)) return; // already gone: a new contact is not a fight it ran from
    for (const c of pr.contacts) {
        if (c.victim === victim) {
            c.by = by;
            c.date = now;
            return;
        }
    }
    if (pr.contacts.length < CONTACTS_MAX) pr.contacts.push({ victim, by, date: now });
}

function sampleContacts(galaxy: Galaxy, st: BeaconState, now: number): void {
    const faction = st.faction!;
    const pr = pursuitOf(st);
    for (const r of faction.builtObjects) {
        if (r.hasBeenDestroyed || r.role !== BuiltObjectRole.Military) continue;
        const att = r.attackers;
        const tgt = r.currentTarget;
        const hasAtt = att !== null && att.length > 0;
        if (!hasAtt && !isBuiltObject(tgt)) continue;
        if (hasAtt) {
            for (const a of att!) {
                if (isBuiltObject(a) && chaseable(galaxy, st, a)) noteContact(pr, a, r, now);
            }
        }
        if (isBuiltObject(tgt) && chaseable(galaxy, st, tgt)) noteContact(pr, tgt, r, now);
    }
    const keep = days(P.pursuitContactDays(galaxy));
    pr.contacts = pr.contacts.filter((c) => !c.victim.hasBeenDestroyed && !c.by.hasBeenDestroyed && now - c.date <= keep);
}

// ---------------------------------------------------------------------------------------------------------------
// Starting a pursuit
// ---------------------------------------------------------------------------------------------------------------

interface Holder {
    ships: BuiltObject[];
    /** The capital is committed (a siege, a landing, staging, the Beacon's guard, a reserve answering a threat, a group carrying troops). */
    hold: boolean;
}

/** The group or fleet a capital belongs to. A ship in none (a raid pair, a straggler) is its own, free, group of the Reclaimer warships near it. */
function holderOf(galaxy: Galaxy, st: BeaconState, cap: BuiltObject): Holder {
    for (const s of st.seasons) {
        for (const g of s.groups) {
            if (!g.ships.includes(cap)) continue;
            const committed = g.state === 'gather' || g.state === 'siege' || g.state === 'landed' || (g.state === 'travel' && g.transports.some((t) => !t.hasBeenDestroyed));
            return { ships: g.ships, hold: committed };
        }
    }
    for (const f of st.watcherFleets ?? []) if (f.ships.includes(cap)) return { ships: f.ships, hold: f.mode === 'offensive' && (f.arrived ?? 0) > 0 };
    for (const f of st.response?.fleets ?? []) if (f.ships.includes(cap)) return { ships: f.ships, hold: f.mode === 'respond' };
    if (st.guards.includes(cap)) return { ships: st.guards, hold: true };
    const near: BuiltObject[] = [];
    for (const b of st.faction!.builtObjects) {
        if (b === cap || b.hasBeenDestroyed || b.role !== BuiltObjectRole.Military || b.topSpeed <= 0 || b.subRole === BuiltObjectSubRole.TroopTransport) continue;
        if (galaxy.calculateDistance(b.xpos, b.ypos, cap.xpos, cap.ypos) <= ESCORT_RANGE / 2) near.push(b);
    }
    return { ships: [cap, ...near], hold: false };
}

function busy(pr: PursuitRec, b: BuiltObject): boolean {
    for (const c of pr.chases) if (c.capital === b || c.escorts.includes(b)) return true;
    return false;
}

/** The share (0..100) of the ships' components that are not damaged. Pure. */
export function unitHealthPct(ships: readonly BuiltObject[]): number {
    let total = 0;
    let bad = 0;
    for (const b of ships) {
        total += b.components.items.length;
        bad += b.damagedComponentCount;
    }
    return total <= 0 ? 100 : 100 * (1 - Math.min(1, bad / total));
}

/** The defence of the ordinary empires at a place inside a system (their warships and armed bases near its star); 0 outside every system. Pure. */
export function defenceAt(galaxy: Galaxy, st: BeaconState, x: number, y: number): number {
    const star = galaxy.fastFindNearestSystem(x, y);
    if (star === null || galaxy.calculateDistance(x, y, star.xpos, star.ypos) > SYSTEM_RADIUS * 1.5) return 0;
    let d = enemyStrengthNear(galaxy, st, star.xpos, star.ypos, SYSTEM_RADIUS);
    for (const e of normalEmpires(galaxy, st.faction)) {
        for (const b of e.builtObjects) {
            if (b.hasBeenDestroyed || b.role !== BuiltObjectRole.Base) continue;
            if (galaxy.calculateDistance(b.xpos, b.ypos, star.xpos, star.ypos) <= SYSTEM_RADIUS) d += strengthOf(b);
        }
    }
    return d;
}

/** Whether a unit of `mine` strength should stop at (x, y): the defence there outweighs it by beaconPursuitDefencePct %. Pure. */
function tooDefended(galaxy: Galaxy, st: BeaconState, x: number, y: number, mine: number): boolean {
    const d = defenceAt(galaxy, st, x, y);
    return d > 0 && d * 100 > mine * P.pursuitDefencePct(galaxy);
}

/** Can a unit with warp speed `vp` from `from` catch `v` (in warp) before it comes out of warp, within `maxDist`? Pure. */
export function canCatch(galaxy: Galaxy, from: BuiltObject, vp: number, v: BuiltObject): 'ok' | 'slow' | 'far' | 'headStart' {
    const vv = v.currentSpeed;
    if (!(vv > 0) || vp * 100 < vv * P.pursuitSpeedPct(galaxy)) return 'slow';
    const left = v.lastHyperDistance < 5e8 ? v.lastHyperDistance : Infinity;
    const d0 = galaxy.calculateDistance(from.xpos, from.ypos, v.xpos, v.ypos);
    const spool = (from.hyperjumpInitiate * P.pursuitSpoolPct(galaxy)) / 100 + 1;
    // a tail chase is the slowest: the gap when they set off over the speed difference
    const tc = Math.max(0, d0 + vv * spool - P.pursuitPullRange(galaxy)) / (vp - vv);
    if (vp * tc > P.pursuitMaxSectors(galaxy) * galaxy.sectorSize) return 'far';
    if (spool + tc > left / vv) return 'headStart';
    return 'ok';
}

function priorOf(bo: BuiltObject): PriorOrder | null {
    const m = builtObjectMission(bo.mission);
    if (m === null) return null;
    return { ship: bo, type: m.type, habitat: m.targetHabitat, target: m.targetBuiltObject, x: m.x, y: m.y };
}

function startChase(galaxy: Galaxy, st: BeaconState, pr: PursuitRec, victim: BuiltObject, by: BuiltObject, now: number): void {
    if (pr.chases.length >= P.pursuitMax(galaxy) || pr.chases.some((c) => c.target === victim)) return;
    // the nearest free capital to the fight
    let cap: BuiltObject | null = null;
    let bd = Infinity;
    for (const b of st.faction!.builtObjects) {
        if (!isCapital(st, b)) continue;
        const d = galaxy.calculateDistance(b.xpos, b.ypos, by.xpos, by.ypos);
        if (d <= CAPITAL_RANGE && d < bd) {
            bd = d;
            cap = b;
        }
    }
    if (cap === null) return;
    if (busy(pr, cap)) return;
    if (pr.cooldown.some((c) => c.capital === cap && c.until > now)) {
        stat(pr, 'refusedCooldown');
        return;
    }
    const holder = holderOf(galaxy, st, cap);
    if (holder.hold) {
        stat(pr, 'refusedCommitted');
        return;
    }
    for (const c of pr.chases) if (holder.ships.includes(c.capital)) return; // one capital per group
    const vp0 = warpSpeedWithBonuses(cap);
    if (vp0 * 100 < victim.currentSpeed * P.pursuitSpeedPct(galaxy)) {
        stat(pr, 'refusedSlow');
        return;
    }
    const escorts = holder.ships
        .filter((b) => b !== cap && !b.hasBeenDestroyed && b.role === BuiltObjectRole.Military && b.topSpeed <= b.warpSpeed && b.warpSpeed > 0 && b.subRole !== BuiltObjectSubRole.CapitalShip && b.subRole !== BuiltObjectSubRole.TroopTransport && !busy(pr, b) && galaxy.calculateDistance(b.xpos, b.ypos, cap!.xpos, cap!.ypos) <= ESCORT_RANGE && warpSpeedWithBonuses(b) * 100 >= victim.currentSpeed * P.pursuitSpeedPct(galaxy))
        .sort((a, b) => galaxy.calculateDistance(a.xpos, a.ypos, cap!.xpos, cap!.ypos) - galaxy.calculateDistance(b.xpos, b.ypos, cap!.xpos, cap!.ypos) || a.builtObjectID - b.builtObjectID)
        .slice(0, P.pursuitEscorts(galaxy));
    if (escorts.length === 0) {
        stat(pr, 'refusedNoEscort');
        return;
    }
    const unit = [cap, ...escorts];
    if (unitHealthPct(unit) < P.pursuitMinHealthPct(galaxy)) {
        stat(pr, 'refusedDamaged');
        return;
    }
    let vp = vp0;
    for (const b of escorts) vp = Math.min(vp, warpSpeedWithBonuses(b));
    const plan = canCatch(galaxy, cap, vp, victim);
    if (plan !== 'ok') {
        stat(pr, plan === 'slow' ? 'refusedSlow' : plan === 'far' ? 'refusedFar' : 'refusedHeadStart');
        return;
    }
    const chase: PursuitChase = { id: pr.nextId++, capital: cap, escorts, target: victim, start: now, originX: cap.xpos, originY: cap.ypos, pulled: 0, prior: [] };
    for (const b of unit) {
        const p = priorOf(b);
        if (p !== null) chase.prior.push(p);
    }
    pr.chases.push(chase);
    for (const b of unit) {
        // machine-fed: topped up before a long flight; not automated (the stock AI would fold a warship into a fleet of its own)
        if (b.fuelCapacity > 0 && b.currentFuel < b.fuelCapacity) b.currentFuel = b.fuelCapacity;
        b.isAutoControlled = false;
        assignMission(galaxy, b, BuiltObjectMissionType.Attack, victim, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
    }
    stat(pr, 'started');
    if (isHumanEmpire(galaxy, victim.actualEmpire as Empire)) stat(pr, 'startedHuman');
}

// ---------------------------------------------------------------------------------------------------------------
// The pull
// ---------------------------------------------------------------------------------------------------------------

function placeName(galaxy: Galaxy, o: { xpos: number; ypos: number }): string {
    const s = galaxy.fastFindNearestSystem(o.xpos, o.ypos);
    return s?.name ?? '';
}

/** Drags `v` (and the ships of its fleet that are in warp) out of warp where it is, as the Stop order does; locks their jumps for a while. Returns the ships pulled. */
function pullOut(galaxy: Galaxy, st: BeaconState, pr: PursuitRec, v: BuiltObject, now: number): number {
    const group = shipGroupOf(v);
    const ships = group !== null ? group.ships.filter((b) => inWarp(b)) : [];
    if (!ships.includes(v)) ships.push(v);
    let n = 0;
    for (const b of ships) {
        if (!inWarp(b)) continue;
        exitHyperjump(galaxy, b);
        clearPreviousMissionRequirements(galaxy, b, true);
        b.currentSpeed = Math.min(b.currentSpeed, b.cruiseSpeed);
        b.targetSpeed = 0;
        b.preferredSpeed = 0;
        pr.locks = pr.locks.filter((l) => l.ship !== b);
        pr.locks.push({ ship: b, until: now + days(P.pursuitLockDays(galaxy)) });
        n++;
    }
    if (group !== null) forceCompleteMission(galaxy, group);
    stat(pr, 'pulledShips', n);
    const e = v.actualEmpire as Empire | null;
    if (e !== null && isHumanEmpire(galaxy, e)) {
        stat(pr, 'pulledHuman', n);
        const key = String(e.empireId);
        const last = pr.msgLast[key];
        if (last === undefined || now - last >= days(MSG_DAYS)) {
            pr.msgLast[key] = now;
            const what = group !== null && group.ships.length > 1 ? (group.name ?? v.name) : v.name;
            scenarioMessage(galaxy, e, T('Beacon Msg Pull Title'), T('Beacon Msg Pull', what, placeName(galaxy, v)), { type: EmpireMessageType.GeneralNeutralEvent, subject: v, popupMode: 'quiet' });
        }
    }
    return n;
}

// ---------------------------------------------------------------------------------------------------------------
// Driving and ending the chases
// ---------------------------------------------------------------------------------------------------------------

function endChase(galaxy: Galaxy, pr: PursuitRec, c: PursuitChase, why: string, now: number): void {
    const i = pr.chases.indexOf(c);
    if (i >= 0) pr.chases.splice(i, 1);
    stat(pr, `end_${why}`);
    if (c.pulled > 0) stat(pr, 'endAfterPull');
    pr.cooldown = pr.cooldown.filter((x) => x.until > now && x.capital !== c.capital && !x.capital.hasBeenDestroyed);
    if (!c.capital.hasBeenDestroyed) pr.cooldown.push({ capital: c.capital, until: now + days(P.pursuitCooldownDays(galaxy)) });
    // the ships go back to what they were doing (the group passes re-issue it, but a garrison or a post is ordered only once)
    for (const o of c.prior) {
        const b = o.ship;
        if (b.hasBeenDestroyed || (o.habitat !== null && o.habitat.hasBeenDestroyed) || (o.target !== null && o.target.hasBeenDestroyed)) continue;
        const x = o.x > -1e9 ? o.x : undefined;
        const y = o.y > -1e9 ? o.y : undefined;
        b.isAutoControlled = false;
        assignMission(galaxy, b, o.type as BuiltObjectMissionType, o.habitat ?? o.target, null, BuiltObjectMissionPriority.High, { x, y, manuallyAssigned: true });
    }
}

/**
 * The stock Attack on a ship far away flies to the spot the ship was at when the order was given (the command holds coordinates), so a runner is
 * missed. The pursuers' current jump / move command is re-aimed at the runner's position every step: the pursuit curve of the header.
 */
function steer(unit: readonly BuiltObject[], t: BuiltObject): void {
    for (const b of unit) {
        const cmd = builtObjectMission(b.mission)?.fastPeekCurrentCommand() ?? null;
        if (cmd === null || cmd.xpos <= -1e9 || cmd.ypos <= -1e9) continue;
        if (cmd.action !== CommandAction.HyperTo && cmd.action !== CommandAction.ConditionalHyperTo && cmd.action !== CommandAction.MoveTo) continue;
        cmd.xpos = t.xpos;
        cmd.ypos = t.ypos;
    }
}

function fleetTotal(c: PursuitChase): number {
    let s = 0;
    for (const b of [c.capital, ...c.escorts]) if (!b.hasBeenDestroyed) s += strengthOf(b);
    return s;
}

function driveChase(galaxy: Galaxy, st: BeaconState, pr: PursuitRec, c: PursuitChase, now: number): void {
    c.escorts = c.escorts.filter((b) => !b.hasBeenDestroyed && b.actualEmpire === st.faction);
    if (c.capital.hasBeenDestroyed || c.capital.actualEmpire !== st.faction) {
        endChase(galaxy, pr, c, 'capitalLost', now);
        return;
    }
    const t = c.target;
    if (t.hasBeenDestroyed || t.actualEmpire === null) {
        if (c.pulled > 0) stat(pr, 'killsAfterPull');
        endChase(galaxy, pr, c, 'killed', now);
        return;
    }
    if (now - c.start > days(P.pursuitGiveUpDays(galaxy))) {
        endChase(galaxy, pr, c, 'giveUp', now);
        return;
    }
    const away = galaxy.calculateDistance(c.capital.xpos, c.capital.ypos, c.originX, c.originY);
    const awayX100 = Math.round((away * 100) / galaxy.sectorSize);
    if (awayX100 > (pr.stats.maxAwayX100 ?? 0)) pr.stats.maxAwayX100 = awayX100; // the farthest from a pursuit's start, in 1/100 sectors
    if (away > P.pursuitMaxSectors(galaxy) * galaxy.sectorSize) {
        endChase(galaxy, pr, c, 'tooFar', now);
        return;
    }
    const unit = [c.capital, ...c.escorts];
    steer(unit, t);
    if (inWarp(t)) {
        if (c.pulled > 0) {
            // it ran again: the chase goes on (the cooldown and the give-up time still hold)
            c.pulled = 0;
            stat(pr, 'reflights');
        }
        const range = Math.max(P.pursuitPullRange(galaxy), t.currentSpeed * 0.5);
        for (const b of unit) {
            if (!inWarp(b) || galaxy.calculateDistance(b.xpos, b.ypos, t.xpos, t.ypos) > range) continue;
            // (no defended-place check here: a runner caught in warp is pulled out short of its safe harbour, user 2026-10-19;
            // the check below still stops a chase whose enemy reached a defended place before it was caught)
            c.pulled = now;
            pullOut(galaxy, st, pr, t, now);
            stat(pr, 'caught');
            return;
        }
        return;
    }
    // the enemy is not in warp: it came out of warp on its own (arrived), or was pulled
    if (c.pulled === 0) {
        if (c.defChecked !== undefined && now - c.defChecked < days(DEF_DAYS)) return;
        c.defChecked = now;
        if (tooDefended(galaxy, st, t.xpos, t.ypos, fleetTotal(c))) {
            for (const u of unit) if (inWarp(u)) exitHyperjump(galaxy, u);
            endChase(galaxy, pr, c, 'defended', now);
            return;
        }
        // it reached its exit before they caught it: the pursuers fly on to where it stopped (a fight there if they come); counted once they are there
        for (const b of unit) {
            if (!inWarp(b) && galaxy.calculateDistance(b.xpos, b.ypos, t.xpos, t.ypos) <= 60000) {
                c.pulled = now;
                stat(pr, 'arrived');
                return;
            }
        }
    } else if (now - c.pulled > days(P.pursuitFightDays(galaxy))) {
        endChase(galaxy, pr, c, 'fightOver', now);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Registered periodics and queries
// ---------------------------------------------------------------------------------------------------------------

/** Every CHASE_DAYS: new flights are looked for (every SAMPLE_DAYS the fights are sampled) and the chases driven. */
export function pursuitTick(galaxy: Galaxy): void {
    const st = peekBeaconState(galaxy);
    if (st === null || st.faction === null || !warOn(st) || !P.pursuitOn(galaxy) || !st.faction.active) return;
    const now = galaxyStarDate(galaxy);
    const pr = pursuitOf(st);
    if (now - pr.sampled >= days(SAMPLE_DAYS)) {
        pr.sampled = now;
        sampleContacts(galaxy, st, now);
    }
    // an enemy in warp that fought lately is chased (once: the contact is used up either way)
    if (pr.contacts.length > 0) {
        const keep: typeof pr.contacts = [];
        for (const k of pr.contacts) {
            if (!inWarp(k.victim)) {
                keep.push(k);
                continue;
            }
            startChase(galaxy, st, pr, k.victim, k.by, now);
        }
        pr.contacts = keep;
    }
    for (const c of [...pr.chases]) driveChase(galaxy, st, pr, c, now);
    if (pr.locks.length > 0) pr.locks = pr.locks.filter((l) => l.until > now && !l.ship.hasBeenDestroyed);
}

/** A one-line account (the soak hook and the tests). Pure. */
export function pursuitSummary(st: BeaconState): { chases: number; stats: Record<string, number> } {
    const pr = st.pursuit;
    return pr === undefined ? { chases: 0, stats: {} } : { chases: pr.chases.length, stats: { ...pr.stats } };
}

export function registerPursuit(): void {
    registerScenarioFramePeriodic({ id: 'beacon.pursuit', flag: BEACON_FLAG, order: 24, periodDays: CHASE_DAYS, run: (g) => pursuitTick(g) });
    // the pursuers' jumps spool a fraction of the stock time (neither the interdiction fields nor the slower hyperdrives hold them)
    registerScenarioQuery({
        id: 'beacon.pursuitSpool',
        flag: BEACON_FLAG,
        order: 100,
        query: 'hyperjumpSpoolFactor',
        run: (g, v, a) => (isPursuing(g, a.ship) ? Math.min(v, P.pursuitSpoolPct(g) / 100) : v),
    });
    // a ship dragged out of warp cannot start another jump for a while
    registerScenarioQuery({
        id: 'beacon.pursuitLock',
        flag: BEACON_FLAG,
        order: 100,
        query: 'hyperjumpCountdown',
        run: (g, v, a) => {
            const locks = peekBeaconState(g)?.pursuit?.locks;
            if (locks === undefined) return v;
            for (const l of locks) if (l.ship === a.ship && l.until > v) return l.until;
            return v;
        },
    });
}
