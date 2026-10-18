// The fork Watcher's engines and navigation lights (Giantworks add-on, the Beacon; render only). The default Watcher
// (threatArt.ts WATCHER_FRAME_FILES 'fork', watcher-fork.png) has two wide engine banks at its stern, one a side from
// the notch out to the side horns (the notch has none): each gets one wide plume, short (a little under the stock
// exhaust's length for a ship this size), by the ship's speed (smoothed; none at rest). The plume is the stock engine
// exhaust art (effects/enginethrusters/3.png, the Vortex engine's pink-lilac flame the Ancient Guardians' ships draw; a theme's own if one is active), drawn as ambientLayer.ts
// draws a ship's exhaust (untinted, normal blend). Small pink navigation lights across the hull (the prong fronts and
// outer edges, the rear hump, the side horns' tips, the stern corners) blink, each on its own period and phase (a small
// texture made once, a pixel buffer, no canvas). Pooled; drawn only for the FORK_FX_SHIPS_MAX biggest such ships on
// screen (ranked by drawn size, a frame behind) and only from a drawn size up. Where the banks and lights sit comes from
// beaconForkArtData.ts / beaconForkCapitalArtData.ts (the art builds). The fork capital ship (capitalship-fork.png)
// gets the same, from its own data.

import { Container, type Texture } from 'pixi.js';
import type { BuiltObject } from '../sim/builtObject';
import { SpritePool } from './fxCommon';
import { textureFromRgbaPixels } from './textureCanvas';
import { engineThrusterUrls } from './effectFrames';
import { loadRgba } from '../ui/empireEmblem';
import type { ForkArt } from './beaconForkArtData';

/** The plumes and the lights on / off (render only; mutable so a preview can switch them). */
export const FORK_FX = { plumes: true, lights: true };
/** At most this many ships get the plumes and lights (the biggest drawn), as the warp's metaballs. */
export const FORK_FX_SHIPS_MAX = 4;
/** No plumes under this drawn size (px); no lights under FORK_LIGHTS_MIN_PX. */
export const FORK_PLUMES_MIN_PX = 20;
export const FORK_LIGHTS_MIN_PX = 28;
/** The plumes' art: enginethrusters/<i>.png (3: the Vortex engine's pink-lilac flame, the one the Ancient Guardians' ships draw). */
export const FORK_PLUME_ART = 3;
/** A plume's length against the stock exhaust's for a ship this size (a little under). */
export const FORK_PLUME_LEN = 0.9;
/** Each band is this many stock flames side by side; each drawn this many times its share of the span wide (the stock
 * flame fills about the middle of its art, so they overlap and merge). */
export const FORK_PLUME_PIECES = 9;
export const FORK_PLUME_SPREAD = 3.4;
/** How fast the plumes follow the speed (1/s). */
const FOLLOW = 2.5;
/** A light's flash: the fraction of its period it is lit. */
const FLASH = 0.3;

/** The plumes' strength 0..1 from a speed fraction (speed over cruise speed): none at rest, full from cruise. Pure. */
export function forkThrust(speedFrac: number): number {
    if (!(speedFrac > 0)) return 0;
    const k = Math.min(1, speedFrac);
    return k * (2 - k);
}

/** A navigation light's brightness 0..1 at `sec` (its own period and phase): a short flash once a period. Pure. */
export function forkBlink(sec: number, period: number, phase: number): number {
    let u = sec / period + phase;
    u -= Math.floor(u);
    return u < FLASH ? Math.sin((Math.PI * u) / FLASH) : 0;
}

interface Track {
    k: number;
    t: number;
}

function smooth01(a: number, b: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
}

/** A navigation light: a white-pink point in a small pink halo. */
function lightTexture(): Texture {
    const s = 32;
    const px = new Uint8ClampedArray(s * s * 4);
    for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
            const d = Math.hypot((x + 0.5) / s - 0.5, (y + 0.5) / s - 0.5) * 2;
            const core = Math.exp(-((d / 0.2) ** 2));
            const halo = Math.exp(-((d / 0.5) ** 2)) * 0.7;
            const a = Math.min(1, core + halo);
            const c = a > 0 ? core / a : 0;
            const i = (y * s + x) * 4;
            px[i] = 255;
            px[i + 1] = (0.42 + 0.53 * c) * 255;
            px[i + 2] = (0.72 + 0.24 * c) * 255;
            px[i + 3] = a * 255;
        }
    }
    return textureFromRgbaPixels(px, s, s, false, 'fork-navlight');
}

export class ForkFx {
    private c = new Container();
    private pool = new SpritePool(this.c);
    private tex: { light: Texture } | null = null;
    private texFailed = false;
    /** The stock exhaust (enginethrusters/FORK_PLUME_ART.png), loaded once; null until then or if it failed. */
    private plume: Texture | null = null;
    private plumeLoading = false;
    private tracks = new Map<BuiltObject, Track>();
    /** The ships drawn with the effects (ranked from the last frame's candidates); this frame's candidates. */
    private full = new Set<BuiltObject>();
    private candBo: BuiltObject[] = [];
    private candPx: number[] = [];
    private candN = 0;
    private rank: number[] = [];
    private clock = 0;
    // the transform being drawn
    private x = 0;
    private y = 0;
    private cos = 1;
    private sin = 0;
    private rot = 0;
    private sc = 1;
    private ox = 0;
    private oy = 0;

    constructor(parent: Container) {
        this.c.eventMode = 'none';
        parent.addChild(this.c);
    }

    private textures(): { light: Texture } | null {
        if (this.tex === null && !this.texFailed) {
            try {
                this.tex = { light: lightTexture() };
            } catch {
                this.texFailed = true;
            }
        }
        if (this.plume === null && !this.plumeLoading) {
            this.plumeLoading = true;
            const url = engineThrusterUrls()[FORK_PLUME_ART] ?? null;
            if (url !== null) {
                void loadRgba(url).then(
                    (img) => {
                        if (img !== null) this.plume = textureFromRgbaPixels(img.data, img.w, img.h, false, 'fork-plume');
                    },
                    () => undefined,
                );
            }
        }
        return this.tex;
    }

    begin(): void {
        this.pool.begin();
        // the biggest drawn of last frame's candidates
        if (this.candN > FORK_FX_SHIPS_MAX) {
            const idx = this.rank;
            idx.length = 0;
            for (let i = 0; i < this.candN; i++) idx.push(i);
            idx.sort((a, b) => this.candPx[b] - this.candPx[a]);
            this.full.clear();
            for (let k = 0; k < FORK_FX_SHIPS_MAX; k++) this.full.add(this.candBo[idx[k]]);
        } else {
            this.full.clear();
            for (let i = 0; i < this.candN; i++) this.full.add(this.candBo[i]);
        }
        this.candN = 0;
    }

    end(): void {
        this.pool.end();
        if (this.tracks.size > 0) for (const [bo, t] of this.tracks) if (bo.hasBeenDestroyed || this.clock - t.t > 3) this.tracks.delete(bo);
    }

    /** Places `s` (anchor axf, ayf) at frame px (fx, fy), turned and scaled with the ship. */
    private put(s: { position: { set(x: number, y: number): void }; anchor: { set(x: number, y: number): void }; rotation: number }, fx: number, fy: number, axf: number, ayf: number): void {
        const lx = (fx - this.ox) * this.sc;
        const ly = (fy - this.oy) * this.sc;
        s.position.set(this.x + lx * this.cos - ly * this.sin, this.y + lx * this.sin + ly * this.cos);
        s.anchor.set(axf, ayf);
        s.rotation = this.rot;
    }

    /**
     * A fork-look ship (the Watcher or the capital ship: `art` its frame data) drawn at (x, y), turned `rotation`, `scale` world units per frame px, its anchor (ox, oy) frame
     * px; `px` its drawn size; `sec` the wall clock; `speed` its speed over its cruise speed (0..).
     */
    draw(art: ForkArt, bo: BuiltObject, x: number, y: number, rotation: number, scale: number, ox: number, oy: number, px: number, sec: number, speed: number): void {
        const dt = Math.max(0, Math.min(0.25, sec - this.clock));
        this.clock = sec;
        let tr = this.tracks.get(bo);
        if (tr === undefined) {
            tr = { k: forkThrust(speed), t: sec };
            this.tracks.set(bo, tr);
        }
        const want = forkThrust(speed);
        tr.k += (want - tr.k) * Math.min(1, (sec - tr.t > 0.5 ? 1 : Math.max(dt, sec - tr.t)) * FOLLOW);
        tr.t = sec;
        if (px < FORK_PLUMES_MIN_PX) return;
        const i = this.candN++;
        this.candBo[i] = bo;
        this.candPx[i] = px;
        if (!this.full.has(bo)) return;
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
        const A = art;
        const plume = this.plume;
        if (FORK_FX.plumes && plume !== null && tr.k > 0.01) {
            const k = tr.k;
            // the stock exhaust as ambientLayer.ts draws it (untinted, normal blend, its hot head at the top of the raw
            // art turned with the ship): its length the stock PrepareEngineExhaust's 0.15 x the ship's prepared size
            // times the speed factor (1 at impulse .. 1.7 at cruise, here eased by speed) x FORK_PLUME_LEN; its width
            // the bank's span (the art's flame fills about 1 / FORK_PLUME_SPREAD of its width)
            const len = A.size * 0.15 * (0.6 + 1.1 * k) * FORK_PLUME_LEN;
            for (let n = 0; n < A.nozzles.length; n++) {
                const z = A.nozzles[n];
                // a wide, flat band across the bank: FORK_PLUME_PIECES stock flames side by side, overlapping so they merge
                const step = z.w / FORK_PLUME_PIECES;
                for (let i = 0; i < FORK_PLUME_PIECES; i++) {
                    const s = this.pool.acquire(plume);
                    s.blendMode = 'normal';
                    this.put(s, z.x - z.w / 2 + step * (i + 0.5), z.y, 0.5, 0.1);
                    const wob = 1 + 0.05 * Math.sin(sec * 9 + i * 2.1 + n);
                    s.scale.set((step * FORK_PLUME_SPREAD * scale) / plume.width, (len * wob * scale) / plume.height);
                    s.alpha = Math.min(1, k * 4);
                }
            }
        }
        if (FORK_FX.lights && px >= FORK_LIGHTS_MIN_PX) {
            // a small bright point: ~24 frame px (its halo), at least ~14 screen px whatever the zoom (less on a ship drawn
            // small: at most ~16 % of its drawn size, so a frigate's lights stay points)
            const screenPerFrame = px / A.size;
            const minScreen = Math.min(14, Math.max(4, px * 0.16));
            const size = Math.max(24, minScreen / Math.max(1e-3, screenPerFrame));
            for (let n = 0; n < A.lights.length; n++) {
                const L = A.lights[n];
                const b = forkBlink(sec, L.period, L.phase);
                if (b <= 0.01) continue;
                const s = this.pool.acquire(tex.light);
                s.blendMode = 'add';
                this.put(s, L.x, L.y, 0.5, 0.5);
                s.rotation = 0;
                s.scale.set((size * scale) / 32);
                s.alpha = b;
            }
        }
    }
}
