#!/usr/bin/env node
// Profile the sim from a saved game (serializeGame text, e.g. from scripts/lategame-start.mjs --save --save-out): load it,
// optionally warm up, then run --seconds game seconds at --speed and print ms per sim step (wall and process CPU), the
// per-pass tick profile (setTickProfile) and the state digest (so a behaviour-preserving optimisation can be checked:
// the digest after the run must not change).
//
//   node [--cpu-prof --cpu-prof-dir=DIR] scripts/profile-save.mjs <save> [--warm 5] [--seconds 30] [--speed 1]
//        [--passes 25] [--keep-bundle DIR]
// Summarise a .cpuprofile with scripts/cpuprofile-summary.mjs <file> --under runGameSeconds.
import { build } from 'rolldown';
import { tmpdir } from 'node:os';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    if (i < 0) return fallback;
    const v = process.argv[i + 1];
    return v === undefined || v.startsWith('--') ? true : v;
}
const file = process.argv[2];
if (!file || file.startsWith('--')) throw new Error('usage: profile-save.mjs <save> [--seconds 30]');
const warm = Number(arg('warm', 5));
const seconds = Number(arg('seconds', 30));
const speed = Number(arg('speed', 1));
const nPasses = Number(arg('passes', 25));
const keepBundle = arg('keep-bundle', null);

const MODULES = { game: '/src/sim/game.ts', load: '/test/helpers/loadGameDataFs.ts', harness: '/src/sim/tick/harness.ts', save: '/src/sim/save/gameSave.ts', digest: '/src/sim/tick/digest.ts' };
const bundleDir = mkdtempSync(resolve(tmpdir(), 'dwu-profile-sim-'));
try {
    await build({ cwd: root, input: Object.fromEntries(Object.entries(MODULES).map(([k, v]) => [k, '.' + v])), platform: 'node',
        transform: { define: { __dirname: JSON.stringify(resolve(root, 'test/helpers')) } },
        output: { dir: bundleDir, format: 'esm', preserveModules: true, preserveModulesRoot: root }, write: true, logLevel: 'warn' });
    const load = (key) => import(resolve(bundleDir, key + '.js'));
    const { loadGameDataFs } = await load('load');
    const { runGameSeconds } = await load('harness');
    const { deserializeGame } = await load('save');
    const { stateDigest, stateCounts } = await load('digest');
    const { installGameStatics, registerGameHooks } = await load('game');
    const gameData = await loadGameDataFs();
    installGameStatics(gameData);
    registerGameHooks();
    const t0 = performance.now();
    const { game } = deserializeGame(readFileSync(file, 'utf8'), gameData);
    const g = game.galaxy;
    console.log(`loaded ${file} in ${(performance.now() - t0).toFixed(0)} ms: ${g.systems.length} systems, ${g.empires.length} empires, ${g.builtObjects.length} built objects; digest ${stateDigest(g)}`);
    if (warm > 0) runGameSeconds(game, warm, { speed });
    const cpu0 = process.cpuUsage();
    const w0 = performance.now();
    const r = runGameSeconds(game, seconds, { speed, profileClock: () => performance.now() });
    const wall = performance.now() - w0;
    const c = process.cpuUsage(cpu0);
    const cpu = (c.user + c.system) / 1000;
    console.log(`ran ${seconds} game s at ${speed}x: ${r.frames} steps, ${(wall / r.frames).toFixed(2)} wall ms/step, ${(cpu / r.frames).toFixed(2)} cpu ms/step (${(wall / 1000).toFixed(1)} s wall)`);
    const total = Object.values(r.timings).reduce((a, b) => a + b, 0);
    console.log(`tick passes (wall, ${total.toFixed(0)} ms total, may nest):`);
    for (const [k, v] of Object.entries(r.timings).sort((a, b) => b[1] - a[1]).slice(0, nPasses))
        console.log(`  ${v.toFixed(0).padStart(7)} ms ${((100 * v) / wall).toFixed(1).padStart(5)}%  ${(v / r.frames).toFixed(3)} ms/step  ${k}`);
    console.log(`digest ${stateDigest(g)} rnd ${g.rnd.drawCount} counts ${JSON.stringify(stateCounts(g))}`);
} finally {
    if (keepBundle) cpSync(bundleDir, String(keepBundle), { recursive: true });
    rmSync(bundleDir, { recursive: true, force: true });
}
