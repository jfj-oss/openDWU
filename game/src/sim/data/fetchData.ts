// Browser-only fetch helper for original DW:U data files. No Node `fs` here
// — this is the only place in src/sim/data that does I/O; everything else
// (races.ts, governments.ts, biases.ts, raceFamilies.ts) is pure parsing of
// already-loaded text, per CLAUDE.md's "no Node APIs in src/" rule.

// Tries each candidate URL (as produced by paths.ts resolveDataUrl) in
// order, returning the text of the first one that responds OK. Mirrors the
// engine's "look in Customization/<set>/ first, fall back to base" behavior
// (see Galaxy.cs ~1967-1978), implemented here as sequential fetch attempts
// since the browser has no File.Exists.
// The data loaders fire hundreds of fetches at once (every race × design template sub-role × pirate variant is
// its own file). A dev server or a busy machine then resets connections (net::ERR_CONNECTION_RESET), so game
// start fails. Gate the number of requests in flight and retry a transport failure once.
const MAX_IN_FLIGHT = 24;
let inFlight = 0;
const waiters: Array<() => void> = [];
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
    if (inFlight >= MAX_IN_FLIGHT) {
        await new Promise<void>((resolve) => waiters.push(resolve));
    }
    inFlight++;
    try {
        return await fn();
    } finally {
        inFlight--;
        waiters.shift()?.();
    }
}

async function fetchOnce(url: string): Promise<Response> {
    try {
        return await withSlot(() => fetch(url));
    } catch (err) {
        // TypeError = transport failure (reset, refused); give the server a moment and try once more.
        if (!(err instanceof TypeError)) throw err;
        await new Promise((resolve) => setTimeout(resolve, 250));
        return await withSlot(() => fetch(url));
    }
}

export async function fetchText(candidates: string[]): Promise<string> {
    let lastError: unknown = undefined;
    for (const url of candidates) {
        try {
            const response = await fetchOnce(url);
            if (response.ok) {
                return await response.text();
            }
            lastError = new Error(`fetch ${url} failed with status ${response.status}`);
        } catch (err) {
            lastError = err;
        }
    }
    throw new Error(
        `fetchText: none of the candidate URLs could be loaded: ${candidates.join(', ')}${lastError ? ` (last error: ${String(lastError)})` : ''}`
    );
}
