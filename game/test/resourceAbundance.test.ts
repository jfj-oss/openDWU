import { beforeAll, describe, expect, it } from 'vitest';
import { abundancePercentText } from '../src/ui/resourceAbundance';
import { cachedTickGame } from './helpers/gameCache';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

describe('resource abundance display', () => {
    it('matches ((double)Abundance / 1000).ToString("0%")', () => {
        expect(abundancePercentText(450)).toBe('45%');
        expect(abundancePercentText(1000)).toBe('100%');
        expect(abundancePercentText(5)).toBe('1%');
        expect(abundancePercentText(0)).toBe('0%');
    });
    it('generated abundances stay on the 0..1000 scale (Galaxy.4.cs: min/max * 1000)', () => {
        const g = cachedTickGame(gameData).galaxy;
        const v: number[] = [];
        for (const h of g.habitats) for (const r of h.resources) v.push(r.abundance);
        expect(v.length).toBeGreaterThan(100);
        expect(Math.max(...v)).toBeLessThanOrEqual(1000);
        const sorted = [...v].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        console.log('abundance n', v.length, 'median', median, 'p90', sorted[Math.floor(sorted.length * 0.9)], 'max', sorted[sorted.length - 1]);
        // displayed values are <= 100%
        expect(Math.max(...v.map((a) => Math.round(a / 10)))).toBeLessThanOrEqual(100);
    });
});
