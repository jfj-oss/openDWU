// Index grids across game start and save/load (Galaxy.5.cs 3197 RebuildIndexes, ported as src/sim/indexRebuild.ts).
// Generation files each system's habitats under the star's cell (Galaxy.4.cs 2323-2333); the C# then rebuilds every
// grid from positions once the galaxy is set up (Start.2.cs 118), so a planet whose orbit crosses into the next cell
// is found from its own cell. The save keeps the grids as they are (save-transparent: loading and continuing equals
// continuing), so a round trip must not change them.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import { createTickGame } from './helpers/tickGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { HabitatType } from '../src/sim/types';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { runGameSeconds } from '../src/sim/tick/harness';
import type { StartGameOptions } from '../src/sim/startGameOptions';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

function habitatGrid(g: Galaxy): number[][][] {
    return g.habitatIndexGrid.map((col) => col.map((cell) => cell.map((h) => h.habitatIndex)));
}
function builtObjectGrid(g: Galaxy): number[][][] {
    return g.builtObjectIndexGrid.map((col) => col.map((cell) => cell.map((b) => b.builtObjectID)));
}

describe('habitat / built-object index grids', () => {
    it('after createGame every habitat is in its own cell (RebuildIndexes), not its star’s', () => {
        const g = createTickGame(gameData).galaxy;
        let crossing = 0;
        for (const h of g.habitats) {
            const own = g.resolveIndex(h.xpos, h.ypos);
            expect(g.habitatIndexGrid[own.x][own.y]).toContain(h);
            const star = g.systems[h.systemIndex]?.systemStar;
            if (star !== undefined) {
                const sc = g.resolveIndex(star.xpos, star.ypos);
                if (sc.x !== own.x || sc.y !== own.y) {
                    crossing++;
                    expect(g.habitatIndexGrid[sc.x][sc.y]).not.toContain(h);
                }
            }
        }
        expect(crossing).toBeGreaterThan(0); // the case where the two rules differ exists in the seed-1 galaxy
    }, 300000);

    it('a save/load round trip keeps the grids and the nearest-habitat queries identical', () => {
        const game = cachedTickGame(gameData);
        runGameSeconds(game.galaxy, 20);
        const g = game.galaxy;
        const time = new GalaxyTime();
        time.bindGalaxy(g);
        const loaded = deserializeGame(serializeGame(game, time, {} as StartGameOptions), gameData).game.galaxy;
        expect(habitatGrid(loaded)).toEqual(habitatGrid(g));
        expect(builtObjectGrid(loaded)).toEqual(builtObjectGrid(g));
        // Query at each cell-crossing planet (the positions where the star-cell and own-cell rules give different answers).
        let checked = 0;
        for (const h of g.habitats) {
            const star = g.systems[h.systemIndex]?.systemStar;
            if (star === undefined) continue;
            const own = g.resolveIndex(h.xpos, h.ypos);
            const sc = g.resolveIndex(star.xpos, star.ypos);
            if (own.x === sc.x && own.y === sc.y) continue;
            const a = g.findNearestUncolonizedHabitat(h.xpos, h.ypos, HabitatType.Undefined);
            const b = loaded.findNearestUncolonizedHabitat(h.xpos, h.ypos, HabitatType.Undefined);
            expect(b?.habitatIndex).toBe(a?.habitatIndex);
            checked++;
        }
        expect(checked).toBeGreaterThan(0);
    }, 300000);
});
