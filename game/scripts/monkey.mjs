// Usage: node scripts/monkey.mjs [gameDir] [--seed=N] [--steps=60] [--warm=120] [--out=DIR] [--only=a,b] [--addons=a,b,c] [--list]
// "Click everything" UI bug hunter. Starts its own Vite dev server for <gameDir> (default: this game/ folder), boots a
// dev game (?autostart=1) with a broad add-on set on headless Chromium on the GPU (ANGLE/Vulkan; aborts on SwiftShader),
// runs it --warm seconds at 4x, pauses, then opens every screen reachable from the HUD / hotkeys and clicks the DOM's
// clickable elements in a seeded random order (single clicks, rapid bursts over list rows, back/forth tab switching).
// No image review: after every action it measures the page (console errors, vanished lists, covered buttons,
// off-screen / overflowing text, "undefined"/"NaN" text, windows that do not close, a sim that stops) and writes
//   <out>/report-<seed>.json  and  <out>/report-<seed>.md   (default out: ~/data/agent-tmp/monkey)
// plus a PNG per distinct violation. Destructive / global actions (Quit, Load, Save, Delete, Scrap, Disband, Declare
// war, Retire, ...) are never clicked (DENY below); the skipped labels are listed in the report.
// --list prints the discovered screens and exits. Same seed + same game dir = same click sequence.
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => {
    const a = args.find((x) => x.startsWith(`--${k}=`));
    return a === undefined ? d : a.slice(k.length + 3);
};
const gameDir = resolve(args.find((a) => !a.startsWith('--')) ?? join(here, '..'));
const seed = Number(opt('seed', '1'));
const STEPS = Number(opt('steps', '60'));
const WARM_S = Number(opt('warm', '120'));
const OUT = opt('out', join(homedir(), 'data/agent-tmp/monkey'));
const ONLY = opt('only', '') === '' ? null : opt('only', '').split(',');
const LIST_ONLY = args.includes('--list');
// The broad add-on set (ids of scenarios/); unknown ids are ignored by the loader.
const ADDONS = opt(
    'addons',
    'characters-victory,giantworks,generation-ships,archive-cores,galactic-council,probe-swarm,purifier,hive,cult,reputation,internal-security,threat-framework,emergent,voidbloom,chartered-companies,colony-economy,exchange,privateers,espionage-consequences,event-log,smarter-ai,themed-names,refugees-demographics,court-dynasties,new-fauna',
);
mkdirSync(OUT, { recursive: true });
const shotDir = join(OUT, `shots-${seed}`);
mkdirSync(shotDir, { recursive: true });

/** Labels / data ids that are never clicked: leaving the game, saves/loads, irreversible empire actions. */
const DENY = /\b(quit|exit|main menu|new game|load|save|overwrite|delete|scrap|disband|declare war|retire|resign|abdicate|restart|end game|abandon|self.?destruct|surrender|purge|erase|reset to default|disconnect|kick|exit to|close game|play again|continue to)\b|^(x|×|✕)$/i;
const DENY_ID = /(quit|exit|mainmenu|newgame|load|save|delete|scrap|disband|declarewar|retire|resign)/i;

function mulberry32(a) {
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const hashStr = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);

function freePort() {
    return new Promise((res, rej) => {
        const srv = createServer();
        srv.on('error', rej);
        srv.listen(0, '127.0.0.1', () => {
            const { port } = srv.address();
            srv.close(() => res(port));
        });
    });
}
async function waitForServer(url, ms) {
    const t0 = Date.now();
    for (;;) {
        try {
            if ((await fetch(url)).status < 500) return;
        } catch {
            // not up yet
        }
        if (Date.now() - t0 > ms) throw new Error(`dev server did not respond at ${url}`);
        await new Promise((r) => setTimeout(r, 200));
    }
}

/** Page-side helpers (installed once as window.__mk; self-contained: it runs inside the page). */
function installHelpers([denySrc, denyIdSrc]) {
    const DENY = new RegExp(denySrc, 'i');
    const DENY_ID = new RegExp(denyIdSrc, 'i');
    const DYN = /(^|[-_])(sel|selected|alt|on|active|hover|hot|odd|even|first|last|open|focus|pressed|down|current)$|^is-|^ow-(sel|alt)$/;
    const mk = { els: [], lists: new Map(), baseline: new Set(), navs: [] };
    window.__mk = mk;
    // A link that would navigate the page (and kill the hunt's context) is cancelled and reported as a violation.
    document.addEventListener('click', (e) => {
        const a = e.target?.closest?.('a[href]');
        if (a && !a.getAttribute('href').startsWith('#')) {
            mk.navs.push(a.getAttribute('href').slice(0, 120));
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);
    const vis = (el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return false;
        for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
            const cs = getComputedStyle(e);
            if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
        }
        return true;
    };
    const cls = (el) => [...el.classList].filter((c) => !DYN.test(c));
    const seg = (el) => {
        let s = el.tagName.toLowerCase();
        if (el.id) s += `#${el.id}`;
        const c = cls(el).slice(0, 2);
        if (c.length) s += `.${c.join('.')}`;
        for (const a of ['data-id', 'data-hud', 'data-ow', 'data-tab', 'data-action', 'data-key']) if (el.hasAttribute(a)) s += `[${a}=${String(el.getAttribute(a)).slice(0, 24)}]`;
        return s;
    };
    const sel = (el, scope) => {
        const parts = [];
        for (let e = el, n = 0; e && n < 3; e = e.parentElement, n++) {
            parts.unshift(seg(e));
            if (e === scope) break;
        }
        return parts.join(' > ');
    };
    const label = (el) => {
        const t = (el.getAttribute('aria-label') || el.innerText || el.value || el.title || el.alt || '').replace(/\s+/g, ' ').trim();
        return t.slice(0, 60);
    };
    const z = (el) => {
        let best = 0;
        for (let e = el; e; e = e.parentElement) {
            const v = parseInt(getComputedStyle(e).zIndex, 10);
            if (!Number.isNaN(v)) best = Math.max(best, v);
        }
        return best;
    };
    /** Direct children of body (and of #hud) at the clean state: not windows. */
    mk.markBaseline = () => {
        mk.baseline = new Set([...document.body.children, ...(document.getElementById('hud')?.children ?? [])]);
    };
    /** Windows currently open: [data-ow] frames plus new body-level layers. Topmost last. */
    mk.windows = () => {
        const out = new Set();
        for (const e of document.querySelectorAll('[data-ow]')) if (vis(e)) out.add(e);
        for (const e of [...document.body.children, ...(document.getElementById('hud')?.children ?? [])]) {
            if (mk.baseline.has(e) || e.tagName === 'SCRIPT' || e.tagName === 'STYLE' || e.tagName === 'CANVAS') continue;
            if (e.closest('[data-ow]')) continue;
            const r = e.getBoundingClientRect();
            if (vis(e) && r.width * r.height > 4000) out.add(e);
        }
        return [...out].sort((a, b) => z(a) - z(b) || (a.compareDocumentPosition(b) & 4 ? -1 : 1));
    };
    mk.scopeId = (el) => (el ? el.getAttribute('data-ow') || el.id || seg(el) : null);
    mk.scope = null;
    mk.setScope = (index) => {
        const w = mk.windows();
        mk.scope = w.length ? (index === undefined ? w[w.length - 1] : w[index]) : null;
        return w.map(mk.scopeId);
    };
    const CLICKABLE = 'button, [role=button], [role=tab], [role=option], [role=menuitem], a[href], input[type=checkbox], input[type=radio], label, summary, .ow-tab, .ow-grid-row, tr[data-id], li, [data-id], [onclick]';
    /** Clickable, visible elements of the scope with a click point; skipped (denied) ones are returned separately. */
    mk.clickables = () => {
        const scope = mk.scope;
        if (!scope || !scope.isConnected) return { items: [], denied: [] };
        const vw = innerWidth;
        const vh = innerHeight;
        const items = [];
        const denied = [];
        mk.els = [];
        const seen = new Set();
        const cands = [...scope.querySelectorAll('*')].filter((e) => {
            if (e.tagName === 'CANVAS') return false; // map / render surfaces are not buttons
            if (e.matches(CLICKABLE)) return true;
            if (e.closest('select')) return false;
            const cs = getComputedStyle(e);
            return cs.cursor === 'pointer' && (!e.parentElement || getComputedStyle(e.parentElement).cursor !== 'pointer');
        });
        for (const e of cands) {
            if (seen.has(e) || e.tagName === 'SELECT' || e.tagName === 'OPTION' || (e.tagName === 'INPUT' && !/checkbox|radio/.test(e.type))) continue;
            seen.add(e);
            if (e.disabled || e.getAttribute('aria-disabled') === 'true' || /(^|[\s-])(disabled|locked)\b/.test(e.className?.toString?.() ?? '')) continue;
            if (!vis(e) || getComputedStyle(e).pointerEvents === 'none') continue;
            const r = e.getBoundingClientRect();
            const cx = Math.round(r.left + r.width / 2);
            const cy = Math.round(r.top + r.height / 2);
            if (cx < 0 || cy < 0 || cx >= vw || cy >= vh) continue;
            const lab = label(e);
            const ids = `${e.id} ${e.getAttribute('data-id') ?? ''} ${e.getAttribute('data-action') ?? ''} ${e.getAttribute('data-hud') ?? ''}`;
            if (DENY.test(lab) || DENY_ID.test(ids) || e.matches('.ow-close, [data-ow] > .ow-titlebar *')) {
                if (!e.matches('.ow-close')) denied.push(lab || sel(e, scope));
                continue;
            }
            const idx = mk.els.push(e) - 1;
            const rowish = /row|item|entry|cell|li/i.test(e.className?.toString?.() ?? '') || e.tagName === 'LI' || e.tagName === 'TR';
            items.push({ idx, x: cx, y: cy, label: lab, sel: sel(e, scope), tab: /tab/i.test(`${e.getAttribute('role')} ${e.className}`), rowish, tag: e.tagName.toLowerCase(), rowKey: e.parentElement ? `${seg(e.parentElement)}|${seg(e)}` : '' });
        }
        return { items, denied: [...new Set(denied)] };
    };
    /** Fresh centre of a previously listed element (layout may have moved it). */
    mk.point = (idx) => {
        const e = mk.els[idx];
        if (!e || !e.isConnected || !vis(e)) return null;
        const r = e.getBoundingClientRect();
        const x = Math.round(r.left + r.width / 2);
        const y = Math.round(r.top + r.height / 2);
        const top = document.elementFromPoint(x, y);
        let covered = null;
        const scrolls = (x) => x && /(auto|scroll)/.test(getComputedStyle(x).overflowY);
        const inScroll = (() => {
            for (let p = e.parentElement; p; p = p.parentElement) if (scrolls(p)) return true;
            return false;
        })();
        // Not a finding: an open native select popup, a scroll container's own scrollbar, a sticky header over scrolled-under rows.
        const benign = top && (top.tagName === 'SELECT' || scrolls(top) || (inScroll && /ow-header|ow-grid-head/.test(top.className?.toString?.() ?? '')));
        if (top !== e && !e.contains(top) && !(top && top.contains(e)) && !benign) covered = top ? `${seg(top)} ${label(top).slice(0, 30)}` : 'nothing';
        return { x, y, covered, label: label(e), sel: sel(e, mk.scope) };
    };
    const rowStats = (el) => {
        const counts = new Map();
        for (const k of el.children) {
            const key = `${k.tagName}.${cls(k).join('.')}`;
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        let best = ['', 0];
        for (const [k, n] of counts) if (n > best[1]) best = [k, n];
        return best;
    };
    const countKey = (el, key) => [...el.children].filter((k) => `${k.tagName}.${cls(k).join('.')}` === key).length;
    const ownSel = (el) => el.tagName.toLowerCase() + cls(el).slice(0, 2).map((c) => `.${CSS.escape(c)}`).join('');
    /** The selected tabs of a window (not rows: a selected row must not hide a vanished list). A change of them means the screen moved on, not that a list vanished. */
    const tabSig = (scope) => [...scope.querySelectorAll('[role=tab][aria-selected=true], .ow-tab.ow-sel, .ow-tab.active')].map((e) => `${e.tagName}:${label(e)}`).join('|');
    const BAD = /\bundefined\b|\bNaN\b|\bnull\b|\[object|\{\d+\}|\bTODO\b|\bInfinity\b/;
    /** All page-measured invariants for the open scope; returns [{kind, sel, detail, html}]. */
    mk.check = () => {
        const out = [];
        const scope = mk.scope;
        const add = (kind, el, detail) => out.push({ kind, sel: el ? sel(el, scope) : '', detail, html: el ? el.outerHTML.slice(0, 360) : '' });
        if (!scope || !scope.isConnected || !vis(scope)) {
            mk.lists = new Map();
            return out;
        }
        // 1. lists that vanish
        // A tab / page switch legitimately swaps the list, so a list is only compared while the window's selected tabs are the same.
        const sig = tabSig(scope);
        const now = new Map();
        for (const el of scope.querySelectorAll('*')) {
            if (el.children.length < 2) continue;
            const [key, n] = rowStats(el);
            if (n >= 3 && vis(el)) now.set(el, { key, n, own: ownSel(el), sel: sel(el, scope), sig });
        }
        for (const [el, prev] of mk.lists) {
            if (prev.n < 2 || prev.sig !== sig) continue;
            if (el.isConnected && scope.contains(el)) {
                if (vis(el) && countKey(el, prev.key) === 0) add('list-vanished', el, `${prev.n} rows -> 0 (${prev.key})`);
            } else {
                let cands = [];
                try {
                    cands = [...scope.querySelectorAll(prev.own)].filter(vis);
                } catch {
                    // odd class names
                }
                if (cands.length && !cands.some((c) => countKey(c, prev.key) > 0) && !now.has(cands[0])) add('list-vanished', cands[0], `${prev.n} rows -> list rebuilt empty (${prev.key})`);
            }
        }
        mk.lists = now;
        // 2. selected row vs detail label ("Speak with X" must name the selected row)
        const selRow = scope.querySelector('.ow-sel, [aria-selected=true]');
        if (selRow) {
            const rowText = (selRow.innerText || '').toLowerCase();
            for (const b of scope.querySelectorAll('button, a')) {
                const m = /^(?:speak|talk|negotiate|meet|trade|send .*?) (?:with|to) (.+)$/i.exec((b.innerText || '').trim());
                if (m && vis(b) && !rowText.includes(m[1].trim().toLowerCase())) add('selection-mismatch', b, `button "${(b.innerText || '').trim()}" vs selected row "${rowText.replace(/\s+/g, ' ').slice(0, 60)}"`);
            }
        }
        // 3. window / clickables off-screen
        const sr = scope.getBoundingClientRect();
        if (sr.left < -2 || sr.top < -2 || sr.right > innerWidth + 2 || sr.bottom > innerHeight + 2) add('window-offscreen', scope, `rect ${Math.round(sr.left)},${Math.round(sr.top)} ${Math.round(sr.right)},${Math.round(sr.bottom)} in ${innerWidth}x${innerHeight}`);
        const clipped = (e) => {
            for (let p = e.parentElement; p && p !== scope.parentElement; p = p.parentElement) {
                const cs = getComputedStyle(p);
                if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') return true;
            }
            return false;
        };
        const vwv = innerWidth;
        const vhv = innerHeight;
        // 4. text: bad tokens + overflow
        const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
        const seenText = new Set();
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const t = n.nodeValue;
            if (!t || !t.trim()) continue;
            const p = n.parentElement;
            if (!p || p.closest('script, style, option') || !vis(p)) continue;
            const m = BAD.exec(t);
            if (m && !seenText.has(p)) {
                seenText.add(p);
                add('bad-text', p, `"${m[0]}" in "${t.replace(/\s+/g, ' ').trim().slice(0, 70)}"`);
            }
            if (seenText.has(p)) continue;
            seenText.add(p);
            const cs = getComputedStyle(p);
            if (cs.display === 'inline' || p.matches('input, textarea, select')) continue;
            if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') continue;
            const over = p.scrollWidth - p.clientWidth;
            if (over > 2 && p.clientWidth > 0) {
                if ((cs.overflowX === 'hidden' || cs.overflowX === 'clip') && cs.textOverflow !== 'ellipsis') add('text-clipped', p, `${over}px cut off: "${(p.innerText || '').replace(/\s+/g, ' ').slice(0, 50)}"`);
                else if (cs.overflowX === 'visible' && cs.whiteSpace.startsWith('no') && over > 6) add('text-spill', p, `${over}px past the box: "${(p.innerText || '').replace(/\s+/g, ' ').slice(0, 50)}"`);
            }
            if ((cs.overflowY === 'hidden' || cs.overflowY === 'clip') && p.scrollHeight - p.clientHeight > 3 && p.clientHeight > 0 && cs.textOverflow !== 'ellipsis' && !/-webkit-box/.test(cs.display)) add('text-clipped-y', p, `${p.scrollHeight - p.clientHeight}px cut off: "${(p.innerText || '').replace(/\s+/g, ' ').slice(0, 50)}"`);
        }
        for (const e of scope.querySelectorAll(CLICKABLE)) {
            if (!vis(e) || clipped(e)) continue;
            const r = e.getBoundingClientRect();
            if (r.left < -2 || r.top < -2 || r.right > vwv + 2 || r.bottom > vhv + 2) add('element-offscreen', e, `rect ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.right)},${Math.round(r.bottom)} "${label(e).slice(0, 30)}"`);
        }
        return out;
    };
    mk.excerpt = () => (mk.scope ? mk.scope.innerText.replace(/\s+/g, ' ').slice(0, 300) : '');
    mk.state = () => ({ paused: window.__dwu?.time?.paused, nowMs: window.__dwu?.game?.galaxy?.nowMs, date: document.querySelector('.hud-date')?.textContent ?? '' });
}

const violations = new Map(); // key -> record
const skippedLabels = new Map(); // label -> count
const screenLog = [];
let shotCount = 0;
let page;
const consoleBuf = [];

async function noteViolation(v, ctx) {
    const key = `${v.kind}|${ctx.screen}|${v.sel}|${v.kind === 'console-error' || v.kind === 'bad-text' ? v.detail.replace(/\d+/g, '#').slice(0, 80) : ''}`;
    const have = violations.get(key);
    if (have) {
        have.count += 1;
        return;
    }
    let shot = null;
    if (shotCount < 60) {
        shotCount += 1;
        shot = join(shotDir, `v${String(shotCount).padStart(2, '0')}-${v.kind}.png`);
        await page.screenshot({ path: shot }).catch(() => {
            shot = null;
        });
    }
    violations.set(key, { kind: v.kind, screen: ctx.screen, sel: v.sel, detail: v.detail, count: 1, step: ctx.step, action: ctx.action, repro: ctx.repro.slice(-40), html: v.html ?? '', excerpt: ctx.excerpt ?? '', screenshot: shot });
    console.log(`  VIOLATION ${v.kind} [${ctx.screen}] step ${ctx.step}: ${v.sel} ${v.detail.slice(0, 100)}`);
}

let startUrl = '';
/** Page state for the Escape checks: url, the game object, and whether the game menu is showing. */
async function pageState() {
    return page.evaluate(() => ({ url: location.href, game: !!window.__dwu?.game, menu: !!document.getElementById('game-menu-overlay')?.offsetParent }));
}
let navigated = false;
class NavigatedError extends Error {}

/** Loads the game, checks the renderer, installs the helpers and clears the intro. Also used to reboot after a navigation. */
async function bootPage() {
    await page.goto(startUrl);
    await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 600000 });
    const renderer = await page.evaluate(() => {
        const gl = document.createElement('canvas').getContext('webgl');
        const e = gl.getExtension('WEBGL_debug_renderer_info');
        return gl.getParameter(e.UNMASKED_RENDERER_WEBGL);
    });
    console.log(`renderer: ${renderer}`);
    if (/swiftshader|llvmpipe|software/i.test(renderer)) throw new Error(`refusing to run on a software renderer: ${renderer}`);
    const info = await page.evaluate(() => ({ empires: window.__dwu.game.galaxy.empires.length }));
    console.log(`game started: ${info.empires} empires, seed ${seed}`);
    consoleBuf.length = 0; // boot-time errors are the smoke test's business; the hunt starts here
    await page.evaluate(installHelpers, [DENY.source, DENY_ID.source]);
    const intro = page.locator('button.intro-start');
    if (await intro.isVisible({ timeout: 3000 }).catch(() => false)) await intro.click();
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__mk.markBaseline());
    navigated = false; // the boot's own navigation is not a finding
}

/** A click that reloaded or navigated the page is a finding: record it, reboot the game (no warm-up) and abandon this screen. */
async function guardNav(ctx) {
    if (!navigated) return;
    await noteViolation({ kind: 'page-navigated', sel: 'page', detail: 'the page reloaded or navigated away during an action; the hunt rebooted the game (no warm-up) and skipped the rest of this screen' }, ctx);
    await bootPage();
    throw new NavigatedError('rebooted after a navigation');
}

async function main() {
    // npm's predev hook (smoke.mjs does the same): the asset manifest must exist before the dev server serves the game.
    execFileSync('node', ['scripts/gen-asset-manifest.mjs'], { cwd: gameDir, stdio: 'inherit' });
    const port = await freePort();
    const base = `http://localhost:${port}`;
    const vite = spawn(join(gameDir, 'node_modules/.bin/vite'), ['--port', String(port), '--strictPort'], { cwd: gameDir, stdio: ['ignore', 'pipe', 'pipe'] });
    let viteOut = '';
    vite.stdout.on('data', (d) => (viteOut += d));
    vite.stderr.on('data', (d) => (viteOut += d));
    let browser = null;
    const t0 = Date.now();
    try {
        await waitForServer(`${base}/`, 60000).catch((e) => {
            console.error(viteOut);
            throw e;
        });
        browser = await chromium.launch({
            executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
            args: ['--use-gl=angle', '--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'],
        });
        page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
        page.on('framenavigated', (f) => {
            if (f === page.mainFrame()) navigated = true;
        });
        page.on('dialog', (d) => {
            consoleBuf.push({ kind: 'dialog', text: `${d.type()}: ${d.message().slice(0, 100)}` });
            d.dismiss().catch(() => {});
        });
        page.on('console', (m) => {
            if (m.type() === 'error') consoleBuf.push({ kind: 'console-error', text: m.text().slice(0, 300) });
        });
        page.on('pageerror', (e) => consoleBuf.push({ kind: 'console-error', text: `pageerror: ${e.message.slice(0, 300)}` }));
        startUrl = `${base}/?autostart=1&seed=${seed}&scenario=${ADDONS}`;
        await bootPage();

        // 1. warm up: 4x for WARM_S seconds, then pause.
        if (!LIST_ONLY) {
            if (await page.evaluate(() => window.__dwu.time.paused)) await page.click('button[data-hud-ctl="playPause"]');
            for (let i = 0; i < 4; i++) {
                if ((await page.textContent('.hud-date')).includes('(4x)')) break;
                await page.click('button[data-hud-ctl="faster"]');
            }
            console.log(`warming up ${WARM_S}s at 4x ...`);
            await page.waitForTimeout(WARM_S * 1000);
            await page.evaluate(() => {
                window.__dwu.time.paused = true;
            });
            console.log(`warm-up done: ${await page.evaluate(() => window.__mk.state().date)}`);
        }
        consoleBuf.length = 0;

        const screens = await discoverScreens();
        console.log(`screens: ${screens.map((s) => s.name).join(', ')}`);
        if (LIST_ONLY) return;
        const tested = new Set();
        for (const s of screens) {
            if (ONLY && !ONLY.includes(s.name)) continue;
            await runScreen(s, tested);
        }
        writeReports(Date.now() - t0);
    } finally {
        if (browser) await browser.close().catch(() => {});
        vite.kill('SIGTERM');
    }
}

/** HUD buttons (data-hud) + hotkeys + the "..." popup entries. Each: { name, open: async () => void }. */
async function discoverScreens() {
    const huds = await page.$$eval('[data-hud]', (bs) => bs.filter((b) => b.getBoundingClientRect().width > 0 && /^(btn|tbtn)/.test(b.dataset.hud)).map((b) => b.dataset.hud));
    const SKIP_HUD = /^(btnTopMore|btnGameEditor|btnZoom|btnPlay|btnSlower|btnFaster|btnQuit|btnExit)/i;
    const list = [];
    for (const k of ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'g', 'h', 'v', 'o', '[', 'Shift+F1', 'Shift+F2', 'Shift+F3', 'Shift+F4', 'Shift+F5', 'Shift+F6', 'Shift+F7', 'Shift+F8']) list.push({ name: `key-${k}`, open: () => page.keyboard.press(k) });
    for (const h of huds) if (!SKIP_HUD.test(h)) list.push({ name: h, open: () => page.locator(`[data-hud="${h}"]`).first().click({ timeout: 4000 }) });
    // The "•••" menu (.top-more-menu, rows .top-more-item): every row is another screen.
    await page.locator('[data-hud="btnTopMore"]').first().click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(300);
    const more = await page.$$eval('.top-more-item', (rs) => rs.filter((r) => r.getBoundingClientRect().width > 0).map((r) => r.innerText.trim().replace(/\s+/g, ' ')));
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 5).catch(() => {});
    for (const label of [...new Set(more)]) {
        if (DENY.test(label)) continue;
        list.push({
            name: `more-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
            open: async () => {
                await page.locator('[data-hud="btnTopMore"]').first().click({ timeout: 4000 });
                await page.waitForTimeout(250);
                await page.locator('.top-more-item', { hasText: label }).first().click({ timeout: 3000 });
            },
        });
    }
    // The barebones Game Editor (a mode switch, not a window of the game): last, so it cannot hide the other screens.
    list.push({ name: 'btnGameEditor', open: () => page.locator('[data-hud="btnGameEditor"]').first().click({ timeout: 4000 }) });
    await closeAll('discover');
    return list;
}

/** Close every open window with Escape; returns the ids that refused. */
async function closeAll(why) {
    for (let i = 0; i < 6; i++) {
        const w = await page.evaluate(() => window.__mk.setScope());
        if (w.length === 0) break;
        await page.keyboard.press('Escape');
        await page.waitForTimeout(250);
    }
    const left = await page.evaluate(() => window.__mk.setScope());
    if (left.length) {
        for (const c of await page.$$('.ow-close')) await c.click({ timeout: 1000 }).catch(() => {});
        await page.waitForTimeout(250);
    }
    const go = await page.locator('#game-menu-overlay').isVisible().catch(() => false);
    if (go) await page.keyboard.press('Escape');
    return await page.evaluate(() => window.__mk.setScope());
}

async function drain(ctx) {
    const items = consoleBuf.splice(0);
    for (const it of items) {
        if (it.kind === 'dialog') {
            skippedLabels.set(`[dialog dismissed] ${it.text}`, (skippedLabels.get(`[dialog dismissed] ${it.text}`) ?? 0) + 1);
            continue;
        }
        await noteViolation({ kind: 'console-error', sel: it.text.slice(0, 80), detail: it.text }, ctx);
    }
}

async function runScreen(s, tested) {
    const rnd = mulberry32(seed * 7919 + hashStr(s.name));
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const ctx = { screen: s.name, step: 0, action: 'open', repro: [`open via ${s.name}`], excerpt: '' };
    const t1 = Date.now();
    console.log(`== ${s.name}`);
    try {
        await runScreenBody(s, tested, ctx, rnd, t1);
    } catch (e) {
        if (e instanceof NavigatedError) {
            screenLog.push({ name: s.name, opened: true, steps: -1, ms: Date.now() - t1, error: 'navigated' });
            console.log('   skipped the rest of this screen (page navigated, game rebooted)');
            return;
        }
        if (navigated) {
            await noteViolation({ kind: 'page-navigated', sel: 'page', detail: 'the page navigated away while this screen was being measured' }, ctx);
            await bootPage().catch((be) => console.log(`   reboot failed: ${be.message}`));
        }
        const msg = String(e.message).split('\n')[0];
        await noteViolation({ kind: 'harness-error', sel: s.name, detail: msg }, ctx);
        screenLog.push({ name: s.name, opened: true, steps: -1, ms: Date.now() - t1, error: msg });
        console.log(`   harness error: ${msg}`);
    }
}

async function runScreenBody(s, tested, ctx, rnd, t1) {
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    await closeAll('pre');
    consoleBuf.length = 0;
    await s.open().catch((e) => ctx.repro.push(`open failed: ${String(e.message).split('\n')[0]}`));
    await page.waitForTimeout(700);
    await page.evaluate(() => {
        window.__mk.lists = new Map(); // lists of the previous screen are not this screen's
    });
    const wins = await page.evaluate(() => window.__mk.setScope());
    await drain(ctx);
    if (wins.length === 0) {
        screenLog.push({ name: s.name, opened: false, steps: 0, ms: Date.now() - t1 });
        console.log('   (opens no window)');
        return;
    }
    const main = wins[wins.length - 1];
    ctx.screen = `${s.name} (${main})`;
    if (tested.has(main)) {
        screenLog.push({ name: s.name, opened: true, duplicateOf: main, steps: 0, ms: Date.now() - t1 });
        await closeAll('dup');
        console.log(`   (same window as an earlier entry: ${main})`);
        return;
    }
    tested.add(main);
    await runChecks(ctx);
    let steps = 0;
    let idle = 0;
    while (steps < STEPS && idle < 12) {
        ctx.step = steps + 1;
        await guardNav(ctx);
        const cur = await page.evaluate(() => window.__mk.setScope());
        if (cur.length === 0) {
            // the window closed itself (a click on a close/OK/apply); reopen once to keep going
            ctx.repro.push('(window closed by a click; reopened)');
            await s.open().catch(() => {});
            await page.waitForTimeout(500);
            if ((await page.evaluate(() => window.__mk.setScope())).length === 0) break;
        }
        // Child window above the main one: sometimes close it with Escape and check that it goes away.
        const depth = (await page.evaluate(() => window.__mk.windows().length)) - 1;
        if (depth > 0 && rnd() < 0.5) {
            const before = (await page.evaluate(() => window.__mk.windows().map(window.__mk.scopeId))).join('|');
            const st0 = await pageState();
            ctx.action = `Escape (child window; top: ${before.split('|').pop()})`;
            ctx.repro.push(ctx.action);
            await page.keyboard.press('Escape');
            await page.waitForTimeout(350);
            const after = (await page.evaluate(() => window.__mk.windows().map(window.__mk.scopeId))).join('|');
            const st1 = await pageState();
            if (st1.url !== st0.url || !st1.game) {
                // the Escape took the page away: keep the before/after state as the finding, then reboot
                await noteViolation({ kind: 'page-lost', sel: before.split('|').pop(), detail: `Escape with a window open lost the game: url ${st0.url} -> ${st1.url}, game object ${st1.game ? 'kept' : 'gone'}` }, ctx);
                await bootPage();
                throw new NavigatedError('rebooted after Escape');
            }
            if (!st0.menu && st1.menu) ctx.repro.push('(Escape opened the game menu)');
            if (before === after) await noteViolation({ kind: 'escape-no-close', sel: before.split('|').pop(), detail: 'Escape did not close the top window' }, ctx);
            await page.evaluate(() => window.__mk.setScope());
            steps++;
            continue;
        }
        const { items, denied } = await page.evaluate(() => window.__mk.clickables());
        for (const d of denied) skippedLabels.set(d, (skippedLabels.get(d) ?? 0) + 1);
        if (items.length === 0) {
            idle++;
            ctx.repro.push('(nothing clickable)');
            steps++;
            continue;
        }
        const r = rnd();
        const rows = items.filter((i) => i.rowish);
        const tabs = items.filter((i) => i.tab);
        if (r < 0.14 && rows.length >= 4) {
            // rapid burst: 10 clicks over rows of one list within ~300 ms
            const key = pick(rows).rowKey;
            const group = rows.filter((i) => i.rowKey === key);
            const n = Math.min(10, group.length);
            const burst = Array.from({ length: n }, () => pick(group));
            ctx.action = `RAPID x${n} on ${key.split('|')[1] ?? key}: ${burst.map((b) => JSON.stringify(b.label.slice(0, 16))).join(',')}`;
            ctx.repro.push(ctx.action);
            const t = Date.now();
            for (const b of burst) {
                const p = await page.evaluate((i) => window.__mk.point(i), b.idx);
                if (p) await page.mouse.click(p.x, p.y);
            }
            ctx.action += ` (${Date.now() - t} ms)`;
        } else if (r < 0.26 && tabs.length >= 2) {
            const a = pick(tabs);
            const b = pick(tabs.filter((t) => t !== a));
            ctx.action = `TABS back/forth ${JSON.stringify(a.label)} <-> ${JSON.stringify(b.label)}`;
            ctx.repro.push(ctx.action);
            for (const t of [a, b, a, b, a]) {
                const p = await page.evaluate((i) => window.__mk.point(i), t.idx);
                if (p) await page.mouse.click(p.x, p.y);
                await page.waitForTimeout(60);
                // tabs rebuild the page: re-resolve by label after the first click
                const fresh = await page.evaluate(() => window.__mk.clickables().items.filter((i) => i.tab));
                const same = fresh.find((f) => f.label === t.label);
                if (same) {
                    a.idx = a.label === same.label ? same.idx : a.idx;
                    b.idx = b.label === same.label ? same.idx : b.idx;
                }
            }
        } else {
            const t = pick(items);
            const p = await page.evaluate((i) => window.__mk.point(i), t.idx);
            if (!p) {
                idle++;
                continue;
            }
            ctx.action = `click ${JSON.stringify(t.label)} <${t.sel}>`;
            ctx.repro.push(ctx.action);
            if (p.covered) await noteViolation({ kind: 'covered-click', sel: p.sel, detail: `centre of "${p.label}" is covered by ${p.covered}`, html: '' }, ctx);
            await page.mouse.click(p.x, p.y);
        }
        idle = 0;
        steps++;
        await page.waitForTimeout(120);
        await runChecks(ctx);
    }
    // End of screen: close it (Escape, then the close button) and verify, then resume the sim and watch the clock.
    ctx.step = steps + 1;
    ctx.action = 'close';
    for (let i = 0; i < 6; i++) {
        const w = await page.evaluate(() => window.__mk.setScope());
        if (w.length === 0) break;
        ctx.repro.push(`Escape (top: ${w[w.length - 1]})`);
        const before = w.join('|');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(350);
        const after = (await page.evaluate(() => window.__mk.setScope())).join('|');
        if (before === after) {
            await noteViolation({ kind: 'escape-no-close', sel: w[w.length - 1], detail: 'Escape did not close the top window' }, ctx);
            const c = page.locator('.ow-close:visible').last();
            await c.click({ timeout: 1500 }).catch(() => {});
            await page.waitForTimeout(350);
            const after2 = (await page.evaluate(() => window.__mk.setScope())).join('|');
            if (after2 === before) {
                await noteViolation({ kind: 'cannot-close', sel: w[w.length - 1], detail: 'neither Escape nor the close button closed the window' }, ctx);
                await page.evaluate(() => window.__mk.scope?.remove()); // force it so the hunt can go on
            }
        }
    }
    await closeAll('end');
    await drain(ctx);
    const adv = await page.evaluate(async () => {
        const d = window.__dwu;
        d.time.paused = false;
        const a = d.game.galaxy.nowMs;
        await new Promise((r) => setTimeout(r, 2500));
        const b = d.game.galaxy.nowMs;
        d.time.paused = true;
        return { a, b };
    });
    if (!(adv.b > adv.a)) await noteViolation({ kind: 'sim-stalled', sel: 'galaxy.nowMs', detail: `nowMs ${adv.a} -> ${adv.b} after resuming (2.5 s)` }, ctx);
    screenLog.push({ name: s.name, window: main, opened: true, steps, ms: Date.now() - t1 });
    console.log(`   ${steps} steps, ${((Date.now() - t1) / 1000).toFixed(1)} s`);
}

async function runChecks(ctx) {
    await guardNav(ctx);
    await drain(ctx);
    const res = await page.evaluate(() => ({ v: window.__mk.check(), ex: window.__mk.excerpt() }));
    ctx.excerpt = res.ex;
    const navs = await page.evaluate(() => window.__mk.navs.splice(0));
    for (const n of navs) await noteViolation({ kind: 'link-navigates', sel: 'a[href]', detail: `a click would navigate to ${n} (cancelled by the hunt)` }, ctx);
    const lv = res.v.filter((v) => v.kind === 'list-vanished');
    let confirmed = lv;
    if (lv.length) {
        // a list that is being rebuilt is empty for a moment: keep it only if it is still empty after 400 ms
        await page.waitForTimeout(400);
        const again = await page.evaluate(() => window.__mk.check().filter((v) => v.kind === 'list-vanished').map((v) => v.sel));
        confirmed = lv.filter((v) => again.includes(v.sel));
    }
    for (const v of res.v) if (v.kind !== 'list-vanished' || confirmed.includes(v)) await noteViolation(v, ctx);
}

function writeReports(ms) {
    const HARNESS = /^(harness-error|page-lost|page-navigated)$/;
    const harness = [...violations.values()].filter((v) => HARNESS.test(v.kind));
    const list = [...violations.values()].filter((v) => !HARNESS.test(v.kind));
    const json = { seed, gameDir, steps: STEPS, addons: ADDONS.split(','), runMs: ms, screens: screenLog, skipped: Object.fromEntries(skippedLabels), violations: list, harness };
    writeFileSync(join(OUT, `report-${seed}.json`), JSON.stringify(json, null, 1));
    const lines = [`# Monkey report, seed ${seed}`, '', `Game: ${gameDir}; ${STEPS} steps/screen; run time ${(ms / 60000).toFixed(1)} min; ${list.length} distinct violations (${list.reduce((n, v) => n + v.count, 0)} total).`, ''];
    lines.push('## Screens', '', ...screenLog.map((s) => `- ${s.name}: ${s.opened ? (s.duplicateOf ? `same window as ${s.duplicateOf}` : `${s.steps} steps, ${(s.ms / 1000).toFixed(0)} s`) : 'opens no window'}`), '');
    const byScreen = new Map();
    for (const v of list) byScreen.set(v.screen, [...(byScreen.get(v.screen) ?? []), v]);
    for (const [scr, vs] of byScreen) {
        lines.push(`## ${scr}`, '');
        const byKind = new Map();
        for (const v of vs) byKind.set(v.kind, [...(byKind.get(v.kind) ?? []), v]);
        for (const [kind, kv] of byKind) {
            lines.push(`### ${kind}`);
            for (const v of kv) {
                lines.push(`- x${v.count} \`${v.sel}\` ${v.detail}`);
                lines.push(`  - step ${v.step}, after: ${v.action}`);
                lines.push(`  - repro: ${v.repro.slice(-8).join(' -> ')}`);
                if (v.screenshot) lines.push(`  - screenshot: ${v.screenshot}`);
            }
            lines.push('');
        }
    }
    lines.push('## Harness errors and page losses (not game violations)', '');
    if (harness.length === 0) lines.push('None.', '');
    for (const v of harness) {
        lines.push(`- x${v.count} [${v.kind}] ${v.screen}: ${v.detail}`, `  - step ${v.step}, after: ${v.action}`, `  - repro: ${v.repro.slice(-8).join(' -> ')}`, '');
    }
    lines.push('## Skipped (denylist / dialogs)', '', ...[...skippedLabels].map(([k, n]) => `- ${JSON.stringify(k)} x${n}`), '');
    writeFileSync(join(OUT, `report-${seed}.md`), lines.join('\n'));
    console.log(`report: ${join(OUT, `report-${seed}.md`)} (${list.length} violations, ${(ms / 60000).toFixed(1)} min)`);
}

if (!existsSync(join(gameDir, 'node_modules/.bin/vite'))) {
    console.error(`no vite in ${gameDir}/node_modules`);
    process.exit(2);
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
