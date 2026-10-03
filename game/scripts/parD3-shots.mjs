// Parity batch D3 captures: the diplomacy detail (ability bonus lines, restricted-resource checkbox, ambassador
// portrait), the alliance naming panel (a list row double-clicked), a pirate faction's relation factors and its
// "Buy information" reply, the WAR_END conversation of an AI's SubjugateRequest with the reply panel after a choice,
// the Empire Policy Load / Save lists and design picker, the character summary (name box), the fleets list portraits.
// Usage: node scripts/parD3-shots.mjs <baseUrl> <outDir>
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/parD3'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const logs = [];
page.on('console', (m) => {
    if (m.type() === 'error') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${base}?autostart=1`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 240000 });
await page.waitForTimeout(3000);
const shot = async (name) => {
    await page.screenshot({ path: `${outDir}/${name}.png` });
    console.log(`${outDir}/${name}.png`);
};
// Meet every empire and pirate faction; give the player an ambassador at the first empire's capital and a super-luxury
// resource flag is left to the game.
await page.evaluate(async () => {
    const { withSimWrites } = await import('/src/sim/readOnlyQuery.ts');
    const { obtainPirateRelation } = await import('/src/sim/pirateRelations.ts');
    withSimWrites(() => {
        const g = window.__dwu.galaxy;
        const p = g.playerEmpire;
        let n = 0;
        for (const r of p.diplomaticRelations) {
            if (r.type === 0 && r.otherEmpire && r.otherEmpire.pirateEmpireBaseHabitat === null) {
                r.type = n === 1 ? 2 : n === 2 ? 7 : 1;
                const t = r.otherEmpire.diplomaticRelations.byEmpire(p);
                if (t) t.type = r.type;
                n++;
            }
        }
        for (const r of p.pirateRelations ?? []) if (r.type === 0) r.type = 1;
        for (const pe of g.pirateEmpires) {
            const pr = obtainPirateRelation(pe, p);
            obtainPirateRelation(p, pe).type = 1;
            if (pr) {
                pr.type = 1;
                pr.evaluationGifts = 12;
                pr.evaluationShipAttacks = -8;
            }
        }
        const first = p.diplomaticRelations.items.find((r) => r.type === 1 && r.otherEmpire?.capital)?.otherEmpire;
        // Screenshot only: an ambassador at their capital (a non-leader character stands in when none exists yet).
        const amb = p.characters.find((c) => c && c.role === 2) ?? p.characters.find((c) => c && c.role !== 1);
        if (amb) amb.role = 2;
        if (first && amb) amb.location = first.capital;
        if (first) window.__parD3First = first;
    });
});
await page.click('[data-hud="tbtnEmpires"]');
await page.waitForSelector('[data-ow="diplomacy"]');
await page.waitForTimeout(1200);
const rows = page.locator('[data-ow="diplomacy"] .ow-grid-row');
const firstName = await page.evaluate(() => window.__parD3First?.name ?? '');
const firstRow = firstName !== '' ? rows.filter({ hasText: firstName }).first() : rows.nth(1);
await firstRow.click();
await page.waitForTimeout(1200);
await shot('diplomacy-empire-detail');
console.log('ambassador portraits:', await page.locator('.dip-ambassador-portrait').count(), 'restricted:', await page.locator('.dip-restricted-check').count());
// pnlRelationAllianceName: a double-click on the row.
await firstRow.dblclick();
await page.waitForSelector('[data-ow="alliance-name"]');
await page.fill('[data-ow="alliance-name"] .dip-alliance-input', 'Grand Concord');
await shot('diplomacy-alliance-name');
await page.locator('[data-ow="alliance-name"] .ow-glass').click();
await page.waitForTimeout(1500);
await shot('diplomacy-alliance-applied');
console.log('alliance:', await page.locator('[data-ow="diplomacy"] .dip-alliance').allInnerTexts());
// The last rows are the pirate factions.
const n = await rows.count();
await rows.nth(n - 1).click();
await page.waitForTimeout(1200);
await shot('diplomacy-pirate-factors');
console.log('pirate:', (await page.locator('[data-ow="diplomacy"] .dip-pirate').innerText()).replace(/\n+/g, ' | '));
await page.locator('[data-ow="diplomacy"] .ow-glass', { hasText: 'Speak with' }).click();
await page.waitForTimeout(1500);
const buy = page.locator('[data-ow="diplomacy-talk"] .dip-talk-link', { hasText: 'Buy information' });
if ((await buy.count()) > 0) {
    await buy.first().click();
    await page.waitForTimeout(1500);
}
await shot('diplomacy-pirate-buy-information');
console.log('buy info:', (await page.locator('[data-ow="diplomacy-talk"]').innerText()).replace(/\n+/g, ' | '));
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
// An AI's SubjugateRequest (Empire.8.cs 1527): war, the proposed SubjugatedDominion, a ProposeDiplomaticRelation naming None.
await page.evaluate(async () => {
    const { withSimWrites } = await import('/src/sim/readOnlyQuery.ts');
    const { EmpireMessageType, sendMessageToEmpire } = await import('/src/sim/messages.ts');
    const { DiplomaticRelation, DiplomaticRelationType, obtainDiplomaticRelation } = await import('/src/sim/diplomacy.ts');
    const { galaxyStarDate } = await import('/src/sim/tick/simTime.ts');
    const g = window.__dwu.galaxy;
    const p = g.playerEmpire;
    const other = window.__parD3First;
    withSimWrites(() => {
        obtainDiplomaticRelation(p, other).type = DiplomaticRelationType.War;
        obtainDiplomaticRelation(other, p).type = DiplomaticRelationType.War;
        p.proposedDiplomaticRelations.add(new DiplomaticRelation(DiplomaticRelationType.SubjugatedDominion, other, other, p, galaxyStarDate(g), false));
        // Empire.8.cs 1527: SendMessageToEmpire(otherEmpire, ProposeDiplomaticRelation, DiplomaticRelationType.None, ...).
        sendMessageToEmpire(other, p, EmpireMessageType.ProposeDiplomaticRelation, DiplomaticRelationType.None, 'We demand that you surrender and become our subjugated dominion.', { x: 0, y: 0 }, '');
    });
});
await page.waitForSelector('[data-ow="msgtalk"] [data-option="WAR_END_ACCEPT"]', { timeout: 15000 });
await page.waitForTimeout(1200);
await shot('subjugate-request-war-end');
await page.locator('[data-ow="msgtalk"] [data-option="WAR_END_ACCEPT"]').click();
await page.waitForTimeout(2500);
await shot('subjugate-request-reply-panel');
console.log('reply:', (await page.locator('[data-ow="msgtalk"]').innerText()).replace(/\n+/g, ' | '));
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
// Empire Policy: Load list, Save form, the design picker.
await page.evaluate(async () => {
    const { toggleEmpirePolicy } = await import('/src/ui/screens/empirePolicy.ts');
    toggleEmpirePolicy({ empire: window.__dwu.galaxy.playerEmpire });
});
await page.waitForSelector('.policy-window');
await page.locator('.policy-design').first().scrollIntoViewIfNeeded();
await shot('policy-design-picker');
await page.click('.policy-load');
await page.waitForTimeout(500);
await shot('policy-load-list');
await page.click('.policy-save');
await page.waitForTimeout(300);
await page.click('.policy-file-ok');
await page.waitForTimeout(500);
await page.click('.policy-load');
await page.waitForTimeout(300);
await shot('policy-load-list-after-save');
await page.locator('.policy-file-entry', { hasText: 'Human.txt' }).first().click();
await page.waitForTimeout(1500);
await shot('policy-after-load');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
// Characters (F4): the summary's name box.
await page.evaluate(async () => {
    const { toggleIntelligenceScreen } = await import('/src/ui/screens/intelligence.ts');
    toggleIntelligenceScreen({ player: window.__dwu.galaxy.playerEmpire });
});
await page.waitForTimeout(1500);
const nameBox = page.locator('.ch-name-box');
if ((await nameBox.count()) > 0) await nameBox.first().focus();
await shot('characters-name-box');
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await shot('main-left-sidebar');
console.log(logs.length ? logs.join('\n') : 'no console errors');
await browser.close();
