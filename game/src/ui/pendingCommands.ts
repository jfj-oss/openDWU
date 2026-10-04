// Quick repeated clicks (docs/sim-worker.md §4.4 "Quick repeats"). A control that computes the next value from what
// the game shows — a stepper adds one to the current count, a toggle sends the opposite of the current flag, a purchase
// button is enabled while nothing was bought for the target yet — reads state that is one command reply behind: in-thread
// for the rest of the frame (the command applies at the next boundary), in sim-worker mode for a whole round trip (the
// replica shows the change only with the command's reply). A second click inside that window would compute from the
// value before the first and lose a step (or toggle the same way twice, or buy twice).
//
// PendingValues remembers, per control key, the last value the UI SENT until that command's reply lands: the control
// computes from (and shows) it instead of the game's value. The entry ends with the reply of its latest send — whatever
// the outcome (a refusal or a sim-worker failure value: the game's value is then the truth again) — so an earlier
// command's reply never clears a later send. PendingOnce is the same for one-shot actions (a purchase): busy from the
// click until the reply of the command that settles it.
//
// In-thread a reply comes at the next frame boundary, so an entry lives for less than a frame and only clicks inside one
// frame see it (they computed from the old value before as well). A command whose executor throws never replies (in
// both modes: the frame stops with "Simulation error"); `clear()` drops what a screen holds (it closes / the selection
// changes).
// No DOM / Pixi imports.

export class PendingValues<K, V> {
    private readonly sent = new Map<K, { value: V; seq: number }>();
    private seq = 0;

    /** The value last sent for `key` (its reply has not landed yet), else `current` (what the game shows). */
    value(key: K, current: V): V {
        const p = this.sent.get(key);
        return p === undefined ? current : p.value;
    }

    /** Whether a value sent for `key` waits for its reply. */
    has(key: K): boolean {
        return this.sent.has(key);
    }

    /**
     * Note `value` as sent for `key`. Returns the reply hook: call it from the command's onApplied (any outcome); it
     * clears the entry only if no later value was sent for the key since.
     */
    send(key: K, value: V): () => void {
        const seq = ++this.seq;
        this.sent.set(key, { value, seq });
        return () => {
            if (this.sent.get(key)?.seq === seq) this.sent.delete(key);
        };
    }

    /** Entries waiting (tests). */
    get size(): number {
        return this.sent.size;
    }

    clear(): void {
        this.sent.clear();
    }
}

/** One-shot actions: busy from the click until the reply that settles it (see the file header). */
export class PendingOnce<K> {
    private readonly values = new PendingValues<K, true>();

    busy(key: K): boolean {
        return this.values.has(key);
    }

    /** Start `key` (null when it is busy already: ignore the click). Returns the hook that ends it (call it once the
     *  command's reply — or the last reply of a chain — landed). */
    start(key: K): (() => void) | null {
        if (this.values.has(key)) return null;
        return this.values.send(key, true);
    }

    get size(): number {
        return this.values.size;
    }

    clear(): void {
        this.values.clear();
    }
}
