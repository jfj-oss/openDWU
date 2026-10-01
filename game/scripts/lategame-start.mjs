#!/usr/bin/env node
// Late-game start repro / benchmark: build a galaxy from the New Game wizard's options (StartGameOptions →
// toCreateGameOptions → createGame), logging every createGame phase with wall time and heap, then optionally run it,
// save it (serializeGame) and load the save back (deserializeGame), timing each.
//
//   node --expose-gc scripts/lategame-start.mjs [--seed 1] [--stars-index 5] [--dim-index 4] [--empires 19]
//        [--expansion 4] [--your-size 4] [--seconds 0] [--save] [--quiet]
//
// Defaults = the reported crash: 1400 stars (index 5), 15x15 sectors (index 4), 20 empires (player + 19), Mature
// galaxy (Expansion 4) and Mature player empire (size 4).
import { build } from 'rolldown';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
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
const quiet = arg('quiet', false) === true;
const mb = (b) => (b / 1048576).toFixed(0) + 'MB';
let peak = 0;
const heapNow = () => { const h = process.memoryUsage().heapUsed; if (h > peak) peak = h; return h; };
const sampler = setInterval(heapNow, 50);
sampler.unref();

const MODULES = { game: '/src/sim/game.ts', sgo: '/src/sim/startGameOptions.ts', load: '/test/helpers/loadGameDataFs.ts',
    harness: '/src/sim/tick/harness.ts', save: '/src/sim/save/gameSave.ts', digest: '/src/sim/tick/digest.ts' };
const bundleDir = mkdtempSync(resolve(tmpdir(), 'dwu-lategame-'));
await build({ cwd: root, input: Object.fromEntries(Object.entries(MODULES).map(([k, v]) => [k, '.' + v])), platform: 'node',
    transform: { define: { __dirname: JSON.stringify(resolve(root, 'test/helpers')) } },
    output: { dir: bundleDir, format: 'esm', preserveModules: true, preserveModulesRoot: root }, write: true, logLevel: 'warn' });
const load = (key) => import(resolve(bundleDir, key + '.js'));
try {
    const { createGame } = await load('game');
    const { defaultStartGameOptions, toCreateGameOptions } = await load('sgo');
    const { loadGameDataFs } = await load('load');
    const { stateDigest } = await load('digest');
    const gameData = await loadGameDataFs();
    const so = defaultStartGameOptions();
    so.seed = seed;
    so.starCountIndex = Number(arg('stars-index', 5));
    so.dimensionIndex = Number(arg('dim-index', 4));
    so.otherEmpires.empireCount = Number(arg('empires', 19));
    so.galaxyExpansionIndex = Number(arg('expansion', 4));
    so.empireExpansionIndex = Number(arg('your-size', 4));
    so.raceName = 'Human';
    const opts = toCreateGameOptions(so, gameData, Array.from({ length: 2000 }, (_, i) => `S${i}`));
    console.log(`seed ${seed}: ${opts.starCount} stars, ${opts.sectorWidth}x${opts.sectorHeight}, ${1 + opts.aiEmpires.length} empires, galaxy age ${opts.galaxyAge}, AI ages ${opts.aiEmpires.map((e) => e.age).join(',')}`);
    const t0 = performance.now();
    let last = t0;
    opts.__phaseHook = (phase, galaxy, empire) => {
        const now = performance.now();
        if (!quiet && (now - last > 200 || !phase.startsWith('empire:') && !phase.startsWith('ships:')))
            console.log(`  +${(now - last).toFixed(0).padStart(6)}ms ${phase}${empire ? ' ' + empire.name : ''} heap ${mb(heapNow())}`);
        last = now;
    };
    const game = createGame(opts);
    const createMs = performance.now() - t0;
    const g = game.galaxy;
    const ships = g.empires.reduce((s, e) => s + e.builtObjects.length, 0);
    const colonies = g.empires.reduce((s, e) => s + e.colonies.length, 0);
    console.log(`createGame ${createMs.toFixed(0)} ms, heap after ${mb(heapNow())}; ${g.empires.length} empires, ${colonies} colonies, ${ships} ships/bases; digest ${stateDigest(g)}`);

    const seconds = Number(arg('seconds', 0));
    if (seconds > 0) {
        const { runGameSeconds } = await load('harness');
        const t = performance.now();
        for (let s = 0; s < seconds; s += 60) {
            runGameSeconds(g, Math.min(60, seconds - s));
            if (!quiet) console.log(`  ran ${s + 60}s game, ${(performance.now() - t).toFixed(0)} ms, heap ${mb(heapNow())}`);
        }
        console.log(`ran ${seconds}s in ${(performance.now() - t).toFixed(0)} ms`);
    }
    if (arg('save', false) === true) {
        const { serializeGame, deserializeGame } = await load('save');
        const { GalaxyTime } = await import(resolve(bundleDir, 'src/sim/galaxyTime.js'));
        globalThis.gc?.();
        peak = 0;
        let t = performance.now();
        const text = serializeGame(game, new GalaxyTime(), so);
        console.log(`serializeGame ${(performance.now() - t).toFixed(0)} ms, ${(text.length / 1048576).toFixed(1)}M chars, heap after ${mb(heapNow())} (rss ${mb(process.memoryUsage().rss)})`);
        const out = arg('save-out', null);
        if (out !== null) (await import('node:fs')).writeFileSync(String(out), text);
        if (arg('breakdown', false) === true) breakdown(JSON.parse(text));
        globalThis.gc?.();
        peak = 0;
        t = performance.now();
        const back = deserializeGame(text, gameData);
        console.log(`deserializeGame ${(performance.now() - t).toFixed(0)} ms, heap after ${mb(heapNow())} (rss ${mb(process.memoryUsage().rss)}); digest ${stateDigest(back.game.galaxy)}`);
    }
} finally {
    if (!process.env.KEEP) rmSync(bundleDir, { recursive: true, force: true });
}

/** Save size by owning class field: every byte of the JSON text is charged to the nearest enclosing {$t, $f} instance's
 *  field ({$s, $v} against the shape table, or the older {$t, $f}) (`Class.field`), or the top-level key outside the galaxy graph. Prints the largest. */
function breakdown(obj) {
    const by = new Map();
    const shapes = obj.galaxy.shapes ?? [];
    const add = (k, n) => by.set(k, (by.get(k) ?? 0) + n);
    const walk = (v, key) => {
        if (v === null || typeof v !== 'object') { const n = JSON.stringify(v)?.length ?? 4; add(key, n); return; }
        if (Array.isArray(v)) { add(key, 1 + v.length); for (const e of v) walk(e, key); return; }
        if (typeof v.$s === 'number' && Array.isArray(v.$v)) {
            const shape = shapes[v.$s];
            add(key, 14);
            v.$v.forEach((e, i) => { add(`${shape[0]}.${shape[i + 1]}`, 1); walk(e, `${shape[0]}.${shape[i + 1]}`); });
            return;
        }
        if (typeof v.$t === 'string' && v.$f) {
            add(key, 14 + v.$t.length);
            for (const f of Object.keys(v.$f)) { add(`${v.$t}.${f}`, f.length + 4); walk(v.$f[f], `${v.$t}.${f}`); }
            return;
        }
        for (const k of Object.keys(v)) { add(key, k.length + 4); walk(v[k], key); }
    };
    for (const k of Object.keys(obj)) if (k !== 'galaxy') walk(obj[k], k);
    for (const k of Object.keys(obj.galaxy)) walk(obj.galaxy[k], 'galaxy.' + k);
    const total = [...by.values()].reduce((a, b) => a + b, 0);
    console.log(`save breakdown (approx ${(total / 1048576).toFixed(1)}M chars):`);
    for (const [k, n] of [...by].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(`  ${(n / 1048576).toFixed(2).padStart(8)}M  ${k}`);
}
