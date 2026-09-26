// 18c — AI empires' strategic decisions by the local model (tasks/18-local-llm-diplomacy.md).
//
// Every `aiAdvisorIntervalDays` game-days (star-date days, 30 per month) the driver takes the selected AI empires one
// at a time (default: those the player has met, at most 4): builds the strategic brief (sim/player/strategicBrief.ts),
// asks the model (advisorClient.ts requestAdvisor, schema-constrained), validates the answer and applies it through
// sim/player/strategicDecisions.ts, which re-checks every gate and journals each command in the command log. The
// model's rationale and the outcome go to the log panel (aiAdvisorLog.ts) — the player sees why an empire acted.
//
// The model never runs inside the tick: the driver polls on a timer between render frames, requests are async, and a
// validated answer is applied in the request's continuation (between frames, like a click). It never blocks the sim:
// while a request is out the game keeps running, and a paused game (no star-date progress) asks nothing.
// Off (settings.aiAdvisor false) or no model server → the driver does nothing, and the game is the scripted one.
// Uses only fetch (platform-neutral; no Node APIs).

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import { DiplomaticRelationType } from '../sim/diplomacy';
import { galaxyStarDate } from '../sim/tick/simTime';
import { resolveStarDateDescription } from '../sim/galaxyTime';
import { buildStrategicBrief, strategicPersonaLines, type StrategicBrief } from '../sim/player/strategicBrief';
import {
    applyStrategicDecisions,
    strategicResponseSchema,
    validateStrategicResponse,
    type RejectedStrategicDecision,
    type StrategicDecisionResult,
} from '../sim/player/strategicDecisions';
import { probeAdvisorEndpoint, requestAdvisor, type AdvisorApi, type ChatMessage } from './advisorClient';
import { getSettings, type UiSettings } from './settings';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** One star-date day in game ms (Galaxy.cs ResolveStarDateDescription: a year of 12 months of 30 days). */
export const STAR_DATE_DAY_MS = (600 * 1000) / 12 / 30;

export interface StrategicModelConfig {
    endpoint: string;
    model: string;
    api: AdvisorApi;
    think?: boolean;
}

// ---------------------------------------------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------------------------------------------

/** The persona + rules + brief the model sees. */
export function buildStrategicSystemPrompt(brief: StrategicBrief): string {
    const who = brief.speaker !== null ? `${brief.speaker.name}, ruler of the ${brief.empire.name}` : `the ruler of the ${brief.empire.name}`;
    const lines = [
        `You are ${who}, a ${brief.empire.race} (${brief.empire.raceFamily}) empire in the space strategy game Distant Worlds. It is star date ${brief.empire.starDate}.`,
        ...strategicPersonaLines(brief),
        'Your council (the game\'s own AI) already runs your fleets, economy, colonization and construction, and it has set your strategy toward each empire (empires[].yourStrategy). Do not second-guess it.',
        'Your task: make the few strategic choices the council leaves open, so that your empire acts deliberately and in character. The legal choices are in DECISIONS.',
        'Pick at most 3 entries from DECISIONS by "id" (never invent ids). For an entry with a "to" list, set "targetId" to exactly one value from that list (its "now" value is already set: do not pick that entry just to keep it); otherwise leave targetId out.',
        'Choose only what your race\'s temperament and the facts in BRIEF clearly support (strength, attitudes, threats, money, what your strategy wants). If nothing is compelling, choose [{"id":"none"}]. Changing a policy back and forth is pointless: keep a setting unless the situation changed.',
        'A war declaration goes ahead only when your fleets are ready; a treaty offer is answered by the other empire. Tech emphasis steers research and ship designs: pick one that complements your fixed emphases and your threats.',
        'Write "rationale" first: one or two sentences in character (first person plural for your people) naming the facts behind your choice. Do not mention ids or JSON.',
        'Answer with JSON only: {"rationale": string, "decisions": [{"id": string, "targetId"?: string}]}.',
    ];
    const { decisions, ...facts } = brief;
    lines.push('', 'BRIEF:', JSON.stringify(facts), '', 'DECISIONS:', JSON.stringify(decisions));
    return lines.join('\n');
}

export function buildStrategicMessages(brief: StrategicBrief): ChatMessage[] {
    return [
        { role: 'system', content: buildStrategicSystemPrompt(brief) },
        { role: 'user', content: 'Your council awaits your strategic decisions.' },
    ];
}

// ---------------------------------------------------------------------------------------------------------------
// One empire's turn
// ---------------------------------------------------------------------------------------------------------------

export interface StrategicTurn {
    empire: Empire;
    empireName: string;
    /** Star date (formatted) when the decisions were applied (or the request failed). */
    starDate: string;
    rationale: string;
    results: StrategicDecisionResult[];
    rejected: RejectedStrategicDecision[];
    error?: string;
    latencyMs: number;
    raw: string;
}

/**
 * Ask the model for `ai`'s strategic decisions and apply the valid ones. The brief is built when the request starts;
 * the answer is applied when it arrives (between frames), each decision re-checked on the live galaxy.
 */
export async function runStrategicTurn(args: {
    galaxy: Galaxy;
    ai: Empire;
    cfg: StrategicModelConfig;
    fetchImpl?: FetchLike;
    signal?: AbortSignal;
    timeoutMs?: number;
}): Promise<StrategicTurn> {
    const { galaxy, ai } = args;
    const brief = buildStrategicBrief(galaxy, ai);
    const turn: StrategicTurn = { empire: ai, empireName: ai.name, starDate: '', rationale: '', results: [], rejected: [], latencyMs: 0, raw: '' };
    try {
        const r = await requestAdvisor(args.cfg, buildStrategicMessages(brief), {
            fetchImpl: args.fetchImpl,
            signal: args.signal,
            timeoutMs: args.timeoutMs ?? 90000,
            schema: strategicResponseSchema(brief),
            schemaName: 'strategic_decisions',
            temperature: 0.4,
        });
        turn.raw = r.raw;
        turn.latencyMs = r.latencyMs;
    } catch (e) {
        turn.error = e instanceof Error ? e.message : String(e);
        turn.starDate = resolveStarDateDescription(galaxyStarDate(galaxy));
        return turn;
    }
    turn.starDate = resolveStarDateDescription(galaxyStarDate(galaxy));
    if (args.signal?.aborted === true || !ai.active) {
        turn.error = 'cancelled';
        return turn;
    }
    const v = validateStrategicResponse(brief, turn.raw);
    turn.rationale = v.rationale;
    turn.rejected = v.rejected;
    if (v.error !== undefined) {
        turn.error = v.error;
        return turn;
    }
    turn.results = applyStrategicDecisions(galaxy, ai, v.decisions, v.rationale);
    return turn;
}

// ---------------------------------------------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------------------------------------------

/** The AI empires the model decides for: normal (non-pirate, active) empires other than the player; with 'met', only
 *  those the player has met; at most `max`, in the galaxy's empire order. */
export function selectAdvisedEmpires(galaxy: Galaxy, player: Empire | null, mode: 'met' | 'all', max: number): Empire[] {
    const out: Empire[] = [];
    for (const e of galaxy.empires) {
        if (out.length >= max) break;
        if (e === player || !e.active || e === galaxy.independentEmpire || e.pirateEmpireBaseHabitat !== null) continue;
        if (mode === 'met') {
            if (player === null) continue;
            const rel = player.diplomaticRelations.byEmpire(e);
            if (rel === null || rel.type === DiplomaticRelationType.NotMet) continue;
        }
        out.push(e);
    }
    return out;
}

export type AiAdvisorSettings = Pick<UiSettings, 'aiAdvisor' | 'aiAdvisorIntervalDays' | 'aiAdvisorEmpires' | 'aiAdvisorMaxEmpires' | 'advisorEndpoint' | 'advisorModel' | 'advisorApi' | 'advisorThink'>;

export interface AiAdvisorDriverOptions {
    galaxy: Galaxy;
    player: Empire | null;
    settings?: () => AiAdvisorSettings;
    fetchImpl?: FetchLike;
    /** Real-time clock (ms) for the probe retry. */
    now?: () => number;
    /** Called with every finished turn (the log panel). */
    onTurn?: (turn: StrategicTurn) => void;
}

/** Probe again after a failed probe (real ms). */
const PROBE_RETRY_MS = 60000;

export class AiAdvisorDriver {
    readonly galaxy: Galaxy;
    readonly player: Empire | null;
    readonly turns: StrategicTurn[] = [];
    private readonly settings: () => AiAdvisorSettings;
    private readonly fetchImpl: FetchLike | undefined;
    private readonly now: () => number;
    private readonly onTurn: ((turn: StrategicTurn) => void) | undefined;
    private api: AdvisorApi | null = null;
    private probing = false;
    private lastProbeAt = -Infinity;
    /** Star date (ms) of the next round; the first round waits one interval from when the feature is first seen on. */
    private nextDue: number | null = null;
    private busy: Promise<void> | null = null;
    private readonly abort = new AbortController();
    private disposed = false;

    constructor(opts: AiAdvisorDriverOptions) {
        this.galaxy = opts.galaxy;
        this.player = opts.player;
        this.settings = opts.settings ?? getSettings;
        this.fetchImpl = opts.fetchImpl;
        this.now = opts.now ?? (() => Date.now());
        this.onTurn = opts.onTurn;
    }

    /** A round is in flight. */
    get running(): boolean {
        return this.busy !== null;
    }

    /** The promise of the round in flight (tests). */
    get pending(): Promise<void> | null {
        return this.busy;
    }

    /**
     * Cheap per-poll check (a timer between frames): nothing when off; otherwise probe the endpoint once, and start a
     * round when the star date has passed the next due date and no round is in flight. Never awaits.
     */
    poll(): void {
        if (this.disposed) return;
        const s = this.settings();
        if (!s.aiAdvisor) {
            this.nextDue = null;
            return;
        }
        const interval = Math.max(1, s.aiAdvisorIntervalDays) * STAR_DATE_DAY_MS;
        const date = galaxyStarDate(this.galaxy);
        if (this.nextDue === null) this.nextDue = date + interval;
        if (this.api === null) {
            if (!this.probing && this.now() - this.lastProbeAt >= PROBE_RETRY_MS) void this.probe(s);
            return;
        }
        if (this.busy !== null || date < this.nextDue) return;
        this.nextDue = date + interval;
        const empires = selectAdvisedEmpires(this.galaxy, this.player, s.aiAdvisorEmpires, Math.max(1, s.aiAdvisorMaxEmpires));
        if (empires.length === 0) return;
        const cfg: StrategicModelConfig = { endpoint: s.advisorEndpoint, model: s.advisorModel, api: this.api, think: s.advisorThink };
        this.busy = this.round(empires, cfg).finally(() => {
            this.busy = null;
        });
    }

    private async probe(s: AiAdvisorSettings): Promise<void> {
        this.probing = true;
        this.lastProbeAt = this.now();
        try {
            this.api = await probeAdvisorEndpoint({ endpoint: s.advisorEndpoint, model: s.advisorModel, api: s.advisorApi }, this.fetchImpl);
        } finally {
            this.probing = false;
        }
    }

    /** One round: the empires one after another (one request in flight at a time). */
    private async round(empires: Empire[], cfg: StrategicModelConfig): Promise<void> {
        for (const ai of empires) {
            if (this.disposed) return;
            if (!ai.active) continue;
            const turn = await runStrategicTurn({ galaxy: this.galaxy, ai, cfg, fetchImpl: this.fetchImpl, signal: this.abort.signal });
            if (this.disposed) return;
            this.turns.push(turn);
            if (this.turns.length > 50) this.turns.splice(0, this.turns.length - 50);
            try {
                this.onTurn?.(turn);
            } catch {
                // A broken listener must never break the round.
            }
        }
    }

    dispose(): void {
        this.disposed = true;
        this.abort.abort();
    }
}

/** App wiring: the driver polled every half second of real time (between frames); disposed with the game view. */
export function startAiAdvisorDriver(opts: AiAdvisorDriverOptions, pollMs = 500): { driver: AiAdvisorDriver; dispose: () => void } {
    const driver = new AiAdvisorDriver(opts);
    const t = setInterval(() => driver.poll(), pollMs);
    return {
        driver,
        dispose: () => {
            clearInterval(t);
            driver.dispose();
        },
    };
}

/** URL overrides for dev / captures (not persisted): `?aiAdvisor=1`, `aiAdvisorDays=<n>`, `aiAdvisorEmpires=met|all`. */
export function aiAdvisorSettingsWithUrl(s: AiAdvisorSettings, params: URLSearchParams): AiAdvisorSettings {
    const out = { ...s };
    const on = params.get('aiAdvisor');
    if (on === '1') out.aiAdvisor = true;
    else if (on === '0') out.aiAdvisor = false;
    const days = Number(params.get('aiAdvisorDays'));
    if (params.has('aiAdvisorDays') && Number.isFinite(days) && days >= 1) out.aiAdvisorIntervalDays = Math.round(days);
    const which = params.get('aiAdvisorEmpires');
    if (which === 'met' || which === 'all') out.aiAdvisorEmpires = which;
    return out;
}
