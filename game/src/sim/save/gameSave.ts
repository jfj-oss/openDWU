// Save/load part 2 (task 11a2): serialize a whole game — galaxy + empires
// (via galaxyToJSON, which now carries the empire data), the GalaxyTime clock
// and the new-game StartGameOptions — into one JSON string, and rebuild it.
// The C# Game ISerializable members are not ported; this is our own save
// format for the headless sim. Key order is fixed so round-tripped strings
// compare byte-for-byte equal.

import type { Game } from '../game';
import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { GameData } from '../data/gameData';
import type { StartGameOptions } from '../startGameOptions';
import { GalaxyTime } from '../galaxyTime';
import { galaxyFromJSON, galaxyToJSON, type GalaxySaveJSON } from './galaxySave';

export interface GameSaveJSON {
    version: 1;
    galaxy: GalaxySaveJSON;
    // Mirrors galaxy.empires/pirateEmpires/independentEmpire (kept at the top
    // level per the task's shape spec); the authoritative copy lives inside
    // the galaxy object.
    empires: GalaxySaveJSON['empires'];
    time: { elapsedMs: number; speed: number; paused: boolean; startStarDate: number };
    startOptions: StartGameOptions;
    playerEmpireIndex: number; // -1 = none (index into the flat empire list)
}

/** Serialize a whole game to a JSON string (see GameSaveJSON). */
export function serializeGame(game: Game, time: GalaxyTime, startOptions: StartGameOptions): string {
    const galaxyJson = galaxyToJSON(game.galaxy);
    const save: GameSaveJSON = {
        version: 1,
        galaxy: galaxyJson,
        empires: galaxyJson.empires,
        time: {
            elapsedMs: time.elapsedMs,
            speed: time.speed,
            paused: time.paused,
            startStarDate: time.startStarDate,
        },
        startOptions,
        playerEmpireIndex: galaxyJson.playerEmpire,
    };
    return JSON.stringify(save);
}

/** Rebuild a game from a serializeGame string. Static data (races, resources,
 *  research, governments) comes from gameData. */
export function deserializeGame(text: string, gameData: GameData): { game: Game; time: GalaxyTime; startOptions: StartGameOptions } {
    const obj = JSON.parse(text) as GameSaveJSON;
    if (obj.version !== 1) throw new Error(`Unsupported save version ${obj.version}.`);

    const galaxy: Galaxy = galaxyFromJSON(obj.galaxy, gameData);

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