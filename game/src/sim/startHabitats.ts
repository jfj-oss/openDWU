// Per-empire start-habitat blocks of the Start.2.cs empire-start loop:
//   - Start.2.cs 1156-1173: research-bonus gas giant near the capital
//     (applyResearchBonusGasGiant),
//   - Start.2.cs 1174-1273: tech-level-0 "important pre-warp resource"
//     guarantee (ensureImportantPreWarpResources),
// plus the Galaxy.8.cs habitat generators those blocks (and ruins.ts
// placeRuinsUnlockTech) call: GenerateGasGiantPlanet (200),
// GenerateFrozenGasGiantPlanet (225), GenerateDesertPlanet (250),
// GenerateOceanPlanet (289), GenerateSwampPlanet (328),
// GenerateBarrenRockPlanet (402), GenerateAsteroid (427),
// GenerateVolcanicPlanet (497), GenerateIcePlanet (536).
// GenerateContinentalPlanet (458) already exists as Galaxy.generateContinentalPlanet.
//
// The Galaxy.6.cs Select*Planet helpers and Galaxy.8.cs
// GeneratePlanetaryOrbitDistance are private Galaxy members in galaxy.ts;
// they are reached here through TS bracket access (galaxy['name']), which
// keeps galaxy.ts untouched.

import type { Galaxy } from './galaxy';
import type { Empire } from './empire';
import type { Resource } from './data/resources';
import { CargoList, TroopList } from './cargo';
import { ensureHabitatManufacturingQueue } from './manufacturingQueue';
import { Habitat, HabitatCategoryType, HabitatType, IndustryType } from './types';

// GalaxyImages.cs 30 / 55.
const HABITAT_IMAGE_OFFSET_ASTEROIDS_NORMAL = 249;
const HABITAT_IMAGE_COUNT_ASTEROIDS_NORMAL = 200;

type PlanetSelection = { type: HabitatType; diameter: number; minOrbitDistance: number; maxOrbitDistance: number; pictureRef: number; landscapePictureRef: number };
type PlanetSelector = 'selectGasGiantPlanet' | 'selectFrozenGasGiantPlanet' | 'selectDesertPlanet' | 'selectOceanPlanet' | 'selectMarshySwampPlanet' | 'selectBarrenRockPlanet' | 'selectVolcanicPlanet' | 'selectIcePlanet';

// Shared body of the Galaxy.8.cs Generate*Planet methods (they differ only in
// the Select*Planet call and whether the colony lists are created):
//   Select*Planet(out ...) ; GeneratePlanetaryOrbitDistance ;
//   new Habitat(galaxy, Planet, type, GenerateRandomName(), sun, Rnd.NextDouble()*PI*2, true, orbitdistance, Rnd.Next(2,5)) ;
//   Diameter/PictureRef/LandscapePictureRef ; BaseQuality = SelectHabitatQuality ;
//   DoTasks ; SelectResources ; if (Rnd.Next(0,5)==2) OrbitDirection=false ; Cargo = new CargoList().
function generatePlanet(galaxy: Galaxy, sun: Habitat, selector: PlanetSelector, colonyLists: boolean): Habitat {
    const sel: PlanetSelection = galaxy[selector]();
    const orbitdistance: number = galaxy['generatePlanetaryOrbitDistance'](sun, sel.minOrbitDistance, sel.maxOrbitDistance);
    // C# argument evaluation order: GenerateRandomName(), Rnd.NextDouble(), Rnd.Next(2, 5).
    const name = galaxy.generateRandomName();
    const orbitAngle = galaxy.rnd.nextDouble() * Math.PI * 2.0;
    let habitat = new Habitat(HabitatCategoryType.Planet, sel.type, name, sun, orbitAngle, true, orbitdistance, galaxy.rnd.next(2, 5));
    habitat.diameter = sel.diameter;
    habitat.pictureRef = sel.pictureRef;
    habitat.landscapePictureRef = sel.landscapePictureRef;
    habitat.baseQuality = galaxy.selectHabitatQuality(habitat, galaxy.colonyPrevalence);
    // TODO(port): habitat.DoTasks(galaxy.CurrentDateTime) — Habitat.DoTasks is not ported
    // (same TODO as Galaxy.generateContinentalPlanet).
    habitat = galaxy.selectResources(habitat);
    if (galaxy.rnd.next(0, 5) === 2) {
        habitat.orbitDirection = false;
    }
    habitat.cargo = new CargoList();
    if (colonyLists) {
        habitat.troops = new TroopList();
        habitat.troopsToRecruit = new TroopList();
        habitat.invadingTroops = new TroopList();
        // TODO(port): ConstructionQueue / 20 DockingBays of
        // component 74 / DockingBayWaitQueue (no Rnd, no ID counters) — models not ported.
        // Galaxy.8.cs 276/315/354/523/562 (M4g): habitat.ManufacturingQueue = new ManufacturingQueue(habitat, galaxy).
        ensureHabitatManufacturingQueue(galaxy, habitat);
    }
    return habitat;
}

// Port of Galaxy.8.cs GenerateGasGiantPlanet(galaxy, sun) (200).
export function generateGasGiantPlanet(galaxy: Galaxy, sun: Habitat): Habitat {
    return generatePlanet(galaxy, sun, 'selectGasGiantPlanet', false);
}

// Port of Galaxy.8.cs GenerateFrozenGasGiantPlanet(galaxy, sun) (225).
export function generateFrozenGasGiantPlanet(galaxy: Galaxy, sun: Habitat): Habitat {
    return generatePlanet(galaxy, sun, 'selectFrozenGasGiantPlanet', false);
}

// Port of Galaxy.8.cs GenerateDesertPlanet(galaxy, sun) (250).
export function generateDesertPlanet(galaxy: Galaxy, sun: Habitat): Habitat {
    return generatePlanet(galaxy, sun, 'selectDesertPlanet', true);
}

// Port of Galaxy.8.cs GenerateOceanPlanet(galaxy, sun) (289).
export function generateOceanPlanet(galaxy: Galaxy, sun: Habitat): Habitat {
    return generatePlanet(galaxy, sun, 'selectOceanPlanet', true);
}

// Port of Galaxy.8.cs GenerateSwampPlanet(galaxy, sun) (328).
export function generateSwampPlanet(galaxy: Galaxy, sun: Habitat): Habitat {
    return generatePlanet(galaxy, sun, 'selectMarshySwampPlanet', true);
}

// Port of Galaxy.8.cs GenerateBarrenRockPlanet(galaxy, sun) (402).
export function generateBarrenRockPlanet(galaxy: Galaxy, sun: Habitat): Habitat {
    return generatePlanet(galaxy, sun, 'selectBarrenRockPlanet', false);
}

// Port of Galaxy.8.cs GenerateVolcanicPlanet(galaxy, sun) (497).
export function generateVolcanicPlanet(galaxy: Galaxy, sun: Habitat): Habitat {
    return generatePlanet(galaxy, sun, 'selectVolcanicPlanet', true);
}

// Port of Galaxy.8.cs GenerateIcePlanet(galaxy, sun) (536).
export function generateIcePlanet(galaxy: Galaxy, sun: Habitat): Habitat {
    return generatePlanet(galaxy, sun, 'selectIcePlanet', true);
}

// Port of Galaxy.8.cs GenerateAsteroid(galaxy, sun, type) (427). Note the
// source discards three Rnd.Next results (an unused orbit roll, and the
// Ice/Metal-specific one) — kept for the Rnd sequence.
export function generateAsteroid(galaxy: Galaxy, sun: Habitat, type: HabitatType): Habitat {
    const rnd = galaxy.rnd;
    const num = rnd.next(20, 35);
    const num2 = HABITAT_IMAGE_OFFSET_ASTEROIDS_NORMAL + rnd.next(0, HABITAT_IMAGE_COUNT_ASTEROIDS_NORMAL);
    rnd.next(9500, 11500);
    switch (type) {
        case HabitatType.Ice:
            rnd.next(17200, 22200);
            break;
        case HabitatType.Metal:
            rnd.next(10500, 11500);
            break;
    }
    const orbitangle = rnd.nextDouble() * Math.PI * 2.0;
    const name = galaxy.generateCodeName();
    // C# argument evaluation order: Rnd.Next(10500, 11500) then Rnd.Next(2, 8).
    const orbitDistance = rnd.next(10500, 11500);
    let habitat = new Habitat(HabitatCategoryType.Asteroid, type, name, sun, orbitangle, true, orbitDistance, rnd.next(2, 8));
    habitat.diameter = num;
    habitat.pictureRef = num2;
    habitat.landscapePictureRef = -1;
    let minimumResourceCount = 0;
    if (type === HabitatType.Metal && rnd.next(0, 3) > 0) {
        minimumResourceCount = 1;
    }
    habitat = galaxy.selectResources(habitat, minimumResourceCount);
    habitat.type = type;
    galaxy.selectHabitatPictures(habitat);
    return habitat;
}

// Port of Galaxy.7.cs FindNearestHabitatUnoccupiedSystem(x, y, type) (1800):
// first habitat of `type` (C# Systems[i].Habitats order, star excluded) in the
// nearest system without a dominant empire. No Rnd.
export function findNearestHabitatUnoccupiedSystem(galaxy: Galaxy, x: number, y: number, type: HabitatType): Habitat | null {
    const systemInfoDistanceList = galaxy.generateDistanceOrderedSystemList(x, y);
    for (let i = 0; i < systemInfoDistanceList.length; i++) {
        const dom = systemInfoDistanceList[i].dominantEmpire;
        if (dom !== undefined && dom !== null && dom.empire !== null) {
            continue;
        }
        const habitats = galaxy.systemHabitatsOf(systemInfoDistanceList[i].systemStar.systemIndex);
        for (let j = 0; j < habitats.length; j++) {
            if (habitats[j].type === type) {
                return habitats[j];
            }
        }
    }
    return null;
}

// Port of Start.2.cs 1156-1173. Rnd: [Next(1,4) if the policy has no
// ResearchIndustryFocus] + Next(10,31) — only when a qualifying gas giant is found.
export function applyResearchBonusGasGiant(galaxy: Galaxy, empire: Empire): void {
    const capital = empire.capital!;
    const habitat6 = findNearestHabitatUnoccupiedSystem(galaxy, capital.xpos, capital.ypos, HabitatType.GasGiant);
    if (habitat6 !== null && habitat6.researchBonus <= 0 && habitat6.researchBonusIndustry === IndustryType.Undefined) {
        let industryType = IndustryType.Undefined;
        if (empire.policy !== null) {
            industryType = empire.policy.researchIndustryFocus;
        }
        if (industryType === IndustryType.Undefined) {
            industryType = galaxy.rnd.next(1, 4) as IndustryType;
        }
        habitat6.researchBonusIndustry = industryType;
        habitat6.researchBonus = galaxy.rnd.next(10, 31) & 0xff; // C#: (byte)
        galaxy.systems[habitat6.systemIndex].hasResearchBonus = true;
    }
}

// Port of ResourcePrevalence (ResourcePrevalence.cs) as read by
// ResourceSystem.cs LoadFromFile 571-587: Type 0/1/2 -> planet-moon/asteroid/gas cloud,
// SubType -> Galaxy.ResolveHabitatTypeByIndexIncludeGasClouds.
export interface ResourcePrevalenceView {
    habitatIsAsteroid: boolean;
    habitatIsGasCloud: boolean;
    habitatType: HabitatType;
}

function prevalenceView(galaxy: Galaxy, dist: Resource['distributions'][number]): ResourcePrevalenceView {
    return {
        habitatIsAsteroid: dist.type === 1,
        habitatIsGasCloud: dist.type === 2,
        habitatType: galaxy['resolveHabitatTypeByIndexIncludeGasClouds'](dist.subType),
    };
}

// Port of ResourceDefinition.cs GetMostTerrestrialResourcePrevalance() (55).
export function getMostTerrestrialResourcePrevalance(galaxy: Galaxy, resource: Resource): ResourcePrevalenceView | null {
    let resourcePrevalance: ResourcePrevalenceView | null = null;
    if (resource.distributions !== null) {
        for (let index = 0; index < resource.distributions.length; ++index) {
            const dist = resource.distributions[index];
            if (dist !== null) {
                const resourcePrevalence = prevalenceView(galaxy, dist);
                if (resourcePrevalance === null) {
                    resourcePrevalance = resourcePrevalence;
                } else if (resourcePrevalance.habitatIsGasCloud && !resourcePrevalence.habitatIsGasCloud) {
                    resourcePrevalance = resourcePrevalence;
                } else if (resourcePrevalance.habitatIsAsteroid && !resourcePrevalence.habitatIsAsteroid && !resourcePrevalence.habitatIsGasCloud) {
                    resourcePrevalance = resourcePrevalence;
                }
            }
        }
    }
    return resourcePrevalance;
}

// Port of Start.2.cs 1174-1273: at tech level 0, for every IsImportantPreWarpResource
// strategic resource (in StrategicResourcesOrderedByRelativeImportance order),
// make sure a habitat of its most-terrestrial type exists in the capital's
// system (generating one when the nearest such habitat is elsewhere and the
// type is not a gas cloud), then set that habitat's abundance.
// Rnd per resource: [Generate* draws] + Next(150,300) [+ Next(400,1000) if fuel].
export function ensureImportantPreWarpResources(galaxy: Galaxy, empire: Empire, techLevel: number): void {
    if (techLevel !== 0.0) {
        return;
    }
    const capital = empire.capital!;
    const ordered = galaxy.resourceSystem.strategicResourcesOrderedByRelativeImportance;
    for (let num30 = 0; num30 < ordered.length; num30++) {
        const resourceDefinition = ordered[num30];
        if (resourceDefinition === null || !resourceDefinition.isImportantPreWarpResource) {
            continue;
        }
        const mostTerrestrialResourcePrevalance = getMostTerrestrialResourcePrevalance(galaxy, resourceDefinition);
        if (mostTerrestrialResourcePrevalance === null) {
            continue;
        }
        // C# FindNearestHabitat(double, double, HabitatType) -> (…, null) (Galaxy.7.cs 2327/2332).
        let habitat7 = galaxy.findNearestHabitatOfType(capital.xpos, capital.ypos, mostTerrestrialResourcePrevalance.habitatType);
        if (habitat7 === null) {
            continue;
        }
        const habitat8 = galaxy.determineHabitatSystemStar(habitat7);
        const habitat9 = galaxy.determineHabitatSystemStar(capital);
        if (habitat8 !== habitat9 && !mostTerrestrialResourcePrevalance.habitatIsGasCloud) {
            if (mostTerrestrialResourcePrevalance.habitatIsAsteroid) {
                habitat7 = generateAsteroid(galaxy, habitat9, mostTerrestrialResourcePrevalance.habitatType);
            } else {
                switch (mostTerrestrialResourcePrevalance.habitatType) {
                    case HabitatType.Volcanic:
                        habitat7 = generateVolcanicPlanet(galaxy, habitat9);
                        break;
                    case HabitatType.Desert:
                        habitat7 = generateDesertPlanet(galaxy, habitat9);
                        break;
                    case HabitatType.MarshySwamp:
                        habitat7 = generateSwampPlanet(galaxy, habitat9);
                        break;
                    case HabitatType.Continental:
                        habitat7 = galaxy.generateContinentalPlanet(habitat9);
                        break;
                    case HabitatType.Ocean:
                        habitat7 = generateOceanPlanet(galaxy, habitat9);
                        break;
                    case HabitatType.BarrenRock:
                        habitat7 = generateBarrenRockPlanet(galaxy, habitat9);
                        break;
                    case HabitatType.Ice:
                        habitat7 = generateIcePlanet(galaxy, habitat9);
                        break;
                    case HabitatType.GasGiant:
                        habitat7 = generateGasGiantPlanet(galaxy, habitat9);
                        break;
                    case HabitatType.FrozenGasGiant:
                        habitat7 = generateFrozenGasGiantPlanet(galaxy, habitat9);
                        break;
                    // C# has no default: for any other type habitat7 stays the
                    // distant habitat and is re-added below (source quirk, kept).
                }
            }
            if (habitat7 !== null) {
                // C# Monitor.Enter(galaxy._LockObject) around AddHabitat — no-op here.
                galaxy.addHabitat(habitat7, habitat9);
                // TODO(port): Galaxy.AddHabitat's HabitatIndex-grid insert, FixResourceMaps and
                // SetSystemHabitatExploration (Galaxy.9.cs 3234-3243) are not done by galaxy.ts addHabitat.
                // C# re-checks `TechLevel == 0.0` here (always true inside this block).
                if (techLevel === 0.0) {
                    empire.resourceMap.setResourcesKnown(habitat7, false);
                }
            }
        }
        if (habitat7 !== null) {
            let num31 = galaxy.rnd.next(150, 300);
            if (resourceDefinition.isFuel) {
                num31 = galaxy.rnd.next(400, 1000);
            }
            // C# HabitatResourceList.IndexOf(resourceID, 0).
            const num32 = habitat7.resources.findIndex((r) => r.resourceId === resourceDefinition.resourceId);
            if (num32 < 0) {
                habitat7.resources.push({ resourceId: resourceDefinition.resourceId, abundance: num31 });
            } else {
                habitat7.resources[num32].abundance = num31; // C#: (short)num31, always in range
            }
        }
    }
}
