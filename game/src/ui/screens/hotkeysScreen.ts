// Hotkeys screen: remap every keyboard binding. Port of the Expanded mod's BaconDistantWorlds/HotKeys (HotKeyManager.cs
// GetHotKeyControl -> ExpansionMod HotKeyModEditorControl listing each KeyMappingTarget with its key; SaveChanges writes
// the mapping file) in the original-window look. Opened from Game Options -> HotKeys. Click a key, press the new chord
// (Esc cancels); rows sharing a chord are marked as conflicts; "Reset to defaults" restores the table. Saved to settings.

import './hotkeysScreen.css';
import { COLORS, FONT, el, glassButton, messageBox, openOriginalWindow, place, scrollPanel, text, type OriginalWindow } from '../originalWindow';
import { KEY_BINDINGS, getEffectiveBindings } from '../keyboard';
import { bindingId, bindingLabel, chordFromEvent, isRemappable } from '../keyBindingModel';
import { currentConflicts, remapBinding, resetAllBindings, resetBinding } from '../keyBindingStore';
import { isImprovementEnabled } from '../improvements';
import { getSettings } from '../settings';

const W = 840;
const H = 640;

let current: OriginalWindow | null = null;

/** Open the Hotkeys window (brings it forward if it is open). */
export function openHotkeysScreen(): OriginalWindow {
    if (current && !current.closed) {
        document.body.appendChild(current.root);
        return current;
    }
    const win = openOriginalWindow({ id: 'hotkeys', title: 'Hotkeys', width: W, height: H, onClose: () => { stopCapture(); current = null; } });
    current = win;
    const body = win.body;
    body.classList.add('hk-body');

    body.appendChild(place(text('Click a key, then press the new key combination. Escape cancels.', { size: FONT.normal, color: COLORS.label, shadow: false }), 12, 10));
    const heads: [string, number][] = [['Action', 8], ['Key', 418], ['', 558], ['Conflict', 618]];
    for (const [t, x] of heads) if (t !== '') body.appendChild(place(text(t, { size: FONT.normal, bold: true, color: COLORS.link, shadow: false }), 12 + x, 36));

    const scroll = scrollPanel('hk-scroll');
    body.appendChild(place(scroll, 12, 58, W - 30, win.bodySize.h - 58 - 60));
    const status = text('', { size: FONT.normal, color: COLORS.red, shadow: false });
    body.appendChild(place(status, 12, win.bodySize.h - 98));

    let capturing: string | null = null;

    const render = (): void => {
        scroll.replaceChildren();
        const conflicts = currentConflicts();
        const names = new Map(KEY_BINDINGS.map((b) => [bindingId(b), b.description] as const));
        const eff = getEffectiveBindings();
        const overrides = getSettings().keyBindingOverrides;
        const defaults = KEY_BINDINGS;
        let y = 0;
        // One row per default binding, in table order. The 0-9 groups list every digit.
        defaults.forEach((d, i) => {
            if (!isRemappable(d)) return;
            if (d.improvement !== undefined && !isImprovementEnabled(d.improvement)) return;
            const id = bindingId(d);
            const b = eff[i];
            const row = el('div', 'hk-row');
            row.style.top = `${y}px`;
            const label = d.overlayHidden || d.overlayKey ? `${d.description} (${d.key})` : d.description;
            const desc = el('div', 'hk-desc', label);
            desc.title = d.action;
            row.appendChild(desc);
            const isCap = capturing === id;
            const btn = glassButton(isCap ? 'Press a key...' : bindingLabel(b), { size: FONT.normal, toggled: isCap, className: 'hk-key', onClick: () => { capturing = isCap ? null : id; render(); } });
            row.appendChild(btn);
            if (overrides[id] !== undefined) {
                const reset = el('a', 'ow-link hk-reset', 'reset');
                reset.style.cursor = 'pointer';
                reset.style.color = COLORS.link;
                reset.addEventListener('click', () => { resetBinding(id); status.textContent = ''; render(); });
                row.appendChild(reset);
            }
            const c = conflicts.get(id);
            if (c) {
                row.classList.add('hk-row-conflict');
                const other = c.map((o) => names.get(o) ?? o).join(', ');
                const cf = el('div', 'hk-conflict', `Also: ${other}`);
                cf.title = other;
                row.appendChild(cf);
            }
            scroll.appendChild(row);
            y += 26;
        });
        const spacer = el('div');
        spacer.style.cssText = `position:absolute;top:${y}px;height:1px;width:1px`;
        scroll.appendChild(spacer);
        const n = conflicts.size;
        status.textContent = n > 0 ? `${n} binding${n === 1 ? ' shares its key' : 's share a key'} with another action.` : '';
    };

    const onKey = (e: KeyboardEvent): void => {
        if (capturing === null) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.key === 'Escape') { capturing = null; render(); return; }
        const chord = chordFromEvent(e);
        if (chord === null) return;
        const id = capturing;
        capturing = null;
        remapBinding(id, chord);
        render();
    };
    // Capture phase on window: runs before the game's own key handler and the window's Escape-to-close.
    window.addEventListener('keydown', onKey, true);
    function stopCapture(): void {
        window.removeEventListener('keydown', onKey, true);
        capturing = null;
    }

    const reset = glassButton('Reset to defaults', {
        size: FONT.normal,
        onClick: () => {
            void messageBox({ caption: 'Reset Hotkeys', text: 'Restore every key to its default?', buttons: ['Yes', 'No'] }).then((r) => {
                if (r === 'Yes') { resetAllBindings(); render(); }
            });
        },
    });
    body.appendChild(place(reset, 12, win.bodySize.h - 46, 200, 30));
    const close = glassButton('Close', { size: FONT.normal, onClick: () => win.close() });
    body.appendChild(place(close, W - 30 - 120, win.bodySize.h - 46, 120, 30));

    render();
    return win;
}
