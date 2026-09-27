#!/usr/bin/env node
// Sim profiling / perf-regression harness (built from scripts/ai-parity.mjs): headless createGame + runGameSeconds with
// the `ai-parity` scenario (every mergeable package, every flag on except the game-ending ones) — the configuration of
// the long soaks — then print wall time, game-days per wall minute, the state digest (src/sim/tick/digest.ts) and a
// full-save hash (sha256 of galaxyToJSON), so a behaviour-preserving optimisation can be checked byte-for-byte.
//
//   node [--cpu-prof --cpu-prof-dir=DIR] [--heap-prof --heap-prof-dir=DIR] scripts/profile-sim.mjs
//        [--seed 1] [--stars 700] [--empires 10] [--seconds 600] [--chunk 60] [--scenario ai-parity | --plain]
//        [--off darkFarmsGameEnd,...] [--no-save-hash] [--json out.json] [--keep-bundle DIR]
//
// Summarise a .cpuprofile with scripts/cpuprofile-summary.mjs.
import { build } from 'rolldown';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
const chunk = Number(arg('chunk', 60));
const plain = arg('plain', false) === true;
const scenarioId = String(arg('scenario', 'ai-parity'));
const saveHash = arg('no-save-hash', false) !== true;
const jsonOut = arg('json', null);
const keepBundle = arg('keep-bundle', null); // copy the bundle here (line numbers of --cpu-prof refer to it)
const sectors = Math.max(4, Math.min(15, Math.round(Math.sqrt(stars / 4.7))));

/** sha256 of JSON.stringify(v) (same bytes), streamed: a 4000-star save is longer than V8's maximum string. */
function hashJson(v) {
    const h = createHash('sha256');
    let buf = '';
    const put = (x) => { buf += x; if (buf.length > 1 << 20) { h.update(buf); buf = ''; } };
    const walk = (x) => {
        if (x !== null && typeof x === 'object' && typeof x.toJSON === 'function') x = x.toJSON();
        if (Array.isArray(x)) {
            put('[');
            for (let i = 0; i < x.length; i++) { if (i > 0) put(','); const e = x[i]; if (e === undefined || typeof e === 'function') put('null'); else walk(e); }
            put(']');
        } else if (x !== null && typeof x === 'object') {
            put('{');
            let first = true;
            for (const k of Object.keys(x)) {
                const e = x[k];
                if (e === undefined || typeof e === 'function') continue;
                if (!first) put(',');
                first = false;
                put(JSON.stringify(k) + ':');
                walk(e);
            }
            put('}');
        } else put(JSON.stringify(x) ?? 'null');
    };
    walk(v);
    h.update(buf);
    return h.digest('hex').slice(0, 16);
}

const MODULES = { game: '/src/sim/game.ts', types: '/src/sim/types.ts', load: '/test/helpers/loadGameDataFs.ts', harness: '/src/sim/tick/harness.ts',
    scenario: '/test/helpers/scenarioGame.ts', parity: '/src/sim/scenario/llm/parity.ts', digest: '/src/sim/tick/digest.ts', save: '/src/sim/save/galaxySave.ts' };
const dirnameDefine = { __dirname: JSON.stringify(resolve(root, 'test/helpers')) };
const bundleDir = mkdtempSync(resolve(tmpdir(), 'dwu-profile-sim-'));
try {
    await build({ cwd: root, input: Object.fromEntries(Object.entries(MODULES).map(([k, v]) => [k, '.' + v])), platform: 'node', transform: { define: dirnameDefine },
        output: { dir: bundleDir, format: 'esm', preserveModules: true, preserveModulesRoot: root }, write: true, logLevel: 'warn' });
    const load = (key) => import(resolve(bundleDir, key + '.js'));
    const { createGame } = await load('game');
    const { GalaxyShape } = await load('types');
    const { loadGameDataFs } = await load('load');
    const { runGameSeconds } = await load('harness');
    const { scenarioGameData } = await load('scenario');
    const { parityFlags, PARITY_DEFAULT_OFF } = await load('parity');
    const { stateDigest, stateCounts } = await load('digest');
    const { galaxyToJSON } = await load('save');

    let gameData = await loadGameDataFs();
    let scenarioOpts = {};
    if (!plain) {
        gameData = scenarioGameData(gameData, scenarioId);
        const off = arg('off', null) === null ? [...PARITY_DEFAULT_OFF] : String(arg('off', '')).split(',').filter((x) => x !== '');
        scenarioOpts = { scenarioFlags: parityFlags(gameData.scenario.manifest.flags, off), scenarioParams: {} };
    }
    const s = (race) => ({ race, homeSystemFavourability: 'Normal', proximityDistance: 'Random', startLocation: '(Random)', age: 1, techLevel: 0.5 });
    const tc = performance.now();
    const game = createGame({
        seed, shape: GalaxyShape.Spiral, starCount: stars, sectorWidth: sectors, sectorHeight: sectors,
        systemNames: Array.from({ length: stars }, (_, i) => `S${i}`), gameData, galaxyAge: 1,
        player: s('Human'), aiEmpires: Array.from({ length: Math.max(0, empires - 1) }, () => s('(Random)')),
        piratePrevalence: 1, ...scenarioOpts,
    });
    const createMs = performance.now() - tc;
    const g = game.galaxy;
    console.log(`profile-sim: seed ${seed}, ${stars} stars, ${empires} empires, ${seconds} s, ${plain ? 'no scenario' : `scenario ${scenarioId}`}; createGame ${(createMs / 1000).toFixed(1)} s`);
    const cpu0 = process.cpuUsage();
    const t0 = performance.now();
    let done = 0;
    const chunks = [];
    while (done < seconds) {
        const step = Math.min(chunk, seconds - done);
        const tc0 = performance.now();
        try {
            runGameSeconds(game, step);
        } catch (e) {
            console.log(`exception at ${done + step} s: ${String(e?.stack ?? e).split('\n').slice(0, 4).join(' | ')}`);
        }
        done += step;
        chunks.push(Math.round(performance.now() - tc0));
        if (done % 600 === 0 || done === seconds) console.log(`  ${done} s (day ${(done * 0.6).toFixed(0)}): ${((performance.now() - t0) / 1000).toFixed(1)} s wall`);
    }
    const runMs = performance.now() - t0;
    const cpu = process.cpuUsage(cpu0);
    const cpuMs = (cpu.user + cpu.system) / 1000;
    const digest = stateDigest(g);
    const save = saveHash ? hashJson(galaxyToJSON(g)) : null;
    const days = seconds * 0.6; // 360 days per 600 s game year (Galaxy.3.cs RealSecondsInGalacticYear)
    console.log(`run: ${(runMs / 1000).toFixed(2)} s wall, ${(cpuMs / 1000).toFixed(2)} s cpu (${((100 * cpuMs) / runMs).toFixed(0)}% of a core), ${((days * 60000) / runMs).toFixed(0)} game-days/min`);
    console.log(`chunk ms: ${chunks.join(' ')}`);
    console.log(`digest ${digest} save ${save ?? '-'} rnd ${g.rnd.drawCount} counts ${JSON.stringify(stateCounts(g))}`);
    if (jsonOut) writeFileSync(String(jsonOut), JSON.stringify({ seed, stars, empires, seconds, plain, createMs, runMs, cpuMs, digest, save, chunks }, null, 1));
} finally {
    if (keepBundle) cpSync(bundleDir, String(keepBundle), { recursive: true });
    rmSync(bundleDir, { recursive: true, force: true });
}
