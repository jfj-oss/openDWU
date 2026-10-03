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
//        [--gpu=swiftshader|egl] [--qs=renderClock=0]
//        [--detect-writes[=all]]   (dev-only replica write detector, src/simworker/writeDetector.ts: prints what it found;
//                                   with --inthread, the save-text probe of the UI tour)
//        [--ui-tour]               (the UI tour without the detector: select, hover, right-click, every panel and screen)
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
// UI tour (with --detect-writes, or --ui-tour): with the game paused, select a ship, the capital (and its Build page), an
// unowned body (a page that draws galaxy.rnd), a fleet; hover and Ctrl-right-click a body (the action menu); open every
// left-sidebar panel and every top-bar screen. Worker mode: the write detector watches the replica, and the replica's
// digest must equal the worker's afterwards. In-thread (--inthread): the save text (every object, the side tables, the
// RNG state) is compared before and after each step; a change with no journaled command applied in that step is a UI
// write outside the command queue (docs/sim-worker.md §8), and fails the run.
const uiTour = detectWrites !== '' || flag('ui-tour');
async function installSaveProbe() {
    await page.evaluate(async () => {
        const { galaxyToJSON } = await import('/src/sim/save/galaxySave.ts');
        // Walk two encoded saves (graphCodec.ts: {$s, $v} instances, arrays, $map / $set, $ref) and name the first
        // differences by `Class.field` (the write detector's keys).
        const diff = (a, b, shapesA, shapesB, out, key, path) => {
            if (out.length >= 60) return;
            if (a === b) return;
            if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
                out.push({ key, path, a: JSON.stringify(a)?.slice(0, 80), b: JSON.stringify(b)?.slice(0, 80) });
                return;
            }
            if (Array.isArray(a) || Array.isArray(b)) {
                if (!Array.isArray(a) || !Array.isArray(b)) return void out.push({ key, path, a: 'array?', b: 'array?' });
                if (a.length !== b.length) out.push({ key: `${key}[]`, path, a: `length ${a.length}`, b: `length ${b.length}` });
                for (let i = 0; i < Math.min(a.length, b.length); i++) diff(a[i], b[i], shapesA, shapesB, out, `${key}[]`, `${path}[${i}]`);
                return;
            }
            if ('$s' in a && '$s' in b) {
                const sa = shapesA[a.$s], sb = shapesB[b.$s];
                if (sa.join() !== sb.join()) return void out.push({ key: `${sa[0]}`, path, a: `shape ${sa.slice(1).join(',')}`.slice(0, 200), b: `shape ${sb.slice(1).join(',')}`.slice(0, 200) });
                for (let i = 0; i < a.$v.length; i++) diff(a.$v[i], b.$v[i], shapesA, shapesB, out, `${sa[0]}.${sa[i + 1]}`, `${path}.${sa[i + 1]}`);
                return;
            }
            const ka = Object.keys(a), kb = Object.keys(b);
            if (ka.join() !== kb.join()) return void out.push({ key: `${key}{}`, path, a: ka.join(',').slice(0, 120), b: kb.join(',').slice(0, 120) });
            for (const k of ka) diff(a[k], b[k], shapesA, shapesB, out, k.startsWith('$') ? key : `${key}.${k}`, `${path}.${k}`);
        };
        window.__saveProbe = {
            snap() {
                // A fresh encoded tree (plain data, nothing shared with the game).
                return galaxyToJSON(window.__dwu.galaxy);
            },
            mark() {
                window.__saveProbePrev = this.snap();
            },
            /** Differences since mark() (then marks again). */
            check() {
                const prev = window.__saveProbePrev;
                const next = this.snap();
                const out = [];
                diff(prev.galaxy, next.galaxy, prev.shapes, next.shapes, out, 'Galaxy', '$');
                diff(prev.sideTables, next.sideTables, prev.shapes, next.shapes, out, 'sideTables', 'sideTables');
                diff(prev.territory, next.territory, prev.shapes, next.shapes, out, 'territory', 'territory');
                window.__saveProbePrev = next;
                return out;
            },
        };
    });
}
/** The command-log entries (player ops) so far. */
const logOps = () => page.evaluate(async () => (await window.__dwu.commands.log()).filter((e) => e.source === 'player').map((e) => e.op));
const tourWrites = [];
async function tourStep(name, act, settleMs = 1500) {
    const before = (await logOps()).length;
    await act();
    await page.waitForTimeout(settleMs);
    const ops = (await logOps()).slice(before);
    if (inThread) {
        const d = await page.evaluate(() => window.__saveProbe.check());
        const keys = [...new Set(d.map((x) => x.key))];
        if (d.length > 0) tourWrites.push({ step: name, ops, keys, first: d.slice(0, 8) });
        const ok = d.length === 0 || ops.length > 0;
        check(ok, `ui tour: ${name}: ${d.length === 0 ? 'no state change' : `state changed (${keys.slice(0, 8).join(', ')})`}${ops.length ? `; journaled ${ops.join(', ')}` : ''}`);
        if (!ok) for (const x of d.slice(0, 6)) console.log(`       ${x.path}: ${x.a} → ${x.b}`);
    } else console.log(`     ui tour: ${name}${ops.length ? ` (journaled ${ops.join(', ')})` : ''}`);
}
async function runUiTour() {
    await page.evaluate(() => { window.__dwu.time.paused = true; });
    await page.waitForTimeout(1500);
    if (inThread) {
        await installSaveProbe();
        await page.evaluate(() => window.__saveProbe.mark());
    }
    await tourStep('idle (HUD timers, money panel)', async () => {}, 2000);
    await page.evaluate(async () => { window.__SR = (await import('/src/sim/builtObjectTypes.ts')).BuiltObjectSubRole; });
    const select = (expr) => page.evaluate(async (e) => {
        const hud = await import('/src/ui/hud.ts');
        const d = window.__dwu;
        const p = d.game.playerEmpire;
        const sys = d.galaxy.systems[p.capital.systemIndex];
        const pick = new Function('d', 'p', 'sys', `return (${e});`)(d, p, sys);
        if (!pick) return null;
        if (pick.ships !== undefined && pick.leadShip !== undefined) hud.selectShipGroup(pick, true);
        else hud.selectStellarObject(pick, true);
        return pick.name ?? '?';
    }, expr);
    const enabledButtons = () => page.$$('.order-actions .order-action-btn:not([disabled]):not(.order-action-empty):not(.order-action-extra)');
    await tourStep('select a construction ship', () => select('p.builtObjects.find((b) => b && b.subRole === window.__SR.ConstructionShip && b.builtAt === null && b.topSpeed > 0) ?? p.builtObjects.find((b) => b && b.builtAt === null && b.topSpeed > 0)'));
    // Hover over an unowned body with the ship selected (the default-order hint), then Ctrl-right-click it (the menu).
    const at = await page.evaluate(() => {
        const d = window.__dwu;
        const p = d.game.playerEmpire;
        const sys = d.galaxy.systems[p.capital.systemIndex];
        const h = sys.habitats.find((x) => x.empire === null && x.category !== 0) ?? sys.systemStar;
        window.__tourBody = h;
        d.camera.centerOn(h.xpos, h.ypos);
        d.camera.zoom = d.camera.clampZoom(1 / 200);
        const s = d.camera.worldToScreen(h.xpos, h.ypos);
        const r = document.querySelector('canvas').getBoundingClientRect();
        return { x: r.left + s.x, y: r.top + s.y, name: h.name };
    });
    await page.waitForTimeout(500);
    await tourStep(`hover over ${at.name}`, async () => {
        await page.mouse.move(at.x - 3, at.y - 3);
        await page.mouse.move(at.x, at.y);
    });
    await tourStep(`Ctrl-right-click ${at.name} (action menu)`, async () => {
        await page.keyboard.down('Control');
        await page.mouse.down({ button: 'right' });
        await page.mouse.up({ button: 'right' });
        await page.keyboard.up('Control');
        await page.waitForSelector('.order-menu-root .order-menu-item', { timeout: 10000 }).catch(() => {});
        const rows = await page.$$('.order-menu-root .order-menu-panel:first-child .order-menu-item');
        for (const row of rows.slice(0, 6)) await row.hover();
    });
    await tourStep('close the action menu', () => page.keyboard.press('Escape'));
    await tourStep('select the capital', () => select('p.capital'));
    await tourStep('capital: Build page', async () => {
        const b = await page.$('.order-actions .order-action-btn.order-style-build:not([disabled])');
        if (b) await b.click();
    });
    await tourStep('select an unowned body (its page draws galaxy.rnd)', () => select('window.__tourBody'));
    await tourStep('select a fleet', () => select('p.shipGroups?.[0] ?? null'));
    await tourStep('select a foreign colony', () => select('d.galaxy.habitats.find((h) => h.empire && h.empire !== p && h.empire !== d.galaxy.independentEmpire && h.population?.totalAmount > 0) ?? null'));
    await tourStep('select an independent colony', () => select('d.galaxy.habitats.find((h) => h.empire === d.galaxy.independentEmpire && h.population?.totalAmount > 0) ?? null'));
    // Every page button of the current ship selection (each opens a page: no order is given by a page button).
    await tourStep('ship pages', async () => {
        await select('p.builtObjects.find((b) => b && b.subRole === window.__SR.ConstructionShip && b.builtAt === null && b.topSpeed > 0) ?? null');
        await page.waitForTimeout(800);
        for (const b of await enabledButtons()) {
            const cls = (await b.getAttribute('class')) ?? '';
            if (!/order-style-(build|page|sub)/.test(cls)) continue;
            await b.click().catch(() => {});
            await page.waitForTimeout(600);
        }
    });
    await page.evaluate(async () => (await import('/src/ui/hud.ts')).setSelection(null));
    // Left-sidebar panels.
    const panels = await page.$$eval('.ls-button[data-panel]', (bs) => bs.map((b) => b.dataset.panel));
    for (const id of panels) {
        await tourStep(`left panel ${id}`, async () => {
            await page.click(`.ls-button[data-panel="${id}"]`).catch(() => {});
            await page.waitForTimeout(1200);
            const row = await page.$('[data-hud="pnlItemList"] [data-index="0"]');
            if (row) await row.click().catch(() => {});
            await page.waitForTimeout(600);
            await page.click(`.ls-button[data-panel="${id}"]`).catch(() => {});
        }, 800);
    }
    // Top-bar screens (and the galaxy map), each opened, left 2.5 s, closed.
    const screens = ['tbtnColonies', 'tbtnBuiltObjects', 'tbtnShipGroups', 'tbtnDesigns', 'btnBuildOrder', 'tbtnConstructionYards', 'tbtnTroops', 'tbtnResearch', 'btnExpansionPlanner', 'btnEmpireSummary', 'btnEmpirePolicy', 'tbtnEmpires', 'tbtnIntelligenceAgents', 'btnEmpireGraphs', 'btnGalacticHistory', 'btnHistoryMessages'];
    for (const id of screens) {
        await tourStep(`screen ${id}`, async () => {
            const btn = page.locator(`[data-hud="${id}"]`).first();
            if ((await btn.count()) === 0) return void console.log(`     (no ${id} button)`);
            await btn.click().catch(() => {});
            await page.waitForTimeout(2500);
            // Diplomacy: every empire row once.
            if (id === 'tbtnEmpires') {
                for (const r of (await page.$$('[data-ow] .ow-list-row, [data-ow] .dip-row')).slice(0, 12)) {
                    await r.click().catch(() => {});
                    await page.waitForTimeout(300);
                }
            }
            await page.keyboard.press('Escape');
            await page.waitForTimeout(500);
            if ((await page.locator('[data-ow]').count()) > 0) await btn.click().catch(() => {});
            await page.waitForTimeout(500);
            while ((await page.locator('[data-ow] .ow-close').count()) > 0) {
                await page.locator('[data-ow] .ow-close').first().click().catch(() => {});
                await page.waitForTimeout(200);
                if ((await page.locator('[data-ow] .ow-close').count()) > 3) break;
            }
        }, 800);
    }
    await tourStep('galaxy map', async () => {
        await page.keyboard.press('g');
        await page.waitForTimeout(3000);
        await page.keyboard.press('g');
    });
    await tourStep('idle again', async () => {}, 2000);
    if (inThread) {
        writeFileSync(`${out}/ui-tour-writes.json`, JSON.stringify(tourWrites, null, 1));
        console.log(`saved ${out}/ui-tour-writes.json`);
    } else {
        // The replica must still equal the worker's game (paused: settle for two cold cycles).
        let dg = null;
        for (let i = 0; i < 30; i++) {
            await page.waitForTimeout(2000);
            dg = await page.evaluate(async () => {
                const { stateDigest } = await import('/src/sim/tick/digest.ts');
                const d = window.__dwu;
                return { replica: stateDigest(d.galaxy), worker: (await d.simWorker.digest()).digest };
            });
            if (dg.replica === dg.worker) break;
        }
        check(dg.replica === dg.worker, `ui tour: replica digest = worker digest after the tour (${dg.replica.slice(0, 12)} / ${dg.worker.slice(0, 12)})`);
    }
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
        // With the presentation clock (render/renderInterp.ts PresentationClock, in MainView; on unless ?renderClock=0)
        // what stops at the press is the picture: in worker mode the steps in flight were simulated before the press, so
        // the replica's clock lands past it.
        const paced = d.view?.presentClock != null;
        return { paced, before, first: seen[0].now, heldFrames: seen.filter((s) => s.held).length, last: seen[seen.length - 1].now, drawnBefore, drawnFirst: seen[0].drawn, drawnLast: seen[seen.length - 1].drawn, ackMs: st?.lastPauseAckMs ?? null, inFlight: st?.lastPauseInFlightSteps ?? null };
    });
    // In-thread the clock stops dead. In worker mode the replica is held from the press until the worker's ack, then
    // takes the steps the worker ran before the pause reached it (1–2 at most: up to ~35 game ms at 1x); on a slow
    // renderer (headless swiftshader draws ~8 fps) the ack lands inside the first frame. With the presentation clock the
    // drawn game time (MainView.renderTime.renderNowMs) is checked instead: it stops at the press, then stands.
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
        // Chunk 4 (messages): the worker records the player's messages (history on the replica after the cold sync) and
        // the main thread shows them (ticker lines / stubs).
        await page.waitForTimeout(2000);
        const msgs = await page.evaluate(() => {
            const p = window.__dwu.game.playerEmpire;
            return { history: p.messageHistory.length, stamped: p.messageHistory.filter((m) => m && m.starDate > 0).length, stubs: document.querySelectorAll('.message-stub').length };
        });
        check(msgs.history > 0 && msgs.stamped === msgs.history, `player messages recorded: ${JSON.stringify(msgs)}`);
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
        if (uiTour) await runUiTour();
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
