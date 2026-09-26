// M4a: game-start switch-over to the real ticks.
//
// createGame (game.ts) and GenerateEmpire (empireGeneration.ts) call these at the C# sites (Galaxy.7.cs 5346,
// Start.2.cs 1108-1110, 1114-1121, 1341, 1344-1350).
// The per-habitat Habitat.DoTasks calls of generation run through galaxy.ts generationHabitatDoTasks (Galaxy.8.cs
// 215-551, Galaxy.5.cs 1587 / 1731; startHabitats.ts); runGameStartHabitatTick serves the game-start sites.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { Habitat } from '../types';
import { galaxyNow } from './simTime';
import { LONG_PROCESSING_INTERVAL, empireDoTasks } from './empireTick';
import { habitatDoTasks } from './habitatTick';
import { runGameStartGalaxyTick } from './galaxyTick';

export { runGameStartGalaxyTick };

/**
 * Empire.DoTasks at a game-start site:
 * - Galaxy.7.cs 5346 (end of GenerateEmpire, between `InitiateConstruction = false/true`): the Empire ctor touch
 *   times (now − 121 s, huge = MinValue) make every block run, incl. the huge one.
 * - Start.2.cs 1341 (per-empire setup, between `BuildFactor = …` and `BuildFactor = 1.0`): blocks run only when
 *   resetEmpireTouchTimesForAge ran first (galaxy age > 0); otherwise nothing fires (same game second).
 * The real skeleton runs everything the stand-in ran (EvaluateColonyVariables' _TotalPopulation slice, corruption,
 * taxes, CreateNewDesigns, IdentifyResourceCentres, ProjectForceStructure / ProjectPrivateForceStructure) plus the
 * other already-ported steps (UpdateEmpireRefuellingLocations, IdentifyUnavailableLuxuryResources,
 * DetermineResearchStationLocation, money, …) and the package stubs, in C# order.
 */
export function runGameStartEmpireTick(galaxy: Galaxy, empire: Empire): void {
    empireDoTasks(galaxy, empire);
}

/** Start.2.cs 1114-1121 (int_5 = galaxy age > 0): all six touches = CurrentDateTime − (LongProcessingInterval + 1) s. */
export function resetEmpireTouchTimesForAge(galaxy: Galaxy, empire: Empire): void {
    empire.lastLongTouch = galaxyNow(galaxy) - (Math.trunc(LONG_PROCESSING_INTERVAL) + 1) * 1000;
    empire.lastIntermediateTouch = empire.lastLongTouch;
    empire.lastPeriodicTouch = empire.lastLongTouch;
    empire.lastRegularTouch = empire.lastLongTouch;
    empire.lastShortTouch = empire.lastLongTouch;
    empire.lastHugeTouch = empire.lastLongTouch;
}

/**
 * Start.2.cs 1344-1350: `seconds = Galaxy.Rnd.Next(1, (int)LongProcessingInterval)` then short..long touches =
 * CurrentDateTime − seconds (1350 sets the huge touch too). Pass the value game.ts already draws at 1344.
 */
export function staggerEmpireTouchTimes(galaxy: Galaxy, empire: Empire, seconds: number): void {
    empire.lastLongTouch = galaxyNow(galaxy) - seconds * 1000;
    empire.lastIntermediateTouch = empire.lastLongTouch;
    empire.lastPeriodicTouch = empire.lastLongTouch;
    empire.lastRegularTouch = empire.lastLongTouch;
    empire.lastShortTouch = empire.lastLongTouch;
    empire.lastHugeTouch = empire.lastLongTouch;
}

/** Habitat.DoTasks(galaxy.CurrentDateTime) at a generation / game-start site (e.g. Start.2.cs 2035-2038 player capital). */
export function runGameStartHabitatTick(galaxy: Galaxy, habitat: Habitat): boolean {
    return habitatDoTasks(galaxy, habitat, galaxyNow(galaxy));
}
