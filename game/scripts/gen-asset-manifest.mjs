// Usage: node scripts/gen-asset-manifest.mjs
// Writes public/asset-manifest.json (folder listings of the DW:U install the browser cannot make: images/environment,
// races, flag shapes, Policy, designTemplates, characters, Help, theme help) for `npm run dev` and the test harness.
// The listing itself is desktop/assetManifest.cjs, shared with the desktop shell, which builds the same manifest from
// the player's install folder at launch (dist/ carries no copy).
//
// The source of the file lists is the DW:U install, linked into the repo as public/assets/dwu by
// `npm run import-assets` (or $DWU_DIR when the link is absent). If the install is absent the manifest is still
// written (empty) so the renderer falls back to generated textures and the dev server stays console-clean.
import { writeFileSync, lstatSync, realpathSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const themeIndexLib = require('../desktop/themeIndex.cjs');
const { buildAssetManifest } = require('../desktop/assetManifest.cjs');

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const dwuLink = join(root, 'public', 'assets', 'dwu');
// ASSET_MANIFEST_OUT overrides the output file (tests write a private copy instead of racing on public/).
const outPath = process.env.ASSET_MANIFEST_OUT || join(root, 'public', 'asset-manifest.json');

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
    // desktop shell).
    const fromEnv = process.env.DWU_DIR;
    if (fromEnv && existsSync(join(fromEnv, 'images', 'environment'))) {
        dwuRoot = fromEnv;
        envDir = join(fromEnv, 'images', 'environment');
    }
}

const manifest = dwuRoot ? buildAssetManifest(dwuRoot) : {};

// Themes (customization sets): public/theme-manifest/index.json + <set>.json, every theme folder indexed by
// desktop/themeIndex.cjs (the dev server and the desktop shell build the same answers live from the install; these
// files are a convenience copy for tools reading public/). The browser's File.Exists / Directory.Exists for Customization\<set>\ (src/sim/data/customization.ts).
if (dwuRoot && !process.env.ASSET_MANIFEST_OUT) {
    const themeDir = join(root, 'public', 'theme-manifest');
    mkdirSync(themeDir, { recursive: true });
    const themes = themeIndexLib.listThemes(dwuRoot);
    writeFileSync(join(themeDir, 'index.json'), JSON.stringify(themes) + '\n');
    for (const t of themes) {
        const idx = themeIndexLib.buildThemeIndex(dwuRoot, t);
        if (idx !== null) writeFileSync(join(themeDir, `${t}.json`), JSON.stringify(idx) + '\n');
    }
    console.log(`theme-manifest: ${themes.length} themes -> ${themeDir}`);
}

mkdirSync(dirname(outPath), { recursive: true }); // public/ is fully gitignored, so a fresh clone lacks it
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n');
const total = Object.values(manifest).reduce((n, list) => n + list.length, 0);
if (envDir) {
    console.log(`asset-manifest: ${total} files across ${Object.keys(manifest).length} folders -> ${outPath}`);
} else {
    console.log('asset-manifest: DW:U install not linked; wrote empty manifest (renderer uses generated fallbacks)');
}