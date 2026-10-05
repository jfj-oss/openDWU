// Smarter AI add-on, part 6: absorb independent worlds (scenarios/smarter-ai, flag smarterAIIndependents). Not a port.
//
// The original has two ways to bring an independent colony into an empire, and no diplomacy with the independents (no
// offers or gifts: Galaxy.IndependentEmpire has no diplomatic relations, diplomacy.ts obtainDiplomaticRelation):
//   - "annex": a colony ship sent to it (identifyColonizationTargetsFull lists populated independents; BuiltObject.2.cs
//     936 case Colonize: the population joins unless CheckColonizationLikeliness is low and the roll goes against it);
//   - invasion: Empire.4.cs 4449 InvadeUnwillingColonizationTargets sends an attack fleet with troops to an unwilling
//     one (likeliness < -3), but only when the race's aggression beats 100-110 and among the first 10 targets.
// With the flag, AI empires (never the player, pirates or the independents) use both earlier:
//   - `colonizationTargetValue`: a nearby (within NEAR_RANGE of one of its colonies) willing independent
//     (likeliness > 0) is worth ANNEX_BONUS × its stock value, so colony ships go there first; a nearby unwilling one
//     that is weakly garrisoned (DetermineRequiredTroopStrength <= WEAK_TROOP_STRENGTH) is worth INVADE_BONUS × when
//     the empire may invade (below);
//   - `colonizationTargetsReviewed` (after the stock invasion pass): one such unwilling, weak, nearby target per review
//     gets the nearest available attack fleet that carries the troops it needs (the stock FindNearestAvailableFleet
//     call) and is strong enough for its defences (Empire.8.cs CheckFleetCanAttackTarget's 0.85 / 1.2 margins), with
//     the stock automation check (AdvisorMessageType.InvadeIndependent).
// May invade: the empire's policy WarWillingness is at least 1 (the pacifist race policies — Quameno, Ketarov,
// Wekkarus, 0.5 — never invade) and its race's aggression is at least normal (100) and at least its friendliness.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import { AutomationLevel } from '../../empire';
import type { Habitat } from '../../types';
import { checkColonizationLikeliness } from '../../tradeItems';
import { raceAggressionLevel, raceFriendlinessLevel } from '../../racePeriodic';
import { calculateDefendingStrength, determineRequiredTroopStrength, findNearestAvailableFleet } from '../../fleets/militaryAI';
import { shipGroupAssignMission, shipGroupTotalOverallStrengthFactor, type ShipGroup } from '../../fleets/shipGroup';
import { BuiltObjectMissionPriority, BuiltObjectMissionType } from '../../missions/mission';
import { isAiControlled } from '../../missions/playerOrder';
import { AdvisorMessageType, FleetPosture, checkTaskAuthorized } from '../../diplomacyTick';
import { generateAutomationMessageInvadeIndependent } from '../../combat/invasion';
import type { ColonizationTarget } from '../../civilianAI';
import { registerScenarioEvent, registerScenarioQuery } from '../hooks';
import { SMARTER_AI_FLAG, isSmarterAIEmpire, smarterAIOn } from './common';

export const SMARTER_AI_INDEPENDENTS_FLAG = 'smarterAIIndependents';

/** "Nearby": this close to one of the empire's colonies (galaxy units; a sector is 2,000,000). */
export const NEAR_RANGE = 2_000_000;
export const ANNEX_BONUS = 2.5;
export const INVADE_BONUS = 1.5;
/** "Weakly defended": the troops the stock rules want for the invasion (35000 base + garrison + population). */
export const WEAK_TROOP_STRENGTH = 120_000;
/** Fleets sent per empire per review. */
export const INVASIONS_PER_REVIEW = 1;

export type IndependentAction = 'annex' | 'invade' | null;

/** An independent colony with people (the only kind the original absorbs). */
export function isPopulatedIndependent(galaxy: Galaxy, h: Habitat): boolean {
    return h.empire !== null && h.empire === galaxy.independentEmpire && h.population != null && h.population.totalAmount > 0 && h.population.dominantRace !== null;
}

/** The policy / attitude rule for invading independents (see the file comment). */
export function mayInvadeIndependents(galaxy: Galaxy, empire: Empire): boolean {
    const race = empire.dominantRace;
    if (race === null || empire.policy === null || !(empire.policy.warWillingness >= 1)) return false;
    const aggression = raceAggressionLevel(galaxy, race);
    return aggression >= 100 && aggression >= raceFriendlinessLevel(galaxy, race);
}

/** The distance from `h` to the empire's nearest colony. */
export function distanceToEmpire(galaxy: Galaxy, empire: Empire, h: Habitat): number {
    let best = Number.MAX_VALUE;
    for (const c of empire.colonies) if (c !== null && c !== h) best = Math.min(best, galaxy.calculateDistance(h.xpos, h.ypos, c.xpos, c.ypos));
    return best;
}

/** What the empire does with independent colony `h`: annex it with a colony ship, invade it, or leave it to the stock AI. */
export function independentAction(galaxy: Galaxy, empire: Empire, h: Habitat): IndependentAction {
    if (!isPopulatedIndependent(galaxy, h) || empire.dominantRace === null) return null;
    if (distanceToEmpire(galaxy, empire, h) > NEAR_RANGE) return null;
    const likeliness = checkColonizationLikeliness(galaxy, h, empire.dominantRace);
    if (likeliness > 0) return 'annex';
    if (likeliness < -3 && mayInvadeIndependents(galaxy, empire) && determineRequiredTroopStrength(galaxy, empire, h) <= WEAK_TROOP_STRENGTH) return 'invade';
    return null;
}

/** The fleet to send against `h` (null when none is available and strong enough). Never draws. */
export function invasionFleetFor(galaxy: Galaxy, empire: Empire, h: Habitat): ShipGroup | null {
    const required = determineRequiredTroopStrength(galaxy, empire, h);
    const fleet = findNearestAvailableFleet(galaxy, empire, h.xpos, h.ypos, BuiltObjectMissionPriority.Low, 0, FleetPosture.Attack, true, 0.1, false, false, false, true, Math.trunc(required * 1.2));
    if (fleet === null || fleet.leadShip === null) return null;
    const defence = Math.max(1, calculateDefendingStrength(galaxy, empire, h).strength);
    if (shipGroupTotalOverallStrengthFactor(galaxy, fleet) / defence < 0.85) return null;
    return fleet;
}

/** Sends at most INVASIONS_PER_REVIEW fleets against nearby weak unwilling independents (see the file comment). */
export function invadeWeakIndependents(galaxy: Galaxy, empire: Empire): number {
    if (!mayInvadeIndependents(galaxy, empire) || empire.controlMilitaryAttacks === AutomationLevel.Undefined) return 0;
    const refusalCount = { value: 0 };
    const sent: ColonizationTarget[] = [];
    for (const t of empire.colonizationTargets) {
        if (sent.length >= INVASIONS_PER_REVIEW) break;
        if ((t.assignedShip ?? null) !== null || independentAction(galaxy, empire, t.habitat) !== 'invade') continue;
        const fleet = invasionFleetFor(galaxy, empire, t.habitat);
        if (fleet === null || !(isAiControlled(fleet.leadShip!) || empire.controlMilitaryAttacks === AutomationLevel.PartiallyAutomated)) continue;
        if (!checkTaskAuthorized(galaxy, empire, empire.controlMilitaryAttacks, refusalCount, generateAutomationMessageInvadeIndependent(galaxy, t.habitat, fleet), t.habitat, AdvisorMessageType.InvadeIndependent, null, fleet, null)) continue;
        shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.Attack, t.habitat, null, BuiltObjectMissionPriority.High, false);
        sent.push(t);
    }
    for (const t of sent) {
        const i = empire.colonizationTargets.indexOf(t);
        if (i >= 0) empire.colonizationTargets.splice(i, 1);
    }
    return sent.length;
}

registerScenarioQuery({
    id: 'smarterAI.independentValue',
    query: 'colonizationTargetValue',
    flag: SMARTER_AI_FLAG,
    run: (galaxy, value, { empire, habitat, filterOutDangerousTargets }) => {
        if (!filterOutDangerousTargets || !(value > 0) || !smarterAIOn(galaxy, SMARTER_AI_INDEPENDENTS_FLAG) || !isSmarterAIEmpire(galaxy, empire)) return value;
        const a = independentAction(galaxy, empire, habitat);
        return a === 'annex' ? Math.trunc(value * ANNEX_BONUS) : a === 'invade' ? Math.trunc(value * INVADE_BONUS) : value;
    },
});

registerScenarioEvent({
    id: 'smarterAI.invadeIndependents',
    event: 'colonizationTargetsReviewed',
    flag: SMARTER_AI_FLAG,
    run: (galaxy, { empire }) => {
        if (!smarterAIOn(galaxy, SMARTER_AI_INDEPENDENTS_FLAG) || !isSmarterAIEmpire(galaxy, empire)) return;
        invadeWeakIndependents(galaxy, empire);
    },
});
