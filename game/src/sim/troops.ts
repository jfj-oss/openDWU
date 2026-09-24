// Game-start troops (garrisons, recruitment, maintenance). Ports of
//   Habitat.cs  StrategicValue (309, via territory.ts), TroopLevelRequired (318),
//               TroopLevelMinimum (362), RecalculateEstimatedDefensiveForceRequired (5484),
//               EstimatedDefensiveForceRequired(atWar) (5523), ResolveInvasionEmpires (3229),
//               CheckTroopFacilitiesPresent (6791), GenerateNewTroop(...) overloads (7006-7112);
//   Galaxy.8.cs MakeHabitatIntoColony troop block (685-696);
//   Galaxy.7.cs GenerateEmpire capital-garrison block (5292-5316),
//               CalculateDefaultTroopMaintenanceMultiplier (5505);
//   Galaxy.2.cs ChanceNewTroopGeneralFromRecruitment (5219);
//   Empire.cs   AnnualTroopMaintenance (2025), AnnualTroopMaintenanceIncludeRecruiting (2070),
//               MinimumShipSpending (2203);
//   Empire.4.cs ProcessColonyTroops (3463 / 3469), ReviewColonyTroopGarrison (3753 / 3805),
//               IdentifyStrongestRaceAttackTroop (4014 / 4019), CalculateCostPerTroop (1594);
//   Empire.6.cs MaximumCharactersAllowedNonIntelligenceAgent (3966),
//               CharactersCanGenerateAmountNonIntelligenceAgent (3976);
//   BaconEmpire.cs MultiplyTroopRecruitment (27).
// Galaxy.8.cs GenerateNewTroop (20) and Galaxy.4.cs CalculateTroopMaintenanceMultiplier
// (224) live in builtObjectPlacement.ts and are re-exported here.
//
// Galaxy.Rnd use (exact):
//   generateColonyStartingTroops  — 1 × NextDouble (Galaxy.8.cs 686), always.
//   generateCapitalStartingTroops — 1 × NextDouble (Galaxy.7.cs 5297), always.
//   processColonyTroops           — 1 × Next(0, num) per troop whose recruitment completes
//                                   (ChanceNewTroopGeneralFromRecruitment, Galaxy.2.cs 5228);
//                                   num = max(2, (int)(70 / race.CharacterRandomAppearanceChanceGeneral)).
//                                   A roll of 1 with room for characters calls
//                                   Empire.GenerateNewCharacter (more Rnd) → registerTroopGeneralHook.
//   everything else               — no Rnd.
//
// Unported subsystems (game-start values used; see TODO(port) below):
//   Galaxy.DifficultyLevel is not on the TS Galaxy → passed explicitly (`difficultyLevel`).
//   Empire.Leader / Habitat.Characters / Habitat.InvadingCharacters: read through characters.ts
//   (none before Start.2.cs 1483, where the starting characters are generated).
//   Galaxy.GlobalVictoryConditions: null (no DefendHabitat / TargetHabitat).
//   Empire.PenalColonies: empty. Empire.Capitals: only Capital at game start.
//   Habitat.RaceEventType: Undefined. Habitat.DefensiveFortressBonus: 0. Facilities: none.

import { Troop, TroopList, TroopType } from './cargo';
import { calculateTroopMaintenanceMultiplier, generateNewTroop } from './builtObjectPlacement';
import { BuiltObjectSubRole } from './builtObjectTypes';
import type { Race } from './data/races';
import { ColonyResourceEffect, resourceBonusTotalByEffectType } from './developmentLevel';
import { COLONY_MAXIMUM_TROOP_STRENGTH, Empire, empireGovernmentAttributes } from './empire';
import {
    ALLOWABLE_YEARS_MAINTENANCE_FROM_CASH_ON_HAND,
    TROOP_ANNUAL_MAINTENANCE,
    annualFacilityMaintenance,
    annualPirateProtection,
    annualStateMaintenance,
    annualSubjugationTribute,
    calculateAccurateAnnualIncome,
    totalColonyStrategicValue,
} from './forceStructure';
import type { Galaxy } from './galaxy';
import { empireApprovalRating } from './taxes';
import { strategicValue } from './territory';
import type { Habitat } from './types';
import type { BuiltObject } from './builtObject';
import {
    CharacterEventType,
    CharacterRole,
    CharacterSkillType,
    countCharactersByRole,
    doCharacterEventForList,
    empireLeader as characterEmpireLeader,
    getEmpireCharacters,
    getHighestSkillLevelExcludeLeaders,
    habitatInvadingCharacterList,
    resolveLeaderTroopMaintenanceFactor,
    resolveTroopLocationMaintenanceDivisor,
    stellarObjectCharacters,
    type Character,
} from './characters';

export { calculateTroopMaintenanceMultiplier, generateNewTroop };

// Galaxy.3.cs 5104 SpendingShipPercentage.
export const SPENDING_SHIP_PERCENTAGE = 0.5;
// BaconEmpire.cs 20 myStrengthMultipler.
const BACON_ROMULAN_TROOP_RECRUITMENT_MULTIPLIER = 3.0;

const f32 = Math.fround;

// C# (int)double on .NET Framework x86/x64 (cvttsd2si): NaN / out-of-range → int.MinValue.
function csDoubleToInt(v: number): number {
    if (!Number.isFinite(v) || v >= 2147483648 || v <= -2147483649) return -2147483648;
    return Math.trunc(v);
}

// Galaxy.7.cs ConditionCheckLimit(condition, maximumIterations, ref iterationCount) (569).
function conditionCheckLimit(condition: boolean, maximumIterations: number, iterationCount: { value: number }): boolean {
    if (iterationCount.value >= maximumIterations) return false;
    iterationCount.value++;
    return condition;
}

// ---------------------------------------------------------------------------
// Unported-subsystem accessors (game-start values). They throw when a later port
// adds the data, so the missing C# branch cannot be silently skipped.
// ---------------------------------------------------------------------------

// Empire.Leader (Empire.cs 866) — characters.ts.
function empireLeader(empire: Empire): Character | null {
    return characterEmpireLeader(empire);
}

// StellarObject.Characters (Habitat.Characters) — characters.ts keeps them; null when never assigned.
function colonyCharacters(colony: Habitat): Character[] | null {
    return stellarObjectCharacters(colony);
}

// Habitat.cs CheckTroopFacilitiesPresent (6791). TODO(port): PlanetaryFacility model —
// no facilities at game start (result false).
export function checkTroopFacilitiesPresent(colony: Habitat): boolean {
    const result = false;
    if (colony.facilities !== null && colony.facilities.length > 0) {
        throw new Error('TODO(port): PlanetaryFacility model (Habitat.CheckTroopFacilitiesPresent)');
    }
    return result;
}

// TODO(port): Habitat.DefensiveFortressBonus (byte, set by ReviewPlanetaryFacilities from a
// FortifiedBunker) — 0 at game start (no facilities).
function defensiveFortressBonus(colony: Habitat): number {
    if (colony.facilities !== null && colony.facilities.length > 0) {
        throw new Error('TODO(port): PlanetaryFacility model (Habitat.DefensiveFortressBonus)');
    }
    return 0;
}

// Race.cs TroopRegenerationFactor (224, default 1.0; LoadFromFile 1591 clamps to [0.2, 5]).
export function raceTroopRegenerationFactor(race: Race): number {
    const raw = race.extra?.['TroopRegenerationFactor'];
    if (raw === undefined) return 1.0;
    return Math.min(5.0, Math.max(0.2, Number(raw.trim())));
}

// Race.cs CharacterRandomAppearanceChanceGeneral (154, default 1.0; LoadFromFile 1441 clamps to [0, 5]).
export function raceCharacterRandomAppearanceChanceGeneral(race: Race): number {
    const raw = race.extra?.['CharacterRandomAppearanceChanceGeneral'];
    if (raw === undefined) return 1.0;
    return Math.min(5.0, Math.max(0.0, Number(raw.trim())));
}

// Race.cs LoadFromFile 1063-1074: an empty TroopNameArmored / TroopNameArtillery /
// TroopNameSpecialForces falls back to TroopName (races.ts keeps the raw file values).
function raceTroopNameFallback(race: Race, name: string): string {
    if (race.troopName !== '' && name === '') return race.troopName;
    return name;
}

// BaconEmpire.cs MultiplyTroopRecruitment (27).
export function baconMultiplyTroopRecruitment(empire: Empire | null): number {
    let num = 1.0;
    if (empire !== null && empire.name.includes('Romulan')) num = BACON_ROMULAN_TROOP_RECRUITMENT_MULTIPLIER;
    return num;
}

// ---------------------------------------------------------------------------
// Habitat defence requirements
// ---------------------------------------------------------------------------

// Habitat.cs RecalculateEstimatedDefensiveForceRequired (5484) + EstimatedDefensiveForceRequired
// (5523). Returns int. No Rnd. `difficultyLevel` is Galaxy.DifficultyLevel.
export function estimatedDefensiveForceRequired(galaxy: Galaxy, habitat: Habitat, atWar: boolean, difficultyLevel: number): number {
    const sv = strategicValue(habitat);
    let num = 0.0;
    const owner = habitat.owner;
    if (owner !== null && owner !== galaxy.independentEmpire) {
        num = Math.pow(owner.dominantRace!.caution / 100.0, 2.0);
    } else if (owner === galaxy.independentEmpire && habitat.population != null && habitat.population.dominantRace != null) {
        num = Math.pow(habitat.population.dominantRace.caution / 100.0, 2.0);
    }
    let num2 = 750.0;
    if (owner !== galaxy.playerEmpire && difficultyLevel > 1.0) {
        num2 /= Math.sqrt(difficultyLevel);
    }
    let result = csDoubleToInt((sv / num2) * num);
    if (atWar && ((owner !== null && habitat === owner.capital) || sv > 500000)) {
        result = csDoubleToInt(result * 1.3);
    }
    // TODO(port): Galaxy.GlobalVictoryConditions DefendHabitat / TargetHabitat (× 2.0) — null at game start.
    const empire = habitat.empire;
    if (empire !== null && empire.policy != null) {
        if (habitat === empire.homeWorld) {
            result = csDoubleToInt(result * empire.policy.homeworldDefensePriority);
        } else if (colonyCharacters(habitat) !== null && countCharactersByRole(colonyCharacters(habitat)!, CharacterRole.Leader) > 0 && empire.policy.protectLeaderAtAllCosts) {
            // Habitat.cs 5515: Characters != null && CountCharactersByRole(Leader) > 0 && ProtectLeaderAtAllCosts.
            result = csDoubleToInt(result * 2.0);
        }
    }
    return result;
}

// Habitat.cs TroopLevelRequired (318). Returns int. No Rnd.
export function troopLevelRequired(galaxy: Galaxy, habitat: Habitat, difficultyLevel: number): number {
    let num = csDoubleToInt(estimatedDefensiveForceRequired(galaxy, habitat, false, difficultyLevel) * 0.5);
    const num2 = csDoubleToInt(Math.sqrt(difficultyLevel) * Math.trunc(COLONY_MAXIMUM_TROOP_STRENGTH / 100));
    if (num > num2) num = num2;
    const owner = habitat.owner;
    if (owner !== null) {
        let num3 = 1.0;
        // TODO(port): Empire.Capitals (HabitatList, IdentifyEmpireCapitals) — holds only the
        // Capital at game start, which the first test already covers.
        if (owner.capital === habitat) {
            num3 = 1.5;
            if (owner !== galaxy.playerEmpire) num3 *= Math.sqrt(difficultyLevel);
        } else if (owner.homeWorld === habitat) {
            num3 = 1.5;
            if (owner !== galaxy.playerEmpire) num3 *= Math.sqrt(difficultyLevel);
        }
        num = csDoubleToInt(num * num3);
    }
    // TODO(port): Empire.PenalColonies (Max(200, num)) — empty at game start.
    const empire = habitat.empire;
    if (empire !== null && empire.policy != null) {
        num = csDoubleToInt(num * Math.max(empire.policy.troopRecruitInfantryLevel, empire.policy.troopGarrisonLevel));
        num = Math.max(num, empire.policy.troopGarrisonMinimumPerColony * 100);
    }
    return num;
}

// Habitat.cs TroopLevelMinimum (362).
export function troopLevelMinimum(galaxy: Galaxy, habitat: Habitat, difficultyLevel: number): number {
    let num = Math.trunc(troopLevelRequired(galaxy, habitat, difficultyLevel) / 3);
    const empire = habitat.empire;
    if (empire !== null && empire.policy != null) {
        num = Math.max(num, empire.policy.troopGarrisonMinimumPerColony * 100);
    }
    return num;
}

// Habitat troop strength totals (TroopList.cs, over Habitat.Troops; 0 when the list is null).
export function colonyTroopTotals(habitat: Habitat): { count: number; totalAttackStrength: number; totalDefendStrength: number; totalDefendStrengthExcludeReadiness: number } {
    const t = habitat.troops;
    if (t === null) return { count: 0, totalAttackStrength: 0, totalDefendStrength: 0, totalDefendStrengthExcludeReadiness: 0 };
    return { count: t.count, totalAttackStrength: t.totalAttackStrength, totalDefendStrength: t.totalDefendStrength, totalDefendStrengthExcludeReadiness: t.totalDefendStrengthExcludeReadiness };
}

// ---------------------------------------------------------------------------
// Game-start garrisons
// ---------------------------------------------------------------------------

// Galaxy.8.cs MakeHabitatIntoColony 685-696 (after habitat.DoTasks / ReviewConstructionSpeed).
// Rnd: 1 × NextDouble. Returns the troops created.
export function generateColonyStartingTroops(galaxy: Galaxy, habitat: Habitat, empire: Empire, race: Race, difficultyLevel: number): Troop[] {
    const created: Troop[] = [];
    const level = troopLevelRequired(galaxy, habitat, difficultyLevel);
    const num4 = csDoubleToInt(level * (0.5 + galaxy.rnd.nextDouble()));
    const num5 = Math.trunc(num4 / 100);
    const troopStrength = race.troopStrength;
    for (let i = 0; i < num5; i++) {
        const troop = generateNewTroop(empire.generateTroopDescription(), TroopType.Infantry, troopStrength, empire, race);
        troop.colony = habitat;
        habitat.troops!.add(troop);
        empire.troops.add(troop);
        created.push(troop);
    }
    return created;
}

// Galaxy.7.cs GenerateEmpire 5292-5316 (after capital.DoTasks). Rnd: 1 × NextDouble.
// Returns the troops created.
export function generateCapitalStartingTroops(galaxy: Galaxy, empire: Empire, capital: Habitat, race: Race, techLevel: number, difficultyLevel: number): Troop[] {
    const created: Troop[] = [];
    let num6 = estimatedDefensiveForceRequired(galaxy, capital, false, difficultyLevel) * 2;
    if (num6 > Math.trunc(COLONY_MAXIMUM_TROOP_STRENGTH / 100)) {
        num6 = Math.trunc(COLONY_MAXIMUM_TROOP_STRENGTH / 100);
    }
    const num7 = csDoubleToInt(num6 * galaxy.rnd.nextDouble());
    let num8 = Math.trunc(num7 / 100);
    if (techLevel === 0.0) {
        num8 = Math.min(1, num8);
    }
    const troopStrength = race.troopStrength;
    if (empire.troopCanRecruitInfantry) {
        for (let i = 0; i < num8; i++) {
            const troop = generateNewTroop(empire.generateTroopDescription(), TroopType.Infantry, troopStrength, empire, capital.population.dominantRace);
            troop.colony = capital;
            capital.troops!.add(troop);
            empire.troops.add(troop);
            created.push(troop);
        }
    } else {
        empire.troops.clear();
        capital.troops!.clear();
    }
    return created;
}

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

// Galaxy.7.cs CalculateDefaultTroopMaintenanceMultiplier (5505).
export function calculateDefaultTroopMaintenanceMultiplier(troopType: TroopType): number {
    let result = 1.0;
    switch (troopType) {
        case TroopType.Infantry:
            result = 1.0;
            break;
        case TroopType.PirateRaider:
            result = 0.0;
            break;
        case TroopType.Armored:
            result = 2.0;
            break;
        case TroopType.Artillery:
            result = 4.0;
            break;
        case TroopType.SpecialForces:
            result = 2.0;
            break;
    }
    return result;
}

// Empire.cs AnnualTroopMaintenance (2025) / AnnualTroopMaintenanceIncludeRecruiting (2070).
// The two differ only in the skip test (PirateRaider / BeingRecruited). No Rnd.
function annualTroopMaintenanceSum(empire: Empire, includeRecruiting: boolean): number {
    let num = 0.0;
    // Empire.cs 2030-2034 / 2074-2078: num2 = 1.0; if (Leader != null) num2 *= 1.0 + Leader.TroopMaintenance / 100.0.
    const num2 = resolveLeaderTroopMaintenanceFactor(empire);
    const gov = empireGovernmentAttributes(empire);
    const troops = empire.troops.items;
    for (let i = 0; i < troops.length; i++) {
        const troop = troops[i];
        if (troop == null) continue;
        if (!includeRecruiting && (troop.type === TroopType.PirateRaider || troop.beingRecruited)) continue;
        let num3 = TROOP_ANNUAL_MAINTENANCE * troop.maintenanceMultiplier * empire.troopMaintenanceFactor;
        if (gov !== null) {
            num3 *= gov.maintenanceCosts;
        }
        num3 /= num2;
        // Empire.cs 2049-2061 (2093-2105): colony characters (excluding leaders) or built-object
        // characters (all) TroopMaintenance skill.
        const divisor = resolveTroopLocationMaintenanceDivisor(troop.colony as Habitat | null, troop.colony !== null ? null : (troop.builtObject as BuiltObject | null));
        if (divisor !== null) num3 /= divisor;
        num += num3;
    }
    return num;
}
export const annualTroopMaintenance = (empire: Empire): number => annualTroopMaintenanceSum(empire, false);
export const annualTroopMaintenanceIncludeRecruiting = (empire: Empire): number => annualTroopMaintenanceSum(empire, true);

// Empire.4.cs CalculateCostPerTroop(troopType, colony, builtObject) (1594). No Rnd.
export function calculateCostPerTroop(empire: Empire, troopType: TroopType, colony: Habitat | null, builtObject: object | null): number {
    let num = 0.0;
    const num2 = calculateDefaultTroopMaintenanceMultiplier(troopType);
    // Empire.4.cs 1598-1602: num3 = 1.0; if (Leader != null) num3 *= 1.0 + Leader.TroopMaintenance / 100.0.
    const num3 = resolveLeaderTroopMaintenanceFactor(empire);
    num = TROOP_ANNUAL_MAINTENANCE * num2;
    const gov = empireGovernmentAttributes(empire);
    if (gov !== null) {
        num *= gov.maintenanceCosts;
    }
    num /= num3;
    // Empire.4.cs 1609-1623: colony characters (excluding leaders) or built-object characters (all).
    const divisor = resolveTroopLocationMaintenanceDivisor(colony, colony !== null ? null : (builtObject as BuiltObject | null));
    if (divisor !== null) num /= divisor;
    return num;
}

// Empire.cs MinimumShipSpending (2203).
export function minimumShipSpending(galaxy: Galaxy, empire: Empire): number {
    const num = calculateAccurateAnnualIncome(galaxy, empire);
    return num * SPENDING_SHIP_PERCENTAGE;
}

// ---------------------------------------------------------------------------
// Recruitment helpers
// ---------------------------------------------------------------------------

// Empire.4.cs IdentifyStrongestRaceAttackTroop(troopType = Infantry) (4014 / 4019).
export function identifyStrongestRaceAttackTroop(empire: Empire, troopType: TroopType = TroopType.Infantry): Troop | null {
    let troop: Troop | null = null;
    if (empire.troops != null) {
        for (let i = 0; i < empire.troops.items.length; i++) {
            const troop2 = empire.troops.items[i];
            if (troop2 != null && (troop === null || troop2.attackStrength > troop.attackStrength) && troop2.race != null && troop2.type === troopType) {
                troop = troop2;
            }
        }
    }
    return troop;
}

// Habitat.cs GenerateNewTroop(troopType, empireBestTroop, recruitDefaultTroops) (7027);
// GenerateNewTroop(empireBestTroop, recruitDefaultTroops) (7021) is troopType = Infantry.
// No Rnd.
export function habitatGenerateNewTroop(galaxy: Galaxy, habitat: Habitat, troopType: TroopType, empireBestTroop: Troop | null, recruitDefaultTroops: boolean): Troop | null {
    let troop: Troop | null = null;
    if (habitat.population != null && habitat.population.dominantRace != null && habitat.empire !== null) {
        const dominantRace = habitat.population.dominantRace;
        const empire = habitat.empire;
        let num: number = dominantRace.troopStrength;
        if (habitat.ruin !== null) {
            num *= 1.0 + habitat.ruin.bonusDefensive;
        }
        const bonusTotalByEffectType = resourceBonusTotalByEffectType(habitat, ColonyResourceEffect.RecruitedTroopStrength);
        num += bonusTotalByEffectType;
        // TODO(port): Habitat.RaceEventType GreatHuntStrongTroops / WarriorWaveTroopRecruitment
        // (num *= 1.1) — RaceEventType.Undefined at game start.
        switch (troopType) {
            case TroopType.Infantry:
                if (habitat.facilities !== null && habitat.facilities.length > 0) {
                    // CloningFacility / RoboticTroopFoundry / TroopTrainingCenter troops (7047-7084).
                    throw new Error('TODO(port): PlanetaryFacility model (Habitat.GenerateNewTroop facility troops)');
                }
                if (troop === null || recruitDefaultTroops) {
                    troop = generateNewTroop(empire.generateTroopDescription(dominantRace.troopName), TroopType.Infantry, csDoubleToInt(num), empire, dominantRace);
                    troop.readiness = 0;
                    troop.colony = habitat;
                }
                break;
            case TroopType.Armored:
                troop = generateNewTroop(empire.generateTroopDescription(raceTroopNameFallback(dominantRace, dominantRace.troopNameArmored)), TroopType.Armored, csDoubleToInt(num), empire, dominantRace);
                troop.readiness = 0;
                troop.colony = habitat;
                break;
            case TroopType.Artillery:
                // Race.TroopNameArtillery ← races.txt TroopNamePlanetaryDefense (Race.cs 1423).
                troop = generateNewTroop(empire.generateTroopDescription(raceTroopNameFallback(dominantRace, dominantRace.troopNamePlanetaryDefense)), TroopType.Artillery, csDoubleToInt(num), empire, dominantRace);
                troop.readiness = 0;
                troop.colony = habitat;
                break;
            case TroopType.SpecialForces:
                troop = generateNewTroop(empire.generateTroopDescription(raceTroopNameFallback(dominantRace, dominantRace.troopNameSpecialForces)), TroopType.SpecialForces, csDoubleToInt(num), empire, dominantRace);
                troop.readiness = 0;
                troop.colony = habitat;
                break;
        }
    }
    void empireBestTroop; // only read by the facility branches
    void galaxy;
    return troop;
}

// Habitat.cs ResolveInvasionEmpires(out defender, out invader) (3229). No Rnd.
export function resolveInvasionEmpires(habitat: Habitat): { defender: Empire | null; invader: Empire | null } {
    let defender: Empire | null = null;
    let empire: Empire | null = null;
    if (habitat.troops !== null && habitat.troops.count > 0) {
        for (let i = 0; i < habitat.troops.count; i++) {
            const troop = habitat.troops.items[i];
            if (troop != null) {
                if (troop.type === TroopType.PirateRaider) empire = troop.empire as Empire | null;
                else defender = troop.empire as Empire | null;
            }
            if (defender !== null) break;
        }
    }
    // Habitat.cs 3256-3259.
    const characters = colonyCharacters(habitat);
    if (defender === null && empire === null && characters !== null && characters.length > 0 && characters[0] != null) {
        defender = characters[0].empire;
    }
    let invader: Empire | null = null;
    let empire2: Empire | null = null;
    if (habitat.invadingTroops !== null && habitat.invadingTroops.count > 0) {
        for (let j = 0; j < habitat.invadingTroops.count; j++) {
            const troop2 = habitat.invadingTroops.items[j];
            if (troop2 != null) {
                if (troop2.type === TroopType.PirateRaider) empire2 = troop2.empire as Empire | null;
                else invader = troop2.empire as Empire | null;
            }
            if (invader !== null) break;
        }
    }
    // Habitat.cs 3284-3287.
    const invadingCharacters = habitatInvadingCharacterList(habitat);
    if (invader === null && empire2 === null && invadingCharacters !== null && invadingCharacters.length > 0 && invadingCharacters[0] != null) {
        invader = invadingCharacters[0].empire;
    }
    if (defender === null && empire !== null) defender = empire;
    if (invader === null && empire2 !== null) invader = empire2;
    return { defender, invader };
}

// Empire.6.cs MaximumCharactersAllowedNonIntelligenceAgent (3966).
function maximumCharactersAllowedNonIntelligenceAgent(empire: Empire): number {
    if (empire.pirateEmpireBaseHabitat === null) {
        return Math.min(20, csDoubleToInt(Math.sqrt(totalColonyStrategicValue(empire)) / 150.0));
    }
    return Math.min(20, csDoubleToInt(Math.sqrt(empire.builtObjects.length) + 2.0));
}

// Empire.6.cs CharactersCanGenerateAmountNonIntelligenceAgent (3976 / 3982).
export function charactersCanGenerateAmountNonIntelligenceAgent(empire: Empire): number {
    const characters = getEmpireCharacters(empire);
    const num = countCharactersByRole(characters, CharacterRole.IntelligenceAgent);
    const otherCharacterCount = characters.length - num;
    const num2 = maximumCharactersAllowedNonIntelligenceAgent(empire);
    return num2 - otherCharacterCount;
}

/** Empire.GenerateNewCharacter(CharacterRole.TroopGeneral, location) + the message send
 *  (Galaxy.2.cs 5230-5233). Supplied by the characters port (characters.ts). */
export type TroopGeneralHook = (galaxy: Galaxy, empire: Empire, location: Habitat, troopRecruited: Troop) => void;
let troopGeneralHook: TroopGeneralHook | null = null;
export function registerTroopGeneralHook(hook: TroopGeneralHook | null): void {
    troopGeneralHook = hook;
}

// Galaxy.2.cs ChanceNewTroopGeneralFromRecruitment (5219). Rnd: Next(0, num).
export function chanceNewTroopGeneralFromRecruitment(galaxy: Galaxy, troopRecruited: Troop | null, empire: Empire | null, location: Habitat | null): boolean {
    // location.HasBeenDestroyed: false for colonies at game start.
    if (troopRecruited !== null && empire !== null && location !== null) {
        let num = 70;
        if (empire.dominantRace !== null) {
            num = Math.max(2, csDoubleToInt(num / raceCharacterRandomAppearanceChanceGeneral(empire.dominantRace)));
        }
        if (galaxy.rnd.next(0, num) === 1 && charactersCanGenerateAmountNonIntelligenceAgent(empire) > 0) {
            if (troopGeneralHook === null) {
                throw new Error('TODO(port): Empire.GenerateNewCharacter(TroopGeneral) (Galaxy.2.cs 5230) — register via registerTroopGeneralHook');
            }
            troopGeneralHook(galaxy, empire, location, troopRecruited);
            return true;
        }
    }
    return false;
}

// ---------------------------------------------------------------------------
// ProcessColonyTroops
// ---------------------------------------------------------------------------

// Shared by ProcessColonyTroops (3637-3689) and ReviewColonyTroopGarrison(colony) (3757-3802):
// the "num > 0 && num < 200" small-colony exemption.
function smallColonyExempt(galaxy: Galaxy, empire: Empire, colony: Habitat, num6: number, atWar: boolean): number {
    if (num6 > 0 && num6 < 200 && colony.empire !== null) {
        let flag = true;
        const systemInfo = galaxy.systems.length > colony.systemIndex ? galaxy.systems[colony.systemIndex] : null;
        if (atWar) {
            flag = false;
        } else if (
            (systemInfo != null && systemInfo.dominantEmpire != null && systemInfo.dominantEmpire.empire !== colony.empire) ||
            (systemInfo != null && systemInfo.otherEmpires != null && systemInfo.otherEmpires.length > 0) ||
            (systemInfo != null && (systemInfo.independentColonyCount ?? 0) > 0)
        ) {
            flag = false;
        } else if (colony.annualTaxRevenue > TROOP_ANNUAL_MAINTENANCE) {
            flag = false;
        } else if (colony.basesAtHabitat != null && colony.basesAtHabitat.length > 0) {
            for (let k = 0; k < colony.basesAtHabitat.length; k++) {
                const builtObject = colony.basesAtHabitat[k];
                if (builtObject != null && (builtObject.subRole === BuiltObjectSubRole.SmallSpacePort || builtObject.subRole === BuiltObjectSubRole.MediumSpacePort || builtObject.subRole === BuiltObjectSubRole.LargeSpacePort)) {
                    flag = false;
                }
            }
        }
        if (flag && empire.policy != null && empire.policy.troopGarrisonMinimumPerColony <= 0) {
            num6 = 0;
        }
    }
    return num6;
}

// Empire.4.cs ProcessColonyTroops(colony, strongestEmpireTroop, neutralization, sizeRegeneration,
// recruitment) (3463): the 5-argument overload evaluates the empire's finances (no Rnd) and
// calls the full overload with atWar false, an empty StellarObjectList and performRecruitment.
export function processColonyTroops(
    galaxy: Galaxy,
    empire: Empire,
    colony: Habitat,
    strongestEmpireTroop: Troop | null,
    troopStrengthNeutralizationAmount: number,
    troopSizeRegenerationAmount: number,
    troopRecruitmentAmount: number,
    difficultyLevel: number,
): void {
    const totalIncome = calculateAccurateAnnualIncome(galaxy, empire);
    processColonyTroopsFull(
        galaxy, empire, colony, strongestEmpireTroop, troopStrengthNeutralizationAmount, troopSizeRegenerationAmount, troopRecruitmentAmount,
        totalIncome,
        annualStateMaintenance(empire),
        annualSubjugationTribute(galaxy, empire) + annualPirateProtection(empire),
        annualFacilityMaintenance(empire),
        annualPirateProtection(empire),
        0.0, // Empire.cs 2185 MinimumIntelligenceAgentSpending => 0.0
        minimumShipSpending(galaxy, empire),
        false,
        [],
        true,
        difficultyLevel,
    );
}

// Empire.4.cs ProcessColonyTroops(... full overload) (3469-3680).
// Rnd: Next(0, num) per completed recruit (ChanceNewTroopGeneralFromRecruitment).
export function processColonyTroopsFull(
    galaxy: Galaxy,
    empire: Empire,
    colony: Habitat,
    strongestEmpireTroop: Troop | null,
    troopStrengthNeutralizationAmount: number,
    troopSizeRegenerationAmount: number,
    troopRecruitmentAmount: number,
    totalIncome: number,
    shipMaintenance: number,
    tribute: number,
    facilityMaintenance: number,
    pirateProtection: number,
    minAgentSpending: number,
    minShipSpending: number,
    atWar: boolean,
    defendColonies: Habitat[] | null,
    performRecruitment: boolean,
    difficultyLevel: number,
): void {
    void troopStrengthNeutralizationAmount;
    void minAgentSpending;
    troopRecruitmentAmount *= baconMultiplyTroopRecruitment(empire);
    if (colony == null || colony.troops === null || colony.troopsToRecruit === null || colony.population == null) {
        return;
    }
    let race: Race | null = null;
    if (colony.population != null) {
        race = colony.population.dominantRace;
    }
    if (race === null) {
        race = empire.dominantRace;
    }
    let num = 100;
    if (race !== null) {
        num = race.troopStrength;
    }
    if (colony.ruin !== null) {
        num = csDoubleToInt(num * (1.0 + colony.ruin.bonusDefensive));
    }
    void num; // computed but not read further in the C#
    let num2 = 1.0 + Math.max(-0.9, empireApprovalRating(galaxy, colony) / 50.0);
    let d = 1.0;
    if (colony.population != null) {
        d = Math.min(colony.population.totalAmount, 2000000000) / 1000000.0;
    }
    d = Math.sqrt(d);
    d /= 20.0;
    num2 *= d;
    if (colony.ruin !== null) {
        num2 *= 1.0 + colony.ruin.bonusDefensive;
    }
    troopRecruitmentAmount *= num2;
    troopSizeRegenerationAmount *= num2;
    if (race !== null) {
        troopSizeRegenerationAmount *= raceTroopRegenerationFactor(race);
    }
    // TODO(port): Habitat.RaceEventType WarriorWaveTroopRecruitment (× 1.2) — Undefined at game start.
    const gov = empireGovernmentAttributes(empire);
    if (gov !== null) {
        troopRecruitmentAmount *= gov.troopRecruitment;
        troopSizeRegenerationAmount *= gov.troopRecruitment;
    }
    // Empire.4.cs 3522-3533.
    const leader = empireLeader(empire);
    if (leader !== null) {
        troopRecruitmentAmount *= 1.0 + leader.troopRecruitmentRate / 100.0;
        troopSizeRegenerationAmount *= 1.0 + leader.troopRecoveryRate / 100.0;
    }
    const colonyChars = colonyCharacters(colony);
    if (colonyChars !== null && colonyChars.length > 0) {
        const highestSkillLevelExcludeLeaders = getHighestSkillLevelExcludeLeaders(colonyChars, CharacterSkillType.TroopRecruitment);
        const highestSkillLevelExcludeLeaders2 = getHighestSkillLevelExcludeLeaders(colonyChars, CharacterSkillType.TroopRecoveryRate);
        troopRecruitmentAmount *= 1.0 + highestSkillLevelExcludeLeaders / 100.0;
        troopSizeRegenerationAmount *= 1.0 + highestSkillLevelExcludeLeaders2 / 100.0;
    }
    if (colony.invadingTroops !== null && colony.invadingTroops.count > 0) {
        troopSizeRegenerationAmount *= 0.5;
    }
    let num3 = 0;
    let num4 = 0;
    if (colony.troopsToRecruit.count > 0) {
        const iterationCount = { value: 0 };
        while (conditionCheckLimit(troopRecruitmentAmount > 0.0 && colony.troopsToRecruit.count > 0, 100, iterationCount)) {
            const troop = colony.troopsToRecruit.items[0];
            if (troop == null) continue;
            let num5 = f32(troopRecruitmentAmount);
            if (troop.type === TroopType.Infantry && troop.maintenanceMultiplier === f32(0.25) && troop.pictureRef === galaxy.races.length) {
                num5 = f32(num5 * 2);
            }
            troop.readiness = f32(troop.readiness + num5);
            troopRecruitmentAmount = 0.0;
            if (troop.readiness >= 100) {
                troopRecruitmentAmount = f32(troop.readiness - 100);
                troop.readiness = 100;
                troop.colony = colony;
                const { invader } = resolveInvasionEmpires(colony);
                if (invader === empire && colony.invadingTroops !== null) {
                    colony.invadingTroops.add(troop);
                } else {
                    colony.troops.add(troop);
                }
                if (empire.troops != null && !empire.troops.contains(troop)) {
                    empire.troops.add(troop);
                }
                colony.troopsToRecruit.remove(troop);
                // Empire.4.cs 3574: Galaxy.1.cs DoCharacterEvent(TroopComplete, troop, colony.Characters,
                // includeLeader: true, colony.Empire) (3781; returns at once when colony.Characters is empty).
                doCharacterEventForList(galaxy, CharacterEventType.TroopComplete, troop, colonyCharacters(colony), true, colony.empire);
                chanceNewTroopGeneralFromRecruitment(galaxy, troop, empire, colony);
            }
        }
    }
    for (let i = 0; i < colony.troops.count; i++) {
        const troop2 = colony.troops.items[i];
        if (troop2 != null) {
            troop2.readiness = f32(troop2.readiness + f32(troopSizeRegenerationAmount));
            if (troop2.readiness > 100) {
                troop2.readiness = 100;
            }
            if (troop2.attackStrength > 900) {
                troop2.setAttackStrength(900);
            }
            num3 += csDoubleToInt(troop2.defendStrength * (troop2.readiness / 100.0));
            num4 += troop2.defendStrength;
        }
    }
    if (!performRecruitment) {
        return;
    }
    for (let j = 0; j < colony.troopsToRecruit.count; j++) {
        const troop3 = colony.troopsToRecruit.items[j];
        if (troop3 != null) {
            num3 += troop3.defendStrength;
            num4 += troop3.defendStrength;
        }
    }
    let num6 = troopLevelRequired(galaxy, colony, difficultyLevel);
    if (checkTroopFacilitiesPresent(colony)) {
        num6 = csDoubleToInt(num6 * 1.25);
        num6 = Math.max(num6, 400);
    } else if (defensiveFortressBonus(colony) > 0) {
        num6 = csDoubleToInt(num6 * 1.25);
        num6 = Math.max(num6, 300);
    }
    if (defendColonies != null && defendColonies.includes(colony)) {
        num6 = csDoubleToInt(num6 * 1.5);
        num6 = Math.max(num6, 300);
    }
    const policy = empire.policy;
    if (policy != null) {
        if (policy.colonyPopulationThresholdTroopRecruitment > 0 && colony.population != null && colony.population.totalAmount < policy.colonyPopulationThresholdTroopRecruitment * 1000000) {
            num6 = 0;
        }
        num6 = Math.max(num6, policy.troopGarrisonMinimumPerColony * 100);
    }
    num6 = smallColonyExempt(galaxy, empire, colony, num6, atWar);
    if (!empire.controlTroopGeneration) {
        return;
    }
    if (num3 < num6) {
        const troopMaintenanceIncludeRecruiting = annualTroopMaintenanceIncludeRecruiting(empire);
        let num7 = troopMaintenanceIncludeRecruiting + TROOP_ANNUAL_MAINTENANCE;
        num7 += shipMaintenance + tribute + facilityMaintenance + pirateProtection;
        const num8 = empire.stateMoney / num7;
        const num9 = Math.max(shipMaintenance, minShipSpending);
        const num10 = totalIncome - (num9 + tribute + facilityMaintenance + pirateProtection);
        const num11 = num10 - annualTroopMaintenanceIncludeRecruiting(empire);
        let flag2 = false;
        if (totalIncome > num7) {
            flag2 = true;
        } else if (num8 >= ALLOWABLE_YEARS_MAINTENANCE_FROM_CASH_ON_HAND) {
            flag2 = true;
        } else if (num8 < ALLOWABLE_YEARS_MAINTENANCE_FROM_CASH_ON_HAND && num11 >= TROOP_ANNUAL_MAINTENANCE) {
            flag2 = true;
        }
        if (num11 < TROOP_ANNUAL_MAINTENANCE) {
            let num12 = Math.trunc(colony.troops.totalDefendStrengthExcludeReadiness / 100);
            num12 += Math.trunc(colony.troopsToRecruit.totalDefendStrengthExcludeReadiness / 100);
            if (num12 >= troopLevelMinimum(galaxy, colony, difficultyLevel)) {
                flag2 = false;
            }
        }
        if (flag2 && empire.troopCanRecruitInfantry) {
            const item = habitatGenerateNewTroop(galaxy, colony, TroopType.Infantry, strongestEmpireTroop, false);
            if (item === null) throw new Error('TODO(port): null Troop added to TroopsToRecruit (Empire.4.cs 3718)');
            colony.troopsToRecruit.add(item);
            if (empire.troops != null && !empire.troops.contains(item)) {
                empire.troops.add(item);
            }
        }
    }
    if (empire.troopCanRecruitArtillery) {
        let num13 = colony.troops.countByType(TroopType.Artillery);
        num13 += colony.troopsToRecruit.countByType(TroopType.Artillery);
        const num14 = csDoubleToInt((num6 / 800.0) * policy!.troopRecruitArtilleryLevel);
        if (num13 < num14) {
            const num15 = calculateCostPerTroop(empire, TroopType.Artillery, colony, null);
            let num16 = annualTroopMaintenanceIncludeRecruiting(empire) + num15;
            num16 += shipMaintenance + tribute + facilityMaintenance;
            const num17 = empire.stateMoney / num16;
            let flag3 = false;
            if (totalIncome > num16) {
                flag3 = true;
            } else if (num17 >= ALLOWABLE_YEARS_MAINTENANCE_FROM_CASH_ON_HAND) {
                flag3 = true;
            } else if (num17 < ALLOWABLE_YEARS_MAINTENANCE_FROM_CASH_ON_HAND) {
                const num18 = Math.max(shipMaintenance, minShipSpending);
                const num19 = totalIncome - (num18 + tribute + facilityMaintenance);
                const num20 = num19 - annualTroopMaintenanceIncludeRecruiting(empire);
                if (num20 >= num15) {
                    flag3 = true;
                }
            }
            if (flag3) {
                const item2 = habitatGenerateNewTroop(galaxy, colony, TroopType.Artillery, strongestEmpireTroop, false);
                if (item2 === null) throw new Error('TODO(port): null Troop added to TroopsToRecruit (Empire.4.cs 3749)');
                colony.troopsToRecruit.add(item2);
                if (empire.troops != null && !empire.troops.contains(item2)) {
                    empire.troops.add(item2);
                }
            }
        }
    }
    reviewColonyTroopGarrisonWith(empire, colony, num6, num4);
}

// Empire.4.cs ReviewColonyTroopGarrison(colony) (3753). No Rnd.
export function reviewColonyTroopGarrison(galaxy: Galaxy, empire: Empire, colony: Habitat, atWar: boolean, difficultyLevel: number): void {
    let num = troopLevelRequired(galaxy, colony, difficultyLevel);
    let num2 = 0;
    num2 += colony.troops!.totalDefendStrengthExcludeReadiness;
    num2 += colony.troopsToRecruit!.totalDefendStrengthExcludeReadiness;
    if (checkTroopFacilitiesPresent(colony)) {
        num = csDoubleToInt(num * 1.25);
        num = Math.max(num, 400);
    } else if (defensiveFortressBonus(colony) > 0) {
        num = csDoubleToInt(num * 1.25);
        num = Math.max(num, 300);
    }
    const policy = empire.policy;
    if (policy != null) {
        if (policy.colonyPopulationThresholdTroopRecruitment > 0 && colony.population != null && colony.population.totalAmount < policy.colonyPopulationThresholdTroopRecruitment * 1000000) {
            num = 0;
        }
        num = Math.max(num, policy.troopGarrisonMinimumPerColony * 100);
    }
    // C# CheckAtWar() here — the caller passes forceStructure.checkAtWar(empire).
    num = smallColonyExempt(galaxy, empire, colony, num, atWar);
    reviewColonyTroopGarrisonWith(empire, colony, num, num2);
}

// Empire.4.cs ReviewColonyTroopGarrison(colony, requiredTroopLevel, currentTroopLevelCompleteTroops)
// (3805-3905): marks Troop.Garrisoned. No Rnd.
export function reviewColonyTroopGarrisonWith(empire: Empire, colony: Habitat, requiredTroopLevel: number, currentTroopLevelCompleteTroops: number): void {
    if (colony == null) return;
    let val = csDoubleToInt(Math.min(requiredTroopLevel, currentTroopLevelCompleteTroops) * 0.5 * 100.0);
    val = Math.max(val, empire.policy!.troopGarrisonMinimumPerColony * 10000);
    const troops = colony.troops!;
    const byType = troops.getByType(TroopType.Infantry);
    const byType2 = troops.getByType(TroopType.Artillery);
    const totalDefendStrengthExcludeReadiness = byType.totalDefendStrengthExcludeReadiness;
    const totalDefendStrengthExcludeReadiness2 = byType2.totalDefendStrengthExcludeReadiness;
    let num = 0;
    const troopList = new TroopList();
    if (totalDefendStrengthExcludeReadiness2 > 0 && byType2.count > 0) {
        let num2 = 0;
        if (totalDefendStrengthExcludeReadiness > 0 && byType.count > 0) {
            num2 = totalDefendStrengthExcludeReadiness < Math.trunc(val / 2) ? totalDefendStrengthExcludeReadiness : Math.trunc(val / 2);
        }
        for (let i = 0; i < byType2.count; i++) {
            const troop = byType2.items[i];
            if (troop != null) {
                num += csDoubleToInt(troop.overallDefendStrengthExcludeReadiness);
                troopList.add(troop);
                if (num >= val - num2) break;
            }
        }
    }
    for (let j = 0; j < byType.count; j++) {
        const troop2 = byType.items[j];
        if (troop2 != null) {
            num += csDoubleToInt(troop2.overallDefendStrengthExcludeReadiness);
            troopList.add(troop2);
            if (num >= val) break;
        }
    }
    if (num < val) {
        const byType3 = troops.getByType(TroopType.SpecialForces);
        if (byType3.count > 0) {
            for (let k = 0; k < byType3.count; k++) {
                const troop3 = byType3.items[k];
                if (troop3 != null) {
                    num += csDoubleToInt(troop3.overallDefendStrengthExcludeReadiness);
                    troopList.add(troop3);
                    if (num >= val) break;
                }
            }
        }
    }
    for (let l = 0; l < troops.count; l++) {
        const troop4 = troops.items[l];
        if (troop4 != null) {
            troop4.garrisoned = troopList.contains(troop4);
        }
    }
}
