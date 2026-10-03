// The sim writes of the event panel's choice buttons (Main.Part4.cs:1777 btnEventMessageInvestigate_Click), issued by
// the UI as player commands (playerOps.ts): the event panel (ui/eventMessages.ts) shows them for the three "decision"
// events (method_509), an abandoned ship / base (method_511) and ruins (method_510, the existing investigateRuins op).
// btnEventMessageAvoid_Click (1844) changes nothing in the sim. Headless: no DOM / Pixi.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { BuiltObject } from '../builtObject';
import { obtainEmpireEvaluation } from '../diplomacy';
import { changePirateEvaluation, PirateRelationEvaluationType } from '../pirateRelations';
import { investigateAbandonedBuiltObject } from '../combat/ownership';
import { BuiltObjectEncounterAction } from '../gameStartTail';
import { exposePlanetDestroyerConstruction } from '../empireEvents';

/**
 * Main.Part4.cs:1836-1841 (EncounterBuiltObject, method_511 "Investigate Ship / Base"):
 * `PlayerEmpireEncounterAction = Prompt; Galaxy.InvestigateAbandonedBuiltObject(PlayerEmpire, builtObject)`.
 */
export function investigateEncounteredBuiltObject(galaxy: Galaxy, empire: Empire, builtObject: BuiltObject): void {
    builtObject.playerEmpireEncounterAction = BuiltObjectEncounterAction.Prompt;
    investigateAbandonedBuiltObject(galaxy, empire, builtObject);
}

/**
 * Main.Part4.cs:1784-1812 (UncoverPirateAttackFundingAnotherEmpire, "Warn target empire about this secret deal"): the
 * target thinks worse of the empire that funded the pirates and better of the warner. `requestingEmpire` /
 * `targetEmpire` are the EmpireActivity's (the event's additionalData). No Rnd.
 */
export function warnTargetOfPirateAttackFunding(galaxy: Galaxy, empire: Empire, requestingEmpire: Empire, targetEmpire: Empire): void {
    if (targetEmpire.pirateEmpireBaseHabitat === null && requestingEmpire.pirateEmpireBaseHabitat === null) {
        const empireEvaluation = obtainEmpireEvaluation(galaxy, targetEmpire, requestingEmpire);
        empireEvaluation.incidentEvaluation = empireEvaluation.incidentEvaluationRaw - 15.0;
        requestingEmpire.civilityRating -= 3.0;
        const empireEvaluation1 = obtainEmpireEvaluation(galaxy, targetEmpire, empire);
        empireEvaluation1.incidentEvaluation = empireEvaluation1.incidentEvaluationRaw + 12.0;
        return;
    }
    changePirateEvaluation(targetEmpire, requestingEmpire, Math.fround(-15), PirateRelationEvaluationType.DetectedIntelligenceMissions);
    requestingEmpire.civilityRating -= 3.0;
    if (targetEmpire.pirateEmpireBaseHabitat === null && empire.pirateEmpireBaseHabitat === null) {
        const empireEvaluation2 = obtainEmpireEvaluation(galaxy, targetEmpire, empire);
        empireEvaluation2.incidentEvaluation = empireEvaluation2.incidentEvaluationRaw + 12.0;
    } else {
        changePirateEvaluation(targetEmpire, empire, Math.fround(12), PirateRelationEvaluationType.Gifts);
    }
}

/**
 * Main.Part4.cs:1813-1821 (UncoverPlanetDestroyerConstruction, "Expose this secret project to all empires"):
 * `PlayerEmpire.ExposePlanetDestroyerConstruction(builder, location, PlayerEmpire)` (additionalData = [builder, location]).
 * The location travels as its index in Galaxy.GalaxyLocations (the command log keeps sim objects by a stable key; a
 * GalaxyLocation would be copied by value and no longer match the empires' known-location lists). No Rnd.
 */
export function exposeUncoveredPlanetDestroyer(galaxy: Galaxy, empire: Empire, builder: Empire, locationIndex: number): void {
    const location = galaxy.galaxyLocations[locationIndex];
    if (location === undefined) return;
    exposePlanetDestroyerConstruction(galaxy, builder, location, empire);
}
