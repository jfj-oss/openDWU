// Task M2e — draw empires on the Main View. Port of the original's owner
// overlays (Controls/MainView.cs: DrawCircle(area, 60, owner.MainColor, 2)
// around owned habitats; coloured rings / territory shading around owned
// systems at galaxy/sector zoom). Independent populated worlds use a neutral
// grey ring (the sim forces the independent empire's colour to grey in its
// constructor, empire.ts).
//
// The layer lives in world space (inside MainView.world) so colony rings,
// markers and territory discs scale with the camera like everything else;
// stroke widths are divided by the zoom to stay a constant number of screen
// pixels. Zoom gating mirrors the original's factor threshold: system/planet
// zoom is factor < 70 (factor = 1/z), the same test MainView.pick uses.

import { Container, Graphics } from 'pixi.js';
import type { Camera } from './camera';
import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import { HabitatCategoryType } from '../sim/types';
import type { Habitat } from '../sim/types';
import { moonDotPx, planetSpritePx } from './mainView';
import { DrawKey } from './drawCache';

/** Neutral grey for independent (non-empire) populated worlds. Matches the
 * grey the sim forces onto the independent empire (Empire ctor, empire.ts). */
export const INDEPENDENT_RING_COLOR = 0x606060;

/** Colony-ring radius in screen pixels: the drawn sprite radius plus the
 * original's owner-ring pad num68 = max(6, (int)(28 / f)) (MainView.1.cs:792-806,
 * f = zoom factor 1/z), so at 100% zoom the ring sits 28 px outside the body. */
export function colonyRingRadius(drawnPx: number, f = 100): number {
    return drawnPx / 2 + Math.max(6, Math.trunc(28 / f));
}

/** Territory disc radius in world units: ~1.2 sectors × 0.25 (task M2e). */
export function territoryRadius(sectorSize: number): number {
    return sectorSize * 1.2 * 0.25;
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
    return toPixiColor(owner.mainColor);
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
        return toPixiColor(empire.mainColor);
    }
    // Task M2e2: the palette is indexed by position in galaxy.empires, which
    // includes the independent empire — match that here so the renderer's
    // per-index colours line up with the layer's.
    const i = ((index + 1) % EMPIRE_FALLBACK_COLORS.length + EMPIRE_FALLBACK_COLORS.length) % EMPIRE_FALLBACK_COLORS.length;
    return EMPIRE_FALLBACK_COLORS[i];
}

/** One Graphics per non-independent empire: all of that empire's territory
 * discs go into it (normal blending, so overlapping discs merge visually). */
class EmpireTerritory {
    graphics: Graphics;
    empire: Empire;
    /** Render: perf pass — the discs are drawn once (all owned systems) and then only shown / hidden: their
     * geometry is zoom-independent world space and the owned-system list is collected once. */
    drawn = false;
    hasDiscs = false;
    constructor(empire: Empire, layer: Container) {
        this.empire = empire;
        this.graphics = new Graphics();
        // Normal (non-additive) blending so overlapping discs do not bloom.
        this.graphics.blendMode = 'normal';
        layer.addChild(this.graphics);
    }
}

export interface EmpireSystems {
    /** The owning empire (always a member of galaxy.empires). */
    empire: Empire;
    /** Indices into galaxy.systems for every system with an owned colony. */
    systems: number[];
}

/** Task M2e3: pure collector — for each non-independent empire in
 * galaxy.empires, the set of systems containing at least one owned
 * planet/moon (`habitat.owner === empire`, task M2e3: ownership is the
 * source of truth, not the empire.colonies bookkeeping list). The independent
 * empire is excluded: its populated worlds are drawn as grey rings by the
 * layer (INDEPENDENT_RING_COLOR), never as territory. Deterministic given
 * the galaxy state; no sim state is mutated. */
export function collectEmpireSystems(galaxy: Galaxy): EmpireSystems[] {
    const byEmpire = new Map<Empire, Set<number>>();
    for (const h of galaxy.habitats) {
        if (h.category !== HabitatCategoryType.Planet && h.category !== HabitatCategoryType.Moon) continue;
        const owner = h.owner ?? h.empire;
        if (owner === null || owner === undefined) continue;
        if (galaxy.independentEmpire !== null && owner === galaxy.independentEmpire) continue;
        if (!galaxy.empires.includes(owner)) continue;
        let set = byEmpire.get(owner);
        if (set === undefined) {
            set = new Set<number>();
            byEmpire.set(owner, set);
        }
        set.add(h.systemIndex);
    }
    const out: EmpireSystems[] = [];
    for (const empire of galaxy.empires) {
        if (empire === galaxy.independentEmpire) continue;
        const set = byEmpire.get(empire);
        if (set === undefined) continue;
        out.push({ empire, systems: [...set].sort((a, b) => a - b) });
    }
    return out;
}

export class EmpireLayer {
    /** World-space layer: territory discs, then colony/marker rings above. */
    root = new Container();
    /** Non-independent empires in galaxy.empires order (index → palette). */
    private empires: Empire[] = [];
    /** Display colour per empire index (own main colour or palette fallback). */
    private colors: number[] = [];
    /** Owned-system indices per empire (task M2e3: from habitat ownership,
     * collected once — the layer is built after createGame, so colonies exist). */
    private empireSystems: EmpireSystems[] = [];
    private territories: Map<Empire, EmpireTerritory> = new Map();
    /** Colony rings, one per owned planet/moon (world space). */
    private colonyRings: Array<{ habitat: Habitat; ring: Graphics; key: DrawKey }> = [];
    /** Owned-system marker rings, one per star whose system has an owned
     * colony (drawn around the star icon at galaxy/sector zoom). */
    private markerRings: Array<{ star: Habitat; owner: Empire; ring: Graphics; key: DrawKey }> = [];
    /** Task M3: gates the territory discs only (not colony/marker rings),
     * driven by the "Empire Territory" overlay toggle in overlayLayer.ts. */
    private territoryEnabled = true;

    /** Show/hide the territory discs (overlayLayer.ts, "Empire Territory"). */
    setTerritoryEnabled(enabled: boolean): void {
        this.territoryEnabled = enabled;
    }

    constructor(private galaxy: Galaxy, world: Container) {
        world.addChild(this.root);
        // Task M2e3: iterate galaxy.empires and draw territory + rings for
        // EVERY empire with owned habitats (ownership via habitat.owner).
        // Previously only one disc was drawn because the territory loop read
        // empire.colonies, which can be empty/stale for some empires even
        // though their habitats carry the owner reference.
        this.empireSystems = collectEmpireSystems(this.galaxy);
        for (const es of this.empireSystems) {
            this.empires.push(es.empire);
            this.colors.push(empireColour(es.empire, this.empires.length - 1));
            this.territories.set(es.empire, new EmpireTerritory(es.empire, this.root));
        }
        // Empires in galaxy.empires that own nothing still get a (empty)
        // territory object so indexOf-based lookups stay aligned.
        for (const empire of this.galaxy.empires) {
            if (empire === this.galaxy.independentEmpire) continue;
            if (this.territories.has(empire)) continue;
            this.empires.push(empire);
            this.colors.push(empireColour(empire, this.empires.length - 1));
            this.territories.set(empire, new EmpireTerritory(empire, this.root));
            console.warn(`Empire "${empire.name}" owns no habitats; its territory will not be drawn`);
        }
        for (const h of galaxy.habitats) {
            if (h.category !== HabitatCategoryType.Planet && h.category !== HabitatCategoryType.Moon) continue;
            if (h.owner === null && h.empire === null) continue;
            const ring = new Graphics();
            ring.blendMode = 'normal';
            ring.visible = false;
            this.root.addChild(ring);
            this.colonyRings.push({ habitat: h, ring, key: new DrawKey() });
        }
        for (const sys of galaxy.systems) {
            const star = sys.systemStar;
            if (star.category === HabitatCategoryType.GasCloud) continue;
            let owner: Empire | null = null;
            for (const h of sys.habitats) {
                if (h.category !== HabitatCategoryType.Planet && h.category !== HabitatCategoryType.Moon) continue;
                const e = h.owner ?? h.empire;
                if (e === null || e === undefined) continue;
                if (e === galaxy.independentEmpire) continue;
                owner = e;
                break;
            }
            if (owner === null) continue;
            const ring = new Graphics();
            ring.blendMode = 'normal';
            ring.visible = false;
            this.root.addChild(ring);
            this.markerRings.push({ star, owner, ring, key: new DrawKey() });
        }
    }

    /** Per-frame update. `z` = camera zoom (px per world unit); the original's
     * system-zoom threshold is factor < 70 (factor = 1/z). */
    update(z: number, cam: Camera): void {
        const factor = 1 / z;
        const atSystemZoom = factor < 70;
        const tRadius = territoryRadius(this.galaxy.sectorSize);

        // Territory discs: galaxy/sector zoom only, hidden at system zoom.
        // Task M2e3: driven by collectEmpireSystems (habitat.owner), not
        // empire.colonies, so every empire with owned habitats draws its disc.
        for (let i = 0; i < this.empires.length; i++) {
            const t = this.territories.get(this.empires[i])!;
            if (atSystemZoom || !this.territoryEnabled) {
                t.graphics.visible = false;
                continue;
            }
            if (!t.drawn) {
                // Every owned system's disc, in the same order as before. Discs off screen draw no pixels, so
                // drawing them all once (instead of re-culling and re-triangulating every frame) looks the same.
                t.drawn = true;
                const es = this.empireSystems.find((e) => e.empire === t.empire);
                if (es !== undefined) {
                    for (const sysIdx of es.systems) {
                        const star = this.galaxy.systems[sysIdx].systemStar;
                        t.graphics.circle(star.xpos, star.ypos, tRadius).fill({
                            color: this.colors[i],
                            alpha: 0.18,
                        });
                        t.hasDiscs = true;
                    }
                }
            }
            t.graphics.visible = t.hasDiscs;
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
            if (h.xpos < cam.x - halfW || h.xpos > cam.x + halfW || h.ypos < cam.y - halfH || h.ypos > cam.y + halfH) {
                cr.ring.visible = false;
                continue;
            }
            // Drawn size matches MainView.drawnSize (planets >= 14 px, moons >= 7 px).
            const drawnPx = h.category === HabitatCategoryType.Moon ? moonDotPx(h.diameter, z) : planetSpritePx(h.diameter, z);
            // Screen px -> world units (the layer lives in world space).
            const r = colonyRingRadius(drawnPx, factor) / z;
            const color = colonyRingColor(h, this.galaxy);
            // Rebuild the geometry only when position, radius, width or colour changed.
            if (cr.key.changed(h.xpos, h.ypos, r, 2 / z, color)) {
                cr.ring.clear();
                cr.ring.circle(h.xpos, h.ypos, r).stroke({ width: 2 / z, color, alpha: 1 });
            }
            cr.ring.visible = true;
        }

        // Owned-system markers: small ring around the star icon of every
        // system containing an owned colony (galaxy/sector zoom only).
        for (const mr of this.markerRings) {
            const star = mr.star;
            if (atSystemZoom) {
                mr.ring.visible = false;
                continue;
            }
            const halfW = cam.width / (2 * z) + 100 / z;
            const halfH = cam.height / (2 * z) + 100 / z;
            if (star.xpos < cam.x - halfW || star.xpos > cam.x + halfW || star.ypos < cam.y - halfH || star.ypos > cam.y + halfH) {
                mr.ring.visible = false;
                continue;
            }
            // Icon side is clamp(diameter*z*30, 2.5, 26) px (SystemView.update);
            // the marker sits just outside it.
            const iconPx = Math.min(Math.max(star.diameter * z * 30, 2.5), 26);
            const r = iconPx * 0.5 + 4;
            const ownerIdx = this.empires.indexOf(mr.owner);
            const color = ownerIdx >= 0 ? this.colors[ownerIdx] : toPixiColor(mr.owner.mainColor);
            if (mr.key.changed(star.xpos, star.ypos, r, 2 / z, color)) {
                mr.ring.clear();
                mr.ring.circle(star.xpos, star.ypos, r).stroke({ width: 2 / z, color, alpha: 1 });
            }
            mr.ring.visible = true;
        }
    }
}