// Diplomacy screen: pirate factions in the list (DiplomaticRelationListView.cs:164-176), the All / Empires / Pirates and
// government filters, and the protection price shown per month and per year.

import { beforeAll, describe, expect, it } from 'vitest';
import {
    PIRATE_RELATION_COLORS,
    diplomacyRows,
    filterDiplomacyRows,
    filterDiplomacyRowsByKind,
    governmentFilterOptions,
    governmentLabel,
    pirateRelationText,
} from '../src/ui/screens/diplomacyScreen';
import { DiplomaticRelation, DiplomaticRelationList, DiplomaticRelationType } from '../src/sim/diplomacy';
import { PirateRelation, PirateRelationType, obtainPirateRelation } from '../src/sim/pirateRelations';
import { pirateProtectionPricePerYear, pirateProtectionPriceText, pirateProtectionYearlySuffix, pirateOfferMonthlyPrice } from '../src/ui/pirateProtectionPrice';
import { pirateOfferPriceLine, conversationActions } from '../src/ui/conversationActions';
import { EmpireMessage, EmpireMessageType } from '../src/sim/messages';
import { listProposals, submitProposal } from '../src/sim/player/diplomacyProposals';
import { calculatePirateProtectionPricePerMonth } from '../src/sim/pirates/pirateRelationsAI';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import { getGovernmentsStatic } from '../src/sim/empire';
import type { GameData } from '../src/sim/data/gameData';
import type { Empire } from '../src/sim/empire';
import type { Galaxy } from '../src/sim/galaxy';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

const galaxy = { aggressionLevel: 1, independentEmpire: null, scenario: null } as unknown as Galaxy;
function fake(id: number, name: string, extra: Record<string, unknown> = {}): Empire {
    const proposed = new DiplomaticRelationList();
    proposed.invertEmpireIndexing = true;
    return {
        empireId: id, name, active: true, galaxy, mainColor: 0x112233, pirateEmpireBaseHabitat: null,
        civilityRating: 0, relativeEmpireSize: 1, governmentId: -1, diplomaticRelations: new DiplomaticRelationList(),
        proposedDiplomaticRelations: proposed, empireEvaluations: [], messages: [], pirateRelations: undefined, ...extra,
    } as unknown as Empire;
}
function withPirateRelations(e: Empire, rels: PirateRelation[]): Empire {
    // A minimal iterable + lookup, the shape of PirateRelationList the rows read.
    (e as unknown as { pirateRelations: unknown }).pirateRelations = {
        [Symbol.iterator]: () => rels[Symbol.iterator](),
        getRelationByOtherEmpire: (o: Empire) => rels.find((r) => r.otherEmpire === o) ?? null,
    };
    return e;
}

describe('pirate factions in the diplomacy list', () => {
    function setup() {
        const player = fake(10, 'Player');
        const a = fake(1, 'Alpha', { governmentId: 4 });
        const b = fake(2, 'Beta', { governmentId: 7 });
        const unmetPirate = fake(3, 'Hidden Raiders', { pirateEmpireBaseHabitat: {} });
        const metPirate = fake(4, 'Black Fleet', { pirateEmpireBaseHabitat: {} });
        const protectedPirate = fake(5, 'Red Corsairs', { pirateEmpireBaseHabitat: {}, pirateEmpireSuperPirates: false });
        player.diplomaticRelations.add(new DiplomaticRelation(DiplomaticRelationType.None, player, player, a, false));
        player.diplomaticRelations.add(new DiplomaticRelation(DiplomaticRelationType.War, player, player, b, false));
        const prNotMet = new PirateRelation(player, unmetPirate, PirateRelationType.NotMet);
        const prNone = new PirateRelation(player, metPirate, PirateRelationType.None);
        const prProt = new PirateRelation(player, protectedPirate, PirateRelationType.Protection);
        withPirateRelations(player, [prNotMet, prNone, prProt]);
        // ChangePirateRelation stores the fee on the pirate's side of the pair.
        const feeRel = new PirateRelation(protectedPirate, player, PirateRelationType.Protection);
        feeRel.monthlyProtectionFeeToThisEmpire = 1500;
        withPirateRelations(protectedPirate, [feeRel]);
        return { player, a, b, unmetPirate, metPirate, protectedPirate };
    }

    it('lists met pirate factions with empires, not unmet ones', () => {
        const { player, metPirate, protectedPirate, unmetPirate } = setup();
        const rows = diplomacyRows(player, 0, '');
        expect(rows.map((r) => r.name)).toEqual(['Alpha', 'Beta', 'Black Fleet', 'Red Corsairs']);
        expect(rows.find((r) => r.empire === unmetPirate)).toBeUndefined();
        expect(rows.find((r) => r.empire === metPirate)!.isPirate).toBe(true);
        expect(rows.find((r) => r.empire === protectedPirate)!.pirateRelationType).toBe(PirateRelationType.Protection);
    });

    it('an active protection agreement shows its price per month and per year on the relation row', () => {
        const { player, protectedPirate, metPirate } = setup();
        const rows = diplomacyRows(player, 0, '');
        const prot = rows.find((r) => r.empire === protectedPirate)!;
        expect(prot.protectionFeePerMonth).toBe(1500);
        expect(prot.relationText).toContain('1,500 credits per month');
        expect(prot.relationText).toContain('18,000 per year');
        expect(prot.relationColor).toBe(PIRATE_RELATION_COLORS[PirateRelationType.Protection]);
        expect(rows.find((r) => r.empire === metPirate)!.relationText).toBe('No pirate agreement');
    });

    it('All / Empires / Pirates filter', () => {
        const rows = diplomacyRows(setup().player, 0, '');
        expect(filterDiplomacyRowsByKind(rows, 'all', '').map((r) => r.name)).toHaveLength(4);
        expect(filterDiplomacyRowsByKind(rows, 'empires', '').map((r) => r.name)).toEqual(['Alpha', 'Beta']);
        expect(filterDiplomacyRowsByKind(rows, 'pirates', '').map((r) => r.name)).toEqual(['Black Fleet', 'Red Corsairs']);
    });

    it('government filter picks the chosen government type (governments.txt names), pirates file under Pirate faction', () => {
        cachedTickGame(gameData); // loads the governments table (Galaxy.GovernmentsStatic)
        const rows = diplomacyRows(setup().player, 0, '');
        const govs = getGovernmentsStatic();
        expect(governmentLabel(rows.find((r) => r.name === 'Alpha')!)).toBe(govs[4]!.name);
        expect(governmentLabel(rows.find((r) => r.name === 'Beta')!)).toBe(govs[7]!.name);
        expect(governmentFilterOptions(rows)).toEqual([govs[4]!.name, govs[7]!.name, 'Pirate faction'].sort((x, y) => x.localeCompare(y)));
        expect(filterDiplomacyRowsByKind(rows, 'all', govs[7]!.name).map((r) => r.name)).toEqual(['Beta']);
        expect(filterDiplomacyRowsByKind(rows, 'all', 'Pirate faction').map((r) => r.name)).toEqual(['Black Fleet', 'Red Corsairs']);
        // Combines with the name box.
        expect(filterDiplomacyRows(filterDiplomacyRowsByKind(rows, 'pirates', 'Pirate faction'), 'red').map((r) => r.name)).toEqual(['Red Corsairs']);
    });

    it('pirateRelationText', () => {
        expect(pirateRelationText(PirateRelationType.Protection, 0)).toBe('Pirate truce (free protection)');
        expect(pirateRelationText(PirateRelationType.None, 0)).toBe('No pirate agreement');
    });
});

describe('protection price per month and per year', () => {
    it('is the monthly price x 12', () => {
        expect(pirateProtectionPricePerYear(1000)).toBe(12000);
        expect(pirateProtectionPriceText(1234)).toBe('1,234 credits per month (14,808 per year)');
        expect(pirateProtectionYearlySuffix(1000)).toBe(' (12,000 per year)');
        expect(pirateProtectionYearlySuffix(0)).toBe('');
    });

    it('the offer dialog names both prices; a free truce names none', () => {
        const player = fake(2, 'Player');
        const pirate = fake(1, 'Pirates');
        const msg = new EmpireMessage(pirate, EmpireMessageType.PirateOfferProtection, null);
        msg.money = 5000;
        const ctx = { player, galaxy: null };
        expect(pirateOfferPriceLine({ message: msg, conversation: 'PIRATE_PROTECTIONPROPOSEINITIATE', sender: pirate }, ctx)).toBe('Price: 5,000 credits per month (60,000 per year)');
        expect(pirateOfferPriceLine({ message: msg, conversation: 'PIRATE_TRUCEPROPOSEINITIATE', sender: pirate }, ctx)).toBe('');
        const acts = conversationActions({ message: msg, conversation: 'PIRATE_PROTECTIONPROPOSEINITIATE', sender: pirate }, { player, galaxy: null, answerable: false, pirateOffer: true });
        expect(acts[0].label).toContain('5,000');
        expect(acts[0].label).toContain('(60,000 per year)');
    });

    it('falls back to the message money without a pirate relation to price from', () => {
        const pirate = fake(1, 'Pirates', { pirateEmpireBaseHabitat: {} });
        expect(pirateOfferMonthlyPrice({} as Galaxy, pirate, fake(2, 'P'), 777)).toBe(777);
    });
});

describe('a non-pirate player speaking with a pirate faction (Main.Part9.cs:191-206)', () => {
    it('requests protection at the fresh price, then accepts; the fee is stored and paid', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const player = game.playerEmpire;
        const pirate = g.pirateEmpires.find((p) => !p.pirateEmpireSuperPirates)!;
        expect(pirate).toBeDefined();
        // Unmet: nothing to speak with. Then meet it (pirate relation None, as when its ships / base are seen).
        const rel = obtainPirateRelation(player, pirate);
        const prior = rel.type;
        rel.type = PirateRelationType.NotMet;
        expect(listProposals(g, player, pirate)).toEqual([]);
        expect(submitProposal(g, player, pirate, 'PIRATE_PROTECTIONPROPOSE').ok).toBe(false);
        rel.type = prior === PirateRelationType.NotMet ? PirateRelationType.None : prior;
        if (rel.type === PirateRelationType.Protection) rel.type = PirateRelationType.None;
        const rel2 = obtainPirateRelation(pirate, player);
        rel2.type = rel.type;
        const opts = listProposals(g, player, pirate);
        expect(opts.map((o) => o.id)).toEqual(['PIRATE_PROTECTIONPROPOSE', 'PIRATE_BUYINFO']);
        const price = calculatePirateProtectionPricePerMonth(g, pirate, player).price;
        const r = submitProposal(g, player, pirate, 'PIRATE_PROTECTIONPROPOSE');
        expect(r.ok).toBe(true);
        expect(r.reply).toBe('PIRATE_PROTECTIONPROPOSE');
        const accept = r.followUps[0];
        expect(accept.id).toBe(price > 0 ? 'PIRATE_PROTECTIONACCEPTRESPONSE' : 'PIRATE_TRUCEACCEPTRESPONSE');
        expect(accept.cost).toBe(price);
        player.stateMoney = Math.max(player.stateMoney, price + 1000);
        const before = player.stateMoney;
        const done = submitProposal(g, player, pirate, accept.id);
        expect(done.accepted).toBe(true);
        expect(player.pirateRelations.getRelationByOtherEmpire(pirate)!.type).toBe(PirateRelationType.Protection);
        expect(player.stateMoney).toBe(before - price);
        expect(pirate.pirateRelations.getRelationByOtherEmpire(player)!.monthlyProtectionFeeToThisEmpire).toBe(price);
        // Once in force, the only option is to cancel; a second accept is "already paid".
        expect(listProposals(g, player, pirate).map((o) => o.id)).toEqual(['CANCELPIRATEPROTECTION', 'PIRATE_BUYINFO']);
        expect(submitProposal(g, player, pirate, accept.id).reply).toBe('PIRATE_PROTECTIONALREADYPAID');
    }, 300000);

    it('super pirates offer nothing; an unmet pirate cannot be spoken to', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const player = game.playerEmpire;
        const pirate = g.pirateEmpires[0];
        const orig = pirate.pirateEmpireSuperPirates;
        pirate.pirateEmpireSuperPirates = true;
        expect(listProposals(g, player, pirate)).toEqual([]);
        pirate.pirateEmpireSuperPirates = orig;
    }, 300000);
});
