// The lockstep integration seam (docs/MULTIPLAYER.md "Lockstep core"): a LockstepSim over a real game, and a stepper
// that lets the in-thread sim loop (src/simLoop.ts) be driven by a session instead of its own frame budget.
//
// - GalaxyLockstepSim: "step to frame F with these commands". It applies the frame's commands exactly as the command
//   queue does (issuePlayerCommand + flushPlayerCommands: applied at the boundary, journaled in the command log), then
//   runs one runSimFrame of nextFrameMs(speed) game ms — the same frame the app loop and the headless harness run —
//   or, while paused, none. No camera LOD pass: the camera differs per screen, so it cannot be a lockstep input (each
//   peer would run a different pass).
// - Local commands: while attached, the galaxy's player commands go to the session (setRemoteCommandSink, the hook the
//   sim worker's replica uses) instead of the local queue. Each is encoded with the command-log codec at issue time and
//   applied on every peer at frame + inputDelay; its onApplied runs then, on the issuing peer.
// - Nothing here runs unless a session is attached: single-player is untouched.
//
// Headless: no DOM / Pixi / Node APIs.

import type { Game } from '../sim/game';
import { installGameStatics, registerGameHooks } from '../sim/game';
import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import type { GameData } from '../sim/data/gameData';
import type { GalaxyTime } from '../sim/galaxyTime';
import type { StartGameOptions } from '../sim/startGameOptions';
import { flatEmpireList } from '../sim/save/galaxySave';
import { deserializeGame, serializeGame } from '../sim/save/gameSave';
import { stateDigest } from '../sim/tick/digest';
import { nextFrameMs, runSimFrame, schedulerState } from '../sim/tick/scheduler';
import { encodeCommandArg, decodeCommandArg, type EncodedArg } from '../sim/player/commandCodec';
import { flushPlayerCommands, issuePlayerCommand, noteSimSpeed, noteSimViewRect, setRemoteCommandSink, type RemoteCommandSink } from '../sim/player/playerCommands';
import type { PlayerOpName } from '../sim/player/playerOps';
import type { LockstepSession, LockstepSim } from './lockstep';
import type { ClockState, NetCommand, PeerId } from './protocol';
import type { LockstepStepper } from './lockstepSeam';

export interface GalaxyLockstepOptions {
    /** Static data for loading a save (resync / join). */
    gameData: GameData;
    /** What serializeGame writes as the start options (a loaded save brings its own). */
    startOptions: StartGameOptions;
    /**
     * Whether `peer` may issue `op` for the empire at `empireIndex` (flatEmpireList). Every peer runs the same check on
     * the same data, so a refused command is dropped everywhere. Default: allow all.
     */
    authorize?: (peer: PeerId, empireIndex: number, op: string) => boolean;
    /** A resync / join replaced the game (the app must switch its views to the new galaxy). */
    onGameReplaced?: (game: Game, time: GalaxyTime) => void;
    /** A command was applied (stats). `local`: issued on this peer. */
    onApplied?: (cmd: NetCommand, frame: number, local: boolean) => void;
    /** A command was dropped (refused, or its arguments no longer resolve). */
    onDropped?: (cmd: NetCommand, reason: string) => void;
}

interface LocalCallbacks {
    onApplied?: (result: unknown) => void;
    onFailed?: (reason: string) => void;
}

export class GalaxyLockstepSim implements LockstepSim {
    private session: LockstepSession | null = null;
    private readonly callbacks = new Map<number, LocalCallbacks>();
    private readonly sink: RemoteCommandSink;
    private startOptions: StartGameOptions;

    game: Game;
    time: GalaxyTime;
    /** Built from its own copy of the game (the host, or a client from the same seed / save). */
    constructor(game: Game, time: GalaxyTime, opts: GalaxyLockstepOptions);
    /** A joiner without a game yet: the welcome's save brings it (load). */
    constructor(game: null, time: null, opts: GalaxyLockstepOptions);
    constructor(game: Game | null, time: GalaxyTime | null, private readonly opts: GalaxyLockstepOptions) {
        this.startOptions = opts.startOptions;
        this.game = game as Game;
        this.time = time as GalaxyTime;
        if (game !== null && time !== null) time.bindGalaxy(game.galaxy);
        this.sink = (empire, op, args, onApplied, onFailed) => this.issueLocal(empire, op, args, onApplied, onFailed);
    }

    get galaxy(): Galaxy {
        if (this.game === null) throw new Error('lockstep: no game yet (a joiner gets it with the welcome)');
        return this.game.galaxy;
    }

    /** Route this galaxy's player commands to `session` (null: back to the local queue). */
    attach(session: LockstepSession | null): void {
        this.session = session;
        if (this.game !== null) setRemoteCommandSink(this.galaxy, session === null ? null : this.sink);
    }

    private issueLocal(empire: Empire, op: PlayerOpName, args: unknown[], onApplied?: (r: unknown) => void, onFailed?: (reason: string) => void): void {
        const session = this.session;
        const fail = (reason: string): void => {
            if (onFailed !== undefined) queueMicrotask(() => onFailed(reason));
            else console.warn(`lockstep: command ${op} not sent: ${reason}`);
        };
        if (session === null || !session.active) return fail('no lockstep session');
        const empireIndex = flatEmpireList(this.galaxy).indexOf(empire);
        if (empireIndex < 0) return fail('the issuing empire is not in the game');
        let encoded: EncodedArg[];
        try {
            encoded = args.map((a) => encodeCommandArg(this.galaxy, a));
        } catch (err) {
            // Not encodable = not replayable on the other peers: refuse it rather than desync.
            return fail(err instanceof Error ? err.message : String(err));
        }
        const { seq } = session.submit(empireIndex, op, encoded);
        if (onApplied !== undefined || onFailed !== undefined) this.callbacks.set(seq, { onApplied, onFailed });
    }

    applyFrame(frame: number, cmds: readonly NetCommand[], clock: ClockState): void {
        const galaxy = this.galaxy;
        const localPeer = this.session?.localPeer ?? -1;
        if (cmds.length > 0) {
            const empires = flatEmpireList(galaxy);
            // Queue the frame's commands on the real queue (sink off), then drain with the sink back on: a command an
            // onApplied callback issues goes to the session (a later frame), never only to this peer's queue.
            setRemoteCommandSink(galaxy, null);
            try {
                for (const cmd of cmds) {
                    const local = cmd.peer === localPeer;
                    const cb = local ? this.callbacks.get(cmd.seq) : undefined;
                    if (local) this.callbacks.delete(cmd.seq);
                    const empire = empires[cmd.empire];
                    let reason: string | null = null;
                    let args: unknown[] = [];
                    if (empire === undefined) reason = `no empire ${cmd.empire}`;
                    else if (this.opts.authorize !== undefined && !this.opts.authorize(cmd.peer, cmd.empire, cmd.op)) reason = `peer ${cmd.peer} may not issue ${cmd.op} for empire ${cmd.empire}`;
                    else {
                        try {
                            args = cmd.args.map((a) => decodeCommandArg(galaxy, a));
                        } catch (err) {
                            reason = `arguments no longer resolve: ${err instanceof Error ? err.message : String(err)}`;
                        }
                    }
                    if (reason !== null) {
                        this.opts.onDropped?.(cmd, reason);
                        if (cb?.onFailed !== undefined) {
                            const f = cb.onFailed;
                            queueMicrotask(() => f(reason!));
                        }
                        continue;
                    }
                    issuePlayerCommand(galaxy, empire!, cmd.op as PlayerOpName, args as never, (result: unknown) => {
                        this.opts.onApplied?.(cmd, frame, local);
                        cb?.onApplied?.(result);
                    }, cb?.onFailed);
                }
            } finally {
                setRemoteCommandSink(galaxy, this.session !== null ? this.sink : null);
            }
            flushPlayerCommands(galaxy);
        }
        // The HUD clock follows the shared one.
        this.time.speed = clock.speed;
        this.time.paused = clock.paused;
        if (clock.paused) return;
        noteSimSpeed(galaxy, clock.speed);
        noteSimViewRect(galaxy, null);
        runSimFrame(galaxy, nextFrameMs(schedulerState(galaxy), clock.speed));
    }

    digest(): string {
        return stateDigest(this.galaxy);
    }

    save(clock: ClockState): string {
        this.time.speed = clock.speed;
        this.time.paused = clock.paused;
        return serializeGame(this.game, this.time, this.startOptions);
    }

    load(save: string): void {
        if (this.game !== null) setRemoteCommandSink(this.galaxy, null);
        // A process that never ran createGame (a joiner) needs the static tables and hooks (gameCache.ts does the same).
        installGameStatics(this.opts.gameData);
        registerGameHooks();
        const { game, time, startOptions } = deserializeGame(save, this.opts.gameData);
        this.game = game;
        this.time = time;
        this.startOptions = startOptions;
        time.bindGalaxy(game.galaxy);
        if (this.session !== null) setRemoteCommandSink(game.galaxy, this.sink);
        this.opts.onGameReplaced?.(game, time);
    }
}

/**
 * Drive the in-thread sim loop from a session (src/simLoop.ts calls tick() instead of its frame budget while one is
 * set: lockstepSeam.ts). The HUD's speed / pause buttons become host clock changes (or, on a client, pause requests).
 */
export class SessionStepper implements LockstepStepper {
    private seen: ClockState | null = null;

    constructor(readonly session: LockstepSession, readonly sim: GalaxyLockstepSim) {}

    tick(realDtMs: number, time: GalaxyTime): number {
        const s = this.session;
        // A HUD change since the last tick (the frames reset time.* to the shared clock): ask for it.
        if (this.seen !== null) {
            if (time.paused !== this.seen.paused) s.requestPause(time.paused);
            if (time.speed !== this.seen.speed && s.role === 'host') s.setSpeed(time.speed);
        }
        const before = s.stats.framesRun;
        s.update(realDtMs);
        const ran = s.stats.framesRun - before;
        this.sim.time.speed = s.clock.speed;
        this.sim.time.paused = s.clock.paused;
        if (time !== this.sim.time) {
            time.speed = s.clock.speed;
            time.paused = s.clock.paused;
        }
        this.seen = { speed: time.speed, paused: time.paused };
        return s.clock.paused ? 0 : ran;
    }
}
