#!/usr/bin/env node
// Sim worker smoke (docs/sim-worker.md §6, §9 chunk 1): boot a game with ?simWorker=1 in headless Chromium against a
// running dev server and check that it runs, pauses at once (the optimistic pause), changes speed and takes a move
// order; that the `__dwu` debug surface works (sim / simBudget stand-ins, the worker's command log); save screenshots at
// four zooms. Other boots (chunk 1):
//   --tutorial   main menu → Tutorials → Start → Continue … → "Play This Game" (the tutorial game in the worker)
//   --menuload   save a worker game, then main menu → Load Game → open that .dwusave (the worker parses it)
//   --generate   ?seed=1 without ?autostart (the bare generateGalaxy boot)
//   node scripts/simworker-smoke.mjs <base url> [--load=/dev-saves/x.dwusave] [--out=shots/simworker] [--inthread]
//                                               [--tutorial | --menuload | --generate]
//        [--gpu=swiftshader|egl] [--qs=simPace=0]
//        [--detect-writes[=all]]   (dev-only replica write detector, src/simworker/writeDetector.ts: prints what it found)
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:5173/';
const opt = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const flag = (k) => process.argv.includes(`--${k}`);
const load = opt('load', '');
const inThread = flag('inthread');
const mode = flag('tutorial') ? 'tutorial' : flag('menuload') ? 'menuload' : flag('generate') ? 'generate' : 'game';
const out = opt('out', `shots/simworker${mode === 'game' ? '' : `-${mode}`}${inThread ? '-inthread' : ''}`);
mkdirSync(out, { recursive: true });
const detectArg = process.argv.find((a) => a === '--detect-writes' || a.startsWith('--detect-writes='));
const detectWrites = detectArg === undefined ? '' : detectArg.includes('=') ? detectArg.split('=')[1] : '1';
const qs = opt('qs', '');
const sw = `simWorker=${inThread ? 0 : 1}${detectWrites ? `&detectWrites=${detectWrites}` : ''}${qs ? `&${qs}` : ''}`;
const gpuArgs = opt('gpu', 'swiftshader') === 'egl' ? ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: gpuArgs });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.stack ?? e.message}`));
let failed = 0;
const check = (ok, what) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok) failed++;
};
// The replica write detector's findings so far (checkAll first), printed and saved as JSON.
async function dumpWrites(when) {
    if (!detectWrites || inThread) return;
    const found = await page.evaluate(() => {
        const det = window.__dwuWriteDetector;
        if (!det) return null;
        det.checkAll();
        return { writes: det.writes(), summary: det.summary() };
    });
    check(found !== null, `replica write detector installed (${when})`);
    if (found === null) return;
    console.log(`replica writes, ${when} (${found.writes.filter((w) => !w.allowed).length} unexpected keys):\n${found.summary}`);
    writeFileSync(`${out}/replica-writes.json`, JSON.stringify(found.writes, null, 1));
    console.log(`saved ${out}/replica-writes.json`);
}
const waitGame = () => page.waitForFunction(() => window.__dwu?.time !== undefined && window.__dwu?.view !== undefined, null, { timeout: 600000 });
const now = () => page.evaluate(() => window.__dwu.galaxy.nowMs);

/** Pause from a running game and watch the next frames: the clock must stand still from the first one. */
async function checkPauseIsInstant() {
    await page.evaluate(() => { window.__dwu.time.paused = false; });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(async () => {
        const d = window.__dwu;
        const frame = () => new Promise((res) => requestAnimationFrame(() => res()));
        await frame();
        const drawn = () => d.view?.renderTime?.renderNowMs ?? d.galaxy.nowMs;
        const before = d.galaxy.nowMs;
        const drawnBefore = drawn();
        d.time.paused = true;
        const seen = [];
        for (let i = 0; i < 60; i++) {
            await frame();
            seen.push({ now: d.galaxy.nowMs, drawn: drawn(), held: d.simWorker?.core.pauseHeld ?? false });
        }
        const st = d.simWorker?.core.stats;
        // Worker mode with render pacing (clientCore.ts StepPacer, on unless ?simPace=0): the steps in the playout buffer
        // were simulated before the press, so the replica's clock lands past it; what stops at the press is the picture.
        const paced = d.simWorker != null && new URLSearchParams(location.search).get('simPace') !== '0';
        return { paced, before, first: seen[0].now, heldFrames: seen.filter((s) => s.held).length, last: seen[seen.length - 1].now, drawnBefore, drawnFirst: seen[0].drawn, drawnLast: seen[seen.length - 1].drawn, ackMs: st?.lastPauseAckMs ?? null, inFlight: st?.lastPauseInFlightSteps ?? null };
    });
    // In-thread the clock stops dead. In worker mode the replica is held from the press until the worker's ack, then
    // takes the steps the worker ran before the pause reached it (1–2 at most: up to ~35 game ms at 1x); on a slow
    // renderer (headless swiftshader draws ~8 fps) the ack lands inside the first frame. Paced, the drawn game time
    // (MainView.renderTime.renderNowMs) is checked instead: it advances at most a frame past the press, then stands.
    const slack = inThread ? 0 : 2 * 17;
    if (r.paced) check(r.drawnFirst - r.drawnBefore <= slack && Math.abs(r.drawnLast - r.drawnFirst) < 0.5, `pause is instant: the drawn time stops at the press (${r.drawnBefore.toFixed(0)} → ${r.drawnFirst.toFixed(0)} → ${r.drawnLast.toFixed(0)})`);
    else check(r.first - r.before <= slack && r.last === r.first, `pause is instant: the clock stops at the press (${r.before} → ${r.first}, then still)`);
    console.log(`     pause: held ${r.heldFrames} frame(s), ack ${r.ackMs === null ? '-' : r.ackMs.toFixed(1)} ms, ${r.inFlight ?? 0} in-flight step(s) landed (+${r.last - r.before} game ms on the replica clock)`);
    await page.waitForTimeout(800);
    const t4 = await now();
    await page.waitForTimeout(1500);
    check((await now()) === t4, 'pause holds the clock');
}

async function checkRuns(label, ms = 3000) {
    await page.evaluate(() => { window.__dwu.time.paused = false; window.__dwu.time.speed = 1; });
    const t0 = await now();
    await page.waitForTimeout(ms);
    const t1 = await now();
    check(t1 - t0 > ms / 2, `${label}runs at 1x: ${(t1 - t0).toFixed(0)} game ms in ${ms / 1000} s`);
    return t1 - t0;
}

async function shots(names) {
    for (const [name, zoom] of names) {
        await page.evaluate((z) => {
            const c = window.__dwu.camera;
            const cap = window.__dwu.game?.playerEmpire?.capital;
            if (cap) c.centerOn(cap.xpos, cap.ypos);
            c.zoom = z === null ? c.minZoom : c.clampZoom(z);
        }, zoom);
        await page.evaluate(() => { window.__dwu.time.paused = false; });
        await page.waitForTimeout(1500);
        await page.screenshot({ path: `${out}/${name}.png` });
        console.log(`saved ${out}/${name}.png`);
    }
}

async function checkPacing() {
    // Render pacing (docs/sim-worker.md §9 chunk 2): the drawn game time (RenderTime.renderNowMs) should advance with the
    // wall clock — never backwards, without stalls or bursts as step messages arrive unevenly. Per rAF: the drawn
    // time's advance against the wall time × speed; the mean absolute error and the worst frame.
    {
        await page.evaluate(() => { window.__dwu.time.speed = 1; window.__dwu.time.paused = false; });
        await page.waitForTimeout(1000);
        const pacing = await page.evaluate(() => new Promise((resolve) => {
            const out = [];
            let last = null;
            const t0 = performance.now();
            const tick = (now) => {
                // MainView.renderTime: the sample the view drew this frame (the app ticker ran before this callback).
                const drawn = window.__dwu.view?.renderTime?.renderNowMs ?? null;
                if (drawn !== null && last !== null) out.push([now - last.wall, drawn - last.drawn]);
                if (drawn !== null) last = { wall: now, drawn };
                if (now - t0 < 3000) requestAnimationFrame(tick);
                else resolve(out);
            };
            requestAnimationFrame(tick);
        }));
        if (pacing.length > 10) {
            // Against the average rate (the sim may run slower than real time on a loaded machine): smoothness.
            const rate = pacing.reduce((a, [, d]) => a + d, 0) / pacing.reduce((a, [w]) => a + w, 0);
            const err = pacing.map(([w, d]) => Math.abs(d - rate * w));
            const back = pacing.filter(([, d]) => d < 0).length;
            const still = pacing.filter(([, d]) => d === 0).length;
            const mean = err.reduce((a, b) => a + b, 0) / err.length;
            const sorted = [...err].sort((a, b) => a - b);
            console.log(`render pacing over ${pacing.length} frames at ${rate.toFixed(2)}× real time: |drawn − wall × rate| per frame mean ${mean.toFixed(2)} ms, p95 ${sorted[Math.floor(sorted.length * 0.95)].toFixed(2)} ms, max ${sorted[sorted.length - 1].toFixed(2)} ms; frames standing still ${still}; backwards ${back}`);
            check(back === 0, 'drawn game time never goes backwards');
        } else console.log(`render pacing: not measured (${pacing.length} samples)`);
    }
}

async function combatViews() {
    // Combat and hyperjumps at system zoom (docs/sim-worker.md §9 chunk 2: shots, explosions, shield strikes, jump
    // flashes and their sounds on the replica): the first of the player's ships (else any) firing / about to jump.
    for (const [name, kind] of [['combat', 'battle'], ['hyperjump', 'jump']]) {
        const found = await page.evaluate((k) => {
            const d = window.__dwu;
            const p = d.game.playerEmpire;
            const ok = (b) => b && !b.hasBeenDestroyed && (k === 'battle' ? b.weapons.some((w) => w && w.distanceTravelled >= 0) : b.hyperjumpPrepare || b.hyperEnterStartAnimation || b.hyperjumpAboutToEnter);
            const list = d.galaxy.builtObjects.filter(ok);
            const b = list.find((x) => x.empire === p) ?? list[0];
            if (!b) return null;
            d.camera.centerOn(b.xpos, b.ypos);
            d.camera.zoom = d.camera.clampZoom(0.5);
            return { id: b.builtObjectID, own: b.empire === p, n: list.length };
        }, kind);
        if (found === null) {
            console.log(`${name}: no ship found`);
            continue;
        }
        await page.waitForTimeout(2500);
        await page.screenshot({ path: `${out}/${name}.png` });
        console.log(`saved ${out}/${name}.png (ship ${found.id}${found.own ? ', own' : ''}; ${found.n} candidates)`);
    }
}

try {
    if (mode === 'game') {
        await page.goto(`${base}?${load ? `load=${encodeURIComponent(load)}` : 'autostart=1'}&${sw}`);
        await waitGame();
        check(inThread || (await page.evaluate(() => window.__dwu.simWorker != null)), 'game runs in the worker');
        const d1 = await checkRuns('');
        await page.evaluate(() => { window.__dwu.time.speed = 4; });
        await page.waitForTimeout(500);
        const t2 = await now();
        await page.waitForTimeout(3000);
        const t3 = await now();
        check(t3 - t2 > 2 * d1, `faster at 4x: ${(t3 - t2).toFixed(0)} game ms in 3 s`);
        await page.evaluate(() => { window.__dwu.time.speed = 1; });
        await checkPauseIsInstant();
        // The debug stand-ins (worker mode) / the real driver (in-thread).
        const dbg = await page.evaluate(async () => {
            const d = window.__dwu;
            const remote = d.sim?.remote === true;
            if (remote) await d.sim.refresh();
            const maxFrames = d.sim.maxFrames;
            d.simBudget.budgetMsAt1x = d.simBudget.budgetMsAt1x; // a write goes through
            const before = d.galaxy.nowMs;
            d.time.paused = false;
            await new Promise((r) => requestAnimationFrame(() => r())); // the loop hands the driver the clock
            const ran = await d.sim.advance(500); // await of a number is the number in-thread
            d.time.paused = true;
            await new Promise((r) => setTimeout(r, 300));
            return { remote, maxFrames, ran, moved: d.galaxy.nowMs - before };
        });
        check(typeof dbg.maxFrames === 'number', `__dwu.sim.maxFrames reads ${dbg.maxFrames}${dbg.remote ? ' (worker stand-in)' : ''}`);
        check(dbg.ran > 0 && dbg.moved > 0, `__dwu.sim.advance(500) ran ${dbg.ran} step(s), the clock moved ${dbg.moved} game ms`);
        // A move order through the command queue (on the replica in worker mode).
        const order = await page.evaluate(() => {
            const d = window.__dwu;
            const p = d.game.playerEmpire;
            const ship = p.builtObjects.find((b) => b && !b.hasBeenDestroyed && b.currentSpeed !== undefined && b.role !== undefined && b.parentHabitat !== null && b.design && b.topSpeed > 0);
            const target = d.galaxy.habitats.filter((h) => h.parent !== null).sort((a, b) => Math.hypot(b.xpos - ship.xpos, b.ypos - ship.ypos) - Math.hypot(a.xpos - ship.xpos, a.ypos - ship.ypos))[200];
            d.commands.issue(d.galaxy, p, 'rightClickOrder', [ship, d.commands.moveOrder(target), { ctrl: false, alt: false }, 1], (r) => { window.__moveResult = r?.kind ?? 'applied'; });
            d.time.paused = false;
            window.__moveShip = ship;
            window.__moveTarget = target;
            return { id: ship.builtObjectID, from: [ship.xpos, ship.ypos], target: target.name };
        });
        await page.waitForTimeout(4000);
        const moved = await page.evaluate(async () => {
            const s = window.__moveShip, t = window.__moveTarget;
            const log = await window.__dwu.commands.log();
            return { result: window.__moveResult ?? null, pos: [s.xpos, s.ypos], logged: log.some((e) => e.source === 'player' && e.op === 'rightClickOrder'), logLength: log.length, target: t.name };
        });
        check(moved.result !== null, `move order applied (reply: ${moved.result})`);
        check(moved.logged, `__dwu.commands.log() has the order (${moved.logLength} entries)`);
        check(Math.hypot(moved.pos[0] - order.from[0], moved.pos[1] - order.from[1]) > 0, `ship ${order.id} moves toward ${order.target}: ${JSON.stringify(order.from.map(Math.round))} → ${JSON.stringify(moved.pos.map(Math.round))}`);
        await checkPacing();
        await dumpWrites('after the move order');
        await page.evaluate(() => { window.__dwu.time.paused = true; });
        await shots([['galaxy', null], ['sector', 0.02], ['system', 0.25], ['planet', 1.5]]);
        await combatViews();
    } else if (mode === 'tutorial') {
        await page.goto(`${base}?${sw}`);
        await page.click('.main-menu-item[data-id="tutorials"]');
        await page.waitForSelector('.tutorials-start-btn', { timeout: 60000 });
        await page.click('.tutorials-start-btn');
        await waitGame();
        check(inThread || (await page.evaluate(() => window.__dwu.simWorker != null)), 'tutorial game runs in the worker');
        await page.waitForSelector('.tutorial-window .tutorial-btn-primary', { timeout: 60000 });
        check(await page.evaluate(() => window.__dwu.time.paused === true), 'the tutorial game starts paused');
        await page.screenshot({ path: `${out}/tutorial-start.png` });
        for (let i = 0; i < 200; i++) {
            const label = await page.textContent('.tutorial-window .tutorial-btn-primary');
            if (label?.includes('Play This Game')) break;
            await page.click('.tutorial-window .tutorial-btn-primary');
        }
        check((await page.textContent('.tutorial-window .tutorial-btn-primary'))?.includes('Play This Game') === true, 'the tutorial reaches "Play This Game"');
        const t0 = await now();
        await page.click('.tutorial-window .tutorial-btn-primary');
        check(await page.evaluate(() => window.__dwu.time.paused === false), '"Play This Game" resumes the clock');
        await page.waitForTimeout(3000);
        const t1 = await now();
        check(t1 - t0 > 1500, `the tutorial game runs: ${(t1 - t0).toFixed(0)} game ms in 3 s`);
        await checkPauseIsInstant();
        await page.screenshot({ path: `${out}/tutorial-playing.png` });
        console.log(`saved ${out}/tutorial-start.png, ${out}/tutorial-playing.png`);
    } else if (mode === 'menuload') {
        // A save to load: a worker game run for a moment.
        await page.goto(`${base}?autostart=1&simWorker=1`);
        await waitGame();
        await page.evaluate(() => { window.__dwu.time.paused = false; });
        await page.waitForTimeout(2000);
        await page.evaluate(() => { window.__dwu.time.paused = true; });
        await page.waitForTimeout(500);
        const saved = await page.evaluate(async () => {
            const text = await window.__dwu.simWorker.save();
            const dg = await window.__dwu.simWorker.digest();
            return { text, nowMs: dg.nowMs, digest: dg.digest };
        });
        const file = resolve(out, 'menuload.dwusave');
        writeFileSync(file, saved.text);
        console.log(`     saved ${Math.round(saved.text.length / 1024)} KB at nowMs ${saved.nowMs} to ${file}`);
        await page.goto(`${base}?${sw}`);
        await page.click('.main-menu-item[data-id="loadGame"]');
        await page.waitForSelector('.save-load-file-input', { state: 'attached', timeout: 60000 });
        await page.setInputFiles('.save-load-file-input', file);
        await waitGame();
        check(inThread || (await page.evaluate(() => window.__dwu.simWorker != null)), 'the loaded game runs in the worker');
        check((await now()) === saved.nowMs, `loaded at the saved instant (${saved.nowMs})`);
        if (!inThread) {
            const dg = await page.evaluate(async () => (await window.__dwu.simWorker.digest()).digest);
            check(dg === saved.digest, 'the loaded game has the saved state digest');
        }
        check(await page.evaluate(() => window.__dwu.time.paused === true), 'the loaded game keeps the saved pause');
        await checkRuns('the loaded game ');
        await checkPauseIsInstant();
        await shots([['loaded-sector', 0.02]]);
    } else {
        await page.goto(`${base}?seed=1&${sw}`);
        await waitGame();
        check(inThread || (await page.evaluate(() => window.__dwu.simWorker != null)), 'the generated galaxy runs in the worker');
        // The bare galaxy's whole-map view draws a frame every few seconds under headless swiftshader (in-thread too):
        // watch the clock for longer.
        await checkRuns('', 20000);
        await checkPauseIsInstant();
        await shots([['generated-galaxy', null]]);
    }
    await dumpWrites('end of run');
    if (!inThread) {
        const s = await page.evaluate(() => {
            const st = window.__dwu.simStats;
            return { frames: st.renderFrames, deltas: st.deltas, hot: st.hotApplyMs / Math.max(1, st.renderFrames), cold: st.coldPumpMs / Math.max(1, st.renderFrames), maxHot: st.maxHotApplyMs, maxCold: st.maxColdPumpMs, workerStep: st.workerStepMs, workerDiff: st.workerDiffMs, kb: st.deltaBytes / 1024, backlog: st.coldBacklog, pauseHolds: st.pauseHolds, lastPauseAckMs: st.lastPauseAckMs };
        });
        console.log(`sync stats: ${JSON.stringify(s)}`);
    }
} finally {
    await browser.close();
    const errors = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
    for (const l of errors.slice(0, 30)) console.log(l);
    if (errors.length > 0) failed++;
    console.log(failed === 0 ? 'SMOKE OK' : `SMOKE FAILED (${failed})`);
    process.exitCode = failed === 0 ? 0 : 1;
}
