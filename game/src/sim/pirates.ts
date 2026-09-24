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
// Not ported (no designs / BuiltObjects yet): the pirate base (SmallSpacePort),
// escorts, explorer, freighters, mining stations, starting characters and flags
// (flag shapes use a clock-seeded Random, so skipping them costs no Rnd).
// With no designs, FindNewestCanBuild(SmallSpacePort) is null and C# skips the
// whole base block, including its Rnd draws, so the stream is unaffected.
// TODO(port): play-as-pirate player start (Start.2.cs ~560-730), super pirates.

import type { Galaxy } from './galaxy';
import type { Habitat } from './types';
import type { Race } from './data/races';
import { Empire } from './empire';
import { netSort } from './netSort';
import { createNewDesigns } from './designGeneration';
import { startStarDateForAge } from './galaxyTime';
import { loadEmpirePolicy } from './researchSystem';
import { SystemVisibilityStatus } from './visibility';
import { BuiltObjectSubRole } from './builtObjectTypes';
import { BuiltObjectRole } from './data/designSpecifications';

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

// Galaxy.cs SetEmpireDifficultyFactors (non-player branch for AI; victory-scaling
// branch TODO) + BaconGalaxy.SetEmpireDifficultyFactors. All *Default constants are 1.0
// (Galaxy.3.cs 5129-5137).
export function setEmpireDifficultyFactors(galaxy: Galaxy, empire: Empire, galaxyDifficultyLevel: number): void {
    if (empire === galaxy.playerEmpire) {
        empire.difficultyLevel = galaxyDifficultyLevel + empire.difficultyLevelModifier;
        // TODO(port): DifficultyLevelScalesAsPlayerApproachesVictory.
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
// Note: the pirate base itself is still TODO (generatePirateEmpire), so until it is ported
// no faction qualifies and this returns null — as it did before.
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

// Empire.1.cs PirateReviewColoniesToControl + PirateCheckControlColony (no Rnd).
// Pirate colony control records and CurrentDefensiveForceAssigned are not ported (none / 0).
export function pirateReviewColoniesToControl(galaxy: Galaxy, empire: Empire, independentColonies: Habitat[]): { habitat: Habitat; priority: number }[] {
    const toControl: { habitat: Habitat; priority: number }[] = [];
    const controlled: Habitat[] = [];
    for (const h of empire.colonies) if (h.empire === empire && !controlled.includes(h)) controlled.push(h);
    const base = empire.pirateEmpireBaseHabitat;
    if (base !== null) {
        const check = (colony: Habitat) => {
            if (colony.population.totalAmount <= 0 || (colony.empire !== null && colony.empire.reclusive)) return;
            if (colony.empire === empire) {
                if (!controlled.includes(colony)) controlled.push(colony);
                return;
            }
            if (!empire.visibility.checkSystemExplored(colony.systemIndex)) return;
            let flag = false;
            const num = 0.0; // CurrentDefensiveForceAssigned
            if (colony.empire === galaxy.independentEmpire) flag = true;
            else if (colony.empire !== null && colony.population.totalAmount < 2000000000) flag = true;
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
        for (const c of independentColonies) check(c);
        for (const e of galaxy.empires) if (e.active) for (const c of e.colonies) check(c);
        netSort(toControl, (a, b) => (a.priority < b.priority ? -1 : a.priority > b.priority ? 1 : 0));
        toControl.reverse();
        empire.colonies = controlled;
    }
    return toControl;
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
    void offsetX;
    void offsetY; // pirate base position (AddBuiltObjectToGalaxy) — no base without designs
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
    empire.research.update();
    empire.reviewResearchAbilities();
    empire.reviewDesignsBuiltObjectsImprovedComponents();
    empire.pirateEmpireBaseHabitat = habitat;
    empire.generateDesignSpecifications(galaxy, empire.dominantRace, true, empire.dominantRace?.name ?? null);
    // Galaxy.8.cs 4622: empire.CreateNewDesigns(CurrentStarDate).
    const starDate = startStarDateForAge(galaxy.age);
    createNewDesigns(galaxy, empire, starDate, starDate);
    // TODO(port): pirate base + fleet + mining stations (Galaxy.8.cs 4623-4820). With designs
    // ported, FindNewestCanBuild(SmallSpacePort) now finds a design, so C# would enter this
    // block (BuiltObjects, SelectRandomHeading, ship names — all Rnd draws). It needs the
    // BuiltObject model (M3 starting ships); until then it is skipped, so the Rnd stream after
    // the first pirate differs from C# (already past the Empire.DoTasks parity point).
    // GenerateStartingCharacters also TODO.
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

// Galaxy.9.cs GenerateNewPirateEmpires (game-start: DestroyedPiratesDoNotRespawn is
// irrelevant because CurrentStarDate - StartStarDate <= 300000).
export function generateNewPirateEmpires(galaxy: Galaxy, ctx: PirateGenerationContext, settings: PirateSettings): void {
    const num = Math.trunc(2.0 * settings.piratePrevalence * settings.maximumEmpireAmount);
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
                        if (!flag2) flag = true;
                    }
                }
            }
            num7++;
        }
        if (flag && galaxy.nextEmpireId < galaxy.maximumEmpireCount) {
            const pt = galaxy.selectRelativeHabitatSurfacePoint(habitat);
            generatePirateEmpireRandom(galaxy, ctx, habitat!, Math.trunc(pt.x), Math.trunc(pt.y), true);
        }
    }
}
