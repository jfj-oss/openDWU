// M4n — threat evaluation (tasks/M4-plan.md §3.3 row M4n).
//
// Ports, in this file:
// - BuiltObject.1.cs 208 PerformThreatEvaluation, 243 ThreatEvaluation, 390 CheckAssignAttackOnThreat,
//   615 CheckFleetsTravellingToLocation, 642 FleeFromHopelessBattle, 705 CheckBattleOverwhelming,
//   844 DetermineAttackingFirepower, 903 EvaluateAttackStrongBase, 924/930 EvaluateAdequateAttackers,
//   1520 ShouldFleeFrom, 2263-2308 strength factors, 5383 ShouldInvadeColony (BuiltObject.2.cs 14),
//   BuiltObject.2.cs 65 DetermineShipGroupTarget;
// - BaconBuiltObject.cs 4863 IdentifySystemThreatsToUs, 4939 FilterInvalidTargets, 3511 CalculateOverallStrengthFactorWithoutShields;
// - Galaxy.7.cs 3223 EvaluateSystemThreats, 3248/3253 EvaluateThreats, 3425 DetermineThreatLevel(threat, target),
//   3629/3681 DetermineThreatLevel(Creature | BuiltObject, …), 3813 DetermineRawThreatLevel,
//   3936 DoSuperPirateEmpireEncounter, 3203 CheckWithinCreatureAttackRange, 240 DetermineDefendingBaseStrengthAtColony,
//   Galaxy.7.cs 20-90 ship strength helpers, Galaxy.6.cs 4663-4780 DetermineDefendingStrength (fleet | BuiltObject | Habitat),
//   Galaxy.5.cs 3008/3018 CalculateNearbyOverallStrength, 3087 GetBuiltObjectsAtLocationByArrays,
//   Galaxy.4.cs 2012 DetermineGalaxyLocationsInRangeAtPoint; BuiltObjectList.cs 570 CalculateAttackingFirepowerNearEmpireTargets.
//
// Galaxy.Rnd: one draw site, IdentifySystemThreatsToUs (Bacon 4881 `Galaxy.Rnd.NextDouble() < num8`, the pirate-smuggler
// detection roll), in C# order. Fighters (M4p) are not modelled as threats yet: the Fighter branches of the C#
// (Galaxy.7.cs 3506 DetermineThreatLevel(Fighter …), the `threat is Fighter` redirects) are noted where they occur.

import { isAiControlled } from '../missions/playerOrder';
import type { Galaxy } from '../galaxy';
import type { BuiltObject } from '../builtObject';
import type { Empire } from '../empire';
import type { Habitat, SystemInfo } from '../types';
import type { SystemVisibility } from '../visibility';
import { CreatureType, type Creature } from '../creature';
import { GalaxyLocationType, type GalaxyLocation } from '../galaxyLocation';
import { BuiltObjectFleeWhen, BuiltObjectRole, InvasionTactics } from '../data/designSpecifications';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { ComponentStatus } from '../builtObjectComponent';
import { ComponentType } from '../data/components';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../diplomacy';
import { PirateRelationType, obtainPirateRelation } from '../pirateRelations';
import { netSort } from '../netSort';
import { strategicValue } from '../territory';
import { determineClosestIndexEdgesCustom } from '../stationPlacement';
import { EmpireMessageType, sendMessageToEmpire } from '../messages';
import { CharacterEventType, CharacterSkillType, doCharacterEventForList, type Character } from '../characters';
import { EventMessageType, checkSendPreWarpProgressEventMessage, sendEventMessageToEmpire, sendNewsBroadcast } from '../events';
import { gameText } from '../colonyTick';
import { raceAggressionLevel, raceCautionLevel } from '../racePeriodic';
import { PreWarpProgressEventType, doEmpireEncounter } from '../exploration';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, CommandAction, builtObjectMission, isBuiltObject, isCreature, type BuiltObjectMission, type StellarObject } from '../missions/mission';
import { assignMission, clearPreviousMissionRequirements, recordRevertMission } from '../missions/assign';
import { startNewShipGroupBattleStats } from './damage';
import { shipGroupAssignMission, shipGroupCompleteMission, shipGroupTotalOverallStrengthFactor, type ShipGroup } from '../fleets/shipGroup';
import { withinFuelRange, withinFuelRangeAndRefuel } from '../movement';
import { checkColonyShipMissionCancelled, determineDestroyOrCaptureTarget, shouldAttack } from './attackAI';
import { determineThreatLevelFighter, isFighter, type Fighter } from './fighters';
import { formatGameTextNow } from '../textResolver';

// ---------------------------------------------------------------------------------------------------------------
// Galaxy constants (Galaxy.3.cs static ctor 4971-5055)
// ---------------------------------------------------------------------------------------------------------------

/** Galaxy.ThreatRange = 40000 (Galaxy.3.cs 4974). */
export const THREAT_RANGE = 40000;
/** Galaxy.StrikeRangeSquared = 90000.0 (4975). */
export const STRIKE_RANGE_SQUARED = 90000.0;
/** Galaxy.AttackOvermatchFactor = 2.0 (5037). */
export const ATTACK_OVERMATCH_FACTOR = 2.0;
/** Galaxy.AttackEvaluationRangeFactor = 20000.0 (5038). */
export const ATTACK_EVALUATION_RANGE_FACTOR = 20000.0;

/** A `_Threats` element: C# StellarObject (BuiltObject | Creature here; Fighter threats are M4p). */
export type Threat = BuiltObject | Creature;

// ---------------------------------------------------------------------------------------------------------------
// StellarObject base members (StellarObject.cs 35-39) across the three TS classes
// ---------------------------------------------------------------------------------------------------------------

/** StellarObject.Empire: a Creature has none (null). */
export function stellarEmpire(o: StellarObject | null): Empire | null {
    if (o === null || isCreature(o)) return null;
    return o.empire;
}

/**
 * StellarObject.FirepowerRaw (StellarObject.cs 37): a BuiltObject's and a Fighter's (Fighter.cs 242 sets it from its
 * weapons); 0 for a Habitat (bases are separate objects) and a Creature (Creature.cs never sets it). Fighters reach the
 * StellarObject readers below through Pursuers / Attackers / CurrentTarget (M4p).
 */
export function stellarFirepowerRaw(o: StellarObject | Fighter): number {
    return isBuiltObject(o) || isFighter(o) ? o.firepowerRaw : 0;
}

/** StellarObject.TopSpeed. */
export function stellarTopSpeed(o: StellarObject | Fighter): number {
    if (isBuiltObject(o) || isCreature(o) || isFighter(o)) return o.topSpeed;
    return 0;
}

/** StellarObject.IsFunctional (Creature.cs never sets it: false). */
export function stellarIsFunctional(o: StellarObject | Fighter): boolean {
    return isBuiltObject(o) || isFighter(o) ? o.isFunctional : false;
}

/** StellarObject.CurrentSpeed. */
export function stellarCurrentSpeed(o: StellarObject | Fighter): number {
    if (isBuiltObject(o) || isCreature(o) || isFighter(o)) return o.currentSpeed;
    return 0;
}

/** StellarObject.CurrentTarget. */
export function stellarCurrentTarget(o: StellarObject | Fighter): StellarObject | null {
    if (isBuiltObject(o)) return o.currentTarget as StellarObject | null;
    if (isCreature(o)) return o.currentTarget;
    if (isFighter(o)) return o.currentTarget as StellarObject | null;
    return null;
}

/**
 * StellarObject.Attackers / Pursuers (StellarObjectList) of a BuiltObject or Creature (creature.ts lists, M4u creature
 * combat). A habitat's lists are never initialised in the C# (null): a fresh empty list is returned, so reads see
 * nothing and a push has no effect.
 */
export function stellarAttackers(o: StellarObject): StellarObject[] {
    if (isBuiltObject(o)) return (o.attackers ?? []) as StellarObject[];
    if (isCreature(o)) return o.attackers as StellarObject[];
    return [];
}
export function stellarPursuers(o: StellarObject): StellarObject[] {
    if (isBuiltObject(o)) return (o.pursuers ?? []) as StellarObject[];
    if (isCreature(o)) return o.pursuers as StellarObject[];
    return [];
}

/** ShipGroup typed view of BuiltObject.shipGroup (`unknown` in builtObject.ts). */
export function shipGroupOf(bo: BuiltObject): ShipGroup | null {
    return bo.shipGroup as ShipGroup | null;
}

/** BuiltObject._Threats / _ThreatLevels as the typed arrays (allocated by the first DoTasks; empty before). */
export function builtObjectThreats(bo: BuiltObject): (Threat | null)[] {
    return bo.threats ?? [];
}
export function builtObjectThreatLevels(bo: BuiltObject): number[] {
    return bo.threatLevels ?? [];
}

// ---------------------------------------------------------------------------------------------------------------
// Strength factors (BuiltObject.1.cs 2263-2308, BaconBuiltObject.cs 3511)
// ---------------------------------------------------------------------------------------------------------------

/** Fighter members read here (Fighter.cs; the class is M4p's — duck-typed). */
interface FighterLike {
    hasBeenDestroyed: boolean;
    underConstruction: boolean;
    firepowerRaw: number;
}

/** BuiltObject.1.cs 2263 CalculateShieldStrengthFactor: (int)(CurrentShields / 20f). */
export function calculateShieldStrengthFactor(bo: BuiltObject): number {
    return Math.trunc(Math.fround(Math.fround(bo.currentShields) / 20));
}

/** BuiltObject.1.cs 2293 CalculateFirepowerFactor (float accumulation, (int) result). */
export function calculateFirepowerFactor(bo: BuiltObject): number {
    let num = 0;
    if (bo.weapons !== null) {
        for (let i = 0; i < bo.weapons.length; i++) {
            const weapon = bo.weapons[i];
            if (weapon != null) {
                num = Math.fround(num + Math.fround(Math.fround(weapon.rawDamage) / Math.fround(Math.fround(weapon.fireRate) / 1000)));
            }
        }
    }
    return Math.trunc(num);
}

/** BuiltObject.1.cs 2276 CalculateFighterFactor. */
export function calculateFighterFactor(bo: BuiltObject): number {
    let num = 0;
    if (bo.fighters !== null) {
        for (let i = 0; i < bo.fighters.length; i++) {
            const fighter = bo.fighters[i] as FighterLike | null;
            if (fighter != null && !fighter.hasBeenDestroyed && !fighter.underConstruction) {
                num += fighter.firepowerRaw;
            }
        }
    }
    return num;
}

/** BuiltObject.1.cs 2268 CalculateOverallStrengthFactor. */
export function calculateOverallStrengthFactor(bo: BuiltObject): number {
    const num = calculateShieldStrengthFactor(bo);
    const num2 = calculateFirepowerFactor(bo);
    const num3 = calculateFighterFactor(bo);
    return num + num2 + num3;
}

/** BuiltObject.1.cs 2276 → BaconBuiltObject.cs 3511 CalculateOverallStrengthFactorWithoutShields (Empire.MilitaryPotency, M4j). */
export function calculateOverallStrengthFactorWithoutShields(galaxy: Galaxy, builtObject: BuiltObject): number {
    void galaxy;
    return builtObject.role !== BuiltObjectRole.Military ? 0 : calculateFirepowerFactor(builtObject) + calculateFighterFactor(builtObject);
}

// ---------------------------------------------------------------------------------------------------------------
// Galaxy index helpers
// ---------------------------------------------------------------------------------------------------------------

/** Galaxy.5.cs 3087 GetBuiltObjectsAtLocationByArrays(x, y, range): the cell of (x, y) plus the up-to-3 cells past the nearest edges within `range`. */
export function getBuiltObjectsAtLocationByArrays(galaxy: Galaxy, x: number, y: number, range: number): BuiltObject[][] {
    const list: BuiltObject[][] = [];
    const idx = galaxy.resolveIndex(x, y); // (int)x / IndexSize + CorrectIndexCoords
    const x2 = idx.x;
    const y2 = idx.y;
    list.push(galaxy.builtObjectIndexGrid[x2][y2].slice()); // ListHelper.ToArrayThreadSafe
    const e = determineClosestIndexEdgesCustom(galaxy, Math.trunc(x), Math.trunc(y), x2, x2, y2, y2);
    if (e.d < range) {
        const num2 = x2 + e.nearestX;
        const num3 = y2 + e.nearestY;
        if (num3 < galaxy.indexMaxY && num3 >= 0) {
            list.push(galaxy.builtObjectIndexGrid[x2][num3].slice());
        }
        if (num2 < galaxy.indexMaxX && num2 >= 0) {
            list.push(galaxy.builtObjectIndexGrid[num2][y2].slice());
        }
        if (num2 < galaxy.indexMaxX && num2 >= 0 && num3 < galaxy.indexMaxY && num3 >= 0) {
            list.push(galaxy.builtObjectIndexGrid[num2][num3].slice());
        }
    }
    return list;
}

/** Galaxy's private galaxy-location index (galaxy.ts `galaxyLocationIndex` / `resolveGalaxyLocationIndexes`). */
interface GalaxyLocationIndexAccess {
    galaxyLocationIndex: GalaxyLocation[][][];
    resolveGalaxyLocationIndexes(x: number, y: number): { x: number; y: number };
}

/** GalaxyLocation.RelatedCreatures (CreatureList; galaxyLocation.ts, M4z3). */
type GalaxyLocationWithCreatures = GalaxyLocation & { relatedCreatures?: Creature[] | null };

/** Galaxy.4.cs 2012 DetermineGalaxyLocationsInRangeAtPoint(x, y, range, type). */
export function determineGalaxyLocationsInRangeAtPoint(galaxy: Galaxy, x: number, y: number, range: number, type: GalaxyLocationType): GalaxyLocation[] {
    const galaxyLocationList: GalaxyLocation[] = [];
    const access = galaxy as unknown as GalaxyLocationIndexAccess;
    const point = access.resolveGalaxyLocationIndexes(x, y);
    const cell = access.galaxyLocationIndex[point.x][point.y];
    for (let i = 0; i < cell.length; i++) {
        const galaxyLocation = cell[i];
        const num = galaxyLocation.width / 2.0;
        const num2 = (num + range) * (num + range);
        if (type === GalaxyLocationType.Undefined || galaxyLocation.type === type) {
            const num3 = galaxy.calculateDistanceSquared(x, y, galaxyLocation.xpos + num, galaxyLocation.ypos + galaxyLocation.height / 2.0);
            if (num3 < num2) {
                galaxyLocationList.push(galaxyLocation);
            }
        }
    }
    return galaxyLocationList;
}

/** Galaxy.7.cs 3203 CheckWithinCreatureAttackRange(x, y, creature). */
export function checkWithinCreatureAttackRange(galaxy: Galaxy, x: number, y: number, creature: Creature | null): boolean {
    if (creature !== null) {
        let val = Number.MAX_VALUE;
        if (creature.parentHabitat !== null) {
            val = galaxy.calculateDistance(x, y, creature.parentHabitat.xpos, creature.parentHabitat.ypos);
        }
        const val2 = galaxy.calculateDistance(x, y, creature.xpos, creature.ypos);
        const num = Math.min(val, val2);
        const num2 = Math.min(1000.0, creature.attackRange);
        if (num < num2) {
            return true;
        }
    }
    return false;
}

// ---------------------------------------------------------------------------------------------------------------
// Galaxy.7.cs threat levels
// ---------------------------------------------------------------------------------------------------------------

/** The `object target` of EvaluateThreats / DetermineThreatLevel: Habitat, ShipGroup or BuiltObject. */
export type ThreatTarget = BuiltObject | Habitat | ShipGroup;

function isShipGroupTarget(target: ThreatTarget): target is ShipGroup {
    return (target as ShipGroup).ships !== undefined && (target as ShipGroup).leadShip !== undefined;
}

/**
 * Galaxy.7.cs 3936 DoSuperPirateEmpireEncounter(discoverer, pirateEmpire, x, y): the phantom-pirates event message and
 * the Galactic NewsNet broadcast.
 */
export function doSuperPirateEmpireEncounter(galaxy: Galaxy, discoverer: Empire | null, pirateEmpire: Empire | null, x: number, y: number): void {
    if (discoverer === null || pirateEmpire === null || pirateEmpire.pirateEmpireBaseHabitat === null || !pirateEmpire.pirateEmpireSuperPirates || discoverer.knownPirateEmpires.includes(pirateEmpire)) {
        return;
    }
    let habitat: Habitat | null = null;
    habitat = galaxy.fastFindNearestSystem(x, y);
    if (habitat !== null) {
        const num = galaxy.calculateDistance(habitat.xpos, habitat.ypos, x, y);
        if (num > galaxy.maxSolarSystemSize * 2.1) {
            habitat = null;
        }
    }
    // 3948-3954
    const message = habitat === null ? gameText('Encounter Message Phantom Pirates', pirateEmpire.name, '') : gameText('Encounter Message Phantom Pirates', pirateEmpire.name, habitat.name);
    sendEventMessageToEmpire(discoverer, EventMessageType.PhantomPirates, formatGameTextNow('Phantom Pirates Encountered') + '!', message, pirateEmpire, habitat);
    sendNewsBroadcast(discoverer, EventMessageType.PhantomPirates, pirateEmpire);
}

/** The pirate-relation switch shared by the BuiltObject / Fighter DetermineThreatLevel bodies (3543-3559 / 3719-3735). */
function pirateRelationThreatFactor(galaxy: Galaxy, empire: Empire, threatEmpire: Empire, threat: StellarObject, num5: number): number {
    const pirateRelation = obtainPirateRelation(empire, threatEmpire);
    switch (pirateRelation.type) {
        case PirateRelationType.NotMet:
            doEmpireEncounter(galaxy, empire, threatEmpire, threat);
            break;
        case PirateRelationType.Protection:
            num5 = 0;
            break;
    }
    return num5;
}

/** Galaxy.7.cs 3681 DetermineThreatLevel(BuiltObject builtObject, object target, Empire empire, int targetX, int targetY, double scanRangeSquared, left, right, top, bottom). */
export function determineThreatLevelBuiltObject(galaxy: Galaxy, builtObject: BuiltObject, target: ThreatTarget, empire: Empire | null, targetX: number, targetY: number, scanRangeSquared: number): number {
    void target;
    if (empire !== builtObject.empire) {
        const num = galaxy.calculateDistanceSquared(builtObject.xpos, builtObject.ypos, targetX, targetY);
        if (num <= scanRangeSquared) {
            const num2 = Math.sqrt(num);
            const num3 = THREAT_RANGE / 2.0;
            let num4 = Math.max(1.0, num3 - num2);
            num4 *= num4;
            num4 /= 1000000.0;
            let num5 = 1;
            let num6 = 0;
            if (builtObject.empire === null) {
                num5 = 0;
            } else if (builtObject.empire === galaxy.independentEmpire) {
                num5 = 1;
                if (empire !== null) checkSendPreWarpProgressEventMessage(galaxy, empire, PreWarpProgressEventType.FirstContactPirateOrIndependent, builtObject, builtObject.empire);
            } else if (empire === null) {
                num5 = 1;
            } else if (empire.pirateEmpireBaseHabitat !== null && builtObject.empire !== empire && builtObject.empire !== null) {
                num5 = 50;
                num6 = 1;
                num5 = pirateRelationThreatFactor(galaxy, empire, builtObject.empire, builtObject, num5);
            } else if (builtObject.empire.pirateEmpireBaseHabitat !== null) {
                num5 = 50;
                if (!empire.knownPirateEmpires.includes(builtObject.empire)) {
                    doSuperPirateEmpireEncounter(galaxy, empire, builtObject.empire, targetX, targetY);
                    empire.knownPirateEmpires.push(builtObject.empire);
                }
                if (builtObject.empire !== null) {
                    num5 = pirateRelationThreatFactor(galaxy, empire, builtObject.empire, builtObject, num5);
                }
                if (empire === galaxy.independentEmpire) {
                    num5 = 0;
                }
            } else {
                const diplomaticRelation = empire.diplomaticRelations.byEmpire(builtObject.empire);
                num5 = 1;
                if (diplomaticRelation !== null) {
                    switch (diplomaticRelation.type) {
                        case DiplomaticRelationType.FreeTradeAgreement:
                        case DiplomaticRelationType.MutualDefensePact:
                        case DiplomaticRelationType.SubjugatedDominion:
                        case DiplomaticRelationType.Protectorate:
                            num5 = 0;
                            break;
                        case DiplomaticRelationType.None:
                            num5 = 1;
                            break;
                        case DiplomaticRelationType.TradeSanctions:
                            num5 = 5;
                            break;
                        case DiplomaticRelationType.Truce:
                            num5 = 10;
                            break;
                        case DiplomaticRelationType.War:
                            num5 = 100;
                            break;
                        case DiplomaticRelationType.NotMet:
                            num5 = 1;
                            diplomaticRelation.type = DiplomaticRelationType.None;
                            doEmpireEncounter(galaxy, empire, builtObject.empire, builtObject);
                            break;
                    }
                } else {
                    if (builtObject.empire !== galaxy.independentEmpire) {
                        num5 = 1;
                    }
                    doEmpireEncounter(galaxy, empire, builtObject.empire, builtObject);
                }
                if ((empire.outlaws as BuiltObject[]).includes(builtObject)) {
                    num5 = 100;
                }
            }
            num6 = 1;
            if (builtObject.firepowerRaw > 0) {
                num6 = Math.max(10, Math.trunc(builtObject.size / 10));
            }
            if (builtObject.fighters !== null && builtObject.fighters.length > 0) {
                num6 = Math.max(num6, builtObject.fighters.length * 10);
            }
            let num7 = Math.trunc(num4 * num5 * num6);
            if (num6 > 0) {
                num7 = Math.max(1, num7);
            }
            return num7;
        }
    }
    return 0;
}

/**
 * Galaxy.7.cs 3629 DetermineThreatLevel(Creature creature, object target, Empire empire, targetX, targetY, scanRangeSquared, …).
 * The SilverMist first-encounter event message (3660-3666, SendEventMessageToEmpire CreatureOutbreak) is UI-only; the flag is set.
 */
export function determineThreatLevelCreature(galaxy: Galaxy, creature: Creature, target: ThreatTarget, empire: Empire | null, targetX: number, targetY: number, scanRangeSquared: number): number {
    void target;
    const num = galaxy.calculateDistanceSquared(creature.xpos, creature.ypos, targetX, targetY);
    if (num <= scanRangeSquared) {
        const num2 = Math.sqrt(num);
        const num3 = THREAT_RANGE / 2.0;
        let num4 = Math.max(1.0, num3 - num2);
        num4 *= num4;
        num4 /= 1000000.0;
        const num5 = 100;
        let num6 = 0;
        switch (creature.type) {
            case CreatureType.RockSpaceSlug:
            case CreatureType.DesertSpaceSlug:
                num6 = 10;
                break;
            case CreatureType.Kaltor:
                num6 = 20;
                break;
            case CreatureType.Ardilus:
                num6 = 15;
                break;
            case CreatureType.SilverMist:
                num6 = 100;
                if (empire !== null && empire !== galaxy.independentEmpire && !empire.encounteredSilverMistCreature) {
                    empire.encounteredSilverMistCreature = true;
                    const habitat = galaxy.fastFindNearestSystem(targetX, targetY);
                    if (habitat !== null) {
                        // 3663-3666: ResolveSectorDescription + SendEventMessageToEmpire(CreatureOutbreak, …) — TODO(port) M9 UI text.
                    }
                }
                break;
        }
        let num7 = Math.trunc(num4 * num5 * num6);
        if (num6 > 0) {
            num7 = Math.max(1, num7);
        }
        return num7;
    }
    return 0;
}

/** Galaxy.7.cs 3425 DetermineThreatLevel(StellarObject threat, object target) (the public 2-argument form). */
export function determineThreatLevel(galaxy: Galaxy, threat: StellarObject | Fighter, target: ThreatTarget): number {
    let num = -1.0;
    let num2 = -1.0;
    let num3: number = THREAT_RANGE;
    let empire: Empire | null;
    if (!isShipGroupTarget(target) && !isBuiltObject(target)) {
        // Habitat
        num = target.xpos;
        num2 = target.ypos;
        empire = target.owner;
        num3 = galaxy.maxSolarSystemSize;
    } else if (isShipGroupTarget(target)) {
        let num4 = 0.0;
        let num5 = 0.0;
        let num6 = 0.0;
        let num7 = 0.0;
        const shipGroup = target;
        for (let i = 0; i < shipGroup.ships.length; i++) {
            if (shipGroup.ships[i].sensorProximityArrayRange > num3) {
                num3 = shipGroup.ships[i].sensorProximityArrayRange;
            }
            if (shipGroup.ships[i].xpos < num4) {
                num4 = shipGroup.ships[i].xpos;
            }
            if (shipGroup.ships[i].xpos > num5) {
                num5 = shipGroup.ships[i].xpos;
            }
            if (shipGroup.ships[i].ypos < num6) {
                num6 = shipGroup.ships[i].ypos;
            }
            if (shipGroup.ships[i].ypos > num7) {
                num7 = shipGroup.ships[i].ypos;
            }
        }
        num = num4 + (num5 - num4) / 2.0;
        num2 = num6 + (num7 - num6) / 2.0;
        empire = shipGroup.empire;
    } else {
        if (target.sensorProximityArrayRange > num3) {
            num3 = target.sensorProximityArrayRange;
        }
        num = target.xpos;
        num2 = target.ypos;
        empire = target.empire;
    }
    const scanRangeSquared = num3 * num3;
    if (isBuiltObject(threat)) {
        return determineThreatLevelBuiltObject(galaxy, threat, target, empire, Math.trunc(num), Math.trunc(num2), scanRangeSquared);
    }
    // 3495: `threat is Fighter` → DetermineThreatLevel(Fighter …) (M4p, combat/fighters.ts).
    if (isFighter(threat)) {
        return determineThreatLevelFighter(galaxy, threat, target, empire, Math.trunc(num), Math.trunc(num2), scanRangeSquared);
    }
    if (isCreature(threat)) {
        return determineThreatLevelCreature(galaxy, threat, target, empire, Math.trunc(num), Math.trunc(num2), scanRangeSquared);
    }
    return 0;
}

/**
 * Galaxy.7.cs 3253 EvaluateThreats(object target, out int[] threatLevel, int maximumThreatCount) (3248: default 20).
 * Returns the C# (StellarObject[] threats, int[] threatLevel) pair, sorted by level descending (Array.Sort keys/items + Reverse).
 */
export function evaluateThreats(galaxy: Galaxy, target: ThreatTarget, maximumThreatCount = 20): { threats: Threat[]; threatLevels: number[] } {
    const stellarObjectList: Threat[] = [];
    const list: number[] = [];
    let num = -1.0;
    let num2 = -1.0;
    let num3: number = THREAT_RANGE;
    let systemInfo: SystemInfo | null = null;
    let empire: Empire | null;
    if (!isShipGroupTarget(target) && !isBuiltObject(target)) {
        const habitat = target;
        num = habitat.xpos;
        num2 = habitat.ypos;
        empire = habitat.owner;
        num3 = galaxy.maxSolarSystemSize;
        systemInfo = galaxy.systems[habitat.systemIndex];
    } else if (isShipGroupTarget(target)) {
        let num4 = 0.0;
        let num5 = 0.0;
        let num6 = 0.0;
        let num7 = 0.0;
        const shipGroup = target;
        for (let i = 0; i < shipGroup.ships.length; i++) {
            const builtObject = shipGroup.ships[i];
            if (builtObject != null) {
                if (builtObject.sensorProximityArrayRange > num3) {
                    num3 = builtObject.sensorProximityArrayRange;
                }
                if (builtObject.xpos < num4) {
                    num4 = builtObject.xpos;
                }
                if (builtObject.xpos > num5) {
                    num5 = builtObject.xpos;
                }
                if (builtObject.ypos < num6) {
                    num6 = builtObject.ypos;
                }
                if (builtObject.ypos > num7) {
                    num7 = builtObject.ypos;
                }
            }
        }
        num = num4 + (num5 - num4) / 2.0;
        num2 = num6 + (num7 - num6) / 2.0;
        empire = shipGroup.empire;
        if (shipGroup.leadShip !== null && shipGroup.leadShip.nearestSystemStar !== null) {
            systemInfo = galaxy.systems[shipGroup.leadShip.nearestSystemStar.systemIndex];
        }
    } else {
        const builtObject2 = target;
        if (builtObject2.sensorProximityArrayRange > num3) {
            num3 = builtObject2.sensorProximityArrayRange;
        }
        num = builtObject2.xpos;
        num2 = builtObject2.ypos;
        empire = builtObject2.empire;
        if (builtObject2.nearestSystemStar !== null) {
            systemInfo = galaxy.systems[builtObject2.nearestSystemStar.systemIndex];
        }
    }
    // 3327-3333: left/right/top/bottom + the index cell are computed but unused by the callees.
    num3 += galaxy.maxSolarSystemSize * 2;
    const builtObjectsAtLocationByArrays = getBuiltObjectsAtLocationByArrays(galaxy, num, num2, Math.trunc(num3));
    num3 *= num3;
    let num8 = 10;
    if (empire === null) {
        num8 = 0;
    }
    for (let j = 0; j < builtObjectsAtLocationByArrays.length; j++) {
        for (let k = 0; k < builtObjectsAtLocationByArrays[j].length; k++) {
            const builtObject3 = builtObjectsAtLocationByArrays[j][k];
            if (builtObject3 != null) {
                const num9 = determineThreatLevelBuiltObject(galaxy, builtObject3, target, empire, Math.trunc(num), Math.trunc(num2), num3);
                if (num9 > num8 && !stellarObjectList.includes(builtObject3)) {
                    stellarObjectList.push(builtObject3);
                    list.push(num9);
                }
            }
        }
    }
    if (systemInfo !== null) {
        const creatures = systemInfo.creatures ?? [];
        for (let l = 0; l < creatures.length; l++) {
            const creature = creatures[l];
            if (creature != null) {
                const num10 = determineThreatLevelCreature(galaxy, creature, target, empire, Math.trunc(num), Math.trunc(num2), num3);
                if (num10 > 10) {
                    stellarObjectList.push(creature);
                    list.push(num10);
                }
            }
        }
    } else {
        const galaxyLocationList = determineGalaxyLocationsInRangeAtPoint(galaxy, num, num2, num3, GalaxyLocationType.RestrictedArea);
        if (galaxyLocationList !== null && galaxyLocationList.length > 0) {
            for (let m = 0; m < galaxyLocationList.length; m++) {
                const galaxyLocation = galaxyLocationList[m] as GalaxyLocationWithCreatures;
                const relatedCreatures = galaxyLocation.relatedCreatures ?? null;
                if (galaxyLocation == null || relatedCreatures === null || relatedCreatures.length <= 0) {
                    continue;
                }
                for (let n = 0; n < relatedCreatures.length; n++) {
                    const creature2 = relatedCreatures[n];
                    if (creature2 != null) {
                        const num11 = determineThreatLevelCreature(galaxy, creature2, target, empire, Math.trunc(num), Math.trunc(num2), num3);
                        if (num11 > 10) {
                            stellarObjectList.push(creature2);
                            list.push(num11);
                        }
                    }
                }
            }
        }
    }
    // 3403-3406: Array.Sort(array2 (keys), array (items)) ascending, then Reverse both. .NET's keyed Array.Sort is the same
    // introsort as List.Sort over the key array, moving the items alongside — done here on index pairs with netSort.
    const pairs = stellarObjectList.map((threat, i) => ({ threat, level: list[i] }));
    netSort(pairs, (a, b) => (a.level < b.level ? -1 : a.level > b.level ? 1 : 0));
    pairs.reverse();
    if (pairs.length < maximumThreatCount) {
        maximumThreatCount = pairs.length;
    }
    const array3: Threat[] = new Array<Threat>(maximumThreatCount);
    const array4: number[] = new Array<number>(maximumThreatCount);
    for (let i = 0; i < maximumThreatCount; i++) {
        array3[i] = pairs[i].threat;
        array4[i] = pairs[i].level;
    }
    return { threats: array3, threatLevels: array4 };
}

/** Galaxy.7.cs 3813 DetermineRawThreatLevel(threat, targetEmpire). */
export function determineRawThreatLevel(galaxy: Galaxy, threat: BuiltObject, targetEmpire: Empire): number {
    if (threat.empire !== null && threat.empire !== targetEmpire) {
        let num = 1;
        let num2 = 0;
        if (threat.empire === galaxy.independentEmpire) {
            num = 1;
            if (targetEmpire !== null) checkSendPreWarpProgressEventMessage(galaxy, targetEmpire, PreWarpProgressEventType.FirstContactPirateOrIndependent, threat, threat.empire);
        } else if (targetEmpire.pirateEmpireBaseHabitat !== null && threat.empire !== targetEmpire && threat.empire !== null) {
            const pirateRelation = obtainPirateRelation(targetEmpire, threat.empire);
            switch (pirateRelation.type) {
                case PirateRelationType.NotMet:
                    doEmpireEncounter(galaxy, targetEmpire, threat.empire, threat);
                    num = 50;
                    num2 = 1;
                    break;
                case PirateRelationType.Protection:
                    num = 0;
                    num2 = 1;
                    break;
                case PirateRelationType.None:
                    num = 50;
                    num2 = 1;
                    break;
            }
        } else if (threat.empire.pirateEmpireBaseHabitat !== null) {
            num = 50;
            if (!targetEmpire.knownPirateEmpires.includes(threat.empire)) {
                doSuperPirateEmpireEncounter(galaxy, targetEmpire, threat.empire, threat.xpos, threat.ypos);
                targetEmpire.knownPirateEmpires.push(threat.empire);
            }
            if (threat.empire !== null) {
                const pirateRelation2 = obtainPirateRelation(targetEmpire, threat.empire);
                switch (pirateRelation2.type) {
                    case PirateRelationType.NotMet:
                        doEmpireEncounter(galaxy, targetEmpire, threat.empire, threat);
                        num = 50;
                        num2 = 1;
                        break;
                    case PirateRelationType.Protection:
                        num = 0;
                        num2 = 1;
                        break;
                    case PirateRelationType.None:
                        num = 50;
                        num2 = 1;
                        break;
                }
            }
            if (targetEmpire === galaxy.independentEmpire) {
                num = 0;
            }
        } else {
            // 3879: targetEmpire.ObtainDiplomaticRelation(threat.Empire) never returns null (it creates a NotMet relation).
            const diplomaticRelation = obtainDiplomaticRelation(targetEmpire, threat.empire);
            if (diplomaticRelation !== null) {
                switch (diplomaticRelation.type) {
                    case DiplomaticRelationType.FreeTradeAgreement:
                    case DiplomaticRelationType.MutualDefensePact:
                    case DiplomaticRelationType.SubjugatedDominion:
                    case DiplomaticRelationType.Protectorate:
                        num = 0;
                        break;
                    case DiplomaticRelationType.None:
                        num = 1;
                        break;
                    case DiplomaticRelationType.TradeSanctions:
                        num = 1;
                        break;
                    case DiplomaticRelationType.Truce:
                        num = 10;
                        break;
                    case DiplomaticRelationType.War:
                        num = 100;
                        break;
                    case DiplomaticRelationType.NotMet:
                        num = 1;
                        doEmpireEncounter(galaxy, targetEmpire, threat.empire, threat);
                        break;
                }
            } else {
                if (threat.empire !== galaxy.independentEmpire) {
                    num = 1;
                }
                doEmpireEncounter(galaxy, targetEmpire, threat.empire, threat);
            }
            if ((targetEmpire.outlaws as BuiltObject[]).includes(threat)) {
                num = 100;
            }
        }
        if (num >= 50) {
            num2 = 1;
        }
        if (threat.firepowerRaw > 0) {
            num2 = Math.max(10, Math.trunc(threat.size / 10));
        }
        return Math.trunc(num * num2);
    }
    return 0;
}

/**
 * Galaxy.7.cs 3223 EvaluateSystemThreats(systemStar, targetEmpire, out threatLevels) → BuiltObjectList (parallel int list).
 * Called by Habitat.PerformThreatEvaluation (M4t exploration.ts) and BuiltObject.PerformThreatEvaluation (here).
 */
export function evaluateSystemThreats(galaxy: Galaxy, systemStar: Habitat, empire: Empire): { threats: BuiltObject[]; threatLevels: number[] } {
    const builtObjectList: BuiltObject[] = [];
    const threatLevels: number[] = [];
    const builtObjectsAtLocationByArrays = getBuiltObjectsAtLocationByArrays(galaxy, systemStar.xpos, systemStar.ypos, galaxy.maxSolarSystemSize * 2);
    for (let i = 0; i < builtObjectsAtLocationByArrays.length; i++) {
        const num = builtObjectsAtLocationByArrays[i].length;
        for (let j = 0; j < num; j++) {
            const builtObject = builtObjectsAtLocationByArrays[i][j];
            if (builtObject != null && builtObject.nearestSystemStar === systemStar && builtObject.empire !== empire) {
                const num2 = determineRawThreatLevel(galaxy, builtObject, empire);
                if (num2 > 10 && !builtObjectList.includes(builtObject)) {
                    builtObjectList.push(builtObject);
                    threatLevels.push(num2);
                }
            }
        }
    }
    return { threats: builtObjectList, threatLevels };
}

// ---------------------------------------------------------------------------------------------------------------
// Defending / nearby strength (Galaxy.6.cs 4663-4780, Galaxy.7.cs 20-90 / 240, Galaxy.5.cs 3008, BuiltObjectList.cs 570)
// ---------------------------------------------------------------------------------------------------------------

/** Galaxy.7.cs 20 DetermineShipStrengthNearHabitat(habitat, empire, out ships). */
export function determineShipStrengthNearHabitat(galaxy: Galaxy, habitat: Habitat | null, empire: Empire | null): { strength: number; ships: BuiltObject[] } {
    let num = 0;
    const ships: BuiltObject[] = [];
    if (empire !== null && empire.builtObjects !== null && habitat !== null) {
        const num2 = 4000000;
        const habitat2 = galaxy.determineHabitatSystemStar(habitat);
        if (empire.builtObjects !== null) {
            for (let i = 0; i < empire.builtObjects.length; i++) {
                const builtObject = empire.builtObjects[i];
                if (builtObject != null && builtObject.nearestSystemStar === habitat2 && builtObject.role === BuiltObjectRole.Military && builtObject.builtAt === null) {
                    let num3 = 0.0;
                    if (builtObject.warpSpeed <= 0) {
                        num3 = galaxy.calculateDistanceSquared(habitat.xpos, habitat.ypos, builtObject.xpos, builtObject.ypos);
                    }
                    if (num3 < num2) {
                        num += calculateOverallStrengthFactor(builtObject);
                        ships.push(builtObject);
                    }
                }
            }
        }
    }
    return { strength: num, ships };
}

/** Galaxy.7.cs 52 DetermineShipStrengthInSystem(systemStar, empire, out ships). */
export function determineShipStrengthInSystem(galaxy: Galaxy, systemStar: Habitat | null, empire: Empire | null): { strength: number; ships: BuiltObject[] } {
    void galaxy;
    let num = 0;
    const ships: BuiltObject[] = [];
    if (empire !== null && empire.builtObjects !== null && systemStar !== null) {
        for (let i = 0; i < empire.builtObjects.length; i++) {
            const builtObject = empire.builtObjects[i];
            if (builtObject != null && builtObject.nearestSystemStar === systemStar && builtObject.role === BuiltObjectRole.Military && builtObject.builtAt === null && builtObject.warpSpeed > 0) {
                num += calculateOverallStrengthFactor(builtObject);
                ships.push(builtObject);
            }
        }
    }
    return { strength: num, ships };
}

/** Galaxy.7.cs 71 DetermineShipStrengthInSystem(systemStar, x, y, empire, out ships). */
export function determineShipStrengthInSystemAt(galaxy: Galaxy, systemStar: Habitat | null, x: number, y: number, empire: Empire | null): { strength: number; ships: BuiltObject[] } {
    let num = 0;
    const ships: BuiltObject[] = [];
    if (empire !== null && empire.builtObjects !== null && systemStar !== null) {
        const num2 = 4000000;
        for (let i = 0; i < empire.builtObjects.length; i++) {
            const builtObject = empire.builtObjects[i];
            if (builtObject != null && builtObject.nearestSystemStar === systemStar && builtObject.role === BuiltObjectRole.Military && builtObject.builtAt === null) {
                let num3 = 0.0;
                if (builtObject.warpSpeed <= 0) {
                    num3 = galaxy.calculateDistanceSquared(x, y, builtObject.xpos, builtObject.ypos);
                }
                if (num3 < num2) {
                    num += calculateOverallStrengthFactor(builtObject);
                    ships.push(builtObject);
                }
            }
        }
    }
    return { strength: num, ships };
}

/** Galaxy.6.cs 4749 DetermineBaseStrengthAtHabitat(habitat, empire). */
export function determineBaseStrengthAtHabitat(galaxy: Galaxy, habitat: Habitat | null, empire: Empire | null): number {
    void galaxy;
    void empire;
    let num = 0;
    if (habitat !== null && habitat.basesAtHabitat !== null && habitat.basesAtHabitat.length > 0) {
        for (let i = 0; i < habitat.basesAtHabitat.length; i++) {
            const builtObject = habitat.basesAtHabitat[i];
            if (builtObject != null) {
                num += calculateOverallStrengthFactor(builtObject);
            }
        }
    }
    return num;
}

/** Galaxy.6.cs 4663 DetermineDefendingStrength(ShipGroup fleet, empire). */
export function determineDefendingStrengthFleet(galaxy: Galaxy, fleet: ShipGroup | null, empire: Empire | null): number {
    let num = 0;
    if (fleet !== null && fleet.leadShip !== null && fleet.leadShip.nearestSystemStar !== null) {
        num += determineShipStrengthInSystem(galaxy, fleet.leadShip.nearestSystemStar, empire).strength;
    }
    return num;
}

/** Galaxy.6.cs 4674 DetermineDefendingStrength(BuiltObject, empire) / 4745 DetermineDefendingStrength(Habitat, empire). */
export function determineDefendingStrength(galaxy: Galaxy, target: BuiltObject | Habitat, empire: Empire): number {
    let num = 0;
    if (isBuiltObject(target)) {
        const builtObject = target;
        if (builtObject !== null) {
            if (builtObject.nearestSystemStar !== null) {
                num += determineShipStrengthInSystemAt(galaxy, builtObject.nearestSystemStar, builtObject.xpos, builtObject.ypos, empire).strength;
            }
            if (builtObject.parentHabitat !== null) {
                num += determineBaseStrengthAtHabitat(galaxy, builtObject.parentHabitat, empire);
            } else if (builtObject.role === BuiltObjectRole.Base) {
                num += calculateOverallStrengthFactor(builtObject);
            }
        }
        return num;
    }
    const habitat = target;
    if (habitat !== null) {
        num += determineShipStrengthNearHabitat(galaxy, habitat, empire).strength;
        num += determineBaseStrengthAtHabitat(galaxy, habitat, empire);
    }
    return num;
}

/** Galaxy.7.cs 240 DetermineDefendingBaseStrengthAtColony(colony). */
export function determineDefendingBaseStrengthAtColony(galaxy: Galaxy, colony: Habitat | null): number {
    let num = 0;
    if (colony !== null && colony.empire !== null && colony.empire !== galaxy.independentEmpire && colony.basesAtHabitat !== null) {
        for (let i = 0; i < colony.basesAtHabitat.length; i++) {
            const builtObject = colony.basesAtHabitat[i];
            if (builtObject != null) {
                num += calculateOverallStrengthFactor(builtObject);
            }
        }
    }
    return num;
}

/** Galaxy.5.cs 3018 CalculateNearbyOverallStrength(x, y, empire, range, builtObjects). */
export function calculateNearbyOverallStrengthIn(galaxy: Galaxy, x: number, y: number, empire: Empire | null, range: number, builtObjects: readonly (BuiltObject | null)[]): number {
    let num = 0;
    const num2 = range * range;
    for (let i = 0; i < builtObjects.length; i++) {
        const builtObject = builtObjects[i];
        if (builtObject == null || builtObject.hasBeenDestroyed || builtObject.empire !== empire || builtObject.builtAt !== null) {
            continue;
        }
        if (builtObject.role === BuiltObjectRole.Base) {
            const num3 = galaxy.calculateDistanceSquared(x, y, builtObject.xpos, builtObject.ypos);
            if (num3 < num2) {
                num += calculateOverallStrengthFactor(builtObject);
            }
        } else {
            if (builtObject.role !== BuiltObjectRole.Military) {
                continue;
            }
            let flag = true;
            const mission = builtObjectMission(builtObject.mission);
            if (mission !== null && (mission.type === BuiltObjectMissionType.Escape || mission.type === BuiltObjectMissionType.Refuel || mission.type === BuiltObjectMissionType.Repair || mission.type === BuiltObjectMissionType.Retire || mission.type === BuiltObjectMissionType.Retrofit)) {
                flag = false;
            }
            if (flag) {
                let num4 = num2;
                if (builtObject.warpSpeed >= 0) {
                    num4 = 2304000000.0;
                }
                const num5 = galaxy.calculateDistanceSquared(x, y, builtObject.xpos, builtObject.ypos);
                if (num5 < num4) {
                    num += calculateOverallStrengthFactor(builtObject);
                }
            }
        }
    }
    return num;
}

/** Galaxy.5.cs 3008 CalculateNearbyOverallStrength(x, y, empire, range): over the index cell of (x, y). */
export function calculateNearbyOverallStrength(galaxy: Galaxy, x: number, y: number, empire: Empire | null, range: number): number {
    const idx = galaxy.resolveIndex(x, y);
    const builtObjectList = galaxy.builtObjectIndexGrid[idx.x][idx.y].slice();
    return calculateNearbyOverallStrengthIn(galaxy, x, y, empire, range, builtObjectList);
}

/** BuiltObjectList.cs 570 CalculateAttackingFirepowerNearEmpireTargets(targetEmpire) on SystemVisibility.Threats. */
export function calculateAttackingFirepowerNearEmpireTargets(galaxy: Galaxy, systemVisibility: SystemVisibility, empire: Empire): number {
    let num = 0;
    const list = systemVisibility.threats;
    for (let i = 0; i < list.length; i++) {
        const builtObject = list[i];
        if (builtObject == null || builtObject.hasBeenDestroyed) {
            continue;
        }
        const mission = builtObjectMission(builtObject.mission);
        if (mission === null) {
            continue;
        }
        let flag = false;
        let stellarObject: BuiltObject | Habitat | null = null;
        let targetEmpire: Empire | null = null;
        switch (mission.type) {
            case BuiltObjectMissionType.Attack:
            case BuiltObjectMissionType.WaitAndAttack:
            case BuiltObjectMissionType.WaitAndBombard:
            case BuiltObjectMissionType.Bombard:
            case BuiltObjectMissionType.Capture:
            case BuiltObjectMissionType.Raid:
                flag = true;
                if (mission.targetBuiltObject !== null) {
                    stellarObject = mission.targetBuiltObject;
                    targetEmpire = stellarObject.empire;
                } else if (mission.targetHabitat !== null) {
                    stellarObject = mission.targetHabitat;
                    targetEmpire = stellarObject.empire;
                } else if (mission.targetShipGroup !== null && mission.targetShipGroup.leadShip !== null) {
                    stellarObject = mission.targetShipGroup.leadShip;
                    targetEmpire = stellarObject.empire;
                }
                break;
        }
        if (flag && stellarObject !== null && targetEmpire !== null && targetEmpire === empire) {
            const num2 = galaxy.calculateDistanceSquared(builtObject.xpos, builtObject.ypos, stellarObject.xpos, stellarObject.ypos);
            if (num2 < 2500000000.0) {
                num += builtObject.firepowerRaw;
            }
        }
    }
    return num;
}

// ---------------------------------------------------------------------------------------------------------------
// BaconBuiltObject.cs 4863 IdentifySystemThreatsToUs / 4939 FilterInvalidTargets
// ---------------------------------------------------------------------------------------------------------------

/** CharacterList.GetHighestSkillLevel(skillType) (CharacterList.cs 259). */
function getHighestSkillLevel(list: readonly (Character | null)[], skillType: CharacterSkillType): number {
    let highestSkillLevel = -100;
    for (let index = 0; index < list.length; ++index) {
        const character = list[index];
        if (character != null) {
            const skillLevel = character.getSkillLevel(skillType);
            if (skillLevel > highestSkillLevel) highestSkillLevel = skillLevel;
        }
    }
    if (highestSkillLevel === -100) highestSkillLevel = 0;
    return highestSkillLevel;
}

/** BaconBuiltObject.cs 4939 FilterInvalidTargets(ship, threatList): the player-only "notarget" BaconValue restrictions. */
export function filterInvalidTargets(ship: BuiltObject, threatList: Threat[]): Threat[] {
    const stellarObjectList1: Threat[] = [];
    const stellarObjectList2: Threat[] = [];
    if (ship.baconValues === null || !ship.baconValues.has('notarget')) return threatList;
    const baconValue = ship.baconValues.get('notarget') as string[];
    for (let index = 0; index < threatList.length; ++index) {
        const t = threatList[index];
        if (isBuiltObject(t)) {
            const threat = t;
            if ((threat.role === BuiltObjectRole.Military && baconValue.includes('military')) || (threat.role === BuiltObjectRole.Base && baconValue.includes('bases')) || (calculateFirepowerFactor(threat) > calculateFirepowerFactor(ship) && baconValue.includes('stronger')) || (threat.topSpeed > ship.topSpeed && baconValue.includes('faster'))) {
                stellarObjectList2.push(threat);
            }
        }
    }
    for (let index = 0; index < threatList.length; ++index) {
        if (!stellarObjectList2.includes(threatList[index])) stellarObjectList1.push(threatList[index]);
    }
    return stellarObjectList1;
}

/**
 * BaconBuiltObject.cs 4863 IdentifySystemThreatsToUs(ship, systemStar, out threatLevels, out totalThreatLevel).
 * RND: one Galaxy.Rnd.NextDouble() per pirate smuggler in trace-scanner range (4881), in list order.
 * SortTag is a scratch field on StellarObject; the TS Creature has none, so the tags live in a side map (BuiltObject.sortTag
 * is still written, as the C# does).
 */
export function identifySystemThreatsToUs(galaxy: Galaxy, ship: BuiltObject, systemStar: Habitat): { threats: Threat[]; threatLevels: number[]; totalThreatLevel: number } {
    const stellarObjectList: Threat[] = [];
    const sortTags = new Map<Threat, number>();
    let num1: number = THREAT_RANGE;
    if (ship.sensorProximityArrayRange > num1) num1 = ship.sensorProximityArrayRange;
    const num2 = THREAT_RANGE / 2.0;
    const num3 = num1 * num1;
    const shipEmpire = ship.empire!;
    const systemVisibility = shipEmpire.systemVisibility[systemStar.systemIndex];
    for (let index = 0; index < systemVisibility.threats.length; ++index) {
        const threat = systemVisibility.threats[index];
        const distanceSquared = galaxy.calculateDistanceSquared(threat.xpos, threat.ypos, ship.xpos, ship.ypos);
        if (distanceSquared <= num3) {
            const num4 = Math.sqrt(distanceSquared);
            if (num4 < 1500.0 || stellarObjectList.length < 50) {
                const num5 = Math.max(1.0, num2 - num4);
                const num6 = (num5 * num5) / 1000000.0;
                if (threat.pirateEmpireId > 0 && threat.empire === galaxy.independentEmpire && threat.pirateEmpireId !== ship.pirateEmpireId && ship.sensorTraceScannerPower > 0 && num4 < ship.sensorTraceScannerRange && ship.sensorTraceScannerPower >= threat.sensorTraceScannerJamming && threat.characters !== null) {
                    const num7 = 0.2;
                    const d = 0.01 * getHighestSkillLevel(threat.characters as (Character | null)[], CharacterSkillType.SmugglingEvasion);
                    const num8 = Math.max(0.01, num7 - num7 * Math.sqrt(d));
                    if (galaxy.rnd.nextDouble() < num8) {
                        const byEmpireId = galaxy.pirateEmpires.find((e) => e.empireId === threat.pirateEmpireId) ?? null;
                        if (byEmpireId !== null && ship.empire !== null && obtainPirateRelation(ship.empire, byEmpireId).type !== PirateRelationType.Protection) {
                            threat.empire = byEmpireId;
                            // TODO(port) M9: TextResolver "Pirate Smuggler Detected Ours Ship" / "… Other Ship" (threat.Name, empire name, system name).
                            const description1 = `Pirate Smuggler Detected Ours Ship|${threat.name}|${ship.empire.name}|${systemStar.name}`;
                            sendMessageToEmpire(byEmpireId, byEmpireId, EmpireMessageType.PirateSmugglerDetected, threat, description1);
                            const description2 = `Pirate Smuggler Detected Other Ship|${threat.name}|${byEmpireId.name}|${systemStar.name}`;
                            sendMessageToEmpire(ship.empire, ship.empire, EmpireMessageType.PirateSmugglerDetected, threat, description2);
                            doCharacterEventForList(galaxy, CharacterEventType.SmugglingDetection, ship, threat.characters as Character[], false, null);
                            clearPreviousMissionRequirements(galaxy, threat);
                            assignMission(galaxy, threat, BuiltObjectMissionType.Escape, ship, null, BuiltObjectMissionPriority.High);
                        }
                    }
                }
                stellarObjectList.push(threat);
                let d1 = num6 * systemVisibility.threatLevels[index];
                if (Number.isNaN(d1)) d1 = 1.0;
                // 4900: a DefensiveBase weighs the player's troop-carrying ships ×100 (BaconBuiltObject.myMain._Game.PlayerEmpire).
                if (ship.subRole === BuiltObjectSubRole.DefensiveBase && galaxy.playerEmpire !== null && threat.empire === galaxy.playerEmpire && threat.troops !== null && threat.troops.count > 0) {
                    d1 *= 100.0;
                }
                threat.sortTag = d1;
                sortTags.set(threat, d1);
            }
        }
    }
    const creatures = galaxy.systems[systemStar.systemIndex].creatures ?? [];
    for (let index = 0; index < creatures.length; ++index) {
        const creature = creatures[index];
        if (creature.isVisible && creature.attackStrength > 0) {
            const distanceSquared = galaxy.calculateDistanceSquared(creature.xpos, creature.ypos, ship.xpos, ship.ypos);
            if (distanceSquared <= num3) {
                const num9 = Math.sqrt(distanceSquared);
                const num10 = Math.max(1.0, num2 - num9);
                const num11 = (num10 * num10) / 1000000.0;
                stellarObjectList.push(creature);
                let d = Math.max(1.0, num11 * 4000.0);
                if (Number.isNaN(d)) d = 1.0;
                sortTags.set(creature, d);
            }
        }
    }
    const source = filterInvalidTargets(ship, stellarObjectList);
    // StellarObject.SortStellarObject: x.SortTag.CompareTo(y.SortTag) (List.Sort → introsort), then Reverse.
    netSort(source, (x, y) => {
        const a = sortTags.get(x)!;
        const b = sortTags.get(y)!;
        return a < b ? -1 : a > b ? 1 : 0;
    });
    source.reverse();
    let totalThreatLevel = 0;
    for (let index = 0; index < source.length; ++index) {
        let d = sortTags.get(source[index])! / 1000.0;
        if (d > 21474836.0) d = 21474836.0;
        else if (d < 1.0) d = 1.0;
        if (Number.isNaN(d)) d = 1.0;
        totalThreatLevel += Math.trunc(d);
    }
    const count = Math.min(10, source.length);
    const array: Threat[] = source.slice(0, count);
    const threatLevels = new Array<number>(count);
    for (let index = 0; index < count; ++index) {
        // (int)Math.Max(int.MinValue, Math.Min(int.MaxValue, SortTag))
        threatLevels[index] = Math.trunc(Math.max(-2147483648, Math.min(2147483647, sortTags.get(source[index])!)));
    }
    return { threats: array, threatLevels, totalThreatLevel };
}

// ---------------------------------------------------------------------------------------------------------------
// BuiltObject.1.cs 208 PerformThreatEvaluation / 243 ThreatEvaluation and helpers
// ---------------------------------------------------------------------------------------------------------------

/** BuiltObject.WarpSpeedWithBonuses (BuiltObject.cs): WarpSpeed × fleet/captain bonuses — TODO(port) M4c/M4l: the bonuses; reads WarpSpeed. */
export function warpSpeedWithBonuses(bo: BuiltObject): number {
    return (bo as BuiltObject & { warpSpeedWithBonuses?: number }).warpSpeedWithBonuses ?? bo.warpSpeed;
}

/** BuiltObject.1.cs 208 PerformThreatEvaluation(time). */
export function performThreatEvaluation(galaxy: Galaxy, bo: BuiltObject, time: number): void {
    if (bo.empire === null) {
        const r = evaluateThreats(galaxy, bo, 100);
        bo.threats = r.threats;
        bo.threatLevels = r.threatLevels;
        return;
    }
    if (bo.role !== BuiltObjectRole.Base && bo.currentSpeed === Math.fround(warpSpeedWithBonuses(bo)) && warpSpeedWithBonuses(bo) > 0) {
        return;
    }
    if (bo.nearestSystemStar === null) {
        const r = evaluateThreats(galaxy, bo);
        bo.threats = r.threats;
        bo.threatLevels = r.threatLevels;
        return;
    }
    const dateTime = time - 5000; // time.AddSeconds(-5.0)
    const empire = bo.empire;
    const systemIndex = bo.nearestSystemStar.systemIndex;
    if (empire.systemVisibility.length > systemIndex && empire.systemVisibility[systemIndex].latestThreatEvaluation < dateTime) {
        empire.systemVisibility[systemIndex].latestThreatEvaluation = time;
        const r = evaluateSystemThreats(galaxy, bo.nearestSystemStar, empire);
        empire.systemVisibility[systemIndex].threats = r.threats;
        empire.systemVisibility[systemIndex].threatLevels = r.threatLevels;
    }
    const r2 = identifySystemThreatsToUs(galaxy, bo, bo.nearestSystemStar);
    bo.threats = r2.threats;
    bo.threatLevels = r2.threatLevels;
    bo.totalThreatLevel = r2.totalThreatLevel;
}

/** Galaxy.3.cs 1616/1621 FastFindNearestColony(x, y, empire, strategicValueThreshhold[, colonyToExclude]): over Empire.Colonies. */
export function fastFindNearestColony(galaxy: Galaxy, x: number, y: number, empire: Empire, strategicValueThreshhold: number, colonyToExclude: Habitat | null = null): Habitat | null {
    let num = Number.MAX_VALUE;
    let result: Habitat | null = null;
    for (let i = 0; i < empire.colonies.length; i++) {
        const colony = empire.colonies[i];
        if (strategicValue(colony) >= strategicValueThreshhold && colony !== colonyToExclude) {
            const num2 = galaxy.calculateDistanceSquared(x, y, colony.xpos, colony.ypos);
            if (num2 < num) {
                result = colony;
                num = num2;
            }
        }
    }
    return result;
}

/** BuiltObject.1.cs 615 CheckFleetsTravellingToLocation(x, y, out fleetStrength). */
export function checkFleetsTravellingToLocation(galaxy: Galaxy, bo: BuiltObject, x: number, y: number): { result: boolean; fleetStrength: number } {
    let fleetStrength = 0;
    let result = false;
    if (bo.empire !== null) {
        const num = Math.trunc(x - 2000.0);
        const num2 = Math.trunc(x + 2000.0);
        const num3 = Math.trunc(y - 2000.0);
        const num4 = Math.trunc(y + 2000.0);
        const shipGroups = bo.empire.shipGroups as ShipGroup[];
        for (let i = 0; i < shipGroups.length; i++) {
            const shipGroup = shipGroups[i];
            if (shipGroup.mission !== null && shipGroup.mission.type !== BuiltObjectMissionType.Undefined) {
                const point = shipGroup.mission.resolveTargetCoordinates(shipGroup.mission);
                if (point.x > num && point.x < num2 && point.y > num3 && point.y < num4) {
                    fleetStrength += shipGroupTotalOverallStrengthFactor(galaxy, shipGroup);
                    result = true;
                }
            }
        }
    }
    return { result, fleetStrength };
}

/** BuiltObject.1.cs 705 CheckBattleOverwhelming(targetThreat). */
export function checkBattleOverwhelming(galaxy: Galaxy, bo: BuiltObject, targetThreat: BuiltObject | null): boolean {
    const mission = builtObjectMission(bo.mission);
    if (bo.inBattle && isAiControlled(bo) && mission !== null && (mission.type === BuiltObjectMissionType.Attack || mission.type === BuiltObjectMissionType.Bombard) && bo.empire !== null && bo.empire !== galaxy.independentEmpire && bo.empire.pirateEmpireBaseHabitat === null) {
        let builtObject = targetThreat;
        const threats = builtObjectThreats(bo);
        if (builtObject === null) {
            for (let i = 0; i < threats.length; i++) {
                const t = threats[i];
                if (t !== null && isBuiltObject(t)) {
                    builtObject = t;
                    break;
                }
            }
        }
        if (builtObject !== null) {
            const totalThreatLevel = builtObject.totalThreatLevel;
            const totalThreatLevel2 = bo.totalThreatLevel;
            let num = totalThreatLevel2 / totalThreatLevel;
            const num2 = raceAggressionLevel(galaxy, bo.empire.dominantRace!) / 100.0; // Race.AggressionLevel (periodic)
            const num3 = raceCautionLevel(galaxy, bo.empire.dominantRace!) / 100.0; // Race.CautionLevel (periodic)
            let val = num2 / num3;
            val = Math.max(0.8, Math.min(val, 1.25));
            val *= 2.0;
            val /= num;
            if (bo.empire !== null && bo.empire.policy !== null) {
                val /= bo.empire.policy.shipBattleCautionFactor;
            }
            if (val < 1.0) {
                const fleets = checkFleetsTravellingToLocation(galaxy, bo, bo.xpos, bo.ypos);
                if (fleets.result) {
                    val *= num;
                    num = totalThreatLevel2 / (totalThreatLevel + fleets.fleetStrength);
                    val /= num;
                }
                if (builtObject !== null) {
                    const num4 = builtObject.currentShields / builtObject.shieldsCapacity;
                    if (num4 < 0.3) {
                        val /= num4 / 0.3;
                    }
                }
                if (val < 1.0) {
                    const habitat = fastFindNearestColony(galaxy, Math.trunc(bo.xpos), Math.trunc(bo.ypos), bo.empire, 50000);
                    let num5 = 536870911.0;
                    if (habitat !== null) {
                        num5 = galaxy.calculateDistance(bo.xpos, bo.ypos, habitat.xpos, habitat.ypos);
                    }
                    if (num5 < 1500.0) {
                        bo.lastWithdrawalEvaluation = false;
                        return false;
                    }
                    if (bo.lastWithdrawalEvaluation) {
                        bo.lastWithdrawalEvaluation = false;
                        return true;
                    }
                    bo.lastWithdrawalEvaluation = true;
                    return false;
                }
                bo.lastWithdrawalEvaluation = false;
                return false;
            }
            bo.lastWithdrawalEvaluation = false;
            return false;
        }
        bo.lastWithdrawalEvaluation = false;
        return false;
    }
    bo.lastWithdrawalEvaluation = false;
    return false;
}

/** BuiltObject.1.cs 844 DetermineAttackingFirepower(potentialTarget, out closestAttackerDistance). */
export function determineAttackingFirepower(galaxy: Galaxy, bo: BuiltObject, potentialTarget: StellarObject): { firepower: number; closestAttackerDistance: number } {
    void bo;
    let num = 0;
    let closestAttackerDistance = 536870911.0;
    const pursuers = stellarPursuers(potentialTarget);
    for (let i = 0; i < pursuers.length; i++) {
        const stellarObject = pursuers[i];
        if (stellarObject == null || stellarObject.hasBeenDestroyed || stellarFirepowerRaw(stellarObject) <= 0 || stellarTopSpeed(stellarObject) <= 0 || !stellarIsFunctional(stellarObject)) {
            continue;
        }
        let flag = true;
        if (isBuiltObject(stellarObject)) {
            const mission = builtObjectMission(stellarObject.mission);
            if (mission !== null) {
                switch (mission.type) {
                    default:
                        flag = false;
                        break;
                    case BuiltObjectMissionType.Attack:
                    case BuiltObjectMissionType.WaitAndAttack:
                    case BuiltObjectMissionType.WaitAndBombard:
                    case BuiltObjectMissionType.Bombard:
                    case BuiltObjectMissionType.Capture:
                    case BuiltObjectMissionType.Raid:
                        break;
                }
            }
        }
        if (!flag) {
            continue;
        }
        const num2 = galaxy.calculateDistance(stellarObject.xpos, stellarObject.ypos, potentialTarget.xpos, potentialTarget.ypos);
        if (num2 < ATTACK_EVALUATION_RANGE_FACTOR) {
            let num3 = stellarFirepowerRaw(stellarObject);
            if (isBuiltObject(stellarObject)) {
                num3 = calculateOverallStrengthFactor(stellarObject);
            } else if (isCreature(stellarObject)) {
                num3 = stellarObject.attackStrength * 5;
            }
            num += num3;
        }
        if (num2 < closestAttackerDistance) {
            closestAttackerDistance = num2;
        }
    }
    return { firepower: num, closestAttackerDistance };
}

/** BuiltObject.1.cs 903 EvaluateAttackStrongBase(target). */
export function evaluateAttackStrongBase(galaxy: Galaxy, bo: BuiltObject, target: StellarObject): boolean {
    if (isBuiltObject(target)) {
        const builtObject = target;
        const num = calculateOverallStrengthFactor(bo);
        if (builtObject.role === BuiltObjectRole.Base && calculateOverallStrengthFactor(builtObject) > num) {
            let num2 = calculateOverallStrengthFactor(bo);
            if (bo.empire !== null && bo.nearestSystemStar !== null) {
                const threats = bo.empire.systemVisibility[bo.nearestSystemStar.systemIndex].threats;
                num2 = calculateNearbyOverallStrengthIn(galaxy, builtObject.xpos, builtObject.ypos, builtObject.empire, 800.0, threats);
            }
            if (num > num2) {
                return true;
            }
            return false;
        }
    }
    return true;
}

/** BuiltObject.1.cs 924/930 EvaluateAdequateAttackers(potentialTarget[, out currentAssignedFirepower]). */
export function evaluateAdequateAttackers(galaxy: Galaxy, bo: BuiltObject, potentialTarget: StellarObject): { adequate: boolean; currentAssignedFirepower: number } {
    const r = determineAttackingFirepower(galaxy, bo, potentialTarget);
    const currentAssignedFirepower = r.firepower;
    const closestAttackerDistance = r.closestAttackerDistance;
    let num = 1;
    let num2 = stellarFirepowerRaw(potentialTarget);
    if (isBuiltObject(potentialTarget)) {
        num2 = calculateOverallStrengthFactor(potentialTarget);
    } else if (isCreature(potentialTarget)) {
        num2 = potentialTarget.attackStrength * 5;
        if (potentialTarget.type === CreatureType.SilverMist) {
            num2 *= 4;
        }
    }
    num = bo.empire === null ? Math.trunc(num2 * ATTACK_OVERMATCH_FACTOR) + 1 : Math.trunc(num2 * Math.fround(bo.empire.attackOvermatchFactor)) + 1;
    if (currentAssignedFirepower < num) {
        return { adequate: false, currentAssignedFirepower };
    }
    if (closestAttackerDistance * closestAttackerDistance > STRIKE_RANGE_SQUARED) {
        const num3 = galaxy.calculateDistanceSquared(potentialTarget.xpos, potentialTarget.ypos, bo.xpos, bo.ypos);
        if (num3 < STRIKE_RANGE_SQUARED) {
            return { adequate: false, currentAssignedFirepower };
        }
        return { adequate: true, currentAssignedFirepower };
    }
    return { adequate: true, currentAssignedFirepower };
}

/** BuiltObject.1.cs 390 CheckAssignAttackOnThreat(threat, mission, currentTargetEmphasis, threatLevel). */
export function checkAssignAttackOnThreat(galaxy: Galaxy, bo: BuiltObject, threat: Threat, mission: BuiltObjectMission | null, currentTargetEmphasis: number, threatLevel: number): boolean {
    if (evaluateAttackStrongBase(galaxy, bo, threat)) {
        let flag = false;
        if (isBuiltObject(threat)) {
            checkBattleOverwhelming(galaxy, bo, threat);
            flag = bo.lastWithdrawalEvaluation;
        }
        if (!flag && Math.fround(galaxy.calculateDistanceSquared(bo.xpos, bo.ypos, threat.xpos, threat.ypos)) < bo.attackRangeSquared) {
            let flag2 = true;
            if (mission !== null && mission.type === BuiltObjectMissionType.Refuel && mission.checkCommandsForUndock()) {
                flag2 = false;
            }
            if (flag2 && (mission === null || mission.type !== BuiltObjectMissionType.Escape)) {
                let stellarObject = bo.currentTarget as StellarObject | null;
                if (stellarObject === null && mission !== null) {
                    if (mission.targetBuiltObject !== null) {
                        stellarObject = mission.targetBuiltObject;
                    } else if (mission.targetCreature !== null) {
                        stellarObject = mission.targetCreature;
                    }
                }
                let flag3 = true;
                const shipGroup = shipGroupOf(bo);
                if (mission !== null && mission.type !== BuiltObjectMissionType.Undefined && shipGroup !== null && shipGroup.mission !== null && shipGroup.mission.type !== BuiltObjectMissionType.Undefined && mission.isShipGroupMission && (!shipGroup.allowImmediateThreatEvaluation || mission.checkCommandsForHyperjumpOrConditionalJump())) {
                    flag3 = false;
                    if (mission.type === BuiltObjectMissionType.Blockade) {
                        const command = mission.fastPeekCurrentCommand();
                        if (command !== null && command.action === CommandAction.Blockade) {
                            flag3 = true;
                        }
                    } else if (mission.type === BuiltObjectMissionType.WaitAndAttack || mission.type === BuiltObjectMissionType.WaitAndBombard) {
                        const command2 = mission.fastPeekCurrentCommand();
                        if (command2 !== null && command2.action === CommandAction.HoldSyncFleet) {
                            flag3 = true;
                        }
                    } else if (mission.type === BuiltObjectMissionType.MoveAndWait) {
                        if (isBuiltObject(threat)) {
                            if (threat.nearestSystemStar === bo.nearestSystemStar) {
                                flag3 = true;
                            }
                        } else if (isCreature(threat)) {
                            if (threat.nearestSystemStar === bo.nearestSystemStar) {
                                flag3 = true;
                            }
                        }
                    } else if (mission.type === BuiltObjectMissionType.Patrol) {
                        if (isBuiltObject(threat)) {
                            if (threat.nearestSystemStar === bo.nearestSystemStar) {
                                flag3 = true;
                            }
                        } else if (isCreature(threat)) {
                            if (threat.nearestSystemStar === bo.nearestSystemStar) {
                                flag3 = true;
                            }
                        }
                    } else if (mission.priority === BuiltObjectMissionPriority.Low) {
                        flag3 = true;
                    } else if (shipGroup.mission.targetShipGroup !== null) {
                        if (isBuiltObject(threat)) {
                            if (threat.shipGroup !== null && threat.shipGroup === shipGroup.mission.targetShipGroup) {
                                flag3 = true;
                            }
                        }
                    } else if (shipGroup.mission.targetBuiltObject !== null) {
                        if (isBuiltObject(threat)) {
                            if (shipGroup.mission.targetBuiltObject === threat) {
                                flag3 = true;
                            }
                        }
                    } else if (shipGroup.mission.targetHabitat !== null && isBuiltObject(threat)) {
                        if (shipGroup.mission.targetHabitat.basesAtHabitat.includes(threat)) {
                            flag3 = true;
                        }
                    }
                }
                let flag4 = true;
                if (bo.isPlanetDestroyer && bo.colonyToAttack !== null) {
                    flag4 = false;
                }
                if (flag3 && flag4 && mission !== null && (mission.type === BuiltObjectMissionType.Attack || mission.type === BuiltObjectMissionType.Capture || mission.type === BuiltObjectMissionType.Raid) && stellarObject !== null) {
                    const num = determineThreatLevel(galaxy, stellarObject, bo);
                    let num2 = Math.trunc(threatLevel);
                    if (isBuiltObject(threat)) {
                        if (threat.role === BuiltObjectRole.Base) {
                            num2 = Math.trunc(num2 / 6.0);
                        }
                    }
                    let num3 = 2.5;
                    if (stellarTopSpeed(stellarObject) <= 0) {
                        num3 = 2.5;
                    }
                    if (num * num3 * currentTargetEmphasis < num2 && stellarObject !== threat) {
                        let flag5 = false;
                        if (isBuiltObject(stellarObject)) {
                            const builtObject6 = stellarObject;
                            if (builtObject6.currentShields <= 0 || builtObject6.currentShields <= builtObject6.shieldsCapacity / 2.0) {
                                flag5 = true;
                            }
                        }
                        if (!flag5 && withinFuelRangeAndRefuel(galaxy, bo, threat.xpos, threat.ypos, 0.0)) {
                            if (shipGroup !== null && shipGroup.battleStats === null) {
                                startNewShipGroupBattleStats(galaxy, shipGroup);
                            }
                            let builtObjectMissionType = BuiltObjectMissionType.Attack;
                            if (isBuiltObject(threat)) {
                                builtObjectMissionType = determineDestroyOrCaptureTarget(galaxy, bo.empire!, bo, threat, false);
                            }
                            recordRevertMission(galaxy, bo, builtObjectMissionType, true);
                            clearPreviousMissionRequirements(galaxy, bo);
                            assignMission(galaxy, bo, builtObjectMissionType, threat, null, BuiltObjectMissionPriority.Normal);
                            return true;
                        }
                    }
                } else if (mission !== null && mission.targetHabitat !== null && ((mission.targetHabitat.empire !== bo.empire && mission.type === BuiltObjectMissionType.Attack) || (mission.targetHabitat.empire === bo.empire && mission.type === BuiltObjectMissionType.UnloadTroops)) && bo.troops !== null && bo.troops.totalAttackStrength > 0) {
                    // 513-517: a distance test with an empty body (dead code in the C#).
                    const num4 = galaxy.calculateDistanceSquared(bo.xpos, bo.ypos, mission.targetHabitat.xpos, mission.targetHabitat.ypos);
                    void num4;
                } else {
                    let flag6 = false;
                    if (mission !== null && (mission.type === BuiltObjectMissionType.Attack || mission.type === BuiltObjectMissionType.Capture || mission.type === BuiltObjectMissionType.Raid) && mission.target === threat) {
                        flag6 = true;
                    }
                    if (!flag6 && flag4) {
                        let flag7 = false;
                        if (mission !== null && mission.type === BuiltObjectMissionType.Bombard && bo.colonyToAttack !== null) {
                            flag7 = true;
                        }
                        let flag8 = false;
                        if (mission !== null && mission.type === BuiltObjectMissionType.Raid && bo.colonyToAttack !== null) {
                            flag8 = true;
                        }
                        if (!flag7 && !flag8 && flag3) {
                            if (shipGroup !== null && shipGroup.battleStats === null) {
                                startNewShipGroupBattleStats(galaxy, shipGroup);
                            }
                            let builtObjectMissionType2 = BuiltObjectMissionType.Attack;
                            if (isBuiltObject(threat)) {
                                builtObjectMissionType2 = determineDestroyOrCaptureTarget(galaxy, bo.empire!, bo, threat, false);
                            }
                            recordRevertMission(galaxy, bo, builtObjectMissionType2, true);
                            clearPreviousMissionRequirements(galaxy, bo);
                            assignMission(galaxy, bo, builtObjectMissionType2, threat, null, BuiltObjectMissionPriority.Normal);
                            return true;
                        }
                    }
                }
            }
        }
    }
    return false;
}

/** BuiltObject.1.cs 1520 ShouldFleeFrom(galaxy). */
export function shouldFleeFrom(galaxy: Galaxy, bo: BuiltObject): StellarObject | null {
    if (!bo.isFunctional || bo.topSpeed <= 0 || bo.empire === null) {
        return null;
    }
    const attackers = stellarAttackers(bo);
    if (attackers.length > 0) {
        let stellarObject: StellarObject | null = null;
        for (let i = 0; i < attackers.length; i++) {
            if (!attackers[i].hasBeenDestroyed) {
                const num = galaxy.calculateDistanceSquared(bo.xpos, bo.ypos, attackers[i].xpos, attackers[i].ypos);
                if (num < 2304000000.0) {
                    stellarObject = attackers[i];
                    break;
                }
            }
        }
        if (stellarObject !== null) {
            if (isBuiltObject(stellarObject) && attackers.length <= 1) {
                const m = builtObjectMission(stellarObject.mission);
                if (m !== null && m.type === BuiltObjectMissionType.Escape) {
                    return null;
                }
            }
            if ((bo.damagedComponentCount > 0 || bo.currentFuel <= 0.0) && bo.design.fleeWhen !== BuiltObjectFleeWhen.Never && bo.design.fleeWhen !== BuiltObjectFleeWhen.Armor50) {
                return stellarObject;
            }
            switch (bo.design.fleeWhen) {
                case BuiltObjectFleeWhen.EnemyMilitarySighted:
                    return stellarObject;
                case BuiltObjectFleeWhen.Attacked:
                    return stellarObject;
                case BuiltObjectFleeWhen.Shields50:
                    if (bo.currentShields <= Math.fround(Math.trunc(bo.shieldsCapacity / 2))) {
                        return stellarObject;
                    }
                    break;
                case BuiltObjectFleeWhen.Shields20:
                    if (bo.currentShields <= Math.fround(Math.trunc(bo.shieldsCapacity * 0.2))) {
                        return stellarObject;
                    }
                    break;
                case BuiltObjectFleeWhen.Armor50: {
                    if (bo.currentShields <= Math.fround(Math.trunc(bo.shieldsCapacity * 0.2))) {
                        return stellarObject;
                    }
                    if (bo.design === null) {
                        break;
                    }
                    if (bo.damagedComponentCount > 0) {
                        for (let j = 0; j < bo.components.count; j++) {
                            const builtObjectComponent = bo.components.items[j];
                            if (builtObjectComponent != null && builtObjectComponent.status === ComponentStatus.Damaged && builtObjectComponent.type !== ComponentType.Armor) {
                                return stellarObject;
                            }
                        }
                    }
                    const num2 = Math.fround(Math.fround(bo.armor) / Math.fround(Math.max(1, bo.design.armor)));
                    if (num2 <= 0.5) {
                        return stellarObject;
                    }
                    break;
                }
                case BuiltObjectFleeWhen.Never:
                    return null;
            }
        }
    } else if (bo.design.fleeWhen === BuiltObjectFleeWhen.EnemyMilitarySighted) {
        const threats = builtObjectThreats(bo);
        for (let k = 0; k < threats.length; k++) {
            const t = threats[k];
            if (t === null) {
                continue;
            }
            if (isCreature(t)) {
                if (checkWithinCreatureAttackRange(galaxy, bo.xpos, bo.ypos, t)) {
                    return t;
                }
                continue;
            }
            const builtObject2 = t;
            if (builtObject2.empire === bo.empire || builtObject2.empire === null || !builtObject2.isFunctional || (builtObject2.firepowerRaw <= 0 && builtObject2.fighterCapacity <= 0)) {
                continue;
            }
            if (builtObject2.topSpeed <= 0) {
                const num3 = galaxy.calculateDistance(builtObject2.xpos, builtObject2.ypos, bo.xpos, bo.ypos);
                if (num3 > builtObject2.maximumWeaponsRange) {
                    continue;
                }
            }
            let builtObject3: BuiltObject | null = null;
            if (builtObject2.empire.pirateEmpireBaseHabitat !== null) {
                if (bo.empire !== null && obtainPirateRelation(builtObject2.empire, bo.empire).type !== PirateRelationType.Protection) {
                    builtObject3 = builtObject2;
                }
            } else if ((bo.empire.outlaws as BuiltObject[]).includes(builtObject2)) {
                builtObject3 = builtObject2;
            }
            if (builtObject3 !== null && builtObject3.role === BuiltObjectRole.Military && !builtObject3.hasBeenDestroyed) {
                const num4 = galaxy.calculateDistanceSquared(bo.xpos, bo.ypos, builtObject3.xpos, builtObject3.ypos);
                if (num4 < 4000000.0) {
                    return builtObject3;
                }
            }
            if (builtObject2.empire.pirateEmpireBaseHabitat === null && bo.empire.pirateEmpireBaseHabitat === null) {
                const diplomaticRelation = bo.empire.diplomaticRelations.byEmpire(builtObject2.empire);
                if (diplomaticRelation !== null && diplomaticRelation.type === DiplomaticRelationType.War && builtObject2.role === BuiltObjectRole.Military && !builtObject2.hasBeenDestroyed) {
                    const num5 = galaxy.calculateDistanceSquared(bo.xpos, bo.ypos, builtObject2.xpos, builtObject2.ypos);
                    if (num5 < 4000000.0) {
                        return builtObject2;
                    }
                }
            } else {
                if (builtObject2.empire === null) {
                    continue;
                }
                const pirateRelation = obtainPirateRelation(bo.empire, builtObject2.empire);
                if (pirateRelation !== null && pirateRelation.type !== PirateRelationType.Protection && builtObject2.role === BuiltObjectRole.Military && !builtObject2.hasBeenDestroyed) {
                    const num6 = galaxy.calculateDistanceSquared(bo.xpos, bo.ypos, builtObject2.xpos, builtObject2.ypos);
                    if (num6 < 4000000.0) {
                        return builtObject2;
                    }
                }
            }
        }
    }
    return null;
}

/** BuiltObject.2.cs 14 ShouldInvadeColony(missionType) (BuiltObject.1.cs 5383: the no-arg form passes Attack). */
export function shouldInvadeColony(galaxy: Galaxy, bo: BuiltObject, missionType: BuiltObjectMissionType = BuiltObjectMissionType.Attack): boolean {
    let flag = false;
    const mission = builtObjectMission(bo.mission);
    if (mission !== null && (mission.type === BuiltObjectMissionType.Refuel || mission.type === BuiltObjectMissionType.Retire || mission.type === BuiltObjectMissionType.Retrofit || mission.type === BuiltObjectMissionType.Repair || mission.type === BuiltObjectMissionType.Escape)) {
        return false;
    }
    if (bo.colonyToAttack !== null && !bo.isPlanetDestroyer) {
        if (missionType === BuiltObjectMissionType.Bombard || missionType === BuiltObjectMissionType.Raid) {
            flag = true;
        } else {
            switch (bo.design.tacticsInvasion) {
                case InvasionTactics.DoNotInvade:
                    bo.colonyToAttack = null;
                    flag = false;
                    break;
                case InvasionTactics.InvadeWhenClear: {
                    const num = determineDefendingBaseStrengthAtColony(galaxy, bo.colonyToAttack);
                    if (num <= 0) {
                        flag = true;
                    }
                    break;
                }
                case InvasionTactics.InvadeImmediately:
                    flag = true;
                    break;
            }
        }
        if (flag) {
            if (missionType === BuiltObjectMissionType.Attack && mission !== null && mission.type === BuiltObjectMissionType.Bombard && mission.targetHabitat !== null && mission.targetHabitat === bo.colonyToAttack) {
                flag = false;
            }
            if (missionType !== BuiltObjectMissionType.Raid && bo.colonyToAttack !== null && (bo.colonyToAttack.owner === null || bo.colonyToAttack.empire === bo.empire)) {
                bo.colonyToAttack = null;
                flag = false;
            }
        }
    }
    return flag;
}

/** BuiltObject.2.cs 65 DetermineShipGroupTarget(targettedShipGroup, time). */
export function determineShipGroupTarget(galaxy: Galaxy, bo: BuiltObject, targettedShipGroup: ShipGroup, time: number): BuiltObject | null {
    performThreatEvaluation(galaxy, bo, time);
    const builtObjectList: BuiltObject[] = [];
    const threats = builtObjectThreats(bo);
    if (threats.length > 0) {
        for (let i = 0; i < threats.length; i++) {
            const stellarObject = threats[i];
            if (stellarObject === null || !isBuiltObject(stellarObject)) {
                continue;
            }
            const builtObject = stellarObject;
            if (builtObject !== null && !builtObject.hasBeenDestroyed && builtObject.shipGroup === targettedShipGroup) {
                if (!evaluateAdequateAttackers(galaxy, bo, builtObject).adequate) {
                    return builtObject;
                }
                builtObjectList.push(builtObject);
            }
        }
    }
    if (builtObjectList.length > 0) {
        for (let j = 0; j < builtObjectList.length; j++) {
            const builtObject2 = builtObjectList[j];
            if (builtObject2 !== null) {
                return builtObject2;
            }
        }
    }
    return null;
}

/** BuiltObject.1.cs 243 ThreatEvaluation(galaxy, time). */
export function threatEvaluation(galaxy: Galaxy, builtObject: BuiltObject, time: number): void {
    const bo = builtObject;
    if (bo.role !== BuiltObjectRole.Base && bo.currentSpeed === Math.fround(warpSpeedWithBonuses(bo)) && warpSpeedWithBonuses(bo) > 0) {
        return;
    }
    performThreatEvaluation(galaxy, bo, time);
    let flag = true;
    let currentTargetEmphasis = 1.0;
    const mission = builtObjectMission(bo.mission);
    if (!isAiControlled(bo)) {
        if (mission !== null && (mission.type === BuiltObjectMissionType.Patrol || mission.type === BuiltObjectMissionType.Escort || mission.type === BuiltObjectMissionType.Attack || mission.type === BuiltObjectMissionType.Bombard || mission.type === BuiltObjectMissionType.WaitAndAttack || mission.type === BuiltObjectMissionType.WaitAndBombard || mission.type === BuiltObjectMissionType.Capture || mission.type === BuiltObjectMissionType.Raid || mission.type === BuiltObjectMissionType.Blockade || mission.type === BuiltObjectMissionType.Explore || mission.type === BuiltObjectMissionType.Undefined)) {
            if (mission.checkCommandsForHyperjump()) {
                return;
            }
            currentTargetEmphasis = 1.0;
        } else if (mission !== null && (mission.type === BuiltObjectMissionType.Refuel || mission.type === BuiltObjectMissionType.Move || mission.type === BuiltObjectMissionType.MoveAndWait || mission.type === BuiltObjectMissionType.UnloadTroops || mission.type === BuiltObjectMissionType.Undefined || mission.type === BuiltObjectMissionType.Build || mission.type === BuiltObjectMissionType.ExtractResources)) {
            if (mission.checkCommandsForUndock()) {
                flag = false;
            }
            currentTargetEmphasis = 1.0;
        } else if (mission !== null && mission.type !== BuiltObjectMissionType.Undefined) {
            return;
        }
        if (mission !== null && mission.type !== BuiltObjectMissionType.Undefined && mission.manuallyAssigned) {
            switch (mission.type) {
                case BuiltObjectMissionType.Escape:
                case BuiltObjectMissionType.Retire:
                case BuiltObjectMissionType.Retrofit:
                case BuiltObjectMissionType.Refuel:
                case BuiltObjectMissionType.LoadTroops:
                case BuiltObjectMissionType.UnloadTroops:
                case BuiltObjectMissionType.Deploy:
                case BuiltObjectMissionType.Undeploy:
                case BuiltObjectMissionType.Repair:
                case BuiltObjectMissionType.Move:
                    return;
            }
        }
    }
    if (bo.role === BuiltObjectRole.Base) {
        return;
    }
    const stellarObject = shouldFleeFrom(galaxy, bo);
    if (stellarObject !== null) {
        if (bo.builtAt !== null || (mission !== null && (mission.type === BuiltObjectMissionType.Escape || bo.hyperjumpPrepare))) {
            return;
        }
        checkColonyShipMissionCancelled(galaxy, bo, 0);
        recordRevertMission(galaxy, bo, BuiltObjectMissionType.Escape);
        clearPreviousMissionRequirements(galaxy, bo);
        // 305-312: a Fighter flee target is replaced by its (live) parent ship — Fighters are not threats in the TS port (M4p).
        assignMission(galaxy, bo, BuiltObjectMissionType.Escape, stellarObject, null, BuiltObjectMissionPriority.High);
    } else {
        if ((bo.subRole === BuiltObjectSubRole.ResupplyShip && bo.isDeployed) || !flag) {
            return;
        }
        if (shouldInvadeColony(galaxy, bo) && bo.colonyToAttack !== null && bo.builtAt === null && bo.currentFuel > 0.0 && bo.currentEnergy > 0.0 && (mission === null || (mission.type !== BuiltObjectMissionType.Escape && mission.type !== BuiltObjectMissionType.Refuel))) {
            let flag2 = false;
            if (mission !== null && mission.type === BuiltObjectMissionType.Raid && mission.targetHabitat === bo.colonyToAttack) {
                flag2 = true;
            }
            if (!flag2 && withinFuelRange(galaxy, bo, bo.colonyToAttack.xpos, bo.colonyToAttack.ypos, 0.0)) {
                const shipGroup = shipGroupOf(bo);
                if (shipGroup !== null && shipGroup.battleStats === null) {
                    startNewShipGroupBattleStats(galaxy, shipGroup);
                }
                recordRevertMission(galaxy, bo, BuiltObjectMissionType.Attack, true);
                assignMission(galaxy, bo, BuiltObjectMissionType.Attack, bo.colonyToAttack, null, BuiltObjectMissionPriority.High);
                return;
            }
        }
        let flag3 = true;
        const currentTarget = bo.currentTarget as StellarObject | null;
        if (currentTarget !== null && !currentTarget.hasBeenDestroyed && mission !== null && (mission.type === BuiltObjectMissionType.Attack || mission.type === BuiltObjectMissionType.Bombard || mission.type === BuiltObjectMissionType.Capture || mission.type === BuiltObjectMissionType.Raid) && mission.manuallyAssigned) {
            flag3 = false;
        }
        if (!flag3) {
            return;
        }
        bo.secondaryTargets.length = 0;
        bo.secondaryThreatLevels.length = 0;
        const threats = builtObjectThreats(bo);
        const threatLevels = builtObjectThreatLevels(bo);
        for (let i = 0; i < threats.length; i++) {
            const stellarObject2 = threats[i];
            const num = threatLevels[i];
            if (stellarObject2 === null || !shouldAttack(galaxy, bo, stellarObject2, time) || stellarObject2.hasBeenDestroyed || bo.builtAt !== null || !(bo.currentFuel > 0.0) || !(bo.currentEnergy > 0.0)) {
                continue;
            }
            const adequate = evaluateAdequateAttackers(galaxy, bo, stellarObject2);
            if (!adequate.adequate) {
                if (checkAssignAttackOnThreat(galaxy, bo, stellarObject2, mission, currentTargetEmphasis, num)) {
                    return;
                }
            } else {
                bo.secondaryTargets.push(stellarObject2);
                bo.secondaryThreatLevels.push(num);
            }
        }
        if (bo.secondaryTargets.length <= 0) {
            return;
        }
        for (let j = 0; j < bo.secondaryTargets.length; j++) {
            const stellarObject3 = bo.secondaryTargets[j];
            const threatLevel = bo.secondaryThreatLevels[j];
            if (stellarObject3 !== null && checkAssignAttackOnThreat(galaxy, bo, stellarObject3, mission, currentTargetEmphasis, threatLevel)) {
                break;
            }
        }
    }
}

/** BuiltObject.1.cs 642 FleeFromHopelessBattle. */
export function fleeFromHopelessBattle(galaxy: Galaxy, builtObject: BuiltObject): void {
    const bo = builtObject;
    if (!bo.inBattle || !checkBattleOverwhelming(galaxy, bo, null) || bo.builtAt !== null) {
        return;
    }
    const shipGroup = shipGroupOf(bo);
    const mission = builtObjectMission(bo.mission);
    if (shipGroup !== null) {
        if (shipGroup.leadShip === null || shipGroup.leadShip !== bo || bo.hyperjumpPrepare) {
            return;
        }
        shipGroupCompleteMission(galaxy, shipGroup);
        bo.lastWithdrawalEvaluation = false;
        const shipGroup2 = shipGroupOf(bo);
        if (shipGroup2 !== null && (shipGroup2.mission === null || shipGroup2.mission.type === BuiltObjectMissionType.Undefined)) {
            let stellarObject: StellarObject | null = null;
            const attackers = stellarAttackers(bo);
            const pursuers = stellarPursuers(bo);
            if (attackers.length > 0) {
                stellarObject = attackers[0];
            } else if (pursuers.length > 0) {
                stellarObject = pursuers[0];
            } else if (bo.currentTarget !== null) {
                stellarObject = bo.currentTarget as StellarObject;
            }
            if (stellarObject !== null) {
                shipGroupAssignMission(galaxy, shipGroup2, BuiltObjectMissionType.Escape, stellarObject, null, BuiltObjectMissionPriority.Normal, false);
            }
        }
    } else if (mission === null || (mission.type !== BuiltObjectMissionType.Escape && !bo.hyperjumpPrepare)) {
        let stellarObject2: StellarObject | null = null;
        const attackers = stellarAttackers(bo);
        const pursuers = stellarPursuers(bo);
        if (attackers.length > 0) {
            stellarObject2 = attackers[0];
        } else if (pursuers.length > 0) {
            stellarObject2 = pursuers[0];
        } else if (bo.currentTarget !== null) {
            stellarObject2 = bo.currentTarget as StellarObject;
        }
        if (stellarObject2 !== null) {
            checkColonyShipMissionCancelled(galaxy, bo, 0);
            clearPreviousMissionRequirements(galaxy, bo);
            assignMission(galaxy, bo, BuiltObjectMissionType.Escape, stellarObject2, null, BuiltObjectMissionPriority.High);
        }
    }
}
