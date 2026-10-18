// The Beacon's living art (Giantworks add-on; render only — threatArt.ts says who is who, beaconArtData.ts is the
// table scripts/beacon-ships.py writes with the frames in public/art/beacon/, built from the Mass Effect 4 Mod's
// Reaper set).
//
// Every Reclaimer hull, Watcher and the finished Beacon carries cyan light lines. They breathe: a slow, ominous swell
// of the light (beaconBreath), each hull on its own phase and the bigger ones slower — the frame bakes the lines at
// rest, the swell is an additive layer (its <file>-fx.png: the lines brighter and a soft halo). No eyes. All pooled
// additive sprites over the ship layer; nothing allocated per frame; skipped under BEACON_FX_MIN_PX drawn size.
//
// A Watcher is drawn closed (watcher.png: the reference itself). While it is sighted (threatArt.ts watcherOpenTarget)
// it slowly opens: the ship layer swaps its sprite to the body alone (watcher-body.png, the same canvas, a ribbed
// cavity lit from inside under its flank plates) and the moving parts (watcher-parts.png: the horns, the six legs, the
// flank plates) are drawn here, each lifting a little off the hull (a shadow under it) and swinging about its hinge,
// one after another; the light in the cavity and the leg sockets rises; they fold back when it is no longer sighted.
// As it opens its light lines heat from the reference's cyan to red-orange (watcher-hot.png, normal-blended over them
// on the body and on each moving part; its swell turns red-orange too), and cool back as it closes; closed it is the
// reference. A Watcher that starts opening while drawn leaves a cue for its horn (takeWatcherHornCues; the sound is
// src/audio/beaconHorn.ts).
//
// The Beacon station itself (the relay) is beaconRelayFx.ts's: its core and gyros, its damage, the launch's beam.

import { Container, Rectangle, Texture, type Sprite } from 'pixi.js';
import type { BuiltObject } from '../sim/builtObject';
import { SpritePool } from './fxCommon';
import { loadShipArt } from './shipArt';
import { BEACON_FRAMES, BEACON_RELAY, WATCHER_ART, type BeaconFrameArt, type BeaconFxRect } from './beaconArtData';
import { WATCHER_FORK_ART } from './beaconForkArtData';
import { CAPITAL_FORK_ART } from './beaconForkCapitalArtData';
import { FRIGATE_FORK_ART } from './beaconForkFrigateArtData';
import { BEACON_ART_DIR } from './threatArt';
import { BeaconRelayFx, type RelayFrame } from './beaconRelayFx';
import { BeaconWarpLayer } from './beaconWarp';
import { ReaperFx } from './beaconReaperFx';
import { ReaperMotionFx } from './beaconReaperMotion';
import { ForkFx } from './beaconForkFx';

/** No light layers under this drawn size (px). */
export const BEACON_FX_MIN_PX = 14;
/** Seconds for a Watcher to open fully / to close. */
export const WATCHER_OPEN_S = 10;
export const WATCHER_CLOSE_S = 7;

/** The breath 0..1 at time `sec` (s): a slow swell and ebb every `period` s, lingering low (a long lull, a shorter
 * rise). Pure. */
export function beaconBreath(sec: number, period: number, phase = 0): number {
    const ph = ((((sec + phase) / period) % 1) + 1) % 1;
    const s = 0.5 - 0.5 * Math.cos(ph * Math.PI * 2);
    return Math.pow(s, 1.4);
}

/** A hull's own breathing phase (s, 0..period) from its id, so a fleet does not breathe in step. Pure. */
export function beaconPhase(builtObjectID: number, period: number): number {
    return ((((builtObjectID * 0.6180339887) % 1) + 1) % 1) * period;
}

function smoothstep(a: number, b: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
}

/** A part's own progress 0..1 at the Watcher's unfold u (0 closed .. 1 open), starting at `delay`. */
function partProgress(u: number, delay: number): number {
    return Math.max(0, Math.min(1, (u - delay) / Math.max(1e-3, 1 - delay)));
}

/** How far a part has swung (0..1 of its full swing) at unfold u: it lifts first, then swings, easing in and out. Pure. */
export function watcherPartSwing(u: number, delay: number): number {
    return smoothstep(0.1, 1, partProgress(u, delay));
}

/** How far a part has lifted off the hull (0..1) at unfold u: in the first fifth of its motion. Pure. */
export function watcherPartLift(u: number, delay: number): number {
    return smoothstep(0, 0.2, partProgress(u, delay));
}

/** The next unfold value: toward 1 over WATCHER_OPEN_S while `open`, toward 0 over WATCHER_CLOSE_S otherwise. Pure. */
export function watcherUnfoldStep(u: number, open: boolean, dt: number): number {
    return open ? Math.min(1, u + dt / WATCHER_OPEN_S) : Math.max(0, u - dt / WATCHER_CLOSE_S);
}

/** The light layers of a frame (sub-textures of its <file>-fx.png). */
interface FxSet {
    glow: Texture;
    /** The Watcher's: the light in its cavity and leg sockets, and its swell in red-orange. */
    sockets?: Texture;
    warm?: Texture;
}

/** The Watcher's body, its moving parts (sub-textures of watcher-parts.png) and their red-orange lines (watcher-hot.png). */
interface WatcherTextures {
    body: Texture;
    parts: Texture[];
    hot: Texture;
    hotParts: (Texture | null)[];
}

/** The heat of a Watcher's lines 0..1 at unfold u (0 closed .. 1 open): red-orange as it opens (scripts/beacon-ships.py
 * watcher_heat). Pure. */
export function watcherHeat(u: number): number {
    return smoothstep(0.04, 0.55, u);
}

/** Watchers that started opening while drawn, for the horn (taken once per frame by the audio side). */
const hornCues: BuiltObject[] = [];
const HORN_CUES_MAX = 8;

/** Moves the pending horn cues (Watchers that started opening since the last call) into `out`. */
export function takeWatcherHornCues(out: BuiltObject[]): void {
    for (const bo of hornCues) out.push(bo);
    hornCues.length = 0;
}

/** A Watcher started opening (its unfold left 0 toward open); `prev`, `next`: its unfold before and after. Pure. */
export function watcherStartedOpening(prev: number, next: number, open: boolean): boolean {
    return open && prev <= 0.001 && next > 0.001;
}

function sub(base: Texture, r: BeaconFxRect): Texture {
    return new Texture({ source: base.source, frame: new Rectangle(r.x, r.y, r.w, r.h) });
}

/** The frame data of a Beacon file (a Reclaimer frame, 'beacon' (the relay), 'watcher' or 'watcher-fork'), or null. */
export function beaconFrameArt(file: string): BeaconFrameArt | null {
    if (file === 'watcher') return WATCHER_ART;
    if (file === 'watcher-fork') return WATCHER_FORK_ART;
    if (file === 'capitalship-fork') return CAPITAL_FORK_ART;
    if (file === 'frigate-fork') return FRIGATE_FORK_ART;
    if (file === 'beacon') return BEACON_RELAY_FRAME;
    return Object.hasOwn(BEACON_FRAMES, file) ? BEACON_FRAMES[file] : null;
}

/** The relay as a frame (its size, its lines' breath; its swell is drawn by beaconRelayFx.ts). */
const BEACON_RELAY_FRAME: BeaconFrameArt = { size: BEACON_RELAY.size, breath: BEACON_RELAY.breath, glow: BEACON_RELAY.glow };

interface Unfold {
    u: number;
    t: number;
}

export class BeaconFxLayer {
    readonly root = new Container();
    private pool = new SpritePool(this.root);
    /** The Beacon's own warp (beaconWarp.ts), drawn on each ship's sprite transform. */
    private warp = new BeaconWarpLayer((file) => `${BEACON_ART_DIR}${file}.png`);
    /** The alternative (Reaper) Watcher's chain and eye-line runs (beaconReaperFx.ts). */
    private reaper = new ReaperFx(this.root);
    /** Its moving-effect previews (beaconReaperMotion.ts, off by default). */
    private motion = new ReaperMotionFx(this.root);
    /** The fork Watcher's engine plumes and blinking navigation lights (beaconForkFx.ts). */
    private fork = new ForkFx(this.root);
    private fx = new Map<string, FxSet | null>();
    private fxLoading = new Set<string>();
    private watcherTex: WatcherTextures | null = null;
    private watcherLoading = false;
    private unfold = new Map<BuiltObject, Unfold>();
    private relay = new BeaconRelayFx(this.pool);
    private relayFrame: RelayFrame = { countdown: 0, launchT: null, serial: 0 };
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
        this.root.addChild(this.warp.root);
    }

    /** `relay`: this frame's countdown and launch (beaconLaunch.ts), for the Beacon station. */
    begin(relay?: RelayFrame): void {
        this.pool.begin();
        if (relay !== undefined) {
            this.relayFrame.countdown = relay.countdown;
            this.relayFrame.launchT = relay.launchT;
            this.relayFrame.serial = relay.serial;
        }
        this.warp.begin();
        this.reaper.begin();
        this.motion.begin();
        this.fork.begin();
    }

    end(): void {
        this.pool.end();
        this.relay.prune();
        this.warp.end();
        this.reaper.end();
        this.motion.end();
        this.fork.end();
        if (this.unfold.size > 4) for (const bo of this.unfold.keys()) if (bo.hasBeenDestroyed) this.unfold.delete(bo);
    }

    /** The light layers of `file` (loaded once, on first use; null until then or if it failed). */
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
                    const set: FxSet = { glow: sub(a.texture, art.glow) };
                    if (file === 'watcher') {
                        set.sockets = sub(a.texture, WATCHER_ART.sockets);
                        set.warm = sub(a.texture, WATCHER_ART.warm);
                    }
                    this.fx.set(file, set);
                },
                () => this.fx.set(file, null),
            );
        }
        return null;
    }

    /** The Watcher's body and parts (loaded once, on first use; null until both are loaded). */
    private watcherTextures(): WatcherTextures | null {
        if (this.watcherTex === null && !this.watcherLoading) {
            this.watcherLoading = true;
            void Promise.all([
                loadShipArt(`${BEACON_ART_DIR}watcher-body.png`, false),
                loadShipArt(`${BEACON_ART_DIR}watcher-parts.png`, false),
                loadShipArt(`${BEACON_ART_DIR}watcher-hot.png`, false),
            ]).then(
                ([body, parts, hot]) => {
                    if (body === null || parts === null || hot === null) return;
                    this.watcherTex = {
                        body: body.texture,
                        parts: WATCHER_ART.parts.map((p) => sub(parts.texture, p.rect)),
                        hot: sub(hot.texture, WATCHER_ART.hot),
                        hotParts: WATCHER_ART.parts.map((p) => (p.hot === null ? null : sub(hot.texture, p.hot))),
                    };
                },
                () => undefined,
            );
        }
        return this.watcherTex;
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

    /** A normal-blended layer at its place on the frame (the heat over the lines). */
    private overlay(t: Texture, r: BeaconFxRect, alpha: number): void {
        const s = this.pool.acquire(t);
        s.blendMode = 'normal';
        this.put(s, r.dx, r.dy);
        s.alpha = Math.min(1, alpha);
    }

    private additive(t: Texture, r: BeaconFxRect, alpha: number): void {
        if (alpha <= 0.01) return;
        const s = this.pool.acquire(t);
        s.blendMode = 'add';
        this.put(s, r.dx, r.dy);
        s.alpha = Math.min(1, alpha);
    }

    /**
     * The overlays of a Beacon sprite drawing frame `file` (its transform; `tw` × `th` its texture size; `px` its drawn
     * size; `sec` the shared wall clock). `open`: a Watcher's unfold target. Returns the texture the ship layer should
     * draw instead of the frame (a Watcher's body while it opens), or null.
     */
    draw(file: string, bo: BuiltObject, open: boolean, x: number, y: number, rotation: number, scale: number, ax: number, ay: number, tw: number, th: number, px: number, sec: number): Texture | null {
        // the warp (every Beacon frame), on the ship's sprite transform
        this.warp.ship(file, bo, x, y, rotation, scale, ax * tw, ay * th, px);
        if (file === 'watcher-reaper') {
            // its chain (lagging, swinging with its moves and turns) and its eye-lines' runs (light along them). It has no opening
            // yet: when it gets one, its unfold's heat goes in as `heat` (the runs then quicker and redder).
            this.reaper.draw(bo, x, y, rotation, scale, ax * tw, ay * th, px, sec, 0);
            const cruise = Math.max(1, bo.cruiseSpeed > 0 ? bo.cruiseSpeed : bo.topSpeed);
            this.motion.draw(bo, x, y, rotation, scale, ax * tw, ay * th, px, sec, bo.currentSpeed / cruise);
            return null;
        }
        const forkArt = file === 'watcher-fork' ? WATCHER_FORK_ART : file === 'capitalship-fork' ? CAPITAL_FORK_ART : file === 'frigate-fork' ? FRIGATE_FORK_ART : null;
        if (forkArt !== null) {
            // its engines' plumes (by its speed) and its blinking navigation lights; its lamps' swell below
            const cruise = Math.max(1, bo.cruiseSpeed > 0 ? bo.cruiseSpeed : bo.topSpeed);
            this.fork.draw(forkArt, bo, x, y, rotation, scale, ax * tw, ay * th, px, sec, bo.currentSpeed / cruise);
        }
        const art = beaconFrameArt(file);
        if (art === null) return null;
        if (file === 'beacon') {
            const breath = beaconBreath(sec, art.breath, beaconPhase(bo.builtObjectID, art.breath));
            return this.relay.draw(bo, this.relayFrame, x, y, rotation, scale, ax, ay, tw, th, px, sec, breath);
        }
        let u = 0;
        if (file === 'watcher') {
            let st = this.unfold.get(bo);
            if (st === undefined) {
                st = { u: 0, t: sec };
                this.unfold.set(bo, st);
            }
            const prev = st.u;
            st.u = watcherUnfoldStep(st.u, open, Math.max(0, Math.min(0.25, sec - st.t)));
            st.t = sec;
            u = st.u;
            if (watcherStartedOpening(prev, u, open) && hornCues.length < HORN_CUES_MAX) hornCues.push(bo);
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
        const breath = beaconBreath(sec, art.breath, beaconPhase(bo.builtObjectID, art.breath));
        const fx = this.fxSet(file);
        if (file === 'watcher') return this.drawWatcher(fx, u, sec, breath);
        if (fx !== null) this.additive(fx.glow, art.glow, 0.12 + 0.88 * breath);
        return null;
    }

    private drawWatcher(fx: FxSet | null, u: number, sec: number, breath: number): Texture | null {
        const W = WATCHER_ART;
        const tex = u > 0.001 ? this.watcherTextures() : null;
        // Open, the light inside rises a little and heats from cyan to red-orange.
        const rise = smoothstep(0, 0.6, u);
        const heat = tex === null ? 0 : watcherHeat(u);
        const swell = (0.12 + 0.88 * breath) * (1 + 0.15 * rise);
        if (fx !== null) this.additive(fx.glow, W.glow, swell * (1 - heat));
        if (tex === null) return null;
        if (heat > 0.01) this.overlay(tex.hot, W.hot, heat);
        if (fx?.warm !== undefined) this.additive(fx.warm, W.warm, swell * heat);
        if (fx?.sockets !== undefined) this.additive(fx.sockets, W.sockets, rise * (0.4 + 0.4 * breath));
        for (let k = 0; k < W.parts.length; k++) {
            const p = W.parts[k];
            const lift = watcherPartLift(u, p.delay);
            const swing = watcherPartSwing(u, p.delay);
            // Open, the parts sway a little on their hinges.
            const a = p.swing * swing + 0.015 * swing * Math.sin(sec * 0.6 + k * 1.7);
            const grow = 1 + 0.02 * lift;
            const axf = (p.hinge[0] - p.rect.dx) / p.rect.w;
            const ayf = (p.hinge[1] - p.rect.dy) / p.rect.h;
            if (lift > 0.01) {
                const sh = this.pool.acquire(tex.parts[k]);
                sh.blendMode = 'normal';
                this.put(sh, p.hinge[0] + 3 * lift, p.hinge[1] + 4 * lift, axf, ayf, a, grow);
                sh.tint = 0x000000;
                sh.alpha = 0.45 * lift;
            }
            const s = this.pool.acquire(tex.parts[k]);
            s.blendMode = 'normal';
            this.put(s, p.hinge[0], p.hinge[1], axf, ayf, a, grow);
            const hp = tex.hotParts[k];
            if (hp !== null && heat > 0.01) {
                // the part's red-orange lines: the part's own box, so the same anchor and turn
                const h = this.pool.acquire(hp);
                h.blendMode = 'normal';
                this.put(h, p.hinge[0], p.hinge[1], axf, ayf, a, grow);
                h.alpha = heat;
            }
        }
        return tex.body;
    }
}
