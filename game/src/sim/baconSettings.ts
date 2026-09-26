// BaconMain.cs 551 BaconInitialize(main) — the BaconSettings.txt half (605-1062). The file itself is read and parsed by
// data/baconSettings.ts (ReadBaconSettings 1101 + the per-key TryParse blocks) and carried in GameData.baconSettings.
//
// The C# runs BaconInitialize once a created or loaded game starts running (Main.Part7.cs 2190 / Part11.cs 2224 /
// Part12.cs 3151; BaconStart.InitializeMore / LoadGame clear settingsInitialized first), so the statics it sets are the
// class defaults while a fresh launch generates its first galaxy. The TS models that fresh-launch case for every game:
// createGame calls resetBaconSettings before generating and baconInitializeSettings at the end; deserializeGame calls
// baconInitializeSettings after loading.
//
// BaconMain.cs 700-715: the "ProcessEmpireScienceShips" delayed action when researchPerLab > 0 (Galaxy.Rnd.Next(26, 35);
// baconScienceShips.ts).
// TODO(port): the rest of BaconInitialize — Galaxy.MinimumHabitatPopulationAmount = 100 (558), the SaveStats files and
// delayed "SaveStats" action (559-697), AddOtherDelayedEvents ("ClearShipsAboutToBeDestroyed", Rnd.Next(10, 12)),
// ModAllShips (ApplyCrewExperience) and BaconDesign.RedefineAllBases (1063-1070). RND: the Next(10, 12) draw is not made.

import type { Galaxy } from './galaxy';
import { type BaconSettings, baconSettings, defaultBaconSettings, setBaconSettings } from './data/baconSettings';
import { baconMovementSettings } from './movement';
import { scheduleProcessEmpireScienceShips } from './baconScienceShips';

/** Copy the live settings into movement.ts's `baconMovementSettings` (the statics the movement / hyperjump code reads). */
function syncMovementSettings(): void {
    const m = baconMovementSettings;
    m.hyperJumpThreshhold = baconSettings.hyperJumpThreshhold;
    m.baseHyperJumpAccuracy = baconSettings.baseHyperJumpAccuracy;
    m.useStarGravityWells = baconSettings.useStarGravityWells;
    m.smallShipsJumpSooner = baconSettings.smallShipsJumpSooner;
    m.noFuelCruiseSpeedMultiplier = baconSettings.noFuelCruiseSpeedMultiplier;
    m.noFuelTopSpeedMultiplier = baconSettings.noFuelTopSpeedMultiplier;
    m.noFuelHyperSpeedMultiplier = baconSettings.noFuelHyperSpeedMultiplier;
    m.useStargates = baconSettings.useStargates;
    m.sublightFuelBurnDivisor = baconSettings.sublightFuelBurnDivisor;
}

/** Restores the C# class / Galaxy.InitializeStatics defaults (the state before BaconInitialize ever ran). */
export function resetBaconSettings(): void {
    setBaconSettings(defaultBaconSettings());
    syncMovementSettings();
}

/**
 * BaconMain.cs 605-1062: the statics take the loaded file's values (`settings` null/undefined = no BaconSettings.txt:
 * every static at its C# default), and 614-617 IndependentEmpire.Policy.TroopGarrisonMinimumPerColony when that key
 * parsed. `galaxy` null applies only the statics.
 */
export function baconInitializeSettings(galaxy: Galaxy | null, settings: BaconSettings | null | undefined): void {
    setBaconSettings(settings ?? defaultBaconSettings());
    syncMovementSettings();
    const independent = galaxy?.independentEmpire ?? null;
    if (baconSettings.troopGarrisonMinimumPerColony !== null && independent !== null && independent.policy !== null) {
        independent.policy.troopGarrisonMinimumPerColony = baconSettings.troopGarrisonMinimumPerColony;
    }
    // BaconMain.cs 700-715 (after the settings, before AddOtherDelayedEvents 1077).
    if (galaxy !== null) scheduleProcessEmpireScienceShips(galaxy);
}
