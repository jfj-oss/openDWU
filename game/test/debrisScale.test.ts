// Option "Scale debris fields with galaxy size" (our addition; Start.2.cs 1968-2010 debrisFieldsAtStart is the original).
import { appendFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { tickGameOptions } from './helpers/tickGame';
import { createGame } from '../src/sim/game';
import type { GameData } from '../src/sim/data/gameData';
import { GalaxyLocationType } from '../src/sim/galaxyLocation';
import { debrisFieldCounts } from '../src/sim/story/storyStart';
import { defaultStartGameOptions, wizardStartGameOptions } from '../src/sim/startGameOptions';

describe('debrisFieldCounts', () => {
    const orig = (n: number) => (n >= 1400 ? [3, 5, 3] : n >= 700 ? [2, 3, 2] : n >= 400 ? [1, 3, 1] : [0, 2, 1]);
    it('off is the original bands', () => {
        for (const n of [50, 200, 399, 400, 699, 700, 1399, 1400, 4000]) {
            const c = debrisFieldCounts(n, false);
            expect([c.large, c.small, c.destroyers]).toEqual(orig(n));
        }
    });
    it('on scales, never below the original, destroyers unchanged', () => {
        const table: Record<number, [number, number]> = { 4000: [20, 50], 1400: [7, 18], 700: [4, 9], 400: [2, 5], 200: [1, 3] };
        for (const [n, [l, s]] of Object.entries(table)) expect(debrisFieldCounts(+n, true)).toMatchObject({ large: l, small: s });
        for (let n = 10; n <= 4000; n += 10) {
            const c = debrisFieldCounts(n, true);
            const o = orig(n);
            expect(c.large).toBeGreaterThanOrEqual(o[0]);
            expect(c.small).toBeGreaterThanOrEqual(o[1]);
            expect(c.destroyers).toBe(o[2]);
        }
    });
});

describe('options', () => {
    it('wizard default is on; createGame / unset is off', () => {
        expect(wizardStartGameOptions().scaleDebrisFields).toBe(true);
        expect(defaultStartGameOptions().scaleDebrisFields).toBeUndefined(); // keeps the pinned harness saves identical
    });
});

describe('4000-star Distant Worlds galaxy', () => {
    let gd: GameData;
    beforeAll(async () => {
        gd = await loadGameDataFs();
    });
    it('generates 20 large + 50 small (or as many as lonely spots allow), off keeps 3 + 5', () => {
        const run = (scale: boolean) => {
            const t = Date.now();
            const g = createGame({ ...tickGameOptions(gd), starCount: 4000, storyDistantWorldsEnabled: true, scaleDebrisFields: scale }).galaxy;
            const n = g.galaxyLocations.filter((l) => l.type === GalaxyLocationType.DebrisField).length;
            return { n, ms: Date.now() - t };
        };
        const off = run(false);
        const on = run(true);
        if (process.env.DEBRIS_LOG) appendFileSync(process.env.DEBRIS_LOG, `DEBRIS 4000 stars: off ${off.n} fields ${off.ms} ms; on ${on.n} fields ${on.ms} ms\n`);
        expect(on.n - off.n).toBeGreaterThanOrEqual(60);
        expect(on.n - off.n).toBeLessThanOrEqual(62);
    }, 1800000);
});
