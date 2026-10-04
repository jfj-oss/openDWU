// Vite config. The `dwuProbe` middleware answers a small probe request used
// by src/main.ts to detect whether a DW:U install (original art under
// /assets/dwu/) is present. In the built desktop shell the middleware is
// absent and main.ts probes /assets/dwu/systemNames.txt directly instead.
//
// Build notes for the Electron shell (desktop/main.cjs):
// - base './' so dist/index.html works under dwu://app/ (relative asset URLs).
// - copyPublicDir: false keeps the 4 GB public/assets/dwu symlink out of
//   dist/. The generated public/asset-manifest.json is still copied into
//   dist/ by the copyAssetManifest plugin below, so the packaged app keeps
//   real-art rendering (without it loadManifest() no-ops and the game falls
//   back to generated textures).
import { existsSync, statSync, copyFileSync, readdirSync, readFileSync, createReadStream, mkdirSync, writeFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import type {} from 'vitest/config'; // types the `test` block below
import { buildScenarioIndex, listScenarioFiles } from './scripts/scenarioIndex.mjs';
import themeIndexLib from './desktop/themeIndex.cjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// Shared with the Electron protocol handler (desktop/main.cjs): original art without its embedded colour profile.
const { stripColorProfile, isProfiledImagePath } = createRequire(import.meta.url)('./desktop/colorProfile.cjs') as typeof import('./desktop/colorProfile.cjs');

/**
 * Resolve a relative path under `root` case-insensitively, segment by
 * segment (the original is a Windows game and references files with wrong
 * letter case, e.g. shipsAndBasesButton.png for ShipsAndBasesButton.png).
 * Pure function: directory listings come from the injected `readdir`, so it
 * is unit-testable without touching the filesystem. Returns the resolved
 * path or null when any segment does not exist (case-insensitively) or the
 * final entry is a directory (per the injected `isDirectory`).
 */
export function resolveCaseInsensitive(
    root: string,
    relPath: string,
    readdir: (dir: string) => string[],
    isDirectory: (abs: string) => boolean = (abs) => statSync(abs).isDirectory(),
): string | null {
    const segments = relPath.split('/');
    if (segments.some((s) => s === '..' || s === '.')) return null;
    let dir = root;
    for (let i = 0; i < segments.length - 1; i++) {
        const seg = segments[i];
        if (seg === '') continue;
        let entries: string[];
        try {
            entries = readdir(dir);
        } catch {
            return null;
        }
        const lower = seg.toLowerCase();
        const match = entries.find((e) => e.toLowerCase() === lower);
        if (!match) return null;
        dir = path.join(dir, match);
    }
    const last = segments[segments.length - 1];
    if (last === '') return null;
    let entries: string[];
    try {
        entries = readdir(dir);
    } catch {
        return null;
    }
    const match = entries.find((e) => e.toLowerCase() === last.toLowerCase());
    if (!match) return null;
    const abs = path.join(dir, match);
    if (isDirectory(abs)) return null;
    return abs;
}

/** Content types for the file kinds the DW:U install serves. */
const CONTENT_TYPES: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.txt': 'text/plain; charset=utf-8',
    '.ttf': 'font/ttf',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
};

/**
 * Serve one original image with its embedded colour profile removed (desktop/colorProfile.cjs: the original's GDI+
 * load ignores it, so the browser must decode raw values too). Same caching headers as Vite's static serving (ETag +
 * Last-Modified, Cache-Control: no-cache); the ETag is marked so a browser that cached the unstripped file
 * revalidates instead of reusing it.
 */
async function serveRawImage(abs: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const st = await stat(abs);
    const etag = `W/"${st.size}-${Math.floor(st.mtimeMs)}-raw"`;
    res.setHeader('Content-Type', CONTENT_TYPES[path.extname(abs).toLowerCase()] ?? 'application/octet-stream');
    res.setHeader('Last-Modified', st.mtime.toUTCString());
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'no-cache');
    if (req.headers['if-none-match'] === etag) {
        res.statusCode = 304;
        res.end();
        return;
    }
    const body = stripColorProfile(await readFile(abs));
    res.statusCode = 200;
    res.setHeader('Content-Length', body.length);
    res.end(req.method === 'HEAD' ? undefined : body);
}

/**
 * Dev-server middleware for /assets/dwu/... (the DW:U install), mirroring the Electron shell's dwu:// handler
 * (desktop/main.cjs):
 * - paths resolve case-insensitively: the original references files with wrong letter case (e.g.
 *   shipsAndBasesButton.png for ShipsAndBasesButton.png), which Vite's static serving does not resolve — exact path
 *   first, otherwise each segment against fs.readdirSync of the parent (directory listings cached per process);
 * - PNG / JPEG art is served through serveRawImage (colour profile removed);
 * - any other existing file goes to Vite's static serving (exact path) or is streamed with its Content-Type
 *   (case-corrected path); no match -> next().
 * `root` is the install folder (public/assets/dwu); exported for the tests.
 */
export function dwuAssetsMiddleware(root: string): (req: IncomingMessage, res: ServerResponse, next: () => void) => void {
    // Directory listing cache: dir -> entries (never invalidated; the install folder is static during a dev session).
    const listings = new Map<string, string[]>();
    const readdirCached = (dir: string): string[] => {
        let list = listings.get(dir);
        if (!list) {
            list = readdirSync(dir);
            listings.set(dir, list);
        }
        return list;
    };
    return (req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith('/assets/dwu/') || (req.method !== 'GET' && req.method !== 'HEAD')) {
            next();
            return;
        }
        let rel: string;
        try {
            rel = decodeURIComponent(url.slice('/assets/dwu/'.length).split('?')[0]);
        } catch {
            next();
            return;
        }
        if (rel === '' || rel.includes('..')) {
            next();
            return;
        }
        const exact = path.join(root, rel);
        const exactExists = existsSync(exact);
        if (exactExists && !isProfiledImagePath(exact)) {
            // Exact path, not art: let Vite's static serving handle it.
            next();
            return;
        }
        const abs = exactExists ? exact : resolveCaseInsensitive(root, rel, readdirCached);
        if (!abs || !statSync(abs).isFile()) {
            next();
            return;
        }
        if (isProfiledImagePath(abs)) {
            serveRawImage(abs, req, res).catch(() => next());
            return;
        }
        const ext = path.extname(abs).toLowerCase();
        res.statusCode = 200;
        res.setHeader('Content-Type', CONTENT_TYPES[ext] ?? 'application/octet-stream');
        createReadStream(abs).pipe(res);
    };
}

function dwuAssets(): Plugin {
    return {
        name: 'dwu-assets',
        configureServer(server) {
            server.middlewares.use(dwuAssetsMiddleware(path.join(here, 'public', 'assets', 'dwu')));
        },
    };
}

function dwuProbe(): Plugin {
    return {
        name: 'dwu-probe',
        configureServer(server) {
            server.middlewares.use('/assets/dwu/__dwu_probe', (_req, res) => {
                let present = false;
                try {
                    present = statSync('public/assets/dwu').isDirectory();
                } catch {
                    present = false;
                }
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ present }));
            });
        },
    };
}

/**
 * Themes (customization sets): /theme-manifest/index.json (the Customization subfolders) and
 * /theme-manifest/<set>.json (one theme's file index), built from the linked install by desktop/themeIndex.cjs —
 * the same module the desktop shell serves them with from the user's install. Written into dist/ at build too.
 */
// The machine's total RAM for the sim-worker default (src/systemMemory.ts): browsers cap navigator.deviceMemory at 8 GB,
// so the dev server writes it into the page. The desktop shell does the same for dwu://app/index.html (desktop/main.cjs).
function systemMemoryMeta(): Plugin {
    return {
        name: 'system-memory-meta',
        apply: 'serve',
        transformIndexHtml(html) {
            const gib = (os.totalmem() / 2 ** 30).toFixed(1);
            return html.replace('</head>', `<meta name="dwu-system-memory-gib" content="${gib}">\n</head>`);
        },
    };
}

function themeManifest(): Plugin {
    const dwuRoot = path.join(here, 'public', 'assets', 'dwu');
    const lib = themeIndexLib as { listThemes(root: string): string[]; buildThemeIndex(root: string, set: string): unknown };
    let isBuild = false;
    return {
        name: 'theme-manifest',
        configResolved(config) {
            isBuild = config.command === 'build';
        },
        configureServer(server) {
            const cache = new Map<string, string | null>();
            server.middlewares.use((req: IncomingMessage, res: ServerResponse, next) => {
                const url = (req.url ?? '').split('?')[0];
                if (!url.startsWith('/theme-manifest/')) {
                    next();
                    return;
                }
                let name: string;
                try {
                    name = decodeURIComponent(url.slice('/theme-manifest/'.length));
                } catch {
                    name = '';
                }
                let body = cache.get(name);
                if (body === undefined) {
                    if (name === 'index.json') body = JSON.stringify(lib.listThemes(dwuRoot));
                    else if (name.endsWith('.json')) {
                        const idx = lib.buildThemeIndex(dwuRoot, name.slice(0, -'.json'.length));
                        body = idx === null ? null : JSON.stringify(idx);
                    } else body = null;
                    cache.set(name, body);
                }
                if (body === null) {
                    res.statusCode = 404;
                    res.end('Not found');
                    return;
                }
                res.setHeader('Content-Type', 'application/json');
                res.end(body);
            });
        },
        closeBundle() {
            if (!isBuild || !existsSync(path.join(here, 'dist'))) return;
            const out = path.join(here, 'dist', 'theme-manifest');
            mkdirSync(out, { recursive: true });
            const themes = lib.listThemes(dwuRoot);
            writeFileSync(path.join(out, 'index.json'), JSON.stringify(themes));
            for (const t of themes) {
                const idx = lib.buildThemeIndex(dwuRoot, t);
                if (idx !== null) writeFileSync(path.join(out, `${t}.json`), JSON.stringify(idx));
            }
        },
    };
}

/** Copy public/asset-manifest.json into dist/ after build (see header note). */
function copyAssetManifest(): Plugin {
    return {
        name: 'copy-asset-manifest',
        apply: 'build',
        closeBundle() {
            const src = path.join(here, 'public', 'asset-manifest.json');
            if (!existsSync(src)) return;
            copyFileSync(src, path.join(here, 'dist', 'asset-manifest.json'));
        },
    };
}

/**
 * Mod layer (tasks/MODLAYER-DESIGN.md §1): the repo's scenarios/ folder served at /assets/scenarios/ (dev middleware;
 * index.json generated per request) and copied with a generated index.json into dist/assets/scenarios/ at build (the
 * Electron shell serves dist/ as-is).
 */
function scenarioAssets(): Plugin {
    const root = path.join(here, 'scenarios');
    let isBuild = false;
    return {
        name: 'scenario-assets',
        configResolved(config) {
            isBuild = config.command === 'build';
        },
        configureServer(server) {
            server.middlewares.use((req: IncomingMessage, res: ServerResponse, next) => {
                const url = (req.url ?? '').split('?')[0];
                if (!url.startsWith('/assets/scenarios/')) {
                    next();
                    return;
                }
                const rel = decodeURIComponent(url.slice('/assets/scenarios/'.length));
                if (rel === 'index.json') {
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify(buildScenarioIndex(root)));
                    return;
                }
                const abs = rel.includes('..') ? null : path.join(root, rel);
                if (abs === null || !existsSync(abs) || !statSync(abs).isFile()) {
                    res.statusCode = 404;
                    res.end('Not found');
                    return;
                }
                const ext = path.extname(abs).toLowerCase();
                res.setHeader('Content-Type', ext === '.json' ? 'application/json' : CONTENT_TYPES[ext] ?? 'text/plain; charset=utf-8');
                createReadStream(abs).pipe(res);
            });
        },
        closeBundle() {
            if (!isBuild || !existsSync(root) || !existsSync(path.join(here, 'dist'))) return;
            const out = path.join(here, 'dist', 'assets', 'scenarios');
            for (const rel of listScenarioFiles(root)) {
                mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
                copyFileSync(path.join(root, rel), path.join(out, rel));
            }
            writeFileSync(path.join(out, 'index.json'), JSON.stringify(buildScenarioIndex(root)));
        },
    };
}

/**
 * Test tiers. A test file with a `// @slow` line in its header (first 15 lines) is a soak: `npm run test:fast`
 * (DWU_TEST_TIER=fast) runs every other file, `npm run test:slow` (DWU_TEST_TIER=slow) only those; `npm test` (tier
 * unset) runs all. Explicit file filters on the command line still apply within the tier.
 */
function slowTestFiles(): string[] {
    const dir = path.join(here, 'test');
    return readdirSync(dir)
        .filter((f) => f.endsWith('.test.ts'))
        .filter((f) => readFileSync(path.join(dir, f), 'utf8').split('\n', 15).some((l) => /^\s*\/\/\s*@slow\b/.test(l)))
        .map((f) => `test/${f}`);
}

function testTier(): { include?: string[]; exclude?: string[] } {
    const tier = process.env.DWU_TEST_TIER;
    if (tier === undefined || tier === '' || tier === 'all') return {};
    if (tier === 'fast') return { exclude: ['**/node_modules/**', '**/.git/**', ...slowTestFiles()] };
    if (tier === 'slow') return { include: slowTestFiles() };
    throw new Error(`DWU_TEST_TIER must be fast, slow or all (got ${tier})`);
}

export default defineConfig({
    base: './',
    // Per-checkout dep-optimizer cache. node_modules is a symlink shared by
    // every git worktree, so the default node_modules/.vite cache was
    // rewritten by other worktrees' dev servers mid-boot (504 Outdated
    // Optimize Dep). `.vite/` at the game root is gitignored.
    cacheDir: path.join(here, '.vite'),
    test: {
        // Registers expect(...).toMatchPin(key) for the seed pins (test/pins/pin.ts, scripts/repin.mjs).
        setupFiles: ['test/pins/pin.ts'],
        ...testTier(),
    },
    plugins: [dwuProbe(), dwuAssets(), copyAssetManifest(), scenarioAssets(), themeManifest(), systemMemoryMeta()],
    build: {
        // Do not copy public/ (the assets/dwu symlink is ~4 GB); only the
        // small asset-manifest.json matters in dist/, handled above.
        copyPublicDir: false,
    },
    server: {
        // The DW:U install is symlinked under public/assets/dwu (thousands of files): never watch it.
        watch: { ignored: ['**/public/assets/dwu/**'] },
        fs: {
            // Allow serving the (symlinked) DW:U install outside the root.
            allow: [existsSync('public/assets/dwu') ? '..' : '.'],
        },
    },
});