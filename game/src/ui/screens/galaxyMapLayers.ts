// The galaxy-wide picture layers every GalaxyMap / SystemView control draws under its dots: the galaxy backdrop
// (Main.bitmap_176, galaxy_backdrop.jpg) and the galaxy nebulae image (Main.bitmap_182). GalaxyMap.cs Ignite → method_1
// scales both to max(500, width) once per control (bitmap_1 / bitmap_0) and method_6 draws them before the territory
// bitmap; SystemView.cs Ignite precaches them at 500 × 500 (bitmap_1 / bitmap_0) and method_9 draws them under the
// region view. Here one cache per galaxy serves every map: the Galaxy Map window, the screens' mini maps (Colonies,
// Diplomacy, Troops, Expansion Planner, Fleets, Ships and Bases, Construction Yards) and the HUD system map.
//
// Deviation: bitmap_182 is Galaxy.GenerateNebulae(generateImage: true) — the GalaxyNebulaeGenerator image path, which
// is not ported (sim/galaxyNebulaeGenerator.ts ports the location path only). The stand-in is a composite of the
// per-location nebula clouds (the same NebulaCloudGenerator seed / sizes the Main View uses for each NebulaCloud
// location, task 08f2) at 55 % — what the Galaxy Map window drew before this cache existed. It is built once per
// galaxy in small batches off the click path (4 clouds per macrotask) and drawn with a single drawImage per map, so a
// late 2500-star galaxy costs the same per draw as a small one.
//
// Render/UI only: reads galaxy.galaxyLocations and sizes; never writes the sim (works on the sim-worker replica).

import type { Galaxy } from '../../sim/galaxy';
import { GalaxyLocationType } from '../../sim/galaxyLocation';
import { NebulaCloudGenerator } from '../../render/nebulaClouds';
import { BACKDROP_URLS } from '../../render/assets';

/** Long side of the nebula composite, in pixels (GalaxyMap.cs method_1 builds max(500, width); the Galaxy Map window
 * is up to ~1000 px). */
export const NEBULA_COMPOSITE_PX = 1024;
/** Opacity of each cloud in the composite (the Galaxy Map window's former per-cloud alpha). */
export const NEBULA_CLOUD_ALPHA = 0.55;
/** Clouds generated per macrotask while the composite is being built. */
export const NEBULA_BATCH = 4;

export interface GalaxyMapLayers {
    /** galaxy_backdrop.jpg once loaded. */
    readonly backdrop: HTMLImageElement | null;
    /** The nebula composite (covers the galaxy, 0..sizeX × 0..sizeY), or null without a 2D canvas. */
    readonly nebula: HTMLCanvasElement | null;
    /** Clouds drawn into the composite so far / in total. */
    readonly nebulaDone: number;
    readonly nebulaTotal: number;
}

interface LayerState extends GalaxyMapLayers {
    backdrop: HTMLImageElement | null;
    nebula: HTMLCanvasElement | null;
    nebulaDone: number;
    nebulaTotal: number;
    listeners: Set<() => void>;
}

const states = new WeakMap<Galaxy, LayerState>();

/** The composite's pixel size for a galaxy: NEBULA_COMPOSITE_PX on the long side, the galaxy's aspect. */
export function nebulaCompositeSize(sizeX: number, sizeY: number): { w: number; h: number } {
    const long = Math.max(1, sizeX, sizeY);
    return {
        w: Math.max(1, Math.round((NEBULA_COMPOSITE_PX * sizeX) / long)),
        h: Math.max(1, Math.round((NEBULA_COMPOSITE_PX * sizeY) / long)),
    };
}

function notify(st: LayerState): void {
    const fns = [...st.listeners];
    st.listeners.clear();
    for (const fn of fns) {
        try {
            fn();
        } catch (e) {
            console.warn('[galaxyMapLayers]', e);
        }
    }
}

function start(galaxy: Galaxy, st: LayerState): void {
    if (typeof document === 'undefined') return;
    const img = new Image();
    img.onload = () => {
        st.backdrop = img;
        notify(st);
    };
    img.src = BACKDROP_URLS[0];

    const locations = galaxy.galaxyLocations.filter((l) => l.type === GalaxyLocationType.NebulaCloud);
    st.nebulaTotal = locations.length;
    const size = nebulaCompositeSize(galaxy.sizeX, galaxy.sizeY);
    const canvas = document.createElement('canvas');
    canvas.width = size.w;
    canvas.height = size.h;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
        ctx = canvas.getContext('2d');
    } catch {
        ctx = null;
    }
    if (ctx === null) return;
    st.nebula = canvas;
    const k = size.w / Math.max(1, galaxy.sizeX);
    const scratch = document.createElement('canvas');
    const sctx = scratch.getContext('2d');
    if (sctx === null) return;
    let i = 0;
    const step = (): void => {
        const end = Math.min(locations.length, i + NEBULA_BATCH);
        for (; i < end; i++) {
            const loc = locations[i];
            // Same generator / seed / sizes as the Main View's per-location clouds (task 08f2).
            const r = new NebulaCloudGenerator(2).generateNebulaBackdrop(loc.pictureRef >= 0 ? loc.pictureRef : loc.effectRandomSeed, 114, -1, 48, 72, true, false, true);
            if (r.width <= 0 || r.height <= 0) continue;
            scratch.width = r.width;
            scratch.height = r.height;
            sctx.putImageData(new ImageData(new Uint8ClampedArray(r.image), r.width, r.height), 0, 0);
            ctx.globalAlpha = NEBULA_CLOUD_ALPHA;
            ctx.drawImage(scratch, loc.xpos * k, loc.ypos * k, loc.width * k, loc.height * k);
            ctx.globalAlpha = 1;
        }
        st.nebulaDone = i;
        notify(st);
        if (i < locations.length) setTimeout(step, 0);
    };
    setTimeout(step, 0);
}

/**
 * The shared layers of `galaxy` (started on first use). `onChange`, when given, is called once the next time a layer
 * changes (the backdrop loaded, another batch of clouds drawn): a map passes its redraw on every draw, so it keeps
 * redrawing while the composite fills in and stops when it is complete.
 */
export function galaxyMapLayers(galaxy: Galaxy, onChange?: () => void): GalaxyMapLayers {
    let st = states.get(galaxy);
    if (st === undefined) {
        st = { backdrop: null, nebula: null, nebulaDone: 0, nebulaTotal: 0, listeners: new Set() };
        states.set(galaxy, st);
        start(galaxy, st);
    }
    const complete = st.backdrop !== null && (st.nebula === null || st.nebulaDone >= st.nebulaTotal);
    if (onChange !== undefined && !complete) st.listeners.add(onChange);
    return st;
}

/**
 * Draw the backdrop and (when `nebulae`) the nebula composite for a map whose pixel (0, 0) is world (ox, oy) at `s`
 * world units per pixel (GalaxyMap.cs method_6: bitmap_1 then bitmap_0, both at the galaxy's extent; SystemView.cs
 * method_9: bitmap_3 then bitmap_2). The caller clears / fills the background first.
 */
export function drawGalaxyMapLayers(
    ctx: CanvasRenderingContext2D,
    galaxy: Galaxy,
    s: number,
    ox = 0,
    oy = 0,
    opts: { backdrop?: boolean; nebulae?: boolean; onChange?: () => void } = {},
): void {
    const layers = galaxyMapLayers(galaxy, opts.onChange);
    const x = -ox / s;
    const y = -oy / s;
    const w = galaxy.sizeX / s;
    const h = galaxy.sizeY / s;
    if (opts.backdrop !== false && layers.backdrop !== null && layers.backdrop.complete && layers.backdrop.naturalWidth > 0) {
        ctx.drawImage(layers.backdrop, x, y, w, h);
    }
    if (opts.nebulae !== false && layers.nebula !== null && layers.nebulaDone > 0) {
        ctx.drawImage(layers.nebula, x, y, w, h);
    }
}
