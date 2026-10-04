#!/usr/bin/env node
// Improvements "supplyChain" screenshots, layout checks and timings: the Supply Shortages overlay (galaxy zoom, a
// marker's hover tooltip), the Construction Yards screen's Waiting For tab, the selection panel's Waiting row, the
// resource supply panel (and its Highlight on map), the Game Options → Improvements window, and the improvement switched
// off. Worker mode (default) turns on the replica write detector (?detectWrites=1) and fails on any write it finds.
//   node scripts/supplychain-shots.mjs <base url> [--out=shots/supplychain] [--inthread] [--load=/dev-saves/late2500.dwusave]
//                                      [--tag=<name>] [--run=<game seconds at speed 4 before the shots>]
// Default: a fresh ?autostart=1 game (the script buys ships at the capital's yard so its queue waits for resources).
// Screenshots are written, not opened; the checks print ok / FAIL lines and the timings a JSON block.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const opt = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const inThread = process.argv.includes('--inthread');
const load = opt('load', '');
const tag = `${opt('tag', load ? 'late' : 'new')}-${inThread ? 'inthread' : 'worker'}`;
const out = opt('out', 'shots/supplychain');
const runSeconds = Number(opt('run', load ? '8' : '30'));
mkdirSync(out, { recursive: true });
const start = load ? `load=${encodeURIComponent(load)}` : 'autostart=1';
const url = `${base}?${start}&simWorker=${inThread ? 0 : 1}${inThread ? '' : '&detectWrites=1'}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const logs = [];
page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.stack ?? e.message}`));
let failed = 0;
const check = (ok, what) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok) failed++;
};
const shots = [];
const shot = async (name) => {
    const path = `${out}/${tag}-${name}.png`;
    await page.screenshot({ path });
    shots.push(path);
};
const closeWindows = async () => {
    // The windows' close buttons (Escape on no window would open the game menu).
    await page.evaluate(() => document.querySelectorAll('.ow-layer .ow-close').forEach((b) => b.click()));
    await page.waitForTimeout(300);
};

/** The supply census of the player's empire (forced recompute) and the cost of computing it. */
async function census() {
    return page.evaluate(() => {
        const d = window.__dwu;
        const times = [];
        let snap = null;
        for (let i = 0; i < 6; i++) {
            const t = performance.now();
            snap = d.supply.snapshot(true);
            times.push(performance.now() - t);
        }
        times.sort((a, b) => a - b);
        const sites = snap.sites;
        const short = sites.filter((s) => s.resources.length > 0);
        // The site to show: stalled / nothing coming first, then the one lacking most.
        const pick = [...short].sort((a, b) => Number(b.stalled || b.nothingComing) - Number(a.stalled || a.nothingComing) || b.resources.length - a.resources.length)[0] ?? null;
        let topRes = -1;
        let topScore = 0;
        for (const s of short) for (const r of s.resources) if (r.missing + 10 * r.uncovered > topScore) [topRes, topScore] = [r.resourceId, r.missing + 10 * r.uncovered];
        let deliveries = 0;
        for (const s of short) for (const r of s.resources) deliveries += r.orders?.deliveries.length ?? 0;
        return {
            colonies: d.galaxy.playerEmpire.colonies.length,
            sites: sites.length,
            items: sites.reduce((n, s) => n + s.items.length, 0),
            shortSites: short.length,
            stalledSites: sites.filter((s) => s.stalled).length,
            nothingComingSites: sites.filter((s) => s.nothingComing).length,
            deliveries,
            shortColonies: snap.shortColonies.length,
            fallingColonies: snap.shortColonies.filter((c) => c.developmentFalling).length,
            pick: pick === null ? null : { name: pick.name, x: pick.target.xpos, y: pick.target.ypos, stalled: pick.stalled, resources: pick.resources.length },
            topRes,
            snapshotMs: { min: +times[0].toFixed(2), median: +times[3].toFixed(2), max: +times[5].toFixed(2) },
        };
    });
}

/** Centre on a world point at zoom factor f (world units per px; 'min' = the whole galaxy). */
async function view(x, y, f) {
    await page.evaluate(
        ({ x, y, f }) => {
            const cam = window.__dwu.camera;
            cam.centerOn(x, y);
            cam.zoomAt(f === 'min' ? cam.minZoom : 1 / f, cam.width / 2, cam.height / 2);
            cam.centerOn(x, y);
        },
        { x, y, f },
    );
    await page.waitForTimeout(1500);
}

/** The Waiting For tab's strip fits the window, and the grid columns are on screen. */
async function yardsLayout() {
    return page.evaluate(() => {
        const w = document.querySelector('[data-ow="yards"]');
        if (!w) return { ok: false, why: 'no window' };
        const strip = w.querySelector('.ow-tabs');
        const tabs = [...strip.querySelectorAll('.ow-tab')].filter((t) => !t.hidden);
        const sr = strip.getBoundingClientRect();
        const last = tabs[tabs.length - 1].getBoundingClientRect();
        return { ok: last.right <= sr.right + 1, why: `last tab right ${last.right.toFixed(0)} vs strip ${sr.right.toFixed(0)}`, labels: tabs.map((t) => t.textContent) };
    });
}

/** The write detector's not-allowed findings after a full compare (worker mode; null when it is not installed). */
async function replicaWrites() {
    return page.evaluate(() => {
        const det = window.__dwuWriteDetector;
        if (!det) return null;
        det.checkAll();
        return { unexpected: det.unexpected().map((w) => `${w.key} ×${w.count} ${w.detail}${w.stack ? `\n${w.stack.split('\n').slice(0, 6).join('\n')}` : ''}`), summary: det.summary() };
    });
}

try {
    await page.goto(url);
    await page.waitForFunction(() => window.__dwu?.time !== undefined && window.__dwu?.supply && window.__dwu?.galaxy?.playerEmpire, null, { timeout: 900000 });
    await page.waitForTimeout(3000);
    if (!load) {
        // Buy ships at the capital's yard so its queue has to wait for resources.
        await page.click('[data-hud="tbtnConstructionYards"]');
        await page.waitForSelector('[data-ow="yards"] .ow-grid-row');
        await page.waitForTimeout(800);
        const buy = page.locator('[data-ow="yards"] .ow-glass', { hasText: 'Purchase' });
        for (let i = 0; i < 6; i++) {
            if (await buy.isEnabled()) {
                await buy.click();
                await page.waitForTimeout(300);
                const box = page.locator('[data-ow="msgbox"] .ow-glass', { hasText: 'Leave on' });
                if (await box.count()) await box.click();
                await page.waitForTimeout(400);
            }
        }
        await closeWindows();
    }
    await page.evaluate(() => {
        window.__dwu.time.paused = false;
        window.__dwu.time.speed = 4;
    });
    await page.waitForTimeout(runSeconds * 1000);
    await page.evaluate(() => {
        window.__dwu.time.paused = true;
    });
    await page.waitForTimeout(2500);

    const c = await census();
    console.log(`supply census (${inThread ? 'in-thread game' : 'replica'}): ${JSON.stringify(c)}`);
    check(c.sites > 0, `the player has construction sites with queues (${c.sites})`);

    // --- Supply Shortages overlay: the View popup's Improvements section ---
    const p = await page.evaluate(() => {
        const e = window.__dwu.galaxy.playerEmpire;
        const h = e.capital ?? e.colonies[0];
        return { x: h.xpos, y: h.ypos };
    });
    const toggle = page.locator('.hud-options-toggle');
    if (!(await page.locator('.hud-options-pop.open').count())) await toggle.click();
    await page.waitForTimeout(300);
    const heads = await page.locator('.hud-options .hud-section-head').allTextContents();
    check(heads.includes('Improvements'), `View popup has an Improvements section (${heads.join(' / ')})`);
    const row = page.locator('.hud-options [data-overlay="supplyShortages"]');
    check((await row.count()) === 1 && (await row.locator('.hud-option-mod').count()) === 0, 'Supply Shortages row under Improvements, without the + badge');
    await row.click();
    await page.waitForTimeout(400);
    await shot('view-popup');
    await toggle.click();
    await view(p.x, p.y, 'min');
    await page.waitForTimeout(1200);
    const overlay = await page.evaluate(() => {
        const s = window.__dwu.view.overlayLayer.supply;
        return { markers: s.currentMarkers.length, drawn: s.count };
    });
    console.log(`overlay: ${JSON.stringify(overlay)}`);
    await shot('overlay-galaxy');
    const target = c.pick ?? (await page.evaluate(() => {
        const m = window.__dwu.view.overlayLayer.supply.currentMarkers[0];
        return m ? { name: m.target.name, x: m.target.xpos, y: m.target.ypos } : null;
    }));
    if (target !== null) {
        check(overlay.markers > 0, `overlay marks ${overlay.markers} sites / colonies`);
        await view(target.x, target.y, 400);
        // Hover the marker: the tooltip lists what is short.
        const sp = await page.evaluate(({ x, y }) => {
            const d = window.__dwu;
            const s = d.camera.worldToScreen(x, y);
            const r = d.app.canvas.getBoundingClientRect();
            return { x: s.x + r.left, y: s.y + r.top };
        }, target);
        await page.mouse.move(sp.x + 3, sp.y + 2);
        await page.waitForTimeout(150);
        await page.mouse.move(sp.x + 1, sp.y + 1);
        await page.waitForTimeout(700);
        const tip = await page.evaluate(() => document.querySelector('.dwu-map-tooltip')?.textContent ?? '');
        console.log(`tooltip: ${JSON.stringify(tip)}`);
        check(tip.length > 0 && /short|stalled|falling|luxur/i.test(tip), 'hovering a marker shows what is short');
        await shot('overlay-tooltip');
        await page.mouse.move(5, 500);
    } else {
        console.log('no shortage anywhere in the player empire: overlay shots show no markers');
    }

    // --- Construction Yards → Waiting For ---
    await page.click('[data-hud="tbtnConstructionYards"]');
    await page.waitForSelector('[data-ow="yards"] .ow-grid-row');
    await page.waitForTimeout(1200);
    if (c.pick !== null) {
        const rowSel = page.locator('[data-ow="yards"] .ow-grid').first().locator('.ow-grid-row', { hasText: c.pick.name }).first();
        if (await rowSel.count()) {
            await rowSel.scrollIntoViewIfNeeded();
            await rowSel.click();
        }
        await page.waitForTimeout(800);
    }
    await page.locator('[data-ow="yards"] .ow-tab', { hasText: 'Waiting For' }).click();
    await page.waitForTimeout(1500);
    const lay = await yardsLayout();
    check(lay.ok, `yards tab strip fits (${lay.why}; ${lay.labels?.join(' | ')})`);
    const waiting = await page.evaluate(() => {
        const pg = [...document.querySelectorAll('[data-ow="yards"] .cy-page')].find((x) => !x.hidden);
        const rows = [...pg.querySelectorAll('.ow-grid-row')];
        return { rows: rows.length, none: rows.filter((r) => r.classList.contains('cy-need-none')).length, coming: rows.filter((r) => r.classList.contains('cy-need-coming')).length, first: rows[0]?.textContent ?? '' };
    });
    console.log(`waiting-for rows: ${JSON.stringify(waiting)}`);
    if (c.pick !== null) check(waiting.rows > 0, `Waiting For lists the queue of ${c.pick.name}`);
    await shot('yards-waiting');

    // Go to the site: the selection panel's Waiting row.
    await page.locator('[data-ow="yards"] .ow-glass', { hasText: 'Go to Ship' }).first().click();
    await page.waitForTimeout(1500);
    const selText = await page.evaluate(() => document.body.innerText.match(/Waiting[^\n]*\n?[^\n]*/)?.[0] ?? '');
    console.log(`selection panel: ${JSON.stringify(selText.slice(0, 200))}`);
    if (c.pick !== null) check(selText.startsWith('Waiting'), 'the selection panel shows the Waiting row');
    await shot('selection-waiting');

    // --- Resource supply panel ---
    const rid = c.topRes >= 0 ? c.topRes : await page.evaluate(() => window.__dwu.galaxy.playerEmpire.colonies[0].resources[0]?.resourceId ?? 0);
    await page.evaluate((id) => window.__dwu.supply.openResource(id), rid);
    await page.waitForSelector('[data-ow="resourcesupply"]');
    await page.waitForTimeout(1500);
    const rs = await page.evaluate(() => {
        const w = document.querySelector('[data-ow="resourcesupply"]');
        const grids = [...w.querySelectorAll('.ow-grid')].map((g) => g.querySelectorAll('.ow-grid-row').length);
        return { title: w.querySelector('.ow-title')?.textContent, grids };
    });
    console.log(`resource panel: ${JSON.stringify(rs)}`);
    check(/Resource Supply: /.test(rs.title ?? ''), 'resource supply panel opens');
    await shot('resource-panel');
    await page.locator('[data-ow="resourcesupply"] .ow-glass', { hasText: 'Highlight on map' }).click();
    await page.waitForTimeout(400);
    // Drag the window to the right so the map shows.
    const hdr = await page.locator('[data-ow="resourcesupply"] .ow-header').boundingBox();
    await page.mouse.move(hdr.x + 60, hdr.y + 20);
    await page.mouse.down();
    await page.mouse.move(hdr.x + 60 + 700, hdr.y + 20, { steps: 8 });
    await page.mouse.up();
    await view(p.x, p.y, 3000);
    const hl = await page.evaluate(() => {
        const f = window.__dwu.view.freightOverlay;
        return { routes: f.highlight?.routes.length ?? 0, filter: f.filter.resourceId ?? null };
    });
    console.log(`highlight: ${JSON.stringify(hl)}`);
    check(hl.filter === rid, 'Highlight on map filters Freight Flows to the resource');
    await shot('resource-highlight');
    await closeWindows();
    const hl2 = await page.evaluate(() => window.__dwu.view.freightOverlay.filter.resourceId ?? null);
    check(hl2 === null, 'closing the panel ends the highlight');

    // --- Empire Summary link ---
    await page.keyboard.press('F6');
    await page.waitForTimeout(1200);
    check((await page.locator('.es-supply').count()) === 1, 'Empire Summary has the Supply by resource link');
    await shot('summary-link');
    await closeWindows();

    // --- Game Options → Improvements, switched off ---
    await page.keyboard.press('o');
    await page.waitForSelector('[data-ow="gameoptions"]');
    await page.locator('[data-ow="gameoptions"] .ow-glass', { hasText: 'Improvements' }).click();
    await page.waitForSelector('[data-ow="gameoptions-improvements"]');
    await page.waitForTimeout(500);
    await shot('options-improvements');
    await page.locator('[data-ow="gameoptions-improvements"] [data-improvement="supplyChain"] input').click();
    await page.waitForTimeout(500);
    await closeWindows();
    await view(p.x, p.y, 'min');
    const off = await page.evaluate(() => ({ drawn: window.__dwu.view.overlayLayer.supply.count, row: document.querySelectorAll('.hud-options [data-overlay="supplyShortages"]').length, snap: window.__dwu.supply.snapshot(true) }));
    check(off.drawn === 0 && off.row === 0 && off.snap === null, `improvement off: no markers (${off.drawn}), no overlay row (${off.row}), no queries`);
    await page.click('[data-hud="tbtnConstructionYards"]');
    await page.waitForSelector('[data-ow="yards"] .ow-grid-row');
    await page.waitForTimeout(800);
    const tabHidden = await page.evaluate(() => [...document.querySelectorAll('[data-ow="yards"] .ow-tab')].filter((t) => /Waiting For/.test(t.textContent) && !t.hidden).length === 0);
    check(tabHidden, 'improvement off: no Waiting For tab');
    await shot('off-yards');
    await closeWindows();
    // Back on (the setting persists in localStorage for the next run).
    await page.keyboard.press('o');
    await page.waitForSelector('[data-ow="gameoptions"]');
    await page.locator('[data-ow="gameoptions"] .ow-glass', { hasText: 'Improvements' }).click();
    await page.waitForSelector('[data-ow="gameoptions-improvements"]');
    await page.locator('[data-ow="gameoptions-improvements"] [data-improvement="supplyChain"] input').click();
    await closeWindows();

    // --- Timings: the overlay frame (cached snapshot) and a refresh (snapshot recomputed) ---
    const perf = await page.evaluate(() => {
        const d = window.__dwu;
        const s = d.view.overlayLayer.supply;
        const cam = d.camera;
        const res = {};
        const frame = [];
        for (let i = 0; i < 60; i++) {
            const t = performance.now();
            s.update(cam.zoom, cam);
            frame.push(performance.now() - t);
        }
        frame.sort((a, b) => a - b);
        res.overlayFrameMs = { median: +frame[30].toFixed(3), max: +frame[59].toFixed(3) };
        const refresh = [];
        for (let i = 0; i < 5; i++) {
            d.supply.invalidate();
            s.queriedAt = -Infinity;
            const t = performance.now();
            s.update(cam.zoom, cam);
            refresh.push(performance.now() - t);
        }
        refresh.sort((a, b) => a - b);
        res.overlayRefreshMs = { median: +refresh[2].toFixed(2), max: +refresh[4].toFixed(2) };
        res.stats = { ...d.supply.stats };
        return res;
    });
    console.log(`timings: ${JSON.stringify(perf)}`);

    if (!inThread) {
        const w = await replicaWrites();
        if (w === null) console.log('write detector: not installed');
        else {
            if (w.summary) console.log(`write detector findings (all):\n${w.summary}`);
            check(w.unexpected.length === 0, `no replica writes${w.unexpected.length ? `:\n${w.unexpected.join('\n')}` : ''}`);
        }
    }
} catch (e) {
    console.log(`FAIL script error: ${e.stack ?? e}`);
    failed++;
} finally {
    const errors = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
    if (logs.length) console.log(`console (${logs.length}):\n${logs.slice(0, 40).join('\n')}`);
    check(errors.length === 0, `no console errors (${errors.length})`);
    console.log(`shots:\n${shots.join('\n')}`);
    await browser.close();
    process.exit(failed > 0 ? 1 : 0);
}
