// Creature layer captures (src/render/creatureLayer.ts) at 4K (1920 × 1080 CSS px × DPR 2).
// Usage: node scripts/creature-shots.mjs [base=http://localhost:5173/] [outDir=shots] [extraQuery]
//   creatures-system.png — a creature the player can see, at system zoom (f = 6) next to its planet;
//   creatures-close.png  — 100 % zoom on a Kaltor, clicked (selected) so the selection panel shows it.
// Prints each view's creature, its drawn size and the selection panel text. Pass extraQuery `godMode=1` to draw every
// creature (the original's _Game.GodMode) when none is visible to the player.
import { chromium } from 'playwright-core';
const [base = 'http://localhost:5173/', outDir = 'shots', extra = ''] = process.argv.slice(2);
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${base}?autostart=1${extra ? `&${extra}` : ''}`);
await page.waitForFunction(() => window.__dwu?.galaxy?.creatures !== undefined && window.__dwu?.view !== undefined && window.__dwu?.game !== undefined, null, {
    timeout: 240000,
});
await page.waitForTimeout(3000);

// Candidates: live creatures the layer would show (GodMode or visible to the player), Kaltors first, then those parked
// at a planet.
const info = await page.evaluate(() => {
    const { galaxy, view } = window.__dwu;
    const layer = view.creatureLayer;
    const all = galaxy.creatures.filter((c) => c && !c.hasBeenDestroyed);
    const vis = all.filter((c) => layer.visibleToPlayer(c));
    const byType = {};
    for (const c of all) byType[c.type] = (byType[c.type] ?? 0) + 1;
    const pick = (list) => list.find((c) => c.parentHabitat && c.parentHabitat.category === 1) ?? list[0] ?? null;
    const kaltors = vis.filter((c) => c.type === 1);
    const sys = pick(vis);
    const close = pick(kaltors) ?? sys;
    window.__creatureShots = { sys, close };
    const d = (c) => (c ? { name: c.name, type: c.type, size: c.size, x: Math.round(c.xpos), y: Math.round(c.ypos), at: c.parentHabitat?.name ?? null } : null);
    return { total: all.length, visible: vis.length, byType, sys: d(sys), close: d(close) };
});
console.log(`creatures: ${JSON.stringify(info)}`);
if (info.sys === null) {
    console.log('no creature visible to the player — rerun with extraQuery godMode=1');
    await browser.close();
    process.exit(1);
}

async function frame(which, zoom) {
    return page.evaluate(
        ([w, z]) => {
            const { camera } = window.__dwu;
            const c = window.__creatureShots[w];
            camera.zoom = camera.clampZoom(z);
            camera.centerOn(c.xpos, c.ypos);
        },
        [which, zoom],
    );
}
const drawn = (which) => page.evaluate((w) => window.__dwu.view.creatureLayer.drawnSizePx(window.__creatureShots[w]), which);

await frame('sys', 1 / 6);
// The frame sets load on first sight: wait until the creature is drawn.
await page
    .waitForFunction(() => window.__dwu.view.creatureLayer.drawnSizePx(window.__creatureShots.sys) > 0, null, { timeout: 60000 })
    .catch(() => console.log('system view: creature not drawn within 60 s'));
await page.waitForTimeout(1500);
console.log(`system view: drawn ${await drawn('sys')} css px`);
await page.screenshot({ path: `${outDir}/creatures-system.png` });

await frame('close', 1);
await page.waitForTimeout(2500);
// Click the creature at the screen centre (the camera is centred on it): the real pick → selection path.
await page.mouse.move(960, 540);
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(400);
await page.mouse.move(962, 541);
await page.waitForTimeout(1200);
const panel = await page.evaluate(() => {
    const el = document.querySelector('.hud-selection');
    return el ? el.innerText.replace(/\s+/g, ' ').slice(0, 400) : null;
});
const tooltip = await page.evaluate(() => document.querySelector('.dwu-map-tooltip')?.textContent ?? null);
console.log(`close view: drawn ${await drawn('close')} css px; selected=${await page.evaluate(() => window.__dwu.view.selectedCreature?.name ?? null)}`);
console.log(`selection panel: ${panel}`);
console.log(`hover tooltip: ${tooltip}`);
await page.screenshot({ path: `${outDir}/creatures-close.png` });
for (const l of logs) if (l.startsWith('[error]') || l.startsWith('[pageerror]') || l.includes('[creatures]')) console.log(l);
console.log(`saved ${outDir}/creatures-system.png ${outDir}/creatures-close.png`);
await browser.close();
