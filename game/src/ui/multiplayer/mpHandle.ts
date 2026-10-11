// The running LAN game as the multiplayer screen sees it (docs/MULTIPLAYER.md §10–§12), one shape for the two places the
// session can run:
// - InThreadMp: the session and the sim on this thread (net/multiplayerGame.ts; the loop steps through the lockstep
//   seam, src/simLoop.ts).
// - WorkerMp: the session in the sim worker, next to its game (simworker/workerLockstep.ts). This side keeps the
//   network links (relayed to the worker as netIn / netOut), mirrors the session's state (mpState) and calls into it
//   (mpCall); the screen shows the worker's replica. A resync or join save makes the worker send a new snapshot: the
//   next SimWorkerClient (MpSideChannel.onReplaced) and onGameReplaced, as loading a save rebuilds the view.
//
// Main thread; no DOM of its own (multiplayerApp.ts draws).

import type { Game } from '../../sim/game';
import type { Empire } from '../../sim/empire';
import type { GalaxyTime } from '../../sim/galaxyTime';
import { setLockstepStepper } from '../../net/lockstepSeam';
import { empireOfSlot, myEmpireOf, MultiplayerGame, rejoinSlotFor, type MultiplayerStatus, type SeatState } from '../../net/multiplayerGame';
import type { ClockState, LockstepStats, PeerInfo } from '../../net/lockstep';
import type { MultiplayerStart } from '../../net/lobby';
import type { Link } from '../../net/transport';
import type { SimWorkerClient, MpSideChannel, MpSideMessage } from '../../simworker/workerClient';
import type { SimEndpoint } from '../../simworker/simEndpoint';
import type { MpWireState, ToWorker } from '../../simworker/protocol';

export interface MpHandle {
    readonly role: 'host' | 'client';
    /** The session and the sim run in the sim worker. */
    readonly worker: boolean;
    readonly start: MultiplayerStart;
    readonly slot: number;
    /** The game the screen shows (in-thread: the game itself; worker: its replica). */
    game(): Game;
    /** Worker mode: the worker client of the game shown. */
    simClient(): SimWorkerClient | undefined;
    currentStatus(): MultiplayerStatus;
    frame(): number;
    clock(): ClockState | null;
    stats(): LockstepStats | null;
    peers(): PeerInfo[];
    seats(): SeatState[];
    inputDelay(): number;
    gameMs(): number;
    /** This player's empire on the game shown. */
    myEmpire(): Empire | null;
    ping(): Promise<number>;
    digest(): Promise<string>;
    requestPause(paused: boolean): void;
    setSpeed(speed: number): void;
    setInputDelay(frames: number): void;
    /** Host: what happens to an absent player's empire (the AI runs it, or it stands idle). */
    decideAbsent(slot: number, ai: boolean): void;
    /** Host: which slot a reconnecting player gets back. */
    rejoinSlot(name: string, token: string | undefined, tokens: ReadonlyMap<number, string>): { slot: number } | { refused: string };
    /** Host: hand a reconnecting player's (slot-handed) link to the session. */
    acceptRejoin(link: Link, slot: number): void;
    /** Host: a NEW player's (slot-handed) link (§21): it joins with the save and takes `empireId` over at its first
     *  input frame. */
    acceptNewPlayer(link: Link, slot: number, empireId: number, name: string): void;
    /** The lobby slot of the hub (0 until a host migration, docs/MULTIPLAYER.md §16). */
    hostSlot(): number;
    /** Host migration: this client becomes the hub; `expectSlots` report over their backup links (acceptMigrant). */
    promote(expectSlots: number[]): void;
    /** Host migration, the new hub: a survivor's backup link. */
    acceptMigrant(link: Link): void;
    /** Host migration, a survivor: play on with the hub at `slot` over `link` (its backup link). */
    migrateTo(link: Link, slot: number): void;
    /** Host migration did not happen (no backup link): show the host as lost. */
    abandonMigration(): void;
    /** The debug hook's calls (workerLockstep.ts run): issue, renameOther, scriptStep, shipNames, myEmpire. */
    call(fn: string, args: unknown[]): Promise<unknown>;
    close(reason: string): void;
    /** Debug / tests: close this peer's network links as a network failure would (the session hears of a drop). */
    dropLinks(reason: string): void;
    /** The status changed. */
    onStatus: ((s: MultiplayerStatus) => void) | null;
    /** A resync / join save replaced the game: show `game` (worker: with `client`). */
    onGameReplaced: ((game: Game, client: SimWorkerClient | undefined) => void) | null;
}

// ---------------------------------------------------------------------------------------------------------------------
// In-thread
// ---------------------------------------------------------------------------------------------------------------------

export class InThreadMp implements MpHandle {
    readonly worker = false;
    onStatus: ((s: MultiplayerStatus) => void) | null = null;
    onGameReplaced: ((game: Game, client: SimWorkerClient | undefined) => void) | null = null;
    mp!: MultiplayerGame;
    /** The network links the session took (dropLinks). */
    readonly links: Link[] = [];

    constructor(readonly start: MultiplayerStart, readonly slot: number) {}

    /** The options' hooks for MultiplayerGame.host / join (status and replaced game go through this handle). */
    hooks(): { onStatus: (s: MultiplayerStatus) => void; onGameReplaced: (g: Game, t: GalaxyTime) => void } {
        return {
            onStatus: (s) => this.onStatus?.(s),
            onGameReplaced: (g) => {
                // A resync / the join save replaced the game: the loop's stepper follows the new galaxy.
                if (this.mp !== undefined) setLockstepStepper(g.galaxy, this.mp.stepper);
                this.onGameReplaced?.(g, undefined);
            },
        };
    }

    get role(): 'host' | 'client' {
        return this.mp.role;
    }
    game(): Game {
        return this.mp.sim.game;
    }
    simClient(): SimWorkerClient | undefined {
        return undefined;
    }
    currentStatus(): MultiplayerStatus {
        return this.mp.currentStatus();
    }
    frame(): number {
        return this.mp.session?.frame ?? -1;
    }
    clock(): ClockState | null {
        return this.mp.session?.clock ?? null;
    }
    stats(): LockstepStats | null {
        return this.mp.session === null ? null : { ...this.mp.session.stats };
    }
    peers(): PeerInfo[] {
        return this.mp.session?.peerList() ?? [];
    }
    seats(): SeatState[] {
        return this.mp.seats();
    }
    inputDelay(): number {
        return this.mp.session?.params.inputDelay ?? 0;
    }
    gameMs(): number {
        return this.mp.sim.game === null ? -1 : this.mp.sim.galaxy.nowMs;
    }
    myEmpire(): Empire | null {
        return this.mp.myEmpire();
    }
    ping(): Promise<number> {
        return this.mp.session === null || !this.mp.session.active ? Promise.reject(new Error('no session')) : this.mp.session.ping();
    }
    digest(): Promise<string> {
        return Promise.resolve(this.mp.sim.digest());
    }
    requestPause(paused: boolean): void {
        this.mp.session?.requestPause(paused);
    }
    setSpeed(speed: number): void {
        this.mp.session?.setSpeed(speed);
    }
    setInputDelay(frames: number): void {
        this.mp.session?.setInputDelay(frames);
    }
    decideAbsent(slot: number, ai: boolean): void {
        this.mp.decideAbsent(slot, ai);
    }
    rejoinSlot(name: string, token: string | undefined, tokens: ReadonlyMap<number, string>): { slot: number } | { refused: string } {
        return this.mp.rejoinSlot(name, token, tokens);
    }
    acceptRejoin(link: Link, slot: number): void {
        this.links.push(link);
        this.mp.acceptRejoin(link, slot);
    }
    acceptNewPlayer(link: Link, slot: number, empireId: number, name: string): void {
        this.links.push(link);
        this.mp.acceptNewPlayer(link, slot, empireId, name);
    }
    hostSlot(): number {
        return this.mp.hostSlot();
    }
    promote(expectSlots: number[]): void {
        this.mp.promote(expectSlots);
    }
    acceptMigrant(link: Link): void {
        this.links.push(link);
        this.mp.acceptMigrant(link);
    }
    migrateTo(link: Link, slot: number): void {
        this.links.push(link);
        this.mp.migrateTo(link, slot);
    }
    abandonMigration(): void {
        this.mp.abandonMigration();
    }
    call(): Promise<unknown> {
        return Promise.reject(new Error('in-thread: call the session directly'));
    }
    close(reason: string): void {
        this.mp.close(reason);
        if (this.mp.sim.game !== null) setLockstepStepper(this.mp.sim.galaxy, null);
    }
    dropLinks(reason: string): void {
        for (const l of this.links.splice(0)) l.close(reason);
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------------------------------------------------

const NO_STATS: LockstepStats = { framesRun: 0, stalls: 0, stallMs: 0, messagesSent: 0, messagesReceived: 0, bytesSent: 0, bytesReceived: 0, commandsSent: 0, commandsApplied: 0, digestChecks: 0, digestMismatches: 0, deepChecks: 0, deepMismatches: 0, deepTaken: 0, deepMsTotal: 0, deepMsMax: 0, resyncs: 0, delayChanges: 0 };

export class WorkerMp implements MpHandle {
    readonly worker = true;
    onStatus: ((s: MultiplayerStatus) => void) | null = null;
    onGameReplaced: ((game: Game, client: SimWorkerClient | undefined) => void) | null = null;
    /** The side channel to hand SimWorkerClient.boot (its messages come here; a replaced game keeps it). */
    readonly side: MpSideChannel;
    private client: SimWorkerClient | null = null;
    private endpoint: SimEndpoint | null = null;
    private readonly links = new Map<number, Link>();
    private nextLink = 1;
    private nextCall = 1;
    private readonly calls = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
    private state: MpWireState | null = null;
    private statusKey = '';
    /** A replacement client being built (join(): the game is shown once it is ready). */
    private replacing: Promise<SimWorkerClient> | null = null;
    private closed = false;

    /** The role the session started in (the worker's mpState says the current one: a host migration changes it). */
    get role(): 'host' | 'client' {
        return this.state?.role ?? this.initialRole;
    }

    constructor(private readonly initialRole: 'host' | 'client', readonly start: MultiplayerStart, readonly slot: number, private readonly name: string) {
        this.side = {
            handler: (m) => this.onSide(m),
            onReplaced: (next) => {
                this.replacing = next;
                next.then(
                    (c) => {
                        if (this.replacing === next) this.replacing = null;
                        this.client = c;
                        c.core.setLockstep(true);
                        if (!this.closed) this.onGameReplaced?.(c.core.game, c);
                    },
                    (err: unknown) => console.error('multiplayer: the new game from the host could not be shown', err),
                );
            },
        };
    }

    /** The worker this session talks to (before its game exists: a client waiting for the welcome's save). */
    useEndpoint(endpoint: SimEndpoint): void {
        this.endpoint = endpoint;
    }

    /** The worker client of the game shown (once it exists). */
    attach(client: SimWorkerClient): void {
        this.client = client;
        this.endpoint = client.endpoint;
        client.core.setLockstep(true);
    }

    private post(m: ToWorker): void {
        if (this.endpoint === null) throw new Error('multiplayer: no worker');
        this.endpoint.postMessage(m);
    }

    /** Relay `link` to the worker; returns its id there. */
    relay(link: Link): number {
        const id = this.nextLink++;
        this.links.set(id, link);
        link.onMessage = (text) => {
            if (!this.closed) this.post({ type: 'netIn', link: id, text });
        };
        link.onClose = (reason) => {
            this.links.delete(id);
            if (!this.closed) this.post({ type: 'netClose', link: id, reason });
        };
        return id;
    }

    private onSide(m: MpSideMessage): void {
        switch (m.type) {
            case 'netOut':
                this.links.get(m.link)?.send(m.text);
                return;
            case 'netCloseOut': {
                const l = this.links.get(m.link);
                this.links.delete(m.link);
                l?.close(m.reason);
                return;
            }
            case 'mpState': {
                this.state = m.state;
                // The worker's session maps new players to their seats (§21): keep this copy of the start in step.
                for (const seat of m.state.seats) {
                    const p = this.start.players.find((x) => x.slot === seat.slot);
                    if (p !== undefined) p.humanIndex = seat.humanIndex;
                    else this.start.players.push({ slot: seat.slot, name: seat.name, humanIndex: seat.humanIndex });
                    if (this.start.joining?.slot === seat.slot) delete this.start.joining;
                }
                const key = JSON.stringify(m.state.status);
                if (key !== this.statusKey) {
                    this.statusKey = key;
                    this.onStatus?.(m.state.status);
                }
                return;
            }
            case 'mpReply': {
                const w = this.calls.get(m.id);
                this.calls.delete(m.id);
                if (w === undefined) return;
                if (m.error !== undefined) w.reject(new Error(m.error));
                else w.resolve(m.value);
                return;
            }
        }
    }

    call(fn: string, args: unknown[]): Promise<unknown> {
        const id = this.nextCall++;
        return new Promise((resolve, reject) => {
            if (this.closed) {
                reject(new Error('the session is closed'));
                return;
            }
            this.calls.set(id, { resolve, reject });
            this.post({ type: 'mpCall', id, fn, args });
        });
    }

    /**
     * Start the worker's session: the host over its game with the lobby's links (by slot); a client over its link to the
     * host, with (`have`) or without its own game. Resolves when it runs (a client: once welcomed, and its game is
     * ready to show).
     */
    async begin(links: Map<number, Link>, have: boolean, adaptiveDelay: boolean): Promise<void> {
        const id = this.nextCall++;
        const list = [...links].map(([slot, link]) => ({ slot, link: this.relay(link) }));
        await new Promise<unknown>((resolve, reject) => {
            this.calls.set(id, { resolve, reject });
            this.post({ type: 'mpStart', id, start: this.start, slot: this.slot, role: this.initialRole, name: this.name, links: list, have, ...(adaptiveDelay ? { adaptiveDelay: true } : {}) });
        });
        // A join save may have replaced the game meanwhile: wait for its replica.
        while (this.replacing !== null) await this.replacing.catch(() => undefined);
    }

    /** Wait for the client the worker's first snapshot builds (a client without its own game: the welcome's save). */
    async firstClient(boot: Promise<SimWorkerClient>): Promise<void> {
        this.attach(await boot);
    }

    game(): Game {
        if (this.client === null) throw new Error('multiplayer: no game yet');
        return this.client.core.game;
    }
    simClient(): SimWorkerClient | undefined {
        return this.client ?? undefined;
    }
    currentStatus(): MultiplayerStatus {
        return this.state?.status ?? { kind: 'running' };
    }
    frame(): number {
        return this.state?.frame ?? -1;
    }
    clock(): ClockState | null {
        return this.state?.clock ?? null;
    }
    stats(): LockstepStats | null {
        return this.state === null ? null : { ...NO_STATS, ...this.state.stats };
    }
    peers(): PeerInfo[] {
        return this.state?.peers ?? [];
    }
    seats(): SeatState[] {
        return this.state?.seats ?? [];
    }
    inputDelay(): number {
        return this.state?.inputDelay ?? 0;
    }
    gameMs(): number {
        return this.state?.gameMs ?? -1;
    }
    myEmpire(): Empire | null {
        return this.client === null ? null : myEmpireOf(this.client.core.galaxy, this.start, this.slot);
    }
    ping(): Promise<number> {
        return this.call('ping', []) as Promise<number>;
    }
    digest(): Promise<string> {
        return this.call('digest', []) as Promise<string>;
    }
    requestPause(paused: boolean): void {
        void this.call('pause', [paused]).catch(() => undefined);
    }
    setSpeed(speed: number): void {
        void this.call('speed', [speed]).catch(() => undefined);
    }
    setInputDelay(frames: number): void {
        void this.call('inputDelay', [frames]).catch(() => undefined);
    }
    decideAbsent(slot: number, ai: boolean): void {
        void this.call('decideAbsent', [slot, ai]).catch((err: unknown) => console.warn('multiplayer:', err));
    }
    rejoinSlot(name: string, token: string | undefined, tokens: ReadonlyMap<number, string>): { slot: number } | { refused: string } {
        if (this.role !== 'host') return { refused: 'not the host' };
        return rejoinSlotFor(this.seats(), this.slot, name, token, tokens);
    }
    acceptRejoin(link: Link, slot: number): void {
        const id = this.relay(link);
        this.post({ type: 'netLink', link: id, slot, mode: 'rejoin' });
    }
    acceptNewPlayer(link: Link, slot: number, empireId: number, name: string): void {
        const id = this.relay(link);
        this.post({ type: 'netLink', link: id, slot, mode: 'join', join: { empireId, name } });
    }
    hostSlot(): number {
        return this.state?.hostSlot ?? 0;
    }
    promote(expectSlots: number[]): void {
        void this.call('promote', [expectSlots]).catch((err: unknown) => console.warn('multiplayer: promote failed', err));
    }
    acceptMigrant(link: Link): void {
        const id = this.relay(link);
        this.post({ type: 'netLink', link: id, slot: -1, mode: 'migrant' });
    }
    migrateTo(link: Link, slot: number): void {
        const id = this.relay(link);
        this.post({ type: 'netLink', link: id, slot, mode: 'newHost' });
    }
    abandonMigration(): void {
        void this.call('abandonMigration', []).catch(() => undefined);
    }
    dropLinks(reason: string): void {
        for (const l of [...this.links.values()]) l.close(reason);
    }
    close(reason: string): void {
        if (this.closed) return;
        try {
            this.post({ type: 'mpCall', id: 0, fn: 'close', args: [reason] });
        } catch {
            // the worker is gone
        }
        this.closed = true;
        // The worker may be terminated right after this (the view's teardown): say goodbye from here too.
        for (const l of this.links.values()) {
            if (this.role === 'host') l.send(JSON.stringify({ t: 'bye', reason }));
            l.close(reason);
        }
        this.links.clear();
        for (const w of this.calls.values()) w.reject(new Error('the session is closed'));
        this.calls.clear();
    }
}
