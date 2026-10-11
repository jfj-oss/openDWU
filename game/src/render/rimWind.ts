// 19i "Rim atmosphere": barely visible wind motes in rim systems at system-view zoom.
//
// Presentation only: a small fixed pool of faint streak sprites in screen space (one texture, one batched draw), drifting
// in one direction per system with slow, gentle gusts. Real time (like the eyes' blink), render-side randomness only —
// never galaxy.rnd, never sim state. Nothing is updated or drawn while the fade is 0 (galaxy / sector zoom, outside the
// rim, between systems, or with the add-on off: then the layer never constructs this at all). No per-frame allocation:
// particle state lives in preallocated typed arrays, the sprites are created once.

import { Container, Sprite, type Texture } from 'pixi.js';
import type { Camera } from './camera';
import type { Galaxy } from '../sim/galaxy';
import { makeTextureCanvas, textureFromCanvas } from './textureCanvas';

/** Pool size (all of it is used; sparse on purpose). */
export const WIND_PARTICLES = 34;
/** Peak streak alpha (near particles, mid gust). Barely visible by design. */
export const WIND_MAX_ALPHA = 0.1;
/** Pale cold grey-blue. */
const WIND_TINT = 0xc8d2e4;
/** Zoom gate: 0 above this zoom factor (1 / zoom), full below WIND_FULL_FACTOR (the system view). */
const WIND_START_FACTOR = 200;
const WIND_FULL_FACTOR = 70;
/** "In a system": full within this distance of a rim star, gone by WIND_SYSTEM_FAR (world units). */
const WIND_SYSTEM_NEAR = 32_000;
const WIND_SYSTEM_FAR = 60_000;
/** Base drift and the extra in a gust, screen px / s for a depth-1 mote. */
const WIND_SPEED = 12;
const WIND_GUST_SPEED = 30;
/** Screen margin (px) particles wrap around in, so wrapping always happens off screen. */
const WIND_MARGIN = 60;
const TEX_W = 64;
const TEX_H = 8;
/** Nearest-system search period (frames). */
const SYSTEM_CHECK_FRAMES = 20;

function smooth(a: number, b: number, v: number): number {
    const t = (v - a) / (b - a);
    const k = t < 0 ? 0 : t > 1 ? 1 : t;
    return k * k * (3 - 2 * k);
}

/** 0..1 gust strength at real time `t` (s): a sum of slow incommensurate sines, shaped so that most of the time the
 *  wind is calm and every ~10–30 s it swells for a few seconds. */
export function windGust(t: number, seed: number): number {
    const s = (seed % 997) * 0.37;
    const g = 0.5 + 0.25 * Math.sin(t * 0.53 + s) + 0.15 * Math.sin(t * 0.211 + s * 1.7) + 0.1 * Math.sin(t * 0.087 + s * 2.3);
    return smooth(0.55, 0.92, g);
}

/** Wind direction (radians) for a system: a stable per-system heading. */
export function windHeading(systemIndex: number, seed: number): number {
    const h = Math.imul((systemIndex + 1) ^ seed, 0x9e3779b1) >>> 0;
    return (h / 4294967296) * Math.PI * 2;
}

/** Wind zoom gate: 0 above WIND_START_FACTOR, smoothly to 1 at the system view. */
export function windZoomFade(z: number): number {
    return smooth(1 / WIND_START_FACTOR, 1 / WIND_FULL_FACTOR, z);
}

function makeStreakTexture(): Texture {
    const { canvas, ctx } = makeTextureCanvas(TEX_W, TEX_H);
    // Soft horizontal streak: bright-ish core fading to both ends and across.
    const g = ctx.createLinearGradient(0, 0, TEX_W, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.8, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, TEX_H / 2 - 1, TEX_W, 2);
    ctx.globalAlpha = 0.35;
    ctx.fillRect(0, TEX_H / 2 - 2, TEX_W, 4);
    return textureFromCanvas(canvas);
}

export class RimWind {
    readonly root = new Container();
    private sprites: Sprite[] = [];
    private px = new Float32Array(WIND_PARTICLES);
    private py = new Float32Array(WIND_PARTICLES);
    private depth = new Float32Array(WIND_PARTICLES);
    private phase = new Float32Array(WIND_PARTICLES);
    private rate = new Float32Array(WIND_PARTICLES);
    private rng: number;
    private fade = 0;
    private target = 0;
    private heading = 0;
    private targetHeading = 0;
    private frame = SYSTEM_CHECK_FRAMES;
    private lastMs = NaN;
    private lastX = 0;
    private lastY = 0;
    private lastZ = 0;
    private lastW = 0;
    private lastH = 0;
    private live = false;

    constructor(
        private galaxy: Galaxy,
        private seed: number,
        /** Rim weight at a world point. */
        private weightAt: (x: number, y: number) => number,
        /** windStrength param (0..1 scales the peak alpha). */
        private strength = 1,
    ) {
        this.rng = (seed ^ 0x5bd1e995) >>> 0 || 1;
        const tex = makeStreakTexture();
        for (let i = 0; i < WIND_PARTICLES; i++) {
            const s = new Sprite(tex);
            s.anchor.set(0.6, 0.5);
            s.tint = WIND_TINT;
            s.alpha = 0;
            this.sprites.push(s);
            this.root.addChild(s);
            this.depth[i] = 0.35 + 0.65 * this.rand();
            this.phase[i] = this.rand() * Math.PI * 2;
            this.rate[i] = 0.25 + 0.35 * this.rand();
        }
        this.root.visible = false;
    }

    /** xorshift32 in [0, 1) — render-side only. */
    private rand(): number {
        let x = this.rng;
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
        this.rng = x >>> 0;
        return this.rng / 4294967296;
    }

    /** Nearest system star: sets the target fade (zoom × in-system × rim weight) and the heading. */
    private checkSystem(cam: Camera, zoomFade: number): void {
        let best = Infinity;
        let bx = 0;
        let by = 0;
        let bi = -1;
        const systems = this.galaxy.systems;
        for (let i = 0; i < systems.length; i++) {
            const st = systems[i].systemStar;
            if (!st) continue;
            const dx = st.xpos - cam.x;
            const dy = st.ypos - cam.y;
            const d = dx * dx + dy * dy;
            if (d < best) {
                best = d;
                bx = st.xpos;
                by = st.ypos;
                bi = st.systemIndex;
            }
        }
        if (bi < 0) {
            this.target = 0;
            return;
        }
        const near = 1 - smooth(WIND_SYSTEM_NEAR, WIND_SYSTEM_FAR, Math.sqrt(best));
        this.target = zoomFade * near * this.weightAt(bx, by);
        this.targetHeading = windHeading(bi, this.seed);
    }

    private scatter(w: number, h: number): void {
        for (let i = 0; i < WIND_PARTICLES; i++) {
            this.px[i] = -WIND_MARGIN + this.rand() * (w + 2 * WIND_MARGIN);
            this.py[i] = -WIND_MARGIN + this.rand() * (h + 2 * WIND_MARGIN);
        }
    }

    /** Per frame. `nowMs` = performance.now(). */
    update(nowMs: number, cam: Camera, z: number): void {
        const dt = Number.isFinite(this.lastMs) ? Math.min(0.1, Math.max(0, (nowMs - this.lastMs) / 1000)) : 0;
        this.lastMs = nowMs;
        const zoomFade = windZoomFade(z);
        if (zoomFade <= 0 && this.fade <= 0.003) {
            // Galaxy / sector zoom: nothing to do (and nothing drawn).
            if (this.root.visible) this.root.visible = false;
            this.live = false;
            this.target = 0;
            this.fade = 0;
            this.frame = SYSTEM_CHECK_FRAMES;
            return;
        }
        if (++this.frame >= SYSTEM_CHECK_FRAMES) {
            this.frame = 0;
            this.checkSystem(cam, zoomFade);
        }
        // Ease towards the target (about 1.5 s): no pop entering or leaving a system or zooming.
        this.fade += (this.target - this.fade) * Math.min(1, dt * 0.7);
        if (this.fade <= 0.003) {
            if (this.root.visible) this.root.visible = false;
            this.live = false;
            return;
        }
        const W = cam.width;
        const H = cam.height;
        if (!this.live || W !== this.lastW || H !== this.lastH) {
            this.scatter(W, H);
            this.live = true;
            this.heading = this.targetHeading;
            this.lastX = cam.x;
            this.lastY = cam.y;
            this.lastZ = z;
            this.lastW = W;
            this.lastH = H;
        }
        if (!this.root.visible) this.root.visible = true;

        // Heading: glide along the shortest arc.
        let dh = this.targetHeading - this.heading;
        dh -= Math.round(dh / (Math.PI * 2)) * Math.PI * 2;
        this.heading += dh * Math.min(1, dt * 0.3);
        const tSec = nowMs / 1000;
        const gust = windGust(tSec, this.seed);
        const ang = this.heading + 0.12 * Math.sin(tSec * 0.071);
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        const speed = (WIND_SPEED + WIND_GUST_SPEED * gust) * dt;
        // Camera motion: motes sit in the world (depth = parallax), so a pan or zoom carries them along.
        const camDx = (cam.x - this.lastX) * z;
        const camDy = (cam.y - this.lastY) * z;
        const zr = this.lastZ > 0 ? z / this.lastZ : 1;
        this.lastX = cam.x;
        this.lastY = cam.y;
        this.lastZ = z;
        const cx = W / 2;
        const cy = H / 2;
        const spanX = W + 2 * WIND_MARGIN;
        const spanY = H + 2 * WIND_MARGIN;
        const len = 0.18 + 0.32 * gust;
        const aBase = WIND_MAX_ALPHA * this.strength * this.fade * (0.65 + 0.35 * gust);
        for (let i = 0; i < WIND_PARTICLES; i++) {
            const d = this.depth[i];
            let x = this.px[i];
            let y = this.py[i];
            if (zr !== 1) {
                const k = 1 + (zr - 1) * d;
                x = cx + (x - cx) * k;
                y = cy + (y - cy) * k;
            }
            x += ca * speed * d - camDx * d;
            y += sa * speed * d - camDy * d;
            if (x < -WIND_MARGIN || x > W + WIND_MARGIN || y < -WIND_MARGIN || y > H + WIND_MARGIN) {
                // Wrap around the margin (always off screen) and start a fresh breathing cycle, so the pattern never repeats.
                x = -WIND_MARGIN + ((((x + WIND_MARGIN) % spanX) + spanX) % spanX);
                y = -WIND_MARGIN + ((((y + WIND_MARGIN) % spanY) + spanY) % spanY);
                this.phase[i] = this.rand() * Math.PI * 2;
            }
            this.px[i] = x;
            this.py[i] = y;
            // Each mote breathes in and out on its own slow cycle (sparse: much of the time it is all but gone).
            const tw = 0.5 - 0.5 * Math.cos(this.phase[i] + tSec * this.rate[i]);
            const s = this.sprites[i];
            s.position.set(x, y);
            s.rotation = ang;
            s.scale.set(len * (0.6 + 0.8 * d), 0.5 + 0.4 * d);
            s.alpha = aBase * tw * tw * (0.45 + 0.55 * d);
        }
    }
}
