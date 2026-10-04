// The game view's HUD lifetime: the document / window listeners, settings subscriptions and timers the HUD and its
// panels register end when the view is torn down (main.ts startGameView's cleanup → destroyHudListeners; createHud
// also ends a previous HUD's). Left registered, their closures — the HUD wiring, the game, its galaxy, the main view —
// kept every replaced game alive after a load, a new game or a sim-worker restart (and the timers kept refreshing, the
// money panel kept issuing its command, on the game that was gone).

let life = new AbortController();

/** The current HUD's signal: aborted when the HUD is destroyed. */
export function hudSignal(): AbortSignal {
    return life.signal;
}

/** End the current HUD's listeners, subscriptions and timers. */
export function destroyHudListeners(): void {
    life.abort();
    life = new AbortController();
}

/** Run `off` when the current HUD is destroyed (a settings unsubscribe, a clearInterval). */
export function onHudDestroyed(off: () => void): void {
    life.signal.addEventListener('abort', off, { once: true });
}

/** setInterval(fn, ms) until the current HUD is destroyed. */
export function hudInterval(fn: () => void, ms: number): void {
    const t = setInterval(fn, ms);
    onHudDestroyed(() => clearInterval(t));
}
