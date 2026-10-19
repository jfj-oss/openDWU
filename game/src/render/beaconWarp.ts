// The Beacon's warp (Giantworks add-on; render only): the Reclaimers' and the Watchers' own hyperjump look in place of
// the stock enter / exit flares (effectsLayer.ts checkHyper hands their spools and jumps here; threatArt.ts
// beaconArtFile says whose ships they are; beaconFx.ts draws it with each ship's sprite transform). Reality warping
// round the hull: it follows the ship's own silhouette (read from its frame's alpha: an ordered outline, a red rim
// halo, a dark shroud) and barely leaves its frame. While the drive spools, dark-matter motes and wisps (inky,
// faintly red-rimmed, drawn normally so they darken what they cross) gather in onto the hull, the dark shroud and
// the red rim deepen, and a few slow lightning sparks crawl along the outline, linger and fade. At the jump the
// motes collapse onto the hull, the rim flares red and the shroud implodes; what is left lingers where the ship was
// and dies away. On arrival the shroud contracts onto the hull with a red flare, motes flow off it and a few sparks
// linger, then the hull steams (pale vapour venting from the seams and trailing edges, drifting aft). Close up (and
// for at most BEACON_WARP_METABALL_SLOTS ships at once) the dark matter is metaballs: soft blobs summed in a filtered
// container and thresholded to a crisp, red-rimmed edge, so they merge and split like a lava lamp, a slow swirl inside;
// the rest get the wisps. Pooled sprites, textures made once per frame file; nothing under BEACON_WARP_MIN_PX drawn size but the
// flare (down to BEACON_WARP_FLASH_MIN_PX). The look follows the red lightning in a user-supplied image of a Mass
// Effect Reaper (EA / BioWare), at the user's request; everything here is drawn, no pixels taken from it.

import { Container, Filter, GlProgram, GpuProgram, Texture, UniformGroup, type Sprite } from 'pixi.js';
import type { BuiltObject } from '../sim/builtObject';
import { SpritePool } from './fxCommon';
import { makeTextureCanvas, textureFromCanvas } from './textureCanvas';

/** No motes or sparks under this drawn ship size (px): the flare alone. */
export const BEACON_WARP_MIN_PX = 14;
/** Nothing at all under this drawn size (px). */
export const BEACON_WARP_FLASH_MIN_PX = 3;
/** A jump-out: the collapse (the stock flare's 800 ms before the jump), then what lingers (ms in all). */
export const BEACON_WARP_ENTER_MS = 2100;
export const BEACON_WARP_JUMP_AT_MS = 800;
/** An arrival (ms). */
export const BEACON_WARP_EXIT_MS = 4400;
/** The arrival's flare and droplets (ms); the steam after them runs to BEACON_WARP_EXIT_MS. */
export const BEACON_WARP_ARRIVE_MS = 1900;
/** A Watcher's cloak veil (veil()): the share of its reveal over which the dark mass swells (then it drains). */
export const BEACON_VEIL_SWELL = 0.35;
/** How many warping ships get the full dark-matter metaballs at once (the rest: the wisps). */
export const BEACON_WARP_METABALL_SLOTS = 4;
/** Metaballs and steam only from this drawn size (px). */
export const BEACON_WARP_METABALL_MIN_PX = 40;
const STEAM_PUFFS = 22;
const SPARK_TEXTURES = 9;
const MOTES_MAX = 22;
const SPARK_SLOTS = 3;
const MAX_BURSTS = 24;
/** A charge note older than this (ms) is stale: the ship stopped spooling. */
const CHARGE_STALE_MS = 400;

// ---------------------------------------------------------------------------------------------------------------
// What the effects layer tells the warp (module-level: it has the star date and the hyper flags' edges)
// ---------------------------------------------------------------------------------------------------------------

interface ChargeNote {
    c: number;
    at: number;
}
const charges = new WeakMap<BuiltObject, ChargeNote>();
const spools = new WeakMap<BuiltObject, { total: number }>();
const pendingBursts: { kind: 'enter' | 'exit'; bo: BuiltObject; at: number }[] = [];

/** The render clock (ms): wall time, so the warp runs at its own pace whatever the game speed. */
export function warpClockMs(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** The charge 0..1 of a spooling drive: how far through its spool (`remainingMs` left of `totalMs`). Pure. */
export function warpCharge(remainingMs: number, totalMs: number): number {
    if (!(totalMs > 0)) return 1;
    return Math.max(0, Math.min(1, 1 - remainingMs / totalMs));
}

/** A Beacon ship spooling its drive (`countdown` its hyperjumpCountdown, `starDate` now): notes its charge. */
export function noteWarpSpool(bo: BuiltObject, countdown: number, starDate: number): void {
    const left = countdown - starDate;
    let sp = spools.get(bo);
    // a new spool when none is known or more is left than the known one's length (a fresh order); a countdown moved
    // within one spool (a re-roll) keeps its length
    if (sp === undefined || left > sp.total) {
        sp = { total: Math.max(1, left) };
        spools.set(bo, sp);
    }
    let n = charges.get(bo);
    if (n === undefined) {
        n = { c: 0, at: 0 };
        charges.set(bo, n);
    }
    n.c = warpCharge(left, sp.total);
    n.at = warpClockMs();
}

/** A Beacon ship's jump-out ('enter': into hyperspace, as the stock flare starts) or its arrival ('exit'). */
export function noteWarpBurst(kind: 'enter' | 'exit', bo: BuiltObject): void {
    if (pendingBursts.length >= MAX_BURSTS) pendingBursts.shift();
    pendingBursts.push({ kind, bo, at: warpClockMs() });
}

/** A hash 0..1 of three integers. Pure. */
export function warpHash(a: number, b: number, c: number): number {
    let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth01(a: number, b: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------------------------------------------
// A frame's shape: its outline, rim, shroud and sparks (made once per frame file, from its pixels)
// ---------------------------------------------------------------------------------------------------------------

/** One spark texture and where it sits on the frame (frame px of its top left). */
interface SparkArt {
    tex: Texture;
    dx: number;
    dy: number;
}

interface WarpShape {
    w: number;
    h: number;
    /** The outline, every few px (frame px), and its outward normals. */
    px: Float32Array;
    py: Float32Array;
    nx: Float32Array;
    ny: Float32Array;
    /** The red rim halo and the dark shroud: the frame's size, at half its resolution. */
    rim: Texture;
    shroud: Texture;
    /** The hull and a little round it (white; the metaballs are clipped to it). */
    near: Texture;
    /** Where steam vents on arrival (frame px): the seams, the trailing edges. */
    vx: Float32Array;
    vy: Float32Array;
    sparks: SparkArt[];
}

/** A small seeded generator (render-local: no sim randomness is drawn). */
function mulberry(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** The outer outline of the mask (Moore-neighbour tracing from its top-left pixel), as pixel centres. Pure. */
export function traceOutline(mask: Uint8Array, w: number, h: number): number[] {
    let start = -1;
    for (let i = 0; i < w * h && start < 0; i++) if (mask[i]) start = i;
    if (start < 0) return [];
    const DX = [1, 1, 0, -1, -1, -1, 0, 1];
    const DY = [0, 1, 1, 1, 0, -1, -1, -1];
    const out: number[] = [];
    let cx = start % w;
    let cy = Math.floor(start / w);
    let dir = 6; // we came from above-left: start searching from "up"
    const at = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] !== 0;
    for (let guard = 0; guard < w * h * 2; guard++) {
        out.push(cx, cy);
        let found = false;
        for (let k = 0; k < 8; k++) {
            const d = (dir + 6 + k) % 8; // turn left of the last move, then sweep clockwise
            const nx = cx + DX[d];
            const ny = cy + DY[d];
            if (at(nx, ny)) {
                cx = nx;
                cy = ny;
                dir = d;
                found = true;
                break;
            }
        }
        if (!found || (cx === start % w && cy === Math.floor(start / w) && out.length > 4)) break;
    }
    return out;
}

function makeShape(img: HTMLImageElement | ImageBitmap, seed: number): WarpShape | null {
    const w = img.width;
    const h = img.height;
    if (w < 8 || h < 8) return null;
    const { ctx } = makeTextureCanvas(w, h);
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, w, h).data;
    // the outline on a half-resolution mask (fewer points, smoother)
    const mw = Math.ceil(w / 2);
    const mh = Math.ceil(h / 2);
    const mask = new Uint8Array(mw * mh);
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) if (data[(y * w + x) * 4 + 3] > 110) mask[(y >> 1) * mw + (x >> 1)] = 1;
    const raw = traceOutline(mask, mw, mh);
    if (raw.length < 24) return null;
    // resample every ~3 frame px, smoothed
    const pts: number[] = [];
    let acc = 0;
    for (let i = 0; i < raw.length; i += 2) {
        const j = (i + 2) % raw.length;
        acc += Math.hypot(raw[j] - raw[i], raw[j + 1] - raw[i + 1]) * 2;
        if (acc >= 3) {
            acc = 0;
            pts.push(raw[i] * 2 + 1, raw[i + 1] * 2 + 1);
        }
    }
    const n = pts.length / 2;
    if (n < 12) return null;
    const px = new Float32Array(n);
    const py = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        let sx = 0;
        let sy = 0;
        for (let k = -2; k <= 2; k++) {
            const j = (i + k + n) % n;
            sx += pts[j * 2];
            sy += pts[j * 2 + 1];
        }
        px[i] = sx / 5;
        py[i] = sy / 5;
    }
    const nx = new Float32Array(n);
    const ny = new Float32Array(n);
    const alphaAt = (x: number, y: number): number => {
        const xi = Math.round(x);
        const yi = Math.round(y);
        return xi < 0 || yi < 0 || xi >= w || yi >= h ? 0 : data[(yi * w + xi) * 4 + 3];
    };
    for (let i = 0; i < n; i++) {
        const a = (i - 3 + n) % n;
        const b = (i + 3) % n;
        let tx = px[b] - px[a];
        let ty = py[b] - py[a];
        const l = Math.hypot(tx, ty) || 1;
        tx /= l;
        ty /= l;
        let ox = ty;
        let oy = -tx;
        if (alphaAt(px[i] + ox * 4, py[i] + oy * 4) > alphaAt(px[i] - ox * 4, py[i] - oy * 4)) {
            ox = -ox;
            oy = -oy;
        }
        nx[i] = ox;
        ny[i] = oy;
    }
    // the rim (red: a halo just outside the silhouette and a thin band on its edge, never a wash over the hull) and
    // the shroud (dark, wider, thinning over the hull), at half resolution, from the alpha and its blurs
    const hw = Math.ceil(w / 2);
    const hh = Math.ceil(h / 2);
    const layer = (blurPx: number): Uint8ClampedArray => {
        const { ctx: c } = makeTextureCanvas(hw, hh);
        c.filter = blurPx > 0 ? `blur(${blurPx}px)` : 'none';
        c.drawImage(img, 0, 0, hw, hh);
        return c.getImageData(0, 0, hw, hh).data;
    };
    const a0 = layer(0);
    const a1 = layer(1.2);
    const a2 = layer(3);
    const a3 = layer(8);
    const rimC = makeTextureCanvas(hw, hh);
    const shC = makeTextureCanvas(hw, hh);
    const rimD = rimC.ctx.createImageData(hw, hh);
    const shD = shC.ctx.createImageData(hw, hh);
    for (let i = 0; i < hw * hh; i++) {
        const q = i * 4 + 3;
        const al = a0[q] / 255;
        const halo = (a2[q] / 255) * (1 - al);
        const band = al > 0.5 ? Math.max(0, 1 - a1[q] / 255 / 0.92) * 3 : 0;
        const rv = Math.min(1, halo * 1.6 + band);
        rimD.data[i * 4] = 210;
        rimD.data[i * 4 + 1] = 28;
        rimD.data[i * 4 + 2] = 12;
        rimD.data[i * 4 + 3] = Math.round(rv * 255);
        const sv = Math.min(1, (a3[q] / 255) * 1.3) * (1 - 0.55 * al);
        shD.data[i * 4] = 8;
        shD.data[i * 4 + 1] = 0;
        shD.data[i * 4 + 2] = 3;
        shD.data[i * 4 + 3] = Math.round(sv * 255);
    }
    rimC.ctx.putImageData(rimD, 0, 0);
    shC.ctx.putImageData(shD, 0, 0);
    const nearC = makeTextureCanvas(hw, hh);
    const nearD = nearC.ctx.createImageData(hw, hh);
    for (let i = 0; i < hw * hh; i++) {
        const v = Math.min(1, (a2[i * 4 + 3] / 255) * 1.5 + a0[i * 4 + 3] / 255);
        nearD.data[i * 4] = 255;
        nearD.data[i * 4 + 1] = 255;
        nearD.data[i * 4 + 2] = 255;
        nearD.data[i * 4 + 3] = Math.round(v * 255);
    }
    nearC.ctx.putImageData(nearD, 0, 0);
    // the steam's vents: light-line / seam pixels (bluer than red, lit), and the trailing edges (the outline's aft third)
    const vents: number[] = [];
    const vr = mulberry(seed * 31 + 3);
    for (let tries = 0; tries < 40000 && vents.length < 96; tries++) {
        const x = Math.floor(vr() * w);
        const y = Math.floor(vr() * h);
        const q = (y * w + x) * 4;
        if (data[q + 3] > 200 && data[q + 2] - data[q] > 14 && Math.max(data[q], data[q + 1], data[q + 2]) > 70) vents.push(x, y);
    }
    for (let i = 0; i < n && vents.length < 160; i += 3) if (py[i] > h * 0.62) vents.push(px[i], py[i]);
    if (vents.length < 8) for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 24))) vents.push(px[i], py[i]);
    const vx = new Float32Array(vents.length / 2);
    const vy = new Float32Array(vents.length / 2);
    for (let i = 0; i < vx.length; i++) {
        vx[i] = vents[i * 2];
        vy[i] = vents[i * 2 + 1];
    }
    // the sparks: jagged red bolts along stretches of the outline, just off the hull, short branches onto it
    const sparks: SparkArt[] = [];
    const rnd = mulberry(seed * 977 + 5);
    const scale = Math.max(w, h) / 540;
    for (let k = 0; k < SPARK_TEXTURES; k++) {
        const i0 = Math.floor(rnd() * n);
        const len = Math.max(6, Math.floor(n * (0.05 + 0.08 * rnd())));
        const path: [number, number][] = [];
        let off = 1.5 * scale;
        for (let t = 0; t <= len; t++) {
            const i = (i0 + t) % n;
            off = Math.max(-1.5 * scale, Math.min(5 * scale, off + (rnd() * 2 - 1) * 1.6 * scale));
            const jag = t % 2 === 0 ? (rnd() * 2 - 1) * 2.2 * scale : 0;
            path.push([px[i] + nx[i] * (off + jag), py[i] + ny[i] * (off + jag)]);
        }
        const branches: [number, number][][] = [];
        const nb = 1 + Math.floor(rnd() * 3);
        for (let b = 0; b < nb; b++) {
            const t = 1 + Math.floor(rnd() * (len - 2));
            const i = (i0 + t) % n;
            const [bx, by] = path[t];
            const bl = (6 + rnd() * 14) * scale;
            const br: [number, number][] = [[bx, by]];
            let cx = bx;
            let cy = by;
            const steps = 4;
            for (let q = 1; q <= steps; q++) {
                // onto the hull (against the normal), wandering
                cx += (-nx[i] + (rnd() * 2 - 1) * 0.9) * (bl / steps);
                cy += (-ny[i] + (rnd() * 2 - 1) * 0.9) * (bl / steps);
                br.push([cx, cy]);
            }
            branches.push(br);
        }
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        for (const p of [...path, ...branches.flat()]) {
            x0 = Math.min(x0, p[0]);
            y0 = Math.min(y0, p[1]);
            x1 = Math.max(x1, p[0]);
            y1 = Math.max(y1, p[1]);
        }
        const pad = Math.ceil(18 * scale);
        const cw = Math.max(4, Math.ceil(x1 - x0) + 2 * pad);
        const ch = Math.max(4, Math.ceil(y1 - y0) + 2 * pad);
        const { canvas, ctx: c } = makeTextureCanvas(cw, ch);
        const ox = x0 - pad;
        const oy = y0 - pad;
        c.lineCap = 'round';
        c.lineJoin = 'round';
        const stroke = (pts: [number, number][], width: number): void => {
            c.lineWidth = width;
            c.beginPath();
            c.moveTo(pts[0][0] - ox, pts[0][1] - oy);
            for (let q = 1; q < pts.length; q++) c.lineTo(pts[q][0] - ox, pts[q][1] - oy);
            c.stroke();
        };
        const pass = (color: string, width: number, blur: number): void => {
            c.strokeStyle = color;
            c.shadowColor = blur > 0 ? 'rgba(170, 8, 0, 0.9)' : 'transparent';
            c.shadowBlur = blur;
            stroke(path, width);
            for (const br of branches) stroke(br, width * 0.6);
        };
        pass('rgba(110, 0, 0, 0.5)', 12 * scale, 14 * scale);
        pass('rgb(200, 26, 12)', 4.6 * scale, 4 * scale);
        pass('rgb(255, 150, 120)', 1.7 * scale, 0);
        sparks.push({ tex: textureFromCanvas(canvas, `beacon-warp-spark-${seed}-${k}`), dx: ox, dy: oy });
    }
    return { w, h, px, py, nx, ny, rim: textureFromCanvas(rimC.canvas, 'beacon-warp-rim'), shroud: textureFromCanvas(shC.canvas, 'beacon-warp-shroud'), near: textureFromCanvas(nearC.canvas, 'beacon-warp-near'), vx, vy, sparks };
}

/** The dark-matter wisps: irregular smoky blots (overlapping soft blobs), each as an inky core (drawn normally: it
 * darkens what it crosses) and its faint red edge (drawn additively: it shows against space). */
function makeWisps(n: number): { core: Texture[]; edge: Texture[] } {
    const px = 64;
    const core: Texture[] = [];
    const edge: Texture[] = [];
    for (let v = 0; v < n; v++) {
        const rnd = mulberry(v * 131 + 17);
        const A = new Float32Array(px * px);
        const blobs = 5 + Math.floor(rnd() * 4);
        for (let k = 0; k < blobs; k++) {
            const bx = px * (0.3 + 0.4 * rnd());
            const by = px * (0.32 + 0.36 * rnd());
            const br = px * (0.08 + 0.12 * rnd());
            const bw = 0.5 + 0.5 * rnd();
            for (let y = 0; y < px; y++)
                for (let x = 0; x < px; x++) {
                    const d2 = ((x - bx) ** 2 + (y - by) ** 2) / (br * br);
                    A[y * px + x] += bw * Math.exp(-d2);
                }
        }
        const { canvas: cc, ctx: c1 } = makeTextureCanvas(px, px);
        const { canvas: ec, ctx: c2 } = makeTextureCanvas(px, px);
        const d1 = c1.createImageData(px, px);
        const d2 = c2.createImageData(px, px);
        for (let i = 0; i < px * px; i++) {
            const a = Math.min(1, A[i] * 1.1);
            const inner = smooth01(0.35, 0.85, a);
            const rim = Math.max(0, Math.sin(Math.PI * smooth01(0.08, 0.6, a))) * (1 - inner);
            d1.data[i * 4] = 4;
            d1.data[i * 4 + 1] = 0;
            d1.data[i * 4 + 2] = 3;
            d1.data[i * 4 + 3] = Math.round(255 * Math.min(1, inner * 0.95 + a * 0.25));
            d2.data[i * 4] = 170;
            d2.data[i * 4 + 1] = 16;
            d2.data[i * 4 + 2] = 8;
            d2.data[i * 4 + 3] = Math.round(255 * rim * 0.55);
        }
        c1.putImageData(d1, 0, 0);
        c2.putImageData(d2, 0, 0);
        core.push(textureFromCanvas(cc, `beacon-warp-wisp-${v}`));
        edge.push(textureFromCanvas(ec, `beacon-warp-wisp-edge-${v}`));
    }
    return { core, edge };
}

/** A metaball: white, its alpha a smooth bump ((1 - r²)²), summed additively into the density field. */
function makeBlob(): Texture {
    const px = 64;
    const { canvas, ctx } = makeTextureCanvas(px, px);
    const d = ctx.createImageData(px, px);
    for (let y = 0; y < px; y++)
        for (let x = 0; x < px; x++) {
            const r2 = ((x + 0.5 - px / 2) ** 2 + (y + 0.5 - px / 2) ** 2) / ((px / 2) * (px / 2));
            const v = r2 < 1 ? (1 - r2) * (1 - r2) : 0;
            const i = (y * px + x) * 4;
            d.data[i] = d.data[i + 1] = d.data[i + 2] = 255;
            d.data[i + 3] = Math.round(v * 255);
        }
    ctx.putImageData(d, 0, 0);
    return textureFromCanvas(canvas, 'beacon-warp-blob');
}

/** The swirl inside the dark mass: smooth value noise (white, its alpha the tone), turned slowly over the ship. */
function makeSwirl(): Texture {
    const px = 96;
    const rnd = mulberry(977);
    const g = 8;
    const grid = new Float32Array((g + 1) * (g + 1));
    for (let i = 0; i < grid.length; i++) grid[i] = rnd();
    const { canvas, ctx } = makeTextureCanvas(px, px);
    const d = ctx.createImageData(px, px);
    for (let y = 0; y < px; y++)
        for (let x = 0; x < px; x++) {
            let v = 0;
            let amp = 0.6;
            for (let o = 0; o < 2; o++) {
                const f = (g / px) * (o + 1);
                const gx = (x * f) % g;
                const gy = (y * f) % g;
                const ix = Math.floor(gx);
                const iy = Math.floor(gy);
                const tx = smooth01(0, 1, gx - ix);
                const ty = smooth01(0, 1, gy - iy);
                const at = (a: number, b: number): number => grid[(b % (g + 1)) * (g + 1) + (a % (g + 1))];
                v += amp * ((at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx) * (1 - ty) + (at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx) * ty);
                amp *= 0.5;
            }
            // a spiral arm pattern on top (it reads as a swirl as it turns)
            const ax = x + 0.5 - px / 2;
            const ay = y + 0.5 - px / 2;
            const r = Math.hypot(ax, ay) / (px / 2);
            const arm = 0.5 + 0.5 * Math.sin(Math.atan2(ay, ax) * 3 + r * 9);
            const val = Math.min(1, Math.max(0, v * 0.8 + arm * 0.35 * (1 - r)));
            const i = (y * px + x) * 4;
            d.data[i] = d.data[i + 1] = d.data[i + 2] = 255;
            d.data[i + 3] = Math.round(val * 255 * (r < 1 ? 1 : 0.6));
        }
    ctx.putImageData(d, 0, 0);
    return textureFromCanvas(canvas, 'beacon-warp-swirl');
}

/** Vapour puffs: soft, lumpy, turbulent at the edge (overlapping falloff blobs, pale grey-white). */
function makePuffs(n: number): Texture[] {
    const px = 64;
    const out: Texture[] = [];
    for (let v = 0; v < n; v++) {
        const rnd = mulberry(v * 71 + 401);
        const A = new Float32Array(px * px);
        const blobs = 7 + Math.floor(rnd() * 5);
        for (let k = 0; k < blobs; k++) {
            const bx = px * (0.28 + 0.44 * rnd());
            const by = px * (0.28 + 0.44 * rnd());
            const br = px * (0.07 + 0.14 * rnd());
            const bw = 0.35 + 0.5 * rnd();
            for (let y = 0; y < px; y++)
                for (let x = 0; x < px; x++) A[y * px + x] += bw * Math.exp(-((x - bx) ** 2 + (y - by) ** 2) / (br * br));
        }
        const { canvas, ctx } = makeTextureCanvas(px, px);
        const d = ctx.createImageData(px, px);
        for (let i = 0; i < px * px; i++) {
            const a = Math.min(1, A[i]);
            const shade = 0.9 + 0.1 * a;
            d.data[i * 4] = Math.round(205 * shade);
            d.data[i * 4 + 1] = Math.round(210 * shade);
            d.data[i * 4 + 2] = Math.round(218 * shade);
            d.data[i * 4 + 3] = Math.round(255 * Math.pow(smooth01(0.0, 1.0, a), 1.6) * 0.8);
        }
        ctx.putImageData(d, 0, 0);
        out.push(textureFromCanvas(canvas, `beacon-warp-puff-${v}`));
    }
    return out;
}

// The metaball threshold: the blobs' density (red), the hull mask (green) and the swirl (blue), drawn additively into
// the filtered container, become a crisp-edged dark mass with a faint red rim, clipped to near the hull.
const METABALL_FRAG = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform float uAlpha;
uniform float uThreshold;
void main()
{
    vec4 c = texture(uTexture, vTextureCoord);
    float e = smoothstep(uThreshold - 0.05, uThreshold + 0.03, c.r);
    float a = e * smoothstep(0.04, 0.45, c.g) * uAlpha;
    float rim = e * (1.0 - smoothstep(uThreshold + 0.03, uThreshold + 0.17, c.r));
    vec3 col = mix(vec3(0.010, 0.0, 0.007), vec3(0.085, 0.014, 0.034), c.b);
    col += vec3(0.70, 0.06, 0.03) * rim * 0.75;
    finalColor = vec4(col * a, a * 0.93);
}
`;
const METABALL_VERT = `
in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
vec4 filterVertexPosition(void)
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    return vec4(position, 0.0, 1.0);
}
vec2 filterTextureCoord(void)
{
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}
void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
}
`;
const METABALL_WGSL = `
struct GlobalFilterUniforms {
  uInputSize:vec4<f32>,
  uInputPixel:vec4<f32>,
  uInputClamp:vec4<f32>,
  uOutputFrame:vec4<f32>,
  uGlobalFrame:vec4<f32>,
  uOutputTexture:vec4<f32>,
};
struct WarpUniforms {
  uAlpha:f32,
  uThreshold:f32,
};
@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler : sampler;
@group(1) @binding(0) var<uniform> warpUniforms : WarpUniforms;
struct VSOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv : vec2<f32>
};
@vertex
fn mainVertex(@location(0) aPosition : vec2<f32>) -> VSOutput {
    var position = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;
    position.x = position.x * (2.0 / gfu.uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * gfu.uOutputTexture.z / gfu.uOutputTexture.y) - gfu.uOutputTexture.z;
    return VSOutput(vec4(position, 0.0, 1.0), aPosition * (gfu.uOutputFrame.zw * gfu.uInputSize.zw));
}
@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let c = textureSample(uTexture, uSampler, uv);
    let t = warpUniforms.uThreshold;
    let e = smoothstep(t - 0.05, t + 0.03, c.r);
    let a = e * smoothstep(0.04, 0.45, c.g) * warpUniforms.uAlpha;
    let rim = e * (1.0 - smoothstep(t + 0.03, t + 0.17, c.r));
    var col = mix(vec3<f32>(0.010, 0.0, 0.007), vec3<f32>(0.085, 0.014, 0.034), c.b);
    col += vec3<f32>(0.70, 0.06, 0.03) * rim * 0.75;
    return vec4<f32>(col * a, a * 0.93);
}
`;

function makeMetaballFilter(): Filter {
    return new Filter({
        glProgram: GlProgram.from({ vertex: METABALL_VERT, fragment: METABALL_FRAG, name: 'beacon-warp-metaballs' }),
        gpuProgram: GpuProgram.from({ vertex: { source: METABALL_WGSL, entryPoint: 'mainVertex' }, fragment: { source: METABALL_WGSL, entryPoint: 'mainFragment' } }),
        resources: { warpUniforms: new UniformGroup({ uAlpha: { value: 1, type: 'f32' }, uThreshold: { value: 0.5, type: 'f32' } }) },
        padding: 2,
        antialias: 'off',
    });
}

/** One ship's metaballs: a filtered container of additive sprites (density, mask, swirl), pooled. */
interface MetaSlot {
    root: Container;
    pool: SpritePool;
    filter: Filter;
    used: boolean;
}

// ---------------------------------------------------------------------------------------------------------------
// The layer
// ---------------------------------------------------------------------------------------------------------------

/** A ship's sprite transform (world): position, rotation, world units per frame px, the anchor in frame px. */
interface Xform {
    x: number;
    y: number;
    rot: number;
    sc: number;
    ox: number;
    oy: number;
    px: number;
    file: string;
    seen: number;
}

interface Burst {
    kind: 'enter' | 'exit';
    bo: BuiltObject;
    t0: number;
    xf: Xform;
}

export class BeaconWarpLayer {
    readonly root = new Container();
    private pool = new SpritePool(this.root);
    private shapes = new Map<string, WarpShape | null>();
    private loading = new Set<string>();
    private wisps: { core: Texture[]; edge: Texture[] } | null = null;
    private blob: Texture | null = null;
    private swirl: Texture | null = null;
    private puffs: Texture[] | null = null;
    private slots: MetaSlot[] = [];
    private slotsFailed = false;
    /** The ships that get the full metaballs (the BEACON_WARP_METABALL_SLOTS biggest drawn of those warping), re-ranked
     * only when the set of warping ships changes; this frame's candidates (reused arrays). */
    private full = new Set<BuiltObject>();
    private candBo: BuiltObject[] = [];
    private candPx: number[] = [];
    private candN = 0;
    private candSig = 0;
    private candSigN = -1;
    private rankScratch: number[] = [];
    private steamRoot = new Container();
    private steamPool = new SpritePool(this.steamRoot);
    private last = new WeakMap<BuiltObject, Xform>();
    private bursts: Burst[] = [];
    // the transform being drawn (set per call; no closures per frame)
    private cx = 0;
    private cy = 0;
    private cos = 1;
    private sin = 0;
    private rot = 0;
    private sc = 1;
    private ox = 0;
    private oy = 0;

    constructor(private urlOf: (file: string) => string) {
        this.root.eventMode = 'none';
    }

    /** A free metaball slot for this frame (made on first use, up to BEACON_WARP_METABALL_SLOTS), or null. */
    /** A warping ship this frame that may get the metaballs: a candidate for the ranking; whether it has them now. */
    private wantsFull(bo: BuiltObject, px: number): boolean {
        if (px < BEACON_WARP_METABALL_MIN_PX) return false;
        const i = this.candN++;
        this.candBo[i] = bo;
        this.candPx[i] = px;
        return this.full.has(bo);
    }

    /** Re-ranks the warping ships by drawn size when the set of them changed (a warp started or ended). */
    private rerank(): void {
        let sig = 0;
        for (let i = 0; i < this.candN; i++) sig = (sig + Math.imul(this.candBo[i].builtObjectID | 0, 0x9e3779b1)) | 0;
        if (sig === this.candSig && this.candN === this.candSigN) {
            this.candN = 0;
            return;
        }
        this.candSig = sig;
        this.candSigN = this.candN;
        const idx = this.rankScratch;
        idx.length = 0;
        for (let i = 0; i < this.candN; i++) idx.push(i);
        idx.sort((a, b) => this.candPx[b] - this.candPx[a]);
        this.full.clear();
        for (let k = 0; k < Math.min(BEACON_WARP_METABALL_SLOTS, idx.length); k++) this.full.add(this.candBo[idx[k]]);
        this.candN = 0;
    }

    private slot(): MetaSlot | null {
        if (this.slotsFailed) return null;
        for (const s of this.slots) if (!s.used) return this.take(s);
        if (this.slots.length >= BEACON_WARP_METABALL_SLOTS) return null;
        try {
            const root = new Container();
            const filter = makeMetaballFilter();
            root.filters = [filter];
            root.visible = false;
            this.root.addChild(root);
            const s: MetaSlot = { root, pool: new SpritePool(root), filter, used: false };
            this.slots.push(s);
            return this.take(s);
        } catch {
            this.slotsFailed = true;
            return null;
        }
    }

    private take(s: MetaSlot): MetaSlot {
        s.used = true;
        s.root.visible = true;
        s.pool.begin();
        return s;
    }

    private shape(file: string): WarpShape | null {
        const got = this.shapes.get(file);
        if (got !== undefined) return got;
        if (!this.loading.has(file) && typeof document !== 'undefined') {
            this.loading.add(file);
            const img = new Image();
            img.decoding = 'async';
            img.src = this.urlOf(file);
            void img.decode().then(
                () => {
                    let s: WarpShape | null = null;
                    try {
                        s = makeShape(img, this.shapes.size + 1);
                    } catch {
                        s = null;
                    }
                    this.shapes.set(file, s);
                },
                () => this.shapes.set(file, null),
            );
        }
        return null;
    }

    begin(): void {
        this.pool.begin();
        this.steamPool.begin();
        for (const s of this.slots) s.used = false;
        if (this.steamRoot.parent === null) this.root.addChild(this.steamRoot);
    }

    /** The bursts (they outlive the ship's sprite: a jump-out lingers where it left), then the pool's end. */
    end(): void {
        const ms = warpClockMs();
        // new bursts: on the ship's latest transform (an arrival not drawn yet waits a little for its first frame)
        for (let i = 0; i < pendingBursts.length; i++) {
            const p = pendingBursts[i];
            const xf = this.last.get(p.bo);
            if (xf !== undefined && ms - xf.seen < 500) {
                if (this.bursts.length >= MAX_BURSTS) this.bursts.shift();
                this.bursts.push({ kind: p.kind, bo: p.bo, t0: p.at, xf: { ...xf } });
                pendingBursts.splice(i--, 1);
            } else if (ms - p.at > 1500) pendingBursts.splice(i--, 1);
        }
        let keep = 0;
        for (let i = 0; i < this.bursts.length; i++) {
            const b = this.bursts[i];
            const t = ms - b.t0;
            const len = b.kind === 'enter' ? BEACON_WARP_ENTER_MS : BEACON_WARP_EXIT_MS;
            if (t >= len) continue;
            this.bursts[keep++] = b;
            // follow the ship while it is still drawn; then stay where it was last seen
            const cur = this.last.get(b.bo);
            // (a jump-out stays where the ship was as it jumped: it does not chase it down its warp)
            const chase = b.kind === 'exit' || t < BEACON_WARP_JUMP_AT_MS * 0.9;
            if (chase && cur !== undefined && ms - cur.seen < 120) Object.assign(b.xf, cur);
            this.drawBurst(b, t, ms);
        }
        this.bursts.length = keep;
        this.rerank();
        this.pool.end();
        this.steamPool.end();
        for (const s of this.slots) {
            if (!s.used) {
                s.root.visible = false;
                s.pool.begin();
            }
            s.pool.end();
        }
        // the steam above everything else of the warp
        if (this.root.children[this.root.children.length - 1] !== this.steamRoot) this.root.addChild(this.steamRoot);
    }

    private use(xf: Xform): void {
        this.cx = xf.x;
        this.cy = xf.y;
        this.rot = xf.rot;
        this.cos = Math.cos(xf.rot);
        this.sin = Math.sin(xf.rot);
        this.sc = xf.sc;
        this.ox = xf.ox;
        this.oy = xf.oy;
    }

    /** A sprite at frame px (fx, fy) of the ship being drawn, its anchor (axf, ayf), `w` x `h` frame px, turned `extra`. */
    private put(t: Texture, fx: number, fy: number, axf: number, ayf: number, w: number, h: number, extra: number, alpha: number, blend: 'add' | 'normal', pool: SpritePool = this.pool): Sprite | null {
        if (alpha <= 0.01) return null;
        const s = pool.acquire(t);
        s.blendMode = blend;
        const lx = (fx - this.ox) * this.sc;
        const ly = (fy - this.oy) * this.sc;
        s.position.set(this.cx + lx * this.cos - ly * this.sin, this.cy + lx * this.sin + ly * this.cos);
        s.anchor.set(axf, ayf);
        s.rotation = this.rot + extra;
        s.scale.set((w * this.sc) / (t.width || 1), (h * this.sc) / (t.height || 1));
        s.alpha = Math.min(1, alpha);
        return s;
    }

    /** The rim / shroud over the whole frame, scaled `k` about the frame's centre. */
    private whole(t: Texture, sh: WarpShape, k: number, alpha: number, blend: 'add' | 'normal'): void {
        this.put(t, sh.w / 2, sh.h / 2, 0.5, 0.5, sh.w * k, sh.h * k, 0, alpha, blend);
    }

    /** Dark motes on the outline: `n` of them, each living `life` ms on its own phase, `drift` 0..1 how far it has come
     * in (1: on the hull) or (negative) gone out; `alpha` their darkness. */
    private motes(sh: WarpShape, id: number, n: number, ms: number, life: number, inward: boolean, reach: number, alpha: number, size: number): void {
        if (this.wisps === null) this.wisps = makeWisps(6);
        const W = this.wisps;
        const np = sh.px.length;
        for (let k = 0; k < n; k++) {
            const ph = warpHash(id, k, 7) * life;
            const cyc = Math.floor((ms + ph) / life);
            const u = ((ms + ph) % life) / life;
            const i = Math.floor(warpHash(id, k, cyc) * np);
            // from out in space onto (a little over) the hull, or off it
            const d = ((inward ? 1 - u : u) * 1.3 - 0.3) * reach * (0.5 + warpHash(id, k, cyc + 9));
            const env = Math.sin(Math.PI * u);
            const wisp = warpHash(id, k, cyc + 3) < 0.7;
            const sz = size * (0.6 + 0.8 * warpHash(id, k, cyc + 5));
            const tang = Math.atan2(sh.ny[i], sh.nx[i]) + Math.PI / 2;
            const v = Math.floor(warpHash(id, k, cyc + 13) * W.core.length) % W.core.length;
            const mx = sh.px[i] + sh.nx[i] * d;
            const my = sh.py[i] + sh.ny[i] * d;
            const ww = sz * (wisp ? 2.4 : 1.1);
            const hh = sz * (wisp ? 0.7 : 1.1);
            const turn = wisp ? tang : warpHash(id, k, cyc + 17) * Math.PI * 2;
            this.put(W.core[v], mx, my, 0.5, 0.5, ww, hh, turn, alpha * env, 'normal');
            this.put(W.edge[v], mx, my, 0.5, 0.5, ww, hh, turn, alpha * env * 0.9, 'add');
        }
    }

    /** Slow sparks: `slots` of them, each born on its own beat, lingering `life` ms and fading (`tint`: recoloured). */
    private sparks(sh: WarpShape, id: number, slots: number, ms: number, period: number, alpha: number, tint?: number): void {
        for (let k = 0; k < slots; k++) {
            const per = period * (0.8 + 0.5 * warpHash(id, k, 1));
            const ph = warpHash(id, k, 2) * per;
            const cyc = Math.floor((ms + ph) / per);
            const u = ((ms + ph) % per) / per;
            const live = 0.55 + 0.3 * warpHash(id, k, cyc);
            if (u > live) continue;
            const v = u / live;
            const env = smooth01(0, 0.06, v) * (1 - v) * (0.85 + 0.15 * Math.sin(ms * 0.012 + k));
            const sp = sh.sparks[Math.floor(warpHash(id, k, cyc + 11) * sh.sparks.length) % sh.sparks.length];
            const s = this.put(sp.tex, sp.dx, sp.dy, 0, 0, sp.tex.width, sp.tex.height, 0, alpha * env, 'add');
            if (s !== null && tint !== undefined) s.tint = tint;
        }
    }

    /** The metaballs of one ship (slot `m`): the hull mask, the swirl, then the blobs (`blobs` filled by the caller as
     * x, y, radius triples in frame px), the threshold `thr` and the mass's opacity `alpha`. */
    private metaballs(m: MetaSlot, sh: WarpShape, n: number, ms: number, alpha: number, thr: number): void {
        if (this.blob === null) this.blob = makeBlob();
        if (this.swirl === null) this.swirl = makeSwirl();
        const u = m.filter.resources.warpUniforms.uniforms as { uAlpha: number; uThreshold: number };
        u.uAlpha = Math.min(1, alpha);
        u.uThreshold = thr;
        const near = this.put(sh.near, sh.w / 2, sh.h / 2, 0.5, 0.5, sh.w, sh.h, 0, 1, 'add', m.pool);
        if (near !== null) near.tint = 0x00ff00;
        const big = Math.max(sh.w, sh.h);
        // the slow inner swirl: the noise turned slowly (two layers counter-rotating), its tone in the blue channel
        const sw1 = this.put(this.swirl, sh.w / 2, sh.h / 2, 0.5, 0.5, big * 1.1, big * 1.1, ms * 0.00012, 0.7, 'add', m.pool);
        if (sw1 !== null) sw1.tint = 0x0000ff;
        const sw2 = this.put(this.swirl, sh.w * 0.5, sh.h * 0.55, 0.5, 0.5, big * 0.8, big * 0.8, -ms * 0.00019 + 1.3, 0.35, 'add', m.pool);
        if (sw2 !== null) sw2.tint = 0x0000ff;
        const B = this.blobBuf;
        for (let k = 0; k < n; k++) {
            const r = B[k * 3 + 2];
            if (r <= 0.5) continue;
            const s = this.put(this.blob, B[k * 3], B[k * 3 + 1], 0.5, 0.5, r * 2, r * 2, 0, 1, 'add', m.pool);
            if (s !== null) s.tint = 0xff0000;
        }
    }

    private blobBuf = new Float32Array(3 * 128);

    /** Spooling blobs (charge c 0..1): they creep in from the outline, flow aft over the hull and grow, coalescing; past
     * `merge` (0..1) the axis blobs swell into one mass over most of the ship. Returns the count written. */
    private spoolBlobs(sh: WarpShape, id: number, c: number, ms: number, merge: number): number {
        const B = this.blobBuf;
        const big = Math.max(sh.w, sh.h);
        const np = sh.px.length;
        let n = 0;
        const count = Math.round(46 + 30 * c);
        for (let k = 0; k < count && n < 110; k++) {
            const life = 3200 - 1200 * c;
            const ph = warpHash(id, k, 21) * life;
            const cyc = Math.floor((ms + ph) / life);
            const u = ((ms + ph) % life) / life;
            // born at a point of the outline toward the bow (the frame's top half, mostly), drawn in and aft
            let i = Math.floor(warpHash(id, k, cyc) * np);
            if (sh.py[i] > sh.h * 0.6 && warpHash(id, k, cyc + 1) < 0.6) i = (i + Math.floor(np / 2)) % np;
            const inx = sh.px[i] + (sh.w / 2 - sh.px[i]) * Math.min(1, u * 1.3) * 0.75;
            const iny = sh.py[i] - sh.ny[i] * big * 0.02 + u * big * (0.18 + 0.2 * c);
            const env = Math.sin(Math.PI * Math.min(1, u * 1.15));
            B[n * 3] = inx;
            B[n * 3 + 1] = iny;
            B[n * 3 + 2] = big * (0.017 + 0.027 * c + 0.016 * warpHash(id, k, cyc + 2)) * (0.4 + 0.6 * env);
            n++;
        }
        if (merge > 0) {
            for (let j = 0; j < 9; j++) {
                const t = (j + 0.5) / 9;
                const wob = Math.sin(ms * 0.0013 + j * 1.9) * big * 0.01;
                B[n * 3] = sh.w / 2 + wob;
                B[n * 3 + 1] = sh.h * (0.08 + 0.84 * t);
                B[n * 3 + 2] = big * 0.14 * smooth01(0, 1, merge) * (0.85 + 0.3 * Math.sin(Math.PI * t));
                n++;
            }
        }
        return n;
    }

    /** Arrival blobs at u (0..1 of the arrival's droplet phase): the mass over the ship shrinks and splits into droplets
     * that slide off the hull along its outline's normals, shrink and pinch away. */
    private arriveBlobs(sh: WarpShape, id: number, u: number): number {
        const B = this.blobBuf;
        const big = Math.max(sh.w, sh.h);
        const np = sh.px.length;
        let n = 0;
        const mass = Math.max(0, 1 - u / 0.35);
        for (let j = 0; j < 9; j++) {
            const t = (j + 0.5) / 9;
            B[n * 3] = sh.w / 2;
            B[n * 3 + 1] = sh.h * (0.08 + 0.84 * t);
            B[n * 3 + 2] = big * 0.14 * mass * (0.85 + 0.3 * Math.sin(Math.PI * t));
            n++;
        }
        for (let k = 0; k < 64 && n < 120; k++) {
            const i = Math.floor(warpHash(id, k, 5) * np);
            const t0 = 0.08 + 0.3 * warpHash(id, k, 6);
            const v = Math.max(0, (u - t0) / (1 - t0));
            if (u < t0 * 0.6) continue;
            const slide = (-0.1 + 0.22 * v * v) * big;
            const along = (warpHash(id, k, 7) - 0.3) * 0.08 * big * v;
            B[n * 3] = sh.px[i] + sh.nx[i] * slide;
            B[n * 3 + 1] = sh.py[i] + sh.ny[i] * slide + along;
            B[n * 3 + 2] = big * (0.016 + 0.022 * warpHash(id, k, 8)) * Math.max(0, 1 - v * 1.05) * smooth01(0, 0.15, u - t0 * 0.6);
            n++;
        }
        return n;
    }

    /** The veil's blobs: in from the outline in two layers (so they fill the silhouette, whatever its shape), swelling
     * with `swell`, wobbling slowly so they merge and split like a lava lamp; draining, they shrink and slide out along
     * the outline's normals, off the hull's edges. Returns the count written. */
    private veilBlobs(sh: WarpShape, id: number, swell: number, drain: number, ms: number): number {
        const B = this.blobBuf;
        const big = Math.max(sh.w, sh.h);
        const np = sh.px.length;
        const per = Math.max(1, Math.floor(np / 56));
        let n = 0;
        for (let i = 0, k = 0; i < np && n < 124; i += per, k++) {
            for (let layer = 0; layer < 2 && n < 124; layer++) {
                const depth = big * (layer === 0 ? 0.03 : 0.085) * (0.8 + 0.4 * warpHash(id, k, 30 + layer));
                const lag = warpHash(id, k, 33 + layer) * 0.35;
                const d = Math.max(0, Math.min(1, (drain - lag) / (1 - lag)));
                const slide = big * 0.16 * d * d;
                const wob = Math.sin(ms * 0.0009 + k * 1.7 + layer * 2.3);
                const wob2 = Math.cos(ms * 0.0007 + k * 0.9 + layer);
                const tx = -sh.ny[i];
                const ty = sh.nx[i];
                B[n * 3] = sh.px[i] - sh.nx[i] * (depth - slide) + tx * wob * big * 0.012;
                B[n * 3 + 1] = sh.py[i] - sh.ny[i] * (depth - slide) + ty * wob * big * 0.012;
                B[n * 3 + 2] = big * (0.045 + 0.02 * warpHash(id, k, 36 + layer)) * swell * (0.85 + 0.2 * wob2) * Math.max(0, 1 - d * 1.15);
                n++;
            }
        }
        return n;
    }

    /** The steam of an arrival (t ms after it): pale vapour venting from the seams and the trailing edges, billowing,
     * drifting aft, thinning and fading. */
    private steam(sh: WarpShape, id: number, t: number): void {
        if (this.puffs === null) this.puffs = makePuffs(5);
        const P = this.puffs;
        const big = Math.max(sh.w, sh.h);
        const nv = sh.vx.length;
        for (let k = 0; k < STEAM_PUFFS; k++) {
            const start = 300 + 1500 * warpHash(id, k, 40);
            const life = 1900 + 1300 * warpHash(id, k, 41);
            const v = (t - start) / life;
            if (v <= 0 || v >= 1) continue;
            const i = Math.floor(warpHash(id, k, 42) * nv) % nv;
            const x0 = sh.vx[i];
            const y0 = sh.vy[i];
            // out from the hull's middle a little, and aft (+y in the frame); a slow turbulent wander
            const ox = (x0 - sh.w / 2) / Math.max(1, sh.w / 2);
            const e = 1 - Math.pow(1 - v, 2);
            const wx = Math.sin(v * 5 + k * 2.3) * big * 0.012;
            const x = x0 + ox * big * 0.05 * e + wx;
            const y = y0 + big * (0.035 + 0.06 * warpHash(id, k, 43)) * e;
            const size = big * (0.03 + 0.1 * e) * (0.7 + 0.6 * warpHash(id, k, 44));
            const alpha = smooth01(0, 0.12, v) * Math.pow(1 - v, 1.6) * (0.32 + 0.16 * warpHash(id, k, 45));
            const rot = warpHash(id, k, 46) * 6.28 + v * (warpHash(id, k, 47) - 0.5) * 1.2;
            this.put(P[k % P.length], x, y, 0.5, 0.5, size * 1.25, size, rot, alpha, 'normal', this.steamPool);
        }
    }

    /**
     * A Beacon ship drawn this frame (its sprite transform: position, rotation, world units per frame px, anchor in
     * frame px; `px` its drawn size): remembers its transform and, while its drive spools, draws its warp.
     */
    ship(file: string, bo: BuiltObject, x: number, y: number, rotation: number, scale: number, ox: number, oy: number, px: number): void {
        const ms = warpClockMs();
        let xf = this.last.get(bo);
        if (xf === undefined) {
            xf = { x, y, rot: rotation, sc: scale, ox, oy, px, file, seen: ms };
            this.last.set(bo, xf);
        } else {
            xf.x = x;
            xf.y = y;
            xf.rot = rotation;
            xf.sc = scale;
            xf.ox = ox;
            xf.oy = oy;
            xf.px = px;
            xf.file = file;
            xf.seen = ms;
        }
        const ch = charges.get(bo);
        if (ch === undefined || ms - ch.at > CHARGE_STALE_MS || px < BEACON_WARP_MIN_PX) return;
        const sh = this.shape(file);
        if (sh === null) return;
        // the jump-out burst takes over the last 800 ms
        for (const b of this.bursts) if (b.bo === bo && b.kind === 'enter') return;
        this.use(xf);
        const c = ch.c;
        const id = bo.builtObjectID;
        this.whole(sh.shroud, sh, 1.04 + 0.03 * Math.sin(ms * 0.0021 + id), 0.18 + 0.5 * c, 'normal');
        this.whole(sh.rim, sh, 1.0, 0.12 + 0.5 * c * c, 'add');
        const m = this.wantsFull(bo, px) ? this.slot() : null;
        if (m !== null) {
            this.metaballs(m, sh, this.spoolBlobs(sh, id, c, ms, smooth01(0.82, 1, c) * 0.55), ms, 0.55 + 0.4 * c, 0.5);
            this.sparks(sh, id, 1 + Math.round(c * (SPARK_SLOTS - 1)), ms, 2300 - 700 * c, 0.6 + 0.4 * c);
            return;
        }
        const reach = Math.max(sh.w, sh.h) * 0.07;
        this.motes(sh, id, Math.round(6 + (MOTES_MAX - 6) * c), ms, 1700 - 600 * c, true, reach, 0.5 + 0.4 * c, Math.max(sh.w, sh.h) * 0.075);
        this.sparks(sh, id, 1 + Math.round(c * (SPARK_SLOTS - 1)), ms, 2300 - 700 * c, 0.6 + 0.4 * c);
    }

    /**
     * A Watcher's cloak veil (beaconCloakFx.ts), in the warp's own dark-matter language, as a function of its reveal r
     * (0 cloaked .. 1 shown; a re-cloak runs it backward): over r 0..VEIL_SWELL dark blobs swell up over the silhouette
     * and merge into one mass; past it the mass splits into droplets that peel back and drain off the hull's edges (the
     * hull fading in beneath), fine dark motes drift off and slow violet sparks crawl along the edges and linger. Called
     * after ship() (its transform); the metaballs share the warp's slots and ranking (the biggest drawn ships).
     */
    veil(file: string, bo: BuiltObject, r: number, px: number): void {
        if (r <= 0.002 || r >= 0.998 || px < BEACON_WARP_MIN_PX) return;
        const xf = this.last.get(bo);
        if (xf === undefined) return;
        const sh = this.shape(file);
        if (sh === null) return;
        this.use(xf);
        const ms = warpClockMs();
        const id = bo.builtObjectID + 31;
        const big = Math.max(sh.w, sh.h);
        const swell = smooth01(0, BEACON_VEIL_SWELL, r);
        const drain = r <= BEACON_VEIL_SWELL ? 0 : (r - BEACON_VEIL_SWELL) / (1 - BEACON_VEIL_SWELL);
        const fade = 1 - smooth01(0.82, 1, r);
        this.whole(sh.shroud, sh, 1.03 + 0.02 * Math.sin(ms * 0.0011), 0.5 * swell * fade, 'normal');
        const m = this.wantsFull(bo, px) ? this.slot() : null;
        if (m !== null) {
            this.metaballs(m, sh, this.veilBlobs(sh, id, swell, drain, ms), ms, 0.95 * fade * (0.35 + 0.65 * swell), 0.5);
        } else {
            this.motes(sh, id, Math.round(MOTES_MAX * swell * (1 - drain)), ms, 1500, drain <= 0, big * 0.09, 0.85 * fade, big * 0.08);
        }
        if (drain > 0) this.motes(sh, id + 5, Math.round(MOTES_MAX * (1 - drain)), ms, 1600, false, big * 0.14, 0.6 * (1 - drain), big * 0.045);
        this.sparks(sh, id + 9, SPARK_SLOTS, ms, 2700, (0.45 + 0.55 * Math.sin(Math.PI * r)) * fade, 0xc68cff);
    }

    private drawBurst(b: Burst, t: number, ms: number): void {
        const xf = b.xf;
        if (xf.px < BEACON_WARP_FLASH_MIN_PX) return;
        const sh = this.shape(xf.file);
        if (sh === null) return;
        this.use(xf);
        const id = b.bo.builtObjectID;
        const big = Math.max(sh.w, sh.h);
        const detail = xf.px >= BEACON_WARP_MIN_PX;
        if (b.kind === 'enter') {
            // 0 .. JUMP_AT: the collapse (motes rush in, the shroud deepens); at the jump the rim flares and the shroud
            // implodes; then what is left lingers where the ship was and fades
            const j = BEACON_WARP_JUMP_AT_MS;
            const pre = Math.min(1, t / j);
            const post = Math.max(0, (t - j) / (BEACON_WARP_ENTER_MS - j));
            const flare = Math.exp(-Math.pow((t - j) / 160, 2));
            const implode = t < j ? 1.06 - 0.06 * pre : Math.max(0.35, 1 - 0.75 * Math.sqrt(post));
            this.whole(sh.shroud, sh, implode, (0.7 + 0.25 * pre) * (1 - post), 'normal');
            this.whole(sh.rim, sh, 1.0 + 0.04 * flare, Math.max(0.6 * pre * (1 - post), 1.0 * flare), 'add');
            this.whole(sh.rim, sh, 1.08, 0.55 * flare, 'add');
            if (!detail) return;
            const m = this.wantsFull(b.bo, xf.px) ? this.slot() : null;
            if (m !== null) {
                // the mass swallows most of the ship as the jump comes; then it collapses where the ship was
                const merge = t < j ? 0.55 + 0.45 * pre : Math.max(0, 1 - post * 1.6);
                this.metaballs(m, sh, this.spoolBlobs(sh, id, 1, ms, merge), ms, t < j ? 0.95 : 0.95 * (1 - post), 0.5);
                this.sparks(sh, id + 7, SPARK_SLOTS, ms, 1300, (t < j ? 1 : 1 - post) * 0.95);
                return;
            }
            if (t < j) this.motes(sh, id, MOTES_MAX, ms, 650, true, big * 0.09, 0.9, big * 0.08);
            else this.motes(sh, id + 101, Math.round(MOTES_MAX * (1 - post)), ms, 900, false, big * 0.1 * (1 + post), 0.8 * (1 - post), big * 0.08);
            this.sparks(sh, id + 7, SPARK_SLOTS, ms, 1300, (t < j ? 1 : 1 - post) * 0.95);
        } else {
            // the arrival: the shroud contracts onto the hull with a red flare, the dark mass splits into droplets that
            // slide off (or motes flow off it), sparks linger; then the hull steams
            const u = Math.min(1, t / BEACON_WARP_ARRIVE_MS);
            if (xf.px >= BEACON_WARP_METABALL_MIN_PX) this.steam(sh, id, t);
            const flare = Math.exp(-Math.pow((t - 160) / 170, 2));
            const k = 1 + 0.6 * Math.max(0, 1 - t / 380);
            this.whole(sh.shroud, sh, k, 0.85 * (1 - smooth01(0.15, 1, u)), 'normal');
            this.whole(sh.rim, sh, 1.0, Math.max(flare, 0.45 * (1 - u)), 'add');
            this.whole(sh.rim, sh, 1.1, 0.5 * flare, 'add');
            if (!detail || u >= 1) return;
            const m = this.wantsFull(b.bo, xf.px) ? this.slot() : null;
            if (m !== null) {
                this.metaballs(m, sh, this.arriveBlobs(sh, id, u), ms, 0.95 * (1 - smooth01(0.7, 1, u)), 0.5);
                this.sparks(sh, id + 9, SPARK_SLOTS, ms, 1500, 1 - smooth01(0.4, 1, u));
                return;
            }
            this.motes(sh, id + 203, Math.round(MOTES_MAX * (1 - u)), ms, 1000, false, big * 0.1, 0.85 * (1 - u), big * 0.08);
            this.sparks(sh, id + 9, SPARK_SLOTS, ms, 1500, 1 - smooth01(0.4, 1, u));
        }
    }

    clear(): void {
        this.bursts.length = 0;
    }
}
