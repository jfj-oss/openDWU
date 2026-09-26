// Task fix8ui: the Forgotten Futurist space glyph advances only 0.131 em
// (bold 0.192 em), ~1 px at the panels' 11 px, so every screen read as
// "1Leader,1Ambassador" although the text builders emit spaces. hud.css
// leaves U+0020 out of both @font-face unicode-ranges so spaces fall back
// to sans-serif everywhere; this guards that rule.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Parse a CSS unicode-range value into [lo, hi] code-point pairs. */
function parseUnicodeRange(v: string): Array<[number, number]> {
    return v.split(',').map((part) => {
        const [a, b] = part.trim().replace(/^U\+/i, '').split('-');
        const lo = parseInt(a, 16);
        return [lo, b !== undefined ? parseInt(b, 16) : lo];
    });
}

describe('Forgotten Futurist @font-face (hud.css)', () => {
    const css = readFileSync(new URL('../src/ui/hud.css', import.meta.url), 'utf8');
    const faces = [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map((m) => m[1]).filter((b) => b.includes('Forgotten Futurist'));

    it('declares both weights', () => {
        expect(faces).toHaveLength(2);
    });

    it('excludes U+0020 (space) but covers letters and punctuation', () => {
        for (const body of faces) {
            const m = /unicode-range:\s*([^;]+);/.exec(body);
            expect(m).not.toBeNull();
            const ranges = parseUnicodeRange(m![1]);
            const covers = (cp: number) => ranges.some(([lo, hi]) => cp >= lo && cp <= hi);
            expect(covers(0x20)).toBe(false);
            for (const ch of 'Aa1,().%') expect(covers(ch.codePointAt(0)!)).toBe(true);
        }
    });
});
