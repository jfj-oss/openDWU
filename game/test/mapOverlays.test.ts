import { describe, expect, it } from 'vitest';
import { createMapOverlayState, OVERLAY_ROWS, toggleOverlay } from '../src/ui/mapOverlays';

describe('map overlay state (task 05c)', () => {
    it('starts with every overlay off', () => {
        const s = createMapOverlayState();
        for (const row of OVERLAY_ROWS) {
            expect(s[row.key], row.label).toBe(false);
        }
    });

    it('toggles a single flag in place', () => {
        const s = createMapOverlayState();
        toggleOverlay(s, 'empireTerritory');
        expect(s.empireTerritory).toBe(true);
        toggleOverlay(s, 'empireTerritory');
        expect(s.empireTerritory).toBe(false);
        // Other flags untouched.
        expect(s.fleetPostures).toBe(false);
    });

    it('lists all nine overlays in display order', () => {
        expect(OVERLAY_ROWS.map((r) => r.key)).toEqual([
            'fleetPostures',
            'travelVectorsState',
            'travelVectorsPrivate',
            'potentialColonies',
            'scenicLocations',
            'researchLocations',
            'longRangeScanners',
            'empireTerritory',
            'fadeCivilianShips',
        ]);
    });
});