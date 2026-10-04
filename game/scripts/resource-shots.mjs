// Planet resource hotspots and the selection panel's own click (ui/selectionInfo.ts resourceSegs, hud.ts
// buildSelectionPanel): boots ?autostart=1, selects the player's capital and captures
//   1. the hover message of each resource icon in the selection panel (yellow line above it, Main.Part10.cs 1141);
//   2. a click on a resource: the Galactopedia on that resource's page (Main.Part4.cs 3598 → method_456(Name));
//   3. the panel's own hint over empty space ("Selection Panel: click to center view on selected item") and the
//      click there: the view moves back to the selection (method_157) after the camera was panned away;
//   4. the Galaxy Map's habitat info (pnlHabitatInfo) for the capital, a resource's tool tip there (drawn as a
//      "[tool tip]" box: native titles are not in screenshots) and its click (the Galactopedia);
//   5. the Colonies screen's habitat info resource tool tip.
// Usage: node scripts/resource-shots.mjs <baseUrl> <outDir> [w] [h]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/resources', w = '1920', h = '1080'] = process.argv.slice(2);
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
await page.goto(`${base}?autostart=1`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 300000 });
await page.waitForTimeout(4000);
const colony = await page.evaluate(async () => {
    const { galaxy, camera, time } = window.__dwu;
    if (time) time.paused = true;
    const hud = await import('/src/ui/hud.ts');
    const cap = galaxy.playerEmpire.capital;
    camera.centerOn(cap.xpos, cap.ypos);
    camera.zoomAt(hud.SYSTEM_LEVEL_ZOOM, camera.width / 2, camera.height / 2);
    hud.selectHabitat(cap, false);
    return cap.name;
});
console.log(`colony: ${colony}`);
await page.waitForTimeout(1500);

const frameH = Math.round(600 * (+h / 1080));
const frameW = Math.round(900 * (+h / 1080));
const panelClip = { x: 0, y: +h - frameH, width: frameW, height: frameH };
const shots = [];
const shot = async (name, clip) => {
    const path = `${outDir}/${name}.png`;
    await page.screenshot(clip ? { path, clip } : { path });
    shots.push(path);
};
const waitTopic = () => page.waitForFunction(() => (document.querySelector('.gp-topic-title')?.textContent ?? '') !== '', null, { timeout: 30000 }).then(() => page.waitForTimeout(800));
const topicTitle = () => page.evaluate(() => document.querySelector('.gp-topic-title')?.textContent ?? '(no galactopedia)');
const closePedia = async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
};

// 1. Resource hover messages.
const icons = page.locator('.sel-detail img.sel-icon[src*="/resources/"]');
const n = await icons.count();
console.log(`resource icons in the selection panel: ${n}`);
for (let i = 0; i < n; i++) {
    await icons.nth(i).hover();
    await page.waitForTimeout(400);
    console.log(`hover ${i}: ${await page.locator('.sel-hover-msg').textContent()}`);
    await shot(`01-panel-resource-hover-${i}`, panelClip);
}
// 2. Click a resource.
if (n > 0) {
    await icons.nth(0).click();
    await waitTopic();
    console.log(`click resource 0 -> galactopedia topic: ${await topicTitle()}`);
    await shot('02-panel-resource-click');
    await closePedia();
}
// 3. The panel's own hint and click.
const box = await page.locator('.sel-detail').boundingBox();
const empty = { x: box.x + box.width - 12, y: box.y + box.height - 12 };
await page.mouse.move(empty.x, empty.y);
await page.waitForTimeout(400);
console.log(`hover empty panel: ${await page.locator('.sel-hover-msg').textContent()}`);
await shot('03-panel-hint', panelClip);
await page.evaluate(() => {
    const { camera } = window.__dwu;
    const c = camera.screenToWorld(camera.width / 2, camera.height / 2);
    camera.centerOn(c.x + 3000, c.y + 2000);
});
await page.waitForTimeout(800);
await shot('04-view-panned-away');
const centre = () => page.evaluate(() => {
    const { camera, galaxy } = window.__dwu;
    const c = camera.screenToWorld(camera.width / 2, camera.height / 2);
    const cap = galaxy.playerEmpire.capital;
    return Math.round(Math.hypot(c.x - cap.xpos, c.y - cap.ypos));
});
console.log(`distance view centre -> capital before click: ${await centre()}`);
await page.mouse.click(empty.x, empty.y);
await page.waitForTimeout(800);
console.log(`distance view centre -> capital after click: ${await centre()}`);
await shot('05-panel-click-centred');

// The native tool tip is not in a screenshot: draw its text next to the element, marked as such.
const showTip = (sel, i) => page.evaluate(([sel, i]) => {
    document.getElementById('shot-tip')?.remove();
    const t = document.querySelectorAll(sel)[i];
    if (!t) return null;
    const r = t.getBoundingClientRect();
    const b = document.createElement('div');
    b.id = 'shot-tip';
    b.textContent = `[tool tip]\n${t.title}`;
    Object.assign(b.style, { position: 'fixed', left: `${r.right + 4}px`, top: `${r.bottom + 2}px`, zIndex: 100000, whiteSpace: 'pre', background: 'rgb(255,255,225)', color: '#000', border: '1px solid #767676', font: '12px sans-serif', padding: '2px 4px', pointerEvents: 'none' });
    document.body.appendChild(b);
    return t.title;
}, [sel, i]);
const hideTip = () => page.evaluate(() => document.getElementById('shot-tip')?.remove());

// 4. The Galaxy Map habitat info.
await page.evaluate(() => {
    const { galaxyMap, galaxy } = window.__dwu;
    galaxyMap.open(galaxy.playerEmpire.capital);
});
await page.waitForTimeout(1500);
await shot('06-galaxymap-habitat-info');
const gmSel = '.gmap-habitat-info img.sel-icon[src*="/resources/"]';
const gn = await page.locator(gmSel).count();
console.log(`resource icons in the Galaxy Map habitat info: ${gn}`);
if (gn > 0) {
    await page.locator(gmSel).first().hover();
    console.log(`galaxy map tool tip: ${await showTip(gmSel, 0)}`);
    await shot('07-galaxymap-resource-hover');
    await hideTip();
    await page.locator(gmSel).first().click();
    await waitTopic();
    console.log(`galaxy map resource click -> galactopedia topic: ${await topicTitle()}`);
    await shot('08-galaxymap-resource-click');
    await closePedia();
}
await page.evaluate(() => window.__dwu.galaxyMap.close());
await page.waitForTimeout(500);

// 5. The Colonies screen habitat info.
await page.click('[data-hud="tbtnColonies"]');
await page.waitForSelector('[data-ow="colonies"] .ow-grid-row');
await page.waitForTimeout(800);
await page.locator('[data-ow="colonies"] .col-grid .ow-grid-row', { hasText: colony }).first().click();
await page.waitForTimeout(800);
const colSel = '[data-ow="colonies"] .col-info-box img.sel-icon[src*="/resources/"]';
const cn = await page.locator(colSel).count();
console.log(`resource icons in the Colonies habitat info: ${cn}`);
if (cn > 0) {
    await page.locator(colSel).first().hover();
    console.log(`colonies tool tip: ${await showTip(colSel, 0)}`);
    await shot('09-colonies-resource-hover');
    await hideTip();
    await page.locator(colSel).first().click();
    await waitTopic();
    console.log(`colonies resource click -> galactopedia topic: ${await topicTitle()}`);
    await shot('10-colonies-resource-click');
}
console.log(shots.join('\n'));
console.log(logs.length ? logs.slice(0, 40).join('\n') : 'no console errors');
await browser.close();
