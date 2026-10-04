// WP7 captures: the recreation-only windows in the original style (advisor chat, Empires list, Trade Flows, Charters
// screen + dialog, trade negotiation, council log, LLM metrics overlay, Game Options -> Improvements).
// Windows are opened through the dev server's module graph (dynamic import), so run against `npm run dev`.
// Usage: node scripts/wp7-shots.mjs <baseUrl> <outDir> [tag] [extraQuery e.g. simWorker=1]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/wp7', tag = 'after', extra = ''] = process.argv.slice(2);
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
await page.goto(`${base}?autostart=1${extra ? `&${extra}` : ''}`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 240000 });
await page.waitForTimeout(3000);
const shot = async (name) => {
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${outDir}/${name}-${tag}.png` });
    console.log(`${outDir}/${name}-${tag}.png`);
};
const esc = async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
};
const step = async (name, fn) => {
    try {
        await fn();
        await shot(name);
    } catch (e) {
        logs.push(`[step ${name}] ${e.message}`);
    }
};
await step('empires', () => page.evaluate(async () => {
    const m = await import('/src/ui/screens/empiresList.ts');
    const g = window.__dwu.galaxy;
    m.toggleEmpiresList({ empires: g.empires, playerEmpire: g.playerEmpire, onZoomTo: () => {} });
}));
await esc();
await step('advisor', () => page.evaluate(async () => {
    const m = await import('/src/ui/advisorPanel.ts');
    const g = window.__dwu.galaxy;
    m.toggleAdvisorPanel({ galaxy: g, player: g.playerEmpire });
}));
await esc();
await step('tradeflows', () => page.evaluate(async () => {
    const m = await import('/src/ui/screens/tradeFlows.ts');
    const g = window.__dwu.galaxy;
    m.openTradeFlows({ galaxy: g, playerEmpire: g.playerEmpire, overlay: () => null, jumpTo: () => {} });
}));
await esc();
await step('charters', () => page.evaluate(async () => {
    const m = await import('/src/ui/screens/charters.ts');
    const g = window.__dwu.galaxy;
    m.toggleChartersScreen(g, g.playerEmpire);
}));
await esc();
await step('charterdialog', () => page.evaluate(async () => {
    const m = await import('/src/ui/screens/charters.ts');
    const g = window.__dwu.galaxy;
    const h = g.habitats.find((x) => x.name && x.resources && x.resources.length > 0) ?? g.habitats[0];
    m.openCharterDialog(g, g.playerEmpire, h, (id) => `Resource ${id}`);
}));
await esc();
await step('trade', () => page.evaluate(async () => {
    const t = await import('/src/ui/screens/tradePanel.ts');
    const n = await import('/src/sim/player/tradeNegotiation.ts');
    const g = window.__dwu.galaxy;
    const other = g.empires.find((e) => e !== g.playerEmpire && e.name !== '' && e.capital);
    const neg = n.beginTradeNegotiation(g, g.playerEmpire, other, 'trade');
    t.openTradePanel({ galaxy: g, negotiation: neg, resolveReply: async () => 'What do you propose?' });
}));
await esc();
await step('councillog', () => page.evaluate(async () => {
    const m = await import('/src/ui/aiAdvisorLog.ts');
    const g = window.__dwu.galaxy;
    const e = g.empires.find((x) => x !== g.playerEmpire && x.name !== '');
    m.pushCouncilLog({
        empire: e, empireName: e.name, starDate: '2410.3', rationale: 'They out-build us two to one; seek a defensive pact before the winter fleets sail.',
        results: [{ status: 'applied', text: 'Propose treaty to Trade Union' }, { status: 'blocked', text: 'Declare war on Kaltor (gate: not at peace long enough)' }],
        rejected: [{ id: 'colonise', targetId: 'x', reason: 'not a legal value' }],
    });
}));
await page.evaluate(async () => (await import('/src/ui/aiAdvisorLog.ts')).closeCouncilLog());
await step('llmoverlay', () => page.evaluate(async () => {
    const m = await import('/src/ui/llmOverlay.ts');
    window.__llmo = m.showLlmOverlay(() => ({ endpoint: 'http://localhost:11434', queued: 2, inFlight: 1, submitted: 40, sent: 31, ok: 29, cacheHits: 6, shared: 3, silent: 1, budgetRefused: 0, timeouts: 1, errors: 0, tokensIn: 12000, tokensOut: 3400, lastLatencyMs: 820, year: 2410, yearRequests: 12, yearTokens: 4100, byPurpose: { strategic: 8, chronicle: 4 } }));
}));
await page.evaluate(() => window.__llmo?.dispose());
await step('improvements', async () => {
    await page.mouse.move(960, 540);
    await page.keyboard.press('o');
    await page.waitForSelector('[data-ow="gameoptions"]');
    await page.locator('[data-ow="gameoptions"] button', { hasText: 'Improvements' }).click();
    await page.waitForSelector('[data-ow="gameoptions-improvements"]');
});
console.log(logs.length ? `LOGS:\n${logs.join('\n')}` : 'no console errors');
await browser.close();
