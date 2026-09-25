import { beforeEach, describe, expect, it } from 'vitest';
import {
    MessageCategory,
    defaultMessageOptions,
    getMessageOptions,
    resetMessageOptions,
    routeEmpireMessage,
    setMessageOption,
    setSuppressAllPopups,
    shouldQueueConversation,
} from '../src/ui/messageRouting';
import { EmpireMessage, EmpireMessageType } from '../src/sim/messages';
import { DiplomaticRelation, DiplomaticRelationList, DiplomaticRelationType } from '../src/sim/diplomacy';
import { AutomationLevel, type Empire } from '../src/sim/empire';
import type { Galaxy } from '../src/sim/galaxy';
import { BuiltObject } from '../src/sim/builtObject';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { Habitat } from '../src/sim/types';
import { TradeableItem, TradeableItemType } from '../src/sim/tradeItems';
import { formatEmpireMessage } from '../src/ui/empireMessageFeed';

// Task 16d: Main.Part9.cs ReceiveMessageInternal routing (pure, no DOM).

const galaxy = { aggressionLevel: 1, independentEmpire: null } as unknown as Galaxy;
function fake(id: number, name: string, extra: Record<string, unknown> = {}): Empire {
    const proposed = new DiplomaticRelationList();
    proposed.invertEmpireIndexing = true;
    return {
        empireId: id, name, active: true, galaxy, mainColor: 0x112233, pirateEmpireBaseHabitat: null,
        diplomaticRelations: new DiplomaticRelationList(), proposedDiplomaticRelations: proposed, messages: [],
        controlDiplomacyOffense: AutomationLevel.Undefined, ...extra,
    } as unknown as Empire;
}

function msg(sender: Empire | null, type: EmpireMessageType, subject: unknown = null, extra: Partial<EmpireMessage> = {}): EmpireMessage {
    const m = new EmpireMessage(sender, type, subject);
    m.description = 'text';
    Object.assign(m, extra);
    return m;
}

const bo = (subRole: BuiltObjectSubRole): BuiltObject => Object.assign(Object.create(BuiltObject.prototype) as BuiltObject, { subRole });
const item = (t: TradeableItemType): TradeableItem => new TradeableItem(t, null, 0);

let player: Empire;
let sender: Empire;
const route = (m: EmpireMessage) => routeEmpireMessage(m, player, getMessageOptions());
const relate = (type: DiplomaticRelationType, initiator: Empire): DiplomaticRelation => {
    const rel = new DiplomaticRelation(type, initiator, player, sender, false);
    player.diplomaticRelations.add(rel);
    return rel;
};

beforeEach(() => {
    resetMessageOptions();
    player = fake(2, 'Player');
    sender = fake(1, 'Zorg');
});

describe('defaultMessageOptions (method_260)', () => {
    it('matches the Main.Part9.cs:2711 defaults', () => {
        const o = defaultMessageOptions();
        expect(o.popup[MessageCategory.BuiltObjectBuilt]).toBe(false);
        expect(o.popup[MessageCategory.ShipMissionComplete]).toBe(false);
        expect(o.popup[MessageCategory.ShipNeedsRefuelling]).toBe(false);
        expect(o.popup[MessageCategory.ColonyInvaded]).toBe(true);
        expect(Object.values(o.ticker)).toHaveLength(21);
        expect(Object.values(o.ticker).every((v) => v)).toBe(true);
        expect(o.suppressAllPopups).toBe(false);
    });
});

describe('routeEmpireMessage', () => {
    it('plain categories, Informational, default, drops', () => {
        expect(route(msg(player, EmpireMessageType.ShipBaseCompleted))).toMatchObject({
            category: MessageCategory.BuiltObjectBuilt, popup: false, ticker: true, conversation: null,
        });
        expect(route(msg(player, EmpireMessageType.ColonyLost))).toMatchObject({ popup: true, ticker: true });
        expect(route(msg(player, EmpireMessageType.ColonyLost, null, { supressPopup: true })).popup).toBe(false);
        expect(route(msg(sender, EmpireMessageType.Informational))).toMatchObject({ category: null, popup: false, ticker: true });
        expect(route(msg(sender, EmpireMessageType.Undefined)).ticker).toBe(true);
        expect(route(msg(player, EmpireMessageType.ShipBasePurchased))).toMatchObject({ popup: false, ticker: false });
        expect(route(msg(player, EmpireMessageType.AdvisorSuggestion))).toMatchObject({ popup: false, ticker: false });
        expect(route(msg(sender, EmpireMessageType.DiplomaticRelationChange, null))).toMatchObject({
            popup: false, ticker: false, conversation: null,
        });
    });

    it('ProposeDiplomaticRelation', () => {
        expect(route(msg(sender, EmpireMessageType.ProposeDiplomaticRelation, DiplomaticRelationType.FreeTradeAgreement))).toMatchObject({
            conversation: 'OFFER_FREETRADE', popup: false, ticker: true, immediate: false,
        });
        expect(route(msg(sender, EmpireMessageType.ProposeDiplomaticRelation, DiplomaticRelationType.None))).toMatchObject({
            category: MessageCategory.DiplomacyTreaty, conversation: null,
        });
        const rel = relate(DiplomaticRelationType.War, sender);
        expect(route(msg(sender, EmpireMessageType.ProposeDiplomaticRelation, DiplomaticRelationType.None))).toMatchObject({
            conversation: 'WAR_END', immediate: true,
        });
        rel.type = DiplomaticRelationType.SubjugatedDominion;
        rel.initiator = player;
        expect(route(msg(sender, EmpireMessageType.ProposeDiplomaticRelation, DiplomaticRelationType.None)).conversation).toBe('SUBJUGATION_REQUESTRELEASE');
        rel.initiator = sender;
        expect(route(msg(sender, EmpireMessageType.ProposeDiplomaticRelation, DiplomaticRelationType.None)).conversation).toBe('SUBJUGATION_RELEASE');
    });

    it('DiplomaticRelationChange / Accept / Refuse', () => {
        relate(DiplomaticRelationType.FreeTradeAgreement, sender);
        const change = (hint: string) => route(msg(sender, EmpireMessageType.DiplomaticRelationChange, DiplomaticRelationType.None, { hint }));
        expect(change('war').conversation).toBe('WAR_END');
        expect(change('').conversation).toBe('CANCELTREATY');
        const accept = (description: string) =>
            route(msg(sender, EmpireMessageType.AcceptDiplomaticRelation, DiplomaticRelationType.None, { description }));
        expect(accept('We accept your release from Subjugation').conversation).toBe('SUBJUGATION_RELEASE');
        expect(accept('Peace at last').conversation).toBe('WAR_END_ACCEPT');
        expect(route(msg(sender, EmpireMessageType.RefuseDiplomaticRelation, DiplomaticRelationType.FreeTradeAgreement)).conversation).toBe(
            'FREETRADE_REJECT',
        );
    });

    it('RequestJointWar depends on ControlDiplomacyOffense', () => {
        player.controlDiplomacyOffense = AutomationLevel.FullyAutomated;
        expect(route(msg(sender, EmpireMessageType.RequestJointWar))).toMatchObject({
            conversation: null, category: MessageCategory.DiplomacyRequestWarning,
        });
        player.controlDiplomacyOffense = AutomationLevel.Undefined;
        expect(route(msg(sender, EmpireMessageType.RequestJointWar)).conversation).toBe('WAR_DECLARE_REQUESTJOINT');
    });

    it('BattleUnderAttack by subject', () => {
        const under = (subject: unknown) => route(msg(player, EmpireMessageType.BattleUnderAttack, subject));
        expect(under(bo(BuiltObjectSubRole.Escort)).category).toBe(MessageCategory.UnderAttackMilitaryShips);
        expect(under(bo(BuiltObjectSubRole.SmallSpacePort)).category).toBe(MessageCategory.UnderAttackColoniesSpaceportsDefensiveBases);
        expect(under(bo(BuiltObjectSubRole.MiningStation)).category).toBe(MessageCategory.UnderAttackCivilianBases);
        expect(under(Object.create(Habitat.prototype)).category).toBe(MessageCategory.UnderAttackColoniesSpaceportsDefensiveBases);
        expect(under(null)).toMatchObject({ popup: false, ticker: false });
    });

    it('OfferTrade and PirateOfferProtection', () => {
        const offer = (subject: unknown) => route(msg(sender, EmpireMessageType.OfferTrade, subject));
        expect(offer([[item(TradeableItemType.Money)], [item(TradeableItemType.ThreatenWar)]])).toMatchObject({
            conversation: 'DEAL_THREAT', immediate: true,
        });
        expect(offer([[], [item(TradeableItemType.Money)]]).conversation).toBe('DEAL_DEMAND');
        expect(offer([[item(TradeableItemType.Money)], [item(TradeableItemType.Money)]]).conversation).toBe('DEAL_OFFER');
        expect(offer(new TradeableItem(TradeableItemType.GalaxyMap, null, 0)).conversation).toBe('OFFER_DEAL_GALAXYMAP');
        expect(route(msg(sender, EmpireMessageType.PirateOfferProtection, null, { hint: 'extort' })).conversation).toBe('PIRATE_EXTORTPROTECTION');
        expect(route(msg(sender, EmpireMessageType.PirateOfferProtection, null, { money: 0 })).conversation).toBe('PIRATE_TRUCEPROPOSEINITIATE');
    });

    it('honours the Display options', () => {
        setMessageOption('ticker', MessageCategory.BuiltObjectBuilt, false);
        expect(route(msg(player, EmpireMessageType.ShipBaseCompleted)).ticker).toBe(false);
        setMessageOption('popup', MessageCategory.ColonyInvaded, false);
        expect(route(msg(player, EmpireMessageType.ColonyLost)).popup).toBe(false);
    });
});

describe('shouldQueueConversation', () => {
    it('queues, opens or drops', () => {
        const q = (m: EmpireMessage) => shouldQueueConversation(route(m), getMessageOptions());
        expect(q(msg(sender, EmpireMessageType.ProposeDiplomaticRelation, DiplomaticRelationType.FreeTradeAgreement))).toBe('queue');
        const war = msg(sender, EmpireMessageType.DiplomaticRelationChange, DiplomaticRelationType.War);
        expect(route(war).conversation).toBe('WAR_DECLARE');
        expect(q(war)).toBe('open');
        setSuppressAllPopups(true);
        expect(q(war)).toBe('none');
        expect(q(msg(player, EmpireMessageType.ColonyLost))).toBe('none');
    });
});

describe('formatEmpireMessage honours DisplayMessage options', () => {
    it('hides a switched-off category', () => {
        const m = msg(player, EmpireMessageType.ShipBaseCompleted, null, { description: 'Frigate built' });
        setMessageOption('ticker', MessageCategory.BuiltObjectBuilt, false);
        expect(formatEmpireMessage(m, player)).toBeNull();
        resetMessageOptions();
        expect(formatEmpireMessage(m, player)).toBe('Frigate built');
    });
});
