// Left-drag box selection captures: a drag box over the player's ships at system zoom (mid-drag and after release:
// selection rings + the "N ships selected" panel), the list action menu on a right click, and a galaxy-zoom drag.
// Usage: node scripts/boxselect-shots.mjs <baseUrl> <outDir>
import { chromium } from 'playwright-core';
const [base = 'http://localhost:5173/', outDir = 'shots'] = process.argv.slice(2);
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${base}?autostart=1`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 180000 });
await page.waitForTimeout(3000);

/** Pause, centre on the player's capital at `zoom`, and return the screen box around its selectable ships. */
async function setup(zoomKind) {
    return page.evaluate(async (zoomKind) => {
        const { galaxy, camera, time } = window.__dwu;
        if (time) time.paused = true;
        const hud = await import('/src/ui/hud.ts');
        const bs = await import('/src/render/boxSelect.ts');
        const player = galaxy.playerEmpire;
        const cap = player.capital;
        camera.centerOn(cap.xpos, cap.ypos);
        const z = zoomKind === 'galaxy' ? hud.SECTOR_LEVEL_ZOOM ?? camera.zoom / 50 : hud.SYSTEM_LEVEL_ZOOM;
        camera.zoomAt(z, camera.width / 2, camera.height / 2);
        hud.setSelection(null);
        const rect = document.querySelector('canvas').getBoundingClientRect();
        const pts = [];
        for (const b of player.builtObjects) {
            if (!bs.isBoxSelectable(b, player)) continue;
            const s = camera.worldToScreen(b.xpos, b.ypos);
            if (s.x < 40 || s.y < 40 || s.x > camera.width - 40 || s.y > camera.height - 200) continue;
            pts.push(s);
        }
        if (pts.length === 0) return { n: 0 };
        const x0 = Math.min(...pts.map((p) => p.x)) - 25;
        const y0 = Math.min(...pts.map((p) => p.y)) - 25;
        const x1 = Math.max(...pts.map((p) => p.x)) + 25;
        const y1 = Math.max(...pts.map((p) => p.y)) + 25;
        return { n: pts.length, x0: rect.left + x0, y0: rect.top + y0, x1: rect.left + x1, y1: rect.top + y1 };
    }, zoomKind);
}

async function drag(b, shot) {
    await page.mouse.move(b.x0, b.y0);
    await page.mouse.down({ button: 'left' });
    for (let i = 1; i <= 8; i++) await page.mouse.move(b.x0 + ((b.x1 - b.x0) * i) / 8, b.y0 + ((b.y1 - b.y0) * i) / 8);
    await page.waitForTimeout(300);
    if (shot) await page.screenshot({ path: `${outDir}/boxselect-dragging.png` });
    await page.mouse.up({ button: 'left' });
    await page.waitForTimeout(800);
    return page.evaluate(async () => {
        const hud = await import('/src/ui/hud.ts');
        const s = hud.getSelection();
        return {
            multi: s?.builtObjects?.length ?? 0,
            single: s?.builtObject?.name ?? null,
            name: document.querySelector('.hud-selection-name')?.textContent,
            sub: document.querySelector('.hud-selection-sub')?.textContent,
            rows: document.querySelectorAll('.hud-multi-row').length,
            buttons: Array.from(document.querySelectorAll('.order-action-btn')).map((b) => b.textContent),
        };
    });
}

const sys = await setup('system');
console.log('system setup', JSON.stringify(sys));
if (sys.n > 0) {
    await page.waitForTimeout(800);
    console.log('system drag', JSON.stringify(await drag(sys, true)));
    await page.screenshot({ path: `${outDir}/boxselect-selected.png` });
    // Right click on empty space below the box: the list action menu.
    await page.mouse.move(sys.x0 - 60, sys.y1 + 40);
    await page.mouse.down({ button: 'right' });
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(600);
    const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.order-menu-item')).map((r) => r.textContent));
    console.log('menu', JSON.stringify(rows));
    await page.screenshot({ path: `${outDir}/boxselect-menu.png` });
    await page.keyboard.press('Escape');
    // A small (< 4 px) left move is still a click (selects what is under it / clears).
    await page.mouse.move(sys.x0 - 60, sys.y1 + 40);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(sys.x0 - 58, sys.y1 + 41);
    await page.mouse.up({ button: 'left' });
    await page.waitForTimeout(500);
    console.log('small move', await page.evaluate(async () => JSON.stringify((await import('/src/ui/hud.ts')).getSelection()?.builtObjects?.length ?? null)));
}
const gal = await setup('galaxy');
console.log('sector setup', JSON.stringify(gal));
if (gal.n > 0) {
    await page.waitForTimeout(800);
    console.log('sector drag', JSON.stringify(await drag(gal, false)));
    await page.screenshot({ path: `${outDir}/boxselect-sector.png` });
}
await browser.close();
for (const l of logs.filter((l) => l.includes('error') || l.includes('pageerror'))) console.log(l);
console.log('done');
