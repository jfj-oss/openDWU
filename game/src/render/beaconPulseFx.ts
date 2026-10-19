// The Watcher pulse (Giantworks add-on, the Beacon; render only): when a Watcher decloaks (beaconCloakFx.ts
// decloaksSince), on the decloak sound's opening hit (DECLOAK_HIT_S after it began):
// - a RING: a faint dark-violet band expands from the Watcher across the map, dimming the stars as it passes (drawn in
//   the world just above the backdrop and the deep starfield, under the ships), its reach and darkness by the pulse's
//   strength (pulseLevel: the distance from the camera and the player's worlds);
// - a SCREEN-EDGE DARK: a brief dark pulse at the screen's edges, even with the camera elsewhere, when the Watcher is
//   within a few sectors of the player's worlds; its strength the same.
// Both are off with the "Watcher pulse effects" option (Advanced Display settings). Pooled: at most PULSES_MAX at once,
// one vignette sprite; the two textures made once.

import { Container, Sprite, Texture } from 'pixi.js';
import type { Galaxy } from '../sim/galaxy';
import type { Habitat } from '../sim/types';
import { SpritePool } from './fxCommon';
import { textureFromRgbaPixels } from './textureCanvas';
import { DECLOAK_HIT_S, decloaksSince, pulseLevel, type DecloakEvent } from './beaconCloakFx';
import { getSettings } from '../ui/settings';
import { localViewerEmpire } from '../localViewer';

/** The ring's run (s), its reach at full strength (sectors) and its darkness. */
export const PULSE_RING_S = 4.2;
export const PULSE_RING_SECTORS = 1.5;
const RING_ALPHA = 0.85;
/** The screen-edge dark: attack and decay (s), its darkness. */
const VIG_ATTACK_S = 0.12;
const VIG_DECAY_S = 1.9;
const VIG_ALPHA = 0.92;
const PULSES_MAX = 3;

/** The ring's radius fraction and darkness 0..1 at u (0..1 of its run): out fast then slowing, fading as it goes. Pure. */
export function pulseRing(u: number): { radius: number; alpha: number } {
    const v = Math.max(0, Math.min(1, u));
    return { radius: 1 - Math.pow(1 - v, 2.2), alpha: Math.min(1, v * 12) * Math.pow(1 - v, 1.3) };
}

/** The screen-edge dark 0..1 at t s after the hit. Pure. */
export function pulseVignette(t: number): number {
    if (t < 0) return 0;
    if (t < VIG_ATTACK_S) return t / VIG_ATTACK_S;
    return Math.max(0, Math.exp(-(t - VIG_ATTACK_S) / (VIG_DECAY_S / 3)));
}

interface Pulse {
    x: number;
    y: number;
    hit: number;
    level: number;
}

function ringTexture(): Texture {
    const s = 256;
    const px = new Uint8ClampedArray(s * s * 4);
    for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
            const d = Math.hypot((x + 0.5) / s - 0.5, (y + 0.5) / s - 0.5) * 2;
            // a soft band, sharper on its leading (outer) edge, a faint wake inside
            const band = d < 0.9 ? Math.exp(-(((d - 0.9) / 0.13) ** 2)) : Math.exp(-(((d - 0.9) / 0.035) ** 2));
            const wake = d < 0.9 ? 0.18 * Math.max(0, (d - 0.55) / 0.35) : 0;
            const a = Math.min(1, band + wake) * (d < 1 ? 1 : 0);
            const i = (y * s + x) * 4;
            px[i] = 26;
            px[i + 1] = 8;
            px[i + 2] = 40;
            px[i + 3] = a * 255;
        }
    }
    return textureFromRgbaPixels(px, s, s, false, 'watcher-pulse-ring');
}

function vignetteTexture(): Texture {
    const w = 256;
    const h = 160;
    const px = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const u = Math.abs((x + 0.5) / w - 0.5) * 2;
            const v = Math.abs((y + 0.5) / h - 0.5) * 2;
            const e = Math.max(0, Math.hypot(u * 0.92, v) - 0.42) / 0.55;
            const a = Math.min(1, Math.pow(e, 1.4));
            const i = (y * w + x) * 4;
            px[i] = 12;
            px[i + 1] = 2;
            px[i + 2] = 20;
            px[i + 3] = a * 255;
        }
    }
    return textureFromRgbaPixels(px, w, h, false, 'watcher-pulse-vignette');
}

export class WatcherPulseFx {
    readonly ringRoot = new Container();
    private pool = new SpritePool(this.ringRoot);
    private vig = new Sprite(Texture.EMPTY);
    private ring: Texture | null = null;
    private vigTex: Texture | null = null;
    private pulses: Pulse[] = [];
    private serial = 0;
    private events: DecloakEvent[] = [];
    private homes: Habitat[] = [];

    /** `world`: the ring's place (kept on top of it while a pulse runs); `screen`: the vignette's (on top). */
    constructor(private galaxy: Galaxy, private world: Container, screen: Container) {
        this.ringRoot.eventMode = 'none';
        world.addChild(this.ringRoot);
        this.vig.eventMode = 'none';
        this.vig.visible = false;
        screen.addChild(this.vig);
    }

    /** Each frame after the ships (`sec`: the render clock beaconCloakFx uses; the camera's centre, zoom, screen size). */
    update(sec: number, camX: number, camY: number, z: number, w: number, h: number): void {
        this.serial = decloaksSince(this.serial, this.events);
        const on = getSettings().watcherPulseEffects !== false;
        if (this.events.length > 0) {
            const viewer = localViewerEmpire(this.galaxy);
            this.homes = viewer?.colonies ?? [];
            for (const e of this.events) {
                const level = pulseLevel(e.x, e.y, camX, camY, this.homes, this.galaxy.sectorSize);
                if (level <= 0.02 || !on) continue;
                if (this.pulses.length >= PULSES_MAX) this.pulses.shift();
                this.pulses.push({ x: e.x, y: e.y, hit: e.at + DECLOAK_HIT_S, level });
            }
        }
        // over the world's map layers (galaxy stars, territory) added after it
        if (this.pulses.length > 0 && this.world.children[this.world.children.length - 1] !== this.ringRoot) this.world.addChild(this.ringRoot);
        this.pool.begin();
        let vig = 0;
        let keep = 0;
        for (const p of this.pulses) {
            const t = sec - p.hit;
            if (t > Math.max(PULSE_RING_S, VIG_DECAY_S + VIG_ATTACK_S)) continue;
            this.pulses[keep++] = p;
            if (!on || t < 0) continue;
            vig = Math.max(vig, pulseVignette(t) * p.level);
            const u = t / PULSE_RING_S;
            if (u >= 1) continue;
            if (this.ring === null) this.ring = ringTexture();
            const rg = pulseRing(u);
            const R = PULSE_RING_SECTORS * this.galaxy.sectorSize * (0.45 + 0.55 * p.level) * rg.radius;
            const a = RING_ALPHA * p.level * rg.alpha;
            if (a <= 0.01 || R <= 0) continue;
            const s = this.pool.acquire(this.ring);
            s.position.set(p.x, p.y);
            s.scale.set((R * 2) / this.ring.width);
            s.alpha = a;
            s.blendMode = 'normal';
        }
        this.pulses.length = keep;
        this.pool.end();
        if (vig > 0.01) {
            if (this.vigTex === null) {
                this.vigTex = vignetteTexture();
                this.vig.texture = this.vigTex;
            }
            this.vig.visible = true;
            this.vig.position.set(0, 0);
            this.vig.width = w;
            this.vig.height = h;
            this.vig.alpha = VIG_ALPHA * vig;
        } else this.vig.visible = false;
        void z;
    }
}
