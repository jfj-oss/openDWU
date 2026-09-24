// Ruins at game start: Ruin / RuinType (Ruin.cs, RuinType.cs) and the
// Galaxy methods that place them — Galaxy.6.cs SelectRuins (379-573),
// SelectRuinsUnlockTech (247-271), FindPlanetMoonBeyondRangeOrFurthestNoRuins
// (273-316), SelectRuinDescription (575-653), Galaxy.5.cs GenerateRuinName
// (2622-2828) — plus the two Start.2.cs blocks that drive them:
//   - Start.2.cs 1536-1550: SelectRuins for every habitat whose system has no
//     dominant empire (placeStartRuins),
//   - Start.2.cs 1552-1565: galaxy.Age > 0 bonus clearing (clearRuinBonusesForAge),
//   - Start.2.cs 1276-1304: tech-level-0 "ruins unlock tech" (placeRuinsUnlockTech).
//
// Ruins are generated purely in code: the only ruin "data" in the C# is the
// ruin_*.png images (Main.Part13.cs LoadRuins), indexed by Ruin.PictureRef.
// TextResolver.GetText is not ported; English literals are used directly
// (same convention as galaxy.ts SetScenicFactor / names).

import type { Galaxy } from './galaxy';
import type { Empire } from './empire';
import type { Race } from './data/races';
import { CreatureType } from './creature';
import { Habitat, HabitatCategoryType, HabitatType } from './types';
import { generateBarrenRockPlanet } from './startHabitats';

// Port of RuinType.cs.
export enum RuinType {
    Undefined,
    Standard,
    Government,
    Component,
    NewPopulation,
    Refugees,
    Origins,
    LostBuiltObject,
    LostColony,
    CreatureSwarm,
    PirateAmbush,
    EmpireBonus,
    StoryEvent,
    CreatureSwarmSilverMist,
    UnlockResearchProject,
}

// Port of Ruin.cs (field defaults + ctor + ClearBonuses).
export class Ruin {
    name: string;
    description: string | null = null; // C#: string _Description (null until set)
    developmentBonus: number; // C#: double
    pictureRef: number; // C#: int
    readonly parentX: number; // C#: double _ParentX (get-only)
    readonly parentY: number;
    researchBonus: number; // C#: int
    mapSystemReveal: number; // C#: int
    moneyBonus: number; // C#: double _MoneyBonus = (double)moneyBonus
    gameEventId = -32768; // C#: short GameEventId = short.MinValue
    playerEmpireEncountered: boolean;
    type = RuinType.Standard; // C#: RuinType _Type = RuinType.Standard
    habitatNewRace: Race | null = null;
    specialGovernmentId = 0;
    originsRace: Race | null = null;
    originsApprovalRatingBonus = 0;
    researchProjectId = 0;
    refugeesGenerated = false;
    lostBuiltObjectGenerated = false;
    lostColonyGenerated = false;
    creatureSwarmGenerated = false;
    pirateAmbushGenerated = false;
    bonusResearchEnergy = 0;
    bonusResearchHighTech = 0;
    bonusResearchWeapons = 0;
    bonusWealth = 0;
    bonusHappiness = 0;
    bonusDiplomacy = 0;
    bonusDefensive = 0;
    storyEventData = 0;
    storyClueLevel = -1; // C#: int _StoryClueLevel = -1

    // Port of Ruin.cs ctor Ruin(name, pictureRef, developmentBonus, parentX, parentY, researchBonus, mapSystemReveal, moneyBonus).
    constructor(name: string, pictureRef: number, developmentBonus: number, parentX: number, parentY: number, researchBonus: number, mapSystemReveal: number, moneyBonus: number) {
        this.name = name;
        this.pictureRef = pictureRef;
        this.developmentBonus = developmentBonus;
        this.parentX = parentX;
        this.parentY = parentY;
        this.researchBonus = researchBonus;
        this.mapSystemReveal = mapSystemReveal;
        this.moneyBonus = moneyBonus;
        this.playerEmpireEncountered = false;
    }

    // Port of Ruin.cs ClearBonuses().
    clearBonuses(): void {
        this.moneyBonus = 0.0;
        this.mapSystemReveal = 0;
        this.researchBonus = 0;
        this.habitatNewRace = null;
        this.lostBuiltObjectGenerated = true;
        this.lostColonyGenerated = true;
        this.originsApprovalRatingBonus = 0;
        this.originsRace = null;
        this.refugeesGenerated = true;
        this.creatureSwarmGenerated = true;
        this.pirateAmbushGenerated = true;
        if (this.type !== RuinType.UnlockResearchProject) {
            this.researchProjectId = -1;
        }
        this.specialGovernmentId = -1;
        this.storyEventData = 0;
    }
}

// C#: `if (!_RuinsHabitats.Contains(habitat)) _RuinsHabitats.Add(habitat);` + RuinCount++.
function registerRuin(galaxy: Galaxy, habitat: Habitat): void {
    galaxy.ruinCount++;
    if (!galaxy.ruinsHabitats.includes(habitat)) {
        galaxy.ruinsHabitats.push(habitat);
    }
}

// Port of Galaxy.5.cs GenerateRuinName(habitat, out pictureRef) (2622-2828).
// Rnd: Next(0,15) prefix, Next(0,19) noun, Next(0,5) suffix form, then
// Next(0,list.Count) for the picture when the filtered list is non-empty.
export function generateRuinName(galaxy: Galaxy, habitat: Habitat): { name: string; pictureRef: number } {
    const rnd = galaxy.rnd;
    let pictureRef = 0;
    const list: number[] = [];
    let empty = '';
    let text = '';
    let text2 = '';
    const habitat2 = galaxy.determineHabitatSystemStar(habitat);
    let race: Race | null = null;
    if (habitat.population !== null && habitat.population.dominantRace !== null) {
        race = habitat.population.dominantRace;
    }
    const array = ['Hidden', 'Great', 'Grand', 'Forgotten', 'Granite', 'Lofty', 'High', 'Exalted', 'Stone', 'Secluded', '', '', '', '', ''];
    empty = array[rnd.next(0, array.length)];
    switch (rnd.next(0, 19)) {
        case 0:
            text = 'Hall';
            list.push(0, 10, 7, 8, 14, 15);
            break;
        case 1:
            text = 'Temple';
            list.push(1, 2, 3, 9, 10);
            break;
        case 2:
            text = 'Pyramid';
            list.push(1, 2);
            break;
        case 3:
            text = 'Citadel';
            list.push(3, 7, 8, 14, 15);
            break;
        case 4:
            text = 'Fortress';
            list.push(7, 8, 14, 15);
            break;
        case 5:
            text = 'Tower';
            list.push(5, 6);
            break;
        case 6:
            text = 'Tomb';
            list.push(1, 2, 9);
            break;
        case 7:
            text = 'Sanctuary';
            list.push(3, 9, 10);
            break;
        case 8:
            text = 'Library';
            list.push(0, 10);
            break;
        case 9:
            text = 'Palace';
            list.push(3, 7, 8);
            break;
        case 10:
            text = 'Archives';
            list.push(0, 10);
            break;
        case 11:
            text = 'Monastery';
            list.push(7, 8, 14, 15);
            break;
        case 12:
            text = 'Retreat';
            list.push(14, 15);
            break;
        case 13:
            text = 'Nexus';
            list.push(7, 8, 13);
            break;
        case 14:
            text = 'Chamber';
            list.push(1, 2, 9);
            break;
        case 15:
            text = 'Pillar';
            list.push(5, 6);
            break;
        case 16:
            text = 'Obelisk';
            list.push(5, 6);
            break;
        case 17:
            text = 'Gate';
            list.push(4);
            break;
        case 18:
            text = 'City';
            list.push(13);
            break;
    }
    switch (rnd.next(0, 5)) {
        case 0:
            text2 = 'of ' + habitat2.name;
            break;
        case 1:
        case 2:
            text2 = race === null ? 'of ' + habitat2.name : 'of the ' + race.name + 's';
            break;
        case 3:
        case 4:
            text2 = empty === '' ? 'of ' + habitat2.name : '';
            break;
    }
    const list2 = [15];
    const list3 = [2, 10];
    const list4 = [1, 8, 9];
    // C# List<int>.Remove removes the first occurrence (lists hold no duplicates).
    const removeAll = (items: number[]): void => {
        for (const item of items) {
            const i = list.indexOf(item);
            if (i >= 0) {
                list.splice(i, 1);
            }
        }
    };
    if (habitat.type === HabitatType.MarshySwamp || habitat.type === HabitatType.Desert || habitat.type === HabitatType.Volcanic || habitat.type === HabitatType.Ocean) {
        removeAll(list2);
    }
    if (habitat.type === HabitatType.MarshySwamp || habitat.type === HabitatType.Continental || habitat.type === HabitatType.Ice || habitat.type === HabitatType.BarrenRock || habitat.type === HabitatType.Ocean) {
        removeAll(list3);
    }
    if (habitat.type === HabitatType.Desert || habitat.type === HabitatType.Volcanic || habitat.type === HabitatType.Ice || habitat.type === HabitatType.BarrenRock) {
        removeAll(list4);
    }
    if (list.length > 0) {
        pictureRef = list[rnd.next(0, list.length)];
    } else {
        pictureRef = 0;
    }
    let text3 = '';
    if (empty !== '') {
        text3 = text3 + empty + ' ';
    }
    text3 += text;
    if (text2 !== '') {
        text3 = text3 + ' ' + text2;
    }
    return { name: text3, pictureRef };
}

// Port of Galaxy.6.cs SelectRuinDescription(habitat) (575-653).
// Rnd: Next(0,len) for the type phrase, Next(0,4), [Next(0,5) if ==1], Next(0,6).
export function selectRuinDescription(galaxy: Galaxy, habitat: Habitat): string {
    const rnd = galaxy.rnd;
    const array = [
        'From our position in orbit we can see that',
        'Our orbital inspection reveals that',
        'Surveying from orbit indicates that',
        'Our scanners show that',
        'Our sensors indicate that',
        'From our orbital inspection we detect that',
    ];
    const array2 = [
        'appear completely deserted',
        'have been vacated for a considerable time',
        'have lain undisturbed for centuries',
        'are in an advanced state of decay and disrepair',
        'date from an extremely distant past age',
    ];
    const array3 = [
        'lie deep in a dense forest',
        'sit on a rocky mountain outcrop',
        'are located in the midst of a grassy plain',
        'sit at the bottom of a forest-covered valley',
        'are perched atop rocky coastal cliffs overlooking a vast ocean',
    ];
    const array4 = [
        'are surrounded by lush jungle',
        'are situated on a reed-covered island in the middle of a marshy bog',
        'are located in a clearing in the heart of a swampy jungle',
        'sit in a grassy riverside clearing upstream from a large waterfall',
        'are half-buried in undergrowth near a huge swampy wasteland',
    ];
    const array5 = [
        'lie half buried by deep sand drifts',
        'are nearly consumed by a vast sandbank',
        'are set into the wall of a rocky canyon',
        'are perched atop a precipice overlooking a vast dusty plain',
        'are situated atop a large mesa in a desert plain',
    ];
    const array6 = [
        'sit on a rocky island lashed by giant storm waves from the surrounding sea',
        'sit half-submerged atop a vast reef in the midst of an endless ocean',
    ];
    const array7 = ['lie deep in snow drifts at the peak of a windswept mountain pass', 'are located near the edge of an icy tundra wasteland'];
    const array8 = [
        'sit on a stone ledge overlooking a fiery lake of lava',
        'lie in the midst of a vast rocky plain blanketed with thousands of geothermal steam vents',
    ];
    const array9 = ['sit at the center of a shadowy, star-lit plain', 'lie at the bottom of a desolate, rocky valley'];
    let empty2: string;
    switch (habitat.type) {
        case HabitatType.BarrenRock:
            empty2 = array9[rnd.next(0, array9.length)];
            break;
        case HabitatType.Continental:
            empty2 = array3[rnd.next(0, array3.length)];
            break;
        case HabitatType.Ice:
            empty2 = array7[rnd.next(0, array7.length)];
            break;
        case HabitatType.MarshySwamp:
            empty2 = array4[rnd.next(0, array4.length)];
            break;
        case HabitatType.Ocean:
            empty2 = array6[rnd.next(0, array6.length)];
            break;
        case HabitatType.Desert:
            empty2 = array5[rnd.next(0, array5.length)];
            break;
        case HabitatType.Volcanic:
            empty2 = array8[rnd.next(0, array8.length)];
            break;
        default:
            empty2 = array2[rnd.next(0, array2.length)];
            break;
    }
    if (rnd.next(0, 4) === 1) {
        empty2 = array2[rnd.next(0, array2.length)];
    }
    const text = array[rnd.next(0, array.length)];
    return text + ' ' + 'the ruins' + ' ' + empty2 + '.';
}

// Port of Galaxy.6.cs SelectRuins(habitat, definitePlacement, assignCreatures,
// allowNegativeEffects, allowMapReveal) (379-573). The 1-arg overload used by
// Start.2.cs 1548 is SelectRuins(habitat, false, true, true, true) — the defaults.
export function selectRuins(galaxy: Galaxy, habitat: Habitat, definitePlacement = false, assignCreatures = true, allowNegativeEffects = true, allowMapReveal = true): void {
    const rnd = galaxy.rnd;
    if (
        habitat.ruin !== null ||
        (!definitePlacement &&
            ((habitat.empire !== null && habitat.empire !== galaxy.independentEmpire) ||
                habitat.category === HabitatCategoryType.Asteroid ||
                habitat.category === HabitatCategoryType.Star ||
                habitat.category === HabitatCategoryType.GasCloud ||
                habitat.diameter < 60 ||
                (habitat.type !== HabitatType.Continental && habitat.type !== HabitatType.MarshySwamp && habitat.type !== HabitatType.Desert)))
    ) {
        return;
    }
    const num = 1.0;
    const num2 = rnd.nextDouble();
    let num3 = 0.0;
    let flag = false;
    let researchBonus = 0;
    let mapSystemReveal = 0;
    let moneyBonus = 0;
    if (habitat.owner === null) {
        if (allowMapReveal) {
            switch (rnd.next(0, 3)) {
                case 0:
                    researchBonus = rnd.next(60000, 120000);
                    break;
                case 1:
                    mapSystemReveal = rnd.next(7, 14);
                    break;
                case 2:
                    moneyBonus = rnd.next(4000, 10000);
                    break;
            }
        } else {
            switch (rnd.next(0, 2)) {
                case 0:
                    researchBonus = rnd.next(60000, 120000);
                    break;
                case 1:
                    moneyBonus = rnd.next(4000, 10000);
                    break;
            }
        }
    }
    let type = RuinType.Standard;
    if (allowNegativeEffects && (galaxy.creaturePrevalence > 0.0 || galaxy.piratePrevalence > 0.0) && rnd.next(0, 4) === 1) {
        researchBonus = 0;
        mapSystemReveal = 0;
        moneyBonus = 0;
        let num4 = rnd.next(0, 2);
        if (galaxy.creaturePrevalence <= 0.0 || !galaxy.allowGiantKaltorGeneration) {
            num4 = 1;
        } else if (galaxy.piratePrevalence <= 0.0) {
            num4 = 0;
        }
        switch (num4) {
            case 0:
                type = RuinType.CreatureSwarm;
                break;
            case 1:
                type = RuinType.PirateAmbush;
                break;
        }
    }
    const description = selectRuinDescription(galaxy, habitat);
    const { name, pictureRef } = generateRuinName(galaxy, habitat);
    // Galaxy.6.cs 461-542: one case per type, identical bodies apart from the
    // threshold (Continental/MarshySwamp 0.16, Desert/Ocean/Ice/Volcanic/BarrenRock 0.06).
    const place = (): void => {
        if (definitePlacement || num2 <= num3) {
            const p = galaxy.selectRelativeHabitatSurfacePoint(habitat);
            habitat.ruin = new Ruin(name, pictureRef, 0.1 + rnd.nextDouble() * 0.2, p.x, p.y, researchBonus, mapSystemReveal, moneyBonus);
            flag = true;
        }
    };
    switch (habitat.type) {
        case HabitatType.Continental:
            num3 = num * 0.16;
            place();
            break;
        case HabitatType.MarshySwamp:
            num3 = num * 0.16;
            place();
            break;
        case HabitatType.Desert:
            num3 = num * 0.06;
            place();
            break;
        case HabitatType.Ocean:
            num3 = num * 0.06;
            place();
            break;
        case HabitatType.Ice:
            num3 = num * 0.06;
            place();
            break;
        case HabitatType.Volcanic:
            num3 = num * 0.06;
            place();
            break;
        case HabitatType.BarrenRock:
            num3 = num * 0.06;
            place();
            break;
    }
    // (TS narrowed habitat.ruin to null at the top; place() may have set it.)
    const placed = habitat.ruin as Ruin | null;
    if (placed !== null) {
        placed.type = type;
        placed.description = description;
    }
    if (!flag) {
        return;
    }
    registerRuin(galaxy, habitat);
    if (!assignCreatures || habitat.owner !== null || rnd.next(0, 3) !== 1 || !(galaxy.creaturePrevalence > 0.0)) {
        return;
    }
    switch (rnd.next(0, 3)) {
        case 0:
            galaxy.generateCreatureAtHabitat(CreatureType.Ardilus, habitat, true);
            break;
        case 1:
            if (galaxy.allowGiantKaltorGeneration) {
                galaxy.generateCreatureAtHabitat(CreatureType.Kaltor, habitat, true);
            }
            break;
        case 2:
            if (galaxy.allowGiantKaltorGeneration) {
                const num5 = rnd.next(2, 4);
                for (let i = 0; i < num5; i++) {
                    galaxy.generateCreatureAtHabitat(CreatureType.Kaltor, habitat, true);
                }
            }
            break;
    }
}

// Port of Galaxy.6.cs SelectRuinsUnlockTech(habitat, researchNodeId) (247-271).
// Rnd: GenerateRuinName, SelectRelativeHabitatSurfacePoint (NextDouble + heading
// NextDouble), NextDouble (development bonus), SelectRuinDescription.
export function selectRuinsUnlockTech(galaxy: Galaxy, habitat: Habitat | null, researchNodeId: number): boolean {
    if (habitat === null || researchNodeId < 0) {
        return false;
    }
    if (habitat.ruin !== null) {
        return true;
    }
    const { name, pictureRef } = generateRuinName(galaxy, habitat);
    const p = galaxy.selectRelativeHabitatSurfacePoint(habitat);
    const ruin = new Ruin(name, pictureRef, 0.1 + galaxy.rnd.nextDouble() * 0.2, p.x, p.y, 0, 0, 0);
    ruin.type = RuinType.UnlockResearchProject;
    ruin.researchProjectId = researchNodeId;
    ruin.description = selectRuinDescription(galaxy, habitat);
    registerRuin(galaxy, habitat);
    habitat.ruin = ruin;
    return true;
}

// Port of Galaxy.6.cs FindPlanetMoonBeyondRangeOrFurthestNoRuins(center,
// habitats, range, out distance) (273-316). No Rnd.
export function findPlanetMoonBeyondRangeOrFurthestNoRuins(galaxy: Galaxy, center: Habitat | null, habitats: readonly Habitat[] | null, range: number): { habitat: Habitat | null; distance: number } {
    let result: Habitat | null = null;
    let distance = 0.0;
    let num = 0.0;
    const num2 = range * range;
    if (center !== null && habitats !== null) {
        for (let i = 0; i < habitats.length; i++) {
            const habitat = habitats[i];
            if (
                habitat === null ||
                habitat === center ||
                (habitat.category !== HabitatCategoryType.Planet && habitat.category !== HabitatCategoryType.Moon) ||
                habitat.ruin !== null
            ) {
                continue;
            }
            let flag = false;
            switch (habitat.type) {
                case HabitatType.Volcanic:
                case HabitatType.Desert:
                case HabitatType.MarshySwamp:
                case HabitatType.Continental:
                case HabitatType.Ocean:
                case HabitatType.BarrenRock:
                case HabitatType.Ice:
                    flag = true;
                    break;
            }
            if (flag) {
                const num3 = galaxy.calculateDistanceSquared(center.xpos, center.ypos, habitat.xpos, habitat.ypos);
                if (num3 >= num2) {
                    distance = Math.sqrt(num3);
                    return { habitat, distance };
                }
                if (num3 > num) {
                    result = habitat;
                    num = num3;
                }
            }
        }
    }
    distance = Math.sqrt(num);
    return { habitat: result, distance };
}

// C# `SystemInfo.DominantEmpire != null && SystemInfo.DominantEmpire.Empire != null`.
function systemHasDominantEmpire(galaxy: Galaxy, systemIndex: number): boolean {
    const dom = galaxy.systems[systemIndex].dominantEmpire;
    return dom !== undefined && dom !== null && dom.empire !== null;
}

// Port of Start.2.cs 1536-1550 (the `gameStartResets_0 == null ||
// GalaxyFilepath empty || ResetRuins` block — always taken for a new game):
// SelectRuins(habitat) for every habitat in Galaxy.Habitats order whose system
// has no dominant empire. Requires Galaxy.updateSystemInfo() to be current.
export function placeStartRuins(galaxy: Galaxy): void {
    // C# foreach over Galaxy.Habitats; SelectRuins can only add creatures
    // (never habitats), so iterating the live array matches.
    for (const habitat22 of galaxy.habitats) {
        let flag5 = true;
        if (systemHasDominantEmpire(galaxy, habitat22.systemIndex)) {
            flag5 = false;
        }
        if (flag5) {
            selectRuins(galaxy, habitat22);
        }
    }
}

// Port of Start.2.cs 1552-1565: when galaxy.Age > 0, ruins (other than
// UnlockResearchProject) in systems with a dominant empire lose their bonuses;
// those in the player's dominant systems are marked encountered. No Rnd.
export function clearRuinBonusesForAge(galaxy: Galaxy): void {
    if (galaxy.age > 0) {
        for (const habitat23 of galaxy.habitats) {
            if (habitat23.ruin !== null && habitat23.ruin.type !== RuinType.UnlockResearchProject && systemHasDominantEmpire(galaxy, habitat23.systemIndex)) {
                habitat23.ruin.clearBonuses();
                if (galaxy.systems[habitat23.systemIndex].dominantEmpire!.empire === galaxy.playerEmpire) {
                    habitat23.ruin.playerEmpireEncountered = true;
                }
            }
        }
    }
}

// Port of Start.2.cs 1274-1304 (per-empire, inside the empire-start loop):
// at tech level 0 the empire gets an UnlockResearchProject ruin (research node
// with SpecialFunctionCode 2) on the furthest planet/moon of its home system
// (or the first one >= 20000 away); if none exists, a BarrenRock planet is
// generated and added to the home system first.
export function placeRuinsUnlockTech(galaxy: Galaxy, empire: Empire, techLevel: number): void {
    if (techLevel === 0.0) {
        // Galaxy.ResearchNodeDefinitionsStatic.FindNodeBySpecialFunctionCode(2)
        // (ResearchNodeDefinitionList.cs 1247): first node in list order.
        const definitions = galaxy.researchStatic?.definitions ?? [];
        let researchNodeDefinition: (typeof definitions)[number] | null = null;
        for (let index = 0; index < definitions.length; ++index) {
            if (definitions[index].specialFunctionCode === 2) {
                researchNodeDefinition = definitions[index];
                break;
            }
        }
        if (researchNodeDefinition !== null) {
            const capital = empire.capital!;
            const habitats = galaxy.systemHabitatsOf(capital.systemIndex);
            const found = findPlanetMoonBeyondRangeOrFurthestNoRuins(galaxy, capital, habitats, 20000.0);
            let habitat10 = found.habitat;
            if (habitat10 !== null) {
                selectRuinsUnlockTech(galaxy, habitat10, researchNodeDefinition.projectId);
            } else {
                const habitat11 = galaxy.determineHabitatSystemStar(capital);
                habitat10 = generateBarrenRockPlanet(galaxy, habitat11);
                if (habitat10 !== null) {
                    // C# Monitor.Enter(galaxy._LockObject) around AddHabitat — no-op here.
                    galaxy.addHabitat(habitat10, habitat11);
                    // TODO(port): Galaxy.AddHabitat's FixResourceMaps (shifts every empire's
                    // ResourceMap bits past the inserted index) is not ported in galaxy.ts.
                    empire.resourceMap.setResourcesKnown(habitat10, false);
                    selectRuinsUnlockTech(galaxy, habitat10, researchNodeDefinition.projectId);
                }
            }
        }
    }
}
