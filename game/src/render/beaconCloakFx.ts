// The Watchers' cloak, seen (Giantworks add-on, the Beacon; render only). The sim (beacon.ts) sets `bo.cloaked` on a
// Watcher and lists in `cloakSeenBy` the empires that spotted it (detectCloaked); the fog layer hides a cloaked Watcher
// from everyone else. This draws what is left to see:
// - CLOAKED (drawn, so the viewer detected it): no hull, only a faint dark-purple outline breathing slowly and the stars
//   behind it bent (StarLens: a displacement filter on the deep starfield, its map the ship's silhouette filled with
//   noise, a slow calm wobble of several seconds a cycle).
// - DECLOAK (`cloaked` goes false; CLOAK_TRANSITION_S, 10 s, with the decloak sound and the pulse: decloaksSince,
//   pulseLevel, beaconPulseFx.ts, audio/beaconDecloak.ts): in the Beacon warp's own dark-matter language (beaconWarp.ts
//   veil, the same metaballs, motes and sparks, pooled and limited the same way): dark blobs swell up over the
//   silhouette and merge, then peel back and drain off the hull's edges as the hull fades in beneath, fine dark motes
//   drifting off, slow violet sparks crawling along the edges; the starfield bends throughout; the engines come up and
//   the pink navigation lights flicker on last. RE-CLOAK runs it backward, quicker (CLOAK_RECLOAK_S; the blobs swallow
//   the ship from its edges in); a Watcher the viewer has not detected stays drawn (cloakFading, read by fog.ts) until it has gone.
// - SIGHTED markers (watcherSightings, drawn by artBundleLayer.ts): where the viewer last detected a cloaked Watcher,
//   fading over the seen-through days (beaconDetectSeenDays).
// The outline for at most CLOAK_SHIMMER_SLOTS Watchers a frame, the starfield lens for the biggest one; the fade frames
// made once per frame file, on the first transition. Works for any Watcher frame (fork, Reaper, carrier).

import { Container, DisplacementFilter, Rectangle, Sprite, Texture } from 'pixi.js';
import type { BuiltObject } from '../sim/builtObject';
import type { Empire } from '../sim/empire';
import { peekBeaconState, warOn } from '../sim/scenario/threats/giantworks/beaconState';
import { SpritePool } from './fxCommon';
import { textureFromRgbaPixels } from './textureCanvas';
import { loadRgba } from '../ui/empireEmblem';

export const CLOAK_FX = { on: true };
/** A decloak (s): slow, the dark matter unfolding with the decloak sound (beaconDecloak.ts). */
export const CLOAK_TRANSITION_S = 10.0;
/** A re-cloak (s): quicker, the ship swallowed and gone. */
export const CLOAK_RECLOAK_S = 4.5;
/** The decloak sound's opening hit (s into it): the pulse's ring and screen-edge dark fire on it. */
export const DECLOAK_HIT_S = 1.3;
/** The pulse (ring, vignette, sound) is heard / seen fully within PULSE_NEAR sectors of the camera or the player's
 * worlds, and nothing beyond PULSE_FAR sectors of the player's worlds. */
export const PULSE_NEAR = 0.6;
export const PULSE_FAR = 3.5;
/** How many reveal frames (the hull from its edges inward). */
export const CLOAK_STEPS = 10;
/** At most this many shimmering Watchers a frame. */
export const CLOAK_SHIMMER_SLOTS = 4;
/** The shimmer's slow breath (s per cycle) and the hull's fade-in under the dark mass (reveal span). */
const BREATH_S = 5.5;
const HULL_IN: readonly [number, number] = [0.32, 0.62];

/** The reveal 0..1 one step on toward `target` (dt s). Pure. */
export function cloakStep(r: number, target: number, dt: number): number {
    return target > r ? Math.min(target, r + dt / CLOAK_TRANSITION_S) : Math.max(target, r - dt / CLOAK_RECLOAK_S);
}

/**
 * The pulse's strength 0..1 for a Watcher decloaking at (x, y): by its distance from the camera's centre and from the
 * nearest of the player's worlds (`homes`), in sectors (`sector` world units): full within PULSE_NEAR of either, fading
 * with distance, and nothing beyond PULSE_FAR of every player world (whatever the camera). Pure.
 */
export function pulseLevel(x: number, y: number, camX: number, camY: number, homes: readonly { xpos: number; ypos: number }[], sector: number): number {
    const s = Math.max(1, sector);
    let dHome = Infinity;
    for (const h of homes) dHome = Math.min(dHome, Math.hypot(h.xpos - x, h.ypos - y));
    dHome /= s;
    if (!(dHome < PULSE_FAR)) return 0;
    const dCam = Math.hypot(camX - x, camY - y) / s;
    const fade = (d: number): number => {
        const t = Math.max(0, Math.min(1, (d - PULSE_NEAR) / (PULSE_FAR - PULSE_NEAR)));
        return 1 - t * t * (3 - 2 * t);
    };
    const gate = 1 - Math.max(0, Math.min(1, (dHome - (PULSE_FAR - 0.5)) / 0.5));
    return Math.max(fade(dCam), fade(dHome)) * gate;
}

/** A Watcher's decloak, as the pulse and its sound read it (`at`: the render clock, s; serial: in order). */
export interface DecloakEvent {
    bo: BuiltObject;
    x: number;
    y: number;
    at: number;
    serial: number;
}
const decloaks: DecloakEvent[] = [];
let decloakSerial = 0;

/** The decloaks after `serial` (the reader's last seen; 0 at first), oldest first, into `out`; returns the newest
 * serial. Kept: the last 8. */
export function decloaksSince(serial: number, out: DecloakEvent[]): number {
    out.length = 0;
    for (const e of decloaks) if (e.serial > serial) out.push(e);
    return decloakSerial;
}

/** (Tests and captures.) A decloak noted as observe() notes one. */
export function noteDecloak(bo: BuiltObject, at: number): void {
    decloaks.push({ bo, x: bo.xpos, y: bo.ypos, at, serial: ++decloakSerial });
    if (decloaks.length > 8) decloaks.shift();
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
    return t.r > 0.001 && clock - t.cloakedAt < CLOAK_RECLOAK_S + 0.5;
}

/**
 * A Watcher the viewer has detected but that is still cloaked (or still unfolding out of it): a contact, not a ship.
 * The viewer sees only its outline and the starfield bend (this file); every icon, symbol, ring, name and stat is
 * withheld (the map layers, the stacked-object list, the selection panel and the lists ask this). The owner always
 * sees its own ship; a null viewer (a spectator) sees everything. A decloak counts as a contact until the hull is
 * fully revealed (the render track's reveal below 1), so the icons come back with the hull, not before.
 * Cheap for the common ship (one field read).
 */
export function isCloakedContact(bo: BuiltObject, viewer: Empire | null): boolean {
    if (viewer === null || bo.empire === viewer) return false;
    if (bo.cloaked === true) return true;
    if (tracks.size === 0) return false;
    const t = tracks.get(bo);
    return t !== undefined && t.r < 0.999;
}

/**
 * The panels' rule (selection panel, stacked list, mission text, enemy targets): a cloaked contact, or one of the Beacon's
 * Watchers before the war begins at the first beam, cloaked or not (user, 2026-10-20: a Watcher showing itself over a world is
 * still a mystery; only once it leads the Reclaimers' fleets is it known for what it is). Icons follow isCloakedContact only.
 */
export function isUnidentifiedContact(bo: BuiltObject, viewer: Empire | null): boolean {
    if (isCloakedContact(bo, viewer)) return true;
    if (viewer === null || bo.empire === viewer || viewer.galaxy === undefined || viewer.galaxy === null) return false;
    const st = peekBeaconState(viewer.galaxy);
    return st !== null && !warOn(st) && st.watchers.some((w) => w.ship === bo);
}

/** Whether a fleet's lead is such a contact (the fleet icon, name and count would give the Watcher away). */
export function isCloakedContactFleet(sg: { leadShip: BuiltObject | null }, viewer: Empire | null): boolean {
    return sg.leadShip !== null && isCloakedContact(sg.leadShip, viewer);
}

/** The selection panel's and stacked-list's name for a contact: no ship name, empire, design or role. */
export const CONTACT_NAME = 'Unidentified contact';
/** The one line the panel adds under it. */
export const CONTACT_NOTE = 'Something is there. The sensors cannot say what.';

/**
 * The viewer's sightings of cloaked Watchers (where it was when the viewer's ship or base spotted it, fading over the
 * seen-through days): refreshes from `watchers`' cloakSeenBy (`now` the star date) and returns the live ones with their
 * fade 1..0, but not a Watcher drawn right now. Render-local records.
 */
/** The viewer's last detection of each cloaked Watcher (never expires: the Knowledge page lists them, fading with age). Render-only; recorded
 * by watcherSightings every frame it runs, so it updates with every screen closed. At most one entry per Watcher ship. */
const sightingHistory = new WeakMap<Empire, Map<BuiltObject, { x: number; y: number; date: number }>>();

/** Where and when `viewer` last detected a cloaked Watcher (one record per Watcher, destroyed ones dropped). */
export function sightingLogOf(viewer: Empire | null): { x: number; y: number; date: number }[] {
    const m = viewer === null ? undefined : sightingHistory.get(viewer);
    if (m === undefined) return [];
    for (const bo of m.keys()) if (bo.hasBeenDestroyed) m.delete(bo);
    return [...m.values()];
}

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
            let log = sightingHistory.get(viewer);
            if (log === undefined) sightingHistory.set(viewer, (log = new Map()));
            log.set(bo, { x: bo.xpos, y: bo.ypos, date: now });
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
    // the hull's fade-in frames (it comes up under the dark mass of the veil): its own pixels at k / CLOAK_STEPS alpha
    const steps: Texture[] = [];
    const out = new Uint8ClampedArray(n * 4);
    for (let k = 0; k <= CLOAK_STEPS; k++) {
        const f = k / CLOAK_STEPS;
        for (let i = 0; i < n; i++) {
            out[i * 4] = data[i * 4];
            out[i * 4 + 1] = data[i * 4 + 1];
            out[i * 4 + 2] = data[i * 4 + 2];
            out[i * 4 + 3] = data[i * 4 + 3] * f;
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
        const jx = Math.sin((sec * 2 * Math.PI) / 7.3) * 3;
        const jy = Math.cos((sec * 2 * Math.PI) / 9.1) * 3;
        const lx = (jx - lens.ox) * lens.sc;
        const ly = (jy - lens.oy) * lens.sc;
        this.sprite.position.set(lens.x + lx * cos - ly * sin, lens.y + lx * sin + ly * cos);
        this.sprite.rotation = lens.rot;
        this.sprite.scale.set(lens.sc * 2);
        // a few screen px of bend, by the ship's drawn size, swelling and ebbing
        // a slow, calm breath (BREATH_S per cycle)
        const amp = Math.min(16, Math.max(3, lens.px * 0.03)) * lens.strength * (0.7 + 0.3 * Math.sin((sec * 2 * Math.PI) / BREATH_S));
        this.filter.scale.x = amp;
        this.filter.scale.y = amp * (0.85 + 0.15 * Math.cos((sec * 2 * Math.PI) / (BREATH_S * 1.3)));
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

/** Every Watcher's cloak, once a frame at every zoom (mainView.ts, before the layers; drawn or not, before the fog asks
 * cloakFading): the flips start the transitions and note the decloaks (the pulse and its sound read them). */
export function observeWatchers(watchers: readonly BuiltObject[], sec: number): void {
    const dt = Math.max(0, Math.min(0.25, sec - clock));
    clock = sec;
    for (const bo of watchers) {
        const cloaked = bo.cloaked === true;
        let t = tracks.get(bo);
        if (t === undefined) {
            t = { r: cloaked ? 0 : 1, t: sec, cloaked, drawn: -99, cloakedAt: -99 };
            tracks.set(bo, t);
        }
        if (cloaked !== t.cloaked) {
            if (cloaked) t.cloakedAt = sec;
            else noteDecloak(bo, sec);
            t.cloaked = cloaked;
        }
        t.r = CLOAK_FX.on ? cloakStep(t.r, cloaked ? 0 : 1, dt) : cloaked ? 0 : 1;
        t.t = sec;
    }
}

export class CloakFx {
    readonly root = new Container();
    private pool = new SpritePool(this.root);
    private reveals = new Map<string, Reveal | null>();
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

    /** A Watcher's reveal now (1: the plain hull). */
    revealOf(bo: BuiltObject): number {
        return tracks.get(bo)?.r ?? (bo.cloaked === true ? 0 : 1);
    }

    /**
     * A Watcher drawn this frame (`file` its frame, its sprite transform: (x, y), rotation, world units per frame px,
     * the anchor (ox, oy) frame px; `px` its drawn size; `sec` the
     * wall clock). Returns its reveal 0..1 (1: the plain hull) and, while it is not fully revealed, the frame to draw in
     * place of its art (a reveal step; null while those are still being made: the hull is hidden then).
     */
    draw(file: string, bo: BuiltObject, x: number, y: number, rotation: number, scale: number, ox: number, oy: number, px: number, sec: number): { r: number; tex: Texture | null } {
        const t = tracks.get(bo);
        if (t === undefined) return { r: 1, tex: null };
        t.drawn = sec;
        const r = t.r;
        if (r >= 0.999) return { r: 1, tex: null };
        const rv = this.reveal(file);
        const hull = Math.max(0, Math.min(1, (r - HULL_IN[0]) / (HULL_IN[1] - HULL_IN[0])));
        const step = rv === null ? null : rv.steps[Math.max(0, Math.min(CLOAK_STEPS, Math.round(hull * hull * (3 - 2 * hull) * CLOAK_STEPS)))];
        // the shimmer (cloaked, and the start of a decloak / the end of a re-cloak); the starfield bends through the
        // whole transition
        const shimmer = 1 - Math.max(0, Math.min(1, r / HULL_IN[0]));
        const bend = Math.max(shimmer, 0.7 * Math.sin(Math.PI * r));
        const breath = 0.5 + 0.5 * Math.sin((sec * 2 * Math.PI) / BREATH_S + bo.builtObjectID);
        if (rv !== null && px >= 12 && this.shimmerN < CLOAK_SHIMMER_SLOTS && bend > 0.02) {
            this.shimmerN++;
            if (shimmer > 0.02) {
                // the faint dark-purple outline, breathing slowly
                const rm = this.pool.acquire(rv.rim);
                rm.anchor.set(0, 0);
                const cos = Math.cos(rotation);
                const sin = Math.sin(rotation);
                const lx = -ox * scale;
                const ly = -oy * scale;
                rm.position.set(x + lx * cos - ly * sin, y + lx * sin + ly * cos);
                rm.rotation = rotation;
                rm.scale.set(scale);
                rm.tint = 0x3c1866;
                rm.alpha = shimmer * (0.42 + 0.18 * breath);
                rm.blendMode = 'normal';
            }
            // the starfield lens: the biggest drawn of them
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
                lens.strength = bend;
            }
        }
        return { r, tex: step };
    }
}
