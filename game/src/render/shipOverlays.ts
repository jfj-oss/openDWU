// 19r — overlays drawn over the original ship / fighter sprites: the base-game damage overlay (damageOverlay.ts,
// always on; ember / scorch extras behind `damageFx`) and the livery layers (liveries.ts, behind `liveries`).
//
// Every overlay texture lives in the *load-rotated crop* space of the art (the C#'s cached image: the crop square
// turned 90° clockwise, BuiltObjectImageCache.cs LoadSingleBuiltObjectImage), so it is drawn centred on the object at
// rotation = Heading (the raw sprite's Heading + 90° is the same placement). Textures are cached per object and
// rebuilt only when their signature (drawn-size bucket, damage budget, flags) changes, with a per-frame rebuild cap.

import { Container, Sprite, Texture } from 'pixi.js';
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

/** A canvas-backed texture from RGBA; `nearest` keeps the C#'s hard pixel clusters crisp when scaled. */
export function textureFromPixels(rgba: Uint8ClampedArray, w: number, h: number, nearest: boolean): Texture {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (ctx === null) throw new Error('shipOverlays: no 2d context');
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
    const t = Texture.from(c);
    if (nearest) t.source.scaleMode = 'nearest';
    return t;
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
    side: number;
    seenFrame: number;
}

/**
 * The construction-reveal masks of one layer's objects (ships or bases — `Controls/MainView.cs:3259` runs this
 * for any `BuiltObject`, a station a construction ship is building included). Call begin() each frame, apply()
 * per object right after its own sprite's transform (position/rotation/scale) is set for this frame — it mirrors
 * that transform onto the mask sprite so the erosion lines up with the drawn art — end() to drop stale masks.
 *
 * Unlike DamageOverlays (an additive overlay drawn over the sprite), this assigns a Pixi sprite mask
 * (`target.mask = …`, using the mask's alpha channel — Pixi's documented sprite-masking mode) so the "not yet
 * built" region is genuinely absent rather than painted over, matching the C#'s `MakeTransparent(Color.Black)`.
 */
export class ConstructionOverlays<K extends object> {
    readonly root = new Container();
    private entries = new Map<K, ConstructionEntry>();
    private maskSprites = new Map<K, Sprite>();
    private used = new Set<K>();
    private frame = 0;
    private rebuilds = 0;

    constructor(parent: Container) {
        this.root.eventMode = 'none';
        // Each mask sprite is `renderable = false` (Pixi's documented sprite-mask pattern — masking still applies
        // while the sprite itself never draws), not the whole container: `root.visible = false` would also risk
        // skipping the subtree's world-transform update, which the mask alignment in apply() depends on every
        // frame.
        parent.addChild(this.root);
    }

    begin(): void {
        this.used.clear();
        this.frame++;
        this.rebuilds = 0;
    }

    private maskSprite(key: K, tex: Texture): Sprite {
        let s = this.maskSprites.get(key);
        if (s === undefined) {
            s = new Sprite(tex);
            s.anchor.set(0.5);
            s.renderable = false; // masking only — Pixi's documented pattern for a sprite used as another's mask
            this.root.addChild(s);
            this.maskSprites.set(key, s);
        } else if (s.texture !== tex) s.texture = tex;
        return s;
    }

    /**
     * Apply (building the mask texture when needed) `key`'s construction reveal onto `target`, its own sprite,
     * already positioned at (x, y) with `rotation` and `scale` for this frame — the mask sprite copies that
     * transform exactly so the erosion sits in the sprite's own local space (the same space method_117's bitmap
     * erosion ran in, before the C#'s final on-screen rotation). `floor` is method_116's reveal floor (0 = the
     * map's method_115; 0.4 on a build-queue / info-panel thumbnail — not used yet, no thumbnail is Pixi-drawn).
     * Clears `target.mask` once nothing is left to build.
     */
    apply(key: K, subject: ConstructionSubject | null, target: Sprite, x: number, y: number, rotation: number, scale: number, px: number, floor = 0): void {
        if (subject === null) {
            if (target.mask !== null) target.mask = null;
            return;
        }
        this.used.add(key);
        const side = damageOverlaySide(px);
        const percent = constructionRevealFloor(subject.percentBuilt, floor);
        let e = this.entries.get(key);
        const sig = `${side}|${percent.toFixed(4)}|${subject.size}`;
        if (e === undefined || e.sig !== sig) {
            if (e !== undefined && e.tex !== null && this.rebuilds >= REBUILDS_PER_FRAME) {
                // Over the cap: keep the old texture this frame.
            } else {
                this.rebuilds++;
                const rgba = buildConstructionMaskLayer(side, side, percent, subject.size);
                const tex = textureFromPixels(rgba, side, side, true);
                if (e?.tex != null) this.retire(e.tex);
                e = { sig, tex, side, seenFrame: this.frame };
                this.entries.set(key, e);
            }
        }
        if (e === undefined || e.tex === null) {
            if (target.mask !== null) target.mask = null;
            return;
        }
        e.seenFrame = this.frame;
        const m = this.maskSprite(key, e.tex);
        m.position.set(x, y);
        m.rotation = rotation;
        m.scale.set(scale);
        target.mask = m;
    }

    /** Unbind `t` from the pooled mask sprites, then destroy it. */
    private retire(t: Texture): void {
        for (const s of this.maskSprites.values()) if (s.texture === t) s.texture = Texture.EMPTY;
        t.destroy(true);
    }

    end(): void {
        // Objects not drawn for ~2 s give their textures and mask sprites back.
        if (this.frame % 60 === 0) {
            for (const [k, e] of this.entries) {
                if (this.frame - e.seenFrame < 120) continue;
                if (e.tex !== null) this.retire(e.tex);
                const m = this.maskSprites.get(k);
                if (m !== undefined) {
                    m.destroy();
                    this.maskSprites.delete(k);
                }
                this.entries.delete(k);
            }
        }
    }

    /** Test / capture hook: how many objects have an active mask this frame. */
    get appliedCount(): number {
        return this.used.size;
    }
}
