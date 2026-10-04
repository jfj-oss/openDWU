import { describe, expect, it } from 'vitest';
import {
    CREDITS_DEFAULT_SPACER,
    CREDITS_MENU_SCROLL_SPEED,
    CREDITS_RECREATION_LINE,
    CREDITS_SCROLL_SPEED,
    CREDITS_TICK_MS,
    buildCreditsItems,
    creditsItemHeight,
} from '../src/ui/screens/credits';

// The scrolling overlay itself needs a browser (jsdom is not configured here,
// see hud.test.ts), so this tests the pure data: the credit items of
// Start.1.cs method_139 and the scroll constants of ScrollingCreditsPanel.cs.

const texts = (viewHeight?: number): string[] => buildCreditsItems(viewHeight).flatMap((i) => (i.kind === 'text' ? [i.text] : []));

describe('buildCreditsItems (task 06k, method_139)', () => {
    it('starts with Height / 20 spacers, then smallTitle.png', () => {
        const items = buildCreditsItems(900);
        for (let i = 0; i < 45; i++) expect(items[i]).toEqual({ kind: 'spacer', height: CREDITS_DEFAULT_SPACER });
        expect(items[45]).toMatchObject({ kind: 'image', file: 'smallTitle.png' });
    });

    it('lists the original headings and names in order', () => {
        const t = texts();
        expect(t.slice(0, 4)).toEqual(['Design & Development', 'ELLIOT GIBBS', 'Art Designer', 'JASON BARISH']);
        const idx = (s: string): number => t.indexOf(s);
        expect(idx('Additional Artwork')).toBeLessThan(idx('RICHARD EVANS'));
        expect(idx('THE LORDZ GAME STUDIO')).toBeLessThan(idx('Concept Reviewer'));
        expect(idx('CHITOSE GIBBS')).toBeLessThan(idx('Copyright ©2014'));
        expect(idx('CODEFORCE LIMITED')).toBeLessThan(idx('www.codeforce.co.nz'));
        expect(idx('With special thanks to')).toBeLessThan(idx('Chitose, Natasha, Jessica and Benjamin'));
        expect(idx('SLITHERINE GROUP')).toBeLessThan(idx('PRODUCERS'));
        expect(idx('PRODUCERS')).toBe(idx('Erik Rutins') - 1);
    });

    it('puts codeforce.png after CODEFORCE LIMITED', () => {
        const items = buildCreditsItems();
        const i = items.findIndex((x) => x.kind === 'text' && x.text === 'CODEFORCE LIMITED');
        expect(items[i + 1]).toMatchObject({ kind: 'image', file: 'codeforce.png' });
    });

    it('ends with the recreation line after the original last name', () => {
        const t = texts();
        expect(t.at(-2)).toBe('Erik Rutins');
        expect(t.at(-1)).toBe(CREDITS_RECREATION_LINE);
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

    it('scrolls the main menu credits at method_138 ScrollSpeed 30', () => {
        expect(CREDITS_MENU_SCROLL_SPEED).toBe(30);
    });
});
