import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAP_FONT_FAMILY } from '../src/render/mainView';

// Task 08f3: map labels must render in the 'Forgotten Futurist' web font.
// The pure half of the fix is testable here: every Text style in mainView
// uses the shared MAP_FONT_FAMILY constant (grep-style check on the source).
describe('map label font (task 08f3)', () => {
    it('MAP_FONT_FAMILY is "Forgotten Futurist, sans-serif"', () => {
        expect(MAP_FONT_FAMILY).toBe('Forgotten Futurist, sans-serif');
    });

    it('every Pixi Text style in mainView.ts sets fontFamily to MAP_FONT_FAMILY', () => {
        const src = readFileSync(resolve(__dirname, '../src/render/mainView.ts'), 'utf-8');
        // All `new Text({ ... })` construction sites.
        const sites = [...src.matchAll(/new Text\(\{[\s\S]*?\}\);/g)].map((m) => m[0]);
        expect(sites.length).toBeGreaterThanOrEqual(3); // planet, system name, region label
        for (const site of sites) {
            expect(site).toContain('fontFamily: MAP_FONT_FAMILY');
        }
        // No leftover hard-coded family strings in any Text style.
        expect(src).not.toMatch(/new Text\(\{[^}]*fontFamily:\s*['"]/s);
    });
});