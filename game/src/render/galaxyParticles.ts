// The particle-built galaxies (Galactic Core, Golden Spiral) for the galaxy backdrop: render-only, no Pixi here.
//
// The galaxy is built from light particles anchored to the real star systems: around every system many tiny soft
// point lights are scattered (24–104 per system, more where the systems are dense), with seeded jitter stretched along
// the local arm / ring direction so the light streams the way the galaxy turns. Each particle has a size (mostly
// sub-pixel to 2 px at whole-galaxy zoom, a few larger soft glows), a heavy-tailed brightness (many faint, a few
// bright) scaled by the arm pattern at its position (arms fitted to the star density, so they sit on the stars), and a
// colour from the variant's palette (core / disk / young-star knots / HII clumps). The core is simply where the
// particles pile up. galaxyBackdrop.ts draws them additively (instanced quads) into band render textures and two
// low-resolution haze textures (the same particles, larger and softer: the unresolved light), and the composite shader
// (galaxyBackdropShaders.ts partStatic) adds the haze, the dust absorption / glow and the tone curve. For the pickers'
// thumbnails the same particles are splatted on the CPU (splatParticles).

import type { BackdropStructure } from './galaxyBackdropStructure';
import { DENSITY_SIZE, mulberry32 } from './galaxyBackdropStructure';

export type ParticleStyle = 'galacticCore' | 'goldenSpiral';

export interface GalaxyParticles {
    count: number;
    /** Centre per particle in galaxy uv (0..1). */
    center: Float32Array;
    /** Size per particle: Gaussian radius in px of a 2048 px galaxy texture. */
    size: Float32Array;
    /** Colour × brightness per particle (linear, additive). */
    color: Float32Array;
    /** Twinkle phase / rate seed per particle, 0..1. */
    phase: Float32Array;
    /** The brighter particles that twinkle in the animated pass (indices). */
    twinkle: Uint32Array;
}

/** Per-variant particle look. */
interface Palette {
    /** Arm / ring winding: 1 / tan(pitch). */
    wind: (seedU: number) => number;
    core: [number, number, number];
    disk: [number, number, number];
    outer: [number, number, number];
    knot: [number, number, number];
    hii: [number, number, number];
    /** Fraction of knot (young-star) particles in the arms' outer part, and of HII clumps. */
    knotRate: number;
    hiiRate: number;
}

const PALETTES: Record<ParticleStyle, Palette> = {
    // Infrared-style: white core, cyan / ice young stars in tightly wound rings (the green haze and red dust glow are
    // added by the composite).
    galacticCore: {
        wind: (u) => 9.5 + 4.5 * u,
        core: [1.0, 0.97, 0.9],
        disk: [0.62, 0.86, 0.95],
        outer: [0.5, 0.86, 1.0],
        knot: [0.55, 0.92, 1.0],
        hii: [1.0, 0.45, 0.4],
        knotRate: 0.3,
        hiiRate: 0.04,
    },
    // Golden-amber: yellow-white core, amber disk, pale blue-white knots on the outer arms.
    goldenSpiral: {
        wind: (u) => 3.6 + 1.6 * u,
        core: [1.0, 0.9, 0.7],
        disk: [1.0, 0.7, 0.36],
        outer: [0.95, 0.78, 0.55],
        knot: [0.7, 0.84, 1.0],
        hii: [1.0, 0.55, 0.7],
        knotRate: 0.22,
        hiiRate: 0.03,
    },
};

/** The arm / ring winding of a style for this galaxy (also used by the composite shader: uMisc-derived there). */
export function particleWind(style: ParticleStyle, structure: BackdropStructure): number {
    return PALETTES[style].wind(structure.misc[3]);
}

/** Arm phase (rad) for `arms` arms of winding `wind` that best matches the mid-blur star density. */
export function fitArmPhase(s: BackdropStructure, arms: number, wind: number): number {
    const n = DENSITY_SIZE;
    const [cu, cv] = s.centre;
    const [ax, ay] = s.aspect;
    const hand = s.arm[3];
    let best = 0;
    let bestScore = -Infinity;
    for (let k = 0; k < 64; k++) {
        const phase = (k / 64) * Math.PI * 2;
        let score = 0;
        for (let y = 0; y < n; y += 2) {
            for (let x = 0; x < n; x += 2) {
                const px = ((x + 0.5) / n - cu) * 2 * ax;
                const py = ((y + 0.5) / n - cv) * 2 * ay;
                const r = Math.hypot(px, py);
                if (r < 0.08 || r > s.misc[1]) continue;
                const psi = arms * (hand * Math.atan2(py, px) - Math.log(r) * wind) + phase;
                score += s.density[(y * n + x) * 4 + 1] * Math.cos(psi);
            }
        }
        if (score > bestScore) {
            bestScore = score;
            best = phase;
        }
    }
    return best;
}

function gauss(rnd: () => number): number {
    const u = Math.max(1e-9, rnd());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

/**
 * Particles for the systems at (`us`, `vs`) in galaxy uv. `phase`: the fitted arm phase for this style's winding
 * (fitArmPhase).
 */
export function buildGalaxyParticles(us: ArrayLike<number>, vs: ArrayLike<number>, s: BackdropStructure, style: ParticleStyle, seed: number, phase: number): GalaxyParticles {
    const pal = PALETTES[style];
    const wind = pal.wind(s.misc[3]);
    const arms = s.arm[0];
    const hand = s.arm[3];
    const shape = s.shape;
    const [cu, cv] = s.centre;
    const [ax, ay] = s.aspect;
    const rOut = s.misc[1];
    const n = Math.min(us.length, vs.length);
    const rnd = mulberry32((seed ^ 0x2c1b3c6d) >>> 0);
    const dens = (u: number, v: number): number => {
        const x = Math.min(DENSITY_SIZE - 1, Math.max(0, Math.floor(u * DENSITY_SIZE)));
        const y = Math.min(DENSITY_SIZE - 1, Math.max(0, Math.floor(v * DENSITY_SIZE)));
        return s.density[(y * DENSITY_SIZE + x) * 4 + 1] / 255;
    };
    // Mean system spacing in centred units.
    const spacing = (2 * Math.sqrt(ax * ay)) / Math.sqrt(Math.max(1, n));
    const perSystem: number[] = [];
    let total = 0;
    for (let i = 0; i < n; i++) {
        const k = Math.round(24 + 80 * dens(us[i], vs[i]));
        perSystem.push(k);
        total += k;
    }
    const center = new Float32Array(total * 2);
    const size = new Float32Array(total);
    const color = new Float32Array(total * 3);
    const ph = new Float32Array(total);
    const bright: number[] = [];
    let j = 0;
    for (let i = 0; i < n; i++) {
        const sx = (us[i] - cu) * 2 * ax;
        const sy = (vs[i] - cv) * 2 * ay;
        const sr = Math.max(1e-4, Math.hypot(sx, sy));
        // Local streaming direction: along the arm / ring (spiral: the log spiral's tangent; elliptical / ring:
        // around the centre); isotropic for irregular and cluster galaxies.
        const rx = sx / sr;
        const ry = sy / sr;
        let tx = -ry;
        let ty = rx;
        let elong = 1;
        if (shape === 0) {
            const a = Math.atan2(hand * wind, 1);
            tx = Math.cos(a) * rx - Math.sin(a) * ry;
            ty = Math.sin(a) * rx + Math.cos(a) * ry;
            elong = 2.6;
        } else if (shape <= 2) elong = 2.2;
        const local = spacing * 0.6 / Math.sqrt(Math.max(0.12, dens(us[i], vs[i])));
        for (let k = 0; k < perSystem[i]; k++, j++) {
            const rho = local * (0.25 + 2.2 * Math.pow(rnd(), 1.6));
            const ga = gauss(rnd) * rho * elong;
            const gb = gauss(rnd) * rho * 0.45;
            const px = sx + tx * ga - ty * gb;
            const py = sy + ty * ga + tx * gb;
            const r = Math.max(1e-4, Math.hypot(px, py));
            const rn = r / rOut;
            // The arm / ring pattern at the particle: brighter on the arms, dim between (fitted to the stars).
            let arm = 1;
            if (shape === 0 || style === 'galacticCore') {
                const psi = shape <= 2 && shape !== 0 ? -Math.log(r) * wind * 2 + phase : arms * (hand * Math.atan2(py, px) - Math.log(r) * wind) + phase;
                arm = shape <= 2 ? Math.pow(0.5 + 0.5 * Math.cos(psi), 2) : 1;
            }
            const band = Math.min(1, Math.max(0, (rn - 0.06) / 0.2));
            const armMod = (0.3 + 1.3 * arm) * band + (1 - band) * 1.0;
            // Heavy-tailed brightness: many faint, a few bright.
            let b = Math.min(30, 0.6 / Math.pow(Math.max(1e-6, rnd()), 0.62)) * armMod;
            let sz = 0.6 + 1.6 * rnd() * rnd();
            if (rnd() < 0.04) {
                sz = 3 + 6 * rnd();
                b *= 0.22;
            }
            // Colour: core → disk → outer, with young-star knots on the outer arms and the odd HII clump.
            const t = Math.min(1, rn / 0.7);
            const coreW = Math.exp(-(rn * rn) / 0.02);
            let c0 = pal.disk[0] + (pal.outer[0] - pal.disk[0]) * t;
            let c1 = pal.disk[1] + (pal.outer[1] - pal.disk[1]) * t;
            let c2 = pal.disk[2] + (pal.outer[2] - pal.disk[2]) * t;
            c0 += (pal.core[0] - c0) * coreW;
            c1 += (pal.core[1] - c1) * coreW;
            c2 += (pal.core[2] - c2) * coreW;
            const roll = rnd();
            const knotP = pal.knotRate * Math.min(1, Math.max(0, (rn - 0.3) / 0.4)) * (0.4 + 0.6 * arm);
            if (roll < knotP) [c0, c1, c2] = pal.knot;
            else if (roll < knotP + pal.hiiRate * arm) [c0, c1, c2] = pal.hii;
            // The core is where the particles pile up; its own stars are brighter too.
            b *= 1 + 2.5 * coreW;
            // Fade the rim raggedly.
            b *= 1 - Math.min(1, Math.max(0, (rn - 0.9 - 0.25 * (rnd() - 0.5)) / 0.35));
            center[j * 2] = cu + px / (2 * ax);
            center[j * 2 + 1] = cv + py / (2 * ay);
            size[j] = sz;
            color[j * 3] = c0 * b;
            color[j * 3 + 1] = c1 * b;
            color[j * 3 + 2] = c2 * b;
            ph[j] = rnd();
            if (b > 3) bright.push(j);
        }
    }
    // Twinkle: up to 3000 of the brighter particles, spread evenly over the list.
    const step = Math.max(1, Math.ceil(bright.length / 3000));
    const tw: number[] = [];
    for (let i = 0; i < bright.length; i += step) tw.push(bright[i]);
    return { count: total, center, size, color, phase: ph, twinkle: Uint32Array.from(tw) };
}

/**
 * CPU splat of the particles into a `px`² RGB float image (Gaussian radius = size × px / 2048 × `scale`, at least
 * `minRadius` px; energy kept when clamped): the thumbnails' particle and haze layers.
 */
export function splatParticles(p: GalaxyParticles, px: number, scale: number, minRadius: number): Float32Array {
    const img = new Float32Array(px * px * 3);
    for (let i = 0; i < p.count; i++) {
        const want = (p.size[i] * px * scale) / 2048;
        const rad = Math.max(minRadius, want);
        const energy = (want * want) / (rad * rad);
        const cx = p.center[i * 2] * px;
        const cy = p.center[i * 2 + 1] * px;
        const ext = Math.ceil(rad * 2.2);
        const x0 = Math.max(0, Math.floor(cx - ext));
        const x1 = Math.min(px - 1, Math.ceil(cx + ext));
        const y0 = Math.max(0, Math.floor(cy - ext));
        const y1 = Math.min(px - 1, Math.ceil(cy + ext));
        const inv = 1 / (rad * rad);
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const dx = x + 0.5 - cx;
                const dy = y + 0.5 - cy;
                const g = Math.exp(-(dx * dx + dy * dy) * inv) * energy;
                if (g < 1e-4) continue;
                const o = (y * px + x) * 3;
                img[o] += p.color[i * 3] * g;
                img[o + 1] += p.color[i * 3 + 1] * g;
                img[o + 2] += p.color[i * 3 + 2] * g;
            }
        }
    }
    return img;
}
