// The desktop app's sim process page (sim.html, docs/sim-worker.md §4.7): a hidden window of its own — its own renderer
// process, so its own V8 heap cage, apart from the game page's — that runs the same sim worker the browser runs
// (worker.ts) and hands it the game page's MessagePort, so the game and the worker talk directly.
//
// The shell (desktop/simProcess.cjs) creates the window; its preload (desktop/simPreload.cjs) exposes `dwuSim` and posts
// the port to this page as a window message `{ dwuSimPort: true }` once `dwuSim.ready()` asked for it. Platform-neutral:
// no Node or Electron API here.

interface SimPageBridge {
    /** This page listens: send the port. */
    ready(): void;
    /** An exception nothing in the worker caught (the game page stops the sim and offers the restart). */
    workerError(message: string): void;
}

const bridge = (window as unknown as { dwuSim?: SimPageBridge }).dwuSim;
let started = false;

window.addEventListener('message', (e: MessageEvent) => {
    const port = e.ports?.[0];
    if (started || e.source !== window || (e.data as { dwuSimPort?: unknown } | null)?.dwuSimPort !== true || port === undefined) return;
    started = true;
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'dwu-sim' });
    worker.onerror = (ev) => bridge?.workerError(ev.message || 'the worker failed to start');
    worker.postMessage({ type: 'connectPort' }, [port]);
});

bridge?.ready();
