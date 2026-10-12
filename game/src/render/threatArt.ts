// Threat looks (render only): the Generation Ships' centuries-old fleets and the Dead Probe Swarm's own art.
//
// Both are runtime composites over the stock frames loaded from the player's install (shipArt.ts ShipArt.rgba) —
// nothing here is committed art. Factions are found through the threats' scenario state (peekGenShipsState /
// peekProbeSwarmState: read only, never created), never by name.
//
// - Generation ships: every object of the faction (and the world ship, whoever holds it) wears the 19r wear layer
//   (liveryLayer.ts) forced to its oldest bucket with a few old scars, under a faded, yellowed sprite tint; the world
//   ship is drawn WORLD_SHIP_VISUAL_SCALE × its stock size (the drawn size feeds picking, the selection ring and the
//   ambient exhaust, so all stay consistent).
// - Probe swarm (the stock Mechanoid / Ancient Guardians frames): an oxidised dark-brown palette shift with dust,
//   pitting and edge corrosion, a few sensor spines out of the hull, baked sensor eyes and blink lights with their
//   additive halos (SwarmFxLayer, one sprite per light group per ship, pooled — no per-frame allocation), and the
//   Mothercore drawn larger with a slow core glow. Built lazily (at most one composite per frame) and cached per frame URL.

import { Container, type Texture } from 'pixi.js';
import type { Galaxy } from '../sim/galaxy';
import type { BuiltObject } from '../sim/builtObject';
import type { Empire } from '../sim/empire';
import { peekGenShipsState } from '../sim/scenario/threats/generationShips';
import { peekProbeSwarmState } from '../sim/scenario/threats/probeSwarm';
import type { ShipArt } from './shipArt';
import { HULL_ALPHA, distanceTransform, luminance } from './liveries';
import { textureFromRgbaPixels } from './textureCanvas';
import { useMinifyingFilter } from './assets';
import { SpritePool } from './fxCommon';

// ---------------------------------------------------------------------------------------------------------------
// Who is who (once per frame)
// ---------------------------------------------------------------------------------------------------------------

export interface ThreatLooks {
    genFaction: Empire | null;
    worldShip: BuiltObject | null;
    swarmFaction: Empire | null;
    mothercore: BuiltObject | null;
}

const looks: ThreatLooks = { genFaction: null, worldShip: null, swarmFaction: null, mothercore: null };

/** The threat factions / flagships this frame (a shared record, refreshed in place). */
export function threatLooks(galaxy: Galaxy): ThreatLooks {
    looks.genFaction = looks.worldShip = looks.swarmFaction = looks.mothercore = null;
    if (galaxy.scenario === null) return looks;
    const g = peekGenShipsState(galaxy);
    if (g !== null) {
        looks.genFaction = g.faction;
        looks.worldShip = g.worldShip !== null && !g.worldShip.hasBeenDestroyed ? g.worldShip : null;
    }
    const s = peekProbeSwarmState(galaxy);
    if (s !== null) {
        looks.swarmFaction = s.faction;
        looks.mothercore = s.mothercore;
    }
    return looks;
}

export const WORLD_SHIP_VISUAL_SCALE = 2.5;
export const MOTHERCORE_VISUAL_SCALE = 1.6;

/** Visual size multiplier of an object (1 for everything but the world ship / the Mothercore). */
export function threatDrawScale(l: ThreatLooks, bo: BuiltObject): number {
    if (bo === l.worldShip) return WORLD_SHIP_VISUAL_SCALE;
    if (bo === l.mothercore) return MOTHERCORE_VISUAL_SCALE;
    return 1;
}

/** A generation-ship hull (the faction's, or the world ship under any owner). */
export function isAncientHull(l: ThreatLooks, bo: BuiltObject): boolean {
    return (l.genFaction !== null && bo.actualEmpire === l.genFaction) || (l.worldShip !== null && bo === l.worldShip);
}

export function isSwarmHull(l: ThreatLooks, bo: BuiltObject): boolean {
    return l.swarmFaction !== null && bo.actualEmpire === l.swarmFaction;
}

/** The generation ships' faded, yellowed hull tint, and their forced wear look (liveryLayer `forced`). */
export const ANCIENT_TINT = 0xd6cab4;
export const ANCIENT_WEAR = { level: 1, scars: 2 } as const;

// ---------------------------------------------------------------------------------------------------------------
// Probe swarm composites
// ---------------------------------------------------------------------------------------------------------------

export interface SwarmArt {
    texture: Texture;
    eyes: Texture;
    blink: Texture;
    core: Texture | null;
}

type Rgb = readonly [number, number, number];
const DARK: Rgb = [0.07, 0.05, 0.036];
const MID: Rgb = [0.31, 0.205, 0.12];
const HIGH: Rgb = [0.6, 0.47, 0.33];
const RUST: Rgb = [0.3, 0.14, 0.06];
const DUST: Rgb = [0.4, 0.36, 0.31];
const SPINE: Rgb = [0.17, 0.12, 0.085];
const EYE: Rgb = [1.0, 0.62, 0.16];
const BLINK: Rgb = [0.66, 0.92, 0.36];
const CORE: Rgb = [1.0, 0.5, 0.16];

function hash2(x: number, y: number, seed: number): number {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise(x: number, y: number, seed: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    const a = hash2(xi, yi, seed);
    const b = hash2(xi + 1, yi, seed);
    const c = hash2(xi, yi + 1, seed);
    const d = hash2(xi + 1, yi + 1, seed);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function smooth(a: number, b: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
}

function strHash(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
}

interface Light {
    x: number;
    y: number;
    r: number;
}

/** Additive halo image of `lights` in colour `c` (σ = k × radius), w × h. */
function halo(w: number, h: number, lights: readonly Light[], c: Rgb, k: number): Uint8ClampedArray {
    const out = new Uint8ClampedArray(w * h * 4);
    for (const l of lights) {
        const sg = Math.max(0.8, l.r * k);
        const x0 = Math.max(0, Math.floor(l.x - 3 * sg));
        const x1 = Math.min(w - 1, Math.ceil(l.x + 3 * sg));
        const y0 = Math.max(0, Math.floor(l.y - 3 * sg));
        const y1 = Math.min(h - 1, Math.ceil(l.y + 3 * sg));
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const q = ((x + 0.5 - l.x) ** 2 + (y + 0.5 - l.y) ** 2) / (sg * sg);
                if (q > 9) continue;
                const a = Math.exp(-q);
                const i = (y * w + x) * 4;
                const na = Math.min(1, out[i + 3] / 255 + a);
                out[i] = c[0] * 255;
                out[i + 1] = c[1] * 255;
                out[i + 2] = c[2] * 255;
                out[i + 3] = na * 255;
            }
        }
    }
    return out;
}

function put(d: Uint8ClampedArray, i: number, c: Rgb, a: number): void {
    d[i] = d[i] + (c[0] * 255 - d[i]) * a;
    d[i + 1] = d[i + 1] + (c[1] * 255 - d[i + 1]) * a;
    d[i + 2] = d[i + 2] + (c[2] * 255 - d[i + 2]) * a;
}

/** Disc of colour `c` (anti-aliased edge) over opaque pixels; `over` also paints transparent ones opaque. */
function disc(d: Uint8ClampedArray, w: number, h: number, cx: number, cy: number, r: number, c: Rgb, over = false): void {
    for (let y = Math.max(0, Math.floor(cy - r - 1)); y <= Math.min(h - 1, Math.ceil(cy + r + 1)); y++) {
        for (let x = Math.max(0, Math.floor(cx - r - 1)); x <= Math.min(w - 1, Math.ceil(cx + r + 1)); x++) {
            const a = Math.max(0, Math.min(1, r + 0.5 - Math.hypot(x + 0.5 - cx, y + 0.5 - cy)));
            if (a <= 0) continue;
            const i = (y * w + x) * 4;
            if (d[i + 3] === 0 && !over) continue;
            put(d, i, c, a);
            if (over) d[i + 3] = Math.max(d[i + 3], a * 255);
        }
    }
}

/** Anti-aliased segment of half width `hw` (painted opaque over anything). */
function segment(d: Uint8ClampedArray, w: number, h: number, x0: number, y0: number, x1: number, y1: number, hw: number, c: Rgb): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy || 1;
    for (let y = Math.max(0, Math.floor(Math.min(y0, y1) - hw - 1)); y <= Math.min(h - 1, Math.ceil(Math.max(y0, y1) + hw + 1)); y++) {
        for (let x = Math.max(0, Math.floor(Math.min(x0, x1) - hw - 1)); x <= Math.min(w - 1, Math.ceil(Math.max(x0, x1) + hw + 1)); x++) {
            const px = x + 0.5 - x0;
            const py = y + 0.5 - y0;
            const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
            const dist = Math.hypot(px - t * dx, py - t * dy);
            const a = Math.max(0, Math.min(1, hw + 0.5 - dist));
            if (a <= 0) continue;
            const i = (y * w + x) * 4;
            const old = d[i + 3] / 255;
            if (old < 0.05) {
                d[i] = c[0] * 255;
                d[i + 1] = c[1] * 255;
                d[i + 2] = c[2] * 255;
            } else put(d, i, c, a);
            d[i + 3] = Math.max(d[i + 3], a * 255);
        }
    }
}

interface SwarmImages {
    w: number;
    h: number;
    ship: Uint8ClampedArray;
    eyes: Uint8ClampedArray;
    blink: Uint8ClampedArray;
    core: Uint8ClampedArray | null;
}

/** The swarm composite of one stock frame (straight alpha, the frame's own size and placement). Pure. */
export function buildSwarmImages(art: Pick<ShipArt, 'rgba' | 'w' | 'h' | 'metrics' | 'url'>, mothercore: boolean): SwarmImages | null {
    const { w, h, rgba, metrics } = art;
    const seed = strHash(art.url) ^ (mothercore ? 0x5eed : 0);
    const S = metrics.cropSide;
    const u = Math.max(1, S / 100); // feature unit (px)
    const mask = new Uint8Array(w * h);
    let n = 0;
    let sx = 0;
    let sy = 0;
    let sw = 0;
    let top = h;
    for (let p = 0; p < w * h; p++) {
        if (rgba[p * 4 + 3] <= HULL_ALPHA) continue;
        mask[p] = 1;
        n++;
    }
    if (n < 16) return null;
    const dist = distanceTransform(mask, w, h);
    const cx = metrics.cropCenterX;
    const cy = metrics.cropCenterY;
    let maxR = 1;
    for (let p = 0; p < w * h; p++) {
        if (mask[p] === 0) continue;
        const x = p % w;
        const y = (p - x) / w;
        const dd = dist[p] * dist[p];
        sx += x * dd;
        sy += y * dd;
        sw += dd;
        maxR = Math.max(maxR, Math.hypot(x - cx, y - cy));
        if (Math.abs(x - cx) < S * 0.2 && y < top) top = y;
    }
    // 1. Oxidised palette: luminance onto a dark-brown ramp, rust blooms, dust, edge corrosion, grain.
    const d = new Uint8ClampedArray(rgba);
    for (let p = 0; p < w * h; p++) {
        const i = p * 4;
        if (d[i + 3] === 0) continue;
        const x = p % w;
        const y = (p - x) / w;
        const L = Math.min(1, Math.pow(luminance(rgba[i], rgba[i + 1], rgba[i + 2]), 0.95) * 1.12);
        const lo = Math.min(1, L * 2);
        const hi = Math.max(0, L * 2 - 1);
        let r = L < 0.5 ? DARK[0] + (MID[0] - DARK[0]) * lo : MID[0] + (HIGH[0] - MID[0]) * hi;
        let g = L < 0.5 ? DARK[1] + (MID[1] - DARK[1]) * lo : MID[1] + (HIGH[1] - MID[1]) * hi;
        let b = L < 0.5 ? DARK[2] + (MID[2] - DARK[2]) * lo : MID[2] + (HIGH[2] - MID[2]) * hi;
        const ox = smooth(0.5, 0.78, noise(x / (11 * u), y / (11 * u), seed)) * 0.4;
        r += (RUST[0] * (0.6 + L) - r) * ox;
        g += (RUST[1] * (0.6 + L) - g) * ox;
        b += (RUST[2] * (0.6 + L) - b) * ox;
        const du = smooth(0.45, 0.9, noise(x / (6 * u) + 31.7, y / (6 * u) - 9.1, seed)) * 0.16;
        r += (DUST[0] - r) * du;
        g += (DUST[1] - g) * du;
        b += (DUST[2] - b) * du;
        const edge = 1 - smooth(0, 2.2 * u, dist[p]);
        const grain = 0.86 + 0.26 * hash2(x, y, seed ^ 0x9e37);
        const k = (1 - 0.38 * edge) * grain;
        d[i] = Math.min(1, r * k) * 255;
        d[i + 1] = Math.min(1, g * k) * 255;
        d[i + 2] = Math.min(1, b * k) * 255;
    }
    // 2. Pitting: dark craters with a lit lower-right rim, on the hull interior.
    const pits = Math.round(n / (55 * u * u));
    for (let k = 0, tries = 0; k < pits && tries < pits * 8; tries++) {
        const p = Math.floor(hash2(tries, 7, seed) * w * h);
        if (mask[p] === 0 || dist[p] < 1.5 * u) continue;
        k++;
        const x = (p % w) + 0.5;
        const y = Math.floor(p / w) + 0.5;
        const r = u * (0.45 + 0.9 * hash2(tries, 11, seed));
        disc(d, w, h, x + r * 0.35, y + r * 0.35, r, [0.5, 0.4, 0.3]);
        disc(d, w, h, x, y, r, [0.05, 0.035, 0.025]);
    }
    // 3. Sensor spines out of the silhouette edge (radially outward, inside the frame), a light at some tips.
    const blinks: Light[] = [];
    const spines = mothercore ? 7 : 3;
    const tips: [number, number][] = [];
    for (let k = 0, tries = 0; k < spines && tries < 4000; tries++) {
        const p = Math.floor(hash2(tries, 23, seed) * w * h);
        if (mask[p] === 0 || dist[p] > 1.5) continue;
        const x = p % w;
        const y = (p - x) / w;
        const rr = Math.hypot(x - cx, y - cy);
        if (rr < maxR * 0.55) continue;
        if (tips.some(([tx, ty]) => Math.hypot(tx - x, ty - y) < S * 0.18)) continue;
        const ang = Math.atan2(y - cy, x - cx) + (hash2(tries, 29, seed) - 0.5) * 0.5;
        let len = u * (mothercore ? 7 + 7 * hash2(tries, 31, seed) : 5 + 6 * hash2(tries, 31, seed));
        // Keep inside the frame (2 px margin).
        const ex = Math.cos(ang);
        const ey = Math.sin(ang);
        for (; len > 2 * u; len *= 0.8) {
            const tx = x + ex * len;
            const ty = y + ey * len;
            if (tx > 2 && ty > 2 && tx < w - 3 && ty < h - 3) break;
        }
        if (len <= 2 * u) continue;
        k++;
        const tx = x + 0.5 + ex * len;
        const ty = y + 0.5 + ey * len;
        tips.push([x, y]);
        const hw = Math.max(0.5, 0.32 * u);
        segment(d, w, h, x + 0.5 - ex * u, y + 0.5 - ey * u, tx, ty, hw, SPINE);
        // Two short cross ticks (a sensor mast), then a knob.
        for (const f of [0.45, 0.72]) {
            const mx = x + 0.5 + ex * len * f;
            const my = y + 0.5 + ey * len * f;
            const tl = u * (1.1 - f * 0.6);
            segment(d, w, h, mx - ey * tl, my + ex * tl, mx + ey * tl, my - ex * tl, hw * 0.8, SPINE);
        }
        disc(d, w, h, tx, ty, Math.max(0.8, 0.7 * u), [0.24, 0.17, 0.11], true);
        if (k % 2 === 1) blinks.push({ x: tx, y: ty, r: Math.max(0.7, 0.5 * u) });
    }
    // 4. Sparse hull blink lights.
    for (let k = 0, tries = 0; k < (mothercore ? 4 : 2) && tries < 2000; tries++) {
        const p = Math.floor(hash2(tries, 41, seed) * w * h);
        if (mask[p] === 0 || dist[p] < 1.2 * u || dist[p] > 4 * u) continue;
        const x = (p % w) + 0.5;
        const y = Math.floor(p / w) + 0.5;
        if (blinks.some((b) => Math.hypot(b.x - x, b.y - y) < S * 0.2)) continue;
        k++;
        blinks.push({ x, y, r: Math.max(0.7, 0.5 * u) });
    }
    for (const b of blinks) disc(d, w, h, b.x, b.y, b.r, [BLINK[0] * 0.55, BLINK[1] * 0.55, BLINK[2] * 0.55]);
    // 5. Sensor eyes: a pair near the bow (the frame's top), else the deepest point near it.
    const eyes: Light[] = [];
    const er = Math.max(0.9, 1.15 * u * (mothercore ? 1.4 : 1));
    if (top < h) {
        let bottom = top;
        for (let p = 0; p < w * h; p++) if (mask[p] !== 0) bottom = Math.max(bottom, Math.floor(p / w));
        const ey = Math.round(top + (bottom - top) * (mothercore ? 0.3 : 0.2));
        for (const side of [-1, 1]) {
            let best = -1;
            let bestScore = -Infinity;
            for (let x = Math.max(0, Math.floor(cx - S * 0.3)); x < Math.min(w, cx + S * 0.3); x++) {
                if (side < 0 ? x > cx : x < cx) continue;
                for (let y = Math.max(0, ey - Math.round(3 * u)); y <= Math.min(h - 1, ey + Math.round(3 * u)); y++) {
                    const p = y * w + x;
                    if (dist[p] < er + 1) continue;
                    const sc = -Math.abs(Math.abs(x - cx) - Math.max(er * 2, S * 0.07)) - Math.abs(y - ey) * 0.5;
                    if (sc > bestScore) {
                        bestScore = sc;
                        best = p;
                    }
                }
            }
            if (best >= 0) {
                const x = (best % w) + 0.5;
                const y = Math.floor(best / w) + 0.5;
                if (!eyes.some((e) => Math.hypot(e.x - x, e.y - y) < er * 2)) eyes.push({ x, y, r: er });
            }
        }
    }
    if (eyes.length === 0 && sw > 0) eyes.push({ x: sx / sw + 0.5, y: sy / sw + 0.5, r: er });
    for (const e of eyes) {
        disc(d, w, h, e.x, e.y, e.r * 1.7, [0.03, 0.02, 0.015]);
        disc(d, w, h, e.x, e.y, e.r, [EYE[0] * 0.8, EYE[1] * 0.7, EYE[2] * 0.6]);
        disc(d, w, h, e.x - e.r * 0.25, e.y - e.r * 0.25, e.r * 0.4, [1, 0.88, 0.6]);
    }
    // 6. The Mothercore's core: a deep amber disc at the hull's interior centroid, its slow glow an overlay.
    let core: Uint8ClampedArray | null = null;
    if (mothercore && sw > 0) {
        const kx = sx / sw + 0.5;
        const ky = sy / sw + 0.5;
        const cr = Math.max(2, S * 0.045);
        disc(d, w, h, kx, ky, cr * 1.5, [0.06, 0.04, 0.03]);
        disc(d, w, h, kx, ky, cr, [0.75, 0.33, 0.08]);
        disc(d, w, h, kx, ky, cr * 0.5, [1, 0.72, 0.35]);
        core = halo(w, h, [{ x: kx, y: ky, r: cr }], CORE, 3.2);
    }
    // Never leave a stock marker colour (pure blue / pure yellow) the ambient scan would pick up.
    for (let p = 0; p < w * h; p++) {
        const i = p * 4;
        if (d[i + 3] === 0) continue;
        if ((d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 255) || (d[i] === 255 && d[i + 1] === 255 && d[i + 2] === 0)) d[i + 2] ^= 1;
    }
    return { w, h, ship: d, eyes: halo(w, h, eyes, EYE, 2.6), blink: halo(w, h, blinks, BLINK, 2.8), core };
}

function tex(data: Uint8ClampedArray, w: number, h: number): Texture {
    const t = textureFromRgbaPixels(data, w, h);
    useMinifyingFilter(t);
    return t;
}

const swarmCache = new Map<string, SwarmArt | null>();
let swarmBuildFrame = -1;

/** The swarm composite of a stock frame: built on first request (one per `frame`; undefined until built, null if the
 * frame has no hull). */
export function swarmArtFor(art: ShipArt, mothercore: boolean, frame: number): SwarmArt | null | undefined {
    const key = mothercore ? `${art.url}|core` : art.url;
    const hit = swarmCache.get(key);
    if (hit !== undefined) return hit;
    if (frame === swarmBuildFrame) return undefined;
    swarmBuildFrame = frame;
    const im = buildSwarmImages(art, mothercore);
    const sa = im === null ? null : { texture: tex(im.ship, im.w, im.h), eyes: tex(im.eyes, im.w, im.h), blink: tex(im.blink, im.w, im.h), core: im.core !== null ? tex(im.core, im.w, im.h) : null };
    swarmCache.set(key, sa);
    return sa;
}

// ---------------------------------------------------------------------------------------------------------------
// Animation (shared clock: the layer's one `sec` per frame; nothing allocated per frame)
// ---------------------------------------------------------------------------------------------------------------

/** Sensor eyes: a slow breathing pulse (3.6 s), phase per ship. Pure. */
export function swarmEyeAlpha(sec: number, id: number): number {
    return 0.35 + 0.55 * (0.5 + 0.5 * Math.sin(2 * Math.PI * (sec / 3.6 + (id % 17) / 17)));
}

/** Blink lights: a short flash every 2.9 s, phase per ship (0 between flashes). Pure. */
export function swarmBlinkAlpha(sec: number, id: number): number {
    const ph = (((sec + (id % 13) * 0.37) % 2.9) + 2.9) % 2.9;
    return ph < 0.35 ? 1 - ph / 0.35 : 0;
}

/** The Mothercore's core: a slow 6.5 s swell. Pure. */
export function swarmCoreAlpha(sec: number): number {
    return 0.3 + 0.6 * (0.5 + 0.5 * Math.sin((2 * Math.PI * sec) / 6.5));
}

/** Overlays below this drawn size (px) are skipped (the baked dots still show). */
export const SWARM_FX_MIN_PX = 10;

export class SwarmFxLayer {
    readonly root = new Container();
    private pool = new SpritePool(this.root);

    constructor() {
        this.root.eventMode = 'none';
    }

    begin(): void {
        this.pool.begin();
    }

    private one(t: Texture, a: number, x: number, y: number, rotation: number, scale: number, ax: number, ay: number): void {
        if (a <= 0.01) return;
        const s = this.pool.acquire(t);
        s.blendMode = 'add';
        s.anchor.set(ax, ay);
        s.position.set(x, y);
        s.rotation = rotation;
        s.scale.set(scale);
        s.alpha = a;
    }

    /** The light overlays of one swarm object, with the ship sprite's transform. `sec`: the shared wall clock. */
    draw(art: SwarmArt, x: number, y: number, rotation: number, scale: number, ax: number, ay: number, id: number, drawnPx: number, sec: number): void {
        if (drawnPx < SWARM_FX_MIN_PX) return;
        this.one(art.eyes, swarmEyeAlpha(sec, id), x, y, rotation, scale, ax, ay);
        this.one(art.blink, swarmBlinkAlpha(sec, id), x, y, rotation, scale, ax, ay);
        if (art.core !== null) this.one(art.core, swarmCoreAlpha(sec), x, y, rotation, scale, ax, ay);
    }

    end(): void {
        this.pool.end();
    }
}
