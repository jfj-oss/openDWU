// The Reaper Watcher's living parts (Giantworks add-on, the Beacon; render only). Its frame is the alternative Watcher
// (threatArt.ts WATCHER_FRAME_FILES 'reaper': watcher-reaper.png, from a user-made kitbash of an image of a Mass Effect
// Reaper, EA / BioWare's design, at the user's request); beaconReaperArtData.ts holds its data (written by its build).
//
// - Its chain: a single massive chain hangs from one of its front pincers and trails behind as it moves and turns: a
//   verlet rope in world space (so it lags behind its anchor, swings out on turns and drifts gently aft at rest), each
//   link a sprite (flat and on-edge links alternating, the flat ones narrowing as the chain slowly twists), with a soft
//   shadow. Only over CHAIN_MIN_PX drawn size and for at most CHAIN_SHIPS_MAX ships a frame.
// - Its eye-lines: the thin pale lines on its centre plate. Every EYE_PERIOD_S a soft highlight runs along each of them,
//   like light through a filament (pre-baked frames per line of a feathered bump along it, watcher-reaper-eyes.png,
//   cross-faded), the lines a little staggered, easing in and out; additive. `heat` (0..1, its opening's when it has
//   one) makes the runs quicker and redder.
// Pooled sprites; nothing allocated per frame once a ship's chain exists.

import { Container, Rectangle, Texture, type Sprite } from 'pixi.js';
import type { BuiltObject } from '../sim/builtObject';
import { SpritePool } from './fxCommon';
import { loadShipArt } from './shipArt';
import { BEACON_ART_DIR } from './threatArt';
import type { BeaconFxRect } from './beaconArtData';
import { WATCHER_REAPER_ART as X } from './beaconReaperArtData';

const FILE = 'watcher-reaper';
/** The chain only from this drawn size (px), for at most this many ships a frame. */
export const CHAIN_MIN_PX = 60;
export const CHAIN_SHIPS_MAX = 3;
/** The eye-line runs from this drawn size (px). */
export const EYE_MIN_PX = 16;
/** A run along the lines every this many s, at rest; one run along a line takes EYE_RUN_S; each line starts
 * EYE_STAGGER_S after the one before it. */
export const EYE_PERIOD_S = 4.5;
export const EYE_RUN_S = 1.1;
export const EYE_STAGGER_S = 0.09;

/**
 * The chain's motion: `damp` the velocity kept per second (lower: it settles faster), `pull` how fast each link is drawn
 * back toward hanging behind the ship (per s: higher, stiffer, less swing), `sway` its idle sideways drift. A heavy chain:
 * little swing for a given turn or acceleration, slow to respond, settling quickly. (Mutable for previews only.)
 */
export const CHAIN_MOTION = { damp: 0.006, pull: 2.6, sway: 0.07 };

function sub(base: Texture, r: BeaconFxRect): Texture {
    return new Texture({ source: base.source, frame: new Rectangle(r.x, r.y, r.w, r.h) });
}

function smooth01(x: number): number {
    const t = Math.max(0, Math.min(1, x));
    return t * t * (3 - 2 * t);
}

/**
 * Eye-line `i`'s run at time `sec` (s): its place 0..1 along the line and its strength 0..1 (it fades in and out at each
 * end of the run), or k 0 between runs; `heat` 0..1 shortens the period. Pure.
 */
export function eyeRunAt(sec: number, i: number, phase: number, heat: number): { pos: number; k: number } {
    const period = EYE_PERIOD_S * (1 - 0.6 * heat);
    const run = EYE_RUN_S * (1 - 0.4 * heat);
    const t = ((((sec + phase - i * EYE_STAGGER_S) % period) + period) % period) / run;
    if (t >= 1) return { pos: 0, k: 0 };
    return { pos: smooth01(t), k: smooth01(t * 4) * smooth01((1 - t) * 4) };
}

interface ShipChain {
    p: Float32Array;
    q: Float32Array;
    t: number;
    sc: number;
    seen: number;
}

interface Tex {
    face: Texture;
    edge: Texture;
    /** Per eye-line, its run's frames. */
    eyes: Texture[][];
}

export class ReaperFx {
    private eyeC = new Container();
    private chainC = new Container();
    private eyePool = new SpritePool(this.eyeC);
    private links = new SpritePool(this.chainC);
    private tex: Tex | null = null;
    private loading = false;
    private ships = new Map<BuiltObject, ShipChain>();
    private chainShips = 0;
    private clock = 0;
    // the transform of the ship being drawn
    private x = 0;
    private y = 0;
    private cos = 1;
    private sin = 0;
    private rot = 0;
    private sc = 1;
    private ox = 0;
    private oy = 0;

    constructor(parent: Container) {
        parent.addChild(this.eyeC, this.chainC);
    }

    private textures(): Tex | null {
        if (this.tex === null && !this.loading) {
            this.loading = true;
            void Promise.all([loadShipArt(`${BEACON_ART_DIR}${FILE}-chain.png`, false), loadShipArt(`${BEACON_ART_DIR}${FILE}-eyes.png`, false)]).then(
                ([c, e]) => {
                    if (c === null || e === null) return;
                    const eyes = X.eyes.map((r) => {
                        const fr: Texture[] = [];
                        for (let k = 0; k < X.eyeFrames; k++) fr.push(sub(e.texture, { ...r, x: r.x + k * (r.w + 2) }));
                        return fr;
                    });
                    this.tex = { face: sub(c.texture, X.linkFace), edge: sub(c.texture, X.linkEdge), eyes };
                },
                () => undefined,
            );
        }
        return this.tex;
    }

    begin(): void {
        this.eyePool.begin();
        this.links.begin();
        this.chainShips = 0;
    }

    end(): void {
        this.eyePool.end();
        this.links.end();
        if (this.ships.size > 0) for (const [bo, st] of this.ships) if (bo.hasBeenDestroyed || this.clock - st.seen > 3) this.ships.delete(bo);
    }

    private wx(fx: number, fy: number): number {
        return this.x + (fx - this.ox) * this.sc * this.cos - (fy - this.oy) * this.sc * this.sin;
    }

    private wy(fx: number, fy: number): number {
        return this.y + (fx - this.ox) * this.sc * this.sin + (fy - this.oy) * this.sc * this.cos;
    }

    /**
     * The Reaper Watcher drawn at (x, y), turned `rotation`, `scale` world units per frame px, its anchor (ox, oy) frame
     * px; `px` its drawn size; `sec` the wall clock; `heat` its opening's heat 0..1 (none yet: 0).
     */
    draw(bo: BuiltObject, x: number, y: number, rotation: number, scale: number, ox: number, oy: number, px: number, sec: number, heat: number): void {
        this.clock = sec;
        if (px < EYE_MIN_PX) return;
        const tex = this.textures();
        if (tex === null) return;
        this.x = x;
        this.y = y;
        this.rot = rotation;
        this.cos = Math.cos(rotation);
        this.sin = Math.sin(rotation);
        this.sc = scale;
        this.ox = ox;
        this.oy = oy;
        this.drawEyes(tex, bo.builtObjectID, sec, heat);
        if (px >= CHAIN_MIN_PX && this.chainShips < CHAIN_SHIPS_MAX) {
            this.chainShips++;
            let st = this.ships.get(bo);
            if (st === undefined) {
                st = { p: new Float32Array((X.chainLinks + 1) * 2), q: new Float32Array((X.chainLinks + 1) * 2), t: sec, sc: scale, seen: sec };
                this.ships.set(bo, st);
                this.lay(st);
            }
            const dt = Math.max(0, Math.min(0.05, sec - st.t));
            st.t = sec;
            st.seen = sec;
            this.step(st, dt, sec);
            this.drawChain(tex, st, sec);
        }
    }

    private drawEyes(tex: Tex, id: number, sec: number, heat: number): void {
        const phase = ((id * 0.618) % 1) * EYE_PERIOD_S;
        const tint = heat > 0.02 ? lerpTint(0xffffff, 0xff7040, heat) : 0xffffff;
        for (let i = 0; i < tex.eyes.length; i++) {
            const run = eyeRunAt(sec, i, phase, heat);
            if (run.k <= 0.01) continue;
            const fr = tex.eyes[i];
            const r = X.eyes[i];
            const f = run.pos * (fr.length - 1);
            const i0 = Math.floor(f);
            const i1 = Math.min(fr.length - 1, i0 + 1);
            const w1 = f - i0;
            for (let j = 0; j < 2; j++) {
                const w = j === 0 ? 1 - w1 : w1;
                if (w <= 0.01) continue;
                const s = this.eyePool.acquire(fr[j === 0 ? i0 : i1]);
                s.blendMode = 'add';
                s.anchor.set(0, 0);
                s.position.set(this.wx(r.dx, r.dy), this.wy(r.dx, r.dy));
                s.rotation = this.rot;
                s.scale.set(this.sc);
                s.alpha = Math.min(1, 1.4 * run.k * w * (1 + 0.5 * heat));
                s.tint = tint;
            }
        }
    }

    /** The chain laid straight aft of its anchor (the start; a reset after a jump or a big change of scale). */
    private lay(st: ShipChain): void {
        const seg = X.linkLen * this.sc * 0.82;
        const ax = this.wx(X.chainAt[0], X.chainAt[1]);
        const ay = this.wy(X.chainAt[0], X.chainAt[1]);
        const n = st.p.length / 2;
        for (let i = 0; i < n; i++) {
            st.p[i * 2] = st.q[i * 2] = ax - this.sin * seg * i * 0.92;
            st.p[i * 2 + 1] = st.q[i * 2 + 1] = ay + this.cos * seg * i * 0.92;
        }
    }

    private step(st: ShipChain, dt: number, sec: number): void {
        const seg = X.linkLen * this.sc * 0.82;
        const ax = this.wx(X.chainAt[0], X.chainAt[1]);
        const ay = this.wy(X.chainAt[0], X.chainAt[1]);
        if (Math.abs(this.sc / st.sc - 1) > 0.2 || Math.hypot(st.p[0] - ax, st.p[1] - ay) > seg * 25) {
            st.sc = this.sc;
            this.lay(st);
            return;
        }
        st.sc = this.sc;
        const n = st.p.length / 2;
        // each link drawn back toward where it lies at rest (straight aft of the anchor, swaying slowly sideways), against
        // a heavy drag through space: it trails behind as the ship moves and swings out as it turns
        const sway = Math.sin(sec * 0.4) * 0.6 + Math.sin(sec * 0.15 + 1.1) * 0.4;
        const damp = Math.pow(CHAIN_MOTION.damp, dt);
        const kr = CHAIN_MOTION.pull;
        for (let i = 1; i < n; i++) {
            const along = seg * i * 0.92;
            const side = sway * seg * CHAIN_MOTION.sway * i * (i / n);
            const rx = ax - this.sin * along + this.cos * side;
            const ry = ay + this.cos * along + this.sin * side;
            const x = st.p[i * 2];
            const y = st.p[i * 2 + 1];
            const vx = (x - st.q[i * 2]) * damp;
            const vy = (y - st.q[i * 2 + 1]) * damp;
            st.q[i * 2] = x;
            st.q[i * 2 + 1] = y;
            st.p[i * 2] = x + vx + (rx - x) * kr * dt;
            st.p[i * 2 + 1] = y + vy + (ry - y) * kr * dt;
        }
        st.p[0] = st.q[0] = ax;
        st.p[1] = st.q[1] = ay;
        for (let it = 0; it < 4; it++) {
            for (let i = 0; i < n - 1; i++) {
                const dx = st.p[i * 2 + 2] - st.p[i * 2];
                const dy = st.p[i * 2 + 3] - st.p[i * 2 + 1];
                const d = Math.hypot(dx, dy) || 1e-6;
                const e = (d - seg) / d;
                if (i === 0) {
                    st.p[2] -= dx * e;
                    st.p[3] -= dy * e;
                } else {
                    st.p[i * 2] += dx * e * 0.5;
                    st.p[i * 2 + 1] += dy * e * 0.5;
                    st.p[i * 2 + 2] -= dx * e * 0.5;
                    st.p[i * 2 + 3] -= dy * e * 0.5;
                }
            }
        }
    }

    private drawChain(tex: Tex, st: ShipChain, sec: number): void {
        const L = X.linkLen * 1.32 * this.sc;
        const W = X.linkW * this.sc;
        const shx = 3 * this.sc;
        const shy = 4 * this.sc;
        const n = st.p.length / 2;
        for (let pass = 0; pass < 2; pass++) {
            for (let i = 0; i < n - 1; i++) {
                const x0 = st.p[i * 2];
                const y0 = st.p[i * 2 + 1];
                const x1 = st.p[i * 2 + 2];
                const y1 = st.p[i * 2 + 3];
                const face = i % 2 === 0;
                const tw = Math.cos(sec * 0.7 + i * 0.6);
                const t = face ? tex.face : tex.edge;
                const s: Sprite = this.links.acquire(t);
                s.blendMode = 'normal';
                s.anchor.set(0.5, 0.5);
                s.rotation = Math.atan2(y1 - y0, x1 - x0);
                const hs = face ? 0.4 + 0.6 * Math.abs(tw) : 0.75 + 0.25 * Math.abs(tw);
                s.scale.set(L / t.width, (W * hs) / t.height);
                if (pass === 0) {
                    s.position.set((x0 + x1) / 2 + shx, (y0 + y1) / 2 + shy);
                    s.tint = 0x000000;
                    s.alpha = 0.32;
                } else {
                    s.position.set((x0 + x1) / 2, (y0 + y1) / 2);
                    s.tint = lerpTint(0x8a8a90, 0xffffff, 0.5 + 0.5 * Math.abs(tw));
                }
            }
        }
    }
}

function lerpTint(a: number, b: number, t: number): number {
    const k = Math.max(0, Math.min(1, t));
    const r = Math.round(((a >> 16) & 255) * (1 - k) + ((b >> 16) & 255) * k);
    const g = Math.round(((a >> 8) & 255) * (1 - k) + ((b >> 8) & 255) * k);
    const bl = Math.round((a & 255) * (1 - k) + (b & 255) * k);
    return (r << 16) | (g << 8) | bl;
}
