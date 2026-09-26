// M4i empire construction AI (tasks/M4-plan.md §3.3 M4i): unit tests of the ported Empire construction helpers against
// hand-worked C# expectations, plus harness smoke tests (DirectConstruction queues and builds ships; the tick reaches no
// M4i stub).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame, cachedTickGameRun } from './helpers/gameCache';
import { runGameSeconds } from '../src/sim/tick/harness';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import { empireGovernmentAttributes } from '../src/sim/empire';
import { BuiltObject } from '../src/sim/builtObject';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { ForceStructureProjection, ForceStructureProjectionList } from '../src/sim/forceStructureProjection';
import { calculateSupportCost, currentStateForceStructure } from '../src/sim/forceStructure';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { findNewestCanBuild, findNewestCanBuildFullEvaluate } from '../src/sim/designGeneration';
import { habitatConstructionQueue } from '../src/sim/construction/constructionQueue';
import {
    assignScrapMission,
    buildDefensiveBases,
    canBuildBuiltObjectBO,
    checkSafeToBuildAtLocation,
    designCalculateMaintenanceCosts,
    determineHabitatsWithBasesIncludingBuilding,
    determineMonitoringStationLocation,
    directConstruction,
    newBuiltObjectShouldBeAutomated,
    procureConstructionComponentsAtColony,
    queueMission,
    refactorForceStructureProjectionsToCosts,
    retireOldBuiltObjects,
    reviewDesignsAndRetrofit,
    reviewLatestDesigns,
} from '../src/sim/construction/empireConstruction';
import { BuiltObjectMissionPriority, BuiltObjectMissionType } from '../src/sim/missions/mission';
import { habitatManufacturingQueue } from '../src/sim/manufacturingQueue';
import { baconSettings } from '../src/sim/data/baconSettings';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

function aiEmpire(g: Galaxy): Empire {
    return g.empires.find((e) => e !== g.playerEmpire)!;
}

describe('M4i unit: construction helpers', () => {
    it('BaconDesign.CalculateMaintenanceCosts: ((int)(price / markup) + 1 + size) less savings, × government factor', () => {
        const g = cachedTickGame(gameData).galaxy;
        const e = aiEmpire(g);
        const design = findNewestCanBuild(e.designs, BuiltObjectSubRole.Escort, e)!;
        const price = design.calculateCurrentPurchasePrice(g);
        const num1 = Math.trunc(price / baconSettings.shipMarkupFactor) + 1 + baconSettings.shipMaintenanceCostPerSizeUnit * design.size;
        const leaderBonus = e.leader !== null ? e.leader.militaryShipMaintenance : 0;
        const num4 = Math.min(1.0, design.maintenanceSavings + leaderBonus / 100.0) * num1;
        const gov = empireGovernmentAttributes(e);
        const expected = (num1 - num4) * (gov !== null ? gov.maintenanceCosts : 1.0);
        expect(designCalculateMaintenanceCosts(g, design, e)).toBeCloseTo(expected, 9);
        // The Bacon formula truncates price / markup before adding 1 (CalculateSupportCost does not).
        expect(calculateSupportCost(g, e, design)).not.toBe(designCalculateMaintenanceCosts(g, design, e));
    });

    it('RefactorForceStructureProjectionsToCosts: one Rnd.Next(0, Count) per projection, within money and cashflow', () => {
        const g = cachedTickGame(gameData).galaxy;
        const e = aiEmpire(g);
        const list = new ForceStructureProjectionList();
        list.add(new ForceStructureProjection(BuiltObjectSubRole.Escort, 3, 0));
        list.add(new ForceStructureProjection(BuiltObjectSubRole.Frigate, 2, 0));
        list.add(new ForceStructureProjection(BuiltObjectSubRole.ExplorationShip, 0, 0));
        e.stateMoney = 1e9;
        const d0 = g.rnd.drawCount;
        const r = refactorForceStructureProjectionsToCosts(g, e, list, 1e9, 0, 0, true);
        expect(g.rnd.drawCount - d0).toBe(3);
        expect(r.result.totalAmount).toBe(5);
        // Cashflow check: availableRevenue below one escort's support cost → nothing.
        const escort = findNewestCanBuild(e.designs, BuiltObjectSubRole.Escort, e)!;
        const one = new ForceStructureProjectionList();
        one.add(new ForceStructureProjection(BuiltObjectSubRole.Escort, 4, 0));
        const r2 = refactorForceStructureProjectionsToCosts(g, e, one, calculateSupportCost(g, e, escort) * 2.5, 0, 0, true);
        expect(r2.result.totalAmount).toBe(2);
        // Purchase check: money for exactly one.
        e.stateMoney = escort.calculateCurrentPurchasePrice(g) * 1.5;
        const r3 = refactorForceStructureProjectionsToCosts(g, e, one, 1e9, 0, 0, false, false);
        expect(r3.result.totalAmount).toBe(1);
    });

    it('CheckSafeToBuildAtLocation: a blockaded colony is unsafe; a quiet home colony is safe', () => {
        const g = cachedTickGame(gameData).galaxy;
        const e = aiEmpire(g);
        const cap = e.capital!;
        expect(checkSafeToBuildAtLocation(g, e, cap)).toBe(true);
        cap.isBlockaded = true;
        expect(checkSafeToBuildAtLocation(g, e, cap)).toBe(false);
        expect(checkSafeToBuildAtLocation(g, e, null)).toBe(true);
    });

    it('CanBuildBuiltObject: colony ships only at a colony with ≥ 500M people; space ports never at a yard for normal empires', () => {
        const g = cachedTickGame(gameData).galaxy;
        const e = aiEmpire(g);
        const colonyDesign = findNewestCanBuildFullEvaluate(e.designs, BuiltObjectSubRole.ColonyShip, null);
        if (colonyDesign !== null) {
            const bo = new BuiltObject(colonyDesign, 'probe', g);
            expect(canBuildBuiltObjectBO(e, bo)).toBe(false);
            expect(canBuildBuiltObjectBO(e, bo, e.capital)).toBe(e.capital!.population.totalAmount >= 500000000);
        }
        const port = e.designs.find((d) => d.subRole === BuiltObjectSubRole.SmallSpacePort)!;
        expect(canBuildBuiltObjectBO(e, new BuiltObject(port, 'probe', g))).toBe(false);
        expect(canBuildBuiltObjectBO(e, new BuiltObject(port, 'probe', g), e.capital)).toBe(true);
    });

    it('NewBuiltObjectShouldBeAutomated: state ships follow NewShipsAutomated, others are always automated', () => {
        const g = cachedTickGame(gameData).galaxy;
        const e = aiEmpire(g);
        e.newShipsAutomated = false;
        expect(newBuiltObjectShouldBeAutomated(e, BuiltObjectSubRole.Frigate)).toBe(false);
        expect(newBuiltObjectShouldBeAutomated(e, BuiltObjectSubRole.SmallFreighter)).toBe(true);
    });

    it('ProcureConstructionComponents(colony): reserves colony cargo, orders the shortfall, queues every component', () => {
        const g = cachedTickGame(gameData).galaxy;
        const e = aiEmpire(g);
        const cap = e.capital!;
        const design = findNewestCanBuild(e.designs, BuiltObjectSubRole.Escort, e)!;
        const bo = new BuiltObject(design, 'probe', g);
        const mq = habitatManufacturingQueue(cap)!;
        const before = mq.componentWaitQueue!.length;
        const reservedBefore = cap.cargo!.items.reduce((s, c) => s + c.reserved, 0);
        const toOrder = procureConstructionComponentsAtColony(g, e, bo, cap);
        expect(mq.componentWaitQueue!.length - before).toBe(design.components.length);
        let need = 0;
        for (const c of design.components) for (const r of c.resourceRequirements) need += r.amount;
        const reservedAfter = cap.cargo!.items.reduce((s, c) => s + c.reserved, 0);
        expect(reservedAfter - reservedBefore).toBe(need);
        for (const c of toOrder.items) expect(c.amount).toBeGreaterThan(0);
    });

    it('QueueMission appends to SubsequentMissions for ships, never for bases', () => {
        const g = cachedTickGame(gameData).galaxy;
        const e = aiEmpire(g);
        const ship = (e.builtObjects as BuiltObject[]).find((b) => b.subRole === BuiltObjectSubRole.Escort || b.subRole === BuiltObjectSubRole.Frigate || b.subRole === BuiltObjectSubRole.ExplorationShip)!;
        const n = ship.subsequentMissions.length;
        queueMission(g, ship, BuiltObjectMissionType.Retrofit, null, null, BuiltObjectMissionPriority.Normal);
        expect(ship.subsequentMissions.length).toBe(n + 1);
        const port = e.spacePorts[0];
        queueMission(g, port, BuiltObjectMissionType.Retrofit, null, null, BuiltObjectMissionPriority.Normal);
        expect(port.subsequentMissions.length).toBe(0);
    });

    it('AssignScrapMission: a ship without warp speed is torn down at once (true); retire flag cleared', () => {
        const g = cachedTickGame(gameData).galaxy;
        const e = aiEmpire(g);
        const ship = (e.builtObjects as BuiltObject[]).find((b) => b.role !== 0 && b.topSpeed > 0)!;
        ship.retireForNextMission = true;
        const warp = ship.warpSpeed;
        ship.warpSpeed = 0;
        expect(assignScrapMission(g, e, ship)).toBe(true);
        expect(ship.retireForNextMission).toBe(false);
        ship.warpSpeed = warp;
    });

    it('DetermineHabitatsWithBasesIncludingBuilding lists the parent colony of every base of the listed kinds', () => {
        const g = cachedTickGame(gameData).galaxy;
        const e = aiEmpire(g);
        const list = determineHabitatsWithBasesIncludingBuilding(g, e, [BuiltObjectSubRole.SmallSpacePort]);
        expect(list).toContain(e.capital);
    });

    it('ReviewLatestDesigns fills LatestDesigns per design specification (FullEvaluate, no planet destroyers)', () => {
        const g = cachedTickGame(gameData).galaxy;
        const e = aiEmpire(g);
        e.latestDesigns.fill(null);
        reviewLatestDesigns(g, e);
        for (const spec of e.designSpecifications) {
            expect(e.latestDesigns[spec!.subRole]).toBe(findNewestCanBuildFullEvaluate(e.designs, spec!.subRole, null, false));
        }
    });

    it('ReviewDesignsAndRetrofit only runs when flagged, and clears both flags', () => {
        const g = cachedTickGame(gameData).galaxy;
        const e = aiEmpire(g);
        e.reviewDesignsAndRetrofitFlag = false;
        const d0 = g.rnd.drawCount;
        reviewDesignsAndRetrofit(g, e);
        expect(g.rnd.drawCount).toBe(d0);
        e.reviewDesignsAndRetrofitFlag = true;
        e.reviewDesignsAndRetrofitImportantBreakthrough = true;
        reviewDesignsAndRetrofit(g, e);
        expect(e.reviewDesignsAndRetrofitFlag).toBe(false);
        expect(e.reviewDesignsAndRetrofitImportantBreakthrough).toBe(false);
    });
});

describe('M4i harness: empire construction entry points', () => {
    it('DirectConstruction with ample funds queues state ships at the space port, pays for them, and they get built', () => {
        const g = cachedTickGame(gameData).galaxy;
        runGameSeconds(g, 60);
        // Pick an empire whose long Empire.DoTasks block (ProjectForceStructure) has already re-run: the game-start
        // CreateStateShips (Galaxy.8.cs 955) clears StateForceStructureProjections, and the per-empire timers are staggered,
        // so which empires have re-projected by t=60 depends on the galaxy (after M4u it is no longer empires[0]).
        // Since the harness models the true age-1 default (galaxy age 1, M4y), the long blocks before t=60 may already have
        // queued an empire's whole shortfall (seed 1: Sol Commonwealth), leaving DirectConstruction nothing to add: also
        // require a warship projection left unmet by the empire's current (built + queued) state force structure.
        const warships = [BuiltObjectSubRole.Escort, BuiltObjectSubRole.Frigate, BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.Cruiser, BuiltObjectSubRole.CapitalShip, BuiltObjectSubRole.Carrier];
        const e = g.empires.find((x) => (x.stateForceStructureProjections?.count ?? 0) > 0 && x.spacePorts.length > 0
            && x.stateForceStructureProjections!.diff(currentStateForceStructure(x, galaxyStarDate(g)).projections).items.some((p) => warships.includes(p.subRole) && p.amount > 0))!;
        expect(e).toBeDefined();
        e.stateMoney = 5e6;
        const q = e.spacePorts[0].constructionQueue as { constructionWaitQueue: unknown[]; constructionYards: { shipUnderConstruction: unknown }[] };
        const countBefore = e.builtObjects.length + e.privateBuiltObjects.length;
        // Since M4f, DirectPrivateConstruction may already have queued private ships (paid from private funds): only the
        // objects DirectConstruction adds are checked.
        const before = new Set<BuiltObject>([...e.builtObjects, ...e.privateBuiltObjects] as BuiltObject[]);
        directConstruction(g, e);
        const queued = ([...e.builtObjects, ...e.privateBuiltObjects] as BuiltObject[]).filter((b) => b.builtAt !== null && !before.has(b));
        expect(queued.length).toBeGreaterThan(0);
        let paid = 0;
        for (const b of queued) paid += b.purchasePrice;
        expect(e.stateMoney).toBeCloseTo(5e6 - paid, 3);
        expect(e.builtObjects.length + e.privateBuiltObjects.length).toBe(countBefore + queued.length);
        expect(q.constructionWaitQueue.length + q.constructionYards.filter((y) => y.shipUnderConstruction !== null).length).toBeGreaterThan(0);
        runGameSeconds(g, 900);
        for (const b of queued) {
            expect(b.builtAt, b.name).toBeNull();
            expect(b.unbuiltComponentCount).toBe(0);
        }
    }, 1800000);

    it('BuildDefensiveBases / RetireOldBuiltObjects / DetermineMonitoringStationLocation run on a live galaxy', () => {
        const g = cachedTickGame(gameData).galaxy;
        runGameSeconds(g, 60);
        for (const e of g.empires) {
            buildDefensiveBases(g, e);
            retireOldBuiltObjects(g, e);
            determineMonitoringStationLocation(g, e);
            expect(Array.isArray(e.monitoringHabitats)).toBe(true);
            const q = habitatConstructionQueue(e.capital!);
            expect(q).not.toBeNull();
        }
    }, 1800000);

    it('600 game-seconds of ticks reach no M4i stub', () => {
        const { run: r } = cachedTickGameRun(gameData, { seconds: 600 }); // createTickGame + runGameSeconds(g, 600), built once and cached (test/helpers/gameCache.ts)
        const m4i = Object.keys(r.todoHits).filter((k) => k.startsWith('M4i'));
        expect(m4i).toEqual([]);
    }, 1800000);
});
