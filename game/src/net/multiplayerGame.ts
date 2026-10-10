// A LAN game after the lobby (multiplayer Phase 3, docs/MULTIPLAYER.md §10): the lockstep session (lockstep.ts) over the
// real game (lockstepSim.ts GalaxyLockstepSim), with
// - authorize: a peer may only command its own human empire. The peer's lobby slot is in its PeerInfo name (lobby.ts
//   peerName: the host wrote it), the slot's human index is in MultiplayerStart.players, and the empire is
//   galaxy.humanEmpires[humanIndex] at the command's frame. Every peer runs the same check on the same data.
// - the host waits at frame 0 until every lobby player has joined the session (or dropped): a client that built the
//   game itself joins with its frame-0 digest and gets no save (lockstep.ts hello `have`);
// - status for the screen: waiting for players, resyncing, a player left (the host pauses), the host is gone.
//
// Headless: no DOM / Pixi / Node APIs.

import type { Game } from '../sim/game';
import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import type { GameData } from '../sim/data/gameData';
import type { GalaxyTime } from '../sim/galaxyTime';
import type { StartGameOptions } from '../sim/startGameOptions';
import { humanEmpires, setHumanEmpires } from '../sim/humanEmpires';
import { flatEmpireList } from '../sim/save/galaxySave';
import { LockstepSession, type LockstepHooks } from './lockstep';
import { GalaxyLockstepSim, SessionStepper } from './lockstepSim';
import type { LockstepStepper } from './lockstepSeam';
import type { Link } from './transport';
import type { PeerId, PeerInfo } from './protocol';
import { peerName, slotOfPeerName, type MultiplayerStart } from './lobby';

export type MultiplayerStatus =
    | { kind: 'waiting'; missing: string[] }
    | { kind: 'running' }
    | { kind: 'resyncing'; who: string }
    | { kind: 'peerLeft'; name: string; reason: string }
    | { kind: 'hostLost'; reason: string };

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
}

/**
 * Until createGame founds the lobby's humans itself (multiplayer Phase 1, `StartGameOptions.humanPlayers` →
 * CreateGameOptions.humanPlayers), make the first AI empires (galaxy.empires order, no pirates) the missing humans, as
 * the lockstep demo does. Deterministic: every peer runs it on the same fresh game. No-op once createGame did it.
 * TODO(mp-phase1): drop this fallback once origin/main's createGame takes N humans (it then never triggers).
 */
export function ensureMultiplayerHumans(galaxy: Galaxy, count: number): void {
    const humans = [...humanEmpires(galaxy)];
    if (humans.length >= count || galaxy.playerEmpire === null) return;
    for (const e of galaxy.empires) {
        if (humans.length >= count) break;
        if (humans.includes(e) || e.pirateEmpireBaseHabitat !== null) continue;
        humans.push(e);
    }
    setHumanEmpires(galaxy, humans);
}

/** The human empire `slot` plays in `start` (null: a spectator / unknown slot / not in the game any more). */
export function empireOfSlot(galaxy: Galaxy, start: MultiplayerStart, slot: number): Empire | null {
    const p = start.players.find((x) => x.slot === slot);
    if (p === undefined) return null;
    return humanEmpires(galaxy)[p.humanIndex] ?? null;
}

/** A lockstep authorize(): `peer` may issue commands only for its slot's human empire. */
export function slotAuthorizer(galaxy: () => Galaxy, start: MultiplayerStart, peers: () => readonly PeerInfo[]): (peer: PeerId, empireIndex: number, op: string) => boolean {
    return (peer, empireIndex) => {
        const info = peers().find((p) => p.id === peer);
        if (info === undefined) return false;
        const empire = empireOfSlot(galaxy(), start, slotOfPeerName(info.name));
        return empire !== null && flatEmpireList(galaxy())[empireIndex] === empire;
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
        return this.inner.tick(realDtMs, time);
    }
}

export class MultiplayerGame {
    readonly sim: GalaxyLockstepSim;
    session: LockstepSession | null = null;
    readonly role: 'host' | 'client';
    stepper: LockstepStepper | null = null;
    private status: MultiplayerStatus = { kind: 'running' };
    /** Host: the client slots expected at frame 0, and those whose link dropped before they joined. */
    private readonly expected: Map<number, string>;
    private readonly droppedBeforeJoin = new Set<number>();
    private joined = false;
    private resyncing = new Set<string>();

    private constructor(game: Game | null, time: GalaxyTime | null, private readonly opts: MultiplayerGameOptions) {
        this.role = opts.slot === 0 ? 'host' : 'client';
        this.expected = new Map(opts.start.players.filter((p) => p.slot !== 0).map((p) => [p.slot, p.name]));
        const simOpts = {
            gameData: opts.gameData,
            startOptions: opts.startOptions,
            authorize: slotAuthorizer(() => this.sim.galaxy, opts.start, () => this.session?.peerList() ?? []),
            onGameReplaced: (g: Game, t: GalaxyTime) => this.opts.onGameReplaced?.(g, t),
            onDropped: (cmd: { op: string }, reason: string) => this.opts.onDropped?.(cmd.op, reason),
        };
        this.sim = game !== null && time !== null ? new GalaxyLockstepSim(game, time, simOpts) : new GalaxyLockstepSim(null, null, simOpts);
    }

    /** The human empire this peer plays (in the current game). */
    myEmpire(): Empire | null {
        return this.sim.game === null ? null : empireOfSlot(this.sim.galaxy, this.opts.start, this.opts.slot);
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
            onPeerJoined: () => this.refreshWaiting(),
            onPeerLeft: (peer, reason) => {
                // TODO(mp-phase4): rejoin for the same player, or hand the empire to the AI (docs/MULTIPLAYER.md §10).
                if (this.role === 'host') this.session?.setPaused(true);
                this.setStatus({ kind: 'peerLeft', name: nameOf(peer), reason });
            },
            onHostLost: (reason) => this.setStatus({ kind: 'hostLost', reason }),
            onResyncStart: () => this.setStatus({ kind: 'resyncing', who: 'you' }),
            onResync: (_frame, peer) => {
                if (this.role === 'client') this.setStatus({ kind: 'running' });
                else {
                    this.resyncing.add(nameOfId(peer));
                    this.setStatus({ kind: 'resyncing', who: [...this.resyncing].join(', ') });
                }
            },
            onDigest: (_frame, peer, ok) => {
                if (!ok || this.role !== 'host') return;
                if (this.resyncing.delete(nameOfId(peer)) && this.status.kind === 'resyncing') {
                    this.setStatus(this.resyncing.size > 0 ? { kind: 'resyncing', who: [...this.resyncing].join(', ') } : { kind: 'running' });
                }
            },
        };
    }

    private setStatus(s: MultiplayerStatus): void {
        // A disconnect stays on screen until the game ends (Phase 4 brings rejoin).
        if ((this.status.kind === 'hostLost' || this.status.kind === 'peerLeft') && s.kind !== 'hostLost') return;
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
            this.setStatus({ kind: 'running' });
            return true;
        }
        return false;
    }

    private refreshWaiting(): void {
        if (this.role !== 'host' || this.joined) return;
        if (this.allJoined()) return;
        const inSession = new Set((this.session?.peerList() ?? []).map((p) => slotOfPeerName(p.name)));
        this.setStatus({ kind: 'waiting', missing: [...this.expected].filter(([s]) => !inSession.has(s) && !this.droppedBeforeJoin.has(s)).map(([, n]) => n) });
    }

    /**
     * Host: the session over `game` (already built or loaded, humans in place), taking over the lobby's links (by slot).
     * The loop does not step until everyone joined.
     */
    static host(game: Game, time: GalaxyTime, links: Map<number, Link>, opts: MultiplayerGameOptions): MultiplayerGame {
        const mp = new MultiplayerGame(game, time, opts);
        const s = LockstepSession.host(mp.sim, { name: peerName(0, opts.name), inputDelay: opts.start.params.inputDelay, digestInterval: opts.start.params.digestInterval, clock: opts.start.clock, hooks: mp.hooks() });
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
                    mp.setStatus({ kind: 'peerLeft', name: opts.start.players.find((p) => p.slot === slot)?.name ?? `player ${slot + 1}`, reason });
                }
                sessionClose?.(reason);
                prevClose?.(reason);
            };
        }
        mp.stepper = new MultiplayerStepper(mp);
        mp.refreshWaiting();
        return mp;
    }

    /**
     * Client: join the host's session over `link`. With `game` (a new game built here from the same start) the hello
     * carries its frame-0 digest and no save travels; without (a loaded game), the welcome's save brings the game
     * (onGameReplaced).
     */
    static async join(game: Game | null, time: GalaxyTime | null, link: Link, opts: MultiplayerGameOptions): Promise<MultiplayerGame> {
        const mp = new MultiplayerGame(game, time, opts);
        const have = game !== null ? { frame: 0, digest: mp.sim.digest() } : undefined;
        const s = await LockstepSession.join(link, mp.sim, { name: peerName(opts.slot, opts.name), hooks: mp.hooks(), ...(have !== undefined ? { have } : {}) });
        mp.session = s;
        mp.sim.attach(s);
        mp.stepper = new MultiplayerStepper(mp);
        return mp;
    }

    /** Leave: the host ends the game for everyone, a client leaves it. */
    close(reason = 'left the game'): void {
        this.session?.close(reason);
        this.sim.attach(null);
    }
}
