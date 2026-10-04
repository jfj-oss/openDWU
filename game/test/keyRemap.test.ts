import { beforeEach, describe, expect, it } from 'vitest';
import { KEY_BINDINGS, dispatchKey, getEffectiveBindings } from '../src/ui/keyboard';
import { bindingId, chordFromEvent, findConflicts } from '../src/ui/keyBindingModel';
import { currentConflicts, remapBinding, resetAllBindings, resetBinding } from '../src/ui/keyBindingStore';
import { getSettings, loadSettings, setSettingsStorage, type SettingsStorage } from '../src/ui/settings';

// Hotkeys screen (Bacon mod HotKeys): remap, conflicts, reset, persistence. Pure -- the window itself needs a browser.

function memoryStorage(): SettingsStorage & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}
const ev = (key: string, m: { ctrl?: boolean; shift?: boolean } = {}) => ({ key, ctrlKey: !!m.ctrl, altKey: false, shiftKey: !!m.shift, target: null });
const idOf = (action: string, key: string) => bindingId(KEY_BINDINGS.find((b) => b.action === action && b.key === key)!);
const NOKEY = { ctrl: false, alt: false, shift: false };

describe('key remapping', () => {
    let store: ReturnType<typeof memoryStorage>;
    beforeEach(() => {
        store = memoryStorage();
        setSettingsStorage(store);
        resetAllBindings();
    });

    it('defaults are the unmodified table and have no conflicts', () => {
        expect(getEffectiveBindings()).toBe(KEY_BINDINGS);
        expect(currentConflicts().size).toBe(0);
        expect(dispatchKey(ev('g'), {})).toBe('galaxyMap');
    });

    it('a remapped row answers to its new key only', () => {
        const conflicts = remapBinding(idOf('galaxyMap', 'G'), { key: 'J', ...NOKEY });
        expect(conflicts).toEqual([]);
        expect(dispatchKey(ev('j'), {})).toBe('galaxyMap');
        expect(dispatchKey(ev('g'), {})).toBeNull();
        expect(getEffectiveBindings().find((b) => b.action === 'galaxyMap')!.key).toBe('J');
    });

    it('remapping with a modifier works', () => {
        remapBinding(idOf('galaxyMap', 'G'), { key: 'G', ctrl: true, alt: false, shift: false });
        expect(dispatchKey(ev('g', { ctrl: true }), {})).toBe('galaxyMap');
        expect(dispatchKey(ev('g'), {})).toBeNull();
    });

    it('two actions on one chord are reported as conflicts (both ways)', () => {
        const conflicts = remapBinding(idOf('galaxyMap', 'G'), { key: 'H', ...NOKEY });
        const hid = idOf('messageHistoryScreen', 'H');
        expect(conflicts).toEqual([hid]);
        expect(currentConflicts().get(hid)).toEqual([idOf('galaxyMap', 'G')]);
        expect(findConflicts(KEY_BINDINGS, getEffectiveBindings()).size).toBe(2);
    });

    it('Pause and Space (one action) do not conflict with each other', () => {
        remapBinding(idOf('togglePause', 'Pause'), { key: 'Space', ...NOKEY });
        expect(currentConflicts().size).toBe(0);
    });

    it('reset one row and reset all restore the defaults', () => {
        remapBinding(idOf('galaxyMap', 'G'), { key: 'J', ...NOKEY });
        remapBinding(idOf('coloniesScreen', 'F2'), { key: 'K', ...NOKEY });
        resetBinding(idOf('galaxyMap', 'G'));
        expect(dispatchKey(ev('g'), {})).toBe('galaxyMap');
        expect(Object.keys(getSettings().keyBindingOverrides)).toEqual([idOf('coloniesScreen', 'F2')]);
        resetAllBindings();
        expect(getSettings().keyBindingOverrides).toEqual({});
        expect(getEffectiveBindings()).toBe(KEY_BINDINGS);
        expect(dispatchKey(ev('F2'), {})).toBe('coloniesScreen');
    });

    it('remaps persist to the settings storage and load back', () => {
        remapBinding(idOf('galaxyMap', 'G'), { key: 'J', ...NOKEY });
        const raw = store.data.get('dwu-ui-settings')!;
        expect(JSON.parse(raw).keyBindingOverrides[idOf('galaxyMap', 'G')].key).toBe('J');
        expect(loadSettings().keyBindingOverrides[idOf('galaxyMap', 'G')]).toEqual({ key: 'J', ...NOKEY });
    });

    it('malformed stored overrides are dropped', () => {
        store.data.set('dwu-ui-settings', JSON.stringify({ keyBindingOverrides: { a: { key: 3 }, b: 'x', 'galaxyMap:G': { key: 'J', ctrl: false, alt: false, shift: false } } }));
        expect(Object.keys(loadSettings().keyBindingOverrides)).toEqual(['galaxyMap:G']);
    });

    it('a remapped control-group digit is listed on its own in the overlay model', () => {
        remapBinding(idOf('selectControlGroup3', '3'), { key: 'Q', ...NOKEY });
        const rows = getEffectiveBindings().filter((b) => b.action.startsWith('selectControlGroup') && !b.action.includes('With'));
        expect(rows.every((b) => !b.overlayHidden && b.overlayKey === undefined)).toBe(true);
        expect(dispatchKey(ev('q'), {})).toBe('selectControlGroup3');
    });

    it('chordFromEvent: bare modifiers are ignored, digits use the physical key, space is named', () => {
        expect(chordFromEvent({ key: 'Shift', ctrlKey: false, altKey: false, shiftKey: true })).toBeNull();
        expect(chordFromEvent({ key: '!', code: 'Digit1', ctrlKey: false, altKey: false, shiftKey: true })).toEqual({ key: '1', ctrl: false, alt: false, shift: true });
        expect(chordFromEvent({ key: ' ', ctrlKey: false, altKey: false, shiftKey: false })!.key).toBe('Space');
        expect(chordFromEvent({ key: 'g', ctrlKey: true, altKey: false, shiftKey: false })).toEqual({ key: 'G', ctrl: true, alt: false, shift: false });
    });
});
