// Sim worker, chunk 8 (docs/sim-worker.md §9): the local-model paths with the game in the worker (SimHost + replica
// client, in-process, messages structured-cloned as postMessage would) against the same paths in-thread, with
// scripted model replies (no network):
// - the advisor chat turn (advisorCommands) and the diplomat voice's counter (diplomatCounter) — runPlayerCommand
//   in-thread — become commands with an async result: the same command log, the same state digest;
// - the 18c AI advisor's applyStrategicDecisions becomes a host op run in the worker between two ticks, journaling its
//   'ai-advisor' entries there: the same log and digest;
// - the 19s-1 chronicle's storeChronicleYear becomes a host op; the job does not write a year twice while the replica
//   catches up;
// - the 19s-2 voice cues reach the main thread as worker events and the voiced message is upgraded in the worker;
// - the brief builders run on the replica and do not write it.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import { createScenarioGame, scenarioGameData } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { FRAME_REAL_MS } from '../src/sim/tick/scheduler';
import { stateDigest } from '../src/sim/tick/digest';
import { runGameSeconds } from '../src/sim/tick/harness';
import { commandLog } from '../src/sim/player/commandLog';
import { galaxyToJSON } from '../src/sim/save/galaxySave';
import { YEAR_LENGTH } from '../src/sim/galaxyTime';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { DiplomaticRelationType, DiplomaticStrategy, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { empireMessages } from '../src/sim/messages';
import { CharacterRole, getEmpireCharacters } from '../src/sim/characters';
import { appendEvent, empireActor, peekEventLog } from '../src/sim/scenario/eventLog/log';
import { chronicleInput, chronicleYears, dueChronicleYear } from '../src/sim/scenario/llm/chronicle';
import { digestFor } from '../src/sim/scenario/llm/digest';
import { legalMoves } from '../src/sim/scenario/llm/strategic';
import { buildOrderMenu } from '../src/sim/scenario/llm/orderMenu';
import { retrieveArchive } from '../src/sim/scenario/llm/archive';
import { registerHiddenThing, setLeadLevel } from '../src/sim/scenario/security/registry';
import { onLeadChanged } from '../src/sim/scenario/security/security';
import { buildAdvisorBrief, type AdvisorBrief } from '../src/sim/player/advisorBrief';
import { buildDiplomatBrief, type DiplomatContext } from '../src/sim/player/diplomatBrief';
import { groundDiplomatBrief } from '../src/sim/player/diplomatGrounding';
import { buildStrategicBrief, type StrategicBrief } from '../src/sim/player/strategicBrief';
import { SimHost } from '../src/simworker/simHost';
import { SimClientCore } from '../src/simworker/clientCore';
import { remoteSimHost } from '../src/simworker/remoteHost';
import { readReplica } from '../src/llm/replicaReads';
import type { ToWorker } from '../src/simworker/protocol';
import type { StartGameOptions } from '../src/sim/startGameOptions';
import { runAdvisorTurn, type ChatMessage } from '../src/ui/advisorClient';
import { voiceDiplomatReply, voicedMessageText } from '../src/ui/diplomatVoice';
import { runStrategicTurn } from '../src/ui/aiAdvisorDriver';
import { ChronicleJob } from '../src/llm/chronicleJob';
import { VoiceJob, layerVoiceOf, voicedDescription } from '../src/llm/voiceJob';
import { DEFAULT_LLM_POLICY, LlmQueue, galaxyLlmClock, type LlmRequest, type LlmTransport } from '../src/llm/queue';
import { starDateYear } from '../src/sim/scenario/eventLog/chronicle';
import { galaxyStarDate } from '../src/sim/tick/simTime';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const START_OPTIONS = {} as StartGameOptions;

function fakeClock(): () => number {
    let t = 0;
    return () => (t += 0.001);
}

interface Wired {
    host: SimHost;
    client: SimClientCore;
    rg: Galaxy;
    rp: Empire;
    time: GalaxyTime;
    tick: () => void;
    /** Full compare: the replica exactly current. */
    settle: () => void;
    dispose: () => void;
}

/** Host + client in-process (as test/simWorker.test.ts), with host ops forwarded too. Paused unless `running`. */
function connect(game: Game, gameData: GameData, running = false): Wired {
    const time = new GalaxyTime();
    time.paused = !running;
    const host = new SimHost(game, time, START_OPTIONS, { now: fakeClock() });
    const snap = structuredClone(host.snapshot());
    const toHost = (m: ToWorker): void => {
        const c = structuredClone(m);
        if (c.type === 'command') host.command(c);
        else if (c.type === 'hostOp') host.hostOp(c);
        else if (c.type === 'clock') host.clock(c);
    };
    const client = new SimClientCore(gameData, snap, { post: toHost, now: fakeClock() });
    const uiTime = new GalaxyTime();
    uiTime.bindGalaxy(client.galaxy);
    uiTime.speed = time.speed;
    uiTime.paused = time.paused;
    const tick = (): void => {
        client.syncClock(uiTime);
        const m = host.tick(FRAME_REAL_MS);
        if (m !== null) client.receive(structuredClone(m));
        client.frame(uiTime);
    };
    return {
        host,
        client,
        rg: client.galaxy,
        rp: client.game.playerEmpire,
        time: uiTime,
        tick,
        settle: () => client.replica.apply(structuredClone(host.sync.delta(true)), true),
        dispose: () => {
            client.dispose();
            host.dispose();
        },
    };
}

/** Await `p` while the worker keeps ticking (the reply travels in a step message). */
async function drive<T>(w: Wired, p: Promise<T>, maxTicks = 400): Promise<T> {
    let done = false;
    let value: T | undefined;
    let error: unknown;
    let failed = false;
    p.then(
        (v) => {
            done = true;
            value = v;
        },
        (e: unknown) => {
            done = true;
            failed = true;
            error = e;
        },
    );
    for (let i = 0; i < maxTicks && !done; i++) {
        await new Promise((r) => setTimeout(r, 0));
        if (!done) w.tick();
    }
    if (!done) throw new Error('drive: the promise did not settle');
    if (failed) throw error;
    return value as T;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** An Ollama-protocol fake: `answer(systemPrompt)` gives the model's JSON. Records the system prompts. */
function fakeOllama(answer: (system: string) => unknown): FetchLike & { systems: string[] } {
    const systems: string[] = [];
    const f = (async (url: string, init?: RequestInit) => {
        if (url.endsWith('/api/version')) return new Response(JSON.stringify({ version: 'fake' }));
        const body = JSON.parse(String(init?.body)) as { messages: ChatMessage[] };
        const sys = body.messages[0].content;
        systems.push(sys);
        return new Response(JSON.stringify({ message: { role: 'assistant', content: JSON.stringify(answer(sys)) } }));
    }) as FetchLike & { systems: string[] };
    f.systems = systems;
    return f;
}

function transport(answer: (r: LlmRequest) => string): LlmTransport & { reqs: LlmRequest[] } {
    const reqs: LlmRequest[] = [];
    return {
        reqs,
        model: () => 'fake-14b',
        probe: async () => true,
        complete: async (r) => {
            reqs.push(r);
            return { text: answer(r) };
        },
    };
}

function queueFor(g: Galaxy, t: LlmTransport): LlmQueue {
    return new LlmQueue({ transport: t, clock: galaxyLlmClock(g), policy: () => ({ ...DEFAULT_LLM_POLICY }) });
}

function setRelation(a: Empire, b: Empire, type: DiplomaticRelationType, initiator: Empire = a): void {
    for (const [x, y] of [[a, b], [b, a]] as const) {
        const r = obtainDiplomaticRelation(x, y);
        r.type = type;
        r.initiator = initiator;
        r.locked = false;
    }
}

const replicaText = (g: Galaxy): string => JSON.stringify(galaxyToJSON(g));

describe('sim worker: advisor chat and diplomat voice (synchronous commands → async results)', () => {
    const CFG = { endpoint: 'http://fake', model: 'm', api: 'ollama' as const };

    /** The model orders the player's explorer to the nearest unexplored system (the brief the replica built). */
    const exploreAnswer = (sys: string): unknown => {
        const brief = JSON.parse(sys.slice(sys.indexOf('BRIEF:\n') + 7).split('\n\nEARLIER')[0]) as AdvisorBrief;
        const ship = brief.ships.find((s) => s.type === 'ExplorationShip')!;
        const c = brief.commands.find((x) => x.who === ship.ref && x.note === 'nearest unexplored system') ?? brief.commands.find((x) => x.who === ship.ref)!;
        return { reply: 'On her way, Sovereign.', commands: [{ id: c.id }] };
    };

    it('advisor turn on the replica: the command runs in the worker; log and digest are the in-thread ones', async () => {
        // In-thread reference (runPlayerCommand).
        const ref = cachedTickGame(base);
        const refFetch = fakeOllama(exploreAnswer);
        const refTurn = await runAdvisorTurn({ galaxy: ref.galaxy, player: ref.playerEmpire, selection: null, history: [], text: 'explore', cfg: CFG, fetchImpl: refFetch });
        expect(refTurn.results).toHaveLength(1);
        expect(refTurn.results[0]).toMatchObject({ ok: true, status: 'done' });

        // Worker: the same game; the turn runs on the replica.
        const game = cachedTickGame(base);
        const w = connect(game, base);
        expect(remoteSimHost(w.rg)).not.toBeNull();
        expect(remoteSimHost(game.galaxy)).toBeNull();
        const wFetch = fakeOllama(exploreAnswer);
        const turn = await drive(w, runAdvisorTurn({ galaxy: w.rg, player: w.rp, selection: null, history: [], text: 'explore', cfg: CFG, fetchImpl: wFetch }));
        expect(turn.error).toBeUndefined();
        expect(turn.results).toEqual(refTurn.results);
        expect(turn.history).toEqual(refTurn.history);
        // The brief the replica built is the one the in-thread game builds.
        expect(wFetch.systems).toEqual(refFetch.systems);
        // Journaled in the worker as in-thread: same entries, same boundary.
        expect(JSON.stringify(commandLog(game.galaxy))).toBe(JSON.stringify(commandLog(ref.galaxy)));
        expect(commandLog(w.rg)).toHaveLength(0); // the replica has no log
        expect(w.host.digest()).toBe(stateDigest(ref.galaxy));
        // And the game goes on identically.
        runGameSeconds(ref.galaxy, 2);
        w.time.paused = false;
        while (game.galaxy.nowMs < ref.galaxy.nowMs) w.tick();
        expect(w.host.digest()).toBe(stateDigest(ref.galaxy));
        w.dispose();
        expect(remoteSimHost(w.rg)).toBeNull();
    }, 600000);

    it('a command the worker cannot apply rejects the turn (error, nothing executed)', async () => {
        const game = cachedTickGame(base);
        const w = connect(game, base);
        const remote = remoteSimHost(w.rg)!;
        // An empire the worker does not know.
        const ghost = Object.create(Object.getPrototypeOf(w.rp)) as Empire;
        await expect(drive(w, remote.command(ghost, 'advisorCommands', [buildAdvisorBrief(w.rg, w.rp, null), []]))).rejects.toThrow(/not in the replica/);
        await expect(drive(w, remote.hostOp('nope' as never, [] as never))).rejects.toThrow(/unknown host op/);
        expect(commandLog(game.galaxy)).toHaveLength(0);
        w.dispose();
    }, 600000);

    function voiceWorld(g: Galaxy): { player: Empire; ai: Empire } {
        const player = g.playerEmpire!;
        const ai = g.empires.find((e) => e !== player && e.pirateEmpireBaseHabitat === null && e !== g.independentEmpire && e.active)!;
        ai.reclusive = false;
        player.reclusive = false;
        setRelation(player, ai, DiplomaticRelationType.War);
        obtainDiplomaticRelation(ai, player).strategy = DiplomaticStrategy.Defend; // an end-war counter stands
        return { player, ai };
    }

    const context: Extract<DiplomatContext, { kind: 'proposal' }> = {
        kind: 'proposal',
        optionId: 'WAR_END_SUBJUGATIONDEMAND',
        label: 'Propose Free Trade Agreement',
        accepted: false,
        reply: 'MUTUALDEFENSE_REJECT',
        original: 'We will never submit!',
    };
    const counterAnswer = (): unknown => ({ reply: 'We tire of this bloodshed.', counterId: 'end-war' });

    it('diplomat voice on the replica: the counter goes through the worker; the message is the replica one', async () => {
        const ref = cachedTickGame(base);
        const r = voiceWorld(ref.galaxy);
        const refV = await voiceDiplomatReply({ galaxy: ref.galaxy, ai: r.ai, player: r.player, context, cfg: CFG, fetchImpl: fakeOllama(counterAnswer) });
        expect(refV.counter?.status).toBe('proposed');

        const game = cachedTickGame(base);
        voiceWorld(game.galaxy);
        const w = connect(game, base);
        const ai = w.rg.empires.find((e) => e !== null && e.name === r.ai.name)!;
        const v = await drive(w, voiceDiplomatReply({ galaxy: w.rg, ai, player: w.rp, context, cfg: CFG, fetchImpl: fakeOllama(counterAnswer) }));
        expect(v.error).toBeUndefined();
        expect(v.text).toBe(refV.text);
        expect(v.counter).toMatchObject({ id: refV.counter!.id, status: 'proposed', proposes: refV.counter!.proposes });
        // The counter's message came back as the replica's object: the one in the replica player's inbox.
        const msg = v.counter!.message!;
        expect(empireMessages(w.rp)).toContain(msg);
        expect(msg.sender).toBe(ai);
        expect(voicedMessageText(msg)).toBe(v.text);
        expect(JSON.stringify(commandLog(game.galaxy))).toBe(JSON.stringify(commandLog(ref.galaxy)));
        expect(w.host.digest()).toBe(stateDigest(ref.galaxy));
        w.dispose();
    }, 600000);
});

describe('sim worker: 18c AI advisor (applyStrategicDecisions → host op)', () => {
    const CFG = { endpoint: 'http://fake', model: 'm', api: 'ollama' as const };

    function world(): Game {
        const game = cachedTickGame(base);
        runGameSeconds(game.galaxy, 60);
        const g = game.galaxy;
        const player = g.playerEmpire!;
        const ais = g.empires.filter((e) => e !== player && e.pirateEmpireBaseHabitat === null && e !== g.independentEmpire && e.active);
        for (const [a, b] of [[player, ais[0]], [player, ais[1]], [ais[0], ais[1]]] as const) setRelation(a, b, DiplomaticRelationType.None);
        for (const e of [player, ais[0], ais[1]]) e.reclusive = false;
        obtainDiplomaticRelation(ais[0], player).strategy = DiplomaticStrategy.Befriend;
        obtainDiplomaticRelation(ais[0], player).lastDiplomacyTradeOfferDate = 0;
        return game;
    }

    /** Two decisions: a policy change and the AI's treaty offer, from the brief the request carried. */
    const answer = (sys: string): unknown => {
        const decisions = JSON.parse(sys.slice(sys.indexOf('DECISIONS:\n') + 11)) as StrategicBrief['decisions'];
        const policy = decisions.find((d) => d.id.startsWith('policy:') && Array.isArray(d.to) && d.to.length > 1)!;
        const to = (policy.to as string[]).find((x) => x !== policy.now)!;
        const offer = decisions.find((d) => d.id.startsWith('offer-free-trade:'));
        return { rationale: 'We choose friendship and prudence.', decisions: [{ id: policy.id, targetId: to }, ...(offer !== undefined ? [{ id: offer.id }] : [])] };
    };

    it('the decisions are applied and journaled in the worker: same log, results and digest as in-thread', async () => {
        const ref = world();
        const refAi = ref.galaxy.empires.filter((e) => e !== ref.playerEmpire && e.pirateEmpireBaseHabitat === null && e !== ref.galaxy.independentEmpire && e.active)[0];
        const refBrief = buildStrategicBrief(ref.galaxy, refAi);
        const refFetch = fakeOllama(answer);
        const refTurn = await runStrategicTurn({ galaxy: ref.galaxy, ai: refAi, cfg: CFG, fetchImpl: refFetch });
        expect(refTurn.error).toBeUndefined();
        expect(refTurn.results.length).toBeGreaterThan(0);
        expect(refTurn.results.some((r) => r.status === 'applied')).toBe(true);

        const game = world();
        const w = connect(game, base);
        const ai = w.rg.empires.find((e) => e !== null && e.empireId === refAi.empireId)!;
        // The brief built on the replica is the in-thread one (the in-thread build ages the bases' variable income — a
        // write on read, Empire.cs ThisYearsSpacePortIncome — so it is compared with the build before the ref turn).
        const before = replicaText(w.rg);
        expect(readReplica(w.rg, () => buildStrategicBrief(w.rg, ai))).toEqual(refBrief);
        expect(replicaText(w.rg) === before).toBe(true);
        const wFetch = fakeOllama(answer);
        const turn = await drive(w, runStrategicTurn({ galaxy: w.rg, ai, cfg: CFG, fetchImpl: wFetch }));
        expect(turn.error).toBeUndefined();
        expect(turn.empire).toBe(ai);
        expect(turn.results).toEqual(refTurn.results);
        expect(turn.rationale).toBe(refTurn.rationale);
        expect(wFetch.systems).toEqual(refFetch.systems);
        const log = commandLog(game.galaxy);
        expect(log.every((e) => e.source === 'ai-advisor')).toBe(true);
        expect(JSON.stringify(log)).toBe(JSON.stringify(commandLog(ref.galaxy)));
        expect(w.host.digest()).toBe(stateDigest(ref.galaxy));
        // The replica shows what the worker did once synced.
        w.settle();
        expect(stateDigest(w.rg)).toBe(w.host.digest());
        // Same continuation.
        runGameSeconds(ref.galaxy, 2);
        w.time.paused = false;
        while (game.galaxy.nowMs < ref.galaxy.nowMs) w.tick();
        expect(w.host.digest()).toBe(stateDigest(ref.galaxy));
        w.dispose();
    }, 900000);
});

describe('sim worker: 19s-1 chronicle and 19s-2 voices', () => {
    const GOOD = JSON.stringify({ title: 'The Scattering at Vega', text: 'In this year our fleets met the enemy at Vega and scattered them. A trade pact was signed with our neighbours, and the court rejoiced.' });

    function chronicleGame(): { game: Game; gameData: GameData } {
        const sc = 'llm-layer';
        const ALL_OFF = Object.fromEntries(scenarioGameData(base, sc).scenario!.manifest.flags.map((f) => [f.name, false]));
        const r = createScenarioGame(base, { scenario: sc, flags: { ...ALL_OFF, eventLog: true, llmFoundations: true } });
        const g = r.game.galaxy;
        const p = g.playerEmpire!;
        const other = g.empires.find((e) => e !== null && e !== p && e.active && e.capital !== null)!;
        appendEvent(g, { category: 'war', importance: 3, actors: [empireActor(g, p), empireActor(g, other)], seenBy: [p.empireId], place: null, textKey: 'The fleet of the enemy was scattered at Vega', args: [], textFormat: 'scenario', data: null, source: 'test' });
        g.nowMs += YEAR_LENGTH; // past the year end (the job reads only the date and the log)
        return r;
    }

    it('the year is stored by a host op in the worker; no second write while the replica catches up', async () => {
        const ref = chronicleGame();
        const rp = ref.game.playerEmpire;
        const refT = transport(() => GOOD);
        const refJob = new ChronicleJob({ galaxy: ref.game.galaxy, empire: rp, queue: queueFor(ref.game.galaxy, refT), model: () => refT.model() });
        refJob.poll();
        await refJob.pending;
        expect(chronicleYears(ref.game.galaxy, rp)).toHaveLength(1);

        const sim = chronicleGame();
        const w = connect(sim.game, sim.gameData);
        const year = starDateYear(galaxyStarDate(w.rg)) - 1;
        expect(dueChronicleYear(w.rg, w.rp)).toBe(year);
        const t = transport(() => GOOD);
        const stored: number[] = [];
        const job = new ChronicleJob({ galaxy: w.rg, empire: w.rp, queue: queueFor(w.rg, t), model: () => t.model(), onStored: (e) => stored.push(e.year) });
        job.poll();
        await drive(w, job.pending!);
        expect(stored).toEqual([year]);
        expect(t.reqs.map((r) => r.messages)).toEqual(refT.reqs.map((r) => r.messages)); // the prompt built on the replica
        // Stored in the worker's event-log state, exactly as in-thread.
        expect(JSON.stringify(peekEventLog(sim.game.galaxy)!.chronicle)).toBe(JSON.stringify(peekEventLog(ref.game.galaxy)!.chronicle));
        expect(w.host.digest()).toBe(stateDigest(ref.game.galaxy));
        // The replica may not show it yet: the job waits instead of writing the year again.
        job.poll();
        expect(job.pending).toBeNull();
        w.settle();
        expect(chronicleYears(w.rg, w.rp)).toEqual(chronicleYears(ref.game.galaxy, rp));
        expect(dueChronicleYear(w.rg, w.rp)).toBeNull();
        job.poll();
        expect(job.pending).toBeNull();
        expect(t.reqs).toHaveLength(1);
        w.dispose();
    }, 600000);

    function voicesGame(): { game: Game; gameData: GameData } {
        const sc = 'ai-parity';
        const ALL_OFF = Object.fromEntries(scenarioGameData(base, sc).scenario!.manifest.flags.map((f) => [f.name, false]));
        return createScenarioGame(base, { scenario: sc, flags: { ...ALL_OFF, eventLog: true, llmFoundations: true, llmVoices: true, internalSecurity: true } });
    }

    /** A confirmed 19m lead on one of the player's characters (its emit site leaves a spymaster cue). */
    function confirmLead(g: Galaxy): string {
        const p = g.playerEmpire!;
        const c = getEmpireCharacters(p).find((x) => x.active && x.role !== CharacterRole.Leader)!;
        const thing = registerHiddenThing(g, { kind: 'plot', concealment: 40, empire: p, target: c, package: 'test' })!;
        const lead = setLeadLevel(g, thing, p, 'confirmed', 'investigation')!;
        onLeadChanged(g, lead, thing);
        return empireMessages(p).at(-1)!.description;
    }

    const SAY = 'We have watched them for months; the net is closing and the realm must act before they strike again.';

    it('voice cues arrive as worker events; the message is upgraded in the worker', async () => {
        // In-thread reference.
        const ref = voicesGame();
        const refG = ref.game.galaxy;
        const scripted = confirmLead(refG);
        const refT = transport(() => JSON.stringify({ text: SAY }));
        const refJob = new VoiceJob({ galaxy: refG, player: ref.game.playerEmpire, queue: queueFor(refG, refT) });
        refJob.poll();
        for (let i = 0; i < 5; i++) await Promise.resolve();
        await refJob.settle();
        const refMsg = empireMessages(ref.game.playerEmpire).at(-1)!;
        expect(layerVoiceOf(refMsg)).toBeDefined();

        // Worker: the lead is confirmed in the worker's game (a sim event between ticks); the next tick drains the cue.
        const sim = voicesGame();
        const w = connect(sim.game, sim.gameData);
        const t = transport(() => JSON.stringify({ text: SAY }));
        const job = new VoiceJob({ galaxy: w.rg, player: w.rp, queue: queueFor(w.rg, t) });
        expect(confirmLead(sim.game.galaxy)).toBe(scripted);
        w.tick();
        w.settle(); // an exact replica, so the prompt can be compared with the in-thread one
        job.poll();
        await drive(w, (async () => {
            for (let i = 0; i < 5; i++) await Promise.resolve();
            await job.settle();
        })());
        expect(job.outcomes).toEqual(refJob.outcomes);
        expect(t.reqs.map((r) => r.messages)).toEqual(refT.reqs.map((r) => r.messages));
        // Upgraded in the worker (where the message lives), the replica gets the text by the sync.
        const workerMsg = empireMessages(sim.game.playerEmpire).at(-1)!;
        expect(workerMsg.description).toBe(voicedDescription(scripted, refMsg.description.split('\n\n')[1].split(':')[0], SAY));
        expect(workerMsg.description).toBe(refMsg.description);
        const msg = empireMessages(w.rp).at(-1)!;
        expect(layerVoiceOf(msg)).toEqual(layerVoiceOf(refMsg));
        w.settle();
        expect(msg.description).toBe(refMsg.description);
        expect(w.host.digest()).toBe(stateDigest(refG));
        // Nothing left: a second poll sends nothing.
        job.poll();
        await job.settle();
        expect(t.reqs).toHaveLength(1);
        job.dispose();
        w.dispose();
    }, 600000);
});

describe('sim worker: the brief builders on the replica', () => {
    it('read the replica without writing it (saved state, digest, RNG draws), behind readReplica', () => {
        const game = cachedTickGame(base);
        const w = connect(game, base);
        const g = w.rg;
        const p = w.rp;
        const ai = g.empires.find((e) => e !== p && e.pirateEmpireBaseHabitat === null && e !== g.independentEmpire && e.active)!;
        const before = replicaText(g);
        const digest = stateDigest(g);
        const draws = g.rnd.drawCount;
        const explorer = p.builtObjects.find((b) => b.subRole === BuiltObjectSubRole.ExplorationShip)!;
        const builders: (() => unknown)[] = [
            () => buildAdvisorBrief(g, p, null),
            () => buildAdvisorBrief(g, p, explorer),
            () => groundDiplomatBrief(g, buildDiplomatBrief(g, ai, p, { kind: 'incoming', messageType: 'ProposeDiplomaticRelation', heading: 'Treaty on Offer', original: 'x' }), ai, p),
            // Without the guard this one ages the bases' variable income (treasury.ts thisYearsSpacePortIncome).
            () => buildStrategicBrief(g, ai),
            () => digestFor(g, p),
            () => digestFor(g, ai, p),
            () => legalMoves(g, ai),
            () => buildOrderMenu(g, p, explorer),
            () => retrieveArchive(g, p, 'war'),
            () => chronicleInput(g, p, starDateYear(galaxyStarDate(g)), 10),
        ];
        // The same result as on the authoritative game.
        const auth = game.galaxy;
        const authAi = auth.empires.find((e) => e.empireId === ai.empireId)!;
        expect(JSON.stringify(readReplica(g, () => buildStrategicBrief(g, ai)))).toBe(JSON.stringify(buildStrategicBrief(auth, authAi)));
        for (const b of builders) readReplica(g, b);
        expect(g.rnd.drawCount).toBe(draws);
        expect(stateDigest(g)).toBe(digest);
        expect(replicaText(g) === before).toBe(true);
        w.dispose();
    }, 600000);
});
