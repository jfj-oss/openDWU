// 18b — AI empires speak through the local model in diplomatic conversations.
//
// The sim decides; the model only voices. Every call happens after the ported C# evaluator has settled the exchange
// (submitProposal / submitTradeOffer, or the AI's own proposal on the incoming path): the brief
// (sim/player/diplomatBrief.ts) carries that verdict and the original dialog line, and the model rewrites the line in
// the race's voice. It may attach one counter-proposal by id from the brief's legal set; proposeDiplomatCounter
// (sim/player/diplomatCounter.ts) sends it on the incoming path, where the sim's evaluator decides whether the AI stands
// behind it. Timeout, error or an unusable answer → the original line, unchanged.
//
// Gating: the same endpoint settings as the 18a advisor (advisorEndpoint / advisorModel / advisorApi; off unless the
// endpoint answers the probe) plus its own toggle (settings.diplomatVoice). Uses only fetch (platform-neutral). The
// model never runs inside the tick: calls are made from UI handlers and resolve between frames.

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import type { EmpireMessage } from '../sim/messages';
import { buildDiplomatBrief, personaLines, type DiplomatBrief, type DiplomatContext } from '../sim/player/diplomatBrief';
import { type DiplomatCounterOutcome } from '../sim/player/diplomatCounter';
import { groundDiplomatBrief } from '../sim/player/diplomatGrounding';
import { runPlayerCommand } from '../sim/player/playerCommands';
import { remoteSimHost } from '../simworker/remoteHost';
import { readReplica } from '../llm/replicaReads';
import { probeAdvisorEndpoint, requestAdvisor, type AdvisorApi, type ChatMessage } from './advisorClient';
import { getSettings, updateSettings } from './settings';
import './diplomatVoice.css';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface DiplomatVoiceConfig {
    endpoint: string;
    model: string;
    api: AdvisorApi;
}

/** The schema's "no counter-proposal" choice. */
export const NO_COUNTER = 'none';

/** Longest reply shown (a small model occasionally runs on). */
export const MAX_REPLY_CHARS = 480;

/** Default wait for a voiced line before the original stays. */
export const DEFAULT_VOICE_TIMEOUT_MS = 30000;

/** The response schema: `{ counterId, reply }` (counterId one of the brief's counter ids or "none"), or `{ reply }` without counters. */
export function diplomatResponseSchema(brief: DiplomatBrief): object {
    if (brief.counters.length === 0) return { type: 'object', properties: { reply: { type: 'string' } }, required: ['reply'], additionalProperties: false };
    // An explicit "none" choice, decided before the reply is written (grammar-constrained output follows the property
    // order): a small model otherwise fills the optional field on every answer and then talks itself into it.
    return {
        type: 'object',
        properties: { counterId: { type: 'string', enum: [NO_COUNTER, ...brief.counters.map((c) => c.id)] }, reply: { type: 'string' } },
        required: ['counterId', 'reply'],
        additionalProperties: false,
    };
}

function verdictSentence(brief: DiplomatBrief): string {
    const x = brief.exchange;
    switch (x.kind) {
        case 'proposal':
            if (x.verdict === 'accepted') return `The ruler of the ${brief.player.name} proposed "${x.playerProposes}". Your empire has ACCEPTED. This is decided and final.`;
            if (x.verdict === 'refused') return `The ruler of the ${brief.player.name} proposed "${x.playerProposes}". Your empire has REFUSED. This is decided and final; never agree to it.`;
            return `The ruler of the ${brief.player.name} said: "${x.playerProposes}". Give your answer.`;
        case 'trade':
            return (
                `The ruler of the ${brief.player.name} offered a trade: they ask for [${x.playerAsksFor.join('; ') || 'nothing'}] and give [${x.playerOffers.join('; ') || 'nothing'}]. ` +
                (x.verdict === 'accepted' ? 'Your empire has ACCEPTED the trade. This is decided and final.' : 'Your empire has REFUSED the trade. This is decided and final; never agree to it.')
            );
        case 'incoming':
            return `You are sending the ruler of the ${brief.player.name} this message: ${x.subject}. Deliver it.`;
    }
}

/** The persona + rules + brief the model sees as its system message. */
export function buildDiplomatSystemPrompt(brief: DiplomatBrief): string {
    const who =
        brief.speaker !== null
            ? `${brief.speaker.name}, ${brief.speaker.role === 'Ambassador' ? 'ambassador' : 'ruler'} of the ${brief.empire.name}`
            : `the envoy of the ${brief.empire.name}`;
    const lines = [
        `You are ${who}, a ${brief.empire.race} (${brief.empire.raceFamily}) speaking to the ruler of the ${brief.player.name} in the space strategy game Distant Worlds.`,
        ...personaLines(brief),
    ];
    if (brief.attitude !== null) lines.push(`Your empire feels ${brief.attitude.feeling} toward them (attitude ${brief.attitude.score}).`);
    lines.push(
        `Your relationship: ${brief.relation.current}; your strategy toward them: ${brief.relation.strategy} (you want: ${brief.relation.wants}). Your military is ${brief.strength.they} (ratio ${brief.strength.ratio}).`,
        verdictSentence(brief),
        `The original line for this moment (keep its meaning): "${brief.exchange.originalLine}"`,
        'Speak in character, in the first person plural for your people: one to three short sentences, plain text, no lists, no stage directions, no quotes around the reply.',
        'Let your race\'s temperament, your attitude and the facts in BRIEF (attitude factors, incidents, strength) shape the tone. Do not invent treaties, events, names or numbers that are not in BRIEF.',
        'Do not add conditions, demands, terms, taxes or offers of your own, and do not announce or threaten any action (war, sanctions, embargo, attack, gift).',
    );
    // 19s-2 (flag llmVoices): the ledger and the claims are facts the reply may lean on.
    if (brief.grounding !== undefined) {
        lines.push(
            'BRIEF.grounding holds the real record between you: the reputation ledger (your causes about them, the grievances they hold against you), claims on colonies, casus belli and the war score. Let the reply refer to the grievance, claim or casus belli that bears on this exchange; never invent others.',
        );
    }
    if (brief.counters.length > 0) {
        const fitting = brief.counters.find((c) => c.proposes === brief.relation.wants);
        lines.push(
            `Counter-proposal: first decide "counterId". The possible counters: ${brief.counters.map((c) => `"${c.id}" = ${c.label} (${c.proposes})`).join('; ')}.`,
            fitting !== undefined
                ? `"${fitting.id}" proposes what your empire wants (${brief.relation.wants}): pick it when your attitude is not hostile, and then offer it in the reply. Otherwise use "${NO_COUNTER}".`
                : `None of them is what your empire wants (${brief.relation.wants}): use "${NO_COUNTER}".`,
            `When counterId is "${NO_COUNTER}", the reply offers no other treaty or deal.`,
            `Answer with JSON only: {"counterId": ${[`"${NO_COUNTER}"`, ...brief.counters.map((c) => `"${c.id}"`)].join(' | ')}, "reply": string}.`,
        );
    } else {
        lines.push('Answer with JSON only: {"reply": string}.');
    }
    // The counters are given above with their rule, not in BRIEF: listed as facts, a small model tends to offer them all.
    const { counters: _counters, ...facts } = brief;
    void _counters;
    lines.push('', 'BRIEF:', JSON.stringify(facts));
    return lines.join('\n');
}

export function buildDiplomatMessages(brief: DiplomatBrief): ChatMessage[] {
    return [
        { role: 'system', content: buildDiplomatSystemPrompt(brief) },
        { role: 'user', content: brief.exchange.kind === 'incoming' ? 'Speak.' : 'Give your reply.' },
    ];
}

export interface ParsedDiplomatResponse {
    reply: string;
    /** A counter id from the brief (null when none, or when the model's id is not in the brief). */
    counterId: string | null;
    /** A counter id the model gave that is not in the brief. */
    rejectedCounterId?: string;
    error?: string;
}

/** Validate the model's JSON against the brief. An unusable answer gives reply '' (the caller keeps the original). */
export function parseDiplomatResponse(brief: DiplomatBrief, raw: string): ParsedDiplomatResponse {
    let obj: unknown;
    try {
        obj = JSON.parse(raw);
    } catch {
        return { reply: '', counterId: null, error: 'the model answered no JSON' };
    }
    const o = obj as { reply?: unknown; counterId?: unknown };
    let reply = typeof o?.reply === 'string' ? o.reply.replace(/\s+/g, ' ').trim() : '';
    reply = reply.replace(/^["“](.*)["”]$/, '$1').trim();
    if (reply.length > MAX_REPLY_CHARS) reply = `${reply.slice(0, MAX_REPLY_CHARS - 1).replace(/\s+\S*$/, '')}…`;
    const out: ParsedDiplomatResponse = { reply, counterId: null };
    if (reply === '') out.error = 'the model gave no reply';
    if (typeof o?.counterId === 'string' && o.counterId.trim() !== '' && o.counterId.trim() !== NO_COUNTER) {
        const id = o.counterId.trim();
        if (brief.counters.some((c) => c.id === id)) out.counterId = id;
        else out.rejectedCounterId = id;
    }
    return out;
}

export interface VoicedReply {
    /** What to show: the voiced line, or the original when voicing failed. */
    text: string;
    /** The original dialog line (always kept for the "original" toggle / tooltip). */
    original: string;
    voiced: boolean;
    latencyMs: number;
    error?: string;
    /** The counter-proposal the model attached and what the sim did with it. */
    counter: DiplomatCounterOutcome | null;
    brief: DiplomatBrief;
    raw: string;
}

/**
 * Voice one AI reply. Builds the brief (after the evaluator ran), asks the model, validates the answer; on success and
 * when `applyCounter()` still agrees (the conversation has not moved on), sends the counter through the incoming path.
 * Never throws: failures return the original line with `error`.
 */
export async function voiceDiplomatReply(args: {
    galaxy: Galaxy;
    ai: Empire;
    player: Empire;
    context: DiplomatContext;
    cfg: DiplomatVoiceConfig;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
    signal?: AbortSignal;
    /** Checked when the answer arrives; false → the counter is not sent (stale conversation). Default: always. */
    applyCounter?: () => boolean;
}): Promise<VoicedReply> {
    const original = args.context.original;
    // 19s-2: grounded on the ledger + claims with llmVoices on (unchanged otherwise).
    const brief = readReplica(args.galaxy, () => groundDiplomatBrief(args.galaxy, buildDiplomatBrief(args.galaxy, args.ai, args.player, args.context), args.ai, args.player));
    const out: VoicedReply = { text: original, original, voiced: false, latencyMs: 0, counter: null, brief, raw: '' };
    let raw: string;
    try {
        const r = await requestAdvisor({ ...args.cfg, think: false }, buildDiplomatMessages(brief), {
            fetchImpl: args.fetchImpl,
            timeoutMs: args.timeoutMs ?? DEFAULT_VOICE_TIMEOUT_MS,
            signal: args.signal,
            schema: diplomatResponseSchema(brief),
            schemaName: 'diplomat_reply',
            temperature: 0.7,
        });
        raw = r.raw;
        out.raw = raw;
        out.latencyMs = r.latencyMs;
    } catch (e) {
        const aborted = e instanceof Error && (e.name === 'AbortError' || /abort/i.test(e.message));
        out.error = aborted ? 'timed out' : e instanceof Error ? e.message : String(e);
        return out;
    }
    const p = parseDiplomatResponse(brief, raw);
    if (p.error !== undefined) out.error = p.error;
    if (p.reply !== '') {
        out.text = p.reply;
        out.voiced = true;
    }
    if (p.rejectedCounterId !== undefined) out.counter = { id: p.rejectedCounterId, status: 'unknown', proposes: '', message: null };
    if (p.counterId !== null && (args.applyCounter?.() ?? true)) {
        // Between frames, like the click it stands for; the sim's evaluator decides.
        // (A frame boundary: the model's answer arrives in a promise callback.) Journaled in the command log.
        const remote = remoteSimHost(args.galaxy);
        if (remote === null) out.counter = runPlayerCommand(args.galaxy, args.player, 'diplomatCounter', [args.ai, brief, p.counterId]);
        else {
            // Sim worker (docs/sim-worker.md §9 chunk 8): applied at the worker's next frame boundary and journaled there;
            // the outcome's message comes back as the replica's EmpireMessage (the dialog finds it by identity).
            try {
                out.counter = await remote.command(args.player, 'diplomatCounter', [args.ai, brief, p.counterId]);
            } catch (e) {
                out.error = e instanceof Error ? e.message : String(e);
            }
        }
        if (out.counter !== null && out.counter.message !== null) rememberVoicedMessage(out.counter.message, out.text);
    }
    return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Gating (18a endpoint settings + own toggle), probed once and cached
// ---------------------------------------------------------------------------------------------------------------

let probe: { key: string; at: number; result: Promise<AdvisorApi | null> } | null = null;
const PROBE_RETRY_MS = 60000;

/** The voice toggle (settings.diplomatVoice). */
export function isDiplomatVoiceEnabled(): boolean {
    return getSettings().diplomatVoice;
}

/**
 * The endpoint config when the voice is on and the endpoint answers, else null. The probe is cached per endpoint; a
 * failed probe is retried after a minute.
 */
export async function diplomatVoiceConfig(fetchImpl?: FetchLike, nowMs: () => number = () => Date.now()): Promise<DiplomatVoiceConfig | null> {
    const s = getSettings();
    if (!s.diplomatVoice) return null;
    const key = `${s.advisorEndpoint}|${s.advisorApi}`;
    const now = nowMs();
    if (probe === null || probe.key !== key) {
        probe = { key, at: now, result: probeAdvisorEndpoint({ endpoint: s.advisorEndpoint, model: s.advisorModel, api: s.advisorApi }, fetchImpl) };
    } else if (now - probe.at > PROBE_RETRY_MS && (await probe.result) === null) {
        probe = { key, at: now, result: probeAdvisorEndpoint({ endpoint: s.advisorEndpoint, model: s.advisorModel, api: s.advisorApi }, fetchImpl) };
    }
    const api = await probe.result;
    return api === null ? null : { endpoint: s.advisorEndpoint, model: s.advisorModel, api };
}

/** Forget the cached probe (tests; settings changed). */
export function resetDiplomatVoiceProbe(): void {
    probe = null;
}

// ---------------------------------------------------------------------------------------------------------------
// Incoming messages (16d dialog): one voiced line per message
// ---------------------------------------------------------------------------------------------------------------

const voicedMessages = new WeakMap<EmpireMessage, string>();

/** A counter's message already has its voiced line (the reply that announced it): the dialog shows that. */
export function rememberVoicedMessage(m: EmpireMessage, text: string): void {
    voicedMessages.set(m, text);
}

export function voicedMessageText(m: EmpireMessage): string | undefined {
    return voicedMessages.get(m);
}

/** A short status for a counter outcome (shown under the reply, for auditability). */
export function counterOutcomeText(c: DiplomatCounterOutcome | null): string {
    if (c === null) return '';
    switch (c.status) {
        case 'proposed':
            return `Counter-proposal sent: ${c.proposes.replace(/([a-z])([A-Z])/g, '$1 $2')} (see Treaty on Offer)`;
        case 'withdrawn':
            return `Counter-proposal (${c.id}) withdrawn: not what their strategy wants`;
        case 'pending':
            return `Counter-proposal (${c.id}) not sent: they already have an offer open`;
        case 'stale':
            return `Counter-proposal (${c.id}) no longer applies`;
        case 'unknown':
            return `Counter-proposal ignored: "${c.id}" is not a legal option`;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// DOM helpers shared by the three places a reply is shown (diplomacy screen, trade panel, 16d dialog)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Show `voiced` in `textEl` with the original line kept auditable: as the tooltip and behind an "original" toggle
 * button (returned; the caller places it after the text).
 */
export function voicedLineToggle(textEl: HTMLElement, voiced: string, original: string, state: { showOriginal: boolean } = { showOriginal: false }): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dv-toggle';
    const apply = (): void => {
        textEl.textContent = state.showOriginal ? original : voiced;
        textEl.classList.toggle('dv-voiced', !state.showOriginal);
        textEl.title = state.showOriginal ? 'Original dialog line' : `Voiced by the local model. Original: ${original}`;
        btn.textContent = state.showOriginal ? 'voiced' : 'original';
        btn.title = state.showOriginal ? 'Show the voiced reply' : 'Show the original dialog line';
    };
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.showOriginal = !state.showOriginal;
        apply();
    });
    apply();
    return btn;
}

/** "voicing…" indicator placed after a reply while the model answers. */
export function voicingIndicator(): HTMLElement {
    const s = document.createElement('span');
    s.className = 'dv-pending';
    s.textContent = 'voicing…';
    return s;
}

/** The counter-proposal note under a voiced reply ('' outcome → null). */
export function counterNote(c: DiplomatCounterOutcome | null): HTMLElement | null {
    const text = counterOutcomeText(c);
    if (text === '') return null;
    const d = document.createElement('div');
    d.className = c?.status === 'proposed' ? 'dv-counter' : 'dv-counter dv-counter-muted';
    d.textContent = text;
    return d;
}

/** The "AI voice" checkbox (settings.diplomatVoice). */
export function voiceSwitch(onChange: () => void): HTMLElement {
    const label = document.createElement('label');
    label.className = 'dv-switch';
    label.title = 'Voice AI replies with the local model (advisor endpoint settings); the original line stays under "original"';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = isDiplomatVoiceEnabled();
    box.addEventListener('change', () => {
        updateSettings({ diplomatVoice: box.checked });
        onChange();
    });
    label.append(box, document.createTextNode('AI voice'));
    return label;
}
