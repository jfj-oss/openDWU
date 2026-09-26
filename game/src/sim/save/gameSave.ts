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
import { flatEmpireList, galaxyFromJSON, galaxyToJSON, type GalaxySaveJSON } from './galaxySave';
import { commandLog, restoreCommandLog, type CommandLogEntry } from '../player/commandLog';

/** Bumped to 2 when the galaxy graph (M3 state) replaced the index-based
 *  format; version-1 saves predate ships/bases/characters and are rejected. */
export const GAME_SAVE_VERSION = 2;

export interface GameSaveJSON {
    version: typeof GAME_SAVE_VERSION;
    galaxy: GalaxySaveJSON;
    time: { elapsedMs: number; speed: number; paused: boolean; startStarDate: number };
    startOptions: StartGameOptions;
    playerEmpireIndex: number; // -1 = none (index into the flat empire list)
    /** 18c: external commands applied between ticks (player/commandLog.ts); present only when non-empty. */
    commandLog?: CommandLogEntry[];
}

/** Serialize a whole game to a JSON string (see GameSaveJSON). */
export function serializeGame(game: Game, time: GalaxyTime, startOptions: StartGameOptions): string {
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
    if (log.length > 0) save.commandLog = log.map((e) => ({ ...e, command: { ...e.command } }));
    return JSON.stringify(save);
}

/**
 * Mod layer: the scenario id a save was made with (galaxy.scenario.id in the encoded graph), or null for the faithful
 * game. Reads the JSON without decoding the graph, so a loader can pick the scenario overlay before deserializeGame.
 */
export function savedScenarioId(save: string | GameSaveJSON): string | null {
    const obj = typeof save === 'string' ? (JSON.parse(save) as GameSaveJSON) : save;
    const g = obj.galaxy?.galaxy as { $f?: { scenario?: { $f?: { id?: unknown } } | null } } | undefined;
    const id = g?.$f?.scenario?.$f?.id;
    return typeof id === 'string' ? id : null;
}

/** Rebuild a game from a serializeGame string. Static data (races, resources,
 *  research, governments) comes from gameData. */
export function deserializeGame(text: string, gameData: GameData): { game: Game; time: GalaxyTime; startOptions: StartGameOptions } {
    const obj = JSON.parse(text) as GameSaveJSON;
    if (obj.version !== GAME_SAVE_VERSION) throw new Error(`Unsupported save version ${String(obj.version)} (expected ${GAME_SAVE_VERSION}).`);
    // Mod layer: the static tables are rebuilt from gameData, so it must carry the save's scenario overlay (or none).
    const savedScenario = savedScenarioId(obj);
    const dataScenario = gameData.scenario?.manifest.id ?? null;
    if (savedScenario !== dataScenario) {
        throw new Error(`Save was made with scenario ${savedScenario ?? '(none)'} but the game data has ${dataScenario ?? 'no scenario'}; load it with that scenario's data.`);
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