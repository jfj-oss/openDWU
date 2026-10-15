// Fighting retreats (scenarios/fighting-retreats, flag fightingRetreats): an opt-in gameplay change. Not a port.
//
// What the original already has (and stays exactly as it is): the per-ship "Flee when" setting (Design.FleeWhen; warships
// take the empire policy's DefaultMilitaryFleeWhen, Shields20) read by BuiltObject.1.cs 1520 ShouldFleeFrom (a short
// Escape hop away from the attackers, then back), AutoRefuelRepairShip for damaged ships outside fleets, ShipGroup.cs
// 1670 CheckRefuelRepairAttack (AI fleets drop damaged ships for repair when a fleet mission completes) and the player's
// fleet "Repair and refuel" order (Main.Part3.cs btnShipGroupRepairAndRefuel_Click). It has no withdrawal of a fleet
// that is losing its battle; that is all this add-on adds.
//
// With the flag on (checked every frCheckSeconds of game time, tick/scheduler.ts → fightingRetreatsFrame), for every
// fleet of every empire and pirate faction (human and AI alike):
//   - firepower = Σ (CalculateFirepowerFactor + CalculateFighterFactor, BuiltObject.1.cs 2276/2293) of the fleet's ships
//     in its lead ship's system that are not repairing, against the enemies it is fighting there (its ships' attackers
//     and targets, plus the rest of their fleets in that system; a creature counts AttackStrength × 5 as in
//     Empire.8.cs CalculateDefendingStrength); our empire's other ships and bases in the system that are attacking the
//     same enemies count on our side (reinforcements: a fleet does not pull out of a fight it wins together);
//   - it is outgunned when the enemies have frOutgunned times its side's firepower or more (default 1.5); outgunned for
//     frHoldSeconds = it withdraws; the count-down only resets once its side is back above frHysteresis % of that line
//     (default 125: the enemy at 1.2x or less), so a brief swing does not restart it;
//   - the fleet's side also counts the ships and bases of any empire NOT at war with it (allies, a coalition) in the system that are
//     attacking the same enemies: in a multi-empire hunt no empire retreats as if it fought alone;
//   - a fleet with more than frDamagedPct % (30) of its battle ships holding component damage makes the repair trip below; a fleet that
//     is merely outgunned FALLS BACK instead (Move, Unavailable): to its home base (ShipGroup.gatherPoint) if set and outside the battle
//     system, else the nearest system with a colony or base of its empire outside it, else the yard as below. Its damaged ships still go
//     repair on their own. After the fall-back the fleet is free again as below ("... to fall back to Y");
//   - the repair trip is the stock fleet "Repair and refuel" order (fleetOps.ts fleetRepairAndRefuel) to the nearest yard
//     that can repair (findNearestShipYard incl. very small yards): fleet mission Repair (Unavailable, the AI leaves it
//     alone), damaged ships Repair, the others Refuel there (VeryHigh; ships on Repair never pick targets, attackAI.ts
//     shouldAttack). Not when the fleet is already within AT_YARD_RANGE of it (it fights on beside the yard), nor when
//     half or more of its ships' designs say "Flee: never" (the original's setting);
//   - the owner is told "3rd Fleet withdrew from Sol to repair at Earth Port"; when the fleet mission ends an automated
//     fleet is free for the AI again (its duties resume) and a manual one waits for orders ("… finished repairs at …").
//     A player Intercept order or Watch waits the repairs out and goes on (player/intercept.ts).
// Rnd: none of its own (the missions it assigns draw what the stock orders draw). With the flag off nothing here runs
// (scheduler.ts checks galaxy.scenario first). State: the fleet fields below, absent unless in use, and the counters bag
// scenario.state.fightingRetreats (only in games with the add-on).

import type { Galaxy } from '../../galaxy';
import type { BuiltObject } from '../../builtObject';
import type { Habitat } from '../../types';
import type { Empire } from '../../empire';
import { type ShipGroup, empireShipGroups, forceCompleteMission, shipGroupAssignMission } from '../../fleets/shipGroup';
import { BuiltObjectFleeWhen } from '../../data/designSpecifications';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission, isBuiltObject, isCreature, type StellarObject } from '../../missions/mission';
import { assignMission, clearPreviousMissionRequirements } from '../../missions/assign';
import { calculateFighterFactor, calculateFirepowerFactor, escapeTargetForFleeFrom, stellarAttackers } from '../../combat/threats';
import { findNearestShipYard } from '../../construction/empireConstruction';
import { isHumanEmpire } from '../../humanEmpires';
import { DiplomaticRelationType } from '../../diplomacy';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { EmpireMessageType } from '../../messages';
import { scenarioFlag, scenarioParam, scenarioState } from '../state';
import { scenarioMessage } from '../messages';

export const FIGHTING_RETREATS_FLAG = 'fightingRetreats';
export const FIGHTING_RETREATS_ADDON_ID = 'fighting-retreats';
const KEY = 'fightingRetreats';
/** A fleet this close to its repair point does not withdraw (it is already there). */
export const AT_YARD_RANGE = 3000;

/** Defaults (scenario.json params; percentages there). */
export const FR_DEFAULTS = { checkSeconds: 1, outgunned: 1.5, holdSeconds: 5, hysteresis: 125, damagedPct: 30 } as const;

export interface FleetWithdrawal {
    /** The system the fleet withdrew from ('' = deep space). */
    from: string;
    /** The repair point. */
    yard: StellarObject;
    /** The fleet mission the withdrawal gave it (its end = the repairs are done, or a new order). */
    mission: unknown;
    sinceMs: number;
    /** True: a tactical fall-back to a friendly system (not a repair trip). Absent in older saves = a repair trip. */
    fallback?: boolean;
}

declare module '../../fleets/shipGroup' {
    interface ShipGroup {
        /** Fighting retreats: galaxy.nowMs since when the fleet is losing its battle; absent = not losing. */
        frLosingSinceMs?: number;
        /** Fighting retreats: the withdrawal under way; absent = none. */
        frWithdrawal?: FleetWithdrawal;
        /** Fighting retreats (older saves only, no longer used): the fleet's firepower when its battle began. */
        frStartFirepower?: number;
    }
}

/** Counters (soaks, tests): saved in scenario.state, only in games with the add-on. */
export interface FightingRetreatsState {
    nextMs: number;
    fleetWithdrawals: number;
    fleetsResumed: number;
}

export function fightingRetreatsState(galaxy: Galaxy): FightingRetreatsState {
    return scenarioState<FightingRetreatsState>(galaxy, KEY, () => ({ nextMs: 0, fleetWithdrawals: 0, fleetsResumed: 0 }));
}

export function fightingRetreatsOn(galaxy: Galaxy): boolean {
    return scenarioFlag(galaxy, FIGHTING_RETREATS_FLAG);
}

function param(galaxy: Galaxy, name: keyof typeof FR_DEFAULTS): number {
    return scenarioParam(galaxy, 'fr' + name[0].toUpperCase() + name.slice(1), FR_DEFAULTS[name]);
}

function dist(a: { xpos: number; ypos: number }, b: { xpos: number; ypos: number }): number {
    const dx = a.xpos - b.xpos;
    const dy = a.ypos - b.ypos;
    return Math.sqrt(dx * dx + dy * dy);
}

function repairing(b: BuiltObject): boolean {
    const m = builtObjectMission(b.mission);
    const t = m === null ? BuiltObjectMissionType.Undefined : m.type;
    return t === BuiltObjectMissionType.Repair || t === BuiltObjectMissionType.Retire || t === BuiltObjectMissionType.Retrofit || b.builtAt !== null;
}

function nameOf(o: unknown): string {
    const n = (o as { name?: string | null } | null)?.name;
    return typeof n === 'string' && n !== '' ? n : 'a repair point';
}

/** A ship's firepower (weapons + fighters; BuiltObject.1.cs 2293 CalculateFirepowerFactor + 2276 CalculateFighterFactor). */
export function shipFirepower(b: BuiltObject): number {
    return calculateFirepowerFactor(b) + calculateFighterFactor(b);
}

/** True when half or more of the fleet's ships have the original's "Flee: never" design setting. */
export function fleetNeverFlees(fleet: ShipGroup): boolean {
    let never = 0;
    for (const b of fleet.ships) if (b.design !== null && b.design.fleeWhen === BuiltObjectFleeWhen.Never) never++;
    return fleet.ships.length > 0 && never * 2 >= fleet.ships.length;
}

export interface BattleSides {
    /** Our side: the fleet plus reinforcements. */
    own: number;
    /** The fleet's own share of `own`. */
    fleet: number;
    enemy: number;
    /** Our ships under attack. */
    engaged: number;
    /** The fleet's ships counted in the battle (in the system, not repairing), and how many of them have a damaged component. */
    counted: number;
    damaged: number;
}

/** True when `other` fights on our side: our own empire, or one we are not at war with (pirates and the independents are at war with us unless the relation says otherwise). */
function friendly(us: Empire | null, other: Empire | null): boolean {
    if (us === null || other === null) return false;
    if (us === other) return true;
    return us.diplomaticRelations.byEmpire(other)?.type !== DiplomaticRelationType.War && other.diplomaticRelations.byEmpire(us)?.type !== DiplomaticRelationType.War;
}

/** The fleet's battle: its firepower in the lead's system vs the firepower of the enemies its ships are fighting there. */
export function fleetBattle(fleet: ShipGroup): BattleSides {
    const sys = fleet.leadShip!.nearestSystemStar;
    const enemies = new Set<StellarObject>();
    const enemyFleets = new Set<ShipGroup>();
    let own = 0;
    let fleetOwn = 0;
    let engaged = 0;
    let counted = 0;
    let damaged = 0;
    const addEnemy = (o: StellarObject | null): void => {
        if (o === null || o.hasBeenDestroyed || enemies.has(o)) return;
        if (isBuiltObject(o)) {
            if (o.empire === fleet.empire) return;
            enemies.add(o);
            const eg = o.shipGroup as ShipGroup | null;
            if (eg !== null && !enemyFleets.has(eg)) {
                enemyFleets.add(eg);
                for (const s of eg.ships) if (!s.hasBeenDestroyed && s.nearestSystemStar === sys && !repairing(s)) enemies.add(s);
            }
        } else if (isCreature(o)) {
            enemies.add(o);
        }
    };
    for (const b of fleet.ships) {
        if (b.hasBeenDestroyed || b.nearestSystemStar !== sys || repairing(b)) continue;
        own += shipFirepower(b);
        fleetOwn += shipFirepower(b);
        counted++;
        if (b.damagedComponentCount > 0) damaged++;
        const att = stellarAttackers(b);
        if (att.length === 0) continue;
        engaged++;
        for (const a of att) addEnemy(escapeTargetForFleeFrom(a));
        const t = b.currentTarget as StellarObject | null;
        if (t !== null) addEnemy(escapeTargetForFleeFrom(t));
    }
    let enemy = 0;
    const friends = new Set<BuiltObject>();
    for (const e of enemies) {
        if (isBuiltObject(e)) enemy += shipFirepower(e);
        else if (isCreature(e)) enemy += e.attackStrength * 5;
        // Reinforcements: the ships and bases in the system fighting the same enemies of any empire not at war with ours (our own, allies, a
        // coalition) count on our side.
        for (const a of stellarAttackers(e)) {
            const f = escapeTargetForFleeFrom(a);
            if (!isBuiltObject(f) || !friendly(fleet.empire, f.empire) || f.shipGroup === fleet || f.hasBeenDestroyed || friends.has(f) || f.nearestSystemStar !== sys || repairing(f)) continue;
            friends.add(f);
            own += shipFirepower(f);
        }
    }
    return { own, fleet: fleetOwn, enemy, engaged, counted, damaged };
}

/** The repair point a withdrawing fleet heads for (the stock nearest yard that can repair), or null. */
export function fleetRepairPoint(galaxy: Galaxy, fleet: ShipGroup): StellarObject | null {
    const lead = fleet.leadShip;
    if (lead === null || fleet.empire === null) return null;
    return findNearestShipYard(galaxy, fleet.empire, lead, true, true) as StellarObject | null;
}

/** Withdraws the fleet to `yard`: the stock "Repair and refuel" order (fleetOps.ts fleetRepairAndRefuel), not a player order. */
export function withdrawFleet(galaxy: Galaxy, fleet: ShipGroup, yard: StellarObject): void {
    const lead = fleet.leadShip!;
    const empire = fleet.empire!;
    const from = (lead.nearestSystemStar as Habitat | null)?.name ?? '';
    forceCompleteMission(galaxy, fleet);
    shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.Repair, yard, null, BuiltObjectMissionPriority.Unavailable, true);
    for (const ship of [...fleet.ships]) {
        if (ship.damagedComponentCount > 0) {
            if ((ship.topSpeed > 0 && dist(ship, yard) < 2000.0) || (ship.warpSpeed > 0 && ship.topSpeed > 0)) {
                clearPreviousMissionRequirements(galaxy, ship, true);
                assignMission(galaxy, ship, BuiltObjectMissionType.Repair, yard, null, BuiltObjectMissionPriority.VeryHigh);
            }
        } else if (ship.topSpeed > 0 && ship.warpSpeed > 0) {
            clearPreviousMissionRequirements(galaxy, ship, true);
            assignMission(galaxy, ship, BuiltObjectMissionType.Refuel, yard, null, BuiltObjectMissionPriority.VeryHigh);
        }
    }
    fleet.frWithdrawal = { from, yard, mission: fleet.mission, sinceMs: galaxy.nowMs };
    delete fleet.frLosingSinceMs;
    delete fleet.frStartFirepower;
    fightingRetreatsState(galaxy).fleetWithdrawals++;
    if (isHumanEmpire(galaxy, empire)) {
        const where = from !== '' ? `from ${from}` : 'from battle';
        scenarioMessage(galaxy, empire, 'Fleet withdrew', `${fleet.name ?? 'A fleet'} withdrew ${where} to repair at ${nameOf(yard)}`, { type: EmpireMessageType.GeneralBadEvent, subject: lead, popup: false });
    }
}

function inSystem(o: StellarObject, sys: unknown, galaxy: Galaxy): boolean {
    if (isBuiltObject(o)) return o.nearestSystemStar === sys;
    const si = (o as Habitat).systemIndex;
    return typeof si === 'number' && galaxy.systems[si]?.systemStar === sys;
}

/**
 * Where a fleet that is not badly damaged falls back to: its home base (ShipGroup.gatherPoint, the stock fleet home base) when set and
 * not in the battle system, else the nearest system holding one of its empire's colonies or bases outside the battle system, else null.
 */
export function fleetFallbackPoint(galaxy: Galaxy, fleet: ShipGroup): StellarObject | null {
    const lead = fleet.leadShip;
    const empire = fleet.empire;
    if (lead === null || empire === null) return null;
    const sys = lead.nearestSystemStar;
    const gp = fleet.gatherPoint;
    if (gp != null && !gp.hasBeenDestroyed && !inSystem(gp, sys, galaxy)) return gp;
    let best: StellarObject | null = null;
    let bd = Number.MAX_VALUE;
    const consider = (o: StellarObject): void => {
        if (o.hasBeenDestroyed || inSystem(o, sys, galaxy)) return;
        const d = dist(lead, o);
        if (d < bd) {
            bd = d;
            best = o;
        }
    };
    for (const h of empire.colonies) consider(h);
    for (const b of empire.builtObjects) if (b.role === BuiltObjectRole.Base) consider(b);
    return best;
}

/** A tactical fall-back: the fleet moves to `to` (outside the battle); its damaged ships still go to the repair yard on their own. */
export function fallBackFleet(galaxy: Galaxy, fleet: ShipGroup, to: StellarObject, yard: StellarObject | null): void {
    const lead = fleet.leadShip!;
    const empire = fleet.empire!;
    const from = (lead.nearestSystemStar as Habitat | null)?.name ?? '';
    forceCompleteMission(galaxy, fleet);
    shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.Move, to, null, BuiltObjectMissionPriority.Unavailable, true);
    if (yard !== null) {
        for (const ship of [...fleet.ships]) {
            if (ship.damagedComponentCount > 0 && ((ship.topSpeed > 0 && dist(ship, yard) < 2000.0) || (ship.warpSpeed > 0 && ship.topSpeed > 0))) {
                clearPreviousMissionRequirements(galaxy, ship, true);
                assignMission(galaxy, ship, BuiltObjectMissionType.Repair, yard, null, BuiltObjectMissionPriority.VeryHigh);
            }
        }
    }
    fleet.frWithdrawal = { from, yard: to, mission: fleet.mission, sinceMs: galaxy.nowMs, fallback: true };
    delete fleet.frLosingSinceMs;
    delete fleet.frStartFirepower;
    fightingRetreatsState(galaxy).fleetWithdrawals++;
    if (isHumanEmpire(galaxy, empire)) {
        const where = from !== '' ? `from ${from}` : 'from battle';
        scenarioMessage(galaxy, empire, 'Fleet withdrew', `${fleet.name ?? 'A fleet'} withdrew ${where} to fall back to ${nameOf(to)}`, { type: EmpireMessageType.GeneralBadEvent, subject: lead, popup: false });
    }
}

function stepWithdrawal(galaxy: Galaxy, fleet: ShipGroup, w: FleetWithdrawal): void {
    const m = fleet.mission;
    if (m === w.mission && m !== null && m.type === (w.fallback === true ? BuiltObjectMissionType.Move : BuiltObjectMissionType.Repair)) return; // on the way / repairing
    delete fleet.frWithdrawal;
    fightingRetreatsState(galaxy).fleetsResumed++;
    const empire = fleet.empire;
    const lead = fleet.leadShip;
    const idle = m === null || m.type === BuiltObjectMissionType.Undefined;
    if (empire === null || lead === null || !isHumanEmpire(galaxy, empire) || !idle) return; // a new order took over
    const tail = lead.isAutoControlled ? 'and resumes its duties' : 'and awaits orders';
    scenarioMessage(galaxy, empire, 'Fleet repaired', `${fleet.name ?? 'A fleet'} ${w.fallback === true ? 'arrived at' : 'finished repairs at'} ${nameOf(w.yard)} ${tail}`, { type: EmpireMessageType.GeneralNeutralEvent, subject: lead, popup: false });
}

function stepFleet(galaxy: Galaxy, fleet: ShipGroup): void {
    if (fleet.frWithdrawal !== undefined) {
        stepWithdrawal(galaxy, fleet, fleet.frWithdrawal);
        return;
    }
    const lead = fleet.leadShip;
    if (lead === null || fleet.ships.length === 0 || fleet.empire === null || !fleet.ships.some((b) => b.topSpeed > 0) || fleetNeverFlees(fleet)) {
        if (fleet.frLosingSinceMs !== undefined) delete fleet.frLosingSinceMs;
        return;
    }
    const battle = fleetBattle(fleet);
    if (battle.engaged === 0 || battle.enemy <= 0) {
        if (fleet.frLosingSinceMs !== undefined) delete fleet.frLosingSinceMs;
        if (fleet.frStartFirepower !== undefined) delete fleet.frStartFirepower;
        return;
    }
    if (fleet.frStartFirepower !== undefined) delete fleet.frStartFirepower;
    // Outgunned: the enemy has frOutgunned times our side's firepower or more (line = our share at that point).
    const line = 1 / Math.max(0.01, param(galaxy, 'outgunned'));
    const ratio = battle.own / battle.enemy;
    if (ratio <= line) {
        if (fleet.frLosingSinceMs === undefined) {
            fleet.frLosingSinceMs = galaxy.nowMs;
        } else if (galaxy.nowMs - fleet.frLosingSinceMs >= param(galaxy, 'holdSeconds') * 1000) {
            const yard = fleetRepairPoint(galaxy, fleet);
            const badlyDamaged = battle.counted > 0 && (battle.damaged * 100) / battle.counted > param(galaxy, 'damagedPct');
            // Badly damaged: the repair trip. Otherwise a fall-back to the fleet's home base / the nearest own system outside the battle,
            // and only when there is none the yard. Nowhere to go, or the battle is at the repair point itself: fight on, look again after the hold.
            const atYard = yard !== null && dist(lead, yard) <= AT_YARD_RANGE;
            // (Pirate factions keep the repair trip: a fall-back is for the empires.)
            const back = badlyDamaged || atYard || fleet.empire!.pirateEmpireBaseHabitat !== null ? null : fleetFallbackPoint(galaxy, fleet);
            if (back !== null) fallBackFleet(galaxy, fleet, back, yard !== null && dist(lead, yard) > AT_YARD_RANGE ? yard : null);
            else if (yard !== null && dist(lead, yard) > AT_YARD_RANGE) withdrawFleet(galaxy, fleet, yard);
            else fleet.frLosingSinceMs = galaxy.nowMs;
        }
    } else if (fleet.frLosingSinceMs !== undefined && ratio >= (line * param(galaxy, 'hysteresis')) / 100) {
        delete fleet.frLosingSinceMs;
    }
}

/** Per frame (tick/scheduler.ts, behind galaxy.scenario !== null): the checks, every frCheckSeconds of game time. */
export function fightingRetreatsFrame(galaxy: Galaxy): void {
    if (!fightingRetreatsOn(galaxy)) return;
    const st = fightingRetreatsState(galaxy);
    if (galaxy.nowMs < st.nextMs) return;
    st.nextMs = galaxy.nowMs + param(galaxy, 'checkSeconds') * 1000;
    for (const empire of [...galaxy.empires, ...galaxy.pirateEmpires]) {
        if (empire == null || !empire.active || empire === galaxy.independentEmpire) continue;
        for (const g of [...empireShipGroups(empire)]) if (g !== null) stepFleet(galaxy, g);
    }
}

/** The selection panel line of a withdrawing fleet ('' otherwise / without the add-on). */
export function fleetRetreatStatusText(galaxy: Galaxy, fleet: ShipGroup | null): string {
    if (fleet === null || fleet.frWithdrawal === undefined || !fightingRetreatsOn(galaxy)) return '';
    return fleet.frWithdrawal.fallback === true ? `Falling back to ${nameOf(fleet.frWithdrawal.yard)}` : `Withdrawing to ${nameOf(fleet.frWithdrawal.yard)} to repair`;
}
