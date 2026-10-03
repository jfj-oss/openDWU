// M4o — damage, explosions, disabled components, self-destruct, battle stats, pirate-base bonuses, scrap.
//
// Ports (statement for statement, same Galaxy.Rnd draw order):
//   Explosion.cs (the element type of BuiltObject.Explosions / Habitat.Explosion(s)), SpaceBattleStats.cs,
//   BaconSpaceBattleStats.cs AddLatestCombatStats, BuiltObject.2.cs 6216 InflictDamage, 6127 InflictIonDamage,
//   5816 InflictBombardDamage, 6084 ReviewDisabledComponents, 4816 CheckSelfDestruct, 4950 ProvideBonusFromPirateBase,
//   BuiltObject.1.cs 14 DoExplosions, 3490 DestroyHabitat + 3552 InflictHabitatDestructionAreaDamage,
//   Habitat.cs 2350 InflictIonDamage, 6309 DoExplosions, 6341 DoExplosion, Galaxy.7.cs 2835 DetermineScrapDamagedShip,
//   Galaxy.9.cs 252 IdentifyPirateSpaceport, 340 ChanceAttackedPirateFactionJoinsPhantomPirates, 396 PirateFactionJoinsEmpire,
//   404 FearfulPirateFactionJoinsPlayer, Galaxy.3.cs 474/496 CalculateWarValue, 517-541 InflictWarDamage,
//   Galaxy.1.cs 2804 ResolveNearestLocation, BaconGalaxy.cs 1093 CalculateBuiltObjectLootingValue,
//   BaconBuiltObject.cs 86-102 IsMyShip / InflictDamage multiplier / ArmorReactivityMultiplier, 5144
//   SaveShipInfoBeforeDestruction, 5160 CollectScrapFromDestroyedBuiltObjects, PlanetaryFacilityList.cs 214
//   SelectRandomFacility, TroopList.cs 116 GetArtilleryTroopDefendStrength, Galaxy.7.cs 569 ConditionCheckLimit.
//
// Time: `time` / `_tempNow` are game ms (tick/simTime.ts); DateTime subtraction ".Ticks / 1e7" is "/ 1000".
// Clock-seeded `new Random()` (BaconBuiltObject.cs 5183) → galaxy.baconCombatClockRnd, seeded from the galaxy seed
// (plan §0). Galaxy.ReseedRandom() inside InflictDamage (BuiltObject.2.cs 6663) is NOT performed (plan §0).

import { isAiControlled } from '../missions/playerOrder';
import { checkTriggerEvent } from '../story/eventActions';
import { EventTriggerType } from '../story/gameEventModel';
import type { Galaxy } from '../galaxy';
import type { BuiltObject } from '../builtObject';
import { HabitatType, planetsOf, type Habitat } from '../types';
import { CreatureType, type Creature } from '../creature';
import { AutomationLevel, type Empire } from '../empire';
import type { ShipGroup } from '../fleets/shipGroup';
import { shipGroupObtainCharacters } from '../fleets/shipGroupTasks';
import type { Weapon } from '../weapon';
import type { BuiltObjectComponent } from '../builtObjectComponent';
import { ComponentStatus, csInt, toShort } from '../builtObjectComponent';
import { ComponentType } from '../data/components';
import { ComponentCategoryType } from '../data/policies';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { BuiltObjectFleeWhen, BuiltObjectRole } from '../data/designSpecifications';
import { BuiltObjectStance } from '../design';
import { Random } from '../random';
import { Cargo, ResourceRef, TroopType, type Troop, type TroopList } from '../cargo';
import type { Population } from '../population';
import { BuiltObjectMissionType, builtObjectMission, isBuiltObject, isCreature, isHabitat, type StellarObject } from '../missions/mission';
import { MIN_TIME, galaxyNow, galaxyStarDate } from '../tick/simTime';
import { registerTodo, todo } from '../tick/todo';
import { CharacterEventType, captainBonuses, doCharacterEventForList, habitatInvadingCharacterList, stellarObjectCharacters, type Character } from '../characters';
import { conditionCheckLimit } from '../tick/builtObjectTick';
import { EventMessageType, chanceNewFleetAdmiral, chanceNewShipCaptain, chanceRaceEvent, doPlanetDestroyAsteroidField, doPlanetRemove, sendEventMessageToEmpire } from '../events';
import { CharacterDeathType, characterSendDeathMessage } from '../characterRuntime';
import { EmpireMessageType, sendMessageToEmpire, sendMessageToEmpireWithTitle } from '../messages';
import { takeOwnershipOfColonyFull } from './ownership';
import { clearColony, inflictTroopLosses, takeOwnershipOfBuiltObject } from './invasion';
import { obtainEmpireEvaluation } from '../diplomacy';
import { declareWar } from '../diplomacyTick';
import { PirateRelationType, changePirateRelation, obtainPirateRelation } from '../pirateRelations';
import { fastFindNearestIndependentHabitat, findNearestPirateFaction } from '../pirates';
import { eliminatePirateFaction } from '../pirates/pirateGalaxyTick';
import { PirateIncomeType } from '../pirates/pirateEconomy';
import { checkEmpireHasHyperDriveTech, totalMobileMilitaryFirepower } from '../forceStructure';
import { SECTOR_SIZE, applyCorruptionToIncome } from '../logistics/orders';
import { selectRandomNextResearchProjectExcludeSuperWeapons } from '../construction/constructionQueue';
import { doResearchBreakthrough, reviewDesignsBuiltObjectsImprovedComponents } from '../researchTick';
import { generateDesignFromSpec } from '../designGeneration';
import { generateAbandonedBuiltObject, getMonitoringStationDesignSpec } from '../gameStartTail';
import { findLonelyColonyLocation } from '../civilianAI';
import { getEmpireById } from '../logistics/contracts';
import { checkRemoveFacilityTracking, facilitiesFindBestPirateFacility, type PlanetaryFacility } from '../construction/facilities';
import { PlanetaryFacilityType } from '../researchSystem';
import { gameText } from '../colonyTick';
import { strategicValue } from '../territory';
import { SystemVisibilityStatus } from '../visibility';
import { resolveTechBonusFactor } from './attackAI';
import { shipGroupOf } from './threats';
import { findNearestShipYard } from '../construction/empireConstruction';
import { findNearestAvailableConstructionShip } from '../construction/empireConstruction';
import { MAX_SOLAR_SYSTEM_SIZE, checkWithinDistancePotential } from '../movement';
import { builtObjectCompleteTeardown } from './teardown';
import { baconSettings } from '../data/baconSettings';
import { scenarioEmit } from '../scenario/hooks';

// ---------------------------------------------------------------------------------------------------------------
// Constants (Galaxy.3.cs SetDefaults)
// ---------------------------------------------------------------------------------------------------------------

/** Galaxy.3.cs 4994 / 4995. */
export const EXPLOSION_IMAGE_COUNT = 20;
export const EXPLOSION_HABITAT_IMAGE_COUNT = 120;
/** Galaxy.3.cs 5062 DestroySilverMistReputationBonus. */
export const DESTROY_SILVER_MIST_REPUTATION_BONUS = 1.5;
/** Galaxy.3.cs 5112 PlanetDestroyReputationImpact. */
export const PLANET_DESTROY_REPUTATION_IMPACT = 20;
/** Galaxy.3.cs 4959 IndexSize (galaxy.ts / movement.ts keep their own copies). */
const INDEX_SIZE = 400_000;
/** BaconBuiltObject.cs 45 / 46. */
const MY_DAMAGE_MULTIPLIER = 3.0;
const MY_ARMOR_REACTIVITY_MULTIPLIER = 2;

/** Galaxy.7.cs 747 CheckWithinDistancePotential (movement.ts; doubled distance, axes ORed). */
export { checkWithinDistancePotential };

// ---------------------------------------------------------------------------------------------------------------
// Explosion.cs
// ---------------------------------------------------------------------------------------------------------------

/** Explosion.cs 14-24 (the element type of BuiltObject.Explosions, Habitat.Explosion / Explosions, Fighter.Explosions). */
export class Explosion {
    /** ExplosionStart (DateTime → game ms). */
    explosionStart = MIN_TIME;
    explosionSoundPlayed = false;
    explosionSize = 0; // short
    explosionOffsetX = 0; // short
    explosionOffsetY = 0; // short
    explosionProgression = 0; // float
    explosionImageIndex = 0; // short
    explosionCurrentImage = 0; // short
    explosionWillDestroy = false;
}

/** BuiltObject.Explosions / Habitat.Explosions typed (the field is `unknown[]` in builtObject.ts / types.ts). */
export function explosionsOf(o: { explosions: unknown[] | null }): Explosion[] | null {
    return o.explosions as Explosion[] | null;
}

// ---------------------------------------------------------------------------------------------------------------
// SpaceBattleStats.cs
// ---------------------------------------------------------------------------------------------------------------

/** SpaceBattleStats.cs (the BattleStats / CareerBattleStats / ShipGroup.BattleStats type). */
export class SpaceBattleStats {
    location: Habitat | null = null;
    nearLocation = false;
    weaponsDamageToEnemy = 0; // float
    weaponsHits = 0;
    weaponsHitsLongRange = 0;
    weaponsMisses = 0;
    shieldsDamageAbsorbed = 0; // float
    damageToUs = 0;
    damageRepaired = 0;
    destroyedEnemyShipBaseSize = 0;
    destroyedFriendlyShipBaseSize = 0;
    destroyedEnemyShipBaseSizeByFighters = 0;
    destroyedFriendlyShipBaseSizeByFighters = 0;
    destroyedEnemyShipsSpaceport = 0;
    destroyedEnemyShipsDefensiveBase = 0;
    destroyedEnemyShipsOtherBase = 0;
    destroyedEnemyShipsCarrier = 0;
    destroyedEnemyShipsTroopTransport = 0;
    destroyedEnemyShipsCapitalShip = 0;
    destroyedEnemyShipsCruiser = 0;
    destroyedEnemyShipsDestroyer = 0;
    destroyedEnemyShipsFrigate = 0;
    destroyedEnemyShipsEscort = 0;
    destroyedEnemyShipsResupplyShip = 0;
    destroyedEnemyShipsOtherShips = 0;
    destroyedEnemyFighters = 0;
    destroyedFriendlyShipsSpaceport = 0;
    destroyedFriendlyShipsDefensiveBase = 0;
    destroyedFriendlyShipsOtherBase = 0;
    destroyedFriendlyShipsCarrier = 0;
    destroyedFriendlyShipsTroopTransport = 0;
    destroyedFriendlyShipsCapitalShip = 0;
    destroyedFriendlyShipsCruiser = 0;
    destroyedFriendlyShipsDestroyer = 0;
    destroyedFriendlyShipsFrigate = 0;
    destroyedFriendlyShipsEscort = 0;
    destroyedFriendlyShipsResupplyShip = 0;
    destroyedFriendlyShipsOtherShips = 0;
    destroyedFriendlyFighters = 0;

    /** SpaceBattleStats.cs 93 ShieldsStruckUs(damageAmount) (float). */
    shieldsStruckUs(damageAmount: number): void {
        this.shieldsDamageAbsorbed = Math.fround(this.shieldsDamageAbsorbed + Math.fround(damageAmount));
    }
    /** 98 DamageHullUs(damageAmount). */
    damageHullUs(damageAmount: number): void {
        this.damageToUs = (this.damageToUs + damageAmount) | 0;
    }
    /** 103 DamageRepairedUs(repairAmount). */
    damageRepairedUs(repairAmount: number): void {
        this.damageRepaired = (this.damageRepaired + repairAmount) | 0;
    }
    /** 108 WeaponHitEnemy(damageAmount, hitRange). */
    weaponHitEnemy(damageAmount: number, hitRange: number): void {
        this.weaponsHits++;
        this.weaponsDamageToEnemy = Math.fround(this.weaponsDamageToEnemy + Math.fround(damageAmount));
        if (hitRange >= 350.0) this.weaponsHitsLongRange++;
    }
    /** 118 WeaponMissEnemy. */
    weaponMissEnemy(): void {
        this.weaponsMisses++;
    }
    /** 123 FighterDestroyedEnemy. */
    fighterDestroyedEnemy(): void {
        this.destroyedEnemyFighters++;
    }
    /** 128 FighterDestroyedFriendly. */
    fighterDestroyedFriendly(): void {
        this.destroyedFriendlyFighters++;
    }
    /** 133 TargetDestroyedEnemy(target). */
    targetDestroyedEnemy(target: BuiltObject | null): void {
        if (target !== null) {
            this.destroyedEnemyShipBaseSize += target.size;
            this.targetDestroyedEnemyCore(target);
        }
    }
    /** 142 TargetDestroyedEnemyByFighter(target). */
    targetDestroyedEnemyByFighter(target: BuiltObject | null): void {
        if (target !== null) {
            this.destroyedEnemyShipBaseSizeByFighters += target.size;
            this.targetDestroyedEnemyCore(target);
        }
    }
    /** 151 TargetDestroyedEnemyCore(target). */
    private targetDestroyedEnemyCore(target: BuiltObject): void {
        const S = BuiltObjectSubRole;
        switch (target.subRole) {
            case S.Escort: this.destroyedEnemyShipsEscort++; return;
            case S.Frigate: this.destroyedEnemyShipsFrigate++; return;
            case S.Destroyer: this.destroyedEnemyShipsDestroyer++; return;
            case S.Cruiser: this.destroyedEnemyShipsCruiser++; return;
            case S.CapitalShip: this.destroyedEnemyShipsCapitalShip++; return;
            case S.Carrier: this.destroyedEnemyShipsCarrier++; return;
            case S.TroopTransport: this.destroyedEnemyShipsTroopTransport++; return;
            case S.ResupplyShip: this.destroyedEnemyShipsResupplyShip++; return;
            case S.SmallSpacePort:
            case S.MediumSpacePort:
            case S.LargeSpacePort:
                this.destroyedEnemyShipsSpaceport++;
                return;
            case S.DefensiveBase: this.destroyedEnemyShipsDefensiveBase++; return;
        }
        if (target.role === BuiltObjectRole.Base) this.destroyedEnemyShipsOtherBase++;
        else this.destroyedEnemyShipsOtherShips++;
    }
    /** 199 TargetDestroyedFriendly(target). */
    targetDestroyedFriendly(target: BuiltObject | null): void {
        if (target !== null) {
            this.destroyedFriendlyShipBaseSize += target.size;
            this.targetDestroyedFriendlyCore(target);
        }
    }
    /** 208 TargetDestroyedFriendlyByFighter(target). */
    targetDestroyedFriendlyByFighter(target: BuiltObject | null): void {
        if (target !== null) {
            this.destroyedFriendlyShipBaseSizeByFighters += target.size;
            this.targetDestroyedFriendlyCore(target);
        }
    }
    /** 217 TargetDestroyedFriendlyCore(target). */
    private targetDestroyedFriendlyCore(target: BuiltObject): void {
        const S = BuiltObjectSubRole;
        switch (target.subRole) {
            case S.Escort: this.destroyedFriendlyShipsEscort++; return;
            case S.Frigate: this.destroyedFriendlyShipsFrigate++; return;
            case S.Destroyer: this.destroyedFriendlyShipsDestroyer++; return;
            case S.Cruiser: this.destroyedFriendlyShipsCruiser++; return;
            case S.CapitalShip: this.destroyedFriendlyShipsCapitalShip++; return;
            case S.Carrier: this.destroyedFriendlyShipsCarrier++; return;
            case S.TroopTransport: this.destroyedFriendlyShipsTroopTransport++; return;
            case S.ResupplyShip: this.destroyedFriendlyShipsResupplyShip++; return;
            case S.SmallSpacePort:
            case S.MediumSpacePort:
            case S.LargeSpacePort:
                this.destroyedFriendlyShipsSpaceport++;
                return;
            case S.DefensiveBase: this.destroyedFriendlyShipsDefensiveBase++; return;
        }
        if (target.role === BuiltObjectRole.Base) this.destroyedFriendlyShipsOtherBase++;
        else this.destroyedFriendlyShipsOtherShips++;
    }
}

/** BuiltObject.BattleStats / CareerBattleStats / ShipGroup.BattleStats typed (`unknown` on the owning classes). */
export function battleStatsOf(o: { battleStats: unknown }): SpaceBattleStats | null {
    return o.battleStats as SpaceBattleStats | null;
}
function shipGroupBattleStats(bo: BuiltObject): SpaceBattleStats | null {
    const shipGroup = shipGroupOf(bo);
    return shipGroup !== null ? battleStatsOf(shipGroup) : null;
}

/** BaconSpaceBattleStats.cs 16 AddLatestCombatStats(ship, battleStats). */
export function addLatestCombatStats(ship: BuiltObject, battleStats: SpaceBattleStats | null): void {
    if (ship.baconValues !== null && ship.baconValues.has('cash') && ship.actualEmpire !== null) ship.empire = ship.actualEmpire;
    if (ship.role !== BuiltObjectRole.Military || battleStats === null) return;
    if (ship.careerBattleStats === null) ship.careerBattleStats = new SpaceBattleStats();
    const c = ship.careerBattleStats as SpaceBattleStats;
    c.damageRepaired += battleStats.damageRepaired;
    c.damageToUs += Math.max(battleStats.damageToUs, 0);
    c.destroyedEnemyFighters += battleStats.destroyedEnemyFighters;
    c.destroyedEnemyShipBaseSize += battleStats.destroyedEnemyShipBaseSize;
    c.destroyedEnemyShipBaseSizeByFighters += battleStats.destroyedEnemyShipBaseSizeByFighters;
    c.destroyedEnemyShipsCapitalShip += battleStats.destroyedEnemyShipsCapitalShip;
    c.destroyedEnemyShipsCarrier += battleStats.destroyedEnemyShipsCarrier;
    c.destroyedEnemyShipsCruiser += battleStats.destroyedEnemyShipsCruiser;
    c.destroyedEnemyShipsDefensiveBase += battleStats.destroyedEnemyShipsDefensiveBase;
    c.destroyedEnemyShipsDestroyer += battleStats.destroyedEnemyShipsDestroyer;
    c.destroyedEnemyShipsEscort += battleStats.destroyedEnemyShipsEscort;
    c.destroyedEnemyShipsFrigate += battleStats.destroyedEnemyShipsFrigate;
    c.destroyedEnemyShipsOtherBase += battleStats.destroyedEnemyShipsOtherBase;
    c.destroyedEnemyShipsOtherShips += battleStats.destroyedEnemyShipsOtherShips;
    c.destroyedEnemyShipsResupplyShip += battleStats.destroyedEnemyShipsResupplyShip;
    c.destroyedEnemyShipsSpaceport += battleStats.destroyedEnemyShipsSpaceport;
    c.destroyedEnemyShipsTroopTransport += battleStats.destroyedEnemyShipsTroopTransport;
    c.shieldsDamageAbsorbed = Math.fround(c.shieldsDamageAbsorbed + battleStats.shieldsDamageAbsorbed);
    c.weaponsDamageToEnemy = Math.fround(c.weaponsDamageToEnemy + battleStats.weaponsDamageToEnemy);
    c.weaponsHits += battleStats.weaponsHits;
    c.weaponsHitsLongRange += battleStats.weaponsHitsLongRange;
    c.weaponsMisses += battleStats.weaponsMisses;
}

/** BuiltObject.2.cs 7643-7644 (AssignMission): AddLatestCombatStats(this, BattleStats); BattleStats = new SpaceBattleStats(). */
export function startNewBattleStats(galaxy: Galaxy, builtObject: BuiltObject): void {
    void galaxy;
    addLatestCombatStats(builtObject, battleStatsOf(builtObject));
    builtObject.battleStats = new SpaceBattleStats();
}

/** Galaxy.1.cs 2804 ResolveNearestLocation(attackedTarget, ship, out nearby). */
export function resolveNearestLocation(galaxy: Galaxy, attackedTarget: StellarObject | null, ship: BuiltObject | null): { habitat: Habitat | null; nearby: boolean } {
    let nearby = false;
    let habitat: Habitat | null = null;
    if (attackedTarget === null) {
        if (ship !== null) {
            habitat = galaxy.findNearestHabitatOfType(ship.xpos, ship.ypos, HabitatType.Undefined);
            if (habitat !== null) {
                const num = galaxy.calculateDistanceSquared(ship.xpos, ship.ypos, habitat.xpos, habitat.ypos);
                if (num < 9000000.0) nearby = true;
            }
        }
    } else if (isBuiltObject(attackedTarget)) {
        const builtObject = attackedTarget;
        if (builtObject.parentHabitat !== null) {
            habitat = builtObject.parentHabitat;
            nearby = true;
        } else {
            habitat = galaxy.findNearestHabitatOfType(builtObject.xpos, builtObject.ypos, HabitatType.Undefined);
            if (habitat !== null) {
                const num2 = galaxy.calculateDistanceSquared(builtObject.xpos, builtObject.ypos, habitat.xpos, habitat.ypos);
                if (num2 < 9000000.0) nearby = true;
            }
        }
    } else if (isHabitat(attackedTarget)) {
        habitat = attackedTarget;
        nearby = true;
    }
    return { habitat, nearby };
}

/**
 * BuiltObject.2.cs 4517-4522 / 4527-4531 (ExecuteCommands mission completion, called by missions/executeCommands.ts
 * only when BattleStats != null): AddLatestCombatStats(this, BattleStats); BattleStats.Location =
 * ResolveNearestLocation(attackedTarget, this, out nearby); NearLocation = nearby; DoCharacterEvent(SpaceBattle,
 * BattleStats, Characters). The caller nulls BattleStats afterwards (4523 / 4532).
 */
export function finalizeBattleStats(galaxy: Galaxy, builtObject: BuiltObject, attackedTarget: StellarObject | null): void {
    const battleStats = battleStatsOf(builtObject);
    if (battleStats === null) return;
    addLatestCombatStats(builtObject, battleStats);
    const r = resolveNearestLocation(galaxy, attackedTarget, builtObject);
    battleStats.location = r.habitat;
    battleStats.nearLocation = r.nearby;
    // Galaxy.DoCharacterEvent(eventType, eventData, characters) = DoCharacterEvent(..., includeLeader: false, null).
    doCharacterEventForList(galaxy, CharacterEventType.SpaceBattle, battleStats, builtObject.characters as Character[] | null, false, null);
}

/** SpaceBattleStats.cs 103 DamageRepairedUs(repairAmount) on a BuiltObject.BattleStats (construction/repair.ts). */
export function battleStatsDamageRepairedUs(battleStats: unknown, repairAmount: number): void {
    (battleStats as SpaceBattleStats).damageRepairedUs(repairAmount);
}

/** `ShipGroup.BattleStats = new SpaceBattleStats()` (BuiltObject.1.cs 318 / 501 / 572, BuiltObject.cs 4494 / 4541). */
export function startNewShipGroupBattleStats(galaxy: Galaxy, shipGroup: ShipGroup): void {
    void galaxy;
    shipGroup.battleStats = new SpaceBattleStats();
}

// ---------------------------------------------------------------------------------------------------------------
// Bacon helpers (BaconBuiltObject.cs 86-102)
// ---------------------------------------------------------------------------------------------------------------

function nameContainsRomulan(empire: Empire | null): boolean {
    return empire !== null && empire.name.includes('Romulan');
}
/** BaconBuiltObject.cs 86 IsMyShip (builtObject.ts keeps a private copy). */
export function baconIsMyShip(ship: BuiltObject | null): boolean {
    return (ship !== null && nameContainsRomulan(ship.empire)) || (ship !== null && nameContainsRomulan(ship.actualEmpire)) || (ship !== null && nameContainsRomulan(ship.owner));
}
/** BaconBuiltObject.cs 88 InflictDamage(firingShip): the hit-power multiplier (1.0; 3.0 for "my" ship). */
export function baconInflictDamageMultiplier(firingShip: BuiltObject): number {
    let num = 1.0;
    if (baconIsMyShip(firingShip)) num = MY_DAMAGE_MULTIPLIER;
    return num;
}
/** BaconBuiltObject.cs 96 ArmorReactivityMultiplier(target). */
export function armorReactivityMultiplier(target: BuiltObject): number {
    let num = 1;
    if (baconIsMyShip(target)) num = MY_ARMOR_REACTIVITY_MULTIPLIER;
    return num;
}

// ---------------------------------------------------------------------------------------------------------------
// Fighter (M4p) surface touched here — duck-typed like combat/threats.ts FighterLike.
// ---------------------------------------------------------------------------------------------------------------

/** Fighter.cs members read/written by InflictDamage, InflictWarDamage and ClearAllMissionsForTarget (the class is M4p's). */
export interface FighterLike {
    xpos: number;
    ypos: number;
    size: number;
    health: number; // float
    currentShields: number; // float
    lastShieldStrike: number;
    lastShieldStrikeDirection: number; // float
    hasBeenDestroyed: boolean;
    overlayChanged: boolean;
    empire: Empire | null;
    parentBuiltObject: BuiltObject | null;
    explosions: Explosion[];
}
/** A target that is none of BuiltObject / Habitat / Creature is a Fighter. */
export function isFighterLike(o: unknown): o is FighterLike {
    return typeof o === 'object' && o !== null && !isBuiltObject(o) && !isHabitat(o) && !isCreature(o);
}

// ---------------------------------------------------------------------------------------------------------------
// Looting / war value (BaconGalaxy.cs 1093, Galaxy.3.cs 474-541)
// ---------------------------------------------------------------------------------------------------------------

/** BaconGalaxy.cs 1093 CalculateBuiltObjectLootingValue(builtObject) (Galaxy.9.cs 391 forwards to it). */
export function calculateBuiltObjectLootingValue(builtObject: BuiltObject): number {
    let objectLootingValue = 0.0;
    if (builtObject !== null) objectLootingValue = 1.0 * builtObject.size;
    if (builtObject.empire !== null && builtObject.empire.pirateEmpireBaseHabitat !== null) objectLootingValue *= baconSettings.shipMarkupFactorPirates / 2.5;
    else if (builtObject.empire !== null) objectLootingValue *= baconSettings.shipMarkupFactor / 5.0;
    return objectLootingValue;
}

/**
 * Empire.cs 455 LootingFactor (default 1.0): set only by BaconEmpire.cs 83 SetPirateFactionModifiers (the Galaxy.8.cs 4396
 * play-style table, kept in Empire.pirateFactionModifiers: Mercenary 1.33, Smuggler 0.75, Pirate / Balanced 1.0); a 0
 * reads as 1.0 (Empire.cs 3734). Combat verification part 2: this used to read `difficultyFactors.lootingFactor`, which
 * SetEmpireDifficultyFactors never sets, so every pirate faction looted at 1.0.
 */
export function empireLootingFactor(empire: Empire): number {
    const f = empire.pirateFactionModifiers !== null ? empire.pirateFactionModifiers.lootingFactor : 1.0;
    return f === 0.0 ? 1.0 : f;
}
/** Empire.ColonyIncomeFactor (Galaxy.3.cs 5137 default 1.0; BaconGalaxy.cs 141/153 SetEmpireDifficultyFactors). */
export function empireColonyIncomeFactor(empire: Empire): number {
    return empire.difficultyFactors?.colonyIncomeFactor ?? 1.0;
}

/** Galaxy.3.cs 474 CalculateWarValue(builtObject). */
export function calculateWarValueBuiltObject(builtObject: BuiltObject): number {
    let num = 0;
    switch (builtObject.role) {
        case BuiltObjectRole.Military:
            num = builtObject.design.firepowerRaw;
            break;
        case BuiltObjectRole.Base:
            switch (builtObject.subRole) {
                case BuiltObjectSubRole.SmallSpacePort:
                case BuiltObjectSubRole.MediumSpacePort:
                case BuiltObjectSubRole.LargeSpacePort:
                    num = builtObject.parentHabitat === null ? Math.trunc(builtObject.design.size / 5) : Math.trunc(strategicValue(builtObject.parentHabitat) / 200);
                    break;
                default:
                    num = Math.trunc(builtObject.design.size / 5);
                    break;
            }
            break;
        default:
            num = Math.trunc(builtObject.design.size / 20);
            break;
    }
    if (builtObject.unbuiltComponentCount > 0) {
        const num2 = builtObject.unbuiltComponentCount / builtObject.components.count;
        num = Math.max(1, csInt(num / 2.0 - num * num2));
    }
    return num;
}

/** Galaxy.3.cs 496 CalculateWarValue(habitat). */
export function calculateWarValueHabitat(galaxy: Galaxy, habitat: Habitat): number {
    let result = 0;
    if (habitat.empire !== null && habitat.empire !== galaxy.independentEmpire) result = Math.trunc(strategicValue(habitat) / 50);
    return result;
}

/** Galaxy.3.cs 468 CalculateWarValue(Fighter): always 1 (combat/fighters.ts calculateWarValueFighter). */
function calculateWarValueFighter(fighter: FighterLike): number {
    void fighter;
    return 1;
}

/** Galaxy.3.cs 517 InflictWarDamage(inflictingEmpire, fighter). */
export function inflictWarDamageFighter(galaxy: Galaxy, inflictingEmpire: Empire | null, target: FighterLike): void {
    void galaxy;
    if (target.empire !== null) {
        const diplomaticRelation = target.empire.diplomaticRelations.byEmpire(inflictingEmpire);
        if (diplomaticRelation !== null) diplomaticRelation.warDamageBuiltObject = (diplomaticRelation.warDamageBuiltObject + calculateWarValueFighter(target)) | 0;
    }
}

/** Galaxy.3.cs 529 InflictWarDamage(inflictingEmpire, builtObject). */
export function inflictWarDamageBuiltObject(galaxy: Galaxy, inflictingEmpire: Empire | null, target: BuiltObject): void {
    if (target.empire !== null) {
        const diplomaticRelation = target.empire.diplomaticRelations.byEmpire(inflictingEmpire);
        if (diplomaticRelation !== null) diplomaticRelation.warDamageBuiltObject = (diplomaticRelation.warDamageBuiltObject + calculateWarValueBuiltObject(target)) | 0;
        if (galaxy.scenario !== null && diplomaticRelation !== null && inflictingEmpire !== null) scenarioEmit(galaxy, 'warDamageInflicted', { inflictor: inflictingEmpire, victim: target.empire, builtObject: target, habitat: null, value: calculateWarValueBuiltObject(target) }); // mod layer
    }
}

/** Galaxy.3.cs 541 InflictWarDamage(inflictingEmpire, habitat). */
export function inflictWarDamageHabitat(galaxy: Galaxy, inflictingEmpire: Empire | null, target: Habitat): void {
    if (target.empire !== null && target.empire !== galaxy.independentEmpire) {
        const diplomaticRelation = target.empire.diplomaticRelations.byEmpire(inflictingEmpire);
        if (diplomaticRelation !== null) diplomaticRelation.warDamageColony = (diplomaticRelation.warDamageColony + calculateWarValueHabitat(galaxy, target)) | 0;
        if (galaxy.scenario !== null && diplomaticRelation !== null && inflictingEmpire !== null) scenarioEmit(galaxy, 'warDamageInflicted', { inflictor: inflictingEmpire, victim: target.empire, builtObject: null, habitat: target, value: calculateWarValueHabitat(galaxy, target) }); // mod layer
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Pirate faction changes (Galaxy.9.cs 252-460)
// ---------------------------------------------------------------------------------------------------------------

/** Galaxy.9.cs 252 IdentifyPirateSpaceport(pirateFaction). */
export function identifyPirateSpaceport(galaxy: Galaxy, pirateFaction: Empire | null): BuiltObject | null {
    void galaxy;
    if (pirateFaction !== null && pirateFaction.builtObjects !== null && pirateFaction.pirateEmpireBaseHabitat !== null) {
        let builtObject: BuiltObject | null = null;
        if (pirateFaction.pirateEmpireBaseHabitat.basesAtHabitat !== null) {
            for (let i = 0; i < pirateFaction.pirateEmpireBaseHabitat.basesAtHabitat.length; i++) {
                const builtObject2: BuiltObject = pirateFaction.pirateEmpireBaseHabitat.basesAtHabitat[i];
                if (
                    builtObject2.role === BuiltObjectRole.Base &&
                    builtObject2.actualEmpire === pirateFaction &&
                    (builtObject2.subRole === BuiltObjectSubRole.SmallSpacePort || builtObject2.subRole === BuiltObjectSubRole.MediumSpacePort || builtObject2.subRole === BuiltObjectSubRole.LargeSpacePort) &&
                    builtObject2.parentHabitat !== null &&
                    builtObject2.parentHabitat === pirateFaction.pirateEmpireBaseHabitat &&
                    builtObject2.extractionGas > 0 &&
                    (builtObject === null || builtObject.size < builtObject2.size)
                ) {
                    builtObject = builtObject2;
                }
            }
        }
        if (builtObject === null) {
            for (let j = 0; j < pirateFaction.builtObjects.length; j++) {
                const builtObject3 = pirateFaction.builtObjects[j];
                if (
                    builtObject3.role === BuiltObjectRole.Base &&
                    (builtObject3.subRole === BuiltObjectSubRole.SmallSpacePort || builtObject3.subRole === BuiltObjectSubRole.MediumSpacePort || builtObject3.subRole === BuiltObjectSubRole.LargeSpacePort) &&
                    builtObject3.extractionGas > 0 &&
                    (builtObject === null || builtObject.size < builtObject3.size)
                ) {
                    builtObject = builtObject3;
                }
            }
        }
        return builtObject;
    }
    return null;
}

/** Galaxy.9.cs 396 PirateFactionJoinsEmpire(empire, pirateFaction) → EliminatePirateFaction (M4s stub). */
export function pirateFactionJoinsEmpire(galaxy: Galaxy, empire: Empire | null, pirateFaction: Empire | null): void {
    if (empire !== null && pirateFaction !== null) eliminatePirateFaction(galaxy, pirateFaction, empire);
}

/** Galaxy.9.cs 404 FearfulPirateFactionJoinsPlayer(phantomPirateFaction, pirateFactionToExclude). No Rnd. */
export function fearfulPirateFactionJoinsPlayer(galaxy: Galaxy, phantomPirateFaction: Empire, pirateFactionToExclude: Empire | null): void {
    const playerEmpire = galaxy.playerEmpire;
    if (playerEmpire === null) return;
    let empire: Empire | null = null;
    if (playerEmpire.pirateEmpireBaseHabitat !== null) {
        empire = findNearestPirateFaction(galaxy, playerEmpire.pirateEmpireBaseHabitat.xpos, playerEmpire.pirateEmpireBaseHabitat.ypos, pirateFactionToExclude, false);
    } else if (playerEmpire.capital !== null) {
        empire = findNearestPirateFaction(galaxy, playerEmpire.capital.xpos, playerEmpire.capital.ypos, pirateFactionToExclude, false);
    }
    if (empire === null || empire.pirateEmpireSuperPirates || empire === playerEmpire) return;
    let num = 1;
    if (empire.builtObjects !== null) num = totalMobileMilitaryFirepower(empire.builtObjects);
    if (num >= 600) return;
    let num2 = 1;
    if (phantomPirateFaction.builtObjects !== null) num2 = totalMobileMilitaryFirepower(phantomPirateFaction.builtObjects);
    const num3 = num2 / num;
    if (num3 > 2.0) {
        const builtObject = identifyPirateSpaceport(galaxy, empire);
        const message = `${empire.name} joins your empire, fearful of the phantom pirates ${phantomPirateFaction.name}`;
        pirateFactionJoinsEmpire(galaxy, playerEmpire, empire);
        const text = 'Pirate Faction Joins Your Empire';
        if (builtObject !== null) sendEventMessageToEmpire(playerEmpire, EventMessageType.PirateFactionJoinsYou, text, message, builtObject, builtObject.parentHabitat);
        else sendEventMessageToEmpire(playerEmpire, EventMessageType.PirateFactionJoinsYou, text, message, null, null);
    }
}

/** Galaxy.9.cs 340 ChanceAttackedPirateFactionJoinsPhantomPirates(attackingPhantomPirateFaction, attackedPirateBase). Rnd: Next(0, 50) [, Next(0, 4)]. */
export function chanceAttackedPirateFactionJoinsPhantomPirates(galaxy: Galaxy, attackingPhantomPirateFaction: Empire | null, attackedPirateBase: BuiltObject | null): void {
    if (
        attackingPhantomPirateFaction === null ||
        !attackingPhantomPirateFaction.pirateEmpireSuperPirates ||
        attackingPhantomPirateFaction.pirateEmpireBaseHabitat === null ||
        attackedPirateBase === null ||
        attackedPirateBase.role !== BuiltObjectRole.Base ||
        attackedPirateBase.empire === null ||
        attackedPirateBase.empire === galaxy.playerEmpire ||
        attackedPirateBase.empire.pirateEmpireBaseHabitat === null ||
        attackedPirateBase.empire.pirateEmpireSuperPirates ||
        !(attackedPirateBase.currentShields < attackedPirateBase.shieldsCapacity * 0.5) ||
        galaxy.rnd.next(0, 50) !== 1
    ) {
        return;
    }
    let num = 1;
    if (attackedPirateBase.empire.builtObjects !== null) num = totalMobileMilitaryFirepower(attackedPirateBase.empire.builtObjects);
    if (num >= 600) return;
    let num2 = 1;
    if (attackingPhantomPirateFaction.builtObjects !== null) num2 = totalMobileMilitaryFirepower(attackingPhantomPirateFaction.builtObjects);
    const num3 = num2 / num;
    if (!(num3 > 2.0)) return;
    const empire = attackedPirateBase.empire;
    const builtObjectList: BuiltObject[] = [];
    builtObjectList.push(...empire.builtObjects);
    for (const item of builtObjectList) {
        takeOwnershipOfBuiltObject(galaxy, attackingPhantomPirateFaction, item, attackingPhantomPirateFaction, true);
        item.stance = BuiltObjectStance.AttackEnemies;
        item.fleeWhen = BuiltObjectFleeWhen.Shields20;
        item.design.stance = BuiltObjectStance.AttackEnemies;
        item.design.fleeWhen = BuiltObjectFleeWhen.Shields20;
    }
    let flag = false;
    switch (attackedPirateBase.subRole) {
        case BuiltObjectSubRole.SmallSpacePort:
        case BuiltObjectSubRole.MediumSpacePort:
        case BuiltObjectSubRole.LargeSpacePort:
            flag = true;
            break;
    }
    if (flag && galaxy.rnd.next(0, 4) === 1) fearfulPirateFactionJoinsPlayer(galaxy, attackingPhantomPirateFaction, empire);
}

// ---------------------------------------------------------------------------------------------------------------
// BuiltObject.2.cs 4950 ProvideBonusFromPirateBase
// ---------------------------------------------------------------------------------------------------------------

/** Empire.ObtainDesignSpec(subRole) (exploration.ts keeps a private copy). */
function obtainDesignSpec(empire: Empire, subRole: BuiltObjectSubRole) {
    for (let i = 0; i < empire.designSpecifications.length; i++) {
        const designSpecification = empire.designSpecifications[i];
        if (designSpecification !== null && designSpecification.subRole === subRole) return designSpecification;
    }
    return null;
}

/**
 * BuiltObject.2.cs 4950 ProvideBonusFromPirateBase(destroyingEmpire, pirateBase). Rnd (non-phantom branch): Next(0, 5);
 * Next(0, 4); case 0: Next(0, 4) + design generation draws (+ FindLonelyColonyLocation, M4f stub); case 1: NextDouble.
 * `Empire` below is this ship's empire, as the C# mixes the two (the call sites pass destroyingEmpire = Empire).
 */
export function provideBonusFromPirateBase(galaxy: Galaxy, self: BuiltObject, destroyingEmpire: Empire | null, pirateBase: BuiltObject): void {
    if (destroyingEmpire === null || pirateBase.role !== BuiltObjectRole.Base || pirateBase.empire === null || pirateBase.empire.pirateEmpireBaseHabitat === null) return;
    const empire = self.empire!;
    if (pirateBase.subRole === BuiltObjectSubRole.GenericBase && pirateBase.parentHabitat !== null && pirateBase.parentHabitat === pirateBase.empire.pirateEmpireBaseHabitat && pirateBase.empire.pirateEmpireSuperPirates && destroyingEmpire.pirateEmpireBaseHabitat === null) {
        let text = `${pirateBase.name} of the ${pirateBase.empire.name} destroyed`;
        text = text + '\n\n' + 'Your scientists acquire technology from the wreckage of the base';
        text += ' ';
        for (let i = 0; i < 5; i++) {
            const researchNode = selectRandomNextResearchProjectExcludeSuperWeapons(galaxy, empire);
            if (researchNode !== null) {
                doResearchBreakthrough(galaxy, empire, researchNode, true, true, false);
                text = text + researchNode.def.name + ', ';
            }
        }
        empire.research.update(empire.dominantRace);
        reviewDesignsBuiltObjectsImprovedComponents(empire);
        empire.reviewResearchAbilities();
        text = text.substring(0, text.length - 2);
        text = text + '\n\n' + `A great victory over the ${pirateBase.empire.name}`;
        const title = `${pirateBase.name} Destroyed` + '!';
        sendEventMessageToEmpire(destroyingEmpire, EventMessageType.GeneralDiscovery, title, text, pirateBase, pirateBase.empire.pirateEmpireBaseHabitat);
        destroyingEmpire.defeatedLegendaryPiratesCount++;
    } else {
        if (galaxy.rnd.next(0, 5) <= 1) return;
        if (destroyingEmpire.pirateEmpireBaseHabitat === null && checkEmpireHasHyperDriveTech(destroyingEmpire)) {
            let empty = '';
            let empty2 = '';
            switch (galaxy.rnd.next(0, 4)) {
                case 0: {
                    const habitat3 = findLonelyColonyLocation(galaxy, destroyingEmpire);
                    const habitat4 = habitat3 !== null ? galaxy.determineHabitatSystemStar(habitat3) : null;
                    const num = galaxy.rnd.next(0, 4);
                    let designSpecification = null;
                    let design = null;
                    switch (num) {
                        case 0:
                            designSpecification = obtainDesignSpec(destroyingEmpire, BuiltObjectSubRole.Destroyer);
                            design = generateDesignFromSpec(galaxy, destroyingEmpire, designSpecification, 4.0, galaxyStarDate(galaxy));
                            break;
                        case 1:
                            designSpecification = obtainDesignSpec(destroyingEmpire, BuiltObjectSubRole.Cruiser);
                            design = generateDesignFromSpec(galaxy, destroyingEmpire, designSpecification, 4.0, galaxyStarDate(galaxy));
                            break;
                        case 2:
                            designSpecification = getMonitoringStationDesignSpec();
                            design = generateDesignFromSpec(galaxy, destroyingEmpire, designSpecification, 4.0, galaxyStarDate(galaxy));
                            break;
                        case 3:
                            designSpecification = obtainDesignSpec(destroyingEmpire, BuiltObjectSubRole.CapitalShip);
                            design = generateDesignFromSpec(galaxy, destroyingEmpire, designSpecification, 4.0, galaxyStarDate(galaxy));
                            break;
                    }
                    if (design !== null && habitat3 !== null && habitat4 !== null) {
                        // TODO(port): ShipImageHelper.ResolveMinorShipImageIndex(subRole, largeShips: true) — its own clock-seeded
                        // Random (designGeneration.ts uses 0 too).
                        design.pictureRef = 0;
                        const builtObject = generateAbandonedBuiltObject(galaxy, habitat3, design);
                        // ResolveSectorDescription / AddLocationHint (player map hint) are UI text — TODO(port) M9.
                        empty2 = `${pirateBase.name}: a lost ${builtObject.name} lies abandoned near ${habitat4.name}`;
                        empty = 'Lost Ship Location Revealed';
                        sendEventMessageToEmpire(destroyingEmpire, EventMessageType.LostBuiltObjectCoordinates, empty, empty2, pirateBase, pirateBase.empire.pirateEmpireBaseHabitat);
                    }
                    break;
                }
                case 1: {
                    let num5 = 2000.0 + galaxy.rnd.nextDouble() * 6000.0;
                    num5 *= empireColonyIncomeFactor(empire);
                    num5 *= empireLootingFactor(empire);
                    num5 = applyCorruptionToIncome(destroyingEmpire, num5);
                    destroyingEmpire.stateMoney += num5;
                    destroyingEmpire.pirateEconomy.performIncome(num5, PirateIncomeType.Looting, galaxyStarDate(galaxy));
                    empty2 = `${pirateBase.name}: treasure worth ${num5.toFixed(0)} recovered`;
                    empty = 'Valuable Treasure Discovered';
                    sendEventMessageToEmpire(destroyingEmpire, EventMessageType.TreasureFound, empty, empty2, pirateBase, pirateBase.empire.pirateEmpireBaseHabitat);
                    break;
                }
                case 2: {
                    if (pirateBase.empire === null || empire === null) break;
                    let flag = false;
                    switch (pirateBase.subRole) {
                        case BuiltObjectSubRole.SmallSpacePort:
                        case BuiltObjectSubRole.MediumSpacePort:
                        case BuiltObjectSubRole.LargeSpacePort:
                            flag = true;
                            break;
                    }
                    if (flag) {
                        const empire2 = pirateBase.empire;
                        const num2 = Math.max(1, totalMobileMilitaryFirepower(empire.builtObjects));
                        const num3 = Math.max(1, totalMobileMilitaryFirepower(empire2.builtObjects));
                        const num4 = num2 / num3;
                        if (num4 > 2.0 && num3 < 400 && empire2.spacePorts.length <= 1 && empire2 !== null && !empire2.pirateEmpireSuperPirates && empire2 !== galaxy.playerEmpire) {
                            pirateFactionJoinsEmpire(galaxy, destroyingEmpire, empire2);
                            empty2 = `${pirateBase.name}: the ${empire2.name} join your empire`;
                            empty = 'Pirate Faction Joins Your Empire';
                            sendEventMessageToEmpire(destroyingEmpire, EventMessageType.PirateFactionJoinsYou, empty, empty2, pirateBase, pirateBase.empire.pirateEmpireBaseHabitat);
                        }
                    }
                    break;
                }
                case 3: {
                    const habitat = fastFindNearestIndependentHabitat(galaxy, galaxy.independentColonies, pirateBase.xpos, pirateBase.ypos);
                    let systemVisibilityStatus = SystemVisibilityStatus.Undefined;
                    if (habitat !== null) systemVisibilityStatus = destroyingEmpire.visibility.checkSystemVisibilityStatus(habitat.systemIndex);
                    if (systemVisibilityStatus !== SystemVisibilityStatus.Unexplored) break;
                    let race = null;
                    if (habitat!.population !== null && habitat!.population.items.length > 0 && habitat!.population.dominantRace !== null) race = habitat!.population.dominantRace;
                    if (race !== null) {
                        const habitat2 = galaxy.determineHabitatSystemStar(habitat!);
                        empty2 = `${pirateBase.name}: an independent colony of ${race.name} at ${habitat2.name}`;
                        empty = `Independent Colony of ${race.name}`;
                        // AddLocationHint (player map hint) — UI, TODO(port) M9.
                        sendEventMessageToEmpire(destroyingEmpire, EventMessageType.IndependentPopulation, empty, empty2, race, pirateBase.empire.pirateEmpireBaseHabitat);
                    }
                    break;
                }
            }
        } else {
            if (pirateBase.subRole !== BuiltObjectSubRole.SmallSpacePort && pirateBase.subRole !== BuiltObjectSubRole.MediumSpacePort && pirateBase.subRole !== BuiltObjectSubRole.LargeSpacePort) return;
            const empire2 = pirateBase.empire;
            if (empire2 === null || empire2.builtObjects === null) return;
            const num6 = Math.max(1, totalMobileMilitaryFirepower(empire.builtObjects));
            const num7 = Math.max(1, totalMobileMilitaryFirepower(empire2.builtObjects));
            const num8 = num6 / num7;
            let flag2 = true;
            if (empire2.spacePorts !== null && empire2.spacePorts.length > 0) {
                for (let j = 0; j < empire2.spacePorts.length; j++) {
                    const builtObject2 = empire2.spacePorts[j];
                    if (builtObject2 !== null && builtObject2 !== pirateBase) flag2 = false;
                }
            }
            if (flag2 && num8 > 2.0 && num7 < 200 && !empire2.pirateEmpireSuperPirates && empire2 !== destroyingEmpire && empire2 !== galaxy.playerEmpire) {
                const message = `${pirateBase.name} destroyed: the ${empire2.name} join your empire`;
                eliminatePirateFaction(galaxy, empire2, destroyingEmpire);
                const text2 = 'Pirate Faction Joins Your Empire';
                sendEventMessageToEmpire(destroyingEmpire, EventMessageType.PirateFactionJoinsYou, text2, message, pirateBase, pirateBase.empire.pirateEmpireBaseHabitat);
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Scrap (BaconBuiltObject.cs 5144 / 5160)
// ---------------------------------------------------------------------------------------------------------------

/** The clock-seeded `new Random()` of CollectScrapFromDestroyedBuiltObjects (BaconBuiltObject.cs 5183), one stream per galaxy. */
function baconCombatClockRnd(galaxy: Galaxy): Random {
    if (galaxy.baconCombatClockRnd === null) galaxy.baconCombatClockRnd = new Random((galaxy.randomSeed ^ 0x5183) | 0);
    return galaxy.baconCombatClockRnd;
}

/**
 * BaconBuiltObject.cs 5144 SaveShipInfoBeforeDestruction(shipToBeDestroyed): copies the resource cargo into the static
 * `shipsToBeDestroyed[Name]` list (galaxy.baconShipsToBeDestroyed here; the cargo owner is the player empire).
 */
export function saveShipInfoBeforeDestruction(galaxy: Galaxy, shipToBeDestroyed: BuiltObject): void {
    if (galaxy.baconShipsToBeDestroyed.has(shipToBeDestroyed.name) || shipToBeDestroyed.cargo === null) return;
    const cargoList: Cargo[] = [];
    for (const cargo1 of shipToBeDestroyed.cargo.items) {
        if (cargo1.commodityIsResource) {
            const cargo2 = new Cargo(cargo1.commodity, cargo1.amount, galaxy.playerEmpire);
            cargoList.push(cargo2);
        }
    }
    galaxy.baconShipsToBeDestroyed.set(shipToBeDestroyed.name, cargoList);
}

/**
 * BaconBuiltObject.cs 5160 CollectScrapFromDestroyedBuiltObjects(attacker, target): only for an attacker with the Bacon
 * "cash" value (a player ship). Draws its own clock Random (galaxy.baconCombatClockRnd), never Galaxy.Rnd.
 */
export function collectScrapFromDestroyedBuiltObjects(galaxy: Galaxy, attacker: BuiltObject | null, target: BuiltObject): void {
    if (attacker !== null && attacker.cargoSpace > 0 && attacker.baconValues !== null && attacker.baconValues.has('cash')) {
        const weapons = attacker.weapons;
        let num2: number;
        if (weapons === null || weapons.length === 0) {
            num2 = 1;
        } else {
            let num3 = 0;
            let num4 = 0;
            for (const weapon of weapons) {
                if (weapon.component.type === ComponentType.AssaultPod) ++num4;
                else num3 += weapon.rawDamage;
            }
            const val2 = weapons.length - num4;
            num2 = Math.fround(Math.trunc(num3 / Math.max(1, val2)));
        }
        const num5 = 10;
        const num6 = Math.fround(num2 / Math.fround(num2 + num5));
        const components = target.components;
        const componentList: BuiltObjectComponent['def'][] = [];
        const random = baconCombatClockRnd(galaxy);
        for (const component1 of components.items) {
            let num7: number;
            switch (component1.type) {
                case ComponentType.WeaponBeam:
                case ComponentType.WeaponTorpedo:
                case ComponentType.WeaponMissile:
                case ComponentType.WeaponPointDefense:
                case ComponentType.WeaponIonCannon:
                case ComponentType.WeaponIonPulse:
                case ComponentType.WeaponIonDefense:
                case ComponentType.WeaponTractorBeam:
                case ComponentType.WeaponGravityBeam:
                case ComponentType.WeaponAreaGravity:
                case ComponentType.WeaponAreaDestruction:
                case ComponentType.WeaponPhaser:
                case ComponentType.WeaponRailGun:
                    num7 = Math.fround(0.15);
                    break;
                case ComponentType.AssaultPod:
                case ComponentType.HyperDeny:
                case ComponentType.HyperStop:
                case ComponentType.Armor:
                case ComponentType.Shields:
                case ComponentType.ShieldRecharge:
                case ComponentType.HyperDrive:
                case ComponentType.StorageFuel:
                case ComponentType.StorageCargo:
                case ComponentType.SensorResourceProfileSensor:
                case ComponentType.SensorLongRange:
                case ComponentType.SensorScannerJammer:
                case ComponentType.SensorStealth:
                case ComponentType.ComputerTargetting:
                case ComponentType.ComputerCountermeasures:
                case ComponentType.DamageControl:
                    num7 = Math.fround(0.18);
                    break;
                case ComponentType.EngineMainThrust:
                case ComponentType.EngineVectoring:
                case ComponentType.Reactor:
                case ComponentType.EnergyCollector:
                case ComponentType.EnergyToFuel:
                    num7 = Math.fround(0.2);
                    break;
                default:
                    num7 = Math.fround(0.1);
                    break;
            }
            const num8 = random.nextDouble();
            const num9 = random.nextDouble();
            if (num7 > 0.0099999997764825821 && num8 < num7 && num9 > num6) componentList.push(component1.def);
        }
        if (componentList.length > 0) {
            if (attacker.baconValues === null) attacker.baconValues = new Map<string, unknown>();
            if (!attacker.baconValues.has('scrapComponents')) attacker.baconValues.set('scrapComponents', []);
            const baconValue = attacker.baconValues.get('scrapComponents') as BuiltObjectComponent['def'][];
            for (const component of componentList) baconValue.push(component);
            attacker.baconValues.set('scrapComponents', baconValue);
        }
        let cargo1: Cargo[] | null = target.cargo !== null ? target.cargo.items : null;
        if (galaxy.baconShipsToBeDestroyed.has(target.name)) cargo1 = galaxy.baconShipsToBeDestroyed.get(target.name)!;
        const cargoList: Cargo[] = [];
        if (cargo1 !== null && cargo1.length > 0) {
            for (const cargo2 of cargo1) {
                if (cargo2.commodityIsResource) {
                    let amount = 0;
                    for (let index = 0; index < cargo2.amount; ++index) {
                        if (random.nextDouble() > num6) ++amount;
                    }
                    if (amount > 0) cargoList.push(new Cargo(new ResourceRef(cargo2.commodity.resourceId), amount, attacker.actualEmpire!.empireId));
                }
            }
        }
        if (cargoList.length > 0) {
            for (const cargo of cargoList) {
                const cargo4 = attacker.cargo!.items.find((x) => x.commodity.resourceId === cargo.commodity.resourceId) ?? null;
                if (cargo4 !== null) cargo4.amount += cargo.amount;
                else attacker.cargo!.add(cargo);
            }
        }
    }
    if (!galaxy.baconShipsToBeDestroyed.has(target.name)) return;
    galaxy.baconShipsToBeDestroyed.delete(target.name);
}

// ---------------------------------------------------------------------------------------------------------------
// BuiltObject.2.cs 6216 InflictDamage
// ---------------------------------------------------------------------------------------------------------------

/** BuiltObjectComponentList this[category, status]: the first component of that category with that status. */
function firstComponentByCategoryAndStatus(components: BuiltObjectComponent[], category: ComponentCategoryType, status: ComponentStatus): BuiltObjectComponent | null {
    for (let i = 0; i < components.length; i++) {
        const c = components[i];
        if (c.category === category && c.status === status) return c;
    }
    return null;
}

/** BuiltObject.CaptainDamageControlBonus = _CaptainBonuses.DamageControl / 100 (100 until ReviewCaptainBonuses). */
function captainDamageControlBonus(bo: BuiltObject): number {
    const bonuses = captainBonuses(bo);
    return (bonuses !== null ? bonuses.damageControl : 100) / 100.0;
}

/** BuiltObject.2.cs 6211 InflictDamage(target, weapon, hitPower, time, galaxy, weaponDistanceTravelled, strikeAngle) = the 9-arg form with allowRecursion, no armor invulnerability. */
export function inflictDamage(galaxy: Galaxy, self: BuiltObject, target: StellarObject | FighterLike, weapon: Weapon | null, hitPower: number, time: number, weaponDistanceTravelled: number, strikeAngle: number): boolean {
    return inflictDamageFull(galaxy, self, target, weapon, hitPower, time, weaponDistanceTravelled, true, strikeAngle, false);
}

/**
 * BuiltObject.2.cs 6216 InflictDamage(abstractTarget, weapon, hitPower, time, galaxy, weaponDistanceTravelled, allowRecursion,
 * strikeAngle, allowArmorInvulnerability). Returns true when the target was destroyed.
 * Rnd (BuiltObject target, hull hit): [railgun NextDouble]; armor loop: [NextDouble (absorbed roll)], NextDouble (armor
 * damage roll) per armor plate; destroyed: Next(10, 20); else component loop Next(0, Components.Count)×k [+ Next(0, Troops.Count)],
 * then Next(0, 10), Next(0, n), Next(0, 2), Next(0, n), Next(0, 2). Fighter target: Next(10, 20) or the 5-draw explosion.
 */
export function inflictDamageFull(
    galaxy: Galaxy,
    self: BuiltObject,
    abstractTarget: StellarObject | FighterLike,
    weapon: Weapon | null,
    hitPower: number,
    time: number,
    weaponDistanceTravelled: number,
    allowRecursion: boolean,
    strikeAngle: number,
    allowArmorInvulnerability: boolean,
): boolean {
    hitPower *= baconInflictDamageMultiplier(self);
    const selfBattleStats = battleStatsOf(self);
    const selfGroupStats = shipGroupBattleStats(self);
    if (isCreature(abstractTarget)) {
        const creature: Creature = abstractTarget;
        // BuiltObject.2.cs 6227 creature.DamageCreature(this, (int)hitPower, weapon).
        if (creature.damageCreature(self, csInt(hitPower), weapon)) {
            if (creature.type === CreatureType.SilverMist && self.empire !== null) self.empire.civilityRating += DESTROY_SILVER_MIST_REPUTATION_BONUS;
            // BuiltObject.2.cs 6233 _Galaxy.CheckTriggerEvent(creature.GameEventId, ActualEmpire, Destroy, null) (story/eventActions.ts, M4z3).
            checkTriggerEvent(galaxy, creature.gameEventId, self.actualEmpire, EventTriggerType.Destroy, null);
            if (galaxy.scenario !== null) scenarioEmit(galaxy, 'creatureKilled', { creature, killer: self, empire: self.actualEmpire }); // mod layer (19j)
            creature.completeTeardown();
            return true;
        }
    } else if (isFighterLike(abstractTarget)) {
        const fighter = abstractTarget;
        if (selfBattleStats !== null) selfBattleStats.weaponHitEnemy(hitPower, weaponDistanceTravelled);
        if (selfGroupStats !== null) selfGroupStats.weaponHitEnemy(hitPower, weaponDistanceTravelled);
        const parentStats = fighter.parentBuiltObject !== null ? battleStatsOf(fighter.parentBuiltObject) : null;
        const parentGroupStats = fighter.parentBuiltObject !== null ? shipGroupBattleStats(fighter.parentBuiltObject) : null;
        if (fighter.currentShields >= hitPower) {
            fighter.currentShields = Math.fround(fighter.currentShields - Math.fround(hitPower));
            fighter.lastShieldStrike = time;
            fighter.lastShieldStrikeDirection = Math.fround(strikeAngle);
            if (parentStats !== null) parentStats.shieldsStruckUs(hitPower);
            if (parentGroupStats !== null) parentGroupStats.shieldsStruckUs(hitPower);
        } else {
            let num = csInt(Math.fround(Math.fround(Math.fround(hitPower) - fighter.currentShields) + 0.5));
            if (parentStats !== null) parentStats.shieldsStruckUs(fighter.currentShields);
            if (parentGroupStats !== null) parentGroupStats.shieldsStruckUs(fighter.currentShields);
            fighter.currentShields = 0;
            if (num > fighter.size) num = fighter.size;
            if (parentStats !== null) parentStats.damageHullUs(num);
            if (parentGroupStats !== null) parentGroupStats.damageHullUs(num);
            if (Math.fround(Math.fround(fighter.size) * fighter.health) <= num && !fighter.hasBeenDestroyed) {
                fighter.health = 0;
                fighter.hasBeenDestroyed = true;
                if (selfBattleStats !== null) selfBattleStats.fighterDestroyedEnemy();
                if (selfGroupStats !== null) selfGroupStats.fighterDestroyedEnemy();
                if (parentStats !== null) parentStats.fighterDestroyedFriendly();
                if (parentGroupStats !== null) parentGroupStats.fighterDestroyedFriendly();
                if (self.empire !== null && self.empire !== galaxy.independentEmpire && fighter.empire !== null && fighter.empire.pirateEmpireBaseHabitat !== null) {
                    const num2 = 0.015;
                    self.empire.civilityRating += num2;
                }
                const explosion = new Explosion();
                explosion.explosionStart = time;
                explosion.explosionSize = toShort(Math.trunc(Math.sqrt(fighter.size * 0.3) * (Math.PI / 4.0) * 30.0));
                explosion.explosionProgression = 0;
                explosion.explosionOffsetX = 0;
                explosion.explosionOffsetY = 0;
                explosion.explosionImageIndex = toShort(galaxy.rnd.next(10, 20));
                explosion.explosionWillDestroy = true;
                fighter.explosions.push(explosion);
                inflictWarDamageFighter(galaxy, self.empire, fighter);
                if (fighter.empire !== null) fighter.empire.visibility.resolveSystemVisibilityAt(fighter.xpos, fighter.ypos, null, null);
                return true;
            }
            fighter.health = Math.fround(fighter.health - Math.fround(num / fighter.size));
            fighter.overlayChanged = true;
            const explosion2 = new Explosion();
            explosion2.explosionStart = time;
            if (weapon !== null && weapon.component !== null && weapon.component.type === ComponentType.WeaponMissile) {
                explosion2.explosionSize = toShort(Math.trunc(Math.sqrt(num * 0.7) * (Math.PI / 4.0) * 30.0));
            } else {
                explosion2.explosionSize = toShort(Math.trunc(Math.sqrt(num * 0.3) * (Math.PI / 4.0) * 30.0));
            }
            if (explosion2.explosionSize < 5) explosion2.explosionSize = 5;
            explosion2.explosionProgression = 0;
            explosion2.explosionImageIndex = toShort(galaxy.rnd.next(0, 10));
            let num3 = galaxy.rnd.next(0, csInt(Math.sqrt(fighter.size) * 0.7));
            if (galaxy.rnd.next(0, 2) === 0) num3 *= -1;
            let num4 = galaxy.rnd.next(0, csInt(Math.sqrt(fighter.size) * 0.7));
            if (galaxy.rnd.next(0, 2) === 0) num4 *= -1;
            explosion2.explosionOffsetX = toShort(num3);
            explosion2.explosionOffsetY = toShort(num4);
            explosion2.explosionWillDestroy = false;
            fighter.explosions.push(explosion2);
        }
    } else if (isBuiltObject(abstractTarget)) {
        const builtObject = abstractTarget;
        if (selfBattleStats !== null) selfBattleStats.weaponHitEnemy(hitPower, weaponDistanceTravelled);
        if (selfGroupStats !== null) selfGroupStats.weaponHitEnemy(hitPower, weaponDistanceTravelled);
        let flag = false;
        let flag2 = false;
        let flag3 = false;
        if (weapon !== null && weapon.component !== null) {
            switch (weapon.component.type) {
                case ComponentType.WeaponRailGun:
                case ComponentType.WeaponSuperRailGun:
                    flag = true;
                    break;
                case ComponentType.WeaponPhaser:
                case ComponentType.WeaponSuperPhaser:
                    flag2 = true;
                    break;
                case ComponentType.WeaponGravityBeam:
                case ComponentType.WeaponAreaGravity:
                    flag3 = true;
                    break;
            }
        }
        const targetStats = battleStatsOf(builtObject);
        const targetGroupStats = shipGroupBattleStats(builtObject);
        if (builtObject.currentShields >= hitPower && !flag && !flag3) {
            builtObject.currentShields = Math.fround(builtObject.currentShields - Math.fround(hitPower));
            if (!flag2) builtObject.lastShieldStrike = time;
            builtObject.lastShieldStrikeDirection = Math.fround(strikeAngle);
            if (targetStats !== null) targetStats.shieldsStruckUs(hitPower);
            if (targetGroupStats !== null) targetGroupStats.shieldsStruckUs(hitPower);
            chanceAttackedPirateFactionJoinsPhantomPirates(galaxy, self.empire, builtObject);
        } else {
            let num5 = csInt(Math.fround(Math.fround(Math.fround(hitPower) - builtObject.currentShields) + 0.5));
            if (flag3) {
                num5 = csInt(Math.fround(Math.fround(hitPower) + 0.5));
            } else if (flag) {
                const num6 = 0.25 + galaxy.rnd.nextDouble() * 0.5;
                const num7 = hitPower * num6;
                const num8 = hitPower - num7;
                if (num8 > 0.0) {
                    builtObject.currentShields = Math.fround(builtObject.currentShields - Math.fround(num8));
                    if (!flag2) builtObject.lastShieldStrike = time;
                    builtObject.lastShieldStrikeDirection = Math.fround(strikeAngle);
                    if (targetStats !== null) targetStats.shieldsStruckUs(num8);
                    if (targetGroupStats !== null) targetGroupStats.shieldsStruckUs(num8);
                    chanceAttackedPirateFactionJoinsPhantomPirates(galaxy, self.empire, builtObject);
                }
                num5 = csInt(num7);
            } else {
                if (targetStats !== null) targetStats.shieldsStruckUs(builtObject.currentShields);
                if (targetGroupStats !== null) targetGroupStats.shieldsStruckUs(builtObject.currentShields);
                builtObject.currentShields = 0;
            }
            if (builtObject.damageRepair > 0 && builtObject.damagedComponentCount === 0) {
                builtObject.lastRepair = galaxyStarDate(galaxy);
            }
            if (builtObject.armor > 0 && !flag3 && builtObject.components !== null) {
                let builtObjectComponent = firstComponentByCategoryAndStatus(builtObject.components.items, ComponentCategoryType.Armor, ComponentStatus.Normal);
                const iterationCount = { count: 0 };
                while (conditionCheckLimit(builtObjectComponent !== null && num5 > 0, 500, iterationCount)) {
                    if (num5 < 1073741823 && builtObjectComponent!.value2 > 0) {
                        let num10 = builtObjectComponent!.value2 * armorReactivityMultiplier(builtObject);
                        if (builtObject.armorReinforcingFactor > 0) num10 = csInt(num10 * (builtObject.armorReinforcingFactor / 100.0));
                        if (weapon !== null && weapon.component !== null) {
                            const type = weapon.component.type;
                            if ((type === ComponentType.WeaponPhaser || type === ComponentType.WeaponSuperPhaser) && num10 > 0) num10 = Math.max(1, Math.trunc(num10 / 2));
                        }
                        if (num5 <= num10) {
                            if (allowArmorInvulnerability) {
                                num5 = 0;
                            } else {
                                const num11 = num10 / num5;
                                const num12 = galaxy.rnd.nextDouble() * num11;
                                num5 = num12 < 0.2 ? 1 : 0;
                            }
                        } else {
                            num5 -= num10;
                        }
                    }
                    if (num5 <= 0) continue;
                    if (weapon !== null && weapon.component !== null) {
                        switch (weapon.component.type) {
                            case ComponentType.WeaponMissile:
                            case ComponentType.WeaponRailGun:
                            case ComponentType.WeaponSuperMissile:
                            case ComponentType.WeaponSuperRailGun:
                                num5 = Math.max(1, Math.trunc(num5 / 2));
                                break;
                        }
                    }
                    let num13 = builtObjectComponent!.value1;
                    if (builtObject.armorReinforcingFactor > 0) num13 = csInt(num13 * (builtObject.armorReinforcingFactor / 100.0));
                    let val = num5 / num13;
                    val = Math.max(0.1, val);
                    if (galaxy.rnd.nextDouble() < val) builtObjectComponent!.status = ComponentStatus.Damaged;
                    num5 -= num13;
                    builtObjectComponent = firstComponentByCategoryAndStatus(builtObject.components.items, ComponentCategoryType.Armor, ComponentStatus.Normal);
                }
            }
            let num14 = builtObject.damageReduction;
            const targetShipGroup = shipGroupOf(builtObject);
            if (targetShipGroup !== null) num14 *= targetShipGroup.damageControlBonus;
            num14 *= captainDamageControlBonus(builtObject);
            num5 = csInt(num5 + 0.49 - num5 * num14);
            if (num5 > builtObject.size) num5 = builtObject.size;
            if (targetStats !== null) targetStats.damageHullUs(num5);
            if (targetGroupStats !== null) targetGroupStats.damageHullUs(num5);
            saveShipInfoBeforeDestruction(galaxy, builtObject);
            if (builtObject.undamagedComponentSize <= num5 && !builtObject.hasBeenDestroyed) {
                if (selfBattleStats !== null) selfBattleStats.targetDestroyedEnemy(builtObject);
                if (selfGroupStats !== null) selfGroupStats.targetDestroyedEnemy(builtObject);
                if (targetStats !== null) targetStats.targetDestroyedFriendly(builtObject);
                if (targetGroupStats !== null) targetGroupStats.targetDestroyedFriendly(builtObject);
                // BuiltObject.2.cs 6568 _Galaxy.CheckTriggerEvent(builtObject.GameEventId, ActualEmpire, Destroy, null) (story/eventActions.ts, M4z3).
                checkTriggerEvent(galaxy, builtObject.gameEventId, self.actualEmpire, EventTriggerType.Destroy, null);
                if (self.empire !== null && self.empire !== galaxy.independentEmpire && builtObject.empire !== null && builtObject.empire.pirateEmpireBaseHabitat !== null) {
                    let num15 = 0.05;
                    switch (builtObject.subRole) {
                        case BuiltObjectSubRole.SmallSpacePort:
                            num15 = 0.25;
                            break;
                        case BuiltObjectSubRole.MediumSpacePort:
                            num15 = 0.35;
                            break;
                        case BuiltObjectSubRole.LargeSpacePort:
                            num15 = 0.5;
                            break;
                    }
                    self.empire.civilityRating += num15;
                }
                if (self.role !== BuiltObjectRole.Base) {
                    chanceRaceEvent(galaxy, builtObject, self);
                    if (!chanceNewShipCaptain(galaxy, builtObject, self.empire, self)) chanceNewFleetAdmiral(galaxy, builtObject, self.empire, self);
                }
                if (self.empire !== null && self.empire.counters !== null) self.empire.counters.processBuiltObjectDestruction(builtObject);
                if (galaxy.scenario !== null) scenarioEmit(galaxy, 'builtObjectKilledBy', { builtObject, destroyer: self.empire }); // mod layer
                const explosion3 = new Explosion();
                explosion3.explosionStart = galaxyNow(galaxy);
                explosion3.explosionSize = toShort(Math.trunc(Math.sqrt(builtObject.components.count) * (Math.PI / 4.0) * 30.0));
                explosion3.explosionProgression = 0;
                explosion3.explosionOffsetX = 0;
                explosion3.explosionOffsetY = 0;
                explosion3.explosionImageIndex = toShort(galaxy.rnd.next(10, 20));
                explosion3.explosionWillDestroy = true;
                builtObject.explosions.push(explosion3);
                collectScrapFromDestroyedBuiltObjects(galaxy, self, builtObject);
                builtObject.hasBeenDestroyed = true;
                inflictWarDamageBuiltObject(galaxy, self.empire, builtObject);
                if (allowRecursion) {
                    const galaxyIndex = galaxy.resolveIndex(builtObject.xpos, builtObject.ypos);
                    const cell = galaxy.builtObjectIndexGrid[galaxyIndex.x][galaxyIndex.y];
                    for (let i = 0; i < cell.length; i++) {
                        const builtObject2 = cell[i];
                        if (builtObject2 != null && builtObject2 !== builtObject && checkWithinDistancePotential(400.0, builtObject.xpos, builtObject.ypos, builtObject2.xpos, builtObject2.ypos)) {
                            const num16 = galaxy.calculateDistance(builtObject.xpos, builtObject.ypos, builtObject2.xpos, builtObject2.ypos);
                            const num17 = builtObject.size * 0.25 - num16 * 2.0;
                            if (num17 > 0.0) inflictDamageFull(galaxy, self, builtObject2, null, num17, time, weaponDistanceTravelled, false, -Number.MAX_VALUE, false);
                        }
                    }
                }
                if (builtObject.empire !== null) builtObject.empire.visibility.resolveSystemVisibilityAt(builtObject.xpos, builtObject.ypos, builtObject, null);
                const constructionQueue = builtObject.constructionQueue as { constructionYards: { shipUnderConstruction: BuiltObject | null }[] | null } | null;
                if (constructionQueue !== null && constructionQueue.constructionYards !== null && countUnderConstruction(constructionQueue.constructionYards) > 0) {
                    for (const constructionYard of constructionQueue.constructionYards) {
                        const shipUnderConstruction = constructionYard.shipUnderConstruction;
                        if (shipUnderConstruction !== null) inflictDamageFull(galaxy, shipUnderConstruction, shipUnderConstruction, null, Number.MAX_VALUE, time, weaponDistanceTravelled, false, -Number.MAX_VALUE, false);
                    }
                }
                builtObject.reDefine();
                return true;
            }
            const num18 = num5;
            if (builtObject.components !== null) {
                const components = builtObject.components.items;
                const iterationCount2 = { count: 0 };
                while (conditionCheckLimit(num5 > 0, 500, iterationCount2)) {
                    let num19 = 0;
                    let num20 = 0;
                    do {
                        num19 = galaxy.rnd.next(0, components.length);
                        num20++;
                    } while (num20 <= 30 && num19 < components.length && components[num19].status === ComponentStatus.Damaged);
                    if (num19 >= components.length) continue;
                    if (components[num19].status === ComponentStatus.Damaged) {
                        // RND: _Galaxy.ReseedRandom() (BuiltObject.2.cs 6663 → Galaxy.cs 3033, clock reseed) is not performed (plan §0).
                    }
                    components[num19].status = ComponentStatus.Damaged;
                    if (builtObject.role !== BuiltObjectRole.Base) {
                        switch (components[num19].type) {
                            case ComponentType.StorageCargo: {
                                let num22 = components[num19].value1;
                                if (builtObject.cargo === null || builtObject.cargo.items.length <= 0) break;
                                const cargoList: Cargo[] = [];
                                for (let j = 0; j < builtObject.cargo.items.length; j++) {
                                    const cargo = builtObject.cargo.items[j];
                                    if (num22 <= 0) break;
                                    if (cargo.amount > num22) {
                                        cargo.amount -= num22;
                                        num22 = 0;
                                        break;
                                    }
                                    if (cargo.amount > 0) {
                                        num22 -= cargo.amount;
                                        cargoList.push(cargo);
                                    }
                                }
                                for (const item of cargoList) builtObject.cargo.remove(item);
                                break;
                            }
                            case ComponentType.StorageFuel: {
                                const value2 = components[num19].value1;
                                if (builtObject.currentFuel > 0.0) {
                                    builtObject.currentFuel -= value2;
                                    if (builtObject.currentFuel < 0.0) builtObject.currentFuel = 0.0;
                                }
                                break;
                            }
                            case ComponentType.StorageTroop: {
                                const value = components[num19].value1;
                                if (builtObject.troops === null || builtObject.troopCapacity <= 0 || builtObject.troops.totalSize <= 0) break;
                                builtObject.troopCapacity -= value;
                                if (builtObject.troops.totalSize <= builtObject.troopCapacity) break;
                                const num21 = galaxy.rnd.next(0, builtObject.troops.count);
                                if (num21 < builtObject.troops.count) {
                                    if (builtObject.empire !== null && builtObject.empire.troops !== null) builtObject.empire.troops.remove(builtObject.troops.items[num21]);
                                    builtObject.troops.items.splice(num21, 1);
                                }
                                break;
                            }
                        }
                    }
                    num5 -= components[num19].size;
                }
            }
            builtObject.reDefine();
            if (builtObject.role !== BuiltObjectRole.Base && builtObject.damagedComponentCount > 0) builtObject.repairForNextMission = true;
            const explosion4 = new Explosion();
            explosion4.explosionStart = galaxyNow(galaxy);
            explosion4.explosionSize = toShort(Math.trunc(Math.sqrt(num18) * (Math.PI / 4.0) * 30.0));
            if (weapon !== null && weapon.component !== null && weapon.component.type === ComponentType.WeaponMissile) {
                explosion4.explosionSize = toShort(Math.trunc(Math.sqrt(num18 * 2.3) * (Math.PI / 4.0) * 30.0));
            } else {
                explosion4.explosionSize = toShort(Math.trunc(Math.sqrt(num18) * (Math.PI / 4.0) * 30.0));
            }
            if (explosion4.explosionSize < 10) explosion4.explosionSize = 10;
            explosion4.explosionProgression = 0;
            explosion4.explosionImageIndex = toShort(galaxy.rnd.next(0, 10));
            let num23 = galaxy.rnd.next(0, csInt(Math.sqrt(builtObject.size) * 0.7));
            if (galaxy.rnd.next(0, 2) === 0) num23 *= -1;
            let num24 = galaxy.rnd.next(0, csInt(Math.sqrt(builtObject.size) * 0.7));
            if (galaxy.rnd.next(0, 2) === 0) num24 *= -1;
            explosion4.explosionOffsetX = toShort(num23);
            explosion4.explosionOffsetY = toShort(num24);
            explosion4.explosionWillDestroy = false;
            builtObject.explosions.push(explosion4);
        }
    }
    return false;
}

/** ConstructionYardList.CountUnderConstruction. */
function countUnderConstruction(yards: { shipUnderConstruction: BuiltObject | null }[]): number {
    let n = 0;
    for (let i = 0; i < yards.length; i++) if (yards[i].shipUnderConstruction !== null) ++n;
    return n;
}

// ---------------------------------------------------------------------------------------------------------------
// BuiltObject.2.cs 6127 / Habitat.cs 2350 InflictIonDamage
// ---------------------------------------------------------------------------------------------------------------

function isWeaponCategory(category: ComponentCategoryType): boolean {
    switch (category) {
        case ComponentCategoryType.WeaponBeam:
        case ComponentCategoryType.WeaponTorpedo:
        case ComponentCategoryType.WeaponArea:
        case ComponentCategoryType.WeaponPointDefense:
        case ComponentCategoryType.WeaponIon:
        case ComponentCategoryType.WeaponGravity:
        case ComponentCategoryType.WeaponSuperBeam:
        case ComponentCategoryType.WeaponSuperArea:
        case ComponentCategoryType.WeaponSuperTorpedo:
            return true;
        default:
            return false;
    }
}

/**
 * BuiltObject.2.cs 6127 InflictIonDamage(target, weapon, hitPower, time, galaxy, strikeAngle). Rnd: Next(0, 2), then
 * Next(15000, 25000) per component disabled.
 */
export function inflictIonDamage(galaxy: Galaxy, self: BuiltObject, target: StellarObject, weapon: Weapon | null, hitPower: number, time: number, strikeAngle: number): number {
    void strikeAngle;
    hitPower *= baconInflictDamageMultiplier(self);
    if (isCreature(target)) {
        const creature = target;
        // BuiltObject.2.cs 6133 creature.DamageCreature(this, (int)hitPower, weapon): full damage from an ion weapon.
        if (creature.type === CreatureType.SilverMist && creature.damageCreature(self, csInt(hitPower), weapon)) {
            // BuiltObject.2.cs 6135 CheckTriggerEvent(creature.GameEventId, Empire, Destroy) (story/eventActions.ts, M4z3).
            checkTriggerEvent(galaxy, creature.gameEventId, self.empire, EventTriggerType.Destroy, null);
            if (creature.type === CreatureType.SilverMist && self.empire !== null) self.empire.civilityRating += DESTROY_SILVER_MIST_REPUTATION_BONUS;
            if (galaxy.scenario !== null) scenarioEmit(galaxy, 'creatureKilled', { creature, killer: self, empire: self.empire }); // mod layer (19j)
            creature.completeTeardown();
        }
    } else if (isBuiltObject(target)) {
        const builtObject = target;
        builtObject.ionStrikeSoundPlayed = false;
        if (builtObject.disabledComponentIndexes === null) builtObject.disabledComponentIndexes = [];
        if (builtObject.disabledComponentDurations === null) builtObject.disabledComponentDurations = [];
        if (builtObject.ionDefense > 0) hitPower -= builtObject.ionDefense;
        if (hitPower > 0.0) {
            const components = builtObject.components.items;
            if (galaxy.rnd.next(0, 2) === 1 && (builtObject.firepowerRaw > 0 || builtObject.bombardWeaponPower > 0)) {
                for (let i = 0; i < components.length; i++) {
                    if (hitPower <= 0.0) return hitPower;
                    if (isWeaponCategory(components[i].category)) {
                        if (components[i].status === ComponentStatus.Normal && !builtObject.disabledComponentIndexes.includes(toShort(i))) {
                            builtObject.disabledComponentIndexes.push(toShort(i));
                            builtObject.disabledComponentDurations.push(toShort(galaxy.rnd.next(15000, 25000)));
                            builtObject.reDefine();
                            builtObject.lastIonStrike = time;
                            hitPower -= 10.0;
                        }
                    }
                }
            } else if (builtObject.topSpeed > 0 || builtObject.turnRate > Math.fround(0.1)) {
                for (let j = 0; j < components.length; j++) {
                    if (hitPower <= 0.0) return hitPower;
                    const category = components[j].category;
                    if (category === ComponentCategoryType.Engine && components[j].status === ComponentStatus.Normal && !builtObject.disabledComponentIndexes.includes(toShort(j))) {
                        builtObject.disabledComponentIndexes.push(toShort(j));
                        builtObject.disabledComponentDurations.push(toShort(galaxy.rnd.next(15000, 25000)));
                        builtObject.reDefine();
                        builtObject.lastIonStrike = time;
                        hitPower -= 10.0;
                    }
                }
            }
        }
    }
    return hitPower;
}

/** Habitat.cs 2350 InflictIonDamage(target, hitPower, time, galaxy, strikeAngle) (the giant ion cannon). Rnd: Next(20000, 30000) per component disabled. */
export function habitatInflictIonDamage(galaxy: Galaxy, self: Habitat, target: StellarObject, hitPower: number, time: number, strikeAngle: number): number {
    void strikeAngle;
    if (isCreature(target)) {
        const creature = target;
        // Habitat.cs 2355 creature.DamageCreature(this, (int)hitPower, GiantIonCannon).
        if (creature.damageCreature(self, csInt(hitPower), self.giantIonCannon)) {
            // Habitat.cs 2357 CheckTriggerEvent(creature.GameEventId, Empire, Destroy) (story/eventActions.ts, M4z3).
            checkTriggerEvent(galaxy, creature.gameEventId, self.empire, EventTriggerType.Destroy, null);
            if (creature.type === CreatureType.SilverMist && self.empire !== null) self.empire.civilityRating += DESTROY_SILVER_MIST_REPUTATION_BONUS;
            if (galaxy.scenario !== null) scenarioEmit(galaxy, 'creatureKilled', { creature, killer: self, empire: self.empire }); // mod layer (19j)
            creature.completeTeardown();
        }
    } else if (isBuiltObject(target)) {
        const builtObject = target;
        if (builtObject.disabledComponentIndexes === null) builtObject.disabledComponentIndexes = [];
        if (builtObject.disabledComponentDurations === null) builtObject.disabledComponentDurations = [];
        if (builtObject.ionDefense > 0) hitPower -= builtObject.ionDefense;
        if (hitPower > 0.0) {
            const components = builtObject.components.items;
            for (let i = 0; i < components.length; i++) {
                if (hitPower <= 0.0) return hitPower;
                const category = components[i].category;
                if (isWeaponCategory(category) || category === ComponentCategoryType.Engine) {
                    if (components[i].status === ComponentStatus.Normal && !builtObject.disabledComponentIndexes.includes(toShort(i))) {
                        builtObject.disabledComponentIndexes.push(toShort(i));
                        builtObject.disabledComponentDurations.push(toShort(galaxy.rnd.next(20000, 30000)));
                        builtObject.reDefine();
                        builtObject.lastIonStrike = time;
                        hitPower -= 10.0;
                    }
                }
            }
        }
    }
    return hitPower;
}

// ---------------------------------------------------------------------------------------------------------------
// BuiltObject.2.cs 5816 InflictBombardDamage
// ---------------------------------------------------------------------------------------------------------------

/** TroopList.cs 116 GetArtilleryTroopDefendStrength. */
export function getArtilleryTroopDefendStrength(troops: TroopList): number {
    let troopDefendStrength = 0.0;
    for (let index = 0; index < troops.count; ++index) {
        const troop: Troop = troops.items[index];
        if (troop != null && troop.type === TroopType.Artillery) troopDefendStrength += troop.overallDefendStrength;
    }
    return troopDefendStrength;
}

/** BuiltObject.2.cs 5883 / 5891: the PirateBase / PirateFortress / PirateCriminalNetwork type test. */
function isPirateFacilityType(type: PlanetaryFacilityType): boolean {
    return type === PlanetaryFacilityType.PirateBase || type === PlanetaryFacilityType.PirateFortress || type === PlanetaryFacilityType.PirateCriminalNetwork;
}
/** PlanetaryFacilityList.cs 214 SelectRandomFacility(excludeType). Rnd: Next(0, Count) × (1..11). */
export function selectRandomFacility(galaxy: Galaxy, facilities: PlanetaryFacility[], excludeType: PlanetaryFacilityType): PlanetaryFacility | null {
    let planetaryFacility: PlanetaryFacility | null = null;
    if (facilities.length > 0) {
        let num = 0;
        for (planetaryFacility = facilities[galaxy.rnd.next(0, facilities.length)]; (planetaryFacility == null || planetaryFacility.type === excludeType) && num < 10; ++num) {
            planetaryFacility = facilities[galaxy.rnd.next(0, facilities.length)];
        }
        if (planetaryFacility != null && planetaryFacility.type === excludeType) planetaryFacility = null;
    }
    return planetaryFacility;
}

/**
 * BuiltObject.2.cs 5816 InflictBombardDamage(habitat, bombardPower). Rnd (no planetary shield): [Next(0, 1000), Next(0, Characters.Count)],
 * [Next(0, 1000), Next(0, InvadingCharacters.Count)], [Next(0, 3000), SelectRandomFacility draws, Next(0, 2)]; then always
 * Next(0, 10), Next(0, d), Next(0, 2), Next(0, d), Next(0, 2) for the explosion.
 */
export function inflictBombardDamage(galaxy: Galaxy, self: BuiltObject, habitat: Habitat, bombardPower: number): void {
    const empire = habitat.empire;
    if (!habitat.planetaryShieldPresent) {
        if (bombardPower > 1 && habitat.troops !== null) {
            let num = getArtilleryTroopDefendStrength(habitat.troops);
            if (num > 0.0) {
                if (empire !== null) num *= Math.fround(empire.troopPlanetaryDefenseInterceptBonusFactor);
                num /= 7500.0;
                num = Math.sqrt(num);
                num = 0.5 + num;
                num = Math.max(1.0, num);
                bombardPower = Math.max(1, csInt(bombardPower / num));
            }
        }
        const num2 = Math.fround(Math.fround(bombardPower) / 8000);
        habitat.damage = Math.fround(habitat.damage + num2);
        habitat.damage = Math.min(1, habitat.damage);
        // habitat.RecalculateQuality(): the TS Quality is a live getter (types.ts 176).
        if (habitat.troops !== null && habitat.troops.count > 0) inflictTroopLosses(galaxy, habitat, self.empire, self.empire, bombardPower * 1.5, habitat.troops, null);
        if (habitat.invadingTroops !== null && habitat.invadingTroops.count > 0) inflictTroopLosses(galaxy, habitat, self.empire, self.empire, bombardPower * 1.5, habitat.invadingTroops, null);
        const characters = stellarObjectCharacters(habitat);
        if (characters !== null && characters.length > 0 && galaxy.rnd.next(0, 1000) < bombardPower) {
            const character = characters[galaxy.rnd.next(0, characters.length)];
            if (self.empire !== null && self.empire.counters !== null) self.empire.counters.processCharacterDeath(character);
            characterSendDeathMessage(galaxy, character, CharacterDeathType.ColonyBombardment);
            character.kill(galaxy);
        }
        // BuiltObject.2.cs 5859-5868 (M4q): Habitat.InvadingCharacters.
        const invadingChars = habitatInvadingCharacterList(habitat);
        if (invadingChars !== null && invadingChars.length > 0 && galaxy.rnd.next(0, 1000) < bombardPower) {
            const character2 = invadingChars[galaxy.rnd.next(0, invadingChars.length)];
            if (self.empire !== null && self.empire.counters !== null) self.empire.counters.processCharacterDeath(character2);
            characterSendDeathMessage(galaxy, character2, CharacterDeathType.ColonyBombardment);
            character2.kill(galaxy);
        }
        if (habitat.empire !== null && habitat.empire.troops !== null && habitat.troopsToRecruit !== null && habitat.troopsToRecruit.count > 0) {
            for (let i = 0; i < habitat.troopsToRecruit.count; i++) habitat.empire.troops.remove(habitat.troopsToRecruit.items[i]);
            habitat.troopsToRecruit.clear();
        }
        const facilities = habitat.facilities;
        if (facilities !== null && facilities.length > 0 && galaxy.rnd.next(0, 3000) < bombardPower) {
            // BuiltObject.2.cs 5879-5891: PlanetaryFacility.Type (PlanetaryFacilityType enum) comparisons.
            const planetaryFacility = selectRandomFacility(galaxy, facilities, PlanetaryFacilityType.PirateCriminalNetwork);
            if (planetaryFacility !== null) {
                let flag = true;
                if (isPirateFacilityType(planetaryFacility.type) && galaxy.rnd.next(0, 2) === 1) flag = false;
                if (flag) {
                    facilities.splice(facilities.indexOf(planetaryFacility), 1);
                    checkRemoveFacilityTracking(habitat, planetaryFacility);
                    if (isPirateFacilityType(planetaryFacility.type)) {
                        // BuiltObject.2.cs 5896-5911 (PirateColonyControl ported by M4s2).
                        const byFacilityControl = habitat.pirateColonyControl.getByFacilityControl();
                        if (byFacilityControl !== null) {
                            const planetaryFacility2 = facilitiesFindBestPirateFacility(habitat.facilities ?? [], true);
                            if (planetaryFacility2 === null) {
                                byFacilityControl.hasFacilityControl = false;
                                byFacilityControl.controlLevel = Math.min(Math.fround(0.49), Math.max(Math.fround(0.01), Math.fround(byFacilityControl.controlLevel - Math.fround(0.2))));
                            }
                            const empireById = getEmpireById(galaxy, byFacilityControl.empireId);
                            if (empireById !== null) {
                                const description = gameText('Bombardment Destroys Facility Description', planetaryFacility.name, self.name);
                                sendMessageToEmpire(empireById, empireById, EmpireMessageType.PlanetaryFacilityDestroyed, planetaryFacility, description);
                            }
                        }
                    } else if (habitat.empire !== null) {
                        const description2 = gameText('Bombardment Destroys Facility Description', planetaryFacility.name, self.name);
                        sendMessageToEmpire(habitat.empire, habitat.empire, EmpireMessageType.PlanetaryFacilityDestroyed, planetaryFacility, description2);
                    }
                }
            }
        }
        if (habitat.population !== null && habitat.population.items.length > 0 && habitat.population.totalAmount > 0) {
            const totalAmount = habitat.population.totalAmount;
            const num4 = Math.imul(bombardPower, 250000); // BuiltObject.2.cs 5923 `long num4 = bombardPower * 250000` (int multiply)
            const populationList: Population[] = [];
            for (let j = 0; j < habitat.population.items.length; j++) {
                const population = habitat.population.items[j];
                const num5 = population.amount / totalAmount;
                const num6 = Math.trunc(num4 * num5);
                population.amount -= num6;
                if (population.amount <= 0) populationList.push(population);
            }
            for (let k = 0; k < populationList.length; k++) habitat.population.remove(populationList[k]);
            habitat.population.recalculateTotalAmount();
            if (habitat.population.items.length <= 0 || habitat.population.totalAmount <= 0) {
                const array = (stellarObjectCharacters(habitat) ?? []).slice();
                for (let l = 0; l < array.length; l++) {
                    if (self.empire !== null && self.empire.counters !== null) self.empire.counters.processCharacterDeath(array[l]);
                    characterSendDeathMessage(galaxy, array[l], CharacterDeathType.ColonyBombardment);
                    array[l].kill(galaxy);
                }
                // BuiltObject.2.cs 5951-5960 (M4q): ListHelper.ToArrayThreadSafe(habitat.InvadingCharacters).
                const array2 = (habitatInvadingCharacterList(habitat) ?? []).slice();
                for (let m = 0; m < array2.length; m++) {
                    if (self.empire !== null && self.empire.counters !== null) self.empire.counters.processCharacterDeath(array2[m]);
                    characterSendDeathMessage(galaxy, array2[m], CharacterDeathType.ColonyBombardment);
                    array2[m].kill(galaxy);
                }
                clearColony(galaxy, habitat, self.actualEmpire);
            }
            habitat.population.recalculateTotalAmount();
            if (self.empire !== null && self.empire !== galaxy.independentEmpire && self.empire.pirateEmpireBaseHabitat === null) {
                let num7 = num4 / 50000000.0;
                if (empire !== null && empire !== galaxy.independentEmpire && empire.pirateEmpireBaseHabitat === null) {
                    if (empire.civilityRating > 0.0) {
                        const num8 = 1.0 + empire.civilityRating / 30.0;
                        num7 *= num8;
                    } else {
                        let val = 1.0 + empire.civilityRating / 50.0;
                        val = Math.max(0.01, val);
                        num7 *= val;
                    }
                }
                num7 = Math.max(num7, 0.0);
                self.empire.civilityRating -= num7;
                if (empire !== null && empire !== galaxy.independentEmpire && empire.pirateEmpireBaseHabitat === null) {
                    const empireEvaluation = obtainEmpireEvaluation(galaxy, empire, self.empire);
                    if (empireEvaluation !== null) empireEvaluation.incidentEvaluation = empireEvaluation.incidentEvaluationRaw - bombardPower / 1.0;
                }
            }
        }
    }
    const explosion = new Explosion();
    explosion.explosionStart = galaxyNow(galaxy);
    explosion.explosionSize = toShort(Math.trunc(Math.sqrt(bombardPower) * (Math.PI / 4.0) * 40.0));
    if (explosion.explosionSize < 10) explosion.explosionSize = 10;
    explosion.explosionProgression = 0;
    explosion.explosionImageIndex = toShort(galaxy.rnd.next(0, 10));
    let num9 = galaxy.rnd.next(0, csInt(habitat.diameter * 0.15));
    if (galaxy.rnd.next(0, 2) === 0) num9 *= -1;
    let num10 = galaxy.rnd.next(0, csInt(habitat.diameter * 0.15));
    if (galaxy.rnd.next(0, 2) === 0) num10 *= -1;
    explosion.explosionOffsetX = toShort(num9);
    explosion.explosionOffsetY = toShort(num10);
    explosion.explosionWillDestroy = false;
    if (habitat.explosions === null) habitat.explosions = [];
    (habitat.explosions as Explosion[]).push(explosion);
    if (galaxy.scenario !== null) scenarioEmit(galaxy, 'habitatBombarded', { builtObject: self, habitat, bombardPower }); // mod layer
}

// ---------------------------------------------------------------------------------------------------------------
// BuiltObject.1.cs 3490 DestroyHabitat (planet destroyer)
// ---------------------------------------------------------------------------------------------------------------

/** BuiltObject.1.cs 3552 InflictHabitatDestructionAreaDamage(habitat). */
export function inflictHabitatDestructionAreaDamage(galaxy: Galaxy, self: BuiltObject, habitat: Habitat): void {
    const num = 620.0;
    const num2 = habitat.diameter / 2.0;
    const num3 = num - num2;
    const num4 = csInt(habitat.xpos / INDEX_SIZE);
    const num5 = csInt(habitat.ypos / INDEX_SIZE);
    const cell = galaxy.builtObjectIndexGrid[num4][num5];
    for (let i = 0; i < cell.length; i++) {
        const builtObject = cell[i];
        if (checkWithinDistancePotential(csInt(num), habitat.xpos, habitat.ypos, builtObject.xpos, builtObject.ypos)) {
            const num6 = galaxy.calculateDistance(habitat.xpos, habitat.ypos, builtObject.xpos, builtObject.ypos);
            const num7 = habitat.diameter * 40.0 * ((num3 - (num6 - num2)) / num3);
            if (num7 > 0.0) inflictDamageFull(galaxy, self, builtObject, null, num7, galaxyNow(galaxy), 0, false, -Number.MAX_VALUE, false);
        }
    }
}

/** BuiltObject.1.cs 3490 DestroyHabitat(habitat). Rnd: Next(0, 10) per habitat (recursing into the habitat's moons). */
export function destroyHabitat(galaxy: Galaxy, self: BuiltObject, habitat: Habitat): void {
    const explosion = new Explosion();
    explosion.explosionStart = galaxyNow(galaxy);
    explosion.explosionSize = toShort(Math.trunc(habitat.diameter * 4.0));
    explosion.explosionProgression = 0;
    explosion.explosionOffsetX = 0;
    explosion.explosionOffsetY = 0;
    explosion.explosionImageIndex = toShort(galaxy.rnd.next(0, 10));
    explosion.explosionWillDestroy = true;
    habitat.explosion = explosion;
    habitat.hasBeenDestroyed = true;
    if (self.empire !== null && habitat.population !== null && habitat.population.totalAmount > 0) {
        let num = PLANET_DESTROY_REPUTATION_IMPACT;
        if (habitat.owner !== null && habitat.owner !== galaxy.independentEmpire && habitat.owner.pirateEmpireBaseHabitat === null) {
            if (habitat.owner.civilityRating > 0.0) {
                const num2 = 1.0 + habitat.owner.civilityRating / 30.0;
                num *= num2;
            } else {
                let val = 1.0 + habitat.owner.civilityRating / 50.0;
                val = Math.max(0.01, val);
                num *= val;
            }
        }
        if (habitat.empire !== null && habitat.empire !== galaxy.independentEmpire) {
            if (habitat.empire.pirateEmpireBaseHabitat !== null) {
                if (self.empire !== null && obtainPirateRelation(habitat.empire, self.empire).type === PirateRelationType.Protection) {
                    changePirateRelation(habitat.empire, self.empire, PirateRelationType.None, galaxyStarDate(galaxy));
                }
            } else if (self.empire !== null && self.empire.pirateEmpireBaseHabitat === null && habitat.empire.controlDiplomacyOffense === AutomationLevel.FullyAutomated && habitat.empire.pirateEmpireBaseHabitat === null) {
                declareWar(galaxy, habitat.empire, self.empire);
            }
        }
        self.empire.civilityRating -= num;
    }
    inflictWarDamageHabitat(galaxy, self.empire, habitat);
    inflictHabitatDestructionAreaDamage(galaxy, self, habitat);
    const habitat2 = galaxy.determineHabitatSystemStar(habitat);
    const systemInfo = galaxy.systems[habitat2.systemIndex];
    const sysHabitats = planetsOf(systemInfo); // BuiltObject.1.cs 3539-3544 systemInfo.Habitats: no star
    if (sysHabitats === null || sysHabitats.length <= 0) return;
    const habitatList: Habitat[] = [];
    for (const habitat3 of sysHabitats) {
        if (habitat3.parent === habitat) habitatList.push(habitat3);
    }
    for (const item of habitatList) destroyHabitat(galaxy, self, item);
}

// ---------------------------------------------------------------------------------------------------------------
// Explosions (BuiltObject.1.cs 14, Habitat.cs 6309 / 6341)
// ---------------------------------------------------------------------------------------------------------------

/** BuiltObject.1.cs 14 DoExplosions(galaxy). No Rnd. */
export function doExplosionsBuiltObject(galaxy: Galaxy, builtObject: BuiltObject): void {
    const tempNow = galaxyNow(galaxy);
    const explosions = builtObject.explosions as Explosion[];
    const explosionList: Explosion[] = [];
    for (let i = 0; i < explosions.length; i++) {
        const explosion = explosions[i];
        const num = (tempNow - explosion.explosionStart) / 1000;
        explosion.explosionProgression = Math.fround(Math.max(0.0, num * 60.0));
        const num2 = Math.min(100.0, Math.max(50.0, Math.trunc(explosion.explosionSize / 2)));
        explosion.explosionCurrentImage = Math.min(toShort(EXPLOSION_IMAGE_COUNT - 1), toShort(Math.trunc((explosion.explosionProgression / num2) * EXPLOSION_IMAGE_COUNT)));
        if (explosion.explosionProgression > num2) {
            explosion.explosionSize = 0;
            explosion.explosionProgression = 0;
            explosion.explosionSoundPlayed = false;
            explosionList.push(explosion);
            if (explosion.explosionWillDestroy) builtObjectCompleteTeardown(galaxy, builtObject, true);
        }
    }
    for (const item of explosionList) {
        const idx = explosions.indexOf(item);
        if (idx >= 0) explosions.splice(idx, 1);
    }
}

/** Habitat.cs 6309 DoExplosions. No Rnd. */
export function doExplosionsHabitat(galaxy: Galaxy, habitat: Habitat): void {
    const explosions = habitat.explosions as Explosion[] | null;
    if (explosions === null || explosions.length <= 0) return;
    const tempNow = galaxyNow(galaxy);
    const explosionList: Explosion[] = [];
    for (let i = 0; i < explosions.length; i++) {
        const explosion = explosions[i];
        const num = (tempNow - explosion.explosionStart) / 1000;
        explosion.explosionProgression = Math.fround(Math.max(0.0, num * 60.0));
        const num2 = Math.min(100.0, Math.max(50.0, Math.trunc(explosion.explosionSize / 2)));
        explosion.explosionCurrentImage = Math.min(toShort(EXPLOSION_IMAGE_COUNT - 1), toShort(Math.trunc((explosion.explosionProgression / num2) * EXPLOSION_IMAGE_COUNT)));
        if (explosion.explosionProgression > num2) {
            explosion.explosionSize = 0;
            explosion.explosionProgression = 0;
            explosion.explosionSoundPlayed = false;
            explosionList.push(explosion);
        }
    }
    for (const item of explosionList) {
        const idx = explosions.indexOf(item);
        if (idx >= 0) explosions.splice(idx, 1);
    }
    if (explosions.length === 0) habitat.explosions = null;
}

/** Habitat.cs 6341 DoExplosion (the planet-destroyer explosion). No Rnd here (DoPlanetDestroyAsteroidField / DoPlanetRemove are M4u). */
export function doExplosionHabitat(galaxy: Galaxy, habitat: Habitat): void {
    const explosion = habitat.explosion as Explosion | null;
    if (explosion === null) return;
    const tempNow = galaxyNow(galaxy);
    const num = (tempNow - explosion.explosionStart) / 1000;
    explosion.explosionProgression = Math.fround(Math.max(0.0, num * 50.0));
    const num2 = Math.min(400.0, Math.max(80.0, Math.trunc(explosion.explosionSize / 2)));
    if (habitat.diameter <= 50) {
        explosion.explosionCurrentImage = Math.min(toShort(EXPLOSION_IMAGE_COUNT - 1), toShort(Math.trunc((explosion.explosionProgression / num2) * EXPLOSION_IMAGE_COUNT)));
    } else {
        explosion.explosionCurrentImage = Math.min(toShort(EXPLOSION_HABITAT_IMAGE_COUNT - 1), toShort(Math.trunc((explosion.explosionProgression / num2) * EXPLOSION_HABITAT_IMAGE_COUNT)));
    }
    if (!habitat.destroyedAsteroidFieldGenerated && explosion.explosionProgression >= num2 * 0.7) {
        habitat.destroyedAsteroidFieldGenerated = true;
        // C# starts DoPlanetDestroyAsteroidField on a Thread; run inline (plan §0 single-threaded scheduler).
        doPlanetDestroyAsteroidField(galaxy, habitat);
    }
    if (explosion.explosionProgression > num2) {
        habitat.hasBeenDestroyed = true;
        explosion.explosionSize = 0;
        explosion.explosionProgression = 0;
        explosion.explosionSoundPlayed = false;
        if (explosion.explosionWillDestroy) {
            // C# starts DoPlanetRemove on a Thread; run inline.
            doPlanetRemove(galaxy, habitat);
        }
        habitat.explosion = null;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// BuiltObject.2.cs 6084 ReviewDisabledComponents
// ---------------------------------------------------------------------------------------------------------------

/** BuiltObject.2.cs 6084 ReviewDisabledComponents(timePassed). No Rnd. */
export function reviewDisabledComponents(galaxy: Galaxy, builtObject: BuiltObject, timePassed: number): void {
    void galaxy;
    if (builtObject.disabledComponentIndexes === null || builtObject.disabledComponentIndexes.length <= 0) return;
    let flag = false;
    const list: number[] = [];
    const durations = builtObject.disabledComponentDurations!;
    for (let i = 0; i < builtObject.disabledComponentIndexes.length; i++) {
        let num = 0;
        if (durations.length > i) num = durations[i];
        num = toShort(num - toShort(Math.trunc(timePassed * 1000.0)));
        if (num <= 0) {
            flag = true;
            list.push(i);
        }
        durations[i] = num;
    }
    if (list.length > 0) {
        for (let num2 = list.length - 1; num2 >= 0; num2--) {
            builtObject.disabledComponentIndexes.splice(list[num2], 1);
            durations.splice(list[num2], 1);
        }
    }
    if (builtObject.disabledComponentIndexes.length <= 0) {
        builtObject.disabledComponentIndexes = null;
        builtObject.disabledComponentDurations = null;
    }
    if (flag) builtObject.reDefine();
}

// ---------------------------------------------------------------------------------------------------------------
// BuiltObject.2.cs 4816 CheckSelfDestruct, Galaxy.7.cs 2835 DetermineScrapDamagedShip
// ---------------------------------------------------------------------------------------------------------------

/** Galaxy.7.cs 2835 DetermineScrapDamagedShip(builtObject). No Rnd (FindNearestShipYard / FindNearestAvailableConstructionShip are M4h / M4i stubs). */
export function determineScrapDamagedShip(galaxy: Galaxy, builtObject: BuiltObject): boolean {
    const playerEmpire = galaxy.playerEmpire;
    if (
        builtObject.role !== BuiltObjectRole.Base &&
        isAiControlled(builtObject) &&
        builtObject.damageRepair <= 0 &&
        builtObject.warpSpeed <= 0 &&
        (builtObject.characters === null || builtObject.characters.length <= 0) &&
        (builtObject.troops === null || builtObject.troops.count <= 0) &&
        builtObject.empire !== playerEmpire &&
        (playerEmpire === null || builtObject.pirateEmpireId !== playerEmpire.empireId)
    ) {
        const num = resolveTechBonusFactor(builtObject.empire, galaxy, builtObject);
        if (num <= 1.0) {
            const num2 = builtObject.components.countNormalComponentsByCategory(ComponentCategoryType.HyperDrive);
            if (num2 <= 0) {
                let flag = true;
                if (builtObject.topSpeed <= 0) {
                    const num3 = builtObject.components.countNormalComponentsByType(ComponentType.EngineMainThrust);
                    const num4 = builtObject.components.countNormalComponentsByCategory(ComponentCategoryType.Reactor);
                    if (num3 <= 0 || num4 <= 0) flag = false;
                }
                if (flag) {
                    const stellarObject = findNearestShipYard(galaxy, builtObject.empire!, builtObject, false, true);
                    if (stellarObject !== null) {
                        const num5 = galaxy.calculateDistance(builtObject.xpos, builtObject.ypos, stellarObject.xpos, stellarObject.ypos);
                        if (num5 < MAX_SOLAR_SYSTEM_SIZE) return false;
                    }
                    return true;
                }
                if (builtObject.nearestSystemStar !== null) {
                    const systemStar = galaxy.determineHabitatSystemStar(builtObject.nearestSystemStar);
                    const systemInfo = galaxy.systems[systemStar.systemIndex];
                    const actualEmpire = builtObject.actualEmpire;
                    if (actualEmpire !== null && systemInfo != null && systemInfo.dominantEmpire != null && systemInfo.dominantEmpire.empire != null && systemInfo.dominantEmpire.empire === actualEmpire) {
                        const builtObject2 = findNearestAvailableConstructionShip(galaxy, actualEmpire, builtObject.xpos, builtObject.ypos);
                        if (builtObject2 !== null) {
                            const num6 = galaxy.calculateDistance(builtObject.xpos, builtObject.ypos, builtObject2.xpos, builtObject2.ypos);
                            let num7 = SECTOR_SIZE * 3.0;
                            if (builtObject2.warpSpeed <= 0) num7 = 2000.0;
                            else if (builtObject2.warpSpeed < 3000) num7 = SECTOR_SIZE * 0.5;
                            if (num6 < num7) return false;
                        }
                    }
                }
                return true;
            }
        }
    }
    return false;
}

/** BuiltObject.2.cs 4816 CheckSelfDestruct: a stranded damaged ship with no yard in reach is scuttled (InflictDamage on itself, no recursion). */
export function checkSelfDestruct(galaxy: Galaxy, builtObject: BuiltObject): void {
    const mission = builtObjectMission(builtObject.mission);
    if (
        builtObject.damagedComponentCount > 0 &&
        builtObject.empire !== null &&
        builtObject.dockedAt === null &&
        builtObject.builtAt === null &&
        (mission === null || mission.type !== BuiltObjectMissionType.Repair) &&
        determineScrapDamagedShip(galaxy, builtObject)
    ) {
        const hitPower = Math.max(Math.fround(Math.fround(builtObject.currentShields + Math.fround(builtObject.size)) + 1), 1000.0);
        inflictDamageFull(galaxy, builtObject, builtObject, null, hitPower, galaxyNow(galaxy), 0, false, 0.0, false);
    }
}

// ---- Creature.cs 1347 DamageTarget (called from Creature.cs 1299 AttackTarget, events.ts creatureAttackTarget) ----

/**
 * Creature.cs 1347 DamageTarget(abstractTarget, damage, tempNow, timePassed): creature vs creature (DamageCreature),
 * habitat (SilverMist population / quality damage, colony wipe-out) and built object (armor, component damage, the
 * destruction explosion). Returns true when the target was destroyed / emptied. `tempNow` in sim ms.
 * Rnd: built object destroyed → Next(0, 10) (+ the recursive calls for ships under construction); otherwise
 * Next(0, Components.Count) × (1..11) per damaged component [+ Next(0, Troops.Count) for a StorageTroop hit].
 */
export function creatureDamageTarget(galaxy: Galaxy, creature: Creature, abstractTarget: BuiltObject | Habitat | Creature, damage: number, tempNow: number, timePassed: number): boolean {
    if (isCreature(abstractTarget)) {
        const creature2 = abstractTarget;
        if (creature2.damageCreature(null, damage, null)) {
            creature2.completeTeardown();
            creature.currentTarget = null;
        }
    } else if (isHabitat(abstractTarget)) {
        const habitat = abstractTarget;
        if (creature.type === CreatureType.SilverMist && habitat.population != null && habitat.population.items.length > 0) {
            if (habitat.quality > 0.0) {
                if (habitat.damage <= 0.0 && habitat.empire !== null && habitat.empire !== galaxy.independentEmpire) {
                    const habitatSystemStar = galaxy.determineHabitatSystemStar(habitat);
                    const description = gameText('Colony Under Attack From Silvermist Description', habitat.name, habitatSystemStar?.name ?? '', creature.name);
                    sendMessageToEmpire(habitat.empire, habitat.empire, EmpireMessageType.GeneralBadEvent, habitat, description);
                }
                const num = Math.fround(timePassed * 0.01);
                habitat.damage = Math.fround(habitat.damage + num);
                habitat.damage = Math.min(habitat.damage, habitat.baseQuality);
                // habitat.RecalculateQuality(): the TS Quality is a live getter (types.ts).
            }
            const val2 = Math.trunc(timePassed * 1000000.0 * creature.attackStrength);
            const num1 = Math.min(habitat.population.totalAmount, val2);
            const num2 = Math.trunc(num1 / habitat.population.items.length);
            if (creature.size < creature.maxSize) {
                creature.size += Math.max(1, Math.min(csInt(num1 / 1000000.0), 10));
                creature.size = Math.min(creature.size, creature.maxSize);
                creature.attackStrength = csInt(creature.size / 10.0);
                creature.damageKillThreshold = csInt(creature.size * 3.0);
            }
            const populationList: Population[] = [];
            for (let index = 0; index < habitat.population.items.length; ++index) {
                const population = habitat.population.items[index];
                population.amount -= num2;
                if (population.amount <= 0) populationList.push(population);
            }
            for (let index = 0; index < populationList.length; ++index) habitat.population.remove(populationList[index]);
            if (habitat.population.items.length <= 0 && habitat.empire !== null) {
                if (habitat.empire !== null && habitat.empire !== galaxy.independentEmpire) {
                    const habitatSystemStar = galaxy.determineHabitatSystemStar(habitat);
                    const text = gameText('SilverMist Wipes Out Colony');
                    const description = gameText('Colony Wiped Out From Silvermist Description', habitat.name, habitatSystemStar?.name ?? '', creature.name);
                    sendMessageToEmpireWithTitle(habitat.empire, habitat.empire, EmpireMessageType.GeneralBadEvent, habitat, description, text);
                }
                // Empire.TakeOwnershipOfColony(habitat, null, true) → (…, destroyBases: true, destroyTroops: true) (Empire.1.cs 59).
                takeOwnershipOfColonyFull(galaxy, habitat.empire, habitat, null, true, true);
                const troopLists = [habitat.troops, habitat.troopsToRecruit, habitat.invadingTroops];
                for (const list of troopLists) {
                    if (list === null) continue;
                    for (let index = 0; index < list.items.length; ++index) {
                        list.items[index].builtObject = null;
                        list.items[index].colony = null;
                        list.items[index].empire = null;
                        list.items[index].race = null;
                    }
                }
                for (const list of troopLists) list?.clear();
                const arrayThreadSafe1 = (stellarObjectCharacters(habitat) ?? []).slice();
                for (let index = 0; index < arrayThreadSafe1.length; ++index) {
                    characterSendDeathMessage(galaxy, arrayThreadSafe1[index], CharacterDeathType.GenericDeath);
                    arrayThreadSafe1[index].kill(galaxy);
                }
                const arrayThreadSafe2 = (habitatInvadingCharacterList(habitat) ?? []).slice();
                for (let index = 0; index < arrayThreadSafe2.length; ++index) {
                    characterSendDeathMessage(galaxy, arrayThreadSafe2[index], CharacterDeathType.GenericDeath);
                    arrayThreadSafe2[index].kill(galaxy);
                }
                habitat.empire = null;
                habitat.manufacturingQueue = null;
                habitat.constructionQueue = null;
            }
            habitat.population.recalculateTotalAmount();
            if (habitat.population.totalAmount <= 0) return true;
        }
    } else if (isBuiltObject(abstractTarget)) {
        const excludeBuiltObject = abstractTarget;
        const components = excludeBuiltObject.components.items;
        let num3 = 0;
        for (let index = 0; index < components.length; ++index) {
            if (components[index].status === ComponentStatus.Normal) num3 += components[index].size;
        }
        if (num3 <= damage) {
            const explosion = new Explosion();
            explosion.explosionStart = tempNow;
            explosion.explosionSize = 30;
            explosion.explosionProgression = 0;
            explosion.explosionOffsetX = 0;
            explosion.explosionOffsetY = 0;
            explosion.explosionImageIndex = toShort(galaxy.rnd.next(0, 10));
            explosion.explosionWillDestroy = true;
            excludeBuiltObject.explosions.push(explosion);
            excludeBuiltObject.hasBeenDestroyed = true;
            if (excludeBuiltObject.empire !== null) excludeBuiltObject.empire.visibility.resolveSystemVisibilityAt(excludeBuiltObject.xpos, excludeBuiltObject.ypos, excludeBuiltObject, null);
            const constructionQueue = excludeBuiltObject.constructionQueue as { constructionYards: { shipUnderConstruction: BuiltObject | null }[] | null } | null;
            if (constructionQueue !== null && constructionQueue.constructionYards !== null && countUnderConstruction(constructionQueue.constructionYards) > 0) {
                for (const constructionYard of constructionQueue.constructionYards) {
                    const underConstruction = constructionYard.shipUnderConstruction;
                    if (underConstruction !== null) creatureDamageTarget(galaxy, creature, underConstruction, 2147483647, tempNow, timePassed);
                }
            }
            excludeBuiltObject.reDefine();
            return true;
        }
        let component = firstComponentByCategoryAndStatus(components, ComponentCategoryType.Armor, ComponentStatus.Normal);
        const iterationCount1 = { count: 0 };
        while (conditionCheckLimit(component !== null && damage > 0, 200, iterationCount1)) {
            if (component!.value2 > 0 && damage <= component!.value2) damage = 0;
            if (damage > 0) {
                component!.status = ComponentStatus.Damaged;
                damage -= component!.value1;
                component = firstComponentByCategoryAndStatus(components, ComponentCategoryType.Armor, ComponentStatus.Normal);
            }
        }
        let damageReduction = excludeBuiltObject.damageReduction;
        const shipGroup = shipGroupOf(excludeBuiltObject);
        if (shipGroup !== null) damageReduction *= shipGroup.damageControlBonus;
        const num4 = damageReduction * captainDamageControlBonus(excludeBuiltObject);
        damage = csInt(damage + 0.49 - damage * num4);
        let index1 = 0;
        for (const iterationCount2 = { count: 0 }; conditionCheckLimit(damage > 0, 500, iterationCount2); damage -= components[index1].size) {
            let num5 = 0;
            do {
                index1 = galaxy.rnd.next(0, components.length);
                ++num5;
            } while (num5 <= 10 && components[index1].status === ComponentStatus.Damaged);
            components[index1].status = ComponentStatus.Damaged;
            if (excludeBuiltObject.role === BuiltObjectRole.Base) continue;
            switch (components[index1].type) {
                case ComponentType.StorageFuel: {
                    const num6 = components[index1].value1;
                    if (excludeBuiltObject.currentFuel > 0.0) {
                        excludeBuiltObject.currentFuel -= num6;
                        if (excludeBuiltObject.currentFuel < 0.0) excludeBuiltObject.currentFuel = 0.0;
                    }
                    break;
                }
                case ComponentType.StorageCargo: {
                    let num7 = components[index1].value1;
                    const cargoItems = excludeBuiltObject.cargo;
                    // CargoList.TotalUnits (CargoList.cs 524): the sum of Amount.
                    let totalUnits = 0;
                    if (cargoItems !== null) for (const c of cargoItems.items) totalUnits += c.amount;
                    if (cargoItems !== null && totalUnits > 0) {
                        const cargoList: Cargo[] = [];
                        for (const cargo of cargoItems.items) {
                            if (num7 > 0) {
                                if (cargo.amount > num7) {
                                    cargo.amount -= num7;
                                    break;
                                }
                                if (cargo.amount > 0) {
                                    num7 -= cargo.amount;
                                    cargoList.push(cargo);
                                }
                            } else {
                                break;
                            }
                        }
                        for (const current of cargoList) cargoItems.remove(current);
                    }
                    break;
                }
                case ComponentType.StorageTroop: {
                    const num8 = components[index1].value1;
                    if (excludeBuiltObject.troops !== null && excludeBuiltObject.troops.totalSize > 0) {
                        excludeBuiltObject.troopCapacity -= num8;
                        if (excludeBuiltObject.troops.totalSize > excludeBuiltObject.troopCapacity) {
                            const index2 = galaxy.rnd.next(0, excludeBuiltObject.troops.count);
                            if (index2 < excludeBuiltObject.troops.count) {
                                if (excludeBuiltObject.empire !== null && excludeBuiltObject.empire.troops !== null) excludeBuiltObject.empire.troops.remove(excludeBuiltObject.troops.items[index2]);
                                excludeBuiltObject.troops.items.splice(index2, 1);
                            }
                        }
                    }
                    break;
                }
            }
        }
        excludeBuiltObject.reDefine();
        if (excludeBuiltObject.role !== BuiltObjectRole.Base && excludeBuiltObject.damagedComponentCount > 0) excludeBuiltObject.repairForNextMission = true;
    }
    return false;
}

/**
 * ShipGroup.cs 213-216 / 1158-1161 (CheckForCompletedBattle / CheckForMissionCompletion): BattleStats.Location =
 * Galaxy.ResolveNearestLocation(attackedTarget, LeadShip, out nearby); BattleStats.NearLocation = nearby;
 * Galaxy.DoCharacterEvent(SpaceBattle, BattleStats, ObtainCharacters()). The caller then clears ShipGroup.BattleStats.
 */
export function finalizeShipGroupBattleStats(galaxy: Galaxy, shipGroup: ShipGroup, attackedTarget: StellarObject | null): void {
    const battleStats = shipGroup.battleStats as SpaceBattleStats | null;
    if (battleStats === null) return;
    const r = resolveNearestLocation(galaxy, attackedTarget, shipGroup.leadShip);
    battleStats.location = r.habitat;
    battleStats.nearLocation = r.nearby;
    doCharacterEventForList(galaxy, CharacterEventType.SpaceBattle, battleStats, shipGroupObtainCharacters(shipGroup), false, null);
}
