#!/usr/bin/env node
// Headless sim run (tasks/M4-plan.md §5.2): createGame + runGameSeconds, then print the state digest, entity counts,
// Galaxy.Rnd draws, TODO(port) stubs reached and (with --profile) wall ms per frame-driver pass.
//
//   node scripts/sim-run.mjs --seed 1 --stars 700 --empires 10 --seconds 600 [--tech 0.5] [--pirates 1] [--profile]
//
// The TS sources are loaded through Vite's SSR module loader (vite is a devDependency; no build step).
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    if (i < 0) return fallback;
    const v = process.argv[i + 1];
    return v === undefined || v.startsWith('--') ? true : v;
}

const seed = Number(arg('seed', 1));
const stars = Number(arg('stars', 700));
const empires = Number(arg('empires', 10));
const seconds = Number(arg('seconds', 600));
const tech = Number(arg('tech', 0.5));
const pirates = Number(arg('pirates', 1));
const profile = arg('profile', false) === true;
const sectors = Math.max(4, Math.min(15, Math.round(Math.sqrt(stars / 4.7))));

const server = await createServer({ root, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true },
    // test/helpers/loadGameDataFs.ts (the Node game-data loader the tests use) reads __dirname, which the SSR loader lacks.
    define: { __dirname: JSON.stringify(resolve(root, 'test/helpers')) },
});
try {
    const { createGame } = await server.ssrLoadModule('/src/sim/game.ts');
    const { GalaxyShape } = await server.ssrLoadModule('/src/sim/types.ts');
    const { loadGameDataFs } = await server.ssrLoadModule('/test/helpers/loadGameDataFs.ts');
    const { runGameSeconds } = await server.ssrLoadModule('/src/sim/tick/harness.ts');
    const { stateDigest, stateCounts } = await server.ssrLoadModule('/src/sim/tick/digest.ts');

    const gameData = await loadGameDataFs();
    const s = (race) => ({ race, homeSystemFavourability: 'Normal', proximityDistance: 'Random', startLocation: '(Random)', age: 0, techLevel: tech });
    let t = performance.now();
    const game = createGame({
        seed, shape: GalaxyShape.Spiral, starCount: stars, sectorWidth: sectors, sectorHeight: sectors,
        systemNames: Array.from({ length: stars }, (_, i) => `S${i}`), gameData,
        player: s('Human'), aiEmpires: Array.from({ length: Math.max(0, empires - 1) }, () => s('(Random)')),
        piratePrevalence: pirates,
    });
    const createMs = performance.now() - t;
    const g = game.galaxy;
    console.log(`createGame: seed ${seed}, ${stars} stars (${sectors}x${sectors}), ${empires} empires — ${createMs.toFixed(0)} ms`);
    console.log('start digest', stateDigest(g), JSON.stringify(stateCounts(g)));
    t = performance.now();
    const r = runGameSeconds(g, seconds, profile ? { profileClock: () => performance.now() } : {});
    const runMs = performance.now() - t;
    console.log(`ran ${seconds} game-s: ${r.frames} frames in ${runMs.toFixed(0)} ms (${(runMs / r.frames).toFixed(3)} ms/frame), Rnd draws ${r.rndDraws}`);
    console.log('digest', stateDigest(g), JSON.stringify(stateCounts(g)));
    const hits = Object.entries(r.todoHits).sort((a, b) => b[1] - a[1]);
    console.log(`TODO(port) stubs reached: ${hits.length}`);
    for (const [k, v] of hits.slice(0, 25)) console.log(`  ${String(v).padStart(10)}  ${k}`);
    if (profile) {
        console.log('wall ms per pass:');
        for (const [k, v] of Object.entries(r.timings).sort((a, b) => b[1] - a[1])) console.log(`  ${v.toFixed(1).padStart(10)}  ${k}`);
    }
} finally {
    await server.close();
}
