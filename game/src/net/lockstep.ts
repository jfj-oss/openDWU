// Deterministic lockstep session (multiplayer Phase 3 core; docs/MULTIPLAYER.md "Lockstep core").
//
// Every peer runs the whole simulation. Peers exchange only their journaled player commands (protocol.ts NetCommand:
// the command-log entry fields of sim/player/commandLog.ts), each scheduled at `frame + inputDelay`. Frame F runs on a
// peer only once it knows every in-session peer's input for F — commands, or an empty "no input" ack — so all peers
// apply the same commands at the same frame boundary, in the same order (by peer id, then issue order).
//
// - Topology: a star. Clients send to the host; the host relays every input to the other clients. So the host knows
//   every input first, and its decisions on joins and leaves are consistent for everyone.
// - Clock: the host's inputs carry speed / pause changes, applied at their frame like a command. A client asks the
//   host to pause (requestPause). A paused frame still runs (it applies commands) but advances no game time. Nobody can
//   run past what the slowest peer has acked, so the game runs at the slowest peer's pace.
// - Desync: every `digestInterval` frames each peer takes stateDigest at that boundary; clients send theirs to the
//   host. On a mismatch the host sends that client a save of its current boundary (serializeGame) plus the inputs it
//   holds from there on; the client reloads it and continues (rewinding or skipping ahead as needed).
// - Join: a new client gets the host's current save and input buffer, and sends input from the first frame the host
//   has not sent yet.
// - A save on the wire (join, resync) is gzip-compressed (saveCompression.ts) and sent in base64 chunks (SaveChunkMsg)
//   ahead of the welcome / resync that names it. The host writes the save text at the boundary, synchronously, then
//   compresses it while it runs on; what it sends that link meanwhile waits behind the save, so the client still gets
//   everything in order. The client inflates it asynchronously and runs no frame, and handles no other message, until
//   it is loaded. Leave: when a client's link drops, the host ends it at the first frame it has no input for and
//   tells the others; the session goes on (onPeerLeft is the hook for Phase 4's AI takeover).
//
// The session is transport-agnostic (transport.ts Link) and sim-agnostic (LockstepSim below; lockstepSim.ts adapts
// a Galaxy). Nothing here touches the sim unless a session exists. Headless: no DOM / Pixi / Node APIs.

import { SAVE_CHUNK_BYTES, type ClockState, type DigestMsg, type FrameInput, type LockstepParams, type MigrateMsg, type MigratedMsg, type NetCommand, type NetMessage, type PeerId, type PeerInfo, type ResyncMsg, type WelcomeMsg, type WireSave } from './protocol';
import { base64ToBytes, bytesToBase64, gunzipText, gzipString } from '../saveCompression';
import type { Link } from './transport';
import type { EncodedArg } from '../sim/player/commandCodec';

/** What the session drives: a deterministic simulation stepped one frame at a time. */
export interface LockstepSim {
    /** Apply `cmds` (already in the shared order) at the boundary of `frame`, then run the frame at `clock` (no game time
     *  when paused). */
    applyFrame(frame: number, cmds: readonly NetCommand[], clock: ClockState): void;
    /** State digest at the current boundary (sim/tick/digest.ts stateDigest). */
    digest(): string;
    /** A full save at the current boundary (serializeGame). */
    save(clock: ClockState): string;
    /** Replace the state with a save (a resync or a join). */
    load(save: string): void;
}

export interface LockstepHooks {
    /** A peer is in the session from `peer.fromFrame` (the host and every client hear of it). */
    onPeerJoined?(peer: PeerInfo): void;
    /** A peer left: it sends no input from `fromFrame` on. Phase 4: hand its empire to the AI here. */
    onPeerLeft?(peer: PeerInfo, reason: string): void;
    /** A digest comparison (host: for each client; client: never). */
    onDigest?(frame: number, peer: PeerId, ok: boolean, host: string, client: string): void;
    /** Host: a resync save was sent to `peer`. Client: a resync save was loaded. `bytes`: its compressed size. */
    onResync?(frame: number, peer: PeerId, bytes: number): void;
    /** Client: the host's resync arrived; its save is being inflated and loaded (onResync follows, or the link closes). */
    onResyncStart?(frame: number): void;
    /** An input arrived from another peer (stats; `now` = wall epoch ms). */
    onInput?(input: FrameInput, now: number): void;
    /** Client: the host link closed; the session is over (or, with `migratable`, waits for a new host: §16). */
    onHostLost?(reason: string): void;
    /** Host migration (§16): this peer now plays on with `host` as the hub (the new host: once every survivor reported). */
    onMigrated?(host: PeerId): void;
    /** A frame ran (after applyFrame). */
    onFrame?(frame: number, clock: ClockState): void;
    log?(message: string): void;
}

/**
 * Host: raise or lower the input delay from the measured round trips (docs/MULTIPLAYER.md §13). The host pings every
 * client each `intervalMs`, keeps the worst of the last `window` round trips per client, and wants the delay to cover
 * the slowest path a command takes — client → host → another client, half of each round trip — plus `marginFrames`.
 * A raise is sent at once; a cut only after the lower value has been wanted `lowerAfter` times in a row. The change rides
 * on the host's input of a frame (FrameInput.delay), so every peer switches at that frame. Each frame keeps the one input
 * a peer sent for it, so a change can never apply a command twice or skip one: a raise sends empty acks for the gap, a
 * cut waits until the frame catches up with what was already sent.
 */
export interface AdaptiveDelayOptions {
    min?: number;
    max?: number;
    intervalMs?: number;
    window?: number;
    marginFrames?: number;
    lowerAfter?: number;
}

export interface LockstepOptions extends Partial<LockstepParams> {
    name?: string;
    hooks?: LockstepHooks;
    /** Real ms per frame (60 fps: the sim's FRAME_REAL_MS). */
    frameRealMs?: number;
    /** Frames update() may run in one call to catch up. */
    maxCatchUpFrames?: number;
    /** Frames of inputs kept behind the current one (a resync may rewind this far). */
    historyFrames?: number;
    /** Monotonic ms (performance.now) and wall epoch ms (command stamps). */
    now?: () => number;
    wallNow?: () => number;
    /** Host: whether a client's pause request is honoured (default: yes). */
    allowPauseRequest?: (peer: PeerId, paused: boolean) => boolean;
    /** Start clock (host; clients take the host's). Default 1x, running. */
    clock?: ClockState;
    /** Host: the adaptive input delay (absent: the fixed `inputDelay`). */
    adaptiveDelay?: AdaptiveDelayOptions;
    /**
     * Client: when the host link closes the session does not end: it waits (no frames run past what it holds) for a
     * new host — promoteToHost here, or migrateTo the new host's link (host migration, docs/MULTIPLAYER.md §16).
     */
    migratable?: boolean;
}

/** Frames of inputs a survivor reports behind its own frame (MigrateMsg): more than any two peers can be apart. */
const MIGRATE_BACK_FRAMES = 240;

export interface LockstepStats {
    framesRun: number;
    /** update() calls that wanted a frame but had to wait for a peer, and the real ms spent waiting. */
    stalls: number;
    stallMs: number;
    messagesSent: number;
    messagesReceived: number;
    bytesSent: number;
    bytesReceived: number;
    commandsSent: number;
    commandsApplied: number;
    digestChecks: number;
    digestMismatches: number;
    resyncs: number;
    /** Input-delay changes applied (the adaptive delay). */
    delayChanges: number;
}

interface PeerState {
    info: PeerInfo;
    inputs: Map<number, FrameInput>;
    /** Highest frame with a known input (inputs arrive in frame order). */
    knownThrough: number;
    /** Host side: the link to this client. */
    link: Link | null;
    /** Host side: resyncs sent to this client; its digests carry the count it has applied. */
    epoch: number;
    /** Host side: the client's digests not compared yet. */
    digests: Map<number, string>;
}

const DEFAULT_PARAMS: LockstepParams = { inputDelay: 4, digestInterval: 60 };

export class LockstepSession {
    /** 'client' until promoteToHost (host migration). */
    role: 'host' | 'client';
    /** This peer's id (0 for the host; a client learns it from welcome). */
    localPeer: PeerId;
    /** The next frame to run (= frames run so far, counted from the session's frame 0). */
    frame = 0;
    clock: ClockState;
    params: LockstepParams;
    readonly stats: LockstepStats = {
        framesRun: 0, stalls: 0, stallMs: 0, messagesSent: 0, messagesReceived: 0, bytesSent: 0, bytesReceived: 0,
        commandsSent: 0, commandsApplied: 0, digestChecks: 0, digestMismatches: 0, resyncs: 0, delayChanges: 0,
    };
    /** False once the session ended (client: the host link closed; host: close()). */
    active = true;

    private readonly peers = new Map<PeerId, PeerState>();
    /**
     * Who was the hub from which frame (host migration, §16): the clock and input-delay changes of frame F are read
     * from the input of hostPeerAt(F) only. Peer 0 from frame 0 until a migration appends the new host.
     */
    private readonly hosts: Array<{ peer: PeerId; from: number }> = [{ peer: 0, from: 0 }];
    /** Client, migratable: the host link closed and no new host yet. */
    orphaned = false;
    /** New host, while the survivors report (promoteToHost → finishMigration). */
    private migration: { oldHost: PeerId; from: number; expect: Set<PeerId>; reported: Map<PeerId, { link: Link; frame: number }>; timer: ReturnType<typeof setTimeout> | null } | null = null;
    /** Survivor: reported to the new host, waiting for its `migrated` (nothing is sent meanwhile); own inputs after `through` follow it. */
    private awaitingMigrated: { link: Link; through: number } | null = null;
    private readonly hooks: LockstepHooks;
    private readonly frameRealMs: number;
    private readonly maxCatchUp: number;
    private readonly history: number;
    private readonly now: () => number;
    private readonly wallNow: () => number;
    private readonly allowPause: (peer: PeerId, paused: boolean) => boolean;
    private readonly migratable: boolean;
    /** Highest frame this peer has sent input for. */
    private lastSent = -1;
    private seq = 0;
    private pendingCmds: NetCommand[] = [];
    /** Host: a clock change for the next input it sends. */
    private pendingClock: ClockState | null = null;
    /** Host: an input-delay change for the next input it sends (the adaptive delay). */
    private pendingDelay: number | null = null;
    private readonly adaptive: Required<AdaptiveDelayOptions> | null;
    /** Host, adaptive delay: the last round trips per client (ms), when the last probe went, cuts wanted in a row. */
    private readonly rtts = new Map<PeerId, number[]>();
    private lastProbeAt = -Infinity;
    private lowerWanted = 0;
    /** Host: own digests by frame. */
    private readonly ownDigests = new Map<number, string>();
    /** Client: resyncs applied. */
    private epoch = 0;
    private hostLink: Link | null = null;
    private nextPeerId = 1;
    private accumulator = 0;
    private stalledSince: number | null = null;
    private readonly name: string;
    private pingId = 0;
    private readonly pings = new Map<number, (rttMs: number) => void>();
    /** Host: links whose messages wait behind a save being compressed for them (sendSave). */
    private readonly held = new Map<Link, { jobs: number; queue: string[]; chain: Promise<void> }>();
    private nextSaveId = 1;
    /** Client: the chunks of the saves announced (SaveChunkMsg), by save id. */
    private readonly saveChunks = new Map<number, string[]>();
    /** Client: a save is being inflated and loaded; messages wait in `inbox` meanwhile. */
    private loading = false;
    private readonly inbox: NetMessage[] = [];
    /** Client: join()'s promise, until the welcome is applied. */
    private welcomeWaiter: { resolve: () => void; reject: (err: unknown) => void } | null = null;

    private constructor(role: 'host' | 'client', readonly sim: LockstepSim, opts: LockstepOptions) {
        this.role = role;
        this.localPeer = role === 'host' ? 0 : -1;
        this.params = { inputDelay: opts.inputDelay ?? DEFAULT_PARAMS.inputDelay, digestInterval: opts.digestInterval ?? DEFAULT_PARAMS.digestInterval };
        this.clock = { ...(opts.clock ?? { speed: 1, paused: false }) };
        this.hooks = opts.hooks ?? {};
        this.frameRealMs = opts.frameRealMs ?? 1000 / 60;
        this.maxCatchUp = opts.maxCatchUpFrames ?? 4;
        this.history = opts.historyFrames ?? 1200;
        this.now = opts.now ?? (() => performance.now());
        this.wallNow = opts.wallNow ?? (() => performance.timeOrigin + performance.now());
        this.allowPause = opts.allowPauseRequest ?? (() => true);
        this.migratable = opts.migratable === true;
        this.name = opts.name ?? (role === 'host' ? 'host' : 'client');
        const a = opts.adaptiveDelay;
        this.adaptive =
            role === 'host' && a !== undefined
                ? { min: a.min ?? 3, max: a.max ?? 30, intervalMs: a.intervalMs ?? 1000, window: a.window ?? 5, marginFrames: a.marginFrames ?? 2, lowerAfter: a.lowerAfter ?? 5 }
                : null;
    }

    // -----------------------------------------------------------------------------------------------------------
    // Setup
    // -----------------------------------------------------------------------------------------------------------

    /** A host session at frame 0 of `sim`. Clients join with host.accept(link). */
    static host(sim: LockstepSim, opts: LockstepOptions = {}): LockstepSession {
        const s = new LockstepSession('host', sim, opts);
        s.addPeer({ id: 0, name: s.name, fromFrame: 0, leftFrom: null }, null);
        return s;
    }

    /**
     * Join the host at the other end of `link`. With `have` (the client built the same game itself, at that frame) the
     * host skips the save when its own state still equals it; otherwise the client loads the host's save. Resolves
     * once welcomed.
     */
    static join(link: Link, sim: LockstepSim, opts: LockstepOptions & { have?: { frame: number; digest: string } } = {}): Promise<LockstepSession> {
        const s = new LockstepSession('client', sim, opts);
        s.hostLink = link;
        return new Promise((resolve, reject) => {
            s.welcomeWaiter = { resolve: () => resolve(s), reject };
            link.onMessage = (text) => {
                const m = s.decode(text);
                if (m !== null) s.clientReceive(m);
            };
            link.onClose = (reason) => {
                const w = s.welcomeWaiter;
                s.welcomeWaiter = null;
                w?.reject(new Error(`link closed before welcome: ${reason}`));
                s.hostClosed(reason);
            };
            s.sendTo(link, { t: 'hello', name: s.name, ...(opts.have !== undefined ? { have: opts.have } : {}) });
        });
    }

    /** Host: take a new incoming link (it must send hello first). */
    accept(link: Link): void {
        if (this.role !== 'host') throw new Error('accept: not the host');
        let peer: PeerState | null = null;
        link.onMessage = (text) => {
            const m = this.decode(text);
            if (m === null) return;
            if (peer === null) {
                if (m.t === 'hello') peer = this.admit(link, m.name, m.have);
                return;
            }
            this.onHostMessage(peer, m);
        };
        link.onClose = (reason) => {
            if (peer !== null) this.dropPeer(peer, reason);
        };
    }

    /** The last frame due could not run yet (an input is missing): an arriving input may make it runnable. */
    get stalled(): boolean {
        return this.stalledSince !== null;
    }

    /** The peers in the session (including left ones). */
    peerList(): PeerInfo[] {
        return [...this.peers.values()].map((p) => ({ ...p.info }));
    }

    // -----------------------------------------------------------------------------------------------------------
    // Local input and the clock
    // -----------------------------------------------------------------------------------------------------------

    /** Submit a local command (the issuing empire's stable key — GalaxyLockstepSim: empireId —, op, encoded args); it is applied at frame + inputDelay. Returns its seq. */
    submit(empire: number, op: string, args: EncodedArg[]): { peer: PeerId; seq: number } {
        const cmd: NetCommand = { peer: this.localPeer, seq: ++this.seq, empire, op, args, sentAt: this.wallNow() };
        this.pendingCmds.push(cmd);
        this.stats.commandsSent++;
        return { peer: cmd.peer, seq: cmd.seq };
    }

    /** Host: set the game speed (from the next frame the host sends input for). */
    setSpeed(speed: number): void {
        if (this.role !== 'host') {
            this.hooks.log?.('setSpeed: only the host sets the speed');
            return;
        }
        this.pendingClock = { speed, paused: (this.pendingClock ?? this.latestClock()).paused };
        this.hooks.log?.(`speed ${speed} requested at frame ${this.frame}`);
    }

    /** Host: pause / resume. A client asks the host instead (requestPause). */
    setPaused(paused: boolean): void {
        if (this.role !== 'host') {
            this.requestPause(paused);
            return;
        }
        this.pendingClock = { speed: (this.pendingClock ?? this.latestClock()).speed, paused };
        this.hooks.log?.(`${paused ? 'pause' : 'resume'} requested at frame ${this.frame} (speed ${this.pendingClock.speed})`);
    }

    /** Ask the host to pause / resume (any peer). */
    requestPause(paused: boolean): void {
        if (this.role === 'host') this.setPaused(paused);
        else if (this.hostLink !== null) this.sendTo(this.hostLink, { t: 'pauseRequest', paused });
    }

    /** Round-trip time to the host (client) or to `peer` (host), in ms. */
    ping(peer: PeerId = 0): Promise<number> {
        const link = this.role === 'client' ? this.hostLink : (this.peers.get(peer)?.link ?? null);
        if (link === null) return Promise.reject(new Error(`ping: no link to peer ${peer}`));
        const id = ++this.pingId;
        return new Promise((resolve) => {
            this.pings.set(id, resolve);
            this.sendTo(link, { t: 'ping', id, at: this.now() });
        });
    }

    /** Host: the clock as last requested (a change not sent or not applied yet included). */
    requestedClock(): ClockState {
        return { ...(this.pendingClock ?? this.latestClock()) };
    }

    /** The clock the host's last sent input set (or the running one). */
    private latestClock(): ClockState {
        for (let f = this.hostKnownThrough(); f >= this.frame; f--) {
            const c = this.hostInput(f)?.clock;
            if (c !== undefined) return c;
        }
        return this.clock;
    }

    /** The hub of frame `frame` (host migration: the new host from its first frame as host on). */
    hostPeerAt(frame: number): PeerId {
        let peer = this.hosts[0].peer;
        for (const h of this.hosts) if (frame >= h.from) peer = h.peer;
        return peer;
    }

    /** The current hub. */
    get hostPeer(): PeerId {
        return this.hosts[this.hosts.length - 1].peer;
    }

    /** The hub's input of `frame` (its clock / delay changes count). */
    private hostInput(frame: number): FrameInput | undefined {
        return this.peers.get(this.hostPeerAt(frame))?.inputs.get(frame);
    }

    /** The highest frame with an input from the current hub. */
    private hostKnownThrough(): number {
        return this.peers.get(this.hostPeer)?.knownThrough ?? this.frame - 1;
    }

    // -----------------------------------------------------------------------------------------------------------
    // Running frames
    // -----------------------------------------------------------------------------------------------------------

    /** Real-time drive: owe `realDtMs` more to the sim and run the frames that are due and runnable. Returns frames run. */
    update(realDtMs: number): number {
        if (!this.active) return 0;
        this.probeRoundTrips();
        this.accumulator = Math.min(this.accumulator + Math.max(0, realDtMs), this.frameRealMs * this.maxCatchUp);
        let ran = 0;
        while (this.accumulator >= this.frameRealMs) {
            if (!this.step()) break;
            this.accumulator -= this.frameRealMs;
            ran++;
        }
        return ran;
    }

    /** Host, adaptive delay: ping every client each intervalMs; each answer may move the delay (adaptDelay). */
    private probeRoundTrips(): void {
        const a = this.adaptive;
        if (a === null) return;
        const now = this.now();
        if (now - this.lastProbeAt < a.intervalMs) return;
        this.lastProbeAt = now;
        for (const p of this.peers.values()) {
            if (p.info.id === this.localPeer || p.link === null || p.info.leftFrom !== null) continue;
            // A peer still loading its welcome save answers late: not a round trip of the network.
            if (p.knownThrough < p.info.fromFrame + this.params.inputDelay) continue;
            const id = p.info.id;
            this.ping(id).then(
                (ms) => {
                    const list = this.rtts.get(id) ?? [];
                    list.push(ms);
                    if (list.length > a.window) list.shift();
                    this.rtts.set(id, list);
                    this.adaptDelay();
                },
                () => undefined,
            );
        }
    }

    /** The input delay the measured round trips want (adaptive delay; see AdaptiveDelayOptions). */
    wantedDelay(): number | null {
        const a = this.adaptive;
        if (a === null) return null;
        const worst: number[] = [];
        for (const [id, list] of this.rtts) {
            const p = this.peers.get(id);
            if (p === undefined || p.info.leftFrom !== null || list.length === 0) continue;
            worst.push(Math.max(...list));
        }
        worst.sort((x, y) => y - x);
        // The slowest path: a client's input to the host and on to the slowest other client (one way: half a round trip).
        const pathMs = ((worst[0] ?? 0) + (worst[1] ?? 0)) / 2;
        return Math.min(a.max, Math.max(a.min, Math.ceil(pathMs / this.frameRealMs) + a.marginFrames));
    }

    private adaptDelay(): void {
        const want = this.wantedDelay();
        if (want === null || !this.active) return;
        const cur = this.pendingDelay ?? this.latestDelay();
        if (want > cur) {
            this.lowerWanted = 0;
            this.pendingDelay = want;
        } else if (want < cur) {
            if (++this.lowerWanted >= this.adaptive!.lowerAfter) {
                this.lowerWanted = 0;
                this.pendingDelay = want;
            }
        } else this.lowerWanted = 0;
    }

    /** The delay the host's last sent input set (or the running one). */
    private latestDelay(): number {
        for (let f = this.hostKnownThrough(); f >= this.frame; f--) {
            const d = this.hostInput(f)?.delay;
            if (d !== undefined) return d;
        }
        return this.params.inputDelay;
    }

    /** Host: set the input delay from the next frame the host sends input for (every peer switches at that frame). */
    setInputDelay(frames: number): void {
        if (this.role !== 'host') return;
        this.pendingDelay = Math.max(1, Math.round(frames));
    }

    /** Run frames as fast as the inputs allow (up to `max`); returns frames run. Headless / benchmark drive. */
    runAvailable(max = Infinity): number {
        let ran = 0;
        while (ran < max && this.active && this.step()) ran++;
        return ran;
    }

    /** Run the next frame if every peer's input for it is known. */
    step(): boolean {
        if (!this.active || this.localPeer < 0 || this.loading) return false;
        this.sendThrough(this.frame + this.params.inputDelay);
        const f = this.frame;
        const order: PeerState[] = [];
        for (const p of this.peers.values()) {
            if (!inSession(p.info, f)) continue;
            if (!p.inputs.has(f)) {
                if (this.stalledSince === null) {
                    this.stalledSince = this.now();
                    this.stats.stalls++;
                }
                return false;
            }
            order.push(p);
        }
        if (this.stalledSince !== null) {
            this.stats.stallMs += this.now() - this.stalledSince;
            this.stalledSince = null;
        }
        order.sort((a, b) => a.info.id - b.info.id);
        const cmds: NetCommand[] = [];
        const hub = this.hostPeerAt(f);
        for (const p of order) {
            const input = p.inputs.get(f)!;
            if (p.info.id === hub && input.clock !== undefined) this.clock = { ...input.clock };
            if (p.info.id === hub && input.delay !== undefined && input.delay !== this.params.inputDelay) {
                this.params = { ...this.params, inputDelay: input.delay };
                this.stats.delayChanges++;
                this.hooks.log?.(`input delay ${input.delay} frames from frame ${f}`);
            }
            for (const c of input.cmds) cmds.push(c);
        }
        this.sim.applyFrame(f, cmds, this.clock);
        this.stats.commandsApplied += cmds.length;
        this.stats.framesRun++;
        this.frame = f + 1;
        this.hooks.onFrame?.(f, this.clock);
        if (this.frame % this.params.digestInterval === 0) this.takeDigest(this.frame);
        if (this.frame % 64 === 0) this.prune();
        return true;
    }

    /** Send this peer's inputs through `through` (empty acks for frames without commands). */
    private sendThrough(through: number): void {
        if (through <= this.lastSent) return;
        const list: FrameInput[] = [];
        for (let f = this.lastSent + 1; f <= through; f++) {
            const input: FrameInput = { frame: f, peer: this.localPeer, cmds: f === through ? this.pendingCmds : [] };
            if (f === through) {
                this.pendingCmds = [];
                if (this.role === 'host' && this.pendingClock !== null) {
                    input.clock = this.pendingClock;
                    this.pendingClock = null;
                }
                if (this.role === 'host' && this.pendingDelay !== null) {
                    if (this.pendingDelay !== this.latestDelay()) input.delay = this.pendingDelay;
                    this.pendingDelay = null;
                }
            }
            list.push(input);
            this.storeInput(input);
        }
        this.lastSent = through;
        if (this.role === 'host') this.broadcast({ t: 'inputs', list }, null);
        else if (this.hostLink !== null && this.awaitingMigrated === null) this.sendTo(this.hostLink, { t: 'inputs', list });
    }

    private storeInput(input: FrameInput): boolean {
        const p = this.peers.get(input.peer);
        if (p === undefined) return false;
        if (p.info.leftFrom !== null && input.frame >= p.info.leftFrom) return false;
        if (p.inputs.has(input.frame)) return false;
        p.inputs.set(input.frame, input);
        if (input.frame > p.knownThrough) p.knownThrough = input.frame;
        return true;
    }

    private takeDigest(frame: number): void {
        const d = this.sim.digest();
        if (this.role === 'host') {
            this.ownDigests.set(frame, d);
            for (const p of this.peers.values()) this.compareDigests(p);
        } else if (this.hostLink !== null && this.awaitingMigrated === null) {
            this.sendTo(this.hostLink, { t: 'digest', frame, digest: d, epoch: this.epoch });
        }
    }

    private prune(): void {
        const keep = this.frame - this.history;
        for (const p of this.peers.values()) for (const f of p.inputs.keys()) if (f < keep) p.inputs.delete(f);
        for (const f of this.ownDigests.keys()) if (f < keep) this.ownDigests.delete(f);
    }

    // -----------------------------------------------------------------------------------------------------------
    // Host side
    // -----------------------------------------------------------------------------------------------------------

    private addPeer(info: PeerInfo, link: Link | null): PeerState {
        const p: PeerState = { info, inputs: new Map(), knownThrough: info.fromFrame - 1, link, epoch: 0, digests: new Map() };
        this.peers.set(info.id, p);
        return p;
    }

    private admit(link: Link, name: string, have: { frame: number; digest: string } | undefined): PeerState {
        const id = this.nextPeerId++;
        // From the first frame the host has not sent input for: every peer learns of the join (peerJoined) before the
        // host input of that frame, so nobody can run it without waiting for the newcomer.
        const info: PeerInfo = { id, name, fromFrame: this.lastSent + 1, leftFrom: null };
        const p = this.addPeer(info, link);
        this.broadcast({ t: 'peerJoined', peer: { ...info } }, p);
        const skipSave = have !== undefined && have.frame === this.frame && have.digest === this.sim.digest();
        const welcome: WelcomeMsg = {
            t: 'welcome', peer: id, frame: this.frame, save: null, clock: { ...this.clock }, inputs: this.inputsFrom(this.frame),
            peers: this.peerList(), params: { ...this.params },
            ...(this.hosts.length > 1 ? { hosts: this.hosts.map((x) => ({ ...x })) } : {}),
        };
        if (skipSave) {
            this.sendTo(link, welcome);
            this.hooks.log?.(`peer ${id} (${name}) joined from frame ${info.fromFrame} (same state, no save)`);
        } else {
            // The save of this boundary, written now; compressed and sent (then the welcome) while the session runs on.
            const text = this.sim.save(this.clock);
            const frame = this.frame;
            this.sendSave(link, text, (save) => ({ ...welcome, save }), (save) => this.hooks.log?.(`peer ${id} (${name}) joined from frame ${info.fromFrame} with the save of frame ${frame} (${text.length} characters, ${save.bytes} bytes compressed)`));
        }
        this.hooks.onPeerJoined?.({ ...info });
        return p;
    }

    private inputsFrom(frame: number): FrameInput[] {
        const out: FrameInput[] = [];
        for (const p of this.peers.values()) for (const [f, input] of p.inputs) if (f >= frame) out.push(input);
        out.sort((a, b) => a.frame - b.frame || a.peer - b.peer);
        return out;
    }

    private onHostMessage(p: PeerState, m: NetMessage): void {
        switch (m.t) {
            case 'inputs': {
                const now = this.wallNow();
                const fresh: FrameInput[] = [];
                for (const raw of m.list) {
                    if (raw.peer !== p.info.id) continue; // a client speaks only for itself
                    // Only the hub changes the clock and the delay.
                    const input: FrameInput = raw.clock !== undefined || raw.delay !== undefined ? { frame: raw.frame, peer: raw.peer, cmds: raw.cmds } : raw;
                    if (this.storeInput(input)) {
                        fresh.push(input);
                        this.hooks.onInput?.(input, now);
                    }
                }
                if (fresh.length > 0) this.broadcast({ t: 'inputs', list: fresh }, p);
                return;
            }
            case 'digest':
                if (m.epoch !== p.epoch) return; // computed before its last resync
                p.digests.set(m.frame, m.digest);
                this.compareDigests(p);
                return;
            case 'pauseRequest':
                if (this.allowPause(p.info.id, m.paused)) {
                    this.hooks.log?.(`peer ${p.info.id} asks to ${m.paused ? 'pause' : 'resume'}`);
                    this.setPaused(m.paused);
                }
                return;
            case 'ping':
                this.sendTo(p.link!, { t: 'pong', id: m.id, at: m.at });
                return;
            case 'pong':
                this.pings.get(m.id)?.(this.now() - m.at);
                this.pings.delete(m.id);
                return;
            default:
                return;
        }
    }

    private compareDigests(p: PeerState): void {
        if (p.info.id === this.localPeer) return;
        for (const [frame, theirs] of p.digests) {
            const mine = this.ownDigests.get(frame);
            if (mine === undefined) {
                if (frame < this.frame - this.history) p.digests.delete(frame);
                continue;
            }
            p.digests.delete(frame);
            this.stats.digestChecks++;
            const ok = mine === theirs;
            this.hooks.onDigest?.(frame, p.info.id, ok, mine, theirs);
            if (!ok) {
                this.stats.digestMismatches++;
                this.hooks.log?.(`desync: peer ${p.info.id} at frame ${frame} (${theirs} != ${mine}); sending a save`);
                this.resync(p);
                return;
            }
        }
    }

    /** Host: send `p` a save of the current boundary and the inputs from there on. */
    private resync(p: PeerState): void {
        if (p.link === null) return;
        p.epoch++;
        p.digests.clear();
        const text = this.sim.save(this.clock);
        const frame = this.frame;
        const msg: Omit<ResyncMsg, 'save'> = { t: 'resync', frame, clock: { ...this.clock }, inputs: this.inputsFrom(frame), epoch: p.epoch, params: { ...this.params } };
        this.stats.resyncs++;
        this.sendSave(p.link, text, (save) => ({ ...msg, save }), (save) => this.hooks.onResync?.(frame, p.info.id, save.bytes));
    }

    /**
     * Host: send `text` (a save) to `link` gzip-compressed, as SaveChunkMsg pieces, then `message(save)`, and call
     * `sent`. The compression is asynchronous: whatever is sent to the link meanwhile is held and follows the save, in
     * order. A failure closes the link (the client cannot go on without the save).
     */
    private sendSave(link: Link, text: string, message: (save: WireSave) => NetMessage, sent?: (save: WireSave) => void): void {
        let h = this.held.get(link);
        if (h === undefined) {
            h = { jobs: 0, queue: [], chain: Promise.resolve() };
            this.held.set(link, h);
        }
        const hold = h;
        hold.jobs++;
        const id = this.nextSaveId++;
        let pending: string | null = text;
        hold.chain = hold.chain
            .then(async () => {
                const gz = new Uint8Array(await (await gzipString(pending!)).arrayBuffer());
                pending = null;
                const chunks = Math.max(1, Math.ceil(gz.length / SAVE_CHUNK_BYTES));
                for (let i = 0; i < chunks; i++) {
                    this.sendNow(link, JSON.stringify({ t: 'saveChunk', id, index: i, data: bytesToBase64(gz.subarray(i * SAVE_CHUNK_BYTES, (i + 1) * SAVE_CHUNK_BYTES)) } satisfies NetMessage));
                }
                const save: WireSave = { id, chunks, bytes: gz.length };
                this.sendNow(link, JSON.stringify(message(save)));
                sent?.(save);
            })
            .catch((err: unknown) => {
                pending = null;
                this.hooks.log?.(`a save could not be sent: ${err instanceof Error ? err.message : String(err)}`);
                link.close('save failed');
            })
            .finally(() => {
                if (--hold.jobs > 0) return;
                this.held.delete(link);
                for (const t of hold.queue) link.send(t);
            });
    }

    private dropPeer(p: PeerState, reason: string): void {
        if (p.info.leftFrom !== null) return;
        p.link = null;
        // Its inputs reach the others only through the host, so nobody holds one past what the host has.
        p.info.leftFrom = p.knownThrough + 1;
        for (const f of p.inputs.keys()) if (f >= p.info.leftFrom) p.inputs.delete(f);
        this.broadcast({ t: 'peerLeft', peer: p.info.id, fromFrame: p.info.leftFrom }, p);
        this.hooks.log?.(`peer ${p.info.id} left from frame ${p.info.leftFrom} (${reason})`);
        this.hooks.onPeerLeft?.({ ...p.info }, reason);
    }

    /** Host: drop a client (kick); the session goes on without it. */
    kick(peer: PeerId, reason = 'kicked'): void {
        const p = this.peers.get(peer);
        if (p === undefined || p.link === null) return;
        const link = p.link;
        this.dropPeer(p, reason);
        link.close(reason);
    }

    // -----------------------------------------------------------------------------------------------------------
    // Host migration (docs/MULTIPLAYER.md §16)
    // -----------------------------------------------------------------------------------------------------------

    /**
     * Client whose host is gone (or going): become the hub. `expect`: the survivors that will report over their backup
     * links (acceptMigrant); the old host and every in-session peer that has not reported when all of `expect` did (or
     * after `timeoutMs`) leave at the first frame nobody holds an input of theirs for, the same cut for everyone. This
     * peer's own inputs go on from the first frame it has not sent: its clock and delay changes count from there.
     */
    promoteToHost(expect: readonly PeerId[], timeoutMs = 10_000): void {
        if (this.role !== 'client' || this.localPeer < 0 || !this.active) throw new Error('promoteToHost: not a client in a session');
        const oldHost = this.hostPeer;
        this.hostLink?.close('the host changed');
        this.hostLink = null;
        this.orphaned = false;
        this.awaitingMigrated = null;
        this.role = 'host';
        const from = this.lastSent + 1;
        this.hosts.push({ peer: this.localPeer, from });
        this.nextPeerId = Math.max(...this.peers.keys()) + 1;
        this.ownDigests.clear();
        for (const p of this.peers.values()) {
            p.digests.clear();
            p.link = null;
        }
        const wanted = new Set(expect.filter((id) => id !== this.localPeer && id !== oldHost && this.peers.get(id)?.info.leftFrom === null));
        this.migration = { oldHost, from, expect: wanted, reported: new Map(), timer: null };
        this.hooks.log?.(`host migration: this peer (${this.localPeer}) is the hub from frame ${from}; waiting for ${wanted.size} survivor(s)`);
        if (wanted.size === 0) this.finishMigration();
        else this.migration.timer = setTimeout(() => this.finishMigration(), timeoutMs);
    }

    /** New host: a survivor's backup link (its first message is its MigrateMsg); after the migration, its session link. */
    acceptMigrant(link: Link): void {
        if (this.role !== 'host') throw new Error('acceptMigrant: not the host');
        let peer: PeerState | null = null;
        let reported = false;
        link.onMessage = (text) => {
            const m = this.decode(text);
            if (m === null) return;
            if (peer !== null) {
                this.onHostMessage(peer, m);
                return;
            }
            if (reported) return; // waits for finishMigration (it sends nothing meanwhile)
            if (m.t !== 'migrate') return;
            reported = true;
            this.onMigrateReport(link, m, (p) => (peer = p));
        };
        link.onClose = (reason) => {
            if (peer !== null) {
                this.dropPeer(peer, reason);
                return;
            }
            const mig = this.migration;
            if (mig === null) return;
            for (const [id, r] of mig.reported) if (r.link === link) mig.reported.delete(id);
        };
    }

    private onMigrateReport(link: Link, m: MigrateMsg, attached: (p: PeerState) => void): void {
        const mig = this.migration;
        const p = this.peers.get(m.peer);
        const refuse = (why: string): void => {
            this.hooks.log?.(`host migration: refused a report from peer ${m.peer}: ${why}`);
            this.sendNow(link, JSON.stringify({ t: 'bye', reason: why } satisfies NetMessage));
            link.close(why);
        };
        if (mig === null) return refuse('the migration is over: rejoin the game');
        if (p === undefined || p.info.leftFrom !== null || m.peer === this.localPeer || m.peer === mig.oldHost || mig.reported.has(m.peer)) return refuse('not a survivor of this session');
        // Inputs are immutable: what a survivor holds is what everyone got (storeInput keeps the first copy).
        for (const input of Array.isArray(m.inputs) ? m.inputs : []) {
            if (input !== null && typeof input === 'object' && Number.isInteger(input.frame) && this.peers.has(input.peer) && Array.isArray(input.cmds)) this.storeInput(input);
        }
        p.epoch = Number.isInteger(m.epoch) ? m.epoch : 0;
        mig.reported.set(m.peer, { link, frame: Number.isInteger(m.frame) ? m.frame : this.frame });
        mig.expect.delete(m.peer);
        this.pendingAttach.set(m.peer, attached);
        this.hooks.log?.(`host migration: peer ${m.peer} reported at frame ${m.frame} (${m.inputs.length} inputs)`);
        if (mig.expect.size === 0) this.finishMigration();
    }

    private readonly pendingAttach = new Map<PeerId, (p: PeerState) => void>();

    /** New host: every expected survivor reported (or the time is up): cut the streams of those who did not, go on. */
    private finishMigration(): void {
        const mig = this.migration;
        if (mig === null) return;
        this.migration = null;
        if (mig.timer !== null) clearTimeout(mig.timer);
        const leavers: PeerState[] = [];
        for (const p of this.peers.values()) {
            if (p.info.leftFrom !== null || p.info.id === this.localPeer || mig.reported.has(p.info.id)) continue;
            // Nobody holds an input of theirs past knownThrough (everyone's inputs reached the others through the old
            // host, and every survivor's are merged here), and no survivor can have run a frame without one.
            p.link = null;
            p.info.leftFrom = p.knownThrough + 1;
            for (const f of p.inputs.keys()) if (f >= p.info.leftFrom) p.inputs.delete(f);
            leavers.push(p);
        }
        let floor = this.frame;
        for (const r of mig.reported.values()) floor = Math.min(floor, r.frame);
        const inputs = this.inputsFrom(floor);
        const peers = this.peerList();
        for (const [id, r] of mig.reported) {
            const p = this.peers.get(id)!;
            p.link = r.link;
            this.sendNow(r.link, JSON.stringify({ t: 'migrated', host: this.localPeer, hostFrom: mig.from, peers, inputs, epoch: p.epoch } satisfies MigratedMsg));
            this.pendingAttach.get(id)?.(p);
        }
        this.pendingAttach.clear();
        this.hooks.log?.(`host migration done: hub ${this.localPeer} from frame ${mig.from}; ${mig.reported.size} survivor(s); left: ${leavers.map((p) => `${p.info.id} from ${p.info.leftFrom}`).join(', ') || 'none'}`);
        for (const p of leavers) {
            this.broadcast({ t: 'peerLeft', peer: p.info.id, fromFrame: p.info.leftFrom! }, null);
            this.hooks.onPeerLeft?.({ ...p.info }, p.info.id === mig.oldHost ? 'the host left' : 'did not reconnect after the host left');
        }
        this.hooks.onMigrated?.(this.localPeer);
    }

    /** Survivor: report to the new host over `link` (its backup link) and play on with it as the hub once it answers. */
    migrateTo(link: Link): void {
        if (this.role !== 'client' || this.localPeer < 0 || !this.active) throw new Error('migrateTo: not a client in a session');
        if (this.hostLink !== null && this.hostLink !== link) this.hostLink.close('the host changed');
        this.hostLink = link;
        this.orphaned = false;
        this.awaitingMigrated = { link, through: this.lastSent };
        link.onMessage = (text) => {
            const m = this.decode(text);
            if (m === null) return;
            if (this.awaitingMigrated !== null && this.awaitingMigrated.link === link) {
                if (m.t === 'migrated') this.onMigrated(m);
                else if (m.t === 'bye') link.close(m.reason);
                return;
            }
            this.clientReceive(m);
        };
        link.onClose = (reason) => {
            if (this.hostLink === link) this.hostClosed(reason);
        };
        const floor = this.frame - MIGRATE_BACK_FRAMES;
        const inputs: FrameInput[] = [];
        for (const p of this.peers.values()) for (const [f, input] of p.inputs) if (f >= floor) inputs.push(input);
        inputs.sort((a, b) => a.frame - b.frame || a.peer - b.peer);
        this.sendTo(link, { t: 'migrate', peer: this.localPeer, epoch: this.epoch, frame: this.frame, inputs });
        this.hooks.log?.(`host migration: reported to the new host at frame ${this.frame} (${inputs.length} inputs)`);
    }

    private onMigrated(m: MigratedMsg): void {
        const wait = this.awaitingMigrated!;
        this.awaitingMigrated = null;
        if (m.hostFrom > (this.hosts[this.hosts.length - 1]?.from ?? 0)) this.hosts.push({ peer: m.host, from: m.hostFrom });
        for (const info of m.peers) {
            const p = this.peers.get(info.id);
            if (p === undefined) {
                this.addPeer({ ...info }, null);
                continue;
            }
            if (info.leftFrom !== null && p.info.leftFrom === null) {
                p.info.leftFrom = info.leftFrom;
                for (const f of p.inputs.keys()) if (f >= info.leftFrom) p.inputs.delete(f);
                this.hooks.onPeerLeft?.({ ...p.info }, info.id === this.hostPeerAt(m.hostFrom - 1) ? 'the host left' : 'left');
            }
        }
        for (const input of m.inputs) this.storeInput(input);
        this.epoch = m.epoch;
        // What this peer stored after its report goes to the new hub now.
        const mine = this.peers.get(this.localPeer)!;
        const list: FrameInput[] = [];
        for (let f = wait.through + 1; f <= this.lastSent; f++) {
            const i = mine.inputs.get(f);
            if (i !== undefined) list.push(i);
        }
        if (list.length > 0) this.sendTo(wait.link, { t: 'inputs', list });
        this.hooks.log?.(`host migration: peer ${m.host} is the hub from frame ${m.hostFrom}`);
        this.hooks.onMigrated?.(m.host);
    }

    private broadcast(m: NetMessage, except: PeerState | null): void {
        const text = JSON.stringify(m);
        for (const p of this.peers.values()) {
            if (p === except || p.link === null || p.info.leftFrom !== null) continue;
            this.sendText(p.link, text);
        }
    }

    // -----------------------------------------------------------------------------------------------------------
    // Client side
    // -----------------------------------------------------------------------------------------------------------

    /** Client: every message from the host. A save's chunks are kept; while a save loads, messages wait. */
    private clientReceive(m: NetMessage): void {
        if (this.loading) {
            this.inbox.push(m);
            return;
        }
        if (m.t === 'saveChunk') {
            let pieces = this.saveChunks.get(m.id);
            if (pieces === undefined) this.saveChunks.set(m.id, (pieces = []));
            pieces[m.index] = m.data;
            return;
        }
        if (this.localPeer < 0) {
            // Before the welcome nothing else concerns this peer.
            if (m.t !== 'welcome') return;
            this.withSave(m.save, (text) => this.onWelcome(m, text), (err) => {
                const w = this.welcomeWaiter;
                this.welcomeWaiter = null;
                if (err === undefined) w?.resolve();
                else w?.reject(err);
            });
            return;
        }
        if (m.t === 'resync') {
            this.hooks.onResyncStart?.(m.frame);
            this.withSave(m.save, (text) => this.onResync(m, text!), (err) => {
                if (err === undefined) return;
                this.hooks.log?.(`resync: the host's save could not be loaded: ${err instanceof Error ? err.message : String(err)}`);
                this.hostLink?.close('resync save could not be loaded');
            });
            return;
        }
        this.onClientMessage(m);
    }

    /**
     * Client: `apply` the save `wire` names (its text; null: no save) — inflated from its chunks asynchronously, with the
     * frames and the other messages held until it is applied — then `done` (with the error if it failed).
     */
    private withSave(wire: WireSave | null, apply: (text: string | null) => void, done: (err?: unknown) => void): void {
        if (wire === null) {
            try {
                apply(null);
            } catch (err) {
                done(err);
                return;
            }
            done();
            return;
        }
        const pieces = this.saveChunks.get(wire.id);
        this.saveChunks.delete(wire.id);
        this.loading = true;
        void (async () => {
            const got = pieces === undefined ? 0 : pieces.filter((x) => x !== undefined).length;
            if (pieces === undefined || got !== wire.chunks || pieces.length !== wire.chunks) throw new Error(`save ${wire.id}: ${got} of ${wire.chunks} chunks arrived`);
            const blob = new Blob(pieces.map((b64) => base64ToBytes(b64)));
            pieces.length = 0;
            if (blob.size !== wire.bytes) throw new Error(`save ${wire.id}: ${blob.size} of ${wire.bytes} bytes arrived`);
            apply(await gunzipText(blob));
        })()
            .then(
                () => done(),
                (err: unknown) => done(err),
            )
            .finally(() => {
                this.loading = false;
                while (!this.loading && this.inbox.length > 0) this.clientReceive(this.inbox.shift()!);
            });
    }

    private onWelcome(m: WelcomeMsg, save: string | null): void {
        this.localPeer = m.peer;
        this.params = { ...m.params };
        if (Array.isArray(m.hosts) && m.hosts.length > 0) this.hosts.splice(0, Infinity, ...m.hosts.map((x) => ({ peer: x.peer, from: x.from })));
        for (const info of m.peers) this.addPeer({ ...info }, null);
        if (save !== null) this.sim.load(save);
        this.frame = m.frame;
        this.clock = { ...m.clock };
        for (const input of m.inputs) this.storeInput(input);
        const me = this.peers.get(m.peer)!;
        this.lastSent = me.info.fromFrame - 1;
        this.hooks.log?.(`joined as peer ${m.peer} at frame ${m.frame}${m.save !== null && save !== null ? ` (loaded a save of ${save.length} characters, ${m.save.bytes} bytes compressed)` : ''}, input from frame ${me.info.fromFrame}`);
    }

    private onClientMessage(m: NetMessage): void {
        switch (m.t) {
            case 'inputs': {
                const now = this.wallNow();
                for (const input of m.list) if (this.storeInput(input)) this.hooks.onInput?.(input, now);
                return;
            }
            case 'peerJoined':
                if (!this.peers.has(m.peer.id)) {
                    this.addPeer({ ...m.peer }, null);
                    this.hooks.onPeerJoined?.({ ...m.peer });
                }
                return;
            case 'peerLeft': {
                const p = this.peers.get(m.peer);
                if (p === undefined || p.info.leftFrom !== null) return;
                p.info.leftFrom = m.fromFrame;
                for (const f of p.inputs.keys()) if (f >= m.fromFrame) p.inputs.delete(f);
                this.hooks.onPeerLeft?.({ ...p.info }, 'left');
                return;
            }
            case 'ping':
                if (this.hostLink !== null) this.sendTo(this.hostLink, { t: 'pong', id: m.id, at: m.at });
                return;
            case 'pong':
                this.pings.get(m.id)?.(this.now() - m.at);
                this.pings.delete(m.id);
                return;
            case 'bye':
                this.hostLink?.close(m.reason);
                return;
            default:
                return;
        }
    }

    private onResync(m: ResyncMsg, save: string): void {
        this.sim.load(save);
        const from = this.frame;
        this.frame = m.frame;
        this.clock = { ...m.clock };
        this.epoch = m.epoch;
        if (m.params !== undefined) this.params = { ...m.params };
        // The inputs from m.frame on are immutable: keep what we have (our own sent ones included) and add the host's.
        for (const input of m.inputs) this.storeInput(input);
        this.stats.resyncs++;
        this.hooks.log?.(`resync: loaded the host's save at frame ${m.frame} (was at ${from})`);
        this.hooks.onResync?.(m.frame, this.localPeer, m.save.bytes);
    }

    private hostClosed(reason: string): void {
        if (!this.active) return;
        this.hostLink = null;
        this.awaitingMigrated = null;
        if (this.migratable && this.localPeer >= 0) {
            // Host migration (§16): keep everything; a new host takes over (promoteToHost / migrateTo).
            this.orphaned = true;
            this.hooks.log?.(`host link closed: ${reason} (waiting for a new host)`);
            this.hooks.onHostLost?.(reason);
            return;
        }
        this.active = false;
        this.hooks.log?.(`host link closed: ${reason}`);
        this.hooks.onHostLost?.(reason);
    }

    // -----------------------------------------------------------------------------------------------------------
    // Wire
    // -----------------------------------------------------------------------------------------------------------

    private decode(text: string): NetMessage | null {
        this.stats.messagesReceived++;
        this.stats.bytesReceived += text.length;
        try {
            return JSON.parse(text) as NetMessage;
        } catch {
            this.hooks.log?.('dropped a malformed message');
            return null;
        }
    }

    private sendTo(link: Link, m: NetMessage): void {
        this.sendText(link, JSON.stringify(m));
    }

    private sendText(link: Link, text: string): void {
        const hold = this.held.get(link);
        if (hold === undefined) this.sendNow(link, text);
        else {
            // Behind a save being compressed for this link (sendSave): sent after it.
            this.stats.messagesSent++;
            this.stats.bytesSent += text.length;
            hold.queue.push(text);
        }
    }

    private sendNow(link: Link, text: string): void {
        this.stats.messagesSent++;
        this.stats.bytesSent += text.length;
        link.send(text);
    }

    /** End the session: the host tells its clients and closes their links; a client closes its link. */
    close(reason = 'session closed'): void {
        if (!this.active) return;
        this.active = false;
        if (this.role === 'host') {
            this.broadcast({ t: 'bye', reason }, null);
            for (const p of this.peers.values()) p.link?.close(reason);
            const mig = this.migration;
            this.migration = null;
            if (mig !== null) {
                if (mig.timer !== null) clearTimeout(mig.timer);
                for (const r of mig.reported.values()) r.link.close(reason);
            }
        } else {
            this.hostLink?.close(reason);
        }
    }

    /** Debug / tests: the inputs known for `frame`, by peer. */
    inputsAt(frame: number): FrameInput[] {
        const out: FrameInput[] = [];
        for (const p of this.peers.values()) {
            const i = p.inputs.get(frame);
            if (i !== undefined) out.push(i);
        }
        return out;
    }

    /** How many frames each in-session peer has acked ahead of this one (negative: behind). */
    peerLead(): Record<PeerId, number> {
        const out: Record<PeerId, number> = {};
        for (const p of this.peers.values()) if (p.info.leftFrom === null) out[p.info.id] = p.knownThrough - this.frame;
        return out;
    }
}

function inSession(info: PeerInfo, frame: number): boolean {
    return frame >= info.fromFrame && (info.leftFrom === null || frame < info.leftFrom);
}

/** Exposed for docs / callers that size buffers. */
export const LOCKSTEP_DEFAULTS: Readonly<LockstepParams> = DEFAULT_PARAMS;

/** Re-exported wire types (callers import the session module only). */
export type { ClockState, DigestMsg, FrameInput, LockstepParams, NetCommand, PeerId, PeerInfo };
