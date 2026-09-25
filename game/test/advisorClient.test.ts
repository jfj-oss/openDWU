// 18a — the advisor's model client (src/ui/advisorClient.ts) against a tiny fake model server (node http, no network),
// and one full chat turn on the seed-1 harness game with a scripted reply.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame } from './helpers/tickGame';
import { BuiltObjectMissionType, builtObjectMission } from '../src/sim/missions/mission';
import type { AdvisorBrief } from '../src/sim/player/advisorBrief';
import { ADVISOR_RESPONSE_SCHEMA } from '../src/sim/player/advisorCommands';
import {
    buildAdvisorMessages,
    buildAdvisorSystemPrompt,
    extractReplyText,
    probeAdvisorEndpoint,
    requestAdvisor,
    runAdvisorTurn,
    PLAYER_ASKS_TO_QUEUE,
    type ChatMessage,
} from '../src/ui/advisorClient';
import { DiplomaticRelationType } from '../src/sim/diplomacy';

type Handler = (req: IncomingMessage, body: string, res: ServerResponse) => void;
let server: Server;
let url = '';
let handler: Handler = (_q, _b, res) => {
    res.statusCode = 404;
    res.end();
};
const requests: { path: string; body: unknown }[] = [];

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
    server.close();
});

function json(res: ServerResponse, obj: unknown): void {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(obj));
}

describe('probeAdvisorEndpoint', () => {
    it('detects Ollama (/api/version), an OpenAI server (/v1/models), and nothing', async () => {
        handler = (req, _b, res) => (req.url === '/api/version' ? json(res, { version: '0.34.1' }) : ((res.statusCode = 404), res.end()));
        expect(await probeAdvisorEndpoint({ endpoint: url, model: 'm', api: 'auto' })).toBe('ollama');
        handler = (req, _b, res) => (req.url === '/v1/models' ? json(res, { data: [] }) : ((res.statusCode = 404), res.end()));
        expect(await probeAdvisorEndpoint({ endpoint: `${url}/`, model: 'm', api: 'auto' })).toBe('openai');
        expect(await probeAdvisorEndpoint({ endpoint: url, model: 'm', api: 'ollama' })).toBeNull();
        expect(await probeAdvisorEndpoint({ endpoint: 'http://127.0.0.1:9', model: 'm', api: 'auto' }, fetch, 500)).toBeNull();
    });
});

describe('requestAdvisor', () => {
    const msgs: ChatMessage[] = [{ role: 'user', content: 'hi' }];

    it('Ollama: POST /api/chat with the response schema as `format`, thinking off', async () => {
        requests.length = 0;
        handler = (_q, _b, res) => json(res, { message: { role: 'assistant', content: '{"reply":"Aye.","commands":[]}' } });
        const r = await requestAdvisor({ endpoint: url, model: 'qwen3:4b', api: 'ollama' }, msgs);
        expect(r.raw).toBe('{"reply":"Aye.","commands":[]}');
        expect(r.api).toBe('ollama');
        expect(requests[0].path).toBe('/api/chat');
        expect(requests[0].body).toMatchObject({ model: 'qwen3:4b', messages: msgs, format: ADVISOR_RESPONSE_SCHEMA, stream: false, think: false });
    });

    it('OpenAI-compatible: POST /v1/chat/completions with response_format json_schema', async () => {
        requests.length = 0;
        handler = (_q, _b, res) => json(res, { choices: [{ message: { role: 'assistant', content: '```json\n{"reply":"Yes.","commands":[]}\n```' } }] });
        const r = await requestAdvisor({ endpoint: url, model: 'local', api: 'openai' }, msgs);
        expect(r.raw).toBe('{"reply":"Yes.","commands":[]}');
        expect(requests[0].path).toBe('/v1/chat/completions');
        expect(requests[0].body).toMatchObject({ response_format: { type: 'json_schema', json_schema: { name: 'advisor_response', schema: ADVISOR_RESPONSE_SCHEMA } } });
    });

    it('HTTP errors and missing messages throw', async () => {
        handler = (_q, _b, res) => {
            res.statusCode = 500;
            res.end('model not found');
        };
        await expect(requestAdvisor({ endpoint: url, model: 'x', api: 'ollama' }, msgs)).rejects.toThrow('HTTP 500: model not found');
        expect(() => extractReplyText('openai', { choices: [] })).toThrow();
        expect(extractReplyText('ollama', { message: { content: '<think>hmm</think>{"a":1}' } })).toBe('{"a":1}');
    });
});

describe('runAdvisorTurn (harness game, scripted model)', () => {
    it('sends the brief in the system prompt and executes the chosen command', async () => {
        const gameData = await loadGameDataFs();
        const galaxy = createTickGame(gameData).galaxy;
        const player = galaxy.playerEmpire!;
        const ship = player.builtObjects.find((b) => b.name === 'Sublime Fantasy')!;
        // The fake model reads the brief and picks the explorer's "nearest unexplored system" order.
        handler = (_q, body, res) => {
            const sys = (JSON.parse(body) as { messages: ChatMessage[] }).messages[0].content;
            const brief = JSON.parse(sys.slice(sys.indexOf('BRIEF:\n') + 7).split('\n\nEARLIER')[0]) as AdvisorBrief;
            const c = brief.commands.find((x) => x.who === `s${ship.builtObjectID}` && x.do === 'Explore' && x.note === 'nearest unexplored system')!;
            json(res, { message: { content: JSON.stringify({ reply: 'Sublime Fantasy is on her way, Sovereign.', commands: [{ id: c.id }] }) } });
        };
        const history: ChatMessage[] = [{ role: 'user', content: 'status?' }, { role: 'assistant', content: 'All quiet.' }];
        const turn = await runAdvisorTurn({
            galaxy,
            player,
            selection: ship,
            history,
            text: 'send my explorer to the nearest unexplored system',
            cfg: { endpoint: url, model: 'qwen3:4b', api: 'ollama' },
        });
        expect(turn.error).toBeUndefined();
        expect(turn.reply).toBe('Sublime Fantasy is on her way, Sovereign.');
        expect(turn.results).toHaveLength(1);
        expect(turn.results[0]).toMatchObject({ ok: true, status: 'done' });
        expect(builtObjectMission(ship.mission)?.type).toBe(BuiltObjectMissionType.Explore);
        expect(turn.history).toEqual([
            { role: 'user', content: 'send my explorer to the nearest unexplored system' },
            { role: 'assistant', content: expect.stringMatching(/^"Sublime Fantasy is on her way, Sovereign\." \(orders Sublime Fantasy: Explore → .* carried out\)$/) },
        ]);
        // History and the new message follow the system prompt.
        const sent = requests[requests.length - 1].body as { messages: ChatMessage[] };
        expect(sent.messages.map((m) => m.role)).toEqual(['system', 'user']);
        expect(sent.messages[0].content).toContain('You are Gerrin Walkin, ruling Leader acting as fleet admiral of the Sol Commonwealth');
        expect(sent.messages[0].content).toContain('EARLIER IN THIS CHAT (context only, do not copy):\nPlayer said: status?\nYou answered: All quiet.');
    }, 120000);

    it('the model cannot confirm a war or queue an order on its own', async () => {
        const gameData = await loadGameDataFs();
        const galaxy = createTickGame(gameData).galaxy;
        const player = galaxy.playerEmpire!;
        const other = galaxy.empires.find((e) => e !== player && e.active && e !== galaxy.independentEmpire)!;
        player.diplomaticRelations.byEmpire(other)!.type = DiplomaticRelationType.None;
        other.diplomaticRelations.byEmpire(player)!.type = DiplomaticRelationType.None;
        const ship = player.builtObjects.find((b) => b.name === 'Sublime Fantasy')!;
        handler = (_q, body, res) => {
            const sys = (JSON.parse(body) as { messages: ChatMessage[] }).messages[0].content;
            const brief = JSON.parse(sys.slice(sys.indexOf('BRIEF:\n') + 7).split('\n\nEARLIER')[0]) as AdvisorBrief;
            const war = brief.commands.find((x) => x.do === 'WAR_DECLARE')!;
            const explore = brief.commands.find((x) => x.who === `s${ship.builtObjectID}` && x.note === 'nearest unexplored system')!;
            json(res, { message: { content: JSON.stringify({ reply: 'War it is.', commands: [{ id: war.id, confirm: true }, { id: explore.id, queue: true }] }) } });
        };
        const cfg = { endpoint: url, model: 'm', api: 'ollama' as const };
        const turn = await runAdvisorTurn({ galaxy, player, selection: null, history: [], text: 'declare war and explore', cfg });
        expect(turn.results.map((r) => r.status)).toEqual(['needs-confirm', 'done']);
        expect(player.diplomaticRelations.byEmpire(other)!.type).toBe(DiplomaticRelationType.None);
        expect(ship.subsequentMissions.length).toBe(0); // not queued: replaced the mission
        expect(builtObjectMission(ship.mission)?.type).toBe(BuiltObjectMissionType.Explore);
        const turn2 = await runAdvisorTurn({ galaxy, player, selection: null, history: [], text: 'then explore', cfg });
        expect(turn2.results[1].text).toContain('(queued)');
        expect(PLAYER_ASKS_TO_QUEUE.test('refuel the fleet')).toBe(false);
    }, 120000);

    it('an unreachable server is an error turn (nothing executed)', async () => {
        const gameData = await loadGameDataFs();
        const galaxy = createTickGame(gameData).galaxy;
        const turn = await runAdvisorTurn({ galaxy, player: galaxy.playerEmpire!, selection: null, history: [], text: 'hi', cfg: { endpoint: 'http://127.0.0.1:9', model: 'x', api: 'ollama' } });
        expect(turn.error).toBeDefined();
        expect(turn.results).toEqual([]);
    }, 120000);
});

describe('buildAdvisorMessages', () => {
    it('puts the fresh brief and the last turns (as text) in the system message, then the new message', () => {
        const brief = { empire: { name: 'E', money: 1 }, admiral: null, selection: null, distUnit: '', fleets: [], ships: [], places: [], empires: [], commands: [] } as AdvisorBrief;
        const h: ChatMessage[] = [];
        for (let i = 0; i < 10; i++) h.push({ role: 'user', content: `u${i}` }, { role: 'assistant', content: `a${i}` });
        const m = buildAdvisorMessages(brief, h, 'now', 2);
        expect(m).toHaveLength(2);
        expect(m[1]).toEqual({ role: 'user', content: 'now' });
        expect(m[0].content).toBe(`${buildAdvisorSystemPrompt(brief)}\n\nEARLIER IN THIS CHAT (context only, do not copy):\nPlayer said: u8\nYou answered: a8\nPlayer said: u9\nYou answered: a9`);
        expect(m[0].content).toContain('the Fleet Admiral of the E');
        expect(buildAdvisorMessages(brief, [], 'x')[0].content).toBe(buildAdvisorSystemPrompt(brief));
    });
});
