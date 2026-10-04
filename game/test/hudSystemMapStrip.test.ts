// The HUD system map's zoom strip, zoom handlers and frame scale (hudSystemMap.ts, hud.ts systemMapFrameScale).
import { describe, expect, it } from 'vitest';
import { Camera } from '../src/render/camera';
import {
    applySystemMapZoom,
    SYSTEM_MAP_BUTTONS,
    SYSTEM_MAP_PANEL,
    SYSTEM_MAP_SMALL_SCALE,
    SYSTEM_MAP_STRIP,
    systemMapSizeHint,
    ZOOM_FACTOR_MAX,
    zoomInFactor,
    zoomOutFactor,
} from '../src/ui/hudSystemMap';
import { SELECTION_FRAME, selectionFrameScale, selectionViewTarget, setSelection, systemMapFrameScale, zoomToSelectedItem } from '../src/ui/hud';
import type { Habitat, SystemInfo } from '../src/sim/types';
import type { BuiltObject } from '../src/sim/builtObject';

describe('pnlSystemMap zoom strip (Main.Part12.cs 2106-2122)', () => {
    it('places the buttons 13 px left of the panel from 4 px below its top, every 30 px', () => {
        // Panel at (W - 340, H - 300); buttons at x W - (280 + 56 + 17), y H - (290 + 7) + 1 + 30 i.
        const W = 1920;
        const H = 1080;
        expect(W - (280 + 56 + 17) - (W - 340)).toBe(SYSTEM_MAP_STRIP.x);
        expect(H - (290 + 7) + 1 - (H - 300)).toBe(SYSTEM_MAP_STRIP.y);
        expect(SYSTEM_MAP_BUTTONS.map((b) => b.name)).toEqual([
            'btnZoomSelection',
            'btnZoomIn',
            'btnZoomOut',
            'btnZoomColony',
            'btnZoomSystem',
            'btnZoomSector',
            'btnZoomRegion',
            'btnSystemMapSize',
            'tbtnGalaxyMap',
        ]);
        SYSTEM_MAP_BUTTONS.forEach((b, i) => expect(b.y).toBe(4 + 30 * i));
        const gm = SYSTEM_MAP_BUTTONS[8];
        expect(gm.h).toBe(40);
        expect(gm.y + gm.h).toBeLessThanOrEqual(SYSTEM_MAP_PANEL.h);
        // The strip ends 2 px before picSystem (x 45).
        expect(SYSTEM_MAP_STRIP.x + SYSTEM_MAP_STRIP.w).toBe(43);
        expect(systemMapSizeHint(false)).toBe('Shrink System Map');
        expect(systemMapSizeHint(true)).toBe('Enlarge System Map');
    });
});

describe('zoom buttons (Main.Part8.cs btnZoomIn_Click / btnZoomOut_Click, Main.Part9.cs 3180-3202)', () => {
    it('steps the zoom factor by MainViewZoomSpeed percent with the original clamps', () => {
        expect(zoomInFactor(100, 12)).toBeCloseTo(88);
        expect(zoomOutFactor(100, 12)).toBeCloseTo(112);
        expect(zoomInFactor(0.26, 50)).toBe(0.25);
        expect(zoomInFactor(20000, 1)).toBe(10000);
        expect(zoomOutFactor(14000, 50)).toBe(ZOOM_FACTOR_MAX);
    });
    it('sets the level factors about the view centre', () => {
        const cam = new Camera();
        cam.setViewport(1000, 1000);
        cam.minZoom = 1e-7;
        cam.centerOn(500, 500);
        for (const [action, factor] of [['zoomColony', 1], ['zoomSystem', 50], ['zoomSector', 3000], ['zoomRegion', 15000]] as const) {
            expect(applySystemMapZoom(cam, action, 12)).toBe(true);
            expect(1 / cam.zoom).toBeCloseTo(factor);
            expect(cam.x).toBeCloseTo(500);
        }
        cam.zoom = 1 / 100;
        applySystemMapZoom(cam, 'zoomIn', 12);
        expect(1 / cam.zoom).toBeCloseTo(88);
        applySystemMapZoom(cam, 'zoomOut', 12);
        expect(1 / cam.zoom).toBeCloseTo(98.56);
        expect(applySystemMapZoom(cam, 'galaxyMap', 12)).toBe(false);
    });
    it('btnZoomSelection_Click: moves to the selection and zooms to 100 %', () => {
        const cam = new Camera();
        cam.setViewport(1000, 1000);
        cam.zoom = 1 / 50;
        setSelection(null);
        expect(zoomToSelectedItem(cam)).toBe(false);
        expect(cam.zoom).toBeCloseTo(1 / 50);
        const habitat = { xpos: 10, ypos: 20 } as unknown as Habitat;
        const ship = { xpos: 300, ypos: -40 } as unknown as BuiltObject;
        setSelection({ habitat, system: {} as SystemInfo, builtObject: ship });
        expect(selectionViewTarget({ habitat, system: {} as SystemInfo, builtObject: ship })).toEqual({ x: 300, y: -40 });
        expect(zoomToSelectedItem(cam)).toBe(true);
        expect(cam.x).toBe(300);
        expect(cam.y).toBe(-40);
        expect(cam.zoom).toBe(1);
        setSelection(null);
    });
});

describe('systemMapFrameScale', () => {
    it('matches the selection frame scale, shrinks in the small size and never overlaps the selection frame', () => {
        for (const [w, h] of [[1920, 1080], [1280, 720], [3840, 2160]] as const) {
            const sel = selectionFrameScale(h, 1, false);
            expect(systemMapFrameScale(w, h, 1, false, sel)).toBeCloseTo(sel);
            expect(systemMapFrameScale(w, h, 1, true, sel)).toBeCloseTo(sel * SYSTEM_MAP_SMALL_SCALE);
        }
        // A narrow window: the map with its strip stays 10 px clear of the selection frame.
        const w = 700;
        const h = 1080;
        const sel = selectionFrameScale(h, 1, false);
        const k = systemMapFrameScale(w, h, 1, false, sel);
        const mapLeft = w - 10 - (SYSTEM_MAP_PANEL.w - SYSTEM_MAP_STRIP.x) * k;
        expect(mapLeft).toBeGreaterThanOrEqual(10 + SELECTION_FRAME.w * sel + 10 - 1e-9);
    });
});
