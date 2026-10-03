#!/usr/bin/env node
// Sim worker smoke, chunk 7 (docs/sim-worker.md §9): diplomacy, characters and agent missions in headless Chromium.
// Worker mode runs with chunk 0's replica write detector (?detectWrites=1); any main-thread write it finds fails.
// Loads a save in which the player has met the other empires and pirate factions, then, through the real DOM:
// opens the Diplomacy screen (F5), selects the first empire, opens the talk panel (Speak), waits for its options (in
// worker mode the listing is a worker query), sends a small gift and waits for the reply; selects a pirate faction and
// checks the protection price shows; opens the Characters screen (F4). Screenshots of each, console errors fail.
//   node scripts/simworker-smoke-diplomacy.mjs <base url> --load=/dev-saves/<save>.dwusave [--out=shots/sw7] [--inthread]
// (a suitable save: every empire met, some money — e.g. a test game after setting the relations, serializeGame.)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const opt = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const load = opt('load', '');
const inThread = process.argv.includes('--inthread');
const out = opt('out', `shots/sw7-${inThread ? 'inthread' : 'worker'}`);
if (load === '') throw new Error('--load=<save url> is required (a save where the player has met other empires)');
mkdirSync(out, { recursive: true });
const url = `${base}?load=${encodeURIComponent(load)}&simWorker=${inThread ? 0 : 1}${inThread ? '' : '&detectWrites=1'}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.stack ?? e.message}`));
let failed = 0;
const check = (ok, what) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok) failed++;
};
const shot = async (name) => {
    await page.screenshot({ path: `${out}/${name}.png` });
    console.log(`saved ${out}/${name}.png`);
};
try {
    await page.goto(url);
    await page.waitForFunction(() => window.__dwu?.time !== undefined && window.__dwu?.view !== undefined, null, { timeout: 600000 });
    check(inThread === (await page.evaluate(() => window.__dwu.simWorker === null)), inThread ? 'game runs in-thread' : 'game runs in the worker');
    await page.evaluate(() => {
        window.__dwu.time.paused = true;
    });
    const money0 = await page.evaluate(() => window.__dwu.game.playerEmpire.stateMoney);

    // Diplomacy screen.
    await page.keyboard.press('F5');
    await page.waitForSelector('[data-ow="diplomacy"] .dip-list .ow-grid-row', { timeout: 20000 });
    const rows = await page.$$eval('[data-ow="diplomacy"] .dip-list .ow-grid-row', (r) => r.length);
    check(rows >= 2, `diplomacy list: ${rows} rows (the player + met empires and pirates)`);
    // Empires only (the kind filter), then the first one after the player's own row.
    await page.selectOption('[data-ow="diplomacy"] select.diplomacy-filter-kind', 'empires');
    await page.waitForTimeout(300);
    await page.click('[data-ow="diplomacy"] .dip-list .ow-grid-row:nth-child(2)');
    await page.waitForTimeout(300);
    await shot('diplomacy');
    // Speak → the talk panel; its options arrive (worker: the listing query's answer).
    await page.click('[data-ow="diplomacy"] button:has-text("Speak with")');
    await page.waitForSelector('[data-ow="diplomacy-talk"] .dip-talk-options .dip-talk-link', { timeout: 20000 });
    const gotGift = await page
        .waitForFunction(() => [...document.querySelectorAll('[data-ow="diplomacy-talk"] .dip-talk-link')].some((a) => /gift/i.test(a.textContent ?? '')), null, { timeout: 20000 })
        .then(() => true, () => false);
    if (!gotGift) console.log('talk panel:', await page.$eval('[data-ow="diplomacy-talk"]', (e) => e.textContent));
    const links = await page.$$eval('[data-ow="diplomacy-talk"] .dip-talk-link', (a) => a.map((x) => x.textContent));
    check(links.length >= 3, `talk panel options: ${links.join(' / ')}`);
    await shot('talk');
    await page.click('[data-ow="diplomacy-talk"] .dip-talk-link:has-text("Send a gift")');
    await page.waitForSelector('[data-ow="diplomacy-talk"] .dip-talk-link:has-text("small gift")', { timeout: 10000 });
    await page.click('[data-ow="diplomacy-talk"] .dip-talk-link:has-text("small gift")');
    await page.waitForSelector('[data-ow="diplomacy-talk"] .diplomacy-reply-accepted, [data-ow="diplomacy-talk"] .diplomacy-reply-refused, [data-ow="diplomacy-talk"] .diplomacy-reply-error', { timeout: 20000 });
    const reply = await page.$eval('[data-ow="diplomacy-talk"] .diplomacy-reply', (e) => e.className + ': ' + e.textContent);
    check(/accepted/.test(reply), `gift reply: ${reply}`);
    await page.waitForFunction((m0) => window.__dwu.game.playerEmpire.stateMoney < m0, money0, { timeout: 20000 });
    check(true, 'the gift left the treasury (replica money down)');
    await shot('talk-gift');
    // The trade negotiation (DEAL_BEGIN): the panel edits the negotiation the reply carried, then proposes it.
    await page.waitForSelector('[data-ow="diplomacy-talk"] .dip-talk-link:has-text("Negotiate a trade proposal")', { timeout: 20000 });
    await page.click('[data-ow="diplomacy-talk"] .dip-talk-link:has-text("Negotiate a trade proposal")');
    // A one-option entry submits at once; else (e.g. at war: "...an end to this war") pick the sub-menu's option.
    if (!(await page.waitForSelector('.trade-window .trade-column', { timeout: 3000 }).then(() => true, () => false))) {
        await page.click('[data-ow="diplomacy-talk"] .dip-talk-link:has-text("Negotiate")');
    }
    await page.waitForSelector('.trade-window .trade-column', { timeout: 20000 });
    const offered0 = await page.$$eval('.trade-window .trade-column:nth-child(2) .trade-offered-item', (r) => r.length);
    await page.click('.trade-window .trade-column:nth-child(2) .trade-item:has-text("credits")');
    await page.waitForTimeout(200);
    const offered1 = await page.$$eval('.trade-window .trade-column:nth-child(2) .trade-offered-item', (r) => r.length);
    check(offered1 === offered0 + 1, `trade panel: money offered (${offered0} → ${offered1} items)`);
    await page.click('.trade-window .trade-propose');
    const tradeReply = await page
        .waitForSelector('.trade-window .trade-reply-accepted, .trade-window .trade-reply-refused, .trade-window .trade-reply-error', { timeout: 20000 })
        .then((e) => e.evaluate((x) => x.className + ': ' + x.textContent), () => '(no reply)');
    check(/accepted|refused/.test(tradeReply), `trade reply: ${tradeReply}`);
    await shot('trade');
    await page.click('.trade-window .trade-close');
    await page.waitForTimeout(200);
    await page.click('[data-ow="diplomacy-talk"] .dip-talk-link:has-text("Goodbye")');
    await page.waitForTimeout(200);
    // A pirate faction: the protection price (worker: the price query's answer).
    await page.selectOption('[data-ow="diplomacy"] select.diplomacy-filter-kind', 'pirates');
    await page.waitForTimeout(300);
    if ((await page.$('[data-ow="diplomacy"] .dip-list .ow-grid-row:nth-child(2)')) !== null) {
        await page.click('[data-ow="diplomacy"] .dip-list .ow-grid-row:nth-child(2)');
        const shown = await page
            .waitForFunction(() => /Protection price now: (?!…)|Protection Arrangement|Pirate truce/.test(document.querySelector('[data-ow="diplomacy"] .dip-detail')?.textContent ?? ''), null, { timeout: 20000 })
            .then(() => true, () => false);
        const text = await page.$eval('[data-ow="diplomacy"] .dip-detail', (e) => (e.textContent ?? '').match(/Protection price now: [^A-Z]*|Protection Arrangement[^)]*\)|Pirate truce[^)]*\)/)?.[0] ?? '(none)');
        check(shown, `pirate faction: ${text}`);
        if (!shown) console.log('pirate detail:', await page.$eval('[data-ow="diplomacy"] .dip-detail', (e) => e.textContent));
        await shot('pirate');
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Characters screen.
    await page.keyboard.press('F4');
    await page.waitForSelector('[data-ow="characters"] .ow-grid-row', { timeout: 20000 });
    const chars = await page.$$eval('[data-ow="characters"] .ow-grid-row', (r) => r.length);
    check(chars >= 1, `characters screen: ${chars} characters`);
    await page.click('[data-ow="characters"] .ow-grid-row:has-text("Agent Smoke")');
    await page.waitForTimeout(500);
    await shot('characters');
    // Assign the form's mission (counter-intelligence): a command with an IntelligenceMission built on this thread.
    await page.click('[data-ow="characters"] button:has-text("Assign Mission")');
    await page.waitForTimeout(300);
    const box = await page.$('.ow-msgbox button:has-text("No"), .ow-messagebox button:has-text("No")');
    if (box !== null) await box.click();
    const mission = await page
        .waitForFunction(() => {
            const row = [...document.querySelectorAll('[data-ow="characters"] .ow-grid-row')].find((r) => /Agent Smoke/.test(r.textContent ?? ''));
            const t = row?.textContent ?? '';
            return /No mission/.test(t) ? null : t;
        }, null, { timeout: 20000 })
        .then((h) => h.jsonValue(), () => null);
    check(mission !== null, `agent mission assigned: ${mission ?? '(still none)'}`);
    await shot('characters-mission');
    if (!inThread) {
        const found = await page.evaluate(() => {
            const det = window.__dwuWriteDetector;
            if (!det) return null;
            det.checkAll();
            return { unexpected: det.unexpected().map((w) => `${w.key} (${w.detail})${w.stack ? `\n${w.stack}` : ''}`), summary: det.summary() };
        });
        check(found !== null, 'replica write detector installed');
        if (found !== null) {
            // The message pipeline's writes are chunk 4's (docs/sim-worker.md §9): listed, not counted here.
            const otherChunks = /^(Empire\.(advisorSuggestions|messageHistory|messages|eventMessageRecipient)|EmpireMessage\.)/;
            const others = found.unexpected.filter((w) => otherChunks.test(w));
            const ours = found.unexpected.filter((w) => !otherChunks.test(w));
            if (others.length > 0) console.log(`replica writes of other chunks (message pipeline, chunk 4):\n  ${others.join('\n  ')}`);
            check(ours.length === 0, `no replica writes by the diplomacy / characters screens${ours.length > 0 ? `:\n${ours.join('\n')}` : ''}`);
        }
    }
} catch (err) {
    console.log(`FAIL ${err instanceof Error ? err.message : String(err)}`);
    failed++;
} finally {
    await browser.close();
    const errors = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]') || /sim worker (query|command)/.test(l));
    for (const l of errors.slice(0, 30)) console.log(l);
    if (errors.length > 0) failed++;
    console.log(failed === 0 ? 'SMOKE OK' : `SMOKE FAILED (${failed})`);
    process.exitCode = failed === 0 ? 0 : 1;
}
