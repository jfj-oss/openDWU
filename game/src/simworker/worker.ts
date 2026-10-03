// Sim worker entry (docs/sim-worker.md §2): a module Web Worker that owns the authoritative game. It loads the DW:U
// data from the same /assets/dwu URLs the main thread uses, creates or loads the game, sends the replica snapshot, then
// runs the step loop on its own timer (one tick per FRAME_REAL_MS of real time, SimFrameBudget semantics) and posts
// one step message per tick. Commands, the clock and save requests arrive as messages.
//
// Bundled by Vite as a separate module worker (src/simworker/workerClient.ts: new Worker(new URL('./worker.ts', ...))).
// No DOM: only fetch, timers and postMessage.

import { loadGameData, type FetchText, type GameData } from '../sim/data/gameData';
import { createGameSteps, installGameStatics, registerGameHooks, type Game } from '../sim/game';
import { reviveCreateOptions } from './bootOptions';
import { GalaxyTime } from '../sim/galaxyTime';
import { deserializeGame } from '../sim/save/gameSave';
import { loadScenarioIndex, loadScenarioOverlay } from '../sim/scenario/fetchScenario';
import { applyScenarioOverlay, type ScenarioOverlay } from '../sim/scenario/overlay';
import { scenarioOverlayFor } from '../sim/scenario/addons';
import { FRAME_REAL_MS } from '../sim/tick/scheduler';
import { SimHost } from './simHost';
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

async function gameDataFor(scenario: { id: string; include: string[] | null } | null): Promise<GameData> {
    const base = await loadGameData(fetchText);
    if (scenario === null) return base;
    const overlays = new Map<string, ScenarioOverlay>();
    for (const m of await loadScenarioIndex(fetchText)) overlays.set(m.id, await loadScenarioOverlay(fetchText, m));
    return applyScenarioOverlay(base, scenarioOverlayFor(scenario.id, scenario.include, overlays));
}

let host: SimHost | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let last = 0;
/** Messages that arrived before the game existed. */
const early: ToWorker[] = [];

async function init(m: InitMessage): Promise<void> {
    post({ type: 'progress', step: 'Loading game data', fraction: 0 });
    const gameData = await gameDataFor(m.boot.scenario);
    installGameStatics(gameData);
    registerGameHooks();
    let game: Game;
    let time: GalaxyTime;
    if (m.boot.kind === 'create') {
        const steps = createGameSteps(reviveCreateOptions(m.boot.options, gameData));
        let lastPost = 0;
        for (;;) {
            const r = steps.next();
            if (r.done === true) {
                game = r.value;
                break;
            }
            if (performance.now() - lastPost > 50) {
                lastPost = performance.now();
                post({ type: 'progress', step: r.value.step, fraction: r.value.fraction });
            }
        }
        if (m.boot.flagShapeIndex !== undefined && m.boot.flagShapeIndex >= 0) game.playerEmpire.flagShape = m.boot.flagShapeIndex;
        time = new GalaxyTime();
    } else {
        post({ type: 'progress', step: `Reading save (${Math.max(1, Math.round(m.boot.text.length / 1048576))} MB)`, fraction: 0.2 });
        const loaded = deserializeGame(m.boot.text, gameData);
        game = loaded.game;
        time = loaded.time;
    }
    if (m.clock !== undefined) {
        time.speed = m.clock.speed;
        time.paused = m.clock.paused;
    }
    post({ type: 'progress', step: 'Preparing map', fraction: 0.9 });
    // The browser game always has the message UI: the worker is the player's message recipient (docs §9 chunk 4).
    host = new SimHost(game, time, m.startOptions, { sync: m.sync, playerMessages: true });
    post(host.snapshot());
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
            kick();
            return;
        case 'command':
            host!.command(m);
            kick();
            return;
        case 'uiOp':
            host!.uiOp(m);
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
        case 'dispose':
            if (timer !== null) clearTimeout(timer);
            timer = null;
            host?.dispose();
            host = null;
            return;
    }
}

scope.onmessage = (e: MessageEvent) => handle(e.data as ToWorker);
