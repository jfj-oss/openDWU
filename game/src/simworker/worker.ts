// Sim worker entry (docs/sim-worker.md §2): a module Web Worker that owns the authoritative game. It loads the DW:U
// data from the same /assets/dwu URLs the main thread uses, creates or loads the game, sends the replica snapshot, then
// runs the step loop on its own timer (one tick per FRAME_REAL_MS of real time, SimFrameBudget semantics) and posts
// one step message per tick. Commands, the clock and save requests arrive as messages.
//
// Bundled by Vite as a separate module worker (src/simworker/workerClient.ts: new Worker(new URL('./worker.ts', ...))).
// No DOM: only fetch, timers and postMessage.

import { loadGameData, type FetchText, type GameData } from '../sim/data/gameData';
import { loadScenarioIndex, loadScenarioOverlay } from '../sim/scenario/fetchScenario';
import type { ScenarioOverlay } from '../sim/scenario/overlay';
import { FRAME_REAL_MS } from '../sim/tick/scheduler';
import { SimHost } from './simHost';
import { bootWorkerGame } from './workerBoot';
import { deltaTransferables } from './replicaSync';
import type { FromWorker, InitMessage, ToWorker } from './protocol';

interface WorkerScope {
    postMessage(m: unknown, transfer?: Transferable[]): void;
    onmessage: ((e: MessageEvent) => void) | null;
}
const scope = self as unknown as WorkerScope;

function post(m: FromWorker): void {
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
    baseData: (): Promise<GameData> => (baseData ??= loadGameData(fetchText)),
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
let last = 0;
/** Messages that arrived before the game existed. */
const early: ToWorker[] = [];

async function init(m: InitMessage): Promise<void> {
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
    host = new SimHost(booted.game, time, startOptions, { sync: m.sync });
    post({ ...host.snapshot(), scenario: booted.scenario });
    for (const e of early.splice(0)) handle(e);
    last = performance.now();
    loop();
}

function loop(): void {
    timer = null;
    const h = host;
    if (h === null) return;
    const now = performance.now();
    const dt = now - last;
    last = now;
    const msg = h.tick(dt);
    if (msg !== null) post(msg);
    // Next tick when the next step is due (paused: poll for commands / clock changes at the step rate).
    const delay = h.time.paused ? FRAME_REAL_MS : Math.max(0, FRAME_REAL_MS - h.budget.backlogMs);
    timer = setTimeout(loop, delay);
}

/** Run a tick now (a command or a clock change while paused lands without waiting for the poll). */
function kick(): void {
    if (timer !== null && host !== null && host.time.paused) {
        clearTimeout(timer);
        loop();
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

function handle(m: ToWorker): void {
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
        case 'save': {
            try {
                post({ type: 'saved', id: m.id, text: host!.save() });
            } catch (err) {
                post({ type: 'saved', id: m.id, text: null, error: err instanceof Error ? err.message : String(err) });
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
        case 'dispose':
            if (timer !== null) clearTimeout(timer);
            timer = null;
            host?.dispose();
            host = null;
            return;
    }
}

scope.onmessage = (e: MessageEvent) => handle(e.data as ToWorker);
