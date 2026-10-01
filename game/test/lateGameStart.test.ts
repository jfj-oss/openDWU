// Late-game ("Mature") start through the wizard options: the colony influence slider is a percent (Start.1.cs 3745
// divides by 100). Passed undivided, the influence radii were 100x, one or two empires claimed the whole galaxy and
// the extra-starting-colony placement (Start.2.cs 996-1050) looped forever — the "1400 stars / 20 Mature empires never
// loads" report. Also: createGameSteps (the progress-overlay driver) builds exactly the game createGame does.
import { beforeAll, describe, expect, it } from 'vitest';
import { createGame, createGameSteps, type GameStartProgress } from '../src/sim/game';
import { defaultStartGameOptions, toCreateGameOptions } from '../src/sim/startGameOptions';
import { stateDigest } from '../src/sim/tick/digest';
import type { GameData } from '../src/sim/data/gameData';
import { loadGameDataFs } from './helpers/loadGameDataFs';

describe('Mature start from the wizard options', () => {
    let gameData: GameData;
    beforeAll(async () => {
        gameData = await loadGameDataFs();
    });

    function options() {
        const so = defaultStartGameOptions();
        so.seed = 7;
        so.raceName = 'Human';
        so.starCountIndex = 2; // 400 stars
        so.dimensionIndex = 2; // 8x8
        so.galaxyExpansionIndex = 4; // Mature
        so.empireExpansionIndex = 4;
        so.otherEmpires.empireCount = 9;
        return toCreateGameOptions(so, gameData, Array.from({ length: 500 }, (_, i) => `S${i}`));
    }

    it('finishes, every capital lies in its own territory, and createGameSteps matches createGame', () => {
        const opts = options();
        expect(opts.empireTerritoryColonyInfluenceRangeFactor).toBe(1);
        const steps = createGameSteps(opts);
        const seen: GameStartProgress[] = [];
        let r = steps.next();
        while (r.done !== true) {
            seen.push(r.value);
            r = steps.next();
        }
        const g = r.value.galaxy;
        for (const e of g.empires) expect(g.empireTerritory.checkLocationOwnership(g, e.capital!.xpos, e.capital!.ypos)).toBe(e.empireId);
        expect(g.empires.reduce((n, e) => n + e.colonies.length, 0)).toBeGreaterThan(g.empires.length);
        for (let i = 1; i < seen.length; i++) expect(seen[i].fraction).toBeGreaterThanOrEqual(seen[i - 1].fraction);
        expect(seen.length).toBeGreaterThan(10);
        expect(stateDigest(createGame(options()).galaxy)).toBe(stateDigest(g));
    }, 120000);
});
