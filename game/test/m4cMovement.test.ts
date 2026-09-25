// M4c — movement, hyperjump, fuel, energy, index upkeep (tasks/M4-plan.md §3.3 M4c).
// Unit tests against hand-worked C# values, plus a harness smoke test (freighters move and hyperjump).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame } from './helpers/tickGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { BuiltObject } from '../src/sim/builtObject';
import { TurnDirection } from '../src/sim/builtObject';
import { runGameSeconds } from '../src/sim/tick/harness';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { CommandAction } from '../src/sim/missions/mission';
import { captainBonuses } from '../src/sim/characters';
import { ComponentCategoryType } from '../src/sim/data/policies';
import { HabitatCategoryType } from '../src/sim/types';
import {
    accelerateToTargetSpeed,
    calculateCurrentHeading,
    checkFuelHandicap,
    checkWhetherArrived,
    currentRange,
    doDeployment,
    fuelUnitPerEnergyUnit,
    getCurrentTurnRate,
    isOutsideStarGravityWell,
    maximumFuelRange,
    performEnergyCollection,
    rechargeReactors,
    reviewWhetherRefuellingDepot,
    updateIndexesForMovement,
    withinFuelRange,
    withinFuelRangeWithFactor,
} from '../src/sim/movement';
import { currentRange as freightCurrentRange, withinFuelRange as freightWithinFuelRange, warpSpeedWithBonuses as freightWarp } from '../src/sim/logistics/freight';
import { MAX_SOLAR_SYSTEM_SIZE, baconMovementSettings, warpSpeedWithBonuses } from '../src/sim/movement';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

function newGalaxy(): Galaxy {
    return createTickGame(gameData).galaxy;
}

function aShip(g: Galaxy): BuiltObject {
    return (g.builtObjects as BuiltObject[]).find((b) => b.role !== BuiltObjectRole.Base && b.warpSpeed > 0 && b.empire !== null)!;
}

describe('per-frame upkeep', () => {
    it('AccelerateToTargetSpeed: float CurrentSpeed, clamps at the target', () => {
        const g = newGalaxy();
        const b = aShip(g);
        b.currentSpeed = 0;
        b.accelerationRate = Math.fround(2.5);
        b.targetSpeed = 100;
        accelerateToTargetSpeed(g, b, 0.1);
        expect(b.currentSpeed).toBe(Math.fround(0 + Math.fround(0.25)));
        accelerateToTargetSpeed(g, b, 1000);
        expect(b.currentSpeed).toBe(100);
        b.targetSpeed = 0;
        accelerateToTargetSpeed(g, b, 10);
        expect(b.currentSpeed).toBe(Math.fround(100 - 25));
        accelerateToTargetSpeed(g, b, 100);
        expect(b.currentSpeed).toBe(0);
    });

    it('CalculateCurrentHeading turns by TurnRate×dt (×3 at impulse speed) and snaps at the target', () => {
        const g = newGalaxy();
        const b = aShip(g);
        b.turnRate = Math.fround(0.2);
        b.currentSpeed = 0; // ≤ 2 × impulse → ×3
        b.heading = 0;
        b.targetHeading = Math.fround(1.0);
        const rate = getCurrentTurnRate(b);
        // turn rate ×3 at ≤ 2 × impulse speed (× captain / fleet maneuvering bonuses).
        expect(rate / (Math.fround(0.2) * 3)).toBe((captainBonuses(b)?.shipManeuvering ?? 100) / 100);
        calculateCurrentHeading(g, b, 0.1);
        // Heading += (float)(rate × dt) (right turn).
        expect(b.heading).toBe(Math.fround(0 + Math.fround(rate * 0.1)));
        expect(b.turnDirection).toBe(TurnDirection.Right);
        calculateCurrentHeading(g, b, 10);
        expect(b.heading).toBe(Math.fround(1.0));
        expect(b.turnDirection).toBe(TurnDirection.StraightAhead);
        // Left turn: the short way round across -π.
        b.heading = Math.fround(-3.0);
        b.targetHeading = Math.fround(3.0); // diff 6 > π → -2π+6 < 0 → left
        calculateCurrentHeading(g, b, 0.1);
        expect(b.turnDirection).toBe(TurnDirection.Left);
        expect(b.heading).toBeGreaterThan(-Math.PI);
        expect(b.heading).toBe(Math.fround(-3.0 - Math.fround(rate * 0.1)));
    });

    it('UpdateIndexesForMovement moves the ship between index cells and clamps into the galaxy', () => {
        const g = newGalaxy();
        const b = aShip(g);
        const old = g.resolveIndex(b.xpos, b.ypos);
        expect(g.builtObjectIndexGrid[old.x][old.y]).toContain(b);
        b.xpos = -50;
        b.ypos = 400000 * 3 + 5;
        updateIndexesForMovement(g, b, old.x, old.y, false);
        expect(b.xpos).toBe(0);
        if (old.x !== 0 || old.y !== 3) expect(g.builtObjectIndexGrid[old.x][old.y]).not.toContain(b);
        expect(g.builtObjectIndexGrid[0][3].filter((x) => x === b).length).toBe(1);
        // performIndexCheck re-adds a missing entry.
        g.builtObjectIndexGrid[0][3].splice(g.builtObjectIndexGrid[0][3].indexOf(b), 1);
        updateIndexesForMovement(g, b, 0, 3, true);
        expect(g.builtObjectIndexGrid[0][3]).toContain(b);
    });

    it('RechargeReactors converts fuel to energy up to storage, limited by fuel', () => {
        const g = newGalaxy();
        const b = aShip(g);
        b.reactorPowerOutput = 10;
        b.reactorStorageCapacity = 99;
        b.reactorCycleFuelConsumption = 2000;
        b.currentEnergy = 50;
        b.currentFuel = 100;
        const perUnit = 2000 / 1000.0 / 100.0; // 0.02
        expect(fuelUnitPerEnergyUnit(b)).toBe(perUnit);
        rechargeReactors(g, b, 2.0); // min(20, 49) = 20 energy, 0.4 fuel
        expect(b.currentEnergy).toBe(70);
        expect(b.currentFuel).toBeCloseTo(100 - 20 * perUnit, 12);
        b.currentFuel = 0.1; // only 5 energy worth
        rechargeReactors(g, b, 2.0);
        expect(b.currentFuel).toBe(0);
        expect(b.currentEnergy).toBeCloseTo(75, 9);
    });

    it('PerformEnergyCollection: stationary collectors near a star gain energy from its radiation', () => {
        const g = newGalaxy();
        const b = aShip(g);
        const star = g.systems[0].systemStar;
        expect(star.solarRadiation + star.microwaveRadiation + star.xrayRadiation).toBeGreaterThan(0);
        (b as unknown as { energyCollection: number }).energyCollection = 10;
        b.isEnergyCollector = true;
        b.currentSpeed = 0;
        b.nearestSystemStar = star;
        b.xpos = star.xpos;
        b.ypos = star.ypos;
        b.reactorStorageCapacity = 1e9;
        b.currentEnergy = 0;
        performEnergyCollection(g, b, 1.0);
        // BuiltObject.cs PerformEnergyCollection: MaxSolarSystemSize + 500, or diameter / 2 + 500 for a gas cloud star
        // (re-pinned after the SelectCreatures population gating fix (Galaxy.5.cs 1648/1785) moved galaxy generation:
        // systems[0]'s star is no longer a plain star on seed 1, so compute num per C# instead of hard-coding 23000).
        const num = (star.category === HabitatCategoryType.GasCloud ? Math.trunc(star.diameter / 2) : MAX_SOLAR_SYSTEM_SIZE) + 500.0;
        const sum = 10 * star.solarRadiation * 10.0 / 100.0 + 10 * star.microwaveRadiation * 10.0 / 100.0 + 10 * star.xrayRadiation * 10.0 / 100.0;
        expect(b.currentEnergy).toBeCloseTo(sum * ((num + 2000.0) / num), 9);
        b.currentSpeed = 1;
        const e = b.currentEnergy;
        performEnergyCollection(g, b, 1.0);
        expect(b.currentEnergy).toBe(e);
    });

    it('DoDeployment advances _DeployProgress by dt/30 (float) until deployed', () => {
        const g = newGalaxy();
        const b = aShip(g);
        const p = b as unknown as { _deployProgress: number; _isDeployed: boolean };
        p._deployProgress = Math.fround(0.01);
        doDeployment(g, b, 3.0);
        expect(p._deployProgress).toBe(Math.fround(Math.fround(0.01) + Math.fround(Math.fround(3) / 30)));
        doDeployment(g, b, 30.0);
        expect(b.isDeployed).toBe(true);
        expect(b.deployProgress).toBe(0);
    });

    it('CheckWhetherArrived: within allowance, or overshot since the last position', () => {
        const g = newGalaxy();
        const b = aShip(g);
        b.lastPositionX = 0;
        b.lastPositionY = 0;
        expect(checkWhetherArrived(g, b, 10, 0, 100, 0, 5)).toBe(false);
        expect(checkWhetherArrived(g, b, 120, 0, 100, 0, 5)).toBe(true); // passed the target
        expect(b.lastPositionX).toBe(120);
        expect(checkWhetherArrived(g, b, 99, 0, 100, 0, 5)).toBe(true);
    });

    it('ReviewWhetherRefuellingDepot: populated habitats with cargo', () => {
        const g = newGalaxy();
        const colony = g.empires[0].colonies[0];
        colony.isRefuellingDepot = false;
        reviewWhetherRefuellingDepot(g, colony);
        expect(colony.isRefuellingDepot).toBe(colony.cargo !== null);
    });
});

describe('fuel ranges (one implementation, re-exported by logistics/freight.ts)', () => {
    it('CurrentRange / MaximumFuelRange / WithinFuelRange by hand', () => {
        const g = newGalaxy();
        const b = aShip(g);
        expect(freightCurrentRange).toBe(currentRange);
        expect(freightWarp).toBe(warpSpeedWithBonuses);
        b.reactorCycleFuelConsumption = 1000;
        b.reactorStorageCapacity = 99;
        b.warpSpeedFuelBurn = 40;
        b.staticEnergyConsumption = 10;
        b.fuelCapacity = 200;
        b.currentFuel = 100;
        const perUnit = 1000 / 1000.0 / 100.0;
        const w = warpSpeedWithBonuses(b);
        expect(currentRange(b)).toBeCloseTo((100 / (50 * perUnit)) * w, 6);
        expect(currentRange(b, 0.25)).toBeCloseTo((50 / (50 * perUnit)) * w, 6);
        expect(maximumFuelRange(b)).toBeCloseTo((200 / (50 * perUnit)) * w, 6);
        const r = currentRange(b);
        expect(withinFuelRange(g, b, b.xpos + r * 0.99, b.ypos, 0)).toBe(true);
        expect(withinFuelRange(g, b, b.xpos + r * 1.01, b.ypos, 0)).toBe(false);
        const wf = withinFuelRangeWithFactor(g, b, b.xpos + r * 2, b.ypos, 0);
        expect(wf.within).toBe(false);
        expect(wf.rangeFactor).toBeCloseTo(4, 9);
        expect(freightWithinFuelRange(g, b, b.xpos + r * 2, b.ypos, 0)).toEqual(wf);
    });

    it('CheckFuelHandicap slows an empty ship and ReDefine restores it once refuelled', () => {
        const g = newGalaxy();
        const b = aShip(g);
        const top = b.topSpeed;
        const cruise = b.cruiseSpeed;
        const warp = b.warpSpeed;
        b.currentFuel = 0;
        b.currentEnergy = 0;
        checkFuelHandicap(g, b);
        expect(b._fuelHandicapped).toBe(true);
        // createGame applied the stock BaconSettings.txt (noFuel* 0.90 / 0.90 / 0.50, lines 137-139; class defaults 0.33).
        expect(b.topSpeed).toBe(Math.trunc(top * Math.fround(0.9)));
        expect(b.cruiseSpeed).toBe(Math.trunc(cruise * Math.fround(0.9)));
        expect(b.warpSpeed).toBe(Math.trunc(warp * Math.fround(0.5)));
        b.currentFuel = 10;
        checkFuelHandicap(g, b);
        expect(b._fuelHandicapped).toBe(false);
        expect(b.topSpeed).toBe(top);
        expect(b.warpSpeed).toBe(warp);
    });

    it('IsOutsideStarGravityWell: the Bacon well radius is MaxSolarSystemSize × radiation sum / 100 (× hyperdrive mitigation)', () => {
        const g = newGalaxy();
        const b = aShip(g);
        const star = g.systems.map((s) => s.systemStar).find((s) => s.solarRadiation > 0 && s.category !== HabitatCategoryType.GasCloud)!;
        const sum = star.solarRadiation + star.microwaveRadiation + star.xrayRadiation;
        let mitigation = 1.0;
        for (const c of b.components.items) {
            if (c.category === ComponentCategoryType.HyperDrive && c.value4 > 0 && c.value5 > 0) mitigation = Math.min(mitigation, c.value4 / c.value5);
        }
        const radius = 23000 * (sum / 100) * mitigation;
        // The stock BaconSettings.txt turns the wells off (useStarGravityWells=false); this checks the well geometry itself.
        baconMovementSettings.useStarGravityWells = true;
        b.nearestSystemStar = star;
        b.xpos = star.xpos + radius * 0.99;
        b.ypos = star.ypos;
        expect(isOutsideStarGravityWell(g, b)).toBe(false);
        b.xpos = star.xpos + radius * 1.01;
        expect(isOutsideStarGravityWell(g, b)).toBe(true);
        baconMovementSettings.useStarGravityWells = false;
        b.xpos = star.xpos + radius * 0.99;
        expect(isOutsideStarGravityWell(g, b)).toBe(true);
    });
});

describe('harness: ships with missions move and hyperjump', () => {
    it('freighters contracted by CheckMarketOrders travel (HyperTo exits happen) within 600 game-s', () => {
        const g = newGalaxy();
        const start = new Map((g.builtObjects as BuiltObject[]).map((b) => [b, { x: b.xpos, y: b.ypos }]));
        let exits = 0;
        const actions = new Set<CommandAction>();
        const r = runGameSeconds(g, 600, {
            onFrame: (gal) => {
                for (const b of gal.builtObjects) {
                    if (b == null) continue; // teardown null holes
                    if (b.hyperjumpJustExited) exits++;
                    const m = b.mission as { fastPeekCurrentCommand(): { action: CommandAction } | null } | null;
                    const c = m?.fastPeekCurrentCommand();
                    if (c) actions.add(c.action);
                }
            },
        });
        for (const k of Object.keys(r.todoHits)) expect(k.startsWith('M4c ')).toBe(false);
        expect(actions.has(CommandAction.HyperTo)).toBe(true);
        expect(exits).toBeGreaterThan(0);
        let farMovers = 0;
        for (const b of g.builtObjects) {
            if (b == null) continue; // teardown null holes
            const s = start.get(b);
            expect(Number.isFinite(b.xpos) && Number.isFinite(b.ypos)).toBe(true);
            const idx = g.resolveIndex(b.xpos, b.ypos);
            // An unowned ship parked at an orbiting habitat follows it without an index update: BuiltObject.2.cs 450
            // ExecuteCommands returns before UpdateIndexesForMovement when Empire == null (C# behaviour; seen from M4z6's
            // re-pinned start, a derelict at an asteroid crossing a cell edge).
            if (!b.hasBeenDestroyed && b.empire !== null) expect(g.builtObjectIndexGrid[idx.x][idx.y]).toContain(b);
            // (Ships built during the run — M4i DirectConstruction — have no start position.)
            if (s !== undefined && Math.hypot(b.xpos - s.x, b.ypos - s.y) > 100000) farMovers++;
        }
        expect(farMovers).toBeGreaterThan(0);
    }, 300000);
});
