// The Watchers' cloak, seen (Giantworks add-on, the Beacon; render only). The sim (beacon.ts) sets `bo.cloaked` on a
// Watcher and lists in `cloakSeenBy` the empires that spotted it (detectCloaked); the fog layer hides a cloaked Watcher
// from everyone else. This draws what is left to see:
// - CLOAKED (drawn, so the viewer detected it): no hull, only a faint heat-shimmer silhouette that bends the stars
//   behind it (StarLens: a displacement filter on the deep starfield, its map the ship's silhouette filled with noise,
//   wobbling; and a faint rim).
// - DECLOAK (`cloaked` goes false): a shimmer ripples outward from the skull, the hull fades in from its edges inward
//   (CLOAK_STEPS precomputed reveal frames of the ship's own art), its engines and lamps come up and the navigation
//   lights flicker on last; CLOAK_TRANSITION_S in all. RE-CLOAK reverses it; a Watcher the viewer has not detected
//   stays drawn (cloakFading, read by fog.ts) until it has faded out.
// - SIGHTED markers (watcherSightings, drawn by artBundleLayer.ts): where the viewer last detected a cloaked Watcher,
//   fading over the seen-through days (beaconDetectSeenDays).
// Pooled; the rim and ripple for at most CLOAK_SHIMMER_SLOTS Watchers a frame, the starfield lens for the biggest one;
// reveal frames made once per frame file, on the first transition. Works for any Watcher frame (fork, Reaper, carrier).

import { Container, DisplacementFilter, Rectangle, Sprite, Texture } from 'pixi.js';
import type { BuiltObject } from '../sim/builtObject';
import type { Empire } from '../sim/empire';
import { SpritePool } from './fxCommon';
import { textureFromRgbaPixels } from './textureCanvas';
import { loadRgba } from '../ui/empireEmblem';

export const CLOAK_FX = { on: true };
/** A decloak or re-cloak (s). */
export const CLOAK_TRANSITION_S = 2.0;
/** How many reveal frames (the hull from its edges inward). */
export const CLOAK_STEPS = 10;
/** At most this many shimmering Watchers a frame. */
export const CLOAK_SHIMMER_SLOTS = 4;
/** The ripple: its share of the decloak (it runs first), and how far it spreads (frame sizes). */
const RIPPLE_SHARE = 0.55;
const RIPPLE_REACH = 0.75;

/** The reveal 0..1 one step on toward `target` (dt s). Pure. */
export function cloakStep(r: number, target: number, dt: number): number {
    const k = dt / CLOAK_TRANSITION_S;
    return target > r ? Math.min(target, r + k) : Math.max(target, r - k);
}

/** The navigation lights' gate at reveal r (flickering on over the last fifth; `sec`, a per-light seed). Pure. */
export function cloakLightGate(r: number, sec: number, seed: number): number {
    if (r >= 0.999) return 1;
    if (r < 0.8) return 0;
    const u = (r - 0.8) / 0.2;
    const f = Math.sin(sec * 37 + seed * 12.9898) * 43758.5453;
    return f - Math.floor(f) < u ? 1 : 0;
}

/** The engines' and lamps' strength at reveal r. Pure. */
export function cloakGlow(r: number): number {
    return Math.max(0, Math.min(1, (r - 0.5) / 0.4));
}

interface Track {
    r: number;
    t: number;
    cloaked: boolean;
    /** When the last decloak started (s), for the ripple. */
    decloakAt: number;
    /** The last time it was drawn (s), and when it last cloaked while drawn (for the fog's grace). */
    drawn: number;
    cloakedAt: number;
}

interface Reveal {
    steps: Texture[];
    /** The faint rim (white, its alpha the outline band) and the lens map (half size: neutral grey, noise inside). */
    rim: Texture;
    map: Texture;
    w: number;
    h: number;
}

/** The starfield lens this frame: the biggest drawn shimmering Watcher (world transform of its frame), or none. */
interface Lens {
    on: boolean;
    map: Texture | null;
    x: number;
    y: number;
    rot: number;
    sc: number;
    ox: number;
    oy: number;
    strength: number;
    px: number;
}
const lens: Lens = { on: false, map: null, x: 0, y: 0, rot: 0, sc: 1, ox: 0, oy: 0, strength: 0, px: 0 };
/** The lens's last applied state (captures and tests read it). */
export const cloakLensDebug = { applied: false, amp: 0, px: 0 };

interface Sighting {
    x: number;
    y: number;
    from: number;
    until: number;
}

const tracks = new Map<BuiltObject, Track>();
const sightings = new Map<BuiltObject, Sighting>();
let clock = 0;

/** Whether a Watcher the fog would hide is still fading out of a re-cloak the viewer watched (fog.ts). */
export function cloakFading(bo: BuiltObject): boolean {
    const t = tracks.get(bo);
    if (t === undefined || !t.cloaked) return false;
    return t.r > 0.001 && clock - t.cloakedAt < CLOAK_TRANSITION_S + 0.5;
}

/**
 * The viewer's sightings of cloaked Watchers (where it was when the viewer's ship or base spotted it, fading over the
 * seen-through days): refreshes from `watchers`' cloakSeenBy (`now` the star date) and returns the live ones with their
 * fade 1..0, but not a Watcher drawn right now. Render-local records.
 */
export function watcherSightings(watchers: readonly BuiltObject[], viewer: Empire | null, now: number, out: { x: number; y: number; fade: number }[]): number {
    let n = 0;
    if (viewer !== null) {
        for (const bo of watchers) {
            const seen = bo.cloakSeenBy;
            if (seen === undefined || bo.hasBeenDestroyed) continue;
            let until = -1;
            for (const s of seen) if (s.empireId === viewer.empireId && s.until > until) until = s.until;
            if (until <= now) continue;
            const rec = sightings.get(bo);
            if (rec === undefined || rec.until !== until) sightings.set(bo, { x: bo.xpos, y: bo.ypos, from: rec !== undefined && rec.until === until ? rec.from : now, until });
        }
    }
    for (const [bo, s] of sightings) {
        if (s.until <= now || bo.hasBeenDestroyed) {
            sightings.delete(bo);
            continue;
        }
        // not while the Watcher itself is drawn (its shimmer or hull marks it)
        const t = tracks.get(bo);
        if (t !== undefined && clock - t.drawn < 0.5) continue;
        const fade = Math.max(0, Math.min(1, (s.until - now) / Math.max(1, s.until - s.from)));
        if (out.length <= n) out.push({ x: 0, y: 0, fade: 0 });
        out[n].x = s.x;
        out[n].y = s.y;
        out[n].fade = fade;
        n++;
    }
    return n;
}

/** A soft ring (the ripple), white. */
function ringTexture(): Texture {
    const s = 128;
    const px = new Uint8ClampedArray(s * s * 4);
    for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
            const d = Math.hypot((x + 0.5) / s - 0.5, (y + 0.5) / s - 0.5) * 2;
            const a = Math.exp(-(((d - 0.82) / 0.09) ** 2)) * (d < 1 ? 1 : 0);
            const i = (y * s + x) * 4;
            px[i] = px[i + 1] = px[i + 2] = 255;
            px[i + 3] = a * 255;
        }
    }
    return textureFromRgbaPixels(px, s, s, false, 'cloak-ring');
}

/** The reveal frames of a ship's art: step k (1..CLOAK_STEPS) shows the hull from its edges in to depth k/STEPS (the
 * front a little lit), step 0 none; and the white silhouette. From its pixels, once. */
function makeReveal(data: Uint8ClampedArray | Uint8Array, w: number, h: number): Reveal {
    const n = w * h;
    const a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = data[i * 4 + 3] / 255 > 0.5 ? 1 : 0;
    // an inward depth field: the solid mask box-blurred (three passes each way); 1 - blur near the outline, 0 deep in
    const r = Math.max(2, Math.round(Math.max(w, h) / 36));
    let b = a.slice();
    const tmp = new Float32Array(n);
    for (let pass = 0; pass < 3; pass++) {
        for (let y = 0; y < h; y++) {
            let acc = 0;
            for (let x = -r; x <= r; x++) acc += x >= 0 && x < w ? b[y * w + x] : 0;
            for (let x = 0; x < w; x++) {
                tmp[y * w + x] = acc / (2 * r + 1);
                const xa = x + r + 1;
                const xr = x - r;
                acc += (xa < w ? b[y * w + xa] : 0) - (xr >= 0 ? b[y * w + xr] : 0);
            }
        }
        for (let x = 0; x < w; x++) {
            let acc = 0;
            for (let y = -r; y <= r; y++) acc += y >= 0 && y < h ? tmp[y * w + x] : 0;
            for (let y = 0; y < h; y++) {
                b[y * w + x] = acc / (2 * r + 1);
                const ya = y + r + 1;
                const yr = y - r;
                acc += (ya < h ? tmp[ya * w + x] : 0) - (yr >= 0 ? tmp[yr * w + x] : 0);
            }
        }
    }
    const steps: Texture[] = [];
    const out = new Uint8ClampedArray(n * 4);
    for (let k = 0; k <= CLOAK_STEPS; k++) {
        const th = 1 - k / CLOAK_STEPS;
        for (let i = 0; i < n; i++) {
            const al = data[i * 4 + 3];
            let wgt = 0;
            if (k > 0 && al > 0) {
                const e = Math.min(1, Math.max(0, (1 - b[i]) * 2.2));
                wgt = Math.max(0, Math.min(1, (e - th) / 0.16 + 1));
            }
            const front = k < CLOAK_STEPS ? wgt * (1 - wgt) * 4 : 0;
            const lift = 1 + 0.35 * front;
            out[i * 4] = Math.min(255, data[i * 4] * lift + 18 * front);
            out[i * 4 + 1] = Math.min(255, data[i * 4 + 1] * lift + 12 * front);
            out[i * 4 + 2] = Math.min(255, data[i * 4 + 2] * lift + 20 * front);
            out[i * 4 + 3] = al * wgt;
        }
        steps.push(textureFromRgbaPixels(out, w, h, false, `cloak-reveal-${k}`));
    }
    // the rim: the outline band (1 - the depth field near the edge), faint
    for (let i = 0; i < n; i++) {
        out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = 255;
        const e = a[i] > 0 ? Math.max(0, Math.min(1, (1 - b[i]) * 3.2 - 0.4)) : 0;
        out[i * 4 + 3] = e * 255;
    }
    const rim = textureFromRgbaPixels(out, w, h, false, 'cloak-rim');
    // the lens map, half size: neutral (128) outside, a smooth noise inside the silhouette (feathered)
    const mw = Math.max(1, w >> 1);
    const mh = Math.max(1, h >> 1);
    const mp = new Uint8ClampedArray(mw * mh * 4);
    for (let y = 0; y < mh; y++) {
        for (let x = 0; x < mw; x++) {
            const sx = Math.min(w - 1, x * 2);
            const sy = Math.min(h - 1, y * 2);
            const m = Math.max(0, Math.min(1, b[sy * w + sx] * 1.6 - 0.2));
            const nx = Math.sin(x * 0.21 + Math.sin(y * 0.13) * 2.1) * Math.cos(y * 0.17 - x * 0.05);
            const ny = Math.cos(y * 0.19 + Math.sin(x * 0.11) * 1.7) * Math.sin(x * 0.15 + y * 0.07);
            const i = (y * mw + x) * 4;
            mp[i] = 128 + 127 * nx * m;
            mp[i + 1] = 128 + 127 * ny * m;
            mp[i + 2] = 128;
            mp[i + 3] = 255;
        }
    }
    return { steps, rim, map: textureFromRgbaPixels(mp, mw, mh, false, 'cloak-lens-map'), w, h };
}

/**
 * The starfield lens (mainView.ts, on the deep starfield behind the world): while a detected, cloaked Watcher is drawn,
 * the stars behind it bend (a displacement filter, its map the Watcher's silhouette filled with noise, placed on the
 * ship and wobbling). Off (no filter) otherwise.
 */
export class StarLens {
    private sprite = new Sprite(Texture.EMPTY);
    private filter: DisplacementFilter | null = null;
    private failed = false;

    /** `target` the starfield container to bend; `world` the container the ships are drawn in (the map sprite's place). */
    constructor(private target: Container, world: Container) {
        this.sprite.renderable = false;
        this.sprite.eventMode = 'none';
        world.addChild(this.sprite);
    }

    private area = new Rectangle();

    /** Each frame after the ships (`w` x `h` the screen in CSS px: the filter's area; the starfield's particle layers
     * have no bounds of their own). */
    update(sec: number, w: number, h: number): void {
        cloakLensDebug.applied = false;
        if (!lens.on || lens.map === null || this.failed) {
            if (this.filter !== null && this.target.filters?.includes(this.filter)) {
                this.target.filters = (this.target.filters ?? []).filter((f) => f !== this.filter);
                if (this.target.filters.length === 0) this.target.filterArea = undefined;
            }
            lens.on = false;
            return;
        }
        if (this.filter === null) {
            try {
                this.sprite.texture = lens.map;
                this.filter = new DisplacementFilter({ sprite: this.sprite, scale: 0 });
            } catch {
                this.failed = true;
                return;
            }
        }
        if (this.sprite.texture !== lens.map) {
            this.sprite.texture = lens.map;
            this.filter.resources.uMapTexture = lens.map.source;
        }
        // the map at the ship (its frame px x2: the map is half size), turned with it, a slight wobble
        const cos = Math.cos(lens.rot);
        const sin = Math.sin(lens.rot);
        const jx = Math.sin(sec * 1.7) * 3;
        const jy = Math.cos(sec * 1.3) * 3;
        const lx = (jx - lens.ox) * lens.sc;
        const ly = (jy - lens.oy) * lens.sc;
        this.sprite.position.set(lens.x + lx * cos - ly * sin, lens.y + lx * sin + ly * cos);
        this.sprite.rotation = lens.rot;
        this.sprite.scale.set(lens.sc * 2);
        // a few screen px of bend, by the ship's drawn size, swelling and ebbing
        const amp = Math.min(16, Math.max(3, lens.px * 0.03)) * lens.strength * (0.75 + 0.25 * Math.sin(sec * 2.2));
        this.filter.scale.x = amp;
        this.filter.scale.y = amp * (0.8 + 0.2 * Math.cos(sec * 1.6));
        cloakLensDebug.applied = true;
        cloakLensDebug.amp = amp;
        cloakLensDebug.px = lens.px;
        this.area.width = w;
        this.area.height = h;
        this.target.filterArea = this.area;
        const cur = this.target.filters ?? [];
        if (!cur.includes(this.filter)) this.target.filters = [...cur, this.filter];
        lens.on = false; // re-armed by the next frame's draw
    }
}

export class CloakFx {
    readonly root = new Container();
    private pool = new SpritePool(this.root);
    private reveals = new Map<string, Reveal | null>();
    private ring: Texture | null = null;
    private shimmerN = 0;

    constructor(private urlOf: (file: string) => string) {
        this.root.eventMode = 'none';
    }

    private lensPx = 0;

    begin(): void {
        this.pool.begin();
        this.shimmerN = 0;
        this.lensPx = 0;
    }

    end(): void {
        this.pool.end();
        if (tracks.size > 8) for (const [bo, t] of tracks) if (bo.hasBeenDestroyed || clock - t.t > 30) tracks.delete(bo);
    }

    private reveal(file: string): Reveal | null {
        const got = this.reveals.get(file);
        if (got !== undefined) return got;
        this.reveals.set(file, null);
        void loadRgba(this.urlOf(file)).then(
            (img) => {
                if (img !== null) this.reveals.set(file, makeReveal(img.data, img.w, img.h));
            },
            () => undefined,
        );
        return null;
    }

    /** Every Watcher, each frame (drawn or not, before the fog asks cloakFading): its cloak's flips start a transition
     * whether or not it was on screen as it decloaked. */
    observe(watchers: readonly BuiltObject[], sec: number): void {
        const dt = Math.max(0, Math.min(0.25, sec - clock));
        clock = sec;
        for (const bo of watchers) {
            const cloaked = bo.cloaked === true;
            let t = tracks.get(bo);
            if (t === undefined) {
                t = { r: cloaked ? 0 : 1, t: sec, cloaked, decloakAt: -99, drawn: -99, cloakedAt: -99 };
                tracks.set(bo, t);
            }
            if (cloaked !== t.cloaked) {
                if (!cloaked) t.decloakAt = sec;
                else t.cloakedAt = sec;
                t.cloaked = cloaked;
            }
            t.r = CLOAK_FX.on ? cloakStep(t.r, cloaked ? 0 : 1, dt) : cloaked ? 0 : 1;
            t.t = sec;
        }
    }

    /** A Watcher's reveal now (1: the plain hull). */
    revealOf(bo: BuiltObject): number {
        return tracks.get(bo)?.r ?? (bo.cloaked === true ? 0 : 1);
    }

    /**
     * A Watcher drawn this frame (`file` its frame, its sprite transform: (x, y), rotation, world units per frame px,
     * the anchor (ox, oy) frame px; `px` its drawn size; `skull` its skull's frame px, the ripple's centre; `sec` the
     * wall clock). Returns its reveal 0..1 (1: the plain hull) and, while it is not fully revealed, the frame to draw in
     * place of its art (a reveal step; null while those are still being made: the hull is hidden then).
     */
    draw(file: string, bo: BuiltObject, x: number, y: number, rotation: number, scale: number, ox: number, oy: number, px: number, skull: readonly [number, number], sec: number): { r: number; tex: Texture | null } {
        const t = tracks.get(bo);
        if (t === undefined) return { r: 1, tex: null };
        t.drawn = sec;
        const cloaked = t.cloaked;
        const r = t.r;
        if (r >= 0.999) return { r: 1, tex: null };
        const rv = this.reveal(file);
        const step = rv === null ? null : rv.steps[Math.max(0, Math.min(CLOAK_STEPS, Math.round(r * CLOAK_STEPS)))];
        // the shimmer: strongest fully cloaked, fading as the hull comes in; the ripple from the skull on a decloak
        const shimmer = 1 - r;
        const since = sec - t.decloakAt;
        const ripple = !cloaked && since >= 0 && since < CLOAK_TRANSITION_S * RIPPLE_SHARE ? since / (CLOAK_TRANSITION_S * RIPPLE_SHARE) : -1;
        if (rv !== null && px >= 12 && this.shimmerN < CLOAK_SHIMMER_SLOTS && (shimmer > 0.02 || ripple >= 0)) {
            this.shimmerN++;
            const cos = Math.cos(rotation);
            const sin = Math.sin(rotation);
            const place = (sp: Sprite, fx: number, fy: number): void => {
                const lx = (fx - ox) * scale;
                const ly = (fy - oy) * scale;
                sp.position.set(x + lx * cos - ly * sin, y + lx * sin + ly * cos);
                sp.rotation = rotation;
            };
            if (shimmer > 0.02) {
                // the faint rim, flickering a little
                const rm = this.pool.acquire(rv.rim);
                rm.anchor.set(0, 0);
                place(rm, 0, 0);
                rm.scale.set(scale);
                rm.tint = 0xd8d0e8;
                rm.alpha = shimmer * (0.1 + 0.05 * Math.sin(sec * 7.3 + bo.builtObjectID));
                rm.blendMode = 'add';
                // the starfield lens: the biggest drawn of the shimmering Watchers
                if (px > this.lensPx) {
                    this.lensPx = px;
                    lens.on = true;
                    lens.map = rv.map;
                    lens.x = x;
                    lens.y = y;
                    lens.rot = rotation;
                    lens.sc = scale;
                    lens.ox = ox;
                    lens.oy = oy;
                    lens.px = px;
                    lens.strength = shimmer;
                }
            }
            if (ripple >= 0) {
                if (this.ring === null) this.ring = ringTexture();
                const rg = this.pool.acquire(this.ring);
                place(rg, skull[0], skull[1]);
                const side = Math.max(rv.w, rv.h) * RIPPLE_REACH * 2 * (0.08 + 0.92 * ripple);
                rg.scale.set((side * scale) / this.ring.width);
                rg.tint = 0xe6d8ff;
                rg.alpha = 0.45 * (1 - ripple) * (0.4 + 0.6 * Math.min(1, ripple * 5));
                rg.blendMode = 'add';
            }
        }
        return { r, tex: step };
    }
}
