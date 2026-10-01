#!/usr/bin/env node
// Browser check of the big late-game start and of loading a big save (the headless side is scripts/lategame-start.mjs).
//
//   node scripts/lategame-browser.mjs [--url=http://localhost:5173/] [--newgame='{"seed":1,...}'] [--save=file.dwusave]
//                                     [--timeout=600]
//
// Starts its own Vite dev server unless --url is given, then
//   1. boots ?newgame=<JSON> (the wizard path: toCreateGameOptions + createGameSteps under the progress overlay; the
//      default JSON is the reported crash — 1400 stars, 15x15 sectors, 20 empires, Mature galaxy and empire),
//   2. with --save, opens the main menu → Load Game → "Open file" with that save.
// For each it prints the wall time until window.__dwu.game exists, the JS heap (CDP Runtime.getHeapUsage), the
// overlay steps seen, and the longest stretch the main thread did not answer (a page.evaluate poll every 100 ms) —
// the "tab frozen" time. A page crash ("Aw, snap" / OOM) or uncaught error is reported.
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? 'true'] : [a, 'true'];
}));
const NEWGAME = args.newgame ?? JSON.stringify({ seed: 1, starCountIndex: 5, dimensionIndex: 4, galaxyExpansionIndex: 4, empireExpansionIndex: 4, otherEmpires: { empireCount: 19 } });
const TIMEOUT = +(args.timeout ?? 600) * 1000;

const freePort = () => new Promise((res, rej) => {
    const srv = createServer();
    srv.on('error', rej);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => res(port)); });
});
async function waitForServer(url, ms) {
    const t = Date.now();
    for (;;) {
        try { if ((await fetch(url)).status < 500) return; } catch { /* not up */ }
        if (Date.now() - t > ms) throw new Error(`no dev server at ${url}`);
        await new Promise((r) => setTimeout(r, 200));
    }
}

/** Poll the page until window.__dwu.game exists; returns wall ms, longest unresponsive gap, overlay steps. */
async function watch(page, cdp, label, start) {
    const t0 = start ?? performance.now();
    let lastAnswer = t0;
    let maxGap = 0;
    let stallAfter = '';
    const steps = [];
    let crashed = null;
    page.once('crash', () => (crashed = 'renderer crashed (Aw, snap / OOM)'));
    for (;;) {
        if (crashed) break;
        if (performance.now() - t0 > TIMEOUT) { crashed = `timeout after ${TIMEOUT / 1000}s`; break; }
        let r;
        try {
            r = await page.evaluate(() => ({ ready: !!window.__dwu?.game, step: document.querySelector('.dwu-loading-step')?.textContent ?? null, title: document.querySelector('.dwu-loading-title span')?.textContent ?? null }));
        } catch (e) {
            if (crashed) break;
            if (/Execution context was destroyed|navigation/i.test(String(e))) continue;
            crashed = String(e);
            break;
        }
        const now = performance.now();
        if (now - lastAnswer > maxGap) stallAfter = steps[steps.length - 1] ?? '(before the overlay)';
        maxGap = Math.max(maxGap, now - lastAnswer);
        lastAnswer = now;
        const s = r.title !== null ? `${r.title}: ${r.step ?? ''}` : null;
        if (s !== null && steps[steps.length - 1] !== s) steps.push(s);
        if (r.ready) break;
        await new Promise((res) => setTimeout(res, 100));
    }
    const wall = performance.now() - t0;
    let heap = null;
    if (!crashed) {
        await new Promise((res) => setTimeout(res, 1500)); // let the first frames run
        await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
        heap = await cdp.send('Runtime.getHeapUsage').catch(() => null);
    }
    console.log(`${label}: ${crashed ?? 'ready'} after ${(wall / 1000).toFixed(1)} s; longest main-thread stall ${(maxGap / 1000).toFixed(1)} s (after "${stallAfter}")` +
        (heap ? `; JS heap after GC ${(heap.usedSize / 1048576).toFixed(0)} MB` : ''));
    console.log(`  overlay steps seen (${steps.length}): ${steps.slice(0, 12).join(' | ')}${steps.length > 12 ? ' | …' : ''}`);
    return !crashed;
}

let vite = null;
let base = args.url;
if (!base) {
    execFileSync('node', ['scripts/gen-asset-manifest.mjs'], { cwd: root, stdio: 'ignore' });
    const port = await freePort();
    base = `http://localhost:${port}/`;
    vite = spawn(join(root, 'node_modules/.bin/vite'), ['--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore', detached: true });
    await waitForServer(base, 30000);
}
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const cdp = await page.context().newCDPSession(page);
    page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') console.log(`[console.error] ${m.text().slice(0, 300)}`); });
    // Warm the dev server's module graph first so the timing is the game's, not Vite's first transform.
    // (A tiny game, not the main menu: the menu's art requests can leave the renderer out of request slots,
    // net::ERR_INSUFFICIENT_RESOURCES, for the next navigation.)
    await page.goto(`${base.replace(/\/$/, '')}/?newgame=${encodeURIComponent('{"seed":1,"starCountIndex":0,"dimensionIndex":0,"otherEmpires":{"empireCount":1}}')}`);
    await page.waitForFunction(() => !!window.__dwu?.game, null, { timeout: 180000 });
    const t = performance.now();
    await page.goto(`${base.replace(/\/$/, '')}/?newgame=${encodeURIComponent(NEWGAME)}`);
    const ok = await watch(page, cdp, `new game ${NEWGAME}`, t);
    if (ok && args.save) {
        const p2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        const cdp2 = await p2.context().newCDPSession(p2);
        p2.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
        p2.on('console', (m) => { if (m.type() === 'error') console.log(`[console.error] ${m.text().slice(0, 300)}`); });
        await page.close();
        await p2.goto(base);
        await p2.waitForSelector('.main-menu-item');
        await p2.locator('.main-menu-item').nth(2).click(); // Load Game
        await p2.waitForSelector('.save-load-file-input', { state: 'attached' });
        const t2 = performance.now();
        await p2.setInputFiles('.save-load-file-input', resolve(String(args.save)));
        await watch(p2, cdp2, `load ${args.save}`, t2);
    }
} finally {
    await browser.close();
    if (vite) try { process.kill(-vite.pid); } catch { /* gone */ }
}
