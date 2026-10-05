// The sim endpoint (src/simworker/simEndpoint.ts): the Web Worker path delivers exactly what the Worker does; the
// desktop sim process's MessagePort endpoint queues until its port arrives, delivers in order with transfers, reports
// the process's end once and nothing after terminate; SimWorkerClient over a port endpoint boots, and a process that
// ends stops it as a dead worker does (desktop/simProcess.cjs lifecycle: test/desktopShell.test.ts).
import { describe, expect, it, vi } from 'vitest';
import { MessageChannel } from 'node:worker_threads';
import { desktopSimProcessBridge, MessagePortEndpoint, openDesktopSimEndpoint, WebWorkerEndpoint, type DesktopSimProcessBridge, type PortLike, type WorkerLike } from '../src/simworker/simEndpoint';
import type { ToWorker } from '../src/simworker/protocol';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

class FakeWorker implements WorkerLike {
    posted: { m: unknown; transfer: Transferable[] }[] = [];
    terminated = 0;
    onmessage: ((e: MessageEvent) => void) | null = null;
    onmessageerror: ((e: MessageEvent) => void) | null = null;
    onerror: ((e: ErrorEvent) => void) | null = null;
    postMessage(m: unknown, transfer: Transferable[]): void {
        this.posted.push({ m, transfer });
    }
    terminate(): void {
        this.terminated++;
    }
}

/** A node MessagePort with the DOM handler shape (onmessage gets { data }). */
function domPort(p: import('node:worker_threads').MessagePort): PortLike & { raw: typeof p } {
    let onmessage: ((e: MessageEvent) => void) | null = null;
    const wrapped = {
        raw: p,
        postMessage: (m: unknown, transfer: Transferable[]) => p.postMessage(m, transfer as never),
        get onmessage() {
            return onmessage;
        },
        set onmessage(f: ((e: MessageEvent) => void) | null) {
            onmessage = f;
            p.removeAllListeners('message');
            if (f !== null) p.on('message', (data) => f({ data } as MessageEvent));
        },
        onmessageerror: null as ((e: MessageEvent) => void) | null,
        close: () => p.close(),
    };
    return wrapped;
}

describe('WebWorkerEndpoint', () => {
    it('passes messages, transfers, errors and terminate straight through to the Worker', () => {
        const w = new FakeWorker();
        const ep = new WebWorkerEndpoint(w);
        const got: unknown[] = [];
        const errors: string[] = [];
        let lost = 0;
        ep.onmessage = (e) => got.push(e.data);
        ep.onerror = (m) => errors.push(m);
        ep.onmessageerror = () => lost++;
        const buf = new ArrayBuffer(8);
        ep.postMessage({ type: 'save', id: 1 } as ToWorker, [buf]);
        ep.postMessage({ type: 'digest', id: 2 } as ToWorker);
        expect(w.posted).toEqual([
            { m: { type: 'save', id: 1 }, transfer: [buf] },
            { m: { type: 'digest', id: 2 }, transfer: [] },
        ]);
        w.onmessage!({ data: { type: 'alive' } } as MessageEvent);
        w.onerror!({ message: 'boom' } as ErrorEvent);
        w.onmessageerror!({} as MessageEvent);
        expect(got).toEqual([{ type: 'alive' }]);
        expect(errors).toEqual(['boom']);
        expect(lost).toBe(1);
        ep.terminate();
        expect(w.terminated).toBe(1);
    });
});

describe('MessagePortEndpoint', () => {
    it('queues posts until the port arrives, then sends them in order with their transfers', async () => {
        const ch = new MessageChannel();
        let give!: (p: PortLike) => void;
        const ep = new MessagePortEndpoint(new Promise<PortLike>((r) => (give = r)), () => undefined);
        const far: unknown[] = [];
        ch.port2.on('message', (m) => far.push(m));
        const buf = new Uint8Array([1, 2, 3]).buffer;
        ep.postMessage({ type: 'clock', seq: 1, speed: 1, paused: false } as ToWorker);
        ep.postMessage({ type: 'command', bytes: buf } as unknown as ToWorker, [buf]);
        await flush();
        expect(far).toEqual([]);
        give(domPort(ch.port1));
        await flush();
        ep.postMessage({ type: 'digest', id: 3 } as ToWorker);
        await flush();
        expect(far.map((m) => (m as { type: string }).type)).toEqual(['clock', 'command', 'digest']);
        expect(buf.byteLength).toBe(0); // transferred, not copied
        expect(new Uint8Array((far[1] as { bytes: ArrayBuffer }).bytes)).toEqual(new Uint8Array([1, 2, 3]));
        ch.port2.close();
    });

    it('delivers the far end\'s messages, and nothing after terminate; terminate kills once', async () => {
        const ch = new MessageChannel();
        const kill = vi.fn();
        const ep = new MessagePortEndpoint(Promise.resolve(domPort(ch.port1)), kill);
        const got: unknown[] = [];
        ep.onmessage = (e) => got.push(e.data);
        await flush();
        ch.port2.postMessage({ type: 'alive' });
        await flush();
        expect(got).toEqual([{ type: 'alive' }]);
        ep.terminate();
        ep.terminate();
        expect(kill).toHaveBeenCalledTimes(1);
        ep.postMessage({ type: 'digest', id: 1 } as ToWorker); // ignored
        await flush();
        expect(got).toEqual([{ type: 'alive' }]);
    });

    it('reports the process end once (onexit), kills it, and ignores what follows; a start failure is an exit', async () => {
        const kill = vi.fn();
        const ep = new MessagePortEndpoint(new Promise<PortLike>(() => undefined), kill);
        const exits: string[] = [];
        ep.onexit = (r) => exits.push(r);
        ep.exited('the simulation process ended (oom, exit code 5)');
        ep.exited('again');
        ep.failed('late error');
        expect(exits).toEqual(['the simulation process ended (oom, exit code 5)']);
        expect(kill).toHaveBeenCalledTimes(1);

        const ep2 = new MessagePortEndpoint(Promise.reject(new Error('no window')), () => undefined);
        const exits2: string[] = [];
        ep2.onexit = (r) => exits2.push(r);
        await flush();
        expect(exits2).toEqual(['the simulation process did not start (no window)']);
    });

    it('closes a port that arrives after terminate', async () => {
        const ch = new MessageChannel();
        let give!: (p: PortLike) => void;
        const ep = new MessagePortEndpoint(new Promise<PortLike>((r) => (give = r)), () => undefined);
        ep.terminate();
        const p = domPort(ch.port1);
        const close = vi.spyOn(p, 'close');
        give(p);
        await flush();
        expect(close).toHaveBeenCalled();
    });
});

/** A fake shell bridge + window: ports come as window messages `{ dwuSimPort: id }`. */
function fakeDesktop() {
    const listeners: ((e: MessageEvent) => void)[] = [];
    const win = { addEventListener: (_t: 'message', l: (e: MessageEvent) => void) => listeners.push(l) };
    let exitCb: ((id: number, reason: string) => void) | null = null;
    let errorCb: ((id: number, message: string) => void) | null = null;
    let next = 1;
    const terminated: number[] = [];
    const bridge: DesktopSimProcessBridge = {
        start: async () => next++,
        terminate: (id) => terminated.push(id),
        onExit: (cb) => (exitCb = cb),
        onError: (cb) => (errorCb = cb),
    };
    return {
        win,
        bridge,
        terminated,
        deliverPort: (id: number, port: PortLike) => listeners.forEach((l) => l({ data: { dwuSimPort: id }, ports: [port] } as unknown as MessageEvent)),
        exit: (id: number, reason: string) => exitCb?.(id, reason),
        error: (id: number, message: string) => errorCb?.(id, message),
    };
}

describe('the desktop sim-process bridge', () => {
    it('is used when the shell offers it, unless ?simProcess=0', () => {
        const d = fakeDesktop();
        const w = { dwuDesktop: { simProcess: d.bridge } };
        expect(desktopSimProcessBridge(w, '')).toBe(d.bridge);
        expect(desktopSimProcessBridge(w, '?simProcess=0')).toBeNull();
        expect(desktopSimProcessBridge({ dwuDesktop: { checkForUpdates: () => undefined } }, '')).toBeNull();
        expect(desktopSimProcessBridge(undefined, '')).toBeNull();
    });

    it('connects each endpoint to its own port, routes exits and errors by id, terminates by id', async () => {
        const d = fakeDesktop();
        const a = openDesktopSimEndpoint(d.win, d.bridge);
        const b = openDesktopSimEndpoint(d.win, d.bridge);
        const chA = new MessageChannel();
        const chB = new MessageChannel();
        const farA: unknown[] = [];
        chA.port2.on('message', (m) => farA.push(m));
        a.postMessage({ type: 'digest', id: 1 } as ToWorker);
        await flush();
        // b's port first, then a's (order of arrival does not matter).
        d.deliverPort(2, domPort(chB.port1));
        d.deliverPort(1, domPort(chA.port1));
        await flush();
        expect(farA).toEqual([{ type: 'digest', id: 1 }]);
        const exitsA: string[] = [];
        const errorsB: string[] = [];
        a.onexit = (r) => exitsA.push(r);
        b.onerror = (m) => errorsB.push(m);
        d.error(2, 'TypeError in the worker');
        d.exit(1, 'the simulation process ended (killed, exit code 9)');
        expect(exitsA).toEqual(['the simulation process ended (killed, exit code 9)']);
        expect(errorsB).toEqual(['TypeError in the worker']);
        expect(d.terminated).toEqual([1]); // an exited process is cleaned up too
        b.terminate();
        expect(d.terminated).toEqual([1, 2]);
        chA.port2.close();
        chB.port2.close();
    });

    it('terminates a process whose id arrives after the endpoint was terminated', async () => {
        const d = fakeDesktop();
        const ep = openDesktopSimEndpoint(d.win, d.bridge);
        ep.terminate();
        await flush();
        expect(d.terminated).toEqual([1]);
    });
});

describe('SimWorkerClient over a sim-process endpoint', () => {
    it('fails its boot with the reason when the process ends before the snapshot', async () => {
        const { SimWorkerClient } = await import('../src/simworker/workerClient');
        // Ends during boot: the boot rejects with the reason.
        const ep = new MessagePortEndpoint(new Promise<PortLike>(() => undefined), () => undefined);
        const boot = SimWorkerClient.boot({ type: 'init' } as never, {} as never, undefined, ep);
        ep.exited('the simulation process ended (oom, exit code 133)');
        await expect(boot).rejects.toThrow('the simulation process ended (oom, exit code 133)');
    });
});
