// Usage: node scripts/gen-asset-manifest.mjs
// Writes public/asset-manifest.json: for EVERY folder under the DW:U install's
// images/environment/, a sorted list of its .png file names (keys are paths
// relative to images/environment/, e.g. "planets/ocean"). The browser can't
// enumerate directories, so these lists are generated here at dev/build time
// (predev/prebuild) and fetched by the renderer at runtime; assets.ts picks
// real files out of them via pictureRef modulo the folder's file count.
//
// Sort order matches the original engine: Main.Part13.cs LoadMapStars /
// LoadStars / LoadNebulae call Directory.GetFiles(..., "*.png") and index the
// result by order. On Windows that is the NTFS ordinal (case-insensitive)
// name order, so we sort the same way: case-insensitive ordinal comparison.
//
// The source of the file lists is the DW:U install, linked into the repo as
// public/assets/dwu by `npm run import-assets`. If the install is absent the
// manifest is still written (all lists empty) so the renderer falls back to
// generated textures and the dev server stays console-clean.
import { readdirSync, writeFileSync, lstatSync, realpathSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const dwuLink = join(root, 'public', 'assets', 'dwu');
const outPath = join(root, 'public', 'asset-manifest.json');

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

let envDir = null;
try {
    const st = lstatSync(dwuLink);
    if (st.isSymbolicLink()) {
        const resolved = realpathSync(dwuLink);
        if (existsSync(join(resolved, 'images', 'environment'))) {
            envDir = join(resolved, 'images', 'environment');
        }
    }
} catch {
    // symlink absent (no `npm run import-assets` run) -> empty manifest
}

const manifest = {};
if (envDir) {
    walkFolders(envDir, '', manifest);
}

writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n');
const total = Object.values(manifest).reduce((n, list) => n + list.length, 0);
if (envDir) {
    console.log(`asset-manifest: ${total} files across ${Object.keys(manifest).length} folders -> ${outPath}`);
} else {
    console.log('asset-manifest: DW:U install not linked; wrote empty manifest (renderer uses generated fallbacks)');
}