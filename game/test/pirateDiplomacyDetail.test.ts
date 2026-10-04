// The Diplomacy screen of a pirate player (EmpireDetailView.cs DrawEmpireDetail 512-570, DiplomaticRelationListView.cs
// 164-176), the HISTORY_OFFER_LOCATIONHINT_ACCEPT reply (Main.Part10.cs 4988 → HISTORY_LOCATIONHINT, method_230 3844
// Galaxy.5.cs 3672 CheckForStoryLocationHint) and "Let's discuss something else..." rebuilding the greeting menu in the
// message dialog (Main.Part9.cs 731 method_241 → method_238 GREETING_NEUTRAL, 166-258 / 629-659).
import { beforeAll, describe, expect, it } from 'vitest';
import { createGame, type Game } from '../src/sim/game';
import { defaultStartGameOptions, toCreateGameOptions, type StartGameOptions } from '../src/sim/startGameOptions';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { Empire } from '../src/sim/empire';
import { PirateRelationType, obtainPirateRelation } from '../src/sim/pirateRelations';
import { diplomacyRows, piratePlayerRelationView } from '../src/ui/screens/diplomacyScreen';
import { runPlayerCommand } from '../src/sim/player/playerCommands';
import { listProposals, type ProposalResult } from '../src/sim/player/diplomacyProposals';
import { conversationActions, conversationReplyView, greetingMenuLinks, proposalReplyLinks } from '../src/ui/conversationActions';
import { EmpireMessage, EmpireMessageType } from '../src/sim/messages';
import type { ConversationReplyResult } from '../src/sim/player/conversationReplies';

let game: Game;
let player: Empire;
let ai: Empire;
beforeAll(async () => {
    const gameData = await loadGameDataFs();
    const o: StartGameOptions = {
        ...defaultStartGameOptions(),
        seed: 11,
        raceName: 'Human',
        empireType: 'CustomPirate',
        starCountIndex: 1,
        dimensionIndex: 1,
        otherEmpires: { autogenerate: true, empireCount: 4, manual: [] },
    };
    game = createGame(toCreateGameOptions(o, gameData, Array.from({ length: 1500 }, (_, i) => `N${i}`)));
    player = game.playerEmpire;
    ai = game.galaxy.empires.find((e) => e !== player && e.pirateEmpireBaseHabitat === null && e !== game.galaxy.independentEmpire && e.active)!;
}, 180000);

describe('a pirate player\'s Diplomacy screen (EmpireDetailView.cs:512-570)', () => {
    it('lists the standard empires met through PirateRelations (DiplomaticRelationListView.cs:164-176)', () => {
        expect(player.pirateEmpireBaseHabitat).not.toBeNull();
        expect(diplomacyRows(player, 0, '').some((r) => r.empire === ai)).toBe(false);
        obtainPirateRelation(player, ai).type = PirateRelationType.None;
        const row = diplomacyRows(player, 0, '').find((r) => r.empire === ai)!;
        expect(row).toBeDefined();
        expect(row.isPirate).toBe(false);
        expect(row.piratePlayer).not.toBeNull();
        expect(row.pirateRelationType).toBe(PirateRelationType.None);
        // text7: None → "None" in _NoneColor.
        expect(row.relationText).toBe('None');
        expect(row.relationColor).toBe(0x808080);
    });

    it('None: their feeling from their PirateRelation with us, no payment line', () => {
        obtainPirateRelation(player, ai).type = PirateRelationType.None;
        const theirs = obtainPirateRelation(ai, player);
        theirs.evaluationGifts = 30; // factored by diplomacyFactor 1 → Evaluation 30
        const v = piratePlayerRelationView(player, ai);
        expect(theirs.evaluation).toBeCloseTo(30, 5);
        // ResolveFeelingDescription(PirateRelation): (int)30 → Friendly; "+0;-0;0".
        expect(v.feeling).toBe('Friendly with us (+30)');
        expect(v.payment).toBeNull();
        // DetermineEmpireRelationshipFactors (Empire.7.cs:4270 pirate branch): the gift factor, light green.
        const gift = v.factors.find((f) => f.value > 0)!;
        expect(gift.text).toMatch(/\(\+30\)$/);
        theirs.evaluationGifts = 0;
    });

    it('Protection: "Pirate Protection" in the protection colour and the monthly / yearly payment', () => {
        const mine = obtainPirateRelation(player, ai);
        mine.type = PirateRelationType.Protection;
        mine.monthlyProtectionFeeToThisEmpire = 1234.5;
        const theirs = obtainPirateRelation(ai, player);
        theirs.type = PirateRelationType.Protection;
        theirs.evaluationShipAttacks = -12.4;
        const v = piratePlayerRelationView(player, ai);
        expect(v.type).toBe(PirateRelationType.Protection);
        expect(v.relationText).toBe('Pirate Protection');
        expect(v.relationColor).toBe(0xa0a0ff);
        // GameText "Pirate Protection Payment Description": fee.ToString("0"), fee * 12 ToString("0").
        expect(v.payment).toBe('Monthly Protection payment of 1235 credits (14814 credits per year)');
        expect(v.feeling).toBe('Annoyed with us (-12)');
        const attack = v.factors.find((f) => f.value < 0)!;
        expect(attack.text).toMatch(/\(-12\)$/);
        const row = diplomacyRows(player, 0, '').find((r) => r.empire === ai)!;
        expect(row.protectionFeePerMonth).toBe(1234.5);
        expect(row.relationText).toBe('Pirate Protection');
        theirs.evaluationShipAttacks = 0;
        mine.type = PirateRelationType.None;
        theirs.type = PirateRelationType.None;
        mine.monthlyProtectionFeeToThisEmpire = 0;
    });

    it('NotMet relation: no relationship text (tan), the fresh relation reads Cautious (0)', () => {
        const other = game.galaxy.empires.find((e) => e !== player && e !== ai && e.pirateEmpireBaseHabitat === null && e !== game.galaxy.independentEmpire)!;
        const v = piratePlayerRelationView(player, other);
        expect(v.relationText).toBe('');
        expect(v.relationColor).toBe(0xd2b48c);
        expect(v.feeling).toBe('Cautious with us (0)');
    });

    it('the pirate player\'s greeting menu with a standard empire: propose protection, trade, Goodbye', () => {
        obtainPirateRelation(player, ai).type = PirateRelationType.None;
        const links = greetingMenuLinks(listProposals(game.galaxy, player, ai), null);
        expect(links[0].kind).toBe('submit');
        expect(links[0].kind === 'submit' && links[0].option.part).toBe('PIRATE_PROTECTIONPROPOSE_OFFER');
        expect(links.some((l) => l.kind === 'submit' && l.option.part === 'DEAL_BEGIN')).toBe(true);
        // Main.Part9.cs:629-634: a GREETING part ends with "Goodbye" only.
        expect(links[links.length - 1].kind).toBe('exit');
        expect(links.some((l) => l.kind === 'greeting')).toBe(false);
    });
});

describe('HISTORY_OFFER_LOCATIONHINT_ACCEPT (Main.Part10.cs:4988, method_230 HISTORY_LOCATIONHINT)', () => {
    function hintMessage(sender: Empire): EmpireMessage {
        const m = new EmpireMessage(sender, EmpireMessageType.HistoryOfferLocationHint, null);
        m.description = 'Our research has uncovered the location of important historical items.';
        return m;
    }

    it('"Tell us more" is answered by the sim: the hint text with CheckForStoryLocationHint and the player\'s location hint', () => {
        const g = game.galaxy;
        expect(g.storyClueLocations.length).toBeGreaterThan(1);
        g.storyCluesEnabled = true;
        const entry = { message: hintMessage(ai), conversation: 'HISTORY_OFFER_LOCATIONHINT' as const, sender: ai };
        const actions = conversationActions(entry, { player, galaxy: g, answerable: false, pirateOffer: false });
        expect(actions.map((a) => a.id)).toEqual(['HISTORY_OFFER_LOCATIONHINT_ACCEPT', 'HISTORY_OFFER_LOCATIONHINT_REJECT']);
        const accept = actions[0];
        expect(accept.effect).toEqual({ kind: 'reply', part: 'HISTORY_OFFER_LOCATIONHINT_ACCEPT', related: null, cost: 0 });
        const hintsBefore = player.locationHints.length;
        const r = runPlayerCommand(g, player, 'answerConversation', [ai, 'HISTORY_OFFER_LOCATIONHINT_ACCEPT', null, 0]) as ConversationReplyResult;
        expect(r.ok).toBe(true);
        expect(r.reply).toBe('HISTORY_LOCATIONHINT');
        // "coordinates {0}, {1}" with Xpos.ToString("0,K"), then ", " + GenerateLocationDescription(x, y, true).
        expect(r.replyArgs[0]).toMatch(/^coordinates -?\d+K, -?\d+K, /);
        expect(player.locationHints.length).toBe(hintsBefore + 1);
        const v = conversationReplyView(accept, entry, player, r);
        expect(v).toEqual({ kind: 'reply', part: 'HISTORY_LOCATIONHINT', args: r.replyArgs });
    });

    it('story clues off: the hint is empty and no location hint is added', () => {
        const g = game.galaxy;
        g.storyCluesEnabled = false;
        const hintsBefore = player.locationHints.length;
        const r = runPlayerCommand(g, player, 'answerConversation', [ai, 'HISTORY_OFFER_LOCATIONHINT_ACCEPT', null, 0]) as ConversationReplyResult;
        expect(r.reply).toBe('HISTORY_LOCATIONHINT');
        expect(r.replyArgs).toEqual(['']);
        expect(player.locationHints.length).toBe(hintsBefore);
    });
});

describe('"Let\'s discuss something else..." rebuilds the greeting menu (Main.Part9.cs:731 method_241)', () => {
    it('the default lines carry the greeting effect, not the Diplomacy screen', () => {
        const m = new EmpireMessage(ai, EmpireMessageType.GeneralWarning, null);
        const actions = conversationActions({ message: m, conversation: 'WARNING_GENERAL' as never, sender: ai }, { player, galaxy: game.galaxy, answerable: false, pirateOffer: false });
        const discuss = actions.find((a) => a.id === 'GREETING_NEUTRAL')!;
        expect(discuss.effect).toEqual({ kind: 'greeting' });
        expect(actions[actions.length - 1].id).toBe('Exit');
    });

    it('a sub-menu lists its options, then "Let\'s discuss something else..." and "Goodbye"', () => {
        const opts = [
            { id: 'A', part: 'WARNING_ATTACKS', menu: 'WARNING', menuLabel: 'Send a warning', label: 'Stop', cost: 0, related: null, enabled: true, hint: '' },
            { id: 'B', part: 'WARNING_INTELLIGENCEMISSIONS', menu: 'WARNING', menuLabel: 'Send a warning', label: 'End', cost: 0, related: null, enabled: true, hint: '' },
            { id: 'C', part: 'GIFT_PROPOSE', menu: 'GIFT_PROPOSE', menuLabel: 'Send a gift', label: 'Send a gift', cost: 0, related: null, enabled: false, hint: 'Requires 1,000 credits' },
        ] as const;
        const top = greetingMenuLinks(opts as never, null);
        // The disabled placeholder is not offered (method_238 never adds it).
        expect(top.map((l) => l.kind)).toEqual(['menu', 'exit']);
        expect(top[0].kind === 'menu' && top[0].part).toBe('WARNING');
        const sub = greetingMenuLinks(opts as never, 'Send a warning');
        expect(sub.map((l) => (l.kind === 'submit' ? l.option.id : l.kind))).toEqual(['A', 'B', 'greeting', 'exit']);
    });

    it('a reply: follow-ups, then the default lines unless the reply is on the break list; a greeting rebuilds the menu', () => {
        const base: ProposalResult = { ok: true, accepted: true, message: '', reply: 'TREATY_ACCEPTRESPONSE', replyArgs: [], followUps: [], expireMessagesFor: null, automationPrompt: false, trade: null };
        expect(proposalReplyLinks(base).links.map((l) => l.kind)).toEqual(['greeting', 'exit']);
        const fu = { id: 'PIRATE_TRUCEACCEPTRESPONSE', part: 'PIRATE_TRUCEACCEPTRESPONSE', menu: 'FOLLOW_UP', menuLabel: '', label: 'We accept a truce', cost: 0, related: null, enabled: true, hint: '' } as never;
        const pirate = proposalReplyLinks({ ...base, reply: 'PIRATE_PROTECTIONPROPOSE', followUps: [fu] });
        expect(pirate.links.map((l) => l.kind)).toEqual(['submit']);
        const buyInfo = proposalReplyLinks({ ...base, reply: 'PIRATE_BUYINFO', followUps: [fu] });
        expect(buyInfo.links.map((l) => l.kind)).toEqual(['submit', 'greeting', 'exit']);
        expect(proposalReplyLinks({ ...base, reply: 'GREETING_FRIENDLY' }).greeting).toBe(true);
        expect(proposalReplyLinks({ ...base, ok: false, reply: null, message: 'No longer on offer' }).links.map((l) => l.kind)).toEqual(['greeting', 'exit']);
    });
});
