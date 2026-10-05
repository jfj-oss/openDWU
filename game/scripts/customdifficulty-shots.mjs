// Custom difficulty captures: the Galaxy page and the Jump Start page with a custom difficulty typed in.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const [base = 'http://localhost:5196/', outDir = 'shots/customdifficulty'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const read = (page) => page.evaluate(() => {
    const q = (sel) => [...document.querySelectorAll(sel)].find((e) => e.closest('.wizard-page')?.offsetParent != null);
    return { box: q('.wizard-difficulty-box')?.value, caption: q('.wizard-difficulty-caption')?.textContent, custom: q('.wizard-difficulty')?.classList.contains('wizard-difficulty-custom') };
});
const type = async (page, v) => {
    await page.fill('.wizard-difficulty-box:visible', String(v));
    await page.press('.wizard-difficulty-box:visible', 'Tab');
};
for (const [name, btn] of [['galaxy', '.wizard-type-custom .wizard-type-btn'], ['jumpstart', '.wizard-type-eras .wizard-type-btn:not([disabled])']]) {
    const logs = [];
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
    await page.goto(`${base}?screen=wizard`);
    await page.waitForSelector('.wizard-window', { state: 'visible', timeout: 60000 });
    await page.click(btn);
    await page.waitForSelector('.wizard-difficulty-box:visible', { timeout: 10000 });
    console.log(name, 'default', JSON.stringify(await read(page)));
    await type(page, 1.25);
    console.log(name, 'tick 1.25', JSON.stringify(await read(page)));
    await type(page, 9);
    console.log(name, 'clamp 9', JSON.stringify(await read(page)));
    await type(page, 1.43);
    console.log(name, 'custom 1.43', JSON.stringify(await read(page)));
    await page.waitForTimeout(700);
    const path = `${outDir}/wizard-${name}-custom-difficulty.png`;
    await page.screenshot({ path });
    console.log('saved', path);
    console.log(name, 'console errors:', logs.join(' | ') || 'none');
    await page.close();
}
await browser.close();
