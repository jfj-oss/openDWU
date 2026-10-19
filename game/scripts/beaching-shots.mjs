// Beached ships captures (scenarios/beaching): (1) the new-game wizard's Other Empires page with the Beached ships checkbox
// ticked (and the hover help), (2) a game with the add-on: the right-click order menu of a warship at the capital
// (Beach on colony), then two ships beached on the capital: the colony's info panel with the "Beached: 2 ships (-x% quality)"
// line (and with a cleanup under way), and the system view with the grounded hulls.
// Usage: node scripts/beaching-shots.mjs <baseUrl> <outDir> [w] [h]      (GPU Chromium: ANGLE/Vulkan, never SwiftShader)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/beaching', w = '1600', h = '900'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'],
});
const base1 = base.replace(/\/$/, '') + '/';
let errors = 0;
const watch = (page, tag) => {
    page.on('console', (m) => {
        if (m.type() === 'error') { console.log(`  [${tag} console error] ${m.text()}`); errors++; }
        if (m.text().startsWith('DBG')) console.log(m.text());
    });
    page.on('pageerror', (e) => { console.log(`  [${tag} pageerror] ${e.message}`); errors++; });
};

// 1. The wizard.
{
    const page = await browser.newPage({ viewport: { width: +w, height: +h } });
    watch(page, 'wizard');
    await page.goto(`${base1}?screen=wizard&page=empires`);
    await page.waitForSelector('.wizard-window', { state: 'visible', timeout: 120000 });
    await page.waitForTimeout(3000);
    const box = page.locator('.wizard-beaching:visible').first();
    await box.click();
    await box.hover();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${outDir}/wizard-other-empires.png` });
    console.log(`saved ${outDir}/wizard-other-empires.png; checked: ${await box.locator('input').isChecked()}`);
    const panel = await page.evaluate(() => {
        const el = document.querySelector('.wizard-beaching');
        const r = el.getBoundingClientRect();
        const p = el.parentElement.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, panelRight: p.right, panelX: p.x, panelW: p.width, clipped: r.right > p.right };
    });
    console.log('checkbox geometry', JSON.stringify(panel));
    await page.close();
}

// 2. The game.
{
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
    watch(page, 'game');
    await page.goto(`${base1}?autostart=1&scenario=beaching&simWorker=0`);
    await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 240000 });
    await page.waitForTimeout(4000);
    const info = await page.evaluate(async () => {
        const dwu = window.__dwu;
        const { game, camera } = dwu;
        const g = game.galaxy;
        const p = game.playerEmpire;
        (await import('/src/sim/readOnlyQuery.ts')).markUiGalaxy(g, false);
        const hud = await import('/src/ui/hud.ts');
        const cap = p.capital;
        const ships = p.builtObjects.filter((b) => b.role === 1 && b.builtAt === null && b.topSpeed > 0 && b.firepowerRaw > 0);
        camera.centerOn(cap.xpos, cap.ypos);
        camera.zoomAt(hud.SYSTEM_LEVEL_ZOOM, camera.width / 2, camera.height / 2);
        if (dwu.time) dwu.time.paused = true;
        window.__ships = ships;
        window.__hud = hud;
        return { cap: cap.name, ships: ships.map((b) => [b.name, b.size, b.armor]) , zoom: camera.zoom };
    });
    console.log('setup', JSON.stringify(info));
    // The order menu: select the first warship and right-click it.
    await page.evaluate(() => {
        const { camera } = window.__dwu;
        const b = window.__ships[0];
        window.__hud.selectStellarObject(b, false);
        camera.centerOn(b.xpos, b.ypos);
    });
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
        const { camera } = window.__dwu;
        const b = window.__ships[0];
        camera.centerOn(b.xpos, b.ypos);
        camera.zoom = camera.clampZoom(3);
    });
    await page.waitForTimeout(1500);
    await page.mouse.click(960, 540, { button: 'right' });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${outDir}/order-menu-beach.png` });
    console.log(`saved ${outDir}/order-menu-beach.png; menu text: ${(await page.locator('.order-menu').allInnerTexts()).join(' | ').slice(0, 500)}`);
    await page.mouse.click(1500, 300);
    // Beach two ships; select the colony.
    const res = await page.evaluate(async () => {
        const bm = await import('/src/sim/scenario/beaching/beaching.ts');
        const g = window.__dwu.game.galaxy;
        const p = window.__dwu.game.playerEmpire;
        const cap = p.capital;
        const r = window.__ships.slice(1, 3).map((b) => bm.beachShip(g, p, b, cap, 'human').ok);
        const camera = window.__dwu.camera;
        window.__hud.selectHabitat(cap, false);
        camera.centerOn(cap.xpos, cap.ypos);
        return { r, line: bm.beachedInfoLine(g, cap, p), pct: bm.scarPct(g, cap), q: cap.baseQuality };
    });
    console.log('beached', JSON.stringify(res));
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${outDir}/colony-info-beached.png`, clip: { x: 0, y: 820, width: 480, height: 260 } });
    console.log(`saved ${outDir}/colony-info-beached.png`);
    // A cleanup under way (terraforming tech granted for the capture).
    const clean = await page.evaluate(async () => {
        const bm = await import('/src/sim/scenario/beaching/beaching.ts');
        const fac = await import('/src/sim/construction/facilities.ts');
        const rs = await import('/src/sim/researchSystem.ts');
        const g = window.__dwu.game.galaxy;
        const p = window.__dwu.game.playerEmpire;
        const cap = p.capital;
        const def = fac.planetaryFacilityDefinitionsStatic(g).find((f) => f && rs.facilityType(f) === rs.PlanetaryFacilityType.TerraformingFacility);
        if (def && !p.research.buildablePlanetaryFacilities.includes(def)) p.research.buildablePlanetaryFacilities.push(def);
        p.stateMoney = 1e9;
        const before = bm.beachedInfoLine(g, cap, p);
        const r = bm.startCleanup(g, p, cap, 'human');
        const sc = bm.scarOf(g, cap);
        sc.cleanup.left = sc.cleanup.total * 0.6; // 40% done, for the picture
        window.__hud.selectHabitat(cap, false);
        return { before, ok: r.ok, line: bm.beachedInfoLine(g, cap, p) };
    });
    console.log('cleanup', JSON.stringify(clean));
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${outDir}/colony-info-cleanup.png`, clip: { x: 0, y: 820, width: 480, height: 260 } });
    console.log(`saved ${outDir}/colony-info-cleanup.png`);
    // The hulls by the planet, zoomed in.
    await page.evaluate(() => {
        const { camera } = window.__dwu;
        const cap = window.__dwu.game.playerEmpire.capital;
        camera.centerOn(cap.xpos, cap.ypos);
        camera.zoom = camera.clampZoom(2);
    });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${outDir}/system-view-hulls.png` });
    console.log(`saved ${outDir}/system-view-hulls.png`);
    await page.close();
}
await browser.close();
console.log(errors === 0 ? 'no errors' : `${errors} error(s)`);
