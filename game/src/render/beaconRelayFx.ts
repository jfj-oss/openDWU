// The Beacon station's living art (Giantworks add-on, the 'beacon' wonder; render only): the relay
// (scripts/beacon-ships.py build_relay_outputs → public/art/beacon/beacon*.png, beaconArtData.ts BEACON_RELAY).
//
// The ship layer draws the relay's body (beacon-body.png: the ring, the fin, the housings, the prongs less the lower
// one's tip); this draws on it, in order: the tip (straight, or snapped and bent under heavy damage), the pits, the
// lines' swell (wine red, breathing), the core's light in the well, the gyroscope rings' back halves, the core, their
// front halves (each ring turned about its own axis: its half-textures scaled across that axis), then the damage's
// sparks, smoke and debris, the launch's charge pulses and the beam. Pooled sprites, fixed particle arrays: nothing
// allocated per frame.
//
// The countdown (beaconLaunch.ts beaconCountdown: 0 in the quiet year, rising through the preparation to 1 on the
// launch day) sets the gyros' spin (a slow turn → a blur) and the core's heat (dim wine red → orange → white-hot).
// The call (beaconLaunch.ts pollBeaconLaunch) runs the launch sequence: charge pulses race down both prongs' seams into
// the core, the gyros spin to a full blur, a ring collapses on the core, then the MEGA BEAM fires straight up from it —
// end-on to the camera: a white disc with a green contour fading fast into white and turning spiral fringes, two
// counter-turning swirls, rising rings, streaks, a lot of bloom (stacked additive layers, its flash capped at
// BEAM_FLASH_CAP: one soft rise, never a strobe), and hundreds of embers thrown out from its base along the vortex's
// spiral: mostly bright flecks, white-hot cooling to orange, a few deep wine-grey ones (EMBERS).
//
// Damage (the station's damaged components over its components, beaconDamageTier): light — sparks along the seams and
// round the ring, the lines flicker; heavy — pitted, cracked plating, the lower prong snapped at its break and bent, the
// break's raw edge glowing, debris shedding, smoke streaming; near death — the core sputters and the gyros stutter.

import { Rectangle, Texture, type Sprite } from 'pixi.js';
import type { BuiltObject } from '../sim/builtObject';
import type { SpritePool } from './fxCommon';
import { loadShipArt } from './shipArt';
import { BEACON_BEAM, BEACON_HEAT_C, BEACON_HEAT_X, BEACON_RELAY, BEACON_REST_PHASE, type BeaconFxRect } from './beaconArtData';
import { BEACON_ART_DIR } from './threatArt';
import { beaconSpinRate } from './beaconLaunch';

/** The launch sequence (s from the call): the charge pulses, the collapse on the core, the beam, its hold and decay. */
export const LAUNCH = {
    pulse0: 0.4,
    pulseGap: 0.5,
    pulseRun: 0.75,
    pulses: 4,
    charge: 2.6,
    ignite: 3.3,
    hold: 9.2,
    fade: 12.2,
    end: 18,
} as const;
/** The gyros' spin at the height of the call (rad/s): a full blur. */
export const LAUNCH_SPIN = 60;
/** The blur: from this spin (rad/s) the sharp rings give way to spun shells, fully by BLUR_FULL. */
export const BLUR_FROM = 10;
export const BLUR_FULL = 34;
/** The flash's cap (alpha of the whole flash bloom): one soft rise, never a strobe. */
export const BEAM_FLASH_CAP = 0.35;
/**
 * The beam's embers (the user's pick): mostly bright flecks, white-hot cooling to orange (additive), a few deep wine-grey
 * ones (low opacity); each a tapered, soft-edged arc bowed along its path, which follows the vortex's spiral (every
 * ember runs with the swirl, none across it), a faint hot core of its own.
 */
export const EMBERS = {
    /** Per second at full beam; their life (s); their length (frame px, skewed small). */
    rate: 300,
    life: [0.9, 2.6] as const,
    len: [12, 36] as const,
    lenPow: 2,
    thick: 1,
    /** The flow's angle off the radial (rad, clockwise as the swirl turns). */
    spiral: 0.95,
    /** Share drawn with the tighter curve; share bright. */
    tight: 0.4,
    bright: 0.85,
    dark: 0x3d2a33,
    darkAlpha: 0.45,
    coreAlpha: 0.9,
} as const;

/** No relay detail under this drawn size (px): the ship layer's whole frame (beacon.png) instead. */
export const RELAY_MIN_PX = 14;

function smoothstep(a: number, b: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
}

/** The beam's strength 0..1 at t s from the call. Pure. */
export function beamEnvelope(t: number): number {
    if (t < LAUNCH.ignite) return 0;
    if (t < LAUNCH.ignite + 0.35) return smoothstep(LAUNCH.ignite, LAUNCH.ignite + 0.35, t);
    if (t < LAUNCH.hold) return 1;
    return 1 - smoothstep(LAUNCH.hold, LAUNCH.fade, t);
}

/** The ignition's flash 0..1 (a single decay from the ignition). Pure. */
export function beamFlash(t: number): number {
    return t >= LAUNCH.ignite ? Math.exp(-(t - LAUNCH.ignite) / 0.45) : 0;
}

/** The alpha of the whole flash bloom at t: the hold's glare plus the flash, never above BEAM_FLASH_CAP. Pure. */
export function beamFlashAlpha(t: number): number {
    return Math.min(BEAM_FLASH_CAP, 0.22 * beamEnvelope(t) + 0.13 * beamFlash(t));
}

/** Charge pulse `wave`'s progress down its seam (0 at the prong's tip .. 1 at the core) at t, or -1 when not running. Pure. */
export function pulseProgress(t: number, wave: number): number {
    const q = (t - LAUNCH.pulse0 - wave * LAUNCH.pulseGap) / LAUNCH.pulseRun;
    return q < 0 || q > 1.05 ? -1 : Math.min(1, q);
}

/** The gyros' spin (rad/s) at t s from the call (null: no call), over the season's own. Pure. */
export function launchSpin(t: number | null, season: number): number {
    if (t === null || t < 0 || t > LAUNCH.end) return season;
    if (t < LAUNCH.charge) return season + (LAUNCH_SPIN - season) * smoothstep(0, LAUNCH.charge, t);
    if (t < LAUNCH.fade) return LAUNCH_SPIN;
    return season + (LAUNCH_SPIN - season) * Math.exp(-(t - LAUNCH.fade) / 1.6);
}

/** The core's heat 0..1 at t s from the call over the season's. Pure. */
export function launchHeat(t: number | null, season: number): number {
    if (t === null || t < 0 || t > LAUNCH.end) return season;
    if (t < LAUNCH.fade) return Math.max(season, smoothstep(0, LAUNCH.charge * 0.6, t));
    return season + (1 - season) * (1 - smoothstep(LAUNCH.fade, LAUNCH.end, t));
}

/** How far the gyros are spun to a blur (0..1) at spin w. Pure. */
export function gyroBlur(w: number): number {
    return smoothstep(BLUR_FROM, BLUR_FULL, w);
}

/** Gyro k's axis (screen angle) and its turn about it at spin phase `phase` (scripts/beacon-ships.py rl_gyro_angles). Pure. */
export function gyroAngles(phase: number, k: number, out: [number, number]): [number, number] {
    const g = BEACON_RELAY.gyros[k];
    out[0] = g.axis + 0.15 * Math.sin(phase * 0.05 + k);
    out[1] = phase * g.rate + k * 1.1;
    return out;
}

/** The core's colour (0xRRGGBB) at heat 0..1. Pure. */
export function heatColour(h: number): number {
    const x = Math.max(0, Math.min(1, h));
    let i = 0;
    while (i < BEACON_HEAT_X.length - 2 && x > BEACON_HEAT_X[i + 1]) i++;
    const t = (x - BEACON_HEAT_X[i]) / Math.max(1e-9, BEACON_HEAT_X[i + 1] - BEACON_HEAT_X[i]);
    const a = BEACON_HEAT_C[i];
    const b = BEACON_HEAT_C[i + 1];
    const c = (k: number): number => Math.round(Math.max(0, Math.min(1, a[k] + (b[k] - a[k]) * t)) * 255);
    return (c(0) << 16) | (c(1) << 8) | c(2);
}

function mix(c1: number, c2: number, t: number): number {
    const k = Math.max(0, Math.min(1, t));
    const ch = (s: number): number => Math.round(((c1 >> s) & 255) * (1 - k) + ((c2 >> s) & 255) * k);
    return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** The damage tier of a share of damaged components: 0 none, 1 light, 2 heavy, 3 near death. Pure. */
export function beaconDamageTier(share: number): 0 | 1 | 2 | 3 {
    if (!(share > 0.04)) return 0;
    if (share < 0.3) return 1;
    if (share < 0.62) return 2;
    return 3;
}

/** The share of a station's components that are damaged (0..1). */
export function damageShare(bo: BuiltObject): number {
    const n = bo.components?.count ?? 0;
    return n > 0 ? Math.max(0, Math.min(1, bo.damagedComponentCount / n)) : 0;
}

/** A cheap stable hash 0..1 of an integer (the sputter's and the sparks' randomness; no Random draws). Pure. */
export function hash01(n: number): number {
    const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
    return s - Math.floor(s);
}

/** The core's sputter multiplier near death at time sec: mostly lit, dropping out in fits. Pure. */
export function coreSputter(sec: number): number {
    const k = Math.floor(sec * 9);
    const h = hash01(k);
    if (h < 0.18) return 0.05;
    if (h < 0.34) return 0.3 + 0.3 * hash01(k + 7);
    return 1;
}

/** What one frame of the relay needs from the state (beaconLaunch.ts; set by the ship layer once per frame). */
export interface RelayFrame {
    /** The countdown 0..1. */
    countdown: number;
    /** Seconds since the call (null: none running), and the call's serial. */
    launchT: number | null;
    serial: number;
}

interface RelayTex {
    body: Texture;
    tip: Texture;
    ring: Texture[][]; // [gyro][0 top half, 1 bottom half]
    ticks: Texture[][];
    blur: Texture[];
    pits: Texture;
    glow: Texture;
    well: Texture;
    rims: Texture;
    orb: Texture;
    halo: Texture;
    beam: Record<keyof typeof BEACON_BEAM, Texture>;
}

function sub(base: Texture, r: BeaconFxRect, half = -1): Texture {
    if (half < 0) return new Texture({ source: base.source, frame: new Rectangle(r.x, r.y, r.w, r.h) });
    const h2 = Math.floor(r.h / 2);
    return new Texture({ source: base.source, frame: new Rectangle(r.x, r.y + (half === 0 ? 0 : h2), r.w, half === 0 ? h2 : r.h - h2) });
}

// Particle pools (frame px about the core; fixed capacity).
const ASH_N = 1200;
const STREAK_N = 96;
const RING_N = 8;
const SPARK_N = 72;
const SMOKE_N = 64;
const DEBRIS_N = 28;

class Particles {
    readonly x: Float32Array;
    readonly y: Float32Array;
    readonly vx: Float32Array;
    readonly vy: Float32Array;
    readonly age: Float32Array;
    readonly life: Float32Array;
    readonly s0: Float32Array;
    readonly s1: Float32Array;
    readonly rot: Float32Array;
    readonly k: Uint8Array;
    n = 0;
    constructor(readonly cap: number) {
        this.x = new Float32Array(cap);
        this.y = new Float32Array(cap);
        this.vx = new Float32Array(cap);
        this.vy = new Float32Array(cap);
        this.age = new Float32Array(cap);
        this.life = new Float32Array(cap);
        this.s0 = new Float32Array(cap);
        this.s1 = new Float32Array(cap);
        this.rot = new Float32Array(cap);
        this.k = new Uint8Array(cap);
    }
    spawn(x: number, y: number, vx: number, vy: number, life: number, s0: number, s1: number, rot: number, k: number): void {
        if (this.n >= this.cap) return;
        const i = this.n++;
        this.x[i] = x;
        this.y[i] = y;
        this.vx[i] = vx;
        this.vy[i] = vy;
        this.age[i] = 0;
        this.life[i] = life;
        this.s0[i] = s0;
        this.s1[i] = s1;
        this.rot[i] = rot;
        this.k[i] = k;
    }
    /** Ages and moves them (drag per second), dropping the dead (swap-remove). */
    step(dt: number, drag: number, spin = 0): void {
        const d = Math.exp(-drag * dt);
        for (let i = 0; i < this.n; ) {
            this.age[i] += dt;
            if (this.age[i] >= this.life[i]) {
                const j = --this.n;
                this.x[i] = this.x[j];
                this.y[i] = this.y[j];
                this.vx[i] = this.vx[j];
                this.vy[i] = this.vy[j];
                this.age[i] = this.age[j];
                this.life[i] = this.life[j];
                this.s0[i] = this.s0[j];
                this.s1[i] = this.s1[j];
                this.rot[i] = this.rot[j];
                this.k[i] = this.k[j];
                continue;
            }
            this.x[i] += this.vx[i] * dt;
            this.y[i] += this.vy[i] * dt;
            this.vx[i] *= d;
            this.vy[i] *= d;
            this.rot[i] += spin * dt;
            i++;
        }
    }
}

/** One Beacon's running state (its spin phase, the launch it is playing, its particles). */
class RelayRun {
    phase = BEACON_REST_PHASE;
    lastSec = -1;
    serial = 0;
    rnd = 1;
    ash = new Particles(ASH_N);
    streaks = new Particles(STREAK_N);
    rings = new Particles(RING_N);
    sparks = new Particles(SPARK_N);
    smoke = new Particles(SMOKE_N);
    debris = new Particles(DEBRIS_N);
    acc = new Float32Array(8);
    ringTimer = 0;
    /** A deterministic-enough stream for the emitters (render only; never galaxy.rnd). */
    r(): number {
        this.rnd = (this.rnd * 16807) % 2147483647;
        return (this.rnd - 1) / 2147483646;
    }
}

/** Where each drawn Beacon's core was last drawn (world coords), for the call's camera (ui/beaconLaunchCall.ts). */
const coreWorld = new WeakMap<BuiltObject, { x: number; y: number }>();

/** The world position of the Beacon's core as last drawn, or null (not drawn yet). */
export function beaconCoreWorld(bo: BuiltObject): { x: number; y: number } | null {
    return coreWorld.get(bo) ?? null;
}

const WHITE = 0xffffff;
const ORANGE = 0xff7a2a;
const SPARK = 0xffc070;

export class BeaconRelayFx {
    private tex: RelayTex | null = null;
    private loading = false;
    private runs = new Map<BuiltObject, RelayRun>();
    private ang: [number, number] = [0, 0];
    // the transform of the sprite being decorated
    private x = 0;
    private y = 0;
    private cos = 1;
    private sin = 0;
    private rot = 0;
    private sc = 1;
    private ox = 0;
    private oy = 0;

    constructor(private readonly pool: SpritePool) {}

    /** The textures (loaded once, on first use; null until all are). */
    private textures(): RelayTex | null {
        if (this.tex === null && !this.loading) {
            this.loading = true;
            void Promise.all(['beacon-body', 'beacon-parts', 'beacon-fx', 'beacon-beam'].map((f) => loadShipArt(`${BEACON_ART_DIR}${f}.png`, false))).then(
                ([body, parts, fx, beam]) => {
                    if (body === null || parts === null || fx === null || beam === null) return;
                    const R = BEACON_RELAY;
                    const p = parts.texture;
                    const f = fx.texture;
                    const bm = {} as Record<keyof typeof BEACON_BEAM, Texture>;
                    for (const k of Object.keys(BEACON_BEAM) as (keyof typeof BEACON_BEAM)[]) bm[k] = sub(beam.texture, BEACON_BEAM[k]);
                    this.tex = {
                        body: body.texture,
                        tip: sub(p, R.tip),
                        ring: R.gyros.map((g) => [sub(p, g.ring, 0), sub(p, g.ring, 1)]),
                        ticks: R.gyros.map((g) => [sub(p, g.ticks, 0), sub(p, g.ticks, 1)]),
                        blur: R.gyros.map((g) => sub(p, g.blur)),
                        pits: sub(p, R.pits),
                        glow: sub(f, R.glow),
                        well: sub(f, R.well),
                        rims: sub(f, R.rims),
                        orb: sub(f, R.orb),
                        halo: sub(f, R.halo),
                        beam: bm,
                    };
                },
                () => undefined,
            );
        }
        return this.tex;
    }

    /** Drop the runs of destroyed Beacons. */
    prune(): void {
        if (this.runs.size > 1) for (const bo of this.runs.keys()) if (bo.hasBeenDestroyed) this.runs.delete(bo);
    }

    /** Places `s` (anchor axf, ayf) at frame px (fx, fy), turned rot + extraRot, scaled sx, sy (× the sprite's scale). */
    private put(s: Sprite, fx: number, fy: number, axf = 0.5, ayf = 0.5, extraRot = 0, sx = 1, sy = sx): void {
        const lx = (fx - this.ox) * this.sc;
        const ly = (fy - this.oy) * this.sc;
        s.position.set(this.x + lx * this.cos - ly * this.sin, this.y + lx * this.sin + ly * this.cos);
        s.anchor.set(axf, ayf);
        s.rotation = this.rot + extraRot;
        s.scale.set(this.sc * sx, this.sc * sy);
    }

    private layer(t: Texture, r: BeaconFxRect, alpha: number, blend: 'add' | 'normal', tint = WHITE): void {
        if (alpha <= 0.005) return;
        const s = this.pool.acquire(t);
        s.blendMode = blend;
        this.put(s, r.dx, r.dy, 0, 0);
        s.alpha = Math.min(1, alpha);
        s.tint = tint;
    }

    private dot(t: Texture, fx: number, fy: number, scale: number, alpha: number, blend: 'add' | 'normal', tint = WHITE, rot = 0, sx = 1, sy = 1): void {
        if (alpha <= 0.004) return;
        const s = this.pool.acquire(t);
        s.blendMode = blend;
        this.put(s, fx, fy, 0.5, 0.5, rot, scale * sx, scale * sy);
        s.alpha = Math.min(1, alpha);
        s.tint = tint;
    }

    /**
     * Draws the relay over its sprite (its transform; tw × th the texture size; px its drawn size; sec the wall clock).
     * Returns the texture the ship layer should draw instead of the whole frame (the body), or null (too small, not
     * loaded: the whole frame stays).
     */
    draw(bo: BuiltObject, frame: RelayFrame, x: number, y: number, rotation: number, scale: number, ax: number, ay: number, tw: number, th: number, px: number, sec: number, breath: number): Texture | null {
        const tex = this.textures();
        let run = this.runs.get(bo);
        if (run === undefined) {
            run = new RelayRun();
            run.rnd = 1 + (bo.builtObjectID % 100000);
            this.runs.set(bo, run);
        }
        const dt = run.lastSec < 0 ? 0 : Math.max(0, Math.min(0.1, sec - run.lastSec));
        run.lastSec = sec;
        // the launch this run plays (a new serial starts it; particles from the last are dropped)
        if (frame.serial !== run.serial && frame.launchT !== null) {
            run.serial = frame.serial;
            run.ash.n = run.streaks.n = run.rings.n = 0;
            run.ringTimer = 0;
        }
        const t = frame.launchT !== null && frame.launchT <= LAUNCH.end ? frame.launchT : null;
        const tier = beaconDamageTier(damageShare(bo));
        const sput = tier >= 3 ? coreSputter(sec) : 1;
        const seasonSpin = beaconSpinRate(frame.countdown);
        let w = launchSpin(t, seasonSpin);
        // near death the gyros stutter: frozen while the core drops out, a jerk when it catches
        if (tier >= 3) w = sput < 0.5 ? 0 : w * (0.6 + 0.8 * hash01(Math.floor(sec * 3) + 11));
        run.phase += w * dt;
        const heat = launchHeat(t, Math.max(0, Math.min(1, frame.countdown)));
        if (tex === null) return null;
        this.x = x;
        this.y = y;
        this.rot = rotation;
        this.cos = Math.cos(rotation);
        this.sin = Math.sin(rotation);
        this.sc = scale;
        this.ox = ax * tw;
        this.oy = ay * th;
        const R = BEACON_RELAY;
        const [cx, cy] = R.core;
        let cw = coreWorld.get(bo);
        if (cw === undefined) {
            cw = { x: 0, y: 0 };
            coreWorld.set(bo, cw);
        }
        const lx = (cx - this.ox) * this.sc;
        const ly = (cy - this.oy) * this.sc;
        cw.x = this.x + lx * this.cos - ly * this.sin;
        cw.y = this.y + lx * this.sin + ly * this.cos;
        const detail = px >= RELAY_MIN_PX;
        if (detail) {
            this.drawStation(tex, run, tier, sput, heat, w, sec, breath, t);
            this.drawDamage(tex, run, tier, sec, dt);
        }
        if (t !== null) this.drawLaunch(tex, run, t, dt, heat, cx, cy);
        return detail ? tex.body : null;
    }

    private drawStation(tex: RelayTex, run: RelayRun, tier: number, sput: number, heat: number, w: number, sec: number, breath: number, t: number | null): void {
        const R = BEACON_RELAY;
        const [cx, cy] = R.core;
        // the lower prong's tip: in place, or snapped at its break and bent away
        if (tier >= 2) {
            const s = this.pool.acquire(tex.tip);
            s.blendMode = 'normal';
            const axf = (R.hinge[0] - R.tip.dx) / R.tip.w;
            const ayf = (R.hinge[1] - R.tip.dy) / R.tip.h;
            this.put(s, R.hinge[0] + R.tipSlide[0], R.hinge[1] + R.tipSlide[1], axf, ayf, R.tipBend);
        } else this.layer(tex.tip, R.tip, 1, 'normal');
        if (tier >= 2) {
            this.layer(tex.pits, R.pits, 1, 'normal');
            this.layer(tex.rims, R.rims, 0.35, 'add', 0xc8b8a8);
        }
        // the lines' swell (wine red); damaged, they flicker; in the charge they flare
        let swell = 0.12 + 0.88 * breath;
        if (tier >= 1) swell *= 0.35 + 0.65 * (hash01(Math.floor(sec * 11) + 3) > 0.25 ? 1 : 0.15);
        if (t !== null && t < LAUNCH.fade) swell = Math.max(swell, smoothstep(0, LAUNCH.charge, t));
        this.layer(tex.glow, R.glow, swell, 'add');
        // the core's light in the well, its halo
        const hc = heatColour(heat);
        const ci = (0.35 + 0.65 * heat) * sput;
        this.layer(tex.well, R.well, ci, 'add', hc);
        this.dot(tex.halo, cx, cy, (R.ringIn * 2.2) / R.halo.w, 0.75 * ci, 'add', hc);
        // the gyros: back halves, the core, front halves (a sharp ring, two ghosts as it spins, its ticks in the heat)
        const blur = gyroBlur(w);
        const tickCol = mix(0x9e1419, hc, smoothstep(0.25, 0.55, heat));
        const ghosts = w > 3 && blur < 0.98;
        for (let pass = 0; pass < 2; pass++) {
            if (pass === 1) {
                const orbCol = mix(hc, WHITE, 0.6 * smoothstep(0.6, 1, heat));
                this.dot(tex.orb, cx, cy, (R.coreR * 2.1) / R.orb.w, Math.min(1, 0.45 + ci), 'add', orbCol);
                this.dot(tex.orb, cx, cy, (R.coreR * 1.1) / R.orb.w, smoothstep(0.55, 1, heat) * sput, 'add');
                if (blur > 0.01) {
                    for (let k = 0; k < R.gyros.length; k++) {
                        const g = R.gyros[k];
                        this.dot(tex.blur[k], cx, cy, 1, blur * 0.85, 'normal', mix(0x9e9e9e, hc, 0.45 * heat));
                        this.dot(tex.blur[k], cx, cy, 1, blur * heat * 0.45, 'add', mix(hc, WHITE, 0.4));
                        void g;
                    }
                }
            }
            if (blur >= 0.999) continue;
            const sharp = 1 - 0.7 * blur;
            for (let k = 0; k < R.gyros.length; k++) {
                const n = ghosts ? 3 : 1;
                for (let j = 0; j < n; j++) {
                    const ph = run.phase + (n > 1 ? (j - 1) * w * (1 / 48) : 0);
                    gyroAngles(ph, k, this.ang);
                    const psi = this.ang[0];
                    const theta = this.ang[1];
                    const cs = Math.cos(theta);
                    const sy = Math.abs(cs) < 1e-3 ? 1e-3 : cs;
                    const frontIsBottom = Math.sin(theta) >= 0;
                    // pass 0: the back half; pass 1: the front half (bottom = local y > 0)
                    const bottom = pass === 1 ? frontIsBottom : !frontIsBottom;
                    const half = bottom ? 1 : 0;
                    const a = (n > 1 ? (j === 1 ? 0.6 : 0.25) : 1) * sharp;
                    const s = this.pool.acquire(tex.ring[k][half]);
                    s.blendMode = 'normal';
                    this.put(s, cx, cy, 0.5, bottom ? 0 : 1, psi, 1, sy);
                    s.alpha = a;
                    const tk = this.pool.acquire(tex.ticks[k][half]);
                    tk.blendMode = 'normal';
                    this.put(tk, cx, cy, 0.5, bottom ? 0 : 1, psi, 1, sy);
                    tk.alpha = a;
                    tk.tint = tickCol;
                }
            }
        }
    }

    private drawDamage(tex: RelayTex, run: RelayRun, tier: number, sec: number, dt: number): void {
        const R = BEACON_RELAY;
        const [cx, cy] = R.core;
        if (tier === 0) {
            run.sparks.n = run.smoke.n = run.debris.n = 0;
            return;
        }
        const B = tex.beam;
        // sparks: bursts along the seams and round the ring (more as it gets worse)
        run.acc[4] += dt * (tier === 1 ? 2.2 : 4.5);
        while (run.acc[4] >= 1) {
            run.acc[4] -= 1;
            let px: number, py: number;
            if (run.r() < 0.5) {
                const path = R.seams[run.r() < 0.5 ? 0 : 1];
                const i = Math.min(path.length - 2, Math.floor(run.r() * (path.length - 1)));
                const q = run.r();
                px = path[i][0] + (path[i + 1][0] - path[i][0]) * q;
                py = path[i][1] + (path[i + 1][1] - path[i][1]) * q;
            } else if (tier >= 2 && run.r() < 0.5) {
                const b = R.breaks[Math.floor(run.r() * R.breaks.length)];
                px = b[0];
                py = b[1];
            } else {
                const a = run.r() * Math.PI * 2;
                const rr = R.ringIn + (R.ringOut - R.ringIn) * run.r();
                px = cx + rr * Math.cos(a);
                py = cy + rr * Math.sin(a);
            }
            const m = 3 + Math.floor(run.r() * 4);
            for (let j = 0; j < m; j++) {
                const a = run.r() * Math.PI * 2;
                const sp = 40 + 80 * run.r();
                run.sparks.spawn(px - cx, py - cy, sp * Math.cos(a), sp * Math.sin(a), 0.25 + 0.3 * run.r(), 1.4, 0.6, a, 0);
            }
        }
        run.sparks.step(dt, 2.0);
        for (let i = 0; i < run.sparks.n; i++) {
            const q = run.sparks.age[i] / run.sparks.life[i];
            const rot = Math.atan2(run.sparks.vy[i], run.sparks.vx[i]);
            this.dot(B.spark, cx + run.sparks.x[i], cy + run.sparks.y[i], 1.2, (1 - q) * 0.95, 'add', SPARK, rot, 1.6, 1);
        }
        if (tier < 2) return;
        // the break's raw edge glows, molten
        for (const b of R.breaks) this.dot(tex.halo, b[0], b[1], 18 / R.halo.w, 0.55 + 0.25 * Math.sin(sec * 5 + b[1]), 'add', ORANGE);
        // smoke streaming from the vents, debris shedding from the break
        run.acc[5] += dt * 9;
        while (run.acc[5] >= 1) {
            run.acc[5] -= 1;
            const v = R.vents[Math.floor(run.r() * R.vents.length)];
            run.smoke.spawn(v[0] - cx, v[1] - cy, 34 + 14 * run.r(), 22 + 12 * run.r(), 2.6 + run.r(), 0.5, 2.6, run.r() * 6, Math.floor(run.r() * 3));
        }
        run.smoke.step(dt, 0.25, 0.3);
        const smokeKeys = [B.smoke0, B.smoke1, B.smoke2];
        for (let i = 0; i < run.smoke.n; i++) {
            const q = run.smoke.age[i] / run.smoke.life[i];
            const s = run.smoke.s0[i] + (run.smoke.s1[i] - run.smoke.s0[i]) * q;
            this.dot(smokeKeys[run.smoke.k[i]], cx + run.smoke.x[i], cy + run.smoke.y[i], s, 0.75 * Math.pow(1 - q, 1.1) * smoothstep(0, 0.08, q), 'normal', WHITE, run.smoke.rot[i]);
        }
        run.acc[6] += dt * 4;
        while (run.acc[6] >= 1) {
            run.acc[6] -= 1;
            const a = -0.3 + 2.1 * run.r();
            const sp = 30 + 60 * run.r();
            run.debris.spawn(R.hinge[0] - cx, R.hinge[1] - cy, sp * Math.cos(a), sp * Math.sin(a), 3 + 2 * run.r(), 0.12 + 0.2 * run.r(), 0.12 + 0.2 * run.r(), run.r() * 6, Math.floor(run.r() * 4));
        }
        run.debris.step(dt, 0.05, 2.5);
        const ashKeys = [B.ash0, B.ash1, B.ash2, B.ash3];
        for (let i = 0; i < run.debris.n; i++) {
            const q = run.debris.age[i] / run.debris.life[i];
            this.dot(ashKeys[run.debris.k[i]], cx + run.debris.x[i], cy + run.debris.y[i], run.debris.s0[i], 0.9 * (1 - q), 'normal', 0x6a6a70, run.debris.rot[i], 1, 1.6);
        }
    }

    private drawLaunch(tex: RelayTex, run: RelayRun, t: number, dt: number, heat: number, cx: number, cy: number): void {
        const R = BEACON_RELAY;
        const B = tex.beam;
        const Rb = R.beamR;
        // the charge: pulses race down both prongs' seams, lighting the seam behind them
        if (t < LAUNCH.charge + 0.3) {
            const col = mix(heatColour(heat), WHITE, 0.5);
            for (let wave = 0; wave < LAUNCH.pulses; wave++) {
                const q = pulseProgress(t, wave);
                if (q < 0) continue;
                for (const path of R.seams) this.pulse(B.pulse, path, q, col);
            }
        }
        // the collapse on the core before the ignition
        if (t > LAUNCH.charge - 0.5 && t < LAUNCH.ignite + 0.2) {
            const c = smoothstep(LAUNCH.charge - 0.5, LAUNCH.ignite, t);
            this.dot(B.bloom, cx, cy, ((0.4 + 0.6 * c) * Rb * 1.4) / (BEACON_BEAM.bloom.w / 2), 0.6 + 0.4 * c, 'add');
            this.dot(B.ring, cx, cy, ((1 - c) * 2.4 + 0.15) * Rb * 1.1 / (BEACON_BEAM.ring.w / 2), 0.9 * c, 'add');
        }
        const e = beamEnvelope(t);
        // the embers: thrown out from the beam's base, turning with the vortex (a streak's path curls with the swirl)
        const look = EMBERS;
        const rate = look.rate * e + (t > LAUNCH.hold && t < LAUNCH.fade + 1 ? look.rate * 0.28 * (1 - e) : 0);
        run.acc[0] += rate * dt;
        while (run.acc[0] >= 1) {
            run.acc[0] -= 1;
            const a = run.r() * Math.PI * 2;
            const r0 = (0.5 + 0.3 * run.r()) * Rb;
            const sp = (0.6 + 1.4 * Math.pow(run.r(), 1.5)) * Rb;
            const len = look.len[0] + (look.len[1] - look.len[0]) * Math.pow(run.r(), look.lenPow);
            // k: bit 0 the tighter arc, bit 1 a bright ember (variant c)
            const k = (run.r() < look.tight ? 1 : 0) | (run.r() < look.bright ? 2 : 0);
            run.ash.spawn(r0 * Math.cos(a), r0 * Math.sin(a), sp, 0, look.life[0] + (look.life[1] - look.life[0]) * run.r(), len, 0, 0, k);
        }
        run.acc[2] += 35 * e * dt;
        while (run.acc[2] >= 1) {
            run.acc[2] -= 1;
            // a streak: x = its angle, y = its radius, vx = its speed (they spiral out)
            run.streaks.spawn(run.r() * Math.PI * 2, 0.35 * Rb, (1.4 + run.r()) * Rb, 0, 0.35 + 0.25 * run.r(), 0.7 + 0.6 * run.r(), 0, 0, 0);
        }
        if (e > 0.3) {
            run.ringTimer -= dt;
            if (run.ringTimer <= 0) {
                run.ringTimer = 0.5;
                run.rings.spawn(0, 0, 0, 0, 1.3, 0, 0, 0, 0);
            }
        }
        // the flow: each streak keeps its speed (vx; dragged) and heads along the vortex's spiral at its place
        // (vy: its heading, for the draw), so every streak runs with the swirl, none across it
        const spiral = EMBERS.spiral;
        const drag = Math.exp(-0.3 * dt);
        for (let i = 0; i < run.ash.n; ) {
            run.ash.age[i] += dt;
            if (run.ash.age[i] >= run.ash.life[i]) {
                const j = --run.ash.n;
                run.ash.x[i] = run.ash.x[j];
                run.ash.y[i] = run.ash.y[j];
                run.ash.vx[i] = run.ash.vx[j];
                run.ash.vy[i] = run.ash.vy[j];
                run.ash.age[i] = run.ash.age[j];
                run.ash.life[i] = run.ash.life[j];
                run.ash.s0[i] = run.ash.s0[j];
                run.ash.k[i] = run.ash.k[j];
                continue;
            }
            const h = Math.atan2(run.ash.y[i], run.ash.x[i]) + spiral;
            run.ash.vy[i] = h;
            run.ash.x[i] += run.ash.vx[i] * Math.cos(h) * dt;
            run.ash.y[i] += run.ash.vx[i] * Math.sin(h) * dt;
            run.ash.vx[i] *= drag;
            i++;
        }
        run.rings.step(dt, 0);
        // streaks move by hand (polar)
        for (let i = 0; i < run.streaks.n; ) {
            run.streaks.age[i] += dt;
            if (run.streaks.age[i] >= run.streaks.life[i]) {
                const j = --run.streaks.n;
                run.streaks.x[i] = run.streaks.x[j];
                run.streaks.y[i] = run.streaks.y[j];
                run.streaks.vx[i] = run.streaks.vx[j];
                run.streaks.age[i] = run.streaks.age[j];
                run.streaks.life[i] = run.streaks.life[j];
                run.streaks.s0[i] = run.streaks.s0[j];
                continue;
            }
            run.streaks.y[i] += run.streaks.vx[i] * dt;
            run.streaks.x[i] += 2.2 * dt;
            i++;
        }
        if (e > 0.001) {
            const flash = beamFlash(t);
            const pulse = 1 + 0.06 * Math.sin(t * 11) + 0.03 * Math.sin(t * 23);
            const rd = 0.62 * Rb * Math.pow(e, 0.6) * pulse;
            const bw = BEACON_BEAM.bloom.w / 2;
            this.dot(B.bloom, cx, cy, (Rb * (8 + 4 * flash)) / bw, beamFlashAlpha(t), 'add');
            this.dot(B.bloom, cx, cy, (Rb * 4.2) / bw, 0.6 * e, 'add');
            this.dot(B.bloomGreen, cx, cy, (rd * 2.9 * pulse) / (BEACON_BEAM.bloomGreen.w / 2), 0.38 * e, 'add');
            this.dot(B.bloom, cx, cy, (Rb * 2.0) / bw, 0.8 * e, 'add');
            for (let i = 0; i < run.rings.n; i++) {
                const q = run.rings.age[i] / run.rings.life[i];
                this.dot(B.ring, cx, cy, (rd + q * 2.6 * Rb) / (BEACON_BEAM.ring.w * 0.45), e * 0.8 * Math.pow(1 - q, 1.5), 'add');
            }
            const dw = BEACON_BEAM.disc.w / 2;
            this.dot(B.disc, cx, cy, (rd * 1.15) / dw, e, 'add', WHITE, t * 0.8);
            this.dot(B.swirl, cx, cy, (rd * 2.3) / (BEACON_BEAM.swirl.w / 2), e, 'add', WHITE, t * 3);
            this.dot(B.swirl, cx, cy, (rd * 2.0) / (BEACON_BEAM.swirl.w / 2), e, 'add', WHITE, t * 3 + 0.4);
            this.dot(B.swirl2, cx, cy, (rd * 1.7) / (BEACON_BEAM.swirl2.w / 2), 0.8 * e, 'add', WHITE, -t * 1.9);
            this.dot(B.bloom, cx, cy, (rd * 1.5) / bw, e, 'add');
            for (let i = 0; i < run.streaks.n; i++) {
                const q = run.streaks.age[i] / run.streaks.life[i];
                const a = run.streaks.x[i];
                const r = run.streaks.y[i];
                this.dot(B.streak, cx + r * Math.cos(a), cy + r * Math.sin(a), Rb * 0.0026 * (1 + 1.5 * q), 0.7 * e * (1 - q), 'add', WHITE, a + 0.5, 1.6 * 4, run.streaks.s0[i] * 4);
            }
        }
        // the embers: tapered arcs along their spiral paths, mostly bright (white-hot cooling to orange), a few deep
        // wine-grey at low opacity, each with a faint hot core
        const arcs = [B.arc0, B.arc1];
        const cores = [B.arc0Core, B.arc1Core];
        const aw = BEACON_BEAM.arc0.w;
        for (let i = 0; i < run.ash.n; i++) {
            const q = run.ash.age[i] / run.ash.life[i];
            const k = run.ash.k[i];
            const tight = k & 1;
            const bright = (k & 2) !== 0;
            const fade = Math.pow(1 - q, 0.9) * smoothstep(0, 0.08, q);
            const rot = run.ash.vy[i];
            const len = run.ash.s0[i] * (0.8 + 0.4 * q);
            const px = cx + run.ash.x[i];
            const py = cy + run.ash.y[i];
            if (bright) {
                const col = mix(0xffffff, 0xff8a3a, smoothstep(0, 0.7, q));
                this.dot(arcs[tight], px, py, look.thick, 0.75 * fade, 'add', col, rot, len / aw, 1);
                this.dot(cores[tight], px, py, look.thick, look.coreAlpha * fade, 'add', 0xffffff, rot, len / aw, 1);
            } else {
                this.dot(arcs[tight], px, py, look.thick, look.darkAlpha * fade, 'normal', look.dark, rot, len / aw, 1);
                this.dot(cores[tight], px, py, look.thick, look.coreAlpha * fade * 0.6, 'add', 0xffd9b0, rot, len / aw, 1);
            }
        }
    }

    /** One charge pulse at progress q down a seam path: its head, a short bright trail, the lit seam behind it. */
    private pulse(t: Texture, path: readonly (readonly [number, number])[], q: number, col: number): void {
        let total = 0;
        for (let i = 0; i < path.length - 1; i++) total += Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
        const head = q * total;
        const scale = 1 / (t.width / 2);
        // walk the path from its start (the prong's tip) to the head: the seam behind lit, brighter toward the head
        let d0 = 0;
        for (let i = 0; i < path.length - 1; i++) {
            const ax = path[i][0], ay = path[i][1];
            const bx = path[i + 1][0], by = path[i + 1][1];
            const L = Math.hypot(bx - ax, by - ay);
            for (let d = Math.ceil(d0 / 9) * 9; d < Math.min(head, d0 + L); d += 9) {
                const u = (d - d0) / L;
                const behind = (head - d) / Math.max(1, total);
                const a = behind < 0.05 ? 0.9 * (1 - behind / 0.05) + 0.25 : 0.25 * Math.exp(-behind * 3.5);
                this.dot(t, ax + (bx - ax) * u, ay + (by - ay) * u, (behind < 0.05 ? 13 : 7) * scale, a, 'add', col);
            }
            d0 += L;
        }
        // the head
        let d = head;
        for (let i = 0; i < path.length - 1; i++) {
            const L = Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
            if (d <= L || i === path.length - 2) {
                const u = Math.min(1, d / L);
                const hx = path[i][0] + (path[i + 1][0] - path[i][0]) * u;
                const hy = path[i][1] + (path[i + 1][1] - path[i][1]) * u;
                this.dot(t, hx, hy, 26 * scale, 1, 'add', col);
                this.dot(t, hx, hy, 9 * scale, 1, 'add');
                break;
            }
            d -= L;
        }
    }
}
