// Fighters (src/render/fighterLayer.ts), fighter combat effects (effectsLayer.ts) and the ship-art marker paint-out
// (shipArt.ts): pure parts only.
import { describe, expect, it } from 'vitest';
import { paintOutShipMarkers } from '../src/render/shipArt';
import { MAX_MARKERS, scanShipMarkers } from '../src/render/ambientLayer';
import { shipImageMetrics } from '../src/render/builtObjectLayer';
import {
    FIGHTER_IMAGE_COUNT,
    fighterExhaustIndex,
    fighterExhaustLengthPx,
    fighterImageUrl,
    fighterSizePx,
    fightersVisibleAt,
    resolveFighterPictureRef,
} from '../src/render/fighterLayer';
import { WeaponArt, WeaponDrawKind, fighterWeaponAlpha, fighterWeaponDrawCommand, newWeaponDraw } from '../src/render/effectsLayer';
import { ComponentCategoryType } from '../src/sim/data/policies';
import { ComponentType } from '../src/sim/data/components';

const W = 40;

// A 40x40 raw image, ship facing up (-y): opaque grey hull x 10..29, y 5..34, a pure-blue thruster line at y = 34,
// x 18..21 (x = 21 half transparent), and two pure-yellow lights at (10, 15) and (29, 15).
function makeShip(): Uint8ClampedArray {
    const px = new Uint8ClampedArray(W * W * 4);
    for (let y = 5; y <= 34; y++) for (let x = 10; x <= 29; x++) set(px, x, y, 128, 128, 128, 255);
    for (let x = 18; x <= 21; x++) set(px, x, 34, 0, 0, 255, x === 21 ? 128 : 255);
    set(px, 10, 15, 255, 255, 0, 255);
    set(px, 29, 15, 255, 255, 0, 255);
    // Distinct neighbours of the (10, 15) light so the mean is visible: above red-ish, below blue-ish.
    set(px, 10, 14, 200, 100, 0, 255);
    set(px, 10, 16, 0, 100, 200, 255);
    return px;
}

function set(px: Uint8ClampedArray, x: number, y: number, r: number, g: number, b: number, a: number): void {
    const i = (y * W + x) * 4;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = a;
}

function get(px: ArrayLike<number>, x: number, y: number): number[] {
    const i = (y * W + x) * 4;
    return [px[i], px[i + 1], px[i + 2], px[i + 3]];
}

describe('ship-art marker paint-out (BuiltObjectImageCache ScanForThrusterLocations / ScanForColorPoints)', () => {
    it('replaces thruster pixels with the mean of their rotated-frame left/right (raw below/above) neighbours', () => {
        const raw = makeShip();
        const m = shipImageMetrics(raw, W, W)!;
        const mk = scanShipMarkers(raw, W, W, m);
        const out = paintOutShipMarkers(raw, W, W, m, mk, true);
        // Above: grey hull (128,128,128,255); below: transparent (0,0,0,0) → integer mean per channel.
        for (let x = 18; x <= 21; x++) expect(get(out, x, 34)).toEqual([64, 64, 64, 127]);
        // Lights: mean of the raw pixels above and below.
        expect(get(out, 10, 15)).toEqual([100, 100, 100, 255]);
        expect(get(out, 29, 15)).toEqual([128, 128, 128, 255]);
        // Nothing else changes, and the raw input is untouched.
        expect(get(out, 15, 20)).toEqual([128, 128, 128, 255]);
        expect(get(raw, 18, 34)).toEqual([0, 0, 255, 255]);
    });

    it('the marker scan still reads the raw image (incl. semi-transparent marks); the cleaned art has none', () => {
        const raw = makeShip();
        const m = shipImageMetrics(raw, W, W)!;
        const mk = scanShipMarkers(raw, W, W, m);
        expect(mk.thrusters.length).toBe(1);
        // The half-transparent x = 21 pixel matches too (FastBitmap un-premultiplies it back to pure blue).
        expect(mk.thrusters[0].height).toBe(4);
        expect(mk.lights.length).toBe(2);
        const out = paintOutShipMarkers(raw, W, W, m, mk, true);
        const again = scanShipMarkers(out, W, W, m);
        expect(again.thrusters.length).toBe(0);
        expect(again.lights.length).toBe(0);
    });

    it('fighter art (method_101) paints out thrusters only', () => {
        const raw = makeShip();
        const m = shipImageMetrics(raw, W, W)!;
        const out = paintOutShipMarkers(raw, W, W, m, scanShipMarkers(raw, W, W, m), false);
        expect(get(out, 18, 34)).toEqual([64, 64, 64, 127]);
        expect(get(out, 10, 15)).toEqual([255, 255, 0, 255]);
    });

    it('leaves a list that hit the 20-marker cap unreplaced (the C# returns before SetPixel)', () => {
        const raw = makeShip();
        // 20 separate thruster runs: every other raw row 6..32 plus x = 12 marks (rotated columns).
        for (let i = 0; i < MAX_MARKERS; i++) set(raw, 12 + (i % 2) * 4, 6 + Math.floor(i / 2) * 2, 0, 0, 255, 255);
        const m = shipImageMetrics(raw, W, W)!;
        const mk = scanShipMarkers(raw, W, W, m);
        expect(mk.thrusters.length).toBe(MAX_MARKERS);
        const out = paintOutShipMarkers(raw, W, W, m, mk, true);
        expect(get(out, 18, 34)).toEqual([0, 0, 255, 255]);
        // The light list is under its cap, so lights are still painted out.
        expect(get(out, 29, 15)).toEqual([128, 128, 128, 255]);
    });

    it('samples the crop edge from the neighbour inside (x = 0 uses x = 1 twice)', () => {
        // A mark on the raw bottom content row with padding keeps it off the edge; force the edge by a marker-only
        // image: a single blue pixel is its own content, cropped with 4 px padding, so both neighbours are
        // transparent padding.
        const raw = new Uint8ClampedArray(W * W * 4);
        set(raw, 20, 20, 0, 0, 255, 255);
        const m = shipImageMetrics(raw, W, W)!;
        const out = paintOutShipMarkers(raw, W, W, m, scanShipMarkers(raw, W, W, m), true);
        expect(get(out, 20, 20)).toEqual([0, 0, 0, 0]);
    });
});

describe('fighter sprites (MainView.1.cs kgxRubsAau3 / DetermineBuiltObjectSize)', () => {
    it('sizes a fighter sqrt(areaRatio x 8 x trunc(size / f^2)) px, at least 1', () => {
        // Size 10, crop area / content 3: f = 1 → sqrt(240) = 15 px; f = 2 → trunc(2.5) = 2 → sqrt(48) = 6 px.
        expect(fighterSizePx(10, 3, 1)).toBe(15);
        expect(fighterSizePx(10, 3, 2)).toBe(6);
        expect(fighterSizePx(10, 3, 0.5)).toBe(30);
        // Zoomed in further the fighter grows with 1 / f.
        expect(fighterSizePx(10, 3, 0.25)).toBe(61);
    });

    it('drops to the 1 px minimum once f^2 exceeds the fighter size (the LOD where fighters vanish)', () => {
        expect(fighterSizePx(10, 3, 3)).toBeGreaterThan(1);
        expect(fighterSizePx(10, 3, 3.2)).toBe(1);
        expect(fighterSizePx(10, 3, 50)).toBe(1);
        expect(fightersVisibleAt(499)).toBe(true);
        expect(fightersVisibleAt(500)).toBe(false);
    });

    it('maps PictureRef to family<N>/fighter|bomber and falls back to the race family fighter', () => {
        expect(fighterImageUrl(0)).toBe('/assets/dwu/images/units/ships/family0/fighter.png');
        expect(fighterImageUrl(7)).toBe('/assets/dwu/images/units/ships/family3/bomber.png');
        expect(fighterImageUrl(FIGHTER_IMAGE_COUNT)).toBeNull();
        expect(fighterImageUrl(-1)).toBeNull();
        expect(resolveFighterPictureRef(9, 2)).toBe(9);
        expect(resolveFighterPictureRef(-1, 5)).toBe(10);
        expect(resolveFighterPictureRef(FIGHTER_IMAGE_COUNT + 3, null)).toBe(0);
    });

    it('sizes the exhaust 0.25 x the image width x the speed step, even (PrepareEngineExhaust(Fighter))', () => {
        expect(fighterExhaustLengthPx(20, 0, 100)).toBe(0);
        expect(fighterExhaustLengthPx(20, 25, 100)).toBe(6); // 5 → 6
        expect(fighterExhaustLengthPx(20, 50, 100)).toBe(8); // trunc(8.5)
        expect(fighterExhaustLengthPx(20, 100, 100)).toBe(12); // trunc(12.5)
        expect(fighterExhaustLengthPx(20, 101, 100)).toBe(0);
        expect(fighterExhaustIndex(3)).toBe(3);
        expect(fighterExhaustIndex(9)).toBe(0);
    });
});

describe('fighter weapons (MainView.2.cs method_165 / method_156)', () => {
    const base = { power: 8, heading: 0.5, x: 110, y: 100, lastFired: 1000, range: 200, rawDamage: 16 };

    it('fades beams after 75 % of range and torpedoes after 60 %', () => {
        expect(fighterWeaponAlpha(ComponentCategoryType.WeaponBeam, 100, 200)).toBe(1);
        expect(fighterWeaponAlpha(ComponentCategoryType.WeaponBeam, 175, 200)).toBeCloseTo(Math.trunc(0.5 * 255) / 255);
        expect(fighterWeaponAlpha(ComponentCategoryType.WeaponTorpedo, 160, 200)).toBeCloseTo(Math.trunc(0.5 * 255) / 255);
        expect(fighterWeaponAlpha(ComponentCategoryType.WeaponTorpedo, 200, 200)).toBe(0);
    });

    it('draws a beam as a bolt min(300, 10 sqrt(damage)) px long, squeezed across near the fighter', () => {
        const out = newWeaponDraw();
        const w = { ...base, distanceTravelled: 10, category: ComponentCategoryType.WeaponBeam, type: ComponentType.WeaponBeam };
        expect(fighterWeaponDrawCommand(w, { xpos: 100, ypos: 100 }, 4, 1, 2000, out)).toBe(WeaponDrawKind.Bolt);
        expect(out.art).toBe(WeaponArt.Beam);
        expect(out.artIndex).toBe(4);
        expect(out.alongPx).toBe(40);
        expect(out.across).toBeCloseTo(40 / (40 / 10));
        expect(out.rotation).toBe(0.5);
        // Far from the fighter it is square; out-of-range image index → 0.
        fighterWeaponDrawCommand({ ...w, x: 300 }, { xpos: 100, ypos: 100 }, 99, 2, 2000, out);
        expect(out.alongPx).toBe(20);
        expect(out.across).toBe(20);
        expect(out.artIndex).toBe(0);
    });

    it('draws a torpedo spinning at pi rad/s and a missile along its heading, capped at 18 px', () => {
        const out = newWeaponDraw();
        const t = { ...base, distanceTravelled: 10, category: ComponentCategoryType.WeaponTorpedo, type: ComponentType.WeaponTorpedo };
        expect(fighterWeaponDrawCommand(t, { xpos: 0, ypos: 0 }, 1, 1, 3000, out)).toBe(WeaponDrawKind.Projectile);
        expect(out.alongPx).toBe(8 / 4 + 7);
        expect(out.rotation).toBeCloseTo(2 * Math.PI);
        const mi = { ...t, type: ComponentType.WeaponMissile };
        fighterWeaponDrawCommand(mi, { xpos: 0, ypos: 0 }, 1, 1, 3000, out);
        expect(out.alongPx).toBe(18); // 8 / 0.6 + 5 = 18.33 → 18
        expect(out.rotation).toBe(0.5);
        // At least 1 px when zoomed far out.
        fighterWeaponDrawCommand(mi, { xpos: 0, ypos: 0 }, 1, 100, 3000, out);
        expect(out.alongPx).toBe(1);
    });

    it('draws nothing for a weapon not in flight or of another category', () => {
        const out = newWeaponDraw();
        const w = { ...base, distanceTravelled: -1, category: ComponentCategoryType.WeaponBeam, type: ComponentType.WeaponBeam };
        expect(fighterWeaponDrawCommand(w, { xpos: 0, ypos: 0 }, 0, 1, 0, out)).toBe(WeaponDrawKind.None);
        const area = { ...w, distanceTravelled: 5, category: ComponentCategoryType.WeaponArea };
        expect(fighterWeaponDrawCommand(area, { xpos: 0, ypos: 0 }, 0, 1, 0, out)).toBe(WeaponDrawKind.None);
    });
});
