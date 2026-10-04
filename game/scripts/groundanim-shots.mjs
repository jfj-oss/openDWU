// Ground Report animation captures (groundReportAnim.ts): opens the Ground Report ("[") on the player's capital,
// stages a ground battle there and saves a series of frames (landing pods, landing hits, explosions, weapon shots).
// In-thread the battle is real: an AI empire's troops are put in the capital's InvadingTroops (some damaged, as a
// landing hit leaves them) and the tick resolves it. With ?simWorker=1 the authoritative galaxy is in the worker, so
// the staging is done on the replica only (invaders added, defenders' readiness cut) — the animation reads the replica
// as it would a real battle's deltas (a replica write detector, when on, warns about this staging; that is expected).
// Usage: node scripts/groundanim-shots.mjs <baseUrl> <outDir> [w] [h] [query]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/groundanim', w = '1920', h = '1080', extra = ''] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => {
    // (The readback warning is this script's own canvas probe.)
    if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('willReadFrequently')) logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${base}?autostart=1${extra ? `&${extra}` : ''}`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 240000 });
await page.waitForTimeout(4000);
const tag = extra ? `-${extra.replace(/[^a-z0-9]+/gi, '')}` : '';
const fxPixels = () =>
    page.evaluate(() => {
        const c = document.querySelector('[data-ow="groundReport"] .gr-fx');
        if (!c || c.width === 0) return 0;
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
        return n;
    });
const shot = async (name) => {
    await page.screenshot({ path: `${outDir}/${name}${tag}.png` });
    console.log(`${outDir}/${name}${tag}.png  (animation layer: ${await fxPixels()} px)`);
};
const key = async (k) => {
    await page.mouse.move(+w / 2, +h / 2);
    await page.keyboard.press(k);
};

// Unpause (a new game starts paused; the animation runs on game time and stands still while paused).
await page.evaluate(() => {
    window.__dwu.time.paused = false;
});
// The capital, selected; the Ground Report on it.
await key('c');
await key('BracketLeft');
await page.waitForSelector('[data-ow="groundReport"]', { timeout: 10000 }).catch(() => logs.push('[script] no ground report window'));
await page.waitForTimeout(1500);
await shot('00-before');

const staged = await page.evaluate(() => {
    const d = window.__dwu;
    const g = d.galaxy;
    const cap = d.game.playerEmpire.capital;
    if (!cap || !cap.troops || cap.troops.count === 0) return 'no capital troops';
    const T = cap.troops.items[0].constructor;
    const enemy = g.empires.find((e) => e && e.active && e !== g.playerEmpire && e !== g.independentEmpire && e.dominantRace && e.troops);
    if (!enemy) return 'no enemy';
    if (!cap.invadingTroops) cap.invadingTroops = new cap.troops.constructor();
    // Infantry 1, Armored 2, Artillery 3 (TroopType); every other one arrives damaged (a landing hit).
    const types = [1, 1, 2, 1, 3, 1, 2, 1];
    types.forEach((type, i) => {
        const t = new T(`Staged ${i}`, type, 300, 200, 100, i % 2 === 0 ? 100 : 70, enemy, enemy.dominantRace);
        t.colony = cap;
        cap.invadingTroops.add(t);
        enemy.troops.add(t);
    });
    if (d.simWorker) {
        // Replica staging only: cut the defenders' readiness so the view sees hits.
        cap.troops.items.forEach((t, i) => {
            if (i % 2 === 0) t.readiness = Math.max(1, t.readiness - 30);
        });
    }
    return `ok: ${cap.name} vs ${enemy.name}`;
});
logs.push(`[script] staging: ${staged}`);
// The animation runs on game time, so each capture pauses the game (freezing it), shoots, and resumes.
const setPaused = (paused) => page.evaluate((p) => (window.__dwu.time.paused = p), paused);
const nowMs = () => page.evaluate(() => window.__dwu.galaxy.nowMs);
const frozenShot = async (name) => {
    await setPaused(true);
    await page.waitForTimeout(200);
    await shot(name);
    await setPaused(false);
};
// The pods take 4 game seconds to come down (UpdateInvaderLandingProgress: 0.25 a second).
const t0 = await nowMs();
for (const ms of [300, 1200, 2200, 3300]) {
    await page.waitForFunction((t) => window.__dwu.galaxy.nowMs >= t, t0 + ms, { timeout: 60000 }).catch(() => logs.push(`[script] game time stuck before +${ms} ms`));
    await frozenShot(`01-landing-${ms}ms`);
}
// The battle: the tick resolves it every 10 game seconds and its hits play out over the next 10. Catch frames with
// an explosion on (the animation layer covers more than a pod's readiness bar).
let caught = 0;
const deadline = Date.now() + 150000;
let lastPx = 0;
while (caught < 8 && Date.now() < deadline) {
    const px = await fxPixels();
    if (px > 400 && px !== lastPx) {
        await frozenShot(`02-battle-${String(caught).padStart(2, '0')}`);
        caught++;
        await page.waitForTimeout(400);
    } else await page.waitForTimeout(40);
    lastPx = px;
}
if (caught === 0) logs.push('[script] no explosion caught');
console.log(logs.length ? logs.join('\n') : 'no console errors');
await browser.close();
