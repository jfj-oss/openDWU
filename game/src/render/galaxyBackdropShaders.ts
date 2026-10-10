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
const vec3 GC_WARM = vec3(1.0, 0.83, 0.58);
const vec3 GC_COOL = vec3(0.48, 0.58, 0.92);

const vec3 GC_PINK = vec3(1.0, 0.55, 0.72);
const vec3 GC_BLUE = vec3(0.62, 0.76, 1.0);

// The smooth arm (or disk) envelope at p, without detail: where knots may form.
float armField(vec2 p) {
    float r = max(length(p), 0.015);
    float rn = r / uMisc.y;
    if (uParams.w < 0.5) return armMask(r, atan(p.y, p.x), 2.0) * armBand(rn);
    return smoothstep(0.03, 0.5, texture(uDensity, uCentre + p / (2.0 * uAspect)).g) * (1.0 - smoothstep(0.9, 1.3, rn));
}

// Star-forming knots: one candidate per cell (scale cells per unit), kept with probability ~ the arm envelope at the
// cell, pink (HII-like) or blue, of random size and brightness.
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
            if (keep > prob * armField((c + 0.5) / scale)) continue;
            vec2 o = vec2(float(x), float(y)) + h - f;
            float rad = 0.12 + 0.22 * hash12(c + seed + 7.7);
            float k = exp(-dot(o, o) / (rad * rad));
            acc += mix(GC_BLUE, GC_PINK, step(0.45, h.x)) * k * (0.35 + 0.65 * h.y * h.y);
        }
    }
    return acc;
}

// Ragged dust: ridged multi-octave noise, filaments at several scales with patchy opacity.
float dustFilaments(vec2 p) {
    vec2 w = p + (vec2(fA(p * 1.3 + 4.1), fB(p * 1.3 + 2.7)) - 0.5) * 0.25;
    float r1 = pow(ridge(fC(w * 2.3)), 4.0);
    float r2 = pow(ridge(fD(w * 5.9 + 1.3)), 6.0);
    float r3 = pow(ridge(fA(w * 13.0 + 7.9)), 8.0);
    float opacity = smoothstep(0.3, 0.75, fB(w * 1.7 + 9.1));
    return clamp((r1 * 0.55 + r2 * 0.45 + r3 * 0.35) * opacity, 0.0, 1.0);
}

vec3 coreStatic(vec2 p, vec3 d) {
    float r = max(length(p), 0.0015);
    float th = atan(p.y, p.x);
    float rc = uEll.w;
    float rn = r / uMisc.y;
    // Core: an oval bulge with a bar hint along a seeded angle, slightly lopsided (warped), with grain in it.
    float barA = uMisc.z * TAU;
    float barK = 0.25 + 0.45 * fract(uMisc.w * 7.31);
    vec2 pc = p + (vec2(sA(p * 3.0 + 1.1), sB(p * 3.0 + 5.3)) - 0.5) * rc * 0.5;
    vec2 qb = vec2(dot(pc, vec2(cos(barA), sin(barA))), dot(pc, vec2(-sin(barA), cos(barA))));
    qb.x /= 1.0 + barK * (uParams.w < 1.5 ? 1.0 : 0.3);
    float qe = ellR(pc) * 0.5 + length(qb) * 0.5;
    float bar = exp(-(qb.y * qb.y) / (rc * rc * 0.06) - (qb.x * qb.x) / (rc * rc * 1.6)) * barK * (uParams.w < 1.5 ? 1.0 : 0.0);
    float core = uMisc.x * (1.6 * exp(-(qe * qe) / (rc * rc * 0.3)) + 0.55 * exp(-qe / (rc * 1.5)) + 0.5 * bar);
    core *= 0.86 + 0.28 * fC(p * 11.0);

    // Arms: warped (so no perfect log spiral), uneven width, gaps along them, feathers / spurs off them.
    float aw = th + 0.4 * (fA(p * 1.6 + 0.7) - 0.5) + 0.14 * (fB(p * 5.0 + 2.2) - 0.5);
    float rw = r * (1.0 + 0.16 * (fC(p * 2.4 + 3.3) - 0.5));
    float arms;
    float spur;
    float lane;
    float band = armBand(rn);
    if (uParams.w < 0.5) {
        float psi = armPhase(rw, aw);
        float sharp = mix(1.4, 4.8, sA(p * 1.9 + 8.1));
        arms = pow(0.5 + 0.5 * cos(psi), sharp);
        // Gaps: along-arm noise in log-spiral coordinates.
        float along = (uArm.w * aw - log(rw) * uArm.y) / TAU;
        arms *= 0.35 + 0.65 * smoothstep(0.3, 0.65, sB(vec2(along * 3.0, log(rw) * 1.3) + 0.4));
        // Feathers: a tighter, more open pattern crossing the arms, only near them.
        float fpsi = uArm.x * 3.0 * (uArm.w * aw - log(rw) * uArm.y * 0.35) + uArm.z * 2.0;
        spur = pow(0.5 + 0.5 * cos(fpsi), 6.0) * smoothstep(0.05, 0.5, pow(0.5 + 0.5 * cos(psi - 0.5), 1.5)) * fA(p * 4.0 + 6.6);
        // Dust lanes on the arms' inner edges, ragged.
        lane = pow(0.5 + 0.5 * cos(psi + 0.95), 5.0);
        arms *= band;
        spur *= band;
        lane *= band;
    } else {
        // No arms: a patchy disk following the stars, streaked along the galaxy's ellipse.
        float e = ellR(p);
        arms = armField(p) * (0.4 + 0.8 * fA(vec2(aw / TAU * 7.0, e * 6.0)));
        spur = 0.0;
        lane = smoothstep(0.45, 0.8, sC(vec2(aw / TAU * 5.0, e * 4.0) + 1.7)) * armField(p);
    }
    float clump = 0.55 + 0.9 * fA(p * 7.0 + 3.9) * fB(p * 3.1 + 1.2) * 1.6;
    float env = 0.3 + 0.7 * smoothstep(0.02, 0.6, d.g);
    float armLight = (arms * clump + spur * 0.35) * env;
    // Faint haze between the arms, following the stars, never flat.
    float haze = (0.12 * pow(d.b, 1.3) + 0.08 * d.g) * (0.6 + 0.8 * fC(p * 4.5 + 2.0));
    vec3 kn = knots(p, 38.0, 0.55, 11.0) * 0.55 + knots(p, 105.0, 0.45, 29.0) * 0.4;

    // Dust: ragged lanes, filaments over the disk, patches across the core.
    float fil = dustFilaments(p);
    float dust = lane * (0.35 + 0.65 * fil) * 0.8 + fil * 0.3 * smoothstep(0.05, 0.6, d.g) * smoothstep(0.05, 0.3, rn + 0.1);
    dust += exp(-(r * r) / (rc * rc * 6.0)) * smoothstep(0.25, 0.7, pow(ridge(fD(p * 6.5 + 4.4)), 2.0)) * 0.45;
    dust = clamp(dust * (0.6 + 0.6 * sD(p * 2.2 + 0.3)), 0.0, 0.85);

    // Colour: warm yellow-white core to bluer outer arms.
    vec3 diskCol = mix(GC_WARM, GC_COOL, smoothstep(0.08, 0.7, rn));
    vec3 c = GC_WARM * core * (1.0 - dust * 0.6) + (diskCol * (armLight * 0.42 + haze) + kn * env * (0.4 + 0.6 * arms)) * (1.0 - dust);
    // Unresolved stars: per-texel grain where the stars are, and the odd faint point.
    float h1 = hash12(floor(gl_FragCoord.xy) + 17.0);
    float h2 = hash12(floor(gl_FragCoord.xy) * 1.37 + 3.0);
    float starDen = 0.25 + 0.75 * smoothstep(0.0, 0.7, d.g + core * 0.3);
    c *= 0.8 + 0.4 * h1;
    c += vec3(0.85, 0.9, 1.0) * pow(h2, 60.0) * 0.35 * starDen;
    c += diskCol * (h1 * h1) * 0.012 * starDen;
    c = vec3(1.0) - exp(-c * 1.15);
    return vec3(0.004, 0.005, 0.011) + c * 0.96;
}

vec4 coreAnim(vec2 p, vec3 d, float t) {
    float r = max(length(p), 0.015);
    float th = atan(p.y, p.x);
    float rn = r / uMisc.y;
    // A soft sheen of light flowing along the (fixed, star-aligned) arms of the static picture: the streaks turn slowly
    // (~48 min a turn) and differentially (faster inside), in two phases cross-faded every 90 s so the winding never
    // builds up. The detail (knots, dust, feathers) is all in the static texture.
    float rot = 0.0022 * t;
    float T = 90.0;
    float ph0 = fract(t / T);
    float ph1 = fract(t / T + 0.5);
    float w0 = 1.0 - abs(2.0 * ph0 - 1.0);
    float om = 0.009 / (0.25 + rn);
    float a0 = th + uArm.w * (rot + om * ph0 * T);
    float a1 = th + uArm.w * (rot + om * ph1 * T);
    float s = mix(streak(p, r, a1, vec2(0.5, 0.31), 0), streak(p, r, a0, vec2(0.0), 0), w0);
    float ar = th;
    float env = 0.35 + 0.65 * smoothstep(0.02, 0.6, d.g);
    float g;
    if (uParams.w < 0.5) {
        float band = armBand(rn);
        float arm = armMask(r, ar, 2.5) * band;
        g = (arm * (0.15 + 0.7 * s) + 0.08 * s * band) * env;
    } else {
        float fade = 1.0 - smoothstep(0.95, 1.4, rn);
        g = pow(s, 1.6) * 0.6 * fade * (0.15 + 0.85 * smoothstep(0.03, 0.55, d.g));
    }
    // The core light swirls too: a faint turning texture inside the core radius.
    float coreSwirl = exp(-(rn * rn) / 0.05) * uMisc.x * (mix(sA(vec2(cos(a1), sin(a1)) * r * 2.2 + vec2(0.6, 0.1)), sA(vec2(cos(a0), sin(a0)) * r * 2.2 + vec2(0.3, 0.8)), w0) - 0.35) * 0.5;
    vec3 col = mix(GC_WARM, GC_COOL, smoothstep(0.1, 0.8, rn)) * max(0.0, g * 0.2 + coreSwirl * 0.25);
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
    // Two soft fog layers drifting different ways; faint, but clearly there.
    float f1 = sA(p * 1.1 + vec2(0.0042, 0.0016) * t);
    float f2 = sB(p * 2.0 - vec2(0.0023, -0.0035) * t);
    float fog = smoothstep(0.38, 0.88, f1 * 0.65 + f2 * 0.35) * (0.45 + 0.55 * smoothstep(0.0, 0.45, d.b));
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
    vec3 col = EE_TINT * (fog * 0.10 * (1.0 + 3.0 * pulse) + rim * fog * 0.03 + pulse * 0.03) * vignette(uv);
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

// One billowing cloud field: broad smooth fBm, domain-warped; the density as 0..1.
float cloud(vec2 w, vec2 off, int ch) {
    float v = ch == 0 ? sA(w + off) : sB(w + off);
    float v2 = ch == 0 ? sC(w * 1.9 + off.yx) : sD(w * 1.9 + off.yx);
    return clamp(v * 0.75 + v2 * 0.25, 0.0, 1.0);
}

vec4 nebulaAnim(vec2 p, vec3 d, float t) {
    vec2 q = p * 0.6;
    // Churn: a two-level smooth domain warp whose fields move with time.
    vec2 w1 = vec2(sA(q * 0.9 + vec2(0.0035, 0.002) * t), sB(q * 0.9 + vec2(5.2, 1.3) - vec2(0.0013, 0.0031) * t)) - 0.5;
    vec2 w = q + 0.55 * w1;
    vec2 w2 = vec2(sC(w * 1.4 + vec2(1.7, 9.2) + 0.0042 * t), sD(w * 1.4 + vec2(8.3, 2.8) - 0.0037 * t)) - 0.5;
    vec2 ww = w + 0.3 * w2;
    float env = (0.25 + 0.75 * smoothstep(0.02, 0.55, d.g)) * nebulaArms(p, t) * (1.0 - smoothstep(1.05, 1.5, length(p) / uMisc.y));
    float cA = cloud(ww, vec2(0.37, 0.91), 0);
    float cB = cloud(ww * 1.15, vec2(3.1, 7.7), 1);
    float green = smoothstep(0.38, 0.92, cA) * env;
    // Where both gases are thick the greener one gives way, so the colours stay green or purple / pink, not mixed.
    float violet = smoothstep(0.4, 0.95, cB) * env * (1.0 - 0.75 * smoothstep(0.3, 0.8, green / max(env, 0.001)));
    // Wispy filaments only at the cloud edges (where the density is middling), at a moderate scale.
    float edgeA = green * (1.0 - green) * 4.0;
    float edgeB = violet * (1.0 - violet) * 4.0;
    float wisp = smoothstep(0.5, 0.92, ridge(sC(ww * 3.4 + vec2(0.41, 0.13))));
    // Brightness range: soft edges, glowing denser cores.
    float bA = green * 0.55 + green * green * green * 1.9 + edgeA * wisp * 0.22;
    float bB = violet * 0.55 + violet * violet * violet * 1.9 + edgeB * wisp * 0.22;
    // Slow colour drift, within the palette.
    vec3 cg = mix(NB_GREEN_A, NB_GREEN_B, 0.5 + 0.5 * sin(t * 0.011 + uMisc.z * 6.0));
    vec3 cv = mix(NB_PURPLE, NB_PINK, 0.5 + 0.5 * sin(t * 0.0087 + 1.3 + uMisc.w * 6.0));
    vec3 col = cg * bA * 1.25 + cv * bB * 1.2;
    col = vec3(0.55) * (vec3(1.0) - exp(-col / 0.55));
    // Dark dust: broad smooth lanes along the warped flow plus large dark patches.
    float lanes = pow(ridge(sC(w * 1.3 + vec2(0.41, 0.13))), 5.0) * (0.4 + 0.6 * env);
    float patches = smoothstep(0.58, 0.86, sD(w * 0.8 + vec2(2.9, 0.6))) * 0.6;
    float dust = clamp(lanes * 0.75 + patches, 0.0, 0.88);
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
