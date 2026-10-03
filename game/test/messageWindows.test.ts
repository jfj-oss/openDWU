import { describe, expect, it } from 'vitest';
import { messageCardFlagEmpire, messageCardText, messageImageUrl, messagePicture } from '../src/ui/messagePicture';
import { CARD, EVENT, TALK, cardHeight, cardPosition, eventButtonRects, eventPanelLayout } from '../src/ui/messageWindowLayout';
import { EmpireMessage, EmpireMessageType } from '../src/sim/messages';
import { DiplomaticRelation, DiplomaticRelationList, DiplomaticRelationType } from '../src/sim/diplomacy';
import { Habitat } from '../src/sim/types';
import { Empire } from '../src/sim/empire';
import { Character } from '../src/sim/characters';

// The message windows' pure parts: MessagePopup.cs's picture switch and text, and the method_513 / method_296 layouts.

function fakeEmpire(id: number, name: string): Empire {
    const e = Object.create(Empire.prototype) as Empire;
    Object.assign(e, { empireId: id, name, diplomaticRelations: new DiplomaticRelationList(), pirateEmpireBaseHabitat: null, research: null });
    return e;
}

const player = fakeEmpire(1, 'Player');
const other = fakeEmpire(2, 'Zorg');

function msg(type: EmpireMessageType, subject: unknown, sender: Empire | null = other, description = 'Hello'): EmpireMessage {
    const m = new EmpireMessage(sender, type, subject);
    m.description = description;
    return m;
}

describe('messagePicture (MessagePopup.cs _MainImage)', () => {
    it('uses the ui/messages pictures by message type', () => {
        expect(messagePicture(msg(EmpireMessageType.BattleUnderAttack, null), player)).toEqual({ kind: 'url', url: messageImageUrl(0), flag: null, striped: false });
        expect(messageImageUrl(0)).toBe('/assets/dwu/images/ui/messages/underAttack.png');
        expect(messagePicture(msg(EmpireMessageType.ColonyLost, null), player)).toMatchObject({ url: '/assets/dwu/images/ui/messages/colonyloss.png' });
        expect(messagePicture(msg(EmpireMessageType.ColonyGained, null), player)).toMatchObject({ url: '/assets/dwu/images/ui/messages/colonygain.png' });
        expect(messagePicture(msg(EmpireMessageType.GalacticNewsNet, null), player)).toMatchObject({ url: '/assets/dwu/images/ui/messages/galacticnewsnet.png' });
        expect(messagePicture(msg(EmpireMessageType.ResearchBreakthrough, null), player)).toMatchObject({ url: '/assets/dwu/images/ui/messages/researchbreakthrough.png' });
        expect(messagePicture(msg(EmpireMessageType.ConstructionResourceShortage, null), player)).toMatchObject({ url: '/assets/dwu/images/ui/messages/construction_stalled.png' });
    });

    it('imprints the sender flag on the treaty pictures (ImprintFlag)', () => {
        const war = messagePicture(msg(EmpireMessageType.DiplomaticRelationChange, DiplomaticRelationType.War), player);
        expect(war).toEqual({ kind: 'url', url: '/assets/dwu/images/ui/messages/declarewar.png', flag: other, striped: false });
        const req = messagePicture(msg(EmpireMessageType.RequestJointWar, null), player);
        expect(req).toMatchObject({ url: '/assets/dwu/images/ui/messages/request.png', flag: other });
    });

    it('picks the relation None picture from the current relation', () => {
        // No relation: canceltreaty; at war: endwar; sanctions: resumetrade.
        expect(messagePicture(msg(EmpireMessageType.DiplomaticRelationChange, DiplomaticRelationType.None), player)).toMatchObject({ url: messageImageUrl(12) });
        const p = fakeEmpire(3, 'P');
        p.diplomaticRelations.add(new DiplomaticRelation(DiplomaticRelationType.War, p, p, other, false));
        expect(messagePicture(msg(EmpireMessageType.DiplomaticRelationChange, DiplomaticRelationType.None), p)).toMatchObject({ url: messageImageUrl(4) });
    });

    it('shows a ruin picture for ruins and the character for a character message', () => {
        const h = Object.create(Habitat.prototype) as Habitat;
        Object.assign(h, { ruin: { pictureRef: 7 }, facilities: [], landscapePictureRef: 3 });
        expect(messagePicture(msg(EmpireMessageType.ExplorationRuins, h), player)).toMatchObject({ url: '/assets/dwu/images/environment/ruins/ruin_7.png' });
        expect(messagePicture(msg(EmpireMessageType.NewColony, h), player)).toEqual({ kind: 'landscape', ref: 3, striped: false });
        expect(messagePicture(msg(EmpireMessageType.NewColonyFailed, h), player)).toEqual({ kind: 'landscape', ref: 3, striped: true });
        const c = Object.create(Character.prototype) as Character;
        expect(messagePicture(msg(EmpireMessageType.CharacterDeath, c), player)).toEqual({ kind: 'character', character: c });
        expect(messagePicture(msg(EmpireMessageType.CharacterDeath, null), player)).toMatchObject({ url: messageImageUrl(19) });
    });

    it('shows the flag + race picture for a discovered / defeated empire, and no picture otherwise', () => {
        expect(messagePicture(msg(EmpireMessageType.EmpireDiscovered, other), player)).toEqual({ kind: 'empire', empire: other, striped: false });
        expect(messagePicture(msg(EmpireMessageType.EmpireDefeated, other), player)).toEqual({ kind: 'empire', empire: other, striped: true });
        expect(messagePicture(msg(EmpireMessageType.GeneralDecision, null), player)).toEqual({ kind: 'flag', empire: other });
        expect(messagePicture(msg(EmpireMessageType.PirateOfferProtection, null), player)).toBeNull();
    });
});

describe('messageCardText / flag', () => {
    it('prefixes the sender name except for news and the player', () => {
        expect(messageCardText(msg(EmpireMessageType.GeneralWarning, null), player, 'Beware')).toBe('Zorg: Beware');
        expect(messageCardText(msg(EmpireMessageType.GalacticNewsNet, null), player, 'News')).toBe('News');
        expect(messageCardText(msg(EmpireMessageType.GeneralWarning, null, player), player, 'Self')).toBe('Self');
        expect(messageCardFlagEmpire(msg(EmpireMessageType.GeneralWarning, null), player)).toBe(other);
        expect(messageCardFlagEmpire(msg(EmpireMessageType.GeneralWarning, null, player), player)).toBeNull();
    });
});

describe('event panel layout (Main.Part4.cs method_513)', () => {
    it('places the picture, title, text and buttons like the original', () => {
        const l = eventPanelLayout(true, 24);
        expect(l.panel).toEqual({ x: 10, y: 10, w: 400, h: 640 });
        expect(l.picture).toEqual({ x: 20, y: 10, w: 360, h: 270 });
        expect(l.titleY).toBe(290);
        expect(l.container).toEqual({ x: 10, y: 270 + 20 + 24 + 5, w: 385, h: 640 - (270 + 75 + 24) });
        expect(l.textW).toBe(365);
        expect(l.buttonY).toBe(600);
        const n = eventPanelLayout(false, 24, false, 30);
        expect(n.picture).toBeNull();
        expect(n.titleY).toBe(10);
        expect(n.container).toEqual({ x: 10, y: 49, w: 385, h: 640 - (75 + 24 + 30) });
        expect(n.buttonY).toBe(570);
    });

    it('lays the buttons out as Investigate / Avoid, Close / Go to, or a centred Close', () => {
        expect(eventButtonRects(2, 600)).toEqual([
            { x: 20, y: 600, w: 175, h: 30 },
            { x: 205, y: 600, w: 175, h: 30 },
        ]);
        expect(eventButtonRects(1, 600)).toEqual([{ x: 112, y: 600, w: 175, h: 30 }]);
        expect(eventButtonRects(2, 570, 30)[0].h).toBe(60);
        const three = eventButtonRects(3, 600);
        expect(three).toHaveLength(3);
        expect(three[2].x + three[2].w).toBeLessThanOrEqual(20 + 360);
        expect(EVENT.width).toBe(420);
    });
});

describe('card and talk layout', () => {
    it('sizes the card like pnlMessagePopup and places it beside the stub list', () => {
        expect(CARD.width).toBe(335);
        expect(cardHeight()).toBe(CARD.height + 40);
        const p = cardPosition(1920, 1080, 1, { left: 1600, top: 120 });
        expect(p).toEqual({ left: 1600 - 10 - 335, top: 120 });
        const c = cardPosition(1920, 1080, 1, null);
        expect(c).toEqual({ left: 1920 - 335 - 10, top: Math.round((1080 - cardHeight()) / 2) });
    });

    it('sizes the talk panel like pnlDiplomacyTalk', () => {
        expect([TALK.width, TALK.height]).toEqual([430, 778]);
        expect(TALK.response.y + TALK.response.h).toBeLessThan(TALK.options.y);
    });
});
