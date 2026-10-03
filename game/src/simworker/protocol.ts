// Sim worker: the messages between the main thread and the sim worker (docs/sim-worker.md §2).
// No DOM / Pixi imports (types only).

import type { CreateGameOptions } from '../sim/game';
import type { StartGameOptions } from '../sim/startGameOptions';
import type { ReplicaDelta } from './replicaSync';
import type { RemoteArg } from './remoteArgs';

/** How the worker gets its game. */
export type WorkerBoot =
    | {
          kind: 'create';
          /** createGame options without gameData (the worker loads its own copy from the same URLs). */
          options: Omit<CreateGameOptions, 'gameData'>;
          /** Mod layer: scenario overlay applied to the base data (id, and the add-on list of a composite one). */
          scenario: { id: string; include: string[] | null } | null;
          /** The wizard's flag pick (Empire.flagShape), applied after createGame as main.ts does. */
          flagShapeIndex?: number;
      }
    | {
          kind: 'load';
          /** serializeGame text. */
          text: string;
          scenario: { id: string; include: string[] | null } | null;
      };

export interface InitMessage {
    type: 'init';
    boot: WorkerBoot;
    /** Saved with the game (serializeGame). */
    startOptions: StartGameOptions;
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

/** A read-only sim query (simQuery.ts SIM_QUERIES) run on the authoritative galaxy, in order with the commands. */
export interface QueryMessage {
    type: 'query';
    /** Main-side id for the reply (same id space as CommandMessage.id; never 0). */
    id: number;
    /** Sync id of the asking empire. */
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
 * Trade-flow recording on / off (render/freightOverlay.ts through sim/logistics/tradeFlows.ts setRemoteTradeFlows): not
 * a player command (in-thread it is not journaled either; it observes contracts and changes no sim state).
 */
export interface TradeFlowsMessage {
    type: 'tradeFlows';
    record: boolean;
}

export type ToWorker = InitMessage | ClockMessage | CommandMessage | QueryMessage | RefreshRequest | SaveRequest | DigestRequest | TradeFlowsMessage | { type: 'dispose' };

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
    /** onApplied results of commands applied at this tick's boundary, query replies (`query`) and refresh replies, resolved after
     *  `delta`. A command result makes the main thread apply the queued cold parts through this delta first. */
    results: { id: number; result: RemoteArg; error?: string; query?: boolean }[];
    /** Sim → UI events raised during the tick (resolved after `delta`). */
    events: WorkerEvent[];
}

export type WorkerEvent =
    | { kind: 'gameEnd' }
    | { kind: 'locationPinged'; target: RemoteArg }
    | { kind: 'simError'; message: string };

export type FromWorker =
    | ProgressMessage
    | SnapshotMessage
    | StepMessage
    | { type: 'saved'; id: number; text: string | null; error?: string }
    | { type: 'digest'; id: number; digest: string; nowMs: number; stepSerial: number }
    | { type: 'error'; message: string };
