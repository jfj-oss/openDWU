import { describe, expect, it } from 'vitest';
import { MENU_ITEMS, shouldSkipMenu } from '../src/ui/screens/mainMenu';

// The menu DOM itself needs a browser (jsdom is not configured), so this tests
// the pure data: the item order and that every image name comes from the
// original chrome file list (task 06a).

describe('MENU_ITEMS (task 06a)', () => {
    it('lists the items in display order', () => {
        expect(MENU_ITEMS.map((i) => i.id)).toEqual([
            'Tutorials',
            'StartNewGame',
            'LoadGame',
            'Options',
            'ChangeTheme',
            'Exit',
        ]);
    });

    it('uses only the original chrome image base names', () => {
        const allowed = new Set(
            ['Tutorials', 'StartNewGame', 'LoadGame', 'Options', 'ChangeTheme', 'Exit',
                'Galactopedia', 'Credits', 'CheckForUpdates'].map((n) => `Menu_${n}`),
        );
        for (const item of MENU_ITEMS) {
            expect(allowed.has(item.imageBase)).toBe(true);
        }
    });

    it('has a human label for every item', () => {
        for (const item of MENU_ITEMS) {
            expect(item.label.length).toBeGreaterThan(0);
        }
    });
});

describe('shouldSkipMenu (task 06a)', () => {
    it('skips the menu when any boot param or skipMenu is present', () => {
        for (const k of ['seed', 'shape', 'stars', 'zoom', 'cx', 'cy', 'skipMenu']) {
            expect(shouldSkipMenu(`?${k}=1`)).toBe(true);
        }
    });

    it('shows the menu otherwise', () => {
        expect(shouldSkipMenu('')).toBe(false);
        expect(shouldSkipMenu('?foo=bar')).toBe(false);
    });
});