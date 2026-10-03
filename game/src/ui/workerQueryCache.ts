// Sim worker (docs/sim-worker.md §4.3, §9 chunk 7): a screen's view of a sim query that runs in the worker on a replica
// (simworker/simQuery.ts — it writes the graph or draws RNG, so it cannot run on the replica). In-thread the screens
// call such a query synchronously on every redraw; in worker mode they read the last answer here at once (undefined
// before the first) and the read asks the worker again once the answer is `refreshMs` old, one request per key in
// flight (a request the worker dropped — an argument left the game — is given up after `lostMs`). `onAnswer` redraws
// when an answer differs from the last (`same`). No sim imports (the screens pass the asking function).

export class WorkerQueryCache<K, V> {
    private readonly answers = new Map<K, { value: V; at: number }>();
    /** Requests in flight: when each was sent. */
    private readonly asking = new Map<K, number>();
    /** Bumped by invalidate: an answer to a request sent before it is kept but stale (asked again on the next read). */
    private generation = 0;
    private disposed = false;

    constructor(
        private readonly ask: (key: K, done: (value: V) => void) => void,
        private readonly onAnswer: (key: K) => void,
        private readonly same: (a: V, b: V) => boolean = Object.is,
        private readonly refreshMs = 900,
        private readonly now: () => number = () => Date.now(),
        private readonly lostMs = 5000,
    ) {}

    /** The last answer for `key` (undefined before the first); asks again when it is stale and nothing is in flight. */
    read(key: K): V | undefined {
        const a = this.answers.get(key);
        const sent = this.asking.get(key);
        const t = this.now();
        if (!this.disposed && (sent === undefined || t - sent >= this.lostMs) && (a === undefined || t - a.at >= this.refreshMs)) this.request(key, t);
        return a?.value;
    }

    /** Forget the answer for `key` (the next read asks at once), e.g. after a command that changes it. */
    invalidate(key: K): void {
        this.answers.delete(key);
        this.generation++;
    }

    dispose(): void {
        this.disposed = true;
        this.answers.clear();
        this.asking.clear();
    }

    private request(key: K, t: number): void {
        this.asking.set(key, t);
        const gen = this.generation;
        this.ask(key, (value) => {
            if (this.asking.get(key) === t) this.asking.delete(key);
            if (this.disposed) return;
            const prev = this.answers.get(key);
            this.answers.set(key, { value, at: gen === this.generation ? this.now() : -Infinity });
            if (prev === undefined || !this.same(prev.value, value)) this.onAnswer(key);
        });
    }
}
