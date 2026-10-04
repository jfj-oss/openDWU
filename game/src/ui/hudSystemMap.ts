// The HUD's system mini-map: port of the original's bottom-right pnlSystemMap / picSystem and the zoom buttons laid
// over its left edge (Main.Part12.cs MainInit 2099-2134):
//   pnlSystemMap  BorderPanel 330 × 290 at (mainView.Width - 340, mainView.Height - 300): BackColor (48, 48, 64), the
//                 Main.resx BackgroundImage tiled (a 20 × 12 bitmap of alternating 1 px rows (21, 21, 21) / (34, 34, 34)),
//                 the 3 px bevel of BorderPanel.OnPaint (BorderColor1-4, alpha 96) — Main.InitializeComponent.cs 6863-6874,
//                 DistantWorlds.Controls BorderPanel.cs;
//   picSystem     SystemView 280 × 280 at (45, 5), black (Main.InitializeComponent.cs 6875-6891);
//   zoom strip    GlassButtons 56 × 28 at x = mainView.Width - (picSystem.Width + 56 + 17), i.e. 13 px left of the
//                 panel, from y num6 = mainView.Height - (pnlSystemMap.Height + 7) + 1 (4 px below the panel's top) every
//                 30 px: btnZoomSelection, btnZoomIn, btnZoomOut, btnZoomColony, btnZoomSystem, btnZoomSector
//                 (jQaYpdpkDs), btnZoomRegion, then tbtnGalaxyMap 56 × 40 at num6 + 240; corner curves on the left only,
//                 ClipBackground + IntensifyColors (Main.Part12.cs 1853-1870); images from LoadUiChromeButtons
//                 (Main.Part12.cs 446, 519-525: images/ui/chrome/zoom*.png when present, else the Main.resx images —
//                 the install's chrome folder has no zoom*.png, so the resx ones; galaxyMapButton.png from chrome).
// The empty 30 px slot at num6 + 210 holds our size toggle (the bottom-left frame's btnSelectionPanelSize image); the
// original has one size only (MainInit always sets 330 × 290), so the small size is the same frame drawn at
// SYSTEM_MAP_SMALL_SCALE. The overlay buttons the original puts in a row 29 px above the panel (btnMapCivilianFade,
// btnMapOverlay1-8, Main.Part12.cs 2135-2199) live in our "View" popup (hud.ts buildOptionsPopup) right above it.
//
// picSystem.Ignite(relativeToView: true, int_28, int_35, drawViewIndicator: true, erasePrevious: true,
// showIndicatorLines: false, "") with ShowFleetPostures / ShowBuiltObjects (Main.Part11.cs 563 / 583; Main.Part12.cs
// 2236 int_35 = Galaxy.MaxSolarSystemSize / picSystem.Width). SystemView.cs OnPaint: below zoom factor 100 the system
// nearest the view centre with its orbits, the view rectangle, ships and creatures (method_5); from 100 up the region
// of the galaxy around the view — backdrop, nebulae, territory, sector grid, the view rectangle, the player's fleet
// postures and the systems with their owners' rings and supply links (method_9). picSystem_MouseUp (Main.Part11.cs
// 1879) moves the view by the clicked offset; picSystem_MouseDoubleClick opens the Galaxy Map (method_131).
//
// Cost: one canvas redraw at most every 50 ms while the camera moves and every 250 ms otherwise (ships move), only
// while the panel is on screen. A redraw walks the shown system's habitats, or the systems of the sectors in view
// (method_9's sector filter), plus galaxy.builtObjects' positions at system zoom; the territory canvas is the shared
// cached one (render/territoryRaster.ts), re-fetched every 2 s. Render/UI only: never writes the sim (or the replica).

import type { Galaxy } from '../sim/galaxy';
import type { Camera } from '../render/camera';
import { fogOf } from '../render/fog';
import { territoryColorFn } from '../render/empireLayer';
import { getTerritoryCanvas } from '../render/territoryRaster';
import { drawGalaxyMapLayers } from './screens/galaxyMapLayers';
import { drawRegionView, drawSystemView, hudMapClickScale, hudSystemScale } from './systemView';
import { mainResxImageUrl } from './resxImage';
import { getSettings } from './settings';

/** pnlSystemMap (Main.Part12.cs 2099-2100). */
export const SYSTEM_MAP_PANEL = { w: 330, h: 290 } as const;
/** picSystem at (45, 5), 280 × 280 (Main.Part12.cs 2101-2102, 2133). */
export const SYSTEM_MAP_PIC = { x: 45, y: 5, size: 280 } as const;
/** SystemView.cs OnPaint: below this zoom factor the system view (method_5), from it the region view (method_9). */
export const HUD_SYSTEM_VIEW_MAX_ZOOM = 100.0;

/** Main.Part12.cs 2236: int_35 = Galaxy.MaxSolarSystemSize / picSystem.ClientRectangle.Width (int division). */
export function hudSystemMapScaleFactor(galaxy: Galaxy, width: number = SYSTEM_MAP_PIC.size): number {
    return Math.trunc(galaxy.maxSolarSystemSize / width);
}

/** Main.Part11.cs picSystem_MouseUp: the new view centre after a click at (px, py) on the map (null: no move —
 * below factor 100 with no system to show). */
export function hudSystemMapClickTarget(
    galaxy: Galaxy,
    view: { x: number; y: number; zoomFactor: number },
    px: number,
    py: number,
    width: number = SYSTEM_MAP_PIC.size,
    height: number = SYSTEM_MAP_PIC.size,
): { x: number; y: number } | null {
    const scaleFactor = hudSystemMapScaleFactor(galaxy, width);
    if (view.zoomFactor < HUD_SYSTEM_VIEW_MAX_ZOOM && galaxy.fastFindNearestSystem(view.x, view.y) === null) return null;
    const num = hudMapClickScale(view.zoomFactor, scaleFactor);
    return {
        x: Math.trunc(view.x) + (Math.trunc(px) - Math.trunc(width / 2)) * num,
        y: Math.trunc(view.y) + (Math.trunc(py) - Math.trunc(height / 2)) * num,
    };
}

/** The zoom strip: GlassButtons 56 px wide, 13 px left of the panel (x = mainView.Width - (280 + 56 + 17) against the
 *  panel's mainView.Width - 340), the first 4 px below its top (num6 = mainView.Height - (290 + 7) + 1 against
 *  mainView.Height - 300), one every 30 px (Main.Part12.cs 2106-2122). */
export const SYSTEM_MAP_STRIP = { x: -13, y: 4, w: 56, pitch: 30 } as const;

/** What a strip button does (the original's Click handlers; 'size' is our size toggle). */
export type SystemMapButtonAction = 'zoomSelection' | 'zoomIn' | 'zoomOut' | 'zoomColony' | 'zoomSystem' | 'zoomSector' | 'zoomRegion' | 'size' | 'galaxyMap';

export interface SystemMapButtonDef {
    /** The original control name (Main.InitializeComponent.cs; jQaYpdpkDs is named "btnZoomSector"). */
    name: string;
    action: SystemMapButtonAction;
    /** Top inside the panel (original pixels). */
    y: number;
    h: number;
    /** Image: a Main.resx resource (read from the install at runtime) or an images/ui/chrome file. */
    resx?: string;
    chrome?: string;
    /** Main.Part10.cs method_206 hover hint. */
    hint: string;
    /** Text when the install has no decompiled Main.resx to read the image from. */
    fallback: string;
}

const stripY = (i: number): number => SYSTEM_MAP_STRIP.y + i * SYSTEM_MAP_STRIP.pitch;

/** The strip, top to bottom (Main.Part12.cs 2107-2122; hints Main.Part10.cs 955-997 / 1046). */
export const SYSTEM_MAP_BUTTONS: readonly SystemMapButtonDef[] = [
    { name: 'btnZoomSelection', action: 'zoomSelection', y: stripY(0), h: 28, resx: 'btnZoomSelection.Image', hint: 'Zoom to selected item (Backspace)', fallback: 'Sel' },
    { name: 'btnZoomIn', action: 'zoomIn', y: stripY(1), h: 28, resx: 'btnZoomIn.Image', hint: 'Zoom In (Page Down)', fallback: '+' },
    { name: 'btnZoomOut', action: 'zoomOut', y: stripY(2), h: 28, resx: 'btnZoomOut.Image', hint: 'Zoom Out (Page Up)', fallback: '\u2212' },
    { name: 'btnZoomColony', action: 'zoomColony', y: stripY(3), h: 28, resx: 'btnZoomColony.Image', hint: 'Zoom to 100% (Home)', fallback: '100%' },
    { name: 'btnZoomSystem', action: 'zoomSystem', y: stripY(4), h: 28, resx: 'btnZoomSystem.Image', hint: 'Zoom to System (Insert)', fallback: 'Sys' },
    { name: 'btnZoomSector', action: 'zoomSector', y: stripY(5), h: 28, resx: 'btnZoomSector.Image', hint: 'Zoom to Sector (Delete)', fallback: 'Sec' },
    { name: 'btnZoomRegion', action: 'zoomRegion', y: stripY(6), h: 28, resx: 'btnZoomRegion.Image', hint: 'Zoom to Galaxy (End)', fallback: 'Gal' },
    // Not in the original: the free slot at num6 + 210 holds the size toggle (btnSelectionPanelSize's image).
    { name: 'btnSystemMapSize', action: 'size', y: stripY(7), h: 28, chrome: 'selectionPanelSize.png', hint: 'Shrink System Map', fallback: '\u2195' },
    { name: 'tbtnGalaxyMap', action: 'galaxyMap', y: stripY(8), h: 40, chrome: 'galaxyMapButton.png', hint: 'Open Galaxy Map screen (G)', fallback: 'Map' },
];

/** Main.Part13.cs 185-186: double_4 / double_5, the Main View's zoom factor limits. */
export const ZOOM_FACTOR_MIN = 0.25;
export const ZOOM_FACTOR_MAX = 15000.0;

/** Main.Part8.cs btnZoomIn_Click: num -= num × MainViewZoomSpeed / 100, clamped to [double_4, 10000]. */
export function zoomInFactor(zoomFactor: number, zoomSpeed: number): number {
    let num = zoomFactor;
    num -= num * (zoomSpeed / 100.0);
    if (num < ZOOM_FACTOR_MIN) num = ZOOM_FACTOR_MIN;
    if (num > 10000.0) num = 10000.0;
    return num;
}

/** Main.Part8.cs btnZoomOut_Click: num += num × MainViewZoomSpeed / 100, clamped to [double_4, double_5]. */
export function zoomOutFactor(zoomFactor: number, zoomSpeed: number): number {
    let num = zoomFactor;
    num += num * (zoomSpeed / 100.0);
    if (num < ZOOM_FACTOR_MIN) num = ZOOM_FACTOR_MIN;
    if (num > ZOOM_FACTOR_MAX) num = ZOOM_FACTOR_MAX;
    return num;
}

/** method_4(zoomFactor) on our camera: zoom about the view centre (the camera clamps to its own limits). */
export function setZoomFactor(camera: Camera, zoomFactor: number): void {
    camera.zoomAt(1 / zoomFactor, camera.width / 2, camera.height / 2);
}

/** The strip's zoom buttons on a camera (Main.Part8.cs btnZoomIn_Click / btnZoomOut_Click, Main.Part9.cs 3180-3202
 *  btnZoomColony_Click method_4(1.0), btnZoomSystem_Click method_4(50.0), jQaYpdpkDs_Click method_4(3000.0),
 *  JqLykZtpp1 method_4(double_5)). False for an action that is not a plain zoom. */
export function applySystemMapZoom(camera: Camera, action: SystemMapButtonAction, zoomSpeed: number): boolean {
    const factor = 1 / camera.zoom;
    switch (action) {
        case 'zoomIn':
            setZoomFactor(camera, zoomInFactor(factor, zoomSpeed));
            return true;
        case 'zoomOut':
            setZoomFactor(camera, zoomOutFactor(factor, zoomSpeed));
            return true;
        case 'zoomColony':
            setZoomFactor(camera, 1.0);
            return true;
        case 'zoomSystem':
            setZoomFactor(camera, 50.0);
            return true;
        case 'zoomSector':
            setZoomFactor(camera, 3000.0);
            return true;
        case 'zoomRegion':
            setZoomFactor(camera, ZOOM_FACTOR_MAX);
            return true;
        default:
            return false;
    }
}

/** The small size (ours: the original has one size): the whole frame drawn at this factor. */
export const SYSTEM_MAP_SMALL_SCALE = 0.6;

const SMALL_KEY = 'dwu.systemMapSmall';
/** The size toggle's state, persisted per browser like btnSelectionPanelSize's (hud.ts selectionPanelSmall). */
export function systemMapSmall(): boolean {
    try {
        return localStorage.getItem(SMALL_KEY) === '1';
    } catch {
        return false;
    }
}
export function setSystemMapSmall(small: boolean): void {
    try {
        localStorage.setItem(SMALL_KEY, small ? '1' : '0');
    } catch {
        // private mode: the size just doesn't persist
    }
}
/** The size toggle's hint for a state. */
export function systemMapSizeHint(small: boolean): string {
    return small ? 'Enlarge System Map' : 'Shrink System Map';
}

export interface HudSystemMapOptions {
    galaxy: Galaxy;
    camera: Camera;
    /** picSystem_MouseDoubleClick → method_131(null) and tbtnGalaxyMap_Click: open / close the Galaxy Map. */
    onGalaxyMap?: () => void;
    /** btnZoomSelection_Click (Main.Part4.cs 2153): false when nothing is selected. */
    onZoomSelection?: () => boolean;
    /** Whether something is selected (btnZoomSelection.Enabled, Main.Part10.cs 1327 / 1372). */
    hasSelection?: () => boolean;
    /** After the size toggle: the HUD re-applies the frame's scale. */
    onResize?: (small: boolean) => void;
}

/** Draw the map once (SystemView.OnPaint with relativeToView: true) into a `size`-px context. */
export function drawHudSystemMap(ctx: CanvasRenderingContext2D, galaxy: Galaxy, camera: Camera, size: number = SYSTEM_MAP_PIC.size, territory?: () => ReturnType<typeof getTerritoryCanvas>, onLayersChange?: () => void): void {
    const zoomFactor = 1 / camera.zoom;
    const fog = fogOf(galaxy);
    const player = fog.player;
    if (zoomFactor < HUD_SYSTEM_VIEW_MAX_ZOOM) {
        const star = galaxy.fastFindNearestSystem(camera.x, camera.y);
        if (star === null) {
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, size, size);
            return;
        }
        drawSystemView(ctx, {
            galaxy,
            player,
            width: size,
            height: size,
            star,
            scale: hudSystemScale(zoomFactor, hudSystemMapScaleFactor(galaxy, size)),
            centerX: camera.x,
            centerY: camera.y,
            viewIndicator: { viewWidth: camera.width, viewHeight: camera.height, zoomFactor },
            builtObjects: { viewX: camera.x, viewY: camera.y },
        });
        return;
    }
    drawRegionView(ctx, {
        galaxy,
        player,
        width: size,
        height: size,
        viewX: camera.x,
        viewY: camera.y,
        zoomFactor,
        viewWidth: camera.width,
        viewHeight: camera.height,
        fleetPostures: true,
        // bitmap_3 (backdrop), bitmap_2 (nebulae), bitmap_4 (territory at 40 %), at the galaxy's extent.
        drawLayers: (c, s, ox, oy) => {
            c.save();
            c.imageSmoothingEnabled = true;
            drawGalaxyMapLayers(c, galaxy, s, ox, oy, { onChange: onLayersChange });
            const t = territory !== undefined ? territory() : getTerritoryCanvas(galaxy, player, territoryColorFn(galaxy));
            if (t !== null) {
                c.globalAlpha = 0.4;
                c.drawImage(t.canvas, 0, 0, t.raster.usedW, t.raster.usedH, -ox / s, -oy / s, galaxy.sizeX / s, galaxy.sizeY / s);
            }
            c.restore();
        },
    });
}

/** Build the pnlSystemMap element: the panel, picSystem and the zoom strip (the HUD places and scales it, hud.ts). */
export function buildHudSystemMap(opts: HudSystemMapOptions): HTMLElement {
    const { galaxy, camera } = opts;
    const root = document.createElement('div');
    root.className = 'hud-sysmap';
    root.style.width = `${SYSTEM_MAP_PANEL.w}px`;
    root.style.height = `${SYSTEM_MAP_PANEL.h}px`;
    const panel = document.createElement('div');
    panel.className = 'hud-sysmap-panel';
    panel.title = 'Map: click to move view to a new location';
    const canvas = document.createElement('canvas');
    canvas.className = 'hud-sysmap-pic';
    canvas.style.left = `${SYSTEM_MAP_PIC.x}px`;
    canvas.style.top = `${SYSTEM_MAP_PIC.y}px`;
    canvas.style.width = `${SYSTEM_MAP_PIC.size}px`;
    canvas.style.height = `${SYSTEM_MAP_PIC.size}px`;
    panel.appendChild(canvas);
    root.appendChild(panel);

    let forced = true;
    const buttons = new Map<SystemMapButtonAction, HTMLButtonElement>();
    for (const def of SYSTEM_MAP_BUTTONS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `sel-glass sel-corners-left sysmap-btn${def.h < 30 ? ' sysmap-btn-r6' : ''}`;
        b.dataset.sysmap = def.name;
        b.style.left = `${SYSTEM_MAP_STRIP.x}px`;
        b.style.top = `${def.y}px`;
        b.style.width = `${SYSTEM_MAP_STRIP.w}px`;
        b.style.height = `${def.h}px`;
        b.title = def.hint;
        const showFallback = (): void => {
            b.replaceChildren();
            const t = document.createElement('span');
            t.className = 'sysmap-btn-text';
            t.textContent = def.fallback;
            b.appendChild(t);
        };
        const img = document.createElement('img');
        img.alt = '';
        img.draggable = false;
        img.addEventListener('error', showFallback);
        b.appendChild(img);
        if (def.chrome !== undefined) img.src = `/assets/dwu/images/ui/chrome/${def.chrome}`;
        else if (def.resx !== undefined)
            void mainResxImageUrl(def.resx).then((u) => {
                if (u === null) showFallback();
                else img.src = u;
            });
        b.addEventListener('click', () => {
            switch (def.action) {
                case 'zoomSelection':
                    opts.onZoomSelection?.();
                    break;
                case 'galaxyMap':
                    opts.onGalaxyMap?.();
                    break;
                case 'size': {
                    const small = !systemMapSmall();
                    setSystemMapSmall(small);
                    b.title = systemMapSizeHint(small);
                    root.classList.toggle('hud-sysmap-small', small);
                    opts.onResize?.(small);
                    break;
                }
                default:
                    applySystemMapZoom(camera, def.action, getSettings().mainViewZoomSpeed);
                    break;
            }
            forced = true;
        });
        if (def.action === 'size') b.title = systemMapSizeHint(systemMapSmall());
        buttons.set(def.action, b);
        root.appendChild(b);
    }
    root.classList.toggle('hud-sysmap-small', systemMapSmall());
    const zoomSelection = buttons.get('zoomSelection');
    const syncSelection = (): void => {
        if (zoomSelection === undefined || opts.hasSelection === undefined) return;
        const on = opts.hasSelection();
        if (zoomSelection.disabled === on) zoomSelection.disabled = !on;
    };
    syncSelection();

    let territoryAt = -Infinity;
    let territoryCache: ReturnType<typeof getTerritoryCanvas> = null;
    const territory = (): ReturnType<typeof getTerritoryCanvas> => {
        const now = performance.now();
        if (now - territoryAt > 2000) {
            territoryAt = now;
            try {
                territoryCache = getTerritoryCanvas(galaxy, fogOf(galaxy).player, territoryColorFn(galaxy));
            } catch {
                territoryCache = null;
            }
        }
        return territoryCache;
    };

    let last = { x: NaN, y: NaN, zoom: NaN, w: NaN, h: NaN };
    let lastDraw = -Infinity;
    let lastSelectionCheck = -Infinity;
    let wasConnected = false;
    let raf = 0;
    const draw = (): void => {
        const rect = canvas.getBoundingClientRect();
        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        // The panel is CSS-scaled with the HUD (and the small size): rasterise at its on-screen size.
        const onScreen = rect.width > 0 ? rect.width : SYSTEM_MAP_PIC.size;
        const px = Math.max(1, Math.round(onScreen * dpr));
        if (canvas.width !== px) {
            canvas.width = px;
            canvas.height = px;
        }
        const ctx = canvas.getContext('2d');
        if (ctx === null) return;
        const k = px / SYSTEM_MAP_PIC.size;
        ctx.setTransform(k, 0, 0, k, 0, 0);
        try {
            drawHudSystemMap(ctx, galaxy, camera, SYSTEM_MAP_PIC.size, territory, () => {
                forced = true;
            });
        } catch (e) {
            console.warn('[hudSystemMap]', e);
        }
    };
    const frame = (now: number): void => {
        if (!root.isConnected) {
            if (wasConnected) return; // removed with the HUD: stop
            raf = requestAnimationFrame(frame);
            return;
        }
        wasConnected = true;
        if (typeof document !== 'undefined' && document.hidden) {
            raf = requestAnimationFrame(frame);
            return;
        }
        if (now - lastSelectionCheck >= 200) {
            lastSelectionCheck = now;
            syncSelection();
        }
        const moved = camera.x !== last.x || camera.y !== last.y || camera.zoom !== last.zoom || camera.width !== last.w || camera.height !== last.h;
        const due = now - lastDraw >= (moved ? 50 : 250);
        if ((moved || forced || now - lastDraw >= 250) && due) {
            last = { x: camera.x, y: camera.y, zoom: camera.zoom, w: camera.width, h: camera.height };
            lastDraw = now;
            forced = false;
            draw();
        }
        raf = requestAnimationFrame(frame);
    };
    if (typeof requestAnimationFrame !== 'undefined') raf = requestAnimationFrame(frame);
    void raf;

    const pick = (e: MouseEvent): { x: number; y: number } => {
        const r = canvas.getBoundingClientRect();
        const k = r.width > 0 ? SYSTEM_MAP_PIC.size / r.width : 1;
        return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k };
    };
    canvas.addEventListener('mouseup', (e) => {
        if (e.button !== 0) return;
        const p = pick(e);
        const t = hudSystemMapClickTarget(galaxy, { x: camera.x, y: camera.y, zoomFactor: 1 / camera.zoom }, p.x, p.y);
        if (t === null) return;
        camera.centerOn(t.x, t.y);
        forced = true;
    });
    canvas.addEventListener('dblclick', (e) => {
        e.preventDefault();
        opts.onGalaxyMap?.();
    });
    return root;
}
