// The player's own music (Options → Music & Mood, src/audio/userMusic.ts): a "Music" folder in the app's user-data
// folder, next to the saves. Each subfolder is one playlist, named after the folder; music files directly in Music/
// form a playlist called "Music". main.cjs serves the listing at dwu://app/user-music/index.json and the files under
// dwu://app/user-music/<playlist>/<file>; the renderer never sees a disk path except the folder's, for display.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

/** Extensions the panel lists (the renderer drops those its Chromium cannot play). */
const MUSIC_EXTENSIONS = new Set(['.mp3', '.ogg', '.oga', '.opus', '.flac', '.wav', '.m4a', '.aac']);

const README = `openDWU music folder
====================

Put your own music here to play it in the game instead of (or as well as) the original soundtrack.

- Each subfolder is one playlist, named after the folder. For example:
    Music/Ambient/track01.mp3
    Music/Battle/theme.ogg
- Supported files: .mp3, .ogg, .opus, .flac, .wav, .m4a and .aac.
- In the game: Escape menu -> Options -> Sound Volume -> "Music & Mood..." and pick the playlist under Music.
  The list is read again each time that window opens. Shuffle and Next Track are there too.

Files that are empty, unreadable or in another format are skipped.
`;

/** The Music folder for a user-data folder. */
function musicDir(userData) {
    return path.join(userData, 'Music');
}

/** Create the Music folder and its README.txt when missing (first run). Never throws. */
function ensureMusicFolder(dir) {
    try {
        fs.mkdirSync(dir, { recursive: true });
        const readme = path.join(dir, 'README.txt');
        if (!fs.existsSync(readme)) fs.writeFileSync(readme, README);
    } catch (err) {
        console.warn(`Could not create the music folder ${dir}: ${err.message}`);
    }
}

function readable(file) {
    try {
        fs.accessSync(file, fs.constants.R_OK);
        return fs.statSync(file).size > 0;
    } catch {
        return false;
    }
}

/** List the playlists: { folder, playlists: [{ name, files: [{ name, rel }] }], notes: [...] }. `rel` is the path
 *  under the Music folder with '/' separators. Missing / empty / unreadable files are left out with a note. */
function listPlaylists(dir) {
    const out = { folder: dir, playlists: [], notes: [] };
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        out.notes.push('The Music folder is missing or cannot be read.');
        return out;
    }
    const collect = (sub, name) => {
        const files = [];
        let skipped = 0;
        let list;
        try {
            list = fs.readdirSync(sub, { withFileTypes: true });
        } catch {
            out.notes.push(`${name}: the folder cannot be read.`);
            return;
        }
        for (const e of list) {
            if (!e.isFile() && !e.isSymbolicLink()) continue;
            if (!MUSIC_EXTENSIONS.has(path.extname(e.name).toLowerCase())) continue;
            const full = path.join(sub, e.name);
            if (!readable(full)) {
                skipped++;
                continue;
            }
            files.push({ name: e.name, rel: path.relative(dir, full).split(path.sep).join('/') });
        }
        files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        if (skipped > 0) out.notes.push(`${name}: ${skipped} empty or unreadable file${skipped === 1 ? '' : 's'} skipped.`);
        out.playlists.push({ name, files });
    };
    const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort((a, b) => a.localeCompare(b));
    for (const d of dirs) collect(path.join(dir, d), d);
    if (entries.some((e) => e.isFile() && MUSIC_EXTENSIONS.has(path.extname(e.name).toLowerCase())) && !dirs.includes('Music')) collect(dir, 'Music');
    return out;
}

module.exports = { MUSIC_EXTENSIONS, README, musicDir, ensureMusicFolder, listPlaylists };
