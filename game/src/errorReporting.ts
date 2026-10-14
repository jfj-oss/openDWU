// Desktop crash reports: the page's side of desktop/crashReport.cjs. Forwards uncaught errors and unhandled
// rejections, multiplayer desyncs, the once-a-game-minute performance sample (sampled sessions only) and "Report a bug"
// to the shell (window.dwuDesktop, desktop/gamePreload.cjs), which scrubs and sends them. Does nothing in the browser build.
import { currentRendererInfo } from './render/rendererInfo';

interface Bridge {
    reportError?: (e: { kind: string; name: string; message: string; stack: string }) => void;
    reportDesync?: (i: Record<string, unknown>) => void;
    reportPerf?: (i: Record<string, unknown>) => void;
    perfSampled?: () => Promise<boolean>;
    sendFeedback?: (r: { message: string; info: Record<string, unknown> }) => Promise<{ ok: boolean; error?: string }>;
}

function bridge(): Bridge | null {
    return (window as unknown as { dwuDesktop?: Bridge }).dwuDesktop ?? null;
}

/** Whether "Report a bug" can send (the desktop app). */
export function bugReportAvailable(): boolean {
    return typeof bridge()?.sendFeedback === 'function';
}

export function installErrorReporting(): void {
    const report = bridge()?.reportError;
    if (typeof report !== 'function') return;
    const seen = new Set<string>();
    const send = (kind: string, reason: unknown): void => {
        try {
            const err = reason instanceof Error ? reason : null;
            const message = err ? err.message : String(reason);
            if (seen.size >= 20 || seen.has(message)) return; // a render loop must not flood
            seen.add(message);
            report({ kind, name: err ? err.name : 'Error', message, stack: err?.stack ?? '' });
        } catch {
            /* never break the page over a report */
        }
    };
    window.addEventListener('error', (ev) => send('error', ev.error ?? ev.message));
    window.addEventListener('unhandledrejection', (ev) => send('rejection', ev.reason));
}

interface GalaxyLike {
    systems?: unknown[];
    empires?: unknown[];
    baconSettingsOverrides?: Record<string, unknown>;
}
const liveGalaxy = (): GalaxyLike | null => (window as unknown as { __dwu?: { galaxy?: GalaxyLike } }).__dwu?.galaxy ?? null;

/** Galaxy size and the game settings changed from the defaults (the add-on switches), for bug reports. */
export function gameInfo(): Record<string, unknown> {
    const g = liveGalaxy();
    const r = currentRendererInfo();
    return {
        stars: g?.systems?.length ?? 0,
        empires: g?.empires?.length ?? 0,
        changedSettings: Object.keys(g?.baconSettingsOverrides ?? {}).slice(0, 200),
        renderer: r?.renderer ?? '',
        webgl: r?.webgl ?? '',
        gpu: r?.gpu ?? '',
    };
}

let desyncReports = 0;
/** One multiplayer desync (host side, from the lockstep digest comparison); at most 5 per session. Metadata only. */
export function reportDesync(i: { frame: number; lastGood: number; host: string; client: string; sections: string[]; deep: boolean; players: number; role: string }): void {
    const b = bridge();
    if (b?.reportDesync === undefined || desyncReports >= 5) return;
    desyncReports++;
    try {
        b.reportDesync({ ...i });
    } catch {
        /* ignore */
    }
}

/** "Report a bug": the text with the game info; resolves the shell's answer. */
export async function sendBugReport(message: string): Promise<{ ok: boolean; error?: string }> {
    const b = bridge();
    if (b?.sendFeedback === undefined) return { ok: false, error: 'Bug reports can be sent from the desktop app.' };
    try {
        return await b.sendFeedback({ message, info: gameInfo() });
    } catch (e) {
        return { ok: false, error: String((e as Error)?.message ?? e) };
    }
}

/** Frame-time statistics over a window of samples (pure). */
export function frameStats(deltasMs: number[]): { avgFps: number; p95FrameMs: number } {
    if (deltasMs.length === 0) return { avgFps: 0, p95FrameMs: 0 };
    const total = deltasMs.reduce((a, b) => a + b, 0);
    const sorted = [...deltasMs].sort((a, b) => a - b);
    return { avgFps: total > 0 ? (deltasMs.length * 1000) / total : 0, p95FrameMs: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] };
}

/**
 * Once a minute, in the ~1 % of sessions the shell picked: average fps, p95 frame time, the slowest sim tick, galaxy
 * size, renderer / GPU. Not sampled: nothing is measured. (Frame times from requestAnimationFrame; no per-frame spans.)
 */
export function startPerfSampling(): void {
    const b = bridge();
    if (b?.perfSampled === undefined || b.reportPerf === undefined) return;
    void b.perfSampled().then((on) => {
        if (!on) return;
        let deltas: number[] = [];
        let last = performance.now();
        const frame = (t: number): void => {
            if (!document.hidden) deltas.push(t - last);
            last = t;
            requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
        setInterval(() => {
            const g = liveGalaxy();
            if (g === null || deltas.length < 10) return; // no game running yet
            const st = (window as unknown as { __dwu?: { simStats?: { maxSimMsPerRenderFrame?: number; reset?: () => void } } }).__dwu?.simStats;
            const r = currentRendererInfo();
            const { avgFps, p95FrameMs } = frameStats(deltas);
            deltas = [];
            const slowestSimMs = st?.maxSimMsPerRenderFrame ?? 0;
            st?.reset?.();
            b.reportPerf!({ avgFps, p95FrameMs, slowestSimMs, stars: g.systems?.length ?? 0, empires: g.empires?.length ?? 0, renderer: r?.renderer ?? '', gpu: r?.gpu ?? '' });
        }, 60_000);
    });
}
