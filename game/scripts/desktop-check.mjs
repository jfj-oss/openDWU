// Usage: node scripts/desktop-check.mjs [--app=release/dwu-linux-x64/dwu] [--port=9333]
//                                       [--socket=dwu-pkg] [--compare-dev] [--unpacked]
//                                       [--skip-game] [--skip-setup] [--skip-update]
//
// --app may also be the AppImage (release/upload/openDWU-<v>-linux-x64.AppImage).
//
// --unpacked runs `electron desktop/main.cjs` from node_modules over the built dist/ (what `npm run desktop:dev`
// launches; build it first with `npm run build`) instead of the packaged app.
//
// Headless check of the PACKAGED Linux desktop app (build it first with
// `npm run package:linux`). Electron's --ozone-platform=headless segfaults on
// this setup, so the app runs on a private virtual Wayland compositor instead:
//
//   kwin_wayland --virtual --socket <socket> --width 1920 --height 1080
//   WAYLAND_DISPLAY=<socket> DWU_DIR=<install> <app> --ozone-platform=wayland
//       --remote-debugging-port=<port> --user-data-dir=<tmp>
//
// then drives it over CDP (playwright-core connectOverCDP):
//   1. main menu at dwu://app/index.html
//   2. dwu://app/index.html?autostart=1 -> game view (window.__dwu.game)
//   3. Play -> galaxy.nowMs advances within 60 s
//   4. the bottom-right system map; F5 Diplomacy, F8 Designs, V Empire Comparison, Construction Yards and G Galaxy
//      Map open and close
//   5. profiled PNG/JPEG art is served stripped (desktop/colorProfile.cjs, byte-compared)
//   6. asset-manifest.json / theme-manifest/ are built from the install at runtime (equal to desktop/assetManifest.cjs
//      and desktop/themeIndex.cjs for it; the packaged dist/ has no copy) and our own art (art/...) is served
//   7. ?simWorker=1: the module Web Worker loads under dwu:// and the replica galaxy advances; the default boot (no
//      ?simWorker) runs in the worker too, a command's reply reaches the replica and the worker saves
// then two more launches each:
//   - first run with no install found (empty $HOME, no $DWU_DIR): the setup window opens, refuses a folder without
//     the game, accepts the install's parent folder (finding the game inside), saves it to config.json and opens the
//     game; the next launch goes straight to the game;
//   - the update check against a local fake of the GitHub Releases API (DWU_UPDATE_URL) with a newer release: the
//     offer names this platform's download, the check time is saved, and a second launch within a day does not ask
//     GitHub again (the dialog itself is native and is not clicked).
// saving 1920x1080 captures to shots/pkg-*.png. Every request whose URL has
// /assets/dwu/ must go through dwu:// and succeed; console errors, page errors
// and failed/4xx requests fail the check (exit 1) — except 404s for files the
// install really lacks (the loaders probe optional files, e.g.
// designTemplates/<race>/pirate/planetdestroyer.txt, characters/Mechanoid.txt,
// and the dev-only /assets/dwu/__dwu_probe endpoint), which are listed but
// tolerated along with Chromium's matching "Failed to load resource" console
// errors. The dev server hides these: its SPA fallback answers 200 index.html.
//
// --compare-dev also runs the same flow against the Vite dev server in the
// system Chromium (shots/dev-*.png) and prints which /assets/dwu/ paths were
// requested by one side only (informational: the autostart galaxy differs
// per run, so the sets are not expected to match exactly).
//
// The DW:U install folder comes from $DWU_DIR (main.cjs honours it before
// config.json / default guesses); default: the public/assets/dwu symlink
// target, else the Linux Steam path. The app gets a throwaway
// --user-data-dir so ~/.config and real saves are untouched. kwin_wayland and
// the app are stopped by the PIDs this script spawned.
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
const requireCjs = createRequire(import.meta.url);
const { stripColorProfile, isProfiledImagePath } = requireCjs('../desktop/colorProfile.cjs');
const { buildAssetManifest } = requireCjs('../desktop/assetManifest.cjs');
const themeIndexLib = requireCjs('../desktop/themeIndex.cjs');
const { assetFileNames } = requireCjs('../desktop/updateCheck.cjs');
import os from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const shotsDir = join(root, 'shots');
mkdirSync(shotsDir, { recursive: true });

const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
        const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
        if (!m) throw new Error(`Unknown argument: ${a}`);
        return [m[1], m[2] ?? true];
    }),
);
const unpacked = args.unpacked === true;
const appBin = unpacked ? resolve(root, 'node_modules/electron/dist/electron') : resolve(root, args.app ?? 'release/dwu-linux-x64/dwu');
const appArgs = unpacked ? [resolve(root, 'desktop/main.cjs')] : [];
const cdpPort = Number(args.port ?? 9333);
const socketName = args.socket ?? 'dwu-pkg';
const W = 1920;
const H = 1080;

function defaultDwuDir() {
    if (process.env.DWU_DIR) return process.env.DWU_DIR;
    const link = join(root, 'public', 'assets', 'dwu');
    if (existsSync(link)) return realpathSync(link);
    return join(os.homedir(), '.local/share/Steam/steamapps/common/Distant Worlds Universe');
}
const dwuDir = defaultDwuDir();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeoutMs, what) {
    const start = Date.now();
    for (;;) {
        try {
            const v = await fn();
            if (v) return v;
        } catch {
            // not ready yet
        }
        if (Date.now() - start > timeoutMs) throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
        await sleep(200);
    }
}

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

/** Stop a child we spawned: SIGTERM, then SIGKILL after 5 s. */
async function stop(child, name) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((r) => child.once('exit', r));
    try {
        process.kill(child.pid, 'SIGTERM');
    } catch {
        return;
    }
    const t = setTimeout(() => {
        try {
            process.kill(child.pid, 'SIGKILL');
        } catch {
            // already gone
        }
    }, 5000);
    await exited;
    clearTimeout(t);
    console.log(`  stopped ${name} (pid ${child.pid})`);
}

// ---------------------------------------------------------------------------
// The flow, shared by the packaged app and the dev server.
// ---------------------------------------------------------------------------

/** Attach listeners; returns the collector. */
function watchPage(page, tag) {
    const c = { requests: [], failed: [], consoleErrors: [], pageErrors: [] };
    page.on('console', (m) => {
        if (m.type() === 'error') {
            c.consoleErrors.push({ text: m.text(), url: m.location()?.url ?? '' });
            // 404 resource errors are summarised (and classified) at the end.
            if (!m.text().startsWith('Failed to load resource')) console.log(`  [${tag} console.error] ${m.text()}`);
        }
    });
    page.on('pageerror', (e) => {
        c.pageErrors.push(e.message);
        console.log(`  [${tag} pageerror] ${e.message}`);
    });
    page.on('request', (req) => c.requests.push(req.url()));
    page.on('requestfailed', (req) => {
        const msg = `${req.url()} — ${req.failure()?.errorText ?? 'failed'}`;
        c.failed.push({ url: req.url(), status: 0, msg });
        console.log(`  [${tag} requestfailed] ${msg}`);
    });
    page.on('response', (res) => {
        if (res.status() >= 400) {
            const msg = `${res.url()} — HTTP ${res.status()}`;
            c.failed.push({ url: res.url(), status: res.status(), msg });
            if (res.status() !== 404) console.log(`  [${tag} response] ${msg}`);
        }
    });
    return c;
}

async function runFlow(page, base, tag, results) {
    const ok = (name) => {
        results.push({ name: `${tag}: ${name}`, ok: true });
        console.log(`PASS: ${tag}: ${name}`);
    };
    const bad = (name, err) => {
        results.push({ name: `${tag}: ${name}`, ok: false });
        console.log(`FAIL: ${tag}: ${name} — ${err?.message ?? err}`);
    };
    const shot = async (label) => {
        const out = join(shotsDir, `${tag}-${label}.png`);
        await page.screenshot({ path: out });
        console.log(`  screenshot: shots/${tag}-${label}.png`);
    };

    await page.setViewportSize({ width: W, height: H });

    try {
        await page.goto(`${base}index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('button[data-id="startNewGame"]', { state: 'visible', timeout: 20000 });
        await page.waitForTimeout(1000);
        await shot('menu');
        ok('main menu visible');
    } catch (err) {
        bad('main menu visible', err);
        await shot('menu-failed').catch(() => {});
    }

    try {
        await page.goto(`${base}index.html?autostart=1&simWorker=0`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.__dwu?.game?.galaxy, null, { timeout: 90000 });
        await page.waitForSelector('canvas', { state: 'visible', timeout: 15000 });
        const n = await page.evaluate(() => window.__dwu.game.galaxy.empires.length);
        await page.waitForTimeout(1500);
        await shot('game');
        ok(`?autostart=1 game view (${n} empires)`);
    } catch (err) {
        bad('?autostart=1 game view', err);
        await shot('game-failed').catch(() => {});
        return; // nothing below works without a game
    }

    try {
        const nowMs = () => page.evaluate(() => window.__dwu?.game?.galaxy?.nowMs ?? -1);
        const t0 = await nowMs();
        await page.click('button[data-hud-ctl="playPause"]');
        let t1 = t0;
        const deadline = Date.now() + 60000;
        while (Date.now() < deadline) {
            await page.waitForTimeout(500);
            t1 = await nowMs();
            if (t1 - t0 >= 1000) break;
        }
        if (t0 < 0 || t1 <= t0) throw new Error(`galaxy.nowMs did not advance within 60 s (${t0} -> ${t1})`);
        await shot('running');
        ok(`unpaused, galaxy.nowMs ${t0} -> ${t1}`);
    } catch (err) {
        bad('unpause + galaxy.nowMs advances', err);
        await shot('running-failed').catch(() => {});
    }

    // System map (hudSystemMap.ts): the remade bottom-right panel, with its strip images decoded.
    try {
        await page.waitForSelector('[data-hud="pnlSystemMap"]', { state: 'visible', timeout: 10000 });
        const info = await page.evaluate(() => {
            const m = document.querySelector('[data-hud="pnlSystemMap"]');
            const r = m.getBoundingClientRect();
            const imgs = [...m.querySelectorAll('img')];
            return { w: r.width, h: r.height, right: innerWidth - r.right, bottom: innerHeight - r.bottom, imgs: imgs.length, broken: imgs.filter((i) => !i.complete || i.naturalWidth === 0).length };
        });
        if (info.w < 50 || info.h < 50) throw new Error(`system map too small: ${JSON.stringify(info)}`);
        if (info.right > 400 || info.bottom > 400) throw new Error(`system map is not bottom-right: ${JSON.stringify(info)}`);
        if (info.broken > 0) throw new Error(`${info.broken}/${info.imgs} system map images failed to decode`);
        await shot('system-map');
        ok(`bottom-right system map (${Math.round(info.w)}x${Math.round(info.h)}, ${info.imgs} images)`);
    } catch (err) {
        bad('bottom-right system map', err);
        await shot('system-map-failed').catch(() => {});
    }

    // Screens: F5 / F8 plus one from each recent parity batch (Empire Comparison, Construction Yards, Galaxy Map).
    for (const [name, open, sel] of [
        ['F5 Diplomacy', { key: 'F5' }, '[data-ow="diplomacy"]'],
        ['F8 Designs', { key: 'F8' }, '[data-ow="designs"]'],
        ['V Empire Comparison', { key: 'v' }, '[data-ow="empireComparison"]'],
        ['Construction Yards', { hud: 'tbtnConstructionYards' }, '[data-ow="yards"]'],
        ['G Galaxy Map', { key: 'g' }, '.gmap-overlay:not([hidden])'],
    ]) {
        const label = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        try {
            if (open.hud) await page.click(`[data-hud="${open.hud}"]`);
            else await page.keyboard.press(open.key);
            await page.waitForSelector(sel, { state: 'visible', timeout: 10000 });
            await page.waitForTimeout(1500); // let images in the screen load
            const broken = await page.evaluate((s) => {
                const root = document.querySelector(s);
                return [...root.querySelectorAll('img')].filter((i) => i.complete && i.naturalWidth === 0).length;
            }, sel);
            if (broken > 0) throw new Error(`${broken} broken image(s)`);
            await shot(label);
            await page.keyboard.press('Escape');
            await page.waitForSelector(sel, { state: 'hidden', timeout: 5000 }).catch(async () => {
                // Not closed by Escape: toggle with the opener.
                if (open.hud) await page.click(`[data-hud="${open.hud}"]`);
                else await page.keyboard.press(open.key);
                await page.waitForSelector(sel, { state: 'hidden', timeout: 5000 });
            });
            ok(`${name} opens ${sel} and closes`);
        } catch (err) {
            bad(`${name} opens ${sel}`, err);
            await shot(`${label}-failed`).catch(() => {});
            await page.keyboard.press('Escape').catch(() => {});
        }
    }

    // Colour-profile stripped art: a profiled PNG and JPEG must come back byte-identical to
    // stripColorProfile(file) (dwu:// handler / Vite middleware).
    try {
        const samples = findProfiledSamples();
        if (samples.length === 0) throw new Error('no PNG/JPEG with a colour profile found in the install');
        const sum = (b) => b.reduce((a, v, i) => (a + v * ((i % 251) + 1)) % 4294967291, 0);
        for (const s of samples) {
            const got = await page.evaluate(async (u) => {
                const r = await fetch(u);
                const b = new Uint8Array(await r.arrayBuffer());
                return { status: r.status, len: b.length, sum: b.reduce((a, v, i) => (a + v * ((i % 251) + 1)) % 4294967291, 0) };
            }, `${base}assets/dwu/${s.rel}`);
            const want = stripColorProfile(readFileSync(s.abs));
            if (got.status !== 200 || got.len !== want.length || got.sum !== sum(want)) {
                throw new Error(`${s.rel}: served ${got.len} B (HTTP ${got.status}), expected stripped ${want.length} B`);
            }
            console.log(`  stripped ${s.rel}: ${statSync(s.abs).size} -> ${want.length} B`);
        }
        ok(`colour profile stripped from served art (${samples.map((s) => s.rel).join(', ')})`);
    } catch (err) {
        bad('colour profile stripped art', err);
    }

    // Install listings: asset-manifest.json and theme-manifest/ come from the install at runtime (desktop shell:
    // desktop/assetManifest.cjs + desktop/themeIndex.cjs built in main.cjs; dev: gen-asset-manifest.mjs and the theme
    // middleware) and must equal the shared builders' answer for this install; our own art (public/art/) is served.
    try {
        const got = await page.evaluate(async (b) => {
            const get = async (u) => {
                const r = await fetch(b + u);
                return { status: r.status, body: r.ok ? await r.json() : null };
            };
            const m = await get('asset-manifest.json');
            const t = await get('theme-manifest/index.json');
            const first = Array.isArray(t.body) && t.body.length > 0 ? await get(`theme-manifest/${encodeURIComponent(t.body[0])}.json`) : null;
            const art = (await fetch(`${b}art/herder/portrait.png`)).status;
            return { m, t, first, art };
        }, base);
        const want = buildAssetManifest(dwuDir);
        if (got.m.status !== 200 || JSON.stringify(got.m.body) !== JSON.stringify(want)) {
            throw new Error(`asset-manifest.json (HTTP ${got.m.status}, ${Object.keys(got.m.body ?? {}).length} folders) differs from buildAssetManifest(install) (${Object.keys(want).length} folders)`);
        }
        const themes = themeIndexLib.listThemes(dwuDir);
        if (JSON.stringify(got.t.body) !== JSON.stringify(themes)) throw new Error(`theme-manifest/index.json ${JSON.stringify(got.t.body)} != ${JSON.stringify(themes)}`);
        if (themes.length > 0 && JSON.stringify(got.first?.body) !== JSON.stringify(themeIndexLib.buildThemeIndex(dwuDir, themes[0]))) throw new Error(`theme-manifest/${themes[0]}.json differs`);
        if (got.art !== 200) throw new Error(`art/herder/portrait.png: HTTP ${got.art}`);
        const files = Object.values(want).reduce((n, l) => n + l.length, 0);
        ok(`install listings built at runtime (asset manifest: ${Object.keys(want).length} folders / ${files} files; ${themes.length} theme(s)); own art served`);
    } catch (err) {
        bad('install listings built at runtime', err);
    }

    // Web Worker: ?simWorker=1 runs the sim in a module worker (dist/assets/worker-*.js) loaded over the same scheme.
    try {
        const workerUrls = [];
        page.on('worker', (w) => workerUrls.push(w.url()));
        await page.goto(`${base}index.html?autostart=1&simWorker=1`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.__dwu?.game?.galaxy && window.__dwu.simWorker != null, null, { timeout: 120000 });
        // Pixi also starts blob: workers (image decoding); the sim worker is the script file from dist/assets/.
        const simUrls = workerUrls.filter((u) => !u.startsWith('blob:'));
        if (simUrls.length === 0) throw new Error(`no sim worker script was loaded (workers: ${workerUrls.slice(0, 3).join(' ')})`);
        // Built: dist/assets/worker-<hash>.js; the dev server serves the module source instead.
        const workerRe = tag === 'dev' ? /\/src\/simworker\/worker\.ts\?worker_file&type=module$/ : /\/assets\/worker-[^/]+\.js$/;
        if (!simUrls.every((u) => u.startsWith(base) && workerRe.test(u))) throw new Error(`unexpected worker script: ${simUrls.join(' ')}`);
        await page.waitForTimeout(1500);
        await page.evaluate(() => { window.__dwu.time.paused = false; });
        const nowMs = () => page.evaluate(() => window.__dwu?.game?.galaxy?.nowMs ?? -1);
        const t0 = await nowMs();
        let t1 = t0;
        const deadline = Date.now() + 60000;
        while (Date.now() < deadline) {
            await page.waitForTimeout(500);
            t1 = await nowMs();
            if (t1 - t0 >= 1000) break;
        }
        if (t1 - t0 < 1000) throw new Error(`replica galaxy.nowMs did not advance (${t0} -> ${t1})`);
        await shot('worker');
        ok(`?simWorker=1 sim worker runs (${simUrls[0]}), replica nowMs ${t0} -> ${t1}`);
    } catch (err) {
        bad('?simWorker=1 sim worker', err);
        await shot('worker-failed').catch(() => {});
    }

    // The worker is the default (docs/sim-worker.md §6): no ?simWorker runs it; a command goes through it and its reply
    // comes back to the replica; the worker saves.
    try {
        await page.goto(`${base}index.html?autostart=1`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.__dwu?.game?.galaxy && window.__dwu?.time !== undefined, null, { timeout: 120000 });
        const w = await page.evaluate(async () => {
            const d = window.__dwu;
            const sw = d.simWorker ?? null;
            if (sw === null) return { worker: false };
            const p = d.game.playerEmpire;
            const reply = await new Promise((res) => {
                d.commands.issue(d.galaxy, p, 'empireRename', ['Desktop Worker Check'], () => res(p.name));
                setTimeout(() => res('(no reply)'), 20000);
            });
            const text = await sw.save();
            return { worker: true, reply, saveKb: text ? Math.round(text.length / 1024) : 0 };
        });
        if (!w.worker) throw new Error('window.__dwu.simWorker is null: the default boot runs in-thread');
        if (w.reply !== 'Desktop Worker Check') throw new Error(`the command's reply did not reach the replica (${w.reply})`);
        if (!(w.saveKb > 0)) throw new Error('the worker did not save');
        ok(`the default boot runs the worker (a command's reply reaches the replica; worker save ${w.saveKb} KB)`);
    } catch (err) {
        bad('the default boot runs the worker', err);
    }
}

/** A few profiled images from the install (PNG with colour chunks, JPEG with an ICC APP2) that strip shrinks. */
function findProfiledSamples() {
    const out = [];
    const want = { png: 2, jpg: 1 };
    const walk = (dir, rel) => {
        let ents;
        try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of ents) {
            if (want.png + want.jpg === 0) return;
            const abs = join(dir, e.name);
            const r = `${rel}/${e.name}`;
            if (e.isDirectory()) { walk(abs, r); continue; }
            if (!isProfiledImagePath(abs)) continue;
            const k = /\.png$/i.test(e.name) ? 'png' : 'jpg';
            if (want[k] === 0) continue;
            let buf;
            try { buf = readFileSync(abs); } catch { continue; }
            if (buf.length > 600000) continue;
            if (stripColorProfile(buf).length < buf.length) { out.push({ abs, rel: r }); want[k]--; }
        }
    };
    walk(join(dwuDir, 'images'), 'images');
    return out;
}

/** '/assets/dwu/<rest>' part of a URL (decoded, lowercased), or null. */
function assetKey(url) {
    const i = url.indexOf('/assets/dwu/');
    if (i < 0) return null;
    const rest = url.slice(i + '/assets/dwu/'.length).split(/[?#]/)[0];
    try {
        return decodeURIComponent(rest).toLowerCase();
    } catch {
        return rest.toLowerCase();
    }
}

/** Does <dwuDir>/<rel> exist, matching each segment case-insensitively (like main.cjs)? */
function existsInInstall(rel) {
    let dir = dwuDir;
    const segs = rel.split('/').filter(Boolean);
    for (const seg of segs) {
        let entries;
        try {
            entries = readdirSync(dir);
        } catch {
            return false;
        }
        const hit = entries.find((e) => e.toLowerCase() === seg.toLowerCase());
        if (!hit) return false;
        dir = join(dir, hit);
    }
    return segs.length > 0;
}

/** A 404 for a file the install does not have (optional-file probe), or the dev-only probe endpoint. */
function isExpectedMissing(f) {
    const key = assetKey(f.url);
    return f.status === 404 && key !== null && (key === '__dwu_probe' || !existsInInstall(key));
}

function checkCollector(c, tag, results, { requireScheme } = {}) {
    const rec = (name, ok, detail) => {
        results.push({ name: `${tag}: ${name}`, ok });
        console.log(`${ok ? 'PASS' : 'FAIL'}: ${tag}: ${name}${detail ? ` — ${detail}` : ''}`);
    };
    const assetReqs = c.requests.filter((u) => assetKey(u) !== null);
    console.log(`  ${tag}: ${c.requests.length} requests, ${assetReqs.length} under /assets/dwu/`);
    if (requireScheme) {
        const wrong = assetReqs.filter((u) => !u.startsWith(requireScheme));
        rec(`all /assets/dwu/ requests go through ${requireScheme}`, wrong.length === 0, wrong.slice(0, 5).join(' | '));
    }
    const expected = c.failed.filter(isExpectedMissing);
    const unexpected = c.failed.filter((f) => !isExpectedMissing(f));
    if (expected.length > 0) {
        console.log(`  ${tag}: ${expected.length} tolerated 404(s) for files not in the install:`);
        for (const f of expected) console.log(`    ${assetKey(f.url)}`);
    }
    rec('no failed / unexpected 4xx requests', unexpected.length === 0, `${unexpected.length}: ${unexpected.slice(0, 5).map((f) => f.msg).join(' | ')}`);
    const expectedUrls = new Set(expected.map((f) => f.url));
    const errors = c.consoleErrors.filter((e) => !(expectedUrls.has(e.url) && e.text.startsWith('Failed to load resource')));
    rec('no console errors', errors.length === 0, errors.slice(0, 3).map((e) => e.text).join(' | '));
    rec('no page errors', c.pageErrors.length === 0, c.pageErrors.slice(0, 3).join(' | '));
    return new Set(assetReqs.map(assetKey));
}

// ---------------------------------------------------------------------------
// Packaged app on kwin_wayland --virtual
// ---------------------------------------------------------------------------

/** Start the app on the compositor; returns { app, log(), browser(), stop() }. */
async function launchApp({ socketName: sock, runtimeDir, userDataDir, env: extraEnv = {}, unsetEnv = [], cdp = true }) {
    const appEnv = { ...process.env, XDG_RUNTIME_DIR: runtimeDir, WAYLAND_DISPLAY: sock, DWU_UPDATE_CHECK: '0', ...extraEnv };
    delete appEnv.DISPLAY;
    for (const k of unsetEnv) delete appEnv[k];
    const child = spawn(appBin, [...appArgs, '--ozone-platform=wayland', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${userDataDir}`], {
        env: appEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    child.stdout.on('data', (d) => (log += d));
    child.stderr.on('data', (d) => (log += d));
    console.log(`  app pid ${child.pid}`);
    let browser = null;
    const handle = {
        app: child,
        log: () => log,
        browser: () => browser,
        async stop() {
            if (browser) await browser.close().catch(() => {});
            await stop(child, 'app');
            // An AppImage's runtime starts the real app as a child: make sure nothing keeps the CDP port.
            await waitFor(async () => {
                try {
                    await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
                    return false;
                } catch {
                    return true;
                }
            }, 10000, 'CDP port to close').catch(() => console.log('  (CDP port still open after stop)'));
        },
    };
    if (!cdp) return handle;
    await waitFor(
        async () => {
            if (child.exitCode !== null || child.signalCode) throw new Error('app exited');
            return (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).ok;
        },
        30000,
        'CDP endpoint',
    ).catch(async (err) => {
        await handle.stop();
        throw new Error(`${err.message}\n--- app log ---\n${log}`);
    });
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    return handle;
}

/** The first page of the app whose URL matches `re` (waits for it). */
async function pageMatching(browser, re, timeoutMs = 20000) {
    return waitFor(() => browser.contexts().flatMap((c) => c.pages()).find((p) => re.test(p.url())), timeoutMs, `a page matching ${re}`);
}

async function checkPackaged(results) {
    if (!existsSync(appBin)) throw new Error(`${appBin} not found — run \`npm run package:linux\` first`);
    if (unpacked && !existsSync(join(root, 'dist', 'index.html'))) throw new Error('dist/index.html not found — run `npm run build` first');
    const runtimeDir = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`;
    const socketPath = join(runtimeDir, socketName);
    if (existsSync(socketPath)) throw new Error(`Wayland socket ${socketPath} already exists (another check running?)`);
    console.log(`App: ${appBin}\nDWU_DIR: ${dwuDir}\nWayland socket: ${socketName}, CDP port ${cdpPort}`);
    const rec = (name, ok, detail) => {
        results.push({ name: `pkg: ${name}`, ok });
        console.log(`${ok ? 'PASS' : 'FAIL'}: pkg: ${name}${detail ? ` — ${detail}` : ''}`);
    };

    // The build carries no install-derived listing (they are built at runtime).
    const distDir = unpacked ? join(root, 'dist') : appBin.endsWith('.AppImage') ? null : join(dirname(appBin), 'resources', 'dwu-dist');
    if (distDir && existsSync(distDir)) {
        const leaked = ['asset-manifest.json', 'theme-manifest'].filter((n) => existsSync(join(distDir, n)));
        rec('the built game carries no install listing (asset-manifest.json, theme-manifest/)', leaked.length === 0, leaked.join(', '));
    }

    const tmpRoot = mkdtempSync(join(os.tmpdir(), 'dwu-desktop-check-'));
    let kwin = null;
    let collector = null;
    try {
        const kwinEnv = { ...process.env, XDG_RUNTIME_DIR: runtimeDir };
        delete kwinEnv.WAYLAND_DISPLAY; // run standalone, not nested in the user's session
        delete kwinEnv.DISPLAY;
        kwin = spawn('kwin_wayland', ['--virtual', '--socket', socketName, '--width', String(W), '--height', String(H)], {
            env: kwinEnv,
            stdio: ['ignore', 'ignore', 'pipe'],
        });
        let kwinLog = '';
        kwin.stderr.on('data', (d) => (kwinLog += d));
        console.log(`  kwin_wayland pid ${kwin.pid}`);
        await waitFor(() => existsSync(socketPath) || kwin.exitCode !== null, 15000, 'kwin_wayland socket');
        if (kwin.exitCode !== null) throw new Error(`kwin_wayland exited (${kwin.exitCode}):\n${kwinLog}`);
        const common = { socketName, runtimeDir };

        // 1. The game flow with DWU_DIR set.
        if (!args['skip-game']) {
            const userDataDir = join(tmpRoot, 'profile-game');
            const h = await launchApp({ ...common, userDataDir, env: { DWU_DIR: dwuDir } });
            try {
                const ctx = h.browser().contexts()[0];
                const page = ctx.pages()[0] ?? (await ctx.waitForEvent('page', { timeout: 15000 }));
                collector = watchPage(page, 'pkg');
                await runFlow(page, 'dwu://app/', 'pkg', results);
            } finally {
                await h.stop();
                const mainErrors = h.log().split('\n').filter((l) => /dwu:\/\/ handler error|DWU_DIR=|No DW:U install/.test(l));
                for (const l of mainErrors) console.log(`  [main] ${l}`);
            }
        }

        // 2. First run without any install found: the setup window validates a typed folder, accepts the install's
        //    parent folder (resolving the game folder inside it), saves it, opens the game; the next launch remembers it.
        if (!args['skip-setup']) await checkSetupFlow(results, rec, common, tmpRoot);

        // 3. The update check: a fake GitHub API with a newer release; the offer names this platform's download; the
        //    next launch within a day does not ask again.
        if (!args['skip-update']) await checkUpdateFlow(results, rec, common, tmpRoot);
    } finally {
        await stop(kwin, 'kwin_wayland');
        rmSync(tmpRoot, { recursive: true, force: true });
    }
    return collector ? checkCollector(collector, 'pkg', results, { requireScheme: 'dwu://app/assets/dwu/' }) : new Set();
}

async function checkSetupFlow(results, rec, common, tmpRoot) {
    const home = join(tmpRoot, 'home-empty'); // no Steam, no ~/Games: nothing to find
    mkdirSync(home, { recursive: true });
    const userDataDir = join(tmpRoot, 'profile-setup');
    const env = { HOME: home, XDG_DATA_HOME: join(home, '.local', 'share'), XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache') };
    const unsetEnv = ['DWU_DIR', 'WINEPREFIX'];
    let h = await launchApp({ ...common, userDataDir, env, unsetEnv });
    try {
        const page = await pageMatching(h.browser(), /setup\.html$/);
        await page.waitForSelector('#dir', { state: 'visible', timeout: 10000 });
        const title = await page.textContent('#title');
        const platformShown = await page.evaluate(() => [...document.querySelectorAll('[data-platform]')].filter((e) => !e.hidden).map((e) => e.dataset.platform).join(','));
        rec('first run without an install opens the setup window', /needs your Distant Worlds/.test(title ?? '') && platformShown === 'linux', `title "${title}", platform help ${platformShown}`);
        await page.screenshot({ path: join(shotsDir, 'pkg-setup.png') });
        console.log('  screenshot: shots/pkg-setup.png');

        await page.fill('#dir', home);
        await page.waitForFunction(() => document.getElementById('status').className === 'bad', null, { timeout: 5000 });
        const bad = await page.textContent('#status');
        const disabled = await page.isDisabled('#use');
        rec('a folder without the game files is refused', disabled && /not a Distant Worlds/.test(bad ?? ''), bad ?? '');

        const parent = dirname(dwuDir);
        await page.fill('#dir', parent);
        await page.waitForFunction(() => document.getElementById('status').className === 'ok', null, { timeout: 5000 });
        const good = await page.textContent('#status');
        rec('the install\'s parent folder is accepted (game folder found inside)', (good ?? '').includes(dwuDir), good ?? '');
        await page.screenshot({ path: join(shotsDir, 'pkg-setup-ok.png') });
        await page.click('#use');
        const game = await pageMatching(h.browser(), /^dwu:\/\/app\/index\.html/, 20000);
        await game.waitForSelector('button[data-id="startNewGame"]', { state: 'visible', timeout: 30000 });
        const cfg = JSON.parse(readFileSync(join(userDataDir, 'config.json'), 'utf8'));
        const art = await game.evaluate(async () => (await fetch('dwu://app/assets/dwu/races.txt')).status);
        rec('choosing the folder saves it and opens the game with its files', cfg.installDir === dwuDir && art === 200, `config.installDir=${cfg.installDir}, races.txt HTTP ${art}`);
    } catch (err) {
        rec('setup window flow', false, `${err.message}\n--- app log ---\n${h.log().slice(-2000)}`);
    } finally {
        await h.stop();
    }
    // Second launch: straight to the game, no setup window.
    h = await launchApp({ ...common, userDataDir, env, unsetEnv });
    try {
        const game = await pageMatching(h.browser(), /^dwu:\/\/app\/index\.html/, 20000);
        await game.waitForSelector('button[data-id="startNewGame"]', { state: 'visible', timeout: 30000 });
        const setupOpen = h.browser().contexts().flatMap((c) => c.pages()).some((p) => /setup\.html$/.test(p.url()));
        rec('the next launch remembers the folder (no setup window)', !setupOpen);
    } catch (err) {
        rec('the next launch remembers the folder', false, err.message);
    } finally {
        await h.stop();
    }
}

async function checkUpdateFlow(results, rec, common, tmpRoot) {
    const { createServer: createHttpServer } = await import('node:http');
    const v = '99.0.0';
    const names = assetFileNames(v);
    const requests = [];
    const srv = createHttpServer((req, res) => {
        requests.push({ url: req.url, ua: req.headers['user-agent'] ?? '' });
        res.setHeader('Content-Type', 'application/json');
        res.end(
            JSON.stringify({
                tag_name: `v${v}`,
                name: `openDWU ${v}`,
                html_url: `https://github.com/jfj-oss/openDWU/releases/tag/v${v}`,
                draft: false,
                prerelease: false,
                body: 'Test release notes.',
                assets: Object.values(names).map((n) => ({ name: n, size: 1, browser_download_url: `https://github.com/jfj-oss/openDWU/releases/download/v${v}/${n}` })),
            }),
        );
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${srv.address().port}/repos/x/y/releases/latest`;
    const userDataDir = join(tmpRoot, 'profile-update');
    const env = { DWU_DIR: dwuDir, DWU_UPDATE_CHECK: '1', DWU_UPDATE_URL: url };
    try {
        let h = await launchApp({ ...common, userDataDir, env, cdp: false });
        try {
            await waitFor(() => /\[update\] offering /.test(h.log()) || /\[update\] check failed/.test(h.log()), 60000, 'the update offer');
            const offer = /\[update\] offering (\S+)/.exec(h.log())?.[1];
            const want = appBin.endsWith('.AppImage') ? names.linuxAppImage : names.linuxTarGz;
            const ua = requests[0]?.ua ?? '';
            rec('a newer release on GitHub is offered with this platform\'s download', offer === want && /^openDWU\/\d+\.\d+\.\d+/.test(ua), `offered ${offer}, expected ${want}; User-Agent "${ua}"`);
            await sleep(500);
            const cfg = JSON.parse(readFileSync(join(userDataDir, 'config.json'), 'utf8'));
            rec('the check time is recorded', typeof cfg.lastUpdateCheck === 'number' && Date.now() - cfg.lastUpdateCheck < 120000, `lastUpdateCheck=${cfg.lastUpdateCheck}`);
        } finally {
            await h.stop();
        }
        const before = requests.length;
        h = await launchApp({ ...common, userDataDir, env, cdp: false });
        try {
            await waitFor(() => /\[update\] checked less than a day ago/.test(h.log()), 60000, 'the throttled check');
            rec('a second launch within a day does not query GitHub again', requests.length === before, `${requests.length - before} new request(s)`);
        } catch (err) {
            rec('a second launch within a day does not query GitHub again', false, `${err.message}\n${h.log().slice(-1500)}`);
        } finally {
            await h.stop();
        }
    } catch (err) {
        rec('update check flow', false, err.message);
    } finally {
        srv.close();
    }
}

// ---------------------------------------------------------------------------
// Optional: same flow on the Vite dev server (system Chromium)
// ---------------------------------------------------------------------------

async function checkDev(results) {
    execFileSync('node', ['scripts/gen-asset-manifest.mjs'], { cwd: root, stdio: 'inherit' });
    const port = await freePort();
    const base = `http://localhost:${port}/`;
    const vite = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
    let browser = null;
    try {
        await waitFor(async () => (await fetch(base)).status < 500, 30000, 'vite dev server');
        browser = await chromium.launch({
            executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
            args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        });
        const page = await browser.newPage();
        const c = watchPage(page, 'dev');
        await runFlow(page, base, 'dev', results);
        return checkCollector(c, 'dev', results);
    } finally {
        if (browser) await browser.close().catch(() => {});
        await stop(vite, 'vite');
    }
}

async function main() {
    const results = [];
    const pkgAssets = await checkPackaged(results);
    if (args['compare-dev']) {
        const devAssets = await checkDev(results);
        const onlyDev = [...devAssets].filter((k) => !pkgAssets.has(k));
        const onlyPkg = [...pkgAssets].filter((k) => !devAssets.has(k));
        console.log(`\n/assets/dwu/ paths: pkg ${pkgAssets.size}, dev ${devAssets.size}, shared ${pkgAssets.size - onlyPkg.length}`);
        console.log(`  only in dev (${onlyDev.length}): ${onlyDev.slice(0, 15).join(', ')}${onlyDev.length > 15 ? ', ...' : ''}`);
        console.log(`  only in pkg (${onlyPkg.length}): ${onlyPkg.slice(0, 15).join(', ')}${onlyPkg.length > 15 ? ', ...' : ''}`);
    }

    console.log('\n--- Summary ---');
    for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}: ${r.name}`);
    const failures = results.filter((r) => !r.ok).length;
    console.log(failures ? `\n${failures} failure(s).` : '\nAll checks passed.');
    process.exitCode = failures ? 1 : 0;
}

main().catch((err) => {
    console.error('desktop check crashed:', err);
    process.exitCode = 1;
});
