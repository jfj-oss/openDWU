// M4z3 — story set-up at game start: DistantWorlds/Start.2.cs CreateGameFromSettings' story blocks (called by
// gameStartTail.ts in C# order) and the Galaxy generators only they use:
//   1730-1767 Return of the Shakturi: the Ancient Guardians at "Utopia" (story/storyEvents.ts GenerateAncientHelpers);
//   1768-1844 Distant Worlds: the five story clue locations (a lonely barren-rock ruin, Signal Intercept Station XL5, the
//             Devastator in the Pozdac Weapons Testing Range, the Ecatur Special Projects Outpost in the Dead Zone with 40
//             Kaltors, the Scoundrels Refuge) and one of each special zone per 200 stars (Galaxy.3.cs 1071-1352);
//   1921-1961 Distant Worlds: the Origins ruins; 1968-2010 Distant Worlds: debris fields and incomplete planet destroyers
//             (Galaxy.5.cs 3403-3620); 2013-2016 method_86 (Start.2.cs 2390): abandoned Shakturi warships.
// TextResolver: English GameText.txt strings are used directly for object / location names (gameStartTail.ts convention).
// ShipImageHelper picture picks (shipImageHelper.ts) use their own galaxy-seeded stream, not Galaxy.Rnd; the "family"
// choices below are still Galaxy.Rnd draws made by the C# CALLER (kept as-is), passed into resolveMajorShipImageIndex.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { Habitat } from '../types';
import { HabitatType } from '../types';
import type { BuiltObject } from '../builtObject';
import type { Design } from '../design';
import { Creature, CreatureType } from '../creature';
import { GalaxyLocation, GalaxyLocationEffectType, GalaxyLocationShape, GalaxyLocationType } from '../galaxyLocation';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { ComponentStatus } from '../builtObjectComponent';
import { ComponentType } from '../data/components';
import { ComponentCategoryType } from '../data/policies';
import { BattleTactics, BuiltObjectFleeWhen, InvasionTactics, BuiltObjectRole, DesignSpecificationComponentRuleType, newComponentRuleByCategory, newComponentRuleByType, newDesignSpecification, type DesignSpecification } from '../data/designSpecifications';
import { Design as DesignClass, BuiltObjectStance } from '../design';
import { generateDesignFromSpec, generatePlanetDestroyerDesign, componentDefinitionsStatic, placementView, resolveLegacySubRole } from '../designGeneration';
import { AncientHelpersFamily, FreedomAllianceFamily, ShakturiAlliesFamily, ShakturiFamily, resolveMajorShipImageIndex } from '../shipImageHelper';
import { placeComponentsOnDesignDefault } from '../designPlacement';
import { evaluateLatestByCategory, evaluateLatestByType, type ComponentDefinition } from '../componentStatic';
import { Cargo, CargoList, ResourceRef } from '../cargo';
import { raceDesignPictureFamilyIndexPirates } from '../empire';
import { RuinType, selectRuins } from '../ruins';
import { selectRandomRace } from '../pirates';
import { galaxyStarDate } from '../tick/simTime';
import { MAX_SOLAR_SYSTEM_SIZE } from '../visibility';
import {
    BuiltObjectEncounterAction,
    cloneDesign,
    damageBuiltObjectComponents,
    findLonelyDeepSpaceLocation,
    findLonelyHabitat,
    findLonelyHabitatAt,
    galaxyDesignSpecificationBySubRole,
    generateAbandonedBuiltObject,
    generateUnownedBuiltObjectFromDesign,
    getMonitoringStationDesignSpec,
    method93,
    selectSpecialRuins,
    SpecialRuinsEventType,
} from '../gameStartTail';
import type { RaceFamily } from '../data/raceFamilies';
import type { Race } from '../data/races';
import {
    fastFindNearestSystemWithPlanets,
    findLonelyNebulaLocation,
    findUtopiaHabitat,
    galaxyRaceByName,
    generateAncientHelpers,
    generateStoryAbandonedBuiltObject,
    obtainRandomGalaxyCoordinatesFromPoint,
    prepareUtopia,
} from './storyEvents';

/** string.Format with {0}, {1}… placeholders. */
function fmt(template: string, ...args: unknown[]): string {
    return template.replace(/\{(\d+)\}/g, (_m, i: string) => String(args[Number(i)] ?? ''));
}

function requireDesign(design: Design | null, where: string): Design {
    if (design === null) throw new Error(`NullReferenceException: ${where} GenerateDesignFromSpec returned null`);
    return design;
}

// ---------------------------------------------------------------------------
// Start.2.cs blocks
// ---------------------------------------------------------------------------

/**
 * Start.2.cs 1730-1767 `if (empireStart_0.TechLevel != 0.0 && galaxy.StoryReturnOfTheShakturiEnabled)`: the Ancient Guardians
 * on "Utopia", an unoccupied world near a random point two sectors from the player's start (xpos, ypos). Rnd:
 * ObtainRandomGalaxyCoordinatesFromPoint (NextDouble per try) + GenerateAncientHelpers'.
 */
export function shakturiStoryAtStart(galaxy: Galaxy, playerTechLevel: number, xpos: number, ypos: number): void {
    if (playerTechLevel !== 0.0 && galaxy.storyReturnOfTheShakturiEnabled) {
        const p = obtainRandomGalaxyCoordinatesFromPoint(galaxy, xpos, ypos, galaxy.sectorSize * 2.0);
        const habitat18 = findUtopiaHabitat(galaxy, p.x, p.y);
        prepareUtopia(habitat18);
        generateAncientHelpers(galaxy, habitat18);
    }
}

/**
 * Start.2.cs 1768-1844: with the Distant Worlds story on, the story clue locations and special zones. Returns the restricted
 * zones created here (galaxyLocationList3: SetEmpireKnownGalacticHistoryLocations excludes them). The "reset" conditions are
 * always true for a new game. Rnd: SelectRelativeParkingPoint(2000000), per try FindLonelyHabitat + method_93, SelectRuins,
 * FindLonelyDeepSpaceLocation, FindLonelyNebulaLocation ×3, GenerateDesignFromSpec's, GenerateCreaturesAtLocation (40 ×
 * Next ×2 + the Creature ctor), then the special zones'.
 */
export function distantWorldsStoryCluesAtStart(galaxy: Galaxy, xpos: number, ypos: number): GalaxyLocation[] {
    const galaxyLocationList3: GalaxyLocation[] = [];
    if (galaxy.storyDistantWorldsEnabled) {
        const player = galaxy.playerEmpire!;
        let num59 = 0;
        const p0 = galaxy.selectRelativeParkingPoint(2000000.0);
        let num60 = p0.x + xpos;
        let num61 = p0.y + ypos;
        let habitat19: Habitat | null = null;
        while (habitat19 === null && num59 < 50) {
            habitat19 = findLonelyHabitatAt(galaxy, num60, num61, HabitatType.BarrenRock);
            const q = method93(galaxy, 0.0, 1.0);
            num60 = q.x;
            num61 = q.y;
            num59++;
        }
        if (habitat19 !== null) {
            selectRuins(galaxy, habitat19, true, false, false);
            if (habitat19.ruin !== null) {
                habitat19.ruin.clearBonuses();
                habitat19.ruin.storyClueLevel = 0;
            }
        }
        galaxy.storyClueLocations.push(habitat19);
        let p = findLonelyDeepSpaceLocation(galaxy);
        const monitoringStationDesignSpec = getMonitoringStationDesignSpec();
        const design3 = requireDesign(generateDesignFromSpec(galaxy, player, monitoringStationDesignSpec, 4.0, galaxyStarDate(galaxy)), 'Start.2.cs 1796');
        design3.pictureRef = resolveMajorShipImageIndex(FreedomAllianceFamily, design3.subRole, false);
        const item3 = generateStoryAbandonedBuiltObject(galaxy, p.x, p.y, design3, 'Signal Intercept Station' + ' XL5');
        galaxy.storyClueLocations.push(item3);
        p = findLonelyNebulaLocation(galaxy, GalaxyLocationEffectType.None);
        const bySubRole = galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.CapitalShip);
        const design4 = requireDesign(generateDesignFromSpec(galaxy, player, bySubRole, 4.0, galaxyStarDate(galaxy)), 'Start.2.cs 1802');
        design4.pictureRef = resolveMajorShipImageIndex(FreedomAllianceFamily, design4.subRole, false);
        const builtObject3 = generateStoryAbandonedBuiltObject(galaxy, p.x, p.y, design4, 'Devastator');
        const message = 'You have entered a restricted security zone. You must turn back and leave this area immediately.';
        const galaxyLocation = generateRestrictedZone(galaxy, fmt('{0} Weapons Testing Range', 'Pozdac'), message, 3000.0, p.x, p.y, 3);
        galaxyLocationList3.push(galaxyLocation);
        galaxy.storyClueLocations.push(builtObject3);
        galaxyLocation.relatedBuiltObject = builtObject3;
        p = findLonelyNebulaLocation(galaxy, GalaxyLocationEffectType.None);
        const design5 = generateResearchStationDesign(galaxy, player, galaxyStarDate(galaxy), ComponentType.LabsWeaponsLab);
        design5.pictureRef = resolveMajorShipImageIndex(FreedomAllianceFamily, design5.subRole, false);
        const builtObject4 = generateStoryAbandonedBuiltObject(galaxy, p.x, p.y, design5, fmt('{0} Special Projects Outpost', 'Ecatur'));
        const message2 = 'You have entered a high-security area used for secret research experiments. Leave now, while you still can!';
        const galaxyLocation2 = generateRestrictedZone(galaxy, 'Dead Zone', message2, 3000.0, p.x, p.y, 1);
        galaxyLocationList3.push(galaxyLocation2);
        galaxy.storyClueLocations.push(builtObject4);
        galaxyLocation2.relatedCreatures = generateCreaturesAtLocation(galaxy, CreatureType.Kaltor, 40, p.x, p.y, 600, 300);
        galaxyLocation2.relatedBuiltObject = builtObject4;
        p = findLonelyNebulaLocation(galaxy, GalaxyLocationEffectType.LightningDamage, GalaxyLocationEffectType.None);
        const bySubRole2 = galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.GasMiningStation);
        let design6 = requireDesign(generateDesignFromSpec(galaxy, player, bySubRole2, 5.0, galaxyStarDate(galaxy)), 'Start.2.cs 1822');
        design6 = designPirateBase(galaxy, design6, 5.0);
        design6.pictureRef = resolveMajorShipImageIndex(FreedomAllianceFamily, design6.subRole, false);
        const item4 = generateStoryAbandonedBuiltObject(galaxy, p.x, p.y, design6, 'Scoundrels Refuge');
        galaxy.storyClueLocations.push(item4);
        for (let i = 0; i < 5; i++) galaxy.storyClueUsed.push(false);
        for (let i = 0; i < 9; i++) galaxy.storySecondaryClueUsed.push(false);
        const num62 = Math.max(1, Math.trunc(galaxy.starCount / 200));
        for (let num63 = 0; num63 < num62; num63++) generateSpecialZoneWeaponsTestingRange(galaxy);
        const num64 = Math.max(1, Math.trunc(galaxy.starCount / 200));
        for (let num65 = 0; num65 < num64; num65++) generateSpecialZoneResearchFacility(galaxy);
        const num66 = Math.max(1, Math.trunc(galaxy.starCount / 200));
        for (let num67 = 0; num67 < num66; num67++) generateSpecialZoneSupplyDepot(galaxy);
    }
    return galaxyLocationList3;
}

/**
 * Start.2.cs 1921-1961 (inside the special-ruins block, Distant Worlds story): num72 Origins ruins for Human, Boskara, Kiadian,
 * Sluken, Ackdarian, Gizurean (odd ones with a negative value), a random race (intelligence ≥ 75) when missing. Rnd per ruin:
 * Next(10, 14), a second Next(10, 14) for cases 0-5, SelectRandomRace(75) when needed, FindLonelyHabitat, SelectSpecialRuins.
 */
export function originsRuinsAtStart(galaxy: Galaxy, num72: number, raceFamilies: readonly RaceFamily[] | undefined): void {
    if (!galaxy.storyDistantWorldsEnabled) return;
    for (let num81 = 0; num81 < num72; num81++) {
        let race2: Race | null = null;
        let specialValue = galaxy.rnd.next(10, 14);
        switch (num81) {
            case 0:
                race2 = galaxyRaceByName(galaxy, 'Human');
                specialValue = galaxy.rnd.next(10, 14);
                break;
            case 1:
                race2 = galaxyRaceByName(galaxy, 'Boskara');
                specialValue = galaxy.rnd.next(10, 14) * -1;
                break;
            case 2:
                race2 = galaxyRaceByName(galaxy, 'Kiadian');
                specialValue = galaxy.rnd.next(10, 14);
                break;
            case 3:
                race2 = galaxyRaceByName(galaxy, 'Sluken');
                specialValue = galaxy.rnd.next(10, 14) * -1;
                break;
            case 4:
                race2 = galaxyRaceByName(galaxy, 'Ackdarian');
                specialValue = galaxy.rnd.next(10, 14);
                break;
            case 5:
                race2 = galaxyRaceByName(galaxy, 'Gizurean');
                specialValue = galaxy.rnd.next(10, 14) * -1;
                break;
        }
        if (race2 === null) race2 = selectRandomRace(galaxy, 75);
        const habitat20 = findLonelyHabitat(galaxy, 0.0, 1.0, RuinType.Origins, HabitatType.BarrenRock);
        selectSpecialRuins(galaxy, habitat20, SpecialRuinsEventType.OriginsDiscovery, raceFamilies, race2, specialValue);
    }
}

/**
 * Start.2.cs 1968-2010: with the Distant Worlds story on, large / small debris fields and incomplete planet destroyers by the
 * wizard star count (int_1). Rnd: GenerateDebrisFieldLarge / Small / GeneratePlanetDestroyer's.
 */
export function debrisFieldCounts(int1: number, scale: boolean): { large: number; small: number; destroyers: number } {
    let large: number;
    let small: number;
    let destroyers: number;
    if (int1 >= 1400) {
        large = 3;
        small = 5;
        destroyers = 3;
    } else if (int1 >= 700) {
        large = 2;
        small = 3;
        destroyers = 2;
    } else if (int1 >= 400) {
        large = 1;
        small = 3;
        destroyers = 1;
    } else {
        large = 0;
        small = 2;
        destroyers = 1;
    }
    // Our addition (option "Scale debris fields with galaxy size"): never fewer than the original band; planet destroyers unchanged.
    if (scale) {
        large = Math.max(large, Math.round(int1 / 200));
        small = Math.max(small, Math.round(int1 / 80));
    }
    return { large, small, destroyers };
}

export function debrisFieldsAtStart(galaxy: Galaxy, int1: number, scale = false): void {
    const galaxyLocationList4 = galaxy.galaxyLocations.filter((l) => l.type === GalaxyLocationType.DebrisField);
    void galaxyLocationList4;
    if (galaxy.storyDistantWorldsEnabled) {
        const counts = debrisFieldCounts(int1, scale);
        const num83 = counts.large;
        const num84 = counts.small;
        const num85 = counts.destroyers;
        for (let num86 = 0; num86 < num83; num86++) generateDebrisFieldLarge(galaxy);
        for (let num87 = 0; num87 < num84; num87++) generateDebrisFieldSmall(galaxy);
        for (let num88 = 0; num88 < num85; num88++) generatePlanetDestroyer(galaxy);
    }
}

/**
 * Start.2.cs 2390 method_86 (Return of the Shakturi): (int)(sqrt(stars) · 0.3) abandoned Shakturi-looking warships (tech 7
 * frigate / destroyer / cruiser of the player's design specification, no owner) at habitats > 2.1 system radii from the nearest
 * colony (≤ 5000 tries). Rnd per try: method_93 (NextDouble ×2, Next(0, 2) ×2), Next(0, 3), GenerateDesignFromSpec's and, on
 * success, GenerateAbandonedBuiltObject's. (C# reads habitat2.Xpos twice for the nearest colony: kept.)
 */
export function shakturiAbandonedShipsAtStart(galaxy: Galaxy): void {
    if (!galaxy.storyReturnOfTheShakturiEnabled) return;
    const num = Math.trunc(Math.sqrt(galaxy.starCount) * 0.3);
    let num2 = 0;
    let num3 = 0;
    while (num2 < num && num3 < 5000) {
        const d = method93(galaxy, 0.0, 1.05);
        let habitat = galaxy.findNearestColony(d.x, d.y, null, false);
        let design: Design | null = null;
        const num4 = galaxy.rnd.next(0, 3);
        let designSpecification: DesignSpecification | null = null;
        switch (num4) {
            case 0:
                designSpecification = galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.Frigate);
                break;
            case 1:
                designSpecification = galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.Destroyer);
                break;
            case 2:
                designSpecification = galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.Cruiser);
                break;
        }
        if (designSpecification !== null) {
            design = requireDesign(generateDesignFromSpec(galaxy, galaxy.playerEmpire!, designSpecification, 7.0, galaxyStarDate(galaxy)), 'Start.2.cs 2415');
            design.empire = null;
        }
        const habitat2 = galaxy.findNearestHabitatOfType(d.x, d.y, HabitatType.Undefined);
        if (habitat2 === null) throw new Error('NullReferenceException: Start.2.cs 2419 habitat2.Xpos (no habitat)');
        habitat = galaxy.findNearestColony(habitat2.xpos, habitat2.xpos, null, false);
        if (habitat === null) throw new Error('NullReferenceException: Start.2.cs 2421 habitat.Xpos (no colony)');
        const num5 = galaxy.calculateDistance(habitat2.xpos, habitat2.ypos, habitat.xpos, habitat.ypos);
        if (num5 > galaxy.maxSolarSystemSize * 2.1 && design !== null) {
            let flag = true;
            if (design.role === BuiltObjectRole.Base) {
                const builtObject = galaxy.findNearestBuiltObject(Math.trunc(habitat2.xpos), Math.trunc(habitat2.ypos), BuiltObjectRole.Base);
                if (builtObject === null) throw new Error('NullReferenceException: Start.2.cs 2428 builtObject.Xpos');
                const num6 = galaxy.calculateDistance(habitat2.xpos, habitat2.ypos, builtObject.xpos, builtObject.ypos);
                if (num6 < 500.0) flag = false;
            }
            if (flag) {
                design.pictureRef = resolveMajorShipImageIndex(ShakturiFamily, design.subRole, false);
                const builtObject2 = generateAbandonedBuiltObject(galaxy, habitat2, design, false, false, BuiltObjectEncounterAction.Prompt);
                builtObject2.encounterDescription = "The sight of this ship gives you an eerie feeling. Though you've never seen this advanced alien design before, there is something strangely familiar about it...";
                num2++;
            }
        }
        num3++;
    }
}

// ---------------------------------------------------------------------------
// Galaxy generators used only by the story set-up
// ---------------------------------------------------------------------------

/**
 * Galaxy.3.cs 1313 GenerateRestrictedZone(name, message, size, x, y, soundScheme): a circular, named, hyperjump-disabled
 * RestrictedArea location centred on (x, y). No Rnd.
 */
export function generateRestrictedZone(galaxy: Galaxy, name: string, message: string, size: number, x: number, y: number, soundScheme: number): GalaxyLocation {
    const num = size / 2.0;
    const galaxyLocation = new GalaxyLocation(name, GalaxyLocationType.RestrictedArea, x - num, y - num, size, size, -1);
    galaxyLocation.showName = true;
    galaxyLocation.effect = GalaxyLocationEffectType.HyperjumpDisabled;
    galaxyLocation.shape = GalaxyLocationShape.Circular;
    galaxyLocation.message = message;
    galaxyLocation.soundScheme = (soundScheme << 16) >> 16;
    galaxy.galaxyLocations.push(galaxyLocation);
    galaxy.addGalaxyLocationIndex(galaxyLocation);
    return galaxyLocation;
}

/** Galaxy.3.cs 1291 GenerateRestrictedZoneName(x, y, suffixes): the nebula's name (else the nearest system's) + a random suffix. Rnd: Next(0, n). */
function generateRestrictedZoneName(galaxy: Galaxy, x: number, y: number, suffixes: string[] | null): string {
    let text = '';
    const galaxyLocationList = galaxy.determineGalaxyLocationsAtPoint(x, y, GalaxyLocationType.NebulaCloud);
    for (const item of galaxyLocationList) {
        if (item.name !== null && item.name !== '') {
            text = item.name;
            break;
        }
    }
    if (text === '') {
        const habitat = fastFindNearestSystemWithPlanets(galaxy, x, y);
        if (habitat === null) throw new Error('NullReferenceException: Galaxy.3.cs 1304 habitat.Name');
        text = habitat.name;
    }
    if (suffixes !== null) {
        const text2 = suffixes[galaxy.rnd.next(0, suffixes.length)];
        text = text + ' ' + text2;
    }
    return text;
}

/** Galaxy.3.cs 1120 GenerateResearchStationName(x, y, namePart). Rnd: Next(0, 7). */
function generateResearchStationName(galaxy: Galaxy, x: number, y: number, namePart: string): string {
    const habitat = fastFindNearestSystemWithPlanets(galaxy, x, y);
    if (habitat === null) throw new Error('NullReferenceException: Galaxy.3.cs 1124 habitat.Name');
    let empty = habitat.name;
    if (namePart !== '') empty = empty + ' ' + namePart;
    const array = ['Research Station', 'Research Facility', 'Research Outpost', 'Station', 'Facility', 'Projects Facility', 'Research Installation'];
    const num = galaxy.rnd.next(0, array.length);
    return empty + ' ' + array[num];
}

/**
 * Galaxy.3.cs 1071 GenerateSpecialZoneResearchFacility(): an abandoned research station (one tech advance) inside a restricted
 * "research" zone. Rnd: FindLonelyNebulaLocation's, Next(0, 3) lab type, Next(0, 2) picture family, the name's Next(0, 7),
 * the zone name's Next(0, 4), Next(0, 2) sound scheme.
 */
export function generateSpecialZoneResearchFacility(galaxy: Galaxy): void {
    const p = findLonelyNebulaLocation(galaxy, GalaxyLocationEffectType.None);
    const x = p.x;
    const y = p.y;
    const num = galaxy.rnd.next(0, 3);
    let labComponentType = ComponentType.LabsWeaponsLab;
    let namePart = '';
    switch (num) {
        case 0:
            labComponentType = ComponentType.LabsWeaponsLab;
            namePart = 'Weapons';
            break;
        case 1:
            labComponentType = ComponentType.LabsHighTechLab;
            namePart = 'HighTech';
            break;
        case 2:
            labComponentType = ComponentType.LabsEnergyLab;
            namePart = 'Energy';
            break;
    }
    const design = generateResearchStationDesign(galaxy, galaxy.playerEmpire!, galaxyStarDate(galaxy), labComponentType);
    const zoneFamily = galaxy.rnd.next(0, 2) === 0 ? AncientHelpersFamily : ShakturiAlliesFamily; // Galaxy.3.cs 1091-1099
    design.pictureRef = resolveMajorShipImageIndex(zoneFamily, design.subRole, false);
    const name = generateResearchStationName(galaxy, x, y, namePart);
    const builtObject = generateStoryAbandonedBuiltObject(galaxy, x, y, design, name);
    builtObject.encounterTechAdvanceCount = 1;
    const name2 = generateRestrictedZoneName(galaxy, x, y, ['Test Site', 'Special Projects Area', 'Research Zone', 'Experimental Area']);
    const text = 'You have entered a restricted area used for experimental research projects. For your own safety you must leave immediately!';
    let soundScheme = 2;
    if (galaxy.rnd.next(0, 2) === 1) soundScheme = 0;
    const galaxyLocation = generateRestrictedZone(galaxy, name2, text, 2000.0, x, y, soundScheme);
    galaxyLocation.relatedBuiltObject = builtObject;
}

/**
 * Galaxy.3.cs 1147 GenerateSpecialZoneSupplyDepot(): an abandoned medium space port stocked with strategic resources and
 * 20000 credits plus 3-5 abandoned warships, in a restricted "supply" zone. Rnd: FindLonelyNebulaLocation's, Next(0, 2)
 * family, GenerateDesignFromSpec ×4, the zone names' Next, Next(3, 6), per ship Next(0, 3) + SelectRandomUniqueMilitaryShipName
 * + Next(-600, 600) ×2.
 */
export function generateSpecialZoneSupplyDepot(galaxy: Galaxy): void {
    const p = findLonelyNebulaLocation(galaxy, GalaxyLocationEffectType.None);
    const x = p.x;
    const y = p.y;
    const zoneFamily = galaxy.rnd.next(0, 2) === 0 ? AncientHelpersFamily : FreedomAllianceFamily; // Galaxy.3.cs 1153-1161
    const player = galaxy.playerEmpire!;
    const designSpecification = cloneDesignSpecification(galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.MediumSpacePort)!);
    let flag = false;
    for (const componentRule of designSpecification.componentRules) {
        if (componentRule.componentCategory === ComponentCategoryType.Reactor) componentRule.amount = 3;
        if (componentRule.componentType === ComponentType.StorageCargo) {
            componentRule.amount = 75;
            flag = true;
        }
    }
    if (!flag) designSpecification.componentRules.push(newComponentRuleByType(DesignSpecificationComponentRuleType.MustHave, ComponentType.StorageCargo, 75));
    const starDate = galaxyStarDate(galaxy);
    const design = requireDesign(generateDesignFromSpec(galaxy, player, designSpecification, 5.0, starDate), 'Galaxy.3.cs 1175');
    design.empire = null;
    const design2 = requireDesign(generateDesignFromSpec(galaxy, player, galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.Frigate), 4.0, starDate), 'Galaxy.3.cs 1178');
    const design3 = requireDesign(generateDesignFromSpec(galaxy, player, galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.Destroyer), 4.0, starDate), 'Galaxy.3.cs 1180');
    const design4 = requireDesign(generateDesignFromSpec(galaxy, player, galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.Cruiser), 4.0, starDate), 'Galaxy.3.cs 1182');
    design.pictureRef = resolveMajorShipImageIndex(zoneFamily, design.subRole, false);
    design2.pictureRef = resolveMajorShipImageIndex(zoneFamily, design2.subRole, false);
    design3.pictureRef = resolveMajorShipImageIndex(zoneFamily, design3.subRole, false);
    design4.pictureRef = resolveMajorShipImageIndex(zoneFamily, design4.subRole, false);
    let num = 0.0;
    let num2 = 0.0;
    let name = generateRestrictedZoneName(galaxy, x, y, ['Supply Depot', 'Supply Outpost']);
    const builtObject = generateStoryAbandonedBuiltObject(galaxy, x + num, y + num2, design, name);
    const rs = galaxy.resourceSystem;
    for (let i = 0; i < rs.strategicResourcesOrderedByRelativeImportance.length; i++) {
        const resourceDefinition = rs.strategicResourcesOrderedByRelativeImportance[i];
        if (resourceDefinition != null) {
            const amount = Math.trunc(Math.fround(10000 * Math.fround(rs.relativeImportance.get(resourceDefinition.resourceId) ?? 0)));
            if (builtObject.cargo === null) builtObject.cargo = new CargoList(); // C# BuiltObject.Cargo is never null
            builtObject.cargo.add(new Cargo(new ResourceRef(resourceDefinition.resourceId), amount, galaxy.independentEmpire));
        }
    }
    builtObject.encounterMoneyBonus = 20000;
    const num3 = galaxy.rnd.next(3, 6);
    for (let j = 0; j < num3; j++) {
        const num4 = galaxy.rnd.next(0, 3);
        let design5: Design | null = null;
        switch (num4) {
            case 0:
                design5 = design2;
                name = galaxy.selectRandomUniqueMilitaryShipName(null);
                break;
            case 1:
                design5 = design3;
                name = galaxy.selectRandomUniqueMilitaryShipName(null);
                break;
            case 2:
                design5 = design4;
                name = galaxy.selectRandomUniqueMilitaryShipName(null);
                break;
        }
        num = galaxy.rnd.next(-600, 600);
        num2 = galaxy.rnd.next(-600, 600);
        generateStoryAbandonedBuiltObject(galaxy, x + num, y + num2, design5!, name);
    }
    const text = generateRestrictedZoneName(galaxy, x, y, ['Supply Outpost', 'Forward Supply Zone', 'Strategic Reserve']);
    const message = fmt('Welcome to the {0}. Proceed to the outpost for refuel or repair.', text);
    const galaxyLocation = generateRestrictedZone(galaxy, text, message, 2000.0, x, y, 3);
    galaxyLocation.relatedBuiltObject = builtObject;
}

/**
 * Galaxy.3.cs 1243 GenerateSpecialZoneWeaponsTestingRange(): 5-8 abandoned, mostly damaged warships inside a restricted
 * "weapons test" zone. Rnd: FindLonelyNebulaLocation's, Next(0, 2) family, GenerateDesignFromSpec ×4, Next(5, 9), per ship
 * Next(0, 4), Next(-1000, 1000) ×2, SelectRandomUniqueMilitaryShipName, Next(0, 4) [> 0: Next(5, count − 1), per damaged
 * component Next(0, count)], NextDouble fuel; the zone name's Next.
 */
export function generateSpecialZoneWeaponsTestingRange(galaxy: Galaxy): void {
    const p = findLonelyNebulaLocation(galaxy, GalaxyLocationEffectType.None);
    const x = p.x;
    const y = p.y;
    const zoneFamily = galaxy.rnd.next(0, 2) === 0 ? ShakturiAlliesFamily : FreedomAllianceFamily; // Galaxy.3.cs 1248-1256
    const player = galaxy.playerEmpire!;
    const starDate = galaxyStarDate(galaxy);
    const design = requireDesign(generateDesignFromSpec(galaxy, player, galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.CapitalShip), 4.0, starDate), 'Galaxy.3.cs 1257');
    const design2 = requireDesign(generateDesignFromSpec(galaxy, player, galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.Cruiser), 4.0, starDate), 'Galaxy.3.cs 1259');
    const design3 = requireDesign(generateDesignFromSpec(galaxy, player, galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.Destroyer), 4.0, starDate), 'Galaxy.3.cs 1261');
    const design4 = requireDesign(generateDesignFromSpec(galaxy, player, galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.Frigate), 4.0, starDate), 'Galaxy.3.cs 1263');
    design.pictureRef = resolveMajorShipImageIndex(zoneFamily, design.subRole, false);
    design2.pictureRef = resolveMajorShipImageIndex(zoneFamily, design2.subRole, false);
    design3.pictureRef = resolveMajorShipImageIndex(zoneFamily, design3.subRole, false);
    design4.pictureRef = resolveMajorShipImageIndex(zoneFamily, design4.subRole, false);
    let builtObject: BuiltObject | null = null;
    const num = galaxy.rnd.next(5, 9);
    for (let i = 0; i < num; i++) {
        const num2 = galaxy.rnd.next(0, 4);
        let design5: Design | null = null;
        switch (num2) {
            case 0:
                design5 = design;
                break;
            case 1:
                design5 = design2;
                break;
            case 2:
                design5 = design3;
                break;
            case 3:
                design5 = design4;
                break;
        }
        const num3 = galaxy.rnd.next(-1000, 1000);
        const num4 = galaxy.rnd.next(-1000, 1000);
        const name = galaxy.selectRandomUniqueMilitaryShipName();
        builtObject = generateStoryAbandonedBuiltObject(galaxy, x + num3, y + num4, design5!, name);
        if (galaxy.rnd.next(0, 4) > 0) {
            let num5 = galaxy.rnd.next(5, builtObject.components.count - 1);
            num5 = Math.max(1, Math.trunc(num5 * 0.7));
            for (let j = 0; j < num5; j++) {
                const index = galaxy.rnd.next(0, builtObject.components.count);
                builtObject.components.items[index].status = ComponentStatus.Damaged;
            }
            builtObject.reDefine();
        }
        builtObject.currentFuel = builtObject.fuelCapacity * 0.2 + galaxy.rnd.nextDouble() * 0.7 * builtObject.fuelCapacity;
    }
    const name2 = generateRestrictedZoneName(galaxy, x, y, ['Weapons Testing Range', 'Test Zone', 'Military Test Site']);
    const text = 'You have entered a military weapons test zone. For your own safety you must leave immediately!';
    const galaxyLocation = generateRestrictedZone(galaxy, name2, text, 3000.0, x, y, 3);
    galaxyLocation.relatedBuiltObject = builtObject;
}

/** DesignSpecification.cs 34 Clone(): new specification (default optional fields) with copies of the component rules. */
export function cloneDesignSpecification(source: DesignSpecification): DesignSpecification {
    const designSpecification = newDesignSpecification(source.subRole, source.mobile);
    designSpecification.componentRules = [];
    for (const componentRule of source.componentRules) {
        const rule =
            componentRule.componentType !== ComponentType.Undefined
                ? newComponentRuleByType(componentRule.componentRuleType, componentRule.componentType, componentRule.amount)
                : newComponentRuleByCategory(componentRule.componentRuleType, componentRule.componentCategory, componentRule.amount);
        designSpecification.componentRules.push(rule);
    }
    return designSpecification;
}

/**
 * Empire.10.cs 987 GenerateResearchStationDesign(designDate, labComponentType): a generic base with four labs of the type,
 * placed by PlaceComponentsOnDesign (no tech advance). Rnd: PlaceComponentsOnDesign's (none for a base).
 */
export function generateResearchStationDesign(galaxy: Galaxy, empire: Empire, designDate: number, labComponentType: ComponentType): Design {
    const T = DesignSpecificationComponentRuleType;
    const s = newDesignSpecification(BuiltObjectSubRole.GenericBase, false);
    s.componentRules.push(newComponentRuleByType(T.MustHave, ComponentType.ComputerCommandCenter, 1));
    s.componentRules.push(newComponentRuleByCategory(T.MustHave, ComponentCategoryType.Reactor, 1));
    s.componentRules.push(newComponentRuleByType(T.MustHave, ComponentType.StorageFuel, 2));
    s.componentRules.push(newComponentRuleByType(T.MustHave, ComponentType.StorageDockingBay, 1));
    s.componentRules.push(newComponentRuleByType(T.MustHave, ComponentType.StorageCargo, 4));
    s.componentRules.push(newComponentRuleByCategory(T.MustHave, ComponentCategoryType.EnergyCollector, 4));
    s.componentRules.push(newComponentRuleByType(T.MustHave, labComponentType, 4));
    s.componentRules.push(newComponentRuleByType(T.ShouldHave, ComponentType.HabitationMedicalCenter, 1));
    s.componentRules.push(newComponentRuleByType(T.ShouldHave, ComponentType.HabitationRecreationCenter, 1));
    s.componentRules.push(newComponentRuleByType(T.ShouldHave, ComponentType.SensorProximityArray, 1));
    s.componentRules.push(newComponentRuleByType(T.ShouldHave, ComponentType.ComputerTargetting, 1));
    s.componentRules.push(newComponentRuleByType(T.ShouldHave, ComponentType.ComputerCountermeasures, 1));
    s.componentRules.push(newComponentRuleByType(T.ShouldHave, ComponentType.Armor, 4));
    s.componentRules.push(newComponentRuleByCategory(T.ShouldHave, ComponentCategoryType.Shields, 4));
    s.componentRules.push(newComponentRuleByCategory(T.ShouldHave, ComponentCategoryType.WeaponBeam, 2));
    s.componentRules.push(newComponentRuleByType(T.ShouldHave, ComponentType.DamageControl, 1));
    s.componentRules.push(newComponentRuleByType(T.ShouldHave, ComponentType.SensorStealth, 1));
    let name = '';
    switch (labComponentType) {
        case ComponentType.LabsEnergyLab:
            name = 'Energy Research Station';
            break;
        case ComponentType.LabsHighTechLab:
            name = 'High Tech Research Station';
            break;
        case ComponentType.LabsWeaponsLab:
            name = 'Weapons Research Station';
            break;
    }
    let design = new DesignClass(name);
    design.role = s.role;
    design.subRole = s.subRole;
    design.imageScalingType = s.imageScalingMode;
    design.imageScalingFactor = s.imageScalingFactor;
    const placed = placeComponentsOnDesignDefault(placementView(empire, galaxy), design, s, null);
    if (placed === null) throw new Error('NullReferenceException: Empire.10.cs 1012 PlaceComponentsOnDesign returned null');
    design = placed;
    design.stance = BuiltObjectStance.AttackIfAttacked;
    design.fleeWhen = BuiltObjectFleeWhen.Never;
    design.tacticsStrongerShips = BattleTactics.PointBlank;
    design.tacticsWeakerShips = BattleTactics.PointBlank;
    design.tacticsInvasion = InvasionTactics.DoNotInvade;
    let num = empire.designPictureFamilyIndex;
    if (empire.dominantRace !== null && empire.pirateEmpireBaseHabitat !== null) {
        num = raceDesignPictureFamilyIndexPirates(empire.dominantRace);
        if (num < 0) num = empire.dominantRace.designsPictureFamilyIndex;
    }
    design.name = name;
    design.dateCreated = designDate;
    design.empire = empire;
    design.pictureRef = STANDARD_SHIP_IMAGE_START_INDEX + num * SHIP_SET_IMAGE_COUNT + (resolveLegacySubRole(s.subRole) - 1);
    design.role = s.role;
    design.subRole = s.subRole;
    design.reDefine();
    return design;
}

/** ShipImageHelper.StandardShipImageStartIndex / ShipSetImageCount (independentTraders.ts / designGeneration.ts values). */
const STANDARD_SHIP_IMAGE_START_INDEX = 72;
const SHIP_SET_IMAGE_COUNT = 24;

/**
 * Galaxy.8.cs 2596 DesignPirateBase(design, techLevel): a " XT" clone with extra weapons, defences, construction and
 * manufacturing components (Component.EvaluateLatest at techLevel > 0, else the design empire's research picks), made a
 * generic unowned base. No Rnd.
 */
export function designPirateBase(galaxy: Galaxy, design: Design, techLevel: number): Design {
    const design2 = cloneDesign(design);
    const T = ComponentType;
    const C = ComponentCategoryType;
    let component: ComponentDefinition | null;
    let component2: ComponentDefinition | null;
    let component3: ComponentDefinition | null;
    let component4: ComponentDefinition | null;
    let component5: ComponentDefinition | null;
    let component6: ComponentDefinition | null;
    let component7: ComponentDefinition | null;
    let component8: ComponentDefinition | null;
    let component9: ComponentDefinition | null;
    let component10: ComponentDefinition | null;
    let component11: ComponentDefinition | null;
    let component12: ComponentDefinition | null;
    let component13: ComponentDefinition | null;
    let component14: ComponentDefinition | null;
    let component15: ComponentDefinition | null;
    let component16: ComponentDefinition | null;
    if (techLevel > 0.0) {
        const defs = componentDefinitionsStatic(galaxy);
        component = evaluateLatestByCategory(defs, C.WeaponBeam, techLevel);
        component2 = evaluateLatestByCategory(defs, C.WeaponTorpedo, techLevel);
        component3 = evaluateLatestByCategory(defs, C.Armor, techLevel);
        component4 = evaluateLatestByCategory(defs, C.Shields, techLevel);
        component5 = evaluateLatestByType(defs, T.ConstructionBuild, techLevel);
        component6 = evaluateLatestByType(defs, T.ManufacturerEnergyPlant, techLevel);
        component7 = evaluateLatestByType(defs, T.ManufacturerWeaponsPlant, techLevel);
        component8 = evaluateLatestByType(defs, T.ManufacturerHighTechPlant, techLevel);
        component9 = evaluateLatestByType(defs, T.DamageControl, techLevel);
        component10 = evaluateLatestByType(defs, T.HabitationLifeSupport, techLevel);
        component11 = evaluateLatestByType(defs, T.HabitationHabModule, techLevel);
        component12 = evaluateLatestByType(defs, T.FighterBay, techLevel);
        component13 = evaluateLatestByType(defs, T.WeaponPointDefense, techLevel);
        component14 = evaluateLatestByType(defs, T.WeaponIonDefense, techLevel);
        component15 = evaluateLatestByType(defs, T.WeaponTractorBeam, techLevel);
        component16 = evaluateLatestByType(defs, T.AssaultPod, techLevel);
    } else {
        // Galaxy.8.cs 2626-2641: design.Empire.Research.EvaluateDesiredComponent(…, ShipDesignFocus.Balanced).
        throw new Error('TODO(port): Galaxy.8.cs 2626 DesignPirateBase(design, 0) — ResearchSystem.EvaluateDesiredComponent path (no story caller uses techLevel 0)');
    }
    const add = (c: ComponentDefinition | null, n: number): void => {
        if (c !== null) for (let i = 0; i < n; i++) design2.components.push(c);
    };
    add(component, 4);
    add(component2, 2);
    add(component4, 4);
    add(component3, 4);
    add(component12, 2);
    add(component13, 4);
    add(component14, 1);
    add(component15, 2);
    add(component16, 2);
    add(component5, 1);
    add(component6, 1);
    add(component7, 1);
    add(component8, 1);
    add(component9, 1);
    add(component10, 2);
    add(component11, 2);
    design2.subRole = BuiltObjectSubRole.GenericBase;
    design2.empire = null;
    design2.stance = BuiltObjectStance.AttackEnemies;
    design2.name += ' XT';
    design2.buildCount = 0;
    design2.dateCreated = galaxyStarDate(galaxy);
    design2.reDefine();
    return design2;
}

/**
 * Galaxy.6.cs 800 GenerateCreaturesAtLocation(creatureType, amount, x, y, anchorRange, offsetRange): location-locked creatures
 * anchored at (x, y), joined to the nearest system when within its radius (+5000). Rnd per creature: Next(0, 2·offset) ×2 +
 * the Creature ctor's.
 */
export function generateCreaturesAtLocation(galaxy: Galaxy, creatureType: CreatureType, amount: number, x: number, y: number, anchorRange: number, offsetRange: number): Creature[] {
    const creatureList: Creature[] = [];
    const habitat = galaxy.fastFindNearestSystem(x, y);
    let num = Number.MAX_VALUE;
    if (habitat !== null) num = galaxy.calculateDistance(x, y, habitat.xpos, habitat.ypos);
    for (let i = 0; i < amount; i++) {
        const offsetX = offsetRange - galaxy.rnd.next(0, offsetRange * 2);
        const offsetY = offsetRange - galaxy.rnd.next(0, offsetRange * 2);
        let creature: Creature | null = null;
        switch (creatureType) {
            case CreatureType.SilverMist:
            case CreatureType.Ardilus:
            case CreatureType.DesertSpaceSlug:
            case CreatureType.RockSpaceSlug:
            case CreatureType.Kaltor:
                creature = new Creature(galaxy, creatureType, null, offsetX, offsetY, { x: Math.trunc(x), y: Math.trunc(y) }, anchorRange);
                break;
        }
        if (creature !== null) {
            creature.locationLocked = true;
            galaxy.creatures.push(creature);
            creature.nearestSystemStar = null;
            creatureList.push(creature);
            if (num <= MAX_SOLAR_SYSTEM_SIZE + 5000.0 && galaxy.systems != null && galaxy.systems.length > habitat!.systemIndex) {
                creature.nearestSystemStar = habitat;
                const system = galaxy.systems[habitat!.systemIndex];
                if (!system.creatures) system.creatures = [];
                system.creatures.push(creature);
            }
        }
    }
    return creatureList;
}

/** Galaxy.5.cs 3490 GenerateDebrisFieldLarge(): Next(15, 23) wrecks. */
export function generateDebrisFieldLarge(galaxy: Galaxy): void {
    const shipCount = galaxy.rnd.next(15, 23);
    generateDebrisFieldNearLonelyHabitat(galaxy, shipCount);
}

/** Galaxy.5.cs 3496 GenerateDebrisFieldSmall(): Next(6, 10) wrecks. */
export function generateDebrisFieldSmall(galaxy: Galaxy): void {
    const shipCount = galaxy.rnd.next(6, 10);
    generateDebrisFieldNearLonelyHabitat(galaxy, shipCount);
}

/** Galaxy.5.cs 3502 GenerateDebrisField(shipCount): near a lonely habitat. Rnd: FindLonelyHabitat's, SelectRelativeParkingPoint(495), the field's. */
function generateDebrisFieldNearLonelyHabitat(galaxy: Galaxy, shipCount: number): void {
    const habitat = findLonelyHabitat(galaxy);
    if (habitat !== null) {
        const habitat2 = galaxy.determineHabitatSystemStar(habitat);
        const name = fmt('{0} Debris Field', habitat2.name);
        const p = galaxy.selectRelativeParkingPoint(495.0);
        generateDebrisField(galaxy, habitat.xpos + p.x, habitat.ypos + p.y, name, shipCount);
    }
}

/**
 * Galaxy.5.cs 3515 GenerateDebrisField(x, y, name, shipCount): a named DebrisField location with damaged unowned wrecks of one
 * empire's (else pirate faction's) tech-3 designs and, with giant Kaltors allowed, a Kaltor swarm. Rnd: Next(1100, 1500) ×2,
 * Next(0, 4) family, Next(0, empires), GenerateDesignFromSpec ×6, per wreck Next(0, 15), SelectUniqueBuiltObjectName,
 * SelectRelativePoint, Next(5, count − 1), Next(0, count) per damaged component, NextDouble fuel; GenerateCreaturesAtLocation.
 */
export function generateDebrisField(galaxy: Galaxy, x: number, y: number, name: string, shipCount: number): void {
    if (name === null || name === '') name = fmt('{0} Debris Field', '');
    const width = galaxy.rnd.next(1100, 1500);
    const height = galaxy.rnd.next(1100, 1500);
    const galaxyLocation = new GalaxyLocation(name, GalaxyLocationType.DebrisField, x, y, width, height, -1);
    galaxyLocation.showName = true;
    galaxy.galaxyLocations.push(galaxyLocation);
    galaxy.addGalaxyLocationIndex(galaxyLocation);
    const family = galaxy.rnd.next(0, 4); // Galaxy.5.cs 3533: the four ShipImageHelper major families, 0-3 in enum order
    let design: Design | null = null;
    let design2: Design | null = null;
    let design3: Design | null = null;
    let design4: Design | null = null;
    let design5: Design | null = null;
    let design6: Design | null = null;
    const starDate = galaxyStarDate(galaxy);
    let empire: Empire | null = null;
    if (galaxy.empires.length > 0) empire = galaxy.empires[galaxy.rnd.next(0, galaxy.empires.length)];
    else if (galaxy.pirateEmpires.length > 0) empire = galaxy.pirateEmpires[galaxy.rnd.next(0, galaxy.pirateEmpires.length)];
    if (empire !== null) {
        const techAdvanceAmount = 3.0;
        design = generateDesignFromSpec(galaxy, empire, galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.Frigate), techAdvanceAmount, starDate);
        design2 = generateDesignFromSpec(galaxy, empire, galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.Destroyer), techAdvanceAmount, starDate);
        design3 = generateDesignFromSpec(galaxy, empire, galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.Cruiser), techAdvanceAmount, starDate);
        design4 = generateDesignFromSpec(galaxy, empire, galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.CapitalShip), techAdvanceAmount, starDate);
        design5 = generateDesignFromSpec(galaxy, empire, galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.TroopTransport), techAdvanceAmount, starDate);
        design6 = generateDesignFromSpec(galaxy, empire, galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.CapitalShip), techAdvanceAmount, starDate);
    }
    for (let i = 0; i < shipCount; i++) {
        let design7: Design | null = null;
        switch (galaxy.rnd.next(0, 15)) {
            case 0:
            case 1:
                design7 = design;
                break;
            case 2:
            case 3:
            case 4:
                design7 = design2;
                break;
            case 5:
            case 6:
            case 7:
                design7 = design3;
                break;
            case 8:
            case 9:
            case 10:
                design7 = design4;
                break;
            case 11:
            case 12:
                design7 = design5;
                break;
            case 13:
            case 14:
                design7 = design6;
                break;
        }
        if (design7 !== null) {
            design7.pictureRef = resolveMajorShipImageIndex(family, design7.subRole, false);
            const name2 = galaxy.selectUniqueBuiltObjectName(design7, null);
            const rp = galaxy.selectRelativePoint(Math.min(galaxyLocation.width, galaxyLocation.height) / 2.0);
            const builtObject = generateUnownedBuiltObjectFromDesign(
                galaxy,
                design7,
                name2,
                null,
                galaxyLocation.xpos + Math.fround(galaxyLocation.width / 2) + rp.x,
                galaxyLocation.ypos + Math.fround(galaxyLocation.height / 2) + rp.y,
            );
            builtObject.isAutoControlled = true;
            builtObject.playerEmpireEncounterAction = BuiltObjectEncounterAction.Notify;
            const num = galaxy.rnd.next(5, builtObject.components.count - 1);
            for (let j = 0; j < num; j++) {
                const index3 = galaxy.rnd.next(0, builtObject.components.count);
                builtObject.components.items[index3].status = ComponentStatus.Damaged;
            }
            builtObject.reDefine();
            builtObject.currentFuel = builtObject.fuelCapacity * 0.2 + galaxy.rnd.nextDouble() * 0.7 * builtObject.fuelCapacity;
            galaxyLocation.relatedBuiltObject = builtObject;
        }
    }
    if (galaxy.allowGiantKaltorGeneration) {
        const amount = Math.max(5, Math.trunc(shipCount / 3.0));
        galaxyLocation.relatedCreatures = generateCreaturesAtLocation(
            galaxy,
            CreatureType.Kaltor,
            amount,
            galaxyLocation.xpos + galaxyLocation.width / 2.0,
            galaxyLocation.ypos + galaxyLocation.height / 2.0,
            Math.trunc(galaxyLocation.width / 2.0) + 150,
            Math.trunc(galaxyLocation.width / 2.0) - 50,
        );
    }
}

/** Galaxy.5.cs 3397 GeneratePlanetDestroyerName(). Rnd: Next(0, 4). */
function generatePlanetDestroyerName(galaxy: Galaxy): string {
    const array = ['World Destroyer', 'Devastation Moon', 'Desolation Moon', 'World Annihilator'];
    return array[galaxy.rnd.next(0, array.length)];
}

/**
 * Galaxy.5.cs 3403 GeneratePlanetDestroyer(): an incomplete planet destroyer at a lonely habitat guarded by six damaged tech-6
 * wrecks and Rock Space Slugs (plus a large "Guardian of X"), as a PlanetDestroyer location. Rnd: FindLonelyHabitat's, the
 * name's Next(0, 4), GenerateIncompletePlanetDestroyer's, Next(0, empires), GenerateDesignFromSpec ×3, the six wrecks'
 * (GenerateUnownedShipAtLocation + DamageBuiltObjectComponents), Next(5, 8) + GenerateCreaturesAtLocation ×2, Next(420, 520).
 */
export function generatePlanetDestroyer(galaxy: Galaxy): void {
    const habitat = findLonelyHabitat(galaxy);
    const name = generatePlanetDestroyerName(galaxy);
    if (habitat === null) return;
    const builtObject = generateIncompletePlanetDestroyer(galaxy, name, habitat);
    let builtObject2: BuiltObject | null = null;
    let design: Design | null = null;
    let design2: Design | null = null;
    let design3: Design | null = null;
    const starDate = galaxyStarDate(galaxy);
    let empire: Empire | null = null;
    if (galaxy.empires.length > 0) empire = galaxy.empires[galaxy.rnd.next(0, galaxy.empires.length)];
    else if (galaxy.pirateEmpires.length > 0) empire = galaxy.pirateEmpires[galaxy.rnd.next(0, galaxy.pirateEmpires.length)];
    if (empire !== null) {
        const techAdvanceAmount = 6.0;
        design = generateDesignFromSpec(galaxy, empire, galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.Frigate), techAdvanceAmount, starDate);
        design2 = generateDesignFromSpec(galaxy, empire, galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.Destroyer), techAdvanceAmount, starDate);
        design3 = generateDesignFromSpec(galaxy, empire, galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.Cruiser), techAdvanceAmount, starDate);
    }
    if (design !== null && design2 !== null && design3 !== null) {
        design.pictureRef = resolveMajorShipImageIndex(ShakturiFamily, design.subRole, false);
        design2.pictureRef = resolveMajorShipImageIndex(ShakturiFamily, design2.subRole, false);
        design3.pictureRef = resolveMajorShipImageIndex(ShakturiFamily, design3.subRole, false);
        builtObject2 = generateUnownedShipAtLocation(galaxy, design, habitat.xpos, habitat.ypos);
        damageBuiltObjectComponents(builtObject2, 0.5);
        builtObject2 = generateUnownedShipAtLocation(galaxy, design, habitat.xpos, habitat.ypos);
        damageBuiltObjectComponents(builtObject2, 0.7);
        builtObject2 = generateUnownedShipAtLocation(galaxy, design, habitat.xpos, habitat.ypos);
        damageBuiltObjectComponents(builtObject2, 0.3);
        builtObject2 = generateUnownedShipAtLocation(galaxy, design2, habitat.xpos, habitat.ypos);
        builtObject2 = generateUnownedShipAtLocation(galaxy, design2, habitat.xpos, habitat.ypos);
        damageBuiltObjectComponents(builtObject2, 0.6);
        builtObject2 = generateUnownedShipAtLocation(galaxy, design3, habitat.xpos, habitat.ypos);
        damageBuiltObjectComponents(builtObject2, 0.3);
        const galaxyLocation = new GalaxyLocation(fmt('{0} Project', builtObject.name), GalaxyLocationType.PlanetDestroyer, builtObject.xpos - 600.0, builtObject.ypos - 600.0, 1200.0, 1200.0, -1);
        galaxyLocation.relatedBuiltObject = builtObject;
        const amount = galaxy.rnd.next(5, 8);
        galaxyLocation.relatedCreatures = generateCreaturesAtLocation(galaxy, CreatureType.RockSpaceSlug, amount, builtObject.xpos, builtObject.ypos, 350, 280);
        const creatureList = generateCreaturesAtLocation(galaxy, CreatureType.RockSpaceSlug, 1, builtObject.xpos, builtObject.ypos, 300, 150);
        const habitat2 = galaxy.determineHabitatSystemStar(habitat);
        if (creatureList != null && creatureList.length > 0 && habitat2 !== null) {
            creatureList[0].name = fmt('Guardian of {0}', habitat2.name);
            creatureList[0].size = galaxy.rnd.next(420, 520);
            creatureList[0].maxSize = 620;
            creatureList[0].attackStrength = Math.trunc(creatureList[0].size / 20.0);
            creatureList[0].damageKillThreshold = Math.trunc(creatureList[0].size * 1.1);
            creatureList[0].movementSpeed = 11; // Creature.SetMovementSpeed(11)
            galaxyLocation.relatedCreatures.push(...creatureList);
        }
        galaxyLocation.showName = true;
        galaxy.galaxyLocations.push(galaxyLocation);
        galaxy.addGalaxyLocationIndex(galaxyLocation);
    }
    void builtObject2;
}

/**
 * Galaxy.7.cs 4835 GenerateIncompletePlanetDestroyer(name, parentHabitat): an unowned planet destroyer (overpower 1.0) near the
 * habitat with ~2/3 of its components unbuilt. Rnd: SelectRelativeParkingPoint, per component Next(0, 3).
 */
export function generateIncompletePlanetDestroyer(galaxy: Galaxy, name: string, parentHabitat: Habitat): BuiltObject {
    const design = generatePlanetDestroyerDesign(galaxy, 1.0, null, galaxyStarDate(galaxy));
    const p = galaxy.selectRelativeParkingPoint();
    const builtObject = generateUnownedBuiltObjectFromDesign(galaxy, design, name, null, parentHabitat.xpos + p.x, parentHabitat.ypos + p.y);
    builtObject.playerEmpireEncounterAction = BuiltObjectEncounterAction.Notify;
    for (let i = 0; i < builtObject.components.count; i++) {
        if (galaxy.rnd.next(0, 3) < 2) builtObject.components.items[i].status = ComponentStatus.Unbuilt;
    }
    builtObject.reDefine();
    return builtObject;
}

/** Galaxy.5.cs 3467 GenerateUnownedShipAtLocation(design, x, y). Rnd: SelectUniqueBuiltObjectName, SelectRelativeParkingPoint, NextDouble fuel. */
export function generateUnownedShipAtLocation(galaxy: Galaxy, design: Design, x: number, y: number): BuiltObject {
    const name = galaxy.selectUniqueBuiltObjectName(design, null);
    const p = galaxy.selectRelativeParkingPoint();
    const builtObject = generateUnownedBuiltObjectFromDesign(galaxy, design, name, null, x + p.x, y + p.y);
    builtObject.isAutoControlled = true;
    builtObject.currentFuel = builtObject.fuelCapacity * 0.1 + galaxy.rnd.nextDouble() * 0.8 * builtObject.fuelCapacity;
    builtObject.playerEmpireEncounterAction = BuiltObjectEncounterAction.Notify;
    return builtObject;
}
