// Sim worker entry (docs/sim-worker.md §2): a module Web Worker that owns the authoritative game. It loads the DW:U
// data from the same /assets/dwu URLs the main thread uses, creates or loads the game, sends the replica snapshot, then
// runs the step loop on its own timer (one tick per FRAME_REAL_MS of real time, SimFrameBudget semantics) and posts
// one step message per tick. Commands, the clock and save requests arrive as messages.
//
// Bundled by Vite as a separate module worker (src/simworker/workerClient.ts: new Worker(new URL('./worker.ts', ...))).
// No DOM: only fetch, timers and postMessage.

import { setBattleReportsEnabled } from '../sim/battleReports/hooks';
import { loadGameData, type FetchText, type GameData } from '../sim/data/gameData';
import { activeCustomizationSet } from '../sim/data/customization';
import { activateTheme } from '../themeLoader';
import { loadScenarioIndex, loadScenarioOverlay } from '../sim/scenario/fetchScenario';
import type { ScenarioOverlay } from '../sim/scenario/overlay';
import { FRAME_REAL_MS } from '../sim/tick/scheduler';
import { installWorkerBootState, SimHost } from './simHost';
import { bootWorkerGame } from './workerBoot';
import { deltaTransferables } from './replicaSync';
import { ALIVE_INTERVAL_MS, type FromWorker, type InitMessage, type ToWorker } from './protocol';

interface WorkerScope {
    postMessage(m: unknown, transfer?: Transferable[]): void;
    onmessage: ((e: MessageEvent) => void) | null;
}
/**
 * Where messages go: this worker's own scope, or — in the desktop app's sim process (simProcessPage.ts) — the
 * MessagePort to the game page that the hosting page hands over first (`{ type: 'connectPort' }` with the port).
 */
let scope = self as unknown as WorkerScope;

/** When the worker last posted (performance.now; ALIVE_INTERVAL_MS). */
let lastPostAt = 0;

function post(m: FromWorker): void {
    lastPostAt = performance.now();
    if (m.type === 'step' || m.type === 'snapshot') scope.postMessage(m, deltaTransferables(m.delta));
    else scope.postMessage(m);
}

const fetchText: FetchText = async (candidates: string[]): Promise<string> => {
    for (const url of candidates) {
        try {
            const r = await fetch(url);
            if (r.ok) return await r.text();
        } catch {
            // next candidate
        }
    }
    throw new Error(`Could not load any of: ${candidates.join(', ')}`);
};

// Data loaders (cached: one fetch per worker).
let baseData: Promise<GameData> | null = null;
let overlays: Promise<Map<string, ScenarioOverlay>> | null = null;
const bootDeps = {
    // The theme the main thread runs (InitMessage.customizationSet, activated in init before any data loads).
    baseData: (): Promise<GameData> => (baseData ??= loadGameData(fetchText, activeCustomizationSet() ?? undefined)),
    overlays: (): Promise<Map<string, ScenarioOverlay>> =>
        (overlays ??= (async () => {
            const out = new Map<string, ScenarioOverlay>();
            for (const m of await loadScenarioIndex(fetchText)) out.set(m.id, await loadScenarioOverlay(fetchText, m));
            return out;
        })()),
    fetchSave: async (url: string): Promise<string> => {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`save ${url}: HTTP ${r.status}`);
        return await r.text();
    },
    progress: (step: string, fraction: number): void => post({ type: 'progress', step, fraction }),
};

let host: SimHost | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
/** Set once the game stopped for good (fatal): the step loop and the sync threw, nothing is answered any more. */
let dead: string | null = null;
let last = 0;
/** Messages that arrived before the game existed. */
const early: ToWorker[] = [];

async function init(m: InitMessage): Promise<void> {
    setBattleReportsEnabled(m.battleReports !== false);
    if (m.customizationSet !== undefined && m.customizationSet !== '') await activateTheme(m.customizationSet);
    // A load's save text is dropped once parsed (bootWorkerGame): the worker keeps only the game (a late save is 100+ MB).
    const booted = await bootWorkerGame(m.boot, bootDeps);
    const time = booted.time;
    if (m.clock !== undefined) {
        time.speed = m.clock.speed;
        time.paused = m.clock.paused;
    }
    const startOptions = booted.startOptions ?? m.startOptions;
    if (startOptions === undefined) throw new Error('sim worker init: no start options');
    post({ type: 'progress', step: 'Preparing map', fraction: 0.9 });
    installWorkerBootState(booted.game.galaxy);
    // The browser game always has the message UI: the worker is the player's message recipient (docs §9 chunk 4).
    host = new SimHost(booted.game, time, startOptions, { sync: m.sync, playerMessages: true });
    post({ ...host.snapshot(), scenario: booted.scenario });
    for (const e of early.splice(0)) handle(e);
    last = performance.now();
    loop();
}

/**
 * The game cannot go on (the step loop or the replica sync threw — the sim's own errors are contained by SimHost.tick,
 * so this is the sync or the host itself): stop the loop and tell the main thread, which fails everything waiting on
 * this worker (docs/sim-worker.md §4.4 "Failed commands") instead of waiting for replies that will never come.
 */
function fatal(where: string, err: unknown): void {
    if (dead !== null) return;
    dead = `${where}: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`sim worker: STOPPED (${where})`, err);
    if (timer !== null) clearTimeout(timer);
    timer = null;
    // The sim's own errors are contained by SimHost.tick, so the game is usually intact here (the sync or the host
    // failed): save it for the main thread's restart offer (restart.ts), if it still serializes.
    let rescue: Blob | null = null;
    try {
        rescue = host !== null ? host.rescueSaveBlob() : null;
    } catch (err) {
        console.error('sim worker: the game could not be saved for a restart', err);
    }
    post({ type: 'error', message: dead, fatal: true, rescue });
}

function loop(): void {
    timer = null;
    const h = host;
    if (h === null || dead !== null) return;
    const now = performance.now();
    const dt = now - last;
    last = now;
    let msg: ReturnType<SimHost['tick']>;
    try {
        msg = h.tick(dt);
        if (msg !== null) post(msg);
        else if (now - lastPostAt >= ALIVE_INTERVAL_MS) post({ type: 'alive' });
    } catch (err) {
        fatal('step loop', err);
        return;
    }
    // Next tick when the next step is due (paused: poll for commands / clock changes at the step rate).
    const delay = h.time.paused ? FRAME_REAL_MS : Math.max(0, FRAME_REAL_MS - h.budget.backlogMs);
    timer = setTimeout(loop, delay);
}

/**
 * Run a tick next (a command or a clock change while paused lands without waiting for the poll). As a task of its own,
 * not inside this message: the commands the main thread posted together (one UI action, e.g. assign a mission and frame
 * it) arrive as consecutive messages and reach the same boundary, as in-thread (remoteArgs.ts RemoteValues).
 */
function kick(): void {
    if (timer !== null && host !== null && host.time.paused) {
        clearTimeout(timer);
        timer = setTimeout(loop, 0);
    }
}

/**
 * [simworker chunk 1] A clock change ticks at once, running or paused: a pause is then acknowledged (a step message
 * echoing its seq) without waiting for the next timer, so the main thread's optimistic pause hold is short.
 */
function kickNow(): void {
    if (timer !== null && host !== null) {
        clearTimeout(timer);
        loop();
    }
}

/** Request messages whose sender waits for an answer under their id (an error answers them). */
function requestId(m: ToWorker): number | undefined {
    return m.type === 'save' || m.type === 'digest' || m.type === 'debug' || m.type === 'commandLog' ? m.id : undefined;
}

function handle(m: ToWorker): void {
    if (dead !== null) {
        // Nothing runs any more; a request still gets its answer (an error), the main thread knows the rest.
        const id = requestId(m);
        if (id !== undefined) post({ type: 'error', message: `the game stopped (${dead})`, id });
        return;
    }
    try {
        dispatch(m);
    } catch (err) {
        // The host's command / host-op / UI-op paths contain their own errors (an error reply); what is left is
        // a request handler or the host itself. A request gets an error answer; the rest is logged on the main thread.
        console.error(`sim worker: ${m.type} failed`, err);
        post({ type: 'error', message: `${m.type} failed: ${err instanceof Error ? err.message : String(err)}`, id: requestId(m) });
    }
}

function dispatch(m: ToWorker): void {
    if (host === null) {
        if (m.type !== 'init') {
            early.push(m);
            return;
        }
    }
    switch (m.type) {
        case 'init':
            init(m).catch((err: unknown) => post({ type: 'error', message: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err) }));
            return;
        case 'clock':
            host!.clock(m);
            kickNow();
            return;
        case 'command':
            host!.command(m);
            kick();
            return;
        case 'refresh':
            host!.refresh(m);
            kick();
            return;
        case 'hostOp':
            host!.hostOp(m);
            kick();
            return;
        case 'tradeFlows':
            host!.setTradeFlowRecording(m);
            kick();
            return;
        case 'view':
            host!.setView(m);
            return;
        case 'save': {
            try {
                post({ type: 'saved', id: m.id, blob: host!.saveBlob() });
            } catch (err) {
                post({ type: 'saved', id: m.id, blob: null, error: err instanceof Error ? err.message : String(err) });
            }
            return;
        }
        case 'digest':
            post({ type: 'digest', id: m.id, digest: host!.digest(), nowMs: host!.galaxy.nowMs, stepSerial: host!.serial });
            return;
        case 'debug':
            post(host!.debug(m));
            kick();
            return;
        case 'commandLog':
            post({ type: 'commandLog', id: m.id, log: host!.commandLog() });
            return;
        case 'simulateFatal':
            fatal('step loop', new Error(m.message));
            return;
        case 'dispose':
            if (timer !== null) clearTimeout(timer);
            timer = null;
            host?.dispose();
            host = null;
            return;
    }
}

scope.onmessage = (e: MessageEvent) => {
    const port = e.ports?.[0];
    if ((e.data as { type?: unknown } | null)?.type === 'connectPort' && port !== undefined) {
        // The desktop sim process: the game page is on the other end of this port; everything goes through it.
        scope = port as unknown as WorkerScope;
        scope.onmessage = (pe: MessageEvent) => handle(pe.data as ToWorker);
        return;
    }
    handle(e.data as ToWorker);
};
