// Scenario 19a Concord art (render/concordArt.ts): deterministic procedural junk / base / portrait / flag images, sizes,
// luma statistics matched to the Ackdarian reference frames, the display gate (Concord's empire only; off with the
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
    buildConcordShipArt,
    concordArtEmpire,
    concordArtEnabled,
    concordArtLook,
    concordArtStats,
    concordDetailAlpha,
    concordKindOf,
    concordLanternAlpha,
    concordLookOf,
    concordSheenAlpha,
    concordSizeBucket,
    concordSpec,
    concordTextureSide,
    concordTreasureShips,
    concordVariantFor,
    generateConcordFlag,
    generateConcordImages,
    generateConcordPortrait,
    imageHash,
    raceHasConcordArt,
    type ConcordImages,
    type RgbaImage,
} from '../src/render/concordArt';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';

const cache = new Map<string, ConcordImages>();
function images(kind: (typeof CONCORD_KINDS)[number], bucket: number, look: (typeof CONCORD_LOOKS)[number]): ConcordImages {
    const key = `${look}:${kind}:${bucket}`;
    let im = cache.get(key);
    if (im === undefined) {
        im = generateConcordImages(kind, bucket, look);
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

describe('Concord procedural images', { timeout: 180000 }, () => {
    it('are deterministic and differ by look', () => {
        const a = generateConcordImages('warship', 2, 'hybrid');
        const b = generateConcordImages('warship', 2, 'hybrid');
        for (const k of ['ship', 'detail', 'sheen', 'glow'] as const) expect(imageHash(a[k])).toBe(imageHash(b[k]));
        const hashes = CONCORD_LOOKS.map((l) => imageHash(images('warship', 2, l).ship));
        expect(new Set(hashes).size).toBe(3);
        expect(imageHash(generateConcordPortrait())).toBe(imageHash(generateConcordPortrait()));
        expect(imageHash(generateConcordFlag())).toBe(imageHash(generateConcordFlag()));
    });

    it('have the variant sizes, content inside the texture, stern thruster marks and no nav-light marks', () => {
        for (const look of CONCORD_LOOKS) {
            for (const kind of CONCORD_KINDS) {
                for (const bucket of [0, 5]) {
                    const im = images(kind, bucket, look);
                    const side = concordTextureSide(kind, bucket);
                    for (const k of ['ship', 'detail', 'sheen', 'glow'] as const) {
                        expect(im[k].w).toBe(side);
                        expect(im[k].h).toBe(side);
                        expect(im[k].data.length).toBe(side * side * 4);
                    }
                    const box = opaqueBox(im.ship);
                    expect(box.x0, `${look} ${kind} ${bucket}`).toBeGreaterThan(0);
                    expect(box.y0).toBeGreaterThan(0);
                    expect(box.x1).toBeLessThan(side - 1);
                    expect(box.y1).toBeLessThan(side - 1);
                    const art = buildConcordShipArt(im);
                    expect(art).not.toBeNull();
                    expect(art!.markers.lights.length).toBe(0);
                    const base = kind === 'port' || kind === 'base';
                    expect(art!.markers.thrusters.length).toBe(base ? 0 : bucket <= 1 ? 1 : 2);
                    // The marks are painted out of the texture.
                    for (const p of im.markerPixels) expect(art!.rgba[p * 4 + 2] === 255 && art!.rgba[p * 4] === 0).toBe(false);
                    expect(im.lanterns.length).toBeGreaterThan(0);
                }
            }
        }
    });

    it('scale sails / tiers / yards and lanterns with size; treasure ships carry the biggest lanterns and banners', () => {
        expect(concordSpec('warship', 0, 'pagoda').pagodas).toBeLessThan(concordSpec('warship', 5, 'pagoda').pagodas);
        expect(concordSpec('warship', 0, 'furled').yards).toBeLessThan(concordSpec('warship', 5, 'furled').yards);
        expect(concordSpec('warship', 0).battens).toBeLessThan(concordSpec('warship', 5).battens);
        expect(concordSpec('freighter', 0).lanternsPerYard).toBeLessThan(concordSpec('freighter', 5).lanternsPerYard);
        const t = concordSpec('treasure', 5);
        for (const k of CONCORD_KINDS) if (k !== 'treasure') expect(t.lanternR / t.side).toBeGreaterThan(concordSpec(k, 5).lanternR / concordSpec(k, 5).side);
        expect(t.banners).toBeGreaterThan(0);
        expect(concordSpec('warship', 5).banners).toBe(0);
        expect(images('freighter', 5, 'hybrid').lanterns.length).toBeGreaterThan(images('freighter', 0, 'hybrid').lanterns.length);
    });

    it('match the Ackdarian reference luma mean / contrast', () => {
        const rows: string[] = [];
        for (const look of CONCORD_LOOKS) {
            for (const kind of CONCORD_KINDS) {
                for (const bucket of [0, 5]) {
                    const im = images(kind, bucket, look);
                    const mk = new Set(im.markerPixels);
                    const s = concordArtStats(im.ship.data, im.ship.w, im.ship.h, (p) => mk.has(p));
                    const ref = ACKDARIAN_REFERENCE[kind];
                    expect(Math.abs(s.meanL - ref.meanL), `${look} ${kind} ${bucket} mean`).toBeLessThan(0.005);
                    expect(Math.abs(s.stdL - ref.stdL), `${look} ${kind} ${bucket} std`).toBeLessThan(0.005);
                    expect(s.p95L).toBeGreaterThan(s.p5L + 0.3);
                    rows.push(`${look} ${kind} b${bucket}: meanL ${s.meanL.toFixed(3)} stdL ${s.stdL.toFixed(3)} (ref ${ref.meanL} / ${ref.stdL})`);
                }
            }
        }
        expect(rows.length).toBe(42);
    });

    it.skipIf(dwuAssetPath('images/units/ships/family7/cruiser.png') === null)('reference constants re-measure on the install frames', () => {
        for (const kind of CONCORD_KINDS) {
            const ref = ACKDARIAN_REFERENCE[kind];
            const png = decodePng(dwuAssetPath(`images/units/ships/${ref.file}`)!);
            const s = concordArtStats(png.data, png.width, png.height);
            expect(Math.abs(s.meanL - ref.meanL), kind).toBeLessThan(0.001);
            expect(Math.abs(s.stdL - ref.stdL), kind).toBeLessThan(0.001);
        }
    });

    it('portrait and flag at the original portrait / flag sizes, opaque, red field with gold', () => {
        const p = generateConcordPortrait();
        expect(p.w).toBe(CONCORD_PORTRAIT_SIZE);
        expect(p.h).toBe(CONCORD_PORTRAIT_SIZE);
        const f = generateConcordFlag();
        expect(f.w).toBe(CONCORD_FLAG_W);
        expect(f.h).toBe(CONCORD_FLAG_H);
        for (const img of [p, f]) {
            const s = concordArtStats(img.data, img.w, img.h);
            expect(s.pixels).toBe(img.w * img.h);
            expect(s.hueDeg).toBeLessThan(40); // red → gold
            expect(s.meanSat).toBeGreaterThan(0.5);
        }
        // The flag field just inside the border is lacquer red; the emblem centre is gold.
        const px = (img: RgbaImage, x: number, y: number): number[] => Array.from(img.data.slice((y * img.w + x) * 4, (y * img.w + x) * 4 + 3));
        const [r, g] = px(f, 12, 12);
        expect(r).toBeGreaterThan(g * 3);
        const [cr, cg, cb] = px(f, Math.floor(f.w / 2), Math.floor(f.h * 0.62));
        expect(cr).toBeGreaterThan(cb * 1.8);
        expect(cg).toBeGreaterThan(cb);
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
        expect(concordVariantFor({ empire: concord, subRole: BuiltObjectSubRole.Cruiser, size: 600 }, empire, treasure)).toEqual({ kind: 'warship', bucket: 3, look: 'hybrid' });
        expect(concordVariantFor(treasureShip, empire, treasure)).toEqual({ kind: 'treasure', bucket: 4, look: 'hybrid' });
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

    it('reads the look param (default hybrid)', () => {
        expect(concordArtLook(fakeGalaxy({ rimTrader: true }).galaxy)).toBe('hybrid');
        expect(concordArtLook(fakeGalaxy({ rimTrader: true }, { concordArtLook: 1 }).galaxy)).toBe('pagoda');
        expect(concordArtLook(fakeGalaxy({ rimTrader: true }, { concordArtLook: 2 }).galaxy)).toBe('furled');
        expect(concordLookOf(9)).toBe('furled');
        expect(concordLookOf(-3)).toBe('hybrid');
    });

    it('the manifest declares the flag (default on) and the look param (default 0)', () => {
        const m = loadScenarioOverlayFs('rimTrade').manifest;
        expect(m.flags.find((f) => f.name === 'concordArt')?.default).toBe(true);
        const p = m.params.find((x) => x.name === 'concordArtLook');
        expect(p?.default).toBe(0);
        expect(p?.max).toBe(2);
    });

    it('maps sub-roles to kinds and sizes to buckets', () => {
        expect(concordKindOf(BuiltObjectSubRole.Escort, false)).toBe('warship');
        expect(concordKindOf(BuiltObjectSubRole.MediumFreighter, false)).toBe('freighter');
        expect(concordKindOf(BuiltObjectSubRole.ExplorationShip, false)).toBe('explorer');
        expect(concordKindOf(BuiltObjectSubRole.ConstructionShip, false)).toBe('construction');
        expect(concordKindOf(BuiltObjectSubRole.LargeSpacePort, false)).toBe('port');
        expect(concordKindOf(BuiltObjectSubRole.MiningStation, false)).toBe('base');
        expect(concordKindOf(BuiltObjectSubRole.Cruiser, true)).toBe('treasure');
        expect([100, 150, 299, 300, 500, 800, 1200, 5000].map(concordSizeBucket)).toEqual([0, 1, 1, 2, 3, 4, 5, 5]);
    });

    it('lantern / sheen / detail alphas stay low and follow the nav-light phase and zoom', () => {
        for (let t = 0; t < 10; t += 0.13) {
            const a = concordLanternAlpha(t, 7);
            expect(a).toBeGreaterThan(0.2);
            expect(a).toBeLessThanOrEqual(0.6);
            const s = concordSheenAlpha(t, 7);
            expect(s).toBeGreaterThanOrEqual(0.05);
            expect(s).toBeLessThanOrEqual(0.18);
        }
        // Brighter in the "on" phase (lightsOn: 1.5 s on / 1.0 s off, offset by id % 20 / 10).
        expect(concordLanternAlpha(0.2, 0)).toBeGreaterThan(concordLanternAlpha(2.0, 0) * 1.1);
        expect(concordDetailAlpha(60)).toBe(0);
        expect(concordDetailAlpha(240)).toBe(1);
        expect(concordDetailAlpha(165)).toBeGreaterThan(0);
    });
});
