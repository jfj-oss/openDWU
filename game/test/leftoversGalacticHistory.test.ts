// Galactic History screen pure logic (ui/screens/galacticHistory.ts): Main.Part4.cs:2986 method_542 order + filters,
// the Main.Part9.cs ReceiveMessageInternal default titles, EmpireMessageListView icons, column sort, method_530 Go To
// location; and the event → history message mapping of Main.Part4.cs:487 method_523 (ui/eventMessages.ts).
import { describe, expect, it } from 'vitest';
import { EmpireMessage, EmpireMessageType } from '../src/sim/messages';
import { EventMessageType } from '../src/sim/eventTypes';
import { DiplomaticRelationType } from '../src/sim/diplomacy';
import {
    HistoryFilter,
    defaultMessageTitle,
    filterHistoryMessages,
    historyHeaderTitle,
    historyMapPoint,
    messageIcon,
    messageLocation,
    messageTitle,
    nextHistorySort,
    sortHistoryRows,
    type GalacticHistoryRow,
} from '../src/ui/screens/galacticHistory';
import { eventHistoryMessageType } from '../src/ui/eventMessages';

function msg(type: EmpireMessageType, starDate: number, subject: unknown = null, title = ''): EmpireMessage {
    const m = new EmpireMessage(null, type, subject);
    m.starDate = starDate;
    m.title = title;
    return m;
}

describe('filterHistoryMessages (method_542)', () => {
    const a = msg(EmpireMessageType.GalacticHistory, 100);
    const b = msg(EmpireMessageType.BattleUnderAttack, 300);
    const c = msg(EmpireMessageType.NewColony, 200);
    const d = msg(EmpireMessageType.GalacticHistory, 400);
    const e = msg(EmpireMessageType.IncomingEnemyFleet, 50);
    const history = [a, b, c, d, e];

    it('All: every message, newest first', () => {
        expect(filterHistoryMessages(history, HistoryFilter.All)).toEqual([d, b, c, a, e]);
    });
    it('Non-Battle drops BattleAttacking / BattleUnderAttack / IncomingEnemyFleet', () => {
        expect(filterHistoryMessages(history, HistoryFilter.NonBattle)).toEqual([d, c, a]);
    });
    it('Galactic History keeps only GalacticHistory messages', () => {
        expect(filterHistoryMessages(history, HistoryFilter.GalacticHistory)).toEqual([d, a]);
    });
    it('does not reorder the empire list', () => {
        expect(history).toEqual([a, b, c, d, e]);
    });
    it('header title follows the filter', () => {
        expect(historyHeaderTitle(HistoryFilter.GalacticHistory)).toBe('Galactic History');
        expect(historyHeaderTitle(HistoryFilter.All)).toBe('Messages');
    });
});

describe('titles (Main.Part9.cs:1061-1507)', () => {
    it('uses the message title when set, else the ReceiveMessageInternal default', () => {
        expect(messageTitle(msg(EmpireMessageType.GalacticHistory, 0, null, 'Ancient Secrets'), null)).toBe('Ancient Secrets');
        expect(messageTitle(msg(EmpireMessageType.GalacticHistory, 0), null)).toBe('Galactic History revealed');
    });
    it('treaty messages by DiplomaticRelationType subject', () => {
        expect(defaultMessageTitle(msg(EmpireMessageType.ProposeDiplomaticRelation, 0, DiplomaticRelationType.War), null)).toBe('War Declared!');
        expect(defaultMessageTitle(msg(EmpireMessageType.ProposeDiplomaticRelation, 0, DiplomaticRelationType.FreeTradeAgreement), null)).toBe('Free Trade Agreement Offered');
        expect(defaultMessageTitle(msg(EmpireMessageType.DiplomaticRelationChange, 0), null)).toBe('Diplomatic Relation Change');
    });
    it('GeneralNeutralEvent is untitled; ColonyDestroyed gets "!"', () => {
        expect(defaultMessageTitle(msg(EmpireMessageType.GeneralNeutralEvent, 0), null)).toBe('');
        expect(defaultMessageTitle(msg(EmpireMessageType.ColonyDestroyed, 0), null)).toBe('Colony Destroyed!');
    });
});

describe('icons (EmpireMessageListView.BindData)', () => {
    it('Galactic History and the history offers use galacticHistory.png', () => {
        for (const t of [EmpireMessageType.GalacticHistory, EmpireMessageType.HistoryOfferStoryClue, EmpireMessageType.StoryMessage]) {
            expect(messageIcon(msg(t, 0))).toEqual({ kind: 'image', url: '/assets/dwu/images/ui/messages/galacticHistory.png' });
        }
    });
    it('diplomacy messages end up with construction.png (the flag is overwritten)', () => {
        expect(messageIcon(msg(EmpireMessageType.AcceptDiplomaticRelation, 0))).toEqual({ kind: 'image', url: '/assets/dwu/images/ui/messages/construction.png' });
    });
    it('battle and exploration images', () => {
        expect(messageIcon(msg(EmpireMessageType.BattleAttacking, 0))).toEqual({ kind: 'image', url: '/assets/dwu/images/ui/messages/underAttack.png' });
        expect(messageIcon(msg(EmpireMessageType.ExplorationRuins, 0))).toEqual({ kind: 'image', url: '/assets/dwu/images/ui/messages/explorationDiscovery.png' });
    });
    it('a sender-flag message without a sender has no icon', () => {
        expect(messageIcon(msg(EmpireMessageType.GeneralGoodEvent, 0))).toBeNull();
    });
});

describe('column sort', () => {
    const row = (title: string, starDate: number): GalacticHistoryRow => ({ message: msg(EmpireMessageType.GalacticHistory, starDate), title, starDate, date: '', icon: null });
    const rows = [row('b', 3), row('a', 1), row('c', 2)];
    it('null keeps the method_542 order', () => {
        expect(sortHistoryRows(rows, null).map((r) => r.title)).toEqual(['b', 'a', 'c']);
    });
    it('Subject and Star Date, ascending then descending', () => {
        let s = nextHistorySort(null, 'title');
        expect(sortHistoryRows(rows, s).map((r) => r.title)).toEqual(['a', 'b', 'c']);
        s = nextHistorySort(s, 'title');
        expect(sortHistoryRows(rows, s).map((r) => r.title)).toEqual(['c', 'b', 'a']);
        s = nextHistorySort(s, 'starDate');
        expect(s).toEqual({ column: 'starDate', ascending: true });
        expect(sortHistoryRows(rows, s).map((r) => r.starDate)).toEqual([1, 2, 3]);
    });
});

describe('messageLocation (method_530)', () => {
    it('the Location point, else none (Go To disabled)', () => {
        const m = msg(EmpireMessageType.GalacticHistory, 0);
        expect(messageLocation(m)).toBeNull();
        m.location = { x: 120.7, y: -40 };
        expect(messageLocation(m)).toEqual({ x: 120.7, y: -40 });
    });
});

describe('eventHistoryMessageType (method_523)', () => {
    it('story clues and origins become GalacticHistory messages', () => {
        expect(eventHistoryMessageType(EventMessageType.StoryClue, null)).toBe(EmpireMessageType.GalacticHistory);
        expect(eventHistoryMessageType(EventMessageType.OriginsDiscovery, null)).toBe(EmpireMessageType.GalacticHistory);
    });
    it('wonder built is a GeneralGoodEvent; disasters GeneralBadEvent; NewEmpireEmerges records nothing', () => {
        expect(eventHistoryMessageType(EventMessageType.WonderBuilt, null)).toBe(EmpireMessageType.GeneralGoodEvent);
        expect(eventHistoryMessageType(EventMessageType.DisasterEvent, null)).toBe(EmpireMessageType.GeneralBadEvent);
        expect(eventHistoryMessageType(EventMessageType.NewEmpireEmerges, null)).toBeNull();
    });
    it('encounters record only with the matching subject; UncoverKnownLocation is a location', () => {
        expect(eventHistoryMessageType(EventMessageType.EncounterBuiltObject, null)).toBeNull();
        expect(eventHistoryMessageType(EventMessageType.UncoverKnownLocation, null)).toBe(EmpireMessageType.ExplorationLocation);
        expect(eventHistoryMessageType(EventMessageType.GeneralDiscovery, null)).toBe(EmpireMessageType.ExplorationRuins);
    });
});

describe('historyMapPoint (gmapMessageHistory: GalaxyMap.cs SetPosition + method_6 crosshair)', () => {
    it('maps a world point to trunc(x / (SizeX / width)) + 1', () => {
        expect(historyMapPoint(500000, 250, { x: 100000, y: 250000 })).toEqual({ x: 51, y: 126 });
        expect(historyMapPoint(500000, 250, { x: 1999, y: 1 })).toEqual({ x: 1, y: 1 });
    });
    it('draws no crosshair without a location or with a zero coordinate (double_0 > 0 && double_1 > 0)', () => {
        expect(historyMapPoint(500000, 250, null)).toBeNull();
        expect(historyMapPoint(500000, 250, { x: 0, y: 0 })).toBeNull();
        expect(historyMapPoint(500000, 250, { x: 1000, y: 0 })).toBeNull();
    });
});
