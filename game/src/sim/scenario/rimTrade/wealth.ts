// Scenario package 19a — the Concord's wealth and navy (flag rimTrader; each part off at its neutral param value).
// Not a port: every stock call it makes is ported code.
//   Start money: rimTraderStartMoney (0 = the stock treasury) replaces the Concord's state treasury at game start,
//     after the stock start-up equipping (so the set-up does not spend it).
//   Start warships: rimTraderStartWarships warships of its newest designs in a spread (NAVY_SPREAD: 40 % frigates /
//     escorts, 35 % destroyers, 25 % cruisers / capital ships as its tech allows), spawned at its colonies the way the
//     game's starting ships are (Galaxy.8.cs CreateStateShips → the starting-ship loop, builtObjectPlacement.ts), paid
//     from its treasury at the design's purchase price (Design.CalculateCurrentPurchasePrice), and grouped into one
//     home-defence fleet (posture Defend) per colonised system (Empire.8.cs 2673 new fleets: ShipGroup + AddShipToFleet).
//   Trade house income: rimTraderTradeHouseIncome credits per year to the treasury ("trade house profits", a message
//     to the Concord, so the event log keeps it; the finance screen has no scenario line).
//   Rare price factor: rimTraderRarePriceMult scales what buyers pay for its rare goods (the contract listener in
//     rimTrader.ts and the treasure fleet's sales in treasureFleet.ts).
//   Navy target: each year, while the treasury exceeds rimTraderNavyReserve, the Concord orders warships of the same
//     spread at its shipyards (Empire.6.cs 2098 PurchaseNewBuiltObject: queued, the yard's capacity respected) until it
//     holds rimTraderNavyTarget warships. Strike fleets (passive.ts) and the treasure escorts (treasureFleet.ts) draw
//     from this navy, the home guard kept.
// Rnd: the game-start spawn (GenerateBuiltObjectName, SelectRelativeParkingPoint, SelectRandomHeading) and the yearly
// purchases (PurchaseNewBuiltObject's naming) draw; nothing draws at the neutral values.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Design } from '../../design';
import type { Habitat } from '../../types';
import { BuiltObject } from '../../builtObject';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { designsFindNewestCanBuild } from '../../forceStructure';
import { purchaseNewBuiltObject } from '../../construction/empireConstruction';
import { ShipGroup } from '../../fleets/shipGroup';
import { compareShipGroups, getNextFleetNumberDescription, shipGroupAddShipToFleet, shipGroupUpdate } from '../../fleets/shipGroupTasks';
import { netSort } from '../../netSort';
import { FleetPosture } from '../../diplomacyTick';
import { EmpireMessageType } from '../../messages';
import { registerScenarioYearly } from '../hooks';
import { scenarioState } from '../state';
import { scenarioMessage, scenarioText } from '../messages';
import { isRimTraderAI, rimParam, rimTraderEmpire } from './common';

/** The warship spread: sub-role groups (preferred first) and their shares. */
export const NAVY_SPREAD: { roles: BuiltObjectSubRole[]; share: number }[] = [
    { roles: [BuiltObjectSubRole.Frigate, BuiltObjectSubRole.Escort], share: 0.4 },
    { roles: [BuiltObjectSubRole.Destroyer], share: 0.35 },
    { roles: [BuiltObjectSubRole.CapitalShip, BuiltObjectSubRole.Cruiser], share: 0.25 },
];

/** Saved state (`scenarioState(galaxy, 'rimNavy')`): plain data. */
export interface RimNavyState {
    startWarships: number;
    startCost: number;
    bought: number;
    spent: number;
    income: number;
}

export function rimNavyState(galaxy: Galaxy): RimNavyState {
    return scenarioState<RimNavyState>(galaxy, 'rimNavy', () => ({ startWarships: 0, startCost: 0, bought: 0, spent: 0, income: 0 }));
}

/** Counts per spread group for `n` ships: 40 / 35 / the rest. Pure. */
export function navyPlan(n: number): number[] {
    const a = Math.round(n * NAVY_SPREAD[0].share);
    const b = Math.round(n * NAVY_SPREAD[1].share);
    return [a, b, Math.max(0, n - a - b)];
}

/** The spread group of a sub-role (-1: not a warship of the spread). Pure. */
export function navyGroupOf(subRole: BuiltObjectSubRole): number {
    return NAVY_SPREAD.findIndex((g) => g.roles.includes(subRole));
}

/**
 * The newest design the Concord can build for spread group `group` (its sub-roles in order; `k` alternates between
 * those it has — cruisers and capital ships), falling back to the next lighter group when it has none. Pure.
 */
export function navyDesign(r: Empire, group: number, k = 0): Design | null {
    for (let g = group; g >= 0; g--) {
        const have = NAVY_SPREAD[g].roles.map((s) => designsFindNewestCanBuild(r.designs, s)).filter((d): d is Design => d !== null);
        if (have.length > 0) return have[k % have.length];
    }
    return null;
}

/** The Concord's warships (role Military, not destroyed; under construction included). Pure. */
export function concordWarships(r: Empire): BuiltObject[] {
    return r.builtObjects.filter((b) => b !== null && !b.hasBeenDestroyed && b.role === BuiltObjectRole.Military);
}

/** Starting-ship spawn at `colony` (the builtObjectPlacement.ts createStartingShip body, the colony chosen), paid. */
function spawnWarship(galaxy: Galaxy, r: Empire, design: Design, colony: Habitat): BuiltObject {
    const price = design.calculateCurrentPurchasePrice(galaxy);
    design.buildCount++;
    const bo = new BuiltObject(design, galaxy.generateBuiltObjectName(design), galaxy, true);
    bo.purchasePrice = price;
    bo.reDefine();
    bo.currentFuel = bo.fuelCapacity;
    bo.currentShields = bo.shieldsCapacity;
    bo.heading = galaxy.selectRandomHeading();
    bo.targetHeading = bo.heading;
    const p = galaxy.selectRelativeParkingPoint();
    bo.name = galaxy.generateBuiltObjectName(design, colony);
    bo.nearestSystemStar = galaxy.determineHabitatSystemStar(colony);
    r.addBuiltObjectToGalaxy(bo, colony, false, true, Math.trunc(p.x), Math.trunc(p.y));
    r.stateMoney -= price;
    return bo;
}

/** One home-defence fleet of `ships` at `colony` (Empire.8.cs 2673-2700: a new ShipGroup, ships added, posture Defend). */
function formHomeFleet(galaxy: Galaxy, r: Empire, ships: BuiltObject[], colony: Habitat): ShipGroup | null {
    if (ships.length === 0) return null;
    const sg = new ShipGroup(galaxy);
    sg.empire = r;
    sg.shipTargetAmount = ships.length;
    sg.troopTargetStrength = 0;
    sg.gatherPoint = colony;
    sg.posture = FleetPosture.Defend;
    for (const b of ships) shipGroupAddShipToFleet(galaxy, sg, b);
    shipGroupUpdate(galaxy, sg);
    sg.name = `${getNextFleetNumberDescription(r)} Fleet`;
    const groups = r.shipGroups as ShipGroup[];
    groups.push(sg);
    netSort(groups, compareShipGroups);
    return sg;
}

/**
 * Game start (end of rimTrade.start, AI Concord only): the start money, then the start warships (paid from it) grouped
 * into a home-defence fleet per colonised system. Returns the warships bought. Exported for tests.
 */
export function concordWealthStart(galaxy: Galaxy, r: Empire): BuiltObject[] {
    if (!isRimTraderAI(galaxy, r)) return [];
    const money = rimParam(galaxy, 'rimTraderStartMoney');
    const n = Math.trunc(rimParam(galaxy, 'rimTraderStartWarships'));
    if (money > 0) r.stateMoney = money;
    if (n <= 0 || r.colonies.length === 0) return [];
    // One colony per system (the most populous), in colony order: the ships go round them.
    const homes: Habitat[] = [];
    for (const c of r.colonies) {
        const i = homes.findIndex((h) => h.systemIndex === c.systemIndex);
        if (i < 0) homes.push(c);
        else if (c.population.totalAmount > homes[i].population.totalAmount) homes[i] = c;
    }
    const plan = navyPlan(n);
    const bought: BuiltObject[] = [];
    const bySystem = new Map<Habitat, BuiltObject[]>();
    let cost = 0;
    let k = 0;
    outer: for (let g = 0; g < plan.length; g++) {
        for (let j = 0; j < plan[g]; j++) {
            const d = navyDesign(r, g, j);
            if (d === null) break;
            const price = d.calculateCurrentPurchasePrice(galaxy);
            if (price > r.stateMoney) break outer;
            const home = homes[k++ % homes.length];
            const b = spawnWarship(galaxy, r, d, home);
            cost += price;
            bought.push(b);
            if (!bySystem.has(home)) bySystem.set(home, []);
            bySystem.get(home)!.push(b);
        }
    }
    for (const home of homes) formHomeFleet(galaxy, r, bySystem.get(home) ?? [], home);
    const st = rimNavyState(galaxy);
    st.startWarships = bought.length;
    st.startCost = cost;
    return bought;
}

/** Yearly: the trade house profits. No Rnd. Exported for tests. */
export function concordTradeHouseYear(galaxy: Galaxy): number {
    const r = rimTraderEmpire(galaxy);
    const income = rimParam(galaxy, 'rimTraderTradeHouseIncome');
    if (r === null || !isRimTraderAI(galaxy, r) || !(income > 0)) return 0;
    r.stateMoney += income;
    rimNavyState(galaxy).income += income;
    scenarioMessage(galaxy, r, scenarioText('Scenario RimTrade Trade House Title'), scenarioText('Scenario RimTrade Trade House', r.name, String(Math.round(income))), { type: EmpireMessageType.GeneralGoodEvent, sender: r, subject: r.capital });
    return income;
}

/**
 * Yearly: while the treasury stays above rimTraderNavyReserve and the navy is under rimTraderNavyTarget, order the
 * spread's most-lacking group at the shipyards in turn (PurchaseNewBuiltObject queues it; a full yard refuses).
 * Returns the ships ordered. Exported for tests.
 */
export function concordNavyYear(galaxy: Galaxy): number {
    const r = rimTraderEmpire(galaxy);
    const target = Math.trunc(rimParam(galaxy, 'rimTraderNavyTarget'));
    if (r === null || !isRimTraderAI(galaxy, r) || target <= 0) return 0;
    const reserve = rimParam(galaxy, 'rimTraderNavyReserve');
    const yards = r.spacePorts.filter((p) => !p.hasBeenDestroyed && p.isShipYard);
    if (yards.length === 0) return 0;
    const ships = concordWarships(r);
    const have = [0, 0, 0];
    for (const b of ships) {
        const g = navyGroupOf(b.subRole);
        if (g >= 0) have[g]++;
    }
    let count = ships.length;
    let ordered = 0;
    let y = 0;
    const st = rimNavyState(galaxy);
    const refused = new Set<BuiltObject>();
    while (count < target && refused.size < yards.length) {
        const want = navyPlan(count + 1);
        let g = 0;
        for (let i = 1; i < 3; i++) if (want[i] - have[i] > want[g] - have[g]) g = i;
        const d = navyDesign(r, g, have[g]);
        if (d === null) break;
        const price = d.calculateCurrentPurchasePrice(galaxy);
        if (r.stateMoney - price < reserve) break;
        const yard = yards[y++ % yards.length];
        if (refused.has(yard)) continue;
        const bo = purchaseNewBuiltObject(galaxy, r, d, yard, true, true);
        if (bo === null) {
            refused.add(yard);
            continue;
        }
        have[g]++;
        count++;
        ordered++;
        st.bought++;
        st.spent += price;
    }
    return ordered;
}

registerScenarioYearly({
    id: 'rimTrade.wealth.year',
    flag: 'rimTrader',
    order: 13,
    run: (g) => {
        concordTradeHouseYear(g);
        concordNavyYear(g);
    },
});
