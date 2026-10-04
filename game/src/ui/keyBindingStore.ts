// The Hotkeys screen's actions on the persisted remaps (Bacon mod HotKeyManager.SaveChanges): remap one row, reset one
// or all to the defaults. Every change is written to the settings at once.

import { KEY_BINDINGS, getEffectiveBindings } from './keyboard';
import { bindingId, findConflicts, withOverride, type KeyChord } from './keyBindingModel';
import { isImprovementEnabled } from './improvements';
import { getSettings, updateSettings } from './settings';

/** Row ids whose chord is shared with another action now (a conflict: the first row in table order wins the key). */
export function currentConflicts(): Map<string, string[]> {
    return findConflicts(KEY_BINDINGS, getEffectiveBindings(), (b) => b.improvement === undefined || isImprovementEnabled(b.improvement));
}

/** Give a row a new chord and persist it. Returns the ids of the rows it now conflicts with. */
export function remapBinding(id: string, chord: KeyChord): string[] {
    updateSettings({ keyBindingOverrides: withOverride(KEY_BINDINGS, getSettings().keyBindingOverrides, id, chord) });
    return currentConflicts().get(id) ?? [];
}

/** Put one row back on its default chord. */
export function resetBinding(id: string): void {
    const d = KEY_BINDINGS.find((b) => bindingId(b) === id);
    if (d === undefined) return;
    remapBinding(id, { key: d.key, ...d.modifiers });
}

/** "Reset to defaults": drop every remap. */
export function resetAllBindings(): void {
    updateSettings({ keyBindingOverrides: {} });
}
