// M4q — ExecuteCommands case Colonize (BuiltObject.2.cs 936) and its callees.
//
// Ports (statement for statement, same Galaxy.Rnd draw order): BuiltObject.2.cs 936 case Colonize; Empire.1.cs 16
// MakeHabitatIntoColony(habitat, empire, race, newPopulationAmount); Empire.3.cs 3557 CheckPirateEmpireHasCriminalNetwork;
// Galaxy.2.cs 4798 ChanceNewColonyGovernor.
//
// The handler has the `CommandHandler` signature from executeCommands.ts: it receives the shared locals
// (`CommandContext`) and returns the C# `result` (0.0 when the case breaks without setting it).
//
// Rnd (a populated target): Next(0, 80), Next(0, 20) (only when the likeliness check fails), Next(0, 20); after a
// colonisation Next(0, 3) and Next(30000, 70000) / Next(7000, 20000) for intelligent / loyal natives, the troop / research
// / ability callees, ChanceNewColonyGovernor's Next(0, num) and GenerateNewCharacter.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { Habitat } from '../types';
import type { Race } from '../data/races';
import { Cargo, CargoList, ResourceRef, TroopType } from '../cargo';
import { Population, PopulationList } from '../population';
import { BuiltObjectRole } from '../data/designSpecifications';
import type { Design } from '../design';
import type { CommandHandler } from './executeCommands';
import { Command, CommandAction } from './mission';
import { MOVEMENT_PRECISION, IMPULSE_MARGIN, baconMovementSettings } from '../movement';
import { checkColonyShipMissionCancelled } from '../combat/attackAI';
import { canBuiltObjectColonizeHabitat, selectRandomNextResearchProjectExcludeSuperWeapons } from '../construction/constructionQueue';
import { checkColonizationLikeliness } from '../tradeItems';
import { checkAtWar, checkEmpireHasColonizationTech } from '../forceStructure';
import { reviewEmpireTerritory } from '../exploration';
import { generateNewTroop, habitatGenerateNewTroop, reviewColonyTroopGarrison, charactersCanGenerateAmountNonIntelligenceAgent } from '../troops';
import { doResearchBreakthrough } from '../researchTick';
import { EmpireMessageType, resolveDescription, sendMessageToEmpire, sendMessageToEmpireWithTitle } from '../messages';
import { formatGameTextNow } from '../textResolver';
import { sendNewEmpireRaceAbilityEvent } from '../events';
import { reviewEmpireAbilityBonusesFull } from '../treasury';
import { raceAggressionLevel } from '../racePeriodic';
import { setColonyTaxRate } from '../taxes';
import { CharacterRole, generateNewCharacter } from '../characters';
import { builtObjectCompleteTeardown } from '../combat/teardown';
import { canBuildDesign } from '../designGeneration';
import { facilitiesCountCompletedByType } from '../construction/facilities';
import { PlanetaryFacilityType } from '../researchSystem';
import { pirateColonyControl } from '../combat/invasion';
import { takeOwnershipOfColonyFull } from '../combat/ownership';
import { purchaseNewBuiltObject } from '../construction/empireConstruction';
import { determineBuiltObjectIsState } from '../builtObject';
import { scenarioEmit } from '../scenario/hooks';
import { rimTraderColonyCapBlocks } from '../scenario/rimTrade/common';


/** Empire.3.cs 3557 CheckPirateEmpireHasCriminalNetwork(empire). No Rnd. */
export function checkPirateEmpireHasCriminalNetwork(empire: Empire | null): boolean {
    if (empire !== null && empire.colonies != null) {
        for (let i = 0; i < empire.colonies.length; i++) {
            const habitat: Habitat = empire.colonies[i];
            if (habitat != null && habitat.facilities !== null) {
                const num = facilitiesCountCompletedByType(habitat.facilities, PlanetaryFacilityType.PirateCriminalNetwork);
                if (num > 0 && pirateColonyControl(habitat).checkFactionHasControl(empire)) return true;
            }
        }
    }
    return false;
}

/**
 * Empire.1.cs 16 MakeHabitatIntoColony(habitat, empire, race, newPopulationAmount) (`self` = the C# `this`). No Rnd.
 */
export function makeHabitatIntoColonyRuntime(galaxy: Galaxy, self: Empire, habitat: Habitat | null, empire: Empire, race: Race, newPopulationAmount: number): void {
    if (habitat === null) return;
    takeOwnershipOfColonyFull(galaxy, self, habitat, empire, false, false);
    habitat.isRefuellingDepot = true;
    const population = new Population(race, newPopulationAmount, galaxy);
    if (habitat.population == null) habitat.population = new PopulationList();
    habitat.population.add(population);
    habitat.population.recalculateTotalAmount();
    if (empire !== null) {
        if (empire !== galaxy.independentEmpire && empire === galaxy.playerEmpire && galaxy !== null && galaxy.colonyNames !== null && galaxy.colonyNames.length > galaxy.colonyNameIndex) {
            const name = galaxy.colonyNames[galaxy.colonyNameIndex];
            galaxy.colonyNameIndex++;
            habitat.name = name;
        }
        setColonyTaxRate(galaxy, empire, habitat, false);
        if (habitat.cargo === null) habitat.cargo = new CargoList();
        const amount = 2000;
        for (let i = 0; i < galaxy.resourceSystem.fuelResources.length; i++) {
            const resourceDefinition = galaxy.resourceSystem.fuelResources[i];
            const cargo = new Cargo(new ResourceRef(resourceDefinition.resourceId), amount, empire);
            habitat.cargo.add(cargo);
        }
    }
}

/** Race.CharacterRandomAppearanceChanceGovernor (races.txt, default 1.0). */
function raceCharacterRandomAppearanceChanceGovernor(race: Race): number {
    return (race as Race & { characterRandomAppearanceChanceGovernor?: number }).characterRandomAppearanceChanceGovernor ?? 1.0;
}

/** Galaxy.2.cs 4798 ChanceNewColonyGovernor(empire, colony). Rnd: Next(0, num) (+ GenerateNewCharacter on a 1). */
export function chanceNewColonyGovernor(galaxy: Galaxy, empire: Empire | null, colony: Habitat | null): boolean {
    if (empire !== null && colony !== null && empire.colonies != null && empire.colonies.length > 1) {
        let num = 15;
        if (empire.dominantRace !== null) num = Math.max(2, Math.trunc(num / raceCharacterRandomAppearanceChanceGovernor(empire.dominantRace)));
        if (galaxy.rnd.next(0, num) === 1 && charactersCanGenerateAmountNonIntelligenceAgent(empire) > 0) {
            const character = generateNewCharacter(galaxy, empire, CharacterRole.ColonyGovernor, colony).character;
            const title = formatGameTextNow('New Character Event Title', [resolveDescription(CharacterRole, character.role)]);
            const description = formatGameTextNow('New Character Event Colony Governor', [colony.name, character.name]);
            sendMessageToEmpireWithTitle(empire, empire, EmpireMessageType.CharacterAppearance, character, description, title);
            return true;
        }
    }
    return false;
}


/** BuiltObject.2.cs 936 case Colonize. */
export const cmdColonize: CommandHandler = (ctx) => {
    const { galaxy, bo, mission, command, timePassed } = ctx;
    let result = 0.0;
    const target = command.targetHabitat;
    if (target !== null && !target.hasBeenDestroyed) {
        const targetHabitat10 = target;
        const num104 = galaxy.calculateDistance(targetHabitat10.xpos, targetHabitat10.ypos, bo.xpos, bo.ypos);
        let num105 = MOVEMENT_PRECISION * 4;
        if (bo.inView) num105 = MOVEMENT_PRECISION + IMPULSE_MARGIN;
        if (num104 <= num105) {
            const empire = bo.empire!;
            const { result: canColonize, newPopulationAmount } = canBuiltObjectColonizeHabitat(galaxy, empire, bo, targetHabitat10);
            // Mod layer 19a: the Concord AI founds no colony past its cap (tasks/19a-rim-trader.md R2); the mission is cancelled.
            if (canColonize && !(galaxy.scenario !== null && rimTraderColonyCapBlocks(galaxy, empire))) {
                if (targetHabitat10.owner === null || targetHabitat10.owner === galaxy.independentEmpire) {
                    let empty2 = '';
                    let text2 = '';
                    let flag32 = true;
                    targetHabitat10.population.recalculateTotalAmount();
                    const dominantRace = targetHabitat10.population.dominantRace;
                    if (targetHabitat10.population.totalAmount > 0 && dominantRace !== null) {
                        let race = bo.nativeRace;
                        if (race === null) race = empire.dominantRace;
                        const num106 = checkColonizationLikeliness(galaxy, targetHabitat10, race!);
                        const num107 = galaxy.rnd.next(0, 80) - 40;
                        if (num106 <= 0 && num106 < num107 && galaxy.rnd.next(0, 20) !== 1) flag32 = false;
                        if (galaxy.rnd.next(0, 20) === 8) flag32 = false;
                        text2 = !flag32
                            ? ' ' + formatGameTextNow('The existing population repelled colonization', [dominantRace.name]) + '.'
                            : ' ' + formatGameTextNow('The existing population joined our empire', [dominantRace.name]) + '.';
                    }
                    if (flag32) {
                        let flag33 = false;
                        if (empire !== null && empire.pirateEmpireBaseHabitat !== null && !checkEmpireHasColonizationTech(empire) && !checkPirateEmpireHasCriminalNetwork(empire)) flag33 = true;
                        if (flag33) {
                            if (bo.nativeRace !== null) makeHabitatIntoColonyRuntime(galaxy, empire, targetHabitat10, galaxy.independentEmpire!, bo.nativeRace, newPopulationAmount);
                            else makeHabitatIntoColonyRuntime(galaxy, empire, targetHabitat10, galaxy.independentEmpire!, empire.dominantRace!, newPopulationAmount);
                        } else if (bo.nativeRace !== null) {
                            makeHabitatIntoColonyRuntime(galaxy, empire, targetHabitat10, empire, bo.nativeRace, newPopulationAmount);
                        } else {
                            makeHabitatIntoColonyRuntime(galaxy, empire, targetHabitat10, empire, empire.dominantRace!, newPopulationAmount);
                        }
                        reviewEmpireTerritory(galaxy, true);
                        empty2 = empty2 + formatGameTextNow('NAME colonized', [targetHabitat10.name]) + '.' + text2;
                        if (!flag33 && galaxy.rnd.next(0, 3) > 0 && dominantRace !== null) {
                            if (raceAggressionLevel(galaxy, dominantRace) > 110) {
                                const troop4 = generateNewTroop(empire.generateTroopDescription(dominantRace.troopName), TroopType.Infantry, 100, empire, dominantRace);
                                troop4.colony = targetHabitat10;
                                targetHabitat10.troops!.add(troop4);
                                empire.troops.add(troop4);
                                empty2 = empty2 + ' ' + formatGameTextNow('They have trained some new troops for us');
                                reviewColonyTroopGarrison(galaxy, empire, targetHabitat10, checkAtWar(empire), galaxy.difficultyLevel);
                            } else if (dominantRace.intelligence > 110) {
                                const researchNode = selectRandomNextResearchProjectExcludeSuperWeapons(galaxy, empire);
                                if (researchNode !== null) {
                                    const num108 = Math.fround(galaxy.rnd.next(30000, 70000));
                                    researchNode.progress = Math.fround(researchNode.progress + num108);
                                    if (researchNode.progress >= researchNode.cost) {
                                        doResearchBreakthrough(galaxy, empire, researchNode, true, true, false);
                                        empty2 = empty2 + ' ' + formatGameTextNow('They have advanced our understanding of X breakthrough', [researchNode.def.name]);
                                    } else {
                                        empty2 = empty2 + ' ' + formatGameTextNow('They have advanced our understanding of X', [researchNode.def.name]);
                                    }
                                }
                            } else if (dominantRace.loyalty > 110) {
                                const num109 = galaxy.rnd.next(7000, 20000);
                                empire.stateMoney += num109;
                                empty2 = empty2 + ' ' + formatGameTextNow('They have presented us with a gift of X credits', [String(num109)]);
                            }
                        }
                        sendMessageToEmpire(empire, empire, EmpireMessageType.NewColony, targetHabitat10, empty2);
                        if (galaxy.scenario !== null) scenarioEmit(galaxy, 'colonyFounded', { colony: targetHabitat10, empire }); // mod layer
                        builtObjectCompleteTeardown(galaxy, bo);
                        if (flag33) return result;
                        let race2 = dominantRace;
                        if (race2 === null) race2 = bo.nativeRace;
                        if (race2 !== null) {
                            const { descriptions: list2, raceChanged } = reviewEmpireAbilityBonusesFull(galaxy, empire);
                            if (list2 !== null && list2.length > 0 && raceChanged !== null) {
                                let flag34 = false;
                                if (targetHabitat10.population != null && targetHabitat10.population.items.length > 0) {
                                    for (let num110 = 0; num110 < targetHabitat10.population.items.length; num110++) {
                                        if (targetHabitat10.population.items[num110].race === raceChanged) {
                                            flag34 = true;
                                            break;
                                        }
                                    }
                                }
                                if (flag34) {
                                    // BuiltObject.2.cs 1074-1080.
                                    sendNewEmpireRaceAbilityEvent(empire, 'Colonization Race Ability Bonus', ':\n', targetHabitat10, raceChanged, list2);
                                }
                            }
                        }
                        chanceNewColonyGovernor(galaxy, empire, targetHabitat10);
                        if (empire === null || empire.policy == null || targetHabitat10 === null) return result;
                        if (empire.policy.colonyActionForNewTroopRecruitment) {
                            const troop5 = habitatGenerateNewTroop(galaxy, targetHabitat10, TroopType.Infantry, null, false);
                            if (troop5 !== null) {
                                troop5.readiness = 100;
                                if (!targetHabitat10.troops!.contains(troop5)) targetHabitat10.troops!.add(troop5);
                                if (empire !== null && empire.troops != null && !empire.troops.contains(troop5)) empire.troops.add(troop5);
                                reviewColonyTroopGarrison(galaxy, empire, targetHabitat10, checkAtWar(empire), galaxy.difficultyLevel);
                            }
                        }
                        const buildDesign = empire.policy.colonyActionForNewBuildDesign as Design | null;
                        if (buildDesign !== null && canBuildDesign(empire, buildDesign, false) && buildDesign.role === BuiltObjectRole.Base) {
                            // BuiltObject.2.cs 1108-1109: isStateOwned = DetermineBuiltObjectIsState(SubRole);
                            // Empire.PurchaseNewBuiltObject(design, targetHabitat10, isStateOwned, isAutoControlled: true) (Empire.6.cs 1991).
                            const isStateOwned = determineBuiltObjectIsState(buildDesign.subRole);
                            purchaseNewBuiltObject(galaxy, empire, buildDesign, targetHabitat10, isStateOwned, true);
                        }
                    } else {
                        empty2 += formatGameTextNow('Colonization attempt failed', [targetHabitat10.name]);
                        empty2 = empty2 + '.' + text2;
                        sendMessageToEmpire(empire, empire, EmpireMessageType.NewColonyFailed, targetHabitat10, empty2);
                        builtObjectCompleteTeardown(galaxy, bo);
                    }
                } else {
                    checkColonyShipMissionCancelled(galaxy, bo, 1);
                    mission.completeCommand();
                    bo.firstExecutionOfCommand = true;
                }
            } else {
                checkColonyShipMissionCancelled(galaxy, bo, 2);
                mission.completeCommand();
                bo.firstExecutionOfCommand = true;
            }
        } else {
            mission.completeCommand();
            const command13 = Command.forTarget(CommandAction.MoveTo, targetHabitat10);
            const boMission = bo.mission as typeof mission;
            boMission.insertCommandAtTop(command13);
            if (num105 > baconMovementSettings.hyperJumpThreshhold && bo.warpSpeed > 0) {
                const command14 = Command.forTarget(CommandAction.ConditionalHyperTo, targetHabitat10);
                boMission.insertCommandAtTop(command14);
            }
            bo.firstExecutionOfCommand = true;
            result = timePassed;
        }
    } else {
        if (target !== null && target.hasBeenDestroyed) checkColonyShipMissionCancelled(galaxy, bo, 3);
        mission.completeCommand();
        bo.firstExecutionOfCommand = true;
    }
    return result;
};
