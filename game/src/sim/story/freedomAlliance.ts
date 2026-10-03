// The Return of the Shakturi climax: the Freedom Alliance (Galaxy.8.cs 2058 GenerateFreedomAlliance), the story panel's two
// answers (Main.Part4.cs 5006 btnStoryEventAction_Click / 5028 btnStoryEventClose_Click, the "Ancient Guardians Reveal All"
// panel of story level 2 and "The Galaxy's Last Hope" of level 4) and the Shakturi's defeat (Galaxy.1.cs 794
// DecimateEmpire; GuardiansDepart is empireAbsorb.ts).
//
// The answers are player commands (player/playerOps.ts storyEventAction / storyEventClose), so they are journaled and
// replay; the UI shows the panel (ui/messagePopups.ts showStoryEventPopup) from the HISTORY_OFFER_STORYMESSAGE_ACCEPT
// reply (player/conversationReplies.ts), with the level it was shown at.
//
// Galaxy.Rnd: GenerateFreedomAlliance draws GenerateNewBuiltObject's per ship (name, parking point, heading); the war /
// treaty changes draw what ChangeDiplomaticRelation / DeclareWar draw (character events, the mutual-defense flow-on).
// DecimateEmpire draws Next(0, 100) per built object (then NextDouble for a damaged one) and Next(0, 10) per colony.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { Design } from '../design';
import type { BuiltObject } from '../builtObject';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { ShipGroup, empireShipGroups } from '../fleets/shipGroup';
import { compareShipGroups, shipGroupAddShipToFleet, shipGroupUpdate } from '../fleets/shipGroupTasks';
import { netSort } from '../netSort';
import { designsFindNewestCanBuild } from '../forceStructure';
import { generateNewBuiltObject } from '../empireEvents';
import { takeOwnershipOfBuiltObject, takeOwnershipOfColonyFull, clearColony } from '../combat/ownership';
import { builtObjectCompleteTeardown } from '../combat/teardown';
import { damageBuiltObjectComponents } from '../gameStartTail';
import { obtainDiplomaticRelation, obtainEmpireEvaluation, DiplomaticRelationType } from '../diplomacy';
import { changeDiplomaticRelation, declareWar, processEndOfWarWithEmpire, resetAttitudeLevelsAtEndOfWar } from '../diplomacyTick';
import { sendNewsBroadcastWarStartEnd } from '../events';
import { militaryPotency } from '../treasury';
import { galaxyStarDate } from '../tick/simTime';
import { VictoryConditions } from '../victory';
import { generateDeliverancePlanetDestroyer, generateShakturiInvasion } from './storyEvents';

/** Galaxy.2.cs 2074 ResolveRaceFamilyDescription(raceFamilyId): RaceFamiliesStatic[id].Name, or "" out of range. */
export function resolveRaceFamilyDescription(galaxy: Galaxy, raceFamilyId: number): string {
    if (raceFamilyId >= 0 && raceFamilyId < galaxy.raceFamilies.length) return galaxy.raceFamilies[raceFamilyId].name;
    return '';
}

/**
 * Game.GlobalVictoryConditions as GenerateFreedomAlliance writes it (`ref Game game`). A game the wizard starts always has
 * one (Start.2.cs CreateGameFromSettings); a game built without victory conditions (tests, the dev autostart) gets an empty
 * one here — no threshold, territory, economy or population condition (the C# would throw instead).
 */
function globalVictoryConditionsFor(galaxy: Galaxy): VictoryConditions {
    if (galaxy.globalVictoryConditions === null) galaxy.globalVictoryConditions = new VictoryConditions();
    return galaxy.globalVictoryConditions;
}

/**
 * Port of Galaxy.8.cs 2058 GenerateFreedomAlliance(includePlayer, ref game): the humanoid empires (and the Ackdarians) and
 * the Ancient Guardians (the Mechanoid empire) end their wars with each other, sign mutual defense pacts (+30 bias, incident
 * evaluation ≥ 10) and declare a locked war on the Shakturi (−30 bias). The strongest of them by MilitaryPotency (the
 * player, when it joins; else the Mechanoids) gets the "Guardian Fleet": Mechanoid-designed escorts, frigates, destroyers,
 * cruisers, capital ships, troop transports, carriers and resupply ships (×2 in galaxies of 700+ stars), gathered at the
 * Mechanoid capital. The Guardians stop being reclusive. With the player in the alliance the story victory is armed: the
 * player must keep the Mechanoid capital (DefendHabitat) and take or destroy the Shakturi capital (TargetHabitat).
 * Returns the fleet (null without a Mechanoid empire or a leader).
 */
export function generateFreedomAlliance(galaxy: Galaxy, includePlayer: boolean): ShipGroup | null {
    let shipGroup: ShipGroup | null = null;
    let empire: Empire | null = null;
    let empire2: Empire | null = null;
    const empireList: Empire[] = [];
    const player = galaxy.playerEmpire;
    if (includePlayer && player !== null) empireList.push(player);
    let empire3: Empire | null = null;
    for (let i = 0; i < galaxy.empires.length; i++) {
        const empire4 = galaxy.empires[i];
        if (empire4 === player) continue;
        // 2076: ResolveRaceFamilyDescription(empire4.DominantRace.FamilyId) is read before the null checks.
        const text = empire4.dominantRace !== null ? resolveRaceFamilyDescription(galaxy, empire4.dominantRace.raceFamily) : '';
        if ((empire4.dominantRace !== null && text.toLowerCase() === 'humanoid') || (empire4.dominantRace !== null && empire4.dominantRace.name.toLowerCase() === 'ackdarian')) {
            if (empire3 === null || militaryPotency(galaxy, empire3) < militaryPotency(galaxy, empire4)) empire3 = empire4;
            empireList.push(empire4);
        } else if (empire4.dominantRace !== null && empire4.dominantRace.name.toLowerCase() === 'mechanoid') {
            empire2 = empire4;
            empireList.push(empire4);
        }
        if (empire4.dominantRace !== null && empire4.dominantRace === galaxy.shakturiActualRace) {
            empire = empire4;
            const at = empireList.indexOf(empire);
            if (at >= 0) empireList.splice(at, 1);
        }
    }
    if (includePlayer) empire3 = player;
    if (empire3 === null) empire3 = empire2;
    if (empire2 === null) return shipGroup;
    const currentStarDate = galaxyStarDate(galaxy);
    // 2112-2149
    for (let j = 0; j < empireList.length; j++) {
        const empire5 = empireList[j];
        for (let k = 0; k < empireList.length; k++) {
            if (empire5 === empireList[k]) continue;
            const diplomaticRelation = obtainDiplomaticRelation(empire5, empireList[k]);
            if (diplomaticRelation.type === DiplomaticRelationType.War) {
                resetAttitudeLevelsAtEndOfWar(galaxy, diplomaticRelation);
                diplomaticRelation.type = DiplomaticRelationType.None;
                diplomaticRelation.lastDiplomacyTradeOfferDate = currentStarDate;
                const diplomaticRelation2 = obtainDiplomaticRelation(empireList[k], empire5);
                diplomaticRelation2.type = DiplomaticRelationType.None;
                diplomaticRelation2.lastDiplomacyTradeOfferDate = currentStarDate;
                processEndOfWarWithEmpire(galaxy, empire5, empireList[k]);
                processEndOfWarWithEmpire(galaxy, empireList[k], empire5);
                changeDiplomaticRelation(galaxy, empire5, diplomaticRelation, DiplomaticRelationType.None);
                sendNewsBroadcastWarStartEnd(empire5, diplomaticRelation);
            }
            if (diplomaticRelation.type !== DiplomaticRelationType.MutualDefensePact) {
                changeDiplomaticRelation(galaxy, empire5, diplomaticRelation, DiplomaticRelationType.MutualDefensePact, true);
                const empireEvaluation = obtainEmpireEvaluation(galaxy, empire5, empireList[k]);
                empireEvaluation.incidentEvaluation = Math.max(10.0, empireEvaluation.incidentEvaluationStock);
                empireEvaluation.bias = empireEvaluation.biasStock + 30.0;
                const empireEvaluation2 = obtainEmpireEvaluation(galaxy, empireList[k], empire5);
                empireEvaluation2.incidentEvaluation = Math.max(10.0, empireEvaluation2.incidentEvaluationStock);
                empireEvaluation2.bias = empireEvaluation2.biasStock + 30.0;
            }
        }
        // 2145-2147 (the C# would throw on a missing Shakturi empire; the story only gets here once it exists).
        if (empire !== null) {
            obtainDiplomaticRelation(empire5, empire);
            declareWar(galaxy, empire5, empire, null, true);
            const ev = obtainEmpireEvaluation(galaxy, empire5, empire);
            ev.bias = ev.biasStock - 30.0;
        }
    }
    // 2150-2215
    const num = galaxy.starCount < 700 ? 1 : 2;
    if (empire3 !== null) {
        shipGroup = new ShipGroup(galaxy);
        shipGroup.name = 'Guardian Fleet';
        shipGroup.empire = empire3;
        const groups = empireShipGroups(empire3);
        groups.push(shipGroup);
        netSort(groups, compareShipGroups);
        for (let l = 0; l < 8; l++) {
            let design: Design | null = null;
            let num2 = 0;
            switch (l) {
                case 0:
                    design = designsFindNewestCanBuild(empire2.designs, BuiltObjectSubRole.Escort);
                    num2 = 3 * num;
                    break;
                case 1:
                    design = designsFindNewestCanBuild(empire2.designs, BuiltObjectSubRole.Frigate);
                    num2 = 4 * num;
                    break;
                case 2:
                    design = designsFindNewestCanBuild(empire2.designs, BuiltObjectSubRole.Destroyer);
                    num2 = 3 * num;
                    break;
                case 3:
                    design = designsFindNewestCanBuild(empire2.designs, BuiltObjectSubRole.Cruiser);
                    num2 = 2 * num;
                    break;
                case 4:
                    design = designsFindNewestCanBuild(empire2.designs, BuiltObjectSubRole.CapitalShip);
                    num2 = num;
                    break;
                case 5:
                    design = designsFindNewestCanBuild(empire2.designs, BuiltObjectSubRole.TroopTransport);
                    num2 = 2 * num;
                    break;
                case 6:
                    design = designsFindNewestCanBuild(empire2.designs, BuiltObjectSubRole.Carrier);
                    num2 = 2 * num;
                    break;
                case 7:
                    design = designsFindNewestCanBuild(empire2.designs, BuiltObjectSubRole.ResupplyShip);
                    num2 = num;
                    break;
            }
            if (design === null || num2 <= 0) continue;
            for (let m = 0; m < num2; m++) {
                const builtObject = generateNewBuiltObject(galaxy, empire2, design, empire2.capital);
                builtObject.maintenanceSavings = Math.fround(0.2);
                takeOwnershipOfBuiltObject(galaxy, empire3, builtObject, empire3, false);
                if (builtObject.subRole !== BuiltObjectSubRole.ResupplyShip) shipGroupAddShipToFleet(galaxy, shipGroup, builtObject);
                builtObject.isAutoControlled = false;
            }
        }
        shipGroup.gatherPoint = empire2.capital !== null ? empire2.capital : empire3.capital;
        shipGroupUpdate(galaxy, shipGroup);
    }
    empire2.reclusive = false;
    if (includePlayer) {
        const gvc = globalVictoryConditionsFor(galaxy);
        gvc.defendHabitat = empire2.capital;
        gvc.defendHabitatEmpire = empire2;
        gvc.targetHabitat = empire !== null ? empire.capital : null;
        gvc.targetHabitatEmpire = empire;
    }
    return shipGroup;
}

/** The story panel's (pnlStoryEvent) answer buttons exist only for the "Ancient Guardians Reveal All" (2) and "The Galaxy's
 *  Last Hope" (4) levels (Main.Part4.cs 4926-4951 method_572). */
export function storyEventHasChoice(level: number): boolean {
    return level === 2 || level === 4;
}

/**
 * Main.Part4.cs 5006 btnStoryEventAction_Click: at level 4 the player takes the Deliverance planet destroyer
 * (GenerateDeliverancePlanetDestroyer), at level 2 it joins the Freedom Alliance (GenerateFreedomAlliance(true)). Returns
 * what the UI then selects and zooms to (method_208 / method_157 / method_4(1.0)), or null.
 */
export function storyEventAction(galaxy: Galaxy, level: number): BuiltObject | ShipGroup | null {
    if (level === 4) return generateDeliverancePlanetDestroyer(galaxy);
    if (level === 2) return generateFreedomAlliance(galaxy, true);
    return null;
}

/**
 * Main.Part4.cs 5028 btnStoryEventClose_Click: refusing the alliance at level 2 forms it without the player
 * (GenerateFreedomAlliance(false)), launches the Shakturi invasion of the Guardians' capital (GenerateShakturiInvasion with
 * the last Shakturi / Mechanoid empires in Galaxy.Empires order) and moves the story to level 3. Any other level: nothing.
 */
export function storyEventClose(galaxy: Galaxy, level: number): void {
    if (level !== 2) return;
    generateFreedomAlliance(galaxy, false);
    let empire: Empire | null = null;
    let empire2: Empire | null = null;
    for (let i = 0; i < galaxy.empires.length; i++) {
        const e = galaxy.empires[i];
        if (e.dominantRace !== null && e.dominantRace === galaxy.shakturiActualRace) empire2 = e;
        if (e.dominantRace !== null && e.dominantRace.name.toLowerCase() === 'mechanoid') empire = e;
    }
    if (empire !== null && empire2 !== null) generateShakturiInvasion(galaxy, empire2, empire);
    galaxy.storyReturnOfTheShakturiEventLevel = 3;
}

/**
 * Port of Galaxy.1.cs 794 DecimateEmpire(empire, decimatingEmpire): the defeated Shakturi lose most of what they have. Each
 * of their ships and bases (private, then state; a copy of the lists) is torn down (Next(0, 100) > 20), damaged by a random
 * portion (> 5: DamageBuiltObjectComponents(NextDouble)) or spared; each colony (a copy) is wiped out by the decimating
 * empire (Next(0, 10) > 3, while the empire still has more than two colonies), turned independent with its bases and troops
 * destroyed (> 0), or kept.
 */
export function decimateEmpire(galaxy: Galaxy, empire: Empire, decimatingEmpire: Empire | null): void {
    const builtObjectList: BuiltObject[] = [];
    builtObjectList.push(...empire.privateBuiltObjects);
    builtObjectList.push(...empire.builtObjects);
    for (let i = 0; i < builtObjectList.length; i++) {
        const num = galaxy.rnd.next(0, 100);
        if (num > 20) builtObjectCompleteTeardown(galaxy, builtObjectList[i]);
        else if (num > 5) damageBuiltObjectComponents(builtObjectList[i], galaxy.rnd.nextDouble());
    }
    const habitatList = empire.colonies.slice();
    for (let j = 0; j < habitatList.length; j++) {
        const num2 = galaxy.rnd.next(0, 10);
        if (num2 > 3 && empire.colonies.length > 2) clearColony(galaxy, habitatList[j], decimatingEmpire);
        else if (num2 > 0) takeOwnershipOfColonyFull(galaxy, empire, habitatList[j], galaxy.independentEmpire, true, true);
    }
}
