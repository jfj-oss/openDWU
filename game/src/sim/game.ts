// Game creation (task C2c-4 / M2d). Port of the empire-placement part of
// DistantWorlds/Start.2.cs CreateGameFromSettings (the orchestrator right
// after method_81, the save loader) with its helpers method_48 (race),
// method_51/52/53 (AI capital placement), method_84/91/92/93 (random
// locations), plus Galaxy SetNativeResourceCargoAndStartingStrategicCargo-
// ForAllIndependentHabitats, SetEmpireForAllIndependentHabitats,
// ReviewIndependentColonies, ClearIndependentColoniesFromSystem.
//
// Rnd: every Galaxy.Rnd call is kept in C# order. Parity with the original
// ends at the first GenerateEmpire's empire.DoTasks() (see empireGeneration.ts).
// The C# EmpireStartList.Update / tech "(Random)" rolls use clock-seeded
// Randoms (not reproducible even in C#); here they use a Random seeded from
// the galaxy seed.
//
// Not ported yet (TODO(port), in C# order after the starting colonies):
// ReviewEmpireTerritoryCore, resource/component price reviews, Galaxy.DoTasks,
// play-as-pirate (C2d covers AI pirate factions only), ruins, age-0 home asteroid
// fields + slugs, special locations/characters/ships, empire flags.
// Player plays a normal empire (play-as-pirate TODO); tech levels PreWarp (0),
// Normal (0.5, SetTechTreeStartingDefaults) and Level 1-6. AI pirate factions
// are generated when piratePrevalence > 0 (pirates.ts).

import { STOCK_BACON_SETTINGS, baconInitializeSettings, resetBaconSettings } from './baconSettings';
import { applyVictoryConditionsToGalaxy, type VictoryConditions } from './victory';
import { reviewComponentPrices, reviewResourcePrices } from './market';
import { selectPopularDesignCandidates } from './independentTraders';
import { gameStartColonyRecalc, gameStartReviewTaxes } from './taxes';
import { checkColoniesForBaseFacilities, createMiningStations, createResearchStations, createSpacePorts, determineNewSpacePortLocations, determineResearchStationLocation, setLuxuryResourcesAtColonies } from './stationPlacement';
import { applyResearchBonusGasGiant, ensureImportantPreWarpResources } from './startHabitats';
import { clearRuinBonusesForAge, placeRuinsUnlockTech, placeStartRuins } from './ruins';
import { createPrivateShips, createStateShips, fillShipsWithTroops } from './builtObjectPlacement';
import { assignMissionsToBuiltObjectList } from './civilianAI';
import { meetPiratesAtStart } from './pirateRelations';
import { CharacterRole, generateNewCharacter, generateStartingCharacters } from './characters';
import { registerTroopGeneralHook } from './troops';
import { resetEmpireTouchTimesForAge, runGameStartEmpireTick, runGameStartGalaxyTick, staggerEmpireTouchTimes } from './tick/gameStart';
import { meetEmpiresAtStart } from './diplomacy';
import { gameStartTail } from './gameStartTail';
import { PiratePlayStyle, fastFindNearestIndependentHabitat, findNearestPirateFaction, generatePirateEmpire, generatePirateEmpireRandom, pirateReviewColoniesToControl, selectRandomRace, setEmpireDifficultyFactors, type PirateGenerationContext } from './pirates';
import { setColonyResources } from './colony';
import { raceDesignPictureFamilyIndexPirates } from './empire';
import { SystemVisibilityStatus } from './visibility';
import { Galaxy, generateGalaxy } from './galaxy';
import { AutomationLevel, Empire } from './empire';
import { generateEmpire } from './empireGeneration';
import { makeHabitatIntoColony } from './colony';
import { netSort } from './netSort';
import { Random } from './random';
import type { GameData } from './data/gameData';
import { cloneGalaxyRaces, type Race } from './data/races';
import type { Government } from './data/governments';
import { setGovernmentsStatic } from './empire';
import { setGovernmentBiasesStatic } from './diplomacy';
import { setRaceBiasesStatic } from './raceBias';
import { GalaxyLocationType } from './galaxyLocation';
import { GalaxyShape, HabitatCategoryType, HabitatType, type Habitat } from './types';
import { Cargo, CargoList, ResourceRef } from './cargo';

export type HomeSystem = 'Harsh' | 'Trying' | 'Normal' | 'Agreeable' | 'Excellent';

export interface EmpireStartOptions {
    name?: string;
    /** Race name, or '(Random)'. */
    race: string;
    /** Government name, or '(Random)'. */
    governmentStyle?: string;
    homeSystemFavourability: HomeSystem;
    /** Player only: '(Random)', 'Deep Core', 'Outer Core', 'Far Regions', ... */
    startLocation?: string;
    /** AI only: 'Random', 'Nearby', 'Average', 'Distant', 'Random - not too close', 'Same System', 'Sector A1'... ('(Random)' = region placement). */
    proximityDistance?: string;
    age: number;
    /** 0 = PreWarp, 1-6 = Level X. */
    techLevel: number;
    corruptionMultiplier?: number;
    designPictureFamilyIndex?: number;
    /** Player only: Start.2.cs bool_2 PlayAsAPirate. */
    playAsPirate?: boolean;
    /** Player only (pirate): EmpireStart.PiratePlayStyle. */
    piratePlayStyle?: PiratePlayStyle;
}

export interface CreateGameOptions {
    seed: number;
    shape: GalaxyShape;
    starCount: number;
    sectorWidth: number;
    sectorHeight: number;
    systemNames: string[];
    gameData: GameData;
    colonyPrevalence?: number;
    /** Galaxy.Age (0-6): the wizard's galaxy Expansion slider (Start.1.cs 3695 / Start.2.cs 113). Also
     *  Galaxy.StartingAge (Galaxy.cs 982). Unset = 1 (standard preset, Start.cs 3298-3327). */
    galaxyAge?: number;
    colonyNames?: string[];
    player: EmpireStartOptions;
    aiEmpires: EmpireStartOptions[];
    /** C# bool_6 "allow empires to start in the same system" (colony search variant). */
    allowEmpiresInSameSystem?: boolean;
    /** Galaxy.PiratePrevalence (0 or unset = no pirate factions). */
    piratePrevalence?: number;
    /** Galaxy.PirateProximity: 0 near (default), 1 medium, 2 far. */
    pirateProximity?: number;
    /** Galaxy.PirateShipMaintenanceFactor (Start.2.cs 498, the wizard's pirate strength; default 0.4, Galaxy.cs 375). */
    pirateShipMaintenanceFactor?: number;
    /** Galaxy.MaximumEmpireAmount (Start.2.cs 115; the wizard passes BaconStart.method_61 of the star-density
     *  slider, startGameOptions.ts maximumEmpireAmountFor — 20 at 700 stars). Unset = player + AI count, a TS
     *  fallback for direct callers (dev start, tests) that the C# never uses; it scales the pirate-faction count
     *  (Galaxy.9.cs 22: trunc(2 * PiratePrevalence * MaximumEmpireAmount)). */
    maximumEmpireAmount?: number;
    /** Galaxy.DifficultyLevel (default 1.0). */
    difficultyLevel?: number;
    /** VictoryConditions.EnableDisasterEvents (Start.2.cs 503; default true). */
    disasterEventsEnabled?: boolean;
    /**
     * M4z4: victoryConditions_0 (the runtime VictoryConditions, victory.ts victoryConditionsFromWizard). When set it
     * becomes Galaxy.GlobalVictoryConditions (Start.2.cs 2026) and drives Start.2.cs 501-506 (overriding
     * disasterEventsEnabled). Unset = no global victory conditions (progress list empty, no threshold victory).
     */
    victoryConditions?: VictoryConditions | null;
    /** M4z4: EmpireStart.DifficultyScaling → Galaxy.DifficultyLevelScalesAsPlayerApproachesVictory (Start.2.cs 496). */
    difficultyLevelScalesAsPlayerApproachesVictory?: boolean;
    /**
     * VictoryConditions.EnableStoryEvents → Galaxy.StoryReturnOfTheShakturiEnabled (Start.2.cs 501): the "Return of the
     * Shakturi" story line. Default false (a normal TS game; the C# wizard defaults it on).
     */
    storyReturnOfTheShakturiEnabled?: boolean;
    /** Start.2.cs bool_7 → Galaxy.StoryDistantWorldsEnabled (502): the "Distant Worlds" galactic-history story. Default false. */
    storyDistantWorldsEnabled?: boolean;
    /**
     * VictoryConditions.EnableStoryEventsShadows → Galaxy.StoryShadowsEnabled (506) and GenerateEmpire's pre-warp progress
     * events (Galaxy.7.cs 5187) and Start.2.cs 2031: the "Shadows" pre-warp story. Default false.
     */
    storyShadowsEnabled?: boolean;
    /** VictoryConditions.EnableRaceSpecificEvents → Galaxy.GameRaceSpecificEventsEnabled (504; Legends race events). Default true. */
    raceSpecificEventsEnabled?: boolean;
    /** Galaxy.EmpireTerritoryColonyInfluenceRangeFactor from the wizard (<= 0 = auto). */
    empireTerritoryColonyInfluenceRangeFactor?: number;
    /**
     * TEST-ONLY seam (not part of the game API; the wizard never sets it). Called at each
     * game-start phase boundary *after* the named step has run (see GameStartPhase); returning
     * 'stop' makes createGame return at once with the galaxy in exactly that state. Lets tests
     * observe the state just before a step (exact Rnd-sequence tests) without re-running it.
     * `empire` is set for the per-empire phases ('empire:*', 'ships:*').
     */
    __phaseHook?: (phase: GameStartPhase, galaxy: Galaxy, empire?: Empire) => void | 'stop';
}

/**
 * createGame phase boundaries reported to CreateGameOptions.__phaseHook (test-only). Each name
 * means "this step has just completed" (Start.2.cs CreateGameFromSettings line ranges):
 * - 'startingColonies'  extra starting colonies + ReviewIndependentColonies (→ 1098)
 * - 'priceReviews'      1099-1104 ReviewEmpireTerritory + 20 × resource/component price reviews
 * - 'firstGalaxyTick:huge' the huge-interval block of that first Galaxy.DoTasks (popular designs, super pirates)
 * - 'firstGalaxyTick'   1105-1106 Galaxy.DoTasks (super pirates, independent traders, pirate factions)
 * - 'empire:start'      1108 per-empire setup loop, before the first step for that empire
 * - 'empire:colonyRecalc' 1110-1113, 'empire:spacePorts' 1139-1145 (CreateSpacePorts),
 *   'empire:portColonyResources' 1146, 'empire:baseFacilities' 1147, 'empire:gasGiantBonus' 1156-1173,
 *   'empire:preWarpResources' 1174-1273, 'empire:unlockTechRuin' 1274-1304,
 *   'empire:researchLocations' 1307, 'empire:researchStations' 1308-1311,
 *   'empire:miningStations' 1313-1317, 'empire:luxury' 1318, 'empire:taxes' 1319-1339,
 *   'empire:doTasks' 1340-1344 (end of that empire's setup)
 * - 'empireSetup'       the whole 1108-1350 loop
 * - 'ships:start' / 'ships:state' / 'ships:private' / 'ships:troops' / 'ships:missions'
 *                       1365-1375 per empire (only for empires with tech level > 0)
 * - 'startingShips'     the whole 1365-1375 loop
 * - 'diplomacy'         1376-1472 (empires meet, pirate meetings)
 * - 'characters'        1474-1482 starting characters
 * - 'territoryReview'   1484-1486
 * - 'nearPlayerPirate'  1493-1533
 * - 'startRuins'        1534-1554 SelectRuins pass (placeStartRuins)
 * - 'ruins'             1534-1565 (+ the Age > 0 ruin-bonus clearing)
 * - 'tail'              gameStartTail (end of createGame)
 */
export type GameStartPhase =
    | 'startingColonies'
    | 'priceReviews'
    | 'firstGalaxyTick:huge'
    | 'firstGalaxyTick'
    | 'empire:start'
    | 'empire:colonyRecalc'
    | 'empire:spacePorts'
    | 'empire:portColonyResources'
    | 'empire:baseFacilities'
    | 'empire:gasGiantBonus'
    | 'empire:preWarpResources'
    | 'empire:unlockTechRuin'
    | 'empire:researchLocations'
    | 'empire:researchStations'
    | 'empire:miningStations'
    | 'empire:luxury'
    | 'empire:taxes'
    | 'empire:doTasks'
    | 'empireSetup'
    | 'ships:start'
    | 'ships:state'
    | 'ships:private'
    | 'ships:troops'
    | 'ships:missions'
    | 'startingShips'
    | 'diplomacy'
    | 'characters'
    | 'territoryReview'
    | 'nearPlayerPirate'
    | 'startRuins'
    | 'ruins'
    | 'tail';

export interface Game {
    galaxy: Galaxy;
    playerEmpire: Empire;
    viewX: number;
    viewY: number;
}

const RANDOM = '(Random)';

interface ResolvedStart {
    opts: EmpireStartOptions;
    resolvedRace: Race | null;
    projectedColonyAmount: number;
}

// Port of EmpireStartList.Update(races, exclude) — clock Random → `rnd`.
function updateEmpireStarts(list: ResolvedStart[], races: Race[], rnd: Random, exclude = ''): void {
    for (const es of list) {
        const raceName = es.resolvedRace !== null ? es.resolvedRace.name : es.opts.race;
        let race: Race | null;
        if (raceName.toLowerCase() === RANDOM.toLowerCase()) {
            const playable = races.filter((r) => r.playable);
            const used = list.map((e) => e.resolvedRace).filter((r): r is Race => r !== null);
            const pool = playable.filter((r) => !used.includes(r) && (exclude === '' || r.name !== exclude));
            race = pool.length > 0 ? pool[rnd.next(0, pool.length)] : playable[rnd.next(0, playable.length)];
        } else {
            race = races.find((r) => r.name === raceName) ?? null;
        }
        let exp = 1.0;
        for (let i = 0; i < es.opts.age; i++) exp *= 2.3 + rnd.nextDouble() * (2.7 - 2.3);
        es.resolvedRace = race;
        es.projectedColonyAmount = Math.trunc(exp);
    }
    // Sort() by ProjectedColonyAmount (unstable) then Reverse().
    netSort(list, (a, b) => a.projectedColonyAmount - b.projectedColonyAmount);
    list.reverse();
}

// Port of Empire.10.cs DetermineMostSuitableGovermentTypes(race, allowable, 3).
export function determineMostSuitableGovernmentTypes(race: Race, allowable: number[], maximumCount = 3): Government[] {
    const list: { g: Government; tag: number }[] = [];
    for (const g of governmentsStatic()) {
        if (g === null) continue;
        const num = 1.0 - g.warWeariness + (g.troopRecruitment - 1.0);
        const num2 = (g.troopRecruitment - 1.0) * 0.5 + (1.0 - g.maintenanceCosts) * 0.5;
        const num3 = g.researchSpeed - 1.0 + (1.0 - g.maintenanceCosts) + (1.0 - g.corruption);
        const num4 = g.tradeBonus - 1.0 + (g.approvalRating - 1.0) + (g.populationGrowth - 1.0);
        let num5 = 0.0;
        num5 += ((race.aggression - 100) / 100.0) * num;
        num5 += ((race.caution - 100) / 100.0) * num2;
        num5 += ((race.intelligence - 100) / 100.0) * num3;
        num5 += ((race.friendliness - 100) / 100.0) * num4;
        if (g.availability !== 0) num5 += 2.0;
        if (allowable.includes(g.governmentId)) list.push({ g, tag: Math.fround(num5) });
    }
    netSort(list, (a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
    list.reverse();
    return list.slice(0, Math.min(list.length, maximumCount)).map((e) => e.g);
}

let govs: (Government | null)[] = [];
function governmentsStatic(): (Government | null)[] {
    return govs;
}

// Port of Empire.10.cs SelectSuitableGovernment(race, excludeId = -1, allowable).
function selectSuitableGovernment(galaxy: Galaxy, race: Race, allowable: number[]): number {
    const list = determineMostSuitableGovernmentTypes(race, allowable);
    if (list.length <= 0) return -1;
    let num = -1;
    for (let i = 0; i < list.length; i++) {
        if (list[i].availability === 1) {
            num = i;
            break;
        }
    }
    const num2 = num >= 0 ? num : 0;
    let num3 = galaxy.rnd.next(0, list.length + 1);
    if (num3 === list.length) num3 = num2;
    return list[num3].governmentId;
}

// Port of Galaxy.4.cs ResolveGovernmentId(governmentName, race).
function resolveGovernmentId(galaxy: Galaxy, name: string, race: Race): number {
    if (name === RANDOM) {
        return race.preferredStartingGovernment < 0 ? selectSuitableGovernment(galaxy, race, Empire.resolveDefaultAllowableGovernmentTypes(race)) : race.preferredStartingGovernment;
    }
    return governmentsStatic().find((g) => g !== null && g.name === name)?.governmentId ?? -1;
}

function governmentById(id: number): Government | null {
    return id >= 0 && id < govs.length ? govs[id] : null;
}

// Port of Start.cs method_48 (race by name, or random unused playable race).
function selectRace(galaxy: Galaxy, name: string, empires: Empire[] | null, allowNonNormal: boolean): Race {
    if (name === RANDOM) {
        const used = (empires ?? []).map((e) => e.dominantRace).filter((r): r is Race => r !== null);
        const pool = galaxy.races.filter((r) => r.playable && !used.includes(r) && (allowNonNormal || r.canBeNormalEmpire));
        if (pool.length > 0) return pool[galaxy.rnd.next(0, pool.length)];
        return selectRandomRace(galaxy, 0)!; // Galaxy.SelectRandomRace(0)
    }
    const r = galaxy.races.find((x) => x.name === name);
    if (r === undefined) throw new Error(`Unknown race: ${name}`);
    return r;
}

// Port of Start.2.cs method_93(galaxy, min, max): random point in a ring.
function randomPointInRing(galaxy: Galaxy, min: number, max: number): { x: number; y: number } {
    const rnd = galaxy.rnd;
    const num = galaxy.sizeX / 2.0;
    const num2 = galaxy.sizeY / 2.0;
    const num3 = galaxy.sizeX / 2.0;
    const num4 = num3 * min;
    const num5 = rnd.nextDouble() * num3 * (max - min);
    const num6 = num4 + num5;
    const num7 = rnd.nextDouble() * Math.PI * 2.0;
    let num8 = Math.cos(num7) * num6;
    let num9 = Math.sin(num7) * num6;
    if (rnd.next(0, 2) === 1) num8 *= -1.0;
    if (rnd.next(0, 2) === 1) num9 *= -1.0;
    return { x: num + num8, y: num2 + num9 };
}

// Port of Galaxy.6.cs DetermineRaceRegion(race).
function determineRaceRegion(galaxy: Galaxy, race: Race | null) {
    if (race === null) return null;
    return galaxy.galaxyLocations.find((l) => l.type === GalaxyLocationType.RaceRegion && l.relatedRace === race) ?? null;
}

// Port of Start.2.cs method_84(galaxy, race, min, max, out x, out y, jitter, factor).
function raceRegionPoint(galaxy: Galaxy, race: Race | null, min: number, max: number, jitter: boolean, factor: number): { x: number; y: number } {
    const loc = determineRaceRegion(galaxy, race);
    if (loc !== null) {
        let x = loc.xpos + loc.width / 2.0;
        let y = loc.ypos + loc.height / 2.0;
        const num = (loc.width / 2.0) * factor;
        if (jitter) {
            x += num * 2.0 * galaxy.rnd.nextDouble() - num;
            y += num * 2.0 * galaxy.rnd.nextDouble() - num;
        }
        return { x, y };
    }
    return randomPointInRing(galaxy, min, max);
}

// Port of Start.2.cs method_91 (random offset up to `range` along `heading`).
function offsetWithin(galaxy: Galaxy, heading: number, x: number, y: number, range: number): { x: number; y: number } {
    const num = galaxy.rnd.nextDouble() * range;
    let num2 = Math.cos(heading) * num;
    let num3 = Math.sin(heading) * num;
    if (galaxy.rnd.next(0, 2) === 1) num2 *= -1.0;
    if (galaxy.rnd.next(0, 2) === 1) num3 *= -1.0;
    return { x: x + num2, y: y + num3 };
}

// Port of Start.2.cs method_92 (offset exactly `range` along `heading`).
function offsetAt(galaxy: Galaxy, heading: number, x: number, y: number, range: number): { x: number; y: number } {
    let num = Math.cos(heading) * range;
    let num2 = Math.sin(heading) * range;
    if (galaxy.rnd.next(0, 2) === 1) num *= -1.0;
    if (galaxy.rnd.next(0, 2) === 1) num2 *= -1.0;
    return { x: x + num, y: y + num2 };
}

// Port of Start.2.cs method_90 (inside the galaxy).
function inGalaxy(galaxy: Galaxy, x: number, y: number): boolean {
    return !(x < 0.0) && y >= 0.0 && !(x > galaxy.sizeX) && y <= galaxy.sizeY;
}

// Port of Start.cs method_53 (proximity → distance; may set a target sector).
function proximityDistance(galaxy: Galaxy, s: string): { distance: number; sector: { x: number; y: number } | null } {
    let sector: { x: number; y: number } | null = null;
    let num2 = 0.05;
    let num3 = 1.0;
    if (s === 'Random') {
        num2 = 0.05;
        num3 = 1.0;
    } else if (s === 'Same System') {
        num2 = 0.0;
        num3 = (galaxy.sizeX / 20000000.0) * 0.0024;
    } else if (s === 'Nearby') {
        num2 = 0.03;
        num3 = 0.11;
    } else if (s === 'Average') {
        num2 = 0.11;
        num3 = 0.4;
    } else if (s === 'Distant') {
        num2 = 0.4;
        num3 = 1.0;
    } else if (s === 'Random - not too close') {
        num2 = 0.1;
        num3 = 1.0;
    } else if (s.startsWith('Sector')) {
        const t = s.substring('Sector'.length + 1).trim();
        if (t.length > 1) {
            const col = t.charCodeAt(0) - 65;
            const row = parseInt(t.substring(1), 10);
            if (!Number.isNaN(row)) sector = { x: col, y: row - 1 };
        }
    }
    const num5 = galaxy.sizeX * (num3 - num2);
    const num6 = galaxy.sizeX * num2;
    return { distance: num6 + num5 * galaxy.rnd.nextDouble(), sector };
}

// Start.cs method_50: system has a colony of a normal empire.
function systemHasEmpireColony(galaxy: Galaxy, star: Habitat): boolean {
    return galaxy.systemHabitatsOf(star.systemIndex).some((h) => h.population.items.length > 0 && h.empire !== null && h.empire !== galaxy.independentEmpire);
}

function inNebula(galaxy: Galaxy, h: Habitat): boolean {
    return galaxy.determineGalaxyLocationsAtPoint(h.xpos, h.ypos, GalaxyLocationType.NebulaCloud).length > 0;
}

// Port of Start.cs method_51 (AI capital search).
function findAiCapital(
    galaxy: Galaxy,
    race: Race,
    proximity: string,
    playerCapital: Habitat,
    habitatType: HabitatType,
    playAsPirate: boolean,
    empireCount: number,
    sector: { x: number; y: number } | null,
): Habitat | null {
    let habitat: Habitat | null = null;
    let flag = false;
    const sectorSize = galaxy.sectorSize;
    if (proximity === RANDOM) {
        const num = 0.75 * (galaxy.sizeX / (Math.sqrt(empireCount) - 1.0));
        let num2 = 0;
        while (!flag && num2 < 200) {
            const factor = Math.min(1.0, num2 / 100.0);
            const p = playAsPirate ? randomPointInRing(galaxy, 0.0, 1.0) : raceRegionPoint(galaxy, race, 0.0, 1.0, num2 !== 0, factor);
            habitat = galaxy.findNearestUncolonizedHabitat(p.x, p.y, habitatType);
            if (habitat !== null) {
                if (inNebula(galaxy, habitat)) {
                    habitat = null;
                    flag = false;
                }
                if (habitat !== null) {
                    const h2 = galaxy.findNearestColony(habitat.xpos, habitat.ypos, null, false);
                    if (h2 !== null && galaxy.calculateDistance(habitat.xpos, habitat.ypos, h2.xpos, h2.ypos) < num) {
                        habitat = null;
                        flag = false;
                    }
                }
                if (habitat !== null) {
                    const star = galaxy.determineHabitatSystemStar(habitat);
                    if (galaxy.systemPlanetCount(galaxy.systems[star.systemIndex]) >= 4) flag = true;
                }
                if (habitat !== null) {
                    const loc = determineRaceRegion(galaxy, race);
                    if (loc !== null) {
                        const c = loc.resolveLocationCenter();
                        if (galaxy.calculateDistance(c.x, c.y, habitat.xpos, habitat.ypos) > loc.width * 0.4) {
                            habitat = null;
                            flag = false;
                        }
                    }
                }
            }
            num2++;
        }
        if (!flag && habitat === null) {
            const p = raceRegionPoint(galaxy, race, 0.0, 1.0, false, 0.0);
            const h3 = galaxy.findNearestHabitatOfType(p.x, p.y, HabitatType.MainSequence)!;
            // TODO(port): AssignSystemName(h3, 1) when PlanetCount == 0 && name length <= 5.
            galaxy.setColonizableHabitatsInSystem(h3, race, 1);
            habitat = galaxy.findNearestUncolonizedHabitat(h3.xpos, h3.ypos, habitatType);
            if (habitat === null) {
                galaxy.setColonizableHabitatsInSystem(h3, race, 3);
                habitat = galaxy.findNearestUncolonizedHabitat(h3.xpos, h3.ypos, habitatType);
            }
        }
        return habitat;
    }
    let num6 = 0;
    let p = { x: 0, y: 0 };
    let num7 = 0.7;
    let num8 = 0;
    let num9 = 0;
    let num10 = galaxy.rnd.nextDouble() * sectorSize * 0.1;
    if (sector !== null) {
        num8 = sector.x * sectorSize + sectorSize * 0.5;
        num9 = sector.y * sectorSize + sectorSize * 0.5;
        p = { x: num8, y: num9 };
        num7 = 0.3;
    }
    const aroundPlayer = (): { x: number; y: number } => {
        let q = offsetAt(galaxy, galaxy.selectRandomHeading(), playerCapital.xpos, playerCapital.ypos, proximityDistance(galaxy, proximity).distance);
        while (!inGalaxy(galaxy, q.x, q.y)) {
            const heading = galaxy.selectRandomHeading();
            q = offsetAt(galaxy, heading, playerCapital.xpos, playerCapital.ypos, proximityDistance(galaxy, proximity).distance);
        }
        return q;
    };
    while (!flag && num6 < 200) {
        if (sector !== null) {
            let h = galaxy.selectRandomHeading();
            let x = num8 + Math.cos(h) * num10;
            let y = num9 + Math.sin(h) * num10;
            let num14 = num10;
            while (!inGalaxy(galaxy, x, y)) {
                h = galaxy.selectRandomHeading();
                num14 *= 0.9;
                x = num8 + Math.cos(h) * num14;
                y = num9 + Math.sin(h) * num14;
            }
            num10 *= 1.3;
            p = { x, y };
        } else {
            p = aroundPlayer();
        }
        habitat = galaxy.fastFindNearestPlanetMoonOfTypesUnoccupiedSystem(p.x, p.y, null, [habitatType]);
        if (habitat !== null) {
            const star = galaxy.determineHabitatSystemStar(habitat);
            let flag2 = systemHasEmpireColony(galaxy, star);
            if (!flag2 && playAsPirate) {
                if (galaxy.calculateDistance(playerCapital.xpos, playerCapital.ypos, habitat.xpos, habitat.ypos) < sectorSize * 0.5) flag2 = true;
            }
            const h5 = galaxy.findNearestColony(p.x, p.y, null, false);
            if (h5 !== null && galaxy.calculateDistance(p.x, p.y, h5.xpos, h5.ypos) < sectorSize * num7) flag2 = true;
            if (galaxy.systemPlanetCount(galaxy.systems[star.systemIndex]) >= 3 && !flag2) flag = true;
        }
        num6++;
    }
    if (!flag) {
        p = aroundPlayer();
        habitat = galaxy.fastFindNearestPlanetMoonOfTypesUnoccupiedSystem(p.x, p.y, null, [race.nativeHabitatType]);
        if (habitat === null) {
            let index = galaxy.rnd.next(0, galaxy.systems.length);
            while (galaxy.systems[index].systemStar.category !== HabitatCategoryType.Star) index = galaxy.rnd.next(0, galaxy.systems.length);
            const star = galaxy.systems[index].systemStar;
            galaxy.setColonizableHabitatsInSystem(star, race, 1);
            habitat = galaxy.findNearestUncolonizedHabitat(star.xpos, star.ypos, race.nativeHabitatType);
            if (habitat === null) {
                galaxy.setColonizableHabitatsInSystem(star, race, 3);
                habitat = galaxy.findNearestUncolonizedHabitat(star.xpos, star.ypos, race.nativeHabitatType);
            }
        }
    }
    return habitat;
}

// Port of Galaxy.6.cs SetNativeResourceCargoAndStartingStrategicCargoForAllIndependentHabitats.
function setNativeResourceCargoForIndependents(galaxy: Galaxy): void {
    const ind = galaxy.independentEmpire;
    if (ind === null) return;
    const rs = galaxy.resourceSystem;
    for (const h of galaxy.habitats) {
        // SetNativeResourceCargo
        if (h.population.items.length > 0 && h.population.totalAmount > 0) {
            if (h.cargo === null) h.cargo = new CargoList();
            for (const r of h.resources) {
                const amount = 500 + Math.trunc(2000.0 * galaxy.rnd.nextDouble());
                h.cargo.add(new Cargo(new ResourceRef(r.resourceId), amount, ind));
            }
            for (const f of rs.fuelResources) {
                if (f.isFuel) h.cargo.add(new Cargo(new ResourceRef(f.resourceId), 3000, ind));
            }
            h.isRefuellingDepot = true;
        }
        // SetColonyStartingStrategicResources
        if (h.population.items.length > 0 && h.population.totalAmount > 0) {
            if (h.cargo === null) h.cargo = new CargoList();
            for (const def of rs.strategicResourcesOrderedByRelativeImportance) {
                if (def.colonyGrowthResourceLevel > 0) {
                    // Habitat.CalculateStrategicResourceConsumptionPerYear (7403).
                    const num = Math.sqrt(h.population.totalAmount / 1000000.0);
                    const amount = 5 + Math.trunc(5.0 * 0.33 * num * Math.fround(def.colonyGrowthResourceLevel));
                    h.cargo.add(new Cargo(new ResourceRef(def.resourceId), amount, ind));
                }
            }
        }
    }
}

// Port of Galaxy.6.cs SetEmpireForAllIndependentHabitats.
function setEmpireForAllIndependentHabitats(galaxy: Galaxy): void {
    if (galaxy.independentEmpire === null) return;
    for (const h of galaxy.habitats) {
        if (h.population.items.length > 0 && h.population.totalAmount > 0 && h.empire === null) {
            h.owner = galaxy.independentEmpire;
            h.empire = galaxy.independentEmpire;
        }
    }
}

// Port of Galaxy.1.cs ReviewIndependentColonies.
function reviewIndependentColonies(galaxy: Galaxy): Habitat[] {
    return galaxy.habitats.filter((h) => h.population.items.length > 0 && h.empire === galaxy.independentEmpire);
}

// Port of Galaxy.6.cs ClearIndependentColoniesFromSystem (Habitat.ClearColony core).
function clearIndependentColoniesFromSystem(galaxy: Galaxy, independentColonies: Habitat[], systemIndex: number): void {
    for (const h of galaxy.systemHabitatsOf(systemIndex)) {
        if (h.population.items.length > 0 && h.empire === galaxy.independentEmpire) {
            // TODO(port): Habitat.ClearColony details (troops, characters, facilities, messages).
            h.cargo = null;
            h.population.items = [];
            h.population.totalAmount = 0;
            h.owner = null;
            h.empire = null;
            const i = independentColonies.indexOf(h);
            if (i >= 0) independentColonies.splice(i, 1);
        }
    }
}

// Galaxy.cs ExpectedMaximumColoniesInGalaxy / AllowableMaximumStartingColonies.
function allowableMaximumStartingColonies(galaxy: Galaxy): number {
    let num = 0.47;
    if (galaxy.starCount >= 1400) num = 0.38;
    else if (galaxy.starCount >= 1000) num = 0.41;
    else if (galaxy.starCount >= 700) num = 0.42;
    else if (galaxy.starCount >= 400) num = 0.43;
    num *= galaxy.colonyPrevalence;
    return Math.trunc(Math.trunc(galaxy.starCount * num) * 0.75);
}

// Player capital search areas per shape (CreateGameFromSettings).
// `regionFactor`: method_84(..., bool_5: true, 0.5) for a normal player, method_83 (factor 1.0)
// for a pirate player (Start.2.cs ~580-660).
function playerStartPoint(galaxy: Galaxy, shape: GalaxyShape, loc: string, race: Race, regionFactor = 0.5): { x: number; y: number } {
    const ring = (a: number, b: number) => randomPointInRing(galaxy, a, b);
    const region = (max: number) => raceRegionPoint(galaxy, race, 0.0, max, true, regionFactor);
    switch (shape) {
        case GalaxyShape.Spiral:
            if (loc === 'Deep Core') return ring(0.0, 0.29);
            if (loc === 'Outer Core') return ring(0.29, 0.48);
            if (loc === 'Far Regions') return ring(0.48, 1.0);
            return region(1.0);
        case GalaxyShape.Elliptical:
            if (loc === 'Deep Core') return ring(0.0, 0.29);
            if (loc === 'Outer Core') return ring(0.29, 0.48);
            if (loc === 'Inner Rim') return ring(0.48, 0.86);
            if (loc === 'Outer Rim') return ring(0.86, 1.0);
            return region(1.0);
        case GalaxyShape.Ring:
            if (loc === 'Core') return ring(0.0, 0.29);
            if (loc === 'Void') return ring(0.29, 0.82);
            if (loc === 'Rim') return ring(0.82, 1.0);
            return region(1.0);
        default:
            if (loc === 'Center') return ring(0.0, 0.42);
            if (loc === 'Edge') return ring(0.42, 1.44);
            return region(1.44);
    }
}

// Port of Galaxy.6.cs CheckNearIndependentColony(x, y, range) over Galaxy.IndependentColonies.
function checkNearIndependentColony(galaxy: Galaxy, independentColonies: Habitat[], x: number, y: number, range: number): boolean {
    const num = range * range;
    for (const h of independentColonies) if (galaxy.calculateDistanceSquared(x, y, h.xpos, h.ypos) < num) return true;
    return false;
}

// Start.2.cs 1493-1533: when pirates are on at the nearest proximity, one extra faction is
// generated within reach of the player if the nearest faction is more than a sector away.
function spawnPirateNearPlayer(galaxy: Galaxy, ctx: PirateGenerationContext, xpos: number, ypos: number): void {
    const empire6 = findNearestPirateFaction(galaxy, xpos, ypos, null, true);
    if (empire6 === null) return;
    const num40 = galaxy.calculateDistance(xpos, ypos, empire6.pirateEmpireBaseHabitat!.xpos, empire6.pirateEmpireBaseHabitat!.ypos);
    if (!(num40 > galaxy.sectorSize)) return;
    let num41 = xpos;
    let num42 = ypos;
    let flag4 = false;
    let num43 = 0;
    const fuel = galaxy.resourceSystem.fuelResources[0].resourceId;
    while (!flag4 && num43 < 50) {
        num41 += 200000.0 - galaxy.rnd.nextDouble() * 400000.0;
        num42 += 200000.0 - galaxy.rnd.nextDouble() * 400000.0;
        let habitat12 = galaxy.findNearestHabitatWithResource(num41, num42, fuel);
        // C# derefs habitat12 here without a null check.
        if (habitat12!.basesAtHabitat.length > 0) {
            for (const b of habitat12!.basesAtHabitat) {
                if (b.empire !== null && b.empire !== galaxy.independentEmpire && b.empire.pirateEmpireBaseHabitat === null) {
                    habitat12 = null;
                    break;
                }
            }
        }
        if (habitat12 !== null) {
            const habitat13 = galaxy.findNearestColony(habitat12.xpos, habitat12.ypos, null, false)!;
            const num45 = galaxy.calculateDistance(habitat13.xpos, habitat13.ypos, habitat12.xpos, habitat12.ypos);
            if (num45 > galaxy.maxSolarSystemSize * 2.1 && habitat12.category !== HabitatCategoryType.Star && galaxy.nextEmpireId < galaxy.maximumEmpireCount) {
                selectPopularDesignCandidates(galaxy);
                const pt = galaxy.selectRelativeHabitatSurfacePoint(habitat12);
                generatePirateEmpireRandom(galaxy, ctx, habitat12, Math.trunc(pt.x), Math.trunc(pt.y), true);
                flag4 = true;
            }
        }
        num43++;
    }
}

/** The GameOptions automation fields Start.2.cs 2122-2146 copies onto the human player's empire. */
export interface GameOptionsAutomation {
    controlColonizationDefault: AutomationLevel;
    controlColonyTaxRatesDefault: boolean;
    controlShipDesignDefault: boolean;
    controlDiplomaticGiftsDefault: AutomationLevel;
    controlWarTradeSanctionsDefault: AutomationLevel;
    controlTreatyNegotiationDefault: AutomationLevel;
    controlAttacksOnEnemiesDefault: AutomationLevel;
    controlFleetFormationDefault: boolean;
    controlShipBuildingDefault: AutomationLevel;
    controlTroopRecruitmentDefault: boolean;
    controlAgentAssignmentDefault: AutomationLevel;
    controlResearchDefault: boolean;
    controlColonyFacilitiesDefault: AutomationLevel;
    controlCharacterLocationsDefault: boolean;
    controlPopulationPolicyDefault: boolean;
    controlOfferPirateMissionsDefault: AutomationLevel;
    attackOverMatchFactor: number;
    attackRangePatrol: number;
    attackRangeEscort: number;
    attackRangeOther: number;
    fleetAttackRefuelPortion: number;
    fleetAttackGatherPortion: number;
    discoveryActionRuin: number;
    discoveryActionAbandonedShipBase: number;
    newShipsAutomated: boolean;
}

// Port of Main.Part9.cs:2711-2809 method_260 (new GameOptions when no defaultOptions file exists; Start.cs:2733-2736
// calls it before the wizard): the automation defaults. AutomationLevel.Manual is the TS AutomationLevel.Undefined
// and SemiAutomated is PartiallyAutomated (AutomationLevel.cs: Manual, SemiAutomated, FullyAutomated).
export const DEFAULT_GAME_OPTIONS_AUTOMATION: Readonly<GameOptionsAutomation> = Object.freeze({
    controlAgentAssignmentDefault: AutomationLevel.PartiallyAutomated, // 2716
    controlAttacksOnEnemiesDefault: AutomationLevel.PartiallyAutomated, // 2717
    controlColonizationDefault: AutomationLevel.FullyAutomated, // 2718
    controlColonyTaxRatesDefault: true, // 2719
    controlDiplomaticGiftsDefault: AutomationLevel.Undefined, // 2720 Manual
    controlFleetFormationDefault: true, // 2721
    controlShipBuildingDefault: AutomationLevel.PartiallyAutomated, // 2722
    controlShipDesignDefault: true, // 2723
    controlTreatyNegotiationDefault: AutomationLevel.PartiallyAutomated, // 2724
    controlTroopRecruitmentDefault: true, // 2725
    controlWarTradeSanctionsDefault: AutomationLevel.PartiallyAutomated, // 2726
    controlResearchDefault: true, // 2727
    controlColonyFacilitiesDefault: AutomationLevel.PartiallyAutomated, // 2728
    controlPopulationPolicyDefault: true, // 2729
    controlCharacterLocationsDefault: true, // 2730
    controlOfferPirateMissionsDefault: AutomationLevel.PartiallyAutomated, // 2731
    attackOverMatchFactor: 2, // 2782
    attackRangePatrol: 48000, // 2783
    attackRangeEscort: 2000, // 2784
    attackRangeOther: 48000, // 2786
    fleetAttackRefuelPortion: Math.fround(0.3), // 2791
    fleetAttackGatherPortion: Math.fround(0.3), // 2792
    discoveryActionRuin: 0, // 2805
    discoveryActionAbandonedShipBase: 0, // 2806
    newShipsAutomated: true, // 2808
});

// Port of Start.2.cs:2122-2146 (CreateGameFromSettings): game2.PlayerEmpire.Control* / attack settings =
// main_0.gameOptions_0.*Default, statement for statement (AttackRangeAttack is not copied there).
export function applyStartAutomationSettings(empire: Empire, o: Readonly<GameOptionsAutomation>): void {
    empire.controlColonization = o.controlColonizationDefault;
    empire.controlColonyTaxRates = o.controlColonyTaxRatesDefault;
    empire.controlDesigns = o.controlShipDesignDefault;
    empire.controlDiplomacyGifts = o.controlDiplomaticGiftsDefault;
    empire.controlDiplomacyOffense = o.controlWarTradeSanctionsDefault;
    empire.controlDiplomacyTreaties = o.controlTreatyNegotiationDefault;
    empire.controlMilitaryAttacks = o.controlAttacksOnEnemiesDefault;
    empire.controlMilitaryFleets = o.controlFleetFormationDefault;
    empire.controlStateConstruction = o.controlShipBuildingDefault;
    empire.controlTroopGeneration = o.controlTroopRecruitmentDefault;
    empire.controlAgentAssignment = o.controlAgentAssignmentDefault;
    empire.controlResearch = o.controlResearchDefault;
    empire.controlColonyFacilities = o.controlColonyFacilitiesDefault;
    empire.controlCharacterLocations = o.controlCharacterLocationsDefault;
    empire.controlPopulationPolicy = o.controlPopulationPolicyDefault;
    empire.controlOfferPirateMissions = o.controlOfferPirateMissionsDefault;
    empire.attackOvermatchFactor = o.attackOverMatchFactor;
    empire.attackRangePatrol = o.attackRangePatrol;
    empire.attackRangeEscort = o.attackRangeEscort;
    empire.attackRangeOther = o.attackRangeOther;
    empire.fleetAttackRefuelPortion = o.fleetAttackRefuelPortion;
    empire.fleetAttackGatherPortion = o.fleetAttackGatherPortion;
    // TODO(port): empire.DiscoveryActionRuin = gameOptions.DiscoveryActionRuin (Start.2.cs 2144) — Empire.cs field not ported.
    empire.discoveryActionAbandonedShipBase = o.discoveryActionAbandonedShipBase;
    empire.newShipsAutomated = o.newShipsAutomated;
}

// createGame: the sim entry point the wizard calls (non-pirate play).
export function createGame(opts: CreateGameOptions): Game {
    const gd = opts.gameData;
    // Game generation runs with the class defaults of the BaconSettings statics (BaconMain.BaconInitialize runs only
    // once Main has the game, below at the end).
    resetBaconSettings();
    govs = gd.governments;
    setGovernmentsStatic(gd.governments);
    setGovernmentBiasesStatic(gd.governmentBiases); // GovernmentBiasList.LoadFromFile (M4r: NaturalAffinity)
    // Galaxy.cs LoadRaceBiases (Race.Biases) / Galaxy.RaceFamiliesStatic biases (raceBias.ts).
    setRaceBiasesStatic(gd.races, gd.raceBiases, gd.raceFamilies.length, gd.raceFamilyBiases);
    const clockRnd = new Random(opts.seed ^ 0x5eed); // stands in for the C# clock-seeded Randoms
    // Galaxy.4.cs 2132 / Start.2.cs 98: the new galaxy's own Race objects (per game, saved with it).
    const galaxyRaces = cloneGalaxyRaces(gd.races);
    const normalRaces = galaxyRaces.filter((r) => r.canBeNormalEmpire);
    // empireStartList = player + AIs, Update(raceList) before the Galaxy ctor.
    const playerStart: ResolvedStart = { opts: opts.player, resolvedRace: null, projectedColonyAmount: 0 };
    const aiStarts: ResolvedStart[] = opts.aiEmpires.map((o) => ({ opts: o, resolvedRace: null, projectedColonyAmount: 0 }));
    const all = [playerStart, ...aiStarts];
    updateEmpireStarts(all, normalRaces, clockRnd);

    const galaxy = generateGalaxy({
        seed: opts.seed,
        shape: opts.shape,
        starCount: opts.starCount,
        sectorWidth: opts.sectorWidth,
        sectorHeight: opts.sectorHeight,
        systemNames: opts.systemNames,
        colonyPrevalence: opts.colonyPrevalence,
        gameData: gd,
        races: galaxyRaces,
        empireStarts: all.filter((e) => e.resolvedRace !== null).map((e) => ({ resolvedRace: e.resolvedRace!, projectedColonyAmount: e.projectedColonyAmount })),
    });
    // Unset galaxyAge = 1: the game's standard preset (Start.cs 3298-3327: Expansion 1 / empire tech Normal 0.5).
    // The C# option-screen defaults (Main.Part9.cs 2664 / 2689: GalaxyExpansion 0, YourEmpireTechLevel 0) are a
    // pre-warp start instead; callers wanting age 0 pass galaxyAge: 0.
    galaxy.age = opts.galaxyAge ?? 1;
    // Start.2.cs 107-108 and the starting age / difficulty used throughout game start.
    galaxy.piratePrevalence = opts.piratePrevalence ?? 0;
    galaxy.raceFamilies = gd.raceFamilies;
    // Galaxy.cs 982 `StartingAge => _Age`: the galaxy's age (Start.2.cs 113 `galaxy_0.Age = int_5`, the
    // Expansion slider), not the player's EmpireStart.Age.
    galaxy.startingAge = galaxy.age;
    galaxy.difficultyLevel = opts.difficultyLevel ?? 1.0;
    // Start.2.cs 500: no race (AvailableCharacters) starting characters until 1478.
    galaxy.allowRaceStartingCharacters = false;
    // Start.2.cs 501-506 (M4z3): the story lines and Legends event switches (VictoryConditions / the wizard's story box).
    // GameDisasterEventsEnabled (503) is set before the first galaxy tick below.
    galaxy.storyReturnOfTheShakturiEnabled = opts.storyReturnOfTheShakturiEnabled ?? false;
    galaxy.storyDistantWorldsEnabled = opts.storyDistantWorldsEnabled ?? false;
    galaxy.gameRaceSpecificEventsEnabled = opts.raceSpecificEventsEnabled ?? true;
    galaxy.storyShadowsEnabled = opts.storyShadowsEnabled ?? false;
    registerTroopGeneralHook((g, e, location) => {
        // Galaxy.2.cs 5230: GenerateNewCharacter(TroopGeneral, location). TODO(port): 5231-5233 message.
        generateNewCharacter(g, e, CharacterRole.TroopGeneral, location);
    });
    galaxy.empireTerritoryColonyInfluenceRangeFactor = opts.empireTerritoryColonyInfluenceRangeFactor ?? galaxy.empireTerritoryColonyInfluenceRangeFactor;
    galaxy.colonyNames = opts.colonyNames ?? null;
    galaxy.colonyNameIndex = 0;

    // Independent empire.
    const independent = new Empire(galaxy, 'Independent', true, null, null, null);
    independent.stateMoney = 8.9884656743115785e307;
    independent.privateMoney = 8.9884656743115785e307;
    galaxy.independentEmpire = independent;
    independent.generateDesignSpecifications(galaxy, null, false, '');
    setNativeResourceCargoForIndependents(galaxy);
    setEmpireForAllIndependentHabitats(galaxy);
    let independentColonies = reviewIndependentColonies(galaxy);

    // Player race + government.
    const playAsPirate = opts.player.playAsPirate ?? false; // bool_2
    const race = selectRace(galaxy, opts.player.race, null, playAsPirate);
    let num2 = resolveGovernmentId(galaxy, opts.player.governmentStyle ?? RANDOM, race);
    let gov = governmentById(num2);
    if (gov !== null && gov.specialFunctionCode === 1 && (opts.player.governmentStyle ?? RANDOM) === RANDOM && race.preferredStartingGovernment !== num2) {
        let num3 = 0;
        while (gov !== null && gov.specialFunctionCode === 1 && num3 < 10) {
            num2 = resolveGovernmentId(galaxy, RANDOM, race);
            gov = governmentById(num2);
            num3++;
        }
    }
    let designPictureFamilyIndex = race.designsPictureFamilyIndex;
    if ((opts.player.designPictureFamilyIndex ?? -1) >= 0) designPictureFamilyIndex = opts.player.designPictureFamilyIndex!;
    let empire2: Empire;
    let habitat: Habitat;
    let playerExpansion = 0.0;
    if (playAsPirate) {
        // Start.2.cs 567-729: pirate player base near a fuel source close to independent colonies.
        let habitat2: Habitat | null = null;
        let num4 = 0;
        let num5 = 0.0;
        let num6 = 0.0;
        const fuelId = galaxy.resourceSystem.fuelResources[0].resourceId;
        while (habitat2 === null) {
            const p = playerStartPoint(galaxy, opts.shape, opts.player.startLocation ?? RANDOM, race, 1.0);
            habitat2 = galaxy.findNearestHabitatWithResource(p.x + num5, p.y + num6, fuelId);
            // C# derefs habitat2 here (DetermineGalaxyLocationsAtPoint(habitat2.Xpos, …)).
            if (inNebula(galaxy, habitat2!)) habitat2 = null;
            if (habitat2 !== null) {
                for (const h3 of independentColonies) {
                    if (h3.systemIndex === habitat2.systemIndex) {
                        habitat2 = null;
                        break;
                    }
                }
            }
            if (habitat2 !== null && !checkNearIndependentColony(galaxy, independentColonies, habitat2.xpos, habitat2.ypos, 2000000.0)) habitat2 = null;
            num4++;
            if (num4 > 50) {
                num4 = 0;
                const num7 = 3000000.0;
                num5 = num7 - galaxy.rnd.nextDouble() * num7 * 2.0;
                num6 = num7 - galaxy.rnd.nextDouble() * num7 * 2.0;
            }
        }
        designPictureFamilyIndex = raceDesignPictureFamilyIndexPirates(race);
        if ((opts.player.designPictureFamilyIndex ?? -1) >= 0) designPictureFamilyIndex = opts.player.designPictureFamilyIndex!;
        const pt = galaxy.selectRelativeHabitatSurfacePoint(habitat2);
        const style = opts.player.piratePlayStyle ?? PiratePlayStyle.Balanced;
        galaxy.allowRaceStartingCharacters = true; // Start.2.cs 706
        empire2 = generatePirateEmpire(
            galaxy,
            { independentColonies, startingAge: galaxy.startingAge, difficultyLevel: opts.difficultyLevel ?? 1.0 },
            habitat2,
            Math.trunc(pt.x),
            Math.trunc(pt.y),
            race,
            designPictureFamilyIndex,
            opts.player.techLevel,
            style,
            true,
            false,
        );
        if (opts.player.name) empire2.name = opts.player.name;
        empire2.piratePlayStyle = style;
        habitat = habitat2;
        galaxy.allowRaceStartingCharacters = false; // Start.2.cs 717
        const h4 = fastFindNearestIndependentHabitat(galaxy, independentColonies, habitat2.xpos, habitat2.ypos);
        if (h4 !== null && !empire2.visibility.checkSystemExplored(h4.systemIndex)) {
            const star = galaxy.determineHabitatSystemStar(h4);
            empire2.visibility.setSystemVisibility(star, SystemVisibilityStatus.Explored);
            empire2.resourceMap.setResourcesKnown(galaxy.systems[star.systemIndex].systemStar, true);
            for (const h of galaxy.systemHabitatsOf(star.systemIndex)) empire2.resourceMap.setResourcesKnown(h, true);
        }
    } else {
        // Player capital (non-pirate branch).
        const { homeSystemFactor } = Galaxy.resolveHomeSystem(opts.player.homeSystemFavourability);
        const capitalHabitatType = race.nativeHabitatType;
        let found: Habitat | null = null;
        let num10 = 0;
        let num11 = 0.0;
        let num12 = 0.0;
        while (found === null) {
            const p = playerStartPoint(galaxy, opts.shape, opts.player.startLocation ?? RANDOM, race);
            found = galaxy.findNearestUncolonizedHabitat(p.x + num11, p.y + num12, capitalHabitatType);
            if (found !== null && inNebula(galaxy, found)) found = null;
            num10++;
            if (num10 > 50) {
                const num13 = num10 > 1000 ? 5000000.0 : 3000000.0;
                num11 = num13 - galaxy.rnd.nextDouble() * num13 * 2.0;
                num12 = num13 - galaxy.rnd.nextDouble() * num13 * 2.0;
            }
        }
        habitat = found;
        const player = generateEmpire(galaxy, true, opts.player.name ?? '', habitat, race, designPictureFamilyIndex, num2, homeSystemFactor, opts.player.homeSystemFavourability, opts.player.age, opts.player.techLevel, opts.player.corruptionMultiplier ?? 1.0, galaxy.storyShadowsEnabled);
        empire2 = player.empire;
        playerExpansion = player.expansion;
        if (opts.player.age === 0) clearIndependentColoniesFromSystem(galaxy, independentColonies, habitat.systemIndex);
        galaxy.playerEmpire = empire2;
        setEmpireDifficultyFactors(galaxy, empire2, opts.difficultyLevel ?? 1.0);
        // TODO(port): empire flag (Galaxy.GenerateEmpireFlag uses a clock-seeded Random).
    }
    galaxy.playerEmpire = empire2;
    const viewX = habitat.xpos;
    const viewY = habitat.ypos;
    galaxy.updateSystemInfo();

    // AI empires.
    // Start.2.cs 898: a pirate player is not part of the normal empire lists.
    const empireList: Empire[] = playAsPirate ? [] : [empire2];
    const list3: number[] = playAsPirate ? [] : [playerExpansion];
    const list6: number[] = playAsPirate ? [] : [opts.player.age];
    // empireStartList2[i].TechLevel, parallel to empireList.
    const listTech: number[] = playAsPirate ? [] : [opts.player.techLevel];
    const num14 = aiStarts.length;
    updateEmpireStarts(aiStarts, normalRaces, clockRnd, race.name);
    for (let num15 = 0; num15 < num14; num15++) {
        const es = aiStarts[num15];
        const aiRace = es.resolvedRace === null ? selectRace(galaxy, es.opts.race, empireList, false) : selectRace(galaxy, es.resolvedRace.name, empireList, false);
        let aiGov: Government | null;
        if ((es.opts.governmentStyle ?? RANDOM) === RANDOM) {
            const allowable = Empire.resolveDefaultAllowableGovernmentTypes(aiRace);
            const suitable = determineMostSuitableGovernmentTypes(aiRace, allowable);
            aiGov = null;
            if (suitable.length > 0) {
                aiGov = suitable[galaxy.rnd.next(0, suitable.length)];
                if (aiGov.specialFunctionCode === 1) {
                    let n = 0;
                    while (aiGov !== null && aiGov.specialFunctionCode === 1 && n < 10) {
                        // C# quirk: re-resolves from the *player's* GovernmentStyle.
                        num2 = resolveGovernmentId(galaxy, opts.player.governmentStyle ?? RANDOM, aiRace);
                        aiGov = governmentById(num2);
                        n++;
                    }
                }
                if (aiRace.preferredStartingGovernment >= 0 && allowable.includes(aiRace.preferredStartingGovernment)) aiGov = governmentById(aiRace.preferredStartingGovernment);
            }
        } else {
            aiGov = govs.find((g) => g !== null && g.name === es.opts.governmentStyle) ?? null;
        }
        num2 = aiGov?.governmentId ?? num2;
        const prox = es.opts.proximityDistance ?? RANDOM;
        const { sector } = proximityDistance(galaxy, prox);
        galaxy.rnd.nextDouble();
        const home = Galaxy.resolveHomeSystem(es.opts.homeSystemFavourability);
        const cap = findAiCapital(galaxy, aiRace, prox, habitat, aiRace.nativeHabitatType, playAsPirate, num14 + 1, sector);
        if (cap === null) throw new Error('Could not locate capital!');
        let dpfi = es.opts.designPictureFamilyIndex ?? -1;
        if (dpfi < 0) dpfi = aiRace.designsPictureFamilyIndex;
        const r = generateEmpire(galaxy, false, es.opts.name ?? '', cap, aiRace, dpfi, num2, home.homeSystemFactor, es.opts.homeSystemFavourability, es.opts.age, es.opts.techLevel, es.opts.corruptionMultiplier ?? 1.0, galaxy.storyShadowsEnabled);
        if (es.opts.age === 0) clearIndependentColoniesFromSystem(galaxy, independentColonies, cap.systemIndex);
        empireList.push(r.empire);
        list3.push(r.expansion);
        list6.push(es.opts.age);
        listTech.push(es.opts.techLevel);
    }

    // Starting colonies (CreateGameFromSettings, "num15 >= num14" branch).
    let num16 = 0;
    for (const v of list3) num16 += Math.trunc(v);
    const allowable = allowableMaximumStartingColonies(galaxy);
    if (num16 > allowable) {
        const num18 = allowable / num16;
        for (let k = 0; k < list3.length; k++) list3[k] *= num18;
    }
    num16 = 0;
    const list4: number[] = [];
    const list5: number[] = [];
    for (const v of list3) {
        const num20 = Math.max(0, Math.trunc(v) - 1);
        list4.push(num20);
        list5.push(num20);
        num16 += num20;
    }
    const list7 = [HabitatType.BarrenRock, HabitatType.Ice, HabitatType.Volcanic, HabitatType.Desert];
    const list8: number[] = [];
    let num21 = 0;
    while (num21 < num16) {
        for (let l = 0; l < empireList.length; l++) {
            if (list4[l] > 0) {
                list8.push(empireList[l].empireId);
                list4[l]--;
                num21++;
            }
        }
    }
    const list9: number[] = [];
    const list10: Habitat[][] = [];
    for (let m = 0; m < empireList.length; m++) {
        galaxy.updateSystemInfo();
        const capital = empireList[m].capital!;
        list10.push([galaxy.determineHabitatSystemStar(capital)]);
        const num22 = num16 > 0 ? list5[m] / num16 : 0;
        list9.push(1400000000.0 / galaxy.starCount + num22 * 1.0 * galaxy.sizeX);
    }
    galaxy.empireTerritory.reviewEmpireTerritory(galaxy);
    for (let n = 0; n < list8.length; n++) {
        const e = empireList.find((x) => x.empireId === list8[n])!;
        let num23 = e.empireId - 1;
        if (playAsPirate) num23--; // Start.2.cs 989
        let num24 = list9[num23];
        galaxy.updateSystemInfo();
        // Start.2.cs 996: habitat5 = !bool_6 ? FindNearestColonizableHabitatUnoccupiedSystem(...) : FindNearestColonizableHabitat(...).
        let h5: Habitat | null = !(opts.allowEmpiresInSameSystem ?? false)
            ? galaxy.findNearestColonizableHabitatUnoccupiedSystem(e.capital!.xpos, e.capital!.ypos, e)
            : galaxy.findNearestColonizableHabitat(e.capital!.xpos, e.capital!.ypos, e);
        // Start.2.cs 998-1001: num25 = habitat5 != null ? distance : double.MaxValue.
        let num25 = h5 !== null ? galaxy.calculateDistance(e.capital!.xpos, e.capital!.ypos, h5.xpos, h5.ypos) : Number.MAX_VALUE;
        if (num25 > num24) {
            let num26 = 0;
            while (num25 > num24) {
                h5 = null;
                let num27 = 0;
                while (h5 === null) {
                    const p = offsetWithin(galaxy, galaxy.selectRandomHeading(), e.capital!.xpos, e.capital!.ypos, num24);
                    h5 = galaxy.fastFindNearestPlanetMoonOfTypesUnoccupiedSystem(p.x, p.y, e, list7);
                    if (h5 !== null) {
                        if (h5.category === HabitatCategoryType.Moon && h5.parent!.type !== HabitatType.GasGiant) h5 = null;
                        else if (h5.category === HabitatCategoryType.Planet && (h5.orbitDistance < 4500 || h5.orbitDistance > 11000)) h5 = null;
                    }
                    num27++;
                    if (num27 > 50) {
                        num24 *= 1.2;
                        num27 = 0;
                    }
                }
                num25 = galaxy.calculateDistance(e.capital!.xpos, e.capital!.ypos, h5.xpos, h5.ypos);
                num26++;
                if (num26 > 50) {
                    num24 *= 1.2;
                    num26 = 0;
                }
            }
            const list11 = e.colonizableHabitatTypesForEmpire();
            list11.push(e.dominantRace!.nativeHabitatType);
            const pick = list11[galaxy.rnd.next(0, list11.length)];
            const sel = galaxy.selectPlanetOfType(pick);
            h5!.type = sel.type;
            h5!.diameter = sel.diameter;
            h5!.pictureRef = sel.pictureRef;
            h5!.landscapePictureRef = sel.landscapePictureRef;
            h5!.baseQuality = galaxy.selectHabitatQuality(h5!, galaxy.colonyPrevalence);
            h5!.resources = [];
            galaxy.selectResources(h5!);
        }
        if (h5 !== null) {
            const star = galaxy.determineHabitatSystemStar(h5);
            if (!list10[num23].includes(star)) list10[num23].push(star);
            makeHabitatIntoColony(galaxy, h5, e, list6[num23], e.dominantRace!, 1.0, false);
            const i = independentColonies.indexOf(h5);
            if (i >= 0) independentColonies.splice(i, 1);
            galaxy.empireTerritory.reviewEmpireTerritoryUpdate(galaxy, { x: Math.trunc(h5.xpos) - 1600000, y: Math.trunc(h5.ypos) - 1600000, w: 3200000, h: 3200000 });
        }
    }
    galaxy.updateSystemInfo();
    independentColonies = reviewIndependentColonies(galaxy);
    // Test-only seam (CreateGameOptions.__phaseHook): no effect on the game when unset.
    const phaseHook = opts.__phaseHook;
    const result = (): Game => ({ galaxy, playerEmpire: empire2, viewX, viewY });
    const stopAt = (phase: GameStartPhase, e?: Empire): boolean => phaseHook !== undefined && phaseHook(phase, galaxy, e) === 'stop';
    if (stopAt('startingColonies')) return result();
    const pirateCtx = () => ({ independentColonies: galaxy.independentColonies, startingAge: galaxy.startingAge, difficultyLevel: galaxy.difficultyLevel });
    const piratePrevalence = opts.piratePrevalence ?? 0;
    const pirateSettings = {
        piratePrevalence,
        pirateProximity: opts.pirateProximity ?? 0,
        maximumEmpireAmount: opts.maximumEmpireAmount ?? 1 + opts.aiEmpires.length, // TODO(port): not C# — see CreateGameOptions.maximumEmpireAmount
    };

    // Start.2.cs 1099-1104.
    galaxy.empireTerritory.reviewEmpireTerritory(galaxy); // ReviewEmpireTerritoryCore(false)
    galaxy.updateSystemInfo();
    for (let num28 = 0; num28 < 20; num28++) {
        reviewResourcePrices(galaxy);
        reviewComponentPrices(galaxy);
    }
    if (stopAt('priceReviews')) return result();
    // Start.2.cs 1108-1110: ResetLastTouchTimes + Galaxy.DoTasks(false, player) — on this first tick the huge
    // block runs, then the long block (independent traders, GenerateNewPirateEmpires) — then DeferEventsForGameStart.
    galaxy.independentColonies = independentColonies;
    galaxy.gameDisasterEventsEnabled = opts.disasterEventsEnabled ?? true;
    // Start.2.cs 496 / 501-506 (M4z4): DifficultyLevelScalesAsPlayerApproachesVictory and the Galaxy switches taken from
    // victoryConditions_0 — only when the caller passes the conditions (else the fields keep their defaults).
    galaxy.difficultyLevelScalesAsPlayerApproachesVictory = opts.difficultyLevelScalesAsPlayerApproachesVictory ?? false;
    if (opts.victoryConditions !== undefined && opts.victoryConditions !== null) applyVictoryConditionsToGalaxy(galaxy, opts.victoryConditions);
    galaxy.pirateProximity = pirateSettings.pirateProximity;
    // Start.2.cs 498 galaxy.PirateShipMaintenanceFactor = empireStart_0.PirateShipMaintenanceFactor.
    galaxy.pirateShipMaintenanceFactor = opts.pirateShipMaintenanceFactor ?? 0.4;
    galaxy.maximumEmpireAmount = pirateSettings.maximumEmpireAmount;
    let stoppedAtHuge = false;
    runGameStartGalaxyTick(galaxy, galaxy.playerEmpire, () => (stoppedAtHuge = stopAt('firstGalaxyTick:huge')));
    if (stoppedAtHuge) return result();
    galaxy.deferEventsForGameStart = true;
    if (stopAt('firstGalaxyTick')) return result();

    // Start.2.cs 1108-1350: per-empire setup.
    const int5 = galaxy.age; // int_5
    let bool6 = opts.allowEmpiresInSameSystem ?? false;
    for (let num29 = 0; num29 < empireList.length; num29++) {
        const empire3 = empireList[num29];
        const tech = listTech[num29];
        if (stopAt('empire:start', empire3)) return result();
        gameStartColonyRecalc(galaxy, empire3); // 1110-1113
        if (stopAt('empire:colonyRecalc', empire3)) return result();
        // 1114-1121 touch times (int_5 > 0): the second DoTasks below runs its blocks only then.
        if (int5 > 0) resetEmpireTouchTimesForAge(galaxy, empire3);
        // 1122-1137: PreWarpProgressEventOccurredSendPirateRaid = true always (Empire.preWarpProgressEventOccurredSendPirateRaid,
        // M4s); all 13 flags when tech > 0 (the combined TS flag).
        empire3.preWarpProgressEventOccurredSendPirateRaid = true;
        if (tech > 0.0) empire3.preWarpProgressEventsOccurred = true;
        if (tech > 0.0) {
            // 1139-1146
            const newSpacePortAmount = 1 + Math.trunc(empire3.colonies.length / 4.5);
            const habitatList = determineNewSpacePortLocations(galaxy, empire3, empire3.colonies, newSpacePortAmount, false);
            createSpacePorts(galaxy, empire3, habitatList);
            if (stopAt('empire:spacePorts', empire3)) return result();
            for (const item7 of habitatList) setColonyResources(galaxy, item7, empire3, true);
            if (stopAt('empire:portColonyResources', empire3)) return result();
        }
        checkColoniesForBaseFacilities(empire3); // 1147
        if (stopAt('empire:baseFacilities', empire3)) return result();
        applyResearchBonusGasGiant(galaxy, empire3); // 1156-1173
        if (stopAt('empire:gasGiantBonus', empire3)) return result();
        ensureImportantPreWarpResources(galaxy, empire3, tech); // 1174-1273
        if (stopAt('empire:preWarpResources', empire3)) return result();
        placeRuinsUnlockTech(galaxy, empire3, tech); // 1274-1304
        if (stopAt('empire:unlockTechRuin', empire3)) return result();
        determineResearchStationLocation(galaxy, empire3, false, true); // 1307
        if (stopAt('empire:researchLocations', empire3)) return result();
        if (tech > 0.0) createResearchStations(galaxy, empire3, bool6); // 1308-1311
        if (stopAt('empire:researchStations', empire3)) return result();
        bool6 = false; // 1313
        if (tech > 0.0) createMiningStations(galaxy, empire3, bool6); // 1314-1317
        if (stopAt('empire:miningStations', empire3)) return result();
        setLuxuryResourcesAtColonies(galaxy, empire3); // 1318
        if (stopAt('empire:luxury', empire3)) return result();
        empire3.initiateConstruction = false;
        gameStartReviewTaxes(galaxy, empire3, int5); // 1320-1339 (incl. ProcessColonyTroops when int_5 > 0)
        if (stopAt('empire:taxes', empire3)) return result();
        empire3.buildFactor = 0.5 + Math.min(0.2, empire3.colonies.length / 20.0); // 1340
        // 1341 empire3.DoTasks(): with the touch times reset (int_5 > 0) its blocks run; otherwise they
        // already ran this game second (GenerateEmpire) and are skipped.
        runGameStartEmpireTick(galaxy, empire3);
        empire3.buildFactor = 1.0;
        empire3.initiateConstruction = true;
        const seconds = galaxy.rnd.next(1, 120); // 1344 Rnd.Next(1, (int)LongProcessingInterval) (Empire.cs 184: 120 s)
        staggerEmpireTouchTimes(galaxy, empire3, seconds); // 1345-1350
        if (stopAt('empire:doTasks', empire3)) return result();
    }
    if (stopAt('empireSetup')) return result();
    // TODO(port): 1354-1364 attack ranges from GameOptions (no Rnd).
    // Start.2.cs 1365-1375: starting ships.
    for (let num35 = 0; num35 < empireList.length; num35++) {
        const empire4 = empireList[num35];
        if (listTech[num35] > 0.0) {
            if (stopAt('ships:start', empire4)) return result();
            createStateShips(galaxy, empire4);
            if (stopAt('ships:state', empire4)) return result();
            createPrivateShips(galaxy, empire4);
            if (stopAt('ships:private', empire4)) return result();
            fillShipsWithTroops(galaxy, empire4);
            if (stopAt('ships:troops', empire4)) return result();
            assignMissionsToBuiltObjectList(galaxy, empire4, empire4.builtObjects, false, null);
            assignMissionsToBuiltObjectList(galaxy, empire4, empire4.privateBuiltObjects, false, null);
            if (stopAt('ships:missions', empire4)) return result();
        }
    }
    if (stopAt('startingShips')) return result();
    meetEmpiresAtStart(galaxy, empireList); // 1376-1420
    if (empire2.pirateEmpireBaseHabitat !== null) {
        meetPiratesAtStart(galaxy, empire2); // 1421-1471
        empire2.colonizationTargets = pirateReviewColoniesToControl(galaxy, empire2, galaxy.independentColonies); // 1472
    }
    if (stopAt('diplomacy')) return result();
    // 1474-1482: starting characters.
    galaxy.allowRaceStartingCharacters = true;
    for (const e of empireList) if (e.dominantRace !== null) generateStartingCharacters(galaxy, e);
    if (stopAt('characters')) return result();
    // 1484 galaxy.DoTasks: no touch interval has elapsed since the first tick (same game time),
    // so nothing time-gated runs. TODO(port): its per-call (non-interval) work.
    galaxy.empireTerritory.reviewEmpireTerritory(galaxy); // 1485
    galaxy.updateSystemInfo(); // 1486
    if (stopAt('territoryReview')) return result();
    // 1493-1533: one more pirate faction near the player.
    if (piratePrevalence > 0.0 && (opts.pirateProximity ?? 0) === 0 && !playAsPirate) {
        spawnPirateNearPlayer(galaxy, pirateCtx(), viewX, viewY);
    }
    if (stopAt('nearPlayerPirate')) return result();
    // 1534-1565: ruins.
    placeStartRuins(galaxy);
    if (stopAt('startRuins')) return result();
    clearRuinBonusesForAge(galaxy);
    if (stopAt('ruins')) return result();
    const tailResult = gameStartTail(galaxy, { playerEmpire: empire2, empireList, playerTechLevel: opts.player.techLevel, playerAge: opts.player.age, playAsPirate, raceFamilies: gd.raceFamilies, xpos: viewX, ypos: viewY, enableStoryEventsShadows: galaxy.storyShadowsEnabled });
    // Start.2.cs 2031-2034 (Shadows story): a non-pirate age-of-shadows player gets its first pirate raid.
    if (tailResult.clearPreWarpSendPirateRaid) empire2.preWarpProgressEventOccurredSendPirateRaid = false;
    // Start.2.cs 2026: galaxy.GlobalVictoryConditions = victoryConditions_0 (2118-2120 also hand them to the Game object;
    // the TS keeps the Game's copies on the Galaxy: PlayerVictoryConditionsToAchieve / ToPrevent are scenario-only, null).
    galaxy.globalVictoryConditions = opts.victoryConditions ?? null;
    // 17d: Start.2.cs 2122-2146 — the human player's automation settings come from GameOptions (the defaults of
    // Main.Part9.cs method_260 when no options file exists); AI empires keep the ctor's FullyAutomated.
    applyStartAutomationSettings(empire2, DEFAULT_GAME_OPTIONS_AUTOMATION);
    // TODO(port): the rest of CreateGameFromSettings (see header).
    // Main.Part12.cs 3151 BaconMain.BaconInitialize(this) once Main starts the new game: BaconSettings.txt overrides
    // (baconSettings.ts; the settings part only).
    baconInitializeSettings(STOCK_BACON_SETTINGS); // TODO(port): the loaded BaconSettings.txt (dataload)
    stopAt('tail');
    return result();
}
