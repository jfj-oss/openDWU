// Sim worker: host ops — sim writes that are not player commands but must run on the authoritative game (docs/
// sim-worker.md §9 chunk 8). In-thread their callers run them directly between frames (in a promise continuation, like
// a click); in worker mode the main thread posts a `hostOp` message (remoteHost.ts) and the worker runs the op when the
// message arrives — also between two ticks, at the galaxy.nowMs the next frame starts from, which is exactly where the
// in-thread call lands. Each op is the same function the in-thread path calls, so what it changes, what it journals
// (applyStrategicDecisions appends its 'ai-advisor' command-log entries itself) and the RNG draws it makes are the
// in-thread ones. The result goes back in the next step message, resolved after that step's delta.
//
// Arguments and results cross the boundary through remoteArgs.ts (replica objects by sync id, plain data by value).
// No DOM / Pixi imports.

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import type { EmpireMessage } from '../sim/messages';
import { applyStrategicDecisions, type StrategicDecision, type StrategicDecisionResult } from '../sim/player/strategicDecisions';
import { storeChronicleYear, type ChronicleYear } from '../sim/scenario/llm/chronicle';
import type { VoiceCue } from '../sim/scenario/llm/voiceCues';
import { applyVoiceToMessage } from '../llm/voiceJob';

/** The part of a voice cue the message upgrade needs (llm/voiceJob.ts applyVoiceToMessage). */
export type VoiceUpgrade = Pick<VoiceCue, 'scripted' | 'role' | 'kind'>;

export const HOST_OPS = {
    /** 18c (ui/aiAdvisorDriver.ts runStrategicTurn): apply the model's validated decisions for AI empire `ai`. */
    strategicDecisions: (galaxy: Galaxy, ai: Empire, decisions: StrategicDecision[], rationale: string): StrategicDecisionResult[] =>
        applyStrategicDecisions(galaxy, ai, decisions, rationale),
    /** 19s-1 (llm/chronicleJob.ts): store one year of the chronicle in the event-log state. */
    chronicleYear: (galaxy: Galaxy, entry: ChronicleYear): true => {
        storeChronicleYear(galaxy, entry);
        return true;
    },
    /** 19s-2 (llm/voiceJob.ts): upgrade a message's text in place with the voiced paragraph (false: it moved on). */
    voiceMessage: (_galaxy: Galaxy, message: EmpireMessage, cue: VoiceUpgrade, text: string): boolean => applyVoiceToMessage(message, cue as VoiceCue, text),
};

export type HostOpName = keyof typeof HOST_OPS;
type Op<K extends HostOpName> = (typeof HOST_OPS)[K];
export type HostOpArgs<K extends HostOpName> = Op<K> extends (galaxy: Galaxy, ...args: infer A) => unknown ? A : never;
export type HostOpResult<K extends HostOpName> = ReturnType<Op<K>>;

/** Run host op `op` on the authoritative galaxy (the worker). Throws on an unknown op. */
export function runHostOp(galaxy: Galaxy, op: string, args: unknown[]): unknown {
    const fn = (HOST_OPS as Record<string, ((g: Galaxy, ...a: never[]) => unknown) | undefined>)[op];
    if (fn === undefined || !Object.prototype.hasOwnProperty.call(HOST_OPS, op)) throw new Error(`sim worker: unknown host op ${op}`);
    return fn(galaxy, ...(args as never[]));
}
