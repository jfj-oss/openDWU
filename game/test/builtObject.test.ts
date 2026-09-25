import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createGame, type CreateGameOptions } from '../src/sim/game';
import { setGovernmentsStatic, type Empire } from '../src/sim/empire';
import { GalaxyShape } from '../src/sim/types';
import { BuiltObject } from '../src/sim/builtObject';
import { BuiltObjectComponentList, BuiltObjectComponent, ComponentStatus, toShort } from '../src/sim/builtObjectComponent';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { Design, galaxyComponentCurrentPrices } from '../src/sim/design';
import type { Galaxy } from '../src/sim/galaxy';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import { baconSettings } from '../src/sim/data/baconSettings';

// Task M3a — Design.ReDefine / CalculateCurrentPurchasePrice and BuiltObject ctor + ReDefine.
let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
    setGovernmentsStatic(gameData.governments);
}, 60000);

function opts(): CreateGameOptions {
    const s = (race: string) => ({ race, homeSystemFavourability: 'Normal' as const, proximityDistance: 'Random', startLocation: '(Random)', age: 1, techLevel: 0.5 });
    return {
        seed: 1, shape: GalaxyShape.Spiral, starCount: 300, sectorWidth: 8, sectorHeight: 8,
        systemNames: Array.from({ length: 300 }, (_, i) => `S${i}`), gameData,
        player: s('Human'), aiEmpires: [s('(Random)'), s('(Random)')],
        piratePrevalence: 1.0,
    };
}

const S = BuiltObjectSubRole;
const SHIPS = [S.Escort, S.Frigate, S.Destroyer, S.Cruiser, S.CapitalShip, S.TroopTransport, S.ExplorationShip, S.SmallFreighter, S.MediumFreighter, S.LargeFreighter, S.ColonyShip, S.PassengerShip, S.ConstructionShip, S.GasMiningShip, S.MiningShip];

function build(galaxy: Galaxy, empire: Empire) {
    return empire.designs.map((d) => {
        d.reDefine();
        const bo = new BuiltObject(d, d.name, galaxy, true);
        bo.reDefine();
        return { d, bo };
    });
}

function snapshot(galaxy: Galaxy, empire: Empire) {
    return build(galaxy, empire).map(({ d, bo }) => [
        d.name, d.subRole, d.size, d.firepowerRaw, d.warpSpeed, d.topSpeed, d.cruiseSpeed, d.fuelCapacity, d.cargoCapacity, d.shieldsCapacity, d.turnRate, d.accelerationRate, d.weapons.length,
        bo.size, bo.firepowerRaw, bo.warpSpeed, bo.topSpeed, bo.fuelCapacity, bo.cargoCapacity, bo.shieldsCapacity, bo.turnRate, bo.accelerationRate, bo.weapons.map((w) => [w.component.componentId, w.range, w.speed]), bo.purchasePrice, bo.annualSupportCostBase, bo.engineType,
    ]);
}

describe('BuiltObjectComponentList', () => {
    it('Add assigns BuiltObjectComponentId = highest + 1', () => {
        const def = gameData.components[0] as never;
        const l = new BuiltObjectComponentList();
        const a = new BuiltObjectComponent(def, ComponentStatus.Normal);
        const b = new BuiltObjectComponent(def, ComponentStatus.Unbuilt);
        b.builtObjectComponentId = 7;
        const c = new BuiltObjectComponent(def, ComponentStatus.Normal);
        l.add(a); l.add(b); l.add(c);
        expect([a.builtObjectComponentId, b.builtObjectComponentId, c.builtObjectComponentId]).toEqual([0, 7, 8]);
        expect(l.findComponentByBuiltObjectComponentId(7)).toBe(b);
        expect(toShort(40000)).toBe(40000 - 65536);
    });
});

describe('Design.ReDefine + BuiltObject (seed 1, tech 0.5)', () => {
    it('derives plausible stats per role for every empire (incl. pirates)', () => {
        const g = createGame(opts()).galaxy;
        expect(g.pirateEmpires.length).toBeGreaterThan(0);
        for (const empire of [...g.empires, ...g.pirateEmpires]) {
            const built = build(g, empire);
            expect(built.length).toBeGreaterThan(0);
            for (const { d, bo } of built) {
                expect(d.size).toBe(d.quickCalculateSize());
                expect(bo.size).toBe(d.size);
                expect(d.isPlanetDestroyer).toBe(false);
                expect(bo.isPlanetDestroyer).toBe(false);
                expect(bo.empire).toBe(empire);
                expect(bo.unbuiltComponentCount).toBe(0);
                // Ship and design ReDefine agree on the shared stats.
                expect(bo.firepowerRaw).toBe(d.firepowerRaw);
                expect(bo.warpSpeed).toBe(d.warpSpeed);
                expect(bo.topSpeed).toBe(d.topSpeed);
                expect(bo.cruiseSpeed).toBe(d.cruiseSpeed);
                expect(bo.fuelCapacity).toBe(d.fuelCapacity);
                expect(bo.shieldsCapacity).toBe(d.shieldsCapacity);
                expect(bo.isColony).toBe(d.isColony);
                expect(bo.isSpacePort).toBe(d.isSpacePort);
                expect(bo.isShipYard).toBe(d.isShipYard);
                expect(bo.weapons.length).toBe(d.weapons.length);
                // Purchase price: component prices × markup.
                const prices = galaxyComponentCurrentPrices(g);
                const sum = d.components.reduce((a, c) => a + prices[c.componentId], 0);
                const markup = empire.pirateEmpireBaseHabitat !== null ? baconSettings.shipMarkupFactorPirates : baconSettings.shipMarkupFactor;
                expect(bo.purchasePrice).toBe(sum * markup);
                expect(bo.purchasePrice).toBeGreaterThan(0);
                expect(bo.annualSupportCostBase).toBe(Math.trunc(sum));
                if (SHIPS.includes(d.subRole)) {
                    expect(d.role).not.toBe(BuiltObjectRole.Base);
                    expect(bo.fuelCapacity).toBeGreaterThan(0);
                    expect(bo.warpSpeed).toBeGreaterThan(0);
                    expect(bo.topSpeed).toBeGreaterThan(0);
                    expect(bo.accelerationRate).toBeGreaterThanOrEqual(1);
                    expect(bo.accelerationRate).toBeLessThanOrEqual(bo.topSpeed);
                }
                if (d.role === BuiltObjectRole.Base) {
                    expect(bo.warpSpeed).toBe(0);
                    // No parent habitat: bases carry 4x their cargo storage.
                    expect(bo.cargoCapacity).toBe(d.cargoCapacity * 4);
                } else {
                    expect(bo.cargoCapacity).toBe(d.cargoCapacity);
                }
                switch (d.subRole) {
                    case S.Escort:
                    case S.Frigate:
                    case S.Destroyer:
                    case S.Cruiser:
                    case S.CapitalShip:
                        expect(bo.firepowerRaw).toBeGreaterThan(0);
                        expect(bo.weapons.length).toBeGreaterThan(0);
                        expect(bo.maximumWeaponsRange).toBeGreaterThan(0);
                        expect(bo.attackRangeSquared).toBe(48000 * 48000);
                        break;
                    case S.SmallFreighter:
                    case S.MediumFreighter:
                    case S.LargeFreighter:
                        expect(d.cargoCapacity).toBeGreaterThan(0);
                        expect(bo.cargo).not.toBeNull();
                        expect(empire.freighters).toContain(bo);
                        break;
                    case S.ColonyShip:
                        expect(d.isColony).toBe(true);
                        expect(bo.isColony).toBe(true);
                        break;
                    case S.ConstructionShip:
                        expect(bo.isShipYard).toBe(true);
                        expect(empire.constructionShips).toContain(bo);
                        break;
                    case S.SmallSpacePort:
                    case S.MediumSpacePort:
                    case S.LargeSpacePort:
                        expect(d.isSpacePort).toBe(true);
                        expect(d.isShipYard).toBe(true);
                        expect(bo.isSpacePort).toBe(true);
                        expect(bo.isShipYard).toBe(true);
                        expect(bo.isFunctional).toBe(true);
                        expect(bo.dockingBays!.length).toBe(d.dockingBayCount);
                        expect(empire.constructionYards).toContain(bo);
                        // SpacePorts needs a ParentHabitat (none here).
                        expect(empire.spacePorts).not.toContain(bo);
                        break;
                }
            }
        }
    }, 60000);

    it('unbuilt ships have no working components', () => {
        const g = createGame(opts()).galaxy;
        const d = g.empires[0].designs.find((x) => x.subRole === S.Escort)!;
        const bo = new BuiltObject(d, 'x', g);
        bo.reDefine();
        expect(bo.unbuiltComponentCount).toBe(d.components.length);
        expect(bo.firepowerRaw).toBe(0);
        expect(bo.warpSpeed).toBe(0);
        expect(bo.size).toBe(d.size);
        expect(bo.weapons.length).toBe(0);
    }, 60000);

    it('design without an empire uses base component values', () => {
        const g = createGame(opts()).galaxy;
        const src = g.empires[0].designs.find((x) => x.subRole === S.Cruiser)!;
        const d = new Design('free');
        d.role = src.role;
        d.subRole = src.subRole;
        d.components = src.components.slice();
        d.reDefine();
        expect(d.size).toBe(src.size);
        expect(d.weapons.length).toBe(src.weapons.length);
        expect(d.calculateCurrentPurchasePrice(g)).toBe(src.calculateCurrentPurchasePrice(g));
    }, 60000);

    it('is deterministic and consumes no Galaxy.Rnd', () => {
        const g1 = createGame(opts()).galaxy;
        const g2 = createGame(opts()).galaxy;
        const next = vi.spyOn(g1.rnd, 'next');
        const nextDouble = vi.spyOn(g1.rnd, 'nextDouble');
        const cNext = vi.spyOn(g1.cryptoRnd, 'next');
        const a = [...g1.empires, ...g1.pirateEmpires].map((e) => snapshot(g1, e));
        expect(next).not.toHaveBeenCalled();
        expect(nextDouble).not.toHaveBeenCalled();
        expect(cNext).not.toHaveBeenCalled();
        const b = [...g2.empires, ...g2.pirateEmpires].map((e) => snapshot(g2, e));
        expect(a).toEqual(b);
        // ReDefine is idempotent.
        expect([...g1.empires, ...g1.pirateEmpires].map((e) => snapshot(g1, e))).toEqual(a);
    }, 60000);
});
