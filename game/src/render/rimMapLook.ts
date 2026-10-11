// 19i "Rim atmosphere": the galaxy-map look of the rim (scenario param `rimMapLook`), as alternatives to the original
// flat cold wash. Each option is one procedural texture (generated once, our own art) laid over the backdrop + nebulae
// in world space, fading out with the backdrop as the camera zooms in; the dust lanes stay, a little lighter at galaxy
// zoom where the option carries the look. Presentation only.
//
//   0 "Wash"        — the original flat dark-navy radial wash (rimAtmosphereLayer.makeWashTexture).
//   1 "Dust haze"   — a soft, mottled band of dim grey-brown dust haze along the rim edge (normal blend: a faint band
//                     over black space, a veil over the backdrop).
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

/** The look's sprites (world space, centred on the galaxy centre), or [] for 'wash' (the layer keeps its own). */
export function buildMapLook(look: RimMapLook, geo: RimGeometry, p: RimParams, half: number, seed: number): Sprite[] {
    if (look === 'wash') return [];
    const k = Math.min(1.5, p.tintStrength / RIM_DEFAULTS.tintStrength);
    const inner = p.rimInner;
    const N = 256;
    const TAU = Math.PI * 2;
    const sprites: { tex: Texture; blend: 'normal' | 'multiply' }[] = [];
    if (look === 'haze') {
        // Low-frequency polar mottling: angle wraps exactly once around the 256-periodic grid.
        const n = fbmGrid(N, 4, 4, seed ^ 0x4a7e);
        sprites.push({
            blend: 'normal',
            tex: radialTexture(geo, half, 512, (f, th, o) => {
                const band = smooth(inner + 0.06, Math.min(1.0, inner + 0.3), f) * (1 - smooth(1.12, 1.4, f));
                if (band <= 0) return;
                const u = ((th / TAU) + 1) * N;
                const m = sampleWrap(n, N, u, f * N * 0.9);
                const t = smooth(inner, 1.1, f);
                // A dim, lit grey-brown veil: over black space it shows as a faint dust band, over the backdrop it veils.
                o[0] = 58 - 10 * t;
                o[1] = 52 - 8 * t;
                o[2] = 56 - 4 * t;
                o[3] = band * (0.25 + 0.75 * m * m) * 0.5 * k;
            }),
        });
    } else if (look === 'wisps') {
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

/** Per frame: fade with the backdrop; the wisp layers drift (rotation only — a uniform, no redraw). */
export function updateMapLook(look: RimMapLook, sprites: readonly Sprite[], galaxyA: number, tSec: number): void {
    const on = galaxyA > 0.01;
    for (let i = 0; i < sprites.length; i++) {
        const s = sprites[i];
        if (s.visible !== on) s.visible = on;
        if (!on) continue;
        s.alpha = galaxyA;
        if (look === 'wisps') s.rotation = (tSec % 54000) * WISP_SPIN[i % 2];
    }
}
