// UI audit (docs/windows-ui-audit.md): visit the main menu and its sub-screens, every New Game wizard page, the in-game
// HUD with things selected, every toolbar / F-key screen and Game Options with its sub-windows; screenshot each and
// measure from the DOM: clipped / spilling text (scrollWidth > clientWidth, scrollHeight > clientHeight on text
// elements), overlapping sibling text boxes, elements outside their window, light backgrounds behind text, the fonts
// in use (and whether 'Forgotten Futurist' loaded its original file or the bundled fallback) and console errors.
//   node scripts/ui-audit.mjs --cdp=http://127.0.0.1:9341 --tag=win     (a running app: dwu.exe --remote-debugging-port)
//   node scripts/ui-audit.mjs --url=http://localhost:5173/ --tag=linux  (headless Chromium, GPU flags)
// Options: --out=<dir> (default ~/data/agent-tmp/winui), --only=menu,wizard,game, --small=1366x768 (wizard + options
// also at that size).
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';

const opt = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const cdp = opt('cdp', '');
const tag = opt('tag', cdp ? 'win' : 'linux');
const out = opt('out', `${homedir()}/data/agent-tmp/winui`);
const only = opt('only', 'menu,wizard,game').split(',');
const small = opt('small', '1366x768').split('x').map(Number);
mkdirSync(out, { recursive: true });

let browser, ctx, page;
if (cdp) {
    browser = await chromium.connectOverCDP(cdp);
    ctx = browser.contexts()[0];
    page = ctx.pages().find((p) => p.url().startsWith('dwu://app')) ?? ctx.pages()[0];
} else {
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--use-gl=angle', '--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'] });
    ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    page = await ctx.newPage();
}
const base = cdp ? 'dwu://app/index.html' : opt('url', 'http://localhost:5173/').replace(/\/$/, '/');
const cdpSession = await ctx.newCDPSession(page);
async function setSize(w, h) {
    await cdpSession.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    if (!cdp) await page.setViewportSize({ width: w, height: h });
}
let errs = [];
page.on('pageerror', (e) => errs.push(`pageerror ${e.message.slice(0, 200)}`));
page.on('console', (m) => {
    if (m.type() === 'error') errs.push(`console ${m.text().slice(0, 200)}`);
});
page.on('response', (r) => {
    if (r.status() >= 400) errs.push(`http ${r.status()} ${decodeURIComponent(r.url()).slice(0, 200)}`);
});
page.on('requestfailed', (r) => errs.push(`failed ${decodeURIComponent(r.url()).slice(0, 200)}`));
const report = { tag, startedAt: new Date().toISOString(), env: null, screens: [] };

/** In-page DOM measurements of the top window (or the whole page). */
function measureInPage(scopeSel) {
    const vis = (el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return false;
        const cs = getComputedStyle(el);
        return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
    };
    const desc = (el) => {
        let s = el.tagName.toLowerCase();
        if (el.dataset?.ow) s += `[data-ow=${el.dataset.ow}]`;
        else if (el.id) s += `#${el.id}`;
        else if (el.className && typeof el.className === 'string') s += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
        const t = (el.innerText || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 40);
        return t ? `${s} "${t}"` : s;
    };
    const scopes = scopeSel ? [...document.querySelectorAll(scopeSel)].filter(vis) : [];
    const scope = scopes.length ? scopes[scopes.length - 1] : document.body;
    const sr = scope.getBoundingClientRect();
    const hasOwnText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== '') || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(el.tagName);
    const all = [...scope.querySelectorAll('*')].filter((el) => !['CANVAS', 'svg', 'path', 'IMG', 'OPTION', 'STYLE', 'SCRIPT'].includes(el.tagName) && vis(el));
    const textEls = all.filter(hasOwnText);
    const overflow = [];
    const lightBg = [];
    const fonts = {};
    for (const el of textEls) {
        const cs = getComputedStyle(el);
        fonts[cs.fontFamily] = (fonts[cs.fontFamily] ?? 0) + 1;
        const ow = el.scrollWidth - el.clientWidth;
        const oh = el.scrollHeight - el.clientHeight;
        // Scrollable lists are fine; clipped (hidden) or spilling (visible) text is not.
        const sx = cs.overflowX === 'auto' || cs.overflowX === 'scroll';
        const sy = cs.overflowY === 'auto' || cs.overflowY === 'scroll';
        const ellipsis = cs.textOverflow === 'ellipsis';
        if (el.clientWidth > 0 && ((ow > 2 && !sx) || (oh > 3 && !sy && el.tagName !== 'SELECT' && el.tagName !== 'INPUT'))) {
            overflow.push({ el: desc(el), dx: ow, dy: oh, clip: cs.overflowX !== 'visible' || cs.overflowY !== 'visible', ellipsis });
        }
        const m = cs.backgroundColor.match(/rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)/);
        if (m) {
            const a = m[4] === undefined ? 1 : Number(m[4]);
            const lum = (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255;
            if (a > 0.4 && lum > 0.75) lightBg.push({ el: desc(el), bg: cs.backgroundColor, color: cs.color });
        }
    }
    // Text boxes overlapping a sibling text box (same parent).
    const overlap = [];
    const byParent = new Map();
    for (const el of textEls) {
        const p = el.parentElement;
        if (!byParent.has(p)) byParent.set(p, []);
        byParent.get(p).push(el);
    }
    for (const sibs of byParent.values()) {
        if (sibs.length < 2 || sibs.length > 80) continue;
        const rs = sibs.map((e) => e.getBoundingClientRect());
        for (let i = 0; i < sibs.length; i++)
            for (let j = i + 1; j < sibs.length; j++) {
                const a = rs[i], b = rs[j];
                const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
                const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
                if (w > 3 && h > 3) {
                    const ps = getComputedStyle(sibs[i]).position + getComputedStyle(sibs[j]).position;
                    overlap.push({ a: desc(sibs[i]), b: desc(sibs[j]), w: Math.round(w), h: Math.round(h), pos: ps });
                }
            }
    }
    // Outside the window (only when the scope is a window) or outside the viewport.
    const outside = [];
    const bound = scope === document.body ? { left: 0, top: 0, right: innerWidth, bottom: innerHeight } : sr;
    for (const el of textEls) {
        const r = el.getBoundingClientRect();
        const d = Math.max(bound.left - r.left, bound.top - r.top, r.right - bound.right, r.bottom - bound.bottom);
        if (d > 3) outside.push({ el: desc(el), by: Math.round(d) });
    }
    const ff = [...document.fonts].filter((f) => f.family.replace(/["']/g, '') === 'Forgotten Futurist').map((f) => `${f.weight}:${f.status}`);
    return { scope: desc(scope).slice(0, 60), scopeRect: [Math.round(sr.left), Math.round(sr.top), Math.round(sr.width), Math.round(sr.height)], textEls: textEls.length, overflow, overlap, outside, lightBg, fonts, forgottenFuturistFaces: ff };
}

const WINDOW_SEL = '[data-ow], .wizard-window, .original-window, .ow-window, .main-menu-dialog, .game-options, .modal';
async function shoot(name, { scope = WINDOW_SEL } = {}) {
    await page.waitForTimeout(900);
    const vp = page.viewportSize() ?? (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
    const file = `${out}/${tag}-${name}.png`;
    await page.screenshot({ path: file }).catch((e) => console.log(`shot ${name} failed: ${e.message}`));
    const m = await page.evaluate(measureInPage, scope).catch((e) => ({ error: e.message }));
    const entry = { name, file, size: `${vp.width}x${vp.height}`, ...m, errors: errs };
    errs = [];
    report.screens.push(entry);
    console.log(`${name}: ${m.textEls ?? '?'} text els, overflow ${m.overflow?.length ?? '?'}, overlap ${m.overlap?.length ?? '?'}, outside ${m.outside?.length ?? '?'}, lightBg ${m.lightBg?.length ?? '?'}, errors ${entry.errors.length}`);
    writeFileSync(`${out}/${tag}-audit.json`, JSON.stringify(report, null, 1));
}
const goto = async (q) => {
    await page.goto(`${base}${q}`);
    await page.waitForTimeout(1500);
};
const esc = async (n = 1) => {
    for (let i = 0; i < n; i++) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(350);
    }
};
const clickText = async (sel, text) => {
    const l = page.locator(sel, { hasText: text }).first();
    if ((await l.count()) === 0) return false;
    await l.click({ timeout: 5000 }).catch(() => {});
    return true;
};

await setSize(1920, 1080);
await goto('');
report.env = await page.evaluate(() => {
    const c = document.createElement('canvas');
    const g = c.getContext('webgl2') || c.getContext('webgl');
    const d = g?.getExtension('WEBGL_debug_renderer_info');
    return { ua: navigator.userAgent, webgl: g ? (d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'webgl') : 'none', dpr: devicePixelRatio };
});
console.log('env', JSON.stringify(report.env));

if (only.includes('menu')) {
    await page.waitForSelector('.main-menu', { timeout: 120000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await shoot('menu-main', { scope: '.main-menu' });
    const items = await page.$$eval('.main-menu button[data-id], .main-menu .main-menu-corner', (bs) => bs.map((b, i) => (b.dataset.id ? `[data-id="${b.dataset.id}"]` : `.main-menu .main-menu-corner >> nth=${[...document.querySelectorAll('.main-menu .main-menu-corner')].indexOf(b)}`)));
    console.log('menu items:', items.join(' | '));
    for (const sel of items) {
        if (/exit|startNewGame/.test(sel)) continue;
        await goto('');
        await page.waitForSelector('.main-menu', { timeout: 60000 }).catch(() => {});
        await page.waitForTimeout(1500);
        await page.locator(sel).first().click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(2500);
        await shoot(`menu-${sel.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}`);
    }
}

const WIZARD = [
    ['01-playstyle', 'page=type'],
    ['02-jumpstart', 'page=jumpstart&type=ClassicEra'],
    ['03-jumpstart-pirate', 'page=jumpstart&type=ShadowsPirate'],
    ['04-galaxy', 'page=galaxy'],
    ['06-colonization', 'page=colonization'],
    ['07-race', 'page=race'],
    ['08-empire', 'page=empire'],
    ['09-empire-pirate', 'page=empire&type=CustomPirate'],
    ['10-other-empires', 'page=empires'],
    ['11-victory', 'page=victory'],
    ['12-scenario', 'page=scenario'],
    ['13-scenario-addons', 'page=scenario&addons=timebomb,robotmutiny'],
    ['14-start', 'page=start'],
];
if (only.includes('wizard')) {
    for (const [w, h] of [[1920, 1080], small]) {
        await setSize(w, h);
        for (const [name, q] of WIZARD) {
            await goto(`?screen=wizard&${q}`);
            await page.waitForSelector('.wizard-window', { state: 'visible', timeout: 120000 }).catch(() => {});
            await page.waitForFunction(() => !document.querySelector('.wizard-race-loading'), null, { timeout: 30000 }).catch(() => {});
            await page.waitForTimeout(1500);
            await shoot(`wizard-${name}-${w}x${h}`, { scope: '.wizard-window' });
        }
    }
    await setSize(1920, 1080);
}

if (only.includes('game')) {
    await goto('?autostart=1');
    await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 900000 }).catch(() => console.log("game did not start"));
    await page.waitForTimeout(6000);
    await page.evaluate(() => {
        if (window.__dwu?.time) window.__dwu.time.paused = true;
    });
    await shoot('game-hud', { scope: null });
    // Selections (the debug hook __dwu.ui, when the build has it).
    for (const kind of ['colony', 'ship', 'fleet', 'star', 'foreign']) {
        const got = await page.evaluate((k) => window.__dwu?.ui?.auditSelect?.(k) ?? null, kind);
        if (got === null) continue;
        await page.waitForTimeout(1500);
        await shoot(`game-select-${kind}`, { scope: '#selection-panel, .selection-panel' });
    }
    // Every toolbar button (data-hud), one at a time.
    const huds = await page.$$eval('[data-hud]', (bs) => [...new Set(bs.filter((b) => b.getBoundingClientRect().width > 0).map((b) => b.dataset.hud))]);
    console.log('hud buttons:', huds.join(' '));
    const SKIP = /^(btnPlayPause|btnSlower|btnFaster|btnZoom|btnQuit|btnExit|btnSave|btnLoad|btnPause)/i;
    for (const id of huds) {
        if (SKIP.test(id)) continue;
        const before = await page.$$eval('[data-ow]', (e) => e.length);
        await page.locator(`[data-hud="${id}"]`).first().click({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(1800);
        const after = await page.$$eval('[data-ow]', (e) => e.length);
        if (after > before) await shoot(`screen-${id}`);
        await esc(3);
        await page.waitForTimeout(300);
    }
    // Game Options and its sub-windows, at both sizes.
    for (const [w, h] of [[1920, 1080], small]) {
        await setSize(w, h);
        await page.keyboard.press('o');
        await page.waitForSelector('[data-ow="gameoptions"]', { timeout: 8000 }).catch(() => {});
        await shoot(`options-${w}x${h}`, { scope: '[data-ow="gameoptions"]' });
        const subs = await page.$$eval('[data-ow="gameoptions"] button', (bs) => bs.map((b) => b.innerText.trim()).filter((t) => t && !/^(OK|Cancel|Close|Done|×|X)$/i.test(t)));
        for (const s of subs) {
            const before = await page.$$eval('[data-ow]', (e) => e.length);
            await clickText('[data-ow="gameoptions"] button', s);
            await page.waitForTimeout(1200);
            const after = await page.$$eval('[data-ow]', (e) => e.length);
            if (after > before) {
                await shoot(`options-sub-${s.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 28)}-${w}x${h}`);
                await esc(1);
            }
        }
        await esc(2);
    }
    await setSize(1920, 1080);
    // F-keys and the screens without a toolbar button.
    for (const key of ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F12', 'Shift+F1', 'Shift+F2', 'Shift+F3', 'Shift+F4', 'Shift+F5', 'Shift+F6', 'Shift+F7', 'Shift+F8']) {
        const before = await page.$$eval('[data-ow]', (e) => e.length);
        await page.keyboard.press(key);
        await page.waitForTimeout(1800);
        const after = await page.$$eval('[data-ow]', (e) => e.length);
        if (after > before) await shoot(`key-${key.replace('+', '')}`);
        await esc(3);
    }
}
if (only.includes('render')) {
    // The Main View close up (planets and ships), for comparing the renderer paths: --q=renderer=canvas forces Pixi's
    // Canvas fallback (what a PC without WebGL gets).
    const q = opt('q', '');
    await goto(`?autostart=1${q ? `&${q}` : ''}`);
    await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 900000 }).catch(() => console.log("game did not start"));
    await page.waitForTimeout(5000);
    const info = await page.evaluate(() => {
        const d = window.__dwu;
        d.time.paused = true;
        const cap = d.game.playerEmpire.capital;
        d.camera.centerOn(cap.xpos, cap.ypos);
        d.camera.zoomAt(1 / 50, d.camera.width / 2, d.camera.height / 2);
        return { renderer: d.app.renderer.name, type: d.app.renderer.type, capital: cap.name };
    });
    console.log('render', JSON.stringify(info));
    report.render = info;
    await page.waitForTimeout(4000);
    await shoot(`render-system${q ? '-' + q.replace(/[^a-z0-9]+/gi, '-') : ''}`, { scope: null });
    await page.evaluate(() => {
        const d = window.__dwu;
        const cap = d.game.playerEmpire.capital;
        d.camera.centerOn(cap.xpos, cap.ypos);
        d.camera.zoomAt(8, d.camera.width / 2, d.camera.height / 2);
    });
    await page.waitForTimeout(4000);
    await shoot(`render-close${q ? '-' + q.replace(/[^a-z0-9]+/gi, '-') : ''}`, { scope: null });
}
console.log(`report: ${out}/${tag}-audit.json`);
await (cdp ? browser.close() : browser.close());
