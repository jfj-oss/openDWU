// Task 12s: top-bar control → screen mapping (pure, no jsdom).

import { describe, expect, it } from 'vitest';
import { topBarScreen } from '../src/ui/hud';
import { TOP_BAR_BUTTONS } from '../src/ui/hudLayout';

describe('topBarScreen', () => {
    it('maps the three controls with an existing screen', () => {
        expect(topBarScreen('tbtnColonies')).toBe('colonies');
        expect(topBarScreen('btnEmpireSummary')).toBe('empireSummary');
        expect(topBarScreen('btnHistoryMessages')).toBe('messageHistory');
    });

    it('returns null for unmapped controls and unknown names', () => {
        // Galactic History is a different screen, not the message history.
        expect(topBarScreen('btnGalacticHistory')).toBeNull();
        expect(topBarScreen('tbtnResearch')).toBeNull();
        expect(topBarScreen('nonsense')).toBeNull();
    });

    it('every non-null result comes from a name in TOP_BAR_BUTTONS', () => {
        const names = [...TOP_BAR_BUTTONS] as readonly string[];
        for (const name of names) {
            const screen = topBarScreen(name);
            if (screen !== null) {
                expect(names).toContain(name);
            }
        }
    });
});