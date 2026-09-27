// 19r item 7: liveries + withered look (src/render/liveries.ts, liveryLayer.ts observeShip) — mask analysis
// (centreline / length → band + hull number slot, distance transform → decal, mid-tone gate), the withering curve and
// its resets, the observed history, and the no-op when nothing applies.
import { describe, expect, it } from 'vitest';
import {
    PIRATE_WITHER_FLOOR,
    WITHER_STEPS,
    analyseHull,
    cropRotatedImage,
    distanceTransform,
    hullNumberRgba,
    midToneGate,
    paintLivery,
    witherBucket,
    witherCurve,
    witherLevel,
    type CropImage,
    type LiveryStyle,
} from '../src/render/liveries';
import { cropHullMask } from '../src/render/damageOverlay';
import { newShipHistory, observeShip } from '../src/render/liveryLayer';
import { GalaxyLocationEffectType } from '../src/sim/galaxyLocation';

/** A 96² crop image: an elongated hull along x (bow → +x), grey plating, a bright window strip and a blue engine. */
function testHull(): CropImage {
    const side = 96;
    const rgba = new Uint8ClampedArray(side * side * 4);
    for (let y = 0; y < side; y++) {
        for (let x = 0; x < side; x++) {
            const u = (x - 48) / 40;
            const v = (y - 48) / 14;
            if (u * u + v * v > 1) continue;
            const i = (y * side + x) * 4;
            let c = [120, 122, 126];
            if (y === 48 && x > 70 && x < 80) c = [250, 250, 240]; // windows
            if (x < 14 && Math.abs(y - 48) < 3) c = [40, 90, 255]; // engine glow
            rgba.set([...c, 255], i);
        }
    }
    return { rgba, side };
}

const STYLE: LiveryStyle = { main: 0xc03020, secondary: 0xf0e0a0, emblem: 3, saltBloom: 0, paint: true };

describe('19r livery mask analysis', () => {
    const img = testHull();
    const an = analyseHull(img)!;
    it('length and centreline from the columns', () => {
        expect(an.xMin).toBeGreaterThanOrEqual(7);
        expect(an.xMax).toBeLessThanOrEqual(88);
        expect(an.length).toBeGreaterThan(75);
        expect(an.centre[48]).toBeCloseTo(48, 0);
        expect(an.halfWidth[48]).toBeGreaterThan(12);
    });
    it('band ahead of midships, hull number near the stern, decal clear of both and inside the hull', () => {
        const u0 = (an.band.x0 - an.xMin) / an.length;
        expect(u0).toBeGreaterThanOrEqual(0.5);
        expect(u0).toBeLessThanOrEqual(0.77);
        const un = (an.number.x - an.xMin) / an.length;
        expect(un).toBeGreaterThanOrEqual(0.09);
        expect(un).toBeLessThanOrEqual(0.33);
        const d = an.decal;
        expect(d.r).toBeGreaterThanOrEqual(2.5);
        expect(an.mask[Math.round(d.y) * img.side + Math.round(d.x)]).toBe(1);
        expect(d.x + d.r <= an.band.x0 - 1 || d.x - d.r >= an.band.x1 + 1).toBe(true);
        expect(an.dist[Math.round(d.y) * img.side + Math.round(d.x)]).toBeGreaterThanOrEqual(d.r);
    });
    it('the mid-tone gate keeps windows, engines and seams clean', () => {
        expect(midToneGate(0.95, 0.05)).toBe(0);
        expect(midToneGate(0.05, 0.1)).toBe(0);
        expect(midToneGate(0.5, 0.8)).toBe(0);
        expect(midToneGate(0.47, 0.05)).toBe(1);
        expect(an.gate[48 * img.side + 75]).toBe(0);
        expect(an.gate[48 * img.side + 10]).toBe(0);
    });
    it('the distance transform is the exact Euclidean distance to the nearest non-hull pixel', () => {
        const w = 17;
        const h = 13;
        const m = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) m[i] = (i * 7919) % 11 < 8 ? 1 : 0;
        const d = distanceTransform(m, w, h);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (m[y * w + x] === 0) {
                    expect(d[y * w + x]).toBe(0);
                    continue;
                }
                let best = Infinity;
                for (let yy = -1; yy <= h; yy++) for (let xx = -1; xx <= w; xx++) {
                    const bg = xx < 0 || yy < 0 || xx >= w || yy >= h || m[yy * w + xx] === 0;
                    if (bg) best = Math.min(best, Math.hypot(xx - x, yy - y));
                }
                expect(d[y * w + x]).toBeCloseTo(best, 4);
            }
        }
    });
    it('the rotated crop matches the damage mask orientation', () => {
        const raw = new Uint8ClampedArray(12 * 10 * 4);
        for (let x = 2; x < 9; x++) raw[(1 * 12 + x) * 4 + 3] = 255;
        const crop = { cropSide: 10, cropCenterX: 6, cropCenterY: 5 };
        const img2 = cropRotatedImage(raw, 12, 10, crop, 1);
        const m = cropHullMask(raw, 12, 10, crop, 10);
        for (let i = 0; i < 100; i++) expect(img2.rgba[i * 4 + 3] > 0 ? 1 : 0).toBe(m[i]);
    });
});

describe('19r livery painting', () => {
    const img = testHull();
    const an = analyseHull(img)!;
    it('nothing applies (no style, fresh, no scars) → an empty overlay', () => {
        const o = paintLivery(an, img, null, { level: 0, scars: 0 }, 1);
        expect(o.every((v) => v === 0)).toBe(true);
    });
    it('the band and decal land only on gated plating, never on the windows or the engine', () => {
        const o = paintLivery(an, img, STYLE, { level: 0, scars: 0 }, 1);
        let painted = 0;
        for (let i = 0; i < img.side * img.side; i++) {
            if (o[i * 4 + 3] === 0) continue;
            painted++;
            expect(an.mask[i]).toBe(1);
            expect(an.gate[i]).toBeGreaterThan(0);
        }
        expect(painted).toBeGreaterThan(40);
        for (let x = 71; x < 80; x++) expect(o[(48 * img.side + x) * 4 + 3]).toBe(0);
    });
    it('withering adds grime / pitting / streaks, capped subtle; scars and salt bloom add more', () => {
        const fresh = paintLivery(an, img, STYLE, { level: 0, scars: 0 }, 1);
        const old = paintLivery(an, img, STYLE, { level: 1, scars: 0 }, 1);
        const scarred = paintLivery(an, img, STYLE, { level: 1, scars: 3 }, 1);
        const salty = paintLivery(an, img, { ...STYLE, saltBloom: 1 }, { level: 0, scars: 0 }, 1);
        const count = (o: Uint8ClampedArray): number => {
            let n = 0;
            for (let i = 3; i < o.length; i += 4) if (o[i] > 0) n++;
            return n;
        };
        expect(count(old)).toBeGreaterThan(count(fresh));
        expect(count(scarred)).toBeGreaterThan(count(old) - 1);
        expect(count(salty)).toBeGreaterThan(count(fresh));
        // Salt only on the edges (within ~2.6 px of the outline).
        for (let i = 0; i < img.side * img.side; i++) if (salty[i * 4 + 3] > 0 && fresh[i * 4 + 3] === 0) expect(an.dist[i]).toBeLessThanOrEqual(2.6);
        // Wear alone never covers more than the cap (fresh livery pixels aside).
        const bare = paintLivery(an, img, null, { level: 1, scars: 0 }, 1);
        for (let i = 3; i < bare.length; i += 4) expect(bare[i]).toBeLessThanOrEqual(Math.ceil(255 * 0.62 * 1.6));
    });
    it('hull number glyphs', () => {
        const n = hullNumberRgba('42', 0xffffff, 2);
        expect(n.w).toBe((2 * 4 - 1 + 2) * 2);
        expect(n.h).toBe(7 * 2);
        expect(n.rgba.some((v, i) => i % 4 === 3 && v === 230)).toBe(true);
    });
});

describe('19r withering', () => {
    const Y = 600000;
    it('curve: 0 new, rising, bounded by 1', () => {
        expect(witherCurve(0)).toBe(0);
        expect(witherCurve(5)).toBeLessThan(witherCurve(10));
        expect(witherCurve(10)).toBeCloseTo(1 - Math.exp(-1), 6);
        expect(witherCurve(1000)).toBeLessThanOrEqual(1);
    });
    it('a retrofit or a long repair resets it; pirates stay withered and ignore both', () => {
        const base = { nowStarDate: 30 * Y, dateBuilt: 0, dateRetrofit: 0, repairedAt: 0, yearLength: Y, pirate: false };
        const old = witherLevel(base);
        expect(old).toBeGreaterThan(0.9);
        expect(witherLevel({ ...base, dateRetrofit: 29 * Y })).toBeLessThan(0.15);
        expect(witherLevel({ ...base, repairedAt: 30 * Y })).toBe(0);
        expect(witherLevel({ ...base, nowStarDate: 0, pirate: true })).toBe(PIRATE_WITHER_FLOOR);
        expect(witherLevel({ ...base, dateRetrofit: 30 * Y, pirate: true })).toBeCloseTo(old, 9);
    });
    it('buckets', () => {
        expect(witherBucket(0)).toBe(0);
        expect(witherBucket(1)).toBe(WITHER_STEPS);
        expect(witherBucket(0.49)).toBe(Math.round(0.49 * WITHER_STEPS));
    });
    it('observed history: long repair, lightning strikes, retrofit clears the scars', () => {
        const bo = {
            damagedComponentCount: 0,
            components: { items: new Array(10).fill(0) },
            dateRetrofit: 5,
            lastLocationEffectTouch: -1,
            locationEffects: [] as number[],
        };
        const h = newShipHistory(bo);
        observeShip(h, bo, 100);
        expect(h.repairedAt).toBe(0);
        bo.damagedComponentCount = 4;
        observeShip(h, bo, 200);
        bo.damagedComponentCount = 1;
        observeShip(h, bo, 250);
        bo.damagedComponentCount = 0;
        observeShip(h, bo, 300);
        expect(h.repairedAt).toBe(300);
        bo.locationEffects = [GalaxyLocationEffectType.LightningDamage];
        bo.lastLocationEffectTouch = 1000;
        observeShip(h, bo, 1000);
        bo.lastLocationEffectTouch = 9000;
        observeShip(h, bo, 9000);
        expect(h.scars).toBe(2);
        bo.dateRetrofit = 9500;
        observeShip(h, bo, 9500);
        expect(h.scars).toBe(0);
    });
});
