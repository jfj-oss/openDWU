// The HUD's system mini-map: port of the original's bottom-right pnlSystemMap / picSystem (Main.Part12.cs 2099-2134:
// pnlSystemMap 330 × 290 at (mainView.Width - 340, mainView.Height - 300), picSystem 280 × 280 at (45, 5) inside it;
// Main.Part11.cs 563 / 583 picSystem.Ignite(relativeToView: true, int_28, int_35, drawViewIndicator: true,
// erasePrevious: true, showIndicatorLines: false, "") with ShowFleetPostures / ShowBuiltObjects; Main.Part12.cs 2236
// int_35 = Galaxy.MaxSolarSystemSize / picSystem.Width). SystemView.cs OnPaint: below zoom factor 100 the system
// nearest the view centre with its orbits, the view rectangle, ships and creatures (method_5); from 100 up the region
// of the galaxy around the view — backdrop, nebulae, territory, sector grid, the view rectangle, the player's fleet
// postures and the systems with their owners' rings and supply links (method_9). picSystem_MouseUp (Main.Part11.cs
// 1879) moves the view by the clicked offset; picSystem_MouseDoubleClick opens the Galaxy Map (method_131).
//
// The original's 45 px left column holds the zoom buttons (btnZoomSelection … tbtnGalaxyMap) and the overlay buttons
// sit in a row above the panel; here both live in the "View" popup (hud.ts buildOptionsPopup), whose button sits just
// above the panel's top-right corner.
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

export interface HudSystemMapOptions {
    galaxy: Galaxy;
    camera: Camera;
    /** picSystem_MouseDoubleClick → method_131(null): open the Galaxy Map. */
    onGalaxyMap?: () => void;
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

/** Build the pnlSystemMap element (the HUD places and scales it, hud.ts). */
export function buildHudSystemMap(opts: HudSystemMapOptions): HTMLElement {
    const { galaxy, camera } = opts;
    const panel = document.createElement('div');
    panel.className = 'hud-panel hud-sysmap';
    panel.style.width = `${SYSTEM_MAP_PANEL.w}px`;
    panel.style.height = `${SYSTEM_MAP_PANEL.h}px`;
    const canvas = document.createElement('canvas');
    canvas.className = 'hud-sysmap-pic';
    canvas.style.left = `${SYSTEM_MAP_PIC.x}px`;
    canvas.style.top = `${SYSTEM_MAP_PIC.y}px`;
    canvas.style.width = `${SYSTEM_MAP_PIC.size}px`;
    canvas.style.height = `${SYSTEM_MAP_PIC.size}px`;
    canvas.title = 'Click to move the view. Double-click to open the Galaxy Map (G).';
    panel.appendChild(canvas);

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
    let forced = true;
    let wasConnected = false;
    let raf = 0;
    const draw = (): void => {
        const rect = canvas.getBoundingClientRect();
        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        // The panel is CSS-scaled with the HUD: rasterise at its on-screen size.
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
        if (!panel.isConnected) {
            if (wasConnected) return; // removed with the HUD: stop
            raf = requestAnimationFrame(frame);
            return;
        }
        wasConnected = true;
        if (typeof document !== 'undefined' && document.hidden) {
            raf = requestAnimationFrame(frame);
            return;
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
    return panel;
}
