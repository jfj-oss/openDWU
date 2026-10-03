// Sim worker: the main thread's handle on the worker (docs/sim-worker.md §2): starts it, waits for the snapshot (with
// the loading overlay's progress), builds the replica (SimClientCore) and offers the app a frame loop with the same
// shape as the in-thread one (simLoop.ts SimLoop), plus async save / digest requests.

import type { GameData } from '../sim/data/gameData';
import type { GalaxyTime } from '../sim/galaxyTime';
import type { RenderTime } from '../render/renderInterp';
import { SimClientCore, type SyncStats } from './clientCore';
import type { CommandLogEntry } from '../sim/player/commandLog';
import type { DebugReply, DebugRequest, FromWorker, InitMessage, SnapshotMessage, ToWorker, WorkerEvent } from './protocol';
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
    /** Let the browser paint the progress (before the main thread builds the replica, which takes a while). */
    paint?(): Promise<void>;
}

/** The replica's static data: given up front, or chosen once the snapshot names the game's scenario (a load). */
export type ReplicaGameData = GameData | ((snapshot: SnapshotMessage) => GameData);

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
    static boot(init: InitMessage, gameData: ReplicaGameData, progress?: BootProgress): Promise<SimWorkerClient> {
        const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'dwu-sim' });
        return new Promise<SimWorkerClient>((resolve, reject) => {
            let client: SimWorkerClient | null = null;
            /** Messages after the snapshot that arrive while the replica is being built (deltas must apply in order). */
            let backlog: FromWorker[] | null = null;
            let failed = false;
            const post = (m: ToWorker): void => worker.postMessage(m);
            const fail = (err: unknown): void => {
                if (failed) return;
                failed = true;
                worker.terminate();
                reject(err instanceof Error ? err : new Error(String(err)));
            };
            worker.onerror = (e) => {
                if (client === null) fail(new Error(`sim worker failed to start: ${e.message}`));
                else console.error('sim worker error', e);
            };
            const build = async (m: SnapshotMessage): Promise<void> => {
                try {
                    if (progress !== undefined) {
                        progress.update({ step: 'Receiving game state', fraction: 0.95 });
                        await progress.paint?.();
                    }
                    if (failed) return;
                    const data = typeof gameData === 'function' ? gameData(m) : gameData;
                    let c: SimWorkerClient | null = null;
                    const core = new SimClientCore(data, m, { post, onEvent: (ev, res) => c?.eventHandler?.(ev, res) });
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
                    for (const b of backlog ?? []) c.onMessage(b);
                    backlog = null;
                    resolve(c);
                } catch (err) {
                    fail(err);
                }
            };
            worker.onmessage = (e: MessageEvent) => {
                const m = e.data as FromWorker;
                if (client !== null) {
                    client.onMessage(m);
                    return;
                }
                if (failed) return;
                if (backlog !== null) {
                    backlog.push(m);
                    return;
                }
                if (m.type === 'progress') progress?.update(m);
                else if (m.type === 'error') fail(new Error(`sim worker: ${m.message}`));
                else if (m.type === 'snapshot') {
                    backlog = [];
                    void build(m as SnapshotMessage);
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
            case 'digest':
            case 'debug':
            case 'commandLog': {
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

    /** The app's per-frame loop over the replica (apply deltas, pump cold parts, render time). The clock posts its
     *  pause / speed changes to the worker as they are made (SimClientCore.bindClock). */
    createLoop(time: GalaxyTime): WorkerSimLoop {
        const core = this.core;
        time.bindGalaxy(core.galaxy);
        core.bindClock(time);
        return {
            stats: core.stats,
            renderTime: core.renderTime,
            tick: () => core.frame(time),
        };
    }

    private request<T extends FromWorker>(m: { type: 'save' | 'digest' | 'commandLog' } | Omit<DebugRequest, 'id'>): Promise<T> {
        const id = this.nextRequest++;
        return new Promise<T>((resolve, reject) => {
            if (this.disposed) {
                reject(new Error('sim worker: disposed'));
                return;
            }
            this.waiting.set(id, (r) => resolve(r as T));
            this.worker.postMessage({ ...m, id } as ToWorker);
        });
    }

    /** [simworker chunk 1] The authoritative game's command log (`__dwu.commands.log()` in worker mode). */
    async commandLog(): Promise<CommandLogEntry[]> {
        const r = await this.request<Extract<FromWorker, { type: 'commandLog' }>>({ type: 'commandLog' });
        return r.log;
    }

    /** [simworker chunk 1] Read / write / call a member of the worker's SimDriver or SimFrameBudget. */
    async debug(req: Omit<DebugRequest, 'id' | 'type'>): Promise<DebugReply> {
        const r = await this.request<DebugReply>({ type: 'debug', ...req });
        if (r.error !== undefined) throw new Error(`sim worker: ${req.target}.${req.name ?? ''}: ${r.error}`);
        return r;
    }

    /**
     * [simworker chunk 1] `__dwu.sim` / `__dwu.simBudget` in worker mode: a stand-in for the worker's SimDriver /
     * SimFrameBudget. Reading a field gives its last known value (refreshed after every write or call, and by
     * `refresh()`); writing one (`__dwu.sim.maxFrames = 90`) sets it in the worker; any other member is called in the
     * worker and returns a Promise of its result (`await __dwu.sim.advance(1000)`).
     */
    debugObject(target: DebugRequest['target']): Record<string, unknown> {
        const mirror: Record<string, unknown> = {};
        const take = (r: DebugReply): void => {
            Object.assign(mirror, r.state);
        };
        const refresh = async (): Promise<Record<string, unknown>> => {
            take(await this.debug({ target, op: 'get' }));
            return { ...mirror };
        };
        refresh().catch(() => undefined);
        return new Proxy(mirror, {
            get: (t, k) => {
                if (typeof k !== 'string' || k === 'then') return undefined; // not a thenable
                if (k === 'refresh') return refresh;
                if (k === 'remote') return true;
                if (k in t) return t[k];
                return async (...args: unknown[]) => {
                    const r = await this.debug({ target, op: 'call', name: k, args });
                    take(r);
                    return r.value;
                };
            },
            set: (t, k, v) => {
                if (typeof k !== 'string') return false;
                t[k] = v;
                this.debug({ target, op: 'set', name: k, value: v }).then(take, (err: unknown) => console.warn(err));
                return true;
            },
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
