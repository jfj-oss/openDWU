// Usage: node scripts/perf-render.mjs [--url=http://localhost:5173/] [--gpu=swiftshader|egl|vulkan]
//          [--w=1920 --h=1080 --dpr=2] [--days=60] [--secs=6] [--profile [--callers]] [--top=15] [--paused]
//          [--stars=700 --sectors=4] [--zooms=galaxy,sector,system,planet] [--qs=dither=0] [--uncapped]
//          [--load=<save file>] [--speed=1] [--save-profile=DIR] [--motion]
//          [--eval=<page script>] [--report=<page expression>] [--trace=<file.json>] [--pre-sweep=<page expression>] [--sweep [--sweeps=3] [--sweep-secs=3] [--notch=1] [--layers]]
//
// --load: copy that save (serializeGame text, e.g. scripts/lategame-start.mjs --save-out) to public/dev-saves/ and boot
// it with ?load= instead of ?autostart=1 (no warm-up unless --days is given). --speed: game speed while measuring.
// --motion: also measure drawn-motion smoothness per zoom (installMotionProbe below): per frame, each steadily moving
// free-flying ship's drawn displacement against its true velocity × the sim's measured game rate × the frame's real
// time (q = 1 is perfectly even motion), with stalls (q < 0.25), jumps (q > 2), reversals and jerk |Δq|, plus the
// same for the render clock (renderNowMs) and the render delay behind the committed sim time. Headings too: each drawn
// ship's per-frame heading change against the sim's own turn (its committed heading at each LastTouch, lerped between
// touches at the drawn instant), on ships turning steadily (installMotionProbe: heading stats).
// --save-profile: also write each zoom's CPU profile to DIR/<zoom>.cpuprofile (scripts/cpuprofile-summary.mjs).
// --sweep: instead of the fixed zoom levels, a scripted wheel-zoom sweep: continuous wheel events on the canvas (at the
// player's capital) zoom from the whole galaxy down to 100% and back out over --sweep-secs, repeated --sweeps times
// (sweep 1 is cold: lazy textures / first rasterisation; later sweeps are warm). --notch: wheel notches per event (the
// handler zooms x1.25 per notch). Per sweep it prints frame-time mean/p50/p95/p99/max, the update/render split, long
// tasks (> 50 ms) and, with --profile, the top self time (DIR/sweepN.cpuprofile with --save-profile). --layers wraps
// every MainView method and sub-layer `update` and prints the per-layer time of the slowest frames.
//
// Renderer performance at 4K (1920x1080 CSS px at dpr 2 = a 3840x2160 canvas by default). Starts its own Vite dev
// server on a free port (unless --url is given), boots `?autostart=1`, unpauses at 4x until --days game days have
// passed, then for each zoom level (galaxy, sector, system, planet — centred on the player's capital) lets the view
// settle and measures for --secs seconds:
//   fps / frame ms  — requestAnimationFrame deltas (mean and p50/p95),
//   update ms       — MainView.update (JS scene update, per frame),
//   render ms       — app.renderer.render (Pixi JS traversal + GL command submission, per frame),
//   sim ms          — the sim's wall ms per render frame (window.__dwu.simStats),
// It also prints the boot time (navigation to window.__dwu.game) and, at the end, the original-art load cost
// (printArtLoad: every /assets/dwu/ image request's timing and bytes, page and loader worker, and the JS heap).
// With --profile, a CPU profile (Chrome DevTools protocol Profiler) is taken during each measurement and the top
// self-time functions are printed. --paused measures with the sim paused (render cost only). The load average is
// printed first because the numbers depend on how busy the machine is.
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join } from 'node:path';
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
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
const SWEEP = args.sweep === 'true';
const SWEEPS = +(args.sweeps ?? 3);
const SWEEP_SECS = +(args['sweep-secs'] ?? 3);
const NOTCH = +(args.notch ?? 1);
const LAYERS = args.layers === 'true';
const MOTION = args.motion === 'true';

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
            const dest = join(root, 'public/dev-saves', basename(LOAD));
            // (Not onto itself: a save already in public/dev-saves, or a link to it there.)
            if (!existsSync(dest) || realpathSync(dest) !== realpathSync(LOAD)) copyFileSync(LOAD, dest);
            bootQs = `load=/dev-saves/${encodeURIComponent(basename(LOAD))}${args.qs ? `&${args.qs}` : ''}`;
        }
        const artReqs = trackArtRequests(page);
        const bootT0 = Date.now();
        await page.goto(`${base.replace(/\/$/, '')}/?${bootQs}`);
        await page.waitForFunction(() => !!window.__dwu?.game && !!window.__dwu?.time, null, { timeout: 120000 });
        console.log(`boot: ${Date.now() - bootT0} ms from navigation to window.__dwu.game`);
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
            // Per frame: update / render ms (parallel arrays, rendered frames) besides the sums.
            const acc = { update: 0, render: 0, frames: 0, deltas: [], zooms: [], upd: [], rnd: [], lastUpd: 0 };
            window.__perf = acc;
            const upd = d.view.update.bind(d.view);
            d.view.update = (...a) => {
                const t = performance.now();
                upd(...a);
                acc.lastUpd = performance.now() - t;
                acc.update += acc.lastUpd;
            };
            const r = d.app.renderer;
            const rnd = r.render.bind(r);
            r.render = (...a) => {
                const t = performance.now();
                const out = rnd(...a);
                const dt = performance.now() - t;
                acc.render += dt;
                acc.frames++;
                acc.upd.push(acc.lastUpd);
                acc.rnd.push(dt);
                acc.lastUpd = 0;
                return out;
            };
            let last = -1;
            const loop = (ts) => {
                if (last >= 0) {
                    acc.deltas.push(ts - last);
                    acc.zooms.push(d.camera.zoom);
                }
                last = ts;
                requestAnimationFrame(loop);
            };
            requestAnimationFrame(loop);
        });

        if (MOTION) await page.evaluate(installMotionProbe);

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

        // --eval=<file>: run that script in the page before measuring (A/B experiments, e.g. stubbing a layer method).
        if (args.eval) await page.evaluate(readFileSync(args.eval, 'utf8'));
        const cdp = PROFILE ? await page.context().newCDPSession(page) : null;
        if (cdp) {
            await cdp.send('Profiler.enable');
            await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
        }

        if (SWEEP) {
            await runSweep(page, cdp, browser, artReqs);
            return;
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
                window.__motionProbe?.reset();
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
            if (MOTION) m.motion = await page.evaluate(() => window.__motionProbe.summary());
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
        if (MOTION) printMotion(rows);
        await printArtLoad(page, artReqs);
        console.log(`load average after: ${loadavg().map((v) => v.toFixed(2)).join(' ')}`);
    } finally {
        await browser.close();
        if (vite) process.kill(-vite.pid, 'SIGTERM');
    }
}

/**
 * --motion: page-side probe (wraps MainView.update). Per rendered frame (t = document.timeline.currentTime, the frame's
 * rAF time) it reads the view's RenderTime and, for every built object the view sampled this frame (motion.drawn), its
 * drawn position (relative to its drawn parent when it is drawn in a parent's frame). A ship counts when it was drawn in
 * the same frame this frame and the last, flies at a steady CurrentSpeed (within 2 % for the last 20 frames; sub-light
 * or warp, not entering / leaving hyperspace) and the game is running. Its true move this
 * frame is CurrentSpeed × rate × dt, where rate is the sim's measured game ms per real ms over the last 1.5 s (so a
 * sim that falls behind is judged against the rate it really runs at); q = drawn move / true move.
 */
function installMotionProbe() {
    const d = window.__dwu;
    const view = d.view;
    const CAP = 400000;
    // Heading: per drawn ship, its touches (LastTouch, committed heading) and its drawn frames (frame number, drawn game
    // instant, drawn heading); summary() compares them (headingSummary).
    let hShips = [];
    let hRec = new WeakMap();
    let hValues = 0;
    const H_CAP = 6000000;
    const fresh = () => ({ lag: [], starved0: view.presentClock?.starved ?? 0, framedN: 0, framedStall: 0, frames: 0, q: [], dq: [], stall: 0, jump: 0, rev: 0, clock: [], clockDq: [], clockBack: 0, clockStall: 0, clockJump: 0, steps: [0, 0, 0, 0, 0], delay: [], rates: [], shipsPerFrame: 0 });
    let data = fresh();
    const ships = new WeakMap();
    const hist = [];
    let frameNo = 0;
    let lastT = -1;
    let lastRender = 0;
    let lastSerial = -1;
    let lastClockQ = NaN;
    const inner = view.update;
    view.update = (...a) => {
        inner(...a);
        const rt = view.renderTime;
        const t = document.timeline.currentTime ?? performance.now();
        frameNo++;
        const dt = lastT < 0 ? 0 : t - lastT;
        lastT = t;
        hist.push(t, rt.simNowMs);
        while (hist.length > 4 && t - hist[0] > 1500) hist.splice(0, 2);
        const span = t - hist[0];
        const rate = span > 400 ? (rt.simNowMs - hist[1]) / span : NaN;
        const running = !d.time.paused && rate > 0 && dt > 0;
        const steps = lastSerial < 0 ? 0 : rt.stepSerial - lastSerial;
        lastSerial = rt.stepSerial;
        if (running) {
            data.frames++;
            data.steps[Math.min(4, Math.max(0, steps))]++;
            data.rates.push(rate);
            data.delay.push((rt.simNowMs - rt.renderNowMs) / rate);
            // Steps the drawn instant trails the latest step received (the presentation clock; before it, the worker's
            // StepPacer playout buffer, whose held messages the replica does not have yet).
            const pacer = d.simWorker?.core?.pacer;
            const drawnSerial = Number.isNaN(rt.renderSerial ?? Number.NaN) || rt.renderSerial === undefined ? rt.stepSerial - 1 + rt.alpha : rt.renderSerial;
            data.lag.push(pacer ? pacer.received - pacer.drawn : rt.stepSerial - drawnSerial);
            const cq = (rt.renderNowMs - lastRender) / (rate * dt);
            data.clock.push(cq);
            if (cq < 0) data.clockBack++;
            else if (cq < 0.25) data.clockStall++;
            else if (cq > 2) data.clockJump++;
            if (Number.isFinite(lastClockQ)) data.clockDq.push(Math.abs(cq - lastClockQ));
            lastClockQ = cq;
        } else lastClockQ = NaN;
        lastRender = rt.renderNowMs;
        const g = d.game.galaxy;
        const m = view.motion;
        let n = 0;
        for (const bo of g.builtObjects) {
            if (bo === null || bo === undefined || bo.hasBeenDestroyed) continue;
            const s = m.drawn(bo);
            if (s === null) continue;
            let hr = hRec.get(bo);
            if (hr === undefined) {
                hr = { tau: [], th: [], fN: [], fT: [], fH: [], fF: [], lastTouch: NaN };
                hRec.set(bo, hr);
                hShips.push(hr);
            }
            if (bo.lastTouch !== hr.lastTouch && hValues < H_CAP) {
                hr.lastTouch = bo.lastTouch;
                hr.tau.push(bo.lastTouch);
                hr.th.push(bo.heading);
                hValues += 2;
            }
            if (running && hValues < H_CAP) {
                // The drawn instant: the presented step's game time (renderNowMs is the step after it).
                hr.fN.push(frameNo);
                hr.fT.push(rt.renderNowMs - rt.stepGameMs);
                hr.fH.push(s.heading);
                // (2: snapped this frame — a teleport, first sight: the history starts over at one sample.)
                hr.fF.push(s.hn === 1 ? 2 : s.frame === null ? 0 : 1);
                hValues += 4;
            }
            const speed = bo.currentSpeed;
            let r = ships.get(bo);
            if (r === undefined) {
                r = { f: 0, x: 0, y: 0, dx: 0, dy: 0, q: NaN, speed: -1, steady: 0, frame: undefined };
                ships.set(bo, r);
            }
            const steady = speed > 0 && speed <= Math.max(bo.topSpeed, bo.warpSpeed) * 1.001 && Math.abs(speed - r.speed) <= 0.02 * speed && !bo.hyperjumpPrepare && !bo.hyperjumpJustExited;
            r.steady = steady && r.f === frameNo - 1 ? r.steady + 1 : 0;
            // In a parent's frame (parked at / approaching a planet, docked at a base) the ship's own motion is its offset
            // from the drawn parent: measured relative to it.
            const px = s.frame === null ? s.x : s.x - s.ox;
            const py = s.frame === null ? s.y : s.y - s.oy;
            if (running && r.f === frameNo - 1 && s.frame === r.frame && r.steady >= 20) {
                const expected = (speed * rate * dt) / 1000;
                const dx = px - r.x;
                const dy = py - r.y;
                const mv = Math.hypot(dx, dy);
                if (expected > 1e-6) {
                    const q = mv / expected;
                    n++;
                    if (data.q.length < CAP) data.q.push(q);
                    if (s.frame !== null) {
                        data.framedN++;
                        if (q < 0.25) data.framedStall++;
                    }
                    if (q < 0.25) data.stall++;
                    else if (q > 2) data.jump++;
                    const pm = Math.hypot(r.dx, r.dy);
                    if (dx * r.dx + dy * r.dy < 0 && mv > 0.05 * expected && pm > 0.05 * expected) data.rev++;
                    if (Number.isFinite(r.q) && data.dq.length < CAP) data.dq.push(Math.abs(q - r.q));
                    r.q = q;
                    r.dx = dx;
                    r.dy = dy;
                } else r.q = NaN;
            } else {
                r.q = NaN;
                r.dx = 0;
                r.dy = 0;
            }
            r.f = frameNo;
            r.x = px;
            r.y = py;
            r.speed = speed;
            r.frame = s.frame;
        }
        if (running) data.shipsPerFrame += n;
    };
    /**
     * Heading smoothness. The sim's continuous heading H(T) is its committed heading at each touch (LastTouch, heading)
     * lerped along the shorter arc between touches. A frame pair (consecutive frames, drawn instants T0 < T1) counts as
     * a steady turn when every touch interval from the one before T0's through T1's turned at one rate (same sign,
     * within 10 %): the renderer had seen the turn going on at its latest touch. q = drawn heading change / H(T1) − H(T0):
     * stall q < 0.25, jump q > 2.05 (an eased catch-up runs at exactly 2: renderInterp.ts HEADING_EASE_FACTOR), reversal
 * q < 0, jerk |Δq| over a ship's consecutive steady pairs. Frame pairs in
     * intervals where the committed heading did not change at all: `falseTurn` counts drawn changes over 0.003 rad (a
     * ship drawn turning that the sim does not turn); `stopMove` the same just after a turn stopped (the interval before
 * turned, the ones the pair spans did not: a turn still being eased out), `stopAway` those moving away from the
 * heading it stopped at (a turn carried on that the sim did not make). `pop`: any frame pair (known intervals) whose drawn change exceeds
     * 2 × the fastest rate around it × the time + 0.01 rad.
     */
    const headingSummary = (list) => {
        const TWO_PI = Math.PI * 2;
        const wrap = (d) => {
            d %= TWO_PI;
            if (d > Math.PI) d -= TWO_PI;
            else if (d < -Math.PI) d += TWO_PI;
            return d;
        };
        const q = [];
        const dq = [];
        const stepDeg = [];
        let stall = 0;
        let jump = 0;
        let rev = 0;
        let still = 0;
        let falseTurn = 0;
        let stop = 0;
        let stopMove = 0;
        let stopAway = 0;
        let all = 0;
        let pop = 0;
        let turningShips = 0;
        for (const hr of list) {
            const { tau, th, fN, fT, fH, fF } = hr;
            const nT = tau.length;
            if (nT < 3) continue;
            // Interval rates (rad per game ms).
            const r = new Float64Array(nT - 1);
            for (let k = 0; k + 1 < nT; k++) r[k] = tau[k + 1] > tau[k] ? wrap(th[k + 1] - th[k]) / (tau[k + 1] - tau[k]) : NaN;
            const at = (T) => {
                // Last k with tau[k] <= T (binary search), -1 if before the first.
                let lo = 0;
                let hi = nT - 1;
                if (!(T >= tau[0])) return -1;
                while (lo < hi) {
                    const mid = (lo + hi + 1) >> 1;
                    if (tau[mid] <= T) lo = mid;
                    else hi = mid - 1;
                }
                return lo;
            };
            const H = (k, T) => th[k] + r[k] * (T - tau[k]);
            let lastQ = NaN;
            let turned = false;
            for (let i = 1; i < fN.length; i++) {
                if (fN[i] !== fN[i - 1] + 1 || fF[i] !== fF[i - 1] || fF[i] === 2) {
                    lastQ = NaN;
                    continue;
                }
                const T0 = fT[i - 1];
                const T1 = fT[i];
                if (!(T1 > T0)) continue;
                const k0 = at(T0);
                const k1 = at(T1);
                if (k0 < 1 || k1 < 0 || k1 + 1 >= nT) {
                    lastQ = NaN;
                    continue;
                }
                let dH = 0;
                for (let k = k0; k <= k1; k++) dH += H(k, Math.min(T1, tau[k + 1])) - H(k, Math.max(T0, tau[k]));
                const dh = wrap(fH[i] - fH[i - 1]);
                let rMin = Infinity;
                let rMax = -Infinity;
                let aMax = 0;
                for (let k = k0 - 1; k <= k1; k++) {
                    const v = r[k];
                    if (v < rMin) rMin = v;
                    if (v > rMax) rMax = v;
                    if (Math.abs(v) > aMax) aMax = Math.abs(v);
                }
                if (!Number.isFinite(rMin) || !Number.isFinite(rMax)) {
                    lastQ = NaN;
                    continue;
                }
                all++;
                if (Math.abs(dh) > 2 * aMax * (T1 - T0) + 0.01) pop++;
                if (rMin === 0 && rMax === 0) {
                    still++;
                    if (Math.abs(dh) > 0.003) falseTurn++;
                    lastQ = NaN;
                    continue;
                }
                let restStill = true;
                for (let k = k0; k <= k1; k++) if (r[k] !== 0) restStill = false;
                if (restStill) {
                    // The turn stopped at touch k0 (it ended, or the ship's next command does not turn it).
                    stop++;
                    if (Math.abs(dh) > 0.003) {
                        stopMove++;
                        // Away from the heading the turn stopped at (a turn carried on that the sim did not make).
                        if (Math.abs(wrap(fH[i] - th[k0])) > Math.abs(wrap(fH[i - 1] - th[k0])) + 1e-9) stopAway++;
                    }
                    lastQ = NaN;
                    continue;
                }
                // (At least 0.01 rad / game s: a ship reaching a target its every touch re-aims wobbles by less.)
                const steady = rMin * rMax > 0 && Math.min(Math.abs(rMin), Math.abs(rMax)) >= 1e-5 && Math.max(Math.abs(rMin), Math.abs(rMax)) <= 1.1 * Math.min(Math.abs(rMin), Math.abs(rMax));
                if (!steady || Math.abs(dH) < 1e-6) {
                    lastQ = NaN;
                    continue;
                }
                turned = true;
                const v = dh / dH;
                q.push(v);
                stepDeg.push((Math.abs(dh) * 180) / Math.PI);
                if (v < 0) rev++;
                else if (v < 0.25) stall++;
                else if (v > 2.05) jump++;
                if (Number.isFinite(lastQ)) dq.push(Math.abs(v - lastQ));
                lastQ = v;
            }
            if (turned) turningShips++;
        }
        const n = q.length;
        return {
            ships: list.length,
            turningShips,
            samples: n,
            q: { p1: pct(q, 0.01), p5: pct(q, 0.05), p50: pct(q, 0.5), p95: pct(q, 0.95), p99: pct(q, 0.99), rms: n ? Math.sqrt(q.reduce((s, x) => s + (x - 1) * (x - 1), 0) / n) : NaN },
            stallPct: n ? (100 * stall) / n : NaN,
            jumpPct: n ? (100 * jump) / n : NaN,
            revPct: n ? (100 * rev) / n : NaN,
            jerk: { mean: mean(dq), p95: pct(dq, 0.95), p99: pct(dq, 0.99) },
            stepDegP99: pct(stepDeg, 0.99),
            stepDegMax: stepDeg.length ? Math.max(...stepDeg) : NaN,
            stillPairs: still,
            falseTurnPct: still ? (100 * falseTurn) / still : NaN,
            stopPairs: stop,
            stopMovePct: stop ? (100 * stopMove) / stop : NaN,
            stopAwayPct: stop ? (100 * stopAway) / stop : NaN,
            pairs: all,
            popPct: all ? (100 * pop) / all : NaN,
        };
    };
    const pct = (a, f) => {
        if (a.length === 0) return NaN;
        const s = Float64Array.from(a).sort();
        return s[Math.min(s.length - 1, Math.floor(s.length * f))];
    };
    const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
    window.__motionProbe = {
        reset() {
            data = fresh();
            hShips = [];
            hRec = new WeakMap();
            hValues = 0;
        },
        summary() {
            const n = data.q.length;
            const rms = n ? Math.sqrt(data.q.reduce((s, q) => s + (q - 1) * (q - 1), 0) / n) : NaN;
            const cn = data.clock.length;
            const crms = cn ? Math.sqrt(data.clock.reduce((s, q) => s + (q - 1) * (q - 1), 0) / cn) : NaN;
            return {
                frames: data.frames,
                samples: n,
                shipsPerFrame: data.frames ? data.shipsPerFrame / data.frames : 0,
                q: { p1: pct(data.q, 0.01), p5: pct(data.q, 0.05), p50: pct(data.q, 0.5), p95: pct(data.q, 0.95), p99: pct(data.q, 0.99), rms },
                stallPct: n ? (100 * data.stall) / n : NaN,
                framedPct: n ? (100 * data.framedN) / n : NaN,
                framedStallPct: data.framedN ? (100 * data.framedStall) / data.framedN : NaN,
                jumpPct: n ? (100 * data.jump) / n : NaN,
                revPct: n ? (100 * data.rev) / n : NaN,
                jerk: { mean: mean(data.dq), p95: pct(data.dq, 0.95), p99: pct(data.dq, 0.99) },
                clock: { p1: pct(data.clock, 0.01), p50: pct(data.clock, 0.5), p99: pct(data.clock, 0.99), rms: crms, backPct: cn ? (100 * data.clockBack) / cn : NaN, stallPct: cn ? (100 * data.clockStall) / cn : NaN, jumpPct: cn ? (100 * data.clockJump) / cn : NaN, jerkMean: mean(data.clockDq), jerkP95: pct(data.clockDq, 0.95) },
                stepsPerFrame: data.steps,
                delayMs: { mean: mean(data.delay), p5: pct(data.delay, 0.05), p95: pct(data.delay, 0.95) },
                rate: mean(data.rates),
                lag: { mean: mean(data.lag), p50: pct(data.lag, 0.5), p95: pct(data.lag, 0.95) },
                starved: (view.presentClock?.starved ?? 0) - data.starved0,
                heading: headingSummary(hShips),
            };
        },
    };
}

function printMotion(rows) {
    const f = (v, n = 7, dp = 2) => (Number.isFinite(v) ? v.toFixed(dp) : '-').padEnd(n);
    console.log('\nmotion   samples  ships/fr  q p1   q p5   q p50  q p95  q p99  rms(q-1) stall%  jump%  rev%   jerk mean p95    p99    | game rate | framed% (stall%)');
    for (const r of rows) {
        const m = r.motion;
        if (!m) continue;
        console.log(`${r.zoom.padEnd(8)} ${String(m.samples).padEnd(8)} ${f(m.shipsPerFrame, 9, 0)} ${f(m.q.p1)}${f(m.q.p5)}${f(m.q.p50)}${f(m.q.p95)}${f(m.q.p99)}${f(m.q.rms, 9)}${f(m.stallPct)}${f(m.jumpPct)}${f(m.revPct)}${f(m.jerk.mean, 10)}${f(m.jerk.p95)}${f(m.jerk.p99)}| ${f(m.rate, 9, 3)} | ${f(m.framedPct, 5, 0)} (${f(m.framedStallPct, 4, 1)})`);
    }
    console.log('\nheading  samples  ships  turning  q p1    q p5   q p50  q p95  q p99  rms(q-1) stall%  jump%  rev%   jerk mean p95    p99    | step° p99  max   | still pairs falseTurn% | stop pairs stopMove% away% | pop%');
    for (const r of rows) {
        const h = r.motion?.heading;
        if (!h) continue;
        console.log(`${r.zoom.padEnd(8)} ${String(h.samples).padEnd(8)} ${String(h.ships).padEnd(6)} ${String(h.turningShips).padEnd(8)} ${f(h.q.p1)}${f(h.q.p5)}${f(h.q.p50)}${f(h.q.p95)}${f(h.q.p99)}${f(h.q.rms, 9)}${f(h.stallPct)}${f(h.jumpPct)}${f(h.revPct)}${f(h.jerk.mean, 10)}${f(h.jerk.p95)}${f(h.jerk.p99)}| ${f(h.stepDegP99, 9)}${f(h.stepDegMax)}| ${String(h.stillPairs).padEnd(11)} ${f(h.falseTurnPct, 10, 3)} | ${String(h.stopPairs).padEnd(10)} ${f(h.stopMovePct, 9, 2)} ${f(h.stopAwayPct, 5, 2)} | ${f(h.popPct, 6, 3)}`);
    }
    console.log('\nclock    frames  q p1   q p50  q p99  rms(q-1) back%  stall%  jump%  jerk mean p95    | delay ms mean p5     p95    | steps/frame 0,1,2,3,4+ | lag steps mean p50 p95 | starved');
    for (const r of rows) {
        const m = r.motion;
        if (!m) continue;
        const c = m.clock;
        console.log(`${r.zoom.padEnd(8)} ${String(m.frames).padEnd(7)} ${f(c.p1)}${f(c.p50)}${f(c.p99)}${f(c.rms, 9)}${f(c.backPct)}${f(c.stallPct)}${f(c.jumpPct)}${f(c.jerkMean, 10)}${f(c.jerkP95)}| ${f(m.delayMs.mean, 14, 1)}${f(m.delayMs.p5, 7, 1)}${f(m.delayMs.p95, 7, 1)}| ${m.stepsPerFrame.join(',').padEnd(22)} | ${f(m.lag.mean, 5)}${f(m.lag.p50, 5)}${f(m.lag.p95, 5)} | ${m.starved}`);
    }
}

/** --layers: wrap every MainView method (and each sub-layer's / SystemView's `update`) to time it per rendered frame. */
async function installLayerTimers(page) {
    await page.evaluate(() => {
        const d = window.__dwu;
        const view = d.view;
        const cur = new Map();
        const frames = [];
        window.__layerTimes = { cur, frames };
        const wrap = (obj, name, label) => {
            const fn = obj[name];
            if (typeof fn !== 'function' || fn.__timed) return;
            const w = function (...a) {
                const t = performance.now();
                try {
                    return fn.apply(this, a);
                } finally {
                    cur.set(label, (cur.get(label) ?? 0) + performance.now() - t);
                }
            };
            w.__timed = true;
            obj[name] = w;
        };
        const proto = Object.getPrototypeOf(view);
        for (const name of Object.getOwnPropertyNames(proto)) {
            if (name === 'constructor' || name === 'update') continue;
            const desc = Object.getOwnPropertyDescriptor(proto, name);
            if (desc && typeof desc.value === 'function') wrap(view, name, `view.${name}`);
        }
        for (const key of Object.keys(view)) {
            const o = view[key];
            if (o && typeof o === 'object' && typeof o.update === 'function' && o !== view) {
                wrap(o, 'update', `${key}.update`);
                const p = Object.getPrototypeOf(o);
                for (const name of Object.getOwnPropertyNames(p)) {
                    if (name === 'constructor' || name === 'update') continue;
                    const desc = Object.getOwnPropertyDescriptor(p, name);
                    if (desc && typeof desc.value === 'function') wrap(o, name, `${key}.${name}`);
                }
            }
        }
        // SystemView / CloudView / NebulaView instances: wrap on the prototype (hundreds of instances).
        for (const key of ['systems', 'clouds', 'nebulae', 'regionLabelViews']) {
            const arr = view[key];
            if (!Array.isArray(arr) || arr.length === 0) continue;
            const p = Object.getPrototypeOf(arr[0]);
            for (const name of Object.getOwnPropertyNames(p)) {
                if (name === 'constructor') continue;
                const desc = Object.getOwnPropertyDescriptor(p, name);
                if (desc && typeof desc.value === 'function') wrap(p, name, `${key}[].${name}`);
            }
        }
        // One record per rendered frame (pushed at the render call, after the update).
        const r = d.app.renderer;
        const rnd = r.render;
        r.render = (...a) => {
            const out = rnd(...a);
            frames.push(Object.fromEntries(cur));
            cur.clear();
            return out;
        };
    });
}

/** --sweep: wheel-zoom galaxy -> 100% -> galaxy, SWEEPS times, measuring each sweep. */
async function runSweep(page, cdp, browser, artReqs) {
    if (LAYERS) await installLayerTimers(page);
    await page.evaluate(() => {
        window.__longTasks = [];
        try {
            new PerformanceObserver((list) => {
                for (const e of list.getEntries()) window.__longTasks.push({ start: e.startTime, dur: e.duration });
            }).observe({ type: 'longtask', buffered: false });
        } catch {
            // longtask entries unsupported
        }
    });
    const rows = [];
    for (let sweep = 1; sweep <= SWEEPS; sweep++) {
        // Start fully zoomed out, centred on the capital's star.
        await page.evaluate(() => {
            const d = window.__dwu;
            const cam = d.camera;
            const g = d.game.galaxy;
            const cap = d.game.playerEmpire?.capital ?? g.habitats[0];
            cam.centerOn(cap.xpos, cap.ypos);
            cam.zoom = cam.minZoom;
            cam.centerOn(cap.xpos, cap.ypos);
        });
        await page.waitForTimeout(sweep === 1 ? 1500 : 1000);
        // --pre-sweep=<expression>: evaluated in the page before each sweep (after the zoom-out settle), e.g. evicting
        // Pixi's GPU caches to measure a revisit after the 60 s GC: renderer.gc.maxUnusedTime=0; renderer.gc.run().
        if (args['pre-sweep']) await page.evaluate((e) => void (0, eval)(e), args['pre-sweep']);
        // Start the profiler first: Profiler.start stalls the page, which must not count as a sweep frame.
        if (cdp) await cdp.send('Profiler.start');
        await page.evaluate(() => {
            const p = window.__perf;
            p.update = 0;
            p.render = 0;
            p.frames = 0;
            p.deltas.length = 0;
            p.zooms.length = 0;
            p.upd.length = 0;
            p.rnd.length = 0;
            window.__longTasks.length = 0;
            if (window.__layerTimes) window.__layerTimes.frames.length = 0;
            window.__dwu.simStats.reset();
        });
        // Two frames after Profiler.start, then reset again: the profiler's start-up stall is not a sweep frame.
        await page.evaluate(
            () =>
                new Promise((res) =>
                    requestAnimationFrame(() =>
                        requestAnimationFrame(() => {
                            const p = window.__perf;
                            p.update = p.render = p.frames = 0;
                            p.deltas.length = p.zooms.length = p.upd.length = p.rnd.length = 0;
                            window.__longTasks.length = 0;
                            if (window.__layerTimes) window.__layerTimes.frames.length = 0;
                            res();
                        }),
                    ),
                ),
        );
        // --trace=FILE: a Chrome trace (renderer + GPU process) of the first sweep, for chrome://tracing / Perfetto.
        if (args.trace && sweep === 1) {
            await browser.startTracing(page, {
                path: args.trace,
                categories: ['devtools.timeline', 'toplevel', 'gpu', 'disabled-by-default-gpu.service', 'disabled-by-default-devtools.timeline', 'blink', 'cc', 'viz'],
            });
        }
        // In-page schedule: one wheel event every `interval` ms at the capital's current screen position.
        const res = await page.evaluate(
            ({ secs, notch }) =>
                new Promise((resolve) => {
                    const d = window.__dwu;
                    const cam = d.camera;
                    const canvas = d.app.canvas;
                    const g = d.game.galaxy;
                    const cap = d.game.playerEmpire?.capital ?? g.habitats[0];
                    const steps = Math.ceil(Math.log(cam.maxZoom / cam.minZoom) / Math.log(1.25 ** notch));
                    const total = steps * 2;
                    const interval = (secs * 1000) / total;
                    let i = 0;
                    const t0 = performance.now();
                    const fire = () => {
                        const rect = canvas.getBoundingClientRect();
                        const s = cam.worldToScreen(cap.xpos, cap.ypos);
                        const inward = i < steps;
                        for (let k = 0; k < notch; k++) {
                            canvas.dispatchEvent(
                                new WheelEvent('wheel', {
                                    deltaY: inward ? -100 : 100,
                                    clientX: rect.left + Math.max(0, Math.min(cam.width, s.x)),
                                    clientY: rect.top + Math.max(0, Math.min(cam.height, s.y)),
                                    bubbles: true,
                                    cancelable: true,
                                }),
                            );
                        }
                        i++;
                        if (i < total) {
                            const next = t0 + i * interval;
                            setTimeout(fire, Math.max(0, next - performance.now()));
                        } else {
                            // Let the last zoom-out frame render.
                            setTimeout(() => resolve({ steps, interval, wall: performance.now() - t0 }), 100);
                        }
                    };
                    fire();
                }),
            { secs: SWEEP_SECS, notch: NOTCH },
        );
        const profile = cdp ? (await cdp.send('Profiler.stop')).profile : null;
        if (args.trace && sweep === 1) await browser.stopTracing();
        const m = await page.evaluate(() => {
            const p = window.__perf;
            const q = (arr, f) => {
                const d = [...arr].sort((a, b) => a - b);
                return d.length ? d[Math.min(d.length - 1, Math.floor(d.length * f))] : NaN;
            };
            const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : NaN);
            const lt = window.__longTasks;
            const out = {
                frames: p.deltas.length,
                mean: mean(p.deltas),
                p50: q(p.deltas, 0.5),
                p95: q(p.deltas, 0.95),
                p99: q(p.deltas, 0.99),
                max: q(p.deltas, 1),
                updMean: mean(p.upd),
                updP95: q(p.upd, 0.95),
                updMax: q(p.upd, 1),
                rndMean: mean(p.rnd),
                rndP95: q(p.rnd, 0.95),
                rndMax: q(p.rnd, 1),
                longTasks: lt.length,
                longTaskMs: lt.reduce((a, b) => a + b.dur, 0),
                longTaskMax: lt.reduce((a, b) => Math.max(a, b.dur), 0),
                worst: [],
                // The 5 longest frame intervals, with the zoom (1/zoom = the original's zoom factor) they ended at.
                longest: p.deltas
                    .map((v, i) => [v, i])
                    .sort((a, b) => b[0] - a[0])
                    .slice(0, 5)
                    .map(([v, i]) => ({ i, ms: v, factor: 1 / p.zooms[i] })),
            };
            const lf = window.__layerTimes?.frames;
            if (lf && lf.length) {
                // The 5 slowest rendered frames (update + render) with their top layers.
                const idx = p.upd.map((u, i) => [u + p.rnd[i], i]).sort((a, b) => b[0] - a[0]).slice(0, 5);
                for (const [tot, i] of idx) {
                    const layers = Object.entries(lf[i] ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
                    out.worst.push({ i, tot, upd: p.upd[i], rnd: p.rnd[i], layers });
                }
                // Mean per-layer ms across the sweep's frames.
                const sum = new Map();
                for (const f of lf) for (const [k, v] of Object.entries(f)) sum.set(k, (sum.get(k) ?? 0) + v);
                out.layerMean = [...sum.entries()].map(([k, v]) => [k, v / lf.length]).sort((a, b) => b[1] - a[1]).slice(0, 15);
            }
            return out;
        });
        rows.push({ sweep, ...m });
        console.log(`\n[sweep ${sweep}] ${res.steps} wheel events each way, every ${res.interval.toFixed(1)} ms (${(res.wall / 1000).toFixed(2)} s)`);
        console.log(`  longest frame intervals: ${m.longest.map((l) => `#${l.i} ${l.ms.toFixed(0)} ms @ factor ${l.factor.toFixed(1)}`).join(', ')}`);
        if (m.worst.length) {
            console.log('  slowest frames (update + render ms; top layers, inclusive ms):');
            for (const w of m.worst) {
                console.log(`   #${w.i} ${w.tot.toFixed(1)} (upd ${w.upd.toFixed(1)}, render ${w.rnd.toFixed(1)}): ${w.layers.map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ')}`);
            }
            console.log(`  mean per frame: ${m.layerMean.map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ')}`);
        }
        if (profile && args['save-profile']) {
            mkdirSync(args['save-profile'], { recursive: true });
            writeFileSync(join(args['save-profile'], `sweep${sweep}.cpuprofile`), JSON.stringify(profile));
        }
        if (profile) {
            const { total, rows: top } = topSelf(profile, TOP);
            console.log(`  top self time (${(total / 1000).toFixed(2)} s sampled):`);
            for (const [k, v, c] of top) {
                console.log(`  ${v.toFixed(0).padStart(7)} ms ${((100 * v) / total).toFixed(1).padStart(5)}%  ${k}`);
                if (CALLERS && c) console.log(`                         ${c}`);
            }
        }
    }
    // --report=<expression>: print JSON.stringify of that page expression (state left by an --eval experiment).
    if (args.report) console.log(`report: ${await page.evaluate((e) => JSON.stringify((0, eval)(e)), args.report)}`);
    const f = (v, w = 7) => (Number.isFinite(v) ? v.toFixed(1) : '-').padEnd(w);
    console.log('\nsweep frames mean   p50    p95    p99    max    | upd mean p95   max    | rnd mean p95   max    | long tasks (ms, max)');
    for (const r of rows) {
        console.log(
            `${String(r.sweep).padEnd(5)} ${String(r.frames).padEnd(6)} ${f(r.mean)}${f(r.p50)}${f(r.p95)}${f(r.p99)}${f(r.max)}| ${f(r.updMean, 9)}${f(r.updP95, 6)}${f(r.updMax)}| ${f(r.rndMean, 9)}${f(r.rndP95, 6)}${f(r.rndMax)}| ${r.longTasks} (${r.longTaskMs.toFixed(0)}, ${r.longTaskMax.toFixed(0)})`,
        );
    }
    await printArtLoad(page, artReqs);
    console.log(`load average after: ${loadavg().map((v) => v.toFixed(2)).join(' ')}`);
}

/**
 * Original-art requests (every /assets/dwu/ image, page and Pixi's loader worker alike), recorded from Playwright's
 * request events: start time, duration (request start to response end) and body bytes.
 */
function trackArtRequests(page) {
    const reqs = [];
    page.on('requestfinished', async (req) => {
        if (!req.url().includes('/assets/dwu/') || !/\.(png|jpe?g|bmp)(\?|$)/i.test(req.url())) return;
        const t = req.timing();
        const entry = { start: t.startTime, ms: t.responseEnd, bytes: 0 };
        reqs.push(entry);
        try {
            entry.bytes = (await req.sizes()).responseBodySize;
        } catch {
            // page closed
        }
    });
    return reqs;
}

/** Original-art load cost so far: count, bytes, request ms (sum / p95 / max), when the last one finished, JS heap. */
async function printArtLoad(page, reqs) {
    const heapMb = await page.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize / 1048576 : NaN));
    const ms = reqs.map((r) => r.ms).filter((v) => v >= 0).sort((a, b) => a - b);
    const t0 = Math.min(...reqs.map((r) => r.start));
    const lastEnd = Math.max(...reqs.map((r) => r.start + Math.max(0, r.ms)));
    console.log(
        `art load: ${reqs.length} images, ${(reqs.reduce((t, r) => t + r.bytes, 0) / 1024).toFixed(0)} KB, request ms sum ${ms.reduce((a, b) => a + b, 0).toFixed(0)} / p50 ${(ms[Math.floor(ms.length / 2)] ?? 0).toFixed(1)} / p95 ${(ms[Math.floor(ms.length * 0.95)] ?? 0).toFixed(1)} / max ${(ms[ms.length - 1] ?? 0).toFixed(1)}, first to last ${reqs.length ? (lastEnd - t0).toFixed(0) : 0} ms; JS heap ${heapMb.toFixed(1)} MB`,
    );
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
