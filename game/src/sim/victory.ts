// M4z4: victory conditions and victory-progress reporting.
//
// Ports:
//   VictoryConditions.cs, EmpireVictoryConditions.cs, VictoryConditionProgress(List).cs,
//   RaceVictoryConditionProgress(List).cs, GameEndEventArgs.cs, GameEndOutcome.cs (model);
//   Galaxy.1.cs 20-686 (CountColoniesByType … CheckVictoryPopulation: CheckVictoryConditions,
//   CheckVictoryConditionsWinner, GenerateVictoryConditionProgresses, ResolvePirateVictoryConditions,
//   CheckGlobalVictoryConditions, CheckEmpireVictoryConditionsToPrevent / ToAchieve);
//   Galaxy.cs 3808-5247 (CalculateRaceVictoryConditionsProgress, RaceVictoryConditionMetCompareEmpires,
//   CalculateRaceVictoryConditionProgress — all 60 RaceVictoryConditionType cases);
//   Galaxy.cs 1274 OnGameEnd; Galaxy.cs 1412-1471 SetEmpireDifficultyFactors (victory scaling) /
//   ReviewEmpireDifficultyFactors; Start.1.cs 3772-3805 (+ 3885 method_203) the wizard → VictoryConditions
//   mapping, Start.2.cs 501-506 the Galaxy flags taken from it; Main.Part12.cs 3423 DoGameEnd (model part);
//   EmpireCounters.cs 103 TimeSpentAtWar, 119 ProcessEmpireElimination, 481 ProcessCreatureDeath;
//   and the list / empire helpers they read (HabitatList.cs, ResearchNodeList.cs, TroopList.cs,
//   Empire.2.cs 3098-3196, Empire.7.cs 4713, PlanetaryFacilityBuildDateList.cs 15).
//
// No Galaxy.Rnd draws anywhere in this file except the story-only DecimateEmpire (not ported, see
// checkGlobalVictoryConditions). Several helpers have side effects the C# has too: ObtainDiplomaticRelation /
// ObtainPirateRelation add NotMet relations for empires not yet in the list.

import type { Galaxy } from './galaxy';
import type { Empire, EmpireCounters } from './empire';
import type { Habitat } from './types';
import type { BuiltObject } from './builtObject';
import { HabitatCategoryType, HabitatType, IndustryType } from './types';
import { RaceVictoryConditionType, type Race, type RaceVictoryCondition } from './data/races';
import { BuiltObjectRole } from './data/designSpecifications';
import { BuiltObjectSubRole } from './builtObjectTypes';
import { CreatureType } from './creature';
import { DiplomaticRelationType, obtainDiplomaticRelation } from './diplomacy';
import { PirateRelationType, obtainPirateRelation } from './pirateRelations';
import { PiratePlayStyle } from './pirates';
import { CharacterRole, countCharactersByRole, getCharactersByRole, type Character } from './characters';
import { countExploredSystems } from './visibility';
import { calculateAccurateAnnualIncome, privateAnnualRevenue, totalColonyStrategicValue } from './forceStructure';
import { identifyMechanoidEmpire } from './fleets/militaryAI';
import { identifyShakturiEmpire, getText, formatText, compareDouble } from './diplomacyTick';
import { averageHappiness } from './characterRuntime';
import { facilitiesCountCompletedByType, planetaryFacilityDefinitionsStatic, type PlanetaryFacilityBuildDate } from './construction/facilities';
import { PlanetaryFacilityType, WonderType } from './researchSystem';
import { componentCategoryByIndex, ComponentCategoryType, ColonyPopulationPolicy } from './data/policies';
import { resolveIndustry } from './componentStatic';
import { galaxyStarDate, REAL_SECONDS_IN_GALACTIC_YEAR } from './tick/simTime';
import { resolveStarDateDescription, startStarDateForAge } from './galaxyTime';
import { resolveDescription } from './messages';
import { netSort } from './netSort';
import { habitatCompareTo } from './stationPlacement';
import { LONG_MAX_VALUE, type DiplomacyCounters } from './diplomacy';
import type { VictoryConditions as WizardVictoryConditions } from './startGameOptions';
import type { TechNode } from './researchSystem';
import type { Troop } from './cargo';

// ---------------------------------------------------------------------------------------------------------------
// Model classes
// ---------------------------------------------------------------------------------------------------------------

/** GameEndOutcome.cs. */
export enum GameEndOutcome {
    Undefined,
    Victory,
    Defeat,
    Stalemate,
}

/** VictoryConditions.cs (the runtime Galaxy.GlobalVictoryConditions / Game.GlobalVictoryConditions object). */
export class VictoryConditions {
    territory = false;
    territoryPercent = 0.0;
    population = false;
    populationPercent = 0.0;
    economy = false;
    economyPercent = 0.0;
    timeLimit = false;
    /** long star date. */
    timeLimitDate = 0;
    /** long star date (0 = conditions apply from the start). */
    startDate = 0;
    enableStoryEvents = false;
    defendHabitat: Habitat | null = null;
    defendHabitatEmpire: Empire | null = null;
    targetHabitat: Habitat | null = null;
    targetHabitatEmpire: Empire | null = null;
    enableDisasterEvents = true;
    enableRaceSpecificEvents = true;
    enableRaceSpecificVictoryConditions = true;
    enableStoryEventsShadows = true;
    victoryThresholdPercentage = 1.0;
}

/** EmpireVictoryConditions.cs (scenario conditions: Game.PlayerVictoryConditionsToAchieve / ToPrevent). */
export class EmpireVictoryConditions {
    eliminateEmpires: Empire[] = [];
    captureColonies: Habitat[] = [];
    destroyBuiltObjects: BuiltObject[] = [];
}

/**
 * RaceVictoryCondition.cs with AdditionalData resolved. data/races.ts keeps AdditionalData as the parsed index / enum
 * value (BuildWonder: index into PlanetaryFacilityDefinitionsStatic, resolved at evaluation time like the C# does at
 * load; out-of-range → null).
 */
export interface VictoryCondition {
    type: RaceVictoryConditionType;
    /** float. */
    proportion: number;
    amount: number;
    additionalData: number | null;
}

/** RaceVictoryConditionProgress.cs. */
export class RaceVictoryConditionProgress {
    constructor(
        public type: RaceVictoryConditionType,
        public progressTotalPortion: number,
        public thisProgress: number,
        public bestEmpire: Empire | null,
        public detail: string,
        public condition: VictoryCondition,
    ) {}
}

/** RaceVictoryConditionProgressList.cs 14 TotalProgress. */
export function raceVictoryConditionProgressListTotalProgress(list: readonly RaceVictoryConditionProgress[]): number {
    let totalProgress = 0.0;
    for (let index = 0; index < list.length; ++index) totalProgress += list[index].progressTotalPortion;
    return totalProgress;
}

/** VictoryConditionProgress.cs. */
export class VictoryConditionProgress {
    territoryPercent = 0.0;
    economyPercent = 0.0;
    populationPercent = 0.0;
    pirateBonusAmount = 0.0;
    bonusAmount = 0.0;
    standingWonderBonusAmount = 0.0;
    constructor(
        public empire: Empire,
        public territoryEnabled: boolean,
        public economyEnabled: boolean,
        public populationEnabled: boolean,
        public territoryProgress: number,
        public economyProgress: number,
        public populationProgress: number,
        public raceVictoryConditionsProgress: RaceVictoryConditionProgress[] | null,
    ) {}

    /** VictoryConditionProgress.cs 67 TotalProgress. */
    get totalProgress(): number {
        let num1 = 0;
        if (this.territoryEnabled) ++num1;
        if (this.economyEnabled) ++num1;
        if (this.populationEnabled) ++num1;
        if (this.raceVictoryConditionsProgress != null && this.raceVictoryConditionsProgress.length > 0) ++num1;
        const num2 = 1.0 / num1;
        let num3 = 0.0;
        if (this.territoryEnabled) num3 += this.territoryProgress * num2;
        if (this.economyEnabled) num3 += this.economyProgress * num2;
        if (this.populationEnabled) num3 += this.populationProgress * num2;
        if (this.raceVictoryConditionsProgress != null && this.raceVictoryConditionsProgress.length > 0) {
            num3 += raceVictoryConditionProgressListTotalProgress(this.raceVictoryConditionsProgress) * num2;
        }
        return num3 + this.bonusAmount + this.pirateBonusAmount;
    }

    /** VictoryConditionProgress.cs 93 GetPortionCount. */
    getPortionCount(): number {
        let portionCount = 0;
        if (this.territoryEnabled) ++portionCount;
        if (this.economyEnabled) ++portionCount;
        if (this.populationEnabled) ++portionCount;
        if (this.raceVictoryConditionsProgress != null && this.raceVictoryConditionsProgress.length > 0) ++portionCount;
        return portionCount;
    }

    /** VictoryConditionProgress.cs 107 GetProgressAll(out territory, out economy, out population, out race). */
    getProgressAll(): { territoryProgress: number; economyProgress: number; populationProgress: number; raceProgress: number } {
        const r = { territoryProgress: 0.0, economyProgress: 0.0, populationProgress: 0.0, raceProgress: 0.0 };
        const num = 1.0 / this.getPortionCount();
        if (this.territoryEnabled) r.territoryProgress = this.territoryProgress * num;
        if (this.economyEnabled) r.economyProgress = this.economyProgress * num;
        if (this.populationEnabled) r.populationProgress = this.populationProgress * num;
        if (this.raceVictoryConditionsProgress == null || this.raceVictoryConditionsProgress.length <= 0) return r;
        r.raceProgress = raceVictoryConditionProgressListTotalProgress(this.raceVictoryConditionsProgress) * num;
        return r;
    }

    /**
     * VictoryConditionProgress.cs 124 IComparable.CompareTo (UI sorting only). Empire.Name.CompareTo is culture-sensitive
     * in the C#; ordinal here.
     */
    compareTo(other: VictoryConditionProgress): number {
        const num = compareDouble(this.totalProgress, other.totalProgress);
        if (num !== 0 || this.empire == null || other.empire == null) return num;
        const colonyStrategicValue1 = totalColonyStrategicValue(this.empire);
        const colonyStrategicValue2 = totalColonyStrategicValue(other.empire);
        if (colonyStrategicValue1 === colonyStrategicValue2) return this.empire.name < other.empire.name ? -1 : this.empire.name > other.empire.name ? 1 : 0;
        return colonyStrategicValue1 < colonyStrategicValue2 ? -1 : 1;
    }
}

/** VictoryConditionProgressList.cs 14 GetByEmpire. */
export function victoryConditionProgressListGetByEmpire(list: readonly VictoryConditionProgress[], empire: Empire): VictoryConditionProgress | null {
    for (let index = 0; index < list.length; ++index) {
        if (list[index].empire === empire) return list[index];
    }
    return null;
}

/** GameEndEventArgs.cs. */
export class GameEndEventArgs {
    constructor(
        public victorEmpire: Empire | null,
        public outcomeForPlayer: GameEndOutcome,
        public description: string,
        public code: number,
    ) {}
}

// ---------------------------------------------------------------------------------------------------------------
// Galaxy.GameEnd event (Galaxy.cs 1274 OnGameEnd) and the UI's DoGameEnd model part
// ---------------------------------------------------------------------------------------------------------------

/** Galaxy.GameEnd subscribers (the UI's Main.Galaxy_GameEnd). Kept off the Galaxy object so saves stay plain data. */
const gameEndHandlers = new WeakMap<Galaxy, (e: GameEndEventArgs) => void>();

/** `galaxy.GameEnd += handler` (Main.Part7.cs 4027 / Main.Part12.cs 2910). null unsubscribes. */
export function setGameEndHandler(galaxy: Galaxy, handler: ((e: GameEndEventArgs) => void) | null): void {
    if (handler === null) gameEndHandlers.delete(galaxy);
    else gameEndHandlers.set(galaxy, handler);
}

/** Galaxy.cs 1274 OnGameEnd(e): raise GameEnd if anyone subscribed. */
export function onGameEnd(galaxy: Galaxy, e: GameEndEventArgs): void {
    const handler = gameEndHandlers.get(galaxy);
    if (handler !== undefined) handler(e);
}

/**
 * Main.Part12.cs 3423 DoGameEnd(e), model part: `_Game.IsFinished = true; _Game.Victor = e.VictorEmpire`. The rest
 * (music, game-end screen, Code 1 story message GenerateMajorStoryVictoryMessage) is UI — TODO(port) M9.
 */
export function doGameEnd(galaxy: Galaxy, e: GameEndEventArgs): void {
    galaxy.gameIsFinished = true;
    galaxy.gameVictor = e.victorEmpire;
}

// ---------------------------------------------------------------------------------------------------------------
// Game settings → VictoryConditions (Start.1.cs 3772-3805) and the Galaxy flags (Start.2.cs 501-506)
// ---------------------------------------------------------------------------------------------------------------

/** Start.1.cs 3885 method_203: cmbVictoryThresholdPercentage index → VictoryThresholdPercentage. */
export function victoryThresholdForIndex(int1: number): number {
    let result = 1.0;
    switch (int1) {
        case 0: result = 0.75; break;
        case 1: result = 0.8; break;
        case 2: result = 0.85; break;
        case 3: result = 0.9; break;
        case 4: result = 0.95; break;
        case 5: result = 1.0; break;
    }
    return result;
}

/**
 * Start.1.cs 3772-3805: the "Victory Conditions" wizard page → VictoryConditions. `galaxyExpansion` is the galaxy
 * Expansion slider value (`startStarDate = Galaxy.StartStarDate + value * 30000000`, 3772-3773). The TS wizard keeps
 * the threshold as a value (not the combo index) and has no story checkboxes yet (chkStoryReturnOfTheShakturi /
 * chkStoryShadows → unset = unchecked) nor the chkVictoryTimeStart box (unset = unchecked).
 */
export function victoryConditionsFromWizard(v: WizardVictoryConditions, galaxyExpansion: number): VictoryConditions {
    const startStarDate = startStarDateForAge(galaxyExpansion);
    const year = REAL_SECONDS_IN_GALACTIC_YEAR * 1000;
    const victoryConditions = new VictoryConditions();
    victoryConditions.economy = v.economy;
    if (victoryConditions.economy) victoryConditions.economyPercent = v.economyPercent;
    victoryConditions.population = v.population;
    if (victoryConditions.population) victoryConditions.populationPercent = v.populationPercent;
    victoryConditions.territory = v.territory;
    if (victoryConditions.territory) victoryConditions.territoryPercent = v.territoryPercent;
    victoryConditions.timeLimit = v.timeLimit;
    victoryConditions.timeLimitDate = startStarDate + Math.trunc(v.timeLimitYears) * year;
    if (v.timeStart === true) {
        victoryConditions.startDate = startStarDate + Math.trunc(v.startDateYears) * year;
    } else {
        victoryConditions.startDate = 0;
    }
    victoryConditions.enableStoryEvents = v.enableStoryEvents === true;
    victoryConditions.enableDisasterEvents = v.enableDisasterEvents;
    victoryConditions.enableRaceSpecificEvents = v.enableRaceSpecificEvents;
    victoryConditions.enableRaceSpecificVictoryConditions = v.enableRaceSpecificConditions;
    victoryConditions.victoryThresholdPercentage = v.victoryThresholdPercentage;
    victoryConditions.enableStoryEventsShadows = v.enableStoryEventsShadows === true;
    return victoryConditions;
}

/**
 * Start.2.cs 501-506: the Galaxy switches taken from victoryConditions_0 (StoryReturnOfTheShakturiEnabled,
 * GameDisasterEventsEnabled, GameRaceSpecificEventsEnabled, GameRaceSpecificVictoryConditionsEnabled,
 * StoryShadowsEnabled). 502 StoryDistantWorldsEnabled = bool_7 is not a victory setting.
 */
export function applyVictoryConditionsToGalaxy(galaxy: Galaxy, victoryConditions: VictoryConditions): void {
    galaxy.storyReturnOfTheShakturiEnabled = victoryConditions.enableStoryEvents;
    galaxy.gameDisasterEventsEnabled = victoryConditions.enableDisasterEvents;
    galaxy.gameRaceSpecificEventsEnabled = victoryConditions.enableRaceSpecificEvents;
    galaxy.gameRaceSpecificVictoryConditionsEnabled = victoryConditions.enableRaceSpecificVictoryConditions;
    galaxy.storyShadowsEnabled = victoryConditions.enableStoryEventsShadows;
}

// ---------------------------------------------------------------------------------------------------------------
// C# number formatting used by the progress detail strings (invariant culture)
// ---------------------------------------------------------------------------------------------------------------

/** .NET custom numeric formats rounding: half away from zero. */
function roundAway(x: number): number {
    return Math.sign(x) * Math.round(Math.abs(x));
}

function groupThousands(n: number): string {
    const s = String(Math.abs(n));
    return (n < 0 ? '-' : '') + s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** value.ToString(format) for the custom formats of Galaxy.cs 4700-4953 / Galaxy.1.cs. */
export function formatNumber(value: number, format: string): string {
    switch (format) {
        case '0':
            return String(roundAway(value) + 0);
        case '0,,M':
            return String(roundAway(value / 1e6) + 0) + 'M';
        case '0,K':
            return String(roundAway(value / 1e3) + 0) + 'K';
        case '###,###,###,###,##0':
            return groupThousands(roundAway(value) + 0);
        case '0%':
            return String(roundAway(value * 100.0) + 0) + '%';
        case '0.0':
            return value.toFixed(1);
        case '+0.0;-0.0;0': {
            const r = Math.abs(value).toFixed(1);
            if (r === '0.0') return '0';
            return (value > 0 ? '+' : '-') + r;
        }
        default:
            throw new Error(`formatNumber: unsupported format ${format}`);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Shared helpers (list / empire / counters methods the victory code reads)
// ---------------------------------------------------------------------------------------------------------------

/** HabitatList.cs 24 TotalPopulation. */
export function habitatListTotalPopulation(list: readonly Habitat[]): number {
    let num = 0;
    for (let index = 0; index < list.length; ++index) {
        const habitat = list[index];
        if (habitat != null && habitat.population != null) num += habitat.population.totalAmount;
    }
    return num;
}

/** HabitatList.cs 36 TotalPopulationOwnedColonies(empire). */
export function habitatListTotalPopulationOwnedColonies(list: readonly Habitat[], empire: Empire): number {
    let num = 0;
    for (let index = 0; index < list.length; ++index) {
        const habitat = list[index];
        if (habitat != null && habitat.empire === empire && habitat.population != null) num += habitat.population.totalAmount;
    }
    return num;
}

/** HabitatList.cs 150 CountHabitatWithRuins. */
export function habitatListCountHabitatWithRuins(list: readonly Habitat[]): number {
    let num = 0;
    for (let index = 0; index < list.length; ++index) {
        if (list[index].ruin !== null) ++num;
    }
    return num;
}

/** HabitatList.cs 161 CountPirateControlledColonies(pirateEmpire, out ownedColonyCount). */
export function habitatListCountPirateControlledColonies(list: readonly Habitat[], pirateEmpire: Empire): { count: number; ownedColonyCount: number } {
    let num = 0;
    let ownedColonyCount = 0;
    for (let index = 0; index < list.length; ++index) {
        const habitat = list[index];
        if (habitat != null && !habitat.hasBeenDestroyed && habitat.facilities !== null) {
            if (habitat.empire === pirateEmpire) {
                ++ownedColonyCount;
            } else {
                const byFaction = habitat.pirateColonyControl.getByFaction(pirateEmpire);
                if (byFaction !== null && byFaction.controlLevel > 0.0) ++num;
            }
        }
    }
    return { count: num, ownedColonyCount };
}

/** HabitatList.cs 185 GetPirateControlledColonies(pirateEmpire, out ownedColonies). */
export function habitatListGetPirateControlledColonies(list: readonly Habitat[], pirateEmpire: Empire): { controlledColonies: Habitat[]; ownedColonies: Habitat[] } {
    const controlledColonies: Habitat[] = [];
    const ownedColonies: Habitat[] = [];
    for (let index = 0; index < list.length; ++index) {
        const habitat = list[index];
        if (habitat != null && !habitat.hasBeenDestroyed && habitat.facilities !== null) {
            if (habitat.empire === pirateEmpire) {
                ownedColonies.push(habitat);
            } else {
                const byFaction = habitat.pirateColonyControl.getByFaction(pirateEmpire);
                if (byFaction !== null && byFaction.controlLevel > 0.0) controlledColonies.push(habitat);
            }
        }
    }
    return { controlledColonies, ownedColonies };
}

/** HabitatList.cs 231 CountPirateControlledColoniesWithHiddenPirateBase(pirateEmpire). */
export function habitatListCountPirateControlledColoniesWithHiddenPirateBase(list: readonly Habitat[], pirateEmpire: Empire): number {
    let num = 0;
    for (let index = 0; index < list.length; ++index) {
        const habitat = list[index];
        if (habitat != null && !habitat.hasBeenDestroyed && habitat.facilities !== null) {
            const byFaction = habitat.pirateColonyControl.getByFaction(pirateEmpire);
            if (byFaction !== null && byFaction.hasFacilityControl) num += facilitiesCountCompletedByType(habitat.facilities, PlanetaryFacilityType.PirateBase);
        }
    }
    return num;
}

/** HabitatList.cs 247 CountByType(type). */
export function habitatListCountByType(list: readonly Habitat[], type: HabitatType): number {
    let num = 0;
    for (let index = 0; index < list.length; ++index) {
        if (list[index].type === type) ++num;
    }
    return num;
}

/** Resource.cs 34 IsRestrictedResource (SuperLuxuryBonusAmount > 0). */
function isRestrictedResource(galaxy: Galaxy, resourceId: number): boolean {
    return galaxy.resourceSystem.resources[resourceId].superLuxuryBonusAmount > 0;
}

/** HabitatList.cs 296 GetHabitatsWithRestrictedResources (the Resources.Clone() copy is not observable). */
export function habitatListGetHabitatsWithRestrictedResources(galaxy: Galaxy, list: readonly Habitat[]): Habitat[] {
    const restrictedResources: Habitat[] = [];
    for (let index1 = 0; index1 < list.length; ++index1) {
        const habitat = list[index1];
        if (habitat != null && habitat.resources != null) {
            const habitatResourceList = habitat.resources.slice();
            for (let index2 = 0; index2 < habitatResourceList.length; ++index2) {
                if (isRestrictedResource(galaxy, habitatResourceList[index2].resourceId)) {
                    restrictedResources.push(habitat);
                    break;
                }
            }
        }
    }
    return restrictedResources;
}

/** Galaxy.1.cs 20 CountColoniesByType(type). */
export function countColoniesByType(galaxy: Galaxy, type: HabitatType): number {
    let num = 0;
    for (let i = 0; i < galaxy.empires.length; i++) {
        const empire = galaxy.empires[i];
        if (empire == null || empire === galaxy.independentEmpire || !empire.active) continue;
        for (let j = 0; j < empire.colonies.length; j++) {
            const habitat = empire.colonies[j];
            if (habitat != null && !habitat.hasBeenDestroyed && habitat.type === type) num++;
        }
    }
    return num;
}

/** Galaxy.1.cs 42 CountPirateControlledColonies(). */
export function countPirateControlledColoniesGalaxy(galaxy: Galaxy): number {
    let num = 0;
    for (let i = 0; i < galaxy.pirateEmpires.length; i++) {
        const empire = galaxy.pirateEmpires[i];
        if (empire == null || empire === galaxy.independentEmpire || !empire.active) continue;
        for (let j = 0; j < empire.colonies.length; j++) {
            const habitat = empire.colonies[j];
            if (habitat != null && !habitat.hasBeenDestroyed && habitat.pirateColonyControl.count > 0) num++;
        }
    }
    return num;
}

/** Galaxy.1.cs 64 DetermineLargestColoniesByType(type): HabitatList.Sort() (Habitat.CompareTo) then Reverse. */
export function determineLargestColoniesByType(galaxy: Galaxy, type: HabitatType): Habitat[] {
    const habitatList: Habitat[] = [];
    for (let i = 0; i < galaxy.empires.length; i++) {
        const empire = galaxy.empires[i];
        if (empire == null || empire === galaxy.independentEmpire || !empire.active) continue;
        for (let j = 0; j < empire.colonies.length; j++) {
            const habitat = empire.colonies[j];
            if (habitat != null && !habitat.hasBeenDestroyed && habitat.type === type) habitatList.push(habitat);
        }
    }
    netSort(habitatList, habitatCompareTo);
    habitatList.reverse();
    return habitatList;
}

/**
 * Galaxy.DefeatedEmpires (EmpireList; CompleteTeardown adds the eliminated empire). TODO(port) M4z1: not modelled on
 * the TS Galaxy yet — read defensively as empty until the teardown package adds `galaxy.defeatedEmpires`.
 */
function defeatedEmpires(galaxy: Galaxy): readonly Empire[] {
    return (galaxy as unknown as { defeatedEmpires?: Empire[] }).defeatedEmpires ?? [];
}

/** Empire.2.cs 3098 GetHomeworldsOwned. */
export function getHomeworldsOwned(galaxy: Galaxy, self: Empire): Habitat[] {
    const habitatList: Habitat[] = [];
    for (let i = 0; i < galaxy.empires.length; i++) {
        const empire = galaxy.empires[i];
        if (empire != null && empire.homeWorld !== null && self.colonies.includes(empire.homeWorld) && !habitatList.includes(empire.homeWorld)) habitatList.push(empire.homeWorld);
    }
    const defeated = defeatedEmpires(galaxy);
    for (let j = 0; j < defeated.length; j++) {
        const empire2 = defeated[j];
        if (empire2 != null && empire2.homeWorld !== null && self.colonies.includes(empire2.homeWorld) && !habitatList.includes(empire2.homeWorld)) habitatList.push(empire2.homeWorld);
    }
    return habitatList;
}

/** Empire.2.cs 3120 CountHomeworldsOwned. */
export function countHomeworldsOwned(galaxy: Galaxy, self: Empire): number {
    let num = 0;
    for (let i = 0; i < galaxy.empires.length; i++) {
        const empire = galaxy.empires[i];
        if (empire != null && empire.homeWorld !== null && self.colonies.includes(empire.homeWorld)) num++;
    }
    const defeated = defeatedEmpires(galaxy);
    for (let j = 0; j < defeated.length; j++) {
        const empire2 = defeated[j];
        if (empire2 != null && empire2.homeWorld !== null && self.colonies.includes(empire2.homeWorld)) num++;
    }
    return num;
}

/** Empire.2.cs 3142 LargestCapitalShip. */
export function largestCapitalShip(self: Empire): BuiltObject | null {
    let builtObject: BuiltObject | null = null;
    for (let i = 0; i < self.builtObjects.length; i++) {
        const builtObject2 = self.builtObjects[i];
        if (builtObject2 != null && !builtObject2.hasBeenDestroyed && builtObject2.unbuiltComponentCount === 0 && builtObject2.subRole === BuiltObjectSubRole.CapitalShip && (builtObject === null || builtObject2.size > builtObject.size)) builtObject = builtObject2;
    }
    return builtObject;
}

/** Empire.2.cs 3156 CalculateMilitaryShipSizeTotal. */
export function calculateMilitaryShipSizeTotal(self: Empire): number {
    let num = 0;
    for (let i = 0; i < self.builtObjects.length; i++) {
        const builtObject = self.builtObjects[i];
        if (builtObject != null && !builtObject.hasBeenDestroyed && builtObject.unbuiltComponentCount === 0 && builtObject.role === BuiltObjectRole.Military) num += builtObject.size;
    }
    return num;
}

/** Empire.2.cs 3170 CalculateEnslavedPopulationAmount. */
export function calculateEnslavedPopulationAmount(self: Empire): number {
    let num = 0;
    const dominantRace = self.dominantRace;
    for (let i = 0; i < self.colonies.length; i++) {
        const habitat = self.colonies[i];
        for (let j = 0; j < habitat.population.items.length; j++) {
            const population = habitat.population.items[j];
            let colonyPopulationPolicy: number = ColonyPopulationPolicy.Assimilate;
            if (population.race !== dominantRace) {
                colonyPopulationPolicy = habitat.colonyPopulationPolicy;
                if (population.race.raceFamily === dominantRace!.raceFamily) colonyPopulationPolicy = habitat.colonyPopulationPolicyRaceFamily;
            }
            if (colonyPopulationPolicy === ColonyPopulationPolicy.Enslave) num += population.amount;
        }
    }
    return num;
}

/** PlanetaryFacilityBuildDateList.cs 15 CheckBuildDate(colony, planetaryFacilityId, out buildDate). */
export function trackedWondersCheckBuildDate(list: readonly PlanetaryFacilityBuildDate[], colony: Habitat, planetaryFacilityId: number): { found: boolean; buildDate: number } {
    for (let index = 0; index < list.length; ++index) {
        const facilityBuildDate = list[index];
        if (facilityBuildDate != null && facilityBuildDate.colony === colony && facilityBuildDate.facilityId === planetaryFacilityId) return { found: true, buildDate: facilityBuildDate.buildDate };
    }
    return { found: false, buildDate: Number.MIN_SAFE_INTEGER };
}

/** Empire.7.cs 4713 CalculateVictoryBonusFromStandingWonders(starDate): 5 % per year a RaceAchievement wonder (Value2 1) stands. */
export function calculateVictoryBonusFromStandingWonders(self: Empire, starDate: number): number {
    let num = 0.0;
    const list2 = [1];
    if (self.colonies != null && self.trackedWonders !== null) {
        for (let i = 0; i < self.colonies.length; i++) {
            const habitat = self.colonies[i];
            if (habitat == null || habitat.facilities === null) continue;
            for (let j = 0; j < habitat.facilities.length; j++) {
                const planetaryFacility = habitat.facilities[j];
                if (planetaryFacility == null || planetaryFacility.type !== PlanetaryFacilityType.Wonder || planetaryFacility.wonderType !== WonderType.RaceAchievement || !list2.includes(planetaryFacility.value2)) continue;
                const r = trackedWondersCheckBuildDate(self.trackedWonders, habitat, planetaryFacility.planetaryFacilityDefinitionId);
                if (r.found) {
                    const num2 = starDate - r.buildDate;
                    if (num2 > 0) {
                        const num3 = REAL_SECONDS_IN_GALACTIC_YEAR * 1000;
                        const num4 = num2 / num3;
                        const num5 = num4 * 0.05;
                        num += num5;
                    }
                }
            }
        }
    }
    return num;
}

/** Empire.3.cs 856 CalculatePirateControlPopulationValue. */
export function calculatePirateControlPopulationValue(self: Empire): number {
    let num = 0;
    if (self.pirateEmpireBaseHabitat !== null) {
        for (let i = 0; i < self.colonies.length; i++) {
            const habitat = self.colonies[i];
            if (habitat == null || habitat.hasBeenDestroyed || habitat.population == null) continue;
            if (habitat.empire === self) {
                num += habitat.population.totalAmount;
                continue;
            }
            const byFaction = habitat.pirateColonyControl.getByFaction(self);
            if (byFaction !== null) {
                // (long)(ControlLevel * (float)TotalAmount): float product.
                const num2 = Math.trunc(Math.fround(byFaction.controlLevel * Math.fround(habitat.population.totalAmount)));
                num += num2;
            }
        }
    }
    return num;
}

/** ResearchNodeList.cs 15 CalculateTotalCostResearchedProjects (float accumulation). */
export function calculateTotalCostResearchedProjects(techTree: readonly TechNode[]): number {
    let researchedProjects = 0.0;
    for (let index = 0; index < techTree.length; ++index) {
        const researchNode = techTree[index];
        if (researchNode != null && researchNode.isResearched) researchedProjects = Math.fround(researchedProjects + researchNode.cost);
    }
    return researchedProjects;
}

/** ResearchNodeList.cs 27 / 63: the 24 categories CountCompletedCategories checks, in order. */
const COMPLETED_CATEGORY_LIST: readonly ComponentCategoryType[] = [
    ComponentCategoryType.Armor,
    ComponentCategoryType.Computer,
    ComponentCategoryType.Construction,
    ComponentCategoryType.EnergyCollector,
    ComponentCategoryType.Engine,
    ComponentCategoryType.Extractor,
    ComponentCategoryType.Fighter,
    ComponentCategoryType.Habitation,
    ComponentCategoryType.HyperDisrupt,
    ComponentCategoryType.HyperDrive,
    ComponentCategoryType.Labs,
    ComponentCategoryType.Manufacturer,
    ComponentCategoryType.Reactor,
    ComponentCategoryType.Sensor,
    ComponentCategoryType.ShieldRecharge,
    ComponentCategoryType.Shields,
    ComponentCategoryType.Storage,
    ComponentCategoryType.WeaponArea,
    ComponentCategoryType.WeaponBeam,
    ComponentCategoryType.WeaponIon,
    ComponentCategoryType.WeaponPointDefense,
    ComponentCategoryType.WeaponTorpedo,
    ComponentCategoryType.WeaponGravity,
    ComponentCategoryType.AssaultPod,
];

/** ResearchNodeList.cs 99 CheckCategoryComplete(category) with 194 GetProjectsByCategory inlined. */
export function checkCategoryComplete(techTree: readonly TechNode[], category: ComponentCategoryType): boolean {
    let researchNode: TechNode | null = null;
    for (let index = 0; index < techTree.length; ++index) {
        const n = techTree[index];
        if (componentCategoryByIndex(n.def.category) !== category) continue;
        if (researchNode === null || (n.def.techLevel >= researchNode.def.techLevel && n.cost > researchNode.cost)) researchNode = n;
    }
    return researchNode !== null && researchNode.isResearched;
}

/** ResearchNodeList.cs 27 CountCompletedCategories() / 63 CountCompletedCategories(industry) (industry = null: all). */
export function countCompletedCategories(techTree: readonly TechNode[], industry: IndustryType | null = null): number {
    let num = 0;
    for (let index = 0; index < COMPLETED_CATEGORY_LIST.length; ++index) {
        const c = COMPLETED_CATEGORY_LIST[index];
        if (industry !== null && resolveIndustry(c) !== industry) continue;
        if (checkCategoryComplete(techTree, c)) ++num;
    }
    return num;
}

/** TroopList.cs 271 CountTroopsNotRecruiting. */
export function troopsCountTroopsNotRecruiting(items: readonly Troop[]): number {
    let num = 0;
    for (let index = 0; index < items.length; ++index) {
        let flag = true;
        const troop = items[index];
        const colony = troop.colony as Habitat | null;
        if (troop.readiness < 100.0 && troop.atColony && colony !== null && colony.troopsToRecruit !== null && colony.troopsToRecruit.contains(troop)) flag = false;
        if (flag) ++num;
    }
    return num;
}

/** EmpireCounters.cs 103 TimeSpentAtWar(starDate) (the war counters live in Empire.diplomacyCounters, diplomacy.ts). */
export function timeSpentAtWar(counters: DiplomacyCounters, starDate: number): number {
    let num = 0;
    if (counters.atWarStartDate !== LONG_MAX_VALUE) num = starDate - counters.atWarStartDate;
    return counters.timeSpentAtWarExcludingCurrent + num;
}

/** EmpireCounters.cs 481 ProcessCreatureDeath(creature) (caller: Creature.cs 934 DamageCreature with an empire damager). */
export function countersProcessCreatureDeath(counters: EmpireCounters, creatureType: CreatureType | null): void {
    if (creatureType === null) return;
    switch (creatureType) {
        case CreatureType.Kaltor: ++counters.destroyedCreatureCountKaltor; break;
        case CreatureType.RockSpaceSlug: ++counters.destroyedCreatureCountSpaceSlug; break;
        case CreatureType.DesertSpaceSlug: ++counters.destroyedCreatureCountSandSlug; break;
        case CreatureType.Ardilus: ++counters.destroyedCreatureCountArdilus; break;
        case CreatureType.SilverMist: ++counters.destroyedCreatureCountSilverMist; break;
    }
}

/** EmpireCounters.cs 119 ProcessEmpireElimination(empire, galaxy, thisEmpire) (caller: Empire.cs 4885 CompleteTeardown, M4z1). */
export function countersProcessEmpireElimination(galaxy: Galaxy, counters: EmpireCounters, empire: Empire | null, thisEmpire: Empire | null): void {
    if (empire === null) return;
    const empire1 = identifyMechanoidEmpire(galaxy);
    const empire2 = identifyShakturiEmpire(galaxy);
    if (empire1 !== null && empire === empire1 && thisEmpire !== null) thisEmpire.haveDefeatedAncientGuardians = true;
    if (empire2 !== null && empire === empire2 && thisEmpire !== null) thisEmpire.haveDefeatedShakturi = true;
    if (empire.pirateEmpireBaseHabitat === null) {
        ++counters.eliminateEmpireCount;
        counters.eliminateEmpireStrategicValue += totalColonyStrategicValue(empire);
    } else {
        ++counters.eliminatePirateEmpireCount;
    }
}

/**
 * EmpireCounters.cs 45-50 intelligence counters. TODO(port) M4z2: the espionage package adds them (ProcessIntelligenceMissionOutcome,
 * EmpireCounters.cs 234); read defensively (0 until then).
 */
type IntelCounterName =
    | 'intelligenceMissionSuccessEspionageCount'
    | 'intelligenceMissionSuccessSabotageCount'
    | 'intelligenceMissionSuccessCounterIntelligenceCount';
export function intelligenceCounter(empire: Empire, name: IntelCounterName): number {
    return (empire.counters as unknown as Partial<Record<IntelCounterName, number>>)[name] ?? 0;
}

function characters(empire: Empire): Character[] {
    return empire.characters as Character[];
}

/** The best character of `role` by GetSkillLevelTotal (first wins ties); null when there is none. */
function mostExperiencedCharacter(empire: Empire, role: CharacterRole): Character | null {
    const charactersByRole = getCharactersByRole(characters(empire), role);
    let character: Character | null = null;
    for (let j = 0; j < charactersByRole.length; j++) {
        const character2 = charactersByRole[j];
        if (character === null || character2.getSkillLevelTotal() > character.getSkillLevelTotal()) character = character2;
    }
    return character;
}

// ---------------------------------------------------------------------------------------------------------------
// Galaxy.1.cs victory checks
// ---------------------------------------------------------------------------------------------------------------

/** Galaxy.DoTasks victory arguments (Main.Part12.cs 3980): _Game.GlobalVictoryConditions / PlayerVictoryConditionsToAchieve / ToPrevent. */
export interface GalaxyVictoryArgs {
    globalVictoryConditions: VictoryConditions | null;
    playerConditionsToAchieve: EmpireVictoryConditions | null;
    playerConditionsToPrevent: EmpireVictoryConditions | null;
}

/** The frame driver's arguments: the Game object's victory settings (stand-ins on the Galaxy, see its M4z4 fields). */
export function gameVictoryArgs(galaxy: Galaxy): GalaxyVictoryArgs {
    return {
        globalVictoryConditions: galaxy.globalVictoryConditions,
        playerConditionsToAchieve: galaxy.playerVictoryConditionsToAchieve,
        playerConditionsToPrevent: galaxy.playerVictoryConditionsToPrevent,
    };
}

/** Galaxy.1.cs 88 CheckVictoryConditions(playerEmpire, globalVictoryConditions, playerConditionsToAchieve, playerConditionsToPrevent). */
export function checkVictoryConditions(galaxy: Galaxy, playerEmpire: Empire | null, args: GalaxyVictoryArgs | null = null): void {
    const globalVictoryConditions = args?.globalVictoryConditions ?? null;
    const playerConditionsToAchieve = args?.playerConditionsToAchieve ?? null;
    const playerConditionsToPrevent = args?.playerConditionsToPrevent ?? null;
    const currentStarDate = galaxyStarDate(galaxy);
    let num = currentStarDate;
    if (globalVictoryConditions !== null && globalVictoryConditions.startDate > 0) num = globalVictoryConditions.startDate;
    if (currentStarDate < num) return;
    let description = '';
    if (globalVictoryConditions !== null) {
        // 102-130 time limit: the playable empire with the highest TotalColonyStrategicValue wins.
        if (globalVictoryConditions.timeLimit && currentStarDate >= globalVictoryConditions.timeLimitDate) {
            let empire: Empire | null = null;
            let num2 = 0;
            for (let i = 0; i < galaxy.empires.length; i++) {
                const empire2 = galaxy.empires[i];
                if (totalColonyStrategicValue(empire2) > num2 && empire2.dominantRace !== null && empire2.dominantRace.playable) {
                    empire = empire2;
                    num2 = totalColonyStrategicValue(empire2);
                }
            }
            if (empire !== null) {
                let gameEndOutcome = GameEndOutcome.Undefined;
                if (empire === playerEmpire) {
                    gameEndOutcome = GameEndOutcome.Victory;
                    description += formatText(getText('Victory Conditions Time Limit Win'), resolveStarDateDescription(globalVictoryConditions.timeLimitDate));
                } else {
                    gameEndOutcome = GameEndOutcome.Defeat;
                    description += formatText(getText('Victory Conditions Time Limit Lose'), resolveStarDateDescription(globalVictoryConditions.timeLimitDate), empire.name);
                }
                onGameEnd(galaxy, new GameEndEventArgs(empire, gameEndOutcome, description, 0));
            }
        }
        // 131-143
        const r = checkGlobalVictoryConditions(galaxy, playerEmpire, globalVictoryConditions);
        description = r.description;
        const empire3 = r.empire;
        if (empire3 !== null) {
            if (empire3 === playerEmpire) {
                onGameEnd(galaxy, new GameEndEventArgs(empire3, GameEndOutcome.Victory, description, r.code));
            } else {
                onGameEnd(galaxy, new GameEndEventArgs(empire3, GameEndOutcome.Defeat, description, r.code));
            }
        }
    }
    // 145-152
    if (checkEmpireVictoryConditionsToAchieve(galaxy, playerConditionsToAchieve, playerEmpire)) {
        onGameEnd(galaxy, new GameEndEventArgs(playerEmpire, GameEndOutcome.Victory, description, 0));
    }
    if (checkEmpireVictoryConditionsToPrevent(galaxy, playerConditionsToPrevent, playerEmpire)) {
        onGameEnd(galaxy, new GameEndEventArgs(null, GameEndOutcome.Defeat, description, 0));
    }
}

/** Galaxy.1.cs 155 CheckVictoryConditionsWinner(requireReachVictoryThreshold) (reads Galaxy.GlobalVictoryConditions). */
export function checkVictoryConditionsWinner(galaxy: Galaxy, requireReachVictoryThreshold: boolean): Empire | null {
    const gvc = galaxy.globalVictoryConditions;
    if (gvc !== null) {
        const victoryConditionProgressList = generateVictoryConditionProgresses(galaxy, gvc, false);
        const victoryConditionProgressList2: VictoryConditionProgress[] = [];
        for (let i = 0; i < victoryConditionProgressList.length; i++) {
            if (!requireReachVictoryThreshold || victoryConditionProgressList[i].totalProgress >= gvc.victoryThresholdPercentage) victoryConditionProgressList2.push(victoryConditionProgressList[i]);
        }
        let victoryConditionProgress: VictoryConditionProgress | null = null;
        if (victoryConditionProgressList2.length > 0) {
            for (let j = 0; j < victoryConditionProgressList2.length; j++) {
                const p = victoryConditionProgressList2[j];
                if (victoryConditionProgress === null || p.totalProgress > victoryConditionProgress.totalProgress || (p.totalProgress === victoryConditionProgress.totalProgress && totalColonyStrategicValue(p.empire) > totalColonyStrategicValue(victoryConditionProgress.empire))) {
                    victoryConditionProgress = p;
                }
            }
        }
        if (victoryConditionProgress !== null) return victoryConditionProgress.empire;
    }
    return null;
}

/**
 * Galaxy.1.cs 187 GenerateVictoryConditionProgresses(galaxy, globalVictoryConditions, filterOutUnmetEmpires): the
 * per-empire territory / economy / population / race-condition progress (victory-progress reporting; the UI's
 * GameVictoryConditions / RaceVictoryConditionsPanel read it). A pirate player compares pirate factions.
 */
export function generateVictoryConditionProgresses(galaxy: Galaxy, globalVictoryConditions: VictoryConditions | null, filterOutUnmetEmpires: boolean): VictoryConditionProgress[] {
    let victoryConditionProgressList: VictoryConditionProgress[] = [];
    const currentStarDate = galaxyStarDate(galaxy);
    if (globalVictoryConditions !== null) {
        const playerEmpire = galaxy.playerEmpire!;
        const empire = identifyShakturiEmpire(galaxy);
        const empire2 = identifyMechanoidEmpire(galaxy);
        let empireList = galaxy.empires;
        if (playerEmpire.pirateEmpireBaseHabitat !== null) empireList = galaxy.pirateEmpires;
        let num = 0;
        let num2 = 0.0;
        let num3 = 0.0;
        for (let i = 0; i < empireList.length; i++) {
            const empire3 = empireList[i];
            if (empire3 != null && empire3.active && empire3 !== galaxy.independentEmpire && empire3 !== empire && empire3 !== empire2) {
                if (playerEmpire.pirateEmpireBaseHabitat !== null) {
                    const pc = habitatListGetPirateControlledColonies(empire3.colonies, empire3);
                    const num4 = habitatListTotalPopulation(pc.ownedColonies);
                    const num5 = habitatListTotalPopulation(pc.controlledColonies);
                    num += num4 + Math.trunc(num5 / 2);
                    num2 += calculateAccurateAnnualIncome(galaxy, empire3);
                    num3 += pc.ownedColonies.length;
                    num3 += pc.controlledColonies.length / 2.0;
                } else {
                    num += empire3.totalPopulation;
                    num2 += privateAnnualRevenue(galaxy, empire3);
                    num3 += empire3.colonies.length;
                }
            }
        }
        num = Math.max(100, num);
        num2 = Math.max(1.0, num2);
        num3 = Math.max(1.0, num3);
        const num6 = Math.trunc(num * (globalVictoryConditions.populationPercent / 100.0));
        const num7 = num2 * (globalVictoryConditions.economyPercent / 100.0);
        const num8 = Math.trunc(0.99 + num3 * (globalVictoryConditions.territoryPercent / 100.0));
        victoryConditionProgressList = [];
        for (let j = 0; j < empireList.length; j++) {
            const empire4 = empireList[j];
            if (empire4 == null || !empire4.active || empire4 === galaxy.independentEmpire || empire4 === empire || empire4 === empire2) continue;
            let flag = true;
            if (filterOutUnmetEmpires && empire4 !== playerEmpire) {
                if (empire4.pirateEmpireBaseHabitat === null && playerEmpire.pirateEmpireBaseHabitat === null) {
                    const diplomaticRelation = obtainDiplomaticRelation(playerEmpire, empire4);
                    if (diplomaticRelation.type === DiplomaticRelationType.NotMet) flag = false;
                } else {
                    const pirateRelation = obtainPirateRelation(playerEmpire, empire4);
                    if (pirateRelation.type === PirateRelationType.NotMet) flag = false;
                }
            }
            if (!flag) continue;
            let conditionProgresses: RaceVictoryConditionProgress[] | null = null;
            if (globalVictoryConditions.enableRaceSpecificVictoryConditions) {
                conditionProgresses = calculateRaceVictoryConditionsProgress(galaxy, empire4, empire4.dominantRace).conditionProgresses;
            }
            let territoryPercent = 0.0;
            let economyPercent = 0.0;
            let populationPercent = 0.0;
            let territoryProgress = 0.0;
            let economyProgress = 0.0;
            let populationProgress = 0.0;
            if (globalVictoryConditions.territory) {
                if (empire4.pirateEmpireBaseHabitat !== null) {
                    const c = habitatListCountPirateControlledColonies(empire4.colonies, empire4);
                    const num10 = c.ownedColonyCount + c.count / 2.0;
                    territoryPercent = num10 / num3;
                    territoryProgress = Math.max(0.0, Math.min(1.0, num10 / num8));
                } else {
                    territoryPercent = empire4.colonies.length / num3;
                    territoryProgress = Math.max(0.0, Math.min(1.0, empire4.colonies.length / num8));
                }
            }
            if (globalVictoryConditions.economy) {
                if (empire4.pirateEmpireBaseHabitat !== null) {
                    const num11 = calculateAccurateAnnualIncome(galaxy, empire4);
                    economyPercent = num11 / num2;
                    economyProgress = Math.max(0.0, Math.min(1.0, num11 / num7));
                } else {
                    const rev = privateAnnualRevenue(galaxy, empire4);
                    economyPercent = rev / num2;
                    economyProgress = Math.max(0.0, Math.min(1.0, privateAnnualRevenue(galaxy, empire4) / num7));
                }
            }
            if (globalVictoryConditions.population) {
                if (empire4.pirateEmpireBaseHabitat !== null) {
                    const pc2 = habitatListGetPirateControlledColonies(empire4.colonies, empire4);
                    const num12 = habitatListTotalPopulation(pc2.ownedColonies);
                    const num13 = habitatListTotalPopulation(pc2.controlledColonies);
                    const num14 = num12 + Math.trunc(num13 / 2);
                    populationPercent = num14 / num;
                    populationProgress = Math.max(0.0, Math.min(1.0, num14 / num6));
                } else {
                    populationPercent = empire4.totalPopulation / num;
                    populationProgress = Math.max(0.0, Math.min(1.0, empire4.totalPopulation / num6));
                }
            }
            const victoryConditionProgress = new VictoryConditionProgress(empire4, globalVictoryConditions.territory, globalVictoryConditions.economy, globalVictoryConditions.population, territoryProgress, economyProgress, populationProgress, conditionProgresses);
            victoryConditionProgress.territoryPercent = territoryPercent;
            victoryConditionProgress.economyPercent = economyPercent;
            victoryConditionProgress.populationPercent = populationPercent;
            // 328-336 pirate bonus: 1 % per 500 M owned population.
            if (empire4.pirateEmpireBaseHabitat !== null && empire4.colonies != null) {
                const num15 = habitatListTotalPopulationOwnedColonies(empire4.colonies, empire4);
                if (num15 > 0) {
                    let num16 = num15 / 500000000.0;
                    num16 = victoryConditionProgress.pirateBonusAmount = num16 / 100.0;
                }
            }
            // 337-346: VictoryBonus is a float field (added as double).
            if (empire4.victoryBonus !== 0) victoryConditionProgress.bonusAmount += empire4.victoryBonus;
            const num17 = calculateVictoryBonusFromStandingWonders(empire4, currentStarDate);
            if (num17 > 0.0) {
                victoryConditionProgress.standingWonderBonusAmount = num17;
                victoryConditionProgress.bonusAmount += num17;
            }
            victoryConditionProgressList.push(victoryConditionProgress);
        }
    }
    return victoryConditionProgressList;
}

/** Galaxy.1.cs 353 ResolvePirateVictoryConditions(playStyle): the pirate "race" conditions per play style. */
export function resolvePirateVictoryConditions(playStyle: PiratePlayStyle): VictoryCondition[] {
    const T = RaceVictoryConditionType;
    const c = (type: RaceVictoryConditionType, amount: number, proportion: number): VictoryCondition => ({ type, amount, proportion: Math.fround(proportion), additionalData: null });
    const raceVictoryConditionList: VictoryCondition[] = [];
    switch (playStyle) {
        case PiratePlayStyle.Balanced:
            raceVictoryConditionList.push(c(T.PirateControlColoniesPercentage, 10.0, 20));
            raceVictoryConditionList.push(c(T.PirateBuildCriminalNetwork, 0.0, 20));
            raceVictoryConditionList.push(c(T.PirateMostProtectionIncome, 0.0, 20));
            raceVictoryConditionList.push(c(T.PirateMostSuccessfulMissionsAttack, 0.0, 20));
            raceVictoryConditionList.push(c(T.CaptureMostShips, 0.0, 20));
            break;
        case PiratePlayStyle.Pirate:
            raceVictoryConditionList.push(c(T.PirateEliminateMostPirateFactions, 0.0, 20));
            raceVictoryConditionList.push(c(T.PirateControlColoniesPercentage, 10.0, 20));
            raceVictoryConditionList.push(c(T.PirateMostSuccessfulRaids, 0.0, 20));
            raceVictoryConditionList.push(c(T.PirateBuildMostHiddenBases, 0.0, 20));
            raceVictoryConditionList.push(c(T.PirateBuildHiddenFortress, 0.0, 20));
            break;
        case PiratePlayStyle.Mercenary:
            raceVictoryConditionList.push(c(T.PirateMostSuccessfulMissionsAttack, 0.0, 20));
            raceVictoryConditionList.push(c(T.PirateMostSuccessfulMissionsDefend, 0.0, 20));
            raceVictoryConditionList.push(c(T.PirateMostSuccessfulRaids, 0.0, 20));
            raceVictoryConditionList.push(c(T.CaptureMostShips, 0.0, 20));
            raceVictoryConditionList.push(c(T.PirateBuildCriminalNetwork, 0.0, 20));
            break;
        case PiratePlayStyle.Smuggler:
            raceVictoryConditionList.push(c(T.PirateMostSmugglingIncome, 0.0, 40));
            raceVictoryConditionList.push(c(T.PirateMostProtectionIncome, 0.0, 15));
            raceVictoryConditionList.push(c(T.MostIntelligenceMissionsSucceed, 0.0, 15));
            raceVictoryConditionList.push(c(T.ResearchMostAdvanced, 0.0, 15));
            raceVictoryConditionList.push(c(T.PirateBuildCriminalNetwork, 0.0, 15));
            break;
    }
    return raceVictoryConditionList;
}

/** Galaxy.ResolveDescription(HabitatCategoryType).ToLower(InvariantCulture) for the colony victory messages. */
function categoryDescriptionLower(habitat: Habitat): string {
    return resolveDescription(HabitatCategoryType as unknown as Record<number, string>, habitat.category).toLowerCase();
}

/**
 * DecimateEmpire (Galaxy.1.cs 794; Rnd Next(0, 100) per built object, Next(0, 10) per colony) and GuardiansDepart
 * (Galaxy.1.cs 688) run only when a story event has set GlobalVictoryConditions.TargetHabitat (Galaxy.8.cs 2225
 * GenerateFreedomAlliance). Story events are M4z3's.
 */
function decimateEmpireAndGuardiansDepart(): never {
    // RND: Galaxy.1.cs 794 DecimateEmpire draws not drawn until M4z3.
    throw new Error('TODO(port) M4z3: Galaxy.1.cs 429-430 DecimateEmpire(TargetHabitatEmpire, player) / GuardiansDepart (story Freedom Alliance victory)');
}

/** Galaxy.1.cs 390 CheckGlobalVictoryConditions(playerEmpire, globalVictoryConditions, out description, out code). */
export function checkGlobalVictoryConditions(galaxy: Galaxy, playerEmpire: Empire | null, globalVictoryConditions: VictoryConditions | null): { empire: Empire | null; description: string; code: number } {
    let description = '';
    let code = 0;
    if (globalVictoryConditions !== null) {
        // 396-405: galaxy totals (dead stores in the C#: the CheckVictoryTerritory/Economy/Population callers are gone).
        let num = 0;
        let num2 = 0.0;
        let num3 = 0;
        for (let i = 0; i < galaxy.empires.length; i++) {
            const empire = galaxy.empires[i];
            num += empire.totalPopulation;
            num2 += privateAnnualRevenue(galaxy, empire);
            num3 += empire.colonies.length;
        }
        void num;
        void num2;
        void num3;
        // 406-424 DefendHabitat lost.
        let empire2: Empire | null = null;
        const dh = globalVictoryConditions.defendHabitat;
        if (dh !== null && globalVictoryConditions.defendHabitatEmpire !== null && (dh.hasBeenDestroyed || dh.empire !== globalVictoryConditions.defendHabitatEmpire)) {
            const empire3 = identifyShakturiEmpire(galaxy);
            if (empire3 !== null) {
                empire2 = empire3;
            } else if (dh.empire !== null && dh.empire !== galaxy.independentEmpire) {
                empire2 = dh.empire;
                const empire4 = identifyMechanoidEmpire(galaxy);
                if (empire4 !== null && globalVictoryConditions.defendHabitatEmpire === empire4) empire2.haveDefeatedAncientGuardians = true;
            }
            code = 1;
        }
        // 425-434 TargetHabitat taken.
        let empire5: Empire | null = null;
        const th = globalVictoryConditions.targetHabitat;
        if (th !== null && globalVictoryConditions.targetHabitatEmpire !== null && (th.hasBeenDestroyed || th.empire !== globalVictoryConditions.targetHabitatEmpire)) {
            empire5 = playerEmpire;
            decimateEmpireAndGuardiansDepart();
        }
        // 435
        const empire6 = checkVictoryConditionsWinner(galaxy, true);
        let empire7: Empire | null = null;
        if (empire2 !== null) {
            empire7 = empire2;
            let text = empire7.name;
            if (empire7 === playerEmpire) text = getText('You');
            if (dh!.hasBeenDestroyed) {
                description += formatText(getText('Victory Conditions Colony Destroy'), text, categoryDescriptionLower(dh!), dh!.name);
            } else if (dh!.empire === empire2) {
                description += formatText(getText('Victory Conditions Colony Invade'), text, categoryDescriptionLower(dh!), dh!.name);
            } else {
                description += formatText(getText('Victory Conditions Colony Cause Loss'), text, categoryDescriptionLower(dh!), dh!.name, globalVictoryConditions.defendHabitatEmpire!.name);
            }
        }
        if (empire5 !== null) {
            // 458-478: unreachable until the TargetHabitat branch above is ported (M4z3).
            empire7 = empire5;
        }
        if (empire7 === null && empire6 !== null) {
            empire7 = empire6;
            if (empire7 === playerEmpire) {
                description += getText('Victory Conditions Threshold Win');
            } else {
                description += formatText(getText('Victory Conditions Threshold Lose'), empire7.name);
            }
        }
        return { empire: empire7, description, code };
    }
    return { empire: null, description, code };
}

/** Galaxy.1.cs 496 CheckEmpireVictoryConditionsToPrevent(empireVictoryConditions, playerEmpire). */
export function checkEmpireVictoryConditionsToPrevent(galaxy: Galaxy, empireVictoryConditions: EmpireVictoryConditions | null, playerEmpire: Empire | null): boolean {
    if (empireVictoryConditions !== null) {
        let flag = true;
        if (empireVictoryConditions.captureColonies.length > 0) {
            for (const captureColony of empireVictoryConditions.captureColonies) {
                if (captureColony.owner === playerEmpire) flag = false;
            }
        }
        let flag2 = true;
        if (empireVictoryConditions.eliminateEmpires.length > 0) {
            for (const eliminateEmpire of empireVictoryConditions.eliminateEmpires) {
                if (eliminateEmpire.active) flag2 = false;
            }
        }
        let flag3 = true;
        if (empireVictoryConditions.destroyBuiltObjects.length > 0) {
            for (const destroyBuiltObject of empireVictoryConditions.destroyBuiltObjects) {
                if (galaxy.builtObjects.includes(destroyBuiltObject)) flag3 = false;
            }
        }
        if (flag && flag2 && flag3 && (empireVictoryConditions.captureColonies.length > 0 || empireVictoryConditions.eliminateEmpires.length > 0 || empireVictoryConditions.destroyBuiltObjects.length > 0)) return true;
    }
    return false;
}

/** Galaxy.1.cs 541 CheckEmpireVictoryConditionsToAchieve(empireVictoryConditions, playerEmpire). */
export function checkEmpireVictoryConditionsToAchieve(galaxy: Galaxy, empireVictoryConditions: EmpireVictoryConditions | null, playerEmpire: Empire | null): boolean {
    if (empireVictoryConditions !== null) {
        let flag = true;
        if (empireVictoryConditions.captureColonies.length > 0) {
            for (const captureColony of empireVictoryConditions.captureColonies) {
                if (captureColony.owner !== playerEmpire) flag = false;
            }
        }
        let flag2 = true;
        if (empireVictoryConditions.eliminateEmpires.length > 0) {
            for (const eliminateEmpire of empireVictoryConditions.eliminateEmpires) {
                if (eliminateEmpire.active) flag2 = false;
            }
        }
        let flag3 = true;
        if (empireVictoryConditions.destroyBuiltObjects.length > 0) {
            for (const destroyBuiltObject of empireVictoryConditions.destroyBuiltObjects) {
                if (galaxy.builtObjects.includes(destroyBuiltObject)) flag3 = false;
            }
        }
        if (flag && flag2 && flag3 && (empireVictoryConditions.captureColonies.length > 0 || empireVictoryConditions.eliminateEmpires.length > 0 || empireVictoryConditions.destroyBuiltObjects.length > 0)) return true;
    }
    return false;
}

/** Galaxy.1.cs 586 CheckVictoryTerritory(victoryConditions, totalTerritory) (private, no caller left in 1.9.5). */
export function checkVictoryTerritory(galaxy: Galaxy, victoryConditions: VictoryConditions, totalTerritory: number): Empire | null {
    if (victoryConditions.territory) {
        const empireList: Empire[] = [];
        const num = Math.trunc(0.99 + totalTerritory * (victoryConditions.territoryPercent / 100.0));
        for (let i = 0; i < galaxy.empires.length; i++) {
            const empire = galaxy.empires[i];
            if (empire.colonies.length >= num && empire.dominantRace !== null && empire.dominantRace.playable) empireList.push(empire);
        }
        if (empireList.length > 0) {
            let result: Empire | null = null;
            let num2 = 0;
            for (const item of empireList) {
                if (item.colonies.length > num2) {
                    result = item;
                    num2 = item.colonies.length;
                }
            }
            return result;
        }
    }
    return null;
}

/** Galaxy.1.cs 620 CheckVictoryEconomy(victoryConditions, totalEconomy) (private, no caller left in 1.9.5). */
export function checkVictoryEconomy(galaxy: Galaxy, victoryConditions: VictoryConditions, totalEconomy: number): Empire | null {
    if (victoryConditions.economy) {
        const empireList: Empire[] = [];
        const num = totalEconomy * (victoryConditions.economyPercent / 100.0);
        for (let i = 0; i < galaxy.empires.length; i++) {
            const empire = galaxy.empires[i];
            if (privateAnnualRevenue(galaxy, empire) >= num && empire.dominantRace !== null && empire.dominantRace.playable) empireList.push(empire);
        }
        if (empireList.length > 0) {
            let result: Empire | null = null;
            let num2 = 0.0;
            for (const item of empireList) {
                if (privateAnnualRevenue(galaxy, item) > num2) {
                    result = item;
                    num2 = privateAnnualRevenue(galaxy, item);
                }
            }
            return result;
        }
    }
    return null;
}

/** Galaxy.1.cs 654 CheckVictoryPopulation(victoryConditions, totalPopulation) (private, no caller left in 1.9.5). */
export function checkVictoryPopulation(galaxy: Galaxy, victoryConditions: VictoryConditions, totalPopulation: number): Empire | null {
    if (victoryConditions.population) {
        const empireList: Empire[] = [];
        const num = Math.trunc(totalPopulation * (victoryConditions.populationPercent / 100.0));
        for (let i = 0; i < galaxy.empires.length; i++) {
            const empire = galaxy.empires[i];
            if (empire.totalPopulation >= num && empire.dominantRace !== null && empire.dominantRace.playable) empireList.push(empire);
        }
        if (empireList.length > 0) {
            let result: Empire | null = null;
            let num2 = 0;
            for (const item of empireList) {
                if (item.totalPopulation > num2) {
                    result = item;
                    num2 = item.totalPopulation;
                }
            }
            return result;
        }
    }
    return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Galaxy.cs 3808-5247: race victory conditions
// ---------------------------------------------------------------------------------------------------------------

/** Race.VictoryConditions as the evaluator's VictoryCondition list (RaceVictoryCondition carries the same fields). */
function raceConditions(race: Race): VictoryCondition[] | null {
    const list = race.victoryConditions as RaceVictoryCondition[] | null | undefined;
    return list == null ? null : (list as VictoryCondition[]);
}

/**
 * Galaxy.cs 3808 CalculateRaceVictoryConditionsProgress(galaxy, empire, race, out conditionProgresses): the weighted
 * sum of every condition's progress × Proportion / 100 (1.0 when the race has none). Pirate factions use
 * ResolvePirateVictoryConditions(PiratePlayStyle).
 */
export function calculateRaceVictoryConditionsProgress(galaxy: Galaxy, empire: Empire | null, race: Race | null): { progress: number; conditionProgresses: RaceVictoryConditionProgress[] } {
    let num = 0.0;
    const conditionProgresses: RaceVictoryConditionProgress[] = [];
    if (galaxy != null && race !== null && empire !== null) {
        const raceVictoryConditionList = empire.pirateEmpireBaseHabitat !== null ? resolvePirateVictoryConditions(empire.piratePlayStyle) : raceConditions(race);
        if (raceVictoryConditionList === null || raceVictoryConditionList.length === 0) {
            num = 1.0;
        } else {
            for (let i = 0; i < raceVictoryConditionList.length; i++) {
                const raceVictoryCondition = raceVictoryConditionList[i];
                if (raceVictoryCondition != null) {
                    const r = calculateRaceVictoryConditionProgress(galaxy, empire, raceVictoryCondition);
                    const num2 = r.progress;
                    // (double)(raceVictoryCondition.Proportion / 100f): float division.
                    const num3 = num2 * Math.fround(Math.fround(raceVictoryCondition.proportion) / 100);
                    num += num3;
                    conditionProgresses.push(new RaceVictoryConditionProgress(raceVictoryCondition.type, num3, num2, r.bestEmpire, r.detail, raceVictoryCondition));
                }
            }
        }
    }
    netSort(conditionProgresses, (a, b) => compareDouble(a.progressTotalPortion, b.progressTotalPortion));
    conditionProgresses.reverse();
    return { progress: num, conditionProgresses };
}

/** The "Most…" / "Least…" condition types scored by comparing empires (Galaxy.cs 4960-5022 dispatch list). */
const COMPARE_EMPIRES_TYPES: ReadonlySet<RaceVictoryConditionType> = new Set([
    RaceVictoryConditionType.ControlMostRuins,
    RaceVictoryConditionType.PopulationHighest,
    RaceVictoryConditionType.PopulationHappiest,
    RaceVictoryConditionType.MostHomeworlds,
    RaceVictoryConditionType.OwnLargestCapitalShip,
    RaceVictoryConditionType.MostSpaceports,
    RaceVictoryConditionType.MostMiningStations,
    RaceVictoryConditionType.MostResortBases,
    RaceVictoryConditionType.DestroyMostShips,
    RaceVictoryConditionType.DestroyMostTroops,
    RaceVictoryConditionType.DestroyMostCreaturesByType,
    RaceVictoryConditionType.LoseFewestShips,
    RaceVictoryConditionType.LoseFewestTroops,
    RaceVictoryConditionType.MostIntelligenceMissionsSucceed,
    RaceVictoryConditionType.MostIntelligenceMissionsIntercepted,
    RaceVictoryConditionType.ConquerMostEnemyColonies,
    RaceVictoryConditionType.ExterminateOrEnslaveMostPopulation,
    RaceVictoryConditionType.MostScientists,
    RaceVictoryConditionType.MostExperiencedAdmiral,
    RaceVictoryConditionType.MostExperiencedGeneral,
    RaceVictoryConditionType.ResearchLeastAdvanced,
    RaceVictoryConditionType.ResearchMostAdvanced,
    RaceVictoryConditionType.ResearchMostCompletedBranches,
    RaceVictoryConditionType.ResearchMostCompletedBranchesByIndustry,
    RaceVictoryConditionType.HighestTradeVolume,
    RaceVictoryConditionType.MostTourismIncome,
    RaceVictoryConditionType.MostTradeIncome,
    RaceVictoryConditionType.HighestPrivateRevenue,
    RaceVictoryConditionType.LargestMilitary,
    RaceVictoryConditionType.LargestMilitaryNonAllied,
    RaceVictoryConditionType.MostTroops,
    RaceVictoryConditionType.MostTroopsNonAllied,
    RaceVictoryConditionType.LeastWarsStarted,
    RaceVictoryConditionType.LeastBrokenTreaties,
    RaceVictoryConditionType.LeastTreaties,
    RaceVictoryConditionType.MostTimeWarring,
    RaceVictoryConditionType.LeastTimeWarring,
    RaceVictoryConditionType.MostSubjugatedDominions,
    RaceVictoryConditionType.OldestMutualDefensePact,
    RaceVictoryConditionType.OldestFreeTradeAgreement,
    RaceVictoryConditionType.ExploreMostSystems,
    RaceVictoryConditionType.MineMostResourcesLuxury,
    RaceVictoryConditionType.MineMostResourcesStrategic,
    RaceVictoryConditionType.BuildMostMilitaryShips,
    RaceVictoryConditionType.BuildMostCivilianShips,
    RaceVictoryConditionType.BuildMostBases,
    RaceVictoryConditionType.CaptureMostShips,
    RaceVictoryConditionType.PirateBuildMostHiddenBases,
    RaceVictoryConditionType.PirateEliminateMostPirateFactions,
    RaceVictoryConditionType.PirateMostSuccessfulMissionsAttack,
    RaceVictoryConditionType.PirateMostSuccessfulMissionsDefend,
    RaceVictoryConditionType.PirateMostSmugglingIncome,
    RaceVictoryConditionType.PirateMostProtectionIncome,
    RaceVictoryConditionType.PirateMostSuccessfulRaids,
    RaceVictoryConditionType.MineMostResourcesColonyManufactured,
]);

/** Galaxy.cs 4101-4135 / 4400-4442: the "higher is better" set (flag = num > 0; best = max; result = num / best). */
const MOST_TYPES: ReadonlySet<RaceVictoryConditionType> = new Set([
    RaceVictoryConditionType.ControlMostRuins,
    RaceVictoryConditionType.PopulationHighest,
    RaceVictoryConditionType.PopulationHappiest,
    RaceVictoryConditionType.MostHomeworlds,
    RaceVictoryConditionType.OwnLargestCapitalShip,
    RaceVictoryConditionType.MostSpaceports,
    RaceVictoryConditionType.MostMiningStations,
    RaceVictoryConditionType.MostResortBases,
    RaceVictoryConditionType.DestroyMostShips,
    RaceVictoryConditionType.DestroyMostTroops,
    RaceVictoryConditionType.DestroyMostCreaturesByType,
    RaceVictoryConditionType.MostIntelligenceMissionsSucceed,
    RaceVictoryConditionType.MostIntelligenceMissionsIntercepted,
    RaceVictoryConditionType.ConquerMostEnemyColonies,
    RaceVictoryConditionType.ExterminateOrEnslaveMostPopulation,
    RaceVictoryConditionType.MostScientists,
    RaceVictoryConditionType.MostExperiencedAdmiral,
    RaceVictoryConditionType.MostExperiencedGeneral,
    RaceVictoryConditionType.ResearchMostAdvanced,
    RaceVictoryConditionType.ResearchMostCompletedBranches,
    RaceVictoryConditionType.ResearchMostCompletedBranchesByIndustry,
    RaceVictoryConditionType.HighestTradeVolume,
    RaceVictoryConditionType.MostTourismIncome,
    RaceVictoryConditionType.MostTradeIncome,
    RaceVictoryConditionType.HighestPrivateRevenue,
    RaceVictoryConditionType.LargestMilitary,
    RaceVictoryConditionType.LargestMilitaryNonAllied,
    RaceVictoryConditionType.MostTroops,
    RaceVictoryConditionType.MostTroopsNonAllied,
    RaceVictoryConditionType.MostTimeWarring,
    RaceVictoryConditionType.MostSubjugatedDominions,
    RaceVictoryConditionType.ExploreMostSystems,
    RaceVictoryConditionType.MineMostResourcesLuxury,
    RaceVictoryConditionType.MineMostResourcesStrategic,
    RaceVictoryConditionType.BuildMostMilitaryShips,
    RaceVictoryConditionType.BuildMostCivilianShips,
    RaceVictoryConditionType.BuildMostBases,
    RaceVictoryConditionType.CaptureMostShips,
    RaceVictoryConditionType.PirateBuildMostHiddenBases,
    RaceVictoryConditionType.PirateEliminateMostPirateFactions,
    RaceVictoryConditionType.PirateMostSuccessfulMissionsAttack,
    RaceVictoryConditionType.PirateMostSuccessfulMissionsDefend,
    RaceVictoryConditionType.PirateMostSmugglingIncome,
    RaceVictoryConditionType.PirateMostProtectionIncome,
    RaceVictoryConditionType.PirateMostSuccessfulRaids,
    RaceVictoryConditionType.MineMostResourcesColonyManufactured,
]);

/** Galaxy.cs 4156-4163 / 4455-4462: the "lower is better" set (flag always; best = min, worst = max). */
const LEAST_TYPES: ReadonlySet<RaceVictoryConditionType> = new Set([
    RaceVictoryConditionType.LoseFewestShips,
    RaceVictoryConditionType.LoseFewestTroops,
    RaceVictoryConditionType.ResearchLeastAdvanced,
    RaceVictoryConditionType.LeastWarsStarted,
    RaceVictoryConditionType.LeastBrokenTreaties,
    RaceVictoryConditionType.LeastTreaties,
    RaceVictoryConditionType.LeastTimeWarring,
]);

/**
 * The per-empire value a compare-empires condition ranks (Galaxy.cs 3853-4099 for `empire`, 4192-4455 for each rival
 * `empire2`; identical except LargestMilitaryNonAllied / MostTroopsNonAllied, which count a rival only when `empire`
 * has no MutualDefensePact / Protectorate with it). `obj` is the object the value belongs to (character, relation,
 * capital ship) for the ranking's tie-break bookkeeping.
 */
function compareEmpiresValue(galaxy: Galaxy, empire: Empire, subject: Empire, condition: VictoryCondition, currentStarDate: number, isSelf: boolean): { num: number; obj: unknown } {
    const T = RaceVictoryConditionType;
    const counters = subject.counters;
    let num = 0.0;
    let obj: unknown = null;
    switch (condition.type) {
        case T.CaptureMostShips: num = counters.captureShipCount; break;
        case T.PirateEliminateMostPirateFactions: num = counters.eliminatePirateEmpireCount; break;
        case T.PirateMostProtectionIncome: num = counters.pirateProtectionIncome; break;
        case T.PirateMostSmugglingIncome: num = counters.pirateSmugglingIncome; break;
        case T.PirateMostSuccessfulMissionsAttack: num = counters.completedPirateMissionAttackCount; break;
        case T.PirateMostSuccessfulRaids: num = counters.raidSuccessCount; break;
        case T.PirateMostSuccessfulMissionsDefend: num = counters.completedPirateMissionDefendCount; break;
        case T.PirateBuildMostHiddenBases: num = habitatListCountPirateControlledColoniesWithHiddenPirateBase(subject.colonies, subject); break;
        case T.ConquerMostEnemyColonies: num = counters.coloniesConqueredCount; break;
        case T.ControlMostRuins: num = habitatListCountHabitatWithRuins(subject.colonies); break;
        case T.DestroyMostCreaturesByType:
            if (condition.additionalData !== null) {
                switch (condition.additionalData as CreatureType) {
                    case CreatureType.SilverMist: num = counters.destroyedCreatureCountSilverMist; break;
                    case CreatureType.Ardilus: num = counters.destroyedCreatureCountArdilus; break;
                    case CreatureType.DesertSpaceSlug: num = counters.destroyedCreatureCountSandSlug; break;
                    case CreatureType.Kaltor: num = counters.destroyedCreatureCountKaltor; break;
                    case CreatureType.RockSpaceSlug: num = counters.destroyedCreatureCountSpaceSlug; break;
                }
            }
            break;
        case T.DestroyMostShips: num = counters.destroyedEnemyMilitaryShipCount + counters.destroyedEnemyCivilianShipCount; break;
        case T.DestroyMostTroops: num = counters.destroyedEnemyTroopCount; break;
        case T.ExploreMostSystems: num = countExploredSystems(subject.systemVisibility); break;
        case T.ExterminateOrEnslaveMostPopulation: num = counters.exterminatedPopulationAmount + calculateEnslavedPopulationAmount(subject); break;
        case T.HighestPrivateRevenue: num = counters.colonyPrivateRevenueTotal; break;
        case T.HighestTradeVolume: num = counters.tradeIncomeTotalVolume; break;
        case T.LargestMilitary: num = calculateMilitaryShipSizeTotal(subject); break;
        case T.LargestMilitaryNonAllied:
            if (isSelf) {
                num = calculateMilitaryShipSizeTotal(subject);
            } else {
                const diplomaticRelation6 = obtainDiplomaticRelation(empire, subject);
                if (diplomaticRelation6.type !== DiplomaticRelationType.MutualDefensePact && diplomaticRelation6.type !== DiplomaticRelationType.Protectorate) num = calculateMilitaryShipSizeTotal(subject);
            }
            break;
        case T.MostTroops: num = troopsCountTroopsNotRecruiting(subject.troops.items); break;
        case T.MostTroopsNonAllied:
            if (isSelf) {
                num = troopsCountTroopsNotRecruiting(subject.troops.items);
            } else {
                const diplomaticRelation5 = obtainDiplomaticRelation(empire, subject);
                if (diplomaticRelation5.type !== DiplomaticRelationType.MutualDefensePact && diplomaticRelation5.type !== DiplomaticRelationType.Protectorate) num = troopsCountTroopsNotRecruiting(subject.troops.items);
            }
            break;
        case T.LeastBrokenTreaties: num = subject.diplomacyCounters.brokenTreatyCount; break;
        case T.LeastTimeWarring: num = timeSpentAtWar(subject.diplomacyCounters, currentStarDate); break;
        case T.LeastTreaties: num = subject.diplomaticRelations.countTreaties(); break;
        case T.LeastWarsStarted: num = subject.diplomacyCounters.warsWeStartedCount; break;
        case T.LoseFewestShips: num = counters.lossesCivilianShipCount + counters.lossesMilitaryShipCount; break;
        case T.LoseFewestTroops: num = counters.lossesTroopCount; break;
        case T.MostExperiencedAdmiral:
        case T.MostExperiencedGeneral: {
            const character = mostExperiencedCharacter(subject, condition.type === T.MostExperiencedAdmiral ? CharacterRole.FleetAdmiral : CharacterRole.TroopGeneral);
            if (character !== null) {
                num = character.getSkillLevelTotal();
                obj = character;
            }
            break;
        }
        case T.MostHomeworlds: num = countHomeworldsOwned(galaxy, subject); break;
        case T.MostIntelligenceMissionsIntercepted: num = intelligenceCounter(subject, 'intelligenceMissionSuccessCounterIntelligenceCount'); break;
        case T.MostIntelligenceMissionsSucceed: num = intelligenceCounter(subject, 'intelligenceMissionSuccessEspionageCount') + intelligenceCounter(subject, 'intelligenceMissionSuccessSabotageCount'); break;
        case T.MostMiningStations: num = subject.miningStations.length; break;
        case T.MostResortBases: num = subject.resortBases.length; break;
        case T.MostScientists: num = countCharactersByRole(characters(subject), CharacterRole.Scientist); break;
        case T.MostSpaceports: num = subject.spacePorts.length; break;
        case T.MostSubjugatedDominions: num = subject.diplomacyCounters.subjugationsMade; break;
        case T.MostTimeWarring: num = timeSpentAtWar(subject.diplomacyCounters, currentStarDate); break;
        case T.MostTourismIncome: num = counters.tourismIncome; break;
        case T.MostTradeIncome: num = counters.tradeIncomeStateBonus; break;
        case T.OldestFreeTradeAgreement:
        case T.OldestMutualDefensePact: {
            const diplomaticRelation = subject.diplomaticRelations.findOldestRelationByType(condition.type === T.OldestFreeTradeAgreement ? DiplomaticRelationType.FreeTradeAgreement : DiplomaticRelationType.MutualDefensePact);
            if (diplomaticRelation !== null) {
                num = diplomaticRelation.startDateOfLastChange;
                obj = diplomaticRelation;
            }
            break;
        }
        case T.OwnLargestCapitalShip: {
            const builtObject = largestCapitalShip(subject);
            if (builtObject !== null) {
                num = builtObject.size;
                obj = builtObject;
            }
            break;
        }
        case T.PopulationHappiest: num = averageHappiness(galaxy, subject); break;
        case T.PopulationHighest: num = subject.totalPopulation; break;
        case T.ResearchLeastAdvanced:
        case T.ResearchMostAdvanced: num = calculateTotalCostResearchedProjects(subject.research.techTree); break;
        case T.ResearchMostCompletedBranches: num = countCompletedCategories(subject.research.techTree); break;
        case T.ResearchMostCompletedBranchesByIndustry:
            if (condition.additionalData !== null) num = countCompletedCategories(subject.research.techTree, condition.additionalData as IndustryType);
            break;
        case T.MineMostResourcesLuxury: num = counters.miningExtractionLuxury; break;
        case T.MineMostResourcesStrategic: num = counters.miningExtractionGas + counters.miningExtractionStrategic; break;
        case T.MineMostResourcesColonyManufactured: num = counters.miningExtractionColonyManufactured; break;
        case T.BuildMostMilitaryShips: num = subject.countersBuildMilitaryShipCount; break;
        case T.BuildMostCivilianShips: num = subject.countersBuildCivilianShipCount; break;
        case T.BuildMostBases: num = subject.countersBuildBaseCount; break;
    }
    return { num, obj };
}

/**
 * Galaxy.cs 3844 RaceVictoryConditionMetCompareEmpires(galaxy, empire, condition, out detail, out bestEmpire): ranks
 * `empire` against every active playable empire of its kind (normal or pirate). Most… types score num / best (1.0 when
 * `empire` leads with num > 0); Least… / Oldest… types score (worst − num) / (worst − best); the rank types (homeworlds,
 * largest capital ship, admirals, generals, completed branches; LoseFewestShips, LeastWars, LeastBrokenTreaties,
 * LeastTreaties) score 1 / 0.5 / 0.33 / 0 by rank among the distinct values.
 *
 * C# oddity kept: the rival loop's skip test is `empire2 == obj` (obj = the character / relation / ship of `empire`'s
 * value, never an Empire), so `empire` itself is also compared as a rival.
 */
export function raceVictoryConditionMetCompareEmpires(galaxy: Galaxy, empire: Empire | null, condition: VictoryCondition | null): { result: number; detail: string; bestEmpire: Empire | null } {
    let detail = '';
    let bestEmpire: Empire | null = null;
    if (galaxy != null && empire !== null && empire.counters != null && condition !== null) {
        const T = RaceVictoryConditionType;
        const currentStarDate = galaxyStarDate(galaxy);
        // 3853-4099
        const own = compareEmpiresValue(galaxy, empire, empire, condition, currentStarDate, true);
        const num = own.num;
        const obj = own.obj;
        // 4100-4166
        let flag = false;
        if (MOST_TYPES.has(condition.type)) {
            if (num > 0.0) flag = true;
        } else if (LEAST_TYPES.has(condition.type)) {
            flag = true;
        }
        const list: number[] = [num];
        let num2 = 0.0;
        let num3 = 0.0;
        let obj2: unknown = null;
        if (condition.type === T.OldestMutualDefensePact || condition.type === T.OldestFreeTradeAgreement) num2 = currentStarDate;
        let empireList = galaxy.empires;
        if (empire.pirateEmpireBaseHabitat !== null) empireList = galaxy.pirateEmpires;
        for (let k = 0; k < empireList.length; k++) {
            const empire2 = empireList[k];
            if (empire2 == null || !empire2.active || (empire2 as unknown) === obj || empire2.dominantRace === null || !empire2.dominantRace.playable || empire2.counters == null) continue;
            const rival = compareEmpiresValue(galaxy, empire, empire2, condition, currentStarDate, false);
            const num4 = rival.num;
            const obj3 = rival.obj;
            if (!list.includes(num4)) list.push(num4);
            if (MOST_TYPES.has(condition.type)) {
                if (num4 > num2) {
                    bestEmpire = empire2;
                    num2 = num4;
                    num3 = num4;
                    obj2 = obj3;
                }
            } else if (LEAST_TYPES.has(condition.type)) {
                if (num4 < num2) {
                    bestEmpire = empire2;
                    num2 = num4;
                    obj2 = obj3;
                }
                if (num4 > num3) num3 = num4;
            } else if (condition.type === T.OldestMutualDefensePact || condition.type === T.OldestFreeTradeAgreement) {
                if (num4 !== 0.0 && num4 < num2) {
                    bestEmpire = empire2;
                    num2 = num4;
                    obj2 = obj3;
                }
                if (num4 > num3) num3 = num4;
            }
        }
        void obj2;
        // 4544-4671 score.
        let result = 0.0;
        switch (condition.type) {
            case T.ControlMostRuins:
            case T.PopulationHighest:
            case T.PopulationHappiest:
            case T.MostSpaceports:
            case T.MostMiningStations:
            case T.MostResortBases:
            case T.DestroyMostShips:
            case T.DestroyMostTroops:
            case T.DestroyMostCreaturesByType:
            case T.MostIntelligenceMissionsSucceed:
            case T.MostIntelligenceMissionsIntercepted:
            case T.ConquerMostEnemyColonies:
            case T.ExterminateOrEnslaveMostPopulation:
            case T.MostScientists:
            case T.ResearchMostAdvanced:
            case T.HighestTradeVolume:
            case T.MostTourismIncome:
            case T.MostTradeIncome:
            case T.HighestPrivateRevenue:
            case T.LargestMilitary:
            case T.LargestMilitaryNonAllied:
            case T.MostTroops:
            case T.MostTroopsNonAllied:
            case T.MostTimeWarring:
            case T.MostSubjugatedDominions:
            case T.ExploreMostSystems:
            case T.MineMostResourcesLuxury:
            case T.MineMostResourcesStrategic:
            case T.BuildMostMilitaryShips:
            case T.BuildMostCivilianShips:
            case T.BuildMostBases:
            case T.CaptureMostShips:
            case T.PirateBuildMostHiddenBases:
            case T.PirateEliminateMostPirateFactions:
            case T.PirateMostSuccessfulMissionsAttack:
            case T.PirateMostSuccessfulMissionsDefend:
            case T.PirateMostSmugglingIncome:
            case T.PirateMostProtectionIncome:
            case T.PirateMostSuccessfulRaids:
            case T.MineMostResourcesColonyManufactured:
                if (!flag || !(num >= num2)) {
                    result = !(num2 <= 0.0) ? num / num2 : 0.0;
                    break;
                }
                result = 1.0;
                bestEmpire = empire;
                break;
            case T.LoseFewestTroops:
            case T.ResearchLeastAdvanced:
            case T.LeastTimeWarring:
            case T.OldestMutualDefensePact:
            case T.OldestFreeTradeAgreement:
                if (flag && num <= num2) {
                    result = 1.0;
                    bestEmpire = empire;
                } else {
                    result = (num3 - num) / Math.max(0.0001, num3 - num2);
                }
                break;
            case T.MostHomeworlds:
            case T.OwnLargestCapitalShip:
            case T.MostExperiencedAdmiral:
            case T.MostExperiencedGeneral:
            case T.ResearchMostCompletedBranches:
            case T.ResearchMostCompletedBranchesByIndustry:
                if (flag) {
                    netSort(list, compareDouble);
                    list.reverse();
                    result = rankScore(list.indexOf(num));
                    if (list.indexOf(num) === 0) bestEmpire = empire;
                } else {
                    result = 0.0;
                }
                break;
            case T.LoseFewestShips:
            case T.LeastWarsStarted:
            case T.LeastBrokenTreaties:
            case T.LeastTreaties:
                if (flag) {
                    netSort(list, compareDouble);
                    result = rankScore(list.indexOf(num));
                    if (list.indexOf(num) === 0) bestEmpire = empire;
                } else {
                    result = 0.0;
                }
                break;
        }
        // 4672-4696: the detail names the best empire only when the player has met it.
        let flag2 = true;
        if (bestEmpire !== empire) {
            if (bestEmpire === null) {
                flag2 = false;
            } else if (empire.pirateEmpireBaseHabitat === null && bestEmpire.pirateEmpireBaseHabitat === null) {
                const diplomaticRelation7 = obtainDiplomaticRelation(galaxy.playerEmpire!, bestEmpire);
                if (diplomaticRelation7.type === DiplomaticRelationType.NotMet) flag2 = false;
            } else {
                const pirateRelation = obtainPirateRelation(galaxy.playerEmpire!, bestEmpire);
                if (pirateRelation.type === PirateRelationType.NotMet) flag2 = false;
            }
        }
        if (flag2 && bestEmpire !== null) detail = compareEmpiresDetail(galaxy, bestEmpire, condition, currentStarDate);
        return { result, detail, bestEmpire };
    }
    return { result: 0.0, detail, bestEmpire };
}

/** Galaxy.cs 4621-4636 rank → score: 0 → 1.0, 1 → 0.5, 2 → 0.33, else 0. */
function rankScore(index: number): number {
    switch (index) {
        case 0: return 1.0;
        case 1: return 0.5;
        case 2: return 0.33;
        default: return 0.0;
    }
}

/** Galaxy.cs 4697-4953: the progress detail line about the best empire (TextResolver keys; M9 localises). */
function compareEmpiresDetail(galaxy: Galaxy, bestEmpire: Empire, condition: VictoryCondition, currentStarDate: number): string {
    const T = RaceVictoryConditionType;
    const c = bestEmpire.counters;
    const key = (name: string): string => getText('Race Victory Condition Detail ' + name);
    const year = REAL_SECONDS_IN_GALACTIC_YEAR * 1000.0;
    switch (condition.type) {
        case T.PirateBuildMostHiddenBases: return formatText(key('PirateBuildMostHiddenBases'), formatNumber(habitatListCountPirateControlledColoniesWithHiddenPirateBase(bestEmpire.colonies, bestEmpire), '0'));
        case T.PirateEliminateMostPirateFactions: return formatText(key('PirateEliminateMostPirateFactions'), formatNumber(c.eliminatePirateEmpireCount, '0'));
        case T.PirateMostProtectionIncome: return formatText(key('PirateMostProtectionIncome'), formatNumber(c.pirateProtectionIncome, '0'));
        case T.PirateMostSmugglingIncome: return formatText(key('PirateMostSmugglingIncome'), formatNumber(c.pirateSmugglingIncome, '0'));
        case T.PirateMostSuccessfulMissionsAttack: return formatText(key('PirateMostSuccessfulMissionsAttack'), formatNumber(c.completedPirateMissionAttackCount, '0'));
        case T.PirateMostSuccessfulRaids: return formatText(key('PirateMostSuccessfulRaids'), formatNumber(c.raidSuccessCount, '0'));
        case T.PirateMostSuccessfulMissionsDefend: return formatText(key('PirateMostSuccessfulMissionsDefend'), formatNumber(c.completedPirateMissionDefendCount, '0'));
        case T.CaptureMostShips: return formatText(key('CaptureMostShips'), formatNumber(c.captureShipCount, '0'));
        case T.ConquerMostEnemyColonies: return formatText(key('ConquerMostEnemyColonies'), formatNumber(c.coloniesConqueredCount, '0'));
        case T.ControlMostRuins: return formatText(key('ControlMostRuins'), formatNumber(habitatListCountHabitatWithRuins(bestEmpire.colonies), '0'));
        case T.DestroyMostCreaturesByType: {
            if (condition.additionalData === null) return '';
            let num5 = 0;
            switch (condition.additionalData as CreatureType) {
                case CreatureType.SilverMist: num5 = c.destroyedCreatureCountSilverMist; break;
                case CreatureType.Ardilus: num5 = c.destroyedCreatureCountArdilus; break;
                case CreatureType.DesertSpaceSlug: num5 = c.destroyedCreatureCountSandSlug; break;
                case CreatureType.Kaltor: num5 = c.destroyedCreatureCountKaltor; break;
                case CreatureType.RockSpaceSlug: num5 = c.destroyedCreatureCountSpaceSlug; break;
            }
            return formatText(key('DestroyMostCreaturesByType'), formatNumber(num5, '0'));
        }
        case T.DestroyMostShips: return formatText(key('DestroyMostShips'), formatNumber(c.destroyedEnemyMilitaryShipCount + c.destroyedEnemyCivilianShipCount, '0'));
        case T.DestroyMostTroops: return formatText(key('DestroyMostTroops'), formatNumber(c.destroyedEnemyTroopCount, '0'));
        case T.ExploreMostSystems: return formatText(key('ExploreMostSystems'), formatNumber(countExploredSystems(bestEmpire.systemVisibility), '0'));
        case T.ExterminateOrEnslaveMostPopulation: return formatText(key('ExterminateOrEnslaveMostPopulation'), formatNumber(calculateEnslavedPopulationAmount(bestEmpire), '0,,M'), formatNumber(c.exterminatedPopulationAmount, '0,,M'));
        case T.HighestPrivateRevenue: return formatText(key('HighestPrivateRevenue'), formatNumber(c.colonyPrivateRevenueTotal, '###,###,###,###,##0'));
        case T.HighestTradeVolume: return formatText(key('HighestTradeVolume'), formatNumber(c.tradeIncomeTotalVolume, '###,###,###,###,##0'));
        case T.LargestMilitary: return formatText(key('LargestMilitary'), formatNumber(calculateMilitaryShipSizeTotal(bestEmpire), '0,K'));
        case T.LargestMilitaryNonAllied: return formatText(key('LargestMilitaryNonAllied'), formatNumber(calculateMilitaryShipSizeTotal(bestEmpire), '0,K'));
        case T.MostTroops: return formatText(key('MostTroops'), formatNumber(troopsCountTroopsNotRecruiting(bestEmpire.troops.items), '0'));
        case T.MostTroopsNonAllied: return formatText(key('MostTroopsNonAllied'), formatNumber(troopsCountTroopsNotRecruiting(bestEmpire.troops.items), '0'));
        case T.LeastBrokenTreaties: return formatText(key('LeastBrokenTreaties'), formatNumber(bestEmpire.diplomacyCounters.brokenTreatyCount, '0'));
        case T.LeastTimeWarring: return formatText(key('LeastTimeWarring'), formatNumber(timeSpentAtWar(bestEmpire.diplomacyCounters, currentStarDate) / year, '0.0'));
        case T.LeastTreaties: return formatText(key('LeastTreaties'), formatNumber(bestEmpire.diplomaticRelations.countTreaties(), '0'));
        case T.LeastWarsStarted: return formatText(key('LeastWars'), formatNumber(bestEmpire.diplomacyCounters.warsWeStartedCount, '0'));
        case T.LoseFewestShips: return formatText(key('LoseFewestShips'), formatNumber(c.lossesCivilianShipCount + c.lossesMilitaryShipCount, '0'));
        case T.LoseFewestTroops: return formatText(key('LoseFewestTroops'), formatNumber(c.lossesTroopCount, '0'));
        case T.MostExperiencedAdmiral:
        case T.MostExperiencedGeneral: {
            const admiral = condition.type === T.MostExperiencedAdmiral;
            const character = mostExperiencedCharacter(bestEmpire, admiral ? CharacterRole.FleetAdmiral : CharacterRole.TroopGeneral);
            return character !== null ? formatText(key(admiral ? 'MostExperiencedAdmiral' : 'MostExperiencedGeneral'), character.name) : '';
        }
        case T.MostHomeworlds: {
            let detail = formatText(key('MostHomeworlds'), formatNumber(countHomeworldsOwned(galaxy, bestEmpire), '0'));
            const homeworldsOwned = getHomeworldsOwned(galaxy, bestEmpire);
            let text = '';
            for (let n = 0; n < homeworldsOwned.length; n++) text = text + homeworldsOwned[n].name + ', ';
            if (text !== '' && text.length >= 2) {
                text = text.substring(0, text.length - 2);
                detail = detail + ': ' + text;
            }
            return detail;
        }
        case T.MostIntelligenceMissionsIntercepted: return formatText(key('MostIntelligenceMissionsIntercepted'), formatNumber(intelligenceCounter(bestEmpire, 'intelligenceMissionSuccessCounterIntelligenceCount'), '0'));
        case T.MostIntelligenceMissionsSucceed: return formatText(key('MostIntelligenceMissionsSucceed'), formatNumber(intelligenceCounter(bestEmpire, 'intelligenceMissionSuccessEspionageCount') + intelligenceCounter(bestEmpire, 'intelligenceMissionSuccessSabotageCount'), '0'));
        case T.MostMiningStations: return formatText(key('MostMiningStations'), formatNumber(bestEmpire.miningStations.length, '0'));
        case T.MostResortBases: return formatText(key('MostResortBases'), formatNumber(bestEmpire.resortBases.length, '0'));
        case T.MostScientists: return formatText(key('MostScientists'), formatNumber(countCharactersByRole(characters(bestEmpire), CharacterRole.Scientist), '0'));
        case T.MostSpaceports: return formatText(key('MostSpaceports'), formatNumber(bestEmpire.spacePorts.length, '0'));
        // C# reads CountSubjugatedDominions here although the ranking used Counters.SubjugationsMade.
        case T.MostSubjugatedDominions: return formatText(key('MostSubjugatedDominions'), formatNumber(bestEmpire.diplomaticRelations.countSubjugatedDominions(), '0'));
        case T.MostTimeWarring: return formatText(key('MostTimeWarring'), formatNumber(timeSpentAtWar(bestEmpire.diplomacyCounters, currentStarDate) / year, '0.0'));
        case T.MostTourismIncome: return formatText(key('MostTourismIncome'), formatNumber(c.tourismIncome, '###,###,###,###,##0'));
        case T.MostTradeIncome: return formatText(key('MostTradeIncome'), formatNumber(c.tradeIncomeStateBonus, '###,###,###,###,##0'));
        case T.OldestFreeTradeAgreement:
        case T.OldestMutualDefensePact: {
            const fta = condition.type === T.OldestFreeTradeAgreement;
            const diplomaticRelation = bestEmpire.diplomaticRelations.findOldestRelationByType(fta ? DiplomaticRelationType.FreeTradeAgreement : DiplomaticRelationType.MutualDefensePact);
            return diplomaticRelation !== null ? formatText(key(fta ? 'OldestFreeTradeAgreement' : 'OldestMutualDefensePact'), diplomaticRelation.otherEmpire!.name, resolveStarDateDescription(diplomaticRelation.startDateOfLastChange)) : '';
        }
        case T.OwnLargestCapitalShip: {
            const builtObject3 = largestCapitalShip(bestEmpire);
            return builtObject3 !== null ? formatText(key('OwnLargestCapitalShip'), builtObject3.name, formatNumber(builtObject3.size, '0')) : '';
        }
        case T.PopulationHappiest: return formatText(key('PopulationHappiest'), formatNumber(averageHappiness(galaxy, bestEmpire), '+0.0;-0.0;0'));
        case T.PopulationHighest: return formatText(key('PopulationHighest'), formatNumber(bestEmpire.totalPopulation, '0,,M'));
        case T.ResearchLeastAdvanced: return formatText(key('ResearchLeastAdvanced'), formatNumber(calculateTotalCostResearchedProjects(bestEmpire.research.techTree), '0,K'));
        case T.ResearchMostAdvanced: return formatText(key('ResearchMostAdvanced'), formatNumber(calculateTotalCostResearchedProjects(bestEmpire.research.techTree), '0,K'));
        case T.ResearchMostCompletedBranches: return formatText(key('ResearchMostCompletedBranches'), formatNumber(countCompletedCategories(bestEmpire.research.techTree), '0'));
        case T.ResearchMostCompletedBranchesByIndustry: {
            if (condition.additionalData === null) return '';
            const industry3 = condition.additionalData as IndustryType;
            return formatText(key('ResearchMostCompletedBranchesByIndustry'), formatNumber(countCompletedCategories(bestEmpire.research.techTree, industry3), '0'), resolveDescription(IndustryType as unknown as Record<number, string>, industry3));
        }
        case T.MineMostResourcesLuxury: return formatText(key('MineMostResourcesLuxury'), formatNumber(c.miningExtractionLuxury, '0,K'));
        case T.MineMostResourcesStrategic: return formatText(key('MineMostResourcesStrategic'), formatNumber(c.miningExtractionGas + c.miningExtractionStrategic, '0,K'));
        case T.MineMostResourcesColonyManufactured: return formatText(key('MineMostResourcesColonyManufactured'), formatNumber(c.miningExtractionColonyManufactured, '0,K'));
        case T.BuildMostMilitaryShips: return formatText(key('BuildMostMilitaryShips'), formatNumber(bestEmpire.countersBuildMilitaryShipCount, '0'));
        case T.BuildMostCivilianShips: return formatText(key('BuildMostCivilianShips'), formatNumber(bestEmpire.countersBuildCivilianShipCount, '0'));
        case T.BuildMostBases: return formatText(key('BuildMostBases'), formatNumber(bestEmpire.countersBuildBaseCount, '0'));
        default: return '';
    }
}

/**
 * Galaxy.cs 4960 CalculateRaceVictoryConditionProgress(galaxy, empire, condition, out detail, out bestEmpire): the
 * 0..1 progress of one condition. Compare-empires types go through RaceVictoryConditionMetCompareEmpires; the absolute
 * types (BuildWonder, ControlHomeworld, ControlLargestColoniesByType, ControlPlanetTypePercentage,
 * PirateControlColoniesPercentage, PirateBuildHiddenFortress, PirateBuildCriminalNetwork, ControlRestrictedResourceSupply,
 * DestroyMore…ThanLoseTimesFactor, EnslavePopulationProportionEmpire, ExploreGalaxyPercentage,
 * FreeTradeAgreements… / MutualDefensePacts…FormedProportionAllEmpires, KeepLeaderAlive) are evaluated here against
 * condition.Amount.
 */
export function calculateRaceVictoryConditionProgress(galaxy: Galaxy, empire: Empire | null, condition: VictoryCondition | null): { progress: number; detail: string; bestEmpire: Empire | null } {
    const T = RaceVictoryConditionType;
    let val = 0.0;
    let detail = '';
    let bestEmpire: Empire | null = empire;
    if (galaxy != null && condition !== null && empire !== null && empire.counters != null) {
        if (COMPARE_EMPIRES_TYPES.has(condition.type)) {
            const r = raceVictoryConditionMetCompareEmpires(galaxy, empire, condition);
            val = r.result;
            detail = r.detail;
            bestEmpire = r.bestEmpire;
        } else {
            switch (condition.type) {
                case T.BuildWonder: {
                    // AdditionalData is PlanetaryFacilityDefinition (Race.cs: PlanetaryFacilityDefinitionsStatic[index]).
                    const defs = planetaryFacilityDefinitionsStatic(galaxy);
                    const index = condition.additionalData;
                    if (index === null || index < 0 || index >= defs.length) break;
                    const planetaryFacilityDefinition = defs[index];
                    let flag = false;
                    if (empire.colonies != null) {
                        for (let l = 0; l < empire.colonies.length; l++) {
                            const facilities = empire.colonies[l].facilities;
                            let planetaryFacility = null;
                            if (facilities !== null) {
                                // PlanetaryFacilityList.cs 75 FindWonderByType(WonderType).
                                for (let f = 0; f < facilities.length; f++) {
                                    if (facilities[f].type === PlanetaryFacilityType.Wonder && facilities[f].wonderType === (planetaryFacilityDefinition.wonderType as WonderType)) {
                                        planetaryFacility = facilities[f];
                                        break;
                                    }
                                }
                            }
                            if (planetaryFacility !== null && planetaryFacility.constructionProgress >= 1) {
                                detail = empire.colonies[l].name;
                                flag = true;
                                break;
                            }
                        }
                    }
                    if (flag) val = 1.0;
                    break;
                }
                case T.ControlHomeworld:
                    if (empire.homeWorld !== null && !empire.homeWorld.hasBeenDestroyed && empire.homeWorld.empire === empire) {
                        detail = empire.homeWorld.name;
                        val = 1.0;
                    } else if (empire.homeWorld !== null && empire.homeWorld.empire !== null) {
                        detail = formatText(getText('Race Victory Condition Detail ControlHomeworld Other'), empire.homeWorld.name, empire.homeWorld.empire.name);
                    }
                    break;
                case T.ControlLargestColoniesByType: {
                    if (condition.additionalData === null) break;
                    let text = '';
                    const type = condition.additionalData as HabitatType;
                    const habitatList = determineLargestColoniesByType(galaxy, type);
                    const num6 = Math.trunc(condition.amount);
                    let num7 = 0;
                    for (let m = 0; m < num6; m++) {
                        if (m < habitatList.length && habitatList[m].empire === empire) {
                            text = text + habitatList[m].name + ', ';
                            num7++;
                        }
                    }
                    if (text !== '' && text.length >= 2) text = text.substring(0, text.length - 2);
                    detail = text;
                    val = num7 / num6;
                    break;
                }
                case T.ControlPlanetTypePercentage:
                    if (condition.additionalData !== null) {
                        const type2 = condition.additionalData as HabitatType;
                        const num19 = countColoniesByType(galaxy, type2);
                        const num20 = habitatListCountByType(empire.colonies, type2);
                        const num21 = num20 / Math.max(1.0, num19);
                        val = num21 / (condition.amount / 100.0);
                        detail = formatText(getText('Race Victory Condition Detail ControlPlanetTypePercentage'), formatNumber(num20, '0'), resolveDescription(HabitatType as unknown as Record<number, string>, type2), formatNumber(num21, '0%'));
                    }
                    break;
                case T.PirateControlColoniesPercentage: {
                    const num4 = Math.max(1, countPirateControlledColoniesGalaxy(galaxy));
                    const count = empire.colonies.length;
                    const num5 = count / num4;
                    val = num5 / (condition.amount / 100.0);
                    detail = formatText(getText('Race Victory Condition Detail PirateControlColoniesPercentage'), formatNumber(count, '0'), formatNumber(num5, '0%'));
                    break;
                }
                case T.PirateBuildHiddenFortress:
                case T.PirateBuildCriminalNetwork: {
                    const facilityType = condition.type === T.PirateBuildHiddenFortress ? PlanetaryFacilityType.PirateFortress : PlanetaryFacilityType.PirateCriminalNetwork;
                    for (let j = 0; j < empire.colonies.length; j++) {
                        const habitat = empire.colonies[j];
                        if (habitat != null && !habitat.hasBeenDestroyed && habitat.facilities !== null) {
                            const byFaction = habitat.pirateColonyControl.getByFaction(empire);
                            if (byFaction !== null && byFaction.hasFacilityControl && facilitiesCountCompletedByType(habitat.facilities, facilityType) > 0) {
                                val = 1.0;
                                detail = habitat.name;
                                break;
                            }
                        }
                    }
                    break;
                }
                case T.ControlRestrictedResourceSupply: {
                    const habitatsWithRestrictedResources = habitatListGetHabitatsWithRestrictedResources(galaxy, empire.colonies);
                    for (let k = 0; k < habitatsWithRestrictedResources.length; k++) detail = detail + habitatsWithRestrictedResources[k].name + ', ';
                    if (detail !== '' && detail.length >= 2) detail = detail.substring(0, detail.length - 2);
                    val = habitatsWithRestrictedResources.length / condition.amount;
                    break;
                }
                case T.DestroyMoreEnemyTroopsThanLoseTimesFactor: {
                    const amount2 = condition.amount;
                    if (empire.counters.destroyedEnemyTroopCount > empire.counters.lossesTroopCount * amount2) val = 1.0;
                    detail = formatText(getText('Race Victory Condition Detail DestroyMoreEnemyTroopsThanLoseTimesFactor'), formatNumber(empire.counters.destroyedEnemyTroopCount, '0'), formatNumber(empire.counters.lossesTroopCount, '0'));
                    break;
                }
                case T.DestroyMoreShipsThanLoseTimesFactor: {
                    const amount = condition.amount;
                    const num17 = empire.counters.destroyedEnemyMilitaryShipCount + empire.counters.destroyedEnemyCivilianShipCount;
                    const num18 = empire.counters.lossesMilitaryShipCount + empire.counters.lossesCivilianShipCount;
                    if (num17 > num18 * amount) val = 1.0;
                    detail = formatText(getText('Race Victory Condition Detail DestroyMoreShipsThanLoseTimesFactor'), formatNumber(num17, '0'), formatNumber(num18, '0'));
                    break;
                }
                case T.EnslavePopulationProportionEmpire: {
                    const num15 = calculateEnslavedPopulationAmount(empire);
                    const num16 = num15 / empire.totalPopulation;
                    val = num16 / (condition.amount / 100.0);
                    detail = formatText(getText('Race Victory Condition Detail EnslavePopulationProportionEmpire'), formatNumber(num15, '0,,M'), formatNumber(empire.totalPopulation, '0,,M'));
                    break;
                }
                case T.ExploreGalaxyPercentage: {
                    const num13 = countExploredSystems(empire.systemVisibility);
                    const num14 = Math.max(0.0, Math.min(1.0, num13 / galaxy.systems.length));
                    val = num14 / (condition.amount / 100.0);
                    detail = formatText(getText('Race Victory Condition Detail ExploreGalaxyPercentage'), formatNumber(num13, '0'), formatNumber(galaxy.systems.length, '0'));
                    break;
                }
                case T.FreeTradeAgreementsFormedProportionAllEmpires: {
                    const num8 = empire.diplomaticRelations.countRelationsByType(DiplomaticRelationType.FreeTradeAgreement);
                    const num9 = empire.diplomaticRelations.countRelationsByType(DiplomaticRelationType.MutualDefensePact);
                    const num10 = empire.diplomaticRelations.countRelationsByType(DiplomaticRelationType.Protectorate);
                    const num11 = num8 + num9 + num10;
                    const num12 = num11 / (galaxy.empires.length - 1);
                    val = num12 / (condition.amount / 100.0);
                    detail = formatText(getText('Race Victory Condition Detail FreeTradeAgreementsFormedProportionAllEmpires'), formatNumber(num11, '0'));
                    break;
                }
                case T.KeepLeaderAlive:
                    if (empire.characters != null) {
                        const charactersByRole = getCharactersByRole(characters(empire), CharacterRole.Leader);
                        if (charactersByRole.length > 0) val = 1.0;
                        for (let i = 0; i < charactersByRole.length; i++) detail = detail + charactersByRole[i].name + ', ';
                        if (detail !== '' && detail.length >= 2) detail = detail.substring(0, detail.length - 2);
                    }
                    break;
                case T.MutualDefensePactsFormedProportionAllEmpires: {
                    const num = empire.diplomaticRelations.countRelationsByType(DiplomaticRelationType.MutualDefensePact);
                    const num2 = Math.max(1, galaxy.empires.length - 1);
                    const num3 = num / num2;
                    val = num3 / (condition.amount / 100.0);
                    detail = formatText(getText('Race Victory Condition Detail MutualDefensePactsFormedProportionAllEmpires'), formatNumber(num, '0'));
                    break;
                }
            }
        }
    }
    return { progress: Math.max(0.0, Math.min(1.0, val)), detail, bestEmpire };
}

// ---------------------------------------------------------------------------------------------------------------
// Galaxy.cs 1417 / 1452: difficulty scaling as the player nears victory
// ---------------------------------------------------------------------------------------------------------------

/**
 * Galaxy.cs 1423-1442 (player branch of SetEmpireDifficultyFactors): with DifficultyLevelScalesAsPlayerApproachesVictory,
 * the player's DifficultyLevel rises by min(0.5, progress − 0.5) × max(1, DifficultyLevel) once past 50 % progress.
 * Returns the (possibly generated) progress list so the caller can reuse it.
 */
export function difficultyScalingForPlayer(galaxy: Galaxy, empire: Empire, galaxyDifficultyLevel: number, conditionProgresses: VictoryConditionProgress[] | null): VictoryConditionProgress[] | null {
    if (galaxy.difficultyLevelScalesAsPlayerApproachesVictory) {
        if (conditionProgresses === null) conditionProgresses = generateVictoryConditionProgresses(galaxy, galaxy.globalVictoryConditions, true);
        if (conditionProgresses.length > 0) {
            const byEmpire = victoryConditionProgressListGetByEmpire(conditionProgresses, empire);
            if (byEmpire !== null) {
                const totalProgress = byEmpire.totalProgress;
                if (totalProgress > 0.5) {
                    const num = Math.min(0.5, Math.max(0.0, totalProgress - 0.5));
                    empire.difficultyLevel += num * Math.max(1.0, galaxyDifficultyLevel);
                }
            }
        }
    }
    return conditionProgresses;
}
