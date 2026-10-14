// LAN multiplayer in the app (multiplayer Phase 3, docs/MULTIPLAYER.md §10): the main menu's Multiplayer screen (Host
// Game / Join Game), the lobby, and the running game's session (status banner, save extras, the debug hook).
//
// - Host: the desktop app listens (netBridge.ts → desktop/netHost.cjs), shows its LAN addresses, and runs the lobby
//   (net/lobby.ts LobbyHost). The host picks the game settings in the new-game wizard and starts; or loads a LAN save,
//   whose humans the players claim.
// - Join: by IP:port. The lobby hello carries this app's fingerprint (net/fingerprint.ts); a mismatch is refused with
//   the reason. Each player picks an empire (the hot-seat row: name, race, government, flag colours) and says ready.
// - Start: every peer builds the same game from the host's MultiplayerStart (a new game) or gets the host's save over
//   the session (a loaded one), then runs it in lockstep (net/multiplayerGame.ts). In-thread (the lockstep seam in
//   src/simLoop.ts) or, when this app runs its sim in the worker, in the sim worker (§11: mpHandle.ts WorkerMp).
// - Phase 4 (§12): a player who drops can reconnect by name or token (the host's rejoin gate gives the slot back; the
//   session's welcome brings the current save); meanwhile the host chooses whether the AI runs their empire.
// - Internet (§15): Host on the Internet / Join by code: WebRTC data channels set up with copy-paste codes
//   (internetUi.ts, net/rtcTransport.ts), no server. The links reach the lobby and the rejoin gate as LAN ones do.
//
// Main thread / DOM. main.ts supplies the game building and the view (MultiplayerAppDeps).

import type { Game } from '../../sim/game';
import type { Galaxy } from '../../sim/galaxy';
import type { GameData } from '../../sim/data/gameData';
import type { Government } from '../../sim/data/governments';
import type { Race } from '../../sim/data/races';
import { GalaxyTime } from '../../sim/galaxyTime';
import type { StartGameOptions } from '../../sim/startGameOptions';
import { difficultyLevelOf, galaxyStarCount, wizardStartGameOptions } from '../../sim/startGameOptions';
import type { HumanPlayerStart } from '../../sim/humanPlayerStarts';
import { humanSeats } from '../../sim/humanEmpires';
import type { GameSaveExtras } from '../../sim/save/gameSave';
import { issuePlayerCommand } from '../../sim/player/playerCommands';
import type { PlayerOpName } from '../../sim/player/playerOps';
import { GalaxyShape } from '../../sim/types';
import { IS_CLASSIC } from '../../appVersion';
import { appFingerprint, diffFingerprintFiles, fingerprintFiles, fingerprintMismatch, type AppFingerprint } from '../../net/fingerprint';
import { checkJoinPick, ChatLimiter, decodeHello, slotOfPeerName, type LobbyJoinChoice, LOBBY_CHAT_MAX_CHARS, LOBBY_MAX_PLAYERS, LobbyClient, LobbyHost, rejoinToken, sendLobbyMessage, slotHandoff, type HandoffLink, type LobbyAddonSet, type LobbyMessage, type LobbyPlayer, type LobbyState, type MultiplayerStart } from '../../net/lobby';
import { joinChoicesFor, MultiplayerGame, type MultiplayerStatus } from '../../net/multiplayerGame';
import { setLockstepStepper } from '../../net/lockstepSeam';
import type { Link } from '../../net/transport';
import { SimWorkerClient, type MpSideChannel, type ReplicaGameData } from '../../simworker/workerClient';
import type { SimEndpoint } from '../../simworker/simEndpoint';
import type { WorkerBoot } from '../../simworker/protocol';
import { InThreadMp, WorkerMp, type MpHandle } from './mpHandle';
import { setLocalViewerEmpire } from '../../localViewer';
import { DEFAULT_MULTIPLAYER_PORT, netEndpoint, type NetAddress, type PortMapping } from './netBridge';
import { InternetHost, openCodeJoin } from './internetUi';
import { SideHub } from './sideChannel';
import { Migration } from './migration';
import { currentLlmLayer } from '../../llm/llmLayer';
import { ChatPanel, type SavedChatLine } from './chatPanel';
import { setSaveEntryTagger } from '../screens/saveLoad';
import { playerSelectableRacesSorted, startGovernmentsForRace } from '../screens/newGameWizard';
import './multiplayer.css';
import { installHudScaleVar } from '../originalWindow';
import { exposeDevHook } from './devHooks';
import { setAutoPauseSuppressed } from '../autoPause';

export interface LoadedMultiplayerSave {
    game: Game;
    time: GalaxyTime;
    startOptions: StartGameOptions;
    playData: GameData;
    scenario: { id: string; include: string[] | null } | null;
    /** The save's LAN players by human index (savedMultiplayerPlayers), if it is a LAN save. */
    players: string[] | undefined;
    /** The save's chat lines (savedMultiplayerChat; [] for none). */
    chat?: SavedChatLine[];
    /** The players' rejoin tokens by human index ('' none; savedMultiplayerTokens): a player whose app kept it gets its
     *  empire back in the lobby. */
    tokens?: string[];
    name: string;
    /** The save's text (worker mode: the worker loads the game from it). */
    text?: string;
}

export interface MultiplayerAppDeps {
    /** Load the static data (game data, add-ons, system names), so the lobby rows and the fingerprint are ready. */
    prepare(): Promise<GameData>;
    /** version / build / engine / theme of this app. */
    fingerprintBase(): { version: string; build: string; engine: string; theme: string; edition?: string };
    /** The new-game wizard over `initial`; resolves with the chosen options, or null (closed). */
    openWizard(initial: StartGameOptions): Promise<StartGameOptions | null>;
    /** What createGame takes from this app's settings beside the start options (host; sent to everyone). */
    createExtras(startOptions: StartGameOptions): Record<string, unknown>;
    /** Build a new game from the start (every peer, in-thread). */
    buildGame(startOptions: StartGameOptions, createExtras: Record<string, unknown> | null): Promise<{ game: Game; playData: GameData }>;
    /** The host's Load Saved Game: pick a save and load it in-thread (null: cancelled). `multiplayerOnly`: the list opens
     *  on the multiplayer saves (Resume). */
    pickSave(opts?: { multiplayerOnly?: boolean }): Promise<LoadedMultiplayerSave | null>;
    /** The GameData of a loaded game's add-ons (a client: the welcome's save loads over it). */
    gameDataFor(scenario: { id: string; include: string[] | null } | null): GameData;
    /** Show `game` in the main view (tears down the one up, if any). `newGame`: a fresh start (the founding line).
     *  `simClient`: worker mode (`game` is its replica). */
    showGame(game: Game, startOptions: StartGameOptions, clock: { speed: number; paused: boolean }, newGame: boolean, simClient?: SimWorkerClient): Promise<void>;
    /** Whether this app runs its game's sim in the sim worker (Settings; `?simWorker=`): a LAN game does too (§11). */
    useWorker(): boolean;
    /** Worker mode: build the new game from the start in the sim worker (paused), with the session's side channel. */
    buildGameInWorker(startOptions: StartGameOptions, createExtras: Record<string, unknown> | null, side: MpSideChannel): Promise<{ client: SimWorkerClient; playData: GameData }>;
    /** Worker mode: boot the sim worker (a load, or `lockstep`: the host's save comes over the session). */
    bootWorker(title: string, boot: WorkerBoot, playData: ReplicaGameData, startOptions: StartGameOptions | undefined, clock: { speed: number; paused: boolean } | undefined, side: MpSideChannel, endpoint?: SimEndpoint): Promise<SimWorkerClient>;
    /** The GameData of a start's game (its add-ons: a new game's from its start options, a load's from the save). */
    gameDataForStart(start: MultiplayerStart): GameData;
    /** The add-on choice of a start's game (as the worker loads its data). */
    scenarioOfStart(start: MultiplayerStart): { id: string; include: string[] | null } | null;
    /** Back to the main menu (tears down the view). */
    toMenu(): void;
    /**
     * Phase 5 (docs/MULTIPLAYER.md §17): make `theme` (a DW:U customization set; '' = the stock game) the active theme
     * for this session only, reloading the data; resolves with why not (it is not installed here), or null.
     */
    matchTheme(theme: string): Promise<string | null>;
    /** Back to the stored theme after a session that matched the host's (null: nothing to do). */
    restoreTheme(): Promise<void>;
    /** The add-on set of `o`'s settings, for the lobby (null: no add-ons). */
    addonSet(o: StartGameOptions): LobbyAddonSet | null;
    /** Which of these add-on packages (overlay ids) this app does not have. */
    missingAddons(ids: readonly string[]): string[];
}

// ---------------------------------------------------------------------------------------------------------------------
// The running session
// ---------------------------------------------------------------------------------------------------------------------

interface Running {
    mp: MpHandle;
    start: MultiplayerStart;
    slot: number;
    name: string;
    banner: StatusBanner;
    chipTimer: ReturnType<typeof setInterval>;
    hosting: boolean;
    /** Host: the rejoin tokens handed out at start, by slot (lobby.ts LobbyHost.tokens). */
    tokens: Map<number, string>;
    /** Host: new players being let in (§21), by their new slot: the empire each takes over. */
    joining: Map<number, number>;
    /** Client: how to reconnect after a drop (the host's address — INTERNET_ADDRESS for a code join —, this player's token;
     *  after a host migration the new host's, with its other addresses to try). */
    rejoin: { address: string; token: string | null; alternatives?: string[] } | null;
    /** Host on the Internet: the invites (the banner's rejoin codes). After a host migration, the new host's. */
    internet: InternetHost | null;
    /** The side channel (chat, migration signalling) over the session's links. */
    side: SideHub;
    /** Host migration (§16): the succession and the backup links. */
    migration: Migration;
    /** An Internet game (codes) rather than a LAN one. */
    overInternet: boolean;
    /** The in-game chat (§19). */
    chat: ChatPanel;
}

/**
 * The multiplayer dock (the status chip, the Chat button, the chat window and its notice) sits at the bottom of the
 * screen just right of the selection panel (hud.ts .sel-frame, scaled with the HUD), clear of the stock bottom-left
 * UI; CSS reads its corner from --mp-dock-left / --mp-dock-bottom. Without a selection panel: the bottom-left corner.
 */
function placeDock(): void {
    const frame = document.querySelector<HTMLElement>('.sel-frame');
    let left = 8;
    if (frame !== null) {
        const r = frame.getBoundingClientRect();
        if (r.width > 0 && r.right + 260 < window.innerWidth) left = Math.round(r.right + 6);
    }
    const root = document.documentElement.style;
    const v = `${left}px`;
    if (root.getPropertyValue('--mp-dock-left') !== v) root.setProperty('--mp-dock-left', v);
}
if (typeof window !== 'undefined') window.addEventListener('resize', () => placeDock());

/** The "address" of a game joined by code (the rejoin memory; reconnecting takes a fresh code exchange). */
const INTERNET_ADDRESS = 'internet';

let running: Running | null = null;

/** A LAN game is running (main.ts: no hot-seat switch, no intro, LAN save extras). */
export function multiplayerActive(): boolean {
    return running !== null;
}

/** A multiplayer game is running and this peer is not its host (the AI-empire LLM jobs belong to the host). */
export function multiplayerIsClient(): boolean {
    return running !== null && running.mp.role !== 'host';
}
// Event pop-ups and screen windows do not pause a multiplayer game for everyone (§27): the local player sees the
// pop-up while the game runs. The pause button and the Escape menu still pause (they ask the host).
setAutoPauseSuppressed(multiplayerActive);

/** What a save of the running LAN game carries: its players by human index (loading it as host reopens the lobby). */
export function multiplayerSaveExtras(galaxy: Galaxy): GameSaveExtras | undefined {
    if (running === null) return undefined;
    // By seat: a seat the AI runs while its player is away keeps its index (humanEmpires.ts humanSeats).
    const n = humanSeats(galaxy).length;
    const names: string[] = Array.from({ length: n }, () => '');
    for (const p of running.start.players) if (p.humanIndex >= 0 && p.humanIndex < n) names[p.humanIndex] = p.name;
    if (n === 0) return undefined;
    // The chat this player saw (§21), by lobby names.
    const r = running;
    const chat = r.chat.savedLines(r.name, (slot) => r.start.players.find((p) => p.slot === slot)?.name ?? `Player ${slot + 1}`);
    // The rejoin tokens by human index (§21: Resume with the same players gives a player their empire back by token).
    const tokens: string[] = Array.from({ length: n }, () => '');
    for (const p of r.start.players) if (p.humanIndex >= 0 && p.humanIndex < n) tokens[p.humanIndex] = r.tokens.get(p.slot) ?? '';
    return { multiplayerPlayers: names, ...(chat.length > 0 ? { multiplayerChat: chat } : {}), ...(tokens.some((t) => t !== '') ? { multiplayerTokens: tokens } : {}) };
}

/** End the LAN game (leaving to the menu, loading another game): the host ends it for everyone. */
export function endMultiplayerSession(reason = 'left the game'): void {
    const r = running;
    if (r === null) return;
    running = null;
    clearInterval(r.chipTimer);
    r.banner.destroy();
    // The host leaving (a host migration takes the game on: §16): its join box remembers where the game went.
    if (r.mp.role === 'host' && r.migration.successorAddresses.length > 0) storage('dwu.mp.join', r.migration.successorAddresses[0]);
    try {
        r.mp.close(reason);
    } catch (err) {
        console.warn('multiplayer: closing the session failed', err);
    }
    r.migration.close();
    r.chat.destroy();
    setSaveEntryTagger(null);
    delete (window as unknown as { __dwuChat?: unknown }).__dwuChat;
    r.internet?.close();
    if (r.hosting || r.migration.lanHosting) {
        const ep = netEndpoint();
        ep.onIncoming = null;
        void ep.stopHost();
    }
    delete (window as unknown as { __dwuMp?: unknown }).__dwuMp;
}

interface BannerView {
    text: string;
    menu: boolean;
    /** Host, an absent player not decided yet: the two choices for their empire. */
    decide?: { slot: number; name: string };
    /** Client, the host link lost: try to reconnect to the same slot. */
    rejoin?: boolean;
    /** The old host, cut off from everyone: rejoin the game under its new host (§16). */
    rejoinNew?: string;
    /** Two players, the host's link broke: Reconnect (rejoin) or Take Over (play on as the host). */
    takeOverAlone?: boolean;
}

function statusText(s: MultiplayerStatus, role: 'host' | 'client', canRejoin: boolean, newHost: string | null = null, split = false): BannerView | null {
    switch (s.kind) {
        case 'migrating':
            return { text: s.self ? 'The host left the game. You are the new host: the other players are reconnecting to you…' : `The host left the game. ${s.newHost} takes over as the host: reconnecting…`, menu: false };
        case 'running':
            return null;
        case 'waiting':
            return { text: `Waiting for ${s.missing.join(', ')} to join the game…`, menu: false };
        case 'resyncing':
            return { text: role === 'client' ? 'Resyncing with the host…' : `Resyncing ${s.who}…`, menu: false };
        case 'absent': {
            const undecided = s.players.find((p) => !p.decided);
            const line = (p: (typeof s.players)[number]): string =>
                `${p.name} ${p.reason === 'did not join' ? 'did not join' : 'disconnected'}${p.ai ? ' — the AI plays their empire until they return' : p.decided ? ' — their empire stands idle' : ''}.`;
            if (role === 'host' && newHost !== null && s.players.length > 0 && s.players.every((p) => p.reason !== 'did not join')) {
                // Every player dropped at once: perhaps it is this PC that lost the network, and the game went on under
                // the successor (host migration).
                return {
                    text:
                        s.players.length === 1
                            ? // Two players (§21): the other one waits and chooses — reconnect here, or take over.
                              `${s.players[0].name} disconnected. They wait and choose: reconnect to you, or — if they think your game is gone — take over as the host. If they took over, rejoin ${newHost}'s game as a player.`
                            : `Every player disconnected. If this PC lost its network connection, the game goes on with ${newHost} as the host: rejoin it as a player. Otherwise, the players can rejoin you.`,
                    menu: true,
                    ...(undecided !== undefined ? { decide: { slot: undecided.slot, name: undecided.name } } : {}),
                    rejoinNew: newHost,
                };
            }
            if (role === 'host' && undecided !== undefined) {
                return {
                    text: `${undecided.name} disconnected (${undecided.reason}).${s.paused ? ' The game is paused.' : ' Their empire stands idle for now.'} They can rejoin with their name; meanwhile, the AI can run their empire, or it stands idle.`,
                    menu: true,
                    decide: { slot: undecided.slot, name: undecided.name },
                };
            }
            const others = s.players.map(line).join(' ');
            return { text: `${others}${s.paused && s.players.some((p) => !p.decided) ? ' The game is paused; the host decides.' : ''}${role === 'host' ? ' They can rejoin with their name.' : ''}`, menu: role === 'client' ? false : false };
        }
        case 'hostLost':
            if (split)
                return {
                    text: `Lost the connection to the host (${s.reason}). The game is paused here: it cannot tell whether the host's network or yours failed. If the host's game is still running, Reconnect. If the host has really gone (its app closed), Take Over and play on as the host — while the host plays on too, that would split the game in two.`,
                    menu: true,
                    rejoin: canRejoin,
                    takeOverAlone: true,
                };
            return { text: `Lost the connection to the host (${s.reason}). The game has stopped.${canRejoin ? ' Rejoin to reconnect to your empire.' : ''}`, menu: true, rejoin: canRejoin };
    }
}

interface StatusBanner {
    show(s: MultiplayerStatus): void;
    /** The status chip: `short` collapsed, `full` on hover / click. */
    chip(short: string, full: string): void;
    destroy(): void;
}

function createStatusBanner(role: () => 'host' | 'client', actions: { onMenu: () => void; onDecide: (slot: number, ai: boolean) => void; onRejoin: () => (() => void) | null; onRejoinNew: () => void; newHost: () => string | null; split: () => boolean; onTakeOverAlone: () => void }, internetOf: () => InternetHost | null): StatusBanner {
    const banner = document.createElement('div');
    banner.className = 'mp-banner';
    banner.dataset.mp = 'banner';
    banner.hidden = true;
    const text = document.createElement('span');
    text.className = 'mp-banner-text';
    let decideSlot = -1;
    const mk = (label: string, mp: string, onClick: () => void): HTMLButtonElement => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'mp-btn mp-banner-menu';
        b.dataset.mp = mp;
        b.textContent = label;
        b.addEventListener('click', onClick);
        return b;
    };
    const ai = mk('AI Takes Over', 'take-over', () => decideSlot >= 0 && actions.onDecide(decideSlot, true));
    const idle = mk('Continue Without Them', 'continue', () => decideSlot >= 0 && actions.onDecide(decideSlot, false));
    const rejoin = mk('Rejoin', 'rejoin', () => actions.onRejoin()?.());
    const rejoinNew = mk('Rejoin as a Player', 'rejoin-new-host', () => actions.onRejoinNew());
    const takeOverAlone = mk('Take Over', 'take-over-alone', () => actions.onTakeOverAlone());
    const menu = mk('Main Menu', 'menu', actions.onMenu);
    // Hosting on the Internet: a fresh invite code for each absent player (rejoining takes a new code exchange).
    const invites = h('div', 'mp-banner-invites');
    invites.dataset.mp = 'rejoin-invites';
    const syncInvites = (s: MultiplayerStatus): void => {
        const internet = internetOf();
        if (internet === null) return;
        const away = s.kind === 'absent' ? s.players : [];
        for (const slot of internet.rejoinSlots()) if (!away.some((p) => p.slot === slot)) internet.endRejoin(slot);
        invites.replaceChildren(...away.map((p) => internet.rejoinWidget(p.slot, p.name)));
    };
    banner.append(text, ai, idle, rejoin, rejoinNew, takeOverAlone, menu, invites);
    // The status chip (the multiplayer dock, placeDock): one short line; hover or click shows the full line.
    const chip = document.createElement('div');
    chip.className = 'mp-chip';
    chip.dataset.mp = 'chip';
    const chipShort = document.createElement('span');
    chipShort.className = 'mp-chip-short';
    const chipFull = document.createElement('span');
    chipFull.className = 'mp-chip-full';
    chip.append(chipShort, chipFull);
    chip.addEventListener('click', () => chip.classList.toggle('mp-chip-open'));
    document.body.append(banner, chip);
    return {
        show(s) {
            const t = statusText(s, role(), actions.onRejoin() !== null, actions.newHost(), actions.split());
            banner.hidden = t === null;
            banner.dataset.status = s.kind;
            syncInvites(s);
            if (t === null) return;
            text.textContent = t.text;
            menu.hidden = !t.menu;
            decideSlot = t.decide?.slot ?? -1;
            ai.hidden = idle.hidden = t.decide === undefined;
            rejoin.hidden = t.rejoin !== true;
            rejoin.textContent = t.takeOverAlone === true ? 'Reconnect' : 'Rejoin';
            takeOverAlone.hidden = t.takeOverAlone !== true;
            rejoinNew.hidden = t.rejoinNew === undefined;
            if (t.rejoinNew !== undefined) rejoinNew.textContent = `Rejoin ${t.rejoinNew}'s Game`;
        },
        chip(short, full) {
            if (chipShort.textContent !== short) chipShort.textContent = short;
            if (chipFull.textContent !== full) chipFull.textContent = full;
            placeDock();
        },
        destroy() {
            banner.remove();
            chip.remove();
        },
    };
}

/** Wire a started session into the app: viewer, view, banner, chip, debug hook, and the host's rejoin gate. */
async function runGame(deps: MultiplayerAppDeps, mp: MpHandle, side: SideHub, name: string, startOptions: StartGameOptions, hosting: boolean, newGame: boolean, extra: { tokens?: ReadonlyMap<number, string>; rejoin?: { address: string; token: string | null }; internet?: InternetHost | null; chatHistory?: readonly SavedChatLine[] }): Promise<void> {
    const internet = extra.internet ?? null;
    const overInternet = internet !== null || extra.rejoin?.address === INTERNET_ADDRESS;
    let r: Running;
    // The host whose players all dropped at once: the successor it named (the game may have gone on there).
    const newHostName = (): string | null => {
        const slot = r.migration.lastNamed;
        if (slot < 0 || r.mp.role !== 'host' || r.mp.seats().some((x) => x.slot !== r.mp.slot && x.present)) return null;
        return r.start.players.find((p) => p.slot === slot)?.name ?? null;
    };
    const banner = createStatusBanner(() => mp.role, {
        onMenu: () => {
            endMultiplayerSession('left the game');
            deps.toMenu();
        },
        onDecide: (slot, ai) => mp.decideAbsent(slot, ai),
        onRejoin: () => (r.rejoin !== null ? () => void rejoinGame(deps, name, r.rejoin!.address, r.rejoin!.token, r.rejoin!.alternatives) : null),
        onRejoinNew: () => {
            // The old host, cut off: rejoin the successor's game as a player (by its LAN address, or a code from it).
            const addrs = r.migration.successorAddresses;
            void rejoinGame(deps, name, r.overInternet || addrs.length === 0 ? INTERNET_ADDRESS : addrs[0], null, addrs.slice(1));
        },
        newHost: () => newHostName(),
        split: () => r.migration.split,
        onTakeOverAlone: () => r.migration.takeOverAlone(),
    }, () => r.internet);
    const migration = new Migration({
        mp,
        side,
        internet: overInternet,
        log: (m) => console.info(`[migration] ${m}`),
        onPromoted: (survivors) => {
            // This peer is the hub now: it answers connections (the old host and anyone without a backup link rejoin
            // here), on a LAN port and, in an Internet game, with invite codes in the banner.
            console.info(`[migration] this peer is the host now (${survivors.length} survivor(s) reconnecting)`);
            r.hosting = true;
            r.rejoin = null;
            currentLlmLayer()?.enableAiJobs(); // the AI-empire LLM jobs follow the host
            const ep = netEndpoint();
            if (ep.canHost && !migration.lanHosting) {
                migration.lanHosting = true;
                void ep.host(Number(storage('dwu.mp.port') || 0) || 0).catch(() => ep.host(0)).catch((err: unknown) => console.warn('[migration] no LAN port', err));
            }
            if (r.overInternet && r.internet === null) r.internet = new InternetHost((link) => (ep.onIncoming !== null ? ep.onIncoming(link, 'Internet') : link.close('not hosting')));
            installRejoinGate(r);
        },
        onMigrating: (slot) => {
            const addrs = migration.successorAddresses;
            r.rejoin = { address: r.overInternet || addrs.length === 0 ? INTERNET_ADDRESS : addrs[0], token: null, alternatives: addrs.slice(1) };
            console.info(`[migration] reconnecting to the new host (slot ${slot})`);
        },
        onSplit: () => banner.show(mp.currentStatus()),
        onNoMigration: (why) => {
            console.info(`[migration] none: ${why}`);
            // A member without a backup link rejoins the successor; a successor that was cut off rejoins the old host.
            const succ = migration.lastNamed;
            if (succ >= 0 && succ !== mp.slot) {
                const addrs = migration.successorAddresses;
                r.rejoin = { address: r.overInternet || addrs.length === 0 ? INTERNET_ADDRESS : addrs[0], token: null, alternatives: addrs.slice(1) };
            }
        },
    });
    // The in-game chat (§19) over the side channel: to everyone or to one player; the hub relays (and rate-limits).
    const nameOfSlot = (slot: number): string => mp.start.players.find((p) => p.slot === slot)?.name ?? `Player ${slot + 1}`;
    const chat = new ChatPanel({
        mode: 'game',
        mySlot: mp.slot,
        peers: () => mp.start.players.map((p) => ({ slot: p.slot, name: p.name })),
        send: (text, to) => side.send('chat', to, { text }),
    });
    if (extra.chatHistory !== undefined) chat.history(extra.chatHistory, name);
    const limits = new Map<number, ChatLimiter>();
    side.allow = (m) => {
        if (m.k !== 'chat') return true;
        if (typeof m.text !== 'string' || m.text.length > LOBBY_CHAT_MAX_CHARS) return false;
        let l = limits.get(m.from);
        if (l === undefined) limits.set(m.from, (l = new ChatLimiter()));
        return l.take();
    };
    // The host remembers where its successor can be reached (§16): after a crash, Join Game opens on that address.
    side.on('succAddr', (m) => {
        if (mp.role === 'host' && Array.isArray(m.addresses) && typeof m.addresses[0] === 'string') storage('dwu.mp.join', m.addresses[0]);
    });
    side.on('chat', (m) => {
        if (typeof m.text === 'string' && (m.to === -1 || m.to === mp.slot)) chat.add(m.from, nameOfSlot(m.from), m.text, m.to);
    });
    exposeDevHook('__dwuChat', { lines: () => chat.lines.map((l) => ({ ...l })), open: (on: boolean) => chat.setOpen(on), dropped: () => side.dropped, muted: () => [...chat.muted], mutedLines: () => chat.mutedLines });
    r = { mp, start: mp.start, slot: mp.slot, name, banner, chipTimer: setInterval(() => paintChip(), 1000), hosting, tokens: new Map(extra.tokens ?? []), joining: new Map(), rejoin: extra.rejoin ?? null, internet, side, migration, overInternet, chat };
    const net = overInternet ? 'Internet' : 'LAN';
    running = r;
    let ping = -1;
    const paintChip = (): void => {
        const peers = mp.peers().filter((p) => p.leftFrom === null).length;
        if (peers === 0) return;
        const me = mp.myEmpire();
        const st = mp.stats();
        const ai = mp.seats().filter((s) => s.ai).length;
        // A host that took over (§16): the address the others rejoin at.
        const at = mp.role === 'host' && mp.slot !== 0 && r.migration.ownAddresses.length > 0 ? ` · rejoin at ${r.migration.ownAddresses[0]}` : '';
        const role = mp.role === 'host' ? 'host' : 'client';
        const resyncs = st !== null && st.resyncs > 0 ? ` · ${st.resyncs} resync${st.resyncs === 1 ? '' : 's'}` : '';
        banner.chip(
            `${net} ${role} · ${peers}P${ping >= 0 ? ` · ${ping.toFixed(0)} ms` : ''}${resyncs !== '' ? ' · !' : ''}`,
            `${net} ${role}${at}${mp.worker ? ' (worker)' : ''} · ${peers} player${peers === 1 ? '' : 's'}${me !== null ? ` · ${me.name}` : ''}${ping >= 0 ? ` · ping ${ping.toFixed(0)} ms` : ''} · delay ${mp.inputDelay()}${ai > 0 ? ` · AI plays ${ai}` : ''}${resyncs}`,
        );
        if (mp.role === 'client' && mp.currentStatus().kind !== 'hostLost') void mp.ping().then((ms) => (ping = ms), () => undefined);
    };
    mp.onStatus = (s) => {
        if (running !== r) return;
        banner.show(s);
        migration.onStatus(s);
    };
    mp.onGameReplaced = (g, client) => {
        // A resync / join save replaced the game: point the viewer at the new galaxy and rebuild the view.
        if (running !== r) return;
        setLocalViewerEmpire(g.galaxy, mp.myEmpire());
        void deps.showGame(g, startOptions, { ...(mp.clock() ?? { speed: 1, paused: true }) }, false, client);
    };
    banner.show(mp.currentStatus());
    installDebugHook(mp);
    if (hosting) installRejoinGate(r);
    // The Load list marks this game's saves (and autosaves) as multiplayer ones, with the players (§21).
    setSaveEntryTagger(() => {
        if (running !== r) return null;
        try {
            const players = multiplayerSaveExtras(r.mp.game().galaxy)?.multiplayerPlayers;
            return players !== undefined ? { players } : null;
        } catch {
            return null;
        }
    });
    const game = mp.game();
    setLocalViewerEmpire(game.galaxy, mp.myEmpire());
    await deps.showGame(game, startOptions, { ...(mp.clock() ?? { speed: 1, paused: true }) }, newGame, mp.simClient());
    paintChip();
}

/**
 * Host: a connection while the game runs. A player who dropped may reconnect to their slot (Phase 4): their lobby
 * hello names them (or carries the token of their start); the fingerprint must still match. The link is then the
 * session's: the player joins with the current save. Anyone else is refused.
 */
function installRejoinGate(r: Running): void {
    const ep = netEndpoint();
    ep.onIncoming = (link) => {
        let answered = false;
        link.onMessage = (text) => {
            if (answered) return;
            answered = true;
            // Only a lobby hello is read before the version check; anything else closes the link.
            const m = decodeHello(text);
            const refuse = (reason: string): void => {
                console.info(`[lockstep] refused a connection: ${reason}`);
                sendLobbyMessage(link, { t: 'lobbyRefused', reason });
                link.close('refused');
            };
            if (m === null) return refuse('Not an openDWU lobby hello.');
            if (running !== r) return refuse('The game is over.');
            const fp = m.fp as AppFingerprint | undefined;
            const why = fp === undefined || typeof fp !== 'object' ? 'Your app sent no version information.' : fingerprintMismatch(lastFingerprint!, fp);
            if (why !== null) return refuse(why);
            const pick = r.mp.rejoinSlot(String(m.name ?? ''), typeof m.rejoin === 'string' ? m.rejoin : undefined, r.tokens);
            // Not a dropped player: a NEW player may take over a free empire (§21).
            if ('refused' in pick) return offerJoin(r, link, String(m.name ?? ''), refuse, pick.refused);
            const player = r.start.players.find((p) => p.slot === pick.slot)!;
            const token = r.tokens.get(pick.slot) ?? rejoinToken();
            // The link becomes the session's (its lockstep hello gets the slot's name), then the player is told.
            const handoff = slotHandoff(link, pick.slot, player.name);
            r.mp.acceptRejoin(r.side.tap(handoff, pick.slot), pick.slot);
            sendLobbyMessage(link, { t: 'lobbyRejoin', slot: pick.slot, start: r.start, token });
        };
    };
}

/**
 * Host: a new player at the running game's door (§21). They get the empires nobody plays (lobbyJoinOffer); their pick
 * gets a new lobby slot, the link goes to the session (the current save comes in its welcome), and the host's
 * addHumanSeat at their first input frame hands them the empire (net/multiplayerGame.ts acceptNewPlayer).
 */
function offerJoin(r: Running, link: Link, rawName: string, refuse: (reason: string) => void, why: string): void {
    const name = rawName.replace(/[\u0000-\u001f|]/g, '').trim().slice(0, 32);
    if (name === '') return refuse(why);
    const seats = r.mp.seats();
    if (seats.some((s) => s.name.toLowerCase() === name.toLowerCase())) return refuse(`${why} (A player named ${name} is in this game: a new player needs another name.)`);
    if (seats.length >= LOBBY_MAX_PLAYERS) return refuse('The game is full.');
    let galaxy: Galaxy;
    try {
        galaxy = r.mp.game().galaxy;
    } catch {
        return refuse(why);
    }
    const choicesNow = (): LobbyJoinChoice[] =>
        joinChoicesFor(galaxy, r.start, [...r.joining.values()]).map((e) => ({
            empireId: e.empireId,
            name: e.name,
            kind: humanSeats(galaxy).includes(e) ? 'seat' : 'ai',
            race: e.dominantRace?.name ?? '',
            colonies: e.colonies.length,
            color: e.mainColor,
        }));
    const choices = choicesNow();
    if (choices.length === 0) return refuse('The game has already started and no empire is free to take over.');
    link.onMessage = (text) => {
        let msg: unknown = null;
        try {
            msg = JSON.parse(text);
        } catch {
            // not JSON
        }
        const c = checkJoinPick(msg, choices);
        if (c === null) return refuse('Not one of the empires on offer.');
        if (running !== r || r.mp.role !== 'host') return refuse('The game is over.');
        if (!choicesNow().some((x) => x.empireId === c.empireId)) return refuse(`${c.name} is no longer free.`);
        const used = [...r.mp.seats().map((x) => x.slot), ...r.mp.peers().map((p) => slotOfPeerName(p.name)), ...r.joining.keys(), r.mp.slot];
        const slot = Math.max(0, ...used) + 1;
        const token = rejoinToken();
        r.tokens.set(slot, token);
        r.joining.set(slot, c.empireId);
        console.info(`[lockstep] ${name} joins as a new player (slot ${slot}) and takes over ${c.name}`);
        const handoff = slotHandoff(link, slot, name);
        r.mp.acceptNewPlayer(r.side.tap(handoff, slot), slot, c.empireId, name);
        sendLobbyMessage(link, { t: 'lobbyRejoin', slot, start: { ...r.start, joining: { slot, empireId: c.empireId } }, token });
        // Once the seat is theirs (or they never made it), the empire is no longer "being joined".
        const forget = setInterval(() => {
            if (running !== r || r.mp.seats().some((x) => x.slot === slot) || !link.isOpen) {
                clearInterval(forget);
                r.joining.delete(slot);
            }
        }, 1000);
    };
    sendLobbyMessage(link, { t: 'lobbyJoinOffer', game: humanSeats(galaxy).map((e) => e.name).join(', '), choices });
}

/** The fingerprint this app sent / checks with (set when the Multiplayer screen computed it). */
let lastFingerprint: AppFingerprint | null = null;

/** `window.__dwuMp`: the session for scripts and debugging (scripts drive a LAN game through it). */
function installDebugHook(mp: MpHandle): void {
    const inThread = mp instanceof InThreadMp ? mp : null;
    const hook = {
        get role() {
            return mp.role;
        },
        get worker() {
            return mp.worker;
        },
        get status() {
            return mp.currentStatus();
        },
        get frame() {
            return mp.frame();
        },
        get clock() {
            return mp.clock();
        },
        get stats() {
            return mp.stats();
        },
        get gameMs() {
            return mp.gameMs();
        },
        get inputDelay() {
            return mp.inputDelay();
        },
        peers: () => mp.peers(),
        seats: () => mp.seats(),
        digest: () => mp.digest(),
        myEmpire: () => mp.myEmpire()?.name ?? null,
        /** Issue a player command for this player's empire (goes through the session, like the UI's orders). */
        issue: (op: string, args: unknown[]) => {
            if (inThread === null) return mp.call('issue', [op, args]);
            const me = mp.myEmpire();
            if (me === null) throw new Error('no empire');
            issuePlayerCommand(mp.game().galaxy, me, op as PlayerOpName, args as never);
            return true;
        },
        /** Try to rename another human's first ship (the authorize check refuses it on every peer). */
        renameOther: (humanIndex: number, label: string) => {
            if (inThread === null) return mp.call('renameOther', [humanIndex, label]);
            const e = humanSeats(mp.game().galaxy)[humanIndex];
            const ship = e?.builtObjects.find((b) => b != null);
            if (e === undefined || ship === undefined) throw new Error(`no human ${humanIndex} with a ship`);
            issuePlayerCommand(mp.game().galaxy, e, 'renameShip', [ship, label]);
            return true;
        },
        /** A scripted step: rename this player's first ship and drop a waypoint at it. Returns the ship name. */
        scriptStep: (tag: string) => {
            if (inThread === null) return mp.call('scriptStep', [tag]);
            const me = mp.myEmpire();
            if (me === null) return null;
            const ship = me.builtObjects.find((b) => b != null);
            if (ship === undefined) return null;
            const label = `${tag}`;
            issuePlayerCommand(mp.game().galaxy, me, 'renameShip', [ship, label]);
            issuePlayerCommand(mp.game().galaxy, me, 'addWaypoint', [Math.round(ship.xpos ?? 0), Math.round(ship.ypos ?? 0), `wp ${label}`]);
            return label;
        },
        shipNames: () => (inThread === null ? mp.call('shipNames', []) : (mp.myEmpire()?.builtObjects ?? []).filter((b) => b != null).slice(0, 3).map((b) => b.name)),
        pause: (paused: boolean) => mp.requestPause(paused),
        setSpeed: (speed: number) => mp.setSpeed(speed),
        setInputDelay: (frames: number) => mp.setInputDelay(frames),
        /** The input delay the adaptive delay wants now (null: a fixed delay; a hub after a host migration takes it over). */
        wantedDelay: () => (inThread === null ? mp.call('wantedDelay', []) : (inThread.mp.session?.wantedDelay() ?? null)),
        /** Phase 5 (§21): the empires a new player could take over now (host). */
        joinChoices: () => joinChoicesFor(mp.game().galaxy, mp.start, []).map((e) => e.name),
        /** Host: decide an absent player's empire (the banner's buttons). */
        decideAbsent: (slot: number, ai: boolean) => mp.decideAbsent(slot, ai),
        /** Tests: drop this peer's network links (as a failing network would). */
        dropLinks: (reason = 'network drop (test)') => mp.dropLinks(reason),
        /** Phase 5 tests: the diplomatic relation (DiplomaticRelationType number) of this player's empire with human seat i. */
        relationTo: (humanIndex: number) => {
            const g = mp.game().galaxy;
            const me = mp.myEmpire();
            const other = humanSeats(g)[humanIndex];
            return me === null || other === undefined ? null : (me.diplomaticRelations.byEmpire(other)?.type ?? null);
        },
        /** Phase 5 tests: this player's money (the gift and trade checks). */
        money: () => mp.myEmpire()?.stateMoney ?? null,
        /** Phase 5: the lobby slot of the hub. */
        hostSlot: () => mp.hostSlot(),
        /** The session's log (worker mode: its last lines; in-thread it goes to the console). */
        log: () => (inThread === null ? mp.call('log', []) : Promise.resolve([])),
    };
    exposeDevHook('__dwuMp', hook);
}

/**
 * Client: reconnect to a running game after a drop (the banner's Rejoin, or Join Game while the host waits for us): the
 * lobby hello with our name and token; the host gives our slot back and the session's welcome brings the current save.
 */
async function rejoinGame(deps: MultiplayerAppDeps, name: string, address: string, token: string | null, alternatives: string[] = []): Promise<void> {
    endMultiplayerSession('rejoining');
    const ep = netEndpoint();
    try {
        const { fp } = await (async () => ({ gameData: await deps.prepare(), fp: await appFingerprint(deps.fingerprintBase()) }))();
        lastFingerprint = fp;
        let link: Link;
        if (address === INTERNET_ADDRESS) {
            link = await openCodeJoin({ title: 'Rejoin by code', note: 'Ask the host for a new invite code (their screen shows one for you while you are away) and paste it here. Send the reply code back; the game reconnects you to your empire.' });
        } else {
            // After a host migration: the new host's addresses, in turn (LAN, VPN, this PC).
            let last: unknown = null;
            let got: Link | null = null;
            for (const a of [address, ...alternatives]) {
                try {
                    got = await withTimeout(ep.connect(a), 5000, `no answer from ${a}`);
                    address = a;
                    break;
                } catch (err) {
                    last = err;
                }
            }
            if (got === null) throw last instanceof Error ? last : new Error(String(last));
            link = got;
        }
        await new Promise<void>((resolve, reject) => {
            LobbyClient.join(link, {
                name,
                fingerprint: fp,
                ...(token !== null ? { rejoin: token } : {}),
                onRejoin: (start, slot, handoff, tok) => {
                    storage('dwu.mp.rejoin', JSON.stringify({ address, name, token: tok }));
                    void startAsClient(deps, start, handoff, slot, name, () => undefined, { address, token: tok }, true).then(resolve, reject);
                },
            }).then((c) => {
                if (!c.rejoined) {
                    link.close('not a rejoin');
                    reject(new Error('The host has no running game to rejoin.'));
                }
            }, reject);
        });
    } catch (err) {
        deps.toMenu();
        openMultiplayerScreen(deps, () => undefined);
        showMenuError(`Could not rejoin: ${err instanceof Error ? err.message : String(err)}`);
    }
}

function withTimeout<T>(p: Promise<T>, ms: number, why: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(why)), ms);
        p.then(
            (v) => {
                clearTimeout(t);
                resolve(v);
            },
            (err: unknown) => {
                clearTimeout(t);
                reject(err);
            },
        );
    });
}

// ---------------------------------------------------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------------------------------------------------

function storage(key: string, value?: string): string {
    try {
        if (value !== undefined) localStorage.setItem(key, value);
        return localStorage.getItem(key) ?? '';
    } catch {
        return value ?? '';
    }
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (cls !== '') e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
}

function button(label: string, mp: string, onClick: () => void, cls = 'mp-btn'): HTMLButtonElement {
    const b = h('button', `ow-glass ${cls}`, label);
    b.type = 'button';
    b.dataset.mp = mp;
    b.addEventListener('click', onClick);
    return b;
}

function stopKeys(e: HTMLElement): void {
    // The game's global hotkeys must not see typing here.
    e.addEventListener('keydown', (ev) => ev.stopPropagation());
}

/** The game settings as lines for the lobby. */
export function settingsSummary(o: StartGameOptions): string[] {
    const shape = (GalaxyShape as unknown as Record<number, string>)[o.shape] ?? String(o.shape);
    const lines = [
        `Galaxy: ${shape}, ${galaxyStarCount(o)} stars, seed ${o.seed}`,
        `Other empires: ${o.otherEmpires?.empireCount ?? '?'}${o.otherEmpires?.manual !== undefined && o.otherEmpires.manual.length > 0 ? ` (${o.otherEmpires.manual.length} set by hand)` : ''}`,
        `Difficulty: ${difficultyLevelOf(o).toFixed(2)}`,
    ];
    if (o.empireType !== undefined) lines.push(`Playstyle: ${o.empireType}`);
    if (o.scenario != null) lines.push(`Add-ons: ${o.scenario.id}${o.scenario.addons !== undefined && o.scenario.addons.length > 0 ? ` (${o.scenario.addons.join(', ')})` : ''}`);
    return lines;
}

/** Phase 5 (§17): the host's theme and add-on set, as lines for the lobby. */
export function hostSettingsLines(state: LobbyState): string[] {
    const h = state.host;
    if (h === undefined) return [];
    const lines = [`Theme: ${h.theme === '' ? 'Default (the stock game)' : h.theme}`];
    const a = h.addons;
    if (a === null) lines.push('Add-on packages: none');
    else {
        if (a.expansions !== undefined && a.expansions.length > 0) lines.push(`Expansions: ${a.expansions.join(', ')}`);
        lines.push(`Add-on packages (${a.packages.length}): ${a.names.join(', ')}`);
        const flags = Object.entries(a.flags);
        if (flags.length > 0) lines.push(`Add-on switches: ${flags.map(([k, v]) => `${k} ${v ? 'on' : 'off'}`).join(', ')}`);
        const params = Object.entries(a.params);
        if (params.length > 0) lines.push(`Add-on values: ${params.map(([k, v]) => `${k} = ${v}`).join(', ')}`);
    }
    return lines;
}

/** Open the main menu's Multiplayer screen. `onBack`: back to the menu. */
export function openMultiplayerScreen(deps: MultiplayerAppDeps, onBack: () => void, opts: { resume?: boolean; focus?: 'host' | 'join' } = {}): void {
    installHudScaleVar();
    const ep = netEndpoint();
    const root = h('div', 'mp-screen');
    root.dataset.mp = 'menu';
    const win = h('div', 'mp-window');
    root.appendChild(win);
    const title = h('div', 'mp-title', '');
    title.dataset.mp = 'title';
    win.appendChild(title);
    // Resume with the same players (§21): host as usual; the lobby opens on the save picker (multiplayer saves), and
    // the players rejoin it by name (or by the token their app kept from that game).
    if (opts.resume === true) {
        const note = h('div', 'mp-note mp-resume-note', 'Host the game again (on your LAN or on the Internet); pick the saved multiplayer game next. The lobby gives each player their empire back when they join with the name they played under.');
        note.dataset.mp = 'resume-note';
        win.appendChild(note);
    }
    win.appendChild(h('div', 'mp-note', 'Play one game with other players on your local network, or over the Internet with invite codes (your PCs connect directly; no server is involved). Every player needs the same version of openDWU and the same Distant Worlds: Universe files.'));

    const nameRow = h('label', 'mp-row');
    nameRow.appendChild(h('span', 'mp-label', 'Your name'));
    const nameInput = h('input', 'mp-input');
    nameInput.dataset.mp = 'name';
    nameInput.maxLength = 32;
    nameInput.value = storage('dwu.mp.name') || 'Player';
    stopKeys(nameInput);
    nameRow.appendChild(nameInput);
    win.appendChild(nameRow);

    const hostBox = h('div', 'mp-box');
    hostBox.appendChild(h('div', 'mp-subtitle', 'Host a game'));
    const portRow = h('label', 'mp-row');
    portRow.appendChild(h('span', 'mp-label', 'Port'));
    const portInput = h('input', 'mp-input mp-input-short');
    portInput.dataset.mp = 'host-port';
    portInput.value = storage('dwu.mp.port') || String(DEFAULT_MULTIPLAYER_PORT);
    stopKeys(portInput);
    portRow.appendChild(portInput);
    hostBox.appendChild(portRow);
    // Fallback (b) of Internet play (§15): the router forwards the port, so players can join by the public address.
    const mapRow = h('label', 'mp-row mp-check');
    const mapIn = h('input');
    mapIn.type = 'checkbox';
    mapIn.dataset.mp = 'map-port';
    mapIn.checked = storage('dwu.mp.mapPort') === '1';
    mapIn.addEventListener('change', () => storage('dwu.mp.mapPort', mapIn.checked ? '1' : '0'));
    mapRow.append(mapIn, h('span', '', 'Open the port on my router automatically (UPnP / NAT-PMP), so players can also join by my public address'));
    hostBox.appendChild(mapRow);
    const hostBtn = button('Host on LAN / IP', 'host', () => void doHost(false), ep.canHost ? 'mp-btn mp-btn-primary' : 'mp-btn');
    const hostNetBtn = button('Host over the Internet (invite code)', 'host-internet', () => void doHost(true), ep.canHost ? 'mp-btn' : 'mp-btn mp-btn-primary');
    hostBox.append(hostBtn, hostNetBtn);
    if (!ep.canHost) {
        hostBtn.hidden = true;
        mapRow.hidden = true;
        hostBox.appendChild(h('div', 'mp-note', 'Hosting a LAN game needs the desktop app. In the browser you can join a game, or host on the Internet by invite codes (desktop players run a different engine, so they cannot join a browser host).'));
    }
    win.appendChild(hostBox);

    const joinBox = h('div', 'mp-box');
    joinBox.appendChild(h('div', 'mp-subtitle', 'Join a game'));
    const addrRow = h('label', 'mp-row');
    addrRow.appendChild(h('span', 'mp-label', 'Host address'));
    const addrInput = h('input', 'mp-input');
    addrInput.dataset.mp = 'join-address';
    addrInput.placeholder = `192.168.1.20:${DEFAULT_MULTIPLAYER_PORT}`;
    addrInput.value = storage('dwu.mp.join');
    stopKeys(addrInput);
    addrRow.appendChild(addrInput);
    joinBox.appendChild(addrRow);
    const joinBtn = button('Join', 'join', () => void doJoin(), 'mp-btn mp-btn-primary');
    joinBox.appendChild(joinBtn);
    joinBox.appendChild(button('Join with an invite code…', 'join-code', () => void doJoinByCode()));
    joinBox.appendChild(h('div', 'mp-note', 'Join: type the host\'s IP address (LAN, Tailscale or a forwarded port). Or paste the invite code a host sent you over the Internet.'));
    win.appendChild(joinBox);
    // Opened from the main menu's Host / Join entry: bring that section into view.
    // One section at a time (fewer things to read); a button switches. The main action takes Enter, Esc goes back.
    let mode: 'host' | 'join' = opts.focus ?? 'host';
    const switchBtn = button('', 'switch', () => showMode(mode === 'host' ? 'join' : 'host'), 'mp-btn mp-btn-secondary');
    const showMode = (m: 'host' | 'join'): void => {
        mode = m;
        hostBox.hidden = m !== 'host';
        joinBox.hidden = m !== 'join';
        title.textContent = opts.resume === true && m === 'host' ? 'Resume a Multiplayer Game' : m === 'host' ? 'Host a Game' : 'Join a Game';
        switchBtn.textContent = m === 'host' ? 'Join a game instead' : 'Host a game instead';
        setStatus('');
        (m === 'host' ? portInput : addrInput).focus();
    };

    const status = h('div', 'mp-status');
    status.dataset.mp = 'status';
    win.appendChild(status);
    const goBack = (): void => {
        root.remove();
        onBack();
    };
    const bar = h('div', 'mp-bar');
    bar.append(button('Back', 'back', goBack, 'mp-btn mp-btn-secondary'), switchBtn);
    win.appendChild(bar);
    root.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') goBack();
        else if (ev.key === 'Enter' && ev.target instanceof HTMLInputElement && ev.target.type !== 'checkbox') (mode === 'host' ? (ep.canHost ? hostBtn : hostNetBtn) : joinBtn).click();
    }, true);
    document.body.appendChild(root);

    const setStatus = (text: string, error = false): void => {
        status.textContent = text;
        status.classList.toggle('mp-error', error);
    };
    let busy = false;
    showMode(mode);

    async function fingerprint(): Promise<{ gameData: GameData; fp: AppFingerprint }> {
        const gameData = await deps.prepare();
        const fp = await appFingerprint(deps.fingerprintBase());
        lastFingerprint = fp;
        return { gameData, fp };
    }

    async function doHost(internetPlay: boolean): Promise<void> {
        if (busy) return;
        busy = true;
        try {
            const port = Number(portInput.value.trim() || DEFAULT_MULTIPLAYER_PORT);
            if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`not a port: ${portInput.value}`);
            const name = nameInput.value.trim() || 'Host';
            storage('dwu.mp.name', name);
            storage('dwu.mp.port', String(port));
            setStatus('Loading the game data…');
            const { gameData, fp } = await fingerprint();
            setStatus('Opening the port…');
            let listening: { port: number; addresses: NetAddress[] } | null = null;
            try {
                listening = await ep.host(port);
            } catch (err) {
                // On the Internet the WebSocket port is only the direct-IP fallback: host by codes without it.
                if (!internetPlay) throw err;
                console.warn('multiplayer: no LAN port for the direct-IP fallback', err);
            }
            const mapping = listening !== null && mapIn.checked && ep.canHost ? ep.mapPort() : null;
            let internet: InternetHost | null = null;
            if (internetPlay) {
                // An opened data channel goes where a LAN connection would: the lobby, later the rejoin gate.
                internet = new InternetHost((link) => (ep.onIncoming !== null ? ep.onIncoming(link, 'Internet') : link.close('not hosting')));
                internet.port = listening?.port ?? null;
            }
            root.remove();
            openHostLobby(deps, gameData, fp, name, listening?.port ?? null, listening?.addresses ?? [], onBack, internet, mapping, opts.resume === true);
        } catch (err) {
            setStatus(`Cannot host: ${err instanceof Error ? err.message : String(err)}`, true);
        } finally {
            busy = false;
        }
    }

    async function doJoin(): Promise<void> {
        if (busy) return;
        busy = true;
        try {
            const name = nameInput.value.trim() || 'Player';
            const address = addrInput.value.trim();
            storage('dwu.mp.name', name);
            storage('dwu.mp.join', address);
            setStatus('Loading the game data…');
            const { gameData, fp } = await fingerprint();
            setStatus(`Connecting to ${address}…`);
            const link = await ep.connect(address);
            await joinOver(link, address, name, gameData, fp, address);
        } catch (err) {
            setStatus(`Cannot join: ${err instanceof Error ? err.message : String(err)}`, true);
        } finally {
            busy = false;
        }
    }

    async function doJoinByCode(): Promise<void> {
        if (busy) return;
        busy = true;
        try {
            const name = nameInput.value.trim() || 'Player';
            storage('dwu.mp.name', name);
            setStatus('Loading the game data…');
            const { gameData, fp } = await fingerprint();
            setStatus('Waiting for the code exchange…');
            let link: Link;
            try {
                link = await openCodeJoin({ title: 'Join by code' });
            } catch (err) {
                setStatus(err instanceof Error && err.message === 'cancelled' ? '' : `Cannot join: ${err instanceof Error ? err.message : String(err)}`, !(err instanceof Error && err.message === 'cancelled'));
                return;
            }
            await joinOver(link, INTERNET_ADDRESS, name, gameData, fp, 'the host (over the Internet)');
        } catch (err) {
            setStatus(`Cannot join: ${err instanceof Error ? err.message : String(err)}`, true);
        } finally {
            busy = false;
        }
    }

    /**
     * Phase 5 (§17): the host's settings differ from this app's: what differs (the theme; the files behind a data /
     * add-on difference), and Match Host Settings (the host's theme for this session) / Cancel.
     */
    function mismatchPanel(m: Extract<LobbyMessage, { t: 'lobbyMismatch' }>, mine: AppFingerprint, onMatch: () => Promise<void>, onCancel: () => void): HTMLElement {
        const box = h('div', 'mp-box mp-mismatch');
        box.dataset.mp = 'mismatch';
        box.appendChild(h('div', 'mp-subtitle', 'Your settings differ from the host\'s'));
        const themeName = (t: string): string => (t === '' ? 'Default' : t);
        const themeDiffers = m.theme !== mine.theme;
        const lines: string[] = [];
        if (themeDiffers) lines.push(`Theme: the host plays "${themeName(m.theme)}", you have "${themeName(mine.theme)}" active. Match Host Settings switches to the host's theme for this game (your own choice comes back afterwards).`);
        else if (m.data || m.addons) lines.push(m.reason);
        for (const l of lines) box.appendChild(h('div', 'mp-note', l));
        const details = h('div', 'mp-mismatch-files');
        details.dataset.mp = 'mismatch-files';
        box.appendChild(details);
        if (m.files !== null && !themeDiffers) {
            void fingerprintFiles().then((own) => {
                const d = diffFingerprintFiles(m.files!, own);
                const list = (title: string, xs: string[]): void => {
                    if (xs.length === 0) return;
                    details.appendChild(h('div', 'mp-setting', `${title} (${xs.length}): ${xs.slice(0, 30).join(', ')}${xs.length > 30 ? `, … ${xs.length - 30} more` : ''}`));
                };
                list('Missing here (the host has them)', d.missing);
                list('Different from the host\'s', d.different);
                list('Only here', d.extra);
                if (d.missing.length + d.different.length + d.extra.length === 0) details.appendChild(h('div', 'mp-setting', 'No file differs: the host\'s list of files was read before the difference.'));
            });
        }
        const bar = h('div', 'mp-bar');
        const match = button('Match Host Settings', 'match-host', () => {
            match.disabled = true;
            void onMatch().finally(() => (match.disabled = false));
        }, 'mp-btn mp-btn-primary');
        match.disabled = !themeDiffers;
        if (!themeDiffers) match.title = 'Only the theme can be matched here: the other differences need the same files as the host (the same DW:U install and openDWU release).';
        bar.append(match, button('Cancel', 'mismatch-cancel', () => {
            box.remove();
            onCancel();
            setStatus('');
        }, 'mp-btn mp-btn-secondary'));
        box.appendChild(bar);
        return box;
    }

    /** The lobby over an open link to the host (`address`: its LAN address, or INTERNET_ADDRESS). */
    async function joinOver(link: Link, address: string, name: string, gameData: GameData, fp: AppFingerprint, label: string): Promise<void> {
        {
            setStatus('Checking versions…');
            let lobby: ClientLobbyScreen | null = null;
            // A token from an earlier start with this host (a rejoin after a drop: the host gives the slot back).
            const saved = savedRejoin();
            const token = saved !== null && saved.address === address ? saved.token : undefined;
            let mismatchBox: HTMLElement | null = null;
            const client = await LobbyClient.join(link, {
                name,
                fingerprint: fp,
                ...(token !== undefined ? { rejoin: token } : {}),
                onChange: (state) => {
                    mismatchBox?.remove();
                    mismatchBox = null;
                    lobby?.render(state);
                },
                onMismatch: (m, retry) => {
                    mismatchBox?.remove();
                    mismatchBox = mismatchPanel(m, fp, async () => {
                        // Match host settings: the host's theme for this session, the data reloaded, a new hello.
                        setStatus(`Switching to the host's theme (${m.theme === '' ? 'Default' : m.theme})…`);
                        const err = await deps.matchTheme(m.theme);
                        if (err !== null) {
                            setStatus(err, true);
                            return;
                        }
                        await deps.prepare();
                        fp = await appFingerprint(deps.fingerprintBase());
                        lastFingerprint = fp;
                        setStatus('Checking again…');
                        retry(fp);
                    }, () => {
                        link.close('cancelled');
                        void deps.restoreTheme();
                    });
                    win.insertBefore(mismatchBox, status);
                    setStatus('Your settings differ from the host\'s.', true);
                },
                onChat: (from, who, text, to) => lobby?.chat(from, who, text, to),
                // The game is running (§21): pick an empire to take over, or leave.
                onJoinOffer: (game, choices, pick) => {
                    mismatchBox?.remove();
                    mismatchBox = joinOfferPanel(game, choices, (empireId) => {
                        setStatus('Joining the game…');
                        pick(empireId);
                    }, () => {
                        mismatchBox?.remove();
                        mismatchBox = null;
                        link.close('cancelled');
                        setStatus('');
                    });
                    win.insertBefore(mismatchBox, status);
                    setStatus('The game is running: choose the empire you will play.');
                },
                onStart: (start, handoff) => {
                    lobby?.destroy();
                    lobby = null;
                    if (client.token !== null) storage('dwu.mp.rejoin', JSON.stringify({ address, name, token: client.token }));
                    void startAsClient(deps, start, handoff, client.slot, name, onBack, { address, token: client.token });
                },
                onRejoin: (start, slot, handoff, tok) => {
                    root.remove();
                    storage('dwu.mp.rejoin', JSON.stringify({ address, name, token: tok }));
                    void startAsClient(deps, start, handoff, slot, name, onBack, { address, token: tok }, true);
                },
                onClosed: (reason) => {
                    lobby?.destroy();
                    lobby = null;
                    void deps.restoreTheme();
                    openMultiplayerScreen(deps, onBack);
                    showMenuError(reason);
                },
            });
            if (client.rejoined) return; // onRejoin took over
            (mismatchBox as HTMLElement | null)?.remove();
            root.remove();
            lobby = openClientLobby(deps, client, gameData, label, () => {
                client.leave();
                lobby?.destroy();
                lobby = null;
                void deps.restoreTheme();
                openMultiplayerScreen(deps, onBack);
            });
            lobby.render(client.state);
        }
    }
}

/** A new player at a running game (§21): the empires on offer, one to pick (`kind` 'ai': the AI plays it until then). */
function joinOfferPanel(game: string, choices: readonly LobbyJoinChoice[], onPick: (empireId: number) => void, onCancel: () => void): HTMLElement {
    const box = h('div', 'mp-mismatch mp-join-offer');
    box.dataset.mp = 'join-offer';
    box.appendChild(h('div', 'mp-subtitle', 'Join the running game'));
    box.appendChild(h('div', 'mp-note', `The game has started${game !== '' ? ` (players: ${game})` : ''}. Take over an empire: you receive the current game and play from the next moments on. An AI empire keeps its colonies, ships and treaties.`));
    const list = h('div', 'mp-join-list');
    let chosen = choices[0]?.empireId ?? -1;
    const take = button('Take Over', 'join-take', () => {
        if (chosen < 0) return;
        take.disabled = true;
        onPick(chosen);
    }, 'mp-btn mp-btn-primary');
    for (const c of choices) {
        const row = h('label', 'mp-row mp-check mp-join-row');
        const radio = h('input');
        radio.type = 'radio';
        radio.name = 'mp-join';
        radio.dataset.mp = 'join-choice';
        radio.dataset.empire = String(c.empireId);
        radio.checked = c.empireId === chosen;
        radio.addEventListener('change', () => (chosen = c.empireId));
        const sw = h('span', 'mp-swatch');
        sw.style.background = `#${c.color.toString(16).padStart(6, '0')}`;
        row.append(radio, sw, h('span', '', `${c.name} — ${c.race !== '' ? `${c.race}, ` : ''}${c.colonies} colon${c.colonies === 1 ? 'y' : 'ies'}${c.kind === 'seat' ? ' (a free player seat)' : ' (AI)'}`));
        list.appendChild(row);
    }
    const bar = h('div', 'mp-bar');
    bar.append(take, button('Cancel', 'join-cancel', () => {
        box.remove();
        onCancel();
    }, 'mp-btn mp-btn-secondary'));
    box.append(list, bar);
    return box;
}

/** The rejoin token of the last game this app joined ({ address, name, token }), or null. */
function savedRejoin(): { address: string; name: string; token: string } | null {
    try {
        const v = JSON.parse(storage('dwu.mp.rejoin') || 'null') as { address?: unknown; name?: unknown; token?: unknown } | null;
        if (v === null || typeof v.address !== 'string' || typeof v.token !== 'string') return null;
        return { address: v.address, name: typeof v.name === 'string' ? v.name : '', token: v.token };
    } catch {
        return null;
    }
}

/** An error line on a freshly opened Multiplayer screen. */
function showMenuError(text: string): void {
    const s = document.querySelector<HTMLElement>('.mp-screen [data-mp="status"]');
    if (s !== null) {
        s.textContent = text;
        s.classList.add('mp-error');
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// The lobby's player rows
// ---------------------------------------------------------------------------------------------------------------------

interface RowEditor {
    el: HTMLElement;
    set(pick: HumanPlayerStart, claim: number, ready: boolean, state: LobbyState): void;
}

const PALETTE = ['#c03030', '#3060d0', '#30a040', '#d0a020', '#a040c0', '#20a0b0', '#e07020', '#d050a0', '#60c0e0', '#808080'];

/** An editable empire pick (the hot-seat row) for this screen's own player. */
function ownRowEditor(gameData: GameData, isHost: boolean, onChange: (pick: HumanPlayerStart, claim: number, ready: boolean) => void): RowEditor {
    const races: Race[] = playerSelectableRacesSorted(gameData.races);
    const governments: Government[] = (gameData.governments as Government[]).filter((g) => g != null);
    const row = h('div', 'mp-pick');
    row.dataset.mp = 'own-row';
    let pick: HumanPlayerStart = { name: '', race: '', governmentId: -1, primaryColor: '#808080', secondaryColor: '#ffffff' };
    let claim = -1;
    let ready = isHost;
    const nameIn = h('input', 'mp-input mp-cell-name');
    nameIn.dataset.mp = 'empire-name';
    nameIn.placeholder = 'Empire name';
    stopKeys(nameIn);
    const raceSel = h('select', 'mp-input mp-cell-race');
    raceSel.dataset.mp = 'race';
    const govSel = h('select', 'mp-input mp-cell-gov');
    govSel.dataset.mp = 'government';
    const c1 = h('input', 'mp-color');
    c1.type = 'color';
    c1.dataset.mp = 'color1';
    const c2 = h('input', 'mp-color');
    c2.type = 'color';
    c2.dataset.mp = 'color2';
    const claimSel = h('select', 'mp-input mp-cell-claim');
    claimSel.dataset.mp = 'claim';
    const readyBox = h('label', 'mp-ready');
    const readyIn = h('input');
    readyIn.type = 'checkbox';
    readyIn.dataset.mp = 'ready';
    readyBox.append(readyIn, document.createTextNode(' Ready'));
    if (isHost) readyBox.hidden = true;
    for (const s of [raceSel, govSel, claimSel]) stopKeys(s);

    const fillRaces = (): void => {
        const opts = [new Option('(Random)', '')].concat(races.map((r) => new Option(r.name, r.name)));
        raceSel.replaceChildren(...opts);
        raceSel.value = pick.race;
    };
    const race = (): Race | null => (pick.race === '' ? null : (races.find((r) => r.name === pick.race) ?? null));
    const fillGovs = (): void => {
        const opts = [new Option('(Random)', '-1')].concat(startGovernmentsForRace(governments, race()).map((g) => new Option(g.name, String(g.governmentId))));
        govSel.replaceChildren(...opts);
        govSel.value = String(pick.governmentId);
        if (govSel.value === '') govSel.value = '-1';
    };
    fillRaces();
    fillGovs();
    const emit = (): void => onChange({ ...pick }, claim, ready);
    let nameTimer: ReturnType<typeof setTimeout> | null = null;
    nameIn.addEventListener('input', () => {
        pick.name = nameIn.value;
        if (nameTimer !== null) clearTimeout(nameTimer);
        nameTimer = setTimeout(emit, 250);
    });
    raceSel.addEventListener('change', () => {
        pick.race = raceSel.value;
        const r = race();
        const offered = startGovernmentsForRace(governments, r);
        if (!offered.some((g) => g.governmentId === pick.governmentId)) pick.governmentId = -1;
        if (r !== null && r.preferredStartingGovernment !== -1 && offered.some((g) => g.governmentId === r.preferredStartingGovernment)) pick.governmentId = r.preferredStartingGovernment;
        fillGovs();
        emit();
    });
    govSel.addEventListener('change', () => {
        pick.governmentId = parseInt(govSel.value, 10);
        emit();
    });
    c1.addEventListener('change', () => {
        pick.primaryColor = c1.value;
        emit();
    });
    c2.addEventListener('change', () => {
        pick.secondaryColor = c2.value;
        emit();
    });
    claimSel.addEventListener('change', () => {
        claim = parseInt(claimSel.value, 10);
        emit();
    });
    readyIn.addEventListener('change', () => {
        ready = readyIn.checked;
        emit();
    });
    row.append(nameIn, raceSel, govSel, c1, c2, claimSel, readyBox);
    return {
        el: row,
        set(p, cl, rd, state) {
            pick = { ...p };
            claim = cl;
            ready = rd;
            if (document.activeElement !== nameIn) nameIn.value = pick.name;
            nameIn.placeholder = pick.race === '' ? 'Empire name' : `${pick.race} Empire`;
            if (raceSel.value !== pick.race) {
                raceSel.value = pick.race;
                fillGovs();
            }
            if (govSel.value !== String(pick.governmentId)) govSel.value = String(pick.governmentId);
            c1.value = pick.primaryColor;
            c2.value = pick.secondaryColor;
            readyIn.checked = ready;
            const loaded = state.loaded !== null;
            for (const e of [nameIn, raceSel, govSel, c1, c2]) e.hidden = loaded;
            claimSel.hidden = !loaded || isHost;
            if (loaded) {
                const taken = new Set(state.players.filter((x) => x.claim >= 0).map((x) => x.claim));
                const opts = [new Option('(choose a saved empire)', '-1')].concat(
                    state.loaded!.humans.filter((hs) => hs.humanIndex !== 0).map((hs) => {
                        const o = new Option(`${hs.empireName}${hs.playerName !== '' ? ` (was ${hs.playerName})` : ''}`, String(hs.humanIndex));
                        o.disabled = taken.has(hs.humanIndex) && hs.humanIndex !== claim;
                        return o;
                    }),
                );
                claimSel.replaceChildren(...opts);
                claimSel.value = String(claim);
            }
        },
    };
}

function swatch(color: string): HTMLSpanElement {
    const s = h('span', 'mp-swatch');
    s.style.background = color;
    return s;
}

/** A read-only row: another player's pick. */
function playerSummary(p: LobbyPlayer, state: LobbyState, gameData: GameData): string {
    if (state.loaded !== null) {
        const hs = state.loaded.humans.find((x) => x.humanIndex === p.claim);
        return hs === undefined ? '(no saved empire chosen)' : hs.empireName;
    }
    const gov = p.pick.governmentId >= 0 ? (gameData.governments[p.pick.governmentId]?.name ?? '?') : '(Random)';
    return `${p.pick.name !== '' ? p.pick.name : p.pick.race !== '' ? `${p.pick.race} Empire` : '(Random) empire'} · ${p.pick.race !== '' ? p.pick.race : '(Random race)'} · ${gov}`;
}

function renderPlayers(table: HTMLElement, state: LobbyState, mySlot: number, own: RowEditor, gameData: GameData): void {
    const rows: HTMLElement[] = [];
    for (const p of state.players) {
        const row = h('div', 'mp-player');
        row.dataset.slot = String(p.slot);
        const who = h('div', 'mp-player-name', `${p.name}${p.slot === 0 ? ' (host)' : ''}${p.slot === mySlot ? ' — you' : ''}`);
        row.appendChild(who);
        if (p.slot === mySlot) row.appendChild(own.el);
        else {
            const sum = h('div', 'mp-player-pick');
            if (state.loaded === null) sum.append(swatch(p.pick.primaryColor), swatch(p.pick.secondaryColor));
            sum.append(document.createTextNode(playerSummary(p, state, gameData)));
            row.appendChild(sum);
            row.appendChild(h('div', `mp-player-ready${p.ready ? ' mp-on' : ''}`, p.slot === 0 ? '' : p.ready ? 'Ready' : 'Not ready'));
        }
        rows.push(row);
    }
    table.replaceChildren(...rows);
}

// ---------------------------------------------------------------------------------------------------------------------
// Host lobby
// ---------------------------------------------------------------------------------------------------------------------

function hostPickFrom(o: StartGameOptions, fallbackColor: string): HumanPlayerStart {
    return {
        name: o.empireName,
        race: o.raceName,
        governmentId: o.governmentId,
        primaryColor: /^#[0-9a-f]{6}$/i.test(o.primaryColor) ? o.primaryColor.toLowerCase() : fallbackColor,
        secondaryColor: /^#[0-9a-f]{6}$/i.test(o.secondaryColor) ? o.secondaryColor.toLowerCase() : '#ffffff',
    };
}

/** A late connection while the game runs (joining mid-game is Phase 5): refuse it. */
function refuseLate(link: Link): void {
    link.send(JSON.stringify({ t: 'lobbyRefused', reason: 'The game has already started (joining a running game comes in a later version).' }));
    link.close('refused');
}

function openHostLobby(deps: MultiplayerAppDeps, gameData: GameData, fp: AppFingerprint, name: string, port: number | null, addresses: NetAddress[], onBack: () => void, internet: InternetHost | null, mapping: Promise<PortMapping> | null, resume = false): void {
    const ep = netEndpoint();
    let options: StartGameOptions = wizardStartGameOptions();
    let loaded: LoadedMultiplayerSave | null = null;
    const lobby = new LobbyHost({
        name,
        fingerprint: fp,
        hostPick: hostPickFrom(options, PALETTE[0]),
        onChange: (s) => render(s),
        log: (m) => console.info(`[lobby] ${m}`),
        files: () => fingerprintFiles(),
        onChat: (from, who, text, to) => {
            if (from !== 0) chat.add(from, who, text, to);
        },
    });
    const chat = new ChatPanel({ mode: 'lobby', mySlot: 0, peers: () => lobby.state().players.map((p) => ({ slot: p.slot, name: p.name })), send: (text, to) => lobby.sendChat(text, to) });
    /** The settings lines and the host's theme / add-on set (§17) for everyone. */
    const pushSettings = (lines: string[], addons: LobbyAddonSet | null): void => {
        lobby.setSettings(lines);
        lobby.setHostSettings(fp.theme, addons);
    };
    ep.onIncoming = (link, remote) => lobby.accept(link, remote);

    const root = h('div', 'mp-screen');
    root.dataset.mp = 'lobby';
    const win = h('div', 'mp-window mp-window-wide');
    root.appendChild(win);
    win.appendChild(h('div', 'mp-title', internet !== null ? 'Multiplayer Lobby — hosting on the Internet' : 'Multiplayer Lobby — hosting'));
    if (internet !== null) win.appendChild(internet.board(() => LOBBY_MAX_PLAYERS - 1));
    const share = h('div', 'mp-share');
    share.dataset.mp = 'addresses';
    const list = addresses.filter((a) => a.family === 'IPv4').map((a) => `${a.address}:${port}`);
    share.textContent =
        port === null
            ? 'No LAN port is open (players join by invite code only).'
            : `${internet !== null ? 'Also by IP (LAN, Tailscale): ' : 'Players join with: '}${list.length > 0 ? `${list.join('   ')}   (port ${port}; on this PC: 127.0.0.1:${port})` : `port ${port}; on this PC 127.0.0.1:${port}`}`;
    win.appendChild(share);
    if (mapping !== null) {
        const mapLine = h('div', 'mp-share');
        mapLine.dataset.mp = 'port-mapping';
        mapLine.textContent = 'Opening the port on your router (UPnP / NAT-PMP)…';
        win.appendChild(mapLine);
        void mapping.then(
            (m) => {
                if (m.ok) {
                    const addr = m.externalIp !== '' ? `${m.externalIp}:${m.externalPort}` : `<your public IP>:${m.externalPort}`;
                    if (internet !== null && m.publicAddress) internet.publicAddress = addr;
                    mapLine.textContent = `Router port opened (${m.method}): players anywhere can join by IP with ${addr}.${m.note !== '' ? ` ${m.note}` : ''} This PC's firewall must also let the port in (macOS asks; on Linux / Windows allow it for the app). The mapping is removed when you stop hosting.`;
                } else mapLine.textContent = `The router did not open the port: ${m.error}. Forward TCP port ${port} by hand in the router's settings, or use invite codes.`;
                mapLine.classList.toggle('mp-error', !m.ok || !m.publicAddress);
            },
            (err: unknown) => (mapLine.textContent = `Port mapping failed: ${err instanceof Error ? err.message : String(err)}`),
        );
    }
    const table = h('div', 'mp-players');
    win.appendChild(table);
    const settingsBox = h('div', 'mp-settings');
    settingsBox.dataset.mp = 'settings-box';
    win.appendChild(settingsBox);
    const status = h('div', 'mp-status');
    status.dataset.mp = 'lobby-status';
    const bar = h('div', 'mp-bar');
    const settingsBtn = button('Game Settings…', 'settings', () => void editSettings());
    const loadBtn = button('Load Saved Game…', 'load', () => void loadSave());
    const newBtn = button('New Game Instead', 'new', () => {
        loaded = null;
        lobby.setLoaded(null);
        pushSettings(settingsSummary(options), deps.addonSet(options));
    });
    const startBtn = button('Start Game', 'start', () => void start(), 'mp-btn mp-btn-primary');
    const leaveBtn = button('Close Lobby', 'leave', () => {
        chat.destroy();
        lobby.close();
        internet?.close();
        ep.onIncoming = null;
        void ep.stopHost();
        root.remove();
        openMultiplayerScreen(deps, onBack);
    }, 'mp-btn mp-btn-secondary');
    bar.append(settingsBtn, loadBtn, newBtn, startBtn, leaveBtn);
    // Phase 4 (§13): the input delay follows the measured round trips (for slower networks than a LAN).
    // On by default on the Internet (round trips of 50–200 ms; a fixed 4-frame delay stalls), off on a LAN.
    const adaptiveKey = internet !== null ? 'dwu.mp.adaptiveDelayInternet' : 'dwu.mp.adaptiveDelay';
    let adaptiveDelay = internet !== null ? storage(adaptiveKey) !== '0' : storage(adaptiveKey) === '1';
    const adaptiveRow = h('label', 'mp-row mp-check');
    const adaptiveIn = h('input');
    adaptiveIn.type = 'checkbox';
    adaptiveIn.dataset.mp = 'adaptive-delay';
    adaptiveIn.checked = adaptiveDelay;
    adaptiveIn.addEventListener('change', () => {
        adaptiveDelay = adaptiveIn.checked;
        storage(adaptiveKey, adaptiveDelay ? '1' : '0');
    });
    adaptiveRow.append(adaptiveIn, h('span', '', 'Adaptive input delay (follows the measured ping; for slower networks)'));
    win.append(adaptiveRow, chat.el, status, bar);
    document.body.appendChild(root);

    const own = ownRowEditor(gameData, true, (pick) => lobby.setHostPick(pick));
    function render(state: LobbyState): void {
        const me = state.players.find((p) => p.slot === 0)!;
        own.set(me.pick, me.claim, true, state);
        renderPlayers(table, state, 0, own, gameData);
        settingsBox.replaceChildren(h('div', 'mp-subtitle', state.loaded !== null ? `Saved game: ${state.loaded.name}` : 'Game settings'), ...[...state.settings, ...hostSettingsLines(state)].map((l) => h('div', 'mp-setting', l)));
        const blocker = lobby.startBlocker();
        startBtn.disabled = blocker !== null;
        status.textContent = blocker ?? 'Everyone is ready.';
        newBtn.hidden = state.loaded === null;
        settingsBtn.hidden = state.loaded !== null;
    }
    pushSettings(settingsSummary(options), deps.addonSet(options));
    // Scripts (a LAN test without clicking through the wizard): patch the settings as the wizard would.
    exposeDevHook('__dwuMpLobby', {
        patchSettings: (patch: Partial<StartGameOptions>) => {
            options = { ...options, ...structuredClone(patch) };
            pushSettings(settingsSummary(options), deps.addonSet(options));
        },
        chatLines: () => chat.lines.map((l) => ({ ...l })),
        options: () => structuredClone(options),
        state: () => lobby.state(),
        setAdaptiveDelay: (on: boolean) => {
            adaptiveDelay = on;
            adaptiveIn.checked = on;
        },
        fingerprint: () => ({ ...lobby.fingerprint }),
        files: () => fingerprintFiles(),
        /** Open Load Saved Game (the Resume path opens it on the multiplayer saves). */
        loadSave: (multiplayerOnly = false) => loadSave(multiplayerOnly),
    });
    // Resume with the same players (§21): straight to the multiplayer saves.
    if (resume) queueMicrotask(() => void loadSave(true));

    async function editSettings(): Promise<void> {
        root.hidden = true;
        try {
            // The host's own row is player 1 of the wizard.
            const host = lobby.state().players.find((p) => p.slot === 0)!.pick;
            const initial: StartGameOptions = { ...options, empireName: host.name, raceName: host.race, governmentId: host.governmentId, primaryColor: host.primaryColor, secondaryColor: host.secondaryColor };
            const got = await deps.openWizard(initial);
            if (got !== null) {
                options = got;
                delete options.humanPlayers;
                lobby.setHostPick(hostPickFrom(options, host.primaryColor));
                pushSettings(settingsSummary(options), deps.addonSet(options));
            }
        } finally {
            root.hidden = false;
        }
    }

    async function loadSave(multiplayerOnly = false): Promise<void> {
        root.hidden = true;
        try {
            const save = await deps.pickSave({ multiplayerOnly });
            if (save === null) return;
            loaded = save;
            if ((save.chat?.length ?? 0) > 0) chat.history(save.chat!, name);
            const humans = humanSeats(save.game.galaxy);
            lobby.setLoaded({ name: save.name, humans: humans.map((e, i) => ({ humanIndex: i, empireName: e.name, playerName: save.players?.[i] ?? '' })) }, save.tokens);
            const extra = humans.length < 2 ? ['This save has one human empire: the other players need a LAN save (or start a new game).'] : [];
            const sc = save.scenario;
            pushSettings([`${humans.length} human empire${humans.length === 1 ? '' : 's'}: ${humans.map((e) => e.name).join(', ')}`, ...settingsSummary(save.startOptions).slice(0, 1), ...extra], sc === null ? null : { id: sc.id, packages: sc.include ?? [sc.id], names: (sc.include ?? [sc.id]).map(String), flags: {}, params: {} });
        } catch (err) {
            status.textContent = `Could not load the save: ${err instanceof Error ? err.message : String(err)}`;
        } finally {
            root.hidden = false;
        }
    }

    async function start(): Promise<void> {
        if (lobby.startBlocker() !== null) return;
        startBtn.disabled = true;
        const state = lobby.state();
        const clients = state.players.filter((p) => p.slot !== 0).sort((a, b) => a.slot - b.slot);
        const host = state.players.find((p) => p.slot === 0)!;
        const params = { inputDelay: 4, digestInterval: 60 };
        let start: MultiplayerStart;
        const chatHistory = loaded?.chat;
        if (loaded === null) {
            const so: StartGameOptions = { ...structuredClone(options), empireName: host.pick.name, raceName: host.pick.race, governmentId: host.pick.governmentId, primaryColor: host.pick.primaryColor, secondaryColor: host.pick.secondaryColor, humanPlayers: clients.map((p) => ({ ...p.pick })) };
            start = {
                kind: 'new',
                startOptions: so,
                createExtras: deps.createExtras(so),
                scenario: null,
                players: [{ slot: 0, name: host.name, humanIndex: 0 }, ...clients.map((p, i) => ({ slot: p.slot, name: p.name, humanIndex: i + 1 }))],
                params,
                clock: { speed: 1, paused: true },
            };
        } else {
            start = {
                kind: 'load',
                startOptions: loaded.startOptions,
                createExtras: null,
                scenario: loaded.scenario,
                players: [{ slot: 0, name: host.name, humanIndex: 0 }, ...clients.map((p) => ({ slot: p.slot, name: p.name, humanIndex: p.claim }))],
                params,
                clock: { speed: loaded.time.speed, paused: true },
            };
        }
        // Every peer builds from the same JSON (a value that does not survive JSON would differ on the clients).
        start = JSON.parse(JSON.stringify(start)) as MultiplayerStart;
        const side = new SideHub('host', 0);
        const links = new Map<number, Link>([...lobby.start(start)].map(([slot, l]) => [slot, side.tap(l, slot)]));
        const tokens = new Map(lobby.tokens);
        delete (window as unknown as { __dwuMpLobby?: unknown }).__dwuMpLobby;
        chat.destroy();
        ep.onIncoming = refuseLate;
        internet?.withdrawAll();
        root.remove();
        try {
            let handle: MpHandle;
            if (deps.useWorker()) {
                // Worker mode (§11): the game and the session in the sim worker; the links stay here, relayed.
                const wm = new WorkerMp('host', start, 0, host.name);
                if (start.kind === 'new') wm.attach((await deps.buildGameInWorker(start.startOptions, start.createExtras, wm.side)).client);
                else {
                    if (loaded!.text === undefined) throw new Error('the save text is not available for the simulation worker');
                    wm.attach(await deps.bootWorker('Loading game', { kind: 'load', text: loaded!.text }, loaded!.playData, undefined, { ...start.clock }, wm.side));
                    loaded = null;
                }
                await wm.begin(links, false, adaptiveDelay);
                handle = wm;
            } else {
                let game: Game;
                let time: GalaxyTime;
                let playData: GameData;
                if (start.kind === 'new') {
                    ({ game, playData } = await deps.buildGame(start.startOptions, start.createExtras));
                    time = new GalaxyTime();
                } else {
                    ({ game, time, playData } = loaded!);
                }
                time.speed = start.clock.speed;
                time.paused = start.clock.paused;
                const it = new InThreadMp(start, 0);
                it.links.push(...links.values());
                it.mp = MultiplayerGame.host(game, time, links, {
                    start,
                    slot: 0,
                    name: host.name,
                    gameData: playData,
                    startOptions: start.startOptions,
                    ...it.hooks(),
                    onDropped: (op, reason) => console.warn(`[lockstep] dropped ${op}: ${reason}`),
                    log: (m) => console.info(`[lockstep] ${m}`),
                    ...(adaptiveDelay ? { adaptiveDelay: {} } : {}),
                });
                setLockstepStepper(game.galaxy, it.mp.stepper);
                handle = it;
            }
            await runGame(deps, handle, side, host.name, start.startOptions, true, start.kind === 'new', { tokens, internet, ...(chatHistory !== undefined && chatHistory.length > 0 ? { chatHistory } : {}) });
        } catch (err) {
            console.error('multiplayer: the game could not start', err);
            for (const l of links.values()) l.close('the host could not start the game');
            endMultiplayerSession('start failed');
            internet?.close();
            ep.onIncoming = null;
            void ep.stopHost();
            deps.toMenu();
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Client lobby and start
// ---------------------------------------------------------------------------------------------------------------------

interface ClientLobbyScreen {
    render(state: LobbyState): void;
    chat(from: number, name: string, text: string, to: number): void;
    destroy(): void;
}

function openClientLobby(deps: MultiplayerAppDeps, client: LobbyClient, gameData: GameData, address: string, onLeave: () => void): ClientLobbyScreen {
    const root = h('div', 'mp-screen');
    root.dataset.mp = 'lobby';
    const win = h('div', 'mp-window mp-window-wide');
    root.appendChild(win);
    win.appendChild(h('div', 'mp-title', 'Multiplayer Lobby'));
    win.appendChild(h('div', 'mp-share', `Connected to ${address}. Pick your empire and tick Ready; the host starts the game.`));
    const table = h('div', 'mp-players');
    win.appendChild(table);
    const settingsBox = h('div', 'mp-settings');
    settingsBox.dataset.mp = 'settings-box';
    win.appendChild(settingsBox);
    const status = h('div', 'mp-status');
    status.dataset.mp = 'lobby-status';
    const bar = h('div', 'mp-bar');
    bar.append(button('Leave', 'leave', () => {
        root.remove();
        onLeave();
    }, 'mp-btn mp-btn-secondary'));
    // Phase 5: what the host's add-on set needs that this app lacks (§17), and the lobby chat (§19).
    const missingBox = h('div', 'mp-status mp-error');
    missingBox.dataset.mp = 'missing-addons';
    missingBox.hidden = true;
    let state: LobbyState = client.state;
    const chat = new ChatPanel({ mode: 'lobby', mySlot: client.slot, peers: () => state.players.map((p) => ({ slot: p.slot, name: p.name })), send: (text, to) => client.sendChat(text, to) });
    win.append(missingBox, chat.el, status, bar);
    document.body.appendChild(root);
    let missing: string[] = [];
    let sentMissing = '';
    const own = ownRowEditor(gameData, false, (pick, claim, ready) => client.setPick(pick, claim, ready, missing));
    return {
        render(st) {
            state = st;
            const me = st.players.find((p) => p.slot === client.slot);
            if (me !== undefined) own.set(me.pick, me.claim, me.ready, st);
            renderPlayers(table, st, client.slot, own, gameData);
            settingsBox.replaceChildren(h('div', 'mp-subtitle', st.loaded !== null ? `Saved game: ${st.loaded.name}` : 'Game settings (chosen by the host)'), ...[...st.settings, ...hostSettingsLines(st)].map((l) => h('div', 'mp-setting', l)));
            missing = st.host?.addons != null ? deps.missingAddons(st.host.addons.packages) : [];
            const key = missing.join(',');
            if (key !== sentMissing && me !== undefined) {
                sentMissing = key;
                client.setPick(me.pick, me.claim, me.ready, missing);
            }
            missingBox.hidden = missing.length === 0;
            const names = (st.host?.addons?.packages ?? []).map((id, i) => (missing.includes(id) ? `${st.host!.addons!.names[i] ?? id} (${id})` : null)).filter((x): x is string => x !== null);
            missingBox.textContent = missing.length === 0 ? '' : `This app does not have the add-on package${names.length === 1 ? '' : 's'} the host's game uses: ${names.join(', ')}. Every player needs the same openDWU release with the same add-ons (assets/scenarios/), or the host picks other add-ons.${IS_CLASSIC ? ' openDWU Classic ships only Themed Names, Smarter AI, Orbital Superiority, Longer Ground Battles, Jump Interdiction and the Event Log: install the full edition to play this game.' : ''}`;
            status.textContent = me?.ready === true ? 'Ready. Waiting for the host to start…' : 'Tick Ready when your empire is set.';
        },
        chat(from, name, text, to) {
            chat.add(from, name, text, to);
        },
        destroy() {
            chat.destroy();
            root.remove();
        },
    };
}

async function startAsClient(deps: MultiplayerAppDeps, start: MultiplayerStart, lobbyLink: HandoffLink, slot: number, name: string, onBack: () => void, rejoin: { address: string; token: string | null }, isRejoin = false, hostSlot = 0): Promise<void> {
    // Side messages (chat, migration signalling) off the session's link (§16).
    const side = new SideHub('client', slot);
    const link = side.tap(lobbyLink, hostSlot, true);
    const wait = h('div', 'mp-screen');
    wait.dataset.mp = 'starting';
    wait.appendChild(h('div', 'mp-window', isRejoin ? 'Rejoining the game. Receiving the current game from the host…' : start.kind === 'new' ? 'The host started the game. Building the galaxy…' : 'The host started the game. Receiving the saved game…'));
    document.body.appendChild(wait);
    // A rejoin, or a loaded game: the welcome's save brings the game. A new game: built here from the same start.
    const buildHere = start.kind === 'new' && !isRejoin;
    try {
        let handle: MpHandle;
        if (deps.useWorker()) {
            // Worker mode (§11): the session runs in the sim worker; the link to the host stays here, relayed.
            const wm = new WorkerMp('client', start, slot, name);
            const links = new Map<number, Link>([[0, link]]);
            if (buildHere) {
                wm.attach((await deps.buildGameInWorker(start.startOptions, start.createExtras, wm.side)).client);
                await wm.begin(links, true, false);
            } else {
                const endpoint = SimWorkerClient.createEndpoint();
                wm.useEndpoint(endpoint);
                const boot = deps.bootWorker(isRejoin ? 'Rejoining the game' : 'Receiving the saved game', { kind: 'lockstep', scenario: deps.scenarioOfStart(start) }, deps.gameDataForStart(start), start.startOptions, { ...start.clock }, wm.side, endpoint);
                const began = wm.begin(links, false, false);
                began.catch(() => undefined);
                await wm.firstClient(boot);
                await began;
            }
            handle = wm;
        } else {
            let game: Game | null = null;
            let time: GalaxyTime | null = null;
            let gameData: GameData;
            if (buildHere) {
                const built = await deps.buildGame(start.startOptions, start.createExtras);
                game = built.game;
                gameData = built.playData;
                time = new GalaxyTime();
                time.speed = start.clock.speed;
                time.paused = start.clock.paused;
            } else {
                gameData = deps.gameDataForStart(start);
            }
            const it = new InThreadMp(start, slot);
            it.links.push(link);
            it.mp = await MultiplayerGame.join(game, time, link, {
                start,
                slot,
                name,
                gameData,
                startOptions: start.startOptions,
                ...it.hooks(),
                onDropped: (op, reason) => console.warn(`[lockstep] dropped ${op}: ${reason}`),
                log: (m) => console.info(`[lockstep] ${m}`),
            });
            setLockstepStepper(it.mp.sim.galaxy, it.mp.stepper);
            handle = it;
        }
        wait.remove();
        await runGame(deps, handle, side, name, start.startOptions, false, buildHere, { rejoin });
    } catch (err) {
        wait.remove();
        console.error('multiplayer: could not join the game', err);
        link.close('could not join');
        endMultiplayerSession('join failed');
        deps.toMenu();
        openMultiplayerScreen(deps, onBack);
        showMenuError(`Could not join the game: ${err instanceof Error ? err.message : String(err)}`);
    }
}
