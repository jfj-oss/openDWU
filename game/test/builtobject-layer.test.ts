// Task 13a: unit tests for the built-object layer's pure functions. No jsdom —
// everything here is plain maths over the image-index table, the minor-ship
// stand-in and the crop/content-size metrics (src/render/builtObjectLayer.ts).
import { describe, expect, it } from 'vitest';
import {
    BUILT_OBJECT_MAX_FACTOR,
    BUILT_OBJECT_DRAW_RESIZE_FACTOR,
    SHIP_SET_FILES,
    STANDARD_FAMILY_COUNT,
    STANDARD_SHIP_IMAGE_START_INDEX,
    SHIP_SET_IMAGE_COUNT,
    builtObjectImagePath,
    builtObjectImageUrl,
    builtObjectSizePx,
    resolveDrawPictureRef,
    shipImageMetrics,
} from '../src/render/builtObjectLayer';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { DesignImageScalingMode } from '../src/sim/data/designSpecifications';

describe('constants', () => {
    it('match the original values', () => {
        expect(BUILT_OBJECT_DRAW_RESIZE_FACTOR).toBe(8.0);
        expect(BUILT_OBJECT_MAX_FACTOR).toBe(500);
        expect(STANDARD_SHIP_IMAGE_START_INDEX).toBe(72);
        expect(SHIP_SET_IMAGE_COUNT).toBe(24);
        expect(STANDARD_FAMILY_COUNT).toBe(27);
        expect(SHIP_SET_FILES).toHaveLength(24);
        expect(SHIP_SET_FILES[0]).toBe('escort');
        expect(SHIP_SET_FILES[23]).toBe('genericbase');
    });
});

describe('builtObjectImagePath', () => {
    it('maps pictureRef to the install-relative path', () => {
        expect(builtObjectImagePath(0)).toBe('other/planetdestroyer.png');
        expect(builtObjectImagePath(1)).toBe('other/MinorSets/bases/base_0.png');
        expect(builtObjectImagePath(2)).toBe('other/MinorSets/bases/base_1.png');
        // Minor military sets: family j = floor((p-3)/4), slot (p-3)%4.
        expect(builtObjectImagePath(3)).toBe('other/MinorSets/family0/military_small.png');
        expect(builtObjectImagePath(9)).toBe('other/MinorSets/family1/military_large.png');
        expect(builtObjectImagePath(30)).toBe('other/MinorSets/family6/colonyship.png');
        // Major sets: Shakturi first.
        expect(builtObjectImagePath(31)).toBe('other/MajorSets/Shakturi/frigate.png');
        expect(builtObjectImagePath(37)).toBe('other/MajorSets/Shakturi/base_1.png');
        expect(builtObjectImagePath(58)).toBe('other/MajorSets/FreedomAlliance/base_1.png');
        // FreedomAlliance aged variants.
        expect(builtObjectImagePath(59)).toBe('other/MajorSets/FreedomAlliance/aged/frigate.png');
        expect(builtObjectImagePath(63)).toBe('other/MajorSets/FreedomAlliance/aged/trooptransport.png');
        // Phantom pirates.
        expect(builtObjectImagePath(64)).toBe('other/MajorSets/PhantomPirates/escort.png');
        expect(builtObjectImagePath(71)).toBe('other/MajorSets/PhantomPirates/homebase.png');
        // Standard families: 72 + N*24 + slot.
        expect(builtObjectImagePath(72)).toBe('family0/escort.png');
        expect(builtObjectImagePath(72 + 24 * 3 + 19)).toBe('family3/smallspaceport.png');
        expect(builtObjectImagePath(72 + 26 * 24 + 23)).toBe('family26/genericbase.png');
    });

    it('returns null for negative indices and missing families', () => {
        expect(builtObjectImagePath(-1)).toBeNull();
        expect(builtObjectImagePath(STANDARD_SHIP_IMAGE_START_INDEX + STANDARD_FAMILY_COUNT * SHIP_SET_IMAGE_COUNT)).toBeNull();
    });
});

describe('builtObjectImageUrl', () => {
    it('prefixes the /assets/dwu/images/units/ships/ URL', () => {
        expect(builtObjectImageUrl(0)).toBe('/assets/dwu/images/units/ships/other/planetdestroyer.png');
        expect(builtObjectImageUrl(72)).toBe('/assets/dwu/images/units/ships/family0/escort.png');
        expect(builtObjectImageUrl(-1)).toBeNull();
    });
});

describe('resolveDrawPictureRef', () => {
    const base = {
        isPlanetDestroyer: false,
        subRole: BuiltObjectSubRole.Undefined as BuiltObjectSubRole,
        builtObjectID: 0,
    };

    it('keeps an explicit pictureRef', () => {
        expect(resolveDrawPictureRef({ ...base, pictureRef: 100 })).toBe(100);
    });

    it('keeps pictureRef 0 for planet destroyers', () => {
        expect(resolveDrawPictureRef({ ...base, pictureRef: 0, isPlanetDestroyer: true })).toBe(0);
    });

    it('stands in bases with one of the two minor base images', () => {
        // SmallSpacePort, ID 5 → 1 + (5 % 2) = 2.
        expect(resolveDrawPictureRef({ ...base, pictureRef: 0, subRole: BuiltObjectSubRole.SmallSpacePort, builtObjectID: 5 })).toBe(2);
        // MiningStation, even ID → 1.
        expect(resolveDrawPictureRef({ ...base, pictureRef: 0, subRole: BuiltObjectSubRole.MiningStation, builtObjectID: 4 })).toBe(1);
    });

    it('stands in minor ships per the ResolveMinorShipImageIndex table', () => {
        // Frigate num2 = 1, ID 9 → 3 + (9 % 7) * 4 + 1 = 12.
        expect(resolveDrawPictureRef({ ...base, pictureRef: 0, subRole: BuiltObjectSubRole.Frigate, builtObjectID: 9 })).toBe(12);
        // Escort num2 = 0, ID 7 → 3 + 0 * 4 + 0 = 3.
        expect(resolveDrawPictureRef({ ...base, pictureRef: 0, subRole: BuiltObjectSubRole.Escort, builtObjectID: 7 })).toBe(3);
        // ColonyShip num2 = 3, ID 8 → 3 + 1 * 4 + 3 = 10.
        expect(resolveDrawPictureRef({ ...base, pictureRef: 0, subRole: BuiltObjectSubRole.ColonyShip, builtObjectID: 8 })).toBe(10);
        // Negative IDs use their absolute value.
        expect(resolveDrawPictureRef({ ...base, pictureRef: 0, subRole: BuiltObjectSubRole.Frigate, builtObjectID: -9 })).toBe(12);
    });
});

describe('shipImageMetrics', () => {
    function makeRgba(w: number, h: number): Uint8ClampedArray {
        return new Uint8ClampedArray(w * h * 4);
    }

    function setPixel(rgba: Uint8ClampedArray, w: number, x: number, y: number, r: number, g: number, b: number, a: number): void {
        const i = (y * w + x) * 4;
        rgba[i] = r;
        rgba[i + 1] = g;
        rgba[i + 2] = b;
        rgba[i + 3] = a;
    }

    it('measures the content bbox, padded square and area ratio', () => {
        const w = 10;
        const h = 10;
        const rgba = makeRgba(w, h);
        // Opaque red at x 2..5, y 3..4 (8 content pixels).
        for (let y = 3; y <= 4; y++) {
            for (let x = 2; x <= 5; x++) {
                setPixel(rgba, w, x, y, 255, 0, 0, 255);
            }
        }
        // Opaque black is not content; transparent white is not content either.
        setPixel(rgba, w, 8, 8, 0, 0, 0, 255);
        setPixel(rgba, w, 0, 0, 255, 255, 255, 0);

        const m = shipImageMetrics(rgba, w, h);
        expect(m).not.toBeNull();
        // BuiltObjectImageCache.cs CropImageContent: padded bbox x -2..9,
        // y -1..8 (num9 = 11, num8 = 9), squared about it into
        // new Bitmap(num11 - num10 + 1, ...) → side 12, rect (-2, -2).
        expect(m!.cropSide).toBe(12);
        // DetermineBuiltObjectSizeNEW num3: crop area / content count = 144 / 8.
        expect(m!.areaRatio).toBeCloseTo(18, 10);
        expect(m!.cropCenterX).toBe(4);
        expect(m!.cropCenterY).toBe(4);
    });

    it('squares a tall bbox with the C# integer centring', () => {
        const w = 10;
        const h = 10;
        const rgba = makeRgba(w, h);
        // A 1×6 column at x 4, y 1..6.
        for (let y = 1; y <= 6; y++) setPixel(rgba, w, 4, y, 200, 200, 200, 255);
        const m = shipImageMetrics(rgba, w, h)!;
        // num8 = 13 > num9 = 8: num10 = 0 + 8/2 - 13/2 = -2, num12 = -3, side 14.
        expect(m.cropSide).toBe(14);
        expect(m.areaRatio).toBeCloseTo(196 / 6, 10);
        expect(m.cropCenterX).toBe(5);
        expect(m.cropCenterY).toBe(4);
    });

    it('returns null when the image has no content pixels', () => {
        expect(shipImageMetrics(makeRgba(4, 4), 4, 4)).toBeNull();
    });
});

describe('builtObjectSizePx', () => {
    const none = DesignImageScalingMode.None;

    it('ports DetermineBuiltObjectSizeNEW (None scaling)', () => {
        // sqrt(size * areaRatio * 8 / f²), truncated.
        expect(builtObjectSizePx(300, 2, 1, none, 1)).toBe(69);
        expect(builtObjectSizePx(300, 2, 3, none, 1)).toBe(23);
        expect(builtObjectSizePx(300, 2, 10, none, 1)).toBe(6);
        expect(builtObjectSizePx(0, 2, 1, none, 1)).toBe(0);
    });

    it('Absolute scaling: factor / f', () => {
        expect(builtObjectSizePx(300, 2, 2, DesignImageScalingMode.Absolute, 40)).toBe(20);
    });

    it('Scaled scaling multiplies the base size', () => {
        expect(builtObjectSizePx(300, 2, 1, DesignImageScalingMode.Scaled, 1.5)).toBe(103);
    });
});