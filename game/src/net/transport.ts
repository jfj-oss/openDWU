// Lockstep transport interface (docs/MULTIPLAYER.md "Lockstep core"): a Link is one ordered, reliable, bidirectional
// channel of text messages between two peers (a WebSocket, or the in-memory pair below). The session (lockstep.ts)
// only needs FIFO delivery per link; it does all JSON itself.
//
// Headless: no DOM / Pixi / Node APIs.

export interface Link {
    /** Queue a message (never throws once closed: it is dropped). */
    send(text: string): void;
    /** Messages arrive here in send order. Set by the session. */
    onMessage: ((text: string) => void) | null;
    /** The link closed (either side, or the network dropped). Called once. */
    onClose: ((reason: string) => void) | null;
    close(reason?: string): void;
    readonly isOpen: boolean;
}

/** Listening side: hands each new incoming link to the host session (host.accept). */
export interface LinkListener {
    onLink: ((link: Link) => void) | null;
    close(): void;
}

export interface MemoryLinkOptions {
    /** One-way delay in ms (setTimeout); 0 or absent: delivered on a microtask, still asynchronous. */
    latencyMs?: number;
}

class MemoryLink implements Link {
    onMessage: ((text: string) => void) | null = null;
    onClose: ((reason: string) => void) | null = null;
    other: MemoryLink | null = null;
    private open = true;
    constructor(private readonly latencyMs: number) {}

    get isOpen(): boolean {
        return this.open;
    }

    send(text: string): void {
        const to = this.other;
        if (!this.open || to === null) return;
        const deliver = (): void => {
            if (to.open) to.onMessage?.(text);
        };
        if (this.latencyMs > 0) setTimeout(deliver, this.latencyMs);
        else queueMicrotask(deliver);
    }

    close(reason = 'closed'): void {
        if (!this.open) return;
        this.open = false;
        this.onClose?.(reason);
        const to = this.other;
        if (to !== null && to.open) {
            const later = (): void => {
                if (!to.open) return;
                to.open = false;
                to.onClose?.(reason);
            };
            // After anything already in flight (FIFO, as a socket close follows its data).
            if (this.latencyMs > 0) setTimeout(later, this.latencyMs);
            else queueMicrotask(later);
        }
    }
}

/** Two connected in-memory links (two sessions in one process). */
export function memoryLinkPair(opts: MemoryLinkOptions = {}): [Link, Link] {
    const a = new MemoryLink(opts.latencyMs ?? 0);
    const b = new MemoryLink(opts.latencyMs ?? 0);
    a.other = b;
    b.other = a;
    return [a, b];
}

/** An in-memory listener: connect() returns the client end and hands the host end to onLink. */
export class MemoryListener implements LinkListener {
    onLink: ((link: Link) => void) | null = null;
    constructor(private readonly opts: MemoryLinkOptions = {}) {}

    connect(): Link {
        const [client, host] = memoryLinkPair(this.opts);
        queueMicrotask(() => this.onLink?.(host));
        return client;
    }

    close(): void {
        this.onLink = null;
    }
}
