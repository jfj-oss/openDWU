// 19r item 1: the base-game damage overlay (src/render/damageOverlay.ts) — budgets and cluster loop against the C#
// (Main.Part12.cs 4988 method_106 / 5002 method_107 / 5016 method_108, Main.Part11.cs 107 method_113), the hull clip,
// the hatch, the load-rotation of the mask, and the flag-off no-op (damageFx off = only the original's pixels).
import { describe, expect, it } from 'vitest';
import { Random } from '../src/sim/random';
import { CreatureType } from '../src/sim/creature';
import {
    BLOTCH_WEIGHTS,
    DAMAGE_HATCH_BACK,
    DAMAGE_HATCH_FORE,
    HATCH_BRUSH,
    buildDamageLayer,
    creatureDamageBudget,
    creatureDamageColour,
    cropHullMask,
    damageClusters,
    damageOverlaySide,
    fighterDamageBudget,
    paintDamageOverlay,
    paintEmbers,
    shipDamageBudget,
} from '../src/render/damageOverlay';
import { artBundleFlag, setArtBundleUrlFlags } from '../src/render/artBundleFlags';

describe('19r damage budgets (method_106 / 107 / 108)', () => {
    it('ships: (int)(w × h × 0.7 × damaged / components)', () => {
        expect(shipDamageBudget(100, 100, 3, 10)).toBe(Math.trunc(100 * 100 * 0.7 * 0.3));
        expect(shipDamageBudget(57, 57, 1, 7)).toBe(Math.trunc(57 * 57 * 0.7 * (1 / 7)));
        expect(shipDamageBudget(100, 100, 0, 10)).toBe(0);
        expect(shipDamageBudget(100, 100, 2, 0)).toBe(0);
    });
    it('fighters: (int)(w × h × 0.7 × (1 − Health)) with the float Health', () => {
        const h = Math.fround(0.37);
        expect(fighterDamageBudget(40, 40, 0.37)).toBe(Math.trunc(40 * 40 * 0.7 * (1 - h)));
        expect(fighterDamageBudget(40, 40, 1)).toBe(0);
    });
    it('creatures: (int)(w × h × 0.3 × Damage / DamageKillThreshhold)', () => {
        expect(creatureDamageBudget(90, 90, 50, 200)).toBe(Math.trunc(90 * 90 * 0.3 * 0.25));
        expect(creatureDamageBudget(90, 90, 0, 200)).toBe(0);
    });
    it('creature flesh colours; SilverMist fades instead', () => {
        expect(creatureDamageColour(CreatureType.Kaltor)).toEqual([110, 32, 80]);
        expect(creatureDamageColour(CreatureType.RockSpaceSlug)).toEqual([64, 32, 36]);
        expect(creatureDamageColour(CreatureType.DesertSpaceSlug)).toEqual([160, 56, 0]);
        expect(creatureDamageColour(CreatureType.Ardilus)).toEqual([48, 8, 20]);
        expect(creatureDamageColour(CreatureType.SilverMist)).toBeNull();
        expect(creatureDamageColour(CreatureType.Undefined)).toEqual([1, 1, 1]);
    });
});

describe('19r method_113 cluster loop', () => {
    it('draws Next(0,6), Next(0,w−1), Next(0,h−1) per cluster from Random(id)', () => {
        const cl = damageClusters(new Random(1234), 80, 60, 50);
        const r = new Random(1234);
        for (const c of cl) {
            expect(c.shape).toBe(r.next(0, 6));
            expect(c.x).toBe(r.next(0, 79));
            expect(c.y).toBe(r.next(0, 59));
        }
    });
    it('cluster count follows the budget: the weights cover it, and it was still > 0 before the last one', () => {
        for (const [w, dmg, comp] of [
            [64, 1, 10],
            [128, 3, 10],
            [200, 7, 9],
        ]) {
            const budget = shipDamageBudget(w, w, dmg, comp);
            const cl = damageClusters(new Random(99), w, w, budget);
            const spent = cl.reduce((a, c) => a + BLOTCH_WEIGHTS[c.shape], 0);
            expect(spent).toBeGreaterThanOrEqual(budget);
            expect(spent - BLOTCH_WEIGHTS[cl[cl.length - 1].shape]).toBeLessThan(budget);
            // Mean weight 64 / 6 ≈ 10.7: the count is about budget / 10.7.
            expect(cl.length).toBeGreaterThan(budget / 19);
            expect(cl.length).toBeLessThanOrEqual(Math.ceil(budget / 6));
        }
    });
    it('a bigger budget on the same seed extends the same list (a new hit adds clusters)', () => {
        const a = damageClusters(new Random(7), 100, 100, 300);
        const b = damageClusters(new Random(7), 100, 100, 900);
        expect(b.length).toBeGreaterThan(a.length);
        expect(b.slice(0, a.length)).toEqual(a);
    });
    it('shape rectangles match the C# switch', () => {
        const cl = damageClusters(new Random(5), 50, 50, 2000);
        for (const c of cl) {
            const { x, y } = c;
            const expected = [
                [[x, y, 3, 3], [x + 3, y, 1, 2]],
                [[x, y, 2, 2], [x + 1, y + 2, 2, 2]],
                [[x, y, 3, 5], [x - 1, y + 2, 2, 2]],
                [[x, y, 2, 2], [x - 1, y - 1, 2, 2]],
                [[x, y, 2, 2], [x - 1, y - 1, 1, 1], [x + 1, y + 2, 1, 1]],
                [[x, y, 3, 3], [x - 2, y, 2, 2]],
            ][c.shape];
            expect(c.rects.map((r) => [r.x, r.y, r.w, r.h])).toEqual(expected);
        }
    });
});

describe('19r damage layer painting', () => {
    const w = 64;
    const h = 64;
    // A disc hull.
    const hull = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.hypot(x - 32, y - 32) < 24) hull[y * w + x] = 1;

    it('paints only on the hull and inside the 1-px frame, in the cross hatch', () => {
        const { rgba, painted } = buildDamageLayer(42, w, h, shipDamageBudget(w, h, 5, 10), hull, HATCH_BRUSH);
        expect(painted).toBeGreaterThan(0);
        let n = 0;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                if (rgba[i + 3] === 0) continue;
                n++;
                expect(hull[y * w + x]).toBe(1);
                const col = x % 8 === 0 || y % 8 === 0 ? DAMAGE_HATCH_FORE : DAMAGE_HATCH_BACK;
                expect([rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]]).toEqual([...col, 255]);
            }
        }
        expect(n).toBe(painted);
    });

    it('flag off (no scorch) leaves nothing but the original brush colours; scorch adds a dark halo on the hull only', () => {
        const budget = shipDamageBudget(w, h, 2, 10);
        const plain = buildDamageLayer(3, w, h, budget, hull, HATCH_BRUSH).rgba;
        const fx = buildDamageLayer(3, w, h, budget, hull, HATCH_BRUSH, { scorchRadius: 3, scorchAlpha: 0.4 }).rgba;
        let halo = 0;
        for (let i = 0; i < w * h; i++) {
            const a = plain[i * 4 + 3];
            if (a === 255) expect(fx.slice(i * 4, i * 4 + 4)).toEqual(plain.slice(i * 4, i * 4 + 4));
            else if (fx[i * 4 + 3] > 0) {
                halo++;
                expect(hull[i]).toBe(1);
                expect(fx[i * 4 + 3]).toBeLessThan(255);
            }
        }
        expect(halo).toBeGreaterThan(0);
    });

    it('embers light only the fresh clusters', () => {
        const a = damageClusters(new Random(11), w, h, 200);
        const b = damageClusters(new Random(11), w, h, 600);
        const rgba = new Uint8ClampedArray(w * h * 4);
        const n = paintEmbers(rgba, w, h, hull, b, a.length);
        const none = paintEmbers(new Uint8ClampedArray(w * h * 4), w, h, hull, b, b.length);
        expect(n).toBeGreaterThan(0);
        expect(none).toBe(0);
        const again = new Uint8ClampedArray(w * h * 4);
        paintDamageOverlay(again, w, h, hull, b.slice(a.length), HATCH_BRUSH);
        // Every ember core pixel is a fresh-cluster pixel.
        for (let i = 0; i < w * h; i++) if (rgba[i * 4 + 3] === 255) expect(again[i * 4 + 3]).toBe(255);
    });

    it('the mask follows the load rotation (90° clockwise: the raw top edge becomes the right edge)', () => {
        // Raw 10 × 10 image, only the top row opaque; crop = the whole image.
        const rgba = new Uint8ClampedArray(10 * 10 * 4);
        for (let x = 0; x < 10; x++) rgba[x * 4 + 3] = 255;
        const m = cropHullMask(rgba, 10, 10, { cropSide: 10, cropCenterX: 5, cropCenterY: 5 }, 10);
        for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) expect(m[y * 10 + x]).toBe(x === 9 ? 1 : 0);
    });

    it('overlay side steps in quarter octaves and caps', () => {
        expect(damageOverlaySide(100)).toBe(Math.round(2 ** (Math.round(Math.log2(100) * 4) / 4)));
        expect(damageOverlaySide(5000)).toBe(damageOverlaySide(384));
        expect(damageOverlaySide(5000)).toBeLessThanOrEqual(384);
        expect(damageOverlaySide(1)).toBe(4);
        expect(damageOverlaySide(101)).toBe(damageOverlaySide(100));
    });
});

describe('19r flags', () => {
    it('art-bundle flags are off without a scenario (the damage overlay itself has no flag)', () => {
        setArtBundleUrlFlags({});
        expect(artBundleFlag(null, 'damageFx')).toBe(false);
        expect(artBundleFlag(null, 'liveries')).toBe(false);
        setArtBundleUrlFlags({ damageFx: true });
        expect(artBundleFlag(null, 'damageFx')).toBe(true);
        setArtBundleUrlFlags(null);
    });
});
