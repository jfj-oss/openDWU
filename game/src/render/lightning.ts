// Ion-strike lightning: the crackle drawn over a ship for 1.4 s after an ion weapon disables one of its components
// (BuiltObject.LastIonStrike). Render only: reads the sim, never writes it (the C# renderer resets
// BuiltObject.LastIonStrike to DateTime.MinValue once the 1.4 s are over; here the age test alone hides it).
//
// Sources (DistantWorlds/):
//   LightningGenerator.cs                 — GenerateLightning(seed, size): a branching bolt from the image centre,
//                                           drawn twice (a pink 1.4x pass, a white 0.8x pass) plus a soft white glow
//   Controls/MainView.1.cs 1162-1201      — per ship (XNA path): size = drawn width x 1.4, centred on the ship,
//                                           seed = BuiltObjectID + CurrentDateTime.Second / 3, alpha
//                                           1 - (ms since the strike % 250) / 250 x 0.95 (a 250 ms flicker)
//   Controls/MainView.cs 4433-4465        — the same in the GDI path
//
// The bolt geometry is a faithful port, including the .NET Random(seed) sequence (sim/random.ts, a private instance:
// no sim randomness is drawn). The raster differs only in the stroke caps (GDI LineCap.Triangle has no canvas
// equivalent; 'round' is the nearest silhouette) and in a resolution cap (LIGHTNING_MAX_TEXTURE_PX: the bolt is drawn
// at most that large and the sprite scaled up; the C# draws up to a 2000 px bitmap every frame).

import { Texture } from 'pixi.js';
import { Random } from '../sim/random';
import { MIN_TIME } from '../sim/tick/simTime';

/** MainView.1.cs 1165: the lightning shows for 1400 ms after the strike. */
export const ION_STRIKE_SHOW_MS = 1400;
/** MainView.1.cs 1180: drawn at 1.4 x the ship's drawn width. */
export const ION_STRIKE_SIZE_FACTOR = 1.4;
/** Raster cap: bolts larger than this are drawn at this size and scaled up (see the header). */
export const LIGHTNING_MAX_TEXTURE_PX = 1024;

/** LightningPathNode.cs: one point of the bolt and its branches. */
export interface LightningPathNode {
    x: number;
    y: number;
    angle: number;
    width: number;
    children: LightningPathNode[];
}

/** One stroke of the raster: a line from a node to one of its children. */
export interface LightningSegment {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    /** Pen width in px (method_0: max(1, node.Width x pass factor x size / 400)). */
    width: number;
    /** 0xRRGGBB (method_0 darkens the colour by 0.99 per level). */
    color: number;
}

/** One ring of the centre glow (a filled white ellipse). */
export interface LightningGlow {
    x: number;
    y: number;
    size: number;
    /** 0..64 (out of 255). */
    alpha: number;
}

export interface LightningImage {
    /** The bitmap side in px (GenerateLightning's size, clamped to 1..2000). */
    size: number;
    /** The pink pass (Color.FromArgb(208, 128, 128), 1.4x), then the white pass (0.8x), in draw order. */
    segments: LightningSegment[];
    glow: LightningGlow[];
}

/**
 * Port of LightningGenerator.GenerateLightning(seed, size): the bolt geometry, the two stroke passes and the glow, in
 * the C#'s draw order. double_3 keeps the constructor's 1.05 (GenerateLightning does not reset it).
 */
export function generateLightning(seed: number, size: number): LightningImage {
    const random = new Random(seed);
    const double_2 = 0.97;
    const double_1 = size / 50.0;
    const double_4 = random.nextDouble() * 2.0 * Math.PI;
    const double_0 = 8.0;
    const double_5 = size / 400.0;
    const double_3 = 1.05;

    // method_1: the recursive path, drawing in exactly the C#'s order (a branch's first child is built before the
    // second child's angle is drawn).
    const method_1 = (x: number, y: number, angle: number, baseAngle: number, width: number, minWidth: number): LightningPathNode => {
        const node: LightningPathNode = { x, y, angle, width, children: [] };
        if (width < minWidth) return node;
        const num = double_1 * 0.5 + double_1 * random.nextDouble();
        let num2 = double_3 * -1.0 + double_3 * 2.0 * random.nextDouble();
        num2 = !(num2 < 0.0) ? Math.max(0.3, num2) : Math.min(-0.3, num2);
        angle += num2;
        const num3 = Math.abs(angle - baseAngle);
        if (num3 > 1.4) angle -= num2 * 2.0;
        width *= double_2;
        x += Math.cos(angle) * num;
        y += Math.sin(angle) * num;
        if (random.next(0, 15) === 1) {
            node.children.push(method_1(x, y, angle, baseAngle, width, minWidth));
            let num4 = double_3 * -1.0 + double_3 * 2.0 * random.nextDouble();
            num4 = !(num4 > 0.0) ? Math.min(num4, -0.7) : Math.max(num4, 0.7);
            const num5 = angle + num4;
            const double_12 = Math.max(0.04, width * 0.2);
            node.children.push(method_1(x, y, num5, num5, width * 0.25, double_12));
        } else {
            node.children.push(method_1(x, y, angle, baseAngle, width, minWidth));
        }
        return node;
    };
    // `size / 2` is int division in the C# (size is an int).
    const half = Math.trunc(size / 2);
    const root = method_1(half, half, double_4, double_4, double_0, double_0 * 0.4);
    let side = size;
    if (side < 1) side = 1;
    else if (side > 2000) side = 2000;

    const segments: LightningSegment[] = [];
    // method_0: each node draws a line to each child in its colour, then recurses with the colour x 0.99.
    const method_0 = (r: number, g: number, b: number, node: LightningPathNode, double_6: number): void => {
        const w = Math.max(1, Math.fround(node.width * double_6 * double_5));
        for (const child of node.children) {
            segments.push({ x1: node.x, y1: node.y, x2: child.x, y2: child.y, width: w, color: (r << 16) | (g << 8) | b });
            const num = 0.99;
            method_0(Math.max(0, Math.trunc(r * num)), Math.max(0, Math.trunc(g * num)), Math.max(0, Math.trunc(b * num)), child, double_6);
        }
    };
    method_0(208, 128, 128, root, 1.4);
    method_0(255, 255, 255, root, 0.8);

    const glow: LightningGlow[] = [];
    const num2 = Math.trunc(side / 2);
    const num3 = Math.trunc(side / 15.0);
    const num4 = Math.max(1, Math.trunc(num3 / 20));
    for (let num5 = num3; num5 > 0; num5 -= num4) {
        let val = Math.trunc((64.0 / num3) * (num3 - num5 + 1.0));
        val = Math.min(64, Math.max(0, val));
        glow.push({ x: num2 - Math.trunc(num5 / 2), y: num2 - Math.trunc(num5 / 2), size: num5, alpha: val });
    }
    return { size: side, segments, glow };
}

/** MainView.1.cs 1166: still showing `nowMs` after the strike (any strike less than 1.4 s old, as the C# test). */
export function ionStrikeVisible(lastIonStrike: number, nowMs: number): boolean {
    return lastIonStrike > MIN_TIME && nowMs - lastIonStrike < ION_STRIKE_SHOW_MS;
}

/** MainView.1.cs 1184-1188: the flicker alpha `ms` after the strike — 1 at each 250 ms beat, fading to 0.05. */
export function ionStrikeAlpha(msSinceStrike: number): number {
    const num112 = 1.0 - ((msSinceStrike % 250.0) / 250.0) * 0.95;
    return num112 < 1.0 ? num112 : 1.0;
}

/** MainView.1.cs 1179: the bitmap seed — BuiltObjectID + CurrentDateTime.Second / 3 (a new bolt every 3 s). */
export function ionStrikeSeed(builtObjectID: number, nowMs: number): number {
    const second = ((Math.floor(nowMs / 1000) % 60) + 60) % 60;
    return (builtObjectID + Math.trunc(second / 3)) | 0;
}

/** MainView.1.cs 1178: the bolt's side in px for a ship drawn `drawnPx` wide. */
export function ionStrikeSizePx(drawnPx: number): number {
    return Math.trunc(drawnPx * ION_STRIKE_SIZE_FACTOR);
}

/** Draw a generated bolt into a 2D context of side `px` (the image scaled from its own size). */
function rasterize(ctx: CanvasRenderingContext2D, img: LightningImage, px: number): void {
    const k = px / img.size;
    ctx.clearRect(0, 0, px, px);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of img.segments) {
        ctx.strokeStyle = `#${s.color.toString(16).padStart(6, '0')}`;
        ctx.lineWidth = s.width * k;
        ctx.beginPath();
        ctx.moveTo(s.x1 * k, s.y1 * k);
        ctx.lineTo(s.x2 * k, s.y2 * k);
        ctx.stroke();
    }
    for (const g of img.glow) {
        ctx.fillStyle = `rgba(255,255,255,${g.alpha / 255})`;
        ctx.beginPath();
        ctx.ellipse((g.x + g.size / 2) * k, (g.y + g.size / 2) * k, (g.size / 2) * k, (g.size / 2) * k, 0, 0, Math.PI * 2);
        ctx.fill();
    }
}

/**
 * The bolt textures, keyed by (seed, size) — a bolt is the same for 3 s (the seed) at a fixed zoom (the size), so a
 * strike is rasterised once instead of every frame. The oldest entries are dropped past `max`.
 */
export class LightningTextures {
    private cache = new Map<string, Texture>();
    constructor(private max = 24) {}

    get(seed: number, size: number): Texture | null {
        if (size < 1 || typeof document === 'undefined') return null;
        const key = `${seed}:${size}`;
        let tex = this.cache.get(key);
        if (tex !== undefined) {
            // Refresh its LRU position.
            this.cache.delete(key);
            this.cache.set(key, tex);
            return tex;
        }
        const img = generateLightning(seed, size);
        const px = Math.min(img.size, LIGHTNING_MAX_TEXTURE_PX);
        const canvas = document.createElement('canvas');
        canvas.width = px;
        canvas.height = px;
        const ctx = canvas.getContext('2d');
        if (ctx === null) return null;
        rasterize(ctx, img, px);
        tex = Texture.from(canvas);
        this.cache.set(key, tex);
        while (this.cache.size > this.max) {
            const oldest = this.cache.keys().next().value as string;
            this.cache.get(oldest)?.destroy(true);
            this.cache.delete(oldest);
        }
        return tex;
    }

    clear(): void {
        for (const t of this.cache.values()) t.destroy(true);
        this.cache.clear();
    }
}
