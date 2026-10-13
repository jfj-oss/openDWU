// P4 REAL DIPLOMATIC NEGOTIATION, UI side (flag llmNegotiation). Not a port.
//
// "Speak freely": the player's words + the legal menu (sim/scenario/llm/negotiation.ts negotiationMenu, ids g1/a1/t1)
// → ONE 'player'-priority request through the foundations queue, schema-constrained to those ids → a confirmation card.
// Only the player's Propose click issues the journaled command `llmNegotiate` from their own empire; the sim re-checks
// everything and the ported trade / treaty code decides. After a refusal the sim's pure counter-offers come back with
// the verdict; the ambassador's voiced reply (a 'voice' request) only picks which counter to mention. No model → the
// box hides; the counters still work from the trade panel. Nothing here runs inside the tick.

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import { issuePlayerCommand } from '../sim/player/playerCommands';
import {
    describePackage,
    estimatePackage,
    mapNegotiationAnswer,
    negotiationMenu,
    negotiationMenuText,
    negotiationSchema,
    type NegotiationMapping,
    type NegotiationMenu,
    type NegotiationPackage,
    type NegotiationResult,
    type TradeEstimate,
} from '../sim/scenario/llm/negotiation';
import type { ChatMessage } from '../ui/advisorClient';
import { fillPrompt } from './prompts/chronicle';
import type { LlmQueue, LlmResult } from './queue';
import { readReplica } from './replicaReads';

export const NEGOTIATION_PROMPT_VERSION = 1;
export const NO_ENVOY = 'No envoy is available; use the trade panel.';

export const NEGOTIATION_SYSTEM = [
    'You are the treaty clerk of the {player} in the space strategy game Distant Worlds. Turn your ruler\'s words into ONE proposal to the {other}.',
    'Use ONLY the ids below. Never invent items. "give" = ids from WE_CAN_GIVE; "ask" = ids from WE_CAN_ASK; "treaty" = one id from TREATIES or "none".',
    'Money: "giveMoney" credits we pay (at most OUR_MONEY), "askMoney" credits we want (at most THEIR_MONEY); 0 when not mentioned.',
    'Anything the words ask for that has no id: describe it briefly in "unmapped". If the words are unclear, put ONE short question in "clarify" and leave the lists empty. Never guess.',
    '"understood": one short sentence of what the ruler proposes.',
    '',
    'WE_CAN_GIVE:',
    '{give}',
    'WE_CAN_ASK:',
    '{ask}',
    'TREATIES:',
    '{treaties}',
    'OUR_MONEY: {ourmoney}  THEIR_MONEY: {theirmoney}',
    '{standing}',
].join('\n');

export const NEGOTIATION_VOICE_SYSTEM = [
    'You are the ambassador of the {other} answering the {player} in the space strategy game Distant Worlds.',
    'The decision is already made: {verdict}. Do not change it. Write the reply in character, 1 or 2 sentences, no lists.',
    'If COUNTERS are given you may mention ONE of them (set "counterId" to its id) as what would change your mind; else "none".',
    '{standing}',
    'COUNTERS:',
    '{counters}',
].join('\n');

export function buildNegotiationMessages(menu: NegotiationMenu, text: string): ChatMessage[] {
    const m = negotiationMenuText(menu);
    const system = fillPrompt(NEGOTIATION_SYSTEM, {
        player: menu.playerName,
        other: menu.otherName,
        give: m.give,
        ask: m.ask,
        treaties: m.treaties,
        ourmoney: menu.ourMoney,
        theirmoney: menu.theirMoney,
        standing: menu.standing,
    });
    return [
        { role: 'system', content: system },
        { role: 'user', content: text.trim().slice(0, 400) },
    ];
}

export type NegotiationOutcome = NegotiationMapping | { status: 'unavailable'; text: string };

/** The card: the mapping plus the pure expected reception. */
export interface NegotiationCard {
    mapping: Extract<NegotiationMapping, { status: 'card' }>;
    reception: TradeEstimate;
    receptionText: string;
}

export function receptionText(e: TradeEstimate, human: boolean): string {
    if (human) return 'They will answer for themselves.';
    switch (e) {
        case 'accept':
            return 'Likely accepted.';
        case 'improve':
            return 'They will want a little more.';
        case 'insulted':
            return 'They will find it insulting.';
        case 'uncertain':
            return 'Hard to say (a threat is on the table).';
        default:
            return 'Likely refused.';
    }
}

/** Map the words to one legal package (or a question / a refusal). Never issues anything. Never rejects. */
export async function interpretNegotiation(galaxy: Galaxy, player: Empire, other: Empire, queue: LlmQueue | null, text: string): Promise<NegotiationOutcome> {
    if (text.trim() === '') return { status: 'clarify', text: 'What do you wish to propose?' };
    if (queue === null) return { status: 'unavailable', text: NO_ENVOY };
    const menu = readReplica(galaxy, () => negotiationMenu(galaxy, player, other));
    const messages = buildNegotiationMessages(menu, text);
    let res: LlmResult;
    try {
        res = await queue.submit({
            priority: 'player',
            purpose: 'negotiation',
            situation: `v${NEGOTIATION_PROMPT_VERSION}\n${messages[0].content}\n${messages[1].content}`,
            messages,
            schema: negotiationSchema(menu),
            schemaName: 'negotiation',
            temperature: 0,
            cache: false,
        });
    } catch (e) {
        res = { outcome: 'error', text: '', tokens: 0, latencyMs: 0, error: String(e) };
    }
    if (res.outcome !== 'ok' && res.outcome !== 'cached') return { status: 'refused', text: 'The clerk could not follow; please rephrase.' };
    return mapNegotiationAnswer(menu, res.text, text);
}

/** The card's expected reception (pure, on a replica read). */
export function cardFor(galaxy: Galaxy, player: Empire, other: Empire, mapping: Extract<NegotiationMapping, { status: 'card' }>, human: boolean): NegotiationCard {
    const e = readReplica(galaxy, () => estimatePackage(galaxy, player, other, mapping.pkg));
    return { mapping, reception: e.estimate, receptionText: e.why !== '' ? `${receptionText(e.estimate, human)} ${e.why}` : receptionText(e.estimate, human) };
}

/** A counter package in words (a replica read). */
export function counterText(galaxy: Galaxy, player: Empire, other: Empire, pkg: NegotiationPackage): string {
    const d = readReplica(galaxy, () => describePackage(galaxy, player, other, pkg));
    return `You give: ${d.give.length > 0 ? d.give.join(', ') : 'nothing'}. You receive: ${d.ask.length > 0 ? d.ask.join(', ') : 'nothing'}.`;
}

/** Propose: the journaled command, applied at the next frame boundary. Must be called between frames (a UI handler). */
export function proposeNegotiation(galaxy: Galaxy, player: Empire, other: Empire, pkg: NegotiationPackage, onApplied?: (r: NegotiationResult) => void): void {
    issuePlayerCommand(galaxy, player, 'llmNegotiate', [other, pkg], (r: NegotiationResult) => onApplied?.(r));
}

export function negotiationVoiceSchema(counters: number): object {
    return {
        type: 'object',
        additionalProperties: false,
        required: ['counterId', 'reply'],
        properties: { counterId: { type: 'string', enum: ['none', ...Array.from({ length: counters }, (_, i) => `c${i + 1}`)] }, reply: { type: 'string' } },
    };
}

/** The ambassador's voiced reply; picks which counter (index) to mention. Null when the model does not answer. */
export async function voiceNegotiationReply(
    galaxy: Galaxy,
    player: Empire,
    other: Empire,
    queue: LlmQueue | null,
    result: NegotiationResult,
    original: string,
): Promise<{ text: string; counter: number } | null> {
    if (queue === null) return null;
    const counters = result.counters.map((c, i) => `c${i + 1}: ${counterText(galaxy, player, other, c)}`);
    const standing = readReplica(galaxy, () => negotiationMenu(galaxy, player, other).standing);
    const system = fillPrompt(NEGOTIATION_VOICE_SYSTEM, {
        other: other.name,
        player: player.name,
        verdict: result.verdict === 'accepted' ? 'we ACCEPT the proposal' : result.verdict === 'improve' ? 'we want more before we agree' : 'we REFUSE the proposal',
        standing,
        counters: counters.length > 0 ? counters.join('\n') : '(none)',
    });
    const messages: ChatMessage[] = [
        { role: 'system', content: system },
        { role: 'user', content: `The usual reply would be: "${original.slice(0, 300)}"` },
    ];
    let res: LlmResult;
    try {
        res = await queue.submit({ priority: 'voice', purpose: 'negotiation.voice', situation: system + original, messages, schema: negotiationVoiceSchema(counters.length), schemaName: 'negotiation_reply', temperature: 0.7, cache: false });
    } catch {
        return null;
    }
    if (res.outcome !== 'ok' && res.outcome !== 'cached') return null;
    try {
        const a = JSON.parse(res.text) as { counterId?: unknown; reply?: unknown };
        const text = typeof a.reply === 'string' ? a.reply.trim().slice(0, 480) : '';
        if (text === '') return null;
        const m = typeof a.counterId === 'string' ? /^c([1-3])$/.exec(a.counterId) : null;
        const idx = m !== null ? Number(m[1]) - 1 : -1;
        return { text, counter: idx < result.counters.length ? idx : -1 };
    } catch {
        return null;
    }
}
