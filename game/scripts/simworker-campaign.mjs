#!/usr/bin/env node
// Sim worker campaign (docs/sim-worker.md §10): a long scripted play session in headless Chromium against a running
// dev server, worker mode (default) or in-thread (--inthread), to compare the two. Built on scripts/simworker-smoke.mjs.
//
//   node scripts/simworker-campaign.mjs <base url> --game=<kind> [--inthread] [--detect-writes] [--years=1.5]
//        [--out=shots/campaign/<kind>-<mode>] [--gpu=swiftshader|egl] [--no-crash] [--no-replay] [--seed=4242]
//        [--only=<step,...>] [--warm=<game s>]
//
// <kind>: standard (main menu → wizard, Custom Standard) · intro (main menu → wizard → Introductory Game) · pirate
// (Custom Pirate) · prewarp (a PreWarp galaxy and empire) · shakturi (Return of the Shakturi) · gameend (a time-limit
// victory the sim reaches in its first long tick) · late2500 (?load=/dev-saves/late2500.dwusave).
//
// The session plays `--years` galactic years (600 game s each) at 1×, 2× and 4×, and between play segments goes
// through the UI the way a player does, issuing real orders through it: every top-bar screen (colony tax and rename,
// ship automate / refuel, fleet designs, a design copy, a build order, yard purchase and removal, recruit, research
// queue by tree click and queue drag, Expansion Planner, empire rename, Empire Policy combo / Save / Load, diplomacy
// talks: a gift, a pirate faction's protection), every left-sidebar panel (rows clicked and double-clicked, Pirate
// Missions buttons), selection buttons, right-click and Ctrl-right-click order menus, control groups, the Ground Report,
// the T / D / H keys, Game Options (empire and message settings), story and choice popups as they come (and the
// Shakturi story panel), save from the game menu then load from the main menu and continue, an autosave, and — worker
// mode — a crash of each kind with the restart. Every step checks its effect on the game state and its redraw; the clock
// is watched for hangs, every command reply for stuck waits, and every console error is recorded with its step.
//
// Determinism (new games, worker mode): before the crashes the worker's game is saved; the createGame options the page
// posted to the worker (captured from the `init` message) and that save go to scripts/simworker-replay-check.mjs, which
// replays seed + the session's command log headless in node and compares the digest and the save text.
//
// Writes <out>/campaign.json (every check, step timings, console errors, journaled ops) and screenshots.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] ?? 'http://localhost:5173/';
const opt = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const flag = (k) => process.argv.includes(`--${k}`);
const kind = opt('game', 'standard');
const inThread = flag('inthread');
const mode = inThread ? 'inthread' : 'worker';
const detectWrites = flag('detect-writes') && !inThread;
const years = Number(opt('years', kind === 'late2500' ? '0.25' : '1.5'));
const out = opt('out', `shots/campaign/${kind}-${mode}`);
mkdirSync(out, { recursive: true });
const gpuArgs = [...(opt('gpu', 'swiftshader') === 'egl' ? ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']), '--js-flags=--expose-gc', '--enable-precise-memory-info'];
const sw = `simWorker=${inThread ? 0 : 1}${detectWrites ? '&detectWrites=1' : ''}`;
const GAME_YEAR_MS = 600_000;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: gpuArgs });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(30000);

// ---------------------------------------------------------------------------------------------------------------
// Bookkeeping: checks, steps, console lines (tagged with the step they came in), journaled ops per step.
// ---------------------------------------------------------------------------------------------------------------
const results = [];
const steps = [];
const consoleLines = [];
let step = 'boot';
let failed = 0;
const t0 = Date.now();
const check = (ok, what) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} [${step}] ${what}`);
    results.push({ step, ok: !!ok, what });
    if (!ok) failed++;
    return !!ok;
};
const note = (what) => {
    console.log(`     [${step}] ${what}`);
    results.push({ step, note: what });
};
/** Console lines expected from the simulated crashes (the worker's STOPPED report and the requests it failed). */
let expectCrashLines = false;
page.on('console', (m) => {
    const type = m.type();
    if (type !== 'error' && type !== 'warning') return;
    const text = m.text();
    const expected = expectCrashLines && /sim worker|simulation worker|smoke: simulated|campaign: simulated/i.test(text);
    consoleLines.push({ step, type, text: text.slice(0, 2000), expected });
    if (type === 'error' && !expected) console.log(`     [console.error @ ${step}] ${text.slice(0, 300)}`);
});
page.on('pageerror', (e) => {
    consoleLines.push({ step, type: 'pageerror', text: (e.stack ?? e.message).slice(0, 2000), expected: false });
    console.log(`     [pageerror @ ${step}] ${e.message}`);
});
page.on('dialog', (d) => void d.accept());
page.on('crash', () => {
    consoleLines.push({ step, type: 'pageerror', text: 'PAGE CRASHED', expected: false });
    console.log('     PAGE CRASHED');
});

// The createGame options the page posts to the worker (its `init` message), as tagged JSON (simworker-replay-check.mjs
// decodes it): kept on window.__campaignInit.
await context.addInitScript(() => {
    const encode = (v, seen = new Set()) => {
        if (v === undefined) return { $u: 1 };
        if (typeof v === 'number') return Number.isFinite(v) ? (Object.is(v, -0) ? { $n: '-0' } : v) : { $n: String(v) };
        if (v === null || typeof v !== 'object') return typeof v === 'function' ? { $u: 1 } : v;
        if (seen.has(v)) throw new Error('cyclic createGame options');
        seen.add(v);
        try {
            if (Array.isArray(v)) return v.map((x) => encode(x, seen));
            if (v instanceof Map) return { $map: [...v].map(([k, x]) => [encode(k, seen), encode(x, seen)]) };
            if (v instanceof Set) return { $set: [...v].map((x) => encode(x, seen)) };
            if (ArrayBuffer.isView(v)) return { $ta: v.constructor.name, v: [...v] };
            const proto = Object.getPrototypeOf(v);
            const o = {};
            for (const [k, x] of Object.entries(v)) o[k] = encode(x, seen);
            if (proto !== Object.prototype && proto !== null) return { $plainOf: v.constructor?.name ?? '?', ...o };
            return o;
        } finally {
            seen.delete(v);
        }
    };
    // Toasts as they appear (window.__campaignToasts), for steps whose reply is a toast (observed once the document
    // exists: an init script runs before it).
    window.__campaignToasts = [];
    const watchToasts = () => {
        try {
            new MutationObserver((ms) => {
                for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList?.contains('dwu-toast')) window.__campaignToasts.push(n.textContent);
            }).observe(document.documentElement, { childList: true, subtree: true });
        } catch { /* not a document with an element tree */ }
    };
    if (document.documentElement) watchToasts();
    else document.addEventListener('readystatechange', watchToasts, { once: true });
    // The init messages survive a reload of the page (the game menu's Main Menu reloads it) in sessionStorage.
    try {
        window.__campaignInit = JSON.parse(sessionStorage.getItem('campaignInit') ?? '[]');
    } catch { window.__campaignInit = []; }
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (msg, ...rest) {
        try {
            if (msg && msg.type === 'init') {
                window.__campaignInit = window.__campaignInit ?? [];
                window.__campaignInit.push({ kind: msg.boot?.kind, options: msg.boot?.kind === 'create' ? encode(msg.boot.options) : null, scenario: msg.boot?.scenario ?? null });
                try {
                    sessionStorage.setItem('campaignInit', JSON.stringify(window.__campaignInit));
                } catch { /* too big or unavailable: this page's copy only */ }
            }
        } catch (err) {
            window.__campaignInitError = String(err);
        }
        return post.call(this, msg, ...rest);
    };
});

const wait = (ms) => page.waitForTimeout(ms);
const now = () => page.evaluate(() => window.__dwu?.galaxy?.nowMs ?? -1);
const ev = (fn, arg) => page.evaluate(fn, arg);
/** The player's journaled ops so far (both modes: the worker's log is a request). */
const logOps = () => ev(async () => {
    try {
        return (await window.__dwu.commands.log()).filter((e) => e.source === 'player').map((e) => e.op);
    } catch {
        return null;
    }
});
const pending = () => ev(() => window.__dwu?.simWorker?.core?.pendingReplies ?? 0);
const pause = (p = true) => ev((p) => { window.__dwu.time.paused = p; }, p);
const setSpeed = (s) => ev((s) => { window.__dwu.time.speed = s; }, s);
let shotN = 0;
const shot = async (name) => {
    const file = `${out}/${String(++shotN).padStart(3, '0')}-${name}.png`;
    await page.screenshot({ path: file }).catch(() => {});
    return file;
};

/**
 * One step of the session: a name, a body with checks, a time limit (a step that does not finish is a hang: FAIL, then
 * the windows are closed and the session goes on). Afterwards: nothing may be left waiting for a reply, and the ops it
 * journaled are recorded.
 */
async function act(name, fn, { timeoutMs = 120000, settleReplies = true } = {}) {
    step = name;
    const started = Date.now();
    // What is open / focused as the step starts (a leftover window or a focused text box eats keys and clicks).
    const st0 = await ev(() => ({ windows: [...document.querySelectorAll('[data-ow]')].filter((e) => (e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden')).map((e) => e.dataset.ow), focus: document.activeElement && document.activeElement !== document.body ? `${document.activeElement.tagName}.${document.activeElement.className}` : null })).catch(() => null);
    if (st0 && (st0.windows.length > 0 || st0.focus)) note(`at the start: windows ${JSON.stringify(st0.windows)}, focus ${st0.focus}`);
    const opsBefore = (await logOps()) ?? [];
    let timer;
    let error = null;
    try {
        await Promise.race([fn(), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`HANG: step did not finish in ${timeoutMs / 1000} s`)), timeoutMs); })]);
    } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        check(false, `step threw: ${error.split('\n')[0].slice(0, 300)}`);
        await shot(`error-${name.replace(/[^a-z0-9]+/gi, '-')}`);
        await closeAll().catch(() => {});
    } finally {
        clearTimeout(timer);
    }
    if (settleReplies && !inThread) {
        let p = await pending().catch(() => -1);
        for (let i = 0; i < 40 && p > 0; i++) {
            await wait(250);
            p = await pending().catch(() => -1);
        }
        if (p !== 0) check(false, `stuck: ${p} command repl${p === 1 ? 'y' : 'ies'} still waiting 10 s after the step`);
    }
    const opsAfter = (await logOps()) ?? [];
    const ops = opsAfter.slice(opsBefore.length);
    steps.push({ name, ms: Date.now() - started, ops, error });
    console.log(`  -- ${name}: ${((Date.now() - started) / 1000).toFixed(1)} s${ops.length ? `; journaled ${summarize(ops)}` : ''}`);
    return ops;
}
const summarize = (ops) => {
    const c = {};
    for (const o of ops) c[o] = (c[o] ?? 0) + 1;
    return Object.entries(c).map(([k, n]) => (n > 1 ? `${k}×${n}` : k)).join(', ');
};

/** Close every window the session may have opened (close buttons; never Escape on a bare view: the game menu). */
async function closeAll() {
    for (let i = 0; i < 12; i++) {
        const sel = ['.ow-close', '.policy-close', '.galactic-history-close', '.game-menu-close', '.msg-event-close', '.msg-card-close', '.trade-close', '.order-confirm-button'].join(', ');
        const x = page.locator(sel).last();
        if ((await x.count()) === 0 || !(await x.isVisible().catch(() => false))) break;
        await x.click({ timeout: 3000 }).catch(() => {});
        await wait(250);
    }
    if (await page.locator('.gmap-overlay').isVisible().catch(() => false)) {
        await page.keyboard.press('Escape');
        await wait(300);
    }
    if (await page.locator('.order-menu-root .order-menu-item').count()) {
        await page.keyboard.press('Escape');
        await wait(200);
    }
    if (await page.locator('#game-menu-overlay').isVisible().catch(() => false)) await page.locator('.game-menu-btn', { hasText: 'Resume' }).click().catch(() => {});
}

const waitGame = (prev = null) => page.waitForFunction((prevId) => {
    const d = window.__dwu;
    if (d?.time === undefined || d?.view === undefined || d?.game?.playerEmpire == null) return false;
    return prevId === null || d.__campaignId !== prevId;
}, prev, { timeout: 900000, polling: 500 });
/** Tag the current game view (a load or restart builds a new one). */
const tagView = () => ev(() => (window.__dwu.__campaignId = Math.random().toString(36).slice(2)));

// ---------------------------------------------------------------------------------------------------------------
// Popups that the game raises while it runs (story, choices, conversations, events, cards, game end, automation).
// ---------------------------------------------------------------------------------------------------------------
const popupsSeen = [];
async function handlePopups() {
    const seen = [];
    for (let i = 0; i < 8; i++) {
        // Game end (the sim's own, in the gameend game).
        if (await page.locator('[data-ow="gameend"]').isVisible().catch(() => false)) {
            seen.push('gameend');
            gameEndSeen = await page.locator('[data-ow="gameend"]').innerText().catch(() => '?');
            await shot('gameend-panel');
            await page.locator('[data-ow="gameend"] button', { hasText: 'Continue Playing' }).click().catch(() => {});
            await wait(500);
            continue;
        }
        // An event with a choice (ruins, an encountered ship, …): take the first (investigate) choice.
        const evWin = page.locator('[data-ow="msgevent"]');
        if (await evWin.isVisible().catch(() => false)) {
            const text = (await evWin.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 120);
            const closeBtn = evWin.locator('.msg-event-close');
            if ((await closeBtn.count()) > 0) {
                seen.push(`event: ${text}`);
                await closeBtn.first().click().catch(() => {});
            } else {
                const btn = evWin.locator('button').first();
                seen.push(`event choice "${(await btn.innerText().catch(() => '?')).trim()}": ${text}`);
                await btn.click().catch(() => {});
                choicesTaken++;
            }
            await wait(400);
            continue;
        }
        // A conversation: a pirate protection / truce offer is accepted (tribute); anything else answered with its
        // first accept-like option, else Goodbye.
        const talk = page.locator('[data-ow="msgtalk"]');
        if (await talk.isVisible().catch(() => false)) {
            const opts = await talk.locator('[data-option]').evaluateAll((as) => as.map((a) => a.dataset.option));
            const pick = opts.find((o) => /PIRATE_(PROTECTION|TRUCE)ACCEPTRESPONSE/.test(o)) ?? opts.find((o) => /_ACCEPT$|^ACCEPT$|HONORREQUESTHELP/.test(o));
            const text = (await talk.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 120);
            if (pick && !conversationAnswered.has(text)) {
                conversationAnswered.add(text);
                seen.push(`talk ${pick}: ${text}`);
                if (/PIRATE_/.test(pick)) pirateTributeTaken++;
                await talk.locator(`[data-option="${pick}"]`).first().click().catch(() => {});
                await wait(1500);
            } else {
                seen.push(`talk (closed): ${text}`);
                const exit = talk.locator('[data-option="Exit"]');
                if ((await exit.count()) > 0) await exit.first().click().catch(() => {});
                else await talk.locator('.ow-close').first().click().catch(() => {});
            }
            await wait(400);
            continue;
        }
        // The Shakturi story panel: the story's own answer (yes).
        const story = page.locator('.msg-story');
        if (await story.isVisible().catch(() => false)) {
            seen.push(`story: ${(await story.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 100)}`);
            const yes = story.locator('.msg-story-yes');
            if ((await yes.count()) > 0) await yes.click().catch(() => {});
            else await story.locator('.msg-story-close, .ow-glass').first().click().catch(() => {});
            await wait(400);
            continue;
        }
        const card = page.locator('[data-ow="msgcard"]');
        if (await card.isVisible().catch(() => false)) {
            seen.push(`card: ${(await card.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 100)}`);
            await card.locator('.msg-card-close, .ow-close').first().click().catch(() => {});
            await wait(300);
            continue;
        }
        const confirm = page.locator('.order-confirm-window');
        if (await confirm.isVisible().catch(() => false)) {
            seen.push('automation question');
            await confirm.locator('.order-confirm-button', { hasText: 'Turn off automation' }).click().catch(() => {});
            await wait(300);
            continue;
        }
        const intro = page.locator('[data-ow="introduction"]');
        if (await intro.isVisible().catch(() => false)) {
            seen.push('introduction');
            await intro.locator('button', { hasText: 'Start Playing' }).click().catch(() => {});
            await wait(300);
            continue;
        }
        break;
    }
    if (seen.length) {
        popupsSeen.push(...seen.map((s) => `${step}: ${s}`));
        for (const s of seen) note(`popup: ${s}`);
    }
    return seen;
}
let gameEndSeen = null;
let choicesTaken = 0;
let pirateTributeTaken = 0;
const conversationAnswered = new Set();

// ---------------------------------------------------------------------------------------------------------------
// Playing: run the clock at a speed, watching it advance, the view redraw and the popups.
// ---------------------------------------------------------------------------------------------------------------
let playedMs = 0;
/** Play `gameMs` of game time at `speed`; checks that the clock and the drawn time keep moving (no hang, redraws). */
async function play(gameMs, speed) {
    await setSpeed(speed);
    await pause(false);
    const start = await now();
    const wallStart = Date.now();
    let last = start, lastWall = Date.now(), stalls = 0;
    // A loaded machine may run the sim slower than real time; allow a long wall time, but the clock must move.
    const wallLimit = Math.max(60000, (gameMs / speed) * 4 + 30000);
    let frames0 = await ev(() => window.__campaignFrames ?? 0);
    while ((await now()) - start < gameMs && Date.now() - wallStart < wallLimit) {
        await wait(Math.min(5000, Math.max(1000, gameMs / speed / 4)));
        await handlePopups();
        // A popup (or the game) may have paused the clock: resume (a player does).
        const st = await ev(() => ({ paused: window.__dwu.time.paused, speed: window.__dwu.time.speed, nowMs: window.__dwu.galaxy.nowMs, frames: window.__campaignFrames ?? 0, drawn: window.__dwu.view?.renderTime?.renderNowMs ?? null }));
        if (st.paused) await pause(false);
        if (st.speed !== speed) await setSpeed(speed);
        if (st.nowMs === last && !st.paused) {
            stalls++;
            if (Date.now() - lastWall > 20000) {
                check(false, `HANG: the clock stood at ${st.nowMs} for ${((Date.now() - lastWall) / 1000).toFixed(0)} s while running at ${speed}×`);
                break;
            }
        } else {
            last = st.nowMs;
            lastWall = Date.now();
        }
        if (st.frames === frames0) check(false, `missing redraw: no animation frame in ${((Date.now() - lastWall) / 1000).toFixed(1)} s`);
        frames0 = st.frames;
    }
    const moved = (await now()) - start;
    const wallS = (Date.now() - wallStart) / 1000;
    check(moved > 0, `played ${(moved / 1000).toFixed(0)} game s at ${speed}× in ${wallS.toFixed(0)} s wall (${(moved / 1000 / wallS).toFixed(2)}× real time)`);
    playedMs += moved;
    return moved;
}
async function installFrameCounter() {
    await ev(() => {
        if (window.__campaignFrameLoop) return;
        window.__campaignFrameLoop = true;
        window.__campaignFrames = 0;
        const tick = () => {
            window.__campaignFrames++;
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    });
}

// ---------------------------------------------------------------------------------------------------------------
// Selection and the main view.
// ---------------------------------------------------------------------------------------------------------------
async function selectExpr(expr) {
    return ev(async (e) => {
        const hud = await import('/src/ui/hud.ts');
        const d = window.__dwu;
        const p = d.game.playerEmpire;
        const sys = p.capital ? d.galaxy.systems[p.capital.systemIndex] : null;
        const pick = new Function('d', 'p', 'sys', `return (${e});`)(d, p, sys);
        if (!pick) return null;
        if (pick.ships !== undefined && pick.leadShip !== undefined) hud.selectShipGroup(pick, true);
        else hud.selectStellarObject(pick, true);
        return pick.name ?? '?';
    }, expr);
}
const selectionName = () => ev(async () => {
    const s = (await import('/src/ui/hud.ts')).getSelection();
    if (!s) return null;
    return (s.builtObject ?? s.shipGroup ?? s.habitat ?? s.creature)?.name ?? (s.builtObjects ? `${s.builtObjects.length} ships` : '?');
});
/** Screen point of a world object (centres the camera on it first at `zoom`). */
async function screenPointOf(expr, zoom) {
    return ev(([e, z]) => {
        const d = window.__dwu;
        const p = d.game.playerEmpire;
        const o = new Function('d', 'p', `return (${e});`)(d, p);
        if (!o) return null;
        d.camera.centerOn(o.xpos, o.ypos);
        if (z !== null) d.camera.zoom = d.camera.clampZoom(z);
        const s = d.camera.worldToScreen(o.xpos, o.ypos);
        const r = document.querySelector('canvas').getBoundingClientRect();
        return { x: r.left + s.x, y: r.top + s.y, name: o.name };
    }, [expr, zoom]);
}
const MOBILE_SHIP = `p.builtObjects.find((b) => b && !b.hasBeenDestroyed && b.builtAt === null && b.topSpeed > 0 && b.role !== undefined && b.subRole === 'SUB')`;
const shipOf = (subRoleName) => `(window.__SR ? ${MOBILE_SHIP.replace("'SUB'", `window.__SR.${subRoleName}`)} : null)`;

// ---------------------------------------------------------------------------------------------------------------
// Boot.
// ---------------------------------------------------------------------------------------------------------------
const NEWGAME = {
    pirate: { seed: 5, empireType: 'CustomPirate', starCountIndex: 0, dimensionIndex: 0, otherEmpires: { empireCount: 4 } },
    prewarp: { seed: 7, empireType: 'CustomStandard', galaxyExpansionIndex: 0, empireTechLevelIndex: 0, starCountIndex: 0, dimensionIndex: 0, otherEmpires: { empireCount: 4 } },
    shakturi: { seed: 9, empireType: 'ReturnOfTheShakturi', starCountIndex: 0, dimensionIndex: 0, otherEmpires: { empireCount: 4 } },
    gameend: { seed: 11, empireType: 'CustomStandard', starCountIndex: 0, dimensionIndex: 0, otherEmpires: { empireCount: 3 }, victory: { territory: false, territoryPercent: 33, population: false, populationPercent: 33, economy: false, economyPercent: 33, timeLimit: true, timeLimitYears: 0, startDateYears: 1, timeStart: false, enableDisasterEvents: true, enableRaceSpecificConditions: true, enableRaceSpecificEvents: true, victoryThresholdPercentage: 0.8 } },
};
async function boot() {
    if (kind === 'standard' || kind === 'intro') {
        await page.goto(`${base}?${sw}`);
        await page.waitForSelector('button[data-id="startNewGame"]', { timeout: 120000 });
        await shot('main-menu');
        await page.click('button[data-id="startNewGame"]');
        await page.waitForSelector('.wizard-type-page .wizard-type-btn', { timeout: 60000 });
        await page.waitForFunction(() => !document.querySelector('.wizard-race-loading'), null, { timeout: 30000 }).catch(() => {});
        if (kind === 'intro') {
            await page.click('.wizard-type-btn[data-type="Introductory"]');
        } else {
            await page.click('.wizard-type-btn[data-type="CustomStandard"]');
            for (let i = 0; i < 14; i++) {
                await page.waitForFunction(() => !document.querySelector('.wizard-race-loading'), null, { timeout: 30000 }).catch(() => {});
                // A fixed seed (the Galaxy page's box), so the worker and in-thread runs play the same galaxy.
                const seedBox = page.locator('.wizard-seed-input');
                if ((await seedBox.count()) > 0 && (await seedBox.isVisible())) await seedBox.fill(opt('seed', '4242'));
                const label = (await page.textContent('.wizard-btn-primary'))?.trim();
                if (label === 'Start Game') break;
                await page.click('.wizard-btn-primary');
                await wait(200);
            }
            await shot('wizard-start-page');
            check((await page.textContent('.wizard-btn-primary'))?.trim() === 'Start Game', 'the wizard reaches Start Game');
            await page.click('.wizard-btn-primary');
        }
    } else if (kind === 'late2500') {
        await page.goto(`${base}?load=${encodeURIComponent('/dev-saves/late2500.dwusave')}&${sw}`);
    } else {
        const ng = NEWGAME[kind];
        if (!ng) throw new Error(`unknown --game=${kind}`);
        await page.goto(`${base}?newgame=${encodeURIComponent(JSON.stringify(ng))}&${sw}`);
    }
    await waitGame();
    await tagView();
    await installFrameCounter();
    await ev(async () => { window.__SR = (await import('/src/sim/builtObjectTypes.ts')).BuiltObjectSubRole; });
    check(inThread === (await ev(() => window.__dwu.simWorker == null)), inThread ? 'the game runs in-thread' : 'the game runs in the worker');
    await wait(1500);
    await handlePopups();
    const info = await ev(() => {
        const d = window.__dwu;
        const p = d.game.playerEmpire;
        return { empire: p.name, pirate: p.pirateEmpireBaseHabitat != null, colonies: p.colonies.length, ships: p.builtObjects.length, empires: d.galaxy.empires.length, nowMs: d.galaxy.nowMs, paused: d.time.paused };
    });
    note(`game: ${JSON.stringify(info)}`);
    await shot('booted');
    return info;
}

// ---------------------------------------------------------------------------------------------------------------
// The UI steps.
// ---------------------------------------------------------------------------------------------------------------
async function openHud(hudId, sel) {
    const btn = page.locator(`[data-hud="${hudId}"]`).first();
    if ((await btn.count()) === 0) return false;
    await btn.click();
    return page.waitForSelector(sel, { timeout: 20000 }).then(() => true, () => false);
}

async function stepColonies() {
    await ev(() => {
        const d = window.__dwu;
        d.commands.issue(d.galaxy, d.game.playerEmpire, 'setEmpireControl', ['controlColonyTaxRates', false]);
    });
    await wait(800);
    if (!check(await openHud('tbtnColonies', '[data-ow="colonies"]'), 'colonies screen opens')) return;
    await wait(1500);
    if ((await page.locator('[data-ow="colonies"] .ow-grid-row').count()) === 0) {
        note('colonies: no colony rows (no colonies yet)');
        await shot('colonies-empty');
        return closeAll();
    }
    // The first own colony row, then its tax: +3 by the spinner steps, then the box shows it and the colony has it.
    await page.locator('[data-ow="colonies"] .ow-grid-row').first().click();
    await wait(800);
    const box = page.locator('[data-ow="colonies"] input.col-tax');
    if ((await box.count()) === 0) return void check(false, 'colonies: tax box');
    if (await box.isDisabled()) {
        // A pirate faction's controlled (not owned) colony: no tax (coloniesScreen.ts refreshDetail).
        note('colonies: the tax box is disabled for this colony');
        await shot('colonies');
        return closeAll();
    }
    const before = Number(await box.inputValue());
    const dir = before > 40 ? -1 : 1;
    await box.evaluate((b, dir) => {
        b.focus();
        for (let i = 0; i < 3; i++) {
            if (dir > 0) b.stepUp();
            else b.stepDown();
            b.dispatchEvent(new Event('change'));
        }
        b.blur();
    }, dir);
    await page.waitForFunction(([want]) => Number(document.querySelector('[data-ow="colonies"] input.col-tax')?.value) === want, [before + 3 * dir], { timeout: 10000 }).catch(() => {});
    // The colony's rate follows with the replies (a round trip each; on a loaded late game a few seconds).
    await page.waitForFunction((want) => {
        const sel = document.querySelector('[data-ow="colonies"] .ow-grid-row.ow-sel');
        const cells = sel ? [...sel.children].map((c) => c.textContent.trim()) : [];
        const h = window.__dwu.game.playerEmpire.colonies.find((c) => cells.includes(c.name));
        return h !== undefined && Math.round(Math.max(0, h.taxRate) * 100) === want;
    }, before + 3 * dir, { timeout: 20000 }).catch(() => {});
    const after = await box.inputValue().then(Number);
    const rate = await ev(() => {
        const sel = document.querySelector('[data-ow="colonies"] .ow-grid-row.ow-sel');
        const p = window.__dwu.game.playerEmpire;
        // The selected row's own name cell (a substring match picks "Ash" for "Ash 2").
        const cells = sel ? [...sel.children].map((c) => c.textContent.trim()) : [];
        const h = p.colonies.find((c) => cells.includes(c.name)) ?? p.colonies.find((c) => sel && sel.textContent.includes(c.name)) ?? null;
        return h ? Math.round(Math.max(0, h.taxRate) * 100) : null;
    });
    check(after === before + 3 * dir && rate === after, `colonies: tax ${before} → ${after} shown, colony rate ${rate}`);
    // Rename through the name box (Enter).
    const nameBox = page.locator('[data-ow="colonies"] input.ow-textbox').first();
    if ((await nameBox.count()) > 0 && (await nameBox.isEditable())) {
        await nameBox.fill('Campaign Prime');
        await nameBox.press('Enter');
        const ok = await page.waitForFunction(() => window.__dwu.game.playerEmpire.colonies.some((c) => c.name === 'Campaign Prime'), null, { timeout: 15000 }).then(() => true, () => false);
        check(ok, 'colonies: rename reaches the colony');
        await wait(1500);
        check((await page.locator('[data-ow="colonies"] .ow-grid-row', { hasText: 'Campaign Prime' }).count()) > 0, 'colonies: the list redraws with the new name');
    } else note('colonies: no editable name box');
    await shot('colonies');
    await closeAll();
}

async function stepShips() {
    if (!check(await openHud('tbtnBuiltObjects', '[data-ow="ships"]'), 'ships and bases screen opens')) return;
    await wait(1500);
    if ((await page.locator('[data-ow="ships"] .ow-grid-row').count()) === 0) {
        note('ships: no ships or bases (a pre-warp start)');
        await shot('ships-empty');
        return closeAll();
    }
    // A ship row (not a base): its Automate button flips the ship's automation, and the label follows.
    const rows = page.locator('[data-ow="ships"] .ow-grid-row');
    const n = await rows.count();
    let picked = false;
    for (let i = 0; i < Math.min(n, 30) && !picked; i++) {
        await rows.nth(i).click();
        await wait(300);
        const b = page.locator('[data-ow="ships"] .ow-glass', { hasText: /^(Automate|Unautomate)$/ }).first();
        if ((await b.count()) > 0 && (await b.isEnabled())) {
            picked = true;
            const label = (await b.innerText()).trim();
            const name = await rows.nth(i).innerText();
            await b.click();
            const flipped = await page.waitForFunction((l) => {
                const x = [...document.querySelectorAll('[data-ow="ships"] .ow-glass')].find((e) => /^(Automate|Unautomate)$/.test(e.textContent.trim()));
                return x && x.textContent.trim() !== l;
            }, label, { timeout: 15000 }).then(() => true, () => false);
            check(flipped, `ships: ${label} on "${name.replace(/\s+/g, ' ').slice(0, 40)}" (the button flips)`);
            // And back (the quick-repeat path: from the state last sent).
            await page.locator('[data-ow="ships"] .ow-glass', { hasText: /^(Automate|Unautomate)$/ }).first().click();
            await wait(2000);
            const refuel = page.locator('[data-ow="ships"] .ow-glass', { hasText: /^Refuel$/ }).first();
            if ((await refuel.count()) > 0 && (await refuel.isEnabled())) {
                await refuel.click();
                await wait(2000);
                note('ships: Refuel ordered');
            }
        }
    }
    if (!picked) note('ships: no row with an Automate button');
    await shot('ships');
    await closeAll();
}

async function stepFleets() {
    if (!check(await openHud('tbtnShipGroups', '[data-ow="fleets"]'), 'fleets screen opens')) return;
    await wait(1200);
    const tab = page.locator('[data-ow="fleets"] .ow-tab', { hasText: 'Fleet Designs' });
    if ((await tab.count()) === 0) return void check(false, 'fleets: Fleet Designs tab');
    await tab.click();
    await wait(800);
    const count0 = await ev(() => window.__dwu.game.playerEmpire.fleetDesigns?.templates?.length ?? 0);
    await page.locator('[data-ow="fleets"] .ow-glass', { hasText: 'New Fleet Design' }).click();
    const created = await page.waitForFunction((c) => (window.__dwu.game.playerEmpire.fleetDesigns?.templates?.length ?? 0) > c, count0, { timeout: 15000 }).then(() => true, () => false);
    check(created, `fleet designs: New Fleet Design (${count0} → ${await ev(() => window.__dwu.game.playerEmpire.fleetDesigns?.templates?.length ?? 0)})`);
    await wait(1000);
    const add = page.locator('[data-ow="fleets"] .ow-glass', { hasText: 'Add Design' });
    if ((await add.count()) > 0 && (await add.isEnabled())) {
        await add.click();
        const shown = await page.waitForSelector('[data-ow="fleets"] button.fl-step', { timeout: 10000 }).then(() => true, () => false);
        const entries = await ev(() => {
            const t = window.__dwu.game.playerEmpire.fleetDesigns?.templates;
            return t?.[t.length - 1]?.entries?.length ?? null;
        });
        check(shown && entries === 1, `fleet designs: Add Design adds a row (game entries ${entries}, row shown ${shown})`);
        await wait(500);
        // Three quick "+" clicks: the count steps by three (the value last sent, docs §4.4 quick repeats).
        const plus = page.locator('[data-ow="fleets"] button.fl-step', { hasText: '+' }).first();
        if ((await plus.count()) > 0) {
            const c0 = Number(await page.locator('[data-ow="fleets"] .fl-count').first().innerText());
            await plus.click();
            await plus.click();
            await plus.click();
            await wait(2500);
            const c1 = Number(await page.locator('[data-ow="fleets"] .fl-count').first().innerText());
            const sim = await ev(() => {
                const t = window.__dwu.game.playerEmpire.fleetDesigns?.templates;
                const last = t?.[t.length - 1];
                return last?.entries?.[0]?.count ?? null;
            });
            check(c1 === c0 + 3 && sim === c1, `fleet designs: + ×3 steps the count ${c0} → ${c1} (game ${sim})`);
        } else note('fleet designs: no + step button');
    } else note('fleet designs: Add Design disabled');
    await shot('fleet-designs');
    await closeAll();
}

async function stepDesigns() {
    if (!check(await openHud('tbtnDesigns', '[data-ow="designs"] .ow-grid-row'), 'designs screen opens')) return;
    await wait(1000);
    const d0 = await ev(() => window.__dwu.game.playerEmpire.designs.length);
    await page.locator('[data-ow="designs"] .ow-grid-row').first().click();
    await page.locator('[data-ow="designs"] .ow-glass', { hasText: 'Copy As New' }).click();
    const prompt = page.locator('[data-ow="msgbox"] .ow-glass', { hasText: 'Turn off automation' });
    await prompt.waitFor({ timeout: 3000 }).then(() => prompt.click(), () => {});
    if (!check(await page.waitForSelector('[data-ow="design-editor"]', { timeout: 15000 }).then(() => true, () => false), 'design editor opens')) return closeAll();
    await wait(1200);
    await page.locator('[data-ow="design-editor"] .ow-glass', { hasText: /^Save$/ }).first().click();
    const yes = page.locator('[data-ow="msgbox"] .ow-glass', { hasText: /^(Yes|OK)$/ });
    await yes.first().waitFor({ timeout: 4000 }).then(() => yes.first().click(), () => {});
    const saved = await page.waitForFunction((d0) => window.__dwu.game.playerEmpire.designs.length > d0, d0, { timeout: 15000 }).then(() => true, () => false);
    check(saved, `design editor: Save adds the copy (${d0} → ${await ev(() => window.__dwu.game.playerEmpire.designs.length)})`);
    await wait(1000);
    check((await page.locator('[data-ow="design-editor"]').count()) === 0, 'design editor closes after saving');
    await shot('designs');
    await closeAll();
}

async function stepBuildOrder() {
    if (!check(await openHud('btnBuildOrder', '[data-ow="buildorder"]'), 'build order opens')) return;
    await wait(1500);
    const before = await ev(() => ({ money: window.__dwu.game.playerEmpire.stateMoney, ships: window.__dwu.game.playerEmpire.builtObjects.length }));
    const up = page.locator('[data-ow="buildorder"] .ow-spin-up:not([disabled])').first();
    if ((await up.count()) === 0) {
        note('build order: nothing to build (no enabled spinner)');
        await shot('build-order-empty');
        return closeAll();
    }
    await up.click();
    await wait(400);
    const buy = page.locator('[data-ow="buildorder"] .ow-glass', { hasText: /^Purchase/ }).first();
    const enabled = await buy.isEnabled().catch(() => false);
    if (!enabled) {
        note(`build order: Purchase disabled (${await buy.innerText().catch(() => '?')})`);
        return closeAll();
    }
    await buy.click();
    const box = page.locator('[data-ow="msgbox"]');
    await wait(500);
    if (await box.isVisible().catch(() => false)) {
        const t = (await box.innerText()).replace(/\s+/g, ' ');
        note(`build order: ${t.slice(0, 160)}`);
        await box.locator('.ow-glass').first().click();
        if (/cannot afford/i.test(t)) {
            check(true, 'build order: Purchase answers (cannot afford: the refusal box)');
            return closeAll();
        }
    }
    const ok = await page.waitForFunction((b) => window.__dwu.game.playerEmpire.builtObjects.length > b.ships || window.__dwu.game.playerEmpire.stateMoney < b.money - 1, before, { timeout: 20000 }).then(() => true, () => false);
    check(ok, 'build order: Purchase buys a ship (money down / a new ship queued)');
    await shot('build-order');
    await closeAll();
}

async function stepYards() {
    if (!check(await openHud('tbtnConstructionYards', '[data-ow="yards"] .ow-grid-row'), 'construction yards open')) return;
    await wait(1500);
    await page.locator('[data-ow="yards"] .ow-grid').first().locator('.ow-grid-row').first().click();
    await wait(800);
    const waitingCount = () => page.locator('[data-ow="yards"] .cy-page:not([hidden]) .ow-grid').nth(1).locator('.ow-grid-row').count();
    const w0 = await waitingCount();
    const buy = page.locator('[data-ow="yards"] .cy-purchaser .ow-glass', { hasText: 'Purchase' }).first();
    let bought = 0;
    for (let i = 0; i < 2; i++) {
        if (!(await buy.isEnabled().catch(() => false))) break;
        await buy.click();
        await wait(500);
        const leave = page.locator('[data-ow="msgbox"] .ow-glass', { hasText: 'Leave on' });
        if ((await leave.count()) > 0) await leave.click();
        bought++;
        await wait(1500);
    }
    await wait(2000);
    const w1 = await waitingCount();
    note(`yards: purchased ${bought}; waiting rows ${w0} → ${w1}`);
    if (bought > 0) check(w1 >= w0 || (await ev(() => window.__dwu.game.playerEmpire.builtObjects.some((b) => b.builtAt != null))), 'yards: the purchases show in the queue');
    await shot('yards-bought');
    if (w1 > 0) {
        await page.locator('[data-ow="yards"] .cy-page:not([hidden]) .ow-grid').nth(1).locator('.ow-grid-row').last().click();
        await wait(300);
        await page.locator('[data-ow="yards"] .ow-glass', { hasText: 'Remove Ship' }).click();
        const yes = page.locator('[data-ow="msgbox"] .ow-glass', { hasText: /^Yes$/ });
        if (await yes.waitFor({ timeout: 5000 }).then(() => true, () => false)) {
            await yes.click();
            const removed = await page.waitForFunction((w) => [...document.querySelectorAll('[data-ow="yards"] .cy-page:not([hidden]) .ow-grid')][1]?.querySelectorAll('.ow-grid-row').length < w, w1, { timeout: 15000 }).then(() => true, () => false);
            check(removed, 'yards: Remove Ship takes it off the queue (the list redraws)');
        } else {
            const ok = page.locator('[data-ow="msgbox"] .ow-glass', { hasText: 'OK' });
            note(`yards: remove refused (${await page.locator('[data-ow="msgbox"]').innerText().catch(() => '?')})`);
            if ((await ok.count()) > 0) await ok.click();
        }
    }
    for (const t of [6, 7]) {
        await page.locator('[data-ow="yards"] .ow-tab').nth(t).click().catch(() => {});
        await wait(800);
    }
    await shot('yards-tabs');
    await closeAll();
}

async function stepTroops() {
    await page.click('[data-hud="tbtnTroops"]');
    if (!check(await page.waitForSelector('[data-ow="troops"]', { timeout: 15000 }).then(() => true, () => false), 'troops screen opens')) return;
    await wait(1000);
    const btn = page.locator('[data-ow="troops"] .tr-recruit-btn').first();
    if ((await btn.count()) === 0) return void (note('troops: no recruit button'), await closeAll());
    const before = await ev(() => window.__dwu.game.playerEmpire.colonies.reduce((a, h) => a + (h.troopsToRecruit?.count ?? h.troopsToRecruit?.items?.length ?? 0), 0));
    await btn.click();
    const confirm = page.locator('.order-confirm-wrap .order-confirm-button').first();
    if (await confirm.waitFor({ timeout: 4000 }).then(() => true, () => false)) await confirm.click();
    const ok = await page.waitForFunction((b) => window.__dwu.game.playerEmpire.colonies.reduce((a, h) => a + (h.troopsToRecruit?.count ?? h.troopsToRecruit?.items?.length ?? 0), 0) > b, before, { timeout: 15000 }).then(() => true, () => false);
    const box = page.locator('[data-ow="msgbox"]');
    if (!ok && (await box.isVisible().catch(() => false))) note(`troops: ${(await box.innerText()).replace(/\s+/g, ' ').slice(0, 120)}`);
    check(ok || (await box.isVisible().catch(() => false)), 'troops: Recruit adds a troop to recruit (or says why not)');
    await shot('troops');
    await closeAll();
}

async function stepResearch() {
    if (!check(await openHud('tbtnResearch', '[data-ow="research"] .rs-tree'), 'research screen opens')) return;
    await wait(1500);
    const queueNames = () => ev(() => [...document.querySelectorAll('[data-ow="research"] .rs-queue-row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()));
    const gameQueue = () => ev(() => {
        const r = window.__dwu.game.playerEmpire.research;
        const out = [];
        for (const ind of [0, 1, 2]) for (const t of r.researchQueueFor(ind) ?? []) out.push(t.def.name);
        return out;
    });
    // Left-click three researchable nodes that are not queued yet (the tree's own click: queueResearch).
    let queued = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
        const target = await ev(() => {
            const nodes = [...document.querySelectorAll('[data-ow="research"] .rs-tree .rs-node')];
            // researchTreeModel.ts nodeVisual: researchable, not researched, not queued = a dull solid frame without a border.
            const n = nodes.find((x) => x.classList.contains('rs-frame-dull') && x.classList.contains('rs-fill-solid') && x.classList.contains('rs-border-none') && !x.classList.contains('rs-disabled')) ?? nodes.find((x) => x.classList.contains('rs-frame-dull') && x.classList.contains('rs-fill-solid') && x.classList.contains('rs-border-none')) ?? null;
            if (!n) return null;
            n.scrollIntoView({ block: 'center', inline: 'center' });
            const b = n.getBoundingClientRect();
            return { x: b.left + b.width / 2, y: b.top + b.height / 2, name: n.querySelector('.rs-node-title')?.textContent ?? '?', cls: n.className };
        });
        if (!target) break;
        const q0 = (await gameQueue()).length;
        await page.mouse.click(target.x, target.y);
        const ok = await page.waitForFunction((q0) => {
            const r = window.__dwu.game.playerEmpire.research;
            let n = 0;
            for (const ind of [0, 1, 2]) n += (r.researchQueueFor(ind) ?? []).length;
            return n > q0;
        }, q0, { timeout: 10000 }).then(() => true, () => false);
        if (!ok) {
            const box = page.locator('[data-ow="msgbox"]');
            if (await box.isVisible().catch(() => false)) {
                note(`research: click on ${target.name} → ${(await box.innerText()).replace(/\s+/g, ' ').slice(0, 80)}`);
                await box.locator('.ow-glass', { hasText: /^No$|^OK$/ }).first().click().catch(() => {});
            } else note(`research: click on ${target.name} (${target.cls}) queued nothing`);
            continue;
        }
        queued++;
        await wait(800);
    }
    check(queued > 0, `research: ${queued} project(s) queued by clicking the tree`);
    await wait(1000);
    // A move the game allows (playerOrders.ts moveResearchProject: not above a prerequisite, not below a dependant,
    // not before a crash project): row i of the shown queue to index t among the other rows.
    const plan = await ev(() => {
        const rows = [...document.querySelectorAll('[data-ow="research"] .rs-queue-row')];
        const texts = rows.map((r) => r.textContent);
        const r = window.__dwu.game.playerEmpire.research;
        const q = [0, 1, 2].map((i) => r.researchQueueFor(i) ?? []).find((q) => q.length === rows.length && q.every((n, i) => texts[i].includes(n.def.name)));
        if (!q || q.length < 2) return { rows: rows.length, q: q?.length ?? null };
        for (let i = q.length - 1; i >= 0; i--) {
            const node = q[i];
            if (node.isRushing || !rows[i].classList.contains('rs-queue-draggable')) continue;
            const rest = q.filter((n) => n !== node);
            let lo = rest.length > 0 && rest[0].isRushing ? 1 : 0;
            let hi = rest.length;
            for (let k = 0; k < rest.length; k++) {
                if (node.parentNodes.includes(rest[k])) lo = Math.max(lo, k + 1);
                if (rest[k].parentNodes.includes(node)) hi = Math.min(hi, k);
            }
            for (const t of [lo, hi]) {
                if (lo > hi || t === i) continue;
                const others = rows.filter((x) => x !== rows[i]);
                const from = rows[i].getBoundingClientRect();
                const y = t < others.length ? others[t].getBoundingClientRect().top + 2 : others[others.length - 1].getBoundingClientRect().bottom - 2;
                return { i, t, name: node.def.name, x: from.left + 40, y0: from.top + from.height / 2, y1: y };
            }
        }
        return { rows: rows.length, none: true, q: q.map((n) => `${n.def.name}${n.isRushing ? ' (crash)' : ''} <- [${n.parentNodes.filter((x) => q.includes(x)).map((x) => x.def.name).join(', ')}]`), draggable: rows.map((r) => r.classList.contains('rs-queue-draggable')) };
    });
    const game0 = await gameQueue();
    const shown0 = await queueNames();
    if (plan && plan.i !== undefined) {
        await page.mouse.move(plan.x, plan.y0);
        await page.mouse.down();
        for (let k = 1; k <= 12; k++) await page.mouse.move(plan.x, plan.y0 + (plan.y1 - plan.y0) * (k / 12));
        await wait(200);
        await page.mouse.up();
        const moved = await page.waitForFunction((g0) => {
            const r = window.__dwu.game.playerEmpire.research;
            const out = [];
            for (const ind of [0, 1, 2]) for (const t of r.researchQueueFor(ind) ?? []) out.push(t.def.name);
            return out.join('|') !== g0.join('|');
        }, game0, { timeout: 15000 }).then(() => true, () => false);
        await wait(1200);
        const shown1 = await queueNames();
        check(moved, `research: dragging ${plan.name} from row ${plan.i} to ${plan.t} reorders the game's queue (${game0.join(' / ')} → ${(await gameQueue()).join(' / ')})`);
        check(shown1.join('|') !== shown0.join('|'), 'research: the queue panel redraws in the new order');
    } else note(`research: no allowed queue move (${JSON.stringify(plan)})`);
    await shot('research');
    await closeAll();
}

async function stepExpansion() {
    if (!check(await openHud('btnExpansionPlanner', '[data-ow="expansion"] .ep-targets'), 'expansion planner opens')) return;
    await wait(2500);
    const lowQ = page.locator('[data-ow="expansion"] .ow-check', { hasText: 'low-quality' });
    if ((await lowQ.count()) > 0) {
        await lowQ.click();
        await wait(1500);
    }
    const rows = page.locator('[data-ow="expansion"] .ep-targets .ow-grid-row');
    let done = false;
    for (let i = 0; i < Math.min(await rows.count(), 8) && !done; i++) {
        await rows.nth(i).click();
        await wait(600);
        const build = page.locator('[data-ow="expansion"] .ep-wrap', { hasText: /^Build and Send Colony Ship/ });
        if ((await build.count()) > 0 && (await build.isEnabled())) {
            const money0 = await ev(() => window.__dwu.game.playerEmpire.stateMoney);
            const toasts0 = await ev(() => window.__campaignToasts.length);
            await build.click();
            // Busy until the reply (docs §4.4): a second click must not buy a second ship.
            await build.click({ timeout: 1000 }).catch(() => {});
            const ok = await page.waitForFunction(() => window.__dwu.game.playerEmpire.builtObjects.some((b) => b.mission?.type !== undefined && b.subRole === window.__SR.ColonyShip && b.builtAt != null) || document.querySelector('[data-ow="expansion"]')?.textContent.includes('already assigned'), null, { timeout: 20000 }).then(() => true, () => false);
            const spent = money0 - (await ev(() => window.__dwu.game.playerEmpire.stateMoney));
            await wait(1000);
            const toast = (await ev((t0) => window.__campaignToasts.slice(t0), toasts0)).join(' | ');
            // Without a colony ship design it can build (a pirate faction) the button is on but the click does nothing,
            // as the C# (Main.Part11.cs method_161 enables it, Main.Part4.cs method_539 returns).
            const noDesign = await ev(async () => {
                const { findNewestCanBuild } = await import('/src/sim/designGeneration.ts');
                const p = window.__dwu.game.playerEmpire;
                return findNewestCanBuild(p.designs, window.__SR.ColonyShip, p) === null;
            });
            if (noDesign && !ok) note('expansion planner: Build and Send Colony Ship without a buildable colony ship design does nothing (as method_539)');
            else check(ok || /colonize/i.test(toast), `expansion planner: Build and Send Colony Ship (spent ${spent.toFixed(0)}; toast "${toast.slice(0, 160)}")`);
            done = true;
        }
    }
    if (!done) {
        // Resource mode: queue a mining station.
        await page.locator('[data-ow="expansion"] .ep-mode').selectOption('resourcesyou').catch(() => {});
        await wait(1500);
        const r = page.locator('[data-ow="expansion"] .ep-targets .ow-grid-row').first();
        if ((await r.count()) > 0) {
            await r.click();
            await wait(600);
            const q = page.locator('[data-ow="expansion"] .ep-wrap', { hasText: /Queue nearest Construction Ship/ });
            if ((await q.count()) > 0 && (await q.isEnabled())) {
                const j0 = await ev(() => window.__dwu.game.playerEmpire.constructionBoard?.jobs?.length ?? 0);
                await q.click();
                const ok = await page.waitForFunction((j0) => (window.__dwu.game.playerEmpire.constructionBoard?.jobs?.length ?? 0) > j0, j0, { timeout: 15000 }).then(() => true, () => false);
                check(ok, 'expansion planner: a mining station construction job is queued');
                done = true;
            }
        }
        await page.locator('[data-ow="expansion"] .ep-mode').selectOption('colonies').catch(() => {});
    }
    if (!done) note('expansion planner: no target to build for');
    await shot('expansion');
    await closeAll();
}

async function stepSummary() {
    if (!check(await openHud('btnEmpireSummary', '[data-ow="summary"]'), 'empire summary opens')) return;
    await wait(1000);
    const box = page.locator('[data-ow="summary"] input.es-name');
    if ((await box.count()) === 0) return void (note('summary: no name box'), await closeAll());
    const name = `Campaign ${mode} ${Math.floor(Math.random() * 1000)}`;
    await box.fill(name);
    await box.press('Enter');
    const ok = await page.waitForFunction((n) => window.__dwu.game.playerEmpire.name === n, name, { timeout: 15000 }).then(() => true, () => false);
    check(ok, `empire summary: rename to "${name}"`);
    await wait(800);
    check((await page.locator('[data-ow="summary"]').innerText()).includes(name), 'empire summary: the window redraws the new name');
    await shot('summary');
    await closeAll();
}

async function stepPolicy() {
    await page.click('[data-hud="btnEmpirePolicy"]');
    if (!check(await page.waitForSelector('.policy-window', { timeout: 15000 }).then(() => true, () => false), 'empire policy opens')) return;
    await wait(1000);
    // A policy combo (not an automation one): pick another option → setPolicy.
    const changed = await ev(() => {
        const sels = [...document.querySelectorAll('.policy-window select.policy-select')].filter((s) => !s.closest('.policy-band-auto') && s.options.length > 1);
        const s = sels[0];
        if (!s) return null;
        const v = s.selectedIndex === 0 ? 1 : 0;
        s.selectedIndex = v;
        s.dispatchEvent(new Event('change', { bubbles: true }));
        return { label: s.closest('.policy-row')?.textContent.replace(/\s+/g, ' ').slice(0, 60) ?? '?', to: s.options[v].text };
    });
    await wait(2000);
    note(`policy: changed ${JSON.stringify(changed)}`);
    // An automation combo → setEmpireControl.
    await ev(() => {
        const s = document.querySelector('.policy-window .policy-band-auto select.policy-select');
        if (!s || s.options.length < 2) return;
        s.selectedIndex = (s.selectedIndex + 1) % s.options.length;
        s.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await wait(2000);
    // Save, then Load the saved file.
    await page.click('.policy-save');
    await page.fill('.policy-file-name', 'Campaign.txt').catch(() => {});
    await page.click('.policy-file-ok');
    await wait(1500);
    await page.click('.policy-load');
    await wait(800);
    const entry = page.locator('.policy-file-entry', { hasText: 'Campaign.txt' }).first();
    check((await entry.count()) > 0, 'policy: the saved file is listed by Load');
    if ((await entry.count()) > 0) {
        await entry.click();
        await wait(2500);
    }
    // A built-in policy too.
    if (await page.locator('.policy-load').count()) {
        await page.click('.policy-load');
        await wait(800);
        const inst = page.locator('.policy-file-entry.policy-file-install').first();
        if ((await inst.count()) > 0) {
            note(`policy: loading ${await inst.innerText()}`);
            await inst.click();
            await wait(2500);
        }
    }
    await shot('policy');
    await closeAll();
}

async function stepDiplomacy() {
    await page.keyboard.press('F5');
    if (!check(await page.waitForSelector('[data-ow="diplomacy"] .ow-grid-row', { timeout: 20000 }).then(() => true, () => false), 'diplomacy opens')) return;
    await wait(1200);
    const rows = page.locator('[data-ow="diplomacy"] .dip-list .ow-grid-row');
    const n = await rows.count();
    note(`diplomacy: ${n} rows`);
    // Every row once (the detail redraws per row).
    for (let i = 0; i < Math.min(n, 10); i++) {
        await rows.nth(i).click().catch(() => {});
        await wait(300);
    }
    // An empire: Speak → a small gift.
    await page.selectOption('[data-ow="diplomacy"] select.diplomacy-filter-kind', 'empires').catch(() => {});
    await wait(400);
    if ((await rows.count()) >= 2) {
        await rows.nth(1).click();
        await wait(500);
        const speak = page.locator('[data-ow="diplomacy"] .ow-glass', { hasText: 'Speak with' });
        if ((await speak.count()) > 0 && (await speak.isEnabled())) {
            await speak.click();
            const got = await page.waitForSelector('[data-ow="diplomacy-talk"] .dip-talk-link', { timeout: 20000 }).then(() => true, () => false);
            check(got, 'diplomacy: the talk panel lists its options');
            const gift = page.locator('[data-ow="diplomacy-talk"] .dip-talk-link', { hasText: 'Send a gift' });
            if ((await gift.count()) > 0) {
                const m0 = await ev(() => window.__dwu.game.playerEmpire.stateMoney);
                await gift.click();
                const small = page.locator('[data-ow="diplomacy-talk"] .dip-talk-link', { hasText: 'small gift' });
                if (await small.waitFor({ timeout: 10000 }).then(() => true, () => false)) {
                    await small.click();
                    const reply = await page.waitForSelector('[data-ow="diplomacy-talk"] .diplomacy-reply', { timeout: 20000 }).then((e) => e.textContent(), () => null);
                    check(reply !== null, `diplomacy: the gift is answered (${String(reply).replace(/\s+/g, ' ').slice(0, 80)})`);
                    const spent = await page.waitForFunction((m0) => window.__dwu.game.playerEmpire.stateMoney < m0, m0, { timeout: 15000 }).then(() => true, () => false);
                    check(spent, 'diplomacy: the gift leaves the treasury');
                }
            } else note('diplomacy: no gift option');
            await shot('diplomacy-talk');
            await page.locator('[data-ow="diplomacy-talk"] .dip-talk-link', { hasText: 'Goodbye' }).first().click().catch(() => {});
            await wait(300);
        } else note('diplomacy: Speak disabled');
    }
    // A pirate faction: its protection price, and a protection deal (tribute) through the talk panel.
    await page.selectOption('[data-ow="diplomacy"] select.diplomacy-filter-kind', 'pirates').catch(() => {});
    await wait(500);
    if ((await rows.count()) >= 2) {
        await rows.nth(1).click();
        await wait(1500);
        const detail = (await page.locator('[data-ow="diplomacy"] .dip-detail').innerText().catch(() => '')).replace(/\s+/g, ' ');
        note(`pirate detail: ${detail.match(/Protection[^.]*|truce[^.]*/i)?.[0]?.slice(0, 100) ?? detail.slice(0, 100)}`);
        const speak = page.locator('[data-ow="diplomacy"] .ow-glass', { hasText: 'Speak with' });
        if ((await speak.count()) > 0 && (await speak.isEnabled())) {
            await speak.click();
            await page.waitForSelector('[data-ow="diplomacy-talk"] .dip-talk-link', { timeout: 20000 }).catch(() => {});
            const links = await page.locator('[data-ow="diplomacy-talk"] .dip-talk-link').allInnerTexts();
            note(`pirate talk: ${links.join(' / ').slice(0, 300)}`);
            const prot = page.locator('[data-ow="diplomacy-talk"] .dip-talk-link', { hasText: /protection|truce|tribute/i }).first();
            if ((await prot.count()) > 0) {
                const m0 = await ev(() => window.__dwu.game.playerEmpire.stateMoney);
                await prot.click();
                await wait(1000);
                const sub = page.locator('[data-ow="diplomacy-talk"] .dip-talk-link', { hasText: /protection|truce|pay|accept/i }).first();
                if ((await sub.count()) > 0) await sub.click().catch(() => {});
                const reply = await page.waitForSelector('[data-ow="diplomacy-talk"] .diplomacy-reply', { timeout: 20000 }).then((e) => e.textContent(), () => null);
                check(reply !== null, `pirate: protection proposal answered (${String(reply).replace(/\s+/g, ' ').slice(0, 100)})`);
                await wait(2000);
                note(`pirate: money ${m0.toFixed(0)} → ${(await ev(() => window.__dwu.game.playerEmpire.stateMoney)).toFixed(0)}`);
                pirateTributeTaken++;
            }
            await shot('pirate-talk');
            await page.locator('[data-ow="diplomacy-talk"] .dip-talk-link', { hasText: 'Goodbye' }).first().click().catch(() => {});
        }
    }
    await closeAll();
}

async function stepOtherScreens() {
    for (const [id, sel] of [['tbtnIntelligenceAgents', '[data-ow="characters"]'], ['btnEmpireGraphs', '[data-ow]'], ['btnGalacticHistory', '.galactic-history-window, [data-ow]'], ['btnHistoryMessages', '.galactic-history-window, .message-history-wrap, [data-ow]']]) {
        const btn = page.locator(`[data-hud="${id}"]`).first();
        if ((await btn.count()) === 0) {
            note(`no ${id} button`);
            continue;
        }
        await btn.click();
        const ok = await page.waitForSelector(sel, { timeout: 15000 }).then(() => true, () => false);
        check(ok, `${id} opens`);
        await wait(1500);
        await shot(id);
        await closeAll();
        await wait(300);
    }
    // The game editor button (the original's; may be unavailable here).
    const ed = page.locator('[data-hud="btnGameEditor"]').first();
    if ((await ed.count()) > 0) {
        await ed.click().catch(() => {});
        await wait(1200);
        note(`btnGameEditor: ${(await page.locator('[data-ow]').count()) > 0 ? 'opened a window' : 'nothing opened'}`);
        await closeAll();
    }
    // The top strip's overflow menu: Empires list, Galaxy Map, Game Options, the admiral (K), the shortcuts (?).
    const more = page.locator('.top-more button').first();
    if ((await more.count()) > 0) {
        const n = await page.locator('.top-more-menu .top-more-item').count();
        for (let i = 0; i < Math.max(n, 5); i++) {
            await more.click().catch(() => {});
            await wait(300);
            const item = page.locator('.top-more-menu .top-more-item').nth(i);
            if ((await item.count()) === 0) break;
            const label = (await item.innerText()).trim();
            await item.click().catch(() => {});
            await wait(1500);
            const opened = await ev(() => [...document.querySelectorAll('[data-ow], .gmap-overlay, .hud-keyboard-overlay, .advisor-wrap, .empires-list-wrap')].filter((e) => (e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden')).map((e) => e.dataset?.ow ?? e.className.split(' ')[0]));
            check(opened.length > 0, `top-strip menu "${label}" opens ${JSON.stringify(opened)}`);
            await shot(`more-${label.replace(/[^a-z0-9]+/gi, '-')}`);
            await closeAll();
            await ev(() => document.activeElement?.blur?.());
            if (await page.locator('.gmap-overlay').isVisible().catch(() => false)) await page.keyboard.press('Escape');
            if (await page.locator('.hud-keyboard-overlay').isVisible().catch(() => false)) {
                await page.mouse.move(800, 450);
                await page.keyboard.press('?');
            }
            for (const sel of ['.advisor-wrap .ow-close, .advisor-wrap [class*="close"]', '.empires-list-close']) if ((await page.locator(sel).count()) > 0) await page.locator(sel).first().click().catch(() => {});
            await wait(300);
        }
    }
    // Galactopedia (F1), and F1 again closes it.
    await page.mouse.move(800, 450);
    await page.keyboard.press('F1');
    const gp = await page.waitForSelector('#galactopedia', { timeout: 10000 }).then(() => true, () => false);
    check(gp, 'F1 opens the Galactopedia');
    await wait(1500);
    await shot('galactopedia');
    if (gp) {
        await page.keyboard.press('F1');
        await wait(500);
        if ((await page.locator('#galactopedia').count()) > 0) await page.keyboard.press('Escape');
        await wait(300);
        check((await page.locator('#galactopedia').count()) === 0, 'the Galactopedia closes');
    }
    // Galaxy map (G) and back.
    await page.mouse.move(800, 450);
    await page.keyboard.press('g');
    check(await page.waitForSelector('.gmap-overlay', { timeout: 10000 }).then(() => true, () => false), 'galaxy map opens (G)');
    await wait(2000);
    await shot('galaxy-map');
    await page.keyboard.press('Escape');
    await wait(500);
}

async function stepLeftSidebar() {
    const panels = await page.$$eval('.ls-button[data-panel]', (bs) => bs.map((b) => b.dataset.panel));
    check(panels.length > 0, `left sidebar: ${panels.length} panels`);
    for (const id of panels) {
        await page.click(`.ls-button[data-panel="${id}"]`).catch(() => {});
        await wait(900);
        const rows = page.locator('[data-hud="pnlItemList"] .ls-row');
        const n = await rows.count();
        let sel = null;
        if (n > 0) {
            await rows.first().click().catch(() => {});
            await wait(500);
            sel = await selectionName();
            await rows.first().dblclick().catch(() => {});
            await wait(500);
            // Pirate Missions: the row's button (Accept / Bid / Cancel).
            if (id === 'pirateMissions') {
                const b = page.locator('.ls-mission-btn').first();
                if ((await b.count()) > 0) {
                    const t = (await b.innerText()).trim();
                    const ops0 = (await logOps())?.length ?? 0;
                    await b.click().catch(() => {});
                    await wait(2500);
                    const ops = ((await logOps()) ?? []).slice(ops0);
                    check(ops.includes('pirateMissionButton') || /Already/.test(t), `pirate missions: "${t}" issues pirateMissionButton (${ops.join(',')})`);
                }
            }
        }
        note(`left panel ${id}: ${n} rows${sel ? `; row 0 selects ${sel}` : ''}`);
        await page.click(`.ls-button[data-panel="${id}"]`).catch(() => {});
        await wait(300);
    }
    await shot('left-sidebar');
}

async function stepOrders() {
    // An exploration ship: the selection panel's Explore button.
    const ex = await selectExpr(`${shipOf('ExplorationShip')} ?? ${shipOf('ColonyShip')}`);
    if (ex) {
        await wait(1500);
        const b = page.locator('.order-actions .order-action-btn[title*="Explore"]:not([disabled])').first();
        if ((await b.count()) > 0) {
            const ops0 = (await logOps())?.length ?? 0;
            await b.click();
            await wait(2500);
            const ops = ((await logOps()) ?? []).slice(ops0);
            check(ops.includes('shipAction'), `selection panel: Explore on ${ex} (${ops.join(',')})`);
        } else note(`selection panel: no Explore button for ${ex} (buttons: ${(await page.$$eval('.order-actions .order-action-btn', (bs) => bs.map((b) => `${b.title.split('\n')[0]}${b.disabled ? ' (disabled)' : ''}`))).filter((t) => t.trim()).join(' / ')})`);
    } else note('no exploration ship');
    // A plain right-click on a far body with a mobile ship selected: the default order.
    const shipName = await selectExpr(`${shipOf('ConstructionShip')} ?? ${MOBILE_SHIP.replace(" && b.subRole === 'SUB'", '')}`);
    if (!shipName) return void note('no mobile ship for the right-click orders');
    await wait(800);
    // A body without an owner in the home system (the capital's, else the ship's nearest system).
    await ev((n) => { window.__orderShip = window.__dwu.game.playerEmpire.builtObjects.find((b) => b && b.name === n) ?? null; }, shipName);
    const target = '(() => { const s = window.__orderShip; const home = p.capital ? p.capital.systemIndex : (s?.nearestSystemStar?.systemIndex ?? s?.parentHabitat?.systemIndex ?? -1); return d.galaxy.habitats.filter((h) => h.parent !== null && h.systemIndex === home && h !== p.capital && h.empire == null)[0] ?? (s ? d.galaxy.habitats.filter((h) => h.parent !== null && h.empire == null).sort((a, b) => Math.hypot(a.xpos - s.xpos, a.ypos - s.ypos) - Math.hypot(b.xpos - s.xpos, b.ypos - s.ypos))[0] : null) ?? null; })()';
    const at = await screenPointOf(target, 1 / 200);
    if (!at) return void note('no body to right-click');
    await wait(800);
    await page.mouse.move(at.x - 2, at.y - 2);
    await page.mouse.move(at.x, at.y);
    await wait(500);
    let ops0 = (await logOps())?.length ?? 0;
    await page.mouse.click(at.x, at.y, { button: 'right' });
    await wait(1500);
    if ((await page.locator('.pick-menu .pick-menu-row').count()) > 0) {
        note(`pick popup on the plain right-click: ${(await page.locator('.pick-menu .pick-menu-row').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ')).join(' / ')}`);
        const row = page.locator('.pick-menu .pick-menu-row', { hasText: at.name }).first();
        await ((await row.count()) > 0 ? row : page.locator('.pick-menu .pick-menu-row').first()).click();
    }
    await wait(1500);
    await handlePopups();
    let ops = ((await logOps()) ?? []).slice(ops0);
    const menuAfterPlain = await page.locator('.order-menu-root .order-menu-item').count();
    check(ops.includes('rightClickOrder') || ops.includes('actionMenu'), `right-click ${at.name} with ${shipName} selected (${ops.join(',')}; menu items open: ${menuAfterPlain})`);
    if (menuAfterPlain) {
        await page.keyboard.press('Escape');
        await wait(400);
        check((await page.locator('.order-menu-root .order-menu-item').count()) === 0, 'Escape closes the action menu');
    }
    // Ctrl-right-click: the action menu, then a pick (a leaf item, not disabled).
    await selectExpr(`p.builtObjects.find((b) => b && b.name === ${JSON.stringify(shipName)})`);
    await wait(600);
    const at2 = await screenPointOf(target, null);
    ops0 = (await logOps())?.length ?? 0;
    await page.mouse.move(at2.x, at2.y);
    await wait(300);
    const under = await ev(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? `${e.tagName}.${e.className}` : null; }, [at2.x, at2.y]);
    if (!/CANVAS/.test(String(under))) note(`ctrl-right-click point ${Math.round(at2.x)},${Math.round(at2.y)} is over ${under}`);
    await page.keyboard.down('Control');
    await page.mouse.click(at2.x, at2.y, { button: 'right' });
    await page.keyboard.up('Control');
    let menu = await page.waitForSelector('.order-menu-root .order-menu-item, .pick-menu .pick-menu-row', { timeout: 10000 }).then(() => true, () => false);
    // Objects stacked under the cursor: the pick popup first (mainView.ts tryPickMenu), then the order menu on the pick.
    if (menu && (await page.locator('.pick-menu .pick-menu-row').count()) > 0) {
        const rowsText = await page.locator('.pick-menu .pick-menu-row').allInnerTexts();
        note(`pick popup: ${rowsText.map((t) => t.replace(/\s+/g, ' ')).join(' / ')}`);
        const row = page.locator('.pick-menu .pick-menu-row', { hasText: at2.name }).first();
        await ((await row.count()) > 0 ? row : page.locator('.pick-menu .pick-menu-row').first()).click();
        menu = await page.waitForSelector('.order-menu-root .order-menu-item', { timeout: 10000 }).then(() => true, () => false);
    }
    check(menu, 'Ctrl-right-click opens the action menu');
    if (menu) {
        const labels = await page.locator('.order-menu-root .order-menu-panel').first().locator('.order-menu-item .order-menu-label').allInnerTexts();
        note(`action menu: ${labels.join(' / ')}`);
        await shot('action-menu');
        const items = page.locator('.order-menu-root .order-menu-panel').first().locator('.order-menu-item:not(.order-menu-disabled)');
        let picked = null;
        for (let i = 0; i < (await items.count()); i++) {
            const it = items.nth(i);
            if ((await it.locator('.order-menu-arrow').count()) > 0) continue;
            picked = (await it.innerText()).trim();
            await it.click();
            break;
        }
        await wait(2500);
        await handlePopups();
        ops = ((await logOps()) ?? []).slice(ops0);
        if (picked) check(ops.includes('shipAction') || ops.includes('salvageWreckField'), `action menu pick "${picked}" (${ops.join(',')})`);
        else note('action menu: no leaf item');
        if (await page.locator('.order-menu-root .order-menu-item').count()) await page.keyboard.press('Escape');
    }
}

async function stepControlGroups() {
    const cap = await selectExpr('p.capital ?? p.colonies[0] ?? p.builtObjects.find((b) => b && b.topSpeed === 0) ?? null');
    if (!cap) return void note('no capital, colony or base');
    await wait(800);
    await page.mouse.move(800, 300);
    await page.keyboard.press('Control+Digit1');
    await wait(2000);
    const ship = await selectExpr(MOBILE_SHIP.replace(" && b.subRole === 'SUB'", ''));
    await wait(600);
    await page.keyboard.press('Control+Digit2');
    await wait(1500);
    await page.keyboard.press('Digit1');
    await wait(1000);
    const s1 = await selectionName();
    check(s1 === cap, `control groups: 1 selects ${cap} again (${s1})`);
    await page.keyboard.press('Shift+Digit2');
    await wait(1000);
    const s2 = await selectionName();
    if (ship === null) note(`control groups: no mobile ship for group 2 (a pre-warp start); Shift+2 selects ${s2}`);
    else check(s2 === ship, `control groups: Shift+2 selects and centres ${ship} (${s2})`);
    const groups = await ev(async () => {
        const cg = await import('/src/sim/player/controlGroups.ts');
        return [1, 2].map((i) => {
            const g = cg.controlGroup(window.__dwu.galaxy, i);
            return g == null ? null : Array.isArray(g) ? g.length : 1;
        });
    }).catch((e) => String(e));
    note(`control groups in the game: ${JSON.stringify(groups)}`);
}

async function stepKeys() {
    await page.mouse.move(800, 450);
    // Ground Report (on the selected colony, else the capital: Main.Part7.cs:3321).
    const hasColony = await ev(() => window.__dwu.game.playerEmpire.colonies.length > 0);
    if (hasColony) await selectExpr('p.capital ?? p.colonies[0]');
    await wait(500);
    await page.mouse.move(800, 450);
    await page.keyboard.press('BracketLeft');
    if (!hasColony) {
        await wait(800);
        check((await page.locator('[data-ow="groundReport"]').count()) === 0, 'ground report: no colony, nothing opens ([)');
    } else check(await page.waitForSelector('[data-ow="groundReport"]', { timeout: 10000 }).then(() => true, () => false), 'ground report opens ([)');
    await wait(1000);
    const img = page.locator('[data-ow="groundReport"] .gr-img').first();
    if ((await img.count()) > 0) {
        const b = await img.boundingBox();
        if (b) await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        await wait(500);
    }
    const glyph = page.locator('[data-ow="groundReport"] .gr-resize');
    if ((await glyph.count()) > 0) await glyph.click();
    await wait(600);
    await shot('ground-report');
    await page.mouse.move(800, 450);
    if (hasColony) {
        await page.keyboard.press('BracketLeft');
        await wait(500);
        check((await page.locator('[data-ow="groundReport"]').count()) === 0, 'ground report closes ([)');
    }
    // T: panels; D: display type; H: message history.
    const panels = [];
    for (let i = 0; i < 3; i++) {
        await page.keyboard.press('t');
        await wait(400);
        panels.push(await ev(() => document.body.dataset.panels ?? 'all'));
    }
    check(new Set(panels).size >= 2 && panels[2] === 'all', `T cycles the panels (${panels.join(' → ')})`);
    await shot('t-cycle');
    for (let i = 0; i < 3; i++) {
        await page.keyboard.press('d');
        await wait(500);
    }
    await shot('d-cycle');
    await page.keyboard.press('h');
    check(await page.waitForSelector('.galactic-history-window', { timeout: 10000 }).then(() => true, () => false), 'H opens the message history');
    await wait(1000);
    const tabs = page.locator('.galactic-history-tab');
    for (let i = 0; i < (await tabs.count()); i++) {
        await tabs.nth(i).click().catch(() => {});
        await wait(400);
    }
    await shot('h-history');
    await closeAll();
}

async function stepGameOptions() {
    await page.mouse.move(800, 450);
    await page.keyboard.press('o');
    if (!check(await page.waitForSelector('[data-ow="gameoptions"]', { timeout: 10000 }).then(() => true, () => false), 'game options open (O)')) return;
    await wait(600);
    // Empire Settings: a combo (setEmpireSetting).
    await page.locator('[data-ow="gameoptions"] button', { hasText: 'Empire Settings' }).click();
    if (await page.waitForSelector('[data-ow="gameoptions-empire"]', { timeout: 10000 }).then(() => true, () => false)) {
        const s = page.locator('[data-ow="gameoptions-empire"] select').first();
        const cur = await s.inputValue();
        await s.selectOption(cur === '1' ? '0' : '1');
        await wait(1500);
        await shot('options-empire');
        await page.locator('[data-ow="gameoptions-empire"] .ow-close').click().catch(() => page.keyboard.press('Escape'));
        await wait(400);
    }
    // Message Settings: a check box (setMessageOptions).
    const msgBtn = page.locator('[data-ow="gameoptions"] button', { hasText: 'Message Settings' });
    if ((await msgBtn.count()) > 0) {
        await msgBtn.click();
        if (await page.waitForSelector('[data-ow="gameoptions-messages"]', { timeout: 10000 }).then(() => true, () => false)) {
            const cb = page.locator('[data-ow="gameoptions-messages"] input[type="checkbox"]').nth(2);
            if ((await cb.count()) > 0) {
                await cb.click();
                await wait(1200);
                await cb.click();
                await wait(1200);
            }
            await shot('options-messages');
            await page.locator('[data-ow="gameoptions-messages"] .ow-close').click().catch(() => page.keyboard.press('Escape'));
            await wait(400);
        }
    }
    await page.locator('[data-ow="gameoptions"] .ow-close').click().catch(() => page.keyboard.press('Escape'));
    await wait(800);
    check((await page.locator('[data-ow="gameoptions"]').count()) === 0, 'game options close');
}

async function stepStoryPanel() {
    // The Return of the Shakturi story panel (level 2, the alliance question) as the message pipeline shows it, answered
    // Yes (storyEventAction, a journaled command).
    const shown = await ev(async () => {
        const mp = await import('/src/ui/messagePopups.ts');
        const se = await import('/src/sim/story/storyEvents.ts');
        const tr = await import('/src/sim/textResolver.ts');
        const g = window.__dwu.galaxy;
        mp.showShakturiStoryPanel(g, g.playerEmpire, tr.tryGetText('Ancient Guardians Reveal All') ?? 'Ancient Guardians Reveal All', se.generateMajorStoryItem(2), 2);
        return true;
    }).catch((e) => String(e));
    if (shown !== true) return void check(false, `story panel: ${shown}`);
    await wait(800);
    await shot('story-panel');
    const yes = page.locator('.msg-story-yes');
    if (!check((await yes.count()) === 1, 'story panel: the choice (Yes / No) shows')) return;
    const ops0 = (await logOps())?.length ?? 0;
    await yes.click();
    await wait(2500);
    const ops = ((await logOps()) ?? []).slice(ops0);
    check(ops.includes('storyEventAction'), `story panel: Yes issues storyEventAction (${ops.join(',')})`);
    await handlePopups();
}

/** Save from the game menu, load it from the main menu, continue: the same game (nowMs, the worker's digest). */
async function stepSaveLoad() {
    await pause(true);
    await wait(1500);
    const name = `campaign-${kind}-${mode}`;
    await page.mouse.move(800, 450);
    await page.keyboard.press('Escape');
    await page.waitForSelector('#game-menu-overlay .game-menu-btn', { timeout: 10000 });
    await page.locator('.game-menu-btn', { hasText: 'Save Game' }).click();
    await page.waitForSelector('#save-load-overlay .save-load-name-input', { timeout: 10000 });
    await page.fill('.save-load-name-input', name);
    const t1 = Date.now();
    await page.locator('#save-load-overlay button.save-load-btn', { hasText: /^Save$/ }).click();
    const saved = await page.waitForFunction((n) => (JSON.parse(localStorage.getItem('dwu.saveIndex') ?? '[]')).some((e) => e.name === n), name, { timeout: 120000 }).then(() => true, () => false);
    check(saved, `game menu Save Game "${name}" (${((Date.now() - t1) / 1000).toFixed(1)} s)`);
    await wait(1000);
    const at = await ev(async () => ({ nowMs: window.__dwu.galaxy.nowMs, digest: window.__dwu.simWorker ? (await window.__dwu.simWorker.digest()).digest : null, colonies: window.__dwu.game.playerEmpire.colonies.length, empire: window.__dwu.game.playerEmpire.name }));
    if (await page.locator('#save-load-overlay').isVisible().catch(() => false)) await page.keyboard.press('Escape');
    await wait(500);
    // Main menu (the game menu's Main Menu: a confirm, accepted by the dialog handler).
    if (!(await page.locator('#game-menu-overlay').isVisible().catch(() => false))) {
        await page.mouse.move(800, 450);
        await page.keyboard.press('Escape');
    }
    await page.locator('.game-menu-btn', { hasText: 'Main Menu' }).click();
    const menu = await page.waitForSelector('.main-menu-item[data-id="loadGame"]', { timeout: 30000 }).then(() => true, () => false);
    check(menu, 'Main Menu returns to the main menu');
    await shot('main-menu-again');
    const prev = await ev(() => window.__dwu?.__campaignId ?? null);
    await page.click('.main-menu-item[data-id="loadGame"]');
    const row = page.locator(`#save-load-overlay .save-row:has(.save-row-name:text-is("${name}")) .save-row-btn:text-is("Load")`);
    if (!check(await row.waitFor({ timeout: 20000 }).then(() => true, () => false), 'the Load list shows the save')) return;
    await row.click();
    await waitGame(prev);
    await tagView();
    await installFrameCounter();
    await wait(2000);
    await handlePopups();
    const back = await ev(async () => ({ nowMs: window.__dwu.galaxy.nowMs, digest: window.__dwu.simWorker ? (await window.__dwu.simWorker.digest()).digest : null, colonies: window.__dwu.game.playerEmpire.colonies.length, empire: window.__dwu.game.playerEmpire.name, worker: window.__dwu.simWorker != null }));
    check(back.worker === !inThread, `the loaded game runs ${inThread ? 'in-thread' : 'in the worker'}`);
    check(back.nowMs === at.nowMs && back.empire === at.empire && back.colonies === at.colonies, `the loaded game is the saved one (nowMs ${at.nowMs} → ${back.nowMs}, ${back.empire})`);
    if (!inThread) check(back.digest === at.digest, `the loaded game has the saved digest (${String(back.digest).slice(0, 12)})`);
    await shot('loaded');
}

/** An autosave (1 minute interval): written, listed, loadable. */
async function stepAutosave() {
    const set = await ev(async () => {
        const s = await import('/src/ui/settings.ts');
        s.updateSettings({ autoSave: true, autoSaveMinutes: 1 });
        return s.getSettings().autoSaveMinutes;
    });
    note(`autosave interval set to ${set} min`);
    const idx0 = await ev(() => JSON.parse(localStorage.getItem('dwu.saveIndex') ?? '[]').filter((e) => /^autosave-/.test(e.name)).map((e) => `${e.name}@${e.date}`));
    await setSpeed(2);
    await pause(false);
    const ok = await page.waitForFunction((i0) => JSON.parse(localStorage.getItem('dwu.saveIndex') ?? '[]').filter((e) => /^autosave-/.test(e.name)).some((e) => !i0.includes(`${e.name}@${e.date}`)), idx0, { timeout: 200000, polling: 2000 }).then(() => true, () => false);
    check(ok, 'an autosave is written within the interval');
    const line = consoleLines.filter((l) => /autosave/i.test(l.text)).slice(-1)[0];
    if (line) note(`autosave console: ${line.text.slice(0, 160)}`);
    await ev(async () => (await import('/src/ui/settings.ts')).updateSettings({ autoSaveMinutes: 30 }));
}

/** Worker mode: the worker stops (fatal with its own save; hard), the restart box, Restart, the game goes on. */
let heapBeforeCrash = 0;
async function stepCrash(kindOfCrash) {
    heapBeforeCrash = await ev(async () => {
        for (let i = 0; i < 3; i++) {
            window.gc?.();
            await new Promise((r) => setTimeout(r, 300));
        }
        return Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576);
    });
    expectCrashLines = true;
    const old = await ev((k) => {
        const d = window.__dwu;
        window.__oldSimWorker = d.simWorker;
        const p = d.game.playerEmpire;
        window.__inFlight = '(no reply)';
        d.commands.issue(d.galaxy, p, 'empireRename', [`In Flight ${k}`], (r) => { window.__inFlight = r; });
        const at = { nowMs: d.galaxy.nowMs, colonies: p.colonies.length };
        if (k === 'fatal') d.simWorker.simulateFatal('campaign: simulated fatal error');
        else d.simWorker.stop('campaign: simulated crash');
        return at;
    }, kindOfCrash);
    const box = page.locator('[data-ow="msgbox"]', { hasText: 'Simulation Stopped' });
    if (!check(await box.waitFor({ timeout: 60000 }).then(() => true, () => false), `${kindOfCrash} crash: "Simulation Stopped" shows`)) return;
    await shot(`crash-${kindOfCrash}`);
    const prev = await ev(() => window.__dwu.__campaignId);
    await box.locator('.ow-glass', { hasText: 'Restart' }).click();
    await waitGame(prev);
    await tagView();
    await installFrameCounter();
    await wait(1500);
    const st = await ev(() => ({ paused: window.__dwu.time.paused, nowMs: window.__dwu.galaxy.nowMs, colonies: window.__dwu.game.playerEmpire.colonies.length, inFlight: window.__inFlight, name: window.__dwu.game.playerEmpire.name, worker: window.__dwu.simWorker !== window.__oldSimWorker }));
    check(st.worker && st.paused && st.colonies === old.colonies && Math.abs(st.nowMs - old.nowMs) < 10000, `${kindOfCrash} restart: a new worker, paused, the same game (${JSON.stringify(st)})`);
    check((st.name === `In Flight ${kindOfCrash}`) === (st.inFlight === true), `${kindOfCrash} restart: agrees with the in-flight order's answer (${st.inFlight})`);
    // Nothing of the old game may stay alive (a late galaxy's replica is a few GB): drop the script's own reference,
    // collect, and report the heap.
    await wait(5000); // the restart's own flow lets go of the old game once the new view has started
    const heap = await ev(async () => {
        window.__oldSimWorker = null;
        for (let i = 0; i < 3; i++) {
            window.gc?.();
            await new Promise((r) => setTimeout(r, 300));
        }
        return Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576);
    });
    note(`${kindOfCrash} restart: main-thread JS heap after a GC ${heap} MB (before the crash ${heapBeforeCrash} MB)`);
    // --snapshot-after-crash=<file>: a heap snapshot here (diagnosis of what the old game is still held by).
    if (opt('snapshot-after-crash', '') !== '' && kindOfCrash === 'fatal') {
        const { openSync, writeSync, closeSync } = await import('node:fs');
        const cdp = await context.newCDPSession(page);
        for (let i = 0; i < 3; i++) await cdp.send('HeapProfiler.collectGarbage');
        const fd = openSync(opt('snapshot-after-crash', ''), 'w');
        cdp.on('HeapProfiler.addHeapSnapshotChunk', (e) => writeSync(fd, e.chunk));
        await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
        closeSync(fd);
        await cdp.detach();
        note(`heap snapshot ${opt('snapshot-after-crash', '')}`);
    }
    expectCrashLines = false;
}

/** Worker mode, a new game: save the worker's game and the createGame options for the headless replay. */
let replayFiles = null;
async function captureForReplay() {
    await pause(true);
    await wait(1500);
    const r = await ev(async () => {
        const init = (window.__campaignInit ?? []).filter((i) => i.kind === 'create');
        const text = await window.__dwu.simWorker.save();
        const dg = await window.__dwu.simWorker.digest();
        return { init: init[0] ?? null, inits: (window.__campaignInit ?? []).map((i) => i.kind), initError: window.__campaignInitError ?? null, text, digest: dg.digest, nowMs: dg.nowMs };
    });
    if (!check(r.init !== null && r.text, `replay capture: the createGame options (${r.inits.join(',')}${r.initError ? `; ${r.initError}` : ''}) and the worker's save`)) return;
    const json = `${out}/session.json`;
    const save = `${out}/session.dwusave`;
    writeFileSync(json, JSON.stringify({ options: r.init.options, scenario: r.init.scenario, digest: r.digest, nowMs: r.nowMs }));
    writeFileSync(save, r.text);
    note(`replay capture: nowMs ${r.nowMs}, digest ${r.digest.slice(0, 16)}, save ${(r.text.length / 1048576).toFixed(1)} MB`);
    replayFiles = { json, save };
    await browserReplay(r.init.options, r.text, r.digest, r.nowMs);
}

/**
 * The same replay headless in this browser's engine (a page with no game view: createGame + replayCommandLog through
 * the dev server's modules). Node's V8 and this Chromium's differ in Math.sin / cos / pow / … in the last bit for a few
 * percent of arguments (scripts/simworker-replay-check.mjs prints the node result), so this is the replay of record.
 */
async function browserReplay(options, text, digest, nowMs) {
    const rp = await context.newPage();
    rp.on('pageerror', (e) => consoleLines.push({ step: 'browser replay', type: 'pageerror', text: e.message, expected: false }));
    try {
        await rp.goto(`${base}asset-manifest.json`);
        const r = await rp.evaluate(async ([options, text, nowMs]) => {
            const decode = (v) => {
                if (Array.isArray(v)) return v.map(decode);
                if (v === null || typeof v !== 'object') return v;
                if ('$u' in v) return undefined;
                if ('$n' in v) return v.$n === '-0' ? -0 : Number(v.$n);
                if ('$map' in v) return new Map(v.$map.map(([k, x]) => [decode(k), decode(x)]));
                if ('$set' in v) return new Set(v.$set.map(decode));
                if ('$ta' in v) return new globalThis[v.$ta](v.v);
                const o = {};
                for (const [k, x] of Object.entries(v)) if (k !== '$plainOf') o[k] = decode(x);
                return o;
            };
            const fetchText = async (candidates) => {
                for (const url of candidates) {
                    try {
                        const res = await fetch(url);
                        if (res.ok) return await res.text();
                    } catch { /* next */ }
                }
                throw new Error(`Could not load any of: ${candidates.join(', ')}`);
            };
            const { loadGameData } = await import('/src/sim/data/gameData.ts');
            const { replayCommandLog } = await import('/src/sim/player/playerCommands.ts');
            const { reviveCreateOptions } = await import('/src/simworker/bootOptions.ts');
            const { serializeGame } = await import('/src/sim/save/gameSave.ts');
            const { stateDigest } = await import('/src/sim/tick/digest.ts');
            const { GalaxyTime } = await import('/src/sim/galaxyTime.ts');
            const gameData = await loadGameData(fetchText);
            const save = JSON.parse(text);
            const { seed, ...rest } = reviveCreateOptions(decode(options), gameData);
            const t0 = performance.now();
            const game = replayCommandLog(seed, rest, save.commandLog ?? [], nowMs);
            const ms = performance.now() - t0;
            const time = new GalaxyTime();
            time.bindGalaxy(game.galaxy);
            time.speed = save.time.speed;
            time.paused = save.time.paused;
            const replayText = serializeGame(game, time, save.startOptions);
            let at = -1;
            if (replayText !== text) for (let i = 0; i < Math.min(text.length, replayText.length); i++) if (text[i] !== replayText[i]) { at = i; break; }
            return { digest: stateDigest(game.galaxy), nowMs: game.galaxy.nowMs, same: replayText === text, ms, at, around: at >= 0 ? [text.slice(Math.max(0, at - 120), at + 80), replayText.slice(Math.max(0, at - 120), at + 80)] : null };
        }, [options, text, nowMs]);
        check(r.nowMs === nowMs, `browser replay stops at the save's instant (${r.nowMs} / ${nowMs}; ${(r.ms / 1000).toFixed(1)} s)`);
        check(r.digest === digest, `browser replay (headless, seed + the worker's command log): digest = the worker's (${r.digest.slice(0, 16)} / ${digest.slice(0, 16)})`);
        check(r.same, `browser replay: save text = the worker's save text${r.same ? '' : ` (first difference at ${r.at}: ${JSON.stringify(r.around)})`}`);
        writeFileSync(`${out}/browser-replay.json`, JSON.stringify(r, null, 1));
    } catch (err) {
        check(false, `browser replay failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
        await rp.close().catch(() => {});
    }
}

/** Write detector (worker mode, --detect-writes): no unexpected keys; the replica's digest = the worker's (paused). */
async function stepWriteCheck(when) {
    if (!detectWrites) return;
    const found = await ev(() => {
        const det = window.__dwuWriteDetector;
        if (!det) return null;
        det.checkAll();
        return { unexpected: det.unexpected().map((w) => `${w.key} ×${w.count} ${w.detail ?? ''}\n${w.stack ?? ''}`), summary: det.summary() };
    });
    if (!check(found !== null, `write detector installed (${when})`)) return;
    check(found.unexpected.length === 0, `write detector (${when}): ${found.unexpected.length} unexpected keys${found.unexpected.length ? `\n${found.unexpected.join('\n').slice(0, 3000)}` : ''}`);
    writeFileSync(`${out}/replica-writes-${when.replace(/[^a-z0-9]+/gi, '-')}.json`, JSON.stringify(found, null, 1));
}
async function digestsMatch(when) {
    if (inThread) return;
    await pause(true);
    let dg = null;
    for (let i = 0; i < 30; i++) {
        await wait(2000);
        dg = await ev(async () => {
            const { stateDigest } = await import('/src/sim/tick/digest.ts');
            const d = window.__dwu;
            return { replica: stateDigest(d.galaxy), worker: (await d.simWorker.digest()).digest };
        });
        if (dg.replica === dg.worker) break;
    }
    if (check(dg.replica === dg.worker, `replica digest = worker digest (${when}; ${dg.replica.slice(0, 12)} / ${dg.worker.slice(0, 12)})`)) return;
    // Where they differ: the replica's encoded graph against the worker's save, by Class.field.
    const diffs = await ev(async () => {
        const { galaxyToJSON } = await import('/src/sim/save/galaxySave.ts');
        const rep = JSON.parse(JSON.stringify(galaxyToJSON(window.__dwu.galaxy)));
        const wk = JSON.parse(await window.__dwu.simWorker.save()).galaxy;
        const out = [];
        const diff = (a, b, sa, sb, path) => {
            if (out.length >= 25 || Object.is(a, b)) return;
            if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return void out.push(`${path}: replica ${JSON.stringify(a)?.slice(0, 80)} / worker ${JSON.stringify(b)?.slice(0, 80)}`);
            if (Array.isArray(a)) {
                if (!Array.isArray(b)) return void out.push(`${path}: array / object`);
                if (a.length !== b.length) out.push(`${path}: length ${a.length} / ${b.length}`);
                for (let i = 0; i < Math.min(a.length, b.length); i++) diff(a[i], b[i], sa, sb, `${path}[${i}]`);
                return;
            }
            if ('$s' in a && '$s' in b && Array.isArray(a.$v)) {
                const xa = sa[a.$s], xb = sb[b.$s];
                if (JSON.stringify(xa) !== JSON.stringify(xb)) return void out.push(`${path}: shape ${JSON.stringify(xa).slice(0, 160)} / ${JSON.stringify(xb).slice(0, 160)}`);
                for (let i = 0; i < a.$v.length; i++) diff(a.$v[i], b.$v[i], sa, sb, `${path}/${xa[0]}.${xa[i + 1]}`);
                return;
            }
            for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
                if (!(k in a) || !(k in b)) out.push(`${path}.${k}: only in the ${k in a ? 'replica' : 'worker'}`);
                else diff(a[k], b[k], sa, sb, `${path}.${k}`);
            }
        };
        for (const k of ['galaxy', 'sideTables', 'territory']) diff(rep[k], wk[k], rep.shapes, wk.shapes, k);
        return out;
    });
    note(`replica / worker differences (${when}):\n       ${diffs.join('\n       ')}`);
    writeFileSync(`${out}/digest-diff-${when.replace(/[^a-z0-9]+/gi, '-')}.txt`, diffs.join('\n'));
}

// ---------------------------------------------------------------------------------------------------------------
// The session.
// ---------------------------------------------------------------------------------------------------------------
const ALL_UI_STEPS = [
    ['colonies', stepColonies], ['ships', stepShips], ['research', stepResearch], ['left sidebar', stepLeftSidebar],
    ['orders', stepOrders], ['fleets', stepFleets], ['designs', stepDesigns], ['build order', stepBuildOrder],
    ['yards', stepYards], ['troops', stepTroops], ['expansion', stepExpansion], ['summary', stepSummary],
    ['policy', stepPolicy], ['diplomacy', stepDiplomacy], ['control groups', stepControlGroups], ['keys', stepKeys],
    ['game options', stepGameOptions], ['other screens', stepOtherScreens],
];
// --only=a,b: just these UI steps (names as above; also 'saveload', 'story', 'autosave', 'crash'), a short play between.
const only = opt('only', '') === '' ? null : opt('only', '').split(',');
const UI_STEPS = only === null ? ALL_UI_STEPS : ALL_UI_STEPS.filter(([n]) => only.includes(n));
try {
    step = 'boot';
    const info = await act('boot', boot, { timeoutMs: 900000, settleReplies: false });
    void info;
    // --warm=<game s>: play that long at 4× before the session (a later game for --only probes).
    if (Number(opt('warm', '0')) > 0) await act('warm up 4x', () => play(Number(opt('warm', '0')) * 1000, 4), { timeoutMs: 3600000 });
    const totalMs = years * GAME_YEAR_MS;
    const speeds = [1, 2, 4];
    // Play and use the UI in turns: a segment of play, then the next UI step (some with the clock running).
    let si = 0;
    let ui = 0;
    const segment = Math.max(20000, totalMs / (UI_STEPS.length + 6));
    const midSave = Math.floor(UI_STEPS.length / 2);
    if (UI_STEPS.length === 0 && only !== null && only.includes('saveload')) await act('save, main menu, load, continue', stepSaveLoad, { timeoutMs: 900000 });
    while (playedMs < totalMs || ui < UI_STEPS.length) {
        if (playedMs < totalMs) await act(`play ${speeds[si % 3]}x`, () => play(Math.min(segment, totalMs - playedMs + 1000), speeds[si % 3]), { timeoutMs: 1800000 });
        si++;
        if (ui < UI_STEPS.length) {
            const [name, fn] = UI_STEPS[ui];
            // Every other screen step with the clock running at 1×, as a player does; the others paused.
            if (ui % 2 === 0) await pause(true);
            else {
                await setSpeed(1);
                await pause(false);
            }
            // A window left from before (the game end opens the Empire Comparison) would take the step's clicks.
            await closeAll().catch(() => {});
            await act(name, fn);
            await handlePopups();
            if (only === null ? ui === midSave : ui === UI_STEPS.length - 1 && only.includes('saveload')) {
                await act('save, main menu, load, continue', stepSaveLoad, { timeoutMs: 900000 });
                if (only === null ? kind === 'shakturi' || kind === 'standard' : only.includes('story')) await act('story panel', stepStoryPanel);
            }
            ui++;
        }
        if (playedMs >= totalMs && ui >= UI_STEPS.length) break;
    }
    if (kind === 'gameend') check(gameEndSeen !== null, `the sim ended the game and the Game End panel showed (${String(gameEndSeen).replace(/\s+/g, ' ').slice(0, 120)})`);
    if (only === null || only.includes('autosave')) await act('autosave', stepAutosave, { timeoutMs: 300000 });
    await act('write check', async () => {
        await stepWriteCheck('after the campaign');
        await digestsMatch('after the campaign');
    }, { timeoutMs: 300000 });
    if (!inThread && kind !== 'late2500' && !flag('no-replay')) await act('replay capture', captureForReplay, { timeoutMs: 600000 });
    if (!inThread && !flag('no-crash') && (only === null || only.includes('crash'))) {
        await act('crash fatal', () => stepCrash('fatal'), { timeoutMs: 900000 });
        await act('play after restart', () => play(15000, 2), { timeoutMs: 600000 });
        await act('orders after restart', stepColonies);
        await act('crash hard', () => stepCrash('hard'), { timeoutMs: 900000 });
        await act('play after restart 2', () => play(15000, 4), { timeoutMs: 600000 });
        await act('orders after restart 2', stepTroops);
    }
    await act('end', async () => {
        await pause(true);
        await shot('end');
        const st = await ev(() => ({ nowMs: window.__dwu.galaxy.nowMs, colonies: window.__dwu.game.playerEmpire.colonies.length, ships: window.__dwu.game.playerEmpire.builtObjects.length, money: Math.round(window.__dwu.game.playerEmpire.stateMoney), stats: window.__dwu.simStats ? { maxHot: window.__dwu.simStats.maxHotApplyMs, maxCold: window.__dwu.simStats.maxColdPumpMs, maxSync: window.__dwu.simStats.maxSimMsPerRenderFrame } : null }));
        note(`end state: ${JSON.stringify(st)}`);
    });
} catch (err) {
    check(false, `session error: ${err instanceof Error ? err.stack : String(err)}`);
} finally {
    await browser.close().catch(() => {});
}

// Headless replay (outside the browser).
if (replayFiles) {
    step = 'replay';
    console.log('  -- replay check (node, headless)');
    const r = spawnSync('nice', ['-n', '15', 'node', resolve(root, 'scripts/simworker-replay-check.mjs'), replayFiles.json, replayFiles.save], { encoding: 'utf8', maxBuffer: 1 << 28 });
    const text = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    for (const l of text.split('\n').filter((l) => l.trim())) console.log(`     ${l}`);
    // Informational: node's libm differs from this Chromium's in the last bit (see browserReplay), so a browser session
    // does not replay bit-exact in node in either mode.
    note(`node replay (another V8: ${process.version}): ${r.status === 0 ? 'identical' : 'differs (cross-engine Math)'}`);
}

const errors = consoleLines.filter((l) => (l.type === 'error' || l.type === 'pageerror') && !l.expected);
for (const e of errors.slice(0, 40)) console.log(`[${e.type} @ ${e.step}] ${e.text.slice(0, 400)}`);
if (errors.length > 0) check(false, `${errors.length} console error(s)`);
const summary = { kind, mode, years, wallS: (Date.now() - t0) / 1000, playedMs, failed, results, steps, consoleLines, popupsSeen, choicesTaken, pirateTributeTaken, gameEndSeen, hash: createHash('sha1').update(JSON.stringify(results.filter((r) => 'ok' in r).map((r) => [r.step, r.ok]))).digest('hex').slice(0, 12) };
writeFileSync(`${out}/campaign.json`, JSON.stringify(summary, null, 1));
console.log(`saved ${out}/campaign.json; ${results.filter((r) => r.ok === true).length} ok, ${failed} failed, ${errors.length} console errors, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
console.log(failed === 0 ? 'CAMPAIGN OK' : `CAMPAIGN FAILED (${failed})`);
process.exitCode = failed === 0 ? 0 : 1;
