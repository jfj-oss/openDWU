// Planetary facility interactions (ui/facilityHover.ts): boots ?autostart=1, gives the player's capital a few facilities
// (a completed one, one under construction, a wonder and a pirate faction's base — screenshot setup, written straight
// into the in-thread game before anything is drawn), then captures
//   1. the selection panel Facilities row;
//   2. the hover message of each facility icon (the yellow line above the panel, Main.Part10.cs 1141-1159);
//   3. the click result: the Galactopedia at "Planetary Facilities" / "Wonders" (Main.Part4.cs 3586);
//   4. the Colonies screen Facilities tab: an icon's tool tip (a native title, so the script draws its text in a box
//      next to the cursor: marked "[tool tip]"), the selected facility's Scrap button, the scrap prompt, the result,
//      and the pirate base's Attack button.
// Usage: node scripts/facility-shots.mjs <baseUrl> <outDir> [w] [h]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/facilities', w = '1920', h = '1080'] = process.argv.slice(2);
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

const setup = await page.evaluate(async () => {
    const { galaxy, camera, time } = window.__dwu;
    if (time) time.paused = true;
    const fac = await import('/src/sim/construction/facilities.ts');
    const rs = await import('/src/sim/researchSystem.ts');
    const pcc = await import('/src/sim/pirates/pirateColonyControl.ts');
    const hud = await import('/src/ui/hud.ts');
    const player = galaxy.playerEmpire;
    const cap = player.capital;
    const defs = fac.planetaryFacilityDefinitionsStatic(galaxy);
    const byType = (t) => defs.find((d) => rs.facilityType(d) === t);
    const T = rs.PlanetaryFacilityType;
    const list = [new fac.PlanetaryFacility(byType(T.PlanetaryShield), 1), new fac.PlanetaryFacility(byType(T.IonCannon), 0.45)];
    const wonder = defs.find((d) => rs.facilityType(d) === T.Wonder);
    if (wonder) list.push(new fac.PlanetaryFacility(wonder, 1));
    const pirate = galaxy.pirateEmpires[0] ?? null;
    if (pirate) {
        list.push(new fac.PlanetaryFacility(byType(T.PirateBase), 1));
        cap.pirateColonyControl.add(new pcc.PirateColonyControl(pirate.empireId, 0.5, true));
    }
    cap.facilities = [...(cap.facilities ?? []), ...list];
    camera.centerOn(cap.xpos, cap.ypos);
    camera.zoomAt(hud.SYSTEM_LEVEL_ZOOM, camera.width / 2, camera.height / 2);
    hud.selectHabitat(cap, false);
    return { colony: cap.name, facilities: cap.facilities.map((f) => `${f.name} ${Math.round(f.constructionProgress * 100)}%`), pirate: pirate?.name ?? null };
});
console.log('setup:', JSON.stringify(setup));
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

// 1. The Facilities row.
await page.mouse.move(+w - 5, 5);
await shot('01-panel-facilities-row', panelClip);

// 2. Hover each facility icon: the hover message line.
const icons = page.locator('.sel-detail img.sel-icon[src*="planetaryfacilities"]');
const n = await icons.count();
console.log(`facility icons in the selection panel: ${n}`);
for (let i = 0; i < n; i++) {
    await icons.nth(i).scrollIntoViewIfNeeded();
    await icons.nth(i).hover();
    await page.waitForTimeout(400);
    const msg = await page.locator('.sel-hover-msg').textContent();
    console.log(`hover ${i}: ${msg}`);
    await shot(`02-panel-hover-${i}`, panelClip);
}

// 3. Click: the Galactopedia.
const topicTitle = () => page.evaluate(() => document.querySelector('.gp-topic-title')?.textContent ?? '(no galactopedia)');
const waitTopic = () => page.waitForFunction(() => (document.querySelector('.gp-topic-title')?.textContent ?? '') !== '', null, { timeout: 30000 }).then(() => page.waitForTimeout(800));
await icons.nth(0).click();
await waitTopic();
console.log(`click facility 0 -> galactopedia topic: ${await topicTitle()}`);
await shot('03-panel-click-planetary-facilities');
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
if (n >= 3) {
    await icons.nth(2).click();
    await waitTopic();
    console.log(`click facility 2 -> galactopedia topic: ${await topicTitle()}`);
    await shot('04-panel-click-wonders');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
}

// 4. The Colonies screen, Facilities tab.
await page.click('[data-hud="tbtnColonies"]');
await page.waitForSelector('[data-ow="colonies"] .ow-grid-row');
await page.waitForTimeout(1000);
await page.locator('[data-ow="colonies"] .col-grid .ow-grid-row', { hasText: setup.colony }).first().click();
await page.waitForTimeout(500);
await page.locator('[data-ow="colonies"] .ow-tab').nth(6).click();
await page.waitForTimeout(800);
await shot('05-colonies-facilities-tab');
const facs = page.locator('[data-ow="colonies"] .col-fac');
const fn = await facs.count();
console.log(`facility icons in the Colonies screen: ${fn}`);
// The native tool tip is not in a screenshot: draw its text next to the cursor, marked as such.
const showTip = (i) => page.evaluate((i) => {
    document.getElementById('shot-tip')?.remove();
    const t = document.querySelectorAll('[data-ow="colonies"] .col-fac')[i];
    const r = t.getBoundingClientRect();
    const box = document.createElement('div');
    box.id = 'shot-tip';
    box.textContent = `[tool tip]\n${t.title}`;
    Object.assign(box.style, { position: 'fixed', left: `${r.right + 4}px`, top: `${r.top + r.height / 2}px`, zIndex: 100000, whiteSpace: 'pre', background: 'rgb(255,255,225)', color: '#000', border: '1px solid #767676', font: '12px sans-serif', padding: '2px 4px', pointerEvents: 'none' });
    document.body.appendChild(box);
    return t.title;
}, i);
for (let i = 0; i < fn; i++) {
    await facs.nth(i).hover();
    const tip = await showTip(i);
    console.log(`colonies tool tip ${i}: ${JSON.stringify(tip)}`);
    await shot(`06-colonies-hover-${i}`);
}
await page.evaluate(() => document.getElementById('shot-tip')?.remove());

const scrapButton = () => page.locator('[data-ow="colonies"] button', { hasText: /^(Scrap|Attack|Scrap Facility)$/ }).first();
// Select the completed Planetary Shield: "Scrap".
await facs.nth(0).click();
await page.waitForTimeout(500);
console.log(`selected facility 0 -> button: ${await scrapButton().textContent()}`);
await shot('07-colonies-select-scrap');
if (setup.pirate !== null && fn >= 4) {
    await page.locator('[data-ow="colonies"] .col-fac').nth(3).click();
    await page.waitForTimeout(500);
    console.log(`selected the pirate base -> button: ${await scrapButton().textContent()} (disabled: ${await scrapButton().isDisabled()})`);
    await shot('08-colonies-select-pirate-attack');
    await page.locator('[data-ow="colonies"] .col-fac').nth(0).click();
    await page.waitForTimeout(500);
}
await scrapButton().click();
await page.waitForTimeout(600);
await shot('09-colonies-scrap-prompt');
const yes = page.locator('button', { hasText: /^Yes$/ }).last();
await yes.click();
await page.waitForTimeout(2500);
const after = await page.evaluate(() => window.__dwu.galaxy.playerEmpire.capital.facilities.map((f) => f.name));
console.log(`after Yes: ${JSON.stringify(after)}`);
await shot('10-colonies-after-scrap');

console.log(shots.join('\n'));
console.log(logs.length ? logs.slice(0, 40).join('\n') : 'no console errors');
await browser.close();
