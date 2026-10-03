// Fleets window captures (original-style window): boots ?autostart=1, makes sure the player has two fleets (forms them
// from military ships through the player command queue when the start has none), opens the window from the top bar,
// selects a fleet, then the Fleet Designs tab with a template.
// Usage: node scripts/fleets-shots.mjs <baseUrl> <outDir> [w] [h] [dpr] [uiScale%]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/fleets', w = '1920', h = '1080', dpr = '1', ui = ''] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr });
const logs = [];
page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
if (ui !== '') await page.addInitScript((v) => localStorage.setItem('dwu-ui-settings', JSON.stringify({ uiScale: v })), +ui);
await page.goto(`${base}?autostart=1`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 240000 });
await page.waitForTimeout(3000);
const tag = `${w}x${h}@${dpr}${ui !== '' ? `-ui${ui}` : ''}`;
// Two fleets from the player's military ships (Set Fleet → (New Fleet)), if there are none yet.
const made = await page.evaluate(async () => {
    const { issuePlayerCommand } = await import('/src/sim/player/playerCommands.ts');
    const game = window.__dwu.game;
    const empire = game.playerEmpire;
    const galaxy = empire.galaxy;
    const groups = () => (empire.shipGroups ?? []).filter((g) => g != null);
    if (groups().length === 0) {
        const mil = (empire.builtObjects ?? []).filter((b) => b != null && b.role === 1 && b.shipGroup == null);
        const half = Math.max(1, Math.ceil(mil.length / 2));
        if (mil.length > 0) issuePlayerCommand(galaxy, empire, 'setShipsFleet', [mil.slice(0, half), 'new']);
        if (mil.length > 1) issuePlayerCommand(galaxy, empire, 'setShipsFleet', [mil.slice(half), 'new']);
    }
    await new Promise((r) => setTimeout(r, 1500));
    return groups().length;
});
console.log('fleets:', made);
await page.click('[data-hud="tbtnShipGroups"]');
await page.waitForSelector('[data-ow="fleets"] .ow-grid');
await page.waitForTimeout(800);
await page.screenshot({ path: `${outDir}/empty-${tag}.png` });
const row = page.locator('[data-ow="fleets"] .ow-grid-row').first();
if (await row.count()) {
    await row.click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${outDir}/fleet-${tag}.png` });
    // Toggle the troop loadouts on (shows the spinners) and the posture.
    await page.locator('[data-ow="fleets"] .fl-group-caption input').click();
    await page.locator('[data-ow="fleets"] .fl-order', { hasText: 'Posture' }).click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${outDir}/fleet-loadout-${tag}.png` });
}
await page.locator('[data-ow="fleets"] .ow-tab', { hasText: 'Fleet Designs' }).click();
await page.waitForTimeout(400);
await page.locator('[data-ow="fleets"] .ow-glass', { hasText: 'New Fleet Design' }).click();
await page.waitForTimeout(800);
const add = page.locator('[data-ow="fleets"] .ow-glass', { hasText: 'Add Design' });
if (await add.count()) {
    await add.click();
    await page.waitForTimeout(500);
    await add.click();
    await page.waitForTimeout(500);
    await page.locator('[data-ow="fleets"] .ow-glass', { hasText: 'Build Fleet' }).click();
    await page.waitForTimeout(1500);
    const turnOff = page.locator('.order-confirm-button', { hasText: 'Turn off automation' });
    if (await turnOff.count()) {
        await turnOff.click();
        await page.waitForTimeout(1500);
    }
}
await page.screenshot({ path: `${outDir}/designs-${tag}.png` });
console.log(logs.length ? logs.join('\n') : 'no console errors');
await browser.close();
