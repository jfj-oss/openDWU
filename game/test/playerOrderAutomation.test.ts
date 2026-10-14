// User deviation from DW:U: a manual order (move / attack / patrol / ...) no longer clears IsAutoControlled — only
// the explicit Automate / Unautomate toggle changes it. The order's missions are marked `playerOrdered`
// (src/sim/missions/playerOrder.ts); while one is the ship's (or its fleet's) unfinished mission the ship counts as
// manually controlled (isAiControlled false), so the empire AI leaves it alone; once it completes, automation resumes.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
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
