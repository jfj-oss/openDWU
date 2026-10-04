// Electron main process for the DW:U recreation.
//
// Serves the built game (dist/) over a privileged custom scheme, dwu://app/…,
// and maps dwu://app/assets/dwu/<path> to <DW:U install dir>/<path> so the
// renderer can fetch original data/art by URL exactly like it does under
// `npm run dev` (where Vite serves the public/assets/dwu symlink).
//
// The renderer stays platform-neutral: no Node APIs in src/, everything goes
// through URLs under /assets/dwu/.

const { app, BrowserWindow, Menu, dialog, protocol, net, globalShortcut, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const themeIndex = require('./themeIndex.cjs');

// dist/ lives next to desktop/ in the repo; when packaged it is copied into
// resources/ by @electron/packager (extraResources below).
const DIST_DIR = app.isPackaged
    ? path.join(process.resourcesPath, 'dwu-dist')
    : path.join(__dirname, '..', 'dist');

const CONFIG_FILE = () => path.join(app.getPath('userData'), 'config.json');

// ---------------------------------------------------------------------------
// Install-dir discovery
// ---------------------------------------------------------------------------

/** Platform default guesses for the DW:U install folder. */
function defaultInstallGuesses() {
    const home = os.homedir();
    if (process.platform === 'darwin') {
        return [
            path.join(home, 'Library', 'Application Support', 'Steam', 'steamapps', 'common', 'Distant Worlds Universe'),
            path.join(home, 'Games', 'Distant Worlds Universe'),
        ];
    }
    // Linux (also covers Steam Deck / Proton paths via $XDG_DATA_HOME)
    const xdgData = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
    return [
        path.join(xdgData, 'Steam', 'steamapps', 'common', 'Distant Worlds Universe'),
        path.join(home, 'Steam', 'steamapps', 'common', 'Distant Worlds Universe'),
    ];
}

/** A valid DW:U install dir has an images/ subfolder (original art). */
function isValidInstallDir(dir) {
    try {
        return fs.statSync(path.join(dir, 'images')).isDirectory();
    } catch {
        return false;
    }
}

function readConfigInstallDir() {
    try {
        const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE(), 'utf8'));
        if (typeof cfg.installDir === 'string' && isValidInstallDir(cfg.installDir)) {
            return cfg.installDir;
        }
    } catch {
        // missing or invalid config.json — fall through to guesses
    }
    return null;
}

function writeConfig(installDir) {
    let cfg = {};
    try {
        cfg = JSON.parse(fs.readFileSync(CONFIG_FILE(), 'utf8'));
    } catch {
        // start fresh
    }
    cfg.installDir = installDir;
    fs.mkdirSync(path.dirname(CONFIG_FILE()), { recursive: true });
    fs.writeFileSync(CONFIG_FILE(), JSON.stringify(cfg, null, 2) + '\n');
}

/**
 * Find the DW:U install dir: $DWU_DIR (not saved; for scripts/tests, same
 * variable as `npm run import-assets`) → saved config → platform default
 * guesses → open-directory dialog. Returns null if the user cancels the dialog.
 */
async function findInstallDir() {
    const envDir = process.env.DWU_DIR;
    if (envDir) {
        if (isValidInstallDir(envDir)) return envDir;
        console.warn(`DWU_DIR=${envDir} has no images/ subfolder; ignoring it.`);
    }

    const saved = readConfigInstallDir();
    if (saved) return saved;

    for (const guess of defaultInstallGuesses()) {
        if (isValidInstallDir(guess)) {
            writeConfig(guess);
            return guess;
        }
    }

    const result = await dialog.showOpenDialog({
        title: 'Locate your Distant Worlds: Universe folder',
        buttonLabel: 'Select',
        properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const chosen = result.filePaths[0];
    if (!isValidInstallDir(chosen)) {
        dialog.showErrorBox(
            'Not a Distant Worlds: Universe folder',
            `The selected folder does not contain an "images" subfolder.\n\n${chosen}`,
        );
        return null;
    }
    writeConfig(chosen);
    return chosen;
}

// ---------------------------------------------------------------------------
// Case-insensitive path resolution
// ---------------------------------------------------------------------------
// The original game runs on Windows (case-insensitive), so data references
// like images/Environment/... must resolve on case-sensitive Linux/macOS.
// Each segment is matched against the real directory listing (cached per
// directory, lowercased name → actual entry name).

const dirListingCache = new Map(); // absolute dir → Map(lowerName → entryName)

function listDirCaseInsensitive(dir) {
    let map = dirListingCache.get(dir);
    if (!map) {
        map = new Map();
        try {
            for (const entry of fs.readdirSync(dir)) {
                map.set(entry.toLowerCase(), entry);
            }
        } catch {
            // unreadable dir: keep empty map
        }
        dirListingCache.set(dir, map);
    }
    return map;
}

/**
 * Resolve `rel` (segments from the install root) case-insensitively.
 * Returns the resolved absolute path, or null if any segment is missing or
 * the result escapes the root (traversal guard).
 */
function resolveInsideRoot(root, rel) {
    let current = root;
    for (const rawSeg of rel.split('/')) {
        const seg = decodeURIComponent(rawSeg);
        if (seg === '' || seg === '.') continue;
        if (seg === '..') return null; // never allow escaping the root
        const map = listDirCaseInsensitive(current);
        const actual = map.get(seg.toLowerCase());
        if (actual === undefined) return null;
        current = path.join(current, actual);
    }
    // Final guard: the resolved path must stay inside the root.
    const resolved = path.resolve(current);
    const resolvedRoot = path.resolve(root);
    if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) return null;
    return resolved;
}

// ---------------------------------------------------------------------------
// dwu:// scheme handler
// ---------------------------------------------------------------------------

let installDir = null; // set before createWindow
let appIcon = nativeImage.createEmpty(); // set alongside installDir

// Must be registered after app ready: protocol.handle touches the default
// session, which is only available once the app is ready.
app.whenReady().then(() => {
    protocol.handle('dwu', async (request) => {
        try {
            const url = new URL(request.url);
            // dwu://app/<rest> — host is "app", pathname starts with "/"
            let rest = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
            // The query string (?autostart=1 etc.) is for the page, not the file.

            if (rest.startsWith('assets/dwu/')) {
                // Original DW:U data/art from the user's install folder.
                if (!installDir) {
                    return new Response('DW:U install folder not configured', { status: 503 });
                }
                const fileRel = rest.slice('assets/dwu/'.length);
                const resolved = resolveInsideRoot(installDir, fileRel);
                if (!resolved) {
                    return new Response(`Not found: ${fileRel}`, { status: 404 });
                }
                if (!fs.statSync(resolved).isFile()) {
                    return new Response(`Not a file: ${fileRel}`, { status: 404 });
                }
                return net.fetch(pathToFileURL(resolved).href, request);
            }

            if (rest.startsWith('theme-manifest/')) {
                // Themes of the USER's install (Customization subfolders + each one's file index), built live:
                // dist/'s copy describes the build machine's install. desktop/themeIndex.cjs.
                if (!installDir) return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
                const name = rest.slice('theme-manifest/'.length);
                let body = null;
                if (name === 'index.json') body = JSON.stringify(themeIndex.listThemes(installDir));
                else if (name.endsWith('.json')) {
                    const idx = themeIndex.buildThemeIndex(installDir, name.slice(0, -'.json'.length));
                    if (idx !== null) body = JSON.stringify(idx);
                }
                if (body === null) return new Response(`Not found: ${rest}`, { status: 404 });
                return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            // Everything else: the built game from dist/.
            const resolved = resolveInsideRoot(DIST_DIR, rest || 'index.html');
            if (!resolved || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
                return new Response(`Not found: ${rest}`, { status: 404 });
            }
            return net.fetch(pathToFileURL(resolved).href, request);
        } catch (err) {
            console.error('dwu:// handler error:', err);
            return new Response(String(err && err.message ? err.message : err), { status: 500 });
        }
    });
});

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function toggleFullscreen(win) {
    win.setFullScreen(!win.isFullScreen());
}

function createWindow() {
    const win = new BrowserWindow({
        width: 1600,
        height: 900,
        minWidth: 1280,
        minHeight: 720,
        title: 'Distant Worlds: Universe',
        backgroundColor: '#000',
        show: false,
        // Window icon on Linux/Windows (macOS ignores `icon`; the dock icon is
        // set via app.dock.setIcon below). Empty image = Electron default.
        icon: appIcon.isEmpty() ? undefined : appIcon,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });

    // No menu bar on Linux; macOS keeps the standard app menu (Quit ⌘Q).
    if (process.platform === 'linux') {
        Menu.setApplicationMenu(null);
    }

    // macOS: dock icon from the user's DW:U install folder.
    if (process.platform === 'darwin' && !appIcon.isEmpty()) {
        app.dock.setIcon(appIcon);
    }

    win.once('ready-to-show', () => win.show());

    // F11 / Ctrl/Cmd+F toggles fullscreen.
    win.webContents.on('before-input-event', (_event, input) => {
        if (input.type !== 'keyDown') return;
        const isF11 = input.key === 'F11';
        const isCtrlCmdF = input.key === 'f' && (input.controlKey || input.metaKey);
        if (isF11 || isCtrlCmdF) {
            toggleFullscreen(win);
        }
    });

    win.loadURL('dwu://app/index.html');
}

// ---------------------------------------------------------------------------
// Window icon (loaded at runtime from the user's DW:U install folder — art
// can't be committed to the repo)
// ---------------------------------------------------------------------------

/**
 * Build the window/dock icon from the install dir. Tries the in-game chrome
 * icon first, then the desktop icon shipped with the game. Returns an empty
 * nativeImage if neither exists (callers must check isEmpty()).
 */
function makeAppIcon(installDir) {
    if (installDir) {
        const candidates = [
            'images/ui/chrome/galaxy_Icon.png',
            'DesktopIcon.ico',
        ];
        for (const rel of candidates) {
            const resolved = resolveInsideRoot(installDir, rel);
            if (!resolved || !fs.existsSync(resolved)) continue;
            const img = nativeImage.createFromPath(resolved);
            if (!img.isEmpty()) return img;
        }
    }
    return nativeImage.createEmpty();
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

// Privileged scheme registration must happen before app ready.
protocol.registerSchemesAsPrivileged([
    {
        scheme: 'dwu',
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            corsEnabled: true,
            stream: true,
        },
    },
]);

app.whenReady().then(async () => {
    // (protocol.handle for dwu:// is registered in the whenReady above.)
    installDir = await findInstallDir();
    appIcon = makeAppIcon(installDir);
    if (!installDir) {
        // User declined to locate the install folder: still launch, the game
        // boots without original data/art (generated fallbacks).
        console.warn('No DW:U install folder configured; running without original assets.');
    }
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});