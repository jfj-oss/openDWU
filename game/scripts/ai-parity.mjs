#!/usr/bin/env node
// 19s-1 AI PARITY AUDIT (tasks/19-mod-layer-scenarios.md §19s item 1): run the headless sim with the `ai-parity`
// scenario (every package mergeable on this build) with EVERY flag on (except the game-ending ones, --off), for N game
// years, sample the scenario states + the event log between chunks (src/sim/scenario/llm/parity.ts ParityAudit) and
// write tasks/AI-PARITY-<date>.md: one table of per-system AI usage and the "near-zero" list (the rule-tuning list).
//
//   nice -n 15 node --expose-gc scripts/ai-parity.mjs --years 5 --seed 1 [--stars 700] [--empires 10] [--chunk 60]
//        [--scenario ai-parity] [--off darkFarmsGameEnd,...] [--date YYYY-MM-DD] [--out path.md] [--no-write]
//
// Same bundling as scripts/sim-run.mjs (rolldown → temp ESM); the game options match its defaults (age 1, tech 0.5,
// pirates 1, spiral, Human player + random AIs). A chunk that throws is recorded and the run continues (soak mode).
import { build } from 'rolldown';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    if (i < 0) return fallback;
    const v = process.argv[i + 1];
    return v === undefined || v.startsWith('--') ? true : v;
}

const years = Number(arg('years', 5));
const seed = Number(arg('seed', 1));
const stars = Number(arg('stars', 700));
const empires = Number(arg('empires', 10));
const chunk = Number(arg('chunk', 60));
const scenarioId = String(arg('scenario', 'ai-parity'));
const date = String(arg('date', new Date().toISOString().slice(0, 10)));
const out = String(arg('out', resolve(root, `tasks/AI-PARITY-${date}.md`)));
const noWrite = arg('no-write', false) === true;
const sectors = Math.max(4, Math.min(15, Math.round(Math.sqrt(stars / 4.7))));

const MODULES = { game: '/src/sim/game.ts', types: '/src/sim/types.ts', load: '/test/helpers/loadGameDataFs.ts', harness: '/src/sim/tick/harness.ts',
    scenario: '/test/helpers/scenarioGame.ts', parity: '/src/sim/scenario/llm/parity.ts' };
const dirnameDefine = { __dirname: JSON.stringify(resolve(root, 'test/helpers')) };
const bundleDir = mkdtempSync(resolve(tmpdir(), 'dwu-ai-parity-'));
try {
    await build({ cwd: root, input: Object.fromEntries(Object.entries(MODULES).map(([k, v]) => [k, '.' + v])), platform: 'node', transform: { define: dirnameDefine },
        output: { dir: bundleDir, format: 'esm', preserveModules: true, preserveModulesRoot: root }, write: true, logLevel: 'warn' });
    const load = (key) => import(resolve(bundleDir, key + '.js'));
    const { createGame } = await load('game');
    const { GalaxyShape } = await load('types');
    const { loadGameDataFs } = await load('load');
    const { runGameSeconds } = await load('harness');
    const { scenarioGameData } = await load('scenario');
    const { ParityAudit, parityFlags, parityMarkdown, PARITY_DEFAULT_OFF } = await load('parity');

    const off = arg('off', null) === null ? [...PARITY_DEFAULT_OFF] : String(arg('off', '')).split(',').filter((x) => x !== '');
    const gameData = scenarioGameData(await loadGameDataFs(), scenarioId);
    const manifestFlags = gameData.scenario.manifest.flags;
    const flags = parityFlags(manifestFlags, off);
    const s = (race) => ({ race, homeSystemFavourability: 'Normal', proximityDistance: 'Random', startLocation: '(Random)', age: 1, techLevel: 0.5 });
    const t0 = performance.now();
    const game = createGame({
        seed, shape: GalaxyShape.Spiral, starCount: stars, sectorWidth: sectors, sectorHeight: sectors,
        systemNames: Array.from({ length: stars }, (_, i) => `S${i}`), gameData, galaxyAge: 1,
        player: s('Human'), aiEmpires: Array.from({ length: Math.max(0, empires - 1) }, () => s('(Random)')),
        piratePrevalence: 1, scenarioFlags: flags, scenarioParams: {},
    });
    const g = game.galaxy;
    const on = Object.entries(g.scenario.flags).filter(([, v]) => v).map(([k]) => k);
    console.log(`ai-parity: seed ${seed}, ${stars} stars, ${empires} empires, ${years} years, scenario ${scenarioId}: ${on.length} flags on (off: ${off.join(', ') || 'none'})`);
    const audit = new ParityAudit();
    audit.sample(g);
    const total = years * 600;
    let done = 0;
    let exceptions = 0;
    const exceptionLines = [];
    while (done < total) {
        const step = Math.min(chunk, total - done);
        try {
            runGameSeconds(game, step);
        } catch (e) {
            exceptions++;
            exceptionLines.push(`at ${done + step} s: ${String(e?.stack ?? e).split('\n').slice(0, 2).map((x) => x.trim()).join(' ').replace(/file:\/\/\S*?\/src\//g, 'src/')}`);
            console.log(`exception at ${done + step} s: ${String(e?.stack ?? e).split('\n').slice(0, 4).join(' | ')}`);
        }
        done += step;
        audit.sample(g);
        if (done % 600 === 0) console.log(`  year ${done / 600}: ${((performance.now() - t0) / 1000).toFixed(0)} s wall, ${g.empires.filter((e) => e?.active).length} empires active`);
    }
    const wallSeconds = (performance.now() - t0) / 1000;
    const md = parityMarkdown(audit.data(), { date, seed, years, stars, empires, scenario: scenarioId, flags: on, flagsOff: off, wallSeconds, exceptions, exceptionLines, samples: audit.samples });
    if (!noWrite) {
        writeFileSync(out, md);
        console.log(`wrote ${out}`);
    }
    console.log(md);
} finally {
    rmSync(bundleDir, { recursive: true, force: true });
}
