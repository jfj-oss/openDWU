// Improvements category (ui/improvements.ts): the registry, the persisted on / off switches, the View popup's
// Improvements section split and the gating of an improvement's overlay (mapOverlays.ts overlayActive).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getSettings, setSettingsStorage, updateSettings, type SettingsStorage } from '../src/ui/settings';
import {
    improvementById,
    improvements,
    isImprovementEnabled,
    onImprovementsChange,
    overlayRowSections,
    registerImprovement,
    setImprovementEnabled,
} from '../src/ui/improvements';
import { OVERLAY_ROWS, createMapOverlayState, overlayActive } from '../src/ui/mapOverlays';

function memoryStorage(): SettingsStorage & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

beforeEach(() => {
    setSettingsStorage(memoryStorage());
    updateSettings({ improvements: {} });
});
afterEach(() => {
    updateSettings({ improvements: {} });
    setSettingsStorage(null);
});

describe('improvements registry', () => {
    it('registerImprovement adds or replaces by id; switches persist and notify', () => {
        const n = improvements().length;
        registerImprovement({ id: 'testOnly', label: 'Test', description: 'x', default: false });
        expect(improvements().length).toBe(n + 1);
        expect(improvementById('testOnly')!.label).toBe('Test');
        expect(isImprovementEnabled('testOnly')).toBe(false);
        registerImprovement({ id: 'testOnly', label: 'Test 2', description: 'y', default: true });
        expect(improvements().length).toBe(n + 1);
        expect(isImprovementEnabled('testOnly')).toBe(true);
        const seen: [string, boolean][] = [];
        const off = onImprovementsChange((id, on) => seen.push([id, on]));
        setImprovementEnabled('testOnly', false);
        expect(getSettings().improvements).toEqual({ testOnly: false });
        setImprovementEnabled('testOnly', false);
        setImprovementEnabled('testOnly', true);
        off();
        expect(seen).toEqual([
            ['testOnly', false],
            ['testOnly', true],
        ]);
    });
    it('splits overlay rows into the original and the enabled improvements', () => {
        const rows = [{ key: 'a' }, { key: 'b', improvement: 'testOnly' }];
        expect(overlayRowSections(rows).improvements.map((r) => r.key)).toEqual(['b']);
        setImprovementEnabled('testOnly', false);
        expect(overlayRowSections(rows)).toEqual({ original: [{ key: 'a' }], improvements: [] });
        expect(overlayRowSections(OVERLAY_ROWS).original.length).toBeGreaterThan(0);
        const st = createMapOverlayState();
        st.freightFlows = true;
        expect(overlayActive(st, 'freightFlows')).toBe(true);
    });
});
