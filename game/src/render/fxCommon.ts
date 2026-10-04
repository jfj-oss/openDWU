// Shared effect-rendering helpers (combat effects, ambient effects):
// frame-index maths of the original's animation players, lazily loaded frame
// sets of original art, a sprite pool that reuses Pixi sprites frame to frame,
// and a fixed-capacity one-shot animation player (the C# AnimationSystem).
//
// Pure maths is exported separately from the Pixi classes so it can be unit
// tested without a renderer.

import { Container, Sprite, Texture } from 'pixi.js';
import type { AssetStore } from './assets';

/**
 * Port of AnimationSystem.cs method_1 (DoAnimationsXna): the frame of a
 * one-shot animation `nowMs - startMs` after it started, or -1 once it is
 * past its last frame (the C# then tears it down). Integer maths as the C#:
 * `num = (int)(frames / fps * 1000.0) / Math.Max(1, frames - 1)`,
 * `index = Math.Max(0, (int)elapsedMs / num)`.
 */
export function animationFrameIndex(startMs: number, nowMs: number, frameCount: number, fps: number): number {
    if (frameCount <= 0 || fps <= 0) return -1;
    const stepMs = Math.max(1, Math.trunc(Math.trunc((frameCount / fps) * 1000.0) / Math.max(1, frameCount - 1)));
    const index = Math.max(0, Math.trunc(Math.trunc(nowMs - startMs) / stepMs));
    return index >= frameCount ? -1 : index;
}

/**
 * Port of MainView.1.cs method_117's frame selection for a looping animation
 * (tractor-beam strike, area-gravity vortex): loop = trunc(frames / fps *
 * 1000) ms, step = trunc(loop / max(1, frames - 1)), frame = (now % loop) /
 * step. The C# can index one past the end on the last millisecond slice of a
 * loop; clamped here.
 */
export function loopFrameIndex(nowMs: number, frameCount: number, fps: number): number {
    if (frameCount <= 0 || fps <= 0) return 0;
    const loopMs = Math.trunc((frameCount / fps) * 1000.0);
    if (loopMs <= 0) return 0;
    const stepMs = Math.max(1, Math.trunc(loopMs / Math.max(1, frameCount - 1)));
    const t = ((Math.trunc(nowMs) % loopMs) + loopMs) % loopMs;
    return Math.min(frameCount - 1, Math.trunc(t / stepMs));
}

/**
 * An ordered set of animation frames of original art, loaded on first use
 * through the AssetStore (which mipmaps every texture it hands out, like the
 * ship sprites). `frame(i)` is null until that frame has loaded; a missing
 * file resolves to Texture.EMPTY and is skipped by the drawers.
 */
export class FrameSet {
    private textures: (Texture | null)[];
    private requested = false;

    constructor(
        private store: AssetStore,
        readonly urls: readonly string[],
    ) {
        this.textures = new Array<Texture | null>(urls.length).fill(null);
    }

    get length(): number {
        return this.urls.length;
    }

    /** Start loading every frame (idempotent). */
    request(): void {
        if (this.requested) return;
        this.requested = true;
        for (let i = 0; i < this.urls.length; i++) {
            const idx = i;
            if (this.urls[i] === '') {
                // An empty slot (a null bitmap of the original's frame array, effectFrames.ts): never drawn.
                this.textures[idx] = Texture.EMPTY;
                continue;
            }
            this.store.loadFirst([this.urls[i]], () => Texture.EMPTY).then(
                (t) => {
                    this.textures[idx] = t;
                },
                () => {
                    this.textures[idx] = Texture.EMPTY;
                },
            );
        }
    }

    /** The frame's texture, or null while it loads / when it is missing. */
    frame(i: number): Texture | null {
        if (!this.requested) this.request();
        if (i < 0 || i >= this.textures.length) return null;
        const t = this.textures[i];
        return t === null || t === Texture.EMPTY ? null : t;
    }
}

/**
 * A pool of Sprites under one container, reused frame to frame: call
 * `begin()`, then `acquire()` once per sprite drawn this frame, then `end()`,
 * which hides the sprites not used. Only grows; never allocates in a steady
 * state.
 */
export class SpritePool {
    private sprites: Sprite[] = [];
    private used = 0;

    constructor(readonly parent: Container) {}

    begin(): void {
        this.used = 0;
    }

    /** Next free sprite, set to `texture`, visible, centred anchor, untinted. */
    acquire(texture: Texture): Sprite {
        let s = this.sprites[this.used];
        if (s === undefined) {
            s = new Sprite(texture);
            this.sprites.push(s);
            this.parent.addChild(s);
        } else if (s.texture !== texture) {
            s.texture = texture;
        }
        this.used++;
        s.visible = true;
        s.anchor.set(0.5, 0.5);
        s.alpha = 1;
        s.tint = 0xffffff;
        s.rotation = 0;
        return s;
    }

    end(): void {
        for (let i = this.used; i < this.sprites.length; i++) {
            const s = this.sprites[i];
            if (!s.visible) break; // everything past the first hidden one is hidden already
            s.visible = false;
        }
    }

    /** Detach `texture` from every pooled sprite (call before destroying it: a destroyed texture must not stay bound). */
    release(texture: Texture): void {
        for (const s of this.sprites) if (s.texture === texture) s.texture = Texture.EMPTY;
    }

    /** Sprites drawn since the last begin(). */
    get count(): number {
        return this.used;
    }
}

/** Place `s` (anchor 0.5) centred at world (x, y), `w` × `h` world units, rotated `rotation`. */
export function placeSprite(s: Sprite, x: number, y: number, w: number, h: number, rotation: number): void {
    const tw = s.texture.width || 1;
    const th = s.texture.height || 1;
    s.position.set(x, y);
    s.scale.set(w / tw, h / th);
    s.rotation = rotation;
}

/** One running one-shot animation (the C# DistantWorlds.Animation). */
export interface AnimationRecord {
    frames: FrameSet | null;
    startMs: number;
    fps: number;
    /** Centre, world units. */
    x: number;
    y: number;
    /** Size, world units (the C# Animation.Width/Height pass through method_34, which divides by the zoom). */
    w: number;
    h: number;
    /** Pixi rotation of the raw (unrotated) frame. */
    rotation: number;
    tint: number;
}

/**
 * Fixed-capacity player for one-shot animations (AnimationSystem.cs): records
 * are preallocated and recycled, so adding one never allocates. When full, the
 * oldest running animation is replaced.
 */
export class AnimationPlayer {
    private records: AnimationRecord[] = [];
    private live = 0;

    constructor(readonly capacity = 256) {
        for (let i = 0; i < capacity; i++) {
            this.records.push({ frames: null, startMs: 0, fps: 30, x: 0, y: 0, w: 0, h: 0, rotation: 0, tint: 0xffffff });
        }
    }

    get count(): number {
        return this.live;
    }

    add(frames: FrameSet, startMs: number, fps: number, x: number, y: number, w: number, h: number, rotation: number, tint = 0xffffff): void {
        frames.request();
        let r: AnimationRecord;
        if (this.live < this.capacity) {
            r = this.records[this.live++];
        } else {
            // Replace the oldest.
            let oldest = 0;
            for (let i = 1; i < this.live; i++) if (this.records[i].startMs < this.records[oldest].startMs) oldest = i;
            r = this.records[oldest];
        }
        r.frames = frames;
        r.startMs = startMs;
        r.fps = fps;
        r.x = x;
        r.y = y;
        r.w = w;
        r.h = h;
        r.rotation = rotation;
        r.tint = tint;
    }

    /**
     * Draw every running animation at `nowMs` into `pool`; finished ones are
     * removed (swap with the last live record). `visible(x, y, radius)`
     * culls off-screen ones without drawing them.
     */
    draw(nowMs: number, pool: SpritePool, visible: (x: number, y: number, r: number) => boolean): void {
        let i = 0;
        while (i < this.live) {
            const r = this.records[i];
            const frames = r.frames;
            const idx = frames === null ? -1 : animationFrameIndex(r.startMs, nowMs, frames.length, r.fps);
            if (idx < 0) {
                // Finished (or never started): recycle by swapping with the last live record.
                const last = this.records[this.live - 1];
                this.records[this.live - 1] = r;
                this.records[i] = last;
                r.frames = null;
                this.live--;
                continue;
            }
            const tex = frames!.frame(idx);
            if (tex !== null && visible(r.x, r.y, Math.max(r.w, r.h))) {
                const s = pool.acquire(tex);
                placeSprite(s, r.x, r.y, r.w, r.h, r.rotation);
                s.tint = r.tint;
            }
            i++;
        }
    }

    clear(): void {
        for (let i = 0; i < this.live; i++) this.records[i].frames = null;
        this.live = 0;
    }
}
