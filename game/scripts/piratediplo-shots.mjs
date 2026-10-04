// Pirate-player diplomacy captures (wip/piratediplo): a Custom Pirate game's Diplomacy screen on a standard empire
// (EmpireDetailView.cs DrawEmpireDetail 512-570: the PirateRelation, their feeling, the protection payment, the pirate
// relationship factors), the message dialog's "Let's discuss something else..." rebuilding the greeting menu
// (Main.Part9.cs:731 method_241 → method_238), a protection proposal answered there, and the HISTORY_OFFER_LOCATIONHINT
// "Tell us more" reply (Main.Part10.cs:4988 → HISTORY_LOCATIONHINT) — in-thread and with ?simWorker=1. Every game change
// goes through issuePlayerCommand (the conversation's own links); the conversations are opened with openConversation.
// Setup pokes (in-thread only, not journaled): StoryCluesEnabled, so the location hint has a clue to name.
// Usage: node scripts/piratediplo-shots.mjs <baseUrl> <outDir> [w] [h]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/piratediplo', w = '1920', h = '1080'] = process.argv.slice(2);
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

for (const mode of ['inthread', 'worker']) {
    const logs = [];
    const page = await browser.newPage({ viewport: { width: +w, height: +h } });
    page.on('console', (m) => {
        if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
    });
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
    const shot = async (name) => {
        await page.waitForTimeout(900);
        const path = `${outDir}/${name}-${mode}.png`;
        await page.screenshot({ path });
        console.log(`saved ${path}`);
    };
    try {
        const ng = encodeURIComponent(JSON.stringify({ seed: 5, empireType: 'CustomPirate', starCountIndex: 0, dimensionIndex: 0, otherEmpires: { empireCount: 6 } }));
        await page.goto(`${base}?newgame=${ng}&intro=0${mode === 'worker' ? '&simWorker=1' : '&simWorker=0'}`);
        await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 600000 });
        if (mode === 'worker') check(await page.evaluate(() => window.__dwu.simWorker !== null), `${mode}: the sim runs in a worker`);
        check(await page.evaluate(() => window.__dwu.galaxy.playerEmpire.pirateEmpireBaseHabitat !== null), `${mode}: the player is a pirate faction`);
        await page.evaluate(() => {
            for (const el of document.querySelectorAll('[data-ow="introduction"] button')) if (el.textContent.includes('Start')) el.click();
            window.__dwu.time.speed = 8;
            window.__dwu.time.paused = false;
        });
        // Run until the pirates have met a standard empire (their PirateRelation is no longer NotMet).
        const met = await page
            .waitForFunction(
                () => {
                    const g = window.__dwu.galaxy;
                    const p = g.playerEmpire;
                    for (const r of p.pirateRelations) if (r.type !== 0 && r.otherEmpire && r.otherEmpire.pirateEmpireBaseHabitat === null && r.otherEmpire !== g.independentEmpire) return true;
                    return false;
                },
                null,
                { timeout: 420000, polling: 2000 },
            )
            .then(() => true)
            .catch(() => false);
        await page.evaluate(() => {
            window.__dwu.time.paused = true;
            window.__dwu.time.speed = 1;
        });
        check(met, `${mode}: the pirates met a standard empire`);
        if (!met) continue;
        const name = await page.evaluate(() => {
            const g = window.__dwu.galaxy;
            const p = g.playerEmpire;
            for (const r of p.pirateRelations) if (r.type !== 0 && r.otherEmpire && r.otherEmpire.pirateEmpireBaseHabitat === null && r.otherEmpire !== g.independentEmpire) return r.otherEmpire.name;
            return '';
        });
        console.log(`  ${mode}: met ${name}`);
        const openDiplomacy = async () =>
            page.evaluate(async (empireName) => {
                const { closeAllOriginalWindows } = await import('/src/ui/originalWindow.ts');
                closeAllOriginalWindows();
                const D = await import('/src/ui/screens/diplomacyScreen.ts');
                const g = window.__dwu.galaxy;
                D.toggleDiplomacyScreen({ player: g.playerEmpire, selectedEmpire: g.empires.find((e) => e.name === empireName) });
            }, name);
        await openDiplomacy();
        await shot('pirate-detail');
        const detail = await page.evaluate(() => document.querySelector('.dip-pirate-player') !== null);
        check(detail, `${mode}: the pirate-player relation block is drawn`);

        // A conversation from that empire; "Let's discuss something else..." keeps it in the dialog with the greeting menu.
        await page.evaluate(async (empireName) => {
            const { closeAllOriginalWindows } = await import('/src/ui/originalWindow.ts');
            closeAllOriginalWindows();
            const P = await import('/src/ui/messagePopups.ts');
            const M = await import('/src/sim/messages.ts');
            const g = window.__dwu.galaxy;
            const other = g.empires.find((e) => e.name === empireName);
            const m = new M.EmpireMessage(other, M.EmpireMessageType.GeneralWarning, null);
            m.description = 'Your ships have been seen near our colonies.';
            m.starDate = (await import('/src/sim/tick/simTime.ts')).galaxyStarDate(g);
            const entry = { message: m, conversation: 'WARNING_GENERAL', sender: other };
            P.conversationQueue().push(entry); // queued as a received conversation (else the queue sweep closes it)
            P.openConversation(entry);
        }, name);
        await page.waitForSelector('.msg-talk .msg-talk-option[data-option="GREETING_NEUTRAL"]', { timeout: 20000 });
        await shot('talk-message');
        await page.click('.msg-talk .msg-talk-option[data-option="GREETING_NEUTRAL"]');
        await page.waitForTimeout(800);
        const menu = await page.evaluate(() => [...document.querySelectorAll('.msg-talk .msg-talk-option')].map((a) => a.dataset.option));
        console.log(`  ${mode}: greeting menu ${JSON.stringify(menu)}`);
        check(menu.includes('PIRATE_PROTECTIONPROPOSE_OFFER') && menu[menu.length - 1] === 'Exit', `${mode}: the greeting menu is in the dialog`);
        check(await page.evaluate(() => document.querySelector('[data-ow="diplomacy-talk"]') === null), `${mode}: the Diplomacy talk panel did not open`);
        await shot('talk-greeting');
        if (menu.includes('PIRATE_PROTECTIONPROPOSE_OFFER')) {
            await page.click('.msg-talk .msg-talk-option[data-option="PIRATE_PROTECTIONPROPOSE_OFFER"]');
            await page.waitForFunction(() => document.querySelector('.msg-talk .msg-talk-reply[data-reply]') !== null, null, { timeout: 30000 }).catch(() => {});
            await page.waitForTimeout(800);
            const reply = await page.evaluate(() => document.querySelector('.msg-talk .msg-talk-reply')?.dataset.reply ?? '');
            console.log(`  ${mode}: reply ${reply}`);
            check(reply.startsWith('PIRATE_PROTECTIONPROPOSE_OFFER_'), `${mode}: the protection proposal was answered in the dialog`);
            await shot('talk-proposal-reply');
            await page.waitForTimeout(1500);
            await openDiplomacy();
            await shot('pirate-detail-after');
        }

        // HISTORY_OFFER_LOCATIONHINT: "Tell us more" → HISTORY_LOCATIONHINT with CheckForStoryLocationHint's text.
        if (mode === 'inthread') await page.evaluate(() => (window.__dwu.galaxy.storyCluesEnabled = true));
        await page.evaluate(async (empireName) => {
            const { closeAllOriginalWindows } = await import('/src/ui/originalWindow.ts');
            closeAllOriginalWindows();
            const P = await import('/src/ui/messagePopups.ts');
            const M = await import('/src/sim/messages.ts');
            const g = window.__dwu.galaxy;
            const other = g.empires.find((e) => e.name === empireName);
            const m = new M.EmpireMessage(other, M.EmpireMessageType.HistoryOfferLocationHint, null);
            m.description = 'Our research has uncovered the location of important historical items.\n\nWould you like to know more?';
            m.starDate = (await import('/src/sim/tick/simTime.ts')).galaxyStarDate(g);
            const entry = { message: m, conversation: 'HISTORY_OFFER_LOCATIONHINT', sender: other };
            P.conversationQueue().push(entry); // queued as a received conversation (else the queue sweep closes it)
            P.openConversation(entry);
        }, name);
        await page.waitForSelector('.msg-talk .msg-talk-option[data-option="HISTORY_OFFER_LOCATIONHINT_ACCEPT"]', { timeout: 20000 });
        await shot('locationhint-offer');
        await page.click('.msg-talk .msg-talk-option[data-option="HISTORY_OFFER_LOCATIONHINT_ACCEPT"]');
        await page.waitForFunction(() => document.querySelector('.msg-talk .msg-talk-reply[data-reply="HISTORY_LOCATIONHINT"]') !== null, null, { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(800);
        const hint = await page.evaluate(() => document.querySelector('.msg-talk .msg-talk-reply')?.textContent ?? '');
        console.log(`  ${mode}: hint "${hint}"`);
        check(hint.startsWith('Our sources tell us about the'), `${mode}: the location hint reply text is shown`);
        await shot('locationhint-reply');
        const log = await page.evaluate(async () => (await window.__dwu.commands.log()).map((e) => e.op));
        check(log.includes('submitProposal') && log.includes('answerConversation'), `${mode}: the answers are in the command journal`);
    } catch (e) {
        check(false, `${mode}: ${e.message}`);
    } finally {
        for (const l of logs) console.log(`  ${l}`);
        await page.close();
    }
}
await browser.close();
if (failures.length > 0) {
    console.log(`${failures.length} failure(s)`);
    process.exit(1);
}
