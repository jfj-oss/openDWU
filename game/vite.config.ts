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
import { existsSync, statSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));

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
    plugins: [dwuProbe(), copyAssetManifest()],
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