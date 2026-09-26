// @slow — soak: two 1200 s construction runs (test:slow tier; see vite.config.ts testTier).
// M4h construction queues & shipyards (tasks/M4-plan.md §3.3 M4h):
// - unit tests of the ported ConstructionQueue / yard helpers against hand-worked C# values;
// - harness milestone: a ship queued at a colony (and one at a space port) is built from component cargo and joins the
//   galaxy (M4i's empire construction AI is not ported yet, so the queue entries are made by hand as
//   Empire.6.cs DirectConstruction does: AddBuiltObjectToConstruct + AddBuiltObjectToGalaxy + BuiltAt).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import { runGameSeconds } from '../src/sim/tick/harness';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { Habitat } from '../src/sim/types';
import { BuiltObject } from '../src/sim/builtObject';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { ComponentStatus } from '../src/sim/builtObjectComponent';
import { Cargo, CargoList } from '../src/sim/cargo';
import { findNewestCanBuild } from '../src/sim/designGeneration';
import type { Design } from '../src/sim/design';
import type { ComponentDefinition } from '../src/sim/componentStatic';
import {
    ConstructionQueue,
    baconReviewConstructionSpeed,
    doConstructionBuiltObject,
    habitatConstructionQueue,
    builtObjectConstructionQueue,
} from '../src/sim/construction/constructionQueue';
import { checkWhetherStillBeingBuilt, componentListDiff, yardsCountUnderConstruction } from '../src/sim/construction/constructionYard';
import { calculateCrewLevel, checkForRepairs, doRepairs } from '../src/sim/construction/repair';
import { BuiltObjectMissionType, builtObjectMission } from '../src/sim/missions/mission';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

/** Puts one of every component of `design` into `cargo` for `empire` (what M4g's manufacturing would produce). */
function stockComponents(cargo: CargoList, design: Design, empire: Empire): void {
    for (const c of design.components) cargo.add(Cargo.ofComponent(c, 1, empire));
}

function capitalOf(e: Empire): Habitat {
    return e.capital!;
}

describe('M4h unit: yards and queues', () => {
    it('ComponentList.Diff removes one match per id, walking the first list from the end', () => {
        const d = (id: number) => ({ componentId: id }) as ComponentDefinition;
        // this = [1,2,2,3], components = [2,3,3,4,2,2] → remove 3, 2, 2 (first matches) → [3,4,2]
        const r = componentListDiff([d(1), d(2), d(2), d(3)], [d(2), d(3), d(3), d(4), d(2), d(2)]);
        expect(r.map((c) => c.componentId)).toEqual([3, 4, 2]);
    });

    it('colonies and shipyards get construction queues at game start', () => {
        const g = cachedTickGame(gameData).galaxy;
        for (const e of g.empires) {
            const q = habitatConstructionQueue(capitalOf(e));
            expect(q, e.name).not.toBeNull();
            expect(q!.constructionYards!.length).toBe(1); // Redefine(Habitat): one component-94 yard
            expect(q!.constructionYards![0].componentId).toBe(94);
            expect(q!.constructionYards![0].maximumShipSize).toBe(20000);
            for (const port of e.spacePorts) expect(builtObjectConstructionQueue(port)).not.toBeNull();
            for (const cs of e.constructionShips) expect(builtObjectConstructionQueue(cs as BuiltObject)).not.toBeNull();
        }
    }, 120000);

    it('BaconConstructionQueue.ReviewConstructionSpeed for a colony: 600 × min(1, √(pop / 1e10)) × race factor', () => {
        const g = cachedTickGame(gameData).galaxy;
        const e = g.empires[0];
        const colony = capitalOf(e);
        const q = habitatConstructionQueue(colony)!;
        const pop = colony.population.totalAmount;
        let expected = Math.trunc(600.0 * Math.min(1.0, Math.sqrt(pop / 1e10)));
        const race = colony.population.dominantRace!;
        const f = race.extra?.['ConstructionSpeedFactor'];
        if (f !== undefined) expected = Math.trunc(expected * Math.max(0.3, Math.min(Number(f), 5.5)));
        const typeKey = { 1: 'Volcanic' } as Record<number, string>;
        void typeKey;
        baconReviewConstructionSpeed(q);
        // Without resource bonuses / wonders / race type factors the speed is the population term × race factor.
        if (colony.resourceBonuses.every((b) => b.effect !== 3) && !Object.keys(race.extra ?? {}).some((k) => k.startsWith('ColonyConstructionSpeedFactor'))) {
            expect(q.constructionSpeed).toBe(expected);
        }
        expect(q.constructionYards![0].constructionSpeed).toBe(q.constructionSpeed);
        expect(q.constructionSpeed).toBeGreaterThan(0);
    }, 120000);

    it('CheckWhetherStillBeingBuilt frees the yard of a destroyed builder', () => {
        const g = cachedTickGame(gameData).galaxy;
        const e = g.empires[0];
        const port = e.spacePorts[0];
        const q = builtObjectConstructionQueue(port)!;
        const design = findNewestCanBuild(e.designs, BuiltObjectSubRole.Escort, e)!;
        const ship = new BuiltObject(design, 'Test Escort', g);
        expect(q.addBuiltObjectToConstruct(ship)).toBe(true);
        ship.builtAt = port;
        q.doConstruction(g, g.nowMs); // ProcessWaitQueue moves it into the yard
        expect(yardsCountUnderConstruction(q.constructionYards!)).toBe(1);
        port.hasBeenDestroyed = true;
        checkWhetherStillBeingBuilt(g, ship);
        expect(ship.builtAt).toBeNull();
        expect(yardsCountUnderConstruction(q.constructionYards!)).toBe(0);
    }, 120000);

    it('DoRepairs repairs damaged components at 1 per DamageRepair seconds (non-military: no crew bonus)', () => {
        const g = cachedTickGame(gameData).galaxy;
        const e = g.empires[0];
        const ship = e.constructionShips[0] as BuiltObject;
        expect(calculateCrewLevel(ship)).toBe('');
        const items = ship.components.items;
        items[0].status = ComponentStatus.Damaged;
        items[1].status = ComponentStatus.Damaged;
        ship.reDefine();
        expect(ship.damagedComponentCount).toBe(2);
        const draws = g.rnd.drawCount;
        doRepairs(g, ship, 0);
        if (ship.damageRepair > 0) {
            // timePassed 0 → num5 = 0 → the clock-Random chance (0 < 0 false): nothing repaired, no Galaxy.Rnd draw.
            expect(ship.damagedComponentCount).toBe(2);
            doRepairs(g, ship, ship.damageRepair * 2 + 0.5);
            expect(ship.damagedComponentCount).toBe(0);
            expect(g.rnd.drawCount).toBe(draws + 1); // Rnd.Next(0, Components.Count)
        } else {
            doRepairs(g, ship, 1000);
            expect(ship.damagedComponentCount).toBe(2);
            expect(g.rnd.drawCount).toBe(draws);
        }
    }, 120000);

    it('CheckForRepairs queues a damaged base at its colony and flags a damaged ship for repair', () => {
        const g = cachedTickGame(gameData).galaxy;
        const e = g.empires[0];
        const port = e.spacePorts[0];
        port.components.items[0].status = ComponentStatus.Damaged;
        port.reDefine();
        checkForRepairs(g, port);
        expect(port.builtAt).toBe(port.parentHabitat);
        expect(habitatConstructionQueue(port.parentHabitat!)!.constructionWaitQueue).toContain(port);
        const ship = e.constructionShips[0] as BuiltObject;
        ship.components.items[0].status = ComponentStatus.Damaged;
        ship.reDefine();
        checkForRepairs(g, ship);
        expect(ship.repairForNextMission).toBe(true);
    }, 120000);
});

/** Queues `design` at `colony` the way Empire.6.cs DirectConstruction does, and stocks its components. */
function queueAtColony(g: Galaxy, e: Empire, colony: Habitat, design: Design, name: string): BuiltObject {
    const bo = new BuiltObject(design, name, g);
    const q = habitatConstructionQueue(colony)!;
    expect(q.addBuiltObjectToConstruct(bo)).toBe(true);
    bo.parentHabitat = colony;
    e.addBuiltObjectToGalaxy(bo, colony, false, true);
    bo.builtAt = colony;
    stockComponents(colony.cargo!, design, e);
    return bo;
}

describe('M4h milestone on the headless harness', () => {
    it('a construction ship queued at a colony is built from component cargo and joins the galaxy', () => {
        const g = cachedTickGame(gameData).galaxy;
        const e = g.empires[0];
        // M4f DirectPrivateConstruction queues private ships at the capital's space port (shared colony cargo) in the
        // Empire long block and would consume the stocked components first; this test exercises the yard alone.
        e.initiateConstruction = false;
        const colony = capitalOf(e);
        const design = findNewestCanBuild(e.designs, BuiltObjectSubRole.ConstructionShip, e, colony)!;
        expect(design).not.toBeNull();
        const bo = queueAtColony(g, e, colony, design, 'Test Builder');
        expect(g.builtObjects).toContain(bo);
        expect(e.builtObjects).toContain(bo);
        expect(bo.unbuiltComponentCount).toBe(design.components.length);
        const civBefore = e.countersBuildCivilianShipCount;
        const q = habitatConstructionQueue(colony)!;
        const r = runGameSeconds(g, 1200);
        expect(Object.keys(r.todoHits).filter((k) => k.startsWith('M4h '))).toEqual([]);
        expect(bo.unbuiltComponentCount).toBe(0);
        expect(bo.builtAt).toBeNull();
        // Since the default age-1 start the empire AI itself queues bases at the capital within this run (a space port,
        // then DefensiveBase-subrole orbital batteries via BuildDefensiveBases), so the yards need not be idle at the end:
        // only the test builder must have left the yards and the wait queue.
        expect(q.constructionYards!.some((y) => y.shipUnderConstruction === bo)).toBe(false);
        expect(q.constructionWaitQueue!.includes(bo)).toBe(false);
        // At least the test builder: since the RebuildIndexes grid port (Start.2.cs 118) the empire also completes a civilian
        // ship of its own within these 1200 s on seed 1.
        expect(e.countersBuildCivilianShipCount).toBeGreaterThanOrEqual(civBefore + 1);
        expect(e.constructionShips).toContain(bo); // ReDefine registers the finished builder
        expect(bo.parentHabitat === colony || builtObjectMission(bo.mission) !== null).toBe(true);
        // (Before the age-1 default start this also checked that the capital's component cargo was used up; at age 1
        // the capital manufactures and receives components for its own base builds during the run, so the stocked
        // units are indistinguishable from those — unbuiltComponentCount above covers the construction. M4m's variant,
        // reading the cargo the frame the builder completes, does not hold at age 1 either: components for the capital's
        // own builds are already there by then.)
        expect(Number.isFinite(bo.xpos) && Number.isFinite(bo.ypos)).toBe(true);
    }, 1800000); // 30 min: runs at a fraction of speed while other suites load the machine

    it('a warship queued at a space port is built (yard ticked as IndustrialProcessing would) and parks', () => {
        const g = cachedTickGame(gameData).galaxy;
        const e = g.empires[0];
        e.initiateConstruction = false; // see above
        const port = e.spacePorts[0];
        const design = findNewestCanBuild(e.designs, BuiltObjectSubRole.Escort, e)!;
        const bo = new BuiltObject(design, 'Test Escort', g);
        const q = builtObjectConstructionQueue(port)!;
        expect(q.addBuiltObjectToConstruct(bo)).toBe(true);
        e.addBuiltObjectToGalaxy(bo, port, false, true);
        bo.builtAt = port;
        stockComponents(port.cargo!, design, e);
        const milBefore = e.countersBuildMilitaryShipCount;
        // BuiltObject.IndustrialProcessing (M4g) runs the port's DoConstruction in its periodic (10 s) block.
        runGameSeconds(g, 1200, {
            onFrame: (galaxy, frame) => {
                if (frame % 600 === 0 && port.constructionQueue !== null) doConstructionBuiltObject(galaxy, port, galaxy.nowMs);
            },
        });
        expect(bo.unbuiltComponentCount).toBe(0);
        expect(bo.builtAt).toBeNull();
        // At least this escort (with the stock BaconSettings.txt the empire's own yards may complete another warship in 1200 s).
        expect(e.countersBuildMilitaryShipCount).toBeGreaterThanOrEqual(milBefore + 1);
        const m = builtObjectMission(bo.mission);
        // A new ship without a fleet gets a Move mission to a parking point by the port (unless its mission ran already);
        // since M4n its ThreatEvaluation (BuiltObject.1.cs 243) may already have switched it to Attack on a nearby threat, and
        // since M4u (creatures now target ships, Creature.cs 1206) FleeFromHopelessBattle may send it off on Escape, and
        // since M4f AssignMissionToBuiltObject (Empire.5.cs 1445) sends a low-fuel idle ship to refuel (SetupRefuelling), and
        // (at the age-1 default start, seed 1) its idle-warship cases give Escort / Low-priority Patrol missions (Empire.5.cs
        // 1740-1862).
        // since M4m the Escort case runs (Empire.5.cs AssignMissionToBuiltObject), so it may be escorting a civilian ship.
        // (M4q: with the seed-1 stream shifted by InvadeUnwillingColonizationTargets' NextDouble, the empire's design review
        // may already have queued the new escort for a Retrofit to a newer design.)
        expect(m === null || m.type === BuiltObjectMissionType.Move || m.type === BuiltObjectMissionType.Undefined || m.type === BuiltObjectMissionType.Attack || m.type === BuiltObjectMissionType.Escape || m.type === BuiltObjectMissionType.Refuel || m.type === BuiltObjectMissionType.Patrol || m.type === BuiltObjectMissionType.Escort || m.type === BuiltObjectMissionType.Retrofit).toBe(true);
        expect(g.builtObjects).toContain(bo);
    }, 1800000); // 30 min: runs at a fraction of speed while other suites load the machine

    it('retrofit: a queued ship swaps to the new design components', () => {
        const g = cachedTickGame(gameData).galaxy;
        const e = g.empires[0];
        const port = e.spacePorts[0];
        const q = builtObjectConstructionQueue(port)! as ConstructionQueue;
        const ship = e.constructionShips[0] as BuiltObject;
        const escort = findNewestCanBuild(e.designs, BuiltObjectSubRole.Escort, e)!;
        // Retrofit the construction ship to its own design plus nothing: no components to build or scrap → finishes at once.
        expect(q.addBuiltObjectToRetrofit(ship, ship.design)).toBe(true);
        ship.builtAt = port;
        q.doConstruction(g, g.nowMs + 60000);
        expect(ship.retrofitDesign).toBeNull();
        expect(ship.builtAt).toBeNull();
        void escort;
    }, 120000);
});
