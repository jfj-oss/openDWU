// Empire policy files for the Empire Policy panel's Load / Save (Main.Part3.cs btnEmpirePolicyLoad_Click /
// btnEmpirePolicySave_Click). The original opens a file dialog on <install>\Policy\ (or the customization set's
// Policy\ folder, GetCustomizationPath). Here the install's Policy/ files are served read-only from
// /assets/dwu/Policy/ (listed by public/asset-manifest.json "Policy" / "Policy/pirate", the browser cannot list a
// folder), and the player's own saves live in browser storage (the same "name ;value" text SaveToFile writes, keyed by
// file name). Storage can be missing or throw (private window, blocked site data): every access is guarded.

import { activeCustomizationSet } from '../sim/data/customization';
import { resolveDataUrl, resolveThemedDataUrl } from '../sim/data/paths';

/** One entry of the Load list: an install file (fetched) or a saved file (browser storage). */
export interface PolicyFileEntry {
    /** The file name as the dialog shows it (e.g. "Human.txt", "pirate/Human.txt", "MyPolicy.txt"). */
    name: string;
    source: 'install' | 'saved';
}

const STORAGE_KEY = 'dwu.empirePolicyFiles';

interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

function defaultStorage(): StorageLike | null {
    try {
        return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
        return null;
    }
}

function readSaved(storage: StorageLike | null): Record<string, string> {
    if (storage === null) return {};
    try {
        const raw = storage.getItem(STORAGE_KEY);
        if (raw === null) return {};
        const j = JSON.parse(raw) as unknown;
        if (j === null || typeof j !== 'object') return {};
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(j as Record<string, unknown>)) if (typeof v === 'string') out[k] = v;
        return out;
    } catch {
        return {};
    }
}

/** SaveFileDialog's DefaultExt "txt": a name without an extension gets ".txt"; '' for a blank name. */
export function policyFileName(name: string): string {
    const n = name.trim().replace(/[\\/]/g, '_');
    if (n === '') return '';
    return /\.txt$/i.test(n) ? n : `${n}.txt`;
}

/** The player's saved policy files, by name (sorted, case-insensitive as a file dialog lists them). */
export function savedPolicyFiles(storage: StorageLike | null = defaultStorage()): string[] {
    return Object.keys(readSaved(storage)).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

/** A saved file's text, or null. */
export function readSavedPolicyFile(name: string, storage: StorageLike | null = defaultStorage()): string | null {
    return readSaved(storage)[name] ?? null;
}

/** EmpirePolicy.SaveToFile into browser storage (FileMode.Create: an existing file of that name is replaced).
 *  Returns false when storage is unavailable or full. */
export function writeSavedPolicyFile(name: string, text: string, storage: StorageLike | null = defaultStorage()): boolean {
    if (storage === null || name === '') return false;
    const all = readSaved(storage);
    all[name] = text;
    try {
        storage.setItem(STORAGE_KEY, JSON.stringify(all));
        return true;
    } catch {
        return false;
    }
}

/** The Load list: the saved files, then the install's Policy/*.txt and Policy/pirate/*.txt (the manifest's lists). */
export function policyFileEntries(manifest: Readonly<Record<string, readonly string[] | undefined>>, storage: StorageLike | null = defaultStorage()): PolicyFileEntry[] {
    const out: PolicyFileEntry[] = savedPolicyFiles(storage).map((name) => ({ name, source: 'saved' as const }));
    // Main.Part3.cs 3815: with a theme the dialog opens on <customPath>Policy\ (no existence check).
    const theme = activeCustomizationSet();
    if (theme !== null) {
        for (const f of theme.listFiles('policy', '.txt')) out.push({ name: f, source: 'install' });
        for (const f of theme.listFiles('policy/pirate', '.txt')) out.push({ name: `pirate/${f}`, source: 'install' });
        return out;
    }
    for (const f of manifest['Policy'] ?? []) out.push({ name: f, source: 'install' });
    for (const f of manifest['Policy/pirate'] ?? []) out.push({ name: `pirate/${f}`, source: 'install' });
    return out;
}

/** The text of a Load list entry: storage, or /assets/dwu/[Customization/<set>/]Policy/<name> (the customization's
 *  folder first, as GetCustomizationPath). Rejects when the file cannot be read. */
export async function readPolicyFileEntry(entry: PolicyFileEntry, customizationSet?: string, fetcher: typeof fetch = fetch): Promise<string> {
    if (entry.source === 'saved') {
        const t = readSavedPolicyFile(entry.name);
        if (t === null) throw new Error(`no saved policy ${entry.name}`);
        return t;
    }
    const urls = customizationSet === undefined ? resolveThemedDataUrl(`Policy/${entry.name}`) : resolveDataUrl(`Policy/${entry.name}`, customizationSet);
    for (const url of urls) {
        try {
            const r = await fetcher(url);
            if (r.ok) return await r.text();
        } catch {
            // the next candidate
        }
    }
    throw new Error(`cannot read Policy/${entry.name}`);
}
