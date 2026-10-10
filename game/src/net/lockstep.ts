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
//   has not sent yet. Leave: when a client's link drops, the host ends it at the first frame it has no input for and
//   tells the others; the session goes on (onPeerLeft is the hook for Phase 4's AI takeover).
//
// The session is transport-agnostic (transport.ts Link) and sim-agnostic (LockstepSim below; lockstepSim.ts adapts
// a Galaxy). Nothing here touches the sim unless a session exists. Headless: no DOM / Pixi / Node APIs.

import type { ClockState, DigestMsg, FrameInput, LockstepParams, NetCommand, NetMessage, PeerId, PeerInfo, ResyncMsg, WelcomeMsg } from './protocol';
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
    /** Host: a resync save was sent to `peer`. Client: a resync save was loaded. */
    onResync?(frame: number, peer: PeerId, bytes: number): void;
    /** An input arrived from another peer (stats; `now` = wall epoch ms). */
    onInput?(input: FrameInput, now: number): void;
    /** Client: the host link closed; the session is over. */
    onHostLost?(reason: string): void;
    /** A frame ran (after applyFrame). */
    onFrame?(frame: number, clock: ClockState): void;
    log?(message: string): void;
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
}

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
    readonly role: 'host' | 'client';
    /** This peer's id (0 for the host; a client learns it from welcome). */
    localPeer: PeerId;
    /** The next frame to run (= frames run so far, counted from the session's frame 0). */
    frame = 0;
    clock: ClockState;
    params: LockstepParams;
    readonly stats: LockstepStats = {
        framesRun: 0, stalls: 0, stallMs: 0, messagesSent: 0, messagesReceived: 0, bytesSent: 0, bytesReceived: 0,
        commandsSent: 0, commandsApplied: 0, digestChecks: 0, digestMismatches: 0, resyncs: 0,
    };
    /** False once the session ended (client: the host link closed; host: close()). */
    active = true;

    private readonly peers = new Map<PeerId, PeerState>();
    private readonly hooks: LockstepHooks;
    private readonly frameRealMs: number;
    private readonly maxCatchUp: number;
    private readonly history: number;
    private readonly now: () => number;
    private readonly wallNow: () => number;
    private readonly allowPause: (peer: PeerId, paused: boolean) => boolean;
    /** Highest frame this peer has sent input for. */
    private lastSent = -1;
    private seq = 0;
    private pendingCmds: NetCommand[] = [];
    /** Host: a clock change for the next input it sends. */
    private pendingClock: ClockState | null = null;
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
        this.name = opts.name ?? (role === 'host' ? 'host' : 'client');
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
            let welcomed = false;
            link.onMessage = (text) => {
                const m = s.decode(text);
                if (m === null) return;
                if (!welcomed) {
                    if (m.t !== 'welcome') return;
                    welcomed = true;
                    try {
                        s.onWelcome(m);
                    } catch (err) {
                        reject(err);
                        return;
                    }
                    resolve(s);
                    return;
                }
                s.onClientMessage(m);
            };
            link.onClose = (reason) => {
                if (!welcomed) reject(new Error(`link closed before welcome: ${reason}`));
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

    /** The peers in the session (including left ones). */
    peerList(): PeerInfo[] {
        return [...this.peers.values()].map((p) => ({ ...p.info }));
    }

    // -----------------------------------------------------------------------------------------------------------
    // Local input and the clock
    // -----------------------------------------------------------------------------------------------------------

    /** Submit a local command (empire index, op, encoded args); it is applied at frame + inputDelay. Returns its seq. */
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
    }

    /** Host: pause / resume. A client asks the host instead (requestPause). */
    setPaused(paused: boolean): void {
        if (this.role !== 'host') {
            this.requestPause(paused);
            return;
        }
        this.pendingClock = { speed: (this.pendingClock ?? this.latestClock()).speed, paused };
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

    /** The clock the host's last sent input set (or the running one). */
    private latestClock(): ClockState {
        const host = this.peers.get(0);
        if (host !== undefined) {
            for (let f = host.knownThrough; f >= this.frame; f--) {
                const c = host.inputs.get(f)?.clock;
                if (c !== undefined) return c;
            }
        }
        return this.clock;
    }

    // -----------------------------------------------------------------------------------------------------------
    // Running frames
    // -----------------------------------------------------------------------------------------------------------

    /** Real-time drive: owe `realDtMs` more to the sim and run the frames that are due and runnable. Returns frames run. */
    update(realDtMs: number): number {
        if (!this.active) return 0;
        this.accumulator = Math.min(this.accumulator + Math.max(0, realDtMs), this.frameRealMs * this.maxCatchUp);
        let ran = 0;
        while (this.accumulator >= this.frameRealMs) {
            if (!this.step()) break;
            this.accumulator -= this.frameRealMs;
            ran++;
        }
        return ran;
    }

    /** Run frames as fast as the inputs allow (up to `max`); returns frames run. Headless / benchmark drive. */
    runAvailable(max = Infinity): number {
        let ran = 0;
        while (ran < max && this.active && this.step()) ran++;
        return ran;
    }

    /** Run the next frame if every peer's input for it is known. */
    step(): boolean {
        if (!this.active || this.localPeer < 0) return false;
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
        for (const p of order) {
            const input = p.inputs.get(f)!;
            if (p.info.id === 0 && input.clock !== undefined) this.clock = { ...input.clock };
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
            }
            list.push(input);
            this.storeInput(input);
        }
        this.lastSent = through;
        if (this.role === 'host') this.broadcast({ t: 'inputs', list }, null);
        else if (this.hostLink !== null) this.sendTo(this.hostLink, { t: 'inputs', list });
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
        } else if (this.hostLink !== null) {
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
        const save = skipSave ? null : this.sim.save(this.clock);
        const welcome: WelcomeMsg = {
            t: 'welcome', peer: id, frame: this.frame, save, clock: { ...this.clock }, inputs: this.inputsFrom(this.frame),
            peers: this.peerList(), params: { ...this.params },
        };
        this.sendTo(link, welcome);
        this.hooks.log?.(`peer ${id} (${name}) joined from frame ${info.fromFrame}${save !== null ? ` with a ${save.length}-byte save` : ' (same state, no save)'}`);
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
                for (const input of m.list) {
                    if (input.peer !== p.info.id) continue; // a client speaks only for itself
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
        const save = this.sim.save(this.clock);
        const msg: ResyncMsg = { t: 'resync', frame: this.frame, save, clock: { ...this.clock }, inputs: this.inputsFrom(this.frame), epoch: p.epoch };
        this.sendTo(p.link, msg);
        this.stats.resyncs++;
        this.hooks.onResync?.(this.frame, p.info.id, save.length);
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

    private onWelcome(m: WelcomeMsg): void {
        this.localPeer = m.peer;
        this.params = { ...m.params };
        for (const info of m.peers) this.addPeer({ ...info }, null);
        if (m.save !== null) this.sim.load(m.save);
        this.frame = m.frame;
        this.clock = { ...m.clock };
        for (const input of m.inputs) this.storeInput(input);
        const me = this.peers.get(m.peer)!;
        this.lastSent = me.info.fromFrame - 1;
        this.hooks.log?.(`joined as peer ${m.peer} at frame ${m.frame}${m.save !== null ? ` (loaded a ${m.save.length}-byte save)` : ''}, input from frame ${me.info.fromFrame}`);
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
            case 'resync':
                this.onResync(m);
                return;
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

    private onResync(m: ResyncMsg): void {
        this.sim.load(m.save);
        const from = this.frame;
        this.frame = m.frame;
        this.clock = { ...m.clock };
        this.epoch = m.epoch;
        // The inputs from m.frame on are immutable: keep what we have (our own sent ones included) and add the host's.
        for (const input of m.inputs) this.storeInput(input);
        this.stats.resyncs++;
        this.hooks.log?.(`resync: loaded the host's save at frame ${m.frame} (was at ${from})`);
        this.hooks.onResync?.(m.frame, this.localPeer, m.save.length);
    }

    private hostClosed(reason: string): void {
        if (!this.active) return;
        this.active = false;
        this.hostLink = null;
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
