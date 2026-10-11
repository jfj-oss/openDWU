// Scenario 19a Concord art (render/concordArt.ts, concordPhoto.ts): the insect-photo fleet (public/art/concord-photo,
// built offline by scripts/concord-photo-art.py) composed per variant — the stock frame's texture side per class, the
// fittings baked from each class's manifest (blue blink lights, strobes, running lights, engine glow, thruster marks at
// the nozzles), the image's own area ratio, the limbs cut out for the close-zoom animation — the portrait / flag, the
// display gate (Concord's empire only; off with the `concordArt` flag or without the rim trader) and the manifest.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodePng } from './helpers/pngDecode';
import { loadScenarioOverlayFs } from './helpers/scenarioGame';
import {
    CONCORD_FLAG_H,
    CONCORD_FLAG_W,
    CONCORD_KINDS,
    CONCORD_LIMBS_MIN_PX,
    CONCORD_PORTRAIT_SIZE,
    CONCORD_TREASURE_AREA_BOOST,
    isConcordBase,
    buildConcordShipArt,
    concordArtEmpire,
    concordArtEnabled,
    concordArtStats,
    CONCORD_LIGHT_GROUPS,
    ACKDARIAN_PORTRAIT_STDL,
    concordKindOf,
    concordLightAlpha,
    concordLimbAngle,
    concordSizeBucket,
    concordTreasureShips,
    concordVariantFor,
    generateConcordFlag,
    generateConcordPortrait,
    imageHash,
    raceHasConcordArt,
    type ConcordImages,
    type ConcordKind,
    type RgbaImage,
} from '../src/render/concordArt';
import {
    CONCORD_PHOTO_SIDE,
    concordPhotoImages,
    concordPhotoSplitLimbs,
    type ConcordPhotoManifest,
    type ConcordPhotoSourceData,
} from '../src/render/concordPhoto';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';

const ART = resolve(__dirname, '../public/art/concord-photo');

function png(file: string): RgbaImage {
    const d = decodePng(file);
    return { w: d.width, h: d.height, data: d.data };
}

const sources = new Map<ConcordKind, ConcordPhotoSourceData>();
function source(kind: ConcordKind): ConcordPhotoSourceData {
    let s = sources.get(kind);
    if (s === undefined) {
        const img = png(`${ART}/${kind}.png`);
        const manifest = JSON.parse(readFileSync(`${ART}/${kind}.json`, 'utf8')) as ConcordPhotoManifest;
        s = manifest.limbs !== undefined && manifest.limbs.length > 0 ? { img, manifest, ...concordPhotoSplitLimbs(img, png(`${ART}/${kind}-limbs.png`), manifest.limbs) } : { img, manifest };
        sources.set(kind, s);
    }
    return s;
}

function images(kind: ConcordKind, bucket: number): ConcordImages {
    return concordPhotoImages({ kind, bucket }, source(kind));
}

function opaque(img: RgbaImage): number {
    let n = 0;
    for (let p = 0; p < img.w * img.h; p++) if (img.data[p * 4 + 3] >= 128) n++;
    return n;
}

describe('Concord ship images', { timeout: 300000 }, () => {
    it('are deterministic, at the stock frame\'s texture side for the class', () => {
        for (const kind of CONCORD_KINDS) {
            const a = images(kind, 3);
            const b = concordPhotoImages({ kind, bucket: 3 }, source(kind));
            expect(imageHash(a.ship)).toBe(imageHash(b.ship));
            expect(a.ship.w).toBe(CONCORD_PHOTO_SIDE[kind]);
            expect(a.ship.h).toBe(CONCORD_PHOTO_SIDE[kind]);
            for (const g of CONCORD_LIGHT_GROUPS) expect(a.halos[g].data.length).toBe(a.ship.w * a.ship.h * 4);
            expect(opaque(a.ship)).toBeGreaterThan(a.ship.w * a.ship.h * 0.15);
        }
        expect(imageHash(generateConcordPortrait())).toBe(imageHash(generateConcordPortrait()));
    });

    it('carry thruster marks at every nozzle of the manifest and no stray marker colours', () => {
        for (const kind of CONCORD_KINDS) {
            const im = images(kind, 4);
            const built = buildConcordShipArt(im);
            expect(built).not.toBeNull();
            const n = source(kind).manifest.thrusters.length;
            expect(built!.markers.thrusters.length).toBe(n);
            if (kind === 'base' || kind === 'port') expect(n).toBe(0);
            else expect(n).toBeGreaterThanOrEqual(2);
            // No pure-yellow (stock light) marks; pure blue only at the thruster runs.
            const marks = new Set(im.markerPixels);
            for (let p = 0; p < im.ship.w * im.ship.h; p++) {
                const d = im.ship.data;
                if (d[p * 4 + 3] === 0) continue;
                expect(d[p * 4] === 255 && d[p * 4 + 1] === 255 && d[p * 4 + 2] === 0).toBe(false);
                if (d[p * 4] === 0 && d[p * 4 + 1] === 0 && d[p * 4 + 2] === 255) expect(marks.has(p)).toBe(true);
            }
        }
    });

    it('blink blue: position lights on every class, strobe pairs on the larger hulls, steady running lights', () => {
        for (const kind of CONCORD_KINDS) {
            const im = images(kind, 4);
            const blink = im.lights.filter((l) => l.kind === 'blink');
            expect(blink.length).toBeGreaterThanOrEqual(3);
            for (const l of blink) expect(l.c![2]).toBeGreaterThan(l.c![0]);
            if (kind !== 'frigate') expect(im.lights.filter((l) => l.kind === 'strobe').length).toBe(2);
            expect(im.lights.some((l) => l.kind === 'deck')).toBe(true);
            // Every light sits on the silhouette.
            for (const l of im.lights) expect(im.ship.data[(Math.floor(l.y) * im.ship.w + Math.floor(l.x)) * 4 + 3]).toBeGreaterThan(0);
        }
    });

    it('draw at a stock ship\'s opaque area: their own area ratio (treasure ship boosted)', () => {
        for (const kind of CONCORD_KINDS) {
            const im = images(kind, 3);
            const built = buildConcordShipArt(im)!;
            const own = (built.metrics.cropSide * built.metrics.cropSide) / opaque(im.ship);
            const boost = kind === 'treasure' ? CONCORD_TREASURE_AREA_BOOST : 1;
            const ratio = built.metrics.areaRatio / (own * boost);
            expect(ratio).toBeGreaterThan(0.8);
            expect(ratio).toBeLessThan(1.2);
        }
    });

    it('cut the legs and antennae out for the close-zoom animation (bases have none)', () => {
        for (const kind of CONCORD_KINDS) {
            const im = images(kind, 5);
            if (kind === 'base' || kind === 'port') {
                expect(im.limbs).toBeUndefined();
                continue;
            }
            expect(im.limbs!.length).toBeGreaterThanOrEqual(3);
            expect(opaque(im.bodyShip!)).toBeLessThan(opaque(im.ship));
            for (const l of im.limbs!) {
                expect(l.x).toBeGreaterThan(0);
                expect(l.x).toBeLessThan(im.ship.w);
                expect(Math.abs(concordLimbAngle(l, 0.7, 3))).toBeLessThan(0.15);
            }
        }
        expect(CONCORD_LIMBS_MIN_PX).toBeGreaterThan(48);
    });

    it('every class has its own image', () => {
        const hashes = new Set(CONCORD_KINDS.map((k) => imageHash(source(k).img)));
        expect(hashes.size).toBe(CONCORD_KINDS.length);
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
        expect(concordVariantFor({ empire: concord, subRole: BuiltObjectSubRole.Cruiser, size: 600 }, empire, treasure)).toEqual({ kind: 'battleship', bucket: 3 });
        expect(concordVariantFor(treasureShip, empire, treasure)).toEqual({ kind: 'treasure', bucket: 4 });
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

    it('the manifest declares the flag (default on) and no finish param', () => {
        const m = loadScenarioOverlayFs('rimTrade').manifest;
        expect(m.flags.find((f) => f.name === 'concordArt')?.default).toBe(true);
        expect(m.params.find((x) => x.name === 'concordArtLook')).toBeUndefined();
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

    it('light blink groups: steady, slow nav pulse, strobe double flash, blue blink on / off on the nav-light cycle', () => {
        const strobeOn: number[] = [];
        let blinkOn = 0;
        for (let t = 0; t < 5; t += 0.01) {
            expect(concordLightAlpha('steady', t, 3)).toBe(0.5);
            const n = concordLightAlpha('nav', t, 3);
            expect(n).toBeGreaterThanOrEqual(0.45);
            expect(n).toBeLessThanOrEqual(0.7);
            if (concordLightAlpha('strobe', t, 3) > 0) strobeOn.push(t);
            const b = concordLightAlpha('blink', t, 3);
            expect(b === 0 || b === 1).toBe(true);
            if (b > 0) blinkOn++;
        }
        // Two short (0.07 s) flashes per 2.5 s cycle: about 5.6 % of the time lit, in 4 separate bursts over 5 s.
        expect(strobeOn.length).toBeGreaterThan(20);
        expect(strobeOn.length).toBeLessThan(40);
        let bursts = 1;
        for (let k = 1; k < strobeOn.length; k++) if (strobeOn[k] - strobeOn[k - 1] > 0.05) bursts++;
        expect(bursts).toBe(4);
        // Blink: on 1.5 s of every 2.5 s (the stock nav lights' LIGHT_ON / OFF_SECONDS).
        expect(blinkOn / 500).toBeGreaterThan(0.55);
        expect(blinkOn / 500).toBeLessThan(0.65);
        // Phase offset per ship (the ambient pattern: id % 20 / 10 s).
        expect(concordLightAlpha('strobe', 0.03, 0)).toBeGreaterThan(0);
        expect(concordLightAlpha('strobe', 0.03, 5)).toBe(0);
    });
});
