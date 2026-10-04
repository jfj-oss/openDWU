// New Game wizard captures (WP1 restyle): every page of the wizard (Playstyle, Jump Start standard + pirate, The
// Galaxy default + custom size with the density warning, Colonization and Territory, Your Race, Your Empire standard +
// pirate, Other Empires with a manual row, Victory Conditions, Scenario with add-ons ticked, Start).
// Usage: node scripts/wizard-shots.mjs <baseUrl> <outDir> <tag> [w] [h]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const [base = 'http://localhost:5173/', outDir = 'shots/wizard', tag = 'after', w = '1600', h = '900'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const base1 = base.replace(/\/$/, '') + '/';
let errors = 0;

/** [file name, query, optional action before the shot] */
const PAGES = [
    ['01-playstyle', 'page=type'],
    ['02-jumpstart', 'page=jumpstart&type=ClassicEra'],
    ['03-jumpstart-pirate', 'page=jumpstart&type=ShadowsPirate'],
    ['04-galaxy', 'page=galaxy'],
    [
        '05-galaxy-custom-size',
        'page=galaxy',
        async (page) => {
            const type = async (sel, v) => {
                const box = page.locator(`${sel}:visible`).first();
                await box.fill(String(v));
                await box.press('Tab');
            };
            await type('.wizard-sectors-w', 90);
            await type('.wizard-sectors-h', 90);
            await type('.wizard-star-count', 500);
        },
    ],
    ['06-colonization', 'page=colonization'],
    ['07-race', 'page=race'],
    ['08-empire', 'page=empire'],
    ['09-empire-pirate', 'page=empire&type=CustomPirate'],
    [
        '10-other-empires',
        'page=empires',
        async (page) => {
            const add = page.locator('.wizard-empires-add-btn:visible').first();
            if ((await add.count()) > 0) {
                await add.click();
                await add.click();
            }
        },
    ],
    ['11-victory', 'page=victory'],
    ['12-scenario', 'page=scenario'],
    ['13-scenario-addons', 'page=scenario&addons=timebomb,robotmutiny'],
    ['14-start', 'page=start'],
];

for (const [name, query, action] of PAGES) {
    const page = await browser.newPage({ viewport: { width: +w, height: +h } });
    const logs = [];
    page.on('console', (m) => {
        if (m.type() === 'error') logs.push(m.text());
    });
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
    try {
        await page.goto(`${base1}?screen=wizard&${query}`);
        await page.waitForSelector('.wizard-window', { state: 'visible', timeout: 120000 });
        await page.waitForFunction(() => !document.querySelector('.wizard-race-loading'), null, { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(2500);
        if (action) await action(page);
        await page.waitForTimeout(700);
        const path = `${outDir}/${name}-${tag}.png`;
        await page.screenshot({ path });
        console.log(`saved ${path}`);
    } catch (err) {
        console.log(`FAIL ${name}: ${err.message}`);
        errors++;
    }
    for (const l of logs) console.log(`  [${name} console] ${l}`);
    errors += logs.length;
    await page.close();
}
await browser.close();
console.log(errors === 0 ? 'no errors' : `${errors} error(s)`);
