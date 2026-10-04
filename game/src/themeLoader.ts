// Browser side of the theme (customization set) system: fetch the theme list / a theme's file index (served by the
// dev server, the desktop shell and dist: desktop/themeIndex.cjs) and make a theme the active one.
//
// The persisted choice is Settings.customizationSet (GameOptions.CustomizationSetName, written by the Change Theme
// panel, Start.cs method_2 bool_5). A theme switch reloads the page: the original re-runs its whole data / image /
// text / sound initialisation for the new set (Start.cs method_2, Main.Part12.cs method_66); a fresh page load is
// that, with every cache (Pixi textures, decoded images, the statics createGame installs) starting empty.
import { CustomizationSet, THEME_LIST_URL, normalizeCustomizationSetName, setActiveCustomizationSet, themeIndexUrl, type ThemeIndexJSON } from './sim/data/customization';
import { installThemeUrlHook } from './ui/themeUrlHook';

let themeList: Promise<string[]> | null = null;

/** The Customization subfolders (Start.cs method_28 order), [] when the list cannot be fetched. */
export function fetchThemeList(): Promise<string[]> {
    themeList ??= (async () => {
        try {
            const r = await fetch(THEME_LIST_URL);
            if (!r.ok) return [];
            const j = (await r.json()) as unknown;
            return Array.isArray(j) ? j.filter((x): x is string => typeof x === 'string') : [];
        } catch {
            return [];
        }
    })();
    return themeList;
}

/**
 * The file index of theme `name`. A theme whose folder is gone gets an empty index: like the original (which never
 * checks the folder when a save switches to its set, Main.Part12.cs method_66), every file then falls back to the
 * stock copy.
 */
export async function fetchThemeIndex(name: string): Promise<CustomizationSet> {
    try {
        const r = await fetch(themeIndexUrl(name));
        if (r.ok) {
            const j = (await r.json()) as ThemeIndexJSON;
            if (j && typeof j.set === 'string' && Array.isArray(j.files)) return new CustomizationSet(j);
        }
    } catch {
        // fall through
    }
    return new CustomizationSet({ set: name, files: [], dirs: [] });
}

/** Activate theme `name` ("" / "(Default)" / "default": the stock game) on this thread; returns it (null = stock). */
export async function activateTheme(name: string | null | undefined): Promise<CustomizationSet | null> {
    const set = normalizeCustomizationSetName(name);
    if (set === '') {
        setActiveCustomizationSet(null);
        return null;
    }
    const theme = await fetchThemeIndex(set);
    setActiveCustomizationSet(theme);
    installThemeUrlHook();
    return theme;
}

/**
 * Boot: the stored choice, cleared first when its folder no longer exists (Main.Part12.cs 1932-1938 / Start.cs
 * 888-895: !Directory.Exists(Customization\<set>\) → CustomizationSetName = ""). `stored` is the persisted value;
 * `clear` forgets it.
 */
export async function bootTheme(stored: string, clear: () => void): Promise<CustomizationSet | null> {
    const set = normalizeCustomizationSetName(stored);
    if (set === '') return activateTheme('');
    const list = await fetchThemeList();
    if (!list.some((t) => t.toLowerCase() === set.toLowerCase())) {
        clear();
        return activateTheme('');
    }
    return activateTheme(list.find((t) => t.toLowerCase() === set.toLowerCase()) ?? set);
}

/**
 * Main.Part12.cs 3181-3184, after the game loop ends (back to the Start screen): when the theme in use (string_3)
 * differs from GameOptions.CustomizationSetName — a game started with the session-only ?theme= — method_66(options'
 * set, bool_28: false) brings the options' theme back. The set to switch to ("" = the stock game), or null to stay.
 * A stored set whose folder is gone counts as "" (Main.Part12.cs 1932-1938 clears it at start-up).
 */
export function themeToRestoreOnLeave(active: string, stored: string, themes: readonly string[]): string | null {
    let want = normalizeCustomizationSetName(stored);
    if (want !== '') want = themes.find((t) => t.toLowerCase() === want.toLowerCase()) ?? '';
    return want === normalizeCustomizationSetName(active) ? null : want;
}

/** about.txt / about.png of a theme (Start.cs method_29), null parts when absent. */
export async function fetchThemeAbout(name: string): Promise<{ text: string; imageUrl: string | null }> {
    const theme = await fetchThemeIndex(name);
    let text = '';
    const txt = theme.fileUrl('about.txt');
    if (txt !== null) {
        try {
            const r = await fetch(txt);
            if (r.ok) text = await r.text();
        } catch {
            text = '';
        }
    }
    return { text: text.replace(/^﻿/, ''), imageUrl: theme.fileUrl('about.png') };
}

/** Galaxy maps of a theme (Start.cs method_30: Customization\<set>\maps\*.dwg; the stock maps\ for "(Default)"). */
export async function fetchThemeMapCount(name: string): Promise<number> {
    const set = normalizeCustomizationSetName(name);
    if (set === '') return 0; // the stock install ships no maps\ folder
    const theme = await fetchThemeIndex(set);
    return theme.listFiles('maps', '.dwg').length;
}
