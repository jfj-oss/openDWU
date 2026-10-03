// M4s (s2) — pirate faction relations AI:
//   Empire.2.cs 2510 PirateReviewEmpireRelations, 2649/2653 CalculatePirateProtectionPricePerMonth, 2697
//     CalculateDistanceToNearestColony, 2721 CheckWithinProximityOfNearestColony, 2754 DetermineDesirePirateProtection,
//     2294 CalculatePirateDesireControlColoniesCommon, 2348 CheckPirateDesireControlColoniesCommon;
//   Empire.3.cs 3992 CheckSufficientCashflow; Empire.7.cs 2383/2397 CalculateNextAllowableProposalDate / ChangeDate
//     (PirateRelation overloads); BuiltObjectList.cs 570 CalculateAttackingFirepowerNearEmpireTargets;
//   Empire.1.cs 4359 PirateGenerateSellInfoOffers → Galaxy.cs 2818 GeneratePirateOffersForSingleEmpire, Empire.5.cs 1163
//     GenerateSaleableInfoForEmpire, Galaxy.6.cs 4481 FindNearestUnexploredSystem;
//   Empire.7.cs 2666 PirateTradeItems.
//
// Free functions, C# `this` first (plan §3.1). Every Galaxy.Rnd draw is on galaxy.rnd in C# order.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { AutomationLevel } from '../empire';
import type { BuiltObject } from '../builtObject';
import type { Habitat } from '../types';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { BuiltObjectMissionType, builtObjectMission } from '../missions/mission';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../diplomacy';
import { checkEmpireHasHyperDriveTech, totalColonyStrategicValue, totalMobileMilitaryFirepower } from '../forceStructure';
import { fastFindNearestColony } from '../combat/threats';
import { EmpireMessage, EmpireMessageType, sendEmpireMessage, sendMessageToEmpire } from '../messages';
import { PiratePlayStyle, latestDesignsFindNewestCanBuild } from '../pirates';
import { PirateRelation, PirateRelationType, changePirateRelation, obtainPirateRelation } from '../pirateRelations';
import { REAL_SECONDS_IN_GALACTIC_YEAR, galaxyStarDate } from '../tick/simTime';
import { gameText } from '../colonyTick';
import { calculateAnnualCashflow } from '../treasury';
import { netRound } from '../taxes';
import { CharacterRole, getCharactersByRole, type Character } from '../characters';
import { AdvisorMessageType, checkTaskAuthorized, type RefCount } from '../diplomacyTick';
import { BoxedPirateRelationType } from '../advisorQueue';
import { calculateAccurateAnnualCashflowIncludingUnderConstruction } from '../construction/facilities';
import { GalaxyLocationType, type GalaxyLocation } from '../galaxyLocation';
import { SECTOR_SIZE } from '../logistics/orders';
import { resolveTradeableItemsResearchProjects, TradeableItemType, type TradeableItem } from '../tradeItems';
import { findNodeById, type TechNode } from '../researchSystem';
import { PirateIncomeType } from './pirateEconomy';
import { EmpireActivityType } from './empireActivity';
import { clearOutlawsFromEmpire } from '../diplomacyTick';
import { cancelAttackMissionsAgainstEmpire } from '../fleets/militaryAI';
import { formatGameTextNow } from '../textResolver';

const f = Math.fround;

// ---------------------------------------------------------------------------------------------------------------
// Protection pricing and desire (Empire.2.cs 2649-2838)
// ---------------------------------------------------------------------------------------------------------------

/** BuiltObjectList.cs 570 CalculateAttackingFirepowerNearEmpireTargets(targetEmpire) over any ship list. No Rnd. */
export function calculateAttackingFirepowerNearEmpireTargetsList(galaxy: Galaxy, list: readonly (BuiltObject | null)[], targetEmpire: Empire): number {
    let num = 0;
    for (let i = 0; i < list.length; i++) {
        const builtObject = list[i];
        if (builtObject == null || builtObject.hasBeenDestroyed) continue;
        const mission = builtObjectMission(builtObject.mission);
        if (mission === null) continue;
        let flag = false;
        let stellarObject: BuiltObject | Habitat | null = null;
        let empire: Empire | null = null;
        switch (mission.type) {
            case BuiltObjectMissionType.Attack:
            case BuiltObjectMissionType.WaitAndAttack:
            case BuiltObjectMissionType.WaitAndBombard:
            case BuiltObjectMissionType.Bombard:
            case BuiltObjectMissionType.Capture:
            case BuiltObjectMissionType.Raid:
                flag = true;
                if (mission.targetBuiltObject !== null) {
                    stellarObject = mission.targetBuiltObject;
                    empire = stellarObject.empire;
                } else if (mission.targetHabitat !== null) {
                    stellarObject = mission.targetHabitat;
                    empire = stellarObject.empire;
                } else if (mission.targetShipGroup !== null && mission.targetShipGroup.leadShip !== null) {
                    stellarObject = mission.targetShipGroup.leadShip;
                    empire = stellarObject.empire;
                }
                break;
        }
        if (flag && stellarObject !== null && empire !== null && empire === targetEmpire) {
            const num2 = galaxy.calculateDistanceSquared(builtObject.xpos, builtObject.ypos, stellarObject.xpos, stellarObject.ypos);
            if (num2 < 2500000000.0) num += builtObject.firepowerRaw;
        }
    }
    return num;
}

/** Empire.2.cs 2649/2653 CalculatePirateProtectionPricePerMonth(empireToProtect, out pirateAttackForcesFactor). No Rnd. */
export function calculatePirateProtectionPricePerMonth(galaxy: Galaxy, empire: Empire, empireToProtect: Empire): { price: number; pirateAttackForcesFactor: number } {
    let pirateAttackForcesFactor = 0.0;
    let result = 0.0;
    if (empire.pirateEmpireBaseHabitat !== null) {
        if (empireToProtect.pirateEmpireBaseHabitat !== null) {
            result = 0.0;
        } else {
            const num = Math.sqrt(totalColonyStrategicValue(empireToProtect) / 1000000.0);
            let val = (totalMobileMilitaryFirepower(empire.builtObjects) + 1.0) / (totalMobileMilitaryFirepower(empireToProtect.builtObjects) + 1.0);
            val = Math.max(0.05, Math.min(0.4, val));
            let num2 = 1.0;
            const pirateRelation = obtainPirateRelation(empire, empireToProtect);
            if (pirateRelation != null) {
                const evaluation = pirateRelation.evaluation;
                if (evaluation < 0) num2 = Math.min(4.0, Math.max(1.0, f(1 + f(Math.abs(evaluation) / 15))));
            }
            let num3 = 1.0;
            const num4 = calculateAttackingFirepowerNearEmpireTargetsList(galaxy, empire.builtObjects, empireToProtect);
            if (num4 > 0) {
                const num5 = 1 + totalMobileMilitaryFirepower(empireToProtect.builtObjects);
                num3 = Math.min(4.0, 2.0 + num4 / num5);
                pirateAttackForcesFactor = num3 - 2.0;
            }
            const num6 = 1000.0 * val * num * num2 * num3;
            const num7 = calculateAccurateAnnualCashflowIncludingUnderConstruction(galaxy, empireToProtect).cashflow;
            const num8 = num7 / 12.0;
            const num9 = (val * num2 * num3) / num;
            result = Math.min(num6, Math.max(num6 * 0.4, num8 * num9));
            result = netRound(result, 0);
        }
    }
    return { price: result, pirateAttackForcesFactor };
}

/** The pirate base / capital search shared by 2697 CalculateDistanceToNearestColony and 2721 CheckWithinProximityOfNearestColony. */
function nearestColonyDistance(galaxy: Galaxy, normalEmpire: Empire, pirateEmpire: Empire): { found: boolean; distance: number } {
    let result = Number.MAX_VALUE;
    let habitat: Habitat | null = null;
    if (pirateEmpire.pirateEmpireBaseHabitat !== null) {
        habitat = fastFindNearestColony(galaxy, pirateEmpire.pirateEmpireBaseHabitat.xpos, pirateEmpire.pirateEmpireBaseHabitat.ypos, normalEmpire, 0);
    } else if (pirateEmpire.capital !== null) {
        habitat = fastFindNearestColony(galaxy, pirateEmpire.capital.xpos, pirateEmpire.capital.ypos, normalEmpire, 0);
    }
    if (habitat !== null) {
        if (pirateEmpire.pirateEmpireBaseHabitat !== null) {
            result = galaxy.calculateDistance(habitat.xpos, habitat.ypos, pirateEmpire.pirateEmpireBaseHabitat.xpos, pirateEmpire.pirateEmpireBaseHabitat.ypos);
        } else if (pirateEmpire.capital !== null) {
            result = galaxy.calculateDistance(habitat.xpos, habitat.ypos, pirateEmpire.capital.xpos, pirateEmpire.capital.ypos);
        }
    }
    return { found: habitat !== null, distance: result };
}

/** Empire.2.cs 2697 CalculateDistanceToNearestColony(normalEmpire, pirateEmpire). No Rnd. */
export function calculateDistanceToNearestColony(galaxy: Galaxy, normalEmpire: Empire, pirateEmpire: Empire): number {
    return nearestColonyDistance(galaxy, normalEmpire, pirateEmpire).distance;
}

/** Empire.2.cs 2721 CheckWithinProximityOfNearestColony(normalEmpire, pirateEmpire, range). No Rnd. */
export function checkWithinProximityOfNearestColony(galaxy: Galaxy, normalEmpire: Empire, pirateEmpire: Empire, range: number): boolean {
    const r = nearestColonyDistance(galaxy, normalEmpire, pirateEmpire);
    return r.found && r.distance < range;
}

/** Empire.3.cs 3992 CheckSufficientCashflow(expense, allowableRatio). No Rnd. */
function checkSufficientCashflow(galaxy: Galaxy, empire: Empire, expense: number, allowableRatio: number): boolean {
    const num = Math.max(0.0, calculateAnnualCashflow(galaxy, empire) * allowableRatio);
    return expense < num;
}

/** ColonizationTargets.ResolveHabitats() appended to Colonies (Empire.2.cs 2299-2301 / 2352-2354). */
function coloniesAndTargets(empire: Empire): (Habitat | null)[] {
    const list: (Habitat | null)[] = [];
    list.push(...empire.colonies);
    for (const t of empire.colonizationTargets) list.push(t.habitat);
    return list;
}

/** Empire.2.cs 2294 CalculatePirateDesireControlColoniesCommon(otherEmpire, colonyTargetListDepth) (float). No Rnd. */
export function calculatePirateDesireControlColoniesCommon(empire: Empire, otherEmpire: Empire | null, colonyTargetListDepth: number): number {
    let num = f(0);
    if (empire.pirateEmpireBaseHabitat !== null && empire.colonizationTargets != null && empire.colonies != null) {
        const habitatList = coloniesAndTargets(empire);
        if (otherEmpire !== null) {
            if (otherEmpire.pirateEmpireBaseHabitat !== null) {
                if (otherEmpire.colonizationTargets != null && otherEmpire.colonies != null) {
                    const habitatList2 = coloniesAndTargets(otherEmpire);
                    for (let i = 0; i < colonyTargetListDepth; i++) {
                        if (habitatList.length <= i) continue;
                        const habitat = habitatList[i];
                        if (habitat != null) {
                            const num2 = habitatList2.indexOf(habitat);
                            if (num2 >= 0 && num2 < colonyTargetListDepth) num = f(num - 10);
                        }
                    }
                }
            } else if (otherEmpire.colonizationTargets != null) {
                for (let j = 0; j < colonyTargetListDepth; j++) {
                    if (habitatList.length > j) {
                        const habitat2 = habitatList[j];
                        if (habitat2 != null && otherEmpire.colonies.includes(habitat2)) num = f(num - 10);
                    }
                }
            }
        }
    }
    return num;
}

/** Empire.2.cs 2348 CheckPirateDesireControlColoniesCommon(otherEmpire, depth). No Rnd. */
export function checkPirateDesireControlColoniesCommon(empire: Empire, otherEmpire: Empire | null, depth: number): boolean {
    if (empire.pirateEmpireBaseHabitat !== null && empire.colonizationTargets != null && empire.colonies != null) {
        const habitatList = coloniesAndTargets(empire);
        if (otherEmpire !== null) {
            if (otherEmpire.pirateEmpireBaseHabitat !== null) {
                if (otherEmpire.colonizationTargets != null && otherEmpire.colonies != null) {
                    const habitatList2 = coloniesAndTargets(otherEmpire);
                    for (let i = 0; i < depth; i++) {
                        if (habitatList.length <= i) continue;
                        const habitat = habitatList[i];
                        if (habitat != null) {
                            const num = habitatList2.indexOf(habitat);
                            if (num >= 0 && num < depth) return true;
                        }
                    }
                }
            } else if (otherEmpire.colonizationTargets != null) {
                for (let j = 0; j < depth; j++) {
                    if (habitatList.length > j) {
                        const habitat2 = habitatList[j];
                        if (habitat2 != null && otherEmpire.colonies.includes(habitat2)) return true;
                    }
                }
            }
        }
    }
    return false;
}

/** Empire.2.cs 2754 DetermineDesirePirateProtection(otherEmpire). No Rnd. */
export function determineDesirePirateProtectionCore(galaxy: Galaxy, empire: Empire, otherEmpire: Empire | null): boolean {
    if (otherEmpire !== null) {
        if (empire.pirateEmpireBaseHabitat === null) {
            if (otherEmpire.pirateEmpireBaseHabitat === null) return false;
            const priced = calculatePirateProtectionPricePerMonth(galaxy, otherEmpire, empire);
            const num = priced.price;
            const pirateAttackForcesFactor = priced.pirateAttackForcesFactor;
            const pirateRelation = obtainPirateRelation(empire, otherEmpire);
            const num2 = calculateDistanceToNearestColony(galaxy, empire, otherEmpire);
            let flag = false;
            let flag2 = false;
            // C#: both lookups are for Escort.
            const design = latestDesignsFindNewestCanBuild(empire, BuiltObjectSubRole.Escort);
            const design2 = latestDesignsFindNewestCanBuild(empire, BuiltObjectSubRole.Escort);
            if (design !== null && design2 !== null && (design.shieldsCapacity > 0 || design2.shieldsCapacity > 0)) flag2 = true;
            const num3 = totalMobileMilitaryFirepower(empire.builtObjects);
            if (num3 > 0) flag = true;
            let num4 = 0.4;
            if (pirateAttackForcesFactor > 0.0) num4 *= 1.5 + pirateAttackForcesFactor;
            if (!flag || !flag2) num4 = 0.9;
            num4 = Math.min(num4, 0.9);
            const num5 = totalMobileMilitaryFirepower(otherEmpire.builtObjects);
            const num6 = totalMobileMilitaryFirepower(empire.builtObjects);
            const num7 = f(f(f(num5) + f(0.05)) / f(f(num6) + f(0.05)));
            if (num7 > 1) {
                const num8 = f(Math.sqrt(Math.min(10.0, num7)));
                num4 *= num8;
            }
            if (checkSufficientCashflow(galaxy, empire, num * 12.0, num4) && (num === 0.0 || empire.stateMoney >= num)) {
                if (pirateRelation.evaluation >= 5.0 && num2 < SECTOR_SIZE * 2.0) return true;
                const num9 = Math.min(f(0), Math.max(f(-2000), f(f(num7 * f(-10)) + f(5))));
                if (pirateRelation.evaluation > num9) return true;
            }
        } else if (otherEmpire.pirateEmpireBaseHabitat === null) {
            const pirateRelation2 = obtainPirateRelation(empire, otherEmpire);
            if (pirateRelation2.evaluation >= 0) return true;
            const num10 = totalMobileMilitaryFirepower(otherEmpire.builtObjects);
            const num11 = totalMobileMilitaryFirepower(empire.builtObjects);
            const num12 = f(f(f(num10) + f(0.05)) / f(f(num11) + f(0.05)));
            const num13 = Math.min(f(0), Math.max(f(-35), f(f(num12 * f(-10)) + f(5))));
            if (pirateRelation2.evaluation > num13) return true;
        } else {
            const pirateRelation3 = obtainPirateRelation(empire, otherEmpire);
            if (pirateRelation3.evaluation >= 0 && !checkPirateDesireControlColoniesCommon(empire, otherEmpire, 3)) return true;
        }
    }
    return false;
}

/** The shared body of Empire.7.cs 2383 / 2397 CalculateNextAllowableProposalDate / ChangeDate(PirateRelation). */
function nextAllowableInterval(galaxy: Galaxy, relation: PirateRelation): number {
    let num = Math.trunc(REAL_SECONDS_IN_GALACTIC_YEAR * 1000.0 * 1.0);
    let num2 = galaxy.pirateEmpires.length;
    if (relation.otherEmpire !== null && relation.otherEmpire.pirateRelations != null) num2 = relation.otherEmpire.pirateRelations.countKnownPirateFactions();
    let val = num2 / galaxy.pirateEmpires.length;
    val = Math.max(0.3, Math.min(1.0, val));
    num = Math.trunc(num * val * 3.0);
    return num;
}

/** Empire.7.cs 2383 CalculateNextAllowableProposalDate(PirateRelation). No Rnd. */
export function calculateNextAllowableProposalDatePirate(galaxy: Galaxy, relation: PirateRelation): number {
    return relation.lastOfferDate + nextAllowableInterval(galaxy, relation);
}

/** Empire.7.cs 2397 CalculateNextAllowableChangeDate(PirateRelation). No Rnd. */
export function calculateNextAllowableChangeDatePirate(galaxy: Galaxy, relation: PirateRelation): number {
    return relation.lastChangeDate + nextAllowableInterval(galaxy, relation);
}

/** Empire.10.cs GenerateAutomationMessagePirateProtection* / CancelPirateProtection — advisor texts (UI reads them). */
function automationMessage(key: string, ...args: unknown[]): string {
    return gameText(key, ...args);
}

/** Empire.2.cs 2510 PirateReviewEmpireRelations(starDate, timePassed). No Rnd. */
export function pirateReviewEmpireRelationsCore(galaxy: Galaxy, empire: Empire, starDate: number, timePassed: number): void {
    if (empire.pirateRelations == null) return;
    let num = Math.max(SECTOR_SIZE * 2.0, galaxy.sizeX * 0.2);
    const piratePlayStyle = empire.piratePlayStyle;
    if (piratePlayStyle === PiratePlayStyle.Balanced || piratePlayStyle === PiratePlayStyle.Smuggler) num *= 2.0;
    // `long num2 = RealSecondsInGalacticYear * 1.0 * 1000.0` — unused.
    const charactersByRole = getCharactersByRole((empire.characters ?? []) as Character[], CharacterRole.PirateLeader);
    let num3 = -100;
    for (let i = 0; i < charactersByRole.length; i++) {
        const character = charactersByRole[i];
        if (character != null && character.role === CharacterRole.PirateLeader) num3 = Math.max(num3, character.diplomacy);
    }
    if (num3 <= -100) num3 = 0;
    const diplomacyFactor = f(1 + f(f(num3) / 100));
    const pirateRelationList: PirateRelation[] = [];
    for (let j = 0; j < empire.pirateRelations.count; j++) {
        const pirateRelation = empire.pirateRelations.get(j);
        if (pirateRelation == null || pirateRelation.type === PirateRelationType.NotMet) continue;
        if (pirateRelation.otherEmpire === null || !pirateRelation.otherEmpire.active || pirateRelation.thisEmpire === null || !pirateRelation.thisEmpire.active) {
            pirateRelationList.push(pirateRelation);
            continue;
        }
        const otherEmpire = pirateRelation.otherEmpire;
        const num4 = calculateNextAllowableProposalDatePirate(galaxy, pirateRelation);
        const num5 = calculateNextAllowableChangeDatePirate(galaxy, pirateRelation);
        if (pirateRelation.type === PirateRelationType.Protection && pirateRelation.thisEmpire === empire) {
            const num6 = 12.0 * ((starDate - pirateRelation.lastProtectionFeePaymentDate) / (REAL_SECONDS_IN_GALACTIC_YEAR * 1000.0));
            const num7 = num6 * pirateRelation.monthlyProtectionFeeToThisEmpire;
            pirateRelation.thisEmpire.stateMoney += num7;
            pirateRelation.thisEmpire.pirateEconomy.performIncome(num7, PirateIncomeType.ProtectionAgreement, starDate);
            pirateRelation.thisEmpire.counters.pirateProtectionIncome += num7;
            otherEmpire.stateMoney -= num7;
            pirateRelation.lastProtectionFeePaymentDate = starDate;
        }
        pirateRelation.diplomacyFactor = diplomacyFactor;
        const neutralizationAmount = f(5.0 * (timePassed / REAL_SECONDS_IN_GALACTIC_YEAR));
        pirateRelation.neutralizeEvaluation(neutralizationAmount);
        let evaluationLongRelationship = f(0);
        if (pirateRelation.type === PirateRelationType.Protection) {
            const num8 = pirateRelation.relationshipLength(starDate);
            const num9 = Math.trunc(REAL_SECONDS_IN_GALACTIC_YEAR * 1000.0 * 0.5);
            if (num8 > num9) {
                const num10 = REAL_SECONDS_IN_GALACTIC_YEAR * 1000.0 * 0.16667;
                evaluationLongRelationship = f((num8 - num9) / num10);
                evaluationLongRelationship = Math.max(f(0), Math.min(f(20), evaluationLongRelationship));
            }
        }
        if (empire.piratePlayStyle !== PiratePlayStyle.Pirate) pirateRelation.evaluationLongRelationship = evaluationLongRelationship;
        pirateRelation.evaluationCovetedColonies = calculatePirateDesireControlColoniesCommon(empire, otherEmpire, 3);
        if (empire.controlDiplomacyTreaties === AutomationLevel.Undefined) continue; // AutomationLevel.Manual
        switch (pirateRelation.type) {
            case PirateRelationType.None:
                if (empire.pirateEmpireBaseHabitat === null || !determineDesirePirateProtectionCore(galaxy, empire, otherEmpire)) break;
                if (otherEmpire.pirateEmpireBaseHabitat !== null) {
                    if (starDate >= num4) {
                        const refusalCount2: RefCount = { value: 0 };
                        if (checkTaskAuthorized(galaxy, empire, empire.controlDiplomacyTreaties, refusalCount2, automationMessage('Automation Pirate Protection To Pirates', otherEmpire.name), otherEmpire, AdvisorMessageType.TreatyOffer, null, new BoxedPirateRelationType(PirateRelationType.Protection), null)) {
                            const text = gameText('Pirate Offer Protection Other Pirate');
                            const empireMessage = new EmpireMessage(empire, EmpireMessageType.PirateOfferProtection, null);
                            empireMessage.description = text;
                            empireMessage.money = 0;
                            sendEmpireMessage(empireMessage, otherEmpire);
                            pirateRelation.lastOfferDate = starDate;
                        }
                    }
                } else if (checkWithinProximityOfNearestColony(galaxy, otherEmpire, empire, num) && starDate >= num4) {
                    const num11 = calculatePirateProtectionPricePerMonth(galaxy, empire, otherEmpire).price;
                    const refusalCount3: RefCount = { value: 0 };
                    if (checkTaskAuthorized(galaxy, empire, empire.controlDiplomacyTreaties, refusalCount3, automationMessage('Automation Pirate Protection', otherEmpire.name, num11), otherEmpire, AdvisorMessageType.TreatyOffer, null, new BoxedPirateRelationType(PirateRelationType.Protection), null)) {
                        const text2 = gameText('Pirate Offer Protection');
                        const empireMessage2 = new EmpireMessage(empire, EmpireMessageType.PirateOfferProtection, null);
                        empireMessage2.description = text2;
                        empireMessage2.money = Math.trunc(num11) | 0;
                        sendEmpireMessage(empireMessage2, otherEmpire);
                        pirateRelation.lastOfferDate = starDate;
                    }
                }
                break;
            case PirateRelationType.Protection:
                if (empire.pirateEmpireBaseHabitat !== null && !determineDesirePirateProtectionCore(galaxy, empire, otherEmpire) && starDate >= num5) {
                    const pirateRelation2 = obtainPirateRelation(otherEmpire, empire);
                    const refusalCount: RefCount = { value: 0 };
                    if (checkTaskAuthorized(galaxy, empire, empire.controlDiplomacyTreaties, refusalCount, automationMessage('Automation Cancel Pirate Protection', otherEmpire.name, pirateRelation2.monthlyProtectionFeeToThisEmpire), otherEmpire, AdvisorMessageType.TreatyOffer, null, new BoxedPirateRelationType(PirateRelationType.None), null)) {
                        changePirateRelation(empire, otherEmpire, PirateRelationType.None, starDate);
                        const description = otherEmpire.pirateEmpireBaseHabitat === null ? gameText('Pirates Cancel Pirate Protection Normal') : gameText('Pirates Cancel Pirate Protection Pirates');
                        sendMessageToEmpire(empire, otherEmpire, EmpireMessageType.CancelPirateProtection, empire, description);
                    }
                }
                break;
        }
    }
    for (let k = 0; k < pirateRelationList.length; k++) empire.pirateRelations.remove(pirateRelationList[k]);
}

// ---------------------------------------------------------------------------------------------------------------
// Selling information (Empire.1.cs 4359, Galaxy.cs 2818, Empire.5.cs 1163)
// ---------------------------------------------------------------------------------------------------------------

/** Galaxy.6.cs 4481 FindNearestUnexploredSystem(x, y, empire) (over Empire.SystemVisibility). No Rnd. */
function findNearestUnexploredSystem(galaxy: Galaxy, x: number, y: number, empire: Empire): Habitat | null {
    let num = Number.MAX_VALUE;
    let result: Habitat | null = null;
    const list = empire.visibility.systemVisibility;
    for (let i = 0; i < list.length; i++) {
        const systemVisibility = list[i];
        if (!empire.visibility.checkSystemExplored(systemVisibility.systemStar.systemIndex)) {
            const num2 = galaxy.calculateDistanceSquared(x, y, systemVisibility.systemStar.xpos, systemVisibility.systemStar.ypos);
            if (num2 < num) {
                result = systemVisibility.systemStar;
                num = num2;
            }
        }
    }
    return result;
}

export interface SaleableInfo {
    unmetEmpires: Empire[];
    unexploredSystems: Habitat[];
    independentColonies: Habitat[];
    ruinHabitats: Habitat[];
    debrisFieldLocations: GalaxyLocation[];
    planetDestroyerLocations: GalaxyLocation[];
    restrictedAreaLocations: GalaxyLocation[];
}

/** Galaxy.StoryCluesEnabled (game option; the TS createGame keeps story clues off). */
const STORY_CLUES_ENABLED = false;

/** Empire.5.cs 1163 GenerateSaleableInfoForEmpire(pirateFaction, buyingEmpire, out ...). No Rnd. */
export function generateSaleableInfoForEmpire(galaxy: Galaxy, pirateFaction: Empire | null, buyingEmpire: Empire | null): SaleableInfo {
    const info: SaleableInfo = { unmetEmpires: [], unexploredSystems: [], independentColonies: [], ruinHabitats: [], debrisFieldLocations: [], planetDestroyerLocations: [], restrictedAreaLocations: [] };
    if (buyingEmpire === null || pirateFaction === null || pirateFaction.pirateEmpireBaseHabitat === null) return info;
    const base = pirateFaction.pirateEmpireBaseHabitat;
    for (let i = 0; i < galaxy.empires.length; i++) {
        const empire = galaxy.empires[i];
        if (empire == null || empire === buyingEmpire) continue;
        let flag = false;
        if (pirateFaction.pirateEmpireBaseHabitat !== null) {
            const pirateRelation = obtainPirateRelation(pirateFaction, empire);
            if (pirateRelation.type !== PirateRelationType.NotMet) flag = true;
        }
        if (!flag) continue;
        if (buyingEmpire.pirateEmpireBaseHabitat !== null) {
            const pirateRelation2 = obtainPirateRelation(buyingEmpire, empire);
            if (pirateRelation2.type === PirateRelationType.NotMet) info.unmetEmpires.push(empire);
            continue;
        }
        const diplomaticRelation = obtainDiplomaticRelation(buyingEmpire, empire);
        if (diplomaticRelation.type === DiplomaticRelationType.NotMet) {
            const pirateRelation3 = obtainPirateRelation(pirateFaction, empire);
            if (pirateRelation3.type !== PirateRelationType.NotMet) info.unmetEmpires.push(empire);
        }
    }
    if (buyingEmpire.capital !== null) {
        const habitat = findNearestUnexploredSystem(galaxy, buyingEmpire.capital.xpos, buyingEmpire.capital.ypos, buyingEmpire);
        if (habitat !== null && pirateFaction.visibility.checkSystemExplored(habitat.systemIndex)) info.unexploredSystems.push(habitat);
    } else if (buyingEmpire.pirateEmpireBaseHabitat !== null) {
        const habitat2 = findNearestUnexploredSystem(galaxy, buyingEmpire.pirateEmpireBaseHabitat.xpos, buyingEmpire.pirateEmpireBaseHabitat.ypos, buyingEmpire);
        if (habitat2 !== null && pirateFaction.visibility.checkSystemExplored(habitat2.systemIndex)) info.unexploredSystems.push(habitat2);
    }
    // Perf: the C#'s two passes over Habitats (independent colonies, then ruins) fused into one — both only read and
    // each appends to its own list, so both lists get the same habitats in the same order.
    for (let j = 0; j < galaxy.habitats.length; j++) {
        const habitat3 = galaxy.habitats[j];
        if (habitat3.empire === galaxy.independentEmpire && pirateFaction.visibility.checkSystemExplored(habitat3.systemIndex) && !buyingEmpire.visibility.checkSystemExplored(habitat3.systemIndex)) info.independentColonies.push(habitat3);
        const habitat4 = habitat3;
        if (habitat4.ruin != null && (habitat4.empire === null || habitat4.empire === galaxy.independentEmpire) && pirateFaction.visibility.checkSystemExplored(habitat4.systemIndex)) {
            const num = galaxy.calculateDistance(habitat4.xpos, habitat4.ypos, base.xpos, base.ypos);
            if (num < SECTOR_SIZE * 2.0 && !buyingEmpire.visibility.checkSystemExplored(habitat4.systemIndex)) info.ruinHabitats.push(habitat4);
        }
    }
    if (buyingEmpire.visibility.knownGalaxyLocations == null) return info;
    const known = pirateFaction.visibility.knownGalaxyLocations;
    const buyerKnown = buyingEmpire.visibility.knownGalaxyLocations;
    for (let l = 0; l < known.length; l++) {
        const galaxyLocation = known[l];
        if (galaxyLocation == null) continue;
        if (galaxyLocation.type === GalaxyLocationType.DebrisField) {
            if (!buyerKnown.includes(galaxyLocation)) {
                const c = galaxyLocation.resolveLocationCenter();
                const num2 = galaxy.calculateDistance(c.x, c.y, base.xpos, base.ypos);
                if (num2 < SECTOR_SIZE * 3.0) info.debrisFieldLocations.push(galaxyLocation);
            }
        } else if (galaxyLocation.type === GalaxyLocationType.PlanetDestroyer) {
            if (!buyerKnown.includes(galaxyLocation)) {
                const c2 = galaxyLocation.resolveLocationCenter();
                const num3 = galaxy.calculateDistance(c2.x, c2.y, base.xpos, base.ypos);
                if (num3 < SECTOR_SIZE * 3.0) info.planetDestroyerLocations.push(galaxyLocation);
            }
        } else if (galaxyLocation.type === GalaxyLocationType.RestrictedArea && (STORY_CLUES_ENABLED || (galaxyLocation.name !== formatGameTextNow('Dead Zone') && galaxyLocation.name !== formatGameTextNow('NAME Weapons Testing Range', ['Pozdac']))) && !buyerKnown.includes(galaxyLocation)) {
            const c3 = galaxyLocation.resolveLocationCenter();
            const num4 = galaxy.calculateDistance(c3.x, c3.y, base.xpos, base.ypos);
            if (num4 < SECTOR_SIZE * 3.0) info.restrictedAreaLocations.push(galaxyLocation);
        }
    }
    return info;
}

/** Sends one sell-info offer (the shared shape of Galaxy.cs 2897-2998). */
function sendSellInfo(pirateFaction: Empire, empire: Empire, type: EmpireMessageType, subject: unknown, text: string, price: number): void {
    const empireMessage = new EmpireMessage(pirateFaction, type, subject);
    empireMessage.description = text;
    empireMessage.money = Math.trunc(price) | 0;
    sendEmpireMessage(empireMessage, empire);
}

/**
 * Galaxy.cs 2818 GeneratePirateOffersForSingleEmpire(pirateFaction, empire).
 * Rnd: NextDouble, Next(0, 3); then per attempt (≤ 10) Next(0, 4) and Next(0, list) for a non-empty list.
 */
export function generatePirateOffersForSingleEmpire(galaxy: Galaxy, pirateFaction: Empire, empire: Empire | null): boolean {
    let flag = false;
    if (empire !== null && pirateFaction !== galaxy.playerEmpire) {
        const pirateRelation = obtainPirateRelation(pirateFaction, empire);
        if (pirateRelation != null) {
            let num = Math.trunc(REAL_SECONDS_IN_GALACTIC_YEAR * 3.0 * 1000.0);
            const num2 = empire.pirateRelations.countKnownPirateFactions();
            const num3 = Math.min(10.0, Math.max(1.0, num2 / 3.0));
            num = Math.trunc(num * num3);
            const num4 = Math.trunc(REAL_SECONDS_IN_GALACTIC_YEAR * 0.5);
            const num5 = Math.trunc((num4 * 0.5 + num4 * 0.5 * galaxy.rnd.nextDouble()) * num3);
            num += num5;
            const currentStarDate = galaxyStarDate(galaxy);
            const num6 = currentStarDate - num;
            switch (galaxy.rnd.next(0, 3)) {
                case 0: {
                    if (!determineDesirePirateProtectionCore(galaxy, pirateFaction, empire)) break;
                    let num15 = Math.trunc(REAL_SECONDS_IN_GALACTIC_YEAR * 1.5 * 1000.0);
                    num15 = Math.trunc(num15 * num3);
                    const num16 = currentStarDate - num15;
                    if (pirateRelation.type !== PirateRelationType.Protection && pirateRelation.lastOfferDate < num16) {
                        let text8 = gameText('Pirate Offer Protection');
                        if (pirateFaction.pirateEmpireBaseHabitat !== null && empire.pirateEmpireBaseHabitat !== null) text8 = gameText('Pirate Offer Protection Other Pirate');
                        sendMessageToEmpire(pirateFaction, empire, EmpireMessageType.PirateOfferProtection, null, text8);
                        pirateRelation.lastOfferDate = currentStarDate;
                    }
                    break;
                }
                case 1:
                case 2: {
                    if (pirateRelation.lastInfoDate >= num6) break;
                    const info = generateSaleableInfoForEmpire(galaxy, pirateFaction, empire);
                    if (!checkEmpireHasHyperDriveTech(empire)) {
                        info.unmetEmpires.length = 0;
                        info.unexploredSystems.length = 0;
                    }
                    if (info.unmetEmpires.length > 0) {
                        const array = info.unmetEmpires.slice();
                        for (const item of array) {
                            if (empire !== null && !checkEmpireHasHyperDriveTech(empire)) {
                                const idx = info.unmetEmpires.indexOf(item);
                                if (idx >= 0) info.unmetEmpires.splice(idx, 1);
                            }
                        }
                    }
                    let flag2 = false;
                    if (info.unmetEmpires.length > 0 || info.unexploredSystems.length > 0 || info.independentColonies.length > 0 || info.ruinHabitats.length > 0 || info.debrisFieldLocations.length > 0 || info.restrictedAreaLocations.length > 0 || info.planetDestroyerLocations.length > 0) flag2 = true;
                    const num7 = empire.stateMoney * 0.75;
                    if (!flag2) break;
                    let num8 = 0;
                    while (!flag && num8 < 10) {
                        switch (galaxy.rnd.next(0, 4)) {
                            case 0:
                                if (info.unmetEmpires.length > 0) {
                                    const index7 = galaxy.rnd.next(0, info.unmetEmpires.length);
                                    const text7 = gameText('Pirate Offer Contact Empire');
                                    let value = totalColonyStrategicValue(info.unmetEmpires[0]) / 200.0;
                                    value = netRound(value, 0);
                                    value = Math.min(value, 10000.0);
                                    if (num7 >= value) {
                                        sendSellInfo(pirateFaction, empire, EmpireMessageType.SellInfoUnmetEmpire, info.unmetEmpires[index7], text7, value);
                                        flag = true;
                                    }
                                }
                                break;
                            case 1:
                                if (info.unexploredSystems.length > 0) {
                                    const index5 = galaxy.rnd.next(0, info.unexploredSystems.length);
                                    const text5 = gameText('Pirate Offer System Map');
                                    const num13 = 2000.0;
                                    if (num7 >= num13) {
                                        sendSellInfo(pirateFaction, empire, EmpireMessageType.SellInfoSystemMap, info.unexploredSystems[index5], text5, num13);
                                        flag = true;
                                    }
                                }
                                break;
                            case 2:
                                if (info.independentColonies.length > 0) {
                                    const index6 = galaxy.rnd.next(0, info.independentColonies.length);
                                    const text6 = gameText('Pirate Offer Independent Colony');
                                    const num14 = 20000.0;
                                    if (num7 >= num14) {
                                        sendSellInfo(pirateFaction, empire, EmpireMessageType.SellInfoIndependentColony, info.independentColonies[index6], text6, num14);
                                        flag = true;
                                    }
                                }
                                break;
                            case 3:
                                if (info.ruinHabitats.length > 0) {
                                    const index = galaxy.rnd.next(0, info.ruinHabitats.length);
                                    const text = gameText('Pirate Offer Discovery');
                                    const num9 = 30000.0;
                                    if (num7 >= num9) {
                                        sendSellInfo(pirateFaction, empire, EmpireMessageType.SellInfoRuins, info.ruinHabitats[index], text, num9);
                                        flag = true;
                                    }
                                } else if (info.restrictedAreaLocations.length > 0) {
                                    const index2 = galaxy.rnd.next(0, info.restrictedAreaLocations.length);
                                    const text2 = gameText('Pirate Offer Discovery');
                                    const num10 = 30000.0;
                                    if (num7 >= num10) {
                                        sendSellInfo(pirateFaction, empire, EmpireMessageType.SellInfoRestrictedArea, info.restrictedAreaLocations[index2], text2, num10);
                                        flag = true;
                                    }
                                } else if (info.debrisFieldLocations.length > 0) {
                                    const index3 = galaxy.rnd.next(0, info.debrisFieldLocations.length);
                                    const text3 = gameText('Pirate Offer Discovery');
                                    const num11 = 30000.0;
                                    if (num7 >= num11) {
                                        sendSellInfo(pirateFaction, empire, EmpireMessageType.SellInfoDebrisField, info.debrisFieldLocations[index3], text3, num11);
                                        flag = true;
                                    }
                                } else if (info.planetDestroyerLocations.length > 0) {
                                    const index4 = galaxy.rnd.next(0, info.planetDestroyerLocations.length);
                                    const text4 = gameText('Pirate Offer Discovery');
                                    const num12 = 30000.0;
                                    if (num7 >= num12) {
                                        sendSellInfo(pirateFaction, empire, EmpireMessageType.SellInfoPlanetDestroyer, info.planetDestroyerLocations[index4], text4, num12);
                                        flag = true;
                                    }
                                }
                                break;
                        }
                        if (flag) pirateRelation.lastInfoDate = currentStarDate;
                        num8++;
                    }
                    break;
                }
            }
        }
    }
    return flag;
}

/** Empire.1.cs 4359 PirateGenerateSellInfoOffers. Rnd: Next(0, relations) + GeneratePirateOffersForSingleEmpire's per relation tried. */
export function pirateGenerateSellInfoOffersCore(galaxy: Galaxy, empire: Empire): void {
    if (empire === galaxy.playerEmpire) return;
    // `_ = _Galaxy.ColonyFillFactor;` — no effect.
    const num = galaxy.rnd.next(0, empire.pirateRelations.count);
    for (let i = num; i < empire.pirateRelations.count; i++) {
        const pirateRelation = empire.pirateRelations.get(i);
        if (pirateRelation != null && pirateRelation.type !== PirateRelationType.NotMet && pirateRelation.evaluation > f(-10) && generatePirateOffersForSingleEmpire(galaxy, empire, pirateRelation.otherEmpire)) return;
    }
    for (let j = 0; j < Math.min(num, empire.pirateRelations.count); j++) {
        const pirateRelation2 = empire.pirateRelations.get(j);
        if (pirateRelation2 != null && pirateRelation2.type !== PirateRelationType.NotMet && pirateRelation2.evaluation > f(-10) && generatePirateOffersForSingleEmpire(galaxy, empire, pirateRelation2.otherEmpire)) break;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Empire.7.cs 2666 PirateTradeItems
// ---------------------------------------------------------------------------------------------------------------


/** Empire.7.cs 2666 PirateTradeItems. Rnd per met relation: NextDouble; Next(0, items) when tech is offered. */
export function pirateTradeItemsCore(galaxy: Galaxy, empire: Empire): void {
    const currentStarDate = galaxyStarDate(galaxy);
    if (empire === galaxy.playerEmpire) return;
    for (let i = 0; i < empire.pirateRelations.count; i++) {
        const pirateRelation = empire.pirateRelations.get(i);
        if (pirateRelation.type === PirateRelationType.NotMet || pirateRelation.otherEmpire === null) continue;
        const otherEmpire = pirateRelation.otherEmpire;
        let num = Math.trunc(REAL_SECONDS_IN_GALACTIC_YEAR * 2.0 * 1000.0);
        const num2 = otherEmpire.pirateRelations.countKnownPirateFactions();
        const num3 = Math.min(7.0, Math.max(1.0, num2 / 3.0));
        num = Math.trunc(num * num3);
        const num4 = Math.trunc(REAL_SECONDS_IN_GALACTIC_YEAR * 0.5);
        const num5 = Math.trunc((num4 * 0.5 + num4 * 0.5 * galaxy.rnd.nextDouble()) * num3);
        num += num5;
        const num6 = currentStarDate - num;
        if (pirateRelation.lastInfoDate > num6) continue;
        const num7 = Math.trunc(pirateRelation.evaluation);
        const tradeableItemList: TradeableItem[] = [];
        // Galaxy.cs 686 AllowTechTrading: the wizard's "Enable tech trading" option (Start.2.cs 499).
        if (galaxy.allowTechTrading) {
            let num8 = 0;
            if (otherEmpire === galaxy.playerEmpire && galaxy.difficultyLevel > 1.0) num8 = Math.trunc(20.0 * (galaxy.difficultyLevel - 1.0));
            if (num7 >= num8) {
                let includeSpecialTech = false;
                let num9 = 30;
                if (otherEmpire === galaxy.playerEmpire) num9 = Math.trunc(30.0 * galaxy.difficultyLevel);
                if (num7 >= num9) includeSpecialTech = true;
                // includeWarpColonizationWeapons: false.
                tradeableItemList.push(...resolveTradeableItemsResearchProjects(galaxy, empire, otherEmpire, true, includeSpecialTech));
            }
        }
        if (tradeableItemList.length <= 0) continue;
        const index = galaxy.rnd.next(0, tradeableItemList.length);
        const tradeableItem = tradeableItemList[index];
        let flag = true;
        let description = 'We offer ';
        if (tradeableItem.type === TradeableItemType.ResearchProject) {
            let arg = tradeableItem.toString();
            const researchNode = (tradeableItem.item as TechNode | null) ?? null;
            if (researchNode !== null) arg = researchNode.def.name;
            description = gameText('Trade Tech', arg, String(tradeableItem.value));
            const num10 = tradeableItem.value * 1.2;
            if (otherEmpire.stateMoney < num10) flag = false;
            if (otherEmpire.research != null && researchNode !== null) {
                const researchNode2 = findNodeById(otherEmpire.research.techTree, researchNode.def.projectId);
                if (researchNode2 !== null && (researchNode2.isResearched || researchNode2.progress > f(0.8))) flag = false;
            }
        }
        if (flag) {
            pirateRelation.lastInfoDate = currentStarDate;
            sendMessageToEmpire(empire, otherEmpire, EmpireMessageType.OfferTrade, tradeableItem, description);
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Empire.3.cs 4213 AcceptPirateProtection (ProcessMessages PirateOfferProtection, diplomacyTick.ts)
// ---------------------------------------------------------------------------------------------------------------

/** Empire.3.cs 3443 CancelAttacksAgainstEmpire(empire): ship / fleet attack missions (M4m) then ClearOutlawsFromEmpire. */
export function cancelAttacksAgainstEmpire(galaxy: Galaxy, self: Empire, empire: Empire): void {
    cancelAttackMissionsAgainstEmpire(galaxy, self, empire);
    clearOutlawsFromEmpire(self, empire);
}

/** Empire.3.cs 4213 AcceptPirateProtection(pirateEmpire, monthlyPrice). No Rnd. */
export function acceptPirateProtection(galaxy: Galaxy, empire: Empire, pirateEmpire: Empire, monthlyPrice: number): void {
    changePirateRelation(pirateEmpire, empire, PirateRelationType.Protection, galaxyStarDate(galaxy), monthlyPrice);
    let num = pirateEmpire.pirateMissions.indexOfTarget(empire, EmpireActivityType.Attack);
    let iterationCount = 0;
    while ((iterationCount++, iterationCount <= 200) && num >= 0) {
        const empireActivity = pirateEmpire.pirateMissions.at(num);
        if (empireActivity !== null && empireActivity.requestingEmpire !== null && empireActivity.requestingEmpire !== pirateEmpire && pirateEmpire !== null) {
            const pirateRelation = obtainPirateRelation(empireActivity.requestingEmpire, pirateEmpire);
            pirateRelation.evaluationPirateMissionsFail = f(pirateRelation.evaluationPirateMissionsFail - 20);
        }
        pirateEmpire.pirateMissions.items.splice(num, 1);
        num = pirateEmpire.pirateMissions.indexOfTarget(empire, EmpireActivityType.Attack);
    }
    if (monthlyPrice > 0.0) {
        empire.stateMoney -= monthlyPrice;
        pirateEmpire.stateMoney += monthlyPrice;
        pirateEmpire.pirateEconomy.performIncome(monthlyPrice, PirateIncomeType.ProtectionAgreement, galaxyStarDate(galaxy));
        pirateEmpire.counters.pirateProtectionIncome += monthlyPrice;
    }
    cancelAttacksAgainstEmpire(galaxy, pirateEmpire, empire);
    cancelAttacksAgainstEmpire(galaxy, empire, pirateEmpire);
}
