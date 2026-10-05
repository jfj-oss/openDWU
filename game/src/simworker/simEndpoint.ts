// The main thread's line to the sim (docs/sim-worker.md §4.7): one shape for the two places the sim runs.
//
// - WebWorkerEndpoint: a Web Worker of this page (the browser, and the desktop app with `?simProcess=0`). The worker
//   shares this renderer process — and its V8 pointer-compression cage (~4 GB for every isolate of the process) — with
//   the page.
// - MessagePortEndpoint: the desktop app's sim process (desktop/simProcess.cjs): a hidden window of its own whose page
//   (src/simworker/simProcessPage.ts) runs the same worker.ts in a Web Worker and hands it one end of a MessageChannel;
//   the other end arrives here. The sim gets its own process and so its own cage.
//
// Both deliver the same messages (structured clone, transfers, Blobs) and report the same failures: an uncaught error
// in the worker (onerror), a message that could not be read (onmessageerror) and — the process only — its end
// (onexit: killed, crashed, out of memory). Platform-neutral: the desktop bridge is a plain object the shell's preload
// puts on window (desktop/gamePreload.cjs); no Node or Electron API is used here.

import type { ToWorker } from './protocol';

export interface SimEndpoint {
    postMessage(m: ToWorker, transfer?: Transferable[]): void;
    onmessage: ((e: MessageEvent) => void) | null;
    /** A message from the sim could not be deserialized. */
    onmessageerror: (() => void) | null;
    /** An exception nothing in the worker caught (its message). */
    onerror: ((message: string) => void) | null;
    /** The sim is gone without a word from it (its process ended: killed, crashed, out of memory). Why, in words. */
    onexit: ((reason: string) => void) | null;
    /** Stop the sim now; nothing is delivered afterwards. */
    terminate(): void;
}

/** What a Worker offers (the DOM type, narrowed so tests can pass a fake). */
export interface WorkerLike {
    postMessage(m: unknown, transfer: Transferable[]): void;
    onmessage: ((e: MessageEvent) => void) | null;
    onmessageerror: ((e: MessageEvent) => void) | null;
    onerror: ((e: ErrorEvent) => void) | null;
    terminate(): void;
}

/** A Web Worker of this page, as it always was. */
export class WebWorkerEndpoint implements SimEndpoint {
    onmessage: ((e: MessageEvent) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    onerror: ((message: string) => void) | null = null;
    onexit: ((reason: string) => void) | null = null;

    constructor(private readonly worker: WorkerLike) {
        worker.onmessage = (e) => this.onmessage?.(e);
        worker.onmessageerror = () => this.onmessageerror?.();
        worker.onerror = (e) => this.onerror?.(e.message);
    }

    postMessage(m: ToWorker, transfer: Transferable[] = []): void {
        this.worker.postMessage(m, transfer);
    }

    terminate(): void {
        this.worker.terminate();
    }
}

/** What MessagePortEndpoint needs of a MessagePort (the DOM type, narrowed for tests). */
export interface PortLike {
    postMessage(m: unknown, transfer: Transferable[]): void;
    onmessage: ((e: MessageEvent) => void) | null;
    onmessageerror: ((e: MessageEvent) => void) | null;
    close(): void;
}

/**
 * A sim reached over a MessagePort that arrives later (the desktop sim process starts in the background). Messages
 * posted before the port is there are queued, with their transfers, and go out in order once it is. `terminate`
 * closes the port and asks the owner to end the process (`kill`); the owner reports the process's end with `exited`
 * and an uncaught error in its worker with `failed`.
 */
export class MessagePortEndpoint implements SimEndpoint {
    onmessage: ((e: MessageEvent) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    onerror: ((message: string) => void) | null = null;
    onexit: ((reason: string) => void) | null = null;
    private port: PortLike | null = null;
    private queue: { m: ToWorker; transfer: Transferable[] }[] = [];
    private ended = false;

    constructor(port: Promise<PortLike>, private readonly kill: () => void) {
        port.then(
            (p) => this.connect(p),
            (err: unknown) => this.exited(`the simulation process did not start (${err instanceof Error ? err.message : String(err)})`),
        );
    }

    private connect(p: PortLike): void {
        if (this.ended) {
            p.close();
            return;
        }
        this.port = p;
        p.onmessage = (e) => {
            if (!this.ended) this.onmessage?.(e);
        };
        p.onmessageerror = () => {
            if (!this.ended) this.onmessageerror?.();
        };
        for (const q of this.queue.splice(0)) p.postMessage(q.m, q.transfer);
    }

    postMessage(m: ToWorker, transfer: Transferable[] = []): void {
        if (this.ended) return;
        if (this.port === null) this.queue.push({ m, transfer });
        else this.port.postMessage(m, transfer);
    }

    /** The owner: the sim process ended (it was not terminated from here). Reported once; nothing follows it. */
    exited(reason: string): void {
        if (this.ended) return;
        this.end();
        this.onexit?.(reason);
    }

    /** The owner: an exception nothing in the sim's worker caught. */
    failed(message: string): void {
        if (!this.ended) this.onerror?.(message);
    }

    private end(): void {
        this.ended = true;
        this.queue = [];
        if (this.port !== null) {
            this.port.onmessage = null;
            this.port.onmessageerror = null;
            this.port.close();
        }
        this.kill();
    }

    terminate(): void {
        if (!this.ended) this.end();
    }
}

/**
 * The desktop shell's sim-process bridge (desktop/gamePreload.cjs `dwuDesktop.simProcess`). `start` opens a sim
 * process and resolves its id; its port then arrives as a window message `{ dwuSimPort: id }` carrying the port (a
 * MessagePort cannot cross the context bridge). `onExit` / `onError` report each process's end and its worker's
 * uncaught errors, by id.
 */
export interface DesktopSimProcessBridge {
    start(): Promise<number>;
    terminate(id: number): void;
    onExit(cb: (id: number, reason: string) => void): void;
    onError(cb: (id: number, message: string) => void): void;
}

interface PortWindow {
    addEventListener(type: 'message', l: (e: MessageEvent) => void): void;
}

/** The bridge when this page runs in the desktop app with sim processes, else null (`?simProcess=0`: a Web Worker). */
export function desktopSimProcessBridge(win: unknown, search: string): DesktopSimProcessBridge | null {
    const q = new URLSearchParams(search).get('simProcess');
    if (q === '0' || q === 'false') return null;
    const b = (win as { dwuDesktop?: { simProcess?: DesktopSimProcessBridge } } | undefined)?.dwuDesktop?.simProcess;
    return b !== undefined && typeof b.start === 'function' ? b : null;
}

/** Per window: the ports that arrived, the processes waiting for theirs, and the endpoints by id. */
interface DesktopState {
    ports: Map<number, PortLike>;
    waiting: Map<number, (p: PortLike) => void>;
    endpoints: Map<number, MessagePortEndpoint>;
}
const desktopStates = new WeakMap<object, DesktopState>();

function desktopState(win: PortWindow, bridge: DesktopSimProcessBridge): DesktopState {
    let s = desktopStates.get(win);
    if (s !== undefined) return s;
    const state: DesktopState = { ports: new Map(), waiting: new Map(), endpoints: new Map() };
    s = state;
    desktopStates.set(win, state);
    win.addEventListener('message', (e: MessageEvent) => {
        const id = (e.data as { dwuSimPort?: unknown } | null)?.dwuSimPort;
        const port = e.ports?.[0];
        if (typeof id !== 'number' || port === undefined) return;
        const w = state.waiting.get(id);
        state.waiting.delete(id);
        if (w !== undefined) w(port);
        else state.ports.set(id, port);
    });
    bridge.onExit((id, reason) => {
        const ep = state.endpoints.get(id);
        state.endpoints.delete(id);
        ep?.exited(reason);
    });
    bridge.onError((id, message) => state.endpoints.get(id)?.failed(message));
    return state;
}

/** Start a desktop sim process and return its endpoint at once (posts queue until its port arrives). */
export function openDesktopSimEndpoint(win: PortWindow, bridge: DesktopSimProcessBridge): MessagePortEndpoint {
    const state = desktopState(win, bridge);
    let id: number | null = null;
    let killed = false;
    const port = bridge.start().then(
        (n) =>
            new Promise<PortLike>((resolve) => {
                id = n;
                if (killed) {
                    bridge.terminate(n);
                    return; // never resolves: the endpoint has ended anyway
                }
                state.endpoints.set(n, ep);
                const p = state.ports.get(n);
                state.ports.delete(n);
                if (p !== undefined) resolve(p);
                else state.waiting.set(n, resolve);
            }),
    );
    const ep: MessagePortEndpoint = new MessagePortEndpoint(port, () => {
        killed = true;
        if (id === null) return; // terminated before the process had its id: terminated as it arrives (above)
        state.endpoints.delete(id);
        state.waiting.delete(id);
        state.ports.get(id)?.close();
        state.ports.delete(id);
        bridge.terminate(id);
    });
    return ep;
}
