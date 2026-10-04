// BaconMain.cs 551 BaconInitialize(main) — the BaconSettings.txt half (605-1062). The file itself is read and parsed by
// data/baconSettings.ts (ReadBaconSettings 1101 + the per-key TryParse blocks) and carried in GameData.baconSettings.
//
// The C# runs BaconInitialize once a created or loaded game starts running (Main.Part7.cs 2190 / Part11.cs 2224 /
// Part12.cs 3151; BaconStart.InitializeMore / LoadGame clear settingsInitialized first), so the statics it sets are the
// class defaults while a fresh launch generates its first galaxy. The TS models that fresh-launch case for every game:
// createGame calls resetBaconSettings before generating and baconInitializeSettings at the end; deserializeGame calls
// baconInitializeSettings after loading.
// Ours: every game keeps its own values on top of the file (Galaxy.baconSettingsOverrides, written only where they
// differ), changed at any time by the journaled setBaconSettings command, which runs BaconInitialize again at its frame
// boundary (applyBaconSettingsCommand). The sim worker's main-thread replica follows them (applyBaconSettingsStatics).
//
// The delayed actions BaconInitialize queues, in C# order: BaconMain.cs 686-697 "SaveStats" when saveStats (no Rnd),
// 700-715 "ProcessEmpireScienceShips" when researchPerLab > 0 (Galaxy.Rnd.Next(26, 35); baconScienceShips.ts), and
// 1069 AddOtherDelayedEvents (1075-1087: "ClearShipsAboutToBeDestroyed", Galaxy.Rnd.Next(10, 12)).
// TODO(port): the rest of BaconInitialize — Galaxy.MinimumHabitatPopulationAmount = 100 (558), the SaveStats files
// (559-600: file I/O, M9; names in achievements.ts), ModAllShips (ApplyCrewExperience) and BaconDesign.RedefineAllBases
// (1070-1071).

import type { Galaxy } from './galaxy';
import { type BaconSettings, type BaconSettingsOverrides, baconSettings, baconSettingsOverrides, defaultBaconSettings, mergeBaconSettings, setBaconSettings } from './data/baconSettings';
import { baconMovementSettings } from './movement';
import { scheduleProcessEmpireScienceShips } from './baconScienceShips';
import { EventAction, EventActionExecutionPackage, EventActionType, GameEvent } from './story/gameEventModel';
import { REAL_SECONDS_IN_GALACTIC_YEAR, galaxyStarDate } from './tick/simTime';

/** BaconMain.cs 694 / 1083: Galaxy.RealSecondsInGalacticYear * 1000 / 360 (int arithmetic) — one game day. */
const GAME_DAY_MS = Math.trunc((REAL_SECONDS_IN_GALACTIC_YEAR * 1000) / 360);

export const SAVE_STATS = 'SaveStats';
export const CLEAR_SHIPS_ABOUT_TO_BE_DESTROYED = 'ClearShipsAboutToBeDestroyed';

/** `delayedActions.FirstOrDefault(x => x.Action.MessageTitle.Contains(title))` (a title-less action is no match; the C# would throw). */
function hasDelayedAction(galaxy: Galaxy, title: string): boolean {
    return galaxy.delayedActions.some((x) => x.action !== null && x.action.messageTitle !== null && x.action.messageTitle.includes(title));
}

/**
 * BaconMain.cs 686-697 (BaconInitialize, after the settings keys, before the science-ship action): when saveStats and no
 * queued action's MessageTitle contains "SaveStats", queue one (EventActionType.StartPlague, no target) one game day from
 * now for the player empire. No Rnd. BaconGalaxy.cs 315-321 runs it (eventActions.ts baconGalaxyExecuteEventAction).
 */
export function scheduleSaveStats(galaxy: Galaxy): void {
    if (!baconSettings.saveStats) return;
    if (hasDelayedAction(galaxy, SAVE_STATS)) return;
    const eventAction = new EventAction(null, EventActionType.StartPlague);
    eventAction.messageTitle = SAVE_STATS;
    eventAction.executionDate = galaxyStarDate(galaxy) + GAME_DAY_MS;
    const gameEvent = new GameEvent(galaxy, 0, null);
    galaxy.delayedActions.push(new EventActionExecutionPackage(eventAction, gameEvent, galaxy.playerEmpire));
}

/**
 * BaconMain.cs 1075 AddOtherDelayedEvents (called at 1069, after every settings key): when no queued action's MessageTitle
 * contains "ClearShipsAboutToBeDestroyed", queue one (StartPlague, no target) Galaxy.Rnd.Next(10, 12) game days from now for
 * the player empire. RND: one Next(10, 12) when queued. BaconGalaxy.cs 347-351 / 355 runs it and re-queues it every 10 days.
 */
export function addOtherDelayedEvents(galaxy: Galaxy): void {
    if (hasDelayedAction(galaxy, CLEAR_SHIPS_ABOUT_TO_BE_DESTROYED)) return;
    const eventAction = new EventAction(null, EventActionType.StartPlague);
    eventAction.messageTitle = CLEAR_SHIPS_ABOUT_TO_BE_DESTROYED;
    eventAction.executionDate = galaxyStarDate(galaxy) + GAME_DAY_MS * galaxy.rnd.next(10, 12);
    const gameEvent = new GameEvent(galaxy, 0, null);
    galaxy.delayedActions.push(new EventActionExecutionPackage(eventAction, gameEvent, galaxy.playerEmpire));
}

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

/** The install's settings the last BaconInitialize started from (BaconSettings.txt as parsed; the per-game overrides'
 *  base). Process-wide like the statics. */
let installSettings: BaconSettings = defaultBaconSettings();

/** The install's BaconSettings.txt values (the base a game's overrides apply to; the C# defaults with no file). */
export function installBaconSettings(): Readonly<BaconSettings> {
    return installSettings;
}

/**
 * BaconMain.cs 605-1062: the statics take the loaded file's values (`settings` null/undefined = no BaconSettings.txt:
 * every static at its C# default) with this game's overrides on top (Galaxy.baconSettingsOverrides, ours), and 614-617
 * IndependentEmpire.Policy.TroopGarrisonMinimumPerColony when that key parsed. `galaxy` null applies only the statics
 * (from the file alone).
 */
export function baconInitializeSettings(galaxy: Galaxy | null, settings: BaconSettings | null | undefined): void {
    installSettings = { ...(settings ?? defaultBaconSettings()) };
    setBaconSettings(mergeBaconSettings(installSettings, galaxy?.baconSettingsOverrides));
    syncMovementSettings();
    const independent = galaxy?.independentEmpire ?? null;
    if (baconSettings.troopGarrisonMinimumPerColony !== null && independent !== null && independent.policy !== null) {
        independent.policy.troopGarrisonMinimumPerColony = baconSettings.troopGarrisonMinimumPerColony;
    }
    if (galaxy !== null) {
        // BaconMain.cs 686-697, then 700-715 (the 716-1062 settings keys in between set statics only), then 1069.
        scheduleSaveStats(galaxy);
        scheduleProcessEmpireScienceShips(galaxy);
        addOtherDelayedEvents(galaxy);
    }
}

/**
 * Statics only, for a galaxy whose state lives elsewhere (the sim worker's main-thread replica): the install's file with
 * `overrides` on top, as the worker's BaconInitialize set them. No scheduling, no policy write.
 */
export function applyBaconSettingsStatics(overrides: BaconSettingsOverrides | null | undefined): void {
    setBaconSettings(mergeBaconSettings(installSettings, overrides));
    syncMovementSettings();
}

/**
 * The journaled setBaconSettings command (ours; the Bacon Mod Settings window): `requested` becomes this game's whole
 * override set (keys absent from it go back to the install's value; {} = the file's values), stored only where a value
 * differs from the file. Then BaconInitialize runs again at the command's frame boundary, as the C# does when a game is
 * loaded: every static takes its new value (the code reads them at use time), TroopGarrisonMinimumPerColony is written
 * to the independent empire's policy, and the SaveStats / ProcessEmpireScienceShips / ClearShipsAboutToBeDestroyed
 * actions are queued when missing (a Galaxy.Rnd draw only when one is queued, at this deterministic point). Returns the
 * stored overrides.
 */
export function applyBaconSettingsCommand(galaxy: Galaxy, requested: BaconSettingsOverrides): BaconSettingsOverrides {
    const stored = baconSettingsOverrides(installSettings, requested);
    if (Object.keys(stored).length > 0) galaxy.baconSettingsOverrides = stored;
    else delete galaxy.baconSettingsOverrides;
    baconInitializeSettings(galaxy, installSettings);
    return { ...stored };
}
