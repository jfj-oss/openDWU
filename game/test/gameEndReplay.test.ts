// A game that ends is the same game with or without the UI's Galaxy.GameEnd subscriber (docs/sim-worker.md §10):
// DoGameEnd's model part (IsFinished and the victor — which stop the yearly CheckVictoryConditions — and method_436's
// achievement review) runs in the sim's onGameEnd. It used to run only in the handlers the app and the sim worker
// install, so seed + the command log of a session in which the game ended replayed headless to another game
// (gameIsFinished false, the victor unset, the victory check raised again every long tick).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import { runGameSeconds } from '../src/sim/tick/harness';
import { galaxyToJSON } from '../src/sim/save/galaxySave';
import { stateDigest } from '../src/sim/tick/digest';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { GameEndEventArgs, VictoryConditions, setGameEndHandler } from '../src/sim/victory';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

/** The harness game with a time limit that has just arrived (the game ends at the next long tick). */
function endingGame(): Game {
    const game = cachedTickGame(gameData);
    const vc = new VictoryConditions();
    vc.timeLimit = true;
    vc.timeLimitDate = galaxyStarDate(game.galaxy);
    game.galaxy.globalVictoryConditions = vc;
    return game;
}

describe('game end: the model part runs in the sim', () => {
    it('with the UI subscriber (app, worker) and headless (a replay) the game that ended is the same', () => {
        const app = endingGame();
        const ends: GameEndEventArgs[] = [];
        setGameEndHandler(app.galaxy, (e) => void ends.push(e));
        runGameSeconds(app, 150);
        setGameEndHandler(app.galaxy, null);

        const headless = endingGame();
        runGameSeconds(headless, 150);

        // Ended once (IsFinished stops the yearly check), with the victor recorded and the achievements reviewed.
        expect(ends.length).toBe(1);
        expect(app.galaxy.gameIsFinished).toBe(true);
        expect(app.galaxy.gameVictor).toBe(ends[0].victorEmpire);
        expect(headless.galaxy.gameIsFinished).toBe(true);
        expect(stateDigest(headless.galaxy)).toBe(stateDigest(app.galaxy));
        expect(JSON.stringify(galaxyToJSON(headless.galaxy)) === JSON.stringify(galaxyToJSON(app.galaxy))).toBe(true);
    }, 600000);
});
