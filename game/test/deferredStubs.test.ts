// Deferred tick-path stubs ported statement for statement (tourism income, pirate information sales, leave-system
// mission assignment, relinquished-colony order cleanup, strategic resource supply, construction ship lookup).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame } from './helpers/tickGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { BuiltObject } from '../src/sim/builtObject';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { Population } from '../src/sim/population';
import { processTourists } from '../src/sim/civilianAI';
import { thisYearsResortIncome } from '../src/sim/treasury';
import { TradeableItemType, resolveTradeableItems, resolveTradeableItemsPirateInfo } from '../src/sim/tradeItems';
import { generateSaleableInfoForEmpire } from '../src/sim/pirates/pirateRelationsAI';
import { leaveSystem, relinquishColonyOrders, removeMilitaryForcesFromSystem } from '../src/sim/diplomacyTick';
import { OrderType, empireCreateOrder } from '../src/sim/logistics/orders';
import { Contract } from '../src/sim/logistics/contracts';
import { Cargo, CargoList, ResourceRef } from '../src/sim/cargo';
import { ensureStrategicResourceSupply, findNearestAvailableConstructionShip } from '../src/sim/construction/empireConstruction';
import { HabitatPrioritization } from '../src/sim/resourceTargets';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { countResourceSourcesForEmpire } from '../src/sim/stationPlacement';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../src/sim/missions/mission';
import { DiplomaticStrategy, obtainDiplomaticRelation } from '../src/sim/diplomacy';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

function newGalaxy(): Galaxy {
    return createTickGame(gameData).galaxy;
}

describe('ProcessTourists (BuiltObject.2.cs 4825)', () => {
    let g: Galaxy;
    beforeAll(() => {
        g = newGalaxy();
    }, 300000);

    it('tourists unloading at a scenic colony pay tourism income to the colony empire (counters, resort income, state money)', () => {
        const empire = g.empires[0];
        const colony = empire.capital!;
        const ship = (g.builtObjects as BuiltObject[]).find((b) => b.empire === empire && b.role !== BuiltObjectRole.Base)!;
        colony.scenicFactor = 0.5;
        ship.dockedAt = colony;
        ship.pirateEmpireId = 0;
        const race = empire.dominantRace!;
        const before = { money: empire.stateMoney, tourism: empire.counters.tourismIncome, resort: thisYearsResortIncome(g, empire) };
        processTourists(g, ship, new Population(race, 80000));
        // 80000 / 8 = 10000 scaled by leader / character skill and race TourismIncomeFactor.
        const leader = empire.leader;
        let expected = 10000.0;
        if (leader !== null) expected *= 1.0 + leader.tourismIncome / 100.0;
        expected *= race.tourismIncomeFactor;
        expect(empire.counters.tourismIncome - before.tourism).toBeCloseTo(expected, 6);
        expect(thisYearsResortIncome(g, empire) - before.resort).toBeCloseTo(expected, 6);
        expect(empire.stateMoney - before.money).toBeCloseTo(expected, 6);
    });

    it('no income when the colony is not scenic or the group is a colonising population (>= 1 000 000)', () => {
        const empire = g.empires[1];
        const colony = empire.capital!;
        const ship = (g.builtObjects as BuiltObject[]).find((b) => b.empire === empire && b.role !== BuiltObjectRole.Base)!;
        ship.dockedAt = colony;
        const money = empire.stateMoney;
        colony.scenicFactor = 0.0;
        if (colony.ruin !== null) return;
        processTourists(g, ship, new Population(empire.dominantRace!, 80000));
        colony.scenicFactor = 0.5;
        processTourists(g, ship, new Population(empire.dominantRace!, 1000000));
        expect(empire.stateMoney).toBe(money);
    });
});

describe('ResolveTradeableItemsPirateInfo (Galaxy.4.cs 4474)', () => {
    it('a pirate giver offers the saleable information of GenerateSaleableInfoForEmpire at the C# prices', () => {
        const g = newGalaxy();
        const receiver = g.empires[0];
        let checkedAny = false;
        for (const pirate of g.pirateEmpires) {
            if (pirate.pirateEmpireBaseHabitat === null) continue;
            const info = generateSaleableInfoForEmpire(g, pirate, receiver);
            const items = resolveTradeableItemsPirateInfo(g, pirate, receiver, false);
            const n = info.unmetEmpires.length + info.unexploredSystems.length + info.independentColonies.length + info.ruinHabitats.length
                + info.debrisFieldLocations.length + info.planetDestroyerLocations.length + info.restrictedAreaLocations.length;
            expect(items.length).toBe(n);
            for (const it of items) {
                if (it.type === TradeableItemType.SystemMap) expect(it.value).toBe(2000);
                else if (it.type === TradeableItemType.IndependentColonyLocation) expect(it.value).toBe(20000);
                else if (it.type === TradeableItemType.SecretLocation) expect(it.value).toBe(30000);
                else {
                    expect(it.type).toBe(TradeableItemType.ContactEmpire);
                    expect(it.value).toBeLessThanOrEqual(10000);
                }
            }
            // ResolveTradeableItems appends the pirate info after the other items (4467-4470).
            const all = resolveTradeableItems(g, pirate, receiver, false, false);
            expect(all.slice(all.length - items.length).map((x) => [x.type, x.item, x.value])).toEqual(items.map((x) => [x.type, x.item, x.value]));
            if (n > 0) checkedAny = true;
        }
        expect(checkedAny).toBe(true);
    });
});

describe('LeaveSystem / RemoveMilitaryForcesFromSystem missions (Empire.3.cs 3945 / 4032)', () => {
    function setup(g: Galaxy, military: boolean) {
        const empire = g.empires.find((e) => e.refuellingDepots.length > 0)!;
        const depot = empire.refuellingDepots[0] as BuiltObject;
        const ship = (empire.builtObjects as BuiltObject[]).find((b) => b.role !== BuiltObjectRole.Base && b.topSpeed > 0 && b.shipGroup === null && (!military || (b.role === BuiltObjectRole.Military && b.firepowerRaw > 0)))!;
        const star = g.systems.map((s) => s.systemStar).find((h) => h !== depot.nearestSystemStar && g.calculateDistance(h.xpos, h.ypos, depot.xpos, depot.ypos) > 100000)!;
        ship.nearestSystemStar = star;
        ship.xpos = star.xpos;
        ship.ypos = star.ypos;
        // Nearest depot outside the system (Empire.3.cs 3949-3961: (int) distance, first strict minimum).
        let best = 536870911;
        let nearest: BuiltObject | null = null;
        for (const d of empire.refuellingDepots as BuiltObject[]) {
            if (d.nearestSystemStar === star) continue;
            const dist = Math.trunc(g.calculateDistance(star.xpos, star.ypos, d.xpos, d.ypos));
            if (dist < best) { best = dist; nearest = d; }
        }
        return { empire, depot: nearest!, ship, star };
    }

    it('LeaveSystem orders a lone ship in the system to Move to the nearest outside refuelling depot and returns FirepowerRaw / 20', () => {
        const g = newGalaxy();
        const { empire, depot, ship, star } = setup(g, false);
        const others = (empire.builtObjects as BuiltObject[]).filter((b) => b !== ship && b.role !== BuiltObjectRole.Base && (b.nearestSystemStar === star));
        expect(others.length).toBe(0);
        const value = leaveSystem(g, empire, star);
        expect(value).toBe(ship.firepowerRaw / 20.0);
        const mission = builtObjectMission(ship.mission);
        expect(mission).not.toBeNull();
        expect(mission!.type).toBe(BuiltObjectMissionType.Move);
        expect(mission!.targetBuiltObject).toBe(depot);
    });

    it('RemoveMilitaryForcesFromSystem orders armed military ships at the system to Refuel at the depot (priority Unavailable)', () => {
        const g = newGalaxy();
        const { empire, depot, ship, star } = setup(g, true);
        const requester = g.empires.find((e) => e !== empire)!;
        obtainDiplomaticRelation(empire, requester).strategy = DiplomaticStrategy.Ally;
        expect(removeMilitaryForcesFromSystem(g, empire, star, requester)).toBe(1);
        const mission = builtObjectMission(ship.mission)!;
        expect(mission.type).toBe(BuiltObjectMissionType.Refuel);
        expect(mission.targetBuiltObject).toBe(depot);
        expect(mission.priority).toBe(BuiltObjectMissionPriority.Unavailable);
    });
});

describe('RemoveColoniesFromSystem order cleanup (Empire.3.cs 4587-4630)', () => {
    it("a relinquished colony's orders are removed and contracted freighters' cargo for it is re-owned by the freighter empire", () => {
        const g = newGalaxy();
        const self = g.empires[0];
        const colony = self.capital!;
        // A non-freight carrier: ClearPreviousMissionRequirements empties a Freight-role ship's cargo (BaconClearCargo).
        const freighter = (g.builtObjects as BuiltObject[]).find((b) => b.empire !== null && b.empire !== self && b.role === BuiltObjectRole.Military)!;
        const resource = new ResourceRef(1);
        const order = empireCreateOrder(g, self, colony, resource, 500, true, OrderType.Standard);
        const contract = new Contract(null, 300, 1, -1, self.empireId);
        contract.freighter = freighter;
        order.contracts.push(contract);
        freighter.cargo = new CargoList();
        freighter.cargo.add(new Cargo(resource, 300, self));
        expect(g.orders.getOrdersForHabitat(colony).items).toContain(order);
        relinquishColonyOrders(g, self, colony);
        expect(g.orders.getOrdersForHabitat(colony).items).not.toContain(order);
        expect(g.orders.items).not.toContain(order);
        expect(freighter.cargo.indexOf(resource, self)).toBe(-1);
        const idx = freighter.cargo.indexOf(resource, freighter.empire);
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(freighter.cargo.items[idx].amount).toBe(300);
    });
});

describe('EnsureStrategicResourceSupply (Empire.6.cs 1656)', () => {
    it('a fuel shortage sends an idle construction ship to build a mining station at the top resource target holding it', () => {
        const g = newGalaxy();
        const empire = g.empires[1];
        const fuel = g.resourceSystem.fuelResources.find((r) => countResourceSourcesForEmpire(empire, r.resourceId) < 2 + Math.trunc(empire.colonies.length / 3))!;
        expect(fuel).toBeDefined();
        const mined = new Set((empire.miningStations as BuiltObject[]).map((b) => b.parentHabitat));
        const target = g.habitats.find((h) => h.empire === null && !mined.has(h) && h.resources.some((r) => r.resourceId === fuel.resourceId))!;
        empire.resourceTargets.unshift(new HabitatPrioritization(target, 1000));
        const ship = (empire.constructionShips as BuiltObject[]).find((b) => b.subRole === BuiltObjectSubRole.ConstructionShip && b.isShipYard && b.isAutoControlled)!;
        for (const b of empire.constructionShips as BuiltObject[]) b.mission = null;
        ensureStrategicResourceSupply(g, empire);
        const mission = builtObjectMission(ship.mission)!;
        expect(mission).not.toBeNull();
        expect(mission.type).toBe(BuiltObjectMissionType.Build);
        expect(mission.targetHabitat).toBe(target);
        expect([BuiltObjectSubRole.MiningStation, BuiltObjectSubRole.GasMiningStation]).toContain(mission.design!.subRole);
        // Only one habitat was short: the other idle construction ships stay idle.
        const others = (empire.constructionShips as BuiltObject[]).filter((b) => b !== ship && builtObjectMission(b.mission) !== null);
        expect(others.length).toBe(0);
    });
});

describe('FindNearestAvailableConstructionShip (Empire.9.cs 4631)', () => {
    it('returns the nearest mission-less construction ship not attached to a yard, else null', () => {
        const g = newGalaxy();
        const empire = g.empires[0];
        const ships = (empire.builtObjects as BuiltObject[]).filter((b) => b.subRole === BuiltObjectSubRole.ConstructionShip);
        expect(ships.length).toBeGreaterThan(1);
        for (const b of ships) { b.mission = null; b.builtAt = null; }
        const far = ships[ships.length - 1];
        expect(findNearestAvailableConstructionShip(g, empire, far.xpos + 1, far.ypos)).toBe(far);
        for (const b of ships) b.builtAt = empire.capital;
        expect(findNearestAvailableConstructionShip(g, empire, far.xpos, far.ypos)).toBeNull();
    });
});
