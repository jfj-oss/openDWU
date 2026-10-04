// Regressions found by the long-game soak (scripts/soak.mjs, 2026-10-04).
import { beforeAll, describe, expect, it } from 'vitest';
import type { GameData } from '../src/sim/data/gameData';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { EmpireMessage, EmpireMessageType, sendMessageToEmpire } from '../src/sim/messages';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import type { Game } from '../src/sim/game';
import { cachedTickGame } from './helpers/gameCache';
import { loadGameDataFs } from './helpers/loadGameDataFs';

describe('EmpireMessage keeps its own Point (C# Point is a struct)', () => {
    it('copies the location and a Point subject instead of aliasing the caller object', () => {
        const shared = { x: 0, y: 0 };
        const a = new EmpireMessage(null, EmpireMessageType.Informational, null);
        const b = new EmpireMessage(null, EmpireMessageType.Informational, null);
        a.location = shared;
        b.location = shared;
        expect(a.location).not.toBe(shared);
        expect(a.location).not.toBe(b.location);
        shared.x = 5;
        expect(a.location).toEqual({ x: 0, y: 0 });
        const p = { x: 3, y: 4 };
        const c = new EmpireMessage(null, EmpireMessageType.Informational, p);
        expect(c.subject).toEqual({ x: 3, y: 4 });
        expect(c.subject).not.toBe(p);
    });
});

describe('save → load → continue encodes messages sent with a shared location the same way', () => {
    let gameData: GameData;
    let game: Game;
    beforeAll(async () => {
        gameData = await loadGameDataFs();
        game = cachedTickGame(gameData);
    }, 600000);

    it('the loaded game and the running game save identical text after the same messages', () => {
        // diplomacyTick.ts NO_POINT is one module-level object passed as the location of many messages: aliased, the
        // running game's save wrote later uses as $refs to the first while the loaded game (whose earlier messages hold
        // decoded copies) wrote them inline.
        const NO_POINT = { x: 0, y: 0 };
        const so = { ...defaultStartGameOptions(), seed: 1 };
        const time = new GalaxyTime();
        const player = game.galaxy.playerEmpire!;
        const other = game.galaxy.empires.find((e) => e !== player)!;
        sendMessageToEmpire(other, player, EmpireMessageType.Informational, null, 'first', NO_POINT);
        const loaded = deserializeGame(serializeGame(game, time, so), gameData).game;
        for (const g of [game, loaded]) {
            const p = g.galaxy.playerEmpire!;
            const o = g.galaxy.empires.find((e) => e !== p)!;
            sendMessageToEmpire(o, p, EmpireMessageType.Informational, null, 'second', NO_POINT);
        }
        expect(serializeGame(loaded, time, so)).toBe(serializeGame(game, time, so));
    });
});
