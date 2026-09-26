// 18a — the chat advisor's model client: one request per player message to a local model server, with the answer
// constrained to the advisor response schema (src/sim/player/advisorCommands.ts ADVISOR_RESPONSE_SCHEMA).
// Two wire protocols:
// - Ollama   POST {endpoint}/api/chat               { model, messages, format: <json schema>, stream: false, think: false }
// - OpenAI   POST {endpoint}/v1/chat/completions    { model, messages, response_format: { type: 'json_schema', … } }
//   (llama-server, vLLM, LM Studio …).
// The feature is off unless the endpoint answers the probe. Uses only fetch (platform-neutral; no Node APIs).
// The model never runs inside the tick: the panel calls this between frames and executes the validated answer through
// the player command layer.

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import { buildAdvisorBrief, type AdvisorBrief, type AdvisorSelection } from '../sim/player/advisorBrief';
import {
    ADVISOR_RESPONSE_SCHEMA,
    executeAdvisorCommands,
    validateAdvisorResponse,
    type AdvisorCommandResult,
    type RejectedCommand,
} from '../sim/player/advisorCommands';

export type AdvisorApi = 'ollama' | 'openai';

export interface AdvisorEndpointConfig {
    endpoint: string;
    model: string;
    api: 'auto' | AdvisorApi;
}

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface AdvisorReply {
    /** The model's raw answer text (the JSON). */
    raw: string;
    /** Wall-clock time of the request, ms. */
    latencyMs: number;
    api: AdvisorApi;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function base(endpoint: string): string {
    return endpoint.replace(/\/+$/, '');
}

function withTimeout(ms: number, outer?: AbortSignal): { signal: AbortSignal; done: () => void } {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    const onAbort = (): void => ctrl.abort();
    outer?.addEventListener('abort', onAbort);
    return {
        signal: ctrl.signal,
        done: () => {
            clearTimeout(t);
            outer?.removeEventListener('abort', onAbort);
        },
    };
}

/**
 * Probe the endpoint: Ollama answers GET /api/version, an OpenAI-compatible server GET /v1/models. Returns the protocol
 * that answered (the configured one first), or null when nothing responds (the advisor stays off).
 */
export async function probeAdvisorEndpoint(cfg: AdvisorEndpointConfig, fetchImpl: FetchLike = fetch, timeoutMs = 1500): Promise<AdvisorApi | null> {
    const order: AdvisorApi[] = cfg.api === 'openai' ? ['openai'] : cfg.api === 'ollama' ? ['ollama'] : ['ollama', 'openai'];
    for (const api of order) {
        const url = api === 'ollama' ? `${base(cfg.endpoint)}/api/version` : `${base(cfg.endpoint)}/v1/models`;
        const t = withTimeout(timeoutMs);
        try {
            const r = await fetchImpl(url, { signal: t.signal });
            if (r.ok) return api;
        } catch {
            // not this one
        } finally {
            t.done();
        }
    }
    return null;
}

/** The persona + rules + brief the model sees as its system message. */
export function buildAdvisorSystemPrompt(brief: AdvisorBrief): string {
    const who = brief.admiral !== null ? `${brief.admiral.name}, ${brief.admiral.role === 'FleetAdmiral' ? 'Fleet Admiral' : 'ruling Leader acting as fleet admiral'} of the ${brief.empire.name}` : `the Fleet Admiral of the ${brief.empire.name}`;
    return [
        `You are ${who}, in the space strategy game Distant Worlds. The player is your sovereign and talks to you in chat.`,
        'Reply in character: one to three short sentences, plain text, no lists.',
        'You give orders ONLY by choosing entries from BRIEF.commands by their "id". Never invent ids.',
        'If the chosen command has a "to" list, set "targetId" to ONE ref from that list. Shorthands: "*" = any ref from places, ships or fleets;',
        '"places" = any place ref; "systems" = the ref of any place whose kind is System; "ships" = any other ship ref. Never copy the shorthand word itself.',
        'A command whose "to" is a single ref already has its target: do not set targetId.',
        'Set "queue": true only when the player asks for it to happen after the current task; otherwise leave it out (the order replaces the current mission).',
        '"note" says what a command does (e.g. "nearest unexplored system", "at nearest refuelling point", "form a new fleet"). Build takes "count".',
        'Examples: {"id":"c11","who":"s249","do":"Explore","to":"h1379","note":"nearest unexplored system"} is ordered as {"id":"c11"};',
        '{"id":"c12","who":"s249","do":"Explore","to":"systems"} is ordered as {"id":"c12","targetId":"h86"} (h86 being a System in places).',
        'Match the player\'s words to the brief: ship names or types (ExplorationShip = explorer, ConstructionShip = constructor), fleet names, place names, empire names.',
        'When several ships fit equally, take the first one listed in ships (they are ordered: selected, idle, nearest).',
        'If the order is unwise by the brief\'s facts (low fuel, a colony left undefended, an ally or unmet empire, cannot afford it), you may object with that reason and give no commands.',
        'If the player then says "do it anyway" (or insists), obey without further objection.',
        'If the request is ambiguous and nothing in the brief decides it, ask one short question and give no commands.',
        'Commands marked "confirm": only add "confirm": true when the player has explicitly confirmed that war declaration.',
        'Only act on the player\'s LAST message; the earlier chat is context only (do not repeat old orders or replies).',
        'Answer with JSON only: {"reply": string, "commands": [{"id": string, "targetId"?: string, "queue"?: boolean, "confirm"?: boolean, "count"?: number}]}.',
        '',
        'BRIEF:',
        JSON.stringify(brief),
    ].join('\n');
}

/** Pull the answer text out of an Ollama / OpenAI chat response body. */
export function extractReplyText(api: AdvisorApi, body: unknown): string {
    const b = body as { message?: { content?: unknown }; choices?: { message?: { content?: unknown } }[] };
    const text = api === 'ollama' ? b?.message?.content : b?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new Error('the model server returned no message');
    // Some thinking models still wrap the answer: drop a <think>…</think> block and ``` fences.
    return text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '').trim();
}

/** Send the conversation and get the model's structured answer. Throws on HTTP / network errors and on timeout. */
export async function requestAdvisor(
    cfg: { endpoint: string; model: string; api: AdvisorApi; think?: boolean },
    messages: ChatMessage[],
    opts: {
        fetchImpl?: FetchLike;
        timeoutMs?: number;
        signal?: AbortSignal;
        now?: () => number;
        /** Response JSON schema (default: the advisor's); 18b diplomat voice passes its own. */
        schema?: object;
        schemaName?: string;
        temperature?: number;
    } = {},
): Promise<AdvisorReply> {
    const fetchImpl = opts.fetchImpl ?? fetch;
    const now = opts.now ?? (() => performance.now());
    const url = cfg.api === 'ollama' ? `${base(cfg.endpoint)}/api/chat` : `${base(cfg.endpoint)}/v1/chat/completions`;
    const schema = opts.schema ?? ADVISOR_RESPONSE_SCHEMA;
    const temperature = opts.temperature ?? 0.2;
    const body =
        cfg.api === 'ollama'
            ? { model: cfg.model, messages, format: schema, stream: false, think: cfg.think === true, options: { temperature } }
            : {
                  model: cfg.model,
                  messages,
                  temperature,
                  stream: false,
                  response_format: { type: 'json_schema', json_schema: { name: opts.schemaName ?? 'advisor_response', schema } },
              };
    const t = withTimeout(opts.timeoutMs ?? 120000, opts.signal);
    const t0 = now();
    try {
        const r = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: t.signal });
        if (!r.ok) {
            let detail = '';
            try {
                detail = (await r.text()).slice(0, 200);
            } catch {
                // no body
            }
            throw new Error(`model server answered HTTP ${r.status}${detail ? `: ${detail}` : ''}`);
        }
        const json: unknown = await r.json();
        return { raw: extractReplyText(cfg.api, json), latencyMs: Math.round(now() - t0), api: cfg.api };
    } finally {
        t.done();
    }
}

/**
 * The conversation sent for one player message: the system prompt with the current brief (rebuilt every turn, so
 * command ids always refer to the live state), the last `maxTurns` exchanges (so "do it anyway" sees the objection),
 * and the new message.
 */
export function buildAdvisorMessages(brief: AdvisorBrief, history: readonly ChatMessage[], userText: string, maxTurns = 6): ChatMessage[] {
    // The earlier chat goes into the system message as plain text rather than as assistant turns: a small model
    // constrained to JSON otherwise tends to repeat its previous answer instead of acting on the new message.
    const recent = history.filter((m) => m.role !== 'system').slice(-maxTurns * 2);
    let system = buildAdvisorSystemPrompt(brief);
    if (recent.length > 0) {
        system += `\n\nEARLIER IN THIS CHAT (context only, do not copy):\n${recent.map((m) => `${m.role === 'user' ? 'Player said' : 'You answered'}: ${m.content}`).join('\n')}`;
    }
    return [
        { role: 'system', content: system },
        { role: 'user', content: userText },
    ];
}

/** The player's message asks for something after the current task ("then", "after", "next", "queue" …). */
export const PLAYER_ASKS_TO_QUEUE = /\b(then|after|afterwards|next|queue|queued|once|later)\b/i;

export interface AdvisorTurn {
    /** The advisor's in-character reply ('' when none). */
    reply: string;
    /** A clarifying question (nothing was executed). */
    clarify?: string;
    /** Per-command results of what was executed (✓ / ✗ / needs-confirm). */
    results: AdvisorCommandResult[];
    rejected: RejectedCommand[];
    /** The request failed or the answer was unusable. */
    error?: string;
    latencyMs: number;
    /** The model's raw answer ('' when the request failed). */
    raw: string;
    /** The brief the answer was validated against (kept for the confirm chip). */
    brief: AdvisorBrief;
    /** What to append to the conversation history: the player's message and a plain-text summary of the answer. */
    history: ChatMessage[];
}

/**
 * One chat turn: build the brief for the current selection, ask the model, validate its answer against the brief and
 * execute the valid commands through the player command layer (executeAdvisorCommands). The history keeps plain text
 * (reply + what was ordered), never the old command ids — the next turn gets a fresh brief.
 */
export async function runAdvisorTurn(args: {
    galaxy: Galaxy;
    player: Empire;
    selection: AdvisorSelection;
    history: readonly ChatMessage[];
    text: string;
    cfg: { endpoint: string; model: string; api: AdvisorApi; think?: boolean };
    fetchImpl?: FetchLike;
    signal?: AbortSignal;
}): Promise<AdvisorTurn> {
    const brief = buildAdvisorBrief(args.galaxy, args.player, args.selection);
    const messages = buildAdvisorMessages(brief, args.history, args.text);
    const turn: AdvisorTurn = { reply: '', results: [], rejected: [], latencyMs: 0, raw: '', brief, history: [{ role: 'user', content: args.text }] };
    let raw: string;
    try {
        const r = await requestAdvisor(args.cfg, messages, { fetchImpl: args.fetchImpl, signal: args.signal });
        raw = r.raw;
        turn.raw = raw;
        turn.latencyMs = r.latencyMs;
    } catch (e) {
        turn.error = e instanceof Error ? e.message : String(e);
        turn.history.push({ role: 'assistant', content: '(no answer)' });
        return turn;
    }
    const v = validateAdvisorResponse(brief, raw);
    // Guards against a small model filling optional fields on its own: a war declaration is confirmed only by the
    // player's Confirm chip (never by the model), and an order is queued only when the player asked for a sequence.
    const wantsQueue = PLAYER_ASKS_TO_QUEUE.test(args.text);
    for (const c of v.commands) {
        delete c.command.confirm;
        if (!wantsQueue) delete c.command.queue;
    }
    turn.reply = v.reply;
    turn.rejected = v.rejected;
    if (v.error !== undefined) turn.error = v.error;
    if (v.clarify !== undefined) {
        turn.clarify = v.clarify;
    } else if (v.commands.length > 0) {
        // Executed between frames, like the click it stands for.
        turn.results = executeAdvisorCommands(args.galaxy, args.player, brief, v.commands);
    }
    const parts: string[] = [];
    if (turn.reply !== '') parts.push(`"${turn.reply}"`);
    if (turn.clarify !== undefined) parts.push(`(asked: ${turn.clarify})`);
    if (turn.results.length > 0) {
        parts.push(`(orders ${turn.results.map((r) => `${r.text} ${r.status === 'done' ? 'carried out' : r.status === 'needs-confirm' ? 'awaiting confirmation' : `failed: ${r.message}`}`).join('; ')})`);
    }
    turn.history.push({ role: 'assistant', content: parts.join(' ') || '(no reply)' });
    return turn;
}
