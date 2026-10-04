// Key remapping model: the pure half of the Hotkeys screen. Port of the Expanded mod's BaconDistantWorlds/HotKeys
// (HotKeyManager.cs: GetMappedTarget(List<Keys>) resolves a pressed key set to its target; SaveChanges writes the
// edited mapping, GameHotKeysMappingFile.json). A binding row is identified by its DEFAULT chord (`action:key[+mods]`);
// the player's changes are a sparse override map (persisted in the settings) so unchanged rows follow the defaults.

import type { KeyBinding, KeyModifiers } from './keyboard';

/** One chord: a key (the table's names: 'G', 'F5', 'Space', ...) and its modifiers. */
export interface KeyChord {
    key: string;
    ctrl: boolean;
    alt: boolean;
    shift: boolean;
}

/** The persisted overrides: row id -> the chord that row now uses. */
export type KeyOverrides = Record<string, KeyChord>;

/** Rows that are not real key bindings (the "Ctrl with zoom keys" note) cannot be remapped. */
export function isRemappable(b: KeyBinding): boolean {
    return b.action !== 'ctrlWithZoomKeys';
}

/** Stable id of a default row: the action plus its default chord (Pause and Space both toggle the pause). */
export function bindingId(b: KeyBinding): string {
    const m = b.modifiers;
    return `${b.action}:${m.ctrl ? 'Ctrl+' : ''}${m.alt ? 'Alt+' : ''}${m.shift ? 'Shift+' : ''}${b.key}`;
}

/** The chord as a string key for comparisons (letters are upper-case in the table). */
export function chordId(c: { key: string } & KeyModifiers): string {
    return `${c.ctrl ? 'Ctrl+' : ''}${c.alt ? 'Alt+' : ''}${c.shift ? 'Shift+' : ''}${c.key.length === 1 ? c.key.toUpperCase() : c.key}`;
}

/** The chord as the UI shows it. */
export function chordLabel(c: { key: string } & KeyModifiers): string {
    const k = (() => {
        switch (c.key) {
            case 'ArrowUp': return '↑';
            case 'ArrowDown': return '↓';
            case 'ArrowLeft': return '←';
            case 'ArrowRight': return '→';
            case 'Escape': return 'Esc';
            case 'PageUp': return 'PgUp';
            case 'PageDown': return 'PgDn';
            case 'Backspace': return 'Bksp';
            default: return c.key;
        }
    })();
    return `${c.ctrl ? 'Ctrl+' : ''}${c.alt ? 'Alt+' : ''}${c.shift ? 'Shift+' : ''}${k}`;
}

/** A row's current chord as the UI shows it. */
export function bindingLabel(b: KeyBinding): string {
    return chordLabel({ key: b.key, ...b.modifiers });
}

/** The chord a keydown means while a row waits for its new key; null for a bare modifier press. */
export function chordFromEvent(e: { key: string; code?: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }): KeyChord | null {
    if (e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta' || e.key === 'AltGraph') return null;
    let key = e.key;
    const m = e.code === undefined ? null : /^Digit(\d)$/.exec(e.code);
    if (m !== null) key = m[1];
    else if (e.code === 'BracketLeft') key = '[';
    else if (key === ' ') key = 'Space';
    else if (key.length === 1) key = key.toUpperCase();
    return { key, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey };
}

const overrideCache = new WeakMap<KeyOverrides, WeakMap<readonly KeyBinding[], KeyBinding[]>>();

/** The defaults with the overrides applied (the same array when there are none). Cached per (defaults, overrides). */
export function applyOverrides(defaults: readonly KeyBinding[], overrides: KeyOverrides | undefined): readonly KeyBinding[] {
    if (overrides === undefined) return defaults;
    const ids = Object.keys(overrides);
    if (ids.length === 0) return defaults;
    let perDefaults = overrideCache.get(overrides);
    const hit = perDefaults?.get(defaults);
    if (hit !== undefined) return hit;
    // A 0-9 overlay row stands for ten rows; once one of them is remapped the ten are listed one by one.
    const groupKey = (b: KeyBinding): string | null => (b.overlayKey !== undefined || b.overlayHidden === true ? `${b.action.replace(/\d$/, '')}` : null);
    const splitGroups = new Set<string>();
    for (const b of defaults) {
        const g = groupKey(b);
        if (g !== null && overrides[bindingId(b)] !== undefined) splitGroups.add(g);
    }
    const out = defaults.map((b): KeyBinding => {
        const o = overrides[bindingId(b)];
        const g = groupKey(b);
        const split = g !== null && splitGroups.has(g);
        if (o === undefined && !split) return b;
        const r: KeyBinding = { ...b };
        if (o !== undefined) {
            r.key = o.key;
            r.modifiers = { ctrl: o.ctrl, alt: o.alt, shift: o.shift };
        }
        if (split) {
            delete r.overlayKey;
            delete r.overlayHidden;
        }
        return r;
    });
    if (perDefaults === undefined) {
        perDefaults = new WeakMap();
        overrideCache.set(overrides, perDefaults);
    }
    perDefaults.set(defaults, out);
    return out;
}

/** For each row id (of the default table), the ids of the other rows on the same chord (only rows that conflict appear). `active` leaves out
 *  rows that do nothing now (an Improvement's key while it is off). */
export function findConflicts(defaults: readonly KeyBinding[], bindings: readonly KeyBinding[], active: (b: KeyBinding) => boolean = () => true): Map<string, string[]> {
    const byChord = new Map<string, KeyBinding[]>();
    const ids = new Map<KeyBinding, string>(); // the id is the DEFAULT row's, not the remapped chord's
    bindings.forEach((b, i) => ids.set(b, bindingId(defaults[i])));
    for (const b of bindings) {
        if (!isRemappable(b) || !active(b)) continue;
        const c = chordId({ key: b.key, ...b.modifiers });
        const list = byChord.get(c);
        if (list) list.push(b);
        else byChord.set(c, [b]);
    }
    const out = new Map<string, string[]>();
    for (const list of byChord.values()) {
        if (list.length < 2) continue;
        // Pause and Space (one action on two keys) never conflict with themselves.
        for (const b of list) {
            const others = list.filter((o) => o !== b && o.action !== b.action).map((o) => ids.get(o)!);
            if (others.length > 0) out.set(ids.get(b)!, others);
        }
    }
    return out;
}

/** Remap one row: the override is dropped when the chord equals the row's default. Pure (returns the new map). */
export function withOverride(defaults: readonly KeyBinding[], overrides: KeyOverrides, id: string, chord: KeyChord): KeyOverrides {
    const next: KeyOverrides = { ...overrides };
    const d = defaults.find((b) => bindingId(b) === id);
    if (d === undefined) return overrides;
    if (chordId({ key: d.key, ...d.modifiers }) === chordId(chord)) delete next[id];
    else next[id] = chord;
    return next;
}

/** Validate a stored override map (unknown ids and malformed chords are dropped). */
export function sanitizeOverrides(raw: unknown, defaults?: readonly KeyBinding[]): KeyOverrides {
    const out: KeyOverrides = {};
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
    const known = defaults === undefined ? null : new Set(defaults.filter(isRemappable).map(bindingId));
    for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
        if ((known !== null && !known.has(id)) || v === null || typeof v !== 'object') continue;
        const c = v as Partial<KeyChord>;
        if (typeof c.key !== 'string' || c.key === '' || typeof c.ctrl !== 'boolean' || typeof c.alt !== 'boolean' || typeof c.shift !== 'boolean') continue;
        out[id] = { key: c.key, ctrl: c.ctrl, alt: c.alt, shift: c.shift };
    }
    return out;
}
