#!/usr/bin/env node
// Theme leftovers (test/themeExtras.test.ts) in the running game:
//   - "glow-<theme>": a volcanic planet at system zoom and a close-up (the bitmap_195 glow, MainView.cs method_50),
//     stock and on each theme (its planets/volcanic glow folder);
//   - "landscape-other-<theme>": the Galaxy Map's habitat picture of a planet whose LandscapePictureRef points past the
//     30 fixed landscapes (harness-only edit, the original's habitat editor does it) — a theme's landscapes/other;
//   - "clean-off" / "clean-on": the galaxy view at sector zoom without and with Clean Galaxy view, and the Advanced
//     Display Settings window with its check box;
//   - "leave-<theme>": the main menu after leaving a ?theme= game (Main.Part12.cs 3181: back to the options' theme).
// Prints the theme files the page loaded per folder and the console errors.
//   node scripts/themeextras-shots.mjs <base url> [--out=shots/themeextras] [--themes=RetreatUE Bacon,DW Universe-STPE Ver 2]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const opt = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const out = opt('out', 'shots/themeextras');
const themes = opt('themes', 'RetreatUE Bacon,DW Universe-STPE Ver 2').split(',').filter((t) => t !== '');
const only = opt('only', '');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const logs = [];
const shots = [];
const themed = new Map();
const slug = (t) => (t === '' ? 'stock' : t.replace(/[^A-Za-z0-9]+/g, '_'));
async function newPage() {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.on('console', (m) => {
        if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
    });
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.stack ?? e.message}`));
    page.on('dialog', (d) => void d.accept());
    page.on('response', (r) => {
        if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`);
        else if (r.url().includes('/Customization/')) {
            const p = decodeURIComponent(new URL(r.url()).pathname).split('/');
            const d = p.slice(4, Math.min(p.length - 1, 9)).join('/');
            themed.set(d, (themed.get(d) ?? 0) + 1);
        }
    });
    return page;
}
const shoot = async (page, name, clip) => {
    const path = `${out}/${name}.png`;
    await page.screenshot(clip ? { path, clip } : { path });
    shots.push(path);
};
const gameUrl = (theme) => `${base}?autostart=1&seed=1&simWorker=0${theme === '' ? '' : `&theme=${encodeURIComponent(theme)}`}`;
async function startGame(theme) {
    const page = await newPage();
    await page.goto(gameUrl(theme));
    await page.waitForFunction(() => window.__dwu?.time !== undefined && window.__dwu?.galaxy?.playerEmpire, null, { timeout: 900000 });
    await page.evaluate(() => {
        window.__dwu.time.paused = true;
    });
    await page.waitForTimeout(3000);
    return page;
}

if (only === '' || only === 'glow') {
    for (const theme of ['', ...themes]) {
        try {
            const page = await startGame(theme);
            const info = await page.evaluate(async () => {
                const d = window.__dwu;
                const g = d.galaxy;
                const hud = await import('/src/ui/hud.ts');
                const glow = await import('/src/render/volcanicGlow.ts');
                const vis = g.playerEmpire.visibility;
                const cands = g.habitats.filter((h) => (h.category === 1 || h.category === 2) && glow.volcanicGlowIndex(h) >= 0);
                const h = cands.find((x) => vis.checkSystemExplored(x.systemIndex)) ?? cands[0];
                if (!h) return null;
                // Screenshot harness only: mark the system explored so the planet is drawn.
                if (!vis.checkSystemExplored(h.systemIndex)) vis.systemVisibility[h.systemIndex].status = 2;
                d.camera.centerOn(h.xpos, h.ypos);
                d.camera.zoomAt(hud.SYSTEM_LEVEL_ZOOM * 4, d.camera.width / 2, d.camera.height / 2);
                return { name: h.name, pictureRef: h.pictureRef, glow: glow.volcanicGlowUrls()[glow.volcanicGlowIndex(h)] };
            });
            console.log(`glow ${slug(theme)}: ${JSON.stringify(info)}`);
            await page.waitForTimeout(4000);
            // The glow sprites on stage (texture label "volcanicGlow:<url>") and how many are shown.
            const drawn = await page.evaluate(() => {
                let n = 0;
                let shown = 0;
                const walk = (c) => {
                    if (c.texture?.label?.startsWith?.('volcanicGlow:')) {
                        n++;
                        if (c.visible && c.parent?.visible !== false) shown++;
                    }
                    for (const k of c.children ?? []) walk(k);
                };
                walk(window.__dwu.app.stage);
                return { glowSprites: n, shown };
            });
            console.log(`glow ${slug(theme)} on stage: ${JSON.stringify(drawn)}`);
            await shoot(page, `glow-${slug(theme)}`);
            await shoot(page, `glow-${slug(theme)}-close`, { x: 600, y: 250, width: 400, height: 400 });
            await page.close();
        } catch (e) {
            logs.push(`[script glow ${theme}] ${e.stack ?? e}`);
        }
    }
}

if (only === '' || only === 'landscape') {
    for (const theme of themes) {
        try {
            const page = await startGame(theme);
            const info = await page.evaluate(async () => {
                const d = window.__dwu;
                const g = d.galaxy;
                const land = await import('/src/ui/landscapeImages.ts');
                const h = g.habitats.find((x) => x.category === 1 && x.landscapePictureRef >= 0 && g.playerEmpire.visibility.checkSystemExplored(x.systemIndex));
                if (!h) return null;
                const count = land.landscapeImageCount();
                // Harness only (the original's habitat editor, scrEditHabitatPictureLandscape): the first appended picture.
                if (count > 30) h.landscapePictureRef = 30;
                d.galaxyMap.open(h);
                return { name: h.name, ref: h.landscapePictureRef, count, url: land.landscapeImageUrl(h.landscapePictureRef) };
            });
            console.log(`landscape ${slug(theme)}: ${JSON.stringify(info)}`);
            await page.waitForTimeout(4000);
            await shoot(page, `landscape-other-${slug(theme)}`);
            await page.close();
        } catch (e) {
            logs.push(`[script landscape ${theme}] ${e.stack ?? e}`);
        }
    }
}

if (only === '' || only === 'clean') {
    try {
        const page = await startGame('');
        const zoom = async () =>
            page.evaluate(async () => {
                const d = window.__dwu;
                const hud = await import('/src/ui/hud.ts');
                const cap = d.galaxy.playerEmpire.capital;
                d.camera.centerOn(cap.xpos, cap.ypos);
                d.camera.zoomAt(hud.SECTOR_LEVEL_ZOOM / 2, d.camera.width / 2, d.camera.height / 2);
            });
        const setClean = (v) => page.evaluate(async (v) => (await import('/src/ui/settings.ts')).updateSettings({ cleanGalaxyView: v }), v);
        await setClean(false);
        await zoom();
        await page.waitForTimeout(3000);
        await shoot(page, 'clean-off');
        await setClean(true);
        await page.waitForTimeout(2500);
        await shoot(page, 'clean-on');
        await setClean(false);
        // The check box in the Advanced Display Settings window (Escape menu → Options → Advanced Settings...).
        await page.keyboard.press('Escape');
        await page.waitForTimeout(800);
        await page.locator('button', { hasText: /^Options$/ }).first().click();
        await page.waitForTimeout(1200);
        await page.locator('button', { hasText: 'Advanced Settings...' }).first().click();
        await page.waitForTimeout(1200);
        await shoot(page, 'clean-advanced-settings');
        await page.close();
    } catch (e) {
        logs.push(`[script clean] ${e.stack ?? e}`);
    }
}

if (only === '' || only === 'leave') {
    for (const theme of themes) {
        try {
            const page = await startGame(theme);
            const before = await page.evaluate(async () => (await import('/src/sim/data/customization.ts')).activeCustomizationSetName());
            await page.keyboard.press('Escape');
            await page.waitForTimeout(800);
            await page.locator('button', { hasText: /^Main Menu$/ }).first().click();
            await page.waitForSelector('.main-menu-item', { timeout: 120000 });
            await page.waitForTimeout(2500);
            const after = await page.evaluate(async () => (await import('/src/sim/data/customization.ts')).activeCustomizationSetName());
            console.log(`leave ${slug(theme)}: active "${before}" -> "${after}", label "${await page.textContent('.main-menu-theme')}"`);
            await shoot(page, `leave-${slug(theme)}`);
            await page.close();
        } catch (e) {
            logs.push(`[script leave ${theme}] ${e.stack ?? e}`);
        }
    }
}

console.log('theme files loaded per folder:');
for (const [d, n] of [...themed].sort((a, b) => b[1] - a[1]).filter(([d]) => !d.includes('designTemplates'))) console.log(`  ${n}\t${d}`);
console.log(shots.join('\n'));
console.log(logs.length ? logs.join('\n') : 'no console errors');
await browser.close();
