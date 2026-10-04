// Theme (customization set) captures: the main menu's Change Theme panel (stock, then a theme selected), the menu
// after Switch Theme, and a game started on a theme (main view, research screen, the wizard's race page).
// Usage: node scripts/theme-shots.mjs <baseUrl> <outDir> [theme] [mode]
//   mode: "panel" (Change Theme panel + switch), "game" (?theme=<theme>&autostart=1 main view + research),
//         "race" (?theme=<theme>&screen=wizard, the Your Empire page), "all" (default)
//   Add ?simWorker=1 by setting SIMWORKER=1.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/themes', theme = 'RetreatUE Bacon', mode = 'all'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const slug = theme.replace(/[^A-Za-z0-9]+/g, '_');
const worker = process.env.SIMWORKER === '1' ? '&simWorker=1' : '';
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const logs = [];
const themed = new Set();
async function newPage() {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.on('console', (m) => {
        if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
    });
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
    page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()}`));
    page.on('response', (r) => {
        if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`);
        else if (r.url().includes('/Customization/')) themed.add(decodeURIComponent(new URL(r.url()).pathname));
    });
    return page;
}

if (mode === 'panel' || mode === 'all') try {
    const page = await newPage();
    await page.goto(base);
    await page.waitForSelector('.main-menu-item[data-id="changeTheme"]');
    await page.waitForTimeout(1500);
    await page.click('.main-menu-item[data-id="changeTheme"]');
    await page.waitForSelector('[data-ow="themes"] .ow-theme-radio');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${outDir}/panel-default.png` });
    await page.locator('[data-ow="themes"] .ow-theme-radio', { hasText: theme }).click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${outDir}/panel-${slug}.png` });
    await page.locator('[data-ow="themes"] .ow-glass', { hasText: 'Switch Theme' }).click();
    await page.waitForFunction(() => document.querySelector('.main-menu-theme')?.textContent?.includes(':'), null, { timeout: 60000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${outDir}/menu-after-switch-${slug}.png` });
    // persisted: a reload keeps the theme (GameOptions.CustomizationSetName)
    await page.reload();
    await page.waitForSelector('.main-menu-item');
    await page.waitForTimeout(1500);
    const label = await page.textContent('.main-menu-theme');
    console.log(`after reload: "${label}"`);
    // back to the default theme
    await page.click('.main-menu-item[data-id="changeTheme"]');
    await page.waitForSelector('[data-ow="themes"] .ow-theme-radio');
    await page.locator('[data-ow="themes"] .ow-theme-radio', { hasText: '(Default)' }).click();
    await page.waitForTimeout(500);
    await page.locator('[data-ow="themes"] .ow-glass', { hasText: 'Switch Theme' }).click();
    await page.waitForTimeout(2000);
    console.log(`after switching back: "${await page.textContent('.main-menu-theme')}"`);
    await page.close();
} catch (err) {
    logs.push(`[script] ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
}

if (mode === 'game' || mode === 'all') try {
    const page = await newPage();
    await page.goto(`${base}?theme=${encodeURIComponent(theme)}&autostart=1${worker}`);
    await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 300000 });
    await page.waitForTimeout(6000);
    await page.screenshot({ path: `${outDir}/game-${slug}${worker ? '-worker' : ''}.png` });
    console.log('game:', JSON.stringify(await page.evaluate(() => {
        const g = window.__dwu.game;
        return { races: g.galaxy.races?.length, player: g.playerEmpire.name, race: g.playerEmpire.dominantRace?.name, empires: g.galaxy.empires.length };
    })));
    await page.click('[data-hud="tbtnResearch"]');
    await page.waitForSelector('[data-ow="research"] .rs-node', { timeout: 60000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${outDir}/research-${slug}${worker ? '-worker' : ''}.png` });
    await page.close();
} catch (err) {
    logs.push(`[script] ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
}

if (mode === 'race' || mode === 'all') try {
    const page = await newPage();
    await page.goto(`${base}?theme=${encodeURIComponent(theme)}&screen=wizard`);
    await page.waitForTimeout(4000);
    // the wizard's "Your Empire" page (race portrait + attributes)
    const next = page.locator('button', { hasText: /Your Empire/ }).first();
    if (await next.count()) await next.click().catch(() => {});
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${outDir}/race-${slug}.png` });
    await page.close();
} catch (err) {
    logs.push(`[script] ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
}

const byDir = new Map();
for (const u of themed) {
    const d = u.split('/').slice(0, u.includes('/images/') ? 8 : 7).join('/');
    byDir.set(d, (byDir.get(d) ?? 0) + 1);
}
console.log(`theme files loaded: ${themed.size}`);
for (const [d, n] of [...byDir].sort((a, b) => b[1] - a[1]).filter(([d]) => !d.includes('/designTemplates/'))) console.log(`  ${n}\t${d}`);
console.log(logs.length ? logs.join('\n') : 'no console errors');
await browser.close();
