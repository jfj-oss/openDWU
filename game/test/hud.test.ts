import { describe, expect, it } from 'vitest';
import { chromeButtonFile } from '../src/ui/hud';

// The DOM overlay itself needs a browser (jsdom is not configured), so this
// tests the pure control → chrome-image mapping from LoadUiChromeButtons.
describe('chromeButtonFile', () => {
    it('maps controls to their original chrome button images', () => {
        expect(chromeButtonFile('tbtnColonies')).toBe('coloniesButton.png');
        expect(chromeButtonFile('tbtnBuiltObjects')).toBe('shipsAndBasesButton.png');
        expect(chromeButtonFile('tbtnEmpires')).toBe('diplomacyButton.png');
        expect(chromeButtonFile('tbtnGalaxyMap')).toBe('galaxyMapButton.png');
        expect(chromeButtonFile('tbtnShipGroups')).toBe('fleetsButton.png');
        expect(chromeButtonFile('btnGameMenu')).toBe('gameOptionsButton.png');
        expect(chromeButtonFile('btnHelp')).toBe('galactopediaButton.png');
        expect(chromeButtonFile('btnHistoryMessages')).toBe('messagesButton.png');
        expect(chromeButtonFile('btnCycleShipGroups')).toBe('cycleFleets.png');
        expect(chromeButtonFile('btnZoomIn')).toBe('zoomin.png');
        expect(chromeButtonFile('btnZoomColony')).toBe('zoomcolony.png');
    });

    it('returns null for controls with no chrome file', () => {
        // Runtime bitmaps in the original (play/pause, selection arrows).
        expect(chromeButtonFile('btnPlayPause')).toBeNull();
        expect(chromeButtonFile('btnSelectionBack')).toBeNull();
        expect(chromeButtonFile('btnSelectionForward')).toBeNull();
        // No matching file exists in the original chrome folder.
        expect(chromeButtonFile('btnZoomSystem')).toBeNull();
        expect(chromeButtonFile('lblStarDate')).toBeNull();
    });
});