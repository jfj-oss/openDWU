// Task M2e — pure helper tests for the empire ownership layer.

import { describe, expect, it } from 'vitest';
import type { Empire } from '../src/sim/empire';
import { colonyRingRadius, EMPIRE_FALLBACK_COLORS, empireColour, INDEPENDENT_RING_COLOR, territoryRadius, toPixiColor } from '../src/render/empireLayer';

describe('colonyRingRadius', () => {
    it('is the drawn sprite radius plus 6 px', () => {
        expect(colonyRingRadius(14)).toBe(14 / 2 + 6); // planet minimum
        expect(colonyRingRadius(7)).toBe(7 / 2 + 6); // moon minimum
        expect(colonyRingRadius(100)).toBe(56);
        expect(colonyRingRadius(0)).toBe(6);
    });
});

describe('territoryRadius', () => {
    it('is ~1.2 sectors x 0.25', () => {
        expect(territoryRadius(1000000)).toBeCloseTo(1000000 * 1.2 * 0.25);
        expect(territoryRadius(0)).toBe(0);
    });
});

describe('toPixiColor', () => {
    it('passes 0xRRGGBB numbers through (masked)', () => {
        expect(toPixiColor(0x1a2b3c)).toBe(0x1a2b3c);
        expect(toPixiColor(0xff0000)).toBe(0xff0000);
        expect(toPixiColor(0x1ff0000)).toBe(0xff0000); // high byte masked off
        expect(toPixiColor(0)).toBe(0xffffff); // 0 is not a usable colour -> white
    });

    it('parses #rrggbb and rrggbb strings', () => {
        expect(toPixiColor('#1a2b3c')).toBe(0x1a2b3c);
        expect(toPixiColor('1A2B3C')).toBe(0x1a2b3c);
        expect(toPixiColor('#abcdef')).toBe(0xabcdef);
    });

    it('parses rgb(r,g,b) strings', () => {
        expect(toPixiColor('rgb(26, 43, 60)')).toBe(0x1a2b3c);
        expect(toPixiColor('rgb(255,0,128)')).toBe(0xff0080);
    });

    it('falls back to white for unknown input', () => {
        expect(toPixiColor('not-a-color')).toBe(0xffffff);
        expect(toPixiColor('#12345')).toBe(0xffffff);
    });

    it('keeps the independent grey as-is', () => {
        expect(toPixiColor(INDEPENDENT_RING_COLOR)).toBe(0x606060);
    });
});

// Task M2e2: empires that share or lack colours get distinct palette colours
// by empire index, in the renderer only.
describe('empireColour', () => {
    function fakeEmpire(mainColor: number): Empire {
        return { mainColor } as unknown as Empire;
    }

    it('returns distinct values for indices 0-11 when empires lack colours', () => {
        const seen = new Set<number>();
        for (let i = 0; i < 12; i++) {
            const c = empireColour(fakeEmpire(0), i);
            expect(seen.has(c)).toBe(false);
            seen.add(c);
        }
        expect(seen.size).toBe(12);
    });

    it('uses the empire\'s own main colour when it has one', () => {
        expect(empireColour(fakeEmpire(0x1a2b3c), 0)).toBe(0x1a2b3c);
    });

    it('accepts hex-string main colours via toPixiColor (sim always stores numbers)', () => {
        // Sim stores mainColor as a number (empire.ts); a non-zero string is
        // never === 0, so empireColour routes it through toPixiColor as the
        // empire's own colour rather than the palette fallback.
        expect(empireColour({ mainColor: '#ff0080' } as unknown as Empire, 5)).toBe(0xff0080);
    });

    it('wraps indices past 12 back into the palette', () => {
        expect(empireColour(fakeEmpire(0), 13)).toBe(empireColour(fakeEmpire(0), 1));
        expect(empireColour(fakeEmpire(0), 26)).toBe(empireColour(fakeEmpire(0), 2));
    });

    it('palette entries are all distinct and non-zero', () => {
        const seen = new Set<number>();
        for (const c of EMPIRE_FALLBACK_COLORS) {
            expect(c).not.toBe(0);
            expect(seen.has(c)).toBe(false);
            seen.add(c);
        }
    });
});