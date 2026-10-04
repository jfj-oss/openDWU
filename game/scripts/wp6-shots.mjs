#!/usr/bin/env node
// WP6 captures: the map HUD popups in the original style — the right-click order menu (actionMenu) with a submenu,
// the empty-space menu (waypoints' "Add Waypoint here…"), the stacked-object pick menu (selectionMenu), the top-bar
// "•••" menu, the View popup (with the Improvements section and its "…" panels open), the keyboard overlay, the
// message stubs, the toast and the map tooltip. Saves PNGs and prints the page's console errors — it does not judge
// them. Popups opened through the dev server's module graph (dynamic import), so run against `npm run dev`.
//
//   node scripts/wp6-shots.mjs <baseUrl> <outDir> [tag] [extraQuery e.g. simWorker=1]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const [base = 'http://localhost:5173/', outDir = 'shots/wp6', tag = 'after', extra = ''] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const prefix = extra.includes('simWorker=1') ? 'worker-' : '';
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.stack ?? e.message}`));
const shots = [];
const shot = async (name, wait = 600) => {
    await page.waitForTimeout(wait);
    const path = `${outDir}/${prefix}${name}-${tag}.png`;
    await page.screenshot({ path });
    shots.push(path);
};
/** Close any popup with Escape (one press per open level), never reaching the game menu. */
const esc = async () => {
    for (let i = 0; i < 3; i++) {
        const open = await page.evaluate(() => !!document.querySelector('.order-menu-root, .pick-menu, #keyboard-shortcuts-overlay:not([style*="none"])'));
        if (!open) break;
        await page.keyboard.press('Escape');
        await page.waitForTimeout(250);
    }
};
const rightClick = async (x, y) => {
    await page.mouse.move(x, y);
    await page.waitForTimeout(300);
    await page.mouse.down({ button: 'right' });
    await page.mouse.up({ button: 'right' });
};
const step = async (name, fn) => {
    try {
        await fn();
        await shot(name);
    } catch (e) {
        logs.push(`[step ${name}] ${e.message}`);
    }
};

await page.goto(`${base}?autostart=1${extra ? `&${extra}` : ''}`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined && !!window.__dwu?.camera, null, { timeout: 600000 });
await page.waitForTimeout(3000);
// Every Improvement on (the View popup's Improvements section lists only the enabled ones); pause the clock.
await page.evaluate(async () => {
    const imp = await import('/src/ui/improvements.ts');
    for (const i of imp.improvements()) imp.setImprovementEnabled(i.id, true);
    if (window.__dwu.time) window.__dwu.time.paused = true;
});

// Nothing selected, right-click empty space: the objects there and the waypoint entry ("Add Waypoint here…").
await step('ordermenu-empty', async () => {
    await rightClick(1250, 220);
    await page.waitForTimeout(500);
    const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.order-menu-item')).map((r) => r.textContent));
    console.log(`empty-space menu: ${JSON.stringify(rows)}`);
    const first = page.locator('.order-menu-item');
    if ((await first.count()) > 0) await first.first().hover({ timeout: 3000 });
});
await esc();

// The player's capital at system zoom, with one of the player's ships selected.
const cap = await page.evaluate(async () => {
    const { galaxy, camera } = window.__dwu;
    const hud = await import('/src/ui/hud.ts');
    const player = galaxy.playerEmpire;
    const c = player.capital ?? player.colonies?.[0];
    const ship = player.builtObjects.find((b) => b.topSpeed > 0 && b.role !== 0) ?? player.builtObjects.find((b) => b.topSpeed > 0);
    if (ship) hud.selectStellarObject(ship, false);
    camera.centerOn(c.xpos, c.ypos);
    camera.zoomAt(hud.SYSTEM_LEVEL_ZOOM, camera.width / 2, camera.height / 2);
    const s = camera.worldToScreen(c.xpos, c.ypos);
    const rect = document.querySelector('canvas').getBoundingClientRect();
    return { x: rect.left + s.x, y: rect.top + s.y, name: c.name, ship: ship?.name ?? null };
});
console.log(`capital ${JSON.stringify(cap)}`);
await page.waitForTimeout(1500);

// Map tooltip over the capital (empire-tinted).
await step('tooltip', async () => {
    await page.mouse.move(cap.x + 1, cap.y + 1);
    await page.waitForTimeout(200);
    await page.mouse.move(cap.x + 2, cap.y + 2);
    await page.waitForTimeout(900);
});

// Ctrl + right-click on empty space with a ship selected: the action menu, first submenu opened.
await step('ordermenu', async () => {
    await page.keyboard.down('Control');
    await rightClick(1250, 220);
    await page.keyboard.up('Control');
    await page.waitForTimeout(500);
    const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.order-menu-item')).map((r) => r.textContent));
    console.log(`order menu: ${JSON.stringify(rows)}`);
    const sub = page.locator('.order-menu-item:has(.order-menu-arrow)');
    if ((await sub.count()) > 0) await sub.first().hover({ timeout: 3000 });
    else {
        const any = page.locator('.order-menu-item');
        if ((await any.count()) > 1) await any.nth(1).hover({ timeout: 3000 });
    }
});
await esc();

// The stacked-object pick menu (selectionMenu), opened directly with sample entries.
await step('pickmenu', async () => {
    await page.evaluate(async () => {
        const m = await import('/src/ui/pickMenu.ts');
        const noop = () => {};
        m.openPickMenu(
            [
                { icon: '◆', name: 'Ragnar', type: 'Continental Planet', owner: 'Your empire', onPick: noop },
                { icon: '▲', name: 'Explorer 1', type: 'Explorer', owner: 'Your empire', onPick: noop },
                { icon: '▲', name: 'Mining Station', type: 'Mining Station', owner: '', onPick: noop },
                { icon: '●', name: 'Kaltor Moon', type: '', owner: '', onPick: noop },
            ],
            600,
            380,
        );
    });
    await page.mouse.move(650, 420);
});
await esc();

// Top-bar "•••" menu.
await step('topmore', async () => {
    await page.locator('.top-more-btn').first().click({ timeout: 3000 });
    await page.waitForTimeout(300);
    await page.locator('.top-more-item').nth(1).hover({ timeout: 3000 });
});
await page.mouse.click(800, 600);
await page.waitForTimeout(300);

// The View popup with its "…" panels open.
await step('viewpopup', async () => {
    await page.evaluate(() => {
        const pop = document.querySelector('.hud-options-pop');
        if (pop !== null && !pop.classList.contains('open')) pop.querySelector('.hud-options-toggle')?.click();
    });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
        for (const m of document.querySelectorAll('.hud-options .hud-option-more')) m.click();
    });
    const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.hud-option-row')).map((r) => r.textContent));
    console.log(`view rows: ${JSON.stringify(rows)}`);
    const row = page.locator('.hud-option-row[data-overlay="fuelRange"]');
    if ((await row.count()) > 0) await row.hover({ timeout: 3000 });
});
await page.evaluate(() => {
    const pop = document.querySelector('.hud-options-pop');
    if (pop?.classList.contains('open')) pop.querySelector('.hud-options-toggle')?.click();
});

// Keyboard overlay.
await step('keyboard', async () => {
    await page.mouse.move(800, 500);
    await page.keyboard.press('?');
    await page.waitForTimeout(400);
    const row = page.locator('.hud-keyboard-row').nth(3);
    if ((await row.count()) > 0) await row.hover({ timeout: 3000 });
});
await page.keyboard.press('?');
await page.waitForTimeout(300);

// Message stubs (a few injected) and the toast.
await step('stubs-toast', async () => {
    await page.evaluate(async () => {
        const s = await import('/src/ui/messageStubList.ts');
        const t = await import('/src/ui/toast.ts');
        const date = window.__dwu.galaxy.currentStarDate ?? 0;
        s.pushBattleReportStub({}, 'Battle at Ragnar: 3 pirate ships destroyed', 'Battle report', date, 'rgb(255, 64, 64)', () => {});
        s.pushBattleReportStub({}, 'Colony founded: New Hope', 'Colony', date, null, () => {});
        s.pushBattleReportStub({}, 'Research complete: Fusion Drive', 'Research', date, 'rgb(96, 160, 255)', () => {});
        t.showToast('Waypoint added: Rally point', document.body, 60000);
    });
    await page.mouse.move(1500, 160);
});

await browser.close();
for (const p of shots) console.log(`saved ${p}`);
console.log(`console errors / warnings: ${logs.length}`);
for (const l of logs) console.log(l);
