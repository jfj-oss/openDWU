// Usage: node scripts/gen-asset-manifest.mjs
// Writes public/asset-manifest.json: a flat map of folder path -> sorted list
// of file names, for:
//   - EVERY folder under the DW:U install's images/environment/ (*.png),
//     keys relative to images/environment/, e.g. "planets/ocean".
//   - races/ (*.txt), key "races".
//   - images/ui/flagshapes/ (*.png, top level), key "ui/flagshapes".
//   - Policy/ (*.txt, top level only), key "Policy".
//   - Policy/pirate/ (*.txt), key "Policy/pirate".
//   - designTemplates/<race>/ (*.txt, top level only) for every subfolder of
//     designTemplates/ (including DEFAULT), key "designTemplates/<race>", and
//     its pirate/ subfolder, key "designTemplates/<race>/pirate" (always
//     written, [] when absent).
//   - characters/ (*.txt), key "characters" (always written).
//   - Help/ (*.mht, top level only; folder looked up case-insensitively),
//     key "Help".
//   - Customization/<set>/help/ (*.mht) for every subfolder <set> of
//     Customization/ that has a help folder (any case), key
//     "Customization/<set>/help".
// The browser can't enumerate directories, so these lists are generated here
// at dev/build time (predev/prebuild) and fetched by the renderer/data
// loaders at runtime; assets.ts picks real files out of the image lists via
// pictureRef modulo the folder's file count, gameData.ts uses the
// races/Policy/designTemplates lists to discover data files, and the
// Galactopedia uses the Help lists for Galaxy.9.cs AddThemeTopics /
// AddGameInfoTopics.
//
// Sort order matches the original engine: Main.Part13.cs LoadMapStars /
// LoadStars / LoadNebulae call Directory.GetFiles(..., "*.png") and index the
// result by order. On Windows that is the NTFS ordinal (case-insensitive)
// name order, so we sort the same way: case-insensitive ordinal comparison.
// The same order is used for the data-file lists below (races/Policy/
// designTemplates), matching Directory.GetFiles(..., "*.txt") elsewhere in
// the engine (e.g. Galaxy.4.cs LoadRaces).
//
// The source of the file lists is the DW:U install, linked into the repo as
// public/assets/dwu by `npm run import-assets`. If the install is absent the
// manifest is still written (all lists empty) so the renderer falls back to
// generated textures and the dev server stays console-clean.
import { readdirSync, writeFileSync, lstatSync, realpathSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const dwuLink = join(root, 'public', 'assets', 'dwu');
// ASSET_MANIFEST_OUT overrides the output file (tests write a private copy instead of racing on public/).
const outPath = process.env.ASSET_MANIFEST_OUT || join(root, 'public', 'asset-manifest.json');

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
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const e of entries) {
        if (!e.isDirectory()) continue;
        const abs = join(dir, e.name);
        const rel = join(base, e.name).split('\\').join('/');
        const pngs = readdirSync(abs)
            .filter((f) => f.toLowerCase().endsWith('.png'))
            .sort(windowsOrdinal);
        if (pngs.length > 0) {
            out[rel] = pngs;
        }
        walkFolders(abs, rel, out);
    }
}

/** List the .txt file names directly inside `dir` (non-recursive), sorted. */
function listTxtFiles(dir) {
    return listFiles(dir, '.txt');
}

/** List the file names directly inside `dir` matching `ext` (case-insensitive,
 *  non-recursive), sorted in windowsOrdinal order. */
function listFiles(dir, ext) {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return [];
    }
    return entries
        .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(ext))
        .map((e) => e.name)
        .sort(windowsOrdinal);
}

/** The direct subentry of `dir` whose name matches `name` case-insensitively
 *  (the install's folder casing varies), or null. */
function findSubentry(dir, name) {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return null;
    }
    const target = name.toLowerCase();
    for (const e of entries) {
        if (e.name.toLowerCase() === target) return e;
    }
    return null;
}

/** List the names of every direct subfolder of `dir`, sorted. */
function listSubfolders(dir) {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return [];
    }
    return entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort(windowsOrdinal);
}

let envDir = null;
let dwuRoot = null;
try {
    const st = lstatSync(dwuLink);
    if (st.isSymbolicLink()) {
        const resolved = realpathSync(dwuLink);
        dwuRoot = resolved;
        if (existsSync(join(resolved, 'images', 'environment'))) {
            envDir = join(resolved, 'images', 'environment');
        }
    }
} catch {
    // symlink absent (no `npm run import-assets` run): fall back to $DWU_DIR (same variable as import-assets and the
    // desktop shell), so a fresh clone can `DWU_DIR=... npm run package:mac` without linking first.
    const fromEnv = process.env.DWU_DIR;
    if (fromEnv && existsSync(join(fromEnv, 'images', 'environment'))) {
        dwuRoot = fromEnv;
        envDir = join(fromEnv, 'images', 'environment');
    }
}

const manifest = {};
if (envDir) {
    walkFolders(envDir, '', manifest);
}

if (dwuRoot) {
    // races/*.txt
    const races = listTxtFiles(join(dwuRoot, 'races'));
    if (races.length > 0) {
        manifest['races'] = races;
    }

    // images/ui/flagshapes/*.png (top level only): Galaxy.4.cs LoadFlagShapes
    // takes Directory.GetFiles("*.png") sorted; a flag shape index is the
    // position in that list (the new-game wizard's flag grid).
    const flagShapes = listFiles(join(dwuRoot, 'images', 'ui', 'flagshapes'), '.png');
    if (flagShapes.length > 0) {
        manifest['ui/flagshapes'] = flagShapes;
    }

    // Policy/*.txt (top level only; the pirate/ subfolder is listed separately)
    const policy = listTxtFiles(join(dwuRoot, 'Policy'));
    if (policy.length > 0) {
        manifest['Policy'] = policy;
    }

    // Policy/pirate/*.txt
    const policyPirate = listTxtFiles(join(dwuRoot, 'Policy', 'pirate'));
    if (policyPirate.length > 0) {
        manifest['Policy/pirate'] = policyPirate;
    }

    // designTemplates/<race>/*.txt for every subfolder (races + DEFAULT)
    const designTemplatesDir = join(dwuRoot, 'designTemplates');
    for (const race of listSubfolders(designTemplatesDir)) {
        const files = listTxtFiles(join(designTemplatesDir, race));
        if (files.length > 0) {
            manifest[`designTemplates/${race}`] = files;
        }
        // designTemplates/<race>/pirate/*.txt, written even when empty or absent: gameData.ts answers the C#
        // File.Exists checks of DesignSpecification.LoadFromFile from these lists instead of requesting (404) files.
        const pirateEntry = findSubentry(join(designTemplatesDir, race), 'pirate');
        manifest[`designTemplates/${race}/pirate`] = pirateEntry?.isDirectory() ? listTxtFiles(join(designTemplatesDir, race, pirateEntry.name)) : [];
    }

    // characters/*.txt (always written): Galaxy.4.cs LoadCharacters' File.Exists(characters\<race>.txt).
    const charactersEntry = findSubentry(dwuRoot, 'characters');
    manifest['characters'] = charactersEntry?.isDirectory() ? listTxtFiles(join(dwuRoot, charactersEntry.name)) : [];

    // Help/*.mht (top level only; the folder is "Help" on disk but may be
    // cased differently — Galaxy.9.cs AddGameInfoTopics/AddThemeTopics).
    const helpEntry = findSubentry(dwuRoot, 'help');
    if (helpEntry?.isDirectory()) {
        const files = listFiles(join(dwuRoot, helpEntry.name), '.mht');
        if (files.length > 0) {
            manifest['Help'] = files;
        }
    }

    // Customization/<set>/help/*.mht for every <set> with a help folder.
    const customizationDir = join(dwuRoot, 'Customization');
    for (const set of listSubfolders(customizationDir)) {
        const helpFolder = findSubentry(join(customizationDir, set), 'help');
        if (!helpFolder?.isDirectory()) continue;
        const files = listFiles(join(customizationDir, set, helpFolder.name), '.mht');
        if (files.length > 0) {
            manifest[`Customization/${set}/help`] = files;
        }
    }
}

mkdirSync(dirname(outPath), { recursive: true }); // public/ is fully gitignored, so a fresh clone lacks it
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n');
const total = Object.values(manifest).reduce((n, list) => n + list.length, 0);
if (envDir) {
    console.log(`asset-manifest: ${total} files across ${Object.keys(manifest).length} folders -> ${outPath}`);
} else {
    console.log('asset-manifest: DW:U install not linked; wrote empty manifest (renderer uses generated fallbacks)');
}