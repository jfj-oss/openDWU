// Zoom-in frame-time probe: boot a save, look at the whole galaxy for --away seconds, then jump to a named habitat's
// system at system zoom and record requestAnimationFrame deltas (plus, optionally, a CPU profile and a perf trace) for
// --secs seconds. Prints p50/p95/p99/max over the window and per 5 s bucket (to see how long a slow tail lasts).
//
//   node scripts/zoomin-probe.mjs --url=http://localhost:PORT/ --load=/dev-saves/X.dwusave --target=Terloy
//        [--worker=0|1] [--away=45] [--secs=60] [--speed=1] [--profile=out.cpuprofile] [--trace=out.json]
//        [--gpu=swiftshader|egl] [--w=1600 --h=900 --dpr=1] [--repeat=1] [--uncapped] [--wheel [--wheel-secs=3]] [--glcount]
// --away=0: stay on the target (a baseline). --uncapped: no vsync (frame time = work). --wheel: zoom in with wheel events
// at the target instead of a camera jump. --glcount: per 5 s bucket, GL draws / uniformMatrix3fv / texture uploads /
// framebuffer binds per frame. The game is kept unpaused (event popups auto-pause it). Note: Profiler.start stalls the
// page for ~0.5-1 s, so with --profile the first frame's max is the profiler's, not the game's.
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? 'true'] : [a, 'true'];
}));
const BASE = (args.url ?? 'http://localhost:5173/').replace(/\/$/, '');
const LOAD = args.load;
const TARGET = args.target ?? 'Terloy';
const WORKER = args.worker ?? '0';
const AWAY = +(args.away ?? 45);
const SECS = +(args.secs ?? 60);
const SPEED = +(args.speed ?? 1);
const REPEAT = +(args.repeat ?? 1);
const GPU = args.gpu ?? 'swiftshader';
const GPU_ARGS = {
    swiftshader: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    egl: ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'],
};

const stats = (a) => {
    const d = [...a].sort((x, y) => x - y);
    const q = (f) => (d.length ? d[Math.min(d.length - 1, Math.floor(d.length * f))] : NaN);
    return { n: d.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: d[d.length - 1] ?? NaN, sum: d.reduce((s, x) => s + x, 0) };
};
const f = (v) => (Number.isFinite(v) ? v.toFixed(1) : '-');

const UNCAPPED = args.uncapped === 'true';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: [...GPU_ARGS[GPU], '--js-flags=--max-old-space-size=8192', ...(UNCAPPED ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])] });
try {
    const page = await browser.newPage({ viewport: { width: +(args.w ?? 1600), height: +(args.h ?? 900) }, deviceScaleFactor: +(args.dpr ?? 1) });
    page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') console.log(`[console.error] ${m.text().slice(0, 300)}`); });
    if (args.glcount === 'true') await page.addInitScript(() => {
        const P = WebGL2RenderingContext.prototype; const c = { draw: 0, um3: 0, tex: 0, fb: 0 }; window.__glc = c;
        for (const [k, n] of [['drawElements', 'draw'], ['drawArrays', 'draw'], ['uniformMatrix3fv', 'um3'], ['texImage2D', 'tex'], ['texSubImage2D', 'tex'], ['bindFramebuffer', 'fb']]) { const o = P[k]; P[k] = function (...a) { c[n]++; return o.apply(this, a); }; }
    });
    const t0 = Date.now();
    await page.goto(`${BASE}/?load=${encodeURIComponent(LOAD)}&simWorker=${WORKER}${args.qs ? `&${args.qs}` : ''}`);
    await page.waitForFunction(() => !!window.__dwu?.game && !!window.__dwu?.time && !!window.__dwu?.view, null, { timeout: 600000, polling: 1000 });
    console.log(`boot ${((Date.now() - t0) / 1000).toFixed(0)} s, worker=${WORKER}`);
    const info = await page.evaluate((name) => {
        const d = window.__dwu;
        const g = d.game.galaxy;
        const h = g.habitats.find((x) => x?.name === name);
        if (!h) return null;
        window.__target = h;
        const sys = g.systems[h.systemIndex];
        return { name: h.name, sys: sys?.name ?? h.systemIndex, x: h.xpos, y: h.ypos, owner: h.empire?.name ?? null, habitats: g.habitats.length, objects: g.builtObjects.length };
    }, TARGET);
    console.log('target', JSON.stringify(info));
    if (!info) throw new Error('target not found');
    await page.evaluate((speed) => {
        const d = window.__dwu;
        d.time.speed = speed;
        d.time.paused = false;
        // Event popups auto-pause the game; keep it running (the player would unpause).
        setInterval(() => { d.time.paused = false; }, 250);
        const acc = { deltas: [], t: [], busy: [], upd: [], rec: false, u: 0, r: 0 };
        window.__zp = acc;
        const upd = d.view.update.bind(d.view);
        d.view.update = (...a) => { const t = performance.now(); upd(...a); acc.u += performance.now() - t; };
        const rr = d.app.renderer; const rnd = rr.render.bind(rr);
        rr.render = (...a) => { const t = performance.now(); const o = rnd(...a); acc.r += performance.now() - t; return o; };
        let last = -1;
        const loop = (ts) => {
            if (acc.rec && last >= 0) { acc.deltas.push(ts - last); acc.t.push(ts); acc.busy.push(acc.u + acc.r); acc.upd.push(acc.u); if (window.__glc) { (acc.gl ??= []).push({ ...window.__glc }); } }
            acc.u = 0; acc.r = 0;
            last = ts;
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }, SPEED);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
    const wheelIn = () => page.evaluate((secs) => new Promise((resolve) => {
        const d = window.__dwu; const cam = d.camera; const h = window.__target; const canvas = d.app.canvas;
        const goal = cam.clampZoom(1 / 50);
        const steps = Math.ceil(Math.log(goal / cam.zoom) / Math.log(1.25));
        const interval = (secs * 1000) / Math.max(1, steps);
        let i = 0;
        const fire = () => {
            const rect = canvas.getBoundingClientRect();
            const sp = cam.worldToScreen(h.xpos, h.ypos);
            canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: rect.left + Math.max(0, Math.min(cam.width, sp.x)), clientY: rect.top + Math.max(0, Math.min(cam.height, sp.y)), bubbles: true, cancelable: true }));
            i++;
            if (i < steps && cam.zoom < goal) setTimeout(fire, interval); else { cam.centerOn(h.xpos, h.ypos); resolve(); }
        };
        fire();
    }), +(args['wheel-secs'] ?? 3));
    const goSystem = () => page.evaluate(() => {
        const d = window.__dwu; const cam = d.camera; const h = window.__target;
        cam.centerOn(h.xpos, h.ypos);
        cam.zoom = cam.clampZoom(1 / 50);
    });
    const goGalaxy = () => page.evaluate(() => {
        const d = window.__dwu; const cam = d.camera; const g = d.game.galaxy;
        cam.centerOn(g.sizeX / 2, g.sizeY / 2);
        cam.zoom = cam.minZoom;
    });
    // Look at the target first (as the player would have), then away.
    await goSystem();
    await page.waitForTimeout(10000);
    for (let rep = 0; rep < REPEAT; rep++) {
        if (AWAY > 0) await goGalaxy();
        await page.waitForTimeout(Math.max(AWAY, 1) * 1000);
        await page.evaluate(() => { window.__zp.deltas.length = 0; window.__zp.t.length = 0; window.__zp.busy.length = 0; window.__zp.upd.length = 0; window.__zp.rec = true; });
        if (args.profile) await cdp.send('Profiler.start');
        if (args.trace && rep === 0) await browser.startTracing(page, { path: args.trace, screenshots: false, categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'toplevel', 'v8', 'blink.user_timing', 'gpu', 'disabled-by-default-gpu.service', 'cc', 'viz'] });
        const tz = Date.now();
        if (args.wheel === 'true') await wheelIn(); else await goSystem();
        await page.waitForTimeout(Math.max(0, SECS * 1000 - (Date.now() - tz)));
        if (args.trace && rep === 0) await browser.stopTracing();
        if (args.profile) {
            const { profile } = await cdp.send('Profiler.stop');
            writeFileSync(REPEAT > 1 ? args.profile.replace(/\.cpuprofile$/, `.${rep}.cpuprofile`) : args.profile, JSON.stringify(profile));
        }
        const r = await page.evaluate(() => { const z = window.__zp; z.rec = false; return { d: z.deltas, t: z.t, b: z.busy, u: z.upd, gl: z.gl ?? null }; });
        const all = stats(r.d);
        console.log(`[rep ${rep}] ${SECS}s after zoom-in: frames ${all.n} p50 ${f(all.p50)} p95 ${f(all.p95)} p99 ${f(all.p99)} max ${f(all.max)} ms`);
        const bs = stats(r.b), us = stats(r.u);
        console.log(`  view.update+render ms/frame: p50 ${f(bs.p50)} p95 ${f(bs.p95)} p99 ${f(bs.p99)} max ${f(bs.max)} (update alone p50 ${f(us.p50)} p95 ${f(us.p95)} max ${f(us.max)})`);
        const t00 = r.t[0] ?? 0;
        const line = [];
        for (let b = 0; b < SECS; b += 5) {
            const sel = r.d.filter((_, i) => r.t[i] - t00 >= b * 1000 && r.t[i] - t00 < (b + 5) * 1000);
            const s = stats(sel);
            const sb = stats(r.b.filter((_, i) => r.t[i] - t00 >= b * 1000 && r.t[i] - t00 < (b + 5) * 1000));
            let gls = '';
            if (r.gl) { const idx = r.t.map((x, i) => [x - t00, i]).filter(([x]) => x >= b * 1000 && x < (b + 5) * 1000).map(([, i]) => i); if (idx.length > 1) { const a0 = r.gl[idx[0]], a1 = r.gl[idx[idx.length - 1]], nf = idx.length - 1; gls = ` draws/f ${((a1.draw - a0.draw) / nf).toFixed(0)} um3/f ${((a1.um3 - a0.um3) / nf).toFixed(0)} tex/f ${((a1.tex - a0.tex) / nf).toFixed(1)} fb/f ${((a1.fb - a0.fb) / nf).toFixed(1)}`; } }
            line.push(`${b}s:${s.n}f/p95 ${f(s.p95)}/max ${f(s.max)}/busy50 ${f(sb.p50)}${gls}`);
        }
        console.log('  buckets\n    ' + line.join('\n    '));
    }
} finally {
    await browser.close();
}
