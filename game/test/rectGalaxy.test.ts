// @slow — soak: full games on non-square custom galaxies (10 × 90, 90 × 10, 3 × 60, 60 × 3 for every GalaxyShape) and odd
// squares (35 × 35, 45 × 45), each run 30 game days, plus save/load round trips; every system, colony and ship must stay inside the rectangle (test:slow tier).
// Custom galaxy size (not a port): the C# galaxy is always square, so every SizeX-for-both-axes / IndexMaxX-for-both
// spot in the port is generalised per axis (and reduces to the C# formula when SizeX === SizeY).
import { beforeAll, describe, expect, it } from 'vitest';
import type { GameData } from '../src/sim/data/gameData';
import { createGame } from '../src/sim/game';
import { GalaxyShape } from '../src/sim/types';
import { defaultStartGameOptions, setGalaxySectors, setGalaxyStarCount, toCreateGameOptions } from '../src/sim/startGameOptions';
import { runGameSeconds } from '../src/sim/tick/harness';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { stateDigest } from '../src/sim/tick/digest';
import { loadGameDataFs } from './helpers/loadGameDataFs';

const names = (n: number): string[] => Array.from({ length: n }, (_, i) => `S${i}`);

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 60000);

const SHAPES = [GalaxyShape.Spiral, GalaxyShape.Elliptical, GalaxyShape.Irregular, GalaxyShape.Ring, GalaxyShape.ClustersEven, GalaxyShape.ClustersVaried];
/** [sectors W, sectors H, stars, shapes]: every shape on tall and wide strips; two odd square sizes. */
const CASES: [number, number, number, readonly GalaxyShape[]][] = [
    [10, 90, 400, SHAPES],
    [90, 10, 400, SHAPES],
    [3, 60, 200, SHAPES],
    [60, 3, 200, SHAPES],
    // Odd square sizes past the presets (user report: 35 × 35 / 45 × 45).
    [35, 35, 700, [GalaxyShape.Spiral]],
    [45, 45, 700, [GalaxyShape.ClustersEven]],
];
/** 30 game days (a game day = RealSecondsInGalacticYear / 360 = 1.667 s). */
const RUN_SECONDS = 50;

describe('non-square galaxies start and run', () => {
    for (const [w, h, stars, shapes] of CASES) {
        for (const shape of shapes) {
            it(`${w} × ${h}, ${stars} stars, ${GalaxyShape[shape]}`, () => {
                const o = { ...defaultStartGameOptions(), seed: 7, raceName: 'Human', shape };
                setGalaxySectors(o, w, h);
                setGalaxyStarCount(o, stars);
                const game = createGame(toCreateGameOptions(o, gameData, names(stars)));
                const g = game.galaxy;
                expect([g.sectorWidth, g.sectorHeight, g.galaxyShape]).toEqual([w, h, shape]);
                expect(game.playerEmpire.capital).toBeTruthy();
                runGameSeconds(g, RUN_SECONDS);
                const inside = (what: string, x: number, y: number): void => {
                    if (!(x >= 0 && x <= g.sizeX && y >= 0 && y <= g.sizeY)) throw new Error(`${what} at (${x}, ${y}) outside ${g.sizeX} × ${g.sizeY}`);
                };
                for (const s of g.systems) inside(`system ${s.systemStar.name}`, s.systemStar.xpos, s.systemStar.ypos);
                for (const hab of g.habitats) inside(`habitat ${hab.name}`, hab.xpos, hab.ypos);
                let ships = 0;
                for (const e of g.empires) {
                    for (const c of e.colonies) inside(`colony ${c.name}`, c.xpos, c.ypos);
                    for (const bo of e.builtObjects) {
                        if (bo === null || bo.hasBeenDestroyed) continue;
                        inside(`ship ${bo.name}`, bo.xpos, bo.ypos);
                        ships++;
                    }
                }
                for (const bo of g.builtObjects) {
                    if (bo === null || bo.hasBeenDestroyed) continue;
                    inside(`ship ${bo.name}`, bo.xpos, bo.ypos);
                }
                expect(ships).toBeGreaterThan(0);
            }, 600000);
        }
    }
});

describe('odd and non-square sizes save and load', () => {
    for (const [w, h] of [[17, 17], [35, 35], [45, 45], [10, 90]] as const) {
        it(`${w} × ${h}: a save round-trips and the loaded game runs`, () => {
            const o = { ...defaultStartGameOptions(), seed: 7, raceName: 'Human' };
            setGalaxySectors(o, w, h);
            setGalaxyStarCount(o, 300);
            const game = createGame(toCreateGameOptions(o, gameData, names(300)));
            runGameSeconds(game.galaxy, 5);
            const time = new GalaxyTime();
            time.togglePause();
            const restored = deserializeGame(serializeGame(game, time, o), gameData);
            const g = restored.game.galaxy;
            expect([g.sectorWidth, g.sectorHeight, g.habitatIndexGrid.length, g.habitatIndexGrid[0].length]).toEqual([w, h, game.galaxy.indexMaxX, game.galaxy.indexMaxY]);
            expect(stateDigest(g)).toBe(stateDigest(game.galaxy));
            runGameSeconds(g, 10);
        }, 300000);
    }
});
