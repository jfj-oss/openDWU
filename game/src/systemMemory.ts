// The machine's total RAM, as the dev server (vite.config.ts systemMemoryMeta) or the desktop shell (desktop/main.cjs)
// writes it into the page: <meta name="dwu-system-memory-gib">. Browsers cap navigator.deviceMemory at 8, so that is
// only a fallback (and can only ever say "8 or less"). Null when unknown.

/** Total system memory in GiB, or null when the page doesn't say. */
export function systemMemoryGiB(doc: { querySelector(sel: string): { getAttribute(name: string): string | null } | null } | null =
    typeof document !== 'undefined' ? document : null): number | null {
    const v = doc?.querySelector('meta[name="dwu-system-memory-gib"]')?.getAttribute('content');
    const n = v != null ? Number(v) : NaN;
    if (Number.isFinite(n) && n > 0) return n;
    const dm = typeof navigator !== 'undefined' ? (navigator as { deviceMemory?: number }).deviceMemory : undefined;
    return typeof dm === 'number' && dm > 0 && dm < 8 ? dm : null;
}

/** A "16 GB" machine reports a little under 16 GiB (reserved memory), so 14 GiB is the line. */
export const SIM_WORKER_MIN_MEMORY_GIB = 14;

/** The sim worker keeps a second copy of the game (the replica), roughly doubling memory: it is the default only on
 *  machines with 16 GB+ of RAM. 8 GB machines (e.g. a base Mac, where the GPU shares that RAM) ran out of memory: severe
 *  slowdown and WebGL context loss. Unknown memory counts as too little. */
export function simWorkerDefault(memGiB: number | null = systemMemoryGiB()): boolean {
    return memGiB !== null && memGiB >= SIM_WORKER_MIN_MEMORY_GIB;
}
