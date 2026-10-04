// Usage: node scripts/desktop-check.mjs [--app=release/dwu-linux-x64/dwu] [--port=9333]
//                                       [--socket=dwu-pkg] [--compare-dev]
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
//   6. ?simWorker=1: the module Web Worker loads under dwu:// and the replica galaxy advances
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
const { stripColorProfile, isProfiledImagePath } = createRequire(import.meta.url)('../desktop/colorProfile.cjs');
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
const appBin = resolve(root, args.app ?? 'release/dwu-linux-x64/dwu');
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

    // Web Worker: ?simWorker=1 runs the sim in a module worker (dist/assets/worker-*.js) loaded over the same scheme.
    try {
        const workerUrls = [];
        page.on('worker', (w) => workerUrls.push(w.url()));
        await page.goto(`${base}index.html?autostart=1&simWorker=1`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.__dwu?.game?.galaxy && window.__dwu.simWorker != null, null, { timeout: 120000 });
        // Pixi also starts blob: workers (image decoding); the sim worker is the script file from dist/assets/.
        const simUrls = workerUrls.filter((u) => !u.startsWith('blob:'));
        if (simUrls.length === 0) throw new Error(`no sim worker script was loaded (workers: ${workerUrls.slice(0, 3).join(' ')})`);
        if (!simUrls.every((u) => u.startsWith(base) && /\/assets\/worker-[^/]+\.js$/.test(u))) throw new Error(`unexpected worker script: ${simUrls.join(' ')}`);
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

async function checkPackaged(results) {
    if (!existsSync(appBin)) throw new Error(`${appBin} not found — run \`npm run package:linux\` first`);
    const runtimeDir = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`;
    const socketPath = join(runtimeDir, socketName);
    if (existsSync(socketPath)) throw new Error(`Wayland socket ${socketPath} already exists (another check running?)`);
    console.log(`App: ${appBin}\nDWU_DIR: ${dwuDir}\nWayland socket: ${socketName}, CDP port ${cdpPort}`);

    const userDataDir = mkdtempSync(join(os.tmpdir(), 'dwu-desktop-check-'));
    let kwin = null;
    let app = null;
    let browser = null;
    let appLog = '';
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

        const appEnv = { ...process.env, XDG_RUNTIME_DIR: runtimeDir, WAYLAND_DISPLAY: socketName, DWU_DIR: dwuDir };
        delete appEnv.DISPLAY;
        app = spawn(
            appBin,
            ['--ozone-platform=wayland', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${userDataDir}`],
            { env: appEnv, stdio: ['ignore', 'pipe', 'pipe'] },
        );
        app.stdout.on('data', (d) => (appLog += d));
        app.stderr.on('data', (d) => (appLog += d));
        console.log(`  app pid ${app.pid}`);
        await waitFor(
            async () => {
                if (app.exitCode !== null || app.signalCode) throw new Error('app exited');
                return (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).ok;
            },
            30000,
            'CDP endpoint',
        ).catch((err) => {
            throw new Error(`${err.message}\n--- app log ---\n${appLog}`);
        });

        browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
        const ctx = browser.contexts()[0];
        const page = ctx.pages()[0] ?? (await ctx.waitForEvent('page', { timeout: 15000 }));
        collector = watchPage(page, 'pkg');
        await runFlow(page, 'dwu://app/', 'pkg', results);
    } finally {
        if (browser) await browser.close().catch(() => {});
        await stop(app, 'app');
        await stop(kwin, 'kwin_wayland');
        rmSync(userDataDir, { recursive: true, force: true });
        const mainErrors = appLog.split('\n').filter((l) => /dwu:\/\/ handler error|DWU_DIR=|No DW:U install/.test(l));
        for (const l of mainErrors) console.log(`  [main] ${l}`);
    }
    return collector ? checkCollector(collector, 'pkg', results, { requireScheme: 'dwu://app/assets/dwu/' }) : new Set();
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
