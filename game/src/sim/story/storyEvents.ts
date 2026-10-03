// M4z3 — the story lines at runtime (tasks/M4-deferred-plan.md row M4z3):
//   "Return of the Shakturi" (Galaxy.StoryReturnOfTheShakturiEnabled = VictoryConditions.EnableStoryEvents): the Mechanoid
//     "Ancient Guardians", the Beacon of Shaktur trigger ruin, the Erutkah refugees (the disguised Shakturi), their convoys,
//     enrage and invasion — Galaxy.8.cs 1348-2056, Empire.2.cs 3474-3777 (CheckOfferStoryHint drives the event levels).
//   "Distant Worlds" / Ancient Galaxy (Galaxy.StoryDistantWorldsEnabled): the galactic-history story clues — Galaxy.5.cs
//     3622-3942 (clue selection and texts) and the ruin / abandoned-ship clue hooks.
//   Legends race achievements: Empire.1.cs 3899 CheckSendShipConvoysViaGateway (a RaceAchievement wonder with Value2 == 3).
// The start-of-game story set-up (Start.2.cs 1730-2016) is story/storyStart.ts; the Shadows pre-warp branches stay with the
// pre-warp events in empireEvents.ts.
//
// Galaxy.Rnd draws, in C# order:
//   ShakturiSendConvoy: Next(0, 3) (only for the Shakturi empire), then the convoy's.
//   GenerateMilitaryConvoy / GenerateCivilianConvoy: per ship Next(0, 10), SelectRelativeParkingPoint (NextDouble, Next(0, 2),
//     NextDouble) and GenerateNewBuiltObject's (name, parking point, heading, colony-ship race).
//   CheckSendShipConvoysViaGateway: Next(0, 10), Next(0, 3), Next(7, 22) + the convoy's.
//   CheckOfferStoryHint: Next(0, 4) (Zenox / Quameno friends), SelectUnusedSecondaryStoryClueIndex Next(0, n),
//     GenerateShakturiReturnTriggerRuins' (FindNearestGalaxyEdgeCoordsMinimumRange NextDouble, FindLonelyHabitat*).
//   GenerateShakturi: Next(7000, 10000) enrage timer, then GenerateEmpire's and the empire set-up's (space ports, mining,
//     research stations, starting ships, missions, Galaxy.DoTasks).
//   GenerateAncientHelpers: GenerateEmpire's, SelectBarrenRockPlanet / SelectHabitatQuality / SelectResources per converted
//     planet, Next(500, 600) Loros Fruit, then the set-up's.
//   Story clues: GenerateIndependentColonyStoryClue Next(0, n); GenerateSecondaryStoryClue case 8 FindLonelyNebulaLocation's,
//     Next(110000, 200000), Next(0.15·stars, 0.25·stars).

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { planetsOf, type Habitat } from '../types';
import { HabitatCategoryType, HabitatType } from '../types';
import type { BuiltObject } from '../builtObject';
import type { Design } from '../design';
import type { Race } from '../data/races';
import { Ruin, RuinType } from '../ruins';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { BuiltObjectMissionPriority, BuiltObjectMissionType } from '../missions/mission';
import { assignMission, clearPreviousMissionRequirements } from '../missions/assign';
import { designsFindNewestCanBuild, totalMobileMilitaryFirepower, checkEmpireHasHyperDriveTech } from '../forceStructure';
import { generateNewBuiltObject } from '../empireEvents';
import { takeOwnershipOfBuiltObject, clearColony } from '../combat/ownership';
import { identifyMechanoidEmpire, identifyNearestAvailableFleet } from '../fleets/militaryAI';
import { shipGroupAssignMission } from '../fleets/shipGroup';
import { getFirstAvailableWithinRange } from './eventActions';
import { declareWar } from '../diplomacyTick';
import { resolveStandardRaceBias } from '../raceBias';
import { MAX_SOLAR_SYSTEM_SIZE } from '../visibility';
import { BuiltObjectRole } from '../data/designSpecifications';
import { Galaxy as GalaxyClass, galaxyRace } from '../galaxy';
import { getGovernmentsStatic } from '../empire';
import type { Government } from '../data/governments';
import { generateEmpire } from '../empireGeneration';
import { SystemVisibilityStatus, setEmpireExplorationAmount } from '../visibility';
import { recalculateEmpirePopulation, recalculateEmpireCorruption, reviewTaxes } from '../taxes';
import { resetEmpireTouchTimesForAge } from '../tick/gameStart';
import {
    checkColoniesForBaseFacilities,
    createMiningStations,
    createResearchStations,
    createSpacePorts,
    determineNewSpacePortLocations,
    determineResearchStationLocation,
    setLuxuryResourcesAtColonies,
} from '../stationPlacement';
import { setColonyResources } from '../colony';
import { processColonyTroops } from '../troops';
import { recalculateAnnualTaxRevenue } from '../forceStructure';
import { createPrivateShips, createStateShips, fillShipsWithTroops } from '../builtObjectPlacement';
import { assignMissionsToBuiltObjectList } from '../civilianAI';
import { galaxyDoTasks } from '../tick/galaxyTick';
import { obtainEmpireEvaluation, obtainDiplomaticRelation, DiplomaticRelationType, DiplomaticStrategy } from '../diplomacy';
import { obtainPirateRelation, PirateRelationType } from '../pirateRelations';
import { PirateIncomeType } from '../pirates/pirateEconomy';
import { loadEmpirePolicy, PlanetaryFacilityType, WonderType } from '../researchSystem';
import { generatePlanetDestroyerDesign } from '../designGeneration';
import { generateDesignFromSpec } from '../designGeneration';
import { FreedomAllianceFamily, resolveMajorShipImageIndex } from '../shipImageHelper';
import { EmpireMessageType, sendMessageToEmpire, sendMessageToEmpireWithTitle } from '../messages';
import { calculateEmpireWarValue } from '../diplomacyTick';
import { galaxyStarDate, REAL_SECONDS_IN_GALACTIC_YEAR } from '../tick/simTime';
import { startStarDateForAge } from '../galaxyTime';
import { cloneDesign, galaxyDesignSpecificationBySubRole, findLonelyHabitat, findLonelyHabitatAt, findLonelyHabitatGalacticEdge, generateUnownedBuiltObjectFromDesign, BuiltObjectEncounterAction, BuiltObjectEncounterEventType } from '../gameStartTail';
import { findNearestHabitatUnoccupiedSystem } from '../startHabitats';
import { determineAngle } from '../creature';
import { gameText } from '../colonyTick';
import { resolveDescription } from '../messages';
import { sendEventMessageToEmpire } from '../events';
import { EventMessageType } from '../eventTypes';
import { addLocationHint } from '../tradeItems';
import { resolveSectorDescription } from '../empireEvents';
import { GalaxyLocationEffectType, GalaxyLocationType, type GalaxyLocation } from '../galaxyLocation';
import { formatGameTextNow } from '../textResolver';

// ---------------------------------------------------------------------------
// Galaxy helpers the story needs (Galaxy.5.cs / Galaxy.7.cs / Galaxy.cs)
// ---------------------------------------------------------------------------

/** Galaxy.8.cs 1633 IdentifyShakturiEmpire: the non-pirate empire whose DominantRace is ShakturiActualRace. No Rnd. */
export function identifyShakturiEmpire(galaxy: Galaxy): Empire | null {
    let result: Empire | null = null;
    if (galaxy.shakturiActualRace !== null) {
        for (let i = 0; i < galaxy.empires.length; i++) {
            if (galaxy.empires[i].pirateEmpireBaseHabitat === null && galaxy.empires[i].dominantRace !== null && galaxy.empires[i].dominantRace === galaxy.shakturiActualRace) {
                result = galaxy.empires[i];
                break;
            }
        }
    }
    return result;
}

export { identifyMechanoidEmpire };

/** RaceList this[raceName] (RaceList.cs 15): case-insensitive name match (over this galaxy's race instances, galaxyRace). */
export function galaxyRaceByName(galaxy: Galaxy, raceName: string): Race | null {
    for (const baseRace of galaxy.races) {
        const race = galaxyRace(galaxy, baseRace);
        if (race.name.toLowerCase() === raceName.toLowerCase()) return race;
    }
    return null;
}

/** GovernmentAttributesList.cs 30 GetFirstByAvailability(availability). */
function governmentsGetFirstByAvailability(availability: number): Government | null {
    for (const g of getGovernmentsStatic()) if (g !== null && g.availability === availability) return g;
    return null;
}

/** RaceFamilyList.cs 18 GetIdsBySpecialFunctionCode(code). */
function raceFamilyIdsBySpecialFunctionCode(galaxy: Galaxy, specialFunctionCode: number): number[] {
    const list: number[] = [];
    for (let index = 0; index < galaxy.raceFamilies.length; ++index) {
        const raceFamily = galaxy.raceFamilies[index];
        if (raceFamily != null && raceFamily.specialFunctionCode === specialFunctionCode) list.push(raceFamily.raceFamilyId);
    }
    return list;
}

/** Galaxy.cs 984 ExpectedMaximumColoniesInGalaxy. No Rnd. */
export function expectedMaximumColoniesInGalaxy(galaxy: Galaxy): number {
    let num = 0.47;
    if (galaxy.starCount >= 1400) num = 0.38;
    else if (galaxy.starCount >= 1000) num = 0.41;
    else if (galaxy.starCount >= 700) num = 0.42;
    else if (galaxy.starCount >= 400) num = 0.43;
    num *= galaxy.colonyPrevalence;
    return Math.trunc(galaxy.starCount * num);
}

/** Galaxy.5.cs 4657 FindNearestGalaxyEdgeCoords(x, y): the point on the galaxy's circular rim opposite the centre. No Rnd. */
export function findNearestGalaxyEdgeCoords(galaxy: Galaxy, x: number, y: number): { x: number; y: number } {
    const hx = Math.trunc(galaxy.sizeX / 2);
    const hy = Math.trunc(galaxy.sizeY / 2);
    const num = determineAngle(x, y, hx, hy);
    const num2 = galaxy.calculateDistance(x, y, hx, hy);
    const num3 = hx - num2;
    const num4 = num - Math.PI;
    const num5 = x + Math.cos(num4) * num3;
    const num6 = y + Math.sin(num4) * num3;
    let val = Math.trunc(num5);
    let val2 = Math.trunc(num6);
    val = Math.min(galaxy.sizeX - 1, Math.max(0, val));
    val2 = Math.min(galaxy.sizeY - 1, Math.max(0, val2));
    return { x: val, y: val2 };
}

/**
 * Galaxy.5.cs 4626 FindNearestGalaxyEdgeCoordsMinimumRange(x, y, minimumRange, minimumRangeToColony). Rnd: NextDouble per
 * retry (≤ 200) while the edge point is too close to (x, y) or to a colony (independents excluded).
 */
export function findNearestGalaxyEdgeCoordsMinimumRange(galaxy: Galaxy, x: number, y: number, minimumRange: number, minimumRangeToColony: number): { x: number; y: number } {
    let result = findNearestGalaxyEdgeCoords(galaxy, x, y);
    let num = galaxy.calculateDistance(x, y, result.x, result.y);
    let habitat = galaxy.findNearestColony(result.x, result.y, null, false);
    let num2 = Number.MAX_VALUE;
    if (habitat !== null) num2 = galaxy.calculateDistance(result.x, result.y, habitat.xpos, habitat.ypos);
    let num3 = 0;
    const hx = Math.trunc(galaxy.sizeX / 2);
    const hy = Math.trunc(galaxy.sizeY / 2);
    while ((num < minimumRange || num2 < minimumRangeToColony) && num3 < 200) {
        const num4 = determineAngle(x, y, hx, hy);
        const num5 = galaxy.calculateDistance(x, y, hx, hy);
        let num6 = num4 - Math.PI;
        num6 += galaxy.rnd.nextDouble() * 3.0 - 1.5;
        const num7 = Math.cos(num6) * num5;
        const num8 = Math.sin(num6) * num5;
        const x2 = hx + num7;
        const y2 = hy + num8;
        result = findNearestGalaxyEdgeCoords(galaxy, x2, y2);
        num = galaxy.calculateDistance(x, y, result.x, result.y);
        habitat = galaxy.findNearestColony(result.x, result.y, null, false);
        num2 = habitat === null ? Number.MAX_VALUE : galaxy.calculateDistance(result.x, result.y, habitat.xpos, habitat.ypos);
        num3++;
    }
    return result;
}

/** Galaxy.5.cs 2836 ObtainRandomGalaxyCoordinatesFromPoint(startX, startY, distance). Rnd: NextDouble per try (≤ 200). */
export function obtainRandomGalaxyCoordinatesFromPoint(galaxy: Galaxy, startX: number, startY: number, distance: number): { x: number; y: number } {
    let num = 0;
    let x = -1.0;
    let y = -1.0;
    while ((x < 0.0 || x >= galaxy.sizeX || y < 0.0 || y >= galaxy.sizeY) && num < 200) {
        const num2 = galaxy.rnd.nextDouble() * Math.PI * 2.0;
        const num3 = Math.cos(num2) * distance;
        const num4 = Math.sin(num2) * distance;
        x = startX + num3;
        y = startY + num4;
        num++;
    }
    return { x, y };
}

/** Galaxy.7.cs 2368 FindNearestHabitat(x, y, habitatCategoryType) + 2767 FindNearestHabitatInIndex. No Rnd. */
export function findNearestHabitatOfCategory(galaxy: Galaxy, x: number, y: number, habitatCategoryType: HabitatCategoryType): Habitat | null {
    const ix = Math.trunc(x);
    const iy = Math.trunc(y);
    return galaxy.ringSearch(ix, iy, (cx, cy) => {
        let habitat: Habitat | null = null;
        let distance = Number.MAX_VALUE;
        for (const h of galaxy.habitatIndexGrid[cx][cy]) {
            const num = galaxy.calculateDistanceSquared(ix, iy, h.xpos, h.ypos);
            if (num < distance && h.category === habitatCategoryType) {
                habitat = h;
                distance = num;
            }
        }
        if (habitat !== null) distance = galaxy.calculateDistance(ix, iy, (habitat as Habitat).xpos, (habitat as Habitat).ypos);
        return { item: habitat, distance };
    });
}

/** Empire.2.cs 3474 CheckLocationHintExistsAtPoint(x, y, range). No Rnd. */
export function checkLocationHintExistsAtPoint(galaxy: Galaxy, empire: Empire, x: number, y: number, range: number): boolean {
    for (let i = 0; i < empire.locationHints.length; i++) {
        const num = galaxy.calculateDistance(x, y, empire.locationHints[i].x, empire.locationHints[i].y);
        if (num <= range) return true;
    }
    return false;
}

/** Galaxy.cs 1094 ActualStartDate (= _StartStarDate). */
function actualStartDate(galaxy: Galaxy): number {
    return startStarDateForAge(galaxy.age);
}

// ---------------------------------------------------------------------------
// Convoys (Galaxy.8.cs 1469-1617)
// ---------------------------------------------------------------------------

/** Galaxy.8.cs 1469 GenerateShakturiMilitaryConvoy(shakturiEmpire) → GenerateMilitaryConvoy(empire, 10, 0.2f). */
export function generateShakturiMilitaryConvoy(galaxy: Galaxy, shakturiEmpire: Empire): void {
    generateMilitaryConvoy(galaxy, shakturiEmpire, 10, Math.fround(0.2));
}

/**
 * Galaxy.8.cs 1474 GenerateMilitaryConvoy(empire, size, supportCostFactor): `size` warships arrive at the galaxy edge nearest
 * the capital (pirate base) and move to it. Per ship Rnd.Next(0, 10) picks the sub-role (the 50-try loop re-reads the same
 * pick), then SelectRelativeParkingPoint and GenerateNewBuiltObject.
 */
export function generateMilitaryConvoy(galaxy: Galaxy, empire: Empire, size: number, supportCostFactor: number): void {
    let habitat = empire.capital;
    if (empire.pirateEmpireBaseHabitat !== null) habitat = empire.pirateEmpireBaseHabitat;
    if (habitat === null) return;
    const point = findNearestGalaxyEdgeCoords(galaxy, habitat.xpos, habitat.ypos);
    const num = point.x;
    const num2 = point.y;
    for (let i = 0; i < size; i++) {
        let design: Design | null = null;
        const num3 = galaxy.rnd.next(0, 10);
        let num4 = 0;
        while (design === null && num4 < 50) {
            switch (num3) {
                case 0:
                    design = designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.Escort);
                    break;
                case 1:
                case 2:
                    design = designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.Frigate);
                    break;
                case 3:
                case 4:
                    design = designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.Destroyer);
                    break;
                case 5:
                case 6:
                    design = designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.Cruiser);
                    break;
                case 7:
                    design = designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.CapitalShip);
                    break;
                case 8:
                    design = designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.TroopTransport);
                    break;
                case 9:
                    design = designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.Carrier);
                    break;
            }
            num4++;
        }
        if (design !== null) {
            const p = galaxy.selectRelativeParkingPoint();
            const builtObject = generateNewBuiltObject(galaxy, empire, design, null, num + p.x, num2 + p.y);
            if (builtObject.subRole === BuiltObjectSubRole.ColonyShip) {
                builtObject.name = 'Shakturi World Ship';
                builtObject.nativeRace = empire.dominantRace;
            }
            takeOwnershipOfBuiltObject(galaxy, empire, builtObject, empire, false);
            builtObject.supportCostFactor = supportCostFactor;
            builtObject.isAutoControlled = true;
            assignMission(galaxy, builtObject, BuiltObjectMissionType.Move, habitat, null, BuiltObjectMissionPriority.Normal);
        }
    }
}

/** Galaxy.8.cs 1541 GenerateShakturiColonyConvoy(shakturiEmpire) → GenerateCivilianConvoy(empire, 10, 0.2f, "Erutkah World Ship"). */
export function generateShakturiColonyConvoy(galaxy: Galaxy, shakturiEmpire: Empire): void {
    generateCivilianConvoy(galaxy, shakturiEmpire, 10, Math.fround(0.2), 'Erutkah World Ship');
}

/** Galaxy.8.cs 1546 GenerateCivilianConvoy(empire, size, supportCostFactor, colonyShipNameOverride). Rnd as GenerateMilitaryConvoy. */
export function generateCivilianConvoy(galaxy: Galaxy, empire: Empire, size: number, supportCostFactor: number, colonyShipNameOverride: string): void {
    let habitat = empire.capital;
    if (empire.pirateEmpireBaseHabitat !== null) habitat = empire.pirateEmpireBaseHabitat;
    if (habitat === null) return;
    const point = findNearestGalaxyEdgeCoords(galaxy, habitat.xpos, habitat.ypos);
    const num = point.x;
    const num2 = point.y;
    for (let i = 0; i < size; i++) {
        let design: Design | null = null;
        const num3 = galaxy.rnd.next(0, 10);
        let num4 = 0;
        while (design === null && num4 < 50) {
            switch (num3) {
                case 0:
                    design = designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.ExplorationShip);
                    break;
                case 1:
                case 2:
                    design = designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.ColonyShip);
                    break;
                case 3:
                case 4:
                    design = designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.PassengerShip);
                    break;
                case 5:
                    design = designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.ConstructionShip);
                    break;
                case 6:
                    design = designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.GasMiningShip);
                    break;
                case 7:
                    design = designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.MiningShip);
                    break;
                case 8:
                    design = designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.Escort);
                    break;
                case 9:
                    design = designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.SmallFreighter);
                    break;
            }
            num4++;
        }
        if (design === null) continue;
        const p = galaxy.selectRelativeParkingPoint();
        const builtObject = generateNewBuiltObject(galaxy, empire, design, null, num + p.x, num2 + p.y);
        if (builtObject.subRole === BuiltObjectSubRole.ColonyShip) {
            if (colonyShipNameOverride !== null && colonyShipNameOverride !== '') builtObject.name = colonyShipNameOverride;
            builtObject.nativeRace = empire.dominantRace;
        }
        takeOwnershipOfBuiltObject(galaxy, empire, builtObject, empire, false);
        builtObject.supportCostFactor = supportCostFactor;
        builtObject.isAutoControlled = true;
        assignMission(galaxy, builtObject, BuiltObjectMissionType.Move, habitat, null, BuiltObjectMissionPriority.Normal);
    }
}

/**
 * Port of Empire.1.cs 3899 CheckSendShipConvoysViaGateway(timePassed): an empire with a colony holding a RaceAchievement
 * wonder whose Value2 is 3 (the intergalactic gateway) receives convoys. Without one the C# returns before any draw.
 * Rnd: Next(0, 10) < 8 → Next(0, 3) → Next(7, 22) convoy size + the convoy's.
 */
export function checkSendShipConvoysViaGateway(galaxy: Galaxy, empire: Empire, timePassed: number): void {
    void timePassed;
    let flag = false;
    let race: Race | null = null;
    if (empire.colonies != null) {
        for (let i = 0; i < empire.colonies.length; i++) {
            const habitat = empire.colonies[i];
            if (habitat == null || habitat.facilities == null) continue;
            for (let j = 0; j < habitat.facilities.length; j++) {
                const planetaryFacility = habitat.facilities[j];
                if (planetaryFacility != null && planetaryFacility.type === PlanetaryFacilityType.Wonder && planetaryFacility.wonderType === WonderType.RaceAchievement && planetaryFacility.value2 === 3) {
                    flag = true;
                    if (habitat.population != null) race = habitat.population.dominantRace;
                    break;
                }
            }
            if (flag) break;
        }
    }
    if (!flag) return;
    let supportCostFactor = 1;
    if (race !== null && race.name === 'Shakturi') supportCostFactor = Math.fround(0.2);
    if (galaxy.rnd.next(0, 10) < 8) {
        switch (galaxy.rnd.next(0, 3)) {
            case 0:
            case 1: {
                const size2 = galaxy.rnd.next(7, 22);
                generateMilitaryConvoy(galaxy, empire, size2, supportCostFactor);
                break;
            }
            case 2: {
                const size = galaxy.rnd.next(7, 22);
                generateCivilianConvoy(galaxy, empire, size, supportCostFactor, '');
                break;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Return of the Shakturi (Galaxy.8.cs 1348-2056, Empire.2.cs 3487-3777)
// ---------------------------------------------------------------------------

/** Race.cs 1673 Race(name, pictureRef, reproductiveRate, intelligence, aggression, caution, friendliness, loyalty, designPictureFamily, designNameIndex, troopName): other fields at their defaults (null troop-name variants). */
function newRaceCopy(race: Race): Race {
    return {
        ...race,
        troopNameArmored: null as unknown as string,
        troopNamePlanetaryDefense: null as unknown as string,
        troopNameSpecialForces: null as unknown as string,
    };
}

/**
 * Galaxy.8.cs 1348 GenerateShakturi(startingColony): the Shakturi return disguised as the "Erutkah Refugees" — the Shakturi
 * race is renamed Erutkah with friendly levels (the originals kept in ShakturiOriginalRace), an age-2 tech-7 empire is
 * generated at the colony with the "Palace of Eternal Darkness" ruin, set up like a starting empire, and every empire's
 * evaluation bias toward / from it is raised to at least 0. Rnd: Next(7000, 10000) then the set-up's (see file header).
 * The C# mutates the per-game Races["Shakturi"]; the rename and levels go to a separate per-galaxy instance
 * (Galaxy.shakturiActualRace, saved inline; galaxyRace() substitutes it for the galaxy.races entry).
 */
export function generateShakturi(galaxy: Galaxy, startingColony: Habitat | null): void {
    if (galaxy.nextEmpireId >= galaxy.maximumEmpireCount) return;
    const baseRace = galaxyRaceByName(galaxy, 'Shakturi');
    if (baseRace === null) return;
    if (startingColony === null) throw new Error('NullReferenceException: Galaxy.8.cs 1386 GenerateEmpire(startingColony: null)');
    const age = 2;
    const race2 = newRaceCopy(baseRace);
    galaxy.shakturiOriginalRace = race2;
    // This galaxy's own Races["Shakturi"] instance (the C# mutates the per-game object in place).
    const race: Race = { ...baseRace };
    galaxy.shakturiRaceBase = baseRace;
    galaxy.shakturiActualRace = race;
    race.aggression = 75;
    race.caution = 105;
    race.friendliness = 125;
    race.intelligence = 128;
    race.loyalty = 100;
    race.name = 'Erutkah';
    race.troopName = 'Erutkah Defender';
    galaxy.storyShakturiEnrageTimer = galaxyStarDate(galaxy) + galaxy.rnd.next(7000, 10000) * REAL_SECONDS_IN_GALACTIC_YEAR;
    const text = 'Normal'; // TextResolver.GetText("Normal")
    const { homeSystemFactor } = GalaxyClass.resolveHomeSystem(text);
    const empireName = 'Erutkah Refugees';
    let governmentId = 0;
    const firstByAvailability = governmentsGetFirstByAvailability(3);
    if (firstByAvailability !== null) governmentId = firstByAvailability.governmentId;
    const empire = generateEmpire(galaxy, false, empireName, startingColony, race, race.designsPictureFamilyIndex, governmentId, homeSystemFactor, text, age, 7.0, 1.0, false, 'Shakturi').empire;
    startingColony.baseQuality = 1;
    const ruin = new Ruin('Palace of Eternal Darkness', 12, 0.5, 0.0, 0.0, 0, 0, 0);
    ruin.bonusWealth = 2.0;
    ruin.playerEmpireEncountered = true;
    startingColony.ruin = ruin;
    if (galaxy.shakturiTriggerHabitat === null) throw new Error('NullReferenceException: Galaxy.8.cs 1395 DetermineHabitatSystemStar(ShakturiTriggerHabitat: null)');
    const habitat = galaxy.determineHabitatSystemStar(galaxy.shakturiTriggerHabitat);
    const status = empire.visibility.systemVisibility[habitat.systemIndex].status;
    if (status === SystemVisibilityStatus.Explored) empire.visibility.systemVisibility[habitat.systemIndex].status = SystemVisibilityStatus.Unexplored;
    if (empire.policy != null) empire.policy.constructionMilitary = 2;
    empireStorySetup(galaxy, empire, 3.5, true);
    for (let j = 0; j < galaxy.empires.length; j++) {
        const empire2 = galaxy.empires[j];
        if (empire2 !== empire) {
            const empireEvaluation = obtainEmpireEvaluation(galaxy, empire, empire2);
            if (empireEvaluation != null) empireEvaluation.bias = Math.max(0.0, empireEvaluation.bias);
        }
    }
    for (let k = 0; k < galaxy.empires.length; k++) {
        const empire3 = galaxy.empires[k];
        if (empire3 !== empire) {
            const empireEvaluation2 = obtainEmpireEvaluation(galaxy, empire3, empire);
            if (empireEvaluation2 != null) empireEvaluation2.bias = Math.max(0.0, empireEvaluation2.bias);
        }
    }
}

/**
 * Galaxy.8.cs 1400-1446: GenerateShakturi's starting-empire set-up (after the policy tweak). Exported for the mod layer's
 * createEmpireMidGame (scenario/empireMidGame.ts), which passes runGalaxyTasks = false (the closing Galaxy.DoTasks is
 * the C#'s; a scenario creates empires from inside the galaxy tick).
 */
export function empireStorySetup(galaxy: Galaxy, empire: Empire, spacePortDivisor: number, allowSameSystem: boolean, runGalaxyTasks = true): void {
    recalculateEmpirePopulation(empire);
    checkColoniesForBaseFacilities(empire);
    recalculateEmpireCorruption(empire);
    resetEmpireTouchTimesForAge(galaxy, empire); // 1404-1409: every touch = now − (LongProcessingInterval + 1) s
    const newSpacePortAmount = 1 + Math.trunc(empire.colonies.length / spacePortDivisor);
    const habitatList = determineNewSpacePortLocations(galaxy, empire, empire.colonies, newSpacePortAmount, false);
    createSpacePorts(galaxy, empire, habitatList);
    for (const item of habitatList) setColonyResources(galaxy, item, empire, true);
    checkColoniesForBaseFacilities(empire);
    createMiningStations(galaxy, empire, allowSameSystem);
    setLuxuryResourcesAtColonies(galaxy, empire);
    for (let i = 0; i < 1; i++) reviewTaxes(galaxy, empire);
    recalculateEmpirePopulation(empire);
    for (const colony of empire.colonies) {
        processColonyTroops(galaxy, empire, colony, null, 0.0, 100.0, 100.0, galaxy.difficultyLevel);
        processColonyTroops(galaxy, empire, colony, null, 0.0, 300.0, 300.0, galaxy.difficultyLevel);
        processColonyTroops(galaxy, empire, colony, null, 0.0, 300.0, 300.0, galaxy.difficultyLevel);
        recalculateAnnualTaxRevenue(galaxy, colony);
    }
    reviewTaxes(galaxy, empire);
    for (const colony2 of empire.colonies) recalculateAnnualTaxRevenue(galaxy, colony2);
    determineResearchStationLocation(galaxy, empire, false, true);
    createResearchStations(galaxy, empire, allowSameSystem);
    createStateShips(galaxy, empire);
    createPrivateShips(galaxy, empire);
    fillShipsWithTroops(galaxy, empire);
    assignMissionsToBuiltObjectList(galaxy, empire, empire.builtObjects, false, null);
    assignMissionsToBuiltObjectList(galaxy, empire, empire.privateBuiltObjects, false, null);
    if (runGalaxyTasks) galaxyDoTasks(galaxy, false, galaxy.playerEmpire);
}

/**
 * Galaxy.8.cs 1650 GenerateShakturiAggression(shakturiEmpire): the Erutkah drop the disguise — the race gets the original
 * Shakturi levels back, Shakturi-liked families (race family SpecialFunctionCode 1) get bias ≥ 40 both ways and hated ones
 * (2) ≤ −30, the empire reloads the Shakturi policy and StoryShakturiEnraged is set. No Rnd.
 */
export function generateShakturiAggression(galaxy: Galaxy, shakturiEmpire: Empire | null): void {
    if (shakturiEmpire === null || galaxy.shakturiOriginalRace === null) return;
    const original = galaxy.shakturiOriginalRace;
    if (shakturiEmpire.dominantRace !== null) {
        shakturiEmpire.dominantRace.aggression = original.aggression;
        shakturiEmpire.dominantRace.caution = original.caution;
        shakturiEmpire.dominantRace.friendliness = original.friendliness;
        shakturiEmpire.dominantRace.intelligence = original.intelligence;
        shakturiEmpire.dominantRace.loyalty = original.loyalty;
    }
    for (let i = 0; i < galaxy.empires.length; i++) {
        const empire = galaxy.empires[i];
        if (empire === shakturiEmpire) continue;
        const empireEvaluation = obtainEmpireEvaluation(galaxy, shakturiEmpire, empire);
        if (empire.dominantRace !== null) {
            if (raceFamilyIdsBySpecialFunctionCode(galaxy, 1).includes(empire.dominantRace.raceFamily)) {
                empireEvaluation.bias = Math.max(empireEvaluation.bias, 40.0);
            } else if (raceFamilyIdsBySpecialFunctionCode(galaxy, 2).includes(empire.dominantRace.raceFamily)) {
                empireEvaluation.bias = Math.min(empireEvaluation.bias, -30.0);
            }
        }
    }
    for (let j = 0; j < galaxy.empires.length; j++) {
        const empire2 = galaxy.empires[j];
        if (empire2 === shakturiEmpire) continue;
        const empireEvaluation2 = obtainEmpireEvaluation(galaxy, empire2, shakturiEmpire);
        if (empire2.dominantRace !== null) {
            if (raceFamilyIdsBySpecialFunctionCode(galaxy, 1).includes(empire2.dominantRace.raceFamily)) {
                empireEvaluation2.bias = Math.max(empireEvaluation2.bias, 40.0);
            } else if (raceFamilyIdsBySpecialFunctionCode(galaxy, 2).includes(empire2.dominantRace.raceFamily)) {
                empireEvaluation2.bias = Math.min(empireEvaluation2.bias, -30.0);
            }
        }
    }
    shakturiEmpire.policy = loadEmpirePolicy(galaxy.researchStatic, original, false);
    galaxy.storyShakturiEnraged = true;
}

/**
 * Galaxy.8.cs 1708 GenerateShakturiInvasion(shakturiEmpire, mechanoidEmpire): the race takes back its Shakturi names, the
 * empire becomes the "Shaktur Supremacy" with 1-3 planet destroyers (by star count) and a fleet at its capital, targeting
 * the Mechanoid capital. Rnd: GenerateNewBuiltObject's per ship.
 */
export function generateShakturiInvasion(galaxy: Galaxy, shakturiEmpire: Empire | null, mechanoidEmpire: Empire | null): void {
    if (shakturiEmpire === null || mechanoidEmpire === null) return;
    let parentHabitat: Habitat | null = null;
    if (shakturiEmpire.capital !== null) parentHabitat = shakturiEmpire.capital;
    else if (shakturiEmpire.colonies.length > 0) parentHabitat = shakturiEmpire.colonies[0];
    if (shakturiEmpire.dominantRace !== null) {
        const original = galaxy.shakturiOriginalRace;
        if (original === null) throw new Error('NullReferenceException: Galaxy.8.cs 1724 ShakturiOriginalRace is null');
        shakturiEmpire.dominantRace.name = original.name;
        shakturiEmpire.dominantRace.troopName = original.troopName;
        shakturiEmpire.dominantRace.troopNameArmored = original.troopNameArmored;
        shakturiEmpire.dominantRace.troopNamePlanetaryDefense = original.troopNamePlanetaryDefense; // C# TroopNameArtillery
        shakturiEmpire.dominantRace.troopNameSpecialForces = original.troopNameSpecialForces;
    }
    shakturiEmpire.name = 'Shaktur Supremacy';
    let num = 1;
    num = galaxy.starCount >= 1000 ? 3 : galaxy.starCount < 700 ? 1 : 2;
    const num2 = num;
    const design = generatePlanetDestroyerDesign(galaxy, 1.0, null, galaxyStarDate(galaxy));
    shakturiEmpire.designs.push(design);
    design.empire = shakturiEmpire;
    const array = ['Revenge of Shaktur', 'Death of Worlds', 'Dark Reaper', 'Desolation of Utopia'];
    for (let i = 0; i < num2; i++) {
        const builtObject = generateNewBuiltObject(galaxy, shakturiEmpire, design, parentHabitat);
        builtObject.name = array[i];
        builtObject.supportCostFactor = Math.fround(0.1);
    }
    for (let j = 0; j < 10; j++) {
        let design2: Design | null = null;
        let num3 = 0;
        switch (j) {
            case 0:
                design2 = designsFindNewestCanBuild(shakturiEmpire.designs, BuiltObjectSubRole.Escort);
                num3 = 5 * num;
                break;
            case 1:
                design2 = designsFindNewestCanBuild(shakturiEmpire.designs, BuiltObjectSubRole.Frigate);
                num3 = 6 * num;
                break;
            case 2:
                design2 = designsFindNewestCanBuild(shakturiEmpire.designs, BuiltObjectSubRole.Destroyer);
                num3 = 4 * num;
                break;
            case 3:
                design2 = designsFindNewestCanBuild(shakturiEmpire.designs, BuiltObjectSubRole.Cruiser);
                num3 = 3 * num;
                break;
            case 4:
                design2 = designsFindNewestCanBuild(shakturiEmpire.designs, BuiltObjectSubRole.CapitalShip);
                num3 = 2 * num;
                break;
            case 5:
                design2 = designsFindNewestCanBuild(shakturiEmpire.designs, BuiltObjectSubRole.TroopTransport);
                num3 = 2 * num;
                break;
            case 6:
                design2 = designsFindNewestCanBuild(shakturiEmpire.designs, BuiltObjectSubRole.Carrier);
                num3 = 2 * num;
                break;
            case 7:
                design2 = designsFindNewestCanBuild(shakturiEmpire.designs, BuiltObjectSubRole.ResupplyShip);
                num3 = num;
                break;
            case 8:
                design2 = designsFindNewestCanBuild(shakturiEmpire.designs, BuiltObjectSubRole.ExplorationShip);
                num3 = 2 * num;
                break;
            case 9:
                design2 = designsFindNewestCanBuild(shakturiEmpire.designs, BuiltObjectSubRole.ColonyShip);
                num3 = 2 * num;
                break;
        }
        if (design2 === null || num3 <= 0) continue;
        for (let k = 0; k < num3; k++) {
            const builtObject2 = generateNewBuiltObject(galaxy, shakturiEmpire, design2, parentHabitat);
            if (builtObject2.subRole === BuiltObjectSubRole.ColonyShip) {
                builtObject2.name = 'Shakturi World Ship';
                builtObject2.nativeRace = shakturiEmpire.dominantRace;
            }
            takeOwnershipOfBuiltObject(galaxy, shakturiEmpire, builtObject2, shakturiEmpire, false);
            builtObject2.supportCostFactor = Math.fround(0.2);
            builtObject2.isAutoControlled = true;
        }
    }
    shakturiEmpire.targetHabitat = mechanoidEmpire.capital;
}

/**
 * Galaxy.8.cs 1811 GenerateDeliverancePlanetDestroyer(): the player's own planet destroyer "Deliverance" (overpower 1.6) at
 * the capital. Only the UI calls it (Main.Part4.cs, the Shakturi story dialog). Rnd: GenerateNewBuiltObject's.
 */
export function generateDeliverancePlanetDestroyer(galaxy: Galaxy): BuiltObject {
    const player = galaxy.playerEmpire!;
    const design = generatePlanetDestroyerDesign(galaxy, 1.6, null, galaxyStarDate(galaxy));
    player.designs.push(design);
    design.empire = player;
    const builtObject = generateNewBuiltObject(galaxy, player, design, player.capital);
    builtObject.name = 'Deliverance';
    takeOwnershipOfBuiltObject(galaxy, player, builtObject, player, false);
    builtObject.supportCostFactor = Math.fround(0.1);
    builtObject.isAutoControlled = false;
    return builtObject;
}

/**
 * Galaxy.8.cs 1825 GenerateShakturiReturnTriggerRuins(): places the "Beacon of Shaktur" StoryEvent ruin (StoryEventData 1)
 * at a lonely non-ice habitat near the galaxy edge ≥ 3 sectors from the player (then from the Mechanoid capital) and records
 * it as ShakturiTriggerHabitat. Rnd: FindNearestGalaxyEdgeCoordsMinimumRange's per try (≤ 50), FindLonelyHabitat*'s.
 */
export function generateShakturiReturnTriggerRuins(galaxy: Galaxy): void {
    if (galaxy.shakturiTriggerHabitat !== null) return;
    const ruin = new Ruin('Beacon of Shaktur', 5, 0.05, 0.0, 0.0, 0, 0, 0);
    ruin.type = RuinType.StoryEvent;
    ruin.storyEventData = 1;
    let empire: Empire | null = null;
    for (let i = 0; i < galaxy.empires.length; i++) {
        if (galaxy.empires[i].dominantRace !== null && galaxy.empires[i].dominantRace!.name.toLowerCase() === 'mechanoid') empire = galaxy.empires[i];
    }
    let num = 0.0;
    let num2 = 0.0;
    const player = galaxy.playerEmpire;
    if (player !== null && player.capital !== null) {
        num = player.capital.xpos;
        num2 = player.capital.ypos;
    } else if (player !== null && player.pirateEmpireBaseHabitat !== null) {
        num = player.pirateEmpireBaseHabitat.xpos;
        num2 = player.pirateEmpireBaseHabitat.ypos;
    }
    let point = { x: 0, y: 0 };
    let num3 = 0.0;
    let num4 = 0;
    const sectorSize = galaxy.sectorSize;
    while (num3 < sectorSize * 3.0 && num4 < 50) {
        point = findNearestGalaxyEdgeCoordsMinimumRange(galaxy, num, num2, sectorSize * 2.0, sectorSize * 2.0);
        num3 = galaxy.calculateDistance(point.x, point.y, num, num2);
        if (num4 > 0 && empire !== null && empire.capital !== null) {
            num = empire.capital.xpos;
            num2 = empire.capital.ypos;
            num3 = galaxy.calculateDistance(point.x, point.y, num, num2);
        }
        num4++;
    }
    let habitat = findLonelyHabitatAt(galaxy, point.x, point.y, HabitatType.Ice);
    if (habitat === null) habitat = findLonelyHabitatGalacticEdge(galaxy, RuinType.Government);
    if (habitat === null) habitat = findLonelyHabitat(galaxy);
    if (habitat === null) habitat = findNearestHabitatOfCategory(galaxy, 0.0, 0.0, HabitatCategoryType.Moon);
    if (habitat !== null) {
        habitat.ruin = ruin;
        galaxy.shakturiTriggerHabitat = habitat;
    }
}

/**
 * Galaxy.8.cs 1889 CheckGenerateAncientHelpers(): with the Shakturi story on and no Mechanoid empire, the "Ancient Guardians"
 * are generated on an unoccupied world ("Utopia") two sectors from the player. Called by Empire.3.cs 2588 (DoResearchBreakthrough,
 * warp-drive research of a pre-warp player). Rnd: ObtainRandomGalaxyCoordinatesFromPoint's, GenerateAncientHelpers'.
 */
export function checkGenerateAncientHelpers(galaxy: Galaxy): void {
    if (!galaxy.storyReturnOfTheShakturiEnabled) return;
    const empire = identifyMechanoidEmpire(galaxy);
    if (empire === null) {
        const player = galaxy.playerEmpire!;
        let startX = 0.0;
        let startY = 0.0;
        if (player.capital !== null) {
            startX = player.capital.xpos;
            startY = player.capital.ypos;
        } else if (player.pirateEmpireBaseHabitat !== null) {
            startX = player.pirateEmpireBaseHabitat.xpos;
            startY = player.pirateEmpireBaseHabitat.ypos;
        }
        const p = obtainRandomGalaxyCoordinatesFromPoint(galaxy, startX, startY, galaxy.sectorSize * 2.0);
        const habitat = findUtopiaHabitat(galaxy, p.x, p.y);
        prepareUtopia(habitat);
        generateAncientHelpers(galaxy, habitat);
    }
}

/**
 * The Galaxy.8.cs 1911-1937 / Start.2.cs 1735-1761 FindNearestHabitatUnoccupiedSystem chain: Continental, MarshySwamp, Desert,
 * Ocean, Ice, Volcanic, BarrenRock. No Rnd.
 */
export function findUtopiaHabitat(galaxy: Galaxy, x: number, y: number): Habitat | null {
    let habitat = findNearestHabitatUnoccupiedSystem(galaxy, x, y, HabitatType.Continental);
    if (habitat === null) habitat = findNearestHabitatUnoccupiedSystem(galaxy, x, y, HabitatType.MarshySwamp);
    if (habitat === null) habitat = findNearestHabitatUnoccupiedSystem(galaxy, x, y, HabitatType.Desert);
    if (habitat === null) habitat = findNearestHabitatUnoccupiedSystem(galaxy, x, y, HabitatType.Ocean);
    if (habitat === null) habitat = findNearestHabitatUnoccupiedSystem(galaxy, x, y, HabitatType.Ice);
    if (habitat === null) habitat = findNearestHabitatUnoccupiedSystem(galaxy, x, y, HabitatType.Volcanic);
    if (habitat === null) habitat = findNearestHabitatUnoccupiedSystem(galaxy, x, y, HabitatType.BarrenRock);
    return habitat;
}

/** Galaxy.8.cs 1938-1943: clear any native population and rename the world "Utopia" (C#: NullReferenceException when none was found). */
export function prepareUtopia(habitat: Habitat | null): asserts habitat is Habitat {
    if (habitat === null) throw new Error('NullReferenceException: Galaxy.8.cs 1938 habitat.Population (no unoccupied system found for the Ancient Guardians)');
    if (habitat.population != null && habitat.population.items.length > 0) {
        habitat.population.items.length = 0; // PopulationList.Clear (List.Clear)
        habitat.population.recalculateTotalAmount();
    }
    habitat.name = 'Utopia';
}

/**
 * Galaxy.8.cs 1948 GenerateAncientHelpers(homeColony): the Mechanoid "Ancient Guardians" (government availability 2, age 1,
 * tech 7) at homeColony; every other habitable planet / moon of the system is turned to barren rock, the capital gets the
 * "Ancient Galactic Archives" ruin and Loros Fruit, the empire defends it and knows 5% of the systems. Rnd: GenerateEmpire's,
 * per converted world SelectBarrenRockPlanet / SelectHabitatQuality / SelectResources, Next(500, 600), then the set-up's.
 */
export function generateAncientHelpers(galaxy: Galaxy, homeColony: Habitat): void {
    if (galaxy.nextEmpireId >= galaxy.maximumEmpireCount) return;
    const race = galaxyRaceByName(galaxy, 'Mechanoid');
    if (race === null) return;
    const text = 'Normal';
    const { homeSystemFactor } = GalaxyClass.resolveHomeSystem(text);
    let governmentId = 0;
    const firstByAvailability = governmentsGetFirstByAvailability(2);
    if (firstByAvailability !== null) governmentId = firstByAvailability.governmentId;
    const empire = generateEmpire(galaxy, false, 'Ancient Guardians', homeColony, race, race.designsPictureFamilyIndex, governmentId, homeSystemFactor, text, 1, 7.0, 1.0).empire;
    if (empire.policy != null) {
        empire.policy.colonyAllowFacilityCloningFacility = false;
        empire.policy.colonyAllowFacilityTroopTrainingCenter = false;
        empire.policy.constructionMilitary = 1;
        empire.policy.diplomacyTradeSanctionsUseBlockades = false;
        empire.policy.warAttacksHarassEnemies = false;
    }
    homeColony.baseQuality = 1;
    const systemHabitats = planetsOf(galaxy.systems[homeColony.systemIndex]); // Galaxy.8.cs 1980 Systems[].Habitats: no star
    for (let i = 0; i < systemHabitats.length; i++) {
        const habitat = systemHabitats[i];
        if (habitat === homeColony) continue;
        if (habitat.population != null && habitat.population.totalAmount > 0) clearColony(galaxy, habitat, null);
        switch (habitat.type) {
            case HabitatType.Volcanic:
            case HabitatType.Desert:
            case HabitatType.MarshySwamp:
            case HabitatType.Continental:
            case HabitatType.Ocean:
            case HabitatType.Ice:
                if (habitat.category === HabitatCategoryType.Planet || habitat.category === HabitatCategoryType.Moon) {
                    if (habitat.ruin !== null) habitat.ruin = null;
                    const b = galaxy.selectBarrenRockPlanet();
                    habitat.type = b.type;
                    habitat.diameter = b.diameter;
                    habitat.pictureRef = b.pictureRef;
                    habitat.landscapePictureRef = b.landscapePictureRef;
                    habitat.baseQuality = galaxy.selectHabitatQuality(habitat, Math.fround(galaxy.colonyPrevalence));
                    if (habitat.resources != null) habitat.resources.length = 0;
                    galaxy.selectResources(habitat);
                }
                break;
        }
    }
    const ruin = new Ruin('Ancient Galactic Archives', 11, 0.5, -30.0, -30.0, 0, 0, 0);
    ruin.bonusWealth = 1.0;
    ruin.playerEmpireEncountered = true;
    homeColony.ruin = ruin;
    if (homeColony.resources == null) homeColony.resources = [];
    const byName = galaxy.resourceSystem.resources.find((r) => r.name === 'Loros Fruit') ?? null;
    if (byName !== null) {
        if (homeColony.resources.length < 5) {
            homeColony.resources.push({ resourceId: byName.resourceId, abundance: galaxy.rnd.next(500, 600) });
        } else {
            homeColony.resources[4] = { resourceId: byName.resourceId, abundance: galaxy.rnd.next(500, 600) };
        }
    }
    empire.defendHabitat = homeColony;
    setEmpireExplorationAmount(galaxy, empire.visibility, empire.capital!, Math.trunc(galaxy.starCount * 0.05));
    createSpacePorts(galaxy, empire, empire.colonies);
    createMiningStations(galaxy, empire, false);
    createStateShips(galaxy, empire);
    createPrivateShips(galaxy, empire);
    fillShipsWithTroops(galaxy, empire);
    assignMissionsToBuiltObjectList(galaxy, empire, empire.builtObjects, false, null);
    assignMissionsToBuiltObjectList(galaxy, empire, empire.privateBuiltObjects, false, null);
    galaxyDoTasks(galaxy, false, galaxy.playerEmpire);
}

/**
 * Empire.2.cs 3487 ShakturiSendConvoy(): the Shakturi empire (only it) draws Rnd.Next(0, 3) and on 1, while it has fewer than
 * 40 ships per colony and is not defeated, gets a military convoy once enraged, else a colony convoy.
 */
export function shakturiSendConvoy(galaxy: Galaxy, self: Empire): void {
    const empire = identifyShakturiEmpire(galaxy);
    if (empire === null || self !== empire || galaxy.rnd.next(0, 3) !== 1) return;
    const num = empire.builtObjects.length / empire.colonies.length;
    if (num < 40.0 && !galaxy.shakturiDefeated) {
        if (galaxy.storyShakturiEnraged) generateShakturiMilitaryConvoy(galaxy, self);
        else generateShakturiColonyConvoy(galaxy, self);
    }
}

/**
 * Empire.2.cs 3508 CheckOfferStoryHint(): the story advisers. Friendly Zenox / Quameno offer secret history (a secondary
 * story clue) or a secret location (Distant Worlds story); the Mechanoid (Ancient Guardians) place the Beacon of Shaktur once
 * enough colonies exist or enough years passed and warn the player as the Return of the Shakturi event level advances (0 → 4);
 * the Shakturi empire enrages on its timer and launches the invasion when at war with the Mechanoid. Rnd: see the file header.
 */
export function checkOfferStoryHint(galaxy: Galaxy, self: Empire): void {
    const player = galaxy.playerEmpire;
    if ((!galaxy.storyReturnOfTheShakturiEnabled && !galaxy.storyDistantWorldsEnabled) || player === null || self.dominantRace === null) return;
    const dominantRace = self.dominantRace;
    let num = -1;
    let flag = false;
    let flag2 = false;
    let empire = identifyShakturiEmpire(galaxy);
    let empire2 = identifyMechanoidEmpire(galaxy);
    let diplomaticRelation: ReturnType<typeof obtainDiplomaticRelation> | null = null;
    let diplomaticRelation2: ReturnType<typeof obtainDiplomaticRelation> | null = null;
    const shakturiActualRace = galaxy.shakturiActualRace;
    const race = galaxyRaceByName(galaxy, 'Mechanoid');
    if (galaxy.storyReturnOfTheShakturiEnabled) {
        for (let i = 0; i < galaxy.empires.length; i++) {
            if (galaxy.empires[i].dominantRace === shakturiActualRace && galaxy.empires[i] !== player) {
                empire = galaxy.empires[i];
                diplomaticRelation = obtainDiplomaticRelation(player, empire);
            } else if (galaxy.empires[i].dominantRace === race && galaxy.empires[i] !== player) {
                empire2 = galaxy.empires[i];
                diplomaticRelation2 = obtainDiplomaticRelation(player, empire2);
            }
        }
    }
    const raceName = dominantRace.name.toLowerCase();
    if ((raceName === 'zenox' || raceName === 'quameno') && self.pirateEmpireBaseHabitat === null) {
        let flag3 = false;
        if (player.pirateEmpireBaseHabitat === null) {
            const diplomaticRelation3 = obtainDiplomaticRelation(self, player);
            const empireEvaluation = obtainEmpireEvaluation(galaxy, self, player);
            if (
                diplomaticRelation3 != null &&
                diplomaticRelation3.type !== DiplomaticRelationType.NotMet &&
                empireEvaluation != null &&
                empireEvaluation.overallAttitude > 10 &&
                diplomaticRelation3.strategy !== DiplomaticStrategy.Conquer &&
                diplomaticRelation3.strategy !== DiplomaticStrategy.Punish &&
                diplomaticRelation3.strategy !== DiplomaticStrategy.Undermine
            ) {
                flag3 = true;
            }
        } else {
            const pirateRelation = obtainPirateRelation(self, player);
            if (pirateRelation.type === PirateRelationType.Protection && pirateRelation.evaluation > 10) flag3 = true;
        }
        if (flag3) {
            if (galaxy.rnd.next(0, 4) === 1) {
                const num2 = selectUnusedSecondaryStoryClueIndex(galaxy);
                if (num2 >= 0) {
                    const text = gameText('We offer to reveal secret history');
                    sendMessageToEmpire(self, player, EmpireMessageType.HistoryOfferStoryClue, null, text);
                    return;
                }
                if (checkStoryLocationHintExists(galaxy)) {
                    const num3 = selectUnusedStoryClue(galaxy);
                    if (num3 >= 0) {
                        let stellarObject: Habitat | BuiltObject | null = null;
                        if (galaxy.storyClueLocations != null && galaxy.storyClueLocations.length > num3) stellarObject = galaxy.storyClueLocations[num3];
                        if (stellarObject !== null && !checkLocationHintExistsAtPoint(galaxy, player, stellarObject.xpos, stellarObject.ypos, 5000.0)) {
                            const text2 = gameText('We offer to reveal a secret location');
                            sendMessageToEmpire(self, player, EmpireMessageType.HistoryOfferLocationHint, null, text2);
                            return;
                        }
                    }
                }
            } else if (galaxy.storyReturnOfTheShakturiEnabled && (diplomaticRelation2 === null || diplomaticRelation2.type === DiplomaticRelationType.NotMet)) {
                num = 2;
                flag = true;
            }
        }
    } else if (raceName === 'mechanoid') {
        const diplomaticRelation4 = obtainDiplomaticRelation(self, player);
        if (diplomaticRelation4 != null && diplomaticRelation4.type !== DiplomaticRelationType.NotMet && galaxy.storyReturnOfTheShakturiEnabled) {
            flag2 = true;
            num = 3;
            let num4 = 0;
            for (let j = 0; j < galaxy.empires.length; j++) {
                if (galaxy.empires[j] != null && galaxy.empires[j].active && galaxy.empires[j].colonies != null) num4 += galaxy.empires[j].colonies.length;
            }
            const num5 = Math.trunc(0.5 * expectedMaximumColoniesInGalaxy(galaxy));
            // Empire.9.cs 5407 (double)_Galaxy.BaseTechCost / 120000.0.
            let d = galaxy.baseTechCost / 120000.0;
            d = Math.max(1.0, Math.sqrt(d));
            let num6 = 25;
            if (galaxy.age === 0) num6 += 15;
            const yearMs = REAL_SECONDS_IN_GALACTIC_YEAR * 1000;
            const val = actualStartDate(galaxy) + yearMs * num6;
            let val2 = Math.trunc(num6 * d);
            val2 = Math.min(val2, 120);
            const num7 = Math.max(val2, 80);
            const num8 = actualStartDate(galaxy) + yearMs * num7;
            let val3 = actualStartDate(galaxy) + yearMs * val2;
            val3 = Math.max(val3, val);
            const currentStarDate = galaxyStarDate(galaxy);
            if (galaxy.shakturiTriggerHabitat === null && ((num4 >= num5 && currentStarDate >= val3) || currentStarDate >= num8)) {
                generateShakturiReturnTriggerRuins(galaxy);
            } else if (galaxy.shakturiTriggerHabitat === null) {
                num = 0;
            }
        }
    } else if (dominantRace === galaxy.shakturiActualRace) {
        num = 0;
    }
    if (num < 0 || !galaxy.storyReturnOfTheShakturiEnabled) return;
    let flag4 = false;
    // The C# switch with `goto case` fall-through: 0 → 1 → 2 → 3; 4 stands alone.
    let level = galaxy.storyReturnOfTheShakturiEventLevel;
    let jumped = false;
    switchLoop: for (;;) {
        switch (level) {
            case 0:
                if (empire !== null) {
                    galaxy.storyReturnOfTheShakturiEventLevel = 1;
                    level = 1;
                    jumped = true;
                    continue switchLoop;
                }
                flag4 = true;
                break switchLoop;
            case 1:
                if (empire === null || dominantRace === galaxy.shakturiActualRace) break switchLoop;
                if (diplomaticRelation !== null && diplomaticRelation.type !== DiplomaticRelationType.NotMet) {
                    galaxy.storyReturnOfTheShakturiEventLevel = 2;
                    level = 2;
                    jumped = true;
                    continue switchLoop;
                }
                flag4 = true;
                break switchLoop;
            case 2: {
                if (empire === null) break switchLoop;
                if (self === empire && galaxyStarDate(galaxy) >= galaxy.storyShakturiEnrageTimer) {
                    void (Math.sqrt(galaxy.starCount) / 5.0);
                    if (!galaxy.storyShakturiEnraged) generateShakturiAggression(galaxy, self);
                }
                const diplomaticRelation7 = obtainDiplomaticRelation(empire, empire2);
                if (diplomaticRelation === null || diplomaticRelation.type !== DiplomaticRelationType.War || diplomaticRelation7 == null || diplomaticRelation7.type !== DiplomaticRelationType.War || empire2!.reclusive) {
                    if (flag2) {
                        const diplomaticRelation8 = obtainDiplomaticRelation(empire2!, empire);
                        if (empire2!.reclusive && diplomaticRelation !== null && diplomaticRelation.type !== DiplomaticRelationType.NotMet && diplomaticRelation8 != null && diplomaticRelation8.type !== DiplomaticRelationType.NotMet && galaxy.storyShakturiEnraged) {
                            galaxy.storyReturnOfTheShakturiEventLevel = 2;
                            flag4 = true;
                        }
                    } else if (flag && empire2 !== null && empire2.capital !== null && !checkLocationHintExistsAtPoint(galaxy, player, empire2.capital.xpos, empire2.capital.ypos, 48000.0)) {
                        const text3 = gameText('We offer to reveal a secret location');
                        sendMessageToEmpire(self, player, EmpireMessageType.HistoryOfferLocationHint, null, text3);
                        return;
                    }
                    break switchLoop;
                }
                level = 3;
                jumped = true;
                continue switchLoop;
            }
            case 3: {
                if (dominantRace !== galaxy.shakturiActualRace) break switchLoop;
                const diplomaticRelation9 = obtainDiplomaticRelation(empire!, empire2);
                if (((diplomaticRelation !== null && diplomaticRelation.type === DiplomaticRelationType.War) || empire2 === null || !empire2.reclusive) && diplomaticRelation9 != null && diplomaticRelation9.type === DiplomaticRelationType.War) {
                    if (galaxy.storyReturnOfTheShakturiEventLevel < 3) generateShakturiInvasion(galaxy, empire, empire2);
                    galaxy.storyReturnOfTheShakturiEventLevel = 3;
                    if (diplomaticRelation !== null && diplomaticRelation.type === DiplomaticRelationType.War) flag4 = true;
                }
                break switchLoop;
            }
            case 4: {
                if (jumped) break switchLoop; // `goto case` never reaches case 4
                if (!flag2) break switchLoop;
                let flag5 = false;
                if (empire !== null) {
                    const diplomaticRelation5 = obtainDiplomaticRelation(player, empire);
                    if (diplomaticRelation5 != null) {
                        const wv = calculateEmpireWarValue(galaxy, player);
                        const num9 = Math.trunc(wv.builtObject * 0.6);
                        const num10 = Math.trunc(wv.colony * 0.4);
                        if (diplomaticRelation5.warDamageBuiltObject > num9 || diplomaticRelation5.warDamageColony > num10) flag5 = true;
                    }
                }
                if (!flag5 && empire2 !== null && empire !== null) {
                    const diplomaticRelation6 = obtainDiplomaticRelation(empire2, empire);
                    if (diplomaticRelation6 != null) {
                        const wv2 = calculateEmpireWarValue(galaxy, player);
                        const num11 = Math.trunc(wv2.builtObject * 0.8);
                        if (diplomaticRelation6.warDamageBuiltObject > num11) flag5 = true;
                    }
                }
                const num12 = Math.trunc(galaxy.starCount / 35);
                if (empire !== null && empire.colonies != null && empire.colonies.length > num12 && flag5) {
                    galaxy.storyReturnOfTheShakturiEventLevel = 4;
                    flag4 = true;
                }
                break switchLoop;
            }
            default:
                break switchLoop;
        }
    }
    if (flag4) {
        sendMessageToEmpire(self, player, EmpireMessageType.StoryMessage, null, gameText('We have an important warning that you need to hear'));
    }
}

// ---------------------------------------------------------------------------
// Distant Worlds story clues (Galaxy.5.cs 3622-3942)
// ---------------------------------------------------------------------------

/** Galaxy.5.cs 3622 CheckAllStoryCluesUsed. */
export function checkAllStoryCluesUsed(galaxy: Galaxy): boolean {
    for (const item of galaxy.storyClueUsed) if (!item) return false;
    return true;
}

/**
 * Galaxy.5.cs 3634 SelectUnusedStoryClue: the first unused clue after index 0 whose location still exists, or -1
 * (ConditionCheckLimit: at most 50 iterations). No Rnd.
 */
export function selectUnusedStoryClue(galaxy: Galaxy): number {
    let num = 0;
    let condition = true;
    let iterationCount = 0;
    while (conditionCheckLimit(condition, 50, () => ++iterationCount)) {
        num++;
        if (num < galaxy.storyClueUsed.length) {
            condition = galaxy.storyClueUsed[num];
            if (galaxy.storyClueLocations.length > num && galaxy.storyClueLocations[num]!.hasBeenDestroyed) condition = true;
        } else {
            num = -1;
            condition = false;
        }
    }
    return num;
}

/** Galaxy.7.cs 569 ConditionCheckLimit(condition, maximumIterations, ref iterationCount): `condition && ++count <= max`. */
function conditionCheckLimit(condition: boolean, maximumIterations: number, increment: () => number): boolean {
    if (!condition) return false;
    const iterationCount = increment();
    return iterationCount <= maximumIterations;
}

/** Galaxy.5.cs 3659 CheckStoryLocationHintExists. No Rnd. */
export function checkStoryLocationHintExists(galaxy: Galaxy): boolean {
    if (galaxy.storyCluesEnabled && !checkAllStoryCluesUsed(galaxy)) {
        const num = selectUnusedStoryClue(galaxy);
        if (num >= 0) return true;
    }
    return false;
}

/**
 * Galaxy.5.cs 3672 CheckForStoryLocationHint(): the next unused clue location's coordinates (and a player location hint), or
 * '' while story clues are off. No Rnd.
 */
export function checkForStoryLocationHint(galaxy: Galaxy): string {
    let result = '';
    if (galaxy.storyCluesEnabled && !checkAllStoryCluesUsed(galaxy)) {
        const num = selectUnusedStoryClue(galaxy);
        if (num >= 0) {
            const stellarObject = galaxy.storyClueLocations[num]!;
            if (!stellarObject.hasBeenDestroyed) {
                result = formatGameTextNow('coordinates X,Y', [Math.trunc(stellarObject.xpos / 1000), Math.trunc(stellarObject.ypos / 1000)]);
                result = result + ', ' + generateLocationDescription(galaxy, stellarObject.xpos, stellarObject.ypos, true);
                addLocationHint(galaxy.playerEmpire!, { x: Math.trunc(stellarObject.xpos), y: Math.trunc(stellarObject.ypos) });
            }
        }
    }
    return result;
}

/**
 * Galaxy.5.cs 4807 GenerateLocationDescription(x, y, prefixWithA) — TextResolver text stand-in (sector description only;
 * TODO(port) M9: the nearest-habitat / nebula wording). No Rnd.
 */
export function generateLocationDescription(galaxy: Galaxy, x: number, y: number, prefixWithA: boolean): string {
    return formatGameTextNow(prefixWithA ? 'A Location Description' : 'Location Description', [resolveSectorDescription(galaxy, x, y)]);
}

/**
 * Galaxy.5.cs 3692 GenerateIndependentColonyStoryClue(colony): one of the first four secondary clues (by the story progress).
 * Called by Galaxy.1.cs 1326 (the player meets an independent colony — not ported yet). Rnd: Next(0, n) when any is left.
 */
export function generateIndependentColonyStoryClue(galaxy: Galaxy, colony: Habitat): string {
    let result = '';
    let num = selectUnusedStoryClue(galaxy);
    num--;
    const list = [0, 0, 1, 1];
    const list2: number[] = [];
    for (let i = 0; i < list.length; i++) {
        if (list[i] <= num && !galaxy.storySecondaryClueUsed[i]) list2.push(i);
    }
    let num2 = -1;
    if (list2.length > 0) {
        const index = galaxy.rnd.next(0, list2.length);
        galaxy.storySecondaryClueUsed[list2[index]] = true;
        num2 = list2[index];
    }
    if (num2 >= 0) result = generateSecondaryStoryClue(galaxy, num2, colony);
    return result;
}

/** Galaxy.5.cs 3724 SelectUnusedSecondaryStoryClueIndex: a random unused secondary clue 4-8 allowed by the story progress. Rnd: Next(0, n). */
export function selectUnusedSecondaryStoryClueIndex(galaxy: Galaxy): number {
    let result = -1;
    if (galaxy.storyDistantWorldsEnabled) {
        let num = selectUnusedStoryClue(galaxy);
        if (num < 0) num = 6;
        num--;
        const list = [0, 0, 1, 1, 2, 3, 4, 4, 5];
        const list2: number[] = [];
        for (let i = 4; i < list.length; i++) {
            if (list[i] <= num && !galaxy.storySecondaryClueUsed[i]) list2.push(i);
        }
        if (list2.length > 0) {
            const index = galaxy.rnd.next(0, list2.length);
            result = list2[index];
        }
    }
    return result;
}

/** Galaxy.5.cs 3762 GenerateBuiltObjectStoryClue(builtObject). Rnd: SelectUnusedSecondaryStoryClueIndex's + the clue's. */
export function generateBuiltObjectStoryClue(galaxy: Galaxy, builtObject: BuiltObject): string {
    let result = '';
    const num = selectUnusedSecondaryStoryClueIndex(galaxy);
    if (num >= 0) {
        galaxy.storySecondaryClueUsed[num] = true;
        result = generateSecondaryStoryClue(galaxy, num, builtObject);
    }
    return result;
}

/** Galaxy.5.cs 3774 GenerateMajorStoryItem(storyLevel) (read by the UI story dialog). */
export function generateMajorStoryItem(storyLevel: number): string {
    let text = '';
    switch (storyLevel) {
        case 0:
            text += formatGameTextNow('MajorStoryEvent1');
            break;
        case 1:
            text += formatGameTextNow('MajorStoryEvent2');
            break;
        case 2:
            text += formatGameTextNow('MajorStoryEvent3');
            break;
        case 3:
            text += formatGameTextNow('MajorStoryEvent4');
            break;
        case 4:
            text += formatGameTextNow('MajorStoryEvent5');
            break;
    }
    return text;
}

/** Galaxy.5.cs 3798 GenerateMajorStoryVictoryMessage(outcome): 0 = Victory, 1 = Defeat (GameEndOutcome). */
export function generateMajorStoryVictoryMessage(outcome: number): string {
    let text = '';
    // GameEndOutcome: Undefined 0, Victory 1, Defeat 2 (victory.ts GameEndOutcome).
    switch (outcome) {
        case 1:
            text += formatGameTextNow('ShakturiPlayerVictory');
            break;
        case 2:
            text += formatGameTextNow('ShakturiPlayerDefeat');
            break;
    }
    return text;
}

/**
 * Galaxy.5.cs 3813 GenerateSecondaryStoryClue(selectionValue, clueLocation): texts 1-9; clue 9 (case 8) also creates the
 * "Archival Refuge" abandoned station in a slowing nebula (tech, money, exploration and government bonuses) and gives the
 * player a location hint. Rnd (case 8): FindLonelyNebulaLocation's, GenerateDesignFromSpec's, Next(110000, 200000),
 * Next(0.15·stars, 0.25·stars).
 */
export function generateSecondaryStoryClue(galaxy: Galaxy, selectionValue: number, clueLocation: unknown): string {
    void clueLocation;
    let result = '';
    const texts = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => formatGameTextNow('SecondaryStoryClue' + n));
    let text9 = formatGameTextNow('SecondaryStoryClue9');
    if (selectionValue >= 0 && selectionValue <= 7) {
        result = texts[selectionValue];
    } else if (selectionValue === 8) {
        const loc = findLonelyNebulaLocation(galaxy, GalaxyLocationEffectType.MovementSlowed);
        const x = loc.x;
        const y = loc.y;
        if (x !== 175000.0 && y !== 122000.0) {
            const player = galaxy.playerEmpire!;
            let design = generateDesignFromSpec(galaxy, player, galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.SmallSpacePort), 0.0, galaxyStarDate(galaxy));
            if (design === null) throw new Error('NullReferenceException: Galaxy.5.cs 3858 GenerateDesignFromSpec returned null (SmallSpacePort)');
            let name = formatGameTextNow('Archival Refuge Station'); // Galaxy.5.cs 3857-3861: a station name, formatted now
            const habitat = fastFindNearestSystemWithPlanets(galaxy, x, y);
            if (habitat !== null) name = formatGameTextNow('X Archival Refuge', [habitat.name]);
            design = cloneDesign(design);
            design.pictureRef = resolveMajorShipImageIndex(FreedomAllianceFamily, design.subRole, false);
            const builtObject = generateStoryAbandonedBuiltObject(galaxy, x, y, design, name);
            builtObject.encounterTechAdvanceCount = 8;
            builtObject.encounterMoneyBonus = galaxy.rnd.next(110000, 200000);
            const minValue = Math.trunc(galaxy.starCount * 0.15);
            const maxValue = Math.trunc(galaxy.starCount * 0.25);
            builtObject.encounterExplorationBonus = shortCastLocal(galaxy.rnd.next(minValue, maxValue));
            const firstByAvailability = governmentsGetFirstByAvailability(2);
            if (firstByAvailability !== null) builtObject.encounterGovernmentTypeId = firstByAvailability.governmentId & 0xff;
            addLocationHint(player, { x: Math.trunc(builtObject.xpos), y: Math.trunc(builtObject.ypos) });
            const text10 = generateLocationDescription(galaxy, x, y, true);
            text9 += formatGameTextNow('SecondaryStoryClue9 Location', [builtObject.name, Math.trunc(x / 1000), Math.trunc(y / 1000), text10]);
        }
        text9 += '========================================';
        result = text9;
    }
    return result;
}

function shortCastLocal(v: number): number {
    return (v << 16) >> 16;
}

/**
 * Galaxy.5.cs 3889 GenerateStoryClue(location): the main clue text of a story clue location (index in StoryClueLocations) —
 * or, for an unowned ship, a secondary clue — and marks the clue used (turning StoryCluesEnabled on). Rnd: the secondary
 * clue's.
 */
export function generateStoryClue(galaxy: Galaxy, location: Habitat | BuiltObject): string {
    let result = '';
    let text = '';
    if (isBuiltObjectLike(location) && (location as BuiltObject).empire === null) text = generateBuiltObjectStoryClue(galaxy, location as BuiltObject);
    if (text !== '') result = text;
    const num = galaxy.storyClueLocations.indexOf(location);
    if (num < 0) return result;
    const texts = [formatGameTextNow('StoryClue1'), formatGameTextNow('StoryClue2'), formatGameTextNow('StoryClue3'), formatGameTextNow('StoryClue4'), formatGameTextNow('StoryClue5'), ''];
    if (num >= 0 && num <= 5) result = texts[num];
    if (!galaxy.storyCluesEnabled) galaxy.storyCluesEnabled = true;
    galaxy.storyClueUsed[num] = true;
    return result;
}

function isBuiltObjectLike(o: Habitat | BuiltObject): boolean {
    return (o as BuiltObject).builtObjectID !== undefined && (o as BuiltObject).design !== undefined;
}

/**
 * Galaxy.5.cs 2212 GenerateStoryAbandonedBuiltObject(x, y, design, name): an unowned, auto-controlled object players are
 * prompted to acquire. No Rnd of its own (GenerateUnownedBuiltObjectFromDesign's).
 */
export function generateStoryAbandonedBuiltObject(galaxy: Galaxy, x: number, y: number, design: Design, name: string): BuiltObject {
    const builtObject = generateUnownedBuiltObjectFromDesign(galaxy, design, name, null, x, y);
    builtObject.isAutoControlled = false;
    builtObject.isAutoControlled = true;
    builtObject.playerEmpireEncounterAction = BuiltObjectEncounterAction.Prompt;
    builtObject.encounterEventType = BuiltObjectEncounterEventType.Acquire;
    galaxy.abandonedShipCount++;
    return builtObject;
}

/** Galaxy.6.cs 2951 FastFindNearestSystemWithPlanets(x, y) + InIndex (2983): the nearest system star with planets. No Rnd. */
export function fastFindNearestSystemWithPlanets(galaxy: Galaxy, x: number, y: number): Habitat | null {
    const ix = Math.trunc(x);
    const iy = Math.trunc(y);
    return galaxy.ringSearch(ix, iy, (cx, cy) => {
        let systemStar: Habitat | null = null;
        let distance = Number.MAX_VALUE;
        for (const sys of galaxy.systemsIndexGrid[cx][cy]) {
            if ((sys.planetCount ?? 0) > 0) {
                const num = galaxy.calculateDistanceSquared(ix, iy, sys.systemStar.xpos, sys.systemStar.ypos);
                if (num < distance) {
                    systemStar = sys.systemStar;
                    distance = num;
                }
            }
        }
        if (systemStar !== null) distance = galaxy.calculateDistance(ix, iy, (systemStar as Habitat).xpos, (systemStar as Habitat).ypos);
        return { item: systemStar, distance };
    });
}

/**
 * Galaxy.3.cs 946/951 FindLonelyNebulaLocation(effect[, effectToExclude = LightningDamage]): a point near a nebula of that
 * effect away from colonies, ships, systems and special locations. Rnd: NextDouble ×2, then per try Next(0, locations) and
 * CheckNebulaLocation's (NextDouble ×2 + SelectRelativeParkingPoint on success). As in the C#, a location with the excluded
 * effect does not count as a try.
 */
export function findLonelyNebulaLocation(galaxy: Galaxy, effect: GalaxyLocationEffectType, effectToExclude: GalaxyLocationEffectType = GalaxyLocationEffectType.LightningDamage): { x: number; y: number } {
    let x = 100000.0 + galaxy.rnd.nextDouble() * (galaxy.sizeX - 200000);
    let y = 100000.0 + galaxy.rnd.nextDouble() * (galaxy.sizeY - 200000);
    let num = 0;
    let flag = false;
    while (!flag && num < 100) {
        const index = galaxy.rnd.next(0, galaxy.galaxyLocations.length);
        const galaxyLocation = galaxy.galaxyLocations[index];
        if (effectToExclude !== GalaxyLocationEffectType.None && galaxyLocation.effect === effectToExclude) {
            flag = false;
            continue;
        }
        if (effect !== GalaxyLocationEffectType.None) {
            if (galaxyLocation.effect === effect) {
                const r = checkNebulaLocation(galaxy, galaxyLocation);
                x = r.x;
                y = r.y;
                if (r.ok) flag = true;
            }
        } else {
            const r = checkNebulaLocation(galaxy, galaxyLocation);
            x = r.x;
            y = r.y;
            if (r.ok) flag = true;
        }
        num++;
    }
    return { x, y };
}

/** Galaxy.3.cs 981 CheckNebulaLocation(location, out x, out y). Rnd: NextDouble ×2, SelectRelativeParkingPoint(100000) on success. */
function checkNebulaLocation(galaxy: Galaxy, location: GalaxyLocation): { ok: boolean; x: number; y: number } {
    let x = 100000.0 + galaxy.rnd.nextDouble() * (galaxy.sizeX - 200000);
    let y = 100000.0 + galaxy.rnd.nextDouble() * (galaxy.sizeY - 200000);
    const num = location.xpos + location.width / 2.0;
    const num2 = location.ypos + location.height / 2.0;
    if (!checkNearEmpireColony(galaxy, num, num2, 250000.0) && !checkNearBuiltObject(galaxy, num, num2, 150000.0) && !checkNearSystem(galaxy, num, num2, 60000.0) && !checkNearSpecialGalaxyLocation(galaxy, num, num2, 1000000.0)) {
        const p = galaxy.selectRelativeParkingPoint(100000.0);
        x = p.x + num;
        y = p.y + num2;
        return { ok: true, x, y };
    }
    return { ok: false, x, y };
}

/** Galaxy.3.cs 997 CheckNearSpecialGalaxyLocation(x, y, minimumRange): debris fields, planet destroyers, restricted areas. */
function checkNearSpecialGalaxyLocation(galaxy: Galaxy, x: number, y: number, minimumRange: number): boolean {
    for (let i = 0; i < galaxy.galaxyLocations.length; i++) {
        const l = galaxy.galaxyLocations[i];
        if (l.type === GalaxyLocationType.DebrisField || l.type === GalaxyLocationType.PlanetDestroyer || l.type === GalaxyLocationType.RestrictedArea) {
            const x2 = l.xpos + Math.fround(l.width / 2);
            const y2 = l.ypos + Math.fround(l.height / 2);
            const num = galaxy.calculateDistance(x, y, x2, y2);
            if (num < minimumRange) return true;
        }
    }
    return false;
}

/** Galaxy.3.cs 1015 CheckNearSystem(x, y, minimumRange). */
function checkNearSystem(galaxy: Galaxy, x: number, y: number, minimumRange: number): boolean {
    const habitat = fastFindNearestSystemWithPlanets(galaxy, x, y);
    if (habitat !== null) {
        const num = galaxy.calculateDistance(x, y, habitat.xpos, habitat.ypos);
        if (num < minimumRange) return true;
    }
    return false;
}

/** Galaxy.3.cs 1029 CheckNearBuiltObject(x, y, minimumRange) — FindNearestBuiltObject((int)x, (int)y, (Empire)null) (Galaxy.7.cs 795). */
function checkNearBuiltObject(galaxy: Galaxy, x: number, y: number, minimumRange: number): boolean {
    const builtObject = galaxy.findNearestBuiltObjectOfEmpire(Math.trunc(x), Math.trunc(y), null);
    if (builtObject !== null) {
        const num = galaxy.calculateDistance(x, y, builtObject.xpos, builtObject.ypos);
        if (num < minimumRange) return true;
    }
    return false;
}

/** Galaxy.3.cs 1057 CheckNearEmpireColony (FindNearestColony(x, y, null, 0): independents included). */
function checkNearEmpireColony(galaxy: Galaxy, x: number, y: number, minimumRange: number): boolean {
    const habitat = galaxy.findNearestColony(x, y, null, true);
    if (habitat !== null) {
        const num = galaxy.calculateDistance(x, y, habitat.xpos, habitat.ypos);
        if (num < minimumRange) return true;
    }
    return false;
}

// ---------------------------------------------------------------------------
// Ruin investigation story hooks (Galaxy.5.cs InvestigateRuins 4044 — the TS InvestigateRuins is still a stub, M4t)
// ---------------------------------------------------------------------------

/**
 * Galaxy.5.cs 4072-4081 (InvestigateRuins, ruin with a benefit): with the Distant Worlds story on, a story-clue ruin found by
 * the player sends the "Galactic History revealed" clue and is spent. Returns the updated message text. Rnd: the clue's.
 */
export function investigateRuinsStoryClue(galaxy: Galaxy, investigatingEmpire: Empire, ruinsHabitat: Habitat, text: string): string {
    const ruin = ruinsHabitat.ruin!;
    if (galaxy.storyDistantWorldsEnabled && ruin.storyClueLevel >= 0 && investigatingEmpire === galaxy.playerEmpire) {
        text = text + formatGameTextNow('Ruins Discovery Historical Details', [ruin.name]) + ' ';
        text += generateStoryClue(galaxy, ruinsHabitat);
        sendEventMessageToEmpire(investigatingEmpire, EventMessageType.StoryClue, gameText('Galactic History revealed'), text, ruin, ruinsHabitat);
        if (investigatingEmpire === galaxy.playerEmpire) ruin.storyClueLevel = -1;
    }
    return text;
}

/**
 * Galaxy.5.cs 4563-4598 (InvestigateRuins, `case RuinType.StoryEvent`): the Beacon of Shaktur — the first investigation
 * (StoryEventData > 0) sends the strange-transmission message and generates the Shakturi on a lonely barren world 0.6-1.5 M
 * from the beacon (else a lonely non-ice world at the galactic edge); later ones find nothing. Rnd: NextDouble ×2,
 * FindLonelyHabitat*'s, GenerateShakturi's.
 */
export function investigateRuinsStoryEvent(galaxy: Galaxy, investigatingEmpire: Empire, ruinsHabitat: Habitat, text: string): void {
    const ruin = ruinsHabitat.ruin!;
    if (ruin.storyEventData > 0) {
        ruin.storyEventData = 0;
        const empty = gameText('Strange transmission from beyond our galaxy');
        text += formatGameTextNow('Shakturi Beacon Trigger', [ruin.name]);
        sendEventMessageToEmpire(investigatingEmpire, EventMessageType.GeneralRuinsDiscovery, empty, text, ruin, ruinsHabitat);
        let habitat3: Habitat | null = null;
        if (galaxy.shakturiTriggerHabitat !== null) {
            let num = galaxy.rnd.nextDouble() * 3000000.0 - 1500000.0;
            let num2 = galaxy.rnd.nextDouble() * 3000000.0 - 1500000.0;
            if (Math.abs(num) < 500000.0) num = 600000.0 * Math.sign(num);
            if (Math.abs(num2) < 500000.0) num2 = 600000.0 * Math.sign(num2);
            habitat3 = findLonelyHabitatAt(galaxy, galaxy.shakturiTriggerHabitat.xpos + num, galaxy.shakturiTriggerHabitat.ypos + num2, HabitatType.BarrenRock);
        }
        if (habitat3 === null) habitat3 = findLonelyHabitatGalacticEdge(galaxy, RuinType.Undefined, HabitatType.Ice);
        generateShakturi(galaxy, habitat3);
    } else {
        text = text + ' ' + formatGameTextNow('Our survey team found nothing of interest in the ruins.');
        sendMessageToEmpire(investigatingEmpire, investigatingEmpire, EmpireMessageType.ExplorationRuins, galaxy, text);
    }
}

// ---------------------------------------------------------------------------
// "Shadows" pre-warp story (Galaxy.StoryShadowsEnabled) — the branches of Empire.7.cs 3426 CheckSendPreWarpProgressEventMessage
// (empireEvents.ts calls these inside the matching cases).
// ---------------------------------------------------------------------------

/**
 * Empire.7.cs 3554-3612 (BuildFirstMilitaryShip, Shadows): the first pirate faction met (relation None, not the player,
 * active) raids the first colony with its nearest available fleet; failing that, a pirate warship (first available within
 * fuel range) raids — or, without assault strength, attacks — the first mining station. Rnd: the missions'.
 */
export function shadowsBuildFirstMilitaryShip(galaxy: Galaxy, self: Empire): void {
    const relationsByType2 = self.pirateRelations.getRelationsByType(PirateRelationType.None);
    let flag2 = false;
    if (self.colonies != null && self.colonies.length > 0) {
        const habitat7 = self.colonies[0];
        if (habitat7 != null && !habitat7.hasBeenDestroyed && relationsByType2.count > 0) {
            for (let k = 0; k < relationsByType2.count; k++) {
                const r = relationsByType2.get(k);
                if (r != null && r.otherEmpire !== null && r.otherEmpire !== galaxy.playerEmpire && r.otherEmpire.active) {
                    const shipGroup = identifyNearestAvailableFleet(galaxy, r.otherEmpire, habitat7.xpos, habitat7.ypos, true, true, 0.1);
                    if (shipGroup !== null) {
                        shipGroupAssignMission(galaxy, shipGroup, BuiltObjectMissionType.Raid, habitat7, null, BuiltObjectMissionPriority.High, false);
                        flag2 = true;
                    }
                    if (flag2) break;
                }
            }
        }
    }
    const miningStations = self.miningStations as BuiltObject[] | null;
    if (!flag2 && miningStations != null && miningStations.length > 0) {
        const builtObject2 = miningStations[0];
        if (!builtObject2.hasBeenDestroyed) {
            for (let l = 0; l < relationsByType2.count; l++) {
                const r = relationsByType2.get(l);
                if (r == null || r.otherEmpire === null || r.otherEmpire === galaxy.playerEmpire || !r.otherEmpire.active) continue;
                const firstAvailableWithinRange = getFirstAvailableWithinRange(galaxy, r.otherEmpire.builtObjects, BuiltObjectRole.Military, builtObject2.xpos, builtObject2.ypos, 0.1, true);
                if (firstAvailableWithinRange !== null) {
                    clearPreviousMissionRequirements(galaxy, firstAvailableWithinRange);
                    if (firstAvailableWithinRange.assaultStrength > 0) {
                        assignMission(galaxy, firstAvailableWithinRange, BuiltObjectMissionType.Raid, builtObject2, null, BuiltObjectMissionPriority.High);
                    } else {
                        assignMission(galaxy, firstAvailableWithinRange, BuiltObjectMissionType.Attack, builtObject2, null, BuiltObjectMissionPriority.High);
                    }
                    flag2 = true;
                }
                if (flag2) break;
            }
        }
    }
}

/**
 * Empire.7.cs 3703-3717 (FirstContactNormalEmpire, Shadows): a non-pirate, non-player empire met for the first time that dislikes
 * this empire's race (standard race bias < 0), is not at war with it, has hyperdrive tech and more than half this empire's
 * mobile firepower (ours / theirs < 2) declares war. Returns whether war was declared (the C# `flag`). No Rnd of its own.
 */
export function shadowsFirstContactNormalEmpire(galaxy: Galaxy, self: Empire, empire: Empire): boolean {
    let flag = false;
    if (galaxy.storyShadowsEnabled && empire.pirateEmpireBaseHabitat === null) {
        const diplomaticRelation = obtainDiplomaticRelation(self, empire);
        if (diplomaticRelation.type !== DiplomaticRelationType.War && empire !== galaxy.playerEmpire && resolveStandardRaceBias(empire.dominantRace, self.dominantRace) < 0.0) {
            const num4 = totalMobileMilitaryFirepower(empire.builtObjects);
            const num5 = totalMobileMilitaryFirepower(self.builtObjects);
            const num6 = num5 / num4;
            if (num6 < 2.0 && checkEmpireHasHyperDriveTech(empire)) {
                declareWar(galaxy, empire, self);
                flag = true;
            }
        }
    }
    return flag;
}

/**
 * Empire.7.cs 3764-3809 (FirstHyperjump, Shadows): picks a creature-outbreak world (a frozen gas giant in the nearest system,
 * else a barren rock 1-2 system radii away), sends every met pirate faction's nearest fleet to raid the first colony and
 * warns a pirate player in contact. Returns habitat2 (the outbreak world, or null). Rnd: NextDouble ×2, Next(0, 2) ×2 when no
 * gas giant; the missions'.
 */
export function shadowsFirstHyperjump(galaxy: Galaxy, self: Empire, builtObject: BuiltObject): Habitat | null {
    let habitat2: Habitat | null = null;
    const habitat3 = galaxy.fastFindNearestSystem(builtObject.xpos, builtObject.ypos);
    if (habitat3 !== null) {
        habitat2 = galaxy.findNearestHabitatOfType(habitat3.xpos, habitat3.ypos, HabitatType.FrozenGasGiant);
        if (habitat2 === null || habitat2.systemIndex !== habitat3.systemIndex) {
            let num = MAX_SOLAR_SYSTEM_SIZE + galaxy.rnd.nextDouble() * MAX_SOLAR_SYSTEM_SIZE;
            let num2 = MAX_SOLAR_SYSTEM_SIZE + galaxy.rnd.nextDouble() * MAX_SOLAR_SYSTEM_SIZE;
            if (galaxy.rnd.next(0, 2) === 1) num *= -1.0;
            if (galaxy.rnd.next(0, 2) === 1) num2 *= -1.0;
            habitat2 = galaxy.findNearestHabitatOfType(habitat3.xpos + num, habitat3.ypos + num2, HabitatType.BarrenRock);
        }
    }
    const relationsByType = self.pirateRelations.getRelationsByType(PirateRelationType.None);
    if (self.colonies != null && self.colonies.length > 0) {
        const habitat4 = self.colonies[0];
        if (habitat4 != null && !habitat4.hasBeenDestroyed) {
            if (relationsByType.count > 0) {
                for (let i = 0; i < relationsByType.count; i++) {
                    const r = relationsByType.get(i);
                    if (r != null && r.otherEmpire !== null && r.otherEmpire !== galaxy.playerEmpire && r.otherEmpire.active) {
                        const fleet = identifyNearestAvailableFleet(galaxy, r.otherEmpire, habitat4.xpos, habitat4.ypos, true, true, 0.1);
                        if (fleet !== null) shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.Raid, habitat4, null, BuiltObjectMissionPriority.High, false);
                    }
                }
            }
            const player = galaxy.playerEmpire;
            if (player !== null && player !== self && player.pirateEmpireBaseHabitat !== null) {
                const pirateRelation = obtainPirateRelation(player, self);
                if (pirateRelation != null && pirateRelation.type !== PirateRelationType.NotMet) {
                    const habitat5 = galaxy.determineHabitatSystemStar(habitat4);
                    const text = gameText('Empire achieves Hyperspace Travel');
                    const description = gameText('Empire Achieved Warp Notification', habitat5.name, self.name);
                    sendMessageToEmpireWithTitle(player, player, EmpireMessageType.GeneralNeutralEvent, habitat4, description, text);
                }
            }
        }
    }
    return habitat2;
}

/**
 * Galaxy.7.cs 4018-4139 (DoSingleEmpireEncounter, Return of the Shakturi on): a Mechanoid discoverer skips the first-contact
 * penalty (returns the C# `flag`); the player meeting the Mechanoid / Erutkah gets the "Ancient Guardians" / "Erutkah
 * Refugees" discovery message (the Erutkah pay 10000); Shakturi-liked / hated race families (SpecialFunctionCode 1 / 2) get
 * their bias adjusted toward the Shakturi race (±30 once enraged, else clamped to ≥ 30 / ≤ 0). `systemName`: the discovery
 * location's system (nearestSystemNameForDiscovery). No Rnd.
 */
export function doSingleEmpireEncounterShakturiStory(galaxy: Galaxy, discoverer: Empire, otherEmpire: Empire, discoveryLocation: { xpos: number; ypos: number } | null, systemName: string): boolean {
    let flag = true;
    if (discoverer.dominantRace !== null && discoverer.dominantRace.name.toLowerCase() === 'mechanoid') flag = false;
    if (discoverer === galaxy.playerEmpire && otherEmpire.dominantRace !== null && otherEmpire.dominantRace.name.toLowerCase() === 'mechanoid') {
        let empty = '';
        empty += formatGameTextNow('MechanoidEncounter', [systemName]);
        empty += '\n\n';
        let habitat2: Habitat | null = null;
        if (otherEmpire.capital !== null) habitat2 = galaxy.determineHabitatSystemStar(otherEmpire.capital);
        let arg2 = '';
        if (habitat2 !== null) arg2 = habitat2.name;
        empty += formatGameTextNow('MechanoidEncounterDetail', [arg2]);
        const title = gameText('Ancient Guardians Encountered');
        if (otherEmpire.capital !== null && discoverer.visibility.checkSystemExplored(otherEmpire.capital.systemIndex)) {
            sendEventMessageToEmpire(discoverer, EventMessageType.GeneralDiscovery, title, empty, otherEmpire.dominantRace, otherEmpire.capital);
        } else if (discoveryLocation !== null) {
            sendEventMessageToEmpire(discoverer, EventMessageType.GeneralDiscovery, title, empty, otherEmpire.dominantRace, { x: Math.trunc(discoveryLocation.xpos), y: Math.trunc(discoveryLocation.ypos) });
        } else {
            sendEventMessageToEmpire(discoverer, EventMessageType.GeneralDiscovery, title, empty, otherEmpire.dominantRace, null);
        }
    } else if (discoverer === galaxy.playerEmpire && otherEmpire.dominantRace !== null && otherEmpire.dominantRace === galaxy.shakturiActualRace) {
        let empty2 = '';
        empty2 += formatGameTextNow('ErutkahEncounter', [systemName]);
        const title = gameText('Erutkah Refugees Encountered');
        if (discoveryLocation !== null) {
            sendEventMessageToEmpire(discoverer, EventMessageType.GeneralDiscovery, title, empty2, otherEmpire.dominantRace, { x: Math.trunc(discoveryLocation.xpos), y: Math.trunc(discoveryLocation.ypos) });
        } else {
            sendEventMessageToEmpire(discoverer, EventMessageType.GeneralDiscovery, title, empty2, otherEmpire.dominantRace, null);
        }
        const player = galaxy.playerEmpire!;
        player.stateMoney += 10000.0;
        player.pirateEconomy.performIncome(10000.0, PirateIncomeType.Undefined, galaxyStarDate(galaxy));
    }
    const likes = (race: Race) => raceFamilyIdsBySpecialFunctionCode(galaxy, 1).includes(race.raceFamily);
    const hates = (race: Race) => raceFamilyIdsBySpecialFunctionCode(galaxy, 2).includes(race.raceFamily);
    if (galaxy.storyShakturiEnraged) {
        if (discoverer.dominantRace !== null && discoverer.dominantRace === galaxy.shakturiActualRace) {
            const empireEvaluation = obtainEmpireEvaluation(galaxy, discoverer, otherEmpire);
            if (otherEmpire.dominantRace !== null && empireEvaluation != null) {
                if (likes(otherEmpire.dominantRace)) empireEvaluation.bias += 30.0;
                else if (hates(otherEmpire.dominantRace)) empireEvaluation.bias -= 30.0;
            }
        } else if (otherEmpire.dominantRace !== null && otherEmpire.dominantRace === galaxy.shakturiActualRace) {
            const empireEvaluation2 = obtainEmpireEvaluation(galaxy, discoverer, otherEmpire);
            if (discoverer.dominantRace !== null && empireEvaluation2 != null) {
                if (likes(discoverer.dominantRace)) empireEvaluation2.bias += 30.0;
                else if (hates(discoverer.dominantRace)) empireEvaluation2.bias -= 30.0;
            }
        }
    } else if (discoverer.dominantRace !== null && discoverer.dominantRace === galaxy.shakturiActualRace) {
        const empireEvaluation3 = obtainEmpireEvaluation(galaxy, discoverer, otherEmpire);
        if (otherEmpire.dominantRace !== null && empireEvaluation3 != null) {
            if (hates(otherEmpire.dominantRace)) empireEvaluation3.bias = Math.min(empireEvaluation3.bias, 0.0);
            else if (likes(otherEmpire.dominantRace)) empireEvaluation3.bias = Math.max(empireEvaluation3.bias, 30.0);
        }
    } else if (otherEmpire.dominantRace !== null && otherEmpire.dominantRace === galaxy.shakturiActualRace) {
        const empireEvaluation4 = obtainEmpireEvaluation(galaxy, discoverer, otherEmpire);
        if (discoverer.dominantRace !== null && empireEvaluation4 != null) {
            if (hates(discoverer.dominantRace)) empireEvaluation4.bias = Math.min(empireEvaluation4.bias, 0.0);
            else if (likes(discoverer.dominantRace)) empireEvaluation4.bias = Math.max(empireEvaluation4.bias, 30.0);
        }
    }
    return flag;
}

export { resolveDescription };
