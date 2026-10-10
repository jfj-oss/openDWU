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

const float TAU = 6.28318530718;

vec4 N(vec2 x) { return texture(uNoise, x + uMisc.zw); }
// Three scales of the periodic noise; each channel is already 4-octave fBm. Stretched so the spread is useful.
float fA(vec2 x) { float v = N(x).r * 0.55 + N(x * 2.13 + vec2(0.37, 0.11)).g * 0.3 + N(x * 4.37 + vec2(0.71, 0.53)).b * 0.15; return clamp((v - 0.5) * 2.2 + 0.5, 0.0, 1.0); }
float fB(vec2 x) { float v = N(x + vec2(0.5, 0.25)).g * 0.55 + N(x * 2.07 + vec2(0.13, 0.61)).b * 0.3 + N(x * 4.21 + vec2(0.29, 0.87)).a * 0.15; return clamp((v - 0.5) * 2.2 + 0.5, 0.0, 1.0); }
float fC(vec2 x) { float v = N(x + vec2(0.25, 0.75)).b * 0.55 + N(x * 2.19 + vec2(0.83, 0.41)).a * 0.3 + N(x * 4.29 + vec2(0.47, 0.07)).r * 0.15; return clamp((v - 0.5) * 2.2 + 0.5, 0.0, 1.0); }
float fD(vec2 x) { float v = N(x + vec2(0.75, 0.5)).a * 0.55 + N(x * 2.11 + vec2(0.59, 0.97)).r * 0.3 + N(x * 4.33 + vec2(0.17, 0.33)).g * 0.15; return clamp((v - 0.5) * 2.2 + 0.5, 0.0, 1.0); }
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
float streak(vec2 p, float r, float a, vec2 off, int ch) {
    vec2 c;
    if (uParams.w < 0.5) {
        float lr = log(r);
        c = vec2((uArm.w * a - lr * uArm.y) / TAU * 20.0, lr * 0.85);
    } else if (uParams.w < 2.5) {
        c = vec2(a / TAU * 7.0, ellR(p) * 4.5);
    } else {
        c = vec2(a / TAU * 5.0, r * 2.6) + vec2(fC(p * 0.4), fD(p * 0.4)) * 0.6;
    }
    c += off;
    return ch == 0 ? fA(c) : fB(c);
}

// ---------------------------------------------------------------------------------------------------------- Galactic Core
const vec3 GC_WARM = vec3(1.0, 0.83, 0.58);
const vec3 GC_COOL = vec3(0.48, 0.58, 0.92);

vec3 coreStatic(vec2 p, vec3 d) {
    float r = length(p);
    float re = ellR(p);
    float rc = uEll.w;
    float rn = r / uMisc.y;
    float core = uMisc.x * (1.7 * exp(-(re * re) / (rc * rc * 0.3)) + 0.6 * exp(-re / (rc * 1.5)));
    float body = 0.55 * pow(d.b, 1.6) + 0.42 * pow(d.g, 1.4) + 0.14 * d.r;
    float grain = 0.72 + 0.56 * fC(p * 3.1);
    vec3 c = GC_WARM * core + mix(GC_WARM * 0.95, GC_COOL, smoothstep(0.05, 0.75, rn)) * body * grain * 0.28;
    c = vec3(1.0) - exp(-c * 1.15);
    return vec3(0.004, 0.005, 0.011) + c * 0.96;
}

vec4 coreAnim(vec2 p, vec3 d, float t) {
    float r = max(length(p), 0.015);
    float th = atan(p.y, p.x);
    float rn = r / uMisc.y;
    // The arm pattern turns rigidly and slowly (~48 min a turn); the streaks in it turn differentially (faster inside),
    // in two phases cross-faded every 90 s so the winding never builds up.
    float rot = 0.0022 * t;
    float T = 90.0;
    float ph0 = fract(t / T);
    float ph1 = fract(t / T + 0.5);
    float w0 = 1.0 - abs(2.0 * ph0 - 1.0);
    float om = 0.009 / (0.25 + rn);
    float a0 = th + uArm.w * (rot + om * ph0 * T);
    float a1 = th + uArm.w * (rot + om * ph1 * T);
    float s = mix(streak(p, r, a1, vec2(0.5, 0.31), 0), streak(p, r, a0, vec2(0.0), 0), w0);
    float s2 = mix(streak(p, r, a1, vec2(0.21, 0.67), 1), streak(p, r, a0, vec2(0.73, 0.05), 1), w0);
    float ar = th + uArm.w * rot;
    float env = 0.35 + 0.65 * smoothstep(0.02, 0.6, d.g);
    float g;
    float dust;
    if (uParams.w < 0.5) {
        float band = armBand(rn);
        float arm = armMask(r, ar, 2.5) * band;
        g = (arm * (0.3 + 1.0 * s) + 0.1 * s * band) * env;
        float lane = pow(0.5 + 0.5 * cos(armPhase(r, ar) + 1.0), 7.0) * band;
        dust = lane * smoothstep(0.4, 0.75, s2) * 0.6 * (0.35 + 0.65 * d.b);
    } else {
        float fade = 1.0 - smoothstep(0.95, 1.4, rn);
        g = pow(s, 1.6) * 0.9 * fade * (0.15 + 0.85 * smoothstep(0.03, 0.55, d.g));
        dust = smoothstep(0.62, 0.85, s2) * 0.4 * smoothstep(0.05, 0.5, d.g) * smoothstep(0.1, 0.35, rn);
    }
    // The core light swirls too: a faint turning texture inside the core radius.
    float coreSwirl = exp(-(rn * rn) / 0.05) * uMisc.x * (s - 0.35) * 0.5;
    vec3 col = mix(GC_WARM, GC_COOL, smoothstep(0.1, 0.8, rn)) * max(0.0, g * 0.3 + coreSwirl * 0.3);
    return vec4(col * (1.0 - dust), dust);
}

// ------------------------------------------------------------------------------------------------------------------ Eerie
const vec3 EE_TINT = vec3(0.47, 0.54, 0.56);

float vignette(vec2 uv) {
    vec2 q = (uv - 0.5) * 2.0;
    return mix(0.42, 1.0, 1.0 - smoothstep(0.55, 1.45, length(q)));
}

vec3 eerieStatic(vec2 uv, vec2 p, vec3 d) {
    float glow = 0.05 * pow(d.b, 1.3) + 0.025 * d.g;
    // Sparse lanes: thin ridges, only where a broad mask allows (most of the sky has none).
    float sparse = smoothstep(0.58, 0.72, fD(p * 0.55 + 3.7));
    float lane = smoothstep(0.86, 0.98, ridge(fA(p * 1.9 + vec2(fC(p * 0.7), fB(p * 0.7)) * 0.5))) * sparse;
    vec3 c = EE_TINT * (glow * (1.0 - 0.7 * lane) + lane * 0.012);
    return (vec3(0.005, 0.006, 0.007) + c) * vignette(uv);
}

vec4 eerieAnim(vec2 uv, vec2 p, vec3 d, float t) {
    float f1 = fA(p * 0.9 + vec2(0.0029, 0.0011) * t);
    float f2 = fB(p * 1.9 - vec2(0.0016, -0.0024) * t);
    float fog = smoothstep(0.5, 0.9, f1 * 0.65 + f2 * 0.35) * (0.3 + 0.7 * smoothstep(0.0, 0.45, d.b));
    float sparse = smoothstep(0.58, 0.72, fD(p * 0.55 + 3.7 + vec2(0.0007, -0.0004) * t));
    float dust = smoothstep(0.84, 0.97, ridge(fC(p * 2.6 + vec2(-0.0021, 0.0013) * t))) * sparse * 0.5;
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
        pulse += env * exp(-dot(dp, dp) / (rad * rad)) * (0.6 + 0.8 * fA(p * 2.3 + h2));
    }
    vec3 col = EE_TINT * (fog * 0.04 * (1.0 + 5.0 * pulse) + pulse * 0.022) * vignette(uv);
    return vec4(col * (1.0 - dust), clamp(dust + fog * 0.03, 0.0, 1.0));
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
    vec3 c = mix(NB_GREEN_A, NB_PURPLE, smoothstep(0.35, 0.65, fD(p * 0.6 + 1.9))) * glow * 0.3;
    return vec3(0.005, 0.004, 0.007) + c * (0.7 + 0.6 * fC(p * 2.0));
}

vec4 nebulaAnim(vec2 p, vec3 d, float t) {
    vec2 q = p * 1.05;
    // Churn: a two-level domain warp whose fields move with time.
    vec2 w1 = vec2(fA(q * 0.8 + vec2(0.0041, 0.0023) * t), fB(q * 0.8 + vec2(5.2, 1.3) - vec2(0.0015, 0.0037) * t)) - 0.5;
    vec2 w = q + 0.6 * w1;
    vec2 w2 = vec2(fC(w * 1.7 + vec2(1.7, 9.2) + 0.0052 * t), fD(w * 1.7 + vec2(8.3, 2.8) - 0.0046 * t)) - 0.5;
    vec2 ww = w + 0.32 * w2;
    float gA = fA(ww * 1.3 + vec2(0.37, 0.91));
    float gB = fB(ww * 1.5 + vec2(3.1, 7.7));
    float env = (0.2 + 0.8 * smoothstep(0.02, 0.55, d.g)) * nebulaArms(p, t) * (1.0 - smoothstep(1.05, 1.5, length(p) / uMisc.y));
    float green = smoothstep(0.42, 0.85, gA) * env;
    // Where both gases are thick the greener one gives way, so the colours stay green or purple / pink, not mixed.
    float violet = smoothstep(0.45, 0.88, gB) * env * (1.0 - 0.75 * smoothstep(0.3, 0.8, green / max(env, 0.001)));
    // Slow colour drift, within the palette.
    vec3 cg = mix(NB_GREEN_A, NB_GREEN_B, 0.5 + 0.5 * sin(t * 0.011 + uMisc.z * 6.0));
    vec3 cv = mix(NB_PURPLE, NB_PINK, 0.5 + 0.5 * sin(t * 0.0087 + 1.3 + uMisc.w * 6.0));
    vec3 col = (cg * green + cv * violet) * 1.45;
    // Dark dust: thin lanes along the warped flow plus broad dark patches.
    float lanes = smoothstep(0.8, 0.96, ridge(fC(w * 2.8 + vec2(0.41, 0.13)))) * (0.45 + 0.55 * env);
    float patches = smoothstep(0.6, 0.82, fD(w * 0.75 + vec2(2.9, 0.6))) * 0.55;
    float dust = clamp(lanes * 0.85 + patches, 0.0, 0.9);
    return vec4(col * (1.0 - dust), dust);
}

// -------------------------------------------------------------------------------------------------------------------------
void main() {
    vec2 uv = vUv;
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
