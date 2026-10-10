// The multiplayer lobby (multiplayer Phase 3, docs/MULTIPLAYER.md §10): what runs on a link before the lockstep session
// (lockstep.ts) takes it over.
//
// 1. The joiner says lobbyHello with its name and its AppFingerprint (fingerprint.ts). The host compares it with its own
//    and refuses a mismatch (lobbyRefused, then it closes the link) with a message for the joiner.
// 2. Otherwise the host gives it a slot (lobbyWelcome) and from then on sends everyone the lobby state on every change
//    (lobbyState): the players, each with an empire pick (the hot-seat row: name, race, government, flag colours) or,
//    for a loaded game, the saved human empire it takes; who is ready; and the host's game settings, as text.
// 3. A client changes its own pick / ready flag (lobbyPick). The host changes the settings and its own pick.
// 4. The host starts (lobbyStart, with what every peer needs to build the same game: MultiplayerStart). From then on
//    the link belongs to the lockstep session: LobbyHost.start / LobbyClient.onStart hand over a HandoffLink that holds
//    what arrives until the session listens. The host's handoff rewrites the joiner's lockstep hello name to its slot
//    (peerName), so a client cannot claim someone else's empire: authorize() reads the slot from the PeerInfo name.
//
// Star topology as the session: clients talk only to the host. Headless: no DOM / Pixi / Node APIs.

import type { Link } from './transport';
import type { AppFingerprint } from './fingerprint';
import { fingerprintMismatch } from './fingerprint';
import type { ClockState, LockstepParams } from './protocol';
import type { HumanPlayerStart } from '../sim/humanPlayerStarts';
import type { StartGameOptions } from '../sim/startGameOptions';

/** Most players in one game (the host plus 7: the hot-seat limit, sim/humanPlayerStarts.ts). */
export const LOBBY_MAX_PLAYERS = 8;

export interface LobbyPlayer {
    /** 0 = the host; clients 1, 2, … in join order (never reused in a lobby). */
    slot: number;
    name: string;
    /** New game: the empire this player founds. */
    pick: HumanPlayerStart;
    /** Loaded game: the index in the save's galaxy.humanEmpires this player takes (-1 = none chosen yet). */
    claim: number;
    ready: boolean;
}

/** A loaded multiplayer save's humans (LobbyState.loaded). */
export interface LoadedHumanSlot {
    humanIndex: number;
    empireName: string;
    /** Who played it when the game was saved ('' = unknown). */
    playerName: string;
}

export interface LobbyState {
    players: LobbyPlayer[];
    /** The host's game settings, one line each (for display). */
    settings: string[];
    /** Loading a saved game: its human empires (the players claim them); null = a new game. */
    loaded: { name: string; humans: LoadedHumanSlot[] } | null;
}

/** What every peer needs to build the identical game (sent by the host on Start). */
export interface MultiplayerStart {
    kind: 'new' | 'load';
    /** New game: the start options, the clients' empires as humanPlayers in slot order. Load: the save's (display). */
    startOptions: StartGameOptions;
    /**
     * New game: what createGame takes from the host's local settings beside the start options (main.ts
     * bootGameFromWizard: gameOptions, messageOptions, playerFlagShape). Plain JSON, opaque here.
     */
    createExtras: Record<string, unknown> | null;
    /** Load: the save's add-on choice ({ id, include } as main.ts gameDataForSave reads it); null = base game. */
    scenario: { id: string; include: string[] | null } | null;
    /** Who plays which human: humanIndex into galaxy.humanEmpires (0 = the host's empire, the primary human). */
    players: Array<{ slot: number; name: string; humanIndex: number }>;
    params: LockstepParams;
    clock: ClockState;
}

export type LobbyMessage =
    /** `rejoin`: the token of an earlier lobbyStart (reconnecting to a running game). */
    | { t: 'lobbyHello'; name: string; fp: AppFingerprint; rejoin?: string }
    | { t: 'lobbyRefused'; reason: string }
    | { t: 'lobbyWelcome'; slot: number; state: LobbyState; host: AppFingerprint }
    | { t: 'lobbyState'; state: LobbyState }
    | { t: 'lobbyPick'; pick: HumanPlayerStart; claim: number; ready: boolean }
    /** `token`: this player's rejoin token (multiplayer Phase 4: a dropped player reconnects with it). */
    | { t: 'lobbyStart'; start: MultiplayerStart; token?: string }
    | { t: 'lobbyBye'; reason: string }
    /**
     * Host → a player reconnecting to a running game (Phase 4, docs/MULTIPLAYER.md §12): their slot is free again (by
     * `rejoin` token or by name); join the lockstep session over this link, which brings the current save.
     */
    | { t: 'lobbyRejoin'; slot: number; start: MultiplayerStart; token: string };

/** The lockstep peer name of a lobby slot: "<slot>|<display name>" (the host writes it: HandoffLink). */
export function peerName(slot: number, name: string): string {
    return `${slot}|${name}`;
}

/** The slot in a lockstep peer name (peerName), or -1. */
export function slotOfPeerName(name: string): number {
    const m = /^(\d+)\|/.exec(name);
    return m === null ? -1 : Number(m[1]);
}

/** A fresh rejoin token (random hex). */
export function rejoinToken(): string {
    const b = new Uint8Array(12);
    crypto.getRandomValues(b);
    return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Host: the link of lobby `slot` handed to the lockstep session: a HandoffLink whose first message — the joiner's
 * lockstep hello — gets the slot's peerName, whatever the client wrote (authorize() reads the slot from it).
 */
export function slotHandoff(link: Link, slot: number, name: string): HandoffLink {
    const pn = peerName(slot, name);
    return new HandoffLink(link, (text) => {
        try {
            const m = JSON.parse(text) as { t?: string; name?: string };
            if (m.t === 'hello') return JSON.stringify({ ...m, name: pn });
        } catch {
            // not JSON: the session drops it
        }
        return text;
    });
}

/** Parse a lobby message (null: not one). */
export function decodeLobbyMessage(text: string): LobbyMessage | null {
    return decode(text);
}

/** Send a lobby message. */
export function sendLobbyMessage(link: Link, m: LobbyMessage): void {
    send(link, m);
}

function decode(text: string): LobbyMessage | null {
    try {
        const m = JSON.parse(text) as { t?: unknown };
        return m !== null && typeof m === 'object' && typeof m.t === 'string' && m.t.startsWith('lobby') ? (m as LobbyMessage) : null;
    } catch {
        return null;
    }
}

function send(link: Link, m: LobbyMessage): void {
    link.send(JSON.stringify(m));
}

function cleanName(name: unknown, fallback: string): string {
    const s = typeof name === 'string' ? name.replace(/[\u0000-\u001f|]/g, '').trim().slice(0, 32) : '';
    return s === '' ? fallback : s;
}

function cleanPick(p: Partial<HumanPlayerStart> | undefined): HumanPlayerStart {
    const color = (c: unknown, d: string): string => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : d);
    return {
        name: typeof p?.name === 'string' ? p.name.slice(0, 48) : '',
        race: typeof p?.race === 'string' ? p.race.slice(0, 64) : '',
        governmentId: Number.isInteger(p?.governmentId) ? (p!.governmentId as number) : -1,
        primaryColor: color(p?.primaryColor, '#808080'),
        secondaryColor: color(p?.secondaryColor, '#ffffff'),
    };
}

// ---------------------------------------------------------------------------------------------------------------------
// HandoffLink: the link after Start
// ---------------------------------------------------------------------------------------------------------------------

/**
 * A link handed from the lobby to the lockstep session: what arrives before the session sets onMessage / onClose is
 * kept and delivered then, in order. `rewrite` (host side) may change the first message (the joiner's lockstep hello).
 */
export class HandoffLink implements Link {
    private handler: ((text: string) => void) | null = null;
    private closeHandler: ((reason: string) => void) | null = null;
    private readonly queue: string[] = [];
    private closedReason: string | null = null;
    private first = true;

    constructor(private readonly inner: Link, private readonly rewrite?: (text: string) => string) {
        inner.onMessage = (text) => {
            if (this.first) {
                this.first = false;
                if (this.rewrite !== undefined) text = this.rewrite(text);
            }
            if (this.handler !== null && this.queue.length === 0) this.handler(text);
            else this.queue.push(text);
        };
        inner.onClose = (reason) => {
            this.closedReason = reason;
            if (this.handler !== null && this.queue.length === 0) this.closeHandler?.(reason);
        };
    }

    get onMessage(): ((text: string) => void) | null {
        return this.handler;
    }

    set onMessage(fn: ((text: string) => void) | null) {
        this.handler = fn;
        if (fn !== null && this.queue.length > 0) queueMicrotask(() => this.flush());
    }

    get onClose(): ((reason: string) => void) | null {
        return this.closeHandler;
    }

    set onClose(fn: ((reason: string) => void) | null) {
        this.closeHandler = fn;
        if (fn !== null && this.closedReason !== null && this.queue.length === 0 && this.handler !== null) queueMicrotask(() => this.flush());
    }

    private flush(): void {
        while (this.handler !== null && this.queue.length > 0) this.handler(this.queue.shift()!);
        if (this.queue.length === 0 && this.closedReason !== null) {
            const r = this.closedReason;
            const fn = this.closeHandler;
            if (fn !== null) {
                this.closeHandler = null;
                fn(r);
            }
        }
    }

    get isOpen(): boolean {
        return this.inner.isOpen;
    }

    send(text: string): void {
        this.inner.send(text);
    }

    close(reason?: string): void {
        this.inner.close(reason);
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------------------------------------------------

export interface LobbyHostOptions {
    name: string;
    fingerprint: AppFingerprint;
    hostPick: HumanPlayerStart;
    maxPlayers?: number;
    /** The lobby state changed (players, picks, settings). */
    onChange?: (state: LobbyState) => void;
    log?: (message: string) => void;
}

interface ClientEntry {
    player: LobbyPlayer;
    link: Link;
}

export class LobbyHost {
    private readonly players = new Map<number, LobbyPlayer>();
    private readonly clients = new Map<number, ClientEntry>();
    private nextSlot = 1;
    private settings: string[] = [];
    private loaded: LobbyState['loaded'] = null;
    private started = false;
    private closed = false;
    readonly fingerprint: AppFingerprint;

    constructor(private readonly opts: LobbyHostOptions) {
        this.fingerprint = opts.fingerprint;
        this.players.set(0, { slot: 0, name: cleanName(opts.name, 'Host'), pick: cleanPick(opts.hostPick), claim: -1, ready: true });
    }

    get isStarted(): boolean {
        return this.started;
    }

    state(): LobbyState {
        return {
            players: [...this.players.values()].sort((a, b) => a.slot - b.slot).map((p) => ({ ...p, pick: { ...p.pick } })),
            settings: [...this.settings],
            loaded: this.loaded === null ? null : { name: this.loaded.name, humans: this.loaded.humans.map((h) => ({ ...h })) },
        };
    }

    /** A new connection: it must say lobbyHello first. */
    accept(link: Link, remote = ''): void {
        if (this.closed || this.started) {
            send(link, { t: 'lobbyRefused', reason: this.started ? 'The game has already started.' : 'The host closed the lobby.' });
            link.close('refused');
            return;
        }
        let entry: ClientEntry | null = null;
        link.onMessage = (text) => {
            const m = decode(text);
            if (m === null) return;
            if (entry === null) {
                if (m.t !== 'lobbyHello') return;
                entry = this.admit(link, m, remote);
                return;
            }
            if (m.t === 'lobbyPick') {
                const p = entry.player;
                p.pick = cleanPick(m.pick);
                p.claim = this.loaded !== null && Number.isInteger(m.claim) ? this.validClaim(m.claim, p.slot) : -1;
                p.ready = m.ready === true;
                this.changed();
            }
        };
        link.onClose = (reason) => {
            if (entry === null || this.started) return;
            this.players.delete(entry.player.slot);
            this.clients.delete(entry.player.slot);
            this.opts.log?.(`${entry.player.name} left the lobby (${reason})`);
            this.changed();
        };
    }

    private admit(link: Link, m: Extract<LobbyMessage, { t: 'lobbyHello' }>, remote: string): ClientEntry | null {
        const refuse = (reason: string): null => {
            this.opts.log?.(`refused ${remote || 'a player'}: ${reason}`);
            send(link, { t: 'lobbyRefused', reason });
            link.close('refused');
            return null;
        };
        const fp = m.fp as AppFingerprint | undefined;
        if (fp === undefined || typeof fp !== 'object') return refuse('Your app sent no version information: update it to the host\'s version.');
        const why = fingerprintMismatch(this.fingerprint, fp);
        if (why !== null) return refuse(why);
        if (this.players.size >= (this.opts.maxPlayers ?? LOBBY_MAX_PLAYERS)) return refuse(`The game is full (${this.players.size} players).`);
        const slot = this.nextSlot++;
        let name = cleanName(m.name, `Player ${slot + 1}`);
        if ([...this.players.values()].some((p) => p.name.toLowerCase() === name.toLowerCase())) name = `${name} (${slot + 1})`;
        const player: LobbyPlayer = { slot, name, pick: cleanPick({ name: '', race: '', governmentId: -1, primaryColor: freshColor(this.players), secondaryColor: '#ffffff' }), claim: -1, ready: false };
        // A loaded game: the saved human this name played, when free.
        if (this.loaded !== null) {
            const mine = this.loaded.humans.find((h) => h.playerName !== '' && h.playerName.toLowerCase() === name.toLowerCase());
            if (mine !== undefined) player.claim = this.validClaim(mine.humanIndex, slot);
        }
        this.players.set(slot, player);
        const entry: ClientEntry = { player, link };
        this.clients.set(slot, entry);
        this.opts.log?.(`${name} joined the lobby${remote !== '' ? ` from ${remote}` : ''} (slot ${slot})`);
        send(link, { t: 'lobbyWelcome', slot, state: this.state(), host: this.fingerprint });
        this.changed(entry);
        return entry;
    }

    /** `claim` if no one else holds it and it names a saved human other than the host's (0), else -1. */
    private validClaim(claim: number, slot: number): number {
        if (this.loaded === null || !this.loaded.humans.some((h) => h.humanIndex === claim) || claim === 0) return -1;
        for (const p of this.players.values()) if (p.slot !== slot && p.claim === claim) return -1;
        return claim;
    }

    private changed(skipLink?: ClientEntry): void {
        if (this.closed) return;
        const state = this.state();
        for (const c of this.clients.values()) if (c !== skipLink) send(c.link, { t: 'lobbyState', state });
        this.opts.onChange?.(state);
    }

    setHostPick(pick: HumanPlayerStart, name?: string): void {
        const host = this.players.get(0)!;
        host.pick = cleanPick(pick);
        if (name !== undefined) host.name = cleanName(name, host.name);
        this.changed();
    }

    setSettings(lines: string[]): void {
        this.settings = lines.slice(0, 40).map((l) => String(l).slice(0, 200));
        this.changed();
    }

    /** Loading a saved game (null: back to a new game). The host plays human 0. */
    setLoaded(loaded: LobbyState['loaded']): void {
        this.loaded = loaded;
        const host = this.players.get(0)!;
        host.claim = loaded === null ? -1 : 0;
        for (const p of this.players.values()) {
            if (p.slot === 0) continue;
            p.claim = -1;
            p.ready = false;
            if (loaded !== null) {
                const mine = loaded.humans.find((h) => h.playerName !== '' && h.playerName.toLowerCase() === p.name.toLowerCase());
                if (mine !== undefined) p.claim = this.validClaim(mine.humanIndex, p.slot);
            }
        }
        this.changed();
    }

    /** Why Start is not possible yet, or null. */
    startBlocker(): string | null {
        if (this.started) return 'The game has started.';
        const clients = [...this.players.values()].filter((p) => p.slot !== 0);
        if (clients.length === 0) return 'Waiting for players to join.';
        const notReady = clients.filter((p) => !p.ready);
        if (notReady.length > 0) return `Waiting for ${notReady.map((p) => p.name).join(', ')} to be ready.`;
        if (this.loaded !== null) {
            const unclaimed = clients.filter((p) => p.claim < 0);
            if (unclaimed.length > 0) return `${unclaimed.map((p) => p.name).join(', ')} must pick a saved empire.`;
        }
        return null;
    }

    /** Remove a player from the lobby. */
    kick(slot: number, reason = 'The host removed you from the lobby.'): void {
        const c = this.clients.get(slot);
        if (c === undefined) return;
        send(c.link, { t: 'lobbyBye', reason });
        c.link.close('kicked');
    }

    /**
     * Start: send everyone `start` and hand each client's link over (a HandoffLink that rewrites the joiner's lockstep
     * hello to its slot's peerName). The lobby is done after this.
     */
    start(start: MultiplayerStart): Map<number, HandoffLink> {
        if (this.started) throw new Error('lobby: already started');
        this.started = true;
        const out = new Map<number, HandoffLink>();
        for (const c of this.clients.values()) {
            // Each player's own rejoin token (Phase 4): reconnecting with it gets the same slot back.
            const token = rejoinToken();
            this.tokens.set(c.player.slot, token);
            send(c.link, { t: 'lobbyStart', start, token });
            out.set(c.player.slot, slotHandoff(c.link, c.player.slot, c.player.name));
        }
        return out;
    }

    /** The rejoin tokens handed out at start, by slot. */
    readonly tokens = new Map<number, string>();

    /** Close the lobby (the host left): tell everyone and drop their links. */
    close(reason = 'The host closed the lobby.'): void {
        if (this.closed) return;
        this.closed = true;
        if (this.started) return;
        for (const c of this.clients.values()) {
            send(c.link, { t: 'lobbyBye', reason });
            c.link.close('lobby closed');
        }
        this.clients.clear();
    }
}

function freshColor(players: Map<number, LobbyPlayer>): string {
    const used = new Set([...players.values()].map((p) => p.pick.primaryColor.toLowerCase()));
    const palette = ['#c03030', '#3060d0', '#30a040', '#d0a020', '#a040c0', '#20a0b0', '#e07020', '#808080', '#d050a0', '#60c0e0'];
    return palette.find((c) => !used.has(c)) ?? '#808080';
}

// ---------------------------------------------------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------------------------------------------------

export interface LobbyClientOptions {
    name: string;
    fingerprint: AppFingerprint;
    onChange?: (state: LobbyState) => void;
    /** The host started: build the game from `start`, then join the lockstep session over `link`. */
    onStart?: (start: MultiplayerStart, link: HandoffLink) => void;
    /** The lobby link closed (the host left, kicked, or the network dropped) before the start. */
    onClosed?: (reason: string) => void;
    /** Reconnecting to a running game: the token of the earlier start (Phase 4). */
    rejoin?: string;
    /** The host gave this player its slot of a running game back: join the session over `link` (the save comes). */
    onRejoin?: (start: MultiplayerStart, slot: number, link: HandoffLink, token: string) => void;
}

export class LobbyClient {
    slot = -1;
    state: LobbyState = { players: [], settings: [], loaded: null };
    hostFingerprint: AppFingerprint | null = null;
    /** The rejoin token the host sent with the start (Phase 4). */
    token: string | null = null;
    /** Welcomed back into a running game (lobbyRejoin) rather than into the lobby. */
    rejoined = false;
    private started = false;
    private byeReason: string | null = null;

    private constructor(private readonly link: Link, private readonly opts: LobbyClientOptions) {}

    /** Say hello on `link`; resolves when welcomed, rejects with the host's reason when refused. */
    static join(link: Link, opts: LobbyClientOptions): Promise<LobbyClient> {
        const c = new LobbyClient(link, opts);
        return new Promise((resolve, reject) => {
            let welcomed = false;
            link.onMessage = (text) => {
                const m = decode(text);
                if (m === null) return;
                switch (m.t) {
                    case 'lobbyRefused':
                        if (!welcomed) reject(new Error(m.reason));
                        c.byeReason = m.reason;
                        return;
                    case 'lobbyWelcome':
                        welcomed = true;
                        c.slot = m.slot;
                        c.state = m.state;
                        c.hostFingerprint = m.host;
                        resolve(c);
                        c.opts.onChange?.(c.state);
                        return;
                    case 'lobbyState':
                        c.state = m.state;
                        c.opts.onChange?.(c.state);
                        return;
                    case 'lobbyBye':
                        c.byeReason = m.reason;
                        return;
                    case 'lobbyStart': {
                        if (c.started) return;
                        c.started = true;
                        c.token = typeof m.token === 'string' ? m.token : null;
                        const handoff = new HandoffLink(link);
                        c.opts.onStart?.(m.start, handoff);
                        return;
                    }
                    case 'lobbyRejoin': {
                        if (c.started) return;
                        c.started = true;
                        c.rejoined = true;
                        welcomed = true;
                        c.slot = m.slot;
                        c.token = m.token;
                        const handoff = new HandoffLink(link);
                        resolve(c);
                        c.opts.onRejoin?.(m.start, m.slot, handoff, m.token);
                        return;
                    }
                    default:
                        return;
                }
            };
            link.onClose = (reason) => {
                if (c.started) return;
                const why = c.byeReason ?? `The connection to the host closed (${reason}).`;
                if (!welcomed) reject(new Error(why));
                else c.opts.onClosed?.(why);
            };
            send(link, { t: 'lobbyHello', name: opts.name, fp: opts.fingerprint, ...(opts.rejoin !== undefined ? { rejoin: opts.rejoin } : {}) });
        });
    }

    /** This player's row. */
    me(): LobbyPlayer | null {
        return this.state.players.find((p) => p.slot === this.slot) ?? null;
    }

    setPick(pick: HumanPlayerStart, claim: number, ready: boolean): void {
        if (this.started) return;
        send(this.link, { t: 'lobbyPick', pick, claim, ready });
    }

    leave(): void {
        if (this.started) return;
        this.link.close('left the lobby');
    }
}
