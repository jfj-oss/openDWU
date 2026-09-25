// M4z4: achievements, empire score, battle-stats reporting and the game-stats XML (no Steam, no file I/O).
//
// Ports:
//   Achievement.cs, AchievementList.cs, AchievementType.cs, GameSummary.cs (model);
//   Galaxy.1.cs 2852-3754: CalculateEmpireScore, DetermineGameSummary, ReviewAchievements,
//   ReviewAchievementsForEmpire, ResolveAchievementMedalImageIndex, DetermineAchievementValueForLevel,
//   DetermineAchievementLevel, ResolveAchievementTitleComplete, ResolveAchievementLevelDescription,
//   ResolveDescription(Achievement), ResolveTitle(AchievementType, object), CalculateHighestMiningVolume,
//   CalculateHighestTradeVolume;
//   Empire.1.cs 3969 UpdateAchievements, with SteamAPI.cs 105 SetAchievementIfNecessary / 134
//   ResolveAchievementName replaced by a local record (Galaxy.unlockedAchievementNames);
//   BaconBuiltObject.cs 2109 ShowStats (the report text; the message box / pause is UI) and 2166
//   CalculateCrewLevel;
//   BaconMain.cs 557-600 (the SaveStats file names / empty documents), 1145 / 1170 ProcessGameStats, 1242
//   FindValueForThisNode as a pure XML text → XML text transform (the desktop shell reads / writes the files).
//
// No Galaxy.Rnd draws in this file.

import type { Galaxy } from './galaxy';
import type { Empire } from './empire';
import type { Race } from './data/races';
import type { BuiltObject } from './builtObject';
import { BuiltObjectRole } from './data/designSpecifications';
import { BuiltObjectSubRole } from './builtObjectTypes';
import { DiplomaticRelationType, obtainDiplomaticRelation } from './diplomacy';
import { identifyMechanoidEmpire } from './fleets/militaryAI';
import { identifyShakturiEmpire, getText, formatText } from './diplomacyTick';
import { privateAnnualRevenue, calculateAccurateAnnualIncome } from './forceStructure';
import { militaryPotency } from './treasury';
import { cumulateFacilityValue1, averageHappiness } from './characterRuntime';
import { countFacilities } from './construction/facilities';
import { PlanetaryFacilityType } from './researchSystem';
import { DEFAULT_BASE_TECH_COST } from './componentStatic';
import { galaxyStarDate, REAL_SECONDS_IN_GALACTIC_YEAR } from './tick/simTime';
import { startStarDateForAge } from './galaxyTime';
import { empireGovernmentAttributes, getGovernmentsStatic } from './empire';
import { calculateRaceVictoryConditionsProgress, calculatePirateControlPopulationValue, calculateTotalCostResearchedProjects, timeSpentAtWar, intelligenceCounter } from './victory';
import { addLatestCombatStats, SpaceBattleStats } from './combat/damage';

// ---------------------------------------------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------------------------------------------

/** AchievementType.cs (byte enum, C# member order). */
export enum AchievementType {
    Undefined,
    AchieveAllRaceVictoryConditions,
    DestroyEnemyMilitaryShipsAndBases,
    DestroyEnemyCivilianShipsAndBases,
    DestroyEnemyTroops,
    DestroySpaceMonsters,
    DestroySilverMists,
    ConquerEnemyColonies,
    SuccessfulIntelligenceMissions,
    StartWars,
    BreakTreaties,
    EliminateEnemyCharacters,
    EliminateEnemyEmpires,
    HighestTradeIncome,
    HighestMiningVolume,
    CaptureEnemyShips,
    EliminatePirateFactions,
    SpendAllTimeAtWar,
    SpendNoTimeAtWar,
    SuccessfulRaids,
    ChangeGovernmentToWayOfDarkness,
    ChangeGovernmentToWayOfTheAncients,
    EmpireSplits,
    BuildWonders,
    OwnOperationalPlanetDestroyer,
    JoinTheFreedomAlliance,
    JoinTheShakturi,
    DefeatAncients,
    DefeatShakturi,
    DefeatLegendaryPirates,
}

/** Achievement.cs. AdditionalData is the Race for AchieveAllRaceVictoryConditions, else null. */
export class Achievement {
    constructor(
        public type: AchievementType,
        public value: number,
        public additionalData: Race | null,
    ) {}
}

/** AchievementList.cs 14 ContainsType. */
export function achievementListContainsType(list: readonly Achievement[], type: AchievementType): boolean {
    for (let index = 0; index < list.length; ++index) {
        const achievement = list[index];
        if (achievement != null && achievement.type === type) return true;
    }
    return false;
}

/** AchievementList.cs 25 GetFirstByType. */
export function achievementListGetFirstByType(list: readonly Achievement[], type: AchievementType): Achievement | null {
    for (let index = 0; index < list.length; ++index) {
        const firstByType = list[index];
        if (firstByType != null && firstByType.type === type) return firstByType;
    }
    return null;
}

/** AchievementList.cs 36 AddIfNotExistsOrBetter. */
export function achievementListAddIfNotExistsOrBetter(list: Achievement[], achievement: Achievement): void {
    let flag = true;
    for (let index = 0; index < list.length; ++index) {
        const achievement1 = list[index];
        if (achievement1 != null && achievement1.type === achievement.type && achievement1.value >= achievement.value) {
            flag = false;
            break;
        }
    }
    if (!flag) return;
    list.push(achievement);
}

/** GameSummary.cs. */
export class GameSummary {
    galaxyStarCount = 0;
    difficultyLevel = 0.0;
    playerRace: Race | null = null;
    playerGovernmentName = '';
    playerEmpireName = '';
    /** Color as 0xRRGGBB. */
    playerMainColor = 0;
    playerScore = 0;
    playerVictory = false;
    playerAchievements: Achievement[] = [];
}

// ---------------------------------------------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------------------------------------------

export interface EmpireScore {
    score: number;
    population: number;
    economy: number;
    colonies: number;
    military: number;
    research: number;
    wonders: number;
}

/**
 * Galaxy.1.cs 2852 / 2863 CalculateEmpireScore(empire[, out population, economy, colonies, military, research, wonders]).
 * BaseTechCost: the TS Galaxy keeps no baseTechCost (Start.2.cs game option) — DEFAULT_BASE_TECH_COST, as
 * designGeneration.ts / builtObject.ts do.
 */
export function calculateEmpireScore(galaxy: Galaxy, empire: Empire | null): EmpireScore {
    const s: EmpireScore = { score: 0, population: 0, economy: 0, colonies: 0, military: 0, research: 0, wonders: 0 };
    if (empire !== null) {
        // (int)(CalculateTotalCostResearchedProjects() / (float)BaseTechCost * 20f): float arithmetic.
        const researchScore = (): number => {
            const r = Math.trunc(Math.fround(Math.fround(calculateTotalCostResearchedProjects(empire.research.techTree) / Math.fround(DEFAULT_BASE_TECH_COST)) * 20));
            return Math.max(0, Math.min(1000000, r));
        };
        if (empire.pirateEmpireBaseHabitat === null) {
            s.population = Math.trunc(Math.trunc(empire.totalPopulation / 1000000));
            s.economy = Math.trunc(privateAnnualRevenue(galaxy, empire) / 10.0);
            s.colonies = empire.colonies.length * 1000;
            s.military = militaryPotency(galaxy, empire) * 5;
            s.research = researchScore();
            s.wonders = cumulateFacilityValue1(empire, PlanetaryFacilityType.Wonder, true) * 100;
        } else {
            s.population = Math.trunc(Math.trunc(calculatePirateControlPopulationValue(empire) / 1000000));
            let num = 0.0;
            if (empire.pirateEconomy != null) {
                if (empire.pirateEconomy.lastYear !== null) {
                    num = empire.pirateEconomy.lastYear.totalIncome;
                } else if (empire.pirateEconomy.thisYear != null) {
                    num = empire.pirateEconomy.thisYear.totalIncome;
                }
            }
            s.economy = Math.trunc(num / 10.0);
            s.colonies = empire.colonies.length * 1000;
            s.military = militaryPotency(galaxy, empire) * 5;
            s.research = researchScore();
            s.wonders += countFacilities(empire, PlanetaryFacilityType.PirateBase, true) * 1000;
            s.wonders += countFacilities(empire, PlanetaryFacilityType.PirateFortress, true) * 2000;
            s.wonders += countFacilities(empire, PlanetaryFacilityType.PirateCriminalNetwork, true) * 5000;
        }
        s.score = (s.population + s.economy + s.colonies + s.military + s.research + s.wonders) | 0;
    }
    return s;
}

/** Galaxy.1.cs 2913 DetermineGameSummary. */
export function determineGameSummary(galaxy: Galaxy): GameSummary {
    const gameSummary = new GameSummary();
    gameSummary.difficultyLevel = galaxy.difficultyLevel;
    gameSummary.galaxyStarCount = galaxy.starCount;
    const playerEmpire = galaxy.playerEmpire;
    if (playerEmpire !== null) {
        gameSummary.playerAchievements = playerEmpire.achievements;
        gameSummary.playerEmpireName = playerEmpire.name;
        const governments = getGovernmentsStatic();
        if (playerEmpire.governmentId >= 0 && playerEmpire.governmentId < governments.length) {
            const governmentAttributes = governments[playerEmpire.governmentId];
            gameSummary.playerGovernmentName = governmentAttributes !== null ? governmentAttributes.name : '';
        }
        gameSummary.playerMainColor = playerEmpire.mainColor;
        gameSummary.playerRace = playerEmpire.dominantRace;
        gameSummary.playerScore = calculateEmpireScore(galaxy, playerEmpire).score;
    }
    return gameSummary;
}

// ---------------------------------------------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------------------------------------------

/** Galaxy.1.cs 2935 ReviewAchievements: every normal and pirate empire's achievement list and score (long block). */
export function reviewAchievements(galaxy: Galaxy): void {
    for (let i = 0; i < galaxy.empires.length; i++) {
        const empire = galaxy.empires[i];
        if (empire != null && empire.counters != null) {
            empire.achievements = reviewAchievementsForEmpire(galaxy, empire);
            empire.score = calculateEmpireScore(galaxy, empire).score;
        }
    }
    for (let j = 0; j < galaxy.pirateEmpires.length; j++) {
        const empire2 = galaxy.pirateEmpires[j];
        if (empire2 != null && empire2.counters != null) {
            empire2.achievements = reviewAchievementsForEmpire(galaxy, empire2);
            empire2.score = calculateEmpireScore(galaxy, empire2).score;
        }
    }
}

/** Galaxy.1.cs 2957 ReviewAchievementsForEmpire(empire): the thresholds of every AchievementType. */
export function reviewAchievementsForEmpire(galaxy: Galaxy, empire: Empire | null): Achievement[] {
    const achievementList: Achievement[] = [];
    if (empire !== null && empire.counters != null) {
        const counters = empire.counters;
        const year = REAL_SECONDS_IN_GALACTIC_YEAR * 1000;
        // 2963-2967: ActualStartDate => _StartStarDate; more than 10 game years played.
        let flag = false;
        const num = galaxyStarDate(galaxy) - startStarDateForAge(galaxy.age);
        if (num > year * 10) flag = true;
        if (galaxy.gameRaceSpecificVictoryConditionsEnabled) {
            const num2 = calculateRaceVictoryConditionsProgress(galaxy, empire, empire.dominantRace).progress;
            if (num2 >= 1.0) achievementList.push(new Achievement(AchievementType.AchieveAllRaceVictoryConditions, 0, empire.dominantRace));
        }
        if (counters.destroyedEnemyMilitaryShipCount >= 50) achievementList.push(new Achievement(AchievementType.DestroyEnemyMilitaryShipsAndBases, counters.destroyedEnemyMilitaryShipCount, null));
        if (counters.destroyedEnemyCivilianShipCount >= 50) achievementList.push(new Achievement(AchievementType.DestroyEnemyCivilianShipsAndBases, counters.destroyedEnemyCivilianShipCount, null));
        if (counters.destroyedEnemyTroopCount >= 50) achievementList.push(new Achievement(AchievementType.DestroyEnemyTroops, counters.destroyedEnemyTroopCount, null));
        const num3 = counters.destroyedCreatureCountArdilus + counters.destroyedCreatureCountKaltor + counters.destroyedCreatureCountSandSlug + counters.destroyedCreatureCountSpaceSlug;
        if (num3 >= 20) achievementList.push(new Achievement(AchievementType.DestroySpaceMonsters, num3, null));
        if (counters.destroyedCreatureCountSilverMist >= 10) achievementList.push(new Achievement(AchievementType.DestroySilverMists, counters.destroyedCreatureCountSilverMist, null));
        if (counters.coloniesConqueredCount >= 10) achievementList.push(new Achievement(AchievementType.ConquerEnemyColonies, counters.coloniesConqueredCount, null));
        const num4 = intelligenceCounter(empire, 'intelligenceMissionSuccessEspionageCount') + intelligenceCounter(empire, 'intelligenceMissionSuccessSabotageCount');
        if (num4 >= 25) achievementList.push(new Achievement(AchievementType.SuccessfulIntelligenceMissions, num4, null));
        if (empire.diplomacyCounters.warsWeStartedCount >= 20) achievementList.push(new Achievement(AchievementType.StartWars, empire.diplomacyCounters.warsWeStartedCount, null));
        if (empire.diplomacyCounters.brokenTreatyCount >= 20) achievementList.push(new Achievement(AchievementType.BreakTreaties, empire.diplomacyCounters.brokenTreatyCount, null));
        if (counters.killEnemyCharactersCount >= 20) achievementList.push(new Achievement(AchievementType.EliminateEnemyCharacters, counters.killEnemyCharactersCount, null));
        if (counters.eliminateEmpireCount >= 1) achievementList.push(new Achievement(AchievementType.EliminateEnemyEmpires, counters.eliminateEmpireCount, null));
        if (counters.eliminatePirateEmpireCount >= 5) achievementList.push(new Achievement(AchievementType.EliminatePirateFactions, counters.eliminatePirateEmpireCount, null));
        const num5 = calculateHighestTradeVolume(galaxy);
        if (counters.tradeIncomeTotalVolume >= num5 && counters.tradeIncomeTotalVolume > 0.0 && flag) {
            // Math.Min(int.MaxValue, (int)TradeIncomeTotalVolume): the (int) cast of a double above int range is
            // int.MinValue in the C# (unchecked); | 0 wraps instead — only differs past 2^31 trade volume.
            const value = Math.min(2147483647, Math.trunc(counters.tradeIncomeTotalVolume) | 0);
            achievementList.push(new Achievement(AchievementType.HighestTradeIncome, value, null));
        }
        const num6 = calculateHighestMiningVolume(galaxy);
        const num7 = (counters.miningExtractionGas + counters.miningExtractionLuxury + counters.miningExtractionStrategic) | 0;
        if (num7 >= num6 && num7 > 0 && flag) achievementList.push(new Achievement(AchievementType.HighestMiningVolume, num7, null));
        if (counters.captureShipCount >= 10) achievementList.push(new Achievement(AchievementType.CaptureEnemyShips, counters.captureShipCount, null));
        // 3053-3066: share of the game spent at war (_StartStarDate again).
        const currentStarDate = galaxyStarDate(galaxy);
        const num8 = timeSpentAtWar(empire.diplomacyCounters, currentStarDate);
        const num9 = currentStarDate - startStarDateForAge(galaxy.age);
        const num10 = num8 / num9;
        if (num10 >= 0.9 && flag) {
            achievementList.push(new Achievement(AchievementType.SpendAllTimeAtWar, 0, null));
        } else if (num10 <= 0.0 && flag) {
            achievementList.push(new Achievement(AchievementType.SpendNoTimeAtWar, 0, null));
        }
        if (counters.raidSuccessCount >= 10) achievementList.push(new Achievement(AchievementType.SuccessfulRaids, counters.raidSuccessCount, null));
        const num11 = countFacilities(empire, PlanetaryFacilityType.Wonder, true);
        if (num11 >= 1) achievementList.push(new Achievement(AchievementType.BuildWonders, num11, null));
        // 3076-3097: an operational planet destroyer (capital ship with component 25) is remembered once earned.
        if (achievementListContainsType(empire.achievements, AchievementType.OwnOperationalPlanetDestroyer)) {
            achievementList.push(new Achievement(AchievementType.OwnOperationalPlanetDestroyer, 0, null));
        } else {
            let num12 = 0;
            for (let i = 0; i < empire.builtObjects.length; i++) {
                const builtObject = empire.builtObjects[i];
                if (builtObject != null && builtObject.unbuiltComponentCount <= 0 && builtObject.subRole === BuiltObjectSubRole.CapitalShip && builtObject.components.containsComponentId(25)) num12++;
            }
            if (num12 > 0) achievementList.push(new Achievement(AchievementType.OwnOperationalPlanetDestroyer, num12, null));
        }
        if (achievementListContainsType(empire.achievements, AchievementType.JoinTheFreedomAlliance)) {
            achievementList.push(new Achievement(AchievementType.JoinTheFreedomAlliance, 0, null));
        } else {
            const empire2 = identifyMechanoidEmpire(galaxy);
            if (empire2 !== null && empire.pirateEmpireBaseHabitat === null) {
                const diplomaticRelation = obtainDiplomaticRelation(empire, empire2);
                if (diplomaticRelation != null && diplomaticRelation.type === DiplomaticRelationType.MutualDefensePact && diplomaticRelation.locked) achievementList.push(new Achievement(AchievementType.JoinTheFreedomAlliance, 0, null));
            }
        }
        if (achievementListContainsType(empire.achievements, AchievementType.JoinTheShakturi)) {
            achievementList.push(new Achievement(AchievementType.JoinTheShakturi, 0, null));
        } else {
            const empire3 = identifyShakturiEmpire(galaxy);
            if (empire3 !== null && empire.pirateEmpireBaseHabitat === null) {
                const diplomaticRelation2 = obtainDiplomaticRelation(empire, empire3);
                if (diplomaticRelation2 != null && diplomaticRelation2.type === DiplomaticRelationType.MutualDefensePact) achievementList.push(new Achievement(AchievementType.JoinTheShakturi, 0, null));
            }
        }
        if (empire.empireSplitCount > 0) achievementList.push(new Achievement(AchievementType.EmpireSplits, empire.empireSplitCount, null));
        if (empire.haveDefeatedAncientGuardians) achievementList.push(new Achievement(AchievementType.DefeatAncients, 0, null));
        if (empire.haveDefeatedShakturi) achievementList.push(new Achievement(AchievementType.DefeatShakturi, 0, null));
        if (empire.defeatedLegendaryPiratesCount > 0) achievementList.push(new Achievement(AchievementType.DefeatLegendaryPirates, empire.defeatedLegendaryPiratesCount, null));
        const governmentAttributes = empireGovernmentAttributes(empire);
        if (governmentAttributes !== null && governmentAttributes.availability === 3) achievementList.push(new Achievement(AchievementType.ChangeGovernmentToWayOfDarkness, 0, null));
        if (governmentAttributes !== null && governmentAttributes.availability === 2) achievementList.push(new Achievement(AchievementType.ChangeGovernmentToWayOfTheAncients, 0, null));
    }
    return achievementList;
}

/** Galaxy.1.cs 3724 CalculateHighestMiningVolume (int sums, normal empires only). */
export function calculateHighestMiningVolume(galaxy: Galaxy): number {
    let num = 0;
    for (let i = 0; i < galaxy.empires.length; i++) {
        const empire = galaxy.empires[i];
        if (empire != null && empire.counters != null) {
            const num2 = (empire.counters.miningExtractionGas + empire.counters.miningExtractionLuxury + empire.counters.miningExtractionStrategic) | 0;
            if (num2 > num) num = num2;
        }
    }
    return num;
}

/** Galaxy.1.cs 3742 CalculateHighestTradeVolume. */
export function calculateHighestTradeVolume(galaxy: Galaxy): number {
    let num = 0.0;
    for (let i = 0; i < galaxy.empires.length; i++) {
        const empire = galaxy.empires[i];
        if (empire != null && empire.counters != null && empire.counters.tradeIncomeTotalVolume > num) num = empire.counters.tradeIncomeTotalVolume;
    }
    return num;
}

/**
 * Empire.1.cs 3969 UpdateAchievements: merge the current review into the empire's list (keeping the best value per
 * type); for the player every reviewed achievement goes to SteamAPI.SetAchievementIfNecessary — recorded locally.
 */
export function updateAchievements(galaxy: Galaxy, empire: Empire): void {
    if (empire.achievements == null) empire.achievements = [];
    const achievementList = reviewAchievementsForEmpire(galaxy, empire);
    for (let i = 0; i < achievementList.length; i++) {
        const achievement = achievementList[i];
        if (achievement == null) continue;
        const firstByType = achievementListGetFirstByType(empire.achievements, achievement.type);
        if (firstByType !== null) {
            if (achievement.value > firstByType.value) firstByType.value = achievement.value;
        } else {
            empire.achievements.push(achievement);
        }
        if (empire === galaxy.playerEmpire) setAchievementIfNecessary(galaxy, achievement);
    }
}

/**
 * SteamAPI.cs 105 SetAchievementIfNecessary(achievement): Steam's `ach.Trigger(true)` for the achievement named
 * ResolveAchievementName(achievement) (empty for AchieveAllRaceVictoryConditions → nothing). Recorded once in
 * Galaxy.unlockedAchievementNames instead (the Steam call is idempotent too).
 */
export function setAchievementIfNecessary(galaxy: Galaxy, achievement: Achievement | null): void {
    if (achievement === null) return;
    const achievementName = resolveAchievementName(achievement);
    if (achievementName === '') return;
    if (!galaxy.unlockedAchievementNames.includes(achievementName)) galaxy.unlockedAchievementNames.push(achievementName);
}

/** SteamAPI.cs 134 ResolveAchievementName: Galaxy.ResolveDescription(achievement) except for AchieveAllRaceVictoryConditions. */
export function resolveAchievementName(achievement: Achievement | null): string {
    let str = '';
    if (achievement !== null && achievement.type !== AchievementType.AchieveAllRaceVictoryConditions) str = resolveAchievementDescription(achievement);
    return str;
}

/** Galaxy.1.cs 3144 ResolveAchievementMedalImageIndex(achievementType, level). */
export function resolveAchievementMedalImageIndex(achievementType: AchievementType, level: number): number {
    const A = AchievementType;
    let num = 0;
    if (level > 0) level--;
    switch (achievementType) {
        case A.AchieveAllRaceVictoryConditions: num = 0; break;
        case A.DestroyEnemyMilitaryShipsAndBases: num = 1; break;
        case A.DestroyEnemyCivilianShipsAndBases: num = 4; break;
        case A.DestroyEnemyTroops: num = 7; break;
        case A.DestroySpaceMonsters: num = 10; break;
        case A.DestroySilverMists: num = 13; break;
        case A.ConquerEnemyColonies: num = 16; break;
        case A.StartWars: num = 19; break;
        case A.BreakTreaties: num = 20; break;
        case A.EliminateEnemyCharacters: num = 21; break;
        case A.EliminateEnemyEmpires: num = 24; break;
        case A.HighestTradeIncome: num = 27; break;
        case A.HighestMiningVolume: num = 28; break;
        case A.CaptureEnemyShips: num = 29; break;
        case A.EliminatePirateFactions: num = 32; break;
        case A.SpendAllTimeAtWar: num = 35; break;
        case A.SpendNoTimeAtWar: num = 36; break;
        case A.SuccessfulRaids: num = 37; break;
        case A.ChangeGovernmentToWayOfDarkness: num = 40; break;
        case A.ChangeGovernmentToWayOfTheAncients: num = 41; break;
        case A.EmpireSplits: num = 42; break;
        case A.BuildWonders: num = 43; break;
        case A.OwnOperationalPlanetDestroyer: num = 46; break;
        case A.JoinTheFreedomAlliance: num = 47; break;
        case A.JoinTheShakturi: num = 48; break;
        case A.DefeatAncients: num = 49; break;
        case A.DefeatShakturi: num = 50; break;
        case A.DefeatLegendaryPirates: num = 51; break;
        case A.SuccessfulIntelligenceMissions: num = 52; break;
    }
    return num + level;
}

/** Galaxy.1.cs 3244 DetermineAchievementValueForLevel(achievementType, level). */
export function determineAchievementValueForLevel(achievementType: AchievementType, level: number): number {
    const A = AchievementType;
    const pick = (l1: number, l2: number, l3: number): number => (level === 1 ? l1 : level === 2 ? l2 : level === 3 ? l3 : 0);
    switch (achievementType) {
        case A.DestroyEnemyMilitaryShipsAndBases:
        case A.DestroyEnemyCivilianShipsAndBases:
        case A.DestroyEnemyTroops:
            return pick(50, 100, 1000);
        case A.DestroySpaceMonsters:
        case A.EliminateEnemyCharacters:
            return pick(20, 50, 100);
        case A.DestroySilverMists:
        case A.ConquerEnemyColonies:
        case A.CaptureEnemyShips:
        case A.SuccessfulRaids:
            return pick(10, 50, 100);
        case A.SuccessfulIntelligenceMissions:
            return pick(25, 100, 1000);
        case A.EliminateEnemyEmpires:
        case A.BuildWonders:
            return pick(1, 5, 10);
        case A.EliminatePirateFactions:
            return pick(5, 10, 20);
        default:
            return 0;
    }
}

/** Galaxy.1.cs 3347 DetermineAchievementLevel(achievementType, value): 1-3 by the thresholds above (0 below level 1). */
export function determineAchievementLevel(achievementType: AchievementType, value: number): number {
    const A = AchievementType;
    const tiers = (t1: number, t2: number, t3: number): number => (value >= t3 ? 3 : value >= t2 ? 2 : value >= t1 ? 1 : 0);
    switch (achievementType) {
        case A.AchieveAllRaceVictoryConditions:
        case A.StartWars:
        case A.BreakTreaties:
        case A.HighestTradeIncome:
        case A.HighestMiningVolume:
        case A.SpendAllTimeAtWar:
        case A.SpendNoTimeAtWar:
        case A.ChangeGovernmentToWayOfDarkness:
        case A.ChangeGovernmentToWayOfTheAncients:
        case A.EmpireSplits:
        case A.OwnOperationalPlanetDestroyer:
        case A.JoinTheFreedomAlliance:
        case A.JoinTheShakturi:
        case A.DefeatAncients:
        case A.DefeatShakturi:
        case A.DefeatLegendaryPirates:
            return 1;
        case A.DestroyEnemyMilitaryShipsAndBases:
        case A.DestroyEnemyCivilianShipsAndBases:
        case A.DestroyEnemyTroops:
            return tiers(50, 100, 1000);
        case A.DestroySpaceMonsters:
        case A.EliminateEnemyCharacters:
            return tiers(20, 50, 100);
        case A.DestroySilverMists:
        case A.ConquerEnemyColonies:
        case A.CaptureEnemyShips:
        case A.SuccessfulRaids:
            return tiers(10, 50, 100);
        case A.SuccessfulIntelligenceMissions:
            return tiers(25, 100, 1000);
        case A.EliminateEnemyEmpires:
        case A.BuildWonders:
            return tiers(1, 5, 10);
        case A.EliminatePirateFactions:
            return tiers(5, 10, 20);
        default:
            return 0;
    }
}

/** Galaxy.1.cs 3465 ResolveAchievementTitleComplete(achievement): title + " " + level description. */
export function resolveAchievementTitleComplete(achievement: Achievement): string {
    const text = resolveAchievementTitle(achievement.type, achievement.additionalData);
    const level = determineAchievementLevel(achievement.type, achievement.value);
    const text2 = resolveAchievementLevelDescription(achievement.type, level);
    let text3 = text;
    if (text2 !== '') text3 = text3 + ' ' + text2;
    return text3;
}

/** Galaxy.1.cs 3478 ResolveAchievementLevelDescription(achievementType, level). */
export function resolveAchievementLevelDescription(achievementType: AchievementType, level: number): string {
    const A = AchievementType;
    switch (achievementType) {
        case A.DestroyEnemyMilitaryShipsAndBases:
            return level === 1 ? getText('Achievement Level L') : level === 2 ? getText('Achievement Level C') : level === 3 ? getText('Achievement Level M') : '';
        case A.DestroyEnemyCivilianShipsAndBases:
        case A.DestroyEnemyTroops:
        case A.DestroySpaceMonsters:
        case A.DestroySilverMists:
        case A.ConquerEnemyColonies:
        case A.SuccessfulIntelligenceMissions:
        case A.EliminateEnemyCharacters:
        case A.EliminateEnemyEmpires:
        case A.CaptureEnemyShips:
        case A.EliminatePirateFactions:
        case A.SuccessfulRaids:
        case A.BuildWonders:
            return level === 1 ? getText('Achievement Level I') : level === 2 ? getText('Achievement Level II') : level === 3 ? getText('Achievement Level III') : '';
        default:
            return '';
    }
}

/** The AchievementType names whose ResolveDescription / ResolveTitle text takes the level value (Galaxy.1.cs 3526-3622). */
const DESCRIPTION_WITH_VALUE: ReadonlySet<AchievementType> = new Set([
    AchievementType.BuildWonders,
    AchievementType.CaptureEnemyShips,
    AchievementType.ConquerEnemyColonies,
    AchievementType.DestroyEnemyCivilianShipsAndBases,
    AchievementType.DestroyEnemyMilitaryShipsAndBases,
    AchievementType.DestroyEnemyTroops,
    AchievementType.DestroySilverMists,
    AchievementType.DestroySpaceMonsters,
    AchievementType.EliminateEnemyCharacters,
    AchievementType.EliminateEnemyEmpires,
    AchievementType.EliminatePirateFactions,
    AchievementType.SuccessfulIntelligenceMissions,
    AchievementType.SuccessfulRaids,
]);

/** Galaxy.1.cs 3526 ResolveDescription(Achievement): "AchievementType <Name>" formatted with the level's value. */
export function resolveAchievementDescription(achievement: Achievement): string {
    const level = determineAchievementLevel(achievement.type, achievement.value);
    const num = determineAchievementValueForLevel(achievement.type, level);
    if (achievement.type === AchievementType.Undefined) return '';
    const key = 'AchievementType ' + AchievementType[achievement.type];
    if (DESCRIPTION_WITH_VALUE.has(achievement.type)) return formatText(getText(key), String(num));
    return getText(key);
}

/** Galaxy.1.cs 3624 ResolveTitle(achievementType, additionalData). */
export function resolveAchievementTitle(achievementType: AchievementType, additionalData: Race | null): string {
    if (achievementType === AchievementType.Undefined) return '';
    if (achievementType === AchievementType.AchieveAllRaceVictoryConditions) {
        return additionalData !== null ? formatText(getText('AchievementTitle AchieveAllRaceVictoryConditions'), additionalData.name) : '';
    }
    return getText('AchievementTitle ' + AchievementType[achievementType]);
}

// ---------------------------------------------------------------------------------------------------------------
// Battle stats reporting (BaconBuiltObject.cs 2109 ShowStats / 2166 CalculateCrewLevel)
// ---------------------------------------------------------------------------------------------------------------

/** BaconBuiltObject.cs 2166 CalculateCrewLevel(main, ship): green … legendary from career damage dealt − 3 × taken. */
export function calculateCrewLevel(ship: BuiltObject): string {
    if (ship.role !== BuiltObjectRole.Military) return '';
    let num = 0;
    if (ship.careerBattleStats === null) ship.careerBattleStats = new SpaceBattleStats();
    const stats = ship.careerBattleStats as SpaceBattleStats;
    const weaponsDamageToEnemy = stats.weaponsDamageToEnemy;
    const damageToUs = stats.damageToUs;
    if (ship.role === BuiltObjectRole.Military) num = Math.trunc(Math.max(0.0, Math.fround(weaponsDamageToEnemy - Math.fround(damageToUs * 3))));
    return num >= 100 ? (num >= 3999 ? (num >= 8999 ? (num >= 15999 ? (num >= 24999 ? 'legendary' : 'elite') : 'veteran') : 'experienced') : 'average') : 'green';
}

/**
 * BaconBuiltObject.cs 2109 ShowStats(main) for `ship` (the selected military ship): folds the running BattleStats into
 * CareerBattleStats (AddLatestCombatStats, new BattleStats), calls ReDefine, and returns the "Battle Stats" message text
 * (null where the C# returns before showing anything). The message box and the pause / resume are UI (M9).
 */
export function buildBattleStatsReport(ship: BuiltObject): string | null {
    const NL = '\r\n';
    if (ship.role !== BuiltObjectRole.Military) return null;
    let sb = '';
    sb += 'Combat stats for ' + ship.name + NL;
    sb += 'Crew level: ' + calculateCrewLevel(ship) + NL;
    if (ship.battleStats !== null) {
        addLatestCombatStats(ship, ship.battleStats as SpaceBattleStats);
        ship.battleStats = new SpaceBattleStats();
    }
    ship.reDefine();
    const careerBattleStats = ship.careerBattleStats as SpaceBattleStats | null;
    if (careerBattleStats === null) return null;
    sb += NL;
    const line = (label: string, v: number): void => {
        sb += label + '\t' + '\t' + String(v) + NL;
    };
    if (careerBattleStats.destroyedEnemyShipsCapitalShip > 0) line('Capital ship kills: ', careerBattleStats.destroyedEnemyShipsCapitalShip);
    if (careerBattleStats.destroyedEnemyShipsCarrier > 0) line('Crrier kills: ', careerBattleStats.destroyedEnemyShipsCarrier);
    if (careerBattleStats.destroyedEnemyShipsCruiser > 0) line('Cruiser kills: ', careerBattleStats.destroyedEnemyShipsCruiser);
    if (careerBattleStats.destroyedEnemyShipsDestroyer > 0) line('Destroyer kills: ', careerBattleStats.destroyedEnemyShipsDestroyer);
    if (careerBattleStats.destroyedEnemyShipsFrigate > 0) line('Frigate kills: ', careerBattleStats.destroyedEnemyShipsFrigate);
    if (careerBattleStats.destroyedEnemyShipsEscort > 0) line('Escort kills: ', careerBattleStats.destroyedEnemyShipsEscort);
    if (careerBattleStats.destroyedEnemyFighters > 0) line('Fighter kills: ', careerBattleStats.destroyedEnemyFighters);
    if (careerBattleStats.destroyedEnemyShipsTroopTransport > 0) line('Troopship kills: ', careerBattleStats.destroyedEnemyShipsTroopTransport);
    if (careerBattleStats.destroyedEnemyShipsResupplyShip > 0) line('Resupply ship kills: ', careerBattleStats.destroyedEnemyShipsResupplyShip);
    if (careerBattleStats.destroyedEnemyShipsOtherShips > 0) line('Ship kills (other): ', careerBattleStats.destroyedEnemyShipsOtherShips);
    sb += NL;
    if (careerBattleStats.weaponsDamageToEnemy > 0.0) line('Damage Inflicted: ', Math.trunc(careerBattleStats.weaponsDamageToEnemy));
    if (careerBattleStats.damageToUs > 0) line('Damage Taken: ', careerBattleStats.damageToUs);
    return sb;
}

// ---------------------------------------------------------------------------------------------------------------
// Game stats XML (BaconMain.cs): pure text → text; the caller owns the files
// ---------------------------------------------------------------------------------------------------------------

/** BaconMain.cs 559-560: the stats file names ("SaveStatsEmpire<seed>.xml" / "SaveStatsPirates<seed>.xml"). */
export function gameStatsFileNames(galaxy: Galaxy): { empire: string; pirates: string } {
    return { empire: 'SaveStatsEmpire' + galaxy.randomSeed + '.xml', pirates: 'SaveStatsPirates' + galaxy.randomSeed + '.xml' };
}

/** BaconMain.cs 1147-1162: the stats tracked for normal empires and for pirate factions. */
export const EMPIRE_STATS_TO_TRACK: readonly string[] = ['State Money', 'Private Money', 'Income', 'Military Strength', 'Tech Researched', 'Population', 'Economy', 'Happiness', 'Resources Mined', 'Ships Destroyed', 'Ships Lost'];
export const PIRATE_STATS_TO_TRACK: readonly string[] = ['State Money', 'Income', 'Military Strength', 'Tech Researched'];

/** Minimal XmlDocument element model (elements, attributes, text) — all the stats files contain. */
interface XmlEl {
    name: string;
    attrs: [string, string][];
    children: XmlEl[];
    text: string | null;
}

function xmlUnescape(s: string): string {
    return s.replace(/&(lt|gt|quot|apos|amp|#(\d+)|#x([0-9a-fA-F]+));/g, (m, e: string, d?: string, h?: string) => {
        if (d !== undefined) return String.fromCodePoint(Number(d));
        if (h !== undefined) return String.fromCodePoint(parseInt(h, 16));
        return e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'quot' ? '"' : e === 'apos' ? "'" : '&';
    });
}

function xmlEscapeText(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function xmlEscapeAttr(s: string): string {
    return xmlEscapeText(s).replace(/"/g, '&quot;');
}

/** XmlDocument.Load (PreserveWhitespace false): parses the element tree; throws on malformed input. */
function parseXml(text: string): XmlEl {
    let i = 0;
    const src = text.replace(/^﻿/, '');
    const skipMisc = (): void => {
        for (;;) {
            while (i < src.length && /\s/.test(src[i])) i++;
            if (src.startsWith('<?', i)) {
                const e = src.indexOf('?>', i);
                if (e < 0) throw new Error('xml: unterminated declaration');
                i = e + 2;
            } else if (src.startsWith('<!--', i)) {
                const e = src.indexOf('-->', i);
                if (e < 0) throw new Error('xml: unterminated comment');
                i = e + 3;
            } else {
                return;
            }
        }
    };
    const parseElement = (): XmlEl => {
        if (src[i] !== '<') throw new Error('xml: element expected');
        i++;
        const nm = /^[^\s/>]+/.exec(src.slice(i));
        if (nm === null) throw new Error('xml: name expected');
        const el: XmlEl = { name: nm[0], attrs: [], children: [], text: null };
        i += nm[0].length;
        for (;;) {
            while (/\s/.test(src[i] ?? '')) i++;
            if (src.startsWith('/>', i)) {
                i += 2;
                return el;
            }
            if (src[i] === '>') {
                i++;
                break;
            }
            const am = /^([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/.exec(src.slice(i));
            if (am === null) throw new Error('xml: attribute expected');
            el.attrs.push([am[1], xmlUnescape(am[3] ?? am[4])]);
            i += am[0].length;
        }
        let text = '';
        for (;;) {
            if (i >= src.length) throw new Error('xml: unterminated element');
            if (src.startsWith('</', i)) {
                const e = src.indexOf('>', i);
                if (src.slice(i + 2, e).trim() !== el.name) throw new Error('xml: mismatched end tag');
                i = e + 1;
                break;
            }
            if (src.startsWith('<!--', i)) {
                i = src.indexOf('-->', i) + 3;
                continue;
            }
            if (src[i] === '<') {
                el.children.push(parseElement());
                continue;
            }
            const e = src.indexOf('<', i);
            text += src.slice(i, e < 0 ? src.length : e);
            i = e < 0 ? src.length : e;
        }
        const t = xmlUnescape(text);
        if (t.trim() !== '') el.text = t;
        return el;
    };
    skipMisc();
    const root = parseElement();
    skipMisc();
    if (i < src.length) throw new Error('xml: content after the root element');
    return root;
}

/** XmlDocument.Save(filename) with Formatting.Indented (2 spaces, CRLF, no declaration: the document has none). */
function serializeXml(root: XmlEl): string {
    const out: string[] = [];
    const write = (el: XmlEl, depth: number): void => {
        const pad = '  '.repeat(depth);
        const attrs = el.attrs.map(([k, v]) => ` ${k}="${xmlEscapeAttr(v)}"`).join('');
        if (el.children.length === 0 && el.text === null) {
            out.push(`${pad}<${el.name}${attrs} />`);
        } else if (el.children.length === 0) {
            out.push(`${pad}<${el.name}${attrs}>${xmlEscapeText(el.text!)}</${el.name}>`);
        } else {
            out.push(`${pad}<${el.name}${attrs}>`);
            for (const c of el.children) write(c, depth + 1);
            out.push(`${pad}</${el.name}>`);
        }
    };
    write(root, 0);
    return out.join('\r\n');
}

/** XmlNode.AppendChild: a node already under `parent` moves to the end. */
function appendChild(parent: XmlEl, child: XmlEl): void {
    const k = parent.children.indexOf(child);
    if (k >= 0) parent.children.splice(k, 1);
    parent.children.push(child);
}

/** BaconMain.cs 561-600: the empty stats document BaconInitialize saves when the file does not exist yet. */
export function createEmptyGameStatsXml(): string {
    return serializeXml({ name: 'GameStats', attrs: [], children: [], text: null });
}

/** Math.Round(double) (MidpointRounding.ToEven). */
function roundHalfEven(x: number): number {
    const r = Math.round(x);
    return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** .NET Core double.ToString(InvariantCulture): shortest round-trip digits, scientific below 1e-5 / from 1e15. */
export function doubleToInvariantString(x: number, isFloat = false): string {
    if (Number.isNaN(x)) return 'NaN';
    if (!Number.isFinite(x)) return x > 0 ? '∞' : '-∞';
    if (x === 0) return Object.is(x, -0) ? '-0' : '0';
    let digits: string;
    let exp: number;
    if (isFloat) {
        let p = 1;
        let s = x.toPrecision(1);
        while (p < 9 && Math.fround(parseFloat(s)) !== x) s = x.toPrecision(++p);
        const e = Number(parseFloat(s).toExponential().split('e')[1]);
        digits = parseFloat(s).toExponential().split('e')[0].replace('-', '').replace('.', '');
        exp = e;
    } else {
        const [m, e] = x.toExponential().split('e');
        digits = m.replace('-', '').replace('.', '');
        exp = Number(e);
    }
    const neg = x < 0 ? '-' : '';
    const maxExp = isFloat ? 7 : 15;
    if (exp >= maxExp || exp < -5) {
        const mant = digits.length > 1 ? digits[0] + '.' + digits.slice(1) : digits;
        const ae = Math.abs(exp);
        return `${neg}${mant}E${exp < 0 ? '-' : '+'}${ae < 10 ? '0' + ae : String(ae)}`;
    }
    if (exp < 0) return `${neg}0.${'0'.repeat(-exp - 1)}${digits}`;
    if (digits.length <= exp + 1) return neg + digits + '0'.repeat(exp + 1 - digits.length);
    return `${neg}${digits.slice(0, exp + 1)}.${digits.slice(exp + 1)}`;
}

/** BaconMain.cs 1242 FindValueForThisNode(stat, empire) (InvariantCulture strings). */
export function findValueForThisNode(galaxy: Galaxy, stat: string, empire: Empire): string {
    let result = '';
    switch (stat) {
        case 'State Money': result = doubleToInvariantString(roundHalfEven(empire.stateMoney)); break;
        case 'Private Money': result = doubleToInvariantString(roundHalfEven(empire.privateMoney)); break;
        case 'Income': result = doubleToInvariantString(calculateAccurateAnnualIncome(galaxy, empire)); break;
        case 'Military Strength': result = String(militaryPotency(galaxy, empire)); break;
        case 'Tech Researched': result = doubleToInvariantString(calculateTotalCostResearchedProjects(empire.research.techTree), true); break;
        case 'Population': result = String(empire.totalPopulation); break;
        case 'Economy': result = doubleToInvariantString(privateAnnualRevenue(galaxy, empire)); break;
        case 'Happiness': result = doubleToInvariantString(averageHappiness(galaxy, empire)); break;
        case 'Resources Mined': result = String((empire.counters.miningExtractionGas + empire.counters.miningExtractionLuxury + empire.counters.miningExtractionStrategic) | 0); break;
        // C# oddity kept: civilian ship count + civilian ship *size*.
        case 'Ships Destroyed': result = String((empire.counters.destroyedEnemyCivilianShipCount + empire.counters.destroyedEnemyCivilianShipSize) | 0); break;
        case 'Ships Lost': result = String((empire.counters.lossesMilitaryShipCount + empire.counters.lossesCivilianShipCount) | 0); break;
    }
    return result;
}

/**
 * BaconMain.cs 1170 ProcessGameStats(main, empireList, statsToTrack, saveFilename) as a pure transform: `xmlText` is the
 * current file content (null = file missing → FileNotFoundException, nothing saved); the result is the new content, or
 * null when the C# would not save (missing file / any exception, which it swallows). For every tracked stat and empire,
 * one <TimeAndValue><Time>years</Time><Value>v</Value></TimeAndValue> is appended under
 * GameStats/GameStat[@name]/SpaceEmpire[@name]; both parents are re-appended (moved last) as the C# AppendChild does.
 */
export function processGameStatsXml(galaxy: Galaxy, xmlText: string | null, empireList: readonly Empire[], statsToTrack: readonly string[]): string | null {
    // 1172-1174: years since ActualStartDate, "{0:0.00}" (current culture in the C#: invariant here).
    const num = galaxyStarDate(galaxy) - startStarDateForAge(galaxy.age);
    const num2 = REAL_SECONDS_IN_GALACTIC_YEAR * 1000;
    const innerText = (num / num2).toFixed(2);
    if (xmlText === null) return null;
    let doc: XmlEl;
    try {
        doc = parseXml(xmlText);
        for (const item of statsToTrack) {
            let xmlNode: XmlEl | null = null;
            for (const childNode of doc.children) {
                if (childNode.attrs.length > 0 && childNode.attrs[0][1] === item) {
                    xmlNode = childNode;
                    break;
                }
            }
            if (xmlNode === null) xmlNode = { name: 'GameStat', attrs: [['name', item]], children: [], text: null };
            const xmlNode3 = xmlNode;
            for (const empire of empireList) {
                let xmlNode4: XmlEl | null = null;
                for (const item2 of xmlNode3.children) {
                    // item2.Attributes[0] on an element without attributes throws (swallowed: nothing saved).
                    if (item2.attrs.length === 0) throw new Error('IndexOutOfRange');
                    if (item2.attrs[0][1] === empire.name) {
                        xmlNode4 = item2;
                        break;
                    }
                }
                if (xmlNode4 === null) xmlNode4 = { name: 'SpaceEmpire', attrs: [['name', empire.name]], children: [], text: null };
                const xmlNode6 = xmlNode4;
                const xmlElement4: XmlEl = { name: 'TimeAndValue', attrs: [], children: [], text: null };
                const xmlElement5: XmlEl = { name: 'Time', attrs: [], children: [], text: innerText };
                const xmlElement6: XmlEl = { name: 'Value', attrs: [], children: [], text: findValueForThisNode(galaxy, item, empire) };
                if (xmlElement6.text === '') xmlElement6.text = null;
                appendChild(xmlElement4, xmlElement5);
                appendChild(xmlElement4, xmlElement6);
                appendChild(xmlNode6, xmlElement4);
                appendChild(xmlNode, xmlNode6);
                appendChild(doc, xmlNode);
            }
        }
    } catch {
        return null;
    }
    return serializeXml(doc);
}

/**
 * BaconMain.cs 1145 ProcessGameStats(main): the empire file over Galaxy.Empires and the pirate file over
 * Galaxy.PirateEmpires. Inputs / outputs are file contents (see processGameStatsXml). Scheduling: BaconInitialize
 * (BaconMain.cs 686-697) queues a "SaveStats" delayed EventAction every statSaveIntervalInGameDays, handled by
 * BaconGalaxy.cs 315 ExecuteEventAction — TODO(port) M4z3 (ProcessDelayedEventActions) / M9 (desktop file I/O).
 */
export function processGameStats(galaxy: Galaxy, empireXml: string | null, pirateXml: string | null): { empire: string | null; pirates: string | null } {
    return {
        empire: processGameStatsXml(galaxy, empireXml, galaxy.empires.slice(), EMPIRE_STATS_TO_TRACK),
        pirates: processGameStatsXml(galaxy, pirateXml, galaxy.pirateEmpires.slice(), PIRATE_STATS_TO_TRACK),
    };
}
