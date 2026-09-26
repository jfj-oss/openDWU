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
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import type {} from 'vitest/config'; // types the `test` block below
import { buildScenarioIndex, listScenarioFiles } from './scripts/scenarioIndex.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

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
    '.txt': 'text/plain; charset=utf-8',
    '.ttf': 'font/ttf',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
};

/**
 * Dev-server middleware: serve /assets/dwu/... case-insensitively. The
 * Electron shell already resolves paths this way (desktop/main.cjs); Vite's
 * static serving does not, which breaks chrome art referenced with the
 * original's (wrong-case) file names. Runs before Vite's static serving:
 * exact path -> next(); otherwise resolve each segment against fs.readdirSync
 * of the parent (directory listings cached per process) and stream the match
 * with its Content-Type; no match -> next().
 */
function dwuCaseInsensitive(): Plugin {
    return {
        name: 'dwu-case-insensitive',
        configureServer(server) {
            const root = path.join(here, 'public', 'assets', 'dwu');
            // Directory listing cache: dir -> entries (never invalidated; the
            // install folder is static during a dev session).
            const listings = new Map<string, string[]>();
            const readdirCached = (dir: string): string[] => {
                let list = listings.get(dir);
                if (!list) {
                    list = readdirSync(dir);
                    listings.set(dir, list);
                }
                return list;
            };
            server.middlewares.use((req: IncomingMessage, res: ServerResponse, next) => {
                const url = req.url ?? '';
                if (!url.startsWith('/assets/dwu/')) {
                    next();
                    return;
                }
                const prefixLen = '/assets/dwu/'.length;
                let rel = decodeURIComponent(url.slice(prefixLen).split('?')[0]);
                if (rel === '' || rel.includes('..')) {
                    next();
                    return;
                }
                // Exact path exists: let Vite's static serving handle it.
                if (existsSync(path.join(root, rel))) {
                    next();
                    return;
                }
                const abs = resolveCaseInsensitive(root, rel, readdirCached);
                if (!abs) {
                    next();
                    return;
                }
                const ext = path.extname(abs).toLowerCase();
                res.statusCode = 200;
                res.setHeader('Content-Type', CONTENT_TYPES[ext] ?? 'application/octet-stream');
                createReadStream(abs).pipe(res);
            });
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
    plugins: [dwuProbe(), dwuCaseInsensitive(), copyAssetManifest(), scenarioAssets()],
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