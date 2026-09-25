// BaconMain.cs 551 BaconInitialize(main) — the BaconSettings.txt half (605-1062). The C# runs it once a created or
// loaded game starts running (Main.Part7.cs 2190 / Part11.cs 2224 / Part12.cs 3151; BaconStart.InitializeMore / LoadGame
// clear settingsInitialized first), so the statics it sets are the class defaults while a fresh launch generates its
// first galaxy. The TS models that fresh-launch case for every game: createGame resets the settings to the C# defaults
// before generating and applies the loaded file at the end; deserializeGame applies it after loading.
//
// TODO(port): the rest of BaconInitialize — Galaxy.MinimumHabitatPopulationAmount = 100 (558), the SaveStats files and
// delayed "SaveStats" action (559-697), the "ProcessEmpireScienceShips" delayed action when researchPerLab > 0
// (700-715, Galaxy.Rnd.Next(26, 35)), AddOtherDelayedEvents ("ClearShipsAboutToBeDestroyed", Rnd.Next(10, 12)),
// ModAllShips (ApplyCrewExperience) and BaconDesign.RedefineAllBases (1063-1070). RND: those two draws are not made.

import type { Galaxy } from './galaxy';
import { type BaconSettings, baconSettings, defaultBaconSettings, setBaconSettings } from './data/baconSettings';
import { baconMovementSettings } from './movement';

/** Copy the live settings into movement.ts's `baconMovementSettings` (the statics its movement code reads). */
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
}

/** Galaxy generation on a fresh launch sees the C# class defaults (BaconInitialize has not run yet). */
export function resetBaconSettingsToDefaults(): void {
    setBaconSettings(defaultBaconSettings());
    syncMovementSettings();
}

/**
 * BaconMain.cs 605-1062: the statics take the file's values (`settings` null/undefined = no BaconSettings.txt, every
 * static at its C# default), and 614-617 IndependentEmpire.Policy.TroopGarrisonMinimumPerColony when the key parsed.
 */
export function baconInitializeSettings(galaxy: Galaxy, settings: BaconSettings | null | undefined): void {
    setBaconSettings(settings ?? defaultBaconSettings());
    syncMovementSettings();
    if (baconSettings.troopGarrisonMinimumPerColony !== null && galaxy.independentEmpire !== null && galaxy.independentEmpire.policy !== null) {
        galaxy.independentEmpire.policy.troopGarrisonMinimumPerColony = baconSettings.troopGarrisonMinimumPerColony;
    }
}
