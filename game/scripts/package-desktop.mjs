// Desktop packaging: build a small app bundle (desktop/ + a minimal
// package.json) and run @electron/packager on it, with dist/ attached as an
// extra resource (resources/dwu-dist/) so the packaged main.cjs can find the
// built game. Replaces the old `electron-packager . dwu --no-prune` scripts,
// which copied the whole repo incl. node_modules (~3.5 GB).
//
// Usage: node scripts/package-desktop.mjs --platform=linux|darwin --arch=x64|arm64

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { packager } from '@electron/packager';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
    const args = {};
    for (const a of argv.slice(2)) {
        const m = /^--([a-z]+)=(.+)$/.exec(a);
        if (!m) throw new Error(`Unknown argument: ${a}`);
        args[m[1]] = m[2];
    }
    if (args.platform !== 'linux' && args.platform !== 'darwin') {
        throw new Error('Missing or invalid --platform=linux|darwin');
    }
    if (args.arch !== 'x64' && args.arch !== 'arm64') {
        throw new Error('Missing or invalid --arch=x64|arm64');
    }
    return args;
}

const { platform, arch } = parseArgs(process.argv);

// Package with the Electron that `npm install` put in node_modules (the one
// `desktop:dev` runs), instead of a hard-coded version that drifts on upgrades.
const electronVersion = createRequire(import.meta.url)('electron/package.json').version;

// 1. Build the game (dist/).
console.log('Building game (npm run build)...');
execSync('npm run build', { cwd: root, stdio: 'inherit' });

// 2. Recreate release/stage/: desktop/ + a minimal package.json.
const stageDir = path.join(root, 'release', 'stage');
fs.rmSync(stageDir, { recursive: true, force: true });
fs.mkdirSync(stageDir, { recursive: true });
fs.cpSync(path.join(root, 'desktop'), path.join(stageDir, 'desktop'), { recursive: true });
fs.writeFileSync(
    path.join(stageDir, 'package.json'),
    JSON.stringify(
        { name: 'dwu', productName: 'Distant Worlds Universe', version: '0.1.0', main: 'desktop/main.cjs' },
        null,
        2,
    ) + '\n',
);

// 3. Recreate release/dwu-dist/ as a copy of dist/.
const distResDir = path.join(root, 'release', 'dwu-dist');
fs.rmSync(distResDir, { recursive: true, force: true });
fs.cpSync(path.join(root, 'dist'), distResDir, { recursive: true });

// 4. Package.
const outDirs = await packager({
    // Absolute paths: packager resolves relative ones against process.cwd(),
    // which is only the game dir when run through npm.
    dir: stageDir,
    name: 'dwu',
    platform,
    arch,
    out: path.join(root, 'release'),
    overwrite: true,
    appVersion: '0.1.0',
    electronVersion,
    extraResource: [distResDir],
    // macOS bundle metadata (ignored on Linux); defaults are com.electron.dwu
    // and the developer-tools category.
    appBundleId: 'local.dwureup.dwu',
    appCategoryType: 'public.app-category.strategy-games',
    asar: true,
});

// 5. Report output folder + total size.
const outDir = outDirs[0];
let totalBytes = 0;
(function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else totalBytes += fs.lstatSync(p).size; // lstat: macOS framework symlinks would double-count
    }
})(outDir);
console.log(`Packaged: ${outDir} (${(totalBytes / 1024 / 1024).toFixed(1)} MB)`);