// Customization sets ("themes"): the original's <install>\Customization\<set>\ folders.
//
// The original probes a theme's files with File.Exists / Directory.Exists (Windows: case-insensitive) and then reads
// the customized copy instead of the stock one. The browser can do neither, so the theme's file list is served as an
// index (desktop/themeIndex.cjs, /theme-manifest/<set>.json) and wrapped here in a CustomizationSet that answers those
// probes. Pure: no DOM, no fetch (callers fetch the index, src/themeLoader.ts).
//
// Which value is "the" set name: Main.Part12.cs CustomizationSetName() — the game's CustomizationSetName, else the
// options' — with "" and "default" (any case) meaning no theme; the Change Theme list's "(Default)" entry stores ""
// (Start.cs method_2).

/** The index served for one theme (desktop/themeIndex.cjs buildThemeIndex). */
export interface ThemeIndexJSON {
    set: string;
    /** Files relative to the theme folder, '/'-separated, on-disk casing. */
    files: string[];
    /** Folders below the theme folder (Directory.Exists is true for an empty folder too). */
    dirs?: string[];
}

/** The "(Default)" entry of the Change Theme list (Start.cs method_28 / method_29). */
export const DEFAULT_THEME_LABEL = '(Default)';

/**
 * The set name the engine uses for a stored value: "" for none (null/empty, "default" — Main.Part12.cs
 * CustomizationSetName() / Galaxy.4.cs LoadRaces' ToLower() != "default" — and the list's "(Default)", Start.cs method_2).
 */
export function normalizeCustomizationSetName(name: string | null | undefined): string {
    if (name === null || name === undefined) return '';
    if (name === '' || name.toLowerCase() === 'default' || name === DEFAULT_THEME_LABEL) return '';
    return name;
}

/** Percent-encode each '/'-separated segment of a relative path (theme names contain spaces, commas, apostrophes). */
export function encodePathSegments(rel: string): string {
    return rel.split('/').map(encodeSegment).join('/');
}

/** encodeURI of one path segment plus the characters it leaves that end a path ('#', '?'): spaces become %20 while
 *  ',', "'" and '(' stay literal (the dev server's static serving does not decode %2C). */
function encodeSegment(seg: string): string {
    return encodeURI(seg).replace(/[#?/]/g, (c) => encodeURIComponent(c));
}

/** URL of a file inside a theme folder (`actualRel` with its on-disk casing). */
export function customizationFileUrl(set: string, actualRel: string): string {
    return `/assets/dwu/Customization/${encodeSegment(set)}/${encodePathSegments(actualRel)}`;
}

/** URL of the theme's file index (desktop/themeIndex.cjs, served by the dev server / desktop shell / dist). */
export function themeIndexUrl(set: string): string {
    return `/theme-manifest/${encodeSegment(set)}.json`;
}

/** URL of the theme list (Customization subfolders, sorted like Start.cs method_28). */
export const THEME_LIST_URL = '/theme-manifest/index.json';

function trimSlashes(rel: string): string {
    return rel.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

/** One theme's files, with the original's File.Exists / Directory.Exists / Directory.GetFiles answered from its index. */
export class CustomizationSet {
    readonly name: string;
    private readonly files = new Map<string, string>();
    /** lower-case folder path -> on-disk casing. */
    private readonly dirs = new Map<string, string>();
    private readonly listings = new Map<string, string[]>();

    constructor(index: ThemeIndexJSON) {
        this.name = index.set;
        for (const raw of index.files) {
            const rel = trimSlashes(raw);
            const lower = rel.toLowerCase();
            this.files.set(lower, rel);
            const slash = rel.lastIndexOf('/');
            const dir = slash < 0 ? '' : lower.slice(0, slash);
            let list = this.listings.get(dir);
            if (list === undefined) this.listings.set(dir, (list = []));
            list.push(rel.slice(slash + 1));
            this.addAncestors(rel);
        }
        for (const raw of index.dirs ?? []) {
            const rel = trimSlashes(raw);
            this.addAncestors(rel);
            if (!this.dirs.has(rel.toLowerCase())) this.dirs.set(rel.toLowerCase(), rel);
        }
        // index.files is sorted (Directory.GetFiles order); keep each folder listing in that order.
        for (const list of this.listings.values()) list.sort(windowsOrdinal);
    }

    /** Every folder above `rel` exists. */
    private addAncestors(rel: string): void {
        for (let i = rel.indexOf('/'); i >= 0; i = rel.indexOf('/', i + 1)) {
            const dir = rel.slice(0, i);
            if (!this.dirs.has(dir.toLowerCase())) this.dirs.set(dir.toLowerCase(), dir);
        }
    }

    /** File.Exists(<set>\rel) — case-insensitive. */
    fileExists(rel: string): boolean {
        return this.files.has(trimSlashes(rel).toLowerCase());
    }

    /** The on-disk relative path of `rel`, or null when the theme has no such file. */
    actualPath(rel: string): string | null {
        return this.files.get(trimSlashes(rel).toLowerCase()) ?? null;
    }

    /** URL of the theme's copy of `rel`, or null when it has none. */
    fileUrl(rel: string): string | null {
        const actual = this.actualPath(rel);
        return actual === null ? null : customizationFileUrl(this.name, actual);
    }

    /** Directory.Exists(<set>\relDir). */
    dirExists(relDir: string): boolean {
        const lower = trimSlashes(relDir).toLowerCase();
        return lower === '' || this.dirs.has(lower);
    }

    /**
     * Directory.GetFiles(<set>\relDir, "*<ext>", TopDirectoryOnly) file NAMES (on-disk casing), in Windows order
     * (case-insensitive ordinal); [] for a missing folder. `ext` is matched case-insensitively (".png"); omit for all.
     */
    listFiles(relDir: string, ext?: string): string[] {
        const list = this.listings.get(trimSlashes(relDir).toLowerCase()) ?? [];
        if (ext === undefined) return [...list];
        const e = ext.toLowerCase();
        return list.filter((f) => f.toLowerCase().endsWith(e));
    }

    /** Directory.GetDirectories(<set>\relDir) folder NAMES (on-disk casing), in Windows order; [] for a missing folder. */
    subfolders(relDir: string): string[] {
        const lower = trimSlashes(relDir).toLowerCase();
        const prefix = lower === '' ? '' : lower + '/';
        const out: string[] = [];
        for (const [k, v] of this.dirs) {
            if (k.startsWith(prefix) && k.length > prefix.length && !k.slice(prefix.length).includes('/')) out.push(v.slice(prefix.length));
        }
        return out.sort(windowsOrdinal);
    }

    /** Directory.GetDirectories(<set>\relDir).Length > 0. */
    hasSubfolder(relDir: string): boolean {
        return this.subfolders(relDir).length > 0;
    }

    /** The on-disk relative path of folder `relDir` (for building URLs of its listed files), or null when missing. */
    actualDir(relDir: string): string | null {
        const lower = trimSlashes(relDir).toLowerCase();
        if (lower === '') return '';
        return this.dirs.get(lower) ?? null;
    }

    /** URL of file `name` (as listed by listFiles) in folder `relDir`. */
    listedFileUrl(relDir: string, name: string): string {
        const dir = this.actualDir(relDir) ?? trimSlashes(relDir);
        return customizationFileUrl(this.name, dir === '' ? name : `${dir}/${name}`);
    }
}

/** Windows Directory.GetFiles order: case-insensitive ordinal. */
export function windowsOrdinal(a: string, b: string): number {
    const la = a.toLowerCase();
    const lb = b.toLowerCase();
    return la < lb ? -1 : la > lb ? 1 : 0;
}

// ---------------------------------------------------------------------------
// The active theme of this thread (main thread: the menu's choice or the loaded game's; sim worker: the boot's).

let active: CustomizationSet | null = null;

/** Make `set` the active theme (null: the stock game). */
export function setActiveCustomizationSet(set: CustomizationSet | null): void {
    active = set;
}

/** The active theme, or null for the stock game. */
export function activeCustomizationSet(): CustomizationSet | null {
    return active;
}

/** The active theme's name, "" for the stock game (Main.Part12.cs CustomizationSetName()). */
export function activeCustomizationSetName(): string {
    return active?.name ?? '';
}
