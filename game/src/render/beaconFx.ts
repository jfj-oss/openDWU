// The Beacon's living art (Giantworks add-on; render only — threatArt.ts says who is who, beaconArtData.ts is the
// table scripts/beacon-ships.py writes with the frames in public/art/beacon/).
//
// Every Reclaimer hull, Watcher and the finished Beacon has one red heart. It beats (a strong beat and a weaker second,
// beaconBeat), each hull on its own phase and the bigger ones slower: the heart's glow swells, the organs' light rises
// through the stained-glass panes in their colours, and a pulse runs out along the veins (three bands of the vein
// network by distance from the heart, each lighting a little after the one inside it). The Beacon also sends a faint
// ring out into space with every beat (the call). All pooled additive sprites over the ship layer; nothing allocated
// per frame; skipped under BEACON_FX_MIN_PX drawn size, the veins under BEACON_VEINS_MIN_PX.
//
// A Watcher is drawn as its closed seed pod (watcher.png). While it is sighted (threatArt.ts watcherOpenTarget) it
// slowly unfolds: the ship layer swaps its sprite to the open body (watcher-body.png, the same canvas), and the three
// plates (watcher-plate-<k>.png) are drawn here, lifting off the body (a growing shadow under them) and swinging out
// about their hinges on the rim one after another; they fold back when it is no longer sighted. Closed, the light in
// its seams pulses with its heart.

import { Container, Rectangle, Texture, type Sprite } from 'pixi.js';
import type { BuiltObject } from '../sim/builtObject';
import { SpritePool } from './fxCommon';
import { loadShipArt } from './shipArt';
import { textureFromRgbaPixels } from './textureCanvas';
import { useMinifyingFilter } from './assets';
import { BEACON_FRAMES, WATCHER_ART, type BeaconFrameArt, type BeaconFxRect } from './beaconArtData';
import { BEACON_ART_DIR } from './threatArt';

/** No pulse layers under this drawn size (px); no vein bands under BEACON_VEINS_MIN_PX. */
export const BEACON_FX_MIN_PX = 14;
export const BEACON_VEINS_MIN_PX = 28;
/** Seconds for a Watcher to open fully / to close. */
export const WATCHER_OPEN_S = 10;
export const WATCHER_CLOSE_S = 7;
/** When each vein band lights after the beat (fractions of the period, from the heart outward). */
export const VEIN_BAND_DELAY: readonly number[] = [0.06, 0.13, 0.21];

/** One beat at x periods after its onset: a quick swell, a slower ebb. */
function beatShape(x: number): number {
    if (x < 0) return 0;
    if (x < 0.06) return x / 0.06;
    return Math.exp(-(x - 0.06) * 8);
}

/** The heartbeat 0..1 at time `sec` (s): a strong beat, then a weaker one 0.2 periods later, every `period` s. Pure. */
export function beaconBeat(sec: number, period: number, phase = 0): number {
    const ph = ((((sec + phase) / period) % 1) + 1) % 1;
    return Math.min(1, Math.max(beatShape(ph), 0.6 * beatShape(ph - 0.2)));
}

/** A hull's own beat phase (s, 0..period) from its id, so a fleet does not beat in step. Pure. */
export function beaconPhase(builtObjectID: number, period: number): number {
    return ((((builtObjectID * 0.6180339887) % 1) + 1) % 1) * period;
}

/** The light of vein band k (0 at the heart .. 2 outermost) at time `sec`: the beat, a little later per band. Pure. */
export function veinBandAlpha(sec: number, period: number, phase: number, k: number): number {
    return beaconBeat(sec - VEIN_BAND_DELAY[k] * period, period, phase) * (1 - 0.12 * k);
}

function smoothstep(a: number, b: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
}

/** Plate k's own progress 0..1 at the Watcher's unfold u (0 closed .. 1 open): the plates start one after another. */
function plateProgress(u: number, k: number): number {
    return Math.max(0, Math.min(1, (u - k * 0.07) / 0.86));
}

/** How far plate k has swung (0..1 of the full swing) at unfold u: it lifts first, then swings out, easing in and out. Pure. */
export function watcherPlateSwing(u: number, k: number): number {
    return smoothstep(0.12, 1, plateProgress(u, k));
}

/** How far plate k has lifted off the body (0..1) at unfold u: in the first fifth of its opening. Pure. */
export function watcherPlateLift(u: number, k: number): number {
    return smoothstep(0, 0.2, plateProgress(u, k));
}

/** The next unfold value: toward 1 over WATCHER_OPEN_S while `open`, toward 0 over WATCHER_CLOSE_S otherwise. Pure. */
export function watcherUnfoldStep(u: number, open: boolean, dt: number): number {
    return open ? Math.min(1, u + dt / WATCHER_OPEN_S) : Math.max(0, u - dt / WATCHER_CLOSE_S);
}

/** The pulse layers of a frame (sub-textures of its <file>-fx.png). */
interface FxSet {
    organs: Texture;
    veins: Texture[];
    /** The Watcher's: its seams' light and each plate's glow. */
    seams?: Texture;
    plateGlow?: Texture[];
}

/** The Watcher's open body and plates. */
interface WatcherTextures {
    body: Texture;
    plates: Texture[];
}

const CORE_SIDE = 64;
/** The heart's glow: a hot core in a crimson halo (the core's radius is CORE_SIDE / 8). */
function coreGlowTexture(): Texture {
    const S = CORE_SIDE;
    const d = new Uint8ClampedArray(S * S * 4);
    for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
            const r = Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2) / (S / 8);
            const core = Math.max(0, Math.min(1, 1.15 - r));
            const halo = Math.exp(-r * r * 0.22) * Math.max(0, 1 - r / 4);
            const a = Math.min(1, core * 0.9 + halo * 0.7);
            const i = (y * S + x) * 4;
            d[i] = 255;
            d[i + 1] = (0.14 + 0.62 * core) * 255;
            d[i + 2] = (0.16 + 0.5 * core) * 255;
            d[i + 3] = a * 255;
        }
    }
    const t = textureFromRgbaPixels(d, S, S);
    useMinifyingFilter(t);
    return t;
}

const RING_SIDE = 128;
/** The Beacon's call: a thin soft violet-red ring (radius 0.45 of the side). */
function ringTexture(): Texture {
    const S = RING_SIDE;
    const d = new Uint8ClampedArray(S * S * 4);
    for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
            const r = Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2) / S;
            const a = Math.exp(-(((r - 0.45) / 0.018) ** 2)) + 0.35 * Math.exp(-(((r - 0.43) / 0.05) ** 2));
            const i = (y * S + x) * 4;
            d[i] = 235;
            d[i + 1] = 60;
            d[i + 2] = 150;
            d[i + 3] = Math.min(1, a) * 255;
        }
    }
    const t = textureFromRgbaPixels(d, S, S);
    useMinifyingFilter(t);
    return t;
}

function sub(base: Texture, r: BeaconFxRect): Texture {
    return new Texture({ source: base.source, frame: new Rectangle(r.x, r.y, r.w, r.h) });
}

/** The frame data of a Beacon file (a Reclaimer frame, 'beacon' or 'watcher'), or null. */
export function beaconFrameArt(file: string): BeaconFrameArt | null {
    if (file === 'watcher') return WATCHER_ART;
    return Object.hasOwn(BEACON_FRAMES, file) ? BEACON_FRAMES[file] : null;
}

interface Unfold {
    u: number;
    t: number;
}

export class BeaconFxLayer {
    readonly root = new Container();
    private pool = new SpritePool(this.root);
    private fx = new Map<string, FxSet | null>();
    private fxLoading = new Set<string>();
    private watcherTex: WatcherTextures | null = null;
    private watcherLoading = false;
    private core: Texture | null = null;
    private ring: Texture | null = null;
    private unfold = new Map<BuiltObject, Unfold>();
    // The transform of the sprite being decorated (set per draw; no closures per frame).
    private x = 0;
    private y = 0;
    private cos = 1;
    private sin = 0;
    private rot = 0;
    private sc = 1;
    private ox = 0;
    private oy = 0;

    constructor() {
        this.root.eventMode = 'none';
    }

    begin(): void {
        this.pool.begin();
    }

    end(): void {
        this.pool.end();
        if (this.unfold.size > 4) for (const bo of this.unfold.keys()) if (bo.hasBeenDestroyed) this.unfold.delete(bo);
    }

    /** The pulse layers of `file` (loaded once, on first use; null until then or if it failed). */
    private fxSet(file: string): FxSet | null {
        const got = this.fx.get(file);
        if (got !== undefined) return got;
        if (!this.fxLoading.has(file)) {
            this.fxLoading.add(file);
            const art = beaconFrameArt(file);
            void loadShipArt(`${BEACON_ART_DIR}${file}-fx.png`, false).then(
                (a) => {
                    if (a === null || art === null) {
                        this.fx.set(file, null);
                        return;
                    }
                    const set: FxSet = { organs: sub(a.texture, art.organs), veins: art.veins.map((r) => sub(a.texture, r)) };
                    if (file === 'watcher') {
                        set.seams = sub(a.texture, WATCHER_ART.seams);
                        set.plateGlow = WATCHER_ART.plates.map((p) => sub(a.texture, p.glow));
                    }
                    this.fx.set(file, set);
                },
                () => this.fx.set(file, null),
            );
        }
        return null;
    }

    /** The Watcher's open body and plates (loaded once, on first use; null until all are loaded). */
    private watcherTextures(): WatcherTextures | null {
        if (this.watcherTex === null && !this.watcherLoading) {
            this.watcherLoading = true;
            const urls = [`${BEACON_ART_DIR}watcher-body.png`, ...[0, 1, 2].map((k) => `${BEACON_ART_DIR}watcher-plate-${k}.png`)];
            void Promise.all(urls.map((u) => loadShipArt(u, false))).then(
                (arts) => {
                    if (arts.some((a) => a === null)) return;
                    this.watcherTex = { body: arts[0]!.texture, plates: arts.slice(1).map((a) => a!.texture) };
                },
                () => undefined,
            );
        }
        return this.watcherTex;
    }

    private coreTex(): Texture {
        if (this.core === null) this.core = coreGlowTexture();
        return this.core;
    }

    /** Places `s` (anchor `axf`, `ayf`) at frame px (fx, fy) of the sprite being decorated, turned and scaled with it. */
    private put(s: Sprite, fx: number, fy: number, axf = 0, ayf = 0, extraRot = 0, extraScale = 1): void {
        const lx = (fx - this.ox) * this.sc;
        const ly = (fy - this.oy) * this.sc;
        s.position.set(this.x + lx * this.cos - ly * this.sin, this.y + lx * this.sin + ly * this.cos);
        s.anchor.set(axf, ayf);
        s.rotation = this.rot + extraRot;
        s.scale.set(this.sc * extraScale);
    }

    private additive(t: Texture, r: BeaconFxRect, alpha: number): void {
        if (alpha <= 0.01) return;
        const s = this.pool.acquire(t);
        s.blendMode = 'add';
        this.put(s, r.dx, r.dy);
        s.alpha = Math.min(1, alpha);
    }

    /** The heart's glow, swelling with the beat. */
    private heart(art: BeaconFrameArt, beat: number): void {
        const s = this.pool.acquire(this.coreTex());
        s.blendMode = 'add';
        // The texture's core radius is CORE_SIDE / 8 px: scale it to the heart's radius in frame px.
        this.put(s, art.core[0], art.core[1], 0.5, 0.5, 0, ((art.core[2] * 1.15) / (CORE_SIDE / 8)) * (1 + 0.16 * beat));
        s.alpha = 0.35 + 0.65 * beat;
    }

    /**
     * The overlays of a Beacon sprite drawing frame `file` (its transform; `tw` × `th` its texture size; `px` its drawn
     * size; `sec` the shared wall clock). `open`: a Watcher's unfold target. Returns the texture the ship layer should
     * draw instead of the frame (a Watcher's open body while it unfolds), or null.
     */
    draw(file: string, bo: BuiltObject, open: boolean, x: number, y: number, rotation: number, scale: number, ax: number, ay: number, tw: number, th: number, px: number, sec: number): Texture | null {
        const art = beaconFrameArt(file);
        if (art === null) return null;
        let u = 0;
        if (file === 'watcher') {
            let st = this.unfold.get(bo);
            if (st === undefined) {
                st = { u: 0, t: sec };
                this.unfold.set(bo, st);
            }
            st.u = watcherUnfoldStep(st.u, open, Math.max(0, Math.min(0.25, sec - st.t)));
            st.t = sec;
            u = st.u;
        }
        if (px < BEACON_FX_MIN_PX) return null;
        this.x = x;
        this.y = y;
        this.rot = rotation;
        this.cos = Math.cos(rotation);
        this.sin = Math.sin(rotation);
        this.sc = scale;
        this.ox = ax * tw;
        this.oy = ay * th;
        const phase = beaconPhase(bo.builtObjectID, art.beat);
        const beat = beaconBeat(sec, art.beat, phase);
        const fx = this.fxSet(file);
        if (file === 'watcher') return this.drawWatcher(fx, u, sec, phase, beat, px);
        if (fx !== null) {
            this.additive(fx.organs, art.organs, 0.12 + 0.88 * beaconBeat(sec - 0.02 * art.beat, art.beat, phase));
            if (px >= BEACON_VEINS_MIN_PX) for (let k = 0; k < 3; k++) this.additive(fx.veins[k], art.veins[k], veinBandAlpha(sec, art.beat, phase, k));
        }
        this.heart(art, beat);
        if (file === 'beacon') this.call(art, sec, phase);
        return null;
    }

    /** The Beacon's call: a ring running out from the heart with each beat (and a fainter one with the second). */
    private call(art: BeaconFrameArt, sec: number, phase: number): void {
        if (this.ring === null) this.ring = ringTexture();
        const ph = ((((sec + phase) / art.beat) % 1) + 1) % 1;
        for (const [p, a] of [[ph, 0.5], [ph - 0.2, 0.25]] as const) {
            if (p < 0) continue;
            const e = 1 - (1 - p) * (1 - p);
            const radius = art.core[2] * 2 + (art.size * 0.62 - art.core[2] * 2) * e;
            const s = this.pool.acquire(this.ring);
            s.blendMode = 'add';
            this.put(s, art.core[0], art.core[1], 0.5, 0.5, 0, radius / (RING_SIDE * 0.45));
            s.alpha = a * Math.pow(1 - p, 1.5);
        }
    }

    private drawWatcher(fx: FxSet | null, u: number, sec: number, phase: number, beat: number, px: number): Texture | null {
        const W = WATCHER_ART;
        const tex = u > 0.001 ? this.watcherTextures() : null;
        if (tex === null) {
            // Closed (or the open art still loading): the pod's seams pulse with the heart.
            if (fx?.seams !== undefined) this.additive(fx.seams, W.seams, 0.3 + 0.7 * beat);
            this.heart(W, beat);
            return null;
        }
        // Open or opening: the body's organs and veins (fading in as it opens), the heart, then the plates over them.
        const show = smoothstep(0, 0.6, u);
        if (fx !== null) {
            this.additive(fx.organs, W.organs, (0.12 + 0.88 * beaconBeat(sec - 0.02 * W.beat, W.beat, phase)) * show);
            if (px >= BEACON_VEINS_MIN_PX) for (let k = 0; k < 3; k++) this.additive(fx.veins[k], W.veins[k], veinBandAlpha(sec, W.beat, phase, k) * show);
            if (fx.seams !== undefined) this.additive(fx.seams, W.seams, (0.3 + 0.7 * beat) * (1 - show));
        }
        this.heart(W, beat);
        for (let k = 0; k < 3; k++) {
            const p = W.plates[k];
            const lift = watcherPlateLift(u, k);
            const swing = watcherPlateSwing(u, k);
            // Open, the plates breathe a little on their hinges.
            const a = W.swing * swing + 0.012 * swing * Math.sin(sec * 0.7 + k * 2.1);
            const grow = 1 + 0.03 * lift;
            const axf = (p.hinge[0] - p.dx) / p.w;
            const ayf = (p.hinge[1] - p.dy) / p.h;
            if (lift > 0.01) {
                const sh = this.pool.acquire(tex.plates[k]);
                sh.blendMode = 'normal';
                this.put(sh, p.hinge[0] + 5 * lift, p.hinge[1] + 6 * lift, axf, ayf, a, grow);
                sh.tint = 0x000000;
                sh.alpha = 0.5 * lift;
            }
            const s = this.pool.acquire(tex.plates[k]);
            s.blendMode = 'normal';
            this.put(s, p.hinge[0], p.hinge[1], axf, ayf, a, grow);
            if (fx?.plateGlow !== undefined) {
                const g = this.pool.acquire(fx.plateGlow[k]);
                g.blendMode = 'add';
                // The glow's own anchor: the hinge, in its rectangle.
                this.put(g, p.hinge[0], p.hinge[1], (p.hinge[0] - p.glow.dx) / p.glow.w, (p.hinge[1] - p.glow.dy) / p.glow.h, a, grow);
                g.alpha = 0.12 + 0.88 * beaconBeat(sec - 0.04 * W.beat, W.beat, phase);
            }
        }
        return tex.body;
    }
}
