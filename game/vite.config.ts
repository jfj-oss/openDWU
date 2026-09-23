// Vite dev config. The `dwuProbe` middleware answers a small probe request
// used by src/main.ts to detect whether a DW:U install (original art under
// /assets/dwu/) is present. In the built desktop shell the middleware is
// absent and main.ts probes /assets/dwu/systemNames.txt directly instead.
import { existsSync, statSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

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

export default defineConfig({
    plugins: [dwuProbe()],
    server: {
        fs: {
            // Allow serving the (symlinked) DW:U install outside the root.
            allow: [existsSync('public/assets/dwu') ? '..' : '.'],
        },
    },
});