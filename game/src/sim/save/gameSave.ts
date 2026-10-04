// Save/load part 2 (task 11a2, format 2 with the M3 game-start state):
// serialize a whole game — the galaxy graph (empires, ships, bases, designs,
// characters, pirates; see galaxySave.ts), the GalaxyTime clock and the
// new-game StartGameOptions — into one JSON string, and rebuild it. The C#
// Game ISerializable members are not ported; this is our own save format for
// the headless sim. Key order is fixed so round-tripped strings compare
// byte-for-byte equal.

import { baconInitializeSettings } from '../baconSettings';
import type { Game } from '../game';
import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { GameData } from '../data/gameData';
import type { StartGameOptions } from '../startGameOptions';
import { GalaxyTime } from '../galaxyTime';
import { encodedField, flatEmpireList, galaxyFromJSON, galaxyToJSON, type GalaxySaveJSON } from './galaxySave';
import { commandLog, copyCommandLogEntry, restoreCommandLog, type CommandLogEntry } from '../player/commandLog';
import { flushPlayerCommands } from '../player/playerCommands';
import { ensurePlayerInbox, processPlayerMessages } from '../playerMessages';
import { COMPOSITE_SCENARIO_ID } from '../scenario/addons';

/** Bumped to 2 when the galaxy graph (M3 state) replaced the index-based
 *  format; version-1 saves predate ships/bases/characters and are rejected. */
export const GAME_SAVE_VERSION = 2;

export interface GameSaveJSON {
    version: typeof GAME_SAVE_VERSION;
    galaxy: GalaxySaveJSON;
    time: { elapsedMs: number; speed: number; paused: boolean; startStarDate: number };
    startOptions: StartGameOptions;
    playerEmpireIndex: number; // -1 = none (index into the flat empire list)
    /** External commands applied at frame boundaries (player/commandLog.ts); present only when non-empty. */
    commandLog?: CommandLogEntry[];
}

/** Serialize a whole game to a JSON string (see GameSaveJSON). */
export function serializeGame(game: Game, time: GalaxyTime, startOptions: StartGameOptions): string {
    // Player commands still queued apply now: saving happens between frames, at the same boundary (galaxy.nowMs) the
    // next frame would apply them at, so the saved game and its log match the game that keeps running.
    flushPlayerCommands(game.galaxy);
    // The player's inbox too (playerMessages.ts): a save point has handled everything sent so far, so the inbox (per
    // run, not saved) is empty and the loaded game goes on as this one does. Nothing to do unless something was sent
    // outside the sim's frames and commands.
    processPlayerMessages(game.galaxy);
    const save: GameSaveJSON = {
        version: GAME_SAVE_VERSION,
        galaxy: galaxyToJSON(game.galaxy),
        time: {
            elapsedMs: time.elapsedMs,
            speed: time.speed,
            paused: time.paused,
            startStarDate: time.startStarDate,
        },
        startOptions,
        playerEmpireIndex: game.galaxy.playerEmpire === null ? -1 : flatEmpireList(game.galaxy).indexOf(game.galaxy.playerEmpire),
    };
    const log = commandLog(game.galaxy);
    if (log.length > 0) save.commandLog = log.map(copyCommandLogEntry);
    return JSON.stringify(save);
}

/**
 * Mod layer: the scenario id a save was made with (galaxy.scenario.id in the encoded graph), or null for the faithful
 * game. Reads the JSON without decoding the graph, so a loader can pick the scenario overlay before deserializeGame.
 */
export function savedScenarioId(save: string | GameSaveJSON): string | null {
    const obj = typeof save === 'string' ? (JSON.parse(save) as GameSaveJSON) : save;
    const id = obj.galaxy === undefined ? undefined : encodedField(obj.galaxy, encodedField(obj.galaxy, obj.galaxy.galaxy, 'scenario'), 'id');
    return typeof id === 'string' ? id : null;
}

/**
 * Add-on picker: the `include` list of a save's scenario manifest (galaxy.scenario.manifest.include, plain JSON in the
 * encoded graph) — for a composite ('addons') game, the flattened add-on set its overlay is rebuilt from. Null without
 * a scenario or a readable list.
 */
export function savedScenarioInclude(save: string | GameSaveJSON): string[] | null {
    const obj = typeof save === 'string' ? (JSON.parse(save) as GameSaveJSON) : save;
    const manifest = obj.galaxy === undefined ? undefined : encodedField(obj.galaxy, encodedField(obj.galaxy, obj.galaxy.galaxy, 'scenario'), 'manifest');
    const inc = manifest !== null && typeof manifest === 'object' && !Array.isArray(manifest) ? manifest.include : undefined;
    return Array.isArray(inc) && inc.every((x) => typeof x === 'string') ? (inc as string[]) : null;
}

/** Rebuild a game from a serializeGame string (or that string already JSON.parse'd — a big save is parsed once by a
 *  loader that also reads its scenario id). Static data (races, resources, research, governments) comes from gameData. */
export function deserializeGame(save: string | GameSaveJSON, gameData: GameData): { game: Game; time: GalaxyTime; startOptions: StartGameOptions } {
    const obj = typeof save === 'string' ? (JSON.parse(save) as GameSaveJSON) : save;
    if (obj.version !== GAME_SAVE_VERSION) throw new Error(`Unsupported save version ${String(obj.version)} (expected ${GAME_SAVE_VERSION}).`);
    // Mod layer: the static tables are rebuilt from gameData, so it must carry the save's scenario overlay (or none).
    const savedScenario = savedScenarioId(obj);
    const dataScenario = gameData.scenario?.manifest.id ?? null;
    if (savedScenario !== dataScenario) {
        throw new Error(`Save was made with scenario ${savedScenario ?? '(none)'} but the game data has ${dataScenario ?? 'no scenario'}; load it with that scenario's data.`);
    }
    // A composite (several add-ons) save needs the same add-on set in its data.
    if (savedScenario === COMPOSITE_SCENARIO_ID && (savedScenarioInclude(obj) ?? []).join(',') !== (gameData.scenario?.manifest.include ?? []).join(',')) {
        throw new Error(`Save was made with add-ons ${(savedScenarioInclude(obj) ?? []).join(', ')} but the game data has ${(gameData.scenario?.manifest.include ?? []).join(', ')}.`);
    }

    const galaxy: Galaxy = galaxyFromJSON(obj.galaxy, gameData);
    restoreCommandLog(galaxy, obj.commandLog);
    // BaconStart.LoadGame clears settingsInitialized; BaconMain.BaconInitialize re-reads BaconSettings.txt when the
    // loaded game starts (Main.Part12.cs 3151).
    baconInitializeSettings(galaxy, gameData.baconSettings);

    // GalaxyTime is rebuilt without the constructor (it only sets
    // startStarDate; the other fields have class defaults we overwrite).
    const time = Object.create(GalaxyTime.prototype) as GalaxyTime;
    time.startStarDate = obj.time.startStarDate;
    time.elapsedMs = obj.time.elapsedMs;
    time.speed = obj.time.speed;
    time.paused = obj.time.paused;

    const playerEmpire: Empire | null = obj.playerEmpireIndex < 0 ? null : galaxy.playerEmpire;
    // Main.Part12.cs:2881: the loaded game's player gets its recipient (playerMessages.ts); what Empire.Messages holds
    // was handled before the save.
    ensurePlayerInbox(galaxy);

    return {
        game: {
            galaxy,
            playerEmpire: playerEmpire ?? (galaxy.playerEmpire as Empire),
            viewX: 0,
            viewY: 0,
        },
        time,
        startOptions: obj.startOptions,
    };
}
/**
 * deserializeGame in steps for a loading screen (src/ui/loadingOverlay.ts): yields a progress report before the JSON
 * parse and before the graph decode — the two long, indivisible parts of loading a big save — and parses the text
 * once. `gameDataFor` picks the static data for the parsed save (its scenario overlay, see savedScenarioId).
 */
export function* deserializeGameSteps(
    text: string,
    gameDataFor: (save: GameSaveJSON) => GameData,
): Generator<{ step: string; fraction: number }, { game: Game; time: GalaxyTime; startOptions: StartGameOptions }, void> {
    yield { step: `Reading save (${Math.max(1, Math.round(text.length / 1048576))} MB)`, fraction: 0 };
    const obj = JSON.parse(text) as GameSaveJSON;
    yield { step: 'Rebuilding galaxy', fraction: 0.35 };
    return deserializeGame(obj, gameDataFor(obj));
}
