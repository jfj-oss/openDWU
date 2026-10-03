// Message-text helpers of the Galaxy: Galaxy.1.cs 1314 GenerateIndependentColonyReport, 1390 GenerateRaceReport,
// Galaxy.2.cs 2074 ResolveRaceFamilyDescription and Galaxy.5.cs 4807 / 4852 GenerateLocationDescription.
// Texts go through formatGameTextNow (the C# string.Format(TextResolver.GetText(tag), args)); headless without a GameText
// table they come back as the gameText() encoding.
//
// Rnd: only GenerateIndependentColonyReport, and only for the player (GenerateIndependentColonyStoryClue's Next(0, n)
// when a secondary clue is still open — story games only).

import type { Galaxy } from './galaxy';
import type { Empire } from './empire';
import type { Race } from './data/races';
import { HabitatCategoryType, HabitatType, type Habitat } from './types';
import { GalaxyLocationType } from './galaxyLocation';
import { formatGameTextNow } from './textResolver';
import { resolveDescription } from './messages';
import { resolveSectorDescription } from './empireEvents';
import { raceAggressionLevel, raceCautionLevel, raceFriendlinessLevel } from './racePeriodic';
import { checkColonizationLikeliness } from './tradeItems';
import { generateIndependentColonyStoryClue } from './story/storyEvents';
import { MAX_SOLAR_SYSTEM_SIZE } from './visibility';

/** Galaxy.2.cs 2074 ResolveRaceFamilyDescription(raceFamilyId): RaceFamiliesStatic[id].Name, '' out of range. */
export function resolveRaceFamilyDescription(galaxy: Galaxy, raceFamilyId: number): string {
    if (raceFamilyId >= 0 && raceFamilyId < galaxy.raceFamilies.length) return galaxy.raceFamilies[raceFamilyId].name;
    return '';
}

/** Galaxy.1.cs 1309 DeviationFromNormal(value). */
function deviationFromNormal(value: number): number {
    return Math.abs(value - 100);
}

/** `ResolveDescription(habitat.Type).ToLower()` / `ResolveDescription(habitat.Category).ToLower()`. */
function typeLower(habitat: Habitat): string {
    return resolveDescription(HabitatType as unknown as Record<number, string>, habitat.type).toLowerCase();
}
function categoryLower(habitat: Habitat): string {
    return resolveDescription(HabitatCategoryType as unknown as Record<number, string>, habitat.category).toLowerCase();
}

/**
 * Galaxy.1.cs 1390 GenerateRaceReport(race): the race's most marked trait (the largest deviation from 100 among
 * aggression, caution, friendliness, intelligence, loyalty — Race.*Level, the periodic values while a change period
 * is active), its advancement and family, then its bonus abilities. No Rnd.
 */
export function generateRaceReport(galaxy: Galaxy, race: Race): string {
    let empty = '';
    let num = 0;
    let text = '';
    const aggression = raceAggressionLevel(galaxy, race);
    const caution = raceCautionLevel(galaxy, race);
    const friendliness = raceFriendlinessLevel(galaxy, race);
    const intelligence = race.intelligence;
    const loyalty = race.loyalty;
    if (deviationFromNormal(aggression) > num) {
        num = deviationFromNormal(aggression);
        text = aggression <= 100 ? formatGameTextNow('Passive') : formatGameTextNow('Aggressive');
    }
    if (deviationFromNormal(caution) > num) {
        num = deviationFromNormal(caution);
        text = caution < 100 ? formatGameTextNow('Reckless') : formatGameTextNow('Cautious');
    }
    if (deviationFromNormal(friendliness) > num) {
        num = deviationFromNormal(friendliness);
        text = friendliness < 100 ? formatGameTextNow('Unfriendly') : formatGameTextNow('Friendly');
    }
    if (deviationFromNormal(intelligence) > num) {
        num = deviationFromNormal(intelligence);
        text = intelligence < 100 ? formatGameTextNow('Stupid') : formatGameTextNow('Intelligent');
    }
    if (deviationFromNormal(loyalty) > num) {
        num = deviationFromNormal(loyalty);
        text = loyalty < 100 ? formatGameTextNow('Unreliable') : formatGameTextNow('Dependable');
    }
    const empty2 = num > 30 ? formatGameTextNow('Extremely') : num > 20 ? formatGameTextNow('Very') : num <= 10 ? formatGameTextNow('Slightly') : formatGameTextNow('Quite');
    const empty3 =
        intelligence > 120
            ? formatGameTextNow('a highly advanced')
            : intelligence > 109
              ? formatGameTextNow('an advanced')
              : intelligence > 100
                ? formatGameTextNow('an average')
                : intelligence <= 85
                  ? formatGameTextNow('a primitive')
                  : formatGameTextNow('a slightly backward');
    const family = resolveRaceFamilyDescription(galaxy, race.raceFamily);
    empty +=
        text === ''
            ? formatGameTextNow('Race Report RACE ADVANCEMENT RACEFAMILY', [race.name, empty3, family])
            : formatGameTextNow('Race Report RACE ADVANCEMENT RACEFAMILY INTENSITY QUALITY', [race.name, empty3, family, empty2.toLowerCase(), text.toLowerCase()]);
    empty += '. ';
    let text2 = '';
    const ability = (has: boolean, abilityTag: string): void => {
        if (!has) return;
        text2 += text2 === '' ? formatGameTextNow('Race Bonus ABILITY', [formatGameTextNow(abilityTag)]) : formatGameTextNow('Race Bonus Extra ABILITY', [formatGameTextNow(abilityTag)]);
        text2 += '. ';
    };
    ability(race.espionageBonus > 0, 'cunning spies');
    ability(race.researchBonus > 0, 'gifted scientists');
    ability(race.resourceExtractionBonus > 0, 'industrious miners');
    ability(race.satisfactionModifier > 0, 'natural optimists');
    ability(race.shipMaintenanceSavings > 0, 'master starship engineers');
    ability(race.troopMaintenanceSavings > 0, 'superb ground troops');
    ability(race.warWearinessAttenuation > 0, 'tenacious fighters');
    return empty + text2;
}

/** Galaxy.5.cs 4852 GenerateLocationDescription(habitat): "the <type> <category> <name> in the <system> system, <sector>". No Rnd. */
export function generateHabitatLocationDescription(galaxy: Galaxy, habitat: Habitat): string {
    const habitat2 = galaxy.determineHabitatSystemStar(habitat);
    return formatGameTextNow('Location Planet', [typeLower(habitat), categoryLower(habitat), habitat.name, habitat2?.name ?? '', resolveSectorDescription(galaxy, habitat.xpos, habitat.ypos)]);
}

/** Galaxy.7.cs 2317/2332 FindNearestHabitat(x, y): the HabitatIndex ring search over every habitat. */
function findNearestHabitat(galaxy: Galaxy, x: number, y: number): Habitat | null {
    const ix = Math.trunc(x);
    const iy = Math.trunc(y);
    return galaxy.ringSearch(x, y, (cx, cy) => {
        let habitat: Habitat | null = null;
        let distance = Number.MAX_VALUE;
        for (const h of galaxy.habitatIndexGrid[cx][cy]) {
            const dx = ix - h.xpos;
            const dy = iy - h.ypos;
            const num = dx * dx + dy * dy;
            if (!(num < distance)) continue;
            habitat = h;
            distance = num;
        }
        if (habitat !== null) distance = galaxy.calculateDistance(ix, iy, habitat.xpos, habitat.ypos);
        return { item: habitat, distance };
    });
}

/**
 * Galaxy.5.cs 4807 GenerateLocationDescription(x, y, prefixWithA): the nearest habitat's description within 500,
 * else "[a] location [in the <nebula>] [near <system>] in <sector>" (the nebula / restricted area / supernova named at
 * the point; the system named only when the point is outside it). No Rnd.
 */
export function generateLocationDescription(galaxy: Galaxy, x: number, y: number, prefixWithA = false): string {
    const habitat = findNearestHabitat(galaxy, x, y);
    // C# dereferences the nearest habitat unguarded (every galaxy has habitats).
    let num = galaxy.calculateDistance(x, y, habitat!.xpos, habitat!.ypos);
    if (num < 500.0) return generateHabitatLocationDescription(galaxy, habitat!);
    let text = '';
    const galaxyLocationList = galaxy.determineGalaxyLocationsAtPoint(x, y);
    if (galaxyLocationList != null && galaxyLocationList.length > 0) {
        for (let i = 0; i < galaxyLocationList.length; i++) {
            const t = galaxyLocationList[i].type;
            if ((t === GalaxyLocationType.NebulaCloud || t === GalaxyLocationType.RestrictedArea || t === GalaxyLocationType.SuperNova) && galaxyLocationList[i].name !== '' && galaxyLocationList[i].name != null) {
                text = galaxyLocationList[i].name;
                break;
            }
        }
    }
    let text2 = '';
    const habitat2 = galaxy.determineHabitatSystemStar(habitat!)!;
    num = galaxy.calculateDistance(x, y, habitat2.xpos, habitat2.ypos);
    if (num > MAX_SOLAR_SYSTEM_SIZE * 2.1) text2 = habitat2.name;
    const sector = resolveSectorDescription(galaxy, habitat2.xpos, habitat2.ypos);
    if (text !== '') return formatGameTextNow(prefixWithA ? 'A Location Description Nebula' : 'Location Description Nebula', [text, text2, sector]);
    return formatGameTextNow(prefixWithA ? 'A Location Description' : 'Location Description', [text2, sector]);
}

/**
 * Galaxy.1.cs 1314 GenerateIndependentColonyReport(potentialColonizer, colony, race): the discovery report of an
 * independent colony (its race when not the colonizer's own, a story clue for the player, the colonization outlook).
 * Rnd: GenerateIndependentColonyStoryClue's (player only).
 */
export function generateIndependentColonyReport(galaxy: Galaxy, potentialColonizer: Empire, colony: Habitat, race: Race): string {
    const habitat = galaxy.determineHabitatSystemStar(colony);
    let text = formatGameTextNow('Independent Colony Report Intro', [race.name, typeLower(colony), categoryLower(colony), colony.name, habitat?.name ?? '']);
    text += '.\n\n';
    if (potentialColonizer.dominantRace !== race) {
        text += generateRaceReport(galaxy, race);
        text += '\n\n';
    }
    if (potentialColonizer === galaxy.playerEmpire) {
        const text2 = generateIndependentColonyStoryClue(galaxy, colony);
        if (text2 !== '') {
            text += '*** ';
            text += formatGameTextNow('Independent Colony Legend Intro', [race.name]);
            text += text2;
            text += ' ***\n\n';
        }
    }
    const category = resolveDescription(HabitatCategoryType as unknown as Record<number, string>, colony.category);
    const num = checkColonizationLikeliness(galaxy, colony, potentialColonizer.dominantRace!);
    if (num <= -20) return text + formatGameTextNow('Independent Colony Colonization Hostile', [category]);
    if (num <= 0) return text + formatGameTextNow('Independent Colony Colonization Unlikely', [category]);
    return text + formatGameTextNow('Independent Colony Colonization Good', [category]);
}
