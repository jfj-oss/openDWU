// WebSocket Link (docs/MULTIPLAYER.md "Lockstep core"): the client side of the lockstep transport, on the standard
// WebSocket API — the browser's, the Electron renderer's, or Node 22's global WebSocket (the demo script). The host
// side listens with a Node WebSocket server (scripts/lib/wsServer.mjs, dependency-free) and wraps each accepted
// socket with wrapSocket below, which accepts any object of the same shape.
//
// Headless: no DOM / Pixi / Node APIs (only the WebSocket global, when connectWebSocket is called).

import type { Link } from './transport';

/** The part of the WebSocket API a Link needs (browser WebSocket, Node 22 WebSocket, or scripts/lib/wsServer.mjs). */
export interface SocketLike {
    readonly readyState: number;
    send(data: string): void;
    close(code?: number, reason?: string): void;
    addEventListener(type: 'message', fn: (ev: { data: unknown }) => void): void;
    addEventListener(type: 'close', fn: (ev: { reason?: string; code?: number }) => void): void;
    addEventListener(type: 'error', fn: (ev: unknown) => void): void;
    addEventListener(type: 'open', fn: () => void): void;
}

const OPEN = 1;

class SocketLink implements Link {
    onMessage: ((text: string) => void) | null = null;
    onClose: ((reason: string) => void) | null = null;
    private closed = false;

    constructor(private readonly ws: SocketLike) {
        ws.addEventListener('message', (ev) => {
            if (this.closed) return;
            const d = ev.data;
            this.onMessage?.(typeof d === 'string' ? d : String(d));
        });
        ws.addEventListener('close', (ev) => this.finish(ev.reason !== undefined && ev.reason !== '' ? ev.reason : `socket closed (${ev.code ?? '?'})`));
        ws.addEventListener('error', () => this.finish('socket error'));
    }

    get isOpen(): boolean {
        return !this.closed && this.ws.readyState === OPEN;
    }

    send(text: string): void {
        if (this.isOpen) this.ws.send(text);
    }

    close(reason = 'closed'): void {
        if (this.closed) return;
        try {
            this.ws.close(1000, reason.slice(0, 120));
        } catch {
            // already closing
        }
        this.finish(reason);
    }

    private finish(reason: string): void {
        if (this.closed) return;
        this.closed = true;
        this.onClose?.(reason);
    }
}

/** A Link over an already-open socket (the host's accepted connection, or a client socket after 'open'). */
export function wrapSocket(ws: SocketLike): Link {
    return new SocketLink(ws);
}

/** Connect to a lockstep host at `url` (ws://host:port) with the global WebSocket; resolves once open. */
export function connectWebSocket(url: string): Promise<Link> {
    const Ctor = (globalThis as unknown as { WebSocket?: new (url: string) => SocketLike }).WebSocket;
    if (Ctor === undefined) return Promise.reject(new Error('no WebSocket in this runtime'));
    return new Promise((resolve, reject) => {
        const ws = new Ctor(url);
        let settled = false;
        ws.addEventListener('open', () => {
            settled = true;
            resolve(wrapSocket(ws));
        });
        ws.addEventListener('error', () => {
            if (!settled) {
                settled = true;
                reject(new Error(`cannot connect to ${url}`));
            }
        });
    });
}
