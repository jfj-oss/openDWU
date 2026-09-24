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

/** Neutral grey for independent (non-empire) populated worlds. Matches the
 * grey the sim forces onto the independent empire (Empire ctor, empire.ts). */
export const INDEPENDENT_RING_COLOR = 0x606060;

/** Colony-ring radius in world units: the drawn sprite radius plus 6 px
 * (screen pixels), per the task spec mirroring the original's owner ring. */
export function colonyRingRadius(drawnPx: number): number {
    return drawnPx / 2 + 6;
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
    constructor(empire: Empire, layer: Container) {
        this.empire = empire;
        this.graphics = new Graphics();
        // Normal (non-additive) blending so overlapping discs do not bloom.
        this.graphics.blendMode = 'normal';
        layer.addChild(this.graphics);
    }
}

export class EmpireLayer {
    /** World-space layer: territory discs, then colony/marker rings above. */
    root = new Container();
    /** Non-independent empires in galaxy.empires order (index → palette). */
    private empires: Empire[] = [];
    /** Display colour per empire index (own main colour or palette fallback). */
    private colors: number[] = [];
    private territories: Map<Empire, EmpireTerritory> = new Map();
    /** Colony rings, one per owned planet/moon (world space). */
    private colonyRings: Array<{ habitat: Habitat; ring: Graphics }> = [];
    /** Owned-system marker rings, one per star whose system has an owned
     * colony (drawn around the star icon at galaxy/sector zoom). */
    private markerRings: Array<{ star: Habitat; owner: Empire; ring: Graphics }> = [];

    constructor(private galaxy: Galaxy, world: Container) {
        world.addChild(this.root);
        for (const empire of galaxy.empires) {
            if (empire === galaxy.independentEmpire) continue;
            this.empires.push(empire);
            this.colors.push(empireColour(empire, this.empires.length - 1));
            this.territories.set(empire, new EmpireTerritory(empire, this.root));
            // Task M2e2: every empire with ≥1 owned habitat must draw its
            // territory/rings; flag empires that own nothing.
            if (empire.colonies.length < 1) {
                console.warn(`Empire "${empire.name}" owns no habitats; its territory will not be drawn`);
            }
        }
        for (const h of galaxy.habitats) {
            if (h.category !== HabitatCategoryType.Planet && h.category !== HabitatCategoryType.Moon) continue;
            if (h.owner === null && h.empire === null) continue;
            const ring = new Graphics();
            ring.blendMode = 'normal';
            ring.visible = false;
            this.root.addChild(ring);
            this.colonyRings.push({ habitat: h, ring });
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
            this.markerRings.push({ star, owner, ring });
        }
    }

    /** Per-frame update. `z` = camera zoom (px per world unit); the original's
     * system-zoom threshold is factor < 70 (factor = 1/z). */
    update(z: number, cam: Camera): void {
        const factor = 1 / z;
        const atSystemZoom = factor < 70;
        const tRadius = territoryRadius(this.galaxy.sectorSize);

        // Territory discs: galaxy/sector zoom only, hidden at system zoom.
        for (let i = 0; i < this.empires.length; i++) {
            const t = this.territories.get(this.empires[i])!;
            if (atSystemZoom) {
                t.graphics.visible = false;
                continue;
            }
            t.graphics.clear();
            let any = false;
            for (const colony of t.empire.colonies) {
                const star = this.galaxy.systems[colony.systemIndex].systemStar;
                const halfW = cam.width / 2 + tRadius + 100;
                const halfH = cam.height / 2 + tRadius + 100;
                if (star.xpos < cam.x - halfW || star.xpos > cam.x + halfW || star.ypos < cam.y - halfH || star.ypos > cam.y + halfH) {
                    continue;
                }
                t.graphics.circle(star.xpos, star.ypos, tRadius).fill({
                    color: this.colors[i],
                    alpha: 0.18,
                });
                any = true;
            }
            t.graphics.visible = any;
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
            const halfW = cam.width / 2 + 200 / z;
            const halfH = cam.height / 2 + 200 / z;
            if (h.xpos < cam.x - halfW || h.xpos > cam.x + halfW || h.ypos < cam.y - halfH || h.ypos > cam.y + halfH) {
                cr.ring.visible = false;
                continue;
            }
            // Drawn size matches MainView.drawnSize (planets >= 14 px, moons >= 7 px).
            const drawnPx = h.category === HabitatCategoryType.Moon ? moonDotPx(h.diameter, z) : planetSpritePx(h.diameter, z);
            const r = colonyRingRadius(drawnPx);
            cr.ring.clear();
            cr.ring.circle(h.xpos, h.ypos, r).stroke({ width: 2 / z, color: colonyRingColor(h, this.galaxy), alpha: 1 });
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
            const halfW = cam.width / 2 + 100 / z;
            const halfH = cam.height / 2 + 100 / z;
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
            mr.ring.clear();
            mr.ring.circle(star.xpos, star.ypos, r).stroke({ width: 2 / z, color, alpha: 1 });
            mr.ring.visible = true;
        }
    }
}