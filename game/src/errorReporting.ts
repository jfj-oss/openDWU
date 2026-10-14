// Desktop crash reports: forwards the page's uncaught errors and unhandled rejections to the shell (window.dwuDesktop,
// desktop/gamePreload.cjs), which scrubs and sends them. Does nothing in the browser build.

interface ReportError {
    reportError?: (e: { kind: string; name: string; message: string; stack: string }) => void;
}

export function installErrorReporting(): void {
    const report = (window as unknown as { dwuDesktop?: ReportError }).dwuDesktop?.reportError;
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
