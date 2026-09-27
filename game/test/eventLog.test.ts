// 19p event log (tasks/19-mod-layer-scenarios.md §19p): entries from a scenario message / news call and from the
// ported empire messages (incl. a NewsNet broadcast), the category / importance mapping, importance-weighted
// retention under the size cap, every query, the chronicle digest, the Galactic History filter data builder, a save
// round trip, and flags-off byte-identity (plus: the log on never changes the sim).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGameRun } from './helpers/gameCache';
import { createScenarioGame, scenarioGameData } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import { EmpireMessage, EmpireMessageType, sendEmpireMessage, sendMessageToEmpire } from '../src/sim/messages';
import { gameText } from '../src/sim/colonyTick';
import { CharacterRole, getEmpireCharacters } from '../src/sim/characters';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateDigest } from '../src/sim/tick/digest';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { DiplomaticRelationType } from '../src/sim/diplomacy';
import { scenarioMessage, scenarioNews, scenarioText } from '../src/sim/scenario/messages';
import {
    EMPIRE_MESSAGE_EVENT,
    appendEvent,
    empireActor,
    empireMessageEvent,
    eventLogEntries,
    eventLogState,
    eventsAt,
    eventsBetween,
    eventsByCategory,
    packageDefaults,
    peekEventLog,
    timeline,
    type EventLogEntry,
} from '../src/sim/scenario/eventLog/log';
import { chronicleExport, resolveEntryText, starDateYear } from '../src/sim/scenario/eventLog/chronicle';
import { eventLogHistoryRows, galacticHistoryUsesEventLog, historyCategoryOptions } from '../src/ui/screens/galacticHistory';

let base: GameData;
let ALL_OFF: Record<string, boolean>;
beforeAll(async () => {
    base = await loadGameDataFs();
    ALL_OFF = Object.fromEntries(scenarioGameData(base, SC).scenario!.manifest.flags.map((f) => [f.name, false]));
}, 120000);

const SC = 'event-log';

function logGame(params: Record<string, number> = {}): { game: Game; gameData: GameData } {
    return createScenarioGame(base, { scenario: SC, flags: { ...ALL_OFF, eventLog: true }, params });
}

function otherEmpire(g: Galaxy): Empire {
    return g.empires.find((e) => e !== null && e.active && e !== g.playerEmpire && e.capital !== null)!;
}

function last(g: Galaxy): EventLogEntry {
    const e = eventLogEntries(g);
    return e[e.length - 1];
}

describe('flags off = faithful game; the log on never changes the sim', () => {
    it('event-log with every flag off runs byte-identical and writes no state; with eventLog on the sim is unchanged', () => {
        expect(ALL_OFF).toHaveProperty('eventLog', false);
        const ref = cachedTickGameRun(base, { seconds: 900 });
        const off = createScenarioGame(base, { scenario: SC, flags: ALL_OFF }).game;
        runGameSeconds(off, 900);
        expect(stateDigest(off.galaxy)).toBe(stateDigest(ref.game.galaxy));
        expect(off.galaxy.rnd.drawCount).toBe(ref.game.galaxy.rnd.drawCount);
        expect('eventLog' in off.galaxy.scenario!.state).toBe(false);

        const on = logGame().game;
        runGameSeconds(on, 900);
        expect(stateDigest(on.galaxy)).toBe(stateDigest(ref.game.galaxy));
        expect(on.galaxy.rnd.drawCount).toBe(ref.game.galaxy.rnd.drawCount);
        // The ported messages of a plain 900 s run fed the log (every entry from the game's own path).
        const entries = eventLogEntries(on.galaxy);
        expect(entries.length).toBeGreaterThan(0);
        expect(entries.every((e) => e.source === 'game' && e.textFormat === 'game')).toBe(true);
        expect(entries.every((e) => e.data !== null && EMPIRE_MESSAGE_EVENT[e.data.msg as keyof typeof EMPIRE_MESSAGE_EVENT] != null)).toBe(true);
    }, 1200000);
});

describe('entries, mapping, retention, queries, digest, history rows', () => {
    let game: Game;
    let g: Galaxy;
    let player: Empire;
    let other: Empire;
    beforeAll(() => {
        game = logGame().game;
        g = game.galaxy;
        player = g.playerEmpire!;
        other = otherEmpire(g);
    }, 600000);

    it('a scenario message becomes one entry: tag + args (not resolved text), package default, importance, place, actors', () => {
        const capital = player.capital!;
        const before = eventLogEntries(g).length;
        const m = scenarioMessage(g, player, scenarioText('Emergent Coup Success Title'), scenarioText('Emergent Coup Success', 'Admiral', 'Vex', 'Republic'), {
            type: EmpireMessageType.GeneralBadEvent,
            subject: capital,
        });
        expect(eventLogEntries(g).length).toBe(before + 1); // the helper's own sendEmpireMessage is not logged twice
        const e = last(g);
        expect(e).toMatchObject({ textKey: 'Emergent Coup Success', args: ['Admiral', 'Vex', 'Republic'], textFormat: 'scenario', titleKey: 'Emergent Coup Success Title', source: 'emergent', category: 'politics', importance: 3 });
        expect(e.place).toMatchObject({ habitat: capital.habitatIndex, system: capital.systemIndex });
        expect(e.actors).toContainEqual(empireActor(g, player));
        expect(e.seenBy).toEqual([player.empireId]);
        expect(e.starDate).toBe(galaxyStarDate(g));
        expect(resolveEntryText(e)).toBe(m.description);

        scenarioMessage(g, player, 'T', scenarioText('Scenario RimTrade Treaty Refused', other.name), { sender: other });
        expect(last(g)).toMatchObject({ source: 'rimTrade', category: 'rim', importance: 1, args: [other.name] });
        expect(last(g).actors).toContainEqual(empireActor(g, other));
        // Explicit category / importance override the package default.
        scenarioMessage(g, player, 'T', scenarioText('Scenario RimTrade Treaty Refused', 'x'), { log: { category: 'council', importance: 0 } });
        expect(last(g)).toMatchObject({ category: 'council', importance: 0, source: 'rimTrade' });
    });

    it('a character subject is an actor (registry id) and eventsBetween finds it', () => {
        const c = getEmpireCharacters(player).find((x) => x.active && x.role !== CharacterRole.Leader)!;
        scenarioMessage(g, player, 'T', scenarioText('Emergent Loyalty Warning', 'Governor', c.name), { subject: c });
        const e = last(g);
        expect(e.actors.some((a) => a.kind === 'character' && eventLogState(g).characters[a.id] === c)).toBe(true);
        expect(eventsBetween(g, player, c)).toContain(e);
    });

    it('a scenario news broadcast is one entry seen by every recipient', () => {
        const before = eventLogEntries(g).length;
        const sent = scenarioNews(g, other, scenarioText('Cult Victory'), undefined, other.capital);
        expect(sent.length).toBeGreaterThan(1);
        expect(eventLogEntries(g).length).toBe(before + 1);
        const e = last(g);
        expect(e).toMatchObject({ source: 'cult', category: 'threat', importance: 3, textKey: 'Cult Victory' });
        expect(e.data).toMatchObject({ news: true });
        expect(e.seenBy.sort()).toEqual(sent.map((x) => x.empireId).sort());
    });

    it('ported empire messages: EmpireMessageType → category / importance, key + args kept encoded, skips', () => {
        const colony = other.capital!;
        sendMessageToEmpire(other, player, EmpireMessageType.ColonyLost, colony, gameText('Colony COLONY lost to EMPIRE', colony.name, other.name));
        const e = last(g);
        expect(e).toMatchObject({ source: 'game', category: 'war', importance: 2, textKey: 'Colony COLONY lost to EMPIRE', args: [colony.name, other.name], textFormat: 'game' });
        expect(e.data).toMatchObject({ msg: 'ColonyLost' });
        expect(e.place).toMatchObject({ habitat: colony.habitatIndex });
        expect(eventsBetween(g, player, other)).toContain(e);

        const n = eventLogEntries(g).length;
        sendMessageToEmpire(null, player, EmpireMessageType.ShipNeedsRepair, null, 'x');
        sendMessageToEmpire(null, player, EmpireMessageType.BattleUnderAttack, null, 'x');
        sendMessageToEmpire(null, player, EmpireMessageType.Informational, null, 'x');
        expect(eventLogEntries(g).length).toBe(n);

        sendMessageToEmpire(other, player, EmpireMessageType.EmpireDefeated, other, 'Empire defeated');
        expect(last(g)).toMatchObject({ category: 'war', importance: 3 });
        sendMessageToEmpire(other, player, EmpireMessageType.Revolution, null, 'Revolution');
        expect(last(g)).toMatchObject({ category: 'politics', importance: 3 });
        expect(empireMessageEvent(EmpireMessageType.DiplomaticRelationChange, DiplomaticRelationType.War)).toEqual(['war', 3]);
        expect(empireMessageEvent(EmpireMessageType.DiplomaticRelationChange, DiplomaticRelationType.FreeTradeAgreement)).toEqual(['diplomacy', 2]);
        expect(empireMessageEvent(EmpireMessageType.GalacticHistory)).toEqual(['story', 2]);
        expect(packageDefaults('Emergent Spy Caught')).toMatchObject({ source: 'espionage-consequences', category: 'diplomacy' });
        expect(packageDefaults('Emergent Fuel Crisis')).toMatchObject({ source: 'resource-crises', category: 'economy' });
        expect(packageDefaults('Hive Node')).toMatchObject({ source: 'hive', category: 'threat' });
        expect(packageDefaults('Unknown tag')).toMatchObject({ source: 'scenario', category: 'other' });
    });

    it('a ported NewsNet broadcast (SendNewsBroadcastCore shape) merges into one entry with the story key', () => {
        const recipients = g.empires.filter((e) => e !== null && e.active && e !== other);
        const before = eventLogEntries(g).length;
        for (const r of recipients) {
            const m = new EmpireMessage(other, EmpireMessageType.GalacticNewsNet, null);
            m.title = `GALACTIC NEWSNET: ${other.name}`;
            m.description = `${m.title} - ${gameText('Empire Leader Replaced', other.name, 'Zed')}`;
            sendEmpireMessage(m, r);
        }
        expect(eventLogEntries(g).length).toBe(before + 1);
        const e = last(g);
        expect(e).toMatchObject({ textKey: 'Empire Leader Replaced', args: [other.name, 'Zed'], category: 'politics', importance: 2 });
        expect(e.seenBy.sort()).toEqual(recipients.map((r) => r.empireId).sort());
        expect(e.actors).toEqual([empireActor(g, other)]); // the audience is not an actor
    });

    it('eventsAt / eventsByCategory / timeline', () => {
        const colony = other.capital!;
        expect(eventsAt(g, colony).length).toBeGreaterThan(0);
        expect(eventsAt(g, { system: colony.systemIndex }).length).toBeGreaterThanOrEqual(eventsAt(g, colony).length);
        expect(eventsAt(g, { x: Math.round(colony.xpos), y: Math.round(colony.ypos), radius: 1 }).length).toBeGreaterThan(0);
        expect(eventsAt(g, { habitat: -5 })).toEqual([]);
        const war = eventsByCategory(g, 'war');
        expect(war.length).toBeGreaterThan(0);
        expect(war.every((e) => e.category === 'war')).toBe(true);
        expect(eventsByCategory(g, 'war', 0, 3).every((e) => e.importance === 3)).toBe(true);
        expect(eventsByCategory(g, 'war', galaxyStarDate(g) + 1)).toEqual([]);
        const tl = timeline(g, other);
        expect(tl.length).toBeGreaterThan(0);
        expect(tl.every((e) => e.actors.some((a) => a.id === other.empireId && a.kind !== 'character'))).toBe(true);
        for (let i = 1; i < tl.length; i++) expect(tl[i].starDate).toBeGreaterThanOrEqual(tl[i - 1].starDate);
    });

    it('chronicleExport groups by year and category with resolved text', () => {
        const d = chronicleExport(g, 0);
        expect(d.json.count).toBe(eventLogEntries(g).length);
        expect(d.json.scenario).toBe(SC);
        const year = starDateYear(galaxyStarDate(g));
        const y = d.json.years.find((x) => x.year === year)!;
        expect(y.categories.map((c) => c.category)).toContain('war');
        const politics = y.categories.find((c) => c.category === 'politics')!;
        expect(politics.events.some((ev) => ev.text.includes('Vex') && ev.importance === 3)).toBe(true);
        expect(d.markdown).toContain(`## ${year}`);
        expect(d.markdown).toContain('Vex');
        expect(chronicleExport(g, 0, { minImportance: 3 }).json.years.flatMap((x) => x.categories.flatMap((c) => c.events)).every((ev) => ev.importance === 3)).toBe(true);
    });

    it('Galactic History (log mode) rows: player view, category filter, importance sort', () => {
        expect(galacticHistoryUsesEventLog(g)).toBe(true);
        expect(historyCategoryOptions()[0].value).toBe('all');
        expect(historyCategoryOptions().length).toBe(13);
        const all = eventLogHistoryRows(g, player, 'all', 'date');
        expect(all.length).toBeGreaterThan(0);
        for (let i = 1; i < all.length; i++) expect(all[i].starDate).toBeLessThanOrEqual(all[i - 1].starDate);
        expect(all.every((r) => r.entry.seenBy.includes(player.empireId) || r.entry.actors.some((a) => a.id === player.empireId && a.kind !== 'character'))).toBe(true);
        const war = eventLogHistoryRows(g, player, 'war', 'date');
        expect(war.length).toBeGreaterThan(0);
        expect(war.every((r) => r.category === 'war')).toBe(true);
        const byImp = eventLogHistoryRows(g, player, 'all', 'importance');
        for (let i = 1; i < byImp.length; i++) expect(byImp[i].importance).toBeLessThanOrEqual(byImp[i - 1].importance);
        const coup = all.find((r) => r.entry.textKey === 'Emergent Coup Success')!;
        expect(coup.text).toContain('Vex');
        expect(coup.location).not.toBeNull();
    });

    it('retention: the size cap keeps the most important entries, the oldest least important go first', () => {
        g.scenario!.params.eventLogSize = 50; // as the wizard's param would set it
        const st = eventLogState(g);
        expect(st.entries.length).toBeGreaterThan(10);
        const important = st.entries.filter((e) => e.importance === 3).map((e) => e.id);
        for (let i = 0; i < 120; i++) {
            appendEvent(g, { category: 'other', importance: (i % 3) as 0 | 1 | 2, actors: [], seenBy: [], place: null, textKey: `filler ${i}`, args: [], textFormat: 'scenario', data: null, source: 'test' });
        }
        expect(st.entries.length).toBe(50);
        for (const id of important) expect(st.entries.some((e) => e.id === id)).toBe(true);
        // The survivors: all importance-3 entries, then the newest of the higher levels; ids stay ascending.
        for (let i = 1; i < st.entries.length; i++) expect(st.entries[i].id).toBeGreaterThan(st.entries[i - 1].id);
        const zeros = st.entries.filter((e) => e.importance === 0 && e.source === 'test');
        const twos = st.entries.filter((e) => e.importance === 2 && e.source === 'test');
        expect(zeros.length).toBe(0);
        expect(twos.length).toBeGreaterThan(0);
        expect(twos[twos.length - 1].textKey).toBe('filler 119'); // 119 % 3 = 2: the newest filler is kept
    });
});

describe('save round trip', () => {
    function saveText(game: Game): string {
        const time = new GalaxyTime();
        time.togglePause();
        time.advance(game.galaxy.nowMs);
        return serializeGame(game as never, time, { ...defaultStartGameOptions(), seed: 1, scenario: { id: SC, flags: { ...ALL_OFF, eventLog: true }, params: {} } });
    }

    it('entries and the character registry survive save / load and later runs log the same', () => {
        const a = logGame();
        const g = a.game.galaxy;
        const p = g.playerEmpire!;
        const c = getEmpireCharacters(p).find((x) => x.active)!;
        scenarioMessage(g, p, 'T', scenarioText('Emergent Loyalty Warning', 'Governor', c.name), { subject: c });
        runGameSeconds(a.game, 120);
        const text = saveText(a.game);
        const loaded = deserializeGame(text, a.gameData);
        const lg = loaded.game.galaxy;
        expect(JSON.stringify(peekEventLog(lg)!.entries)).toBe(JSON.stringify(eventLogState(g).entries));
        expect(peekEventLog(lg)!.characters.map((x) => x.name)).toEqual(eventLogState(g).characters.map((x) => x.name));
        expect(peekEventLog(lg)!.nextId).toBe(eventLogState(g).nextId);
        runGameSeconds(a.game, 300);
        runGameSeconds(loaded.game, 300);
        expect(stateDigest(lg)).toBe(stateDigest(g));
        expect(JSON.stringify(eventLogEntries(lg))).toBe(JSON.stringify(eventLogEntries(g)));
        expect(saveText(loaded.game)).toBe(saveText(a.game));
    }, 1200000);
});
