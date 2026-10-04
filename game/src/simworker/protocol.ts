// Sim worker: the messages between the main thread and the sim worker (docs/sim-worker.md §2).
// No DOM / Pixi imports (types only).

import type { CreateGameOptions } from '../sim/game';
import type { GenerateGalaxyOptions } from '../sim/galaxy';
import type { CommandLogEntry } from '../sim/player/commandLog';
import type { StartGameOptions } from '../sim/startGameOptions';
import type { ReplicaDelta } from './replicaSync';
import type { RemoteArg } from './remoteArgs';
import type { MessageRoute } from '../sim/messageRouting';

/** How the worker gets its game. */
export type WorkerBoot =
    | {
          kind: 'create';
          /** createGame options without gameData (the worker loads its own copy from the same URLs). */
          options: Omit<CreateGameOptions, 'gameData'>;
          /** Mod layer: scenario overlay applied to the base data (id, and the add-on list of a composite one). */
          scenario: { id: string; include: string[] | null } | null;
      }
    | {
          kind: 'load';
          /** serializeGame text (or `url`: the worker fetches it, so the main thread never holds or parses the text). */
          text?: string;
          url?: string;
          /** Ignored: the worker reads the scenario from the save itself (main.ts no longer parses the save). */
          scenario?: { id: string; include: string[] | null } | null;
      }
    | {
          /** [simworker chunk 1] main.ts bootGameWithOptions without ?autostart: a bare generateGalaxy (no empires). */
          kind: 'generate';
          options: Omit<GenerateGalaxyOptions, 'gameData'>;
          viewX: number;
          viewY: number;
      };

/** A game's scenario as the worker resolved it (id, and the add-on list of a composite one). */
export type ScenarioRef = { id: string; include: string[] | null } | null;

export interface InitMessage {
    type: 'init';
    boot: WorkerBoot;
    /** Saved with the game (serializeGame). A load uses the save's own (this is then ignored and may be omitted). */
    startOptions?: StartGameOptions;
    /** Clock controls to start with (a loaded save's, else paused at 1×). */
    clock?: { speed: number; paused: boolean };
    /** Replica sync tuning (ReplicaEncoderOptions). */
    sync?: { coldBudgetMs?: number; coldMaxSets?: number; markBudgetMs?: number };
}

export interface ClockMessage {
    type: 'clock';
    seq: number;
    speed: number;
    paused: boolean;
}

export interface CommandMessage {
    type: 'command';
    /** Main-side id for the onApplied reply (0: no reply wanted). */
    id: number;
    /** Sync id of the issuing empire. */
    empire: number;
    op: string;
    args: RemoteArg[];
}

export interface SaveRequest {
    type: 'save';
    id: number;
}

/**
 * Compare these replica objects (sync ids) and what they reach now, so their cold data arrives with the next delta (a
 * screen opening; docs/sim-worker.md §9 chunk 6). `id` (0: none) gets an empty reply in `StepMessage.results`.
 */
export interface RefreshRequest {
    type: 'refresh';
    id: number;
    objects: number[];
}

export interface DigestRequest {
    type: 'digest';
    id: number;
}

/**
 * [simworker chunk 1] The `__dwu.sim` / `__dwu.simBudget` debug surface in worker mode: read, write or call a member of
 * the worker's SimDriver ('sim') or SimFrameBudget ('simBudget').
 */
export interface DebugRequest {
    type: 'debug';
    id: number;
    target: 'sim' | 'simBudget';
    op: 'get' | 'set' | 'call';
    name?: string;
    value?: unknown;
    args?: unknown[];
}

/** [simworker chunk 1] The authoritative command log (`__dwu.commands.log()` in worker mode). */
export interface CommandLogRequest {
    type: 'commandLog';
    id: number;
}

/**
 * Trade-flow recording on / off (render/freightOverlay.ts through sim/logistics/tradeFlows.ts setRemoteTradeFlows): not
 * a player command (in-thread it is not journaled either; it observes contracts and changes no sim state).
 */
export interface TradeFlowsMessage {
    type: 'tradeFlows';
    record: boolean;
}

/**
 * A host op (hostOps.ts) to run on the authoritative game between two ticks: a sim write of the local-model paths
 * that is not a player command (strategic decisions, a chronicle year, a voiced message). Its result travels in the
 * next step message's `results` under `id`, like a command reply.
 */
export interface HostOpMessage {
    type: 'hostOp';
    /** Main-side id for the reply (shared with the command ids). */
    id: number;
    op: string;
    args: RemoteArg[];
}

export type ToWorker = InitMessage | ClockMessage | CommandMessage | HostOpMessage | RefreshRequest | SaveRequest | DigestRequest | TradeFlowsMessage | DebugRequest | CommandLogRequest | { type: 'dispose' };

export interface ProgressMessage {
    type: 'progress';
    step: string;
    fraction: number;
}

/** The first replica sync (everything) once the game exists. */
export interface SnapshotMessage {
    type: 'snapshot';
    delta: ReplicaDelta;
    baseTechCost: number;
    viewX: number;
    viewY: number;
    clock: { speed: number; paused: boolean };
    stepSerial: number;
    startOptions: StartGameOptions;
    /** The scenario the worker's game data carries (a loaded save's, read by the worker): the replica's static data
     *  needs the same overlay. Absent: none. */
    scenario?: ScenarioRef;
}

/** Sent after every worker tick that ran steps or changed state (commands, clock), and periodically while paused. */
export interface StepMessage {
    type: 'step';
    delta: ReplicaDelta;
    /** Sim steps completed so far (cumulative; RenderTime.stepSerial). */
    stepSerial: number;
    /** Steps this tick ran. */
    steps: number;
    nowMs: number;
    /** The worker budget's backlog after the tick (the start of the next step's real-time fraction). */
    backlogMs: number;
    speed: number;
    paused: boolean;
    /** Last clock message applied (the main thread adopts the worker's pause / speed only once it is current). */
    clockSeq: number;
    /** Worker wall ms: the steps, and the replica diff. */
    stepMs: number;
    diffMs: number;
    /** onApplied results of commands applied at this tick's boundary and refresh replies, resolved after `delta`. A
     *  result makes the main thread apply the queued cold parts through this delta first. `error`: the command / host op
     *  failed (docs/sim-worker.md §4.4 "Failed commands"); `threw`: the command's executor threw at the boundary (the
     *  worker paused with a simulation error; as in-thread, no callback runs). */
    results: { id: number; result: RemoteArg; error?: string; threw?: boolean }[];
    /** Sim → UI events raised during the tick (resolved after `delta`). */
    events: WorkerEvent[];
}

/** One message the player's pipeline handled, with what it decided (sim/playerMessages.ts PlayerMessageReceipt). */
export interface PlayerMessageWire {
    m: RemoteArg;
    ticker: boolean;
    advisor: boolean;
    route: MessageRoute | null;
    action: 'queue' | 'open' | 'none';
}

/** One Empire.SendEventMessageToEmpire the player received. */
export interface PlayerEventWire {
    type: number;
    title: string;
    message: string;
    data: RemoteArg;
    location: RemoteArg;
}

export type WorkerEvent =
    /** Galaxy.GameEnd (the worker already paused, ran DoGameEnd and reviewed the achievements); `args` for the banner. */
    | { kind: 'gameEnd'; args?: { victor: RemoteArg; outcome: number; description: string; code: number } }
    /** What the player's message pipeline handled since the last step (each message once, in arrival order). */
    | { kind: 'playerMessages'; receipts: PlayerMessageWire[]; events: PlayerEventWire[] }
    | { kind: 'locationPinged'; target: RemoteArg }
    | { kind: 'simError'; message: string }
    /** The worker stopped for good (its loop threw, it crashed, or it stopped answering): raised by the main thread
     *  (SimClientCore.workerFailed), never sent by the worker. */
    | { kind: 'workerStopped'; message: string }
    /** 19s-2 voice cues the tick left (sim/scenario/llm/voiceCues.ts drainVoiceCues, drained in the worker): VoiceCue[]. */
    | { kind: 'voiceCues'; cues: RemoteArg[] };

export type FromWorker =
    | ProgressMessage
    | SnapshotMessage
    | StepMessage
    | { type: 'saved'; id: number; text: string | null; error?: string }
    | { type: 'digest'; id: number; digest: string; nowMs: number; stepSerial: number }
    | DebugReply
    | { type: 'commandLog'; id: number; log: CommandLogEntry[] }
    /**
     * Something failed in the worker. `fatal`: the worker's game stopped (its step loop or the sync threw; nothing more
     * will come — the main thread fails what waits on it). `id`: the save / digest / debug / commandLog request that
     * failed (its promise rejects). Neither: a message handler failed (logged).
     */
    | { type: 'error'; message: string; fatal?: boolean; id?: number };

/** Reply to a DebugRequest: the member's value (or the call's result) and the target's plain fields after the op. */
export interface DebugReply {
    type: 'debug';
    id: number;
    value: unknown;
    state: Record<string, number | boolean | string | null>;
    error?: string;
}
