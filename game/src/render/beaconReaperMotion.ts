// The Reaper Watcher's moving haze (Giantworks add-on, the Beacon; render only), behind REAPER_HAZE (off until the user
// approves it). While the ship moves, a very faint, short violet haze trails it: one soft sprite
// (watcher-reaper-haze.png: the silhouette's glow smeared aft ~0.4 ship lengths, fading, mostly off the hull itself),
// additive, its strength by the ship's speed (gone at rest), turned toward the ship's recent direction of travel so it
// follows its path through a turn (no echoes). Only over HAZE_MIN_PX drawn size, for at most HAZE_SHIPS_MAX Watchers a
// frame. Its frame is the alternative Watcher (watcher-reaper.png, from a user-made kitbash of an image of a Mass
// Effect Reaper, EA / BioWare's design, at the user's request). Pooled; nothing allocated per frame once a ship is seen.

import { Container, Texture } from 'pixi.js';
import type { BuiltObject } from '../sim/builtObject';
import { SpritePool } from './fxCommon';
import { loadShipArt } from './shipArt';
import { BEACON_ART_DIR } from './threatArt';

/** The haze on / off and its strength (render only; mutable so a preview can switch it). */
export const REAPER_HAZE = { on: false, alpha: 0.16 };
export const HAZE_MIN_PX = 40;
export const HAZE_SHIPS_MAX = 4;
/** The window (s) over which the direction of travel is taken. */
const DIR_S = 0.35;

interface Track {
    x: number;
    y: number;
    t: number;
    /** The smoothed direction of travel (unit, world) and speed fraction. */
    dx: number;
    dy: number;
    k: number;
    seen: number;
}

export class ReaperMotionFx {
    private c = new Container();
    private pool = new SpritePool(this.c);
    private tex: Texture | null = null;
    private loading = false;
    private tracks = new Map<BuiltObject, Track>();
    private ships = 0;
    private clock = 0;

    constructor(parent: Container) {
        parent.addChild(this.c);
    }

    private texture(): Texture | null {
        if (this.tex === null && !this.loading) {
            this.loading = true;
            void loadShipArt(`${BEACON_ART_DIR}watcher-reaper-haze.png`, false).then(
                (a) => {
                    if (a !== null) this.tex = a.texture;
                },
                () => undefined,
            );
        }
        return this.tex;
    }

    begin(): void {
        this.pool.begin();
        this.ships = 0;
    }

    end(): void {
        this.pool.end();
        if (this.tracks.size > 0) for (const [bo, t] of this.tracks) if (bo.hasBeenDestroyed || this.clock - t.seen > 3) this.tracks.delete(bo);
    }

    /**
     * The Reaper Watcher drawn at (x, y), turned `rotation`, `scale` world units per frame px, its anchor (ox, oy) frame
     * px; `px` its drawn size; `sec` the wall clock; `speed` its speed over its cruise speed (0..).
     */
    draw(bo: BuiltObject, x: number, y: number, rotation: number, scale: number, ox: number, oy: number, px: number, sec: number, speed: number): void {
        this.clock = sec;
        if (!REAPER_HAZE.on || px < HAZE_MIN_PX || this.ships >= HAZE_SHIPS_MAX) return;
        const tex = this.texture();
        if (tex === null) return;
        this.ships++;
        // the frame's aft (+y) in the world: the ship's own heading
        const ax = -Math.sin(rotation);
        const ay = Math.cos(rotation);
        let t = this.tracks.get(bo);
        if (t === undefined) {
            t = { x, y, t: sec, dx: ax, dy: ay, k: 0, seen: sec };
            this.tracks.set(bo, t);
        }
        t.seen = sec;
        const dt = Math.max(0, Math.min(0.1, sec - t.t));
        t.t = sec;
        const mx = t.x - x;
        const my = t.y - y;
        const md = Math.hypot(mx, my);
        t.x = x;
        t.y = y;
        // the direction the haze trails: away from the motion (smoothed), the ship's own aft when barely moving
        const w = Math.min(1, dt / DIR_S);
        if (md > 1e-3) {
            t.dx += (mx / md - t.dx) * w;
            t.dy += (my / md - t.dy) * w;
        } else {
            t.dx += (ax - t.dx) * w;
            t.dy += (ay - t.dy) * w;
        }
        const n = Math.hypot(t.dx, t.dy) || 1;
        t.dx /= n;
        t.dy /= n;
        t.k += (Math.max(0, Math.min(1, speed)) - t.k) * Math.min(1, dt * 2.5);
        if (t.k < 0.03) return;
        // turn the haze so its aft points along the trail, about the ship's anchor
        const rot = Math.atan2(-t.dx, t.dy);
        const sp = this.pool.acquire(tex);
        sp.blendMode = 'add';
        sp.anchor.set(ox / tex.width, oy / tex.height);
        sp.position.set(x, y);
        sp.rotation = rot;
        sp.scale.set(scale);
        sp.alpha = REAPER_HAZE.alpha * t.k * t.k;
    }
}
