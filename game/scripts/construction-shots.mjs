// Screenshots for the construction-progress-indicator port (map reveal + selection panel % complete + colony
// "Building" row). Usage: node scripts/construction-shots.mjs <baseUrl> <outDir>
import { chromium } from 'playwright-core';
const [base = 'http://localhost:5173/', outDir = 'shots'] = process.argv.slice(2);
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${base}?autostart=1`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 120000 });
await page.waitForTimeout(3000);

// Set up: pick an existing owned ship near the capital, mark part of its components Unbuilt (the same
// `unbuiltComponentCount` field the sim's own construction code drives — see src/sim/construction/
// constructionQueue.ts doConstruction) and put it in the capital's shipyard queue (shipUnderConstruction) so
// both the ship's own reveal/percent and the colony's "Building" row have real data.
const setup = await page.evaluate(async () => {
    const dwu = window.__dwu;
    const { galaxy, camera } = dwu;
    const player = galaxy.playerEmpire;
    const hud = await import('/src/ui/hud.ts');
    const cap = player.capital;
    const ship = player.builtObjects.find((b) => b && b.role !== undefined && b.components && b.components.count > 4 && b.parentHabitat === null) ?? player.builtObjects.find((b) => b && b.components && b.components.count > 4);
    if (!ship) return { ok: false, reason: 'no ship found' };
    // ~55% built: about 45% of its components still Unbuilt.
    ship.unbuiltComponentCount = Math.max(1, Math.round(ship.components.count * 0.45));
    ship.overlayChanged = true;
    // Park it right next to the capital so it's on screen at system zoom.
    ship.xpos = cap.xpos + 40000;
    ship.ypos = cap.ypos;
    let yardSet = false;
    const queue = cap.constructionQueue;
    if (queue && queue.constructionYards && queue.constructionYards.length > 0) {
        queue.constructionYards[0].shipUnderConstruction = ship;
        yardSet = true;
    }
    camera.centerOn(ship.xpos, ship.ypos);
    camera.zoomAt(hud.SYSTEM_LEVEL_ZOOM, camera.width / 2, camera.height / 2);
    return { ok: true, ship: ship.name, unbuilt: ship.unbuiltComponentCount, total: ship.components.count, yardSet, capital: cap.name };
});
console.log('setup', JSON.stringify(setup));
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/construction-map.png` });
console.log(`saved ${outDir}/construction-map.png (system view: the ship under construction, reveal effect)`);

// Select the ship: the streamlined selection panel's new "Construction: NN% Complete" row.
await page.evaluate(async () => {
    const dwu = window.__dwu;
    const { galaxy } = dwu;
    const player = galaxy.playerEmpire;
    const hud = await import('/src/ui/hud.ts');
    const cap = player.capital;
    const queue = cap.constructionQueue;
    const ship = queue && queue.constructionYards && queue.constructionYards[0] ? queue.constructionYards[0].shipUnderConstruction : player.builtObjects.find((b) => b && b.unbuiltComponentCount > 0);
    if (ship) hud.selectStellarObject(ship, false);
});
await page.waitForTimeout(800);
await page.screenshot({ path: `${outDir}/construction-panel-ship.png` });
console.log(`saved ${outDir}/construction-panel-ship.png (ship selected: the panel's Construction row)`);

// Select the capital: the colony panel's new "Building" row (ship name + % complete).
await page.evaluate(async () => {
    const dwu = window.__dwu;
    const { galaxy } = dwu;
    const player = galaxy.playerEmpire;
    const hud = await import('/src/ui/hud.ts');
    hud.selectStellarObject(player.capital, false);
});
await page.waitForTimeout(800);
await page.screenshot({ path: `${outDir}/construction-panel-colony.png` });
console.log(`saved ${outDir}/construction-panel-colony.png (colony selected: the panel's Building row)`);

await browser.close();
for (const l of logs) console.log(l);
console.log('done');
