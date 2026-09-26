// Component cargo (Cargo.cs Cargo(Component, amount, empire[, reserved]) / CargoList.cs Add, IndexOf(Component, Empire),
// Clone) on the two paths that used to stop at a TODO(port):
//   - ManufacturingQueue.cs Clear (386): an in-progress manufacturer component goes back to the parent's cargo as
//     new Cargo(component, 1, empire, 1). Reached from BuiltObject.1.cs 1445 (ClearPreviousMissionRequirements) once
//     Empire.ProcureConstructionComponents (Empire.6.cs 880/918) has filled the wait queue — a 30-year run threw here.
//   - BaconBuiltObjectMission.cs 290-311: a construction ship skips building an unbuilt component it already carries.
// Plus the save round trip of a component cargo entry, and an old save without the field.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { BuiltObject } from '../src/sim/builtObject';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { ComponentStatus } from '../src/sim/builtObjectComponent';
import { Cargo, CargoList, ResourceRef } from '../src/sim/cargo';
import { builtObjectManufacturingQueue, habitatManufacturingQueue, listAddComponentToManufacture } from '../src/sim/manufacturingQueue';
import { clearPreviousMissionRequirements } from '../src/sim/missions/assign';
import { BuiltObjectMission, BuiltObjectMissionPriority, BuiltObjectMissionType, CommandAction, cloneCargoList } from '../src/sim/missions/mission';
import { galaxyFromJSON, galaxyToJSON } from '../src/sim/save/galaxySave';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 180000);

function constructionShip(galaxy: Galaxy): BuiltObject {
    for (const empire of galaxy.empires) {
        const ship = empire.builtObjects.find((b) => b.subRole === BuiltObjectSubRole.ConstructionShip && builtObjectManufacturingQueue(b) !== null);
        if (ship !== undefined) return ship;
    }
    throw new Error('no construction ship with a manufacturing queue in the harness game');
}

describe('ManufacturingQueue.Clear (ManufacturingQueue.cs 386) with an in-progress component', () => {
    it('ClearPreviousMissionRequirements returns the component to the ship cargo as Cargo(component, 1, empire, 1)', () => {
        const galaxy = cachedTickGame(gameData).galaxy;
        const ship = constructionShip(galaxy);
        const mq = builtObjectManufacturingQueue(ship)!;
        if (ship.cargo === null) ship.cargo = new CargoList();
        const design = ship.design!;
        const component = design.components[0];
        // What ProcureConstructionComponents + ProcessWaitQueue leave behind: one component in a manufacturer, one waiting.
        const manufacturer = mq.manufacturers!.find((m) => m.industry === component.industry) ?? mq.manufacturers![0];
        const target = { ...component, industry: manufacturer.industry };
        expect(listAddComponentToManufacture(mq.manufacturers!, target)).toBe(true);
        manufacturer.progress = 5;
        mq.componentWaitQueue!.push(component);
        const before = ship.cargo.items.length;

        expect(() => clearPreviousMissionRequirements(galaxy, ship)).not.toThrow();

        expect(mq.componentWaitQueue!.length).toBe(0);
        expect(manufacturer.component).toBeNull();
        expect(manufacturer.progress).toBe(0);
        expect(ship.cargo.items.length).toBe(before + 1);
        const index = ship.cargo.indexOfComponent(target.componentId, ship.empire);
        expect(index).toBeGreaterThanOrEqual(0);
        const cargo = ship.cargo.items[index];
        expect(cargo.commodityIsComponent).toBe(true);
        expect(cargo.amount).toBe(1);
        expect(cargo.reserved).toBe(1);
        // A resource lookup never matches the component entry.
        for (const c of ship.cargo.items) if (c !== cargo) expect(ship.cargo.indexOf(c.commodity, c.empire)).toBeGreaterThanOrEqual(0);
    });

    it('a colony queue returns its component to the colony cargo (parent habitat branch)', () => {
        const galaxy = cachedTickGame(gameData).galaxy;
        const colony = galaxy.empires[1].capital!;
        const mq = habitatManufacturingQueue(colony)!;
        const component = galaxy.empires[1].builtObjects.find((b) => b.design !== null)!.design!.components[0];
        const manufacturer = mq.manufacturers![0];
        manufacturer.component = component;
        mq.clear();
        const index = colony.cargo!.indexOfComponent(component.componentId, colony.empire);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(colony.cargo!.items[index].amount).toBe(1);
        expect(colony.cargo!.items[index].reserved).toBe(1);
        // A second Clear with the same component merges into the same entry (CargoList.cs 189-196).
        manufacturer.component = component;
        mq.clear();
        expect(colony.cargo!.items[colony.cargo!.indexOfComponent(component.componentId, colony.empire)].amount).toBe(2);
    });
});

describe('CargoList.Clone (CargoList.cs 767) keeps component entries', () => {
    it('clones resource and component cargo as the same kind', () => {
        const list = new CargoList();
        const empire = {};
        list.add(new Cargo(new ResourceRef(3), 10, empire, 2));
        list.add(Cargo.ofComponent({ componentId: 7 }, 4, empire, 1));
        const clone = cloneCargoList(list);
        expect(clone.items.length).toBe(2);
        expect(clone.indexOf(new ResourceRef(3), empire)).toBe(0);
        expect(clone.indexOfComponent(7, empire)).toBe(1);
        expect(clone.items[1]).not.toBe(list.items[1]);
        expect(clone.items[1].amount).toBe(4);
        expect(clone.items[1].reserved).toBe(1);
    });
});

describe('Build mission with prefabricated components (BaconBuiltObjectMission.cs 290-311)', () => {
    it('a construction ship carrying every unbuilt component of the target orders no resources for them', () => {
        const galaxy = cachedTickGame(gameData).galaxy;
        const ship = constructionShip(galaxy);
        ship.isShipYard = true;
        const empire = ship.actualEmpire!;
        const target = empire.builtObjects.find((b) => b.role === BuiltObjectRole.Base && b.components.items.length > 0)!;
        for (const c of target.components.items) c.status = ComponentStatus.Unbuilt;
        ship.cargo = new CargoList();
        for (const c of target.components.items) ship.cargo.add(Cargo.ofComponent(c.def, 1, empire));
        const contractsBefore = ship.contractsToFulfill.length;

        const m = new BuiltObjectMission(galaxy, ship, BuiltObjectMissionType.Build, target.parentHabitat ?? target, target, BuiltObjectMissionPriority.Normal, { allowBuiltObjectChanges: false });
        const cmds = m.showAllCommands();

        expect(cmds.some((c) => c.action === CommandAction.Load)).toBe(false);
        expect(ship.contractsToFulfill.length).toBe(contractsBefore);
        // The skip decrements the clone (cargoList1), never the ship's own cargo.
        for (const c of target.components.items) expect(ship.cargo.items[ship.cargo.indexOfComponent(c.componentId, empire)].amount).toBeGreaterThanOrEqual(1);
    });
});

describe('save / load of component cargo', () => {
    it('round-trips a component cargo entry, and an old save without commodityComponent loads as resource cargo', () => {
        const galaxy = cachedTickGame(gameData).galaxy;
        const colony = galaxy.empires[1].capital!;
        colony.cargo!.add(Cargo.ofComponent({ componentId: 11 }, 3, colony.empire, 1));
        const json = galaxyToJSON(galaxy);
        const loaded = galaxyFromJSON(JSON.parse(JSON.stringify(json)), gameData);
        const lcol = loaded.empires[1].capital!;
        const i = lcol.cargo!.indexOfComponent(11, lcol.empire);
        expect(i).toBeGreaterThanOrEqual(0);
        expect(lcol.cargo!.items[i].commodityComponent).toEqual({ componentId: 11 });
        expect(lcol.cargo!.items[i].amount).toBe(3);
        expect(Object.keys(lcol.cargo!.items[i])).toEqual(Object.keys(Cargo.ofComponent({ componentId: 11 }, 3, lcol.empire, 1)));

        // Strip the field from every encoded resource Cargo (a save written before component cargo existed; only the
        // null values are dropped, so no memoised object — and no back-reference index — goes missing).
        const stripped = JSON.parse(JSON.stringify(galaxyToJSON(cachedTickGame(gameData).galaxy)), (key: string, value: unknown) => (key === 'commodityComponent' && value === null ? undefined : value));
        const old = galaxyFromJSON(stripped, gameData);
        let seen = 0;
        for (const colony of old.empires[1].colonies) {
            for (const c of colony.cargo?.items ?? []) {
                expect(c.commodityComponent).not.toBeUndefined();
                if (c.commodity.resourceId >= 0) {
                    expect(c.commodityComponent).toBeNull();
                    expect(c.commodityIsResource).toBe(true);
                    ++seen;
                }
            }
        }
        expect(seen).toBeGreaterThan(0);
    }, 120000);
});
