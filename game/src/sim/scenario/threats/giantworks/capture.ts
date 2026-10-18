// Giantworks: taking a finished Great Work by ground war (every wonder but the Beacon). Not a port; composed of ported
// functions (the stock troop and ground-combat maths, ownership, missions). Every handler is gated by the Giantworks flag, so
// with the add-on off nothing here runs, draws or is saved.
//
//   Shields  - a finished wonder's base is plated to about gwCaptureShields shields (the Ark Engine has its own 30,000). They
//              refill from empty over gwCaptureRechargeDays, never under fire (the stock recharge rate of the plating is replaced:
//              governShields). When they break (2 % or less) they refill along the schedule (shields.ts: the stock recharge
//              cannot beat it) and are whole at its end: that year is the LANDING WINDOW. The Ark keeps its own escape: it flees once to an empty system about
//              two sectors away, and its window opens when it gets there (it stays there, crippled, until it is whole).
//   Breached - while the window is open only gwCaptureBreachedWeaponsPct % of the base's weapons keep firing (the rest are held,
//              Weapon.lastFired), and they leave troop carriers alone while any other hostile ship is in range (the stock
//              shouldAttack query builtObjectSparesStaticTarget). The Compact's base answers the attacker's whole fleet in range
//              (attackWithoutWar), as the Ark does in its fight mode.
//   Quiet    - with gwCaptureQuietDamagePct % of its components damaged its weapons fall silent for the rest of the window.
//              Each Smarter AI attacker then chooses, by personality and situation (the work's value to it, its troops in reach,
//              whether destroying it is a crime): invade to capture it, or destroy it with its fleet.
//   Landing  - troops aboard a ship within LAND_RANGE land on the work: a player's ships ordered to attack it with troops
//              (the stock troop "Attack" menu lists it) or told to land (the Invade threat action), an AI's troop fleets sent
//              by its campaign (they go once the shields are down and land as they arrive) or after its quiet-point choice
//              to capture it. One invader at a time. They fight a virtual ground war on it (no planet): the stock force maths
//              (troop types and their matchups, the Space Control bonus by who holds the space round it, veterans) and the
//              stock loss formula of ResolveInvasionBattles, against a garrison sized per wonder (gwCaptureGarrison<Kind>).
//              The Ground Report window shows it.
//   Capture  - the invaders win at 20 to 1 (or when the garrison is gone): the work's base passes to them by the stock
//              ownership change, so each wonder's own rules for a new holder apply (the holder takes the benefits); the
//              survivors become the garrison. Never a war crime (actions.ts), but every empire thinks less of the captor
//              (gwCaptureRep) and the Compact more so.
// Rnd: the ground war and the landing losses draw the add-on's own Random (a counter in this state); the stock functions
// called (designs, refits, missions, ownership) draw galaxy.rnd inside this module's gated handlers only.
// State: scenario.state.giantworksCapture (plain data plus Empire / BuiltObject / Troop / TroopList references).

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { BuiltObject } from '../../../builtObject';
import type { Race } from '../../../data/races';
import { Random } from '../../../random';
import { BuiltObjectSubRole } from '../../../builtObjectTypes';
import { BuiltObjectRole } from '../../../data/designSpecifications';
import { ComponentType } from '../../../data/components';
import { TroopList, TroopType, type Troop } from '../../../cargo';
import { generateNewTroop } from '../../../builtObjectPlacement';
import { csDoubleToInt, getTroopStrengthsByType, type Modifiers } from '../../../combat/invasion';
import { calculateOverallStrengthFactor } from '../../../combat/threats';
import { getText, militaryPotency, FleetPosture } from '../../../diplomacyTick';
import { EmpireMessageType } from '../../../messages';
import { isHumanEmpire } from '../../../humanEmpires';
import { REAL_SECONDS_IN_GALACTIC_YEAR, YEAR_LENGTH } from '../../../galaxyTime';
import { galaxyStarDate } from '../../../tick/simTime';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../../../missions/mission';
import { isAiControlled } from '../../../missions/playerOrder';
import { findNearestAvailableFleet } from '../../../fleets/militaryAI';
import { empireShipGroups, type ShipGroup } from '../../../fleets/shipGroup';
import { shipGroupAssignMission, shipGroupCheckFleetTargetWithinFuelRangeAndRefuel, shipGroupTotalTroopAttackStrength } from '../../../fleets/shipGroupTasks';
import { generateDesignFromSpec } from '../../../designGeneration';
import { galaxyDesignSpecificationBySubRole } from '../../../gameStartTail';
import { GAME_DAY_LENGTH, registerScenarioEvent, registerScenarioFramePeriodic, registerScenarioQuery } from '../../hooks';
import { scenarioMessage, scenarioNews, scenarioText } from '../../messages';
import { scenarioFlag, scenarioParam, scenarioState } from '../../state';
import { applyReputation } from '../../reputation/ledger';
import { groundCombatTimeSpan } from '../../groundCombat/longerGroundCombat';
import { veteranTroopModifiers } from '../../veterans/veterans';
import { WAR_CRIMES_FLAG } from '../../charactersVictory/diet/warCrimes';
import { SMARTER_AI_FLAG, isSmarterAIStrategist } from '../../smarterAI/common';
import { formStrikeFleet } from '../../smarterAI/pirates';
import { atWar, flipToFaction, peekThreatState, refitInPlace, registerThreatAction } from '../framework';
import { addAnger, demolitionAuthorised, isActor, shipsWithin } from './actions';
import { personality } from './ai';
import { arkRecOf } from './ark';
import { greatWorkTerritoryOwner } from './benefits';
import { kindName } from './knowledge';
import { kindMenace, kindValue } from './registry';
import { breakShields, plateDesignTo, shieldBreakOf, shieldsDown } from './shields';
import { GW_FLAG, TAG, compactFaction, greatWorks, isCompact, logGw, ordinaryEmpires, ownRandom, type GreatWorkRecord } from './state';

export const CAPTURE_KEY = 'giantworksCapture';

/** Troops aboard a ship this close to the work can land (world units; a ship told to go to a base parks about this near). */
export const LAND_RANGE = 2500;
/** A hostile is remembered this long after its last attack on the work (days). */
const HOSTILE_DAYS = 60;
/** The ground war is resolved in steps of this many days (the stock colony resolves every 10 game seconds, ~6 days). */
const BATTLE_STEP_DAYS = 1;
/** The shields of a whole work do not recharge for this long after a hit (days). */
const UNDER_FIRE_DAYS = 2;
/** The AI looks at a work this often (days): the quiet-point choice, its campaign, new campaigns. */
const AI_STEP_DAYS = 2;
/** The weapons held back are held this far ahead (days; the step runs every quarter day, so they stay held). */
const HOLD_DAYS = 1;
/** Kinds that cannot be captured: the Beacon is the Reclaimers' own relay (see the report in docs/EXPANSIONS.md). */
const NOT_CAPTURABLE: ReadonlySet<string> = new Set(['beacon']);

// ---------------------------------------------------------------------------------------------------------------
// Parameters (scenarios/giantworks/scenario.json; the defaults here are the same values)
// ---------------------------------------------------------------------------------------------------------------

const DEFAULTS = {
    gwCaptureShields: 30000,
    gwCaptureRechargeDays: 360,
    gwCaptureBreachedWeaponsPct: 40,
    gwCaptureQuietDamagePct: 50,
    gwCaptureGarrisonCasino: 8,
    gwCaptureGarrisonUltramind: 10,
    gwCaptureGarrisonSanctuary: 6,
    gwCaptureGarrisonArk: 14,
    gwCaptureGarrisonOther: 8,
    gwCaptureTroopStrengthPct: 100,
    gwCaptureGarrisonRegrowDays: 30,
    gwCaptureRep: 8,
    gwCaptureCompactRep: 10,
    gwCaptureAiReviewDays: 30,
    gwCaptureAiSeizePct: 70,
    gwCaptureAiStrikeMarginPct: 250,
    gwCaptureAiStrikeFleets: 3,
    gwCaptureAiTroopMarginPct: 200,
    gwCaptureAiCapturePct: 75,
    gwCaptureAiCampaignYears: 3,
    gwCaptureAiCooldownYears: 3,
} as const;

export type CaptureParamName = keyof typeof DEFAULTS;

export function captureParam(galaxy: Galaxy, name: CaptureParamName): number {
    return scenarioParam(galaxy, name, DEFAULTS[name]);
}

const GARRISON_PARAM: Readonly<Record<string, CaptureParamName>> = {
    casino: 'gwCaptureGarrisonCasino',
    ultramind: 'gwCaptureGarrisonUltramind',
    sanctuary: 'gwCaptureGarrisonSanctuary',
    ark: 'gwCaptureGarrisonArk',
};

/** The garrison of a wonder (troops). Pure. */
export function garrisonSize(galaxy: Galaxy, kind: string): number {
    return Math.max(1, Math.trunc(captureParam(galaxy, GARRISON_PARAM[kind] ?? 'gwCaptureGarrisonOther')));
}

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------

/** An AI empire's attempt on a work: siege (break the shields), breach (its troops wait near), capture or destroy. */
export interface CaptureCampaign {
    empire: Empire;
    since: number;
    stage: 'siege' | 'breach' | 'capture' | 'destroy';
    /** Star date of the last strike / troop order. */
    orderedAt: number;
    /** The troop ships it sent (they land once it chose to capture). */
    troopShips: BuiltObject[];
    /** Troop strength sent so far this window. */
    troopsSent: number;
}

export interface CaptureStats {
    breaches: number;
    landings: number;
    landed: number;
    battles: number;
    repelled: number;
    captured: number;
    defLost: number;
    invLost: number;
    quiet: number;
    aiCapture: number;
    aiDestroy: number;
    campaigns: number;
    /** Troop carriers in range of the breached base at a step, with another hostile ship in range / alone, and those hit. */
    trooperEscorted: number;
    trooperEscortedHit: number;
    trooperAlone: number;
    trooperAloneHit: number;
}

export interface CaptureRec {
    workId: number;
    /** The work's base (the Ark ship for the Ark) at the last step. */
    base: BuiltObject | null;
    /** The base carries the capture shields (the Ark: its own). */
    plated: boolean;
    /** The landing window: the star date the shields broke (-1: whole), and whether troops may land now (the Ark: at its escape system). */
    breachedAt: number;
    landingOpen: boolean;
    /** The weapons are silent (quiet point reached in this window), and when. */
    quiet: boolean;
    quietAt: number;
    /** Damaged components, % (last step). */
    damagePct: number;
    /** The shields and damaged parts at the last step, and the star date it was last hit (the recharge stops under fire). */
    shieldsSeen?: number;
    damagedSeen?: number;
    lastHit?: number;
    garrison: TroopList;
    /** Whose garrison it is (the base's owner when it was raised). */
    garrisonFor: Empire | null;
    regrowAt: number;
    invaders: TroopList;
    invader: Empire | null;
    /** Star date of the last ground-war step (-1: no battle) and of the first landing of this battle. */
    battleAt: number;
    battleSince: number;
    /** empire id → star date of its last attack on the base. */
    hostiles: Record<string, number>;
    /** At the last step: a hostile ship that is not a troop carrier was in weapons range (the troop carriers are spared). */
    sparesTroopers: boolean;
    /** Troop carriers seen in range at the last step: ship id → [shields, damaged components, escorted 1 / 0]. */
    troopers: Record<string, number[]>;
    /** Each AI attacker's choice at the quiet point of this window. */
    plans: Record<string, 'capture' | 'destroy'>;
    campaign: CaptureCampaign | null;
    /** Star date of the last AI look; empire id → star date of its next review; no new campaign before. */
    aiAt?: number;
    aiNext: Record<string, number>;
    cooldown: Record<string, number>;
    captures: { date: number; by: string; from: string; troops: number }[];
    stats: CaptureStats;
}

export interface CaptureState {
    recs: CaptureRec[];
    /** Counter of the add-on's own random draws (a reload continues the same sequence). */
    rolls: number;
}

export function captureState(galaxy: Galaxy): CaptureState {
    return scenarioState<CaptureState>(galaxy, CAPTURE_KEY, () => ({ recs: [], rolls: 0 }));
}

export function peekCaptureState(galaxy: Galaxy): CaptureState | null {
    return peekThreatState<CaptureState>(galaxy, CAPTURE_KEY);
}

function newStats(): CaptureStats {
    return { breaches: 0, landings: 0, landed: 0, battles: 0, repelled: 0, captured: 0, defLost: 0, invLost: 0, quiet: 0, aiCapture: 0, aiDestroy: 0, campaigns: 0, trooperEscorted: 0, trooperEscortedHit: 0, trooperAlone: 0, trooperAloneHit: 0 };
}

function newRec(workId: number): CaptureRec {
    return {
        workId,
        base: null,
        plated: false,
        breachedAt: -1,
        landingOpen: false,
        quiet: false,
        quietAt: -1,
        damagePct: 0,
        garrison: new TroopList(),
        garrisonFor: null,
        regrowAt: 0,
        invaders: new TroopList(),
        invader: null,
        battleAt: -1,
        battleSince: -1,
        hostiles: {},
        sparesTroopers: false,
        troopers: {},
        plans: {},
        campaign: null,
        aiNext: {},
        cooldown: {},
        captures: [],
        stats: newStats(),
    };
}

/** The capture record of a work (null: none yet). Pure. */
export function captureRecOf(galaxy: Galaxy, workId: number): CaptureRec | null {
    return peekCaptureState(galaxy)?.recs.find((r) => r.workId === workId) ?? null;
}

/** The capture record whose base is `bo` (null: `bo` is no capturable work's base). Pure. */
export function captureRecOfBase(galaxy: Galaxy, bo: BuiltObject | null | undefined): CaptureRec | null {
    if (bo === null || bo === undefined) return null;
    const st = peekCaptureState(galaxy);
    if (st === null) return null;
    for (const r of st.recs) if (r.base === bo) return r;
    return null;
}

function workOf(galaxy: Galaxy, rec: CaptureRec): GreatWorkRecord | null {
    return greatWorks(galaxy).find((w) => w.id === rec.workId) ?? null;
}

function days(n: number): number {
    return n * GAME_DAY_LENGTH;
}

function rollRandom(galaxy: Galaxy): Random {
    const st = captureState(galaxy);
    return ownRandom(galaxy, 77000 + st.rolls++);
}

// ---------------------------------------------------------------------------------------------------------------
// Who may take what
// ---------------------------------------------------------------------------------------------------------------

/** A finished work that can be captured (its base alive, not the Beacon). Pure. */
export function capturableWork(w: GreatWorkRecord): boolean {
    return w.phase === 'complete' && !NOT_CAPTURABLE.has(w.wonder) && w.base !== null && !w.base.hasBeenDestroyed;
}

/** An ordinary empire of the galaxy (not the Compact, a threat's faction, pirates). Pure. */
function ordinary(galaxy: Galaxy, e: Empire | null): e is Empire {
    return e !== null && ordinaryEmpires(galaxy).includes(e);
}

/**
 * Whether `e` may land troops on the work now: an ordinary empire that does not own it, against the Compact or a threat's
 * faction, or an empire it is at war with; one invader at a time. Pure.
 */
export function mayInvade(galaxy: Galaxy, rec: CaptureRec, e: Empire | null): e is Empire {
    const base = rec.base;
    if (base === null || base.hasBeenDestroyed || !isActor(galaxy, e) || !ordinary(galaxy, e)) return false;
    const owner = base.actualEmpire;
    if (owner === e) return false;
    if (rec.invader !== null && rec.invader !== e) return false;
    if (owner === null || isCompact(galaxy, owner) || !ordinary(galaxy, owner)) return true;
    return atWar(e, owner);
}

/** A troop carrier: a troop transport, or any ship with troops aboard. Pure. */
export function isTroopCarrier(b: BuiltObject): boolean {
    return b.subRole === BuiltObjectSubRole.TroopTransport || (b.troops !== null && b.troops.count > 0);
}

function hostileTo(galaxy: Galaxy, rec: CaptureRec, e: Empire | null): boolean {
    if (e === null) return false;
    if (rec.invader === e || rec.campaign?.empire === e) return true;
    const t = rec.hostiles[e.empireId];
    return t !== undefined && galaxyStarDate(galaxy) - t <= days(HOSTILE_DAYS);
}

// ---------------------------------------------------------------------------------------------------------------
// The garrison and the forces
// ---------------------------------------------------------------------------------------------------------------

/** One troop of the garrison of `w` for `owner` (stock GenerateNewTroop: its race's strength and the owner's bonuses; no upkeep). */
function garrisonTroop(galaxy: Galaxy, w: GreatWorkRecord, owner: Empire, i: number): Troop {
    const robots = w.wonder === 'ultramind'; // the Ultramind's guards are its own battle robots
    const race = robots ? null : ((owner.dominantRace as Race | null | undefined) ?? null);
    const natural = Math.max(10, Math.round(((race?.troopStrength ?? 100) * captureParam(galaxy, 'gwCaptureTroopStrengthPct')) / 100));
    const type = i % 5 === 4 ? TroopType.Artillery : i % 4 === 3 ? TroopType.Armored : TroopType.Infantry;
    const t = generateNewTroop(scenarioText(`${TAG} Capture Troop`, kindName(w.wonder)), type, natural, owner, race, true);
    t.maintenanceMultiplier = 0;
    t.readiness = 100;
    if (robots) t.pictureRef = galaxy.races.length; // the stock BattleBot picture marker
    return t;
}

/** The garrison is full again for the base's owner (a new holder by other means than a capture: boarding, an awakening). */
function raiseGarrison(galaxy: Galaxy, w: GreatWorkRecord, rec: CaptureRec, owner: Empire): void {
    rec.garrison = new TroopList();
    const n = garrisonSize(galaxy, w.wonder);
    for (let i = 0; i < n; i++) rec.garrison.add(garrisonTroop(galaxy, w, owner, i));
    rec.garrisonFor = owner;
}

/**
 * The two sides' strengths now, with their modifiers: the stock CalculateForceStrengths for a work, which has no planet
 * (Habitat.cs 4368 DetermineTroopModifiers' troop-type matchups, its Space Control bonus — the attackers hold the space round
 * the work once its guns are silent, the defenders while they fire — and the veterans add-on), as the Ground Report shows it. Pure.
 */
export function captureForces(galaxy: Galaxy, rec: CaptureRec): { defendingStrength: number; attackingStrength: number; defend: Modifiers; attack: Modifiers } {
    const defend: Modifiers = { amounts: [], reasons: [] };
    const attack: Modifiers = { amounts: [], reasons: [] };
    const defending = rec.garrison;
    const attacking = rec.invaders;
    const d = getTroopStrengthsByType(defending, true);
    const a = getTroopStrengthsByType(attacking, true); // the C# passes defending: true for the attackers too
    const totalAttackStrength = attacking.totalAttackStrength;
    if (totalAttackStrength > 0 && d.armorStrength > 0.0 && d.armorStrength >= a.armorStrength * 2.0) {
        defend.amounts.push(0.25);
        defend.reasons.push(getText('Armored Reserve'));
    } else if (a.armorStrength > 0.0 && a.armorStrength >= d.armorStrength * 2.0) {
        attack.amounts.push(0.25);
        attack.reasons.push(getText('Armored Breakthrough'));
    }
    if (totalAttackStrength > 0 && d.infantryStrength > 0.0 && d.infantryStrength >= a.infantryStrength * 2.0) {
        defend.amounts.push(0.25);
        defend.reasons.push(getText('Fortified Line'));
    } else if (a.infantryStrength > 0.0 && a.infantryStrength >= d.infantryStrength * 2.0) {
        attack.amounts.push(0.25);
        attack.reasons.push(getText('Overwhelming Odds'));
    }
    if (totalAttackStrength > 0 && d.artilleryStrength > a.specialForcesStrength) {
        defend.amounts.push(0.25);
        defend.reasons.push(getText('Defense Grid'));
    } else if (a.artilleryStrength > d.specialForcesStrength) {
        attack.amounts.push(0.25);
        attack.reasons.push(getText('Defense Grid'));
    }
    if (totalAttackStrength > 0 && d.specialForcesStrength > a.artilleryStrength) {
        defend.amounts.push(0.25);
        defend.reasons.push(getText('Special Operations'));
    } else if (a.specialForcesStrength > d.artilleryStrength) {
        attack.amounts.push(0.25);
        attack.reasons.push(getText('Special Operations'));
    }
    if (totalAttackStrength > 0) {
        if (rec.quiet) {
            attack.amounts.push(0.25);
            attack.reasons.push(getText('Space Control'));
        } else {
            defend.amounts.push(0.25);
            defend.reasons.push(getText('Space Control'));
        }
    }
    veteranTroopModifiers(galaxy, defending, attacking, defend, attack);
    let dm = 0;
    for (const x of defend.amounts) dm += x;
    let am = 0;
    for (const x of attack.amounts) am += x;
    return {
        defendingStrength: csDoubleToInt((1.0 + dm) * defending.totalDefendStrength),
        attackingStrength: csDoubleToInt((1.0 + am) * attacking.totalAttackStrength),
        defend,
        attack,
    };
}

/** The troop strength an attacker should bring: the garrison's defence (with its modifiers) times gwCaptureAiTroopMarginPct %. Pure. */
export function troopsNeeded(galaxy: Galaxy, rec: CaptureRec): number {
    const d = rec.garrison.totalDefendStrength * 1.5; // the defenders' usual bonuses (Space Control, Fortified Line ...)
    return Math.trunc((d * captureParam(galaxy, 'gwCaptureAiTroopMarginPct')) / 100) + 1;
}

// ---------------------------------------------------------------------------------------------------------------
// Shields, weapons, the window
// ---------------------------------------------------------------------------------------------------------------

/** A finished wonder's base gets the capture shields (a fresh design of its kind for its owner, plated, refitted in place). */
function plate(galaxy: Galaxy, w: GreatWorkRecord, rec: CaptureRec, base: BuiltObject): void {
    rec.plated = true;
    if (w.wonder === 'ark' || base.role !== BuiltObjectRole.Base) return; // the Ark is plated by its own module
    const target = captureParam(galaxy, 'gwCaptureShields');
    if (base.shieldsCapacity >= target) return;
    const owner = base.actualEmpire;
    if (owner === null) return;
    try {
        const spec = owner.designSpecifications.find((s) => s !== null && s.subRole === base.subRole) ?? galaxyDesignSpecificationBySubRole(base.subRole);
        if (spec === null || spec === undefined) return;
        const d = generateDesignFromSpec(galaxy, owner, spec, 0, galaxyStarDate(galaxy));
        if (d === null) return;
        plateDesignTo(d, ComponentType.Shields, target, (x) => x.shieldsCapacity);
        d.name = base.design.name;
        d.isObsolete = true; // never an AI build
        owner.designs.push(d);
        const name = base.name;
        refitInPlace(galaxy, base, d);
        base.name = name;
        logGw(galaxy, galaxyStarDate(galaxy), `work ${w.id} plated: shields ${Math.round(base.shieldsCapacity)}, firepower ${Math.round(base.firepowerRaw)}, ${base.components.count} components`);
    } catch {
        // a design the generator cannot make: the base keeps its own shields
    }
}

/**
 * Holds back the weapons beyond the share that keeps firing (all of them once quiet) for the next HOLD_DAYS. The ones that
 * fire are spread evenly through the list (weapon i fires when floor((i + 1) * share) > floor(i * share)), so every kind of
 * gun the base carries keeps its share (the list runs part by part: the first ones may all be point defence).
 */
function holdWeapons(galaxy: Galaxy, base: BuiltObject, rec: CaptureRec): void {
    const ws = base.weapons;
    if (ws === null || ws === undefined || ws.length === 0) return;
    const share = rec.quiet ? 0 : Math.max(0, Math.min(1, captureParam(galaxy, 'gwCaptureBreachedWeaponsPct') / 100));
    const until = galaxy.nowMs + days(HOLD_DAYS);
    for (let i = 0; i < ws.length; i++) {
        const wp = ws[i];
        if (wp == null || keepsFiring(i, share)) continue;
        if (wp.lastFired < until) wp.lastFired = until;
    }
}

/** Whether weapon `i` of `n` keeps firing while the shields are down (holdWeapons' spread). Pure. */
export function keepsFiring(i: number, share: number): boolean {
    return Math.floor((i + 1) * share + 1e-9) > Math.floor(i * share + 1e-9);
}

/** Damaged components of the base, %. Pure. */
export function damagePctOf(base: BuiltObject): number {
    const n = base.components.count;
    return n > 0 ? (100 * base.damagedComponentCount) / n : 0;
}

/**
 * The shields of a finished work refill from empty over gwCaptureRechargeDays, broken or not (its plating is huge and its
 * generators are not): the stock recharge rate (BuiltObject.shieldRechargeRate, the sum of its shield parts, set again by every
 * ReDefine) is replaced by capacity / that many days each step, and by nothing while it is under fire. After a break the
 * schedule (shields.ts) holds them to the same line, and they are whole again at its end.
 */
function governShields(galaxy: Galaxy, base: BuiltObject, rec: CaptureRec, now: number, broken: boolean): void {
    const seen = rec.shieldsSeen ?? base.currentShields;
    if (base.currentShields < seen - 0.5 || base.damagedComponentCount > (rec.damagedSeen ?? base.damagedComponentCount)) rec.lastHit = now;
    rec.shieldsSeen = base.currentShields;
    rec.damagedSeen = base.damagedComponentCount;
    void broken; // the schedule (shields.ts) only ever lowers them to its rising line, never below the last look: no false hits
    const underFire = now - (rec.lastHit ?? -Infinity) < days(UNDER_FIRE_DAYS);
    const perSecond = base.shieldsCapacity / (Math.max(1, captureParam(galaxy, 'gwCaptureRechargeDays')) * (REAL_SECONDS_IN_GALACTIC_YEAR / 360));
    base.shieldRechargeRate = underFire ? 0 : Math.fround(perSecond);
}

/** The hostile ships round the breached base: whether any is not a troop carrier, and the troop carriers' wounds since the last step. */
function scanRange(galaxy: Galaxy, base: BuiltObject, rec: CaptureRec): void {
    const range = Math.max(1500, base.maximumWeaponsRange);
    const owner = base.actualEmpire;
    let other = false;
    const troopers: BuiltObject[] = [];
    for (const b of shipsWithin(galaxy, base.xpos, base.ypos, range)) {
        if (b === base || b.role === BuiltObjectRole.Base || b.actualEmpire === owner || !hostileTo(galaxy, rec, b.actualEmpire)) continue;
        if (isTroopCarrier(b)) troopers.push(b);
        else other = true;
    }
    // A troop carrier hit since the last look (its shields fell, or a part was damaged), counted by whether it was escorted then.
    const seen: Record<string, number[]> = {};
    for (const b of troopers) {
        const k = String(b.builtObjectID);
        const before = rec.troopers[k];
        if (before !== undefined && !rec.quiet) {
            const hit = b.currentShields < before[0] - 0.5 || b.damagedComponentCount > before[1];
            if (before[2] === 1) {
                rec.stats.trooperEscorted++;
                if (hit) rec.stats.trooperEscortedHit++;
            } else {
                rec.stats.trooperAlone++;
                if (hit) rec.stats.trooperAloneHit++;
            }
        }
        seen[k] = [b.currentShields, b.damagedComponentCount, other ? 1 : 0];
    }
    rec.troopers = seen;
    rec.sparesTroopers = other;
}

function tellBreach(galaxy: Galaxy, w: GreatWorkRecord, base: BuiltObject): void {
    scenarioNews(galaxy, null, scenarioText(`${TAG} Capture Breach News`, base.name, Math.round(captureParam(galaxy, 'gwCaptureRechargeDays'))), () => true, base);
    void w;
}

function tellQuiet(galaxy: Galaxy, w: GreatWorkRecord, rec: CaptureRec, base: BuiltObject): void {
    for (const e of ordinaryEmpires(galaxy)) {
        if (!isHumanEmpire(galaxy, e) || !hostileTo(galaxy, rec, e)) continue;
        scenarioMessage(galaxy, e, scenarioText(`${TAG} Capture Quiet Title`), scenarioText(`${TAG} Capture Quiet`, base.name), { type: EmpireMessageType.GeneralGoodEvent, subject: base, popup: false });
    }
    void w;
}

// ---------------------------------------------------------------------------------------------------------------
// Landing and the ground war
// ---------------------------------------------------------------------------------------------------------------

/** Whether troop ship `b` of `e` means to land on the work (an order that names it, or an AI's capture troops). Pure. */
function meansToLand(galaxy: Galaxy, rec: CaptureRec, b: BuiltObject, e: Empire): boolean {
    const base = rec.base!;
    const c = rec.campaign;
    // An AI lands what it sent once the shields are down (its campaign) or once it chose to capture it at the quiet point.
    if (!isHumanEmpire(galaxy, e)) return c !== null && c.empire === e && (c.stage === 'capture' || c.stage === 'breach') && (c.troopShips.includes(b) || missionTarget(b) === base);
    const m = builtObjectMission(b.mission);
    return m !== null && m.type === BuiltObjectMissionType.Attack && m.targetBuiltObject === base;
}

function missionTarget(b: BuiltObject): BuiltObject | null {
    const m = builtObjectMission(b.mission);
    if (m !== null) return m.targetBuiltObject;
    const g = b.shipGroup as ShipGroup | null;
    return g?.mission?.targetBuiltObject ?? null;
}

/**
 * The troops aboard `ships` land on the work. While its guns still fire, each may be hit on the way down (boarding.ts /
 * cmdAttack.ts landing losses: the defences' firepower and gun count, here the share of the base's weapons that fire).
 * Returns the troops landed.
 */
export function landTroops(galaxy: Galaxy, w: GreatWorkRecord, rec: CaptureRec, e: Empire, ships: BuiltObject[]): number {
    const base = rec.base;
    if (base === null || !rec.landingOpen || !mayInvade(galaxy, rec, e)) return 0;
    let landed = 0;
    let val = 0;
    let val2 = 0;
    if (!rec.quiet) {
        const share = captureParam(galaxy, 'gwCaptureBreachedWeaponsPct') / 100;
        const num = Math.min(3000, base.firepowerRaw * share);
        const num2 = Math.min(10, Math.ceil((base.weapons?.length ?? 0) * share));
        val = Math.min(90.0, Math.sqrt(num) * Math.sqrt(num2));
        val2 = Math.min(95.0, Math.sqrt(num) * Math.sqrt(num2));
    }
    const rnd = val2 > 0 ? rollRandom(galaxy) : null;
    const now = galaxyStarDate(galaxy);
    for (const b of ships) {
        if (b.troops === null || b.troops.count === 0 || b.actualEmpire !== e) continue;
        for (const t of b.troops.items) {
            if (t == null) continue;
            t.builtObject = null;
            t.colony = null;
            if (rnd !== null) {
                let hit = val;
                let chance = val2;
                if (t.type === TroopType.SpecialForces) {
                    hit /= 3.0;
                    chance /= 3.0;
                }
                if (rnd.nextDouble() * 100.0 < chance) {
                    const loss = Math.min(Math.fround(t.readiness * Math.fround(0.9)), hit * rnd.nextDouble());
                    t.readiness = Math.fround(t.readiness - Math.fround(loss));
                }
            }
            rec.invaders.add(t);
            landed++;
        }
        b.troops.clear();
        const c = rec.campaign;
        if (c !== null && c.empire === e) c.troopShips = c.troopShips.filter((x) => x !== b);
    }
    if (landed === 0) return 0;
    const first = rec.invader === null;
    rec.invader = e;
    rec.stats.landings++;
    rec.stats.landed += landed;
    if (rec.battleAt < 0) rec.battleAt = now;
    if (first) {
        rec.battleSince = now;
        rec.stats.battles++;
        scenarioNews(galaxy, null, scenarioText(`${TAG} Capture Landed News`, e.name, base.name), () => true, base);
        const owner = base.actualEmpire;
        if (owner !== null && isHumanEmpire(galaxy, owner)) scenarioMessage(galaxy, owner, scenarioText(`${TAG} Capture Defend Title`), scenarioText(`${TAG} Capture Defend`, e.name, base.name), { type: EmpireMessageType.GeneralBadEvent, subject: base, popup: false });
    }
    logGw(galaxy, now, `work ${w.id}: ${landed} troops of ${e.name} land (${Math.round((now - rec.breachedAt) / GAME_DAY_LENGTH)} days into the window${rec.quiet ? ', guns silent' : ''}); invaders ${rec.invaders.count}, garrison ${rec.garrison.count}`);
    return landed;
}

/**
 * Whether `e`'s troops near the work go down now. A player's land at once (they were ordered to). An AI's wait for one
 * landing in strength: enough of them near (3/4 of what it needs), or none of the troop ships it sent still on the way, or the
 * window closing within 30 days; reinforcements for a fight already on go at once. Pure.
 */
function readyToLand(galaxy: Galaxy, rec: CaptureRec, e: Empire, near: BuiltObject[], sched: { brokenAt: number; days: number } | null): boolean {
    if (isHumanEmpire(galaxy, e) || rec.invader === e) return true;
    let strength = 0;
    for (const b of near) strength += b.troops?.totalAttackStrength ?? 0;
    if (strength >= troopsNeeded(galaxy, rec) * 0.75) return true;
    const c = rec.campaign;
    const coming = c === null ? 0 : c.troopShips.filter((b) => !near.includes(b) && !b.hasBeenDestroyed && b.actualEmpire === e && b.troops !== null && b.troops.count > 0).length;
    if (coming === 0) return true;
    return sched !== null && sched.brokenAt + days(sched.days) - galaxyStarDate(galaxy) <= days(30);
}

/** The ships of `e` within LAND_RANGE of the base with troops aboard. Pure. */
export function troopShipsInRange(galaxy: Galaxy, rec: CaptureRec, e: Empire): BuiltObject[] {
    const base = rec.base;
    if (base === null) return [];
    return shipsWithin(galaxy, base.xpos, base.ypos, LAND_RANGE).filter((b) => b !== base && b.actualEmpire === e && b.troops !== null && b.troops.count > 0);
}

/** InflictTroopLosses (Habitat.cs 4973): `losses` readiness off a random troop, the rest carried to the next while it dies. */
function inflict(rnd: Random, losses: number, troops: TroopList, inflicter: Empire | null, onDeath: () => void): void {
    let guard = 0;
    while (troops.count > 0 && guard++ < 1000) {
        const troop = troops.items[rnd.next(0, troops.count)];
        if (troop == null) return;
        if (troop.type === TroopType.SpecialForces) losses /= 3.0; // special forces evade better (every pick: the recursion passes true)
        if (troop.readiness >= losses) {
            troop.readiness = Math.fround(troop.readiness - Math.fround(losses));
            return;
        }
        if (inflicter !== null && inflicter.counters !== null) inflicter.counters.processTroopDestruction(troop);
        losses -= troop.readiness;
        troops.remove(troop);
        const e = troop.empire as Empire | null;
        if (e !== null && e.troops != null) e.troops.remove(troop);
        onDeath();
    }
}

/** One step of the ground war (the stock ResolveInvasionBattles loss formula over the time since the last step). */
function battleStep(galaxy: Galaxy, w: GreatWorkRecord, rec: CaptureRec, now: number): void {
    if (rec.invaders.count === 0) {
        rec.battleAt = -1;
        return;
    }
    if (now - rec.battleAt < days(BATTLE_STEP_DAYS)) return;
    const seconds = (now - rec.battleAt) / 1000;
    rec.battleAt = now;
    const t = groundCombatTimeSpan(galaxy, seconds);
    const f = captureForces(galaxy, rec);
    const attackingStrength = f.attackingStrength;
    const defendingStrength = f.defendingStrength;
    const rnd = rollRandom(galaxy);
    const num2 = Math.min(2.0, Math.max(0.5, defendingStrength / (attackingStrength + 1.0)));
    const num3 = Math.min(2.0, Math.max(0.5, attackingStrength / (defendingStrength + 1.0)));
    const num4 = Math.max(0.5, Math.sqrt((attackingStrength + defendingStrength) / 10000.0) / 2.0);
    let num6 = (0.8 + rnd.nextDouble() * 0.4) * num2 * num4 * t;
    let num8 = (0.8 + rnd.nextDouble() * 0.4) * num3 * num4 * t;
    const num9 = attackingStrength - num6;
    const num10 = defendingStrength - num8;
    if (num9 > num10) {
        const num11 = num9 / num10;
        const val = attackingStrength * 0.9;
        if (num10 <= 0.0) {
            num6 += num10;
            num6 = Math.min(val, Math.max(0.0, num6));
        } else if (num11 >= 10.0) {
            num6 -= num10;
            num6 = Math.min(val, Math.max(0.0, num6));
        }
    } else if (num9 <= 0.0) {
        num8 += num9;
        num8 = Math.max(0.0, num8);
    }
    const defender = rec.base?.actualEmpire ?? null;
    inflict(rnd, num6, rec.invaders, defender, () => rec.stats.invLost++);
    inflict(rnd, num8, rec.garrison, rec.invader, () => rec.stats.defLost++);
    if (rec.invaders.totalAttackStrength <= 0) {
        repelled(galaxy, w, rec, now);
        return;
    }
    if (rec.garrison.count === 0 || defendingStrength <= 0 || attackingStrength / defendingStrength >= 20.0) captured(galaxy, w, rec, now);
}

function repelled(galaxy: Galaxy, w: GreatWorkRecord, rec: CaptureRec, now: number): void {
    const e = rec.invader;
    for (const t of rec.invaders.items) {
        const te = t.empire as Empire | null;
        if (te !== null && te.troops != null) te.troops.remove(t);
    }
    rec.invaders.clear();
    rec.invader = null;
    rec.battleAt = -1;
    rec.stats.repelled++;
    const base = rec.base;
    if (e !== null && base !== null && isHumanEmpire(galaxy, e)) scenarioMessage(galaxy, e, scenarioText(`${TAG} Capture Repelled Title`), scenarioText(`${TAG} Capture Repelled`, base.name), { type: EmpireMessageType.GeneralBadEvent, subject: base, popup: false });
    logGw(galaxy, now, `work ${w.id}: the invasion by ${e?.name ?? '?'} is repelled (garrison ${rec.garrison.count} left)`);
}

/** The invaders won: the base passes to them (each wonder's own rules for a new holder apply), the survivors hold it. */
function captured(galaxy: Galaxy, w: GreatWorkRecord, rec: CaptureRec, now: number): void {
    const captor = rec.invader;
    const base = rec.base;
    if (captor === null || base === null || base.hasBeenDestroyed) return;
    const from = base.actualEmpire;
    w.captureTransfer = true;
    try {
        flipToFaction(galaxy, base, captor);
    } finally {
        delete w.captureTransfer;
    }
    if (w.holder !== captor) w.holder = captor; // actions.ts sets it on the ownership event; a work the event missed still changes hands
    // The survivors hold it now (out of the captor's own troop list: they are the work's garrison, free of upkeep).
    const survivors = rec.invaders.items.slice();
    rec.garrison = new TroopList();
    for (const t of survivors) {
        if (captor.troops != null) captor.troops.remove(t);
        t.maintenanceMultiplier = 0;
        rec.garrison.add(t);
    }
    rec.garrisonFor = captor;
    rec.regrowAt = now + days(captureParam(galaxy, 'gwCaptureGarrisonRegrowDays'));
    rec.invaders = new TroopList();
    rec.invader = null;
    rec.battleAt = -1;
    rec.plans = {};
    rec.campaign = null;
    delete w.captureBy;
    rec.stats.captured++;
    rec.captures.push({ date: now, by: captor.name, from: from?.name ?? '-', troops: survivors.length });
    // Not a crime, but the galaxy sees an empire take a wonder by force; the Compact most of all.
    const rep = captureParam(galaxy, 'gwCaptureRep');
    let told = 0;
    for (const e of ordinaryEmpires(galaxy)) {
        if (e === captor) continue;
        applyReputation(galaxy, e, captor, -rep, { cause: 'giantworks.capture', labelKey: 'Reputation Cause giantworks.capture', source: 'giantworks', decayPerYear: 1 });
        told++;
    }
    const compact = compactFaction(galaxy);
    if (compact !== null && compact !== captor) applyReputation(galaxy, compact, captor, -captureParam(galaxy, 'gwCaptureCompactRep'), { cause: 'giantworks.capture', labelKey: 'Reputation Cause giantworks.capture', source: 'giantworks', decayPerYear: 0.5 });
    if (isActor(galaxy, captor)) addAnger(w, captor, 20);
    scenarioNews(galaxy, null, scenarioText(`${TAG} Capture Captured News`, captor.name, base.name), () => true, base);
    if (from !== null && from !== captor && isHumanEmpire(galaxy, from)) scenarioMessage(galaxy, from, scenarioText(`${TAG} Capture Lost Title`), scenarioText(`${TAG} Capture Lost`, captor.name, base.name), { type: EmpireMessageType.GeneralBadEvent, subject: base, popup: false });
    logGw(galaxy, now, `work ${w.id} CAPTURED by ${captor.name} from ${from?.name ?? '-'} (${survivors.length} troops hold it); standing -${rep} with ${told} empires`);
}

// ---------------------------------------------------------------------------------------------------------------
// The AI (Smarter AI empires only)
// ---------------------------------------------------------------------------------------------------------------

function nearestColonySectors(galaxy: Galaxy, e: Empire, x: number, y: number): number {
    let best = Number.MAX_VALUE;
    for (const h of e.colonies) if (h !== null && h.empire === e) best = Math.min(best, galaxy.calculateDistance(h.xpos, h.ypos, x, y));
    return best / galaxy.sectorSize;
}

/** The AI fleets of `e` with troops aboard that are free for a new task, nearest the base first. Pure. */
function troopFleets(galaxy: Galaxy, e: Empire, base: BuiltObject): { fleet: ShipGroup; strength: number }[] {
    const out: { fleet: ShipGroup; strength: number; d: number }[] = [];
    for (const g of empireShipGroups(e)) {
        if (g === null || g.leadShip === null || !isAiControlled(g.leadShip)) continue;
        const s = shipGroupTotalTroopAttackStrength(g);
        if (s <= 0) continue;
        const m = g.mission;
        if (m !== null && m.type !== BuiltObjectMissionType.Undefined && m.priority >= BuiltObjectMissionPriority.High && m.targetBuiltObject !== base) continue;
        out.push({ fleet: g, strength: s, d: galaxy.calculateDistance(g.leadShip.xpos, g.leadShip.ypos, base.xpos, base.ypos) });
    }
    out.sort((a, b) => a.d - b.d || a.fleet.leadShip!.builtObjectID - b.fleet.leadShip!.builtObjectID);
    return out.map((x) => ({ fleet: x.fleet, strength: x.strength }));
}

/** The troop strength `e` has free within reach of the work. Pure. */
export function troopsInReach(galaxy: Galaxy, e: Empire, base: BuiltObject): number {
    const reach = galaxy.sectorSize * 8;
    let n = 0;
    for (const t of troopFleets(galaxy, e, base)) if (galaxy.calculateDistance(t.fleet.leadShip!.xpos, t.fleet.leadShip!.ypos, base.xpos, base.ypos) <= reach) n += t.strength;
    return n;
}

/**
 * The quiet point: an AI attacker takes the work by ground war or destroys it with its fleet, by its personality and the
 * situation (the work's value to it, the troops it has in reach against the garrison, the price of destroying it: a war crime
 * unless the Diet authorised it or it turned hostile, and the Ark's people). Pure (deterministic).
 */
export function aiQuietChoice(galaxy: Galaxy, w: GreatWorkRecord, rec: CaptureRec, e: Empire): { choice: 'capture' | 'destroy'; score: number; troops: number; need: number } {
    const base = rec.base!;
    const pr = personality(e);
    const need = troopsNeeded(galaxy, rec);
    const troops = troopsInReach(galaxy, e, base) + (rec.invader === e ? rec.invaders.totalAttackStrength : 0);
    const troopShare = Math.min(1.5, troops / Math.max(1, need));
    const value = w.hostile ? kindValue(w.wonder) * 0.6 : kindValue(w.wonder);
    const crime = !w.hostile && scenarioFlag(galaxy, WAR_CRIMES_FLAG) && !demolitionAuthorised(galaxy);
    let s = 0.9 * value + 0.5 * Math.min(1, troopShare) - 0.25 * pr.aggression + 0.1 * pr.friendly + 0.1 * Math.max(0, pr.caution);
    if (crime) s += 0.25;
    if (w.wonder === 'ark') s += 0.3; // destroying the Ark kills everyone aboard (gwArkDestroyRep)
    if (w.hostile) s -= 0.3 * kindMenace(w.wonder);
    const can = troopShare >= 0.5;
    const choice = can && s >= captureParam(galaxy, 'gwCaptureAiCapturePct') / 100 ? 'capture' : 'destroy';
    return { choice, score: s, troops, need };
}

/** Whether an AI empire goes for a finished work it does not hold (a campaign: strike, then troops), and its score. Pure. */
export function aiSeizeScore(galaxy: Galaxy, w: GreatWorkRecord, rec: CaptureRec, e: Empire): number | null {
    const base = rec.base;
    if (base === null || w.hostile || !mayInvade(galaxy, rec, e)) return null;
    if (nearestColonySectors(galaxy, e, base.xpos, base.ypos) > scenarioParam(galaxy, 'giantworksAiReachSectors', 3)) return null;
    if (militaryPotency(e) < strikeNeed(galaxy, w, base) || !strikeAvailable(galaxy, e)) return null;
    if (troopsInReach(galaxy, e, base) < troopsNeeded(galaxy, rec) * 0.5) return null;
    const pr = personality(e);
    const territory = greatWorkTerritoryOwner(galaxy, w) === e && w.holder === null; // it already takes most of the benefit
    return kindValue(w.wonder) + 0.3 * pr.aggression - 0.25 * Math.max(0, pr.friendly) - 0.15 * Math.max(0, pr.caution) - (territory ? 0.25 : 0);
}

/** Whether `e` has a strike fleet free for it (an attack fleet, AI-run, on nothing above a normal task). Pure (no fuel orders). */
function strikeAvailable(galaxy: Galaxy, e: Empire): boolean {
    for (const g of empireShipGroups(e)) {
        if (g === null || g.leadShip === null || g.posture !== FleetPosture.Attack || !isAiControlled(g.leadShip)) continue;
        const m = g.mission;
        if (m === null || m.type === BuiltObjectMissionType.Undefined || m.priority <= BuiltObjectMissionPriority.Normal) return true;
    }
    return false;
}

function strikeNeed(galaxy: Galaxy, w: GreatWorkRecord, base: BuiltObject): number {
    let s = calculateOverallStrengthFactor(base) + Math.trunc(Math.max(0, base.shieldsCapacity - base.currentShields) / 20); // its whole shields
    for (const g of w.guards) if (!g.hasBeenDestroyed) s += calculateOverallStrengthFactor(g);
    return Math.trunc((s * captureParam(galaxy, 'gwCaptureAiStrikeMarginPct')) / 100);
}

function fleetsAttacking(e: Empire, base: BuiltObject): ShipGroup[] {
    const out: ShipGroup[] = [];
    for (const g of empireShipGroups(e)) if (g !== null && g.mission !== null && g.mission.type === BuiltObjectMissionType.Attack && g.mission.targetBuiltObject === base) out.push(g);
    return out;
}

/**
 * Strike fleets at the base itself (mission Attack: no war needed), as ai.ts sendStrike sends one at a work, but several
 * (up to gwCaptureAiStrikeFleets, nearest first) until their strength reaches the need: one fleet cannot outlast its shields.
 */
function sendStrikeAtBase(galaxy: Galaxy, w: GreatWorkRecord, e: Empire, base: BuiltObject): boolean {
    const need = strikeNeed(galaxy, w, base);
    const fleets = fleetsAttacking(e, base);
    let have = 0;
    for (const f of fleets) for (const b of f.ships) have += calculateOverallStrengthFactor(b);
    const max = Math.max(1, Math.trunc(captureParam(galaxy, 'gwCaptureAiStrikeFleets')));
    for (let i = 0; have < need && fleets.length < max && i < max; i++) {
        let fleet = findNearestAvailableFleet(galaxy, e, base.xpos, base.ypos, BuiltObjectMissionPriority.Normal, 0, FleetPosture.Attack, true, 0.1, false, false, false, true);
        if (fleet === null) fleet = formStrikeFleet(galaxy, e, base.xpos, base.ypos, Math.max(1, need - have));
        if (fleet === null || fleet.leadShip === null || !isAiControlled(fleet.leadShip)) break;
        if (!shipGroupCheckFleetTargetWithinFuelRangeAndRefuel(galaxy, fleet, base.xpos, base.ypos, 0.1)) break;
        if (!shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.Attack, base, null, BuiltObjectMissionPriority.High, true)) break;
        fleets.push(fleet);
        for (const b of fleet.ships) have += calculateOverallStrengthFactor(b);
    }
    return fleets.length > 0;
}

/** Its strike fleets stop firing on the base and guard the landing instead (Patrol of the base). */
function callOffStrikes(galaxy: Galaxy, e: Empire, base: BuiltObject): void {
    for (const g of fleetsAttacking(e, base)) shipGroupAssignMission(galaxy, g, BuiltObjectMissionType.Patrol, base, null, BuiltObjectMissionPriority.High, true);
}

/** Troop fleets go to the base (Move); they land once the empire chose to capture it. Returns the troop strength sent. */
function sendTroops(galaxy: Galaxy, rec: CaptureRec, c: CaptureCampaign, base: BuiltObject): number {
    const need = troopsNeeded(galaxy, rec);
    let sent = 0;
    for (const t of troopFleets(galaxy, c.empire, base)) {
        if (sent >= need) break;
        const g = t.fleet;
        if (g.mission !== null && g.mission.targetBuiltObject === base) continue; // already on its way
        if (!shipGroupCheckFleetTargetWithinFuelRangeAndRefuel(galaxy, g, base.xpos, base.ypos, 0.1)) continue;
        if (!shipGroupAssignMission(galaxy, g, BuiltObjectMissionType.Move, base, null, BuiltObjectMissionPriority.High, true)) continue;
        sent += t.strength;
        for (const b of g.ships) if (b.troops !== null && b.troops.count > 0 && !c.troopShips.includes(b)) c.troopShips.push(b);
    }
    c.troopsSent += sent;
    return sent;
}

function endCampaign(galaxy: Galaxy, w: GreatWorkRecord, rec: CaptureRec, why: string, now: number): void {
    const c = rec.campaign;
    if (c === null) return;
    rec.cooldown[c.empire.empireId] = now + captureParam(galaxy, 'gwCaptureAiCooldownYears') * YEAR_LENGTH;
    if (w.captureBy === c.empire.empireId) delete w.captureBy;
    rec.campaign = null;
    logGw(galaxy, now, `work ${w.id}: ${c.empire.name} gives up its campaign (${why})`);
}

/** The quiet point reached: each AI attacker that has not chosen yet in this window chooses. */
function quietChoices(galaxy: Galaxy, w: GreatWorkRecord, rec: CaptureRec, base: BuiltObject, now: number): void {
    for (const e of ordinaryEmpires(galaxy)) {
        if (rec.plans[e.empireId] !== undefined || !hostileTo(galaxy, rec, e) || isHumanEmpire(galaxy, e) || !isSmarterAIStrategist(galaxy, e)) continue;
        if (!mayInvade(galaxy, rec, e) && rec.invader !== e) continue;
        const q = aiQuietChoice(galaxy, w, rec, e);
        rec.plans[e.empireId] = q.choice;
        logGw(galaxy, now, `work ${w.id}: ${e.name} at the quiet point chooses to ${q.choice} it (score ${q.score.toFixed(2)}, troops ${Math.round(q.troops)} of ${q.need} needed)`);
        if (q.choice === 'capture') {
            rec.stats.aiCapture++;
            if (rec.campaign === null || rec.campaign.empire === e) {
                if (rec.campaign === null) {
                    rec.campaign = { empire: e, since: now, stage: 'capture', orderedAt: now, troopShips: [], troopsSent: 0 };
                    rec.stats.campaigns++;
                }
                rec.campaign.stage = 'capture';
                w.captureBy = e.empireId;
                callOffStrikes(galaxy, e, base);
                // Troops already waiting near it land at the next step; more are sent when they fall short.
                const near = troopShipsInRange(galaxy, rec, e).reduce((a, b) => a + (b.troops?.totalAttackStrength ?? 0), 0);
                if (near + rec.campaign.troopsSent < troopsNeeded(galaxy, rec)) sendTroops(galaxy, rec, rec.campaign, base);
                rec.campaign.orderedAt = now;
            }
        } else {
            rec.stats.aiDestroy++;
            if (rec.campaign !== null && rec.campaign.empire === e) {
                rec.campaign.stage = 'destroy'; // no more landings; its troops already there fight on
                rec.campaign.troopShips = [];
                if (w.captureBy === e.empireId) delete w.captureBy;
            }
            sendStrikeAtBase(galaxy, w, e, base);
        }
    }
}

/** An AI campaign's next steps (every review). */
function stepCampaign(galaxy: Galaxy, w: GreatWorkRecord, rec: CaptureRec, base: BuiltObject, now: number): void {
    const c = rec.campaign;
    if (c === null) return;
    const e = c.empire;
    if (!e.active || isHumanEmpire(galaxy, e) || !isSmarterAIStrategist(galaxy, e) || base.actualEmpire === e) {
        endCampaign(galaxy, w, rec, base.actualEmpire === e ? 'it holds it' : 'no longer able', now);
        return;
    }
    c.troopShips = c.troopShips.filter((b) => !b.hasBeenDestroyed && b.actualEmpire === e && b.troops !== null && b.troops.count > 0);
    const open = rec.breachedAt >= 0;
    switch (c.stage) {
        case 'siege':
            if (open) {
                c.stage = 'breach';
                sendTroops(galaxy, rec, c, base);
                c.orderedAt = now;
                logGw(galaxy, now, `work ${w.id}: ${e.name} has broken its shields; troops on the way`);
            } else if (now - c.since > captureParam(galaxy, 'gwCaptureAiCampaignYears') * YEAR_LENGTH) {
                endCampaign(galaxy, w, rec, 'the shields held', now);
            } else if (!sendStrikeAtBase(galaxy, w, e, base) && now - c.orderedAt > YEAR_LENGTH) {
                endCampaign(galaxy, w, rec, 'no strike fleet', now);
            } else c.orderedAt = now;
            return;
        case 'breach':
            if (!open) {
                c.stage = 'siege';
                c.since = now;
                return;
            }
            sendStrikeAtBase(galaxy, w, e, base);
            if (c.troopShips.length === 0 && rec.invader !== e) sendTroops(galaxy, rec, c, base);
            return;
        case 'capture':
            if (rec.invader === e && rec.invaders.count > 0) return; // the ground war is on
            if (!rec.landingOpen) {
                if (!open) endCampaign(galaxy, w, rec, 'the window closed', now);
                return;
            }
            if (c.troopShips.length === 0) {
                if (sendTroops(galaxy, rec, c, base) <= 0 && now - c.orderedAt > days(120)) endCampaign(galaxy, w, rec, 'no troops', now);
                else c.orderedAt = now;
            }
            return;
        case 'destroy':
            if (!sendStrikeAtBase(galaxy, w, e, base) && now - c.orderedAt > YEAR_LENGTH) endCampaign(galaxy, w, rec, 'no strike fleet', now);
            else c.orderedAt = now;
            if (!open && now - c.since > captureParam(galaxy, 'gwCaptureAiCampaignYears') * YEAR_LENGTH) endCampaign(galaxy, w, rec, 'it held', now);
            return;
    }
}

/** New campaigns: an AI empire that values a work it can take goes for it (one campaign per work, one per empire). */
function considerCampaigns(galaxy: Galaxy, w: GreatWorkRecord, rec: CaptureRec, base: BuiltObject, now: number): void {
    if (rec.campaign !== null || rec.invader !== null) return;
    const every = days(captureParam(galaxy, 'gwCaptureAiReviewDays'));
    const st = captureState(galaxy);
    let best: { e: Empire; s: number } | null = null;
    for (const e of ordinaryEmpires(galaxy)) {
        if (isHumanEmpire(galaxy, e) || !isSmarterAIStrategist(galaxy, e)) continue;
        const next = rec.aiNext[e.empireId];
        if (next !== undefined && next > now) continue;
        rec.aiNext[e.empireId] = now + every + (e.empireId % 7) * GAME_DAY_LENGTH;
        if ((rec.cooldown[e.empireId] ?? -1) > now) continue;
        if (st.recs.some((r) => r.campaign !== null && r.campaign.empire === e)) continue;
        const s = aiSeizeScore(galaxy, w, rec, e);
        if (s === null || s < captureParam(galaxy, 'gwCaptureAiSeizePct') / 100) continue;
        if (best === null || s > best.s) best = { e, s };
    }
    if (best === null) return;
    const c: CaptureCampaign = { empire: best.e, since: now, stage: 'siege', orderedAt: now, troopShips: [], troopsSent: 0 };
    rec.campaign = c;
    rec.stats.campaigns++;
    const ok = sendStrikeAtBase(galaxy, w, best.e, base);
    logGw(galaxy, now, `work ${w.id}: ${best.e.name} sets out to take it (score ${best.s.toFixed(2)}${ok ? '' : ', no strike fleet yet'})`);
}

// ---------------------------------------------------------------------------------------------------------------
// The step
// ---------------------------------------------------------------------------------------------------------------

/** Where the work's base is now (the Ark ship for the Ark). */
function baseOf(w: GreatWorkRecord): BuiltObject | null {
    return w.base !== null && !w.base.hasBeenDestroyed ? w.base : null;
}

/** One work's step (every quarter day). */
export function stepCapture(galaxy: Galaxy, w: GreatWorkRecord, rec: CaptureRec, now: number): void {
    const base = baseOf(w);
    if (!capturableWork(w) || base === null) {
        if (rec.invaders.count > 0) {
            for (const t of rec.invaders.items) {
                const te = t.empire as Empire | null;
                if (te !== null && te.troops != null) te.troops.remove(t);
            }
            rec.invaders = new TroopList();
            rec.invader = null;
        }
        if (rec.campaign !== null) endCampaign(galaxy, w, rec, 'the work is gone', now);
        rec.base = null;
        return;
    }
    if (rec.base !== base) {
        rec.base = base;
        rec.plated = false;
    }
    if (!rec.plated) plate(galaxy, w, rec, base);
    const owner = base.actualEmpire;
    // A new holder by other means (boarding, an awakening): it raises its own garrison.
    if (owner !== null && rec.garrisonFor !== owner && rec.invaders.count === 0) raiseGarrison(galaxy, w, rec, owner);
    // The window: the shields broke (the Ark: its own module breaks them; troops land once it is at its escape system).
    // (A captured Ark is an empire's ship like any base: the capture's own schedule then.)
    const arkRec = w.wonder === 'ark' ? arkRecOf(galaxy, w.id) : null;
    const ark = arkRec !== null && arkRec.phase !== 'seized' && arkRec.phase !== 'lost' ? arkRec : null;
    if (ark === null && shieldBreakOf(galaxy, base) === null && shieldsDown(base) && rec.breachedAt < 0) breakShields(galaxy, base, captureParam(galaxy, 'gwCaptureRechargeDays'));
    const sched = shieldBreakOf(galaxy, base);
    if (sched !== null && rec.breachedAt < 0) {
        rec.breachedAt = now;
        rec.quiet = false;
        rec.plans = {};
        rec.stats.breaches++;
        if (ark === null) tellBreach(galaxy, w, base);
        logGw(galaxy, now, `work ${w.id}: shields broken (${Math.round(base.shieldsCapacity)}); the landing window is open for ${sched.days} days`);
    } else if (sched === null && rec.breachedAt >= 0) {
        rec.breachedAt = -1;
        rec.quiet = false;
        rec.plans = {};
        rec.troopers = {};
        rec.sparesTroopers = false;
        logGw(galaxy, now, `work ${w.id}: shields whole again; the landing window is closed`);
    }
    rec.landingOpen = rec.breachedAt >= 0 && (ark === null || (ark.breached && ark.phase === 'repairing'));
    governShields(galaxy, base, rec, now, sched !== null);
    rec.damagePct = damagePctOf(base);
    if (rec.breachedAt >= 0) {
        if (!rec.quiet && rec.damagePct >= captureParam(galaxy, 'gwCaptureQuietDamagePct')) {
            rec.quiet = true;
            rec.quietAt = now;
            rec.stats.quiet++;
            logGw(galaxy, now, `work ${w.id}: ${Math.round(rec.damagePct)}% damaged, its guns fall silent`);
            tellQuiet(galaxy, w, rec, base);
        }
        holdWeapons(galaxy, base, rec);
        scanRange(galaxy, base, rec);
    }
    // Landing: troops of the invaders that mean to land and are close enough.
    if (rec.landingOpen) {
        const byEmpire = new Map<Empire, BuiltObject[]>();
        for (const b of shipsWithin(galaxy, base.xpos, base.ypos, LAND_RANGE)) {
            if (b === base || b.troops === null || b.troops.count === 0) continue;
            const e = b.actualEmpire;
            if (e === null || !mayInvade(galaxy, rec, e) || !meansToLand(galaxy, rec, b, e)) continue;
            const list = byEmpire.get(e);
            if (list === undefined) byEmpire.set(e, [b]);
            else list.push(b);
        }
        for (const e of galaxy.empires) {
            const list = e === null ? undefined : byEmpire.get(e);
            if (list !== undefined && mayInvade(galaxy, rec, e) && readyToLand(galaxy, rec, e, list, sched)) landTroops(galaxy, w, rec, e, list);
        }
    }
    battleStep(galaxy, w, rec, now);
    // The garrison regrows while nobody fights on it.
    if (rec.invaders.count === 0 && owner !== null && rec.garrison.count < garrisonSize(galaxy, w.wonder) && now >= rec.regrowAt) {
        rec.garrison.add(garrisonTroop(galaxy, w, owner, rec.garrison.count));
        rec.regrowAt = now + days(captureParam(galaxy, 'gwCaptureGarrisonRegrowDays'));
    }
    for (const t of rec.garrison.items) if (t.readiness < 100 && rec.invaders.count === 0) t.readiness = Math.min(100, Math.fround(t.readiness + 1));
    // The AI (every AI_STEP_DAYS).
    if (!scenarioFlag(galaxy, SMARTER_AI_FLAG) || baseOf(w) === null || now - (rec.aiAt ?? -Infinity) < days(AI_STEP_DAYS)) return;
    rec.aiAt = now;
    if (rec.quiet) quietChoices(galaxy, w, rec, base, now);
    if (rec.campaign !== null && now - rec.campaign.orderedAt >= days(10)) stepCampaign(galaxy, w, rec, base, now);
    considerCampaigns(galaxy, w, rec, base, now);
}

/** The frame periodic: every finished work's step (records are made the first time a work is seen finished: old saves too). */
export function capturePeriodic(galaxy: Galaxy): void {
    const works = greatWorks(galaxy);
    if (works.length === 0) return;
    let st = peekCaptureState(galaxy);
    const now = galaxyStarDate(galaxy);
    for (const w of works) {
        let rec = st?.recs.find((r) => r.workId === w.id) ?? null;
        if (rec === null) {
            if (!capturableWork(w)) continue;
            st = captureState(galaxy);
            rec = newRec(w.id);
            st.recs.push(rec);
        }
        stepCapture(galaxy, w, rec, now);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Queries, events, the player's action
// ---------------------------------------------------------------------------------------------------------------

/** The stock shouldAttack query: a breached work's guns leave troop carriers alone while another hostile ship is in range. Pure. */
export function sparesTrooper(galaxy: Galaxy, bo: BuiltObject, target: BuiltObject): boolean {
    const st = peekCaptureState(galaxy);
    if (st === null || st.recs.length === 0) return false;
    for (const r of st.recs) {
        if (r.base !== bo) continue;
        return r.breachedAt >= 0 && r.sparesTroopers && isTroopCarrier(target);
    }
    return false;
}

/** The Compact's ships answer the attackers of a breached work (their whole fleet in range), as the Ark does in a fight. Pure. */
export function compactFightsBack(galaxy: Galaxy, empire: Empire, target: Empire): boolean {
    const st = peekCaptureState(galaxy);
    if (st === null || st.recs.length === 0 || !isCompact(galaxy, empire)) return false;
    for (const r of st.recs) if (r.breachedAt >= 0 && r.base !== null && r.base.actualEmpire === empire && hostileTo(galaxy, r, target)) return true;
    return false;
}

/** The works `empire`'s troops could land on near (x, y) (the troop Attack menu). Pure. */
export function invasionTargetsNear(galaxy: Galaxy, empire: Empire, x: number, y: number, range: number): BuiltObject[] {
    const st = peekCaptureState(galaxy);
    if (st === null) return [];
    const out: BuiltObject[] = [];
    for (const r of st.recs) {
        const b = r.base;
        if (b === null || b.hasBeenDestroyed || !r.landingOpen || !mayInvade(galaxy, r, empire)) continue;
        if (galaxy.calculateDistance(b.xpos, b.ypos, x, y) <= Math.max(range, b.size)) out.push(b);
    }
    return out;
}

function onAttacked(galaxy: Galaxy, bo: BuiltObject, attacker: Empire | null): void {
    if (attacker === null) return;
    const rec = captureRecOfBase(galaxy, bo);
    if (rec === null || bo.actualEmpire === attacker) return;
    rec.hostiles[attacker.empireId] = galaxyStarDate(galaxy);
}

export const INVADE_ACTION = 'giantworks.invade';

/** What the selection panel and the Ground Report show of a work's ground war (null: `bo` is no capturable work). Pure. */
export interface CaptureView {
    rec: CaptureRec;
    work: GreatWorkRecord;
    base: BuiltObject;
    defender: Empire | null;
    invader: Empire | null;
    breached: boolean;
    landingOpen: boolean;
    quiet: boolean;
    /** Days until the shields are whole (the window closes); -1 when whole. */
    windowDays: number;
    canInvade: boolean;
}

export function captureView(galaxy: Galaxy, bo: BuiltObject | null | undefined, viewer: Empire | null): CaptureView | null {
    const rec = captureRecOfBase(galaxy, bo);
    if (rec === null || rec.base === null) return null;
    const work = workOf(galaxy, rec);
    if (work === null || !capturableWork(work)) return null;
    const sched = shieldBreakOf(galaxy, rec.base);
    const windowDays = sched === null ? -1 : Math.max(0, Math.ceil((sched.brokenAt + days(sched.days) - galaxyStarDate(galaxy)) / GAME_DAY_LENGTH));
    return {
        rec,
        work,
        base: rec.base,
        defender: rec.base.actualEmpire,
        invader: rec.invader,
        breached: rec.breachedAt >= 0,
        landingOpen: rec.landingOpen,
        quiet: rec.quiet,
        windowDays,
        canInvade: viewer !== null && rec.landingOpen && mayInvade(galaxy, rec, viewer) && troopShipsInRange(galaxy, rec, viewer).length > 0,
    };
}

export function registerCapture(): void {
    registerScenarioFramePeriodic({ id: 'giantworks.capture.step', flag: GW_FLAG, periodDays: 0.25, order: 23, run: (g) => capturePeriodic(g) });
    registerScenarioEvent({ id: 'giantworks.capture.attacked', flag: GW_FLAG, event: 'builtObjectAttacked', run: (g, e) => onAttacked(g, e.builtObject, e.attackingEmpire) });
    registerScenarioQuery({ id: 'giantworks.capture.spares', flag: GW_FLAG, query: 'builtObjectSparesStaticTarget', run: (g, v, a) => v || sparesTrooper(g, a.builtObject, a.target) });
    registerScenarioQuery({ id: 'giantworks.capture.fights', flag: GW_FLAG, query: 'attackWithoutWar', run: (g, v, a) => v || compactFightsBack(g, a.empire, a.target) });
    registerScenarioQuery({ id: 'giantworks.capture.targets', flag: GW_FLAG, query: 'virtualInvasionTargets', run: (g, v, a) => [...v, ...invasionTargetsNear(g, a.empire, a.x, a.y, a.range)] });
    // The Compact never sells a Great Work (or its scaffold) in a trade deal: taking it is a ground war (or boarding), not a purchase.
    registerScenarioQuery({ id: 'giantworks.capture.noTrade', flag: GW_FLAG, query: 'baseTradeable', run: (g, v, a) => v && !(isCompact(g, a.giver) && greatWorks(g).some((w) => w.base === a.base)) });
    registerThreatAction(INVADE_ACTION, {
        available: (g, e, target) => scenarioFlag(g, GW_FLAG) && captureView(g, target as BuiltObject, e)?.canInvade === true,
        run: (g, e, target) => {
            const v = captureView(g, target as BuiltObject, e);
            if (v === null || !v.canInvade) return false;
            return landTroops(g, v.work, v.rec, e, troopShipsInRange(g, v.rec, e)) > 0;
        },
        label: () => scenarioText(`${TAG} Capture Action Invade`),
    });
}

export const CAPTURE_HANDLER_IDS = ['giantworks.capture.step', 'giantworks.capture.attacked'] as const;
export const CAPTURE_QUERY_IDS = ['giantworks.capture.spares', 'giantworks.capture.fights', 'giantworks.capture.targets', 'giantworks.capture.noTrade'] as const;

registerCapture();
