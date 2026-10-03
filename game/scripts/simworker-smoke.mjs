#!/usr/bin/env node
// Sim worker smoke (docs/sim-worker.md §6): boot a game with ?simWorker=1 in headless Chromium against a running dev
// server and check that it runs, pauses, changes speed and takes a move order; save screenshots at four zooms.
//   node scripts/simworker-smoke.mjs <base url> [--load=/dev-saves/x.dwusave] [--out=shots/simworker] [--inthread]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const opt = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const load = opt('load', '');
const out = opt('out', 'shots/simworker');
const inThread = process.argv.includes('--inthread');
mkdirSync(out, { recursive: true });
const url = `${base}?${load ? `load=${encodeURIComponent(load)}` : 'autostart=1'}&simWorker=${inThread ? 0 : 1}`;
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
    check(inThread || (await page.evaluate(() => window.__dwu.simWorker !== null)), 'game runs in the worker');
    const now = () => page.evaluate(() => window.__dwu.galaxy.nowMs);
    await page.evaluate(() => { window.__dwu.time.paused = false; window.__dwu.time.speed = 1; });
    const t0 = await now();
    await page.waitForTimeout(3000);
    const t1 = await now();
    check(t1 - t0 > 1500, `runs at 1x: ${(t1 - t0).toFixed(0)} game ms in 3 s`);
    await page.evaluate(() => { window.__dwu.time.speed = 4; });
    await page.waitForTimeout(500);
    const t2 = await now();
    await page.waitForTimeout(3000);
    const t3 = await now();
    check(t3 - t2 > 2 * (t1 - t0), `faster at 4x: ${(t3 - t2).toFixed(0)} game ms in 3 s`);
    await page.evaluate(() => { window.__dwu.time.paused = true; });
    // Pausing lands at the worker's next tick; steps already in flight still arrive.
    await page.waitForTimeout(1500);
    const t4 = await now();
    await page.waitForTimeout(1500);
    check((await now()) === t4, 'pause holds the clock');
    // A move order through the command queue (on the replica in worker mode).
    const order = await page.evaluate(() => {
        const d = window.__dwu;
        const p = d.game.playerEmpire;
        const ship = p.builtObjects.find((b) => b && !b.hasBeenDestroyed && b.currentSpeed !== undefined && b.role !== undefined && b.parentHabitat !== null && (b.subRole === 1 || b.subRole === 2 || b.subRole === 9 || true) && b.design && b.topSpeed > 0);
        const target = d.galaxy.habitats.filter((h) => h.parent !== null).sort((a, b) => Math.hypot(b.xpos - ship.xpos, b.ypos - ship.ypos) - Math.hypot(a.xpos - ship.xpos, a.ypos - ship.ypos))[200];
        let applied = null;
        d.commands.issue(d.galaxy, p, 'rightClickOrder', [ship, d.commands.moveOrder(target), { ctrl: false, alt: false }, 1], (r) => { window.__moveResult = r?.kind ?? 'applied'; });
        d.time.paused = false;
        window.__moveShip = ship;
        window.__moveTarget = target;
        return { id: ship.builtObjectID, from: [ship.xpos, ship.ypos], target: target.name, applied };
    });
    await page.waitForTimeout(4000);
    const moved = await page.evaluate(() => {
        const s = window.__moveShip, t = window.__moveTarget;
        const log = window.__dwu.commands.log();
        return { result: window.__moveResult ?? null, pos: [s.xpos, s.ypos], dist0: null, dist: Math.hypot(s.xpos - t.xpos, s.ypos - t.ypos), mission: s.mission?.type ?? null, target: t.name };
    });
    check(moved.result !== null, `move order applied (reply: ${moved.result})`);
    check(Math.hypot(moved.pos[0] - order.from[0], moved.pos[1] - order.from[1]) > 0, `ship ${order.id} moves toward ${order.target}: ${JSON.stringify(order.from.map(Math.round))} → ${JSON.stringify(moved.pos.map(Math.round))}`);
    await page.evaluate(() => { window.__dwu.time.paused = true; });
    for (const [name, zoom] of [['galaxy', null], ['sector', 0.02], ['system', 0.25], ['planet', 1.5]]) {
        await page.evaluate((z) => {
            const c = window.__dwu.camera;
            const cap = window.__dwu.game.playerEmpire.capital;
            if (cap) c.centerOn(cap.xpos, cap.ypos);
            c.zoom = z === null ? c.minZoom : c.clampZoom(z);
        }, zoom);
        await page.evaluate(() => { window.__dwu.time.paused = false; });
        await page.waitForTimeout(1500);
        await page.screenshot({ path: `${out}/${name}.png` });
        console.log(`saved ${out}/${name}.png`);
    }
    if (!inThread) {
        const s = await page.evaluate(() => {
            const st = window.__dwu.simStats;
            return { frames: st.renderFrames, deltas: st.deltas, hot: st.hotApplyMs / Math.max(1, st.renderFrames), cold: st.coldPumpMs / Math.max(1, st.renderFrames), maxHot: st.maxHotApplyMs, maxCold: st.maxColdPumpMs, workerStep: st.workerStepMs, workerDiff: st.workerDiffMs, kb: st.deltaBytes / 1024, backlog: st.coldBacklog };
        });
        console.log(`sync stats: ${JSON.stringify(s)}`);
    }
} finally {
    await browser.close();
    const errors = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
    for (const l of errors.slice(0, 30)) console.log(l);
    if (errors.length > 0) failed++;
    console.log(failed === 0 ? 'SMOKE OK' : `SMOKE FAILED (${failed})`);
    process.exitCode = failed === 0 ? 0 : 1;
}
