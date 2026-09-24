import { beforeAll, describe, expect, it } from 'vitest';
import type { GameData } from '../src/sim/data/gameData';
import { createGame } from '../src/sim/game';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { defaultStartGameOptions, toCreateGameOptions } from '../src/sim/startGameOptions';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { loadGameDataFs } from './helpers/loadGameDataFs';

const systemNames = Array.from({ length: 200 }, (_, i) => `Test System ${i}`);

let gameData: GameData;

beforeAll(async () => {
    gameData = await loadGameDataFs();
});

describe('game save/load (11a2)', () => {
    // Pinned seed: defaultStartGameOptions uses Date.now() for the seed.
    const startOptions = { ...defaultStartGameOptions(), seed: 42 };

    it('createGame → advance 10 s → serialize/deserialize/serialize is byte-identical', () => {
        const game = createGame(toCreateGameOptions(startOptions, gameData, systemNames));
        const time = new GalaxyTime();
        time.togglePause();
        time.advance(10_000);

        const text1 = serializeGame(game, time, startOptions);
        const restored = deserializeGame(text1, gameData);
        const text2 = serializeGame(restored.game, restored.time, restored.startOptions);

        expect(text2).toBe(text1);
    });

    it('restored player empire keeps its name and colony count', () => {
        const game = createGame(toCreateGameOptions(startOptions, gameData, systemNames));
        const time = new GalaxyTime();
        time.togglePause();
        time.advance(10_000);

        const restored = deserializeGame(serializeGame(game, time, startOptions), gameData);

        expect(restored.game.playerEmpire.name).toBe(game.playerEmpire.name);
        expect(restored.game.playerEmpire.colonies.length).toBe(game.playerEmpire.colonies.length);
    });
});