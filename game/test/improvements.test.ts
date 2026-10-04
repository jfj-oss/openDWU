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
    it('has the supply-chain improvement, on by default', () => {
        const imp = improvementById('supplyChain');
        expect(imp).not.toBeNull();
        expect(imp!.default).toBe(true);
        expect(isImprovementEnabled('supplyChain')).toBe(true);
        expect(improvements().every((i) => i.label !== '' && i.description !== '')).toBe(true);
    });
    it('switches persist in the UI settings and notify the listeners', () => {
        const seen: [string, boolean][] = [];
        const off = onImprovementsChange((id, on) => seen.push([id, on]));
        setImprovementEnabled('supplyChain', false);
        expect(isImprovementEnabled('supplyChain')).toBe(false);
        expect(getSettings().improvements).toEqual({ supplyChain: false });
        setImprovementEnabled('supplyChain', false); // no change, no event
        setImprovementEnabled('supplyChain', true);
        off();
        expect(seen).toEqual([
            ['supplyChain', false],
            ['supplyChain', true],
        ]);
    });
    it('registerImprovement adds or replaces by id', () => {
        const n = improvements().length;
        registerImprovement({ id: 'testOnly', label: 'Test', description: 'x', default: false });
        expect(improvements().length).toBe(n + 1);
        expect(isImprovementEnabled('testOnly')).toBe(false);
        registerImprovement({ id: 'testOnly', label: 'Test 2', description: 'y', default: true });
        expect(improvements().length).toBe(n + 1);
        expect(isImprovementEnabled('testOnly')).toBe(true);
    });
});

describe('overlay section and gating', () => {
    it('lists improvement overlays in their own section, only while enabled', () => {
        let s = overlayRowSections(OVERLAY_ROWS);
        expect(s.improvements.map((r) => r.key)).toContain('supplyShortages');
        expect(s.original.map((r) => r.key)).not.toContain('supplyShortages');
        expect(s.original.length + s.improvements.length).toBe(OVERLAY_ROWS.length);
        setImprovementEnabled('supplyChain', false);
        s = overlayRowSections(OVERLAY_ROWS);
        expect(s.improvements.map((r) => r.key)).not.toContain('supplyShortages');
    });
    it('overlayActive: the toggle and the improvement both on', () => {
        const st = createMapOverlayState();
        expect(overlayActive(st, 'supplyShortages')).toBe(false);
        st.supplyShortages = true;
        expect(overlayActive(st, 'supplyShortages')).toBe(true);
        setImprovementEnabled('supplyChain', false);
        expect(overlayActive(st, 'supplyShortages')).toBe(false);
        // Overlays outside the category are not gated.
        st.freightFlows = true;
        expect(overlayActive(st, 'freightFlows')).toBe(true);
    });
});
