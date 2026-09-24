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
    dir: 'release/stage',
    name: 'dwu',
    platform,
    arch,
    out: 'release',
    overwrite: true,
    appVersion: '0.1.0',
    electronVersion: '44.4.5',
    extraResource: ['release/dwu-dist'],
    asar: true,
});

// 5. Report output folder + total size.
const outDir = outDirs[0];
let totalBytes = 0;
(function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else totalBytes += fs.statSync(p).size;
    }
})(outDir);
console.log(`Packaged: ${outDir} (${(totalBytes / 1024 / 1024).toFixed(1)} MB)`);