// Browser-only fetch helper for original DW:U data files. No Node `fs` here
// — this is the only place in src/sim/data that does I/O; everything else
// (races.ts, governments.ts, biases.ts, raceFamilies.ts) is pure parsing of
// already-loaded text, per CLAUDE.md's "no Node APIs in src/" rule.

// Tries each candidate URL (as produced by paths.ts resolveDataUrl) in
// order, returning the text of the first one that responds OK. Mirrors the
// engine's "look in Customization/<set>/ first, fall back to base" behavior
// (see Galaxy.cs ~1967-1978), implemented here as sequential fetch attempts
// since the browser has no File.Exists.
export async function fetchText(candidates: string[]): Promise<string> {
    let lastError: unknown = undefined;
    for (const url of candidates) {
        try {
            const response = await fetch(url);
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
