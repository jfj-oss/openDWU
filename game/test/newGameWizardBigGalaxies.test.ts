// Task 19k-1a (Big Galaxies): the wizard's informational note above the measured 60-empire / 1400-star range. The
// panel's DOM needs a browser (jsdom is not configured, see e.g. test/empiresList.test.ts), so this tests only the
// pure note text (empireCountPerformanceNote), which paintPreview() in newGameWizard.ts refreshes on every count /
// manual-list change.
import { describe, expect, it } from 'vitest';
import { empireCountPerformanceNote } from '../src/ui/screens/newGameWizard';

describe('empireCountPerformanceNote (task 19k-1a)', () => {
    it('is null at or below the measured 60-empire range', () => {
        expect(empireCountPerformanceNote(1)).toBeNull();
        expect(empireCountPerformanceNote(59)).toBeNull();
        expect(empireCountPerformanceNote(60)).toBeNull();
    });

    it('warns above 60 total empires (this many + the player)', () => {
        const note = empireCountPerformanceNote(61);
        expect(note).not.toBeNull();
        expect(note).toContain('61');
        expect(note).toContain('60-empire');
    });

    it('keeps warning at the wizard cap (100)', () => {
        expect(empireCountPerformanceNote(100)).not.toBeNull();
    });
});
