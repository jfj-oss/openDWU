// 19s-3 STRATEGIC UPGRADE job (tasks/19-mod-layer-scenarios.md §19s item 3; the 18c strategic layer, grounded). Not a
// port.
//
// Polled from the UI timer (llm/llmLayer.ts), never from the tick. Once per game year each of the N AI empires nearest
// the player (sim/scenario/llm/strategic.ts nearestAiEmpires, param llmStrategicEmpires) gets a slot: slot i falls due
// STRATEGIC_SLOT_DAYS × i + 15 game days into the year (the pass is spread over the year, one empire per 30 days, not
// all on day 1) and stays open for one slot length. When due, the job builds the empire's grounding digest (digestFor,
// ≤ 400 tokens) and its legal moves (legalMoves), and asks the model through the foundations queue at 'background'
// priority (budgeted, cached by situation) for a schema-constrained choice among the move ids. At most one request per
// empire is in flight.
//
// The answer is validated against the moves offered (validateStrategicAnswer) and ALWAYS leaves as a command through
// the player command queue (playerOps `llmStrategic`): applied at the next frame boundary, where the move is
// re-checked on the live galaxy, and journaled — the model's code never touches the sim, and a replay needs no model.
// Refused / invalid / timed-out / over-budget answers are sent as refusal commands (logged; the rules decide). No model
// at all (graceful silence) sends nothing.

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import { YEAR_LENGTH } from '../sim/galaxyTime';
import { galaxyStarDate } from '../sim/tick/simTime';
import { GAME_DAY_LENGTH } from '../sim/scenario/hooks';
import { governmentName, personaLines, raceBonuses, raceTraits, RACE_FAMILY_NAMES } from '../sim/player/diplomatBrief';
import { digestFor, digestJson } from '../sim/scenario/llm/digest';
import {
    STRATEGIC_SLOT_DAYS,
    legalMoves,
    nearestAiEmpires,
    strategicDecided,
    strategicEmpireCount,
    strategicOn,
    strategicSchema,
    validateStrategicAnswer,
    type LegalMove,
    type LlmStrategicCommand,
} from '../sim/scenario/llm/strategic';
import { issuePlayerCommand } from '../sim/player/playerCommands';
import type { ChatMessage } from '../ui/advisorClient';
import type { LlmQueue, LlmResult } from './queue';
import { readReplica } from './replicaReads';

/** Bump when the prompt changes (part of the situation-cache key). */
export const STRATEGIC_PROMPT_VERSION = 1;

/** The system + user messages for one empire's yearly choice. */
export function buildStrategicMessages(galaxy: Galaxy, empire: Empire, moves: readonly LegalMove[]): { messages: ChatMessage[]; situation: string } {
    const race = empire.dominantRace ?? null;
    const gov = governmentName(empire);
    const persona = personaLines({ race: raceTraits(race), raceBonuses: raceBonuses(race), speaker: null, empire: { race: race?.name ?? 'unknown', government: gov } }).join(' ');
    const raceWords = race !== null ? `${race.name} (${RACE_FAMILY_NAMES[race.raceFamily] ?? ''})` : 'mixed';
    const digest = digestJson(digestFor(galaxy, empire));
    const system = [
        `You are the ruler of the ${empire.name}, a ${raceWords} ${gov} in the space strategy game Distant Worlds.`,
        persona,
        'Your ministers (the game\'s own AI) run fleets, economy and diplomacy day to day. Once a year you make ONE deliberate strategic move of your own, or none.',
        'SITUATION is your court\'s digest of the realm. MOVES are the only legal moves this year (council motions and votes, peace terms, war goals, investigations, concessions to discontented nobles, offers to independent leagues, the herder path).',
        'Pick the one move your people\'s temperament and the facts in SITUATION most clearly support; if none is compelling, choose "none".',
        'Answer with JSON only: {"reason": string, "choice": string}. Write "reason" first: one or two sentences in character naming the facts behind it; no ids. "choice" is exactly one MOVES id, or "none".',
        '',
        `SITUATION: ${digest}`,
        '',
        `MOVES: ${JSON.stringify(moves.map((m) => ({ id: m.id, move: m.text })))}`,
    ].join('\n');
    const user = 'The year\'s council is assembled. What is your move?';
    return { messages: [{ role: 'system', content: system }, { role: 'user', content: user }], situation: `strategic v${STRATEGIC_PROMPT_VERSION}\n${system}` };
}

/** The star date slot `i` of game year `year` falls due. */
export function strategicSlotDue(year: number, i: number): number {
    return year * YEAR_LENGTH + (STRATEGIC_SLOT_DAYS * i + 15) * GAME_DAY_LENGTH;
}

/** One finished request (the job's in-memory record; the persistent log is the sim's decision log). */
export interface StrategicAsk {
    empire: Empire;
    year: number;
    moves: LegalMove[];
    outcome: LlmResult['outcome'];
    /** The command issued (null: nothing was sent — no model, cancelled, or no legal move). */
    command: LlmStrategicCommand | null;
}

export interface StrategicJobOptions {
    galaxy: Galaxy;
    player: Empire | null;
    queue: LlmQueue;
    /** Called with each finished request (tests / dev). */
    onAsk?: (a: StrategicAsk) => void;
}

export class StrategicJob {
    /** empireId → the request in flight (at most one per empire). */
    private readonly inFlight = new Map<number, Promise<StrategicAsk | null>>();
    /** `${year}:${empireId}` asked in this session. */
    private readonly asked = new Set<string>();
    private disposed = false;
    readonly asks: StrategicAsk[] = [];

    constructor(private readonly opts: StrategicJobOptions) {}

    /** The requests in flight (tests). */
    get pending(): Promise<unknown> {
        return Promise.all([...this.inFlight.values()]);
    }

    /** The empires of this year's pass, slot order (pure). */
    empires(): Empire[] {
        return nearestAiEmpires(this.opts.galaxy, this.opts.player, strategicEmpireCount(this.opts.galaxy));
    }

    /** Cheap poll (UI timer): start every slot that is due now and not asked yet. Never awaits. */
    poll(): void {
        const { galaxy } = this.opts;
        if (this.disposed || !strategicOn(galaxy)) return;
        const now = galaxyStarDate(galaxy);
        const year = Math.floor(now / YEAR_LENGTH);
        this.empires().forEach((e, i) => {
            const due = strategicSlotDue(year, i);
            if (now < due || now >= due + STRATEGIC_SLOT_DAYS * GAME_DAY_LENGTH) return;
            this.ask(e, year);
        });
    }

    /** Asks for `e`'s move of pass `year` unless it is in flight, asked or already logged. Returns the request. */
    ask(e: Empire, year: number): Promise<StrategicAsk | null> | null {
        const { galaxy } = this.opts;
        const key = `${year}:${e.empireId}`;
        if (this.disposed || this.inFlight.has(e.empireId) || this.asked.has(key) || strategicDecided(galaxy, e, year)) return null;
        this.asked.add(key);
        const p = this.run(e, year).finally(() => this.inFlight.delete(e.empireId));
        this.inFlight.set(e.empireId, p);
        return p;
    }

    private async run(e: Empire, year: number): Promise<StrategicAsk | null> {
        const { galaxy, queue } = this.opts;
        const moves = readReplica(galaxy, () => legalMoves(galaxy, e));
        if (moves.length === 0) return null;
        const { messages, situation } = readReplica(galaxy, () => buildStrategicMessages(galaxy, e, moves));
        let res: LlmResult;
        try {
            res = await queue.submit({ priority: 'background', purpose: 'strategic', situation, messages, schema: strategicSchema(moves), schemaName: 'strategic_move', temperature: 0.4 });
        } catch (err) {
            res = { outcome: 'error', text: '', tokens: 0, latencyMs: 0, error: String(err) };
        }
        if (this.disposed || !strategicOn(galaxy)) return null;
        const offered = moves.map((m) => m.id);
        let command: LlmStrategicCommand | null = null;
        if (res.outcome === 'ok' || res.outcome === 'cached') {
            const v = validateStrategicAnswer(moves, res.text);
            command = v.choice !== null ? { year, offered, choice: v.choice, reason: v.reason } : { year, offered, choice: null, reason: `invalid answer: ${v.error ?? '?'}` };
        } else if (res.outcome === 'timeout' || res.outcome === 'error' || res.outcome === 'budget') {
            command = { year, offered, choice: null, reason: `${res.outcome}${res.error !== undefined ? `: ${res.error}` : ''}`.slice(0, 200) };
        }
        // 'silent' (no model) and 'cancelled' send nothing: the rules simply run.
        if (command !== null) issuePlayerCommand(galaxy, e, 'llmStrategic', [command]);
        const ask: StrategicAsk = { empire: e, year, moves, outcome: res.outcome, command };
        this.asks.push(ask);
        if (this.asks.length > 50) this.asks.splice(0, this.asks.length - 50);
        try {
            this.opts.onAsk?.(ask);
        } catch {
            // a broken listener must not break the job
        }
        return ask;
    }

    dispose(): void {
        this.disposed = true;
    }
}
