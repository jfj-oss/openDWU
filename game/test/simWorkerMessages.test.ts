// Sim worker (docs/sim-worker.md §4.5, §8): the player's message pipeline runs in the sim tick (sim/playerMessages.ts)
// in every mode; the UI only reads what it handled.
// - Messages flowing (the seed-1 game's own, plus scripted sim events: diplomacy, a warning, an Informational line, a
//   message the sim empties from Empire.Messages within the same frame, a ruins event, an advisor suggestion, and the
//   player's defeat): a headless run (runSimFrame), the in-thread app loop and the worker host with its replica client
//   and the main-side bridge (ui/workerMessages.ts) end tick for tick in the same state — same digest, command log and
//   whole save text (star date stamps, message history, advisor queue, the game end) — and the main side sees every
//   handled message and event exactly once, in order, as the in-thread stream does.
// - The UI-triggered writes (Galactic History's trim, the advisor expiry of a diplomacy exchange, the message options)
//   are journaled commands in worker mode too; the replica is never written; the save text is the in-thread one;
//   the proposal rule agrees with the Diplomacy screen's.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { Empire } from '../src/sim/empire';
import type { Galaxy } from '../src/sim/galaxy';
import { GalaxyTime, startStarDateForAge } from '../src/sim/galaxyTime';
import { FRAME_REAL_MS } from '../src/sim/tick/scheduler';
import { stateDigest } from '../src/sim/tick/digest';
import { nextFrameMs, runSimFrame, schedulerState } from '../src/sim/tick/scheduler';
import { commandLog } from '../src/sim/player/commandLog';
import { createSimLoop } from '../src/simLoop';
import { serializeGame } from '../src/sim/save/gameSave';
import { galaxyToJSON } from '../src/sim/save/galaxySave';
import { Habitat } from '../src/sim/types';
import type { Camera } from '../src/render/camera';
import type { StartGameOptions } from '../src/sim/startGameOptions';
import { EmpireMessage, EmpireMessageType, empireMessageHistory, sendEmpireMessage, sendMessageToEmpire } from '../src/sim/messages';
import { sendEventMessageToEmpire } from '../src/sim/events';
import { EventMessageType } from '../src/sim/eventTypes';
import { AdvisorMessageType, advisorSuggestions } from '../src/sim/advisorQueue';
import { DiplomaticRelation, DiplomaticRelationList, DiplomaticRelationType, DiplomaticStrategy } from '../src/sim/diplomacy';
import { GameEndOutcome, doGameEnd, setGameEndHandler } from '../src/sim/victory';
import { reviewAchievements } from '../src/sim/achievements';
import { SimHost } from '../src/simworker/simHost';
import { SimClientCore } from '../src/simworker/clientCore';
import type { ToWorker, WorkerEvent } from '../src/simworker/protocol';
import { PlayerMessageStream, expirePlayerAdvisorSuggestionsFor, installLocalMessageStream, isProposalStillValid, trimMessageHistory, trimmedHistoryView, type PlayerMessageReceipt } from '../src/ui/messagePipeline';
import { setPlayerMessageListener, type PlayerMessageNote } from '../src/sim/playerMessages';
import { MessageCategory, defaultMessageOptions, galaxyMessageOptions } from '../src/sim/messageRouting';
import { issuePlayerCommand } from '../src/sim/player/playerCommands';
import { installWorkerMessageUi, type WorkerMessageUi } from '../src/ui/workerMessages';
import { installReplicaWriteDetector } from '../src/simworker/writeDetector';
import { createEmpireMessageFeed } from '../src/ui/empireMessageFeed';
import { installGameEndHandler } from '../src/ui/screens/empireComparison';
import { isProposalValid } from '../src/ui/screens/diplomacyScreen';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

const START_OPTIONS = {} as StartGameOptions;

function fakeClock(): () => number {
    let t = 0;
    return () => (t += 0.001);
}

interface Connected {
    host: SimHost;
    client: SimClientCore;
    ui: WorkerMessageUi;
    time: GalaxyTime;
    tick: () => void;
    events: WorkerEvent[];
}

/** Host (with the pipeline) + client + the main-side message UI, in-process (messages structured-cloned). */
function connect(game: Game, time: GalaxyTime, onEvent?: (e: WorkerEvent, resolve: (a: unknown) => unknown) => void): Connected {
    const host = new SimHost(game, time, START_OPTIONS, { now: fakeClock(), playerMessages: true });
    const snap = structuredClone(host.snapshot());
    const toHost = (m: ToWorker): void => {
        const c = structuredClone(m);
        if (c.type === 'command') host.command(c);
        else if (c.type === 'clock') host.clock(c);
    };
    const events: WorkerEvent[] = [];
    let ui: WorkerMessageUi | null = null;
    const client = new SimClientCore(gameData, snap, {
        post: toHost,
        now: fakeClock(),
        onEvent: (e, resolve) => {
            events.push(e);
            onEvent?.(e, resolve);
            ui?.onEvent(e, resolve);
        },
    });
    const uiTime = new GalaxyTime();
    uiTime.bindGalaxy(client.galaxy);
    uiTime.speed = time.speed;
    uiTime.paused = time.paused;
    ui = installWorkerMessageUi({ player: client.game.playerEmpire, galaxy: client.galaxy, time: uiTime, now: () => 0 });
    const tick = (): void => {
        client.syncClock(uiTime);
        const m = host.tick(FRAME_REAL_MS);
        if (m !== null) client.receive(structuredClone(m));
        client.frame(uiTime);
    };
    return { host, client, ui, time: uiTime, tick, events };
}

function aiOf(g: Galaxy, player: Empire): Empire {
    return g.empires.find((e) => e !== player && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null)!;
}

/** The scripted sim events, at fixed frames (the same frame boundary on both sides, before the frame runs). */
const DEFEAT_TICK = 1500;
function inject(g: Galaxy, player: Empire, tick: number): void {
    const ai = aiOf(g, player);
    switch (tick) {
        case 40:
            sendMessageToEmpire(ai, player, EmpireMessageType.ProposeDiplomaticRelation, DiplomaticRelationType.FreeTradeAgreement, 'We propose free trade');
            sendMessageToEmpire(ai, player, EmpireMessageType.GeneralWarning, null, 'Keep your ships out of our systems');
            sendMessageToEmpire(player, player, EmpireMessageType.Informational, null, 'An informational line');
            return;
        case 80: {
            // Sent and emptied again in the same frame (as Empire.ProcessMessages does): a poll would miss it, the
            // recipient does not.
            sendMessageToEmpire(ai, player, EmpireMessageType.GiveGift, ai, 'A gift for you');
            (player.messages as EmpireMessage[]).length = 0;
            return;
        }
        case 120: {
            const h = g.habitats.find((x) => x.parent !== null)!;
            sendEventMessageToEmpire(player, EventMessageType.EncounterRuins, 'Ancient ruins', 'Our explorers found ruins', h, h);
            return;
        }
        case 160: {
            const m = new EmpireMessage(player, EmpireMessageType.AdvisorSuggestion, player.capital);
            m.advisorMessageType = AdvisorMessageType.BuildOrder;
            m.description = 'Build more ships';
            m.starDate = startStarDateForAge(g.age) + g.nowMs; // as Empire.6.cs dates it (an undated one ages out at once)
            sendEmpireMessage(m, player);
            return;
        }
        case DEFEAT_TICK:
            sendMessageToEmpire(player, player, EmpireMessageType.EmpireDefeated, player, 'Your empire has fallen');
            return;
    }
}

const END_TICKS = 1800;

describe('sim worker: the player message pipeline', () => {
    it('with messages flowing, headless, in-thread and the worker end in the same state; the main side sees each message once', () => {
        // Headless: the frames alone (the pipeline is part of each frame), the same injections at the same boundaries.
        const head = cachedTickGame(gameData);
        const headNotes: PlayerMessageNote[] = [];
        setPlayerMessageListener(head.galaxy, (n) => void headNotes.push(n));
        // Galaxy.GameEnd's subscriber, as the app and the worker install it (empireComparison.ts / simHost.ts): end the
        // game, review the achievements, pause (here: no more frames).
        let headPaused = false;
        setGameEndHandler(head.galaxy, (e) => {
            doGameEnd(head.galaxy, e);
            reviewAchievements(head.galaxy);
            headPaused = true;
        });
        for (let t = 0; t < END_TICKS; t++) {
            inject(head.galaxy, head.playerEmpire, t);
            if (!headPaused) runSimFrame(head.galaxy, nextFrameMs(schedulerState(head.galaxy), 1));
        }
        setGameEndHandler(head.galaxy, null);

        // In-thread reference: the app loop, the in-thread stream (installLocalMessageStream) and game-end handler.
        const ref = cachedTickGame(gameData);
        const refTime = new GalaxyTime();
        refTime.paused = false;
        const loop = createSimLoop(ref.galaxy, refTime, {} as Camera, false);
        (loop.budget as { now: () => number }).now = fakeClock();
        const local = installLocalMessageStream(ref.galaxy, ref.playerEmpire, () => 0);
        installGameEndHandler(ref.galaxy, refTime);
        const refFeed = createEmpireMessageFeed();
        const refLines: string[] = [];
        for (let t = 0; t < END_TICKS; t++) {
            inject(ref.galaxy, ref.playerEmpire, t);
            loop.tick(FRAME_REAL_MS);
            if (t % 15 === 0) for (const l of refFeed.poll(ref.playerEmpire)) refLines.push(l);
        }
        for (const l of refFeed.poll(ref.playerEmpire)) refLines.push(l);
        const refReceipts: PlayerMessageReceipt[] = local.stream.receipts();
        local.dispose();

        // Worker: the same game, the host, the replica and the main-side message UI.
        const game = cachedTickGame(gameData);
        const time = new GalaxyTime();
        time.paused = false;
        const delivered: EmpireMessage[] = [];
        const deliveredEvents: unknown[][] = [];
        let gameEnd: Extract<WorkerEvent, { kind: 'gameEnd' }> | null = null;
        const workerOrder: EmpireMessage[] = [];
        const w = connect(game, time, (e, resolve) => {
            if (e.kind === 'playerMessages') {
                for (const r of e.receipts) delivered.push(resolve(r.m) as EmpireMessage);
                for (const ev of e.events) deliveredEvents.push([ev.type, ev.title, resolve(ev.data)]);
            } else if (e.kind === 'gameEnd') gameEnd = e;
        });
        // Chunk 0's detector: the main side must not write the replica (the stamps, history and queue are the worker's).
        const detector = installReplicaWriteDetector(w.client.replica, { warn: () => {} });
        // A main-side ticker consumer (main.ts refreshHud's feed).
        const feed = createEmpireMessageFeed();
        const tickerLines: string[] = [];
        for (let t = 0; t < END_TICKS; t++) {
            inject(game.galaxy, game.playerEmpire, t);
            w.tick();
            if (t % 15 === 0) for (const l of feed.poll(w.client.game.playerEmpire)) tickerLines.push(l);
        }
        for (const l of feed.poll(w.client.game.playerEmpire)) tickerLines.push(l);
        for (const r of w.ui.stream.receipts()) workerOrder.push(r.message);

        // The same frames, commands, state and save (history, star dates, advisor queue, the game end), in all three.
        expect(game.galaxy.nowMs).toBe(ref.galaxy.nowMs);
        expect(head.galaxy.nowMs).toBe(ref.galaxy.nowMs);
        expect(JSON.stringify(commandLog(game.galaxy))).toBe(JSON.stringify(commandLog(ref.galaxy)));
        expect(w.host.digest()).toBe(stateDigest(ref.galaxy));
        expect(stateDigest(head.galaxy)).toBe(stateDigest(ref.galaxy));
        const refSave = serializeGame(ref, refTime, START_OPTIONS);
        expect(w.host.save() === refSave).toBe(true);
        // (The headless save has its own clock controls: compare the galaxy.)
        expect(JSON.stringify(galaxyToJSON(head.galaxy)) === JSON.stringify(galaxyToJSON(ref.galaxy))).toBe(true);
        // Messages did flow and were recorded.
        const history = empireMessageHistory(game.playerEmpire);
        expect(history.length).toBeGreaterThan(3);
        expect(history.every((m) => m.starDate > 0)).toBe(true);
        expect(history.some((m) => m.description === 'A gift for you')).toBe(true); // caught although emptied
        expect(history.some((m) => m.messageType === EmpireMessageType.ExplorationRuins)).toBe(true); // the event, recorded
        expect(history.some((m) => m.messageType === EmpireMessageType.Informational)).toBe(false);
        expect(advisorSuggestions(game.playerEmpire).some((m) => m.description === 'Build more ships')).toBe(true);
        expect(game.galaxy.gameIsFinished).toBe(true);
        expect(w.host.time.paused).toBe(true);

        // The main side: every handled message delivered exactly once, in the in-thread order, as replica objects.
        expect(headNotes.filter((n) => n.receipt !== undefined).length).toBe(refReceipts.length);
        expect(new Set(delivered).size).toBe(delivered.length);
        expect(delivered.length).toBe(refReceipts.length);
        expect(workerOrder).toEqual(delivered);
        for (let i = 0; i < delivered.length; i++) {
            const r = refReceipts[i].message;
            expect(delivered[i] instanceof EmpireMessage, `delivered[${i}] is a message`).toBe(true);
            expect([delivered[i].messageType, delivered[i].description, delivered[i].title]).toEqual([r.messageType, r.description, r.title]);
            // Born on the main thread with the stamp already on it.
            expect(delivered[i].starDate).toBe(r.starDate);
        }
        // The ticker shows the in-thread lines, once each.
        expect(tickerLines).toEqual(refLines);
        expect(tickerLines.some((l) => l.includes('A gift for you'))).toBe(true);
        // The ruins event reached the main side once, its habitat a replica Habitat.
        expect(deliveredEvents.length).toBe(1);
        expect(deliveredEvents[0][0]).toBe(EventMessageType.EncounterRuins);
        expect(deliveredEvents[0][2] instanceof Habitat).toBe(true);
        expect(w.client.replica.decoder.idOf(deliveredEvents[0][2] as object)).toBeGreaterThanOrEqual(0);
        // The game end: banner args (defeat) and the worker's pause adopted by the HUD clock.
        expect(gameEnd !== null).toBe(true);
        expect(gameEnd!.args?.outcome).toBe(GameEndOutcome.Defeat);
        expect(w.time.paused).toBe(true);
        expect(w.events.filter((e) => e.kind === 'gameEnd').length).toBe(1);

        // Replica fidelity: after a full compare its save text is the authoritative game's.
        w.client.replica.apply(structuredClone(w.host.sync.delta(true)), true);
        expect(JSON.stringify(galaxyToJSON(w.client.galaxy)) === JSON.stringify(galaxyToJSON(game.galaxy))).toBe(true);
        expect(empireMessageHistory(w.client.game.playerEmpire).length).toBe(history.length);
        detector.checkAll();
        expect(detector.unexpected().map((x) => x.key)).toEqual([]);
        detector.dispose();
        setPlayerMessageListener(head.galaxy, null);
        w.ui.dispose();
        w.client.dispose();
        w.host.dispose();
    }, 600000);

    it('the UI-triggered writes are journaled commands in worker mode: the history trim, the advisor expiry, the options', () => {
        const game = cachedTickGame(gameData);
        const time = new GalaxyTime();
        const w = connect(game, time);
        const detector = installReplicaWriteDetector(w.client.replica, { warn: () => {} });
        w.tick();
        const wp = game.playerEmpire;
        const rp = w.client.game.playerEmpire;
        // 1005 history messages (one GalacticHistory among the oldest, which the trim keeps). Paused: no step adds more.
        const h = empireMessageHistory(wp);
        h.length = 0;
        for (let i = 0; i < 1005; i++) {
            const m = new EmpireMessage(null, i === 2 ? EmpireMessageType.GalacticHistory : EmpireMessageType.GeneralNeutralEvent, null);
            m.description = `h${i}`;
            m.starDate = 1000 + i;
            h.push(m);
        }
        w.client.replica.apply(structuredClone(w.host.sync.delta(true)), true);
        expect(empireMessageHistory(rp).length).toBe(1005);
        const view = trimmedHistoryView(rp).map((m) => m.description);
        expect(view.length).toBe(1001);
        trimMessageHistory(w.client.galaxy, rp); // a command, not a replica write
        expect(empireMessageHistory(rp).length).toBe(1005);
        w.tick();
        expect(h.length).toBe(1001);
        w.client.replica.apply(structuredClone(w.host.sync.delta(true)), true);
        expect(empireMessageHistory(rp).map((m) => m.description)).toEqual(view);

        // An advisor suggestion against an AI empire, expired by a diplomacy exchange with it.
        const ai = aiOf(game.galaxy, wp);
        const s = new EmpireMessage(wp, EmpireMessageType.AdvisorSuggestion, ai);
        s.advisorMessageType = AdvisorMessageType.TreatyOffer;
        advisorSuggestions(wp).push(s);
        w.client.replica.apply(structuredClone(w.host.sync.delta(true)), true);
        const rai = w.client.game.galaxy.empires[game.galaxy.empires.indexOf(ai)];
        expirePlayerAdvisorSuggestionsFor(w.client.galaxy, rp, rai);
        w.tick();
        expect(advisorSuggestions(wp).includes(s)).toBe(false);

        // The message options (the Game Options window): the game's, by command.
        const off = defaultMessageOptions();
        off.ticker[MessageCategory.Exploration] = false;
        issuePlayerCommand(w.client.galaxy, rp, 'setMessageOptions', [off]);
        w.tick();
        expect(galaxyMessageOptions(game.galaxy).ticker[MessageCategory.Exploration]).toBe(false);
        w.client.replica.apply(structuredClone(w.host.sync.delta(true)), true);
        expect(galaxyMessageOptions(w.client.galaxy).ticker[MessageCategory.Exploration]).toBe(false);

        // All three journaled, as in-thread.
        expect(commandLog(game.galaxy).map((e) => (e.source === 'player' ? e.op : e.source))).toEqual(['removeOldHistoryMessages', 'expireAdvisorSuggestionsForEmpire', 'setMessageOptions']);
        detector.checkAll();
        expect(detector.unexpected().map((x) => x.key)).toEqual([]);
        detector.dispose();
        w.ui.dispose();
        w.client.dispose();
        w.host.dispose();
    }, 600000);

    it('the save text is the same in both modes (the UI recipients are never saved)', () => {
        // In-thread: the UI's event recipient is a hidden field (eventMessages.ts); the worker's player has none.
        const a = cachedTickGame(gameData);
        Object.defineProperty(a.playerEmpire, 'eventMessageRecipient', { value: { receiveEventMessage() {} }, enumerable: false, writable: true, configurable: true });
        const b = cachedTickGame(gameData);
        b.playerEmpire.messageRecipient = { receiveMessage() {} };
        const t = (g: Game): string => serializeGame(g, new GalaxyTime().bindGalaxy(g.galaxy), START_OPTIONS);
        expect(t(b) === t(a)).toBe(true);
        expect(t(a).includes('"eventMessageRecipient"')).toBe(false);
    }, 600000);

    it("the worker's proposal rule agrees with the Diplomacy screen's", () => {
        const galaxy = { aggressionLevel: 1, independentEmpire: null } as unknown as Galaxy;
        const fake = (id: number): Empire =>
            ({ empireId: id, name: `E${id}`, active: true, galaxy, diplomaticRelations: new DiplomaticRelationList(), proposedDiplomaticRelations: new DiplomaticRelationList() }) as unknown as Empire;
        const p = fake(1);
        const o = fake(2);
        let cases = 0;
        for (const strategy of [DiplomaticStrategy.Undefined, DiplomaticStrategy.Befriend, DiplomaticStrategy.Ally, DiplomaticStrategy.Conquer]) {
            for (const type of [DiplomaticRelationType.NotMet, DiplomaticRelationType.None, DiplomaticRelationType.FreeTradeAgreement, DiplomaticRelationType.War]) {
                o.diplomaticRelations = new DiplomaticRelationList();
                const theirs = new DiplomaticRelation(type, o, o, p, false);
                theirs.strategy = strategy;
                o.diplomaticRelations.add(theirs);
                for (const offered of [DiplomaticRelationType.None, DiplomaticRelationType.FreeTradeAgreement, DiplomaticRelationType.MutualDefensePact]) {
                    for (const age of [0, 1e9]) {
                        const prop = new DiplomaticRelation(offered, o, o, p, false);
                        prop.lastDiplomacyTradeOfferDate = 1000;
                        expect(isProposalStillValid(prop, o, p, 1000 + age)).toBe(isProposalValid(prop, o, p, 1000 + age));
                        cases++;
                    }
                }
            }
        }
        expect(cases).toBe(96);
    });

    it('the stream keeps each receipt once and for a few seconds', () => {
        let now = 0;
        const s = new PlayerMessageStream(() => now);
        const m = new EmpireMessage(null, EmpireMessageType.GeneralWarning, null);
        const r = { message: m, ticker: true, advisor: false, route: null, action: 'none' as const };
        s.push(r);
        s.push({ ...r });
        expect(s.receipts().length).toBe(1);
        now = 9000;
        expect(s.receipts().length).toBe(1);
        now = 10_500;
        expect(s.receipts().length).toBe(0);
        expect(s.receiptOf(m)).toBe(r);
    });
});
