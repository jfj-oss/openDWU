// 19s-2 VOICES (src/llm/voiceJob.ts, src/llm/prompts/*, src/sim/scenario/llm/voiceCues.ts): each voice over a fake
// endpoint — the emit site leaves a cue (flag-gated, no state), the prompt carries the persona, the event's facts and the
// grounding digest, the request is schema-constrained at 'voice' priority, the message is upgraded in place (the
// scripted text stays first), and no model / a refused budget / an unusable answer leave the scripted text; the
// council speeches (scripted at once, voiced in place), the Concord greeting, the herder lore, the guarded hooks of
// the packages not on this build (19o grievance, 19n faction ultimatum, 19n-2 letters), the 18b diplomat grounded on
// the ledger + claims; flags off → no cue, no job, the 18b brief unchanged, and the sim byte-identical.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame, scenarioGameData } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateDigest } from '../src/sim/tick/digest';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { gameYear } from '../src/sim/scenario/hooks';
import { CharacterRole, getEmpireCharacters } from '../src/sim/characters';
import { DiplomaticRelation, DiplomaticRelationType } from '../src/sim/diplomacy';
import { EmpireMessageType, empireMessages } from '../src/sim/messages';
import { scenarioMessage } from '../src/sim/scenario/messages';
import { pendingScenarioDecisions, answerScenarioDecision } from '../src/sim/scenario/decisions';
import { registerHiddenThing, setLeadLevel } from '../src/sim/scenario/security/registry';
import { onLeadChanged } from '../src/sim/scenario/security/security';
import { startWarLedger } from '../src/sim/scenario/lively/warGoals';
import { politicsEntry, sendLoyaltyWarnings } from '../src/sim/scenario/emergent/politics';
import { councilOf, proposeMotion, reviewCouncil } from '../src/sim/scenario/emergent/council';
import { councilView } from '../src/sim/scenario/emergent/councilView';
import { rimTraderEmpire } from '../src/sim/scenario/rimTrade/common';
import { rimTraderYear } from '../src/sim/scenario/rimTrade/rimTrader';
import {
    VOICE_EVENTS,
    drainVoiceCues,
    noteVoiceCue,
    peekVoiceCues,
    voiceFactionUltimatum,
    voiceGrievanceAdded,
    voiceSchemeLetter,
    voicesOn,
} from '../src/sim/scenario/llm/voiceCues';
import { DEFAULT_LLM_POLICY, LlmQueue, galaxyLlmClock, type LlmRequest, type LlmTransport } from '../src/llm/queue';
import { VoiceJob, activeVoiceJob, buildVoiceRequest, layerVoiceOf, voicedDescription } from '../src/llm/voiceJob';
import { VOICE_SCHEMA, parseVoiceAnswer } from '../src/llm/prompts/voice';
import { SEAT_TASKS } from '../src/llm/prompts/councilSeat';
import { startLlmLayer } from '../src/llm/llmLayer';
import { estimateTokens } from '../src/sim/scenario/llm/digest';
import { buildDiplomatBrief, governmentName } from '../src/sim/player/diplomatBrief';
import { groundDiplomatBrief } from '../src/sim/player/diplomatGrounding';
import { buildDiplomatSystemPrompt } from '../src/ui/diplomatVoice';

const SC = 'ai-parity';
let base: GameData;
let ALL_OFF: Record<string, boolean>;
beforeAll(async () => {
    base = await loadGameDataFs();
    ALL_OFF = Object.fromEntries(scenarioGameData(base, SC).scenario!.manifest.flags.map((f) => [f.name, false]));
}, 120000);

function game(flags: Record<string, boolean>, voices = true, params: Record<string, number> = {}): { g: Galaxy; p: Empire; ais: Empire[] } {
    const g = createScenarioGame(base, { scenario: SC, flags: { ...ALL_OFF, eventLog: true, llmFoundations: true, llmVoices: voices, ...flags }, params }).game.galaxy;
    const p = g.playerEmpire!;
    const ais = g.empires.filter((e): e is Empire => e !== null && e !== p && e.active && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e.capital !== null);
    return { g, p, ais };
}

const SAY = 'We have watched them for months; the net is closing and the realm must act before they strike again.';

function transport(answer: (r: LlmRequest) => string | Error = () => JSON.stringify({ text: SAY }), up = true): LlmTransport & { reqs: LlmRequest[] } {
    const reqs: LlmRequest[] = [];
    return {
        reqs,
        model: () => 'fake-14b',
        probe: async () => up,
        complete: async (r) => {
            reqs.push(r);
            const a = answer(r);
            if (a instanceof Error) throw a;
            return { text: a };
        },
    };
}

function job(g: Galaxy, p: Empire, t: LlmTransport, policy = {}): VoiceJob {
    const queue = new LlmQueue({ transport: t, clock: galaxyLlmClock(g), policy: () => ({ ...DEFAULT_LLM_POLICY, ...policy }) });
    return new VoiceJob({ galaxy: g, player: p, queue });
}

async function run(j: VoiceJob): Promise<void> {
    j.poll();
    // The probe resolves first, then the request.
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await j.settle();
}

/** A confirmed 19m lead on one of the player's characters (the emit site's own path). */
function confirmLead(g: Galaxy, p: Empire): { scripted: string } {
    const c = getEmpireCharacters(p).find((x) => x.active && x.role !== CharacterRole.Leader)!;
    const thing = registerHiddenThing(g, { kind: 'plot', concealment: 40, empire: p, target: c, package: 'test' })!;
    const lead = setLeadLevel(g, thing, p, 'confirmed', 'investigation')!;
    onLeadChanged(g, lead, thing);
    return { scripted: empireMessages(p).at(-1)!.description };
}

describe('council seats', () => {
    it('spymaster: a confirmed lead leaves a cue; the grounded prompt; the message upgraded in place', async () => {
        const { g, p } = game({ internalSecurity: true });
        expect(voicesOn(g)).toBe(true);
        const { scripted } = confirmLead(g, p);
        const cues = peekVoiceCues(g);
        expect(cues).toHaveLength(1);
        expect(cues[0]).toMatchObject({ kind: 'spymaster', scripted });
        expect(cues[0].empire).toBe(p);
        expect(cues[0].voice).toBe(p);
        const m = cues[0].message!;
        expect(m).toBe(empireMessages(p).at(-1));
        const req = buildVoiceRequest(g, cues[0]);
        const sys = req.messages[0].content;
        expect(sys).toContain(SEAT_TASKS.spymaster);
        expect(sys).toContain(`Government: ${governmentName(p)}`); // persona line by government
        expect(sys).toContain(`${p.name}:`); // the digest text
        expect(sys).toMatch(/- lead: Plot/);
        expect(req.situation).toMatch(/^v1\n/);
        // The digest part stays within ≈ 400 tokens.
        const digest = sys.split('DIGEST (our empire now):\n')[1];
        expect(estimateTokens(digest)).toBeLessThanOrEqual(400);

        const t = transport();
        const j = job(g, p, t);
        await run(j);
        expect(t.reqs).toHaveLength(1);
        expect(t.reqs[0]).toMatchObject({ priority: 'voice', purpose: 'voice.spymaster', schemaName: 'voice', schema: VOICE_SCHEMA });
        expect(m.description).toBe(voicedDescription(scripted, cues[0].role, SAY));
        expect(m.description.startsWith(scripted)).toBe(true);
        expect(layerVoiceOf(m)).toMatchObject({ original: scripted, text: SAY, kind: 'spymaster' });
        expect(peekVoiceCues(g)).toHaveLength(0);
    });

    it('fallback: no model, a refused budget, an endpoint error or an unusable answer leave the scripted text', async () => {
        for (const [t, policy, outcome] of [
            [transport(undefined, false), {}, 'silent'],
            [transport(), { requestsPerYear: 0 }, 'budget'],
            [transport(() => new Error('HTTP 500')), {}, 'error'],
            [transport(() => 'not json'), {}, 'unusable'],
            [transport(() => JSON.stringify({ text: 'ok' })), {}, 'unusable'],
        ] as const) {
            const { g, p } = game({ internalSecurity: true });
            const { scripted } = confirmLead(g, p);
            const m = empireMessages(p).at(-1)!;
            const j = job(g, p, t, policy);
            await run(j);
            expect(m.description).toBe(scripted);
            expect(layerVoiceOf(m)).toBeUndefined();
            expect(j.outcomes).toEqual([{ purpose: 'voice.spymaster', outcome, applied: false }]);
        }
        expect(parseVoiceAnswer(JSON.stringify({ text: `"${SAY}"` }))).toBe(SAY);
        expect(parseVoiceAnswer(JSON.stringify({ text: 'Per the DIGEST we are {fine} and well.' }))).toBeNull();
    }, 60000);

    it('cache by situation hash: two identical situations send one request', async () => {
        const { g, p } = game({ internalSecurity: true });
        confirmLead(g, p);
        const cue = peekVoiceCues(g)[0];
        const m2 = scenarioMessage(g, p, 'x', cue.scripted);
        noteVoiceCue(g, { ...cue, message: m2 });
        const t = transport();
        await run(job(g, p, t));
        expect(t.reqs).toHaveLength(1);
        expect(layerVoiceOf(cue.message!)?.text).toBe(SAY);
        expect(layerVoiceOf(m2)?.text).toBe(SAY);
    });

    it('marshal: the war goal decision message carries the argument for the recommended goal', async () => {
        const { g, p, ais } = game({ warGoals: true });
        const enemy = ais[0];
        startWarLedger(g, enemy, p);
        const d = pendingScenarioDecisions(g, p).find((x) => x.kind === 'lively.warGoal')!;
        expect(d).toBeDefined();
        const cue = peekVoiceCues(g).find((c) => c.kind === 'marshal')!;
        expect(cue.message!.subject).toBe(d);
        expect(cue.facts).toMatchObject({ enemy: enemy.name, weDeclared: false });
        const sys = buildVoiceRequest(g, cue).messages[0].content;
        expect(sys).toContain(SEAT_TASKS.marshal);
        expect(sys).toContain(`- recommendedGoal: ${String(cue.facts.recommendedGoal)}`);
        const t = transport();
        await run(job(g, p, t));
        expect(cue.message!.description.startsWith(d.text)).toBe(true);
        expect(cue.message!.description).toContain(SAY);
        expect(d.text).not.toContain(SAY); // the decision's own (saved) text is untouched
        // Answering still works as before.
        expect(answerScenarioDecision(g, d.id, d.defaultOption)).toBe(true);
    });

    it('chancellor (19o, absent on this build): the documented hook is inert until the ledger flag is on', async () => {
        const { g, p, ais } = game({});
        const m = scenarioMessage(g, p, 'Grievance', 'The Xi now hold the border raid against us.');
        expect(VOICE_EVENTS.grievanceAdded).toBe('reputation.grievanceAdded');
        expect(voiceGrievanceAdded(g, { holder: ais[0], against: p, cause: 'border.incident', value: -12, message: m })).toBeNull();
        g.scenario!.flags.reputationLedger = true;
        const cue = voiceGrievanceAdded(g, { holder: ais[0], against: p, cause: 'border.incident', value: -12, message: m })!;
        expect(cue).toMatchObject({ kind: 'chancellor', facts: { heldBy: ais[0].name, weHoldIt: false } });
        expect(cue.other).toBe(ais[0]);
        expect(buildVoiceRequest(g, cue).messages[0].content).toContain(SEAT_TASKS.chancellor);
        await run(job(g, p, transport()));
        expect(m.description).toContain(SAY);
    });
});

describe('faction ultimatums', () => {
    it('19d1: a loyalty warning becomes the restless character\'s ultimatum in their voice', async () => {
        const { g, p } = game({ internalPolitics: true });
        const c = getEmpireCharacters(p).find((x) => x.active && [CharacterRole.ColonyGovernor, CharacterRole.Ambassador, CharacterRole.FleetAdmiral, CharacterRole.Scientist, CharacterRole.TroopGeneral, CharacterRole.IntelligenceAgent].includes(x.role))!;
        const e = politicsEntry(g, c);
        e.loyalty = 10;
        e.ambition = 90;
        e.grievances = [{ year: 1, cause: 'taxes', amount: -5 }];
        drainVoiceCues(g);
        sendLoyaltyWarnings(g, p, gameYear(galaxyStarDate(g)));
        const cue = peekVoiceCues(g).find((x) => x.kind === 'ultimatum' && x.speaker === c)!;
        expect(cue).toBeDefined();
        expect(cue.facts).toMatchObject({ leader: c.name, loyalty: 10, grievances: 'taxes' });
        const sys = buildVoiceRequest(g, cue).messages[0].content;
        expect(sys).toContain('Deliver your ultimatum');
        expect(sys).toContain(`${c.name}`);
        await run(job(g, p, transport()));
        expect(cue.message!.description).toContain(`${cue.role}: “${SAY}”`);
    });

    it('19n court faction (absent): inert without courtDynasties, voiced with it', () => {
        const { g, p } = game({});
        const leader = getEmpireCharacters(p).find((x) => x.active)!;
        const args = { empire: p, leader, faction: 'the Low-Tax Faction', demand: 'lower taxes', threat: 'a coup', message: null };
        expect(voiceFactionUltimatum(g, args)).toBeNull();
        g.scenario!.flags.courtDynasties = true;
        const fc = voiceFactionUltimatum(g, args)!;
        expect(fc).toMatchObject({ kind: 'ultimatum', facts: { demand: 'lower taxes' } });
        expect(fc.speaker).toBe(leader);
        expect(VOICE_EVENTS.factionUltimatum).toBe('court.factionUltimatum');
    });
});

describe('council speeches', () => {
    it('two members speak for / against the motion beside it: scripted at once, voiced in place', async () => {
        const { g, p, ais } = game({ galacticCouncil: true }, true, { councilJoinThreshold: -1000 });
        const es = [p, ...ais.slice(0, 3)];
        for (const a of es)
            for (const b of es) {
                if (a === b) continue;
                const r = a.diplomaticRelations.byEmpire(b);
                if (r === null) a.diplomaticRelations.add(new DiplomaticRelation(DiplomaticRelationType.None, a, a, b, false));
                else if (r.type === DiplomaticRelationType.NotMet) r.type = DiplomaticRelationType.None;
            }
        reviewCouncil(g, gameYear(galaxyStarDate(g)));
        const c = councilOf(g, p)!;
        expect(c).not.toBeNull();
        c.motion = null;
        for (const d of pendingScenarioDecisions(g, p)) answerScenarioDecision(g, d.id, d.defaultOption);
        drainVoiceCues(g);
        const [a, , x] = c.members.filter((e) => e !== p);
        const motion = proposeMotion(g, c, { kind: 'sanction', proposer: a, target: x, other: a, resourceId: -1 });
        const cue = peekVoiceCues(g).find((q) => q.kind === 'speech')!;
        expect(cue.message).toBeNull();
        expect((cue.ref as { council: unknown; motion: unknown }).council).toBe(c);
        expect((cue.ref as { council: unknown; motion: unknown }).motion).toBe(motion);
        const t = transport((r) => JSON.stringify({ text: r.purpose.endsWith('.for') ? `For the good of all, ${x.name} must answer for what it did.` : `This council is a tool of ${a.name}; we will not be bullied.` }));
        const j = job(g, p, t);
        // The screen asks first: the scripted lines at once.
        const first = j.councilSpeeches(c, motion)!;
        expect(first.for).toMatchObject({ side: 'for', voiced: false });
        expect(first.for!.speaker).toBe(a);
        expect(first.for!.text).toContain(a.name);
        expect(first.against).toMatchObject({ side: 'against', voiced: false });
        expect(first.against!.speaker).toBe(x);
        let changed = 0;
        j.councilSpeeches(c, motion, () => changed++);
        await run(j); // the cue for the same motion adds nothing
        expect(t.reqs.map((r) => r.purpose).sort()).toEqual(['voice.speech.against', 'voice.speech.for']);
        const forSys = t.reqs.find((r) => r.purpose === 'voice.speech.for')!.messages[0].content;
        expect(forSys).toContain(`delegate of the ${a.name}`);
        expect(forSys).toContain(motion.text);
        expect(forSys).toContain('Speak FOR the motion');
        const now = j.councilSpeeches(c, motion)!;
        expect(now.for).toMatchObject({ voiced: true, text: `For the good of all, ${x.name} must answer for what it did.` });
        expect(now.against!.voiced).toBe(true);
        expect(changed).toBe(2);
        // The council view hands the screen the motion by reference.
        expect(councilView(g, p)!.motionRef).toBe(motion);
    });
});

describe('rim lore', () => {
    it('Concord: the terms message at first contact gets the mask-ritual greeting', async () => {
        const { g, p } = game({ rimTrader: true });
        const r = rimTraderEmpire(g)!;
        expect(r).not.toBeNull();
        for (const [a, b] of [[r, p], [p, r]] as const) {
            const rel = a.diplomaticRelations.byEmpire(b);
            if (rel === null) a.diplomaticRelations.add(new DiplomaticRelation(DiplomaticRelationType.None, a, a, b, false));
            else rel.type = DiplomaticRelationType.None;
        }
        drainVoiceCues(g);
        rimTraderYear(g);
        const cue = peekVoiceCues(g).find((c) => c.kind === 'concord')!;
        expect(cue.facts).toMatchObject({ occasion: 'first contact', concord: r.name });
        expect(cue.voice).toBe(r);
        expect(cue.other).toBe(p);
        expect(cue.message!.sender).toBe(r);
        const t = transport();
        await run(job(g, p, t));
        const sys = t.reqs[0].messages[0].content;
        expect(sys).toContain('mask ritual');
        expect(sys).toContain(`Greet the ${p.name}`);
        expect(t.reqs[0].purpose).toBe('voice.concord');
        expect(cue.message!.description).toContain(SAY);
    });

    it('herders: the migration warning carries the elders\' lore (their own empire\'s persona)', async () => {
        const { g, p, ais } = game({});
        const herders = ais[1];
        const m = scenarioMessage(g, p, 'Rim Herders', 'The herders of Oss warn us: their herds will migrate soon.', { type: EmpireMessageType.RemoveForcesFromSystem });
        const cue = noteVoiceCue(g, { kind: 'herders', empire: p, message: m, voice: herders, other: p, speaker: null, role: 'the elders of Oss', facts: { colony: 'Oss', corridor: 'Vega, Deneb', herds: 2 } })!;
        const sys = buildVoiceRequest(g, cue).messages[0].content;
        expect(sys).toContain('old lore of this migration');
        expect(sys).toContain('- corridor: Vega, Deneb');
        expect(sys).toContain(`${herders.name}:`); // the herders' digest toward the player
        await run(job(g, p, transport()));
        expect(m.description).toBe(voicedDescription('The herders of Oss warn us: their herds will migrate soon.', 'the elders of Oss', SAY));
    });
});

describe('letters (19n-2, absent on this build)', () => {
    it('inert without courtIntrigue; with it the blackmail letter is voiced into the message', async () => {
        const { g, p, ais } = game({});
        const m = scenarioMessage(g, p, 'A letter', 'An unsigned letter arrives.');
        const args = { empire: p, from: ais[0], agent: null, scheme: 'blackmail' as const, victim: 'Governor Ashe', secret: 'embezzlement', demand: '5000 credits', message: m };
        expect(voiceSchemeLetter(g, args)).toBeNull();
        g.scenario!.flags.courtIntrigue = true;
        const cue = voiceSchemeLetter(g, args)!;
        expect(cue).toMatchObject({ kind: 'letter', facts: { secret: 'embezzlement' } });
        expect(cue.voice).toBe(ais[0]);
        const t = transport();
        await run(job(g, p, t));
        expect(t.reqs[0].messages[0].content).toContain('blackmail letter');
        expect(m.description).toContain(SAY);
        expect(VOICE_EVENTS.schemeLetter).toBe('intrigue.schemeLetter');
    });
});

describe('diplomat grounding (18b upgrade)', () => {
    it('the diplomat prompt carries the ledger causes / grievances and claims / casus belli with voices on only', () => {
        for (const voices of [true, false]) {
            const { g, p, ais } = game({}, voices);
            const ai = ais[0];
            const s = g.scenario!;
            s.flags.reputationLedger = true;
            s.state.reputation = {
                pairs: {
                    [`${ai.empireId}>${p.empireId}`]: [{ cause: 'border.incident', labelKey: 'x', value: -12, decayPerYear: 3, source: '19l', date: 0, term: 'incident' }],
                    [`${p.empireId}>${ai.empireId}`]: [{ cause: 'espionage.caught', labelKey: 'x', value: -30, decayPerYear: 3, source: '19d3', date: 0, term: 'incident' }],
                },
            };
            s.state.warGoals = { wars: {}, offers: {}, treaties: [], reparations: [], humiliations: {}, casusBelli: { [`${ai.empireId}:${p.empireId}`]: galaxyStarDate(g) } };
            const context = { kind: 'incoming' as const, messageType: 'GeneralNeutralEvent', heading: 'A word', original: 'We greet you.' };
            const plain = buildDiplomatBrief(g, ai, p, context);
            const brief = groundDiplomatBrief(g, plain, ai, p);
            const sys = buildDiplomatSystemPrompt(brief);
            if (!voices) {
                expect(brief).toBe(plain);
                expect(sys).toBe(buildDiplomatSystemPrompt(plain));
                expect(sys).not.toContain('grounding');
                continue;
            }
            expect(brief.grounding).toEqual({
                ledger: { sum: -12, ourCauses: [{ c: 'border.incident', v: -12 }], theyHoldAgainstUs: [{ c: 'espionage.caught', v: -30 }] },
                claims: { oursOnTheirColonies: [], theirClaimsOnOurs: 0, casusBelliAgainst: [p.name.slice(0, 32)] },
            });
            expect(sys).toContain('BRIEF.grounding holds the real record');
            expect(sys).toContain('"theyHoldAgainstUs":[{"c":"espionage.caught","v":-30}]');
            expect(sys).toContain('casusBelliAgainst');
        }
    });
});

describe('flags off', () => {
    it('llmVoices off: no cue from the emit sites, no job, nothing upgraded', async () => {
        const { g, p } = game({ internalSecurity: true }, false);
        expect(voicesOn(g)).toBe(false);
        const { scripted } = confirmLead(g, p);
        expect(peekVoiceCues(g)).toHaveLength(0);
        expect(noteVoiceCue(g, { kind: 'herders', empire: p, message: null, voice: p, other: null, speaker: null, role: 'x', facts: {} })).toBeNull();
        const layer = startLlmLayer({ galaxy: g, player: p, settings: () => ({ endpoint: 'x', model: 'y', api: 'auto' }), transport: transport(), pollMs: 60000 });
        expect(layer.on).toBe(true);
        expect(layer.voices).toBeNull();
        expect(activeVoiceJob()).toBeNull();
        layer.dispose();
        const t = transport();
        const j = job(g, p, t);
        await run(j);
        expect(t.reqs).toEqual([]);
        expect(empireMessages(p).at(-1)!.description).toBe(scripted);
        expect(j.councilSpeeches({ name: 'c', members: [] }, { id: 1, kind: 'sanction', proposer: p, target: p, text: 'x', votes: [] })).toBeNull();
    });

    it('the app layer with voices on registers the job and polls it', async () => {
        const { g, p } = game({ internalSecurity: true });
        const t = transport();
        const voiced: string[] = [];
        const layer = startLlmLayer({ galaxy: g, player: p, settings: () => ({ endpoint: 'x', model: 'y', api: 'auto' }), transport: t, pollMs: 60000, onVoiced: (v) => voiced.push(v.text) });
        expect(layer.voices).not.toBeNull();
        expect(activeVoiceJob()).toBe(layer.voices);
        confirmLead(g, p);
        await run(layer.voices!);
        expect(voiced).toEqual([SAY]);
        expect(layer.queue!.metrics().byPurpose).toMatchObject({ 'voice.spymaster': 1 });
        layer.dispose();
        expect(activeVoiceJob()).toBeNull();
    });

    it('the emit hooks never touch the sim: voices on and off run byte-identical (same state digest, same draws)', () => {
        const flags = { internalSecurity: true, internalPolitics: true, galacticCouncil: true, warGoals: true, rimTrader: true };
        const on = game(flags, true);
        const off = game(flags, false);
        const gOn = createScenarioGame(base, { scenario: SC, flags: { ...ALL_OFF, eventLog: true, llmFoundations: true, llmVoices: true, ...flags } }).game;
        const gOff = createScenarioGame(base, { scenario: SC, flags: { ...ALL_OFF, eventLog: true, llmFoundations: true, llmVoices: false, ...flags } }).game;
        runGameSeconds(gOn, 240);
        runGameSeconds(gOff, 240);
        expect(stateDigest(gOn.galaxy)).toBe(stateDigest(gOff.galaxy));
        expect(gOn.galaxy.rnd.drawCount).toBe(gOff.galaxy.rnd.drawCount);
        // And the hooks called by hand on both games (a confirmed lead, a war goal) leave the same state.
        confirmLead(on.g, on.p);
        confirmLead(off.g, off.p);
        startWarLedger(on.g, on.ais[0], on.p);
        startWarLedger(off.g, off.ais[0], off.p);
        expect(stateDigest(on.g)).toBe(stateDigest(off.g));
        expect(peekVoiceCues(on.g).length).toBeGreaterThan(0);
        expect(peekVoiceCues(off.g)).toHaveLength(0);
    }, 600000);
});
