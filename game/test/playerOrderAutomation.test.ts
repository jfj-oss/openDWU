// User deviation from DW:U: a manual order (move / attack / patrol / ...) no longer clears IsAutoControlled — only
// the explicit Automate / Unautomate toggle changes it. The order's missions are marked `playerOrdered`
// (src/sim/missions/playerOrder.ts); while one is the ship's (or its fleet's) unfinished mission the ship counts as
// manually controlled (isAiControlled false), so the empire AI leaves it alone; once it completes, automation resumes.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedScenarioGameRun, cachedTickGame } from './helpers/gameCache';
import {
    MOTHBALL_REACTIVATING, MOTHBALL_RESERVE, MOTHBALL_TRAVEL, forceMothballPhase, forceReadyDays, issueMothball, issueReactivate, mothballStatusText,
    mothballStrength, peekMothballState, reactivationDays, reviewEmpireReserve, rivalPotency, mothballPortChoices, parkingSlotPoint, detSinCos, drawnDiameter, portClearRadius, portCapacity,
} from '../src/sim/scenario/mothballing/mothballing';
import { flagshipSlot } from '../src/ui/flagshipSlots';
import { fleetFlagship, fleetFlagshipLabel, issueMakeFlagship, isFlagship } from '../src/sim/scenario/veterans/veterans';
import { compactMothballLabel, forcesOfShips, mothballForcesModel, mothballSlot } from '../src/ui/mothballSlots';
import { fleetMissionDescription, fleetMissionText } from '../src/ui/screens/fleetsList';
import { FILTER_IN_RESERVE, shipsAndBasesRows } from '../src/ui/screens/shipsAndBasesList';
import { annualStateMaintenance } from '../src/sim/forceStructure';
import { militaryPotency } from '../src/sim/diplomacyTick';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { YEAR_LENGTH } from '../src/sim/galaxyTime';
import { BEACH_ACTION, CLEANUP_ACTION, beachingState, aiBeachChoice, beachCrewStrength, beachLossPct, beachShip, beachedAt, beachedInfoLine, beachedMayFire, cleanupCost, cleanupProgress, cleanupUnavailableReason, peekBeachingState, reviewBeachingEmpire, scarOf, scarPct, startCleanup } from '../src/sim/scenario/beaching/beaching';
import { Troop, TroopList, TroopType } from '../src/sim/cargo';
import { calculateForceStrengths } from '../src/sim/combat/invasion';
import { declareWar } from '../src/sim/diplomacyTick';
import { leaveShipGroup } from '../src/sim/fleets/shipGroup';
import { buildActionMenu, type OrderMenuContext } from '../src/sim/player/orderMenu';
import { disbandTroops, setTroopsGarrisoned } from '../src/sim/player/playerOrders';
import { reviewColonyTroopGarrisonWith } from '../src/sim/troops';
import { updateIndexesForMovement } from '../src/sim/movement';
import { availableThreatActions, runThreatAction } from '../src/sim/scenario/threats/framework';
import { planetaryFacilityDefinitionsStatic } from '../src/sim/construction/facilities';
import { PlanetaryFacilityType, facilityType } from '../src/sim/researchSystem';
import type { Empire } from '../src/sim/empire';
import type { Galaxy } from '../src/sim/galaxy';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { BuiltObject } from '../src/sim/builtObject';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectMissionType, builtObjectMission, type BuiltObjectMission } from '../src/sim/missions/mission';
import { ShipGroup } from '../src/sim/fleets/shipGroup';
import { ShipActionType, createMissionShipActionAt, createShipAction } from '../src/sim/player/shipAction';
import { executeShipAction } from '../src/sim/player/executeShipAction';
import { hasActivePlayerOrder, isAiControlled } from '../src/sim/missions/playerOrder';
import { runGameSeconds } from '../src/sim/tick/harness';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import { BuiltObjectMissionPriority } from '../src/sim/missions/mission';
import { assignMission } from '../src/sim/missions/assign';
import { forceCompleteMission } from '../src/sim/fleets/shipGroup';
import {
    INTERCEPT_MIN_STRENGTH_RATIO, INTERCEPT_RESOLVE_MS, INTERCEPT_WEIGHT_ETA, WATCH_CHECK_MS, defendCandidates, forceMotion, interceptCandidates, interceptCost,
    interceptForbiddenReason, interceptForceStrength, interceptTargetStrength, issueDefendSystem, issueIntercept, predictTargetPath, processIntercepts, processSystemWatches,
    setFleetWatch, solveIntercept, systemStarOf, watchStatusText, watchUnavailableReason, type InterceptForce, type PathLeg,
} from '../src/sim/player/intercept';
import { DEFEND_ICON, interceptStrip, shortEta } from '../src/ui/interceptSlots';
import { GAME_DAY_LENGTH, scenarioEmit, scenarioQuery } from '../src/sim/scenario/hooks';
import { PirateRelationType, obtainPirateRelation } from '../src/sim/pirateRelations';
import { calculateOverallStrengthFactor } from '../src/sim/combat/threats';
import {
    borderChokepoints, hostileInterdictionStrength, interdictingBaseFor, interdictingBasesInSystem, interdictionInfoLine, interdictionRadius, interdictionRing, interdictionStateIfAny, isInterdictingBase,
} from '../src/sim/scenario/interdiction/jumpInterdiction';
import { slowSpoolFactor } from '../src/sim/scenario/hyperdrive/slowHyperdrive';

function missionOfForce(f: InterceptForce): BuiltObjectMission | null {
    return f instanceof ShipGroup ? f.mission : builtObjectMission(f.mission);
}

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

function explorer(game: Game): BuiltObject {
    const ship = game.playerEmpire.builtObjects.find((b) => b.subRole === BuiltObjectSubRole.ExplorationShip && b.builtAt === null && b.topSpeed > 0);
    expect(ship).toBeDefined();
    expect(ship!.isAutoControlled).toBe(true);
    return ship!;
}

/** A point `d` units from the ship, clamped into the galaxy. */
function pointAway(game: Game, ship: BuiltObject, d: number): { x: number; y: number } {
    const g = game.galaxy;
    const x = ship.xpos + d < g.sizeX - 1000 ? ship.xpos + d : ship.xpos - d;
    return { x: Math.trunc(x), y: Math.trunc(ship.ypos) };
}

function missionOf(ship: BuiltObject): BuiltObjectMission | null {
    return builtObjectMission(ship.mission);
}

describe('manual orders keep IsAutoControlled; the AI leaves the order alone until it is done', () => {
    it('an automated explorer ordered to move stays automated, flies the Move without being retasked, then explores again', () => {
        const game = cachedTickGame(gameData);
        const ship = explorer(game);
        expect(missionOf(ship)?.type).toBe(BuiltObjectMissionType.Explore); // the AI's own work
        const p = pointAway(game, ship, 40000);
        const r = executeShipAction(game.galaxy, game.playerEmpire, ship, createMissionShipActionAt(BuiltObjectMissionType.Move, null, p.x, p.y), true);
        expect(r.ok).toBe(true);
        // (1) the order leaves automation on
        expect(ship.isAutoControlled).toBe(true);
        const order = missionOf(ship)!;
        expect(order.type).toBe(BuiltObjectMissionType.Move);
        expect(order.playerOrdered).toBe(true);
        expect(hasActivePlayerOrder(ship)).toBe(true);
        expect(isAiControlled(ship)).toBe(false);
        // (2) the ship carries the order out across many AI ticks: the mission stays the player's Move until it is done
        const startDist = Math.hypot(ship.xpos - p.x, ship.ypos - p.y);
        let seconds = 0;
        while (seconds < 240 && missionOf(ship) === order && order.type === BuiltObjectMissionType.Move) {
            runGameSeconds(game, 1);
            seconds++;
            expect(ship.isAutoControlled).toBe(true);
            const m = missionOf(ship);
            if (m !== order) break;
        }
        expect(seconds).toBeGreaterThan(3); // several AI passes ran while the order was in progress
        const endDist = Math.hypot(ship.xpos - p.x, ship.ypos - p.y);
        expect(endDist).toBeLessThan(Math.min(2000, startDist)); // it got there (the Move was not replaced en route)
        // (3) done: automation resumes and the AI gives the explorer work again
        let t = 0;
        while (t < 120 && !(isAiControlled(ship) && (missionOf(ship)?.type ?? BuiltObjectMissionType.Undefined) !== BuiltObjectMissionType.Undefined)) {
            runGameSeconds(game, 1);
            t++;
        }
        expect(ship.isAutoControlled).toBe(true);
        expect(hasActivePlayerOrder(ship)).toBe(false);
        const next = missionOf(ship)!;
        expect(next.type).not.toBe(BuiltObjectMissionType.Undefined);
        expect(next.playerOrdered).toBeUndefined();
    }, 300000);

    it('a queued (shift) order is a player order too; the flag survives save / load', () => {
        const game = cachedTickGame(gameData);
        const ship = explorer(game);
        const p = pointAway(game, ship, 40000);
        const move = createMissionShipActionAt(BuiltObjectMissionType.Move, null, p.x, p.y);
        executeShipAction(game.galaxy, game.playerEmpire, ship, move, true);
        const q = createMissionShipActionAt(BuiltObjectMissionType.Move, null, p.x, p.y + 5000);
        q.isSubsequentAction = true;
        executeShipAction(game.galaxy, game.playerEmpire, ship, q, true);
        const queued = ship.subsequentMissions[ship.subsequentMissions.length - 1] as BuiltObjectMission;
        expect(queued.playerOrdered).toBe(true);
        expect(ship.isAutoControlled).toBe(true);
        // save / load round trip keeps the marks
        const time = new GalaxyTime();
        time.togglePause();
        time.advance(game.galaxy.nowMs);
        const text = serializeGame(game, time, { ...defaultStartGameOptions(), seed: 1 });
        const loaded = deserializeGame(text, gameData).game;
        const ship2 = loaded.playerEmpire.builtObjects.find((b) => b.name === ship.name)!;
        expect(missionOf(ship2)!.playerOrdered).toBe(true);
        expect((ship2.subsequentMissions[ship2.subsequentMissions.length - 1] as BuiltObjectMission).playerOrdered).toBe(true);
        expect(ship2.isAutoControlled).toBe(true);
        expect(isAiControlled(ship2)).toBe(false);
        // a mission the AI assigns never carries the mark (AI empires never see it)
        for (const e of loaded.galaxy.empires) {
            if (e === loaded.playerEmpire) continue;
            for (const b of e.builtObjects) expect(missionOf(b)?.playerOrdered).toBeUndefined();
        }
    }, 300000);

    it('an automated fleet ordered to move stays automated and keeps the order until it completes', () => {
        const game = cachedTickGame(gameData);
        const p = game.playerEmpire;
        const ships = p.builtObjects.filter((b) => b.role === BuiltObjectRole.Military && b.builtAt === null && b.topSpeed > 0 && b.shipGroup === null).slice(0, 2);
        expect(ships.length).toBe(2);
        const create = createShipAction(ShipActionType.CreateNewFleet, null);
        const r0 = executeShipAction(game.galaxy, p, ships, create, true);
        const fleet = r0.select as ShipGroup;
        expect(fleet).toBeInstanceOf(ShipGroup);
        for (const s of fleet.ships) expect(s.isAutoControlled).toBe(true);
        const lead = fleet.leadShip!;
        const dest = pointAway(game, lead, 40000);
        executeShipAction(game.galaxy, p, fleet, createMissionShipActionAt(BuiltObjectMissionType.Move, null, dest.x, dest.y), true);
        // (1)
        for (const s of fleet.ships) expect(s.isAutoControlled).toBe(true);
        const order = fleet.mission!;
        expect(order.type).toBe(BuiltObjectMissionType.Move);
        expect(order.playerOrdered).toBe(true);
        for (const s of fleet.ships) expect(isAiControlled(s)).toBe(false);
        // (2) the fleet mission stays the player's Move across the AI passes until it is done
        let seconds = 0;
        while (seconds < 240 && fleet.mission === order && order.type === BuiltObjectMissionType.Move) {
            runGameSeconds(game, 1);
            seconds++;
            for (const s of fleet.ships) expect(s.isAutoControlled).toBe(true);
        }
        expect(seconds).toBeGreaterThan(3);
        const lead2 = fleet.leadShip!;
        expect(Math.hypot(lead2.xpos - dest.x, lead2.ypos - dest.y)).toBeLessThan(3000);
        // (3) done: the fleet is back under automation
        // (the ships finish their own legs of the fleet Move a moment after the fleet mission completes)
        let t = 0;
        while (t < 60 && fleet.ships.some((s) => hasActivePlayerOrder(s))) {
            runGameSeconds(game, 1);
            t++;
        }
        for (const s of fleet.ships) {
            expect(s.isAutoControlled).toBe(true);
            expect(hasActivePlayerOrder(s)).toBe(false);
            expect(isAiControlled(s)).toBe(true);
        }
    }, 300000);

    it('(4) the explicit Unautomate / Automate toggle still changes IsAutoControlled, for a ship and a fleet', () => {
        const game = cachedTickGame(gameData);
        const p = game.playerEmpire;
        const ship = explorer(game);
        executeShipAction(game.galaxy, p, ship, createShipAction(ShipActionType.UnautomateShip, ship), true);
        expect(ship.isAutoControlled).toBe(false);
        expect(isAiControlled(ship)).toBe(false);
        // a manual order on an unautomated ship leaves it unautomated
        const dest = pointAway(game, ship, 20000);
        executeShipAction(game.galaxy, p, ship, createMissionShipActionAt(BuiltObjectMissionType.Move, null, dest.x, dest.y), true);
        expect(ship.isAutoControlled).toBe(false);
        executeShipAction(game.galaxy, p, ship, createShipAction(ShipActionType.AutomateShip, ship), true);
        expect(ship.isAutoControlled).toBe(true);
        // AutomateShip hands the ship straight back to the AI (its new mission is the AI's, not a player order)
        expect(missionOf(ship)?.playerOrdered).toBeUndefined();

        const ships = p.builtObjects.filter((b) => b.role === BuiltObjectRole.Military && b.builtAt === null && b.topSpeed > 0 && b.shipGroup === null).slice(0, 2);
        const fleet = executeShipAction(game.galaxy, p, ships, createShipAction(ShipActionType.CreateNewFleet, null), true).select as ShipGroup;
        executeShipAction(game.galaxy, p, fleet, createShipAction(ShipActionType.UnautomateShip, fleet), true);
        for (const s of fleet.ships) expect(s.isAutoControlled).toBe(false);
        executeShipAction(game.galaxy, p, fleet, createShipAction(ShipActionType.AutomateShip, fleet), true);
        for (const s of fleet.ships) expect(s.isAutoControlled).toBe(true);
    }, 300000);
});

// openDWU command (not in the original): Intercept / Defend / Watch system (src/sim/player/intercept.ts).
describe('Intercept, Defend and Watch system orders', () => {
    function makeFleets(game: Game): { small: ShipGroup; big: ShipGroup } {
        const p = game.playerEmpire;
        const mil = p.builtObjects.filter((b) => b.role === BuiltObjectRole.Military && b.builtAt === null && b.topSpeed > 0 && b.shipGroup === null);
        expect(mil.length).toBeGreaterThanOrEqual(3);
        const small = executeShipAction(game.galaxy, p, [mil[0]], createShipAction(ShipActionType.CreateNewFleet, null), true).select as ShipGroup;
        const big = executeShipAction(game.galaxy, p, [mil[1], mil[2]], createShipAction(ShipActionType.CreateNewFleet, null), true).select as ShipGroup;
        expect(small).toBeInstanceOf(ShipGroup);
        expect(big).toBeInstanceOf(ShipGroup);
        return { small, big };
    }
    /** The pirate warship nearest to the player's capital (in fuel range of the player's fleets). */
    function pirateShip(game: Game): BuiltObject {
        const c = game.playerEmpire.capital!;
        let best: BuiltObject | null = null;
        for (const e of game.galaxy.pirateEmpires) {
            for (const x of e.builtObjects) {
                if (x.role === BuiltObjectRole.Base || x.topSpeed <= 0 || x.warpSpeed <= 0 || x.hasBeenDestroyed) continue;
                if (best === null || Math.hypot(x.xpos - c.xpos, x.ypos - c.ypos) < Math.hypot(best.xpos - c.xpos, best.ypos - c.ypos)) best = x;
            }
        }
        if (best === null) throw new Error('no pirate ship');
        return best;
    }
    /** Distance from (x, y) to the segment of a path leg. */
    function segDist(l: PathLeg, x: number, y: number): number {
        const dx = l.x1 - l.x0;
        const dy = l.y1 - l.y0;
        const len2 = dx * dx + dy * dy;
        const f = len2 > 0 ? Math.max(0, Math.min(1, ((x - l.x0) * dx + (y - l.y0) * dy) / len2)) : 0;
        return Math.hypot(l.x0 + dx * f - x, l.y0 + dy * f - y);
    }

    it('picks the force by strength filter, ETA and smallest sufficient strength; the chosen force id is honoured', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const p = game.playerEmpire;
        const { small, big } = makeFleets(game);
        const slug = g.creatures.find((c) => !c.hasBeenDestroyed && c.currentSpeed === 0)!;
        const sSmall = interceptForceStrength(small);
        const sBig = interceptForceStrength(big);
        expect(sBig).toBeGreaterThan(sSmall);
        // A target only the big fleet can take on (strength between small / 1.5 and big / 1.5).
        slug.attackStrength = Math.trunc((sSmall / 1.5 + sBig / 1.5) / 2 / 5);
        let list = interceptCandidates(g, p, slug).filter((c) => c.isFleet);
        expect(list.map((c) => c.force)).toEqual([big]);
        for (const c of interceptCandidates(g, p, slug)) expect(c.ratio).toBeGreaterThanOrEqual(INTERCEPT_MIN_STRENGTH_RATIO);
        // A weaker target: both qualify (small at ratio 2, big at more); at about the same ETA (both fleets are at
        // home) the smaller sufficient fleet ranks first.
        slug.attackStrength = Math.max(1, Math.trunc(sSmall / 2 / 5));
        list = interceptCandidates(g, p, slug).filter((c) => c.isFleet);
        expect(list.length).toBe(2);
        for (let i = 1; i < list.length; i++) expect(list[i].score).toBeGreaterThanOrEqual(list[i - 1].score);
        expect(Math.abs(list[0].etaMs - list[1].etaMs)).toBeLessThan(5000);
        expect(list[0].force).toBe(small);
        // ETA dominates: the same force 60 s further away costs 60 more.
        expect(interceptCost(2, 70000, small.ships) - interceptCost(2, 10000, small.ships)).toBeCloseTo(60 * INTERCEPT_WEIGHT_ETA, 6);
        // smallest sufficient: more spare strength costs more at the same ETA
        expect(interceptCost(6, 10000, small.ships)).toBeGreaterThan(interceptCost(2, 10000, small.ships));
        // the command takes the chosen candidate, not only the top one
        const chosen = list[1].force;
        const r = issueIntercept(g, p, slug, chosen);
        expect(r.ok).toBe(true);
        expect(r.force).toBe(chosen);
        expect(p.intercepts!.length).toBe(1);
        expect(p.intercepts![0].force).toBe(chosen);
        // a stationary target is attacked directly
        expect(missionOfForce(chosen)?.type).toBe(BuiltObjectMissionType.Attack);
        // an empire the player is not at war with cannot be intercepted
        const other = g.empires.find((e) => e !== p && e.active && e.pirateEmpireBaseHabitat === null && e.builtObjects.length > 0)!;
        expect(interceptForbiddenReason(g, p, other.builtObjects[0])).toMatch(/Not at war/);
        expect(interceptCandidates(g, p, other.builtObjects[0])).toEqual([]);
    }, 300000);

    it('a moving target is met where it is going (lead pursuit, not trailing); the order clears when it dies', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const p = game.playerEmpire;
        const { big } = makeFleets(game);
        const target = pirateShip(game);
        // A sublight leg across the force's bow: 9000 units (under the hyperjump threshold).
        const lead = big.leadShip!;
        const ang = Math.atan2(lead.ypos - target.ypos, lead.xpos - target.xpos) + Math.PI / 2;
        const dest = { x: Math.trunc(target.xpos + Math.cos(ang) * 9000), y: Math.trunc(target.ypos + Math.sin(ang) * 9000) };
        assignMission(g, target, BuiltObjectMissionType.Move, null, null, BuiltObjectMissionPriority.Normal, { x: dest.x, y: dest.y });
        const path = predictTargetPath(g, target);
        expect(path.legs.length).toBeGreaterThan(0);
        // Our force (the fleet's real speeds, placed 2000 units off the middle of the target's course, without a
        // hyperdrive so that it must meet the target on the way rather than wait at its end point).
        const legs = path.legs.filter((l) => l.x0 !== l.x1 || l.y0 !== l.y1);
        const mid = legs[legs.length - 1];
        const mx = (mid.x0 + mid.x1) / 2;
        const my = (mid.y0 + mid.y1) / 2;
        const motion = { ...forceMotion(big), x: mx + 2000, y: my, warp: 0, cruise: 1000 };
        const sol = solveIntercept(path, motion);
        // on the target's course ...
        expect(Math.min(...path.legs.map((l) => segDist(l, sol.x, sol.y)))).toBeLessThan(1);
        // ... before its end, where we arrive when it does (not at its current position, which it has left by then)
        expect(sol.targetMs).toBeGreaterThan(0);
        expect(sol.targetMs).toBeLessThan(mid.t1);
        expect(Math.abs(sol.etaMs - sol.targetMs)).toBeLessThan(50);
        // the real fleet (far away) cannot catch it on the way: it goes to where the target is going, not after it
        const real = solveIntercept(path, forceMotion(big));
        expect(Math.hypot(real.x - path.endX, real.y - path.endY)).toBeLessThan(1);
        expect(real.etaMs).toBeGreaterThanOrEqual(real.targetMs);
        // a synthetic check of the solver: target crossing at 100/s, we sit 5000 off its line at 200/s
        const synth = solveIntercept({ legs: [{ x0: 0, y0: 0, x1: 100000, y1: 0, t0: 0, t1: 1000000 }], endX: 100000, endY: 0 }, { x: 10000, y: 5000, cruise: 200, warp: 0, initiateMs: 0 });
        const tt = synth.targetMs / 1000;
        expect(synth.y).toBe(0);
        expect(Math.hypot(synth.x - 10000, 5000)).toBeCloseTo(200 * tt, 0);
        expect(synth.x).toBeCloseTo(100 * tt, 0);
        // the order: the force flies to the intercept point, re-solved as the game runs
        const r = issueIntercept(g, p, target, big);
        expect(r.message + ' ' + interceptTargetStrength(target) + ' ' + interceptForceStrength(big)).toMatch(/sent to intercept/);
        const order = p.intercepts![0];
        expect(order.phase === 0 ? missionOfForce(big)?.type === BuiltObjectMissionType.Move : missionOfForce(big)?.type === BuiltObjectMissionType.Attack).toBe(true);
        expect(missionOfForce(big)?.playerOrdered).toBe(true);
        runGameSeconds(game, 7);
        expect(p.intercepts?.length ?? 0).toBeLessThanOrEqual(1);
        // destroyed by anyone: the order clears (and the empire's state goes back to absent)
        target.hasBeenDestroyed = true;
        g.nowMs += INTERCEPT_RESOLVE_MS;
        processIntercepts(g);
        expect(p.intercepts).toBeUndefined();
    }, 300000);

    it('a hyperjumping target is met at its jump destination, arriving no earlier than it can be there', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const { big } = makeFleets(game);
        const target = pirateShip(game);
        const far = { x: Math.trunc(Math.min(g.sizeX - 5000, Math.max(5000, target.xpos + (target.xpos < g.sizeX / 2 ? 150000 : -150000)))), y: Math.trunc(target.ypos) };
        assignMission(g, target, BuiltObjectMissionType.Move, null, null, BuiltObjectMissionPriority.High, { x: far.x, y: far.y });
        let s = 0;
        while (s < 40 && !(target.currentSpeed > target.topSpeed)) {
            runGameSeconds(game, 1);
            s++;
        }
        expect(target.currentSpeed).toBeGreaterThan(target.topSpeed);
        const path = predictTargetPath(g, target);
        expect(path.legs.length).toBeGreaterThan(0);
        expect(Math.hypot(path.endX - target.xpos, path.endY - target.ypos)).toBeGreaterThan(20000);
        const sol = solveIntercept(path, forceMotion(big));
        // in hyperspace: aimed at the jump's exit point, arriving no earlier than the target gets there
        expect(Math.hypot(sol.x - path.endX, sol.y - path.endY)).toBeLessThan(1);
        expect(sol.etaMs).toBeGreaterThanOrEqual(sol.targetMs - 1);
    }, 300000);

    it('the action-slot button: Defend / Intercept with the right-click choice of force, Watch toggle for an own fleet', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const p = game.playerEmpire;
        const { small, big } = makeFleets(game);
        const star = systemStarOf(g, p.capital!)!;
        let redraws = 0;
        const selected: unknown[] = [];
        const m = interceptStrip(g, p, { habitat: star }, (f) => selected.push(f), () => redraws++)!;
        const list = defendCandidates(g, p, star);
        expect(m.label).toBe(`Defend: ${list[0].name} · ${shortEta(list[0].etaMs)}`);
        expect(m.disabled).toBe(false);
        expect(m.icon).toBe(DEFEND_ICON);
        expect(m.hint.startsWith(`Defend: ${list[0].name} (ETA ${shortEta(list[0].etaMs)})`)).toBe(true);
        expect(m.choices.length).toBe(list.length);
        expect(m.choices[0].chosen).toBe(true);
        // pick the second force in the right-click list: it becomes the chosen one, the select button selects it
        m.choices[1].pick();
        expect(redraws).toBe(1);
        const m2 = interceptStrip(g, p, { habitat: star }, (f) => selected.push(f), () => redraws++)!;
        expect(m2.label).toContain(list[1].name);
        expect(m2.choices[1].chosen).toBe(true);
        m2.select!();
        expect(selected).toEqual([list[1].force]);
        // a planet (not a star): nothing; an empire not at war: Intercept disabled with the reason as the hint
        const planet = g.systems[star.systemIndex].habitats.find((h) => h !== star)!;
        expect(interceptStrip(g, p, { habitat: planet }, () => {}, () => {})).toBeNull();
        const other = g.empires.find((e) => e !== p && e.active && e.pirateEmpireBaseHabitat === null && e.builtObjects.length > 0)!;
        const mi = interceptStrip(g, p, { habitat: star, builtObject: other.builtObjects[0] }, () => {}, () => {})!;
        expect(mi.disabled).toBe(true);
        expect(mi.hint).toMatch(/^Intercept: Not at war/);
        // own fleet: the Watch toggle (disabled while automated, with the reason)
        const mw = interceptStrip(g, p, { habitat: star, shipGroup: small }, () => {}, () => {})!;
        expect(mw.label).toMatch(/^Watch /);
        expect(mw.disabled).toBe(true);
        expect(mw.hint).toMatch(/automation/);
        expect(mw.choices).toEqual([]);
        expect(mw.select).toBeNull();
        void big;
    }, 300000);

    it('Defend sends a force to patrol the system; a watch holds it there, refuels away and comes back; a new order ends it', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const p = game.playerEmpire;
        const { big } = makeFleets(game);
        const star = systemStarOf(g, p.capital!)!;
        expect(defendCandidates(g, p, star).length).toBeGreaterThan(0);
        const r = issueDefendSystem(g, p, star, big);
        expect(r.ok).toBe(true);
        expect([BuiltObjectMissionType.Patrol, BuiltObjectMissionType.Move]).toContain(big.mission?.type);
        expect(big.mission?.playerOrdered).toBe(true);
        // watch: needs automation off
        expect(watchUnavailableReason(g, p, big)).toMatch(/automation/);
        expect(setFleetWatch(g, p, big, true)).toBe(false);
        executeShipAction(g, p, big, createShipAction(ShipActionType.UnautomateShip, big), true);
        expect(setFleetWatch(g, p, big, true)).toBe(true);
        expect(big.watch?.system).toBe(star);
        expect(watchStatusText(big)).toBe(`Watching ${star.name}`);
        // the watch survives save / load (saved only while set)
        const loaded = deserializeGame(serializeGame(game, new GalaxyTime(), { ...defaultStartGameOptions(), seed: 1 }), gameData).game;
        const lf = loaded.playerEmpire.shipGroups.find((x) => (x as ShipGroup | null)?.name === big.name) as ShipGroup;
        expect(lf.watch?.system.name).toBe(star.name);
        // low on fuel: off to refuel, then back to the watch
        for (const b of big.ships) b.currentFuel = b.fuelCapacity * 0.1;
        g.nowMs += WATCH_CHECK_MS;
        processSystemWatches(g);
        expect(big.mission?.type).toBe(BuiltObjectMissionType.Refuel);
        expect(watchStatusText(big)).toMatch(/refuelling/);
        for (const b of big.ships) b.currentFuel = b.fuelCapacity;
        forceCompleteMission(g, big);
        g.nowMs += WATCH_CHECK_MS;
        processSystemWatches(g);
        expect(big.watch?.system).toBe(star);
        expect([BuiltObjectMissionType.Patrol, BuiltObjectMissionType.Move]).toContain(big.mission?.type);
        // a new manual order ends the watch
        const dest = pointAway(game, big.leadShip!, 30000);
        executeShipAction(g, p, big, createMissionShipActionAt(BuiltObjectMissionType.Move, null, dest.x, dest.y), true);
        g.nowMs += WATCH_CHECK_MS;
        processSystemWatches(g);
        expect(big.watch).toBeUndefined();
        // automation on also ends it
        expect(setFleetWatch(g, p, big, true)).toBe(true);
        executeShipAction(g, p, big, createShipAction(ShipActionType.AutomateShip, big), true);
        g.nowMs += WATCH_CHECK_MS;
        processSystemWatches(g);
        expect(big.watch).toBeUndefined();
    }, 300000);
});

// Defensive jump interdiction (scenarios/jump-interdiction, flag jumpInterdiction; scenario/interdiction): armed bases
// lengthen hostile ships' jump spool out of their field; intercept ETAs, pirate raids and AI base sites weigh it.
describe('Defensive jump interdiction add-on', () => {
    let jg: Game;
    beforeAll(() => {
        jg = cachedScenarioGameRun(gameData, { scenario: 'jump-interdiction' }).game;
    }, 300000);

    /** An AI empire's armed space port, a pirate warship (made hostile to it) parked 1000 from it, and a friendly ship. */
    function setup(): { base: BuiltObject; pirate: BuiltObject; own: BuiltObject } {
        const g = jg.galaxy;
        const base = g.builtObjects.find((b) => isInterdictingBase(g, b) && b.empire !== g.playerEmpire && b.empire!.pirateEmpireBaseHabitat === null && b.empire!.builtObjects.some((s) => s.role === BuiltObjectRole.Military && s.warpSpeed > 0))!;
        expect(base).toBeDefined();
        const pirate = g.pirateEmpires.flatMap((p) => p.builtObjects).find((b) => b.role === BuiltObjectRole.Military && b.warpSpeed > 0 && !b.hasBeenDestroyed)!;
        expect(pirate).toBeDefined();
        obtainPirateRelation(pirate.empire!, base.empire!).type = PirateRelationType.None;
        const own = base.empire!.builtObjects.find((s) => s.role === BuiltObjectRole.Military && s.warpSpeed > 0)!;
        const star = g.systems[base.parentHabitat!.systemIndex].systemStar;
        for (const s of [pirate, own]) {
            s.xpos = base.xpos + 1000;
            s.ypos = base.ypos;
            s.nearestSystemStar = star;
        }
        return { base, pirate, own };
    }

    it('field radius: 4000, up to +50% with firepower (full at 400); unarmed or unbuilt bases project none', () => {
        const g = jg.galaxy;
        const { base } = setup();
        const fp = base.firepowerRaw;
        expect(fp).toBeGreaterThan(0);
        expect(interdictionRadius(g, base)).toBeCloseTo(4000 * (1 + 0.5 * Math.min(1, fp / 400)), 6);
        base.firepowerRaw = 200;
        expect(interdictionRadius(g, base)).toBeCloseTo(5000, 6);
        base.firepowerRaw = 2000;
        expect(interdictionRadius(g, base)).toBeCloseTo(6000, 6);
        base.firepowerRaw = 0;
        expect(isInterdictingBase(g, base)).toBe(false);
        base.firepowerRaw = fp;
        expect(interdictionInfoLine(g, base)).toBe(`Interdiction field: ${Math.round(interdictionRadius(g, base))}`);
    });

    it('5x (total) spool for hostile ships only, in the field; moving out of it restores the stock spool', () => {
        const g = jg.galaxy;
        const { base, pirate, own } = setup();
        expect(interdictingBaseFor(g, pirate)).toBe(base);
        expect(interdictingBaseFor(g, own)).toBeNull(); // friendly
        expect(interdictionInfoLine(g, pirate)).toBe(`Interdicted by ${base.name}: jump spool 5×`);
        expect(interdictionInfoLine(g, own)).toBeNull();
        // a protected pirate is not held back
        obtainPirateRelation(pirate.empire!, base.empire!).type = PirateRelationType.Protection;
        expect(interdictingBaseFor(g, pirate)).toBeNull();
        obtainPirateRelation(pirate.empire!, base.empire!).type = PirateRelationType.None;
        // outside the radius: not held back
        pirate.xpos = base.xpos + interdictionRadius(g, base) + 10;
        expect(interdictingBaseFor(g, pirate)).toBeNull();
        pirate.xpos = base.xpos + 1000;
        // the cmdHyperTo query: the first execution: 5x the stock roll in total (12 s here) ...
        const t0 = galaxyStarDate(g);
        const stock = 12000;
        const st0 = interdictionStateIfAny(g)?.stats.interdicted ?? 0;
        let c = scenarioQuery(g, 'hyperjumpCountdown', t0 + stock, { ship: pirate, starDate: t0, spoolStart: t0, spoolMs: stock });
        expect(c).toBe(t0 + 5 * stock);
        expect(scenarioQuery(g, 'hyperjumpCountdown', t0 + stock, { ship: own, starDate: t0, spoolStart: t0, spoolMs: stock })).toBe(t0 + stock);
        const st = interdictionStateIfAny(g)!;
        expect(st.stats.interdicted).toBe(st0 + 1);
        // ... held while it stays in the field (even when something else, e.g. move-together, lowered it) ...
        c = scenarioQuery(g, 'hyperjumpCountdown', t0 + stock, { ship: pirate, starDate: t0 + 5000, spoolStart: 0, spoolMs: -1 });
        expect(c).toBe(t0 + 5 * stock);
        // ... and back to the stock spool once it has cruised out of the field
        pirate.xpos = base.xpos + 7000;
        c = scenarioQuery(g, 'hyperjumpCountdown', c, { ship: pirate, starDate: t0 + 6000, spoolStart: 0, spoolMs: -1 });
        expect(c).toBe(t0 + stock);
        expect(st.stats.escaped).toBeGreaterThanOrEqual(1);
        expect(st.spools.some((e) => e.ship === pirate)).toBe(false);
    });

    it('a real jump out of the field spools 5x (cmdHyperTo), then the ship jumps', () => {
        const g = jg.galaxy;
        const { pirate } = setup();
        const far = pointAway(jg, pirate, 400000);
        assignMission(g, pirate, BuiltObjectMissionType.Move, null, null, BuiltObjectMissionPriority.High, { x: far.x, y: far.y });
        pirate.isAutoControlled = false;
        runGameSeconds(jg, 1);
        const e = interdictionStateIfAny(g)!.spools.find((s) => s.ship === pirate);
        expect(e).toBeDefined();
        expect(pirate.hyperjumpCountdown).toBe(e!.start + 5 * e!.stock);
        expect(pirate.currentSpeed).toBeLessThanOrEqual(pirate.topSpeed); // still spooling
        // past the stock spool: still held in the field (it cruises meanwhile, well short of the field's edge)
        const x0 = pirate.xpos;
        const y0 = pirate.ypos;
        runGameSeconds(jg, e!.stock / 1000 + 1);
        expect(pirate.currentSpeed).toBeLessThanOrEqual(pirate.topSpeed);
        expect(Math.hypot(pirate.xpos - x0, pirate.ypos - y0)).toBeLessThan(2000);
        // after the 5x spool it jumps
        runGameSeconds(jg, (4 * e!.stock) / 1000 + 2);
        expect(Math.hypot(pirate.xpos - x0, pirate.ypos - y0)).toBeGreaterThan(20000);
    }, 300000);

    it('intercept ETA: an interdicted target waits 5x its jump initiation before warping', () => {
        const g = jg.galaxy;
        const { pirate, base } = setup();
        const far = pointAway(jg, pirate, 400000);
        assignMission(g, pirate, BuiltObjectMissionType.Move, null, null, BuiltObjectMissionPriority.High, { x: far.x, y: far.y });
        // (an earlier test may have left it spooling / in hyperspace: a jump not yet started)
        pirate.firstExecutionOfCommand = true;
        pirate.currentSpeed = 0;
        const wait = (): number => predictTargetPath(g, pirate).legs.find((l) => l.x0 === l.x1 && l.y0 === l.y1)?.t1 ?? 0;
        const init = Math.max(0, pirate.hyperjumpInitiate) * 1000;
        expect(init).toBeGreaterThan(0);
        expect(wait()).toBeCloseTo(5 * init, 6);
        expect(scenarioQuery(g, 'hyperjumpSpoolFactor', 1, { ship: pirate, here: true })).toBe(5);
        // a force in the field spools longer too
        expect(forceMotion(pirate, g).initiateMs).toBeCloseTo(5 * init, 6);
        expect(forceMotion(pirate).initiateMs).toBeCloseTo(init, 6);
        expect(scenarioQuery(g, 'hyperjumpSpoolFactor', 1, { ship: pirate, here: false })).toBe(1); // elsewhere: stock
        pirate.xpos = base.xpos + 9000;
        expect(wait()).toBeCloseTo(init, 6);
    });

    it('Slower hyperdrive spool: every ship 3x; an interdicted one 5x in total (not 15x); escaping restores 3x', () => {
        const g = jg.galaxy;
        const { base, pirate, own } = setup();
        g.scenario!.flags.slowHyperdrive = true;
        try {
            expect(slowSpoolFactor(g)).toBe(3);
            expect(scenarioQuery(g, 'hyperjumpSpoolFactor', 1, { ship: own, here: true })).toBe(3); // friendly: slow only
            expect(scenarioQuery(g, 'hyperjumpSpoolFactor', 1, { ship: pirate, here: true })).toBe(5); // interdicted: total 5
            expect(scenarioQuery(g, 'hyperjumpSpoolFactor', 1, { ship: pirate, here: false })).toBe(3);
            const t0 = galaxyStarDate(g);
            const stock = 10000;
            let c = scenarioQuery(g, 'hyperjumpCountdown', t0 + 5 * stock, { ship: pirate, starDate: t0, spoolStart: t0, spoolMs: stock });
            expect(c).toBe(t0 + 5 * stock);
            pirate.xpos = base.xpos + 7000;
            c = scenarioQuery(g, 'hyperjumpCountdown', c, { ship: pirate, starDate: t0 + 1000, spoolStart: 0, spoolMs: -1 });
            expect(c).toBe(t0 + 3 * stock); // out of the field: the slow 3x, not stock
            // intercept: the own ship's later legs and its force motion use 3x; the interdicted pirate 5x where it is
            pirate.xpos = base.xpos + 1000;
            const init = Math.max(0, own.hyperjumpInitiate) * 1000;
            expect(forceMotion(own, g).initiateMs).toBeCloseTo(3 * init, 6);
            expect(forceMotion(pirate, g).initiateMs).toBeCloseTo(5 * Math.max(0, pirate.hyperjumpInitiate) * 1000, 6);
            // a real jump of the friendly ship: its countdown is 3x the stock roll (initiate ±1 s)
            const far = pointAway(jg, own, 400000);
            assignMission(g, own, BuiltObjectMissionType.Move, null, null, BuiltObjectMissionPriority.High, { x: far.x, y: far.y });
            own.isAutoControlled = false;
            own.firstExecutionOfCommand = true;
            const start = galaxyStarDate(g);
            runGameSeconds(jg, 1);
            const left = own.hyperjumpCountdown - start;
            expect(left).toBeGreaterThanOrEqual(3 * (init - 1000) - 1);
            expect(left).toBeLessThanOrEqual(3 * (init + 1000) + 1000);
            expect(interdictionStateIfAny(g)!.spools.some((e) => e.ship === own)).toBe(false);
        } finally {
            g.scenario!.flags.slowHyperdrive = false;
        }
        expect(slowSpoolFactor(g)).toBe(1);
        expect(scenarioQuery(g, 'hyperjumpSpoolFactor', 1, { ship: own, here: true })).toBe(1);
    }, 300000);

    it('AI: pirate raids into a defended system need 1.5x the bases; AI empires add border colonies for bases', () => {
        const g = jg.galaxy;
        const { base, pirate } = setup();
        const h = base.parentHabitat!;
        const s = hostileInterdictionStrength(g, pirate.empire!, h.systemIndex);
        expect(s).toBeGreaterThanOrEqual(calculateOverallStrengthFactor(base));
        expect(scenarioQuery(g, 'raidRequiredStrength', 10, { empire: pirate.empire!, habitat: h })).toBeCloseTo(Math.max(10, 1.5 * s), 6);
        expect(scenarioQuery(g, 'raidRequiredStrength', 1e9, { empire: pirate.empire!, habitat: h })).toBe(1e9);
        // an undefended system: unchanged
        const bare = g.habitats.find((x) => interdictingBasesInSystem(g, x.systemIndex).length === 0)!;
        expect(scenarioQuery(g, 'raidRequiredStrength', 10, { empire: pirate.empire!, habitat: bare })).toBe(10);
        // border chokepoints: the own colony nearest each war enemy (one by default; pirates do not count)
        const ai = g.empires.find((e) => e !== g.playerEmpire && e.pirateEmpireBaseHabitat === null && e.colonies.length >= 2 && (e.diplomaticRelations?.length ?? 0) > 0);
        expect(borderChokepoints(g, ai ?? g.playerEmpire!, 1).length).toBe(0); // no wars at the start
        if (ai !== undefined) {
            const rel = [...ai.diplomaticRelations!].find((r) => r.otherEmpire !== null && r.otherEmpire.colonies.length > 0 && r.otherEmpire.pirateEmpireBaseHabitat === null)!;
            const was = rel.type;
            rel.type = DiplomaticRelationType.War;
            const picks = borderChokepoints(g, ai, 1);
            expect(picks.length).toBe(1);
            expect(ai.colonies).toContain(picks[0]);
            const locations: unknown[] = [];
            scenarioEmit(g, 'defensiveBaseLocations', { empire: ai, locations });
            expect(locations).toEqual(picks);
            rel.type = was;
        }
    });

    it('toggle off: every hook returns the stock value', () => {
        const g = jg.galaxy;
        const { pirate, base } = setup();
        const on = g.scenario!.flags.jumpInterdiction;
        g.scenario!.flags.jumpInterdiction = false;
        try {
            const t0 = galaxyStarDate(g);
            expect(scenarioQuery(g, 'hyperjumpCountdown', t0 + 12000, { ship: pirate, starDate: t0, spoolStart: t0, spoolMs: 12000 })).toBe(t0 + 12000);
            expect(scenarioQuery(g, 'hyperjumpSpoolFactor', 1, { ship: pirate, here: true })).toBe(1);
            expect(scenarioQuery(g, 'raidRequiredStrength', 10, { empire: pirate.empire!, habitat: base.parentHabitat! })).toBe(10);
            expect(interdictionInfoLine(g, pirate)).toBeNull();
            expect(interdictionRing(g, base)).toBeNull();
        } finally {
            g.scenario!.flags.jumpInterdiction = on;
        }
        // the stock game: no scenario, nothing saved
        const stock = cachedTickGame(gameData).galaxy;
        expect(stock.scenario).toBeNull();
        expect(scenarioQuery(stock, 'hyperjumpSpoolFactor', 1, { ship: pirate, here: true })).toBe(1);
    }, 300000);
});

describe('Mothballing add-on: reserve at a space port', () => {
    function playerWarships(game: Game): BuiltObject[] {
        return game.playerEmpire.builtObjects.filter((b) => b.role === BuiltObjectRole.Military && b.builtAt === null && b.topSpeed > 0 && b.shipGroup === null);
    }
    /** Runs the game in 5 s steps until `done` (at most `maxSeconds`). */
    function runUntil(game: Game, done: () => boolean, maxSeconds: number): void {
        for (let t = 0; t < maxSeconds && !done(); t += 5) runGameSeconds(game, 5);
    }

    it('the trip, the reserve (upkeep cut, no orders, not an Intercept / Defend force), save / load and the reactivation timer', () => {
        const run = cachedScenarioGameRun(gameData, { scenario: 'mothballing' });
        const game = run.game;
        const g = game.galaxy;
        const p = game.playerEmpire;
        const mil = playerWarships(game);
        expect(mil.length).toBeGreaterThanOrEqual(2);
        const fleet = executeShipAction(g, p, [mil[0], mil[1]], createShipAction(ShipActionType.CreateNewFleet, null), true).select as ShipGroup;
        const fleetShips = fleet.ships.slice();
        // the port list: every own space port, best first (rooms first, then interior safety minus a share of the trip)
        const choices = mothballPortChoices(g, p, fleet);
        expect(choices.length).toBe(p.spacePorts.filter((x) => !x.hasBeenDestroyed).length);
        for (let i = 1; i < choices.length; i++) if (choices[i].full === null) expect(choices[i - 1].score).toBeGreaterThanOrEqual(choices[i].score);
        for (const c of choices) {
            expect(c.capacity).toBe(c.port.subRole === BuiltObjectSubRole.LargeSpacePort ? 24 : c.port.subRole === BuiltObjectSubRole.MediumSpacePort ? 12 : 6);
            expect(c.score).toBeCloseTo(c.safety - 0.25 * c.distance, 6);
        }
        const port = choices[0].port;
        expect(port).toBeDefined();
        const star = systemStarOf(g, p.capital!)!;
        expect(defendCandidates(g, p, star).some((c) => c.force === fleet)).toBe(true);
        const fullCost = fleet.ships.map((b) => b.annualSupportCost);
        const fullState = annualStateMaintenance(p);
        // send it off a little first, so it has a trip to make
        const away = pointAway(game, fleet.leadShip!, 20000);
        executeShipAction(g, p, fleet, createMissionShipActionAt(BuiltObjectMissionType.Move, null, away.x, away.y), true);
        runUntil(game, () => Math.hypot(fleet.leadShip!.xpos - port.xpos, fleet.leadShip!.ypos - port.ypos) > 8000, 120);
        const r = issueMothball(g, p, fleet, null);
        expect(r.ok).toBe(true);
        expect(forceMothballPhase(fleet)).toBe(MOTHBALL_TRAVEL);
        expect(fleet.mission?.type).toBe(BuiltObjectMissionType.Move);
        expect(mothballStatusText(g, fleet)).toBe(`To reserve at ${port.name}`);
        // on its way: full upkeep (prices drift a little with the economy), already no Intercept / Defend force
        fleet.ships.forEach((b, i) => expect(Math.abs(b.annualSupportCost - fullCost[i])).toBeLessThanOrEqual(fullCost[i] * 0.03 + 1));
        expect(defendCandidates(g, p, star).some((c) => c.force === fleet)).toBe(false);
        runUntil(game, () => forceMothballPhase(fleet) === MOTHBALL_RESERVE, 300);
        expect(forceMothballPhase(fleet)).toBe(MOTHBALL_RESERVE);
        expect(mothballStatusText(g, fleet)).toBe(`In reserve at ${port.name}`);
        // a ship the AI sent to top the fleet up leaves it again at the next daily review
        runGameSeconds(game, 4);
        expect(fleet.ships.length).toBe(2);
        for (const b of fleet.ships) expect(b.mothball?.phase).toBe(MOTHBALL_RESERVE);
        for (const b of fleet.ships) expect(Math.hypot(b.xpos - port.xpos, b.ypos - port.ypos)).toBeLessThan(2500);
        // upkeep: 15 % of the full cost (one factor on BuiltObject.AnnualSupportCost), and the treasury charge drops
        fleet.ships.forEach((b, i) => expect(Math.abs(b.annualSupportCost - fullCost[i] * 0.15)).toBeLessThanOrEqual(fullCost[i] * 0.15 * 0.03 + 1));
        expect(annualStateMaintenance(p)).toBeLessThan(fullState);
        // no orders: a player move is refused, Intercept / Defend never pick it
        const before = fleet.mission;
        executeShipAction(g, p, fleet, createMissionShipActionAt(BuiltObjectMissionType.Move, null, away.x, away.y), true);
        expect(fleet.mission).toBe(before);
        expect(defendCandidates(g, p, star).some((c) => c.force === fleet)).toBe(false);
        expect(watchUnavailableReason(g, p, fleet)).not.toBeNull();
        runGameSeconds(game, 20);
        for (const b of fleet.ships) expect(Math.hypot(b.xpos - port.xpos, b.ypos - port.ypos)).toBeLessThan(2500);
        // save / load keeps the reserve
        const start = { ...defaultStartGameOptions(), seed: 1, scenario: { id: 'mothballing', flags: {}, params: {} } };
        const loaded = deserializeGame(serializeGame(game, new GalaxyTime(), start), run.gameData).game;
        const lf = loaded.playerEmpire.shipGroups.find((x) => (x as ShipGroup | null)?.name === fleet.name) as ShipGroup;
        expect(forceMothballPhase(lf)).toBe(MOTHBALL_RESERVE);
        expect(lf.ships[0].mothball?.port.name).toBe(port.name);
        expect(peekMothballState(loaded.galaxy)?.ships.length).toBe(2);
        expect(lf.ships.map((b) => b.name)).toEqual(fleetShips.map((b) => b.name));
        // parked on the ring around the port, facing it
        const spacing = peekMothballState(g)!.spacing!.get(port)!;
        for (const b of fleet.ships) {
            const pt = parkingSlotPoint(b.mothball!.slot!, portClearRadius(port), spacing);
            // on its slot (re-placed daily as the port orbits)
            expect(Math.hypot(b.xpos - (port.xpos + pt.dx), b.ypos - (port.ypos + pt.dy))).toBeLessThan(50);
            const dx = port.xpos - b.xpos;
            const dy = port.ypos - b.ypos;
            const d = Math.hypot(dx, dy);
            expect(Math.cos(b.heading) * (dx / d) + Math.sin(b.heading) * (dy / d)).toBeGreaterThan(0.9999);
        }
        expect(new Set(fleet.ships.map((b) => b.mothball!.slot)).size).toBe(2);
        // nothing overlaps: the centres are at least half the two drawn diameters (sqrt(size * 8)) apart; the fleet sits side by side
        const [sa, sb] = fleet.ships;
        expect(Math.hypot(sa.xpos - sb.xpos, sa.ypos - sb.ypos)).toBeGreaterThanOrEqual((drawnDiameter(sa.size) + drawnDiameter(sb.size)) / 2);
        expect(Math.abs(sa.mothball!.slot! - sb.mothball!.slot!)).toBe(1);
        // the Fleets and Ships screens: the Mission cell shows the reserve, the filter lists it, the button reactivates
        expect(fleetMissionDescription(fleet)).toBe(`Reserve (${port.name})`);
        expect(fleetMissionText(fleet)).toBe(`Reserve (${port.name})`);
        const shipRows = shipsAndBasesRows(p, null, FILTER_IN_RESERVE);
        expect(shipRows.map((r) => r.builtObject)).toEqual(expect.arrayContaining(fleetShips));
        for (const r of shipRows) if (fleetShips.includes(r.builtObject!)) expect(r.mission).toBe(`Reserve (${port.name})`);
        const forces = forcesOfShips(p, fleetShips);
        expect(forces).toEqual([fleet]);
        const model = mothballForcesModel(g, p, forces)!;
        expect(compactMothballLabel(model)).toEqual({ label: 'Reactivate', minor: `${Math.max(...fleet.ships.map((b) => reactivationDays(g, b)))} d` });
        const other = playerWarships(game).find((b) => b.mothball === undefined)!;
        const mixed = mothballForcesModel(g, p, [fleet, other])!;
        expect(mixed.disabled).toBe(true);
        expect(mixed.hint).toMatch(/mixes/);
        const single = mothballSlot(g, p, { builtObject: other })!;
        expect(single.label).toMatch(/^Mothball at /);
        expect(single.choices.length).toBe(mothballPortChoices(g, p, other).length);
        expect(single.choices.filter((c) => c.chosen).length).toBe(1);
        // reactivation: size-scaled days at full upkeep, then back to normal
        expect(issueReactivate(g, p, fleet).ok).toBe(true);
        expect(forceMothballPhase(fleet)).toBe(MOTHBALL_REACTIVATING);
        const days = Math.max(...fleet.ships.map((b) => reactivationDays(g, b)));
        // 240 days for a ship of size 400, scaled by size between 50 % and 200 % (120 to 480 days)
        expect(reactivationDays(g, { size: 400 } as BuiltObject)).toBe(240);
        expect(reactivationDays(g, { size: 50 } as BuiltObject)).toBe(120);
        expect(reactivationDays(g, { size: 5000 } as BuiltObject)).toBe(480);
        expect(days).toBeGreaterThanOrEqual(120);
        expect(days).toBeLessThanOrEqual(480);
        expect(forceReadyDays(g, fleet)).toBe(days);
        expect(mothballStatusText(g, fleet)).toBe(`Reactivating: ${days} days`);
        fleet.ships.forEach((b, i) => expect(Math.abs(b.annualSupportCost - fullCost[i])).toBeLessThanOrEqual(fullCost[i] * 0.03 + 1));
        const t0 = galaxyStarDate(g);
        // save / load in the middle of the reactivation: the same fleet (name, ships, slots), still reactivating, same ready dates
        runGameSeconds(game, 30);
        const mid = deserializeGame(serializeGame(game, new GalaxyTime(), start), run.gameData).game;
        const mf = mid.playerEmpire.shipGroups.find((x) => (x as ShipGroup | null)?.name === fleet.name) as ShipGroup;
        expect(forceMothballPhase(mf)).toBe(MOTHBALL_REACTIVATING);
        expect(mf.ships.map((b) => b.name)).toEqual(fleetShips.map((b) => b.name));
        expect(mf.ships.map((b) => b.mothball!.slot)).toEqual(fleet.ships.map((b) => b.mothball!.slot));
        expect(mf.ships.map((b) => b.mothball!.readyAt)).toEqual(fleet.ships.map((b) => b.mothball!.readyAt));
        expect(mid.playerEmpire.shipGroups.indexOf(mf)).toBe(p.shipGroups.indexOf(fleet));
        runUntil(game, () => forceMothballPhase(fleet) < 0, Math.ceil(((days + 5) * GAME_DAY_LENGTH) / 1000));
        expect(forceMothballPhase(fleet)).toBe(-1);
        // back as the same fleet: same object, name and ships
        expect(fleet.ships.length).toBeGreaterThanOrEqual(1);
        for (const b of fleetShips) expect(b.hasBeenDestroyed || b.shipGroup === fleet || b.shipGroup === null).toBe(true);
        expect(p.shipGroups.includes(fleet)).toBe(true);
        expect(galaxyStarDate(g) - t0).toBeGreaterThanOrEqual((days - 1) * GAME_DAY_LENGTH);
        // back to normal: automation as before the reserve, missions accepted again
        for (const b of [mil[0], mil[1]]) {
            expect(b.mothball).toBeUndefined();
            expect(b.isAutoControlled).toBe(true);
        }
        executeShipAction(g, p, [mil[0]], createMissionShipActionAt(BuiltObjectMissionType.Move, null, away.x, away.y), true);
        expect(builtObjectMission(mil[0].mission)?.type).toBe(BuiltObjectMissionType.Move);
        // a lone warship: in reserve at once when it is already at the port
        const lone = mil[2] ?? null;
        if (lone !== null) {
            lone.xpos = port.xpos;
            lone.ypos = port.ypos;
            expect(issueMothball(g, p, lone, port).ok).toBe(true);
            expect(forceMothballPhase(lone)).toBe(MOTHBALL_RESERVE);
        }
    }, 600000);

    it('AI empires mothball weak idle fleets in a long peace on a tight budget, reactivate on a war warning; rivals weigh the reserve as weaker', () => {
        const run = cachedScenarioGameRun(gameData, { scenario: 'mothballing' });
        const game = run.game;
        const g = game.galaxy;
        const now = galaxyStarDate(g);
        const ai = g.empires.find((e) => e !== game.playerEmpire && e.active && e.pirateEmpireBaseHabitat === null && e.spacePorts.length > 0
            && e.builtObjects.filter((b) => b.role === BuiltObjectRole.Military && b.builtAt === null && b.topSpeed > 0).length >= 3);
        expect(ai).toBeDefined();
        const e = ai!;
        // three one-ship fleets of its warships (the start has none formed yet)
        for (const b of e.builtObjects.filter((x) => x.role === BuiltObjectRole.Military && x.builtAt === null && x.topSpeed > 0 && x.shipGroup === null).slice(0, 3)) {
            executeShipAction(g, e, [b], createShipAction(ShipActionType.CreateNewFleet, null), true);
        }
        // no AI review yet: peace years not passed -> nothing
        reviewEmpireReserve(g, e, now);
        expect(mothballStrength(e).reserve).toBe(0);
        expect(peekMothballState(g)!.ships.filter((b) => b.empire === e).length).toBe(0);
        // long peace, broke: part of the fleet goes to reserve, the rest stays as home guard
        const st = peekMothballState(g)!;
        st.ai[String(e.empireId)].alarmAt = now - 10 * YEAR_LENGTH;
        // no war warning from attitudes in this test
        for (const r of e.diplomaticRelations.toArray()) if (r.type === DiplomaticRelationType.War) r.type = DiplomaticRelationType.None;
        e.stateMoney = 0;
        const hostile = g.empires.filter((o) => o !== e);
        void hostile;
        reviewEmpireReserve(g, e, now);
        const sent = st.ships.filter((b) => b.empire === e);
        if (sent.length === 0) {
            // A war warning (hostile attitude / arming neighbour) can block it: the review must say so by keeping alarmAt fresh.
            expect(st.ai[String(e.empireId)].alarmAt).toBe(now);
            return;
        }
        expect(st.stats.aiMothballed).toBeGreaterThan(0);
        const fleetsActive = e.shipGroups.filter((x) => x !== null && (x as ShipGroup).ships.length > 0 && !(x as ShipGroup).ships.some((b) => b.mothball !== undefined));
        expect(fleetsActive.length).toBeGreaterThanOrEqual(1);
        // put them in reserve where they are (as if arrived) and weigh them as a rival
        for (const b of sent) b.mothball!.phase = MOTHBALL_RESERVE;
        const mp = militaryPotency(e);
        const weighed = rivalPotency(g, mp, e);
        expect(weighed).toBeLessThan(mp);
        const reserveStrength = mothballStrength(e).reserve;
        expect(mp - weighed).toBeCloseTo(reserveStrength * 0.75, 0);
        // AI ships in reserve take no AI missions
        const b0 = sent[0];
        const m0 = b0.mission;
        assignMission(g, b0, BuiltObjectMissionType.Patrol, null, null, BuiltObjectMissionPriority.Normal, { x: b0.xpos + 5000, y: b0.ypos });
        expect(b0.mission).toBe(m0);
        // a war: everything starts reactivating
        const rival = g.empires.find((o) => o !== e && o.active && o.pirateEmpireBaseHabitat === null)!;
        obtainDiplomaticRelation(e, rival).type = DiplomaticRelationType.War;
        reviewEmpireReserve(g, e, now + 10);
        for (const b of sent) expect(b.mothball?.phase).toBe(MOTHBALL_REACTIVATING);
        expect(st.ai[String(e.empireId)].alarmAt).toBe(now + 10);
        expect(st.stats.aiReactivated).toBeGreaterThan(0);
    }, 600000);

    it('ports fill up: a full port is listed last with the reason and refused; parking rings overflow outward', () => {
        const run = cachedScenarioGameRun(gameData, { scenario: 'mothballing' });
        const g = run.game.galaxy;
        const p = run.game.playerEmpire;
        const ship = playerWarships(run.game)[0];
        const port = p.spacePorts[0];
        const cap = portCapacity(g, port);
        // occupy the port with `cap` reserve entries
        expect(issueMothball(g, p, ship, null).ok).toBe(true);
        const st = peekMothballState(g)!;
        issueReactivate(g, p, ship); // the registry exists now
        const base = mothballPortChoices(g, p, ship).find((x) => x.port === port)!.used;
        const fakes = Array.from({ length: cap }, () => ({ mothball: { phase: MOTHBALL_RESERVE, port }, hasBeenDestroyed: false }) as unknown as BuiltObject);
        st.ships.push(...fakes);
        const list = mothballPortChoices(g, p, ship);
        const c = list.find((x) => x.port === port)!;
        expect(c.used).toBe(base + cap);
        expect(c.full).toMatch(/full/);
        expect(list[list.length - 1].port === port || list.every((x) => x.full !== null)).toBe(true);
        expect(issueMothball(g, p, ship, port).ok).toBe(false);
        st.ships.splice(st.ships.length - cap, cap);
        // rings: ring 0 holds floor(2π r0 / S) slots, the next slot opens ring 1 one spacing further out
        const S = 300;
        const size = 1000;
        const r0 = size + S * 0.6;
        const cap0 = Math.floor((2 * Math.PI * r0) / S);
        for (let i = 0; i < cap0; i++) {
            const pt = parkingSlotPoint(i, size, S);
            expect(pt.ring).toBe(0);
            expect(Math.hypot(pt.dx, pt.dy)).toBeCloseTo(r0, 6);
            const q = parkingSlotPoint((i + 1) % cap0, size, S);
            expect(Math.hypot(pt.dx - q.dx, pt.dy - q.dy)).toBeGreaterThan(0.9 * S);
        }
        const o = parkingSlotPoint(cap0, size, S);
        expect(o.ring).toBe(1);
        expect(Math.hypot(o.dx, o.dy)).toBeCloseTo(r0 + S, 6);
        // the deterministic sin / cos (sim positions must be bit-identical) match Math's
        for (const a of [0, 0.3, 1.7, 3.1, 4.6, 6.2]) {
            const sc = detSinCos(a);
            expect(Math.abs(sc.s - Math.sin(a))).toBeLessThan(1e-9);
            expect(Math.abs(sc.c - Math.cos(a))).toBeLessThan(1e-9);
        }
    }, 600000);

    it('off by default: no scenario state, the commands refuse, the base game is untouched', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const p = game.playerEmpire;
        const ship = playerWarships(game)[0];
        expect(issueMothball(g, p, ship, null).ok).toBe(false);
        expect(issueReactivate(g, p, ship).ok).toBe(false);
        expect(ship.mothball).toBeUndefined();
        expect(peekMothballState(g)).toBeNull();
        // the add-on with its master flag off: no state, no change
        const off = cachedScenarioGameRun(gameData, { scenario: 'mothballing', flags: { mothballing: false }, seconds: 30 }).game;
        expect(peekMothballState(off.galaxy)).toBeNull();
        expect(issueMothball(off.galaxy, off.playerEmpire, playerWarships(off)[0], null).ok).toBe(false);
    }, 600000);
});

describe('Veterans add-on: the Make flagship order', () => {
    it('a fleet of two warships gets a flagship within a day; the slot picks the other ship; off in a stock game', () => {
        const run = cachedScenarioGameRun(gameData, { scenario: 'veterans' });
        const game = run.game;
        const g = game.galaxy;
        const p = game.playerEmpire;
        const mil = p.builtObjects.filter((b) => b.role === BuiltObjectRole.Military && b.builtAt === null && b.topSpeed > 0 && b.shipGroup === null);
        expect(mil.length).toBeGreaterThanOrEqual(2);
        const fleet = executeShipAction(g, p, [mil[0], mil[1]], createShipAction(ShipActionType.CreateNewFleet, null), true).select as ShipGroup;
        runGameSeconds(game, 10); // the daily review picks the default flagship
        const first = fleetFlagship(g, fleet)!;
        expect(first).not.toBeNull();
        const other = fleet.ships.find((b) => b !== first)!;
        expect(fleetFlagshipLabel(g, fleet)).toBe(first.name);
        // the selection panel: a fleet lists its ships (the flagship starred), a ship in it offers the order
        const fm = flagshipSlot(g, p, { shipGroup: fleet })!;
        expect(fm.listOnClick).toBe(true);
        expect(fm.choices.map((c) => c.chosen)).toEqual(fleet.ships.map((b) => b === first));
        const sm = flagshipSlot(g, p, { builtObject: other })!;
        expect(sm.label).toBe('Make flagship');
        expect(sm.disabled).toBe(false);
        expect(flagshipSlot(g, p, { builtObject: first })!.disabled).toBe(true); // already the flagship
        expect(issueMakeFlagship(g, p, other)).toMatchObject({ ok: true });
        runGameSeconds(game, 10);
        expect(isFlagship(g, other)).toBe(true);
        expect(fleetFlagship(g, fleet)).toBe(other);
        // a ship of another empire cannot be ordered
        const foe = g.empires.find((e) => e !== p && e.builtObjects.some((b) => b.role === BuiltObjectRole.Military))!;
        expect(issueMakeFlagship(g, p, foe.builtObjects.find((b) => b.role === BuiltObjectRole.Military)!).ok).toBe(false);
        // no add-on, no slot
        const stock = cachedTickGame(gameData, { seconds: 60 });
        expect(flagshipSlot(stock.galaxy, stock.playerEmpire, { builtObject: other })).toBeNull();
    }, 300000);
});

describe('Beached ships add-on: a warship crash-landed on its colony', () => {
    function warships(e: Empire): BuiltObject[] {
        return e.builtObjects.filter((b) => b.role === BuiltObjectRole.Military && b.builtAt === null && b.topSpeed > 0 && b.firepowerRaw > 0 && !b.hasBeenDestroyed);
    }
    /** Another empire with at least `n` warships. */
    function aiWithShips(g: Galaxy, player: Empire, n: number): Empire {
        const e = g.empires.find((x) => x && x !== player && x !== g.independentEmpire && x.active && x.pirateEmpireBaseHabitat === null && warships(x).length >= n);
        expect(e).toBeDefined();
        return e!;
    }
    /** The fired-at time of a ship's newest shot (rises while it fires). */
    const lastShot = (b: BuiltObject): number => Math.max(...b.weapons.map((w) => w.lastFired));
    /** Puts a ship at a point, and in the galaxy's spatial index there. */
    function place(g: Galaxy, b: BuiltObject, x: number, y: number): void {
        const ix = g.resolveIndexX(b.xpos);
        const iy = g.resolveIndexY(b.ypos);
        b.xpos = x;
        b.ypos = y;
        updateIndexesForMovement(g, b, ix, iy, false);
    }
    function giveTerraforming(g: Galaxy, e: Empire): void {
        const def = planetaryFacilityDefinitionsStatic(g).find((f) => f != null && facilityType(f) === PlanetaryFacilityType.TerraformingFacility);
        expect(def).toBeDefined();
        if (!e.research!.buildablePlanetaryFacilities.includes(def!)) e.research!.buildablePlanetaryFacilities.push(def!);
    }

    it('the order: menu entry for an own warship at its colony, none without the add-on; the ship leaves its fleet, takes no orders, joins the garrison', () => {
        const run = cachedScenarioGameRun(gameData, { scenario: 'beaching' });
        const g = run.game.galaxy;
        const p = run.game.playerEmpire;
        const cap = p.capital!;
        const [ship, other] = warships(p);
        const ctx = (sel: BuiltObject | ShipGroup): OrderMenuContext => ({ galaxy: g, empire: p, selected: sel, cursorX: Math.trunc(cap.xpos), cursorY: Math.trunc(cap.ypos), zoomFactor: 1, pickAt: () => cap });
        const item = buildActionMenu(ctx(ship)).find((i) => i.key === BEACH_ACTION);
        expect(item).toBeDefined();
        expect(item!.label).toBe('Beach on colony');
        expect(item!.action!.actionType).toBe(ShipActionType.ScenarioThreatAction);
        expect(item!.hint).toContain('quality');
        // a fleet offers it for its lead ship
        const fleet = executeShipAction(g, p, [ship, other], createShipAction(ShipActionType.CreateNewFleet, null), true).select as ShipGroup;
        const fleetItem = buildActionMenu(ctx(fleet)).find((i) => i.key === BEACH_ACTION);
        expect(fleetItem).toBeDefined();
        expect(fleetItem!.action!.target).toBe(fleet.leadShip);
        // too far from any colony: no entry
        const lead = fleet.leadShip!;
        const x0 = lead.xpos;
        lead.xpos += 90000;
        expect(buildActionMenu(ctx(lead)).some((i) => i.key === BEACH_ACTION)).toBe(false);
        lead.xpos = x0;
        // run it as the order does (the executor)
        const defend0 = cap.troops!.totalDefendStrength;
        const q0 = cap.baseQuality;
        executeShipAction(g, p, fleet, fleetItem!.action!, true);
        const beached = lead;
        expect(beached.beached?.colony).toBe(cap);
        expect(beached.shipGroup).toBeNull();
        expect(beachedAt(g, cap)).toEqual([beached]);
        expect(isAiControlled(beached)).toBe(false);
        // no mission can be given any more
        const before = beached.mission;
        executeShipAction(g, p, beached, createMissionShipActionAt(BuiltObjectMissionType.Move, null, beached.xpos + 4000, beached.ypos), true);
        expect(beached.mission).toBe(before);
        expect(buildActionMenu(ctx(beached)).some((i) => i.key === BEACH_ACTION || i.key.startsWith('Move'))).toBe(false);
        // the crew is a real, un-pick-up-able garrison unit
        const crew = beached.beached!.crew!;
        expect(crew.beached).toBe(true);
        expect(crew.garrisoned).toBe(true);
        expect(cap.troops!.contains(crew)).toBe(true);
        expect(p.troops.contains(crew)).toBe(true);
        expect(cap.troops!.totalDefendStrength).toBe(defend0 + crew.defendStrength * 100);
        reviewColonyTroopGarrisonWith(p, cap, 100, 100); // a garrison review keeps it
        expect(crew.garrisoned).toBe(true);
        expect(setTroopsGarrisoned(p, [crew], false)).toBe(0);
        expect(disbandTroops(p, [crew])).toBeDefined();
        expect(cap.troops!.contains(crew)).toBe(true);
        // the scar, and the info line
        expect(cap.baseQuality).toBeLessThan(q0);
        expect(scarPct(g, cap)).toBeCloseTo(beachLossPct(g, beached.size), 5);
        expect(beachedInfoLine(g, cap, p)).toMatch(/^Beached: 1 ship \(−\d+% quality\)/);
        // it sits by the planet and follows it, stopped
        runGameSeconds(run.game, 30);
        expect(Math.hypot(beached.xpos - cap.xpos, beached.ypos - cap.ypos)).toBeLessThan(cap.diameter + 200);
        expect(beached.currentSpeed).toBe(0);
        // a second beaching of the same ship is refused; the stock game offers nothing
        expect(beachShip(g, p, beached, cap, 'human').ok).toBe(false);
        const stock = cachedTickGame(gameData, { seconds: 60 });
        const sp = stock.playerEmpire;
        const sctx: OrderMenuContext = { galaxy: stock.galaxy, empire: sp, selected: warships(sp)[0], cursorX: 0, cursorY: 0, zoomFactor: 1, pickAt: () => sp.capital };
        expect(buildActionMenu(sctx).some((i) => i.key === BEACH_ACTION)).toBe(false);
    }, 300000);

    it('defence: the crew adds to the stock ground maths, by hull size, armour and crew level; the hull fights on as a base', () => {
        const run = cachedScenarioGameRun(gameData, { scenario: 'beaching' });
        const g = run.game.galaxy;
        const p = run.game.playerEmpire;
        const cap = p.capital!;
        const ships = warships(p).sort((a, b) => a.size - b.size);
        expect(ships.length).toBeGreaterThanOrEqual(3);
        const [small, , big] = ships;
        expect(big.size).toBeGreaterThan(small.size);
        // by size and armour (the defaults 0.35 / 0.5)
        const str = (b: BuiltObject): number => beachCrewStrength(g, b);
        expect(str(big)).toBeGreaterThan(str(small));
        expect(str(small)).toBe(Math.trunc((small.size * 0.35 + small.armor * 0.5) * 0.88)); // a new crew is green: one step (12%) below average
        // crew level: green below average, veteran above
        const stats = { weaponsDamageToEnemy: 0, damageToUs: 0 };
        small.careerBattleStats = stats;
        const green = str(small);
        stats.weaponsDamageToEnemy = 100;
        const average = str(small);
        stats.weaponsDamageToEnemy = 9000;
        const vet = str(small);
        expect(average).toBe(Math.trunc(small.size * 0.35 + small.armor * 0.5));
        expect(green).toBeLessThan(average);
        expect(vet).toBeGreaterThan(average);
        small.careerBattleStats = null;
        // the stock force maths: the defenders' strength rises by the crew's
        const foe = aiWithShips(g, p, 1);
        const raiders = new TroopList();
        raiders.add(new Troop('r', TroopType.Infantry, 120, 120, 100, 100, foe, foe.dominantRace));
        const before = calculateForceStrengths(g, cap, p, foe, cap.troops!, null, raiders, null).defendingStrength;
        beachShip(g, p, big, cap, 'human');
        const after = calculateForceStrengths(g, cap, p, foe, cap.troops!, null, raiders, null).defendingStrength;
        expect(after).toBeGreaterThan(before);
        // a damaged hull puts less ashore
        const hurt = warships(p).find((b) => b !== big)!;
        const full = str(hurt);
        hurt.damagedComponentCount = hurt.components.items.length;
        expect(str(hurt)).toBeLessThan(full);
        hurt.damagedComponentCount = 0;
    }, 300000);

    it('guns: the beached ship fires at hostile ships in orbit, but not while troops are fighting on its colony; they resume when it is clear', () => {
        const run = cachedScenarioGameRun(gameData, { scenario: 'beaching' });
        const game = run.game;
        const g = game.galaxy;
        const p = game.playerEmpire;
        const cap = p.capital!;
        const ship = warships(p)[2];
        beachShip(g, p, ship, cap, 'human');
        const foeE = aiWithShips(g, p, 2);
        declareWar(g, foeE, p);
        const foes = warships(foeE).slice(0, 2);
        for (const f of foes) {
            f.isAutoControlled = false;
            if (f.shipGroup !== null) leaveShipGroup(g, f);
            f.topSpeed = 0;
            f.canHyperJump = false;
        }
        const stage = (): void => {
            for (const f of foes) {
                f.xpos = ship.xpos + 150;
                f.ypos = ship.ypos + 100;
                f.currentShields = 1000;
                if (!ship.attackers!.includes(f)) ship.attackers!.push(f);
            }
        };
        const step = (n: number): void => {
            for (let i = 0; i < n; i++) {
                stage();
                runGameSeconds(game, 1);
            }
        };
        step(2);
        let shot = lastShot(ship);
        step(3);
        expect(lastShot(ship)).toBeGreaterThan(shot); // an open orbit: it fires
        // troops landed: the crew is on the ground, the guns are cold
        const t = new Troop('invader', TroopType.Infantry, 100000, 100, 100, 100, foeE, foeE.dominantRace);
        cap.invadingTroops = new TroopList();
        cap.invadingTroops.add(t);
        expect(beachedMayFire(ship)).toBe(false);
        shot = lastShot(ship);
        step(3);
        expect(lastShot(ship)).toBe(shot);
        // the battle is over (the colony holds): it fires again
        cap.invadingTroops = null;
        expect(beachedMayFire(ship)).toBe(true);
        step(3);
        expect(lastShot(ship)).toBeGreaterThan(shot);
    }, 300000);

    it('guns: it engages hostile ships in orbit that are not shooting at it (a base\'s defence), until a ground battle starts', () => {
        const run = cachedScenarioGameRun(gameData, { scenario: 'beaching' });
        const game = run.game;
        const g = game.galaxy;
        const p = game.playerEmpire;
        const cap = p.capital!;
        const ship = warships(p)[2];
        beachShip(g, p, ship, cap, 'human');
        const foeE = aiWithShips(g, p, 2);
        declareWar(g, foeE, p);
        const foes = warships(foeE).slice(0, 3);
        for (const f of foes) {
            f.isAutoControlled = false;
            if (f.shipGroup !== null) leaveShipGroup(g, f);
            f.topSpeed = 0;
            f.canHyperJump = false;
            f.weapons.length = 0; // unarmed in fact: they never shoot, so the ship has no attacker to answer
        }
        const stage = (): void => {
            for (const f of foes) {
                place(g, f, ship.xpos + 200, ship.ypos + 100);
                f.nearestSystemStar = ship.nearestSystemStar;
                f.currentShields = 1000;
            }
        };
        const step = (n: number): void => {
            for (let i = 0; i < n; i++) {
                stage();
                runGameSeconds(game, 1);
            }
        };
        const shot0 = lastShot(ship);
        step(10);
        expect(ship.attackers!.length).toBe(0);
        expect(lastShot(ship)).toBeGreaterThan(shot0); // it fired on ships that were only there
        expect(foes.some((f) => f.currentShields < 1000)).toBe(true);
        // a ground battle: cold
        const t = new Troop('invader', TroopType.Infantry, 100000, 100, 100, 100, foeE, foeE.dominantRace);
        cap.invadingTroops = new TroopList();
        cap.invadingTroops.add(t);
        const shot = lastShot(ship);
        for (let i = 0; i < 5; i++) {
            if (cap.invadingTroops === null || cap.invadingTroops.count === 0) {
                cap.invadingTroops = new TroopList();
                cap.invadingTroops.add(t);
            }
            stage();
            runGameSeconds(game, 0.2);
            expect(lastShot(ship)).toBe(shot);
        }
    }, 300000);

    it('quality loss by size (2% to 8%), at most 4 ships and the 20% cap; the scar outlives a destroyed hull', () => {
        const run = cachedScenarioGameRun(gameData, { scenario: 'beaching' });
        const g = run.game.galaxy;
        const p = run.game.playerEmpire;
        // the size scale
        expect(beachLossPct(g, 100)).toBe(2);
        expect(beachLossPct(g, 150)).toBe(2);
        expect(beachLossPct(g, 525)).toBeCloseTo(5, 6);
        expect(beachLossPct(g, 900)).toBe(8);
        expect(beachLossPct(g, 3000)).toBe(8);
        // a colony with many warships: the AI with the most
        const e = g.empires.filter((x) => x && x !== p && x !== g.independentEmpire && x.active && x.pirateEmpireBaseHabitat === null).sort((a, b) => warships(b!).length - warships(a!).length)[0]!;
        const col = e.capital!;
        const ships = warships(e);
        expect(ships.length).toBeGreaterThanOrEqual(5);
        for (const s of ships) {
            s.xpos = col.xpos + 100;
            s.ypos = col.ypos;
            if (s.shipGroup !== null) leaveShipGroup(g, s);
        }
        const q0 = col.baseQuality;
        const res = ships.slice(0, 5).map((s) => beachShip(g, e, s, col, 'human'));
        expect(res.map((r) => r.ok)).toEqual([true, true, true, true, false]); // four at most
        expect(beachedAt(g, col).length).toBe(4);
        const expected = ships.slice(0, 4).reduce((a, s) => a + beachLossPct(g, s.size), 0);
        expect(scarPct(g, col)).toBeCloseTo(Math.min(20, expected), 3);
        expect(col.baseQuality / q0).toBeCloseTo(1 - Math.min(20, expected) / 100, 4);
        // the slots are distinct
        expect(new Set(beachedAt(g, col).map((b) => b.beached!.slot)).size).toBe(4);
        // destroyed hull: the crew is gone, the scar stays
        const victim = beachedAt(g, col)[0];
        const crew = victim.beached!.crew!;
        const lost = scarPct(g, col);
        victim.hasBeenDestroyed = true;
        runGameSeconds(run.game, 10);
        expect(col.troops!.contains(crew)).toBe(false);
        expect(beachedAt(g, col).length).toBe(3);
        expect(scarPct(g, col)).toBeCloseTo(lost, 6);
        expect(beachedInfoLine(g, col, e)).toMatch(/^Beached: 3 ships/);
    }, 300000);

    it('the loss cap clamps the scar', () => {
        const run = cachedScenarioGameRun(gameData, { scenario: 'beaching' });
        const g = run.game.galaxy;
        const p = run.game.playerEmpire;
        const col = p.capital!;
        const ships = warships(p);
        g.scenario!.params.beachMaxLossPct = 3;
        const q0 = col.baseQuality;
        for (const s of ships) expect(beachShip(g, p, s, col, 'human').ok).toBe(true);
        // two 2.0..2.6% ships against a 3% cap: the scar stops at 3%
        expect(scarPct(g, col)).toBeCloseTo(3, 3);
        expect(col.baseQuality / q0).toBeCloseTo(0.97, 4);
        expect(beachedAt(g, col).length).toBe(ships.length);
        g.scenario!.params.beachMaxLossPct = 20;
    }, 300000);

    it('cleanup: needs terraforming technology and money, restores the quality evenly, costs per point, the wrecks stay; the AI cleans up when quiet and affordable', () => {
        const run = cachedScenarioGameRun(gameData, { scenario: 'beaching' });
        const game = run.game;
        const g = game.galaxy;
        const p = game.playerEmpire;
        const col = p.capital!;
        const [a, b] = warships(p);
        beachShip(g, p, a, col, 'human');
        beachShip(g, p, b, col, 'human');
        const q1 = col.baseQuality;
        const pct = scarPct(g, col);
        expect(pct).toBeGreaterThan(3);
        // menu entry only with the scar and the tech's order; refused without the technology
        expect(cleanupUnavailableReason(g, p, col)).toMatch(/terraforming/);
        expect(runThreatAction(g, p, CLEANUP_ACTION, col)).toBe(false);
        giveTerraforming(g, p);
        p.stateMoney = 0;
        expect(cleanupUnavailableReason(g, p, col)).toMatch(/Not enough money/);
        const cost = cleanupCost(g, col);
        expect(cost).toBe(Math.round(25000 * pct));
        p.stateMoney = cost + 5;
        expect(availableThreatActions(g, p, col).some((t) => t.kind === CLEANUP_ACTION)).toBe(true);
        g.scenario!.params.beachCleanupDays = 20; // 20 game days (about 35 s) instead of a year
        expect(runThreatAction(g, p, CLEANUP_ACTION, col)).toBe(true);
        expect(p.stateMoney).toBeCloseTo(5, 6);
        expect(availableThreatActions(g, p, col).some((t) => t.kind === CLEANUP_ACTION)).toBe(false);
        expect(cleanupProgress(g, col)).toBe(0);
        runGameSeconds(game, 17);
        const mid = cleanupProgress(g, col)!;
        expect(mid).toBeGreaterThan(0.2);
        expect(mid).toBeLessThan(0.9);
        expect(beachedInfoLine(g, col, p)).toMatch(new RegExp(`cleanup ${Math.round(mid * 100)}%`));
        expect(col.baseQuality).toBeGreaterThan(q1);
        runGameSeconds(game, 40);
        expect(cleanupProgress(g, col)).toBeNull();
        expect(scarPct(g, col)).toBeCloseTo(0, 6);
        expect(col.baseQuality).toBeCloseTo(q1 + (q1 / (1 - pct / 100)) * (pct / 100), 4);
        // the wrecks stay and keep their crews
        expect(beachedAt(g, col).length).toBe(2);
        expect(beachedInfoLine(g, col, p)).toBe('Beached: 2 ships');
        // an AI empire starts the cleanup by itself once it is quiet and can afford 3 times the cost
        const e = aiWithShips(g, p, 1);
        const ec = e.capital!;
        const es = warships(e)[0];
        es.xpos = ec.xpos + 50;
        es.ypos = ec.ypos;
        if (es.shipGroup !== null) leaveShipGroup(g, es);
        beachShip(g, e, es, ec, 'ai');
        giveTerraforming(g, e);
        const st = peekBeachingState(g)!;
        e.stateMoney = 1;
        reviewBeachingEmpire(g, st, e, galaxyStarDate(g));
        expect(scarOf(g, ec)!.cleanup).toBeUndefined(); // cannot afford it
        e.stateMoney = cleanupCost(g, ec) * 4;
        reviewBeachingEmpire(g, st, e, galaxyStarDate(g));
        expect(scarOf(g, ec)!.cleanup).toBeDefined();
        expect(st.stats.aiCleanups).toBe(1);
    }, 300000);

    it('AI: a very last resort only (valuable colony, overwhelming invasion, orbit certain to fall, a trapped or damaged ship), one ship, a small loss', () => {
        const run = cachedScenarioGameRun(gameData, { scenario: 'beaching' });
        const g = run.game.galaxy;
        const p = run.game.playerEmpire;
        const e = aiWithShips(g, p, 2);
        const foe = g.empires.find((x) => x && x !== e && x !== p && x !== g.independentEmpire && x.active && x.pirateEmpireBaseHabitat === null && warships(x).length >= 2)!;
        expect(foe).toBeDefined();
        declareWar(g, foe, e);
        declareWar(g, e, foe);
        const col = e.capital!;
        const now = galaxyStarDate(g);
        const own = warships(e);
        for (const s of own) {
            place(g, s, col.xpos + 100, col.ypos);
            if (s.shipGroup !== null) leaveShipGroup(g, s);
        }
        const st = beachingState(g);
        expect(aiBeachChoice(g, e, col, st, now)).toEqual([]); // peace of mind: no invasion
        // an overwhelming invasion: troops landed
        const invaders = new TroopList();
        invaders.add(new Troop('landed', TroopType.Infantry, 500, 100, 100, 100, foe, foe.dominantRace));
        col.invadingTroops = invaders;
        expect(aiBeachChoice(g, e, col, st, now)).toEqual([]); // ...but no hostile fleet above: the orbit is not lost
        // hostile warships above, far stronger than ours
        const raiders = warships(foe).slice(0, 2);
        const stageFoes = (fp: number): void => {
            for (const r of raiders) {
                place(g, r, col.xpos + 800, col.ypos);
                r.firepowerRaw = fp;
            }
        };
        stageFoes(100000);
        expect(aiBeachChoice(g, e, col, st, now)).toEqual([]); // every ship of ours can escape and is whole
        // a trapped ship (no hyperdrive) is the candidate; the smallest first
        const sorted = own.slice().sort((a, b) => a.size - b.size);
        sorted[0].canHyperJump = false;
        sorted[1].canHyperJump = false;
        let choice = aiBeachChoice(g, e, col, st, now);
        expect(choice).toEqual([sorted[0]]); // one only
        // the capital against more than twice its defence may give a second ship
        invaders.items[0].setAttackStrength(1500);
        expect(aiBeachChoice(g, e, col, st, now)).toEqual([sorted[0], sorted[1]]);
        invaders.items[0].setAttackStrength(500);
        // a badly damaged ship also counts
        sorted[0].canHyperJump = true;
        sorted[1].canHyperJump = true;
        sorted[2].damagedComponentCount = Math.ceil(sorted[2].components.items.length * 0.6);
        choice = aiBeachChoice(g, e, col, st, now);
        expect(choice).toEqual([sorted[2]]);
        // our own orbit is strong enough: nothing
        stageFoes(1);
        expect(aiBeachChoice(g, e, col, st, now)).toEqual([]);
        stageFoes(100000);
        // not enough troops to matter
        col.invadingTroops = new TroopList();
        col.invadingTroops.add(new Troop('few', TroopType.Infantry, 1, 1, 100, 100, foe, foe.dominantRace));
        expect(aiBeachChoice(g, e, col, st, now)).toEqual([]);
        col.invadingTroops = invaders;
        // a colony that is not valuable is never beached on
        const cap = e.capital;
        e.capital = p.capital; // (any other colony: `col` is not its capital for the test)
        g.scenario!.params.beachAIValuePct = 150;
        expect(aiBeachChoice(g, e, col, st, now)).toEqual([]);
        g.scenario!.params.beachAIValuePct = 12;
        e.capital = cap;
        // the full review beaches exactly one ship, once, and not again within the cooldown
        reviewBeachingEmpire(g, st, e, now);
        const s2 = peekBeachingState(g)!;
        expect(beachedAt(g, col).length).toBe(1);
        expect(s2.stats.ai).toBe(1);
        expect(s2.stats.aiCapital).toBe(1);
        expect(scarPct(g, col)).toBeLessThanOrEqual(16);
        reviewBeachingEmpire(g, s2, e, now + GAME_DAY_LENGTH);
        expect(beachedAt(g, col).length).toBe(1);
        expect(JSON.stringify(s2.stats.reviews)).toContain('cooldown');
        // the loss limit: a non-capital colony tops out at 10% (a 2nd ship of 8% would pass it), the capital at 16%
        g.scenario!.params.beachAIMaxLossPct = 1;
        g.scenario!.params.beachAIMaxLossCapitalPct = 1;
        g.scenario!.params.beachAICooldownDays = 0;
        sorted[3].canHyperJump = false; // a trapped candidate remains, but the scar is past the limit
        const room = beachedAt(g, col).length;
        reviewBeachingEmpire(g, s2, e, now + 3 * GAME_DAY_LENGTH);
        expect(beachedAt(g, col).length).toBe(room); // the scar is already past 1%: no more
        expect(s2.stats.reviews.lossCap).toBeGreaterThan(0);
    }, 300000);

    it('save / load keeps the beached ship, its crew, the scar and the cleanup under way', () => {
        const run = cachedScenarioGameRun(gameData, { scenario: 'beaching' });
        const game = run.game;
        const g = game.galaxy;
        const p = game.playerEmpire;
        const col = p.capital!;
        const ship = warships(p)[1];
        const name = ship.name;
        beachShip(g, p, ship, col, 'human');
        giveTerraforming(g, p);
        p.stateMoney = 1e9;
        g.scenario!.params.beachCleanupDays = 40;
        startCleanup(g, p, col, 'human');
        runGameSeconds(game, 10);
        const progress = cleanupProgress(g, col)!;
        const start = { ...defaultStartGameOptions(), seed: 1, scenario: { id: 'beaching', flags: {}, params: {} } };
        const loaded = deserializeGame(serializeGame(game, new GalaxyTime(), start), run.gameData).game;
        const lg = loaded.galaxy;
        const lp = loaded.playerEmpire;
        const lcol = lp.capital!;
        const lship = lp.builtObjects.find((b) => b.name === name)!;
        expect(lship.beached?.colony).toBe(lcol);
        expect(lship.beached?.slot).toBe(ship.beached!.slot);
        expect(lship.shipGroup).toBeNull();
        const lcrew = lship.beached!.crew!;
        expect(lcrew.beached).toBe(true);
        expect(lcrew.defendStrength).toBe(ship.beached!.crew!.defendStrength);
        expect(lcol.troops!.contains(lcrew)).toBe(true);
        expect(lcol.baseQuality).toBeCloseTo(col.baseQuality, 6);
        expect(scarPct(lg, lcol)).toBeCloseTo(scarPct(g, col), 6);
        expect(cleanupProgress(lg, lcol)).toBeCloseTo(progress, 6);
        expect(beachedAt(lg, lcol)).toEqual([lship]);
        expect(beachedInfoLine(lg, lcol, lp)).toBe(beachedInfoLine(g, col, p));
        // the loaded game goes on: the cleanup finishes
        runGameSeconds(loaded, 90);
        expect(cleanupProgress(lg, lcol)).toBeNull();
    }, 300000);

    it('a conquered colony takes its beached hulks with it', () => {
        const run = cachedScenarioGameRun(gameData, { scenario: 'beaching' });
        const game = run.game;
        const g = game.galaxy;
        const p = game.playerEmpire;
        const col = p.capital!;
        const ship = warships(p)[0];
        beachShip(g, p, ship, col, 'human');
        const crew = ship.beached!.crew!;
        const foe = aiWithShips(g, p, 1);
        // the colony changes hands (set directly: the capital's loss would end the empire)
        col.empire = foe;
        col.owner = foe;
        runGameSeconds(game, 10);
        expect(ship.beached).toBeUndefined();
        expect(p.builtObjects.includes(ship)).toBe(false);
        expect(col.troops!.contains(crew)).toBe(false);
        expect(peekBeachingState(g)!.stats.conquered).toBe(1);
    }, 300000);
});
