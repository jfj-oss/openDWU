// The side channel of a running multiplayer game (docs/MULTIPLAYER.md §16, §19): small messages that are not part of
// the simulation — chat, and the host-migration signalling (who takes over, the WebRTC codes of the backup links) —
// carried over the session's own links next to the lockstep traffic, but never seen by the session: a tapped link
// (lobby.ts HandoffLink `filter`) takes every `{"t":"side",…}` message off before the session reads it. So nothing here
// can change a digest.
//
// Star topology, as the session: a client sends to the host; the host stamps the sender's slot (`from`: a client cannot
// pose as another player) and delivers to itself, to one player (`to` = their slot) or to everyone (`to` = -1).
// Bounded: a message over SIDE_MAX_CHARS is dropped, and each link has a token bucket (SIDE_RATE_*), checked on the
// host for what it relays and on every peer for what it receives.
//
// Main thread; no DOM.

import type { Link } from '../../net/transport';
import { HandoffLink } from '../../net/lobby';

/** The most characters of one side message (a chat line is at most CHAT_MAX_CHARS; the codes are ~150). */
export const SIDE_MAX_CHARS = 4096;
/** Token bucket per link: this many messages at once, refilled at this many per second. */
export const SIDE_RATE_BURST = 30;
export const SIDE_RATE_PER_S = 4;

export interface SideMsg {
    t: 'side';
    /** What it is: 'chat', or the migration signalling ('succ', 'succAddr', 'mOffer', 'mReply'). */
    k: string;
    /** The receiver's lobby slot, or -1 for everyone. */
    to: number;
    /** The sender's lobby slot (stamped by the host). */
    from: number;
    [field: string]: unknown;
}

const PREFIX = '{"t":"side"';

/** Whether `text` is a side message (the tap's filter: cheap, on every message of the link). */
export function isSideText(text: string): boolean {
    return text.startsWith(PREFIX);
}

class Bucket {
    private tokens = SIDE_RATE_BURST;
    private at = Date.now();
    take(): boolean {
        const now = Date.now();
        this.tokens = Math.min(SIDE_RATE_BURST, this.tokens + ((now - this.at) / 1000) * SIDE_RATE_PER_S);
        this.at = now;
        if (this.tokens < 1) return false;
        this.tokens -= 1;
        return true;
    }
}

export class SideHub {
    /** 'host': the hub (relays); 'client': talks to the hub only. A host migration flips it (becomeHost / useHostLink). */
    role: 'host' | 'client';
    private readonly links = new Map<number, { link: Link; bucket: Bucket }>();
    private hostLink: { link: Link; bucket: Bucket } | null = null;
    private readonly handlers = new Map<string, Array<(m: SideMsg) => void>>();
    /** Messages dropped (too big, too many, malformed, refused by `allow`). */
    dropped = 0;
    /** Host: whether to take a client's message (before it is relayed or handled), e.g. chat's own rate limit. */
    allow: ((m: SideMsg) => boolean) | null = null;

    constructor(role: 'host' | 'client', readonly mySlot: number) {
        this.role = role;
    }

    /** Listen to kind `k` (chat, succ, …). */
    on(k: string, fn: (m: SideMsg) => void): void {
        const list = this.handlers.get(k) ?? [];
        list.push(fn);
        this.handlers.set(k, list);
    }

    /**
     * Wrap a session link: side messages go to this hub (from `slot`: the player at the other end; the host's link on a
     * client: its slot too), the rest to whoever reads the returned link (the lockstep session). Host: the link is
     * also where messages for that slot go.
     */
    tap(link: Link, slot: number, asHost = this.role === 'client'): HandoffLink {
        const entry = { link, bucket: new Bucket() };
        if (asHost) this.hostLink = entry;
        else this.links.set(slot, entry);
        const tapped = new HandoffLink(link, undefined, (text) => {
            if (!isSideText(text)) return false;
            this.receive(text, slot, entry.bucket, asHost);
            return true;
        });
        return tapped;
    }

    /** Host migration: this peer is the hub now (the survivors' links are tapped as they come). */
    becomeHost(): void {
        this.role = 'host';
        this.hostLink = null;
    }

    /** The players this hub reaches (host: by slot). */
    slots(): number[] {
        return [...this.links.keys()].filter((s) => this.links.get(s)!.link.isOpen);
    }

    /** Forget a slot's link (it closed / the player left). */
    forget(slot: number): void {
        this.links.delete(slot);
    }

    private receive(text: string, slot: number, bucket: Bucket, fromHost: boolean): void {
        if (text.length > SIDE_MAX_CHARS || !bucket.take()) {
            this.dropped++;
            return;
        }
        let m: SideMsg;
        try {
            m = JSON.parse(text) as SideMsg;
        } catch {
            this.dropped++;
            return;
        }
        if (m === null || typeof m !== 'object' || typeof m.k !== 'string' || !Number.isInteger(m.to)) {
            this.dropped++;
            return;
        }
        if (this.role === 'host' && !fromHost) {
            m.from = slot; // the hub says who sent it
            if (this.allow !== null && !this.allow(m)) {
                this.dropped++;
                return;
            }
            if (m.to === -1) {
                this.deliverLocal(m);
                this.forward(m, slot);
            } else if (m.to === this.mySlot) this.deliverLocal(m);
            else this.links.get(m.to)?.link.send(JSON.stringify(m));
            return;
        }
        // From the hub: already stamped.
        if (!Number.isInteger(m.from)) m.from = slot;
        this.deliverLocal(m);
    }

    private forward(m: SideMsg, except: number): void {
        const text = JSON.stringify(m);
        for (const [slot, e] of this.links) if (slot !== except && e.link.isOpen) e.link.send(text);
    }

    private deliverLocal(m: SideMsg): void {
        for (const fn of this.handlers.get(m.k) ?? []) {
            try {
                fn(m);
            } catch (err) {
                console.warn(`multiplayer: side message ${m.k} failed`, err);
            }
        }
    }

    /** Send kind `k` to `to` (a slot, or -1: everyone). Returns false when it cannot go (too big, no link). */
    send(k: string, to: number, fields: Record<string, unknown> = {}): boolean {
        // `t` first: the receivers' filter looks at the start of the text.
        const m: SideMsg = { t: 'side', k, to, from: this.mySlot };
        for (const [key, v] of Object.entries(fields)) if (!(key in m)) m[key] = v;
        const text = JSON.stringify(m);
        if (text.length > SIDE_MAX_CHARS) return false;
        if (this.role === 'host') {
            if (to === -1) this.forward(m, this.mySlot);
            else if (to === this.mySlot) this.deliverLocal(m);
            else {
                const e = this.links.get(to);
                if (e === undefined || !e.link.isOpen) return false;
                e.link.send(text);
            }
            return true;
        }
        if (this.hostLink === null || !this.hostLink.link.isOpen) return false;
        this.hostLink.link.send(text);
        return true;
    }
}
