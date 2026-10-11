// Scenario package 19a — the treasure fleet at risk: stragglers, raids and loot (flag rimTrader). Not a port: a layer
// over the stock combat and mission code (every order it gives is a ported AssignMission).
//
//   Straggling (deterministic, no Rnd): each time the convoy leaves a port, each treasure ship has a treasureStragglePct
//     (default 4) % chance — a hash of (voyage, leg, ship id) — to fall out of formation for treasureStraggleMinDays..
//     MaxDays: 'loading' (it stays at the port finishing its loading), 'engine' (an engine fault holds it where it is),
//     'refuel' (it detours to the nearest refuelling point). The escorts stay with the convoy's lead. A straggler more
//     than STRAGGLER_EXPOSED_RANGE from every escort is exposed. After treasureRecoveryDays the convoy holds and the
//     escorts turn back for it (a Move to the straggler) until it is within STRAGGLER_REJOIN_RANGE of an escort again.
//   Raids (the AI): every 5 days, for each target — an exposed straggler, or the main body (the lead treasure ship with
//     the escorts near it) — each pirate faction and each aggressive AI empire (race aggression ≥ RAIDER_AGGRESSION;
//     never a human empire, never the Concord) weighs it: the loot (the target's cargo at galaxy prices; the main body:
//     every treasure ship's) must beat the treasureRaidPenalty standing (twice it for an empire with trade access open),
//     and its strongest fleet that can reach the target on its fuel (BuiltObject.1.cs WithinFuelRangeAndRefuel; a
//     pirate's free warships near it count as one force) must have RAID_ADVANTAGE × the firepower defending it (the
//     Concord ships within DEFENCE_RANGE, the target included). The raid is an Attack mission on the target (ShipGroup
//     AssignMission / AssignMission; combat/attackAI.ts lets a ship attack its own mission target without a war).
//     A main-body raid therefore needs a fleet stronger than the fixed escort: in practice the late game only.
//   Loot: a treasure ship destroyed (builtObjectKilledBy) or captured (builtObjectOwnerChanged) gives its whole cargo
//     — rare goods and any rim goods aboard — to the attacker: on a kill it goes into the attacker's space port nearest
//     the wreck (else its capital, a pirate's base), on a capture it stays in the hold, now the captor's. The standing
//     penalty (treasureFleet.ts treasureShipDestroyed), the anger and the tit-for-tat strikes (passive.ts) still follow.
// Statistics: treasureStats2 (straggles, exposure, loot) and raidState (attempts / outcomes by game year and kind).

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import { BuiltObject } from '../../builtObject';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { Cargo, ResourceRef } from '../../cargo';
import type { ShipGroup } from '../../fleets/shipGroup';
import { shipGroupAssignMission } from '../../fleets/shipGroup';
import { assignMission } from '../../missions/assign';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../../missions/mission';
import { ultraFastFindNearestRefuellingLocation, withinFuelRangeAndRefuel } from '../../movement';
import { galaxyResourceCurrentPrices } from '../../design';
import { raceAggressionLevel } from '../../racePeriodic';
import { isHumanEmpire } from '../../humanEmpires';
import { YEAR_LENGTH } from '../../galaxyTime';
import { galaxyStarDate } from '../../tick/simTime';
import { GAME_DAY_LENGTH, registerScenarioEvent, registerScenarioPeriodic } from '../hooks';
import { scenarioState } from '../state';
import { cargoRemove } from '../../logistics/orders';
import { obtainDiplomaticRelation } from '../../diplomacy';
import { isRimTraderAI, rimTradeState, rimTraderEmpire } from './common';
import { treasureParam, treasureState, treasureStats2, type TreasureFleetState, type TreasureStraggler } from './treasureFleet';

/** A straggler this far from every escort is exposed (world units). */
export const STRAGGLER_EXPOSED_RANGE = 60000;
/** A straggler this close to an escort has rejoined. */
export const STRAGGLER_REJOIN_RANGE = 30000;
/** Concord ships this close to a raid target defend it. */
export const DEFENCE_RANGE = 150000;
/** A raid needs this much more firepower than the defence. */
export const RAID_ADVANTAGE = 1.5;
/** Race aggression (races.txt Aggression; Race.cs AggressionLevel) from which an AI empire raids. */
export const RAIDER_AGGRESSION = 110;
/** Raiders consider targets within this many sectors of their force. */
export const RAID_REACH_SECTORS = 8;
/** A raid that has not sunk its target after this many days is over. */
export const RAID_TIMEOUT_DAYS = 90;

export type RaidKind = 'main' | 'straggler';

export interface TreasureRaid {
    raiderId: number;
    kind: RaidKind;
    target: BuiltObject;
    fleet: ShipGroup | null;
    ships: BuiltObject[];
    start: number;
    year: number;
    loot: number;
    force: number;
    defence: number;
}

export interface RaidLogEntry {
    year: number;
    kind: RaidKind;
    raider: string;
    pirate: boolean;
    outcome: 'success' | 'failed' | 'aborted';
    loot: number;
    force: number;
    defence: number;
}

/** Saved state (`scenarioState(galaxy, 'rimRaids')`, created on the first raid): plain data and graph references. */
export interface RimRaidState {
    active: TreasureRaid[];
    log: RaidLogEntry[];
    /** Treasure ships sunk / captured, by game year and kind ('main': near the escorts; 'straggler'). */
    losses: { year: number; kind: RaidKind; by: string; loot: number; captured: boolean }[];
}

export function raidState(galaxy: Galaxy): RimRaidState {
    return scenarioState<RimRaidState>(galaxy, 'rimRaids', () => ({ active: [], log: [], losses: [] }));
}

function hasRaidState(galaxy: Galaxy): boolean {
    return galaxy.scenario !== null && 'rimRaids' in galaxy.scenario.state;
}

/** The game year (1 = the first) of star date `now`, counted from the treasure fleet's start. */
export function treasureYear(st: TreasureFleetState, now: number): number {
    return Math.floor((now - st.startStarDate) / YEAR_LENGTH) + 1;
}

function mix32(x: number): number {
    let h = x | 0;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    return (h ^ (h >>> 16)) >>> 0;
}

/** The deterministic straggle roll of `ship` on (voyage, leg): null = keeps formation. Pure. */
export function straggleRoll(galaxy: Galaxy, voyage: number, leg: number, ship: BuiltObject): { cause: TreasureStraggler['cause']; days: number } | null {
    const pct = treasureParam(galaxy, 'treasureStragglePct');
    if (!(pct > 0)) return null;
    const h = mix32(mix32(voyage * 7919 + leg) ^ (ship.builtObjectID * 104729));
    if (h % 10000 >= pct * 100) return null;
    const lo = Math.max(1, treasureParam(galaxy, 'treasureStraggleMinDays'));
    const hi = Math.max(lo, treasureParam(galaxy, 'treasureStraggleMaxDays'));
    const h2 = mix32(h);
    const cause = (['loading', 'engine', 'refuel'] as const)[h2 % 3];
    return { cause, days: lo + ((h2 >>> 8) % (Math.trunc(hi - lo) + 1)) };
}

function escortsOf(st: TreasureFleetState): BuiltObject[] {
    return st.ships.filter((b) => !b.hasBeenDestroyed && !st.treasure.includes(b));
}

function nearestEscortDistance(galaxy: Galaxy, st: TreasureFleetState, b: BuiltObject): number {
    let best = Number.MAX_VALUE;
    for (const e of escortsOf(st)) best = Math.min(best, galaxy.calculateDistance(b.xpos, b.ypos, e.xpos, e.ypos));
    return best;
}

/** treasureFleet.ts, as the convoy leaves a port (or home): the treasure ships that fall out this leg. No Rnd. */
export function treasureStraggleAtDeparture(galaxy: Galaxy, r: Empire, st: TreasureFleetState): void {
    const now = galaxyStarDate(galaxy);
    const list = (st.stragglers ??= []);
    const lead = st.treasure.find((b) => !b.hasBeenDestroyed) ?? null;
    for (const b of st.treasure) {
        if (b.hasBeenDestroyed || b === lead || list.some((x) => x.ship === b)) continue;
        const roll = straggleRoll(galaxy, st.stats.voyages, st.leg, b);
        if (roll === null) continue;
        list.push({ ship: b, cause: roll.cause, since: now, until: now + roll.days * GAME_DAY_LENGTH, recovering: false, exposedSince: -1 });
        treasureStats2(st).straggles++;
        // 'loading' / 'engine': held where it is (the convoy's next Move skips it, straggleHeld); 'refuel': a detour.
        if (roll.cause === 'refuel' && b.fuelType !== null) {
            const s = ultraFastFindNearestRefuellingLocation(galaxy, r, b.xpos, b.ypos, [{ resourceId: b.fuelType.resourceId, sortTag: b.fuelCapacity - b.currentFuel }], b, false, true);
            if (s !== null) assignMission(galaxy, b, BuiltObjectMissionType.Refuel, s as BuiltObject | Habitat, null, BuiltObjectMissionPriority.High);
        }
    }
}

/** A straggler still holding (its convoy's sailTo leaves it alone). Pure. */
export function straggleHeld(galaxy: Galaxy, st: TreasureFleetState, b: BuiltObject): boolean {
    const now = galaxyStarDate(galaxy);
    return (st.stragglers ?? []).some((x) => x.ship === b && now < x.until);
}

/** The convoy holds while its escorts recover a straggler. Pure. */
export function convoyRecovering(st: TreasureFleetState): boolean {
    return (st.stragglers ?? []).some((x) => x.recovering && !x.ship.hasBeenDestroyed);
}

/** Every 2 days: exposure, recovery (after treasureRecoveryDays) and rejoining. Draws what AssignMission draws. */
export function treasureStraggleTick(galaxy: Galaxy): void {
    const r = rimTraderEmpire(galaxy);
    if (r === null || !isRimTraderAI(galaxy, r) || galaxy.scenario === null || !('rimTreasure' in galaxy.scenario.state)) return;
    const st = treasureState(galaxy);
    const list = st.stragglers;
    if (list === undefined || list.length === 0) return;
    const now = galaxyStarDate(galaxy);
    const s2 = treasureStats2(st);
    const recoverAfter = treasureParam(galaxy, 'treasureRecoveryDays') * GAME_DAY_LENGTH;
    const keep: TreasureStraggler[] = [];
    for (const x of list) {
        const b = x.ship;
        if (b.hasBeenDestroyed || b.actualEmpire !== r || !st.sailing) {
            s2.straggleDays += (now - x.since) / GAME_DAY_LENGTH;
            if (x.exposedSince >= 0) s2.exposedDays += (now - x.exposedSince) / GAME_DAY_LENGTH;
            continue;
        }
        const d = nearestEscortDistance(galaxy, st, b);
        if (now >= x.until && d <= STRAGGLER_REJOIN_RANGE) {
            s2.straggleDays += (now - x.since) / GAME_DAY_LENGTH;
            if (x.exposedSince >= 0) s2.exposedDays += (now - x.exposedSince) / GAME_DAY_LENGTH;
            continue; // rejoined
        }
        if (d > STRAGGLER_EXPOSED_RANGE) {
            if (x.exposedSince < 0) x.exposedSince = now;
        } else if (x.exposedSince >= 0) {
            s2.exposedDays += (now - x.exposedSince) / GAME_DAY_LENGTH;
            x.exposedSince = -1;
        }
        if (!x.recovering && now - x.since >= recoverAfter && d > STRAGGLER_REJOIN_RANGE) x.recovering = true;
        if (x.recovering) {
            // The straggler (its hold over) heads for the nearest escort; the escorts come back for it.
            if (now >= x.until) {
                let near: BuiltObject | null = null;
                for (const e of escortsOf(st)) if (near === null || galaxy.calculateDistance(b.xpos, b.ypos, e.xpos, e.ypos) < galaxy.calculateDistance(b.xpos, b.ypos, near.xpos, near.ypos)) near = e;
                const bm = builtObjectMission(b.mission);
                if (near !== null && !(bm !== null && bm.type === BuiltObjectMissionType.Move && bm.targetBuiltObject === near)) assignMission(galaxy, b, BuiltObjectMissionType.Move, near, null, BuiltObjectMissionPriority.High);
            }
            for (const e of escortsOf(st)) {
                const m = builtObjectMission(e.mission);
                if (m !== null && m.type === BuiltObjectMissionType.Move && m.targetBuiltObject === b) continue;
                assignMission(galaxy, e, BuiltObjectMissionType.Move, b, null, BuiltObjectMissionPriority.High);
            }
        }
        keep.push(x);
    }
    st.stragglers = keep;
}

/** The loot value of `ships`' cargo at galaxy prices. Pure. */
export function cargoValue(galaxy: Galaxy, ships: BuiltObject[]): number {
    const prices = galaxyResourceCurrentPrices(galaxy);
    let v = 0;
    for (const b of ships) {
        if (b.cargo === null) continue;
        for (const c of b.cargo.items) if (c.commodity.resourceId >= 0 && c.amount > 0) v += c.amount * (prices[c.commodity.resourceId] ?? 0);
    }
    return v;
}

function firepowerNear(galaxy: Galaxy, r: Empire, x: number, y: number, range: number): number {
    let fp = 0;
    for (const b of r.builtObjects) {
        if (b === null || b.hasBeenDestroyed) continue;
        if (galaxy.calculateDistance(b.xpos, b.ypos, x, y) <= range) fp += b.firepowerRaw;
    }
    return fp;
}

function busy(b: BuiltObject): boolean {
    const m = builtObjectMission(b.mission);
    return m !== null && (m.type === BuiltObjectMissionType.Attack || m.type === BuiltObjectMissionType.Bombard || m.type === BuiltObjectMissionType.UnloadTroops || m.type === BuiltObjectMissionType.Refuel || m.type === BuiltObjectMissionType.Repair);
}

interface RaidForce {
    fleet: ShipGroup | null;
    ships: BuiltObject[];
    fp: number;
    d: number;
}

/** The raider's strongest force that can reach `target` (fleets; a pirate's free warships near it as one force). Pure. */
function raidForce(galaxy: Galaxy, e: Empire, target: BuiltObject, pirate: boolean): RaidForce | null {
    const reach = RAID_REACH_SECTORS * galaxy.sectorSize;
    let best: RaidForce | null = null;
    const better = (f: RaidForce): boolean => best === null || f.fp > best.fp || (f.fp === best.fp && f.d < best.d);
    for (const sg of (e.shipGroups ?? []) as ShipGroup[]) {
        if (sg === null || sg.ships.length === 0) continue;
        const lead = sg.leadShip ?? sg.ships[0];
        if (lead === null || lead.hasBeenDestroyed || busy(lead)) continue;
        const d = galaxy.calculateDistance(lead.xpos, lead.ypos, target.xpos, target.ypos);
        if (d > reach || !withinFuelRangeAndRefuel(galaxy, lead, target.xpos, target.ypos, 0)) continue;
        const ships = sg.ships.filter((b) => !b.hasBeenDestroyed);
        const f = { fleet: sg, ships, fp: ships.reduce((n, b) => n + b.firepowerRaw, 0), d };
        if (better(f)) best = f;
    }
    if (pirate) {
        const free = e.builtObjects
            .filter((b) => b !== null && !b.hasBeenDestroyed && b.role === BuiltObjectRole.Military && b.shipGroup === null && b.isAutoControlled && b.firepowerRaw > 0 && b.warpSpeed > 0 && !busy(b))
            .map((b) => ({ b, d: galaxy.calculateDistance(b.xpos, b.ypos, target.xpos, target.ypos) }))
            .filter((x) => x.d <= reach && withinFuelRangeAndRefuel(galaxy, x.b, target.xpos, target.ypos, 0))
            .sort((a, b) => a.d - b.d || a.b.builtObjectID - b.b.builtObjectID)
            .slice(0, 8);
        if (free.length > 0) {
            const f = { fleet: null, ships: free.map((x) => x.b), fp: free.reduce((n, x) => n + x.b.firepowerRaw, 0), d: free[0].d };
            if (better(f)) best = f;
        }
    }
    return best;
}

function isRaider(galaxy: Galaxy, e: Empire | null, r: Empire): e is Empire {
    if (e === null || !e.active || e === r || e === galaxy.independentEmpire || isHumanEmpire(galaxy, e)) return false;
    if (e.pirateEmpireBaseHabitat !== null) return true;
    const race = e.dominantRace;
    return race !== null && raceAggressionLevel(galaxy, race) >= RAIDER_AGGRESSION;
}

function endRaid(galaxy: Galaxy, rs: RimRaidState, raid: TreasureRaid, outcome: RaidLogEntry['outcome']): void {
    const i = rs.active.indexOf(raid);
    if (i >= 0) rs.active.splice(i, 1);
    const e = galaxy.empires.find((x) => x !== null && x.empireId === raid.raiderId) ?? galaxy.pirateEmpires.find((x) => x !== null && x.empireId === raid.raiderId) ?? null;
    if (rs.log.length < 2000) rs.log.push({ year: raid.year, kind: raid.kind, raider: e?.name ?? String(raid.raiderId), pirate: e?.pirateEmpireBaseHabitat != null, outcome, loot: Math.round(raid.loot), force: Math.round(raid.force), defence: Math.round(raid.defence) });
    if (outcome === 'success') return;
    // Called off: the force goes back (its fleet to its gather point; a pirate's free ships to their base).
    if (raid.fleet !== null && raid.fleet.gatherPoint !== null) {
        shipGroupAssignMission(galaxy, raid.fleet, BuiltObjectMissionType.Move, raid.fleet.gatherPoint as BuiltObject | Habitat, null, BuiltObjectMissionPriority.Normal, false);
    } else if (raid.fleet === null && e !== null) {
        const home = e.pirateEmpireBaseHabitat ?? e.capital;
        if (home !== null) for (const b of raid.ships) if (!b.hasBeenDestroyed && b.actualEmpire === e) assignMission(galaxy, b, BuiltObjectMissionType.Move, home, null, BuiltObjectMissionPriority.Normal);
    }
}

/** Every 5 days: raid outcomes, then new raids (one per target). Draws what the mission assignment draws. */
export function treasureRaidReview(galaxy: Galaxy): void {
    const r = rimTraderEmpire(galaxy);
    if (r === null || !isRimTraderAI(galaxy, r) || galaxy.scenario === null || !('rimTreasure' in galaxy.scenario.state)) return;
    const st = treasureState(galaxy);
    const now = galaxyStarDate(galaxy);
    if (hasRaidState(galaxy)) {
        const rs = raidState(galaxy);
        for (const raid of [...rs.active]) {
            const alive = raid.ships.some((b) => !b.hasBeenDestroyed);
            if (raid.target.hasBeenDestroyed || raid.target.actualEmpire !== r) endRaid(galaxy, rs, raid, 'failed'); // sunk by another (a success is logged at the kill)
            else if (!alive || now - raid.start > RAID_TIMEOUT_DAYS * GAME_DAY_LENGTH) endRaid(galaxy, rs, raid, 'failed');
            else if (raid.kind === 'straggler' && !(st.stragglers ?? []).some((x) => x.ship === raid.target && x.exposedSince >= 0)) endRaid(galaxy, rs, raid, 'aborted');
        }
    }
    if (!st.sailing) return;
    const lead = st.treasure.find((b) => !b.hasBeenDestroyed && !(st.stragglers ?? []).some((x) => x.ship === b)) ?? null;
    const targets: { target: BuiltObject; kind: RaidKind; loot: number }[] = [];
    for (const x of st.stragglers ?? []) if (x.exposedSince >= 0 && !x.ship.hasBeenDestroyed) targets.push({ target: x.ship, kind: 'straggler', loot: cargoValue(galaxy, [x.ship]) });
    if (lead !== null) targets.push({ target: lead, kind: 'main', loot: cargoValue(galaxy, st.treasure.filter((b) => !b.hasBeenDestroyed && !(st.stragglers ?? []).some((x) => x.ship === b))) });
    const penalty = treasureParam(galaxy, 'treasureRaidPenalty');
    const raiders = [...galaxy.empires, ...galaxy.pirateEmpires].filter((e): e is Empire => isRaider(galaxy, e, r));
    for (const t of targets) {
        const active = hasRaidState(galaxy) ? raidState(galaxy).active : [];
        if (active.some((x) => x.target === t.target)) continue;
        const defence = firepowerNear(galaxy, r, t.target.xpos, t.target.ypos, DEFENCE_RANGE);
        let pick: { e: Empire; f: RaidForce } | null = null;
        for (const e of raiders) {
            if (active.some((x) => x.raiderId === e.empireId)) continue;
            const pirate = e.pirateEmpireBaseHabitat !== null;
            const open = !pirate && obtainDiplomaticRelation(r, e).supplyRestrictedResources;
            if (!(t.loot > penalty * (open ? 2 : 1))) continue;
            const f = raidForce(galaxy, e, t.target, pirate);
            if (f === null || f.fp < RAID_ADVANTAGE * Math.max(1, defence)) continue;
            if (pick === null || f.fp > pick.f.fp || (f.fp === pick.f.fp && e.empireId < pick.e.empireId)) pick = { e, f };
        }
        if (pick === null) continue;
        const raid: TreasureRaid = { raiderId: pick.e.empireId, kind: t.kind, target: t.target, fleet: pick.f.fleet, ships: pick.f.ships, start: now, year: treasureYear(st, now), loot: t.loot, force: pick.f.fp, defence };
        raidState(galaxy).active.push(raid);
        if (pick.f.fleet !== null) shipGroupAssignMission(galaxy, pick.f.fleet, BuiltObjectMissionType.Attack, t.target, null, BuiltObjectMissionPriority.High, true);
        else for (const b of pick.f.ships) assignMission(galaxy, b, BuiltObjectMissionType.Attack, t.target, null, BuiltObjectMissionPriority.High);
    }
}

/** The attacker's store for loot: its space port nearest (x, y), else its capital, else a pirate's base. Pure. */
function lootStore(galaxy: Galaxy, e: Empire, x: number, y: number): BuiltObject | Habitat | null {
    let best: BuiltObject | null = null;
    let bd = Number.MAX_VALUE;
    for (const p of e.spacePorts ?? []) {
        if (p === null || p.hasBeenDestroyed || p.cargo === null) continue;
        const d = galaxy.calculateDistance(p.xpos, p.ypos, x, y);
        if (d < bd) {
            bd = d;
            best = p;
        }
    }
    if (best !== null) return best;
    const h = e.capital ?? e.pirateEmpireBaseHabitat;
    return h !== null && h.cargo !== null ? h : null;
}

function logLoss(galaxy: Galaxy, st: TreasureFleetState, ship: BuiltObject, by: Empire, loot: number, captured: boolean): void {
    const now = galaxyStarDate(galaxy);
    const straggler = (st.stragglers ?? []).some((x) => x.ship === ship);
    const rs = raidState(galaxy);
    rs.losses.push({ year: treasureYear(st, now), kind: straggler ? 'straggler' : 'main', by: by.name, loot: Math.round(loot), captured });
    const raid = rs.active.find((x) => x.target === ship && x.raiderId === by.empireId) ?? rs.active.find((x) => x.raiderId === by.empireId);
    if (raid !== undefined) endRaid(galaxy, rs, raid, 'success');
    const s2 = treasureStats2(st);
    s2.lootValue += loot;
    s2.lootEvents++;
}

/** builtObjectKilledBy: a sunk treasure ship's whole cargo goes to the attacker's nearest store. No Rnd. */
export function treasureShipLooted(galaxy: Galaxy, ev: { builtObject: BuiltObject; destroyer: Empire | null }): void {
    if (galaxy.scenario === null || !('rimTreasure' in galaxy.scenario.state)) return;
    const st = treasureState(galaxy);
    const b = ev.builtObject;
    const r = rimTraderEmpire(galaxy);
    if (!st.treasure.includes(b) || ev.destroyer === null || ev.destroyer === r) return;
    const store = lootStore(galaxy, ev.destroyer, b.xpos, b.ypos);
    const loot = cargoValue(galaxy, [b]);
    if (b.cargo !== null) {
        for (const c of [...b.cargo.items]) {
            if (c.commodity.resourceId < 0 || !(c.amount > 0)) continue;
            if (store !== null && store.cargo !== null) store.cargo.add(new Cargo(new ResourceRef(c.commodity.resourceId), c.amount, ev.destroyer));
            cargoRemove(b.cargo, c);
        }
    }
    logLoss(galaxy, st, b, ev.destroyer, loot, false);
}

/** builtObjectOwnerChanged: a captured treasure ship's cargo becomes the captor's; the standing penalty applies. No Rnd. */
export function treasureShipCaptured(galaxy: Galaxy, ev: { builtObject: BuiltObject; from: Empire | null; to: Empire | null }): void {
    if (galaxy.scenario === null || !('rimTreasure' in galaxy.scenario.state)) return;
    const st = treasureState(galaxy);
    const b = ev.builtObject;
    const r = rimTraderEmpire(galaxy);
    if (!st.treasure.includes(b) || ev.to === null || ev.from !== r || ev.to === r) return;
    const loot = cargoValue(galaxy, [b]);
    if (b.cargo !== null) {
        for (const c of [...b.cargo.items]) {
            if (c.commodity.resourceId < 0 || c.empire === ev.to) continue;
            const amount = c.amount;
            cargoRemove(b.cargo, c);
            if (amount > 0) b.cargo.add(new Cargo(new ResourceRef(c.commodity.resourceId), amount, ev.to));
        }
    }
    const row = (rimTradeState(galaxy).ledger[ev.to.empireId] ??= { credit: 0, debit: 0 });
    row.debit += treasureParam(galaxy, 'treasureRaidPenalty');
    st.stats.lost++;
    logLoss(galaxy, st, b, ev.to, loot, true);
}

void BuiltObject;

registerScenarioPeriodic({ id: 'rimTrade.treasure.straggle', flag: 'rimTrader', periodDays: 2, run: (g) => treasureStraggleTick(g) });
registerScenarioPeriodic({ id: 'rimTrade.treasure.raids', flag: 'rimTrader', periodDays: 5, run: (g) => treasureRaidReview(g) });
registerScenarioEvent({ id: 'rimTrade.treasure.loot', flag: 'rimTrader', event: 'builtObjectKilledBy', run: treasureShipLooted });
registerScenarioEvent({ id: 'rimTrade.treasure.captured', flag: 'rimTrader', event: 'builtObjectOwnerChanged', run: treasureShipCaptured });
