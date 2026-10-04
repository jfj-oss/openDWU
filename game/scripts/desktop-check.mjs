// Usage: node scripts/desktop-check.mjs [--app=release/dwu-linux-x64/dwu] [--port=9333]
//                                       [--socket=dwu-pkg] [--compare-dev] [--unpacked]
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
//   4. the simulation runs in its Web Worker (a command and its reply, a worker save); ?simWorker=0 runs in-thread
//   5. F5 (Diplomacy) and F8 (Ship Designs) open and close on Escape
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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
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
        await page.goto(`${base}index.html?autostart=1`, { waitUntil: 'domcontentloaded' });
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

    // The simulation runs in its Web Worker by default (docs/sim-worker.md §6): the module worker loads from dist/
    // (dwu://app/assets/worker-*.js), a command goes through it and its reply comes back, and the worker saves.
    try {
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
            const dg = await sw.digest();
            return { worker: true, reply, saveKb: text ? Math.round(text.length / 1024) : 0, stepSerial: dg.stepSerial };
        });
        if (!w.worker) throw new Error('window.__dwu.simWorker is null: the game runs in-thread');
        if (w.reply !== 'Desktop Worker Check') throw new Error(`the command's reply did not reach the replica (${w.reply})`);
        if (!(w.saveKb > 0)) throw new Error('the worker did not save');
        ok(`the simulation runs in the worker (a command's reply reaches the replica; worker save ${w.saveKb} KB at step ${w.stepSerial})`);
    } catch (err) {
        bad('the simulation runs in the worker', err);
    }
    // The in-thread fallback still boots (?simWorker=0).
    try {
        await page.goto(`${base}index.html?autostart=1&simWorker=0`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.__dwu?.game?.galaxy && window.__dwu?.time !== undefined, null, { timeout: 90000 });
        const inThread = await page.evaluate(() => window.__dwu.simWorker == null);
        if (!inThread) throw new Error('?simWorker=0 still runs a worker');
        const t0 = await page.evaluate(() => window.__dwu.galaxy.nowMs);
        await page.evaluate(() => { window.__dwu.time.paused = false; });
        await page.waitForTimeout(3000);
        const t1 = await page.evaluate(() => window.__dwu.galaxy.nowMs);
        if (!(t1 > t0)) throw new Error(`the in-thread clock did not move (${t0} -> ${t1})`);
        ok(`?simWorker=0 runs in-thread (nowMs ${t0} -> ${t1})`);
        await page.goto(`${base}index.html?autostart=1`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.__dwu?.game?.galaxy, null, { timeout: 90000 });
        await page.waitForTimeout(1500);
    } catch (err) {
        bad('?simWorker=0 in-thread fallback', err);
    }

    for (const [key, sel, label] of [
        ['F5', '[data-ow="diplomacy"]', 'f5-diplomacy'],
        ['F8', '[data-ow="designs"]', 'f8-ship-designs'],
    ]) {
        try {
            await page.keyboard.press(key);
            await page.waitForSelector(sel, { state: 'attached', timeout: 5000 });
            await page.waitForTimeout(1000); // let images in the screen load
            await shot(label);
            await page.keyboard.press('Escape');
            await page.waitForSelector(sel, { state: 'detached', timeout: 5000 });
            ok(`${key} opens ${sel}, Escape closes it`);
        } catch (err) {
            bad(`${key} opens ${sel}`, err);
            await shot(`${label}-failed`).catch(() => {});
        }
    }
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
    if (unpacked && !existsSync(join(root, 'dist', 'index.html'))) throw new Error('dist/index.html not found — run `npm run build` first');
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
            [...appArgs, '--ozone-platform=wayland', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${userDataDir}`],
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
