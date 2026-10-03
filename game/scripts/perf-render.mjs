// Usage: node scripts/perf-render.mjs [--url=http://localhost:5173/] [--gpu=swiftshader|egl|vulkan]
//          [--w=1920 --h=1080 --dpr=2] [--days=60] [--secs=6] [--profile [--callers]] [--top=15] [--paused]
//          [--stars=700 --sectors=4] [--zooms=galaxy,sector,system,planet] [--qs=dither=0] [--uncapped]
//          [--load=<save file>] [--speed=1] [--save-profile=DIR]
//
// --load: copy that save (serializeGame text, e.g. scripts/lategame-start.mjs --save-out) to public/dev-saves/ and boot
// it with ?load= instead of ?autostart=1 (no warm-up unless --days is given). --speed: game speed while measuring.
// --save-profile: also write each zoom's CPU profile to DIR/<zoom>.cpuprofile (scripts/cpuprofile-summary.mjs).
//
// Renderer performance at 4K (1920x1080 CSS px at dpr 2 = a 3840x2160 canvas by default). Starts its own Vite dev
// server on a free port (unless --url is given), boots `?autostart=1`, unpauses at 4x until --days game days have
// passed, then for each zoom level (galaxy, sector, system, planet — centred on the player's capital) lets the view
// settle and measures for --secs seconds:
//   fps / frame ms  — requestAnimationFrame deltas (mean and p50/p95),
//   update ms       — MainView.update (JS scene update, per frame),
//   render ms       — app.renderer.render (Pixi JS traversal + GL command submission, per frame),
//   sim ms          — the sim's wall ms per render frame (window.__dwu.simStats),
// With --profile, a CPU profile (Chrome DevTools protocol Profiler) is taken during each measurement and the top
// self-time functions are printed. --paused measures with the sim paused (render cost only). The load average is
// printed first because the numbers depend on how busy the machine is.
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join } from 'node:path';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
        const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
        return m ? [m[1], m[2] ?? 'true'] : [a, 'true'];
    }),
);
const W = +(args.w ?? 1920);
const H = +(args.h ?? 1080);
const DPR = +(args.dpr ?? 2);
const LOAD = args.load ?? null;
const DAYS = +(args.days ?? (LOAD ? 0 : 60));
const SPEED = +(args.speed ?? 1);
const SECS = +(args.secs ?? 6);
const TOP = +(args.top ?? 15);
const GPU = args.gpu ?? 'swiftshader';
const PROFILE = args.profile === 'true';
const PAUSED = args.paused === 'true';
const CALLERS = args.callers === 'true';
// Galaxy size (boot URL ?stars= / ?sectors=), e.g. --stars=2800 --sectors=15 for the wizard's biggest galaxy.
// --qs=a=1&b=2 appends extra boot query parameters (e.g. --qs=dither=0 for an A/B of the output dither).
const BOOT_QS = `${args.stars ? `&stars=${args.stars}` : ''}${args.sectors ? `&sectors=${args.sectors}` : ''}${args.qs ? `&${args.qs}` : ''}`;
const ZOOMS = (args.zooms ?? 'galaxy,sector,system,planet').split(',');

const GPU_ARGS = {
    swiftshader: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    egl: ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'],
    vulkan: ['--use-gl=angle', '--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'],
};

function freePort() {
    return new Promise((resolve, reject) => {
        const srv = createServer();
        srv.on('error', reject);
        srv.listen(0, '127.0.0.1', () => {
            const { port } = srv.address();
            srv.close(() => resolve(port));
        });
    });
}

async function waitForServer(url, timeoutMs) {
    const start = Date.now();
    for (;;) {
        try {
            const r = await fetch(url);
            if (r.status < 500) return;
        } catch {
            // not up yet
        }
        if (Date.now() - start > timeoutMs) throw new Error(`dev server did not respond at ${url}`);
        await new Promise((res) => setTimeout(res, 200));
    }
}

/** Aggregate a V8 CPU profile into self time per function (name + url:line). */
function topSelf(profile, n) {
    const byId = new Map(profile.nodes.map((node) => [node.id, node]));
    const parent = new Map();
    for (const node of profile.nodes) for (const c of node.children ?? []) parent.set(c, node);
    const label = (node) => {
        const cf = node.callFrame;
        const file = cf.url ? cf.url.replace(/^.*\/(src|node_modules\/\.vite\/deps)\//, '').replace(/\?.*$/, '') : '';
        return `${cf.functionName || '(anonymous)'} ${file}${file ? `:${cf.lineNumber + 1}` : ''}`;
    };
    const callers = new Map();
    const self = new Map();
    const dts = profile.timeDeltas;
    let total = 0;
    for (let i = 0; i < profile.samples.length; i++) {
        const node = byId.get(profile.samples[i]);
        const dt = (dts[i] ?? 0) / 1000;
        total += dt;
        const key = label(node);
        self.set(key, (self.get(key) ?? 0) + dt);
        // Caller chain (3 frames) of each sample, to attribute native/library time.
        let chain = '';
        let p = parent.get(node.id);
        for (let k = 0; k < 3 && p !== undefined && p.callFrame.functionName !== '(root)'; k++, p = parent.get(p.id)) {
            chain += ` < ${label(p)}`;
        }
        let m = callers.get(key);
        if (m === undefined) callers.set(key, (m = new Map()));
        m.set(chain, (m.get(chain) ?? 0) + dt);
    }
    const rows = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
    const topCaller = (key) => [...(callers.get(key) ?? new Map()).entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    return { total, rows: rows.map(([k, v]) => [k, v, topCaller(k)]) };
}

async function main() {
    const la = loadavg();
    console.log(`load average: ${la.map((v) => v.toFixed(2)).join(' ')} (${W}x${H} @ dpr ${DPR}, gpu=${GPU}${PAUSED ? ', sim paused' : ''}${BOOT_QS ? `, ${BOOT_QS.slice(1)}` : ''})`);
    let vite = null;
    let base = args.url;
    if (!base) {
        execFileSync('node', ['scripts/gen-asset-manifest.mjs'], { cwd: root, stdio: 'ignore' });
        const port = await freePort();
        base = `http://localhost:${port}/`;
        // Own process group, so only this server (and its children) is stopped at the end.
        vite = spawn(join(root, 'node_modules/.bin/vite'), ['--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore', detached: true });
        await waitForServer(base, 30000);
    }
    const browser = await chromium.launch({
        executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
        // --uncapped: no vsync / frame-rate limit, so fps shows GPU cost differences (A/B runs).
        args: [...(GPU_ARGS[GPU] ?? GPU_ARGS.swiftshader), ...(args.uncapped === 'true' ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])],
    });
    try {
        const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
        page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
        page.on('console', (m) => {
            if (m.type() === 'error') console.log(`[console.error] ${m.text()}`);
        });
        let bootQs = `autostart=1${BOOT_QS}`;
        if (LOAD) {
            mkdirSync(join(root, 'public/dev-saves'), { recursive: true });
            copyFileSync(LOAD, join(root, 'public/dev-saves', basename(LOAD)));
            bootQs = `load=/dev-saves/${encodeURIComponent(basename(LOAD))}${args.qs ? `&${args.qs}` : ''}`;
        }
        await page.goto(`${base.replace(/\/$/, '')}/?${bootQs}`);
        await page.waitForFunction(() => !!window.__dwu?.game && !!window.__dwu?.time, null, { timeout: 120000 });
        const gl = await page.evaluate(() => {
            const c = document.createElement('canvas').getContext('webgl2');
            const ext = c?.getExtension('WEBGL_debug_renderer_info');
            return ext ? c.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
        });
        console.log(`GL renderer: ${gl}`);
        const size = await page.evaluate(() => {
            const g = window.__dwu.game.galaxy;
            return `${g.systems.length} systems, ${g.habitats?.length ?? '?'} habitats, ${g.builtObjects?.length ?? '?'} built objects, ${g.sectorWidth}x${g.sectorHeight} sectors`;
        });
        console.log(`galaxy: ${size}`);

        // Instrument MainView.update and the Pixi render call (both looked up per frame).
        await page.evaluate(() => {
            const d = window.__dwu;
            const acc = { update: 0, render: 0, frames: 0, deltas: [] };
            window.__perf = acc;
            const upd = d.view.update.bind(d.view);
            d.view.update = () => {
                const t = performance.now();
                upd();
                acc.update += performance.now() - t;
            };
            const r = d.app.renderer;
            const rnd = r.render.bind(r);
            r.render = (...a) => {
                const t = performance.now();
                const out = rnd(...a);
                acc.render += performance.now() - t;
                acc.frames++;
                return out;
            };
            let last = -1;
            const loop = (ts) => {
                if (last >= 0) acc.deltas.push(ts - last);
                last = ts;
                requestAnimationFrame(loop);
            };
            requestAnimationFrame(loop);
        });

        // Warm up: run the sim at 4x until DAYS game days have passed (1 day = 1/360 of a 600 s game year at 1x).
        const DAY_MS = 600000 / 360;
        const start = await page.evaluate(() => {
            const d = window.__dwu;
            d.time.speed = 4;
            d.time.paused = false;
            return d.game.galaxy.nowMs;
        });
        const t0 = Date.now();
        for (;;) {
            const now = await page.evaluate(() => window.__dwu.game.galaxy.nowMs);
            const days = (now - start) / DAY_MS;
            if (days >= DAYS) break;
            if (Date.now() - t0 > 600000) {
                console.log(`warm-up capped at 10 min (${days.toFixed(1)} game days)`);
                break;
            }
            await page.waitForTimeout(2000);
        }
        const days = await page.evaluate((s) => (window.__dwu.game.galaxy.nowMs - s) / (600000 / 360), start);
        console.log(`warm-up: ${days.toFixed(1)} game days in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
        await page.evaluate(({ paused, speed }) => {
            window.__dwu.time.speed = speed;
            window.__dwu.time.paused = paused;
        }, { paused: PAUSED, speed: SPEED });

        const cdp = PROFILE ? await page.context().newCDPSession(page) : null;
        if (cdp) {
            await cdp.send('Profiler.enable');
            await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
        }

        const zooms = ZOOMS;
        const rows = [];
        for (const zoom of zooms) {
            await page.evaluate((zoom) => {
                const d = window.__dwu;
                const cam = d.camera;
                const cap = d.game.playerEmpire?.capital ?? null;
                const g = d.game.galaxy;
                const star = cap !== null ? g.systems[cap.systemIndex]?.systemStar ?? cap : null;
                if (zoom === 'galaxy') {
                    cam.centerOn(g.sizeX / 2, g.sizeY / 2);
                    cam.zoom = cam.minZoom;
                } else if (zoom === 'sector') {
                    cam.centerOn(star.xpos, star.ypos);
                    cam.zoom = cam.clampZoom(1 / 3000);
                } else if (zoom === 'system') {
                    cam.centerOn(star.xpos, star.ypos);
                    cam.zoom = cam.clampZoom(1 / 50);
                } else {
                    cam.centerOn(cap.xpos, cap.ypos);
                    cam.zoom = cam.clampZoom(1);
                }
            }, zoom);
            await page.waitForTimeout(2500); // settle (lazy textures, label rasterization)
            await page.evaluate(() => {
                const p = window.__perf;
                p.update = 0;
                p.render = 0;
                p.frames = 0;
                p.deltas.length = 0;
                window.__dwu.simStats.reset();
            });
            if (cdp) await cdp.send('Profiler.start');
            await page.waitForTimeout(SECS * 1000);
            const profile = cdp ? (await cdp.send('Profiler.stop')).profile : null;
            const m = await page.evaluate(() => {
                const p = window.__perf;
                const s = window.__dwu.simStats;
                const d = [...p.deltas].sort((a, b) => a - b);
                const sum = d.reduce((a, b) => a + b, 0);
                const q = (f) => (d.length ? d[Math.min(d.length - 1, Math.floor(d.length * f))] : NaN);
                return {
                    frames: d.length,
                    frameMs: d.length ? sum / d.length : NaN,
                    p50: q(0.5),
                    p95: q(0.95),
                    update: p.frames ? p.update / p.frames : NaN,
                    render: p.frames ? p.render / p.frames : NaN,
                    sim: s.renderFrames ? s.simWallMs / s.renderFrames : NaN,
                    // 240 Hz budget misses: frames longer than 1.5 × 4.17 ms (a skipped refresh).
                    over240: d.length ? d.filter((x) => x > 6.25).length / d.length : NaN,
                    // Sim worker mode (simworker/clientCore.ts SyncStats): main-thread sync cost and the worker's own.
                    worker: s.deltas === undefined ? null : {
                        hot: s.renderFrames ? s.hotApplyMs / s.renderFrames : NaN,
                        cold: s.renderFrames ? s.coldPumpMs / s.renderFrames : NaN,
                        maxHot: s.maxHotApplyMs,
                        maxCold: s.maxColdPumpMs,
                        maxSync: s.maxSimMsPerRenderFrame,
                        stepsPerS: s.simFrames,
                        workerStep: s.workerStepMs,
                        workerDiff: s.workerDiffMs,
                        kb: s.deltaBytes / 1024,
                        backlog: s.coldBacklog,
                    },
                };
            });
            rows.push({ zoom, ...m });
            if (profile && args['save-profile']) {
                mkdirSync(args['save-profile'], { recursive: true });
                writeFileSync(join(args['save-profile'], `${zoom}.cpuprofile`), JSON.stringify(profile));
            }
            if (profile) {
                const { total, rows: top } = topSelf(profile, TOP);
                console.log(`\n[${zoom}] top self time (${(total / 1000).toFixed(2)} s sampled):`);
                for (const [k, v, c] of top) {
                    console.log(`  ${v.toFixed(0).padStart(7)} ms ${((100 * v) / total).toFixed(1).padStart(5)}%  ${k}`);
                    if (CALLERS && c) console.log(`                         ${c}`);
                }
            }
        }
        console.log('\nzoom     fps    frame ms  p50     p95     update ms  render ms  sim ms');
        for (const r of rows) {
            const f = (v, w = 8) => (Number.isFinite(v) ? v.toFixed(2) : '-').padEnd(w);
            console.log(
                `${r.zoom.padEnd(8)} ${f(1000 / r.frameMs, 6)} ${f(r.frameMs, 9)} ${f(r.p50)}${f(r.p95)}${f(r.update, 11)}${f(r.render, 11)}${f(r.sim)}`,
            );
        }
        console.log(`240 Hz misses (frames > 6.25 ms): ${rows.map((r) => `${r.zoom} ${(100 * r.over240).toFixed(1)}%`).join(', ')}`);
        if (rows.some((r) => r.worker !== null)) {
            console.log('\nsim worker  main hot ms/frame  main cold ms/frame  max hot  max cold  max sync  sim steps  last worker step ms  diff ms  delta KB  cold backlog');
            for (const r of rows) {
                const w = r.worker;
                if (w === null) continue;
                const f = (v, n = 8) => (Number.isFinite(v) ? v.toFixed(2) : '-').padEnd(n);
                console.log(`${r.zoom.padEnd(11)} ${f(w.hot, 17)}${f(w.cold, 19)}${f(w.maxHot, 9)}${f(w.maxCold, 10)}${f(w.maxSync, 10)}${String(w.stepsPerS).padEnd(11)}${f(w.workerStep, 20)}${f(w.workerDiff, 9)}${f(w.kb, 10)}${w.backlog}`);
            }
        }
        console.log(`load average after: ${loadavg().map((v) => v.toFixed(2)).join(' ')}`);
    } finally {
        await browser.close();
        if (vite) process.kill(-vite.pid, 'SIGTERM');
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
