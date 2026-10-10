// Internet play without a server (docs/MULTIPLAYER.md §15): the copy-paste code screens over net/rtcTransport.ts.
//
// - Host: an InternetHost lives from "Host on the Internet" until hosting stops. Its invite board (in the lobby) has
//   one row per invite: the invite code with Copy, a box for the player's reply code, and the connection state. A
//   connection that opens goes to whatever answers the host's connections at that moment (the lobby, then the
//   running game's rejoin gate), exactly as an accepted LAN socket does. During the game, the banner shows a fresh
//   invite for each absent player (rejoinWidget).
// - Joiner: openCodeJoin, a dialog: paste the invite, get the reply code (Copy) to send back, wait for the host.
// - When no direct connection can be made, fallbackHelp words the three ways that still work.
//
// Main thread / DOM.

import type { Link } from '../../net/transport';
import { answerInvite, decodeCode, expandSdp, RtcInvite, rtcLinkPath, type RtcOptions, type RtcState } from '../../net/rtcTransport';

/** The WebRTC links this page opened (scripts: __dwuRtc.paths()). */
const openedLinks: Link[] = [];

/**
 * Test hooks (localStorage): 'dwu.mp.blockIce' = '1' gathers no ICE candidates at all (the failure path);
 * 'dwu.mp.publicOnly' = '1' puts only the public (STUN) addresses in the codes (no LAN / VPN path).
 */
export function rtcOptions(): RtcOptions {
    const flag = (k: string): boolean => {
        try {
            return localStorage.getItem(k) === '1';
        } catch {
            return false;
        }
    };
    return { ...(flag('dwu.mp.blockIce') ? { blockIce: true } : {}), ...(flag('dwu.mp.publicOnly') ? { publicOnly: true } : {}) };
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (cls !== '') e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
}

function button(label: string, mp: string, onClick: () => void, cls = 'mp-btn'): HTMLButtonElement {
    const b = h('button', cls, label);
    b.type = 'button';
    b.dataset.mp = mp;
    b.addEventListener('click', onClick);
    return b;
}

function stopKeys(e: HTMLElement): void {
    e.addEventListener('keydown', (ev) => ev.stopPropagation());
}

async function copyText(text: string, field: HTMLTextAreaElement | HTMLInputElement, btn: HTMLButtonElement): Promise<void> {
    let ok = false;
    try {
        await navigator.clipboard.writeText(text);
        ok = true;
    } catch {
        field.select();
        try {
            ok = document.execCommand('copy');
        } catch {
            ok = false;
        }
    }
    const old = btn.dataset.label ?? btn.textContent ?? 'Copy';
    btn.dataset.label = old;
    btn.textContent = ok ? 'Copied' : 'Select and copy';
    setTimeout(() => (btn.textContent = old), 1500);
}

/** What still works when the two networks block a direct connection (no relay is used, by design). */
export function fallbackHelp(port: number | null): string {
    const p = port ?? 47610;
    return (
        'Without a relay server, some pairs of routers cannot connect directly (both behind strict NAT). Ways that still work: ' +
        `(a) the host forwards TCP port ${p} on their router to this PC, and the player joins by IP ("Join a game" with the host's public address:${p}); ` +
        '(b) the host ticks "Open the port on my router automatically" (UPnP / NAT-PMP) and gives the player the public address shown in the lobby; ' +
        "(c) both install Tailscale (or another VPN) and use LAN play with the host's Tailscale address."
    );
}

function stateText(state: RtcState, error: string): string {
    switch (state) {
        case 'preparing':
            return 'Preparing the code (asking a STUN server for your public address)…';
        case 'waiting':
            return 'Waiting for the reply code. Send the invite code to the player (e.g. over Discord), then paste their reply here.';
        case 'connecting':
            return 'Connecting…';
        case 'connected':
            return 'Connected.';
        case 'failed':
            return `Failed: ${error}`;
        case 'closed':
            return 'Closed.';
    }
}

/** One invite row (the lobby board, or the banner's rejoin invite). */
class InviteRow {
    readonly el = h('div', 'mp-invite');
    private readonly title = h('div', 'mp-invite-title');
    private readonly stateEl = h('div', 'mp-invite-state');
    private readonly codeIn = h('textarea', 'mp-input mp-code');
    private readonly copyBtn: HTMLButtonElement;
    private readonly replyIn = h('input', 'mp-input mp-code-reply');
    private readonly connectBtn: HTMLButtonElement;
    private readonly help = h('div', 'mp-note mp-invite-help');
    private readonly retryBtn: HTMLButtonElement;
    onRetry: (() => void) | null = null;

    constructor(private invite: RtcInvite, label: string, private readonly host: InternetHost, compact: boolean) {
        this.el.dataset.mp = 'invite';
        this.el.classList.toggle('mp-invite-compact', compact);
        this.title.textContent = label;
        this.codeIn.readOnly = true;
        this.codeIn.rows = compact ? 1 : 2;
        this.codeIn.dataset.mp = 'invite-code';
        this.codeIn.spellcheck = false;
        this.codeIn.addEventListener('focus', () => this.codeIn.select());
        this.copyBtn = button('Copy', 'invite-copy', () => void copyText(this.invite.code, this.codeIn, this.copyBtn));
        this.replyIn.dataset.mp = 'reply-code';
        this.replyIn.placeholder = 'Paste the player\'s reply code (DWR…)';
        this.replyIn.spellcheck = false;
        stopKeys(this.replyIn);
        stopKeys(this.codeIn);
        this.connectBtn = button('Connect', 'reply-connect', () => void this.connect());
        this.replyIn.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') void this.connect();
        });
        this.retryBtn = button('New Invite Code', 'invite-retry', () => this.onRetry?.());
        this.stateEl.dataset.mp = 'invite-state';
        const codeRow = h('div', 'mp-code-row');
        codeRow.append(h('span', 'mp-code-label', 'Invite code'), this.codeIn, this.copyBtn);
        const replyRow = h('div', 'mp-code-row');
        replyRow.append(h('span', 'mp-code-label', 'Reply code'), this.replyIn, this.connectBtn);
        this.el.append(this.title, codeRow, replyRow, this.stateEl, this.help, this.retryBtn);
        this.bind(invite);
    }

    get current(): RtcInvite {
        return this.invite;
    }

    /** Show `invite` in this row (a fresh code after a failure). */
    bind(invite: RtcInvite): void {
        this.invite = invite;
        this.replyIn.value = '';
        invite.onState = () => this.paint();
        this.paint();
    }

    private async connect(): Promise<void> {
        const text = this.replyIn.value;
        try {
            const reply = await decodeCode(text, 'reply');
            // A reply for another open invite goes to that one (the host pasted it in the wrong row).
            const target = this.host.inviteFor(reply.tag) ?? null;
            if (target === null) throw new Error('this reply code does not answer any open invite (it is for an older invite, or was used already)');
            await target.acceptReply(reply);
        } catch (err) {
            this.paint(err instanceof Error ? err.message : String(err));
        }
    }

    paint(problem?: string): void {
        const inv = this.invite;
        this.el.dataset.state = inv.state;
        if (this.codeIn.value !== inv.code) this.codeIn.value = inv.code;
        const live = inv.state === 'waiting';
        this.copyBtn.disabled = inv.code === '' || inv.state === 'closed' || inv.state === 'connected';
        this.replyIn.disabled = this.connectBtn.disabled = !live;
        this.stateEl.textContent = problem !== undefined ? `${stateText(inv.state, inv.error)} — ${problem}` : stateText(inv.state, inv.error);
        this.stateEl.classList.toggle('mp-error', inv.state === 'failed' || problem !== undefined);
        const failed = inv.state === 'failed';
        this.help.hidden = !failed;
        if (failed) this.help.textContent = fallbackHelp(this.host.port);
        this.retryBtn.hidden = !failed;
        for (const row of this.el.querySelectorAll<HTMLElement>('.mp-code-row')) row.hidden = inv.state === 'connected';
    }
}

/**
 * Hosting on the Internet: the invites, from the lobby into the game. `deliver` gets each opened link (the endpoint's
 * current onIncoming: the lobby, or the rejoin gate in the game).
 */
export class InternetHost {
    private readonly invites = new Set<RtcInvite>();
    private closed = false;
    private count = 0;
    /** The LAN port also listening (the direct-IP fallback), or null. */
    port: number | null = null;
    /** The router mapping's public address ('ip:port'), when one was made. */
    publicAddress: string | null = null;

    constructor(private readonly deliver: (link: Link) => void) {}

    newInvite(): RtcInvite {
        if (this.closed) throw new Error('not hosting any more');
        const inv = new RtcInvite(rtcOptions());
        this.invites.add(inv);
        inv.onLink = (link) => {
            openedLinks.push(link);
            this.invites.delete(inv);
            if (this.closed) link.close('the host stopped hosting');
            else this.deliver(link);
        };
        return inv;
    }

    /** The open invite with this tag (a reply code's), if any. */
    inviteFor(tag: number): RtcInvite | undefined {
        for (const inv of this.invites) if (inv.tag === tag && inv.state === 'waiting') return inv;
        return undefined;
    }

    drop(inv: RtcInvite): void {
        inv.close();
        this.invites.delete(inv);
    }

    /** The game started: the lobby's open invites are withdrawn (rejoin invites come from the banner). */
    withdrawAll(): void {
        for (const inv of this.invites) inv.close();
        this.invites.clear();
    }

    /** Hosting stopped: every invite code becomes worthless (links already open stay with the session). */
    close(): void {
        this.closed = true;
        for (const inv of this.invites) inv.close();
        this.invites.clear();
    }

    get isClosed(): boolean {
        return this.closed;
    }

    /** The lobby's invite board: one row per invite; a new one opens when one connects. */
    board(maxInvites: () => number): HTMLElement {
        const box = h('div', 'mp-box mp-invites');
        box.dataset.mp = 'invites';
        box.appendChild(h('div', 'mp-subtitle', 'Invite players over the Internet'));
        box.appendChild(h('div', 'mp-note', 'Each player needs their own invite code. Send it to them (e.g. over Discord); they paste it in Multiplayer → Join by code and send you back a reply code, which you paste here. The game then connects your PCs directly: no server is involved.'));
        const rows = h('div', 'mp-invite-rows');
        box.appendChild(rows);
        const add = (): void => {
            if (this.closed) return;
            this.count++;
            const row = new InviteRow(this.newInvite(), `Invite ${this.count}`, this, false);
            const watch = (inv: RtcInvite): void => {
                const prev = inv.onState;
                inv.onState = (s, i) => {
                    prev?.(s, i);
                    if (s === 'connected' && this.openCount() === 0 && this.count < maxInvites()) add();
                };
            };
            watch(row.current);
            row.onRetry = () => {
                this.drop(row.current);
                row.bind(this.newInvite());
                watch(row.current);
            };
            rows.appendChild(row.el);
        };
        box.appendChild(button('New Invite Code', 'invite-new', () => add()));
        add();
        return box;
    }

    private openCount(): number {
        let n = 0;
        for (const inv of this.invites) if (inv.state === 'waiting' || inv.state === 'preparing' || inv.state === 'connecting') n++;
        return n;
    }

    private readonly rejoinRows = new Map<number, InviteRow>();

    /** In the game: an invite for the absent player of `slot` (kept while they are away; a fresh one after use). */
    rejoinWidget(slot: number, name: string): HTMLElement {
        let row = this.rejoinRows.get(slot);
        if (row === undefined || row.current.state === 'connected' || row.current.state === 'closed') {
            if (row !== undefined) row.el.remove();
            row = new InviteRow(this.newInvite(), `Invite code for ${name} to rejoin:`, this, true);
            const r = row;
            r.onRetry = () => {
                this.drop(r.current);
                r.bind(this.newInvite());
            };
            this.rejoinRows.set(slot, row);
        }
        return row.el;
    }

    /** The player of `slot` is back (or the game ended): withdraw their rejoin invite. */
    endRejoin(slot: number): void {
        const row = this.rejoinRows.get(slot);
        if (row === undefined) return;
        this.rejoinRows.delete(slot);
        if (row.current.state !== 'connected') this.drop(row.current);
        row.el.remove();
    }

    rejoinSlots(): number[] {
        return [...this.rejoinRows.keys()];
    }
}

/**
 * Joiner: the "Join by code" dialog. Resolves with the open link to the host, or rejects when the player cancels or
 * the connection fails (the dialog then shows why and the fallbacks first).
 */
export function openCodeJoin(opts: { title: string; note?: string }): Promise<Link> {
    return new Promise<Link>((resolve, reject) => {
        const root = h('div', 'mp-screen mp-screen-top');
        root.dataset.mp = 'code-join';
        const win = h('div', 'mp-window');
        root.appendChild(win);
        win.appendChild(h('div', 'mp-title', opts.title));
        win.appendChild(h('div', 'mp-note', opts.note ?? 'Paste the invite code the host sent you. You get a reply code: send it back to the host, who pastes it in their lobby. The game then connects directly to the host (no server).'));
        const inviteIn = h('textarea', 'mp-input mp-code');
        inviteIn.dataset.mp = 'invite-in';
        inviteIn.rows = 3;
        inviteIn.placeholder = 'DWI…';
        inviteIn.spellcheck = false;
        stopKeys(inviteIn);
        const r1 = h('div', 'mp-code-row');
        r1.append(h('span', 'mp-code-label', 'Invite code'), inviteIn);
        const makeBtn = button('Create Reply Code', 'make-reply', () => void make());
        const replyOut = h('textarea', 'mp-input mp-code');
        replyOut.dataset.mp = 'reply-out';
        replyOut.readOnly = true;
        replyOut.rows = 2;
        replyOut.spellcheck = false;
        replyOut.addEventListener('focus', () => replyOut.select());
        stopKeys(replyOut);
        const copyBtn = button('Copy', 'reply-copy', () => void copyText(replyOut.value, replyOut, copyBtn));
        const r2 = h('div', 'mp-code-row');
        r2.append(h('span', 'mp-code-label', 'Your reply code'), replyOut, copyBtn);
        r2.hidden = true;
        const status = h('div', 'mp-status');
        status.dataset.mp = 'code-status';
        const help = h('div', 'mp-note');
        help.hidden = true;
        const cancelBtn = button('Cancel', 'code-cancel', () => finish(new Error('cancelled')), 'mp-btn mp-btn-secondary');
        win.append(r1, makeBtn, r2, status, help, cancelBtn);
        document.body.appendChild(root);
        inviteIn.focus();

        let join: Awaited<ReturnType<typeof answerInvite>> | null = null;
        let settled = false;
        const setStatus = (t: string, error = false): void => {
            status.textContent = t;
            status.classList.toggle('mp-error', error);
        };
        function finish(err: Error | null, link?: Link): void {
            if (settled) return;
            settled = true;
            if (err !== null) join?.cancel();
            root.remove();
            if (err !== null) reject(err);
            else resolve(link!);
        }

        async function make(): Promise<void> {
            makeBtn.disabled = true;
            help.hidden = true;
            try {
                const invite = await decodeCode(inviteIn.value, 'invite');
                setStatus('Preparing your reply code (asking a STUN server for your public address)…');
                join?.cancel();
                const j = await answerInvite(invite, rtcOptions());
                join = j;
                replyOut.value = j.reply;
                r2.hidden = false;
                inviteIn.readOnly = true;
                const paint = (): void => {
                    if (j.state === 'connected') setStatus('Connected.');
                    else if (j.state === 'failed') {
                        setStatus('No direct connection yet. If the host has entered your reply code, your networks cannot connect directly; it keeps trying for a few minutes.', true);
                        help.hidden = false;
                        help.textContent = fallbackHelp(null);
                    } else setStatus(j.state === 'connecting' ? 'Send this reply code to the host. Waiting for the host to enter it (connecting)…' : 'Send this reply code to the host. Waiting for the host to enter it…');
                };
                j.onState = paint;
                paint();
                // We cannot see when the host enters the reply; after a while, say what to do if nothing happens.
                const slow = setTimeout(() => {
                    if (settled || join !== j || j.state === 'connected') return;
                    setStatus('Not connected yet. If the host has already entered your reply code, a direct connection between your networks is not possible (it keeps trying for a few minutes).', true);
                    help.hidden = false;
                    help.textContent = fallbackHelp(null);
                }, 45_000);
                j.link.finally(() => clearTimeout(slow)).catch(() => undefined);
                replyOut.focus();
                j.link.then(
                    (link) => {
                        openedLinks.push(link);
                        finish(null, link);
                    },
                    (err: unknown) => {
                        if (settled) return;
                        setStatus(`Could not connect: ${err instanceof Error ? err.message : String(err)}`, true);
                        help.hidden = false;
                        help.textContent = fallbackHelp(null);
                        inviteIn.readOnly = false;
                        makeBtn.disabled = false;
                        r2.hidden = true;
                    },
                );
            } catch (err) {
                setStatus(err instanceof Error ? err.message : String(err), true);
                makeBtn.disabled = false;
            }
        }
    });
}

// Scripts and debugging: the code layer of the Internet screens (window.__dwuRtc).
(globalThis as unknown as { __dwuRtc?: unknown }).__dwuRtc = {
    RtcInvite,
    answerInvite,
    decodeCode,
    expandSdp,
    rtcOptions,
    /** The selected ICE path of each open WebRTC link. */
    paths: async () => Promise.all(openedLinks.filter((l) => l.isOpen).map((l) => rtcLinkPath(l))),
};
