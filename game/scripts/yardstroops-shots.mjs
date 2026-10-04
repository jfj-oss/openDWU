// Construction Yards / Ships and Bases detail tabs, in-thread and with ?simWorker=1: the Construction Yards tab's
// manufacturing-plant grids (method_169, scrolled into view), the Cargo tab's construction resource shortage label,
// the Troops tab's character portraits / troop pictures (CharacterTroopListIconView) and the ship troop loadout group
// (method_179: tick Use Troop Loadouts, a spinner step), and the Set Fleet combo forming a fleet (method_182).
// In-thread only, to have a shortage to show on a fresh start, the script (not the game) adds two deficient resources
// to the first base's manufacturing queue and gives the warships 600 troop capacity — screenshot staging, not game
// behaviour.
// Usage: node scripts/yardstroops-shots.mjs <baseUrl> <outDir> [w] [h]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/yardstroops', w = '1920', h = '1080'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

for (const mode of ['inthread', 'worker']) {
    const page = await browser.newPage({ viewport: { width: +w, height: +h } });
    const logs = [];
    page.on('console', (m) => {
        if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
    });
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
    const shot = async (name) => {
        await page.waitForTimeout(900);
        const path = `${outDir}/${name}-${mode}.png`;
        await page.screenshot({ path });
        console.log(`saved ${path}`);
    };
    const answer = async (...labels) => {
        for (const label of labels) {
            const b = page.locator('[data-ow="msgbox"] .ow-glass', { hasText: label });
            if (await b.count()) {
                await b.first().click();
                await page.waitForTimeout(300);
                return;
            }
            const c = page.locator('.order-confirm-button', { hasText: label });
            if (await c.count()) {
                await c.first().click();
                await page.waitForTimeout(300);
                return;
            }
        }
    };
    const run = async (ms) => {
        await page.evaluate(() => (window.__dwu.time.paused = false));
        await page.waitForTimeout(ms);
        await page.evaluate(() => (window.__dwu.time.paused = true));
    };
    try {
        await page.goto(`${base}?autostart=1${mode === 'worker' ? '&simWorker=1' : '&simWorker=0'}`);
        await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 300000 });
        await page.waitForTimeout(4000);
        await page.evaluate(() => (window.__dwu.time.paused = true));
        if (mode === 'inthread') {
            await page.evaluate(() => {
                const p = window.__dwu.game.playerEmpire;
                const g = window.__dwu.game.galaxy;
                // Troop capacity on the warships (none of the start fleet carries troops) for the loadout group.
                for (const x of p.builtObjects) if (x && x.role === 1 && x.troopCapacity === 0) x.troopCapacity = 600;
                const b = p.builtObjects.find((x) => x && x.manufacturingQueue);
                if (b) {
                    b.manufacturingQueue.deficientResources.checkAddResource(g.resources[0].resourceId, 0);
                    b.manufacturingQueue.deficientResources.checkAddResource(g.resources[1].resourceId, 0);
                }
            });
        }

        // --- Construction Yards: buy a ship, let the plants work, scroll the Construction Yards page to its grids.
        const yw = '[data-ow="yards"]';
        await page.click('[data-hud="tbtnConstructionYards"]');
        await page.waitForSelector(`${yw} .ow-grid-row`);
        await page.waitForTimeout(1500);
        const buy = page.locator(`${yw} .ow-glass`, { hasText: 'Purchase' });
        for (let i = 0; i < 2; i++) {
            if (await buy.isEnabled()) {
                await buy.click();
                await page.waitForTimeout(400);
                await answer('Leave on');
                await page.waitForTimeout(500);
            }
        }
        await run(5000);
        await page.waitForTimeout(1200);
        await shot('yards-tab');
        await page.evaluate((sel) => {
            const s = document.querySelector(`${sel} .dt-page-scroll`);
            if (s) s.scrollTop = 10000;
        }, yw);
        console.log(`${mode}: manufacturing rows: ${await page.locator(`${yw} .dt-page-scroll .ow-grid`).nth(2).locator('.ow-grid-row').count()} plants, ${await page.locator(`${yw} .dt-page-scroll .ow-grid`).nth(3).locator('.ow-grid-row').count()} waiting`);
        await shot('yards-manufacturing');
        // Cargo tab: the shortage label.
        await page.locator(`${yw} .ow-tab`).nth(0).click();
        console.log(`${mode}: shortage label: ${JSON.stringify(await page.locator(`${yw} .dt-shortage`).allTextContents())}`);
        await shot('yards-cargo');
        // Troops tab on a colony (the last rows): portraits and troop pictures.
        await page.locator(`${yw} .ow-tab`).nth(4).click();
        const siteRows = page.locator(`${yw} .ow-grid`).first().locator('.ow-grid-row');
        await siteRows.nth((await siteRows.count()) - 1).click();
        await page.waitForTimeout(800);
        console.log(`${mode}: colony troop icons: ${await page.locator(`${yw} .dt-icon`).count()}`);
        await shot('yards-troops-colony');
        await siteRows.nth(0).click();
        await shot('yards-troops-base');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);

        // --- Ships and Bases: a warship's Troops tab, the loadout group, Set Fleet.
        const sw = '[data-ow="ships"]';
        await page.keyboard.press('F11');
        await page.waitForSelector(`${sw} .ow-grid-row`);
        await page.waitForTimeout(1000);
        await page.selectOption(`${sw} .ships-filter`, 'Military Ships');
        await page.waitForTimeout(600);
        const rows = page.locator(`${sw} .ships-grid .ow-grid-row`);
        await rows.nth(0).click();
        await page.locator(`${sw} .ships-tabs .ow-tab`).nth(4).click();
        // A warship with troop capacity (lblTroopLoadoutTotal "0 / N", N > 0) when there is one.
        const total = () => page.locator(`${sw} .dt-group .ow-text`).last().textContent();
        for (let i = 0, n = Math.min(await rows.count(), 25); i < n; i++) {
            await rows.nth(i).click();
            await page.waitForTimeout(250);
            if (!/\/ 0$/.test((await total()) ?? '')) break;
        }
        await shot('ships-troops');
        // Untick (255s: the policy recruits), then tick: (byte)(TroopCapacity / 100) Infantry.
        const box = page.locator(`${sw} .dt-group-caption input`);
        if (await box.isChecked()) {
            await box.click();
            await page.waitForTimeout(1200);
            await shot('ships-troops-loadout-off');
        }
        await page.locator(`${sw} .dt-group-caption input`).click();
        await page.waitForTimeout(1200);
        console.log(`${mode}: loadout: ${JSON.stringify(await page.locator(`${sw} .dt-num`).evaluateAll((ns) => ns.map((n) => n.value)))} ${JSON.stringify(await page.locator(`${sw} .dt-group .ow-text`).last().textContent())}`);
        await shot('ships-troops-loadout-on');
        const inf = page.locator(`${sw} .dt-num`).first();
        if (await inf.isEnabled()) {
            const v = Number(await inf.inputValue());
            await inf.fill(String(Math.max(0, v - 1)));
            await inf.press('Enter');
            await inf.dispatchEvent('change');
            await page.waitForTimeout(1200);
            console.log(`${mode}: after spin: ${JSON.stringify(await page.locator(`${sw} .dt-num`).evaluateAll((ns) => ns.map((n) => n.value)))}`);
        }
        await shot('ships-troops-spin');
        // Set Fleet → (New Fleet): the Fleet Formation prompt, then the combo shows the last item (method_182).
        const before = await page.evaluate(() => window.__dwu.game.playerEmpire.shipGroups?.length ?? -1);
        await page.selectOption(`${sw} .ships-setfleet`, { label: '(New Fleet)' });
        await page.waitForTimeout(500);
        await answer('Leave on');
        await page.waitForTimeout(1500);
        const after = await page.evaluate(() => window.__dwu.game.playerEmpire.shipGroups?.length ?? -1);
        console.log(`${mode}: fleets ${before} → ${after}; combo shows ${JSON.stringify(await page.locator(`${sw} .ships-setfleet option:checked`).textContent())}`);
        await shot('ships-setfleet');
    } catch (e) {
        console.log(`${mode}: error ${e.message}`);
        await page.screenshot({ path: `${outDir}/error-${mode}.png` }).catch(() => {});
    }
    console.log(`${mode}: ${logs.length ? logs.join('\n') : 'no console errors'}`);
    await page.close();
}
await browser.close();
