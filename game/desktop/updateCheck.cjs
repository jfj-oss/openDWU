// Update check for the desktop app: the pure parts (no Electron imports, unit-tested in test/desktopShell.test.ts).
// desktop/main.cjs asks the GitHub Releases API for the latest published release at most once a day and, when it is
// newer than the running version, offers to download the installer for this platform in the browser. There is no
// silent self-update: the apps are not code-signed, and Squirrel.Mac refuses to install unsigned updates, so every
// platform gets the same "new version: Download / Later / Skip" prompt.
//
// The release asset names are defined here once and used by scripts/package-desktop.mjs, so the app always finds
// the files the release workflow uploads.
'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;

/** File names of the release assets for `version` (no leading "v"). */
function assetFileNames(version) {
    const base = `openDWU-${version}`;
    return {
        macDmg: `${base}-macos-arm64.dmg`,
        linuxAppImage: `${base}-linux-x64.AppImage`,
        linuxTarGz: `${base}-linux-x64.tar.gz`,
        winSetup: `${base}-windows-x64-setup.exe`,
        winZip: `${base}-windows-x64.zip`,
    };
}

/** "v1.2.3" / "1.2.3-beta.1" -> { nums: [1, 2, 3], pre: [] | ['beta', 1] }, or null when not a version. */
function parseVersion(v) {
    if (typeof v !== 'string') return null;
    const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v.trim());
    if (!m) return null;
    const pre = m[4] === undefined ? [] : m[4].split('.').map((x) => (/^\d+$/.test(x) ? Number(x) : x));
    return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre };
}

/** Semver precedence: <0 when a < b, 0 when equal, >0 when a > b. Unparseable versions compare as equal (never "newer"). */
function compareVersions(a, b) {
    const pa = parseVersion(a);
    const pb = parseVersion(b);
    if (!pa || !pb) return 0;
    for (let i = 0; i < 3; i++) if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] - pb.nums[i];
    // A release ranks above its prereleases.
    if (pa.pre.length === 0 || pb.pre.length === 0) return pb.pre.length - pa.pre.length;
    for (let i = 0; i < Math.min(pa.pre.length, pb.pre.length); i++) {
        const x = pa.pre[i];
        const y = pb.pre[i];
        if (x === y) continue;
        if (typeof x === 'number' && typeof y === 'number') return x - y;
        if (typeof x === 'number') return -1; // numeric identifiers rank below alphanumeric ones
        if (typeof y === 'number') return 1;
        return x < y ? -1 : 1;
    }
    return pa.pre.length - pb.pre.length;
}

/** Is an automatic check due? `lastCheckMs` is when the last one completed (undefined/NaN = never). */
function isCheckDue(lastCheckMs, nowMs, intervalMs = DAY_MS) {
    if (typeof lastCheckMs !== 'number' || !Number.isFinite(lastCheckMs)) return true;
    // A clock set backwards (last check "in the future") must not suppress checks forever.
    if (lastCheckMs > nowMs) return true;
    return nowMs - lastCheckMs >= intervalMs;
}

/** Only ever open GitHub pages / downloads from what the API returned. */
function isSafeGithubUrl(u) {
    try {
        const url = new URL(u);
        return url.protocol === 'https:' && (url.hostname === 'github.com' || url.hostname.endsWith('.github.com'));
    } catch {
        return false;
    }
}

/** The fields we use from a GitHub "release" object, or null when it is not one (or a draft). */
function releaseInfo(json) {
    if (!json || typeof json !== 'object' || typeof json.tag_name !== 'string' || json.draft === true) return null;
    const version = json.tag_name.replace(/^v/, '');
    if (!parseVersion(version)) return null;
    const assets = Array.isArray(json.assets)
        ? json.assets
              .filter((a) => a && typeof a.name === 'string' && typeof a.browser_download_url === 'string')
              .map((a) => ({ name: a.name, url: a.browser_download_url, size: typeof a.size === 'number' ? a.size : 0 }))
        : [];
    return {
        version,
        tag: json.tag_name,
        name: typeof json.name === 'string' && json.name.trim() !== '' ? json.name : json.tag_name,
        pageUrl: typeof json.html_url === 'string' ? json.html_url : null,
        notes: typeof json.body === 'string' ? json.body : '',
        prerelease: json.prerelease === true,
        assets,
    };
}

/**
 * The download for this machine from a releaseInfo(): { name, url } of the matching asset, else null (the caller then
 * opens the release page). `kind`: 'appimage' when running from an AppImage ($APPIMAGE), 'nsis' when installed by the
 * Windows installer, otherwise the archive / disk image of the platform.
 */
function pickDownload(release, { platform, arch, kind }) {
    if (!release) return null;
    const names = assetFileNames(release.version);
    let wanted = null;
    if (platform === 'darwin' && arch === 'arm64') wanted = [names.macDmg];
    else if (platform === 'linux' && arch === 'x64') wanted = kind === 'appimage' ? [names.linuxAppImage, names.linuxTarGz] : [names.linuxTarGz, names.linuxAppImage];
    else if (platform === 'win32' && arch === 'x64') wanted = kind === 'nsis' ? [names.winSetup, names.winZip] : [names.winZip, names.winSetup];
    if (wanted === null) return null;
    for (const name of wanted) {
        const a = release.assets.find((x) => x.name === name);
        if (a && isSafeGithubUrl(a.url)) return { name: a.name, url: a.url };
    }
    return null;
}

/** "owner/repo" from a package.json `repository` (string or { url }), or null. */
function repoSlug(repository) {
    const raw = typeof repository === 'string' ? repository : repository && typeof repository.url === 'string' ? repository.url : null;
    if (!raw) return null;
    const m = /^(?:github:)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(raw) ?? /github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(raw);
    return m ? `${m[1]}/${m[2]}` : null;
}

/** The API URL of the latest (non-draft, non-prerelease) release. */
function latestReleaseApiUrl(slug) {
    return `https://api.github.com/repos/${slug}/releases/latest`;
}

/** Release notes trimmed for a message box. */
function notesExcerpt(notes, max = 700) {
    const t = String(notes ?? '')
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

module.exports = {
    DAY_MS,
    assetFileNames,
    parseVersion,
    compareVersions,
    isCheckDue,
    isSafeGithubUrl,
    releaseInfo,
    pickDownload,
    repoSlug,
    latestReleaseApiUrl,
    notesExcerpt,
};
