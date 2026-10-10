// GLSL for the generated galaxy backdrops (galaxyBackdrop.ts in the Main View, galaxyBackdropPreview.ts for the
// pickers' thumbnails). Our own shader art; nothing from the original game's images.
//
// One fragment program draws every variant and pass, picked by uniforms (uParams.x kind, .y pass) so the branch is the
// same for every fragment of a draw:
// - pass 0, static: the parts that never move, opaque, rendered once into a large galaxy-space texture;
// - pass 1, animated: the moving parts as premultiplied colour + alpha (alpha darkens what is under it: dust), rendered
//   into a smaller galaxy-space texture a few times a second and drawn over the static one (normal blend);
// - pass 2, preview: both composited in one pass (the thumbnails).
// Coordinates: vUv is galaxy uv (0,0 top-left .. 1,1 bottom-right); p is centred on the structure's centre, aspect
// corrected, 1 = half the galaxy's larger side. All noise comes from the seeded tileable noise texture (four periodic
// fBm channels), sampled at a few scales, so a fragment costs a handful of texture reads. Portability as gpuNebula.ts:
// GLSL ES 3.00, highp, no uniform shared between the stages, constant loop bounds.

/** Vertex shader for the Pixi mesh (pixel-space quad into a render texture). */
export const BACKDROP_VERT_PIXI = `#version 300 es
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

/** Vertex shader for the raw WebGL2 thumbnail (clip-space quad; uv 0,0 at the top-left). */
export const BACKDROP_VERT_RAW = `#version 300 es
precision highp float;
in vec2 aPosition;
out vec2 vUv;
void main() {
    gl_Position = vec4(aPosition, 0.0, 1.0);
    vUv = vec2(aPosition.x * 0.5 + 0.5, 0.5 - aPosition.y * 0.5);
}`;

export const BACKDROP_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uDensity;
uniform sampler2D uNoise;
uniform vec2 uCentre;
uniform vec2 uAspect;
uniform vec4 uArm;
uniform vec4 uEll;
uniform vec4 uMisc;
uniform vec4 uParams;
// The part of the target this draw covers, as uv offset + size (the static texture is drawn in bands).
uniform vec4 uBand;
// Storm flashes active now (galaxyBackdropFlashes.ts): centre (p units), radius, intensity (0 = none).
uniform vec4 uFlash[12];

const float TAU = 6.28318530718;

// Noise lookup with a quintic-smoothed texel position (C2 between texels): plain bilinear showed its texel grid as
// creases once the clouds magnify and contrast-stretch it.
vec4 N(vec2 x) {
    vec2 tp = (x + uMisc.zw) * 256.0 + 0.5;
    vec2 i = floor(tp);
    vec2 f = tp - i;
    f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    return texture(uNoise, (i + f - 0.5) / 256.0);
}
// Three scales of the periodic noise; each channel is already 4-octave fBm. Stretched so the spread is useful.
float fA(vec2 x) { float v = N(x).r * 0.55 + N(x * 2.13 + vec2(0.37, 0.11)).g * 0.3 + N(x * 4.37 + vec2(0.71, 0.53)).b * 0.15; return clamp((v - 0.5) * 2.2 + 0.5, 0.0, 1.0); }
float fB(vec2 x) { float v = N(x + vec2(0.5, 0.25)).g * 0.55 + N(x * 2.07 + vec2(0.13, 0.61)).b * 0.3 + N(x * 4.21 + vec2(0.29, 0.87)).a * 0.15; return clamp((v - 0.5) * 2.2 + 0.5, 0.0, 1.0); }
float fC(vec2 x) { float v = N(x + vec2(0.25, 0.75)).b * 0.55 + N(x * 2.19 + vec2(0.83, 0.41)).a * 0.3 + N(x * 4.29 + vec2(0.47, 0.07)).r * 0.15; return clamp((v - 0.5) * 2.2 + 0.5, 0.0, 1.0); }
float fD(vec2 x) { float v = N(x + vec2(0.75, 0.5)).a * 0.55 + N(x * 2.11 + vec2(0.59, 0.97)).r * 0.3 + N(x * 4.33 + vec2(0.17, 0.33)).g * 0.15; return clamp((v - 0.5) * 2.2 + 0.5, 0.0, 1.0); }
// Smooth, large-scale versions (two broad scales only; no fine octaves): clouds, fog, broad dust.
float sA(vec2 x) { float v = N(x * 0.5).r * 0.68 + N(x * 1.03 + vec2(0.37, 0.11)).g * 0.32; return clamp((v - 0.5) * 2.6 + 0.5, 0.0, 1.0); }
float sB(vec2 x) { float v = N(x * 0.5 + vec2(0.5, 0.25)).g * 0.68 + N(x * 1.07 + vec2(0.13, 0.61)).b * 0.32; return clamp((v - 0.5) * 2.6 + 0.5, 0.0, 1.0); }
float sC(vec2 x) { float v = N(x * 0.5 + vec2(0.25, 0.75)).b * 0.68 + N(x * 1.01 + vec2(0.83, 0.41)).a * 0.32; return clamp((v - 0.5) * 2.6 + 0.5, 0.0, 1.0); }
float sD(vec2 x) { float v = N(x * 0.5 + vec2(0.75, 0.5)).a * 0.68 + N(x * 1.09 + vec2(0.59, 0.97)).r * 0.32; return clamp((v - 0.5) * 2.6 + 0.5, 0.0, 1.0); }
// Soft versions without the contrast stretch (no clipped plateaus, so no folded contours): veils, fog.
float uA(vec2 x) { return N(x * 0.5).r * 0.68 + N(x * 1.03 + vec2(0.37, 0.11)).g * 0.32; }
float uB(vec2 x) { return N(x * 0.5 + vec2(0.5, 0.25)).g * 0.68 + N(x * 1.07 + vec2(0.13, 0.61)).b * 0.32; }
float uC(vec2 x) { return N(x * 0.5 + vec2(0.25, 0.75)).b * 0.68 + N(x * 1.01 + vec2(0.83, 0.41)).a * 0.32; }
float uD(vec2 x) { return N(x * 0.5 + vec2(0.75, 0.5)).a * 0.68 + N(x * 1.09 + vec2(0.59, 0.97)).r * 0.32; }
// The storm flashes' light at p: a sum of soft glows (each variant lights its own gas / dust with it).
float flashLight(vec2 p) {
    float L = 0.0;
    for (int i = 0; i < 12; i++) {
        vec4 f = uFlash[i];
        if (f.w <= 0.0) continue;
        vec2 dp = p - f.xy;
        L += f.w * exp(-dot(dp, dp) / (f.z * f.z));
    }
    return 1.0 - exp(-L);
}
// Ridges (thin bright lines where the noise crosses its middle): dust lanes / filaments.
float ridge(float v) { return 1.0 - abs(2.0 * v - 1.0); }
float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}

// Radius in the galaxy's own ellipse (major axis uEll.xy, minor / major uEll.z).
float ellR(vec2 p) {
    vec2 q = vec2(dot(p, uEll.xy), dot(p, vec2(-uEll.y, uEll.x)) / uEll.z);
    return length(q);
}
// Log-spiral arms (count uArm.x, winding uArm.y, phase uArm.z, handedness uArm.w) at angle a, radius r.
float armPhase(float r, float a) { return uArm.x * (uArm.w * a - log(r) * uArm.y) + uArm.z; }
float armMask(float r, float a, float sharp) { return pow(0.5 + 0.5 * cos(armPhase(r, a)), sharp); }
// Where arms exist (between the core and the rim), in units of the outer radius.
float armBand(float rn) { return smoothstep(0.05, 0.28, rn) * (1.0 - smoothstep(0.85, 1.3, rn)); }

// Streak noise that follows the galaxy's structure at angle a (already turned): along the spiral lines for a spiral,
// along ellipses / the ring otherwise. Periodic in the angle (integer repeats), so there is no seam.
// Band-limited: near the centre the polar coordinates squeeze many noise cells into each pixel (concentric ripples),
// so the streaks give way there to smooth turning noise in plain coordinates.
float streak(vec2 p, float r, float a, vec2 off, int ch) {
    vec2 c;
    float px = length(fwidth(p));
    float fw;
    if (uParams.w < 0.5) {
        float lr = log(r);
        c = vec2((uArm.w * a - lr * uArm.y) / TAU * 20.0, lr * 0.85);
        fw = px / r * (20.0 / TAU * (1.0 + uArm.y));
    } else if (uParams.w < 2.5) {
        c = vec2(a / TAU * 7.0, ellR(p) * 4.5);
        fw = px / r * (7.0 / TAU) + px * 4.5 / uEll.z;
    } else {
        c = vec2(a / TAU * 5.0, r * 2.6) + vec2(fC(p * 0.4), fD(p * 0.4)) * 0.6;
        fw = px / r * (5.0 / TAU) + px * 2.6;
    }
    c += off;
    float k = 1.0 - smoothstep(0.06, 0.2, fw);
    vec2 q = vec2(cos(a), sin(a)) * r * 1.7 + off;
    float smooth_ = ch == 0 ? sA(q) : sB(q);
    return mix(smooth_, ch == 0 ? fA(c) : fB(c), k);
}

// ---------------------------------------------------------------------------------------------------------- Galactic Core
// Styled after a false-colour infrared picture of a large spiral: tightly wound, nearly concentric ring bands; glowing red
// dust filaments tracing each ring; cyan / ice-white granular young-star clumps on and just outside them (most in the
// bright, ragged outer ring); a soft green haze filling the disk between the rings; a compact white core with a
// white-yellow halo and a faint inner red ring; black outside with scattered point stars. Face-on, and every part is
// weighted by the real star density so it sits where the stars are.
const vec3 GC_RED = vec3(0.95, 0.13, 0.10);
const vec3 GC_CYAN = vec3(0.42, 0.86, 1.0);
const vec3 GC_ICE = vec3(0.80, 0.94, 1.0);
const vec3 GC_GREEN = vec3(0.10, 0.44, 0.17);
const vec3 GC_WHITE = vec3(1.0, 0.98, 0.94);
const vec3 GC_HALO = vec3(1.0, 0.86, 0.58);
// Kept for the sheen's colour ramp.
const vec3 GC_WARM = vec3(1.0, 0.83, 0.58);
const vec3 GC_COOL = vec3(0.48, 0.58, 0.92);

// Ring winding: 1 / tan(pitch) for a 4–6 degree pitch (nearly concentric), seeded.
float gcWind() { return 9.5 + 4.5 * fract(uMisc.w * 3.7); }
// Ring phase: a low-pitch spiral for a spiral; concentric about the galaxy's ellipse for elliptical / ring; density
// contours for irregular and cluster galaxies (the bands follow their own shape).
float gcPsi(vec2 p, float r, float a, vec3 d) {
    if (uParams.w < 0.5) return uArm.x * (uArm.w * a - log(max(r, 0.003)) * gcWind()) + uArm.z;
    if (uParams.w < 2.5) return -log(max(ellR(p), 0.003)) * gcWind() * 2.0 + uArm.z;
    return d.g * 26.0 + d.b * 9.0;
}
// Disk extent (ragged edge) and the inner cut-off around the core.
float gcDisk(vec2 p, float rn) { return 1.0 - smoothstep(0.8, 1.2, rn + 0.24 * (fA(p * 3.0 + 2.2) - 0.5)); }

// Young-star clumps: one candidate per cell, kept with probability ~ the cyan field at the cell (ring + just outside).
float gcCyanField(vec2 p, vec3 d) {
    float r = max(length(p), 0.003);
    float rn = r / uMisc.y;
    float psi = gcPsi(p, r, atan(p.y, p.x), d);
    float outside = pow(0.5 + 0.5 * cos(psi - 0.9), 3.0);
    return outside * gcDisk(p, rn) * smoothstep(0.08, 0.3, rn) * mix(0.35, 1.3, smoothstep(0.3, 0.88, rn));
}
vec3 knots(vec2 p, float scale, float prob, float seed) {
    vec2 g = p * scale;
    vec2 i = floor(g);
    vec2 f = g - i;
    vec3 acc = vec3(0.0);
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 c = i + vec2(float(x), float(y));
            vec2 h = hash22(c + seed);
            float keep = hash12(c * 1.71 + seed + 3.1);
            vec2 cp = (c + 0.5) / scale;
            if (keep > prob * gcCyanField(cp, texture(uDensity, uCentre + cp / (2.0 * uAspect)).rgb)) continue;
            vec2 o = vec2(float(x), float(y)) + h - f;
            float rad = 0.1 + 0.25 * hash12(c + seed + 7.7);
            float k = exp(-dot(o, o) / (rad * rad));
            acc += mix(GC_CYAN, GC_ICE, h.x) * k * (0.3 + 0.7 * h.y * h.y);
        }
    }
    return acc;
}

vec3 coreStatic(vec2 p, vec3 d) {
    float r = max(length(p), 0.0015);
    float rc = uEll.w;
    float rn = r / uMisc.y;
    // Ragged rings: the coordinates are warped at two scales before the ring phase.
    vec2 pw = p + (vec2(fA(p * 2.2 + 1.3), fB(p * 2.2 + 4.1)) - 0.5) * 0.05 + (vec2(fC(p * 7.0), fD(p * 7.0)) - 0.5) * 0.012;
    float rw = max(length(pw), 0.003);
    float aw = atan(pw.y, pw.x);
    float psi = gcPsi(pw, rw, aw, d);
    float ring = 0.5 + 0.5 * cos(psi);
    float disk = gcDisk(p, rn);
    float inner = smoothstep(0.05, 0.18, rn);
    float outerW = mix(0.45, 1.35, smoothstep(0.25, 0.85, rn));
    float starEnv = 0.4 + 0.6 * smoothstep(0.02, 0.6, d.g);
    // Ring segments: the bands break up.
    float seg = smoothstep(0.22, 0.68, fB(p * 2.6 + 7.1)) * (0.6 + 0.4 * sA(p * 1.2));

    // Streaks along the ring direction: noise in (along, across-ring) coordinates (integer repeats: no seam),
    // band-limited near the centre where the polar coordinates squeeze (smooth plain noise there).
    float px = length(fwidth(p));
    float along = aw / TAU * 20.0;
    float across = psi / TAU * 3.0;
    float fw = px / r * (20.0 / TAU + 3.0 * uArm.x * gcWind() / TAU);
    float k = 1.0 - smoothstep(0.08, 0.3, fw);
    float streakN = mix(sA(p * 6.0), fA(vec2(along, across)), k);
    float fil = mix(0.4, pow(ridge(fC(vec2(along * 1.7 + 0.3, across * 1.7))), 3.0), k);

    // Red dust / gas filaments on every ring crest, clumpy and streaky, strongest outside.
    float crest = pow(ring, mix(3.0, 9.0, sC(p * 2.0 + 5.5)));
    float red = (crest * (0.3 + 1.3 * streakN * streakN) + fil * ring * 0.35) * seg * outerW * disk * inner * starEnv;
    // A faint inner red ring close to the core.
    red += exp(-pow((r - rc * 1.8) / (rc * 0.5), 2.0)) * 0.45 * (0.4 + 0.9 * fA(p * 9.0)) * uMisc.x;

    // Cyan young stars: field + clumps + granular speckle, mostly on / just outside the rings and in the outer ring.
    float cy = gcCyanField(pw, d) * (0.45 + 0.9 * fD(p * 3.1 + 2.4)) * starEnv;
    vec3 kn = knots(p, 70.0, 0.55, 11.0) * 0.8 + knots(p, 170.0, 0.5, 29.0) * 0.6;
    float h1 = hash12(floor(gl_FragCoord.xy) + 17.0);
    float h2 = hash12(floor(gl_FragCoord.xy) * 1.37 + 3.0);
    float h3 = hash12(floor(gl_FragCoord.xy) * 0.73 + 41.0);
    float speck = pow(h1, 12.0) * cy * 2.2;

    // Green haze filling the disk, dimmer in the gaps between the rings, never empty.
    float haze = disk * (0.5 * pow(d.b, 0.9) + 0.3 * d.g + 0.3 * exp(-(rn * rn) / 0.3)) * (0.6 + 0.8 * sC(p * 2.5 + 1.0));
    haze *= mix(0.5, 1.0, smoothstep(0.0, 0.6, ring)) * (1.0 - 0.7 * crest);

    // Core: a compact, intensely bright white point and a soft white-yellow halo, slightly lopsided.
    vec2 pc = p + (vec2(sA(p * 3.0 + 1.1), sB(p * 3.0 + 5.3)) - 0.5) * rc * 0.25;
    float qe = length(pc);
    float point = exp(-pow(qe / (rc * 0.16), 2.0)) * 3.0;
    float halo = exp(-pow(qe / (rc * 0.6), 2.0)) * 0.8 + exp(-qe / (rc * 1.3)) * 0.22;

    vec3 c = GC_RED * red * 0.8 + (GC_CYAN * cy * 0.55 + kn * 1.2 + GC_ICE * speck * 0.9) * disk + GC_GREEN * haze * 0.6;
    c += uMisc.x * (GC_WHITE * point + GC_HALO * halo * (0.85 + 0.3 * fC(p * 11.0)));
    c *= 0.82 + 0.36 * h2;
    // Scattered point stars everywhere, some green, some white.
    c += mix(vec3(0.85, 0.92, 1.0), vec3(0.35, 1.0, 0.45), step(0.6, h1)) * pow(h3, 300.0) * 0.6;
    c = vec3(1.0) - exp(-c * 1.25);
    return vec3(0.002, 0.003, 0.004) + c;
}

vec4 coreAnim(vec2 p, vec3 d, float t) {
    float r = max(length(p), 0.015);
    float th = atan(p.y, p.x);
    float rn = r / uMisc.y;
    // A soft sheen of light flowing along the (fixed, star-aligned) rings of the static picture: smooth noise turned
    // slowly (~48 min a turn) and differentially (faster inside), in two phases cross-faded every 90 s so the winding
    // never builds up. All detail is in the static texture.
    float rot = 0.0022 * t;
    float T = 90.0;
    float ph0 = fract(t / T);
    float ph1 = fract(t / T + 0.5);
    float w0 = 1.0 - abs(2.0 * ph0 - 1.0);
    float om = 0.009 / (0.25 + rn);
    float a0 = th + uArm.w * (rot + om * ph0 * T);
    float a1 = th + uArm.w * (rot + om * ph1 * T);
    float s = mix(sA(vec2(cos(a1), sin(a1)) * r * 4.0 + vec2(0.6, 0.1)), sA(vec2(cos(a0), sin(a0)) * r * 4.0 + vec2(0.3, 0.8)), w0);
    float ring = 0.5 + 0.5 * cos(gcPsi(p, r, th, d));
    float disk = gcDisk(p, rn) * smoothstep(0.03, 0.15, rn);
    float env = 0.35 + 0.65 * smoothstep(0.02, 0.6, d.g);
    float g = (pow(ring, 2.0) * 0.7 + 0.15) * s * s * disk * env;
    float coreSwirl = exp(-(rn * rn) / 0.03) * uMisc.x * (s - 0.35) * 0.4;
    vec3 col = mix(GC_CYAN, GC_RED, pow(ring, 4.0)) * max(0.0, g * 0.16) + GC_HALO * max(0.0, coreSwirl * 0.2);
    // Storm flashes: white-cyan light in the rings' stars, red glow in their dust, brighter where there is material.
    float L = flashLight(p);
    if (L > 0.0) {
        float crest = pow(ring, 5.0);
        float medium = (0.2 + 0.8 * ring) * disk * env * (0.5 + 0.9 * sA(p * 7.0 + 3.3));
        col += mix(GC_ICE * 0.85, GC_RED * 1.1, crest) * L * medium * 0.3;
    }
    return vec4(col, 0.0);
}

// ------------------------------------------------------------------------------------------------------------------ Eerie
const vec3 EE_TINT = vec3(0.47, 0.54, 0.56);

float vignette(vec2 uv) {
    vec2 q = (uv - 0.5) * 2.0;
    return mix(0.42, 1.0, 1.0 - smoothstep(0.55, 1.45, length(q)));
}

vec3 eerieStatic(vec2 uv, vec2 p, vec3 d) {
    float glow = 0.075 * pow(d.b, 1.2) + 0.04 * d.g;
    // Sparse lanes: soft ridges, only where a broad mask allows (most of the sky has none).
    float sparse = smoothstep(0.55, 0.72, sD(p * 0.7 + 3.7));
    float lane = smoothstep(0.78, 0.97, ridge(sA(p * 1.5 + vec2(sC(p * 0.8), sB(p * 0.8)) * 0.5))) * sparse;
    vec3 c = EE_TINT * (glow * (1.0 - 0.75 * lane) + lane * 0.02);
    return (vec3(0.005, 0.006, 0.007) + c) * vignette(uv);
}

vec4 eerieAnim(vec2 uv, vec2 p, vec3 d, float t) {
    // Fog like real fog: banks of varied thickness with clear gaps between them, billowing (a slow drifting warp) as
    // they drift, the far layer slower than the near one.
    vec2 wf = (vec2(uC(p * 0.9 + vec2(0.0011, 0.0006) * t), uD(p * 0.9 + vec2(4.1, 1.7) - vec2(0.0008, 0.0013) * t)) - 0.5) * 0.5;
    float banks = smoothstep(0.44, 0.66, uA(p * 0.55 + wf + vec2(0.0019, 0.0008) * t));
    float f1 = uA(p * 1.2 + wf * 1.5 + vec2(0.0042, 0.0016) * t);
    float f2 = uB(p * 2.6 + wf * 2.0 - vec2(0.0023, -0.0035) * t);
    float thick = smoothstep(0.38, 0.72, f1 * 0.6 + f2 * 0.4);
    float fog = banks * (0.25 + 0.75 * thick) * (0.5 + 0.5 * smoothstep(0.0, 0.45, d.b));
    // Drifting dust: broad soft dark lanes that cut the fog, with a faint lit rim.
    float sparse = smoothstep(0.45, 0.68, sD(p * 0.7 + 3.7 + vec2(0.0012, -0.0007) * t));
    float rd = ridge(sC(p * 1.8 + vec2(-0.003, 0.0019) * t));
    float dust = smoothstep(0.72, 0.95, rd) * sparse * 0.7;
    float rim = (smoothstep(0.55, 0.75, rd) - smoothstep(0.75, 0.92, rd)) * sparse;
    // Now and then a very faint pulse: one chance every 19 s (seeded slot hash), rising over ~2 s, dying over ~6 s.
    float pulse = 0.0;
    float P = 19.0;
    float k = floor(t / P);
    for (int i = 0; i < 2; i++) {
        float ks = k - float(i);
        vec2 h = hash22(vec2(ks * 1.37 + uMisc.z * 97.0, ks * 0.71 + uMisc.w * 89.0));
        if (h.x > 0.5) continue;
        vec2 h2 = hash22(vec2(ks * 3.11 + 5.3, ks * 2.03 + uMisc.z * 41.0));
        vec2 at = (h2 - 0.5) * 1.5;
        float age = t - ks * P - h.y * 6.0;
        if (age <= 0.0) continue;
        float env = smoothstep(0.0, 2.2, age) * exp(-age / 3.5);
        float rad = 0.12 + 0.12 * h.x;
        vec2 dp = p - at;
        pulse += env * exp(-dot(dp, dp) / (rad * rad)) * (0.6 + 0.8 * sA(p * 2.3 + h2));
    }
    vec3 col = EE_TINT * (fog * 0.12 * (1.0 + 3.0 * pulse) + rim * fog * 0.03 + pulse * 0.03) * vignette(uv);
    // Storm flashes: cold pale light in the fog, and the cracks lit from within.
    float L = flashLight(p);
    float crack = smoothstep(0.72, 0.95, rd) * sparse;
    if (L > 0.0) {
        col += vec3(0.62, 0.74, 0.80) * L * (fog * 0.35 + crack * 0.55 + 0.04) * 0.4;
        dust *= 1.0 - 0.7 * L * crack;
    }
    return vec4(col * (1.0 - dust), clamp(dust + fog * 0.04, 0.0, 1.0));
}

// ----------------------------------------------------------------------------------------------------------------- Nebula
// The user's palette: dark green and purple / dark pink. Colour drift stays within those hues.
const vec3 NB_GREEN_A = vec3(0.035, 0.17, 0.085);
const vec3 NB_GREEN_B = vec3(0.06, 0.23, 0.15);
const vec3 NB_PURPLE = vec3(0.19, 0.045, 0.26);
const vec3 NB_PINK = vec3(0.31, 0.05, 0.19);

float nebulaArms(vec2 p, float t) {
    if (uParams.w > 0.5) return 1.0;
    float r = max(length(p), 0.015);
    float rn = r / uMisc.y;
    float a = atan(p.y, p.x) + uArm.w * 0.0011 * t;
    return mix(0.35, 1.25, armMask(r, a, 1.6)) * mix(1.0, armBand(rn), 0.6);
}

vec3 nebulaStatic(vec2 p, vec3 d) {
    // Faint under-glow, green or purple by a broad noise (never both added: that would read grey-blue).
    float glow = 0.6 * pow(d.b, 1.4) + 0.4 * pow(d.g, 1.3);
    vec3 c = mix(NB_GREEN_A, NB_PURPLE, smoothstep(0.35, 0.65, sD(p * 0.45 + 1.9))) * glow * 0.3;
    return vec3(0.005, 0.004, 0.007) + c * (0.8 + 0.4 * sC(p * 0.9));
}

vec4 nebulaAnim(vec2 p, vec3 d, float t) {
    vec2 q = p * 0.6;
    // Churn: a two-level smooth domain warp whose fields move with time.
    vec2 w1 = vec2(uA(q * 0.9 + vec2(0.0035, 0.002) * t), uB(q * 0.9 + vec2(5.2, 1.3) - vec2(0.0013, 0.0031) * t)) - 0.5;
    vec2 w = q + 0.9 * w1;
    vec2 w2 = vec2(uC(w * 1.4 + vec2(1.7, 9.2) + 0.0042 * t), uD(w * 1.4 + vec2(8.3, 2.8) - 0.0037 * t)) - 0.5;
    vec2 ww = w + 0.5 * w2;
    float env = (0.3 + 0.7 * smoothstep(0.02, 0.55, d.g)) * nebulaArms(p, t) * (1.0 - smoothstep(1.0, 1.5, length(p) / uMisc.y));
    // Diffuse, glowing clouds with feathered edges: thin translucent veils over wide areas, and denser glowing knots.
    float veil = smoothstep(0.36, 0.72, uA(ww * 0.9 + vec2(0.37, 0.91)));
    float knot = pow(smoothstep(0.5, 0.78, uB(ww * 1.6 + vec2(3.1, 7.7))), 1.5);
    float dens = (veil * 0.45 + knot * veil * 0.9) * env;
    // Which gas: a broad soft selector (the change-over is dimmed, so green and purple never mix to grey-blue).
    float m = smoothstep(0.4, 0.6, uC(w * 0.55 + vec2(2.2, 0.4)));
    float over = 1.0 - 0.55 * 4.0 * m * (1.0 - m);
    // Slow colour drift, within the palette; gentler saturation.
    vec3 cg = mix(NB_GREEN_A, NB_GREEN_B, 0.5 + 0.5 * sin(t * 0.011 + uMisc.z * 6.0));
    vec3 cv = mix(NB_PURPLE, NB_PINK, 0.5 + 0.5 * sin(t * 0.0087 + 1.3 + uMisc.w * 6.0));
    vec3 tint = mix(cg, cv, m);
    tint = mix(vec3(dot(tint, vec3(0.3, 0.55, 0.15))), tint, 0.78);
    vec3 col = tint * dens * over * 2.1;
    col = vec3(0.45) * (vec3(1.0) - exp(-col / 0.45));
    // Dark dust: soft clouds of it, feathered, translucent (the stars show through).
    float dust = smoothstep(0.5, 0.78, uD(w * 0.85 + vec2(2.9, 0.6))) * 0.5;
    // Storm flashes: green / pink glows inside the clouds, brighter where the gas is thicker.
    float L = flashLight(p);
    if (L > 0.0) {
        vec3 fl = mix(vec3(0.35, 0.95, 0.55), vec3(0.95, 0.4, 0.75), m);
        col += fl * L * (dens * 0.9 + 0.03) * 0.35;
    }
    return vec4(col * (1.0 - dust), dust);
}

// -------------------------------------------------------------------------------------------------------------------------
void main() {
    vec2 uv = uBand.xy + vUv * uBand.zw;
    vec2 p = (uv - uCentre) * 2.0 * uAspect;
    vec3 d = texture(uDensity, uv).rgb;
    float kind = uParams.x;
    float pass = uParams.y;
    float t = uParams.z;
    vec3 st = vec3(0.0);
    vec4 an = vec4(0.0);
    if (pass != 1.0) st = kind < 0.5 ? coreStatic(p, d) : kind < 1.5 ? eerieStatic(uv, p, d) : nebulaStatic(p, d);
    if (pass != 0.0) an = kind < 0.5 ? coreAnim(p, d, t) : kind < 1.5 ? eerieAnim(uv, p, d, t) : nebulaAnim(p, d, t);
    // Half an 8-bit step of noise against banding (an 8-bit target; the screen output dither does the rest).
    float n = (hash12(floor(gl_FragCoord.xy)) - 0.5) / 255.0;
    if (pass == 0.0) outColor = vec4(st + n, 1.0);
    else if (pass == 1.0) outColor = vec4(max(an.rgb + n * step(0.0005, an.a + dot(an.rgb, vec3(1.0))), 0.0), an.a);
    else outColor = vec4(an.rgb + st * (1.0 - an.a) + n, 1.0);
}`;

/** uParams.x per kind. */
export const BACKDROP_KIND_CODE = { galacticCore: 0, eerie: 1, nebula: 2 } as const;
export type GeneratedBackdropKind = keyof typeof BACKDROP_KIND_CODE;
