// LAN multiplayer in the app (multiplayer Phase 3, docs/MULTIPLAYER.md §10): the main menu's Multiplayer screen (Host
// Game / Join Game), the lobby, and the running game's session (status banner, save extras, the debug hook).
//
// - Host: the desktop app listens (netBridge.ts → desktop/netHost.cjs), shows its LAN addresses, and runs the lobby
//   (net/lobby.ts LobbyHost). The host picks the game settings in the new-game wizard and starts; or loads a LAN save,
//   whose humans the players claim.
// - Join: by IP:port. The lobby hello carries this app's fingerprint (net/fingerprint.ts); a mismatch is refused with
//   the reason. Each player picks an empire (the hot-seat row: name, race, government, flag colours) and says ready.
// - Start: every peer builds the same game from the host's MultiplayerStart (a new game) or gets the host's save over
//   the session (a loaded one), then runs it in lockstep (net/multiplayerGame.ts). The in-thread sim only: the lockstep
//   seam is in src/simLoop.ts (the sim worker has none yet).
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
import { humanEmpires } from '../../sim/humanEmpires';
import type { GameSaveExtras } from '../../sim/save/gameSave';
import { issuePlayerCommand } from '../../sim/player/playerCommands';
import type { PlayerOpName } from '../../sim/player/playerOps';
import { GalaxyShape } from '../../sim/types';
import { appFingerprint, fingerprintFiles, type AppFingerprint } from '../../net/fingerprint';
import { LobbyClient, LobbyHost, type HandoffLink, type LobbyPlayer, type LobbyState, type MultiplayerStart } from '../../net/lobby';
import { MultiplayerGame, type MultiplayerStatus } from '../../net/multiplayerGame';
import { setLockstepStepper } from '../../net/lockstepSeam';
import type { Link } from '../../net/transport';
import { setLocalViewerEmpire } from '../../localViewer';
import { DEFAULT_MULTIPLAYER_PORT, netEndpoint, type NetAddress } from './netBridge';
import { playableRacesSorted, startGovernmentsForRace } from '../screens/newGameWizard';
import './multiplayer.css';

export interface LoadedMultiplayerSave {
    game: Game;
    time: GalaxyTime;
    startOptions: StartGameOptions;
    playData: GameData;
    scenario: { id: string; include: string[] | null } | null;
    /** The save's LAN players by human index (savedMultiplayerPlayers), if it is a LAN save. */
    players: string[] | undefined;
    name: string;
}

export interface MultiplayerAppDeps {
    /** Load the static data (game data, add-ons, system names), so the lobby rows and the fingerprint are ready. */
    prepare(): Promise<GameData>;
    /** version / build / engine / theme of this app. */
    fingerprintBase(): { version: string; build: string; engine: string; theme: string };
    /** The new-game wizard over `initial`; resolves with the chosen options, or null (closed). */
    openWizard(initial: StartGameOptions): Promise<StartGameOptions | null>;
    /** What createGame takes from this app's settings beside the start options (host; sent to everyone). */
    createExtras(startOptions: StartGameOptions): Record<string, unknown>;
    /** Build a new game from the start (every peer, in-thread). */
    buildGame(startOptions: StartGameOptions, createExtras: Record<string, unknown> | null): Promise<{ game: Game; playData: GameData }>;
    /** The host's Load Saved Game: pick a save and load it in-thread (null: cancelled). */
    pickSave(): Promise<LoadedMultiplayerSave | null>;
    /** The GameData of a loaded game's add-ons (a client: the welcome's save loads over it). */
    gameDataFor(scenario: { id: string; include: string[] | null } | null): GameData;
    /** Show `game` in the main view (tears down the one up, if any). `newGame`: a fresh start (the founding line). */
    showGame(game: Game, startOptions: StartGameOptions, clock: { speed: number; paused: boolean }, newGame: boolean): Promise<void>;
    /** Back to the main menu (tears down the view). */
    toMenu(): void;
}

// ---------------------------------------------------------------------------------------------------------------------
// The running session
// ---------------------------------------------------------------------------------------------------------------------

interface Running {
    mp: MultiplayerGame;
    start: MultiplayerStart;
    slot: number;
    name: string;
    banner: StatusBanner;
    chipTimer: ReturnType<typeof setInterval>;
    hosting: boolean;
}

let running: Running | null = null;

/** A LAN game is running (main.ts: no hot-seat switch, no intro, LAN save extras). */
export function multiplayerActive(): boolean {
    return running !== null;
}

/** What a save of the running LAN game carries: its players by human index (loading it as host reopens the lobby). */
export function multiplayerSaveExtras(galaxy: Galaxy): GameSaveExtras | undefined {
    if (running === null) return undefined;
    const n = humanEmpires(galaxy).length;
    const names: string[] = Array.from({ length: n }, () => '');
    for (const p of running.start.players) if (p.humanIndex >= 0 && p.humanIndex < n) names[p.humanIndex] = p.name;
    return n > 0 ? { multiplayerPlayers: names } : undefined;
}

/** End the LAN game (leaving to the menu, loading another game): the host ends it for everyone. */
export function endMultiplayerSession(reason = 'left the game'): void {
    const r = running;
    if (r === null) return;
    running = null;
    clearInterval(r.chipTimer);
    r.banner.destroy();
    try {
        r.mp.close(reason);
    } catch (err) {
        console.warn('multiplayer: closing the session failed', err);
    }
    if (r.mp.sim.game !== null) setLockstepStepper(r.mp.sim.galaxy, null);
    if (r.hosting) {
        const ep = netEndpoint();
        ep.onIncoming = null;
        void ep.stopHost();
    }
    delete (window as unknown as { __dwuMp?: unknown }).__dwuMp;
}

function statusText(s: MultiplayerStatus, role: 'host' | 'client'): { text: string; menu: boolean } | null {
    switch (s.kind) {
        case 'running':
            return null;
        case 'waiting':
            return { text: `Waiting for ${s.missing.join(', ')} to join the game…`, menu: false };
        case 'resyncing':
            return { text: role === 'client' ? 'Resyncing with the host…' : `Resyncing ${s.who}…`, menu: false };
        case 'peerLeft':
            return {
                text: `${s.name} disconnected (${s.reason}). The game is paused.${role === 'host' ? ' Resume to play on without them; their empire stands idle.' : ''} (Rejoining and AI takeover come in a later version.)`,
                menu: true,
            };
        case 'hostLost':
            return { text: `Lost the connection to the host (${s.reason}). The game has stopped.`, menu: true };
    }
}

interface StatusBanner {
    show(s: MultiplayerStatus): void;
    chip(text: string): void;
    destroy(): void;
}

function createStatusBanner(role: 'host' | 'client', onMenu: () => void): StatusBanner {
    const banner = document.createElement('div');
    banner.className = 'mp-banner';
    banner.dataset.mp = 'banner';
    banner.hidden = true;
    const text = document.createElement('span');
    text.className = 'mp-banner-text';
    const menu = document.createElement('button');
    menu.type = 'button';
    menu.className = 'mp-btn mp-banner-menu';
    menu.textContent = 'Main Menu';
    menu.addEventListener('click', onMenu);
    banner.append(text, menu);
    const chip = document.createElement('div');
    chip.className = 'mp-chip';
    chip.dataset.mp = 'chip';
    document.body.append(banner, chip);
    return {
        show(s) {
            const t = statusText(s, role);
            banner.hidden = t === null;
            banner.dataset.status = s.kind;
            if (t === null) return;
            text.textContent = t.text;
            menu.hidden = !t.menu;
        },
        chip(t) {
            if (chip.textContent !== t) chip.textContent = t;
        },
        destroy() {
            banner.remove();
            chip.remove();
        },
    };
}

/** Wire a started MultiplayerGame into the app: stepper, viewer, view, banner, debug hook. */
async function runGame(deps: MultiplayerAppDeps, mp: MultiplayerGame, start: MultiplayerStart, slot: number, name: string, startOptions: StartGameOptions, hosting: boolean, newGame: boolean): Promise<void> {
    const banner = createStatusBanner(mp.role, () => {
        endMultiplayerSession('left the game');
        deps.toMenu();
    });
    const r: Running = { mp, start, slot, name, banner, chipTimer: setInterval(() => paintChip(), 1000), hosting };
    running = r;
    let ping = -1;
    const paintChip = (): void => {
        const s = mp.session;
        if (s === null) return;
        const peers = s.peerList().filter((p) => p.leftFrom === null).length;
        const me = mp.myEmpire();
        banner.chip(`LAN ${mp.role === 'host' ? 'host' : 'client'} · ${peers} player${peers === 1 ? '' : 's'}${me !== null ? ` · ${me.name}` : ''}${ping >= 0 ? ` · ping ${ping.toFixed(0)} ms` : ''}${s.stats.resyncs > 0 ? ` · ${s.stats.resyncs} resync${s.stats.resyncs === 1 ? '' : 's'}` : ''}`);
        if (mp.role === 'client' && s.active) void s.ping().then((ms) => (ping = ms), () => undefined);
    };
    banner.show(mp.currentStatus());
    installDebugHook(mp);
    const galaxy = mp.sim.galaxy;
    setLockstepStepper(galaxy, mp.stepper);
    setLocalViewerEmpire(galaxy, mp.myEmpire());
    await deps.showGame(mp.sim.game, startOptions, { ...mp.session!.clock }, newGame);
    paintChip();
}

/** `window.__dwuMp`: the session for scripts and debugging (scripts drive a LAN game through it). */
function installDebugHook(mp: MultiplayerGame): void {
    const hook = {
        get role() {
            return mp.role;
        },
        get status() {
            return mp.currentStatus();
        },
        get frame() {
            return mp.session?.frame ?? -1;
        },
        get clock() {
            return mp.session?.clock ?? null;
        },
        get stats() {
            return mp.session === null ? null : { ...mp.session.stats };
        },
        get gameMs() {
            return mp.sim.game === null ? -1 : mp.sim.galaxy.nowMs;
        },
        peers: () => mp.session?.peerList() ?? [],
        digest: () => mp.sim.digest(),
        myEmpire: () => mp.myEmpire()?.name ?? null,
        /** Issue a player command for this player's empire (goes through the session, like the UI's orders). */
        issue: (op: string, args: unknown[]) => {
            const me = mp.myEmpire();
            if (me === null) throw new Error('no empire');
            issuePlayerCommand(mp.sim.galaxy, me, op as PlayerOpName, args as never);
        },
        /** Try to rename another human's first ship (the authorize check refuses it on every peer). */
        renameOther: (humanIndex: number, label: string) => {
            const e = humanEmpires(mp.sim.galaxy)[humanIndex];
            const ship = e?.builtObjects.find((b) => b != null);
            if (e === undefined || ship === undefined) throw new Error(`no human ${humanIndex} with a ship`);
            issuePlayerCommand(mp.sim.galaxy, e, 'renameShip', [ship, label]);
        },
        /** A scripted step: rename this player's first ship and drop a waypoint at it. Returns the ship name. */
        scriptStep: (tag: string) => {
            const me = mp.myEmpire();
            if (me === null) return null;
            const ship = me.builtObjects.find((b) => b != null);
            if (ship === undefined) return null;
            const label = `${tag}`;
            issuePlayerCommand(mp.sim.galaxy, me, 'renameShip', [ship, label]);
            issuePlayerCommand(mp.sim.galaxy, me, 'addWaypoint', [Math.round(ship.xpos ?? 0), Math.round(ship.ypos ?? 0), `wp ${label}`]);
            return label;
        },
        shipNames: () => (mp.myEmpire()?.builtObjects ?? []).filter((b) => b != null).slice(0, 3).map((b) => b.name),
        pause: (paused: boolean) => mp.session?.requestPause(paused),
        setSpeed: (speed: number) => mp.session?.setSpeed(speed),
    };
    (window as unknown as { __dwuMp?: unknown }).__dwuMp = hook;
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
    const b = h('button', cls, label);
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

/** Open the main menu's Multiplayer screen. `onBack`: back to the menu. */
export function openMultiplayerScreen(deps: MultiplayerAppDeps, onBack: () => void): void {
    const ep = netEndpoint();
    const root = h('div', 'mp-screen');
    root.dataset.mp = 'menu';
    const win = h('div', 'mp-window');
    root.appendChild(win);
    win.appendChild(h('div', 'mp-title', 'Multiplayer (LAN)'));
    win.appendChild(h('div', 'mp-note', 'Play one game with other players on your local network. Every player needs the same version of openDWU and the same Distant Worlds: Universe files.'));

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
    const hostBtn = button('Host Game', 'host', () => void doHost());
    hostBox.appendChild(hostBtn);
    if (!ep.canHost) {
        hostBtn.disabled = true;
        hostBox.appendChild(h('div', 'mp-note', 'Hosting needs the desktop app. In the browser you can join a game.'));
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
    joinBox.appendChild(button('Join Game', 'join', () => void doJoin()));
    win.appendChild(joinBox);

    const status = h('div', 'mp-status');
    status.dataset.mp = 'status';
    win.appendChild(status);
    win.appendChild(button('Back', 'back', () => {
        root.remove();
        onBack();
    }, 'mp-btn mp-btn-secondary'));
    document.body.appendChild(root);
    nameInput.focus();

    const setStatus = (text: string, error = false): void => {
        status.textContent = text;
        status.classList.toggle('mp-error', error);
    };
    let busy = false;

    async function fingerprint(): Promise<{ gameData: GameData; fp: AppFingerprint }> {
        const gameData = await deps.prepare();
        return { gameData, fp: await appFingerprint(deps.fingerprintBase()) };
    }

    async function doHost(): Promise<void> {
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
            const listening = await ep.host(port);
            root.remove();
            openHostLobby(deps, gameData, fp, name, listening.port, listening.addresses, onBack);
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
            setStatus('Checking versions…');
            let lobby: ClientLobbyScreen | null = null;
            const client = await LobbyClient.join(link, {
                name,
                fingerprint: fp,
                onChange: (state) => lobby?.render(state),
                onStart: (start, handoff) => {
                    lobby?.destroy();
                    lobby = null;
                    void startAsClient(deps, start, handoff, client.slot, name, onBack);
                },
                onClosed: (reason) => {
                    lobby?.destroy();
                    lobby = null;
                    openMultiplayerScreen(deps, onBack);
                    showMenuError(reason);
                },
            });
            root.remove();
            lobby = openClientLobby(client, gameData, address, () => {
                client.leave();
                lobby?.destroy();
                lobby = null;
                openMultiplayerScreen(deps, onBack);
            });
            lobby.render(client.state);
        } catch (err) {
            setStatus(`Cannot join: ${err instanceof Error ? err.message : String(err)}`, true);
        } finally {
            busy = false;
        }
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
    const races: Race[] = playableRacesSorted(gameData.races);
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

function openHostLobby(deps: MultiplayerAppDeps, gameData: GameData, fp: AppFingerprint, name: string, port: number, addresses: NetAddress[], onBack: () => void): void {
    const ep = netEndpoint();
    let options: StartGameOptions = wizardStartGameOptions();
    let loaded: LoadedMultiplayerSave | null = null;
    const lobby = new LobbyHost({ name, fingerprint: fp, hostPick: hostPickFrom(options, PALETTE[0]), onChange: (s) => render(s), log: (m) => console.info(`[lobby] ${m}`) });
    ep.onIncoming = (link, remote) => lobby.accept(link, remote);

    const root = h('div', 'mp-screen');
    root.dataset.mp = 'lobby';
    const win = h('div', 'mp-window mp-window-wide');
    root.appendChild(win);
    win.appendChild(h('div', 'mp-title', 'Multiplayer Lobby — hosting'));
    const share = h('div', 'mp-share');
    share.dataset.mp = 'addresses';
    const list = addresses.filter((a) => a.family === 'IPv4').map((a) => `${a.address}:${port}`);
    share.textContent = list.length > 0 ? `Players join with: ${list.join('   ')}   (port ${port}; on this PC: 127.0.0.1:${port})` : `Listening on port ${port}. No network address found; on this PC join with 127.0.0.1:${port}.`;
    win.appendChild(share);
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
        lobby.setSettings(settingsSummary(options));
    });
    const startBtn = button('Start Game', 'start', () => void start(), 'mp-btn mp-btn-primary');
    const leaveBtn = button('Close Lobby', 'leave', () => {
        lobby.close();
        ep.onIncoming = null;
        void ep.stopHost();
        root.remove();
        openMultiplayerScreen(deps, onBack);
    }, 'mp-btn mp-btn-secondary');
    bar.append(settingsBtn, loadBtn, newBtn, startBtn, leaveBtn);
    win.append(status, bar);
    document.body.appendChild(root);

    const own = ownRowEditor(gameData, true, (pick) => lobby.setHostPick(pick));
    function render(state: LobbyState): void {
        const me = state.players.find((p) => p.slot === 0)!;
        own.set(me.pick, me.claim, true, state);
        renderPlayers(table, state, 0, own, gameData);
        settingsBox.replaceChildren(h('div', 'mp-subtitle', state.loaded !== null ? `Saved game: ${state.loaded.name}` : 'Game settings'), ...state.settings.map((l) => h('div', 'mp-setting', l)));
        const blocker = lobby.startBlocker();
        startBtn.disabled = blocker !== null;
        status.textContent = blocker ?? 'Everyone is ready.';
        newBtn.hidden = state.loaded === null;
        settingsBtn.hidden = state.loaded !== null;
    }
    lobby.setSettings(settingsSummary(options));
    // Scripts (a LAN test without clicking through the wizard): patch the settings as the wizard would.
    (window as unknown as { __dwuMpLobby?: unknown }).__dwuMpLobby = {
        patchSettings: (patch: Partial<StartGameOptions>) => {
            options = { ...options, ...structuredClone(patch) };
            lobby.setSettings(settingsSummary(options));
        },
        state: () => lobby.state(),
        fingerprint: () => ({ ...lobby.fingerprint }),
        files: () => fingerprintFiles(),
    };

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
                lobby.setSettings(settingsSummary(options));
            }
        } finally {
            root.hidden = false;
        }
    }

    async function loadSave(): Promise<void> {
        root.hidden = true;
        try {
            const save = await deps.pickSave();
            if (save === null) return;
            loaded = save;
            const humans = humanEmpires(save.game.galaxy);
            lobby.setLoaded({ name: save.name, humans: humans.map((e, i) => ({ humanIndex: i, empireName: e.name, playerName: save.players?.[i] ?? '' })) });
            const extra = humans.length < 2 ? ['This save has one human empire: the other players need a LAN save (or start a new game).'] : [];
            lobby.setSettings([`${humans.length} human empire${humans.length === 1 ? '' : 's'}: ${humans.map((e) => e.name).join(', ')}`, ...settingsSummary(save.startOptions).slice(0, 1), ...extra]);
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
        const links = lobby.start(start);
        delete (window as unknown as { __dwuMpLobby?: unknown }).__dwuMpLobby;
        ep.onIncoming = refuseLate;
        root.remove();
        try {
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
            const mp = MultiplayerGame.host(game, time, links as Map<number, Link>, {
                start,
                slot: 0,
                name: host.name,
                gameData: playData,
                startOptions: start.startOptions,
                onStatus: (s) => running?.banner.show(s),
                onDropped: (op, reason) => console.warn(`[lockstep] dropped ${op}: ${reason}`),
                log: (m) => console.info(`[lockstep] ${m}`),
            });
            await runGame(deps, mp, start, 0, host.name, start.startOptions, true, start.kind === 'new');
        } catch (err) {
            console.error('multiplayer: the game could not start', err);
            for (const l of links.values()) l.close('the host could not start the game');
            endMultiplayerSession('start failed');
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
    destroy(): void;
}

function openClientLobby(client: LobbyClient, gameData: GameData, address: string, onLeave: () => void): ClientLobbyScreen {
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
    win.append(status, bar);
    document.body.appendChild(root);
    const own = ownRowEditor(gameData, false, (pick, claim, ready) => client.setPick(pick, claim, ready));
    return {
        render(state) {
            const me = state.players.find((p) => p.slot === client.slot);
            if (me !== undefined) own.set(me.pick, me.claim, me.ready, state);
            renderPlayers(table, state, client.slot, own, gameData);
            settingsBox.replaceChildren(h('div', 'mp-subtitle', state.loaded !== null ? `Saved game: ${state.loaded.name}` : 'Game settings (chosen by the host)'), ...state.settings.map((l) => h('div', 'mp-setting', l)));
            status.textContent = me?.ready === true ? 'Ready. Waiting for the host to start…' : 'Tick Ready when your empire is set.';
        },
        destroy() {
            root.remove();
        },
    };
}

async function startAsClient(deps: MultiplayerAppDeps, start: MultiplayerStart, link: HandoffLink, slot: number, name: string, onBack: () => void): Promise<void> {
    const wait = h('div', 'mp-screen');
    wait.dataset.mp = 'starting';
    wait.appendChild(h('div', 'mp-window', start.kind === 'new' ? 'The host started the game. Building the galaxy…' : 'The host started the game. Receiving the saved game…'));
    document.body.appendChild(wait);
    let mp: MultiplayerGame | null = null;
    try {
        let game: Game | null = null;
        let time: GalaxyTime | null = null;
        let gameData: GameData;
        if (start.kind === 'new') {
            const built = await deps.buildGame(start.startOptions, start.createExtras);
            game = built.game;
            gameData = built.playData;
            time = new GalaxyTime();
            time.speed = start.clock.speed;
            time.paused = start.clock.paused;
        } else {
            gameData = deps.gameDataFor(start.scenario);
        }
        const replaced = (g: Game): void => {
            // A resync replaced the game: point the loop and the viewer at the new galaxy and rebuild the view.
            if (mp === null || running === null) return;
            setLockstepStepper(g.galaxy, mp.stepper);
            setLocalViewerEmpire(g.galaxy, mp.myEmpire());
            void deps.showGame(g, start.startOptions, { ...mp.session!.clock }, false);
        };
        mp = await MultiplayerGame.join(game, time, link, {
            start,
            slot,
            name,
            gameData,
            startOptions: start.startOptions,
            onStatus: (s) => running?.banner.show(s),
            onGameReplaced: (g) => replaced(g),
            onDropped: (op, reason) => console.warn(`[lockstep] dropped ${op}: ${reason}`),
            log: (m) => console.info(`[lockstep] ${m}`),
        });
        wait.remove();
        await runGame(deps, mp, start, slot, name, start.startOptions, false, start.kind === 'new');
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
