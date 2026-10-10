// "Storm flashes" for the generated galaxy backdrops (render-only): intermittent glows like lightning inside the clouds.
//
// The schedule is a pure function of the galaxy seed and the backdrop's animation clock (which only runs while the
// game does), so a galaxy always storms the same way and a pause freezes it. Time is cut into 0.2 s slots; each slot
// may start one flash with a probability set by a slow "storminess" curve (seeded values every 12 s, smoothly
// interpolated): mostly quiet, with storms where flashes come several a second and cluster around the storm's centre.
// Each flash has a size from a small spark to a large regional glow (small ones far more common), a semi-bright
// intensity (large ones dimmer), a fast rise (0.1–0.3 s), a slower fade (0.5–2 s), and 1–3 flickers like lightning.
// The active ones (at most MAX_FLASHES, the strongest) go to the shader as uniforms; the shader lights each variant's
// own gas / dust with them (galaxyBackdropShaders.ts flashLight), so there is no extra pass.

/** Flash uniforms the shader takes (vec4 each: centre x, y in centred galaxy units, radius, intensity). */
export const MAX_FLASHES = 12;
const SLOT = 0.2;
const EPOCH = 12;
/** The longest a flash lasts: 3 flickers' gaps + rise + fade tail. */
const MAX_LIFE = 3.6;

function hash(seed: number, a: number, b: number): number {
    let h = (seed ^ Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x632be5ab, 0x85ebca77)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Storminess 0..1 at epoch position e (slow, smooth; mostly 0). */
function storminess(seed: number, e: number): number {
    const i = Math.floor(e);
    const f = e - i;
    const s = f * f * (3 - 2 * f);
    const v = hash(seed, i, 7001) * (1 - s) + hash(seed, i + 1, 7001) * s;
    const x = Math.min(1, Math.max(0, (v - 0.55) / 0.4));
    return x * x * (3 - 2 * x);
}

/** One flicker's brightness at `age` s (rise then exponential fade). */
function pulse(age: number, rise: number, fade: number): number {
    if (age <= 0) return 0;
    if (age < rise) {
        const x = age / rise;
        return x * x;
    }
    return Math.exp(((rise - age) * 2.3) / fade);
}

/**
 * Write the flashes active at animation time `t` (s) into `out` (MAX_FLASHES × 4 floats; unused entries zeroed).
 * Returns how many are active.
 */
export function computeStormFlashes(seed: number, t: number, out: Float32Array): number {
    out.fill(0);
    if (!(t > 0)) return 0;
    const s = seed >>> 0;
    const found: [number, number, number, number][] = [];
    const k1 = Math.floor(t / SLOT);
    for (let k = Math.floor((t - MAX_LIFE) / SLOT); k <= k1; k++) {
        if (k < 0) continue;
        const e = (k * SLOT) / EPOCH;
        const storm = storminess(s, e);
        if (hash(s, k, 1) >= 0.012 + 0.3 * storm) continue;
        const start = (k + hash(s, k, 2)) * SLOT;
        // Where: around the storm's centre (most flashes in a storm), else anywhere in the disk.
        const ep = Math.floor(e);
        let x: number;
        let y: number;
        const ang = hash(s, k, 9) * Math.PI * 2;
        if (hash(s, k, 10) < 0.1 + 0.75 * storm) {
            const ca = hash(s, ep, 11) * Math.PI * 2;
            const cr = 0.15 + 0.6 * Math.sqrt(hash(s, ep, 12));
            const d = 0.03 + 0.14 * hash(s, k, 13);
            x = Math.cos(ca) * cr + Math.cos(ang) * d;
            y = Math.sin(ca) * cr + Math.sin(ang) * d;
        } else {
            const rr = 0.9 * Math.sqrt(hash(s, k, 14));
            x = Math.cos(ang) * rr;
            y = Math.sin(ang) * rr;
        }
        // Size: sparks to regional glows, small far more common; big ones dimmer (semi-bright at most).
        const u = hash(s, k, 3);
        const radius = 0.012 * Math.pow(28, u * u * u);
        const intensity = (0.35 + 0.65 * hash(s, k, 4)) * (1 - 0.45 * u * u * u);
        const rise = 0.1 + 0.2 * hash(s, k, 5);
        const fade = 0.5 + 1.5 * hash(s, k, 6);
        const flickers = 1 + Math.min(2, Math.floor(hash(s, k, 7) * (2 + 2 * storm)));
        const gap = 0.07 + 0.12 * hash(s, k, 8);
        const age = t - start;
        let env = 0;
        for (let j = 0; j < flickers; j++) env = Math.max(env, pulse(age - j * gap, rise, fade) * (j === 0 ? 1 : 0.7 + 0.3 * hash(s, k, 20 + j)));
        const w = intensity * env;
        if (w > 0.004) found.push([x, y, radius, w]);
    }
    found.sort((a, b) => b[3] - a[3]);
    const n = Math.min(MAX_FLASHES, found.length);
    for (let i = 0; i < n; i++) out.set(found[i], i * 4);
    return n;
}
