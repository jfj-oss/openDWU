// Veterans (scenarios/veterans, flag veterans; a user-designed gameplay change, off by default, set on the new-game
// wizard's Other Empires page). Not a port.
//
// What the original already has (left as it is): captains / admirals / generals with skills grown by battles
// (characters.ts), troops whose attack / defend strengths grow permanently after a won ground battle
// (combat/invasion.ts defendersGainExperience and the conquest branch, scaled by the TroopExperienceGain skill) and
// shown as Green / Experienced / Veteran / Elite in the troop lists (ui/screens/troops.ts troopStrengthDescription),
// troop readiness (wear and recovery), and Bacon's crew level from career damage (construction/repair.ts
// calculateCrewLevel: faster self-repair, resale price; its ApplyCrewExperience stat boosts are not ported). None of
// them is a per-unit battle record with combat bonuses; this adds one:
//
// - Warships (role Military) gain experience for every battle they survive in which they dealt at least
//   veteranShipMinBattleDamage damage: 1 + floor(damage / veteranShipDamagePerXp), at most veteranShipXpPerBattleCap.
//   A battle is a run of days in which the ship dealt damage (its BattleStats + CareerBattleStats weapon damage),
//   closed by the first daily review in which it dealt none.
// - Troop units gain veteranTroopXpWin for each ground battle their side wins, veteranTroopXpSurvive for one they
//   survive without winning (another empire's troops on a conquered planet).
// - Ranks Green (0) → Regular → Veteran → Elite at the *RegularXp / *VeteranXp / *EliteXp thresholds. Ships: +bonus
//   per rank (capped) to weapon damage, targeting and evasion (weapons.ts captain-bonus multipliers); troops: +bonus
//   per rank, strength-weighted over a side's units, as the "Veteran troops" invasion modifier.
// - Records: a warship's in scenario.state.veterans.ships keyed by the ship (dropped at its teardown), a troop
//   unit's as Troop.veteran (absent until it first earns something). Both are saved, die with the unit and survive
//   refits and troop transfers (the same object). A captured ship loses it. The original has no troop merging.
// - AI: veteran ships weigh a losing fight more heavily (combat/threats.ts checkBattleOverwhelming: the withdrawal
//   value / (1 + veteranAiCautionPerRank × rank)), and AI invasion troop estimates (fleets/militaryAI.ts
//   determineRequiredTroopStrength) scale by both sides' troop ranks.
// - Named veteran ships: a warship reaching veteranNameRank (Veteran) whose name is only generic ("Hunter 012": a design
//   name and a build number) is given a ship name (galaxy.selectRandomUniqueMilitaryShipName: the only Rnd, and only
//   in this add-on). It keeps a short service record in its VeteranShipRecord (battles, notable battles with where and
//   when; kills come from its BattleStats; years from dateBuilt), shown on its selection info and its Ships screen
//   tooltip. When such a ship is destroyed its owner (if human) gets a message ("ISS Defiant was lost at X after 14 battles").
// - Flagships: each fleet of two or more warships has a flagship (scenario.state.veterans.flagships, a Map keyed by the
//   ShipGroup): by default the highest-ranked, then the strongest ship; the player's "Make flagship" command (a free
//   selection-panel slot, ui/flagshipSlots.ts) sets it by hand. Fleet ships within flagshipRange of it get
//   +flagshipBonusPct% (the same damage / targeting / evasion factors as ranks). When it is destroyed the fleet is
//   disorganised for flagshipRecoveryDays: -flagshipLossPenaltyPct% on those factors for every ship of the fleet, no
//   proximity bonus; a new flagship is chosen at the next daily review and the fleet "reforms". The AI weighs it a
//   little: a damaged AI flagship withdraws a little sooner (flagshipAiCautionPct, with the rank caution), and enemy
//   flagships weigh flagshipTargetPct% more as threats (combat/threats.ts determineThreatLevelBuiltObject).
// Rnd: only the naming above. Flag off (or no scenario): no record is ever created, so every multiplier is 1 and the stock path runs.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { BuiltObject } from '../../builtObject';
import type { Habitat } from '../../types';
import type { Troop, TroopList } from '../../cargo';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { tryGetText } from '../../textResolver';
import { isObjectVisibleToThisEmpire } from '../../independentTraders';
import { GAME_DAY_LENGTH, gameYear, registerScenarioEvent, registerScenarioFramePeriodic } from '../hooks';
import { scenarioFlag, scenarioParam, scenarioState } from '../state';
import { scenarioMessage } from '../messages';
import { EmpireMessageType } from '../../messages';
import { isHumanEmpire } from '../../humanEmpires';
import { galaxyStarDate } from '../../tick/simTime';
import { YEAR_LENGTH } from '../../galaxyTime';
import { ShipGroup, empireShipGroups } from '../../fleets/shipGroup';

export const VETERANS_FLAG = 'veterans';
export const VETERANS_ADDON_ID = 'veterans';

/** A warship's record (BuiltObject.veteran). */
export interface VeteranShipRecord {
    /** Experience. */
    xp: number;
    /** Battles survived that counted. */
    battles: number;
    /** 0 Green … 3 Elite. */
    rank: number;
    /** Weapon damage / targeting / evasion bonus as a fraction (0.05 = +5%). */
    bonus: number;
    /** Weapon damage dealt (BattleStats + CareerBattleStats) at the last review. */
    seen: number;
    /** Damage dealt in the battle under way (0 = none). */
    pending: number;
    /** Ships and bases destroyed so far (BattleStats + CareerBattleStats) at the last review. */
    kills?: number;
    /** Kills in the battle under way. */
    pendingKills?: number;
    /** The system it fought in during the battle under way (name). */
    where?: string;
    /** Notable battles ("Aldebaran, 2412"), the latest few. */
    notable?: string[];
    /** The generic name it had before the add-on named it. */
    wasNamed?: string;
}

/** A fleet's flagship (VeteransState.flagships). */
export interface FlagshipRecord {
    /** The flagship; null while the fleet has none (lost, until the next daily review picks one). */
    ship: BuiltObject | null;
    /** Chosen by the player (kept while it lives and stays in the fleet). */
    manual: boolean;
    /** Star date the fleet's disorganisation ends (0 = none). */
    penaltyUntil: number;
    /** Name of the flagship that was lost (for the reform message). */
    lost?: string;
}

/** A troop unit's record (Troop.veteran). */
export interface VeteranTroopRecord {
    xp: number;
    battles: number;
    rank: number;
}

/**
 * Saved add-on state (scenario.state.veterans, only in games with the add-on): the warship records (a Map keyed by
 * the ship, so no field is added to BuiltObject — the hottest class — and an entry goes with its ship) and each
 * empire's troop pool mean rank (by attack strength), refreshed daily (the AI estimate's input).
 */
export interface VeteransState {
    ships: Map<BuiltObject, VeteranShipRecord>;
    /** Each fleet's flagship (fleets of two or more warships). */
    flagships: Map<ShipGroup, FlagshipRecord>;
    /** empireId → mean rank. */
    ownRank: Record<number, number>;
}

export function veteransState(galaxy: Galaxy): VeteransState {
    return scenarioState<VeteransState>(galaxy, 'veterans', () => ({ ships: new Map(), flagships: new Map(), ownRank: {} }));
}

/** The state if it exists (never creates it: other add-on games stay untouched). */
function peekState(galaxy: Galaxy): VeteransState | undefined {
    return galaxy.scenario === null ? undefined : (galaxy.scenario.state.veterans as VeteransState | undefined);
}

/** `bo`'s record, if it has one. */
export function veteranShipRecord(galaxy: Galaxy, bo: BuiltObject): VeteranShipRecord | undefined {
    return peekState(galaxy)?.ships.get(bo);
}

/** Hot path (weapons.ts): `bo`'s damage / targeting / evasion bonus fraction (0 without a record or the add-on). */
export function veteranShipBonusOf(galaxy: Galaxy, bo: BuiltObject): number {
    const st = peekState(galaxy);
    if (st === undefined) return 0;
    const r = st.ships.get(bo);
    let bonus = r === undefined ? 0 : r.bonus;
    if (st.flagships.size > 0 && bo.shipGroup !== null) {
        const f = st.flagships.get(bo.shipGroup as ShipGroup);
        if (f !== undefined) {
            if (f.penaltyUntil > 0) bonus -= scenarioParam(galaxy, 'flagshipLossPenaltyPct', 10) / 100;
            else if (f.ship !== null && f.ship !== bo && !f.ship.hasBeenDestroyed) {
                const dx = f.ship.xpos - bo.xpos;
                const dy = f.ship.ypos - bo.ypos;
                const range = scenarioParam(galaxy, 'flagshipRange', 3000);
                if (dx * dx + dy * dy <= range * range) bonus += scenarioParam(galaxy, 'flagshipBonusPct', 3) / 100;
            }
        }
    }
    return bonus;
}

export function veteransOn(galaxy: Galaxy): boolean {
    return galaxy.scenario !== null && scenarioFlag(galaxy, VETERANS_FLAG);
}

/** Rank 0-3 for `xp` against the regular / veteran / elite thresholds. */
export function veteranRank(xp: number, regular: number, veteran: number, elite: number): number {
    if (xp >= elite) return 3;
    if (xp >= veteran) return 2;
    if (xp >= regular) return 1;
    return 0;
}

function shipRank(galaxy: Galaxy, xp: number): number {
    return veteranRank(xp, scenarioParam(galaxy, 'veteranShipRegularXp', 3), scenarioParam(galaxy, 'veteranShipVeteranXp', 8), scenarioParam(galaxy, 'veteranShipEliteXp', 16));
}

function troopRank(galaxy: Galaxy, xp: number): number {
    return veteranRank(xp, scenarioParam(galaxy, 'veteranTroopRegularXp', 2), scenarioParam(galaxy, 'veteranTroopVeteranXp', 6), scenarioParam(galaxy, 'veteranTroopEliteXp', 12));
}

/** The ship bonus fraction for `rank`: min(cap, perRank × rank) / 100. */
export function veteranShipBonus(galaxy: Galaxy, rank: number): number {
    const pct = Math.min(scenarioParam(galaxy, 'veteranShipBonusCapPct', 15), scenarioParam(galaxy, 'veteranShipBonusPerRankPct', 5) * rank);
    return Math.max(0, pct) / 100;
}

/** Most experience worth keeping (the Elite threshold): further battles are still counted. */
function shipXpMax(galaxy: Galaxy): number {
    return Math.max(scenarioParam(galaxy, 'veteranShipEliteXp', 16), 1);
}

interface DamageStats {
    weaponsDamageToEnemy: number;
}

/** Weapon damage `bo` has dealt so far: the running BattleStats plus the CareerBattleStats it is folded into. */
export function shipDamageDealt(bo: BuiltObject): number {
    const b = bo.battleStats as DamageStats | null;
    const c = bo.careerBattleStats as DamageStats | null;
    return (b !== null ? b.weaponsDamageToEnemy : 0) + (c !== null ? c.weaponsDamageToEnemy : 0);
}

/** Ships and bases `bo` has destroyed so far (BattleStats + CareerBattleStats; fighters' kills not counted). */
export function shipKills(bo: BuiltObject): number {
    let n = 0;
    for (const x of [bo.battleStats, bo.careerBattleStats]) {
        const b = x as Record<string, number> | null;
        if (b === null) continue;
        n += b.destroyedEnemyShipsSpaceport + b.destroyedEnemyShipsDefensiveBase + b.destroyedEnemyShipsOtherBase + b.destroyedEnemyShipsCarrier +
            b.destroyedEnemyShipsTroopTransport + b.destroyedEnemyShipsCapitalShip + b.destroyedEnemyShipsCruiser + b.destroyedEnemyShipsDestroyer +
            b.destroyedEnemyShipsFrigate + b.destroyedEnemyShipsEscort + b.destroyedEnemyShipsResupplyShip + b.destroyedEnemyShipsOtherShips;
    }
    return n;
}

/** Experience one battle with `damage` dealt is worth. */
export function shipBattleXp(galaxy: Galaxy, damage: number): number {
    if (damage < scenarioParam(galaxy, 'veteranShipMinBattleDamage', 50)) return 0;
    const per = Math.max(1, scenarioParam(galaxy, 'veteranShipDamagePerXp', 1500));
    return Math.min(scenarioParam(galaxy, 'veteranShipXpPerBattleCap', 3), 1 + Math.floor(damage / per));
}

/** Credits `bo` with a survived battle worth `xp` (rank and bonus follow). */
export function grantShipXp(galaxy: Galaxy, bo: BuiltObject, xp: number): void {
    const ships = veteransState(galaxy).ships;
    let r = ships.get(bo);
    if (r === undefined) ships.set(bo, (r = { xp: 0, battles: 0, rank: 0, bonus: 0, seen: shipDamageDealt(bo), pending: 0 }));
    r.battles++;
    r.xp = Math.min(shipXpMax(galaxy), r.xp + xp);
    r.rank = shipRank(galaxy, r.xp);
    r.bonus = veteranShipBonus(galaxy, r.rank);
    if (r.rank >= scenarioParam(galaxy, 'veteranNameRank', 2)) nameVeteranShip(galaxy, bo, r);
}

/** A name that is only a design name and a build number ("Hunter 012"). */
export function isGenericShipName(name: string): boolean {
    return /\s\d{1,4}$/.test(name.trim());
}

/** A ship reaching the naming rank with only a generic name gets a ship name (once). */
function nameVeteranShip(galaxy: Galaxy, bo: BuiltObject, r: VeteranShipRecord): void {
    if (r.wasNamed !== undefined || !isGenericShipName(bo.name)) return;
    const old = bo.name;
    r.wasNamed = old;
    bo.name = galaxy.selectRandomUniqueMilitaryShipName(null, bo.empire, bo.subRole);
    if (bo.empire !== null && isHumanEmpire(galaxy, bo.empire)) {
        scenarioMessage(galaxy, bo.empire, 'Veteran ship', `${old} has earned a name: ${bo.name}.`, { type: EmpireMessageType.GeneralGoodEvent, subject: bo, popup: false });
    }
}

/** The short service record of a ship at the naming rank or above, else null (selection info, Ships screen tooltip). */
export function veteranServiceRecord(galaxy: Galaxy, bo: BuiltObject): string | null {
    const r = veteranShipRecord(galaxy, bo);
    if (r === undefined || r.rank < scenarioParam(galaxy, 'veteranNameRank', 2) || r.battles <= 0) return null;
    const kills = Math.max(r.kills ?? 0, shipKills(bo));
    let t = `${bo.name}: ${veteranRankName(r.rank)}, ${battlesText(r.battles)}, ${kills} kill${kills === 1 ? '' : 's'}`;
    if (bo.dateBuilt > 0) {
        const years = Math.max(0, Math.floor((galaxyStarDate(galaxy) - bo.dateBuilt) / YEAR_LENGTH));
        t += `, ${years} year${years === 1 ? '' : 's'} in service`;
    }
    if (r.wasNamed !== undefined) t += ` (formerly ${r.wasNamed})`;
    if (r.notable !== undefined && r.notable.length > 0) t += `. Notable battles: ${r.notable.join('; ')}`;
    return t;
}

/**
 * The daily review: each warship that dealt damage since the last review is in a battle (its damage adds up); one
 * that dealt none while a battle was under way survived it and is credited. Ships that never fired get no record.
 */
export function veteransShipReview(galaxy: Galaxy): void {
    if (!veteransOn(galaxy)) return;
    const ships = veteransState(galaxy).ships;
    // A destroyed (or torn-down) ship's record goes with it.
    for (const bo of [...ships.keys()]) if (bo.hasBeenDestroyed || bo.role !== BuiltObjectRole.Military) ships.delete(bo);
    const list = galaxy.builtObjects;
    for (let i = 0; i < list.length; i++) {
        const bo = list[i];
        if (bo === null || bo.hasBeenDestroyed || bo.role !== BuiltObjectRole.Military) continue;
        const total = shipDamageDealt(bo);
        let r = ships.get(bo);
        if (r === undefined) {
            if (!(total > 0)) continue;
            ships.set(bo, (r = { xp: 0, battles: 0, rank: 0, bonus: 0, seen: 0, pending: 0 }));
        }
        const delta = total - r.seen;
        const kills = shipKills(bo);
        if (kills > (r.kills ?? 0)) r.pendingKills = (r.pendingKills ?? 0) + kills - (r.kills ?? 0);
        r.kills = kills;
        if (delta > 0.5) {
            r.pending += delta;
            r.seen = total;
            if (bo.nearestSystemStar !== null) r.where = bo.nearestSystemStar.name;
            continue;
        }
        if (delta < 0) r.seen = total; // float folding (AddLatestCombatStats) may shave a fraction
        if (r.pending > 0) {
            const xp = shipBattleXp(galaxy, r.pending);
            r.pending = 0;
            if (xp > 0) {
                // A heavy fight (the most experience a battle gives) or two kills is worth remembering.
                if (xp >= scenarioParam(galaxy, 'veteranShipXpPerBattleCap', 3) || (r.pendingKills ?? 0) >= 2) {
                    const note = `${r.where ?? 'deep space'}, ${gameYear(galaxyStarDate(galaxy))}`;
                    r.notable = [...(r.notable ?? []), note].slice(-3);
                }
                grantShipXp(galaxy, bo, xp);
            }
            delete r.pendingKills;
        }
    }
}

/** The daily troop-pool review: each empire's mean troop rank (0 entries are left out). */
export function veteransTroopPoolReview(galaxy: Galaxy): void {
    if (!veteransOn(galaxy)) return;
    const own: Record<number, number> = {};
    for (const e of galaxy.empires) {
        if (e.troops === null) continue;
        const m = meanTroopRank(e.troops.items, true);
        if (m > 0) own[e.empireId] = m;
    }
    veteransState(galaxy).ownRank = own;
}

registerScenarioFramePeriodic({
    id: 'veterans.daily',
    flag: VETERANS_FLAG,
    periodDays: 1,
    run: (g) => {
        veteransShipReview(g);
        veteransTroopPoolReview(g);
        veteransFlagshipReview(g);
    },
});

// A veteran or flagship destroyed: the owner is told; a flagship's fleet is disorganised until it reforms. (Runs at the
// top of the teardown, before builtObjectRemoved drops the record and the ship leaves its fleet.)
registerScenarioEvent({
    id: 'veterans.destroyed',
    flag: VETERANS_FLAG,
    event: 'builtObjectDestroyed',
    run: (g, { builtObject }) => shipDestroyed(g, builtObject),
});

// A captured ship's crew is not the captor's.
registerScenarioEvent({
    id: 'veterans.captured',
    flag: VETERANS_FLAG,
    event: 'builtObjectOwnerChanged',
    run: (g, { builtObject, to }) => {
        if (to !== null) peekState(g)?.ships.delete(builtObject);
    },
});

// Torn down (destroyed, scrapped, retired): the record goes with the ship.
registerScenarioEvent({
    id: 'veterans.removed',
    flag: VETERANS_FLAG,
    event: 'builtObjectRemoved',
    run: (g, { builtObject }) => {
        peekState(g)?.ships.delete(builtObject);
    },
});

// ---------------------------------------------------------------------------------------------------------------
// Troops
// ---------------------------------------------------------------------------------------------------------------

/** Adds `xp` (and a battle) to every live unit of `troops`. */
export function grantTroopXp(galaxy: Galaxy, troops: Iterable<Troop | null>, xp: number): void {
    if (xp <= 0) return;
    for (const t of troops) {
        if (t == null || !(t.readiness > 0)) continue;
        const r = t.veteran ?? (t.veteran = { xp: 0, battles: 0, rank: 0 });
        r.battles++;
        r.xp = Math.min(Math.max(scenarioParam(galaxy, 'veteranTroopEliteXp', 12), 1), r.xp + xp);
        r.rank = troopRank(galaxy, r.xp);
    }
}

/**
 * A ground battle ended (combat/invasion.ts): `won` units are on the winning side, `survived` (optional) took part
 * and live but did not win. No-op with the flag off.
 */
export function veteransGroundBattleEnded(galaxy: Galaxy, won: Iterable<Troop | null> | null, survived: Iterable<Troop | null> | null = null): void {
    if (!veteransOn(galaxy)) return;
    if (won !== null) grantTroopXp(galaxy, won, scenarioParam(galaxy, 'veteranTroopXpWin', 2));
    if (survived !== null) grantTroopXp(galaxy, survived, scenarioParam(galaxy, 'veteranTroopXpSurvive', 1));
}

/** Strength-weighted mean rank of `troops` (attack or defend strength × readiness). */
export function meanTroopRank(troops: readonly (Troop | null)[], attack: boolean): number {
    let w = 0;
    let s = 0;
    for (const t of troops) {
        if (t == null) continue;
        const k = (attack ? t.attackStrength : t.defendStrength) * t.readiness;
        if (!(k > 0)) continue;
        w += k;
        if (t.veteran !== undefined) s += k * t.veteran.rank;
    }
    return w > 0 ? s / w : 0;
}

/** The side bonus for a mean rank: perRank% × rank, rounded to 0.01. */
export function troopRankBonus(galaxy: Galaxy, mean: number): number {
    return Math.round(mean * scenarioParam(galaxy, 'veteranTroopBonusPerRankPct', 10)) / 100;
}

/** determineTroopModifiers (end): "Veteran troops" for each side whose units have ranks. Pure; flag off = nothing. */
export function veteranTroopModifiers(galaxy: Galaxy, defendingTroops: TroopList | null, attackingTroops: TroopList | null, defend: { amounts: number[]; reasons: string[] }, attack: { amounts: number[]; reasons: string[] }): void {
    if (!veteransOn(galaxy)) return;
    const reason = tryGetText('Veterans Troops') ?? 'Veteran troops';
    if (defendingTroops !== null) {
        const b = troopRankBonus(galaxy, meanTroopRank(defendingTroops.items, false));
        if (b > 0) {
            defend.amounts.push(b);
            defend.reasons.push(reason);
        }
    }
    if (attackingTroops !== null) {
        const b = troopRankBonus(galaxy, meanTroopRank(attackingTroops.items, true));
        if (b > 0) {
            attack.amounts.push(b);
            attack.reasons.push(reason);
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Flagships
// ---------------------------------------------------------------------------------------------------------------

function flagshipRecord(galaxy: Galaxy, sg: ShipGroup): FlagshipRecord | undefined {
    return peekState(galaxy)?.flagships.get(sg);
}

/** `bo`'s fleet, if it is a ShipGroup. */
function fleetOf(bo: BuiltObject): ShipGroup | null {
    return bo.shipGroup instanceof ShipGroup ? bo.shipGroup : null;
}

/** The fleet's flagship (null: none, or the add-on is off). */
export function fleetFlagship(galaxy: Galaxy, sg: ShipGroup): BuiltObject | null {
    return flagshipRecord(galaxy, sg)?.ship ?? null;
}

/** True when `bo` is the flagship of its fleet. */
export function isFlagship(galaxy: Galaxy, bo: BuiltObject): boolean {
    const g = fleetOf(bo);
    return g !== null && flagshipRecord(galaxy, g)?.ship === bo;
}

/** Days left of the fleet's disorganisation after losing its flagship (0 = none). */
export function flagshipRecoveryDaysLeft(galaxy: Galaxy, sg: ShipGroup): number {
    const f = flagshipRecord(galaxy, sg);
    if (f === undefined || f.penaltyUntil <= 0) return 0;
    return Math.max(1, Math.ceil((f.penaltyUntil - galaxyStarDate(galaxy)) / GAME_DAY_LENGTH));
}

/** Selection info / Fleets screen: "ISS Defiant" / "ISS Defiant (fleet disorganised: 23 days)" / null (none). */
export function fleetFlagshipLabel(galaxy: Galaxy, sg: ShipGroup): string | null {
    const f = flagshipRecord(galaxy, sg);
    if (f === undefined) return null;
    const left = flagshipRecoveryDaysLeft(galaxy, sg);
    if (f.ship === null) return left > 0 ? `lost, the fleet reforms (${left} day${left === 1 ? '' : 's'})` : null;
    return left > 0 ? `${f.ship.name} (new; the fleet is reforming: ${left} day${left === 1 ? '' : 's'})` : f.ship.name;
}

/** Candidates: live warships of the fleet, best first (rank, then firepower, then size). */
function flagshipScore(galaxy: Galaxy, bo: BuiltObject): number {
    const r = veteranShipRecord(galaxy, bo);
    return (r !== undefined ? r.rank : 0) * 1e9 + bo.firepowerRaw * 1000 + bo.size;
}

function flagshipEligible(bo: BuiltObject | null | undefined): bo is BuiltObject {
    return bo != null && !bo.hasBeenDestroyed && bo.role === BuiltObjectRole.Military;
}

function bestFlagship(galaxy: Galaxy, sg: ShipGroup): BuiltObject | null {
    let best: BuiltObject | null = null;
    let bs = -1;
    for (const b of sg.ships) {
        if (!flagshipEligible(b)) continue;
        const sc = flagshipScore(galaxy, b);
        if (sc > bs) {
            bs = sc;
            best = b;
        }
    }
    return best;
}

/**
 * The daily flagship review: fleets of two or more warships get a flagship (the best, or the player's choice while it
 * lives), a fleet that lost its flagship picks a new one and, once the recovery period is over, "reforms". Entries of
 * fleets that no longer exist (or shrank to one ship) are dropped.
 */
export function veteransFlagshipReview(galaxy: Galaxy): void {
    if (!veteransOn(galaxy)) return;
    const st = veteransState(galaxy);
    const now = galaxyStarDate(galaxy);
    for (const [g, f] of [...st.flagships]) {
        if (g.ships.filter(flagshipEligible).length < 2 || g.empire === null) st.flagships.delete(g);
        else if (f.penaltyUntil > 0 && now >= f.penaltyUntil) {
            f.penaltyUntil = 0;
            if (isHumanEmpire(galaxy, g.empire)) {
                scenarioMessage(galaxy, g.empire, 'Fleet reformed', `${g.name ?? 'The fleet'} has reformed${f.ship !== null ? ` under ${f.ship.name}` : ''} and fights at full strength again.`, { type: EmpireMessageType.GeneralGoodEvent, subject: g, popup: false });
            }
            delete f.lost;
        }
    }
    for (const e of galaxy.empires) {
        for (const g of empireShipGroups(e)) {
            if (g === null || g.ships.length < 2) continue;
            let f = st.flagships.get(g);
            const live = f !== undefined && f.ship !== null && !f.ship.hasBeenDestroyed && g.ships.includes(f.ship);
            if (f === undefined) {
                if (g.ships.filter(flagshipEligible).length < 2) continue;
                st.flagships.set(g, (f = { ship: bestFlagship(galaxy, g), manual: false, penaltyUntil: 0 }));
            } else if (!live) {
                f.ship = bestFlagship(galaxy, g);
                f.manual = false;
            } else if (!f.manual) {
                // A rank-up elsewhere in the fleet moves the flag only to a strictly higher rank (no flip-flopping).
                const best = bestFlagship(galaxy, g);
                const fr = veteranShipRecord(galaxy, f.ship!)?.rank ?? 0;
                const br = best !== null ? (veteranShipRecord(galaxy, best)?.rank ?? 0) : 0;
                if (best !== null && best !== f.ship && br > fr) f.ship = best;
            }
        }
    }
}

/**
 * A ship or base was destroyed (builtObjectDestroyed): its owner is told when it was a named / veteran ship; a fleet's
 * flagship starts the fleet's disorganisation (when other warships remain).
 */
function shipDestroyed(galaxy: Galaxy, bo: BuiltObject): void {
    const st = peekState(galaxy);
    if (st === undefined || bo.role !== BuiltObjectRole.Military) return;
    const r = st.ships.get(bo);
    const g = fleetOf(bo);
    const f = g !== null ? st.flagships.get(g) : undefined;
    const wasFlag = f !== undefined && f.ship === bo;
    const survivors = g !== null ? g.ships.filter((b) => b !== bo && flagshipEligible(b)).length : 0;
    const veteran = r !== undefined && r.rank >= scenarioParam(galaxy, 'veteranNameRank', 2) && r.battles > 0;
    const where = bo.nearestSystemStar?.name ?? r?.where ?? 'deep space';
    if (wasFlag && f !== undefined) {
        f.ship = null;
        f.manual = false;
        if (survivors > 0) {
            f.penaltyUntil = galaxyStarDate(galaxy) + scenarioParam(galaxy, 'flagshipRecoveryDays', 30) * GAME_DAY_LENGTH;
            f.lost = bo.name;
        }
    }
    const owner = bo.empire;
    if ((!veteran && !(wasFlag && survivors > 0)) || owner === null || !isHumanEmpire(galaxy, owner)) return;
    let text = `${bo.name} was lost at ${where}`;
    if (veteran && r !== undefined) text += ` after ${battlesText(r.battles)}`;
    text += '.';
    if (wasFlag && survivors > 0 && g !== null) {
        const days = scenarioParam(galaxy, 'flagshipRecoveryDays', 30);
        text += ` It was the flagship of ${g.name ?? 'its fleet'}: the fleet fights at -${scenarioParam(galaxy, 'flagshipLossPenaltyPct', 10)}% for ${days} days while it reforms.`;
    }
    scenarioMessage(galaxy, owner, wasFlag ? 'Flagship lost' : 'Veteran ship lost', text, { type: EmpireMessageType.GeneralBadEvent, subject: bo.nearestSystemStar ?? undefined, popup: false });
}

export interface FlagshipCommandResult {
    ok: boolean;
    message: string;
}

/** Why `ship` cannot be made its fleet's flagship (null: it can). */
export function makeFlagshipUnavailableReason(galaxy: Galaxy, empire: Empire, ship: BuiltObject): string | null {
    if (!veteransOn(galaxy)) return 'Veterans is off in this game';
    if (ship.empire !== empire) return 'Not your ship';
    const g = fleetOf(ship);
    if (g === null || g.ships.filter(flagshipEligible).length < 2) return 'Only a warship in a fleet of two or more can be a flagship';
    if (!flagshipEligible(ship)) return 'Only warships can be flagships';
    if (flagshipRecord(galaxy, g)?.ship === ship) return `${ship.name} already is the flagship`;
    return null;
}

/** Player command 'makeFlagship': `ship` becomes its fleet's flagship (kept while it lives and stays in the fleet). */
export function issueMakeFlagship(galaxy: Galaxy, empire: Empire, ship: BuiltObject): FlagshipCommandResult {
    const why = makeFlagshipUnavailableReason(galaxy, empire, ship);
    if (why !== null) return { ok: false, message: why };
    const g = fleetOf(ship)!;
    const st = veteransState(galaxy);
    const f = st.flagships.get(g);
    if (f === undefined) st.flagships.set(g, { ship, manual: true, penaltyUntil: 0 });
    else {
        f.ship = ship;
        f.manual = true;
    }
    return { ok: true, message: `${ship.name} is now the flagship of ${g.name ?? 'the fleet'}` };
}

/** Threat weighting (combat/threats.ts): an enemy flagship counts a little more (1 = stock). */
export function flagshipThreatFactor(galaxy: Galaxy, bo: BuiltObject): number {
    if (bo.shipGroup === null) return 1;
    const st = peekState(galaxy);
    if (st === undefined || st.flagships.size === 0) return 1;
    return st.flagships.get(bo.shipGroup as ShipGroup)?.ship === bo ? 1 + scenarioParam(galaxy, 'flagshipTargetPct', 15) / 100 : 1;
}

// ---------------------------------------------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------------------------------------------

/**
 * checkBattleOverwhelming: the withdrawal value divisor for a veteran ship (1 = stock). A small weight that only
 * applies to a ship already damaged in a fight it is losing: healthy veterans attack exactly as the stock AI does,
 * and fleets, invasions and strike missions are never called off by it (capped at +15%).
 */
export function veteranWithdrawFactor(galaxy: Galaxy, bo: BuiltObject): number {
    if (bo.damagedComponentCount <= 0 || !veteransOn(galaxy)) return 1;
    const r = veteranShipRecord(galaxy, bo);
    let w = r !== undefined && r.rank > 0 ? Math.min(0.15, Math.max(0, scenarioParam(galaxy, 'veteranAiCautionPerRank', 0.05)) * r.rank) : 0;
    // The AI also shields a damaged flagship a little (it keeps the fleet together).
    if (isFlagship(galaxy, bo)) w += Math.max(0, scenarioParam(galaxy, 'flagshipAiCautionPct', 5)) / 100;
    return 1 + w;
}

/**
 * determineRequiredTroopStrength: the troop strength `empire` plans to bring against `habitat`, scaled by the
 * defenders' rank bonus (when it can see them) over its own troops' (its whole troop pool), never above the stock
 * figure: veteran defenders only offset the AI's own veterans, so the war AI is never more cautious about invading
 * than the original. Pure.
 */
export function veteranRequiredTroopStrength(galaxy: Galaxy, empire: Empire | null, habitat: Habitat, required: number): number {
    if (!veteransOn(galaxy) || required <= 0) return required;
    const own = empire !== null ? troopRankBonus(galaxy, veteransState(galaxy).ownRank[empire.empireId] ?? 0) : 0;
    if (own === 0) return required; // nothing to offset: never above stock
    let def = 0;
    if (habitat.troops !== null && empire !== null && isObjectVisibleToThisEmpire(galaxy, empire, habitat)) def = troopRankBonus(galaxy, meanTroopRank(habitat.troops.items, false));
    return Math.min(required, Math.trunc((required * (1 + def)) / (1 + own)));
}

// ---------------------------------------------------------------------------------------------------------------
// Labels (UI)
// ---------------------------------------------------------------------------------------------------------------

const RANK_FALLBACK = ['Green', 'Regular', 'Veteran', 'Elite'];

export function veteranRankName(rank: number): string {
    const i = Math.max(0, Math.min(3, Math.trunc(rank)));
    return tryGetText(`Veterans Rank ${i}`) ?? RANK_FALLBACK[i];
}

function battlesText(n: number): string {
    return `${n} battle${n === 1 ? '' : 's'}`;
}

/** "Veteran (3 battles)" for a ship with a counted battle, else null. */
export function veteranShipLabel(galaxy: Galaxy, bo: BuiltObject): string | null {
    const r = veteranShipRecord(galaxy, bo);
    if (r === undefined || r.battles <= 0) return null;
    return `${veteranRankName(r.rank)} (${battlesText(r.battles)})`;
}

/** "Regular (1 battle)" for a troop unit with a counted battle, else null. */
export function veteranTroopLabel(t: Troop): string | null {
    const r = t.veteran;
    if (r === undefined || r.battles <= 0) return null;
    return `${veteranRankName(r.rank)} (${battlesText(r.battles)})`;
}
