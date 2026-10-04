// Theme (customization set) index, shared by scripts/gen-asset-manifest.mjs (dev/build), vite.config.ts (dev server)
// and desktop/main.cjs (the packaged shell, which indexes the USER's install at runtime).
//
// The original game lists every subfolder of <install>\Customization\ as a theme (Start.cs method_28:
// Directory.GetDirectories, then list.Sort() — the current-culture string comparison) and, for the active theme,
// probes individual files with File.Exists / Directory.Exists. The browser can do neither, so these helpers produce:
//   - listThemes(dwuRoot): the sorted folder names (the Change Theme list without "(Default)");
//   - buildThemeIndex(dwuRoot, set): { set, files: [relative paths with their on-disk casing, '/'-separated], dirs: [the
//     folders below the theme root, same form — Directory.Exists holds for an empty folder too] } for the
//     theme's top-level files plus every file under the folders the engine reads from a customization set (images,
//     sounds, help, races, policy, designTemplates, characters, dialog, maps, designs — matched case-insensitively,
//     Windows paths are case-insensitive). Other content (mod executables, spreadsheets, source trees) is skipped.
// Served at /theme-manifest/index.json and /theme-manifest/<encodeURIComponent(set)>.json.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

/** Folders (lower-case) the engine reads from Customization\<set>\ (see src/sim/data/customization.ts). */
const THEME_FOLDERS = ['images', 'sounds', 'help', 'races', 'policy', 'designtemplates', 'characters', 'dialog', 'maps', 'designs'];

// .NET List<string>.Sort() on the folder names: culture-sensitive comparison (en-US collation stands in for the
// Windows user culture).
const collator = new Intl.Collator('en-US');

/** Windows Directory.GetFiles order (case-insensitive ordinal), used for every folder listing. */
function windowsOrdinal(a, b) {
    const la = a.toLowerCase();
    const lb = b.toLowerCase();
    if (la < lb) return -1;
    if (la > lb) return 1;
    return 0;
}

function customizationDir(dwuRoot) {
    let entries;
    try {
        entries = fs.readdirSync(dwuRoot, { withFileTypes: true });
    } catch {
        return null;
    }
    const hit = entries.find((e) => e.isDirectory() && e.name.toLowerCase() === 'customization');
    return hit ? path.join(dwuRoot, hit.name) : null;
}

/** Every subfolder name of <dwuRoot>/Customization, sorted like Start.cs method_28 ([] when absent). */
function listThemes(dwuRoot) {
    const dir = customizationDir(dwuRoot);
    if (dir === null) return [];
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return [];
    }
    return entries
        .filter((e) => e.isDirectory() || (e.isSymbolicLink() && isDir(path.join(dir, e.name))))
        .map((e) => e.name)
        .sort(collator.compare);
}

function isDir(p) {
    try {
        return fs.statSync(p).isDirectory();
    } catch {
        return false;
    }
}

function walk(absDir, rel, out, dirs) {
    dirs.push(rel);
    let entries;
    try {
        entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const e of entries) {
        const abs = path.join(absDir, e.name);
        const r = `${rel}/${e.name}`;
        if (e.isDirectory() || (e.isSymbolicLink() && isDir(abs))) walk(abs, r, out, dirs);
        else out.push(r);
    }
}

/**
 * The file index of one theme, or null when `set` is not a folder of Customization (or tries to escape it).
 * Files are sorted case-insensitively (Directory.GetFiles order) so folder listings derived from it keep that order.
 */
function buildThemeIndex(dwuRoot, set) {
    if (typeof set !== 'string' || set === '' || set.includes('/') || set.includes('\\') || set === '.' || set === '..') return null;
    const dir = customizationDir(dwuRoot);
    if (dir === null) return null;
    const actual = listThemes(dwuRoot).find((name) => name.toLowerCase() === set.toLowerCase());
    if (actual === undefined) return null;
    const root = path.join(dir, actual);
    const files = [];
    const dirs = [];
    let entries;
    try {
        entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
        return null;
    }
    for (const e of entries) {
        const abs = path.join(root, e.name);
        if (e.isDirectory() || (e.isSymbolicLink() && isDir(abs))) {
            if (THEME_FOLDERS.includes(e.name.toLowerCase())) walk(abs, e.name, files, dirs);
        } else {
            files.push(e.name);
        }
    }
    files.sort(windowsOrdinal);
    dirs.sort(windowsOrdinal);
    return { set: actual, files, dirs };
}

module.exports = { listThemes, buildThemeIndex, THEME_FOLDERS, windowsOrdinal };
