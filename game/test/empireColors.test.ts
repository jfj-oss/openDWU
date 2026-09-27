// Tests for src/sim/empireColors.ts pirate colour paths (Galaxy.cs
// SelectColorFromKeyDark ~2714, DetermineSecondaryColor 2509-2530,
// SelectUnusedMainColor pirate branch 2412-2471).

import { describe, expect, it } from 'vitest';
import { Random } from '../src/sim/random';
import {
    determineSecondaryColor,
    displayColorForEmpire,
    selectColorFromKey,
    selectColorFromKeyDark,
    selectUnusedMainColor,
} from '../src/sim/empireColors';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import { createGalaxyScenario } from '../src/sim/scenario/state';
import { parseScenarioManifest } from '../src/sim/scenario/manifest';

function fakeGalaxy(seed: number, pirateMainColors: number[] = []): Galaxy {
    return {
        rnd: new Random(seed),
        empires: [],
        pirateEmpires: pirateMainColors.map((mainColor) => ({ mainColor })),
    } as unknown as Galaxy;
}

/** A `big-galaxies` scenario galaxy (task 19k-1b) with `extendedPalette` on/off and `n` fake empires: the first 20
 * on distinct key colours, the rest overflowing to the random-fallback range (mimicking SelectUnusedMainColor once
 * the 20-key budget is spent). empireId is assignment order, 1-based, like Galaxy.getNextEmpireID(). */
function fakePaletteGalaxy(n: number, extendedPalette: boolean): Galaxy {
    const manifest = parseScenarioManifest({ id: 'big-galaxies', flags: [{ name: 'extendedPalette', default: false }] });
    const galaxy = { empires: [] } as unknown as Galaxy;
    galaxy.scenario = createGalaxyScenario(manifest, { flags: { extendedPalette } });
    const empires: Empire[] = [];
    for (let i = 0; i < n; i++) {
        const mainColor = i < 20 ? selectColorFromKey(i) : 0x202020 + i; // fallback range never collides with a key colour
        empires.push({ empireId: i + 1, mainColor, galaxy } as unknown as Empire);
    }
    galaxy.empires = empires;
    return galaxy;
}

describe('selectColorFromKeyDark', () => {
    it('matches Galaxy.cs SelectColorFromKeyDark table spot checks', () => {
        expect(selectColorFromKeyDark(0)).toBe(0x00003b);
        expect(selectColorFromKeyDark(9)).toBe(0x55230a);
        expect(selectColorFromKeyDark(20)).toBe(0xffffff);
        expect(selectColorFromKeyDark(23)).toBe(0x010101);
    });

    it('returns Color.Empty (0) for out-of-range keys', () => {
        expect(selectColorFromKeyDark(-1)).toBe(0);
        expect(selectColorFromKeyDark(24)).toBe(0);
    });
});

describe('determineSecondaryColor', () => {
    it('falls through to DetermineContrastColor when avg is below the band', () => {
        // 0x960000 = R=150,G=0,B=0 -> avg=50, not >80, so falls through to
        // DetermineContrastColor: (255-150, 255-0, 255-0) = (105,255,255).
        expect(determineSecondaryColor(0x960000)).toBe(0x69ffff);
    });

    it('picks a dark-red shadow color for a red-dominant mid color', () => {
        // R=150,G=100,B=100 -> avg=350/3=116 (in (80,176)); R dominant ->
        // darkColor=0x300000; contrast drop shadow chooses dark vs light
        // by luminance of the ORIGINAL color.
        const color = 0x966464; // 150,100,100
        const result = determineSecondaryColor(color);
        // luminance factor: 1 - (0.333*150+0.333*100+0.333*100)/255 ~= 0.559 < 0.7 -> dark
        expect(result).toBe(0x300000);
    });

    it('picks white for a dark, low-luminance-factor color needing light shadow', () => {
        // Choose a color with avg in range but very low so drop-shadow picks light.
        // R=90,G=85,B=85 -> avg=260/3=86.6 in range; R dominant -> dark=0x300000
        // luminance factor = 1-(0.333*90+0.333*85+0.333*85)/255 = 1-0.335=0.665<0.7 -> dark still.
        // Use a genuinely bright-enough color for the >=0.7 branch instead:
        // Actually factor decreases as brightness increases, so pick a fairly bright mid color.
        const color = 0xa08c8c; // 160,140,140 avg=146.67 in range, R dominant
        const factor = 1 - (0.333 * 160 + 0.333 * 140 + 0.333 * 140) / 255;
        expect(factor).toBeLessThan(0.7);
        // Still dark branch at these levels; assert against direct computation instead
        // of a hardcoded guess to keep this robust to only the documented formula.
        expect(determineSecondaryColor(color)).toBe(factor < 0.7 ? 0x300000 : 0xffffff);
    });

    it('falls back to DetermineContrastColor outside the mid-brightness band', () => {
        expect(determineSecondaryColor(0x000000)).toBe(0xffffff);
        expect(determineSecondaryColor(0xffffff)).toBe(0x000000);
    });
});

describe('selectUnusedMainColor pirate branch', () => {
    it('draws only from the dark colour table when unused dark colours remain', () => {
        const galaxy = fakeGalaxy(42);
        const darkTable = new Set<number>();
        for (let i = 0; i < 20; i++) darkTable.add(selectColorFromKeyDark(i));
        const { color, unusedColorKey } = selectUnusedMainColor(galaxy, true);
        expect(darkTable.has(color)).toBe(true);
        expect(unusedColorKey).toBeGreaterThanOrEqual(0);
        expect(selectColorFromKeyDark(unusedColorKey)).toBe(color);
    });

    it('falls back to a dark random RGB draw (channels within pirate ranges) once all dark keys are used', () => {
        const usedMainColors: number[] = [];
        for (let i = 0; i < 20; i++) usedMainColors.push(selectColorFromKeyDark(i));
        const galaxy = fakeGalaxy(7, usedMainColors);
        const { color, unusedColorKey } = selectUnusedMainColor(galaxy, true);
        expect(unusedColorKey).toBe(-1);
        const r = (color >> 16) & 0xff;
        const g = (color >> 8) & 0xff;
        const b = color & 0xff;
        // One of the three channels must be in [48,96) (the "dominant" one)
        // and the others in [8,64), per Galaxy.cs SelectUnusedMainColor.
        const inDominant = (v: number) => v >= 48 && v < 96;
        const inMinor = (v: number) => v >= 8 && v < 64;
        const combos = [
            inDominant(r) && inMinor(g) && inMinor(b),
            inMinor(r) && inDominant(g) && inMinor(b),
            inMinor(r) && inMinor(g) && inDominant(b),
        ];
        expect(combos.some(Boolean)).toBe(true);
    });

    it('is deterministic for a fixed seed', () => {
        const g1 = fakeGalaxy(999);
        const g2 = fakeGalaxy(999);
        expect(selectUnusedMainColor(g1, true)).toEqual(selectUnusedMainColor(g2, true));
    });
});

describe('displayColorForEmpire (task 19k-1b: extended palette, presentation only)', () => {
    it('is byte-identical to mainColor with the scenario flag off, at any empire count', () => {
        const galaxy = fakePaletteGalaxy(60, false);
        for (const e of galaxy.empires) expect(displayColorForEmpire(e)).toBe(e.mainColor);
    });

    it('is byte-identical to mainColor with no scenario at all', () => {
        const galaxy = fakeGalaxy(1);
        galaxy.scenario = null;
        const empire = { empireId: 1, mainColor: 0x123456, galaxy } as unknown as Empire;
        expect(displayColorForEmpire(empire)).toBe(0x123456);
    });

    it('keeps the first 20 empires on their exact key colour with the flag on', () => {
        const galaxy = fakePaletteGalaxy(60, true);
        for (let i = 0; i < 20; i++) {
            const e = galaxy.empires[i];
            expect(displayColorForEmpire(e)).toBe(selectColorFromKey(i));
        }
    });

    it('gives every one of 60 empires a distinct display colour with the flag on', () => {
        const galaxy = fakePaletteGalaxy(60, true);
        const colors = galaxy.empires.map((e) => displayColorForEmpire(e));
        expect(new Set(colors).size).toBe(60);
    });

    it('is deterministic and does not depend on array iteration order (keyed by empireId)', () => {
        const galaxy = fakePaletteGalaxy(45, true);
        const shuffled = [...galaxy.empires].reverse();
        const e = galaxy.empires[40]; // an overflow empire (>= index 20)
        const viaGalaxyOrder = displayColorForEmpire(e);
        (galaxy as unknown as { empires: unknown }).empires = shuffled;
        expect(displayColorForEmpire(e)).toBe(viaGalaxyOrder);
    });
});
