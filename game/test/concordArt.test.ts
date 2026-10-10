// Scenario 19a Concord art (render/concordArt.ts, concordFleet.ts, concordHull.ts): the biomech insect fleet drawn
// procedurally on the biomech canvas (deterministic sources placed per bucket, scarred / pristine looks), sizes,
// thruster marks at the engine pods, bioluminescent lights, the seam-glow overlay, brightness held dark but readable
// under the Ackdarian reference frames, the portrait / flag, the display gate (Concord's empire only; off with the
// `concordArt` flag or without the rim trader) and the manifest switches.
import { describe, expect, it } from 'vitest';
import { decodePng, dwuAssetPath } from './helpers/pngDecode';
import { loadScenarioOverlayFs } from './helpers/scenarioGame';
import {
    ACKDARIAN_REFERENCE,
    CONCORD_FLAG_H,
    CONCORD_FLAG_W,
    CONCORD_KINDS,
    CONCORD_LOOKS,
    CONCORD_PORTRAIT_SIZE,
    CONCORD_HULL_AREA_RATIO,
    CONCORD_HULL_FILL,
    CONCORD_TARGET_L,
    composeConcordHullImages,
    concordHullSource,
    concordHullSourceSide,
    concordImages,
    concordSourceOf,
    isConcordBase,
    isConcordMilitary,
    buildConcordShipArt,
    concordArtEmpire,
    concordArtEnabled,
    concordArtLook,
    concordArtStats,
    CONCORD_LIGHT_GROUPS,
    ACKDARIAN_PORTRAIT_STDL,
    concordKindOf,
    concordLightAlpha,
    concordLookOf,
    concordSizeBucket,
    concordSpec,
    concordTextureSide,
    concordTreasureShips,
    concordVariantFor,
    generateConcordFlag,
    generateConcordPortrait,
    imageHash,
    raceHasConcordArt,
    type ConcordImages,
    type RgbaImage,
} from '../src/render/concordArt';
import { drawConcordHull } from '../src/render/concordFleet';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';

function build(kind: (typeof CONCORD_KINDS)[number], bucket: number, look: (typeof CONCORD_LOOKS)[number]): ConcordImages {
    return concordImages(kind, bucket, look);
}

const cache = new Map<string, ConcordImages>();
function images(kind: (typeof CONCORD_KINDS)[number], bucket: number, look: (typeof CONCORD_LOOKS)[number]): ConcordImages {
    const key = `${look}:${kind}:${bucket}`;
    let im = cache.get(key);
    if (im === undefined) {
        im = build(kind, bucket, look);
        cache.set(key, im);
    }
    return im;
}

function opaqueBox(img: RgbaImage, minAlpha = 1): { x0: number; y0: number; x1: number; y1: number } {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < img.h; y++) {
        for (let x = 0; x < img.w; x++) {
            if (img.data[(y * img.w + x) * 4 + 3] < minAlpha) continue;
            x0 = Math.min(x0, x);
            y0 = Math.min(y0, y);
            x1 = Math.max(x1, x);
            y1 = Math.max(y1, y);
        }
    }
    return { x0, y0, x1, y1 };
}

describe('Concord ship images', { timeout: 300000 }, () => {
    it('are deterministic and differ by finish', () => {
        for (const kind of ['destroyer', 'freighter'] as const) {
            const a = build(kind, 2, 'weathered');
            const b = build(kind, 2, 'weathered');
            expect(imageHash(a.ship)).toBe(imageHash(b.ship));
            for (const g of CONCORD_LIGHT_GROUPS) expect(imageHash(a.halos[g])).toBe(imageHash(b.halos[g]));
            expect(imageHash(images(kind, 2, 'clean').ship), kind).not.toBe(imageHash(a.ship));
        }
        expect(imageHash(generateConcordPortrait())).toBe(imageHash(generateConcordPortrait()));
        expect(imageHash(generateConcordFlag())).toBe(imageHash(generateConcordFlag()));
    });

    it('have the variant sizes, content inside the texture, thruster marks at the nozzles and no stock light marks', () => {
        for (const look of CONCORD_LOOKS) {
            for (const kind of CONCORD_KINDS) {
                for (const bucket of [0, 5]) {
                    const im = images(kind, bucket, look);
                    const side = concordTextureSide(kind, bucket);
                    expect(im.ship.w).toBe(side);
                    expect(im.ship.h).toBe(side);
                    for (const g of CONCORD_LIGHT_GROUPS) expect(im.halos[g].data.length).toBe(side * side * 4);
                    const box = opaqueBox(im.ship);
                    expect(box.x0, `${look} ${kind} ${bucket}`).toBeGreaterThan(0);
                    expect(box.y0).toBeGreaterThan(0);
                    expect(box.x1).toBeLessThan(side - 1);
                    expect(box.y1).toBeLessThan(side - 1);
                    const art = buildConcordShipArt(im);
                    expect(art).not.toBeNull();
                    expect(art!.markers.lights.length).toBe(0);
                    expect(art!.markers.thrusters.length, `${look} ${kind} ${bucket}`).toBe(isConcordBase(kind) ? 0 : concordSpec(kind, bucket).engines);
                    for (const p of im.markerPixels) expect(art!.rgba[p * 4 + 2] === 255 && art!.rgba[p * 4] === 0).toBe(false);
                    // The marks sit in the aft half (at the engine pods' nozzles).
                    for (const t of art!.markers.thrusters) expect(t.left, kind).toBeLessThan(art!.markers.side / 2);
                    // Every light sits on the ship (inside its opaque silhouette).
                    for (const l of im.lights) expect(im.ship.data[(Math.floor(l.y) * side + Math.floor(l.x)) * 4 + 3], `${kind} ${l.kind}`).toBeGreaterThan(0);
                }
            }
        }
    });

    it('carry bioluminescent positional lights at the extremities: pink to port, violet to starboard, stern / masthead, strobes', () => {
        for (const kind of CONCORD_KINDS) {
            const im = images(kind, 5, 'weathered');
            const S = im.ship.w;
            const port = im.lights.filter((l) => l.kind === 'port');
            const star = im.lights.filter((l) => l.kind === 'starboard');
            expect(port.length, kind).toBe(1);
            expect(star.length).toBe(1);
            // Port is −x (raw art faces up), starboard +x, at the outer edge.
            for (const l of port) expect(l.x).toBeLessThan(S / 2);
            for (const l of star) expect(l.x).toBeGreaterThan(S / 2);
            const whites = im.lights.filter((l) => l.kind === 'white');
            expect(Math.max(...whites.map((l) => l.y))).toBeGreaterThan(S * 0.8); // the stern light
            for (const l of im.lights) expect(l.r).toBeLessThan(S * 0.006);
            expect(im.lights.filter((l) => l.kind === 'strobe').length, kind).toBe(isConcordMilitary(kind) ? 2 : 0);
            expect(im.lights.filter((l) => l.kind === 'engine').length, kind).toBe(concordSpec(kind, 5).engines);
            // Pink port, violet starboard (red-blue, no green).
            const c = (p: number): number[] => Array.from(im.ship.data.slice(p * 4, p * 4 + 3));
            const [pr, pg] = c(Math.floor(port[0].y) * S + Math.floor(port[0].x));
            const [sr, sg, sb] = c(Math.floor(star[0].y) * S + Math.floor(star[0].x));
            expect(pr).toBeGreaterThan(pg * 2);
            expect(sb).toBeGreaterThan(sr);
            expect(sb).toBeGreaterThan(sg * 1.5);
        }
        // The builders' lamps (antenna tips, docking clamps) are lights too.
        expect(images('frigate', 5, 'weathered').lights.filter((l) => l.kind === 'lamp').length).toBeGreaterThanOrEqual(2);
        expect(images('port', 5, 'weathered').lights.filter((l) => l.kind === 'lamp').length).toBeGreaterThanOrEqual(6);
    });

    it('glow at the seams: a pink-violet seam overlay on every kind', () => {
        for (const kind of CONCORD_KINDS) {
            const g = images(kind, 3, 'clean').halos.pulse;
            let lit = 0;
            let r = 0;
            let gr = 0;
            let b = 0;
            for (let p = 0; p < g.w * g.h; p++) {
                if (g.data[p * 4 + 3] < 40) continue;
                lit++;
                r += g.data[p * 4];
                gr += g.data[p * 4 + 1];
                b += g.data[p * 4 + 2];
            }
            expect(lit, kind).toBeGreaterThan(g.w * g.h * 0.004);
            expect(r, kind).toBeGreaterThan(gr * 1.5);
            expect(b, kind).toBeGreaterThan(gr * 1.5);
        }
    });

    it('scale fittings with size', () => {
        expect(concordSpec('frigate', 3).engines).toBe(2);
        expect(concordSpec('battleship', 3).engines).toBe(4);
        expect(concordSpec('carrier', 3).engines).toBe(4);
        expect(concordSpec('treasure', 3).engines).toBe(4);
        expect(concordSpec('battleship', 3, 'clean').weathering).toBeLessThan(concordSpec('battleship', 3).weathering);
        expect(concordSpec('freighter', 3).weathering).toBeLessThan(concordSpec('battleship', 3).weathering);
        expect(concordSpec('battleship', 3).weathering).toBeLessThan(concordSpec('port', 3).weathering);
        expect(concordSpec('port', 3).side).toBeGreaterThan(concordSpec('base', 3).side);
        // The treasure ship draws bigger than its hull size alone gives.
        const t = buildConcordShipArt(images('treasure', 5, 'weathered'))!;
        const f = buildConcordShipArt(images('freighter', 5, 'weathered'))!;
        expect(t.metrics.areaRatio).toBeGreaterThan(f.metrics.areaRatio * 1.8);
    });

    it('stay dark but readable: under the Ackdarian frames\' brightness, bright highlights, violet / magenta hue', () => {
        for (const look of CONCORD_LOOKS) {
            for (const kind of CONCORD_KINDS) {
                for (const bucket of [0, 5]) {
                    const im = images(kind, bucket, look);
                    const mk = new Set(im.markerPixels);
                    const lp = new Set(im.lightPixels);
                    const s = concordArtStats(im.ship.data, im.ship.w, im.ship.h, (p) => mk.has(p) || lp.has(p));
                    const tag = `${look} ${kind} ${bucket}`;
                    expect(s.meanL, tag).toBeGreaterThan(CONCORD_TARGET_L * 0.75);
                    expect(s.meanL, tag).toBeLessThan(ACKDARIAN_REFERENCE.base.meanL * 0.8);
                    expect(s.p95L, tag).toBeGreaterThan(0.22);
                    expect(s.p5L, tag).toBeLessThan(0.06);
                    expect(s.hueDeg, tag).toBeGreaterThan(255);
                    expect(s.hueDeg, tag).toBeLessThan(335);
                }
            }
        }
    });

    it.skipIf(dwuAssetPath('images/units/ships/family7/cruiser.png') === null)('reference constants re-measure on the install frames', () => {
        for (const kind of Object.keys(ACKDARIAN_REFERENCE) as (keyof typeof ACKDARIAN_REFERENCE)[]) {
            const ref = ACKDARIAN_REFERENCE[kind];
            const png = decodePng(dwuAssetPath(`images/units/ships/${ref.file}`)!);
            const s = concordArtStats(png.data, png.width, png.height);
            expect(Math.abs(s.meanL - ref.meanL), kind).toBeLessThan(0.001);
            expect(Math.abs(s.stdL - ref.stdL), kind).toBeLessThan(0.001);
            expect(Math.abs(s.meanSat - ref.meanSat), kind).toBeLessThan(0.001);
            expect(Math.abs(s.p5L - ref.p5L), kind).toBeLessThan(0.001);
            expect(Math.abs(s.p95L - ref.p95L), kind).toBeLessThan(0.001);
        }
    });

    it('fill the texture at the kind\'s fill, centred, hard alpha edge, scarring only in the scarred look', () => {
        for (const kind of CONCORD_KINDS) {
            for (const bucket of [0, 3, 5]) {
                const im = images(kind, bucket, 'clean');
                const S = im.ship.w;
                const box = opaqueBox(im.ship, 1);
                const extent = Math.max(box.x1 - box.x0 + 1, box.y1 - box.y0 + 1);
                expect(Math.abs(extent / S - CONCORD_HULL_FILL[kind]), `${kind} ${bucket}`).toBeLessThan(0.03);
                expect(Math.abs((box.x0 + box.x1) / 2 - S / 2)).toBeLessThan(S * 0.03);
                expect(Math.abs((box.y0 + box.y1) / 2 - S / 2)).toBeLessThan(S * 0.03);
                for (let p = 0; p < S * S; p++) {
                    const a = im.ship.data[p * 4 + 3];
                    if (a !== 0 && a !== 255) throw new Error(`${kind} ${bucket}: partial alpha ${a} at ${p}`);
                }
            }
            // The drawn extent of the earlier art is kept (the area ratio sets the drawn size).
            expect(buildConcordShipArt(images(kind, 3, 'clean'))!.metrics.areaRatio).toBe(CONCORD_HULL_AREA_RATIO[kind]);
            // Scarring marks some pixels but never moves the silhouette.
            const w = images(kind, 3, 'weathered').ship;
            const c = images(kind, 3, 'clean').ship;
            let changed = 0;
            for (let p = 0; p < w.w * w.h; p++) {
                expect(w.data[p * 4 + 3]).toBe(c.data[p * 4 + 3]);
                if (w.data[p * 4] !== c.data[p * 4] || w.data[p * 4 + 1] !== c.data[p * 4 + 1]) changed++;
            }
            expect(changed, kind).toBeGreaterThan(20);
        }
    });

    it('sources: twice the largest texture side, symmetric about the vertical axis, deterministic', () => {
        for (const kind of CONCORD_KINDS) {
            const src = concordHullSource(kind);
            const n = concordHullSourceSide(kind);
            expect(n).toBe(2 * concordTextureSide(kind, 5));
            expect(src.img.w).toBe(n);
            expect(src.img.h).toBe(n);
            expect(src.glow.w).toBe(n);
            expect(concordHullSource(kind)).toBe(src); // cached
            expect(src.nozzles.length, kind).toBe(concordSpec(kind, 0).engines);
            let opaque = 0;
            let asym = 0;
            for (let y = 0; y < n; y++) {
                for (let x = 0; x < n / 2; x++) {
                    const a = src.img.data[(y * n + x) * 4 + 3] > 0;
                    const b = src.img.data[(y * n + (n - 1 - x)) * 4 + 3] > 0;
                    if (a) opaque++;
                    if (a !== b) asym++;
                }
            }
            expect(asym / opaque, kind).toBeLessThan(0.002);
        }
        // Drawn afresh, a kind comes out byte-identical (own seeded hash / RNG, no Math.random).
        const again = composeConcordHullImages('frigate', 2, 'weathered', concordSourceOf(drawConcordHull('frigate', concordHullSourceSide('frigate'))));
        expect(imageHash(again.ship)).toBe(imageHash(images('frigate', 2, 'weathered').ship));
    });

    it('are not flat: lit volumes and organic detail give a luminance spread inside the body', () => {
        for (const kind of CONCORD_KINDS) {
            for (const bucket of [0, 5]) {
                const im = images(kind, bucket, 'clean');
                const mk = new Set(im.markerPixels);
                const lp = new Set(im.lightPixels);
                const st = concordArtStats(im.ship.data, im.ship.w, im.ship.h, (p) => mk.has(p) || lp.has(p));
                expect(st.stdL, `${kind} ${bucket}`).toBeGreaterThan(0.07);
                const { w, data } = im.ship;
                const L = (p: number): number => (0.2126 * data[p * 4] + 0.7152 * data[p * 4 + 1] + 0.0722 * data[p * 4 + 2]) / 255;
                let sum = 0;
                let cnt = 0;
                for (let p = 0; p < w * w - 1; p++) {
                    if (p % w === w - 1 || data[p * 4 + 3] === 0 || data[(p + 1) * 4 + 3] === 0) continue;
                    sum += Math.abs(L(p) - L(p + 1));
                    cnt++;
                }
                expect(sum / cnt, `${kind} ${bucket} local`).toBeGreaterThan(0.02);
            }
        }
    });

    it('every kind is drawn in code: no file loads', () => {
        const concord = { empireId: 5 } as unknown as Empire;
        expect(concordVariantFor({ empire: concord, subRole: BuiltObjectSubRole.Escort, size: 100 }, concord, new Set())?.kind).toBe('frigate');
        expect(concordVariantFor({ empire: concord, subRole: BuiltObjectSubRole.SmallFreighter, size: 100 }, concord, new Set())?.kind).toBe('freighter');
        expect(isConcordBase('port')).toBe(true);
        expect(isConcordBase('base')).toBe(true);
        expect(isConcordBase('carrier')).toBe(false);
    });

    it('portrait and flag at the original portrait / flag sizes: violet-black field, pink border and seams', () => {
        const p = generateConcordPortrait();
        expect(p.w).toBe(CONCORD_PORTRAIT_SIZE);
        expect(p.h).toBe(CONCORD_PORTRAIT_SIZE);
        const f = generateConcordFlag();
        expect(f.w).toBe(CONCORD_FLAG_W);
        expect(f.h).toBe(CONCORD_FLAG_H);
        for (const img of [p, f]) expect(concordArtStats(img.data, img.w, img.h).pixels).toBe(img.w * img.h);
        // At least the Ackdarian portrait's contrast (race_7.png: luma std 0.243).
        expect(concordArtStats(p.data, p.w, p.h).stdL).toBeGreaterThanOrEqual(ACKDARIAN_PORTRAIT_STDL);
        const px = (img: RgbaImage, x: number, y: number): number[] => Array.from(img.data.slice((y * img.w + x) * 4, (y * img.w + x) * 4 + 3));
        // Flag field: dark violet; border: deep pink; the emblem's glowing suture down the middle.
        const [r, g, b] = px(f, 12, 12);
        expect(b).toBeGreaterThan(g * 2);
        expect(r).toBeGreaterThan(g * 2);
        expect(Math.max(r, g, b)).toBeLessThan(110);
        const [br, bg] = px(f, 2, Math.floor(f.h / 2));
        expect(br).toBeGreaterThan(bg * 2.5);
        const [cr, cg] = px(f, Math.floor(f.w / 2), Math.floor(f.h * 0.6));
        expect(cr).toBeGreaterThan(cg * 1.5);
        // The portrait leans violet / magenta overall (red and blue over green).
        const s = concordArtStats(p.data, p.w, p.h);
        expect(s.hueDeg).toBeGreaterThan(260);
        expect(s.hueDeg).toBeLessThan(340);
    });
});

describe('Concord art display gate', () => {
    function fakeGalaxy(flags: Record<string, boolean>, params: Record<string, number> = {}): { galaxy: Galaxy; concord: Empire; other: Empire } {
        const concord = { empireId: 5, active: true, dominantRace: { name: 'Oranthi' } } as unknown as Empire;
        const other = { empireId: 6, active: true, dominantRace: { name: 'Ackdarian' } } as unknown as Empire;
        const galaxy = {
            scenario: { flags, params, state: { rimTrade: { empireId: 5 }, rimTreasure: { treasure: [] as unknown[] } } },
            empires: [other, concord],
        } as unknown as Galaxy;
        return { galaxy, concord, other };
    }

    it('overrides only the Concord empire’s objects', () => {
        const { galaxy, concord, other } = fakeGalaxy({ rimTrader: true, concordArt: true });
        const empire = concordArtEmpire(galaxy);
        expect(empire).toBe(concord);
        const treasureShip = { empire: concord, subRole: BuiltObjectSubRole.LargeFreighter, size: 1100 };
        (galaxy.scenario!.state['rimTreasure'] as { treasure: unknown[] }).treasure.push(treasureShip);
        const treasure = concordTreasureShips(galaxy);
        expect(concordVariantFor({ empire: other, subRole: BuiltObjectSubRole.Cruiser, size: 600 }, empire, treasure)).toBeNull();
        expect(concordVariantFor({ empire: null, subRole: BuiltObjectSubRole.SmallFreighter, size: 200 }, empire, treasure)).toBeNull();
        expect(concordVariantFor({ empire: concord, subRole: BuiltObjectSubRole.Cruiser, size: 600 }, empire, treasure)).toEqual({ kind: 'battleship', bucket: 3, look: 'weathered' });
        expect(concordVariantFor(treasureShip, empire, treasure)).toEqual({ kind: 'treasure', bucket: 4, look: 'weathered' });
        expect(concordVariantFor({ empire: concord, subRole: BuiltObjectSubRole.LargeFreighter, size: 1100 }, empire, treasure)?.kind).toBe('freighter');
        expect(raceHasConcordArt(galaxy, 'Oranthi')).toBe(true);
        expect(raceHasConcordArt(galaxy, 'Ackdarian')).toBe(false);
    });

    it('is a no-op with the concordArt flag off, the rim trader off, or no scenario', () => {
        for (const flags of [{ rimTrader: true, concordArt: false }, { rimTrader: false, concordArt: true }]) {
            const { galaxy, concord } = fakeGalaxy(flags);
            expect(concordArtEnabled(galaxy)).toBe(false);
            const e = concordArtEmpire(galaxy);
            expect(e).toBeNull();
            expect(concordVariantFor({ empire: concord, subRole: BuiltObjectSubRole.Cruiser, size: 600 }, e, new Set())).toBeNull();
            expect(raceHasConcordArt(galaxy, 'Oranthi')).toBe(false);
        }
        const none = { scenario: null, empires: [] } as unknown as Galaxy;
        expect(concordArtEmpire(none)).toBeNull();
        expect(raceHasConcordArt(none, 'Oranthi')).toBe(false);
        // A save from before the flag existed: on.
        expect(concordArtEnabled(fakeGalaxy({ rimTrader: true }).galaxy)).toBe(true);
    });

    it('reads the finish param (default weathered)', () => {
        expect(concordArtLook(fakeGalaxy({ rimTrader: true }).galaxy)).toBe('weathered');
        expect(concordArtLook(fakeGalaxy({ rimTrader: true }, { concordArtLook: 1 }).galaxy)).toBe('clean');
        expect(concordLookOf(9)).toBe('clean');
        expect(concordLookOf(-3)).toBe('weathered');
    });

    it('the manifest declares the flag (default on) and the look param (default 0)', () => {
        const m = loadScenarioOverlayFs('rimTrade').manifest;
        expect(m.flags.find((f) => f.name === 'concordArt')?.default).toBe(true);
        const p = m.params.find((x) => x.name === 'concordArtLook');
        expect(p?.default).toBe(0);
        expect(p?.max).toBe(1);
    });

    it('maps sub-roles to kinds and sizes to buckets', () => {
        expect(concordKindOf(BuiltObjectSubRole.Escort, false)).toBe('frigate');
        expect(concordKindOf(BuiltObjectSubRole.Frigate, false)).toBe('destroyer');
        expect(concordKindOf(BuiltObjectSubRole.Destroyer, false)).toBe('destroyer');
        expect(concordKindOf(BuiltObjectSubRole.Cruiser, false)).toBe('battleship');
        expect(concordKindOf(BuiltObjectSubRole.CapitalShip, false)).toBe('battleship');
        expect(concordKindOf(BuiltObjectSubRole.Carrier, false)).toBe('carrier');
        expect(concordKindOf(BuiltObjectSubRole.MediumFreighter, false)).toBe('freighter');
        expect(concordKindOf(BuiltObjectSubRole.ExplorationShip, false)).toBe('explorer');
        expect(concordKindOf(BuiltObjectSubRole.ConstructionShip, false)).toBe('construction');
        expect(concordKindOf(BuiltObjectSubRole.LargeSpacePort, false)).toBe('port');
        expect(concordKindOf(BuiltObjectSubRole.MiningStation, false)).toBe('base');
        expect(concordKindOf(BuiltObjectSubRole.Cruiser, true)).toBe('treasure');
        expect([100, 150, 299, 300, 500, 800, 1200, 5000].map(concordSizeBucket)).toEqual([0, 1, 1, 2, 3, 4, 5, 5]);
    });

    it('light blink groups: steady, breathing seam glow, slow pink / violet pulse, strobe double flash on the nav-light cycle', () => {
        const strobeOn: number[] = [];
        let pMin = 1;
        let pMax = 0;
        for (let t = 0; t < 5; t += 0.01) {
            expect(concordLightAlpha('steady', t, 3)).toBe(0.5);
            const f = concordLightAlpha('pulse', t, 3);
            expect(f).toBeGreaterThanOrEqual(0.25);
            expect(f).toBeLessThanOrEqual(0.75);
            pMin = Math.min(pMin, f);
            pMax = Math.max(pMax, f);
            const n = concordLightAlpha('nav', t, 3);
            expect(n).toBeGreaterThanOrEqual(0.45);
            expect(n).toBeLessThanOrEqual(0.7);
            if (concordLightAlpha('strobe', t, 3) > 0) strobeOn.push(t);
        }
        // Two short (0.07 s) flashes per 2.5 s cycle: about 5.6 % of the time lit, in 4 separate bursts over 5 s.
        expect(strobeOn.length).toBeGreaterThan(20);
        expect(strobeOn.length).toBeLessThan(40);
        let bursts = 1;
        for (let k = 1; k < strobeOn.length; k++) if (strobeOn[k] - strobeOn[k - 1] > 0.05) bursts++;
        expect(bursts).toBe(4);
        // The seam glow breathes through most of its range within the 5 s, with its own phase per ship.
        expect(pMax - pMin).toBeGreaterThan(0.4);
        expect(concordLightAlpha('pulse', 1, 3)).not.toBe(concordLightAlpha('pulse', 1, 4));
        // Phase offset per ship (the ambient pattern: id % 20 / 10 s).
        expect(concordLightAlpha('strobe', 0.03, 0)).toBeGreaterThan(0);
        expect(concordLightAlpha('strobe', 0.03, 5)).toBe(0);
    });
});
