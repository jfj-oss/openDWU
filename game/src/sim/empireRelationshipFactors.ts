// Empire.7.cs 4164 DetermineEmpireRelationshipFactors and Empire.10.cs 681 CivilityDescription (sim ports; the diplomacy
// screen's own relationshipFactors, ui/screens/diplomacyScreen.ts, predates this and shows plain-English texts).
// Read by BaconBuiltObject.cs 3860 FindResalePriceOfShip (player/executeShipAction.ts). No Rnd.

import type { Empire } from './empire';
import { empireGovernmentAttributes } from './empire';
import { empireEvaluationByEmpire, empireEvaluationsOf } from './diplomacy';
import { gameText } from './colonyTick';

/** EmpireRelationshipFactor.cs: a value and its description (GameText key + args, gameText() encoding). */
export interface EmpireRelationshipFactor {
    value: number;
    description: string;
}

/** Empire.10.cs 681 CivilityDescription() (if / else if chain verbatim; GameText keys). */
export function civilityDescription(rating: number): string {
    if (rating < -50.0) return 'Diabolical';
    else if (rating >= -50.0 && rating <= -30.0) return 'Evil';
    else if (rating >= -30.0 && rating <= -20.0) return 'Notorious';
    else if (rating >= -20.0 && rating <= -10.0) return 'Nasty';
    else if (rating >= -10.0 && rating <= -1.0) return 'Dubious';
    else if (rating >= -1.0 && rating <= 4.0) return 'Satisfactory';
    else if (rating >= 4.0 && rating <= 10.0) return 'Respectable';
    else if (rating >= 10.0 && rating <= 16.0) return 'Admired';
    else if (rating >= 16.0 && rating <= 22.0) return 'Noble';
    else if (rating > 22.0) return 'Heroic';
    return '';
}

/**
 * Empire.7.cs 4164 DetermineEmpireRelationshipFactors(otherEmpire) (C# `this` = `self`): what `otherEmpire` thinks of
 * `self`. Non-pirates: otherEmpire.EmpireEvaluations[this] factors, scaled by Galaxy.AggressionLevel and DiplomacyFactor,
 * then Sort() (by Value) and Reverse() — descending. Pirates (either side): otherEmpire's PirateRelation with `self`,
 * factored, unsorted.
 */
export function determineEmpireRelationshipFactors(self: Empire, otherEmpire: Empire): EmpireRelationshipFactor[] {
    const list: EmpireRelationshipFactor[] = [];
    const add = (value: number, description: string): void => {
        list.push({ value, description });
    };
    if (otherEmpire.pirateEmpireBaseHabitat === null && self.pirateEmpireBaseHabitat === null) {
        const empireEvaluation = empireEvaluationByEmpire(empireEvaluationsOf(otherEmpire), self);
        if (empireEvaluation !== null) {
            const ev = empireEvaluation;
            if (ev.firstContactPenalty < 0.0) add(ev.firstContactPenalty, 'First Contact Penalty Description');
            if (ev.militaryForcesInSystems < 0) add(ev.militaryForcesInSystems, 'Your military forces in our systems violate our territory');
            if (ev.relationshipWithFriendsPositiveCumulative > 0.0) add(ev.relationshipWithFriendsPositiveCumulative, 'You have formed beneficial treaties with our friends');
            if (ev.relationshipWithFriendsNegativeCumulative < 0.0) add(ev.relationshipWithFriendsNegativeCumulative, 'You have trade sanctions or are at war with our friends');
            if (ev.systemCompetitionCumulative < 0.0) add(ev.systemCompetitionCumulative, 'Your colonies and bases trespass in our systems!');
            // ReputationWeighted reads EmpireEvaluation.Empire (= self) twice; CivilityDescription is self's.
            if (ev.reputationWeighted > 0.0) {
                add(ev.reputationWeighted, gameText('We respect your good reputation', civilityDescription(ev.empire!.civilityRating)));
            } else if (ev.reputationWeighted < 0.0) {
                add(ev.reputationWeighted, gameText('We are troubled by your poor reputation', civilityDescription(ev.empire!.civilityRating)));
            }
            if (ev.tradeVolume > 0) {
                const description =
                    ev.tradeVolume > 20
                        ? 'Our empires generate a colossal amount of trade'
                        : ev.tradeVolume > 13
                          ? 'Our empires produce a large amount of trade'
                          : ev.tradeVolume <= 6
                            ? 'Our empires share a small volume of trade'
                            : 'Our empires share a fair amount of trade';
                add(ev.tradeVolume, description);
            }
            const governmentName = empireGovernmentAttributes(self)?.name ?? '';
            if (ev.governmentStyleAffinityCumulative < 0.0) add(ev.governmentStyleAffinityCumulative, gameText('We are unhappy with your style of government', governmentName));
            if (ev.governmentStyleAffinityCumulative > 0.0) add(ev.governmentStyleAffinityCumulative, gameText('We like your style of government', governmentName));
            if (ev.covetousnessCumulative < 0.0) add(ev.covetousnessCumulative, 'We covet your colonies and resources...');
            if (ev.blockades < 0) add(ev.blockades, 'You have blockaded our colonies and space ports!');
            if (ev.biasRaw > 0.0) add(ev.biasRaw, 'We naturally like you');
            else if (ev.biasRaw < 0.0) add(ev.biasRaw, 'We instinctively dislike you');
            if (ev.envy < 0) add(ev.envy, 'We are envious of your huge strength and power');
            if (ev.restrictedResourceTrading < 0.0) add(ev.restrictedResourceTrading, 'We are upset that you refuse to trade valuable resources with us');
            if (ev.restrictedResourceTrading > 0.0) add(ev.restrictedResourceTrading, 'We are happy that you trade valuable resources with us');
            if (ev.militaryRefueling > 0) add(ev.militaryRefueling, 'We appreciate military refueling');
            if (ev.miningRights > 0) add(ev.miningRights, 'We appreciate mining rights');
            if (ev.incidentEvaluationRaw < 0.0) add(ev.incidentEvaluationRaw, 'Our past dealings with you have been terrible');
            if (ev.incidentEvaluationRaw > 0.0) add(ev.incidentEvaluationRaw, 'Our past dealings with you have been good');
            if (ev.slaveryOffense < 0.0) add(ev.slaveryOffense, 'We are angry at your enslavement of our race at your colonies');
            if (ev.racialOffense < 0.0) add(ev.racialOffense, 'We are outraged at your extermination of our race at your colonies');
            // Empire.7.cs 4264-4276 (the list is empty when the evaluation is null, so the C# never dereferences it then).
            const aggressionLevel = self.galaxy.aggressionLevel;
            for (let i = 0; i < list.length; i++) {
                if (list[i].value > 0.0) {
                    list[i].value /= aggressionLevel;
                    list[i].value *= ev.diplomacyFactor;
                } else {
                    list[i].value *= aggressionLevel;
                    list[i].value /= ev.diplomacyFactor;
                }
            }
        }
        // 4277-4278 Sort() (EmpireRelationshipFactor.CompareTo: Value) then Reverse(): descending by value. Entries with
        // equal values may swap (List.Sort is unstable); only their descriptions differ, never the value sequence.
        list.sort((a, b) => b.value - a.value);
    } else {
        const r = otherEmpire.pirateRelations.getRelationByOtherEmpire(self);
        if (r !== null) {
            if (r.evaluationGiftsFactored > 0) add(r.evaluationGiftsFactored, 'Pirate Evaluation Gift Description');
            if (r.evaluationOffenseOverRequestsFactored < 0) add(r.evaluationOffenseOverRequestsFactored, 'Pirate Evaluation Offense Over Requests Description');
            else if (r.evaluationOffenseOverRequests > 0) add(r.evaluationOffenseOverRequestsFactored, 'Pirate Evaluation Happy Over Requests Description');
            if (r.evaluationDetectedIntelligenceMissionsFactored < 0) add(r.evaluationDetectedIntelligenceMissionsFactored, 'Pirate Evaluation Detected Intelligence Missions Description');
            if (r.evaluationPirateMissionsSucceedFactored > 0) add(r.evaluationPirateMissionsSucceedFactored, 'Pirate Evaluation Pirate Missions Succeed Description');
            if (r.evaluationPirateMissionsFailFactored < 0) add(r.evaluationPirateMissionsFailFactored, 'Pirate Evaluation Pirate Missions Fail Description');
            if (r.evaluationShipAttacksFactored < 0) add(r.evaluationShipAttacksFactored, 'Pirate Evaluation Ship Attacks Description');
            if (r.evaluationProtectionCancelledFactored < 0) add(r.evaluationProtectionCancelledFactored, 'Pirate Evaluation Protection Cancelled Description');
            if (r.evaluationCovetedColoniesFactored < 0) add(r.evaluationCovetedColoniesFactored, 'Pirate Evaluation Coveted Colonies Description');
            if (r.evaluationLongRelationshipFactored > 0) add(r.evaluationLongRelationshipFactored, 'Pirate Evaluation Long Relationship Description');
            if (r.evaluationRaidsAgainstOurColoniesFactored < 0) add(r.evaluationRaidsAgainstOurColoniesFactored, 'Pirate Evaluation Raids Against Our Colonies Description');
        }
    }
    return list;
}
