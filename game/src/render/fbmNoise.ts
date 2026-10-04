// Port of DistantWorlds/FbmNoise.cs CNoise / CFractal (the 2-D gradient-lattice noise and its fBm sum), as used by
// SectorCloudGenerator.FbmImageTransparent (SectorCloudGenerator.cs 120-147) to add fractal detail to a gas cloud
// when the Main View magnifies it (MainView.2.cs method_146). Render-only: its own .NET Random (src/sim/random.ts),
// never the galaxy's. Single-precision arithmetic is kept with Math.fround where the C# works in float.
//
// CFractal(int nSeed, float fH, float fLacunarity) in the decompiled source has its `int_2 = 128` (the exponent count,
// a field initializer in the original assembly) commented out, which would leave every exponent 0 and fBm() == 0.
// The parameterless constructor keeps the initializer, and Class2.int_1 is the same 128: this port uses 128.

import { Random } from '../sim/random';

const f32 = Math.fround;
const EXPONENT_COUNT = 128;

/** FbmNoise.Class3: the seeded generator Init draws its lattice from. */
class LatticeRandom {
    private readonly random: Random;
    constructor(seed: number) {
        this.random = new Random(seed);
    }
    /** method_2(min, max): min + Math.Min(range * NextDouble(), range). */
    between(min: number, max: number): number {
        const range = max - min;
        return min + Math.min(range * this.random.nextDouble(), range);
    }
    /** method_3(min, max): (uint)(min + Math.Min((int)((range + 1) * NextDouble()), range)). */
    intBetween(min: number, max: number): number {
        const range = max - min;
        return min + Math.min(Math.trunc((range + 1.0) * this.random.nextDouble()), range);
    }
}

// Port of FbmNoise.CNoise (2 dimensions) + CFractal.
export class CFractal {
    private readonly map = new Uint8Array(256);
    private readonly gradX = new Float32Array(256);
    private readonly gradY = new Float32Array(256);
    private readonly exponent = new Float32Array(EXPONENT_COUNT);
    readonly lacunarity: number;

    // Port of CFractal(nSeed, fH, fLacunarity) → Init(nSeed, fH, fLacunarity) → CNoise.Init(nSeed).
    constructor(seed: number, h: number, lacunarity: number) {
        const rnd = new LatticeRandom(seed);
        let i: number;
        for (i = 0; i < 256; i++) {
            this.map[i] = i;
            const x = f32(rnd.between(-0.5, 0.5));
            const y = f32(rnd.between(-0.5, 0.5));
            // Class2.smethod_17: normalise the gradient (float sum, (float)(1 / Math.Sqrt(sum))).
            const sum = f32(f32(x * x) + f32(y * y));
            const inv = f32(1.0 / Math.sqrt(sum));
            this.gradX[i] = f32(x * inv);
            this.gradY[i] = f32(y * inv);
        }
        while (--i > 0) {
            const j = rnd.intBetween(0, 255);
            const t = this.map[i];
            this.map[i] = this.map[j];
            this.map[j] = t;
        }
        this.lacunarity = f32(lacunarity);
        let num = 1;
        for (let k = 0; k < EXPONENT_COUNT; k++) {
            this.exponent[k] = f32(Math.pow(num, -f32(h)));
            num = f32(num * this.lacunarity);
        }
    }

    // CNoise.LatticeOptimized.
    private lattice(ix: number, fx: number, iy: number, fy: number): number {
        let n = this.map[ix & 0xff];
        n = this.map[(n + iy) & 0xff];
        return f32(f32(this.gradX[n] * fx) + f32(this.gradY[n] * fy));
    }

    /** CNoise.Noise(x, y): smoothstep-interpolated lattice gradients, clamped to ±0.99999. */
    noise(x: number, y: number): number {
        const ix = Math.floor(x);
        const iy = Math.floor(y);
        const fx = f32(x - ix);
        const fy = f32(y - iy);
        const sx = f32(fx * fx * (3 - 2 * fx));
        const sy = f32(fy * fy * (3 - 2 * fy));
        const a = this.lattice(ix, fx, iy, fy);
        const b = this.lattice(ix + 1, fx - 1, iy, fy);
        const c = this.lattice(ix, fx, iy + 1, fy - 1);
        const d = this.lattice(ix + 1, fx - 1, iy + 1, fy - 1);
        const ab = a + sx * (b - a);
        const cd = c + sx * (d - c);
        const v = f32(ab + sy * (cd - ab));
        return v < -0.99999 ? -0.99999 : v > 0.99999 ? 0.99999 : v;
    }

    /** CFractal.fBm(x, y, octaves): sum of noise(x * lac^i, y * lac^i) * lac^(-i * H), clamped to ±0.99999. */
    fBm(x: number, y: number, octaves: number): number {
        let sum = 0;
        let x2 = x;
        let y2 = y;
        for (let i = 0; i < octaves; i++) {
            sum = f32(sum + f32(this.noise(x2, y2) * this.exponent[i]));
            x2 = f32(x2 * this.lacunarity);
            y2 = f32(y2 * this.lacunarity);
        }
        return sum < -0.99999 ? -0.99999 : sum > 0.99999 ? 0.99999 : sum;
    }
}
