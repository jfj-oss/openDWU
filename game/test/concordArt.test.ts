// Scenario 19a Concord art (render/concordArt.ts): the painted-sprite ships / port (public/art/concord cut-outs placed,
// weathered and lit), deterministic procedural freighter / treasure ship / base / portrait / flag images, sizes, luma
// statistics matched to the Ackdarian reference frames, the display gate (Concord's empire only; off with the
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
    CONCORD_HULL_KINDS,
    composeConcordHullImages,
    concordHullSource,
    concordHullSourceSide,
    concordImages,
    isConcordHullKind,
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
            for (let k = 0; k < a.parts.length; k++) expect(imageHash(a.parts[k].img)).toBe(imageHash(b.parts[k].img));
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
                    const base = kind === 'port' || kind === 'base';
                    expect(art!.markers.thrusters.length).toBe(base ? 0 : concordSpec(kind, bucket).engines);
                    for (const p of im.markerPixels) expect(art!.rgba[p * 4 + 2] === 255 && art!.rgba[p * 4] === 0).toBe(false);
                    // Every light sits on the ship (inside its opaque silhouette).
                    for (const l of im.lights) expect(im.ship.data[(Math.floor(l.y) * side + Math.floor(l.x)) * 4 + 3], `${kind} ${l.kind}`).toBeGreaterThan(0);
                }
            }
        }
    });

    it('carry positional lights at the extremities: red to port, green to starboard, white stern / masthead, strobes', () => {
        for (const kind of ['frigate', 'destroyer', 'battleship', 'freighter', 'explorer', 'construction', 'treasure', 'port', 'base'] as const) {
            const im = images(kind, 5, 'weathered');
            const S = im.ship.w;
            const port = im.lights.filter((l) => l.kind === 'port');
            const star = im.lights.filter((l) => l.kind === 'starboard');
            expect(port.length, kind).toBeGreaterThan(0);
            expect(star.length).toBe(port.length);
            // Port is −x (raw art faces up), starboard +x, at the outer edge of the hull.
            for (const l of port) expect(l.x).toBeLessThan(S / 2);
            for (const l of star) expect(l.x).toBeGreaterThan(S / 2);
            const whites = im.lights.filter((l) => l.kind === 'white');
            expect(Math.max(...whites.map((l) => l.y))).toBeGreaterThan(S * 0.8); // the stern light
            for (const l of im.lights) if (l.kind !== 'flood') expect(l.r).toBeLessThan(S * 0.006);
        }
        expect(images('treasure', 5, 'weathered').lights.filter((l) => l.kind === 'strobe').length).toBe(4);
        for (const k of ['frigate', 'destroyer', 'battleship'] as const) {
            expect(images(k, 5, 'weathered').lights.filter((l) => l.kind === 'strobe').length).toBe(2);
        }
        // The shaded hulls carry no animated parts.
        for (const k of CONCORD_HULL_KINDS) expect(images(k, 5, 'weathered').parts).toEqual([]);
        // One red and one green sidelight per ship, at the outermost points; a blue-white glow at every nozzle.
        for (const k of ['frigate', 'destroyer', 'battleship', 'freighter', 'explorer', 'construction', 'treasure'] as const) {
            const im = images(k, 5, 'weathered');
            expect(im.lights.filter((l) => l.kind === 'port').length, k).toBe(1);
            expect(im.lights.filter((l) => l.kind === 'engine').length, k).toBe(concordSpec(k, 5).engines);
        }
        // Animated parts: the treasure ship's four fan faces, the freighter's two.
        expect(images('treasure', 5, 'weathered').parts.map((p) => p.kind)).toEqual(['fan', 'fan', 'fan', 'fan']);
        expect(images('freighter', 5, 'weathered').parts.map((p) => p.kind)).toEqual(['fan', 'fan']);
    });

    it('scale fittings with size', () => {
        expect(concordSpec('frigate', 3).engines).toBe(2);
        expect(concordSpec('battleship', 3).engines).toBe(4);
        expect(concordSpec('freighter', 0).containerColumns).toBeLessThan(concordSpec('freighter', 5).containerColumns);
        expect(concordSpec('freighter', 5).containerColumns).toBeLessThan(concordSpec('treasure', 5).containerColumns);
        expect(concordSpec('treasure', 5).gantries).toBeGreaterThanOrEqual(4);
        expect(concordSpec('treasure', 5).pods).toBe(4);
        expect(concordSpec('treasure', 0).containerColumns).toBeLessThan(concordSpec('treasure', 5).containerColumns);
        expect(concordSpec('base', 0).docks).toBeLessThan(concordSpec('base', 5).docks);
        expect(concordSpec('battleship', 3, 'clean').weathering).toBeLessThan(concordSpec('battleship', 3).weathering);
        expect(concordSpec('freighter', 3).weathering).toBeLessThan(concordSpec('battleship', 3).weathering);
        expect(concordSpec('battleship', 3).weathering).toBeLessThan(concordSpec('port', 3).weathering);
        expect(concordSpec('port', 3).side).toBeGreaterThan(concordSpec('base', 3).side);
        // The treasure ship draws bigger than its hull size alone gives.
        const t = buildConcordShipArt(images('treasure', 5, 'weathered'))!;
        const f = buildConcordShipArt(images('freighter', 5, 'weathered'))!;
        expect(t.metrics.areaRatio).toBeGreaterThan(f.metrics.areaRatio * 1.8);
    });

    it('match the Ackdarian reference luma, 5–95 % band and saturation range', () => {
        let n = 0;
        for (const look of CONCORD_LOOKS) {
            for (const kind of Object.keys(ACKDARIAN_REFERENCE) as (keyof typeof ACKDARIAN_REFERENCE)[]) {
                for (const bucket of [0, 5]) {
                    const im = images(kind, bucket, look);
                    const mk = new Set(im.markerPixels);
                    const s = concordArtStats(im.ship.data, im.ship.w, im.ship.h, (p) => mk.has(p));
                    const ref = ACKDARIAN_REFERENCE[kind];
                    expect(Math.abs(s.meanL - ref.meanL), `${look} ${kind} ${bucket} mean`).toBeLessThan(0.005);
                    expect(Math.abs(s.stdL - ref.stdL), `${look} ${kind} ${bucket} std`).toBeLessThan(0.005);
                    expect(Math.abs(s.p5L - ref.q[3]), `${look} ${kind} ${bucket} p5`).toBeLessThan(0.02);
                    expect(Math.abs(s.p95L - ref.q[21]), `${look} ${kind} ${bucket} p95`).toBeLessThan(0.02);
                    expect(s.meanSat, `${look} ${kind} ${bucket} sat`).toBeGreaterThan(0.17);
                    expect(s.meanSat, `${look} ${kind} ${bucket} sat`).toBeLessThan(0.3);
                    n++;
                }
            }
        }
        expect(n).toBe(12);
    });

    it.skipIf(dwuAssetPath('images/units/ships/family7/cruiser.png') === null)('reference constants re-measure on the install frames', () => {
        for (const kind of Object.keys(ACKDARIAN_REFERENCE) as (keyof typeof ACKDARIAN_REFERENCE)[]) {
            const ref = ACKDARIAN_REFERENCE[kind];
            const png = decodePng(dwuAssetPath(`images/units/ships/${ref.file}`)!);
            const s = concordArtStats(png.data, png.width, png.height);
            expect(Math.abs(s.meanL - ref.meanL), kind).toBeLessThan(0.001);
            expect(Math.abs(s.stdL - ref.stdL), kind).toBeLessThan(0.001);
            expect(Math.abs(s.meanSat - ref.meanSat), kind).toBeLessThan(0.001);
            expect(Math.abs(s.p5L - ref.q[3]), kind).toBeLessThan(0.001);
            expect(Math.abs(s.p95L - ref.q[21]), kind).toBeLessThan(0.001);
        }
    });

    it('shaded hulls fill the texture like the earlier hulls did, hard alpha edge, weathering only in the weathered look', () => {
        for (const kind of CONCORD_HULL_KINDS) {
            for (const bucket of [0, 3, 5]) {
                const im = images(kind, bucket, 'clean');
                const S = im.ship.w;
                const box = opaqueBox(im.ship, 1);
                const extent = Math.max(box.x1 - box.x0 + 1, box.y1 - box.y0 + 1);
                expect(Math.abs(extent / S - CONCORD_HULL_FILL[kind]), `${kind} ${bucket}`).toBeLessThan(0.03);
                // Centred.
                expect(Math.abs((box.x0 + box.x1) / 2 - S / 2)).toBeLessThan(S * 0.03);
                expect(Math.abs((box.y0 + box.y1) / 2 - S / 2)).toBeLessThan(S * 0.03);
                // Hard alpha edge: every pixel is fully opaque or fully clear (the fittings find a clean outline).
                for (let p = 0; p < S * S; p++) {
                    const a = im.ship.data[p * 4 + 3];
                    if (a !== 0 && a !== 255) throw new Error(`${kind} ${bucket}: partial alpha ${a} at ${p}`);
                }
            }
            // The drawn extent of the earlier hull is kept (the area ratio sets the drawn size).
            expect(buildConcordShipArt(images(kind, 3, 'clean'))!.metrics.areaRatio).toBe(CONCORD_HULL_AREA_RATIO[kind]);
            // Weathering darkens / rusts some hull pixels but never moves the silhouette.
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

    it('shaded hull sources: twice the largest texture side, symmetric about the vertical axis, deterministic', () => {
        for (const kind of CONCORD_HULL_KINDS) {
            const src = concordHullSource(kind);
            const n = concordHullSourceSide(kind);
            expect(n).toBe(2 * concordTextureSide(kind, 5));
            expect(src.w).toBe(n);
            expect(src.h).toBe(n);
            expect(concordHullSource(kind)).toBe(src); // cached
            // Mirror-symmetric silhouette (pixel for pixel, but for a few rounding flips on curved edges).
            let opaque = 0;
            let asym = 0;
            for (let y = 0; y < n; y++) {
                for (let x = 0; x < n / 2; x++) {
                    const a = src.data[(y * n + x) * 4 + 3] > 0;
                    const b = src.data[(y * n + (n - 1 - x)) * 4 + 3] > 0;
                    if (a) opaque++;
                    if (a !== b) asym++;
                }
            }
            expect(asym / opaque, kind).toBeLessThan(0.002);
        }
        // Drawn afresh, a kind comes out byte-identical (own seeded hash / RNG, no Math.random).
        const again = composeConcordHullImages('frigate', 2, 'weathered', drawConcordHull('frigate', concordHullSourceSide('frigate')));
        expect(imageHash(again.ship)).toBe(imageHash(images('frigate', 2, 'weathered').ship));
    });

    it('shaded hulls are not flat: lit volumes and detail give a wide luminance spread inside the hull', () => {
        for (const kind of CONCORD_HULL_KINDS) {
            for (const bucket of [0, 5]) {
                const im = images(kind, bucket, 'clean');
                const mk = new Set(im.markerPixels);
                const lp = new Set(im.lightPixels);
                const st = concordArtStats(im.ship.data, im.ship.w, im.ship.h, (p) => mk.has(p) || lp.has(p));
                // Luma spread of the whole hull (a flat fill with outlines and a few lamps sits far under this).
                expect(st.stdL, `${kind} ${bucket}`).toBeGreaterThan(0.09);
                // Local contrast too: mean absolute luma step between neighbouring hull pixels.
                const { w, data } = im.ship;
                const L = (p: number): number => (0.2126 * data[p * 4] + 0.7152 * data[p * 4 + 1] + 0.0722 * data[p * 4 + 2]) / 255;
                let sum = 0;
                let cnt = 0;
                for (let p = 0; p < w * w - 1; p++) {
                    if (p % w === w - 1 || data[p * 4 + 3] === 0 || data[(p + 1) * 4 + 3] === 0) continue;
                    sum += Math.abs(L(p) - L(p + 1));
                    cnt++;
                }
                expect(sum / cnt, `${kind} ${bucket} local`).toBeGreaterThan(0.03);
            }
        }
    });

    it('every kind is drawn in code: no file loads, so no stock fallback for the shaded hulls', () => {
        const concord = { empireId: 5 } as unknown as Empire;
        expect(concordVariantFor({ empire: concord, subRole: BuiltObjectSubRole.Escort, size: 100 }, concord, new Set())?.kind).toBe('frigate');
        expect(concordVariantFor({ empire: concord, subRole: BuiltObjectSubRole.SmallFreighter, size: 100 }, concord, new Set())?.kind).toBe('freighter');
        expect(isConcordHullKind('port')).toBe(true);
        expect(isConcordHullKind('base')).toBe(false);
    });

    it('portrait and flag at the original portrait / flag sizes: turquoise field, copper emblem', () => {
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
        const [r, g, b] = px(f, 12, 12);
        expect(g).toBeGreaterThan(r * 2);
        expect(b).toBeGreaterThan(r * 2);
        const [cr, cg, cb] = px(f, Math.floor(f.w / 2), Math.floor(f.h * 0.62));
        expect(cr).toBeGreaterThan(cb * 1.4);
        expect(cr).toBeGreaterThan(cg);
        // The smoky ground (right side, away from the lantern) leans turquoise; the mask is copper.
        let sr = 0;
        let sg = 0;
        for (let y = 100; y < 140; y++) for (let x = 254; x < 280; x++) {
            const [r0, g0] = px(p, x, y);
            sr += r0;
            sg += g0;
        }
        expect(sg).toBeGreaterThan(sr);
        const [mr, , mb] = px(p, 115, 190);
        expect(mr).toBeGreaterThanOrEqual(mb);
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
        expect(concordKindOf(BuiltObjectSubRole.MediumFreighter, false)).toBe('freighter');
        expect(concordKindOf(BuiltObjectSubRole.ExplorationShip, false)).toBe('explorer');
        expect(concordKindOf(BuiltObjectSubRole.ConstructionShip, false)).toBe('construction');
        expect(concordKindOf(BuiltObjectSubRole.LargeSpacePort, false)).toBe('port');
        expect(concordKindOf(BuiltObjectSubRole.MiningStation, false)).toBe('base');
        expect(concordKindOf(BuiltObjectSubRole.Cruiser, true)).toBe('treasure');
        expect([100, 150, 299, 300, 500, 800, 1200, 5000].map(concordSizeBucket)).toEqual([0, 1, 1, 2, 3, 4, 5, 5]);
    });

    it('light blink groups: steady, flood flicker, slow red / green pulse, strobe double flash on the nav-light cycle', () => {
        const strobeOn: number[] = [];
        for (let t = 0; t < 5; t += 0.01) {
            expect(concordLightAlpha('steady', t, 3)).toBe(0.5);
            const f = concordLightAlpha('flood', t, 3);
            expect(f).toBeGreaterThan(0.15);
            expect(f).toBeLessThanOrEqual(0.5);
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
        // Phase offset per ship (the ambient pattern: id % 20 / 10 s).
        expect(concordLightAlpha('strobe', 0.03, 0)).toBeGreaterThan(0);
        expect(concordLightAlpha('strobe', 0.03, 5)).toBe(0);
    });
});
