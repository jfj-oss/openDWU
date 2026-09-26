import { beforeAll, describe, expect, it } from 'vitest';
import { setGovernmentsStatic } from '../src/sim/empire';
import type { GameData } from '../src/sim/data/gameData';
import { DiplomaticRelationType, LONG_MAX_VALUE, obtainDiplomaticRelation, processRelationChange } from '../src/sim/diplomacy';
import { timeSpentAtWar } from '../src/sim/victory';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';

// Sweep 2: EmpireCounters.cs 148-218 ProcessRelationChange (the diplomacy counters; diplomacy.ts DiplomacyCounters) — the
// branches the M4r ChangeDiplomaticRelation tests do not reach.
let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
    setGovernmentsStatic(gameData.governments);
}, 60000);

describe('EmpireCounters.ProcessRelationChange', () => {
    it('subjugation counts for the initiator only; sanctions out of a defence pact break a treaty', () => {
        const { galaxy } = cachedTickGame(gameData);
        const [a, b] = galaxy.empires;
        const r = obtainDiplomaticRelation(a, b);
        r.type = DiplomaticRelationType.None;
        processRelationChange(a.diplomacyCounters, a, r, a, DiplomaticRelationType.SubjugatedDominion, 1000);
        processRelationChange(b.diplomacyCounters, b, r, a, DiplomaticRelationType.SubjugatedDominion, 1000);
        expect(a.diplomacyCounters.subjugationsMade).toBe(1);
        expect(b.diplomacyCounters.subjugationsMade).toBe(0);
        expect(a.diplomacyCounters.brokenTreatyCount).toBe(0);
        r.type = DiplomaticRelationType.MutualDefensePact;
        processRelationChange(a.diplomacyCounters, a, r, a, DiplomaticRelationType.TradeSanctions, 1000);
        expect(a.diplomacyCounters.brokenTreatyCount).toBe(1);
        // A Truce (not a treaty) ending does not count.
        r.type = DiplomaticRelationType.Truce;
        processRelationChange(a.diplomacyCounters, a, r, a, DiplomaticRelationType.War, 1000);
        expect(a.diplomacyCounters.brokenTreatyCount).toBe(1);
    });

    it('war time: the start date is kept while at war; peace adds the span only when no other war remains', () => {
        const { galaxy } = cachedTickGame(gameData);
        const [a, b, c] = galaxy.empires;
        const c0 = a.diplomacyCounters;
        const ab = obtainDiplomaticRelation(a, b);
        const ac = obtainDiplomaticRelation(a, c);
        ab.type = DiplomaticRelationType.None;
        ac.type = DiplomaticRelationType.None;
        processRelationChange(c0, a, ab, b, DiplomaticRelationType.War, 1000);
        ab.type = DiplomaticRelationType.War;
        expect(c0.warsDeclaredOnUsCount).toBe(1);
        expect(c0.atWarStartDate).toBe(1000);
        processRelationChange(c0, a, ac, a, DiplomaticRelationType.War, 2000);
        ac.type = DiplomaticRelationType.War;
        expect(c0.warsWeStartedCount).toBe(1);
        expect(c0.atWarStartDate).toBe(1000); // already at war (EmpireCounters.cs 205)
        // Peace with b while still at war with c: nothing accrues (CheckAtWar(excluding b) is true).
        processRelationChange(c0, a, ab, a, DiplomaticRelationType.None, 3000);
        ab.type = DiplomaticRelationType.None;
        expect(c0.atWarStartDate).toBe(1000);
        // Empire.3.cs 3480: previousRelationType passed explicitly as War (the relation already changed).
        ac.type = DiplomaticRelationType.None;
        processRelationChange(c0, a, ac, a, DiplomaticRelationType.None, 5000, DiplomaticRelationType.War);
        expect(c0.atWarStartDate).toBe(LONG_MAX_VALUE);
        expect(c0.timeSpentAtWarExcludingCurrent).toBe(4000);
        expect(timeSpentAtWar(c0, 9000)).toBe(4000);
    });
});
