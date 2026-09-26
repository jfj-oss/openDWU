// M4g — resource extraction & industry (tasks/M4-plan.md §3.3 M4g). Unit tests against hand-worked C# values, plus a
// harness smoke test (mining stations accumulate cargo over runGameSeconds).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { BuiltObject } from '../src/sim/builtObject';
import type { Habitat } from '../src/sim/types';
import { HabitatCategoryType, IndustryType } from '../src/sim/types';
import { Cargo, CargoList, ResourceRef } from '../src/sim/cargo';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { runGameSeconds } from '../src/sim/tick/harness';
import {
    extractResources,
    getResourcesForManufacturing,
    habitatResourceExtract,
    identifyDeficientEmpireResources,
    industrialProcessing,
    manufacturingQueueDoManufacturing,
    maxResourceExtractionRate,
    prioritizeEmpireResourceNeeds,
    reviewManufacturedResources,
} from '../src/sim/industry';
import { ManufacturingQueue, builtObjectManufacturingQueue, habitatManufacturingQueue } from '../src/sim/manufacturingQueue';
import { cmdExtractResources } from '../src/sim/missions/cmdExtract';
import { BuiltObjectMission, BuiltObjectMissionPriority, BuiltObjectMissionType, Command, CommandAction } from '../src/sim/missions/mission';
import type { CommandContext } from '../src/sim/missions/executeCommands';
import { ComponentCategoryType } from '../src/sim/data/policies';
import { galaxyResourceCurrentPrices } from '../src/sim/design';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

function newGalaxy(): Galaxy {
    return cachedTickGame(gameData).galaxy;
}

function allBuiltObjects(g: Galaxy): BuiltObject[] {
    const out: BuiltObject[] = [];
    for (const e of [...g.empires, ...g.pirateEmpires]) out.push(...e.builtObjects, ...e.privateBuiltObjects);
    return out;
}

function isMiningStation(b: BuiltObject): boolean {
    return b.subRole === BuiltObjectSubRole.MiningStation || b.subRole === BuiltObjectSubRole.GasMiningStation;
}

function cargoTotal(list: CargoList | null): number {
    return list === null ? 0 : list.items.reduce((s, c) => s + c.amount, 0);
}

describe('HabitatResource.Extract (HabitatResource.cs)', () => {
    it('Math.Max(1, (int)(volume / (1000.0 / Abundance)))', () => {
        expect(habitatResourceExtract({ resourceId: 0, abundance: 500 }, 100)).toBe(50);
        expect(habitatResourceExtract({ resourceId: 0, abundance: 333 }, 100)).toBe(33); // 100 / 3.003… = 33.3
        expect(habitatResourceExtract({ resourceId: 0, abundance: 1000 }, 0.4)).toBe(1); // (int)0.4 = 0 → 1
        expect(habitatResourceExtract({ resourceId: 0, abundance: 0 }, 1e6)).toBe(1); // 1000/0 = ∞ → 0 → 1
    });
});

describe('Habitat.ExtractResources (Habitat.cs 2827)', () => {
    it('an independent colony mines luxury, then gas, then mineral resources into its cargo', () => {
        // Owner is the independent empire → num = 1; IndependentEmpire.Leader is null; no characters; no MiningRate.
        const g = newGalaxy();
        const rs = g.resourceSystem;
        const h = g.independentColonies.find((c) => c.population.totalAmount > 0)!;
        expect(h.owner === null || h.owner === g.independentEmpire).toBe(true);
        const lux = rs.luxuryResources[0].resourceId;
        const gas = rs.gasStrategicResources[0].resourceId;
        const min = rs.mineralStrategicResources[0].resourceId;
        h.resources = [
            { resourceId: min, abundance: 500 },
            { resourceId: gas, abundance: 1000 },
            { resourceId: lux, abundance: 250 },
        ];
        h.cargo = new CargoList();
        h.population.totalAmount = 400000000; // num2 = min(9, max(3, 4)) = 4
        const ind = g.independentEmpire!;
        const before = { ...ind.counters };
        extractResources(g, h, 10.0); // num3 = max(1, (int)(4 * 10)) = 40
        expect(h.cargo.items.map((c) => [c.commodity.resourceId, c.amount, c.empire])).toEqual([
            [lux, 10, ind], // 40 / (1000/250)
            [gas, 40, ind], // 40 / 1
            [min, 20, ind], // 40 / 2
        ]);
        expect(ind.counters.miningExtractionLuxury - before.miningExtractionLuxury).toBe(10);
        expect(ind.counters.miningExtractionGas - before.miningExtractionGas).toBe(40);
        expect(ind.counters.miningExtractionStrategic - before.miningExtractionStrategic).toBe(20);
    });

    it('no cargo → nothing; empty population → nothing', () => {
        const g = newGalaxy();
        const h = g.independentColonies.find((c) => c.population.totalAmount > 0)!;
        h.cargo = null;
        extractResources(g, h, 10.0);
        expect(h.cargo).toBeNull();
        h.cargo = new CargoList();
        h.population.totalAmount = 0;
        extractResources(g, h, 10.0);
        expect(h.cargo.items.length).toBe(0);
    });
});

describe('BuiltObject.IndustrialProcessing (BuiltObject.2.cs 7805)', () => {
    function gasStation(g: Galaxy): BuiltObject {
        return allBuiltObjects(g).find((b) => b.subRole === BuiltObjectSubRole.GasMiningStation && b.parentHabitat !== null && b.parentHabitat.empire === null)!;
    }

    function neutralise(bo: BuiltObject): void {
        const e = bo.actualEmpire!;
        e.leader = null;
        bo.empire!.resourceExtractionBonus = 0;
        e.difficultyFactors = null;
        bo.characters = null;
    }

    it('a stopped gas mining station extracts its parent habitat’s gas into cargo (not below 25 % free: every gas resource)', () => {
        const g = newGalaxy();
        const bo = gasStation(g);
        neutralise(bo);
        const gas = g.resourceSystem.gasStrategicResources[0].resourceId;
        bo.parentHabitat!.resources = [{ resourceId: gas, abundance: 1000 }];
        bo.cargo = new CargoList();
        expect(bo.currentSpeed).toBe(0);
        expect(bo.extractionGas).toBeGreaterThan(0);
        const rate = maxResourceExtractionRate(bo, 2);
        industrialProcessing(g, bo, 10.0, g.nowMs);
        // val4 = min(ExtractionGas * 1 * 10, 10 * rate); Extract at abundance 1000 = (int)val4.
        const expected = Math.max(1, Math.trunc(Math.min(bo.extractionGas * 10.0, 10.0 * rate)));
        expect(bo.cargo.items.map((c) => [c.commodity.resourceId, c.amount, c.empire])).toEqual([[gas, expected, bo.actualEmpire]]);
        expect(bo.doingGasMining).toBe(true);
        expect(bo.doingMining).toBe(false);
    });

    it('a moving extractor, a missing parent habitat or an owned parent habitat extracts nothing', () => {
        const g = newGalaxy();
        const bo = gasStation(g);
        neutralise(bo);
        bo.cargo = new CargoList();
        bo.currentSpeed = 5;
        industrialProcessing(g, bo, 10.0, g.nowMs);
        expect(cargoTotal(bo.cargo)).toBe(0);
        bo.currentSpeed = 0;
        const parent = bo.parentHabitat!;
        parent.empire = g.empires[0];
        industrialProcessing(g, bo, 10.0, g.nowMs);
        expect(cargoTotal(bo.cargo)).toBe(0);
        parent.empire = null;
        industrialProcessing(g, bo, 10.0, g.nowMs);
        expect(cargoTotal(bo.cargo)).toBeGreaterThan(0);
    });

    it('below 25 % free space a mining station only tops up scarce (< 30 % of hold) priced fuel gases', () => {
        const g = newGalaxy();
        const bo = gasStation(g);
        neutralise(bo);
        const rs = g.resourceSystem;
        const fuelGas = rs.fuelResources.find((r) => r.type === 1)!.resourceId;
        const otherGas = rs.gasStrategicResources.find((r) => !r.isFuel)!.resourceId;
        bo.parentHabitat!.resources = [
            { resourceId: otherGas, abundance: 1000 },
            { resourceId: fuelGas, abundance: 1000 },
        ];
        bo.cargo = new CargoList();
        // Fill 90 % of the hold with a third resource: CargoSpace - 500 < 25 % of capacity.
        const filler = rs.mineralStrategicResources[0].resourceId;
        bo.cargo.add(new Cargo(new ResourceRef(filler), Math.trunc(bo.cargoCapacity * 0.9), bo.actualEmpire));
        // Fuel prices start at 0.83 (≤ num18 = 1.0): the scarce branch extracts nothing (flag2 false) and the general
        // branch mines every gas.
        const prices = galaxyResourceCurrentPrices(g);
        expect(prices[fuelGas]).toBeLessThanOrEqual(1.0);
        industrialProcessing(g, bo, 10.0, g.nowMs);
        expect(bo.cargo.items.map((c) => c.commodity.resourceId)).toEqual([filler, otherGas, fuelGas]);
        // With the fuel priced above 1 only the fuel gas is topped up.
        bo.cargo = new CargoList();
        bo.cargo.add(new Cargo(new ResourceRef(filler), Math.trunc(bo.cargoCapacity * 0.9), bo.actualEmpire));
        const saved = prices[fuelGas];
        prices[fuelGas] = 2.0;
        industrialProcessing(g, bo, 10.0, g.nowMs);
        prices[fuelGas] = saved;
        expect(bo.cargo.items.map((c) => c.commodity.resourceId)).toEqual([filler, fuelGas]);
        expect(bo.doingGasMining).toBe(true);
    });

    it('MaxResourceExtractionRate (BaconEmpire.cs 340): Romulan 40000; gas floors to 40, mine/luxury to 12', () => {
        const g = newGalaxy();
        const bo = gasStation(g);
        const e = bo.actualEmpire!;
        const saved = e.research.componentImprovements;
        e.research.componentImprovements = new Map();
        const own = bo.empire!;
        own.research.componentImprovements = new Map();
        expect(maxResourceExtractionRate(bo, 0)).toBe(12);
        expect(maxResourceExtractionRate(bo, 1)).toBe(12);
        expect(maxResourceExtractionRate(bo, 2)).toBe(40);
        const name = e.name;
        e.name = 'Romulan Star Empire';
        expect(maxResourceExtractionRate(bo, 2)).toBe(40000);
        e.name = name;
        e.research.componentImprovements = saved;
    });
});

describe('ManufacturingQueue (ManufacturingQueue.cs)', () => {
    it('colonies get a queue with one 24000-speed manufacturer per industry; DoManufacturing draws Next(0, 3) once per call', () => {
        const g = newGalaxy();
        const capital = g.empires[0].capital!;
        const q = habitatManufacturingQueue(capital)!;
        expect(q).toBeInstanceOf(ManufacturingQueue);
        expect(q.manufacturers!.map((m) => [m.industry, m.manufacturingSpeed, m.parentBuiltObjectComponentId])).toEqual([
            [IndustryType.Weapon, 24000, 62],
            [IndustryType.Energy, 24000, 63],
            [IndustryType.HighTech, 24000, 64],
        ]);
        const d0 = g.rnd.drawCount;
        manufacturingQueueDoManufacturing(q, g, g.nowMs + 10000, 0);
        expect(g.rnd.drawCount - d0).toBe(1);
        expect(q._lastProcessed).toBe(g.nowMs + 10000);
        // No cargo → no draw.
        const cargo = capital.cargo;
        capital.cargo = null;
        manufacturingQueueDoManufacturing(q, g, g.nowMs + 20000, 0);
        expect(g.rnd.drawCount - d0).toBe(1);
        capital.cargo = cargo;
    });

    it('built objects with manufacturer components get one manufacturer per built component (Redefine(BuiltObject))', () => {
        const g = newGalaxy();
        const bo = allBuiltObjects(g).find((b) => b.isManufacturer)!;
        const q = builtObjectManufacturingQueue(bo)!;
        const comps = bo.components.items.filter((c) => c.category === ComponentCategoryType.Manufacturer && c.status === 1);
        expect(q.manufacturers!.length).toBe(comps.length);
        expect(q.manufacturers!.map((m) => m.manufacturingSpeed)).toEqual(comps.map((c) => c.value1));
        // Re-running ReDefine keeps the same manufacturers (FindManufacturerByComponentIndex).
        expect(q.redefineBuiltObject()).toBe(true);
        expect(q.manufacturers!.length).toBe(comps.length);
    });

    it('the wait queue takes a component into a free slot when the cargo holds its resources, else records the shortage', () => {
        const g = newGalaxy();
        const capital = g.empires[0].capital!;
        const q = habitatManufacturingQueue(capital)!;
        const def = g.researchStatic!.componentStatic!.definitions.find((c) => c.industry === IndustryType.Weapon && c.resourceRequirements.length > 0)!;
        const req = def.resourceRequirements[0];
        // Shortage: empty cargo.
        capital.cargo = new CargoList();
        expect(q.addComponentToManufacture(def)).toBe(true);
        const r0 = getResourcesForManufacturing(capital.cargo, def, capital.empire, new Array(g.resourceSystem.resources.length).fill(-1));
        expect(r0.ok).toBe(false);
        expect(r0.deficientResourceId).toBe(req.resourceId);
        manufacturingQueueDoManufacturing(q, g, g.nowMs + 1, 5);
        expect(q.componentWaitQueue!.length).toBe(1);
        expect(q.deficientResources.contains(req.resourceId)).toBe(true);
        // Enough of every resource: the component moves to the Weapon manufacturer and the resources are consumed.
        for (const rr of def.resourceRequirements) capital.cargo.add(new Cargo(new ResourceRef(rr.resourceId), rr.amount + 7, capital.empire));
        manufacturingQueueDoManufacturing(q, g, g.nowMs + 2, 5);
        expect(q.componentWaitQueue!.length).toBe(0);
        expect(q.manufacturers![0].component).toBe(def);
        expect(q.deficientResources.items.length).toBe(0);
        for (const rr of def.resourceRequirements) expect(capital.cargo.items.find((c) => c.commodity.resourceId === rr.resourceId)!.amount).toBe(7);
    });
});

describe('Habitat.ReviewManufacturedResources (Habitat.cs 1899)', () => {
    it('without an owner (num = 0) a planet loses its colony-manufactured resources and draws nothing', () => {
        const g = newGalaxy();
        const rs = g.resourceSystem;
        if (rs.colonyManufacturedResources.length === 0) return;
        const cm = rs.colonyManufacturedResources[0];
        const h = g.habitats.find((x) => x.category === HabitatCategoryType.Planet && x.owner === null) as Habitat;
        h.resources = [{ resourceId: rs.mineralStrategicResources[0].resourceId, abundance: 300 }, { resourceId: cm.resourceId, abundance: 400 }];
        const d0 = g.rnd.drawCount;
        reviewManufacturedResources(g, h);
        expect(g.rnd.drawCount).toBe(d0);
        expect(h.resources.map((r) => r.resourceId)).toEqual([rs.mineralStrategicResources[0].resourceId]);
    });
});

describe('PrioritizeEmpireResourceNeeds (Empire.2.cs 4038)', () => {
    it('deficient resources come sorted by demand (descending) with SortTag >= minimumValue', () => {
        const g = newGalaxy();
        const e = g.empires[0];
        const list = identifyDeficientEmpireResources(g, e, false, 1.0);
        expect(list.length).toBe(g.resourceSystem.resources.length);
        for (let i = 1; i < list.length; i++) expect(list[i - 1].sortTag).toBeGreaterThanOrEqual(list[i].sortTag);
        for (const r of list) expect(r.sortTag).toBeGreaterThanOrEqual(1.0);
    });

    it('targets are unowned, explored, not already mined, priority > 1, sorted descending', () => {
        const g = newGalaxy();
        for (const e of g.empires) {
            const targets = prioritizeEmpireResourceNeeds(g, e);
            const mined = new Set<Habitat>();
            for (const b of [...e.builtObjects, ...e.privateBuiltObjects]) if (isMiningStation(b) && b.parentHabitat !== null) mined.add(b.parentHabitat);
            for (let i = 0; i < targets.length; i++) {
                const t = targets[i];
                expect(t.priority).toBeGreaterThanOrEqual(1);
                expect(t.habitat!.owner === null || t.habitat!.owner === g.independentEmpire).toBe(true);
                expect(mined.has(t.habitat!)).toBe(false);
                expect(e.visibility.checkSystemExplored(t.habitat!.systemIndex)).toBe(true);
                if (i > 0) expect(targets[i - 1].priority).toBeGreaterThanOrEqual(t.priority);
            }
        }
    });
});

describe('ExecuteCommands case ExtractResources (BuiltObject.2.cs 1227)', () => {
    function setup(): { g: Galaxy; ship: BuiltObject; planet: Habitat; ctx: (cmd: Command) => CommandContext } {
        const g = newGalaxy();
        const ship = allBuiltObjects(g).find((b) => b.subRole === BuiltObjectSubRole.MiningShip)!;
        const min = g.resourceSystem.mineralStrategicResources[0].resourceId;
        const planet = g.habitats.find((h) => h.owner === null && h.empire === null && h.category === HabitatCategoryType.Planet)!;
        planet.resources = [{ resourceId: min, abundance: 500 }];
        const ctx = (command: Command): CommandContext => {
            const mission = new BuiltObjectMission(g, ship, BuiltObjectMissionType.ExtractResources, planet, null, BuiltObjectMissionPriority.Normal, { allowBuiltObjectChanges: false });
            mission.replaceCommandStack([command, new Command(CommandAction.ClearParent)]);
            ship.mission = mission;
            return { galaxy: g, bo: ship, mission, command, timePassed: 0.5, time: 10000, starDate: 10000, targetX: 0, targetY: 0, indexX: 0, indexY: 0, xpos: ship.xpos, ypos: ship.ypos, parentXPos: -2000000001.0, parentYPos: -2000000001.0, targetArrivalDistance: 0 };
        };
        return { g, ship, planet, ctx };
    }

    it('first execution stops the ship and keeps the command while the target has minerals', () => {
        const { ship, planet, ctx } = setup();
        ship.cargo = new CargoList();
        ship.currentSpeed = 12;
        ship.preferredSpeed = 12;
        ship.firstExecutionOfCommand = true;
        const c = ctx(Command.forTarget(CommandAction.ExtractResources, planet));
        expect(cmdExtractResources(c)).toBe(0.0);
        expect(ship.currentSpeed).toBe(0);
        expect(ship.preferredSpeed).toBe(0);
        expect(ship.firstExecutionOfCommand).toBe(false);
        expect(c.mission.fastPeekCurrentCommand()!.action).toBe(CommandAction.ExtractResources);
    });

    it('completes when the hold is full, when nothing is extractable, or when a real empire owns the target', () => {
        const { g, ship, planet, ctx } = setup();
        // Full hold.
        ship.cargo = new CargoList();
        ship.cargo.add(new Cargo(new ResourceRef(0), ship.cargoCapacity, ship.actualEmpire));
        let c = ctx(Command.forTarget(CommandAction.ExtractResources, planet));
        cmdExtractResources(c);
        expect(c.mission.fastPeekCurrentCommand()!.action).toBe(CommandAction.ClearParent);
        expect(ship.firstExecutionOfCommand).toBe(true);
        // Only gas on the target: a MiningShip has nothing to extract.
        ship.cargo = new CargoList();
        planet.resources = [{ resourceId: g.resourceSystem.gasStrategicResources[0].resourceId, abundance: 500 }];
        c = ctx(Command.forTarget(CommandAction.ExtractResources, planet));
        cmdExtractResources(c);
        expect(c.mission.fastPeekCurrentCommand()!.action).toBe(CommandAction.ClearParent);
        // Owned by an empire.
        planet.resources = [{ resourceId: g.resourceSystem.mineralStrategicResources[0].resourceId, abundance: 500 }];
        planet.empire = g.empires[1];
        c = ctx(Command.forTarget(CommandAction.ExtractResources, planet));
        cmdExtractResources(c);
        expect(c.mission.fastPeekCurrentCommand()!.action).toBe(CommandAction.ClearParent);
        planet.empire = null;
    });
});

describe('harness smoke (runGameSeconds)', () => {
    it('mining stations accumulate resources in cargo over 120 game-s', () => {
        const g = newGalaxy();
        const stations = allBuiltObjects(g).filter(isMiningStation);
        expect(stations.length).toBeGreaterThan(0);
        const before = stations.map((b) => cargoTotal(b.cargo));
        const r = runGameSeconds(g, 120);
        const after = stations.map((b) => cargoTotal(b.cargo));
        // A station's cargo can also drop when a freighter loads from it within the window (Transport missions pick up at
        // mining stations; seen on seed 1 since sweep 2 moved the layout), so only most stations are required to grow.
        let grew = 0;
        for (let i = 0; i < stations.length; i++) if (after[i] > before[i]) grew++;
        expect(grew).toBeGreaterThanOrEqual(stations.length - 1);
        expect(after.reduce((a, b) => a + b, 0)).toBeGreaterThan(before.reduce((a, b) => a + b, 0));
        for (const k of ['M4g industrialProcessing', 'M4g extractResources', 'M4g doManufacturing', 'M4g reviewManufacturedResources', 'M4g prioritizeEmpireResourceNeeds']) {
            expect(r.todoHits[k] ?? 0).toBe(0);
        }
    }, 600000);
});
