// Multiplayer chat (docs/MULTIPLAYER.md §19): one small panel, in the lobby (inside its window) and in the game (a
// dark glass box at the lower left, above the session chip, hidden until wanted). Not sim state: the lines travel on
// the lobby link (lobby.ts lobbyChat) or the side channel of the running game (sideChannel.ts, kind 'chat'), never
// through the lockstep session, so they cannot change a digest.
//
// - To everyone, or privately to one player (the "To" list).
// - In the game: Enter opens it with the cursor in the line (and sends; an empty line or Escape closes it again); a
//   line that arrives while it is closed shows for a few seconds as a notice above the chip, with an unread count.
// - Bounded: at most CHAT_MAX_CHARS a line (lobby.ts LOBBY_CHAT_MAX_CHARS), a burst of CHAT_BURST lines then one a
//   second (lobby.ts ChatLimiter, on the sender and again on the host), the last CHAT_KEEP lines kept.
//
// Main thread / DOM.

import { ChatLimiter, cleanChat, LOBBY_CHAT_MAX_CHARS } from '../../net/lobby';

/** Lines kept in the panel. */
export const CHAT_KEEP = 200;

export interface ChatPeer {
    slot: number;
    name: string;
}

export interface ChatPanelOptions {
    mode: 'lobby' | 'game';
    mySlot: number;
    /** The other players (for the To list). */
    peers: () => ChatPeer[];
    /** Send a line (to a slot, or -1: everyone); false when it could not go (no link). */
    send: (text: string, to: number) => boolean;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (cls !== '') e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
}

export class ChatPanel {
    readonly el: HTMLElement;
    private readonly list: HTMLElement;
    private readonly input: HTMLInputElement;
    private readonly to: HTMLSelectElement;
    private readonly notice: HTMLElement | null = null;
    private readonly toggleBtn: HTMLButtonElement | null = null;
    private readonly limit = new ChatLimiter();
    private unread = 0;
    private open: boolean;
    private noticeTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly onKey: ((e: KeyboardEvent) => void) | null = null;
    /** Lines shown (scripts / tests: __dwuChat.lines()). */
    readonly lines: Array<{ from: number; name: string; text: string; to: number; at: number }> = [];

    constructor(private readonly opts: ChatPanelOptions) {
        const game = opts.mode === 'game';
        this.open = !game;
        this.el = h('div', `mp-chat mp-chat-${opts.mode}`);
        this.el.dataset.mp = 'chat';
        const head = h('div', 'mp-chat-head');
        head.appendChild(h('span', 'mp-chat-title', 'Chat'));
        if (game) {
            const close = h('button', 'mp-chat-close', '×');
            close.type = 'button';
            close.title = 'Close (Escape)';
            close.addEventListener('click', () => this.setOpen(false));
            head.appendChild(close);
        }
        this.list = h('div', 'mp-chat-list');
        this.list.dataset.mp = 'chat-list';
        const row = h('div', 'mp-chat-row');
        this.to = h('select', 'mp-chat-to');
        this.to.dataset.mp = 'chat-to';
        this.to.title = 'To everyone, or privately to one player';
        this.input = h('input', 'mp-chat-input');
        this.input.dataset.mp = 'chat-input';
        this.input.maxLength = LOBBY_CHAT_MAX_CHARS;
        this.input.placeholder = game ? 'Say something (Enter sends)' : 'Say something to the lobby';
        const sendBtn = h('button', 'mp-btn mp-chat-send', 'Send');
        sendBtn.type = 'button';
        sendBtn.dataset.mp = 'chat-send';
        sendBtn.addEventListener('click', () => this.submit());
        // The game's hotkeys must not see typing here.
        for (const e of [this.input, this.to] as HTMLElement[]) e.addEventListener('keydown', (ev: KeyboardEvent) => {
            ev.stopPropagation();
            if (e === this.input && ev.key === 'Enter') {
                ev.preventDefault();
                if (this.input.value.trim() === '' && game) this.setOpen(false);
                else this.submit();
            } else if (ev.key === 'Escape' && game) {
                ev.preventDefault();
                this.setOpen(false);
            }
        });
        this.to.addEventListener('focus', () => this.fillTargets());
        row.append(this.to, this.input, sendBtn);
        this.el.append(head, this.list, row);
        this.fillTargets();
        if (game) {
            this.el.hidden = true;
            const notice = h('div', 'mp-chat-notice');
            notice.dataset.mp = 'chat-notice';
            notice.hidden = true;
            notice.addEventListener('click', () => this.setOpen(true));
            const btn = h('button', 'mp-chat-toggle', 'Chat');
            btn.type = 'button';
            btn.dataset.mp = 'chat-toggle';
            btn.title = 'Chat with the other players (Enter)';
            btn.addEventListener('click', () => this.setOpen(!this.open));
            this.notice = notice;
            this.toggleBtn = btn;
            document.body.append(this.el, notice, btn);
            // Enter opens the chat (when no text field has the keyboard and no window takes the key).
            this.onKey = (e: KeyboardEvent) => {
                if (e.key !== 'Enter' || e.ctrlKey || e.altKey || e.metaKey || this.open) return;
                const t = e.target as HTMLElement | null;
                if (t !== null && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
                e.preventDefault();
                e.stopPropagation();
                this.setOpen(true);
            };
            window.addEventListener('keydown', this.onKey, true);
        }
    }

    private fillTargets(): void {
        const cur = this.to.value;
        const opts = [new Option('All', '-1')].concat(this.opts.peers().filter((p) => p.slot !== this.opts.mySlot).map((p) => new Option(`To ${p.name}`, String(p.slot))));
        this.to.replaceChildren(...opts);
        this.to.value = opts.some((o) => o.value === cur) ? cur : '-1';
    }

    private submit(): void {
        const text = cleanChat(this.input.value);
        if (text === '') return;
        if (!this.limit.take()) {
            this.system('Slow down: too many lines at once.');
            return;
        }
        const to = Number(this.to.value);
        if (!this.opts.send(text, to)) {
            this.system('Not sent: no connection.');
            return;
        }
        this.input.value = '';
        this.add(this.opts.mySlot, 'You', text, to, true);
    }

    /** A line from `from` (`to`: -1 everyone, else a slot: a private line). */
    add(from: number, name: string, text: string, to: number, mine = false): void {
        const t = cleanChat(text);
        if (t === '') return;
        this.lines.push({ from, name, text: t, to, at: Date.now() });
        if (this.lines.length > CHAT_KEEP) this.lines.shift();
        const line = h('div', `mp-chat-line${to >= 0 ? ' mp-chat-private' : ''}${mine ? ' mp-chat-mine' : ''}`);
        const who = mine ? (to >= 0 ? `You → ${this.nameOf(to)}` : 'You') : to >= 0 ? `${name} (to you)` : name;
        line.append(h('span', 'mp-chat-who', `${who}: `), h('span', 'mp-chat-text', t));
        this.list.appendChild(line);
        while (this.list.childElementCount > CHAT_KEEP) this.list.firstElementChild?.remove();
        this.list.scrollTop = this.list.scrollHeight;
        if (!mine && !this.open) this.notify(`${who}: ${t}`);
    }

    /** A line of the app itself (grey). */
    system(text: string): void {
        const line = h('div', 'mp-chat-line mp-chat-system', text);
        this.list.appendChild(line);
        this.list.scrollTop = this.list.scrollHeight;
    }

    private nameOf(slot: number): string {
        return this.opts.peers().find((p) => p.slot === slot)?.name ?? `player ${slot + 1}`;
    }

    private notify(text: string): void {
        this.unread++;
        if (this.toggleBtn !== null) this.toggleBtn.textContent = `Chat (${this.unread})`;
        const n = this.notice;
        if (n === null) return;
        n.textContent = text.length > 120 ? `${text.slice(0, 117)}…` : text;
        n.hidden = false;
        if (this.noticeTimer !== null) clearTimeout(this.noticeTimer);
        this.noticeTimer = setTimeout(() => (n.hidden = true), 6000);
    }

    setOpen(open: boolean): void {
        if (this.opts.mode !== 'game') return;
        this.open = open;
        this.el.hidden = !open;
        if (open) {
            this.unread = 0;
            if (this.toggleBtn !== null) this.toggleBtn.textContent = 'Chat';
            if (this.notice !== null) this.notice.hidden = true;
            this.fillTargets();
            this.list.scrollTop = this.list.scrollHeight;
            this.input.focus();
        } else this.input.blur();
    }

    get isOpen(): boolean {
        return this.open;
    }

    destroy(): void {
        if (this.onKey !== null) window.removeEventListener('keydown', this.onKey, true);
        if (this.noticeTimer !== null) clearTimeout(this.noticeTimer);
        this.el.remove();
        this.notice?.remove();
        this.toggleBtn?.remove();
    }
}
