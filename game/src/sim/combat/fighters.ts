// M4p — fighters and carriers (tasks/M4-plan.md §3.3 row M4p).
//
// Ports, statement for statement and in C# Galaxy.Rnd draw order:
//   FighterType.cs, FighterMissionType.cs, FighterSpecification.cs (+ the static list), FighterWeapon.cs (Fire, Reset),
//   FighterList.TotalSize,
//   Fighter.cs: ctor 187, DoTasks 256 (→ BaconFighter.DoTasks), ApplyLocationEffectsNEW 261, CheckCarrierDestroyed 440,
//     CompleteTeardown 448, ClearAllFighterMissionsForTarget 476, ReturnToCarrierForRepairs 502, DetermineAttackingFirepower 528,
//     HandleWeaponsFiring 668, ProvideBonusFromPirateBase 909, DoExplosions 1071, InflictDamage 1099/1104, DetermineHitTarget 1577,
//     UpdateMissionParameters 1657, PerformPatrol 1678, BoardCarrier 1733, CheckForCarrierBoarding 1746, DoMovement 1783,
//     ConsumeEnergy 1834, CalculateCurrentHeading 1846, ReduceAngle / IncreaseAngle 1901/1910, ReturnToCarrier 1919,
//     RandomHeadingOffset 1931/1936, CheckShouldFireAtCaptureTarget 1946, AssignAttackTarget 1977, WillMeetDestination 1997,
//     AccelerateToTargetSpeed 2036, GetCurrentTurnRate 2069/2074, RechargeEnergy 2092, RechargeShields 2101, RepairDamage 2114;
//   BaconFighter.cs: IsMyFighter 28, CalculateMaximumTargetRange 30, InflictDamageFighter 36, CheckForLevelGain 53,
//     GainFighterLevel 60, PayWhenFighterIsBuilt 101, GetCustomBomberPriceMultiplier 113, CheckReturnToCarrier 131, DoTasks 155,
//     CheckOutOfAmmo 186, ReturnToCarrierIfOutOfAmmo 218, AddWeaponToFighter 227, CloneFighterSpecification 248,
//     EvaluateThreats 283, PursueTarget 458, CheckBomberDefensiveFire 656, FireWeaponsAtTarget 704, AssignCAP 776,
//     ShouldAttack 796, EvaluateAdequateAttackers 844, AbandonAttackTarget 918;
//   BaconShipImageHelper.cs 13/31 ResolveNewFighterImageIndex / ResolveNewBomberImageIndex;
//   ResearchSystem.cs 1062/1073 IdentifyLatestFighterSpecification / IdentifyLatestBomberSpecification;
//   Galaxy.cs 1313 GetNextFighterID; Galaxy.3.cs 468 CalculateWarValue(Fighter), 517 InflictWarDamage(empire, Fighter);
//   Galaxy.7.cs 3506 DetermineThreatLevel(Fighter …);
//   carrier side: BuiltObject.cs 1786-1893 LaunchAvailableFighters / LaunchAvailableBombers / LaunchAllFighters / LaunchFighter /
//     ReturnFighters / ReturnBombers / BuildNewFighter / BuildNewBomber / BuildFighter, 4096 FireWeaponsAtFighter,
//     4274 FireAtNearbyFighters, 4362 CheckFightersAvailableForLaunch;
//     BaconBuiltObject.cs 3097 BuildBetterFighters, 3116 GetTotalFighterSizeOnCarrier, 3131 GetFighterCapacity,
//     3151 BuildNewFighters, 3218 BuildFighter, 3241 ManufactureRepairFighters, 3303 IsShipInSystemWithFriendlyColony,
//     3319 CheckForCustomGunship, 3337 GetCustomFighterDesigns, 5308 CheckFightersNeedUpgrading.
//
// Time: `time` is game ms (tick/simTime.ts); DateTime.MinValue = MIN_TIME; `.Ticks / 1e7` = `/ 1000`.
// Clock-seeded / hash-seeded `new Random()` in BaconFighter (CheckForLevelGain 55, GainFighterLevel 70 `new Random(Name.GetHashCode())`,
// AssignCAP 785) → Randoms derived from the galaxy seed without drawing galaxy.rnd (plan §0; cf. damage.ts baconCombatClockRnd).
// `BaconBuiltObject.myMain` (the UI Main) is non-null in any running game, as elsewhere in the port.
// BaconSettings.txt statics (fighterRangeMultiple, ammoExhaustChance*, ...) are read from `baconSettings` (sim/baconInitialize.ts).

import { checkTriggerEvent } from '../story/eventActions';
import { EventTriggerType } from '../story/gameEventModel';
import type { Galaxy } from '../galaxy';
import type { BuiltObject } from '../builtObject';
import type { Empire } from '../empire';
import type { Habitat } from '../types';
import { CreatureType } from '../creature';
import type { Fighter as FighterData } from '../data/fighters';
import { ComponentType } from '../data/components';
import { ComponentCategoryType } from '../data/policies';
import { BuiltObjectRole } from '../data/designSpecifications';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { TurnDirection } from '../builtObject';
import { resolveComponentCategory, componentImprovementFromComponent } from '../componentStatic';
import { ComponentStatus, csInt, toShort } from '../builtObjectComponent';
import { Random } from '../random';
import type { Cargo } from '../cargo';
import { BuiltObjectMissionType, builtObjectMission, isBuiltObject, isCreature, isHabitat, type StellarObject } from '../missions/mission';
import { MIN_TIME, INTERMEDIATE_PROCESSING_SPAN_MS, galaxyNow, galaxyStarDate, spanSeconds } from '../tick/simTime';
import { GalaxyLocationEffectType } from '../galaxyLocation';
import { DiplomaticRelationType } from '../diplomacy';
import { PirateRelationType, obtainPirateRelation } from '../pirateRelations';
import { setCivilityRating } from '../diplomacyTick';
import { captainBonuses, generateUniqueAgentName } from '../characters';
import { EmpireMessageType, sendMessageToEmpire } from '../messages';
import { EventMessageType, chanceNewFleetAdmiral, chanceNewShipCaptain, chanceRaceEvent, sendEventMessageToEmpire } from '../events';
import { doEmpireEncounter } from '../exploration';
import { SystemVisibilityStatus } from '../visibility';
import { checkHyperjumpPending } from '../movement';
import { getBuiltObjectsAtLocation } from '../stationPlacement';
import { conditionCheckLimit } from '../tick/builtObjectTick';
import { applyCorruptionToIncome } from '../logistics/orders';
import { completePirateMission } from '../pirates/missionsMarket';
import { PirateIncomeType } from '../pirates/pirateEconomy';
import { fastFindNearestIndependentHabitat } from '../pirates';
import { checkEmpireHasHyperDriveTech, totalMobileMilitaryFirepower } from '../forceStructure';
import { selectRandomNextResearchProjectExcludeSuperWeapons } from '../construction/constructionQueue';
import { doResearchBreakthrough, reviewDesignsBuiltObjectsImprovedComponents } from '../researchTick';
import { generateDesignFromSpec } from '../designGeneration';
import { generateAbandonedBuiltObject, getMonitoringStationDesignSpec } from '../gameStartTail';
import { findLonelyColonyLocation } from '../civilianAI';
import { determineAngle, checkOurEmpireBoarding, checkOurEmpireOverwhelmingBoarding, shouldAttack as builtObjectShouldAttack } from './attackAI';
import { THREAT_RANGE, STRIKE_RANGE_SQUARED, ATTACK_OVERMATCH_FACTOR, ATTACK_EVALUATION_RANGE_FACTOR, calculateOverallStrengthFactor, determineThreatLevel, doSuperPirateEmpireEncounter, shipGroupOf, type ThreatTarget } from './threats';
import {
    EXPLOSION_IMAGE_COUNT,
    DESTROY_SILVER_MIST_REPUTATION_BONUS,
    Explosion,
    battleStatsOf,
    baconIsMyShip,
    calculateBuiltObjectLootingValue,
    chanceAttackedPirateFactionJoinsPhantomPirates,
    checkWithinDistancePotential,
    empireColonyIncomeFactor,
    empireLootingFactor,
    fearfulPirateFactionJoinsPlayer,
    inflictDamageFull,
    inflictWarDamageBuiltObject,
    pirateFactionJoinsEmpire,
    type SpaceBattleStats,
} from './damage';
import {
    TORPEDO_WEAPON_HIT_RANGE,
    checkConventionalWeaponsAvailableToFireAtPassingThreats,
    determineHitTarget as builtObjectDetermineHitTarget,
    fireWeaponsAtTarget as builtObjectFireWeaponsAtTarget,
    modifyDiplomacyFromAttackBuiltObject,
    weaponFire,
    weaponIsAvailable,
} from './weapons';
import { baconSettings } from '../data/baconSettings';

// ---------------------------------------------------------------------------------------------------------------
// Constants (BaconFighter.cs 18-26, BaconBuiltObject.cs 71-79)
// ---------------------------------------------------------------------------------------------------------------

/** BaconFighter.cs 18 maximumTargetDistanceSquared. */
const MAXIMUM_TARGET_DISTANCE_SQUARED = 225.0;
/** BaconFighter.cs 20 starbaseFighterRangeMultiplier. */
const STARBASE_FIGHTER_RANGE_MULTIPLIER = 2.0;
/** BaconFighter.cs 21 myDamageMultiplier. */
const MY_DAMAGE_MULTIPLIER = 3.0;
// BaconSettings.txt statics (BaconFighter.cs 19 / 22-26, BaconBuiltObject.cs 71-75 / 79; set by BaconMain.cs 642-658 /
// 718 / 899-910 / 967 / 975): fighterRangeMultiple, ammoExhaustChance*, fighterBuildSpeedDivisor, fighterBuildCost,
// fighterOnBomberDamageMultiplier, the bay labels, limitNewFighterBuildToColonies and tailGunnerResearch are read from
// `baconSettings` at use time.
/** ShipImageHelper.cs 27 ShipSetFighterImageCount. */
const SHIP_SET_FIGHTER_IMAGE_COUNT = 2;
const F_0_7 = Math.fround(0.7);
const F_0_3 = Math.fround(0.3);
const F_0_5 = Math.fround(0.5);
const F_1_5 = Math.fround(1.5);
const F_PI = Math.fround(Math.PI);

// ---------------------------------------------------------------------------------------------------------------
// Enums (FighterType.cs, FighterMissionType.cs)
// ---------------------------------------------------------------------------------------------------------------

/** FighterType.cs (byte). */
export enum FighterType {
    Undefined,
    Interceptor,
    Bomber,
}

/** FighterMissionType.cs (byte). */
export enum FighterMissionType {
    Undefined,
    Attack,
    Patrol,
    ReturnToCarrier,
}

// ---------------------------------------------------------------------------------------------------------------
// FighterSpecification.cs
// ---------------------------------------------------------------------------------------------------------------

/** FighterSpecification.cs (the C# class; `short`/`float` fields as noted). */
export class FighterSpecification {
    fighterSpecificationId = 0;
    name = '';
    type: FighterType = FighterType.Undefined;
    size = 10; // short
    techLevel = 0; // double
    energyCapacity = 0; // short
    energyRechargeRate = 0; // float
    topSpeed = 0; // short
    topSpeedEnergyConsumptionRate = 0; // float
    accelerationRate = 0; // float
    turnRate = 0; // float
    engineExhaustImageIndex = 0;
    shieldsCapacity = 0; // short
    shieldRechargeRate = 0; // float
    damageRepairRate = 0; // short
    countermeasureModifier = 0; // short
    targettingModifier = 0; // short
    weaponType: ComponentType = ComponentType.Undefined;
    weaponImageIndex = 0;
    weaponDamage = 0; // short
    weaponRange = 0; // short
    weaponEnergyRequired = 0; // short
    weaponSpeed = 0; // short
    weaponDamageLoss = 0; // short
    weaponFireRate = 0; // short
    weaponSoundEffectFilename = '';
    /** [NonSerialized] SortTag (float). */
    sortTag = 0;
}

/** FighterSpecificationList.cs 44 LoadFromFile, per row: file Type 0/1 → Interceptor/Bomber, WeaponType 0/1/2 → Beam/Torpedo/Missile. */
function fighterSpecificationFromData(row: FighterData): FighterSpecification {
    const s = new FighterSpecification();
    s.fighterSpecificationId = row.fighterId;
    s.name = row.name;
    s.type = row.type === 0 ? FighterType.Interceptor : FighterType.Bomber;
    s.size = 10;
    s.techLevel = row.techLevel;
    s.energyCapacity = toShort(row.energyCapacity);
    s.energyRechargeRate = Math.fround(row.energyRechargeRate);
    s.topSpeed = toShort(row.topSpeed);
    s.topSpeedEnergyConsumptionRate = Math.fround(row.topSpeedEnergyConsumptionRate);
    s.accelerationRate = Math.fround(row.accelerationRate);
    s.turnRate = Math.fround(row.turnRate);
    s.engineExhaustImageIndex = row.engineExhaustImageIndex;
    s.shieldsCapacity = toShort(row.shieldsCapacity);
    s.shieldRechargeRate = Math.fround(row.shieldRechargeRate);
    s.damageRepairRate = toShort(row.damageRepairRate);
    s.countermeasureModifier = toShort(row.countermeasureModifier);
    s.targettingModifier = toShort(row.targetingModifier);
    s.weaponType = row.weaponType === 0 ? ComponentType.WeaponBeam : row.weaponType === 1 ? ComponentType.WeaponTorpedo : ComponentType.WeaponMissile;
    s.weaponImageIndex = row.weaponImageIndex;
    s.weaponDamage = toShort(row.weaponDamage);
    s.weaponRange = toShort(row.weaponRange);
    s.weaponEnergyRequired = toShort(row.weaponEnergyRequired);
    s.weaponSpeed = toShort(row.weaponSpeed);
    s.weaponDamageLoss = toShort(row.weaponDamageLoss);
    s.weaponFireRate = toShort(row.weaponFireRate);
    s.weaponSoundEffectFilename = row.weaponSoundEffectFilename;
    return s;
}

/** One FighterSpecification per static fighters.txt row (the C# list holds shared instances; Galaxy.FighterSpecificationsStatic). */
const specificationOfRow = new WeakMap<FighterData, FighterSpecification>();
export function specificationOf(row: FighterData): FighterSpecification {
    let s = specificationOfRow.get(row);
    if (s === undefined) {
        s = fighterSpecificationFromData(row);
        specificationOfRow.set(row, s);
    }
    return s;
}

/** Galaxy.FighterSpecificationsStatic[index] (sorted by id, FighterSpecificationList.cs 506 Sort). */
function fighterSpecificationsStatic(galaxy: Galaxy, index: number): FighterSpecification {
    const rows = galaxy.researchStatic !== null ? [...galaxy.researchStatic.fighters].sort((a, b) => a.fighterId - b.fighterId) : [];
    if (index >= rows.length) throw new Error(`Galaxy.FighterSpecificationsStatic[${index}]: index out of range`);
    return specificationOf(rows[index]);
}

/** ResearchSystem.cs 1062 IdentifyLatestFighterSpecification. */
export function identifyLatestFighterSpecification(empire: Empire): FighterSpecification | null {
    let fighterSpecification: FighterSpecification | null = null;
    const researched = empire.research.researchedFighters;
    for (let index = 0; index < researched.length; ++index) {
        const s = specificationOf(researched[index]);
        if (s.type === FighterType.Interceptor && (fighterSpecification === null || s.techLevel > fighterSpecification.techLevel)) fighterSpecification = s;
    }
    return fighterSpecification;
}

/** ResearchSystem.cs 1073 IdentifyLatestBomberSpecification. */
export function identifyLatestBomberSpecification(empire: Empire): FighterSpecification | null {
    let fighterSpecification: FighterSpecification | null = null;
    const researched = empire.research.researchedFighters;
    for (let index = 0; index < researched.length; ++index) {
        const s = specificationOf(researched[index]);
        if (s.type === FighterType.Bomber && (fighterSpecification === null || s.techLevel > fighterSpecification.techLevel)) fighterSpecification = s;
    }
    return fighterSpecification;
}

/** BaconFighter.cs 248 CloneFighterSpecification. */
export function cloneFighterSpecification(fighterSpecification: FighterSpecification): FighterSpecification {
    const s = new FighterSpecification();
    s.accelerationRate = fighterSpecification.accelerationRate;
    s.countermeasureModifier = fighterSpecification.countermeasureModifier;
    s.damageRepairRate = fighterSpecification.damageRepairRate;
    s.energyCapacity = fighterSpecification.energyCapacity;
    s.energyRechargeRate = fighterSpecification.energyRechargeRate;
    s.engineExhaustImageIndex = fighterSpecification.engineExhaustImageIndex;
    s.fighterSpecificationId = fighterSpecification.fighterSpecificationId;
    s.name = fighterSpecification.name;
    s.shieldRechargeRate = fighterSpecification.shieldRechargeRate;
    s.shieldsCapacity = fighterSpecification.shieldsCapacity;
    s.size = fighterSpecification.size;
    s.sortTag = fighterSpecification.sortTag;
    s.targettingModifier = fighterSpecification.targettingModifier;
    s.techLevel = fighterSpecification.techLevel;
    s.topSpeed = fighterSpecification.topSpeed;
    s.topSpeedEnergyConsumptionRate = fighterSpecification.topSpeedEnergyConsumptionRate;
    s.turnRate = fighterSpecification.turnRate;
    s.type = fighterSpecification.type;
    s.weaponDamage = fighterSpecification.weaponDamage;
    s.weaponDamageLoss = fighterSpecification.weaponDamageLoss;
    s.weaponEnergyRequired = fighterSpecification.weaponEnergyRequired;
    s.weaponFireRate = fighterSpecification.weaponFireRate;
    s.weaponImageIndex = fighterSpecification.weaponImageIndex;
    s.weaponRange = fighterSpecification.weaponRange;
    s.weaponSoundEffectFilename = fighterSpecification.weaponSoundEffectFilename;
    s.weaponSpeed = fighterSpecification.weaponSpeed;
    s.weaponType = fighterSpecification.weaponType;
    return s;
}

// ---------------------------------------------------------------------------------------------------------------
// FighterWeapon.cs
// ---------------------------------------------------------------------------------------------------------------

/** FighterWeapon.cs. */
export class FighterWeapon {
    power = 0; // float
    headingMissFactor = 0; // float
    /** LastFired (DateTime → game ms). */
    lastFired = MIN_TIME;
    distanceTravelled = -1; // float
    distanceFromTarget = Math.fround(2e9); // float
    willHitTarget = false;
    x = -1; // float
    y = -1; // float
    heading = 0; // float
    hasMissed = false;
    soundEffectPlayed = false;
    resetNext = false;
    category: ComponentCategoryType = ComponentCategoryType.WeaponBeam;
    type: ComponentType = ComponentType.WeaponBeam;
    specialImageIndex = 0; // byte
    rawDamage = 0; // short
    range = 0; // short
    energyRequired = 0; // short
    speed = 0; // short
    damageLoss = 0; // short
    fireRate = 0; // short

    /** FighterWeapon.cs 76 Reset. */
    reset(): void {
        this.distanceTravelled = -1;
        this.x = Math.fround(-2.00000013e9);
        this.y = Math.fround(-2.00000013e9);
        this.heading = 0;
        this.headingMissFactor = 0;
        this.distanceFromTarget = Math.fround(2e9);
        this.willHitTarget = false;
        this.hasMissed = false;
        this.power = 0;
        this.soundEffectPlayed = false;
        this.resetNext = false;
    }
}

/** A fighter's target: C# StellarObject (BuiltObject | Habitat | Creature | Fighter). */
export type FighterTarget = StellarObject | Fighter;

/**
 * FighterWeapon.cs 36 Fire(galaxy, firer, target, time, willHit, hitRangeChance).
 * Rnd: NextDouble, Next(0, 2) (either branch).
 */
function fighterWeaponFire(galaxy: Galaxy, weapon: FighterWeapon, firer: Fighter, target: FighterTarget, time: number, willHit: boolean, hitRangeChance: number): void {
    weapon.lastFired = time;
    weapon.distanceTravelled = 1;
    weapon.x = Math.fround(firer.xpos);
    weapon.y = Math.fround(firer.ypos);
    weapon.hasMissed = false;
    weapon.soundEffectPlayed = false;
    weapon.resetNext = false;
    weapon.distanceFromTarget = Math.fround(galaxy.calculateDistance(firer.xpos, firer.ypos, target.xpos, target.ypos));
    weapon.willHitTarget = willHit;
    if (willHit) {
        weapon.headingMissFactor = 0;
        weapon.heading = Math.fround(determineAngle(firer.xpos, firer.ypos, target.xpos, target.ypos));
        let num = galaxy.rnd.nextDouble() * 0.15;
        if (galaxy.rnd.next(0, 2) === 0) num *= -1.0;
        weapon.heading = Math.fround(weapon.heading + Math.fround(num));
    } else {
        let num = (0.5 - hitRangeChance) * galaxy.rnd.nextDouble() * 0.4;
        if (num < 0.03) num += 0.03;
        if (galaxy.rnd.next(0, 2) === 0) num *= -1.0;
        weapon.headingMissFactor = Math.fround(num);
        weapon.heading = Math.fround(Math.fround(num) + Math.fround(determineAngle(firer.xpos, firer.ypos, target.xpos, target.ypos)));
    }
    firer.currentEnergy = Math.fround(firer.currentEnergy - weapon.energyRequired);
    const attackers = attackersOf(target);
    // C# `target.Attackers.Contains(firer)` then Add (Attackers is never null for the targets fighters engage).
    if (attackers === null || attackers.includes(firer)) return;
    attackers.push(firer);
}

// ---------------------------------------------------------------------------------------------------------------
// Fighter.cs (the class)
// ---------------------------------------------------------------------------------------------------------------

/** Fighter.cs (a StellarObject). */
export class Fighter {
    // ---- StellarObject.cs 17-46 (the members a Fighter uses) ----
    xpos = 0;
    ypos = 0;
    empire: Empire | null = null;
    owner: Empire | null = null;
    name = '';
    attackers: unknown[] = []; // StellarObjectList
    pursuers: unknown[] = []; // StellarObjectList
    firepowerRaw = 0;
    topSpeed = 0; // short
    /** StellarObject.IsFunctional: never set for a Fighter (false). */
    isFunctional = false;
    hasBeenDestroyed = false;
    currentSpeed = 0; // float
    targetHeading = 0; // float
    parentHabitat: Habitat | null = null;
    parentBuiltObject: BuiltObject | null = null;
    currentTarget: FighterTarget | null = null;
    size = 0;
    // ---- Fighter.cs 22-77 ----
    fighterID = 0;
    specification: FighterSpecification;
    currentEnergy = 0; // float
    currentShields = 0; // float
    private _targetSpeed = 0; // float
    targetSpeedChanged = false;
    turnDirection: TurnDirection = TurnDirection.Undefined;
    headingChanged = false;
    health = 0; // float
    heading = 0; // float
    onboardCarrier = false;
    underConstruction = false;
    missionType: FighterMissionType = FighterMissionType.Undefined;
    pictureRef = 0; // short
    overlayChanged = true;
    lastShieldStrike = MIN_TIME;
    lastShieldStrikeDirection = 0; // float
    inView = false;
    inBattle = false;
    lastTouch = MIN_TIME;
    lastLongTouch = MIN_TIME;
    lastLocationEffectTouch = MIN_TIME;
    movementSlowedLocation = false;
    shieldsReducedLocation = false;
    shipPullAmountLocation = 0; // float
    shipPullAngleLocation = 0; // float
    shipDamageAmountLocation = 0; // float
    weapons: FighterWeapon[] = [];
    explosions: Explosion[] = [];

    /** Fighter.cs 187 Fighter(galaxy, specification, carrier). No Galaxy.Rnd. */
    constructor(galaxy: Galaxy, specification: FighterSpecification, carrier: BuiltObject) {
        this.fighterID = getNextFighterID(galaxy);
        this.specification = specification;
        this.name = specification.name;
        this.currentEnergy = Math.fround(specification.energyCapacity);
        this.currentShields = Math.fround(specification.shieldsCapacity);
        this.targetSpeed = 0;
        this.turnDirection = TurnDirection.StraightAhead;
        this.headingChanged = false;
        this.health = 0;
        this.size = specification.size;
        this.topSpeed = specification.topSpeed;
        this.parentBuiltObject = carrier;
        this.heading = carrier.heading;
        this.onboardCarrier = true;
        this.underConstruction = true;
        if (carrier.fighters === null) throw new Error('Fighter ctor: carrier.Fighters is null (C# NullReferenceException)');
        carrier.fighters.push(this);
        this.empire = carrier.empire;
        this.owner = this.empire;
        if (this.empire !== null) {
            let isPirates = false;
            if (this.empire.pirateEmpireBaseHabitat !== null) isPirates = true;
            if (specification.type === FighterType.Bomber) this.pictureRef = toShort(resolveNewBomberImageIndex(specification, this.empire, isPirates));
            else this.pictureRef = toShort(resolveNewFighterImageIndex(specification, this.empire, isPirates));
        }
        this.missionType = FighterMissionType.Undefined;
        this.inView = false;
        this.lastTouch = galaxyNow(galaxy);
        this.lastLongTouch = galaxyNow(galaxy);
        this.weapons = [];
        if (specification.weaponType !== ComponentType.Undefined) {
            const fighterWeapon = new FighterWeapon();
            fighterWeapon.category = resolveComponentCategory(specification.weaponType);
            fighterWeapon.type = specification.weaponType;
            fighterWeapon.rawDamage = specification.weaponDamage;
            fighterWeapon.range = specification.weaponRange;
            fighterWeapon.energyRequired = specification.weaponEnergyRequired;
            fighterWeapon.speed = specification.weaponSpeed;
            fighterWeapon.damageLoss = specification.weaponDamageLoss;
            fighterWeapon.fireRate = specification.weaponFireRate;
            this.weapons.push(fighterWeapon);
            if (fighterWeapon.rawDamage > this.firepowerRaw) this.firepowerRaw = fighterWeapon.rawDamage;
        }
        this.attackers = [];
        this.pursuers = [];
    }

    /** Fighter.cs 81 TargetSpeed (float; the setter flags TargetSpeedChanged). */
    get targetSpeed(): number {
        return this._targetSpeed;
    }
    set targetSpeed(value: number) {
        if (this._targetSpeed !== value) this.targetSpeedChanged = true;
        this._targetSpeed = value;
    }
}

/** `o is Fighter`. */
export function isFighter(o: unknown): o is Fighter {
    return o instanceof Fighter;
}

/** BuiltObject.Fighters typed (the field is `unknown[]` in builtObject.ts). */
export function fightersOf(bo: BuiltObject): Fighter[] | null {
    return bo.fighters as Fighter[] | null;
}

/** FighterList.cs 15 TotalSize. */
function fighterListTotalSize(fighters: Fighter[]): number {
    let totalSize = 0;
    for (let index = 0; index < fighters.length; ++index) totalSize += fighters[index].size;
    return totalSize;
}

/** Galaxy.cs 1313 GetNextFighterID. */
function getNextFighterID(galaxy: Galaxy): number {
    if (galaxy.nextFighterID < 2147483647) {
        galaxy.nextFighterID++;
        return galaxy.nextFighterID;
    }
    throw new Error('Maximum allowable fighter number exceeded!');
}

/** BaconShipImageHelper.cs 13 ResolveNewFighterImageIndex(fighterSpec, empireRace, isPirates) (Fighter.cs 213 passes Empire.DominantRace). */
function resolveNewFighterImageIndex(fighterSpec: FighterSpecification, empire: Empire, isPirates: boolean): number {
    if (fighterSpec.sortTag > 0.0) return Math.trunc(fighterSpec.sortTag);
    return raceFamilyPictureIndex(empire, isPirates) * SHIP_SET_FIGHTER_IMAGE_COUNT;
}
/** BaconShipImageHelper.cs 31 ResolveNewBomberImageIndex. */
function resolveNewBomberImageIndex(fighterSpec: FighterSpecification, empire: Empire, isPirates: boolean): number {
    if (fighterSpec.sortTag > 0.0) return Math.trunc(fighterSpec.sortTag);
    return raceFamilyPictureIndex(empire, isPirates) * SHIP_SET_FIGHTER_IMAGE_COUNT + 1;
}
function raceFamilyPictureIndex(empire: Empire, isPirates: boolean): number {
    let num = 0;
    const empireRace = empire.dominantRace;
    if (empireRace !== null) {
        num = empireRace.designsPictureFamilyIndex;
        const pirates = Number((empireRace.extra?.['DesignsPictureFamilyIndexPirates'] ?? '-1').trim());
        if (isPirates && Number.isInteger(pirates) && pirates > 0) num = pirates;
    }
    return num;
}

// ---------------------------------------------------------------------------------------------------------------
// StellarObject accessors over the fighter target union
// ---------------------------------------------------------------------------------------------------------------

/** StellarObject.Attackers (a Habitat's list is `attackers` in types.ts). */
function attackersOf(o: FighterTarget): unknown[] | null {
    if (isBuiltObject(o)) return o.attackers;
    if (isCreature(o)) return o.attackers;
    if (isFighter(o)) return o.attackers;
    return (o as Habitat).attackers;
}
/** StellarObject.Pursuers (never created for a Habitat: null). */
function pursuersOf(o: FighterTarget): unknown[] | null {
    if (isBuiltObject(o)) return o.pursuers;
    if (isCreature(o)) return o.pursuers;
    if (isFighter(o)) return o.pursuers;
    return null;
}
function targetEmpire(o: FighterTarget): Empire | null {
    if (isCreature(o)) return null;
    return (o as { empire: Empire | null }).empire;
}
function targetHasBeenDestroyed(o: FighterTarget): boolean {
    if (isHabitat(o)) return (o as unknown as { hasBeenDestroyed?: boolean }).hasBeenDestroyed === true;
    return o.hasBeenDestroyed;
}
function targetCurrentSpeed(o: FighterTarget): number {
    if (isHabitat(o)) return 0;
    return o.currentSpeed;
}
function targetTopSpeed(o: FighterTarget): number {
    if (isHabitat(o)) return 0;
    return o.topSpeed;
}
function removeFirst(list: unknown[] | null, item: unknown): void {
    if (list === null) return;
    const i = list.indexOf(item);
    if (i >= 0) list.splice(i, 1);
}
/** BuiltObject.CaptainFightersBonus = _CaptainFightersBonus / 100 (100 until ReviewCaptainBonuses). */
function captainFightersBonus(bo: BuiltObject): number {
    const b = captainBonuses(bo);
    return (b !== null ? b.fighters : 100) / 100.0;
}
function captainCountermeasuresBonus(bo: BuiltObject): number {
    const b = captainBonuses(bo);
    return (b !== null ? b.countermeasures : 100) / 100.0;
}
function captainWeaponsRangeBonus(bo: BuiltObject): number {
    const b = captainBonuses(bo);
    return (b !== null ? b.weaponsRange : 100) / 100.0;
}
function captainDamageControlBonus(bo: BuiltObject): number {
    const b = captainBonuses(bo);
    return (b !== null ? b.damageControl : 100) / 100.0;
}
function shipGroupBattleStats(bo: BuiltObject): SpaceBattleStats | null {
    const shipGroup = shipGroupOf(bo);
    return shipGroup !== null ? battleStatsOf(shipGroup) : null;
}
/** C# `string.Replace(ch, "")`. */
function removeAll(s: string, ch: string): string {
    return s.split(ch).join('');
}

// ---------------------------------------------------------------------------------------------------------------
// Seed-derived stand-ins for BaconFighter's `new Random()` (plan §0)
// ---------------------------------------------------------------------------------------------------------------

/** BaconFighter.cs 55 CheckForLevelGain `new Random().Next(1000)` — one galaxy-seeded stream. */
function levelGainClockRnd(galaxy: Galaxy): Random {
    if (galaxy.baconFighterLevelGainRnd === null) galaxy.baconFighterLevelGainRnd = new Random((galaxy.randomSeed ^ 0x0f53) | 0);
    return galaxy.baconFighterLevelGainRnd;
}
/** BaconFighter.cs 785 AssignCAP `new Random().Next(list.Count)` — one galaxy-seeded stream. */
function assignCapClockRnd(galaxy: Galaxy): Random {
    if (galaxy.baconFighterAssignCapRnd === null) galaxy.baconFighterAssignCapRnd = new Random((galaxy.randomSeed ^ 0x0785) | 0);
    return galaxy.baconFighterAssignCapRnd;
}
/**
 * BaconFighter.cs 70 `new Random(fighter.Name.GetHashCode())`: .NET's string hash is randomised per process, so the C# seed is
 * not reproducible; here a stable 32-bit hash of the name mixed with the galaxy seed (no galaxy.rnd draw).
 */
function nameHashSeed(galaxy: Galaxy, name: string): number {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (Math.imul(h, 31) + name.charCodeAt(i)) | 0;
    return (h ^ galaxy.randomSeed ^ 0x0070) | 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Fighter.cs / BaconFighter.cs — per-frame tick
// ---------------------------------------------------------------------------------------------------------------

/**
 * Fighter.cs 256 DoTasks(galaxy, time, inView) → BaconFighter.cs 155 DoTasks(fighter, galaxy, time, inView).
 * Rnd: DoMovement (PerformPatrol NextDouble / Next(0, 2) and RandomHeadingOffset), PursueTarget / FireWeaponsAtTarget
 * (DetermineHitTarget + FighterWeapon.Fire), CheckBomberDefensiveFire, HandleWeaponsFiring (InflictDamage), and in the
 * 3 s block EvaluateThreats / ApplyLocationEffectsNEW.
 */
export function fighterDoTasks(galaxy: Galaxy, fighterObject: unknown, time: number, inView: boolean): void {
    const fighter = fighterObject as Fighter;
    const timePassed1 = spanSeconds(time, fighter.lastTouch);
    fighter.inView = inView;
    fighterRechargeEnergy(fighter, timePassed1);
    fighterRechargeShields(fighter, timePassed1);
    fighterRepairDamage(fighter, timePassed1);
    fighterDoMovement(galaxy, fighter, timePassed1);
    fighterUpdateMissionParameters(galaxy, fighter, time);
    checkBomberDefensiveFire(galaxy, fighter, time);
    fighterHandleWeaponsFiring(galaxy, fighter, time, timePassed1);
    if (fighter.explosions.length > 0) fighterDoExplosions(galaxy, fighter, time);
    const num = fighter.missionType === FighterMissionType.Attack ? 1 : fighter.attackers === null ? 0 : fighter.attackers.length > 0 ? 1 : 0;
    fighter.inBattle = num !== 0;
    if (fighter.onboardCarrier) fighter.missionType = FighterMissionType.Undefined;
    if (time - fighter.lastLongTouch >= INTERMEDIATE_PROCESSING_SPAN_MS) {
        const timePassed2 = spanSeconds(time, fighter.lastLongTouch);
        fighterReturnToCarrierForRepairs(galaxy, fighter);
        fighterEvaluateThreats(galaxy, fighter);
        fighterCheckCarrierDestroyed(galaxy, fighter);
        fighterCheckReturnToCarrier(galaxy, fighter);
        fighterApplyLocationEffectsNEW(galaxy, fighter, timePassed2, time);
        fighter.lastLongTouch = time;
    }
    fighter.lastTouch = time;
    returnToCarrierIfOutOfAmmo(galaxy, fighter);
}

/** Fighter.cs 2092 RechargeEnergy(timePassed). */
export function fighterRechargeEnergy(fighter: Fighter, timePassed: number): void {
    const spec = fighter.specification;
    if (spec !== null) {
        fighter.currentEnergy = Math.fround(fighter.currentEnergy + Math.fround(timePassed * spec.energyRechargeRate));
        fighter.currentEnergy = Math.min(fighter.currentEnergy, spec.energyCapacity);
    }
}

/** Fighter.cs 2101 RechargeShields(timePassed). */
export function fighterRechargeShields(fighter: Fighter, timePassed: number): void {
    const spec = fighter.specification;
    if (spec !== null) {
        let val = Math.fround(timePassed * spec.shieldRechargeRate);
        val = Math.min(val, fighter.currentEnergy);
        val = Math.min(val, Math.fround(spec.shieldsCapacity - fighter.currentShields));
        fighter.currentShields = Math.fround(fighter.currentShields + val);
        fighter.currentEnergy = Math.fround(fighter.currentEnergy - val);
        fighter.currentShields = Math.max(0, Math.min(fighter.currentShields, spec.shieldsCapacity));
    }
}

/** Fighter.cs 2114 RepairDamage(timePassed). */
export function fighterRepairDamage(fighter: Fighter, timePassed: number): void {
    const spec = fighter.specification;
    if (fighter.health < 1 && spec !== null && spec.damageRepairRate > 0) {
        const num = Math.fround(timePassed * spec.damageRepairRate);
        fighter.health = Math.fround(fighter.health + num);
        fighter.health = Math.min(fighter.health, 1);
    }
}

/** Fighter.cs 1783 DoMovement(galaxy, timePassed). */
export function fighterDoMovement(galaxy: Galaxy, fighter: Fighter, timePassed: number): void {
    calculateCurrentHeading(fighter, timePassed);
    accelerateToTargetSpeed(fighter, timePassed);
    consumeEnergy(fighter, timePassed);
    const num = fighter.currentSpeed * timePassed;
    const parent = fighter.parentBuiltObject;
    if (!fighter.inView && !fighter.onboardCarrier && fighter.missionType === FighterMissionType.ReturnToCarrier && parent !== null) {
        const num2 = galaxy.calculateDistance(fighter.xpos, fighter.ypos, parent.xpos, parent.ypos);
        if (num > num2 * 0.6) {
            boardCarrier(fighter);
            return;
        }
    }
    fighter.xpos += Math.cos(fighter.heading) * num;
    fighter.ypos += Math.sin(fighter.heading) * num;
    if (fighter.onboardCarrier && parent !== null) {
        fighter.xpos = parent.xpos;
        fighter.ypos = parent.ypos;
    } else if (!fighter.inView && parent !== null) {
        const num3 = galaxy.calculateDistanceSquared(fighter.xpos, fighter.ypos, parent.xpos, parent.ypos);
        let num4 = 0.0;
        let num5 = 0.0;
        switch (fighter.missionType) {
            case FighterMissionType.Patrol:
                num4 = 360000.0;
                num5 = 600.0;
                break;
            case FighterMissionType.Attack:
                num4 = 2250000.0;
                num5 = 1500.0;
                break;
            default:
                num4 = 2250000.0;
                num5 = 1500.0;
                break;
        }
        if (num3 > num4) {
            const num6 = determineAngle(parent.xpos, parent.ypos, fighter.xpos, fighter.ypos);
            fighter.xpos = parent.xpos + Math.cos(num6) * num5;
            fighter.ypos = parent.ypos + Math.sin(num6) * num5;
        }
    }
}

/** Fighter.cs 1834 ConsumeEnergy(timePassed). */
function consumeEnergy(fighter: Fighter, timePassed: number): void {
    const rate = fighter.specification.topSpeedEnergyConsumptionRate;
    if (fighter.targetSpeed === fighter.topSpeed) fighter.currentEnergy = Math.fround(fighter.currentEnergy - Math.fround(rate * timePassed));
    else fighter.currentEnergy = Math.fround(fighter.currentEnergy - Math.fround(rate * timePassed * 0.5));
}

/** Fighter.cs 1846 CalculateCurrentHeading(timePassed). */
function calculateCurrentHeading(fighter: Fighter, timePassed: number): void {
    if (fighter.heading === fighter.targetHeading) return;
    fighter.headingChanged = true;
    const num = getCurrentTurnRate(fighter, fighter.currentSpeed) * timePassed;
    let num2 = Math.fround(fighter.targetHeading - fighter.heading);
    if (num2 > Math.PI) num2 -= Math.PI * 2.0;
    else if (num2 < -Math.PI) num2 += Math.PI * 2.0;
    if ((num2 < 0.0 && num2 > -Math.PI) || (num2 >= Math.PI && num2 < Math.PI * 2.0)) {
        if (Math.abs(num2) < Math.abs(num)) {
            fighter.heading = fighter.targetHeading;
            fighter.turnDirection = TurnDirection.StraightAhead;
        } else {
            fighter.heading = Math.fround(fighter.heading - Math.fround(num));
            fighter.turnDirection = TurnDirection.Left;
        }
        const iterationCount = { count: 0 };
        while (conditionCheckLimit(fighter.heading <= -Math.PI, 50, iterationCount)) fighter.heading = Math.fround(increaseAngle(fighter.heading));
    } else {
        if (Math.abs(num2) < Math.abs(num)) {
            fighter.heading = fighter.targetHeading;
            fighter.turnDirection = TurnDirection.StraightAhead;
        } else {
            fighter.heading = Math.fround(fighter.heading + Math.fround(num));
            fighter.turnDirection = TurnDirection.Right;
        }
        const iterationCount2 = { count: 0 };
        while (conditionCheckLimit(fighter.heading >= Math.PI, 50, iterationCount2)) fighter.heading = Math.fround(reduceAngle(fighter.heading));
    }
}

/** Fighter.cs 1901 ReduceAngle. */
function reduceAngle(currentangle: number): number {
    if (currentangle >= Math.PI) currentangle -= Math.PI * 2.0;
    return currentangle;
}
/** Fighter.cs 1910 IncreaseAngle. */
function increaseAngle(currentangle: number): number {
    if (currentangle <= -Math.PI) currentangle += Math.PI * 2.0;
    return currentangle;
}

/** Fighter.cs 2036 AccelerateToTargetSpeed(timePassed). */
function accelerateToTargetSpeed(fighter: Fighter, timePassed: number): void {
    const spec = fighter.specification;
    if (fighter.targetSpeed > fighter.currentSpeed) {
        const num = Math.fround(spec.accelerationRate * Math.fround(timePassed));
        if (Math.fround(fighter.currentSpeed + num) >= fighter.targetSpeed) fighter.currentSpeed = fighter.targetSpeed;
        else fighter.currentSpeed = Math.fround(fighter.currentSpeed + num);
    } else if (fighter.targetSpeed < fighter.currentSpeed) {
        const num2 = Math.max(1.0, spec.accelerationRate);
        const num3 = num2 * timePassed;
        if (fighter.currentSpeed - num3 < fighter.targetSpeed) fighter.currentSpeed = fighter.targetSpeed;
        else fighter.currentSpeed = Math.fround(fighter.currentSpeed - Math.fround(num3));
    }
    if (fighter.currentSpeed < 0) fighter.currentSpeed = 0;
}

/** Fighter.cs 2069/2074 GetCurrentTurnRate(speed) (float). */
function getCurrentTurnRate(fighter: Fighter, speed: number): number {
    let num = fighter.specification.turnRate;
    if (speed <= fighter.topSpeed * 0.12) num = Math.fround(num * 4);
    if (speed < fighter.topSpeed * 0.25) num = Math.fround(num * Math.fround(2.6));
    if (speed < fighter.topSpeed * 0.5) num = Math.fround(num * Math.fround(1.6));
    return num;
}

/** Fighter.cs 1997 WillMeetDestination(galaxy, destinationX, destinationY, speed). */
export function willMeetDestination(galaxy: Galaxy, fighter: Fighter, destinationX: number, destinationY: number, speed: number): boolean {
    if (fighter.turnDirection === TurnDirection.StraightAhead) return true;
    const currentTurnRate = getCurrentTurnRate(fighter, speed);
    const num = (Math.PI / currentTurnRate) * speed;
    const num2 = num / Math.PI;
    let num3 = 0.0;
    switch (fighter.turnDirection) {
        case TurnDirection.Left:
            num3 = fighter.heading - Math.PI / 2.0;
            break;
        case TurnDirection.Right:
            num3 = fighter.heading + Math.PI / 2.0;
            break;
    }
    const num4 = Math.cos(num3) * num2;
    const num5 = Math.tan(num3) * num4;
    const x = fighter.xpos + num4;
    const y = fighter.ypos + num5;
    const num6 = galaxy.calculateDistance(x, y, destinationX, destinationY);
    if (num6 < num2) return false;
    const num7 = determineAngle(fighter.xpos, fighter.ypos, destinationX, destinationY);
    const num8 = fighter.heading - num7;
    const num9 = Math.abs((num8 / currentTurnRate) * speed);
    const num10 = galaxy.calculateDistance(fighter.xpos, fighter.ypos, destinationX, destinationY);
    if (num9 > num10 * 1.2) return false;
    return true;
}

/** `while (!WillMeetDestination(…, TargetSpeed)) { TargetSpeed /= 1.5f; if (TargetSpeed < 1f) break; }` (float). */
function slowUntilWillMeetDestination(galaxy: Galaxy, fighter: Fighter, x: number, y: number): void {
    while (!willMeetDestination(galaxy, fighter, x, y, fighter.targetSpeed)) {
        fighter.targetSpeed = Math.fround(fighter.targetSpeed / F_1_5);
        if (fighter.targetSpeed < 1) break;
    }
}

/** Fighter.cs 1931/1936 RandomHeadingOffset(galaxy[, maxAmount = 0.3f]). Rnd: NextDouble. */
export function randomHeadingOffset(galaxy: Galaxy, maxAmount: number = F_0_3): number {
    return Math.fround(Math.fround(maxAmount * -1) + galaxy.rnd.nextDouble() * maxAmount * 2.0);
}

/** Fighter.cs 1657 UpdateMissionParameters(galaxy, time). */
export function fighterUpdateMissionParameters(galaxy: Galaxy, fighter: Fighter, time: number): void {
    switch (fighter.missionType) {
        case FighterMissionType.Attack:
            pursueTarget(galaxy, fighter, time);
            break;
        case FighterMissionType.Patrol:
            performPatrol(galaxy, fighter);
            break;
        case FighterMissionType.ReturnToCarrier:
            if (fighter.parentBuiltObject !== null) {
                const num = determineAngle(fighter.xpos, fighter.ypos, fighter.parentBuiltObject.xpos, fighter.parentBuiltObject.ypos);
                fighter.targetHeading = Math.fround(num);
                checkForCarrierBoarding(galaxy, fighter);
            }
            break;
    }
}

/** Fighter.cs 1678 PerformPatrol(galaxy). Rnd: RandomHeadingOffset NextDouble, or NextDouble + Next(0, 2). */
function performPatrol(galaxy: Galaxy, fighter: Fighter): void {
    const parent = fighter.parentBuiltObject;
    if (parent === null) return;
    const num = galaxy.calculateDistance(fighter.xpos, fighter.ypos, parent.xpos, parent.ypos);
    if (parent.currentSpeed > 6.0) {
        if (num > 300.0) {
            const num2 = determineAngle(fighter.xpos, fighter.ypos, parent.xpos, parent.ypos);
            fighter.targetHeading = Math.fround(Math.fround(num2) + randomHeadingOffset(galaxy));
            fighter.targetSpeed = Math.fround(Math.fround(fighter.topSpeed) * F_0_5);
        } else if (num < 150.0) {
            const num4 = determineAngle(fighter.xpos, fighter.ypos, parent.xpos, parent.ypos);
            fighter.targetHeading = Math.fround(num4 + Math.PI + randomHeadingOffset(galaxy));
            fighter.targetSpeed = Math.fround(Math.fround(fighter.topSpeed) * F_0_5);
        } else {
            fighter.targetHeading = parent.heading;
            fighter.targetSpeed = parent.currentSpeed;
        }
    } else {
        if (num > 500.0) {
            const num6 = determineAngle(fighter.xpos, fighter.ypos, parent.xpos, parent.ypos);
            const num7 = Math.abs(Math.fround(Math.fround(num6) - fighter.targetHeading));
            if (num7 > F_0_7) {
                let num8 = Math.fround(num6 + galaxy.rnd.nextDouble() * 0.65);
                if (galaxy.rnd.next(0, 2) === 1) num8 = Math.fround(num8 * -1);
                fighter.targetHeading = num8;
            }
        }
        fighter.targetSpeed = Math.fround(Math.fround(fighter.topSpeed) * F_0_5);
    }
    slowUntilWillMeetDestination(galaxy, fighter, parent.xpos, parent.ypos);
}

/** Fighter.cs 1733 BoardCarrier. */
function boardCarrier(fighter: Fighter): void {
    const parent = fighter.parentBuiltObject;
    if (parent !== null && !parent.hasBeenDestroyed) {
        fighter.targetSpeed = 0;
        fighter.currentSpeed = 0;
        fighter.onboardCarrier = true;
        fighter.missionType = FighterMissionType.Undefined;
        fighter.xpos = parent.xpos;
        fighter.ypos = parent.ypos;
    }
}

/** Fighter.cs 1746 CheckForCarrierBoarding(galaxy). */
function checkForCarrierBoarding(galaxy: Galaxy, fighter: Fighter): void {
    const parent = fighter.parentBuiltObject;
    if (fighter.missionType !== FighterMissionType.ReturnToCarrier || parent === null || parent.hasBeenDestroyed || parent.fighterCapacity <= 0) return;
    const num = galaxy.calculateDistance(fighter.xpos, fighter.ypos, parent.xpos, parent.ypos);
    let num2 = 30.0;
    let num3 = 200.0;
    if (!fighter.inView) {
        num2 *= 4.0;
        num3 *= 2.0;
    }
    if (num < num2) {
        boardCarrier(fighter);
    } else if (num < num3) {
        fighter.targetSpeed = Math.fround(Math.fround(fighter.topSpeed * 0.3) + parent.currentSpeed);
        fighter.targetSpeed = Math.min(fighter.targetSpeed, fighter.topSpeed);
    } else {
        fighter.targetSpeed = fighter.topSpeed;
    }
    slowUntilWillMeetDestination(galaxy, fighter, parent.xpos, parent.ypos);
}

/** Fighter.cs 1919 ReturnToCarrier. */
export function returnToCarrier(fighter: Fighter): void {
    const parent = fighter.parentBuiltObject;
    if (parent !== null && !parent.hasBeenDestroyed && parent.fighterCapacity > 0 && fighter.missionType !== FighterMissionType.ReturnToCarrier) {
        abandonAttackTarget(fighter);
        fighter.missionType = FighterMissionType.ReturnToCarrier;
        const num = determineAngle(fighter.xpos, fighter.ypos, parent.xpos, parent.ypos);
        fighter.targetHeading = Math.fround(num);
        fighter.targetSpeed = fighter.topSpeed;
    }
}

/** Fighter.cs 502 ReturnToCarrierForRepairs. */
function fighterReturnToCarrierForRepairs(galaxy: Galaxy, fighter: Fighter): void {
    void galaxy;
    if (fighter.health < 1) {
        let flag = false;
        if (fighter.specification.damageRepairRate > 0 && fighter.health > Math.fround(0.75)) flag = true;
        if (!flag) returnToCarrier(fighter);
    }
}

/** Fighter.cs 440 CheckCarrierDestroyed(galaxy). */
function fighterCheckCarrierDestroyed(galaxy: Galaxy, fighter: Fighter): void {
    if (fighter.parentBuiltObject === null || fighter.parentBuiltObject.hasBeenDestroyed) fighterCompleteTeardown(galaxy, fighter);
}

/** BaconFighter.cs 30 CalculateMaximumTargetRange(fighter) (a squared distance). */
export function calculateMaximumTargetRange(fighter: Fighter): number {
    const parentBuiltObject = fighter.parentBuiltObject;
    return parentBuiltObject !== null && parentBuiltObject.role === BuiltObjectRole.Base
        ? MAXIMUM_TARGET_DISTANCE_SQUARED * baconSettings.fighterRangeMultiple * fighter.topSpeed * fighter.topSpeed * STARBASE_FIGHTER_RANGE_MULTIPLIER
        : MAXIMUM_TARGET_DISTANCE_SQUARED * baconSettings.fighterRangeMultiple * fighter.topSpeed * fighter.topSpeed;
}

/** BaconFighter.cs 131 CheckReturnToCarrier(fighter, galaxy) (via Fighter.cs 435). */
function fighterCheckReturnToCarrier(galaxy: Galaxy, fighter: Fighter): void {
    const parent = fighter.parentBuiltObject;
    if (fighter.onboardCarrier || fighter.missionType === FighterMissionType.ReturnToCarrier || parent === null) return;
    if (checkHyperjumpPending(galaxy, parent) && fighter.missionType === FighterMissionType.Undefined) {
        fighter.name = removeAll(fighter.name, '!');
        returnToCarrier(fighter);
    } else if (fighter.missionType === FighterMissionType.Attack && fighter.currentTarget !== null) {
        if (galaxy.calculateDistanceSquared(fighter.currentTarget.xpos, fighter.currentTarget.ypos, parent.xpos, parent.ypos) > calculateMaximumTargetRange(fighter)) {
            abandonAttackTarget(fighter);
            fighterEvaluateThreats(galaxy, fighter);
        }
    } else if (galaxy.calculateDistanceSquared(fighter.xpos, fighter.ypos, parent.xpos, parent.ypos) > calculateMaximumTargetRange(fighter)) {
        fighter.name = removeAll(fighter.name, '!');
        returnToCarrier(fighter);
    }
}

/**
 * Fighter.cs 261 ApplyLocationEffectsNEW(galaxy, timePassed, time). Rnd (lightning, launched): NextDouble; when it strikes
 * NextDouble [+ NextDouble] and InflictDamage on itself; shield reduction: NextDouble.
 */
export function fighterApplyLocationEffectsNEW(galaxy: Galaxy, fighter: Fighter, timePassed: number, time: number): void {
    let flag = false;
    let flag2 = false;
    let flag3 = false;
    let flag4 = false;
    let num = 0.0;
    let flag5 = false;
    let num2 = 0.0;
    let num3 = 0.0;
    const parent = fighter.parentBuiltObject;
    if (!fighter.onboardCarrier && parent !== null) {
        flag = parent.locationEffects.includes(GalaxyLocationEffectType.LightningDamage);
        flag2 = parent.movementSlowedLocation;
        flag3 = parent.shieldsReducedLocation;
        num = parent.shipDamageAmountLocation;
        if (num > 0.0) flag4 = true;
        // 281: C# reads ShipDamageAmountLocation (not ShipPullAmountLocation) for the pull amount.
        num2 = parent.shipDamageAmountLocation;
        num3 = parent.shipPullAngleLocation;
        if (num2 > 0.0) flag5 = true;
    }
    if (flag && !fighter.onboardCarrier) {
        const timeSpan = spanSeconds(time, fighter.lastLocationEffectTouch);
        const num4 = galaxy.rnd.nextDouble() * timeSpan;
        if (num4 > 7.0) {
            let num5 = 20.0 + galaxy.rnd.nextDouble() * 70.0;
            if (fighter.currentShields <= num5) {
                fighter.currentShields = 0;
                num5 = galaxy.rnd.nextDouble() * 5.0;
            }
            fighterInflictDamageFull(galaxy, fighter, fighter, num5, time, 0, false, -Number.MAX_VALUE, true);
            fighter.lastLocationEffectTouch = time;
        }
    }
    if (flag4) fighter.shipDamageAmountLocation = Math.fround(num);
    else fighter.shipDamageAmountLocation = 0;
    if (flag5) {
        fighter.shipPullAmountLocation = Math.fround(num2);
        fighter.shipPullAngleLocation = Math.fround(num3);
    } else {
        fighter.shipPullAmountLocation = 0;
        fighter.shipPullAngleLocation = 0;
    }
    if (flag2) fighter.topSpeed = toShort(Math.trunc(fighter.specification.topSpeed * 0.75));
    else if (!flag2 && fighter.movementSlowedLocation) fighter.topSpeed = fighter.specification.topSpeed;
    fighter.movementSlowedLocation = flag2;
    if (flag3) {
        let val = (3.0 + galaxy.rnd.nextDouble() * 0.5) * timePassed;
        val = Math.min(fighter.currentShields, val);
        fighter.currentShields = Math.fround(fighter.currentShields - Math.fround(val));
    }
    fighter.shieldsReducedLocation = flag3;
}

// ---------------------------------------------------------------------------------------------------------------
// Teardown / targets
// ---------------------------------------------------------------------------------------------------------------

/** Fighter.cs 448 CompleteTeardown(galaxy). No Rnd of its own (ClearAllFighterMissionsForTarget → EvaluateThreats may draw). */
export function fighterCompleteTeardown(galaxy: Galaxy, fighter: Fighter): void {
    fighter.hasBeenDestroyed = true;
    const currentTarget = fighter.currentTarget;
    if (currentTarget !== null) {
        const attackers = attackersOf(currentTarget);
        let num = attackers !== null ? attackers.indexOf(fighter) : -1;
        if (num >= 0) attackers!.splice(num, 1);
        const pursuers = pursuersOf(currentTarget);
        num = pursuers !== null ? pursuers.indexOf(fighter) : -1;
        if (num >= 0) pursuers!.splice(num, 1);
        fighter.currentTarget = null;
    }
    clearAllFighterMissionsForTarget(galaxy, fighter);
    const parent = fighter.parentBuiltObject;
    if (parent !== null) {
        if (parent.fighters !== null && parent.fighters.includes(fighter)) removeFirst(parent.fighters, fighter);
        fighter.parentBuiltObject = null;
    }
}

/** Fighter.cs 476 ClearAllFighterMissionsForTarget(galaxy, fighter). */
function clearAllFighterMissionsForTarget(galaxy: Galaxy, fighter: Fighter): void {
    const builtObjectsAtLocation = getBuiltObjectsAtLocation(galaxy, fighter.xpos, fighter.ypos, 20000);
    for (let i = 0; i < builtObjectsAtLocation.length; i++) {
        const builtObject = builtObjectsAtLocation[i];
        const fighters = builtObject !== null ? fightersOf(builtObject) : null;
        if (builtObject === null || fighters === null || fighters.length <= 0) continue;
        for (let j = 0; j < fighters.length; j++) {
            const fighter2 = fighters[j];
            if (fighter2.currentTarget === fighter) {
                abandonAttackTarget(fighter2);
                fighterEvaluateThreats(galaxy, fighter2);
                if (fighter2.missionType === FighterMissionType.Undefined) fighter2.missionType = FighterMissionType.Patrol;
            }
        }
    }
}

/**
 * The fighter loop shared by BuiltObject.2.cs 5614-5628 / 5726-5742 ClearAllMissionsForTarget and Creature.cs 969-982
 * CompleteTeardown: every fighter of `builtObject` whose target matches abandons it, re-evaluates threats and patrols.
 */
export function clearFightersTargeting(galaxy: Galaxy, builtObject: BuiltObject, matches: (target: FighterTarget) => boolean): void {
    const fighters = fightersOf(builtObject);
    if (fighters === null || fighters.length <= 0) return;
    for (let k = 0; k < fighters.length; k++) {
        const fighter = fighters[k];
        if (fighter.currentTarget !== null && matches(fighter.currentTarget)) {
            abandonAttackTarget(fighter);
            fighterEvaluateThreats(galaxy, fighter);
            if (fighter.missionType === FighterMissionType.Undefined) fighter.missionType = FighterMissionType.Patrol;
        }
    }
}
/** The empire of a fighter target (ClearAllMissionsForTarget(builtObject, Empire target) compares `fighter.CurrentTarget.Empire`). */
export function fighterTargetEmpire(target: FighterTarget): Empire | null {
    return targetEmpire(target);
}

/** Fighter.cs 1977 AssignAttackTarget(target). */
export function assignAttackTarget(fighter: Fighter, target: FighterTarget | null): void {
    abandonAttackTarget(fighter);
    if (target !== null) {
        fighter.currentTarget = target;
        const pursuers = pursuersOf(target);
        if (pursuers !== null && !pursuers.includes(fighter)) pursuers.push(fighter);
        fighter.missionType = FighterMissionType.Attack;
    }
}

/** Fighter.cs 1992 AbandonAttackTarget → BaconFighter.cs 918 AbandonAttackTarget(fighter). */
export function abandonAttackTarget(fighter: Fighter): void {
    const currentTarget = fighter.currentTarget;
    if (currentTarget !== null) {
        const pursuers = pursuersOf(currentTarget);
        if (pursuers !== null && pursuers.includes(fighter)) removeFirst(pursuers, fighter);
        const attackers = attackersOf(currentTarget);
        if (attackers !== null && attackers.includes(fighter)) removeFirst(attackers, fighter);
        fighter.currentTarget = null;
    }
    fighter.missionType = FighterMissionType.Undefined;
}

/** Fighter.cs 1992 AbandonAttackTarget, for callers holding the fighter as `unknown` (combat/weapons.ts). */
export function fighterAbandonAttackTarget(galaxy: Galaxy, fighter: unknown): void {
    void galaxy;
    abandonAttackTarget(fighter as Fighter);
}

/** Fighter.cs 1919 ReturnToCarrier, for callers holding the fighter as `unknown` (movement.ts). */
export function fighterReturnToCarrier(galaxy: Galaxy, fighter: unknown): void {
    void galaxy;
    returnToCarrier(fighter as Fighter);
}

/** Fighter.cs 1946 CheckShouldFireAtCaptureTarget(target). */
function checkShouldFireAtCaptureTarget(galaxy: Galaxy, fighter: Fighter, target: FighterTarget): boolean {
    void galaxy;
    let result = true;
    let flag = false;
    if (isBuiltObject(target)) {
        const builtObject = target;
        if (builtObject.assaultAttackValue > 0 && fighter.empire !== null && builtObject.assaultAttackEmpireId === fighter.empire.empireId) flag = true;
    }
    const parent = fighter.parentBuiltObject;
    const parentMission = parent !== null ? builtObjectMission(parent.mission) : null;
    if (parentMission !== null && parentMission.type === BuiltObjectMissionType.Capture && parentMission.target === target) flag = true;
    if (flag && isBuiltObject(target)) {
        const builtObject2 = target;
        if (builtObject2.currentShields <= 30.0) result = false;
        else if (checkOurEmpireOverwhelmingBoarding(fighter.empire!, builtObject2)) result = false;
    }
    return result;
}

// ---------------------------------------------------------------------------------------------------------------
// Threat evaluation (BaconFighter.cs 283-456, 776-894; Fighter.cs 528)
// ---------------------------------------------------------------------------------------------------------------

/** A carrier's `_Threats[i]` (BuiltObject | Creature; the TS threat list never holds fighters). */
type CarrierThreat = BuiltObject | import('../creature').Creature;

/**
 * Fighter.cs 518 EvaluateThreats(galaxy) → BaconFighter.cs 283 EvaluateThreats(theFighter, galaxy).
 * Rnd: only through the callees (the carrier's InflictDamage on a wrecked fighter, DetermineThreatLevel encounters).
 */
export function fighterEvaluateThreats(galaxy: Galaxy, theFighter: Fighter): void {
    if (!theFighter.hasBeenDestroyed && theFighter.health <= 0.0 && !theFighter.underConstruction) {
        // 285: `BaconBuiltObject.myMain != null` (set in a running game).
        inflictDamageFull(galaxy, theFighter.parentBuiltObject!, theFighter, null, 1000.0, galaxyNow(galaxy), 0, false, 0.0, false);
        for (const pursuer of theFighter.pursuers) {
            if (isFighter(pursuer) && pursuer.currentTarget === theFighter) {
                for (const weapon of pursuer.weapons) weapon.resetNext = true;
            }
        }
    }
    if (
        (theFighter.onboardCarrier || theFighter.hasBeenDestroyed || theFighter.missionType === FighterMissionType.ReturnToCarrier) &&
        (!theFighter.onboardCarrier || theFighter.hasBeenDestroyed || theFighter.parentBuiltObject!.name.startsWith('*'))
    ) {
        return;
    }
    if ((theFighter.missionType === FighterMissionType.Patrol || theFighter.missionType === FighterMissionType.ReturnToCarrier) && theFighter.name.includes('!')) {
        theFighter.name = removeAll(theFighter.name, '!');
    }
    if (theFighter.parentBuiltObject!.name.startsWith('*') || theFighter.name.startsWith('!')) return;
    const maximumTargetRange = calculateMaximumTargetRange(theFighter);
    const parentBuiltObject = theFighter.parentBuiltObject;
    if (parentBuiltObject === null || parentBuiltObject.hasBeenDestroyed) return;
    if (theFighter.currentTarget !== null && isBuiltObject(theFighter.currentTarget) && theFighter.currentTarget.empire !== null && theFighter.currentTarget.empire === theFighter.empire) {
        theFighter.currentTarget = null;
    }
    if (theFighter.currentTarget !== null && theFighter.missionType === FighterMissionType.Patrol) {
        assignCAP(galaxy, theFighter);
        theFighter.missionType = FighterMissionType.Attack;
    }
    const xpos = parentBuiltObject.xpos;
    const ypos = parentBuiltObject.ypos;
    const threats = parentBuiltObject.threats as (CarrierThreat | null)[] | null;
    const isInterceptor = theFighter.specification.type === FighterType.Interceptor;
    if (threats !== null && threats.length !== 0) {
        if (theFighter.currentTarget === null) {
            let flag = false;
            if (isInterceptor) {
                for (let index1 = 0; index1 < threats.length; ++index1) {
                    const threat = threats[index1];
                    if (threat != null && !threat.hasBeenDestroyed && isBuiltObject(threat)) {
                        const fighters = fightersOf(threat);
                        if (fighters !== null && fighters.length > 0 && fighterShouldAttack(galaxy, theFighter, threat, xpos, ypos, maximumTargetRange)) {
                            for (let index2 = 0; index2 < fighters.length; ++index2) {
                                const fighter = fighters[index2];
                                if (fighter != null && !fighter.onboardCarrier && fighter.pursuers.length < 2 && !fighter.hasBeenDestroyed) {
                                    flag = true;
                                    break;
                                }
                            }
                        }
                    }
                }
            }
            for (let index3 = 0; index3 < threats.length; ++index3) {
                const threat = threats[index3];
                // `(Interceptor || !(threat is Fighter))`: a threat is never a Fighter here.
                if (threat != null && !threat.hasBeenDestroyed && fighterShouldAttack(galaxy, theFighter, threat, xpos, ypos, maximumTargetRange)) {
                    if (isInterceptor && flag) {
                        if (isBuiltObject(threat)) {
                            const fighters = fightersOf(threat);
                            if (fighters !== null && fighters.length > 0) {
                                for (let index4 = 0; index4 < fighters.length; ++index4) {
                                    const fighter = fighters[index4];
                                    if (fighter != null && !fighter.onboardCarrier && fighter.pursuers.length < 2 && !fighter.hasBeenDestroyed) {
                                        assignAttackTarget(theFighter, fighter);
                                        assignCAP(galaxy, theFighter);
                                        return;
                                    }
                                }
                            }
                        }
                    } else {
                        if (isInterceptor && theFighter.parentBuiltObject!.name.includes('*')) break;
                        if (parentBuiltObject.currentTarget === threat) {
                            assignAttackTarget(theFighter, threat);
                            break;
                        }
                        if (!fighterEvaluateAdequateAttackers(galaxy, theFighter, threat)) {
                            assignAttackTarget(theFighter, threat);
                            break;
                        }
                    }
                }
            }
        } else {
            let flag = false;
            const ct = theFighter.currentTarget;
            if (isBuiltObject(ct)) {
                if (ct.currentShields <= Math.fround(Math.fround(ct.shieldsCapacity) * F_0_5)) flag = true;
            } else if (isFighter(ct)) {
                if (ct.currentShields <= Math.fround(Math.fround(ct.specification.shieldsCapacity) * F_0_5)) flag = true;
            } else if (isCreature(ct)) {
                if (ct.damage >= ct.damageKillThreshold * 0.5) flag = true;
            }
            if (!flag) {
                const threatLevel1 = determineThreatLevel(galaxy, ct, parentBuiltObject);
                let num = 4.0;
                if (targetTopSpeed(ct) <= 0) num = 6.0;
                else if (isFighter(ct)) num = 10.0;
                const threatLevels = parentBuiltObject.threatLevels ?? [];
                for (let index5 = 0; index5 < threats.length; ++index5) {
                    const threat = threats[index5];
                    const threatLevel2 = threatLevels[index5];
                    if (threat != null && !threat.hasBeenDestroyed && threatLevel1 * num < threatLevel2 && ct !== threat && fighterShouldAttack(galaxy, theFighter, threat, xpos, ypos, maximumTargetRange)) {
                        if (isInterceptor && isBuiltObject(threat)) {
                            const fighters = fightersOf(threat);
                            if (fighters !== null && fighters.length > 0) {
                                for (let index6 = 0; index6 < fighters.length; ++index6) {
                                    const fighter = fighters[index6];
                                    if (fighter != null && !fighter.onboardCarrier && fighter.pursuers.length < 2 && !fighter.hasBeenDestroyed) {
                                        assignAttackTarget(theFighter, fighter);
                                        assignCAP(galaxy, theFighter);
                                        return;
                                    }
                                }
                            }
                        }
                        if (!fighterEvaluateAdequateAttackers(galaxy, theFighter, threat)) {
                            assignAttackTarget(theFighter, threat);
                            assignCAP(galaxy, theFighter);
                            break;
                        }
                    }
                }
            }
        }
    } else if (parentBuiltObject.currentTarget !== null && theFighter.currentTarget === null) {
        assignAttackTarget(theFighter, parentBuiltObject.currentTarget as FighterTarget);
        assignCAP(galaxy, theFighter);
    }
}

/** BaconFighter.cs 776 AssignCAP(fighter). Clock Rnd (seed-derived here): Next(list.Count) when retargeting. */
function assignCAP(galaxy: Galaxy, fighter: Fighter): void {
    // 778-793 try { … } catch { myMain._Game.Galaxy.Pause(); } — nothing here throws.
    const parent = fighter.parentBuiltObject;
    if (fighter.specification.type !== FighterType.Interceptor || parent === null || parent.hasBeenDestroyed || parent.pursuers === null || parent.pursuers.length <= 0) return;
    const list = parent.pursuers.filter((x) => isFighter(x) && x.specification.type === FighterType.Bomber) as Fighter[];
    if (list.length === 0) return;
    const random = assignCapClockRnd(galaxy);
    if (!list.includes(fighter.currentTarget as Fighter)) assignAttackTarget(fighter, list[random.next(list.length)]);
}

/** BaconFighter.cs 796 ShouldAttack(fighter, potentialTarget, carrierX, carrierY, maximumTargetDistanceSquared, galaxy) (Fighter.cs 570's Bacon override). */
export function fighterShouldAttack(galaxy: Galaxy, fighter: Fighter, potentialTarget: CarrierThreat, carrierX: number, carrierY: number, maximumTargetDistanceSquared: number): boolean {
    const empire = fighter.empire;
    if (empire !== null && fighter.missionType !== FighterMissionType.ReturnToCarrier) {
        if (isCreature(potentialTarget)) {
            const creature = potentialTarget;
            return creature.isVisible && galaxy.calculateDistanceSquared(carrierX, carrierY, creature.xpos, creature.ypos) <= maximumTargetDistanceSquared;
        }
        const builtObject = potentialTarget;
        if (
            empire === builtObject.empire ||
            builtObject.empire === null ||
            builtObject.empire === galaxy.independentEmpire ||
            (builtObject.pirateEmpireId > 0 && fighter.parentBuiltObject !== null && builtObject.pirateEmpireId === fighter.parentBuiltObject.pirateEmpireId) ||
            (builtObject.empire.pirateEmpireBaseHabitat !== null && obtainPirateRelation(builtObject.empire, empire).type === PirateRelationType.Protection) ||
            (empire.pirateEmpireBaseHabitat !== null && obtainPirateRelation(empire, builtObject.empire).type === PirateRelationType.Protection) ||
            galaxy.calculateDistanceSquared(carrierX, carrierY, builtObject.xpos, builtObject.ypos) > maximumTargetDistanceSquared
        ) {
            return false;
        }
        if (empire.outlaws.includes(builtObject)) {
            if (empire !== builtObject.empire) return true;
            removeFirst(empire.outlaws, builtObject);
            return false;
        }
        if (fighter.attackers.includes(builtObject)) return true;
        const diplomaticRelation = empire.diplomaticRelations.byEmpire(builtObject.empire);
        if (builtObject.empire.pirateEmpireBaseHabitat !== null || (empire.pirateEmpireBaseHabitat !== null && builtObject.empire !== empire)) return true;
        if (diplomaticRelation !== null) {
            if (diplomaticRelation.type === DiplomaticRelationType.War) return true;
            if (fighter.missionType === FighterMissionType.Attack) {
                let empire2: Empire | null = null;
                if (fighter.currentTarget !== null) empire2 = targetEmpire(fighter.currentTarget);
                if (builtObject.empire === empire2) return true;
            }
            return fighter.parentBuiltObject !== null && fighter.parentBuiltObject.currentTarget !== null && fighter.parentBuiltObject.currentTarget === potentialTarget;
        }
    }
    return false;
}

/** StellarObject.IsFunctional over the pursuer union (a Fighter never sets it; a Creature's FirepowerRaw is 0 first). */
function pursuerIsFunctional(o: FighterTarget): boolean {
    if (isBuiltObject(o)) return o.isFunctional;
    if (isFighter(o)) return o.isFunctional;
    return false;
}
function pursuerFirepowerRaw(o: FighterTarget): number {
    if (isBuiltObject(o) || isFighter(o)) return o.firepowerRaw;
    return 0;
}

/** Fighter.cs 528 DetermineAttackingFirepower(galaxy, potentialTarget, out closestAttackerDistance). */
function determineAttackingFirepower(galaxy: Galaxy, potentialTarget: CarrierThreat): { firepower: number; closestAttackerDistance: number } {
    let num = 0;
    let closestAttackerDistance = 536870911.0;
    const pursuers = pursuersOf(potentialTarget);
    if (potentialTarget !== null && pursuers !== null) {
        for (let i = 0; i < pursuers.length; i++) {
            const stellarObject = pursuers[i] as FighterTarget | null;
            if (stellarObject == null || pursuerFirepowerRaw(stellarObject) <= 0 || targetTopSpeed(stellarObject) <= 0 || !pursuerIsFunctional(stellarObject)) continue;
            const num2 = galaxy.calculateDistance(stellarObject.xpos, stellarObject.ypos, potentialTarget.xpos, potentialTarget.ypos);
            if (num2 < ATTACK_EVALUATION_RANGE_FACTOR) {
                let num3 = pursuerFirepowerRaw(stellarObject);
                if (isBuiltObject(stellarObject)) {
                    num3 = calculateOverallStrengthFactor(stellarObject);
                } else if (isCreature(stellarObject)) {
                    num3 = stellarObject.attackStrength * 5;
                    if (stellarObject.type === CreatureType.SilverMist) num3 *= 4;
                }
                num += num3;
            }
            if (num2 < closestAttackerDistance) closestAttackerDistance = num2;
        }
    }
    return { firepower: num, closestAttackerDistance };
}

/** BaconFighter.cs 844 EvaluateAdequateAttackers(fighter, galaxy, potentialTarget) (Fighter.cs 523). */
function fighterEvaluateAdequateAttackers(galaxy: Galaxy, fighter: Fighter, potentialTarget: CarrierThreat): boolean {
    const r = determineAttackingFirepower(galaxy, potentialTarget);
    const attackingFirepower = r.firepower;
    const closestAttackerDistance = r.closestAttackerDistance;
    let num1 = pursuerFirepowerRaw(potentialTarget);
    if (isBuiltObject(potentialTarget)) {
        num1 = calculateOverallStrengthFactor(potentialTarget);
    } else if (isCreature(potentialTarget)) {
        num1 = potentialTarget.attackStrength * 5;
        if (potentialTarget.type === CreatureType.SilverMist) num1 *= 4;
    }
    const num2 = fighter.empire === null ? csInt(num1 * ATTACK_OVERMATCH_FACTOR) + 1 : csInt(num1 * fighter.empire.attackOvermatchFactor) + 1;
    if (
        attackingFirepower < num2 ||
        (closestAttackerDistance * closestAttackerDistance > STRIKE_RANGE_SQUARED &&
            galaxy.calculateDistanceSquared(potentialTarget.xpos, potentialTarget.ypos, fighter.xpos, fighter.ypos) < STRIKE_RANGE_SQUARED)
    ) {
        return false;
    }
    let num3 = 900000.0;
    if (isBuiltObject(potentialTarget)) {
        const builtObject = potentialTarget;
        if (builtObject.pursuers !== null) {
            let flag = false;
            for (const pursuer of builtObject.pursuers as FighterTarget[]) {
                if (isBuiltObject(pursuer)) {
                    // 874: `((BuiltObject)pursuer).Mission.Type` — a pursuer with no mission is a C# NullReferenceException;
                    // treated here as "not a Capture mission".
                    const mission = builtObjectMission(pursuer.mission);
                    if (mission !== null && mission.type === BuiltObjectMissionType.Capture) {
                        flag = true;
                        break;
                    }
                    const num4 = galaxy.calculateDistanceSquared(builtObject.xpos, builtObject.ypos, pursuer.xpos, pursuer.ypos) / Math.max(10, pursuer.currentSpeed);
                    if (num4 < num3) num3 = num4;
                }
            }
            const num5 = galaxy.calculateDistanceSquared(builtObject.xpos, builtObject.ypos, fighter.xpos, fighter.ypos) / Math.max(10, fighter.currentSpeed);
            if (!flag && num5 < num3) return false;
        }
    }
    return true;
}

/**
 * Galaxy.7.cs 3506 DetermineThreatLevel(Fighter fighter, object target, Empire empire, targetX, targetY, scanRangeSquared, …)
 * (reached from threats.ts determineThreatLevel for a fighter threat).
 */
export function determineThreatLevelFighter(galaxy: Galaxy, fighter: Fighter, target: ThreatTarget, empire: Empire | null, targetX: number, targetY: number, scanRangeSquared: number): number {
    void target;
    if (empire !== fighter.empire) {
        const num = galaxy.calculateDistanceSquared(fighter.xpos, fighter.ypos, targetX, targetY);
        if (num <= scanRangeSquared) {
            const num2 = Math.sqrt(num);
            const num3 = THREAT_RANGE / 2.0;
            let num4 = Math.max(1.0, num3 - num2);
            num4 *= num4;
            num4 /= 1000000.0;
            let num5 = 1;
            let num6 = 0;
            if (fighter.empire === null) {
                num5 = 0;
            } else if (fighter.empire === galaxy.independentEmpire) {
                num5 = 1;
            } else if (empire === null) {
                num5 = 1;
            } else if (empire.pirateEmpireBaseHabitat !== null && fighter.empire !== empire && fighter.empire !== null) {
                num5 = 50;
                num6 = 1;
                const pirateRelation = obtainPirateRelation(empire, fighter.empire);
                switch (pirateRelation.type) {
                    case PirateRelationType.NotMet:
                        doEmpireEncounter(galaxy, empire, fighter.empire, fighter);
                        break;
                    case PirateRelationType.Protection:
                        num5 = 0;
                        break;
                }
            } else if (fighter.empire.pirateEmpireBaseHabitat !== null) {
                num5 = 50;
                if (!empire.knownPirateEmpires.includes(fighter.empire)) {
                    doSuperPirateEmpireEncounter(galaxy, empire, fighter.empire, targetX, targetY);
                    empire.knownPirateEmpires.push(fighter.empire);
                }
                if (fighter.empire !== null) {
                    const pirateRelation2 = obtainPirateRelation(empire, fighter.empire);
                    switch (pirateRelation2.type) {
                        case PirateRelationType.NotMet:
                            doEmpireEncounter(galaxy, empire, fighter.empire, fighter);
                            break;
                        case PirateRelationType.Protection:
                            num5 = 0;
                            break;
                    }
                }
                if (empire === galaxy.independentEmpire) num5 = 0;
            } else {
                const diplomaticRelation = empire.diplomaticRelations.byEmpire(fighter.empire);
                num5 = 1;
                if (diplomaticRelation !== null) {
                    switch (diplomaticRelation.type) {
                        case DiplomaticRelationType.FreeTradeAgreement:
                        case DiplomaticRelationType.MutualDefensePact:
                        case DiplomaticRelationType.SubjugatedDominion:
                        case DiplomaticRelationType.Protectorate:
                            num5 = 0;
                            break;
                        case DiplomaticRelationType.None:
                            num5 = 1;
                            break;
                        case DiplomaticRelationType.TradeSanctions:
                            num5 = 5;
                            break;
                        case DiplomaticRelationType.Truce:
                            num5 = 10;
                            break;
                        case DiplomaticRelationType.War:
                            num5 = 100;
                            break;
                        case DiplomaticRelationType.NotMet:
                            num5 = 1;
                            diplomaticRelation.type = DiplomaticRelationType.None;
                            doEmpireEncounter(galaxy, empire, fighter.empire, fighter);
                            break;
                    }
                } else {
                    if (fighter.empire !== galaxy.independentEmpire) num5 = 1;
                    doEmpireEncounter(galaxy, empire, fighter.empire, fighter);
                }
            }
            num6 = 1;
            if (fighter.firepowerRaw > 0) num6 = Math.max(5, Math.trunc(fighter.size / 10));
            let num7 = Math.trunc(num4 * num5 * num6);
            if (num6 > 0) num7 = Math.max(1, num7);
            return num7;
        }
    }
    return 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Pursuit and firing (BaconFighter.cs 458-774, Fighter.cs 1577)
// ---------------------------------------------------------------------------------------------------------------

/** `EvaluateThreats; if (MissionType == Undefined) MissionType = Patrol` — the retarget idiom of PursueTarget. */
function reevaluateOrPatrol(galaxy: Galaxy, fighter: Fighter): void {
    fighterEvaluateThreats(galaxy, fighter);
    if (fighter.missionType === FighterMissionType.Undefined) fighter.missionType = FighterMissionType.Patrol;
}

/** Fighter.cs 1941 PursueTarget → BaconFighter.cs 458 PursueTarget(fighter, galaxy, time). */
function pursueTarget(galaxy: Galaxy, fighter: Fighter, time: number): void {
    const currentTarget = fighter.currentTarget;
    if (currentTarget === null) {
        fighter.missionType = FighterMissionType.Undefined;
        reevaluateOrPatrol(galaxy, fighter);
        return;
    }
    if (targetHasBeenDestroyed(currentTarget) || targetEmpire(currentTarget) === fighter.empire) {
        fighter.missionType = FighterMissionType.Undefined;
        reevaluateOrPatrol(galaxy, fighter);
        return;
    }
    let num1 = 0.35;
    if (fighter.inView) num1 = 1.4;
    fighter.targetSpeed = fighter.topSpeed;
    if (isBuiltObject(currentTarget) || isCreature(currentTarget)) {
        let num2 = 0.0;
        let num3 = 0.0;
        let num4 = 0.0;
        if (isBuiltObject(currentTarget)) {
            num2 = currentTarget.xpos;
            num3 = currentTarget.ypos;
            num4 = currentTarget.heading;
        } else {
            num2 = currentTarget.xpos;
            num3 = currentTarget.ypos;
            num4 = currentTarget.currentHeading;
        }
        const weaponRange = fighter.specification.weaponRange;
        if (weaponRange > 0) {
            const distance = galaxy.calculateDistance(fighter.xpos, fighter.ypos, num2, num3);
            const angle = determineAngle(fighter.xpos, fighter.ypos, num2, num3);
            const targetSpeed = currentTarget.currentSpeed;
            if (distance < 100.0) {
                const num5 = fighter.targetHeading - angle;
                if (num5 < 0.6 && num5 > -0.6) {
                    if (num5 < 0.0) fighter.targetHeading = Math.fround(fighter.targetHeading - Math.fround(F_0_7 + randomHeadingOffset(galaxy)));
                    else fighter.targetHeading = Math.fround(fighter.targetHeading + Math.fround(F_0_7 + randomHeadingOffset(galaxy)));
                }
                fighter.targetSpeed = fighter.topSpeed;
            } else if (distance < weaponRange) {
                if (targetSpeed >= 12.0) {
                    let num6 = weaponRange;
                    if (Math.abs(num4 - angle) < 1.57) {
                        const weaponSpeed = fighter.specification.weaponSpeed;
                        const num7 = weaponRange / weaponSpeed;
                        num6 = (weaponSpeed - targetSpeed) * num7 * 0.9;
                    }
                    if (distance < num6) {
                        fighter.targetHeading = Math.fround(angle);
                        fighter.targetSpeed = Math.fround(targetSpeed + 2);
                        fighter.targetSpeed = Math.min(fighter.targetSpeed, fighter.topSpeed);
                    } else {
                        fighter.targetHeading = Math.fround(angle);
                    }
                } else if (Math.abs(fighter.heading - angle) > 1.57) {
                    fighter.targetSpeed = fighter.topSpeed;
                } else {
                    let num8 = weaponRange;
                    if (Math.abs(num4 - angle) < 1.57) {
                        const weaponSpeed = fighter.specification.weaponSpeed;
                        const num9 = weaponRange / weaponSpeed;
                        num8 = (weaponSpeed - targetSpeed) * num9 * 0.9;
                    }
                    if (distance < num8) {
                        fighter.targetSpeed = Math.fround(Math.fround(fighter.topSpeed) * F_0_5);
                        fighter.targetSpeed = Math.max(fighter.targetSpeed, Math.fround(targetSpeed + 2));
                        fighter.targetSpeed = Math.min(fighter.targetSpeed, fighter.topSpeed);
                    }
                }
                if (checkShouldFireAtCaptureTarget(galaxy, fighter, currentTarget) && Math.abs(fighter.heading - angle) < num1) {
                    fighterFireWeaponsAtTarget(galaxy, fighter, currentTarget, distance, time);
                }
            } else {
                if (distance > 15000.0) {
                    abandonAttackTarget(fighter);
                    reevaluateOrPatrol(galaxy, fighter);
                    return;
                }
                fighter.targetHeading = Math.fround(angle);
                if (targetSpeed > fighter.topSpeed && Math.abs(num4 - angle) < num1) {
                    abandonAttackTarget(fighter);
                    reevaluateOrPatrol(galaxy, fighter);
                }
            }
            slowUntilWillMeetDestination(galaxy, fighter, num2, num3);
        } else {
            returnToCarrier(fighter);
        }
    } else if (isFighter(currentTarget)) {
        const target = currentTarget;
        const weaponRange = fighter.specification.weaponRange;
        if (target.onboardCarrier) {
            abandonAttackTarget(fighter);
            reevaluateOrPatrol(galaxy, fighter);
        } else if (weaponRange > 0) {
            const distance = galaxy.calculateDistance(fighter.xpos, fighter.ypos, target.xpos, target.ypos);
            const angle = determineAngle(fighter.xpos, fighter.ypos, target.xpos, target.ypos);
            if (distance < 40.0) {
                fighter.targetSpeed = target.currentSpeed > fighter.topSpeed ? fighter.topSpeed : target.currentSpeed;
                if (Math.abs(fighter.heading - angle) < num1) fighterFireWeaponsAtTarget(galaxy, fighter, target, distance, time);
                fighter.targetHeading = Math.fround(angle);
            } else if (distance < weaponRange) {
                if (Math.abs(fighter.heading - angle) < num1) fighterFireWeaponsAtTarget(galaxy, fighter, target, distance, time);
                fighter.targetHeading = Math.fround(angle);
                fighter.targetSpeed = fighter.topSpeed;
            } else {
                if (distance > 15000.0) {
                    abandonAttackTarget(fighter);
                    reevaluateOrPatrol(galaxy, fighter);
                    return;
                }
                fighter.targetHeading = Math.fround(angle);
                fighter.targetSpeed = fighter.topSpeed;
                if (target.currentSpeed > fighter.topSpeed && Math.abs(target.heading - angle) < num1) {
                    abandonAttackTarget(fighter);
                    reevaluateOrPatrol(galaxy, fighter);
                }
            }
            slowUntilWillMeetDestination(galaxy, fighter, target.xpos, target.ypos);
        } else {
            returnToCarrier(fighter);
        }
    }
}

/**
 * BaconFighter.cs 704 FireWeaponsAtTarget(firingFighter, galaxy, target, distanceToTarget, time) (Fighter.cs 1572).
 * Rnd per weapon fired: DetermineHitTarget (NextDouble [+ Next(0, 12)]), Fire (NextDouble, Next(0, 2)), then for a
 * BuiltObject target CheckOutOfAmmo (NextDouble, weapon 0 only).
 */
export function fighterFireWeaponsAtTarget(galaxy: Galaxy, firingFighter: Fighter, target: FighterTarget | null, distanceToTarget: number, time: number): void {
    if (target === null) return;
    let flag = false;
    for (let index = 0; index < firingFighter.weapons.length; ++index) {
        const weapon = firingFighter.weapons[index];
        if (weapon.category !== ComponentCategoryType.WeaponBeam && weapon.category === ComponentCategoryType.WeaponTorpedo) flag = true;
    }
    for (let index = 0; index < firingFighter.weapons.length; ++index) {
        const weapon = firingFighter.weapons[index];
        if (!(weapon.distanceTravelled < 0.0 && distanceToTarget <= weapon.range && firingFighter.currentEnergy >= weapon.energyRequired)) continue;
        const ready = time >= weapon.lastFired + weapon.fireRate; // LastFired.AddSeconds(FireRate / 1000.0)
        if (isBuiltObject(target)) {
            if ((weapon.category === ComponentCategoryType.WeaponTorpedo || !flag) && ready) {
                const r = fighterDetermineHitTarget(galaxy, firingFighter, weapon, target, distanceToTarget);
                fighterWeaponFire(galaxy, weapon, firingFighter, target, time, r.willHit, r.hitRangeChance);
                checkOutOfAmmo(galaxy, firingFighter, index);
                if (firingFighter.parentBuiltObject !== null) modifyDiplomacyFromAttackBuiltObject(galaxy, firingFighter.parentBuiltObject, target);
            }
        } else if (isCreature(target)) {
            if ((weapon.category === ComponentCategoryType.WeaponTorpedo || !flag) && ready) {
                const r = fighterDetermineHitTarget(galaxy, firingFighter, weapon, target, distanceToTarget);
                fighterWeaponFire(galaxy, weapon, firingFighter, target, time, r.willHit, r.hitRangeChance);
            }
        } else {
            let num = 0;
            if (isFighter(target) && weapon.category === ComponentCategoryType.WeaponBeam) num = ready ? 1 : 0;
            if (num !== 0) {
                const r = fighterDetermineHitTarget(galaxy, firingFighter, weapon, target, distanceToTarget);
                fighterWeaponFire(galaxy, weapon, firingFighter, target, time, r.willHit, r.hitRangeChance);
            }
        }
    }
}

/**
 * Fighter.cs 1577 DetermineHitTarget(galaxy, weapon, target, distanceToTarget, out hitRangeChance).
 * Rnd: NextDouble, then Next(0, 12) (in either the hit or the near-miss branch when evaluated).
 */
export function fighterDetermineHitTarget(galaxy: Galaxy, fighter: Fighter, weapon: FighterWeapon, target: FighterTarget, distanceToTarget: number): { willHit: boolean; hitRangeChance: number } {
    const num = weapon.range - distanceToTarget;
    const hitRangeChance = Math.max(0.0, num / weapon.range);
    let val = 10.0 / Math.max(1.0, targetCurrentSpeed(target));
    val = Math.max(0.7, Math.min(val, 3.0));
    let num2 = 0.0;
    let shipGroup: ReturnType<typeof shipGroupOf> = null;
    let num3 = 1.0;
    if (isBuiltObject(target)) {
        const builtObject = target;
        num2 = builtObject.countermeasureModifier + builtObject.fleetCountermeasureBonus;
        num3 = captainCountermeasuresBonus(builtObject);
        if (builtObject.empire !== null) {
            num2 += (builtObject.empire.countermeasuresFactor - 1.0) * 100.0;
            if (builtObject.empire.raceEventType === RACE_EVENT_TYPE_PREDICTIVE_HISTORY) num2 += 20.0;
        }
        shipGroup = shipGroupOf(builtObject);
    } else if (isFighter(target)) {
        const fighter2 = target;
        num2 = fighter2.specification.countermeasureModifier;
        if (fighter2.parentBuiltObject !== null && !fighter2.parentBuiltObject.hasBeenDestroyed) num2 += fighter2.parentBuiltObject.fleetCountermeasureBonus;
        if (fighter2.empire !== null) {
            num2 += (fighter2.empire.countermeasuresFactor - 1.0) * 100.0;
            if (fighter2.empire.raceEventType === RACE_EVENT_TYPE_PREDICTIVE_HISTORY) num2 += 20.0;
        }
    }
    let num4 = fighter.specification.targettingModifier;
    if (fighter.empire !== null) {
        num4 += (fighter.empire.targettingFactor - 1.0) * 100.0;
        if (fighter.empire.raceEventType === RACE_EVENT_TYPE_PREDICTIVE_HISTORY) num4 += 20.0;
    }
    const num5 = (num4 - num2) / 100.0;
    let num6 = val * (hitRangeChance + galaxy.rnd.nextDouble() + num5);
    const parent = fighter.parentBuiltObject;
    if (parent !== null) {
        num6 *= captainFightersBonus(parent);
        const parentGroup = shipGroupOf(parent);
        if (parentGroup !== null) num6 *= parentGroup.fightersBonus;
    }
    if (shipGroup !== null) num6 /= shipGroup.countermeasuresBonus;
    num6 /= num3;
    if (num6 > 0.5 && galaxy.rnd.next(0, 12) === 0) num6 = 0.0;
    else if (num6 <= 0.5 && num > 0.0 && galaxy.rnd.next(0, 12) === 0) num6 = 1.0;
    return { willHit: num6 > 0.5, hitRangeChance };
}
/** RaceEventType.cs: PredictiveHistory (member 28; 0 = Undefined) — weapons.ts keeps the same constant. */
const RACE_EVENT_TYPE_PREDICTIVE_HISTORY = 28;

/**
 * BaconFighter.cs 656 CheckBomberDefensiveFire(defendingBomber, galaxy, time).
 * Rnd: Next(0, source.Count), then per tail gun DetermineHitTarget + Fire, then the Fighter InflictDamage draws on hits.
 */
export function checkBomberDefensiveFire(galaxy: Galaxy, defendingBomber: Fighter, time: number): void {
    const weapons = defendingBomber.weapons;
    if (defendingBomber.hasBeenDestroyed || defendingBomber.onboardCarrier || defendingBomber.underConstruction || weapons.length < 2 || time < weapons[1].lastFired + weapons[1].fireRate) return;
    const source: Fighter[] = [];
    const parent = defendingBomber.parentBuiltObject;
    if (parent !== null && !parent.hasBeenDestroyed) {
        const list = fightersOf(parent)!.filter((x) => !x.underConstruction && !x.onboardCarrier && x.specification.type === FighterType.Bomber);
        for (const fighter of list) {
            if (fighter.attackers !== null && fighter.attackers.length > 0) {
                for (const attacker of fighter.attackers) {
                    if (isFighter(attacker) && attacker.specification.type === FighterType.Interceptor) {
                        const range = weapons[1].range;
                        const num = range * range;
                        if (galaxy.calculateDistanceSquared(attacker.xpos, attacker.ypos, defendingBomber.xpos, defendingBomber.ypos) <= num && !source.includes(attacker)) source.push(attacker);
                    }
                }
            }
        }
    }
    if (source.length === 0) return;
    const fighter1 = source[galaxy.rnd.next(0, source.length)];
    for (let index = 1; index < weapons.length; ++index) {
        const r = fighterDetermineHitTarget(galaxy, defendingBomber, weapons[index], fighter1, weapons[index].range * 0.89999997615814209);
        fighterWeaponFire(galaxy, weapons[index], defendingBomber, fighter1, time, r.willHit, r.hitRangeChance);
    }
    for (let index = 1; index < weapons.length; ++index) {
        let rawDamage = Math.fround(weapons[index].rawDamage);
        if (defendingBomber.empire !== null && defendingBomber.empire.name.includes('Romulan')) rawDamage = Math.fround(rawDamage * 3);
        if (weapons[index].willHitTarget) {
            fighterInflictDamageFull(galaxy, defendingBomber, fighter1, rawDamage, time, Math.fround(Math.fround(weapons[index].range) * Math.fround(0.1)), false, weapons[index].heading, false);
        }
        weapons[0].resetNext = true;
    }
}

/** BaconFighter.cs 186 CheckOutOfAmmo(fighter, i). Rnd: NextDouble (weapon 0 of a fighter not yet out of ammo). */
function checkOutOfAmmo(galaxy: Galaxy, fighter: Fighter, i: number): void {
    if (i !== 0 || fighter.name.includes('*')) return;
    let num1 = Math.fround(1);
    const empire = fighter.empire;
    // 193: `empire == myMain._Game.PlayerEmpire` — custom bomber designs are a player-only feature.
    if (empire !== null && empire === galaxy.playerEmpire) {
        const customFighterDesigns = getCustomFighterDesigns(empire);
        const tuple = customFighterDesigns.find((x) => x.item1.name === fighter.name) ?? null;
        if (tuple !== null) num1 = tuple.item3;
    }
    const num2 = galaxy.rnd.nextDouble();
    if (fighter.weapons.filter((x) => x.type === ComponentType.WeaponMissile).length > 0) {
        if (num2 * num1 >= baconSettings.ammoExhaustChanceMissile) return;
        fighter.name += '*';
    } else {
        if (fighter.weapons.filter((x) => x.type === ComponentType.WeaponTorpedo).length <= 0 || num2 * num1 >= baconSettings.ammoExhaustChanceTorpedo) return;
        fighter.name += '*';
    }
}

/** BaconFighter.cs 218 ReturnToCarrierIfOutOfAmmo(fighter). */
function returnToCarrierIfOutOfAmmo(galaxy: Galaxy, fighter: Fighter): void {
    void galaxy;
    if (!fighter.name.includes('*') || fighter.weapons[0].distanceTravelled > 0.0) return;
    fighter.name = removeAll(fighter.name, '*');
    fighter.name = removeAll(fighter.name, '!');
    returnToCarrier(fighter);
}

/** BaconFighter.cs 227 AddWeaponToFighter(fighter, weaponName). */
function addWeaponToFighter(fighter: Fighter, weaponName: string): void {
    const fighterWeapon = new FighterWeapon();
    switch (weaponName) {
        case 'defensiveGun':
            fighterWeapon.category = ComponentCategoryType.WeaponBeam;
            fighterWeapon.damageLoss = 1;
            fighterWeapon.energyRequired = 0;
            fighterWeapon.fireRate = 700;
            fighterWeapon.power = 0;
            fighterWeapon.range = 100;
            fighterWeapon.rawDamage = 2;
            fighterWeapon.speed = 700;
            fighterWeapon.specialImageIndex = 0;
            fighterWeapon.type = ComponentType.WeaponBeam;
            fighter.weapons.push(fighterWeapon);
            break;
    }
}

/** BaconBuiltObject.cs 3337 GetCustomFighterDesigns(empire): the player's custom bomber designs (Tuple<spec, cost, ammo, image>). */
interface CustomFighterDesign {
    item1: FighterSpecification;
    item2: number;
    item3: number;
    item4: number;
}
function getCustomFighterDesigns(empire: Empire): CustomFighterDesign[] {
    let customFighterDesigns: CustomFighterDesign[] = [];
    if (empire.pirateEmpireBaseHabitat === null) {
        const capital = empire.capital as (Habitat & { baconValues?: Map<string, unknown> | null }) | null;
        if (capital !== null && capital.baconValues != null && capital.baconValues.has('customBomberDesigns')) customFighterDesigns = capital.baconValues.get('customBomberDesigns') as CustomFighterDesign[];
    } else if (empire.builtObjects !== null && empire.builtObjects.length > 0 && empire.builtObjects[0].baconValues !== null && empire.builtObjects[0].baconValues.has('customBomberDesigns')) {
        customFighterDesigns = empire.builtObjects[0].baconValues.get('customBomberDesigns') as CustomFighterDesign[];
    }
    return customFighterDesigns;
}

// ---------------------------------------------------------------------------------------------------------------
// Weapons in flight, damage, explosions (Fighter.cs 668-1570)
// ---------------------------------------------------------------------------------------------------------------

/** The target-destroyed branch shared by the beam and torpedo cases of Fighter.cs HandleWeaponsFiring (738-770 / 832-864). */
function onFighterWeaponTargetDestroyed(galaxy: Galaxy, fighter: Fighter, builtObject: BuiltObject): void {
    const empire = fighter.empire;
    if (builtObject.empire !== null && builtObject.empire.pirateEmpireBaseHabitat !== null && empire !== null && empire.pirateEmpireBaseHabitat !== null && empire.pirateEmpireSuperPirates) {
        let flag = false;
        switch (builtObject.subRole) {
            case BuiltObjectSubRole.SmallSpacePort:
            case BuiltObjectSubRole.MediumSpacePort:
            case BuiltObjectSubRole.LargeSpacePort:
                flag = true;
                break;
        }
        if (flag && galaxy.rnd.next(0, 4) === 1) fearfulPirateFactionJoinsPlayer(galaxy, empire, builtObject.empire);
    }
    fighterProvideBonusFromPirateBase(galaxy, fighter, empire, builtObject);
    if (empire !== null && empire.pirateEmpireBaseHabitat !== null) {
        let num = calculateBuiltObjectLootingValue(builtObject);
        num *= empireColonyIncomeFactor(empire);
        num *= empireLootingFactor(empire);
        num = applyCorruptionToIncome(empire, num);
        empire.stateMoney += num;
        empire.pirateEconomy.performIncome(num, PirateIncomeType.Looting, galaxyStarDate(galaxy));
        const byAttackTarget = empire.pirateMissions.getByAttackTarget(builtObject, empire);
        if (byAttackTarget !== null) completePirateMission(galaxy, empire, byAttackTarget);
    }
}

/** ParentBuiltObject.BattleStats.WeaponMissEnemy() and its fleet's (Fighter.cs 777-785). */
function parentWeaponMiss(fighter: Fighter): void {
    const parent = fighter.parentBuiltObject;
    const stats = parent !== null ? battleStatsOf(parent) : null;
    if (stats !== null) stats.weaponMissEnemy();
    const groupStats = parent !== null ? shipGroupBattleStats(parent) : null;
    if (groupStats !== null) groupStats.weaponMissEnemy();
}

/**
 * Fighter.cs 668 HandleWeaponsFiring(galaxy, time, timePassed). Rnd: only in the hit branches (InflictDamage draws, the
 * phantom-pirate Next(0, 4), ProvideBonusFromPirateBase).
 */
export function fighterHandleWeaponsFiring(galaxy: Galaxy, fighter: Fighter, time: number, timePassed: number): void {
    for (let i = 0; i < fighter.weapons.length; i++) {
        if (fighter.hasBeenDestroyed) break;
        const fighterWeapon = fighter.weapons[i];
        if (fighterWeapon == null) continue;
        if (fighterWeapon.resetNext) {
            fighterWeapon.reset();
            continue;
        }
        if (fighter.currentTarget === null || targetHasBeenDestroyed(fighter.currentTarget)) fighterWeapon.resetNext = true;
        const currentTarget = fighter.currentTarget;
        if (!(fighterWeapon.distanceTravelled >= 0)) continue;
        let val = Math.fround((time - fighterWeapon.lastFired) / 1000);
        val = Math.min(val, Math.fround(timePassed));
        let flag = false;
        let num = TORPEDO_WEAPON_HIT_RANGE * 4.0;
        if (fighter.inView) num = TORPEDO_WEAPON_HIT_RANGE;
        switch (fighterWeapon.category) {
            case ComponentCategoryType.WeaponBeam: {
                let num2: number;
                if (fighterWeapon.distanceTravelled <= 1) {
                    flag = true;
                    num2 = 2;
                } else {
                    num2 = Math.fround(fighterWeapon.speed * val);
                }
                fighterWeapon.distanceTravelled = Math.fround(fighterWeapon.distanceTravelled + num2);
                const distanceFromTarget = fighterWeapon.distanceFromTarget;
                fighterWeapon.x = Math.fround(fighterWeapon.x + Math.fround(Math.fround(Math.cos(fighterWeapon.heading)) * num2));
                fighterWeapon.y = Math.fround(fighterWeapon.y + Math.fround(Math.fround(Math.sin(fighterWeapon.heading)) * num2));
                if (currentTarget !== null) fighterWeapon.distanceFromTarget = Math.fround(galaxy.calculateDistance(fighterWeapon.x, fighterWeapon.y, currentTarget.xpos, currentTarget.ypos));
                fighterWeapon.power = Math.fround(Math.fround(fighterWeapon.rawDamage) - Math.fround(Math.fround(fighterWeapon.distanceTravelled / 100) * fighterWeapon.damageLoss));
                if (fighterWeapon.willHitTarget && !flag) {
                    let flag4 = false;
                    if (fighter.inView) {
                        if (fighterWeapon.distanceFromTarget <= num) flag4 = true;
                    } else if (distanceFromTarget < fighterWeapon.distanceFromTarget || fighterWeapon.distanceFromTarget <= num) {
                        flag4 = true;
                    }
                    if (flag4) {
                        if (currentTarget !== null && fighterInflictDamage(galaxy, fighter, currentTarget, fighterWeapon.power, time, fighterWeapon.distanceTravelled, fighterWeapon.heading)) {
                            if (isBuiltObject(currentTarget)) onFighterWeaponTargetDestroyed(galaxy, fighter, currentTarget);
                            fighter.currentTarget = null;
                        }
                        fighterWeapon.resetNext = true;
                    }
                }
                if (fighterWeapon.distanceTravelled > fighterWeapon.range) {
                    parentWeaponMiss(fighter);
                    fighterWeapon.resetNext = true;
                }
                break;
            }
            case ComponentCategoryType.WeaponTorpedo: {
                let num2: number;
                if (fighterWeapon.distanceTravelled <= 1) {
                    flag = true;
                    num2 = 10;
                } else {
                    num2 = Math.fround(fighterWeapon.speed * val);
                }
                const heading = fighterWeapon.heading;
                if (!fighterWeapon.hasMissed && currentTarget !== null) {
                    fighterWeapon.heading = Math.fround(fighterWeapon.headingMissFactor + Math.fround(determineAngle(fighterWeapon.x, fighterWeapon.y, currentTarget.xpos, currentTarget.ypos)));
                }
                fighterWeapon.distanceTravelled = Math.fround(fighterWeapon.distanceTravelled + num2);
                const distanceFromTarget = fighterWeapon.distanceFromTarget;
                fighterWeapon.x = Math.fround(fighterWeapon.x + Math.fround(Math.fround(Math.cos(fighterWeapon.heading)) * num2));
                fighterWeapon.y = Math.fround(fighterWeapon.y + Math.fround(Math.fround(Math.sin(fighterWeapon.heading)) * num2));
                if (currentTarget !== null) fighterWeapon.distanceFromTarget = Math.fround(galaxy.calculateDistance(fighterWeapon.x, fighterWeapon.y, currentTarget.xpos, currentTarget.ypos));
                fighterWeapon.power = Math.fround(Math.fround(fighterWeapon.rawDamage) - Math.fround(Math.fround(fighterWeapon.distanceTravelled / 100) * fighterWeapon.damageLoss));
                if (fighterWeapon.willHitTarget) {
                    if (!flag) {
                        let flag2 = false;
                        if (fighter.inView && fighterWeapon.distanceFromTarget <= num) flag2 = true;
                        else if (distanceFromTarget < fighterWeapon.distanceFromTarget || num2 > distanceFromTarget) flag2 = true;
                        if (flag2) {
                            if (currentTarget !== null && fighterInflictDamage(galaxy, fighter, currentTarget, fighterWeapon.power, time, fighterWeapon.distanceTravelled, fighterWeapon.heading)) {
                                if (isBuiltObject(currentTarget)) onFighterWeaponTargetDestroyed(galaxy, fighter, currentTarget);
                                fighter.currentTarget = null;
                            }
                            fighterWeapon.resetNext = true;
                        }
                    }
                } else if (fighterWeapon.hasMissed) {
                    fighterWeapon.heading = heading;
                } else if (distanceFromTarget < fighterWeapon.distanceFromTarget || num2 > distanceFromTarget) {
                    fighterWeapon.hasMissed = true;
                    fighterWeapon.heading = heading;
                }
                if (fighterWeapon.distanceTravelled > fighterWeapon.range) {
                    parentWeaponMiss(fighter);
                    fighterWeapon.resetNext = true;
                }
                break;
            }
        }
    }
}

/** Fighter.cs 1099 InflictDamage(target, hitPower, time, galaxy, weaponDistanceTravelled, strikeAngle) = allowRecursion, no armor invulnerability. */
function fighterInflictDamage(galaxy: Galaxy, self: Fighter, target: FighterTarget, hitPower: number, time: number, weaponDistanceTravelled: number, strikeAngle: number): boolean {
    return fighterInflictDamageFull(galaxy, self, target, hitPower, time, weaponDistanceTravelled, true, strikeAngle, false);
}

/** BuiltObjectComponentList[category, status]: the first component with both. */
function firstComponentByCategoryAndStatus(bo: BuiltObject, category: ComponentCategoryType, status: ComponentStatus) {
    const items = bo.components.items;
    for (let i = 0; i < items.length; i++) {
        if (items[i].category === category && items[i].status === status) return items[i];
    }
    return null;
}

/**
 * Fighter.cs 1104 InflictDamage(abstractTarget, hitPower, time, galaxy, weaponDistanceTravelled, allowRecursion, strikeAngle,
 * allowArmorInvulnerability). Returns true when the target was destroyed.
 * Rnd: CheckForLevelGain (clock, seed-derived) [+ GainFighterLevel's GenerateUniqueAgentName]; Fighter target: Next(10, 20) or
 * Next(0, 10), Next(0, n), Next(0, 2), Next(0, n), Next(0, 2); BuiltObject target: armor NextDouble rolls, then destroyed →
 * Next(10, 20), else component Next(0, Components.Count)×k [+ Next(0, Troops.Count)] and the 5-draw explosion.
 */
export function fighterInflictDamageFull(
    galaxy: Galaxy,
    self: Fighter,
    abstractTarget: FighterTarget,
    hitPower: number,
    time: number,
    weaponDistanceTravelled: number,
    allowRecursion: boolean,
    strikeAngle: number,
    allowArmorInvulnerability: boolean,
): boolean {
    hitPower *= inflictDamageFighterMultiplier(self);
    checkForLevelGain(galaxy, self, hitPower);
    const parent = self.parentBuiltObject;
    if (parent !== null) {
        hitPower *= captainFightersBonus(parent);
        const parentGroup = shipGroupOf(parent);
        if (parentGroup !== null) hitPower *= parentGroup.fightersBonus;
    }
    const selfStats = parent !== null ? battleStatsOf(parent) : null;
    const selfGroupStats = parent !== null ? shipGroupBattleStats(parent) : null;
    if (isCreature(abstractTarget)) {
        const creature = abstractTarget;
        // Fighter.cs 1119 creature.DamageCreature(this, (int)hitPower, null).
        if (creature.damageCreature(self, csInt(hitPower), null)) {
            if (creature.type === CreatureType.SilverMist && self.empire !== null) setCivilityRating(self.empire, self.empire.civilityRating + DESTROY_SILVER_MIST_REPUTATION_BONUS);
            creature.completeTeardown();
            return true;
        }
    } else if (isFighter(abstractTarget)) {
        const fighter = abstractTarget;
        if (selfStats !== null) selfStats.weaponHitEnemy(hitPower, weaponDistanceTravelled);
        if (selfGroupStats !== null) selfGroupStats.weaponHitEnemy(hitPower, weaponDistanceTravelled);
        const fParent = fighter.parentBuiltObject;
        const parentStats = fParent !== null ? battleStatsOf(fParent) : null;
        const parentGroupStats = fParent !== null ? shipGroupBattleStats(fParent) : null;
        if (fighter.currentShields >= hitPower) {
            fighter.currentShields = Math.fround(fighter.currentShields - Math.fround(hitPower));
            fighter.lastShieldStrike = time;
            fighter.lastShieldStrikeDirection = Math.fround(strikeAngle);
            if (parentStats !== null) parentStats.shieldsStruckUs(hitPower);
            if (parentGroupStats !== null) parentGroupStats.shieldsStruckUs(hitPower);
        } else {
            let num = csInt(Math.fround(Math.fround(Math.fround(hitPower) - fighter.currentShields) + 0.5));
            if (parentStats !== null) parentStats.shieldsStruckUs(fighter.currentShields);
            if (parentGroupStats !== null) parentGroupStats.shieldsStruckUs(fighter.currentShields);
            fighter.currentShields = 0;
            if (num > fighter.size) num = fighter.size;
            if (parentStats !== null) parentStats.damageHullUs(num);
            if (parentGroupStats !== null) parentGroupStats.damageHullUs(num);
            if (fighter.size <= num && !fighter.hasBeenDestroyed) {
                fighter.health = 0;
                fighter.hasBeenDestroyed = true;
                if (selfStats !== null) selfStats.fighterDestroyedEnemy();
                if (selfGroupStats !== null) selfGroupStats.fighterDestroyedEnemy();
                if (parentStats !== null) parentStats.fighterDestroyedFriendly();
                if (parentGroupStats !== null) parentGroupStats.fighterDestroyedFriendly();
                if (self.empire !== null && self.empire !== galaxy.independentEmpire && fighter.empire !== null && fighter.empire.pirateEmpireBaseHabitat !== null) {
                    const num2 = 0.015;
                    setCivilityRating(self.empire, self.empire.civilityRating + num2);
                }
                const explosion = new Explosion();
                explosion.explosionStart = time;
                explosion.explosionSize = toShort(Math.trunc(Math.sqrt(fighter.size * 0.3) * (Math.PI / 4.0) * 30.0));
                explosion.explosionProgression = 0;
                explosion.explosionOffsetX = 0;
                explosion.explosionOffsetY = 0;
                explosion.explosionImageIndex = toShort(galaxy.rnd.next(10, 20));
                explosion.explosionWillDestroy = true;
                fighter.explosions.push(explosion);
                inflictWarDamageFighter(galaxy, self.empire, fighter);
                if (fighter.empire !== null) fighter.empire.visibility.resolveSystemVisibilityAt(fighter.xpos, fighter.ypos, null, null);
                return true;
            }
            fighter.health = Math.fround(fighter.health - Math.fround(num / fighter.size));
            fighter.overlayChanged = true;
            const explosion2 = new Explosion();
            explosion2.explosionStart = time;
            explosion2.explosionSize = toShort(Math.trunc(Math.sqrt(num * 0.3) * (Math.PI / 4.0) * 30.0));
            if (explosion2.explosionSize < 5) explosion2.explosionSize = 5;
            explosion2.explosionProgression = 0;
            explosion2.explosionImageIndex = toShort(galaxy.rnd.next(0, 10));
            let num3 = galaxy.rnd.next(0, csInt(Math.sqrt(fighter.size) * 0.7));
            if (galaxy.rnd.next(0, 2) === 0) num3 *= -1;
            let num4 = galaxy.rnd.next(0, csInt(Math.sqrt(fighter.size) * 0.7));
            if (galaxy.rnd.next(0, 2) === 0) num4 *= -1;
            explosion2.explosionOffsetX = toShort(num3);
            explosion2.explosionOffsetY = toShort(num4);
            explosion2.explosionWillDestroy = false;
            fighter.explosions.push(explosion2);
        }
    } else if (isBuiltObject(abstractTarget)) {
        const builtObject = abstractTarget;
        if (selfStats !== null) selfStats.weaponHitEnemy(hitPower, weaponDistanceTravelled);
        if (selfGroupStats !== null) selfGroupStats.weaponHitEnemy(hitPower, weaponDistanceTravelled);
        const targetStats = battleStatsOf(builtObject);
        const targetGroupStats = shipGroupBattleStats(builtObject);
        if (builtObject.currentShields >= hitPower) {
            builtObject.currentShields = Math.fround(builtObject.currentShields - Math.fround(hitPower));
            builtObject.lastShieldStrike = time;
            builtObject.lastShieldStrikeDirection = Math.fround(strikeAngle);
            if (targetStats !== null) targetStats.shieldsStruckUs(hitPower);
            if (targetGroupStats !== null) targetGroupStats.shieldsStruckUs(hitPower);
            chanceAttackedPirateFactionJoinsPhantomPirates(galaxy, self.empire, builtObject);
        } else {
            let num5 = csInt(Math.fround(Math.fround(Math.fround(hitPower) - builtObject.currentShields) + 0.5));
            if (targetStats !== null) targetStats.shieldsStruckUs(builtObject.currentShields);
            if (targetGroupStats !== null) targetGroupStats.shieldsStruckUs(builtObject.currentShields);
            builtObject.currentShields = 0;
            if (builtObject.damageRepair > 0 && builtObject.damagedComponentCount === 0) builtObject.lastRepair = galaxyStarDate(galaxy);
            if (builtObject.armor > 0) {
                let builtObjectComponent = firstComponentByCategoryAndStatus(builtObject, ComponentCategoryType.Armor, ComponentStatus.Normal);
                const iterationCount = { count: 0 };
                while (conditionCheckLimit(builtObjectComponent !== null && num5 > 0, 200, iterationCount)) {
                    if (builtObjectComponent!.value2 > 0) {
                        let num7 = builtObjectComponent!.value2;
                        if (builtObject.armorReinforcingFactor > 0) num7 = csInt(num7 * (builtObject.armorReinforcingFactor / 100.0));
                        if (num5 <= num7) {
                            if (allowArmorInvulnerability) {
                                num5 = 0;
                            } else {
                                const num8 = num7 / num5;
                                const num9 = galaxy.rnd.nextDouble() * num8;
                                num5 = num9 < 0.2 ? 1 : 0;
                            }
                        } else {
                            num5 -= num7;
                        }
                    }
                    if (num5 > 0) {
                        let num10 = builtObjectComponent!.value1;
                        if (builtObject.armorReinforcingFactor > 0) num10 = csInt(num10 * (builtObject.armorReinforcingFactor / 100.0));
                        let val = num5 / num10;
                        val = Math.max(0.1, val);
                        if (galaxy.rnd.nextDouble() < val) builtObjectComponent!.status = ComponentStatus.Damaged;
                        num5 -= num10;
                        builtObjectComponent = firstComponentByCategoryAndStatus(builtObject, ComponentCategoryType.Armor, ComponentStatus.Normal);
                    }
                }
            }
            let num11 = builtObject.damageReduction;
            const targetShipGroup = shipGroupOf(builtObject);
            if (targetShipGroup !== null) num11 *= targetShipGroup.damageControlBonus;
            num11 *= captainDamageControlBonus(builtObject);
            num5 = csInt(num5 + 0.49 - num5 * num11);
            if (num5 > builtObject.size) num5 = builtObject.size;
            if (targetStats !== null) targetStats.damageHullUs(num5);
            if (targetGroupStats !== null) targetGroupStats.damageHullUs(num5);
            if (builtObject.undamagedComponentSize <= num5 && !builtObject.hasBeenDestroyed) {
                if (selfStats !== null) selfStats.targetDestroyedEnemyByFighter(builtObject);
                if (selfGroupStats !== null) selfGroupStats.targetDestroyedEnemyByFighter(builtObject);
                if (targetStats !== null) targetStats.targetDestroyedFriendlyByFighter(builtObject);
                if (targetGroupStats !== null) targetGroupStats.targetDestroyedFriendlyByFighter(builtObject);
                // Fighter.cs 1374 galaxy.CheckTriggerEvent(builtObject.GameEventId, Empire, Destroy, null) (story/eventActions.ts, M4z3).
                checkTriggerEvent(galaxy, builtObject.gameEventId, self.empire, EventTriggerType.Destroy, null);
                if (self.empire !== null && self.empire !== galaxy.independentEmpire && builtObject.empire !== null && builtObject.empire.pirateEmpireBaseHabitat !== null) {
                    let num12 = 0.05;
                    switch (builtObject.subRole) {
                        case BuiltObjectSubRole.SmallSpacePort:
                            num12 = 0.25;
                            break;
                        case BuiltObjectSubRole.MediumSpacePort:
                            num12 = 0.35;
                            break;
                        case BuiltObjectSubRole.LargeSpacePort:
                            num12 = 0.5;
                            break;
                    }
                    setCivilityRating(self.empire, self.empire.civilityRating + num12);
                }
                chanceRaceEvent(galaxy, builtObject, parent as BuiltObject);
                if (!chanceNewShipCaptain(galaxy, builtObject, self.empire, parent)) chanceNewFleetAdmiral(galaxy, builtObject, self.empire, parent);
                if (self.empire !== null && self.empire.counters !== null) self.empire.counters.processBuiltObjectDestruction(builtObject);
                const explosion3 = new Explosion();
                explosion3.explosionStart = time;
                explosion3.explosionSize = toShort(Math.trunc(Math.sqrt(builtObject.components.count) * (Math.PI / 4.0) * 30.0));
                explosion3.explosionProgression = 0;
                explosion3.explosionOffsetX = 0;
                explosion3.explosionOffsetY = 0;
                explosion3.explosionImageIndex = toShort(galaxy.rnd.next(10, 20));
                explosion3.explosionWillDestroy = true;
                builtObject.explosions.push(explosion3);
                builtObject.hasBeenDestroyed = true;
                inflictWarDamageBuiltObject(galaxy, self.empire, builtObject);
                if (allowRecursion) {
                    const galaxyIndex = galaxy.resolveIndex(builtObject.xpos, builtObject.ypos);
                    const cell = galaxy.builtObjectIndexGrid[galaxyIndex.x][galaxyIndex.y];
                    for (let i = 0; i < cell.length; i++) {
                        const builtObject2 = cell[i];
                        if (builtObject2 !== builtObject && checkWithinDistancePotential(400.0, builtObject.xpos, builtObject.ypos, builtObject2.xpos, builtObject2.ypos)) {
                            const num15 = galaxy.calculateDistance(builtObject.xpos, builtObject.ypos, builtObject2.xpos, builtObject2.ypos);
                            const num16 = builtObject.size * 0.25 - num15 * 2.0;
                            if (num16 > 0.0) fighterInflictDamageFull(galaxy, self, builtObject2, num16, time, weaponDistanceTravelled, false, -Number.MAX_VALUE, false);
                        }
                    }
                }
                if (builtObject.empire !== null) builtObject.empire.visibility.resolveSystemVisibilityAt(builtObject.xpos, builtObject.ypos, builtObject, null);
                const constructionQueue = builtObject.constructionQueue as { constructionYards: { shipUnderConstruction: BuiltObject | null }[] | null } | null;
                if (constructionQueue !== null && constructionQueue.constructionYards !== null && constructionQueue.constructionYards.some((y) => y.shipUnderConstruction !== null)) {
                    for (const constructionYard of constructionQueue.constructionYards) {
                        const shipUnderConstruction = constructionYard.shipUnderConstruction;
                        if (shipUnderConstruction !== null) inflictDamageFull(galaxy, shipUnderConstruction, shipUnderConstruction, null, Number.MAX_VALUE, time, weaponDistanceTravelled, false, -Number.MAX_VALUE, false);
                    }
                }
                builtObject.reDefine();
                return true;
            }
            const num17 = num5;
            const components = builtObject.components.items;
            const iterationCount2 = { count: 0 };
            while (conditionCheckLimit(num5 > 0, 200, iterationCount2)) {
                let num18 = 0;
                let num19 = 0;
                do {
                    num18 = galaxy.rnd.next(0, components.length);
                    num19++;
                } while (num19 <= 30 && num18 < components.length && components[num18].status === ComponentStatus.Damaged);
                // An empty component list is an IndexOutOfRange in C#; skipped as in damage.ts.
                if (num18 >= components.length) continue;
                // RND: `galaxy.ReseedRandom()` when every pick was damaged (Fighter.cs 1422) is not performed (plan §0).
                components[num18].status = ComponentStatus.Damaged;
                if (builtObject.role !== BuiltObjectRole.Base) {
                    switch (components[num18].type) {
                        case ComponentType.StorageCargo: {
                            let num21 = components[num18].value1;
                            if (builtObject.cargo === null || builtObject.cargo.items.length <= 0) break;
                            const cargoList: Cargo[] = [];
                            for (let j = 0; j < builtObject.cargo.items.length; j++) {
                                const cargo = builtObject.cargo.items[j];
                                if (num21 <= 0) break;
                                if (cargo.amount > num21) {
                                    cargo.amount -= num21;
                                    num21 = 0;
                                    break;
                                }
                                if (cargo.amount > 0) {
                                    num21 -= cargo.amount;
                                    cargoList.push(cargo);
                                }
                            }
                            for (const item of cargoList) builtObject.cargo.remove(item);
                            break;
                        }
                        case ComponentType.StorageFuel: {
                            const value2 = components[num18].value1;
                            if (builtObject.currentFuel > 0.0) {
                                builtObject.currentFuel -= value2;
                                if (builtObject.currentFuel < 0.0) builtObject.currentFuel = 0.0;
                            }
                            break;
                        }
                        case ComponentType.StorageTroop: {
                            const value = components[num18].value1;
                            if (builtObject.troops === null || builtObject.troopCapacity <= 0 || builtObject.troops.totalSize <= 0) break;
                            builtObject.troopCapacity -= value;
                            if (builtObject.troops.totalSize <= builtObject.troopCapacity) break;
                            const num20 = galaxy.rnd.next(0, builtObject.troops.count);
                            if (num20 < builtObject.troops.count) {
                                if (builtObject.empire !== null && builtObject.empire.troops !== null) builtObject.empire.troops.remove(builtObject.troops.items[num20]);
                                builtObject.troops.items.splice(num20, 1);
                            }
                            break;
                        }
                    }
                }
                num5 -= components[num18].size;
            }
            builtObject.reDefine();
            if (builtObject.role !== BuiltObjectRole.Base && builtObject.damagedComponentCount > 0) builtObject.repairForNextMission = true;
            const explosion4 = new Explosion();
            explosion4.explosionStart = time;
            explosion4.explosionSize = toShort(Math.trunc(Math.sqrt(num17) * (Math.PI / 4.0) * 30.0));
            if (explosion4.explosionSize < 10) explosion4.explosionSize = 10;
            explosion4.explosionProgression = 0;
            explosion4.explosionImageIndex = toShort(galaxy.rnd.next(0, 10));
            let num22 = galaxy.rnd.next(0, csInt(Math.sqrt(builtObject.size) * 0.7));
            if (galaxy.rnd.next(0, 2) === 0) num22 *= -1;
            let num23 = galaxy.rnd.next(0, csInt(Math.sqrt(builtObject.size) * 0.7));
            if (galaxy.rnd.next(0, 2) === 0) num23 *= -1;
            explosion4.explosionOffsetX = toShort(num22);
            explosion4.explosionOffsetY = toShort(num23);
            explosion4.explosionWillDestroy = false;
            builtObject.explosions.push(explosion4);
        }
    }
    return false;
}

/** Fighter.cs 1071 DoExplosions(galaxy, time). No Rnd. */
export function fighterDoExplosions(galaxy: Galaxy, fighter: Fighter, time: number): void {
    const explosionList: Explosion[] = [];
    for (let i = 0; i < fighter.explosions.length; i++) {
        const explosion = fighter.explosions[i];
        const num = (time - explosion.explosionStart) / 1000;
        explosion.explosionProgression = Math.fround(Math.max(0.0, num * 60.0));
        const num2 = Math.min(100.0, Math.max(50.0, Math.trunc(explosion.explosionSize / 2)));
        explosion.explosionCurrentImage = Math.min(toShort(EXPLOSION_IMAGE_COUNT - 1), toShort(Math.trunc((explosion.explosionProgression / num2) * EXPLOSION_IMAGE_COUNT)));
        if (explosion.explosionProgression > num2) {
            explosion.explosionSize = 0;
            explosion.explosionProgression = 0;
            explosion.explosionSoundPlayed = false;
            explosionList.push(explosion);
            if (explosion.explosionWillDestroy) fighterCompleteTeardown(galaxy, fighter);
        }
    }
    for (const item of explosionList) removeFirst(fighter.explosions, item);
}

/** Galaxy.3.cs 468 CalculateWarValue(Fighter): always 1. */
export function calculateWarValueFighter(fighter: Fighter): number {
    void fighter;
    return 1;
}

/** Galaxy.3.cs 517 InflictWarDamage(inflictingEmpire, Fighter target). */
function inflictWarDamageFighter(galaxy: Galaxy, inflictingEmpire: Empire | null, target: Fighter): void {
    void galaxy;
    if (target.empire !== null) {
        const diplomaticRelation = target.empire.diplomaticRelations.byEmpire(inflictingEmpire);
        if (diplomaticRelation !== null) diplomaticRelation.warDamageBuiltObject = (diplomaticRelation.warDamageBuiltObject + calculateWarValueFighter(target)) | 0;
    }
}

/** BaconFighter.cs 28 IsMyFighter(fighter). */
function isMyFighter(fighter: Fighter): boolean {
    return (fighter.empire !== null && fighter.empire.name.includes('Romulan')) || (fighter.owner !== null && fighter.owner.name.includes('Romulan'));
}

/** BaconFighter.cs 36 InflictDamageFighter(fighter): the damage multiplier. */
function inflictDamageFighterMultiplier(fighter: Fighter): number {
    let num = 1.0;
    if (isMyFighter(fighter)) num = MY_DAMAGE_MULTIPLIER;
    if (fighter.specification.type === FighterType.Interceptor && isFighter(fighter.currentTarget) && fighter.currentTarget.specification.type === FighterType.Bomber) num *= baconSettings.fighterOnBomberDamageMultiplier;
    return num;
}

/** BaconFighter.cs 53 CheckForLevelGain(fighter, damageInflicted). Clock Rnd (seed-derived): Next(1000). */
function checkForLevelGain(galaxy: Galaxy, fighter: Fighter, damageInflicted: number): void {
    if (levelGainClockRnd(galaxy).next(1000) >= damageInflicted) return;
    gainFighterLevel(galaxy, fighter);
}

/** BaconFighter.cs 60 GainFighterLevel(fighter). Rnd: GenerateUniqueAgentName (first level only); hash-seeded Random.Next(5). */
function gainFighterLevel(galaxy: Galaxy, fighter: Fighter): void {
    const fighterSpecification = cloneFighterSpecification(fighter.specification);
    if (!fighter.name.substring(0, 2).includes(' ')) {
        const flag = fighter.name.substring(0, 1).includes('!');
        let str = ' Ace';
        // 66: `if (BaconBuiltObject.myMain != null)` (set in a running game).
        str = generateUniqueAgentName(galaxy, 0);
        fighter.name = (flag ? '!' : '') + ' ' + str;
    }
    switch (new Random(nameHashSeed(galaxy, fighter.name)).next(5)) {
        case 0:
            fighterSpecification.topSpeed = toShort(fighterSpecification.topSpeed + 10);
            fighter.topSpeed = toShort(fighter.topSpeed + 10);
            fighterSpecification.turnRate = Math.fround(fighterSpecification.turnRate + Math.fround(0.05));
            break;
        case 1:
            fighterSpecification.shieldsCapacity = toShort(fighterSpecification.shieldsCapacity + 5);
            fighterSpecification.shieldRechargeRate = Math.fround(fighterSpecification.shieldRechargeRate + Math.fround(fighterSpecification.shieldRechargeRate / 10));
            break;
        case 2:
            fighterSpecification.energyCapacity = toShort(fighterSpecification.energyCapacity + toShort(Math.max(1, Math.trunc(fighterSpecification.energyCapacity / 10))));
            fighterSpecification.energyRechargeRate = Math.fround(fighterSpecification.energyRechargeRate + Math.max(1, Math.fround(fighterSpecification.energyRechargeRate / 10)));
            fighterSpecification.countermeasureModifier = toShort(fighterSpecification.countermeasureModifier + 3);
            fighterSpecification.targettingModifier = toShort(fighterSpecification.targettingModifier + 5);
            break;
        case 3:
            fighter.firepowerRaw += Math.max(1, toShort(Math.trunc(fighterSpecification.weaponDamage / 10)));
            fighterSpecification.weaponDamage = toShort(fighterSpecification.weaponDamage + Math.max(1, toShort(Math.trunc(fighterSpecification.weaponDamage / 10))));
            fighter.weapons[0].rawDamage = toShort(fighter.weapons[0].rawDamage + Math.max(1, toShort(Math.trunc(fighterSpecification.weaponDamage / 10))));
            break;
        case 4:
            fighterSpecification.weaponSpeed = toShort(fighterSpecification.weaponSpeed + Math.trunc(fighterSpecification.weaponSpeed / 10));
            fighterSpecification.weaponRange = toShort(fighterSpecification.weaponRange + Math.trunc(fighterSpecification.weaponRange / 10));
            break;
    }
    fighter.specification = fighterSpecification;
}

/** BaconFighter.cs 101 PayWhenFighterIsBuilt(fighter). No Rnd. */
function payWhenFighterIsBuilt(galaxy: Galaxy, fighter: Fighter): void {
    const parent = fighter.parentBuiltObject;
    if (parent === null || fighter.empire === null) return;
    if (!fightersOf(parent)!.some((x) => x.underConstruction) && fighter.empire === galaxy.playerEmpire) {
        sendMessageToEmpire(fighter.empire, fighter.empire, EmpireMessageType.Undefined, null, 'All Fighters and bombers on ' + parent.name + ' have been repaired.', { x: 0, y: 0 }, 'fighterRepaired');
    }
    let num = Math.fround(1);
    if (baconSettings.fighterBuildCost !== 0 && fighter.empire === galaxy.playerEmpire) num = getCustomBomberPriceMultiplier(fighter);
    fighter.empire.stateMoney -= baconSettings.fighterBuildCost * fighter.size * num;
}

/** BaconFighter.cs 113 GetCustomBomberPriceMultiplier(fighter). */
function getCustomBomberPriceMultiplier(fighter: Fighter): number {
    const bomberPriceMultiplier = Math.fround(1);
    const empire = fighter.empire;
    if (empire !== null) {
        const customFighterDesigns = getCustomFighterDesigns(empire);
        const tuple = customFighterDesigns.find((x) => x.item1.name === fighter.name) ?? null;
        if (tuple !== null) return tuple.item2;
    }
    return bomberPriceMultiplier;
}

/** Empire.ObtainDesignSpec(subRole) (damage.ts keeps a private copy). */
function obtainDesignSpec(empire: Empire, subRole: BuiltObjectSubRole) {
    for (let i = 0; i < empire.designSpecifications.length; i++) {
        const designSpecification = empire.designSpecifications[i];
        if (designSpecification !== null && designSpecification.subRole === subRole) return designSpecification;
    }
    return null;
}

/**
 * Fighter.cs 909 ProvideBonusFromPirateBase(galaxy, destroyingEmpire, pirateBase). `Empire` below is the fighter's empire,
 * as in the C#. Rnd (non-phantom branch): Next(0, 5); Next(0, 4); case 0: Next(0, 4) + design generation draws; case 1: NextDouble.
 */
function fighterProvideBonusFromPirateBase(galaxy: Galaxy, fighter: Fighter, destroyingEmpire: Empire | null, pirateBase: BuiltObject): void {
    if (destroyingEmpire === null || destroyingEmpire.pirateEmpireBaseHabitat !== null || pirateBase.role !== BuiltObjectRole.Base || pirateBase.empire === null || pirateBase.empire.pirateEmpireBaseHabitat === null) return;
    const empire = fighter.empire!;
    if (pirateBase.subRole === BuiltObjectSubRole.GenericBase && pirateBase.parentHabitat !== null && pirateBase.parentHabitat === pirateBase.empire.pirateEmpireBaseHabitat && pirateBase.empire.pirateEmpireSuperPirates) {
        let text = `${pirateBase.name} of the ${pirateBase.empire.name} destroyed`;
        text = text + '\n\n' + 'Your scientists acquire technology from the wreckage of the base';
        text += ' ';
        for (let i = 0; i < 6; i++) {
            const researchNode = selectRandomNextResearchProjectExcludeSuperWeapons(galaxy, empire);
            if (researchNode !== null) {
                doResearchBreakthrough(galaxy, empire, researchNode, true, true, false);
                text = text + researchNode.def.name + ', ';
            }
        }
        empire.research.update(empire.dominantRace);
        reviewDesignsBuiltObjectsImprovedComponents(empire);
        empire.reviewResearchAbilities();
        text = text.substring(0, text.length - 2);
        text = text + '\n\n' + `A great victory over the ${pirateBase.empire.name}`;
        const title = `${pirateBase.name} Destroyed` + '!';
        sendEventMessageToEmpire(destroyingEmpire, EventMessageType.GeneralDiscovery, title, text, pirateBase, pirateBase.empire.pirateEmpireBaseHabitat);
        destroyingEmpire.defeatedLegendaryPiratesCount++;
        return;
    }
    if (galaxy.rnd.next(0, 5) <= 1 || !checkEmpireHasHyperDriveTech(destroyingEmpire)) return;
    let empty = '';
    let empty2 = '';
    switch (galaxy.rnd.next(0, 4)) {
        case 0: {
            const habitat3 = findLonelyColonyLocation(galaxy, destroyingEmpire);
            const habitat4 = habitat3 !== null ? galaxy.determineHabitatSystemStar(habitat3) : null;
            const num = galaxy.rnd.next(0, 4);
            let designSpecification = null;
            let design = null;
            switch (num) {
                case 0:
                    designSpecification = obtainDesignSpec(destroyingEmpire, BuiltObjectSubRole.Destroyer);
                    design = generateDesignFromSpec(galaxy, destroyingEmpire, designSpecification, 4.0, galaxyStarDate(galaxy));
                    break;
                case 1:
                    designSpecification = obtainDesignSpec(destroyingEmpire, BuiltObjectSubRole.Cruiser);
                    design = generateDesignFromSpec(galaxy, destroyingEmpire, designSpecification, 4.0, galaxyStarDate(galaxy));
                    break;
                case 2:
                    designSpecification = getMonitoringStationDesignSpec();
                    design = generateDesignFromSpec(galaxy, destroyingEmpire, designSpecification, 4.0, galaxyStarDate(galaxy));
                    break;
                case 3:
                    designSpecification = obtainDesignSpec(destroyingEmpire, BuiltObjectSubRole.CapitalShip);
                    design = generateDesignFromSpec(galaxy, destroyingEmpire, designSpecification, 4.0, galaxyStarDate(galaxy));
                    break;
            }
            if (design !== null && habitat3 !== null && habitat4 !== null) {
                // TODO(port): ShipImageHelper.ResolveMinorShipImageIndex(subRole, largeShips: true) — its own clock-seeded Random
                // (damage.ts / designGeneration.ts use 0 too).
                design.pictureRef = 0;
                const builtObject = generateAbandonedBuiltObject(galaxy, habitat3, design);
                // ResolveSectorDescription / AddLocationHint (player map hint) are UI text — TODO(port) M9.
                empty2 = `${pirateBase.name}: a lost ${builtObject.name} lies abandoned near ${habitat4.name}`;
                empty = 'Lost Ship Location Revealed';
                sendEventMessageToEmpire(destroyingEmpire, EventMessageType.LostBuiltObjectCoordinates, empty, empty2, pirateBase, pirateBase.empire.pirateEmpireBaseHabitat);
            }
            break;
        }
        case 1: {
            let num5 = 2000.0 + galaxy.rnd.nextDouble() * 6000.0;
            num5 *= empireColonyIncomeFactor(destroyingEmpire);
            num5 *= empireLootingFactor(destroyingEmpire);
            num5 = applyCorruptionToIncome(destroyingEmpire, num5);
            destroyingEmpire.stateMoney += num5;
            destroyingEmpire.pirateEconomy.performIncome(num5, PirateIncomeType.Looting, galaxyStarDate(galaxy));
            empty2 = `${pirateBase.name}: treasure worth ${num5.toFixed(0)} recovered`;
            empty = 'Valuable Treasure Discovered';
            sendEventMessageToEmpire(destroyingEmpire, EventMessageType.TreasureFound, empty, empty2, pirateBase, pirateBase.empire.pirateEmpireBaseHabitat);
            break;
        }
        case 2: {
            if (pirateBase.empire === null || fighter.empire === null) break;
            let flag = false;
            switch (pirateBase.subRole) {
                case BuiltObjectSubRole.SmallSpacePort:
                case BuiltObjectSubRole.MediumSpacePort:
                case BuiltObjectSubRole.LargeSpacePort:
                    flag = true;
                    break;
            }
            if (flag) {
                const empire2 = pirateBase.empire;
                const num2 = Math.max(1, totalMobileMilitaryFirepower(empire.builtObjects));
                const num3 = Math.max(1, totalMobileMilitaryFirepower(empire2.builtObjects));
                const num4 = num2 / num3;
                if (num4 > 2.0 && num3 < 400 && empire2.spacePorts.length <= 1 && empire2 !== null && !empire2.pirateEmpireSuperPirates && empire2 !== galaxy.playerEmpire) {
                    pirateFactionJoinsEmpire(galaxy, destroyingEmpire, empire2);
                    empty2 = `${pirateBase.name}: the ${empire2.name} join your empire`;
                    empty = 'Pirate Faction Joins Your Empire';
                    sendEventMessageToEmpire(destroyingEmpire, EventMessageType.PirateFactionJoinsYou, empty, empty2, pirateBase, pirateBase.empire.pirateEmpireBaseHabitat);
                }
            }
            break;
        }
        case 3: {
            const habitat = fastFindNearestIndependentHabitat(galaxy, galaxy.independentColonies, pirateBase.xpos, pirateBase.ypos);
            let systemVisibilityStatus = SystemVisibilityStatus.Undefined;
            if (habitat !== null) systemVisibilityStatus = destroyingEmpire.visibility.checkSystemVisibilityStatus(habitat.systemIndex);
            if (systemVisibilityStatus !== SystemVisibilityStatus.Unexplored) break;
            let race = null;
            if (habitat!.population !== null && habitat!.population.items.length > 0 && habitat!.population.dominantRace !== null) race = habitat!.population.dominantRace;
            if (race !== null) {
                const habitat2 = galaxy.determineHabitatSystemStar(habitat!);
                empty2 = `${pirateBase.name}: an independent colony of ${race.name} at ${habitat2.name}`;
                empty = `Independent Colony of ${race.name}`;
                // AddLocationHint (player map hint) — UI, TODO(port) M9.
                sendEventMessageToEmpire(destroyingEmpire, EventMessageType.IndependentPopulation, empty, empty2, race, pirateBase.empire.pirateEmpireBaseHabitat);
            }
            break;
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Carrier side (BuiltObject.cs 1786-1893, 4096-4375; BaconBuiltObject.cs 3097-3334, 5308)
// ---------------------------------------------------------------------------------------------------------------

/** BuiltObject.cs 1786 LaunchAvailableFighters. */
export function launchAvailableFighters(galaxy: Galaxy, builtObject: BuiltObject): void {
    const fighters = fightersOf(builtObject);
    if (fighters === null || fighters.length <= 0) return;
    for (let i = 0; i < fighters.length; i++) {
        const fighter = fighters[i];
        if (fighter.specification.type === FighterType.Interceptor && fighter.health >= 1 && !fighter.underConstruction) launchFighter(galaxy, builtObject, fighter);
    }
}

/** BuiltObject.cs 1802 LaunchAvailableBombers. */
export function launchAvailableBombers(galaxy: Galaxy, builtObject: BuiltObject): void {
    const fighters = fightersOf(builtObject);
    if (fighters === null || fighters.length <= 0) return;
    for (let i = 0; i < fighters.length; i++) {
        const fighter = fighters[i];
        if (fighter.specification.type === FighterType.Bomber && fighter.health >= 1 && !fighter.underConstruction) launchFighter(galaxy, builtObject, fighter);
    }
}

/** BuiltObject.cs 1818 LaunchAllFighters. Rnd: LaunchFighter per launched fighter. */
export function launchAllFighters(galaxy: Galaxy, builtObject: BuiltObject): void {
    const fighters = fightersOf(builtObject);
    if (builtObject.fighterCapacity <= 0 || fighters === null || fighters.length <= 0) return;
    for (let i = 0; i < fighters.length; i++) {
        const fighter = fighters[i];
        if (fighter.health >= 1 && !fighter.underConstruction) launchFighter(galaxy, builtObject, fighter);
    }
}

/** BuiltObject.cs 1834 LaunchFighter(fighter). Rnd: Next(0, 2), RandomHeadingOffset NextDouble, then EvaluateThreats. */
export function launchFighter(galaxy: Galaxy, builtObject: BuiltObject, fighter: Fighter): void {
    if (fighter.onboardCarrier) {
        fighter.xpos = builtObject.xpos;
        fighter.ypos = builtObject.ypos;
        fighter.onboardCarrier = false;
        fighter.missionType = FighterMissionType.Patrol;
        const heading = builtObject.heading;
        const halfPi = Math.fround(F_PI / 2);
        fighter.heading =
            galaxy.rnd.next(0, 2) !== 1
                ? Math.fround(heading - Math.fround(halfPi + randomHeadingOffset(galaxy)))
                : Math.fround(heading + Math.fround(halfPi + randomHeadingOffset(galaxy)));
        fighter.currentSpeed = Math.fround(Math.fround(fighter.topSpeed) * F_0_3);
        fighterEvaluateThreats(galaxy, fighter);
    }
}

/** BuiltObject.cs 1849 ReturnFighters. */
export function returnFighters(builtObject: BuiltObject): void {
    const fighters = fightersOf(builtObject);
    if (fighters === null || fighters.length <= 0) return;
    for (let i = 0; i < fighters.length; i++) {
        if (fighters[i].specification.type === FighterType.Interceptor && !fighters[i].onboardCarrier) returnToCarrier(fighters[i]);
    }
}

/** BuiltObject.cs 1864 ReturnBombers. */
export function returnBombers(builtObject: BuiltObject): void {
    const fighters = fightersOf(builtObject);
    if (fighters === null || fighters.length <= 0) return;
    for (let i = 0; i < fighters.length; i++) {
        if (fighters[i].specification.type === FighterType.Bomber && !fighters[i].onboardCarrier) returnToCarrier(fighters[i]);
    }
}

/** BuiltObject.cs 4362 CheckFightersAvailableForLaunch. */
export function checkFightersAvailableForLaunch(builtObject: BuiltObject): boolean {
    const fighters = fightersOf(builtObject);
    if (fighters !== null && fighters.length > 0) {
        for (let i = 0; i < fighters.length; i++) {
            if (fighters[i].onboardCarrier && fighters[i].health >= 1 && fighters[i].specification.type === FighterType.Interceptor) return true;
        }
    }
    return false;
}

/** BaconBuiltObject.cs 3097 BuildBetterFighters(carrier, fighterDesign). */
function buildBetterFighters(carrier: BuiltObject, fighterDesign: FighterSpecification): FighterSpecification {
    if (!carrier.empire!.name.includes('Romulan')) return fighterDesign;
    const fighterSpecification = cloneFighterSpecification(fighterDesign);
    fighterSpecification.topSpeed = toShort(fighterSpecification.topSpeed * 2);
    fighterSpecification.turnRate = Math.fround(fighterSpecification.turnRate * 2);
    fighterSpecification.accelerationRate = Math.fround(fighterSpecification.accelerationRate * 2);
    fighterSpecification.weaponSpeed = toShort(fighterSpecification.weaponSpeed * 2);
    fighterSpecification.weaponRange = toShort(fighterSpecification.weaponRange * 2);
    return fighterSpecification;
}

/** The bay capacities by type, as BaconBuiltObject.cs 3131 GetFighterCapacity / 3183-3200 BuildNewFighters read them. */
function carrierBayCapacity(carrier: BuiltObject): { fighter: number; bomber: number } {
    let num5 = 0;
    let num6 = 0;
    const items = carrier.components.items;
    for (let index = 0; index < items.length; ++index) {
        const actualEmpire = carrier.actualEmpire;
        const componentImprovement = actualEmpire === null || actualEmpire.research === null ? componentImprovementFromComponent(items[index].def) : actualEmpire.research.resolveImprovedComponentValues(items[index].def);
        if (componentImprovement.improvedComponent.category === ComponentCategoryType.Fighter) {
            const name = componentImprovement.improvedComponent.name.toLowerCase();
            if (name.includes(baconSettings.fighterBayLabel)) {
                num5 += componentImprovement.value1;
            } else if (name.includes(baconSettings.bomberBayLabel)) {
                num6 += componentImprovement.value1;
            } else if (name.includes(baconSettings.mixedBayLabel)) {
                num5 += Math.trunc(componentImprovement.value1 / 2);
                num6 += Math.trunc(componentImprovement.value1 / 2);
            }
        }
    }
    return { fighter: num5, bomber: num6 };
}

/** BaconBuiltObject.cs 3319 CheckForCustomGunship(carrier, bomberDesign). */
function checkForCustomGunship(carrier: BuiltObject, bomberDesign: FighterSpecification | null): FighterSpecification | null {
    if (carrier.baconValues === null || !carrier.baconValues.has('customBomberName')) return bomberDesign;
    const customBomberName = carrier.baconValues.get('customBomberName') as string;
    if (carrier.actualEmpire === null) return bomberDesign;
    const tuple = getCustomFighterDesigns(carrier.actualEmpire).find((x) => x.item1.name === customBomberName) ?? null;
    if (tuple === null) return bomberDesign;
    const fighterSpecification = tuple.item1;
    fighterSpecification.sortTag = Math.fround(tuple.item4);
    return fighterSpecification;
}

/** BuiltObject.cs 1896 BuildNewFighters → BaconBuiltObject.cs 3151 BuildNewFighters(carrier). No Rnd. */
export function buildNewFighters(galaxy: Galaxy, carrier: BuiltObject): void {
    if (carrier.fighterCapacity <= 0) return;
    const empire = carrier.empire!;
    let fighterSpecification1 = identifyLatestFighterSpecification(empire);
    const bomberDesign = identifyLatestBomberSpecification(empire);
    let fighterSpecification2 = checkForCustomGunship(carrier, bomberDesign);
    if (fighterSpecification1 === null && fighterSpecification2 === null) {
        if (empire.pirateEmpireBaseHabitat === null) return;
        fighterSpecification1 = fighterSpecificationsStatic(galaxy, 0);
        fighterSpecification2 = fighterSpecificationsStatic(galaxy, 5);
    }
    let num1 = 10;
    let num2 = 10;
    if (fighterSpecification1 !== null) num1 = fighterSpecification1.size;
    if (fighterSpecification2 !== null) num2 = fighterSpecification2.size;
    if (carrier.fighters === null) carrier.fighters = [];
    const fighters = fightersOf(carrier)!;
    let num3 = 0;
    let num4 = 0;
    for (let index = 0; index < fighters.length; ++index) {
        if (fighters[index].specification.type === FighterType.Bomber) num4 += fighters[index].specification.size;
        else num3 += fighters[index].specification.size;
    }
    const capacity = carrierBayCapacity(carrier);
    let num5 = capacity.fighter;
    let num6 = capacity.bomber;
    // 3204: `myMain != null && myMain._Game != null && carrier.Empire != PlayerEmpire` — AI carriers split the fighter bays.
    if (carrier.empire !== galaxy.playerEmpire) {
        num5 = Math.trunc(num5 / 2);
        num6 = num5;
    }
    const num7 = Math.trunc((num5 - num3) / num1);
    const num8 = Math.trunc((num6 - num4) / num2);
    if (fighterSpecification1 !== null) {
        for (let index = 0; index < num7; ++index) buildFighter(galaxy, carrier, fighterSpecification1);
    }
    if (fighterSpecification2 !== null) {
        for (let index = 0; index < num8; ++index) buildFighter(galaxy, carrier, fighterSpecification2);
    }
}

/** BuiltObject.cs 1891 BuildFighter → BaconBuiltObject.cs 3218 BuildFighter(carrier, fighterSpecification). No Rnd. */
export function buildFighter(galaxy: Galaxy, carrier: BuiltObject, fighterSpecification: FighterSpecification | null): void {
    if (fighterSpecification === null) return;
    fighterSpecification = buildBetterFighters(carrier, fighterSpecification);
    if (carrier.fighterCapacity >= fighterSpecification.size) {
        if (carrier.fighters === null) carrier.fighters = [];
        if (carrier.fighterCapacity - fighterListTotalSize(fightersOf(carrier)!) >= fighterSpecification.size) {
            const fighter = new Fighter(galaxy, fighterSpecification, carrier);
            const latestProjects = carrier.actualEmpire!.research.latestProjects ?? [];
            if (latestProjects.find((x) => x.def.name === baconSettings.tailGunnerResearch && x.isResearched) !== undefined) {
                for (let index = 0; index < Math.trunc(fighter.size / 10); ++index) addWeaponToFighter(fighter, 'defensiveGun');
            }
        }
    }
}

/** BuiltObject.cs 1879 BuildNewFighter. */
export function buildNewFighter(galaxy: Galaxy, builtObject: BuiltObject): void {
    buildFighter(galaxy, builtObject, identifyLatestFighterSpecification(builtObject.empire!));
}
/** BuiltObject.cs 1885 BuildNewBomber. */
export function buildNewBomber(galaxy: Galaxy, builtObject: BuiltObject): void {
    buildFighter(galaxy, builtObject, identifyLatestBomberSpecification(builtObject.empire!));
}

/** BaconBuiltObject.cs 3303 IsShipInSystemWithFriendlyColony(ship). */
function isShipInSystemWithFriendlyColony(ship: BuiltObject): boolean {
    if (ship.nearestSystemStar === null || ship.actualEmpire!.colonies === null) return false;
    const nearestSystemStar = ship.nearestSystemStar;
    for (const colony of ship.actualEmpire!.colonies) {
        let habitat: Habitat | null = colony;
        while (habitat.parent !== null) habitat = habitat.parent;
        if (habitat !== null && nearestSystemStar.name === habitat.name) return true;
    }
    return false;
}

/** BuiltObject.cs 1901 ManufactureRepairFighters → BaconBuiltObject.cs 3241 ManufactureRepairFighters(carrier, timePassed). No Rnd. */
export function manufactureRepairFighters(galaxy: Galaxy, carrier: BuiltObject, timePassed: number): void {
    const fighters = fightersOf(carrier);
    if (fighters === null || carrier.fighterCapacity <= 0 || carrier.fighterRepairRate <= 0) return;
    let num1 = Math.fround(timePassed * carrier.fighterRepairRate * 0.01);
    if (baconIsMyShip(carrier)) num1 = Math.fround(num1 * 2);
    if (carrier.role === BuiltObjectRole.Base && baconSettings.limitNewFighterBuildToColonies) num1 = Math.fround(num1 * 2);
    let flag = true;
    if (baconSettings.limitNewFighterBuildToColonies && carrier.role !== BuiltObjectRole.Base && carrier.actualEmpire === galaxy.playerEmpire) flag = isShipInSystemWithFriendlyColony(carrier);
    for (let index = 0; index < fighters.length; ++index) {
        const fighter = fighters[index];
        if (fighter.onboardCarrier) {
            if (fighter.underConstruction) {
                if (flag) {
                    if (fighter.health < 1.0) {
                        const num2 = Math.fround(Math.fround(Math.fround(num1 / baconSettings.fighterBuildSpeedDivisor) * 10) / Math.max(1, fighter.size));
                        let num3: number;
                        if (1.0 - fighter.health <= num2) {
                            num3 = Math.fround(num2 - Math.fround(1 - fighter.health));
                            fighter.health = 1;
                            fighter.underConstruction = false;
                            payWhenFighterIsBuilt(galaxy, fighter);
                        } else {
                            fighter.health = Math.fround(fighter.health + num2);
                            num3 = 0;
                        }
                        num1 = Math.fround(Math.fround((num3 * fighter.size) / 10.0) * baconSettings.fighterBuildSpeedDivisor);
                    } else {
                        fighter.underConstruction = false;
                    }
                }
            } else if (fighter.health < 1.0) {
                if (1.0 - fighter.health <= num1) {
                    num1 = Math.fround(num1 - Math.fround(1 - fighter.health));
                    fighter.health = 1;
                } else {
                    fighter.health = Math.fround(fighter.health + num1);
                    num1 = 0;
                }
            }
        }
        if (num1 <= 0.0) break;
    }
}

/** BuiltObject.cs 3548 CheckFightersNeedUpgrading → BaconBuiltObject.cs 5308 CheckFightersNeedUpgrading(carrier). No Rnd of its own. */
export function checkFightersNeedUpgrading(galaxy: Galaxy, carrier: BuiltObject): void {
    const fighters = fightersOf(carrier);
    const empire = carrier.empire;
    if ((carrier.baconValues !== null && carrier.baconValues.has('customBomberName')) || fighters === null || fighters.length <= 0 || carrier.inBattle || empire === null || empire.policy === null || empire.research === null || !empire.policy.researchDesignAutoUpgradeFighters) return;
    const fighterSpecification1 = identifyLatestFighterSpecification(empire);
    const fighterSpecification2 = identifyLatestBomberSpecification(empire);
    for (let index = 0; index < fighters.length; ++index) {
        const f = fighters[index];
        if (f.specification !== null && f.specification.type === FighterType.Bomber) {
            if (fighterSpecification2 !== null && f.specification.fighterSpecificationId !== fighterSpecification2.fighterSpecificationId) {
                if (!f.onboardCarrier && f.missionType !== FighterMissionType.ReturnToCarrier) returnToCarrier(f);
                else if (f.onboardCarrier) fighterCompleteTeardown(galaxy, f);
            }
        } else if (f.specification !== null && f.specification.type === FighterType.Interceptor && fighterSpecification1 !== null && f.specification.fighterSpecificationId !== fighterSpecification1.fighterSpecificationId) {
            if (!f.onboardCarrier && f.missionType !== FighterMissionType.ReturnToCarrier) returnToCarrier(f);
            else if (f.onboardCarrier) fighterCompleteTeardown(galaxy, f);
        }
    }
}

/**
 * BuiltObject.cs 4096 FireWeaponsAtFighter(galaxy, fighter, time, out allWeaponsAssigned). Returns allWeaponsAssigned.
 * Rnd per available weapon in range: NextDouble (fire-rate jitter), then DetermineHitTarget + Weapon.Fire when it fires.
 */
export function fireWeaponsAtFighter(galaxy: Galaxy, builtObject: BuiltObject, fighterObject: unknown, time: number): boolean {
    const fighter = fighterObject as Fighter;
    let allWeaponsAssigned = false;
    const weapons = builtObject.weapons;
    if (weapons == null) return allWeaponsAssigned;
    const num = galaxy.calculateDistance(builtObject.xpos, builtObject.ypos, fighter.xpos, fighter.ypos);
    let num2 = 0;
    const num3 = Math.trunc(Math.fround(Math.fround(fighter.size + Math.trunc(fighter.currentShields) + 1) * builtObject.empire!.attackOvermatchFactor));
    let num4 = 0;
    const shipGroup = shipGroupOf(builtObject);
    if (builtObject.pointDefenseWeaponsRange > 0) {
        for (let i = 0; i < weapons.length; i++) {
            if (num2 >= num3) return allWeaponsAssigned;
            const weapon = weapons[i];
            if (weapon.component === null || weapon.component.category !== ComponentCategoryType.WeaponPointDefense || !weaponIsAvailable(weapon, builtObject, time)) continue;
            num4++;
            let num5 = weapon.range;
            if (shipGroup !== null) num5 *= shipGroup.weaponsRangeBonus;
            num5 *= captainWeaponsRangeBonus(builtObject);
            if (num5 >= num) {
                const timeSpan = time - weapon.lastFired;
                const num6 = galaxy.rnd.nextDouble() * 300.0 - 150.0;
                if (timeSpan >= weapon.fireRate + num6) {
                    const r = builtObjectDetermineHitTarget(galaxy, builtObject, weapon, fighter, num);
                    weaponFire(galaxy, weapon, builtObject, fighter, num, time, r.willHit, r.hitRangeChance);
                    num2 += weapon.rawDamage;
                    num4--;
                }
            }
        }
        if (num4 <= 0) allWeaponsAssigned = true;
    } else {
        if (builtObject.beamWeaponsMinRange <= 0) return allWeaponsAssigned;
        for (let j = 0; j < weapons.length; j++) {
            if (num2 >= num3) return allWeaponsAssigned;
            const weapon2 = weapons[j];
            if (weapon2.component === null || weapon2.component.category !== ComponentCategoryType.WeaponBeam || !weaponIsAvailable(weapon2, builtObject, time)) continue;
            num4++;
            let num7 = weapon2.range;
            if (shipGroup !== null) num7 *= shipGroup.weaponsRangeBonus;
            num7 *= captainWeaponsRangeBonus(builtObject);
            if (num7 >= num) {
                const timeSpan2 = time - weapon2.lastFired;
                const num8 = galaxy.rnd.nextDouble() * 500.0 - 250.0;
                if (timeSpan2 >= weapon2.fireRate + num8) {
                    const r = builtObjectDetermineHitTarget(galaxy, builtObject, weapon2, fighter, num);
                    weaponFire(galaxy, weapon2, builtObject, fighter, num, time, r.willHit, r.hitRangeChance);
                    num2 += weapon2.rawDamage;
                    num4--;
                }
            }
        }
        if (num4 <= 0) allWeaponsAssigned = true;
    }
    return allWeaponsAssigned;
}

/**
 * BuiltObject.cs 4274 FireAtNearbyFighters(time, inView). Rnd: FireWeaponsAtTarget at one passing ship, then
 * FireWeaponsAtFighter draws per enemy fighter in point-defence / beam range.
 */
export function fireAtNearbyFighters(galaxy: Galaxy, builtObject: BuiltObject, time: number, inView: boolean): void {
    const self = builtObject;
    if (self.pointDefenseWeaponsRange <= 0 && self.beamWeaponsMinRange <= 0 && self.maximumWeaponsRange <= 0) return;
    if (self.fighterFiringCounter >= 32766) self.fighterFiringCounter = 0;
    self.fighterFiringCounter++;
    const threats = self.threats ?? [];
    if ((inView && self.fighterFiringCounter % 10 !== 0) || !(self.currentEnergy / self.reactorStorageCapacity > 0.3) || threats.length <= 0) return;
    let allWeaponsAssigned = false;
    let flag = checkConventionalWeaponsAvailableToFireAtPassingThreats(galaxy, self, time);
    let num = self.pointDefenseWeaponsRange;
    if (num <= 0) num = self.beamWeaponsMinRange;
    const num2 = num * num;
    for (let i = 0; i < threats.length; i++) {
        if (allWeaponsAssigned) break;
        const threat = threats[i];
        if (threat === null || !isBuiltObject(threat) || !builtObjectShouldAttack(galaxy, self, threat, time, false)) continue;
        const bo = threat;
        if (flag && bo !== self.currentTarget) {
            const num3 = galaxy.calculateDistance(self.xpos, self.ypos, bo.xpos, bo.ypos);
            if (num3 < self.maximumWeaponsRange && !checkOurEmpireBoarding(self.empire!, bo, self)) {
                let mayModifyDiplomacy = true;
                if (bo.attackers !== null) {
                    for (let j = 0; j < bo.attackers.length; j++) {
                        const stellarObject = bo.attackers[j] as FighterTarget | null;
                        if (stellarObject != null && targetEmpire(stellarObject) === self.empire) {
                            mayModifyDiplomacy = false;
                            break;
                        }
                    }
                }
                builtObjectFireWeaponsAtTarget(galaxy, self, num3, bo, time, mayModifyDiplomacy);
                flag = false;
            }
        }
        const fighters = fightersOf(bo);
        if (fighters === null || fighters.length <= 0) continue;
        for (let k = 0; k < fighters.length; k++) {
            const fighter = fighters[k];
            if (!checkWithinDistancePotential(num, self.xpos, self.ypos, fighter.xpos, fighter.ypos)) continue;
            const num4 = galaxy.calculateDistanceSquared(self.xpos, self.ypos, fighter.xpos, fighter.ypos);
            if (num4 <= num2) {
                let flag2 = true;
                if (fighter.empire === self.empire) {
                    abandonAttackTarget(fighter);
                    flag2 = false;
                }
                if (flag2) allWeaponsAssigned = fireWeaponsAtFighter(galaxy, self, fighter, time);
                if (allWeaponsAssigned) break;
            }
        }
    }
}
