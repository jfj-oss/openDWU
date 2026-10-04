import { describe, expect, it } from 'vitest';
import {
    BLACK_HOLE_FPS,
    BLACK_HOLE_FRAME_SCALE,
    BLACK_HOLE_LAYERS,
    GasCloudDetailJob,
    GasCloudView,
    NOVA_FILL_MAX_FACTOR,
    NovaFill,
    blackHoleFrameUrls,
    blackHoleGalaxyPx,
    blackHoleLayerPx,
    blackHoleSpin,
    blackHoleTints,
    clipRect,
    gasCloudBitmapSize,
    gasCloudColorScheme,
    gasCloudDetailScale,
    gasCloudDetailSize,
    gasCloudVisibleRect,
    inflateRect,
    rectContains,
    renderGasCloudDetailRows,
    supernovaFillColour,
    supernovaGalaxyPx,
    supernovaPulseColour,
    systemPassRadius,
    novaFillRange,
    type RgbaImage,
} from '../src/render/stellarFx';
import { CFractal } from '../src/render/fbmNoise';
import { gasCloudDrawnPx, starDrawnPx, starSpritePx } from '../src/render/mainView';
import { gasCloudTooltipText, tooltipText } from '../src/ui/mapTooltip';
import { Habitat, HabitatCategoryType, HabitatType } from '../src/sim/types';

const MSS = 23000;

function star(type: HabitatType, diameter: number, novaProgression = 0): Habitat {
    const h = new Habitat(HabitatCategoryType.Star, type, 'S', 0, 0);
    h.diameter = diameter;
    h.novaProgression = novaProgression;
    return h;
}

function gasCloud(type: HabitatType, diameter: number, x = 0, y = 0, index = 7): Habitat {
    const h = new Habitat(HabitatCategoryType.GasCloud, type, 'AG928', x, y);
    h.diameter = diameter;
    h.habitatIndex = index;
    return h;
}

/** A small straight-alpha test bitmap: a soft disc of one colour. */
function disc(w: number, h: number): RgbaImage {
    const image = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
            const d = Math.hypot(x - w / 2, y - h / 2) / (w / 2);
            const i = (y * w + x) * 4;
            image[i] = 200;
            image[i + 1] = 150;
            image[i + 2] = 40;
            image[i + 3] = d < 1 ? Math.round(255 * (1 - d)) : 0;
        }
    return { image, width: w, height: h };
}

describe('black hole (MainView.1.cs method_76 649-722)', () => {
    it('tints by HabitatIndex % 4: [inner color_3, middle color_4, outer color_5]', () => {
        expect(blackHoleTints(0)).toEqual([0x0000d8, 0x00008a, 0x000070]);
        expect(blackHoleTints(1)).toEqual([0x54368a, 0x381e54, 0x30143c]);
        expect(blackHoleTints(6)).toEqual([0x362054, 0x26183c, 0x201430]);
        expect(blackHoleTints(4823)).toEqual([0x541e60, 0x3e1448, 0x381040]);
    });

    it('three star_blackhole_0 layers (1.0 / 0.44 / 0.2, double_4 / 5.3, / 2.3, / 1) under the 0.08x accretion frames at 15 fps', () => {
        expect(BLACK_HOLE_LAYERS.map((l) => [l.scale, l.divisor, l.tint])).toEqual([
            [1.0, 5.3, 2],
            [0.44, 2.3, 1],
            [0.2, 1, 0],
        ]);
        expect(BLACK_HOLE_FRAME_SCALE).toBe(0.08);
        expect(BLACK_HOLE_FPS).toBe(15);
        // double_4 += game seconds * 0.4.
        expect(blackHoleSpin(10_000)).toBeCloseTo(4, 10);
        expect(blackHoleSpin(0)).toBe(0);
        // (int)(int_ * factor).
        expect(blackHoleLayerPx(75, 0.44)).toBe(33);
        expect(blackHoleLayerPx(75, 0.08)).toBe(6);
    });

    it('loads BlkHole-0001 … 0100 by their fixed names (Main.Part13.cs 1144-1162)', () => {
        const urls = blackHoleFrameUrls();
        expect(urls).toHaveLength(100);
        expect(urls[0]).toBe('/assets/dwu/images/environment/stars/blackhole/BlkHole-0001.png');
        expect(urls[99]).toBe('/assets/dwu/images/environment/stars/blackhole/BlkHole-0100.png');
    });

    it('galaxy-pass picture: 2 * val3, val3 = (int)((int)(radius / f) * 2), at least 5, 11..17 below f 5100', () => {
        expect(blackHoleGalaxyPx(150.5, MSS)).toBe(34); // 152 → 304 → 17
        expect(blackHoleGalaxyPx(3000, MSS)).toBe(28); // 7 → 14
        expect(blackHoleGalaxyPx(5000, MSS)).toBe(22); // 4 → 8 → 11
        expect(blackHoleGalaxyPx(6000, MSS)).toBe(12); // 3 → 6 (no clamp above 5100)
        expect(blackHoleGalaxyPx(20000, MSS)).toBe(10); // 1 → 2 → 5
        expect(systemPassRadius(0, MSS)).toBe(MSS);
        expect(systemPassRadius(1_500_000, MSS)).toBeCloseTo(Math.pow(1_500_000, 0.35) * 600, 6);
        expect(systemPassRadius(9_000_000, MSS)).toBe(systemPassRadius(1_500_000, MSS));
    });

    it('drawn size: the layers (Diameter / f) up to f 150, the galaxy picture above', () => {
        const bh = star(HabitatType.BlackHole, 4544);
        expect(starDrawnPx(bh, 1 / 60)).toBe(starSpritePx(4544, 1 / 60));
        expect(starDrawnPx(bh, 1 / 400)).toBe(blackHoleGalaxyPx(400, MSS));
    });
});

describe('super nova', () => {
    it('galaxy-pass picture: max(8, (int)((int)(NovaProgression * 2 / f) * 1.3)), world-linear', () => {
        expect(supernovaGalaxyPx(87866, 400)).toBe(570); // 439 * 1.3
        expect(supernovaGalaxyPx(87866, 3000)).toBe(75); // 58 * 1.3
        expect(supernovaGalaxyPx(30000, 1e6)).toBe(8);
        const sn = star(HabitatType.SuperNova, 17573, 87866);
        expect(starDrawnPx(sn, 1 / 400)).toBe(570);
        // Below f 150 nothing is drawn; the pick keeps the star's Diameter box.
        expect(starDrawnPx(sn, 1 / 60)).toBe(starSpritePx(17573, 1 / 60));
    });

    it('method_29: (120,255,96,64) ↔ (160,232,160,0) on a 2 s triangle wave', () => {
        expect(supernovaPulseColour(2000)).toEqual({ a: 160, r: 232, g: 160, b: 0 }); // even second, 0 ms: t = 1
        expect(supernovaPulseColour(3000)).toEqual({ a: 120, r: 255, g: 96, b: 64 }); // odd second: ms 1000, t = 0
        expect(supernovaPulseColour(2500)).toEqual({ a: 140, r: 244, g: 128, b: 32 }); // t = 0.5
        expect(supernovaPulseColour(3500)).toEqual({ a: 140, r: 244, g: 128, b: 32 }); // ms 1500, t = 0.5
    });

    it('the location fill: channels * A / 255 * the zoom ramp, opaque', () => {
        // f 100, t = 0: (120,255,96,64), ramp = 50 / 167 + 0.35.
        const k = (120 / 255) * (50 / 167 + 0.35);
        expect(supernovaFillColour(100, 3000)).toBe((Math.trunc(255 * k) << 16) | (Math.trunc(96 * k) << 8) | Math.trunc(64 * k));
        // f 50 (< 75): ramp = (50 + 30) / 167 + 0.35.
        const k2 = (120 / 255) * (80 / 167 + 0.35);
        expect(supernovaFillColour(50, 3000) >> 16).toBe(Math.trunc(255 * k2));
        expect(novaFillRange(1600, 900, 10)).toBeCloseTo(Math.hypot(800, 450) * 10, 6);
    });

    it('NovaFill covers the view below f 150 only', () => {
        const fill = new NovaFill();
        const view = { x: -800, y: -450, w: 1600, h: 900 };
        fill.update(true, 60, view, 3000);
        expect(fill.sprite.visible).toBe(true);
        expect(fill.sprite.x).toBe(-800);
        expect(fill.sprite.width).toBeCloseTo(1600, 6);
        expect(fill.sprite.tint).toBe(supernovaFillColour(60, 3000));
        fill.update(true, NOVA_FILL_MAX_FACTOR, view, 3000);
        expect(fill.sprite.visible).toBe(false);
        fill.update(false, 60, view, 3000);
        expect(fill.sprite.visible).toBe(false);
    });
});

describe('CFractal (FbmNoise.cs)', () => {
    it('is deterministic per seed, zero on the lattice, inside ±0.99999', () => {
        const a = new CFractal(460, 0.35, 2.6);
        const b = new CFractal(460, 0.35, 2.6);
        const c = new CFractal(461, 0.35, 2.6);
        expect(a.noise(3, 4)).toBe(0);
        let differs = false;
        for (let i = 0; i < 200; i++) {
            const x = i * 0.137;
            const y = i * 0.071;
            const v = a.fBm(x, y, 6);
            expect(v).toBe(b.fBm(x, y, 6));
            expect(Math.abs(v)).toBeLessThanOrEqual(0.99999);
            if (v !== c.fBm(x, y, 6)) differs = true;
        }
        expect(differs).toBe(true);
    });

    it('uses 128 exponents lac^(-i * H) (not the decompiled 0, which would flatten fBm to 0)', () => {
        const f = new CFractal(3, 0.35, 2.6);
        let nonZero = 0;
        for (let i = 0; i < 50; i++) if (f.fBm(0.3 + i * 0.21, 0.6 + i * 0.13, 6) !== 0) nonZero++;
        expect(nonZero).toBeGreaterThan(40);
    });
});

describe('gas cloud (MainView.1.cs method_135 / 136, MainView.2.cs method_146)', () => {
    it('colour scheme 20 + method_135 by type, size min(100, Diameter)', () => {
        expect(gasCloudColorScheme(HabitatType.Hydrogen)).toBe(6);
        expect(gasCloudColorScheme(HabitatType.Helium)).toBe(0);
        expect(gasCloudColorScheme(HabitatType.Argon)).toBe(2);
        expect(gasCloudColorScheme(HabitatType.Ammonia)).toBe(4);
        expect(gasCloudColorScheme(HabitatType.CarbonDioxide)).toBe(7);
        expect(gasCloudColorScheme(HabitatType.Oxygen)).toBe(1);
        expect(gasCloudColorScheme(HabitatType.NitrogenOxygen)).toBe(3);
        expect(gasCloudColorScheme(HabitatType.Chlorine)).toBe(5);
        expect(gasCloudBitmapSize(16351)).toBe(100);
        expect(gasCloudBitmapSize(80)).toBe(80);
    });

    it('detail scale min(10, 400 / width), at least 1; output at most 2000 px', () => {
        expect(gasCloudDetailScale(285)).toBeCloseTo(400 / 285, 10);
        expect(gasCloudDetailScale(20)).toBe(10);
        expect(gasCloudDetailScale(800)).toBe(1);
        expect(gasCloudDetailSize({ x: 0, y: 0, w: 285, h: 280 }, 400 / 285)).toEqual({ w: 400, h: 392 });
        expect(gasCloudDetailSize({ x: 0, y: 0, w: 300, h: 300 }, 10)).toEqual({ w: 2000, h: 2000 });
    });

    it('visible rect in bitmap px; inflate about the centre; clip to the bitmap', () => {
        const c = gasCloud(HabitatType.Hydrogen, 20000, 0, 0);
        // The cloud spans -10000..10000; a view over its right half.
        const r = gasCloudVisibleRect(c, 200, 200, { x: 0, y: -10000, w: 50000, h: 20000 })!;
        expect(r).toEqual({ x: 100, y: 0, w: 100, h: 200 });
        expect(gasCloudVisibleRect(c, 200, 200, { x: 20000, y: 0, w: 100, h: 100 })).toBeNull();
        expect(inflateRect({ x: 10, y: 10, w: 20, h: 10 }, 2)).toEqual({ x: 0, y: 5, w: 40, h: 20 });
        expect(clipRect({ x: -5, y: 190, w: 30, h: 30 }, 200, 200)).toEqual({ x: 0, y: 190, w: 25, h: 10 });
        expect(rectContains({ x: 0, y: 0, w: 10, h: 10 }, { x: 2, y: 2, w: 8, h: 8 })).toBe(true);
        expect(rectContains({ x: 0, y: 0, w: 10, h: 10 }, { x: 2, y: 2, w: 9, h: 8 })).toBe(false);
    });

    it('FbmImageTransparent: alpha * (fBm(10 x / W, 10 y / W, 6) + 1) / 2 on the up-scaled bitmap', () => {
        const base = disc(40, 40);
        const fractal = new CFractal(7, 0.35, 2.6);
        const out = new Uint8ClampedArray(40 * 40 * 4);
        renderGasCloudDetailRows(base, { x: 0, y: 0, w: 40, h: 40 }, 1, fractal, out, 40, 0, 40);
        for (const [x, y] of [
            [20, 20],
            [12, 25],
            [30, 9],
        ]) {
            const i = (y * 40 + x) * 4;
            const n = fractal.fBm((x * 10) / 40, (y * 10) / 40, 6);
            expect(out[i + 3]).toBe(Math.trunc(base.image[i + 3] * ((n + 1) / 2)));
            expect(out[i]).toBe(200);
        }
        // Outside the disc stays transparent.
        expect(out[3]).toBe(0);
        // A magnified patch samples the same field: its pixel (0,0) of src (10, 10) at scale 4 is fBm(2.5, 2.5).
        const patch = new Uint8ClampedArray(20 * 20 * 4);
        renderGasCloudDetailRows(base, { x: 10, y: 10, w: 5, h: 5 }, 4, fractal, patch, 20, 0, 20);
        const n0 = fractal.fBm(2.5, 2.5, 6);
        expect(patch[3]).toBeLessThanOrEqual(Math.trunc(255 * ((n0 + 1) / 2)) + 1);
    });

    it('GasCloudDetailJob is time-sliced and finishes with a texture', () => {
        const job = new GasCloudDetailJob(disc(40, 40), { x: 0, y: 0, w: 40, h: 40 }, 2, new CFractal(1, 0.35, 2.6));
        let t = 0;
        const clock = (): number => (t += 1);
        // 1 ms per check: one 8-row band per step with a 1 ms budget.
        expect(job.step(1, clock)).toBeNull();
        expect(job.done).toBe(false);
        let tex = null;
        for (let i = 0; i < 20 && tex === null; i++) tex = job.step(1, clock);
        expect(tex).not.toBeNull();
        expect(tex!.width).toBe(80);
        expect(tex!.height).toBe(80);
        tex!.destroy(true);
    });

    it('GasCloudView draws only below f 500 and on screen, generates once, honours the frame budget', () => {
        let calls = 0;
        const cloud = gasCloud(HabitatType.Hydrogen, 16000, 0, 0, 11);
        const view = new GasCloudView(cloud, () => {
            calls++;
            return disc(60, 60);
        });
        const onView = { x: -8000, y: -4500, w: 16000, h: 9000 };
        view.update(600, onView, { ms: 100, generations: 1 });
        expect(view.root.visible).toBe(false);
        expect(calls).toBe(0);
        view.update(100, onView, { ms: 100, generations: 0 });
        expect(calls).toBe(0);
        view.update(100, { x: 500000, y: 0, w: 100, h: 100 }, { ms: 100, generations: 1 });
        expect(calls).toBe(0);
        for (let i = 0; i < 5; i++) view.update(100, onView, { ms: 100, generations: 1 });
        expect(calls).toBe(1);
        expect(view.root.visible).toBe(true);
        expect(view.hasArt).toBe(true);
        view.release();
        expect(view.hasArt).toBe(false);
    });

    it('drawn size: the cloud (Diameter) below f 500, the cross above f 150', () => {
        const c = gasCloud(HabitatType.Hydrogen, 16351);
        expect(gasCloudDrawnPx(c, 1 / 60)).toBeCloseTo(16351 / 60, 6);
        expect(gasCloudDrawnPx(c, 1 / 3000)).toBeGreaterThan(0);
        expect(gasCloudDrawnPx(c, 1 / 3000)).toBeLessThan(30);
    });

    it('hover text as HoverPanel.cs method_3: name + "<Type> Gas Cloud", or "(Unexplored Gas Cloud)"', () => {
        expect(gasCloudTooltipText(gasCloud(HabitatType.NitrogenOxygen, 9000), true)).toBe('AG928\nNitrogen Oxygen Gas Cloud');
        expect(gasCloudTooltipText(gasCloud(HabitatType.Hydrogen, 9000), false)).toBe('(Unexplored Gas Cloud)');
        expect(tooltipText(gasCloud(HabitatType.CarbonDioxide, 9000), 'AG928', true)).toBe('AG928\nCarbon Dioxide Gas Cloud');
    });
});
