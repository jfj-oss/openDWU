// A LAN game after the lobby (multiplayer Phase 3/4, docs/MULTIPLAYER.md §10, §12): the lockstep session (lockstep.ts)
// over the real game (lockstepSim.ts GalaxyLockstepSim), with
// - authorize: a peer may only command its own human empire. The peer's lobby slot is in its PeerInfo name (lobby.ts
//   peerName: the host wrote it), the slot's human index is in MultiplayerStart.players, and the empire is
//   humanSeats(galaxy)[humanIndex] at the command's frame (the seats keep their index while the AI runs one). The host
//   alone may hand a seat to the AI and back (setSeatAi). Every peer runs the same check on the same data.
// - the host waits at frame 0 until every lobby player has joined the session (or dropped): a client that built the
//   game itself joins with its frame-0 digest and gets no save (lockstep.ts hello `have`). The humans are createGame's
//   own (StartGameOptions.humanPlayers: the clients' lobby rows, in slot order), so human index = player order;
// - Phase 4: a player who drops pauses the game on the host, which decides: the AI runs that empire until they return
//   (setSeatAi, a journaled command: the same frame on every peer), or it stands idle (continue without them). The
//   player can reconnect to the same slot (acceptRejoin: the session's join with the current save); the AI hands the
//   empire back at the frame they rejoin from, and the drop's pause lifts.
// - status for the screen: waiting for players, resyncing, players away, the host is gone.
//
// Headless: no DOM / Pixi / Node APIs.

import type { Game } from '../sim/game';
import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import type { GameData } from '../sim/data/gameData';
import type { GalaxyTime } from '../sim/galaxyTime';
import type { StartGameOptions } from '../sim/startGameOptions';
import { humanSeats, isAiSeat } from '../sim/humanEmpires';
import { flatEmpireList } from '../sim/save/galaxySave';
import { issuePlayerCommand } from '../sim/player/playerCommands';
import { decodeCommandArg } from '../sim/player/commandCodec';
import { LockstepSession, type AdaptiveDelayOptions, type LockstepHooks } from './lockstep';
import { GalaxyLockstepSim, SessionStepper } from './lockstepSim';
import type { LockstepStepper } from './lockstepSeam';
import type { Link } from './transport';
import type { NetCommand, PeerId, PeerInfo } from './protocol';
import { peerName, slotOfPeerName, type MultiplayerStart } from './lobby';

/** A player whose peer left the running game (Phase 4). */
export interface AbsentPlayer {
    slot: number;
    name: string;
    reason: string;
    /** The AI runs their empire until they return. */
    ai: boolean;
    /** Host: chose what happens to their empire (AI or idle); a client: the AI runs it, or the game runs on. */
    decided: boolean;
}

export type MultiplayerStatus =
    | { kind: 'waiting'; missing: string[] }
    | { kind: 'running' }
    | { kind: 'resyncing'; who: string }
    | { kind: 'absent'; players: AbsentPlayer[]; paused: boolean }
    /** `deliberate`: the host quit (said goodbye); otherwise its link broke and this peer cannot tell whose network
     *  failed (a two-player game then waits for the player's choice: docs/MULTIPLAYER.md §21). */
    | { kind: 'hostLost'; reason: string; deliberate?: boolean }
    /** Host migration (§16): the host is gone and `newHost` (a lobby name) takes over; `self`: this peer does. */
    | { kind: 'migrating'; newHost: string; self: boolean };

export interface MultiplayerGameOptions {
    start: MultiplayerStart;
    /** This peer's lobby slot (0 = host). */
    slot: number;
    name: string;
    gameData: GameData;
    startOptions: StartGameOptions;
    onStatus?: (status: MultiplayerStatus) => void;
    /** A resync or the join save replaced the game: show the new one (and re-point the stepper: done here). */
    onGameReplaced?: (game: Game, time: GalaxyTime) => void;
    /** A command was refused or no longer resolves. */
    onDropped?: (op: string, reason: string) => void;
    log?: (message: string) => void;
    /** Host: the adaptive input delay (lockstep.ts AdaptiveDelayOptions); absent: the start's fixed delay. */
    adaptiveDelay?: AdaptiveDelayOptions;
}

/** The op that hands a human seat to the AI and back (sim/player/playerOps.ts setSeatAi). Host only. */
export const SEAT_AI_OP = 'setSeatAi';

/** The op that makes a new player's pick a human seat (sim/player/playerOps.ts addHumanSeat). Host only (§21). */
export const JOIN_SEAT_OP = 'addHumanSeat';

/** The human empire `slot` plays in `start` (null: a spectator / unknown slot / not in the game any more). */
export function empireOfSlot(galaxy: Galaxy, start: MultiplayerStart, slot: number): Empire | null {
    const p = start.players.find((x) => x.slot === slot);
    if (p === undefined) return null;
    return humanSeats(galaxy)[p.humanIndex] ?? null;
}

/** This screen's empire: its slot's seat, or (a new player before its first input frame: §21) the empire it takes over. */
export function myEmpireOf(galaxy: Galaxy, start: MultiplayerStart, slot: number): Empire | null {
    const own = empireOfSlot(galaxy, start, slot);
    if (own !== null || start.joining?.slot !== slot) return own;
    const id = start.joining.empireId;
    return flatEmpireList(galaxy).find((e) => e?.empireId === id) ?? null;
}

/**
 * A lockstep authorize(): `peer` may issue commands only for its slot's human empire; the host (`hostPeer()`: the hub of
 * the command's frame — peer 0, or after a host migration the new host) may also hand another player's seat to the AI
 * and back (setSeatAi).
 */
export function slotAuthorizer(galaxy: () => Galaxy, start: MultiplayerStart, peers: () => readonly PeerInfo[], hostPeer: () => PeerId = () => 0): (peer: PeerId, empireIndex: number, op: string) => boolean {
    return (peer, empireIndex, op) => {
        const info = peers().find((p) => p.id === peer);
        if (info === undefined) return false;
        const target = flatEmpireList(galaxy())[empireIndex];
        // A new player takes over an empire (§21): only the hub, for an empire nobody plays (the op checks the rest).
        if (op === JOIN_SEAT_OP) return peer === hostPeer() && target != null && !start.players.some((p) => empireOfSlot(galaxy(), start, p.slot) === target);
        if (op === SEAT_AI_OP) {
            if (peer !== hostPeer() || target == null) return false;
            const own = slotOfPeerName(info.name);
            return start.players.some((p) => p.slot !== own && empireOfSlot(galaxy(), start, p.slot) === target);
        }
        const empire = empireOfSlot(galaxy(), start, slotOfPeerName(info.name));
        return empire !== null && target === empire;
    };
}

/** The in-thread loop's stepper for a LAN game: SessionStepper, held at frame 0 on the host until everyone joined. */
class MultiplayerStepper implements LockstepStepper {
    private readonly inner: SessionStepper;
    constructor(private readonly game: MultiplayerGame) {
        this.inner = new SessionStepper(game.session!, game.sim);
    }
    tick(realDtMs: number, time: GalaxyTime): number {
        if (!this.game.allJoined()) {
            // Hold the HUD clock at the shared one while waiting.
            time.paused = this.game.session!.clock.paused;
            time.speed = this.game.session!.clock.speed;
            return 0;
        }
        const ran = this.inner.tick(realDtMs, time);
        this.game.afterFrames();
        return ran;
    }
}

/** One lobby slot of the running game (MpSeat in the worker protocol). */
export interface SeatState {
    slot: number;
    name: string;
    humanIndex: number;
    /** A peer for this slot is in the session now. */
    present: boolean;
    /** The AI runs this seat's empire (its player is away). */
    ai: boolean;
    empire: string;
}

/**
 * Host: which slot a reconnecting player gets back (by token first, else by lobby name among the absent players), or
 * why not. `hostSlot`: the host's own (never free). After a host migration the old host's slot can be rejoined too.
 */
export function rejoinSlotFor(seats: readonly SeatState[], hostSlot: number, name: string, token: string | undefined, tokens: ReadonlyMap<number, string>): { slot: number } | { refused: string } {
    const away = seats.filter((s) => s.slot !== hostSlot && !s.present);
    if (token !== undefined) {
        for (const [slot, t] of tokens) if (t === token && away.some((s) => s.slot === slot)) return { slot };
    }
    const byName = away.filter((s) => s.name.toLowerCase() === name.trim().toLowerCase());
    if (byName.length === 1) return { slot: byName[0].slot };
    return { refused: away.length === 0 ? 'The game has already started and every player is connected.' : `The game has already started. Only a disconnected player can rejoin (${away.map((s) => s.name).join(', ')}); use your name from the lobby.` };
}

/** The empires a new player may take over (MultiplayerGame.joinChoices): AI empires and human seats nobody plays. */
export function joinChoicesFor(galaxy: Galaxy, start: MultiplayerStart, taken: readonly number[]): Empire[] {
    const seats = humanSeats(galaxy);
    const played = new Set(start.players.map((p) => seats[p.humanIndex]).filter((e): e is Empire => e != null));
    const out: Empire[] = [];
    for (const e of seats) if (!played.has(e) && e.active && !taken.includes(e.empireId)) out.push(e);
    for (const e of galaxy.empires) {
        if (e == null || seats.includes(e) || !e.active || e === galaxy.independentEmpire || e.pirateEmpireBaseHabitat != null || taken.includes(e.empireId)) continue;
        if (e.colonies.length === 0) continue;
        out.push(e);
    }
    return out;
}

export class MultiplayerGame {
    readonly sim: GalaxyLockstepSim;
    session: LockstepSession | null = null;
    private readonly initialRole: 'host' | 'client';
    stepper: LockstepStepper | null = null;
    private status: MultiplayerStatus = { kind: 'running' };
    private statusKey = '';
    /** Host: the client slots expected at frame 0, and those whose link dropped before they joined. */
    private readonly expected: Map<number, string>;
    private readonly droppedBeforeJoin = new Set<number>();
    private joined = false;
    private resyncing = new Set<string>();
    private hostLost: string | null = null;
    private hostLostDeliberate = false;
    /** Host: the players whose peer left, by slot (until they rejoin). */
    private readonly absent = new Map<number, { reason: string; decided: boolean }>();
    /** Host: the game was paused for a drop (lifted when every absent player is decided or back). */
    private pausedForDrop = false;
    private lastPaused: boolean | null = null;
    /** Host migration (§16): the lobby name of the peer taking over (status 'migrating'), until it is done. */
    private migratingTo: { name: string; self: boolean } | null = null;
    /** Called when a host migration finished (this peer is a client of the new hub, or the hub). */
    onMigrated: ((hostSlot: number) => void) | null = null;

    private constructor(game: Game | null, time: GalaxyTime | null, private readonly opts: MultiplayerGameOptions, role: 'host' | 'client') {
        // (Not by slot: after a host migration the lobby's host, slot 0, can rejoin as a client.)
        this.initialRole = role;
        this.expected = new Map(opts.start.players.filter((p) => p.slot !== 0).map((p) => [p.slot, p.name]));
        const simOpts = {
            gameData: opts.gameData,
            startOptions: opts.startOptions,
            authorize: slotAuthorizer(() => this.sim.galaxy, opts.start, () => this.session?.peerList() ?? [], () => this.session?.hostPeerAt(this.session.frame) ?? 0),
            onGameReplaced: (g: Game, t: GalaxyTime) => this.opts.onGameReplaced?.(g, t),
            onApplied: (cmd: NetCommand) => {
                if (cmd.op === JOIN_SEAT_OP) this.seatJoined(cmd);
                if (cmd.op === SEAT_AI_OP || cmd.op === JOIN_SEAT_OP) queueMicrotask(() => this.refreshStatus());
            },
            onDropped: (cmd: { op: string }, reason: string) => this.opts.onDropped?.(cmd.op, reason),
        };
        this.sim = game !== null && time !== null ? new GalaxyLockstepSim(game, time, simOpts) : new GalaxyLockstepSim(null, null, simOpts);
    }

    /** 'host' for the hub (the lobby's host, or after a host migration the new one). */
    get role(): 'host' | 'client' {
        return this.session?.role ?? this.initialRole;
    }

    /** This peer's lobby slot. */
    get slot(): number {
        return this.opts.slot;
    }

    /** The lobby slot of the current hub (0 until a host migration). */
    hostSlot(): number {
        const s = this.session;
        if (s === null) return 0;
        const info = s.peerList().find((p) => p.id === s.hostPeer);
        return info === undefined ? 0 : slotOfPeerName(info.name);
    }

    /** The human empire this peer plays (in the current game). */
    myEmpire(): Empire | null {
        return this.sim.game === null ? null : myEmpireOf(this.sim.galaxy, this.opts.start, this.opts.slot);
    }

    get start(): MultiplayerStart {
        return this.opts.start;
    }

    private nameOfSlot(slot: number): string {
        return this.opts.start.players.find((p) => p.slot === slot)?.name ?? `player ${slot + 1}`;
    }

    /** The lobby slots of the running game: who, whether connected, whether the AI runs their empire. */
    seats(): SeatState[] {
        const peers = this.session?.peerList() ?? [];
        const galaxy = this.sim.game === null ? null : this.sim.galaxy;
        return this.opts.start.players.map((p) => {
            const empire = galaxy === null ? null : empireOfSlot(galaxy, this.opts.start, p.slot);
            const hub = p.slot === this.hostSlot();
            return {
                slot: p.slot,
                name: p.name,
                humanIndex: p.humanIndex,
                present: (hub && this.role === 'client' && this.hostLost !== null) ? false : peers.some((x) => x.leftFrom === null && slotOfPeerName(x.name) === p.slot),
                ai: galaxy !== null && empire !== null && isAiSeat(galaxy, empire),
                empire: empire?.name ?? '',
            };
        });
    }

    private hooks(): LockstepHooks {
        const nameOf = (peer: PeerInfo): string => {
            const slot = slotOfPeerName(peer.name);
            return this.opts.start.players.find((p) => p.slot === slot)?.name ?? peer.name.replace(/^\d+\|/, '');
        };
        const nameOfId = (id: PeerId): string => {
            const info = this.session?.peerList().find((p) => p.id === id);
            return info === undefined ? `peer ${id}` : nameOf(info);
        };
        return {
            log: this.opts.log,
            onPeerJoined: (peer) => {
                this.refreshWaiting();
                const slot = slotOfPeerName(peer.name);
                if (this.role === 'host' && this.absent.has(slot)) this.rejoined(slot);
                // A new player (§21): submitted now, the takeover rides on the host's next input — the frame the new
                // peer's input starts from — so the AI runs the empire up to that frame and the player from there on.
                const j = this.role === 'host' ? this.joining.get(slot) : undefined;
                if (j !== undefined && this.sim.game !== null) {
                    const empire = flatEmpireList(this.sim.galaxy).find((e) => e?.empireId === j.empireId) ?? null;
                    if (empire !== null) issuePlayerCommand(this.sim.galaxy, empire, JOIN_SEAT_OP, [slot, j.name]);
                }
                this.refreshStatus();
            },
            onPeerLeft: (peer, reason) => {
                const slot = slotOfPeerName(peer.name);
                if (this.role === 'host' && this.joined) {
                    // The host decides what happens to their empire (takeOver / standIdle); until then the game waits.
                    const still = this.session?.peerList().some((p) => p.leftFrom === null && slotOfPeerName(p.name) === slot) ?? false;
                    if (!still && slot >= 0 && slot !== this.opts.slot) {
                        this.absent.set(slot, { reason, decided: false });
                        // (As requested: a resume on its way counts as running.)
                        if (!this.session!.requestedClock().paused) this.pausedForDrop = true;
                        this.session?.setPaused(true);
                    }
                }
                this.refreshStatus();
            },
            onHostLost: (reason, deliberate) => {
                this.hostLost = reason;
                this.hostLostDeliberate = deliberate;
                this.refreshStatus();
            },
            onMigrated: () => {
                this.hostLost = null;
                this.migratingTo = null;
                const hub = this.hostSlot();
                this.opts.log?.(`host migration: ${this.nameOfSlot(hub)} is the host now`);
                this.refreshStatus();
                this.onMigrated?.(hub);
            },
            onResyncStart: () => {
                this.resyncing.add('you');
                this.refreshStatus();
            },
            onResync: (_frame, peer) => {
                if (this.role === 'client') this.resyncing.clear();
                else this.resyncing.add(nameOfId(peer));
                this.refreshStatus();
            },
            onDigest: (_frame, peer, ok) => {
                if (!ok || this.role !== 'host') return;
                if (this.resyncing.delete(nameOfId(peer))) this.refreshStatus();
            },
        };
    }

    /**
     * Every peer, at the frame the host's addHumanSeat applied (§21): the new player's slot now plays that seat (its
     * index in humanSeats, the same on every peer), so the session authorizes its commands from here on.
     */
    private seatJoined(cmd: NetCommand): void {
        if (this.sim.game === null) return;
        const galaxy = this.sim.galaxy;
        let slot = -1;
        let name = '';
        try {
            slot = Number(decodeCommandArg(galaxy, cmd.args[0]));
            name = String(decodeCommandArg(galaxy, cmd.args[1]) ?? '');
        } catch {
            return;
        }
        const empire = flatEmpireList(galaxy).find((e) => e?.empireId === cmd.empire) ?? null;
        const humanIndex = empire === null ? -1 : humanSeats(galaxy).indexOf(empire);
        if (!Number.isInteger(slot) || slot < 0 || humanIndex < 0) return;
        const players = this.opts.start.players;
        const p = players.find((x) => x.slot === slot);
        if (p !== undefined) p.humanIndex = humanIndex;
        else players.push({ slot, name: name.slice(0, 32) || `Player ${slot + 1}`, humanIndex });
        this.joining.delete(slot);
        if (this.opts.start.joining?.slot === slot) delete this.opts.start.joining;
        this.opts.log?.(`${name} plays ${empire!.name} from frame ${this.session?.frame ?? -1} (seat ${humanIndex})`);
    }

    /** Host: new players being let in (§21), by slot: the empire they take over at their first input frame. */
    private readonly joining = new Map<number, { empireId: number; name: string }>();

    /** Host: a NEW player's link (already handed to its new `slot`: lobby.ts slotHandoff); it joins with the save and
     *  takes `empireId` over at its first input frame (onPeerJoined issues addHumanSeat). */
    acceptNewPlayer(link: Link, slot: number, empireId: number, name: string): void {
        if (this.role !== 'host' || this.session === null) {
            link.close('not the host');
            return;
        }
        this.joining.set(slot, { empireId, name });
        this.opts.log?.(`${name} is joining (new player, slot ${slot})`);
        this.session.accept(link);
    }

    /** Host: the empires a new player may take over now (§21): the AI empires (not the independents, no pirate
     *  faction) and the human seats nobody plays; none being taken over by another joiner. */
    joinChoices(): Empire[] {
        if (this.role !== 'host' || this.sim.game === null) return [];
        return joinChoicesFor(this.sim.galaxy, this.opts.start, [...this.joining.values()].map((j) => j.empireId));
    }

    /** Host: a player came back (their slot has a peer again): the AI hands their empire back, the drop's pause lifts. */
    private rejoined(slot: number): void {
        this.absent.delete(slot);
        const empire = empireOfSlot(this.sim.galaxy, this.opts.start, slot);
        // Submitted now, it rides on the host's next input: the frame the rejoined peer's input starts from (lockstep.ts
        // admit), so the AI never runs a frame of a seat whose player is in the session.
        if (empire !== null && isAiSeat(this.sim.galaxy, empire)) issuePlayerCommand(this.sim.galaxy, empire, SEAT_AI_OP, [false]);
        this.opts.log?.(`${this.nameOfSlot(slot)} rejoined`);
        this.liftDropPause();
    }

    private liftDropPause(): void {
        if (!this.pausedForDrop) return;
        if ([...this.absent.values()].some((a) => !a.decided)) return;
        this.pausedForDrop = false;
        this.session?.setPaused(false);
    }

    /**
     * Host: the AI runs the empire of absent player `slot` until they return (true), or it stands idle (false: continue
     * without them). Either way the game resumes once no absent player is undecided (if the drop paused it).
     */
    decideAbsent(slot: number, ai: boolean): boolean {
        if (this.role !== 'host' || this.session === null) return false;
        const a = this.absent.get(slot);
        if (a === undefined) return false;
        const empire = empireOfSlot(this.sim.galaxy, this.opts.start, slot);
        if (empire === null) return false;
        a.decided = true;
        if (ai !== isAiSeat(this.sim.galaxy, empire)) issuePlayerCommand(this.sim.galaxy, empire, SEAT_AI_OP, [ai]);
        this.opts.log?.(`${this.nameOfSlot(slot)}'s empire: ${ai ? 'the AI takes over' : 'stands idle'}`);
        this.liftDropPause();
        this.refreshStatus();
        return true;
    }

    /** Host: which slot a reconnecting player gets back (by token first, else by name), or why not. */
    rejoinSlot(name: string, token: string | undefined, tokens: ReadonlyMap<number, string>): { slot: number } | { refused: string } {
        if (this.role !== 'host') return { refused: 'not the host' };
        return rejoinSlotFor(this.seats(), this.opts.slot, name, token, tokens);
    }

    /** Host: a reconnecting player's link (already handed to `slot`: lobby.ts slotHandoff). It joins with the save. */
    acceptRejoin(link: Link, slot: number): void {
        if (this.role !== 'host' || this.session === null) {
            link.close('not the host');
            return;
        }
        this.opts.log?.(`${this.nameOfSlot(slot)} is reconnecting`);
        this.session.accept(link);
    }

    // -----------------------------------------------------------------------------------------------------------------
    // Host migration (docs/MULTIPLAYER.md §16)
    // -----------------------------------------------------------------------------------------------------------------

    /**
     * The host is gone: this peer becomes the hub. `expectSlots`: the survivors' lobby slots that will report over their
     * backup links (acceptMigrant). The old host's slot then counts as an absent player (AI takes over or idle, as
     * any drop), and the old host can rejoin it.
     */
    promote(expectSlots: readonly number[], timeoutMs?: number): void {
        const s = this.session;
        if (s === null || s.role !== 'client') throw new Error('promote: not a client in a session');
        const peers = s.peerList().filter((p) => p.leftFrom === null && expectSlots.includes(slotOfPeerName(p.name)));
        this.joined = true;
        this.migratingTo = { name: this.nameOfSlot(this.opts.slot), self: true };
        this.refreshStatus();
        s.promoteToHost(peers.map((p) => p.id), timeoutMs);
    }

    /** New host: a survivor's backup link (it reports, then it is its session link). */
    acceptMigrant(link: Link): void {
        if (this.session === null || this.role !== 'host') {
            link.close('not the host');
            return;
        }
        this.session.acceptMigrant(link);
    }

    /** Survivor: play on with the peer at the other end of `link` (lobby slot `hostSlot`) as the hub. */
    migrateTo(link: Link, hostSlot: number): void {
        const s = this.session;
        if (s === null || s.role !== 'client') {
            link.close('not a client');
            return;
        }
        this.migratingTo = { name: this.nameOfSlot(hostSlot), self: false };
        this.refreshStatus();
        s.migrateTo(link);
    }

    /** A migration did not happen (no backup link): the screen shows the host as lost. */
    abandonMigration(): void {
        if (this.migratingTo === null) return;
        this.migratingTo = null;
        this.refreshStatus();
    }

    /** After the frames of a tick: the clock may have changed (status shows the pause). */
    afterFrames(): void {
        const paused = this.session?.clock.paused ?? false;
        if (paused === this.lastPaused) return;
        this.lastPaused = paused;
        // (The host may resume by hand while a player is away: their empire stands idle until it decides.)
        this.refreshStatus();
    }

    private computeStatus(): MultiplayerStatus {
        if (this.migratingTo !== null) return { kind: 'migrating', newHost: this.migratingTo.name, self: this.migratingTo.self };
        if (this.hostLost !== null) return { kind: 'hostLost', reason: this.hostLost, ...(this.hostLostDeliberate ? { deliberate: true } : {}) };
        if (this.role === 'host' && !this.joined) {
            const inSession = new Set((this.session?.peerList() ?? []).map((p) => slotOfPeerName(p.name)));
            const missing = [...this.expected].filter(([s]) => !inSession.has(s) && !this.droppedBeforeJoin.has(s)).map(([, n]) => n);
            if (missing.length > 0) return { kind: 'waiting', missing };
        }
        if (this.resyncing.size > 0) return { kind: 'resyncing', who: [...this.resyncing].join(', ') };
        const paused = this.session?.clock.paused ?? false;
        const players: AbsentPlayer[] = [];
        const hub = this.hostSlot();
        for (const s of this.seats()) {
            if (s.present || s.slot === hub) continue;
            if (this.role === 'host') {
                const a = this.absent.get(s.slot);
                const dropped = this.droppedBeforeJoin.has(s.slot);
                if (a === undefined && !dropped) continue;
                players.push({ slot: s.slot, name: s.name, reason: a?.reason ?? 'did not join', ai: s.ai, decided: a?.decided ?? true });
            } else {
                players.push({ slot: s.slot, name: s.name, reason: 'disconnected', ai: s.ai, decided: s.ai || !paused });
            }
        }
        if (players.length > 0) return { kind: 'absent', players, paused };
        return { kind: 'running' };
    }

    /** Recompute the status; tell the screen when it changed. */
    refreshStatus(): void {
        const s = this.computeStatus();
        const key = JSON.stringify(s);
        if (key === this.statusKey) return;
        this.statusKey = key;
        this.status = s;
        this.opts.onStatus?.(s);
    }

    currentStatus(): MultiplayerStatus {
        return this.status;
    }

    /** Host: every expected client is in the session (or dropped before it joined). */
    allJoined(): boolean {
        if (this.role === 'client' || this.joined) return true;
        const inSession = new Set((this.session?.peerList() ?? []).filter((p) => p.leftFrom === null).map((p) => slotOfPeerName(p.name)));
        const missing = [...this.expected.keys()].filter((s) => !inSession.has(s) && !this.droppedBeforeJoin.has(s));
        if (missing.length === 0) {
            this.joined = true;
            this.refreshStatus();
            return true;
        }
        return false;
    }

    /** Whether the game runs (host: everyone joined; a client: always, once welcomed). */
    get hasJoined(): boolean {
        return this.role === 'client' ? this.session !== null : this.joined;
    }

    private refreshWaiting(): void {
        if (this.role !== 'host' || this.joined) return;
        if (this.allJoined()) return;
        this.refreshStatus();
    }

    /**
     * Host: the session over `game` (already built or loaded, humans in place), taking over the lobby's links (by slot).
     * The loop does not step until everyone joined.
     */
    static host(game: Game, time: GalaxyTime, links: Map<number, Link>, opts: MultiplayerGameOptions): MultiplayerGame {
        const mp = new MultiplayerGame(game, time, opts, 'host');
        const s = LockstepSession.host(mp.sim, {
            name: peerName(0, opts.name),
            inputDelay: opts.start.params.inputDelay,
            digestInterval: opts.start.params.digestInterval,
            clock: opts.start.clock,
            hooks: mp.hooks(),
            ...(opts.adaptiveDelay !== undefined ? { adaptiveDelay: opts.adaptiveDelay } : {}),
        });
        mp.session = s;
        mp.sim.attach(s);
        for (const [slot, link] of links) {
            const prevClose = link.onClose;
            s.accept(link);
            // A link that drops before its hello: the host goes on without that player.
            const sessionClose = link.onClose;
            link.onClose = (reason) => {
                if (!(s.peerList().some((p) => slotOfPeerName(p.name) === slot))) {
                    mp.droppedBeforeJoin.add(slot);
                    mp.absent.set(slot, { reason, decided: true });
                    mp.refreshStatus();
                }
                sessionClose?.(reason);
                prevClose?.(reason);
            };
        }
        mp.stepper = new MultiplayerStepper(mp);
        mp.refreshWaiting();
        mp.refreshStatus();
        return mp;
    }

    /**
     * Client: join the host's session over `link`. With `game` (a new game built here from the same start) the hello
     * carries its frame-0 digest and no save travels; without (a loaded game, a rejoin), the welcome's save brings the
     * game (onGameReplaced).
     */
    static async join(game: Game | null, time: GalaxyTime | null, link: Link, opts: MultiplayerGameOptions): Promise<MultiplayerGame> {
        const mp = new MultiplayerGame(game, time, opts, 'client');
        const have = game !== null ? { frame: 0, digest: mp.sim.digest() } : undefined;
        const s = await LockstepSession.join(link, mp.sim, { name: peerName(opts.slot, opts.name), hooks: mp.hooks(), migratable: true, ...(have !== undefined ? { have } : {}) });
        mp.session = s;
        mp.sim.attach(s);
        mp.stepper = new MultiplayerStepper(mp);
        mp.refreshStatus();
        return mp;
    }

    /** Leave: the host ends the game for everyone, a client leaves it. */
    close(reason = 'left the game'): void {
        this.session?.close(reason);
        this.sim.attach(null);
    }
}
