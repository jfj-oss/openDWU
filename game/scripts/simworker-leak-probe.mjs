#!/usr/bin/env node
// Leak probe (docs/sim-worker.md §10): how many Galaxy / SimClientCore / MainView instances stay alive after a game view
// is replaced — the worker's crash restart (fatal, hard), and main menu → Load Game — counted with CDP
// Runtime.queryObjects after a GC, plus the JS heap. Every replaced view should leave nothing behind.
//   node scripts/simworker-leak-probe.mjs <base url> [--inthread] [--load=/dev-saves/x.dwusave] [--rounds=2] [--tour]
//        [--qs=stars=60] [--snapshot=<file>]
import { chromium } from 'playwright-core';
const base = process.argv[2] ?? 'http://localhost:5173/';
const opt = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const inThread = process.argv.includes('--inthread');
const load = opt('load', '');
const rounds = Number(opt('rounds', '2'));
// --tour: before each replacement open and close every top-bar screen and left-sidebar panel, select the capital and
// a ship (the UI's module state must not keep the old game either).
const tourOn = process.argv.includes('--tour');
async function tour() {
    if (!tourOn) return;
    await page.evaluate(async () => {
        const hud = await import('/src/ui/hud.ts');
        const p = window.__dwu.game.playerEmpire;
        hud.selectStellarObject(p.capital, true);
        const s = p.builtObjects.find((b) => b && b.topSpeed > 0);
        if (s) hud.selectStellarObject(s, true);
    });
    for (const id of ['tbtnColonies', 'tbtnBuiltObjects', 'tbtnShipGroups', 'tbtnDesigns', 'btnBuildOrder', 'tbtnConstructionYards', 'tbtnTroops', 'tbtnResearch', 'btnExpansionPlanner', 'btnEmpireSummary', 'btnEmpirePolicy', 'tbtnEmpires', 'tbtnIntelligenceAgents', 'btnEmpireGraphs', 'btnGalacticHistory', 'btnHistoryMessages']) {
        await page.locator(`[data-hud="${id}"]`).first().click().catch(() => {});
        await page.waitForTimeout(700);
        for (let i = 0; i < 4; i++) {
            const x = page.locator('.ow-close, .policy-close, .galactic-history-close').last();
            if ((await x.count()) === 0 || !(await x.isVisible().catch(() => false))) break;
            await x.click().catch(() => {});
            await page.waitForTimeout(150);
        }
    }
    for (const id of await page.$$eval('.ls-button[data-panel]', (bs) => bs.map((b) => b.dataset.panel))) {
        await page.click(`.ls-button[data-panel="${id}"]`).catch(() => {});
        await page.waitForTimeout(300);
        await page.click(`.ls-button[data-panel="${id}"]`).catch(() => {});
    }
    await page.mouse.move(700, 400);
    for (const k of ['g', 'g', 'BracketLeft', 'BracketLeft', 'h']) {
        await page.keyboard.press(k);
        await page.waitForTimeout(400);
    }
    const x = page.locator('.galactic-history-close');
    if ((await x.count()) > 0) await x.first().click().catch(() => {});
    await page.evaluate(async () => (await import('/src/ui/hud.ts')).setSelection(null));
}
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--js-flags=--expose-gc', '--enable-precise-memory-info'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
page.on('dialog', (d) => void d.accept());
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
const cdp = await page.context().newCDPSession(page);
const waitGame = (prev) => page.waitForFunction((p) => window.__dwu?.time !== undefined && window.__dwu?.game?.playerEmpire != null && window.__dwu.__probeId !== p, prev, { timeout: 900000, polling: 500 });
const tag = () => page.evaluate(() => (window.__dwu.__probeId = Math.random()));
async function snapshot(file) {
    const { openSync, writeSync, closeSync } = await import('node:fs');
    for (let i = 0; i < 3; i++) await cdp.send('HeapProfiler.collectGarbage');
    const fd = openSync(file, 'w');
    const onChunk = (e) => writeSync(fd, e.chunk);
    cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk);
    await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
    cdp.off('HeapProfiler.addHeapSnapshotChunk', onChunk);
    closeSync(fd);
    console.log(`heap snapshot: ${file}`);
}
async function count(label) {
    for (let i = 0; i < 3; i++) {
        await cdp.send('HeapProfiler.collectGarbage');
        await page.waitForTimeout(300);
    }
    const out = {};
    for (const [name, mod, cls] of [['Galaxy', '/src/sim/galaxy.ts', 'Galaxy'], ['SimClientCore', '/src/simworker/clientCore.ts', 'SimClientCore'], ['MainView', '/src/render/mainView.ts', 'MainView'], ['GalaxyReplica', '/src/simworker/replicaGalaxy.ts', 'GalaxyReplica']]) {
        // (Every handle in the 'probe' group is released after the count: a held query result keeps what it found.)
        const proto = await cdp.send('Runtime.evaluate', { expression: `import('${mod}').then((m) => m.${cls}.prototype)`, awaitPromise: true, objectGroup: 'probe' });
        if (!proto.result.objectId) { out[name] = '?'; continue; }
        const q = await cdp.send('Runtime.queryObjects', { prototypeObjectId: proto.result.objectId, objectGroup: 'probe' });
        const len = await cdp.send('Runtime.callFunctionOn', { objectId: q.objects.objectId, functionDeclaration: 'function () { return this.length; }', returnByValue: true, objectGroup: 'probe' });
        out[name] = len.result.value;
        await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'probe' });
    }
    const heap = await page.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 1048576));
    console.log(`${label}: heap ${heap} MB, live ${JSON.stringify(out)}`);
    return out;
}
await page.goto(`${base}?${load ? `load=${encodeURIComponent(load)}` : 'autostart=1'}&simWorker=${inThread ? 0 : 1}${opt('qs', '') ? `&${opt('qs', '')}` : ''}`);
await waitGame(null);
await tag();
await page.waitForTimeout(3000);
await count('booted');
if (!inThread) {
    for (let r = 0; r < rounds; r++) {
        for (const kind of ['fatal', 'hard']) {
            await tour();
            const prev = await page.evaluate((k) => {
                const d = window.__dwu;
                if (k === 'fatal') d.simWorker.simulateFatal('probe'); else d.simWorker.stop('probe');
                return d.__probeId;
            }, kind);
            const box = page.locator('[data-ow="msgbox"]', { hasText: 'Simulation Stopped' });
            await box.waitFor({ timeout: 60000 });
            await box.locator('.ow-glass', { hasText: 'Restart' }).click();
            await waitGame(prev);
            await tag();
            await page.waitForTimeout(3000);
            await count(`after ${kind} restart ${r + 1}`);
            // --snapshot-after-restart=<file>: the snapshot right after the first restart, then stop.
            if (opt('snapshot-after-restart', '') !== '') {
                await snapshot(opt('snapshot-after-restart', ''));
                await browser.close();
                process.exit(0);
            }
        }
    }
}
// Save, main menu, load (both modes).
for (let r = 0; r < rounds; r++) {
    const name = `leakprobe-${r}`;
    await tour();
    await page.evaluate(() => { window.__dwu.time.paused = true; });
    await page.mouse.move(700, 400);
    await page.keyboard.press('Escape');
    await page.locator('.game-menu-btn', { hasText: /^Save Game$/ }).click();
    await page.fill('.save-load-name-input', name);
    await page.locator('#save-load-overlay button.save-load-btn', { hasText: /^Save$/ }).click();
    await page.waitForFunction((n) => JSON.parse(localStorage.getItem('dwu.saveIndex') ?? '[]').some((e) => e.name === n), name, { timeout: 300000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    if (!(await page.locator('#game-menu-overlay').isVisible())) await page.keyboard.press('Escape');
    const prev = await page.evaluate(() => window.__dwu.__probeId);
    await page.locator('.game-menu-btn', { hasText: 'Exit to Main Menu' }).click();
    await page.locator('[data-ow="msgbox"] button', { hasText: 'Yes' }).click();
    await page.waitForSelector('.main-menu-item[data-id="loadGame"]', { timeout: 60000 });
    await count(`main menu ${r + 1}`);
    await page.click('.main-menu-item[data-id="loadGame"]');
    await page.locator(`#save-load-overlay .ow-grid-row:has(.ow-grid-cell:text-is("${name}"))`).dblclick();
    await waitGame(prev);
    await tag();
    await page.waitForTimeout(3000);
    await count(`after load ${r + 1}`);
}
// --snapshot=<file>: a heap snapshot at the end (streamed to the file; find the retainers with a snapshot reader).
if (opt('snapshot', '') !== '') await snapshot(opt('snapshot', ''));
await browser.close();
