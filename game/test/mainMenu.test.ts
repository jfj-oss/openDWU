import { describe, expect, it } from 'vitest';
import { MENU_ITEMS } from '../src/ui/screens/mainMenu';

// The DOM screen itself needs a browser (jsdom is not configured here, see
// hud.test.ts), so this tests the pure MENU_ITEMS data (task 06a).

const KNOWN_IMAGE_BASES = [
    'Menu_Tutorials',
    'Menu_StartNewGame',
    'Menu_LoadGame',
    'Menu_Options',
    'Menu_ChangeTheme',
    'Menu_Exit',
    'Menu_Galactopedia',
    'Menu_Credits',
    'Menu_CheckForUpdates',
];

describe('MENU_ITEMS (task 06a)', () => {
    it('is in the original order', () => {
        expect(MENU_ITEMS.map((m) => m.id)).toEqual([
            'tutorials',
            'startNewGame',
            'loadGame',
            'options',
            'changeTheme',
            'exit',
        ]);
        expect(MENU_ITEMS.map((m) => m.label)).toEqual([
            'Tutorials',
            'Start New Game',
            'Load Game',
            'Options',
            'Change Theme',
            'Exit',
        ]);
    });

    it('uses image names from the known chrome list', () => {
        for (const item of MENU_ITEMS) {
            expect(KNOWN_IMAGE_BASES).toContain(item.imageBase);
        }
    });
});
