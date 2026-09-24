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
import { existsSync, statSync, copyFileSync, readdirSync, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';

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

export default defineConfig({
    base: './',
    plugins: [dwuProbe(), dwuCaseInsensitive(), copyAssetManifest()],
    build: {
        // Do not copy public/ (the assets/dwu symlink is ~4 GB); only the
        // small asset-manifest.json matters in dist/, handled above.
        copyPublicDir: false,
    },
    server: {
        fs: {
            // Allow serving the (symlinked) DW:U install outside the root.
            allow: [existsSync('public/assets/dwu') ? '..' : '.'],
        },
    },
});