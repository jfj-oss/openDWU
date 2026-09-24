import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    CREDITS_DEFAULT_SPACER,
    CREDITS_SCROLL_SPEED,
    CREDITS_TICK_MS,
    buildCreditsItems,
    creditsItemHeight,
} from '../src/ui/screens/credits';

// The scrolling overlay itself needs a browser (jsdom is not configured here,
// see hud.test.ts), so this tests the pure data: the extracted credit line
// list and the scroll constants ported from ScrollingCreditsPanel.cs.

describe('buildCreditsItems (task 06k)', () => {
    it('starts with the original first lines', () => {
        const items = buildCreditsItems();
        const texts = items.filter((i) => i.kind === 'text').map((i) => (i.kind === 'text' ? i.text : ''));
        expect(texts[0]).toBe('Distant Worlds');
        expect(texts[1]).toBe('Universe');
    });

    it('ends with the recreation section after the original closing line', () => {
        const items = buildCreditsItems();
        const texts = items.filter((i) => i.kind === 'text').map((i) => (i.kind === 'text' ? i.text : ''));
        expect(texts[texts.length - 2]).toBe('Thank you for playing!');
        expect(texts.at(-1)).toBe('Recreation: Dwureup (TypeScript/PixiJS port)');
    });

    it('keeps headings before their entries in the original order', () => {
        const items = buildCreditsItems();
        const texts = items.filter((i) => i.kind === 'text').map((i) => (i.kind === 'text' ? i.text : ''));
        const idx = (t: string): number => texts.indexOf(t);
        // Each heading precedes its first entry.
        expect(idx('Lead Designer')).toBeLessThan(idx('John Tynes'));
        expect(idx('Programming')).toBeGreaterThan(idx('Lead Designer'));
        expect(idx('Art & Design')).toBeGreaterThan(idx('Programming'));
        expect(idx('Music')).toBeGreaterThan(idx('Art & Design'));
        expect(idx('Sound Effects')).toBeGreaterThan(idx('Music'));
        expect(idx('Special Thanks')).toBeGreaterThan(idx('Sound Effects'));
        expect(idx('Thank you for playing!')).toBeGreaterThan(idx('Special Thanks'));
    });

    it('uses only text and spacer items, spacers defaulting to 20px', () => {
        const items = buildCreditsItems();
        for (const item of items) {
            if (item.kind === 'spacer') {
                expect([CREDITS_DEFAULT_SPACER, 40]).toContain(item.height);
            } else {
                expect(item.kind).toBe('text');
                expect(item.text.length).toBeGreaterThan(0);
            }
        }
        // The title block uses the larger 40px spacers; the rest use the
        // C# _DefaultSpacerHeight = 20.
        expect(items.some((i) => i.kind === 'spacer' && i.height === 40)).toBe(true);
        expect(items.some((i) => i.kind === 'spacer' && i.height === CREDITS_DEFAULT_SPACER)).toBe(true);
    });

    it('gives every item a positive height', () => {
        for (const item of buildCreditsItems()) {
            expect(creditsItemHeight(item)).toBeGreaterThan(0);
        }
    });
});

describe('scroll constants (task 06k, ScrollingCreditsPanel.cs)', () => {
    it('matches the C# panel: 20 px per 0.05 s tick = 400 px/s', () => {
        expect(CREDITS_SCROLL_SPEED).toBe(20.0 / 0.05);
        expect(CREDITS_SCROLL_SPEED).toBe(400);
        expect(CREDITS_TICK_MS).toBe(50);
    });
});