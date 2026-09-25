import { describe, expect, it } from 'vitest';
import {
    conversationHeading,
    isAnswerableProposal,
    popupTitle,
    pruneConversationQueue,
    type ConversationEntry,
} from '../src/ui/messagePopups';
import { declineProposal } from '../src/ui/screens/diplomacyScreen';
import { DiplomaticRelation, DiplomaticRelationList, DiplomaticRelationType, DiplomaticStrategy } from '../src/sim/diplomacy';
import { EmpireMessage, EmpireMessageType } from '../src/sim/messages';
import type { Empire } from '../src/sim/empire';
import type { Galaxy } from '../src/sim/galaxy';

// Task 16d: pure conversation-queue helpers (no DOM).

const galaxy = { aggressionLevel: 1, independentEmpire: null } as unknown as Galaxy;
function fake(id: number, name: string): Empire {
    const proposed = new DiplomaticRelationList();
    proposed.invertEmpireIndexing = true;
    return {
        empireId: id, name, active: true, galaxy, mainColor: 0x112233, pirateEmpireBaseHabitat: null,
        diplomaticRelations: new DiplomaticRelationList(), proposedDiplomaticRelations: proposed, messages: [],
    } as unknown as Empire;
}

function setup() {
    const P = fake(2, 'Player');
    const B = fake(1, 'Zorg');
    const theirs = new DiplomaticRelation(DiplomaticRelationType.None, B, B, P, false);
    theirs.strategy = DiplomaticStrategy.Placate;
    B.diplomaticRelations.add(theirs);
    const proposal = new DiplomaticRelation(DiplomaticRelationType.None, B, B, P, false);
    proposal.lastDiplomacyTradeOfferDate = 1000;
    P.proposedDiplomaticRelations.add(proposal);
    const propose: ConversationEntry = {
        message: new EmpireMessage(B, EmpireMessageType.ProposeDiplomaticRelation, DiplomaticRelationType.None),
        conversation: 'CANCELTREATY',
        sender: B,
    };
    const info: ConversationEntry = {
        message: new EmpireMessage(B, EmpireMessageType.SellInfoRuins, null),
        conversation: 'INFO_OFFER_RUINS',
        sender: B,
    };
    return { P, B, propose, info };
}

describe('isAnswerableProposal / pruneConversationQueue', () => {
    it('keeps an open offer and prunes it once declined', () => {
        const { P, B, propose, info } = setup();
        expect(isAnswerableProposal(propose, P, 1000)).toBe(true);
        const queue = [propose, info];
        expect(pruneConversationQueue(queue, P, 1000)).toBe(0);
        expect(queue).toHaveLength(2);
        expect(declineProposal(P, B)).toBe(true);
        expect(isAnswerableProposal(propose, P, 1000)).toBe(false);
        expect(pruneConversationQueue(queue, P, 1000)).toBe(1);
        expect(queue).toEqual([info]);
    });

    it('a non-Propose entry is never answerable', () => {
        const { P, info } = setup();
        expect(isAnswerableProposal(info, P, 1000)).toBe(false);
    });
});

describe('conversationHeading', () => {
    it('labels the treaty on offer and relation-type subjects', () => {
        const { P, B, propose } = setup();
        P.diplomaticRelations.add(new DiplomaticRelation(DiplomaticRelationType.War, B, P, B, false));
        expect(conversationHeading(propose, P)).toBe('Treaty on Offer: Ending War');
        expect(conversationHeading(propose, P, 1000)).toBe('Treaty on Offer: Ending War');
        const war: ConversationEntry = {
            message: new EmpireMessage(B, EmpireMessageType.DiplomaticRelationChange, DiplomaticRelationType.War),
            conversation: 'WAR_DECLARE',
            sender: B,
        };
        expect(conversationHeading(war, P)).toBe('War');
    });
});

describe('popupTitle', () => {
    it('title, then sender name, then Message', () => {
        const { B } = setup();
        const a = new EmpireMessage(null, EmpireMessageType.ColonyLost, null);
        a.title = 'Colony Lost';
        expect(popupTitle(a)).toBe('Colony Lost');
        expect(popupTitle(new EmpireMessage(B, EmpireMessageType.Informational, null))).toBe('Zorg');
        expect(popupTitle(new EmpireMessage(null, EmpireMessageType.Informational, null))).toBe('Message');
    });
});
