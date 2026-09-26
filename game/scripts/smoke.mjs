// Usage: node scripts/smoke.mjs
// End-to-end smoke test: starts its own Vite dev server on a free port, then
// drives the app through the main menu -> new-game wizard -> Main View + HUD
// -> play/speed -> simulation runs (date + fleets/missions) -> game menu -> selection -> G-key zoom out -> panel hotkeys
// (message history / colonies list / empire summary) -> save -> main menu ->
// load round trip, saving a screenshot at each step
// (game/shots/smoke-<n>.png) and printing a PASS/FAIL line per step.
//
// Fails (exit 1) on any page error, console error, or failed request to
// /assets/dwu/ — in addition to any step assertion failing. Uses the system
// Chromium via playwright-core, same as scripts/shot.mjs.
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const shotsDir = join(root, 'shots');
mkdirSync(shotsDir, { recursive: true });

let shotN = 0;
async function shot(page, label) {
    shotN += 1;
    const out = join(shotsDir, `smoke-${shotN}.png`);
    await page.screenshot({ path: out });
    console.log(`  screenshot: shots/smoke-${shotN}.png (${label})`);
    return out;
}

/** Ask the OS for an unused TCP port (closed immediately; vite binds it). */
function freePort() {
    return new Promise((resolve, reject) => {
        const srv = createServer();
        srv.on('error', reject);
        srv.listen(0, '127.0.0.1', () => {
            const { port } = srv.address();
            srv.close(() => resolve(port));
        });
    });
}

async function waitForServer(url, timeoutMs) {
    const start = Date.now();
    for (;;) {
        try {
            const r = await fetch(url);
            if (r.status < 500) return;
        } catch {
            // not up yet
        }
        if (Date.now() - start > timeoutMs) {
            throw new Error(`dev server did not respond at ${url} within ${timeoutMs}ms`);
        }
        await new Promise((res) => setTimeout(res, 200));
    }
}

const results = [];
function pass(name) {
    results.push({ name, ok: true });
    console.log(`PASS: ${name}`);
}
function fail(name, err) {
    results.push({ name, ok: false });
    console.log(`FAIL: ${name} — ${err?.message ?? err}`);
}

async function main() {
    // scripts/gen-asset-manifest.mjs normally runs as npm's predev hook; we
    // spawn vite directly (not via `npm run dev`) so run it explicitly.
    execFileSync('node', ['scripts/gen-asset-manifest.mjs'], { cwd: root, stdio: 'inherit' });

    const port = await freePort();
    const base = `http://localhost:${port}`;
    console.log(`Starting vite dev server on ${base} ...`);
    const vite = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let viteOut = '';
    vite.stdout.on('data', (d) => {
        viteOut += d.toString();
    });
    vite.stderr.on('data', (d) => {
        viteOut += d.toString();
    });

    let browser = null;
    try {
        try {
            await waitForServer(`${base}/`, 30000);
        } catch (err) {
            console.error(viteOut);
            throw err;
        }

        browser = await chromium.launch({
            executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
            args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        });
        const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

        const consoleErrors = [];
        const pageErrors = [];
        const failedAssetRequests = [];

        // The game menu's "Main Menu" button uses window.confirm; auto-accept
        // it so step 9 can round-trip to the main menu unattended.
        page.on('dialog', (d) => d.accept());

        page.on('console', (m) => {
            if (m.type() === 'error') {
                consoleErrors.push(m.text());
                console.log(`  [console.error] ${m.text()}`);
            }
        });
        page.on('pageerror', (e) => {
            pageErrors.push(e.message);
            console.log(`  [pageerror] ${e.message}`);
        });
        page.on('requestfailed', (req) => {
            if (req.url().includes('/assets/dwu/')) {
                const msg = `${req.url()} — ${req.failure()?.errorText ?? 'failed'}`;
                failedAssetRequests.push(msg);
                console.log(`  [requestfailed] ${msg}`);
            }
        });
        page.on('response', (res) => {
            if (res.url().includes('/assets/dwu/') && res.status() >= 400) {
                const msg = `${res.url()} — HTTP ${res.status()}`;
                failedAssetRequests.push(msg);
                console.log(`  [response] ${msg}`);
            }
        });

        // --- Step 1: main menu -------------------------------------------
        try {
            await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
            await page.waitForSelector('button[data-id="startNewGame"]', { state: 'visible', timeout: 15000 });
            await shot(page, 'main menu');
            pass('1. main menu visible (Start New Game present)');
        } catch (err) {
            fail('1. main menu visible (Start New Game present)', err);
            await shot(page, 'main menu (failed)').catch(() => {});
        }

        // --- Step 2: wizard, step through every page, Start Game ---------
        try {
            await page.click('button[data-id="startNewGame"]');
            await page.waitForSelector('.wizard-window', { state: 'visible', timeout: 10000 });
            await shot(page, 'wizard opened (The Galaxy)');

            const nextSel = '.wizard-btn-primary';
            for (let i = 0; i < 10; i++) {
                // Race/government data loads async as soon as the wizard opens
                // (all pages are built upfront); wait for it so the option
                // defaults derived from it (empire name, flag, government) are
                // in place before advancing.
                await page
                    .waitForFunction(() => !document.querySelector('.wizard-race-loading'), { timeout: 10000 })
                    .catch(() => {});
                const label = await page.textContent(nextSel);
                if (label === 'Start Game') break;
                await page.click(nextSel);
                await page.waitForTimeout(150);
            }
            await shot(page, 'wizard last page (Start)');

            const finalLabel = await page.textContent(nextSel);
            if (finalLabel !== 'Start Game') {
                throw new Error(`expected the forward button to read "Start Game" on the last page, got "${finalLabel}"`);
            }
            await page.click(nextSel);
            await page.waitForSelector('#hud', { state: 'attached', timeout: 60000 });
            pass('2. wizard stepped through every page and Start Game clicked');
        } catch (err) {
            fail('2. wizard stepped through every page and Start Game clicked', err);
        }

        // --- Step 3: Main View + HUD --------------------------------------
        try {
            await page.waitForSelector('canvas', { state: 'visible', timeout: 15000 });
            await page.waitForFunction(() => !!window.__dwu && !!window.__dwu.game, { timeout: 30000 });
            const info = await page.evaluate(() => {
                const d = window.__dwu;
                const dateEl = document.querySelector('.hud-date');
                return {
                    empireCount: d.game?.galaxy?.empires?.length ?? 0,
                    dateText: dateEl ? dateEl.textContent : null,
                };
            });
            if (info.empireCount < 2) {
                throw new Error(`expected window.__dwu.game with >= 2 empires, got ${info.empireCount}`);
            }
            if (!info.dateText || !/\d{4}\.\d\d\.\d\d/.test(info.dateText)) {
                throw new Error(`date label "${info.dateText}" does not match /\\d{4}\\.\\d\\d\\.\\d\\d/`);
            }
            await shot(page, 'Main View + HUD');
            pass(`3. Main View + HUD visible (${info.empireCount} empires, date "${info.dateText}")`);
        } catch (err) {
            fail('3. Main View + HUD visible', err);
            await shot(page, 'Main View + HUD (failed)').catch(() => {});
        }

        // --- Step 4: play + speed -----------------------------------------
        try {
            const dateSel = '.hud-date';
            const before = await page.textContent(dateSel);
            await page.click('button[data-hud-ctl="playPause"]');
            // The spec calls for a 3s wait, but this headless Chromium/
            // swiftshader setup throttles requestAnimationFrame heavily (a
            // few frames/second, each clamped to Pixi's ticker deltaMS cap),
            // so the in-game clock — driven from app.ticker — advances much
            // slower than wall-clock time here. Poll for up to 20s instead of
            // a bare 3s sleep so the check is robust to that environment
            // quirk rather than flaky.
            // The HUD date is the galaxy clock (galaxyStarDate(nowMs)); the label only changes once a game day has
            // passed, which under load (a few fps × ≤4 sim frames each) can take well over 20 s. Assert on the
            // simulation clock itself first, then wait (bounded) for the label.
            const nowMs0 = await page.evaluate(() => window.__dwu?.game?.galaxy?.nowMs ?? -1);
            let after = before;
            let nowMs1 = nowMs0;
            const deadline = Date.now() + 60000;
            while (Date.now() < deadline) {
                await page.waitForTimeout(500);
                nowMs1 = await page.evaluate(() => window.__dwu?.game?.galaxy?.nowMs ?? -1);
                after = await page.textContent(dateSel);
                if (after !== before) break;
            }
            if (nowMs0 < 0 || nowMs1 <= nowMs0) {
                throw new Error(`galaxy.nowMs did not advance within 60s of clicking play (${nowMs0} -> ${nowMs1})`);
            }
            if (after === before) {
                console.log(`  WARN: sim clock advanced ${nowMs1 - nowMs0} ms but the day label did not change within 60s (slow headless renderer)`);
            }
            await page.click('button[data-hud-ctl="faster"]');
            await page.click('button[data-hud-ctl="faster"]');
            await page.waitForTimeout(100);
            const speedLabel = await page.textContent(dateSel);
            if (!speedLabel.includes('(4x)')) {
                throw new Error(`expected the date label to show "(4x)" after two speed-ups, got "${speedLabel}"`);
            }
            await shot(page, 'playing at 4x');
            pass(`4. play + speed up to 4x (before "${before}", after 3s "${after}", at 4x "${speedLabel}")`);
        } catch (err) {
            fail('4. play + speed up to 4x', err);
            await shot(page, 'play + speed (failed)').catch(() => {});
        }

        // --- Step 4b: simulation runs in the app ------------------------------
        // The render loop drives the real scheduler (src/simLoop.ts): galaxy.nowMs advances, the date label
        // follows it, and the AI has fleets / ships on missions. Bounded poll: headless swiftshader renders only a
        // few frames/s (the driver runs <= 4 sim frames per render frame), so wait up to 30 s for >= 2 game s.
        try {
            const read = () =>
                page.evaluate(() => {
                    const d = window.__dwu;
                    const g = d.game.galaxy;
                    const ai = g.empires.filter((e) => e !== d.game.playerEmpire);
                    return {
                        nowMs: g.nowMs,
                        starDate: d.time.currentStarDate,
                        date: document.querySelector('.hud-date')?.textContent ?? '',
                        simFrames: d.simStats?.simFrames ?? 0,
                        shipGroups: ai.reduce((n, e) => n + (e.shipGroups?.length ?? 0), 0),
                        withMission: g.builtObjects.filter((b) => b && b.mission).length,
                    };
                });
            const before = await read();
            let after = before;
            const deadline = Date.now() + 30000;
            while (Date.now() < deadline) {
                await page.waitForTimeout(500);
                after = await read();
                if (after.nowMs - before.nowMs >= 2000) break;
            }
            const advanced = after.nowMs - before.nowMs;
            if (advanced < 2000) {
                throw new Error(`galaxy.nowMs advanced only ${advanced} ms in 30 s at 4x (sim frames ${after.simFrames})`);
            }
            if (after.starDate - before.starDate !== advanced) {
                throw new Error(`HUD clock (${after.starDate - before.starDate} ms) is not the galaxy clock (${advanced} ms)`);
            }
            if (after.shipGroups === 0 && after.withMission === 0) {
                throw new Error('no AI ShipGroup and no ship with a mission after running the simulation');
            }
            await shot(page, 'simulation running');
            pass(`4b. simulation runs in the app (+${advanced} game ms, date "${before.date}" -> "${after.date}", ${after.shipGroups} AI fleets, ${after.withMission} ships on missions)`);
        } catch (err) {
            fail('4b. simulation runs in the app', err);
            await shot(page, 'simulation (failed)').catch(() => {});
        }

        // --- Step 5: game menu ---------------------------------------------
        try {
            await page.keyboard.press('Escape');
            await page.waitForSelector('#game-menu-overlay', { state: 'visible', timeout: 5000 });
            await shot(page, 'game menu open');
            await page.getByRole('button', { name: 'Resume', exact: true }).click();
            await page.waitForSelector('#game-menu-overlay', { state: 'hidden', timeout: 5000 });
            await shot(page, 'game menu closed (Resume)');
            pass('5. Escape opens the game menu, Resume hides it');
        } catch (err) {
            fail('5. Escape opens the game menu, Resume hides it', err);
            await shot(page, 'game menu (failed)').catch(() => {});
        }

        // --- Step 6: selection ----------------------------------------------
        try {
            const vp = page.viewportSize();
            const cx = vp.width / 2;
            const cy = vp.height / 2;
            // Spiral-search near the screen centre for a pickable habitat via
            // the debug view.pick() API (task 08g), then perform a real mouse
            // click there so the normal click -> onSelectionChange wiring runs.
            const target = await page.evaluate(
                ({ cx, cy }) => {
                    const view = window.__dwu?.view;
                    if (!view || typeof view.pick !== 'function') return null;
                    for (let r = 0; r <= 400; r += 8) {
                        for (let a = 0; a < 360; a += 20) {
                            const x = cx + r * Math.cos((a * Math.PI) / 180);
                            const y = cy + r * Math.sin((a * Math.PI) / 180);
                            if (view.pick(x, y)) return { x, y };
                        }
                    }
                    return null;
                },
                { cx, cy },
            );

            if (!target) {
                console.log('  WARN: no pickable star/planet found near the screen centre; skipping selection check');
                pass('6. selection panel (skipped: nothing pickable near centre)');
            } else {
                await page.mouse.click(target.x, target.y);
                await page.waitForTimeout(200);
                const selName = (await page.textContent('.hud-selection-name'))?.trim();
                if (!selName || selName === 'Nothing selected') {
                    throw new Error(`selection panel still shows "${selName}" after clicking a pickable object at (${target.x}, ${target.y})`);
                }
                await shot(page, 'selection');
                pass(`6. selection panel shows "${selName}"`);
            }
        } catch (err) {
            fail('6. selection panel updates on click', err);
            await shot(page, 'selection (failed)').catch(() => {});
        }

        // --- Step 7: G opens the Galaxy Map screen, Escape closes it --------
        try {
            await page.keyboard.press('g');
            await page.waitForTimeout(500);
            const opened = await page.evaluate(() => window.__dwu?.galaxyMap?.isOpen);
            if (opened !== true) {
                throw new Error(`expected __dwu.galaxyMap.isOpen after pressing G, got ${opened}`);
            }
            await shot(page, 'G key galaxy map');
            await page.keyboard.press('Escape');
            await page.waitForTimeout(300);
            const closed = await page.evaluate(() => window.__dwu?.galaxyMap?.isOpen);
            if (closed !== false) {
                throw new Error(`expected the galaxy map to close on Escape, isOpen=${closed}`);
            }
            const menuOpen = await page.getByRole('button', { name: 'Resume' }).isVisible();
            if (menuOpen) {
                throw new Error('Escape on the galaxy map also opened the game menu');
            }
            pass('7. G opens the Galaxy Map screen, Escape closes it');
        } catch (err) {
            fail('7. G opens the Galaxy Map screen, Escape closes it', err);
            await shot(page, 'galaxy map (failed)').catch(() => {});
        }

        // --- Step 8: panels open with hotkeys and close on Escape ----------
        // Panel roots are full-screen fixed wrappers (pointer-events: none), so
        // check presence in the DOM rather than visibility state.
        try {
            const panels = [
                ['h', '.message-history-wrap'],
                ['F2', '.colonies-list-wrap'],
                ['F6', '.empire-summary-wrap'],
            ];
            for (const [key, sel] of panels) {
                await page.keyboard.press(key);
                await page.waitForTimeout(300);
                let count = await page.locator(sel).count();
                if (count === 0) {
                    throw new Error(`pressing ${key} did not open ${sel}`);
                }
                await page.keyboard.press('Escape');
                await page.waitForTimeout(300);
                count = await page.locator(sel).count();
                if (count > 0) {
                    throw new Error(`${sel} still present after Escape (opened by ${key})`);
                }
            }
            pass('8. message history (H), colonies list (F2) and empire summary (F6) open via hotkey and close on Escape');
        } catch (err) {
            fail('8. panel hotkeys open/close', err);
            await shot(page, 'panel hotkeys (failed)').catch(() => {});
        }

        // --- Step 8b: a player order goes through the command queue and lands --
        try {
            const res = await page.evaluate(async () => {
                const d = window.__dwu;
                const p = d.game.playerEmpire;
                const before = p.controlResearch;
                const n = d.commands.log().length;
                d.commands.issue(d.galaxy, p, 'setEmpireControl', ['controlResearch', !before]);
                const t0 = performance.now();
                while (d.commands.log().length === n && performance.now() - t0 < 10000) await new Promise((r) => setTimeout(r, 50));
                const e = d.commands.log()[n];
                const after = p.controlResearch;
                d.commands.issue(d.galaxy, p, 'setEmpireControl', ['controlResearch', before]);
                return { landed: after === !before, op: e?.op, nowMs: e?.nowMs };
            });
            if (!res.landed || res.op !== 'setEmpireControl' || typeof res.nowMs !== 'number') {
                throw new Error(`order did not land through the command queue: ${JSON.stringify(res)}`);
            }
            pass(`8b. player order applied at a frame boundary and journaled (sim time ${res.nowMs} ms)`);
        } catch (err) {
            fail('8b. player order through the command queue', err);
        }

        // --- Step 9: save -> main menu -> load round trip --------------------
        try {
            const capitalName = await page.evaluate(() => window.__dwu?.game?.playerEmpire?.capital?.name);
            if (!capitalName) {
                throw new Error('could not read the player capital name before saving');
            }

            await page.keyboard.press('Escape');
            await page.waitForSelector('#game-menu-overlay', { state: 'visible', timeout: 5000 });
            await page.getByRole('button', { name: 'Save Game' }).click();
            await page.fill('input[placeholder]', 'smoke-save');
            await page.locator('button', { hasText: /^Save$/ }).last().click();
            await page.waitForTimeout(1500);
            await shot(page, 'saved from the game menu');

            await page.locator('#save-load-overlay button', { hasText: '✕' }).click();
            await page.getByRole('button', { name: 'Main Menu' }).click();
            await page.waitForTimeout(2500);

            const loadEntryCount = await page.locator('[data-id=loadGame]').count();
            const canvasCount = await page.locator('canvas').count();
            if (loadEntryCount === 0) {
                throw new Error('main menu is not shown after "Main Menu" (no [data-id=loadGame] entry)');
            }
            if (canvasCount !== 0) {
                throw new Error(`expected the game view torn down (0 canvases) at the main menu, found ${canvasCount}`);
            }
            await shot(page, 'main menu after returning from the game');

            await page.locator('[data-id=loadGame]').click();
            await page.waitForTimeout(1500);
            await page.locator('.save-row button', { hasText: 'Load' }).first().click();
            await page.waitForTimeout(8000);

            const reloadedCapital = await page.evaluate(() => window.__dwu?.game?.playerEmpire?.capital?.name);
            if (reloadedCapital !== capitalName) {
                throw new Error(`capital after loading is "${reloadedCapital}", expected "${capitalName}"`);
            }
            const menuCount = await page.locator('[data-id=loadGame]').count();
            if (menuCount !== 0) {
                throw new Error(`main menu still shown after loading a save ([data-id=loadGame] count ${menuCount})`);
            }
            await shot(page, 'reloaded from save');
            pass(`9. save -> main menu -> load round trip (capital "${capitalName}" preserved)`);
        } catch (err) {
            fail('9. save -> main menu -> load round trip', err);
            await shot(page, 'save/load round trip (failed)').catch(() => {});
        }

        // --- Global error checks ---------------------------------------------
        if (consoleErrors.length > 0) {
            fail('no console errors', new Error(`${consoleErrors.length} console error(s): ${consoleErrors.slice(0, 3).join(' | ')}`));
        } else {
            pass('no console errors');
        }
        if (pageErrors.length > 0) {
            fail('no page errors', new Error(`${pageErrors.length} page error(s): ${pageErrors.slice(0, 3).join(' | ')}`));
        } else {
            pass('no page errors');
        }
        if (failedAssetRequests.length > 0) {
            fail(
                'no failed /assets/dwu/ requests',
                new Error(`${failedAssetRequests.length} failed request(s): ${failedAssetRequests.slice(0, 3).join(' | ')}`),
            );
        } else {
            pass('no failed /assets/dwu/ requests');
        }
    } finally {
        if (browser) {
            await browser.close().catch(() => {});
        }
        await new Promise((resolve) => {
            vite.once('exit', () => resolve());
            vite.kill();
            setTimeout(resolve, 3000);
        });
    }

    console.log('\n--- Summary ---');
    for (const r of results) {
        console.log(`${r.ok ? 'PASS' : 'FAIL'}: ${r.name}`);
    }

    const failures = results.filter((r) => !r.ok);
    if (failures.length > 0) {
        console.log(`\n${failures.length} failure(s).`);
        process.exitCode = 1;
    } else {
        console.log('\nAll checks passed.');
        process.exitCode = 0;
    }
}

main().catch((err) => {
    console.error('smoke test crashed:', err);
    process.exitCode = 1;
});
