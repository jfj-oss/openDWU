// Animated part of the "Deep (DW2-style)" galaxy backdrop and its variants (render-only; colours from the kind's
// DeepRecipe as uniforms, deepBackdrop.ts). One additive quad over the galaxy rectangle
// with a small fragment shader that reads the 256^2 field texture built by deepBackdrop.ts:
// - the share of the dust not baked into the static canvas, sampled through a slow, swirling domain warp
//   plus a finer warp for gassy, wispy edges, so the clouds migrate and curl over a minute or so;
// - glows: a 6x6 grid of cells, each with its own jittered centre, shape, period, phase and peak; a cell lights up
//   only on some of its cycles, so they are staggered and irregular, and the glow lights the dust it sits on;
// - faint godrays: angular noise streaks from the galaxy core, slowly turning, falling off with distance.
// Time advances only when the backdrop is visible, the game is running and "Animate backdrop" is on; otherwise the
// layer is a still image. Per frame it writes a few uniform floats; no allocations.

import { Geometry, GlProgram, Mesh, Shader, BufferImageSource, UniformGroup } from 'pixi.js';
import { DEEP_FIELD_SIZE, DEEP_RECIPES, DUST_B_HI, DUST_B_LO, type DeepRecipe } from './deepBackdrop';

/** Vertex shader of the quad (PixiJS mesh: world transform, uv 0..1 over the galaxy). */
const DEEP_ANIM_VERT = `#version 300 es
precision highp float;
in vec2 aPosition;
in vec2 aUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
out vec2 vUv;
void main() {
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    vUv = aUV;
}`;

/** Share of the dust the animated layer draws (the static canvas keeps the rest). */
export const DEEP_ANIM_DUST_SHARE = 0.7;

/** Clock speed of the animated layer relative to real time (the warp, the glow cycles and the godrays all run on it). */
export const DEEP_ANIM_SPEED = 2.5;

const DEEP_ANIM_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uField;
uniform vec4 uT;    // time (s), alpha, dust share, glow strength
uniform vec4 uCore; // core uv x, y, seed a, seed b
uniform vec4 uDustA;  // main dust rgb, dust amount
uniform vec4 uDustB;  // second dust rgb, 1 = use it
uniform vec4 uAccent; // accent rgb
uniform vec4 uGlow;   // glow rgb
uniform vec4 uRays;   // godray rgb
out vec4 finalColor;

float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21) + uCore.zw);
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

void main() {
    float t = uT.x;
    vec2 uv = vUv;
    float area = texture(uField, uv).r;
    // slow swirling domain warp
    vec2 q = vec2(texture(uField, uv * 0.7 + vec2(t * 0.0011, 0.13)).g,
                  texture(uField, uv * 0.7 + vec2(0.41, -t * 0.0009)).a) - 0.5;
    float ang = t * 0.004 + q.x * 3.0;
    vec2 w = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * q;
    vec2 p = uv + w * 0.06 + vec2(t * 0.00018, t * 0.00007);
    // finer warp: gassy, curling edges
    vec2 q2 = vec2(texture(uField, p * 2.3 + vec2(-t * 0.0016, t * 0.0012)).a,
                   texture(uField, p * 2.3 + vec2(0.7 + t * 0.0013, 0.2)).g) - 0.5;
    vec4 f = texture(uField, p + q2 * 0.025);
    float cloud = smoothstep(0.42, 0.8, f.g) * (0.35 + 0.65 * area);
    float wisp = smoothstep(0.55, 0.85, 1.0 - abs(2.0 * f.a - 1.0)) * 0.5 * area;
    float a = (cloud + wisp * cloud) * uDustA.w * uT.z;
    float teal = smoothstep(0.52, 0.76, f.b);
    vec3 dust = uDustA.rgb;
    if (uDustB.w > 0.5) dust = mix(dust, uDustB.rgb, 1.0 - smoothstep(DUST_B_LO, DUST_B_HI, f.b));
    vec3 col = mix(dust, uAccent.rgb, teal) * a;

    // glows: staggered, irregular, lighting the dust under them
    vec2 g = uv * 6.0;
    vec2 gi = floor(g);
    float glow = 0.0;
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 c = gi + vec2(float(i), float(j));
            float h1 = hash(c), h2 = hash(c + 17.1), h3 = hash(c + 31.7), h4 = hash(c + 5.3);
            float period = 16.0 + 36.0 * h3;
            float cyc = t / period + h4;
            float ph = fract(cyc);
            float on = step(hash(c + floor(cyc) * 1.731), 0.6);
            float pulse = smoothstep(0.0, 0.3, ph) * (1.0 - smoothstep(0.3, 1.0, ph));
            vec2 d = g - (c + 0.2 + 0.6 * vec2(h1, h2));
            float th = h1 * 6.2832;
            d = mat2(cos(th), -sin(th), sin(th), cos(th)) * d;
            d.x /= 1.0 + 1.6 * h2;
            float rad = 0.3 + 0.45 * h3;
            glow += exp(-dot(d, d) / (rad * rad)) * pulse * pulse * on * (0.35 + 0.65 * h4);
        }
    }
    col += uGlow.rgb * glow * (0.3 + cloud) * uT.w * 1.7;

    // faint godrays from the core
    vec2 dc = uv - uCore.xy;
    float r = length(dc);
    float an = atan(dc.y, dc.x) / 6.2832;
    float n1 = texture(uField, vec2(an * 3.0 + t * 0.0012, 0.31)).g;
    float n2 = texture(uField, vec2(an * 5.0 - t * 0.0008, 0.67)).a;
    float rays = smoothstep(0.45, 0.85, n1 * 0.6 + n2 * 0.4);
    float fall = exp(-r * 4.0) * smoothstep(0.0, 0.08, r);
    col += uRays.rgb * rays * rays * fall * (0.35 + 0.65 * area) * 0.5 * (0.7 + 0.3 * sin(t * 0.05));

    finalColor = vec4(col * uT.y, 0.0);
}`
    .replace('DUST_B_LO', DUST_B_LO.toFixed(3))
    .replace('DUST_B_HI', DUST_B_HI.toFixed(3));

function vec4(v: readonly number[], w: number): Float32Array {
    return new Float32Array([v[0], v[1], v[2], w]);
}

export class DeepNebulaAnim {
    readonly root: Mesh<Geometry, Shader>;
    private readonly uniforms: UniformGroup;
    private readonly src: BufferImageSource;
    private time = 0;

    constructor(field: Uint8Array, sizeX: number, sizeY: number, seed: number, recipe: DeepRecipe = DEEP_RECIPES.deep) {
        const F = DEEP_FIELD_SIZE;
        // core = centroid of the squared galaxy-shape weight
        let sw = 0;
        let cx = 0;
        let cy = 0;
        for (let y = 0; y < F; y++) {
            for (let x = 0; x < F; x++) {
                const v = field[(y * F + x) * 4] / 255;
                const k = v * v;
                sw += k;
                cx += k * (x + 0.5);
                cy += k * (y + 0.5);
            }
        }
        const core = sw > 0 ? [cx / sw / F, cy / sw / F] : [0.5, 0.5];
        this.src = new BufferImageSource({ resource: field, width: F, height: F, format: 'rgba8unorm', scaleMode: 'linear', addressMode: 'repeat', alphaMode: 'no-premultiply-alpha' });
        this.uniforms = new UniformGroup({
            uT: { value: new Float32Array([0, 1, DEEP_ANIM_DUST_SHARE, recipe.glowStrength]), type: 'vec4<f32>' },
            uCore: { value: new Float32Array([core[0], core[1], ((seed >>> 0) % 997) / 997, ((seed >>> 10) % 991) / 991]), type: 'vec4<f32>' },
            uDustA: { value: new Float32Array(4), type: 'vec4<f32>' },
            uDustB: { value: new Float32Array(4), type: 'vec4<f32>' },
            uAccent: { value: new Float32Array(4), type: 'vec4<f32>' },
            uGlow: { value: new Float32Array(4), type: 'vec4<f32>' },
            uRays: { value: new Float32Array(4), type: 'vec4<f32>' },
        });
        this.setRecipe(recipe);
        const glProgram = GlProgram.from({ vertex: DEEP_ANIM_VERT, fragment: DEEP_ANIM_FRAG, name: 'deep-backdrop-anim', preferredVertexPrecision: 'highp', preferredFragmentPrecision: 'highp' });
        const shader = new Shader({ glProgram, resources: { uField: this.src, uniforms: this.uniforms } });
        const geometry = new Geometry({
            attributes: { aPosition: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), aUV: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]) },
            indexBuffer: [0, 1, 2, 0, 2, 3],
        });
        this.root = new Mesh({ geometry, shader });
        this.root.state.blendMode = 'add';
        this.root.eventMode = 'none';
        this.root.scale.set(sizeX, sizeY);
        this.root.visible = false;
    }

    /** Use `r`'s colours (a switch between the Deep kinds keeps the field and the clock). */
    setRecipe(r: DeepRecipe): void {
        const u = this.uniforms.uniforms as Record<string, Float32Array>;
        const two = r.dustA.some((v, i) => v !== r.dustB[i]);
        u.uDustA.set(vec4(r.dustA, r.dust));
        u.uDustB.set(vec4(r.dustB, two ? 1 : 0));
        u.uAccent.set(vec4(r.accent, 0));
        u.uGlow.set(vec4(r.glow, 0));
        u.uRays.set(vec4(r.rays, 0));
        u.uT[3] = r.glowStrength;
        this.uniforms.update();
    }

    /** Set the animation clock (seconds), e.g. from the backdrop-time URL parameter. */
    setTime(t: number): void {
        this.time = t;
    }

    /**
     * Per frame. `on`: a Deep-recipe backdrop is chosen and on screen; `alpha`: the backdrop group's alpha (a custom shader
     * does not inherit it); time moves only when `running` and `animate`.
     */
    update(on: boolean, dt: number, running: boolean, animate: boolean, alpha: number): void {
        this.root.visible = on;
        if (!on) return;
        if (running && animate) this.time = (this.time + Math.min(dt, 0.25) * DEEP_ANIM_SPEED) % 100000;
        const u = this.uniforms.uniforms.uT as Float32Array;
        if (u[0] !== this.time || u[1] !== alpha) {
            u[0] = this.time;
            u[1] = alpha;
            this.uniforms.update();
        }
    }

    destroy(): void {
        this.root.destroy();
        this.src.destroy();
    }
}
