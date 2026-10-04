// New Game wizard behaviour check (WP1 restyle): drives the wizard through the same flows on two dev servers (e.g. the
// previous build and this one) with Math.random seeded, and compares the StartGameOptions each flow produces.
// Usage: node scripts/wizard-options-compare.mjs <baseUrlA> <baseUrlB>
import { chromium } from 'playwright-core';

const [a = 'http://localhost:5173/', b = 'http://localhost:5174/'] = process.argv.slice(2);
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

/** Each flow: the playstyle button, then optional edits on the Galaxy page (shared class names in both builds). */
const FLOWS = [
    { name: 'custom standard', type: 'CustomStandard' },
    { name: 'custom pirate', type: 'CustomPirate' },
    { name: 'introductory', type: 'Introductory' },
    { name: 'classic era (jump start)', type: 'ClassicEra' },
    { name: 'shadows pirate (jump start)', type: 'ShadowsPirate' },
    {
        name: 'custom standard, custom size + seed',
        type: 'CustomStandard',
        keepSeed: true,
        edit: async (page) => {
            const type = async (sel, v) => {
                const box = page.locator(`${sel}:visible`).first();
                await box.fill(String(v));
                await box.press('Tab');
            };
            await type('.wizard-seed-input', 4242);
            await type('.wizard-sectors-w', 30);
            await type('.wizard-sectors-h', 20);
            await type('.wizard-star-count', 900);
            await type('.wizard-research-base-tech', 250);
        },
    },
    {
        name: 'custom standard, presets',
        type: 'CustomStandard',
        edit: async (page) => {
            await page.selectOption('.wizard-sectors-preset:visible', { label: 'Huge 15×15' });
            await page.selectOption('.wizard-star-preset:visible', { label: 'Huge 1400' });
        },
    },
];

async function run(base, flow) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.addInitScript(() => {
        let s = 12345;
        Math.random = () => {
            s = (s * 1103515245 + 12345) % 2147483648;
            return s / 2147483648;
        };
    });
    await page.goto(base);
    await page.waitForSelector('button[data-id="startNewGame"]', { timeout: 120000 });
    await page.evaluate(async () => {
        const m = await import('/src/ui/screens/newGameWizard.ts');
        window.__wiz = m.createNewGameWizard({
            onBackToMenu: () => {},
            onStartGame: (o) => {
                window.__opts = JSON.parse(JSON.stringify(o));
            },
        });
    });
    await page.waitForSelector('.wizard-type-btn', { timeout: 60000 });
    await page.waitForTimeout(2500);
    await page.click(`.wizard-type-btn[data-type="${flow.type}"]`);
    await page.waitForTimeout(1500);
    if (flow.edit) await flow.edit(page);
    for (let i = 0; i < 14; i++) {
        if (await page.evaluate(() => window.__opts !== undefined)) break;
        await page.waitForFunction(() => !document.querySelector('.wizard-race-loading'), null, { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(400);
        await page.click('.wizard-btn-primary');
        await page.waitForTimeout(300);
    }
    const opts = await page.evaluate(() => window.__opts ?? null);
    await page.close();
    return { opts, errors };
}

let failures = 0;
for (const flow of FLOWS) {
    const ra = await run(a, flow);
    const rb = await run(b, flow);
    // The default seed is time-based (wizardStartGameOptions); it is compared only where a flow types one.
    const norm = (o) => (o === null || flow.keepSeed ? o : { ...o, seed: 0 });
    const ja = JSON.stringify(norm(ra.opts));
    const jb = JSON.stringify(norm(rb.opts));
    const same = ra.opts !== null && ja === jb;
    console.log(`${same ? 'same' : 'DIFF'}  ${flow.name}`);
    if (!same) {
        failures++;
        const ka = norm(ra.opts) ?? {};
        const kb = norm(rb.opts) ?? {};
        for (const k of new Set([...Object.keys(ka), ...Object.keys(kb)])) {
            if (JSON.stringify(ka[k]) !== JSON.stringify(kb[k])) console.log(`    ${k}: ${JSON.stringify(ka[k])}  →  ${JSON.stringify(kb[k])}`);
        }
    }
    for (const e of [...ra.errors.map((x) => `A: ${x}`), ...rb.errors.map((x) => `B: ${x}`)]) console.log(`    [error] ${e}`);
}
await browser.close();
console.log(failures === 0 ? 'ALL SAME' : `${failures} flow(s) differ`);
process.exit(failures === 0 ? 0 : 1);
