// A lockstep Link over a MessagePort (docs/MULTIPLAYER.md §10): the desktop shell's main process owns the sockets
// (desktop/netHost.cjs) and hands the game page one port per connection. On the port: { t: 'm', d: text } is one
// message, { t: 'c', r: reason } says the other side closed.
//
// Headless: only the standard MessagePort API (no DOM / Pixi / Node APIs).

import type { Link } from './transport';

/** The part of MessagePort a Link needs. */
export interface PortLike {
    postMessage(message: unknown): void;
    start(): void;
    close(): void;
    onmessage: ((ev: { data: unknown }) => void) | null;
}

class PortLink implements Link {
    onMessage: ((text: string) => void) | null = null;
    onClose: ((reason: string) => void) | null = null;
    private open = true;

    constructor(private readonly port: PortLike) {
        port.onmessage = (ev) => {
            const m = ev.data as { t?: unknown; d?: unknown; r?: unknown } | null;
            if (m === null || typeof m !== 'object' || !this.open) return;
            if (m.t === 'm' && typeof m.d === 'string') this.onMessage?.(m.d);
            else if (m.t === 'c') this.finish(typeof m.r === 'string' ? m.r : 'closed');
        };
        port.start();
    }

    get isOpen(): boolean {
        return this.open;
    }

    send(text: string): void {
        if (this.open) this.port.postMessage({ t: 'm', d: text });
    }

    close(reason = 'closed'): void {
        if (!this.open) return;
        try {
            this.port.postMessage({ t: 'c', r: reason });
        } catch {
            // the other end is gone
        }
        this.finish(reason);
    }

    private finish(reason: string): void {
        if (!this.open) return;
        this.open = false;
        try {
            this.port.close();
        } catch {
            // closed
        }
        this.onClose?.(reason);
    }
}

export function wrapPort(port: PortLike): Link {
    return new PortLink(port);
}
