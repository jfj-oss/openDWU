// Task 17e: the player's outgoing diplomacy (src/sim/player/diplomacyProposals.ts) against the C# conversation code
// (Main.Part9.cs:46 method_238 option gating, Main.Part10.cs:3957 method_237 evaluation), on the harness game.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame } from './helpers/tickGame';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { GameData } from '../src/sim/data/gameData';
import { DiplomaticRelationType, DiplomaticStrategy, obtainDiplomaticRelation, obtainEmpireEvaluation } from '../src/sim/diplomacy';
import { aggressionLevel, militaryPotency, valueMoneyGiftFromEmpire } from '../src/sim/diplomacyTick';
import { desiredRelationType, listProposals, submitProposal } from '../src/sim/player/diplomacyProposals';
import { DialogSet, parseDialogFile, raceDialogFileName } from '../src/sim/data/dialogSet';
import { galaxyStarDate } from '../src/sim/tick/simTime';

let gameData: GameData;
let galaxy: Galaxy;
let player: Empire;
let ai: Empire;

function setRelation(a: Empire, b: Empire, type: DiplomaticRelationType, initiator: Empire = a): void {
    for (const [x, y] of [[a, b], [b, a]] as const) {
        const r = obtainDiplomaticRelation(x, y);
        r.type = type;
        r.initiator = initiator;
        r.locked = false;
    }
}

const ids = (e: Empire): string[] => listProposals(galaxy, player, e).map((o) => o.id);
const enabledIds = (e: Empire): string[] => listProposals(galaxy, player, e).filter((o) => o.enabled).map((o) => o.id);

beforeEach(async () => {
    gameData ??= await loadGameDataFs();
    galaxy = createTickGame(gameData).galaxy;
    player = galaxy.playerEmpire!;
    ai = galaxy.empires.find((e) => e !== player && e.pirateEmpireBaseHabitat === null && e !== galaxy.independentEmpire && e.active)!;
    ai.reclusive = false;
    player.stateMoney = 80000;
});

describe('listProposals gating (Main.Part9.cs:46 method_238)', () => {
    it('unmet empire: no conversation (DiplomaticRelationListView.cs:167 lists only met empires)', () => {
        setRelation(player, ai, DiplomaticRelationType.NotMet);
        expect(listProposals(galaxy, player, ai)).toEqual([]);
        expect(listProposals(galaxy, player, player)).toEqual([]);
    });

    it('met, no relation: TREATY_PROPOSAL None case, gifts, warnings, trade (17e2)', () => {
        setRelation(player, ai, DiplomaticRelationType.None);
        const pact = militaryPotency(player) / militaryPotency(ai) > 5.0 ? 'OFFER_PROTECTORATE' : 'OFFER_MUTUALDEFENSE';
        expect(ids(ai)).toEqual([
            'OFFER_FREETRADE', pact, 'TRADESANCTIONS_IMPOSE', 'WAR_DECLARE', 'MILITARYREFUELING_OFFER', 'MININGRIGHTS_OFFER',
            'GIFT_GIVE:small', 'GIFT_GIVE:medium', 'GIFT_GIVE:large',
            'WARNING_INTELLIGENCEMISSIONS', 'WARNING_ATTACKS', 'WARNING_REMOVEFORCESSYSTEM',
            'OFFER_DEAL', 'DEAL_BEGIN:trade',
        ]);
        expect(enabledIds(ai)).toContain('OFFER_DEAL');
        expect(enabledIds(ai)).toContain('DEAL_BEGIN:trade');
        // GIFT_PROPOSE (:522): StateMoney / 8, / 2, / 4.
        const gifts = listProposals(galaxy, player, ai).filter((o) => o.part === 'GIFT_GIVE');
        expect(gifts.map((g) => g.cost)).toEqual([2500, 5000, 10000]);
        expect(gifts[0].label).toBe('Send small gift|2,500');
    });

    it('rights already given flip to Cancel; reclusive empires offer no trade', () => {
        setRelation(player, ai, DiplomaticRelationType.FreeTradeAgreement);
        const r = obtainDiplomaticRelation(player, ai);
        r.militaryRefuelingToOther = true;
        r.miningRightsToOther = true;
        ai.reclusive = true;
        const list = ids(ai);
        expect(list.slice(0, 1)).toEqual(['CANCELTREATY']);
        expect(list).toContain('MILITARYREFUELING_CANCEL');
        expect(list).toContain('MININGRIGHTS_CANCEL');
        expect(list).not.toContain('OFFER_FREETRADE');
        expect(list).not.toContain('OFFER_DEAL');
        // Military refuelling given: no "remove your forces" warning (:547).
        expect(list).not.toContain('WARNING_REMOVEFORCESSYSTEM');
    });

    it('at war: end-war options, no warnings, negotiated end of war; a locked war falls through to the trade entries', () => {
        setRelation(player, ai, DiplomaticRelationType.War);
        expect(ids(ai)).toEqual([
            'WAR_END', 'WAR_END_SUBJUGATIONDEMAND', 'WAR_END_SUBJUGATIONOFFER',
            'GIFT_GIVE:small', 'GIFT_GIVE:medium', 'GIFT_GIVE:large',
            'WARNING', 'DEAL_BEGIN:end-war',
        ]);
        expect(enabledIds(ai)).toEqual(['WAR_END', 'WAR_END_SUBJUGATIONDEMAND', 'WAR_END_SUBJUGATIONOFFER', 'GIFT_GIVE:small', 'GIFT_GIVE:medium', 'GIFT_GIVE:large', 'DEAL_BEGIN:end-war']);
        obtainDiplomaticRelation(player, ai).locked = true;
        expect(ids(ai).slice(-2)).toEqual(['OFFER_DEAL', 'DEAL_BEGIN:trade']);
    });

    it('trade sanctions: Lift only for the initiator; gift needs 1,000 credits', () => {
        setRelation(player, ai, DiplomaticRelationType.TradeSanctions, player);
        player.stateMoney = 999;
        const list = listProposals(galaxy, player, ai);
        expect(list.filter((o) => o.menu === 'TREATY_PROPOSAL').map((o) => o.id)).toEqual(['TRADESANCTIONS_LIFT', 'WAR_DECLARE']);
        const gift = list.find((o) => o.menu === 'GIFT_PROPOSE')!;
        expect(gift.enabled).toBe(false);
        expect(gift.id).toBe('GIFT_PROPOSE');
        setRelation(player, ai, DiplomaticRelationType.TradeSanctions, ai);
        expect(listProposals(galaxy, player, ai).filter((o) => o.menu === 'TREATY_PROPOSAL').map((o) => o.id)).toEqual(['WAR_DECLARE']);
    });

    it('subjugation: release (we rule) / beg for release (they rule)', () => {
        setRelation(player, ai, DiplomaticRelationType.SubjugatedDominion, player);
        expect(ids(ai)[0]).toBe('SUBJUGATION_RELEASE');
        setRelation(player, ai, DiplomaticRelationType.SubjugatedDominion, ai);
        expect(ids(ai)[0]).toBe('SUBJUGATION_REQUESTRELEASE');
    });

    it('listing draws no galaxy.rnd', () => {
        setRelation(player, ai, DiplomaticRelationType.None);
        const before = galaxy.rnd.drawCount;
        listProposals(galaxy, player, ai);
        expect(galaxy.rnd.drawCount).toBe(before);
    });
});

describe('submitProposal (Main.Part10.cs:3957 method_237)', () => {
    it('money gift moves StateMoney both ways and records the expense / income', () => {
        setRelation(player, ai, DiplomaticRelationType.None);
        const aiMoney = ai.stateMoney;
        const expenses = player.pirateEconomy.thisYear.totalExpenses;
        const income = ai.pirateEconomy.thisYear.totalIncome;
        const ev = obtainEmpireEvaluation(galaxy, ai, player);
        const incident = ev.incidentEvaluationRaw;
        const value = valueMoneyGiftFromEmpire(galaxy, ai, player, 10000);
        const civility = player.civilityRating;
        const res = submitProposal(galaxy, player, ai, 'GIFT_GIVE:large');
        expect(res).toMatchObject({ ok: true, accepted: true, reply: 'GIFT_THANKS', message: 'GIFT_THANKS' });
        expect(player.stateMoney).toBe(70000);
        expect(ai.stateMoney).toBe(aiMoney + 10000);
        expect(player.pirateEconomy.thisYear.totalExpenses).toBeCloseTo(expenses + 10000, 6);
        expect(ai.pirateEconomy.thisYear.totalIncome).toBeCloseTo(income + 10000, 6);
        expect(ev.incidentEvaluationRaw).toBeCloseTo(Math.min(80, incident + value), 9);
        expect(player.civilityRating).toBeCloseTo(Math.max(-100, Math.min(30, civility + value * 0.1)), 9);
        expect(obtainDiplomaticRelation(player, ai).lastGiftDate).toBe(galaxyStarDate(galaxy));
    });

    it('declaring war sets War both ways', () => {
        setRelation(player, ai, DiplomaticRelationType.None);
        const res = submitProposal(galaxy, player, ai, 'WAR_DECLARE');
        expect(res.ok && res.accepted).toBe(true);
        expect(['WAR_DECLARE_RESPONSE_EAGER', 'WAR_DECLARE_RESPONSE_NEUTRAL', 'WAR_DECLARE_RESPONSE_SURPRISED']).toContain(res.reply);
        expect(obtainDiplomaticRelation(player, ai).type).toBe(DiplomaticRelationType.War);
        expect(obtainDiplomaticRelation(ai, player).type).toBe(DiplomaticRelationType.War);
        expect(obtainDiplomaticRelation(ai, player).initiator).toBe(player);
        expect(res.expireMessagesFor).toBe(ai);
    });

    // Hand-worked C#: OFFER_FREETRADE is accepted iff method_232(them, us) is FTA / MDP / Protectorate, i.e.
    // DetermineDesiredDiplomaticRelationTypical(their strategy) (Empire.8.cs): Ally → MDP, Befriend → FTA, Conquer → War.
    it.each([
        [DiplomaticStrategy.Befriend, true],
        [DiplomaticStrategy.Ally, true],
        [DiplomaticStrategy.Conquer, false],
        [DiplomaticStrategy.Placate, false],
    ])('free trade proposal with their strategy %s → accepted %s', (strategy, accept) => {
        setRelation(player, ai, DiplomaticRelationType.None);
        obtainDiplomaticRelation(ai, player).strategy = strategy;
        const res = submitProposal(galaxy, player, ai, 'OFFER_FREETRADE');
        expect(res.accepted).toBe(accept);
        expect(res.reply).toBe(accept ? 'FREETRADE_ACCEPT' : 'FREETRADE_REJECT');
        const want = accept ? DiplomaticRelationType.FreeTradeAgreement : DiplomaticRelationType.None;
        expect(obtainDiplomaticRelation(player, ai).type).toBe(want);
        expect(obtainDiplomaticRelation(ai, player).type).toBe(want);
    });

    it('pact proposal: Ally accepts the offered pact type (MDP, or Protectorate when we are > 5x stronger); Befriend refuses', () => {
        setRelation(player, ai, DiplomaticRelationType.None);
        const offered = listProposals(galaxy, player, ai).find((o) => o.part === 'OFFER_MUTUALDEFENSE' || o.part === 'OFFER_PROTECTORATE')!;
        const protectorate = militaryPotency(player) / militaryPotency(ai) > 5.0;
        expect(offered.part).toBe(protectorate ? 'OFFER_PROTECTORATE' : 'OFFER_MUTUALDEFENSE');
        obtainDiplomaticRelation(ai, player).strategy = DiplomaticStrategy.Befriend;
        expect(submitProposal(galaxy, player, ai, offered.id).accepted).toBe(false);
        obtainDiplomaticRelation(ai, player).strategy = DiplomaticStrategy.Ally;
        expect(desiredRelationType(ai, player)).toBe(protectorate ? DiplomaticRelationType.Protectorate : DiplomaticRelationType.MutualDefensePact);
        const res = submitProposal(galaxy, player, ai, offered.id);
        expect(res.accepted).toBe(true);
        expect(obtainDiplomaticRelation(ai, player).type).toBe(protectorate ? DiplomaticRelationType.Protectorate : DiplomaticRelationType.MutualDefensePact);
    });

    it('reclusive empires refuse treaties', () => {
        setRelation(player, ai, DiplomaticRelationType.None);
        obtainDiplomaticRelation(ai, player).strategy = DiplomaticStrategy.Befriend;
        ai.reclusive = true;
        expect(submitProposal(galaxy, player, ai, 'OFFER_FREETRADE').reply).toBe('FREETRADE_REJECT');
    });

    it('cancel treaty / sanctions / rights change the relation; stale options are refused', () => {
        setRelation(player, ai, DiplomaticRelationType.FreeTradeAgreement);
        const res = submitProposal(galaxy, player, ai, 'CANCELTREATY');
        expect(res.reply).toMatch(/^CANCELTREATY_RESPONSE_/);
        expect(obtainDiplomaticRelation(ai, player).type).toBe(DiplomaticRelationType.None);
        expect(submitProposal(galaxy, player, ai, 'CANCELTREATY').ok).toBe(false);
        expect(submitProposal(galaxy, player, ai, 'TRADESANCTIONS_IMPOSE').ok).toBe(true);
        expect(obtainDiplomaticRelation(ai, player).type).toBe(DiplomaticRelationType.TradeSanctions);
        expect(submitProposal(galaxy, player, ai, 'TRADESANCTIONS_LIFT').reply).toBe('TRADESANCTIONS_LIFT_RESPONSE');
        expect(obtainDiplomaticRelation(ai, player).type).toBe(DiplomaticRelationType.None);
        expect(submitProposal(galaxy, player, ai, 'MININGRIGHTS_OFFER').reply).toBe('GREETING_FRIENDLY');
        expect(obtainDiplomaticRelation(player, ai).miningRightsToOther).toBe(true);
        const deal = submitProposal(galaxy, player, ai, 'DEAL_BEGIN:trade');
        expect(deal).toMatchObject({ ok: true, reply: 'DEAL_BEGIN' });
        expect(deal.trade?.kind).toBe('trade');
    });

    it('treaty actions answer the automation message box only when asked', () => {
        setRelation(player, ai, DiplomaticRelationType.None);
        player.controlDiplomacyTreaties = 2; // FullyAutomated
        expect(submitProposal(galaxy, player, ai, 'MININGRIGHTS_OFFER').automationPrompt).toBe(true);
        expect(player.controlDiplomacyTreaties).toBe(2);
        submitProposal(galaxy, player, ai, 'MININGRIGHTS_CANCEL', { disableTreatyAutomation: true });
        expect(player.controlDiplomacyTreaties).toBe(0);
    });

    it('locked war: they refuse to end it (ConsiderEndWar false)', () => {
        setRelation(player, ai, DiplomaticRelationType.War);
        obtainDiplomaticRelation(ai, player).locked = true;
        const res = submitProposal(galaxy, player, ai, 'WAR_END');
        expect(res).toMatchObject({ ok: true, accepted: false, reply: 'WAR_END_REJECT' });
        expect(obtainDiplomaticRelation(player, ai).type).toBe(DiplomaticRelationType.War);
    });

    it('begging for release draws Rnd.Next(0, 80) only when they want no relation (Main.Part10.cs:4878)', () => {
        setRelation(player, ai, DiplomaticRelationType.SubjugatedDominion, ai);
        obtainDiplomaticRelation(ai, player).strategy = DiplomaticStrategy.Conquer; // wants War: no draw, refused
        let before = galaxy.rnd.drawCount;
        expect(submitProposal(galaxy, player, ai, 'SUBJUGATION_REQUESTRELEASE').reply).toBe('SUBJUGATION_REFUSERELEASE');
        expect(galaxy.rnd.drawCount).toBe(before);

        obtainDiplomaticRelation(ai, player).strategy = DiplomaticStrategy.Placate; // wants None: one draw
        before = galaxy.rnd.drawCount;
        const res = submitProposal(galaxy, player, ai, 'SUBJUGATION_REQUESTRELEASE');
        // Refused: exactly the one draw; released: ChangeDiplomaticRelation may draw more after it.
        if (res.reply === 'SUBJUGATION_REFUSERELEASE') expect(galaxy.rnd.drawCount).toBe(before + 1);
        else expect(galaxy.rnd.drawCount).toBeGreaterThanOrEqual(before + 1);
        if (aggressionLevel(ai) < 130) expect(res.reply).toBe('SUBJUGATION_RELEASE');
        if (aggressionLevel(ai) >= 210) expect(res.reply).toBe('SUBJUGATION_REFUSERELEASE');
        if (res.reply === 'SUBJUGATION_RELEASE') expect(obtainDiplomaticRelation(player, ai).type).toBe(DiplomaticRelationType.None);
    });

    it('demanding subjugation: accepted only when we win the war by > 3x (DetermineSubjugationOfLoserInWar)', () => {
        setRelation(player, ai, DiplomaticRelationType.War);
        // No war damage: winning ratio 1 → refused.
        expect(submitProposal(galaxy, player, ai, 'WAR_END_SUBJUGATIONDEMAND').reply).toBe('SUBJUGATIONDEMAND_REJECT');
        // Our damage to them (on their relation) 1000 vs 0: ratio 1001; accept iff our strength x (agg/100)^2 > theirs x (agg/100)^2 x 3.
        obtainDiplomaticRelation(ai, player).warDamageBuiltObject = 1000;
        const a = (e: Empire): number => Math.pow(aggressionLevel(e) / 100.0, 2.0);
        const accept = militaryPotency(player) * a(player) > militaryPotency(ai) * a(ai) * 3.0;
        const res = submitProposal(galaxy, player, ai, 'WAR_END_SUBJUGATIONDEMAND');
        expect(res.accepted).toBe(accept);
        if (accept) {
            expect(obtainDiplomaticRelation(ai, player).type).toBe(DiplomaticRelationType.SubjugatedDominion);
            expect(obtainDiplomaticRelation(ai, player).initiator).toBe(player);
            expect(player.empiresViewable).toContain(ai);
        }
    });
});

describe('dialog texts (DialogSet.cs)', () => {
    const dir = resolve(__dirname, '../public/assets/dwu/dialog');
    it('base dialog + race override', () => {
        const set = new DialogSet(readFileSync(resolve(dir, 'base_dialog.txt'), 'latin1'));
        expect(set.resolveDialog('FREETRADE_ACCEPT')).toBe('We gladly accept your offer of a Free Trade Agreement!');
        expect(set.resolveDialog('WAR_END')).toBe('We propose an end to this pointless war.\n\nWhat do you say?');
        set.addRace('Zenox', readFileSync(resolve(dir, raceDialogFileName('Zenox')), 'latin1'));
        expect(set.resolveDialog('GIFT_THANKS', 'Zenox')).toBe(parseDialogFile(readFileSync(resolve(dir, 'zenox.txt'), 'latin1')).get('GIFT_THANKS') ?? set.resolveDialog('GIFT_THANKS'));
        expect(set.resolveDialog('GIFT_THANKS', 'Nobody')).toBe('Thank you for your kind gift');
    });
    it('unknown codes and comments are skipped; first definition wins', () => {
        const l = parseDialogFile("' comment\nNOT_A_PART ;x\nGIFT_THANKS ;one\nGIFT_THANKS ;two\n");
        expect([...l.entries()]).toEqual([['GIFT_THANKS', 'one']]);
    });
});

describe('screen helpers ([proposals] in diplomacyScreen / messagePopups)', () => {
    it('groups the options under their greeting-menu entry and formats the reply', async () => {
        const { proposalGroups, proposalReplyText } = await import('../src/ui/screens/diplomacyScreen');
        setRelation(player, ai, DiplomaticRelationType.None);
        const groups = proposalGroups(listProposals(galaxy, player, ai));
        expect(groups.map((g) => g.label)).toEqual(['Change relationship', 'Send a gift', 'Send a warning', 'Swap maps or tech', 'Negotiate a trade proposal...']);
        const set = new DialogSet('WARNING_REMOVEFORCESSYSTEM_RESPONSE_REFUSE ;Our ships are leaving the {0} system.\n');
        const res = { ok: true, accepted: false, message: 'WARNING_REMOVEFORCESSYSTEM_RESPONSE_REFUSE', reply: 'WARNING_REMOVEFORCESSYSTEM_RESPONSE_REFUSE' as const, replyArgs: ['Sol'], followUps: [], expireMessagesFor: null, automationPrompt: false, trade: null };
        expect(proposalReplyText(set, res, 'Human')).toBe('Our ships are leaving the Sol system.');
        expect(proposalReplyText(null, { ...res, ok: false, reply: null, message: 'No longer on offer' }, 'Human')).toBe('No longer on offer');
    });

    it('ExpireDiplomacyMessagesForEmpire drops only that sender\'s diplomacy messages', async () => {
        const { expireDiplomacyMessagesForEmpire } = await import('../src/ui/messagePopups');
        const { EmpireMessage, EmpireMessageType } = await import('../src/sim/messages');
        const other = galaxy.empires.find((e) => e !== player && e !== ai)!;
        const mk = (sender: Empire, t: number) => ({ message: new EmpireMessage(sender, t, null), conversation: 'WAR_DECLARE' as const, sender });
        const queue = [mk(ai, EmpireMessageType.ProposeDiplomaticRelation), mk(other, EmpireMessageType.DiplomaticRelationChange), mk(ai, EmpireMessageType.GiveGift), mk(ai, EmpireMessageType.OfferTrade)];
        expect(expireDiplomacyMessagesForEmpire(queue, ai)).toBe(2);
        expect(queue.map((e) => [e.sender, e.message.messageType])).toEqual([[other, EmpireMessageType.DiplomaticRelationChange], [ai, EmpireMessageType.GiveGift]]);
    });
});
