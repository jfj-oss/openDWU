#!/usr/bin/env node
// Determinism gate for a browser session (docs/sim-worker.md §5): seed + the session's command log, replayed headless
// in node, must give the game the session ended with — the same state digest and the same save text.
//
//   node scripts/simworker-replay-check.mjs <session.json> <session.dwusave>
//
// <session.json> is written by scripts/simworker-campaign.mjs: the createGame options the page posted to the worker
// (`init` message, boot kind 'create'; tagged JSON, see `decode`), and the worker's digest / nowMs taken right after
// the save. <session.dwusave> is that save (it carries the command log). The replay runs createGame({ ...options,
// seed }) + replayCommandLog until the save's nowMs, then serializes with the save's clock and start options, and
// compares: the digest, the whole save text, and on a difference the first differing `galaxy` / `commandLog` paths.
import { build } from 'rolldown';
import { tmpdir } from 'node:os';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [sessionFile, saveFile] = process.argv.slice(2);
if (!sessionFile || !saveFile) throw new Error('usage: simworker-replay-check.mjs <session.json> <session.dwusave>');

/** Tagged JSON (the campaign's `encode`): undefined, non-finite numbers, -0, Map, Set, typed arrays. */
function decode(v) {
    if (Array.isArray(v)) return v.map(decode);
    if (v === null || typeof v !== 'object') return v;
    if ('$u' in v) return undefined;
    if ('$n' in v) return v.$n === '-0' ? -0 : Number(v.$n);
    if ('$map' in v) return new Map(v.$map.map(([k, x]) => [decode(k), decode(x)]));
    if ('$set' in v) return new Set(v.$set.map(decode));
    if ('$ta' in v) return new globalThis[v.$ta](v.v);
    if ('$cls' in v) throw new Error(`a ${v.$cls} instance in the captured options: not plain data`);
    const o = {};
    for (const [k, x] of Object.entries(v)) {
        // A class instance's own fields (the campaign names its class; reviveCreateOptions rebuilds the known ones).
        if (k === '$plainOf') continue;
        const d = decode(x);
        if (d !== undefined || (x && typeof x === 'object' && '$u' in x)) o[k] = d;
    }
    return o;
}

/** The first differences between two parsed save trees, named by `Class.field` through the save's shapes (graphCodec
 *  instances are {$s: shape index, $v: values}), at most `max`. */
function firstDiffs(a, b, shapesA, shapesB, path = '$', out = [], max = 16) {
    if (out.length >= max || Object.is(a, b)) return out;
    if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
        out.push(`${path}: ${JSON.stringify(a)?.slice(0, 100)} ≠ ${JSON.stringify(b)?.slice(0, 100)}`);
        return out;
    }
    if (Array.isArray(a) !== Array.isArray(b)) return out.push(`${path}: array / object`), out;
    if (Array.isArray(a)) {
        if (a.length !== b.length) out.push(`${path}: length ${a.length} ≠ ${b.length}`);
        for (let i = 0; i < Math.min(a.length, b.length) && out.length < max; i++) firstDiffs(a[i], b[i], shapesA, shapesB, `${path}[${i}]`, out, max);
        return out;
    }
    if ('$s' in a && '$s' in b && Array.isArray(a.$v) && shapesA) {
        const sa = shapesA[a.$s], sb = shapesB[b.$s];
        if (JSON.stringify(sa) !== JSON.stringify(sb)) return out.push(`${path}: shape ${JSON.stringify(sa).slice(0, 200)} ≠ ${JSON.stringify(sb).slice(0, 200)}`), out;
        for (let i = 0; i < a.$v.length && out.length < max; i++) firstDiffs(a.$v[i], b.$v[i], shapesA, shapesB, `${path}/${sa[0]}.${sa[i + 1]}`, out, max);
        return out;
    }
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
        if (out.length >= max) break;
        if (!(k in a) || !(k in b)) out.push(`${path}.${k}: ${k in a ? 'only in the session' : 'only in the replay'}`);
        else firstDiffs(a[k], b[k], shapesA, shapesB, `${path}.${k}`, out, max);
    }
    return out;
}

const MODULES = {
    game: '/src/sim/game.ts',
    load: '/test/helpers/loadGameDataFs.ts',
    save: '/src/sim/save/gameSave.ts',
    commands: '/src/sim/player/playerCommands.ts',
    boot: '/src/simworker/bootOptions.ts',
    digest: '/src/sim/tick/digest.ts',
    galaxyTime: '/src/sim/galaxyTime.ts',
};
const bundleDir = mkdtempSync(resolve(tmpdir(), 'dwu-replay-check-'));
let failed = 0;
const check = (ok, what) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok) failed++;
};
try {
    await build({ cwd: root, input: Object.fromEntries(Object.entries(MODULES).map(([k, v]) => [k, '.' + v])), platform: 'node',
        transform: { define: { __dirname: JSON.stringify(resolve(root, 'test/helpers')) } },
        output: { dir: bundleDir, format: 'esm', preserveModules: true, preserveModulesRoot: root }, write: true, logLevel: 'warn' });
    const load = (key) => import(resolve(bundleDir, key + '.js'));
    const { loadGameDataFs } = await load('load');
    const { serializeGame, deserializeGame } = await load('save');
    const { replayCommandLog } = await load('commands');
    const { reviveCreateOptions } = await load('boot');
    const { stateDigest } = await load('digest');
    const { GalaxyTime } = await load('galaxyTime');
    const session = JSON.parse(readFileSync(sessionFile, 'utf8'));
    const text = readFileSync(saveFile, 'utf8');
    const save = JSON.parse(text);
    const gameData = await loadGameDataFs();
    const log = save.commandLog ?? [];
    const ops = log.filter((e) => e.source === 'player').map((e) => e.op);
    const counts = {};
    for (const op of ops) counts[op] = (counts[op] ?? 0) + 1;
    console.log(`session: ${log.length} log entries, ${ops.length} player commands: ${Object.entries(counts).map(([k, n]) => `${k}×${n}`).join(', ')}`);
    // The saved game's own state, as a load sees it (its digest must be the worker's at the save).
    const loaded = deserializeGame(text, gameData).game;
    const untilMs = loaded.galaxy.nowMs;
    const savedDigest = stateDigest(loaded.galaxy);
    if (session.digest) check(savedDigest === session.digest, `the save loads to the worker's digest at the save (${savedDigest.slice(0, 16)}; nowMs ${untilMs})`);
    const raw = decode(session.options);
    const { seed, ...rest } = reviveCreateOptions(raw, gameData);
    const t0 = performance.now();
    const warnings = [];
    const game = replayCommandLog(seed, rest, log, untilMs, (m) => warnings.push(m));
    console.log(`replayed seed ${seed} + ${log.length} entries to ${untilMs} ms in ${((performance.now() - t0) / 1000).toFixed(1)} s${warnings.length ? `; warnings: ${warnings.join(' | ')}` : ''}`);
    check(game.galaxy.nowMs === untilMs, `the replay stops at the save's instant (${game.galaxy.nowMs} / ${untilMs})`);
    const digest = stateDigest(game.galaxy);
    check(digest === savedDigest, `replay digest = session digest (${digest.slice(0, 16)} / ${savedDigest.slice(0, 16)})`);
    const time = new GalaxyTime();
    time.bindGalaxy(game.galaxy);
    time.speed = save.time.speed;
    time.paused = save.time.paused;
    const replayText = serializeGame(game, time, save.startOptions);
    const same = replayText === text;
    check(same, `replay save text = session save text (${(text.length / 1024).toFixed(0)} KB)`);
    if (!same) {
        const r = JSON.parse(replayText);
        for (const d of firstDiffs(save.galaxy, r.galaxy, save.galaxy.shapes, r.galaxy.shapes, 'galaxy')) console.log(`     ${d.length > 400 ? `…${d.slice(-400)}` : d}`);
        for (const d of firstDiffs({ ...save, galaxy: null }, { ...r, galaxy: null }, null, null)) console.log(`     ${d.length > 400 ? `…${d.slice(-400)}` : d}`);
        writeFileSync(`${saveFile}.replay`, replayText);
        console.log(`     replay save written to ${saveFile}.replay`);
    }
} finally {
    rmSync(bundleDir, { recursive: true, force: true });
}
console.log(failed === 0 ? 'REPLAY OK' : `REPLAY FAILED (${failed})`);
process.exitCode = failed === 0 ? 0 : 1;
