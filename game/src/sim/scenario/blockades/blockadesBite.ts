// Blockades that bite (scenarios/blockades-bite, flag blockadesBite; a user-designed gameplay change, off by default, set
// on the new-game wizard's Other Empires page). Not a port.
//
// The original's blockade (fleets/blockades.ts, Empire.8.cs 3610-3955) is a declared state: a fleet on a Blockade
// mission arrives (missions/cmdMilitary.ts) and SetupBlockade marks the colony and its bases IsBlockaded; ships of
// empires at war / under sanctions with the initiator are then refused docking there (logistics/docking.ts), freight
// skips the blockaded ports (logistics/freight.ts), the AI does not build there (CheckSafeToBuildAtLocation) and
// traders avoid it. It costs the colony no income, construction or growth, and ends only when no ship of the
// initiator holds the mission (CancelInactiveBlockades), at peace (CancelBlockades) or on capture (CancelBlockade).
//
// With the flag on, the orbit decides (the Orbital superiority measure, orbital/orbitalSuperiority.ts: armed firepower
// within ORBIT_RANGE 2000 of the planet; a side holds the orbit when its strength is more than orbitalSuperiorityRatio
// (1.5) times the other's, or the other has none). A colony of a normal empire whose orbit is held by an empire it is
// at war with, or by the initiator of a declared blockade of it, for blockadeConfirmDays daily checks in a row is
// BLOCKADED (also without a Blockade mission) until the orbit has not been held for blockadeConfirmDays checks:
//   - its tax revenue loses blockadeTradeShare (the trade share; query colonyTaxRevenue);
//   - its space ports' trade income × blockadePortTradeFactor (0; query portTradeIncomeFactor);
//   - construction at it stops: the colony's queue and its owner's bases' yards there (query constructionQueuePaused)
//     and its facilities (query colonyFacilityConstructionPaused);
//   - population growth stops (query colonyMaxPopulation: the cap is the current population);
//   - approval −blockadeApprovalPerDay per day of blockade, at most −blockadeApprovalMax (stability term).
// Messages to both owners when it starts and ends; the colony panel and Colonies screen show "Blockaded by X".
// AI (non-human normal empires): every blockadeAiReviewDays it sends up to blockadeAiMaxFleets idle Attack-posture
// fleets that could hold the orbit (orbitalAI.ts canHoldOrbit) on stock Blockade missions to the richest enemy colonies
// it has explored (tax revenue + space port income), at Low priority so the stock war AI can take them for a strike or
// an invasion at any time (blockading never replaces or delays one), released after blockadeAiHoldDays;
// daily, each blockaded AI colony gets the nearest routine fleet not on a strike or invasion with ≥ blockadeAiReliefMinRatio × the blockaders'
// orbit strength as a Normal-priority Patrol of it (above routine patrols; strikes may still take it) (orbitalAI.ts nearestFleet, value × winnability order).
// Blockades SHOOT (blockadeShoots): every day the holder's armed ships in the orbit (an idle ship, or one on a Blockade / Patrol
// mission of that colony) engage the ships of the blockaded side that arrive at or leave the colony (any non-base ship of the
// owner within blockadeShootRange of it; at peace only its unarmed ones: freighters, colony ships ...) and, for a Great Work's
// supplier world, its convoys (scenario queries blockadeSites / blockadeVictimShip, Giantworks), with stock Attack missions (an
// Attack command put on top of a Blockade / Patrol mission, as the stock Blockade does for ships docking), at most
// blockadeShooters ships per target, nearest first. The stock combat and events do the rest (an attack on a Compact convoy angers it).
// Rnd: only the fleet mission assignments' own draws, only with the flag on. State: scenario.state.blockadesBite.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import type { ShipGroup } from '../../fleets/shipGroup';
import { shipGroupAssignMission, shipGroupCompleteMission } from '../../fleets/shipGroup';
import { shipGroupTotalTroopAttackStrength } from '../../fleets/shipGroupTasks';
import { blockadeFor, implementBlockadeColony } from '../../fleets/blockades';
import type { BuiltObject } from '../../builtObject';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { assignMission } from '../../missions/assign';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, Command, CommandAction, builtObjectMission } from '../../missions/mission';
import { getNearbyBuiltObjects } from '../../pirates/pirateAI';
import { DiplomaticRelationType } from '../../diplomacy';
import { FleetPosture } from '../../diplomacyTick';
import { EmpireMessageType } from '../../messages';
import { determineSpacePortAtColony } from '../../combat/attackAI';
import { isHumanEmpire } from '../../humanEmpires';
import { getEmpireById } from '../../logistics/contracts';
import { strategicValue } from '../../territory';
import { galaxyStarDate } from '../../tick/simTime';
import { GAME_DAY_LENGTH, registerScenarioPeriodic, registerScenarioQuery, scenarioQuery } from '../hooks';
import { scenarioMessage, scenarioText } from '../messages';
import { registerStabilityTerm } from '../stability';
import { scenarioFlag, scenarioParam, scenarioState } from '../state';
import { ORBIT_RANGE, classifyOrbit, firepowerByEmpireNear, orbitalRatio } from '../orbital/orbitalSuperiority';
import { canHoldOrbit, fleetFirepower, nearestFleet } from '../orbital/orbitalAI';

export const BLOCKADES_BITE_FLAG = 'blockadesBite';
export const BLOCKADES_BITE_ADDON_ID = 'blockades-bite';
const KEY = 'blockadesBite';

/** One colony under blockade. */
export interface BiteBlockade {
    /** Habitat index, owner / holder empire ids. */
    h: number;
    owner: number;
    by: number;
    /** Star date it began. */
    since: number;
    /** Daily checks in a row the orbit was not held. */
    free: number;
    /** The holder's armed strength in orbit at the last check. */
    a: number;
    /** The tax revenue (per year) the blockade costs now (colonyTaxRevenue). */
    taxLostRate: number;
    /** The owner's relief fleet (AI), while alive. */
    relief: ShipGroup | null;
}

export interface BitePending {
    h: number;
    by: number;
    n: number;
}

/** An AI fleet sent on a Blockade mission by this rule. */
export interface BiteDuty {
    fleet: ShipGroup;
    e: number;
    h: number;
    since: number;
}

export interface BiteStats {
    started: number;
    ended: number;
    /** Ended (orbit lost) while the owner's relief fleet was on its way / there. */
    brokenByRelief: number;
    /** Ended because the colony changed hands. */
    endedByCapture: number;
    reliefsSent: number;
    aiBlockadesOrdered: number;
    aiDutiesReleased: number;
    /** Colony-days under blockade. */
    colonyDays: number;
    /** Tax revenue lost (credits, accrued daily) / port trade income lost. */
    taxLost: number;
    portTradeLost: number;
    /** Attack orders the blockaders gave to ships arriving at / leaving blockaded colonies. */
    shots: number;
}

export interface BlockadesBiteState {
    active: BiteBlockade[];
    pending: BitePending[];
    duties: BiteDuty[];
    /** Habitat / empire pairs whose AI blockade duty ended lately (no new duty there until `until`). */
    cooldowns: { h: number; e: number; until: number }[];
    lastAi: number;
    stats: BiteStats;
}

function newStats(): BiteStats {
    return { started: 0, ended: 0, brokenByRelief: 0, endedByCapture: 0, reliefsSent: 0, aiBlockadesOrdered: 0, aiDutiesReleased: 0, colonyDays: 0, taxLost: 0, portTradeLost: 0, shots: 0 };
}

export function blockadesBiteOn(galaxy: Galaxy): boolean {
    return scenarioFlag(galaxy, BLOCKADES_BITE_FLAG);
}

export function biteState(galaxy: Galaxy): BlockadesBiteState {
    return scenarioState<BlockadesBiteState>(galaxy, KEY, () => ({ active: [], pending: [], duties: [], cooldowns: [], lastAi: 0, stats: newStats() }));
}

function normalEmpire(galaxy: Galaxy, e: Empire | null): e is Empire {
    return e !== null && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null && e.active;
}

/** At war, without creating a relation (obtainDiplomaticRelation adds NotMet ones). */
export function atWarNoAdd(a: Empire, b: Empire): boolean {
    const r = a.diplomaticRelations?.byEmpire(b) ?? null;
    return r !== null && r.type === DiplomaticRelationType.War;
}

function hasWar(galaxy: Galaxy, e: Empire): boolean {
    if (e.diplomaticRelations == null) return false;
    for (const r of e.diplomaticRelations) if (r.type === DiplomaticRelationType.War && normalEmpire(galaxy, r.otherEmpire)) return true;
    return false;
}

export function findBlockade(st: BlockadesBiteState, h: Habitat): BiteBlockade | null {
    for (let i = 0; i < st.active.length; i++) if (st.active[i].h === h.habitatIndex) return st.active[i];
    return null;
}

/** The active blockade of `h` (flag on), or null. */
function activeAt(galaxy: Galaxy, h: Habitat): BiteBlockade | null {
    const st = biteState(galaxy);
    if (st.active.length === 0) return null;
    const rec = findBlockade(st, h);
    return rec !== null && h.empire !== null && h.empire.empireId === rec.owner ? rec : null;
}

/**
 * The empire holding the orbit of colony `h` against its owner (at war with it, or the initiator of a declared
 * blockade of it), with its strength there; null when none does. Pure.
 */
export function orbitHolder(galaxy: Galaxy, h: Habitat): { empire: Empire; a: number } | null {
    const owner = h.empire;
    if (!normalEmpire(galaxy, owner)) return null;
    const fp = firepowerByEmpireNear(galaxy, h.xpos, h.ypos, ORBIT_RANGE);
    if (fp.size === 0) return null;
    const d = fp.get(owner) ?? 0;
    const declared = h.isBlockaded ? (blockadeFor(galaxy, h)?.initiator ?? null) : null;
    const ratio = orbitalRatio(galaxy);
    let best: Empire | null = null;
    let bestA = 0;
    for (const [e, a] of fp) {
        if (e === owner || !(a > bestA)) continue;
        if (e !== declared && !(normalEmpire(galaxy, e) && atWarNoAdd(owner, e))) continue;
        if (classifyOrbit(d, a, ratio) !== 'attacker') continue;
        best = e;
        bestA = a;
    }
    return best === null ? null : { empire: best, a: bestA };
}

// ---------------------------------------------------------------------------------------------------------------
// Daily review: start / end
// ---------------------------------------------------------------------------------------------------------------

function notify(galaxy: Galaxy, rec: BiteBlockade, h: Habitat, started: boolean): void {
    const owner = getEmpireById(galaxy, rec.owner);
    const holder = getEmpireById(galaxy, rec.by);
    const type = started ? EmpireMessageType.BlockadeInitiated : EmpireMessageType.BlockadeCancelled;
    const title = started ? scenarioText('BlockadesBite Title', h.name) : scenarioText('BlockadesBite Lifted Title', h.name);
    if (owner !== null) scenarioMessage(galaxy, owner, title, scenarioText(started ? 'BlockadesBite Started Owner' : 'BlockadesBite Lifted Owner', h.name, holder?.name ?? '?'), { type, subject: h, sender: holder });
    if (holder !== null) scenarioMessage(galaxy, holder, title, scenarioText(started ? 'BlockadesBite Started Holder' : 'BlockadesBite Lifted Holder', h.name, owner?.name ?? '?'), { type, subject: h, sender: owner });
}

function fleetAlive(empire: Empire | null, fleet: ShipGroup | null): fleet is ShipGroup {
    return empire !== null && fleet !== null && fleet.ships.length > 0 && (empire.shipGroups as ShipGroup[]).includes(fleet);
}

function releaseRelief(galaxy: Galaxy, rec: BiteBlockade, h: Habitat | undefined): void {
    const owner = getEmpireById(galaxy, rec.owner);
    if (fleetAlive(owner, rec.relief) && h !== undefined) {
        const m = rec.relief.mission;
        if (m !== null && m.type === BuiltObjectMissionType.Patrol && m.targetHabitat === h) shipGroupCompleteMission(galaxy, rec.relief);
    }
    rec.relief = null;
}

function endBlockade(galaxy: Galaxy, st: BlockadesBiteState, rec: BiteBlockade, captured: boolean): void {
    st.active.splice(st.active.indexOf(rec), 1);
    st.stats.ended++;
    const h = galaxy.habitats[rec.h];
    if (captured) st.stats.endedByCapture++;
    else if (fleetAlive(getEmpireById(galaxy, rec.owner), rec.relief)) st.stats.brokenByRelief++;
    releaseRelief(galaxy, rec, h);
    if (!captured && h !== undefined) notify(galaxy, rec, h, false);
}

export function blockadesBiteDaily(galaxy: Galaxy): void {
    const st = biteState(galaxy);
    const confirm = Math.max(1, Math.round(scenarioParam(galaxy, 'blockadeConfirmDays', 2)));
    const now = galaxyStarDate(galaxy);
    for (const rec of st.active.slice()) {
        const h = galaxy.habitats[rec.h];
        if (h === undefined || h.empire === null || h.empire.empireId !== rec.owner) {
            endBlockade(galaxy, st, rec, true);
            continue;
        }
        st.stats.colonyDays++;
        st.stats.taxLost += rec.taxLostRate / 360;
        const holder = orbitHolder(galaxy, h);
        if (holder !== null) {
            rec.free = 0;
            rec.by = holder.empire.empireId;
            rec.a = holder.a;
        } else if (++rec.free >= confirm) endBlockade(galaxy, st, rec, false);
    }
    const pending: BitePending[] = [];
    for (const owner of galaxy.empires) {
        if (!normalEmpire(galaxy, owner) || owner.colonies.length === 0) continue;
        const war = hasWar(galaxy, owner);
        for (const h of owner.colonies) {
            if (!war && !h.isBlockaded) continue;
            if (findBlockade(st, h) !== null) continue;
            const holder = orbitHolder(galaxy, h);
            if (holder === null) continue;
            const was = st.pending.find((p) => p.h === h.habitatIndex && p.by === holder.empire.empireId);
            const n = (was?.n ?? 0) + 1;
            if (n < confirm) {
                pending.push({ h: h.habitatIndex, by: holder.empire.empireId, n });
                continue;
            }
            const rec: BiteBlockade = { h: h.habitatIndex, owner: owner.empireId, by: holder.empire.empireId, since: now, free: 0, a: holder.a, taxLostRate: 0, relief: null };
            st.active.push(rec);
            st.stats.started++;
            notify(galaxy, rec, h, true);
        }
    }
    st.pending = pending;
}

// ---------------------------------------------------------------------------------------------------------------
// Shooting
// ---------------------------------------------------------------------------------------------------------------

function isShip(b: BuiltObject): boolean {
    return !b.hasBeenDestroyed && b.role !== BuiltObjectRole.Base && b.topSpeed > 0;
}

/** The Attack command already on top of the ship's mission (its target), or null. */
function attackTargetOf(b: BuiltObject): BuiltObject | null {
    const c = builtObjectMission(b.mission)?.fastPeekCurrentCommand() ?? null;
    return c !== null && c.action === CommandAction.Attack ? c.targetBuiltObject : null;
}

/**
 * One blockaded colony `h` (or the Severance's structure), held by `by`: its armed ships in the orbit attack `targets` (ships of the blockaded side near it).
 * An idle ship takes an Attack mission; a ship on a Blockade / Patrol mission of `h` gets an Attack command on top (its
 * mission goes on afterwards); any other ship keeps its orders. Returns the orders given. Draws only inside the stock mission assignment.
 */
export function blockadeShoot(galaxy: Galaxy, by: Empire, h: Habitat | BuiltObject, targets: readonly BuiltObject[], maxPerTarget: number): number {
    if (targets.length === 0) return 0;
    const near = getNearbyBuiltObjects(galaxy, h.xpos, h.ypos, ORBIT_RANGE);
    const shooters: BuiltObject[] = [];
    const engaged = new Map<BuiltObject, number>();
    for (const b of near) {
        if (b == null || !isShip(b) || b.owner !== by) continue;
        const t = attackTargetOf(b);
        if (t !== null) engaged.set(t, (engaged.get(t) ?? 0) + 1);
        else if (b.firepowerRaw > 0 && b.role === BuiltObjectRole.Military) shooters.push(b);
    }
    if (shooters.length === 0) return 0;
    const sorted = targets.slice().sort((x, y) => galaxy.calculateDistanceSquared(h.xpos, h.ypos, x.xpos, x.ypos) - galaxy.calculateDistanceSquared(h.xpos, h.ypos, y.xpos, y.ypos) || x.builtObjectID - y.builtObjectID);
    let orders = 0;
    for (const t of sorted) {
        while ((engaged.get(t) ?? 0) < maxPerTarget && shooters.length > 0) {
            let bi = -1;
            let bd = Infinity;
            for (let i = 0; i < shooters.length; i++) {
                const d = galaxy.calculateDistanceSquared(shooters[i].xpos, shooters[i].ypos, t.xpos, t.ypos);
                if (d < bd) {
                    bd = d;
                    bi = i;
                }
            }
            const s = shooters[bi];
            shooters.splice(bi, 1);
            const m = builtObjectMission(s.mission);
            if (m === null || m.type === BuiltObjectMissionType.Undefined || m.type === BuiltObjectMissionType.Hold) {
                assignMission(galaxy, s, BuiltObjectMissionType.Attack, t, null, BuiltObjectMissionPriority.Normal);
            } else if ((m.type === BuiltObjectMissionType.Blockade || m.type === BuiltObjectMissionType.Patrol) && m.targetHabitat === h) {
                m.insertCommandAtTop(Command.forTarget(CommandAction.Attack, t));
                s.firstExecutionOfCommand = true;
            } else continue;
            engaged.set(t, (engaged.get(t) ?? 0) + 1);
            orders++;
        }
        if (shooters.length === 0) break;
    }
    return orders;
}

/** The blockaded side's ships near colony `h`: the owner's (all of them at war, else its unarmed ones) and the convoys of a Great Work supplier. */
function victimsNear(galaxy: Galaxy, h: Habitat, victim: Empire | null, by: Empire, range: number): BuiltObject[] {
    const out: BuiltObject[] = [];
    const war = victim !== null && atWarNoAdd(by, victim);
    for (const b of getNearbyBuiltObjects(galaxy, h.xpos, h.ypos, range)) {
        if (b == null || !isShip(b) || b.owner === by) continue;
        const own = victim !== null && b.actualEmpire === victim && (war || b.role !== BuiltObjectRole.Military || !(b.firepowerRaw > 0));
        if (own || scenarioQuery(galaxy, 'blockadeVictimShip', false, { habitat: h, builtObject: b })) out.push(b);
    }
    return out;
}

/** Daily: every blockaded colony's holder shoots the arrivals and departures of the blockaded side. */
export function blockadesBiteShoot(galaxy: Galaxy): void {
    if (!(scenarioParam(galaxy, 'blockadeShoots', 1) > 0)) return;
    const st = biteState(galaxy);
    const range = Math.max(ORBIT_RANGE, scenarioParam(galaxy, 'blockadeShootRange', 6000));
    const per = Math.max(1, Math.round(scenarioParam(galaxy, 'blockadeShooters', 2)));
    const sites: { habitat: Habitat; by: Empire; victim: Empire | null }[] = [];
    for (const rec of st.active) {
        const h = galaxy.habitats[rec.h];
        const by = getEmpireById(galaxy, rec.by);
        if (h !== undefined && by !== null && h.empire !== null && h.empire.empireId === rec.owner) sites.push({ habitat: h, by, victim: h.empire });
    }
    for (const s of scenarioQuery(galaxy, 'blockadeSites', [], {})) sites.push(s);
    for (const s of sites) st.stats.shots += blockadeShoot(galaxy, s.by, s.habitat, victimsNear(galaxy, s.habitat, s.victim, s.by, range), per);
}

// ---------------------------------------------------------------------------------------------------------------
// Effects (queries + stability term)
// ---------------------------------------------------------------------------------------------------------------

/** Approval cost of the blockade of `h` now (≤ 0), or null. Pure. */
export function blockadeApprovalTerm(galaxy: Galaxy, h: Habitat): number | null {
    const rec = activeAt(galaxy, h);
    if (rec === null) return null;
    const days = Math.max(0, (galaxyStarDate(galaxy) - rec.since) / GAME_DAY_LENGTH);
    return -Math.min(scenarioParam(galaxy, 'blockadeApprovalMax', 15), scenarioParam(galaxy, 'blockadeApprovalPerDay', 0.1) * days);
}

/** UI: the blockade of `h` (flag on) — holder, days, approval term — or null. Pure. */
export function blockadeInfo(galaxy: Galaxy, h: Habitat): { by: Empire | null; days: number; approval: number; line: string } | null {
    if (galaxy.scenario === null || !blockadesBiteOn(galaxy)) return null;
    const rec = activeAt(galaxy, h);
    if (rec === null) return null;
    const by = getEmpireById(galaxy, rec.by);
    return { by, days: (galaxyStarDate(galaxy) - rec.since) / GAME_DAY_LENGTH, approval: blockadeApprovalTerm(galaxy, h) ?? 0, line: scenarioText('BlockadesBite Line', by?.name ?? '?') };
}

/** Colonies screen approval tooltip lines ("Blockaded by X -3.0"). Pure. */
export function blockadeApprovalLines(galaxy: Galaxy, h: Habitat): { label: string; value: number }[] {
    const info = blockadeInfo(galaxy, h);
    return info === null ? [] : [{ label: info.line, value: info.approval }];
}

registerStabilityTerm({ id: 'blockadesBite.approval', flag: BLOCKADES_BITE_FLAG, order: 80, cause: 'blockade', label: 'Blockade', run: (g, h) => blockadeApprovalTerm(g, h) });

registerScenarioQuery({
    id: 'blockadesBite.tax',
    flag: BLOCKADES_BITE_FLAG,
    order: 100,
    query: 'colonyTaxRevenue',
    run: (g, v, { habitat }) => {
        const rec = activeAt(g, habitat);
        if (rec === null) return v;
        const share = Math.min(1, Math.max(0, scenarioParam(g, 'blockadeTradeShare', 0.5)));
        rec.taxLostRate = Math.max(0, v * share); // bookkeeping for the stats (no Rnd)
        return v * (1 - share);
    },
});

registerScenarioQuery({
    id: 'blockadesBite.port',
    flag: BLOCKADES_BITE_FLAG,
    query: 'portTradeIncomeFactor',
    run: (g, v, { port, amount }) => {
        const h = port.parentHabitat;
        if (h === null || port.empire !== h.empire) return v;
        const rec = activeAt(g, h);
        if (rec === null) return v;
        const f = Math.min(1, Math.max(0, scenarioParam(g, 'blockadePortTradeFactor', 0)));
        biteState(g).stats.portTradeLost += amount * v * (1 - f);
        return v * f;
    },
});

registerScenarioQuery({
    id: 'blockadesBite.queue',
    flag: BLOCKADES_BITE_FLAG,
    query: 'constructionQueuePaused',
    run: (g, v, { habitat, builtObject }) => {
        if (v) return v;
        if (builtObject !== null && builtObject.empire !== habitat.empire) return v;
        return activeAt(g, habitat) !== null;
    },
});

registerScenarioQuery({
    id: 'blockadesBite.facilities',
    flag: BLOCKADES_BITE_FLAG,
    query: 'colonyFacilityConstructionPaused',
    run: (g, v, { habitat }) => v || activeAt(g, habitat) !== null,
});

registerScenarioQuery({
    id: 'blockadesBite.growth',
    flag: BLOCKADES_BITE_FLAG,
    order: 100,
    query: 'colonyMaxPopulation',
    run: (g, v, { habitat }) => {
        if (activeAt(g, habitat) === null) return v;
        const items = habitat.population.items;
        let n = 0;
        for (let i = 0; i < items.length; i++) n += items[i].amount;
        return Math.min(v, n);
    },
});

// ---------------------------------------------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------------------------------------------

function aiEmpire(galaxy: Galaxy, e: Empire | null): e is Empire {
    return normalEmpire(galaxy, e) && !isHumanEmpire(galaxy, e);
}

/** Daily: blockaded AI colonies get a relief fleet (most valuable × most winnable first). */
/** A relief candidate: idle or on a routine patrol (strikes and invasions keep going), no troops aboard. */
function reliefOk(f: ShipGroup): boolean {
    const t = f.mission === null ? BuiltObjectMissionType.Undefined : f.mission.type;
    return (t === BuiltObjectMissionType.Undefined || t === BuiltObjectMissionType.Patrol) && shipGroupTotalTroopAttackStrength(f) <= 0;
}

function reviewRelief(galaxy: Galaxy, st: BlockadesBiteState, used: Set<ShipGroup>): void {
    const minRatio = scenarioParam(galaxy, 'blockadeAiReliefMinRatio', 1);
    const range = scenarioParam(galaxy, 'blockadeAiRange', 4000000);
    const picks: { rec: BiteBlockade; h: Habitat; e: Empire; priority: number }[] = [];
    for (const rec of st.active) {
        const e = getEmpireById(galaxy, rec.owner);
        const h = galaxy.habitats[rec.h];
        if (!aiEmpire(galaxy, e) || h === undefined || h.empire !== e) continue;
        if (fleetAlive(e, rec.relief)) {
            used.add(rec.relief);
            continue;
        }
        rec.relief = null;
        const a = Math.max(1, rec.a);
        const fleet = nearestFleet(galaxy, e, h, minRatio * a, used, range, reliefOk);
        if (fleet === null) continue;
        picks.push({ rec, h, e, priority: Math.min(3, fleetFirepower(fleet) / a) * strategicValue(h) });
    }
    picks.sort((x, y) => y.priority - x.priority || x.rec.h - y.rec.h);
    for (const p of picks) {
        const fleet = nearestFleet(galaxy, p.e, p.h, minRatio * Math.max(1, p.rec.a), used, range, reliefOk);
        if (fleet === null) continue;
        used.add(fleet);
        // Normal priority: over routine patrols, but the stock war AI may still take the fleet for a strike / invasion.
        shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.Patrol, p.h, null, BuiltObjectMissionPriority.Normal, false);
        p.rec.relief = fleet;
        st.stats.reliefsSent++;
    }
}

function onCooldown(st: BlockadesBiteState, h: Habitat, e: Empire, now: number): boolean {
    for (const c of st.cooldowns) if (c.h === h.habitatIndex && c.e === e.empireId && c.until > now) return true;
    return false;
}

/** A colony's value as a blockade target: its tax revenue plus its space port's income this year. */
export function blockadeTargetValue(galaxy: Galaxy, h: Habitat): number {
    const port = determineSpacePortAtColony(galaxy, h);
    return Math.max(0, h.annualTaxRevenue) + (port !== null ? Math.max(0, port.currentYearsIncome) : 0);
}

function releaseDuty(galaxy: Galaxy, st: BlockadesBiteState, d: BiteDuty, now: number, cool: boolean): void {
    st.duties.splice(st.duties.indexOf(d), 1);
    const h = galaxy.habitats[d.h];
    const m = d.fleet.mission;
    if (m !== null && m.type === BuiltObjectMissionType.Blockade && m.targetHabitat === h) shipGroupCompleteMission(galaxy, d.fleet);
    if (cool) st.cooldowns.push({ h: d.h, e: d.e, until: now + scenarioParam(galaxy, 'blockadeAiHoldDays', 60) * GAME_DAY_LENGTH });
    st.stats.aiDutiesReleased++;
}

/** Every blockadeAiReviewDays: prune / release blockade duties, then send fleets to the richest enemy colonies. */
function reviewDuties(galaxy: Galaxy, st: BlockadesBiteState, now: number, used: Set<ShipGroup>): void {
    for (let i = st.cooldowns.length - 1; i >= 0; i--) if (st.cooldowns[i].until <= now) st.cooldowns.splice(i, 1);
    const holdMs = scenarioParam(galaxy, 'blockadeAiHoldDays', 60) * GAME_DAY_LENGTH;
    for (const d of st.duties.slice()) {
        const e = getEmpireById(galaxy, d.e);
        const h = galaxy.habitats[d.h];
        if (e === null || !fleetAlive(e, d.fleet) || h === undefined) {
            st.duties.splice(st.duties.indexOf(d), 1);
            continue;
        }
        const m = d.fleet.mission;
        if (m === null || m.type !== BuiltObjectMissionType.Blockade || m.targetHabitat !== h) {
            st.duties.splice(st.duties.indexOf(d), 1); // retasked elsewhere
            continue;
        }
        const owner = h.empire;
        if (!normalEmpire(galaxy, owner) || owner === e || !atWarNoAdd(e, owner)) releaseDuty(galaxy, st, d, now, false);
        else if (now - d.since >= holdMs) releaseDuty(galaxy, st, d, now, true);
        else used.add(d.fleet);
    }
    const maxFleets = Math.max(0, Math.round(scenarioParam(galaxy, 'blockadeAiMaxFleets', 2)));
    if (maxFleets === 0) return;
    const range = scenarioParam(galaxy, 'blockadeAiRange', 4000000);
    for (const e of galaxy.empires) {
        if (!aiEmpire(galaxy, e) || e.colonies.length === 0 || e.diplomaticRelations == null) continue;
        let count = 0;
        for (const d of st.duties) if (d.e === e.empireId) count++;
        if (count >= maxFleets) continue;
        const targets: { h: Habitat; v: number }[] = [];
        for (const r of e.diplomaticRelations) {
            const enemy = r.otherEmpire;
            if (r.type !== DiplomaticRelationType.War || !normalEmpire(galaxy, enemy)) continue;
            for (const h of enemy.colonies) {
                if (h.isBlockaded || !e.visibility.checkSystemExplored(h.systemIndex) || onCooldown(st, h, e, now)) continue;
                if (st.duties.some((d) => d.h === h.habitatIndex)) continue;
                const rec = findBlockade(st, h);
                if (rec !== null && rec.by === e.empireId) continue;
                targets.push({ h, v: blockadeTargetValue(galaxy, h) });
            }
        }
        targets.sort((x, y) => y.v - x.v || x.h.habitatIndex - y.h.habitatIndex);
        for (let i = 0; i < targets.length && i < 6 && count < maxFleets; i++) {
            const h = targets[i].h;
            // Idle attack fleets only (no mission): never one the stock war AI has given a strike or an invasion.
            const accept = (f: ShipGroup): boolean =>
                (f.mission === null || f.mission.type === BuiltObjectMissionType.Undefined) && f.posture === FleetPosture.Attack && f.attackPoint === null && shipGroupTotalTroopAttackStrength(f) <= 0 && canHoldOrbit(galaxy, e, f, h);
            const fleet = nearestFleet(galaxy, e, h, 1, used, range, accept);
            if (fleet === null) continue;
            if (!implementBlockadeColony(galaxy, e, h, false, false)) continue;
            // A stock Blockade mission at Low priority: the stock war AI may take the fleet for a strike or an invasion at
            // any time (the blockade never replaces or delays one); this review then drops the duty.
            shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.Blockade, h, null, BuiltObjectMissionPriority.Low, false);
            used.add(fleet);
            st.duties.push({ fleet, e: e.empireId, h: h.habitatIndex, since: now });
            st.stats.aiBlockadesOrdered++;
            count++;
        }
    }
}

export function blockadesBiteAiReview(galaxy: Galaxy, force = false): void {
    const st = biteState(galaxy);
    const now = galaxyStarDate(galaxy);
    const used = new Set<ShipGroup>();
    for (const d of st.duties) used.add(d.fleet);
    reviewRelief(galaxy, st, used);
    const every = Math.max(1, scenarioParam(galaxy, 'blockadeAiReviewDays', 5)) * GAME_DAY_LENGTH;
    if (force || now - st.lastAi >= every) {
        st.lastAi = now;
        used.clear();
        for (const rec of st.active) if (rec.relief !== null) used.add(rec.relief);
        reviewDuties(galaxy, st, now, used);
    }
}

/** The duty / relief fleets of the state (tests). */
export function biteFleetBusy(galaxy: Galaxy, fleet: ShipGroup): boolean {
    const st = biteState(galaxy);
    return st.duties.some((d) => d.fleet === fleet) || st.active.some((r) => r.relief === fleet);
}

registerScenarioPeriodic({
    id: 'blockadesBite.daily',
    flag: BLOCKADES_BITE_FLAG,
    periodDays: 1,
    run: (g) => {
        blockadesBiteDaily(g);
        blockadesBiteShoot(g);
        blockadesBiteAiReview(g);
    },
});
