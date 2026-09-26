// M4a skeleton: Galaxy.DoTasksTimeSensitive (Galaxy.cs 3039-3052), Galaxy.DoTasks (3054-3132),
// Galaxy.ResetLastTouchTimes (3134-3139) and ProcessPirateFleets (3278-3295).
// Statement-for-statement in C# order. Spans (Galaxy.3.cs 5139-5142): long 60 s, huge 240 s, `>=` on TimeSpans,
// touches written before the blocks. DoTasks runs on a C# worker thread; the TS scheduler runs it at the end of
// the frame (tick/scheduler.ts).

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { HUGE_PROCESSING_SPAN_MS, LONG_PROCESSING_SPAN_MS, MIN_TIME, galaxyNow, galaxyStarDate, spanSeconds } from './simTime';
import { shipGroupDoTasks } from './shipGroupTick';
import { initEmpireTouchTimes } from './empireTick';
import { empireShipGroups } from '../fleets/shipGroup';
// Existing ports.
import { reviewComponentPrices, reviewResourcePrices } from '../market';
import {
    assignIndependentTraderMissions,
    cancelExpiredOrders,
    cleanupInvalidShipsInIndexes,
    generateIndependentTraders,
    identifyDisputedBases,
    removeCompletedOrders,
    reviewIndependentColonies,
    selectPopularDesignCandidates,
    updateEmpireRefuellingLocations,
} from '../independentTraders';
import { checkEmpireTerritoryCanBuildAtHabitat } from '../resourceTargets';
import { doGalaxyEventsSuperPirates, generateNewPirateEmpires, type PirateGenerationContext } from '../pirates';
// Package stubs.
import { maintainIndependentColonyFuelLevels } from '../logistics/colonySupply';
import { checkMarketOrders } from '../logistics/orders';
import { reviewWondersBuilt } from '../construction/wonders';
import { reviewColonyFillFactor, reviewRacePeriodicChanges } from '../colonyTick';
import { reviewEmpireDifficultyFactors } from '../treasury';
import {
    independentColoniesMakeDefendOffersToPirates,
    independentColoniesMakeSmugglingOffersToPirates,
    reviewPirateDefendMissions,
    reviewPirateMissionsAndAssign,
    reviewPirateSmugglingMissions,
} from '../pirates/missionsMarket';
import { checkForTerminatedPirateEmpires, checkMergePirateFactions, doSuperPirateTasks, generateNewPirateShips, reviewPirateEmpireActivities } from '../pirates/pirateGalaxyTick';
import { reviewEmpireTerritorySystemsOnly } from '../exploration';
import type { GalaxyVictoryArgs } from '../victory';
import { checkVictoryConditions, clearCompletedPlanetDestroyerProjects, clearEmptyDebrisFields, processDelayedEventActions, reviewAchievements } from '../events';
import { scenarioPeriodicTick, scenarioYearlyTick } from '../scenario/hooks';
import { expireScenarioDecisions } from '../scenario/decisions';

/** Galaxy.cs 3039 DoTasksTimeSensitive() → 3046 DoTasksTimeSensitive(starDate, time). */
export function galaxyDoTasksTimeSensitive(galaxy: Galaxy, starDate: number = galaxyStarDate(galaxy), time: number = galaxyNow(galaxy)): void {
    // 3048
    const totalSeconds = spanSeconds(time, galaxy.lastGalaxyProcessTimeSensitive);
    // 3049-3051
    reviewPirateMissionsAndAssign(galaxy, starDate, totalSeconds);
    processDelayedEventActions(galaxy, starDate);
    galaxy.lastGalaxyProcessTimeSensitive = time;
}

/** Galaxy.cs 3134 ResetLastTouchTimes. */
export function resetLastTouchTimes(galaxy: Galaxy): void {
    galaxy.lastGalaxyHugeProcessTime = MIN_TIME;
    galaxy.lastGalaxyProcessTime = MIN_TIME;
    galaxy.lastGalaxyProcessTimeSensitive = MIN_TIME;
}

/** Galaxy.cs 3278 ProcessPirateFleets(galaxyDate). */
function processPirateFleets(galaxy: Galaxy, galaxyDate: number): void {
    if (galaxy.pirateEmpires === null) {
        return;
    }
    for (let i = 0; i < galaxy.pirateEmpires.length; i++) {
        const empire = galaxy.pirateEmpires[i];
        if (empire !== null && empire.active && empire.shipGroups !== null) {
            const shipGroups = empireShipGroups(empire);
            for (let j = 0; j < shipGroups.length; j++) {
                const shipGroup = shipGroups[j];
                if (shipGroup !== null) shipGroupDoTasks(galaxy, shipGroup, galaxyDate);
            }
        }
    }
}

/**
 * The pirate generation inputs the TS keeps outside Galaxy (PirateGenerationContext / PirateSettings), rebuilt from
 * the Galaxy fields: Galaxy.IndependentColonies, StartingAge, DifficultyLevel, _PiratePrevalence, _PirateProximity,
 * MaximumEmpireAmount (0 = derive: player + AI empires, createGame's default), GameDisasterEventsEnabled.
 */
function pirateContext(galaxy: Galaxy): PirateGenerationContext {
    return { independentColonies: galaxy.independentColonies, startingAge: galaxy.startingAge, difficultyLevel: galaxy.difficultyLevel };
}

function maximumEmpireAmount(galaxy: Galaxy): number {
    return galaxy.maximumEmpireAmount > 0 ? galaxy.maximumEmpireAmount : galaxy.empires.length;
}

/**
 * Galaxy.cs 3054 DoTasks(gameFinished, playerEmpire, globalVictoryConditions, playerConditionsToAchieve,
 * playerConditionsToPrevent). The three victory-condition arguments are `victoryArgs` (null at game start, Start.2.cs
 * 1109 / 1486; the frame driver passes the Game's, Main.Part12.cs 3980) and only reach CheckVictoryConditions.
 */
export function galaxyDoTasks(
    galaxy: Galaxy,
    gameFinished = false,
    playerEmpire: Empire | null = galaxy.playerEmpire,
    afterHugeBlock?: () => boolean,
    victoryArgs: GalaxyVictoryArgs | null = null,
): void {
    // 3056-3058
    const currentDateTime = galaxyNow(galaxy);
    const timeSpan = currentDateTime - galaxy.lastGalaxyProcessTime;
    const timeSpan2 = currentDateTime - galaxy.lastGalaxyHugeProcessTime;
    // 3059-3074
    if (timeSpan < 0) galaxy.lastGalaxyProcessTime = currentDateTime;
    if (timeSpan2 < 0) galaxy.lastGalaxyHugeProcessTime = currentDateTime;
    if (timeSpan2 >= HUGE_PROCESSING_SPAN_MS) galaxy.lastGalaxyHugeProcessTime = currentDateTime;
    if (timeSpan >= LONG_PROCESSING_SPAN_MS) galaxy.lastGalaxyProcessTime = currentDateTime;
    // 3075-3078 ReseedRandom (new Random((int)DateTime.Now.Ticks)): dropped — the TS keeps the single seeded
    // galaxy.rnd stream (determinism contract, plan §0; as independentTraders.ts / pirates.ts do).
    if (galaxy.resetRandom) {
        galaxy.resetRandom = false;
    }
    // 3079
    processPirateFleets(galaxy, currentDateTime);
    // 3080-3089 huge block.
    let flag = false;
    if (timeSpan2 >= HUGE_PROCESSING_SPAN_MS) {
        // ReviewEmpireTerritory(onlySystems: false): ThreadPool work item in C# (Galaxy.cs 3376), synchronous here.
        galaxy.empireTerritory.reviewEmpireTerritory(galaxy);
        flag = true;
        selectPopularDesignCandidates(galaxy);
        // DoGalaxyEvents (Galaxy.cs 3297, pirates.ts): RND Next(0, n) when enabled.
        // A super-pirate faction created here gets the Empire ctor touch times at CurrentDateTime (Empire.cs 4320), as
        // GenerateNewPirateEmpires' factions below.
        const superPirateCountBefore = galaxy.pirateEmpires.length;
        doGalaxyEventsSuperPirates(galaxy, pirateContext(galaxy), { gameDisasterEventsEnabled: galaxy.gameDisasterEventsEnabled, piratePrevalence: galaxy.piratePrevalence });
        for (let i = superPirateCountBefore; i < galaxy.pirateEmpires.length; i++) {
            initEmpireTouchTimes(galaxy, galaxy.pirateEmpires[i]);
        }
        cleanupInvalidShipsInIndexes(galaxy);
        // 3088 ReseedRandom(): dropped (see above).
    }
    // Test-only seam (createGame's 'firstGalaxyTick:huge' phase): true stops this tick here.
    if (afterHugeBlock !== undefined && afterHugeBlock()) return;
    // 3090-3131 long block.
    if (timeSpan >= LONG_PROCESSING_SPAN_MS) {
        galaxy.deferEventsForGameStart = false;
        reviewResourcePrices(galaxy);
        reviewComponentPrices(galaxy);
        removeCompletedOrders(galaxy.orders);
        cancelExpiredOrders(galaxy, galaxy.orders);
        // UpdateSystemInfo(playerEmpire) (Galaxy.1.cs 840); no Rnd.
        galaxy.updateSystemInfo(playerEmpire);
        reviewIndependentColonies(galaxy);
        if (galaxy.independentEmpire !== null) {
            updateEmpireRefuellingLocations(galaxy, galaxy.independentEmpire);
        }
        identifyDisputedBases(galaxy, checkEmpireTerritoryCanBuildAtHabitat);
        generateIndependentTraders(galaxy);
        assignIndependentTraderMissions(galaxy);
        // GenerateNewPirateEmpires (Galaxy.9.cs 20, pirates.ts; ported in its game-start form — TODO(port) M4s:
        // DestroyedPiratesDoNotRespawn once CurrentStarDate − StartStarDate > 300000). The Empire ctor stamps the
        // touch times of each new faction at CurrentDateTime (Empire.cs 4320); TS field defaults are game-time-0
        // values, so re-stamp the factions this call appended.
        const pirateCountBefore = galaxy.pirateEmpires.length;
        generateNewPirateEmpires(galaxy, pirateContext(galaxy), {
            piratePrevalence: galaxy.piratePrevalence,
            maximumEmpireAmount: maximumEmpireAmount(galaxy),
            pirateProximity: galaxy.pirateProximity,
        });
        for (let i = pirateCountBefore; i < galaxy.pirateEmpires.length; i++) {
            initEmpireTouchTimes(galaxy, galaxy.pirateEmpires[i]);
        }
        checkForTerminatedPirateEmpires(galaxy);
        generateNewPirateShips(galaxy);
        doSuperPirateTasks(galaxy);
        clearEmptyDebrisFields(galaxy);
        clearCompletedPlanetDestroyerProjects(galaxy);
        checkMergePirateFactions(galaxy);
        reviewPirateEmpireActivities(galaxy);
        maintainIndependentColonyFuelLevels(galaxy);
        if (galaxy.independentEmpire !== null) {
            checkMarketOrders(galaxy, galaxy.independentEmpire);
        }
        const currentStarDate = galaxyStarDate(galaxy);
        if (galaxy.independentEmpire !== null) {
            reviewPirateSmugglingMissions(galaxy, galaxy.independentEmpire, currentStarDate);
            reviewPirateDefendMissions(galaxy, galaxy.independentEmpire, currentStarDate);
        }
        independentColoniesMakeSmugglingOffersToPirates(galaxy, currentStarDate);
        independentColoniesMakeDefendOffersToPirates(galaxy, currentStarDate);
        reviewRacePeriodicChanges(galaxy);
        reviewColonyFillFactor(galaxy);
        if (!flag) {
            reviewEmpireTerritorySystemsOnly(galaxy);
        }
        reviewWondersBuilt(galaxy);
        reviewEmpireDifficultyFactors(galaxy);
        reviewAchievements(galaxy);
        if (!gameFinished) {
            checkVictoryConditions(galaxy, playerEmpire, victoryArgs);
        }
        // Mod layer (not a port; tasks/MODLAYER-DESIGN.md §4): the yearly scenario tick — returns at once when the game
        // runs no scenario, so the faithful game is untouched. Scenario handlers may draw galaxy.rnd only here.
        if (galaxy.scenario !== null) {
            scenarioYearlyTick(galaxy);
            scenarioPeriodicTick(galaxy);
            expireScenarioDecisions(galaxy);
        }
    }
}

/**
 * Game-start switch-over (Start.2.cs 1108-1110): ResetLastTouchTimes, then the first Galaxy.DoTasks — its huge and
 * long blocks both run at the current game time. createGame calls it, then sets
 * `galaxy.deferEventsForGameStart = true` (Start.2.cs 1110) as the C# does.
 *
 * The C# DoTasks also runs ProcessPirateFleets (no factions yet at that point) and — past the stand-ins — the rest of
 * the long block (terminated pirates … CheckVictoryConditions); those are package stubs today.
 * createGame sets the Galaxy fields it reads first: pirateProximity, maximumEmpireAmount, piratePrevalence,
 * startingAge, gameDisasterEventsEnabled.
 */
export function runGameStartGalaxyTick(
    galaxy: Galaxy,
    playerEmpire: Empire | null = galaxy.playerEmpire,
    afterHugeBlock?: () => boolean,
    victoryArgs: GalaxyVictoryArgs | null = null,
): void {
    resetLastTouchTimes(galaxy);
    galaxyDoTasks(galaxy, false, playerEmpire, afterHugeBlock);
}
