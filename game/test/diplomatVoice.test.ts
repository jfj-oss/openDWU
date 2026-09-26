// 18b — diplomat voice: the brief builder (src/sim/player/diplomatBrief.ts) on the seed-1 harness game, and the voice
// client (src/ui/diplomatVoice.ts) against a tiny fake model server: a voiced reply + counter id goes through the
// incoming path where the sim's evaluator decides; a timeout keeps the original line.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame } from './helpers/tickGame';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { GameData } from '../src/sim/data/gameData';
import { DiplomaticRelationType, DiplomaticStrategy, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { EmpireMessageType, empireMessages } from '../src/sim/messages';
import { stateDigest } from '../src/sim/tick/digest';
import { submitProposal } from '../src/sim/player/diplomacyProposals';
import { buildDiplomatBrief, listDiplomatCounters, personaLines, traitReading, type DiplomatContext } from '../src/sim/player/diplomatBrief';
import { proposeDiplomatCounter } from '../src/sim/player/diplomatCounter';
import {
    buildDiplomatSystemPrompt,
    counterOutcomeText,
    diplomatResponseSchema,
    parseDiplomatResponse,
    voiceDiplomatReply,
    voicedMessageText,
} from '../src/ui/diplomatVoice';
import { acceptProposal, isProposalValid } from '../src/ui/screens/diplomacyScreen';
import { galaxyStarDate } from '../src/sim/tick/simTime';

// ---------------------------------------------------------------------------------------------------------------
// Fake model server
// ---------------------------------------------------------------------------------------------------------------

type Handler = (req: IncomingMessage, body: string, res: ServerResponse) => void;
let server: Server;
let url = '';
let handler: Handler = (_q, _b, res) => {
    res.statusCode = 404;
    res.end();
};
const requests: { path: string; body: { messages?: { role: string; content: string }[]; format?: unknown } | null }[] = [];

beforeAll(async () => {
    server = createServer((req, res) => {
        let body = '';
        req.on('data', (c: Buffer) => (body += c.toString()));
        req.on('end', () => {
            requests.push({ path: req.url ?? '', body: body ? JSON.parse(body) : null });
            handler(req, body, res);
        });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
    server.closeAllConnections();
    server.close();
});

function ollamaAnswer(obj: unknown): Handler {
    return (_req, _b, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ message: { role: 'assistant', content: JSON.stringify(obj) } }));
    };
}

// ---------------------------------------------------------------------------------------------------------------
// Harness game
// ---------------------------------------------------------------------------------------------------------------

let gameData: GameData;
let galaxy: Galaxy;
let player: Empire;
let ai: Empire;

function setRelation(a: Empire, b: Empire, type: DiplomaticRelationType, initiator: Empire = a): void {
    for (const [x, y] of [[a, b], [b, a]] as const) {
        const r = obtainDiplomaticRelation(x, y);
        r.type = type;
        r.initiator = initiator;
        r.locked = false;
    }
}

function race(name: string) {
    const r = gameData.races.find((x) => x.name === name);
    if (!r) throw new Error(`no race ${name}`);
    return r;
}

beforeEach(async () => {
    gameData ??= await loadGameDataFs();
    galaxy = createTickGame(gameData).galaxy;
    player = galaxy.playerEmpire!;
    ai = galaxy.empires.find((e) => e !== player && e.pirateEmpireBaseHabitat === null && e !== galaxy.independentEmpire && e.active)!;
    ai.reclusive = false;
    player.reclusive = false;
    setRelation(player, ai, DiplomaticRelationType.None);
});

const proposalContext = (optionId: string, accepted: boolean, original: string): Extract<DiplomatContext, { kind: 'proposal' }> => ({
    kind: 'proposal',
    optionId,
    label: optionId === 'OFFER_MUTUALDEFENSE' ? 'Propose Mutual Defense Pact' : 'Propose Free Trade Agreement',
    accepted,
    reply: accepted ? 'FREETRADE_ACCEPT' : 'MUTUALDEFENSE_REJECT',
    original,
});

describe('buildDiplomatBrief (harness game)', () => {
    it('races with opposite traits produce different persona blocks', () => {
        // races.txt: Boskara Aggression 140 / Caution 72 / Friendliness 84; Teekan Aggression 63 / Caution 86 / Friendliness 107 / Loyalty 142.
        const ctx = proposalContext('OFFER_FREETRADE', false, 'We decline.');
        ai.dominantRace = race('Boskara');
        const hawk = buildDiplomatBrief(galaxy, ai, player, ctx);
        ai.dominantRace = race('Teekan');
        const dove = buildDiplomatBrief(galaxy, ai, player, ctx);

        expect(hawk.empire.race).toBe('Boskara');
        expect(hawk.race.find((t) => t.trait === 'Aggression')).toEqual({ trait: 'Aggression', value: 140, reads: 'belligerent and warlike' });
        expect(dove.race.find((t) => t.trait === 'Aggression')).toEqual({ trait: 'Aggression', value: 63, reads: 'peaceable' });
        expect(dove.race.find((t) => t.trait === 'Loyalty')?.reads).toBe('fiercely loyal to allies');
        const a = personaLines(hawk).join('\n');
        const b = personaLines(dove).join('\n');
        expect(a).not.toBe(b);
        expect(a).toContain('belligerent');
        expect(b).toContain('peaceable');
        expect(buildDiplomatSystemPrompt(hawk)).toContain('belligerent');
        expect(buildDiplomatSystemPrompt(dove)).not.toContain('belligerent');
        expect(traitReading('Caution', 100)).toBe('');
    });

    it('carries the C# verdict, the original line and the legal counters; builds read-only', () => {
        const rel = obtainDiplomaticRelation(ai, player);
        rel.strategy = DiplomaticStrategy.Befriend; // desired relation: Free Trade Agreement
        const res = submitProposal(galaxy, player, ai, 'OFFER_MUTUALDEFENSE');
        expect(res.ok).toBe(true);
        expect(res.accepted).toBe(false); // Main.Part10.cs:4201: desired FTA ≠ MDP → MUTUALDEFENSE_REJECT
        expect(res.reply).toBe('MUTUALDEFENSE_REJECT');

        const before = stateDigest(galaxy);
        const brief = buildDiplomatBrief(galaxy, ai, player, { ...proposalContext('OFFER_MUTUALDEFENSE', res.accepted, 'We have no interest in such an alliance.'), reply: res.reply });
        expect(stateDigest(galaxy)).toBe(before);

        expect(brief.exchange).toEqual({ kind: 'proposal', playerProposes: 'Propose Mutual Defense Pact', verdict: 'refused', originalLine: 'We have no interest in such an alliance.' });
        expect(brief.relation.current).toBe('None');
        expect(brief.relation.strategy).toBe('Befriend');
        expect(brief.attitude).not.toBeNull();
        expect(typeof brief.attitude!.score).toBe('number');
        expect(brief.strength.they).toMatch(/weaker|comparable|stronger/);
        // Legal counters in relation None: Free Trade (+ the pact, dropped because it is what was just refused).
        const all = listDiplomatCounters(ai, player).map((c) => c.id);
        const ids = brief.counters.map((c) => c.id);
        expect(ids).not.toContain('mutual-defense');
        if (all.includes('free-trade')) expect(ids).toContain('free-trade');
        expect((diplomatResponseSchema(brief) as { required: string[] }).required).toContain('reply');
        // Incoming messages carry no counters.
        expect(buildDiplomatBrief(galaxy, ai, player, { kind: 'incoming', messageType: 'ProposeDiplomaticRelation', heading: 'Treaty on Offer', original: 'x' }).counters).toEqual([]);
    });

    it('war offers only end-war; locked relations nothing', () => {
        setRelation(player, ai, DiplomaticRelationType.War);
        expect(listDiplomatCounters(ai, player).map((c) => c.id)).toEqual(['end-war']);
        obtainDiplomaticRelation(ai, player).locked = true;
        expect(listDiplomatCounters(ai, player)).toEqual([]);
    });
});

describe('parseDiplomatResponse', () => {
    it('keeps a legal counter, drops an invented one, trims quotes', () => {
        setRelation(player, ai, DiplomaticRelationType.War);
        const brief = buildDiplomatBrief(galaxy, ai, player, proposalContext('WAR_END_SUBJUGATIONDEMAND', false, 'No.'));
        expect(parseDiplomatResponse(brief, '{"reply":"\\"Never.\\"","counterId":"end-war"}')).toEqual({ reply: 'Never.', counterId: 'end-war' });
        expect(parseDiplomatResponse(brief, '{"reply":"Never.","counterId":"surrender"}')).toEqual({ reply: 'Never.', counterId: null, rejectedCounterId: 'surrender' });
        expect(parseDiplomatResponse(brief, 'not json').reply).toBe('');
        expect(parseDiplomatResponse(brief, '{"reply":"Never.","counterId":"none"}')).toEqual({ reply: 'Never.', counterId: null });
        expect(diplomatResponseSchema(brief)).toMatchObject({ properties: { counterId: { enum: ['none', 'end-war'] } } });
    });
});

describe('voiceDiplomatReply (fake model server)', () => {
    it('voices the reply; the counter goes through the incoming path and the sim evaluator accepts it', async () => {
        setRelation(player, ai, DiplomaticRelationType.War);
        const rel = obtainDiplomaticRelation(ai, player);
        rel.strategy = DiplomaticStrategy.Defend; // DetermineDesiredDiplomaticRelationTypical(Defend) = None → an end-war offer stands
        handler = ollamaAnswer({ reply: 'Your terms insult us, but we tire of this bloodshed.', counterId: 'end-war' });
        const msgsBefore = empireMessages(player).length;
        const v = await voiceDiplomatReply({
            galaxy,
            ai,
            player,
            context: proposalContext('WAR_END_SUBJUGATIONDEMAND', false, 'We will never submit!'),
            cfg: { endpoint: url, model: 'fake', api: 'ollama' },
        });
        expect(v.voiced).toBe(true);
        expect(v.text).toBe('Your terms insult us, but we tire of this bloodshed.');
        expect(v.original).toBe('We will never submit!');
        // The request carried the persona, the verdict and a schema constraining counterId.
        const req = requests[requests.length - 1];
        expect(req.path).toBe('/api/chat');
        expect(req.body!.messages![0].content).toContain('REFUSED');
        expect(req.body!.format).toMatchObject({ properties: { counterId: { enum: ['none', 'end-war'] } } });

        expect(v.counter?.status).toBe('proposed');
        const offer = player.proposedDiplomaticRelations.byEmpire(ai);
        expect(offer?.type).toBe(DiplomaticRelationType.None);
        const msgs = empireMessages(player);
        expect(msgs.length).toBe(msgsBefore + 1);
        expect(msgs[msgs.length - 1].messageType).toBe(EmpireMessageType.ProposeDiplomaticRelation);
        expect(msgs[msgs.length - 1].sender).toBe(ai);
        expect(voicedMessageText(msgs[msgs.length - 1])).toBe(v.text);
        expect(counterOutcomeText(v.counter)).toContain('Counter-proposal sent');
        // Incoming path: the 16d / Diplomacy screen validity check holds, and accepting ends the war.
        expect(isProposalValid(offer!, ai, player, galaxyStarDate(galaxy))).toBe(true);
        expect(acceptProposal(player, ai)).toBe(true);
        expect(obtainDiplomaticRelation(player, ai).type).toBe(DiplomaticRelationType.None);
    });

    it('the sim withdraws a counter its evaluator does not stand behind', async () => {
        setRelation(player, ai, DiplomaticRelationType.War);
        obtainDiplomaticRelation(ai, player).strategy = DiplomaticStrategy.Conquer; // desired: War
        handler = ollamaAnswer({ reply: 'Perhaps peace.', counterId: 'end-war' });
        const v = await voiceDiplomatReply({ galaxy, ai, player, context: proposalContext('WAR_END_SUBJUGATIONDEMAND', false, 'No.'), cfg: { endpoint: url, model: 'fake', api: 'ollama' } });
        expect(v.voiced).toBe(true);
        expect(v.counter?.status).toBe('withdrawn');
        expect(player.proposedDiplomaticRelations.byEmpire(ai)).toBeNull();
    });

    it('a stale conversation does not send the counter', async () => {
        setRelation(player, ai, DiplomaticRelationType.War);
        obtainDiplomaticRelation(ai, player).strategy = DiplomaticStrategy.Defend;
        handler = ollamaAnswer({ reply: 'Peace, then.', counterId: 'end-war' });
        const v = await voiceDiplomatReply({ galaxy, ai, player, context: proposalContext('WAR_END_SUBJUGATIONDEMAND', false, 'No.'), cfg: { endpoint: url, model: 'fake', api: 'ollama' }, applyCounter: () => false });
        expect(v.counter).toBeNull();
        expect(player.proposedDiplomaticRelations.byEmpire(ai)).toBeNull();
    });

    it('timeout → the original dialog line, no counter', async () => {
        handler = (_req, _b, res) => {
            setTimeout(() => {
                if (!res.writableEnded) res.end(JSON.stringify({ message: { content: '{"reply":"too late"}' } }));
            }, 1500);
        };
        const v = await voiceDiplomatReply({
            galaxy,
            ai,
            player,
            context: proposalContext('OFFER_FREETRADE', false, 'We are not interested in free trade with you.'),
            cfg: { endpoint: url, model: 'fake', api: 'ollama' },
            timeoutMs: 200,
        });
        expect(v.voiced).toBe(false);
        expect(v.text).toBe('We are not interested in free trade with you.');
        expect(v.error).toBe('timed out');
        expect(v.counter).toBeNull();
    });

    it('server error / empty reply → the original line', async () => {
        handler = (_req, _b, res) => {
            res.statusCode = 500;
            res.end('boom');
        };
        const v = await voiceDiplomatReply({ galaxy, ai, player, context: proposalContext('OFFER_FREETRADE', true, 'Agreed.'), cfg: { endpoint: url, model: 'fake', api: 'ollama' } });
        expect(v.text).toBe('Agreed.');
        expect(v.error).toContain('HTTP 500');
        handler = ollamaAnswer({ reply: '   ' });
        const w = await voiceDiplomatReply({ galaxy, ai, player, context: proposalContext('OFFER_FREETRADE', true, 'Agreed.'), cfg: { endpoint: url, model: 'fake', api: 'ollama' } });
        expect(w.voiced).toBe(false);
        expect(w.text).toBe('Agreed.');
    });
});

describe('proposeDiplomatCounter', () => {
    it('refuses unknown ids and a second open offer', () => {
        setRelation(player, ai, DiplomaticRelationType.War);
        obtainDiplomaticRelation(ai, player).strategy = DiplomaticStrategy.Defend;
        const brief = buildDiplomatBrief(galaxy, ai, player, proposalContext('WAR_END_SUBJUGATIONDEMAND', false, 'No.'));
        expect(proposeDiplomatCounter(galaxy, ai, player, brief, 'surrender').status).toBe('unknown');
        expect(proposeDiplomatCounter(galaxy, ai, player, brief, 'end-war').status).toBe('proposed');
        expect(proposeDiplomatCounter(galaxy, ai, player, brief, 'end-war').status).toBe('pending');
    });
});
