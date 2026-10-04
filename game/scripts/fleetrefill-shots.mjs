// Fleet template auto-refill / Replenish captures (src/ui/fleetRefillControls.ts, sim/player/fleetRefill.ts): boots
// ?autostart=1 (add `worker` as the 6th argument for ?simWorker=1), forms a fleet from a fleet design through the
// player command queue, opens the Fleets window on it, loses a ship (Scrap), turns "Auto-refill from template" on,
// loses another and presses Replenish, then shows the selection panel's Template row and the Fleet Designs tab.
// Usage: node scripts/fleetrefill-shots.mjs <baseUrl> <outDir> [w] [h] [dpr] [worker]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/fleetrefill', w = '1920', h = '1080', dpr = '1', mode = ''] = process.argv.slice(2);
const worker = mode === 'worker';
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
await page.goto(`${base}?autostart=1${worker ? '&simWorker=1' : ''}`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 240000 });
await page.waitForTimeout(3000);
const tag = `${w}x${h}@${dpr}${worker ? '-worker' : ''}`;
const shot = async (name) => {
    const p = `${outDir}/${name}-${tag}.png`;
    await page.screenshot({ path: p });
    console.log('saved', p);
};
/** Issue a player command from the page (window.__dwu.commands.issue) and wait for its reply. */
const command = (op, argsFn) =>
    page.evaluate(
        ([op, src]) =>
            new Promise((resolve) => {
                const game = window.__dwu.game;
                const p = game.playerEmpire;
                // eslint-disable-next-line no-new-func
                const args = new Function('p', 'game', `return (${src})(p, game);`)(p, game);
                window.__dwu.commands.issue(p.galaxy, p, op, args, (r) => resolve(JSON.parse(JSON.stringify(r, (k, v) => (v !== null && typeof v === 'object' && k !== '' && !Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype ? `<${v.constructor?.name}>` : v)))));
                setTimeout(() => resolve('<no reply>'), 15000);
            }),
        [op, argsFn.toString()],
    );

// The player manages fleets (Fleet Formation automation off, as the Form / Build buttons ask), and has money.
await command('setEmpireControl', () => ['controlMilitaryFleets', false]);
const id = await command('fleetTemplateCreate', () => ['Strike Group']);
console.log('template', id);
const rows = await page.evaluate(() => {
    const p = window.__dwu.game.playerEmpire;
    const free = (p.builtObjects ?? []).filter((b) => b != null && !b.hasBeenDestroyed && b.role === 1 && b.shipGroup == null && b.builtAt == null && b.topSpeed > 0);
    const m = new Map();
    for (const b of free) m.set(b.design, (m.get(b.design) ?? 0) + 1);
    window.__refillRows = [...m.entries()];
    return window.__refillRows.map(([d, n]) => `${n} × ${d.name}`);
});
console.log('rows', rows);
for (let i = 0; i < rows.length; i++) {
    await page.evaluate(([i, id]) => void (window.__refillArgs = [id, window.__refillRows[i][0], window.__refillRows[i][1]]), [i, id]);
    await command('fleetTemplateSetEntry', () => window.__refillArgs);
}
const form = await command('fleetTemplateForm', (p) => [p.fleetDesigns.templates.find((t) => t.name === 'Strike Group').id, p.capital, false]);
console.log('form', form);
await page.waitForTimeout(1500);

// The Fleets window on the fleet.
await page.click('[data-hud="tbtnShipGroups"]');
await page.waitForSelector('[data-ow="fleets"] .ow-grid');
await page.waitForTimeout(800);
await page.locator('[data-ow="fleets"] .ow-tab', { hasText: 'Fleets' }).click().catch(() => {});
await page.locator('[data-ow="fleets"] .ow-grid-row', { hasText: 'Strike Group' }).first().click();
await page.waitForTimeout(1500);
await shot('fleet-complete');
const status = () => page.locator('[data-ow="fleets"] .fr-status').textContent();
const replenishTitle = () => page.locator('[data-ow="fleets"] .fr-row .ow-glass', { hasText: 'Replenish' }).getAttribute('title');
console.log('status:', await status(), '| replenish:', await replenishTitle());

// Lose a ship (Scrap), then turn auto-refill on: a replacement is queued at once.
console.log('scrap', await command('scrapShips', (p) => [[(p.shipGroups ?? []).find((f) => f && f.name === 'Strike Group').ships[0]]]));
await page.waitForTimeout(1500);
console.log('status after loss:', await status(), '| replenish:', await replenishTitle());
await shot('fleet-lost-one');
await page.locator('[data-ow="fleets"] .fr-row .ow-check', { hasText: 'Auto-refill from template' }).click();
// A new game starts paused (commands apply, sim frames do not run): run the clock for the auto-refill check.
await page.evaluate(() => void (window.__dwu.time.paused = false));
await page.waitForTimeout(4000);
await page.evaluate(() => void (window.__dwu.time.paused = true));
await page.waitForTimeout(1000);
console.log('status auto-refill:', await status(), '| checked:', await page.locator('[data-ow="fleets"] .fr-row .ow-check input').isChecked());
await shot('fleet-autorefill');

// Turn auto-refill off, lose another ship, press Replenish.
await page.locator('[data-ow="fleets"] .fr-row .ow-check', { hasText: 'Auto-refill from template' }).click();
await page.waitForTimeout(800);
const left = await page.evaluate(() => (window.__dwu.game.playerEmpire.shipGroups ?? []).find((f) => f && f.name === 'Strike Group')?.ships.length ?? 0);
if (left > 0) {
    console.log('scrap', await command('scrapShips', (p) => [[(p.shipGroups ?? []).find((f) => f && f.name === 'Strike Group').ships[0]]]));
    await page.waitForTimeout(1500);
}
console.log('status before Replenish:', await status(), '| replenish:', await replenishTitle());
await shot('fleet-replenish-ready');
await page.locator('[data-ow="fleets"] .fr-row .ow-glass', { hasText: 'Replenish' }).click();
await page.waitForTimeout(2000);
console.log('status after Replenish:', await status(), '| replenish:', await replenishTitle());
await shot('fleet-replenished');

// The Fleet Designs tab (the design's fleets, the replacements' build orders).
await page.locator('[data-ow="fleets"] .ow-tab', { hasText: 'Fleet Designs' }).click();
await page.waitForTimeout(1200);
await shot('fleet-designs');

// Select Fleet → the selection panel's Template row.
await page.locator('[data-ow="fleets"] .ow-tab', { hasText: 'Fleets' }).first().click();
await page.waitForTimeout(500);
await page.locator('[data-ow="fleets"] .ow-glass', { hasText: 'Go to Fleet' }).click().catch(() => {});
await page.waitForTimeout(2000);
await shot('selection-panel');
console.log('selection panel:', (await page.locator('.sel-content-box').first().textContent().catch(() => ''))?.replace(/\s+/g, ' ').slice(0, 400));
console.log(logs.length ? logs.join('\n') : 'no console errors');
await browser.close();
