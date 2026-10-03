import { describe, expect, it } from 'vitest';
import {
    diplomacyBackgroundColor,
    diplomacyLayout,
    pirateRelationPen,
    piratePlayStyleName,
    raceCharacteristicIntensity,
    raceCharacteristics,
    relationLine,
    tradeValueText,
} from '../src/ui/screens/diplomacyRelationsView';
import { DiplomaticRelationType } from '../src/sim/diplomacy';
import { PirateRelationType } from '../src/sim/pirateRelations';
import { PiratePlayStyle } from '../src/sim/pirates';
import type { Empire } from '../src/sim/empire';

describe('diplomacy relation strip', () => {
    it('formats the trade value like "######0K (+##0%)"', () => {
        expect(tradeValueText(0, 0)).toBe('0K');
        expect(tradeValueText(12999, 0)).toBe('12K');
        expect(tradeValueText(250000, 0.05)).toBe('250K (+5%)');
    });
    it('uses the DrawRelations pirate pens', () => {
        expect(pirateRelationPen(PirateRelationType.NotMet)).toBeNull();
        expect(pirateRelationPen(PirateRelationType.None)).toBe(0x808080);
        expect(pirateRelationPen(PirateRelationType.Protection)).toBe(0xa0a0ff);
    });
    it('draws the viewpoint relation as a line or a wedge', () => {
        const mk = (name: string): Empire =>
            ({ name, pirateEmpireBaseHabitat: null, characters: [], empireEvaluations: [], diplomaticRelations: null, pirateRelations: null }) as unknown as Empire;
        const a = mk('a');
        const b = mk('b');
        const rels = (list: object[]) => ({ byEmpire: (e: Empire) => list.find((r) => (r as { otherEmpire: Empire }).otherEmpire === e) ?? null, getHighestAllianceName: () => '' });
        const ab = { type: DiplomaticRelationType.War, otherEmpire: b, thisEmpire: a, initiator: a, normalizedAnnualTradeValue: 3000, tradeBonus: 0, militaryRefuelingToOther: true, miningRightsToOther: false };
        (a as { diplomaticRelations: unknown }).diplomaticRelations = rels([ab]);
        (b as { diplomaticRelations: unknown }).diplomaticRelations = rels([]);
        let l = relationLine(a, b, a);
        expect(l.color).toBe(0xff0000);
        expect(l.shape).toBe('line');
        expect(l.trade).toBe('3K');
        expect(l.refuelFromViewpoint).toBe(true);
        expect(l.refuelToViewpoint).toBe(false);
        ab.type = DiplomaticRelationType.Protectorate;
        l = relationLine(a, b, a);
        expect(l.shape).toBe('wedge-out');
        ab.initiator = b;
        expect(relationLine(a, b, a).shape).toBe('wedge-in');
        // No relation from the viewpoint (e.g. the row is the viewpoint itself): nothing drawn.
        expect(relationLine(b, a, a).color).toBeNull();
    });
});

describe('diplomacy detail', () => {
    it('has the two original sizes', () => {
        expect(diplomacyLayout(false).window).toEqual({ w: 1040, h: 760 });
        expect(diplomacyLayout(true).window).toEqual({ w: 1180, h: 900 });
        expect(diplomacyLayout(true).column.x).toBe(960);
        expect(diplomacyLayout(false).column.x).toBe(820);
    });
    it('describes the race like ResolveRaceCharacteristics', () => {
        expect(raceCharacteristicIntensity(100)).toBe('Slightly');
        expect(raceCharacteristicIntensity(94)).toBe('Quite');
        expect(raceCharacteristicIntensity(117)).toBe('Very');
        expect(raceCharacteristicIntensity(70)).toBe('Extremely');
        expect(raceCharacteristics({ aggression: 120, caution: 90, friendliness: 100, intelligence: 60, loyalty: 106 })).toEqual([
            'Very Aggressive',
            'Quite Reckless',
            'Slightly Friendly',
            'Extremely Stupid',
            'Quite Dependable',
        ]);
    });
    it('halves the main colour for the panel background and names the pirate playstyles', () => {
        expect(diplomacyBackgroundColor(0xff8040)).toBe(0x7f4020);
        expect(piratePlayStyleName(PiratePlayStyle.Pirate)).toBe('Raider');
        expect(piratePlayStyleName(PiratePlayStyle.Balanced)).toBe('Balanced');
    });
});
