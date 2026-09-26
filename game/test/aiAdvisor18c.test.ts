// 18c — LLM strategic decisions for AI empires: the brief (src/sim/player/strategicBrief.ts) on the seed-1 harness game,
// the decisions (src/sim/player/strategicDecisions.ts) through a tiny fake model server — a war declaration applied
// through the scripted AI's own path (CheckReadyForWar → StartWar → DeclareWar with the news broadcast) against the
// player and against another AI, a gate that declines, a tech-emphasis change, illegal ids rejected — the command log
// (saved with the game), and the feature-off guarantee: the scheduler path is untouched (tick digest pin unchanged).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import { pin } from './pins/pin';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { GameData } from '../src/sim/data/gameData';
import { DiplomaticRelationType, DiplomaticStrategy, WarObjective, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { EmpireMessageType, empireMessages } from '../src/sim/messages';
import { stateDigest } from '../src/sim/tick/digest';
import { runGameSeconds } from '../src/sim/tick/harness';
import { empireShipGroups } from '../src/sim/fleets/shipGroup';
import { resolveTechFocus } from '../src/sim/data/policies';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { buildStrategicBrief, listStrategicOptions, openTechFocusSlot, priorityLevelIndex, strategicEmpireRef, techFocusIndex } from '../src/sim/player/strategicBrief';
import { applyStrategicDecisions, strategicResponseSchema, validateStrategicResponse } from '../src/sim/player/strategicDecisions';
import { commandLog, type AdvisorLogEntry } from '../src/sim/player/commandLog';
import { AiAdvisorDriver, STAR_DATE_DAY_MS, aiAdvisorSettingsWithUrl, buildStrategicSystemPrompt, runStrategicTurn, selectAdvisedEmpires, type AiAdvisorSettings } from '../src/ui/aiAdvisorDriver';
import { councilLogEntry } from '../src/ui/aiAdvisorLog';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { DEFAULT_SETTINGS, loadSettings, setSettingsStorage } from '../src/ui/settings';

// ---------------------------------------------------------------------------------------------------------------
// Fake model server (Ollama protocol)
// ---------------------------------------------------------------------------------------------------------------

type Handler = (req: IncomingMessage, body: string, res: ServerResponse) => void;
let server: Server;
let url = '';
let handler: Handler = (_q, _b, res) => {
    res.statusCode = 404;
    res.end();
};
const requests: { path: string; body: { messages?: { role: string; content: string }[]; format?: unknown } | null }[] = [];

function ollamaAnswer(obj: unknown): Handler {
    return (req, _b, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/api/version') res.end(JSON.stringify({ version: 'fake' }));
        else res.end(JSON.stringify({ message: { role: 'assistant', content: JSON.stringify(obj) } }));
    };
}

let gameData: GameData;

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
    gameData = await loadGameDataFs();
}, 120000);
afterAll(() => {
    server.closeAllConnections();
    server.close();
});

// ---------------------------------------------------------------------------------------------------------------
// Harness game: seed 1, run 60 game-s so the AIs have formed fleets; the player and the AIs are made to have met.
// ---------------------------------------------------------------------------------------------------------------

function setRelation(a: Empire, b: Empire, type: DiplomaticRelationType, initiator: Empire = a): void {
    for (const [x, y] of [[a, b], [b, a]] as const) {
        const r = obtainDiplomaticRelation(x, y);
        r.type = type;
        r.initiator = initiator;
        r.locked = false;
    }
}

interface World {
    galaxy: Galaxy;
    player: Empire;
    ai: Empire;
    ai2: Empire;
}

function world(): World {
    const galaxy = cachedTickGame(gameData).galaxy;
    runGameSeconds(galaxy, 60);
    const player = galaxy.playerEmpire!;
    const ais = galaxy.empires.filter((e) => e !== player && e.pirateEmpireBaseHabitat === null && e !== galaxy.independentEmpire && e.active);
    // The AI with an attack fleet (CheckReadyForWar needs one).
    const ai = ais.find((e) => empireShipGroups(e).some((s) => s !== null && s.ships.length > 0)) ?? ais[0];
    const ai2 = ais.find((e) => e !== ai)!;
    for (const [a, b] of [[player, ai], [player, ai2], [ai, ai2]] as const) setRelation(a, b, DiplomaticRelationType.None);
    for (const e of [player, ai, ai2]) e.reclusive = false;
    return { galaxy, player, ai, ai2 };
}

const cfg = (): { endpoint: string; model: string; api: 'ollama' } => ({ endpoint: url, model: 'fake', api: 'ollama' });

describe('buildStrategicBrief (harness game)', () => {
    it('persona, state, met empires and the legal decisions; read-only', () => {
        const w = world();
        const rel = obtainDiplomaticRelation(w.ai, w.player);
        rel.strategy = DiplomaticStrategy.Befriend;
        rel.lastDiplomacyTradeOfferDate = 0;
        const before = stateDigest(w.galaxy);
        const drawsBefore = w.galaxy.rnd.drawCount;
        const brief = buildStrategicBrief(w.galaxy, w.ai);
        expect(stateDigest(w.galaxy)).toBe(before);
        expect(w.galaxy.rnd.drawCount).toBe(drawsBefore);

        expect(brief.empire.name).toBe(w.ai.name);
        expect(brief.empire.race).toBe(w.ai.dominantRace!.name);
        expect(brief.race.map((t) => t.trait)).toEqual(['Intelligence', 'Aggression', 'Caution', 'Friendliness', 'Loyalty']);
        expect(brief.state.colonies).toBe(w.ai.colonies.length);
        expect(typeof brief.state.annualCashflow).toBe('number');
        const pv = brief.empires.find((e) => e.name === w.player.name)!;
        expect(pv.isPlayer).toBe(true);
        expect(pv.relation).toBe('None');
        expect(pv.yourStrategy).toBe('Befriend');
        expect(pv.wants).toBe('FreeTradeAgreement');
        expect(brief.empires.some((e) => e.name === w.ai2.name)).toBe(true);

        const ids = brief.decisions.map((d) => d.id);
        // Befriend + no treaty → the AI's OfferFreeTrade move (Empire.8.cs 1801), also on the 17e menu from its side.
        expect(ids).toContain(`offer-free-trade:${strategicEmpireRef(w.player)}`);
        // No Conquer strategy → no war declaration.
        expect(ids.some((id) => id.startsWith('declare-war'))).toBe(false);
        expect(ids).toContain('none');
        expect(ids).toContain('policy:WarWillingness');
        const focus = brief.decisions.find((d) => d.id === 'tech-focus');
        expect(openTechFocusSlot(w.galaxy, w.ai)).toBeGreaterThan(0);
        expect(focus?.to?.length).toBeGreaterThan(10);
        // The persona block (18b's) reaches the prompt; the schema constrains ids to the brief's.
        const prompt = buildStrategicSystemPrompt(brief);
        expect(prompt).toContain(w.ai.dominantRace!.name);
        expect(prompt).toContain('DECISIONS:');
        expect((strategicResponseSchema(brief) as { properties: { decisions: { items: { properties: { id: { enum: string[] } } } } } }).properties.decisions.items.properties.id.enum).toEqual(ids);
    }, 300000);
});

describe('strategic decisions through the fake model server', () => {
    it('declare war on the player: CheckReadyForWar → StartWar → DeclareWar, war message + news, logged and saved', async () => {
        const w = world();
        const rel = obtainDiplomaticRelation(w.ai, w.player);
        rel.strategy = DiplomaticStrategy.Conquer;
        rel.warObjective = WarObjective.TotalConquest; // CheckReadyForWar TotalConquest branch: ready
        const id = `declare-war:${strategicEmpireRef(w.player)}`;
        expect(listStrategicOptions(w.galaxy, w.ai).map((o) => o.id)).toContain(id);
        const playerMsgs = empireMessages(w.player).length;
        const ai2Msgs = empireMessages(w.ai2).length;

        handler = ollamaAnswer({ rationale: 'They are weak and our fleets are ready; we strike now.', decisions: [{ id }] });
        const turn = await runStrategicTurn({ galaxy: w.galaxy, ai: w.ai, cfg: cfg() });
        expect(turn.error).toBeUndefined();
        expect(turn.rationale).toBe('They are weak and our fleets are ready; we strike now.');
        expect(turn.results.map((r) => [r.id, r.status])).toEqual([[id, 'applied']]);
        expect(w.ai.diplomaticRelations.byEmpire(w.player)!.type).toBe(DiplomaticRelationType.War);
        expect(w.player.diplomaticRelations.byEmpire(w.ai)!.type).toBe(DiplomaticRelationType.War);
        // DeclareWar's message to the target and SendNewsBroadcastWarStartEnd to the empires the AI has met.
        const toPlayer = empireMessages(w.player).slice(playerMsgs);
        expect(toPlayer.some((m) => m.sender === w.ai && m.messageType === EmpireMessageType.DiplomaticRelationChange)).toBe(true);
        expect(empireMessages(w.ai2).slice(ai2Msgs).some((m) => m.messageType === EmpireMessageType.GalacticNewsNet)).toBe(true);
        // The request carried the schema (ids enumerated) and the brief.
        const req = requests[requests.length - 1];
        expect(req.path).toBe('/api/chat');
        expect(JSON.stringify(req.body!.format)).toContain(id);
        // Journaled and saved.
        const log = commandLog(w.galaxy);
        expect(log).toHaveLength(1);
        expect(log[0]).toMatchObject({ source: 'ai-advisor', empireId: w.ai.empireId, decisionId: id, command: { kind: 'DeclareWar', target: w.player.empireId }, status: 'applied' });
        expect(log[0].starDate).toBe(galaxyStarDate(w.galaxy));
        const time = new GalaxyTime();
        time.bindGalaxy(w.galaxy);
        const text = serializeGame({ galaxy: w.galaxy, playerEmpire: w.player, viewX: 0, viewY: 0 }, time, {} as never);
        expect(JSON.parse(text).commandLog).toHaveLength(1);
        const loaded = deserializeGame(text, gameData);
        expect(commandLog(loaded.game.galaxy)).toEqual(log);
        // The council log shows the rationale and the ✓ line.
        const entry = councilLogEntry(turn);
        expect(entry.rationale).toContain('fleets are ready');
        expect(entry.lines[0]).toEqual({ kind: 'ok', text: `✓ Declared war on the ${w.player.name}` });
    }, 300000);

    it('declare war on another AI: the player hears the news; a gate that declines leaves the command blocked', async () => {
        const w = world();
        const rel = obtainDiplomaticRelation(w.ai, w.ai2);
        rel.strategy = DiplomaticStrategy.Conquer;
        // CheckReadyForWar: WarObjective Undefined → not ready (Empire.8.cs 1433 default case). The C# gate runs.
        rel.warObjective = WarObjective.Undefined;
        const id = `declare-war:${strategicEmpireRef(w.ai2)}`;
        handler = ollamaAnswer({ rationale: 'War.', decisions: [{ id }] });
        const blocked = await runStrategicTurn({ galaxy: w.galaxy, ai: w.ai, cfg: cfg() });
        expect(blocked.results.map((r) => r.status)).toEqual(['blocked']);
        expect(w.ai.diplomaticRelations.byEmpire(w.ai2)!.type).toBe(DiplomaticRelationType.None);
        expect((commandLog(w.galaxy) as AdvisorLogEntry[]).map((e) => e.status)).toEqual(['blocked']);

        rel.warObjective = WarObjective.TotalConquest;
        const playerMsgs = empireMessages(w.player).length;
        const ok = await runStrategicTurn({ galaxy: w.galaxy, ai: w.ai, cfg: cfg() });
        expect(ok.results.map((r) => r.status)).toEqual(['applied']);
        expect(w.ai2.diplomaticRelations.byEmpire(w.ai)!.type).toBe(DiplomaticRelationType.War);
        const news = empireMessages(w.player).slice(playerMsgs).filter((m) => m.messageType === EmpireMessageType.GalacticNewsNet);
        expect(news.length).toBeGreaterThan(0);
        expect(news[0].sender).toBe(w.ai);
    }, 300000);

    it('treaty offer from the AI side: OfferFreeTrade puts the proposal and its message in the player inbox', async () => {
        const w = world();
        const rel = obtainDiplomaticRelation(w.ai, w.player);
        rel.strategy = DiplomaticStrategy.Befriend;
        rel.lastDiplomacyTradeOfferDate = 0;
        const id = `offer-free-trade:${strategicEmpireRef(w.player)}`;
        expect(listStrategicOptions(w.galaxy, w.ai).map((o) => o.id)).toContain(id);
        const msgs = empireMessages(w.player).length;
        handler = ollamaAnswer({ rationale: 'Trade binds friends.', decisions: [{ id }] });
        const turn = await runStrategicTurn({ galaxy: w.galaxy, ai: w.ai, cfg: cfg() });
        expect(turn.results.map((r) => [r.id, r.status])).toEqual([[id, 'applied']]);
        expect(w.player.proposedDiplomaticRelations.byEmpire(w.ai)?.type).toBe(DiplomaticRelationType.FreeTradeAgreement);
        expect(empireMessages(w.player).slice(msgs).some((m) => m.sender === w.ai && m.messageType === EmpireMessageType.ProposeDiplomaticRelation)).toBe(true);
        // Offer pending: the same move is no longer legal (no double offers).
        expect(listStrategicOptions(w.galaxy, w.ai).map((o) => o.id)).not.toContain(id);
        expect((commandLog(w.galaxy) as AdvisorLogEntry[]).map((e) => [e.decisionId, e.status])).toEqual([[id, 'applied']]);
    }, 300000);

    it('tech emphasis change lands in the empire policy fields (a new policy object)', async () => {
        const w = world();
        const slot = openTechFocusSlot(w.galaxy, w.ai);
        const inUse = w.ai.policy!.researchDesignTechFocus.map(techFocusIndex);
        const pick = inUse.includes(11) ? 'Armor' : 'Shields';
        const idx = pick === 'Shields' ? 11 : 10;
        const old = w.ai.policy!;
        handler = ollamaAnswer({ rationale: 'Our ships must outlast theirs.', decisions: [{ id: 'tech-focus', targetId: pick }, { id: 'policy:ResearchPriority', targetId: 'High' }] });
        const turn = await runStrategicTurn({ galaxy: w.galaxy, ai: w.ai, cfg: cfg() });
        expect(turn.results.map((r) => r.status)).toEqual(['applied', 'applied']);
        const p = w.ai.policy!;
        expect(p).not.toBe(old);
        const { category, type } = resolveTechFocus(idx);
        const pr = p as unknown as Record<string, number>;
        expect(pr[`researchDesignTechFocus${slot}`]).toBe(category);
        expect(pr[`researchDesignTechFocusType${slot}`]).toBe(type);
        expect(techFocusIndex(p.researchDesignTechFocus[slot - 1])).toBe(idx);
        expect(p.researchPriority).toBe(1.5);
        expect(priorityLevelIndex(old.researchPriority)).toBeLessThanOrEqual(2);
        // The other slots are the race's own.
        expect(p.researchDesignTechFocus.map(techFocusIndex).filter((_, i) => i !== slot - 1)).toEqual(inUse.filter((_, i) => i !== slot - 1));
        expect((commandLog(w.galaxy) as AdvisorLogEntry[]).map((e) => e.command.kind)).toEqual(['SetTechFocus', 'SetPolicy']);
        // Answering a choice with its current value means "keep": dropped, neither applied nor rejected.
        const b2 = buildStrategicBrief(w.galaxy, w.ai);
        expect(b2.decisions.find((d) => d.id === 'tech-focus')?.now).toBe(pick);
        const keep = validateStrategicResponse(b2, JSON.stringify({ rationale: 'Keep.', decisions: [{ id: 'tech-focus', targetId: pick }, { id: 'policy:ResearchPriority', targetId: 'High' }] }));
        expect(keep.decisions).toEqual([]);
        expect(keep.rejected).toEqual([]);
    }, 300000);

    it('illegal ids and targets are rejected; nothing changes', async () => {
        const w = world();
        const before = stateDigest(w.galaxy);
        const policy = w.ai.policy;
        // Not Conquer → declaring war on the player is not a legal decision (the schema enum excludes it too).
        const warId = `declare-war:${strategicEmpireRef(w.player)}`;
        handler = ollamaAnswer({
            rationale: 'Burn them all.',
            decisions: [{ id: warId }, { id: 'nuke-everything' }, { id: 'tech-focus', targetId: 'Lasers' }, { id: 'policy:WarWillingness', targetId: 'Extreme' }],
        });
        const turn = await runStrategicTurn({ galaxy: w.galaxy, ai: w.ai, cfg: cfg() });
        expect(turn.results).toEqual([]);
        expect(turn.rejected.map((r) => r.id)).toEqual([warId, 'nuke-everything', 'tech-focus', 'policy:WarWillingness']);
        expect(w.ai.diplomaticRelations.byEmpire(w.player)!.type).toBe(DiplomaticRelationType.None);
        expect(w.ai.policy).toBe(policy);
        expect(stateDigest(w.galaxy)).toBe(before);
        expect(commandLog(w.galaxy)).toHaveLength(0);
        expect(councilLogEntry(turn).lines.every((l) => l.kind === 'rejected')).toBe(true);
        // A decision legal in the brief but no longer legal when applied (the relation changed meanwhile) is rejected
        // on the live re-check, and nothing is called.
        const rel = obtainDiplomaticRelation(w.ai, w.player);
        rel.strategy = DiplomaticStrategy.Befriend;
        const brief = buildStrategicBrief(w.galaxy, w.ai);
        const offer = `offer-free-trade:${strategicEmpireRef(w.player)}`;
        const v = validateStrategicResponse(brief, JSON.stringify({ rationale: 'Trade.', decisions: [{ id: offer }] }));
        expect(v.decisions).toEqual([{ id: offer }]);
        rel.strategy = DiplomaticStrategy.Undefined;
        expect(applyStrategicDecisions(w.galaxy, w.ai, v.decisions).map((r) => r.status)).toEqual(['rejected']);
        expect(w.player.proposedDiplomaticRelations.byEmpire(w.ai)).toBeNull();
        expect(validateStrategicResponse(brief, 'not json').error).toBeDefined();
    }, 300000);
});

describe('settings', () => {
    it('defaults off / 30 days / met / 4; stored values are clamped', () => {
        expect(DEFAULT_SETTINGS).toMatchObject({ aiAdvisor: false, aiAdvisorIntervalDays: 30, aiAdvisorEmpires: 'met', aiAdvisorMaxEmpires: 4 });
        const store = new Map<string, string>();
        setSettingsStorage({ getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) });
        try {
            store.set('dwu-ui-settings', JSON.stringify({ aiAdvisor: true, aiAdvisorIntervalDays: 0, aiAdvisorEmpires: 'some', aiAdvisorMaxEmpires: 99 }));
            expect(loadSettings()).toMatchObject({ aiAdvisor: true, aiAdvisorIntervalDays: 1, aiAdvisorEmpires: 'met', aiAdvisorMaxEmpires: 16 });
        } finally {
            setSettingsStorage(null);
        }
    });
});

describe('feature off / no model: the scheduler path is untouched', () => {
    const offSettings = (on: boolean, endpoint: string): AiAdvisorSettings => ({
        aiAdvisor: on,
        aiAdvisorIntervalDays: 1,
        aiAdvisorEmpires: 'all',
        aiAdvisorMaxEmpires: 4,
        advisorEndpoint: endpoint,
        advisorModel: 'fake',
        advisorApi: 'auto',
        advisorThink: false,
    });

    it('off, and on without a model server: 120 game-s polled every 5 s give the pinned tick digest; nothing is asked or logged', async () => {
        for (const on of [false, true]) {
            const galaxy = cachedTickGame(gameData).galaxy;
            let fetches = 0;
            const deadFetch = (async () => {
                fetches++;
                throw new Error('connection refused');
            }) as unknown as typeof fetch;
            let clock = 0;
            const driver = new AiAdvisorDriver({ galaxy, player: galaxy.playerEmpire, settings: () => offSettings(on, 'http://127.0.0.1:9'), fetchImpl: deadFetch, now: () => (clock += 61000) });
            for (let t = 0; t < 120; t += 5) {
                runGameSeconds(galaxy, 5);
                driver.poll();
                await Promise.resolve();
                await new Promise((r) => setTimeout(r, 0));
            }
            driver.dispose();
            expect(stateDigest(galaxy)).toBe(pin('tickDeterminism.digest120'));
            expect(commandLog(galaxy)).toHaveLength(0);
            expect(driver.turns).toHaveLength(0);
            if (!on) expect(fetches).toBe(0);
            else expect(fetches).toBeGreaterThan(0); // it probed, found nothing, stayed off
        }
    }, 1800000);

    it('no scheduler / tick module imports the 18c modules', () => {
        // Walk the static import graph from the scheduler and the harness: the model path is reachable only from the UI.
        const root = resolve(__dirname, '..');
        const seen = new Set<string>();
        const stack = ['src/sim/tick/scheduler.ts', 'src/sim/tick/harness.ts', 'src/sim/game.ts'].map((p) => resolve(root, p));
        while (stack.length > 0) {
            const file = stack.pop()!;
            if (seen.has(file)) continue;
            seen.add(file);
            const src = readFileSync(file, 'utf8');
            for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s+['"](\.[^'"]+)['"]/g)) {
                let p = resolve(dirname(file), m[1]);
                if (!p.endsWith('.ts')) p = existsSync(`${p}.ts`) ? `${p}.ts` : resolve(p, 'index.ts');
                if (existsSync(p)) stack.push(p);
            }
        }
        const names = [...seen].map((f) => f.slice(root.length + 1));
        expect(names.length).toBeGreaterThan(50);
        for (const bad of ['src/sim/player/strategicBrief.ts', 'src/sim/player/strategicDecisions.ts', 'src/sim/player/commandLog.ts', 'src/ui/aiAdvisorDriver.ts']) {
            expect(names).not.toContain(bad);
        }
    });

    it('driver: waits one interval, then asks each selected empire once per interval', async () => {
        const w = world();
        const [a, b] = [w.ai, w.ai2];
        handler = ollamaAnswer({ rationale: 'Steady as she goes.', decisions: [{ id: 'none' }] });
        const seen: string[] = [];
        const driver = new AiAdvisorDriver({
            galaxy: w.galaxy,
            player: w.player,
            settings: () => ({ ...offSettings(true, url), aiAdvisorEmpires: 'met', aiAdvisorIntervalDays: 2, advisorApi: 'ollama' }),
            onTurn: (t) => seen.push(t.empireName),
        });
        expect(selectAdvisedEmpires(w.galaxy, w.player, 'met', 4)).toEqual([a, b].sort((x, y) => w.galaxy.empires.indexOf(x) - w.galaxy.empires.indexOf(y)));
        driver.poll(); // sets the due date, probes
        for (let i = 0; i < 20 && !(driver as unknown as { api: unknown }).api; i++) await new Promise((r) => setTimeout(r, 5));
        driver.poll();
        expect(driver.running).toBe(false); // not due yet
        runGameSeconds(w.galaxy, (2 * STAR_DATE_DAY_MS) / 1000 + 0.1);
        driver.poll();
        expect(driver.running).toBe(true);
        await driver.pending;
        expect(seen.sort()).toEqual([a.name, b.name].sort());
        expect(driver.turns.every((t) => t.error === undefined && t.results.length === 0)).toBe(true);
        expect(councilLogEntry(driver.turns[0]).lines).toEqual([{ kind: 'none', text: 'No change' }]);
        driver.poll();
        expect(driver.running).toBe(false); // next round one interval later
        driver.dispose();
        expect(aiAdvisorSettingsWithUrl(offSettings(false, url), new URLSearchParams('aiAdvisor=1&aiAdvisorDays=5')).aiAdvisorIntervalDays).toBe(5);
    }, 300000);
});
