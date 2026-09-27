// 19s-2 VOICES job (tasks/19-mod-layer-scenarios.md §19s item 2). Not a port.
//
// Polled from the UI timer (llm/llmLayer.ts), never from the tick. Drains the voice cues the packages' emit sites left
// (sim/scenario/llm/voiceCues.ts), builds one grounded prompt per cue — persona lines by race / government from the
// briefs, the event's own facts, the grounding digest (digestFor / digestText, ≤ 400 tokens) — and sends it through the
// foundations queue at 'voice' priority (budgeted, cached by situation hash, hard timeout, silent without a model).
//
// Every surface already shows its scripted text (the message was sent with it; the council screen renders the scripted
// speech lines at once). When the model answers with a usable paragraph the surface is upgraded in place: the
// message's display text becomes the scripted text followed by the voiced paragraph (the scripted facts stay first; the
// original is kept for the "original" toggle), a council speech replaces its scripted line. No model, a refused budget,
// a timeout or an unusable answer → the scripted text simply stays. Model output is display text only: it never
// reaches a sim decision (a message description is what the message shows; nothing in the sim reads it back).

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import type { EmpireMessage } from '../sim/messages';
import type { Character } from '../sim/characters';
import { CharacterRole, CharacterTraitType } from '../sim/characters';
import { governmentName, personaLines, raceBonuses, raceTraits, RACE_FAMILY_NAMES } from '../sim/player/diplomatBrief';
import { digestFor, digestText } from '../sim/scenario/llm/digest';
import { councilSpeakers, drainVoiceCues, voicesOn, type SpeechMotion, type SpeechSide, type VoiceCue } from '../sim/scenario/llm/voiceCues';
import type { ChatMessage } from '../ui/advisorClient';
import type { LlmQueue, LlmResult } from './queue';
import { VOICE_RULES, VOICE_SCHEMA, fillPrompt, parseVoiceAnswer, situationLines } from './prompts/voice';
import { COUNCIL_SEAT_PROMPT_VERSION, COUNCIL_SEAT_SYSTEM, COUNCIL_SEAT_USER, SEAT_TASKS } from './prompts/councilSeat';
import { FACTION_ULTIMATUM_PROMPT_VERSION, FACTION_ULTIMATUM_SYSTEM, FACTION_ULTIMATUM_USER } from './prompts/factionUltimatum';
import { COUNCIL_SPEECH_PROMPT_VERSION, COUNCIL_SPEECH_SYSTEM, COUNCIL_SPEECH_USER, SPEECH_STANCE } from './prompts/councilSpeech';
import { CONCORD_SYSTEM, CONCORD_USER, HERDERS_SYSTEM, HERDERS_USER, RIM_LORE_PROMPT_VERSION } from './prompts/rimLore';
import { LETTER_PROMPT_VERSION, LETTER_SYSTEM, LETTER_TASKS, LETTER_USER } from './prompts/letter';

// ---------------------------------------------------------------------------------------------------------------
// Prompt building (pure: reads the galaxy, writes nothing)
// ---------------------------------------------------------------------------------------------------------------

export interface VoiceRequest {
    purpose: string;
    messages: ChatMessage[];
    /** The cache key's source: the prompt version and the whole system prompt (digest + facts). */
    situation: string;
    /** Words the paragraph may use. */
    words: number;
}

function speakerFields(c: Character | null): { name: string; role: string; traits: string[] } | null {
    if (c === null) return null;
    return { name: c.name, role: CharacterRole[c.role] ?? '', traits: c.traits.filter((t) => t !== CharacterTraitType.Undefined).map((t) => CharacterTraitType[t]) };
}

/** The persona lines of `voice` (its dominant race's traits, bonuses and government; the speaker's traits). */
export function voicePersona(voice: Empire, speaker: Character | null): string {
    const race = voice.dominantRace ?? null;
    return personaLines({
        race: raceTraits(race),
        raceBonuses: raceBonuses(race),
        speaker: speakerFields(speaker),
        empire: { race: race?.name ?? 'unknown', government: governmentName(voice) },
    }).join(' ');
}

function raceWords(e: Empire): string {
    const r = e.dominantRace ?? null;
    return r !== null ? `${r.name} (${RACE_FAMILY_NAMES[r.raceFamily] ?? ''})` : 'mixed';
}

function request(purpose: string, version: number, system: string, user: string, words: number): VoiceRequest {
    return { purpose, words, situation: `v${version}\n${system}`, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
}

/** The request of one message cue (every kind but 'speech'). */
export function buildVoiceRequest(galaxy: Galaxy, cue: VoiceCue): VoiceRequest {
    const digest = digestText(digestFor(galaxy, cue.voice, cue.other));
    const persona = voicePersona(cue.voice, cue.speaker);
    const situation = situationLines(cue.facts);
    const base = { role: cue.role, empire: cue.voice.name, race: raceWords(cue.voice), persona, situation, digest };
    switch (cue.kind) {
        case 'spymaster':
        case 'chancellor':
        case 'marshal': {
            const words = 90;
            const system = fillPrompt(COUNCIL_SEAT_SYSTEM, { ...base, task: SEAT_TASKS[cue.kind], rules: fillPrompt(VOICE_RULES, { words }) });
            return request(`voice.${cue.kind}`, COUNCIL_SEAT_PROMPT_VERSION, system, COUNCIL_SEAT_USER, words);
        }
        case 'ultimatum': {
            const words = 90;
            const system = fillPrompt(FACTION_ULTIMATUM_SYSTEM, { ...base, rules: fillPrompt(VOICE_RULES, { words }) });
            return request('voice.ultimatum', FACTION_ULTIMATUM_PROMPT_VERSION, system, FACTION_ULTIMATUM_USER, words);
        }
        case 'concord': {
            const words = 110;
            const system = fillPrompt(CONCORD_SYSTEM, { ...base, occasion: String(cue.facts.occasion ?? 'a meeting'), player: cue.empire.name, rules: fillPrompt(VOICE_RULES, { words }) });
            return request('voice.concord', RIM_LORE_PROMPT_VERSION, system, CONCORD_USER, words);
        }
        case 'herders': {
            const words = 110;
            const system = fillPrompt(HERDERS_SYSTEM, { ...base, player: cue.empire.name, rules: fillPrompt(VOICE_RULES, { words }) });
            return request('voice.herders', RIM_LORE_PROMPT_VERSION, system, HERDERS_USER, words);
        }
        case 'letter': {
            const words = 110;
            const task = LETTER_TASKS[cue.facts.scheme === 'exposure' ? 'exposure' : 'blackmail'];
            const system = fillPrompt(LETTER_SYSTEM, { ...base, task, player: cue.empire.name, rules: fillPrompt(VOICE_RULES, { words }) });
            return request('voice.letter', LETTER_PROMPT_VERSION, system, LETTER_USER, words);
        }
        case 'speech':
            throw new Error('buildVoiceRequest: a speech cue is voiced per side (buildSpeechRequest)');
    }
}

/** The request of one council speech side (the member's digest toward the motion's target). */
export function buildSpeechRequest(galaxy: Galaxy, council: string, m: SpeechMotion, side: SpeechSide): VoiceRequest {
    const speaker = side.empire;
    const other = speaker === m.target ? m.proposer : m.target;
    const digest = digestText(digestFor(galaxy, speaker, other));
    const vote = m.votes.find((v) => v.empire === speaker);
    const facts: Record<string, string | number | boolean> = { council, motion: m.text, kind: m.kind, movedBy: m.proposer.name, target: m.target.name, weAreTheTarget: speaker === m.target };
    if (vote !== undefined) facts.ourVote = vote.vote;
    const words = 90;
    const system = fillPrompt(COUNCIL_SPEECH_SYSTEM, {
        empire: speaker.name,
        race: raceWords(speaker),
        persona: voicePersona(speaker, speaker.leader),
        council,
        motion: m.text,
        stance: SPEECH_STANCE[side.side],
        situation: situationLines(facts),
        digest,
        rules: fillPrompt(VOICE_RULES, { words }),
    });
    return request(`voice.speech.${side.side}`, COUNCIL_SPEECH_PROMPT_VERSION, system, COUNCIL_SPEECH_USER, words);
}

// ---------------------------------------------------------------------------------------------------------------
// Upgraded message text (display only)
// ---------------------------------------------------------------------------------------------------------------

export interface VoicedMessage {
    /** The scripted text as sent. */
    original: string;
    /** The voiced paragraph. */
    text: string;
    /** Who speaks (the cue's role). */
    label: string;
    kind: VoiceCue['kind'];
}

const voicedMessages = new WeakMap<EmpireMessage, VoicedMessage>();

/** The 19s-2 voice of a message, when one upgraded it (the 18b dialog voice then leaves it alone). */
export function layerVoiceOf(m: EmpireMessage): VoicedMessage | undefined {
    return voicedMessages.get(m);
}

/** The display text of an upgraded message: the scripted text, a blank line, the speaker and the paragraph. */
export function voicedDescription(original: string, label: string, text: string): string {
    return `${original}\n\n${label}: “${text}”`;
}

/** Upgrades `m` in place. False when the message moved on (its text is no longer the scripted one) or was voiced. */
export function applyVoiceToMessage(m: EmpireMessage, cue: VoiceCue, text: string): boolean {
    if (voicedMessages.has(m) || m.description !== cue.scripted) return false;
    m.description = voicedDescription(cue.scripted, cue.role, text);
    voicedMessages.set(m, { original: cue.scripted, text, label: cue.role, kind: cue.kind });
    return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Council speeches (shown in the council screen)
// ---------------------------------------------------------------------------------------------------------------

export interface Speech {
    side: 'for' | 'against';
    /** The speaking member empire. */
    speaker: Empire;
    text: string;
    voiced: boolean;
}

interface SpeechEntry {
    for: Speech | null;
    against: Speech | null;
    listener: (() => void) | null;
}

// ---------------------------------------------------------------------------------------------------------------
// The job
// ---------------------------------------------------------------------------------------------------------------

export interface VoiceJobOptions {
    galaxy: Galaxy;
    player: Empire | null;
    queue: LlmQueue;
    /** Called after a surface was upgraded (the message feed / popups refresh). */
    onVoiced?: (what: { cue: VoiceCue | null; text: string }) => void;
}

export interface VoiceOutcome {
    purpose: string;
    outcome: LlmResult['outcome'] | 'unusable' | 'stale';
    applied: boolean;
}

export class VoiceJob {
    private disposed = false;
    private readonly inFlight = new Set<Promise<void>>();
    private readonly speeches = new WeakMap<object, SpeechEntry>();
    /** Every finished request (tests, dev overlay). */
    readonly outcomes: VoiceOutcome[] = [];

    constructor(private readonly opts: VoiceJobOptions) {}

    /** Resolves when every request in flight has been applied (tests). */
    async settle(): Promise<void> {
        while (this.inFlight.size > 0) await Promise.all([...this.inFlight]);
    }

    /** Cheap poll (UI timer): drains the cues and sends one request each (two for a council motion). Never awaits. */
    poll(): void {
        const { galaxy } = this.opts;
        if (this.disposed || !voicesOn(galaxy)) {
            drainVoiceCues(galaxy);
            return;
        }
        for (const cue of drainVoiceCues(galaxy)) {
            if (cue.kind === 'speech') {
                const ref = cue.ref as { council?: { name: string; members: Empire[] }; motion?: SpeechMotion } | undefined;
                if (ref?.council !== undefined && ref.motion !== undefined) this.councilSpeeches(ref.council, ref.motion);
                continue;
            }
            if (cue.message === null) continue;
            this.track(this.voiceMessage(cue));
        }
    }

    private track(p: Promise<void>): void {
        this.inFlight.add(p);
        void p.finally(() => this.inFlight.delete(p));
    }

    private async ask(req: VoiceRequest): Promise<{ res: LlmResult; text: string | null }> {
        let res: LlmResult;
        try {
            res = await this.opts.queue.submit({ priority: 'voice', purpose: req.purpose, situation: req.situation, messages: req.messages, schema: VOICE_SCHEMA, schemaName: 'voice', temperature: 0.8 });
        } catch (e) {
            res = { outcome: 'error', text: '', tokens: 0, latencyMs: 0, error: String(e) };
        }
        const text = res.outcome === 'ok' || res.outcome === 'cached' ? parseVoiceAnswer(res.text, Math.max(200, req.words * 9)) : null;
        return { res, text };
    }

    private async voiceMessage(cue: VoiceCue): Promise<void> {
        const m = cue.message!;
        let req: VoiceRequest;
        try {
            req = buildVoiceRequest(this.opts.galaxy, cue);
        } catch {
            return;
        }
        const { res, text } = await this.ask(req);
        if (this.disposed || !voicesOn(this.opts.galaxy)) return;
        if (text === null) {
            this.outcomes.push({ purpose: req.purpose, outcome: res.outcome === 'ok' || res.outcome === 'cached' ? 'unusable' : res.outcome, applied: false });
            return;
        }
        const applied = applyVoiceToMessage(m, cue, text);
        this.outcomes.push({ purpose: req.purpose, outcome: applied ? res.outcome : 'stale', applied });
        if (applied) this.notify(cue, text);
    }

    private notify(cue: VoiceCue | null, text: string): void {
        try {
            this.opts.onVoiced?.({ cue, text });
        } catch {
            // a broken listener must not break the job
        }
    }

    /**
     * The two speeches on `motion` (the council screen calls this on every render): the scripted lines at once, each
     * upgraded in place when the model answers; `onChange` (the latest caller's) is called after an upgrade. Null with
     * voices off or nobody to speak.
     */
    councilSpeeches(council: { name: string; members: readonly Empire[] }, motion: SpeechMotion, onChange?: () => void): { for: Speech | null; against: Speech | null } | null {
        const { galaxy } = this.opts;
        if (this.disposed || !voicesOn(galaxy)) return null;
        let entry = this.speeches.get(motion);
        if (entry === undefined) {
            const sides = councilSpeakers(galaxy, council.members, motion);
            const mk = (s: SpeechSide | null): Speech | null => (s !== null ? { side: s.side, speaker: s.empire, text: s.scripted, voiced: false } : null);
            entry = { for: mk(sides.for), against: mk(sides.against), listener: null };
            this.speeches.set(motion, entry);
            for (const s of [sides.for, sides.against]) if (s !== null) this.track(this.voiceSpeech(council.name, motion, s, entry));
        }
        if (onChange !== undefined) entry.listener = onChange;
        return entry.for === null && entry.against === null ? null : { for: entry.for, against: entry.against };
    }

    private async voiceSpeech(council: string, motion: SpeechMotion, side: SpeechSide, entry: SpeechEntry): Promise<void> {
        const req = buildSpeechRequest(this.opts.galaxy, council, motion, side);
        const { res, text } = await this.ask(req);
        if (this.disposed || !voicesOn(this.opts.galaxy)) return;
        const speech = entry[side.side];
        if (text === null || speech === null) {
            this.outcomes.push({ purpose: req.purpose, outcome: res.outcome === 'ok' || res.outcome === 'cached' ? 'unusable' : res.outcome, applied: false });
            return;
        }
        speech.text = text;
        speech.voiced = true;
        this.outcomes.push({ purpose: req.purpose, outcome: res.outcome, applied: true });
        this.notify(null, text);
        try {
            entry.listener?.();
        } catch {
            // the screen may be gone
        }
    }

    dispose(): void {
        this.disposed = true;
    }
}

// The job of the running game (the council screen reads the speeches through it). Null without voices.
let active: VoiceJob | null = null;

export function activeVoiceJob(): VoiceJob | null {
    return active;
}

export function setActiveVoiceJob(job: VoiceJob | null): void {
    active = job;
}
