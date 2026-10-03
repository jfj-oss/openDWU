// Task M2e — draw empires on the Main View. Port of the original's owner
// overlays (Controls/MainView.cs: DrawCircle(area, 60, owner.MainColor, 2)
// around owned habitats; coloured rings / territory shading around owned
// systems at galaxy/sector zoom). Independent populated worlds use a neutral
// grey ring (the sim forces the independent empire's colour to grey in its
// constructor, empire.ts).
//
// The layer lives in world space (inside MainView.world) so colony rings,
// markers and the territory fill (territoryField.ts, docs/territory.md) scale with the camera like everything else;
// stroke widths are divided by the zoom to stay a constant number of screen
// pixels. Zoom gating mirrors the original's factor threshold: system/planet
// zoom is factor < 70 (factor = 1/z), the same test MainView.pick uses.

import { circleAtScreenRes } from './screenCircle';
import { fogOf } from './fog';
import type { MotionInterpolator } from './renderInterp';
import { Container, Graphics, Mesh, MeshGeometry, Rectangle, Sprite, Texture } from 'pixi.js';
import type { Camera } from './camera';
import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import { HabitatCategoryType } from '../sim/types';
import { TerritoryGrid, buildTerritoryMeshes, collectTerritorySources, type TerritoryMeshData } from './territoryField';
import { galaxyTerritorySignature, publishTerritoryRaster, rasterizeTerritory, type TerritoryRaster } from './territoryRaster';
import type { Habitat } from '../sim/types';
import { moonDotPx, planetSpritePx } from './mainView';
import { DrawKey } from './drawCache';
import { displayColorForEmpire } from '../sim/empireColors';

/** Neutral grey for independent (non-empire) populated worlds. Matches the
 * grey the sim forces onto the independent empire (Empire ctor, empire.ts). */
export const INDEPENDENT_RING_COLOR = 0x606060;

/** Colony-ring radius in screen pixels: the drawn sprite radius plus the
 * original's owner-ring pad num68 = max(6, (int)(28 / f)) (MainView.1.cs:792-806,
 * f = zoom factor 1/z), so at 100% zoom the ring sits 28 px outside the body. */
export function colonyRingRadius(drawnPx: number, f = 100): number {
    return drawnPx / 2 + Math.max(6, Math.trunc(28 / f));
}

/** Convert a colour given as a 0xRRGGBB number or a '#rrggbb' / 'rgb(r,g,b)'
 * string into a PixiJS 0xRRGGBB number. Unknown input falls back to white. */
export function toPixiColor(color: number | string): number {
    if (typeof color === 'number') {
        return ((color & 0xffffff) >>> 0) || 0xffffff;
    }
    const hex = /^#?([0-9a-f]{6})$/i.exec(color.trim());
    if (hex !== null) {
        return parseInt(hex[1], 16);
    }
    const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(color.trim());
    if (rgb !== null) {
        const r = Math.min(255, Number(rgb[1]));
        const g = Math.min(255, Number(rgb[2]));
        const b = Math.min(255, Number(rgb[3]));
        return ((r << 16) | (g << 8) | b) >>> 0;
    }
    return 0xffffff;
}

/** The ring colour for a habitat's owner: the owner's display colour (own
 * main colour or the renderer-side palette fallback, task M2e2), or neutral
 * grey when the world belongs to no empire (independent). */
export function colonyRingColor(habitat: Habitat, galaxy: Galaxy): number {
    const owner = habitat.owner ?? habitat.empire;
    if (owner === null || owner === undefined) {
        return INDEPENDENT_RING_COLOR;
    }
    if (galaxy.independentEmpire !== null && owner === galaxy.independentEmpire) {
        return INDEPENDENT_RING_COLOR;
    }
    const index = galaxy.empires.indexOf(owner);
    if (index >= 0) {
        return empireColour(owner, index);
    }
    return toPixiColor(displayColorForEmpire(owner));
}

/** 12-colour fallback palette (task M2e2): assigned by empire index in the
 * renderer only when empires share or lack colours. Distinct from each other
 * and from the independent grey; not written back to sim data. */
export const EMPIRE_FALLBACK_COLORS = [
    0x0080ff, 0xff681f, 0x00cc00, 0xc00080, 0xa840ff, 0xffff20,
    0xff0030, 0x00ffff, 0xe0c060, 0x7020cc, 0xffa6c9, 0x999933,
];

/** The display colour for an empire: its own main colour when usable
 * (non-zero), otherwise the palette entry for its index. Pure — no sim
 * state is read or mutated (task M2e2). */
export function empireColour(empire: Empire, index: number): number {
    if (empire.mainColor !== 0) {
        // Task 19k-1b: the big-galaxies scenario's extendedPalette flag substitutes a distinct colour for empires
        // beyond the 20 key colours; off (or no scenario) this is exactly empire.mainColor.
        return toPixiColor(displayColorForEmpire(empire));
    }
    // Task M2e2: the palette is indexed by position in galaxy.empires, which
    // includes the independent empire — match that here so the renderer's
    // per-index colours line up with the layer's.
    const i = ((index + 1) % EMPIRE_FALLBACK_COLORS.length + EMPIRE_FALLBACK_COLORS.length) % EMPIRE_FALLBACK_COLORS.length;
    return EMPIRE_FALLBACK_COLORS[i];
}

/** Opacity of the territory fill: MainView.2.cs 241 / 365 draw the territory bitmap through method_236(0.25), a colour
 * matrix that scales alpha to 25% (MainView.2.cs 3665). */
export const TERRITORY_ALPHA = 0.25;

/** Colour of galaxy.empires[owner] for the territory bitmaps (the mini maps use it too). */
export function territoryColorFn(galaxy: Galaxy): (owner: number) => number {
    return (owner) => {
        const empire = galaxy.empires[owner];
        return empire === undefined ? 0 : empireColour(empire, owner);
    };
}

/** The vector meshes give way to the soft bitmap once a bitmap pixel is smaller than this many screen px (smoothstep
 * from TEXEL_SHARP to TEXEL_SOFT screen px per bitmap pixel): at galaxy zoom the blurred bitmap is about screen
 * resolution (the original's 2000 px backdrop copy), zoomed in the meshes keep the edges crisp (the original recomputes
 * at viewport resolution there). */
const TEXEL_SOFT = 4;
const TEXEL_SHARP = 12;

/** Main-thread time a territory rebuild may take per frame (ms); a rebuild spans as many frames as it needs. */
const TERRITORY_BUILD_BUDGET_MS = 4;
/** Minimum wall time between two territory rebuilds (ms), however often the influence changes. */
const TERRITORY_REBUILD_INTERVAL_MS = 1500;

export class EmpireLayer {
    /** World-space layer: territory fill, then colony rings above. */
    root = new Container();
    /** Render interpolation (renderInterp.ts; set by MainView): colony rings follow the drawn planet / moon. */
    motion: MotionInterpolator | null = null;
    /** Territory fill (territoryField.ts): one mesh per owning empire, regions disjoint, faded as a whole. */
    private territoryRoot = new Container();
    private territoryMeshes: Mesh[] = [];
    /** The meshes' container (alpha = their share of the mesh/bitmap crossfade) and the soft bitmap sprite. */
    private meshRoot = new Container();
    private softSprite: Sprite | null = null;
    private softCell = 0;
    private territoryGrid: TerritoryGrid | null = null;
    /** In-flight time-sliced rebuild, and the signature it was started for. */
    private territoryBuild: Generator<void, { meshes: TerritoryMeshData[]; raster: TerritoryRaster }, void> | null = null;
    private territoryBuildSig = -1;
    /** Signature of the sources the current meshes show (-1 = never built). */
    private territorySig = -1;
    private territoryLastBuildMs = -Infinity;
    /** Display colour per empire (own main colour or palette fallback, task M2e2). */
    private colorCache = new Map<Empire, number>();
    /** Colony rings, one per owned planet/moon (world space). */
    private colonyRings: Array<{ habitat: Habitat; ring: Graphics; key: DrawKey }> = [];
    // Owned-system marker rings were removed: they passed a screen-px radius as world units (invisible), and the
    // faction rings of render/galaxyMarkers.ts (the port of MainView.2.cs method_250 / method_268) supersede them.
    /** Task M3: gates the territory fill only (not colony rings), driven by the "Empire Territory" overlay toggle in
     * overlayLayer.ts. */
    private territoryEnabled = true;
    private frame = 0;

    /** Show/hide the territory fill (overlayLayer.ts, "Empire Territory"). */
    setTerritoryEnabled(enabled: boolean): void {
        this.territoryEnabled = enabled;
    }

    constructor(private galaxy: Galaxy, world: Container) {
        world.addChild(this.root);
        this.territoryRoot.visible = false;
        this.root.addChild(this.territoryRoot);
        this.territoryRoot.addChild(this.meshRoot);
        for (const h of galaxy.habitats) {
            if (h.category !== HabitatCategoryType.Planet && h.category !== HabitatCategoryType.Moon) continue;
            if (h.owner === null && h.empire === null) continue;
            const ring = new Graphics();
            ring.blendMode = 'normal';
            ring.visible = false;
            this.root.addChild(ring);
            this.colonyRings.push({ habitat: h, ring, key: new DrawKey() });
        }
    }

    /** Display colour of galaxy.empires[index]: the owner's MainColor (EmpireTerritory.cs 458), as colonyRingColor. */
    private territoryColor(index: number): number {
        const empire = this.galaxy.empires[index];
        let c = this.colorCache.get(empire);
        if (c === undefined) {
            c = empireColour(empire, index);
            this.colorCache.set(empire, c);
        }
        return c;
    }

    /**
     * Keep the territory meshes current. Rebuilt only when the influence sources change (territorySignature: an
     * ownership change, a newly explored system, a colony's influence growing or shrinking by half a grid cell),
     * at most every TERRITORY_REBUILD_INTERVAL_MS, and time-sliced at TERRITORY_BUILD_BUDGET_MS per frame. The
     * original rebuilds its territory bitmap when the galaxy backdrop is regenerated after each territory review
     * (Galaxy.cs 3418 OnRefreshView(onlyGalaxyBackdrops) -> Main.Part12.cs 3240 method_148) and when the zoomed-in
     * sector background is redrawn (MainView.2.cs 262).
     */
    private updateTerritory(): void {
        const now = performance.now();
        if (this.territoryBuild === null && (this.territorySig === -1 || this.frame % 30 === 0) && now - this.territoryLastBuildMs >= TERRITORY_REBUILD_INTERVAL_MS) {
            if (this.territoryGrid === null || this.territoryGrid.sizeX !== this.galaxy.sizeX || this.territoryGrid.sizeY !== this.galaxy.sizeY) {
                this.territoryGrid = new TerritoryGrid(this.galaxy.sizeX, this.galaxy.sizeY);
            }
            const sources = collectTerritorySources(this.galaxy, fogOf(this.galaxy).player);
            const sig = galaxyTerritorySignature(this.galaxy, sources);
            if (sig !== this.territorySig) {
                this.territoryBuild = this.buildAll(sources, this.territoryGrid);
                this.territoryBuildSig = sig;
                this.territoryLastBuildMs = now;
            }
        }
        if (this.territoryBuild === null) return;
        // The very first build runs to completion so the overlay is there on the first frame it is shown.
        const deadline = this.territorySig === -1 ? Infinity : now + TERRITORY_BUILD_BUDGET_MS;
        for (;;) {
            const r = this.territoryBuild.next();
            if (r.done === true) {
                this.applyTerritoryMeshes(r.value.meshes);
                this.applySoftBitmap(r.value.raster);
                publishTerritoryRaster(this.galaxy, this.territoryBuildSig, r.value.raster);
                this.territoryBuild = null;
                this.territorySig = this.territoryBuildSig;
                return;
            }
            if (performance.now() >= deadline) return;
        }
    }

    /** Meshes, then the soft bitmap from the same influence grid (time-sliced together). */
    private *buildAll(sources: ReturnType<typeof collectTerritorySources>, grid: TerritoryGrid): Generator<void, { meshes: TerritoryMeshData[]; raster: TerritoryRaster }, void> {
        const meshes = yield* buildTerritoryMeshes(sources, grid);
        const raster = yield* rasterizeTerritory(grid, territoryColorFn(this.galaxy));
        return { meshes, raster };
    }

    /** Swap in the blurred owner bitmap as a sprite over the galaxy (uploaded once per rebuild). */
    private applySoftBitmap(raster: TerritoryRaster): void {
        if (typeof document === 'undefined') return;
        const canvas = document.createElement('canvas');
        canvas.width = raster.width;
        canvas.height = raster.height;
        const ctx = canvas.getContext('2d');
        if (ctx === null) return;
        ctx.putImageData(new ImageData(new Uint8ClampedArray(raster.data), raster.width, raster.height), 0, 0);
        const base = Texture.from(canvas);
        // Crop to the part inside the galaxy so the clip at the galaxy edge stays hard.
        const texture = new Texture({ source: base.source, frame: new Rectangle(0, 0, raster.usedW, raster.usedH) });
        if (this.softSprite === null) {
            this.softSprite = new Sprite(texture);
            this.territoryRoot.addChildAt(this.softSprite, 0);
        } else {
            const old = this.softSprite.texture;
            this.softSprite.texture = texture;
            old.destroy(true);
        }
        this.softSprite.position.set(0, 0);
        this.softSprite.width = this.galaxy.sizeX;
        this.softSprite.height = this.galaxy.sizeY;
        this.softCell = raster.cell;
    }

    private applyTerritoryMeshes(data: TerritoryMeshData[]): void {
        for (const m of this.territoryMeshes) {
            const g = m.geometry;
            m.destroy();
            g.destroy();
        }
        this.territoryMeshes = [];
        for (const d of data) {
            const geometry = new MeshGeometry({ positions: d.positions, uvs: new Float32Array(d.positions.length), indices: d.indices });
            const mesh = new Mesh({ geometry, texture: Texture.WHITE });
            mesh.tint = this.territoryColor(d.owner);
            // Regions are disjoint, so the 25% fade is applied once on territoryRoot (no per-empire filter needed).
            mesh.blendMode = 'normal';
            this.meshRoot.addChild(mesh);
            this.territoryMeshes.push(mesh);
        }
    }

    /** Per-frame update. `z` = camera zoom (px per world unit); the original's
     * system-zoom threshold is factor < 70 (factor = 1/z). */
    update(z: number, cam: Camera): void {
        const factor = 1 / z;
        this.frame++;
        const atSystemZoom = factor < 70;

        // Territory fill: galaxy/sector zoom only. Fades out while zooming in towards a system (factor 300 -> 70),
        // where one empire's fill covers the whole screen as a flat coloured haze.
        const fade = Math.max(0, Math.min(1, (factor - 70) / (300 - 70)));
        const showTerritory = !atSystemZoom && this.territoryEnabled && fade > 0;
        if (showTerritory) this.updateTerritory();
        this.territoryRoot.visible = showTerritory && this.territoryMeshes.length > 0;
        if (this.territoryRoot.visible) {
            this.territoryRoot.alpha = TERRITORY_ALPHA * fade * fade * (3 - 2 * fade);
            // Crossfade soft bitmap (galaxy zoom) <-> crisp meshes (zoomed in) by the bitmap pixel's screen size.
            if (this.softSprite !== null) {
                const t = Math.max(0, Math.min(1, (this.softCell * z - TEXEL_SOFT) / (TEXEL_SHARP - TEXEL_SOFT)));
                const w = t * t * (3 - 2 * t);
                this.softSprite.visible = w < 1;
                this.softSprite.alpha = 1 - w;
                this.meshRoot.visible = w > 0;
                this.meshRoot.alpha = w;
            }
        }

        // Colony rings: system/planet zoom only (hidden at galaxy/sector zoom
        // where the owned-system marker rings take over).
        for (const cr of this.colonyRings) {
            const h = cr.habitat;
            if (!atSystemZoom) {
                cr.ring.visible = false;
                continue;
            }
            // Cull off-screen bodies.
            const halfW = cam.width / (2 * z) + 200 / z;
            const halfH = cam.height / (2 * z) + 200 / z;
            // Around the drawn (render-interpolated orbit) body, else its committed position.
            let hx = h.xpos;
            let hy = h.ypos;
            if (this.motion !== null) {
                const hp = this.motion.habitatPos(h);
                hx = hp.x;
                hy = hp.y;
            }
            if (hx < cam.x - halfW || hx > cam.x + halfW || hy < cam.y - halfH || hy > cam.y + halfH) {
                cr.ring.visible = false;
                continue;
            }
            if (!fogOf(this.galaxy).habitatDrawn(h)) {
                // fog.ts: a colony of a system the player has not explored is not drawn (nor its ring).
                cr.ring.visible = false;
                continue;
            }
            // Drawn size matches MainView.drawnSize (planets >= 14 px, moons >= 7 px).
            const drawnPx = h.category === HabitatCategoryType.Moon ? moonDotPx(h.diameter, z) : planetSpritePx(h.diameter, z);
            // Screen px -> world units (the layer lives in world space).
            const r = colonyRingRadius(drawnPx, factor) / z;
            const color = colonyRingColor(h, this.galaxy);
            // Geometry around (0, 0), rebuilt only when radius, width or colour changed; moved to the body each frame.
            if (cr.key.changed(r, 1 / z, color)) {
                cr.ring.clear();
                circleAtScreenRes(cr.ring, 0, 0, r, z).stroke({ width: 1 / z, color, alpha: 0.4 });
            }
            cr.ring.position.set(hx, hy);
            cr.ring.visible = true;
        }
    }
}