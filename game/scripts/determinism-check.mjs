#!/usr/bin/env node
// Cross-platform determinism check (docs/MULTIPLAYER.md "Cross-platform determinism check"): lockstep multiplayer needs
// the sim to run bit-for-bit the same on every client OS / CPU. This bundles scripts/determinism-check/runner.ts into
// one self-contained ESM file (rolldown; no npm packages, the scenarios/ overlays inlined), runs the cases on this
// machine and, with --remote, on another one over ssh, and compares the checkpoint streams line by line.
//
//   node scripts/determinism-check.mjs [--cases s1,s7,smart,script,replay] [--years 3] [--every 10] [--save-every 6]
//        [--data <DW:U folder>] [--runtime electron|node|both]
//        [--remote user@host --ssh-key ~/.ssh/key --remote-data '~/dwu-assets'
//         --remote-runtime /Applications/dwu.app/Contents/MacOS/dwu --remote-dir '~/opendwu-detcheck']
//        [--keep] [--out <dir>]
//   node scripts/determinism-check.mjs --compare a.txt b.txt
//
// --runtime electron = the repo's electron devDependency with ELECTRON_RUN_AS_NODE=1 (the release app's V8); the
// remote runtime is used the same way (an installed app's binary works). 'replay' replays the command log the
// 'script' case recorded on this machine (both are seed 1 with the scripted player orders, so their streams also
// match each other). The remote folder is created for the run and deleted afterwards (unless --keep).
import { build } from 'rolldown';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScenarioIndex } from './scenarioIndex.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    if (i < 0) return fallback;
    const v = process.argv[i + 1];
    return v === undefined || v.startsWith('--') ? true : v;
}

function compare(a, b, la = 'A', lb = 'B') {
    const rows = (t) => t.split('\n').filter((l) => l !== '' && !l.startsWith('#'));
    const ra = rows(a), rb = rows(b);
    const n = Math.min(ra.length, rb.length);
    for (let i = 0; i < n; i++) {
        // A save hash is printed on some rows only; compare the fields both rows have.
        const fa = ra[i].split(' '), fb = rb[i].split(' ');
        const k = Math.min(fa.length, fb.length);
        if (fa.slice(0, k).join(' ') !== fb.slice(0, k).join(' ')) return { ok: false, checked: i, first: `${la}: ${ra[i]}\n${lb}: ${rb[i]}` };
    }
    return { ok: ra.length === rb.length, checked: n, first: ra.length === rb.length ? null : `row counts differ: ${ra.length} vs ${rb.length}` };
}

if (arg('compare', null) !== null) {
    const i = process.argv.indexOf('--compare');
    const [fa, fb] = [process.argv[i + 1], process.argv[i + 2]];
    const r = compare(readFileSync(fa, 'utf8'), readFileSync(fb, 'utf8'), fa, fb);
    console.log(r.ok ? `match: ${r.checked} checkpoints` : `DIVERGED after ${r.checked} matching checkpoints:\n${r.first}`);
    process.exit(r.ok ? 0 : 1);
}

const cases = String(arg('cases', 's1,s7,smart,script,replay')).split(',');
const years = String(arg('years', '3'));
const every = String(arg('every', '10'));
const saveEvery = String(arg('save-every', '6'));
const data = resolve(String(arg('data', resolve(root, 'public/assets/dwu'))));
const runtime = String(arg('runtime', 'both'));
const remote = arg('remote', null);
const keep = arg('keep', false) === true;
const out = resolve(String(arg('out', mkdtempSync(resolve(tmpdir(), 'dwu-detcheck-')))));
mkdirSync(out, { recursive: true });

// --- Bundle. The scenario overlays (scenarios/<id>/: manifest + files) are inlined: the runner needs no repo checkout.
const scenariosRoot = resolve(root, 'scenarios');
const scenarios = buildScenarioIndex(scenariosRoot).scenarios.map((m) => ({
    manifest: m, files: Object.fromEntries(m.files.map((f) => [f, readFileSync(resolve(scenariosRoot, m.id, f), 'utf8')])),
}));
await build({
    cwd: root, input: resolve(root, 'scripts/determinism-check/runner.ts'), platform: 'node', logLevel: 'warn',
    transform: { define: { __SCENARIOS__: JSON.stringify(scenarios) } },
    output: { file: resolve(out, 'runner.mjs'), format: 'esm', codeSplitting: false }, write: true,
});
const bundle = resolve(out, 'runner.mjs');
console.log(`bundle ${bundle}`);

const electron = resolve(root, 'node_modules/.bin/electron');
const runtimes = runtime === 'both' ? ['electron', 'node'] : [runtime];
const caseArgs = (c, logFile) => ['--case', c, '--years', years, '--every', every, '--save-every', saveEvery, ...(c === 'script' ? ['--record', resolve(out, 'command-log.json')] : []), ...(c === 'replay' ? ['--log', logFile] : [])];

function runLocal(rt, c) {
    const file = resolve(out, `${c}.linux-${rt}.txt`);
    const cmd = rt === 'electron' ? electron : process.execPath;
    const env = { ...process.env, ...(rt === 'electron' ? { ELECTRON_RUN_AS_NODE: '1' } : {}) };
    return new Promise((done, fail) => {
        const p = spawn(cmd, ['--max-old-space-size=8192', bundle, '--data', data, ...caseArgs(c, resolve(out, 'command-log.json'))], { env, stdio: ['ignore', 'pipe', 'inherit'] });
        let text = '';
        p.stdout.on('data', (d) => { text += d; });
        p.on('exit', (code) => { writeFileSync(file, text); code === 0 ? done(file) : fail(new Error(`${rt} ${c} exited ${code}`)); });
    });
}

// Local runs first ('replay' needs the log 'script' records), all runtimes in parallel per case.
const results = new Map();
const ordered = [...cases.filter((c) => c !== 'replay'), ...cases.filter((c) => c === 'replay')];
for (const c of ordered) {
    if (c === 'replay' && !existsSync(resolve(out, 'command-log.json'))) throw new Error('the replay case needs the script case first');
    const files = await Promise.all(runtimes.map((rt) => runLocal(rt, c)));
    runtimes.forEach((rt, i) => results.set(`${c}.linux-${rt}`, files[i]));
    console.log(`ran ${c} on linux (${runtimes.join(', ')})`);
}

if (remote !== null) {
    const key = arg('ssh-key', null);
    const sshArgs = [...(key ? ['-i', String(key)] : []), '-o', 'ConnectTimeout=15'];
    const rdir = String(arg('remote-dir', '~/opendwu-detcheck'));
    const rdata = String(arg('remote-data', '~/dwu-assets'));
    const rrt = String(arg('remote-runtime', '/Applications/dwu.app/Contents/MacOS/dwu'));
    const ssh = (cmd) => execFileSync('ssh', [...sshArgs, String(remote), cmd], { encoding: 'utf8', maxBuffer: 1 << 28 });
    ssh(`mkdir -p ${rdir}`);
    execFileSync('scp', [...sshArgs, bundle, ...(existsSync(resolve(out, 'command-log.json')) ? [resolve(out, 'command-log.json')] : []), `${remote}:${rdir}/`]);
    try {
        const remoteRuns = ordered.map((c) => new Promise((done, fail) => {
            const cmd = `cd ${rdir} && ELECTRON_RUN_AS_NODE=1 ${rrt} --max-old-space-size=8192 runner.mjs --data ${rdata} ${caseArgs(c, 'command-log.json').map((a) => (a.startsWith('/') ? a.split('/').pop() : a)).join(' ')}`;
            const p = spawn('ssh', [...sshArgs, String(remote), cmd], { stdio: ['ignore', 'pipe', 'inherit'] });
            let text = '';
            p.stdout.on('data', (d) => { text += d; });
            p.on('exit', (code) => { const f = resolve(out, `${c}.remote.txt`); writeFileSync(f, text); code === 0 ? done([c, f]) : fail(new Error(`remote ${c} exited ${code}`)); });
        }));
        for (const [c, f] of await Promise.all(remoteRuns)) results.set(`${c}.remote`, f);
    } finally {
        if (!keep) ssh(`rm -rf ${rdir}`);
    }
}

// --- Compare: every stream of a case against the first, and script against replay.
let bad = 0, rows = 0;
for (const c of ordered) {
    const keys = [...results.keys()].filter((k) => k.startsWith(`${c}.`));
    const ref = keys[0];
    // The header lines: same data (content) and same detPow on every machine, or the comparison means little.
    const head = (k) => {
        const t = readFileSync(results.get(k), 'utf8');
        return { data: /data (\w+)/.exec(t)?.[1], det: /detPow (\w+)/.exec(t)?.[1], native: /native Math.pow (\w+)/.exec(t)?.[1], platform: /files\) (\S+)/.exec(t)?.[1] };
    };
    for (const k of keys) {
        const h = head(k), r = head(ref);
        const warn = h.data !== r.data ? ' DATA DIFFERS' : h.det !== r.det ? ' DETPOW DIFFERS' : '';
        if (warn) bad++;
        console.log(`  ${k}: ${h.platform} data ${h.data?.slice(0, 12)} detPow ${h.det} native pow ${h.native}${warn}`);
    }
    for (const k of keys.slice(1)) {
        const r = compare(readFileSync(results.get(ref), 'utf8'), readFileSync(results.get(k), 'utf8'), ref, k);
        // Plain Node (V8 12) vs Electron 44 (V8 15) is information only: their Math.sin / cos / atan2 / log ... differ
        // in the last bit (V8 15 took them from LLVM libc), so the games differ from the start. Only the same runtime
        // on two machines is the lockstep question.
        const info = k.endsWith('-node') !== ref.endsWith('-node');
        rows += info ? 0 : r.checked;
        if (!r.ok && !info) bad++;
        console.log(r.ok ? `${k} = ${ref}: ${r.checked} checkpoints match` : `${k} vs ${ref}: DIVERGED after ${r.checked} checkpoints${info ? ' (expected: different V8)' : ''}\n${r.first}`);
    }
}
if (results.has('script.linux-' + runtimes[0]) && results.has('replay.linux-' + runtimes[0])) {
    const strip = (t) => t.replace(/^(script|replay) /gm, '');
    const r = compare(strip(readFileSync(results.get('script.linux-' + runtimes[0]), 'utf8')), strip(readFileSync(results.get('replay.linux-' + runtimes[0]), 'utf8')), 'script', 'replay');
    if (!r.ok) bad++;
    console.log(r.ok ? `replay = live scripted run: ${r.checked} checkpoints match` : `replay vs live scripted run: DIVERGED after ${r.checked}\n${r.first}`);
}
console.log(`${bad === 0 ? 'ALL MATCH' : `${bad} MISMATCH(ES)`} (${rows} cross-runtime checkpoint comparisons); outputs in ${out}`);
process.exit(bad === 0 ? 0 : 1);
