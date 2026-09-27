import { describe, expect, it } from 'vitest';
import {
    civilityDescription,
    declineProposal,
    diplomacyRows,
    feelingDescription,
    filterDiplomacyRows,
    formatSigned,
    isProposalValid,
    proposalLabel,
    relationDescription,
    relationshipFactors,
    relationTypeLabel,
} from '../src/ui/screens/diplomacyScreen';
import {
    DiplomaticRelation,
    DiplomaticRelationList,
    DiplomaticRelationType,
    DiplomaticStrategy,
    EmpireEvaluation,
} from '../src/sim/diplomacy';
import { EmpireMessage, EmpireMessageType } from '../src/sim/messages';
import { isKeyActionAvailable } from '../src/ui/keyboard';
import type { Empire } from '../src/sim/empire';
import type { Galaxy } from '../src/sim/galaxy';

// The panel's DOM needs a browser (jsdom is not configured), so this tests
// only the pure row / label logic (task 15a). Empire ids start at 1:
// DiplomaticRelationList.byEmpire indexes by empireId - 1.

const galaxy = { aggressionLevel: 1, independentEmpire: null, scenario: null } as unknown as Galaxy;
function fake(id: number, name: string, extra: Record<string, unknown> = {}): Empire {
    const proposed = new DiplomaticRelationList();
    proposed.invertEmpireIndexing = true;
    return {
        empireId: id, name, active: true, galaxy, mainColor: 0x112233, pirateEmpireBaseHabitat: null,
        civilityRating: 0, relativeEmpireSize: 1, governmentId: -1, diplomaticRelations: new DiplomaticRelationList(),
        proposedDiplomaticRelations: proposed, empireEvaluations: [], messages: [], ...extra,
    } as unknown as Empire;
}

function evalOf(other: Empire, player: Empire, g: Galaxy = galaxy): EmpireEvaluation {
    const ev = new EmpireEvaluation(player, g);
    (other.empireEvaluations as EmpireEvaluation[]).push(ev);
    return ev;
}

describe('relation labels (task 15a)', () => {
    it('relationTypeLabel', () => {
        expect(relationTypeLabel(DiplomaticRelationType.None)).toBe('No relationship');
        expect(relationTypeLabel(DiplomaticRelationType.NotMet)).toBe('Not Met');
        expect(relationTypeLabel(DiplomaticRelationType.War)).toBe('War');
    });

    it('relationDescription suffixes', () => {
        const player = fake(10, 'Player');
        const other = fake(1, 'Other');
        const prot = new DiplomaticRelation(DiplomaticRelationType.Protectorate, player, player, other, false);
        expect(relationDescription(prot, player)).toBe('Protectorate (We protect them)');
        prot.initiator = other;
        expect(relationDescription(prot, player)).toBe('Protectorate (They protect us)');
        const sub = new DiplomaticRelation(DiplomaticRelationType.SubjugatedDominion, other, player, other, false);
        expect(relationDescription(sub, player)).toBe('Subjugated Dominion (They subjugate us)');
    });

    it('feelingDescription', () => {
        const cases: [number, string][] = [
            [-45, 'Furious'], [-44, 'Angry'], [-5, 'Annoyed'], [-4, 'Cautious'],
            [7, 'Cautious'], [8, 'Pleased'], [21, 'Friendly'], [45, 'Delighted'],
        ];
        for (const [v, s] of cases) expect(feelingDescription(v)).toBe(s);
    });

    it('civilityDescription', () => {
        expect(civilityDescription(-51)).toBe('Diabolical');
        expect(civilityDescription(-30)).toBe('Evil');
        expect(civilityDescription(0)).toBe('Satisfactory');
        expect(civilityDescription(4)).toBe('Satisfactory');
        expect(civilityDescription(23)).toBe('Heroic');
    });

    it('formatSigned', () => {
        expect(formatSigned(12)).toBe('+12');
        expect(formatSigned(-3)).toBe('-3');
        expect(formatSigned(0)).toBe('0');
        expect(formatSigned(2.5)).toBe('+3');
        expect(formatSigned(-2.5)).toBe('-3');
    });
});

describe('relationshipFactors (task 15a)', () => {
    const penalty = 'Our ignorance of your strange alien ways causes us to distrust you';

    it('fresh evaluation: first-contact penalty only', () => {
        const player = fake(10, 'Player');
        const other = fake(1, 'Other');
        evalOf(other, player);
        expect(relationshipFactors(player, other, '')).toEqual([{ value: -15, description: penalty }]);
    });

    it('trade volume sorts first, with its tier text', () => {
        const player = fake(10, 'Player');
        const other = fake(1, 'Other');
        const ev = evalOf(other, player);
        ev.tradeVolume = 10;
        expect(relationshipFactors(player, other, '')).toEqual([
            { value: 10, description: 'Our empires share a fair amount of trade' },
            { value: -15, description: penalty },
        ]);
        ev.tradeVolume = 21;
        expect(relationshipFactors(player, other, '')[0].description).toBe('Our empires generate a colossal amount of trade');
        ev.tradeVolume = 6;
        expect(relationshipFactors(player, other, '')[0].description).toBe('Our empires share a small volume of trade');
    });

    it('government style names the player government', () => {
        const player = fake(10, 'Player');
        const other = fake(1, 'Other');
        const ev = evalOf(other, player);
        ev.governmentStyleAffinityCumulative = 4;
        const f = relationshipFactors(player, other, 'Democracy');
        expect(f.map((x) => x.description)).toContain('We like your style of government (Democracy)');
    });

    it('scales with aggression level', () => {
        const g2 = { aggressionLevel: 2, independentEmpire: null } as unknown as Galaxy;
        const player = fake(10, 'Player', { galaxy: g2 });
        const other = fake(1, 'Other');
        const ev = evalOf(other, player, g2);
        expect(ev.firstContactPenalty).toBe(-30);
        ev.tradeVolume = 10;
        expect(relationshipFactors(player, other, '')).toEqual([
            { value: 5, description: 'Our empires share a fair amount of trade' },
            { value: -60, description: penalty },
        ]);
    });

    it('pirates and missing evaluations give no factors', () => {
        const player = fake(10, 'Player');
        const pirate = fake(1, 'Pirate', { pirateEmpireBaseHabitat: {} });
        evalOf(pirate, player);
        expect(relationshipFactors(player, pirate, '')).toEqual([]);
        expect(relationshipFactors(player, fake(2, 'Other'), '')).toEqual([]);
    });
});

describe('isProposalValid / proposalLabel (task 15a)', () => {
    it('expires after TreatyOfferValidYears and follows their strategy', () => {
        const player = fake(10, 'Player');
        const other = fake(1, 'Other');
        const proposal = new DiplomaticRelation(DiplomaticRelationType.FreeTradeAgreement, other, other, player, false);
        proposal.lastDiplomacyTradeOfferDate = 1000;
        const theirs = new DiplomaticRelation(DiplomaticRelationType.None, other, other, player, false);
        theirs.strategy = DiplomaticStrategy.Befriend;
        other.diplomaticRelations.add(theirs);
        expect(isProposalValid(proposal, other, player, 1000 + 120000)).toBe(true);
        expect(isProposalValid(proposal, other, player, 1000 + 120001)).toBe(false);
        theirs.strategy = DiplomaticStrategy.Conquer;
        expect(isProposalValid(proposal, other, player, 1000)).toBe(false);
    });

    it('no relation: treated as NotMet / Undefined', () => {
        const player = fake(10, 'Player');
        const other = fake(1, 'Other');
        const ft = new DiplomaticRelation(DiplomaticRelationType.FreeTradeAgreement, other, other, player, false);
        const none = new DiplomaticRelation(DiplomaticRelationType.None, other, other, player, false);
        expect(isProposalValid(ft, other, player, 0)).toBe(false);
        expect(isProposalValid(none, other, player, 0)).toBe(true);
    });

    it('proposalLabel', () => {
        const player = fake(10, 'Player');
        const other = fake(1, 'Other');
        const rel = (t: DiplomaticRelationType, initiator: Empire = other) =>
            new DiplomaticRelation(t, initiator, player, other, false);
        expect(proposalLabel(DiplomaticRelationType.None, rel(DiplomaticRelationType.War), player)).toBe('Ending War');
        expect(proposalLabel(DiplomaticRelationType.None, rel(DiplomaticRelationType.TradeSanctions), player)).toBe('Lifting Trade Sanctions');
        expect(proposalLabel(DiplomaticRelationType.None, rel(DiplomaticRelationType.SubjugatedDominion, player), player)).toBe(
            'Request release from Subjugation',
        );
        expect(proposalLabel(DiplomaticRelationType.MutualDefensePact, rel(DiplomaticRelationType.War), player)).toBe('Mutual Defense Pact');
        expect(proposalLabel(DiplomaticRelationType.None, rel(DiplomaticRelationType.None), player)).toBe('');
    });
});

describe('diplomacyRows (task 15a)', () => {
    function setup() {
        const player = fake(10, 'Player');
        const a = fake(1, 'Zeta');
        const b = fake(2, 'Alpha');
        const c = fake(3, 'Unmet');
        const relA = new DiplomaticRelation(DiplomaticRelationType.FreeTradeAgreement, player, player, a, false);
        const relB = new DiplomaticRelation(DiplomaticRelationType.War, b, player, b, false);
        const relC = new DiplomaticRelation(DiplomaticRelationType.NotMet, player, player, c, false);
        player.diplomaticRelations.add(relA);
        player.diplomaticRelations.add(relB);
        player.diplomaticRelations.add(relC);
        return { player, a, b, c, relA, relB };
    }

    function addIncomingFromB(player: Empire, b: Empire): void {
        const theirs = new DiplomaticRelation(DiplomaticRelationType.War, b, b, player, false);
        theirs.strategy = DiplomaticStrategy.Placate;
        b.diplomaticRelations.add(theirs);
        player.proposedDiplomaticRelations.add(new DiplomaticRelation(DiplomaticRelationType.None, b, b, player, 0, false));
    }

    it('lists met empires sorted by name, with colours and feelings', () => {
        const { player, a } = setup();
        const ev = evalOf(a, player);
        ev.tradeVolume = 10;
        const rows = diplomacyRows(player, 0, '');
        expect(rows.map((r) => r.name)).toEqual(['Alpha', 'Zeta']);
        const rowA = rows[1];
        expect(rowA.relationColor).toBe(0x00ff00);
        expect(rowA.attitude).toBe(-5);
        expect(rowA.feeling).toBe('Annoyed with us (-5)');
        expect(rows[0].attitude).toBeNull();
        expect(rows[0].feeling).toBe('');
    });

    it('incoming offer with its message, outgoing offer, treaties', () => {
        const { player, a, b, relA } = setup();
        addIncomingFromB(player, b);
        const msg = new EmpireMessage(b, EmpireMessageType.ProposeDiplomaticRelation, DiplomaticRelationType.None);
        msg.description = 'Let us end this war';
        (player.messages as EmpireMessage[]).push(msg);
        a.proposedDiplomaticRelations.add(
            new DiplomaticRelation(DiplomaticRelationType.MutualDefensePact, player, player, a, 0, false),
        );
        relA.militaryRefuelingToOther = true;

        const rows = diplomacyRows(player, 0, '');
        const rowB = rows.find((r) => r.empire === b)!;
        const rowA = rows.find((r) => r.empire === a)!;
        expect(rowB.incoming).not.toBeNull();
        expect(rowB.incomingText).toBe('Ending War');
        expect(rowB.incomingMessage).toBe('Let us end this war');
        expect(rowA.outgoingText).toBe('Mutual Defense Pact');
        expect(rowA.treaties).toContain('We allow them military refueling');
    });

    it('declineProposal removes the offer', () => {
        const { player, b } = setup();
        addIncomingFromB(player, b);
        expect(declineProposal(player, b)).toBe(true);
        expect(player.proposedDiplomaticRelations.byEmpire(b)).toBeNull();
        expect(declineProposal(player, b)).toBe(false);
    });

    // Task 19k-1d (Big Galaxies: 60-empire games): the panel's DOM needs a browser to render (jsdom is not
    // configured, see the file header), so a 60-empire game is exercised here as row-building at scale.
    it('builds one row per met empire in a 60-empire game (60-empire UI check)', () => {
        const player = fake(60, 'Player');
        const others = Array.from({ length: 59 }, (_, i) => fake(i + 1, `Empire ${String(i).padStart(2, '0')}`));
        for (const other of others) {
            player.diplomaticRelations.add(new DiplomaticRelation(DiplomaticRelationType.None, player, player, other, false));
        }
        const rows = diplomacyRows(player, 0, '');
        expect(rows).toHaveLength(59);
        expect(new Set(rows.map((r) => r.empire)).size).toBe(59);
    });
});

describe('filterDiplomacyRows (task 19k-1d: filter box for 60-empire games)', () => {
    function setup60() {
        const player = fake(60, 'Player');
        const others = Array.from({ length: 59 }, (_, i) => fake(i + 1, `Empire ${String(i).padStart(2, '0')}`));
        for (const other of others) {
            player.diplomaticRelations.add(new DiplomaticRelation(DiplomaticRelationType.None, player, player, other, false));
        }
        return diplomacyRows(player, 0, '');
    }

    it('keeps every row for a blank or whitespace-only query', () => {
        const rows = setup60();
        expect(filterDiplomacyRows(rows, '')).toEqual(rows);
        expect(filterDiplomacyRows(rows, '   ')).toEqual(rows);
    });

    it('matches by name, case-insensitively', () => {
        const rows = setup60();
        const filtered = filterDiplomacyRows(rows, 'empire 07');
        expect(filtered.map((r) => r.name)).toEqual(['Empire 07']);
    });

    it('returns no rows when nothing matches', () => {
        const rows = setup60();
        expect(filterDiplomacyRows(rows, 'nomatch')).toEqual([]);
    });
});

describe('keyboard (task 15a)', () => {
    it('diplomacyScreen is implemented', () => {
        expect(isKeyActionAvailable('diplomacyScreen')).toBe(true);
    });
});
