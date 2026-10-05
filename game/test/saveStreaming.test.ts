// The streamed save (serializeGameParts / GraphEncoder.encodeJson): the galaxy graph written straight to JSON text in
// chunks instead of as an encoded object tree then JSON.stringify — the same text, byte for byte, as the tree path
// (galaxyToJSON + JSON.stringify), for a whole game and for the codec's edge cases.
import { beforeAll, describe, expect, it } from 'vitest';
import type { GameData } from '../src/sim/data/gameData';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import { deserializeGame, GAME_SAVE_VERSION, serializeGame, serializeGameParts, type GameSaveJSON } from '../src/sim/save/gameSave';
import { flatEmpireList, galaxyToJSON } from '../src/sim/save/galaxySave';
import { GraphEncoder, JsonWriter } from '../src/sim/save/graphCodec';
import { commandLog, copyCommandLogEntry } from '../src/sim/player/commandLog';
import { activeCustomizationSetName } from '../src/sim/data/customization';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

class Thing {
    a = 1;
    b: unknown = null;
}

describe('streamed save text', { timeout: 600000 }, () => {
    it('encodeJson writes exactly JSON.stringify(encode(…)) for the codec edge cases', () => {
        const shared = { s: 'x' };
        const t = new Thing();
        t.b = t;
        const sparse: unknown[] = [1, , 3]; // eslint-disable-line no-sparse-arrays
        const value = {
            n: [0, -0, 1.5, -2e-7, 1e21, NaN, Infinity, -Infinity],
            str: 'quote " backslash \\ newline \n tab \t unicode é ☃ \u0001 😀',
            u: undefined,
            b: [true, false, null],
            sparse,
            map: new Map<unknown, unknown>([['k', shared], [shared, 2]]),
            set: new Set([shared, 'y']),
            f64: new Float64Array([1, NaN, -0, Infinity, 0.1]),
            u8: new Uint8Array([0, 255]),
            i32: new Int32Array([-5]),
            t,
            t2: new Thing(),
            again: shared,
            empty: {},
            emptyArr: [],
            nested: { 'weird key "': [[], [{}]] },
        };
        const opts = { classes: { Thing: Thing.prototype } };
        const tree = JSON.stringify(new GraphEncoder(opts, new Map()).encode(value));
        for (const chunkChars of [1, 7, 1 << 22]) {
            const chunks: string[] = [];
            const w = new JsonWriter((c) => chunks.push(c), chunkChars);
            new GraphEncoder(opts, new Map()).encodeJson(value, w);
            w.end();
            expect(chunks.join('')).toBe(tree);
            if (chunkChars === 1) expect(chunks.length).toBeGreaterThan(20);
        }
    });

    it('serializeGame (streamed) is the tree path text, in any chunk size, and loads back to the same text', () => {
        const game = cachedTickGame(gameData, { seconds: 120 });
        const time = new GalaxyTime().bindGalaxy(game.galaxy);
        const startOptions = { ...defaultStartGameOptions(), seed: 1 };
        const text = serializeGame(game, time, startOptions);
        // The tree path, as serializeGame wrote it before streaming.
        const save: GameSaveJSON = {
            version: GAME_SAVE_VERSION,
            galaxy: galaxyToJSON(game.galaxy),
            time: { elapsedMs: time.elapsedMs, speed: time.speed, paused: time.paused, startStarDate: time.startStarDate },
            startOptions,
            playerEmpireIndex: game.galaxy.playerEmpire === null ? -1 : flatEmpireList(game.galaxy).indexOf(game.galaxy.playerEmpire),
        };
        const log = commandLog(game.galaxy);
        if (log.length > 0) save.commandLog = log.map(copyCommandLogEntry);
        if (activeCustomizationSetName() !== '') save.customizationSet = activeCustomizationSetName();
        expect(text === JSON.stringify(save)).toBe(true);
        const small = serializeGameParts(game, time, startOptions, (c) => c, 65536);
        expect(small.length).toBeGreaterThan(10);
        expect(small.join('') === text).toBe(true);
        const loaded = deserializeGame(text, gameData);
        expect(serializeGame(loaded.game, loaded.time, loaded.startOptions) === text).toBe(true);
    });
});
