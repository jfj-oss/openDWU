// 19r item 2: league presence (src/render/leagueArt.ts) over the 19k-3 league shape — flag, pennant, boundary.
import { describe, expect, it } from 'vitest';
import { activeLeaguesOf, convexHull, leagueBoundaryDots, leagueFlag, pennantFromFlag } from '../src/render/leagueArt';
import { leagueListRows } from '../src/ui/leagueRows';
import type { Galaxy } from '../src/sim/galaxy';

describe('19r league art', () => {
    it('flag: deterministic, league-colour foot band, pale chain links in the fly', () => {
        const f = leagueFlag(null, 0x2080c0);
        expect(f.data).toEqual(leagueFlag(null, 0x2080c0).data);
        expect(f.data).not.toEqual(leagueFlag(null, 0xc04020).data);
        let pale = 0;
        for (let y = 0; y < f.h; y++) for (let x = Math.floor(f.w * 0.5); x < f.w; x++) {
            const i = (y * f.w + x) * 4;
            if (f.data[i] > 200 && f.data[i + 1] > 200) pale++;
        }
        expect(pale).toBeGreaterThan(40);
    });
    it('pennant: tapering swallowtail (notch at the fly transparent)', () => {
        const p = pennantFromFlag(leagueFlag(null, 0x2080c0), 48, 28, 0);
        expect(p.data[(14 * 48 + 47) * 4 + 3]).toBe(0);
        expect(p.data[(14 * 48 + 2) * 4 + 3]).toBe(255);
        expect(p.data[(0 * 48 + 40) * 4 + 3]).toBe(0);
    });
    it('hull and dotted boundary round the members', () => {
        const h = convexHull([
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 5, y: 5 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
        ]);
        expect(h.length).toBe(4);
        const members = [
            { x: 0, y: 0 },
            { x: 100000, y: 0 },
            { x: 50000, y: 80000 },
        ];
        const dots = leagueBoundaryDots(members, 20000, 3000);
        expect(dots.length).toBeGreaterThan(50);
        for (const d of dots) {
            const nearest = Math.min(...members.map((m) => Math.hypot(d.x - m.x, d.y - m.y)));
            expect(nearest).toBeGreaterThan(20000 * 0.95);
        }
        expect(leagueBoundaryDots([], 1, 1)).toEqual([]);
    });
    it('only active leagues, only with the state', () => {
        const l = (id: number, status: string) => ({ id, name: `L${id}`, colour: 0, flagShape: -1, founder: null, members: [], status });
        expect(activeLeaguesOf({ leagues: [l(1, 'active'), l(2, 'dissolved')] }).map((x) => x.id)).toEqual([1]);
        expect(activeLeaguesOf(undefined)).toEqual([]);
        expect(leagueListRows({ scenario: null } as unknown as Galaxy)).toEqual([]);
        expect(leagueListRows({ scenario: { state: { independents: { leagues: [l(3, 'active')] } } } } as unknown as Galaxy).map((r) => r.label)).toEqual(['L3']);
    });
});
