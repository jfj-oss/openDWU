// Real-event check: pending notifications appear as stubs under the money panel; a double right-click (real mouse
// events) dismisses each kind. Usage: node scripts/badge-dismiss-check.mjs <baseUrl> [outPng]
import { chromium } from 'playwright-core';
const [base = 'http://localhost:5173/', out = 'shots/badges.png'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => (m.type() === 'error' || m.text().startsWith('queued')) && logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${base}?autostart=1`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 120000 });
await page.waitForTimeout(2000);
await page.evaluate(async () => {
    const { galaxy } = window.__dwu;
    const player = galaxy.playerEmpire;
    const m = await import('/src/sim/messages.ts');
    const aq = await import('/src/sim/advisorQueue.ts');
    const other = galaxy.empires.find((e) => e !== player && e !== galaxy.independentEmpire);
    m.sendMessageToEmpire(other, player, m.EmpireMessageType.GeneralNeutralEvent, null, 'A plain notice');
    m.sendMessageToEmpire(other, player, m.EmpireMessageType.GeneralWarning, null, 'A warning notice');
    m.sendMessageToEmpire(other, player, m.EmpireMessageType.GiveGift, null, 'A gift proposal');
    m.sendMessageToEmpire(other, player, m.EmpireMessageType.ProposeDiplomaticRelation, null, 'A treaty proposal');
    const s = new m.EmpireMessage(other, m.EmpireMessageType.AdvisorSuggestion, null);
    s.advisorMessageType = aq.AdvisorMessageType.Colonization; s.starDate = (await import('/src/sim/tick/simTime.ts')).galaxyStarDate(galaxy);
    s.description = 'Advisor: colonize something';
    aq.addAdvisorSuggestion(player, s);
    window.__sugg = s; console.log('queued', aq.advisorSuggestions(player).length);
});
await page.waitForTimeout(1500);
const count = () => page.locator('.message-stubs .message-stub').count();
console.log('stubs before', await count(), JSON.stringify(await page.locator('.message-stub').evaluateAll((r) => r.map((x) => x.className + '|' + x.textContent))));
await page.screenshot({ path: out });
for (let i = 0; i < 8; i++) {
    const n = await count();
    if (n === 0) break;
    const box = await page.locator('.message-stubs .message-stub').first().boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.click(x, y, { button: 'right' });
    await page.waitForTimeout(120);
    const mid = await count();
    await page.mouse.click(x, y, { button: 'right' });
    await page.waitForTimeout(300);
    console.log(`round ${i}: ${n} -> after 1st ${mid} -> after 2nd ${await count()}`);
}
console.log('stubs after', await count());
console.log('suggestion still queued:', await page.evaluate(async () => (await import('/src/sim/advisorQueue.ts')).advisorSuggestions(window.__dwu.galaxy.playerEmpire).length));
await browser.close();
for (const l of logs) console.log(l);
