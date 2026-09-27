// 19s-1 local-model request queue (tasks/19-mod-layer-scenarios.md §19s item 1). Not a port.
//
// Every model call of the LLM layer goes through ONE queue over the existing endpoint client (ui/advisorClient.ts:
// the Ollama / OpenAI-compatible probe and the schema-constrained chat request):
// - priority classes: 'player' (a voice the player is waiting for) before 'voice' before 'background' (chronicle,
//   strategic rounds); FIFO within a class;
// - a per-game-year budget of requests and tokens (scenario params llmRequestsPerYear / llmTokensPerYear); 'player'
//   requests are counted but never refused;
// - a situation-hash cache: hash(purpose + situation text (the digest) + model) → answer, kept llmCacheTtlDays game days;
//   an identical request already in flight is shared;
// - a hard timeout per request (AbortSignal + a race, so a transport that ignores the signal cannot hang the queue);
// - concurrency 1–2 (llmConcurrency);
// - graceful silence: no endpoint (the probe fails) → every request resolves at once with outcome 'silent' (callers
//   fall back to their scripted text); the probe is retried after probeRetryMs of real time;
// - metrics (requests, cache hits, tokens, …) for the dev overlay (ui/llmOverlay.ts) and __dwu.llm.
//
// THE MODEL NEVER RUNS INSIDE THE TICK: nothing under src/sim imports this module (a test checks it). Callers are the UI
// / frame-loop timers and background jobs (llm/chronicleJob.ts); answers are applied between frames. Platform-neutral
// (fetch only, through the endpoint client).

import type { Galaxy } from '../sim/galaxy';
import { YEAR_LENGTH } from '../sim/galaxyTime';
import { galaxyStarDate } from '../sim/tick/simTime';
import { scenarioParam } from '../sim/scenario/state';
import { estimateTokens } from '../sim/scenario/llm/digest';
import { probeAdvisorEndpoint, requestAdvisor, type AdvisorApi, type AdvisorEndpointConfig, type ChatMessage } from '../ui/advisorClient';

export type LlmPriority = 'player' | 'voice' | 'background';
const RANK: Record<LlmPriority, number> = { player: 0, voice: 1, background: 2 };

export type LlmOutcome = 'ok' | 'cached' | 'silent' | 'budget' | 'timeout' | 'error' | 'cancelled';

export interface LlmRequest {
    priority: LlmPriority;
    /** What asks ('chronicle', 'voice.council', …): metrics and part of the cache key. */
    purpose: string;
    /** The situation the answer depends on (the digest text): the cache key's source. */
    situation: string;
    messages: ChatMessage[];
    /** Response JSON schema (constrained output). */
    schema?: object;
    schemaName?: string;
    temperature?: number;
    /** false: never answered from / stored in the cache. */
    cache?: boolean;
}

export interface LlmResult {
    outcome: LlmOutcome;
    /** The model's answer text ('' unless ok / cached). */
    text: string;
    /** Tokens charged (estimated prompt + answer; 0 for cache hits and refusals). */
    tokens: number;
    latencyMs: number;
    error?: string;
}

/** The wire: the endpoint client in the app, a fake in tests. */
export interface LlmTransport {
    /** True when a model server answers. */
    probe(): Promise<boolean>;
    complete(req: LlmRequest, signal: AbortSignal): Promise<{ text: string; promptTokens?: number; completionTokens?: number }>;
    /** Model id (part of the cache key). */
    model(): string;
}

export interface LlmQueuePolicy {
    requestsPerYear: number;
    tokensPerYear: number;
    /** Cache lifetime in game days (0 = no cache). */
    cacheTtlDays: number;
    /** Hard timeout per request, real ms. */
    timeoutMs: number;
    /** Requests in flight at once (clamped to 1..2). */
    concurrency: number;
    /** Real ms before a failed probe is retried. */
    probeRetryMs: number;
    /** Cache entries kept (oldest dropped first). */
    cacheMax: number;
}

export const DEFAULT_LLM_POLICY: LlmQueuePolicy = {
    requestsPerYear: 60,
    tokensPerYear: 60000,
    cacheTtlDays: 90,
    timeoutMs: 90000,
    concurrency: 1,
    probeRetryMs: 60000,
    cacheMax: 200,
};

/** The policy from the llm-layer scenario params (defaults without them). */
export function llmPolicyFromGalaxy(galaxy: Galaxy): LlmQueuePolicy {
    const d = DEFAULT_LLM_POLICY;
    return {
        ...d,
        requestsPerYear: scenarioParam(galaxy, 'llmRequestsPerYear', d.requestsPerYear),
        tokensPerYear: scenarioParam(galaxy, 'llmTokensPerYear', d.tokensPerYear),
        cacheTtlDays: scenarioParam(galaxy, 'llmCacheTtlDays', d.cacheTtlDays),
        timeoutMs: scenarioParam(galaxy, 'llmTimeoutSeconds', d.timeoutMs / 1000) * 1000,
        concurrency: scenarioParam(galaxy, 'llmConcurrency', d.concurrency),
    };
}

/** Game clock the budget and the cache TTL read (the galaxy's star date in the app). */
export interface LlmClock {
    /** Game year (budget window). */
    year(): number;
    /** Game day (fractional; cache TTL). */
    day(): number;
}

export function galaxyLlmClock(galaxy: Galaxy): LlmClock {
    return {
        year: () => Math.floor(galaxyStarDate(galaxy) / YEAR_LENGTH),
        day: () => galaxyStarDate(galaxy) / (YEAR_LENGTH / 360),
    };
}

export interface LlmMetrics {
    /** 'unknown' before the first probe, 'up' / 'down' after. */
    endpoint: 'unknown' | 'probing' | 'up' | 'down';
    submitted: number;
    sent: number;
    ok: number;
    cacheHits: number;
    shared: number;
    silent: number;
    budgetRefused: number;
    timeouts: number;
    errors: number;
    cancelled: number;
    tokensIn: number;
    tokensOut: number;
    queued: number;
    inFlight: number;
    /** The current game year's budget use. */
    year: number;
    yearRequests: number;
    yearTokens: number;
    lastLatencyMs: number;
    byPurpose: Record<string, number>;
}

/** 64-bit FNV-1a as 16 hex chars (two 32-bit lanes; deterministic, no crypto dependency). */
export function situationHash(text: string): string {
    let h1 = 0x811c9dc5;
    let h2 = 0xcbf29ce4;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
        h2 = Math.imul(h2 ^ c ^ (i & 0xff), 0x01000193) >>> 0;
    }
    return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

interface Pending {
    req: LlmRequest;
    key: string | null;
    seq: number;
    resolve: (r: LlmResult) => void;
    promise: Promise<LlmResult>;
}

class TimeoutError extends Error {}

export interface LlmQueueOptions {
    transport: LlmTransport;
    clock: LlmClock;
    policy?: () => LlmQueuePolicy;
    /** Real-time clock (ms): probe retry, latency. */
    now?: () => number;
}

export class LlmQueue {
    private readonly transport: LlmTransport;
    private readonly clock: LlmClock;
    private readonly policy: () => LlmQueuePolicy;
    private readonly now: () => number;
    private readonly waiting: Pending[] = [];
    private readonly inFlight = new Map<string, Pending>();
    private running = 0;
    private seq = 0;
    private readonly cache = new Map<string, { text: string; day: number }>();
    private probePromise: Promise<boolean> | null = null;
    private lastProbeAt = -Infinity;
    private disposed = false;
    private readonly aborts = new Set<AbortController>();
    private readonly m: LlmMetrics = {
        endpoint: 'unknown',
        submitted: 0,
        sent: 0,
        ok: 0,
        cacheHits: 0,
        shared: 0,
        silent: 0,
        budgetRefused: 0,
        timeouts: 0,
        errors: 0,
        cancelled: 0,
        tokensIn: 0,
        tokensOut: 0,
        queued: 0,
        inFlight: 0,
        year: -1,
        yearRequests: 0,
        yearTokens: 0,
        lastLatencyMs: 0,
        byPurpose: {},
    };

    constructor(opts: LlmQueueOptions) {
        this.transport = opts.transport;
        this.clock = opts.clock;
        this.policy = opts.policy ?? (() => DEFAULT_LLM_POLICY);
        this.now = opts.now ?? (() => Date.now());
    }

    /** A copy of the counters (the dev overlay polls it). */
    metrics(): LlmMetrics {
        this.rollYear();
        return { ...this.m, queued: this.waiting.length, inFlight: this.running, byPurpose: { ...this.m.byPurpose } };
    }

    /** True while the endpoint answered its last probe. */
    get available(): boolean {
        return this.m.endpoint === 'up';
    }

    /** Probe now when due (unknown, or down for probeRetryMs). Resolves to the endpoint state. */
    ensureProbe(): Promise<boolean> {
        if (this.m.endpoint === 'up') return Promise.resolve(true);
        if (this.probePromise !== null) return this.probePromise;
        if (this.m.endpoint === 'down' && this.now() - this.lastProbeAt < this.policy().probeRetryMs) return Promise.resolve(false);
        this.lastProbeAt = this.now();
        this.m.endpoint = 'probing';
        this.probePromise = this.transport
            .probe()
            .catch(() => false)
            .then((up) => {
                this.m.endpoint = up ? 'up' : 'down';
                this.probePromise = null;
                return up;
            });
        return this.probePromise;
    }

    /** Queue a request; never rejects (failures resolve with their outcome). */
    submit(req: LlmRequest): Promise<LlmResult> {
        this.m.submitted++;
        this.m.byPurpose[req.purpose] = (this.m.byPurpose[req.purpose] ?? 0) + 1;
        if (this.disposed) return Promise.resolve(this.finish({ outcome: 'cancelled', text: '', tokens: 0, latencyMs: 0 }));
        const pol = this.policy();
        const key = req.cache === false || pol.cacheTtlDays <= 0 ? null : situationHash(`${req.purpose}\n${this.transport.model()}\n${req.situation}`);
        if (key !== null) {
            const hit = this.cache.get(key);
            if (hit !== undefined) {
                if (this.clock.day() - hit.day <= pol.cacheTtlDays) {
                    this.m.cacheHits++;
                    return Promise.resolve({ outcome: 'cached', text: hit.text, tokens: 0, latencyMs: 0 });
                }
                this.cache.delete(key);
            }
            const shared = this.inFlight.get(key) ?? this.waiting.find((p) => p.key === key);
            if (shared !== undefined) {
                this.m.shared++;
                return shared.promise;
            }
        }
        let resolve!: (r: LlmResult) => void;
        const promise = new Promise<LlmResult>((r) => (resolve = r));
        const p: Pending = { req, key, seq: this.seq++, resolve, promise };
        this.waiting.push(p);
        void this.ensureProbe().then(() => this.pump());
        return promise;
    }

    private rollYear(): void {
        const y = this.clock.year();
        if (y !== this.m.year) {
            this.m.year = y;
            this.m.yearRequests = 0;
            this.m.yearTokens = 0;
        }
    }

    private finish(r: LlmResult): LlmResult {
        switch (r.outcome) {
            case 'silent':
                this.m.silent++;
                break;
            case 'budget':
                this.m.budgetRefused++;
                break;
            case 'timeout':
                this.m.timeouts++;
                break;
            case 'error':
                this.m.errors++;
                break;
            case 'cancelled':
                this.m.cancelled++;
                break;
            default:
                break;
        }
        return r;
    }

    private next(): Pending | undefined {
        if (this.waiting.length === 0) return undefined;
        let best = 0;
        for (let i = 1; i < this.waiting.length; i++) {
            const a = this.waiting[i];
            const b = this.waiting[best];
            if (RANK[a.req.priority] < RANK[b.req.priority] || (RANK[a.req.priority] === RANK[b.req.priority] && a.seq < b.seq)) best = i;
        }
        return this.waiting.splice(best, 1)[0];
    }

    private pump(): void {
        if (this.disposed) return;
        if (this.m.endpoint === 'down') {
            // Graceful silence: nothing is sent while no model answers.
            for (const p of this.waiting.splice(0)) p.resolve(this.finish({ outcome: 'silent', text: '', tokens: 0, latencyMs: 0 }));
            return;
        }
        if (this.m.endpoint !== 'up') return;
        const pol = this.policy();
        const limit = Math.max(1, Math.min(2, Math.trunc(pol.concurrency)));
        while (this.running < limit) {
            const p = this.next();
            if (p === undefined) return;
            this.rollYear();
            const promptTokens = estimateTokens(p.req.messages.map((x) => x.content).join('\n'));
            if (p.req.priority !== 'player' && (this.m.yearRequests >= pol.requestsPerYear || this.m.yearTokens + promptTokens > pol.tokensPerYear)) {
                p.resolve(this.finish({ outcome: 'budget', text: '', tokens: 0, latencyMs: 0 }));
                continue;
            }
            this.m.yearRequests++;
            this.m.yearTokens += promptTokens;
            this.running++;
            if (p.key !== null) this.inFlight.set(p.key, p);
            void this.send(p, promptTokens, pol.timeoutMs).then((r) => {
                this.running--;
                if (p.key !== null) this.inFlight.delete(p.key);
                p.resolve(this.finish(r));
                this.pump();
            });
        }
    }

    private async send(p: Pending, promptTokens: number, timeoutMs: number): Promise<LlmResult> {
        this.m.sent++;
        const ctrl = new AbortController();
        this.aborts.add(ctrl);
        const t0 = this.now();
        let timer: ReturnType<typeof setTimeout> | null = null;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
                ctrl.abort();
                reject(new TimeoutError(`no answer in ${timeoutMs} ms`));
            }, timeoutMs);
        });
        try {
            const r = await Promise.race([this.transport.complete(p.req, ctrl.signal), timeout]);
            const latencyMs = Math.round(this.now() - t0);
            this.m.lastLatencyMs = latencyMs;
            const inTok = r.promptTokens ?? promptTokens;
            const outTok = r.completionTokens ?? estimateTokens(r.text);
            this.m.tokensIn += inTok;
            this.m.tokensOut += outTok;
            // The budget charged the estimate up front; settle it with the real prompt size and the answer.
            this.m.yearTokens += inTok - promptTokens + outTok;
            this.m.ok++;
            if (p.key !== null) {
                this.cache.set(p.key, { text: r.text, day: this.clock.day() });
                const max = Math.max(1, this.policy().cacheMax);
                while (this.cache.size > max) this.cache.delete(this.cache.keys().next().value as string);
            }
            return { outcome: 'ok', text: r.text, tokens: inTok + outTok, latencyMs };
        } catch (e) {
            const latencyMs = Math.round(this.now() - t0);
            if (e instanceof TimeoutError) return { outcome: 'timeout', text: '', tokens: 0, latencyMs, error: e.message };
            if (this.disposed) return { outcome: 'cancelled', text: '', tokens: 0, latencyMs };
            return { outcome: 'error', text: '', tokens: 0, latencyMs, error: e instanceof Error ? e.message : String(e) };
        } finally {
            if (timer !== null) clearTimeout(timer);
            this.aborts.delete(ctrl);
        }
    }

    /** Drop the cache (e.g. after the model changed). */
    clearCache(): void {
        this.cache.clear();
    }

    /** Cancel everything: waiting requests resolve 'cancelled', requests in flight are aborted. */
    dispose(): void {
        this.disposed = true;
        for (const p of this.waiting.splice(0)) p.resolve(this.finish({ outcome: 'cancelled', text: '', tokens: 0, latencyMs: 0 }));
        for (const c of this.aborts) c.abort();
    }
}

// ---------------------------------------------------------------------------------------------------------------
// The app transport: the existing endpoint client (advisorClient.ts), configured from the advisor settings.
// ---------------------------------------------------------------------------------------------------------------

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface EndpointSettings extends AdvisorEndpointConfig {
    think?: boolean;
}

/** An LlmTransport over probeAdvisorEndpoint + requestAdvisor (the settings are read on every call). */
export function advisorTransport(settings: () => EndpointSettings, fetchImpl?: FetchLike): LlmTransport {
    let api: AdvisorApi | null = null;
    return {
        model: () => settings().model,
        probe: async () => {
            const s = settings();
            if (s.endpoint.trim() === '' || s.model.trim() === '') return false;
            api = await probeAdvisorEndpoint(s, fetchImpl);
            return api !== null;
        },
        complete: async (req, signal) => {
            const s = settings();
            if (api === null) throw new Error('no model endpoint');
            const r = await requestAdvisor({ endpoint: s.endpoint, model: s.model, api, think: s.think }, req.messages, {
                fetchImpl,
                signal,
                // The queue races its own hard timeout; this is only the client's backstop.
                timeoutMs: 600000,
                schema: req.schema,
                schemaName: req.schemaName,
                temperature: req.temperature,
            });
            return { text: r.raw };
        },
    };
}
