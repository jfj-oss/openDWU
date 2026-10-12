// 19i "Rim atmosphere": the galaxy-map look of the rim (scenario param `rimMapLook`), as alternatives to the original
// flat cold wash. Each option is one procedural texture (generated once, our own art) laid over the backdrop + nebulae
// in world space, fading out with the backdrop as the camera zooms in; the dust lanes stay, a little lighter at galaxy
// zoom where the option carries the look. Presentation only.
//
//   0 "Wash"        — the original flat dark-navy radial wash (rimAtmosphereLayer.makeWashTexture).
//   1 "Dust haze"   — soft, dark storm-cloud masses filling the rim band out to the galaxy rect's edges and corners
//                     (clipped to the rect; two layers cross-fade so the clouds drift without the sprite rotating).
//   2 "Dark wisps"  — tangentially stretched, domain-warped smoky nebula filaments in the rim band, two layers drifting
//                     very slowly against each other.
//   3 "Cold falloff" — a smooth deep cold-blue gradient from the rim start outward (no texture detail).

import { Sprite, type Texture } from 'pixi.js';
import { fbmGrid, sampleWrap } from './rimDust';
import { rimFraction, RIM_DEFAULTS, type RimGeometry, type RimParams } from './rimCurve';
import { textureFromRgbaPixels } from './textureCanvas';
import { useMinifyingFilter } from './assets';

export const RIM_MAP_LOOKS = ['wash', 'haze', 'wisps', 'cold'] as const;
export type RimMapLook = (typeof RIM_MAP_LOOKS)[number];

/** Dust-lane alpha scale at full galaxy zoom per look (the option carries the look there; 1 = unchanged). */
export const MAP_LOOK_LANE_SCALE: Record<RimMapLook, number> = { wash: 1, haze: 0.55, wisps: 0.4, cold: 0.7 };

/** Wisp layer drift (radians / real second about the galaxy centre): one turn in ~3 h / ~5 h, opposite ways. */
const WISP_SPIN = [2 * Math.PI / 10800, -2 * Math.PI / 18000];
/** Haze drift: the two cloud layers cross-fade once per 20 min (the clouds shift round the rim), with a 45 s breath. */
const HAZE_CYCLE_S = 1200;
const HAZE_BREATH_S = 45;

function clamp01(v: number): number {
    return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smooth(a: number, b: number, v: number): number {
    const t = clamp01((v - a) / (b - a));
    return t * t * (3 - 2 * t);
}

export function mapLookOf(p: RimParams): RimMapLook {
    return RIM_MAP_LOOKS[Math.max(0, Math.min(RIM_MAP_LOOKS.length - 1, p.rimMapLook | 0))];
}

type Pixel = (f: number, theta: number, out: Float32Array) => void;

/** Texture over the square [cx ± half]² (S² texels): `px` writes r, g, b (0..255) and alpha (0..1) into out. */
function radialTexture(geo: RimGeometry, half: number, S: number, px: Pixel): Texture {
    const rgba = new Uint8ClampedArray(S * S * 4);
    const o = new Float32Array(4);
    for (let y = 0; y < S; y++) {
        const wy = geo.cy + ((y + 0.5) / S - 0.5) * 2 * half;
        for (let x = 0; x < S; x++) {
            const wx = geo.cx + ((x + 0.5) / S - 0.5) * 2 * half;
            const f = rimFraction(geo, wx, wy);
            o[3] = 0;
            px(f, Math.atan2(wy - geo.cy, wx - geo.cx), o);
            if (o[3] <= 0) continue;
            const i = (y * S + x) * 4;
            rgba[i] = o[0];
            rgba[i + 1] = o[1];
            rgba[i + 2] = o[2];
            rgba[i + 3] = clamp01(o[3]) * 255;
        }
    }
    const tex = textureFromRgbaPixels(rgba, S, S);
    useMinifyingFilter(tex);
    return tex;
}

/** Haze cloud layers: the texture covers exactly the galaxy rect (0..2cx × 0..2cy — the rim centre is the middle of
 *  the rect), so nothing draws past the map border and the sprite never rotates. Two layers sample the same soft
 *  polar cloud field at angles half a cloud apart; updateMapLook cross-fades them, so the clouds drift round the rim
 *  inside a fixed footprint. Dark, billowy, low-contrast masses with feathered edges, filling the rim band out to the
 *  rect's edges and corners. */
function buildHaze(geo: RimGeometry, p: RimParams, seed: number, k: number): Sprite[] {
    const N = 256;
    const TAU = Math.PI * 2;
    const W = geo.cx * 2;
    const H = geo.cy * 2;
    const S = 512;
    const tw = W >= H ? S : Math.max(64, Math.round((S * W) / H));
    const th = H >= W ? S : Math.max(64, Math.round((S * H) / W));
    const inner = p.rimInner;
    // Low frequency, few octaves: big soft masses, no grain. A second coarse field warps them into billows.
    const n = fbmGrid(N, 3, 3, seed ^ 0x4a7e, 0.45);
    const warp = fbmGrid(N, 2, 2, seed ^ 0x51c3);
    const feather = 0.035 * Math.min(W, H);
    const out: Sprite[] = [];
    for (let layer = 0; layer < 2; layer++) {
        const du = layer * N * 0.045; // half a cloud along the rim
        const rgba = new Uint8ClampedArray(tw * th * 4);
        for (let y = 0; y < th; y++) {
            const wy = ((y + 0.5) / th) * H;
            for (let x = 0; x < tw; x++) {
                const wx = ((x + 0.5) / tw) * W;
                const f = rimFraction(geo, wx, wy);
                const band = smooth(inner + 0.02, inner + 0.34, f);
                if (band <= 0) continue;
                const ang = Math.atan2(wy - geo.cy, wx - geo.cx);
                const u = (ang / TAU + 1) * N + du;
                const v = f * N * 0.6;
                const wv = sampleWrap(warp, N, u * 0.5, v * 0.5) - 0.5;
                const m = smooth(0.36, 0.72, sampleWrap(n, N, u + wv * 40, v + wv * 28));
                // Gentle feather at the rect border (the clouds still reach it).
                const e = Math.min(wx, W - wx, wy, H - wy) / feather;
                const edge = 0.6 + 0.4 * smooth(0, 1, e);
                const a = band * edge * (0.04 + 0.84 * m) * k;
                const i = (y * tw + x) * 4;
                // Near-black storm-cloud grey: dense masses darken the backdrop strongly, the gaps between them stay clear.
                rgba[i] = 16 - 8 * m;
                rgba[i + 1] = 15 - 8 * m;
                rgba[i + 2] = 19 - 8 * m;
                rgba[i + 3] = clamp01(a) * 255;
            }
        }
        const tex = textureFromRgbaPixels(rgba, tw, th);
        useMinifyingFilter(tex);
        const s = new Sprite(tex);
        s.position.set(0, 0);
        s.scale.set(W / tw, H / th);
        s.visible = false;
        out.push(s);
    }
    return out;
}

/** The look's sprites (world space, centred on the galaxy centre), or [] for 'wash' (the layer keeps its own). */
export function buildMapLook(look: RimMapLook, geo: RimGeometry, p: RimParams, half: number, seed: number): Sprite[] {
    if (look === 'wash') return [];
    const k = Math.min(1.5, p.tintStrength / RIM_DEFAULTS.tintStrength);
    const inner = p.rimInner;
    const N = 256;
    const TAU = Math.PI * 2;
    const sprites: { tex: Texture; blend: 'normal' | 'multiply' }[] = [];
    if (look === 'haze') return buildHaze(geo, p, seed, k);
    if (look === 'wisps') {
        for (let layer = 0; layer < 2; layer++) {
            const n = fbmGrid(N, 4, 6, seed ^ (0x77a1 + layer * 0x1f3));
            const warp = fbmGrid(N, 2, 3, seed ^ (0x3c5d + layer * 0x2b1));
            const strength = layer === 0 ? 0.62 : 0.4;
            sprites.push({
                blend: 'normal',
                tex: radialTexture(geo, half, 1024, (f, th, o) => {
                    const band = smooth(inner + 0.04, inner + 0.22, f) * (1 - smooth(1.08, 1.32, f));
                    if (band <= 0) return;
                    // Stretched along the tangent (3 wraps of the grid around the ring, ~1.6 across the band).
                    const u = ((th / TAU) + 1) * N * 3;
                    const v = f * N * 1.6;
                    const wv = sampleWrap(warp, N, u / 3, v * 0.5) - 0.5;
                    const w = sampleWrap(n, N, u + wv * 90, v + wv * 40);
                    // Filaments: the ridges of the noise (|w - 0.5| small), softened.
                    const ridge = 1 - Math.min(1, Math.abs(w - 0.5) * 4.2);
                    const a = ridge * ridge * band * strength * k;
                    if (a <= 0.004) return;
                    // Smoky cold-grey filaments: faintly lit over black space, dark over the backdrop.
                    o[0] = 50;
                    o[1] = 54;
                    o[2] = 70;
                    o[3] = a * 0.8;
                }),
            });
        }
    } else {
        sprites.push({
            blend: 'normal',
            tex: radialTexture(geo, half, 256, (f, _th, o) => {
                const t = smooth(inner, 1.12, f) * (1 - smooth(1.25, 1.6, f));
                if (t <= 0) return;
                // Deep cold blue: over black space a faint navy falloff, over the backdrop it cools and dims.
                o[0] = 16;
                o[1] = 26;
                o[2] = 64;
                o[3] = t * 0.62 * Math.min(1, k);
            }),
        });
    }
    return sprites.map(({ tex, blend }) => {
        const s = new Sprite(tex);
        s.blendMode = blend;
        s.anchor.set(0.5);
        s.position.set(geo.cx, geo.cy);
        s.scale.set((half * 2) / tex.width);
        s.visible = false;
        return s;
    });
}

/** Per frame: fade with the backdrop; the haze layers cross-fade inside the rect, the wisp layers drift (rotation only — a uniform, no redraw). With
 *  `animate` off (Game Options "Animate backdrop") the look holds still. */
export function updateMapLook(look: RimMapLook, sprites: readonly Sprite[], galaxyA: number, tSec: number, animate = true): void {
    const on = galaxyA > 0.01;
    for (let i = 0; i < sprites.length; i++) {
        const s = sprites[i];
        if (s.visible !== on) s.visible = on;
        if (!on) continue;
        if (!animate) {
            s.alpha = look === 'haze' && i > 0 ? 0 : galaxyA;
            continue;
        }
        if (look === 'haze') {
            // Equal-power cross-fade of the two cloud layers (one cycle per HAZE_CYCLE_S) plus the breath.
            const w = 0.5 - 0.5 * Math.cos((tSec % HAZE_CYCLE_S) * (2 * Math.PI / HAZE_CYCLE_S));
            const breath = 0.88 + 0.12 * Math.sin((tSec % HAZE_BREATH_S) * (2 * Math.PI / HAZE_BREATH_S));
            s.alpha = galaxyA * breath * (i === 0 ? Math.cos(w * Math.PI / 2) : Math.sin(w * Math.PI / 2));
        } else {
            s.alpha = galaxyA;
            if (look === 'wisps') s.rotation = (tSec % 54000) * WISP_SPIN[i % 2];
        }
    }
}
