// The asset manifest (/asset-manifest.json): folder listings of a DW:U install that the browser cannot make itself.
// Shared by scripts/gen-asset-manifest.mjs (npm run dev: writes public/asset-manifest.json from the linked install) and
// desktop/main.cjs (the desktop shell: built from the USER's install folder at launch and served at
// dwu://app/asset-manifest.json). The build (dist/) carries no copy: it is made on machines without the install
// (GitHub's release runners), and a listing of the build machine's install would not describe the player's anyway.
//
// buildAssetManifest(dwuRoot) returns a flat map of folder path -> sorted list of file names, for:
//   - EVERY folder under images/environment/ (*.png), keys relative to images/environment/, e.g. "planets/ocean".
//   - races/ (*.txt), key "races".
//   - images/ui/flagshapes/ (*.png, top level), key "ui/flagshapes".
//   - Policy/ (*.txt, top level only), key "Policy".
//   - Policy/pirate/ (*.txt), key "Policy/pirate".
//   - designTemplates/<race>/ (*.txt, top level only) for every subfolder of designTemplates/ (including DEFAULT), key
//     "designTemplates/<race>", and its pirate/ subfolder, key "designTemplates/<race>/pirate" (always written, []
//     when absent).
//   - characters/ (*.txt), key "characters" (always written).
//   - Help/ (*.mht, top level only; folder looked up case-insensitively), key "Help".
//   - Customization/<set>/help/ (*.mht) for every subfolder <set> of Customization/ that has a help folder (any case),
//     key "Customization/<set>/help".
// assets.ts picks real files out of the image lists via pictureRef modulo the folder's file count, gameData.ts uses the
// races/Policy/designTemplates lists to discover data files, and the Galactopedia uses the Help lists for Galaxy.9.cs
// AddThemeTopics / AddGameInfoTopics.
//
// Sort order matches the original engine: Main.Part13.cs LoadMapStars / LoadStars / LoadNebulae call
// Directory.GetFiles(..., "*.png") and index the result by order. On Windows that is the NTFS ordinal
// (case-insensitive) name order, so we sort the same way: case-insensitive ordinal comparison. The same order is used
// for the data-file lists (races/Policy/designTemplates), matching Directory.GetFiles(..., "*.txt") elsewhere in the
// engine (e.g. Galaxy.4.cs LoadRaces).
'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Windows Directory.GetFiles order: case-insensitive ordinal (char-code) sort.
function windowsOrdinal(a, b) {
    const la = a.toLowerCase();
    const lb = b.toLowerCase();
    if (la < lb) return -1;
    if (la > lb) return 1;
    return 0;
}

/** Recursively list every folder under dir; keys are '/'-joined relative paths. */
function walkFolders(dir, base, out) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const e of entries) {
        if (!e.isDirectory()) continue;
        const abs = path.join(dir, e.name);
        const rel = base === '' ? e.name : `${base}/${e.name}`;
        let pngs;
        try {
            pngs = fs
                .readdirSync(abs)
                .filter((f) => f.toLowerCase().endsWith('.png'))
                .sort(windowsOrdinal);
        } catch {
            pngs = [];
        }
        if (pngs.length > 0) {
            out[rel] = pngs;
        }
        walkFolders(abs, rel, out);
    }
}

/** The file names directly inside `dir` matching `ext` (case-insensitive, non-recursive), in windowsOrdinal order. */
function listFiles(dir, ext) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return [];
    }
    return entries
        .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(ext))
        .map((e) => e.name)
        .sort(windowsOrdinal);
}

/** The .txt file names directly inside `dir` (non-recursive), sorted. */
function listTxtFiles(dir) {
    return listFiles(dir, '.txt');
}

/** The direct subentry of `dir` whose name matches `name` case-insensitively (the install's folder casing varies), or null. */
function findSubentry(dir, name) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return null;
    }
    const target = name.toLowerCase();
    for (const e of entries) {
        if (e.name.toLowerCase() === target) return e;
    }
    return null;
}

/** The names of every direct subfolder of `dir`, sorted. */
function listSubfolders(dir) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return [];
    }
    return entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort(windowsOrdinal);
}

/** The manifest of the install at `dwuRoot` (see the header); {} entries are simply absent for missing folders. */
function buildAssetManifest(dwuRoot) {
    const manifest = {};
    const envDir = path.join(dwuRoot, 'images', 'environment');
    if (fs.existsSync(envDir)) {
        walkFolders(envDir, '', manifest);
    }

    // races/*.txt
    const races = listTxtFiles(path.join(dwuRoot, 'races'));
    if (races.length > 0) {
        manifest['races'] = races;
    }

    // images/ui/flagshapes/*.png (top level only): Galaxy.4.cs LoadFlagShapes takes Directory.GetFiles("*.png")
    // sorted; a flag shape index is the position in that list (the new-game wizard's flag grid).
    const flagShapes = listFiles(path.join(dwuRoot, 'images', 'ui', 'flagshapes'), '.png');
    if (flagShapes.length > 0) {
        manifest['ui/flagshapes'] = flagShapes;
    }

    // Policy/*.txt (top level only; the pirate/ subfolder is listed separately)
    const policy = listTxtFiles(path.join(dwuRoot, 'Policy'));
    if (policy.length > 0) {
        manifest['Policy'] = policy;
    }

    // Policy/pirate/*.txt
    const policyPirate = listTxtFiles(path.join(dwuRoot, 'Policy', 'pirate'));
    if (policyPirate.length > 0) {
        manifest['Policy/pirate'] = policyPirate;
    }

    // designTemplates/<race>/*.txt for every subfolder (races + DEFAULT)
    const designTemplatesDir = path.join(dwuRoot, 'designTemplates');
    for (const race of listSubfolders(designTemplatesDir)) {
        const files = listTxtFiles(path.join(designTemplatesDir, race));
        if (files.length > 0) {
            manifest[`designTemplates/${race}`] = files;
        }
        // designTemplates/<race>/pirate/*.txt, written even when empty or absent: gameData.ts answers the C#
        // File.Exists checks of DesignSpecification.LoadFromFile from these lists instead of requesting (404) files.
        const pirateEntry = findSubentry(path.join(designTemplatesDir, race), 'pirate');
        manifest[`designTemplates/${race}/pirate`] = pirateEntry?.isDirectory() ? listTxtFiles(path.join(designTemplatesDir, race, pirateEntry.name)) : [];
    }

    // characters/*.txt (always written): Galaxy.4.cs LoadCharacters' File.Exists(characters\<race>.txt).
    const charactersEntry = findSubentry(dwuRoot, 'characters');
    manifest['characters'] = charactersEntry?.isDirectory() ? listTxtFiles(path.join(dwuRoot, charactersEntry.name)) : [];

    // Help/*.mht (top level only; the folder is "Help" on disk but may be cased differently — Galaxy.9.cs
    // AddGameInfoTopics/AddThemeTopics).
    const helpEntry = findSubentry(dwuRoot, 'help');
    if (helpEntry?.isDirectory()) {
        const files = listFiles(path.join(dwuRoot, helpEntry.name), '.mht');
        if (files.length > 0) {
            manifest['Help'] = files;
        }
    }

    // Customization/<set>/help/*.mht for every <set> with a help folder.
    const customizationDir = path.join(dwuRoot, 'Customization');
    for (const set of listSubfolders(customizationDir)) {
        const helpFolder = findSubentry(path.join(customizationDir, set), 'help');
        if (!helpFolder?.isDirectory()) continue;
        const files = listFiles(path.join(customizationDir, set, helpFolder.name), '.mht');
        if (files.length > 0) {
            manifest[`Customization/${set}/help`] = files;
        }
    }
    return manifest;
}

module.exports = { buildAssetManifest, windowsOrdinal };
