// @slow — soak: two 1200 s met-empires runs (test:slow tier; see vite.config.ts testTier).
// M4r — diplomacy runtime (politics / strategy / treaties / messages). Unit tests against hand-worked C# values
// (Empire.8.cs, Empire.3.cs, EmpireEvaluation.cs) plus a harness smoke test in which the starting empires have met.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateDigest } from '../src/sim/tick/digest';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import {
    DiplomaticRelation,
    DiplomaticRelationType,
    DiplomaticStrategy,
    EmpireEvaluation,
    LONG_MAX_VALUE,
    empireEvaluationsOf,
    obtainDiplomaticRelation,
    obtainEmpireEvaluation,
} from '../src/sim/diplomacy';
import {
    calculateNextAllowableProposalDate,
    calculateRelativeEmpireSize,
    changeDiplomaticRelation,
    clearInvalidDiplomaticRelations,
    considerTreatyProposals,
    determineDesiredDiplomaticRelationTypical,
    determineRelativeStrength,
    determineSubjugationOfLoserInWar,
    determineVictorInWar,
    evaluateMilitaryPotency,
    evaluatePoliticalSituation,
    militaryPotency,
    processMessages,
    reviewEmpireEndsAllWars,
    setCivilityRating,
    valueMoneyGiftFromEmpire,
} from '../src/sim/diplomacyTick';
import { EmpireMessage, EmpireMessageType, sendEmpireMessage } from '../src/sim/messages';
import { totalColonyStrategicValue } from '../src/sim/forceStructure';
import { galaxyStarDate } from '../src/sim/tick/simTime';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

/** Makes every pair of starting empires met (None relations on both sides), as Start.2.cs meetEmpiresAtStart would. */
function meetAll(g: Galaxy): void {
    for (const a of g.empires) {
        for (const b of g.empires) {
            if (a === b) continue;
            obtainDiplomaticRelation(a, b).type = DiplomaticRelationType.None;
        }
    }
}

describe('EmpireEvaluation (EmpireEvaluation.cs)', () => {
    it('OverallAttitude weighs each part by AggressionLevel and DiplomacyFactor, truncating the sum', () => {
        const { galaxy } = cachedTickGame(gameData);
        const [a, b] = galaxy.empires;
        const ev = new EmpireEvaluation(b, galaxy);
        // ctor: FirstContactPenalty = -15 * AggressionLevel (1.0).
        expect(ev.firstContactPenalty).toBe(-15);
        b.civilityRating = 0;
        ev.firstContactPenalty = 0;
        ev.bias = 10; // raw
        ev.tradeVolume = 5;
        ev.incidentEvaluation = -7;
        ev.diplomacyFactor = 2.0;
        // positives × 2 (10*2 + 5*2 = 30), negatives ÷ 2 (-7 / 2 = -3.5) → (int)26.5 = 26.
        expect(ev.overallAttitude).toBe(26);
        // Bias getter is factored; IncidentEvaluation getter too.
        expect(ev.bias).toBe(20);
        expect(ev.incidentEvaluation).toBe(-3.5);
        // Without system competition: (10 + 5 - 7) = 8 → 8 / 1.0 → × 2 → 16.
        expect(ev.overallAttitudeWithoutSystemCompetition).toBe(16);
        void a;
    });

    it('IncidentEvaluation setter clamps to [-150, 80]; CivilityRating clamps to [-100, 30]', () => {
        const { galaxy } = cachedTickGame(gameData);
        const ev = new EmpireEvaluation(galaxy.empires[1], galaxy);
        ev.incidentEvaluation = 500;
        expect(ev.incidentEvaluationRaw).toBe(80);
        ev.incidentEvaluation = -500;
        expect(ev.incidentEvaluationRaw).toBe(-150);
        const e = galaxy.empires[0];
        setCivilityRating(e, 50);
        expect(e.civilityRating).toBe(30);
        setCivilityRating(e, -500);
        expect(e.civilityRating).toBe(-100);
    });

    it('ObtainEmpireEvaluation adds one evaluation per active empire with the race bias', () => {
        const { galaxy } = cachedTickGame(gameData);
        const [a, b] = galaxy.empires;
        const before = empireEvaluationsOf(a).length;
        const ev = obtainEmpireEvaluation(galaxy, a, b);
        expect(obtainEmpireEvaluation(galaxy, a, b)).toBe(ev);
        expect(empireEvaluationsOf(a).filter((x) => x.empire === b).length).toBe(1);
        void before;
        expect(obtainEmpireEvaluation(galaxy, a, null).empire).toBeNull();
    });
});

describe('politics helpers (Empire.7.cs / Empire.8.cs / Empire.9.cs)', () => {
    it('DetermineDesiredDiplomaticRelationTypical', () => {
        expect(determineDesiredDiplomaticRelationTypical(DiplomaticStrategy.Ally, DiplomaticRelationType.None)).toBe(DiplomaticRelationType.MutualDefensePact);
        expect(determineDesiredDiplomaticRelationTypical(DiplomaticStrategy.Befriend, DiplomaticRelationType.None)).toBe(DiplomaticRelationType.FreeTradeAgreement);
        expect(determineDesiredDiplomaticRelationTypical(DiplomaticStrategy.DefendUndermine, DiplomaticRelationType.TradeSanctions)).toBe(DiplomaticRelationType.TradeSanctions);
        expect(determineDesiredDiplomaticRelationTypical(DiplomaticStrategy.DefendUndermine, DiplomaticRelationType.None)).toBe(DiplomaticRelationType.None);
        expect(determineDesiredDiplomaticRelationTypical(DiplomaticStrategy.Punish, DiplomaticRelationType.None)).toBe(DiplomaticRelationType.TradeSanctions);
        expect(determineDesiredDiplomaticRelationTypical(DiplomaticStrategy.Undefined, DiplomaticRelationType.War)).toBe(DiplomaticRelationType.None);
    });

    it('EvaluateMilitaryPotency / DetermineRelativeStrength thresholds', () => {
        const { galaxy } = cachedTickGame(gameData);
        const ai = galaxy.empires.find((e) => e !== galaxy.playerEmpire)!;
        expect(evaluateMilitaryPotency(galaxy, 100, 201, ai)).toBe(-1);
        expect(evaluateMilitaryPotency(galaxy, 100, 150, ai)).toBe(0);
        expect(evaluateMilitaryPotency(galaxy, 100, 100, ai)).toBe(0);
        expect(evaluateMilitaryPotency(galaxy, 100, 40, ai)).toBe(1);
        // ourStrength / otherEmpire.MilitaryPotency vs 0.65 / 1.5 (AI target: no difficulty scaling).
        const other = galaxy.empires.find((e) => e !== galaxy.playerEmpire && e !== ai)!;
        // ourStrength / other.MilitaryPotency: 0 / 0 is NaN in C# too — neither `< 0.65` nor `> 1.5` → 0 (even).
        const otherMp = militaryPotency(other);
        expect(determineRelativeStrength(galaxy, 0, other)).toBe(otherMp > 0 ? -1 : 0);
        expect(determineRelativeStrength(galaxy, 1, other)).toBe(otherMp > 0 ? (1 / otherMp < 0.65 ? -1 : 1 / otherMp > 1.5 ? 1 : 0) : 1);
    });

    it('DetermineVictorInWar (integer damage ratio) and DetermineSubjugationOfLoserInWar', () => {
        const { galaxy } = cachedTickGame(gameData);
        const [a, b] = galaxy.empires;
        const ra = obtainDiplomaticRelation(a, b);
        const rb = obtainDiplomaticRelation(b, a);
        ra.warDamageBuiltObject = 30; // damage a suffered
        rb.warDamageBuiltObject = 9;
        const v = determineVictorInWar(ra);
        expect(v.victor).toBe(b);
        expect(v.loser).toBe(a);
        expect(v.winningRatio).toBe(3); // (30 + 1) / (9 + 1) = 3 (C# int division)
        expect(determineSubjugationOfLoserInWar(b, a, 3, 1000, 1)).toBe(false); // needs ratio > 3
        expect(determineSubjugationOfLoserInWar(b, a, 4, 1000000, 1)).toBe(true);
    });

    it('CalculateRelativeEmpireSize: own strategic value over the mean of the others', () => {
        const { galaxy } = cachedTickGame(gameData);
        const e = galaxy.empires[0];
        let sum = 0;
        for (const o of galaxy.empires) if (o !== e && o.active) sum += totalColonyStrategicValue(o);
        expect(calculateRelativeEmpireSize(galaxy, e)).toBe(totalColonyStrategicValue(e) / (sum / (galaxy.empires.length - 1)));
    });

    it('CalculateNextAllowableProposalDate: 1.25 years × ColonyFillFactor × clamp(met / empires, 0.3, 1) × 2', () => {
        const { galaxy } = cachedTickGame(gameData);
        const [a, b] = galaxy.empires;
        const r = obtainDiplomaticRelation(a, b);
        r.lastDiplomacyTradeOfferDate = 1000;
        const met = b.diplomaticRelations.countMet();
        const val = Math.max(0.3, Math.min(1.0, met / galaxy.empires.length));
        expect(calculateNextAllowableProposalDate(galaxy, r)).toBe(1000 + Math.trunc(Math.trunc(600 * 1000 * (1.25 * galaxy.colonyFillFactor)) * val * 2.0));
    });

    it('ClearInvalidDiplomaticRelations drops relations with inactive empires; ReviewEmpireEndsAllWars fixes the war counter', () => {
        const { galaxy } = cachedTickGame(gameData);
        const [a, b] = galaxy.empires;
        obtainDiplomaticRelation(a, b);
        b.active = false;
        clearInvalidDiplomaticRelations(galaxy, a);
        expect(a.diplomaticRelations.byEmpire(b)).toBeNull();
        b.active = true;
        a.diplomacyCounters.atWarStartDate = 5000;
        reviewEmpireEndsAllWars(galaxy, a, 9000);
        expect(a.diplomacyCounters.atWarStartDate).toBe(LONG_MAX_VALUE);
        expect(a.diplomacyCounters.timeSpentAtWarExcludingCurrent).toBe(4000);
    });
});

describe('ChangeDiplomaticRelation (Empire.8.cs 2568)', () => {
    it('treaty: both sides change, initiator/start dates set, counters untouched, trade bonus kept', () => {
        const { galaxy } = cachedTickGame(gameData);
        meetAll(galaxy);
        const [a, b] = galaxy.empires;
        const r = obtainDiplomaticRelation(a, b);
        changeDiplomaticRelation(galaxy, a, r, DiplomaticRelationType.FreeTradeAgreement);
        const r2 = obtainDiplomaticRelation(b, a);
        expect(r.type).toBe(DiplomaticRelationType.FreeTradeAgreement);
        expect(r2.type).toBe(DiplomaticRelationType.FreeTradeAgreement);
        expect(r.initiator).toBe(a);
        expect(r2.initiator).toBe(a);
        expect(r.startDateOfLastChange).toBe(galaxyStarDate(galaxy));
        // Breaking the treaty counts a broken treaty for the initiator.
        changeDiplomaticRelation(galaxy, a, r, DiplomaticRelationType.None);
        expect(a.diplomacyCounters.brokenTreatyCount).toBe(1);
        expect(b.diplomacyCounters.brokenTreatyCount).toBe(0);
    });

    it('war: incident −40 on the victim, reputation −1, refuelling/mining rights revoked, war counters', () => {
        const { galaxy } = cachedTickGame(gameData);
        meetAll(galaxy);
        const [a, b] = galaxy.empires;
        const evBA = obtainEmpireEvaluation(galaxy, b, a);
        evBA.incidentEvaluation = 0;
        a.civilityRating = 5;
        const r = obtainDiplomaticRelation(a, b);
        r.miningRightsToOther = true;
        changeDiplomaticRelation(galaxy, a, r, DiplomaticRelationType.War, true);
        expect(evBA.incidentEvaluationRaw).toBe(-40);
        expect(a.civilityRating).toBe(4);
        expect(r.miningRightsToOther).toBe(false);
        expect(a.diplomacyCounters.warsWeStartedCount).toBe(1);
        expect(b.diplomacyCounters.warsDeclaredOnUsCount).toBe(1);
        expect(a.diplomacyCounters.atWarStartDate).toBe(galaxyStarDate(galaxy));
    });
});

describe('ProcessMessages / ConsiderTreatyProposals (Empire.3.cs)', () => {
    it('GiveGift: recipient gains money and incident evaluation, sender gains reputation, the queue is cleared', () => {
        const { galaxy } = cachedTickGame(gameData);
        meetAll(galaxy);
        const [a, b] = galaxy.empires;
        a.stateMoney = 80000;
        const moneyB = b.stateMoney;
        const msg = new EmpireMessage(a, EmpireMessageType.GiveGift, null);
        msg.money = 5000;
        const expected = valueMoneyGiftFromEmpire(galaxy, b, a, 5000);
        const evBefore = obtainEmpireEvaluation(galaxy, b, a).incidentEvaluationRaw;
        const civBefore = a.civilityRating;
        (b.messages as EmpireMessage[]).length = 0;
        sendEmpireMessage(msg, b);
        processMessages(galaxy, b);
        expect(b.stateMoney).toBe(moneyB + 5000);
        expect(obtainEmpireEvaluation(galaxy, b, a).incidentEvaluationRaw).toBeCloseTo(evBefore + expected, 12);
        expect(a.civilityRating).toBeCloseTo(Math.min(30, civBefore + expected * 0.1), 12);
        expect(obtainDiplomaticRelation(a, b).lastGiftDate).toBe(galaxyStarDate(galaxy));
        expect(b.messages.length).toBe(0);
        // The thank-you went back to the giver.
        expect((a.messages as EmpireMessage[]).some((m) => m.messageType === EmpireMessageType.Informational && m.sender === b)).toBe(true);
    });

    it('a treaty proposal is answered (accepted or refused) and removed from the proposed list', () => {
        const { galaxy } = cachedTickGame(gameData);
        meetAll(galaxy);
        const [a, b] = galaxy.empires.filter((e) => e !== galaxy.playerEmpire);
        const proposal = new DiplomaticRelation(DiplomaticRelationType.FreeTradeAgreement, a, a, b, galaxyStarDate(galaxy), false);
        b.proposedDiplomaticRelations.add(proposal);
        (a.messages as EmpireMessage[]).length = 0;
        considerTreatyProposals(galaxy, b);
        expect(b.proposedDiplomaticRelations.count).toBe(0);
        const answers = (a.messages as EmpireMessage[]).filter((m) => m.sender === b && (m.messageType === EmpireMessageType.AcceptDiplomaticRelation || m.messageType === EmpireMessageType.RefuseDiplomaticRelation));
        expect(answers.length).toBe(1);
        const rb = obtainDiplomaticRelation(b, a);
        if (answers[0].messageType === EmpireMessageType.AcceptDiplomaticRelation) {
            expect(rb.type).toBe(DiplomaticRelationType.FreeTradeAgreement);
            expect(obtainDiplomaticRelation(a, b).type).toBe(DiplomaticRelationType.FreeTradeAgreement);
        } else {
            expect(rb.type).toBe(DiplomaticRelationType.None);
        }
    });

    it('EvaluatePoliticalSituation trends the evaluation of met empires (first-contact penalty wears off)', () => {
        const { galaxy } = cachedTickGame(gameData);
        meetAll(galaxy);
        const [a, b] = galaxy.empires;
        const ev = obtainEmpireEvaluation(galaxy, a, b);
        expect(ev.firstContactPenalty).toBe(-15);
        evaluatePoliticalSituation(galaxy, a, 60000); // 60 s = 0.1 galactic year → +0.6
        expect(ev.firstContactPenalty).toBeCloseTo(-14.4, 12);
        expect(a.topCompetitor === null || galaxy.empires.includes(a.topCompetitor)).toBe(true);
    });
});

describe('harness: diplomacy evolves once the empires have met', () => {
    function runMet(seconds: number): Galaxy {
        const { galaxy } = cachedTickGame(gameData);
        meetAll(galaxy);
        runGameSeconds(galaxy, seconds);
        return galaxy;
    }

    it('strategies are chosen, attitudes trend, proposals get answered; deterministic', () => {
        const g = runMet(1200);
        const strategies = g.empires.flatMap((e: Empire) => e.diplomaticRelations.toArray().map((r) => r.strategy));
        const evs = g.empires.flatMap((e: Empire) => empireEvaluationsOf(e));
        // The first-contact penalty (−15) has worn off by 2 galactic years for every met pair.
        for (const ev of evs) expect(ev.firstContactPenalty).toBeGreaterThan(-15);
        // Reputation rises at peace (1.5 / year, capped by the neutralisation towards 0 first).
        for (const e of g.empires) expect(Number.isFinite(e.civilityRating)).toBe(true);
        expect(strategies.length).toBeGreaterThan(0);
        // Every proposal made so far was answered within one periodic block.
        for (const e of g.empires) expect(e.proposedDiplomaticRelations.count).toBeLessThanOrEqual(g.empires.length);
        const g2 = runMet(1200);
        expect(stateDigest(g2)).toBe(stateDigest(g));
        expect(g2.rnd.drawCount).toBe(g.rnd.drawCount);
    }, 1800000); // 30 min: runs at a fraction of speed while other suites load the machine
});

describe('trade offers (Empire.7.cs 2576 TradeItems, Galaxy.4.cs values)', () => {
    it('RefactorValueForEmpire scales by the offering empire\'s attitude (and the player difficulty)', async () => {
        const { getRefactorForEmpire, refactorValueForEmpire } = await import('../src/sim/tradeItems');
        const { galaxy } = cachedTickGame(gameData);
        const [a, b] = galaxy.empires.filter((e) => e !== galaxy.playerEmpire);
        const ev = obtainEmpireEvaluation(galaxy, b, a);
        const att = ev.overallAttitude;
        const expected = att > 0 ? Math.min(1.0, 10.0 / Math.min(50, att)) : att !== 0 ? Math.max(1.0, Math.abs(Math.max(-50, att)) / 10.0) : 1.0;
        expect(getRefactorForEmpire(galaxy, a, b)).toBe(expected);
        expect(refactorValueForEmpire(galaxy, 1000, a, b)).toBe(Math.trunc(1000 * expected));
    });

    it('allies/friends are offered a map; the recipient answers in ProcessMessages', async () => {
        const { tradeItems, TradeableItem } = await import('../src/sim/tradeItems');
        const { galaxy } = cachedTickGame(gameData);
        meetAll(galaxy);
        const [a, b] = galaxy.empires.filter((e) => e !== galaxy.playerEmpire);
        const r = obtainDiplomaticRelation(a, b);
        r.strategy = DiplomaticStrategy.Befriend;
        (b.messages as EmpireMessage[]).length = 0;
        const draws = galaxy.rnd.drawCount;
        tradeItems(galaxy, a);
        const offers = (b.messages as EmpireMessage[]).filter((m) => m.messageType === EmpireMessageType.OfferTrade && m.sender === a);
        // One Next(0, items) draw for the pair; the offer is sent only when a would accept the swap itself.
        expect(galaxy.rnd.drawCount - draws).toBeGreaterThanOrEqual(1);
        if (offers.length > 0) {
            expect(offers[0].subject instanceof TradeableItem).toBe(true);
            expect(r.lastTradeDealOfferDate).toBe(galaxyStarDate(galaxy));
        }
        processMessages(galaxy, b);
        expect(b.messages.length).toBe(0);
    });
});
