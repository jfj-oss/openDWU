// Desktop packaging: build the game, then wrap it as the native app with @electron/packager (a small stage dir —
// desktop/ + a minimal package.json — with dist/ attached as an extra resource, resources/dwu-dist/, where the
// packaged main.cjs loads it from), and optionally the installers (scripts/desktop-installers.mjs).
//
// Usage: node scripts/package-desktop.mjs --platform=linux|darwin|win32 --arch=x64|arm64 [--installers]
//   npm run package:linux / package:mac / package:win   -> release/dwu-<platform>-<arch>/
//   npm run dist:linux / dist:mac / dist:win            -> also release/upload/<installers + .sha256>
//
// The build never needs the DW:U install (release builds run on GitHub's runners, which have none), and nothing from
// it may ship: dist/ is checked against an allow-list (game code, the repo's scenarios/, our own public/art/), every
// packaged file name is checked for install-derived listings, and when an install is reachable on this machine
// (public/assets/dwu or $DWU_DIR) every packaged file is also compared byte for byte against it.
//
// The version is game/package.json's; the update check's repository is $GITHUB_REPOSITORY (set on GitHub's runners)
// else package.json's "repository".

import { execFileSync, execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { packager } from '@electron/packager';
import { makeIcons } from './make-icon.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { repoSlug } = require('../desktop/updateCheck.cjs');

function parseArgs(argv) {
    const args = {};
    for (const a of argv.slice(2)) {
        const m = /^--([a-z-]+)(?:=(.+))?$/.exec(a);
        if (!m) throw new Error(`Unknown argument: ${a}`);
        args[m[1]] = m[2] ?? true;
    }
    if (!['linux', 'darwin', 'win32'].includes(args.platform)) throw new Error('Missing or invalid --platform=linux|darwin|win32');
    if (args.arch !== 'x64' && args.arch !== 'arm64') throw new Error('Missing or invalid --arch=x64|arm64');
    return args;
}

const args = parseArgs(process.argv);
const { platform, arch } = args;
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const repo = process.env.GITHUB_REPOSITORY || repoSlug(pkg.repository) || 'jfj-oss/openDWU';
const releaseDir = path.join(root, 'release');

// Package with the Electron that `npm install` put in node_modules (the one `desktop:dev` runs), instead of a
// hard-coded version that drifts on upgrades.
const electronVersion = require('electron/package.json').version;

// ---------------------------------------------------------------------------
// Original-file guards
// ---------------------------------------------------------------------------

function walkFiles(dir, base = dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) walkFiles(abs, base, out);
        else out.push({ abs, rel: path.relative(base, abs).split(path.sep).join('/'), link: e.isSymbolicLink() });
    }
    return out;
}

const sameBytes = (a, b) => fs.statSync(a).size === fs.statSync(b).size && fs.readFileSync(a).equals(fs.readFileSync(b));

/** dist/ may hold only the game code, the repo's scenarios/ and our own public/art/ (byte-identical to the repo's). */
function guardDist(distDir) {
    const problems = [];
    for (const f of walkFiles(distDir)) {
        if (f.rel === 'index.html' || f.rel === 'sim.html') continue; // the game; the desktop sim process's page
        if (/^assets\/[^/]+\.(js|css|map|wasm|svg|woff2?)$/i.test(f.rel)) continue;
        if (f.rel === 'assets/scenarios/index.json') continue;
        if (f.rel.startsWith('assets/scenarios/')) {
            const src = path.join(root, 'scenarios', f.rel.slice('assets/scenarios/'.length));
            if (fs.existsSync(src) && sameBytes(src, f.abs)) continue;
        }
        if (f.rel.startsWith('art/')) {
            const src = path.join(root, 'public', f.rel);
            if (fs.existsSync(src) && sameBytes(src, f.abs)) continue;
        }
        problems.push(f.rel);
    }
    if (problems.length > 0) {
        throw new Error(`dist/ holds files outside the allow-list (install-derived or unexpected; see scripts/package-desktop.mjs guardDist):\n  ${problems.join('\n  ')}`);
    }
}

/**
 * Every desktop file the shell loads is staged: each `require('./x.cjs')` and each `path.join(__dirname, 'x')` (the
 * preloads, setup.html) in a staged .cjs must name a staged file — a new desktop file outside the copied kinds fails
 * here instead of in the packaged app.
 */
function guardStage(stageDesktop) {
    const missing = [];
    for (const f of fs.readdirSync(stageDesktop).filter((n) => n.endsWith('.cjs'))) {
        const src = fs.readFileSync(path.join(stageDesktop, f), 'utf8');
        for (const m of src.matchAll(/require\('\.\/([^']+)'\)|path\.join\(__dirname, '([^'.][^']*)'\)/g)) {
            const ref = m[1] ?? m[2];
            if (!fs.existsSync(path.join(stageDesktop, ref))) missing.push(`${f} -> ${ref}`);
        }
    }
    if (missing.length > 0) throw new Error(`desktop files the shell loads are not staged (scripts/package-desktop.mjs step 3):\n  ${missing.join('\n  ')}`);
}

/** No install-derived listing may ship under any name; no file may be a symlink pointing outside the app. */
function guardPackagedNames(outDir) {
    const bad = walkFiles(outDir).filter((f) => /(^|\/)(asset-manifest\.json|theme-manifest(\/|$))/i.test(f.rel) || /(^|\/)assets\/dwu(\/|$)/i.test(f.rel));
    if (bad.length > 0) throw new Error(`packaged app holds install-derived files:\n  ${bad.map((f) => f.rel).join('\n  ')}`);
}

/** The DW:U install reachable on this machine (for the byte-for-byte scan), or null (e.g. on GitHub's runners). */
function localInstall() {
    const link = path.join(root, 'public', 'assets', 'dwu');
    for (const c of [process.env.DWU_DIR, fs.existsSync(link) ? fs.realpathSync(link) : null]) {
        if (c && fs.existsSync(path.join(c, 'images'))) return c;
    }
    return null;
}

/** Fail if any packaged file is byte-identical to a file of the install (files under 64 bytes are ignored). */
function scanAgainstInstall(outDir, install) {
    const bySize = new Map();
    for (const f of walkFiles(install)) {
        if (f.link) continue;
        const size = fs.statSync(f.abs).size;
        if (size < 64) continue;
        if (!bySize.has(size)) bySize.set(size, []);
        bySize.get(size).push(f.abs);
    }
    const hash = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    const hits = [];
    let n = 0;
    for (const f of walkFiles(outDir)) {
        if (f.link) continue;
        n++;
        const cands = bySize.get(fs.statSync(f.abs).size);
        if (!cands) continue;
        const h = hash(f.abs);
        for (const c of cands) if (hash(c) === h) hits.push(`${f.rel} == ${path.relative(install, c)}`);
    }
    if (hits.length > 0) throw new Error(`packaged app holds original game files:\n  ${hits.join('\n  ')}`);
    console.log(`Original-file scan: ${n} packaged files, none identical to a file of ${install}`);
}

// ---------------------------------------------------------------------------
// 1. Build the game (dist/) and check it.
// ---------------------------------------------------------------------------

console.log(`Building game ${version} (npm run build)...`);
execSync('npm run build', { cwd: root, stdio: 'inherit' });
const distDir = path.join(root, 'dist');
guardDist(distDir);
// The pages the shell loads from dist/: the game, and the sim process's page (desktop/simProcess.cjs).
for (const page of ['index.html', 'sim.html']) {
    if (!fs.existsSync(path.join(distDir, page))) throw new Error(`dist/${page} is missing (vite.config.ts build inputs)`);
}

// 2. Our own icon (scripts/make-icon.mjs): .icns / .ico for the bundle, icon.png as resources/icon.png.
const icons = makeIcons(path.join(releaseDir, 'icons'));

// 3. Recreate release/stage/: desktop/*.cjs + setup.html + a minimal package.json.
const stageDir = path.join(releaseDir, 'stage');
fs.rmSync(stageDir, { recursive: true, force: true });
fs.mkdirSync(path.join(stageDir, 'desktop'), { recursive: true });
for (const f of fs.readdirSync(path.join(root, 'desktop'))) {
    if (/\.(cjs|html)$/.test(f)) fs.copyFileSync(path.join(root, 'desktop', f), path.join(stageDir, 'desktop', f));
}
guardStage(path.join(stageDir, 'desktop'));
fs.writeFileSync(
    path.join(stageDir, 'package.json'),
    JSON.stringify(
        {
            name: 'dwu',
            // productName names the profile folder (config.json, saves): keep it stable across releases.
            productName: 'Distant Worlds Universe',
            version,
            description: 'openDWU: a recreation of Distant Worlds: Universe (reads the game files from your own install)',
            author: 'openDWU contributors',
            homepage: `https://github.com/${repo}`,
            repository: { type: 'git', url: `https://github.com/${repo}.git` },
            main: 'desktop/main.cjs',
            // Linux: Electron's Wayland app_id / X11 WM_CLASS, matching the AppImage's dwu.desktop (window <-> launcher icon).
            desktopName: 'dwu.desktop',
        },
        null,
        2,
    ) + '\n',
);

// 4. Recreate release/dwu-dist/ as a copy of dist/.
const distResDir = path.join(releaseDir, 'dwu-dist');
fs.rmSync(distResDir, { recursive: true, force: true });
fs.cpSync(distDir, distResDir, { recursive: true });

// 5. Package.
const outDirs = await packager({
    // Absolute paths: packager resolves relative ones against process.cwd(), which is only the game dir when run
    // through npm.
    dir: stageDir,
    name: 'dwu',
    platform,
    arch,
    out: releaseDir,
    overwrite: true,
    appVersion: version,
    buildVersion: version,
    electronVersion,
    extraResource: [distResDir, icons.png],
    icon: platform === 'darwin' ? icons.icns : platform === 'win32' ? icons.ico : undefined,
    // macOS bundle metadata (ignored elsewhere); defaults are com.electron.dwu and the developer-tools category.
    appBundleId: 'local.dwureup.dwu',
    appCategoryType: 'public.app-category.strategy-games',
    appCopyright: 'openDWU contributors. Distant Worlds is a trademark of its owners; no original game files are included.',
    // Windows exe metadata (resedit; no Wine needed when cross-packaging).
    win32metadata: { CompanyName: 'openDWU', FileDescription: 'openDWU', ProductName: 'openDWU', InternalName: 'dwu', OriginalFilename: 'dwu.exe' },
    asar: true,
});
const outDir = outDirs[0];

// 6. macOS: ad-hoc signature (no Apple Developer ID: arm64 macOS refuses unsigned code, and packager's edits invalidate
//    Electron's own signature). Only possible on a Mac; a Linux-built package must be re-signed there (desktop/README.md).
if (platform === 'darwin') {
    const appPath = path.join(outDir, 'dwu.app');
    if (process.platform === 'darwin') {
        execFileSync('xattr', ['-cr', appPath], { stdio: 'inherit' });
        execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
        execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], { stdio: 'inherit' });
        console.log(`Ad-hoc signed ${appPath}`);
    } else {
        console.warn(`NOTE: ${appPath} is unsigned (packaged on ${process.platform}); re-sign it ad hoc on the Mac (desktop/README.md).`);
    }
}

// 7. Original-file guards on the whole package.
guardPackagedNames(outDir);
const install = localInstall();
if (install) scanAgainstInstall(outDir, install);
else console.log('Original-file scan skipped: no DW:U install on this machine (nothing to compare against).');

// 8. Report output folder + total size.
let totalBytes = 0;
for (const f of walkFiles(outDir)) totalBytes += fs.lstatSync(f.abs).size; // lstat: macOS framework symlinks would double-count
console.log(`Packaged: ${outDir} (${(totalBytes / 1024 / 1024).toFixed(1)} MB)`);

// 9. Installers.
if (args.installers) {
    const { makeInstallers } = await import('./desktop-installers.mjs');
    // Every installer wraps only outDir (checked above) plus our generated icon.
    const files = await makeInstallers({ root, platform, arch, version, outDir, stageDir, icons, electronVersion });
    console.log(`Installers (release/upload/):\n  ${files.map((f) => path.basename(f)).join('\n  ')}`);
}
