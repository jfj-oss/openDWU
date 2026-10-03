// Sim worker: the main thread's handle on the worker (docs/sim-worker.md §2): starts it, waits for the snapshot (with
// the loading overlay's progress), builds the replica (SimClientCore) and offers the app a frame loop with the same
// shape as the in-thread one (simLoop.ts SimLoop), plus async save / digest requests.

import type { GameData } from '../sim/data/gameData';
import type { GalaxyTime } from '../sim/galaxyTime';
import type { RenderTime } from '../render/renderInterp';
import { SimClientCore, type SyncStats } from './clientCore';
import type { FromWorker, InitMessage, SnapshotMessage, ToWorker, WorkerEvent } from './protocol';
import { installReplicaWriteDetector, writeDetectorMode } from './writeDetector';

/** What main.ts drives every render frame (the in-thread SimLoop's shape, minus its driver / budget). */
export interface WorkerSimLoop {
    stats: SyncStats;
    renderTime: RenderTime;
    /** Once per render frame (realDtMs is unused: the worker keeps its own real-time clock). */
    tick(realDtMs: number): number;
}

export interface BootProgress {
    update(p: { step: string; fraction: number }): void;
}

export class SimWorkerClient {
    private readonly waiting = new Map<number, (m: FromWorker) => void>();
    private nextRequest = 1;
    private eventHandler: ((e: WorkerEvent, resolve: (a: unknown) => unknown) => void) | null = null;
    private disposed = false;

    private constructor(
        private readonly worker: Worker,
        readonly core: SimClientCore,
    ) {}

    /** Start the worker, boot its game, and build the replica from its snapshot. */
    static boot(init: InitMessage, gameData: GameData, progress?: BootProgress): Promise<SimWorkerClient> {
        const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'dwu-sim' });
        return new Promise<SimWorkerClient>((resolve, reject) => {
            let client: SimWorkerClient | null = null;
            const post = (m: ToWorker): void => worker.postMessage(m);
            worker.onerror = (e) => {
                if (client === null) reject(new Error(`sim worker failed to start: ${e.message}`));
                else console.error('sim worker error', e);
            };
            worker.onmessage = (e: MessageEvent) => {
                const m = e.data as FromWorker;
                if (client !== null) {
                    client.onMessage(m);
                    return;
                }
                if (m.type === 'progress') progress?.update(m);
                else if (m.type === 'error') {
                    worker.terminate();
                    reject(new Error(`sim worker: ${m.message}`));
                } else if (m.type === 'snapshot') {
                    try {
                        let c: SimWorkerClient | null = null;
                        const core = new SimClientCore(gameData, m as SnapshotMessage, { post, onEvent: (ev, res) => c?.eventHandler?.(ev, res) });
                        c = new SimWorkerClient(worker, core);
                        // Dev only: `&detectWrites=1|all` reports main-thread writes to the replica (writeDetector.ts).
                        if (import.meta.env.DEV) {
                            const mode = writeDetectorMode(globalThis.location?.search ?? '');
                            if (mode !== null) {
                                const det = installReplicaWriteDetector(core.replica, { trapAll: mode === 'all' });
                                (globalThis as { __dwuWriteDetector?: unknown }).__dwuWriteDetector = det;
                                console.info(`sim worker: replica write detector on (${mode})`);
                            }
                        }
                        client = c;
                        resolve(c);
                    } catch (err) {
                        worker.terminate();
                        reject(err instanceof Error ? err : new Error(String(err)));
                    }
                }
            };
            worker.postMessage(init);
        });
    }

    private onMessage(m: FromWorker): void {
        if (this.disposed) return;
        switch (m.type) {
            case 'step':
                this.core.receive(m);
                return;
            case 'saved':
            case 'digest': {
                const w = this.waiting.get(m.id);
                this.waiting.delete(m.id);
                w?.(m);
                return;
            }
            case 'error':
                console.error(`sim worker: ${m.message}`);
                return;
            default:
                return;
        }
    }

    /** Sim → UI events (game end, location pinged, sim error), with a resolver for their replica objects. */
    onEvent(handler: ((e: WorkerEvent, resolve: (a: unknown) => unknown) => void) | null): void {
        this.eventHandler = handler;
    }

    /** The app's per-frame loop over the replica (apply deltas, pump cold parts, render time). */
    createLoop(time: GalaxyTime): WorkerSimLoop {
        const core = this.core;
        time.bindGalaxy(core.galaxy);
        return {
            stats: core.stats,
            renderTime: core.renderTime,
            tick: () => core.frame(time),
        };
    }

    private request<T extends FromWorker>(m: { type: 'save' | 'digest' }): Promise<T> {
        const id = this.nextRequest++;
        return new Promise<T>((resolve) => {
            this.waiting.set(id, (r) => resolve(r as T));
            this.worker.postMessage({ ...m, id } as ToWorker);
        });
    }

    /** serializeGame text of the authoritative game (null when the worker could not save). */
    async save(): Promise<string | null> {
        const r = await this.request<Extract<FromWorker, { type: 'saved' }>>({ type: 'save' });
        if (r.error !== undefined) console.error(`sim worker save failed: ${r.error}`);
        return r.text;
    }

    /** The authoritative game's state digest (tests / smoke). */
    async digest(): Promise<{ digest: string; nowMs: number; stepSerial: number }> {
        const r = await this.request<Extract<FromWorker, { type: 'digest' }>>({ type: 'digest' });
        return { digest: r.digest, nowMs: r.nowMs, stepSerial: r.stepSerial };
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.worker.postMessage({ type: 'dispose' } satisfies ToWorker);
        this.worker.terminate();
        this.core.dispose();
        this.waiting.clear();
    }
}

/** `?simWorker=1|0` overrides the Settings toggle (default off). */
export function simWorkerEnabled(search: string, setting: boolean): boolean {
    const q = new URLSearchParams(search).get('simWorker');
    if (q === '1' || q === 'true') return true;
    if (q === '0' || q === 'false') return false;
    return setting;
}
