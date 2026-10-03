// Parity batch C4 captures: the new-game Playstyle page (Introductory Game enabled), a Custom Pirate game's left sidebar
// (Pirate Missions with an AI smuggling request, accepted through the row button; the Colonies panel), the smuggling
// resource picker, the Return of the Shakturi story panel at level 2 (Join the Freedom Alliance?) and the Code 1 story
// ending — in-thread and with ?simWorker=1. Every game change goes through issuePlayerCommand.
// Usage: node scripts/parc4-shots.mjs <baseUrl> <outDir> [w] [h]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/parc4', w = '1920', h = '1080'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const failures = [];
const check = (cond, what) => {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
    if (!cond) failures.push(what);
};

async function newPage(mode, logs) {
    const page = await browser.newPage({ viewport: { width: +w, height: +h } });
    page.on('console', (m) => {
        if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
    });
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
    return page;
}

const shotOf = (page, mode) => async (name) => {
    await page.waitForTimeout(800);
    const path = `${outDir}/${name}-${mode}.png`;
    await page.screenshot({ path });
    console.log(`saved ${path}`);
};

// --- The Playstyle page (Start.cs pnlStartNewGameYourEmpireType).
{
    const logs = [];
    const page = await newPage('wizard', logs);
    await page.goto(`${base}?screen=wizard`);
    await page.waitForSelector('.wizard-type-page', { timeout: 120000 });
    await shotOf(page, 'wizard')('playstyle');
    check(await page.locator('.wizard-type-btn[data-type="Introductory"]').isEnabled(), 'the Introductory Game button is enabled');
    check(await page.locator('.wizard-type-btn[data-type="AncientGalaxy"]').isDisabled(), 'The Ancient Galaxy stays disabled (no .dwg reader)');
    for (const l of logs) console.log(`  ${l}`);
    await page.close();
}

for (const mode of ['inthread', 'worker']) {
    const logs = [];
    const page = await newPage(mode, logs);
    const shot = shotOf(page, mode);
    try {
        const ng = encodeURIComponent(JSON.stringify({ seed: 5, empireType: 'CustomPirate', starCountIndex: 0, dimensionIndex: 0, otherEmpires: { empireCount: 4 } }));
        await page.addInitScript(() => {
            try {
                localStorage.setItem('dwu.itemList.open', JSON.stringify('pirateMissions'));
                localStorage.setItem('dwu.itemList.size', JSON.stringify(1.33));
            } catch {
                /* ignore */
            }
        });
        await page.goto(`${base}?newgame=${ng}&intro=0${mode === 'worker' ? '&simWorker=1' : '&simWorker=0'}`);
        await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 600000 });
        if (mode === 'worker') check(await page.evaluate(() => window.__dwu.simWorker !== null), `${mode}: the sim runs in a worker`);
        check(await page.evaluate(() => window.__dwu.game.playerEmpire.pirateEmpireBaseHabitat !== null), `${mode}: the player is a pirate faction`);
        await page.evaluate(() => {
            window.__dwu.time.paused = true;
            for (const el of document.querySelectorAll('[data-ow="introduction"] button')) if (el.textContent.includes('Start')) el.click();
        });
        // An AI empire asks the pirates to smuggle to one of its colonies the pirate knows (a journaled command).
        const req = await page.evaluate(async () => {
            const pc = await import('/src/sim/player/playerCommands.ts');
            const g = window.__dwu.galaxy;
            const p = g.playerEmpire;
            const ai = g.empires.find((e) => e !== p && e.colonies.length > 0 && e.colonies.some((c) => p.visibility.checkSystemExplored(c.systemIndex)));
            if (!ai) return null;
            const colony = ai.colonies.find((c) => p.visibility.checkSystemExplored(c.systemIndex));
            return await new Promise((resolve) => pc.issuePlayerCommand(g, ai, 'assignPirateSmugglingMission', [colony, null], (r) => resolve({ ok: r, colony: colony.name })));
        });
        console.log(`  request: ${JSON.stringify(req)}`);
        // Let the game run (fast) until the panel has missions: the request above, or the independent colonies' and the
        // empires' own offers to the pirates (Galaxy.9.cs IndependentColoniesMakeSmugglingOffersToPirates, ...).
        await page.evaluate(() => {
            window.__dwu.time.speed = 8;
            window.__dwu.time.paused = false;
        });
        const listed = await page
            .waitForFunction(
                async () => {
                    const m = await import('/src/sim/pirates/pirateMissionsPanel.ts');
                    const g = window.__dwu.galaxy;
                    return m.pirateMissionsPanelData(g, g.playerEmpire, 0, 0).items.length > 0;
                },
                null,
                { timeout: 240000, polling: 2000 },
            )
            .then(() => true)
            .catch(() => false);
        console.log(`  missions listed: ${listed}`);
        await page.evaluate(() => {
            window.__dwu.time.paused = true;
            window.__dwu.time.speed = 1;
        });
        await page.waitForSelector('.ls-panel:not([hidden])', { timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(1200);
        await shot('pirate-missions');
        const rows = await page.locator('.ls-row').count();
        console.log(`  panel: ${await page.evaluate(() => { const p = document.querySelector('.ls-panel'); return p ? `hidden=${p.hidden} title=${p.querySelector('.ls-title')?.textContent ?? p.textContent.slice(0, 80)}` : 'none'; })}`);
        console.log(`  ${mode}: Pirate Missions rows: ${rows}`);
        const btn = page.locator('.ls-mission-btn', { hasText: 'Accept Mission' }).first();
        if ((await btn.count()) > 0) {
            await btn.click();
            await page.evaluate(() => (window.__dwu.time.paused = false));
            await page.waitForTimeout(1500);
            await page.evaluate(() => (window.__dwu.time.paused = true));
            await page.waitForTimeout(1200);
            await shot('pirate-missions-accepted');
            const accepted = await page.evaluate(() => window.__dwu.galaxy.playerEmpire.pirateMissions.items.length);
            check(accepted > 0, `${mode}: Accept Mission put the mission on the faction's list (${accepted})`);
            const log = await page.evaluate(async () => (await window.__dwu.commands.log()).map((e) => e.op));
            check(log.includes('pirateMissionButton'), `${mode}: pirateMissionButton is in the command journal`);
        }
        // The Colonies panel (the faction's own / controlled colonies).
        await page.evaluate(() => {
            document.querySelector('.ls-button[data-panel="colonies"]')?.click();
        });
        await shot('pirate-colonies');

        // The Return of the Shakturi story panel at level 2 (display only: no answer is clicked) and the Code 1 ending.
        await page.evaluate(async () => {
            const mp = await import('/src/ui/messagePopups.ts');
            const g = window.__dwu.galaxy;
            mp.showShakturiStoryPanel(g, g.playerEmpire, 'Ancient Guardians Reveal All', 'StoryMessageLevel2', 2);
        });
        await shot('story-freedom-alliance');
        check((await page.locator('.msg-story-yes').count()) === 1 && (await page.locator('.msg-story-no').count()) === 1, `${mode}: the level-2 story panel asks to join the alliance`);
        await page.evaluate(async () => {
            const mp = await import('/src/ui/messagePopups.ts');
            mp.closeStoryEventPopup();
            const ec = await import('/src/ui/screens/empireComparison.ts');
            const v = await import('/src/sim/victory.ts');
            const g = window.__dwu.galaxy;
            ec.presentGameEnd(g, window.__dwu.time, new v.GameEndEventArgs(g.playerEmpire, v.GameEndOutcome.Victory, 'You have captured the Shakturi capital', 1));
        });
        await shot('story-ending');
        check((await page.locator('.msg-story-title', { hasText: 'Defeated the Shakturi' }).count()) === 1, `${mode}: the Code 1 ending shows the story panel`);
    } catch (e) {
        failures.push(`${mode}: ${e.message}`);
        console.log(`FAIL ${mode}: ${e.message}`);
        await shot('error').catch(() => {});
    }
    for (const l of logs) console.log(`  ${l}`);
    await page.close();
}

// --- A standard empire: the smuggling resource picker on its own colony → Assign Mission → its request in Pirate Missions.
for (const mode of ['inthread', 'worker']) {
    const logs = [];
    const page = await newPage(mode, logs);
    const shot = shotOf(page, `${mode}-standard`);
    try {
        await page.addInitScript(() => {
            try {
                localStorage.setItem('dwu.itemList.open', JSON.stringify('pirateMissions'));
                localStorage.setItem('dwu.itemList.size', JSON.stringify(1.33));
            } catch {
                /* ignore */
            }
        });
        const ng = encodeURIComponent(JSON.stringify({ seed: 6, empireType: 'CustomStandard', starCountIndex: 0, dimensionIndex: 0, otherEmpires: { empireCount: 4 } }));
        await page.goto(`${base}?newgame=${ng}&intro=0${mode === 'worker' ? '&simWorker=1' : '&simWorker=0'}`);
        await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 600000 });
        await page.evaluate(async () => {
            window.__dwu.time.paused = true;
            const m = await import('/src/ui/pirateSmugglingPicker.ts');
            const g = window.__dwu.galaxy;
            m.openPirateSmugglingPicker(g, g.playerEmpire, g.playerEmpire.colonies[0]);
        });
        await page.locator('.pirate-smuggle-picker select').selectOption('1');
        await shot('smuggling-picker');
        check((await page.locator('.pirate-smuggle-picker select option').count()) > 1, `${mode}: the picker lists All Resources and the resources`);
        await page.locator('.pirate-smuggle-assign').click();
        await page.evaluate(() => (window.__dwu.time.paused = false));
        await page.waitForTimeout(1500);
        await page.evaluate(() => (window.__dwu.time.paused = true));
        await page.waitForTimeout(1500);
        await shot('pirate-missions-request');
        const n = await page.evaluate(() => window.__dwu.galaxy.playerEmpire.pirateMissions.items.length);
        check(n === 1, `${mode}: Assign Mission added the smuggling request (${n})`);
        check((await page.locator('.ls-mission-btn', { hasText: 'Cancel' }).count()) === 1, `${mode}: the request's row has the Cancel button`);
        const log = await page.evaluate(async () => (await window.__dwu.commands.log()).map((e) => e.op));
        check(log.includes('assignPirateSmugglingMission'), `${mode}: assignPirateSmugglingMission is in the command journal`);
    } catch (e) {
        failures.push(`${mode} standard: ${e.message}`);
        console.log(`FAIL ${mode} standard: ${e.message}`);
        await shot('error').catch(() => {});
    }
    for (const l of logs) console.log(`  ${l}`);
    await page.close();
}
await browser.close();
console.log(failures.length === 0 ? 'all checks passed' : `${failures.length} failed`);
process.exit(failures.length === 0 ? 0 : 1);
