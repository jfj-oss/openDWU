// 19r — overlays drawn over the original ship / fighter sprites: the base-game damage overlay (damageOverlay.ts,
// always on; ember / scorch extras behind `damageFx`) and the livery layers (liveries.ts, behind `liveries`).
//
// Every overlay texture lives in the *load-rotated crop* space of the art (the C#'s cached image: the crop square
// turned 90° clockwise, BuiltObjectImageCache.cs LoadSingleBuiltObjectImage), so it is drawn centred on the object at
// rotation = Heading (the raw sprite's Heading + 90° is the same placement). Textures are cached per object and
// rebuilt only when their signature (drawn-size bucket, damage budget, flags) changes, with a per-frame rebuild cap.

import { Container, Sprite, Texture } from 'pixi.js';
import { textureFromRgbaPixels } from './textureCanvas';
import { useMinifyingFilter } from './assets';
import type { ShipArt } from './shipArt';
import {
    HATCH_BRUSH,
    buildDamageLayer,
    cropHullMask,
    damageOverlaySide,
    fighterDamageBudget,
    paintEmbers,
    shipDamageBudget,
    type BlotchCluster,
} from './damageOverlay';
import {
    buildConstructionCoverageMask,
    constructionBuiltWidthPx,
    constructionNoiseAmplitude,
    constructionPercentBuilt,
    constructionRevealFloor,
    constructionSparkMax,
} from './constructionOverlay';

/** A texture from straight-alpha RGBA (no canvas, textureCanvas.ts); `nearest` keeps the C#'s hard pixel clusters
 *  crisp when scaled. */
export function textureFromPixels(rgba: Uint8ClampedArray, w: number, h: number, nearest: boolean): Texture {
    return textureFromRgbaPixels(rgba, w, h, nearest);
}

/** Seconds the ember glow of a fresh hit lasts (damageFx). */
export const EMBER_SECONDS = 4;
/** Overlay rebuilds allowed per frame (the rest wait a frame; the old texture stays up meanwhile). */
export const REBUILDS_PER_FRAME = 6;

interface DamageEntry {
    sig: string;
    tex: Texture | null;
    clusters: BlotchCluster[];
    side: number;
    budget: number;
    /** damageFx: the fresh clusters' ember layer and when the hit landed (performance.now ms). */
    ember: Texture | null;
    emberAt: number;
    seenFrame: number;
}

/** Hull masks per (art, side), shared by every object using that art. */
class HullMasks {
    private m = new Map<string, Uint8Array>();
    get(art: ShipArt, side: number): Uint8Array {
        const key = `${art.url}|${side}`;
        let v = this.m.get(key);
        if (v === undefined) {
            v = cropHullMask(art.rgba, art.w, art.h, art.metrics, side);
            if (this.m.size > 256) this.m.clear();
            this.m.set(key, v);
        }
        return v;
    }
}

export interface DamageSubject {
    /** Random seed (BuiltObjectID / FighterID). */
    seed: number;
    /** Budget for a side (method_106 / method_107). */
    budget(side: number): number;
}

export function shipDamageSubject(bo: { builtObjectID: number; damagedComponentCount: number; components: { items: readonly unknown[] } | null }): DamageSubject | null {
    const total = bo.components?.items.length ?? 0;
    if (!(bo.damagedComponentCount > 0) || total <= 0) return null;
    return { seed: bo.builtObjectID, budget: (s) => shipDamageBudget(s, s, bo.damagedComponentCount, total) };
}

export function fighterDamageSubject(f: { fighterID: number; health: number }): DamageSubject | null {
    if (!(Math.fround(f.health) < 1)) return null;
    return { seed: f.fighterID, budget: (s) => fighterDamageBudget(s, s, f.health) };
}

/**
 * The damage overlays of one layer's objects (ships or fighters). Call begin() each frame, draw() per damaged object
 * after its sprite is placed, end() to hide the unused sprites and drop the textures of objects no longer drawn.
 */
export class DamageOverlays<K extends object> {
    readonly root = new Container();
    private entries = new Map<K, DamageEntry>();
    private sprites: Sprite[] = [];
    private used = 0;
    private frame = 0;
    private rebuilds = 0;
    private masks = new HullMasks();

    constructor(parent: Container) {
        this.root.eventMode = 'none';
        parent.addChild(this.root);
    }

    begin(): void {
        this.used = 0;
        this.frame++;
        this.rebuilds = 0;
    }

    private sprite(tex: Texture): Sprite {
        let s = this.sprites[this.used];
        if (s === undefined) {
            s = new Sprite(tex);
            s.anchor.set(0.5);
            this.sprites.push(s);
            this.root.addChild(s);
        } else if (s.texture !== tex) s.texture = tex;
        this.used++;
        s.visible = true;
        s.alpha = 1;
        s.blendMode = 'normal';
        return s;
    }

    /**
     * Draw (building when needed) the damage overlay of `key` over its sprite: centre (x, y), `heading` (radians),
     * drawn size `px`, zoom `z`. `fx` = the damageFx flag. `alpha` follows the sprite's own alpha.
     */
    draw(key: K, subject: DamageSubject, art: ShipArt, x: number, y: number, heading: number, px: number, z: number, fx: boolean, alpha = 1, now = performance.now()): void {
        const side = damageOverlaySide(px);
        const budget = subject.budget(side);
        if (budget <= 0) return;
        let e = this.entries.get(key);
        const sig = `${side}|${budget}|${fx ? 1 : 0}`;
        if (e === undefined || e.sig !== sig) {
            if (e !== undefined && e.tex !== null && this.rebuilds >= REBUILDS_PER_FRAME) {
                // Over the cap: keep the old texture this frame.
            } else {
                this.rebuilds++;
                const hull = this.masks.get(art, side);
                const layer = buildDamageLayer(subject.seed, side, side, budget, hull, HATCH_BRUSH, fx ? { scorchRadius: Math.max(2, side / 40), scorchAlpha: 0.4 } : {});
                const tex = textureFromPixels(layer.rgba, side, side, true);
                let ember: Texture | null = e?.ember ?? null;
                let emberAt = e?.emberAt ?? -Infinity;
                // A new hit at the same size: the fresh clusters are the tail of the (same-seed) list.
                if (fx && e !== undefined && e.side === side && budget > e.budget && layer.clusters.length > e.clusters.length) {
                    const rgba = new Uint8ClampedArray(side * side * 4);
                    if (paintEmbers(rgba, side, side, hull, layer.clusters, e.clusters.length) > 0) {
                        if (ember !== null) this.retire(ember);
                        ember = textureFromPixels(rgba, side, side, true);
                        emberAt = now;
                    }
                } else if (e !== undefined && e.side !== side) {
                    if (ember !== null) this.retire(ember);
                    ember = null;
                }
                if (e?.tex != null) this.retire(e.tex);
                e = { sig, tex, clusters: layer.clusters, side, budget, ember, emberAt, seenFrame: this.frame };
                this.entries.set(key, e);
            }
        }
        if (e === undefined || e.tex === null) return;
        e.seenFrame = this.frame;
        const scale = px / e.side / z;
        const s = this.sprite(e.tex);
        s.position.set(x, y);
        s.rotation = heading;
        s.scale.set(scale);
        s.alpha = alpha;
        if (fx && e.ember !== null) {
            const t = (now - e.emberAt) / 1000;
            if (t >= 0 && t < EMBER_SECONDS) {
                const g = this.sprite(e.ember);
                g.position.set(x, y);
                g.rotation = heading;
                g.scale.set(scale);
                g.blendMode = 'add';
                // Flicker while it cools.
                g.alpha = alpha * (1 - t / EMBER_SECONDS) * (0.8 + 0.2 * Math.sin(now / 70 + e.side));
            }
        }
    }

    /** Unbind `t` from the pooled sprites, then destroy it. */
    private retire(t: Texture): void {
        for (const s of this.sprites) if (s.texture === t) s.texture = Texture.EMPTY;
        t.destroy(true);
    }

    end(): void {
        for (let i = this.used; i < this.sprites.length; i++) this.sprites[i].visible = false;
        // Objects not drawn for ~2 s give their textures back.
        if (this.frame % 60 === 0) {
            for (const [k, e] of this.entries) {
                if (this.frame - e.seenFrame < 120) continue;
                if (e.tex !== null) this.retire(e.tex);
                if (e.ember !== null) this.retire(e.ember);
                this.entries.delete(k);
            }
        }
    }

    /** Test / capture hook: the overlays drawn this frame. */
    get drawnCount(): number {
        return this.used;
    }
}

/** The construction-reveal subject of a ship / base: percentBuilt (InfoPanel.cs:1382 `val`) and the design's
 *  `Size` stat (method_117's noise-amplitude / spark-length inputs). `null` once nothing is left to build. */
export interface ConstructionSubject {
    percentBuilt: number;
    size: number;
}

export function shipConstructionSubject(bo: { unbuiltComponentCount: number; components: { count: number } | null; size: number }): ConstructionSubject | null {
    const total = bo.components?.count ?? 0;
    if (!(bo.unbuiltComponentCount > 0) || total <= 0) return null;
    return { percentBuilt: constructionPercentBuilt(bo.unbuiltComponentCount, total), size: bo.size };
}

/** Cap on the construction-reveal mask side (zoom-1 drawn px; real designs stay far below it). */
const MAX_CONSTRUCTION_MASK_SIDE = 2048;

interface ConstructionEntry {
    sig: string;
    tex: Texture | null;
    seenFrame: number;
}

/**
 * The construction reveal of one layer's objects (ships or bases — `Controls/MainView.cs:3259` method_73 runs
 * Main.Part11.cs method_115 → method_117 for any `BuiltObject` with UnbuiltComponentCount > 0, a station a construction
 * ship is building included): the "not yet built" part of the image is genuinely absent rather than painted over,
 * matching the C#'s `MakeTransparent(Color.Black)`. Call begin() each frame, texture() per drawn object (the texture
 * its sprite draws this frame instead of the plain art, or null for the plain art), end() to drop stale textures.
 *
 * Geometry: method_117 erodes the cached image MainView.1.cs 940-952 hands method_73 — PrepareBuiltObjectImageNEW(...,
 * zoom 1.0): the art's crop square, turned 90° clockwise at load (BuiltObjectImageCache.LoadSingleBuiltObjectImage),
 * scaled to its zoom-1 drawn size (DetermineBuiltObjectSizeNEW at f = 1) — from its left edge, before the per-heading
 * rotation; that texture is then scaled to the current zoom. So the erosion mask is built at the zoom-1 size `unitPx`
 * (independent of the current zoom), in the same load-rotated crop space as the damage overlays' textures, and
 * covers the whole crop square.
 *
 * Render perf: the mask is baked into one texture per object (the art's crop square at the art's own resolution, × the
 * mask's alpha, sampled nearest from the drawn-size mask, as cropHullMask maps the two spaces), rebuilt only when the
 * mask's signature changes, and drawn as an ordinary batched sprite with the plain sprite's own transform. (A Pixi
 * sprite mask per object costs an offscreen pass each — ~50 a frame at a shipyard with a long build queue.)
 */
export class ConstructionOverlays<K extends object> {
    private entries = new Map<K, ConstructionEntry>();
    private used = new Set<K>();
    private frame = 0;
    private rebuilds = 0;

    begin(): void {
        this.used.clear();
        this.frame++;
        this.rebuilds = 0;
    }

    /**
     * `key`'s construction-reveal texture for this frame (building it when needed): the art's crop square
     * (metrics.cropSide², raw orientation), to draw on its sprite with anchor 0.5 in place of `art.texture` (same
     * position, rotation and scale) — or null when nothing is left to build (draw the plain art). `unitPx` is the
     * drawn size at zoom factor 1 (builtObjectSizePx(..., f = 1), the C#'s bitmap side); `floor` is method_116's reveal floor (0 = the map's method_115; 0.4 on a build-queue / info-panel
     * thumbnail — not used yet, no thumbnail is Pixi-drawn).
     */
    texture(key: K, subject: ConstructionSubject | null, art: ShipArt, unitPx: number, floor = 0): Texture | null {
        if (subject === null) return null;
        // Debug / diagnostics: `window.__dwuNoConstructionMask = true` shows the unmasked sprite.
        if ((globalThis as { __dwuNoConstructionMask?: boolean }).__dwuNoConstructionMask === true) return null;
        this.used.add(key);
        // (Galaxy.CreateBitmapSafely's bitmap is at least 1 × 1; capped so a huge design cannot allocate a huge mask.)
        const side = Math.max(1, Math.min(MAX_CONSTRUCTION_MASK_SIDE, Math.trunc(unitPx)));
        const percent = constructionRevealFloor(subject.percentBuilt, floor);
        let e = this.entries.get(key);
        const sig = `${side}|${percent.toFixed(4)}|${subject.size}|${art.url}`;
        if (e === undefined || e.sig !== sig) {
            if (e !== undefined && e.tex !== null && this.rebuilds >= REBUILDS_PER_FRAME) {
                // Over the cap: keep the old texture this frame.
            } else {
                this.rebuilds++;
                const mask = buildConstructionCoverageMask(side, side, constructionBuiltWidthPx(side, percent), constructionNoiseAmplitude(subject.size), constructionSparkMax(subject.size));
                const crop = art.metrics.cropSide;
                const tex = textureFromPixels(bakeConstructionReveal(art, mask, side), crop, crop, false);
                useMinifyingFilter(tex); // sampled like the art itself (trilinear)
                if (e?.tex != null) e.tex.destroy(true);
                e = { sig, tex, seenFrame: this.frame };
                this.entries.set(key, e);
            }
        }
        if (e === undefined || e.tex === null) return null;
        e.seenFrame = this.frame;
        return e.tex;
    }

    end(): void {
        // Objects not drawn for ~2 s give their textures back (their sprites are hidden, and get the plain art or a
        // fresh texture before they are drawn again).
        if (this.frame % 60 === 0) {
            for (const [k, e] of this.entries) {
                if (this.frame - e.seenFrame < 120) continue;
                if (e.tex !== null) e.tex.destroy(true);
                this.entries.delete(k);
            }
        }
    }

    /** Test / capture hook: how many objects drew a construction reveal this frame. */
    get appliedCount(): number {
        return this.used.size;
    }
}

/**
 * The art's crop square (cropSide², raw orientation, straight-alpha RGBA) with method_117's erosion applied: raw crop
 * texel (bx, by) is load-rotated (x', y') = (cropSide − 1 − by, bx) (cropHullMask's mapping, inverted), and keeps its
 * alpha where the zoom-1 coverage mask (`mask`, side × side, 255 = built) at (x', y') × side / cropSide is set. Pure.
 */
export function bakeConstructionReveal(art: { rgba: ArrayLike<number>; w: number; h: number; metrics: { cropSide: number; cropCenterX: number; cropCenterY: number } }, mask: ArrayLike<number>, side: number): Uint8ClampedArray {
    const { rgba, w, h } = art;
    const crop = art.metrics.cropSide;
    const left = Math.round(art.metrics.cropCenterX - crop / 2);
    const top = Math.round(art.metrics.cropCenterY - crop / 2);
    const out = new Uint8ClampedArray(crop * crop * 4);
    const k = side / crop;
    // Mask column / row per crop coordinate (nearest, texel centres).
    const idx = new Int32Array(crop);
    for (let t = 0; t < crop; t++) idx[t] = Math.min(side - 1, Math.floor((t + 0.5) * k));
    for (let by = 0; by < crop; by++) {
        const y = top + by;
        if (y < 0 || y >= h) continue;
        const mx = idx[crop - 1 - by]; // x' = cropSide − 1 − by
        for (let bx = 0; bx < crop; bx++) {
            const x = left + bx;
            if (x < 0 || x >= w) continue;
            if (mask[idx[bx] * side + mx] === 0) continue; // y' = bx
            const s = (y * w + x) * 4;
            const o = (by * crop + bx) * 4;
            out[o] = rgba[s];
            out[o + 1] = rgba[s + 1];
            out[o + 2] = rgba[s + 2];
            out[o + 3] = rgba[s + 3];
        }
    }
    return out;
}
