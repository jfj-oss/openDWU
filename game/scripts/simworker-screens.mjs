#!/usr/bin/env node
// Sim worker chunk 6 browser check (docs/sim-worker.md §9): boot a game (?simWorker=1, or --inthread for 0), let it
// run, pause, then open every empire-management screen, screenshot it and close it. In worker mode, with the game
// paused, the replica's state digest must equal the worker's before and after the screens (a screen that wrote the
// replica or drew its RNG would make them differ), and a screen order (a new fleet design) must reach the replica.
//   node scripts/simworker-screens.mjs <base url> [--out=shots/simworker-screens] [--inthread] [--load=/dev-saves/x.dwusave]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const opt = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const inThread = process.argv.includes('--inthread');
const load = opt('load', '');
const out = opt('out', `shots/simworker-screens${inThread ? '-inthread' : ''}`);
mkdirSync(out, { recursive: true });
const url = `${base}?${load ? `load=${encodeURIComponent(load)}` : 'autostart=1'}&simWorker=${inThread ? 0 : 1}`;
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

/** Replica digest (main thread) and the worker's, once the paused worker has settled (polled: up to 60 s). */
async function digests() {
    let d = await digestsNow();
    for (let i = 0; i < 30 && d.replica !== d.worker; i++) {
        await page.waitForTimeout(2000);
        d = await digestsNow();
    }
    return d;
}

async function digestsNow() {
    return page.evaluate(async () => {
        const { stateDigest } = await import('/src/sim/tick/digest.ts');
        const d = window.__dwu;
        const replica = stateDigest(d.galaxy);
        const worker = d.simWorker ? (await d.simWorker.digest()).digest : replica;
        return { replica, worker };
    });
}

// [name, opener, window selector]
const SCREENS = [
    ['colonies', { hud: 'tbtnColonies' }, '[data-ow="colonies"]'],
    ['ships-and-bases', { key: 'F11' }, '[data-ow="ships"]'],
    ['fleets', { hud: 'tbtnShipGroups' }, '[data-ow="fleets"]'],
    ['designs', { hud: 'tbtnDesigns' }, '[data-ow="designs"]'],
    ['build-order', { hud: 'btnBuildOrder' }, '[data-ow="buildorder"]'],
    ['construction-yards', { hud: 'tbtnConstructionYards' }, '[data-ow="yards"]'],
    ['troops', { hud: 'tbtnTroops' }, '[data-ow="troops"]'],
    ['research', { hud: 'tbtnResearch' }, '[data-ow="research"]'],
    ['expansion-planner', { hud: 'btnExpansionPlanner' }, '[data-ow="expansion"]'],
    ['empire-summary', { hud: 'btnEmpireSummary' }, '[data-ow="summary"]'],
    ['empire-policy', { hud: 'btnEmpirePolicy' }, '.policy-window'],
];

try {
    await page.goto(url);
    await page.waitForFunction(() => window.__dwu?.time !== undefined && window.__dwu?.view !== undefined, null, { timeout: 600000 });
    check(inThread ? true : await page.evaluate(() => window.__dwu.simWorker !== null), inThread ? 'in-thread game runs' : 'game runs in the worker');
    await page.evaluate(() => {
        window.__dwu.time.paused = false;
        window.__dwu.time.speed = 4;
    });
    await page.waitForTimeout(6000);
    await page.evaluate(() => {
        window.__dwu.time.paused = true;
    });
    // Paused: the worker keeps comparing for two cold cycles, then the replica is exact.
    await page.waitForTimeout(6000);
    const d0 = await digests();
    if (!inThread) check(d0.replica === d0.worker, `replica digest = worker digest before the screens (${d0.replica.slice(0, 12)})`);

    for (const [name, open, sel] of SCREENS) {
        if (open.hud) {
            const btn = page.locator(`[data-hud="${open.hud}"]`).first();
            if ((await btn.count()) === 0) {
                check(false, `${name}: no ${open.hud} button`);
                continue;
            }
            await btn.click();
        } else await page.keyboard.press(open.key);
        let opened = true;
        await page.waitForSelector(sel, { timeout: 15000 }).catch(() => (opened = false));
        check(opened, `${name} opens`);
        await page.waitForTimeout(2500);
        await page.screenshot({ path: `${out}/${name}.png` });
        if (name === 'fleets') {
            const tab = page.locator('[data-ow="fleets"] .ow-tab', { hasText: 'Fleet Designs' });
            if (await tab.count()) {
                await tab.click();
                await page.waitForTimeout(1000);
                await page.screenshot({ path: `${out}/fleet-designs.png` });
            }
        }
        await page.keyboard.press('Escape');
        await page.waitForTimeout(600);
        if (await page.locator(sel).count()) {
            // Not closed by Escape: toggle with the opener.
            if (open.hud) await page.locator(`[data-hud="${open.hud}"]`).first().click().catch(() => {});
            else await page.keyboard.press(open.key);
            await page.waitForTimeout(600);
        }
    }
    await page.waitForTimeout(6000);
    const d1 = await digests();
    if (!inThread) check(d1.replica === d1.worker, `replica digest = worker digest after opening every screen (${d1.replica.slice(0, 12)})`);
    check(d1.worker === d0.worker, 'the paused game did not change while the screens were open');

    // A screen order through the worker: rename the empire from the Empire Summary's name box path (command), and see it
    // on the replica.
    const renamed = await page.evaluate(async () => {
        const d = window.__dwu;
        const p = d.game.playerEmpire;
        const { issuePlayerCommand } = await import('/src/sim/player/playerCommands.ts');
        return new Promise((resolve) => {
            issuePlayerCommand(d.galaxy, p, 'empireRename', ['Worker Screens'], () => resolve(p.name));
            setTimeout(() => resolve(`(no reply) ${p.name}`), 20000);
        });
    });
    check(renamed === 'Worker Screens', `empire rename reply sees the new name (${renamed})`);
    await page.click('[data-hud="btnEmpireSummary"]');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${out}/empire-summary-renamed.png` });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);

    // Designs → Copy As New → (automation prompt: turn it off, a command) → the Design Editor → Save (a by-value
    // DesignDraft through the worker): the saved copy shows up in the replica's designs.
    await page.click('[data-hud="tbtnDesigns"]');
    await page.waitForSelector('[data-ow="designs"] .ow-grid-row', { timeout: 15000 });
    await page.waitForTimeout(1000);
    const designsBefore = await page.evaluate(() => window.__dwu.game.playerEmpire.designs.length);
    await page.locator('[data-ow="designs"] .ow-grid-row').first().click();
    await page.locator('[data-ow="designs"] .ow-glass', { hasText: 'Copy As New' }).click();
    const prompt = page.locator('[data-ow="msgbox"] .ow-glass', { hasText: 'Turn off automation' });
    await prompt.waitFor({ timeout: 3000 }).then(() => prompt.click(), () => {});
    const ed = await page.waitForSelector('[data-ow="design-editor"]', { timeout: 10000 }).then(() => true, () => false);
    check(ed, 'design editor opens (Copy As New)');
    if (ed) {
        await page.waitForTimeout(1500);
        await page.screenshot({ path: `${out}/design-editor.png` });
        await page.locator('[data-ow="design-editor"] .ow-glass', { hasText: /^Save$/ }).first().click();
        // A warning box may ask to confirm; accept it.
        const yes = page.locator('[data-ow="msgbox"] .ow-glass', { hasText: /^(Yes|OK)$/ });
        await yes.first().waitFor({ timeout: 3000 }).then(() => yes.first().click(), () => {});
        await page.waitForTimeout(4000);
        const designsAfter = await page.evaluate(() => window.__dwu.game.playerEmpire.designs.length);
        check(designsAfter === designsBefore + 1, `saved design reaches the replica (${designsBefore} → ${designsAfter})`);
        await page.screenshot({ path: `${out}/designs-after-save.png` });
    }
} catch (err) {
    check(false, `script error: ${err instanceof Error ? err.message : String(err)}`);
} finally {
    for (const l of logs.slice(0, 40)) console.log(l);
    console.log(logs.length ? `${logs.length} console errors/warnings` : 'no console errors');
    await browser.close();
}
process.exit(failed > 0 ? 1 : 0);
