// Parity batch D2 captures, in-thread and with ?simWorker=1: the Colonies screen's Construction Yard tab (purchaser,
// Scrap Ship / Remove Ship questions), the Construction Yards screen's data tabs (Cargo / Components / Docking Bays /
// Troops / Weapons) and Scrap question, the Resource Components window (Expansion Planner resource link), the Ruin
// Detail window, and the left sidebar's Enemy Targets panel.
// In-thread only, to have something to show on a fresh start, the script (not the game) makes two pirate factions'
// bases known (no agreement with those factions) and lends a ruin to the first colony — screenshot staging, not game behaviour.
// Usage: node scripts/pard2-shots.mjs <baseUrl> <outDir> [w] [h]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/pard2', w = '1920', h = '1080'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

for (const mode of ['inthread', 'worker']) {
    const page = await browser.newPage({ viewport: { width: +w, height: +h } });
    const logs = [];
    page.on('console', (m) => {
        if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
    });
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
    const shot = async (name) => {
        await page.waitForTimeout(800);
        const path = `${outDir}/${name}-${mode}.png`;
        await page.screenshot({ path });
        console.log(`saved ${path}`);
    };
    const answer = async (...labels) => {
        for (const label of labels) {
            const b = page.locator('[data-ow="msgbox"] .ow-glass', { hasText: label });
            if (await b.count()) {
                await b.first().click();
                await page.waitForTimeout(300);
                return;
            }
        }
    };
    const closeTop = async () => {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
    };
    try {
        await page.goto(`${base}?autostart=1${mode === 'worker' ? '&simWorker=1' : '&simWorker=0'}`);
        await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 300000 });
        await page.waitForTimeout(4000);
        await page.evaluate(() => (window.__dwu.time.paused = true));
        if (mode === 'inthread') {
            await page.evaluate(() => {
                const p = window.__dwu.game.playerEmpire;
                const g = window.__dwu.game.galaxy;
                // Enemy Targets on a fresh start: no enemy colony is explored yet, so make two pirate factions' bases
                // known (Empire.KnownPirateBases) with no agreement (PirateRelationType.None) — method_205's pirate part.
                let staged = 0;
                for (let i = 0; i < p.pirateRelations.count && staged < 2; i++) {
                    const r = p.pirateRelations.get(i);
                    const bases = (r.otherEmpire?.builtObjects ?? []).filter((b) => b && !b.hasBeenDestroyed && b.topSpeed === 0);
                    if (!r.otherEmpire || r.otherEmpire === g.independentEmpire || bases.length === 0) continue;
                    r.type = 1; // PirateRelationType.None
                    for (const b of bases) if (!p.knownPirateBases.includes(b)) p.knownPirateBases.push(b);
                    staged++;
                }
                const ruined = g.ruinsHabitats.find((x) => x.ruin);
                if (ruined && p.colonies[0] && !p.colonies[0].ruin) {
                    p.colonies[0].ruin = ruined.ruin;
                    ruined.ruin.playerEmpireEncountered = true;
                }
            });
        }

        // --- Colonies screen, Construction Yard tab (#21).
        await page.click('[data-hud="tbtnColonies"]');
        await page.waitForSelector('[data-ow="colonies"]');
        await page.locator('[data-ow="colonies"] .ow-tab', { hasText: 'Construction Yard' }).first().click();
        await shot('colony-yard');
        const buy = page.locator('[data-ow="colonies"] .ow-glass', { hasText: 'Purchase' });
        for (let i = 0; i < 3; i++) {
            if (await buy.isEnabled()) {
                await buy.click();
                await page.waitForTimeout(400);
                await answer('Leave on');
                await page.waitForTimeout(600);
            }
        }
        console.log(`${mode}: colony yard rows: ${await page.locator('[data-ow="colonies"] .col-page .ow-grid-row').count()}`);
        await shot('colony-yard-bought');
        const waitRow = page.locator('[data-ow="colonies"] .col-page .ow-grid').nth(1).locator('.ow-grid-row').first();
        if (await waitRow.count()) {
            await waitRow.click();
            await page.locator('[data-ow="colonies"] .ow-glass', { hasText: 'Remove Ship' }).click();
            await page.waitForTimeout(400);
            await shot('colony-remove-question');
            await answer('No', 'OK');
        }
        const yardRow = page.locator('[data-ow="colonies"] .col-page .ow-grid').nth(0).locator('.ow-grid-row').first();
        if (await yardRow.count()) {
            await yardRow.click();
            await page.locator('[data-ow="colonies"] .ow-glass', { hasText: 'Scrap Ship' }).click();
            await page.waitForTimeout(400);
            await shot('colony-scrap-question');
            await answer('No', 'OK');
        }
        // --- Ruin Detail (#30).
        const ruinBtn = page.locator('[data-ow="colonies"] .ow-glass', { hasText: 'Show Ruin Details' });
        if (await ruinBtn.isEnabled()) {
            await ruinBtn.click();
            await page.waitForSelector('[data-ow="ruin-detail"]', { timeout: 5000 }).catch(() => {});
            await shot('ruin-detail');
            await closeTop();
        } else console.log(`${mode}: no colony with a ruin (Ruin Detail not captured)`);
        await closeTop();

        // --- Construction Yards screen data tabs + Scrap (#22).
        await page.click('[data-hud="tbtnConstructionYards"]');
        await page.waitForSelector('[data-ow="yards"] .ow-grid-row');
        await page.waitForTimeout(1500);
        const tabs = ['cargo', 'components', 'yards', 'docking', 'troops', 'weapons'];
        for (const [i, name] of tabs.entries()) {
            await page.locator('[data-ow="yards"] .ow-tab').nth(i).click();
            if (name === 'components') {
                const r = page.locator('[data-ow="yards"] .cy-page:not([hidden]) .ow-grid-row').first();
                if (await r.count()) await r.click();
            }
            console.log(`${mode}: yards ${name} rows: ${await page.locator('[data-ow="yards"] .cy-page:not([hidden]) .ow-grid-row').count()}`);
            await shot(`yards-${name}`);
        }
        await page.locator('[data-ow="yards"] .ow-glass', { hasText: /^Scrap$/ }).click();
        await page.waitForTimeout(400);
        await shot('yards-scrap-question');
        await answer('No');
        await closeTop();

        // --- Resource Components (#23): a strategic resource's name in the Expansion Planner.
        await page.keyboard.press('F3');
        await page.waitForTimeout(1500);
        const links = page.locator('[data-ow="expansion"] .ow-grid').first().locator('a');
        const n = await links.count();
        let opened = false;
        for (let i = 0; i < n && !opened; i++) {
            await links.nth(i).click();
            await page.waitForTimeout(600);
            if (await page.locator('[data-ow="resource-components"]').count()) opened = true;
            else if (await page.locator('[data-ow="galactopedia"]').count()) await closeTop();
        }
        if (opened) {
            await shot('resource-components');
            await closeTop();
        } else {
            // No deficient resource on a fresh start: open the panel the planner link opens (method_552) on the first
            // strategic resource that components use, through the app's own module.
            await closeTop();
            await page.evaluate(async () => {
                const m = await import('/src/ui/screens/resourceComponents.ts');
                const g = window.__dwu.game.galaxy;
                const r = g.resourceSystem.strategicResources.find((x) => m.resourceComponentRows(g, x.resourceId).length > 0);
                if (r) m.openResourceLink(g, window.__dwu.game.playerEmpire, r.resourceId);
            });
            await page.waitForTimeout(800);
            console.log(`${mode}: resource components rows: ${await page.locator('[data-ow="resource-components"] .ow-grid-row').count()}`);
            await shot('resource-components');
        }
        await closeTop();

        // --- Left sidebar Enemy Targets (#20).
        await page.click('.ls-button[data-panel="enemyTargets"]');
        await page.waitForTimeout(2500);
        console.log(`${mode}: enemy target rows: ${await page.locator('.ls-panel .ls-row').count()}`);
        await shot('enemy-targets');
        // A left click on the first target sends the nearest fleet (or selects the fleet already on it).
        const first = page.locator('.ls-panel .ls-row').first();
        if (await first.count()) {
            await first.click();
            await page.waitForTimeout(1500);
            console.log(`${mode}: centred "attacking" rows after the click: ${await page.locator('.ls-panel .ls-centre').count()}`);
            await shot('enemy-targets-assigned');
        }
    } catch (e) {
        console.log(`${mode}: script error: ${e.message}`);
        await shot('error').catch(() => {});
    }
    console.log(`${mode}: ${logs.length ? logs.join('\n') : 'no console errors'}`);
    await page.close();
}
await browser.close();
