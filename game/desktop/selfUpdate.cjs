// Background self-update for the installs that can replace themselves without code signing: the Linux AppImage
// (the file is replaced in place) and the Windows NSIS setup (the downloaded installer runs silently when the app quits).
// Everything else (macOS dmg, Windows zip, Linux tar.gz, an AppImage in a read-only folder) keeps the "new version:
// Download" offer (updateCheck.cjs). No Electron imports here (unit-tested in test/desktopShell.test.ts); desktop/main.cjs
// supplies the fetch function, the paths and the quit hook.
//
// Flow: the release's own `<file>.sha256` (published next to every installer) is fetched first, the installer is streamed
// to <userData>/updates/<version>/<name>.part (pausing while a multiplayer game runs), hashed on the way, and only a file
// whose SHA-256 matches is renamed to its final name and marked with <name>.ok. A staged file from an earlier launch is
// reused. Nothing is installed before the player quits (or chooses "Restart now").
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { assetFileNames, isSafeGithubUrl } = require('./updateCheck.cjs');

/** Which self-update applies: 'appimage' (Linux x64 run from an AppImage), 'nsis' (Windows x64 setup install), else null. */
function selfUpdateKind({ platform, arch, kind }) {
    if (arch !== 'x64') return null;
    if (platform === 'linux' && kind === 'appimage') return 'appimage';
    if (platform === 'win32' && kind === 'nsis') return 'nsis';
    return null;
}

/** The hash in a `sha256sum`-style file ("<hex>  <name>") for `fileName`, lowercase, or null. */
function parseSha256(text, fileName) {
    for (const line of String(text ?? '').split(/\r?\n/)) {
        const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line);
        if (m && (fileName === undefined || path.basename(m[2]) === fileName)) return m[1].toLowerCase();
    }
    return null;
}

/** Release asset URLs come from GitHub; tests may name one extra origin (the fake API's). */
function isAllowedUrl(u, extraOrigin) {
    if (isSafeGithubUrl(u)) return true;
    try {
        return !!extraOrigin && new URL(u).origin === new URL(extraOrigin).origin;
    } catch {
        return false;
    }
}

/**
 * What to download for `release` (updateCheck.releaseInfo): { name, url, shaUrl } of this edition's installer and its
 * .sha256, or null when this install cannot self-update, the installer or its checksum is not on the release, or a URL is
 * not allowed. The tar.gz / zip fallbacks of pickDownload never qualify.
 */
function planSelfUpdate(release, { platform, arch, kind, product, extraOrigin }) {
    const k = selfUpdateKind({ platform, arch, kind });
    if (!release || !k) return null;
    const names = assetFileNames(release.version, product === 'classic' ? 'openDWU-Classic' : 'openDWU');
    const name = k === 'appimage' ? names.linuxAppImage : names.winSetup;
    const asset = release.assets.find((a) => a.name === name);
    const sha = release.assets.find((a) => a.name === `${name}.sha256`);
    if (!asset || !sha || !isAllowedUrl(asset.url, extraOrigin) || !isAllowedUrl(sha.url, extraOrigin)) return null;
    return { kind: k, name, url: asset.url, shaUrl: sha.url, size: asset.size, version: release.version };
}

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Download + verify. `fetchFn(url)` is fetch-shaped. Resolves { file, sha256, reused }; rejects on HTTP errors, a missing
 * or malformed checksum, or a mismatch (the partial file is removed). `isPaused()` is polled between chunks (a
 * multiplayer game is running): the transfer waits instead of competing for bandwidth.
 */
async function downloadVerified({ fetchFn, plan, dir, isPaused = () => false, sleep = sleepMs, onProgress }) {
    fs.mkdirSync(dir, { recursive: true });
    const final = path.join(dir, plan.name);
    const marker = `${final}.ok`;
    if (fs.existsSync(final) && fs.existsSync(marker)) {
        const want = fs.readFileSync(marker, 'utf8').trim();
        if (/^[0-9a-f]{64}$/.test(want) && (await hashFile(final)) === want) return { file: final, sha256: want, reused: true };
        fs.rmSync(final, { force: true });
        fs.rmSync(marker, { force: true });
    }
    const shaRes = await fetchFn(plan.shaUrl);
    if (!shaRes.ok) throw new Error(`checksum file: HTTP ${shaRes.status}`);
    const want = parseSha256(await shaRes.text(), plan.name);
    if (!want) throw new Error('checksum file is not a sha256 listing of the installer');
    const res = await fetchFn(plan.url);
    if (!res.ok || !res.body) throw new Error(`download: HTTP ${res.status}`);
    const part = `${final}.part`;
    const out = fs.openSync(part, 'w');
    const hash = crypto.createHash('sha256');
    let got = 0;
    try {
        const reader = res.body.getReader();
        for (;;) {
            while (isPaused()) await sleep(2000);
            const { done, value } = await reader.read();
            if (done) break;
            hash.update(value);
            fs.writeSync(out, value);
            got += value.length;
            if (onProgress) onProgress(got);
        }
    } catch (err) {
        fs.closeSync(out);
        fs.rmSync(part, { force: true });
        throw err;
    }
    fs.closeSync(out);
    const have = hash.digest('hex');
    if (have !== want) {
        fs.rmSync(part, { force: true });
        throw new Error(`checksum mismatch (got ${have.slice(0, 12)}…, release says ${want.slice(0, 12)}…)`);
    }
    fs.renameSync(part, final);
    fs.writeFileSync(marker, `${want}\n`);
    return { file: final, sha256: want, reused: false };
}

function hashFile(file) {
    return new Promise((resolve, reject) => {
        const h = crypto.createHash('sha256');
        fs.createReadStream(file)
            .on('data', (c) => h.update(c))
            .on('error', reject)
            .on('end', () => resolve(h.digest('hex')));
    });
}

/** Can the AppImage at `target` be replaced (its folder and the file are writable)? */
function canReplaceFile(target) {
    try {
        fs.accessSync(path.dirname(target), fs.constants.W_OK);
        fs.accessSync(target, fs.constants.W_OK);
        return true;
    } catch {
        return false;
    }
}

/** Replace `target` with `staged` atomically (copy next to it, then rename over it; a running AppImage keeps its old inode). */
function replaceFile(staged, target) {
    const tmp = `${target}.update-${process.pid}`;
    try {
        fs.copyFileSync(staged, tmp);
        fs.chmodSync(tmp, 0o755);
        fs.renameSync(tmp, target);
    } catch (err) {
        fs.rmSync(tmp, { force: true });
        throw err;
    }
}

/** Arguments of the NSIS installer: silent, flagged as an update; `forceRun` starts the new version afterwards. */
function nsisArgs(forceRun) {
    return ['/S', '--updated', ...(forceRun ? ['--force-run'] : [])];
}

/** Remove staged downloads of versions that are not newer than the running one (installed, or superseded). */
function cleanupStaged(root, runningVersion, compareVersions) {
    let names;
    try {
        names = fs.readdirSync(root);
    } catch {
        return;
    }
    for (const n of names) if (compareVersions(n, runningVersion) <= 0) fs.rmSync(path.join(root, n), { recursive: true, force: true });
}

module.exports = { selfUpdateKind, parseSha256, isAllowedUrl, planSelfUpdate, downloadVerified, hashFile, canReplaceFile, replaceFile, nsisArgs, cleanupStaged };
