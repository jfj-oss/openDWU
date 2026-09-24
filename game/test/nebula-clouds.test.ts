// Task 08f2: determinism pins for the NebulaCloudGenerator port.
// The generator's randomness must come exclusively from src/sim/random.ts
// (.NET System.Random legacy algorithm), so a fixed seed + size must always
// produce the same texture. We pin:
//   - the first few raw draws of the .NET Random (guards the RNG port itself)
//   - the derived constructor state (color scheme / noise seeds)
//   - a handful of pixel values out of generateNebulaBackdrop(seed 7, 128 px)

import { describe, expect, it } from 'vitest';
import { Random } from '../src/sim/random';
import { nebulaColorScheme, NebulaCloudGenerator } from '../src/render/nebulaClouds';

describe('NebulaCloudGenerator determinism (task 08f2)', () => {
    it('.NET Random draw sequence is stable', () => {
        const r = new Random(7);
        // First N draws used by the pipeline (Next(min,max) / NextDouble).
        expect([r.next(3, 5), r.next(0, 5), r.nextDouble(), r.next(6, 12)]).toEqual([
            3,
            4,
            0.6609386227377405,
            6,
        ]);
    });

    it('constructor derives the same scheme and noise seeds', () => {
        const g = new NebulaCloudGenerator(7);
        // colorScheme = -1 -> random.Next(0, 8); perlinSeed = Next(0, 1000000);
        // fbmSeed = the original seed.
        expect((g as unknown as { colorScheme: number }).colorScheme).toBe(3);
        expect((g as unknown as { perlinSeed: number }).perlinSeed).toBe(871255);
        expect((g as unknown as { fbmSeed: number }).fbmSeed).toBe(7);
        expect(g.TransparencyLevel).toBe(48);
        expect(g.BoundarySearchPixelSkip).toBe(8);
        expect(g.NebulaCloudScaleFactor).toBe(4.5);
    });

    it('color scheme table matches the C# method_3 values', () => {
        const s0 = nebulaColorScheme(0, 114);
        expect(s0.length).toBe(5);
        expect(s0[0]).toEqual({ r: 232, g: 64, b: 16, a: 82 }); // 114 - 32
        const s3 = nebulaColorScheme(3, 114);
        expect(s3[2]).toEqual({ r: 160, g: 48, b: 240, a: 114 });
        const s15 = nebulaColorScheme(15, 114);
        expect(s15[0]).toEqual({ r: 0, g: 182, b: 245, a: 114 });
    });

    it('generateNebulaBackdrop is deterministic for a fixed seed/size', () => {
        const genA = new NebulaCloudGenerator(2);
        const genB = new NebulaCloudGenerator(2);
        const a = genA.generateNebulaBackdrop(7, 114, -1, 128, Math.trunc(128 * 1.5), true, false, false);
        const b = genB.generateNebulaBackdrop(7, 114, -1, 128, Math.trunc(128 * 1.5), true, false, false);
        expect(a.width).toBe(b.width);
        expect(a.height).toBe(b.height);
        expect(Array.from(a.image)).toEqual(Array.from(b.image));
        // Pinned output shape and sample pixels (seed 7, transparent bg).
        expect(a.width).toBe(441);
        expect(a.height).toBe(423);
        const px = (x: number, y: number): [number, number, number, number] => {
            const i = (y * a.width + x) * 4;
            return [a.image[i], a.image[i + 1], a.image[i + 2], a.image[i + 3]];
        };
        expect(px(0, 0)).toEqual([0, 0, 0, 0]);
        expect(px(144, 144)).toEqual([243, 59, 128, 0]);
        expect(px(30, 30)).toEqual([0, 0, 0, 0]);
        expect(px(200, 100)).toEqual([247, 72, 128, 0]);
        expect(px(250, 250)).toEqual([225, 53, 75, 255]);
        expect(px(238, 126)).toEqual([244, 63, 128, 22]);
        expect(px(245, 133)).toEqual([243, 62, 128, 69]);
    });
});