// M4r — diplomacy runtime: politics and strategy (r1) plus messages and treaties (r2).
//
// Ports (C# file:line above each function):
//   r1 politics/strategy — Empire.8.cs 1905 EvaluatePoliticalSituation, 66 ReviewDiplomaticStrategies, 742
//   ReviewDiplomaticSituations (ImplementDiplomaticStrategy 585, ApplyDiplomaticStrategyToRelation 755, the
//   offer / gift / sanction / war helpers 1428-1875, ConsiderEndWar 904, PrepareFleetsForWar 1014), 1875
//   ClearInvalidDiplomaticRelations, 2568 ChangeDiplomaticRelation; Empire.7.cs 4135 CalculateRelativeEmpireSize,
//   4883 DeclareWar and the politics helpers around them; Empire.1.cs 3322 RemoveDefeatedEmpireRelations, 3961
//   ReviewEmpireEndsAllWars; Empire.9.cs 3519-3700 war-objective identification (IdentifyEmpireWarObjectives);
//   Empire.8.cs 4374-4480 CheckTaskAuthorized.
//
// Conventions (plan §3.1): free functions, C# `this` first (`self`), Galaxy passed explicitly. C# `int` arithmetic
// → Math.trunc / `| 0` where the C# truncates; TimeSpan.TotalSeconds = ms / 1000. Galaxy.Rnd draws are made on
// galaxy.rnd in the C# order; `RND:` notes mark draws inside callees owned by other packages that are not made yet.
//
// Text: TextResolver.GetText(key) returns the key (M9 localises); string.Format substitutes {n} placeholders.

import { RaceEventType } from './eventTypes';
import type { Galaxy } from './galaxy';
import type { Empire } from './empire';
import { AutomationLevel, empireGovernmentAttributes } from './empire';
import type { BuiltObject } from './builtObject';
import { Habitat } from './types';
import type { SystemInfo } from './types';
import { registerTodo, todo } from './tick/todo';
import { galaxyStarDate, REAL_SECONDS_IN_GALACTIC_YEAR } from './tick/simTime';
import {
    DiplomaticRelation,
    DiplomaticRelationList,
    DiplomaticRelationType,
    DiplomaticStrategy,
    EmpireEvaluation,
    FIRST_CONTACT_PENALTY_ANNUAL_REDUCTION_AMOUNT,
    RELATIONSHIP_WITH_FRIENDS_CAP,
    COVETOUSNESS_CAP,
    SYSTEM_COMPETITION_CAP,
    SYSTEM_COMPETITION_CAP_EXTENDED,
    LONG_MAX_VALUE,
    WarEndReason,
    WarObjective,
    checkAtWarExcluding,
    empireEvaluationByEmpire,
    empireEvaluationsOf,
    governmentNaturalAffinity,
    obtainDiplomaticRelation,
    obtainEmpireEvaluation,
    processRelationChange,
    resolveEmpiresToDefendAgainst,
} from './diplomacy';
import { EmpireMessage, EmpireMessageType, resolveDescription, sendEmpireMessage, sendMessageToEmpire, sendMessageToEmpireWithTitle } from './messages';
import { empireWarWeariness } from './taxes';
import { checkEmpireHasHyperDriveTech, determineEmpireSystems, identifyEmpireCapitals, totalColonyStrategicValue, totalMobileMilitaryFirepower } from './forceStructure';
import { strategicValue } from './territory';
import { BuiltObjectRole } from './data/designSpecifications';
import { BuiltObjectSubRole } from './builtObjectTypes';
import { SystemVisibilityStatus } from './visibility';
import type { ContactFromGalaxyMapHook, EmpireVisibility } from './visibility';
import { HabitatPrioritization } from './resourceTargets';
import { netSort } from './netSort';
import { CharacterEventType, CharacterRole, getCharactersByRole, getEmpireCharacters, type Character } from './characters';
import { PirateRelationEvaluationType, PirateRelationType, changePirateEvaluation, changePirateRelation, obtainPirateRelation, type PirateRelation } from './pirateRelations';
import { GalaxyLocation } from './galaxyLocation';
import { habitatDevelopmentLevel } from './developmentLevel';
import { BuiltObjectMissionType, builtObjectMission } from './missions/mission';
import { empireShipGroups, type ShipGroup } from './fleets/shipGroup';
import {
    cancelAttackMissionsAgainstEmpire,
    checkAttackFleetTargets,
    clearAttackFleetAssignments,
    clearDefendFleets,
    identifyMilitaryObjectives,
    reviewDefensiveFleetLocations,
    sendAttackFleets,
    sendScoutsToSingleEnemyEmpire,
    setDefendFleets,
} from './fleets/militaryAI';
import { chanceNewAmbassador, doCharacterEventRuntime } from './events';
import { galaxyColonyFillFactor } from './colonyTick';
import { isObjectVisibleToThisEmpire } from './independentTraders';
import { TradeableItem, TradeableItemType, processTradeDealMessage, determineAcceptGalaxyMapTrade, determineAcceptTerritoryMapTrade, galaxyMergeGalaxyMap } from './tradeItems';

// ---------------------------------------------------------------------------------------------------------------
// Constants (Galaxy.3.cs 4990-5140 InitializeStatics; BaconEmpire.cs statics with their default settings).
// ---------------------------------------------------------------------------------------------------------------

const INCIDENT_EVALUATION_ANNUAL_NEUTRALIZATION_AMOUNT = 3; // Galaxy.3.cs 5009 (int)
const CIVILITY_RATING_ANNUAL_NEUTRALIZATION_AMOUNT = 3; // 5010 (int)
const CIVILITY_RATING_ANNUAL_RISE_AMOUNT = 1.5; // 5011
const MINIMUM_DIPLOMACY_TRADE_PROPOSAL_INTERVAL_YEARS = 1.25; // 5017
const MAJOR_COLONY_STRATEGIC_THRESHHOLD = 20000; // 5035
const BLOCKADE_EMPIRE_EVALUATION_VALUE = -20; // 5042
const SYSTEM_COMPETITION_COLONY_FACTOR = 20; // 5044
const SYSTEM_COMPETITION_MINING_STATION_FACTOR = 4; // 5045
const ACCEPTABLE_WAR_VALUE_LOSSES_BUILT_OBJECT = 0.35; // 5046
const ACCEPTABLE_WAR_VALUE_LOSSES_COLONY = 0.2; // 5047
const EMPIRE_EVALUATION_TRENDING_FACTOR = 300.0; // 5056
const INCIDENT_IMPACT_WHEN_DECLARE_WAR = 40; // 5057 (int)
const DECLARE_WAR_REPUTATION_IMPACT = 1.0; // 5058
const MAXIMUM_MISSION_REFUSALS = 1; // 5117
const IDEAL_TIME_BETWEEN_GIFTS = 1200000; // 5118 (long)
const MINIMUM_WAR_LENGTH_PERIOD_YEARS = 0.5; // 5122
const WAR_WEARINESS_FACTOR_DEFAULT = 1.0; // 5136
const SECTOR_SIZE = 2000000; // Galaxy.3.cs SectorSize
/** Galaxy.WarWearinessMaximum = 40.0 (5107; the BaconMain settings key "WarWearinessMaximum" may override — default kept). */
const WAR_WEARINESS_MAXIMUM = 40.0;
/** BaconEmpire.cs 24 warWearinessReduction = -2 (BaconMain settings key "warWearinessReduction" may override — default kept). */
const BACON_WAR_WEARINESS_REDUCTION = -2;

// FleetPosture.cs (byte enum).
export enum FleetPosture {
    Attack,
    Defend,
}

// BuiltObjectMissionPriority.cs (byte enum).
export enum BuiltObjectMissionPriority {
    Undefined,
    Low,
    Normal,
    High,
    VeryHigh,
    Unavailable,
}

// AdvisorMessageType.cs (byte enum; member order exact).
export enum AdvisorMessageType {
    Undefined, BuildOrder, BuildOneOff, Colonization, IntelligenceMission, EnemyAttack, EnemyBombard, EnemyBlockade,
    EnemyAttackPlanetDestroyer, InvadeIndependent, PrepareRaid, DiplomaticGift, TreatyOffer, WarTradeSanctions,
    ColonyFacility, OfferMilitaryRefueling, CancelMilitaryRefueling, OfferMiningRights, CancelMiningRights,
    AllowTradeRestrictedResources, DisallowTradeRestrictedResources, ComplyTradeSanctionsOther, ComplyWarOther,
    DefendTerritory, Retrofit, RequestLiftTradeSanctionsOther, RequestEndWarOther, OfferPirateAttackMission,
    OfferPirateDefendMission, OfferPirateSmuggleMission, PirateRaid, PirateFacilityEradicate, AcceptPirateSmugglingMission,
    DefendTarget,
}

/** AutomationLevel.cs is {Manual, SemiAutomated, FullyAutomated}; empire.ts names 0/1 Undefined/PartiallyAutomated. */
export const MANUAL = AutomationLevel.Undefined;
export const SEMI_AUTOMATED = AutomationLevel.PartiallyAutomated;
export const FULLY_AUTOMATED = AutomationLevel.FullyAutomated;

// ---------------------------------------------------------------------------------------------------------------
// Small shared helpers.
// ---------------------------------------------------------------------------------------------------------------

/** TextResolver.GetText(key): the key (GameText stand-in; M9 localises). */
export function getText(key: string): string {
    return key;
}

/** string.Format(format, args): {n} placeholders. */
export function formatText(format: string, ...args: unknown[]): string {
    return format.replace(/\{(\d+)\}/g, (m, i) => (Number(i) < args.length ? String(args[Number(i)]) : m));
}

/** C# double.CompareTo (NaN sorts first). */
export function compareDouble(a: number, b: number): number {
    if (a < b) return -1;
    if (a > b) return 1;
    if (a === b) return 0;
    if (Number.isNaN(a)) return Number.isNaN(b) ? 0 : -1;
    return 1;
}

/** Empire.cs 1430 CivilityRating setter: clamps to [-100, 30]. */
export function setCivilityRating(self: Empire, value: number): void {
    self.civilityRating = value;
    if (self.civilityRating > 30.0) self.civilityRating = 30.0;
    if (self.civilityRating < -100.0) self.civilityRating = -100.0;
}

/** Empire.WarWearinessFactor (Empire.cs 423; SetEmpireDifficultyFactors → pirates.ts difficultyFactors). */
function warWearinessFactor(self: Empire): number {
    return self.difficultyFactors?.warWearinessFactor ?? WAR_WEARINESS_FACTOR_DEFAULT;
}

/** Race.AggressionLevel etc. (Race.cs 350-400). TODO(port) M4j: _ChangePeriodActive periodic levels (ReviewRacePeriodicChanges). */
export function aggressionLevel(e: Empire): number {
    return e.dominantRace!.aggression;
}
export function cautionLevel(e: Empire): number {
    return e.dominantRace!.caution;
}
export function friendlinessLevel(e: Empire): number {
    return e.dominantRace!.friendliness;
}
export function loyaltyLevel(e: Empire): number {
    return e.dominantRace!.loyalty;
}
export function intelligenceLevel(e: Empire): number {
    return e.dominantRace!.intelligence;
}
/** Race int properties (TradeBonus, EspionageBonus, …) — data/races.ts parses them as numbers. */
export function raceInt(v: number): number {
    return Math.trunc(v);
}

/** Galaxy.CalculateDistanceSquared. */
function distanceSquared(x1: number, y1: number, x2: number, y2: number): number {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return dx * dx + dy * dy;
}

/** Galaxy.3.cs 1616/1621 FastFindNearestColony(x, y, empire, strategicValueThreshhold[, colonyToExclude]). */
export function fastFindNearestColony(galaxy: Galaxy, x: number, y: number, empire: Empire, strategicValueThreshhold: number, colonyToExclude: Habitat | null = null): Habitat | null {
    void galaxy;
    let num = Number.MAX_VALUE;
    let result: Habitat | null = null;
    for (let i = 0; i < empire.colonies.length; i++) {
        if (strategicValue(empire.colonies[i]) >= strategicValueThreshhold && empire.colonies[i] !== colonyToExclude) {
            const num2 = distanceSquared(x, y, empire.colonies[i].xpos, empire.colonies[i].ypos);
            if (num2 < num) {
                result = empire.colonies[i];
                num = num2;
            }
        }
    }
    return result;
}

/** Galaxy.cs 3721 CalculateEmpireColonyProximityValueAtPoint. */
function calculateEmpireColonyProximityValueAtPoint(empire: Empire, x: number, y: number, distanceThresholdSquared: number): number {
    let num = 0.0;
    for (let i = 0; i < empire.colonies.length; i++) {
        const habitat = empire.colonies[i];
        if (habitat != null && !habitat.hasBeenDestroyed) {
            const num2 = distanceSquared(x, y, habitat.xpos, habitat.ypos);
            if (num2 < distanceThresholdSquared) {
                let val = (strategicValue(habitat) * 1000.0) / (num2 / 1000000.0);
                val = Math.min(val, 1000000000.0);
                num += val;
            }
        }
    }
    return num;
}

/** EmpireTerritory.cs 47 CheckSystemOwnership(galaxy, systemStar, out disputed): the owning empire id or -1. */
function checkSystemOwnershipId(galaxy: Galaxy, systemStar: Habitat): number {
    const sys = galaxy.systems[systemStar.systemIndex] as SystemInfo | undefined;
    if (sys === undefined || sys.dominantEmpire == null || sys.dominantEmpire.empire == null) {
        return galaxy.empireTerritory.checkLocationOwnership(galaxy, systemStar.xpos, systemStar.ypos);
    }
    return sys.dominantEmpire.empire.empireId;
}

/** Empire.9.cs 2998 CheckSystemExplored(systemIndex). */
function checkSystemExplored(self: Empire, systemIndex: number): boolean {
    return self.visibility.checkSystemExplored(systemIndex);
}

// ---------------------------------------------------------------------------------------------------------------
// Military potency (Empire.cs 1576/1593, BaconBuiltObject.cs 3511, BuiltObject.1.cs 2281/2298).
// ---------------------------------------------------------------------------------------------------------------

/** BuiltObject.1.cs 2298 CalculateFirepowerFactor: float sum of RawDamage / (FireRate / 1000f), truncated. */
function calculateFirepowerFactor(bo: BuiltObject): number {
    let num = 0;
    if (bo.weapons != null) {
        for (let i = 0; i < bo.weapons.length; i++) {
            const weapon = bo.weapons[i];
            if (weapon != null) num = Math.fround(num + Math.fround(weapon.rawDamage / Math.fround(weapon.fireRate / 1000)));
        }
    }
    return Math.trunc(num);
}

/** Fighter fields read by CalculateFighterFactor (Fighter.cs; M4p ports the Fighter model). */
interface FighterFirepowerView {
    hasBeenDestroyed: boolean;
    underConstruction: boolean;
    firepowerRaw: number;
}

/** BuiltObject.1.cs 2281 CalculateFighterFactor. */
function calculateFighterFactor(bo: BuiltObject): number {
    let num = 0;
    if (bo.fighters != null) {
        for (let i = 0; i < bo.fighters.length; i++) {
            const fighter = bo.fighters[i] as FighterFirepowerView | null;
            if (fighter != null && !fighter.hasBeenDestroyed && !fighter.underConstruction) num = (num + fighter.firepowerRaw) | 0;
        }
    }
    return num;
}

/** BuiltObject.1.cs 2276 → BaconBuiltObject.cs 3511 CalculateOverallStrengthFactorWithoutShields. */
export function calculateOverallStrengthFactorWithoutShields(bo: BuiltObject): number {
    return bo.role !== BuiltObjectRole.Military ? 0 : (calculateFirepowerFactor(bo) + calculateFighterFactor(bo)) | 0;
}

/** Empire.cs 1576 MilitaryPotency. */
export function militaryPotency(self: Empire): number {
    let num = 0;
    for (let i = 0; i < self.builtObjects.length; i++) {
        const builtObject = self.builtObjects[i];
        if (builtObject != null) num = (num + calculateOverallStrengthFactorWithoutShields(builtObject)) | 0;
    }
    return num;
}

/** Empire.cs 1593 WeightedMilitaryPotency. */
export function weightedMilitaryPotency(self: Empire): number {
    let num = militaryPotency(self);
    for (let i = 0; i < self.diplomaticRelations.count; i++) {
        const diplomaticRelation = self.diplomaticRelations.at(i);
        if (diplomaticRelation.type === DiplomaticRelationType.War) num = (num - militaryPotency(diplomaticRelation.otherEmpire!)) | 0;
        if (diplomaticRelation.type === DiplomaticRelationType.MutualDefensePact) num = (num + militaryPotency(diplomaticRelation.otherEmpire!)) | 0;
        if (diplomaticRelation.type === DiplomaticRelationType.Protectorate && diplomaticRelation.initiator !== self) num = (num + militaryPotency(diplomaticRelation.thisEmpire!)) | 0;
    }
    if (num < 1) num = 1;
    return num;
}

/** Empire.7.cs 4975 DetermineRelativeStrength(ourStrength, otherEmpire): -1 weaker, 0 even, 1 stronger. */
export function determineRelativeStrength(galaxy: Galaxy, ourStrength: number, otherEmpire: Empire): number {
    let result = 0;
    let num = 1.5;
    let num2 = 0.65;
    if (otherEmpire === galaxy.playerEmpire) {
        num /= galaxy.playerEmpire.difficultyLevel;
        num2 /= galaxy.playerEmpire.difficultyLevel;
    }
    const num3 = ourStrength / militaryPotency(otherEmpire);
    if (num3 < num2) result = -1;
    else if (num3 > num) result = 1;
    return result;
}

/** Empire.9.cs 4421 EvaluateMilitaryPotency. */
export function evaluateMilitaryPotency(galaxy: Galaxy, ourWeightedMilitaryPotency: number, theirWeightedMilitaryPotency: number, otherEmpire: Empire): number {
    let num2 = ourWeightedMilitaryPotency * 2.0;
    let num3 = ourWeightedMilitaryPotency * 0.5;
    if (otherEmpire === galaxy.playerEmpire) {
        num2 *= galaxy.playerEmpire.difficultyLevel;
        num3 *= galaxy.playerEmpire.difficultyLevel;
    }
    if (theirWeightedMilitaryPotency > num2) return -1;
    if (theirWeightedMilitaryPotency > num3 && theirWeightedMilitaryPotency < num2) return 0;
    if (theirWeightedMilitaryPotency === ourWeightedMilitaryPotency) return 0;
    return 1;
}

// ---------------------------------------------------------------------------------------------------------------
// Fleet reads (ShipGroup fields M4l has not ported onto the M4a ShipGroup model yet).
// ---------------------------------------------------------------------------------------------------------------

/**
 * TODO(port) M4l: ShipGroup.Posture (auto-property, default FleetPosture.Attack) and TotalTroopAttackStrength
 * (ShipGroup.cs 2967) are not on the ShipGroup class yet. Diplomacy reads them through this view; a missing field
 * reads as its C# default (Posture Attack, 0 troops).
 */
interface ShipGroupFleetView {
    posture?: FleetPosture;
    totalTroopAttackStrength?: number;
}
function fleetPosture(sg: ShipGroup): FleetPosture {
    return (sg as unknown as ShipGroupFleetView).posture ?? FleetPosture.Attack;
}
function fleetTotalTroopAttackStrength(sg: ShipGroup): number {
    return (sg as unknown as ShipGroupFleetView).totalTroopAttackStrength ?? 0;
}

// ---------------------------------------------------------------------------------------------------------------
// CheckTaskAuthorized (Empire.8.cs 4374-4480).
// ---------------------------------------------------------------------------------------------------------------

/** `ref int refusalCount` holder. */
export interface RefCount {
    value: number;
}

const T_declinedTasks = registerTodo('M4r', 'checkTaskAuthorized SemiAutomated declined tasks (M4b DeclinedTaskList)');

/**
 * Empire.8.cs 4395 CheckTaskAuthorized(automationLevel, ref refusalCount, taskDescription, taskTarget, advisorMessageType,
 * attackEmpireTarget, advisorMessageData, advisorMessageData2) — and the shorter overloads (4374-4390), which pass a
 * fresh refusal counter / nulls.
 */
export function checkTaskAuthorized(
    galaxy: Galaxy,
    self: Empire,
    automationLevel: AutomationLevel,
    refusalCount: RefCount,
    taskDescription: string,
    taskTarget: unknown,
    advisorMessageType: AdvisorMessageType,
    attackEmpireTarget: Empire | null = null,
    advisorMessageData: unknown = null,
    advisorMessageData2: unknown = null,
): boolean {
    let result = true;
    switch (automationLevel) {
        case SEMI_AUTOMATED: {
            result = false;
            const currentStarDate = galaxyStarDate(galaxy);
            // TODO(port) M4b: _DeclinedTasks.CheckTaskTargetValid(taskTarget, date) / CheckAttackEmpireTargetValid(attackEmpireTarget)
            // and the _DeclinedTasks.Add(new DeclinedTask(...)) records (Empire.8.cs 4403, 4425-4447, 4460-4480) — the
            // DeclinedTaskList is not ported; every target reads as valid and declines are not recorded. Only the player can be
            // semi-automated (AI empires are always fully automated).
            todo(T_declinedTasks);
            void attackEmpireTarget;
            if (refusalCount.value >= MAXIMUM_MISSION_REFUSALS) break;
            if (self === galaxy.playerEmpire) {
                refusalCount.value++;
                const empireMessage = new EmpireMessage(self, EmpireMessageType.AdvisorSuggestion, taskTarget);
                empireMessage.starDate = currentStarDate;
                empireMessage.advisorMessageType = advisorMessageType;
                empireMessage.description = taskDescription;
                if (advisorMessageType === AdvisorMessageType.DiplomaticGift) empireMessage.money = Math.trunc(advisorMessageData as number);
                else empireMessage.advisorMessageData = advisorMessageData;
                empireMessage.advisorMessageData2 = advisorMessageData2;
                // Empire.7.cs 3836 PromptPlayerForAuthorization → _AutomationAuthorizer (UI) — no sim effect.
                return false;
            }
            // Non-player: _AutomationResponse = Yes; the wait loop is skipped.
            result = true;
            break;
        }
        case MANUAL:
            result = false;
            break;
    }
    return result;
}

function checkTaskAuthorizedSimple(galaxy: Galaxy, self: Empire, automationLevel: AutomationLevel, taskDescription: string, taskTarget: unknown, advisorMessageType: AdvisorMessageType): boolean {
    return checkTaskAuthorized(galaxy, self, automationLevel, { value: 0 }, taskDescription, taskTarget, advisorMessageType);
}

// Empire.10.cs 3900-4010 GenerateAutomationMessage* (advisor text only; keys stand in for the formatted GameText).
export function generateAutomationMessageRequestLiftTradeSanctions(targetEmpire: Empire, friendEmpire: Empire): string {
    return formatText(getText('Automation Request Lift Trade Sanctions'), friendEmpire.name, targetEmpire.name);
}
export function generateAutomationMessageTreaty(otherEmpire: Empire, type: DiplomaticRelationType): string {
    return formatText(getText('Automation Treaty'), resolveDescription(DiplomaticRelationType, type), otherEmpire.name);
}
export function generateAutomationMessageWarTradeSanctions(otherEmpire: Empire, type: DiplomaticRelationType): string {
    return formatText(getText('Automation War Trade Sanctions'), resolveDescription(DiplomaticRelationType, type), otherEmpire.name);
}
function generateAutomationMessageMilitaryRefueling(otherEmpire: Empire, refuel: boolean): string {
    return formatText(getText(refuel ? 'Automation Military Refueling Allow' : 'Automation Military Refueling Block'), otherEmpire.name);
}
function generateAutomationMessageMiningRights(otherEmpire: Empire, allowMining: boolean): string {
    return formatText(getText(allowMining ? 'Automation Mining Rights Allow' : 'Automation Mining Rights Block'), otherEmpire.name);
}
function generateAutomationMessageTradeRestrictedResources(otherEmpire: Empire, trade: boolean): string {
    return formatText(getText(trade ? 'Automation Trade Restricted Resources Allow' : 'Automation Trade Restricted Resources Block'), otherEmpire.name);
}
function generateAutomationMessageDiplomaticGift(otherEmpire: Empire, amount: number): string {
    return formatText(getText('Automation Diplomatic Gift'), amount.toFixed(0), otherEmpire.name);
}

// ---------------------------------------------------------------------------------------------------------------
// Message descriptions (Empire.7.cs 3844-4100).
// ---------------------------------------------------------------------------------------------------------------

/** Empire.7.cs 3859 GenerateMessageDescription(currentRelation, diplomaticRelationType, ourPotencyVersusThem). */
export function generateMessageDescriptionRelation(currentRelation: DiplomaticRelation | null, diplomaticRelationType: DiplomaticRelationType, ourPotencyVersusThem: number): string {
    let result = '';
    if (currentRelation === null) return result;
    const cancelOrEnd = (strong: boolean): string => {
        switch (currentRelation.type) {
            case DiplomaticRelationType.FreeTradeAgreement:
            case DiplomaticRelationType.MutualDefensePact:
            case DiplomaticRelationType.Protectorate:
                return strong ? getText('We are pleased to rid ourselves of this troublesome treaty with you!') : getText('We are cancelling our treaty with you forthwith');
            case DiplomaticRelationType.War:
                return getText('We urge you to consider our proposal for an end to this pointless war');
            case DiplomaticRelationType.TradeSanctions:
                return getText('We ask you to end your trade sanctions against us');
            case DiplomaticRelationType.SubjugatedDominion:
                return getText('We beg for release from Subjugation');
            default:
                return getText('We urge you to consider our proposal for an end to this pointless war');
        }
    };
    if (ourPotencyVersusThem < 0) {
        switch (diplomaticRelationType) {
            case DiplomaticRelationType.FreeTradeAgreement: result = getText('May you look kindly on our proposal of free trade with your wealthy empire'); break;
            case DiplomaticRelationType.MutualDefensePact: result = getText('We would prove a most loyal ally to your mighty empire in a mutual defense pact'); break;
            case DiplomaticRelationType.None: result = cancelOrEnd(false); break;
            case DiplomaticRelationType.Protectorate: result = getText('We offer you refuge in a Protectorate treaty with our strong empire'); break;
            case DiplomaticRelationType.SubjugatedDominion: result = getText('We propose an end to this war, but you must become our subjugated dominion'); break;
            case DiplomaticRelationType.TradeSanctions: result = getText('We regret to inform you that all trade between our two empires has been suspended'); break;
            case DiplomaticRelationType.Truce: result = getText('We beg you to consider a truce'); break;
            case DiplomaticRelationType.War: result = getText('We are afraid that we have no choice but to declare war on you'); break;
        }
    } else if (ourPotencyVersusThem === 0) {
        switch (diplomaticRelationType) {
            case DiplomaticRelationType.FreeTradeAgreement: result = getText('We propose a free trade agreement between our two dynamic societies'); break;
            case DiplomaticRelationType.MutualDefensePact: result = getText('It would be in both our best interests to form a mutual defense pact'); break;
            case DiplomaticRelationType.None: result = cancelOrEnd(false); break;
            case DiplomaticRelationType.Protectorate: result = getText('We offer you refuge in a Protectorate treaty with our strong empire'); break;
            case DiplomaticRelationType.SubjugatedDominion: result = getText('We propose an end to this war, but you must become our subjugated dominion'); break;
            case DiplomaticRelationType.TradeSanctions: result = getText('All trade between us has been terminated until further notice'); break;
            case DiplomaticRelationType.Truce: result = getText('We feel a truce is in order at this point'); break;
            case DiplomaticRelationType.War: result = getText('We inform you that a state of war now exists between us'); break;
        }
    } else {
        switch (diplomaticRelationType) {
            case DiplomaticRelationType.FreeTradeAgreement: result = getText('Accept our free trade agreement proposal and prosper with us'); break;
            case DiplomaticRelationType.MutualDefensePact: result = getText('You would be wise to ally yourselves with our strong empire in a mutual defense pact'); break;
            case DiplomaticRelationType.None: result = cancelOrEnd(true); break;
            case DiplomaticRelationType.Protectorate: result = getText('We offer you refuge in a Protectorate treaty with our strong empire'); break;
            case DiplomaticRelationType.SubjugatedDominion: result = getText('We propose an end to this war, but you must become our subjugated dominion'); break;
            case DiplomaticRelationType.TradeSanctions: result = getText('Effective immediately, all our trade with your tyrannical empire is terminated'); break;
            case DiplomaticRelationType.Truce: result = getText('We offer your pathetic empire a respite from your miserable defeats in a truce'); break;
            case DiplomaticRelationType.War: result = getText('We declare war on your worthless empire. Your colonies await liberation from your tyranny'); break;
        }
    }
    return result;
}

/** Empire.7.cs 4015 GenerateMessageDescription(messageType, ourPotencyVersusThem, targetEmpire). */
export function generateMessageDescriptionType(messageType: EmpireMessageType, ourPotencyVersusThem: number, targetEmpire: Empire | null): string {
    const n = (): string => targetEmpire!.name;
    if (ourPotencyVersusThem < 0) {
        switch (messageType) {
            case EmpireMessageType.GiveGift: return getText('We are greatly honored to present this humble gift to your noble empire');
            case EmpireMessageType.LeaveSystem: return getText('We respectfully request that you leave the X system at your earliest convenience');
            case EmpireMessageType.RemoveColoniesFromSystem: return getText('We would be most appreciative if you were able to decolonize the X system');
            case EmpireMessageType.RequestJointWar: return formatText(getText('We beg you to consider our request to declare war on the EMPIRE'), n());
            case EmpireMessageType.RequestLiftTradeSanctions: return formatText(getText('We would be most gratified if you were able to resume trade with the EMPIRE'), n());
            case EmpireMessageType.RequestJointTradeSanctions: return formatText(getText('We respectfully appeal to your illustrious empire to cease trade with the {0}'), n());
            case EmpireMessageType.RequestStopWar: return formatText(getText('Please hear our respectful plea to stop your war with the EMPIRE'), n());
            case EmpireMessageType.StopAttacks: return getText('We are greatly troubled by your unfriendly attacks. Please try to avoid these unfortunate incidents');
            case EmpireMessageType.StopMissionsAgainstUs: return getText('We have heard baseless rumours that your virtuous empire has been involved in covert actions against us');
        }
    } else if (ourPotencyVersusThem === 0) {
        switch (messageType) {
            case EmpireMessageType.GiveGift: return getText('Please accept this gift as a token of our goodwill');
            case EmpireMessageType.LeaveSystem: return getText('Please leave the X system');
            case EmpireMessageType.RemoveColoniesFromSystem: return getText('Please remove your colonies from the X system');
            case EmpireMessageType.RequestJointWar: return formatText(getText('We formally request that you declare war on the EMPIRE'), n());
            case EmpireMessageType.RequestLiftTradeSanctions: return formatText(getText('Please resume trade with the EMPIRE'), n());
            case EmpireMessageType.RequestJointTradeSanctions: return formatText(getText('We request that you terminate trade with the EMPIRE'), n());
            case EmpireMessageType.RequestStopWar: return formatText(getText('Please end your war with the EMPIRE'), n());
            case EmpireMessageType.StopAttacks: return getText('We serve official warning on you to cease all attacks against us');
            case EmpireMessageType.StopMissionsAgainstUs: return getText('Your covert actions against us have been detected. We warn you to stop these activities');
        }
    } else {
        switch (messageType) {
            case EmpireMessageType.GiveGift: return getText('We are pleased to present this gift to you');
            case EmpireMessageType.LeaveSystem: return getText('We demand that you immediately leave the X system');
            case EmpireMessageType.RemoveColoniesFromSystem: return getText('We insist that you remove all colonies from the X system at once');
            case EmpireMessageType.RequestJointWar: return formatText(getText('Without delay, we require that you declare war on the EMPIRE'), n());
            case EmpireMessageType.RequestLiftTradeSanctions: return formatText(getText('We demand that you restore trade with the EMPIRE at once!'), n());
            case EmpireMessageType.RequestJointTradeSanctions: return formatText(getText('We order you to instantly cease all trade with the EMPIRE'), n());
            case EmpireMessageType.RequestStopWar: return formatText(getText('We command you to stop your war with the EMPIRE straight away!'), n());
            case EmpireMessageType.StopAttacks: return getText('You are ordered to immediately cease all attacks against us!');
            case EmpireMessageType.StopMissionsAgainstUs: return getText('We warn you to end your treacherous covert actvities against us immediately!');
        }
    }
    return '';
}

// ---------------------------------------------------------------------------------------------------------------
// Relation queries (Empire.7.cs).
// ---------------------------------------------------------------------------------------------------------------

/** Empire.7.cs 2355 CalculateNextAllowableProposalDate(DiplomaticRelation). */
export function calculateNextAllowableProposalDate(galaxy: Galaxy, relation: DiplomaticRelation): number {
    let num = Math.trunc(REAL_SECONDS_IN_GALACTIC_YEAR * 1000.0 * (MINIMUM_DIPLOMACY_TRADE_PROPOSAL_INTERVAL_YEARS * galaxyColonyFillFactor(galaxy)));
    let num2 = galaxy.empires.length;
    if (relation.otherEmpire !== null && relation.otherEmpire.diplomaticRelations != null) num2 = relation.otherEmpire.diplomaticRelations.countMet();
    let val = num2 / galaxy.empires.length;
    val = Math.max(0.3, Math.min(1.0, val));
    num = Math.trunc(num * val * 2.0);
    return relation.lastDiplomacyTradeOfferDate + num;
}

/** Empire.7.cs 4428 DetermineEmpiresAtWarWith(). */
export function determineEmpiresAtWarWith(self: Empire): Empire[] {
    const empireList: Empire[] = [];
    for (let i = 0; i < self.diplomaticRelations.count; i++) {
        const diplomaticRelation = self.diplomaticRelations.at(i);
        if (diplomaticRelation.type === DiplomaticRelationType.War && !empireList.includes(diplomaticRelation.otherEmpire!)) empireList.push(diplomaticRelation.otherEmpire!);
    }
    return empireList;
}

/** Empire.7.cs 4400 DetermineEmpiresWarOrConquer(). */
export function determineEmpiresWarOrConquer(self: Empire): Empire[] {
    const empireList: Empire[] = [];
    for (let i = 0; i < self.diplomaticRelations.count; i++) {
        const diplomaticRelation = self.diplomaticRelations.at(i);
        if ((diplomaticRelation.type === DiplomaticRelationType.War || diplomaticRelation.strategy === DiplomaticStrategy.Conquer) && !empireList.includes(diplomaticRelation.otherEmpire!)) empireList.push(diplomaticRelation.otherEmpire!);
    }
    return empireList;
}

/** Empire.7.cs 4544/4561/4510/4527 CountEmpires{WeDeclaredWarOn,WhoDeclaredWarOnUs}[NonLocked]. */
function countWars(self: Empire, weDeclared: boolean, nonLockedOnly: boolean): number {
    let num = 0;
    if (self.diplomaticRelations != null) {
        for (let i = 0; i < self.diplomaticRelations.count; i++) {
            const r = self.diplomaticRelations.at(i);
            if (r.type === DiplomaticRelationType.War && (!nonLockedOnly || !r.locked) && (weDeclared ? r.initiator === self : r.initiator !== self)) num++;
        }
    }
    return num;
}
export function countEmpiresWeDeclaredWarOn(self: Empire): number {
    return countWars(self, true, false);
}
export function countEmpiresWhoDeclaredWarOnUs(self: Empire): number {
    return countWars(self, false, false);
}
export function countEmpiresWeDeclaredWarOnNonLocked(self: Empire): number {
    return countWars(self, true, true);
}
export function countEmpiresWhoDeclaredWarOnUsNonLocked(self: Empire): number {
    return countWars(self, false, true);
}

/** Empire.7.cs 1686 DetermineFriendsAndEnemies(empire, out friends, out closeFriends, out enemies, out severeEnemies). */
export function determineFriendsAndEnemies(empire: Empire): { friends: Empire[]; closeFriends: Empire[]; enemies: Empire[]; severeEnemies: Empire[] } {
    const closeFriends: Empire[] = [];
    const friends: Empire[] = [];
    const enemies: Empire[] = [];
    const severeEnemies: Empire[] = [];
    for (let i = 0; i < empire.diplomaticRelations.count; i++) {
        const diplomaticRelation = empire.diplomaticRelations.at(i);
        switch (diplomaticRelation.type) {
            case DiplomaticRelationType.FreeTradeAgreement: friends.push(diplomaticRelation.otherEmpire!); break;
            case DiplomaticRelationType.MutualDefensePact:
            case DiplomaticRelationType.Protectorate: closeFriends.push(diplomaticRelation.otherEmpire!); break;
            case DiplomaticRelationType.TradeSanctions: enemies.push(diplomaticRelation.otherEmpire!); break;
            case DiplomaticRelationType.War: severeEnemies.push(diplomaticRelation.otherEmpire!); break;
        }
    }
    return { friends, closeFriends, enemies, severeEnemies };
}

/** Empire.7.cs 1714 CalculateRelationshipWithFriends (returns the out values; its int result is unused by the caller). */
function calculateRelationshipWithFriends(empire: Empire, friends: Empire[], closeFriends: Empire[]): { positive: number; negative: number } {
    let positiveRelationship = 0;
    let negativeRelationship = 0;
    for (const closeFriend of closeFriends) {
        const r = closeFriend.diplomaticRelations.byEmpire(empire);
        if (r !== null) {
            switch (r.type) {
                case DiplomaticRelationType.MutualDefensePact:
                case DiplomaticRelationType.Protectorate: positiveRelationship += 8; break;
                case DiplomaticRelationType.FreeTradeAgreement: positiveRelationship += 5; break;
                case DiplomaticRelationType.SubjugatedDominion: positiveRelationship += 2; break;
                case DiplomaticRelationType.TradeSanctions:
                case DiplomaticRelationType.Truce: negativeRelationship -= 7; break;
                case DiplomaticRelationType.War: negativeRelationship -= 15; break;
            }
        }
    }
    for (const friend of friends) {
        const r2 = friend.diplomaticRelations.byEmpire(empire);
        if (r2 !== null) {
            switch (r2.type) {
                case DiplomaticRelationType.MutualDefensePact:
                case DiplomaticRelationType.Protectorate: positiveRelationship += 5; break;
                case DiplomaticRelationType.FreeTradeAgreement: positiveRelationship += 3; break;
                case DiplomaticRelationType.SubjugatedDominion: positiveRelationship++; break;
                case DiplomaticRelationType.TradeSanctions:
                case DiplomaticRelationType.Truce: negativeRelationship -= 5; break;
                case DiplomaticRelationType.War: negativeRelationship -= 10; break;
            }
        }
    }
    positiveRelationship = Math.min(positiveRelationship, 30);
    negativeRelationship = Math.max(negativeRelationship, -30);
    return { positive: positiveRelationship, negative: negativeRelationship };
}

/** Empire.7.cs 2862 DetermineEmpireDominatedSystems(empire, includeAllTerritory). */
export function determineEmpireDominatedSystems(galaxy: Galaxy, empire: Empire, includeAllTerritory: boolean): Habitat[] {
    const habitatList: Habitat[] = [];
    if (includeAllTerritory) {
        for (let i = 0; i < galaxy.systems.length; i++) {
            const systemInfo = galaxy.systems[i];
            if (systemInfo != null && systemInfo.systemStar != null) {
                const num = checkSystemOwnershipId(galaxy, systemInfo.systemStar);
                if (num === empire.empireId && habitatList.indexOf(systemInfo.systemStar) < 0) habitatList.push(systemInfo.systemStar);
            }
        }
    } else {
        for (let j = 0; j < empire.colonies.length; j++) {
            const habitat2 = galaxy.determineHabitatSystemStar(empire.colonies[j]);
            if (habitat2 != null) {
                const dominantEmpire = galaxy.systems[habitat2.systemIndex].dominantEmpire;
                if (dominantEmpire != null && dominantEmpire.empire != null && dominantEmpire.empire === empire && habitatList.indexOf(habitat2) < 0) habitatList.push(habitat2);
            }
        }
    }
    return habitatList;
}

/** BuiltObject.BaconValues?.ContainsKey("givenInTrade") — the TS BuiltObject has no BaconValues dictionary yet. */
export function baconGivenInTrade(bo: BuiltObject): boolean {
    return (bo as unknown as { baconGivenInTrade?: boolean }).baconGivenInTrade === true;
}

/** Empire.7.cs 2900 CalculateSystemCompetition → BaconEmpire.cs 1455 CalculateSystemCompetition. */
function calculateSystemCompetition(galaxy: Galaxy, self: Empire, otherEmpire: Empire, ourSystemStars: Habitat[]): number {
    let num1 = 0;
    const num2 = 1.0 + Math.max(0.0, obtainEmpireEvaluation(galaxy, self, otherEmpire).bias / -10.0);
    for (const empireSystem of determineEmpireSystems(galaxy, otherEmpire)) {
        if (ourSystemStars.indexOf(empireSystem) >= 0) num1 -= SYSTEM_COMPETITION_COLONY_FACTOR;
    }
    if (!obtainDiplomaticRelation(self, otherEmpire).miningRightsToOther) {
        for (let index = 0; index < otherEmpire.miningStations.length; ++index) {
            const miningStation = otherEmpire.miningStations[index];
            if (miningStation.parentHabitat !== null && !baconGivenInTrade(miningStation)) {
                const habitatSystemStar = galaxy.determineHabitatSystemStar(miningStation.parentHabitat);
                if (ourSystemStars.indexOf(habitatSystemStar) >= 0) num1 -= SYSTEM_COMPETITION_MINING_STATION_FACTOR;
            }
        }
    }
    const num3 = Math.max(cautionLevel(self) / 100.0, 0.9);
    return Math.max(Math.trunc(num1 * (num3 * num3) * num2), -20);
}

/** Empire.7.cs 2905 CalculateTradeVolume. */
function calculateTradeVolume(self: Empire, empire: Empire): number {
    let diplomaticRelation = self.diplomaticRelations.byEmpire(empire);
    if (diplomaticRelation === null) diplomaticRelation = new DiplomaticRelation(DiplomaticRelationType.NotMet, self, self, empire, false);
    const val = Math.trunc(diplomaticRelation.normalizedAnnualTradeValue / 4000.0);
    return Math.min(25, val);
}

/** Empire.7.cs 4753 CalculateEnvy (+ BaconEmpire.cs 1484 CalculateEnvy). */
function calculateEnvy(self: Empire, empire: Empire): number {
    let relativeEmpireSize = empire.relativeEmpireSize;
    relativeEmpireSize -= 2.0;
    relativeEmpireSize = Math.max(0.0, relativeEmpireSize);
    let num = Math.max(1, totalColonyStrategicValue(empire)) / Math.max(1, totalColonyStrategicValue(self));
    if (relativeEmpireSize > 0.0 && num > 1.0) {
        let num2 = 1.0 + (empire.civilityRating + 5.0) / -10.0;
        num2 = Math.max(0.1, num2);
        num -= 1.0;
        if (num > 1.0) num = Math.sqrt(Math.min(4.0, num));
        if (relativeEmpireSize > 1.0) relativeEmpireSize = Math.sqrt(Math.max(1.0, relativeEmpireSize));
        let val = Math.trunc(-12.0 * relativeEmpireSize * num2 * num);
        val = Math.max(val, -25);
        if (empire.planetDestroyers != null && empire.planetDestroyers.length > 0) val -= Math.min(20, empire.planetDestroyers.length * 8);
        // BaconEmpire.cs 1484: 0 when the other empire has a mutual defense pact with us.
        if (obtainDiplomaticRelation(empire, self).type === DiplomaticRelationType.MutualDefensePact) val = 0;
        return val;
    }
    return 0;
}

/** Empire.6.cs 1387 DetermineResourcesEmpireSupplies (resource ids, first-seen order). */
export function determineResourcesEmpireSupplies(self: Empire): number[] {
    const resourceList: number[] = [];
    if (self.colonies != null) {
        for (let i = 0; i < self.colonies.length; i++) {
            const habitat = self.colonies[i];
            if (habitat == null || habitat.resources == null) continue;
            for (const resource2 of habitat.resources) {
                if (resourceList.indexOf(resource2.resourceId) < 0) resourceList.push(resource2.resourceId);
            }
        }
    }
    for (let j = 0; j < self.privateBuiltObjects.length; j++) {
        const builtObject = self.privateBuiltObjects[j];
        if (builtObject == null || (builtObject.subRole !== BuiltObjectSubRole.GasMiningStation && builtObject.subRole !== BuiltObjectSubRole.MiningStation) || builtObject.parentHabitat === null || builtObject.parentHabitat.resources == null) continue;
        for (const resource3 of builtObject.parentHabitat.resources) {
            if (resourceList.indexOf(resource3.resourceId) < 0) resourceList.push(resource3.resourceId);
        }
    }
    return resourceList;
}

/** Empire.7.cs 4691/4697 CheckEmpireSuppliesRestrictedResources([out resource]): the super-luxury resource id, or -1. */
export function checkEmpireSuppliesRestrictedResources(galaxy: Galaxy, self: Empire): number {
    const resourceList = determineResourcesEmpireSupplies(self);
    const superLuxury = galaxy.resourceSystem.superLuxuryResources;
    for (let i = 0; i < superLuxury.length; i++) {
        const resourceDefinition = superLuxury[i];
        if (resourceDefinition != null && resourceList.includes(resourceDefinition.resourceId)) return resourceDefinition.resourceId;
    }
    return -1;
}

/** Empire.7.cs 4578 IdentifyTopCompetitor. */
export function identifyTopCompetitor(galaxy: Galaxy, self: Empire): Empire | null {
    let result: Empire | null = null;
    let num = 0.0;
    for (let i = 0; i < galaxy.empires.length; i++) {
        const empire = galaxy.empires[i];
        if (empire == null || !empire.active || empire === self) continue;
        const diplomaticRelation = obtainDiplomaticRelation(self, empire);
        if (diplomaticRelation == null || diplomaticRelation.type === DiplomaticRelationType.NotMet || empire.capital === null) continue;
        const tcsv = totalColonyStrategicValue(empire);
        const habitat = fastFindNearestColony(galaxy, Math.trunc(empire.capital.xpos), Math.trunc(empire.capital.ypos), self, MAJOR_COLONY_STRATEGIC_THRESHHOLD);
        if (habitat === null) continue;
        const habitat2 = fastFindNearestColony(galaxy, Math.trunc(habitat.xpos), Math.trunc(habitat.ypos), empire, MAJOR_COLONY_STRATEGIC_THRESHHOLD);
        if (habitat2 !== null) {
            const d = galaxy.calculateDistance(habitat.xpos, habitat.ypos, habitat2.xpos, habitat2.ypos);
            const num2 = Math.sqrt(d);
            const num3 = tcsv / num2;
            if (num3 > num) {
                result = empire;
                num = num3;
            }
        }
    }
    return result;
}

/** Empire.7.cs 4997 SummaryCopy(relations). */
function summaryCopy(relations: DiplomaticRelation[]): DiplomaticRelationList {
    const diplomaticRelationList = new DiplomaticRelationList();
    for (const diplomaticRelation of relations) {
        const diplomaticRelation2 = new DiplomaticRelation(diplomaticRelation.type, diplomaticRelation.initiator, diplomaticRelation.thisEmpire, diplomaticRelation.otherEmpire, diplomaticRelation.supplyRestrictedResources);
        diplomaticRelation2.strategy = diplomaticRelation.strategy;
        diplomaticRelationList.add(diplomaticRelation2);
    }
    return diplomaticRelationList;
}

/** CharacterList.cs 125 FindCharactersAtLocationNotTransferring(location, role). */
function findCharactersAtLocationNotTransferringRole(list: Character[], location: Habitat | null, role: CharacterRole): Character[] {
    const result: Character[] = [];
    for (let index = 0; index < list.length; ++index) {
        const character = list[index];
        if (character != null && character.role === role && character.location === location && character.transferDestination === null) result.push(character);
    }
    return result;
}

/** CharacterList.cs 289 GetAmbassadorsForEmpire(empire) = FindCharactersAtLocationNotTransferring(empire.Capital) (113). */
export function getAmbassadorsForEmpire(list: Character[], empire: Empire | null): Character[] {
    const result: Character[] = [];
    if (empire != null && empire.capital !== null) {
        for (let index = 0; index < list.length; ++index) {
            const character = list[index];
            if (character != null && character.location === empire.capital && character.transferDestination === null) result.push(character);
        }
    }
    return result;
}

/** CharacterList.cs 101 FindCharactersAtLocation(location). */
function findCharactersAtLocation(list: Character[], location: Habitat | null): Character[] {
    const result: Character[] = [];
    for (let index = 0; index < list.length; ++index) {
        const character = list[index];
        if (character != null && character.location === location) result.push(character);
    }
    return result;
}

// ---------------------------------------------------------------------------------------------------------------
// Entry points: relative size, defeated/invalid relations, war counter.
// ---------------------------------------------------------------------------------------------------------------

/** Empire.7.cs 4135 CalculateRelativeEmpireSize. */
export function calculateRelativeEmpireSize(galaxy: Galaxy, empire: Empire): number {
    if (empire.pirateEmpireBaseHabitat === null) {
        let num = 0.0;
        for (let i = 0; i < galaxy.empires.length; i++) {
            const e = galaxy.empires[i];
            if (e != null && e.active && e !== empire) num += totalColonyStrategicValue(e);
        }
        const num2 = num / (galaxy.empires.length - 1);
        return totalColonyStrategicValue(empire) / num2;
    }
    let num3 = 0.0;
    for (let j = 0; j < galaxy.pirateEmpires.length; j++) {
        const empire2 = galaxy.pirateEmpires[j];
        if (empire2 != null && empire2.active && empire2 !== empire && empire2.builtObjects != null) num3 += totalMobileMilitaryFirepower(empire2.builtObjects);
    }
    const num4 = num3 / (galaxy.pirateEmpires.length - 1);
    return totalMobileMilitaryFirepower(empire.builtObjects) / num4;
}

/** Empire.1.cs 3322 RemoveDefeatedEmpireRelations. */
export function removeDefeatedEmpireRelations(galaxy: Galaxy, empire: Empire): void {
    void galaxy;
    const diplomaticRelationList: DiplomaticRelation[] = [];
    if (empire.diplomaticRelations != null) {
        for (let i = 0; i < empire.diplomaticRelations.count; i++) {
            const diplomaticRelation = empire.diplomaticRelations.at(i);
            if (!diplomaticRelation.otherEmpire!.active) diplomaticRelationList.push(diplomaticRelation);
        }
    }
    for (let j = 0; j < diplomaticRelationList.length; j++) empire.diplomaticRelations.remove(diplomaticRelationList[j]);
    const evaluations = empireEvaluationsOf(empire);
    const empireEvaluationList: EmpireEvaluation[] = [];
    if (evaluations != null) {
        for (let k = 0; k < evaluations.length; k++) {
            const empireEvaluation = evaluations[k];
            if (!empireEvaluation.empire!.active) empireEvaluationList.push(empireEvaluation);
        }
    }
    for (let l = 0; l < empireEvaluationList.length; l++) {
        const i = evaluations.indexOf(empireEvaluationList[l]);
        if (i >= 0) evaluations.splice(i, 1);
    }
    const pirateRelationList = [];
    if (empire.pirateRelations != null) {
        for (let m = 0; m < empire.pirateRelations.count; m++) {
            const pirateRelation = empire.pirateRelations.get(m);
            // PirateRelationList.AddRaw (drops a relation whose OtherEmpireId is out of range — never for a live empire).
            if (pirateRelation != null && pirateRelation.otherEmpire !== null && !pirateRelation.otherEmpire.active) pirateRelationList.push(pirateRelation);
        }
    }
    for (let n = 0; n < pirateRelationList.length; n++) empire.pirateRelations.remove(pirateRelationList[n]);
}

/** Empire.8.cs 1875 ClearInvalidDiplomaticRelations. */
export function clearInvalidDiplomaticRelations(galaxy: Galaxy, empire: Empire): void {
    void galaxy;
    const diplomaticRelationList: DiplomaticRelation[] = [];
    for (let i = 0; i < empire.diplomaticRelations.count; i++) {
        const diplomaticRelation = empire.diplomaticRelations.at(i);
        if (diplomaticRelation != null && (diplomaticRelation.otherEmpire == null || diplomaticRelation.otherEmpire === empire || !diplomaticRelation.otherEmpire.active)) diplomaticRelationList.push(diplomaticRelation);
    }
    for (let j = 0; j < diplomaticRelationList.length; j++) empire.diplomaticRelations.remove(diplomaticRelationList[j]);
    const list = [];
    for (let k = 0; k < empire.pirateRelations.count; k++) {
        const pirateRelation = empire.pirateRelations.get(k);
        if (pirateRelation != null && (pirateRelation.otherEmpire == null || pirateRelation.otherEmpire === empire || !pirateRelation.otherEmpire.active)) list.push(pirateRelation);
    }
    for (let l = 0; l < list.length; l++) empire.pirateRelations.remove(list[l]);
}

/** Empire.1.cs 3961 ReviewEmpireEndsAllWars(starDate). */
export function reviewEmpireEndsAllWars(galaxy: Galaxy, empire: Empire, starDate: number): void {
    void galaxy;
    if (empire.diplomacyCounters.atWarStartDate !== LONG_MAX_VALUE && !checkAtWarExcluding(empire, null)) empire.diplomacyCounters.fixupAtWarCounter(starDate);
}

// ---------------------------------------------------------------------------------------------------------------
// EvaluatePoliticalSituation (Empire.8.cs 1905).
// ---------------------------------------------------------------------------------------------------------------

/** GovernmentAttributes (throws like the C# null dereference when the empire has none). */
function governmentAttributesStrict(self: Empire) {
    const gov = empireGovernmentAttributes(self);
    if (gov === null) throw new Error('NullReferenceException: Empire.GovernmentAttributes');
    return gov;
}

/** Empire.cs 101 RaceEventType == GrandPerformanceDiplomacyBonus (set by Empire.1.cs InitiateRaceEvent, empireEvents.ts). */
function raceEventIsGrandPerformanceDiplomacyBonus(self: Empire): boolean {
    return self.raceEventType === RaceEventType.GrandPerformanceDiplomacyBonus;
}

/** Blockade.cs fields read by diplomacy (the Blockade model is not ported — M4m). */
interface BlockadeView {
    initiator: Empire | null;
}
/** BlockadeList.cs 42 Galaxy.Blockades.GetBlockadesAgainstEmpire(target). TODO(port) M4m: Galaxy.Blockades — empty until blockades exist. */
function galaxyBlockadesAgainstEmpire(galaxy: Galaxy, target: Empire): BlockadeView[] {
    void galaxy;
    void target;
    return [];
}

/**
 * Empire.8.cs 1905 EvaluatePoliticalSituation(TimeSpan timePassedSpan) — the span in game ms.
 * Rnd: Next(0,3) per close friend / friend under trade sanctions by a met empire (lift requests), Next(0,3) per recent
 * spying / attacking empire with a low attitude.
 */
export function evaluatePoliticalSituation(galaxy: Galaxy, empire: Empire, timePassedMs: number): void {
    const self = empire;
    const refusalCount: RefCount = { value: 0 };
    const totalSeconds = timePassedMs / 1000;
    self.topCompetitor = identifyTopCompetitor(galaxy, self);
    // `_ = _Galaxy.IntoleranceLevel;` (discarded).
    const num = CIVILITY_RATING_ANNUAL_NEUTRALIZATION_AMOUNT * (totalSeconds / REAL_SECONDS_IN_GALACTIC_YEAR);
    if (self.civilityRating > 0.0) {
        setCivilityRating(self, self.civilityRating - num);
        if (self.civilityRating < 0.0) setCivilityRating(self, 0.0);
    } else {
        setCivilityRating(self, self.civilityRating + num);
        if (self.civilityRating > 0.0) setCivilityRating(self, 0.0);
    }
    const { friends, closeFriends } = determineFriendsAndEnemies(self);
    const ourSystemStars = determineEmpireDominatedSystems(galaxy, self, true);
    const gov = empireGovernmentAttributes(self);
    for (let i = 0; i < galaxy.empires.length; i++) {
        const other = galaxy.empires[i];
        if (other === self) continue;
        const diplomaticRelation = obtainDiplomaticRelation(self, other);
        if (diplomaticRelation.type === DiplomaticRelationType.NotMet) continue;
        const rel = calculateRelationshipWithFriends(other, friends, closeFriends);
        const systemCompetition = calculateSystemCompetition(galaxy, self, other, ourSystemStars);
        const tradeVolume = calculateTradeVolume(self, other);
        let envy = calculateEnvy(self, other);
        let num2 = 0;
        if (checkEmpireSuppliesRestrictedResources(galaxy, other) >= 0) {
            const diplomaticRelation2 = obtainDiplomaticRelation(other, self);
            num2 = !diplomaticRelation2.supplyRestrictedResources ? -5 : 10;
        }
        const ev = obtainEmpireEvaluation(galaxy, self, other);
        if ((diplomaticRelation.type as DiplomaticRelationType) !== DiplomaticRelationType.NotMet && ev.firstContactPenalty < 0.0) {
            const num3 = FIRST_CONTACT_PENALTY_ANNUAL_REDUCTION_AMOUNT * (totalSeconds / REAL_SECONDS_IN_GALACTIC_YEAR);
            const val = ev.firstContactPenalty + num3;
            ev.firstContactPenalty = Math.min(0.0, val);
        }
        let num4 = 1.0;
        let num5 = -100;
        const otherCharacters = getEmpireCharacters(other);
        const characterList = findCharactersAtLocationNotTransferringRole(otherCharacters, self.capital, CharacterRole.Ambassador);
        for (let j = 0; j < characterList.length; j++) {
            const character = characterList[j];
            if (character != null && character.role === CharacterRole.Ambassador) num5 = Math.max(num5, character.diplomacy);
        }
        if (num5 <= -100) num5 = 0;
        num4 *= 1.0 + num5 / 100.0;
        const charactersByRole = getCharactersByRole(otherCharacters, CharacterRole.Leader);
        let num6 = -100;
        const otherCapitals = identifyEmpireCapitals(other); // Empire.Capitals (= IdentifyEmpireCapitals, Empire.4.cs 3340)
        for (let k = 0; k < charactersByRole.length; k++) {
            const character2 = charactersByRole[k];
            if (character2 != null && character2.role === CharacterRole.Leader && character2.location !== null && character2.location instanceof Habitat && otherCapitals != null && otherCapitals.includes(character2.location)) {
                num6 = Math.max(num6, character2.diplomacy);
            }
        }
        if (num6 <= -100) num6 = 0;
        num4 *= 1.0 + num6 / 100.0;
        if (ev.diplomacyFactor === 1.0 || !raceEventIsGrandPerformanceDiplomacyBonus(self)) ev.diplomacyFactor = num4;
        if (other.dominantRace !== null && other.dominantRace.name.toLowerCase() === 'mechanoid') envy = 0;
        ev.relationshipWithFriendsPositive = rel.positive;
        ev.relationshipWithFriendsNegative = rel.negative;
        ev.systemCompetition = systemCompetition;
        ev.tradeVolume = tradeVolume;
        ev.restrictedResourceTrading = num2;
        ev.envy = envy;
        const diplomaticRelation3 = obtainDiplomaticRelation(other, self);
        ev.militaryRefueling = diplomaticRelation3.militaryRefuelingToOther ? 5 : 0;
        ev.miningRights = diplomaticRelation3.miningRightsToOther ? 4 : 0;
        ev.civilityRatingWeight = gov !== null ? gov.importanceOfOthersReputations : 1.0;
        ev.covetousness = 0;
        if (self.empiresWithDesiredColonies.length > 0 && self.empiresWithDesiredColonies.includes(other)) {
            // HabitatPrioritizationList.cs 47 TotalPriorityValueForEmpire.
            let num7 = 0;
            for (const hp of self.desiredForeignColonies) {
                if (hp.habitat!.owner === other) num7 = (num7 + hp.priority) | 0;
            }
            let num8 = aggressionLevel(self) / 100.0;
            num8 *= num8;
            num8 = Math.max(num8, 1.0);
            const num9 = 60.0 / num8;
            ev.covetousness = Math.trunc((num7 / num9) * -1.0);
        }
        ev.blockades = 0;
        for (const item of galaxyBlockadesAgainstEmpire(galaxy, self)) {
            if (item.initiator === other) ev.blockades += BLOCKADE_EMPIRE_EVALUATION_VALUE;
        }
        const num10 = INCIDENT_EVALUATION_ANNUAL_NEUTRALIZATION_AMOUNT * (totalSeconds / REAL_SECONDS_IN_GALACTIC_YEAR);
        if (ev.incidentEvaluation > 0.0) {
            ev.incidentEvaluation = ev.incidentEvaluationRaw - num10;
            if (ev.incidentEvaluation < 0.0) ev.incidentEvaluation = 0.0;
        } else {
            ev.incidentEvaluation = ev.incidentEvaluationRaw + num10;
            if (ev.incidentEvaluation > 0.0) ev.incidentEvaluation = 0.0;
        }
        ev.governmentStyleAffinity = gov !== null ? Math.trunc(governmentNaturalAffinity(self.governmentId, other.governmentId)) : 0;
        let num11 = (ev.systemCompetition * totalSeconds) / EMPIRE_EVALUATION_TRENDING_FACTOR;
        if (ev.systemCompetition >= 0) num11 = (20.0 * totalSeconds) / EMPIRE_EVALUATION_TRENDING_FACTOR;
        ev.systemCompetitionCumulative += num11;
        let num12 = (ev.relationshipWithFriendsPositive * totalSeconds) / EMPIRE_EVALUATION_TRENDING_FACTOR;
        if (ev.relationshipWithFriendsPositive <= 0) num12 = (-5.0 * totalSeconds) / EMPIRE_EVALUATION_TRENDING_FACTOR;
        ev.relationshipWithFriendsPositiveCumulative += num12;
        let num13 = (ev.relationshipWithFriendsNegative * totalSeconds) / EMPIRE_EVALUATION_TRENDING_FACTOR;
        if (ev.relationshipWithFriendsNegative >= 0) num13 = (5.0 * totalSeconds) / EMPIRE_EVALUATION_TRENDING_FACTOR;
        ev.relationshipWithFriendsNegativeCumulative += num13;
        let num14 = (ev.covetousness * totalSeconds) / EMPIRE_EVALUATION_TRENDING_FACTOR;
        if (ev.covetousness >= 0 && ev.covetousnessCumulative < 0.0) num14 = (10.0 * totalSeconds) / EMPIRE_EVALUATION_TRENDING_FACTOR;
        ev.covetousnessCumulative += num14;
        let num15 = (ev.governmentStyleAffinity * totalSeconds) / EMPIRE_EVALUATION_TRENDING_FACTOR;
        if (ev.governmentStyleAffinity === 0) {
            if (ev.governmentStyleAffinityCumulative > 0.0) {
                num15 = (-10.0 * totalSeconds) / EMPIRE_EVALUATION_TRENDING_FACTOR;
                if (ev.governmentStyleAffinityCumulative - num15 < 0.0) num15 = ev.governmentStyleAffinityCumulative * -1.0;
            } else {
                num15 = (10.0 * totalSeconds) / EMPIRE_EVALUATION_TRENDING_FACTOR;
                if (ev.governmentStyleAffinityCumulative + num15 > 0.0) num15 = ev.governmentStyleAffinityCumulative * -1.0;
            }
        }
        ev.governmentStyleAffinityCumulative += num15;
        // Empire.8.cs 2105: GovernmentAttributes.NaturalAffinity(...) — unguarded (NullReferenceException without a government).
        const num16 = governmentNaturalAffinity(governmentAttributesStrict(self).governmentId, other.governmentId);
        if (ev.governmentStyleAffinity > 0) {
            if (num16 > 0.0) ev.governmentStyleAffinityCumulative = Math.min(ev.governmentStyleAffinityCumulative, num16);
        } else if (num16 < 0.0) {
            ev.governmentStyleAffinityCumulative = Math.max(ev.governmentStyleAffinityCumulative, num16);
        }
        if (ev.relationshipWithFriendsPositiveCumulative > 0.0) ev.relationshipWithFriendsPositiveCumulative = Math.min(ev.relationshipWithFriendsPositiveCumulative, RELATIONSHIP_WITH_FRIENDS_CAP);
        else ev.relationshipWithFriendsPositiveCumulative = 0.0;
        if (ev.relationshipWithFriendsNegativeCumulative < 0.0) ev.relationshipWithFriendsNegativeCumulative = Math.max(ev.relationshipWithFriendsNegativeCumulative, RELATIONSHIP_WITH_FRIENDS_CAP * -1.0);
        else ev.relationshipWithFriendsNegativeCumulative = 0.0;
        if (ev.covetousnessCumulative < 0.0) ev.covetousnessCumulative = Math.max(ev.covetousnessCumulative, COVETOUSNESS_CAP * -1.0);
        else ev.covetousnessCumulative = 0.0;
        if (ev.overallAttitudeWithoutSystemCompetition < 0) {
            if (ev.systemCompetitionCumulative < 0.0) ev.systemCompetitionCumulative = Math.max(ev.systemCompetitionCumulative, SYSTEM_COMPETITION_CAP_EXTENDED * -1.0);
            else ev.systemCompetitionCumulative = 0.0;
        } else if (ev.systemCompetitionCumulative < 0.0) {
            ev.systemCompetitionCumulative = Math.max(ev.systemCompetitionCumulative, SYSTEM_COMPETITION_CAP * -1.0);
        } else {
            ev.systemCompetitionCumulative = 0.0;
        }
    }
    const wmp = weightedMilitaryPotency(self);
    const num17 = countEmpiresWeDeclaredWarOn(self);
    countEmpiresWhoDeclaredWarOnUs(self);
    const num18 = countEmpiresWeDeclaredWarOnNonLocked(self);
    const num19 = countEmpiresWhoDeclaredWarOnUsNonLocked(self);
    let num20 = 2.0 - (aggressionLevel(self) + loyaltyLevel(self)) / 200.0;
    if (num18 > 0 || num19 > 0) {
        let num21 = 0.0;
        let num22 = 0.0;
        if (num18 > 0) num21 = num20 * (num18 / 1.0);
        if (num19 > 0) num22 = num20 * (num19 / 4.0);
        num20 = num21 + num22;
        num20 *= governmentAttributesStrict(self).warWeariness;
        if (self.dominantRace !== null && raceInt(self.dominantRace.warWearinessAttenuation) > 0) {
            const num23 = raceInt(self.dominantRace.warWearinessAttenuation) / 100.0;
            num20 *= 1.0 - num23;
        }
    } else {
        num20 *= BACON_WAR_WEARINESS_REDUCTION; // BaconEmpire.cs 338 AdjustWarWearinessWhenAtPeace
    }
    num20 *= timePassedMs / 60000.0;
    num20 *= warWearinessFactor(self);
    self.warWearinessRaw += num20;
    if (empireWarWeariness(self) < 0.0) self.warWearinessRaw = 0.0;
    else if (empireWarWeariness(self) > WAR_WEARINESS_MAXIMUM) self.warWearinessRaw = WAR_WEARINESS_MAXIMUM;
    if (num17 === 0 && self.civilityRating < 10.0) {
        const num24 = CIVILITY_RATING_ANNUAL_RISE_AMOUNT * (totalSeconds / REAL_SECONDS_IN_GALACTIC_YEAR);
        setCivilityRating(self, self.civilityRating + num24);
    }
    const evaluations = empireEvaluationsOf(self);
    for (let l = 0; l < evaluations.length; l++) {
        const ev2 = evaluations[l];
        let diplomaticRelationType = DiplomaticRelationType.None;
        const diplomaticRelation4 = obtainDiplomaticRelation(self, ev2.empire);
        if (diplomaticRelation4.type === DiplomaticRelationType.NotMet) continue;
        if (diplomaticRelation4 != null) diplomaticRelationType = diplomaticRelation4.type;
        const wmp2 = weightedMilitaryPotency(ev2.empire!);
        const num25 = evaluateMilitaryPotency(galaxy, wmp, wmp2, ev2.empire!);
        if (self.controlDiplomacyTreaties === MANUAL || self.reclusive || (diplomaticRelationType as DiplomaticRelationType) === DiplomaticRelationType.NotMet || diplomaticRelationType === DiplomaticRelationType.War) continue;
        if (num25 === 1 || num25 === 0) {
            for (const item2 of closeFriends) {
                const r5 = ev2.empire!.diplomaticRelations.byEmpire(item2);
                if (
                    r5 !== null &&
                    !r5.locked &&
                    r5.type === DiplomaticRelationType.TradeSanctions &&
                    r5.initiator !== item2 &&
                    galaxy.rnd.next(0, 3) === 1 &&
                    checkTaskAuthorized(galaxy, self, self.controlDiplomacyTreaties, refusalCount, generateAutomationMessageRequestLiftTradeSanctions(ev2.empire!, item2), ev2.empire, AdvisorMessageType.RequestLiftTradeSanctionsOther, null, item2, null)
                ) {
                    const description = generateMessageDescriptionType(EmpireMessageType.RequestLiftTradeSanctions, num25, item2);
                    sendMessageToEmpire(self, ev2.empire, EmpireMessageType.RequestLiftTradeSanctions, item2, description);
                }
            }
        }
        if (num25 !== 1) continue;
        for (const item3 of friends) {
            const r6 = ev2.empire!.diplomaticRelations.byEmpire(item3);
            if (
                r6 !== null &&
                !r6.locked &&
                r6.type === DiplomaticRelationType.TradeSanctions &&
                r6.initiator !== item3 &&
                galaxy.rnd.next(0, 3) === 1 &&
                checkTaskAuthorized(galaxy, self, self.controlDiplomacyTreaties, refusalCount, generateAutomationMessageRequestLiftTradeSanctions(ev2.empire!, item3), ev2.empire, AdvisorMessageType.RequestLiftTradeSanctionsOther, null, item3, null)
            ) {
                const description2 = generateMessageDescriptionType(EmpireMessageType.RequestLiftTradeSanctions, num25, item3);
                sendMessageToEmpire(self, ev2.empire, EmpireMessageType.RequestLiftTradeSanctions, item3, description2);
            }
        }
    }
    if (self.controlDiplomacyTreaties !== MANUAL) {
        for (let m = 0; m < self.recentSpyingEmpires.length; m++) {
            const empire2 = self.recentSpyingEmpires[m];
            const diplomaticRelation7 = obtainDiplomaticRelation(self, empire2);
            if (diplomaticRelation7.type !== DiplomaticRelationType.War) {
                const ev3 = obtainEmpireEvaluation(galaxy, self, empire2);
                const num26 = cautionLevel(self) - aggressionLevel(self);
                if (ev3.overallAttitude < num26 && galaxy.rnd.next(0, 3) > 0) {
                    const empireMessage = new EmpireMessage(self, EmpireMessageType.StopMissionsAgainstUs, null);
                    empireMessage.description = getText('We warn you to stop your covert missions against us!');
                    sendEmpireMessage(empireMessage, empire2);
                }
            }
        }
        for (let n = 0; n < self.recentAttackingEmpires.length; n++) {
            const empire3 = self.recentAttackingEmpires[n];
            const diplomaticRelation8 = obtainDiplomaticRelation(self, empire3);
            if (diplomaticRelation8.type !== DiplomaticRelationType.War) {
                const ev4 = obtainEmpireEvaluation(galaxy, self, empire3);
                const num27 = cautionLevel(self) - aggressionLevel(self);
                if (ev4.overallAttitude < num27 && galaxy.rnd.next(0, 3) > 0) {
                    const empireMessage2 = new EmpireMessage(self, EmpireMessageType.StopAttacks, null);
                    empireMessage2.description = getText('We warn you to stop your attacks against us!');
                    sendEmpireMessage(empireMessage2, empire3);
                }
            }
        }
    }
    self.recentAttackingEmpires.length = 0;
    self.recentSpyingEmpires.length = 0;
}

// ---------------------------------------------------------------------------------------------------------------
// War objectives (Empire.9.cs 3519-3700, Empire.7.cs 4784-4827, Empire.8.cs 16-64, Empire.7.cs 5009).
// ---------------------------------------------------------------------------------------------------------------

/**
 * Empire.8.cs 16 CheckEmpireBuildingVictoryWonder(empire). TODO(port) deferred: Galaxy.GameRaceSpecificVictoryConditionsEnabled
 * (victory conditions are not part of M4) — false, so this returns null.
 */
function checkEmpireBuildingVictoryWonder(galaxy: Galaxy, empire: Empire | null): Habitat | null {
    void galaxy;
    void empire;
    return null;
}

/** Empire.7.cs 5009 CheckEmpireBuildingVictoryWonderAtKnownColony(empire). */
function checkEmpireBuildingVictoryWonderAtKnownColony(galaxy: Galaxy, self: Empire, empire: Empire | null): Habitat | null {
    const habitat = checkEmpireBuildingVictoryWonder(galaxy, empire);
    if (habitat !== null) {
        const systemStar = galaxy.determineHabitatSystemStar(habitat);
        if (checkSystemExplored(self, systemStar.systemIndex)) return habitat;
    }
    return null;
}

/** Galaxy.8.cs 1633 IdentifyShakturiEmpire. Galaxy.ShakturiActualRace is set only by the story (deferred) → null. */
function identifyShakturiEmpire(galaxy: Galaxy): Empire | null {
    void galaxy;
    return null;
}

/** Empire.8.cs 36 EvaluateShouldAttackWonderBuildingEmpire. */
function evaluateShouldAttackWonderBuildingEmpire(galaxy: Galaxy, self: Empire, empire: Empire | null, wonderBuildingColony: Habitat | null, relationType: DiplomaticRelationType, strategy: DiplomaticStrategy): boolean {
    if (empire !== null && wonderBuildingColony !== null) {
        let flag = true;
        if (self.reclusive) {
            flag = false;
            const empire2 = identifyShakturiEmpire(galaxy);
            if (empire === empire2) flag = true;
        }
        if (flag && strategy !== DiplomaticStrategy.Ally && relationType !== DiplomaticRelationType.FreeTradeAgreement && relationType !== DiplomaticRelationType.Protectorate && relationType !== DiplomaticRelationType.MutualDefensePact) {
            const habitat = fastFindNearestColony(galaxy, wonderBuildingColony.xpos, wonderBuildingColony.ypos, self, 0);
            if (habitat !== null) {
                const num = galaxy.calculateDistance(wonderBuildingColony.xpos, wonderBuildingColony.ypos, habitat.xpos, habitat.ypos);
                if (num < SECTOR_SIZE * 3.0) return true;
            }
        }
    }
    return false;
}

/** Empire.9.cs 3519 IdentifyOurDisputedColonies(empire). */
export function identifyOurDisputedColonies(galaxy: Galaxy, self: Empire, empire: Empire): Habitat[] {
    const habitatList: Habitat[] = [];
    const habitatList2 = determineEmpireSystems(galaxy, empire);
    for (let i = 0; i < habitatList2.length; i++) {
        const bySystemIndex = galaxy.systems[habitatList2[i].systemIndex];
        if (bySystemIndex.habitats == null) continue;
        for (let j = 0; j < bySystemIndex.habitats.length; j++) {
            const habitat2 = bySystemIndex.habitats[j];
            if (habitat2.empire !== null && habitat2.empire !== galaxy.independentEmpire && habitat2.empire !== empire && (checkSystemExplored(self, habitat2.systemIndex) || isObjectVisibleToThisEmpire(galaxy, self, habitat2))) habitatList.push(habitat2);
        }
    }
    return habitatList;
}

/** Empire.9.cs 3543 IdentifyDisputedBases(otherEmpire). */
function identifyDisputedBasesOf(galaxy: Galaxy, self: Empire, otherEmpire: Empire): BuiltObject[] {
    const builtObjectList: BuiltObject[] = [];
    for (let i = 0; i < otherEmpire.disputedBases!.length; i++) {
        const builtObject = otherEmpire.disputedBases![i];
        if (builtObject.hasBeenDestroyed) continue;
        if (builtObject.nearestSystemStar !== null) {
            const bySystemIndex = galaxy.systems[builtObject.nearestSystemStar.systemIndex] as SystemInfo | undefined;
            if (bySystemIndex != null && bySystemIndex.dominantEmpire != null && bySystemIndex.dominantEmpire.empire != null && bySystemIndex.dominantEmpire.empire === self && (checkSystemExplored(self, builtObject.nearestSystemStar.systemIndex) || isObjectVisibleToThisEmpire(galaxy, self, builtObject))) builtObjectList.push(builtObject);
        } else {
            const num = galaxy.checkEmpireTerritoryIdAtLocation(builtObject.xpos, builtObject.ypos);
            if (num === self.empireId && isObjectVisibleToThisEmpire(galaxy, self, builtObject)) builtObjectList.push(builtObject);
        }
    }
    return builtObjectList;
}

/** Empire.9.cs 3578 IdentifyDesiredForeignColonies(empire, proximityValueThreshold). */
function identifyDesiredForeignColoniesOf(galaxy: Galaxy, self: Empire, empire: Empire, proximityValueThreshold: number): HabitatPrioritization[] {
    const list: HabitatPrioritization[] = [];
    const num = 1.5;
    const num2 = SECTOR_SIZE * num * (SECTOR_SIZE * num);
    for (let i = 0; i < empire.colonies.length; i++) {
        const habitat = empire.colonies[i];
        if (habitat == null || habitat.hasBeenDestroyed || (!checkSystemExplored(self, habitat.systemIndex) && !isObjectVisibleToThisEmpire(galaxy, self, habitat))) continue;
        const habitat2 = fastFindNearestColony(galaxy, habitat.xpos, habitat.ypos, self, 0);
        if (habitat2 === null) continue;
        const num3 = distanceSquared(habitat.xpos, habitat.ypos, habitat2.xpos, habitat2.ypos);
        if (num3 < num2) {
            const num4 = calculateEmpireColonyProximityValueAtPoint(self, habitat.xpos, habitat.ypos, num2);
            if (num4 > proximityValueThreshold) list.push(new HabitatPrioritization(habitat, Math.trunc(num4) | 0));
        }
    }
    netSort(list, (a, b) => a.compareTo(b));
    list.reverse();
    return list;
}

/** Empire.9.cs 3616 IdentifyDesiredForeignBases(empire, proximityValueThreshold). */
function identifyDesiredForeignBasesOf(galaxy: Galaxy, self: Empire, empire: Empire, proximityValueThreshold: number): BuiltObject[] {
    const num = 1.0;
    const num2 = SECTOR_SIZE * num * (SECTOR_SIZE * num);
    const builtObjectList2: BuiltObject[] = [];
    const pairs: { k: number; v: BuiltObject }[] = [];
    if (empire.builtObjects != null) builtObjectList2.push(...empire.builtObjects);
    if (empire.privateBuiltObjects != null) builtObjectList2.push(...empire.privateBuiltObjects);
    for (let i = 0; i < builtObjectList2.length; i++) {
        const builtObject = builtObjectList2[i];
        if (builtObject == null || builtObject.role !== BuiltObjectRole.Base || builtObject.hasBeenDestroyed || !isObjectVisibleToThisEmpire(galaxy, self, builtObject)) continue;
        const habitat = fastFindNearestColony(galaxy, builtObject.xpos, builtObject.ypos, self, 0);
        if (habitat === null) continue;
        const num3 = distanceSquared(builtObject.xpos, builtObject.ypos, habitat.xpos, habitat.ypos);
        if (num3 < num2) {
            const num4 = calculateEmpireColonyProximityValueAtPoint(self, builtObject.xpos, builtObject.ypos, num2);
            if (num4 > proximityValueThreshold) pairs.push({ k: num4, v: builtObject });
        }
    }
    // Array.Sort(keys, items): the parallel-array introsort makes the same swaps as sorting the pairs by key; Array.Reverse(items).
    netSort(pairs, (a, b) => compareDouble(a.k, b.k));
    const array = pairs.map((p) => p.v);
    array.reverse();
    return array;
}

/** Empire.9.cs 3663 IdentifyEmpireWarObjectives(empire, out targetedColonies, out targetedBases). */
export function identifyEmpireWarObjectives(galaxy: Galaxy, self: Empire, empire: Empire): { colonies: Habitat[]; bases: BuiltObject[] } {
    const proximityValueThreshold = 2.0 / self.policy!.warWillingness;
    const proximityValueThreshold2 = 10.0 / self.policy!.warWillingness;
    let items: Habitat[] = [];
    if (!self.reclusive) items = identifyOurDisputedColonies(galaxy, self, self);
    const items2 = identifyDisputedBasesOf(galaxy, self, empire);
    let habitatPrioritizationList: HabitatPrioritization[] = [];
    if (!self.reclusive) habitatPrioritizationList = identifyDesiredForeignColoniesOf(galaxy, self, empire, proximityValueThreshold);
    const items3 = identifyDesiredForeignBasesOf(galaxy, self, empire, proximityValueThreshold2);
    let habitat: Habitat | null = null;
    if (!self.reclusive) {
        habitat = checkEmpireBuildingVictoryWonderAtKnownColony(galaxy, self, empire);
        if (habitat !== null) {
            const diplomaticRelation = obtainDiplomaticRelation(self, empire);
            if (!evaluateShouldAttackWonderBuildingEmpire(galaxy, self, empire, habitat, diplomaticRelation.type, diplomaticRelation.strategy)) habitat = null;
        }
    }
    const targetedColonies: Habitat[] = [];
    if (habitat !== null) targetedColonies.push(habitat);
    targetedColonies.push(...items);
    for (const hp of habitatPrioritizationList) targetedColonies.push(hp.habitat!); // HabitatPrioritizationList.ResolveHabitats
    const targetedBases: BuiltObject[] = [];
    targetedBases.push(...items2);
    targetedBases.push(...items3);
    return { colonies: targetedColonies, bases: targetedBases };
}

/** Empire.7.cs 4790 SetWarObjectives(DiplomaticRelation relation). */
export function setWarObjectives(galaxy: Galaxy, self: Empire, relation: DiplomaticRelation | null): void {
    if (relation === null) return;
    let warObjective = WarObjective.Undefined;
    switch (relation.strategy) {
        case DiplomaticStrategy.Befriend:
        case DiplomaticStrategy.Placate:
        case DiplomaticStrategy.Defend:
        case DiplomaticStrategy.Ally:
        case DiplomaticStrategy.Undermine:
        case DiplomaticStrategy.DefendPlacate:
        case DiplomaticStrategy.DefendUndermine:
        case DiplomaticStrategy.Punish:
            warObjective = WarObjective.EndWar;
            break;
        case DiplomaticStrategy.Conquer:
            warObjective = WarObjective.CaptureObjectives;
            break;
    }
    relation.warObjective = warObjective;
    const obj = identifyEmpireWarObjectives(galaxy, self, relation.otherEmpire!);
    if (obj.colonies.length > 0 || obj.bases.length > 0) {
        relation.warObjective = WarObjective.CaptureObjectives;
        relation.warObjectiveColonies = obj.colonies;
        relation.warObjectiveBases = obj.bases;
    } else {
        relation.warObjective = WarObjective.EndWar;
        relation.warObjectiveColonies = [];
        relation.warObjectiveBases = [];
    }
}

// ---------------------------------------------------------------------------------------------------------------
// ReviewDiplomaticStrategies (Empire.8.cs 66) and its checks.
// ---------------------------------------------------------------------------------------------------------------

/** Empire.8.cs 481 CheckCanConductNewWar(otherEmpire, clearColonyTargetsIfNecessary). */
function checkCanConductNewWar(self: Empire, otherEmpire: Empire, clearColonyTargetsIfNecessary: boolean): boolean {
    const empireList = determineEmpiresAtWarWith(self);
    if (empireList.length > 0) return false;
    const shipGroups = empireShipGroups(self);
    if (shipGroups.length <= 0) return false;
    const diplomaticRelation = obtainDiplomaticRelation(self, otherEmpire);
    if (diplomaticRelation.warObjective === WarObjective.CaptureObjectives && diplomaticRelation.warObjectiveColonies.length > 0) {
        let flag = false;
        let flag2 = false;
        for (let i = 0; i < shipGroups.length; i++) {
            const shipGroup = shipGroups[i]!;
            if (fleetTotalTroopAttackStrength(shipGroup) > 0) flag = true;
            if (shipGroup.ships.length >= 10) flag2 = true;
        }
        if (!flag || !flag2) {
            if (clearColonyTargetsIfNecessary) {
                if (diplomaticRelation.warObjectiveBases.length > 0 && shipGroups.length > 0) diplomaticRelation.warObjectiveColonies.length = 0;
                return true;
            }
            return false;
        }
        return true;
    }
    return true;
}

/** Empire.8.cs 526 CheckMustConquer(otherEmpire). */
function checkMustConquer(galaxy: Galaxy, self: Empire, otherEmpire: Empire | null): boolean {
    const ev = obtainEmpireEvaluation(galaxy, self, otherEmpire);
    let num = -80.0;
    num /= Math.sqrt(self.policy!.warWillingness);
    return ev.incidentEvaluation < num;
}

/** Empire.8.cs 538 CheckDesireToConquer(otherEmpire). */
function checkDesireToConquer(galaxy: Galaxy, self: Empire, otherEmpire: Empire | null): boolean {
    const obj = identifyEmpireWarObjectives(galaxy, self, otherEmpire!);
    if (obj.colonies.length > 0 || obj.bases.length > 0) return true;
    const ev = obtainEmpireEvaluation(galaxy, self, otherEmpire);
    let num = -50.0;
    num /= Math.sqrt(self.policy!.warWillingness);
    return ev.incidentEvaluation < num;
}

/** Empire.8.cs 66 ReviewDiplomaticStrategies. Rnd: only SendScoutShipsToEnemyLocations (Next(0, 1)) when fleets were prepared. */
export function reviewDiplomaticStrategies(galaxy: Galaxy, empire: Empire): void {
    const self = empire;
    const mp = militaryPotency(self);
    let flag = false;
    const num = aggressionLevel(self) - friendlinessLevel(self);
    if (num > 10 && aggressionLevel(self) >= 100) flag = true;
    const topCompetitor = identifyTopCompetitor(galaxy, self);
    const race = self.dominantRace!;
    const num2 = raceInt(race.tradeBonus) + raceInt(race.resourceExtractionBonus) + raceInt(race.satisfactionModifier);
    const num3 = aggressionLevel(self) - 100 + (cautionLevel(self) - 100) + raceInt(race.warWearinessAttenuation);
    const num4 = raceInt(race.espionageBonus) * 2 + (intelligenceLevel(self) - 100);
    const array = self.diplomaticRelations.toArray();
    const diplomaticRelationList = summaryCopy(array);
    for (const diplomaticRelation of array) {
        const otherEmpire = diplomaticRelation.otherEmpire!;
        const ev = obtainEmpireEvaluation(galaxy, self, otherEmpire);
        const ev2 = obtainEmpireEvaluation(galaxy, otherEmpire, self);
        if (diplomaticRelation.type !== DiplomaticRelationType.NotMet && otherEmpire != null && otherEmpire.active) {
            const bias = ev.bias;
            let num5 = 0.0;
            if (empireGovernmentAttributes(self) !== null) num5 = governmentNaturalAffinity(self.governmentId, otherEmpire.governmentId);
            const overallAttitude = ev2.overallAttitude;
            const incidentEvaluation = ev.incidentEvaluation;
            const overallAttitude2 = ev.overallAttitude;
            const num6 = bias / 2.0 + num5 * 0.5 + overallAttitude / 5.0 + overallAttitude2 / 8.0 + incidentEvaluation / 5.0;
            const num7 = determineRelativeStrength(galaxy, mp, otherEmpire);
            let num8 = 12.0;
            let num9 = -10.0;
            let num10 = 18.0;
            let num11 = -17.0;
            if (self.policy != null) {
                num8 /= Math.sqrt(self.policy!.tradePriority);
                num10 /= Math.sqrt(self.policy!.alliancePriority);
                num11 /= Math.sqrt(self.policy!.warWillingness);
            }
            if (self.dominantRace !== null) {
                const num12 = aggressionLevel(self) / 100.0;
                const num13 = friendlinessLevel(self) / 100.0;
                const num14 = loyaltyLevel(self) / 100.0;
                if (diplomaticRelation.type === DiplomaticRelationType.FreeTradeAgreement) {
                    if (num14 > 1.0) num8 /= num14;
                    if (self.policy!.breakTreatyWillingness < 1.0) num8 *= Math.sqrt(self.policy!.breakTreatyWillingness);
                } else if (diplomaticRelation.type === DiplomaticRelationType.Protectorate || diplomaticRelation.type === DiplomaticRelationType.MutualDefensePact) {
                    if (num14 > 1.0) num10 /= num14;
                    if (self.policy!.breakTreatyWillingness < 1.0) num10 *= Math.sqrt(self.policy!.breakTreatyWillingness);
                } else {
                    num9 /= num12;
                    num11 /= num12;
                    num8 /= num13;
                    num10 /= num13;
                }
            }
            const befriendOrAlly = (): DiplomaticStrategy => (!(num6 > num10) ? DiplomaticStrategy.Befriend : DiplomaticStrategy.Ally);
            const neutralBefriend = (): DiplomaticStrategy => (friendlinessLevel(self) > 110 || overallAttitude2 > 20 ? DiplomaticStrategy.Befriend : DiplomaticStrategy.Undefined);
            let diplomaticStrategy = DiplomaticStrategy.Undefined;
            switch (num7) {
                case -1:
                    if (flag) {
                        if (num6 > num8) {
                            diplomaticStrategy = befriendOrAlly();
                        } else if (num6 < num9) {
                            if (num2 >= num4) diplomaticStrategy = DiplomaticStrategy.DefendPlacate;
                            else if (num4 > num2) diplomaticStrategy = DiplomaticStrategy.DefendUndermine;
                        } else {
                            diplomaticStrategy = DiplomaticStrategy.Undefined;
                        }
                    } else {
                        diplomaticStrategy = !(num6 > num8) ? (!(num6 < num9) ? neutralBefriend() : num2 <= num3 ? DiplomaticStrategy.Defend : DiplomaticStrategy.DefendPlacate) : befriendOrAlly();
                    }
                    break;
                case 0:
                    if (flag) {
                        if (num6 > num8) {
                            diplomaticStrategy = befriendOrAlly();
                        } else if (num6 < num9) {
                            if ((num3 > num2 && num3 > num4) || aggressionLevel(self) > 115 || overallAttitude2 < -5) diplomaticStrategy = DiplomaticStrategy.Conquer;
                            else if (incidentEvaluation < -5.0 && friendlinessLevel(self) - aggressionLevel(self) + overallAttitude2 < -10) diplomaticStrategy = DiplomaticStrategy.Punish;
                            else if (num2 >= num4) diplomaticStrategy = DiplomaticStrategy.DefendPlacate;
                            else if (num4 > num2) diplomaticStrategy = DiplomaticStrategy.DefendUndermine;
                        } else {
                            diplomaticStrategy = (friendlinessLevel(self) < 100 || raceInt(race.espionageBonus) > 0) && overallAttitude2 < 0 ? DiplomaticStrategy.Undermine : DiplomaticStrategy.Undefined;
                        }
                    } else if (num6 > num8) {
                        diplomaticStrategy = befriendOrAlly();
                    } else if (num6 < num9) {
                        if ((num3 > num2 && num3 > num4) || aggressionLevel(self) > 115 || overallAttitude2 < -10) diplomaticStrategy = DiplomaticStrategy.Conquer;
                        else if (num2 >= num4) diplomaticStrategy = DiplomaticStrategy.DefendPlacate;
                        else if (num4 > num2) diplomaticStrategy = DiplomaticStrategy.DefendUndermine;
                    } else {
                        diplomaticStrategy = neutralBefriend();
                    }
                    break;
                case 1:
                    if (!flag) {
                        diplomaticStrategy = !(num6 > num8)
                            ? !(num6 < num9)
                                ? neutralBefriend()
                                : aggressionLevel(self) > 115 || overallAttitude2 < -5
                                  ? DiplomaticStrategy.Conquer
                                  : !(incidentEvaluation < 0.0) || friendlinessLevel(self) - aggressionLevel(self) + overallAttitude2 >= -10
                                    ? DiplomaticStrategy.Defend
                                    : DiplomaticStrategy.Punish
                            : befriendOrAlly();
                    } else {
                        diplomaticStrategy = !(num6 > num8)
                            ? !(num6 < num9)
                                ? aggressionLevel(self) > 115 && overallAttitude2 < -5
                                    ? DiplomaticStrategy.Conquer
                                    : otherEmpire === topCompetitor && overallAttitude2 < -5
                                      ? DiplomaticStrategy.Undermine
                                      : DiplomaticStrategy.Undefined
                                : aggressionLevel(self) > 110 || overallAttitude2 < 0
                                  ? DiplomaticStrategy.Conquer
                                  : !(incidentEvaluation < -5.0) || friendlinessLevel(self) - aggressionLevel(self) + overallAttitude2 >= -10
                                    ? DiplomaticStrategy.Defend
                                    : DiplomaticStrategy.Punish
                            : befriendOrAlly();
                    }
                    break;
            }
            if (self.reclusive) {
                switch (diplomaticStrategy) {
                    case DiplomaticStrategy.Conquer:
                    case DiplomaticStrategy.Befriend:
                    case DiplomaticStrategy.Placate:
                    case DiplomaticStrategy.Ally:
                    case DiplomaticStrategy.Undermine:
                    case DiplomaticStrategy.Punish:
                        diplomaticStrategy = DiplomaticStrategy.Undefined;
                        break;
                    case DiplomaticStrategy.DefendPlacate:
                    case DiplomaticStrategy.DefendUndermine:
                        diplomaticStrategy = DiplomaticStrategy.Defend;
                        break;
                }
            }
            switch (diplomaticStrategy) {
                case DiplomaticStrategy.Ally:
                    if (overallAttitude2 < 15) diplomaticStrategy = DiplomaticStrategy.Befriend;
                    if (overallAttitude2 < 5) diplomaticStrategy = DiplomaticStrategy.Undefined;
                    break;
                case DiplomaticStrategy.Befriend:
                    if (overallAttitude2 < 5) diplomaticStrategy = DiplomaticStrategy.Undefined;
                    break;
            }
            if (diplomaticStrategy === DiplomaticStrategy.Conquer) {
                if (!checkDesireToConquer(galaxy, self, diplomaticRelation.otherEmpire)) diplomaticStrategy = DiplomaticStrategy.Undefined;
            } else if (checkMustConquer(galaxy, self, diplomaticRelation.otherEmpire)) {
                diplomaticStrategy = DiplomaticStrategy.Conquer;
            }
            if (diplomaticStrategy === DiplomaticStrategy.Punish && num6 >= num11 && !checkDesireToConquer(galaxy, self, diplomaticRelation.otherEmpire)) diplomaticStrategy = DiplomaticStrategy.Undermine;
            diplomaticRelation.sortTag = num6;
            diplomaticRelation.strategy = diplomaticStrategy;
            const habitat = checkEmpireBuildingVictoryWonderAtKnownColony(galaxy, self, diplomaticRelation.otherEmpire);
            if (habitat !== null && evaluateShouldAttackWonderBuildingEmpire(galaxy, self, diplomaticRelation.otherEmpire, habitat, diplomaticRelation.type, diplomaticRelation.strategy)) diplomaticRelation.strategy = DiplomaticStrategy.Conquer;
            if (diplomaticRelation.type === DiplomaticRelationType.War && diplomaticRelation.locked) diplomaticRelation.strategy = DiplomaticStrategy.Conquer;
        }
        if (diplomaticRelation.locked) {
            switch (diplomaticRelation.type) {
                case DiplomaticRelationType.None: diplomaticRelation.strategy = DiplomaticStrategy.Undefined; break;
                case DiplomaticRelationType.FreeTradeAgreement: diplomaticRelation.strategy = DiplomaticStrategy.Befriend; break;
                case DiplomaticRelationType.Protectorate: diplomaticRelation.strategy = DiplomaticStrategy.Ally; break;
                case DiplomaticRelationType.MutualDefensePact: diplomaticRelation.strategy = DiplomaticStrategy.Ally; break;
                case DiplomaticRelationType.SubjugatedDominion: diplomaticRelation.strategy = DiplomaticStrategy.Undefined; break;
                case DiplomaticRelationType.TradeSanctions: diplomaticRelation.strategy = DiplomaticStrategy.Punish; break;
                case DiplomaticRelationType.War: diplomaticRelation.strategy = DiplomaticStrategy.Conquer; break;
            }
        }
    }
    let num15 = 0;
    let num16 = 0;
    let num17 = 0;
    const num18 = 25.0 * (aggressionLevel(self) / 100.0);
    const diplomaticRelationList2: DiplomaticRelation[] = [];
    const diplomaticRelationList3: DiplomaticRelation[] = [];
    for (const diplomaticRelation2 of array) {
        if (diplomaticRelation2.type !== DiplomaticRelationType.NotMet) {
            diplomaticRelationList2.push(diplomaticRelation2);
            if (diplomaticRelation2.type === DiplomaticRelationType.War) {
                num17++;
            } else if (diplomaticRelation2.strategy === DiplomaticStrategy.Conquer) {
                diplomaticRelationList3.push(diplomaticRelation2);
                num15++;
            } else if (diplomaticRelation2.strategy === DiplomaticStrategy.Befriend || diplomaticRelation2.strategy === DiplomaticStrategy.Ally) {
                num16++;
            }
        }
    }
    let num19 = 1;
    if ((num17 > 0 && num15 > 0) || empireWarWeariness(self) >= num18 || empireShipGroups(self).length <= 0) num19 = 0;
    const bySortTag = (a: DiplomaticRelation, b: DiplomaticRelation): number => compareDouble(a.sortTag, b.sortTag);
    if (num15 > num19) {
        netSort(diplomaticRelationList3, bySortTag);
        for (let k = 0; k < diplomaticRelationList3.length; k++) {
            if (k >= num19) {
                const num20 = determineRelativeStrength(galaxy, mp, diplomaticRelationList3[k].otherEmpire!);
                if (num20 === 1) diplomaticRelationList3[k].strategy = DiplomaticStrategy.Undermine;
                else if (num4 > num3 || raceInt(race.espionageBonus) > 0) diplomaticRelationList3[k].strategy = DiplomaticStrategy.DefendUndermine;
                else diplomaticRelationList3[k].strategy = DiplomaticStrategy.Defend;
            }
        }
    }
    let num21 = 0;
    let num22 = 0;
    const diplomaticRelationList4: DiplomaticRelation[] = [];
    for (const diplomaticRelation3 of array) {
        if (diplomaticRelation3.type !== DiplomaticRelationType.NotMet) {
            if (diplomaticRelation3.type === DiplomaticRelationType.TradeSanctions) {
                num22++;
            } else if (diplomaticRelation3.strategy === DiplomaticStrategy.Punish) {
                diplomaticRelationList4.push(diplomaticRelation3);
                num21++;
            }
        }
    }
    let num23 = 1;
    if (num22 > 0 && num21 > 0) num23 = 0;
    if (num21 > num23) {
        netSort(diplomaticRelationList4, bySortTag);
        for (let m = 0; m < diplomaticRelationList4.length; m++) {
            if (m >= num23) {
                const num24 = determineRelativeStrength(galaxy, mp, diplomaticRelationList4[m].otherEmpire!);
                diplomaticRelationList4[m].strategy = num24 === 1 ? DiplomaticStrategy.Undermine : DiplomaticStrategy.Undefined;
            }
        }
    }
    if (!self.reclusive && num16 <= 0 && diplomaticRelationList2.length > 1) {
        netSort(diplomaticRelationList2, bySortTag);
        diplomaticRelationList2.reverse();
        const top = diplomaticRelationList2[0];
        if (top.sortTag > 2.0 && top.type !== DiplomaticRelationType.War && top.type !== DiplomaticRelationType.TradeSanctions && top.type !== DiplomaticRelationType.NotMet) {
            const ev3 = obtainEmpireEvaluation(galaxy, self, top.otherEmpire);
            if (ev3.overallAttitude >= 5) top.strategy = DiplomaticStrategy.Befriend;
        }
    }
    for (const diplomaticRelation4 of array) {
        const diplomaticRelation5 = diplomaticRelationList.byEmpire(diplomaticRelation4.otherEmpire)!;
        if (diplomaticRelation4.strategy === DiplomaticStrategy.Conquer) setWarObjectives(galaxy, self, diplomaticRelation4);
        if (diplomaticRelation5.strategy === DiplomaticStrategy.Conquer && diplomaticRelation4.strategy !== DiplomaticStrategy.Conquer) {
            clearAttackFleetAssignments(galaxy, self, diplomaticRelation4.otherEmpire);
        } else if (diplomaticRelation4.strategy === DiplomaticStrategy.Conquer && diplomaticRelation5.strategy !== DiplomaticStrategy.Conquer) {
            if (checkCanConductNewWar(self, diplomaticRelation4.otherEmpire!, true)) {
                setDefendFleets(galaxy, self, false, true);
                const num25 = prepareFleetsForWar(galaxy, self, diplomaticRelation4.otherEmpire!);
                if (num25 > 0) {
                    if (self.controlMilitaryAttacks !== MANUAL && self.policy!.useExplorationShipsToScoutEnemySystems) sendScoutShipsToEnemyLocations(galaxy, self, [diplomaticRelation4.otherEmpire!]);
                } else {
                    diplomaticRelation4.strategy = DiplomaticStrategy.DefendUndermine;
                }
            } else {
                diplomaticRelation4.strategy = DiplomaticStrategy.DefendUndermine;
            }
        } else if (
            (diplomaticRelation4.strategy === DiplomaticStrategy.Defend || diplomaticRelation4.strategy === DiplomaticStrategy.DefendPlacate || diplomaticRelation4.strategy === DiplomaticStrategy.DefendUndermine) &&
            diplomaticRelation5.strategy !== DiplomaticStrategy.Defend &&
            diplomaticRelation5.strategy !== DiplomaticStrategy.DefendPlacate &&
            diplomaticRelation5.strategy !== DiplomaticStrategy.DefendUndermine
        ) {
            setDefendFleets(galaxy, self, false, true);
        }
    }
    const targetEmpires = determineEmpiresWarOrConquer(self);
    checkAttackFleetTargets(galaxy, self, targetEmpires);
}

// ---------------------------------------------------------------------------------------------------------------
// Fleets for war (Empire.8.cs 1014 PrepareFleetsForWar; Empire.9.cs 4446 SendScoutShipsToEnemyLocations).
// ---------------------------------------------------------------------------------------------------------------

const T_prepareFleetsCapture = registerTodo('M4r', 'prepareFleetsForWar CaptureObjectives fleet assignment (M4l/M4m fleet model)');

/**
 * Empire.8.cs 1014 PrepareFleetsForWar(otherEmpire): the number of fleets given an attack point.
 * The CaptureObjectives branch walks GenerateOrderedFleetsForTarget (ship groups) per objective: with no ship groups
 * every list is empty and it returns 0, as the C# does. TODO(port) M4l/M4m: the fleet assignment itself
 * (EstimatedDefensiveForceRequired, DetermineRequiredTroopStrength, DecideBestFleetRefuelPoint, GatherPoint/AttackPoint,
 * AssignMission(Refuel)) once ShipGroup is ported; until then fleets present → 0 fleets prepared (todo hit).
 */
export function prepareFleetsForWar(galaxy: Galaxy, self: Empire, otherEmpire: Empire): number {
    const num = 0;
    if (self.controlMilitaryFleets) {
        const diplomaticRelation = obtainDiplomaticRelation(self, otherEmpire);
        if (diplomaticRelation.warObjective === WarObjective.TotalConquest) {
            identifyMilitaryObjectives(galaxy, self);
        } else if (diplomaticRelation.warObjective === WarObjective.CaptureObjectives) {
            if (empireShipGroups(self).length > 0 && (diplomaticRelation.warObjectiveColonies.length > 0 || diplomaticRelation.warObjectiveBases.length > 0)) todo(T_prepareFleetsCapture);
        }
    }
    return num;
}

/** Empire.9.cs 4594 CountAvailableScoutShips(out totalExplorationShips). */
function countAvailableScoutShips(self: Empire): { available: number; total: number } {
    let num = 0;
    let totalExplorationShips = 0;
    for (let i = 0; i < self.builtObjects.length; i++) {
        if (self.builtObjects[i].subRole === BuiltObjectSubRole.ExplorationShip) {
            totalExplorationShips++;
            const builtObject = self.builtObjects[i];
            const mission = builtObjectMission(builtObject.mission);
            // TODO(port) M4b: BuiltObjectMission.Priority (not on the M4a mission skeleton) — read as Undefined.
            const priority = (mission as unknown as { priority?: BuiltObjectMissionPriority } | null)?.priority ?? BuiltObjectMissionPriority.Undefined;
            if (
                builtObject.builtAt == null &&
                builtObject.isAutoControlled &&
                (mission === null || mission.type === BuiltObjectMissionType.Undefined || priority === BuiltObjectMissionPriority.Undefined || priority === BuiltObjectMissionPriority.Low || priority === BuiltObjectMissionPriority.Normal)
            ) {
                num++;
            }
        }
    }
    return { available: num, total: totalExplorationShips };
}

/** Empire.9.cs 4446 SendScoutShipsToEnemyLocations(enemyEmpires). Draws Rnd.Next(0, enemyEmpires.Count). */
export function sendScoutShipsToEnemyLocations(galaxy: Galaxy, self: Empire, enemyEmpires: Empire[]): void {
    if (enemyEmpires.length <= 0) return;
    const c = countAvailableScoutShips(self);
    let val = c.available;
    val = Math.min(val, Math.trunc(c.total / 2));
    let num = Math.trunc(val / enemyEmpires.length);
    if (num === 0 && val > 0) num = 1;
    if (enemyEmpires.length <= 0) return;
    const num2 = galaxy.rnd.next(0, enemyEmpires.length);
    for (let i = num2; i < enemyEmpires.length; i++) {
        if (val > 0) val -= sendScoutsToSingleEnemyEmpire(galaxy, self, enemyEmpires[i], num);
    }
    for (let j = 0; j < num2; j++) {
        if (val > 0) val -= sendScoutsToSingleEnemyEmpire(galaxy, self, enemyEmpires[j], num);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// ReviewDiplomaticSituations (Empire.8.cs 742) and ImplementDiplomaticStrategy / ApplyDiplomaticStrategyToRelation.
// ---------------------------------------------------------------------------------------------------------------

/** Empire.8.cs 742 ReviewDiplomaticSituations. */
export function reviewDiplomaticSituations(galaxy: Galaxy, empire: Empire): void {
    for (let i = 0; i < empire.diplomaticRelations.count; i++) {
        const diplomaticRelation = empire.diplomaticRelations.at(i);
        if (diplomaticRelation != null && diplomaticRelation.type !== DiplomaticRelationType.NotMet) {
            implementDiplomaticStrategy(galaxy, empire, diplomaticRelation.otherEmpire, diplomaticRelation.strategy);
            applyDiplomaticStrategyToRelation(galaxy, empire, diplomaticRelation, diplomaticRelation.strategy);
        }
    }
}

/** Empire.8.cs 557 CheckOfferMilitaryRefueling(relation). */
function checkOfferMilitaryRefueling(galaxy: Galaxy, self: Empire, relation: DiplomaticRelation): boolean {
    if (!relation.militaryRefuelingToOther && relation.strategy === DiplomaticStrategy.Ally) {
        const ev = obtainEmpireEvaluation(galaxy, self, relation.otherEmpire);
        if (ev.incidentEvaluation >= 10.0 && checkTaskAuthorizedSimple(galaxy, self, self.controlDiplomacyTreaties, generateAutomationMessageMilitaryRefueling(relation.otherEmpire!, true), relation.otherEmpire, AdvisorMessageType.OfferMilitaryRefueling)) {
            offerMilitaryRefueling(self, relation.otherEmpire!);
            return true;
        }
    }
    return false;
}

/** Empire.8.cs 571 CheckOfferMiningRights(relation). */
function checkOfferMiningRights(galaxy: Galaxy, self: Empire, relation: DiplomaticRelation): boolean {
    if (!relation.miningRightsToOther && (relation.strategy === DiplomaticStrategy.Ally || relation.strategy === DiplomaticStrategy.Befriend)) {
        const ev = obtainEmpireEvaluation(galaxy, self, relation.otherEmpire);
        if (ev.incidentEvaluation >= 5.0 && checkTaskAuthorizedSimple(galaxy, self, self.controlDiplomacyTreaties, generateAutomationMessageMiningRights(relation.otherEmpire!, true), relation.otherEmpire, AdvisorMessageType.OfferMiningRights)) {
            offerMiningRights(self, relation.otherEmpire!);
            return true;
        }
    }
    return false;
}

/** Empire.8.cs 585 ImplementDiplomaticStrategy(otherEmpire, strategy). Rnd: Next(0,2) choices per strategy, gifts Next(100, n). */
function implementDiplomaticStrategy(galaxy: Galaxy, self: Empire, otherEmpire: Empire | null, strategy: DiplomaticStrategy): void {
    if (otherEmpire === null) return;
    const diplomaticRelation = obtainDiplomaticRelation(self, otherEmpire);
    const ev = obtainEmpireEvaluation(galaxy, self, otherEmpire);
    const ev2 = obtainEmpireEvaluation(galaxy, otherEmpire, self);
    if (ev.incidentEvaluation < -5.0) checkCancelMilitaryRefueling(galaxy, self, otherEmpire);
    if (ev.incidentEvaluation < -10.0) checkCancelMiningRights(galaxy, self, otherEmpire);
    switch (strategy) {
        case DiplomaticStrategy.Ally:
            if (diplomaticRelation.type === DiplomaticRelationType.MutualDefensePact || diplomaticRelation.type === DiplomaticRelationType.Protectorate) {
                if (galaxy.rnd.next(0, 2) === 1) {
                    if (ev2.overallAttitude < 50) giveGiftWhenSufficientTimePassed(galaxy, self, otherEmpire, true);
                } else if (galaxy.rnd.next(0, 2) === 1) {
                    // Empire.8.cs 710 OfferTrade(otherEmpire): empty body.
                }
            } else if (galaxy.rnd.next(0, 2) === 1) {
                if (ev2.overallAttitude < 50) giveGiftWhenSufficientTimePassed(galaxy, self, otherEmpire, false);
            } else {
                offerMutualDefense(galaxy, self, otherEmpire);
            }
            if (galaxy.rnd.next(0, 2) === 1) checkOfferMilitaryRefueling(galaxy, self, diplomaticRelation);
            else checkOfferMiningRights(galaxy, self, diplomaticRelation);
            break;
        case DiplomaticStrategy.Befriend:
            if (diplomaticRelation.type === DiplomaticRelationType.FreeTradeAgreement || diplomaticRelation.type === DiplomaticRelationType.MutualDefensePact || diplomaticRelation.type === DiplomaticRelationType.Protectorate) {
                if (galaxy.rnd.next(0, 2) === 1 && ev2.overallAttitude < 25) giveGiftWhenSufficientTimePassed(galaxy, self, otherEmpire, true);
            } else if (galaxy.rnd.next(0, 2) === 1) {
                if (ev2.overallAttitude < 25) giveGiftWhenSufficientTimePassed(galaxy, self, otherEmpire, false);
            } else {
                offerFreeTrade(galaxy, self, otherEmpire);
            }
            checkOfferMiningRights(galaxy, self, diplomaticRelation);
            break;
        case DiplomaticStrategy.Conquer:
            if (diplomaticRelation.type !== DiplomaticRelationType.War && checkReadyForWar(galaxy, self, otherEmpire)) startWar(galaxy, self, otherEmpire);
            checkCancelMilitaryRefueling(galaxy, self, otherEmpire);
            checkCancelMiningRights(galaxy, self, otherEmpire);
            checkCancelRestrictedResourceTrading(galaxy, self, otherEmpire);
            break;
        case DiplomaticStrategy.Defend:
            checkCancelMilitaryRefueling(galaxy, self, otherEmpire);
            break;
        case DiplomaticStrategy.DefendPlacate:
            if (diplomaticRelation.type !== DiplomaticRelationType.War && galaxy.rnd.next(0, 2) === 1 && ev2.overallAttitude < 0) giveGiftWhenSufficientTimePassed(galaxy, self, otherEmpire, false);
            break;
        case DiplomaticStrategy.DefendUndermine:
            checkCancelMilitaryRefueling(galaxy, self, otherEmpire);
            break;
        case DiplomaticStrategy.Placate:
            if (diplomaticRelation.type !== DiplomaticRelationType.War && galaxy.rnd.next(0, 2) === 1 && ev2.overallAttitude < 0) giveGiftWhenSufficientTimePassed(galaxy, self, otherEmpire, false);
            break;
        case DiplomaticStrategy.Punish:
        case DiplomaticStrategy.Undermine:
            if (diplomaticRelation.type !== DiplomaticRelationType.TradeSanctions && diplomaticRelation.type !== DiplomaticRelationType.War) startTradeSanctionsIfTimePassed(galaxy, self, otherEmpire);
            cancelTreatiesIfTimePassed(galaxy, self, otherEmpire);
            checkCancelMilitaryRefueling(galaxy, self, otherEmpire);
            checkCancelMiningRights(galaxy, self, otherEmpire);
            checkCancelRestrictedResourceTrading(galaxy, self, otherEmpire);
            break;
    }
}

/** Empire.8.cs 714 DetermineDesiredDiplomaticRelationTypical(strategy, currentRelationType). */
export function determineDesiredDiplomaticRelationTypical(strategy: DiplomaticStrategy, currentRelationType: DiplomaticRelationType): DiplomaticRelationType {
    switch (strategy) {
        case DiplomaticStrategy.Ally: return DiplomaticRelationType.MutualDefensePact;
        case DiplomaticStrategy.Befriend: return DiplomaticRelationType.FreeTradeAgreement;
        case DiplomaticStrategy.Conquer: return DiplomaticRelationType.War;
        case DiplomaticStrategy.Placate:
        case DiplomaticStrategy.Defend:
        case DiplomaticStrategy.DefendPlacate: return DiplomaticRelationType.None;
        case DiplomaticStrategy.DefendUndermine:
            if (currentRelationType === DiplomaticRelationType.TradeSanctions) return DiplomaticRelationType.TradeSanctions;
            return DiplomaticRelationType.None;
        case DiplomaticStrategy.Undermine:
        case DiplomaticStrategy.Punish: return DiplomaticRelationType.TradeSanctions;
        default: return DiplomaticRelationType.None;
    }
}

/** Empire.8.cs 755 ApplyDiplomaticStrategyToRelation(relation, strategy). */
function applyDiplomaticStrategyToRelation(galaxy: Galaxy, self: Empire, relation: DiplomaticRelation | null, strategy: DiplomaticStrategy): void {
    if (relation === null) return;
    const diplomaticRelationType = determineDesiredDiplomaticRelationTypical(strategy, relation.type);
    switch (relation.type) {
        case DiplomaticRelationType.War: {
            if (relation.initiator === self) {
                const c = considerEndWar(galaxy, self, relation.otherEmpire!, false);
                if (!c.end) break;
                const num2 = militaryPotency(self) / militaryPotency(relation.otherEmpire!);
                switch (c.reason) {
                    case WarEndReason.AtWarWithOtherEmpires:
                    case WarEndReason.ObjectivesMet:
                        if (num2 > 3.0 && galaxy.rnd.next(0, 2) === 1) subjugateRequest(galaxy, self, relation.otherEmpire!);
                        else endWarRequest(galaxy, self, relation.otherEmpire!);
                        break;
                    case WarEndReason.WarWearinessExceeded:
                    case WarEndReason.HeavyLosses:
                    case WarEndReason.NoAttackFleets:
                        if (aggressionLevel(self) >= 115 && galaxy.rnd.next(0, 3) === 1) subjugateRequest(galaxy, self, relation.otherEmpire!);
                        else endWarRequest(galaxy, self, relation.otherEmpire!);
                        break;
                    case WarEndReason.WantEnd:
                        endWarRequest(galaxy, self, relation.otherEmpire!);
                        break;
                }
                break;
            }
            const c2 = considerEndWar(galaxy, self, relation.otherEmpire!, false);
            if (c2.end) {
                const v = determineVictorInWar(relation);
                // DetermineWhetherWantToOfferSubjugation draws 2 NextDouble; `&&` short-circuits as in C#.
                if (v.victor === self && determineWhetherWantToOfferSubjugation(galaxy, self, self) && determineSubjugationOfLoserInWar(v.victor, v.loser, v.winningRatio, militaryPotency(v.victor), militaryPotency(v.loser))) subjugateRequest(galaxy, self, relation.otherEmpire!);
                else endWarRequest(galaxy, self, relation.otherEmpire!);
            }
            break;
        }
        case DiplomaticRelationType.TradeSanctions:
            if (relation.initiator === self && diplomaticRelationType !== DiplomaticRelationType.TradeSanctions && diplomaticRelationType !== DiplomaticRelationType.War) endTradeSanctionsIfTimePassed(galaxy, self, relation.otherEmpire!);
            break;
        case DiplomaticRelationType.SubjugatedDominion:
            if (relation.initiator === self) {
                if (diplomaticRelationType === DiplomaticRelationType.FreeTradeAgreement || diplomaticRelationType === DiplomaticRelationType.MutualDefensePact || diplomaticRelationType === DiplomaticRelationType.Protectorate) endSubjugation(galaxy, self, relation.otherEmpire!);
            } else {
                if (self.controlDiplomacyTreaties === MANUAL) break;
                const otherEmpire = relation.otherEmpire!;
                const num = determineRelativeStrength(galaxy, militaryPotency(self), otherEmpire);
                const diplomaticRelation = new DiplomaticRelation(DiplomaticRelationType.None, self, self, otherEmpire, galaxyStarDate(galaxy), relation.supplyRestrictedResources);
                const refusalCount: RefCount = { value: 0 };
                const propose = (): void => {
                    otherEmpire.proposedDiplomaticRelations.add(diplomaticRelation);
                    const description = generateMessageDescriptionRelation(relation, DiplomaticRelationType.None, num);
                    relation.lastDiplomacyTradeOfferDate = galaxyStarDate(galaxy);
                    sendMessageToEmpire(self, otherEmpire, EmpireMessageType.ProposeDiplomaticRelation, DiplomaticRelationType.None, description);
                };
                const authorized = (): boolean => checkTaskAuthorized(galaxy, self, self.controlDiplomacyTreaties, refusalCount, generateAutomationMessageTreaty(otherEmpire, DiplomaticRelationType.None), otherEmpire, AdvisorMessageType.TreatyOffer, null, DiplomaticRelationType.None, null);
                switch (num) {
                    case -1:
                        if (galaxy.rnd.next(0, 8) === 2 && authorized()) propose();
                        break;
                    case 0:
                        if (galaxy.rnd.next(0, 3) === 2 && authorized()) propose();
                        break;
                    case 1:
                        if (authorized()) propose();
                        break;
                }
            }
            break;
    }
}

/** Empire.8.cs 899/904 ConsiderEndWar(otherEmpire, out endReason[, otherEmpireOfferingToBeSubjugated]). */
export function considerEndWar(galaxy: Galaxy, self: Empire, otherEmpire: Empire, otherEmpireOfferingToBeSubjugated: boolean): { end: boolean; reason: WarEndReason } {
    let flag = true;
    let endReason = WarEndReason.Undefined;
    const diplomaticRelation = obtainDiplomaticRelation(self, otherEmpire);
    if (diplomaticRelation != null && diplomaticRelation.type === DiplomaticRelationType.War) {
        if (diplomaticRelation.locked) return { end: false, reason: endReason };
        switch (diplomaticRelation.warObjective) {
            case WarObjective.CaptureObjectives: {
                for (let i = 0; i < diplomaticRelation.warObjectiveColonies.length; i++) {
                    const habitat = diplomaticRelation.warObjectiveColonies[i];
                    if (habitat != null && !habitat.hasBeenDestroyed && habitat.empire !== null && habitat.empire !== galaxy.independentEmpire && habitat.empire !== self && habitat.empire === otherEmpire) flag = false;
                }
                for (let j = 0; j < diplomaticRelation.warObjectiveBases.length; j++) {
                    const builtObject = diplomaticRelation.warObjectiveBases[j];
                    if (builtObject != null && !builtObject.hasBeenDestroyed && builtObject.empire !== null && builtObject.empire !== galaxy.independentEmpire && builtObject.empire !== self && builtObject.empire === otherEmpire) flag = false;
                }
                endReason = WarEndReason.ObjectivesMet;
                break;
            }
            case WarObjective.EndWar:
                flag = true;
                endReason = WarEndReason.WantEnd;
                break;
            case WarObjective.TotalConquest:
                if (otherEmpire.colonies.length > 0 && otherEmpire.active) flag = false;
                break;
            default:
                flag = true;
                break;
        }
        const num = aggressionLevel(self) / 100.0;
        let num2 = 25.0 * num;
        if (otherEmpireOfferingToBeSubjugated) num2 *= 0.6;
        if (empireWarWeariness(self) > num2) {
            flag = true;
            endReason = WarEndReason.WarWearinessExceeded;
        }
        const empireList = determineEmpiresAtWarWith(self);
        if (empireList.length > 1) {
            let num3 = 0;
            for (let k = 0; k < empireList.length; k++) num3 = (num3 + totalMobileMilitaryFirepower(empireList[k].builtObjects)) | 0;
            const num4 = totalMobileMilitaryFirepower(self.builtObjects) / num3;
            let num5 = 1.0;
            if (otherEmpireOfferingToBeSubjugated) num5 = 2.0;
            if (num4 < num5) {
                flag = true;
                endReason = WarEndReason.AtWarWithOtherEmpires;
            }
        }
        if (checkWhetherWarDamageExceedsLimit(galaxy, self, diplomaticRelation.warDamageBuiltObject, diplomaticRelation.warDamageColony)) {
            flag = true;
            endReason = WarEndReason.HeavyLosses;
        }
        let num6 = 0;
        const shipGroups = empireShipGroups(self);
        for (let l = 0; l < shipGroups.length; l++) {
            const shipGroup = shipGroups[l];
            if (shipGroup != null && fleetPosture(shipGroup) === FleetPosture.Attack && shipGroup.ships.length > 0) num6++;
        }
        if (num6 <= 0) {
            flag = true;
            endReason = WarEndReason.NoAttackFleets;
        }
        if (flag) {
            const num7 = diplomaticRelation.startDateOfLastChange + Math.trunc(MINIMUM_WAR_LENGTH_PERIOD_YEARS * REAL_SECONDS_IN_GALACTIC_YEAR * 1000.0);
            if (galaxyStarDate(galaxy) < num7) flag = false;
        }
    }
    return { end: flag, reason: endReason };
}

/** Galaxy.3.cs 474 CalculateWarValue(BuiltObject). */
function calculateWarValueBuiltObject(bo: BuiltObject): number {
    let num = 0;
    switch (bo.role) {
        case BuiltObjectRole.Military:
            num = bo.design.firepowerRaw;
            break;
        case BuiltObjectRole.Base:
            switch (bo.subRole) {
                case BuiltObjectSubRole.SmallSpacePort:
                case BuiltObjectSubRole.MediumSpacePort:
                case BuiltObjectSubRole.LargeSpacePort:
                    num = bo.parentHabitat === null ? Math.trunc(bo.design.size / 5) : Math.trunc(strategicValue(bo.parentHabitat) / 200);
                    break;
                default:
                    num = Math.trunc(bo.design.size / 5);
                    break;
            }
            break;
        default:
            num = Math.trunc(bo.design.size / 20);
            break;
    }
    if (bo.unbuiltComponentCount > 0) {
        const num2 = bo.unbuiltComponentCount / bo.components.count;
        num = Math.max(1, Math.trunc(num / 2.0 - num * num2));
    }
    return num;
}

/** Galaxy.3.cs 507 CalculateWarValue(Habitat). */
function calculateWarValueHabitat(galaxy: Galaxy, habitat: Habitat): number {
    if (habitat.empire !== null && habitat.empire !== galaxy.independentEmpire) return Math.trunc(strategicValue(habitat) / 50);
    return 0;
}

/** Galaxy.3.cs 447 CalculateEmpireWarValue(empire, out builtObjectWarValue, out colonyWarValue). */
function calculateEmpireWarValue(galaxy: Galaxy, empire: Empire): { builtObject: number; colony: number } {
    let builtObjectWarValue = 0;
    let colonyWarValue = 0;
    for (let i = 0; i < empire.builtObjects.length; i++) builtObjectWarValue = (builtObjectWarValue + calculateWarValueBuiltObject(empire.builtObjects[i])) | 0;
    for (let j = 0; j < empire.privateBuiltObjects.length; j++) builtObjectWarValue = (builtObjectWarValue + calculateWarValueBuiltObject(empire.privateBuiltObjects[j])) | 0;
    for (let k = 0; k < empire.colonies.length; k++) colonyWarValue = (colonyWarValue + calculateWarValueHabitat(galaxy, empire.colonies[k])) | 0;
    return { builtObject: builtObjectWarValue, colony: colonyWarValue };
}

/** Empire.8.cs 2873 CheckWhetherWarDamageExceedsLimit(empire, damageBuiltObject, damageColony). */
function checkWhetherWarDamageExceedsLimit(galaxy: Galaxy, empire: Empire, damageBuiltObject: number, damageColony: number): boolean {
    let result = false;
    const wv = calculateEmpireWarValue(galaxy, empire);
    const num = Math.pow(1.0 + (aggressionLevel(empire) - cautionLevel(empire)) / 100.0, 2.0);
    const num2 = Math.trunc((wv.builtObject + damageBuiltObject) * ACCEPTABLE_WAR_VALUE_LOSSES_BUILT_OBJECT * num);
    const num3 = Math.trunc((wv.colony + damageColony) * ACCEPTABLE_WAR_VALUE_LOSSES_COLONY * num);
    if (damageBuiltObject > num2 || damageColony > num3) result = true;
    return result;
}

/** Empire.8.cs 2824 DetermineVictorInWar(relation, out winningRatio, out loser, ...): the damage ratio is C# integer division. */
export function determineVictorInWar(diplomaticRelation: DiplomaticRelation): { victor: Empire; loser: Empire; winningRatio: number } {
    const diplomaticRelation2 = diplomaticRelation.otherEmpire!.diplomaticRelations.byEmpire(diplomaticRelation.thisEmpire)!;
    if (diplomaticRelation.warDamageTotal > diplomaticRelation2.warDamageTotal) {
        return { victor: diplomaticRelation.otherEmpire!, loser: diplomaticRelation.thisEmpire!, winningRatio: Math.trunc((diplomaticRelation.warDamageTotal + 1) / (diplomaticRelation2.warDamageTotal + 1)) };
    }
    return { victor: diplomaticRelation.thisEmpire!, loser: diplomaticRelation.otherEmpire!, winningRatio: Math.trunc((diplomaticRelation2.warDamageTotal + 1) / (diplomaticRelation.warDamageTotal + 1)) };
}

/** Empire.8.cs 2857 DetermineSubjugationOfLoserInWar. */
export function determineSubjugationOfLoserInWar(winnerEmpire: Empire, loserEmpire: Empire, winningRatio: number, winnerStrength: number, loserStrength: number): boolean {
    if (winningRatio > 3.0) {
        const num = Math.pow(aggressionLevel(winnerEmpire) / 100.0, 2.0);
        const num2 = Math.pow(aggressionLevel(loserEmpire) / 100.0, 2.0);
        const num3 = winnerStrength * num;
        const num4 = loserStrength * num2 * 3.0;
        if (num3 > num4) return true;
    }
    return false;
}

/** Empire.8.cs 3255 DetermineWhetherWantToOfferSubjugation(empire): 2 NextDouble draws. */
export function determineWhetherWantToOfferSubjugation(galaxy: Galaxy, self: Empire, empire: Empire): boolean {
    let result = false;
    const num = Math.sqrt(self.policy!.subjugationPriority);
    const num2 = Math.trunc(115.0 * num + 15.0 * galaxy.rnd.nextDouble());
    const num3 = Math.trunc(100.0 / num + 15.0 * galaxy.rnd.nextDouble());
    if (aggressionLevel(empire) < num2 && intelligenceLevel(empire) > num3) result = true;
    return result;
}

const T_checkReadyForWarFleets = registerTodo('M4r', 'checkReadyForWar CaptureObjectives fleet readiness (M4l/M4m)');

/** Empire.8.cs 1428 CheckReadyForWar(otherEmpire). */
function checkReadyForWar(galaxy: Galaxy, self: Empire, otherEmpire: Empire): boolean {
    void galaxy;
    let result = true;
    if (!checkEmpireHasHyperDriveTech(self)) return false;
    const diplomaticRelation = obtainDiplomaticRelation(self, otherEmpire);
    let num = 0;
    const shipGroups = empireShipGroups(self);
    for (let i = 0; i < shipGroups.length; i++) {
        const shipGroup = shipGroups[i];
        if (shipGroup != null && fleetPosture(shipGroup) === FleetPosture.Attack && shipGroup.ships.length > 0) num++;
    }
    if (num <= 0) return false;
    switch (diplomaticRelation.warObjective) {
        case WarObjective.CaptureObjectives:
            // TODO(port) M4l/M4m: the per-fleet readiness walk (Empire.8.cs 1452-1506: AttackPoint / GatherPoint / Mission,
            // DetermineFuelRequiredForFleet, AssignMission(Refuel)). Fleets exist only once M4l ports ShipGroup (num <= 0
            // returns above until then); a fleet present counts as not ready, as C# does for a fleet still gathering.
            todo(T_checkReadyForWarFleets);
            result = false;
            break;
        case WarObjective.TotalConquest:
            break;
        default:
            result = false;
            break;
    }
    return result;
}

/** Empire.8.cs 1515 StartWar(otherEmpire). */
function startWar(galaxy: Galaxy, self: Empire, otherEmpire: Empire): void {
    if (self.controlDiplomacyOffense !== MANUAL) {
        if (checkTaskAuthorized(galaxy, self, self.controlDiplomacyOffense, { value: 0 }, generateAutomationMessageWarTradeSanctions(otherEmpire, DiplomaticRelationType.War), otherEmpire, AdvisorMessageType.WarTradeSanctions, null, DiplomaticRelationType.War, null)) {
            declareWar(galaxy, self, otherEmpire, null, false, false);
        }
    }
}

/** Empire.8.cs 1527 SubjugateRequest(otherEmpire). */
function subjugateRequest(galaxy: Galaxy, self: Empire, otherEmpire: Empire): void {
    const diplomaticRelation = obtainDiplomaticRelation(self, otherEmpire);
    if (diplomaticRelation == null || diplomaticRelation.type !== DiplomaticRelationType.War) return;
    const num = calculateNextAllowableProposalDate(galaxy, diplomaticRelation);
    if (galaxyStarDate(galaxy) >= num) {
        const diplomaticRelation2 = new DiplomaticRelation(DiplomaticRelationType.SubjugatedDominion, self, self, otherEmpire, galaxyStarDate(galaxy), diplomaticRelation.supplyRestrictedResources);
        if (checkTaskAuthorized(galaxy, self, self.controlDiplomacyOffense, { value: 0 }, generateAutomationMessageWarTradeSanctions(otherEmpire, DiplomaticRelationType.SubjugatedDominion), otherEmpire, AdvisorMessageType.WarTradeSanctions, null, DiplomaticRelationType.SubjugatedDominion, null)) {
            otherEmpire.proposedDiplomaticRelations.add(diplomaticRelation2);
            const ourPotencyVersusThem = determineRelativeStrength(galaxy, militaryPotency(self), otherEmpire);
            const description = generateMessageDescriptionRelation(diplomaticRelation, DiplomaticRelationType.SubjugatedDominion, ourPotencyVersusThem);
            diplomaticRelation.lastDiplomacyTradeOfferDate = galaxyStarDate(galaxy);
            sendMessageToEmpire(self, otherEmpire, EmpireMessageType.ProposeDiplomaticRelation, DiplomaticRelationType.None, description, NO_POINT, '');
        }
    }
}

/** Empire.8.cs 1550 EndWarRequest(otherEmpire). */
function endWarRequest(galaxy: Galaxy, self: Empire, otherEmpire: Empire): void {
    const diplomaticRelation = obtainDiplomaticRelation(self, otherEmpire);
    if (diplomaticRelation == null || diplomaticRelation.type !== DiplomaticRelationType.War) return;
    const num = calculateNextAllowableProposalDate(galaxy, diplomaticRelation);
    if (galaxyStarDate(galaxy) >= num) {
        const diplomaticRelation2 = new DiplomaticRelation(DiplomaticRelationType.None, self, self, otherEmpire, galaxyStarDate(galaxy), diplomaticRelation.supplyRestrictedResources);
        if (checkTaskAuthorized(galaxy, self, self.controlDiplomacyOffense, { value: 0 }, generateAutomationMessageWarTradeSanctions(otherEmpire, DiplomaticRelationType.None), otherEmpire, AdvisorMessageType.WarTradeSanctions, null, DiplomaticRelationType.None, null)) {
            otherEmpire.proposedDiplomaticRelations.add(diplomaticRelation2);
            const description = getText('We urge you to consider our proposal for an end to this pointless war'); // Empire.7.cs 3844 GenerateMessageDescriptionEndWarRequest
            diplomaticRelation.lastDiplomacyTradeOfferDate = galaxyStarDate(galaxy);
            sendMessageToEmpire(self, otherEmpire, EmpireMessageType.ProposeDiplomaticRelation, DiplomaticRelationType.None, description, NO_POINT, '');
        }
    }
}

/** Point.Empty (the TS sendMessageToEmpire takes (…, location, hint); the C# 5-arg overload passes only the hint). */
const NO_POINT = { x: 0, y: 0 };

/** Empire.8.cs 1572 StartTradeSanctionsIfTimePassed. */
function startTradeSanctionsIfTimePassed(galaxy: Galaxy, self: Empire, otherEmpire: Empire): void {
    if (self.controlDiplomacyOffense !== MANUAL) {
        const currentStarDate = galaxyStarDate(galaxy);
        const relation = obtainDiplomaticRelation(self, otherEmpire);
        const num = calculateNextAllowableProposalDate(galaxy, relation);
        if (currentStarDate >= num) startTradeSanctions(galaxy, self, otherEmpire);
    }
}

/** Empire.8.cs 1586 StartTradeSanctions. */
export function startTradeSanctions(galaxy: Galaxy, self: Empire, otherEmpire: Empire): void {
    if (self.controlDiplomacyOffense === MANUAL) return;
    const ev = obtainEmpireEvaluation(galaxy, otherEmpire, self);
    const diplomaticRelation = obtainDiplomaticRelation(self, otherEmpire);
    if (diplomaticRelation.type !== DiplomaticRelationType.War && diplomaticRelation.type !== DiplomaticRelationType.SubjugatedDominion) {
        if (checkTaskAuthorized(galaxy, self, self.controlDiplomacyOffense, { value: 0 }, generateAutomationMessageWarTradeSanctions(otherEmpire, DiplomaticRelationType.TradeSanctions), otherEmpire, AdvisorMessageType.WarTradeSanctions, null, DiplomaticRelationType.TradeSanctions, null)) {
            changeDiplomaticRelation(galaxy, self, diplomaticRelation, DiplomaticRelationType.TradeSanctions);
            ev.incidentEvaluation = ev.incidentEvaluationRaw - 20.0;
            diplomaticRelation.lastDiplomacyTradeOfferDate = galaxyStarDate(galaxy);
            const ourPotencyVersusThem = determineRelativeStrength(galaxy, militaryPotency(self), otherEmpire);
            const description = generateMessageDescriptionRelation(diplomaticRelation, DiplomaticRelationType.TradeSanctions, ourPotencyVersusThem);
            sendMessageToEmpire(self, otherEmpire, EmpireMessageType.DiplomaticRelationChange, DiplomaticRelationType.TradeSanctions, description);
        }
    }
}

/** Empire.8.cs 1609 EndTradeSanctionsIfTimePassed. */
function endTradeSanctionsIfTimePassed(galaxy: Galaxy, self: Empire, otherEmpire: Empire): void {
    if (self.controlDiplomacyOffense !== MANUAL) {
        const currentStarDate = galaxyStarDate(galaxy);
        const relation = obtainDiplomaticRelation(self, otherEmpire);
        const num = calculateNextAllowableProposalDate(galaxy, relation);
        if (currentStarDate >= num) endTradeSanctions(galaxy, self, otherEmpire);
    }
}

/** Empire.8.cs 1623 EndTradeSanctions. */
export function endTradeSanctions(galaxy: Galaxy, self: Empire, otherEmpire: Empire): void {
    const diplomaticRelation = obtainDiplomaticRelation(self, otherEmpire);
    if (diplomaticRelation != null && diplomaticRelation.type === DiplomaticRelationType.TradeSanctions && diplomaticRelation.initiator === self) {
        if (checkTaskAuthorized(galaxy, self, self.controlDiplomacyOffense, { value: 0 }, generateAutomationMessageWarTradeSanctions(otherEmpire, DiplomaticRelationType.None), otherEmpire, AdvisorMessageType.WarTradeSanctions, null, DiplomaticRelationType.None, null)) {
            changeDiplomaticRelation(galaxy, self, diplomaticRelation, DiplomaticRelationType.None);
            cancelBlockades(galaxy, self, otherEmpire);
            cancelBlockades(galaxy, otherEmpire, self);
            diplomaticRelation.lastDiplomacyTradeOfferDate = galaxyStarDate(galaxy);
            const description = getText('Our trade sanctions against you have been lifted - we will now resume trade.'); // Empire.7.cs 3854
            sendMessageToEmpire(self, otherEmpire, EmpireMessageType.DiplomaticRelationChange, DiplomaticRelationType.None, description, NO_POINT, resolveDescription(DiplomaticRelationType, DiplomaticRelationType.TradeSanctions));
        }
    }
}

/** Empire.8.cs 1641 EndSubjugation. */
function endSubjugation(galaxy: Galaxy, self: Empire, otherEmpire: Empire): void {
    const diplomaticRelation = obtainDiplomaticRelation(self, otherEmpire);
    if (diplomaticRelation != null && diplomaticRelation.type === DiplomaticRelationType.SubjugatedDominion && diplomaticRelation.initiator === self) {
        if (checkTaskAuthorized(galaxy, self, self.controlDiplomacyTreaties, { value: 0 }, generateAutomationMessageTreaty(otherEmpire, DiplomaticRelationType.None), otherEmpire, AdvisorMessageType.TreatyOffer, null, DiplomaticRelationType.None, null)) {
            changeDiplomaticRelation(galaxy, self, diplomaticRelation, DiplomaticRelationType.None);
            diplomaticRelation.lastDiplomacyTradeOfferDate = galaxyStarDate(galaxy);
            const description = getText('We are releasing you from subjugation to us. We no longer consider you to be our conquered dominion.'); // Empire.7.cs 3849
            sendMessageToEmpire(self, otherEmpire, EmpireMessageType.DiplomaticRelationChange, DiplomaticRelationType.None, description, NO_POINT, resolveDescription(DiplomaticRelationType, DiplomaticRelationType.SubjugatedDominion));
        }
    }
}

/** Empire.8.cs 1657 CancelTreatiesIfTimePassed. */
function cancelTreatiesIfTimePassed(galaxy: Galaxy, self: Empire, otherEmpire: Empire): void {
    if (self.controlDiplomacyOffense !== MANUAL) {
        const currentStarDate = galaxyStarDate(galaxy);
        const relation = obtainDiplomaticRelation(self, otherEmpire);
        const num = calculateNextAllowableProposalDate(galaxy, relation);
        if (currentStarDate >= num) cancelTreaties(galaxy, self, otherEmpire);
    }
}

/** Empire.8.cs 1671 CancelTreaties. */
export function cancelTreaties(galaxy: Galaxy, self: Empire, otherEmpire: Empire): void {
    const diplomaticRelation = obtainDiplomaticRelation(self, otherEmpire);
    if (diplomaticRelation.type !== DiplomaticRelationType.FreeTradeAgreement && diplomaticRelation.type !== DiplomaticRelationType.MutualDefensePact && diplomaticRelation.type !== DiplomaticRelationType.Protectorate) return;
    if (checkTaskAuthorized(galaxy, self, self.controlDiplomacyTreaties, { value: 0 }, generateAutomationMessageTreaty(otherEmpire, DiplomaticRelationType.None), otherEmpire, AdvisorMessageType.TreatyOffer, null, DiplomaticRelationType.None, null)) {
        if ((diplomaticRelation.type as DiplomaticRelationType) !== DiplomaticRelationType.NotMet) {
            sendMessageToEmpire(self, otherEmpire, EmpireMessageType.DiplomaticRelationChange, DiplomaticRelationType.None, getText('We cancel our treaty with you.'), NO_POINT, resolveDescription(DiplomaticRelationType, diplomaticRelation.type));
        }
        diplomaticRelation.lastDiplomacyTradeOfferDate = galaxyStarDate(galaxy);
        changeDiplomaticRelation(galaxy, self, diplomaticRelation, DiplomaticRelationType.None);
    }
}

/** Empire.8.cs 1690 CheckCancelMilitaryRefueling. */
function checkCancelMilitaryRefueling(galaxy: Galaxy, self: Empire, otherEmpire: Empire): void {
    const diplomaticRelation = obtainDiplomaticRelation(self, otherEmpire);
    if (
        diplomaticRelation.militaryRefuelingToOther &&
        diplomaticRelation.type !== DiplomaticRelationType.MutualDefensePact &&
        diplomaticRelation.type !== DiplomaticRelationType.Protectorate &&
        checkTaskAuthorizedSimple(galaxy, self, self.controlDiplomacyTreaties, generateAutomationMessageMilitaryRefueling(diplomaticRelation.otherEmpire!, false), diplomaticRelation.otherEmpire, AdvisorMessageType.CancelMilitaryRefueling)
    ) {
        diplomaticRelation.militaryRefuelingToOther = false;
        sendMessageToEmpire(self, otherEmpire, EmpireMessageType.MilitaryRefuelingBlocked, self, getText('Military Refueling Blocked'));
    }
}

/** Empire.8.cs 1701 CheckCancelMiningRights. */
function checkCancelMiningRights(galaxy: Galaxy, self: Empire, otherEmpire: Empire): void {
    const diplomaticRelation = obtainDiplomaticRelation(self, otherEmpire);
    if (diplomaticRelation.miningRightsToOther && checkTaskAuthorizedSimple(galaxy, self, self.controlDiplomacyTreaties, generateAutomationMessageMiningRights(diplomaticRelation.otherEmpire!, false), diplomaticRelation.otherEmpire, AdvisorMessageType.CancelMiningRights)) {
        diplomaticRelation.miningRightsToOther = false;
        sendMessageToEmpire(self, otherEmpire, EmpireMessageType.MiningRightsBlocked, self, getText('Mining Rights Blocked'));
    }
}

/** Empire.8.cs 1712 CheckCancelRestrictedResourceTrading. */
function checkCancelRestrictedResourceTrading(galaxy: Galaxy, self: Empire, otherEmpire: Empire): void {
    const diplomaticRelation = obtainDiplomaticRelation(self, otherEmpire);
    if (diplomaticRelation.supplyRestrictedResources && checkTaskAuthorizedSimple(galaxy, self, self.controlDiplomacyTreaties, generateAutomationMessageTradeRestrictedResources(diplomaticRelation.otherEmpire!, false), diplomaticRelation.otherEmpire, AdvisorMessageType.DisallowTradeRestrictedResources)) {
        diplomaticRelation.supplyRestrictedResources = false;
        const description = formatText(getText('Trade Restricted Resource Refuse EMPIRE'), self.name);
        sendMessageToEmpire(self, otherEmpire, EmpireMessageType.RestrictedResourceTradingBlocked, self, description);
    }
}

const T_pirateEconomyExpense = registerTodo('M4r', 'PirateEconomy.PerformExpense (gift bookkeeping; PirateEconomy not ported)');

/**
 * Empire.8.cs 1723 GiveGiftSmallWhenSufficientTimePassed (small: StateMoney / 40, PirateExpenseType.Undefined) and 1762
 * GiveGiftWhenSufficientTimePassed (StateMoney / 10, PirateExpenseType.Construction). Rnd.Next(100, num3) once the gift
 * interval has passed and StateMoney > 8400. (Neither sets LastGiftDate — the recipient's ProcessMessages does.)
 */
function giveGiftWhenSufficientTimePassed(galaxy: Galaxy, self: Empire, otherEmpire: Empire, small: boolean): void {
    const diplomaticRelation = obtainDiplomaticRelation(self, otherEmpire);
    const num = diplomaticRelation.lastGiftDate + IDEAL_TIME_BETWEEN_GIFTS;
    if (galaxyStarDate(galaxy) < num) return;
    const empireMessage = new EmpireMessage(self, EmpireMessageType.GiveGift, null);
    let num2 = self.stateMoney;
    if (!Number.isFinite(num2)) num2 = 0.0;
    if (!(num2 > 8400.0)) return;
    const num3 = Math.max(105, Math.trunc(num2 / (small ? 40.0 : 10.0)));
    if (num3 <= 100) return;
    let val = galaxy.rnd.next(100, num3);
    val = Math.min(val, self.policy!.diplomacySendGiftsUpToAmount);
    if (val > 0.0) {
        if (checkTaskAuthorized(galaxy, self, self.controlDiplomacyGifts, { value: 0 }, generateAutomationMessageDiplomaticGift(otherEmpire, val), otherEmpire, AdvisorMessageType.DiplomaticGift, null, val, null)) {
            empireMessage.money = Math.trunc(val);
            self.stateMoney -= val;
            // TODO(port): PirateEconomy.PerformExpense(val, Undefined/Construction, date) — the PirateEconomy ledger (empire.ts
            // placeholder class) is statistics only.
            todo(T_pirateEconomyExpense);
            empireMessage.description = formatText(getText('Please accept our gift of X credits'), formatThousands(val));
            sendEmpireMessage(empireMessage, otherEmpire);
        }
    }
}

/** double.ToString("###,###,###,##0"). */
export function formatThousands(v: number): string {
    return Math.round(v).toLocaleString('en-US');
}

/** Empire.8.cs 1801 OfferFreeTrade. */
function offerFreeTrade(galaxy: Galaxy, self: Empire, otherEmpire: Empire): void {
    if (otherEmpire.reclusive || (!checkEmpireHasHyperDriveTech(self) && !checkEmpireHasHyperDriveTech(otherEmpire))) return;
    const diplomaticRelation = obtainDiplomaticRelation(self, otherEmpire);
    const num = calculateNextAllowableProposalDate(galaxy, diplomaticRelation);
    if (galaxyStarDate(galaxy) >= num) {
        const diplomaticRelation2 = new DiplomaticRelation(DiplomaticRelationType.FreeTradeAgreement, self, self, otherEmpire, galaxyStarDate(galaxy), diplomaticRelation.supplyRestrictedResources);
        if (checkTaskAuthorized(galaxy, self, self.controlDiplomacyTreaties, { value: 0 }, generateAutomationMessageTreaty(otherEmpire, DiplomaticRelationType.FreeTradeAgreement), otherEmpire, AdvisorMessageType.TreatyOffer, null, DiplomaticRelationType.FreeTradeAgreement, null)) {
            otherEmpire.proposedDiplomaticRelations.add(diplomaticRelation2);
            const ourPotencyVersusThem = determineRelativeStrength(galaxy, militaryPotency(self), otherEmpire);
            const description = generateMessageDescriptionRelation(diplomaticRelation, DiplomaticRelationType.FreeTradeAgreement, ourPotencyVersusThem);
            diplomaticRelation.lastDiplomacyTradeOfferDate = galaxyStarDate(galaxy);
            sendMessageToEmpire(self, otherEmpire, EmpireMessageType.ProposeDiplomaticRelation, DiplomaticRelationType.FreeTradeAgreement, description);
        }
    }
}

/** Empire.8.cs 1824 OfferMutualDefense. */
function offerMutualDefense(galaxy: Galaxy, self: Empire, otherEmpire: Empire): void {
    if (otherEmpire.reclusive || (!checkEmpireHasHyperDriveTech(self) && !checkEmpireHasHyperDriveTech(otherEmpire))) return;
    const diplomaticRelation = obtainDiplomaticRelation(self, otherEmpire);
    const num = calculateNextAllowableProposalDate(galaxy, diplomaticRelation);
    if (galaxyStarDate(galaxy) >= num) {
        let diplomaticRelationType = DiplomaticRelationType.MutualDefensePact;
        const num2 = totalColonyStrategicValue(self) / totalColonyStrategicValue(otherEmpire);
        if (num2 > 4.0) diplomaticRelationType = DiplomaticRelationType.Protectorate;
        const diplomaticRelation2 = new DiplomaticRelation(diplomaticRelationType, self, self, otherEmpire, galaxyStarDate(galaxy), diplomaticRelation.supplyRestrictedResources);
        if (checkTaskAuthorized(galaxy, self, self.controlDiplomacyTreaties, { value: 0 }, generateAutomationMessageTreaty(otherEmpire, diplomaticRelationType), otherEmpire, AdvisorMessageType.TreatyOffer, null, diplomaticRelationType, null)) {
            otherEmpire.proposedDiplomaticRelations.add(diplomaticRelation2);
            const ourPotencyVersusThem = determineRelativeStrength(galaxy, militaryPotency(self), otherEmpire);
            const description = generateMessageDescriptionRelation(diplomaticRelation, diplomaticRelationType, ourPotencyVersusThem);
            diplomaticRelation.lastDiplomacyTradeOfferDate = galaxyStarDate(galaxy);
            sendMessageToEmpire(self, otherEmpire, EmpireMessageType.ProposeDiplomaticRelation, diplomaticRelationType, description);
        }
    }
}

/** Empire.8.cs 1853 OfferMilitaryRefueling. */
export function offerMilitaryRefueling(self: Empire, otherEmpire: Empire): void {
    const diplomaticRelation = obtainDiplomaticRelation(self, otherEmpire);
    if (!diplomaticRelation.militaryRefuelingToOther) {
        diplomaticRelation.militaryRefuelingToOther = true;
        sendMessageToEmpire(self, otherEmpire, EmpireMessageType.MilitaryRefuelingAllowed, self, getText('Military Refueling Allowed'));
    }
}

/** Empire.8.cs 1864 OfferMiningRights. */
export function offerMiningRights(self: Empire, otherEmpire: Empire): void {
    const diplomaticRelation = obtainDiplomaticRelation(self, otherEmpire);
    if (!diplomaticRelation.miningRightsToOther) {
        diplomaticRelation.miningRightsToOther = true;
        sendMessageToEmpire(self, otherEmpire, EmpireMessageType.MiningRightsAllowed, self, getText('Mining Rights Allowed'));
    }
}

const T_cancelBlockades = registerTodo('M4r', 'cancelBlockades (Galaxy.Blockades not ported — M4m)');

/**
 * Empire.8.cs 3855 CancelBlockades(targetEmpire). TODO(port) M4m: Galaxy.Blockades / BlockadeList.GetBlockadesForEmpire,
 * ShipGroup/BuiltObject ClearAllMissionsForTarget(Blockade), colony/port IsBlockaded, BlockadeCancelled messages — no
 * blockades exist until blockade missions are ported, so the C# loop body never runs.
 */
export function cancelBlockades(galaxy: Galaxy, self: Empire, targetEmpire: Empire): void {
    void galaxy;
    void self;
    void targetEmpire;
    todo(T_cancelBlockades);
}

// ---------------------------------------------------------------------------------------------------------------
// ChangeDiplomaticRelation (Empire.8.cs 2568) and DeclareWar (Empire.7.cs 4883).
// ---------------------------------------------------------------------------------------------------------------

/** Galaxy.4.cs 3700 MergeGalaxyMap contact block (3724-3775): the hook Set/ClearEmpireSharedVisibility pass to visibility.ts. */
export function contactFromGalaxyMapHook(galaxy: Galaxy, receiver: Empire): ContactFromGalaxyMapHook {
    return (_rv: EmpireVisibility, systemInfo: SystemInfo): void => {
        const dominant = systemInfo.dominantEmpire;
        if (dominant != null && dominant.empire != null) {
            if (receiver.pirateEmpireBaseHabitat !== null) {
                const pirateRelation = obtainPirateRelation(receiver, dominant.empire);
                if (pirateRelation.type === PirateRelationType.NotMet) {
                    changePirateRelation(receiver, dominant.empire, PirateRelationType.None, galaxyStarDate(galaxy));
                    sendContactMessage(receiver, dominant.empire);
                }
            } else {
                const diplomaticRelation = obtainDiplomaticRelation(receiver, dominant.empire);
                if (diplomaticRelation.type === DiplomaticRelationType.NotMet) {
                    changeDiplomaticRelation(galaxy, receiver, diplomaticRelation, DiplomaticRelationType.None);
                    sendContactMessage(receiver, dominant.empire);
                }
            }
        }
        if (systemInfo.otherEmpires != null && systemInfo.otherEmpires.length > 0) {
            for (let j = 0; j < systemInfo.otherEmpires.length; j++) {
                const empireSystemSummary = systemInfo.otherEmpires[j];
                if (empireSystemSummary == null || empireSystemSummary.empire == null) continue;
                // Galaxy.4.cs 3753-3772: the pirate branch changes the relation with DominantEmpire.Empire (C# quirk kept);
                // both branches send the message from DominantEmpire.Empire.
                if (receiver.pirateEmpireBaseHabitat !== null) {
                    const pirateRelation2 = obtainPirateRelation(receiver, empireSystemSummary.empire);
                    if (pirateRelation2.type === PirateRelationType.NotMet) {
                        changePirateRelation(receiver, systemInfo.dominantEmpire!.empire, PirateRelationType.None, galaxyStarDate(galaxy));
                        sendContactMessage(receiver, systemInfo.dominantEmpire!.empire);
                    }
                } else {
                    const diplomaticRelation2 = obtainDiplomaticRelation(receiver, empireSystemSummary.empire);
                    if (diplomaticRelation2.type === DiplomaticRelationType.NotMet) {
                        changeDiplomaticRelation(galaxy, receiver, diplomaticRelation2, DiplomaticRelationType.None);
                        sendContactMessage(receiver, systemInfo.dominantEmpire!.empire);
                    }
                }
            }
        }
    };
}
function sendContactMessage(receiver: Empire, dominant: Empire): void {
    const description = formatText(getText('Empire Contact From Galaxy Map'), receiver.name);
    sendMessageToEmpire(dominant, dominant, EmpireMessageType.EmpireDiscovered, receiver, description);
}

/** Empire.9.cs 2975 SetEmpireSharedVisibility(otherEmpire) → Galaxy.MergeGalaxyMap(otherEmpire, this). */
export function setEmpireSharedVisibility(galaxy: Galaxy, self: Empire, otherEmpire: Empire): void {
    self.visibility.setEmpireSharedVisibility(otherEmpire.visibility, contactFromGalaxyMapHook(galaxy, self));
}
/** Empire.9.cs 2984 ClearEmpireSharedVisibility(otherEmpire). */
export function clearEmpireSharedVisibility(galaxy: Galaxy, self: Empire, otherEmpire: Empire): void {
    self.visibility.clearEmpireSharedVisibility(otherEmpire.visibility, contactFromGalaxyMapHook(galaxy, self));
}

/** Empire.8.cs 2336 CheckWhetherKnowAnySystemsOfOtherEmpire(empire). */
function checkWhetherKnowAnySystemsOfOtherEmpire(galaxy: Galaxy, self: Empire, empire: Empire): boolean {
    for (let i = 0; i < empire.colonies.length; i++) {
        const habitat2 = galaxy.determineHabitatSystemStar(empire.colonies[i]);
        const status = self.systemVisibility[habitat2.systemIndex].status;
        if (status === SystemVisibilityStatus.Explored || status === SystemVisibilityStatus.Visible) return true;
    }
    return false;
}

const T_gameEvents = registerTodo('M4r', 'GetMatchingGameEventIdDiplomaticRelationChange/CheckTriggerEvent (scenario game events)');

/**
 * Empire.8.cs 2553-2568 ChangeDiplomaticRelation(currentDiplomaticRelation, newType[, blockFlowonEffects[, locked[, allianceName]]]).
 * Rnd: DoCharacterEvent (TreatySigned/TreatyBroken/WarStarted) and ChanceNewAmbassador draw inside M4u callees (not drawn
 * yet); the war flow-on to the victim's mutual-defense allies draws one NextDouble per ally considered.
 */
export function changeDiplomaticRelation(
    galaxy: Galaxy,
    self: Empire,
    currentDiplomaticRelation: DiplomaticRelation,
    newDiplomaticRelationType: DiplomaticRelationType,
    blockFlowonEffects = false,
    locked = false,
    allianceName = '',
): boolean {
    const selfCharacters = getEmpireCharacters(self);
    const isTreaty = (t: DiplomaticRelationType): boolean => t === DiplomaticRelationType.FreeTradeAgreement || t === DiplomaticRelationType.MutualDefensePact || t === DiplomaticRelationType.Protectorate;
    switch (newDiplomaticRelationType) {
        case DiplomaticRelationType.War: {
            const ambassadorsForEmpire5 = getAmbassadorsForEmpire(selfCharacters, currentDiplomaticRelation.otherEmpire);
            if (isTreaty(currentDiplomaticRelation.type)) doCharacterEventRuntime(galaxy, CharacterEventType.TreatyBroken, currentDiplomaticRelation.otherEmpire, ambassadorsForEmpire5, true, self);
            doCharacterEventRuntime(galaxy, CharacterEventType.WarStarted, currentDiplomaticRelation.otherEmpire, ambassadorsForEmpire5, true, self);
            if (currentDiplomaticRelation != null && currentDiplomaticRelation.otherEmpire !== null) {
                const ambassadorsForEmpire6 = getAmbassadorsForEmpire(getEmpireCharacters(currentDiplomaticRelation.otherEmpire), self);
                if (isTreaty(currentDiplomaticRelation.type)) doCharacterEventRuntime(galaxy, CharacterEventType.TreatyBroken, self, ambassadorsForEmpire6, true, currentDiplomaticRelation.otherEmpire);
                doCharacterEventRuntime(galaxy, CharacterEventType.WarStarted, self, ambassadorsForEmpire6, true, currentDiplomaticRelation.otherEmpire);
            }
            break;
        }
        case DiplomaticRelationType.FreeTradeAgreement:
        case DiplomaticRelationType.MutualDefensePact:
        case DiplomaticRelationType.Protectorate: {
            const ambassadorsForEmpire3 = getAmbassadorsForEmpire(selfCharacters, currentDiplomaticRelation.otherEmpire);
            doCharacterEventRuntime(galaxy, CharacterEventType.TreatySigned, currentDiplomaticRelation.cloneLightWeight(newDiplomaticRelationType), ambassadorsForEmpire3, true, self);
            if (currentDiplomaticRelation != null && currentDiplomaticRelation.otherEmpire !== null) {
                chanceNewAmbassador(galaxy, self, newDiplomaticRelationType, currentDiplomaticRelation.otherEmpire);
                const ambassadorsForEmpire4 = getAmbassadorsForEmpire(getEmpireCharacters(currentDiplomaticRelation.otherEmpire), self);
                const diplomaticRelation = obtainDiplomaticRelation(currentDiplomaticRelation.otherEmpire, self);
                doCharacterEventRuntime(galaxy, CharacterEventType.TreatySigned, diplomaticRelation.cloneLightWeight(newDiplomaticRelationType), ambassadorsForEmpire4, true, currentDiplomaticRelation.otherEmpire);
            }
            break;
        }
        case DiplomaticRelationType.None:
        case DiplomaticRelationType.TradeSanctions:
            if (currentDiplomaticRelation != null && currentDiplomaticRelation.otherEmpire !== null && isTreaty(currentDiplomaticRelation.type)) {
                const ambassadorsForEmpire = getAmbassadorsForEmpire(selfCharacters, currentDiplomaticRelation.otherEmpire);
                doCharacterEventRuntime(galaxy, CharacterEventType.TreatyBroken, currentDiplomaticRelation.otherEmpire, ambassadorsForEmpire, true, self);
                const ambassadorsForEmpire2 = getAmbassadorsForEmpire(getEmpireCharacters(currentDiplomaticRelation.otherEmpire), self);
                doCharacterEventRuntime(galaxy, CharacterEventType.TreatyBroken, self, ambassadorsForEmpire2, true, currentDiplomaticRelation.otherEmpire);
            }
            break;
    }
    let diplomaticRelation2 = self.diplomaticRelations.byEmpire(currentDiplomaticRelation.otherEmpire);
    if (diplomaticRelation2 === null) {
        self.diplomaticRelations.add(currentDiplomaticRelation);
        diplomaticRelation2 = currentDiplomaticRelation;
    }
    const other2 = diplomaticRelation2.otherEmpire!;
    let diplomaticRelation3 = other2.diplomaticRelations.byEmpire(diplomaticRelation2.thisEmpire);
    if (diplomaticRelation3 === null) {
        const diplomaticRelation4 = new DiplomaticRelation(DiplomaticRelationType.NotMet, self, other2, self, false);
        other2.diplomaticRelations.add(diplomaticRelation4);
        diplomaticRelation3 = diplomaticRelation4;
    }
    const currentStarDate = galaxyStarDate(galaxy);
    processRelationChange(self.diplomacyCounters, self, currentDiplomaticRelation, self, newDiplomaticRelationType, currentStarDate);
    processRelationChange(other2.diplomacyCounters, other2, diplomaticRelation3, self, newDiplomaticRelationType, currentStarDate);
    const cOther = currentDiplomaticRelation.otherEmpire!;
    if (newDiplomaticRelationType === DiplomaticRelationType.MutualDefensePact || newDiplomaticRelationType === DiplomaticRelationType.Protectorate) {
        setEmpireSharedVisibility(galaxy, cOther, self);
        setEmpireSharedVisibility(galaxy, self, cOther);
        currentDiplomaticRelation.militaryRefuelingToOther = true;
        diplomaticRelation3.militaryRefuelingToOther = true;
    } else if (
        (diplomaticRelation2.type === DiplomaticRelationType.MutualDefensePact || diplomaticRelation2.type === DiplomaticRelationType.Protectorate) &&
        (newDiplomaticRelationType as DiplomaticRelationType) !== DiplomaticRelationType.Protectorate &&
        (newDiplomaticRelationType as DiplomaticRelationType) !== DiplomaticRelationType.MutualDefensePact
    ) {
        clearEmpireSharedVisibility(galaxy, cOther, self);
        clearEmpireSharedVisibility(galaxy, self, cOther);
        currentDiplomaticRelation.militaryRefuelingToOther = false;
        diplomaticRelation3.militaryRefuelingToOther = false;
    }
    if (newDiplomaticRelationType === DiplomaticRelationType.FreeTradeAgreement) {
        if (!checkWhetherKnowAnySystemsOfOtherEmpire(galaxy, cOther, self)) {
            const habitat = fastFindNearestColony(galaxy, Math.trunc(cOther.capital!.xpos), Math.trunc(cOther.capital!.ypos), self, 0);
            if (habitat !== null) {
                const status = cOther.systemVisibility[habitat.systemIndex].status;
                if (status !== SystemVisibilityStatus.Visible) cOther.visibility.setSystemVisibility(habitat, SystemVisibilityStatus.Explored);
            }
        }
        if (!checkWhetherKnowAnySystemsOfOtherEmpire(galaxy, self, cOther)) {
            const habitat2 = fastFindNearestColony(galaxy, Math.trunc(self.capital!.xpos), Math.trunc(self.capital!.ypos), cOther, 0);
            if (habitat2 !== null) {
                const status2 = self.systemVisibility[habitat2.systemIndex].status;
                if (status2 !== SystemVisibilityStatus.Visible) self.visibility.setSystemVisibility(habitat2, SystemVisibilityStatus.Explored);
            }
        }
    }
    if (currentDiplomaticRelation.type === DiplomaticRelationType.SubjugatedDominion) {
        const initiator = currentDiplomaticRelation.initiator!;
        const num = initiator.empiresViewable.indexOf(other2);
        if (num >= 0) {
            initiator.empiresViewable.splice(num, 1);
            initiator.empiresViewableExpiry.splice(num, 1);
        }
    }
    if (newDiplomaticRelationType === DiplomaticRelationType.SubjugatedDominion) {
        const num2 = self.empiresViewable.indexOf(cOther);
        if (num2 >= 0) {
            self.empiresViewableExpiry[num2] = LONG_MAX_VALUE;
        } else {
            self.empiresViewable.push(cOther);
            self.empiresViewableExpiry.push(LONG_MAX_VALUE);
        }
        const diplomaticRelation5 = self.proposedDiplomaticRelations.byEmpire(cOther);
        if (diplomaticRelation5 !== null && diplomaticRelation5.type === DiplomaticRelationType.None) self.proposedDiplomaticRelations.remove(diplomaticRelation5);
    }
    if (newDiplomaticRelationType === DiplomaticRelationType.War) {
        const ev = empireEvaluationByEmpire(empireEvaluationsOf(cOther), self);
        if (ev !== null) ev.incidentEvaluation = ev.incidentEvaluationRaw - INCIDENT_IMPACT_WHEN_DECLARE_WAR;
        currentDiplomaticRelation.militaryRefuelingToOther = false;
        currentDiplomaticRelation.miningRightsToOther = false;
        diplomaticRelation3.militaryRefuelingToOther = false;
        diplomaticRelation3.miningRightsToOther = false;
        setCivilityRating(self, self.civilityRating - DECLARE_WAR_REPUTATION_IMPACT);
    }
    if (newDiplomaticRelationType === DiplomaticRelationType.TradeSanctions) {
        const ev2 = empireEvaluationByEmpire(empireEvaluationsOf(cOther), self);
        if (ev2 !== null) ev2.incidentEvaluation = ev2.incidentEvaluationRaw - 15.0;
        currentDiplomaticRelation.militaryRefuelingToOther = false;
        currentDiplomaticRelation.miningRightsToOther = false;
        diplomaticRelation3.militaryRefuelingToOther = false;
        diplomaticRelation3.miningRightsToOther = false;
    }
    if (!isTreaty(newDiplomaticRelationType)) diplomaticRelation2.tradeBonus = 0.0;
    diplomaticRelation2.type = newDiplomaticRelationType;
    diplomaticRelation2.initiator = self;
    diplomaticRelation2.warDamageBuiltObject = 0;
    diplomaticRelation2.warDamageColony = 0;
    diplomaticRelation2.startDateOfLastChange = galaxyStarDate(galaxy);
    diplomaticRelation2.lastDiplomacyTradeOfferDate = galaxyStarDate(galaxy);
    diplomaticRelation2.allianceName = allianceName;
    diplomaticRelation2.locked = locked;
    diplomaticRelation3.locked = locked;
    if (!blockFlowonEffects && newDiplomaticRelationType === DiplomaticRelationType.War) {
        for (let i = 0; i < other2.diplomaticRelations.count; i++) {
            const r6 = other2.diplomaticRelations.at(i);
            if ((r6.type !== DiplomaticRelationType.MutualDefensePact && (r6.type !== DiplomaticRelationType.Protectorate || r6.initiator === other2)) || r6.otherEmpire === self) continue;
            if (r6.otherEmpire !== null) {
                const r7 = obtainDiplomaticRelation(r6.otherEmpire, self);
                if (r7 != null && r7.type === DiplomaticRelationType.War) continue;
            }
            const ally = r6.otherEmpire!;
            if (ally === galaxy.playerEmpire) {
                sendMessageToEmpire(other2, ally, EmpireMessageType.RequestHonorMutualDefense, self, formatText(getText('We are under attack from the EMPIRE'), self.name));
                continue;
            }
            let flag = true;
            const r8 = obtainDiplomaticRelation(ally, self);
            if (r8.type === DiplomaticRelationType.MutualDefensePact || (r8.type === DiplomaticRelationType.Protectorate && r8.initiator === self)) flag = false;
            else if (r8.locked && r8.type !== DiplomaticRelationType.War) flag = false;
            if (!flag) continue;
            const num3 = weightedMilitaryPotency(ally) / weightedMilitaryPotency(self);
            const num4 = loyaltyLevel(ally) / 100.0;
            const ev3 = empireEvaluationByEmpire(empireEvaluationsOf(ally), self);
            let num5 = 1.0;
            if (ev3 !== null) {
                num5 = 1.0 + ev3.overallAttitude / 100.0;
                num5 = Math.max(0.5, Math.min(num5, 1.5));
            }
            const num6 = num3 * num4 * num4 * num5 * num5;
            if (num6 > 0.3 + galaxy.rnd.nextDouble() * 0.1) {
                const ev4 = empireEvaluationByEmpire(empireEvaluationsOf(other2), ally);
                if (ev4 !== null) ev4.incidentEvaluation = ev4.incidentEvaluationRaw + 15.0;
                setCivilityRating(ally, ally.civilityRating + 6.0);
                declareWar(galaxy, ally, self, null, false, false);
            } else {
                const ev5 = empireEvaluationByEmpire(empireEvaluationsOf(other2), ally);
                if (ev5 !== null) ev5.incidentEvaluation = ev5.incidentEvaluationRaw - 22.0;
                setCivilityRating(ally, ally.civilityRating - 6.0);
            }
        }
    }
    if (!isTreaty(newDiplomaticRelationType)) diplomaticRelation3.tradeBonus = 0.0;
    diplomaticRelation3.type = newDiplomaticRelationType;
    diplomaticRelation3.warDamageBuiltObject = 0;
    diplomaticRelation3.warDamageColony = 0;
    diplomaticRelation3.initiator = self;
    diplomaticRelation3.startDateOfLastChange = galaxyStarDate(galaxy);
    diplomaticRelation3.lastDiplomacyTradeOfferDate = galaxyStarDate(galaxy);
    diplomaticRelation3.allianceName = allianceName;
    // Galaxy.GetMatchingGameEventIdDiplomaticRelationChange + CheckTriggerEvent (×2): scenario GameEvents — none in a normal
    // game (deferred with ProcessDelayedEventActions).
    todo(T_gameEvents);
    return true;
}

const T_sendNewsBroadcast = registerTodo('M4r', 'SendNewsBroadcastWarStartEnd (GalacticNewsNet messages, UI)');

/** Empire.7.cs 2966 SendNewsBroadcastWarStartEnd(relation) → ThreadPool SendNewsBroadcastCore (GalacticNewsNet messages
 *  to every empire; no Rnd). TODO(port) M9: news broadcasts. */
export function sendNewsBroadcastWarStartEnd(_relation: DiplomaticRelation): void {
    todo(T_sendNewsBroadcast);
}

/** Empire.7.cs 4868-4883 DeclareWar(target[, persuader[, lockedWar[, blockFlowonEffects]]]). */
export function declareWar(galaxy: Galaxy, self: Empire, target: Empire | null, persuader: Empire | null = null, lockedWar = false, blockFlowonEffects = false): void {
    if (target === null) return;
    const diplomaticRelation = obtainDiplomaticRelation(self, target);
    if (diplomaticRelation.type !== DiplomaticRelationType.War) {
        const flag = checkAtWarExcluding(target, null);
        changeDiplomaticRelation(galaxy, self, diplomaticRelation, DiplomaticRelationType.War, blockFlowonEffects, lockedWar);
        cancelBlockades(galaxy, self, target);
        cancelBlockades(galaxy, target, self);
        const ev = obtainEmpireEvaluation(galaxy, target, self);
        ev.incidentEvaluation = ev.incidentEvaluationRaw - 40.0;
        diplomaticRelation.lastDiplomacyTradeOfferDate = galaxyStarDate(galaxy);
        diplomaticRelation.startDateOfLastChange = galaxyStarDate(galaxy);
        const description = generateMessageDescriptionRelation(diplomaticRelation, DiplomaticRelationType.War, 0);
        if (persuader !== null) sendMessageToEmpire(self, target, EmpireMessageType.DiplomaticRelationChange, DiplomaticRelationType.War, description, NO_POINT, 'PERSUADED');
        else sendMessageToEmpire(self, target, EmpireMessageType.DiplomaticRelationChange, DiplomaticRelationType.War, description);
        // Empire.7.cs 2966 SendNewsBroadcastWarStartEnd → ThreadPool SendNewsBroadcastCore (GalacticNewsNet messages to every
        // empire; no Rnd). TODO(port) M9: news broadcasts.
        todo(T_sendNewsBroadcast);
        if (diplomaticRelation.warObjective === WarObjective.Undefined) setWarObjectives(galaxy, self, diplomaticRelation);
        sendAttackFleets(galaxy, self, target);
        if (self.controlMilitaryAttacks !== MANUAL && self.policy!.useExplorationShipsToScoutEnemySystems) sendScoutShipsToEnemyLocations(galaxy, self, [target]);
        const diplomaticRelation2 = obtainDiplomaticRelation(target, self);
        if (diplomaticRelation2 != null && diplomaticRelation2.warObjective === WarObjective.Undefined) setWarObjectives(galaxy, target, diplomaticRelation2);
        if (diplomaticRelation2 != null) diplomaticRelation2.startDateOfLastChange = galaxyStarDate(galaxy);
        const characterList = findCharactersAtLocation(getEmpireCharacters(self), target.capital);
        for (let i = 0; i < characterList.length; i++) characterList[i].completeLocationTransfer(self.capital, galaxy);
        const characterList2 = findCharactersAtLocation(getEmpireCharacters(target), self.capital);
        for (let j = 0; j < characterList2.length; j++) characterList2[j].completeLocationTransfer(target.capital, galaxy);
        if (!flag) clearAttackFleetAssignments(galaxy, target, null);
        prepareFleetsForWar(galaxy, target, self);
        sendAttackFleets(galaxy, target, self);
        if (diplomaticRelation2.warObjective === WarObjective.CaptureObjectives) setDefendFleets(galaxy, target, false, true);
        else setDefendFleets(galaxy, target, true, true);
        if ((self !== galaxy.playerEmpire || self.controlMilitaryAttacks === FULLY_AUTOMATED) && diplomaticRelation.warObjective !== WarObjective.CaptureObjectives) identifyMilitaryObjectives(galaxy, self);
        if (target !== galaxy.playerEmpire && diplomaticRelation2.warObjective !== WarObjective.CaptureObjectives) identifyMilitaryObjectives(galaxy, target);
        reviewDefensiveFleetLocations(galaxy, self);
    } else if (lockedWar) {
        diplomaticRelation.locked = true;
        const diplomaticRelation3 = obtainDiplomaticRelation(target, self);
        if (diplomaticRelation3 != null) diplomaticRelation3.locked = true;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// r2 — ProcessMessages (Empire.3.cs 4240) and ConsiderTreatyProposals (Empire.3.cs 3606).
// ---------------------------------------------------------------------------------------------------------------

/** Empire.cs 983 SpecialBonusDiplomacy. TODO(port) M4j: _SpecialBonusDiplomacy (ReviewSpecialBonusesRuinsWonders) — 0 until then. */
function specialBonusDiplomacy(self: Empire): number {
    void self;
    return 0.0;
}

/** PirateRelation.cs 271 Evaluation: float sum of the parts, then × or ÷ DiplomacyFactor. */
export function pirateRelationEvaluation(pr: PirateRelation): number {
    const f = Math.fround;
    let num = f(pr.evaluationGifts + pr.evaluationOffenseOverRequests);
    num = f(num + pr.evaluationDetectedIntelligenceMissions);
    num = f(num + pr.evaluationLongRelationship);
    num = f(num + pr.evaluationPirateMissionsSucceed);
    num = f(num + pr.evaluationPirateMissionsFail);
    num = f(num + pr.evaluationProtectionCancelled);
    num = f(num + pr.evaluationShipAttacks);
    num = f(num + pr.evaluationCovetedColonies);
    num = f(num + pr.evaluationRaidsAgainstOurColonies);
    return num >= 0.0 ? f(num * pr.diplomacyFactor) : f(num / pr.diplomacyFactor);
}

/** Empire.7.cs 2805 ObtainAttitude(empire). */
export function obtainAttitude(galaxy: Galaxy, self: Empire, empire: Empire | null): number {
    let result = 0;
    if (empire !== null) {
        if (self.pirateEmpireBaseHabitat === null && empire.pirateEmpireBaseHabitat === null) {
            result = obtainEmpireEvaluation(galaxy, self, empire).overallAttitude;
        } else {
            result = Math.trunc(pirateRelationEvaluation(obtainPirateRelation(self, empire)));
        }
    }
    return result;
}

/** Empire.3.cs 4002 CheckSufficientFunds(cost, allowableRatio). */
function checkSufficientFunds(self: Empire, cost: number, allowableRatio: number): boolean {
    const num = Math.max(0.0, self.stateMoney * allowableRatio);
    return cost < num;
}

/** Empire.3.cs 4012 ValueMoneyGiftFromEmpire(giver, amount). */
export function valueMoneyGiftFromEmpire(galaxy: Galaxy, self: Empire, giver: Empire, amount: number): number {
    const num = giver.stateMoney / 8.0;
    let num2 = Math.sqrt(Math.sqrt(amount)) * (amount / num);
    if (self.pirateEmpireBaseHabitat === null && giver.pirateEmpireBaseHabitat === null) {
        const diplomaticRelation = obtainDiplomaticRelation(giver, self);
        const num3 = Math.min(1.0, (galaxyStarDate(galaxy) - diplomaticRelation.lastGiftDate) / IDEAL_TIME_BETWEEN_GIFTS);
        num2 *= num3;
    }
    const num4 = obtainAttitude(galaxy, self, giver);
    if (num4 < 0) {
        const num5 = Math.max(1.0, num4 / -2.5);
        num2 /= num5;
    }
    num2 = Math.max(0.0, Math.min(num2, 15.0));
    return num2 * (1.0 + specialBonusDiplomacy(giver));
}

const T_pirateEconomyIncome = registerTodo('M4r', 'PirateEconomy.PerformIncome (ledger; PirateEconomy not ported)');
/** PirateEconomy.PerformIncome(amount, type, date) — statistics ledger (empire.ts PirateEconomy placeholder). TODO(port). */
function pirateEconomyPerformIncome(e: Empire, amount: number): void {
    void e;
    void amount;
    todo(T_pirateEconomyIncome);
}

/** Galaxy.ResolveDescription(DiplomaticRelationType). */
function relationTypeName(t: DiplomaticRelationType): string {
    return resolveDescription(DiplomaticRelationType, t);
}

const T_missionsForMessages = registerTodo('M4r', 'LeaveSystem/RemoveMilitaryForcesFromSystem mission assignment (M4b AssignMission)');

/** Nearest refuelling depot outside `systemStar` (Empire.3.cs 3949-3961 / 4058-4070). */
function nearestRefuellingDepotOutsideSystem(galaxy: Galaxy, self: Empire, systemStar: Habitat): BuiltObject | null {
    let num2 = 536870911;
    let builtObject: BuiltObject | null = null;
    const depots = self.refuellingDepots as BuiltObject[];
    for (let i = 0; i < depots.length; i++) {
        const builtObject2 = depots[i];
        if (builtObject2.nearestSystemStar !== systemStar) {
            const num3 = Math.trunc(galaxy.calculateDistance(systemStar.xpos, systemStar.ypos, builtObject2.xpos, builtObject2.ypos));
            if (num3 < num2) {
                num2 = num3;
                builtObject = builtObject2;
            }
        }
    }
    return builtObject;
}

/**
 * Empire.3.cs 3945 LeaveSystem(systemStar): the offence value of moving our ships out. With no refuelling depot outside
 * the system (or no ship to move) it is 0 and nothing is ordered. TODO(port) M4b: the Move missions
 * (ShipGroup.AssignMission / BuiltObject.ClearPreviousMissionRequirements + AssignMission) — each ship that would be
 * ordered counts a todo hit and adds its C# value (10 per fleet ship, FirepowerRaw / 20 per lone ship).
 */
function leaveSystem(galaxy: Galaxy, self: Empire, systemStar: Habitat): number {
    let num = 0.0;
    const builtObject = nearestRefuellingDepotOutsideSystem(galaxy, self, systemStar);
    if (builtObject !== null) {
        for (let j = 0; j < self.builtObjects.length; j++) {
            const builtObject3 = self.builtObjects[j];
            if (builtObject3.role === BuiltObjectRole.Base) continue;
            const num4 = Math.trunc(galaxy.calculateDistance(builtObject3.xpos, builtObject3.ypos, systemStar.xpos, systemStar.ypos));
            if (builtObject3.nearestSystemStar === systemStar || num4 <= MAX_SOLAR_SYSTEM_SIZE) {
                const shipGroup = (builtObject3 as unknown as { shipGroup?: ShipGroup | null }).shipGroup ?? null;
                const sgMission = shipGroup !== null ? builtObjectMission(shipGroup.mission) : null;
                if (shipGroup !== null && (sgMission === null || sgMission.type === BuiltObjectMissionType.Undefined || sgMission.type === BuiltObjectMissionType.MoveAndWait || sgMission.type === BuiltObjectMissionType.Hold)) {
                    todo(T_missionsForMessages);
                    num += 10.0;
                } else if (shipGroup === null && builtObject3.topSpeed > 0 && builtObject !== null) {
                    todo(T_missionsForMessages);
                    num += builtObject3.firepowerRaw / 20.0;
                }
            }
        }
    }
    return num;
}
const MAX_SOLAR_SYSTEM_SIZE = 23000; // Galaxy.MaxSolarSystemSize

/**
 * Empire.3.cs 4032 RemoveMilitaryForcesFromSystem(systemStar, requester): 1 ships ordered out, 0 none, -1 refused.
 * TODO(port) M4b: the Refuel missions (ClearPreviousMissionRequirements + AssignMission(Refuel, depot, Unavailable)) —
 * counted as todo hits.
 */
function removeMilitaryForcesFromSystem(galaxy: Galaxy, self: Empire, systemStar: Habitat, requester: Empire): number {
    const num = determineRelativeStrength(galaxy, militaryPotency(self), requester);
    let flag = false;
    if (self.pirateEmpireBaseHabitat === null && requester.pirateEmpireBaseHabitat === null) {
        const diplomaticRelation = obtainDiplomaticRelation(self, requester);
        const s = diplomaticRelation.strategy;
        if (s === DiplomaticStrategy.Ally || s === DiplomaticStrategy.Befriend || s === DiplomaticStrategy.DefendPlacate || s === DiplomaticStrategy.Placate || num < 0) flag = true;
    } else {
        const pirateRelation = obtainPirateRelation(self, requester);
        if (pirateRelation.type === PirateRelationType.Protection || pirateRelationEvaluation(pirateRelation) > 10) flag = true;
    }
    if (flag) {
        let num2 = 0;
        const builtObject = nearestRefuellingDepotOutsideSystem(galaxy, self, systemStar);
        if (builtObject !== null) {
            for (let j = 0; j < self.builtObjects.length; j++) {
                const bo = self.builtObjects[j];
                if (bo.role === BuiltObjectRole.Military && bo.firepowerRaw > 0 && bo.nearestSystemStar === systemStar) {
                    todo(T_missionsForMessages);
                    num2++;
                }
            }
        }
        return num2 > 0 ? 1 : 0;
    }
    return -1;
}

const T_pirateProtectionOffer = registerTodo('M4r', 'PirateOfferProtection (DetermineDesirePirateProtection / AcceptPirateProtection — M4s)');
const T_offerTrade = registerTodo('M4r', 'ProcessMessages OfferTrade research purchase (M4k research)');
const T_ordersForRelinquishedColony = registerTodo('M4r', 'RemoveColoniesFromSystem order/contract cleanup (M4d Galaxy.Orders.GetOrders)');

/** Empire.3.cs 4240 ProcessMessages: handles and then clears the empire's message queue. */
export function processMessages(galaxy: Galaxy, empire: Empire): void {
    const self = empire;
    const array = (self.messages as EmpireMessage[]).slice(); // ListHelper.ToArrayThreadSafe
    for (const empireMessage of array) {
        if (empireMessage == null) continue;
        let empire1: Empire | null = null;
        let empire2: Empire | null = null;
        let ev: EmpireEvaluation | null = null;
        let diplomaticRelation: DiplomaticRelation | null = null;
        let num = 0.0;
        const sender = empireMessage.sender;
        const subject = empireMessage.subject;
        switch (empireMessage.messageType) {
            case EmpireMessageType.RemoveForcesFromSystem:
                if (self !== galaxy.playerEmpire) removeMilitaryForcesFromSystem(galaxy, self, subject as Habitat, sender!);
                break;
            case EmpireMessageType.CancelPirateProtection:
                if (self.pirateEmpireBaseHabitat !== null && sender !== null) {
                    const pirateRelation3 = obtainPirateRelation(self, sender);
                    const evaluationChangeAmount = pirateRelation3.calculateOffenseOverCancellingProtection(galaxyStarDate(galaxy));
                    changePirateEvaluation(self, sender, evaluationChangeAmount, PirateRelationEvaluationType.ProtectionCancelled);
                }
                break;
            case EmpireMessageType.PirateOfferProtection:
                if (self.controlDiplomacyTreaties === FULLY_AUTOMATED) {
                    // TODO(port) M4s: DetermineDesirePirateProtection(sender) → AcceptPirateProtection(sender, Money or
                    // CalculatePirateProtectionPricePerMonth) (Empire.2.cs; no Rnd). Pirate protection offers come from M4s.
                    todo(T_pirateProtectionOffer);
                }
                break;
            case EmpireMessageType.SellInfoUnmetEmpire: {
                if (self === galaxy.playerEmpire || self.pirateEmpireBaseHabitat !== null || galaxy.rnd.next(0, 2) !== 1 || !checkSufficientFunds(self, empireMessage.money, 0.2) || !(isEmpire(subject))) break;
                empire1 = subject as Empire;
                let num3 = 0;
                for (let j = 0; j < self.diplomaticRelations.count; j++) {
                    if (self.diplomaticRelations.at(j).type !== DiplomaticRelationType.NotMet) num3++;
                }
                const num4 = num3 / galaxy.empires.length;
                if (num4 < 0.4) {
                    const title = formatText(getText('Inform Empire Their Contact Details Sold Title'), self.name);
                    const description = formatText(getText('Inform Empire Their Contact Details Sold'), sender!.name, self.name);
                    sendMessageToEmpireWithTitle(empire1, empire1, EmpireMessageType.GeneralNeutralEvent, null, description, title);
                    let diplomaticRelation5 = obtainDiplomaticRelation(self, empire1);
                    diplomaticRelation5.type = DiplomaticRelationType.None;
                    diplomaticRelation5 = obtainDiplomaticRelation(empire1, self);
                    diplomaticRelation5.type = DiplomaticRelationType.None;
                    self.stateMoney -= empireMessage.money;
                    sender!.stateMoney += empireMessage.money;
                    pirateEconomyPerformIncome(sender!, empireMessage.money);
                }
                break;
            }
            case EmpireMessageType.SellInfoSystemMap: {
                if (self === galaxy.playerEmpire || self.pirateEmpireBaseHabitat !== null || galaxy.rnd.next(0, 2) !== 1 || !checkSufficientFunds(self, empireMessage.money, 0.1) || !(subject instanceof Habitat)) break;
                const habitat4 = subject;
                let num11 = 0;
                for (let k = 0; k < self.diplomaticRelations.count; k++) {
                    if (self.diplomaticRelations.at(k).type !== DiplomaticRelationType.NotMet) num11++;
                }
                const num12 = num11 / galaxy.empires.length;
                if (num12 < 0.4) {
                    self.systemVisibility[habitat4.systemIndex].status = SystemVisibilityStatus.Explored;
                    self.stateMoney -= empireMessage.money;
                    sender!.stateMoney += empireMessage.money;
                    pirateEconomyPerformIncome(sender!, empireMessage.money);
                }
                break;
            }
            case EmpireMessageType.SellInfoIndependentColony:
                if (self !== galaxy.playerEmpire && galaxy.rnd.next(0, 2) === 1 && checkSufficientFunds(self, empireMessage.money, 0.2) && subject instanceof Habitat) {
                    if (self.colonies.length < 8) {
                        self.systemVisibility[subject.systemIndex].status = SystemVisibilityStatus.Explored;
                        self.stateMoney -= empireMessage.money;
                        sender!.stateMoney += empireMessage.money;
                        pirateEconomyPerformIncome(sender!, empireMessage.money);
                    }
                }
                break;
            case EmpireMessageType.SellInfoRuins:
                if (self !== galaxy.playerEmpire && galaxy.rnd.next(0, 2) === 1 && checkSufficientFunds(self, empireMessage.money, 0.2) && subject instanceof Habitat) {
                    self.systemVisibility[subject.systemIndex].status = SystemVisibilityStatus.Explored;
                    self.stateMoney -= empireMessage.money;
                    sender!.stateMoney += empireMessage.money;
                    pirateEconomyPerformIncome(sender!, empireMessage.money);
                }
                break;
            case EmpireMessageType.SellInfoDebrisField:
            case EmpireMessageType.SellInfoRestrictedArea:
            case EmpireMessageType.SellInfoPlanetDestroyer:
                if (self !== galaxy.playerEmpire && galaxy.rnd.next(0, 2) === 1 && checkSufficientFunds(self, empireMessage.money, 0.2) && subject instanceof GalaxyLocation) {
                    if (!self.visibility.knownGalaxyLocations.includes(subject)) self.visibility.knownGalaxyLocations.push(subject);
                    self.stateMoney -= empireMessage.money;
                    sender!.stateMoney += empireMessage.money;
                    pirateEconomyPerformIncome(sender!, empireMessage.money);
                }
                break;
            case EmpireMessageType.OfferTrade: {
                if (self === galaxy.playerEmpire) break;
                if (Array.isArray(subject)) {
                    // Empire.3.cs 4384-4418: object[] { offered TradeableItemList, requested TradeableItemList }.
                    processTradeDealMessage(galaxy, self, sender!, subject[0] as TradeableItem[], subject[1] as TradeableItem[]);
                    break;
                }
                if (!(subject instanceof TradeableItem)) break;
                const tradeableItem = subject;
                if (tradeableItem.type === TradeableItemType.TerritoryMap) {
                    if (!determineAcceptTerritoryMapTrade(galaxy, self, tradeableItem.value, sender!)) break;
                    const habitatList2 = determineEmpireSystems(galaxy, sender!);
                    const habitatList3 = determineEmpireSystems(galaxy, self);
                    for (const item5 of habitatList2) {
                        if (!self.visibility.checkSystemExplored(item5.systemIndex)) self.visibility.setSystemVisibility(item5, SystemVisibilityStatus.Explored);
                    }
                    for (const item6 of habitatList3) {
                        if (!sender!.visibility.checkSystemExplored(item6.systemIndex)) sender!.visibility.setSystemVisibility(item6, SystemVisibilityStatus.Explored);
                    }
                } else if (tradeableItem.type === TradeableItemType.GalaxyMap) {
                    if (determineAcceptGalaxyMapTrade(galaxy, self, tradeableItem.value, sender!)) {
                        galaxyMergeGalaxyMap(galaxy, sender!, self);
                        galaxyMergeGalaxyMap(galaxy, self, sender!);
                    }
                } else {
                    if (tradeableItem.type !== TradeableItemType.ResearchProject || !(tradeableItem.value <= self.stateMoney)) break;
                    const num14 = self.stateMoney * (0.25 + galaxy.rnd.nextDouble() * 0.25);
                    if (self.stateMoney >= num14 && tradeableItem.item !== null) {
                        // TODO(port) M4k: Research.TechTree.GetEquivalent(node); if not researched → DoResearchBreakthrough(…,
                        // selfResearched false, blockMessages, suppressUpdate), Research.Update, ReviewDesignsBuiltObjectsImprovedComponents,
                        // ReviewResearchAbilities, then the payment. Research items are not offered until M4k's research model exists.
                        todo(T_offerTrade);
                    }
                }
                break;
            }
            case EmpireMessageType.GiveGift: {
                const num15 = valueMoneyGiftFromEmpire(galaxy, self, sender!, empireMessage.money);
                if (sender!.pirateEmpireBaseHabitat === null && self.pirateEmpireBaseHabitat === null) {
                    const ev2 = obtainEmpireEvaluation(galaxy, self, sender);
                    ev2.incidentEvaluation = ev2.incidentEvaluationRaw + num15;
                } else {
                    const pirateRelation2 = obtainPirateRelation(self, sender);
                    pirateRelation2.evaluationGifts = Math.fround(pirateRelation2.evaluationGifts + Math.fround(num15));
                }
                setCivilityRating(sender!, sender!.civilityRating + num15 * 0.1);
                self.stateMoney += empireMessage.money;
                pirateEconomyPerformIncome(self, empireMessage.money);
                sendMessageToEmpire(self, sender, EmpireMessageType.Informational, null, getText('Thank you for your gift.'));
                if (sender!.pirateEmpireBaseHabitat === null && self.pirateEmpireBaseHabitat === null) {
                    diplomaticRelation = obtainDiplomaticRelation(sender!, self);
                    diplomaticRelation.lastGiftDate = galaxyStarDate(galaxy);
                }
                break;
            }
            case EmpireMessageType.LeaveSystem: {
                if (self.controlDiplomacyTreaties !== FULLY_AUTOMATED) break;
                if (sender!.pirateEmpireBaseHabitat === null && self.pirateEmpireBaseHabitat === null) {
                    diplomaticRelation = obtainDiplomaticRelation(self, sender);
                    if (diplomaticRelation.type === DiplomaticRelationType.War || diplomaticRelation.type === DiplomaticRelationType.TradeSanctions) break;
                }
                num = weightedMilitaryPotency(self) / weightedMilitaryPotency(sender!);
                if ((galaxy.rnd.next(0, 3) === 1 || num < (galaxy.rnd.nextDouble() * 50.0 + cautionLevel(self) - 50.0) / 100.0) && subject instanceof Habitat) {
                    const habitat2 = subject;
                    let val = leaveSystem(galaxy, self, habitat2);
                    if (sender!.pirateEmpireBaseHabitat === null && self.pirateEmpireBaseHabitat === null) {
                        ev = obtainEmpireEvaluation(galaxy, self, sender);
                        val = Math.min(val, 3.0);
                        ev.incidentEvaluation = ev.incidentEvaluationRaw - val;
                    } else {
                        const pirateRelation = obtainPirateRelation(self, sender);
                        val = Math.min(val, 3.0);
                        pirateRelation.evaluationOffenseOverRequests = Math.fround(pirateRelation.evaluationOffenseOverRequests - Math.fround(val));
                    }
                    sendMessageToEmpire(self, sender, EmpireMessageType.Informational, null, formatText(getText('We comply with your request to leave the X system'), habitat2.name));
                }
                break;
            }
            case EmpireMessageType.RemoveColoniesFromSystem: {
                if (self.controlDiplomacyTreaties === MANUAL) break;
                diplomaticRelation = obtainDiplomaticRelation(self, sender);
                if (diplomaticRelation.type === DiplomaticRelationType.War || diplomaticRelation.type === DiplomaticRelationType.TradeSanctions) break;
                num = weightedMilitaryPotency(self) / weightedMilitaryPotency(sender!);
                if (!(num < (galaxy.rnd.nextDouble() * 30.0 + cautionLevel(self) - 65.0) / 100.0) || !(subject instanceof Habitat)) break;
                let num5 = 0.0;
                let num6 = 0;
                const habitat = subject;
                const habitatList: Habitat[] = [];
                const habitats = galaxy.systems[galaxy.determineHabitatSystemStar(habitat).systemIndex].habitats; // Galaxy.Systems[habitat]
                for (const item7 of habitats) {
                    for (let num7 = self.colonies.indexOf(item7); num7 >= 0; num7 = num7 >= self.colonies.length - 1 ? -1 : self.colonies.indexOf(item7, num7 + 1)) {
                        habitatList.push(self.colonies[num7]);
                        num6 += habitatDevelopmentLevel(self.colonies[num7]) * self.colonies[num7].population.totalAmount;
                    }
                }
                let flag = true;
                for (const item8 of habitatList) {
                    if (item8 === self.capital) {
                        flag = false;
                        break;
                    }
                }
                if (flag) {
                    const num8 = 50.0 * ((galaxy.rnd.nextDouble() * 40.0 + 80.0) * Math.pow(1.0 / num, 2.0));
                    if (num8 > Math.trunc(num6 / 1000000)) {
                        for (const item9 of habitatList) {
                            // TODO(port) M4d: Galaxy.Orders.GetOrders(item9): freighters' contract cargo re-owned, missions cleared,
                            // orders removed (Empire.3.cs 4586-4633).
                            if (galaxy.orders.length > 0) todo(T_ordersForRelinquishedColony);
                            item9.owner = null;
                            item9.empire = null;
                            const ci = self.colonies.indexOf(item9);
                            if (ci >= 0) self.colonies.splice(ci, 1);
                            num5 += habitatDevelopmentLevel(item9) / 3.0;
                        }
                        ev = obtainEmpireEvaluation(galaxy, self, sender);
                        num5 = Math.min(num5, 30.0);
                        ev.incidentEvaluation = ev.incidentEvaluationRaw - num5;
                        sendMessageToEmpire(self, sender, EmpireMessageType.Informational, null, formatText(getText('We comply with your request to remove all colonies from the X system'), habitat.name));
                    } else {
                        ev = obtainEmpireEvaluation(galaxy, self, sender);
                        num5 = 8.0;
                        ev.incidentEvaluation = ev.incidentEvaluationRaw - num5;
                        sendMessageToEmpire(self, sender, EmpireMessageType.Informational, null, formatText(getText('We will not remove our colonies from the X system'), habitat.name));
                    }
                } else {
                    ev = obtainEmpireEvaluation(galaxy, self, sender);
                    num5 = 8.0;
                    ev.incidentEvaluation = ev.incidentEvaluationRaw - num5;
                    sendMessageToEmpire(self, sender, EmpireMessageType.Informational, null, formatText(getText('We will not remove our colonies from the X system'), habitat.name) + getText('This is our capital system.'));
                }
                break;
            }
            case EmpireMessageType.RequestJointWar: {
                if (!isEmpire(subject)) break;
                empire1 = subject;
                empire2 = sender!;
                if (empire1 === self || self.controlDiplomacyOffense === MANUAL || self.reclusive || empire2.pirateEmpireBaseHabitat !== null || empire1.pirateEmpireBaseHabitat !== null || self.pirateEmpireBaseHabitat !== null) break;
                diplomaticRelation = obtainDiplomaticRelation(self, empire1);
                if (diplomaticRelation.type === DiplomaticRelationType.War) break;
                const strategy = diplomaticRelation.strategy;
                const flag3 = strategy === DiplomaticStrategy.Conquer || strategy === DiplomaticStrategy.Undermine || strategy === DiplomaticStrategy.Punish;
                if (!flag3) break;
                const wmp2 = weightedMilitaryPotency(empire1);
                num = weightedMilitaryPotency(self) / wmp2;
                if (!(num > (galaxy.rnd.nextDouble() * 40.0 + cautionLevel(self) - 30.0) / 100.0)) break;
                const diplomaticRelation8 = obtainDiplomaticRelation(self, empire2);
                if (diplomaticRelation8.strategy === DiplomaticStrategy.Ally || diplomaticRelation8.strategy === DiplomaticStrategy.Befriend) {
                    let flag4 = true;
                    if (diplomaticRelation.type === DiplomaticRelationType.MutualDefensePact || (diplomaticRelation.type === DiplomaticRelationType.Protectorate && diplomaticRelation.initiator === self)) flag4 = false;
                    else if (diplomaticRelation.locked && (diplomaticRelation.type as DiplomaticRelationType) !== DiplomaticRelationType.War) flag4 = false;
                    if (flag4 && checkTaskAuthorizedSimple(galaxy, self, self.controlDiplomacyOffense, formatText(getText('Automation Assist War'), empire2.name, empire1.name), empire1, AdvisorMessageType.ComplyWarOther)) {
                        declareWar(galaxy, self, empire1, empire2);
                        sendMessageToEmpire(self, empire2, EmpireMessageType.Informational, null, formatText(getText('We join you in battle against the EMPIRE'), empire1.name));
                        const ev4 = obtainEmpireEvaluation(galaxy, empire2, self);
                        ev4.incidentEvaluation = ev4.incidentEvaluationRaw + 10.0;
                    }
                }
                break;
            }
            case EmpireMessageType.RequestJointTradeSanctions: {
                if (!isEmpire(subject)) break;
                empire1 = subject;
                empire2 = sender!;
                if (empire1 === self || self.controlDiplomacyOffense === MANUAL || self.reclusive || empire2.pirateEmpireBaseHabitat !== null || empire1.pirateEmpireBaseHabitat !== null || self.pirateEmpireBaseHabitat !== null) break;
                diplomaticRelation = obtainDiplomaticRelation(self, empire1);
                if (diplomaticRelation.type === DiplomaticRelationType.War || diplomaticRelation.type === DiplomaticRelationType.TradeSanctions) break;
                ev = obtainEmpireEvaluation(galaxy, self, empire1);
                let flag2 = false;
                switch (diplomaticRelation.strategy) {
                    case DiplomaticStrategy.Conquer:
                    case DiplomaticStrategy.Undermine:
                    case DiplomaticStrategy.DefendUndermine:
                    case DiplomaticStrategy.Punish:
                        flag2 = true;
                        break;
                }
                if (!flag2) break;
                const num16 = calculateNextAllowableProposalDate(galaxy, diplomaticRelation);
                if (galaxyStarDate(galaxy) < num16) break;
                const wmp = weightedMilitaryPotency(empire1);
                num = weightedMilitaryPotency(self) / wmp;
                if (!(num > (galaxy.rnd.nextDouble() * 40.0 + cautionLevel(self) - 40.0) / 100.0)) break;
                const num17 = Math.trunc(Math.trunc(self.stateMoney) / 2); // (int)StateMoney / 2
                if (ev.tradeVolume >= num17) break;
                const diplomaticRelation7 = obtainDiplomaticRelation(self, empire2);
                if (diplomaticRelation7.strategy === DiplomaticStrategy.Ally || diplomaticRelation7.strategy === DiplomaticStrategy.Befriend) {
                    if (checkTaskAuthorized(galaxy, self, self.controlDiplomacyOffense, { value: 0 }, formatText(getText('Automation Assist Trade Sanctions'), empire2.name, empire1.name), empire1, AdvisorMessageType.ComplyTradeSanctionsOther, null, empire2, null)) {
                        const currentDiplomaticRelation2 = obtainDiplomaticRelation(self, empire1);
                        changeDiplomaticRelation(galaxy, self, currentDiplomaticRelation2, DiplomaticRelationType.TradeSanctions);
                        sendMessageToEmpire(self, empire1, EmpireMessageType.DiplomaticRelationChange, DiplomaticRelationType.TradeSanctions, getText('We terminate all trade with you effective immediately!'));
                        sendMessageToEmpire(self, empire2, EmpireMessageType.Informational, null, formatText(getText('We join you in trade embargo against the EMPIRE'), empire1.name));
                        const ev3 = obtainEmpireEvaluation(galaxy, empire2, self);
                        ev3.incidentEvaluation = ev3.incidentEvaluationRaw + 5.0;
                    }
                }
                break;
            }
            case EmpireMessageType.RequestHonorMutualDefense: {
                if (sender === null || subject === null || !isEmpire(subject)) break;
                const empire3 = subject;
                if (empire3 !== null && empire3.pirateEmpireBaseHabitat === null && sender.pirateEmpireBaseHabitat === null && self.pirateEmpireBaseHabitat === null) {
                    const diplomaticRelation3 = obtainDiplomaticRelation(self, empire3);
                    if (diplomaticRelation3.type !== DiplomaticRelationType.War) considerHonorMutualDefensePactOrProtectorate(galaxy, self, sender, empire3);
                }
                break;
            }
            case EmpireMessageType.RequestLiftTradeSanctions: {
                if (!isEmpire(subject)) break;
                empire1 = subject;
                if (self.controlDiplomacyOffense !== FULLY_AUTOMATED || self.reclusive || empire1.pirateEmpireBaseHabitat !== null || sender!.pirateEmpireBaseHabitat !== null || self.pirateEmpireBaseHabitat !== null) break;
                diplomaticRelation = obtainDiplomaticRelation(self, empire1);
                if (diplomaticRelation.type !== DiplomaticRelationType.TradeSanctions || diplomaticRelation.initiator !== self) break;
                const num2 = calculateNextAllowableProposalDate(galaxy, diplomaticRelation);
                if (galaxyStarDate(galaxy) < num2) break;
                num = weightedMilitaryPotency(self) / weightedMilitaryPotency(sender!);
                // Empire.3.cs 4818: ObtainDiplomaticRelation(empire2) with empire2 still null in this case → a fresh None
                // relation (Strategy Undefined), so the Ally/Befriend branch is never taken (C# quirk kept).
                const diplomaticRelation2 = obtainDiplomaticRelation(self, empire2);
                const lift = (): void => {
                    changeDiplomaticRelation(galaxy, self, diplomaticRelation!, DiplomaticRelationType.None);
                    sendMessageToEmpire(self, empire1, EmpireMessageType.DiplomaticRelationChange, DiplomaticRelationType.None, getText('Our trade sanctions against you have been lifted - we will now resume trade.'), NO_POINT, relationTypeName(DiplomaticRelationType.TradeSanctions));
                    cancelBlockades(galaxy, self, empire1!);
                    cancelBlockades(galaxy, empire1!, self);
                    sendMessageToEmpire(self, sender, EmpireMessageType.Informational, null, formatText(getText('We will resume trade with the EMPIRE'), empire1!.name));
                };
                if (diplomaticRelation2.strategy === DiplomaticStrategy.Ally || diplomaticRelation2.strategy === DiplomaticStrategy.Befriend) {
                    if (diplomaticRelation.strategy !== DiplomaticStrategy.Conquer) lift();
                } else if (num < (galaxy.rnd.nextDouble() * 30.0 + cautionLevel(self) - 65.0) / 100.0 && diplomaticRelation.strategy !== DiplomaticStrategy.Conquer) {
                    lift();
                }
                break;
            }
        }
        void empire2;
    }
    (self.messages as EmpireMessage[]).length = 0;
}

/** `subject is Empire`. */
function isEmpire(o: unknown): o is Empire {
    return o !== null && typeof o === 'object' && (o as Empire).diplomaticRelations instanceof DiplomaticRelationList;
}

/** Empire.3.cs 4850 ConsiderHonorMutualDefensePactOrProtectorate(requester, targetEmpire). */
export function considerHonorMutualDefensePactOrProtectorate(galaxy: Galaxy, self: Empire, requester: Empire | null, targetEmpire: Empire | null): boolean {
    if (requester !== null && targetEmpire !== null) {
        const diplomaticRelation = obtainDiplomaticRelation(self, requester);
        if (diplomaticRelation.type === DiplomaticRelationType.MutualDefensePact || (diplomaticRelation.type === DiplomaticRelationType.Protectorate && diplomaticRelation.initiator === self)) {
            let flag = true;
            const diplomaticRelation2 = obtainDiplomaticRelation(self, targetEmpire);
            if (diplomaticRelation2.type === DiplomaticRelationType.MutualDefensePact || (diplomaticRelation2.type === DiplomaticRelationType.Protectorate && diplomaticRelation2.initiator === self)) flag = false;
            else if (diplomaticRelation2.locked && diplomaticRelation2.type !== DiplomaticRelationType.War) flag = false;
            if (flag) {
                const num = militaryPotency(self) / militaryPotency(targetEmpire);
                let num2 = 1.0;
                if (self.dominantRace !== null) {
                    num2 = loyaltyLevel(self) / 100.0;
                    num2 *= num2;
                }
                const num3 = num * num2;
                if (num3 >= 0.5) {
                    declareWar(galaxy, self, targetEmpire, null, false, true);
                    const evR = obtainEmpireEvaluation(galaxy, requester, self);
                    evR.incidentEvaluation = evR.incidentEvaluation + 30.0; // C# `IncidentEvaluation += 30` reads the factored getter
                    setCivilityRating(self, self.civilityRating + 8.0);
                    sendMessageToEmpire(self, requester, EmpireMessageType.Informational, targetEmpire, formatText(getText('We stand alongside our friends and allies'), targetEmpire.name));
                    return true;
                }
                sendMessageToEmpire(self, requester, EmpireMessageType.Informational, targetEmpire, getText("Sorry, we can't help you right now..."));
                const evR2 = obtainEmpireEvaluation(galaxy, requester, self);
                evR2.incidentEvaluation = evR2.incidentEvaluation - 30.0;
                setCivilityRating(self, self.civilityRating - 6.0);
                changeDiplomaticRelation(galaxy, self, obtainDiplomaticRelation(self, requester), DiplomaticRelationType.None, true);
                return false;
            }
        }
    }
    return false;
}

/** Empire.3.cs 3316/3321 ResetAttitudeLevelsAtEndOfWar(diplomaticRelation[, specifiedWinner]). */
export function resetAttitudeLevelsAtEndOfWar(galaxy: Galaxy, diplomaticRelation: DiplomaticRelation, specifiedWinner: Empire | null = null): void {
    const v = determineVictorInWar(diplomaticRelation);
    let empire = v.victor;
    let loser = v.loser;
    let winningRatio = v.winningRatio;
    if (specifiedWinner !== null) {
        if (loser === specifiedWinner) loser = empire;
        empire = specifiedWinner;
        winningRatio = 1.5;
    }
    const clearAll = (e: EmpireEvaluation): void => {
        e.governmentStyleAffinityCumulative = 0.0;
        e.relationshipWithFriendsPositiveCumulative = 0.0;
        e.relationshipWithFriendsNegativeCumulative = 0.0;
        e.systemCompetitionCumulative = 0.0;
        e.covetousnessCumulative = 0.0;
    };
    if (winningRatio > 2.0) {
        const ev = obtainEmpireEvaluation(galaxy, empire, loser);
        ev.incidentEvaluation = 0.0;
        clearAll(ev);
        const ev2 = obtainEmpireEvaluation(galaxy, loser, empire);
        ev2.incidentEvaluation = Math.max(-5.0, ev2.incidentEvaluation);
        clearAll(ev2);
    } else if (winningRatio > 1.3) {
        const ev3 = obtainEmpireEvaluation(galaxy, empire, loser);
        ev3.incidentEvaluation = Math.max(-3.0, ev3.incidentEvaluation);
        clearAll(ev3);
        const ev4 = obtainEmpireEvaluation(galaxy, loser, empire);
        ev4.systemCompetitionCumulative = 0.0;
        ev4.covetousnessCumulative = 0.0;
        ev4.incidentEvaluation = Math.max(-8.0, ev4.incidentEvaluation);
    } else {
        const ev5 = obtainEmpireEvaluation(galaxy, empire, loser);
        ev5.incidentEvaluation = Math.max(-5.0, ev5.incidentEvaluation);
        ev5.systemCompetitionCumulative = 0.0;
        ev5.covetousnessCumulative = 0.0;
        const ev6 = obtainEmpireEvaluation(galaxy, loser, empire);
        ev6.incidentEvaluation = Math.max(-10.0, ev6.incidentEvaluation);
        ev6.systemCompetitionCumulative = 0.0;
        ev6.covetousnessCumulative = 0.0;
    }
}

/** Empire.3.cs 3383 ClearOutlawsFromEmpire(empire, outlawEmpire). */
function clearOutlawsFromEmpire(empire: Empire, outlawEmpire: Empire): void {
    const outlaws = empire.outlaws as BuiltObject[];
    const builtObjectList: BuiltObject[] = [];
    for (const outlaw of outlaws) {
        if (outlaw.empire === outlawEmpire) builtObjectList.push(outlaw);
    }
    for (const item of builtObjectList) {
        const i = outlaws.indexOf(item);
        if (i >= 0) outlaws.splice(i, 1);
    }
}

/** Empire.3.cs 3466 ProcessEndOfWarWithEmpire(empire). */
export function processEndOfWarWithEmpire(galaxy: Galaxy, self: Empire, empire: Empire): void {
    const diplomaticRelation = obtainDiplomaticRelation(self, empire);
    diplomaticRelation.warObjective = WarObjective.Undefined;
    diplomaticRelation.warObjectiveColonies.length = 0;
    diplomaticRelation.warObjectiveBases.length = 0;
    const diplomaticRelation2 = obtainDiplomaticRelation(empire, self);
    diplomaticRelation2.warObjective = WarObjective.Undefined;
    diplomaticRelation2.warObjectiveColonies.length = 0;
    diplomaticRelation2.warObjectiveBases.length = 0;
    const selfCharacters = getEmpireCharacters(self);
    const characterList: Character[] = [];
    characterList.push(...getCharactersByRole(selfCharacters, CharacterRole.FleetAdmiral));
    characterList.push(...getCharactersByRole(selfCharacters, CharacterRole.TroopGeneral));
    doCharacterEventRuntime(galaxy, CharacterEventType.WarEnded, empire, characterList, true, self);
    processRelationChange(self.diplomacyCounters, self, diplomaticRelation, self, DiplomaticRelationType.None, galaxyStarDate(galaxy), DiplomaticRelationType.War);
    // `if (SubjugatedDominion && Initiator != this) DoCharacterEventLeader(Subjugated, ...)`: Galaxy.1.cs 3756 passes an
    // empty source list, which DoCharacterEvent returns on (3783) — a no-op.
    diplomaticRelation.startDateOfLastChange = galaxyStarDate(galaxy);
    diplomaticRelation2.startDateOfLastChange = galaxyStarDate(galaxy);
    // Empire.3.cs 3443 CancelAttacksAgainstEmpire: ship / fleet attack missions (M4m) then ClearOutlawsFromEmpire.
    cancelAttackMissionsAgainstEmpire(galaxy, self, empire);
    clearOutlawsFromEmpire(self, empire);
    cancelBlockades(galaxy, self, empire);
    countEmpiresWeDeclaredWarOnNonLocked(self);
    countEmpiresWhoDeclaredWarOnUsNonLocked(self);
    clearOutlawsFromEmpire(self, empire); // Empire.3.cs 3490-3502 (the same removal, inline)
    const ri = self.recentAttackingEmpires.indexOf(empire);
    if (ri >= 0) self.recentAttackingEmpires.splice(ri, 1);
    const empireList = determineEmpiresWarOrConquer(self);
    const ei = empireList.indexOf(empire);
    if (ei >= 0) empireList.splice(ei, 1);
    checkAttackFleetTargets(galaxy, self, empireList);
    if (!checkAtWarExcluding(self, null)) {
        const empireList2 = resolveEmpiresToDefendAgainst(self);
        if (empireList2.length <= 0) clearDefendFleets(galaxy, self);
        else reviewDefensiveFleetLocations(galaxy, self);
    }
}

/** Empire.8.cs 2998 DetermineWhetherWantToEmancipate(relation, overallAttitude). */
function determineWhetherWantToEmancipate(self: Empire, relation: DiplomaticRelation, overallAttitude: number): boolean {
    const num = Math.trunc((friendlinessLevel(self) - aggressionLevel(self)) / 5.0);
    const num2 = 10 - num;
    if (overallAttitude > num2) {
        switch (relation.strategy) {
            case DiplomaticStrategy.Conquer:
            case DiplomaticStrategy.Defend:
            case DiplomaticStrategy.Undermine:
            case DiplomaticStrategy.DefendUndermine:
            case DiplomaticStrategy.Punish:
                return false;
            default:
                return true;
        }
    }
    return false;
}

/**
 * Empire.3.cs 3606 ConsiderTreatyProposals: answers the proposals other empires queued in _ProposedDiplomaticRelations.
 * Accepted treaties change both relation types directly (not through ChangeDiplomaticRelation).
 * Rnd: DetermineWhetherWantToOfferSubjugation (2 NextDouble) when a war-ending offer arrives from a loser.
 */
export function considerTreatyProposals(galaxy: Galaxy, empire: Empire): void {
    const self = empire;
    if (self.controlDiplomacyTreaties !== FULLY_AUTOMATED && self.controlDiplomacyOffense !== FULLY_AUTOMATED) return;
    const wmp = weightedMilitaryPotency(self);
    const mp = militaryPotency(self);
    const removals: DiplomaticRelation[] = [];
    const proposed = self.proposedDiplomaticRelations;
    if (proposed.count > 0) reviewDiplomaticStrategies(galaxy, self);
    const now = (): number => galaxyStarDate(galaxy);
    for (let i = 0; i < proposed.count; i++) {
        const dr = proposed.at(i);
        const thisEmpire = dr.thisEmpire!;
        const ev = obtainEmpireEvaluation(galaxy, self, thisEmpire);
        const wmp2 = weightedMilitaryPotency(thisEmpire);
        const mp2 = militaryPotency(thisEmpire);
        evaluateMilitaryPotency(galaxy, wmp, wmp2, thisEmpire);
        let dr2 = self.diplomaticRelations.byEmpire(thisEmpire);
        if (dr2 === null) {
            dr2 = new DiplomaticRelation(DiplomaticRelationType.NotMet, dr.initiator, self, thisEmpire, false);
            self.diplomaticRelations.add(dr2);
        }
        let dr3 = thisEmpire.diplomaticRelations.byEmpire(dr.otherEmpire);
        if (dr3 === null) {
            dr3 = new DiplomaticRelation(DiplomaticRelationType.NotMet, dr.initiator, thisEmpire, dr.otherEmpire, false);
            thisEmpire.diplomaticRelations.add(dr3);
        }
        dr3.lastDiplomacyTradeOfferDate = dr.lastDiplomacyTradeOfferDate;
        specialBonusDiplomacy(thisEmpire); // `_ = diplomaticRelation.ThisEmpire.SpecialBonusDiplomacy;`
        let flag = false;
        if (dr2.locked || dr3.locked) continue;
        const accept = (t: DiplomaticRelationType): void => {
            dr2!.type = t;
            dr2!.lastDiplomacyTradeOfferDate = dr.lastDiplomacyTradeOfferDate;
            dr3!.type = t;
            dr3!.lastDiplomacyTradeOfferDate = dr.lastDiplomacyTradeOfferDate;
        };
        if (dr.type === DiplomaticRelationType.None && dr2.type === DiplomaticRelationType.War && self.controlDiplomacyOffense === FULLY_AUTOMATED) {
            removals.push(dr);
            if (considerEndWar(galaxy, self, thisEmpire, false).end) {
                const v = determineVictorInWar(dr2);
                if (v.victor !== null && v.victor === self && determineWhetherWantToOfferSubjugation(galaxy, self, self) && determineSubjugationOfLoserInWar(v.victor, v.loser, v.winningRatio, militaryPotency(v.victor), militaryPotency(v.loser))) {
                    const dr4 = new DiplomaticRelation(DiplomaticRelationType.SubjugatedDominion, self, self, thisEmpire, now(), dr.supplyRestrictedResources);
                    thisEmpire.proposedDiplomaticRelations.add(dr4);
                    continue;
                }
                resetAttitudeLevelsAtEndOfWar(galaxy, dr2);
                accept(dr.type);
                flag = true;
                sendMessageToEmpire(self, thisEmpire, EmpireMessageType.AcceptDiplomaticRelation, DiplomaticRelationType.None, getText('We agree to end this war. We will cease hostilities immediately.'));
                processEndOfWarWithEmpire(galaxy, self, thisEmpire);
                processEndOfWarWithEmpire(galaxy, thisEmpire, self);
                todo(T_sendNewsBroadcast); // SendNewsBroadcastWarStartEnd(diplomaticRelation2)
                continue;
            }
        }
        if (dr.type === DiplomaticRelationType.SubjugatedDominion && !dr2.locked) {
            if (dr2.type === DiplomaticRelationType.War) {
                if (self.controlDiplomacyOffense === FULLY_AUTOMATED) {
                    removals.push(dr);
                    const v2 = determineVictorInWar(dr);
                    if (v2.victor !== self) {
                        if (determineSubjugationOfLoserInWar(v2.victor, v2.loser, v2.winningRatio, militaryPotency(v2.victor), militaryPotency(self))) {
                            resetAttitudeLevelsAtEndOfWar(galaxy, dr2);
                            accept(DiplomaticRelationType.SubjugatedDominion);
                            dr2.initiator = thisEmpire;
                            dr3.initiator = thisEmpire;
                            flag = true;
                            sendMessageToEmpire(self, thisEmpire, EmpireMessageType.AcceptDiplomaticRelation, DiplomaticRelationType.SubjugatedDominion, getText('We accept defeat and acknowledge your status as our ruler.'));
                            processEndOfWarWithEmpire(galaxy, self, thisEmpire);
                            processEndOfWarWithEmpire(galaxy, thisEmpire, self);
                            const num = LONG_MAX_VALUE;
                            const num2 = thisEmpire.empiresViewable.indexOf(self);
                            if (num2 >= 0) {
                                thisEmpire.empiresViewableExpiry[num2] = num;
                            } else {
                                thisEmpire.empiresViewable.push(self);
                                thisEmpire.empiresViewableExpiry.push(num);
                            }
                            todo(T_sendNewsBroadcast); // SendNewsBroadcastWarStartEnd(diplomaticRelation2)
                            // _Galaxy.DoCharacterEventLeader(Subjugated, ...): empty source list → no-op (Galaxy.1.cs 3756/3783).
                        } else {
                            sendMessageToEmpire(self, thisEmpire, EmpireMessageType.RefuseDiplomaticRelation, DiplomaticRelationType.SubjugatedDominion, getText('We refuse to become your slaves - we will fight on.'));
                        }
                    } else {
                        sendMessageToEmpire(self, thisEmpire, EmpireMessageType.RefuseDiplomaticRelation, DiplomaticRelationType.SubjugatedDominion, getText('We will not accede to your outrageous demand for subjugation!'));
                    }
                    continue;
                }
            } else if (self.controlDiplomacyTreaties === FULLY_AUTOMATED) {
                removals.push(dr);
                sendMessageToEmpire(self, thisEmpire, EmpireMessageType.RefuseDiplomaticRelation, DiplomaticRelationType.SubjugatedDominion, getText('We will not accede to your outrageous demand for subjugation!'));
                ev.incidentEvaluation = ev.incidentEvaluationRaw - 12.0;
                continue;
            }
        }
        const desired = determineDesiredDiplomaticRelationTypical(dr2.strategy, dr2.type);
        const flag2 = dr2.type === DiplomaticRelationType.TradeSanctions;
        const hyper = (): boolean => checkEmpireHasHyperDriveTech(self) || checkEmpireHasHyperDriveTech(thisEmpire);
        const acceptTreaty = (): void => {
            dr2!.type = dr.type;
            dr2!.lastDiplomacyTradeOfferDate = dr.lastDiplomacyTradeOfferDate;
            dr2!.startDateOfLastChange = now();
            dr3!.type = dr.type;
            dr3!.lastDiplomacyTradeOfferDate = dr.lastDiplomacyTradeOfferDate;
            dr3!.startDateOfLastChange = now();
        };
        if (dr.type === DiplomaticRelationType.MutualDefensePact && !dr2.locked) {
            if (self.controlDiplomacyTreaties === FULLY_AUTOMATED) {
                removals.push(dr);
                if (!self.reclusive && hyper()) {
                    const num3 = mp / mp2;
                    if (num3 > 5.0) {
                        if (desired === DiplomaticRelationType.MutualDefensePact || desired === DiplomaticRelationType.Protectorate) {
                            const dr5 = new DiplomaticRelation(DiplomaticRelationType.Protectorate, self, self, thisEmpire, now(), dr.supplyRestrictedResources);
                            thisEmpire.proposedDiplomaticRelations.add(dr5);
                            continue;
                        }
                    } else if (desired === DiplomaticRelationType.MutualDefensePact) {
                        acceptTreaty();
                        dr2.militaryRefuelingToOther = true;
                        dr3.militaryRefuelingToOther = true;
                        if (flag2) {
                            cancelBlockades(galaxy, self, thisEmpire);
                            cancelBlockades(galaxy, thisEmpire, self);
                        }
                        flag = true;
                        setEmpireSharedVisibility(galaxy, self, thisEmpire);
                        setEmpireSharedVisibility(galaxy, thisEmpire, self);
                        sendMessageToEmpire(self, thisEmpire, EmpireMessageType.AcceptDiplomaticRelation, dr.type, getText('We graciously accept your magnanimous treaty proposal!'));
                        continue;
                    }
                }
            }
        } else if (dr.type === DiplomaticRelationType.Protectorate && !dr2.locked && self.controlDiplomacyTreaties === FULLY_AUTOMATED) {
            removals.push(dr);
            if (!self.reclusive && (desired === DiplomaticRelationType.MutualDefensePact || desired === DiplomaticRelationType.Protectorate) && hyper()) {
                acceptTreaty();
                dr2.initiator = dr.initiator;
                dr3.initiator = dr.initiator;
                dr2.militaryRefuelingToOther = true;
                dr3.militaryRefuelingToOther = true;
                if (flag2) {
                    cancelBlockades(galaxy, self, thisEmpire);
                    cancelBlockades(galaxy, thisEmpire, self);
                }
                flag = true;
                setEmpireSharedVisibility(galaxy, self, thisEmpire);
                setEmpireSharedVisibility(galaxy, thisEmpire, self);
                sendMessageToEmpire(self, thisEmpire, EmpireMessageType.AcceptDiplomaticRelation, dr.type, getText('We graciously accept your magnanimous treaty proposal!'));
                continue;
            }
        }
        if (self.controlDiplomacyTreaties === FULLY_AUTOMATED) {
            if (dr2.type === DiplomaticRelationType.SubjugatedDominion && dr2.initiator === self && dr.type === DiplomaticRelationType.None && !dr2.locked) {
                if (determineWhetherWantToEmancipate(self, dr2, ev.overallAttitude)) {
                    acceptTreaty();
                    if (flag2) {
                        cancelBlockades(galaxy, self, thisEmpire);
                        cancelBlockades(galaxy, thisEmpire, self);
                    }
                    const num4 = self.empiresViewable.indexOf(thisEmpire);
                    if (num4 >= 0) {
                        self.empiresViewable.splice(num4, 1);
                        self.empiresViewableExpiry.splice(num4, 1);
                    }
                    flag = true;
                    sendMessageToEmpire(self, thisEmpire, EmpireMessageType.AcceptDiplomaticRelation, dr.type, getText('We agree to free you from subjugation to us.'));
                    // (Not added to the removal list — Empire.3.cs 3818 `continue`s before any Add; the proposal is answered
                    // again next time. C# quirk kept.)
                    continue;
                }
            } else {
                let flag3 = false;
                if (
                    dr.type === DiplomaticRelationType.FreeTradeAgreement &&
                    !dr2.locked &&
                    hyper() &&
                    dr2.type !== DiplomaticRelationType.FreeTradeAgreement &&
                    (desired === DiplomaticRelationType.FreeTradeAgreement || desired === DiplomaticRelationType.MutualDefensePact || desired === DiplomaticRelationType.Protectorate)
                ) {
                    removals.push(dr);
                    if (!self.reclusive) flag3 = true;
                }
                if (flag3) {
                    const drType = dr.type as DiplomaticRelationType;
                    if (drType === DiplomaticRelationType.MutualDefensePact || drType === DiplomaticRelationType.Protectorate) {
                        setEmpireSharedVisibility(galaxy, thisEmpire, self);
                        setEmpireSharedVisibility(galaxy, self, thisEmpire);
                    } else if (dr2.type === DiplomaticRelationType.MutualDefensePact || dr2.type === DiplomaticRelationType.Protectorate) {
                        if ((drType as number) !== DiplomaticRelationType.Protectorate && (drType as number) !== DiplomaticRelationType.MutualDefensePact) {
                            clearEmpireSharedVisibility(galaxy, thisEmpire, self);
                            clearEmpireSharedVisibility(galaxy, self, thisEmpire);
                        }
                    } else if (drType === DiplomaticRelationType.FreeTradeAgreement) {
                        const o = dr2.otherEmpire!;
                        if (!checkWhetherKnowAnySystemsOfOtherEmpire(galaxy, o, self)) {
                            const habitat = fastFindNearestColony(galaxy, Math.trunc(o.capital!.xpos), Math.trunc(o.capital!.ypos), self, 0);
                            if (habitat !== null) {
                                const status = o.systemVisibility[habitat.systemIndex].status;
                                if (status !== SystemVisibilityStatus.Visible) o.visibility.setSystemVisibility(habitat, SystemVisibilityStatus.Explored);
                            }
                        }
                        if (!checkWhetherKnowAnySystemsOfOtherEmpire(galaxy, self, o)) {
                            const habitat2 = fastFindNearestColony(galaxy, Math.trunc(self.capital!.xpos), Math.trunc(self.capital!.ypos), o, 0);
                            if (habitat2 !== null) {
                                const status2 = self.systemVisibility[habitat2.systemIndex].status;
                                if (status2 !== SystemVisibilityStatus.Visible) self.visibility.setSystemVisibility(habitat2, SystemVisibilityStatus.Explored);
                            }
                        }
                    }
                    acceptTreaty();
                    if (flag2) {
                        cancelBlockades(galaxy, self, thisEmpire);
                        cancelBlockades(galaxy, thisEmpire, self);
                    }
                    flag = true;
                    sendMessageToEmpire(self, thisEmpire, EmpireMessageType.AcceptDiplomaticRelation, dr.type, getText('We graciously accept your magnanimous treaty proposal!'));
                    continue;
                }
            }
        }
        if (!flag) {
            removals.push(dr);
            sendMessageToEmpire(self, thisEmpire, EmpireMessageType.RefuseDiplomaticRelation, dr.type, getText('We reject your treaty proposal'));
        }
    }
    for (const item of removals) proposed.remove(item);
}

// Empire.7.cs 2060 ReviewEnemyHelpEnlistment / 2205 ReviewDisputedTerritory live with the trade subsystem (tradeItems.ts).
export { reviewEnemyHelpEnlistment, reviewDisputedTerritory } from './tradeItems';
