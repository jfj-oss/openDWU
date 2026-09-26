// Attitude helpers shared by the Diplomacy screen (15a) and the diplomat brief (18b): the other empire's feeling
// towards an empire and the named relation factors behind its OverallAttitude. Pure, read-only (no Rnd, no mutation).

import type { Empire } from '../empire';
import { empireEvaluationByEmpire, empireEvaluationsOf } from '../diplomacy';
import { civilityDescription } from '../empireRelationshipFactors';

/** Empire.4.cs:55 ResolveFeelingDescription (sequential ifs; later ones overwrite). */
export function feelingDescription(overallAttitude: number): string {
    let result = '';
    if (overallAttitude <= -45) result = 'Furious';
    if (overallAttitude >= -44 && overallAttitude <= -20) result = 'Angry';
    if (overallAttitude >= -19 && overallAttitude <= -5) result = 'Annoyed';
    if (overallAttitude >= -4 && overallAttitude <= 7) result = 'Cautious';
    if (overallAttitude >= 8 && overallAttitude <= 20) result = 'Pleased';
    if (overallAttitude >= 21 && overallAttitude <= 44) result = 'Friendly';
    if (overallAttitude >= 45) result = 'Delighted';
    return result;
}

/** Empire.10.cs:681 CivilityDescription (one port, sim/empireRelationshipFactors.ts). */
export { civilityDescription };

export interface RelationshipFactor {
    value: number;
    description: string;
}

/** Empire.7.cs:4164 DetermineEmpireRelationshipFactors, non-pirate branch
 * (`this` = the player, `otherEmpire` = the viewed empire). */
export function relationshipFactors(player: Empire, other: Empire, playerGovernmentName: string): RelationshipFactor[] {
    if (other.pirateEmpireBaseHabitat !== null || player.pirateEmpireBaseHabitat !== null) return [];
    const ev = empireEvaluationByEmpire(empireEvaluationsOf(other), player);
    if (ev === null) return [];
    const list: RelationshipFactor[] = [];
    const add = (value: number, description: string): void => {
        list.push({ value, description });
    };
    if (ev.firstContactPenalty < 0.0) add(ev.firstContactPenalty, 'Our ignorance of your strange alien ways causes us to distrust you');
    if (ev.militaryForcesInSystems < 0) add(ev.militaryForcesInSystems, 'Your military forces in our systems violate our territory');
    if (ev.relationshipWithFriendsPositiveCumulative > 0.0) add(ev.relationshipWithFriendsPositiveCumulative, 'You have formed beneficial treaties with our friends');
    if (ev.relationshipWithFriendsNegativeCumulative < 0.0) add(ev.relationshipWithFriendsNegativeCumulative, 'You have trade sanctions or are at war with our friends');
    if (ev.systemCompetitionCumulative < 0.0) add(ev.systemCompetitionCumulative, 'Your colonies and bases trespass in our systems!');
    const reputation = ev.reputationWeighted;
    if (reputation > 0.0) add(reputation, `We respect your good reputation (${civilityDescription(player.civilityRating)})`);
    else if (reputation < 0.0) add(reputation, `We are troubled by your poor reputation (${civilityDescription(player.civilityRating)})`);
    if (ev.tradeVolume > 0) {
        const tv = ev.tradeVolume;
        add(
            tv,
            tv > 20
                ? 'Our empires generate a colossal amount of trade'
                : tv > 13
                  ? 'Our empires produce a large amount of trade'
                  : tv <= 6
                    ? 'Our empires share a small volume of trade'
                    : 'Our empires share a fair amount of trade',
        );
    }
    if (ev.governmentStyleAffinityCumulative < 0.0) add(ev.governmentStyleAffinityCumulative, `We are unhappy with your style of government (${playerGovernmentName})`);
    if (ev.governmentStyleAffinityCumulative > 0.0) add(ev.governmentStyleAffinityCumulative, `We like your style of government (${playerGovernmentName})`);
    if (ev.covetousnessCumulative < 0.0) add(ev.covetousnessCumulative, 'We covet your colonies and resources...');
    if (ev.blockades < 0) add(ev.blockades, 'You have blockaded our colonies and space ports!');
    if (ev.biasRaw > 0.0) add(ev.biasRaw, 'We naturally like you');
    else if (ev.biasRaw < 0.0) add(ev.biasRaw, 'We instinctively dislike you');
    if (ev.envy < 0) add(ev.envy, 'We are envious of your huge strength and power');
    if (ev.restrictedResourceTrading < 0.0) add(ev.restrictedResourceTrading, 'We are upset that you refuse to trade valuable resources with us');
    if (ev.restrictedResourceTrading > 0.0) add(ev.restrictedResourceTrading, 'We are happy that you trade valuable resources with us');
    if (ev.militaryRefueling > 0) add(ev.militaryRefueling, 'We appreciate your help with military refueling');
    if (ev.miningRights > 0) add(ev.miningRights, 'We appreciate mining rights within your territory');
    if (ev.incidentEvaluationRaw < 0.0) add(ev.incidentEvaluationRaw, 'Our past dealings with you have been terrible');
    if (ev.incidentEvaluationRaw > 0.0) add(ev.incidentEvaluationRaw, 'Our past dealings with you have been good');
    if (ev.slaveryOffense < 0.0) add(ev.slaveryOffense, 'We are angry at your enslavement of our race at your colonies');
    if (ev.racialOffense < 0.0) add(ev.racialOffense, 'We are outraged at your extermination of our race at your colonies');

    const aggression = player.galaxy.aggressionLevel;
    for (const f of list) {
        if (f.value > 0.0) {
            f.value /= aggression;
            f.value *= ev.diplomacyFactor;
        } else {
            f.value *= aggression;
            f.value /= ev.diplomacyFactor;
        }
    }
    // C# list.Sort(); list.Reverse() → descending by value. .NET's List.Sort is
    // unstable for ties; Array.prototype.sort is stable, so tie order here is
    // insertion order (may differ from the original for equal values).
    list.sort((a, b) => b.value - a.value);
    return list;
}
