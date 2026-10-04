// System link lines (render/systemLinks.ts, MainView.2.cs method_250 5237-5336): which lines the network yields
// (dominant empire then other empires, LinkSystemStars then the reciprocal links not among them, both ends known to the
// viewer), the view's sector range and its reciprocal rule, XnaDrawingHelper.DrawLine's dash pieces, and the read-only
// collection on the harness game and on a sim-worker replica.
import { beforeAll, describe, expect, it } from 'vitest';
import { clipSegment, collectSystemLinks, dashPieces, selectSystemLinks, viewSectorRange, type SystemLink, type SystemLinkGalaxy } from '../src/render/systemLinks';
import type { Empire } from '../src/sim/empire';
import type { Galaxy } from '../src/sim/galaxy';
import type { Habitat, SystemInfo } from '../src/sim/types';
import type { GameData } from '../src/sim/data/gameData';
import { SystemVisibilityStatus } from '../src/sim/visibility';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { galaxyToJSON } from '../src/sim/save/galaxySave';
import type { StartGameOptions } from '../src/sim/startGameOptions';
import { SimHost } from '../src/simworker/simHost';
import { SimClientCore } from '../src/simworker/clientCore';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';

// --- a hand-built galaxy ------------------------------------------------------------------------------------------

interface FakeSv {
    linkSystemStars: (Habitat | null)[];
    reciprocalLinkSystemStars: (Habitat | null)[];
}

function fakeGalaxy(sectors: [number, number][]): { galaxy: SystemLinkGalaxy; stars: Habitat[]; systems: SystemInfo[] } {
    const stars = sectors.map(([sx, sy], i) => ({ systemIndex: i, xpos: sx * 2_000_000 + 100_000 + i * 1000, ypos: sy * 2_000_000 + 100_000 }) as unknown as Habitat);
    const systems = stars.map((star, i) => ({ systemStar: star, habitats: [star], sector: { x: sectors[i][0], y: sectors[i][1] }, dominantEmpire: null, otherEmpires: null }) as SystemInfo);
    return { galaxy: { systems } as SystemLinkGalaxy, stars, systems };
}

function fakeEmpire(color: number, n: number): { empire: Empire; sv: FakeSv[] } {
    const sv: FakeSv[] = Array.from({ length: n }, () => ({ linkSystemStars: [], reciprocalLinkSystemStars: [] }));
    return { empire: { mainColor: color, galaxy: null, systemVisibility: sv } as unknown as Empire, sv };
}

const summary = (e: Empire) => ({ empire: e, colonyCount: 1, totalStrategicValue: 0 });
const brief = (links: readonly SystemLink[]) => links.map((l) => `${l.fromSystem}>${l.toSystem}:${l.color.toString(16)}${l.reciprocal ? 'r' : ''}`);

describe('collectSystemLinks (method_250 5237-5336)', () => {
    it('dominant empire then other empires; links then the reciprocal links not among them; both ends seen', () => {
        const { galaxy, stars, systems } = fakeGalaxy([[0, 0], [0, 0], [1, 0], [2, 0], [0, 1]]);
        const a = fakeEmpire(0xff0000, 5);
        const b = fakeEmpire(0x00ff00, 5);
        // A: 0 → 1, 1 → 0 (both ways), 2 → 0; reciprocal index of 0 = {1, 2}, of 1 = {0}.
        a.sv[0].linkSystemStars.push(stars[1]);
        a.sv[1].linkSystemStars.push(stars[0]);
        a.sv[2].linkSystemStars.push(stars[0], null);
        a.sv[0].reciprocalLinkSystemStars.push(stars[1], stars[2], null);
        a.sv[1].reciprocalLinkSystemStars.push(stars[0]);
        // B (another empire with a colony in system 0): 0 → 3; system 4 → 0 (4 is unexplored).
        b.sv[0].linkSystemStars.push(stars[3]);
        b.sv[0].reciprocalLinkSystemStars.push(stars[4]);
        b.sv[4].linkSystemStars.push(stars[0]);
        systems[0].dominantEmpire = summary(a.empire);
        systems[0].otherEmpires = [summary(b.empire)];
        systems[1].dominantEmpire = summary(a.empire);
        systems[2].dominantEmpire = summary(a.empire);
        systems[4].dominantEmpire = summary(b.empire);
        const seen = (i: number) => i !== 4;
        const out: SystemLink[] = [];
        collectSystemLinks(galaxy, seen, out);
        expect(brief(out)).toEqual([
            // system 0: A's link to 1, A's reciprocal 2 (1 is among its links), then B's link to 3 (its reciprocal 4 is unseen)
            '0>1:ff0000', '0>2:ff0000r', '0>3:ff00',
            // system 1: A's link to 0 (reciprocal 0 is among the links)
            '1>0:ff0000',
            // system 2: A's link to 0 (the null entry skipped)
            '2>0:ff0000',
            // system 4: unseen — nothing
        ]);
        const l = out[1];
        expect([l.x0, l.y0, l.x1, l.y1]).toEqual([stars[0].xpos, stars[0].ypos, stars[2].xpos, stars[2].ypos]);
        expect([l.sx, l.sy, l.tx, l.ty]).toEqual([0, 0, 1, 0]);
    });

    it('a system without a DominantEmpire draws nothing, even with link lists; the hash follows the content', () => {
        const { galaxy, stars, systems } = fakeGalaxy([[0, 0], [0, 0]]);
        const a = fakeEmpire(0x123456, 2);
        a.sv[0].linkSystemStars.push(stars[1]);
        a.sv[1].linkSystemStars.push(stars[0]);
        systems[1].dominantEmpire = summary(a.empire);
        const out: SystemLink[] = [];
        const h1 = collectSystemLinks(galaxy, () => true, out);
        expect(brief(out)).toEqual(['1>0:123456']);
        expect(collectSystemLinks(galaxy, () => true, [])).toBe(h1);
        a.sv[1].linkSystemStars[0] = stars[1];
        expect(collectSystemLinks(galaxy, () => true, [])).not.toBe(h1);
        // The viewer's visibility is part of the content.
        a.sv[1].linkSystemStars[0] = stars[0];
        expect(collectSystemLinks(galaxy, (i) => i !== 0, [])).not.toBe(h1);
    });
});

describe('the view (method_250 5144-5147, 5229, 5268)', () => {
    const g = { sectorSize: 2_000_000, sectorWidth: 4, sectorHeight: 3 } as Pick<Galaxy, 'sectorSize' | 'sectorWidth' | 'sectorHeight'>;

    it('viewSectorRange: the sectors under the view edges, clamped to the galaxy', () => {
        // 1600 x 900 px at f = 1000: 1.6 M x 0.9 M units around (3.0 M, 1.0 M).
        expect(viewSectorRange(g, 3_000_000, 1_000_000, 1600, 900, 1000)).toEqual({ x0: 1, x1: 1, y0: 0, y1: 0 });
        expect(viewSectorRange(g, 4_000_000, 2_000_000, 1600, 900, 1000)).toEqual({ x0: 1, x1: 2, y0: 0, y1: 1 });
        // The whole galaxy (and beyond its edges) at f = 10000.
        expect(viewSectorRange(g, 4_000_000, 3_000_000, 1600, 900, 10000)).toEqual({ x0: 0, x1: 3, y0: 0, y1: 2 });
    });

    it('selectSystemLinks: the drawing system in range; a reciprocal link only to a system outside it', () => {
        const mk = (from: number, sx: number, tx: number, reciprocal: boolean): SystemLink => ({ fromSystem: from, toSystem: 9, x0: 0, y0: 0, x1: 0, y1: 0, color: 0, reciprocal, sx, sy: 0, tx, ty: 0 });
        const links = [mk(0, 0, 0, false), mk(1, 0, 3, false), mk(2, 0, 0, true), mk(3, 0, 3, true), mk(4, 3, 0, false), mk(5, 3, 0, true)];
        const sel = selectSystemLinks(links, { x0: 0, x1: 1, y0: 0, y1: 0 });
        expect(sel.map((l) => l.fromSystem)).toEqual([0, 1, 3]);
        // Wider view: system 3's reciprocal end is now in range, and systems 4 / 5 draw themselves.
        expect(selectSystemLinks(links, { x0: 0, x1: 3, y0: 0, y1: 0 }).map((l) => l.fromSystem)).toEqual([0, 1, 4]);
    });
});

describe('dashPieces (XnaDrawingHelper.cs 574-610 DrawLine dashed)', () => {
    const pieces = (len: number, from?: number, to?: number): number[][] => {
        const out: number[] = [];
        dashPieces(len, out, from, to);
        const r: number[][] = [];
        for (let i = 0; i < out.length; i += 3) r.push([out[i], out[i + 1], out[i + 2]]);
        return r;
    };

    it('6 px pieces from the start, the even ones drawn, the last always drawn to the end; nothing under 6 px', () => {
        expect(pieces(5.9)).toEqual([]);
        expect(pieces(6)).toEqual([[0, 6, 1]]);
        expect(pieces(11)).toEqual([[0, 11, 1]]);
        expect(pieces(12)).toEqual([[0, 6, 0], [6, 12, 1]]);
        expect(pieces(30)).toEqual([[0, 6, 0], [12, 18, 0], [24, 30, 1]]);
        expect(pieces(35.5)).toEqual([[0, 6, 0], [12, 18, 0], [24, 35.5, 1]]);
        // n = 6: the last piece (index 5, odd) is drawn too, after the dash at 24.
        expect(pieces(40)).toEqual([[0, 6, 0], [12, 18, 0], [24, 30, 0], [30, 40, 1]]);
    });

    it('culling keeps every piece overlapping the range and nothing far from it', () => {
        const all = pieces(1000);
        for (const [a, b] of [[0, 0], [500, 520], [990, 1000], [37, 38], [0, 1000]]) {
            const cut = pieces(1000, a, b);
            const overlapping = all.filter(([s, e]) => e >= a && s <= b);
            for (const p of overlapping) expect(cut).toContainEqual(p);
            for (const p of cut) expect(all).toContainEqual(p);
            for (const [s, e] of cut) expect(e >= a - 12 && s <= b + 12).toBe(true);
        }
    });

    it('clipSegment: the part of a segment inside a rectangle', () => {
        expect(clipSegment(-10, 5, 10, 5, 0, 0, 10, 10)).toEqual([0.5, 1]);
        expect(clipSegment(2, 2, 8, 8, 0, 0, 10, 10)).toEqual([0, 1]);
        expect(clipSegment(-10, -10, -5, 20, 0, 0, 10, 10)).toBeNull();
        expect(clipSegment(5, -10, 5, 30, 0, 0, 10, 10)).toEqual([0.25, 0.5]);
    });
});

// --- the harness game ---------------------------------------------------------------------------------------------

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 300000);

const key = (l: SystemLink) => `${l.fromSystem}>${l.toSystem}:${l.color}:${l.reciprocal ? 1 : 0}`;

describe('on the age-4 harness game (sim Empire.EvaluateSystemLinks)', () => {
    it('every empire with links draws them in its colour; pirates and independents draw none; nothing is written', () => {
        const game = cachedTickGame(gameData, { age: 4, seconds: 60 });
        const g = game.galaxy;
        const before = JSON.stringify(galaxyToJSON(g));
        const all: SystemLink[] = [];
        collectSystemLinks(g, () => true, all);
        expect(all.length).toBeGreaterThan(0);
        // Real links between two systems (a capital with its own port links to itself: a zero-length, invisible line).
        expect(all.filter((l) => l.fromSystem !== l.toSystem).length).toBeGreaterThan(0);
        // Each line is one of its source system's link / reciprocal entries for an empire present there.
        const byColor = new Map<number, Empire>();
        for (const e of g.empires) if (e !== null) byColor.set(e.mainColor & 0xffffff, e);
        const drawing = new Set<Empire>();
        for (const l of all) {
            const e = byColor.get(l.color)!;
            expect(e).toBeDefined();
            drawing.add(e);
            const sys = g.systems[l.fromSystem];
            expect([sys.dominantEmpire?.empire, ...(sys.otherEmpires ?? []).map((o) => o.empire)]).toContain(e);
            const sv = e.systemVisibility[sys.systemStar.systemIndex];
            const list = l.reciprocal ? sv.reciprocalLinkSystemStars : sv.linkSystemStars;
            expect(list.some((h) => h != null && h.systemIndex === l.toSystem)).toBe(true);
        }
        expect(drawing.size).toBeGreaterThan(1);
        for (const e of drawing) {
            expect(e).not.toBe(g.independentEmpire);
            expect(e.pirateEmpireBaseHabitat).toBeNull();
        }
        // The player's visibility: a subset, both ends explored or seen.
        const vis = g.playerEmpire!.visibility;
        const seen = (i: number) => vis.checkSystemVisibilityStatus(i) >= SystemVisibilityStatus.Explored;
        const known: SystemLink[] = [];
        collectSystemLinks(g, seen, known);
        expect(known.length).toBeGreaterThan(0);
        expect(known.length).toBeLessThanOrEqual(all.length);
        for (const l of known) expect(seen(l.fromSystem) && seen(l.toSystem)).toBe(true);
        const allKeys = new Set(all.map(key));
        for (const l of known) expect(allKeys.has(key(l))).toBe(true);
        expect(JSON.stringify(galaxyToJSON(g))).toBe(before);
    }, 600000);

    it('a sim-worker replica yields the same network, read only', () => {
        const game = cachedTickGame(gameData, { age: 4, seconds: 60 });
        const host = new SimHost(game, new GalaxyTime(), {} as StartGameOptions, { now: () => 0 });
        const client = new SimClientCore(gameData, structuredClone(host.snapshot()), { post: () => undefined, now: () => 0 });
        try {
            const rg = client.galaxy;
            const want: SystemLink[] = [];
            const got: SystemLink[] = [];
            const vis = game.galaxy.playerEmpire!.visibility;
            const rvis = rg.playerEmpire!.visibility;
            const hw = collectSystemLinks(game.galaxy, (i) => vis.checkSystemVisibilityStatus(i) >= SystemVisibilityStatus.Explored, want);
            const before = JSON.stringify(galaxyToJSON(rg));
            const hr = collectSystemLinks(rg, (i) => rvis.checkSystemVisibilityStatus(i) >= SystemVisibilityStatus.Explored, got);
            expect(want.length).toBeGreaterThan(0);
            expect(got.map(key)).toEqual(want.map(key));
            expect(hr).toBe(hw);
            expect(JSON.stringify(galaxyToJSON(rg))).toBe(before);
        } finally {
            client.dispose();
            host.dispose();
        }
    }, 300000);
});
