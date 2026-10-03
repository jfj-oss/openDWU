// Parity batch C1 captures: the shortcuts overlay (control groups, D, T, [, K), the display-type cycle (D), the panel
// cycle (T), H → the full message history, the Ground Report ("[") at its two first sizes, and a control group
// (Ctrl+1 on the capital, then Shift+1 from elsewhere). Boots ?autostart=1 (add ?simWorker=1 via the 4th argument).
// Usage: node scripts/parc1-shots.mjs <baseUrl> <outDir> [w] [h] [query]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/parc1', w = '1920', h = '1080', extra = ''] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${base}?autostart=1${extra ? `&${extra}` : ''}`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 240000 });
await page.waitForTimeout(4000);
const tag = extra ? `-${extra.replace(/[^a-z0-9]+/gi, '')}` : '';
const shot = async (name) => {
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${outDir}/${name}${tag}.png` });
    console.log(`${outDir}/${name}${tag}.png`);
};
const key = async (k) => {
    await page.mouse.move(+w / 2, +h / 2);
    await page.keyboard.press(k);
};

await key('?');
await shot('01-shortcuts');
await key('?');

// The capital: select it with the colony cycler, zoom to it (planet labels and rings show at system zoom).
await key('c');
await key('Backspace');
await shot('02-display0');
await key('d');
await shot('03-display1');
await key('d');
await shot('04-display2-bare');
await key('d');

await key('t');
await shot('05-panels-map-only');
await key('t');
await shot('06-panels-none');
await key('t');
await shot('07-panels-all');

await key('h');
await shot('08-h-message-history');
await key('Escape');

await key('BracketLeft');
await page.waitForSelector('[data-ow="groundReport"]', { timeout: 10000 }).catch(() => logs.push('[script] no ground report window'));
await shot('09-ground-report');
// Hover the first troop for the hotspot message.
const img = page.locator('[data-ow="groundReport"] .gr-img').first();
if ((await img.count()) > 0) {
    const b = await img.boundingBox();
    if (b) await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await shot('10-ground-report-hover');
}
const glyph = page.locator('[data-ow="groundReport"] .gr-resize');
if ((await glyph.count()) > 0) {
    await glyph.click();
    await shot('11-ground-report-expanded');
}
await key('BracketLeft');

// Control group 1 = the capital; zoom out, deselect with an empty group (2), then Shift+1 re-selects and centres.
await key('Control+Digit1');
await key('End');
await key('Digit2');
await shot('12-group-empty-deselects');
await key('Shift+Digit1');
await shot('13-group1-focus');

console.log(logs.length ? logs.join('\n') : 'no console errors');
await browser.close();
