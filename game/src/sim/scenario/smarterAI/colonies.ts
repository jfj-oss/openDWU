// Smarter AI add-on, part 5: smarter colony picks (scenarios/smarter-ai, flag smarterAIColonies). Not a port.
//
// Two hooks, AI empires only:
//   - `colonizationTargetValue` (civilianAI.ts identifyColonizationTargetsFull, Empire.4.cs 4662, the
//     DetermineColonizationValue read; the colonisation list only, filterOutDangerousTargets = true): the stock value
//     (quality, ruins, resources at market prices, policy habitat priorities, distance to the nearest major colony) is
//     multiplied by
//       * a shortage bonus: +SHORTAGE_BONUS for each known resource on the target the empire is short of (among the
//         SHORTAGE_TOP most deficient of IdentifyDeficientEmpireResources, demand / supply ratio at least
//         SHORTAGE_RATIO), up to SHORTAGE_BONUS_MAX;
//       * a danger penalty: the empire's known pirate bases (Empire.KnownPirateBases) within PIRATE_DANGER_RANGE and
//         the fleets of empires it is at war with (or pirate fleets) in systems it can see within FLEET_DANGER_RANGE
//         scale the value down (nearer = lower), never below DANGER_FLOOR.
//   - `colonyShipBuildCap` (construction/empireConstruction.ts directConstruction, Empire.6.cs 2630): when the stock
//     freighter / military gate keeps colonisation closed, an expanding empire with cash above
//     CASH_UPKEEP_YEARS years of upkeep, a good target (priority >= GOOD_TARGET_PRIORITY, unassigned, one the stock
//     CheckShouldAttemptColonization accepts) and no colony ship already in hand or on order still orders one.
// Both are pure (no Rnd, no state written).

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { identifyDeficientEmpireResources } from '../../industry';
import { annualTroopMaintenance } from '../../forceStructure';
import { annualStateMaintenanceExcludingUnderConstruction, determineEmpiresAtWarWith } from '../../treasury';
import { empireShipGroups } from '../../fleets/shipGroup';
import { checkShouldAttemptColonization } from '../../construction/empireConstruction';
import { registerScenarioQuery } from '../hooks';
import { SMARTER_AI_FLAG, isSmarterAIStrategist, smarterAIOn } from './common';

export const SMARTER_AI_COLONIES_FLAG = 'smarterAIColonies';

/** A resource counts as short when its outstanding demand is at least this multiple of the supply on hand ... */
export const SHORTAGE_RATIO = 1;
/** ... and it is among the empire's most deficient (the stock PrioritizeEmpireResourceNeeds topResourceCount, 5). */
export const SHORTAGE_TOP = 5;
/** Value bonus per short resource on the target, and the most the shortages can add. */
export const SHORTAGE_BONUS = 0.75;
export const SHORTAGE_BONUS_MAX = 2;
/** Known pirate bases this close lower the value (galaxy units; a system is about 23000 across). */
export const PIRATE_DANGER_RANGE = 400_000;
/** Hostile fleets this close (in systems the empire can see) lower the value. */
export const FLEET_DANGER_RANGE = 200_000;
/** The lowest the danger factor goes. */
export const DANGER_FLOOR = 0.2;
/** Colony ships keep flowing while the cash covers this many years of upkeep. */
export const CASH_UPKEEP_YEARS = 3;
/** A target worth a colony ship past the gate (the stock threshold is 5; real targets are in the thousands). */
export const GOOD_TARGET_PRIORITY = 500;

export interface Point2 {
    x: number;
    y: number;
}

/** What the scoring needs from the empire, gathered once per review. */
export interface ColonyPickContext {
    /** resourceId → demand / supply ratio, for the short resources only. */
    shortages: Map<number, number>;
    pirateBases: Point2[];
    hostileFleets: Point2[];
}

/** The empire's short resources (Empire.3.cs IdentifyDeficientEmpireResources, luxuries included). */
export function empireShortages(galaxy: Galaxy, empire: Empire): Map<number, number> {
    const out = new Map<number, number>();
    for (const r of identifyDeficientEmpireResources(galaxy, empire, true, 0)) {
        if (out.size >= SHORTAGE_TOP || r.sortTag < SHORTAGE_RATIO) break; // sorted most deficient first
        out.set(r.resourceId, r.sortTag);
    }
    return out;
}

export function colonyPickContext(galaxy: Galaxy, empire: Empire): ColonyPickContext {
    const pirateBases: Point2[] = [];
    for (const b of empire.knownPirateBases) if (b !== null && !b.hasBeenDestroyed) pirateBases.push({ x: b.xpos, y: b.ypos });
    const hostile: Empire[] = determineEmpiresAtWarWith(galaxy, empire).empires.slice();
    for (const p of galaxy.pirateEmpires) if (p !== empire && !hostile.includes(p)) hostile.push(p);
    const hostileFleets: Point2[] = [];
    for (const e of hostile) {
        for (const g of empireShipGroups(e)) {
            const lead = g?.leadShip ?? null;
            if (lead === null || lead.hasBeenDestroyed) continue;
            const star = lead.nearestSystemStar;
            if (star === null || star.systemIndex < 0 || !empire.visibility.checkSystemVisible(star.systemIndex)) continue;
            hostileFleets.push({ x: lead.xpos, y: lead.ypos });
        }
    }
    return { shortages: empireShortages(galaxy, empire), pirateBases, hostileFleets };
}

/** The shortage bonus (1 = none) for `habitat`'s known resources. */
export function shortageFactor(empire: Empire, habitat: Habitat, shortages: ReadonlyMap<number, number>): number {
    if (shortages.size === 0 || habitat.resources == null || empire.resourceMap == null || !empire.resourceMap.checkResourcesKnown(habitat)) return 1;
    let bonus = 0;
    for (const r of habitat.resources) if (r != null && shortages.has(r.resourceId)) bonus += SHORTAGE_BONUS;
    return 1 + Math.min(SHORTAGE_BONUS_MAX, bonus);
}

/** The danger factor (1 = safe, down to DANGER_FLOOR) for a target at (x, y). */
export function dangerFactor(galaxy: Galaxy, x: number, y: number, ctx: Pick<ColonyPickContext, 'pirateBases' | 'hostileFleets'>): number {
    let f = 1;
    for (const b of ctx.pirateBases) {
        const d = galaxy.calculateDistance(x, y, b.x, b.y);
        if (d < PIRATE_DANGER_RANGE) f *= 0.3 + 0.7 * (d / PIRATE_DANGER_RANGE);
    }
    for (const p of ctx.hostileFleets) {
        const d = galaxy.calculateDistance(x, y, p.x, p.y);
        if (d < FLEET_DANGER_RANGE) f *= 0.5 + 0.5 * (d / FLEET_DANGER_RANGE);
    }
    return Math.max(DANGER_FLOOR, f);
}

/** The adjusted colonisation value (stock value × shortage bonus × danger factor). */
export function smarterColonyValue(galaxy: Galaxy, empire: Empire, habitat: Habitat, value: number, ctx: ColonyPickContext): number {
    if (!(value > 0)) return value;
    return Math.trunc(value * shortageFactor(empire, habitat, ctx.shortages) * dangerFactor(galaxy, habitat.xpos, habitat.ypos, ctx));
}

// One context per empire per review: identifyColonizationTargetsFull asks for every candidate in one call. Keyed by the
// galaxy time, so a later review rebuilds it; nothing here is saved or changes the game.
const contextCache = new WeakMap<Empire, { at: number; galaxy: Galaxy; ctx: ColonyPickContext }>();
function cachedContext(galaxy: Galaxy, empire: Empire): ColonyPickContext {
    const c = contextCache.get(empire);
    if (c !== undefined && c.at === galaxy.nowMs && c.galaxy === galaxy) return c.ctx;
    const ctx = colonyPickContext(galaxy, empire);
    contextCache.set(empire, { at: galaxy.nowMs, galaxy, ctx });
    return ctx;
}

/** The empire's upkeep a year (state ships and bases, troops), as the growth taxes read it. */
export function annualUpkeep(empire: Empire): number {
    return Math.max(0, annualStateMaintenanceExcludingUnderConstruction(empire) + annualTroopMaintenance(empire));
}

/** Past the stock gate: one colony ship when the treasury and the targets allow it (see the file comment). */
export function extraColonyShipAllowed(galaxy: Galaxy, empire: Empire): boolean {
    if (empire.dominantRace === null || !empire.dominantRace.expanding) return false;
    if (!(empire.stateMoney > CASH_UPKEEP_YEARS * annualUpkeep(empire))) return false;
    for (const b of empire.builtObjects) if (b !== null && b.subRole === BuiltObjectSubRole.ColonyShip) return false;
    for (const t of empire.colonizationTargets) {
        if (t.priority < GOOD_TARGET_PRIORITY || (t.assignedShip ?? null) !== null) continue;
        const h = t.habitat;
        if (h.empire !== null && h.empire !== galaxy.independentEmpire) continue;
        if (checkShouldAttemptColonization(galaxy, empire, h)) return true;
    }
    return false;
}

registerScenarioQuery({
    id: 'smarterAI.colonyValue',
    query: 'colonizationTargetValue',
    flag: SMARTER_AI_FLAG,
    run: (galaxy, value, { empire, habitat, filterOutDangerousTargets }) => {
        if (!filterOutDangerousTargets || !smarterAIOn(galaxy, SMARTER_AI_COLONIES_FLAG) || !isSmarterAIStrategist(galaxy, empire)) return value;
        return smarterColonyValue(galaxy, empire, habitat, value, cachedContext(galaxy, empire));
    },
});

registerScenarioQuery({
    id: 'smarterAI.colonyShipCap',
    query: 'colonyShipBuildCap',
    flag: SMARTER_AI_FLAG,
    run: (galaxy, value, { empire }) => {
        if (value > 0 || !smarterAIOn(galaxy, SMARTER_AI_COLONIES_FLAG) || !isSmarterAIStrategist(galaxy, empire)) return value;
        return extraColonyShipAllowed(galaxy, empire) ? 1 : value;
    },
});
