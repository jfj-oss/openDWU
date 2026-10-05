// Smarter AI add-on, part 4: keep fleets up to date (scenarios/smarter-ai, flag smarterAIRetrofit). Not a port.
//
// The stock AI retrofits its state fleets only every RETROFIT_YEARS and never while at war (Empire.6.cs 3466 DoRetrofit).
// Every REVIEW_DAYS game days, per AI empire that is not in debt (budget.ts reviewEconomy, the growth-tax test):
//   - candidates are the state warships (escort .. carrier) whose retrofit design (planRetrofit, the stock
//     FindNewestCanBuildFullEvaluate + line choice) differs from their own, that are AI-controlled, allow auto retrofit,
//     are idle or on a low-priority mission (their fleet's mission for fleet members) and are not in the system of a
//     threat (checkSafeToBuildAtLocation on their system star): not needed at the front;
//   - a fleet is one unit (assignFleetRetrofit), a loose ship another (assignRetrofitMission);
//   - worst first: the oldest own design, then the largest component gap to the retrofit design;
//   - at most MAX_RETROFITS_IN_FLIGHT units retrofit at once, and the costs must leave RESERVE_YEARS of upkeep in cash.
// The player, pirates and the independents are never touched. No Rnd.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { BuiltObject } from '../../builtObject';
import type { Design } from '../../design';
import type { ShipGroup } from '../../fleets/shipGroup';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission, type BuiltObjectMission } from '../../missions/mission';
import { isAiControlled } from '../../missions/playerOrder';
import { assignFleetRetrofit, assignRetrofitMission, checkSafeToBuildAtLocation } from '../../construction/empireConstruction';
import { planRetrofit } from '../../player/fleetOps';
import { galaxyStarDate } from '../../tick/simTime';
import { registerScenarioPeriodic } from '../hooks';
import { SMARTER_AI_FLAG, isSmarterAIStrategist, smarterAIOn } from './common';
import { reviewEconomy } from './budget';

export const SMARTER_AI_RETROFIT_FLAG = 'smarterAIRetrofit';
export const REVIEW_DAYS = 30;
export const MAX_RETROFITS_IN_FLIGHT = 3;
export const RESERVE_YEARS = 1;

const WARSHIP_SUB_ROLES: ReadonlySet<BuiltObjectSubRole> = new Set([
    BuiltObjectSubRole.Escort,
    BuiltObjectSubRole.Frigate,
    BuiltObjectSubRole.Destroyer,
    BuiltObjectSubRole.Cruiser,
    BuiltObjectSubRole.CapitalShip,
    BuiltObjectSubRole.Carrier,
]);

export interface RetrofitUnit {
    fleet: ShipGroup | null;
    /** The loose ship (null for a fleet). */
    ship: BuiltObject | null;
    design: Design | null;
    cost: number;
    /** The oldest own design's dateCreated among the obsolete ships. */
    designDate: number;
    /** The largest count of retrofit-design components the ship lacks. */
    componentGap: number;
}

/** Components of `to` missing from `from` (multiset by component id). */
export function componentGap(from: Design, to: Design): number {
    const have = new Map<number, number>();
    for (const c of from.components) if (c != null) have.set(c.componentId, (have.get(c.componentId) ?? 0) + 1);
    let gap = 0;
    for (const c of to.components) {
        if (c == null) continue;
        const n = have.get(c.componentId) ?? 0;
        if (n > 0) have.set(c.componentId, n - 1);
        else gap++;
    }
    return gap;
}

const idle = (m: BuiltObjectMission | null): boolean => m === null || m.type === BuiltObjectMissionType.Undefined || m.priority <= BuiltObjectMissionPriority.Low;
const retrofitting = (m: BuiltObjectMission | null): boolean => m !== null && m.type === BuiltObjectMissionType.Retrofit;

/** A state warship this package may consider (before the obsolescence check). */
function eligibleWarship(empire: Empire, bo: BuiltObject): boolean {
    return bo !== null && bo.empire === empire && WARSHIP_SUB_ROLES.has(bo.subRole) && bo.design !== null && !bo.hasBeenDestroyed && isAiControlled(bo) && !bo.suppressAutoRetrofit && bo.builtAt === null && bo.retrofitDesign === null && !bo.retireForNextMission && !bo.scrap;
}

function atFront(galaxy: Galaxy, empire: Empire, bo: BuiltObject): boolean {
    const star = bo.nearestSystemStar;
    return star !== null && !checkSafeToBuildAtLocation(galaxy, empire, star);
}

/** Units retrofitting now: loose warships on a retrofit, and fleets on one. */
export function retrofitsInFlight(empire: Empire): number {
    let n = 0;
    const fleets = new Set<ShipGroup>();
    for (const bo of empire.builtObjects as BuiltObject[]) {
        if (bo === null || !WARSHIP_SUB_ROLES.has(bo.subRole)) continue;
        const fleet = bo.shipGroup as ShipGroup | null;
        if (fleet !== null) {
            if (retrofitting(fleet.mission)) fleets.add(fleet);
            continue;
        }
        if (bo.retrofitDesign !== null || retrofitting(builtObjectMission(bo.mission))) n++;
    }
    return n + fleets.size;
}

/** The retrofit units of `empire`, worst first (see the file comment). */
export function retrofitCandidates(galaxy: Galaxy, empire: Empire): RetrofitUnit[] {
    const units: RetrofitUnit[] = [];
    const fleets = new Map<ShipGroup, RetrofitUnit>();
    const blockedFleets = new Set<ShipGroup>();
    for (const bo of empire.builtObjects as BuiltObject[]) {
        if (!eligibleWarship(empire, bo)) continue;
        const fleet = bo.shipGroup as ShipGroup | null;
        if (fleet !== null) {
            if (blockedFleets.has(fleet)) continue;
            if (!idle(fleet.mission) || (fleet.leadShip !== null && atFront(galaxy, empire, fleet.leadShip))) {
                blockedFleets.add(fleet);
                continue;
            }
        } else if (!idle(builtObjectMission(bo.mission)) || atFront(galaxy, empire, bo)) {
            continue;
        }
        const plan = planRetrofit(galaxy, empire, [bo])[0];
        if (plan === undefined || plan.design === null || (plan.skip !== null && plan.skip !== 'cannot afford')) continue;
        const gap = componentGap(bo.design!, plan.design);
        const date = bo.design!.dateCreated;
        if (fleet !== null) {
            const u = fleets.get(fleet);
            if (u === undefined) {
                const nu: RetrofitUnit = { fleet, ship: null, design: plan.design, cost: plan.cost, designDate: date, componentGap: gap };
                fleets.set(fleet, nu);
                units.push(nu);
            } else {
                u.cost += plan.cost;
                u.designDate = Math.min(u.designDate, date);
                u.componentGap = Math.max(u.componentGap, gap);
            }
        } else {
            units.push({ fleet: null, ship: bo, design: plan.design, cost: plan.cost, designDate: date, componentGap: gap });
        }
    }
    const idx = new Map(units.map((u, i) => [u, i]));
    units.sort((a, b) => a.designDate - b.designDate || b.componentGap - a.componentGap || idx.get(a)! - idx.get(b)!);
    return units;
}

/** One empire's retrofit review. Returns the units sent. */
export function reviewFleetRetrofits(galaxy: Galaxy, empire: Empire): RetrofitUnit[] {
    const sent: RetrofitUnit[] = [];
    const econ = reviewEconomy(galaxy, empire);
    if (econ.inDebt) return sent;
    let room = MAX_RETROFITS_IN_FLIGHT - retrofitsInFlight(empire);
    if (room <= 0) return sent;
    let budget = empire.stateMoney - RESERVE_YEARS * econ.upkeep;
    for (const u of retrofitCandidates(galaxy, empire)) {
        if (room <= 0) break;
        if (u.cost > budget) continue;
        let ok = false;
        if (u.fleet !== null) {
            ok = assignFleetRetrofit(galaxy, empire, u.fleet, null, true);
        } else if (u.ship !== null && assignRetrofitMission(galaxy, empire, u.ship, u.design)) {
            u.ship.dateRetrofit = galaxyStarDate(galaxy);
            ok = true;
        }
        if (!ok) continue;
        budget -= u.cost;
        room--;
        sent.push(u);
    }
    return sent;
}

registerScenarioPeriodic({
    id: 'smarterAI.retrofit',
    flag: SMARTER_AI_FLAG,
    periodDays: REVIEW_DAYS,
    run: (galaxy) => {
        if (!smarterAIOn(galaxy, SMARTER_AI_RETROFIT_FLAG)) return;
        for (const e of galaxy.empires) if (isSmarterAIStrategist(galaxy, e)) reviewFleetRetrofits(galaxy, e);
    },
});
