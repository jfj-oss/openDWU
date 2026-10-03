// Research queue drag-to-reorder: queues projects, drags the last row to the top, saves before/after shots.
// Usage: node scripts/researchdrag-shots.mjs <baseUrl> <outDir>
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/researchdrag'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(`${base}?autostart=1`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 240000 });
await page.waitForTimeout(3000);
await page.click('[data-hud="tbtnResearch"]');
await page.waitForTimeout(1500);
// Queue a few available projects through the same op the tree click issues.
const n = await page.evaluate(async () => {
    const { game } = window.__dwu;
    const p = game.playerEmpire;
    const q = p.research.researchQueueFor(1);
    const avail = p.research.techTree.filter((t) => t.def.industry === 0 && !t.isResearched && !q.includes(t) && p.research.canResearchNode(t));
    for (const t of avail.slice(0, 4)) {
        if (p.research.canResearchNode(t)) q.push(t);
    }
    return q.map((t) => t.def.name);
});
console.log('queue before:', n.join(' | '));
// Re-open to rebuild the panel.
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
await page.click('[data-hud="tbtnResearch"]');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/before.png` });
const rows = page.locator('.rs-queue-row');
const count = await rows.count();
const last = await rows.nth(count - 1).boundingBox();
const first = await rows.nth(0).boundingBox();
await page.mouse.move(last.x + 40, last.y + last.height / 2);
await page.mouse.down();
for (let i = 1; i <= 10; i++) await page.mouse.move(last.x + 40, last.y + last.height / 2 + ((first.y + 4) - (last.y + last.height / 2)) * (i / 10));
await page.waitForTimeout(200);
await page.screenshot({ path: `${outDir}/dragging.png` });
await page.mouse.up();
await page.waitForTimeout(800);
await page.screenshot({ path: `${outDir}/after.png` });
const after = await page.evaluate(() => window.__dwu.game.playerEmpire.research.researchQueueFor(1).map((t) => t.def.name));
console.log('queue after:', after.join(' | '));
await browser.close();
