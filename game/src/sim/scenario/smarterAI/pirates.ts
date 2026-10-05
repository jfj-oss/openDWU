// Smarter AI add-on, part 4: pirate clean-up (scenarios/smarter-ai, flag smarterAIPirates). Not a port.
//
// Replaces the body of Empire.9.cs 1603 HuntPirates (fleets/militaryAI.ts huntPirates) for AI empires, through the
// huntPirates event raised right after the stock Next(0, 3) draw (so the Rnd sequence up to there is the stock one):
//   - stock: skipped while at war with anyone, a 1-in-3 gate (roll <= 0 skips), needs an existing Attack fleet, only
//     bases within ATTACK_ON_PIRATES_RANGE of the chosen fleet, one target per call;
//   - here: known pirate bases within NEAR_RANGE of one of our colonies are always hunted (no roll gate, also at war,
//     no ATTACK_ON_PIRATES_RANGE limit beyond fuel range); the others keep the roll gate and the range limit, and are
//     hunted at war only while the war front is far (no colony of an empire at war within WAR_FRONT_RANGE of ours);
//   - up to MAX_TARGETS bases per call, near ones first;
//   - with no available fleet a strike fleet is formed from the loose idle warships nearest the base (when they are
//     strong enough together);
//   - pirate facilities (PirateBase / PirateFortress / PirateCriminalNetwork) on our colonies: the stock
//     BaconEmpire.cs CheckColoniesForPirateFacilitiesAndAttack (pirates/pirateEmpireAI.ts) acts only in the huge block,
//     and asks for troops only while not at war. Here a strong enough garrison starts the attack at once
//     (InitiateAttackAgainstPirateFacilities, the stock invasion path) and a weak one gets a troop fleet sent to unload
//     there (AssignFleetUnloadTroops), or is queued in ColoniesNeedingTroops (also at war). Checked monthly.
// Deterministic: list order, no extra Rnd beyond the stock mission assignments.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { BuiltObject } from '../../builtObject';
import type { Habitat } from '../../types';
import { ShipGroup } from '../../fleets/shipGroup';
import { empireShipGroups } from '../../fleets/shipGroup';
import { BuiltObjectMissionPriority, BuiltObjectMissionType } from '../../missions/mission';
import { isAiControlled } from '../../missions/playerOrder';
import { calculateOverallStrengthFactor } from '../../combat/threats';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { PlanetaryFacilityType } from '../../researchSystem';
import { baconSettings } from '../../data/baconSettings';
import { netSort } from '../../netSort';
import { AdvisorMessageType, FleetPosture, checkTaskAuthorized, type RefCount } from '../../diplomacyTick';
import { AutomationLevel } from '../../empire';
import { PirateRelationType, obtainPirateRelation } from '../../pirateRelations';
import { EmpireActivityType } from '../../pirates/empireActivity';
import { identifyColonizationTargetsFull } from '../../civilianAI';
import { determineEmpiresAtWarWith } from '../../treasury';
import { checkPirateFacilityToAttack, initiateAttackAgainstPirateFacilities } from '../../pirates/pirateEmpireAI';
import { assignFleetUnloadTroops } from '../../combat/invasion';
import {
    ATTACK_ON_PIRATES_RANGE,
    calculateDefendingStrength,
    checkSystemVisibleStar,
    findNearestAvailableFleet,
    generateAutomationMessageAttackPirateBase,
    generateDistanceOrderedList,
    obtainAvailableMilitaryShips,
    resolveSystems,
} from '../../fleets/militaryAI';
import {
    addShipsToShipGroup,
    compareShipGroups,
    determineDestroyOrCaptureTargetForFleet,
    getNextFleetNumberDescription,
    selectFleetBase,
    shipGroupAssignMission,
    shipGroupCheckFleetTargetWithinFuelRangeAndRefuel,
    sortBuiltObjectsByDistance,
} from '../../fleets/shipGroupTasks';
import { registerScenarioEvent, registerScenarioPeriodic } from '../hooks';
import { SMARTER_AI_FLAG, isSmarterAIEmpire, smarterAIOn } from './common';

export const SMARTER_AI_PIRATES_FLAG = 'smarterAIPirates';

const SECTOR_SIZE = 2_000_000; // as research.ts
export interface PirateRules {
    /** A known pirate base within this distance of one of our colonies is always hunted. */
    nearRange: number;
    /** At war, far bases are hunted only while no colony of an enemy is this close to ours. */
    warFrontRange: number;
    /** Bases attacked per call. */
    maxTargets: number;
    /** A strike fleet is formed when the loose warships reach this × the base's defending strength. */
    strikeMargin: number;
}
export const PIRATE_RULES: PirateRules = { nearRange: 1.5 * SECTOR_SIZE, warFrontRange: 4 * SECTOR_SIZE, maxTargets: 3, strikeMargin: 1.5 };

function distanceToNearestColony(empire: Empire, x: number, y: number): number {
    let best = Number.MAX_VALUE;
    for (const h of empire.colonies) {
        if (h === null || h.empire !== empire) continue;
        const d = Math.hypot(h.xpos - x, h.ypos - y);
        if (d < best) best = d;
    }
    return best;
}

/** No colony of an empire at war with us within warFrontRange of one of ours (true when at peace). */
export function warFrontFar(galaxy: Galaxy, empire: Empire, rules: PirateRules = PIRATE_RULES): boolean {
    for (const e of determineEmpiresAtWarWith(galaxy, empire).empires) {
        for (const h of e.colonies) if (h !== null && distanceToNearestColony(empire, h.xpos, h.ypos) < rules.warFrontRange) return false;
    }
    return true;
}

/** The fleet's total strength against a target (shipGroupTotalOverallStrengthFactor's sum over ships). */
function strengthOf(ships: readonly BuiltObject[]): number {
    let s = 0;
    for (const b of ships) s += calculateOverallStrengthFactor(b);
    return s;
}

/**
 * A new Attack-posture strike fleet of the loose idle warships nearest (x, y), as Empire.9.cs MaintainShipGroups forms
 * one (gather point SelectFleetBase, AddShipsToShipGroup, "Nth Strike Force"); null when they are not strong enough.
 */
export function formStrikeFleet(galaxy: Galaxy, empire: Empire, x: number, y: number, required: number, rules: PirateRules = PIRATE_RULES): ShipGroup | null {
    let loose = obtainAvailableMilitaryShips(galaxy, empire, 1, false, false, false).filter((b) => b.subRole !== BuiltObjectSubRole.Escort && b.topSpeed > 0);
    if (loose.length === 0) return null;
    loose = sortBuiltObjectsByDistance(galaxy, loose, x, y);
    const want = Math.max(1, required) * rules.strikeMargin;
    let n = 0;
    let s = 0;
    while (n < loose.length && s < want) s += calculateOverallStrengthFactor(loose[n++]);
    if (s < want) return null;
    const g = new ShipGroup(galaxy);
    g.empire = empire;
    g.posture = FleetPosture.Attack;
    g.shipTargetAmount = n;
    g.gatherPoint = selectFleetBase(galaxy, empire, g);
    addShipsToShipGroup(galaxy, empire, g, loose.slice(0, n), n, true, null, 0);
    if (g.ships.length === 0) return null;
    g.name = `${getNextFleetNumberDescription(empire)} Strike Force`;
    const groups = empireShipGroups(empire);
    groups.push(g);
    netSort(groups, compareShipGroups);
    return g;
}

/** The ships already attacking `target` (the stock num4 loop). */
function strengthAssigned(empire: Empire, target: BuiltObject): number {
    let s = 0;
    for (const b of empire.builtObjects) {
        const m = b.mission as { type?: number; targetBuiltObject?: unknown } | null;
        if (m != null && m.type === BuiltObjectMissionType.Attack && m.targetBuiltObject === target) s += calculateOverallStrengthFactor(b);
    }
    return s;
}

/** The relaxed hunt; returns the bases a fleet was sent against. Rnd: the mission assignments only. */
export function smarterHuntPirates(galaxy: Galaxy, self: Empire, roll: number, rules: PirateRules = PIRATE_RULES): BuiltObject[] {
    const sent: BuiltObject[] = [];
    if (self.capital === null) return sent;
    const refusalCount: RefCount = { value: 0 };
    const farAllowed = roll > 0 && warFrontFar(galaxy, self, rules);
    let systemPriorities: Habitat[] = [];
    const prio = farAllowed ? identifyColonizationTargetsFull(galaxy, self, false, 0, 2147483647, false, false) : null;
    if (prio !== null) systemPriorities = resolveSystems(prio);
    const ordered = generateDistanceOrderedList(self.knownPirateBases.filter((b) => b !== null && !b.hasBeenDestroyed && b.empire !== null), self.capital.xpos, self.capital.ypos, systemPriorities);
    const near = ordered.filter((b) => distanceToNearestColony(self, b.xpos, b.ypos) <= rules.nearRange);
    const targets = [...near, ...(farAllowed ? ordered.filter((b) => !near.includes(b)) : [])];
    for (const b of targets) {
        if (sent.length >= rules.maxTargets) break;
        const pirate = b.empire!;
        if (pirate.pirateMissions.indexOfRequester(self, EmpireActivityType.Attack) >= 0 || obtainPirateRelation(pirate, self).type === PirateRelationType.Protection) continue;
        const isNear = near.includes(b);
        let strength = calculateOverallStrengthFactor(b);
        if (checkSystemVisibleStar(self, b.nearestSystemStar)) strength = calculateDefendingStrength(galaxy, self, b).strength;
        if (strengthAssigned(self, b) >= Math.trunc(strength * 1.5)) continue;
        let fleet = findNearestAvailableFleet(galaxy, self, b.xpos, b.ypos, BuiltObjectMissionPriority.Low, strength, FleetPosture.Attack, true, 0.1, false, false, false, !isNear);
        if (fleet === null) fleet = findNearestAvailableFleet(galaxy, self, b.xpos, b.ypos, BuiltObjectMissionPriority.Low, strength, FleetPosture.Defend, true, 0.1, false, false, false, !isNear);
        if (fleet === null) fleet = formStrikeFleet(galaxy, self, b.xpos, b.ypos, strength, rules);
        if (fleet === null || fleet.leadShip === null) continue;
        const d = galaxy.calculateDistance(fleet.leadShip.xpos, fleet.leadShip.ypos, b.xpos, b.ypos);
        if ((!isNear && !(d < ATTACK_ON_PIRATES_RANGE)) || !shipGroupCheckFleetTargetWithinFuelRangeAndRefuel(galaxy, fleet, b.xpos, b.ypos, 0.1)) continue;
        if (
            (isAiControlled(fleet.leadShip) || self.controlMilitaryAttacks === AutomationLevel.PartiallyAutomated) &&
            checkTaskAuthorized(galaxy, self, self.controlMilitaryAttacks, refusalCount, generateAutomationMessageAttackPirateBase(b, fleet), b, AdvisorMessageType.EnemyAttack, null, fleet, null)
        ) {
            shipGroupAssignMission(galaxy, fleet, determineDestroyOrCaptureTargetForFleet(galaxy, self, fleet, b), b, null, BuiltObjectMissionPriority.High, true);
            sent.push(b);
        }
    }
    return sent;
}

/** BaconEmpire.cs 1499 CheckColoniesForPirateFacilitiesAndAttack: the garrison attack strength the facility needs. */
export function pirateFacilityTroopsRequired(type: PlanetaryFacilityType): number {
    let n = 0;
    switch (type) {
        case PlanetaryFacilityType.PirateBase: n = 1 + Math.trunc(baconSettings.pirateBaseTroops * 0.67000001668930054); break;
        case PlanetaryFacilityType.PirateFortress: n = 1 + Math.trunc(baconSettings.pirateFortressTroops * 0.67000001668930054); break;
        case PlanetaryFacilityType.PirateCriminalNetwork: n = 1 + Math.trunc(baconSettings.pirateCriminalNetworkTroops * 0.67000001668930054); break;
    }
    return n * 50 * 100;
}

function troopFleetEnRoute(empire: Empire, colony: Habitat): boolean {
    for (const g of empireShipGroups(empire)) {
        const m = g?.mission ?? null;
        if (m !== null && m.type === BuiltObjectMissionType.UnloadTroops && m.targetHabitat === colony) return true;
    }
    return false;
}

export type FacilityAction = { colony: Habitat; action: 'attack' | 'troops' | 'queued' };

/** Pirate facilities on our colonies: attack with the garrison, or bring troops (one dispatch per call). */
export function cleanUpPirateFacilities(galaxy: Galaxy, self: Empire): FacilityAction[] {
    const out: FacilityAction[] = [];
    let dispatched = false;
    for (const colony of self.colonies) {
        if (colony === null || colony.hasBeenDestroyed || colony.empire !== self) continue;
        const { facility, pirateFaction } = checkPirateFacilityToAttack(galaxy, colony);
        if (facility === null || pirateFaction === null) continue;
        const required = pirateFacilityTroopsRequired(facility.type);
        const garrison = colony.troops !== null ? colony.troops.totalAttackStrength : 0;
        if (garrison > required) {
            if (colony.invadingTroops !== null && colony.invadingTroops.count > 0) continue;
            const refusalCount: RefCount = { value: 0 };
            if (checkTaskAuthorized(galaxy, self, self.controlMilitaryAttacks, refusalCount, `${colony.name}: ${facility.name}`, colony, AdvisorMessageType.PirateFacilityEradicate, null, facility, pirateFaction)) {
                initiateAttackAgainstPirateFacilities(galaxy, colony, self, facility);
                out.push({ colony, action: 'attack' });
            }
            continue;
        }
        if (troopFleetEnRoute(self, colony)) continue;
        const fleet = dispatched ? null : findNearestAvailableFleet(galaxy, self, colony.xpos, colony.ypos, BuiltObjectMissionPriority.Low, 0, FleetPosture.Attack, true, 0.1, false, false, false, false, required - garrison + 1);
        if (fleet !== null && fleet.leadShip !== null && isAiControlled(fleet.leadShip) && assignFleetUnloadTroops(galaxy, self, fleet, colony, false)) {
            dispatched = true;
            out.push({ colony, action: 'troops' });
        } else if (!self.coloniesNeedingTroops.includes(colony)) {
            self.coloniesNeedingTroops.push(colony);
            out.push({ colony, action: 'queued' });
        }
    }
    return out;
}

registerScenarioEvent({
    id: 'smarterAI.huntPirates',
    event: 'huntPirates',
    flag: SMARTER_AI_FLAG,
    run: (galaxy, p) => {
        if (p.handled || !smarterAIOn(galaxy, SMARTER_AI_PIRATES_FLAG) || !isSmarterAIEmpire(galaxy, p.empire)) return;
        p.handled = true;
        smarterHuntPirates(galaxy, p.empire, p.roll);
    },
});

/** Pirate facilities are checked monthly (the stock check runs only in the huge block, and needs no known base). */
export const FACILITY_PERIOD_DAYS = 30;

registerScenarioPeriodic({
    id: 'smarterAI.pirateFacilities',
    flag: SMARTER_AI_PIRATES_FLAG,
    periodDays: FACILITY_PERIOD_DAYS,
    run: (galaxy) => {
        if (!smarterAIOn(galaxy, SMARTER_AI_PIRATES_FLAG)) return;
        for (const e of galaxy.empires) if (isSmarterAIEmpire(galaxy, e) && !e.reclusive) cleanUpPirateFacilities(galaxy, e);
    },
});
