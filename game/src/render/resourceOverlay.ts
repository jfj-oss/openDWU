// [dw2overlays] Resources overlay (Improvements): the resources the player knows of, as their icons in a ring round each
// system's star (galaxy / sector zoom, f >= 70) or each habitat (system zoom). Every icon sits in front of a pie showing
// its abundance as a share, in the rarity's colour (resourceOverlayLayout.ts). A ring shows up to six icons, the rarest /
// most abundant first; where neighbouring rings would crowd each other on screen, a system keeps fewer (never fewer than
// one). With a resource picked in the row's "…" panel, only the systems and habitats that have it, one icon each, and
// its system rings in the rarity colour. Hover: the system's / habitat's resource list (mainView.ts tooltip).
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
import { overlayActive, overlayOptionsOf, type MapOverlayState } from '../ui/mapOverlays';
import { SpritePool, abundancePieTexture, drawnHabitatPx, resourceIconTexture, ringTexture, sizeSprite } from './dw2OverlayArt';
import {
    RARITY_COLORS,
    habitatIcons,
    knownResourceIndexFor,
    resourceTooltipText,
    systemIcons,
    systemsForFilter,
    type KnownResourceIndex,
    type KnownSystemResources,
    type ResourceRarity,
} from './resourceOverlayData';
import { RING_MAX_ICONS, abundancePieStep, chooseRingCounts, pieDiscPx, ringAngle, ringRadiusPx, type RingPlacement, type RingSite } from './resourceOverlayLayout';
import { MAX_SOLAR_SYSTEM_SIZE } from '../sim/movement';
import { localViewerEmpire } from '../localViewer';

/** The ring texture's stroke centre sits at 28 of its 32 px half-width (dw2OverlayArt.ts ringTexture). */
const RING_TEX_RADIUS = 28 / 32;

/** Icon width in screen px at zoom factor f (never below 10 px: the icons stay readable at the galaxy view). */
export function resourceIconPx(f: number): number {
    if (f >= 2500) return 10;
    if (f >= 900) return 12;
    return 15;
}

/** One icon of a ring: the resource, its abundance (0..1000) and rarity. */
interface RingIcon {
    resourceId: number;
    abundance: number;
    rarity: ResourceRarity;
}

/** One body's ring to place: the body's centre (world), its drawn width (screen px), its icons and its hover text. */
interface RingRow {
    wx: number;
    wy: number;
    bodyPx: number;
    icons: readonly RingIcon[];
    title: string;
    resources: Parameters<typeof resourceTooltipText>[1];
    /** The LOD's answer: the icons the ring keeps and the phase it is turned to. */
    count: number;
    phase: number;
}

interface DrawnCluster {
    /** The body's centre (world) and the ring's outer reach (world units): the hover area. */
    cx: number;
    cy: number;
    r: number;
    /** Icons the ring shows (fewer than its resources where it would crowd a neighbour). */
    icons: number;
    title: string;
    resources: Parameters<typeof resourceTooltipText>[1];
}

export class ResourceOverlay {
    readonly root = new Container();
    private rings = new SpritePool();
    private pies = new SpritePool();
    private icons = new SpritePool();
    private index: KnownResourceIndex | null = null;
    private indexAt = -Infinity;
    private frame = 0;
    /** What the sprites were last placed for. */
    private built = { valid: false, z: 0, x: 0, y: 0, w: 0, h: 0, filter: null as number | null, indexAt: 0, tex: 0 };
    /** The rings drawn last, for the hover text (and the audit's icons-per-ring count). */
    private clusters: DrawnCluster[] = [];
    /** Scratch: where each ring goes (chooseRingCounts), in placement order. */
    private ringCounts: RingPlacement[] = [];
    /** The galaxy / sector layout kept for the zoom, filter and index it was made for. */
    private lodKey: { z: number; filter: number | null; index: KnownResourceIndex } | null = null;
    private lodRows: RingRow[] = [];
    motion: MotionInterpolator | null = null;

    constructor(
        private galaxy: Galaxy,
        parent: Container,
        private state: MapOverlayState,
    ) {
        this.root.addChild(this.rings.root, this.pies.root, this.icons.root);
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
        const player = localViewerEmpire(this.galaxy);
        if (!overlayActive(this.state, 'resources') || player === null) {
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
        const ringTex = ringTexture();
        this.rings.begin();
        this.pies.begin();
        this.icons.begin();
        this.clusters = [];
        const px = resourceIconPx(1 / z);
        const rows = this.layoutRows(index, z, px, filter, systemZoom, cam);
        // Galaxy / sector: the layout covers every system; only the ones in view are drawn.
        const halfW = cam.width / (2 * z);
        const halfH = cam.height / (2 * z);
        const pad = systemZoom ? MAX_SOLAR_SYSTEM_SIZE : 60 / z;
        for (const row of rows) {
            if (!systemZoom && (row.wx < cam.x - halfW - pad || row.wx > cam.x + halfW + pad || row.wy < cam.y - halfH - pad || row.wy > cam.y + halfH + pad)) continue;
            this.placeRow(row, z, px, ringTex, filter);
        }
        this.rings.end();
        this.pies.end();
        this.icons.end();
    }

    /** The rings to draw for the view. Galaxy / sector: one ring per system, laid out (screen-space LOD) once per zoom,
     * filter and index, so a pan costs only the drawing. System zoom: the habitats of the systems in view, laid out
     * each frame (the planets orbit). */
    private layoutRows(index: KnownResourceIndex, z: number, px: number, filter: number | null, systemZoom: boolean, cam: Camera): RingRow[] {
        if (!systemZoom) {
            const k = this.lodKey;
            if (k !== null && k.z === z && k.filter === filter && k.index === index) return this.lodRows;
            const rows: RingRow[] = [];
            for (const sys of systemsForFilter(index, filter)) this.collectSystemRow(sys, filter, z, rows);
            this.placeLayout(rows, z, px);
            this.lodRows = rows;
            this.lodKey = { z, filter, index };
            return rows;
        }
        const rows: RingRow[] = [];
        const halfW = cam.width / (2 * z);
        const halfH = cam.height / (2 * z);
        for (const sys of systemsForFilter(index, filter)) {
            const s = sys.star;
            if (s.xpos < cam.x - halfW - MAX_SOLAR_SYSTEM_SIZE || s.xpos > cam.x + halfW + MAX_SOLAR_SYSTEM_SIZE || s.ypos < cam.y - halfH - MAX_SOLAR_SYSTEM_SIZE || s.ypos > cam.y + halfH + MAX_SOLAR_SYSTEM_SIZE) continue;
            this.collectHabitatRows(sys, filter, z, rows);
        }
        this.placeLayout(rows, z, px);
        return rows;
    }

    private collectSystemRow(sys: KnownSystemResources, filter: number | null, z: number, rows: RingRow[]): void {
        const list = systemIcons(sys, filter, RING_MAX_ICONS);
        if (list.length === 0) return;
        const s = sys.star;
        rows.push({
            wx: s.xpos,
            wy: s.ypos,
            bodyPx: Math.max(6, drawnHabitatPx(s, z)),
            icons: list.map((r) => ({ resourceId: r.resourceId, abundance: r.maxAbundance, rarity: r.rarity })),
            title: `${s.name}: known resources`,
            resources: filter === null ? sys.resources : list,
            count: 0,
            phase: 0,
        });
    }

    private collectHabitatRows(sys: KnownSystemResources, filter: number | null, z: number, rows: RingRow[]): void {
        for (const hr of sys.habitats) {
            const list = habitatIcons(hr, filter);
            if (list.length === 0) continue;
            const h: Habitat = hr.habitat;
            const p = this.motion !== null ? this.motion.habitatPos(h) : { x: h.xpos, y: h.ypos };
            rows.push({
                wx: p.x,
                wy: p.y,
                bodyPx: Math.max(4, drawnHabitatPx(h, z)),
                icons: list,
                title: `${h.name}: known resources`,
                resources: filter === null ? hr.resources : list,
                count: 0,
                phase: 0,
            });
        }
    }

    /** Screen-space LOD over the rows (most icons first, so the rich rings keep theirs): each row gets its icon count and
     * phase. */
    private placeLayout(rows: RingRow[], z: number, px: number): void {
        const sites: RingSite[] = rows.map((r) => ({ x: r.wx * z, y: r.wy * z, bodyPx: r.bodyPx, want: r.icons.length }));
        const order = rows.map((_, i) => i).sort((a, b) => rows[b].icons.length - rows[a].icons.length || a - b);
        chooseRingCounts(
            order.map((i) => sites[i]),
            px,
            this.ringCounts,
        );
        for (let k = 0; k < order.length; k++) {
            rows[order[k]].count = this.ringCounts[k].count;
            rows[order[k]].phase = this.ringCounts[k].phase;
        }
    }

    /** One body's ring: its first `count` icons, turned by `phase`, with the highlight ring when a resource is picked. */
    private placeRow(row: RingRow, z: number, px: number, ringTex: Texture | null, filter: number | null): void {
        const n = row.count;
        const disc = pieDiscPx(px);
        const R = ringRadiusPx(n, row.bodyPx, disc);
        if (filter !== null && ringTex !== null) {
            const ring = this.rings.take(ringTex);
            ring.position.set(row.wx, row.wy);
            sizeSprite(ring, (2 * R) / RING_TEX_RADIUS, z); // the highlight runs through the icons' centres
            ring.tint = RARITY_COLORS[row.icons[0].rarity];
            ring.alpha = 0.85;
        }
        for (let i = 0; i < n; i++) {
            const a = ringAngle(i, n, row.phase);
            this.placeIcon(row.wx + (Math.cos(a) * R) / z, row.wy + (Math.sin(a) * R) / z, row.icons[i], px, z);
        }
        this.clusters.push({ cx: row.wx, cy: row.wy, r: (R + disc / 2) / z, icons: n, title: row.title, resources: row.resources });
    }

    /** One icon at (x, y) in front of its abundance pie (a dark disc with the rarity-coloured share). */
    private placeIcon(x: number, y: number, it: RingIcon, px: number, z: number): void {
        const disc = pieDiscPx(px);
        const pieTex = abundancePieTexture(RARITY_COLORS[it.rarity], abundancePieStep(it.abundance));
        const pie = this.pies.take(pieTex ?? Texture.WHITE);
        pie.position.set(x, y);
        sizeSprite(pie, disc, z);
        pie.tint = pieTex !== null ? 0xffffff : 0x0a0d12; // headless: no pie texture, a dark disc
        pie.alpha = pieTex !== null ? 1 : 0.8;

        const def = this.galaxy.resourceSystem.byId.get(it.resourceId);
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
            s.tint = RARITY_COLORS[it.rarity];
            s.alpha = 0.9;
        }
    }

    /** The hover text of the ring under world (wx, wy), or null. */
    hitTest(wx: number, wy: number): string | null {
        if (!this.root.visible) return null;
        const name = (id: number): string => this.galaxy.resourceSystem.byId.get(id)?.name ?? `#${id}`;
        for (const c of this.clusters) {
            const dx = wx - c.cx;
            const dy = wy - c.cy;
            if (dx * dx + dy * dy <= c.r * c.r) return resourceTooltipText(c.title, c.resources, name);
        }
        return null;
    }
}
