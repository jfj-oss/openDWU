// Smarter AI add-on: the pre-warp opening (scenarios/smarter-ai, flag smarterAIOpening). Not a port.
//
// AI empires that start pre-warp (their own start tech level 0) play a fixed opening until their capital reaches
// smarterAIOpeningPopShare % (default 90) of its maximum population:
//   - taxes: every colony at 0% (after the stock review, taxesReviewed);
//   - state builds (dormantStateConstruction, in place of the stock directConstruction): one small space port at the
//     capital (the smallest port design — small, else medium, else large; queued in the capital's own yard, as stock
//     builds ports), then one construction ship (the capital's yard), then, once the port is complete, 2 explorers at
//     the port. Each step is queued once (retried while it cannot be afforded: the stock rule, price <= state money)
//     and nothing else is built by the state: no warships, colony ships, other bases or defensive bases;
//   - pirates: every known pirate faction without an agreement is asked for protection the stock "Request Pirate
//     Protection" way (the faction names CalculatePirateProtectionPricePerMonth; accepted when the first month is
//     affordable, Main.Part10.cs 5132 PIRATE_PROTECTIONACCEPTRESPONSE, through the AI's AcceptPirateProtection), most
//     threatening first (diplomacy.ts piratePressure), then cheapest; pirate offers are accepted
//     (pirateProtectionDesired) and the AI's own cancel (cashflow and desire, Empire.2.cs 2401) is skipped
//     (pirateProtectionKept). Debt is accepted;
//   - the state AI is dormant (stateAIDormant, tick/empireTick.ts): no military objectives, attacks, troop recruiting,
//     colonisation, invasions, espionage assignments, active diplomacy (situations, trade, pirate mission offers,
//     enemy help, disputed territory), wonders, facilities, defensive bases, research / monitoring station planning;
//     no war declarations (declareWarBlocked); the other Smarter AI strategy packages skip the empire
//     (isSmarterAIStrategist). Research, designs, ship missions (explorers explore; the construction ship repairs and
//     builds the stock strategic-resource mining stations), passive diplomacy (messages, proposals) and the whole
//     private sector run as stock. The research / monitoring station target lists are emptied each pass so the
//     construction ship builds no state stations.
// At the share the opening ends for good: every colony gets the highest rate (0-50%, whole percent, the stock clamp)
// whose approval (taxes.ts empireApprovalRating, the game's own formula) stays at or above smarterAIOpeningMinApproval
// (default 15); the stock tax review takes over from the next review, and growth taxes leave the capital alone
// (taxes.ts). In any other start nothing is stored and nothing runs.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import type { Design } from '../../design';
import { empireGovernmentAttributes } from '../../empire';
import { BuiltObject } from '../../builtObject';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { getText } from '../../diplomacyTick';
import {
    MAXIMUM_CONSTRUCTION_QUEUE_WAIT_TIME_YEARS,
    builtObjectsFindShortestConstructionWaitQueue,
    dlFindNewestCanBuild,
    habitatsFindShortestConstructionWaitQueue,
    newBuiltObjectShouldBeAutomated,
    placeGroupedOrders,
    procureConstructionComponentsAtBuiltObject,
    procureConstructionComponentsAtColony,
    queueOf,
    type PendingOrders,
} from '../../construction/empireConstruction';
import { REAL_SECONDS_IN_GALACTIC_YEAR } from '../../galaxyTime';
import { empireApprovalRating, netRound } from '../../taxes';
import { recalculateAnnualTaxRevenue } from '../../forceStructure';
import { PirateRelationType } from '../../pirateRelations';
import { acceptPirateProtection, calculatePirateProtectionPricePerMonth } from '../../pirates/pirateRelationsAI';
import { registerScenarioEvent, registerScenarioGameStart, registerScenarioQuery } from '../hooks';
import { scenarioParam, scenarioState } from '../state';
import {
    SMARTER_AI_FLAG,
    SMARTER_AI_OPENING_FLAG,
    SMARTER_AI_OPENING_MIN_APPROVAL_DEFAULT,
    SMARTER_AI_OPENING_MIN_APPROVAL_PARAM,
    SMARTER_AI_OPENING_POP_SHARE_DEFAULT,
    SMARTER_AI_OPENING_POP_SHARE_PARAM,
    SMARTER_AI_OPENING_STATE_KEY,
    isSmarterAIEmpire,
    smarterAIOn,
    smarterAIOpeningHolds,
    smarterOpeningRecord,
    type SmarterOpeningState,
} from './common';
import { colonyFullness } from './taxes';
import { piratePressure } from './diplomacy';

/** Explorers in the build order. */
export const OPENING_EXPLORERS = 2;

export function openingState(galaxy: Galaxy): SmarterOpeningState {
    return scenarioState<SmarterOpeningState>(galaxy, SMARTER_AI_OPENING_STATE_KEY, () => ({ empires: {} }));
}

/** A pre-warp start for one empire: its own start tech level 0 (a "(Random)" level resolves to 0 in a pre-warp galaxy). */
export function isPreWarpStart(techLevel: number | undefined, galaxyAge: number): boolean {
    if (techLevel === undefined) return false;
    return techLevel === 0 || (techLevel < 0 && galaxyAge === 0);
}

/** The smallest space port design the empire can build (small, else medium, else large; null: none). */
export function smallestSpacePortDesign(empire: Empire): Design | null {
    return (
        dlFindNewestCanBuild(empire.designs, BuiltObjectSubRole.SmallSpacePort) ??
        dlFindNewestCanBuild(empire.designs, BuiltObjectSubRole.MediumSpacePort) ??
        dlFindNewestCanBuild(empire.designs, BuiltObjectSubRole.LargeSpacePort)
    );
}

/** The empire's completed space port with a yard (null: none yet). */
export function completedSpacePort(empire: Empire): BuiltObject | null {
    for (const b of empire.spacePorts as BuiltObject[]) {
        if (b !== null && b.isShipYard && b.builtAt === null && b.unbuiltComponentCount <= 0 && !b.hasBeenDestroyed) return b;
    }
    return null;
}

/** The highest rate (0-0.5 in whole percent) at which `h`'s approval stays at or above `minApproval`; 0 when none does. */
export function maxRateForApproval(galaxy: Galaxy, h: Habitat, minApproval: number): number {
    const saved = h.taxRate;
    let best = 0;
    for (let pct = 50; pct >= 0; pct--) {
        h.taxRate = Math.fround(pct / 100);
        if (empireApprovalRating(galaxy, h) >= minApproval) {
            best = pct / 100;
            break;
        }
    }
    h.taxRate = saved;
    return netRound(best, 2);
}

function setRate(galaxy: Galaxy, h: Habitat, rate: number): void {
    h.taxRate = Math.fround(rate);
    recalculateAnnualTaxRevenue(galaxy, h);
}

/** The opening's taxes after the stock review: 0% everywhere, or — at the share — the hand-over rates and the end. */
export function openingTaxes(galaxy: Galaxy, empire: Empire): void {
    const r = smarterOpeningRecord(galaxy, empire);
    if (r === undefined || r.ended) return;
    const gov = empireGovernmentAttributes(empire);
    const nationalised = gov !== null && gov.specialFunctionCode === 1;
    const share = scenarioParam(galaxy, SMARTER_AI_OPENING_POP_SHARE_PARAM, SMARTER_AI_OPENING_POP_SHARE_DEFAULT) / 100;
    const cap = empire.capital;
    if (cap !== null && cap.empire === empire && cap.maxPopulation > 0 && colonyFullness(cap) >= share) {
        const minApproval = scenarioParam(galaxy, SMARTER_AI_OPENING_MIN_APPROVAL_PARAM, SMARTER_AI_OPENING_MIN_APPROVAL_DEFAULT);
        if (!nationalised) for (const h of empire.colonies) if (h !== null && h.empire === empire) setRate(galaxy, h, maxRateForApproval(galaxy, h, minApproval));
        r.ended = true;
        r.endedAtShare = true;
        return;
    }
    if (nationalised) return;
    for (const h of empire.colonies) if (h !== null && h.empire === empire && h.taxRate !== 0) setRate(galaxy, h, 0);
}

/** Queues `design` in the capital's own yard (a space port: placed in orbit as the stock DirectConstruction does). */
function queueAtColony(galaxy: Galaxy, empire: Empire, design: Design, colony: Habitat, pending: PendingOrders<Habitat>, isPort: boolean): boolean {
    const price = design.calculateCurrentPurchasePrice(galaxy);
    if (!(price <= empire.stateMoney)) return false;
    const queue = queueOf(colony);
    if (queue === null) return false;
    design.buildCount++;
    const bo = new BuiltObject(design, isPort ? colony.name + ' ' + getText('Space Port') : galaxy.generateBuiltObjectName(design, colony), galaxy);
    bo.purchasePrice = price;
    if (!queue.addBuiltObjectToConstruct(bo)) {
        design.buildCount--;
        return false;
    }
    if (isPort) {
        // Empire.6.cs 2476-2585 (empireConstruction.ts directConstruction, new space ports).
        bo.parentHabitat = colony;
        const p = galaxy.selectRelativePoint(Math.trunc(colony.diameter / 6) + 15.0);
        bo.parentOffsetX = p.x;
        bo.parentOffsetY = p.y;
        bo.heading = galaxy.selectRandomHeading();
        bo.targetHeading = bo.heading;
        bo.nearestSystemStar = galaxy.determineHabitatSystemStar(colony);
        empire.addBuiltObjectToGalaxy(bo, colony, false, true);
    } else {
        empire.addBuiltObjectToGalaxy(bo, colony, false, true);
        bo.isAutoControlled = newBuiltObjectShouldBeAutomated(empire, bo.subRole);
    }
    bo.builtAt = colony;
    empire.stateMoney -= price;
    pending.cargo.push(procureConstructionComponentsAtColony(galaxy, empire, bo, colony));
    pending.locations.push(colony);
    return true;
}

/** Queues `design` at the space port `port` (the stock force-structure ship path). */
function queueAtPort(galaxy: Galaxy, empire: Empire, design: Design, port: BuiltObject, pending: PendingOrders<BuiltObject>): boolean {
    const price = design.calculateCurrentPurchasePrice(galaxy);
    if (!(price <= empire.stateMoney)) return false;
    design.buildCount++;
    const bo = new BuiltObject(design, galaxy.generateBuiltObjectName(design), galaxy);
    bo.purchasePrice = price;
    const r = builtObjectsFindShortestConstructionWaitQueue([port], bo);
    const queue = r.builtObject !== null ? queueOf(r.builtObject) : null;
    if (r.builtObject === null || queue === null || r.shortestWaitQueueTime / REAL_SECONDS_IN_GALACTIC_YEAR >= MAXIMUM_CONSTRUCTION_QUEUE_WAIT_TIME_YEARS || !queue.addBuiltObjectToConstruct(bo)) {
        design.buildCount--;
        return false;
    }
    if (port.parentHabitat !== null) bo.name = galaxy.generateBuiltObjectName(design, port.parentHabitat);
    empire.addBuiltObjectToGalaxy(bo, port, false, true);
    bo.builtAt = port;
    bo.isAutoControlled = newBuiltObjectShouldBeAutomated(empire, bo.subRole);
    empire.stateMoney -= price;
    pending.cargo.push(procureConstructionComponentsAtBuiltObject(galaxy, empire, bo, port, true));
    pending.locations.push(port);
    return true;
}

/** The opening's state build order (one pass; see the file comment). Returns the items queued this pass. */
export function openingConstruction(galaxy: Galaxy, empire: Empire): string[] {
    const r = smarterOpeningRecord(galaxy, empire);
    const out: string[] = [];
    if (r === undefined || r.ended) return out;
    const cap = empire.capital;
    if (cap === null || cap.empire !== empire) return out;
    const colonies: PendingOrders<Habitat> = { locations: [], cargo: [] };
    const bases: PendingOrders<BuiltObject> = { locations: [], cargo: [] };
    const has = (k: string): number => r.queued.filter((x) => x === k).length;
    // 1. The space port (skipped when the empire has no port design: the construction ship comes first).
    const portDesign = smallestSpacePortDesign(empire);
    if (has('port') === 0 && portDesign !== null && queueAtColony(galaxy, empire, portDesign, cap, colonies, true)) {
        r.queued.push('port');
        out.push('port');
    }
    // 2. The construction ship, after the port.
    if (has('construction') === 0 && (has('port') > 0 || portDesign === null)) {
        const design = dlFindNewestCanBuild(empire.designs, BuiltObjectSubRole.ConstructionShip);
        if (design !== null) {
            const probe = new BuiltObject(design, '', galaxy);
            const yard = habitatsFindShortestConstructionWaitQueue(galaxy, [cap], probe).habitat;
            if (yard !== null && queueAtColony(galaxy, empire, design, yard, colonies, false)) {
                r.queued.push('construction');
                out.push('construction');
            }
        }
    }
    // 3. The explorers, once the port is complete.
    const port = completedSpacePort(empire);
    if (has('construction') > 0 && port !== null) {
        const design = dlFindNewestCanBuild(empire.designs, BuiltObjectSubRole.ExplorationShip);
        while (design !== null && has('explorer') < OPENING_EXPLORERS && queueAtPort(galaxy, empire, design, port, bases)) {
            r.queued.push('explorer');
            out.push('explorer');
        }
    }
    placeGroupedOrders(galaxy, empire, bases);
    placeGroupedOrders(galaxy, empire, colonies);
    // No state stations: the construction ship's research / monitoring targets stay empty.
    empire.researchHabitats.length = 0;
    empire.monitoringHabitats.length = 0;
    empire.monitoringPoints.length = 0;
    return out;
}

/** The known pirate factions without an agreement, most threatening first, then cheapest. */
export function protectionCandidates(galaxy: Galaxy, empire: Empire): { pirate: Empire; price: number }[] {
    const list: { pirate: Empire; price: number; pressure: number }[] = [];
    for (let i = 0; i < empire.pirateRelations.count; i++) {
        const rel = empire.pirateRelations.get(i);
        const p = rel?.otherEmpire ?? null;
        if (rel == null || p === null || rel.type !== PirateRelationType.None || !p.active || p.pirateEmpireBaseHabitat === null || p.pirateEmpireSuperPirates) continue;
        list.push({ pirate: p, price: calculatePirateProtectionPricePerMonth(galaxy, p, empire).price, pressure: piratePressure(galaxy, empire, p) });
    }
    list.sort((a, b) => b.pressure - a.pressure || a.price - b.price || a.pirate.empireId - b.pirate.empireId);
    return list.map(({ pirate, price }) => ({ pirate, price }));
}

/** Asks every known pirate faction for protection (see the file comment). Returns the factions now protecting. */
export function requestOpeningProtection(galaxy: Galaxy, empire: Empire): Empire[] {
    const out: Empire[] = [];
    for (const { pirate, price } of protectionCandidates(galaxy, empire)) {
        if (price !== 0 && empire.stateMoney < price) continue; // INFO_NOFUNDS: the first month is paid up front
        acceptPirateProtection(galaxy, empire, pirate, price);
        out.push(pirate);
    }
    return out;
}

registerScenarioGameStart({
    id: 'smarterAI.opening',
    order: 10,
    flag: SMARTER_AI_FLAG,
    run: (galaxy, ctx) => {
        if (!smarterAIOn(galaxy, SMARTER_AI_OPENING_FLAG)) return;
        for (const e of galaxy.empires) {
            if (!isSmarterAIEmpire(galaxy, e)) continue;
            const tech = ctx.empireTechLevels?.get(e) ?? ctx.startTechLevel;
            if (!isPreWarpStart(tech, galaxy.age)) continue;
            openingState(galaxy).empires[String(e.empireId)] = { queued: [], ended: false, endedAtShare: false };
        }
    },
});

registerScenarioQuery({
    id: 'smarterAI.opening.dormant',
    query: 'stateAIDormant',
    flag: SMARTER_AI_FLAG,
    run: (galaxy, value, { empire }) => value || smarterAIOpeningHolds(galaxy, empire),
});

registerScenarioEvent({
    id: 'smarterAI.opening.build',
    event: 'dormantStateConstruction',
    flag: SMARTER_AI_FLAG,
    run: (galaxy, { empire }) => {
        if (!smarterAIOpeningHolds(galaxy, empire)) return;
        openingConstruction(galaxy, empire);
        requestOpeningProtection(galaxy, empire);
    },
});

registerScenarioEvent({
    id: 'smarterAI.opening.taxes',
    event: 'taxesReviewed',
    order: 10,
    flag: SMARTER_AI_FLAG,
    run: (galaxy, { empire }) => {
        if (smarterAIOpeningHolds(galaxy, empire)) openingTaxes(galaxy, empire);
    },
});

registerScenarioQuery({
    id: 'smarterAI.opening.protectionDesired',
    query: 'pirateProtectionDesired',
    order: 10,
    flag: SMARTER_AI_FLAG,
    run: (galaxy, value, { empire }) => value || smarterAIOpeningHolds(galaxy, empire),
});

registerScenarioQuery({
    id: 'smarterAI.opening.protectionKept',
    query: 'pirateProtectionKept',
    flag: SMARTER_AI_FLAG,
    run: (galaxy, value, { empire }) => value || smarterAIOpeningHolds(galaxy, empire),
});

registerScenarioQuery({
    id: 'smarterAI.opening.noWar',
    query: 'declareWarBlocked',
    flag: SMARTER_AI_FLAG,
    run: (galaxy, value, { empire }) => value || smarterAIOpeningHolds(galaxy, empire),
});
