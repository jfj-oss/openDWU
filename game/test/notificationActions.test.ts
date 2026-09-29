// Notification interactions as in the original: every message that opens a conversation gets the option buttons of
// Main.Part9.cs:46 method_238 (ui/conversationActions.ts), their accepts run the ported Main.Part10.cs:3957 method_237
// replies through the command queue (applied at the frame boundary), a notification about a place has a Go to button,
// and a double right-click dismisses a message stub.

import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as HudModule from '../src/ui/hud';

const { selectStellarObjectMock, selectShipGroupMock } = vi.hoisted(() => ({ selectStellarObjectMock: vi.fn(), selectShipGroupMock: vi.fn() }));
vi.mock('../src/ui/hud', async (importOriginal) => {
    const actual = await importOriginal<typeof HudModule>();
    return { ...actual, selectStellarObject: selectStellarObjectMock, selectShipGroup: selectShipGroupMock };
});

import { conversationActions, type ConversationAction } from '../src/ui/conversationActions';
import { goToMessage, messageGoToTarget } from '../src/ui/messageGoto';
import { defaultMessageOptions, routeEmpireMessage } from '../src/ui/messageRouting';
import {
    DOUBLE_RIGHT_CLICK_MS,
    addStub,
    createStubListState,
    dismissStub,
    handleStubContextMenu,
    syncStubs,
    type NewStub,
    type RightClickTracker,
} from '../src/ui/messageStubs';
import { DiplomaticRelation, DiplomaticRelationList, DiplomaticRelationType, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { EmpireMessage, EmpireMessageType, empireMessages } from '../src/sim/messages';
import { TradeableItem, TradeableItemType } from '../src/sim/tradeItems';
import { SystemVisibilityStatus } from '../src/sim/visibility';
import { flushPlayerCommands, issuePlayerCommand, pendingPlayerCommands } from '../src/sim/player/playerCommands';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Empire } from '../src/sim/empire';
import type { Galaxy } from '../src/sim/galaxy';
import { Habitat } from '../src/sim/types';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

const galaxyStub = { aggressionLevel: 1, independentEmpire: null, determineHabitatSystemStar: (h: Habitat) => h } as unknown as Galaxy;
function fake(id: number, name: string): Empire {
    const proposed = new DiplomaticRelationList();
    proposed.invertEmpireIndexing = true;
    return {
        empireId: id, name, active: true, galaxy: galaxyStub, mainColor: 0x112233, pirateEmpireBaseHabitat: null,
        diplomaticRelations: new DiplomaticRelationList(), proposedDiplomaticRelations: proposed, messages: [],
    } as unknown as Empire;
}

/** Buttons (ids) of the conversation `message` opens for `player`, via the routing the popup uses. */
function buttons(message: EmpireMessage, player: Empire, opts: { answerable?: boolean; pirateOffer?: boolean } = {}): ConversationAction[] {
    const route = routeEmpireMessage(message, player, defaultMessageOptions());
    expect(route.conversation, EmpireMessageType[message.messageType]).not.toBeNull();
    return conversationActions(
        { message, conversation: route.conversation!, sender: message.sender },
        { player, galaxy: galaxyStub, answerable: opts.answerable ?? false, pirateOffer: opts.pirateOffer ?? false },
    );
}
const ids = (a: ConversationAction[]): string[] => a.map((x) => x.id);

describe('conversation buttons per message type (Main.Part9.cs:46 method_238)', () => {
    const player = fake(2, 'Player');
    const other = fake(1, 'Zorg');
    const third = fake(3, 'Krel');
    const DISCUSS_BYE = ['GREETING_NEUTRAL', 'Exit'];

    it('a treaty proposal: the treaty-specific accept and refuse (+ the peace subjugation demand)', () => {
        const at = (type: DiplomaticRelationType, current: DiplomaticRelationType | null) => {
            const p = fake(2, 'Player');
            p.proposedDiplomaticRelations.add(new DiplomaticRelation(type, other, other, p, false));
            if (current !== null) p.diplomaticRelations.add(new DiplomaticRelation(current, p, p, other, false));
            const m = new EmpireMessage(other, EmpireMessageType.ProposeDiplomaticRelation, type);
            return conversationActions({ message: m, conversation: 'OFFER_FREETRADE', sender: other }, { player: p, galaxy: galaxyStub, answerable: true, pirateOffer: false });
        };
        expect(ids(at(DiplomaticRelationType.FreeTradeAgreement, null))).toEqual(['FREETRADE_ACCEPT', 'FREETRADE_REJECT']);
        expect(ids(at(DiplomaticRelationType.MutualDefensePact, null))).toEqual(['MUTUALDEFENSE_ACCEPT', 'MUTUALDEFENSE_REJECT']);
        expect(ids(at(DiplomaticRelationType.Protectorate, null))).toEqual(['PROTECTORATE_ACCEPT', 'PROTECTORATE_REJECT']);
        expect(ids(at(DiplomaticRelationType.SubjugatedDominion, DiplomaticRelationType.War))).toEqual(['SUBJUGATIONDEMAND_ACCEPT', 'SUBJUGATIONDEMAND_REJECT']);
        const peace = at(DiplomaticRelationType.None, DiplomaticRelationType.War);
        expect(ids(peace)).toEqual(['WAR_END_ACCEPT', 'WAR_END_SUBJUGATIONDEMAND', 'WAR_END_REJECT']);
        expect(peace.map((a) => a.effect.kind)).toEqual(['acceptProposal', 'demandSubjugation', 'declineProposal']);
        expect(ids(at(DiplomaticRelationType.None, DiplomaticRelationType.SubjugatedDominion))).toEqual(['SUBJUGATION_RELEASE', 'SUBJUGATION_REFUSERELEASE']);
    });

    it('pirate protection / truce / extortion: Accept, Open Diplomacy, Decline', () => {
        const m = new EmpireMessage(other, EmpireMessageType.PirateOfferProtection, null);
        m.money = 5000;
        expect(buttons(m, player, { pirateOffer: true }).map((a) => a.effect.kind)).toEqual(['acceptPirate', 'openDiplomacy', 'close']);
    });

    it('SellInfo*: buy (with the cost) and No thanks', () => {
        for (const type of [
            EmpireMessageType.SellInfoUnmetEmpire,
            EmpireMessageType.SellInfoIndependentColony,
            EmpireMessageType.SellInfoSystemMap,
            EmpireMessageType.SellInfoRuins,
            EmpireMessageType.SellInfoDebrisField,
            EmpireMessageType.SellInfoRestrictedArea,
            EmpireMessageType.SellInfoPlanetDestroyer,
        ]) {
            const m = new EmpireMessage(other, type, null);
            m.money = 1234;
            const a = buttons(m, player);
            expect(a.map((x) => x.effect.kind), EmpireMessageType[type]).toEqual(['reply', 'close']);
            expect(a[1].id).toBe('Exit');
            const eff = a[0].effect;
            expect(eff.kind === 'reply' && eff.cost).toBe(1234);
        }
    });

    it('OfferTrade: list deals accept / reject; single map or tech offers accept / No thanks', () => {
        const some = new TradeableItem(TradeableItemType.Money, null, 100);
        const offer = new EmpireMessage(other, EmpireMessageType.OfferTrade, [[some], [some]]);
        expect(ids(buttons(offer, player))).toEqual(['DEAL_ACCEPT', 'DEAL_REJECT', 'DEAL_IMPROVE']);
        const demand = new EmpireMessage(other, EmpireMessageType.OfferTrade, [[], [some]]);
        expect(ids(buttons(demand, player))).toEqual(['DEAL_ACCEPTCOMPLAIN', 'DEAL_REJECTCOMPLAIN']);
        const threat = new EmpireMessage(other, EmpireMessageType.OfferTrade, [[some], [new TradeableItem(TradeableItemType.ThreatenWar, null, 0)]]);
        expect(ids(buttons(threat, player))).toEqual(['DEAL_ACCEPTCOMPLAIN', 'DEAL_REJECTCOMPLAIN']);
        for (const t of [TradeableItemType.TerritoryMap, TradeableItemType.GalaxyMap, TradeableItemType.ResearchProject]) {
            const single = new EmpireMessage(other, EmpireMessageType.OfferTrade, new TradeableItem(t, null, 50));
            expect(ids(buttons(single, player)), TradeableItemType[t]).toEqual(['DEAL_ACCEPT', 'Exit', ...DISCUSS_BYE]);
        }
    });

    it('requests to the player: honour / decline mutual defence; joint war, sanctions, stop war, lift sanctions', () => {
        const help = new EmpireMessage(other, EmpireMessageType.RequestHonorMutualDefense, third);
        expect(ids(buttons(help, player))).toEqual(['MUTUALDEFENSE_HONORREQUESTHELP', 'MUTUALDEFENSE_DECLINEREQUESTHELP']);
        const table: Array<[EmpireMessageType, string[]]> = [
            [EmpireMessageType.RequestJointWar, ['WAR_DECLARE_REQUESTJOINT_ACCEPT', 'WAR_DECLARE_REQUESTJOINT_REJECT']],
            [EmpireMessageType.RequestJointTradeSanctions, ['TRADESANCTIONS_REQUESTIMPOSEJOINT_ACCEPT', 'TRADESANCTIONS_REQUESTIMPOSEJOINT_REJECT']],
            [EmpireMessageType.RequestStopWar, ['WAR_END_REQUESTOTHER_ACCEPT', 'WAR_END_REQUESTOTHER_REJECT']],
            [EmpireMessageType.RequestLiftTradeSanctions, ['TRADESANCTIONS_REQUESTLIFTOTHER_ACCEPT', 'TRADESANCTIONS_REQUESTLIFTOTHER_REJECT']],
        ];
        for (const [type, expected] of table) {
            const m = new EmpireMessage(other, type, third);
            expect(ids(buttons(m, player)), EmpireMessageType[type]).toEqual(expected);
        }
    });

    it('history offers: Tell us more / We are not interested; a gift: Thanks!', () => {
        for (const type of [EmpireMessageType.HistoryOfferLocationHint, EmpireMessageType.HistoryOfferStoryClue, EmpireMessageType.StoryMessage]) {
            const a = buttons(new EmpireMessage(other, type, null), player);
            expect(a).toHaveLength(2);
            expect(a[0].label).toBe('Tell us more');
            expect(a[1].label).toBe('We are not interested');
        }
        const gift = new EmpireMessage(other, EmpireMessageType.GiveGift, null);
        gift.money = 1000;
        expect(ids(buttons(gift, player))).toEqual(['GIFT_THANKS', ...DISCUSS_BYE]);
    });

    it('everything else that opens a conversation (relation changes, warnings, cancelled pirate protection) gets discuss / goodbye, not a lone OK', () => {
        const cases: EmpireMessage[] = [
            new EmpireMessage(other, EmpireMessageType.DiplomaticRelationChange, DiplomaticRelationType.War),
            new EmpireMessage(other, EmpireMessageType.DiplomaticRelationChange, DiplomaticRelationType.FreeTradeAgreement),
            new EmpireMessage(other, EmpireMessageType.StopAttacks, null),
            new EmpireMessage(other, EmpireMessageType.StopMissionsAgainstUs, null),
            new EmpireMessage(other, EmpireMessageType.GeneralWarning, null),
            new EmpireMessage(other, EmpireMessageType.CancelPirateProtection, null),
        ];
        for (const m of cases) {
            expect(ids(buttons(m, player)), EmpireMessageType[m.messageType]).toEqual(DISCUSS_BYE);
        }
    });

    it('RemoveForcesFromSystem: a Go to <system> button (GOTO_TARGET) plus the default lines', () => {
        const habitat = Object.assign(Object.create(Habitat.prototype), { name: 'Sol', xpos: 10, ypos: 20 }) as Habitat;
        const m = new EmpireMessage(other, EmpireMessageType.RemoveForcesFromSystem, habitat);
        const a = buttons(m, player);
        expect(ids(a)).toEqual(['GOTO_TARGET', ...DISCUSS_BYE]);
        expect(a[0].effect.kind).toBe('goto');
    });
});

describe('Go to (Main.Part9.cs:742 method_242 / 912 method_249)', () => {
    const habitat = Object.assign(Object.create(Habitat.prototype), { name: 'Sol', xpos: 10, ypos: 20, systemIndex: 0 }) as Habitat;
    const sender = fake(1, 'Zorg');

    it('finds the subject a message is about and calls the camera path for it', () => {
        selectStellarObjectMock.mockClear();
        const m = new EmpireMessage(sender, EmpireMessageType.NewColony, habitat);
        expect(messageGoToTarget(m)).toEqual({ kind: 'stellar', object: habitat });
        expect(goToMessage(m, galaxyStub)).toBe(true);
        expect(selectStellarObjectMock).toHaveBeenCalledWith(habitat, true);
    });

    it('a treaty message or a sender-only message has nothing to go to; a location point falls back to the nearest system', () => {
        expect(messageGoToTarget(new EmpireMessage(sender, EmpireMessageType.DiplomaticRelationChange, DiplomaticRelationType.War))).toBeNull();
        expect(messageGoToTarget(new EmpireMessage(sender, EmpireMessageType.GeneralWarning, null))).toBeNull();
        const located = new EmpireMessage(sender, EmpireMessageType.GeneralNeutralEvent, null);
        located.location = { x: 500, y: 700 };
        expect(messageGoToTarget(located)).toEqual({ kind: 'point', x: 500, y: 700 });
        selectStellarObjectMock.mockClear();
        const galaxy = { fastFindNearestSystem: (x: number, y: number) => (x === 500 && y === 700 ? habitat : null) } as unknown as Galaxy;
        expect(goToMessage(located, galaxy)).toBe(true);
        expect(selectStellarObjectMock).toHaveBeenCalledWith(habitat, true);
    });

    it('a conversation about a place carries a Go to button that goes there', () => {
        const m = new EmpireMessage(sender, EmpireMessageType.GeneralWarning, habitat);
        const player = fake(2, 'Player');
        const a = buttons(m, player);
        expect(ids(a)).toEqual(['GOTO', 'GREETING_NEUTRAL', 'Exit']);
        expect(a[0].effect.kind).toBe('goto');
    });
});

describe('double right-click dismisses a message stub', () => {
    const sender = fake(1, 'Zorg');
    const msg = new EmpireMessage(sender, EmpireMessageType.NewColony, null);
    const other = new EmpireMessage(sender, EmpireMessageType.NewColony, null);
    const stub = (key: EmpireMessage): NewStub => ({ key, kind: 'message', icon: null, title: 't', tooltip: '', starDate: 1, color: null, needsAnswer: false });
    const ev = () => ({ preventDefault: vi.fn(), stopPropagation: vi.fn() });

    it('suppresses the context menu on every right-click and dismisses on the second within the window', () => {
        const tracker: RightClickTracker = { key: null, at: 0 };
        const state = createStubListState();
        addStub(state, stub(msg));
        const e1 = ev();
        expect(handleStubContextMenu(e1, tracker, msg, 1000)).toBe(false);
        expect(e1.preventDefault).toHaveBeenCalled();
        const e2 = ev();
        expect(handleStubContextMenu(e2, tracker, msg, 1000 + DOUBLE_RIGHT_CLICK_MS - 1)).toBe(true);
        expect(e2.preventDefault).toHaveBeenCalled();
        expect(dismissStub(state, msg)).toBe(true);
        expect(state.stubs).toHaveLength(0);
    });

    it('two slow right-clicks, or right-clicks on two different stubs, do not dismiss', () => {
        const tracker: RightClickTracker = { key: null, at: 0 };
        expect(handleStubContextMenu(ev(), tracker, msg, 0)).toBe(false);
        expect(handleStubContextMenu(ev(), tracker, msg, DOUBLE_RIGHT_CLICK_MS + 1)).toBe(false);
        expect(handleStubContextMenu(ev(), tracker, other, DOUBLE_RIGHT_CLICK_MS + 2)).toBe(false);
    });

    it('a dismissed stub is not re-added by the queue sync or a new push', () => {
        const state = createStubListState();
        syncStubs(state, 'conversation', [msg], (m) => ({ ...stub(m), kind: 'conversation', needsAnswer: true }));
        expect(state.stubs).toHaveLength(1);
        dismissStub(state, msg);
        syncStubs(state, 'conversation', [msg], (m) => ({ ...stub(m), kind: 'conversation', needsAnswer: true }));
        expect(state.stubs).toHaveLength(0);
        expect(addStub(state, stub(msg))).toBe(false);
    });
});

describe('answering an incoming conversation: commands apply at the frame boundary', () => {
    function setup() {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const player = game.playerEmpire;
        const others = g.empires.filter((e) => e !== player);
        return { g, player, a: others[0], b: others[1] };
    }
    const answer = (g: Galaxy, player: Empire, sender: Empire, part: Parameters<typeof issuePlayerCommand<'answerConversation'>>[3][1], related: never, cost = 0) => {
        let result: unknown = null;
        issuePlayerCommand(g, player, 'answerConversation', [sender, part, related, cost], (r) => (result = r));
        expect(pendingPlayerCommands(g)).toBe(1);
        return () => {
            flushPlayerCommands(g);
            return result as { ok: boolean; noFunds: boolean; expireFor: Empire | null; history: { title: string; text: string } | null };
        };
    };

    it('joint war accept: no war until the boundary, then the player is at war with the target', () => {
        const { g, player, a, b } = setup();
        const rel = obtainDiplomaticRelation(player, b);
        rel.type = DiplomaticRelationType.None;
        obtainDiplomaticRelation(b, player).type = DiplomaticRelationType.None;
        const flush = answer(g, player, a, 'WAR_DECLARE_REQUESTJOINT_ACCEPT', b as never);
        expect(obtainDiplomaticRelation(player, b).type).toBe(DiplomaticRelationType.None);
        const r = flush();
        expect(r.ok).toBe(true);
        expect(r.expireFor).toBe(b);
        expect(obtainDiplomaticRelation(player, b).type).toBe(DiplomaticRelationType.War);
    }, 300000);

    it('joint trade sanctions accept imposes them; lift accept lifts them', () => {
        const { g, player, a, b } = setup();
        obtainDiplomaticRelation(player, b).type = DiplomaticRelationType.None;
        obtainDiplomaticRelation(b, player).type = DiplomaticRelationType.None;
        answer(g, player, a, 'TRADESANCTIONS_REQUESTIMPOSEJOINT_ACCEPT', b as never)();
        expect(obtainDiplomaticRelation(player, b).type).toBe(DiplomaticRelationType.TradeSanctions);
        answer(g, player, a, 'TRADESANCTIONS_REQUESTLIFTOTHER_ACCEPT', b as never)();
        expect(obtainDiplomaticRelation(player, b).type).toBe(DiplomaticRelationType.None);
    }, 300000);

    it('stop-war accept ends the war with the named empire', () => {
        const { g, player, a, b } = setup();
        obtainDiplomaticRelation(player, b).type = DiplomaticRelationType.War;
        obtainDiplomaticRelation(b, player).type = DiplomaticRelationType.War;
        const r = answer(g, player, a, 'WAR_END_REQUESTOTHER_ACCEPT', b as never)();
        expect(r.ok).toBe(true);
        expect(obtainDiplomaticRelation(player, b).type).toBe(DiplomaticRelationType.None);
    }, 300000);

    it('honour mutual defence declares war on the aggressor; decline costs civility and ends the pact', () => {
        const { g, player, a, b } = setup();
        obtainDiplomaticRelation(player, b).type = DiplomaticRelationType.None;
        obtainDiplomaticRelation(b, player).type = DiplomaticRelationType.None;
        answer(g, player, a, 'MUTUALDEFENSE_HONORREQUESTHELP', b as never)();
        expect(obtainDiplomaticRelation(player, b).type).toBe(DiplomaticRelationType.War);

        const civility = player.civilityRating;
        obtainDiplomaticRelation(a, player).type = DiplomaticRelationType.MutualDefensePact;
        answer(g, player, a, 'MUTUALDEFENSE_DECLINEREQUESTHELP', null as never)();
        expect(player.civilityRating).toBe(civility - 6);
        expect(obtainDiplomaticRelation(a, player).type).toBe(DiplomaticRelationType.None);
    }, 300000);

    it('buying pirate info (ruins): money moves and the system is explored, only after the boundary; no funds changes nothing', () => {
        const { g, player } = setup();
        const pirate = g.pirateEmpires[0];
        const habitat = g.habitats.find((h) => h !== null && h.systemIndex >= 0 && player.systemVisibility[h.systemIndex].status === SystemVisibilityStatus.Unexplored)!;
        expect(habitat).toBeDefined();
        player.stateMoney = 50000;
        const pirateBefore = pirate.stateMoney;
        const flush = answer(g, player, pirate, 'INFO_RUINS', habitat as never, 30000);
        expect(player.stateMoney).toBe(50000);
        expect(player.systemVisibility[habitat.systemIndex].status).toBe(SystemVisibilityStatus.Unexplored);
        const r = flush();
        expect(r.ok).toBe(true);
        expect(player.stateMoney).toBe(20000);
        expect(pirate.stateMoney).toBe(pirateBefore + 30000);
        expect(player.systemVisibility[habitat.systemIndex].status).toBe(SystemVisibilityStatus.Explored);
        expect(player.locationHints.some((p) => p.x === Math.trunc(habitat.xpos) && p.y === Math.trunc(habitat.ypos))).toBe(true);

        player.stateMoney = 10;
        const broke = answer(g, player, pirate, 'INFO_EXPLORATION', habitat as never, 2000)();
        expect(broke.noFunds).toBe(true);
        expect(broke.ok).toBe(false);
        expect(player.stateMoney).toBe(10);
    }, 300000);

    it('a swap-galaxy-maps offer: accept merges the maps at the boundary', () => {
        const { g, player, a } = setup();
        const item = new TradeableItem(TradeableItemType.GalaxyMap, null, 0);
        const r = answer(g, player, a, 'DEAL_ACCEPT', item as never)();
        expect(r.ok).toBe(true);
    }, 300000);

    it('a list deal: accept hands the offered money over', () => {
        const { g, player, a } = setup();
        player.stateMoney = 1000;
        a.stateMoney = 5000;
        const offered = [new TradeableItem(TradeableItemType.Money, 700, 700)];
        const requested = [new TradeableItem(TradeableItemType.Money, 100, 100)];
        const r = answer(g, player, a, 'DEAL_ACCEPT', [offered, requested] as never)();
        expect(r.ok).toBe(true);
        expect(player.stateMoney).toBe(1000 + 700 - 100);
        expect(a.stateMoney).toBe(5000 - 700 + 100);
    }, 300000);

    it('a refused war threat: the threatening empire declares war on the player', () => {
        const { g, player, a } = setup();
        obtainDiplomaticRelation(player, a).type = DiplomaticRelationType.None;
        obtainDiplomaticRelation(a, player).type = DiplomaticRelationType.None;
        const offered = [new TradeableItem(TradeableItemType.ThreatenWar, player, 0)];
        const requested = [new TradeableItem(TradeableItemType.Money, null, 100)];
        const r = answer(g, player, a, 'DEAL_REJECT', [offered, requested] as never)();
        expect(r.ok).toBe(true);
        expect(obtainDiplomaticRelation(player, a).type).toBe(DiplomaticRelationType.War);
    }, 300000);

    it('story secret accepts add the revealed text to the message list', () => {
        const { g, player, a } = setup();
        const before = empireMessages(player).length;
        const r = answer(g, player, a, 'HISTORY_OFFER_STORYCLUE_ACCEPT', null as never)();
        expect(r.ok).toBe(true);
        expect(r.history?.text).toBeTruthy();
        expect(empireMessages(player).length).toBe(before + 1);
    }, 300000);
});
