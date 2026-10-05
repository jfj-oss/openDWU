#!/usr/bin/env node
// Memory probe for a big save: boots it in headless Chromium against a running dev server, runs the game at --speed for
// --secs, then prints the JS heap of the page and of the sim worker (CDP Runtime.getHeapUsage), each Chromium process's
// RSS/PSS (/proc, by --type), the Pixi scene graph (display objects by constructor, how many are renderable/visible),
// the GPU textures Pixi manages (bytes by kind) and, with --snapshot=DIR, a heap snapshot of the page and the worker
// (DIR/page.heapsnapshot, DIR/worker.heapsnapshot; summarise them with scripts/heapsnapshot-summary.mjs).
//   node scripts/mem-probe.mjs <base url> --load=/dev-saves/x.dwusave [--inthread] [--secs=60] [--speed=4]
//        [--snapshot=DIR] [--w=1920 --h=1080] [--json=<file>]
// Pure CDP over the browser's WebSocket (no Playwright), so dedicated workers can be attached (Target.setAutoAttach).
import { spawn } from 'node:child_process';
import { mkdtempSync, openSync, writeSync, closeSync, readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = (process.argv[2] ?? 'http://localhost:5173/').replace(/\/$/, '');
const opt = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const inThread = process.argv.includes('--inthread');
const load = opt('load', '');
const secs = Number(opt('secs', '60'));
const speed = Number(opt('speed', '4'));
const snapDir = opt('snapshot', '');
const W = Number(opt('w', '1920'));
const H = Number(opt('h', '1080'));

const profileDir = mkdtempSync(join(tmpdir(), 'dwu-memprobe-'));
const dbgPort = 9200 + Math.floor(Math.random() * 400);
const chrome = spawn(process.env.CHROMIUM || '/usr/bin/chromium', [
    '--headless=new', `--remote-debugging-port=${dbgPort}`, `--user-data-dir=${profileDir}`, `--window-size=${W},${H}`,
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info',
    '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let wsUrl = null;
await new Promise((res, rej) => {
    chrome.stderr.on('data', (d) => {
        const m = /DevTools listening on (ws:\/\/\S+)/.exec(String(d));
        if (m && wsUrl === null) { wsUrl = m[1]; res(); }
    });
    chrome.on('exit', (c) => rej(new Error(`chromium exited ${c}`)));
});

const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let nextId = 1;
const pending = new Map();
const listeners = new Set();
ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== undefined) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) p.rej(new Error(`${p.method}: ${msg.error.message}`)); else p.res(msg.result);
    } else for (const l of listeners) l(msg);
});
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const id = nextId++;
    pending.set(id, { res, rej, method });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});

const { targetInfos } = await send('Target.getTargets');
const pageTarget = targetInfos.find((t) => t.type === 'page');
const { sessionId: pageS } = await send('Target.attachToTarget', { targetId: pageTarget.targetId, flatten: true });
let workerS = null;
listeners.add((m) => {
    if (m.method === 'Target.attachedToTarget' && m.params.targetInfo.type === 'worker') {
        const ti = m.params.targetInfo;
        if (process.argv.includes('--verbose')) console.log(`worker target: ${ti.title} ${ti.url}`);
        // The sim worker (workerClient.ts: name 'dwu-sim', src/simworker/worker.ts), not the art loader's.
        if (/dwu-sim|simworker/.test(`${ti.title} ${ti.url}`)) workerS = m.params.sessionId;
        void send('Runtime.runIfWaitingForDebugger', {}, m.params.sessionId).catch(() => {});
    }
    if (m.method === 'Runtime.exceptionThrown' && m.sessionId === pageS) console.log(`[pageerror] ${m.params.exceptionDetails?.exception?.description?.split('\n')[0] ?? m.params.exceptionDetails?.text}`);
});
await send('Runtime.enable', {}, pageS);
await send('Page.enable', {}, pageS);
await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, pageS);

const evaluate = async (expression, s = pageS) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, s);
    if (r.exceptionDetails) throw new Error(`evaluate: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mb = (b) => `${(b / 1048576).toFixed(0)} MB`;

const url = `${base}/?${load ? `load=${encodeURIComponent(load)}` : 'autostart=1'}&simWorker=${inThread ? 0 : 1}`;
const t0 = Date.now();
await send('Page.navigate', { url }, pageS);
for (;;) {
    await sleep(1000);
    const ok = await evaluate('!!(window.__dwu?.game?.playerEmpire && window.__dwu?.time)').catch(() => false);
    if (ok) break;
    if (Date.now() - t0 > 900000) throw new Error('game did not boot');
}
console.log(`booted in ${((Date.now() - t0) / 1000).toFixed(0)} s (${inThread ? 'in-thread' : 'worker'}), worker session: ${workerS !== null}`);
await sleep(3000);

function procTree() {
    const kids = new Map();
    for (const d of readdirSync('/proc')) {
        if (!/^\d+$/.test(d)) continue;
        try {
            const st = readFileSync(`/proc/${d}/stat`, 'utf8');
            const ppid = Number(st.slice(st.lastIndexOf(')') + 2).split(' ')[1]);
            if (!kids.has(ppid)) kids.set(ppid, []);
            kids.get(ppid).push(Number(d));
        } catch { /* gone */ }
    }
    const out = [];
    const walk = (p) => { out.push(p); for (const c of kids.get(p) ?? []) walk(c); };
    walk(chrome.pid);
    return out;
}
function rss() {
    const by = {};
    for (const pid of procTree()) {
        try {
            const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split(/[\0 ]/);
            const type = (cmd.find((a) => a.startsWith('--type=')) ?? '--type=browser').slice(7) + (cmd.some((a) => a.includes('--utility-sub-type=network')) ? ':net' : '');
            const roll = readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
            const kb = (k) => Number(new RegExp(`^${k}:\\s+(\\d+)`, 'm').exec(roll)?.[1] ?? 0) * 1024;
            const e = (by[type] ??= { n: 0, rss: 0, pss: 0, maxRss: 0 });
            e.n++; e.rss += kb('Rss'); e.pss += kb('Pss'); e.maxRss = Math.max(e.maxRss, kb('Rss'));
        } catch { /* gone */ }
    }
    return by;
}

const pageStats = `(async () => {
    const d = window.__dwu;
    const out = { mem: performance.memory ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize, limit: performance.memory.jsHeapSizeLimit } : null };
    out.coi = self.crossOriginIsolated;
    const g = d.game.galaxy;
    out.galaxy = { systems: g.systems?.length, habitats: g.habitats?.length, builtObjects: g.builtObjects?.length, creatures: g.creatures?.length, date: d.time?.date ?? null };
    // Scene graph census.
    const byCtor = new Map();
    let n = 0, vis = 0, rend = 0, worldVisible = 0;
    const walk = (o, parentVis) => {
        n++;
        const v = parentVis && o.visible !== false && o.renderable !== false && o.alpha !== 0;
        if (o.visible) vis++;
        if (v) worldVisible++;
        const k = o.constructor?.name ?? '?';
        const e = byCtor.get(k) ?? { n: 0, live: 0 };
        e.n++; if (v) e.live++;
        byCtor.set(k, e);
        for (const c of o.children ?? []) walk(c, v);
    };
    walk(d.app.stage, true);
    out.scene = { n, vis, worldVisible, byCtor: [...byCtor].sort((a, b) => b[1].n - a[1].n).slice(0, 25) };
    // GPU textures Pixi manages.
    const tex = d.app.renderer.texture;
    const srcs = tex?.managedTextures ?? [];
    const byKind = new Map();
    let gpuBytes = 0;
    for (const s of srcs) {
        if (!s) continue;
        const b = (s.pixelWidth ?? s.width) * (s.pixelHeight ?? s.height) * 4 * (s.autoGenerateMipmaps ? 4 / 3 : 1);
        gpuBytes += b;
        const res = s.resource;
        const kind = s.constructor.name + ':' + (res?.constructor?.name ?? 'none');
        const e = byKind.get(kind) ?? { n: 0, bytes: 0 };
        e.n++; e.bytes += b;
        byKind.set(kind, e);
    }
    out.gpu = { textures: srcs.length, bytes: gpuBytes, byKind: [...byKind].sort((a, b) => b[1].bytes - a[1].bytes) };
    if (typeof performance.measureUserAgentSpecificMemory === 'function' && self.crossOriginIsolated) {
        try { const m = await performance.measureUserAgentSpecificMemory(); out.uasm = m.bytes; } catch (e) { out.uasm = String(e); }
    }
    return out;
})()`;

// Chromium's memory-infra dump (as chrome://tracing's): per process, the size of each top-level allocator (malloc,
// partition_alloc (blink's array buffers / strings / DOM), v8, skia, cc, gpu, ...), and the biggest sub-allocators.
async function memoryDump() {
    const events = [];
    const onData = (m) => { if (m.method === 'Tracing.dataCollected') events.push(...m.params.value); };
    listeners.add(onData);
    const complete = new Promise((r) => { const l = (m) => { if (m.method === 'Tracing.tracingComplete') { listeners.delete(l); r(); } }; listeners.add(l); });
    await send('Tracing.start', { traceConfig: { includedCategories: ['disabled-by-default-memory-infra'], excludedCategories: ['*'], memoryDumpConfig: { triggers: [] } }, transferMode: 'ReportEvents' });
    await sleep(500);
    await send('Tracing.requestMemoryDump', { deterministic: true, levelOfDetail: 'detailed' }).catch((e) => console.log(`memory dump: ${e.message}`));
    await send('Tracing.end');
    await complete;
    listeners.delete(onData);
    const names = new Map();
    for (const e of events) if (e.ph === 'M' && e.name === 'process_labels' || e.name === 'process_name') names.set(e.pid, `${names.get(e.pid) ?? ''}${e.args?.name ?? e.args?.labels ?? ''}`);
    const out = [];
    for (const e of events) {
        if (e.ph !== 'v' || !e.args?.dumps?.allocators) continue;
        const a = e.args.dumps.allocators;
        const size = (d) => (d?.attrs?.size ? parseInt(d.attrs.size.value, 16) : 0);
        const top = Object.entries(a).filter(([k]) => !k.includes('/')).map(([k, d]) => [k, size(d)]).sort((x, y) => y[1] - x[1]);
        const sub = Object.entries(a).filter(([k]) => k.split('/').length === 2 || /^(partition_alloc\/partitions\/|v8\/main\/heap\/|v8\/workers\/|malloc\/|blink_objects|canvas|skia\/sk_resource_cache|gpu\/)/.test(k) && k.split('/').length <= 4)
            .map(([k, d]) => [k, size(d)]).filter(([, v]) => v > 8 * 1048576).sort((x, y) => y[1] - x[1]).slice(0, 25);
        const total = e.args.dumps.process_totals ? parseInt(e.args.dumps.process_totals.resident_set_bytes ?? '0', 16) : 0;
        out.push({ pid: e.pid, name: names.get(e.pid) ?? '?', rss: total, top, sub });
    }
    for (const p of out.sort((x, y) => y.rss - x.rss)) {
        if (p.rss < 64 * 1048576 && p.top.every(([, v]) => v < 64 * 1048576)) continue;
        console.log(`  [memory-infra] pid ${p.pid} ${p.name}: resident ${mb(p.rss)}`);
        console.log(`    ${p.top.filter(([, v]) => v > 1048576).map(([k, v]) => `${k} ${mb(v)}`).join(', ')}`);
        for (const [k, v] of p.sub) console.log(`      ${k.padEnd(60)} ${mb(v)}`);
    }
    return out;
}

async function report(label) {
    const p = await send('Runtime.getHeapUsage', {}, pageS);
    const w = workerS ? await send('Runtime.getHeapUsage', {}, workerS).catch(() => null) : null;
    const s = await evaluate(pageStats);
    const r = rss();
    console.log(`\n=== ${label}`);
    console.log(`galaxy ${JSON.stringify(s.galaxy)}`);
    console.log(`page heap used ${mb(p.usedSize)} / total ${mb(p.totalSize)}${w ? `; worker heap used ${mb(w.usedSize)} / total ${mb(w.totalSize)}` : ''}${s.uasm ? `; UASM ${mb(s.uasm)}` : ''}`);
    for (const [k, v] of Object.entries(r)) console.log(`  proc ${k.padEnd(12)} x${v.n} rss ${mb(v.rss)} pss ${mb(v.pss)} (max ${mb(v.maxRss)})`);
    console.log(`scene: ${s.scene.n} display objects, ${s.scene.worldVisible} drawn`);
    for (const [k, v] of s.scene.byCtor) console.log(`  ${k.padEnd(24)} ${String(v.n).padStart(8)} (${v.live} drawn)`);
    console.log(`gpu textures: ${s.gpu.textures}, ~${mb(s.gpu.bytes)}`);
    for (const [k, v] of s.gpu.byKind) console.log(`  ${k.padEnd(40)} ${String(v.n).padStart(6)} ${mb(v.bytes)}`);
    const dump = process.argv.includes('--dump') ? await memoryDump() : null;
    return { label, pageHeap: p, workerHeap: w, rss: r, stats: s, dump };
}

const results = [];
results.push(await report('booted'));
await evaluate(`(() => { const t = window.__dwu.time; t.speed = ${speed}; t.paused = false; })()`);
for (let t = 0; t < secs; t += 10) {
    await sleep(Math.min(10, secs - t) * 1000);
    const p = await send('Runtime.getHeapUsage', {}, pageS);
    const w = workerS ? await send('Runtime.getHeapUsage', {}, workerS).catch(() => null) : null;
    const r = rss();
    const total = Object.values(r).reduce((a, v) => a + v.rss, 0);
    console.log(`t+${t + 10}s page ${mb(p.usedSize)}${w ? ` worker ${mb(w.usedSize)}` : ''} renderer rss ${mb(r.renderer?.rss ?? 0)} gpu rss ${mb(r.gpu?.rss ?? r['gpu-process']?.rss ?? 0)} all ${mb(total)}`);
}
await evaluate(`(() => { window.__dwu.time.paused = true; })()`);
await sleep(2000);
results.push(await report(`after ${secs}s at ${speed}x`));
for (const s of [pageS, workerS]) if (s) await send('HeapProfiler.collectGarbage', {}, s).catch(() => {});
await sleep(1000);
results.push(await report('after GC'));

// --save: run the game's save (window.__dwu.serialize: the worker's in worker mode) and sample the heaps and the renderer
// RSS every 250 ms while it runs (the peak is what kills a big game's autosave).
if (process.argv.includes('--save')) {
    let peak = { page: 0, worker: 0, rss: 0 };
    let done = false;
    const ts = Date.now();
    const sampler = (async () => {
        while (!done) {
            const [p, w] = await Promise.all([
                send('Runtime.getHeapUsage', {}, pageS).catch(() => null),
                workerS ? send('Runtime.getHeapUsage', {}, workerS).catch(() => null) : null,
            ]);
            const r = rss();
            if (process.argv.includes('--verbose')) console.log(`  save t+${((Date.now() - ts) / 1000).toFixed(1)}s page ${mb(p?.usedSize ?? 0)} worker ${mb(w?.usedSize ?? 0)} renderer rss ${mb(r.renderer?.rss ?? 0)}`);
            peak.page = Math.max(peak.page, p?.usedSize ?? 0);
            peak.worker = Math.max(peak.worker, w?.usedSize ?? 0);
            peak.rss = Math.max(peak.rss, r.renderer?.rss ?? 0);
            await sleep(250);
        }
    })();
    // Serialize, then write it to the save store and read it back (the autosave's path: ui/autosave.ts writeAutosave).
    const len = await evaluate(`(async () => {
        try {
            const t = await window.__dwu.serialize();
            if (t == null) return null;
            const store = (await import('/src/ui/screens/saveLoad.ts')).defaultSaveTextStore();
            await store.put('mem-probe', t);
            const back = await store.get('mem-probe');
            await store.delete('mem-probe');
            const size = (x) => (typeof x === 'string' ? x.length : x.size);
            return size(back) === size(t) ? size(t) : 'store read back ' + size(back) + ' of ' + size(t);
        } catch (e) { return 'error: ' + e; }
    })()`).catch((e) => `evaluate failed: ${e.message}`);
    done = true;
    await sampler;
    console.log(`\nsave: ${typeof len === 'number' ? `${(len / 1048576).toFixed(1)} M chars/bytes` : len} in ${((Date.now() - ts) / 1000).toFixed(1)} s; peak page heap ${mb(peak.page)}, worker heap ${mb(peak.worker)}, renderer rss ${mb(peak.rss)}`);
    results.push({ label: 'save', len, peak, ms: Date.now() - ts });
    results.push(await report('after save'));
}

async function snapshot(s, file) {
    const fd = openSync(file, 'w');
    const onChunk = (m) => { if (m.sessionId === s && m.method === 'HeapProfiler.addHeapSnapshotChunk') writeSync(fd, m.params.chunk); };
    listeners.add(onChunk);
    await send('HeapProfiler.enable', {}, s);
    await send('HeapProfiler.takeHeapSnapshot', { reportProgress: false, captureNumericValue: false }, s);
    listeners.delete(onChunk);
    closeSync(fd);
    console.log(`heap snapshot: ${file}`);
}
if (snapDir) {
    mkdirSync(snapDir, { recursive: true });
    await snapshot(pageS, join(snapDir, `page${inThread ? '-inthread' : ''}.heapsnapshot`));
    if (workerS) await snapshot(workerS, join(snapDir, 'worker.heapsnapshot'));
}
if (opt('json', '')) writeFileSync(opt('json', ''), JSON.stringify(results, null, 1));
ws.close();
chrome.kill('SIGTERM');
await sleep(1000);
rmSync(profileDir, { recursive: true, force: true });
process.exit(0);
