import { describe, expect, it } from 'vitest';
import { createMapOverlayState, OVERLAY_ROWS, onOverlayChange, toggleOverlay } from '../src/ui/mapOverlays';

describe('map overlay state (task 05c)', () => {
    it('starts with every overlay off except Empire Territory (task M3: the original always shades territory)', () => {
        const s = createMapOverlayState();
        for (const row of OVERLAY_ROWS) {
            if (row.key === 'empireTerritory') {
                expect(s[row.key], row.label).toBe(true);
                continue;
            }
            expect(s[row.key], row.label).toBe(false);
        }
    });

    it('toggles a single flag in place', () => {
        const s = createMapOverlayState();
        toggleOverlay(s, 'scenicLocations');
        expect(s.scenicLocations).toBe(true);
        toggleOverlay(s, 'scenicLocations');
        expect(s.scenicLocations).toBe(false);
        // Other flags untouched.
        expect(s.fleetPostures).toBe(false);
        expect(s.empireTerritory).toBe(true); // task M3 default: on
    });

    it('notifies onOverlayChange subscribers on every toggle (task M3)', () => {
        const s = createMapOverlayState();
        let calls = 0;
        const unsubscribe = onOverlayChange(() => {
            calls++;
        });
        toggleOverlay(s, 'scenicLocations');
        toggleOverlay(s, 'scenicLocations');
        expect(calls).toBe(2);
        unsubscribe();
        toggleOverlay(s, 'scenicLocations');
        expect(calls).toBe(2);
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