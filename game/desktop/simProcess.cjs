// The sim process (docs/sim-worker.md §4.7): the game page's simulation runs in a hidden window of its own, so in a
// renderer process of its own — with its own V8 heap cage. With pointer compression every isolate of a renderer process
// shares one ~4 GB cage; with the sim worker inside the game page's process, the page and the worker shared it, and a
// 100k-habitat galaxy ran out (a V8 OOM with one isolate at 1.3 GB).
//
// Why a hidden BrowserWindow, not a utilityProcess: the sim is the browser build's worker.ts, unchanged — a module Web
// Worker that fetches /assets/dwu/ over dwu://, posts Blobs and transfers ArrayBuffers. A utility process is a Node
// environment (no Web Worker, no Blob registry shared with the page, no dwu:// fetch), so it would need a Node entry
// and Node shims for what src/ takes from the web platform. A hidden window's page runs the same worker in the same
// session (the default one: its dwu:// handler, so asset loading, and its Blob registry are the game page's), sandboxed
// like the game page.
//
// Wiring: the game page asks for a sim (gamePreload.cjs `dwuDesktop.simProcess.start`), this module opens the window
// (sim.html, desktop/simPreload.cjs) and, once its page listens, hands one end of a MessageChannelMain to each page.
// The sim page passes its end into the worker; from then on the game page and the worker talk directly. The game page
// learns when the process ends (crashed, killed, out of memory, the window closed) through 'dwu:sim-exit', and of an
// uncaught error in its worker through 'dwu:sim-error'; it stops its client as it does for a dead worker (the Restart
// prompt). A sim is killed when its game page asks (terminate), navigates (reload, another page), crashes or closes.
// The sim process's own end goes to crash-log.txt with its last memory sample.
//
// Electron is injected (createSimProcesses({ electron, ... })), so the lifecycle is unit-tested with fakes
// (test/desktopShell.test.ts).
'use strict';

/**
 * @param {{
 *   electron: { BrowserWindow: any, MessageChannelMain: any, app: any },
 *   preload: string,            // simPreload.cjs
 *   url: string,                // the sim page (dwu://app/sim.html)
 *   crashLog: (text: string) => void,
 *   log?: (line: string) => void,
 *   memoryIntervalMs?: number,
 * }} opts
 */
function createSimProcesses(opts) {
    const { BrowserWindow, MessageChannelMain, app } = opts.electron;
    const log = opts.log ?? ((l) => console.log(l));
    /** id -> { id, win, owner (webContents), ending, recent[], lastMemory, timer } */
    const sims = new Map();
    let nextId = 1;
    /** Owners (game webContents) we watch for navigation / crash / close. */
    const watched = new WeakSet();

    function send(owner, channel, payload) {
        try {
            if (!owner.isDestroyed()) owner.send(channel, payload);
        } catch {
            /* the owner is gone */
        }
    }

    function memoryOf(win) {
        try {
            const pid = win.webContents.getOSProcessId();
            const m = app.getAppMetrics().find((x) => x.pid === pid);
            if (!m) return null;
            return { pid, workingSetGB: m.memory.workingSetSize / 1024 / 1024, peakGB: m.memory.peakWorkingSetSize / 1024 / 1024 };
        } catch {
            return null;
        }
    }

    function sample(s) {
        const m = memoryOf(s.win);
        if (m) s.lastMemory = `${new Date().toISOString()} sim process ${m.pid} working set ${m.workingSetGB.toFixed(2)} GB, peak ${m.peakGB.toFixed(2)} GB`;
    }

    /** End a sim on purpose (no exit notice to the page: it asked, or it is gone). */
    function kill(s, why) {
        if (s.ending) return;
        s.ending = true;
        sims.delete(s.id);
        clearInterval(s.timer);
        log(`[sim] process ${s.id} stopped (${why})`);
        try {
            if (!s.win.isDestroyed()) s.win.destroy();
        } catch {
            /* already gone */
        }
    }

    /** The sim ended by itself: crash log, the page is told, the window is cleaned up. */
    function gone(s, reason, details) {
        if (s.ending) return;
        const line =
            `${new Date().toISOString()} sim process render-process-gone reason=${details.reason} exitCode=${details.exitCode}${opts.version ? ` version=${opts.version}` : ''}\n` +
            (s.lastMemory !== '' ? `  last memory sample: ${s.lastMemory}\n` : '') +
            (s.recent.length > 0 ? `  last sim warnings / errors:\n${s.recent.map((l) => `    ${l}`).join('\n')}\n` : '');
        if (details.log !== false) {
            console.error(`[crash] ${line.trim()}`);
            opts.crashLog(line);
        }
        send(s.owner, 'dwu:sim-exit', { id: s.id, reason });
        kill(s, reason);
    }

    function killOwned(owner, why) {
        for (const s of [...sims.values()]) if (s.owner === owner) kill(s, why);
    }

    function watchOwner(owner) {
        if (watched.has(owner)) return;
        watched.add(owner);
        // A new document in the game window (reload, the main menu's reload, another page): its sims are orphans.
        owner.on('did-start-navigation', (event, legacyUrl, legacyInPlace, legacyMainFrame) => {
            const isMainFrame = event?.isMainFrame ?? legacyMainFrame;
            const sameDocument = event?.isSameDocument ?? legacyInPlace;
            if (isMainFrame && !sameDocument) killOwned(owner, 'the game page navigated');
        });
        owner.on('render-process-gone', () => killOwned(owner, 'the game page is gone'));
        owner.on('destroyed', () => killOwned(owner, 'the game window closed'));
    }

    /** Open a sim process for `owner` (the game page's webContents); returns its id. */
    function start(owner) {
        watchOwner(owner);
        const id = nextId++;
        const win = new BrowserWindow({
            show: false,
            width: 320,
            height: 200,
            skipTaskbar: true,
            focusable: false,
            title: 'openDWU simulation',
            webPreferences: {
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
                // A hidden window's page would get background priority and throttled timers: the sim keeps its pace.
                backgroundThrottling: false,
                spellcheck: false,
                preload: opts.preload,
            },
        });
        const s = { id, win, owner, ending: false, recent: [], lastMemory: '', timer: null, connected: false };
        sims.set(id, s);
        s.timer = setInterval(() => sample(s), opts.memoryIntervalMs ?? 15000);
        const wc = win.webContents;
        wc.on('console-message', (event, ...legacy) => {
            const level = event?.level ?? (['verbose', 'info', 'warning', 'error'][legacy[0]] || String(legacy[0]));
            const message = event?.message ?? legacy[1];
            if (level !== 'warning' && level !== 'error') return;
            if (/Electron Security Warning/.test(String(message))) return; // unpackaged runs only, not the sim's
            s.recent.push(`${new Date().toISOString()} [${level}] ${String(message).slice(0, 500)}`);
            if (s.recent.length > 40) s.recent.shift();
        });
        wc.on('render-process-gone', (_e, details) => {
            sample(s);
            gone(s, `the simulation process ended (${details.reason}, exit code ${details.exitCode})`, details);
        });
        win.on('closed', () => gone(s, 'the simulation window was closed', { reason: 'closed', exitCode: 0, log: false }));
        wc.on('will-navigate', (e) => e.preventDefault());
        wc.setWindowOpenHandler?.(() => ({ action: 'deny' }));
        win.loadURL(opts.url);
        log(`[sim] process ${id} starting for game page ${owner.id}`);
        return id;
    }

    /** The sim page listens (simPreload 'dwu-sim:ready'): give it and its game page the two ends of a channel. */
    function ready(sender) {
        const s = [...sims.values()].find((x) => x.win.webContents === sender);
        if (!s || s.connected) return false;
        s.connected = true;
        const { port1, port2 } = new MessageChannelMain();
        sender.postMessage('dwu-sim:port', null, [port1]);
        s.owner.postMessage('dwu:sim-port', { id: s.id }, [port2]);
        const m = memoryOf(s.win);
        log(`[sim] process ${s.id} connected (pid ${m ? m.pid : '?'}, game page pid ${safePid(s.owner)})`);
        return true;
    }

    function safePid(wc) {
        try {
            return wc.getOSProcessId();
        } catch {
            return '?';
        }
    }

    /** The game page stops its sim (its client's terminate). Only the owner may. */
    function terminate(sender, id) {
        const s = sims.get(id);
        if (s && s.owner === sender) kill(s, 'terminated by the game page');
    }

    /** An uncaught error in the sim's worker (simPreload 'dwu-sim:worker-error'): to its game page. */
    function workerError(sender, message) {
        const s = [...sims.values()].find((x) => x.win.webContents === sender);
        if (s) send(s.owner, 'dwu:sim-error', { id: s.id, message: String(message).slice(0, 2000) });
    }

    /** The live sims (for the game window's memory sample and tests). */
    function list() {
        return [...sims.values()].map((s) => ({ id: s.id, owner: s.owner, win: s.win, memory: memoryOf(s.win) }));
    }

    function killAll(why) {
        for (const s of [...sims.values()]) kill(s, why);
    }

    return { start, ready, terminate, workerError, list, killAll, isSimContents: (wc) => [...sims.values()].some((s) => s.win.webContents === wc) };
}

module.exports = { createSimProcesses };
