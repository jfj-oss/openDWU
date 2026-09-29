// Art pilot (render-only prototype, dev flag `?whalePilot=1`): the "void whale", a huge slow grazer, built two ways
// so its look can be judged next to an original creature frame:
//   A. composited at runtime from pieces of the ORIGINAL creature frames (Kaltor torso + claws, Ardilus dome as
//      head and fluke), recoloured with a colour matrix, re-assembled into our own 12-frame ping-pong schedule and
//      bent along a MeshRope for a slow body undulation. Nothing from the original is written anywhere: the frames
//      are fetched from /assets/dwu/ and composed live into in-memory canvases.
//   B. fully procedural: value-noise skin in the Kaltor frame's own palette (its luminance ramp re-hued to blue-grey),
//      shaded body / fins / fluke drawn once on canvases, bioluminescent spots, soft additive edge glow, the same rope
//      rig for undulation, tail sweep and fin flutter.
// Next to them an original Kaltor is drawn with the original's creature conventions. Nothing here touches the sim
// (no Creature objects, no galaxy.rnd), nothing is pickable, and the layer does not exist without the flag.
//
// Creature draw conventions reused from the original (shared with the real creature layer, creatureLayer.ts):
//   MainView.1.cs:1559-1730 — creatures are drawn only while the zoom factor f < 500 and the camera is within
//     Galaxy.MaxSolarSystemSize + 5000 of the system; culled 50 px outside the viewport; moving creatures animate
//     at 10 fps (method_113 frame schedule), stationary ones show frame 0.
//   Main.Part13.cs:2041-2056 LoadCreatures — frames loaded at imageScale 0.5 × 0.6, rotated 90° clockwise
//     (raw PNGs face up); the content pixel count of frame 0 (method_8) is the creature's reference size.
//   Main.Part12.cs:4804 PrepareCreatureImage — scaled by sqrt(Size / (content / CreatureDrawResizeFactor 8)).
//   Main.Part11.cs:475 CalculateCreatureZoomFactor — divisor max(3, f / 2) above f = 3, width capped at 240 / f.

import { Container, MeshRope, Point, Sprite, Texture } from 'pixi.js';
import type { Camera } from './camera';
import { useMinifyingFilter } from './assets';
import type { Galaxy } from '../sim/galaxy';
import type { Habitat } from '../sim/types';
import { drawnPositionOf, type MotionInterpolator, type Point as DrawnPoint } from './renderInterp';
import {
    CREATURE_DIR,
    CREATURE_FPS,
    CREATURE_FRAME_SIDE,
    CREATURE_IMAGE_SCALE,
    CREATURE_MAX_FACTOR,
    creatureContentPixels,
    creatureDrawPx,
    creatureFrameIndex,
    creatureZoomFactor,
} from './creatureLayer';
import { artStats, fbm, makeValueNoise, roundStats, smoothstep, type ArtStats } from './creatureRig';

// The shared creature rules live in creatureLayer.ts, the statistics / noise in creatureRig.ts; re-exported for the
// pilot's tests / capture script.
export { artStats, creatureDrawPx, creatureFrameIndex, creatureZoomFactor };
export type { ArtStats };

/** Galaxy.MaxSolarSystemSize (sim/galaxy.ts). */
const MAX_SOLAR_SYSTEM_SIZE = 23000;
/** Pilot Kaltor size: middle of Creature ctor's rnd.Next(80, 190). */
export const PILOT_KALTOR_SIZE = 135;
/** The whale is ~3 × a Kaltor in length (PrepareCreatureImage's sqrt(size) ⇒ 9 × the size). */
export const WHALE_LENGTH_MUL = 3;

export function whalePilotEnabled(search: string): boolean {
    return new URLSearchParams(search).get('whalePilot') === '1';
}

/**
 * 4 × 5 colour matrix (Pixi ColorMatrixFilter layout, offsets in 0..1) that keeps `keep` of each pixel's chroma and
 * re-tints its Rec.709 luma by `tint` (normalised to unit luma) × `gain`.
 */
export function tintMatrix(tint: [number, number, number], keep: number, gain: number): number[] {
    const wl = [0.2126, 0.7152, 0.0722];
    const tl = tint[0] * wl[0] + tint[1] * wl[1] + tint[2] * wl[2];
    const m: number[] = [];
    for (let c = 0; c < 3; c++) {
        const t = (tint[c] / tl) * gain;
        for (let k = 0; k < 3; k++) m.push((c === k ? keep : 0) + (t - keep) * wl[k]);
        m.push(0, 0);
    }
    m.push(0, 0, 0, 1, 0);
    return m;
}

function applyColorMatrix(ctx: CanvasRenderingContext2D, w: number, h: number, m: number[]): void {
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];
        const a = d[i + 3];
        d[i] = m[0] * r + m[1] * g + m[2] * b + m[3] * a + m[4] * 255;
        d[i + 1] = m[5] * r + m[6] * g + m[7] * b + m[8] * a + m[9] * 255;
        d[i + 2] = m[10] * r + m[11] * g + m[12] * b + m[13] * a + m[14] * 255;
    }
    ctx.putImageData(img, 0, 0);
}

// ---------------------------------------------------------------------------
// Canvas helpers.

function canvas2d(w: number, h: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (ctx === null) throw new Error('whalePilot: no 2d context');
    return { c, ctx };
}

function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`whalePilot: cannot load ${url}`));
        img.src = url;
    });
}

function frameUrls(folder: string, prefix: string, count: number): string[] {
    const out: string[] = [];
    for (let i = 0; i < count; i++) out.push(`${CREATURE_DIR}/${folder}/${prefix}${String(i).padStart(5, '0')}.png`);
    return out;
}

function imagePixels(img: CanvasImageSource, w: number, h: number): Uint8ClampedArray {
    const { ctx } = canvas2d(w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h).data;
}

/** Main.Part13.cs:624 method_8: pixels with alpha > 0 that are not black / transparent black / transparent white. */
function contentPixels(img: CanvasImageSource): number {
    const side = Math.trunc(CREATURE_FRAME_SIDE * CREATURE_IMAGE_SCALE);
    return creatureContentPixels(imagePixels(img, side, side));
}

/** Crop a piece of a frame and feather the cut edges (alpha ramps `feather` px wide on the given sides). */
function cropPiece(
    img: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    feather: { top?: number; bottom?: number; left?: number; right?: number },
): HTMLCanvasElement {
    const { c, ctx } = canvas2d(sw, sh);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    ctx.globalCompositeOperation = 'destination-out';
    const ramp = (x0: number, y0: number, x1: number, y1: number, rx: number, ry: number, rw: number, rh: number): void => {
        const g = ctx.createLinearGradient(x0, y0, x1, y1);
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(rx, ry, rw, rh);
    };
    if (feather.top) ramp(0, 0, 0, feather.top, 0, 0, sw, feather.top);
    if (feather.bottom) ramp(0, sh, 0, sh - feather.bottom, 0, sh - feather.bottom, sw, feather.bottom);
    if (feather.left) ramp(0, 0, feather.left, 0, 0, 0, feather.left, sh);
    if (feather.right) ramp(sw, 0, sw - feather.right, 0, sw - feather.right, 0, feather.right, sh);
    ctx.globalCompositeOperation = 'source-over';
    return c;
}

/**
 * Draw a piece whose "up" is the creature's front so that it points along +x (dir 1) or −x (dir −1), centred at
 * (cx, cy): `len` along x (the piece's height), `wid` along y (the piece's width).
 */
function drawAlong(ctx: CanvasRenderingContext2D, piece: CanvasImageSource, cx: number, cy: number, len: number, wid: number, dir: 1 | -1): void {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((dir * Math.PI) / 2);
    ctx.drawImage(piece, -wid / 2, -len / 2, wid, len);
    ctx.restore();
}

/**
 * The Kaltor frame's own colours as a 32-step luminance ramp (mean colour per luma bin of the opaque pixels), each
 * step re-hued to `hueDeg` with its saturation × `satMul` and its luma kept.
 */
function rehuedRamp(data: ArrayLike<number>, hueDeg: number, satMul: number): [number, number, number][] {
    const bins = 32;
    const acc = Array.from({ length: bins }, () => [0, 0, 0, 0]);
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue;
        const r = data[i] / 255;
        const g = data[i + 1] / 255;
        const b = data[i + 2] / 255;
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const k = Math.min(bins - 1, Math.floor(l * bins));
        acc[k][0] += r;
        acc[k][1] += g;
        acc[k][2] += b;
        acc[k][3]++;
    }
    // Pure-hue RGB at full saturation / value.
    const hh = (hueDeg / 60) % 6;
    const x = 1 - Math.abs((hh % 2) - 1);
    const hueRgb: [number, number, number] =
        hh < 1 ? [1, x, 0] : hh < 2 ? [x, 1, 0] : hh < 3 ? [0, 1, x] : hh < 4 ? [0, x, 1] : hh < 5 ? [x, 0, 1] : [1, 0, x];
    const out: [number, number, number][] = [];
    for (let k = 0; k < bins; k++) {
        const [r, g, b, n] = acc[k];
        const lum = n > 0 ? (0.2126 * r + 0.7152 * g + 0.0722 * b) / n : (k + 0.5) / bins;
        let sat = 0;
        if (n > 0) {
            const mx = Math.max(r, g, b) / n;
            sat = mx > 0 ? (mx - Math.min(r, g, b) / n) / mx : 0;
        }
        sat = Math.min(1, sat * satMul);
        const base = hueRgb.map((c) => 1 - sat + sat * c) as [number, number, number];
        const baseL = 0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2];
        const v = Math.min(1 / Math.max(...base), lum / baseL);
        out.push([base[0] * v * 255, base[1] * v * 255, base[2] * v * 255]);
    }
    return out;
}

// ---------------------------------------------------------------------------
// The whale rig: a MeshRope body (head along +x), two flutter fins, a sweeping fluke, optional glow and spots.

/** Rope texture size (px) shared by both techniques. */
const BODY_W = 512;
const BODY_H = 192;
const ROPE_POINTS = 24;

interface WhaleSkin {
    name: string;
    bodyFrames: Texture[];
    /** Body frame to show at time t (s). */
    frameAt: (t: number) => number;
    fin: Texture;
    /** Fin root as a texture-uv anchor. */
    finAnchor: [number, number];
    fluke: Texture;
    flukeAnchor: [number, number];
    glow: Texture | null;
    spotTex: Texture | null;
    /** Spots in body uv: u along the body (0 tail … 1 head), v across (−1 … 1). */
    spots: { u: number; v: number; r: number; phase: number }[];
    /** Rest pose canvas (for the statistics), drawn once; `restSkin` without the glow / spots (null = same). */
    rest: HTMLCanvasElement;
    restSkin: HTMLCanvasElement | null;
}

/** Fin placement along the body (u) and across it (fraction of half-height). */
const FIN_U = 0.64;
const FIN_V = 0.42;
const FIN_SWEEP = 0.62;

function bodyHalfWidth(u: number): number {
    // Blunt head (u > 0.62), tapering to a narrow tail stalk.
    if (u >= 0.62) return Math.sqrt(Math.max(0, 1 - Math.pow((u - 0.62) / 0.38, 2.6)));
    const t = u / 0.62;
    return 0.2 + 0.8 * Math.pow(t * t * (3 - 2 * t), 0.9);
}

class WhaleRig {
    root = new Container();
    private points: Point[] = [];
    private body: MeshRope;
    private glowRope: MeshRope | null = null;
    private finL: Sprite;
    private finR: Sprite;
    private fluke: Sprite;
    private spotSprites: Sprite[] = [];

    constructor(private skin: WhaleSkin, private phase: number) {
        this.root.eventMode = 'none';
        for (let i = 0; i < ROPE_POINTS; i++) this.points.push(new Point(((i / (ROPE_POINTS - 1)) - 0.5) * BODY_W, 0));
        if (skin.glow !== null) {
            this.glowRope = new MeshRope({ texture: skin.glow, points: this.points });
            this.glowRope.blendMode = 'add';
            this.root.addChild(this.glowRope);
        }
        this.fluke = new Sprite(skin.fluke);
        this.fluke.anchor.set(skin.flukeAnchor[0], skin.flukeAnchor[1]);
        this.finL = new Sprite(skin.fin);
        this.finL.anchor.set(skin.finAnchor[0], skin.finAnchor[1]);
        this.finR = new Sprite(skin.fin);
        this.finR.anchor.set(skin.finAnchor[0], skin.finAnchor[1]);
        this.finR.scale.y = -1;
        this.root.addChild(this.fluke, this.finL, this.finR);
        this.body = new MeshRope({ texture: skin.bodyFrames[0], points: this.points });
        this.root.addChild(this.body);
        if (skin.spotTex !== null) {
            for (const s of skin.spots) {
                const sp = new Sprite(skin.spotTex);
                sp.anchor.set(0.5);
                sp.blendMode = 'add';
                sp.scale.set((s.r * 2) / skin.spotTex.width);
                this.spotSprites.push(sp);
                this.root.addChild(sp);
            }
        }
    }

    /** Pose the rig at time t (s): travelling body wave, tail sweep, fin flutter, spot pulse. */
    pose(t: number): void {
        const w = (2 * Math.PI) / 7.5; // one slow body wave every 7.5 s
        const ph = this.phase;
        for (let i = 0; i < ROPE_POINTS; i++) {
            const u = i / (ROPE_POINTS - 1);
            const env = Math.pow(1 - u, 1.7) * 0.16 + 0.015;
            const y = BODY_H * env * Math.sin(2 * Math.PI * 0.85 * u - w * t + ph);
            this.points[i].set((u - 0.5) * BODY_W, y);
        }
        const tex = this.skin.bodyFrames[this.skin.frameAt(t + ph)];
        if (this.body.texture !== tex) this.body.texture = tex;
        // Tail fluke: follows the tail tangent plus its own lagging sweep.
        const p0 = this.points[0];
        const p1 = this.points[1];
        const tail = Math.atan2(p1.y - p0.y, p1.x - p0.x);
        this.fluke.position.set(p0.x + Math.cos(tail) * 10, p0.y + Math.sin(tail) * 10);
        this.fluke.rotation = tail + 0.22 * Math.sin(-w * t + ph - 1.1);
        // Fins at FIN_U on the body normal.
        const fi = FIN_U * (ROPE_POINTS - 1);
        const i0 = Math.floor(fi);
        const a = this.points[i0];
        const b = this.points[i0 + 1];
        const k = fi - i0;
        const px = a.x + (b.x - a.x) * k;
        const py = a.y + (b.y - a.y) * k;
        const th = Math.atan2(b.y - a.y, b.x - a.x);
        const off = (BODY_H / 2) * FIN_V * bodyHalfWidth(FIN_U);
        const nx = -Math.sin(th);
        const ny = Math.cos(th);
        const flutter = 2 * Math.PI * 0.35;
        this.finL.position.set(px - nx * off, py - ny * off);
        this.finL.rotation = th - Math.PI / 2 - (FIN_SWEEP + 0.16 * Math.sin(flutter * t + ph));
        this.finR.position.set(px + nx * off, py + ny * off);
        this.finR.rotation = th + Math.PI / 2 + (FIN_SWEEP + 0.16 * Math.sin(flutter * t + ph + 2.2));
        // Bioluminescent spots ride the body and pulse slowly.
        for (let s = 0; s < this.spotSprites.length; s++) {
            const spot = this.skin.spots[s];
            const si = spot.u * (ROPE_POINTS - 1);
            const j = Math.min(ROPE_POINTS - 2, Math.floor(si));
            const q0 = this.points[j];
            const q1 = this.points[j + 1];
            const kk = si - j;
            const ang = Math.atan2(q1.y - q0.y, q1.x - q0.x);
            const d = (BODY_H / 2) * spot.v * bodyHalfWidth(spot.u);
            const sp = this.spotSprites[s];
            sp.position.set(q0.x + (q1.x - q0.x) * kk - Math.sin(ang) * d, q0.y + (q1.y - q0.y) * kk + Math.cos(ang) * d);
            sp.alpha = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 1.3 + spot.phase));
        }
    }
}

/** Rest pose of a skin on one canvas (fluke, fins, body frame 0, glow / spots) for the statistics. */
function drawRestPose(
    body: CanvasImageSource,
    fin: HTMLCanvasElement,
    finAnchor: [number, number],
    fluke: HTMLCanvasElement,
    flukeAnchor: [number, number],
    glow: HTMLCanvasElement | null,
    spots: { u: number; v: number; r: number }[],
    spot: HTMLCanvasElement | null,
): HTMLCanvasElement {
    const padX = fluke.width;
    const padY = fin.width;
    const W = BODY_W + padX + 8;
    const H = BODY_H + padY * 2;
    const { c, ctx } = canvas2d(W, H);
    const ox = padX;
    const oy = padY + BODY_H / 2;
    const place = (img: HTMLCanvasElement, anchor: [number, number], x: number, y: number, rot: number, flipY: boolean): void => {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rot);
        if (flipY) ctx.scale(1, -1);
        ctx.drawImage(img, -anchor[0] * img.width, -anchor[1] * img.height);
        ctx.restore();
    };
    if (glow !== null) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(glow, ox, oy - glow.height / 2);
        ctx.globalCompositeOperation = 'source-over';
    }
    place(fluke, flukeAnchor, ox + 10, oy, 0, false);
    const fx = ox + FIN_U * BODY_W;
    const off = (BODY_H / 2) * FIN_V * bodyHalfWidth(FIN_U);
    place(fin, finAnchor, fx, oy - off, -Math.PI / 2 - FIN_SWEEP, false);
    place(fin, finAnchor, fx, oy + off, Math.PI / 2 + FIN_SWEEP, true);
    ctx.drawImage(body, ox, oy - BODY_H / 2);
    if (spot !== null) {
        ctx.globalCompositeOperation = 'lighter';
        for (const s of spots) {
            const x = ox + s.u * BODY_W;
            const y = oy + (BODY_H / 2) * s.v * bodyHalfWidth(s.u);
            ctx.globalAlpha = 0.67;
            ctx.drawImage(spot, x - s.r, y - s.r, s.r * 2, s.r * 2);
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
    }
    return c;
}

function canvasTexture(c: HTMLCanvasElement): Texture {
    const t = Texture.from(c);
    useMinifyingFilter(t);
    return t;
}

// ---------------------------------------------------------------------------
// Technique A: runtime composite of the original frames.

/** Blue-grey retint of the composite (luma tint, share of the original chroma kept). */
const WHALE_A_TINT: [number, number, number] = [0.8, 0.92, 1.22];
const WHALE_A_KEEP = 0.12;
/** Luma contrast of the retint around the target mean (the blue tint alone flattens the Kaltor's value spread). */
const WHALE_A_CONTRAST = 1.2;

/** Scale a colour matrix's contrast by `c` around the grey level `pivot` (0..1). */
function withContrast(m: number[], c: number, pivot: number): number[] {
    const out = m.slice();
    for (let row = 0; row < 3; row++) {
        for (let k = 0; k < 3; k++) out[row * 5 + k] *= c;
        out[row * 5 + 4] += pivot * (1 - c);
    }
    return out;
}

/** Our own frame schedule: 12 composite frames played ping-pong at 5 fps (half the original's 10 fps loop). */
function pingPongFrame(t: number, count: number, fps: number): number {
    const period = 2 * (count - 1);
    const k = Math.floor(Math.max(0, t) * fps) % period;
    return k < count ? k : period - k;
}

function buildCompositeSkin(kaltor: HTMLImageElement[], ardilus: HTMLImageElement[], target: ArtStats): WhaleSkin {
    const compose = (i: number): HTMLCanvasElement => {
        const { c, ctx } = canvas2d(BODY_W, BODY_H);
        // Torso: the Kaltor's segmented body and tail (its claws cut off), stretched to the whale's length.
        const torso = cropPiece(kaltor[i % kaltor.length], 95, 105, 170, 245, { top: 26, bottom: 10 });
        drawAlong(ctx, torso, BODY_W * 0.4, BODY_H / 2, BODY_W * 0.78, BODY_H * 0.98, 1);
        // Head: the Ardilus dome, turned to lead, over the Kaltor neck.
        const head = cropPiece(ardilus[i % ardilus.length], 95, 8, 170, 74, { bottom: 22 });
        drawAlong(ctx, head, BODY_W * 0.855, BODY_H / 2, BODY_W * 0.27, BODY_H * 0.76, 1);
        return c;
    };
    const raw = compose(0);
    // Tune the matrix gain once so the recoloured whale sits at 0.88 × the Kaltor's mean luma ("dark").
    const probe = canvas2d(BODY_W, BODY_H);
    probe.ctx.drawImage(raw, 0, 0);
    applyColorMatrix(probe.ctx, BODY_W, BODY_H, tintMatrix(WHALE_A_TINT, WHALE_A_KEEP, 1));
    const probeStats = artStats(probe.ctx.getImageData(0, 0, BODY_W, BODY_H).data, BODY_W, BODY_H);
    const targetL = target.meanL * 0.88;
    const gain = probeStats.meanL > 0 ? targetL / probeStats.meanL : 1;
    const matrix = withContrast(tintMatrix(WHALE_A_TINT, WHALE_A_KEEP, gain), WHALE_A_CONTRAST, targetL);
    const bodies: HTMLCanvasElement[] = [];
    for (let i = 0; i < 12; i++) {
        const c = i === 0 ? raw : compose(i);
        applyColorMatrix(c.getContext('2d')!, BODY_W, BODY_H, matrix);
        bodies.push(c);
    }
    // Pectoral fins: the Kaltor's left claw, root inwards, tip outwards (+x).
    const finC = canvas2d(128, 76);
    const claw = cropPiece(kaltor[0], 58, 18, 80, 106, { bottom: 18 });
    drawAlong(finC.ctx, claw, 64, 38, 124, 72, 1);
    applyColorMatrix(finC.ctx, 128, 76, matrix);
    // Fluke: a second Ardilus dome, flattened and turned to trail.
    const flukeC = canvas2d(84, 210);
    const dome = cropPiece(ardilus[0], 95, 8, 170, 74, { bottom: 22 });
    drawAlong(flukeC.ctx, dome, 42, 105, 82, 206, -1);
    applyColorMatrix(flukeC.ctx, 84, 210, matrix);
    const finAnchor: [number, number] = [0.08, 0.5];
    const flukeAnchor: [number, number] = [0.92, 0.5];
    return {
        name: 'A (composite)',
        bodyFrames: bodies.map(canvasTexture),
        frameAt: (t) => pingPongFrame(t, 12, 5),
        fin: canvasTexture(finC.c),
        finAnchor,
        fluke: canvasTexture(flukeC.c),
        flukeAnchor,
        glow: null,
        spotTex: null,
        spots: [],
        rest: drawRestPose(bodies[0], finC.c, finAnchor, flukeC.c, flukeAnchor, null, [], null),
        restSkin: null,
    };
}

// ---------------------------------------------------------------------------
// Technique B: procedural skin in the Kaltor's palette.

const WHALE_B_HUE = 212;
const WHALE_B_SAT_MUL = 1.1;
/** The whale sits a little darker than the Kaltor: its luma quantiles are the Kaltor's × this. */
const WHALE_B_LUMA_MUL = 0.9;

function buildProceduralSkin(kaltorData: Uint8ClampedArray, target: ArtStats): WhaleSkin {
    const ramp = rehuedRamp(kaltorData, WHALE_B_HUE, WHALE_B_SAT_MUL);
    const noise = makeValueNoise(7);
    const noise2 = makeValueNoise(19);
    // Kaltor's edge softness carried over: alpha ramp width = its edge-width fraction × the whale's length.
    const edgePx = Math.max(1.5, target.edgeWidthFrac * BODY_W);
    // The Kaltor's opaque luma distribution (sorted), for histogram matching the shading.
    const kLuma: number[] = [];
    for (let i = 0; i < kaltorData.length; i += 4) {
        if (kaltorData[i + 3] < 128) continue;
        kLuma.push((0.2126 * kaltorData[i] + 0.7152 * kaltorData[i + 1] + 0.0722 * kaltorData[i + 2]) / 255);
    }
    kLuma.sort((p, q) => p - q);
    const KNOTS = 64;
    const sKnots: number[] = [];
    const lKnots: number[] = [];
    // Shading value → luma (quantile-matched to the Kaltor once the body's shading field is known) → ramp colour.
    const shade = (s: number): [number, number, number] => {
        let lum = s;
        if (sKnots.length > 0) {
            if (s <= sKnots[0]) lum = lKnots[0];
            else if (s >= sKnots[KNOTS - 1]) lum = lKnots[KNOTS - 1];
            else {
                let k = 1;
                while (sKnots[k] < s) k++;
                const t = (s - sKnots[k - 1]) / Math.max(1e-9, sKnots[k] - sKnots[k - 1]);
                lum = lKnots[k - 1] + (lKnots[k] - lKnots[k - 1]) * t;
            }
        }
        return ramp[Math.max(0, Math.min(31, Math.floor(lum * 32)))];
    };

    // Body.
    const body = canvas2d(BODY_W, BODY_H);
    const bImg = body.ctx.createImageData(BODY_W, BODY_H);
    const maxHalf = BODY_H * 0.47;
    const sField = new Float32Array(BODY_W * BODY_H);
    const aField = new Float32Array(BODY_W * BODY_H);
    for (let y = 0; y < BODY_H; y++) {
        for (let x = 0; x < BODY_W; x++) {
            const u = (x + 0.5) / BODY_W;
            const hw = bodyHalfWidth(u) * maxHalf;
            if (hw <= 0.5) continue;
            const dy = y + 0.5 - BODY_H / 2;
            const dist = hw - Math.abs(dy); // px inside the silhouette edge
            // Soft nose / tail ends as well.
            const endDist = Math.min(x + 0.5, BODY_W - x - 0.5) + 2;
            const alpha = smoothstep(0, edgePx, Math.min(dist, endDist));
            if (alpha <= 0) continue;
            const v = dy / hw;
            let s = 0.1 + 0.5 * Math.pow(Math.max(0, 1 - v * v), 0.7); // rounded back, dark flanks
            s += 0.12 * Math.exp(-Math.pow(v / 0.1, 2)) * smoothstep(0.1, 0.4, u) * (1 - smoothstep(0.8, 0.95, u)); // spine
            // Ventral-style grooves across the mid body and plate lines on the head.
            s -= 0.07 * Math.pow(0.5 + 0.5 * Math.cos(2 * Math.PI * u * 18), 3) * smoothstep(0.2, 0.3, u) * (1 - smoothstep(0.6, 0.7, u));
            s -= 0.05 * Math.pow(0.5 + 0.5 * Math.cos(2 * Math.PI * (Math.abs(v) * 1.5 + u * 4)), 6) * smoothstep(0.65, 0.8, u);
            const n = fbm(noise, x / 22, y / 22, 4);
            const m = fbm(noise2, x / 80, y / 60, 3);
            s *= 0.72 + 0.46 * n;
            s += 0.12 * (m - 0.5);
            s += 0.1 * Math.exp(-Math.pow((1 - Math.abs(v)) / 0.08, 2)) * smoothstep(0.15, 0.4, u); // faint rim light
            sField[y * BODY_W + x] = s;
            aField[y * BODY_W + x] = alpha;
        }
    }
    // Histogram match: the body's shading quantiles map onto the Kaltor's luma quantiles (× WHALE_B_LUMA_MUL).
    const sVals: number[] = [];
    for (let i = 0; i < sField.length; i++) if (aField[i] >= 0.5) sVals.push(sField[i]);
    sVals.sort((p, q) => p - q);
    for (let k = 0; k < KNOTS; k++) {
        const q = k / (KNOTS - 1);
        sKnots.push(sVals[Math.min(sVals.length - 1, Math.floor(q * sVals.length))] + k * 1e-7);
        lKnots.push(kLuma[Math.min(kLuma.length - 1, Math.floor(q * kLuma.length))] * WHALE_B_LUMA_MUL);
    }
    for (let i = 0; i < sField.length; i++) {
        if (aField[i] <= 0) continue;
        const [r, g, b] = shade(sField[i]);
        bImg.data[i * 4] = r;
        bImg.data[i * 4 + 1] = g;
        bImg.data[i * 4 + 2] = b;
        bImg.data[i * 4 + 3] = aField[i] * 255;
    }
    body.ctx.putImageData(bImg, 0, 0);

    // Glow: the silhouette, blurred, pale cyan, in a taller rope texture (same length) drawn additively.
    const glowH = Math.round(BODY_H * 1.45);
    const glow = canvas2d(BODY_W, glowH);
    const sil = canvas2d(BODY_W, BODY_H);
    sil.ctx.fillStyle = 'rgb(70,140,190)';
    sil.ctx.beginPath();
    for (let x = 0; x <= BODY_W; x += 4) sil.ctx.lineTo(x, BODY_H / 2 - bodyHalfWidth(x / BODY_W) * maxHalf);
    for (let x = BODY_W; x >= 0; x -= 4) sil.ctx.lineTo(x, BODY_H / 2 + bodyHalfWidth(x / BODY_W) * maxHalf);
    sil.ctx.fill();
    glow.ctx.filter = 'blur(12px)';
    glow.ctx.globalAlpha = 0.32;
    glow.ctx.drawImage(sil.c, 0, (glowH - BODY_H) / 2);
    glow.ctx.filter = 'none';
    glow.ctx.globalAlpha = 1;

    // Fin: a swept leaf, root at the left, membrane fringe on the trailing side.
    const FW = 128;
    const FH = 76;
    const fin = canvas2d(FW, FH);
    const fImg = fin.ctx.createImageData(FW, FH);
    for (let y = 0; y < FH; y++) {
        for (let x = 0; x < FW; x++) {
            const u = (x + 0.5) / FW;
            const half = (FH / 2) * 0.92 * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.62)), 0.85);
            const dy = y + 0.5 - FH / 2 - 6 * u * u; // tip curls slightly
            const dist = half - Math.abs(dy);
            const a = smoothstep(0, edgePx, dist) * (1 - smoothstep(0.88, 1, u));
            if (a <= 0) continue;
            const v = dy / Math.max(1, half);
            let s = 0.14 + 0.36 * Math.pow(Math.max(0, 1 - v * v), 0.8) * (1 - 0.5 * u);
            s += 0.06 * Math.pow(0.5 + 0.5 * Math.cos(2 * Math.PI * (u * 5 + v * 0.6)), 4); // fin rays
            s *= 0.75 + 0.45 * fbm(noise, x / 14 + 40, y / 14, 3);
            const membrane = v > 0.5 ? 1 - 0.3 * smoothstep(0.5, 1, v) : 1;
            const [r, g, b] = shade(s);
            const i = (y * FW + x) * 4;
            fImg.data[i] = r;
            fImg.data[i + 1] = g;
            fImg.data[i + 2] = b;
            fImg.data[i + 3] = a * membrane * 255;
        }
    }
    fin.ctx.putImageData(fImg, 0, 0);

    // Fluke: two swept lobes from a root at the right edge.
    const KW = 96;
    const KH = 216;
    const fluke = canvas2d(KW, KH);
    const kImg = fluke.ctx.createImageData(KW, KH);
    for (let y = 0; y < KH; y++) {
        const yy = Math.abs(y + 0.5 - KH / 2) / (KH / 2); // 0 centre … 1 tip
        const lead = KW * (0.97 - 0.62 * Math.pow(yy, 1.6));
        const thick = KW * (0.34 * Math.exp(-Math.pow(yy / 0.22, 2)) + 0.42 * Math.pow(Math.sin(Math.PI * Math.min(1, yy / 0.97)), 0.9));
        const trail = lead - thick;
        for (let x = 0; x < KW; x++) {
            const xc = x + 0.5;
            const dist = Math.min(lead - xc, xc - trail, (0.97 - yy) * KH * 0.5);
            const a = smoothstep(0, edgePx, dist);
            if (a <= 0) continue;
            const across = thick > 0 ? (xc - trail) / thick : 0.5; // 0 trailing … 1 leading edge
            let s = 0.12 + 0.34 * Math.sin(Math.PI * Math.pow(across, 0.7)) * (1 - 0.5 * yy);
            s *= 0.75 + 0.45 * fbm(noise2, x / 14, y / 14 + 30, 3);
            const [r, g, b] = shade(s);
            const i = (y * KW + x) * 4;
            kImg.data[i] = r;
            kImg.data[i + 1] = g;
            kImg.data[i + 2] = b;
            kImg.data[i + 3] = a * 255;
        }
    }
    fluke.ctx.putImageData(kImg, 0, 0);

    // Bioluminescent spots: two flank rows plus a few on the head.
    const spot = canvas2d(32, 32);
    const grad = spot.ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(210,245,255,1)');
    grad.addColorStop(0.25, 'rgba(110,210,255,0.8)');
    grad.addColorStop(1, 'rgba(40,120,220,0)');
    spot.ctx.fillStyle = grad;
    spot.ctx.fillRect(0, 0, 32, 32);
    const spots: { u: number; v: number; r: number; phase: number }[] = [];
    for (let k = 0; k < 11; k++) {
        const u = 0.2 + k * 0.058;
        for (const side of [-1, 1]) spots.push({ u, v: side * (0.6 - 0.1 * Math.sin(k)), r: 4 + (k % 3), phase: k * 1.7 + (side > 0 ? 0.9 : 0) });
    }
    for (const [u, v] of [[0.86, -0.3], [0.86, 0.3], [0.92, 0]] as const) spots.push({ u, v, r: 5, phase: u * 9 + v });

    const finAnchor: [number, number] = [0.04, 0.5];
    const flukeAnchor: [number, number] = [0.97, 0.5];
    const bodyTex = canvasTexture(body.c);
    return {
        name: 'B (procedural)',
        bodyFrames: [bodyTex],
        frameAt: () => 0,
        fin: canvasTexture(fin.c),
        finAnchor,
        fluke: canvasTexture(fluke.c),
        flukeAnchor,
        glow: canvasTexture(glow.c),
        spotTex: canvasTexture(spot.c),
        spots,
        rest: drawRestPose(body.c, fin.c, finAnchor, fluke.c, flukeAnchor, glow.c, spots, spot.c),
        restSkin: drawRestPose(body.c, fin.c, finAnchor, fluke.c, flukeAnchor, null, [], null),
    };
}

// ---------------------------------------------------------------------------
// The layer.

/** Placement of one pilot creature: a slow circle around (ax, ay). */
/** Where a pilot actor circles: its anchor as an offset from the home planet, the circle radius, the angular speed
 * (rad/s) and the start angle. */
export interface PilotOrbit {
    ox: number;
    oy: number;
    radius: number;
    omega: number;
    angle0: number;
}

/**
 * A pilot actor's position / heading at pilot time `t` (s) around the home planet drawn at (homeX, homeY) — the
 * render-interpolated orbit position (renderInterp.ts), so the actors ride along with the drawn planet instead of
 * staying where the planet was when the pilot started. Writes `out` and returns it.
 */
export function pilotActorPlacement(homeX: number, homeY: number, a: PilotOrbit, t: number, out: { x: number; y: number; heading: number }): { x: number; y: number; heading: number } {
    const ang = a.angle0 + a.omega * t;
    out.x = homeX + a.ox + Math.cos(ang) * a.radius;
    out.y = homeY + a.oy + Math.sin(ang) * a.radius;
    out.heading = ang + (a.omega >= 0 ? Math.PI / 2 : -Math.PI / 2);
    return out;
}

interface PilotActor extends PilotOrbit {
    kind: 'kaltor' | 'whaleA' | 'whaleB';
    /** The anchor this frame (home drawn position + offset). */
    ax: number;
    ay: number;
    x: number;
    y: number;
    heading: number;
    rig: WhaleRig | null;
    sprite: Sprite | null;
    /** Drawn length px at the last update (debug / capture check). */
    drawnPx: number;
}

export type WhalePilotView = 'system' | 'systemWide' | 'closeA' | 'closeB' | 'sector' | 'galaxy' | null;

export class WhalePilotLayer {
    root = new Container();
    private actors: PilotActor[] = [];
    private kaltorFrames: Texture[] = [];
    private kaltorContent = 1;
    private kaltorContentFrac = 0.9;
    private home: Habitat | null = null;
    private starX = 0;
    private starY = 0;
    private ready = false;
    private viewApplied = false;
    private t0 = -1;
    private readonly view: WhalePilotView;
    /** Render interpolation (renderInterp.ts; set by MainView): the actors circle the drawn home planet. */
    motion: MotionInterpolator | null = null;
    private homeScratch: DrawnPoint = { x: 0, y: 0 };

    constructor(
        private galaxy: Galaxy,
        world: Container,
        private camera: Camera,
        search: string,
        dwuPresent: boolean,
    ) {
        this.root.eventMode = 'none';
        this.root.interactiveChildren = false;
        world.addChild(this.root);
        const v = new URLSearchParams(search).get('whaleView');
        this.view = v === 'system' || v === 'systemWide' || v === 'closeA' || v === 'closeB' || v === 'sector' || v === 'galaxy' ? v : null;
        if (!dwuPresent) {
            console.warn('[whalePilot] no DW:U install — the pilot needs the original creature frames');
            return;
        }
        this.init().catch((e) => console.error('[whalePilot] init failed', e));
    }

    private async init(): Promise<void> {
        const [kaltor, ardilus] = await Promise.all([
            Promise.all(frameUrls('kaltor', 'Kaltor_', 12).map(loadImage)),
            Promise.all(frameUrls('ardilus', 'ArdillusMoving2_', 12).map(loadImage)),
        ]);
        // Study the original first: palette / contrast of the Kaltor frame at its native 360 px.
        const kData = imagePixels(kaltor[0], CREATURE_FRAME_SIDE, CREATURE_FRAME_SIDE);
        const kStats = artStats(kData, CREATURE_FRAME_SIDE, CREATURE_FRAME_SIDE);
        this.kaltorContent = contentPixels(kaltor[0]);
        this.kaltorContentFrac = kStats.longSidePx / CREATURE_FRAME_SIDE;
        this.kaltorFrames = kaltor.map((img) => {
            const t = Texture.from(img);
            useMinifyingFilter(t);
            return t;
        });
        const skinA = buildCompositeSkin(kaltor, ardilus, kStats);
        const skinB = buildProceduralSkin(kData, kStats);
        const restStats = (c: HTMLCanvasElement): ArtStats => artStats(c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
        const table: Record<string, ArtStats> = { kaltor: kStats, whaleA: restStats(skinA.rest), whaleB: restStats(skinB.rest) };
        if (skinB.restSkin !== null) table.whaleBSkinOnly = restStats(skinB.restSkin);
        for (const [k, s] of Object.entries(table)) console.log(`[whalePilot] stats ${k} ${JSON.stringify(roundStats(s))}`);
        (window as unknown as { __whalePilot?: unknown }).__whalePilot = { stats: table, layer: this };

        // Place them in the player's home system, just off the capital.
        const home = this.galaxy.playerEmpire?.capital ?? null;
        if (home === null) {
            console.warn('[whalePilot] no player capital — start a game (?autostart=1)');
            return;
        }
        this.home = home;
        const star = this.galaxy.systems[home.systemIndex]?.systemStar ?? home;
        this.starX = star.xpos;
        this.starY = star.ypos;
        const px = home.xpos + home.diameter / 2 + 620;
        const py = home.ypos;
        const mk = (kind: PilotActor['kind'], dx: number, dy: number, radius: number, omega: number, angle0: number): PilotActor => ({
            kind, ox: home.diameter / 2 + 620 + dx, oy: dy, ax: px + dx, ay: py + dy, radius, omega, angle0, x: 0, y: 0, heading: 0, rig: null, sprite: null, drawnPx: 0,
        });
        const kaltorA = mk('kaltor', 0, 0, 60, 0.05, 0);
        const wa = mk('whaleA', -60, -300, 90, -0.012, Math.PI * 0.5);
        const wb = mk('whaleB', 60, 300, 90, -0.012, Math.PI * 0.5);
        const ks = new Sprite(this.kaltorFrames[0]);
        ks.anchor.set(0.5);
        kaltorA.sprite = ks;
        wa.rig = new WhaleRig(skinA, 0);
        wb.rig = new WhaleRig(skinB, 1.9);
        this.root.addChild(wa.rig.root, wb.rig.root, ks);
        this.actors.push(kaltorA, wa, wb);
        this.ready = true;
        console.log(`[whalePilot] ready home=${home.name} at ${Math.round(px)},${Math.round(py)} kaltorContent=${this.kaltorContent}`);
    }

    /** One-shot camera framing for the capture views (dev only). */
    private applyView(): void {
        if (this.viewApplied || this.view === null) return;
        this.viewApplied = true;
        const [k, a, b] = this.actors;
        const cam = this.camera;
        switch (this.view) {
            case 'system':
                cam.centerOn(k.ax - 120, k.ay);
                cam.zoom = cam.clampZoom(1);
                break;
            case 'closeA':
            case 'closeB': {
                const w = this.view === 'closeA' ? a : b;
                // Past the game's 100 % limit: the pilot lifts maxZoom for its close-ups only.
                cam.maxZoom = 3;
                cam.centerOn((k.ax + w.ax) / 2, (k.ay + w.ay) / 2);
                cam.zoom = cam.clampZoom(2.2);
                break;
            }
            case 'systemWide':
                // Whole inner system (f = 40): creatures shrink to a few px under CalculateCreatureZoomFactor.
                cam.centerOn(k.ax, k.ay);
                cam.zoom = cam.clampZoom(1 / 40);
                break;
            case 'sector':
                // The HUD's Sector level (hud.ts SECTOR_LEVEL_ZOOM, f = 3000): above f 500 creatures are not drawn.
                cam.centerOn(k.ax, k.ay);
                cam.zoom = cam.clampZoom(1 / 3000);
                break;
            case 'galaxy':
                cam.zoom = cam.minZoom;
                break;
        }
        console.log(`[whalePilot] view ${this.view} camera ${Math.round(cam.x)},${Math.round(cam.y)} zoom ${cam.zoom.toFixed(4)}`);
    }

    update(z: number, cam: Camera): void {
        if (!this.ready) {
            this.root.visible = false;
            return;
        }
        this.applyView();
        const now = performance.now();
        if (this.t0 < 0) this.t0 = now;
        const t = (now - this.t0) / 1000;
        const f = 1 / z;
        // MainView.1.cs:1559/1567: creatures only below f 500 and while the view is on this system.
        const dx = cam.x - this.starX;
        const dy = cam.y - this.starY;
        const near = dx * dx + dy * dy <= (MAX_SOLAR_SYSTEM_SIZE + 5000) * (MAX_SOLAR_SYSTEM_SIZE + 5000);
        this.root.visible = f < CREATURE_MAX_FACTOR && near;
        if (!this.root.visible) {
            for (const a of this.actors) a.drawnPx = 0;
            return;
        }
        const kaltorPx = creatureDrawPx(this.kaltorContent, PILOT_KALTOR_SIZE, f);
        // Whale rope span = 3 × the Kaltor's drawn content length, under the Kaltor's cap widened by the same factor.
        const kaltorFullPx = creatureDrawPx(this.kaltorContent, PILOT_KALTOR_SIZE, f, Infinity);
        const whaleCap = f < 1 ? Infinity : creatureZoomFactor(f).maxWidth * WHALE_LENGTH_MUL;
        const whalePx = Math.min(kaltorFullPx * WHALE_LENGTH_MUL, whaleCap) * this.kaltorContentFrac;
        const halfW = cam.width / 2;
        const halfH = cam.height / 2;
        // Around the drawn (render-interpolated orbit) home planet.
        const hp = drawnPositionOf(this.motion, this.home!, this.homeScratch);
        for (const a of this.actors) {
            a.ax = hp.x + a.ox;
            a.ay = hp.y + a.oy;
            pilotActorPlacement(hp.x, hp.y, a, t, a);
            const px = a.kind === 'kaltor' ? kaltorPx : whalePx;
            const sx = (a.x - cam.x) * z + halfW;
            const sy = (a.y - cam.y) * z + halfH;
            // MainView.1.cs:1598 cull: 50 px outside the viewport (plus the drawn size).
            const off = sx + px < -50 || sx - px > cam.width + 50 || sy + px < -50 || sy - px > cam.height + 50;
            const node = a.sprite ?? a.rig!.root;
            if (off || px < 1) {
                node.visible = false;
                a.drawnPx = 0;
                continue;
            }
            node.visible = true;
            a.drawnPx = a.kind === 'kaltor' ? px * this.kaltorContentFrac : px;
            if (a.sprite !== null) {
                // Moving creatures animate at 10 fps (method_113).
                a.sprite.texture = this.kaltorFrames[creatureFrameIndex(t * 1000, this.kaltorFrames.length, CREATURE_FPS)];
                a.sprite.position.set(a.x, a.y);
                a.sprite.rotation = a.heading + Math.PI / 2; // raw frames face up
                a.sprite.scale.set(px / CREATURE_FRAME_SIDE / z);
            } else {
                const rig = a.rig!;
                rig.pose(t);
                rig.root.position.set(a.x, a.y);
                rig.root.rotation = a.heading; // rope head runs along +x
                rig.root.scale.set(px / BODY_W / z);
            }
        }
    }

    /** Drawn lengths (px) at the last update, for the capture script. */
    drawnLengths(): Record<string, number> {
        const out: Record<string, number> = {};
        for (const a of this.actors) out[a.kind] = Math.round(a.drawnPx);
        return out;
    }
}
