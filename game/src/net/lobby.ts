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
import { fingerprintDifference } from './fingerprint';
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
    /** Phase 5: the add-on packages of the host's settings this player's app does not have (it cannot build the game). */
    missing?: string[];
}

/**
 * Phase 5 (docs/MULTIPLAYER.md §17): the add-on set of the host's game settings, for everyone to see: the scenario
 * packages that run (by id and name, the ones they pull in included) with the choice's flags and params.
 */
export interface LobbyAddonSet {
    /** The start choice's scenario id ('addons' for a composite of several). */
    id: string;
    /** Every package that runs (overlay ids), and their names. */
    packages: string[];
    names: string[];
    /** Expansions (names) with any member running; the members are in `packages`, which is what must match. */
    expansions?: string[];
    flags: Record<string, boolean>;
    params: Record<string, number>;
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
    /** Phase 5: the host's theme ('' = the stock game) and add-on set (null: none) — what everyone plays with. */
    host?: { theme: string; addons: LobbyAddonSet | null };
}

/** Phase 5: a chat line in the lobby (sideChannel.ts carries the in-game ones). */
export const LOBBY_CHAT_MAX_CHARS = 400;

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
    /**
     * A new player joining the running game (§21), on the joiner only: the empire (empireId) its slot takes over at
     * its first input frame — its screen shows that empire until the host's addHumanSeat maps the slot (`players`).
     * Never read by the command check.
     */
    joining?: { slot: number; empireId: number };
}

export type LobbyMessage =
    /** `rejoin`: the token of an earlier lobbyStart (reconnecting to a running game). */
    | { t: 'lobbyHello'; name: string; fp: AppFingerprint; rejoin?: string }
    | { t: 'lobbyRefused'; reason: string }
    | { t: 'lobbyWelcome'; slot: number; state: LobbyState; host: AppFingerprint }
    | { t: 'lobbyState'; state: LobbyState }
    | { t: 'lobbyPick'; pick: HumanPlayerStart; claim: number; ready: boolean; missing?: string[] }
    /**
     * Phase 5 (§17): the joiner's theme, add-on files or game data differ from the host's. Not a refusal: the link stays
     * open, the joiner sees what differs (the host's theme; `files`, the host's per-file hashes, when the data or add-on
     * files differ) and may say lobbyHello again after matching the host's settings (at most LOBBY_HELLO_TRIES times).
     */
    | { t: 'lobbyMismatch'; reason: string; theme: string; files: Array<[string, string]> | null; addons: boolean; data: boolean }
    /** Phase 5 (§19): lobby chat. Client → host: `text` (to: a slot, or absent: everyone). Host → clients: with `from`/`name`. */
    | { t: 'lobbyChat'; text: string; to?: number; from?: number; name?: string }
    /** `token`: this player's rejoin token (multiplayer Phase 4: a dropped player reconnects with it). */
    | { t: 'lobbyStart'; start: MultiplayerStart; token?: string }
    | { t: 'lobbyBye'; reason: string }
    /**
     * Host → a player reconnecting to a running game (Phase 4, docs/MULTIPLAYER.md §12): their slot is free again (by
     * `rejoin` token or by name); join the lockstep session over this link, which brings the current save.
     */
    | { t: 'lobbyRejoin'; slot: number; start: MultiplayerStart; token: string }
    /**
     * Phase 5 (docs/MULTIPLAYER.md §21): host → a NEW player connecting to a running game (not a dropped one): the
     * empires it may take over — an AI empire, or a human seat nobody plays. The joiner answers lobbyJoinPick (or
     * closes the link); the host then sends lobbyRejoin with its new slot, and it takes control at its first input
     * frame (the host's journaled addHumanSeat at that frame: the reverse of an AI takeover).
     */
    | { t: 'lobbyJoinOffer'; game: string; choices: LobbyJoinChoice[] }
    | { t: 'lobbyJoinPick'; empireId: number };

/** One empire a player joining a running game may take over (lobbyJoinOffer). */
export interface LobbyJoinChoice {
    empireId: number;
    name: string;
    /** 'ai': an AI empire; 'seat': a human seat that has no player. */
    kind: 'ai' | 'seat';
    race: string;
    colonies: number;
    /** Empire.mainColor (0xRRGGBB). */
    color: number;
}

/** The joiner's pick, checked against the host's offer (null: not one of them). */
export function checkJoinPick(m: unknown, choices: readonly LobbyJoinChoice[]): LobbyJoinChoice | null {
    if (m === null || typeof m !== 'object') return null;
    const x = m as { t?: unknown; empireId?: unknown };
    if (x.t !== 'lobbyJoinPick' || !Number.isInteger(x.empireId)) return null;
    return choices.find((c) => c.empireId === x.empireId) ?? null;
}

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

/** The most a first message (the lobby hello, with the fingerprint) may hold. */
export const LOBBY_HELLO_MAX_CHARS = 64 * 1024;
/** How many hellos a joiner may send (the first, then after matching the host's settings). */
export const LOBBY_HELLO_TRIES = 5;

/**
 * The first message on a new link, if it is a lobby hello of sane size and shape; null otherwise (the host then
 * refuses the link before reading anything else: nothing but a hello reaches the version check).
 */
export function decodeHello(text: string): Extract<LobbyMessage, { t: 'lobbyHello' }> | null {
    if (text.length > LOBBY_HELLO_MAX_CHARS) return null;
    const m = decode(text);
    if (m === null || m.t !== 'lobbyHello') return null;
    if (m.fp !== undefined && (m.fp === null || typeof m.fp !== 'object')) return null;
    if (m.rejoin !== undefined && (typeof m.rejoin !== 'string' || m.rejoin.length > 64)) return null;
    return m;
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
 * `filter` (Phase 5: the side channel of chat and host-migration signalling, ui/multiplayer/sideChannel.ts) takes the
 * messages it returns true for; the session never sees them.
 */
export class HandoffLink implements Link {
    private handler: ((text: string) => void) | null = null;
    private closeHandler: ((reason: string) => void) | null = null;
    private readonly queue: string[] = [];
    private closedReason: string | null = null;
    private first = true;

    constructor(readonly inner: Link, private readonly rewrite?: (text: string) => string, filter?: (text: string) => boolean) {
        inner.onMessage = (text) => {
            if (filter !== undefined && filter(text)) return;
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
    /** Phase 5: this app's per-file hashes (fingerprint.ts fingerprintFiles), sent to a joiner whose files differ. */
    files?: () => Promise<Array<[string, string]>>;
    /** Phase 5: a lobby chat line (from a slot, to a slot or -1: everyone) — the host's screen shows it. */
    onChat?: (from: number, name: string, text: string, to: number) => void;
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
            ...(this.hostSettings !== null ? { host: { theme: this.hostSettings.theme, addons: this.hostSettings.addons === null ? null : structuredClone(this.hostSettings.addons) } } : {}),
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
        let refused = false;
        let tries = 0;
        let checking = false;
        const chat = new ChatLimiter();
        link.onMessage = (text) => {
            if (refused) return;
            if (entry === null) {
                if (checking) return; // a mismatch's file list is on its way
                // Before the version check only a hello is accepted: anything else closes the link.
                const hello = decodeHello(text);
                if (hello === null || ++tries > LOBBY_HELLO_TRIES) {
                    refused = true;
                    this.opts.log?.(`refused ${remote || 'a connection'}: ${hello === null ? 'it did not start with a lobby hello' : 'too many hellos'}`);
                    send(link, { t: 'lobbyRefused', reason: hello === null ? 'Not an openDWU lobby hello.' : 'Too many tries to match the host\'s settings.' });
                    link.close('refused');
                    return;
                }
                const got = this.admit(link, hello, remote, () => (checking = true), () => (checking = false));
                if (got === 'refused') refused = true;
                else if (got !== 'mismatch') entry = got;
                return;
            }
            const m = decode(text);
            if (m === null) return;
            if (m.t === 'lobbyPick') {
                const p = entry.player;
                p.pick = cleanPick(m.pick);
                p.claim = this.loaded !== null && Number.isInteger(m.claim) ? this.validClaim(m.claim, p.slot) : -1;
                p.ready = m.ready === true;
                p.missing = Array.isArray(m.missing) ? m.missing.filter((x): x is string => typeof x === 'string').slice(0, 40).map((x) => x.slice(0, 80)) : undefined;
                if (p.missing?.length === 0) delete p.missing;
                this.changed();
            } else if (m.t === 'lobbyChat' && typeof m.text === 'string') {
                const t = cleanChat(m.text);
                if (t === '' || !chat.take()) return;
                this.chat(entry.player.slot, t, Number.isInteger(m.to) ? m.to! : -1);
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

    private admit(link: Link, m: Extract<LobbyMessage, { t: 'lobbyHello' }>, remote: string, busy: () => void, idle: () => void): ClientEntry | 'refused' | 'mismatch' {
        const refuse = (reason: string): 'refused' => {
            this.opts.log?.(`refused ${remote || 'a player'}: ${reason}`);
            send(link, { t: 'lobbyRefused', reason });
            link.close('refused');
            return 'refused';
        };
        const fp = m.fp as AppFingerprint | undefined;
        if (fp === undefined || typeof fp !== 'object') return refuse('Your app sent no version information: update it to the host\'s version.');
        const diff = fingerprintDifference(this.fingerprint, fp);
        if (diff !== null && diff.kind === 'hard') return refuse(diff.reason);
        if (diff !== null && diff.kind === 'soft') {
            // Not a refusal (Phase 5): say what differs; the joiner may match the host's settings and say hello again.
            this.opts.log?.(`${remote || 'a player'} differs from the host: ${diff.reason}`);
            const theme = this.fingerprint.theme;
            if ((diff.data || diff.addons) && this.opts.files !== undefined) {
                busy();
                void this.opts.files().then(
                    (files) => send(link, { t: 'lobbyMismatch', reason: diff.reason, theme, files, addons: diff.addons, data: diff.data }),
                    () => send(link, { t: 'lobbyMismatch', reason: diff.reason, theme, files: null, addons: diff.addons, data: diff.data }),
                ).finally(idle);
            } else send(link, { t: 'lobbyMismatch', reason: diff.reason, theme, files: null, addons: diff.addons, data: diff.data });
            return 'mismatch';
        }
        if (this.players.size >= (this.opts.maxPlayers ?? LOBBY_MAX_PLAYERS)) return refuse(`The game is full (${this.players.size} players).`);
        const slot = this.nextSlot++;
        let name = cleanName(m.name, `Player ${slot + 1}`);
        if ([...this.players.values()].some((p) => p.name.toLowerCase() === name.toLowerCase())) name = `${name} (${slot + 1})`;
        const player: LobbyPlayer = { slot, name, pick: cleanPick({ name: '', race: '', governmentId: -1, primaryColor: freshColor(this.players), secondaryColor: '#ffffff' }), claim: -1, ready: false };
        // The token of an earlier game with this host (kept by the joiner's app): the empire it played in a loaded save.
        if (typeof m.rejoin === 'string' && m.rejoin.length <= 64) this.helloTokens.set(slot, m.rejoin);
        // A loaded game: the saved human this token (or else this name) played, when free.
        if (this.loaded !== null) {
            const byToken = this.loadedTokens.get(this.helloTokens.get(slot) ?? '');
            const mine = byToken !== undefined ? this.loaded.humans.find((h) => h.humanIndex === byToken) : this.loaded.humans.find((h) => h.playerName !== '' && h.playerName.toLowerCase() === name.toLowerCase());
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

    /** Lobby chat: from `from` (a slot) to `to` (a slot, or -1: everyone). The host's own lines too (sendChat). */
    private chat(from: number, text: string, to: number): void {
        const name = this.players.get(from)?.name ?? `Player ${from + 1}`;
        const m: LobbyMessage = { t: 'lobbyChat', text, from, name, to };
        for (const c of this.clients.values()) {
            if (c.player.slot === from) continue;
            if (to === -1 || c.player.slot === to) send(c.link, m);
        }
        if (to === -1 || to === 0 || from === 0) this.opts.onChat?.(from, name, text, to);
    }

    /** The host says something in the lobby (to a slot, or -1: everyone). */
    sendChat(text: string, to = -1): boolean {
        const t = cleanChat(text);
        if (t === '' || this.closed || this.started) return false;
        this.chat(0, t, to);
        return true;
    }

    /** Phase 5: the host's theme and add-on set, shown to everyone. */
    setHostSettings(theme: string, addons: LobbyAddonSet | null): void {
        this.hostSettings = { theme, addons };
        this.changed();
    }

    private hostSettings: { theme: string; addons: LobbyAddonSet | null } | null = null;

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

    /** Loading a saved game (null: back to a new game). The host plays human 0. `tokens`: the save's rejoin tokens by
     *  human index ('' none, §21): a player who says hello with one gets that empire (before a name match). */
    setLoaded(loaded: LobbyState['loaded'], tokens?: readonly string[]): void {
        this.loaded = loaded;
        this.loadedTokens.clear();
        if (loaded !== null) (tokens ?? []).forEach((t, i) => typeof t === 'string' && t !== '' && i > 0 && this.loadedTokens.set(t, i));
        const host = this.players.get(0)!;
        host.claim = loaded === null ? -1 : 0;
        for (const p of this.players.values()) {
            if (p.slot === 0) continue;
            p.claim = -1;
            p.ready = false;
            if (loaded !== null) {
                const byToken = this.loadedTokens.get(this.helloTokens.get(p.slot) ?? '');
                const mine = byToken !== undefined ? loaded.humans.find((h) => h.humanIndex === byToken) : loaded.humans.find((h) => h.playerName !== '' && h.playerName.toLowerCase() === p.name.toLowerCase());
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
        const lacking = clients.filter((p) => p.missing !== undefined && p.missing.length > 0);
        if (lacking.length > 0) return lacking.map((p) => `${p.name} does not have the add-on package${p.missing!.length === 1 ? '' : 's'} ${p.missing!.join(', ')}.`).join(' ');
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
            // Each player's own rejoin token (Phase 4): reconnecting with it gets the same slot back. A resumed save
            // keeps the token a player came back with (its app has it stored for this host).
            const hello = this.helloTokens.get(c.player.slot);
            const keep = hello !== undefined && this.loaded !== null && this.loadedTokens.get(hello) === c.player.claim && c.player.claim > 0;
            const token = keep ? hello : rejoinToken();
            this.tokens.set(c.player.slot, token);
            send(c.link, { t: 'lobbyStart', start, token });
            out.set(c.player.slot, slotHandoff(c.link, c.player.slot, c.player.name));
        }
        return out;
    }

    /** The rejoin tokens handed out at start, by slot. */
    readonly tokens = new Map<number, string>();
    /** A loaded save's rejoin tokens → human index (setLoaded); the tokens the players said hello with, by slot. */
    private readonly loadedTokens = new Map<string, number>();
    private readonly helloTokens = new Map<number, string>();

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

/** A chat line as it may travel: no control characters, at most LOBBY_CHAT_MAX_CHARS. */
export function cleanChat(text: unknown): string {
    return typeof text === 'string' ? text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, LOBBY_CHAT_MAX_CHARS) : '';
}

/** Chat rate limit (per sender): CHAT_BURST lines at once, then one per CHAT_EVERY_MS. */
export const CHAT_BURST = 5;
export const CHAT_EVERY_MS = 1000;

export class ChatLimiter {
    private tokens = CHAT_BURST;
    private at = Date.now();
    take(): boolean {
        const now = Date.now();
        this.tokens = Math.min(CHAT_BURST, this.tokens + (now - this.at) / CHAT_EVERY_MS);
        this.at = now;
        if (this.tokens < 1) return false;
        this.tokens -= 1;
        return true;
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
    /**
     * Phase 5: the host says this app's theme / add-on files / data differ (not a refusal). `retry` sends a new hello
     * with the fingerprint after matching the host's settings; without onMismatch the join fails with the reason.
     */
    onMismatch?: (m: Extract<LobbyMessage, { t: 'lobbyMismatch' }>, retry: (fp: AppFingerprint) => void) => void;
    /** Phase 5: a lobby chat line (from a slot; `to`: -1 everyone, or this player). */
    onChat?: (from: number, name: string, text: string, to: number) => void;
    /**
     * Phase 5 (§21): the host's game is running and this player is new: the empires it may take over. `pick` answers
     * (the host then sends lobbyRejoin: onRejoin). Without onJoinOffer the join fails ("the game has started").
     */
    onJoinOffer?: (game: string, choices: LobbyJoinChoice[], pick: (empireId: number) => void) => void;
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
                    case 'lobbyMismatch':
                        if (welcomed) return;
                        if (c.opts.onMismatch === undefined) {
                            reject(new Error(m.reason));
                            link.close('mismatch');
                            return;
                        }
                        c.opts.onMismatch(m, (fp) => send(link, { t: 'lobbyHello', name: opts.name, fp, ...(opts.rejoin !== undefined ? { rejoin: opts.rejoin } : {}) }));
                        return;
                    case 'lobbyChat':
                        if (typeof m.text === 'string') c.opts.onChat?.(Number(m.from ?? 0), String(m.name ?? ''), cleanChat(m.text), Number.isInteger(m.to) ? m.to! : -1);
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
                    case 'lobbyJoinOffer': {
                        if (c.started || welcomed) return;
                        const choices = Array.isArray(m.choices) ? m.choices.filter((x) => x !== null && typeof x === 'object' && Number.isInteger(x.empireId)).slice(0, 64) : [];
                        if (c.opts.onJoinOffer === undefined) {
                            reject(new Error('The game has already started.'));
                            link.close('cannot join a running game');
                            return;
                        }
                        c.opts.onJoinOffer(String(m.game ?? ''), choices.map((x) => ({ empireId: x.empireId, name: String(x.name ?? '').replace(/[\u0000-\u001f]/g, '').slice(0, 64), kind: x.kind === 'seat' ? 'seat' : 'ai', race: String(x.race ?? '').slice(0, 64), colonies: Number(x.colonies) || 0, color: Number(x.color) || 0 })), (empireId) => send(link, { t: 'lobbyJoinPick', empireId }));
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

    setPick(pick: HumanPlayerStart, claim: number, ready: boolean, missing?: string[]): void {
        if (this.started) return;
        send(this.link, { t: 'lobbyPick', pick, claim, ready, ...(missing !== undefined && missing.length > 0 ? { missing } : {}) });
    }

    /** Phase 5: say something in the lobby (to a slot, or -1: everyone). Rate-limited here too. */
    sendChat(text: string, to = -1): boolean {
        const t = cleanChat(text);
        if (t === '' || this.started || !this.chatLimit.take()) return false;
        send(this.link, { t: 'lobbyChat', text: t, ...(to >= 0 ? { to } : {}) });
        return true;
    }

    private readonly chatLimit = new ChatLimiter();

    /** The link closes (the host left the lobby / we leave). */
    get isOpen(): boolean {
        return this.link.isOpen;
    }

    leave(): void {
        if (this.started) return;
        this.link.close('left the lobby');
    }
}
