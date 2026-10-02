// popupstubs: the stub list's pure logic (messageStubs.ts) and the conversation queue rebuilt on load.
import { describe, expect, it } from 'vitest';
import {
    addStub,
    advanceStubList,
    advisorIconUrl,
    clampVisibleStubs,
    createStubListState,
    isConversationExpired,
    markStubRead,
    messageIconUrl,
    messageStubTitle,
    orderStubs,
    POPUP_DURATION_MS,
    removeStub,
    SCROLL_PX_PER_SECOND,
    STUB_DWELL_MS,
    stepStubList,
    syncStubs,
    TICKER_ROW_PX,
    visibleStubs,
    CONVERSATION_LIFETIME,
    type NewStub,
    type StubKind,
} from '../src/ui/messageStubs';
import { messageStubsRect } from '../src/ui/messageStubList';
import { computeHudLayout } from '../src/ui/hudLayout';
import { rebuildConversationQueue } from '../src/ui/messagePopups';
import { EmpireMessage, EmpireMessageType } from '../src/sim/messages';
import { AdvisorMessageType } from '../src/sim/advisorQueue';
import { DiplomaticRelation, DiplomaticRelationList, DiplomaticRelationType } from '../src/sim/diplomacy';
import type { Empire } from '../src/sim/empire';
import type { Galaxy } from '../src/sim/galaxy';

function stub(kind: StubKind, starDate: number, type = EmpireMessageType.GeneralNeutralEvent): NewStub {
    return { key: new EmpireMessage(null, type, null), kind, icon: null, title: `t${starDate}`, tooltip: '', starDate, color: null, needsAnswer: kind !== 'message' };
}

describe('POPUP_DURATION_MS (Main.Part9.cs timer_1_Elapsed)', () => {
    it('is the card slide-in + 2000 + slide-out at 25 units per 100 ms', () => {
        expect(POPUP_DURATION_MS).toBe(10800);
    });
});

describe('ordering and the visible window', () => {
    it('orders newest first and shows at most 6', () => {
        const s = createStubListState();
        for (let i = 1; i <= 9; i++) addStub(s, stub('message', i * 100));
        const ordered = orderStubs(s.stubs);
        expect(ordered.map((x) => x.starDate)).toEqual([900, 800, 700, 600, 500, 400, 300, 200, 100]);
        const w = visibleStubs(s, 6);
        expect(w.rows.map((x) => x.starDate)).toEqual([900, 800, 700, 600, 500, 400]);
        expect(w.more).toBe(3);
        expect(w.scrolls).toBe(true);
        expect(w.next!.starDate).toBe(300);
        expect(visibleStubs(s, 20).rows).toHaveLength(6); // capped
        expect(clampVisibleStubs(0)).toBe(1);
        expect(clampVisibleStubs(3)).toBe(3);
    });

    it('fewer than the window: all shown, no scrolling, no counter', () => {
        const s = createStubListState();
        addStub(s, stub('message', 1));
        addStub(s, stub('conversation', 2));
        const w = visibleStubs(s, 6);
        expect(w.rows).toHaveLength(2);
        expect(w.more).toBe(0);
        expect(w.next).toBeNull();
    });

    it('ties on star date: the later arrival first; duplicates are ignored', () => {
        const s = createStubListState();
        const a = stub('message', 5);
        const b = stub('message', 5);
        expect(addStub(s, a)).toBe(true);
        expect(addStub(s, b)).toBe(true);
        expect(addStub(s, a)).toBe(false);
        expect(orderStubs(s.stubs)[0].key).toBe(b.key);
    });

    it('the wheel wraps round the list', () => {
        const s = createStubListState();
        for (let i = 0; i < 8; i++) addStub(s, stub('message', i));
        stepStubList(s, -1);
        expect(s.offset).toBe(7);
        expect(visibleStubs(s, 6).rows[0].starDate).toBe(0);
        stepStubList(s, 2);
        expect(s.offset).toBe(1);
    });
});

describe('advanceStubList', () => {
    it('holds a row for the dwell, then scrolls one row at the ticker speed, wrapping', () => {
        const s = createStubListState();
        for (let i = 0; i < 8; i++) addStub(s, stub('conversation', i));
        const rowMs = (TICKER_ROW_PX / SCROLL_PX_PER_SECOND) * 1000;
        advanceStubList(s, STUB_DWELL_MS, { visible: 6, hovered: false, paused: false });
        expect(s.offset).toBe(0);
        advanceStubList(s, rowMs / 2, { visible: 6, hovered: false, paused: false });
        expect(s.progress).toBeCloseTo(0.5);
        advanceStubList(s, rowMs / 2, { visible: 6, hovered: false, paused: false });
        expect(s.offset).toBe(1);
        expect(s.progress).toBe(0);
        for (let i = 0; i < 7; i++) advanceStubList(s, STUB_DWELL_MS + rowMs, { visible: 6, hovered: false, paused: false });
        expect(s.offset).toBe(0);
    });

    it('does not move or age while hovered or paused', () => {
        const s = createStubListState();
        for (let i = 0; i < 8; i++) addStub(s, stub('message', i));
        advanceStubList(s, 60000, { visible: 6, hovered: true, paused: false });
        advanceStubList(s, 60000, { visible: 6, hovered: false, paused: true });
        expect(s.offset).toBe(0);
        expect(s.stubs).toHaveLength(8);
        expect(s.stubs.every((x) => x.shownMs === 0)).toBe(true);
    });

    it('a plain message expires after the popup duration on screen; answers wait', () => {
        const s = createStubListState();
        addStub(s, stub('message', 1));
        addStub(s, stub('conversation', 2));
        addStub(s, stub('suggestion', 3));
        expect(advanceStubList(s, POPUP_DURATION_MS - 1, { visible: 6, hovered: false, paused: false })).toHaveLength(0);
        const gone = advanceStubList(s, 1, { visible: 6, hovered: false, paused: false });
        expect(gone.map((x) => x.kind)).toEqual(['message']);
        expect(s.stubs.map((x) => x.kind).sort()).toEqual(['conversation', 'suggestion']);
    });

    it('messages outside the window do not age', () => {
        const s = createStubListState();
        const old = stub('message', 0);
        addStub(s, old);
        for (let i = 1; i <= 3; i++) addStub(s, stub('conversation', i));
        advanceStubList(s, 2000, { visible: 3, hovered: false, paused: false });
        expect(s.stubs.find((x) => x.key === old.key)!.shownMs).toBe(0);
    });
});

describe('syncStubs / read / remove', () => {
    it('follows a queue: new entries get stubs, answered ones go', () => {
        const s = createStubListState();
        const a = new EmpireMessage(null, EmpireMessageType.OfferTrade, null);
        const b = new EmpireMessage(null, EmpireMessageType.OfferTrade, null);
        const make = (m: EmpireMessage): NewStub => ({ key: m, kind: 'conversation', icon: null, title: '', tooltip: '', starDate: 0, color: null, needsAnswer: true });
        addStub(s, stub('message', 1));
        syncStubs(s, 'conversation', [a, b], make);
        expect(s.stubs).toHaveLength(3);
        syncStubs(s, 'conversation', [b], make);
        expect(s.stubs.map((x) => x.key)).toContain(b);
        expect(s.stubs.map((x) => x.key)).not.toContain(a);
        expect(s.stubs).toHaveLength(2);
        markStubRead(s, b);
        expect(s.stubs.find((x) => x.key === b)!.read).toBe(true);
        expect(removeStub(s, b)).toBe(true);
        expect(s.stubs).toHaveLength(1);
    });

    it('conversation expiry is DiplomaticMessageQueue.cs method_3 (250 x 600)', () => {
        expect(CONVERSATION_LIFETIME).toBe(150000);
        expect(isConversationExpired(1000, 1000 + 150000)).toBe(false);
        expect(isConversationExpired(999, 1000 + 150000)).toBe(true);
    });
});

describe('titles and icons', () => {
    it('stub title: title, else sender: description on one line', () => {
        expect(messageStubTitle('New Colony', 'x', 'Zorg')).toBe('New Colony');
        expect(messageStubTitle('', 'We\ndemand\n  tribute', 'Zorg')).toBe('Zorg: We demand tribute');
        expect(messageStubTitle('', '', null)).toBe('Message');
    });

    it('message icons follow MessagePopup.cs _MessageImages', () => {
        const war = new EmpireMessage(null, EmpireMessageType.DiplomaticRelationChange, DiplomaticRelationType.War);
        expect(messageIconUrl(war, null)).toBe('/assets/dwu/images/ui/messages/declarewar.png');
        expect(messageIconUrl(new EmpireMessage(null, EmpireMessageType.BattleUnderAttack, null), null)).toMatch(/underAttack\.png$/);
        expect(messageIconUrl(new EmpireMessage(null, EmpireMessageType.ColonyGained, null), null)).toMatch(/colonygain\.png$/);
        expect(messageIconUrl(new EmpireMessage(null, EmpireMessageType.GalacticNewsNet, null), null)).toMatch(/galacticnewsnet\.png$/);
        expect(messageIconUrl(new EmpireMessage(null, EmpireMessageType.NewColony, null), null)).toMatch(/information\.png$/);
    });

    it('advisor icons follow DiplomaticMessageQueue.cs', () => {
        expect(advisorIconUrl(AdvisorMessageType.BuildOrder)).toBe('/assets/dwu/images/ui/chrome/build.png');
        expect(advisorIconUrl(AdvisorMessageType.Colonization)).toMatch(/colonize\.png$/);
        expect(advisorIconUrl(AdvisorMessageType.TreatyOffer)).toMatch(/advisorsuggestion\.png$/);
    });
});

describe('messageStubsRect', () => {
    it('sits directly under the top-right money block, right-aligned with a 10 px margin', () => {
        const r = messageStubsRect(1920, 1080);
        const money = computeHudLayout(1920, 1080)['pnlMoney'];
        expect(r).toEqual({ right: 10, top: Math.round(money.y + money.h + 4), w: 230, origin: '100% 0' });
    });
});

describe('rebuildConversationQueue (load)', () => {
    const galaxy = { aggressionLevel: 1, independentEmpire: null } as unknown as Galaxy;
    function fake(id: number, name: string): Empire {
        const proposed = new DiplomaticRelationList();
        proposed.invertEmpireIndexing = true;
        return {
            empireId: id, name, active: true, galaxy, mainColor: 0x112233, pirateEmpireBaseHabitat: null,
            diplomaticRelations: new DiplomaticRelationList(), proposedDiplomaticRelations: proposed, messages: [],
        } as unknown as Empire;
    }
    it('keeps queued conversations within the lifetime, drops immediate / expired / plain ones', () => {
        const P = fake(2, 'Player');
        const B = fake(1, 'Zorg');
        P.diplomaticRelations.add(new DiplomaticRelation(DiplomaticRelationType.None, B, P, B, false));
        const now = 1_000_000;
        const ruins = new EmpireMessage(B, EmpireMessageType.SellInfoRuins, null);
        ruins.starDate = now - 1000;
        const oldRuins = new EmpireMessage(B, EmpireMessageType.SellInfoRuins, null);
        oldRuins.starDate = now - CONVERSATION_LIFETIME - 1;
        const war = new EmpireMessage(B, EmpireMessageType.DiplomaticRelationChange, DiplomaticRelationType.War);
        war.starDate = now - 10;
        const plain = new EmpireMessage(B, EmpireMessageType.ColonyGained, null);
        plain.starDate = now - 10;
        const q = rebuildConversationQueue([plain, war, oldRuins, ruins], P, now);
        expect(q.map((e) => e.message)).toEqual([ruins]);
        expect(q[0].conversation).toBe('INFO_OFFER_RUINS');
    });
});
