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
import { buildConstructionMaskLayer, constructionPercentBuilt, constructionRevealFloor } from './constructionOverlay';

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

interface ConstructionEntry {
    sig: string;
    tex: Texture | null;
    seenFrame: number;
}

/**
 * The construction reveal of one layer's objects (ships or bases — `Controls/MainView.cs:3259` runs this for any
 * `BuiltObject`, a station a construction ship is building included): the "not yet built" region is genuinely absent
 * rather than painted over, matching the C#'s `MakeTransparent(Color.Black)`. Call begin() each frame, texture() per
 * drawn object (the texture its sprite draws this frame instead of the plain art, or null for the plain art), end()
 * to drop stale textures.
 *
 * Render perf: this used to be a Pixi sprite mask (`target.mask`, an AlphaMask) per object, and Pixi draws every
 * sprite-masked object through its own offscreen pass (render target, clear, blit) — ~50 passes a frame at a
 * shipyard with a long build queue (the Ancient Guardians' homeworld). The masked result is baked into one small
 * texture per object instead (rebuilt only when the mask's signature changes), drawn as an ordinary batched sprite.
 * The geometry is the mask's: a side × side square (one mask texel per art texel — the mask sprite copied the ship
 * sprite's scale) centred on the crop centre, the art × the mask's alpha inside it, nothing outside.
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
     * `key`'s construction-reveal texture for this frame (building it when needed), to draw on its sprite with anchor
     * 0.5 in place of `art.texture` (same position, rotation and scale) — or null when nothing is left to build (draw
     * the plain art). `px` is the drawn size; `floor` is method_116's reveal floor (0 = the map's method_115; 0.4 on a
     * build-queue / info-panel thumbnail — not used yet, no thumbnail is Pixi-drawn).
     */
    texture(key: K, subject: ConstructionSubject | null, art: ShipArt, px: number, floor = 0): Texture | null {
        if (subject === null) return null;
        // Debug / diagnostics: `window.__dwuNoConstructionMask = true` shows the unmasked sprite.
        if ((globalThis as { __dwuNoConstructionMask?: boolean }).__dwuNoConstructionMask === true) return null;
        this.used.add(key);
        const side = damageOverlaySide(px);
        const percent = constructionRevealFloor(subject.percentBuilt, floor);
        let e = this.entries.get(key);
        const sig = `${side}|${percent.toFixed(4)}|${subject.size}|${art.url}`;
        if (e === undefined || e.sig !== sig) {
            if (e !== undefined && e.tex !== null && this.rebuilds >= REBUILDS_PER_FRAME) {
                // Over the cap: keep the old texture this frame.
            } else {
                this.rebuilds++;
                const mask = buildConstructionMaskLayer(side, side, percent, subject.size);
                const tex = textureFromPixels(bakeConstructionReveal(art, mask, side), side, side, false);
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
 * The side × side straight-alpha RGBA of what the sprite mask showed: the art's pixels under the mask square (mask
 * texel (i, j) covers art texels from (cropCenterX - side / 2 + i, cropCenterY - side / 2 + j), sampled bilinearly in
 * premultiplied space when that origin is a half texel off the art grid) times the mask's alpha. Pure.
 */
export function bakeConstructionReveal(art: { rgba: ArrayLike<number>; w: number; h: number; metrics: { cropCenterX: number; cropCenterY: number } }, mask: ArrayLike<number>, side: number): Uint8ClampedArray {
    const out = new Uint8ClampedArray(side * side * 4);
    const { rgba, w, h } = art;
    // Art texel coordinate of mask texel (0, 0)'s centre, minus 0.5: the bilinear sample origin.
    const ox = art.metrics.cropCenterX - side / 2;
    const oy = art.metrics.cropCenterY - side / 2;
    const fx = ox - Math.floor(ox);
    const fy = oy - Math.floor(oy);
    const x0 = Math.floor(ox);
    const y0 = Math.floor(oy);
    const exact = fx === 0 && fy === 0;
    for (let j = 0; j < side; j++) {
        for (let i = 0; i < side; i++) {
            const o = (j * side + i) * 4;
            const ma = mask[o + 3];
            if (ma === 0) continue;
            const ax = x0 + i;
            const ay = y0 + j;
            if (exact) {
                if (ax < 0 || ay < 0 || ax >= w || ay >= h) continue;
                const s = (ay * w + ax) * 4;
                out[o] = rgba[s];
                out[o + 1] = rgba[s + 1];
                out[o + 2] = rgba[s + 2];
                out[o + 3] = (rgba[s + 3] * ma) / 255;
                continue;
            }
            // Bilinear over the (up to) four art texels the mask texel straddles, premultiplied.
            let r = 0;
            let g = 0;
            let b = 0;
            let a = 0;
            for (let dy = 0; dy < 2; dy++) {
                const wy = dy === 0 ? 1 - fy : fy;
                const yy = ay + dy;
                if (wy === 0 || yy < 0 || yy >= h) continue;
                for (let dx = 0; dx < 2; dx++) {
                    const wx = dx === 0 ? 1 - fx : fx;
                    const xx = ax + dx;
                    if (wx === 0 || xx < 0 || xx >= w) continue;
                    const s = (yy * w + xx) * 4;
                    const k = wx * wy * rgba[s + 3];
                    r += rgba[s] * k;
                    g += rgba[s + 1] * k;
                    b += rgba[s + 2] * k;
                    a += k;
                }
            }
            if (a <= 0) continue;
            out[o] = r / a;
            out[o + 1] = g / a;
            out[o + 2] = b / a;
            out[o + 3] = (a * ma) / 255;
        }
    }
    return out;
}
