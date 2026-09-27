// 19s-2 VOICES: what every voice prompt shares (tasks/19-mod-layer-scenarios.md §19s item 2) — the answer schema, the
// grounding rules, the parser. The per-voice wording lives next to this file (councilSeat.ts, factionUltimatum.ts,
// councilSpeech.ts, rimLore.ts, letter.ts); llm/voiceJob.ts only fills the slots. Bump a module's *_PROMPT_VERSION when
// its wording changes (it is part of the situation cache key).

export { fillPrompt } from './chronicle';

/** The answer of every voice: one paragraph of display text. */
export const VOICE_SCHEMA = {
    type: 'object',
    properties: {
        text: { type: 'string' },
    },
    required: ['text'],
    additionalProperties: false,
} as const;

/** The rules appended to every voice's system prompt. Slot: {words}. */
export const VOICE_RULES = [
    'Speak in character, first person, present tense: ONE paragraph, at most {words} words, plain text, no lists, no stage directions, no quotation marks around the whole answer.',
    'Use ONLY the facts in SITUATION and DIGEST. Name only the empires, places, people and numbers that appear there; do not invent battles, treaties, names, numbers or events. You may colour, judge and interpret them as your character would.',
    'You only speak: do not announce decisions that are not in SITUATION, and do not promise, order or threaten any action beyond what SITUATION says.',
    'Answer with JSON only: {"text": string}.',
].join('\n');

/** Longest voiced paragraph kept (a small model occasionally runs on). */
export const MAX_VOICE_CHARS = 900;

/** The model's answer → the paragraph, or null when unusable (not JSON, empty, too short, or echoing the prompt). */
export function parseVoiceAnswer(raw: string, maxChars = MAX_VOICE_CHARS): string | null {
    let o: unknown;
    try {
        o = JSON.parse(raw);
    } catch {
        return null;
    }
    const r = o as { text?: unknown };
    if (typeof r?.text !== 'string') return null;
    let t = r.text.replace(/\s+/g, ' ').trim();
    t = t.replace(/^["“'](.*)["”']$/, '$1').trim();
    if (t.length < 20) return null;
    if (/\b(SITUATION|DIGEST)\b|[{}]/.test(t)) return null;
    if (t.length > maxChars) t = `${t.slice(0, maxChars - 1).replace(/\s+\S*$/, '')}…`;
    return t;
}

/** SITUATION lines from a cue's facts ("key: value"; empty values left out). Deterministic (insertion order). */
export function situationLines(facts: Readonly<Record<string, string | number | boolean>>): string {
    const out: string[] = [];
    for (const [k, v] of Object.entries(facts)) {
        if (v === '' || v === undefined) continue;
        out.push(`- ${k}: ${typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v)}`);
    }
    return out.length > 0 ? out.join('\n') : '- (nothing more)';
}
