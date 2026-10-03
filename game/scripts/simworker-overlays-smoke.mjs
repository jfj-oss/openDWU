#!/usr/bin/env node
// Sim worker chunk 3 smoke (docs/sim-worker.md §9): boot with the Freight Flows, Trade Hubs and Empire Territory
// overlays on, run the game, and check that the freight overlay has flows to draw (in worker mode: that the worker
// records and the ledger reached the replica's side tables), then save screenshots at galaxy and sector zoom.
// Run it in both modes and compare the screenshots:
//   node scripts/simworker-overlays-smoke.mjs <base url> [--out=shots/sw-overlays] [--inthread] [--seconds=40 (game s)] [--scenario=rim-atmosphere]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const opt = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const inThread = process.argv.includes('--inthread');
const out = opt('out', 'shots/sw-overlays');
/** Game seconds to run before the checks and screenshots (both modes stop at about the same game time). */
const seconds = Number(opt('seconds', '40'));
const scenario = opt('scenario', '');
const mode = `${inThread ? 'inthread' : 'worker'}${scenario ? `-${scenario}` : ''}`;
mkdirSync(out, { recursive: true });
const url = `${base}?autostart=1&simWorker=${inThread ? 0 : 1}&overlays=freight,hubs,territory${scenario ? `&scenario=${encodeURIComponent(scenario)}` : ''}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.stack ?? e.message}`));
let failed = 0;
const check = (ok, what) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok) failed++;
};
try {
    await page.goto(url);
    await page.waitForFunction(() => window.__dwu?.time !== undefined && window.__dwu?.view !== undefined, null, { timeout: 600000 });
    check(inThread || (await page.evaluate(() => window.__dwu.simWorker !== null)), `game runs ${inThread ? 'in-thread' : 'in the worker'}`);
    const state = () =>
        page.evaluate(() => {
            const d = window.__dwu;
            const f = d.view.freightOverlay;
            const side = d.simWorker?.core?.replica?.decoder?.object(1) ?? null;
            const tf = side?.tradeFlows ?? null;
            return {
                nowMs: d.galaxy.nowMs,
                recording: f?.recording ?? null,
                rows: f?.rows?.length ?? -1,
                hubs: f?.hubRows?.length ?? -1,
                sideEntries: tf === null ? null : tf.entries.length,
                sideVersion: tf === null ? null : tf.version,
                leaders: tf === null ? null : tf.freighterDestination.size,
            };
        });
    check((await state()).recording === true, 'freight overlay recording');
    // 19i rim wiring (with a rim-atmosphere scenario): the rim weights / names are in the galaxy the view reads (in
    // worker mode installed by the worker before its first tick and synced to the replica).
    const rim = await page.evaluate(() => {
        const g = window.__dwu.galaxy;
        const st = g.scenario?.state ?? {};
        return { flag: g.scenario?.flags?.rimAtmosphere === true, weights: st['rimAtmosphere.weights']?.length ?? 0, names: Object.keys(st['rimAtmosphere.names'] ?? {}).length, systems: g.systems.length };
    });
    if (rim.flag) check(rim.weights === rim.systems && rim.names > 0, `rim wiring installed: ${rim.weights} weights for ${rim.systems} systems, ${rim.names} names`);
    await page.evaluate(() => {
        window.__dwu.time.paused = false;
        window.__dwu.time.speed = 4;
    });
    const deadline = Date.now() + 300_000;
    while (Date.now() < deadline && (await state()).nowMs < seconds * 1000) await page.waitForTimeout(1000);
    await page.evaluate(() => {
        window.__dwu.time.paused = true;
    });
    // Let the replica settle (worker mode: the cold queue drains; a paused worker keeps comparing for two cold cycles),
    // then make the overlay re-query (it only re-queries on a new game day otherwise).
    const settleBy = Date.now() + 60_000;
    let stable = 0;
    while (Date.now() < settleBy && stable < 3) {
        await page.waitForTimeout(1000);
        const backlog = await page.evaluate(() => window.__dwu.simWorker?.core?.replica?.decoder?.coldBacklog ?? 0);
        stable = backlog === 0 ? stable + 1 : 0;
    }
    await page.evaluate(() => window.__dwu.view.freightOverlay?.invalidate());
    await page.waitForTimeout(500);
    const s = await state();
    console.log(`     ${JSON.stringify(s)}`);
    check(s.rows > 0, `freight flows to draw: ${s.rows} rows, ${s.hubs} hubs at ${(s.nowMs / 1000).toFixed(1)} game s`);
    if (!inThread) check(s.sideEntries !== null && s.sideEntries > 0, `ledger synced to the replica: ${s.sideEntries} series, version ${s.sideVersion}, ${s.leaders} freighters in flight`);
    for (const [name, zoom] of [
        ['galaxy', 0.00002],
        ['sector', 0.0004],
    ]) {
        await page.evaluate((z) => {
            const d = window.__dwu;
            const c = d.camera;
            const p = d.game.playerEmpire.capital;
            if (p) c.centerOn(p.xpos, p.ypos);
            if (typeof c.setZoom === 'function') c.setZoom(z);
            else c.zoom = z;
        }, zoom);
        await page.waitForTimeout(1500);
        await page.screenshot({ path: `${out}/${mode}-${name}.png` });
        console.log(`     saved ${out}/${mode}-${name}.png`);
    }
} catch (err) {
    check(false, `smoke threw: ${err?.stack ?? err}`);
}
const errors = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
for (const l of errors.slice(0, 20)) console.log(l);
check(errors.length === 0, `no console errors (${errors.length})`);
await browser.close();
process.exit(failed > 0 ? 1 : 0);
