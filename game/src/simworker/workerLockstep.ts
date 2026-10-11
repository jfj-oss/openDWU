// Multiplayer in sim-worker mode (docs/MULTIPLAYER.md §11): the lockstep session runs in the worker, next to the sim it
// steps — LockstepSim.applyFrame / digest / save / load are synchronous calls on the game, so the session must live
// where the game lives. The worker's SimHost.tick asks the lockstep seam (net/lockstepSeam.ts) for a stepper exactly
// as the in-thread loop does (simLoop.ts), so a worker peer and an in-thread peer run the same frames.
//
// - The network links stay on the main thread (the desktop shell hands the page one MessagePort per connection; a
//   browser page holds its WebSocket). Their traffic is relayed: netIn / netClose in, netOut / netCloseOut out
//   (RelayLink here; ui/multiplayer/workerMultiplayer.ts on the main thread).
// - The UI's commands reach SimHost.command as in single-player; with the session's command sink on the galaxy
//   (GalaxyLockstepSim.attach) admitCommands hands them to the session, and each is answered when it applies.
// - A client whose game the session replaces (a resync, the save of a join or rejoin) gets a new SimHost over the new
//   game and the main thread a new replica (gameReplaced, then the snapshot): worker.ts replaceGame.
// - The main thread sees the session through mpState (on change and every MP_STATE_INTERVAL_MS) and mpCall / mpReply.
//
// DOM-free (a worker): only postMessage and timers.

import type { Game } from '../sim/game';
import type { GameData } from '../sim/data/gameData';
import type { GalaxyTime } from '../sim/galaxyTime';
import type { StartGameOptions } from '../sim/startGameOptions';
import type { PlayerOpName } from '../sim/player/playerOps';
import { humanSeats } from '../sim/humanEmpires';
import { issuePlayerCommand } from '../sim/player/playerCommands';
import { setLockstepStepper } from '../net/lockstepSeam';
import { MultiplayerGame, type MultiplayerGameOptions } from '../net/multiplayerGame';
import type { Link } from '../net/transport';
import { MP_STATE_INTERVAL_MS, type FromWorker, type MpCallMessage, type MpStartMessage, type MpWireState, type NetInMessage, type NetLinkMessage } from './protocol';

/** A lockstep Link whose other end is a main-thread link (relayed through the worker's message port). */
class RelayLink implements Link {
    onMessage: ((text: string) => void) | null = null;
    onClose: ((reason: string) => void) | null = null;
    private open = true;

    constructor(readonly id: number, private readonly post: (m: FromWorker) => void) {}

    get isOpen(): boolean {
        return this.open;
    }

    send(text: string): void {
        if (this.open) this.post({ type: 'netOut', link: this.id, text });
    }

    close(reason = 'closed'): void {
        if (!this.open) return;
        this.open = false;
        this.post({ type: 'netCloseOut', link: this.id, reason });
        this.onClose?.(reason);
    }

    /** The main thread's link delivered a message. */
    deliver(text: string): void {
        if (this.open) this.onMessage?.(text);
    }

    /** The main thread's link closed. */
    closed(reason: string): void {
        if (!this.open) return;
        this.open = false;
        this.onClose?.(reason);
    }
}

export interface WorkerLockstepEnv {
    post(m: FromWorker): void;
    /** The worker's current game (null: a client waiting for the welcome's save). */
    current(): { game: Game; time: GalaxyTime; startOptions: StartGameOptions } | null;
    gameData(): GameData;
    /** The session replaced the game: build the SimHost over it and send the new snapshot. */
    replaceGame(game: Game, time: GalaxyTime, startOptions: StartGameOptions): void;
    /** Run a tick soon (a frame may be runnable now). */
    kick(): void;
}

export class WorkerLockstep {
    mp: MultiplayerGame | null = null;
    private readonly links = new Map<number, RelayLink>();
    private stateTimer: ReturnType<typeof setInterval> | null = null;
    private lastState = '';
    private closed = false;

    constructor(private readonly env: WorkerLockstepEnv) {}

    /** The session's last log lines (debug: __dwuMp.log()). */
    private readonly logLines: string[] = [];

    private note(msg: string): void {
        console.info(`[lockstep] ${msg}`);
        this.logLines.push(`${new Date().toISOString().slice(11, 23)} ${msg}`);
        if (this.logLines.length > 300) this.logLines.shift();
    }

    /** Start the session (MpStartMessage). */
    start(m: MpStartMessage): void {
        const relay = (id: number): RelayLink => {
            let l = this.links.get(id);
            if (l === undefined) this.links.set(id, (l = new RelayLink(id, (x) => this.env.post(x))));
            return l;
        };
        const cur = this.env.current();
        const opts: MultiplayerGameOptions = {
            start: m.start,
            slot: m.slot,
            name: m.name,
            gameData: this.env.gameData(),
            startOptions: cur?.startOptions ?? m.start.startOptions,
            onStatus: () => this.postState(true),
            onGameReplaced: (game, time) => {
                const mp = this.mp;
                // (During the join, before `mp` is set: the join's own step below points the stepper.)
                if (mp !== null) setLockstepStepper(game.galaxy, mp.stepper);
                this.env.replaceGame(game, time, mp?.sim.currentStartOptions ?? opts.startOptions);
            },
            onDropped: (op, reason) => this.note(`dropped ${op}: ${reason}`),
            log: (msg) => this.note(msg),
            ...(m.adaptiveDelay === true ? { adaptiveDelay: {} } : {}),
        };
        const reply = (value?: unknown, error?: string): void => this.env.post({ type: 'mpReply', id: m.id, ...(value !== undefined ? { value } : {}), ...(error !== undefined ? { error } : {}) });
        if ((m.role ?? (m.slot === 0 ? 'host' : 'client')) === 'host') {
            if (cur === null) {
                reply(undefined, 'the host has no game');
                return;
            }
            const links = new Map<number, Link>(m.links.map((l) => [l.slot, relay(l.link)]));
            this.mp = MultiplayerGame.host(cur.game, cur.time, links, opts);
            setLockstepStepper(cur.game.galaxy, this.mp.stepper);
            this.startState();
            reply('started');
            return;
        }
        const hostLink = m.links[0];
        if (hostLink === undefined) {
            reply(undefined, 'no link to the host');
            return;
        }
        const have = m.have && cur !== null;
        MultiplayerGame.join(have ? cur!.game : null, have ? cur!.time : null, relay(hostLink.link), opts).then(
            (mp) => {
                this.mp = mp;
                if (mp.sim.game !== null) setLockstepStepper(mp.sim.galaxy, mp.stepper);
                this.startState();
                reply('joined');
                this.env.kick();
            },
            (err: unknown) => reply(undefined, err instanceof Error ? err.message : String(err)),
        );
    }

    /** A relayed link's traffic from the main thread. */
    net(m: NetInMessage): void {
        const l = this.links.get(m.link);
        if (l === undefined) return;
        if (m.type === 'netIn') l.deliver(m.text);
        else {
            l.closed(m.reason);
            this.links.delete(m.link);
        }
        // An input may make a stalled frame runnable: tick without waiting for the timer.
        if (this.mp?.session?.stalled === true) this.env.kick();
    }

    /** A link for the session: a rejoining player's (host), or a host migration's backup link (§16). */
    rejoinLink(m: NetLinkMessage): void {
        const l = new RelayLink(m.link, (x) => this.env.post(x));
        this.links.set(m.link, l);
        if (this.mp === null) l.close('no session');
        else if (m.mode === 'migrant') this.mp.acceptMigrant(l);
        else if (m.mode === 'newHost') this.mp.migrateTo(l, m.slot);
        else if (m.mode === 'join' && m.join !== undefined) this.mp.acceptNewPlayer(l, m.slot, Number(m.join.empireId), String(m.join.name));
        else this.mp.acceptRejoin(l, m.slot);
        this.postState(true);
        this.env.kick();
    }

    /** A call from the main thread (pause, speed, the host's decisions, the debug hook). */
    call(m: MpCallMessage): void {
        let value: unknown;
        let error: string | undefined;
        try {
            value = this.run(m.fn, m.args);
        } catch (err) {
            error = err instanceof Error ? err.message : String(err);
        }
        if (value instanceof Promise) {
            value.then(
                (v: unknown) => this.env.post({ type: 'mpReply', id: m.id, value: v }),
                (err: unknown) => this.env.post({ type: 'mpReply', id: m.id, error: err instanceof Error ? err.message : String(err) }),
            );
            return;
        }
        this.env.post({ type: 'mpReply', id: m.id, ...(value !== undefined ? { value } : {}), ...(error !== undefined ? { error } : {}) });
        this.postState(true);
        this.env.kick();
    }

    private run(fn: string, args: unknown[]): unknown {
        const mp = this.mp;
        if (fn === 'close') {
            this.close(String(args[0] ?? 'left the game'));
            return true;
        }
        if (fn === 'log') return [...this.logLines];
        if (mp === null || mp.session === null) throw new Error('no session');
        const s = mp.session;
        const galaxy = mp.sim.galaxy;
        switch (fn) {
            case 'pause':
                s.requestPause(args[0] === true);
                return true;
            case 'speed':
                s.setSpeed(Number(args[0]));
                return true;
            case 'ping':
                return s.ping();
            case 'digest':
                return mp.sim.digest();
            case 'decideAbsent':
                return mp.decideAbsent(Number(args[0]), args[1] === true);
            case 'promote':
                mp.promote((args[0] as number[]) ?? [], args[1] === undefined ? undefined : Number(args[1]));
                return true;
            case 'abandonMigration':
                mp.abandonMigration();
                return true;
            case 'inputDelay':
                s.setInputDelay(Number(args[0]));
                return true;
            case 'wantedDelay':
                return s.wantedDelay();
            case 'issue': {
                const me = mp.myEmpire();
                if (me === null) throw new Error('no empire');
                issuePlayerCommand(galaxy, me, String(args[0]) as PlayerOpName, (args[1] ?? []) as never);
                return true;
            }
            case 'renameOther': {
                const e = humanSeats(galaxy)[Number(args[0])];
                const ship = e?.builtObjects.find((b) => b != null);
                if (e === undefined || ship === undefined) throw new Error(`no human ${String(args[0])} with a ship`);
                issuePlayerCommand(galaxy, e, 'renameShip', [ship, String(args[1])]);
                return true;
            }
            case 'scriptStep': {
                const me = mp.myEmpire();
                const ship = me?.builtObjects.find((b) => b != null);
                if (me == null || ship === undefined) return null;
                const label = String(args[0]);
                issuePlayerCommand(galaxy, me, 'renameShip', [ship, label]);
                issuePlayerCommand(galaxy, me, 'addWaypoint', [Math.round(ship.xpos ?? 0), Math.round(ship.ypos ?? 0), `wp ${label}`]);
                return label;
            }
            case 'shipNames':
                return (mp.myEmpire()?.builtObjects ?? []).filter((b) => b != null).slice(0, 3).map((b) => b.name);
            case 'myEmpire':
                return mp.myEmpire()?.name ?? null;
            default:
                throw new Error(`unknown multiplayer call ${fn}`);
        }
    }

    private startState(): void {
        if (this.stateTimer !== null) return;
        this.postState(true);
        this.stateTimer = setInterval(() => this.postState(false), MP_STATE_INTERVAL_MS);
    }

    /** The session state for the main thread (always when `force`, else only when it changed). */
    postState(force: boolean): void {
        const mp = this.mp;
        if (mp === null || mp.session === null) return;
        const s = mp.session;
        const state: MpWireState = {
            role: mp.role,
            status: mp.currentStatus(),
            frame: s.frame,
            clock: { ...s.clock },
            stats: { ...s.stats },
            peers: s.peerList(),
            joined: mp.hasJoined,
            inputDelay: s.params.inputDelay,
            gameMs: mp.sim.game === null ? -1 : mp.sim.galaxy.nowMs,
            seats: mp.seats(),
            hostSlot: mp.hostSlot(),
        };
        // The frame / stats move every tick: compare the rest, but send at the interval anyway (the chip, the hook).
        const key = JSON.stringify({ ...state, frame: 0, stats: null, gameMs: 0 });
        if (!force && key === this.lastState && this.stateTimer === null) return;
        this.lastState = key;
        this.env.post({ type: 'mpState', state });
    }

    /** End the session (the main thread left the game, or the worker is disposed). */
    close(reason: string): void {
        if (this.closed) return;
        this.closed = true;
        if (this.stateTimer !== null) clearInterval(this.stateTimer);
        this.stateTimer = null;
        const mp = this.mp;
        if (mp !== null) {
            if (mp.sim.game !== null) setLockstepStepper(mp.sim.galaxy, null);
            mp.close(reason);
        }
        for (const l of this.links.values()) l.close(reason);
        this.links.clear();
    }
}
