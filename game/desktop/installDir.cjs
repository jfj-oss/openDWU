// Finding and validating the player's Distant Worlds: Universe install folder (desktop/main.cjs). No Electron imports:
// the filesystem, environment and registry are injected so test/desktopShell.test.ts can exercise every platform's
// candidates (including Windows paths through path.win32) on any OS.
//
// Candidates, in order (the first valid one wins and is saved to <userData>/config.json by main.cjs):
//   Windows: every Steam library (Steam root from the registry — HKCU\Software\Valve\Steam SteamPath, then
//            HKLM\SOFTWARE\WOW6432Node\Valve\Steam InstallPath — and the default C:\Program Files (x86)\Steam, plus each
//            library listed in <root>\steamapps\libraryfolders.vdf, i.e. other drives), then the non-Steam folders
//            (Matrix Games / GOG / C:\Games).
//   macOS:   Steam's libraries (~/Library/Application Support/Steam), every Whisky / CrossOver bottle's
//            drive_c\Program Files (x86)\Steam library, ~/Games/Distant Worlds Universe.
//   Linux:   every Steam root (~/.local/share/Steam or $XDG_DATA_HOME/Steam, ~/.steam/steam, ~/Steam, Flatpak, Snap) and
//            its libraryfolders.vdf libraries, the default Wine prefix, ~/Games/Distant Worlds Universe.
'use strict';
const fs = require('node:fs');
const nodePath = require('node:path');

const INSTALL_FOLDER = 'Distant Worlds Universe';

/** The default filesystem access (tests pass fakes with the same shape). */
const realFs = {
    readdir: (dir) => fs.readdirSync(dir),
    isDir: (p) => {
        try {
            return fs.statSync(p).isDirectory();
        } catch {
            return false;
        }
    },
    isFile: (p) => {
        try {
            return fs.statSync(p).isFile();
        } catch {
            return false;
        }
    },
    readText: (p) => {
        try {
            return fs.readFileSync(p, 'utf8');
        } catch {
            return null;
        }
    },
};

/** The entry of `dir` named `name` ignoring case (the original is a Windows game), or null. */
function findEntry(fsImpl, dir, name) {
    let entries;
    try {
        entries = fsImpl.readdir(dir);
    } catch {
        return null;
    }
    const lower = name.toLowerCase();
    return entries.find((e) => e.toLowerCase() === lower) ?? null;
}

/**
 * Is `dir` a DW:U install? It must hold the images/ folder (original art) and races.txt (the core data file), matched
 * case-insensitively. Returns { ok: true } or { ok: false, problem } with a sentence for the setup window.
 */
function checkInstallDirExact(dir, fsImpl = realFs, p = nodePath) {
    if (typeof dir !== 'string' || dir.trim() === '') return { ok: false, problem: 'No folder was chosen.' };
    if (!fsImpl.isDir(dir)) return { ok: false, problem: 'This folder does not exist or cannot be read.' };
    const images = findEntry(fsImpl, dir, 'images');
    const races = findEntry(fsImpl, dir, 'races.txt');
    const hasImages = images !== null && fsImpl.isDir(p.join(dir, images));
    const hasRaces = races !== null && fsImpl.isFile(p.join(dir, races));
    if (hasImages && hasRaces) return { ok: true };
    if (!hasImages && !hasRaces) return { ok: false, problem: 'This folder has neither an "images" folder nor "races.txt", so it is not a Distant Worlds: Universe folder.' };
    if (!hasImages) return { ok: false, problem: 'This folder has "races.txt" but no "images" folder (the game art). Copy the complete game folder.' };
    return { ok: false, problem: 'This folder has an "images" folder but no "races.txt" (the game data). Copy the complete game folder.' };
}

/**
 * Validate a folder the player picked, forgiving a pick one or more levels too high: the folder itself, else its
 * "Distant Worlds Universe" subfolder, else steamapps/common/Distant Worlds Universe below it (a Steam library root),
 * else common/Distant Worlds Universe (the steamapps folder). Returns { ok: true, dir } with the folder to use, or
 * { ok: false, problem } describing the folder as picked.
 */
function checkInstallDir(dir, fsImpl = realFs, p = nodePath) {
    const exact = checkInstallDirExact(dir, fsImpl, p);
    if (exact.ok) return { ok: true, dir };
    if (typeof dir === 'string' && fsImpl.isDir(dir)) {
        for (const segs of [[INSTALL_FOLDER], ['steamapps', 'common', INSTALL_FOLDER], ['common', INSTALL_FOLDER]]) {
            let cur = dir;
            for (const s of segs) {
                const hit = cur === null ? null : findEntry(fsImpl, cur, s);
                cur = hit === null ? null : p.join(cur, hit);
            }
            if (cur !== null && checkInstallDirExact(cur, fsImpl, p).ok) return { ok: true, dir: cur };
        }
    }
    return exact;
}

/** The library paths of a Steam libraryfolders.vdf (current "path" entries and the old "1" "D:\\Lib" form). */
function parseLibraryFoldersVdf(text) {
    if (typeof text !== 'string') return [];
    const out = [];
    const unescape = (s) => s.replace(/\\\\/g, '\\');
    for (const m of text.matchAll(/"path"\s+"((?:[^"\\]|\\.)*)"/gi)) out.push(unescape(m[1]));
    // Old format: "libraryfolders" { "TimeNextStatsReport" "..." "1" "D:\\SteamLibrary" }. The current format's
    // "apps" { "<appid>" "<size>" } rows have the same shape, so only path-like values count.
    for (const m of text.matchAll(/^\s*"\d+"\s+"((?:[^"\\]|\\.)*)"\s*$/gm)) if (/[\\/]/.test(m[1])) out.push(unescape(m[1]));
    return out;
}

/** The data of value `name` in `reg query <key> /v <name>` output (REG_SZ / REG_EXPAND_SZ), or null. */
function parseRegQueryValue(stdout, name) {
    if (typeof stdout !== 'string') return null;
    for (const line of stdout.split(/\r?\n/)) {
        const m = /^\s*(\S.*?)\s+REG_(?:EXPAND_)?SZ\s+(.*?)\s*$/.exec(line);
        if (m && m[1].toLowerCase() === name.toLowerCase() && m[2] !== '') return m[2];
    }
    return null;
}

/**
 * Ordered, de-duplicated candidate install folders for `platform`.
 * env: process.env-like; home: the home folder; registry(key, value): string | null (Windows only);
 * fsImpl: { readdir, isDir, isFile, readText }.
 */
function installCandidates({ platform, home, env = {}, registry = () => null, fsImpl = realFs }) {
    const p = platform === 'win32' ? nodePath.win32 : nodePath.posix;
    const steamRoots = [];
    const extra = [];
    const listDirs = (dir) => {
        try {
            return fsImpl
                .readdir(dir)
                .map((n) => p.join(dir, n))
                .filter((d) => fsImpl.isDir(d));
        } catch {
            return [];
        }
    };

    if (platform === 'win32') {
        const pf86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
        const pf = env.ProgramFiles || 'C:\\Program Files';
        const reg1 = registry('HKCU\\Software\\Valve\\Steam', 'SteamPath');
        const reg2 = registry('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath');
        // SteamPath is stored with forward slashes (c:/program files (x86)/steam).
        for (const r of [reg1, reg2]) if (r) steamRoots.push(p.normalize(r));
        steamRoots.push(p.join(pf86, 'Steam'), p.join(pf, 'Steam'));
        extra.push(
            p.join(pf86, 'Matrix Games', INSTALL_FOLDER),
            p.join(pf, 'Matrix Games', INSTALL_FOLDER),
            p.join(pf86, 'GOG Galaxy', 'Games', INSTALL_FOLDER),
            p.join('C:\\GOG Games', INSTALL_FOLDER),
            p.join('C:\\Games', INSTALL_FOLDER),
        );
    } else if (platform === 'darwin') {
        steamRoots.push(p.join(home, 'Library', 'Application Support', 'Steam'));
        // Windows Steam inside Whisky / CrossOver bottles (DW:U has no macOS build).
        const bottleParents = [
            p.join(home, 'Library', 'Containers', 'com.isaacmarovitz.Whisky', 'Bottles'),
            p.join(home, 'Library', 'Application Support', 'CrossOver', 'Bottles'),
        ];
        for (const parent of bottleParents) {
            for (const bottle of listDirs(parent)) {
                for (const pfName of ['Program Files (x86)', 'Program Files']) {
                    steamRoots.push(p.join(bottle, 'drive_c', pfName, 'Steam'));
                    extra.push(p.join(bottle, 'drive_c', pfName, 'Matrix Games', INSTALL_FOLDER));
                }
            }
        }
        extra.push(p.join(home, 'Games', INSTALL_FOLDER));
    } else {
        const xdgData = env.XDG_DATA_HOME || p.join(home, '.local', 'share');
        steamRoots.push(
            p.join(xdgData, 'Steam'),
            p.join(home, '.local', 'share', 'Steam'),
            p.join(home, '.steam', 'steam'),
            p.join(home, '.steam', 'root'),
            p.join(home, 'Steam'),
            p.join(home, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam'),
            p.join(home, 'snap', 'steam', 'common', '.local', 'share', 'Steam'),
        );
        const winePrefix = env.WINEPREFIX || p.join(home, '.wine');
        steamRoots.push(p.join(winePrefix, 'drive_c', 'Program Files (x86)', 'Steam'));
        extra.push(p.join(winePrefix, 'drive_c', 'Program Files (x86)', 'Matrix Games', INSTALL_FOLDER), p.join(home, 'Games', INSTALL_FOLDER));
    }

    const libraries = [];
    for (const root of steamRoots) {
        libraries.push(root);
        for (const vdf of [p.join(root, 'steamapps', 'libraryfolders.vdf'), p.join(root, 'config', 'libraryfolders.vdf')]) {
            for (const lib of parseLibraryFoldersVdf(fsImpl.readText(vdf))) {
                // Bottle / Wine Steam lists Windows paths (C:\...), meaningless outside the prefix.
                if (platform !== 'win32' && /^[a-z]:[\\/]/i.test(lib)) continue;
                libraries.push(platform === 'win32' ? p.normalize(lib) : lib);
            }
        }
    }
    const out = [];
    const seen = new Set();
    for (const c of [...libraries.map((lib) => p.join(lib, 'steamapps', 'common', INSTALL_FOLDER)), ...extra]) {
        const key = platform === 'win32' || platform === 'darwin' ? c.toLowerCase() : c;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(c);
    }
    return out;
}

/** The first candidate that is a valid install, or null. */
function findInstallDir(opts) {
    const fsImpl = opts.fsImpl ?? realFs;
    const p = opts.platform === 'win32' ? nodePath.win32 : nodePath.posix;
    for (const c of installCandidates(opts)) if (checkInstallDirExact(c, fsImpl, p).ok) return c;
    return null;
}

module.exports = {
    INSTALL_FOLDER,
    checkInstallDir,
    checkInstallDirExact,
    parseLibraryFoldersVdf,
    parseRegQueryValue,
    installCandidates,
    findInstallDir,
};
