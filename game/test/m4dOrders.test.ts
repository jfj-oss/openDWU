// M4d — orders, contracts, freight assignment, colony consumption (tasks/M4-plan.md §3.3 M4d).
// Unit tests against hand-worked C# values, plus a harness smoke test.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame } from './helpers/tickGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import { Cargo, CargoList, ResourceRef } from '../src/sim/cargo';
import { runGameSeconds } from '../src/sim/tick/harness';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import {
    ComponentRef,
    Order,
    OrderList,
    OrderType,
    cancelExpiredOrders,
    cargoRemove,
    checkForUnownedCargoHabitat,
    empireCreateOrder,
    galaxyCreateOrder,
    processTradeBonuses,
    removeCompletedOrders,
} from '../src/sim/logistics/orders';
import { Contract, builtObjectContracts, cancelContract, initiateContractForOrder, performFinancialTransaction } from '../src/sim/logistics/contracts';
import {
    calculateResourceLevelHabitat,
    calculateResourceLevelSpaceport,
    calculateStrategicResourceConsumptionPerYear,
    consumeResources,
    maintainIndependentColonyFuelLevels,
} from '../src/sim/logistics/colonySupply';
import { currentRange, withinFuelRange } from '../src/sim/logistics/freight';
import { DiplomaticRelation, DiplomaticRelationType } from '../src/sim/diplomacy';
import { galaxyResourceCurrentPrices } from '../src/sim/design';
import { BuiltObjectMissionType, builtObjectMission } from '../src/sim/missions/mission';
import type { BuiltObject } from '../src/sim/builtObject';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

function newGalaxy(): Galaxy {
    return createTickGame(gameData).galaxy;
}

describe('Order / OrderList model (Order.cs, OrderList.cs)', () => {
    it('amounts derive from contracts; the indexed list serves per-colony / per-empire / per-base views', () => {
        const g = newGalaxy();
        const e = g.empires[0];
        const colony = e.colonies[0];
        const base = e.builtObjects.find((b) => b.role !== undefined)!;
        const o1 = new Order(g, colony, new ResourceRef(3), 1000, 5, 0);
        const o2 = new Order(g, base, new ResourceRef(4), 500, 5, 0);
        const o3 = new Order(g, colony, new ComponentRef(7), 20, 5, 0);
        expect(o3.commodityResource).toBeNull();
        expect(o3.commodityComponent!.componentId).toBe(7);
        const c = new Contract(null, 400, 3, -1, e.empireId);
        c.amountDelivered = 150;
        o1.contracts.push(c, null);
        expect(o1.amountToFulfill).toBe(400);
        expect(o1.amountDelivered).toBe(150);
        expect(o1.amountStillToArrive).toBe(250);
        expect(o1.amountOutstandingToContract).toBe(600);

        const list = new OrderList(true);
        list.add(o1);
        list.add(o2);
        list.add(o3);
        expect(list.getOrdersForHabitat(colony).items).toEqual([o1, o3]);
        expect(list.getOrdersForBuiltObject(base).items).toEqual([o2]);
        expect(list.getOrdersForEmpire(base.actualEmpire!).items).toContain(o2);
        expect(list.getOrdersForEmpire(e).items).toEqual(base.actualEmpire === e ? [o1, o2, o3] : [o1, o3]);
        expect(list.indexOfResourceId(3, 0)).toBe(0);
        expect(list.indexOfResourceId(3, 1)).toBe(-1);
        o2.type = OrderType.RetrofitResourcesForBase;
        const split = list.splitOrdersByType();
        expect(split.standardOrders.items).toEqual([o1, o3]);
        expect(split.retrofitResourcesForBaseOrders.items).toEqual([o2]);
        list.remove(o1);
        expect(list.getOrdersForHabitat(colony).items).toEqual([o3]);
        list.remove(o3);
        expect(list.getOrdersForHabitat(colony).count).toBe(0);
        // MergeRange skips orders already present.
        const m = new OrderList();
        m.add(o2);
        m.mergeRange(list);
        expect(m.items).toEqual([o2]);
    }, 120000);

    it('CreateOrder: Galaxy overload (Standard, never-expiring) and Empire overload (typed, luxury expiry)', () => {
        const g = newGalaxy();
        const e = g.empires[0];
        const colony = e.colonies[0];
        // M4z6: the game-start EvaluateColonyVariables now places colony orders; start from an empty order list.
        for (const x of [...g.orders.items]) g.orders.remove(x);
        const now = galaxyStarDate(g);
        const o = galaxyCreateOrder(g, colony, new ResourceRef(0), 800, false);
        // (int)(1000.0 * 600 * 1000.0)
        expect(o.expiryDate).toBe(now + 600000000);
        expect(o.type).toBe(OrderType.Standard);
        expect(o.minimumContractSize).toBe(300);
        const lux = g.resourceSystem.luxuryResources[0];
        const o2 = empireCreateOrder(g, e, colony, new ResourceRef(lux.resourceId), 100, true, OrderType.ConstructionShortage, true);
        // (long)(0.6 * 600 * 1000.0)
        expect(o2.expiryDate).toBe(now + 360000);
        expect(o2.isStateOrder).toBe(true);
        expect(g.orders.getOrdersForHabitat(colony).items).toEqual([o, o2]);
        // Galaxy long block cleanup: an expired order with nothing still to arrive is cancelled; a delivered one removed.
        o2.expiryDate = now - 1;
        cancelExpiredOrders(g, g.orders);
        expect(g.orders.items).toEqual([o]);
        const c = new Contract(null, 800, 0, -1, e.empireId);
        c.amountDelivered = 800;
        o.contracts.push(c);
        removeCompletedOrders(g.orders);
        expect(g.orders.count).toBe(0);
    }, 120000);
});

describe('cargo semantics', () => {
    it('CancelContract releases the unpicked reservation and drops an empty entry', () => {
        const g = newGalaxy();
        const e = g.empires[0];
        const colony = e.colonies[0];
        colony.cargo = new CargoList();
        const reserved = new Cargo(new ResourceRef(5), 100, e, 100);
        colony.cargo.add(reserved);
        const c = new Contract(colony, 100, 5, -1, e.empireId);
        c.amountPickedUp = 40;
        expect(cancelContract(g, c)).toBe(true);
        expect(reserved.reserved).toBe(40);
        expect(c.amountToFulfill).toBe(0);
        reserved.amount = 0;
        c.amountToFulfill = 80; // 80 − 40 picked up = 40 still reserved → 0
        cancelContract(g, c);
        expect(colony.cargo.items.length).toBe(0);
    }, 120000);

    it('CheckForUnownedCargo keeps the unowned entry (C# Remove is a no-op for EmpireId -1) and adds an owned copy', () => {
        const g = newGalaxy();
        const e = g.empires[0];
        const colony = e.colonies[0];
        colony.cargo = new CargoList();
        colony.cargo.add(new Cargo(new ResourceRef(2), 70, e));
        colony.cargo.add(new Cargo(new ResourceRef(2), 30, null));
        checkForUnownedCargoHabitat(g, colony);
        expect(colony.cargo.items.map((c) => [c.amount, c.empire === e])).toEqual([[100, true], [30, false]]);
        checkForUnownedCargoHabitat(g, colony);
        expect(colony.cargo.items[0].amount).toBe(130);
        // cargoRemove on the unowned entry does nothing either.
        cargoRemove(colony.cargo, colony.cargo.items[1]);
        expect(colony.cargo.items.length).toBe(2);
    }, 120000);
});

describe('colony consumption and resupply (Habitat.cs, Galaxy.cs)', () => {
    it('CalculateResourceLevel: space-port colony levels by relative importance × ResourceMultiplier; independent = fuel 4000', () => {
        const g = newGalaxy();
        const colony = g.empires[0].colonies[0];
        colony.hasSpacePort = true;
        colony.population.totalAmount = 4000000000; // ResourceMultiplier = min(4, max(1, 1e-8 * 4e9 / 20)) = 2
        for (const def of g.resourceSystem.strategicResources) {
            const ri = g.resourceSystem.relativeImportance.get(def.resourceId)!;
            let q = ri > Math.fround(0.4) ? 4000 : ri > Math.fround(0.25) ? 2000 : !(ri > Math.fround(0.15)) ? 500 : 1000;
            if (def.isFuel) q += 100;
            expect(calculateResourceLevelHabitat(g, def.resourceId, colony, false, false, false, 100)).toBe(Math.trunc(q * 2));
            expect(calculateResourceLevelHabitat(g, def.resourceId, colony, true, true)).toBe(def.isFuel ? 4000 : 0);
        }
        // CalculateResourceLevelSpaceport ignores its resource: the last strategic resource's level wins.
        const ordered = g.resourceSystem.strategicResourcesOrderedByRelativeImportance;
        const last = ordered[ordered.length - 1];
        const expected = Math.trunc((4000 * g.resourceSystem.relativeImportance.get(last.resourceId)! + (last.isFuel ? 50 : 0)) * 2.0);
        expect(calculateResourceLevelSpaceport(g, ordered[0].resourceId, 50, 2.0)).toBe(expected);
    }, 120000);

    it('ConsumeResources: luxury and critical resources shrink by the (int) consumption, at least 1', () => {
        const g = newGalaxy();
        const e = g.empires[0];
        const colony = e.colonies[0];
        colony.population.totalAmount = 3000000000;
        colony.cargo = new CargoList();
        const lux = g.resourceSystem.luxuryResources.find((r) => r.superLuxuryBonusAmount === 0)!;
        const restricted = g.resourceSystem.superLuxuryResources[0];
        const plain = g.resourceSystem.strategicResources.find((r) => !(colony.population.dominantRace?.criticalResources ?? []).some((b) => b.resourceId === r.resourceId))!;
        const cLux = new Cargo(new ResourceRef(lux.resourceId), 1000, e);
        const cRes = new Cargo(new ResourceRef(restricted.resourceId), 1000, e);
        const cPlain = new Cargo(new ResourceRef(plain.resourceId), 1000, e);
        const cGone = new Cargo(new ResourceRef(lux.resourceId), 1, g.empires[1]);
        for (const c of [cLux, cRes, cPlain, cGone]) colony.cargo.add(c);
        // 60 s: luxury (int)(2e-8 * 3e9 * 60 / 600) = 6; restricted (int)(1e-8 * 3e9 * 60 / 600) = 3.
        consumeResources(g, colony, 60);
        expect(cLux.amount).toBe(994);
        expect(cRes.amount).toBe(997);
        expect(cPlain.amount).toBe(1000);
        expect(cGone.amount).toBe(1); // other empire's cargo untouched
        // 1 s: both round down to 0 → clamped to 1.
        consumeResources(g, colony, 1);
        expect(cLux.amount).toBe(993);
        expect(cRes.amount).toBe(996);
    }, 120000);

    it('CalculateStrategicResourceConsumptionPerYear: 5 + (int)(5 × 0.33 × sqrt(pop / 1e6) × ColonyGrowthResourceLevel)', () => {
        const g = newGalaxy();
        const colony = g.empires[0].colonies[0];
        colony.population.totalAmount = 4000000000;
        const def = g.resourceSystem.resources.find((r) => r.colonyGrowthResourceLevel > 0)!;
        const lvl = Math.fround(def.colonyGrowthResourceLevel);
        expect(calculateStrategicResourceConsumptionPerYear(g, colony, def.resourceId)).toBe(5 + Math.trunc(5.0 * 0.33 * Math.sqrt(4000) * lvl));
        const none = g.resourceSystem.resources.find((r) => !(r.colonyGrowthResourceLevel > 0))!;
        expect(calculateStrategicResourceConsumptionPerYear(g, colony, none.resourceId)).toBe(0);
    }, 120000);

    it('MaintainIndependentColonyFuelLevels orders fuel up to 4000 when below 60 % and the gap is at least 500', () => {
        const g = newGalaxy();
        g.orders = new OrderList(true);
        const fuel = g.resourceSystem.fuelResources[0];
        const ind = g.independentColonies.filter((h) => h.owner === g.independentEmpire);
        expect(ind.length).toBeGreaterThan(0);
        const h = ind[0];
        h.cargo = new CargoList();
        h.cargo.add(new Cargo(new ResourceRef(fuel.resourceId), 1000, g.independentEmpire));
        maintainIndependentColonyFuelLevels(g);
        const orders = g.orders.getOrdersForHabitat(h).items.filter((o) => o.commodityResource!.resourceId === fuel.resourceId);
        expect(orders.map((o) => o.amountRequested)).toEqual([3000]);
        // Stock + outstanding orders now meet the level: no second order.
        maintainIndependentColonyFuelLevels(g);
        expect(g.orders.getOrdersForHabitat(h).items.filter((o) => o.commodityResource!.resourceId === fuel.resourceId).length).toBe(1);
    }, 120000);
});

describe('contracts and trade bonuses', () => {
    it('InitiateContract moves money and reserves the cargo for the buyer at the seller', () => {
        const g = newGalaxy();
        const buyer = g.empires[0];
        const seller = g.independentEmpire!;
        const colony = buyer.colonies[0];
        const post = g.independentColonies.find((h) => h.owner === seller)!;
        post.cargo = new CargoList();
        const rid = g.resourceSystem.strategicResources[0].resourceId;
        const stock = new Cargo(new ResourceRef(rid), 1000, seller);
        post.cargo.add(stock);
        const order = new Order(g, colony, new ResourceRef(rid), 600, galaxyStarDate(g) + 1000000, 0);
        const contract = new Contract(post, 600, rid, -1, buyer.empireId);
        const freighter = (seller.freighters as BuiltObject[])[0];
        contract.freighter = freighter;
        const price = galaxyResourceCurrentPrices(g)[rid];
        const buyerPrivate = buyer.privateMoney;
        const sellerPrivate = seller.privateMoney;
        initiateContractForOrder(g, buyer, post, order, contract, seller, galaxyStarDate(g));
        expect(order.contracts).toEqual([contract]);
        expect(buyer.privateMoney).toBeCloseTo(buyerPrivate - price * 600, 6);
        expect(seller.privateMoney).toBeCloseTo(sellerPrivate + price * 600, 6);
        expect(stock.amount).toBe(400);
        const reservedForBuyer = post.cargo.items.find((c) => c.empire === buyer)!;
        expect([reservedForBuyer.amount, reservedForBuyer.reserved]).toEqual([600, 600]);
    }, 120000);

    it('PerformFinancialTransaction counts an unprofitable year when a new year starts below 2 × AnnualSupportCost', () => {
        const g = newGalaxy();
        const bo = g.empires[0].builtObjects[0];
        const twice = (bo.annualSupportCost * 2) | 0; // AnnualSupportCost includes maintenance modifiers
        bo.dateOfLastIncome = 0;
        bo.currentYearsIncome = twice - 1;
        bo.consecutiveUnprofitableYears = 0;
        performFinancialTransaction(bo, 1, 600000 * 3 + 5, false);
        expect(bo.consecutiveUnprofitableYears).toBe(1);
        expect(bo.currentYearsIncome).toBe(1);
        performFinancialTransaction(bo, twice, 600000 * 3 + 6, false);
        expect(bo.consecutiveUnprofitableYears).toBe(0);
    }, 120000);

    it('ProcessTradeBonuses: free-trade bonus grows 0.1 per year up to 0.2; other relations reset to 0', () => {
        const g = newGalaxy();
        const e = g.empires[0];
        const other = g.empires[1];
        const rel = e.diplomaticRelations.byEmpire(other) ?? (() => {
            const r = new DiplomaticRelation(DiplomaticRelationType.NotMet, e, e, other, false);
            e.diplomaticRelations.add(r);
            return r;
        })();
        rel.type = DiplomaticRelationType.FreeTradeAgreement;
        rel.tradeBonus = 0.0;
        processTradeBonuses(g, e, 300); // half a year
        expect(rel.tradeBonus).toBeCloseTo(0.05, 12);
        processTradeBonuses(g, e, 6000);
        expect(rel.tradeBonus).toBe(0.2);
        rel.type = DiplomaticRelationType.None;
        processTradeBonuses(g, e, 60);
        expect(rel.tradeBonus).toBe(0.0);
    }, 120000);
});

describe('freighter fuel range (BuiltObject.1.cs 2348-2390)', () => {
    it('CurrentRange = fuel / ((burn + static) × fuelPerEnergy) × warp speed; WithinFuelRange compares squared distances', () => {
        const g = newGalaxy();
        const f = (g.independentEmpire!.freighters as BuiltObject[])[0];
        const perEnergy = f.reactorCycleFuelConsumption / 1000.0 / (f.reactorStorageCapacity + 1.0);
        const speed = f.warpSpeed > 0 ? f.warpSpeed : f.cruiseSpeed;
        const burn = f.warpSpeed > 0 ? f.warpSpeedFuelBurn : f.cruiseSpeedFuelBurn;
        const range = (f.currentFuel / ((burn + f.staticEnergyConsumption) * perEnergy)) * speed;
        expect(currentRange(f)).toBeCloseTo(range, 6);
        const r = withinFuelRange(g, f, f.xpos + range * 0.5, f.ypos, 0.0);
        expect(r.within).toBe(true);
        expect(r.rangeFactor).toBeCloseTo(0.25, 9);
        expect(withinFuelRange(g, f, f.xpos + range * 2, f.ypos, 0.0).within).toBe(false);
    }, 120000);
});

describe('harness smoke (seed 1, 600 game-s)', () => {
    it('colonies place orders, CheckMarketOrders contracts freighters with Transport missions, seller cargo is reserved', () => {
        const g = newGalaxy();
        runGameSeconds(g, 600);
        expect(g.orders.count).toBeGreaterThan(0);
        const contracted = g.orders.items.filter((o) => o.contracts.length > 0);
        expect(contracted.length).toBeGreaterThan(0);
        // Since M4n a freighter that sights a creature within attack range flees (BuiltObject.1.cs 1621 ShouldFleeFrom,
        // FleeWhen = EnemyMilitarySighted); ClearPreviousMissionRequirements then cancels its contracts, which the C#
        // CancelContract leaves on the order with AmountToFulfill = AmountDelivered (0). Only live contracts are checked.
        // A fully delivered contract also stays on its Order (the C# never removes contracts from Order.Contracts), with
        // AmountToFulfill == AmountDelivered and the freighter released: live means AmountToFulfill > AmountDelivered.
        const isLive = (c: Contract | null): c is Contract => c !== null && c.amountToFulfill > 0 && c.amountToFulfill > c.amountDelivered;
        const live = contracted.filter((o) => o.contracts.some(isLive));
        expect(live.length).toBeGreaterThan(0);
        for (const o of live) {
            for (const c of o.contracts) {
                if (!isLive(c)) continue;
                expect(c!.freighter).not.toBeNull();
                expect(builtObjectContracts(c!.freighter!)).toContain(c);
                expect(builtObjectMission(c!.freighter!.mission)?.type).toBe(BuiltObjectMissionType.Transport);
                expect(c!.amountToFulfill).toBeGreaterThan(0);
            }
            expect(o.amountToFulfill).toBeLessThanOrEqual(o.amountRequested);
        }
        // Every order references a live requester (plan §5.3 invariant).
        for (const o of g.orders.items) {
            if (o.requestingColony !== null) expect(g.habitats).toContain(o.requestingColony);
            if (o.requestingBuiltObject !== null) expect(o.requestingBuiltObject.hasBeenDestroyed).toBe(false);
        }
    }, 600000);
});
