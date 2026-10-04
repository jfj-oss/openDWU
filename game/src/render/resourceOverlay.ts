// [dw2overlays] Resources overlay (Improvements): the resources the player knows of, as their icons with a bar for the
// abundance in the rarity's colour (resourceOverlayData.ts). Galaxy / sector zoom (f >= 70): one row of icons under each
// system star (the rarest / most abundant first, fewer as the view widens). System zoom: one row under each habitat. With
// a resource picked in the row's "…" panel, only the systems and habitats that have it, its system rings in the
// rarity colour. Hover: the system's / habitat's resource list (mainView.ts tooltip).
//
// Cost: the index is re-read twice a second (a hash of the ResourceMap bits; rebuilt only when it changed). The sprites
// are placed again only when the camera, the index or the filter changed — at system zoom every frame, for the systems
// in view only (the planets orbit). Nothing is allocated per frame otherwise.

import { Container, Texture } from 'pixi.js';
import type { Camera } from './camera';
import type { Galaxy } from '../sim/galaxy';
import type { Habitat } from '../sim/types';
import type { MotionInterpolator } from './renderInterp';
import { fogOf } from './fog';
import { improvementOverlayOn, overlayOptionsOf, type MapOverlayState } from '../ui/mapOverlays';
import { SpritePool, drawnHabitatPx, resourceIconTexture, ringTexture, sizeSprite } from './dw2OverlayArt';
import {
    RARITY_COLORS,
    habitatIcons,
    knownResourceIndexFor,
    maxSystemIcons,
    resourceTooltipText,
    systemIcons,
    systemsForFilter,
    type KnownResourceIndex,
    type KnownSystemResources,
} from './resourceOverlayData';
import { MAX_SOLAR_SYSTEM_SIZE } from '../sim/movement';

/** Icon width in screen px at zoom factor f. */
export function resourceIconPx(f: number): number {
    if (f >= 2500) return 10;
    if (f >= 900) return 12;
    return 15;
}

/** Where a cluster of `n` icons of `px` sits: centred under (x, y) `below` px down; returns the world-space left edge of
 * the first icon centre and the step between centres. */
export function iconRowLayout(x: number, y: number, n: number, px: number, below: number, z: number): { x0: number; y: number; step: number } {
    const step = (px + 3) / z;
    return { x0: x - ((n - 1) * step) / 2, y: y + (below + px / 2) / z, step };
}

interface DrawnCluster {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    title: string;
    resources: Parameters<typeof resourceTooltipText>[1];
}

export class ResourceOverlay {
    readonly root = new Container();
    private rings = new SpritePool();
    private bars = new SpritePool();
    private icons = new SpritePool();
    private index: KnownResourceIndex | null = null;
    private indexAt = -Infinity;
    private frame = 0;
    /** What the sprites were last placed for. */
    private built = { valid: false, z: 0, x: 0, y: 0, w: 0, h: 0, filter: null as number | null, indexAt: 0, tex: 0 };
    private clusters: DrawnCluster[] = [];
    motion: MotionInterpolator | null = null;

    constructor(
        private galaxy: Galaxy,
        parent: Container,
        private state: MapOverlayState,
    ) {
        this.root.addChild(this.rings.root, this.bars.root, this.icons.root);
        this.root.visible = false;
        parent.addChild(this.root);
    }

    private hide(): void {
        if (this.root.visible) {
            this.root.visible = false;
            this.clusters = [];
            this.built.valid = false;
        }
    }

    update(z: number, cam: Camera): void {
        const player = this.galaxy.playerEmpire;
        if (!improvementOverlayOn(this.state, 'resources') || player === null) {
            this.hide();
            return;
        }
        const reveal = fogOf(this.galaxy).reveal;
        if (this.frame++ % 30 === 0 || this.index === null) {
            const idx = knownResourceIndexFor(this.galaxy, player, reveal);
            if (idx !== this.index) {
                this.index = idx;
                this.indexAt = performance.now();
            }
        }
        const f = 1 / z;
        const filter = overlayOptionsOf(this.state).resourceFilter;
        const systemZoom = f < 70;
        // Galaxy / sector zoom: static positions; rebuild only on a change.
        const k = this.built;
        if (!systemZoom && k.valid && k.z === z && k.x === cam.x && k.y === cam.y && k.w === cam.width && k.h === cam.height && k.filter === filter && k.indexAt === this.indexAt && k.tex === this.texturesPending) {
            this.root.visible = true;
            return;
        }
        k.valid = true;
        k.z = z;
        k.x = cam.x;
        k.y = cam.y;
        k.w = cam.width;
        k.h = cam.height;
        k.filter = filter;
        k.indexAt = this.indexAt;
        k.tex = this.texturesPending;
        this.build(z, cam, filter, systemZoom);
        this.root.visible = true;
    }

    private texturesPending = 0;
    private iconTex(pictureRef: number): Texture | null {
        const t = resourceIconTexture(pictureRef, () => {
            this.texturesPending++; // a new texture: the next frame rebuilds
        });
        return t;
    }

    private build(z: number, cam: Camera, filter: number | null, systemZoom: boolean): void {
        const index = this.index!;
        const f = 1 / z;
        const ringTex = ringTexture();
        this.rings.begin();
        this.bars.begin();
        this.icons.begin();
        this.clusters = [];
        const px = resourceIconPx(f);
        const halfW = cam.width / (2 * z);
        const halfH = cam.height / (2 * z);
        const pad = systemZoom ? MAX_SOLAR_SYSTEM_SIZE : 60 / z;
        const max = maxSystemIcons(f);
        for (const sys of systemsForFilter(index, filter)) {
            const s = sys.star;
            if (s.xpos < cam.x - halfW - pad || s.xpos > cam.x + halfW + pad || s.ypos < cam.y - halfH - pad || s.ypos > cam.y + halfH + pad) continue;
            if (systemZoom) {
                this.buildSystemHabitats(sys, filter, z, px);
                continue;
            }
            const list = systemIcons(sys, filter, max);
            if (list.length === 0) continue;
            const starPx = Math.max(6, drawnHabitatPx(s, z));
            if (filter !== null && ringTex !== null) {
                const ring = this.rings.take(ringTex);
                ring.position.set(s.xpos, s.ypos);
                sizeSprite(ring, starPx + 14, z);
                ring.tint = RARITY_COLORS[list[0].rarity];
                ring.alpha = 0.85;
            }
            const L = iconRowLayout(s.xpos, s.ypos, list.length, px, starPx / 2 + 5, z);
            list.forEach((r, i) => this.placeIcon(L.x0 + i * L.step, L.y, r.resourceId, r.maxAbundance, r.rarity, px, z));
            this.clusters.push({
                x0: L.x0 - px / 2 / z,
                x1: L.x0 + (list.length - 1) * L.step + px / 2 / z,
                y0: L.y - px / 2 / z,
                y1: L.y + (px / 2 + 5) / z,
                title: `${s.name}: known resources`,
                resources: filter === null ? sys.resources : list,
            });
        }
        this.rings.end();
        this.bars.end();
        this.icons.end();
    }

    private buildSystemHabitats(sys: KnownSystemResources, filter: number | null, z: number, px: number): void {
        const ringTex = ringTexture();
        for (const hr of sys.habitats) {
            const list = habitatIcons(hr, filter);
            if (list.length === 0) continue;
            const h: Habitat = hr.habitat;
            const p = this.motion !== null ? this.motion.habitatPos(h) : { x: h.xpos, y: h.ypos };
            const bodyPx = Math.max(4, drawnHabitatPx(h, z));
            if (filter !== null && ringTex !== null) {
                const ring = this.rings.take(ringTex);
                ring.position.set(p.x, p.y);
                sizeSprite(ring, bodyPx + 16, z);
                ring.tint = RARITY_COLORS[list[0].rarity];
                ring.alpha = 0.85;
            }
            const L = iconRowLayout(p.x, p.y, list.length, px, bodyPx / 2 + 4, z);
            list.forEach((r, i) => this.placeIcon(L.x0 + i * L.step, L.y, r.resourceId, r.abundance, r.rarity, px, z));
            this.clusters.push({
                x0: L.x0 - px / 2 / z,
                x1: L.x0 + (list.length - 1) * L.step + px / 2 / z,
                y0: L.y - px / 2 / z,
                y1: L.y + (px / 2 + 5) / z,
                title: `${h.name}: known resources`,
                resources: filter === null ? hr.resources : list,
            });
        }
    }

    /** One icon at (x, y) with its abundance bar (dark track, rarity-coloured fill) under it. */
    private placeIcon(x: number, y: number, resourceId: number, abundance: number, rarity: number, px: number, z: number): void {
        const def = this.galaxy.resourceSystem.byId.get(resourceId);
        const tex = def !== undefined ? this.iconTex(def.pictureRef) : null;
        if (tex !== null) {
            const s = this.icons.take(tex);
            s.position.set(x, y);
            // Fit the icon's longer side to px.
            const k = px / z / Math.max(tex.width || 1, tex.height || 1);
            s.scale.set(k, k);
            s.alpha = 1;
            s.tint = 0xffffff;
        } else {
            // Until the art loads (or headless): a rarity-coloured square.
            const s = this.icons.take(Texture.WHITE);
            s.position.set(x, y);
            s.scale.set((px * 0.6) / z);
            s.tint = RARITY_COLORS[rarity];
            s.alpha = 0.9;
        }
        const barY = y + (px / 2 + 2.5) / z;
        const track = this.bars.take(Texture.WHITE);
        track.position.set(x, barY);
        track.scale.set(px / z, 3 / z);
        track.tint = 0x0a0d12;
        track.alpha = 0.8;
        const frac = Math.min(1, Math.max(0.08, abundance / 1000));
        const fill = this.bars.take(Texture.WHITE);
        fill.position.set(x - (px * (1 - frac)) / 2 / z, barY);
        fill.scale.set((px * frac) / z, 2 / z);
        fill.tint = RARITY_COLORS[rarity];
        fill.alpha = 1;
    }

    /** The hover text of the icon row under world (wx, wy), or null. */
    hitTest(wx: number, wy: number): string | null {
        if (!this.root.visible) return null;
        const name = (id: number): string => this.galaxy.resourceSystem.byId.get(id)?.name ?? `#${id}`;
        for (const c of this.clusters) {
            if (wx >= c.x0 && wx <= c.x1 && wy >= c.y0 && wy <= c.y1) return resourceTooltipText(c.title, c.resources, name);
        }
        return null;
    }
}

