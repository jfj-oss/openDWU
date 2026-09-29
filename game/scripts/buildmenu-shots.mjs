// Build Order panel with a design picked per category. Usage: node scripts/buildmenu-shots.mjs <baseUrl> <outDir>
import { chromium } from 'playwright-core';
const [base = 'http://localhost:5173/', outDir = 'shots'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => m.type() === 'error' && !m.text().includes('ERR_CONNECTION') && logs.push(m.text()));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${base}?autostart=1`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 120000 });
await page.waitForTimeout(2500);
// The start empire has one design per class: give Escort and Frigate a second (a renamed copy) to pick between.
await page.evaluate(() => {
    const e = window.__dwu.galaxy.playerEmpire;
    for (const role of [1, 2]) {
        const d = e.designs.find((x) => x.subRole === role);
        const c = Object.assign(Object.create(Object.getPrototypeOf(d)), d);
        c.name = d.name + ' Mk II';
        c.dateCreated = d.dateCreated + 1;
        e.designs.push(c);
    }
});
await page.keyboard.press('F9');
await page.waitForSelector('.build-order-window');
const info = await page.$$eval('.build-order-design', (ss) => ss.map((s) => ({ role: s.dataset.subRole, n: s.options.length, labels: [...s.options].map((o) => o.textContent) })));
console.log(JSON.stringify(info));
const multi = 1;
const target = page.locator('.build-order-design').nth(multi >= 0 ? multi : 0);
if (multi >= 0) await target.selectOption({ index: 1 });
const row = target.locator('xpath=ancestor::div[contains(@class,"build-order-row")]');
await row.locator('input.build-order-amount').fill('2');
await row.locator('input.build-order-amount').dispatchEvent('input');
await page.waitForTimeout(500);
console.log('picked', await target.evaluate((s) => s.options[s.selectedIndex].textContent), '| row', await row.innerText());
await page.screenshot({ path: `${outDir}/buildmenu-design-picker.png` });
await page.click('.build-order-purchase');
await page.waitForTimeout(1500);
const queued = await page.evaluate(() => {
    const { galaxy } = window.__dwu;
    const e = galaxy.playerEmpire;
    const out = [];
    for (const site of [...e.builtObjects, ...e.privateBuiltObjects, ...e.colonies]) {
        const q = site.constructionQueue;
        if (!q) continue;
        for (const y of q.constructionYards ?? []) if (y.shipUnderConstruction) out.push(y.shipUnderConstruction.design.name);
        for (const b of q.constructionWaitQueue ?? []) out.push('wait:' + b.design.name);
    }
    return out;
});
console.log('yard designs', JSON.stringify(queued));
await page.screenshot({ path: `${outDir}/buildmenu-after-purchase.png` });
await browser.close();
for (const l of logs) console.log(l);
