// Pirate factions at game start (task C2d). Ports of
//   Galaxy.8.cs GeneratePirateEmpire (4471/4491/4496), SelectRandomPiratePlaystyle
//   (4291), SelectRandomPirateRace (3722), SelectRandomAggressiveRace (3741),
//   SelectRandomRace (3703), SetPirateFactionModifiers (4396, via BaconEmpire)
//   Galaxy.9.cs GenerateNewPirateEmpires (20), GeneratePirateEmpireName (738)
//   Galaxy.8.cs FindNearestPirateFaction (2872), Galaxy.7.cs
//   FastFindNearestIndependentHabitat (1944), Galaxy.cs SetEmpireDifficultyFactors
//   (1417, via BaconGalaxy 129), Empire.1.cs PirateReviewColoniesToControl (3103).
// GenerateNewPirateEmpires runs from Galaxy.DoTasks' long-interval block; the
// game-start pirates come from the first DoTasks tick in Start.2.cs, which is
// past the Rnd-parity point (Empire.DoTasks is unported). createGame calls it
// once in place of that tick.
// Task M3e: the pirate base + fleet block (Galaxy.8.cs 4623-4823), CreatePirateMiningStations
// (Galaxy.8.cs 776) and the super-pirate event + faction (Galaxy.cs 3297/3313, Galaxy.8.cs 3984).
// Starting characters: Empire.GenerateStartingCharacters(base) (Galaxy.8.cs 4822, characters.ts).
// Not ported: flags (flag shapes use a clock-seeded Random — no galaxy Rnd).
// Task M3f: the super-pirate design pipeline (Galaxy.8.cs 3760-3982, 4121-4254; Empire.10.cs
// GenerateDesignFromSpec 3387 in designGeneration.ts).
//
// Rnd of the base block per pirate faction (exact C# order, Galaxy.8.cs 4626-4820):
//   base:        GeneratePirateBaseName — Next(0,13), Next(0,20), [Next(0,4) unless the base
//                habitat is a gas cloud; on 1: Next(0,20)]; SelectRandomHeading — NextDouble.
//                AddBuiltObjectToGalaxy with explicit offsets draws nothing. Cargo: no Rnd.
//   per escort (num7: Balanced 2, Pirate 3, Mercenary 4, Smuggler 1; halved when
//                StartingAge != 0): Next(0,3) (num13 — drawn even though both branches pick the
//                same design); if an Escort design exists: SelectRandomUniqueMilitaryShipName()
//                (habitat null) — Next(0,76), Next(0,162), Next(0,5); heading NextDouble;
//                AddBuiltObjectToGalaxy(offsetLocationFromParent) — NextDouble (radius),
//                NextDouble (angle).
//   per explorer (num8: 2, Mercenary 1; halved when StartingAge != 0) and the construction ship
//                (1): SelectRandomUniqueStandardShipName(habitat) — Next(0,127), Next(0,125),
//                Next(0,7) [+ Next(0,3) when < 2 and the star name qualifies]; heading; 2 offset.
//   per small freighter (num9: 2, Pirate/Mercenary 1, Smuggler 4), mining ship and gas mining
//                ship (num12: 1, Mercenary 0), resupply ship (num11: 1 at StartingAge 0, needs a
//                ResupplyShip design): SelectUniqueBuiltObjectName → the standard-name draws as
//                above; heading; 2 offset.
//   CreatePirateMiningStations (count: 2, Mercenary 1, Smuggler 3): per CreateMiningStation that
//                reaches a design, SelectRelativeHabitatSurfacePoint (NextDouble, NextDouble) and,
//                when placed, a heading NextDouble.
//   GenerateStartingCharacters(base) (Galaxy.8.cs 4822): characters.ts (its own Rnd draws).
// Only designs the faction can build are used (FindNewestCanBuild); a missing design skips that
// group and its draws (the escort Next(0,3) is still drawn).
import { difficultyScalingForPlayer, type VictoryConditionProgress } from './victory';
import type { Galaxy } from './galaxy';
import { generateStartingCharacters } from './characters';
import { HabitatCategoryType, type Habitat, type SystemInfo } from './types';
import type { Race } from './data/races';
import { Empire } from './empire';
import { netSort } from './netSort';
import { addComponentsToDesign, componentDefinitionsStatic, createNewDesigns, findNewestCanBuild, generateDesignFromSpec, type NullableComponentList } from './designGeneration';
import { BuiltObjectStance, Design, findNewest } from './design';
import { csInt } from './builtObjectComponent';
import { evaluateLatestByCategory, evaluateLatestByType } from './componentStatic';
import { ComponentType } from './data/components';
import { ComponentCategoryType } from './data/policies';
import { BuiltObject } from './builtObject';
import { Cargo, ResourceRef } from './cargo';
import { ResourceGroup, resourceGroupOf } from './resourceSystem';
import { checkEmpireHasHyperDriveTech } from './forceStructure';
import { checkEmpireTerritoryCanBuildAtHabitat, habitatPrioritizationIndexOf, identifyResourceCentres } from './resourceTargets';
import { startStarDateForAge } from './galaxyTime';
import { loadEmpirePolicy } from './researchSystem';
import { SystemVisibilityStatus } from './visibility';
import { BuiltObjectSubRole } from './builtObjectTypes';
import { BattleTactics, BuiltObjectFleeWhen, BuiltObjectRole, InvasionTactics, buildDefaultDesignSpecifications, getDefaultDesignSpecificationBySubRole } from './data/designSpecifications';
import { countResourceSourcesForEmpire } from './stationPlacement';
import { scenarioQuery } from './scenario/hooks';

// Port of PiratePlayStyle.cs (member order exact).
export enum PiratePlayStyle {
    Undefined,
    Balanced,
    Pirate,
    Mercenary,
    Smuggler,
}

// Race.cs "PirateDefaultPlaystyle": file value + 1, kept only if Enum.IsDefined.
export function raceDefaultPiratePlaystyle(race: Race): PiratePlayStyle {
    const raw = race.extra?.['PirateDefaultPlaystyle'];
    if (raw === undefined) return PiratePlayStyle.Undefined;
    const b = ((Number.parseInt(raw, 10) || 0) + 1) & 0xff;
    return b <= PiratePlayStyle.Smuggler ? (b as PiratePlayStyle) : PiratePlayStyle.Undefined;
}

// Galaxy.8.cs SelectRandomPiratePlaystyle.
export function selectRandomPiratePlaystyle(galaxy: Galaxy): PiratePlayStyle {
    switch (galaxy.rnd.next(0, 4)) {
        case 0: return PiratePlayStyle.Balanced;
        case 1: return PiratePlayStyle.Pirate;
        case 2: return PiratePlayStyle.Mercenary;
        case 3: return PiratePlayStyle.Smuggler;
        default: return PiratePlayStyle.Balanced;
    }
}

function pickRace(galaxy: Galaxy, pred: (r: Race) => boolean): Race | null {
    const list = galaxy.races.filter(pred);
    return list.length > 0 ? list[galaxy.rnd.next(0, list.length)] : null;
}
// Galaxy.8.cs SelectRandomPirateRace / SelectRandomAggressiveRace / SelectRandomRace.
export const selectRandomPirateRace = (g: Galaxy) => pickRace(g, (r) => r.canBePirate);
export const selectRandomAggressiveRace = (g: Galaxy, threshold: number) => pickRace(g, (r) => r.aggression >= threshold && r.playable);
export const selectRandomRace = (g: Galaxy, threshold: number) => pickRace(g, (r) => r.intelligence >= threshold && r.playable);

// Galaxy.8.cs SetPirateFactionModifiers table (order: smugglingIncome, raidStrength,
// raidBonus, shipMaintenancePrivate, shipMaintenanceState, researchWeapons,
// researchEnergy, researchHighTech, planetaryFacilityElimination, looting,
// planetaryFacilityBuild, planetaryWonderBuild).
export interface PirateFactionModifiers {
    smugglingIncomeFactor: number;
    raidStrengthFactor: number;
    raidBonusFactor: number;
    shipMaintenancePrivateFactor: number;
    shipMaintenanceStateFactor: number;
    researchWeaponsFactor: number;
    researchEnergyFactor: number;
    researchHighTechFactor: number;
    planetaryFacilityEliminationFactor: number;
    lootingFactor: number;
    planetaryFacilityBuildFactor: number;
    planetaryWonderBuildFactor: number;
}
const MODIFIER_ROWS: Partial<Record<PiratePlayStyle, number[]>> = {
    [PiratePlayStyle.Balanced]: [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
    [PiratePlayStyle.Pirate]: [0.7, 1.25, 1.4, 1.1, 1.1, 1.2, 1.0, 0.8, 0.8, 1.0, 1.5, 1.5],
    [PiratePlayStyle.Mercenary]: [0.75, 1.25, 0.75, 1.25, 0.75, 1.1, 1.1, 0.8, 1.33, 1.33, 0.75, 1.25],
    [PiratePlayStyle.Smuggler]: [1.5, 0.75, 0.75, 0.75, 1.25, 0.8, 1.1, 1.1, 1.7, 0.75, 1.0, 0.75],
};
export function pirateFactionModifiers(style: PiratePlayStyle): PirateFactionModifiers {
    const r = MODIFIER_ROWS[style] ?? Array<number>(12).fill(1.0);
    return {
        smugglingIncomeFactor: r[0],
        raidStrengthFactor: r[1],
        raidBonusFactor: r[2],
        shipMaintenancePrivateFactor: r[3],
        shipMaintenanceStateFactor: r[4],
        researchWeaponsFactor: r[5],
        researchEnergyFactor: r[6],
        researchHighTechFactor: r[7],
        planetaryFacilityEliminationFactor: r[8],
        lootingFactor: r[9],
        planetaryFacilityBuildFactor: r[10],
        planetaryWonderBuildFactor: r[11],
    };
}

// Galaxy.cs 1417 SetEmpireDifficultyFactors(empire, conditionProgresses) (victory scaling: victory.ts) + BaconGalaxy.SetEmpireDifficultyFactors. All *Default constants are 1.0
// (Galaxy.3.cs 5129-5137).
export function setEmpireDifficultyFactors(galaxy: Galaxy, empire: Empire, galaxyDifficultyLevel: number, conditionProgresses: VictoryConditionProgress[] | null = null): void {
    if (empire === galaxy.playerEmpire) {
        empire.difficultyLevel = galaxyDifficultyLevel + empire.difficultyLevelModifier;
        // Galaxy.cs 1423-1442 DifficultyLevelScalesAsPlayerApproachesVictory (victory.ts, M4z4).
        difficultyScalingForPlayer(galaxy, empire, galaxyDifficultyLevel, conditionProgresses);
    } else {
        empire.difficultyLevel = 1.0 + (1.0 - Math.sqrt(galaxyDifficultyLevel));
        empire.difficultyLevel += empire.difficultyLevelModifier;
    }
    const d = empire.difficultyLevel;
    const romulan = empire.name.includes('Romulan');
    empire.difficultyFactors = {
        colonyCorruptionFactor: 1.0 * d,
        researchRate: 1.0 / d,
        populationGrowthRate: 1.0 / d,
        miningRate: romulan ? (1.0 / d) * 5.0 : 1.0 / d,
        targettingFactor: romulan ? Math.min(1.0, 1.0 / Math.sqrt(d)) : 1.0 / Math.sqrt(d),
        countermeasuresFactor: romulan ? Math.min(1.0, 1.0 / Math.sqrt(d)) : 1.0 / Math.sqrt(d),
        colonyShipBuildSpeedRate: 1.0 / d,
        warWearinessFactor: 1.0 * d,
        colonyIncomeFactor: romulan ? (1.0 / d) * 2.0 : 1.0 / d,
    };
    // BaconGalaxy.cs 137-138 / 150-151: Empire.TargettingFactor / CountermeasuresFactor (read by weapons.ts / fighters.ts).
    empire.targettingFactor = empire.difficultyFactors.targettingFactor;
    empire.countermeasuresFactor = empire.difficultyFactors.countermeasuresFactor;
}

const NAME_ADJ_DEFAULT = ["Bloody", "Dread", "Black", "Dirty", "Evil", "Iron", "Red", "Fierce", "Cruel", "Sinister", "Vicious", "Lone", "Savage", "Fearsome", "Deadly", "Venomous", "Murderous", "Dark", "Grim", "Haunted", "Menacing"];
const NAME_NOUN_DEFAULT = ["Sun", "Star", "Rock", "Moon", "Storm", "Fang", "Claw", "Dagger"];
const NAME_GROUP_DEFAULT = ["Pirates", "Marauders", "Bandits", "Raiders", "Buccaneers", "Outlaws", "Corsairs", "Pillagers", "Gangsters", "Ravagers", "Prowlers", "Intruders", "Invaders", "Skyjackers", "Gang", "Mercenaries"];
const NAME_BY_STYLE: Partial<Record<PiratePlayStyle, { adj?: string[]; noun?: string[]; group?: string[] }>> = {
    [PiratePlayStyle.Balanced]: { adj: ["Black", "Iron", "Red", "Fierce", "Sinister", "Lone", "Savage", "Fearsome", "Venomous", "Dark", "Grim", "Menacing", "Dread"], group: ["Council", "Network", "League", "Force", "Clan", "Authority", "Confederacy", "Confederation", "Security"] },
    [PiratePlayStyle.Mercenary]: { adj: ["Bloody", "Black", "Dirty", "Evil", "Iron", "Red", "Fierce", "Cruel", "Sinister", "Vicious", "Lone", "Savage", "Fearsome", "Deadly", "Venomous", "Murderous", "Dark", "Grim", "Haunted", "Menacing", "Dread", "Blood", "Burning", "Hidden"], group: ["Pirates", "Marauders", "Bandits", "Raiders", "Buccaneers", "Outlaws", "Corsairs", "Pillagers", "Gangsters", "Ravagers", "Prowlers", "Intruders", "Invaders", "Skyjackers", "Gang", "Mercenaries", "Warriors", "Army"] },
    [PiratePlayStyle.Pirate]: { adj: ["Bloody", "Black", "Dirty", "Evil", "Iron", "Red", "Fierce", "Cruel", "Sinister", "Vicious", "Lone", "Savage", "Fearsome", "Deadly", "Venomous", "Murderous", "Dark", "Grim", "Haunted", "Menacing", "Dread", "Burning", "Fire", "Lost"], group: ["Pirates", "Marauders", "Bandits", "Raiders", "Buccaneers", "Outlaws", "Corsairs", "Pillagers", "Gangsters", "Ravagers", "Prowlers", "Intruders", "Invaders", "Skyjackers", "Gang", "Horde"] },
    [PiratePlayStyle.Smuggler]: { adj: ["Black", "Iron", "Red", "Fierce", "Sinister", "Lone", "Savage", "Fearsome", "Hidden", "Dark", "Grim", "Menacing", "Dread"], noun: ["Sun", "Star", "Rock", "Moon", "Storm", "Fang", "Claw", "Market", "Trade", "Merchant"], group: ["Corporation", "Consortium", "Syndicate", "Cartel", "Guild", "Gang", "Company", "Interstellar", "Shipping", "Spaceways", "Freightways", "Industries", "Mining", "Transport", "Exports", "Ventures", "Starfreight", "Minerals", "Salvage"] },
};

// Galaxy.9.cs GeneratePirateEmpireName: 4 Rnd draws (adj, noun, group, form).
export function generatePirateEmpireName(galaxy: Galaxy, habitat: Habitat, style: PiratePlayStyle): string {
    const t = NAME_BY_STYLE[style] ?? {};
    const adj = t.adj ?? NAME_ADJ_DEFAULT;
    const noun = t.noun ?? NAME_NOUN_DEFAULT;
    const group = t.group ?? NAME_GROUP_DEFAULT;
    const text = adj[galaxy.rnd.next(0, adj.length)];
    const text2 = noun[galaxy.rnd.next(0, noun.length)];
    const text3 = group[galaxy.rnd.next(0, group.length)];
    switch (galaxy.rnd.next(0, 3)) {
        case 0: return `${text} ${text3}`;
        case 1: return `${text} ${text2} ${text3}`;
        case 2: {
            const h2 = galaxy.findNearestColony(habitat.xpos, habitat.ypos, null, true);
            const star = galaxy.determineHabitatSystemStar(h2!);
            return `${star.name} ${text3}`;
        }
    }
    return '';
}

// Galaxy.7.cs FastFindNearestIndependentHabitat over Galaxy.IndependentColonies.
export function fastFindNearestIndependentHabitat(galaxy: Galaxy, independentColonies: Habitat[], x: number, y: number): Habitat | null {
    let num = Number.MAX_VALUE;
    let result: Habitat | null = null;
    for (const h of independentColonies) {
        const d = galaxy.calculateDistanceSquared(x, y, h.xpos, h.ypos);
        if (d < num) {
            result = h;
            num = d;
        }
    }
    return result;
}

// Galaxy.8.cs FindNearestPirateFaction(x, y, pirateFactionToExclude, includeSuperPirates)
// (2872): nearest active pirate faction (by base habitat) that owns a base BuiltObject
// (GenericBase or Small/Medium/LargeSpacePort). No Rnd.
// generatePirateEmpire now builds the SmallSpacePort base, so factions qualify (spacing rule
// of GenerateNewPirateEmpires applies).
export function findNearestPirateFaction(galaxy: Galaxy, x: number, y: number, pirateFactionToExclude: Empire | null, includeSuperPirates: boolean): Empire | null {
    let num = Number.MAX_VALUE;
    let result: Empire | null = null;
    for (let i = 0; i < galaxy.pirateEmpires.length; i++) {
        const empire = galaxy.pirateEmpires[i];
        if (empire == null || empire.pirateEmpireBaseHabitat === null || empire.builtObjects == null || !empire.active || (pirateFactionToExclude !== null && empire === pirateFactionToExclude) || (!includeSuperPirates && empire.pirateEmpireSuperPirates)) {
            continue;
        }
        const num2 = galaxy.calculateDistanceSquared(x, y, empire.pirateEmpireBaseHabitat.xpos, empire.pirateEmpireBaseHabitat.ypos);
        if (!(num2 < num)) {
            continue;
        }
        let flag = false;
        for (let j = 0; j < empire.builtObjects.length; j++) {
            const builtObject = empire.builtObjects[j];
            if (builtObject != null && (builtObject.subRole === BuiltObjectSubRole.GenericBase || builtObject.subRole === BuiltObjectSubRole.SmallSpacePort || builtObject.subRole === BuiltObjectSubRole.MediumSpacePort || builtObject.subRole === BuiltObjectSubRole.LargeSpacePort)) {
                flag = true;
                break;
            }
        }
        if (flag) {
            result = empire;
            num = num2;
        }
    }
    return result;
}

// Empire.1.cs 3103 PirateReviewColoniesToControl + 3143 PirateCheckControlColony (no Rnd). PirateColonyControl and
// Habitat.CurrentDefensiveForceAssigned wired in by M4s2.
export function pirateReviewColoniesToControl(galaxy: Galaxy, empire: Empire, independentColonies: Habitat[]): { habitat: Habitat; priority: number }[] {
    const toControl: { habitat: Habitat; priority: number }[] = [];
    const controlled: Habitat[] = [];
    for (let i = 0; i < empire.colonies.length; i++) {
        const h = empire.colonies[i];
        if (h != null && !h.hasBeenDestroyed && h.empire === empire && !controlled.includes(h)) controlled.push(h);
    }
    const base = empire.pirateEmpireBaseHabitat;
    if (base !== null) {
        const check = (colony: Habitat | null) => {
            if (colony == null || colony.hasBeenDestroyed || colony.population == null || colony.population.totalAmount <= 0 || (colony.empire !== null && colony.empire.reclusive)) return;
            const byFaction = colony.pirateColonyControl.getByFaction(empire);
            if (colony.empire === empire || byFaction !== null) {
                if (!controlled.includes(colony)) controlled.push(colony);
                return;
            }
            if (!empire.visibility.checkSystemExplored(colony.systemIndex)) return;
            let flag = false;
            let num = 0.0;
            if (colony.empire === galaxy.independentEmpire) flag = true;
            else if (colony.empire !== null && colony.population != null && colony.population.totalAmount < 2000000000) {
                num = colony.currentDefensiveForceAssigned;
                flag = true;
            }
            if (!flag) return;
            const num2 = galaxy.calculateDistance(base.xpos, base.ypos, colony.xpos, colony.ypos);
            let num3 = galaxy.sizeX * 0.25;
            if (empire.piratePlayStyle === PiratePlayStyle.Balanced) num3 *= 1.4;
            if (num2 < num3) {
                let num4 = Math.sqrt(num3 - num2) * (colony.population.totalAmount / 1000.0);
                if (num > 0.0) num4 /= Math.sqrt(num);
                num4 = Math.min(num4, 2147483647.0);
                toControl.push({ habitat: colony, priority: Math.trunc(num4) });
            }
        };
        for (let j = 0; j < independentColonies.length; j++) check(independentColonies[j]);
        for (let k = 0; k < galaxy.empires.length; k++) {
            const e = galaxy.empires[k];
            if (e != null && e.active && e.colonies != null) for (let l = 0; l < e.colonies.length; l++) check(e.colonies[l]);
        }
        netSort(toControl, (a, b) => (a.priority < b.priority ? -1 : a.priority > b.priority ? 1 : 0));
        toControl.reverse();
        empire.colonies = controlled;
    }
    return toControl;
}

// C# float literals 0.4f / 0.25f / 0.1f (compared against float RelativeImportance).
const F_0_4 = Math.fround(0.4);
const F_0_25 = Math.fround(0.25);
const F_0_1 = Math.fround(0.1);
const F_0_5 = 0.5; // (double)RelativeImportance > 0.5 (double literal)

// ResourceDefinition.RelativeImportance (C# float) for a resource id.
function relativeImportanceOf(galaxy: Galaxy, resourceId: number): number {
    return galaxy.resourceSystem.relativeImportance.get(resourceId) ?? 0;
}

// Empire.LatestDesigns.FindNewestCanBuild(subRole, empire) (DesignList.cs 156/160).
// LatestDesigns is indexed by sub-role and holds nulls, which DesignList skips
// (FindNewestCanBuildFullEvaluate: `design3 != null`); its Count is always > 0.
// Dropping the nulls keeps both lookups identical (latestDesigns[subRole] is null
// whenever the filtered list is empty).
export function latestDesignsFindNewestCanBuild(empire: Empire, subRole: BuiltObjectSubRole): Design | null {
    const latest = empire.latestDesigns.filter((d): d is Design => d !== null);
    return findNewestCanBuild(latest, subRole, empire);
}

// Galaxy.9.cs GeneratePirateBaseName(habitat) (713). Rnd: Next(0,13), Next(0,20); when the
// habitat is not a gas cloud, Next(0,4), and when that is 1, one more Next(0,20).
export function generatePirateBaseName(galaxy: Galaxy, habitat: Habitat | null): string {
    const array = ['Secret', 'Eagles', 'Villainous', 'Brigands', 'Outlaws', 'Fugitives', 'Desperado', 'Secluded', 'Bounty Hunters', 'Lonely', 'Gamblers', 'Bandits', 'Smugglers'];
    const array2 = ['Lair', 'Base', 'Hideout', 'Retreat', 'Fortress', 'Cave', 'Cove', 'Outpost', 'Den', 'Haunt', 'Hideaway', 'Nest', 'Sanctuary', 'Refuge', 'Shelter', 'Haven', 'End', 'Rest', 'Station', 'Stronghold'];
    let num = galaxy.rnd.next(0, array.length);
    const text = array[num];
    num = galaxy.rnd.next(0, array2.length);
    const text2 = array2[num];
    let result = text + ' ' + text2;
    if (habitat !== null && habitat.category !== HabitatCategoryType.GasCloud && galaxy.rnd.next(0, 4) === 1) {
        const habitat2 = galaxy.determineHabitatSystemStar(habitat);
        result = habitat2.name + ' ' + array2[galaxy.rnd.next(0, array2.length)];
    }
    return result;
}

// The per-ship body shared verbatim by the escort / explorer / freighter / mining /
// construction / resupply loops of Galaxy.8.cs GeneratePirateEmpire (4704-4714 etc.) and the
// fleet loop of GenerateSuperPirateFaction (Galaxy.8.cs 4109-4117): construct, Empire,
// Heading = SelectRandomHeading() (NextDouble), ReDefine, fuel/shields, then
// AddBuiltObjectToGalaxy(…, offsetLocationFromParent: true, isStateOwned, sendMessage: false)
// with default offsets (NextDouble for the radius, NextDouble for the angle).
function addPirateStartingShip(galaxy: Galaxy, empire: Empire, design: Design, name: string, habitat: Habitat, isStateOwned: boolean): BuiltObject {
    const builtObject = new BuiltObject(design, name, galaxy, true);
    builtObject.empire = empire;
    builtObject.heading = galaxy.selectRandomHeading();
    builtObject.targetHeading = builtObject.heading;
    builtObject.reDefine();
    builtObject.currentFuel = builtObject.fuelCapacity;
    builtObject.currentShields = builtObject.shieldsCapacity;
    empire.addBuiltObjectToGalaxy(builtObject, habitat, true, isStateOwned, undefined, undefined, false);
    return builtObject;
}

// --- Pirate mining stations -------------------------------------------------------------
// Galaxy.8.cs CreatePirateMiningStations (776) and what it calls. CreateMiningStation is
// private to Galaxy.8.cs and shared with CreateMiningStations (the normal-empire start, being
// ported in stationPlacement.ts); it is ported here privately so this file does not depend on
// that lane.
// TODO(port): dedupe with stationPlacement.ts once it lands (same C# methods).
//
// resourceTargets.ts' DetermineMiningStationAtHabitat(ForEmpire) still read a stubbed, always
// empty BasesAtHabitat (its TODO); the local version below reads Habitat.basesAtHabitat, which
// Empire.AddBuiltObjectToGalaxy now fills.

// Galaxy.7.cs DetermineMiningStationAtHabitatForEmpire(habitat, empire) (340). No Rnd.
function determineMiningStationAtHabitatForEmpire(habitat: Habitat, empire: Empire): BuiltObject | null {
    for (const builtObject of habitat.basesAtHabitat) {
        if (builtObject == null || builtObject.empire !== empire) continue;
        switch (builtObject.subRole) {
            case BuiltObjectSubRole.GasMiningStation:
            case BuiltObjectSubRole.MiningStation:
                return builtObject;
            case BuiltObjectSubRole.SmallSpacePort:
            case BuiltObjectSubRole.MediumSpacePort:
            case BuiltObjectSubRole.LargeSpacePort:
                if (builtObject.extractionGas > 0 || builtObject.extractionMine > 0) return builtObject;
                break;
        }
    }
    return null;
}

// Galaxy.cs CheckSystemOwnership(systemStar, out disputed) (3583) → EmpireTerritory.cs
// CheckSystemOwnership (47); Empires.GetByEmpireId (normal empires only).
function checkSystemOwnership(galaxy: Galaxy, systemStar: Habitat | null): { empire: Empire | null; disputed: boolean } {
    let disputed = false;
    if (systemStar !== null) {
        let num: number;
        const sys = galaxy.systems[systemStar.systemIndex] as SystemInfo | undefined;
        if (sys === undefined || sys.dominantEmpire == null || sys.dominantEmpire.empire == null) {
            num = galaxy.empireTerritory.checkLocationOwnership(galaxy, systemStar.xpos, systemStar.ypos);
        } else {
            if (sys.otherEmpires != null && sys.otherEmpires.length > 0) disputed = true;
            num = sys.dominantEmpire.empire.empireId;
        }
        if (num >= 0) {
            return { empire: galaxy.empires.find((e) => e.empireId === num) ?? null, disputed };
        }
    }
    return { empire: null, disputed };
}

// Galaxy.7.cs 445 CountResourceSourcesForEmpire: the shared port in stationPlacement.ts (M4s2 reconciled the former
// private copy here, which skipped the construction-ship Build-mission branch, Galaxy.7.cs 487-503).
// Empire.6.cs CheckResourceSupplyMeetsExpected(resource, isCriticalEmpireResource,
// oversupplyFactor) (1540; the 2-arg overload 1535 passes 1.0). No Rnd.
function checkResourceSupplyMeetsExpectedBool(galaxy: Galaxy, empire: Empire, resourceId: number, isCriticalEmpireResource: boolean, oversupplyFactor = 1.0): boolean {
    const def = galaxy.resourceSystem.byId.get(resourceId)!;
    const ri = relativeImportanceOf(galaxy, resourceId);
    let num = 1;
    if (empire.pirateEmpireBaseHabitat === null) {
        let num2 = 3;
        let num3 = 3;
        let num4 = 2;
        if (!checkEmpireHasHyperDriveTech(empire)) {
            num2 = 2;
            num3 = 1;
            num4 = 1;
        }
        if (def.isFuel) {
            num = num2 + Math.trunc(empire.colonies.length / 2.0);
            num = Math.min(50, num);
        } else if (ri > F_0_5) {
            num = num3 + Math.trunc(empire.colonies.length / 3.0);
            num = Math.min(50, num);
        } else if (ri > 0.25) {
            num = num4 + Math.trunc(empire.colonies.length / 4.0);
            num = Math.min(50, num);
        } else {
            num = 1 + Math.trunc(empire.colonies.length / 6);
        }
        if (isCriticalEmpireResource) {
            num = Math.max(num, num4 + Math.trunc(empire.colonies.length / 3));
            num = Math.min(40, num);
        }
    } else if (def.isFuel) {
        num = 2 + Math.trunc(empire.spacePorts.length / 2.0);
        num = Math.min(50, num);
    } else if (ri > F_0_5) {
        num = 1 + Math.trunc(empire.spacePorts.length / 4.0);
        num = Math.min(50, num);
    } else {
        num = 1;
    }
    num = Math.trunc(num * oversupplyFactor);
    const num5 = countResourceSourcesForEmpire(empire, resourceId, true);
    if (num5 < num) {
        return false;
    }
    return true;
}

// Empire.6.cs IdentifyStrategicResourceSupplySource(resource) (1755). No Rnd.
function identifyStrategicResourceSupplySource(empire: Empire, resourceId: number): Habitat | null {
    let num = 0;
    let result: Habitat | null = null;
    for (let i = 0; i < empire.resourceTargets.length; i++) {
        const habitatPrioritization = empire.resourceTargets[i];
        if (habitatPrioritization != null && habitatPrioritization.habitat !== null && habitatPrioritization.habitat.resources != null) {
            const num2 = habitatPrioritization.habitat.resources.findIndex((r) => r.resourceId === resourceId);
            if (num2 >= 0 && habitatPrioritization.priority > num) {
                num = habitatPrioritization.priority;
                result = habitatPrioritization.habitat;
                break;
            }
        }
    }
    return result;
}

// Empire.5.cs CheckNearPirateBase(stellarObject, x, y, empireToExclude) (3450) →
// (stellarObject, scanRange, x, y, empireToExclude) (3456). No Rnd.
function checkNearPirateBase(galaxy: Galaxy, empire: Empire, stellarObject: Habitat | null, x: number, y: number, empireToExclude: Empire | null): boolean {
    const scanRange = Math.trunc(galaxy.maxSolarSystemSize * 2.1);
    void scanRange;
    void stellarObject;
    const empire2 = findNearestPirateFaction(galaxy, x, y, empireToExclude, true);
    if (empire2 !== null && empire2.pirateEmpireBaseHabitat !== null) {
        let builtObject: BuiltObject | null = null;
        const bases = empire2.pirateEmpireBaseHabitat.basesAtHabitat;
        if (bases != null && bases.length > 0) {
            for (let i = 0; i < bases.length; i++) {
                const builtObject2 = bases[i];
                if (builtObject2 != null && builtObject2.empire === empire2 && (builtObject2.subRole === BuiltObjectSubRole.SmallSpacePort || builtObject2.subRole === BuiltObjectSubRole.MediumSpacePort || builtObject2.subRole === BuiltObjectSubRole.LargeSpacePort)) {
                    builtObject = builtObject2;
                    break;
                }
            }
        }
        // TODO(port): Empire.KnownPirateBases (BuiltObjectList) is not modeled. It is filled
        // by the empire's own sightings (Empire.DoTasks / visibility reviews), so it is empty
        // for a faction that is being generated: KnownPirateBases.Contains(builtObject) is
        // false and C# returns false here.
        const knownPirateBasesContains = false;
        void empire;
        if (knownPirateBasesContains && builtObject !== null) {
            throw new Error('TODO(port): Empire.KnownPirateBases');
        }
    }
    return false;
}

// Empire.6.cs CheckResourceSupplyMeetsExpected(resource) (1602) →
// (resource, isCriticalEmpireResource: false, empireHabitatsBeingMined: null) (1607). No Rnd.
function checkResourceSupplyMeetsExpected(galaxy: Galaxy, empire: Empire, resourceId: number): Habitat | null {
    let habitat: Habitat | null = null;
    if (!checkResourceSupplyMeetsExpectedBool(galaxy, empire, resourceId, false)) {
        let num = 0;
        while (habitat === null && num < 50) {
            habitat = identifyStrategicResourceSupplySource(empire, resourceId);
            if (habitat === null) {
                break;
            }
            if (checkNearPirateBase(galaxy, empire, habitat, habitat.xpos, habitat.ypos, empire)) {
                const num2 = habitatPrioritizationIndexOf(empire.resourceTargets, habitat);
                if (num2 >= 0) empire.resourceTargets.splice(num2, 1);
                habitat = null;
            } else if (determineMiningStationAtHabitatForEmpire(habitat, empire) !== null) {
                // empireHabitatsBeingMined == null branch.
                const num3 = habitatPrioritizationIndexOf(empire.resourceTargets, habitat);
                if (num3 >= 0) empire.resourceTargets.splice(num3, 1);
                habitat = null;
            }
            num++;
        }
    }
    return habitat;
}

// Galaxy.cs ResolveRetrofitResourcesForBase(empire) (1634) +
// CalculateResourceLevelStockForBaseRetrofit (1647). No Rnd.
function resolveRetrofitResourcesForBase(galaxy: Galaxy, empire: Empire): Cargo[] {
    const cargoList: Cargo[] = [];
    const rs = galaxy.resourceSystem;
    for (let i = 0; i < rs.strategicResourcesOrderedByRelativeImportance.length; i++) {
        const resourceDefinition = rs.strategicResourcesOrderedByRelativeImportance[i];
        if (resourceDefinition != null) {
            const ri = relativeImportanceOf(galaxy, resourceDefinition.resourceId);
            const level = !resourceDefinition.isFuel ? (!(ri > F_0_25) ? 25 : 50) : 0;
            cargoList.push(new Cargo(new ResourceRef(resourceDefinition.resourceId), level, empire));
        }
    }
    return cargoList;
}

const habitatContainsGroup = (galaxy: Galaxy, habitat: Habitat, group: ResourceGroup): boolean =>
    // HabitatResourceList.ContainsGroup (241): HabitatResource.Group of each entry.
    habitat.resources.some((r) => r != null && resourceGroupOf(galaxy.resourceSystem.byId.get(r.resourceId)!) === group);

// Galaxy.8.cs CreateMiningStation(galaxy, habitat, empire, allowEmpiresToStartInSameSystem)
// (835). Rnd once a design is found: SelectRelativeHabitatSurfacePoint (NextDouble,
// NextDouble; drawn before the BasesAtHabitat check), then, when placed, SelectRandomHeading
// (NextDouble). The name
// (GenerateBuiltObjectName → "<habitat> Mining Station" / "<habitat> Gas Mining Station")
// and AddBuiltObjectToGalaxy (explicit offsets) draw nothing.
function createMiningStation(galaxy: Galaxy, habitat: Habitat | null, empire: Empire, allowEmpiresToStartInSameSystem: boolean): boolean {
    if (habitat !== null) {
        const systemStar = galaxy.determineHabitatSystemStar(habitat);
        const own = checkSystemOwnership(galaxy, systemStar);
        const empire2 = own.empire;
        const disputed = own.disputed;
        if ((allowEmpiresToStartInSameSystem || empire2 === null || empire2 === empire || disputed) && checkEmpireTerritoryCanBuildAtHabitat(galaxy, empire, habitat) && determineMiningStationAtHabitatForEmpire(habitat, empire) === null && habitat.empire === null) {
            let design: Design | null = null;
            // Designs.FindNewestCanBuild(subRole) (DesignList.cs 140): empire = Designs[0].Empire.
            const designsEmpire = empire.designs.length > 0 && empire.designs[0] != null ? (empire.designs[0].empire as Empire | null) : null;
            if (habitatContainsGroup(galaxy, habitat, ResourceGroup.Gas)) {
                design = findNewestCanBuild(empire.designs, BuiltObjectSubRole.GasMiningStation, designsEmpire);
            }
            if (habitatContainsGroup(galaxy, habitat, ResourceGroup.Mineral)) {
                design = findNewestCanBuild(empire.designs, BuiltObjectSubRole.MiningStation, designsEmpire);
            }
            if (design !== null) {
                const p = galaxy.selectRelativeHabitatSurfacePoint(habitat);
                const x = p.x;
                const y = p.y;
                let flag = false;
                if (habitat.basesAtHabitat != null && habitat.basesAtHabitat.length > 0) {
                    flag = true;
                }
                if (!flag) {
                    design.buildCount++;
                    const purchasePrice = design.calculateCurrentPurchasePrice(galaxy);
                    const name = galaxy.generateBuiltObjectName(design, habitat);
                    const builtObject = new BuiltObject(design, name, galaxy, true);
                    builtObject.purchasePrice = purchasePrice;
                    builtObject.parentHabitat = habitat;
                    builtObject.parentOffsetX = x;
                    builtObject.parentOffsetY = y;
                    builtObject.heading = galaxy.selectRandomHeading();
                    builtObject.targetHeading = builtObject.heading;
                    builtObject.reDefine();
                    builtObject.currentFuel = builtObject.fuelCapacity;
                    builtObject.currentShields = builtObject.shieldsCapacity;
                    builtObject.nearestSystemStar = galaxy.determineHabitatSystemStar(habitat);
                    empire.addBuiltObjectToGalaxy(builtObject, habitat, false, false, Math.trunc(builtObject.parentOffsetX), Math.trunc(builtObject.parentOffsetY));
                    if ((habitat === null || habitat.empire !== empire) && builtObject.cargo !== null) {
                        const cargoList = resolveRetrofitResourcesForBase(galaxy, empire);
                        for (let i = 0; i < cargoList.length; i++) {
                            builtObject.cargo.add(cargoList[i]);
                        }
                    }
                    return true;
                }
            }
        }
        const num = habitatPrioritizationIndexOf(empire.resourceTargets, habitat);
        if (num >= 0) {
            empire.resourceTargets.splice(num, 1);
        }
    }
    return false;
}

// Galaxy.7.cs ConditionCheckLimit(condition, maximumIterations, ref iterationCount) (569).
function conditionCheckLimit(condition: boolean, maximumIterations: number, iterationCount: { value: number }): boolean {
    if (iterationCount.value >= maximumIterations) return false;
    iterationCount.value++;
    return condition;
}

// Galaxy.8.cs CreatePirateMiningStations(galaxy, empire, count, allowEmpiresToStartInSameSystem)
// (776). Rnd: only through CreateMiningStation — per station attempt that reaches a design:
// SelectRelativeHabitatSurfacePoint (NextDouble radius, NextDouble heading), and when placed a
// further NextDouble (SelectRandomHeading).
export function createPirateMiningStations(galaxy: Galaxy, empire: Empire, count: number, allowEmpiresToStartInSameSystem: boolean): void {
    let num = 0;
    empire.resourceTargets = identifyResourceCentres(galaxy, empire);
    let num2 = 0;
    const ordered = galaxy.resourceSystem.strategicResourcesOrderedByRelativeImportance;
    for (let i = 0; i < ordered.length; i++) {
        const resourceDefinition = ordered[i];
        if (resourceDefinition != null) {
            num2 = 0;
            while (num < count && createMiningStation(galaxy, checkResourceSupplyMeetsExpected(galaxy, empire, resourceDefinition.resourceId), empire, allowEmpiresToStartInSameSystem) && num2 < 50) {
                num++;
                num2++;
            }
        }
    }
    const it = { value: 0 };
    while (conditionCheckLimit(empire.resourceTargets.length > 0 && num < count, 50, it)) {
        if (createMiningStation(galaxy, empire.resourceTargets[0].habitat, empire, allowEmpiresToStartInSameSystem)) {
            num++;
        }
    }
}

export interface PirateGenerationContext {
    independentColonies: Habitat[];
    /** Galaxy.StartingAge (the player's age setting). */
    startingAge: number;
    /** Galaxy.DifficultyLevel. */
    difficultyLevel: number;
}

// Galaxy.8.cs GeneratePirateEmpire(habitat, offsetX, offsetY, race, designPictureFamilyIndex,
// techLevel, piratePlaystyle, isPlayerEmpire, isSuperPirates), game-start slice.
export function generatePirateEmpire(
    galaxy: Galaxy,
    ctx: PirateGenerationContext,
    habitat: Habitat,
    offsetX: number,
    offsetY: number,
    race: Race,
    designPictureFamilyIndex: number,
    techLevel: number,
    piratePlaystyle: PiratePlayStyle,
    isPlayerEmpire: boolean,
    isSuperPirates: boolean,
): Empire {
    if (galaxy.empires.length > 0) galaxy.rnd.next(0, galaxy.empires.length);
    const empirePolicy = loadEmpirePolicy(galaxy.researchStatic, race, true);
    if (isPlayerEmpire) {
        // Galaxy.8.cs 4504-4513.
        empirePolicy.implementEnslavementWithPenalColonies = false;
        empirePolicy.acceptPirateSmugglingMissions = false;
        empirePolicy.bidOnPirateAttackMissions = false;
        empirePolicy.bidOnPirateDefendMissions = false;
        empirePolicy.offerSmugglingPirateMissions = 0;
        empirePolicy.offerDefensivePirateMissionsSituation = 0;
        empirePolicy.offerPirateAttackMissions = 0;
    }
    const name = generatePirateEmpireName(galaxy, habitat, piratePlaystyle);
    const empire = new Empire(galaxy, name, false, habitat, race, empirePolicy);
    empire.piratePlayStyle = piratePlaystyle;
    // StartingAge == 0 && CurrentStarDate - StartStarDate <= 120000: always true at game start.
    const flag = ctx.startingAge === 0;
    if (!flag && !isSuperPirates) empire.difficultyLevelModifier = 0.5;
    setEmpireDifficultyFactors(galaxy, empire, ctx.difficultyLevel);
    empire.pirateFactionModifiers = pirateFactionModifiers(empire.piratePlayStyle);
    empire.preWarpProgressEventsOccurred = true; // the 13 PreWarpProgressEventOccurred* flags
    const h2 = fastFindNearestIndependentHabitat(galaxy, ctx.independentColonies, habitat.xpos, habitat.ypos);
    if (h2 !== null && !empire.visibility.checkSystemExplored(h2.systemIndex)) {
        const star = galaxy.determineHabitatSystemStar(h2);
        empire.visibility.setSystemVisibility(star, SystemVisibilityStatus.Explored);
        const sys = galaxy.systems[star.systemIndex];
        empire.resourceMap.setResourcesKnown(sys.systemStar, true);
        for (const h of galaxy.systemHabitatsOf(star.systemIndex)) empire.resourceMap.setResourcesKnown(h, true);
    }
    galaxy.pirateEmpires.push(empire);
    empire.mainColor = 0x010101;
    empire.secondaryColor = 0xfefefe;
    if (!isSuperPirates) {
        empire.selectEmpireColors(true, (main, secondary) => {
            empire.mainColor = main;
            empire.secondaryColor = secondary;
        });
        // TODO(port): GenerateEmpireFlag(FlagShapesPirates…) — clock-seeded Random, no galaxy Rnd.
    }
    empire.policy = empirePolicy;
    if (designPictureFamilyIndex >= 0) empire.designPictureFamilyIndex = designPictureFamilyIndex;
    if (techLevel !== 0.5) empire.research.setTechTreeLevel(galaxy.rnd, race, techLevel, true);
    else empire.research.setTechTreeStartingDefaultsPirates(race, empire.policy);
    empire.research.update(race);
    empire.reviewResearchAbilities();
    empire.reviewDesignsBuiltObjectsImprovedComponents();
    empire.pirateEmpireBaseHabitat = habitat;
    empire.generateDesignSpecifications(galaxy, empire.dominantRace, true, empire.dominantRace?.name ?? null);
    // Galaxy.8.cs 4622: empire.CreateNewDesigns(CurrentStarDate).
    const starDate = startStarDateForAge(galaxy.age);
    createNewDesigns(galaxy, empire, starDate, starDate);
    if (!isSuperPirates) {
        // Galaxy.8.cs 4623-4823: pirate base, fleet and mining stations (Rnd: see the header).
        let builtObject: BuiltObject | null = null;
        const design = latestDesignsFindNewestCanBuild(empire, BuiltObjectSubRole.SmallSpacePort);
        if (design !== null) {
            const name2 = generatePirateBaseName(galaxy, habitat);
            design.buildCount++;
            builtObject = new BuiltObject(design, name2, galaxy, true);
            builtObject.empire = empire;
            builtObject.heading = galaxy.selectRandomHeading();
            builtObject.targetHeading = builtObject.heading;
            builtObject.supportCostFactor = 0;
            builtObject.reDefine();
            builtObject.currentFuel = builtObject.fuelCapacity;
            builtObject.currentShields = builtObject.shieldsCapacity;
            empire.addBuiltObjectToGalaxy(builtObject, habitat, false, true, offsetX, offsetY, false);
            // Galaxy.8.cs 4640-4653: starting stock by RelativeImportance.
            const num2 = 6000;
            const num3 = 4000;
            const num4 = 2000;
            const num5 = 800;
            const rs = galaxy.resourceSystem;
            for (let j = 0; j < rs.strategicResourcesOrderedByRelativeImportance.length; j++) {
                const resourceDefinition = rs.strategicResourcesOrderedByRelativeImportance[j];
                if (resourceDefinition != null) {
                    // ResourceDefinition.RelativeImportance is a C# float; the literals are floats.
                    const ri = relativeImportanceOf(galaxy, resourceDefinition.resourceId);
                    let num6 = num2;
                    num6 = ri > F_0_4 || resourceDefinition.isFuel ? num2 : ri > F_0_25 ? num3 : !(ri > F_0_1) ? num5 : num4;
                    // C# derefs Cargo (non-null for a space port after ReDefine).
                    builtObject.cargo!.add(new Cargo(new ResourceRef(resourceDefinition.resourceId), num6, empire));
                }
            }
            // Galaxy.8.cs 4654-4687: fleet sizes by play style.
            let num7 = 2;
            let num8 = 2;
            let num9 = 2;
            const num10 = 1;
            let num11 = 1;
            let num12 = 1;
            let count = 2;
            switch (empire.piratePlayStyle) {
                case PiratePlayStyle.Pirate:
                    num7 = 3;
                    num9 = 1;
                    num12 = 1;
                    break;
                case PiratePlayStyle.Mercenary:
                    num7 = 4;
                    num8 = 1;
                    num9 = 1;
                    num12 = 0;
                    count = 1;
                    break;
                case PiratePlayStyle.Smuggler:
                    num7 = 1;
                    num9 = 4;
                    num12 = 1;
                    count = 3;
                    break;
            }
            if (!flag) {
                num7 = Math.trunc(num7 / 2);
                num8 = Math.trunc(num8 / 2);
                num11 = 0;
            }
            // Escorts, state (4688-4717). Both branches pick the newest Escort; C# still draws
            // Rnd.Next(0, 3) every iteration (num13 only steers the equivalent branches).
            let num13 = 1;
            for (let k = 0; k < num7; k++) {
                let design2: Design | null = null;
                if (num13 === 1) {
                    if (design2 === null) {
                        design2 = latestDesignsFindNewestCanBuild(empire, BuiltObjectSubRole.Escort);
                    }
                } else {
                    design2 = latestDesignsFindNewestCanBuild(empire, BuiltObjectSubRole.Escort);
                }
                num13 = galaxy.rnd.next(0, 3);
                if (design2 !== null) {
                    design2.buildCount++;
                    const name3 = galaxy.selectRandomUniqueMilitaryShipName(null, empire, design2.subRole);
                    addPirateStartingShip(galaxy, empire, design2, name3, habitat, true);
                }
            }
            // Explorers, state (4718-4734).
            const design3 = latestDesignsFindNewestCanBuild(empire, BuiltObjectSubRole.ExplorationShip);
            if (design3 !== null) {
                for (let l = 0; l < num8; l++) {
                    design3.buildCount++;
                    const name4 = galaxy.selectRandomUniqueStandardShipName(habitat, empire, design3.subRole);
                    addPirateStartingShip(galaxy, empire, design3, name4, habitat, true);
                }
            }
            // Small freighters, private (4735-4751).
            const design4 = latestDesignsFindNewestCanBuild(empire, BuiltObjectSubRole.SmallFreighter);
            if (design4 !== null) {
                for (let m = 0; m < num9; m++) {
                    design4.buildCount++;
                    const name5 = galaxy.selectUniqueBuiltObjectName(design4, habitat);
                    addPirateStartingShip(galaxy, empire, design4, name5, habitat, false);
                }
            }
            // Mining ships, private (4752-4768).
            const design5 = latestDesignsFindNewestCanBuild(empire, BuiltObjectSubRole.MiningShip);
            if (design5 !== null) {
                for (let n = 0; n < num12; n++) {
                    design5.buildCount++;
                    const name6 = galaxy.selectUniqueBuiltObjectName(design5, habitat);
                    addPirateStartingShip(galaxy, empire, design5, name6, habitat, false);
                }
            }
            // Gas mining ships, private (4769-4785).
            const design6 = latestDesignsFindNewestCanBuild(empire, BuiltObjectSubRole.GasMiningShip);
            if (design6 !== null) {
                for (let num14 = 0; num14 < num12; num14++) {
                    design6.buildCount++;
                    const name7 = galaxy.selectUniqueBuiltObjectName(design6, habitat);
                    addPirateStartingShip(galaxy, empire, design6, name7, habitat, false);
                }
            }
            // Construction ship, state (4786-4802).
            const design7 = latestDesignsFindNewestCanBuild(empire, BuiltObjectSubRole.ConstructionShip);
            if (design7 !== null) {
                for (let num15 = 0; num15 < num10; num15++) {
                    design7.buildCount++;
                    const name8 = galaxy.selectRandomUniqueStandardShipName(habitat, empire, design7.subRole);
                    addPirateStartingShip(galaxy, empire, design7, name8, habitat, true);
                }
            }
            // Resupply ship, state (4803-4819): Designs.FindNewest (not LatestDesigns); C# names
            // it with SelectUniqueBuiltObjectName(design4 — the freighter design, sic).
            const design8 = findNewest(empire.designs, BuiltObjectSubRole.ResupplyShip);
            if (design8 !== null) {
                for (let num16 = 0; num16 < num11; num16++) {
                    design8.buildCount++;
                    // C# throws (GetCustomName derefs design.Empire) when design4 is null.
                    if (design4 === null) throw new Error('GeneratePirateEmpire: SelectUniqueBuiltObjectName(null design)');
                    const name9 = galaxy.selectUniqueBuiltObjectName(design4, habitat);
                    addPirateStartingShip(galaxy, empire, design8, name9, habitat, true);
                }
            }
            createPirateMiningStations(galaxy, empire, count, false);
        }
        // Galaxy.8.cs 4822: empire.GenerateStartingCharacters(builtObject) (Empire.6.cs 4309).
        generateStartingCharacters(galaxy, empire, builtObject);
    }
    empire.colonizationTargets = pirateReviewColoniesToControl(galaxy, empire, ctx.independentColonies);
    empire.stateMoney = 20000.0;
    return empire;
}

// Galaxy.8.cs GeneratePirateEmpire(habitat, offsetX, offsetY, useRace).
export function generatePirateEmpireRandom(galaxy: Galaxy, ctx: PirateGenerationContext, habitat: Habitat, offsetX: number, offsetY: number, useRace: boolean): Empire {
    let race: Race | null = null;
    let style = selectRandomPiratePlaystyle(galaxy);
    if (useRace) {
        race = selectRandomPirateRace(galaxy);
        if (race === null) race = selectRandomAggressiveRace(galaxy, 115);
        if (race === null) race = selectRandomRace(galaxy, 0);
        style = raceDefaultPiratePlaystyle(race!);
    }
    // C# passes a null race through when !useRace; every caller here uses useRace = true.
    return generatePirateEmpire(galaxy, ctx, habitat, offsetX, offsetY, race!, -1, 0.5, style, false, false);
}

export interface PirateSettings {
    /** Galaxy.PiratePrevalence (wizard; 0 = no pirates). */
    piratePrevalence: number;
    /** Galaxy.MaximumEmpireAmount. */
    maximumEmpireAmount: number;
    /** Galaxy.PirateProximity: 0 near, 1 medium, 2 far. */
    pirateProximity: number;
}

// Galaxy.9.cs GenerateNewPirateEmpires (run at game start and from the galaxy tick's long block).
export function generateNewPirateEmpires(galaxy: Galaxy, ctx: PirateGenerationContext, settings: PirateSettings): void {
    const stockCount = Math.trunc(2.0 * settings.piratePrevalence * settings.maximumEmpireAmount);
    // Scenario hook (hooks.ts pirateFactionCount): pure, no-op without a scenario — 19h rimPirateFactionCap.
    let num = scenarioQuery(galaxy, 'pirateFactionCount', stockCount, {});
    // Galaxy.9.cs 23-30: with DestroyedPiratesDoNotRespawn, once more than 300000 ms of the game have passed
    // (CurrentStarDate - _StartStarDate, which is galaxy.nowMs: simTime.ts galaxyStarDate) the target is the current
    // faction count, so destroyed factions are not replaced.
    if (galaxy.destroyedPiratesDoNotRespawn) {
        const num2 = galaxy.nowMs;
        if (num2 > 300000) num = galaxy.pirateEmpires.length;
    }
    if (galaxy.pirateEmpires.length >= num) return;
    let num3 = num - galaxy.pirateEmpires.length;
    let num4 = galaxy.maxSolarSystemSize * 2.1;
    let num5 = galaxy.sizeX / 50.0;
    switch (settings.pirateProximity) {
        case 0:
            num4 *= 1.0;
            num5 *= 1.0;
            break;
        case 1:
            num4 *= 4.0;
            num5 *= 4.0;
            break;
        case 2:
            num4 *= 8.0;
            num5 *= 8.0;
            break;
    }
    const num6 = Math.trunc(galaxy.starCount * 0.7);
    const colonyCount = galaxy.empires.reduce((s, e) => s + e.colonies.length, 0);
    let val = (num6 - colonyCount) / num6;
    val = Math.max(val, 0.1);
    num3 = Math.trunc(num3 * val);
    const fuel = galaxy.resourceSystem.fuelResources[0];
    for (let i = 0; i < num3; i++) {
        let flag = false;
        let habitat: Habitat | null = null;
        let num7 = 0;
        // 19h rim-frontier: a stock-accepted candidate the mod layer rejects (inside a rim herd's home range, or off
        // its rim/core creation-order share) is skipped and the C#'s own loop re-rolls; the first stock-accepted
        // candidate the share rule alone rejected is kept as a fallback for a tiny galaxy with nothing on the wanted side.
        let fallback: Habitat | null = null;
        while (!flag && num7 < 100) {
            const p = galaxy.obtainRandomGalaxyCoordinates();
            habitat = galaxy.findNearestHabitatWithResource(p.x, p.y, fuel.resourceId);
            if (habitat !== null) {
                for (const h2 of ctx.independentColonies) {
                    if (h2.empire === galaxy.independentEmpire && h2.systemIndex === habitat.systemIndex) {
                        habitat = null;
                        break;
                    }
                }
            }
            if (habitat !== null) {
                // Galaxy.9.cs 83: FindNearestBuiltObject((int)X, (int)Y, BuiltObjectRole.Undefined,
                // includeIndependentBuiltObjects: false).
                const builtObject = galaxy.findNearestBuiltObject(Math.trunc(habitat.xpos), Math.trunc(habitat.ypos), BuiltObjectRole.Undefined, false);
                let num8 = Number.MAX_VALUE;
                if (builtObject !== null) {
                    num8 = galaxy.calculateDistance(habitat.xpos, habitat.ypos, builtObject.xpos, builtObject.ypos);
                }
                if (num8 > num4) {
                    const h3 = galaxy.findNearestColony(habitat.xpos, habitat.ypos, null, false);
                    let num9 = Number.MAX_VALUE;
                    if (h3 !== null) num9 = galaxy.calculateDistance(habitat.xpos, habitat.ypos, h3.xpos, h3.ypos);
                    if (num9 > num5) {
                        let flag2 = false;
                        const e = findNearestPirateFaction(galaxy, habitat.xpos, habitat.ypos, null, true);
                        if (e !== null && e.pirateEmpireBaseHabitat !== null) {
                            if (galaxy.calculateDistance(habitat.xpos, habitat.ypos, e.pirateEmpireBaseHabitat.xpos, e.pirateEmpireBaseHabitat.ypos) < 1000000.0) flag2 = true;
                        }
                        if (!flag2 && galaxy.scenario !== null && scenarioQuery(galaxy, 'placementAvoidsHerds', false, { x: habitat.xpos, y: habitat.ypos })) flag2 = true;
                        if (!flag2) {
                            const accept = galaxy.scenario === null || scenarioQuery(galaxy, 'acceptPirateBase', true, { habitat });
                            if (accept) flag = true;
                            else fallback ??= habitat;
                        }
                    }
                }
            }
            num7++;
        }
        if (!flag && fallback !== null) {
            console.warn('rimFrontier: pirate base placement found no candidate on its assigned rim/core side; falling back to the stock placement.');
            habitat = fallback;
            flag = true;
        }
        if (flag && galaxy.nextEmpireId < galaxy.maximumEmpireCount) {
            const pt = galaxy.selectRelativeHabitatSurfacePoint(habitat);
            generatePirateEmpireRandom(galaxy, ctx, habitat!, Math.trunc(pt.x), Math.trunc(pt.y), true);
        }
    }
}

// --- Super pirates ("Phantom" factions) ---------------------------------------------------
//
// Trigger (Galaxy.cs): Galaxy.DoTasks → huge-interval block (timeSpan2 >= HugeProcessingSpan,
// Galaxy.cs 3081-3090) → DoGalaxyEvents (3297) → GalaxyEventSuperPirates (3313) →
// Galaxy.8.cs GenerateSuperPirateFaction (3984). At game start Start.2.cs 1108 calls
// galaxy.ResetLastTouchTimes() (all touch times = DateTime.MinValue) right before the first
// galaxy.DoTasks (1109), so BOTH the huge block (ProcessPirateFleets, ReviewEmpireTerritory,
// SelectPopularDesignCandidates, DoGalaxyEvents, CleanupInvalidShipsInIndexes, ReseedRandom)
// and then the long block (… GenerateNewPirateEmpires …) run on that tick. Hence createGame
// should call doGalaxyEventsSuperPirates BEFORE generateNewPirateEmpires, with
// gameDisasterEventsEnabled = VictoryConditions.EnableDisasterEvents (Start.2.cs 503) and
// piratePrevalence = Galaxy.PiratePrevalence.
// Note: the huge block ends with ReseedRandom() (Galaxy.cs 3088: new Random((int)DateTime.Now
// .Ticks)), so in C# everything after DoGalaxyEvents on that tick — GenerateNewPirateEmpires
// included — runs on a clock-seeded Rnd. The TS port keeps the seeded stream (no reseed).
// At game start GalaxyEventSuperPirates additionally needs ColonyFillRatio > 0.2
// (normal-empire colonies / (Habitats.Count / 45)), so it rarely fires on small starts.

// Galaxy.cs ColonyFillRatio (1156) with ColonyCount (1167): colonies of Galaxy.Empires.
export function colonyFillRatio(galaxy: Galaxy): number {
    const num = Math.trunc(galaxy.habitats.length / 45);
    let colonyCount = 0;
    for (let i = 0; i < galaxy.empires.length; i++) colonyCount += galaxy.empires[i].colonies.length;
    return colonyCount / num;
}

export interface SuperPirateEventSettings {
    /** Galaxy.GameDisasterEventsEnabled (Start.2.cs 503: VictoryConditions.EnableDisasterEvents). */
    gameDisasterEventsEnabled: boolean;
    /** Galaxy._PiratePrevalence. */
    piratePrevalence: number;
}

// Galaxy.cs DoGalaxyEvents (3297). Rnd: Next(0, num) when enabled (num = 15, scaled by
// sqrt(1 + SuperPirateFactionsGenerated)); then GalaxyEventSuperPirates on a 1.
export function doGalaxyEventsSuperPirates(galaxy: Galaxy, ctx: PirateGenerationContext, settings: SuperPirateEventSettings): void {
    if (settings.gameDisasterEventsEnabled && settings.piratePrevalence > 0.0) {
        let num = 15;
        if (galaxy.superPirateFactionsGenerated > 0) {
            num = Math.trunc(num * Math.sqrt(1 + galaxy.superPirateFactionsGenerated));
        }
        if (galaxy.rnd.next(0, num) === 1) {
            galaxyEventSuperPirates(galaxy, ctx);
        }
    }
}

// Galaxy.7.cs FindNearestHabitatUnoccupiedSystemWithResourceNotVisibleToPlayer(x, y,
// resourceId) (1775). No Rnd.
export function findNearestHabitatUnoccupiedSystemWithResourceNotVisibleToPlayer(galaxy: Galaxy, x: number, y: number, resourceId: number): Habitat | null {
    const systemInfoDistanceList = galaxy.generateDistanceOrderedSystemList(x, y);
    for (let i = 0; i < systemInfoDistanceList.length; i++) {
        const sys = systemInfoDistanceList[i];
        if ((sys.dominantEmpire != null && sys.dominantEmpire.empire != null) || sys.systemStar == null) {
            continue;
        }
        const empire = checkSystemOwnership(galaxy, sys.systemStar).empire;
        // C# derefs PlayerEmpire (non-null: the caller already required it).
        if (empire !== null || galaxy.playerEmpire!.visibility.checkSystemVisible(sys.systemStar.systemIndex)) {
            continue;
        }
        const habitats = galaxy.systemHabitatsOf(sys.systemStar.systemIndex);
        for (let j = 0; j < habitats.length; j++) {
            if (habitats[j].resources != null && habitats[j].resources.findIndex((r) => r.resourceId === resourceId) >= 0) {
                return habitats[j];
            }
        }
    }
    return null;
}

// Galaxy.cs GalaxyEventSuperPirates (3313). Rnd: Next(0, 4) for the name once a location is
// found, then GenerateSuperPirateFaction.
export function galaxyEventSuperPirates(galaxy: Galaxy, ctx: PirateGenerationContext): void {
    if (galaxy.nextEmpireId >= galaxy.maximumEmpireCount || !(colonyFillRatio(galaxy) > 0.2) || galaxy.pirateEmpires == null) {
        return;
    }
    let empire: Empire | null = null;
    for (let i = 0; i < galaxy.pirateEmpires.length; i++) {
        const empire2 = galaxy.pirateEmpires[i];
        if (empire2.pirateEmpireSuperPirates) {
            empire = empire2;
            break;
        }
    }
    if (empire !== null) {
        return;
    }
    let habitat: Habitat | null = null;
    let num = 0.0;
    const player = galaxy.playerEmpire;
    if (player !== null && player.colonies != null && player.capital !== null) {
        for (let j = 0; j < player.colonies.length; j++) {
            const habitat2 = player.colonies[j];
            // Habitat.HasBeenDestroyed: not modeled (false during game setup).
            if (habitat2 != null) {
                const num2 = galaxy.calculateDistance(player.capital.xpos, player.capital.ypos, habitat2.xpos, habitat2.ypos);
                if (num2 > num) {
                    habitat = habitat2;
                    num = num2;
                }
            }
        }
    }
    if (habitat === null) {
        return;
    }
    const resourceDefinition = galaxy.resourceSystem.fuelResources[0];
    const habitat3 = findNearestHabitatUnoccupiedSystemWithResourceNotVisibleToPlayer(galaxy, habitat.xpos, habitat.ypos, resourceDefinition.resourceId);
    if (habitat3 !== null) {
        const array = ['Deadly Phantoms', 'Phantom Scourge', 'Dark Ghostriders', 'Dread Wraiths'];
        const num3 = galaxy.rnd.next(0, array.length);
        const name = array[num3];
        const techLevel = Math.min(7.0, 4 + Math.min(3, galaxy.superPirateFactionsGenerated));
        empire = generateSuperPirateFaction(galaxy, ctx, habitat3, name, null, techLevel);
        if (empire !== null) {
            galaxy.superPirateFactionsGenerated++;
        }
    }
}

// ShipImageHelper.cs ResolveSuperPirateShipImageIndex (96); SuperPiratesStartIndex = 64 (41).
export function resolveSuperPirateShipImageIndex(subRole: BuiltObjectSubRole): number {
    let num = 0;
    switch (subRole) {
        case BuiltObjectSubRole.Escort: num = 0; break;
        case BuiltObjectSubRole.Frigate: num = 1; break;
        case BuiltObjectSubRole.Destroyer: num = 2; break;
        case BuiltObjectSubRole.Cruiser: num = 3; break;
        case BuiltObjectSubRole.CapitalShip: num = 4; break;
        case BuiltObjectSubRole.Carrier: num = 5; break;
        case BuiltObjectSubRole.DefensiveBase: num = 6; break;
        case BuiltObjectSubRole.GenericBase: num = 7; break;
    }
    const superPiratesStartIndex = 64;
    return num + superPiratesStartIndex;
}

// Empire.10.cs DetermineOrbitalBaseLocation(colony, out offsetX, out offsetY) (1377).
// Rnd per attempt (≤ 100): NextDouble, Next(0, 2), NextDouble.
export function determineOrbitalBaseLocation(galaxy: Galaxy, colony: Habitat): { x: number; y: number } {
    let offsetX = 0.0;
    let offsetY = 0.0;
    let num = 400.0;
    if (colony.basesAtHabitat != null && colony.basesAtHabitat.length > 0 && colony.basesAtHabitat.length >= 3) {
        num /= Math.sqrt(colony.basesAtHabitat.length - 2);
    }
    let flag = true;
    let num2 = 0;
    while (flag && num2 < 100) {
        flag = false;
        let num3 = galaxy.rnd.nextDouble() * Math.PI;
        if (galaxy.rnd.next(0, 2) === 1) {
            num3 *= -1.0;
        }
        // (double)(colony.Diameter / 2): Habitat.Diameter is a C# short → integer division.
        const num4 = Math.trunc(colony.diameter / 2) + 150.0 + galaxy.rnd.nextDouble() * 100.0;
        offsetX = Math.cos(num3) * num4;
        offsetY = Math.sin(num3) * num4;
        for (let i = 0; i < colony.basesAtHabitat.length; i++) {
            const builtObject = colony.basesAtHabitat[i];
            const num5 = galaxy.calculateDistance(builtObject.xpos, builtObject.ypos, colony.xpos, colony.ypos);
            if (num5 > 150.0) {
                const num6 = galaxy.calculateDistance(builtObject.xpos, builtObject.ypos, colony.xpos + offsetX, colony.ypos + offsetY);
                if (num6 < num) {
                    flag = true;
                    break;
                }
            }
        }
        num2++;
    }
    return { x: offsetX, y: offsetY };
}

// --- Super-pirate design pipeline (Galaxy.8.cs 3760-3982, 4121-4254). No Rnd. ---

// Galaxy.8.cs GetSuperPirateBaseComponents(overpowerFactor, techLevel) (3760).
export function getSuperPirateBaseComponents(galaxy: Galaxy, overpowerFactor: number, techLevel: number): NullableComponentList {
    const defs = componentDefinitionsStatic(galaxy);
    const T = ComponentType;
    const C = ComponentCategoryType;
    const lt = (t: ComponentType) => evaluateLatestByType(defs, t, techLevel);
    const lc = (c: ComponentCategoryType) => evaluateLatestByCategory(defs, c, techLevel);
    const componentList: NullableComponentList = [];
    const num = csInt(30.0 * overpowerFactor);
    const num2 = csInt(18.0 * overpowerFactor);
    const num3 = csInt(18.0 * overpowerFactor);
    const num4 = csInt(12.0 * overpowerFactor);
    const num5 = csInt(10.0 * overpowerFactor);
    const num6 = csInt(5.0 * overpowerFactor);
    const num7 = csInt(6.0 * overpowerFactor);
    const num8 = csInt(4.0 * overpowerFactor);
    const num9 = csInt(4.0 * overpowerFactor);
    componentList.push(lt(T.ComputerCommandCenter));
    componentList.push(lt(T.ComputerCommandCenter));
    componentList.push(lt(T.DamageControl));
    componentList.push(lt(T.DamageControl));
    componentList.push(lt(T.DamageControl));
    componentList.push(lt(T.DamageControl));
    for (let i = 0; i < num7; i++) componentList.push(lt(T.Reactor));
    for (let j = 0; j < 20; j++) componentList.push(lt(T.StorageFuel));
    for (let k = 0; k < 30; k++) componentList.push(lt(T.StorageCargo));
    componentList.push(lt(T.ExtractorGasExtractor));
    componentList.push(lt(T.StorageDockingBay));
    componentList.push(lt(T.StorageDockingBay));
    componentList.push(lt(T.StorageDockingBay));
    componentList.push(lt(T.StorageDockingBay));
    componentList.push(lt(T.StorageDockingBay));
    componentList.push(lt(T.StorageDockingBay));
    componentList.push(lt(T.EnergyCollector));
    componentList.push(lt(T.EnergyCollector));
    componentList.push(lt(T.EnergyCollector));
    componentList.push(lt(T.EnergyCollector));
    componentList.push(lt(T.EnergyCollector));
    componentList.push(lt(T.EnergyCollector));
    componentList.push(lt(T.EnergyCollector));
    componentList.push(lt(T.EnergyCollector));
    componentList.push(lt(T.ComputerCommerceCenter));
    componentList.push(lt(T.HabitationMedicalCenter));
    componentList.push(lt(T.HabitationRecreationCenter));
    componentList.push(lt(T.SensorProximityArray));
    componentList.push(lt(T.ComputerTargetting));
    componentList.push(lt(T.ComputerCountermeasures));
    componentList.push(lt(T.SensorLongRange));
    componentList.push(lt(T.ConstructionBuild));
    componentList.push(lt(T.ConstructionBuild));
    componentList.push(lt(T.WeaponIonCannon));
    componentList.push(lt(T.WeaponIonCannon));
    for (let l = 0; l < num; l++) componentList.push(lt(T.Armor));
    for (let m = 0; m < num2; m++) componentList.push(lc(C.Shields));
    for (let n = 0; n < num3; n++) componentList.push(lc(C.WeaponBeam));
    for (let num10 = 0; num10 < num5; num10++) componentList.push(lc(C.WeaponPointDefense));
    for (let num11 = 0; num11 < num4; num11++) componentList.push(lc(C.WeaponTorpedo));
    for (let num12 = 0; num12 < num8; num12++) componentList.push(lt(T.WeaponTractorBeam));
    for (let num13 = 0; num13 < num9; num13++) componentList.push(lc(C.AssaultPod));
    for (let num14 = 0; num14 < num6; num14++) componentList.push(lt(T.FighterBay));
    componentList.push(lt(T.WeaponAreaDestruction));
    componentList.push(lt(T.WeaponIonDefense));
    return componentList;
}

// Galaxy.8.cs GetSuperPirateDefensiveBaseComponents(overpowerFactor, techLevel) (3853).
export function getSuperPirateDefensiveBaseComponents(galaxy: Galaxy, overpowerFactor: number, techLevel: number): NullableComponentList {
    const defs = componentDefinitionsStatic(galaxy);
    const T = ComponentType;
    const C = ComponentCategoryType;
    const lt = (t: ComponentType) => evaluateLatestByType(defs, t, techLevel);
    const lc = (c: ComponentCategoryType) => evaluateLatestByCategory(defs, c, techLevel);
    const componentList: NullableComponentList = [];
    const num = csInt(15.0 * overpowerFactor);
    const num2 = csInt(12.0 * overpowerFactor);
    const num3 = csInt(12.0 * overpowerFactor);
    const num4 = csInt(8.0 * overpowerFactor);
    const num5 = csInt(8.0 * overpowerFactor);
    const num6 = csInt(2.0 * overpowerFactor);
    const num7 = csInt(3.0 * overpowerFactor);
    const num8 = csInt(2.0 * overpowerFactor);
    const num9 = csInt(2.0 * overpowerFactor);
    componentList.push(lt(T.ComputerCommandCenter));
    componentList.push(lt(T.DamageControl));
    componentList.push(lt(T.DamageControl));
    for (let i = 0; i < num7; i++) componentList.push(lt(T.Reactor));
    for (let j = 0; j < 10; j++) componentList.push(lt(T.StorageFuel));
    for (let k = 0; k < 15; k++) componentList.push(lt(T.StorageCargo));
    componentList.push(lt(T.ExtractorGasExtractor));
    componentList.push(lt(T.StorageDockingBay));
    componentList.push(lt(T.StorageDockingBay));
    componentList.push(lt(T.StorageDockingBay));
    componentList.push(lt(T.EnergyCollector));
    componentList.push(lt(T.EnergyCollector));
    componentList.push(lt(T.EnergyCollector));
    componentList.push(lt(T.EnergyCollector));
    componentList.push(lt(T.EnergyCollector));
    componentList.push(lt(T.EnergyCollector));
    componentList.push(lt(T.ComputerCommerceCenter));
    componentList.push(lt(T.SensorProximityArray));
    componentList.push(lt(T.ConstructionBuild));
    componentList.push(lt(T.ComputerTargetting));
    componentList.push(lt(T.ComputerCountermeasures));
    for (let l = 0; l < num; l++) componentList.push(lt(T.Armor));
    for (let m = 0; m < num2; m++) componentList.push(lc(C.Shields));
    for (let n = 0; n < num3; n++) componentList.push(lc(C.WeaponBeam));
    for (let num10 = 0; num10 < num5; num10++) componentList.push(lc(C.WeaponPointDefense));
    for (let num11 = 0; num11 < num4; num11++) componentList.push(lc(C.WeaponTorpedo));
    for (let num12 = 0; num12 < num8; num12++) componentList.push(lt(T.WeaponTractorBeam));
    for (let num13 = 0; num13 < num9; num13++) componentList.push(lc(C.AssaultPod));
    for (let num14 = 0; num14 < num6; num14++) componentList.push(lt(T.FighterBay));
    componentList.push(lt(T.WeaponIonCannon));
    componentList.push(lt(T.WeaponIonDefense));
    return componentList;
}

// Galaxy.8.cs GenerateSuperPirateBaseDesign(overpowerFactor, techLevel) (3942; the 1-arg
// overload at 3937 passes overpowerFactor 1.0). `currentStarDate` = Galaxy.CurrentStarDate.
export function generateSuperPirateBaseDesign(galaxy: Galaxy, overpowerFactor: number, techLevel: number, currentStarDate: number): Design {
    const superPirateBaseComponents = getSuperPirateBaseComponents(galaxy, overpowerFactor, techLevel);
    const text = 'Phantom Pirate Base'; // TextResolver.GetText (GameText.txt 3722)
    let design = new Design(text);
    design.role = BuiltObjectRole.Base;
    design.subRole = BuiltObjectSubRole.GenericBase;
    design = addComponentsToDesign(galaxy, design, superPirateBaseComponents, null);
    design.stance = BuiltObjectStance.AttackEnemies;
    design.fleeWhen = BuiltObjectFleeWhen.Never;
    design.tacticsStrongerShips = BattleTactics.PointBlank;
    design.tacticsWeakerShips = BattleTactics.PointBlank;
    design.tacticsInvasion = InvasionTactics.DoNotInvade;
    design.name = text;
    design.dateCreated = currentStarDate;
    design.empire = null;
    design.pictureRef = resolveSuperPirateShipImageIndex(BuiltObjectSubRole.GenericBase);
    design.reDefine();
    return design;
}

// Galaxy.8.cs GenerateSuperPirateDefensiveBaseDesign(overpowerFactor, techLevel) (3968; the
// 1-arg overload at 3963 passes overpowerFactor 1.0).
export function generateSuperPirateDefensiveBaseDesign(galaxy: Galaxy, overpowerFactor: number, techLevel: number, currentStarDate: number): Design {
    const superPirateDefensiveBaseComponents = getSuperPirateDefensiveBaseComponents(galaxy, overpowerFactor, techLevel);
    const text = 'Phantom Pirate Defensive Base'; // TextResolver.GetText (GameText.txt 3723)
    let design = new Design(text);
    design.role = BuiltObjectRole.Base;
    design.subRole = BuiltObjectSubRole.DefensiveBase;
    design = addComponentsToDesign(galaxy, design, superPirateDefensiveBaseComponents, null);
    design.stance = BuiltObjectStance.AttackEnemies;
    design.fleeWhen = BuiltObjectFleeWhen.Never;
    design.tacticsStrongerShips = BattleTactics.PointBlank;
    design.tacticsWeakerShips = BattleTactics.PointBlank;
    design.tacticsInvasion = InvasionTactics.DoNotInvade;
    design.name = text;
    design.dateCreated = currentStarDate;
    design.empire = null;
    design.pictureRef = resolveSuperPirateShipImageIndex(BuiltObjectSubRole.DefensiveBase);
    design.reDefine();
    return design;
}

// ComponentList.CountByCategory (189) / CountByType (167) / GetFirstByCategory (103) /
// GetFirstByType (93): loose Component.Category / Type equality.
const countByCategory = (d: Design, c: ComponentCategoryType) => d.components.filter((x) => x.category === c).length;
const countByType = (d: Design, t: ComponentType) => d.components.filter((x) => x.type === t).length;
const getFirstByCategory = (d: Design, c: ComponentCategoryType) => d.components.find((x) => x.category === c) ?? null;
const getFirstByType = (d: Design, t: ComponentType) => d.components.find((x) => x.type === t) ?? null;

// Galaxy.8.cs UpgradeMilitaryShipDesignMoreWeapons(design) (4121). No ReDefine: C# leaves the
// design's derived stats stale (ships built from it ReDefine from the component list).
// `new Component(first.ComponentID)` is the shared ComponentDefinition reference in the TS.
export function upgradeMilitaryShipDesignMoreWeapons(design: Design | null): Design | null {
    if (design !== null) {
        const num = countByCategory(design, ComponentCategoryType.WeaponBeam);
        const num2 = countByCategory(design, ComponentCategoryType.WeaponTorpedo);
        const num3 = countByCategory(design, ComponentCategoryType.WeaponPointDefense);
        let num4 = 3;
        let num5 = 0;
        let num6 = 0;
        switch (design.subRole) {
            case BuiltObjectSubRole.Escort: num4 = 3; num5 = 0; num6 = 0; break;
            case BuiltObjectSubRole.Frigate: num4 = 5; num5 = 0; num6 = 1; break;
            case BuiltObjectSubRole.Destroyer: num4 = 6; num5 = 1; num6 = 2; break;
            case BuiltObjectSubRole.Cruiser: num4 = 10; num5 = 4; num6 = 4; break;
            case BuiltObjectSubRole.CapitalShip: num4 = 16; num5 = 8; num6 = 8; break;
            case BuiltObjectSubRole.Carrier: num4 = 4; num5 = 0; num6 = 4; break;
            case BuiltObjectSubRole.TroopTransport: num4 = 2; num5 = 0; num6 = 1; break;
        }
        if (num < num4) {
            const firstByCategory = getFirstByCategory(design, ComponentCategoryType.WeaponBeam);
            if (firstByCategory !== null) {
                for (let i = 0; i < num4 - num; i++) design.components.push(firstByCategory);
            }
        }
        if (num2 < num5) {
            const firstByCategory2 = getFirstByCategory(design, ComponentCategoryType.WeaponTorpedo);
            if (firstByCategory2 !== null) {
                for (let j = 0; j < num5 - num2; j++) design.components.push(firstByCategory2);
            }
        }
        if (num3 < num6) {
            const firstByCategory3 = getFirstByCategory(design, ComponentCategoryType.WeaponPointDefense);
            if (firstByCategory3 !== null) {
                for (let k = 0; k < num6 - num3; k++) design.components.push(firstByCategory3);
            }
        }
    }
    return design;
}

// Galaxy.8.cs UpgradeMilitaryShipDesignMoreEngines(design) (4206): at most one extra main
// thrust and one extra vectoring engine. No ReDefine (see above).
export function upgradeMilitaryShipDesignMoreEngines(design: Design | null): Design | null {
    if (design !== null) {
        const num = countByType(design, ComponentType.EngineMainThrust);
        const num2 = countByType(design, ComponentType.EngineVectoring);
        let num3 = 5;
        let num4 = 2;
        switch (design.subRole) {
            case BuiltObjectSubRole.Escort: num3 = 5; num4 = 2; break;
            case BuiltObjectSubRole.Frigate: num3 = 7; num4 = 2; break;
            case BuiltObjectSubRole.Destroyer: num3 = 7; num4 = 2; break;
            case BuiltObjectSubRole.Cruiser: num3 = 10; num4 = 3; break;
            case BuiltObjectSubRole.CapitalShip: num3 = 12; num4 = 4; break;
            case BuiltObjectSubRole.Carrier: num3 = 10; num4 = 3; break;
            case BuiltObjectSubRole.TroopTransport: num3 = 6; num4 = 2; break;
        }
        if (num < num3) {
            const firstByType = getFirstByType(design, ComponentType.EngineMainThrust);
            if (firstByType !== null) design.components.push(firstByType);
        }
        if (num2 < num4) {
            const firstByType2 = getFirstByType(design, ComponentType.EngineVectoring);
            if (firstByType2 !== null) design.components.push(firstByType2);
        }
    }
    return design;
}

// Galaxy.DesignSpecifications (static, Galaxy.3.cs 4960-5721).
let galaxyDesignSpecifications: ReturnType<typeof buildDefaultDesignSpecifications> | null = null;
function galaxyDesignSpecificationBySubRole(subRole: BuiltObjectSubRole) {
    if (galaxyDesignSpecifications === null) galaxyDesignSpecifications = buildDefaultDesignSpecifications();
    return getDefaultDesignSpecificationBySubRole(galaxyDesignSpecifications, subRole);
}

// C# NullReferenceException stand-in: GenerateSuperPirateFaction dereferences each design.
function requireDesign(design: Design | null, what: string): Design {
    if (design === null) throw new Error(`GenerateSuperPirateFaction: ${what} design is null (C# NullReferenceException)`);
    return design;
}

// Galaxy.8.cs GenerateSuperPirateFaction(habitat, name, race, techLevel) (3984).
// Rnd: [GeneratePirateEmpireName: 4 draws when name is empty — the result is then unused:
// GeneratePirateEmpire names the empire itself], [race selection], SelectRelativeHabitatSurfacePoint
// (2), GeneratePirateEmpire(…, isSuperPirates: true) (no base block), then the design pipeline
// (six GenerateDesignFromSpec: SelectPreferredSuperWeapon's tie-break Next inside the CapitalShip
// placement for aggressive+intelligent races, and GenerateDesignName's draws — seed-1 test: one
// Next(0, 36) for the CapitalShip's new proper name; the base designs and upgrades draw nothing),
// the base (GeneratePirateBaseName + heading), 3 defensive bases (GenerateBuiltObjectName of a
// DefensiveBase draws one Next(0, 4) in SelectUniqueBuiltObjectName, heading, then
// DetermineOrbitalBaseLocation: NextDouble, Next(0, 2), NextDouble per attempt) and
// Rnd.Next(20, 30) warships (Next(0, 25) type, military name Next(0,76)/Next(0,162)/Next(0,5),
// heading, 2 AddBuiltObjectToGalaxy offset draws each).
export function generateSuperPirateFaction(galaxy: Galaxy, ctx: PirateGenerationContext, habitat: Habitat, name: string | null, race: Race | null, techLevel: number): Empire {
    if (name === null || name === '') {
        name = generatePirateEmpireName(galaxy, habitat, PiratePlayStyle.Pirate);
    }
    void name; // C# never uses it after this point.
    if (race === null) {
        race = selectRandomPirateRace(galaxy);
        if (race === null) race = selectRandomAggressiveRace(galaxy, 115);
        if (race === null) race = selectRandomRace(galaxy, 0);
    }
    const pt = galaxy.selectRelativeHabitatSurfacePoint(habitat);
    const empire = generatePirateEmpire(galaxy, ctx, habitat, Math.trunc(pt.x), Math.trunc(pt.y), race!, -1, techLevel, PiratePlayStyle.Pirate, false, true);
    empire.pirateEmpireSuperPirates = true;
    // Galaxy.8.cs 4005-4038. Galaxy.CurrentStarDate: the game-start value, as generatePirateEmpire
    // uses for CreateNewDesigns (the TS Galaxy does not track the current star date).
    const currentStarDate = startStarDateForAge(galaxy.age);
    let design = generateDesignFromSpec(galaxy, empire, galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.Escort), techLevel, currentStarDate);
    let design2 = generateDesignFromSpec(galaxy, empire, galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.Frigate), techLevel, currentStarDate);
    let design3 = generateDesignFromSpec(galaxy, empire, galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.Destroyer), techLevel, currentStarDate);
    let design4 = generateDesignFromSpec(galaxy, empire, galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.Cruiser), techLevel, currentStarDate);
    let design5 = generateDesignFromSpec(galaxy, empire, galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.CapitalShip), techLevel, currentStarDate);
    let design6 = generateDesignFromSpec(galaxy, empire, galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.Carrier), techLevel, currentStarDate);
    const design7 = generateSuperPirateDefensiveBaseDesign(galaxy, 1.0, techLevel, currentStarDate);
    const design8 = generateSuperPirateBaseDesign(galaxy, 1.0, techLevel, currentStarDate);
    design = upgradeMilitaryShipDesignMoreEngines(design);
    design2 = upgradeMilitaryShipDesignMoreEngines(design2);
    design3 = upgradeMilitaryShipDesignMoreEngines(design3);
    design4 = upgradeMilitaryShipDesignMoreEngines(design4);
    design5 = upgradeMilitaryShipDesignMoreEngines(design5);
    design6 = upgradeMilitaryShipDesignMoreEngines(design6);
    design = upgradeMilitaryShipDesignMoreWeapons(design);
    design2 = upgradeMilitaryShipDesignMoreWeapons(design2);
    design3 = upgradeMilitaryShipDesignMoreWeapons(design3);
    design4 = upgradeMilitaryShipDesignMoreWeapons(design4);
    design5 = upgradeMilitaryShipDesignMoreWeapons(design5);
    design6 = upgradeMilitaryShipDesignMoreWeapons(design6);
    requireDesign(design, 'Escort').pictureRef = resolveSuperPirateShipImageIndex(BuiltObjectSubRole.Escort);
    requireDesign(design2, 'Frigate').pictureRef = resolveSuperPirateShipImageIndex(BuiltObjectSubRole.Frigate);
    requireDesign(design3, 'Destroyer').pictureRef = resolveSuperPirateShipImageIndex(BuiltObjectSubRole.Destroyer);
    requireDesign(design4, 'Cruiser').pictureRef = resolveSuperPirateShipImageIndex(BuiltObjectSubRole.Cruiser);
    requireDesign(design5, 'CapitalShip').pictureRef = resolveSuperPirateShipImageIndex(BuiltObjectSubRole.CapitalShip);
    requireDesign(design6, 'Carrier').pictureRef = resolveSuperPirateShipImageIndex(BuiltObjectSubRole.Carrier);
    empire.designs.push(design!);
    empire.designs.push(design2!);
    empire.designs.push(design3!);
    empire.designs.push(design4!);
    empire.designs.push(design5!);
    empire.designs.push(design6!);
    empire.designs.push(design7);
    empire.designs.push(design8);
    // Galaxy.8.cs 4039-4048: the Phantom base (no SupportCostFactor override).
    const name2 = generatePirateBaseName(galaxy, habitat);
    design8.buildCount++;
    const builtObject = new BuiltObject(design8, name2, galaxy, true);
    builtObject.empire = empire;
    builtObject.heading = galaxy.selectRandomHeading();
    builtObject.targetHeading = builtObject.heading;
    builtObject.reDefine();
    builtObject.currentFuel = builtObject.fuelCapacity;
    builtObject.currentShields = builtObject.shieldsCapacity;
    empire.addBuiltObjectToGalaxy(builtObject, habitat, false, true, 0, 0, false);
    // Galaxy.8.cs 4049-4062: three defensive bases in orbit.
    for (let i = 0; i < 3; i++) {
        const name3 = galaxy.generateBuiltObjectName(design7, habitat);
        design7.buildCount++;
        const builtObject2 = new BuiltObject(design7, name3, galaxy, true);
        builtObject2.empire = empire;
        builtObject2.heading = galaxy.selectRandomHeading();
        builtObject2.targetHeading = builtObject2.heading;
        builtObject2.reDefine();
        builtObject2.currentFuel = builtObject2.fuelCapacity;
        builtObject2.currentShields = builtObject2.shieldsCapacity;
        const p = determineOrbitalBaseLocation(galaxy, habitat);
        empire.addBuiltObjectToGalaxy(builtObject2, habitat, false, true, Math.trunc(p.x), Math.trunc(p.y), false);
    }
    // Galaxy.8.cs 4063-4118: 20-29 warships.
    const num = galaxy.rnd.next(20, 30);
    for (let j = 0; j < num; j++) {
        let design9: Design | null = null;
        const r = galaxy.rnd.next(0, 25);
        if (r <= 2) design9 = design;
        else if (r <= 9) design9 = design2;
        else if (r <= 16) design9 = design3;
        else if (r <= 20) design9 = design4;
        else if (r <= 22) design9 = design5;
        else design9 = design6;
        design9!.buildCount++;
        const name4 = galaxy.selectRandomUniqueMilitaryShipName(null, empire, design9!.subRole);
        addPirateStartingShip(galaxy, empire, design9!, name4, habitat, true);
    }
    return empire;
}
