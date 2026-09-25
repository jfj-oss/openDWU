import { beforeAll, describe, expect, it } from 'vitest';
import { createGame } from '../src/sim/game';
import { setGovernmentsStatic } from '../src/sim/empire';
import type { GameData } from '../src/sim/data/gameData';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { defaultStartGameOptions, maximumEmpireAmountFor, toCreateGameOptions } from '../src/sim/startGameOptions';

// Wizard pirate generation: Galaxy.MaximumEmpireAmount comes from BaconStart.cs 84 method_61 (star density,
// playable races), not from the empire count, so a 700-star galaxy gets pirates even at low prevalence.
let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
    setGovernmentsStatic(gameData.governments);
}, 60000);

describe('maximumEmpireAmountFor (BaconStart.cs 84 method_61)', () => {
    it('maps the star-density slider (max(playable races, 20) from Standard up)', () => {
        expect([0, 1, 2, 3, 4, 5, 6, 7].map((i) => maximumEmpireAmountFor(i, 22))).toEqual([12, 15, 18, 22, 22, 22, 22, 10]);
        expect(maximumEmpireAmountFor(3, 17)).toBe(20);
    });
    it('toCreateGameOptions passes it (stock install: 20 playable races → 20 at 700 stars)', () => {
        const c = toCreateGameOptions({ ...defaultStartGameOptions(), seed: 1 }, gameData, []);
        expect(gameData.races.filter((r) => r.playable).length).toBe(20);
        expect(c.maximumEmpireAmount).toBe(20);
    });
});

describe('wizard game, seed 1 / 700 stars, Pirates "Few" (0.2)', { timeout: 120000 }, () => {
    it('generates pirate factions (Galaxy.9.cs 22-70)', () => {
        const o = { ...defaultStartGameOptions(), seed: 1, raceName: 'Human', piratesIndex: 2 };
        const c = toCreateGameOptions(o, gameData, Array.from({ length: 800 }, (_, i) => `N${i}`));
        expect(c.piratePrevalence).toBe(0.2);
        const g = createGame(c);
        // num = trunc(2 * 0.2 * 20) = 8; num3 = trunc(8 * max((490 - colonies) / 490, 0.1)) = 7 (Galaxy.9.cs 22 / 52-56).
        // Proximity Average (1): no extra near-player faction (Start.2.cs 1493 needs PirateProximity 0).
        expect(g.galaxy.pirateEmpires.length).toBe(7);
        expect(g.galaxy.maximumEmpireAmount).toBe(20);
    });
});
