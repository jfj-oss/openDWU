// The player's message pipeline in the sim tick (sim/playerMessages.ts; docs/sim-worker.md §4.5, §8):
// - the C# arrival order (Main's BeginInvoke queue): messages, events and authorization prompts are handled one by one
//   at the end of the frame, an event's history message after what was queued before it; the defeat game end;
// - headless, seed + command log replays the message history and the advisor queue exactly — with messages flowing,
//   advisor suggestions approved and declined by their stable id, the message options changed, the history trimmed
//   and the advisor expiry of a diplomacy exchange, all journaled commands;
// - the stable id of a queued suggestion: encoded as 'advid2' (owner by empireId), found again after the queue changed; the old 'adv'
//   (queue index) references of earlier logs still decode;
// - a save made before this change (test/fixtures/before-sim-message-pipeline.dwusave.gz, written by the code of
//   origin before the change) loads: its queued suggestions get ids, its old log entry decodes, it runs on, and it
//   round-trips.
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import { tickGameOptions } from './helpers/tickGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { Empire } from '../src/sim/empire';
import type { Galaxy } from '../src/sim/galaxy';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { stateDigest } from '../src/sim/tick/digest';
import { runGameSeconds } from '../src/sim/tick/harness';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { flatEmpireList } from '../src/sim/save/galaxySave';
import { commandLog, type PlayerLogEntry } from '../src/sim/player/commandLog';
import { decodeCommandArg, encodeCommandArg } from '../src/sim/player/commandCodec';
import { flushPlayerCommands, issuePlayerCommand, replayCommandLog, runScheduledUntil } from '../src/sim/player/playerCommands';
import { EmpireMessage, EmpireMessageType, empireMessageHistory, playerInbox, sendEmpireMessage, sendMessageToEmpire } from '../src/sim/messages';
import { sendEventMessageToEmpire } from '../src/sim/events';
import { EventMessageType } from '../src/sim/eventTypes';
import { AdvisorMessageType, advisorSuggestions, findAdvisorSuggestion } from '../src/sim/advisorQueue';
import { processPlayerMessages, promptPlayerForAuthorization, setPlayerMessageListener, type PlayerMessageReceipt } from '../src/sim/playerMessages';
import { MessageCategory, copyMessageOptions, defaultMessageOptions, galaxyMessageOptions } from '../src/sim/messageRouting';
import { setGameEndHandler, type GameEndEventArgs } from '../src/sim/victory';
import type { StartGameOptions } from '../src/sim/startGameOptions';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

const START = {} as StartGameOptions;
const saveText = (g: Game): string => serializeGame(g, new GalaxyTime().bindGalaxy(g.galaxy), START);

function aiOf(g: Galaxy, player: Empire): Empire {
    return g.empires.find((e) => e !== player && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null)!;
}

/** The player's history as plain data (what the pipeline wrote: type, text, stamp, sender). */
function historyOf(g: Galaxy, p: Empire): unknown[] {
    const empires = flatEmpireList(g);
    return empireMessageHistory(p).map((m) => [m.messageType, m.description, m.starDate, m.sender === null ? -1 : empires.indexOf(m.sender)]);
}

/** The advisor queue as plain data (stable id, type, stamp, text). */
function queueOf(p: Empire): unknown[] {
    return advisorSuggestions(p).map((m) => [m.advisorSuggestionId, m.advisorMessageType, m.starDate, m.description]);
}

describe('the pipeline runs in the tick, in the arrival order of the C# UI queue', () => {
    it('messages, events and prompts are handled at the end of the frame, an event message after what came before it', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const p = game.playerEmpire;
        runGameSeconds(g, 1);
        const ai = aiOf(g, p);
        const receipts: PlayerMessageReceipt[] = [];
        setPlayerMessageListener(g, (n) => void (n.receipt !== undefined && receipts.push(n.receipt)));
        const h0 = empireMessageHistory(p).length;
        const h = g.habitats.find((x) => x.parent !== null)!;
        // Queued between frames (no command, no frame): nothing is handled yet.
        sendEventMessageToEmpire(p, EventMessageType.EncounterRuins, 'Ruins', 'Our explorers found ruins', h, h);
        sendMessageToEmpire(ai, p, EmpireMessageType.GeneralWarning, null, 'Keep out');
        const prompt = new EmpireMessage(p, EmpireMessageType.AdvisorSuggestion, ai);
        // DiplomaticGift: no newer advice supersedes it (ExpireInvalidMessages has no case for it).
        prompt.advisorMessageType = AdvisorMessageType.DiplomaticGift;
        prompt.description = 'Send them a gift';
        prompt.starDate = galaxyStarDate(g); // as Empire.8.cs 4415 dates it
        promptPlayerForAuthorization(p, prompt);
        expect(playerInbox(p)!.length).toBe(3);
        expect(empireMessageHistory(p).length).toBe(h0);
        expect(advisorSuggestions(p).includes(prompt)).toBe(false);
        // The next frame's end handles them, stamped with its star date.
        runGameSeconds(g, 0.016);
        const date = galaxyStarDate(g);
        expect(playerInbox(p)!.length).toBe(0);
        const added = empireMessageHistory(p).slice(h0);
        // The warning was queued before the event's history message (method_523 → SendMessageToEmpire → BeginInvoke).
        expect(added.map((m) => [m.messageType, m.description])).toEqual([
            [EmpireMessageType.GeneralWarning, 'Keep out'],
            [EmpireMessageType.ExplorationRuins, 'Our explorers found ruins'],
        ]);
        expect(added.every((m) => m.starDate === date)).toBe(true);
        expect(advisorSuggestions(p).includes(prompt)).toBe(true);
        expect(typeof prompt.advisorSuggestionId).toBe('number');
        expect(receipts.map((r) => [r.message.description, r.ticker, r.advisor])).toEqual([
            ['Keep out', true, false],
            ['Our explorers found ruins', true, false],
        ]);
        setPlayerMessageListener(g, null);
    }, 300000);

    it('the options decide what is recorded; an Informational line is not; the player defeat ends the game', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const p = game.playerEmpire;
        const ai = aiOf(g, p);
        expect(galaxyMessageOptions(g).ticker[MessageCategory.Exploration]).toBe(true);
        const off = defaultMessageOptions();
        off.ticker[MessageCategory.Exploration] = false;
        issuePlayerCommand(g, p, 'setMessageOptions', [off]);
        flushPlayerCommands(g);
        expect(galaxyMessageOptions(g).ticker[MessageCategory.Exploration]).toBe(false);
        const h0 = empireMessageHistory(p).length;
        const h = g.habitats.find((x) => x.parent !== null)!;
        sendEventMessageToEmpire(p, EventMessageType.EncounterRuins, 'Ruins', 'Not recorded', h, h);
        sendMessageToEmpire(p, p, EmpireMessageType.Informational, null, 'An informational line');
        const ends: GameEndEventArgs[] = [];
        setGameEndHandler(g, (e) => void ends.push(e));
        sendMessageToEmpire(ai, p, EmpireMessageType.EmpireDefeated, p, 'Your empire has fallen');
        processPlayerMessages(g);
        const added = empireMessageHistory(p).slice(h0).map((m) => m.description);
        expect(added).toEqual(['Your empire has fallen']);
        expect(ends.length).toBe(1);
        setGameEndHandler(g, null);
    }, 300000);
});

describe('headless: seed + command log replays the history and the advisor queue exactly', () => {
    it('messages flowing, suggestions approved / declined by id, options, the trim and the expiry: the replay is the game', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const p = game.playerEmpire;
        const ai = aiOf(g, p);
        runScheduledUntil(g, 60_000);
        // The seed-1 player is semi-automated: the AI's advice queued (prompts and the BuildOrder message).
        const q = advisorSuggestions(p);
        expect(q.length).toBeGreaterThanOrEqual(2);
        expect(empireMessageHistory(p).length).toBeGreaterThan(3);
        const approved = q[q.length - 1];
        const declined = q[0];
        const approvedId = approved.advisorSuggestionId!;
        issuePlayerCommand(g, p, 'approveSuggestion', [approved]);
        issuePlayerCommand(g, p, 'declineSuggestion', [declined]);
        const opts = copyMessageOptions(galaxyMessageOptions(g));
        opts.ticker[MessageCategory.ColonyInvaded] = false;
        opts.popup[MessageCategory.Exploration] = false;
        issuePlayerCommand(g, p, 'setMessageOptions', [opts]);
        issuePlayerCommand(g, p, 'removeOldHistoryMessages', []);
        issuePlayerCommand(g, p, 'expireAdvisorSuggestionsForEmpire', [ai]);
        runScheduledUntil(g, 120_000);
        expect(findAdvisorSuggestion(p, approvedId)).toBeNull();
        const log = commandLog(g) as PlayerLogEntry[];
        const approveEntry = log.find((e) => e.source === 'player' && e.op === 'approveSuggestion')!;
        expect(approveEntry.args).toEqual([{ r: 'advid2', k: [p.empireId, approvedId] }]);
        expect(log.filter((e) => e.source === 'player').map((e) => e.op)).toEqual(['approveSuggestion', 'declineSuggestion', 'setMessageOptions', 'removeOldHistoryMessages', 'expireAdvisorSuggestionsForEmpire']);
        expect(log.every((e) => e.source !== 'player' || e.error === undefined)).toBe(true);

        // Seed + log from a fresh createGame, headless.
        const { seed, ...options } = tickGameOptions(gameData);
        const replay = replayCommandLog(seed, options, log, g.nowMs);
        const rp = replay.galaxy.playerEmpire!;
        expect(replay.galaxy.nowMs).toBe(g.nowMs);
        expect(historyOf(replay.galaxy, rp)).toEqual(historyOf(g, p));
        expect(queueOf(rp)).toEqual(queueOf(p));
        expect(rp.nextAdvisorSuggestionId).toBe(p.nextAdvisorSuggestionId);
        expect(galaxyMessageOptions(replay.galaxy)).toEqual(galaxyMessageOptions(g));
        expect(stateDigest(replay.galaxy)).toBe(stateDigest(g));
        expect(saveText(replay) === saveText(game)).toBe(true);
    }, 600000);
});

describe('approveSuggestion names the suggestion by its stable id', () => {
    it("'advid' finds it after the queue changed ahead of it; old 'adv' index references still decode", () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const p = game.playerEmpire;
        const ai = aiOf(g, p);
        const mk = (d: string): EmpireMessage => {
            const m = new EmpireMessage(p, EmpireMessageType.AdvisorSuggestion, ai);
            m.advisorMessageType = AdvisorMessageType.DiplomaticGift;
            m.description = d;
            m.starDate = galaxyStarDate(g);
            return m;
        };
        const a = mk('a');
        const b = mk('b');
        promptPlayerForAuthorization(p, a);
        promptPlayerForAuthorization(p, b);
        processPlayerMessages(g);
        const pi = flatEmpireList(g).indexOf(p);
        const enc = encodeCommandArg(g, b);
        expect(enc).toEqual({ r: 'advid2', k: [p.empireId, b.advisorSuggestionId] });
        // The queue changes ahead of it (the first entry approved): the id still names b, the index would not.
        const qi = advisorSuggestions(p).indexOf(a);
        advisorSuggestions(p).splice(qi, 1);
        expect(decodeCommandArg(g, enc)).toBe(b);
        // A log from before the ids: by position.
        expect(decodeCommandArg(g, { r: 'adv', k: [pi, advisorSuggestions(p).indexOf(b)] })).toBe(b);
        // Not queued any more: by value (a replay then refuses it as the executor does).
        advisorSuggestions(p).splice(advisorSuggestions(p).indexOf(b), 1);
        expect((encodeCommandArg(g, b) as { c?: string }).c).toBe('EmpireMessage');
    }, 300000);
});

describe('a save made before the sim-side pipeline loads', () => {
    const fixture = (): string => gunzipSync(readFileSync(join(__dirname, 'fixtures', 'before-sim-message-pipeline.dwusave.gz'))).toString('utf8');

    it('its queue gets ids in order, its old log decodes, it runs on with messages flowing and round-trips', () => {
        const text = fixture();
        // Written before the change: no ids, no counter, no options, the recipients saved as null.
        expect(text.includes('advisorSuggestionId')).toBe(false);
        expect(text.includes('nextAdvisorSuggestionId')).toBe(false);
        expect(text.includes('messageOptions')).toBe(false);
        expect(text.includes('"messageRecipient"')).toBe(true);
        const { game, time } = deserializeGame(text, gameData);
        const g = game.galaxy;
        const p = game.playerEmpire;
        expect(advisorSuggestions(p).map((m) => [m.description, m.advisorSuggestionId])).toEqual([
            ['old treaty', 1],
            ['old build order', 2],
        ]);
        expect(p.nextAdvisorSuggestionId).toBe(3);
        expect(p.messageRecipient).toBeNull();
        expect(p.eventMessageRecipient).toBeNull();
        expect(galaxyMessageOptions(g)).toEqual(defaultMessageOptions());
        expect(empireMessageHistory(p).filter((m) => m.description.startsWith('old history')).length).toBe(3);
        // The log it carries (a declineSuggestion journaled by queue index) is kept and still decodes; the load numbered
        // the stable command ids (entityRefs.ts) and journaled that ('refids').
        const log = commandLog(g) as PlayerLogEntry[];
        expect(log.map((e) => e.source)).toEqual(['player', 'refids']);
        expect(log[0].op).toBe('declineSuggestion');
        expect(log[0].args).toEqual([{ r: 'adv', k: [0, 1] }]);
        expect((decodeCommandArg(g, log[0].args[0] as never) as EmpireMessage).description).toBe('old build order');
        // A loaded suggestion is named by its id.
        issuePlayerCommand(g, p, 'declineSuggestion', [advisorSuggestions(p)[0]]);
        flushPlayerCommands(g);
        expect((commandLog(g).at(-1) as PlayerLogEntry).args).toEqual([{ r: 'advid2', k: [p.empireId, 1] }]);
        expect(advisorSuggestions(p).map((x) => x.advisorSuggestionId)).toEqual([2]);
        // It runs on: the pipeline handles what arrives.
        const h0 = empireMessageHistory(p).length;
        const ai = aiOf(g, p);
        sendMessageToEmpire(ai, p, EmpireMessageType.GeneralWarning, null, 'After the load');
        const m = new EmpireMessage(p, EmpireMessageType.AdvisorSuggestion, null);
        m.advisorMessageType = AdvisorMessageType.BuildOrder;
        m.description = 'new build order';
        m.starDate = galaxyStarDate(g);
        sendEmpireMessage(m, p);
        runGameSeconds(g, 2);
        expect(empireMessageHistory(p).length).toBeGreaterThan(h0);
        expect(empireMessageHistory(p).some((x) => x.description === 'After the load' && x.starDate > 0)).toBe(true);
        // The new BuildOrder advice supersedes the loaded one (ExpireInvalidMessages; that one was dated star date 1002 and
        // would have aged out at the first frame anyway, method_3) and takes the next id.
        const ids = new Map(advisorSuggestions(p).map((x) => [x.description, x.advisorSuggestionId]));
        expect(ids.has('old build order')).toBe(false);
        expect(ids.get('new build order')).toBe(3);
        // Save → load → save: the same text; and the loaded copy goes on as the original does.
        const again = serializeGame(game, time, START);
        expect(again.includes('advisorSuggestionId')).toBe(true);
        expect(again.includes('"messageRecipient"')).toBe(false);
        const loaded = deserializeGame(again, gameData);
        expect(serializeGame(loaded.game, loaded.time, START) === again).toBe(true);
        runGameSeconds(g, 5);
        runGameSeconds(loaded.game.galaxy, 5);
        expect(serializeGame(loaded.game, loaded.time, START) === serializeGame(game, time, START)).toBe(true);
    }, 300000);
});
