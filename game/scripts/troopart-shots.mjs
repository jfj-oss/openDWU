// Screenshots for the troop-image / invasion-status port: the Troops screen's new image column, and the colony
// selection panel's new troop icons + invasion status (an invading colony, so the red "Battle Report" / "vs" rows
// show too). Usage: node scripts/troopart-shots.mjs <baseUrl> <outDir>
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

// Set up: the player's capital under invasion (an enemy empire's troops in InvadingTroops), so the colony panel's
// troop icons + "Show <colony> Battle Report" + "defend vs attack" rows all have real data. Select it and zoom in.
const setup = await page.evaluate(async () => {
    const dwu = window.__dwu;
    const { galaxy, camera } = dwu;
    const player = galaxy.playerEmpire;
    const cargo = await import('/src/sim/cargo.ts');
    const hud = await import('/src/ui/hud.ts');
    const cap = player.capital;
    const invader = galaxy.empires.find((e) => e !== player && e !== galaxy.independentEmpire && e.dominantRace !== null);
    if (cap.troops === null) cap.troops = new cargo.TroopList();
    if (cap.invadingTroops === null) cap.invadingTroops = new cargo.TroopList();
    const t = (empire, type, attack, defend) => new cargo.Troop('t', type, attack, defend, 100, 100, empire, empire?.dominantRace ?? null);
    cap.troops.add(t(player, cargo.TroopType.Infantry, 100, 100));
    cap.troops.add(t(player, cargo.TroopType.Armored, 100, 100));
    cap.troops.add(t(player, cargo.TroopType.Artillery, 100, 100));
    cap.invadingTroops.add(t(invader, cargo.TroopType.Infantry, 150, 150));
    cap.invadingTroops.add(t(invader, cargo.TroopType.SpecialForces, 150, 150));
    hud.selectStellarObject(cap, true);
    camera.centerOn(cap.xpos, cap.ypos);
    camera.zoomAt(hud.SYSTEM_LEVEL_ZOOM, camera.width / 2, camera.height / 2);
    return { colony: cap.name, invader: invader?.name ?? null };
});
console.log('setup', JSON.stringify(setup));
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/colony-troops.png` });

// Troops screen: the new image column (Empire flag swatch + troop race/type image, then the data columns).
await page.evaluate(async () => {
    const { galaxy } = window.__dwu;
    const player = galaxy.playerEmpire;
    const troopsScreen = await import('/src/ui/screens/troops.ts');
    troopsScreen.toggleTroopsScreen({ galaxy, empire: player, onGoTo: () => undefined });
});
await page.waitForTimeout(1200);
await page.screenshot({ path: `${outDir}/troops.png` });

await browser.close();
for (const l of logs) console.log(l);
console.log(`saved ${outDir}/troops.png and ${outDir}/colony-troops.png`);
