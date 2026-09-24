// M4a tick-structure tests (tasks/M4-plan.md §5.3 layer 2): with every package stubbed, each DoTasks block fires at
// the right times (Empire / pirate 3/10/30/60/120/240 s with `>=`, Habitat strict `>`, BuiltObject first-call
// back-dating, ShipGroup, Galaxy long/huge), the frame length is quantised exactly, and the frame driver's
// round-robin cursors / enqueue cadence follow Main.Part12.cs method_86 (the in-battle scan stays a no-op).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame } from './helpers/tickGame';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import { MIN_TIME, spanSeconds } from '../src/sim/tick/simTime';
import { resetTodoCounts, todoHits } from '../src/sim/tick/todo';
import { empireDoTasks, initEmpireTouchTimes } from '../src/sim/tick/empireTick';
import { habitatDoTasks } from '../src/sim/tick/habitatTick';
import { builtObjectDoTasks } from '../src/sim/tick/builtObjectTick';
import { galaxyDoTasks, galaxyDoTasksTimeSensitive } from '../src/sim/tick/galaxyTick';
import { shipGroupDoTasks } from '../src/sim/tick/shipGroupTick';
import { ShipGroup } from '../src/sim/fleets/shipGroup';
import { createSchedulerState, nextFrameMs, runSimFrame, schedulerState } from '../src/sim/tick/scheduler';
import type { GameData } from '../src/sim/data/gameData';
import { resetEmpireTouchTimesForAge, runGameStartEmpireTick, runGameStartGalaxyTick, runGameStartHabitatTick, staggerEmpireTouchTimes } from '../src/sim/tick/gameStart';

let gameData: GameData;
let galaxy: Galaxy;
beforeAll(async () => {
    gameData = await loadGameDataFs();
    galaxy = createTickGame(gameData).galaxy;
}, 120000);

/** Names of the blocks whose marker stub was reached by `fn`. */
function firedBlocks(markers: Record<string, string>, fn: () => void): string[] {
    resetTodoCounts();
    fn();
    const hits = todoHits();
    return Object.keys(markers).filter((block) => (hits[markers[block]] ?? 0) > 0);
}

function setEmpireTouches(e: Empire, ms: number): void {
    e.lastShortTouch = e.lastRegularTouch = e.lastPeriodicTouch = e.lastIntermediateTouch = e.lastLongTouch = e.lastHugeTouch = ms;
}

describe('time model (tick/simTime.ts, scheduler frame length)', () => {
    it('span seconds equal the C# Ticks / 1e7 division', () => {
        expect(spanSeconds(16, 0)).toBe((16 * 10000) / 1e7);
        expect(spanSeconds(3000, 0)).toBe(3);
        expect(spanSeconds(0, MIN_TIME)).toBeGreaterThan(240);
        expect(Number.isSafeInteger(600000 - MIN_TIME)).toBe(true);
    });

    it('frames are 1000/60 × speed game ms, quantised with an exact integer carry', () => {
        const s = createSchedulerState();
        expect([nextFrameMs(s, 1), nextFrameMs(s, 1), nextFrameMs(s, 1)]).toEqual([16, 17, 17]);
        let total = 50;
        for (let i = 3; i < 3600; i++) total += nextFrameMs(s, 1);
        expect(total).toBe(60000);
        expect(s.frameCarry).toBe(0);
        const q = createSchedulerState();
        let quarter = 0;
        for (let i = 0; i < 60; i++) quarter += nextFrameMs(q, 0.25);
        expect(quarter).toBe(250);
        const d = createSchedulerState();
        expect([nextFrameMs(d, 2), nextFrameMs(d, 2), nextFrameMs(d, 2)]).toEqual([33, 33, 34]);
    });
});

describe('Empire.DoTasks intervals (Empire.1.cs 3427, >= on seconds, touches first)', () => {
    const markers = {
        short: 'M4m respondToIncomingEnemyFleetsAndPlanetDestroyers',
        regular: 'M4i reviewDesignsAndRetrofit', // (M4b ported processDistressSignals; the block is detected by its M4i stub)
        periodic: 'M4s checkSendPirateRaid',
        intermediate: 'M4l reviewFleetAdmiralBonuses',
        long: 'M4i reviewColonyWonders',
        huge: 'M4u resetRaceEvents',
    };
    const at = (ms: number): string[] => {
        const e = galaxy.empires[1];
        setEmpireTouches(e, 0);
        galaxy.nowMs = ms;
        return firedBlocks(markers, () => empireDoTasks(galaxy, e));
    };

    it('fires each block exactly at its interval', () => {
        expect(at(2999)).toEqual([]);
        expect(at(3000)).toEqual(['short']);
        expect(at(9999)).toEqual(['short']);
        expect(at(10000)).toEqual(['short', 'regular']);
        expect(at(30000)).toEqual(['short', 'regular', 'periodic']);
        expect(at(59999)).toEqual(['short', 'regular', 'periodic']);
        expect(at(60000)).toEqual(['short', 'regular', 'periodic', 'intermediate']);
        expect(at(120000)).toEqual(['short', 'regular', 'periodic', 'intermediate', 'long']);
        expect(at(239999)).toEqual(['short', 'regular', 'periodic', 'intermediate', 'long']);
        expect(at(240000)).toEqual(Object.keys(markers));
    });

    it('updates the touch of every block that fired before running the blocks', () => {
        const e = galaxy.empires[1];
        setEmpireTouches(e, 0);
        galaxy.nowMs = 30000;
        empireDoTasks(galaxy, e);
        expect([e.lastShortTouch, e.lastRegularTouch, e.lastPeriodicTouch, e.lastIntermediateTouch, e.lastLongTouch, e.lastHugeTouch]).toEqual([30000, 30000, 30000, 0, 0, 0]);
    });

    it('ctor touch times (now − 121 s, huge = MinValue) make every block fire', () => {
        const e = galaxy.empires[2];
        galaxy.nowMs = 500000;
        initEmpireTouchTimes(galaxy, e);
        e.lastHugeTouch = MIN_TIME;
        expect(e.lastLongTouch).toBe(500000 - 121000);
        expect(firedBlocks(markers, () => empireDoTasks(galaxy, e))).toEqual(Object.keys(markers));
    });

    it('pirate factions branch to DoTasksPirates with the same intervals', () => {
        const pirateMarkers = {
            short: 'M4u processCharacters',
            regular: 'M4s pirateCheckMissionsOnOffer',
            periodic: 'M4s pirateRecalculateEmpireCorruption',
            intermediate: 'M4s pirateCollectIncomeFromControlledColonies',
            long: 'M4s doTaskPiratesLongInterval',
            huge: 'M4u pirateReviewRandomEvents',
        };
        const p = galaxy.pirateEmpires[0];
        expect(p.pirateEmpireBaseHabitat).not.toBeNull();
        const pat = (ms: number): string[] => {
            setEmpireTouches(p, 0);
            galaxy.nowMs = ms;
            return firedBlocks(pirateMarkers, () => empireDoTasks(galaxy, p));
        };
        expect(pat(2999)).toEqual([]);
        expect(pat(10000)).toEqual(['short', 'regular']);
        expect(pat(60000)).toEqual(['short', 'regular', 'periodic', 'intermediate']);
        expect(pat(240000)).toEqual(Object.keys(pirateMarkers));
        // Normal-empire-only steps never run for a pirate.
        expect(firedBlocks({ x: 'M4m respondToIncomingEnemyFleetsAndPlanetDestroyers' }, () => {
            setEmpireTouches(p, 0);
            galaxy.nowMs = 240000;
            empireDoTasks(galaxy, p);
        })).toEqual([]);
    });
});

describe('Habitat.DoTasks intervals (Habitat.cs 1399, strict >)', () => {
    // The intermediate block's only call (CheckForShipsDiscoveringRuins) is ported (M4t): it is detected by its
    // touch write (Habitat.cs 1440 _LastIntermediateTouch = _tempNow) instead of a stub hit.
    const markers = {
        periodic: 'M4q scanForNewOwnerHabitat',
        // M4c ported ReviewWhetherRefuellingDepot; CheckHabitatIsEmpire (M4u stub, SpawnNewEmpires on) marks the block.
        long: 'M4u checkHabitatIsEmpire',
        huge: 'M4q clearTroopsAwaitingPickup',
    };
    const at = (ms: number): string[] => {
        const h = galaxy.empires[0].capital!;
        h.lastTouch = h.lastIntermediateTouch = h.lastPeriodicTouch = h.lastLongTouch = h.lastHugeTouch = 0;
        const fired = firedBlocks(markers, () => habitatDoTasks(galaxy, h, ms));
        return h.lastIntermediateTouch !== 0 ? ['intermediate', ...fired] : fired;
    };

    it('fires a block only strictly after its span', () => {
        expect(at(3000)).toEqual([]);
        expect(at(3001)).toEqual(['intermediate']);
        expect(at(10000)).toEqual(['intermediate']);
        expect(at(10001)).toEqual(['intermediate', 'periodic']);
        expect(at(60000)).toEqual(['intermediate', 'periodic']);
        expect(at(60001)).toEqual(['intermediate', 'periodic', 'long']);
        expect(at(240000)).toEqual(['intermediate', 'periodic', 'long']);
        expect(at(240001)).toEqual(['intermediate', ...Object.keys(markers)]);
    });

    it('moves the habitat along its orbit by the time since the last touch', () => {
        const h = galaxy.habitats.find((x) => x.parent !== null && x.orbitSpeed > 0)!;
        h.lastTouch = 1000;
        const angle = h.orbitAngle;
        habitatDoTasks(galaxy, h, 1000);
        expect(h.orbitAngle).toBe(angle);
        habitatDoTasks(galaxy, h, 2000);
        expect(h.orbitAngle).not.toBe(angle);
        expect(h.lastTouch).toBe(2000);
    });
});

describe('BuiltObject.DoTasks (BuiltObject.cs 3614)', () => {
    const markers = {
        intermediate: 'M4n checkNearTarget',
        periodic: 'M4h checkRepairMissionStillValid',
        long: 'M4q baconBuiltObjectHugeProcessingSpanActions',
    };

    it('back-dates the touches on the first call so every block fires, then uses >=', () => {
        const bo = galaxy.builtObjects[0];
        bo.lastTouch = bo.lastIntermediateTouch = bo.lastPeriodicTouch = bo.lastLongTouch = MIN_TIME;
        const t = 500000;
        expect(firedBlocks(markers, () => builtObjectDoTasks(galaxy, bo, t, 0))).toEqual(['intermediate', 'periodic', 'long']);
        expect([bo.lastTouch, bo.lastIntermediateTouch, bo.lastPeriodicTouch, bo.lastLongTouch]).toEqual([t, t, t, t]);
        expect(bo.threats).toHaveLength(20);
        expect(firedBlocks(markers, () => builtObjectDoTasks(galaxy, bo, t + 2999, 0))).toEqual([]);
        expect(firedBlocks(markers, () => builtObjectDoTasks(galaxy, bo, t + 3000, 0))).toEqual(['intermediate']);
        expect(firedBlocks(markers, () => builtObjectDoTasks(galaxy, bo, t + 10000, 0))).toEqual(['intermediate', 'periodic']);
        expect(firedBlocks(markers, () => builtObjectDoTasks(galaxy, bo, t + 60000, 0))).toEqual(['intermediate', 'periodic', 'long']);
    });

    it('runs the ExecuteCommands loop once for a ship without a mission (the epilogue reaches the M4e AutoRefuelRepairShip stub, then returns 0)', () => {
        // M4b ported ExecuteCommands: with no mission the no-command epilogue (BuiltObject.2.cs 4494-4574) runs
        // AssignQueuedMission (no queued missions) then RevertToPreviousMission → AutoRefuelRepairShip (M4e stub) once.
        const bo = galaxy.builtObjects[1];
        builtObjectDoTasks(galaxy, bo, 5000, 0); // first call: _LastTouch = now, dt = 0 ⇒ no ExecuteCommands
        resetTodoCounts();
        builtObjectDoTasks(galaxy, bo, 6000, 0);
        expect(todoHits()['M4e autoRefuelRepairShip']).toBe(1);
    });
});

describe('ShipGroup.DoTasks (ShipGroup.cs 97)', () => {
    it('stamps the first touch, runs the periodic block on the first call, then >= spans', () => {
        const markers = { intermediate: 'M4l checkForMissionCompletion', periodic: 'M4l checkRefuelManual' };
        const sg = new ShipGroup(galaxy);
        sg.empire = galaxy.empires[1];
        expect(firedBlocks(markers, () => shipGroupDoTasks(galaxy, sg, 1000))).toEqual(['periodic']);
        expect(sg.lastTouch).toBe(1000);
        expect(firedBlocks(markers, () => shipGroupDoTasks(galaxy, sg, 3999))).toEqual([]);
        expect(firedBlocks(markers, () => shipGroupDoTasks(galaxy, sg, 4000))).toEqual(['intermediate']);
        expect(firedBlocks(markers, () => shipGroupDoTasks(galaxy, sg, 11000))).toEqual(['intermediate', 'periodic']);
    });
});

describe('Galaxy.DoTasks (Galaxy.cs 3054) and DoTasksTimeSensitive (3046)', () => {
    const markers = { long: 'M4s checkForTerminatedPirateEmpires' };
    // ReviewEmpireTerritory(onlySystems: true) is ported (M4t): detected through the EmpireTerritory call.
    const withTerritory = (fn: () => void): string[] => {
        const spy = vi.spyOn(galaxy.empireTerritory, 'reviewEmpireTerritoryOnlySystems');
        try {
            const fired = firedBlocks(markers, fn);
            return spy.mock.calls.some((c) => c[1] === true) ? [...fired, 'systemsOnlyTerritory'] : fired;
        } finally {
            spy.mockRestore();
        }
    };

    it('runs the long block at >= 60 s and the huge block at >= 240 s (which skips the systems-only territory review)', () => {
        galaxy.lastGalaxyProcessTime = galaxy.lastGalaxyHugeProcessTime = 0;
        galaxy.nowMs = 59999;
        expect(withTerritory(() => galaxyDoTasks(galaxy))).toEqual([]);
        galaxy.nowMs = 60000;
        expect(withTerritory(() => galaxyDoTasks(galaxy))).toEqual(['long', 'systemsOnlyTerritory']);
        expect([galaxy.lastGalaxyProcessTime, galaxy.lastGalaxyHugeProcessTime]).toEqual([60000, 0]);
        galaxy.lastGalaxyProcessTime = galaxy.lastGalaxyHugeProcessTime = 0;
        galaxy.nowMs = 240000;
        expect(withTerritory(() => galaxyDoTasks(galaxy))).toEqual(['long']);
        expect([galaxy.lastGalaxyProcessTime, galaxy.lastGalaxyHugeProcessTime]).toEqual([240000, 240000]);
    });

    it('DoTasksTimeSensitive runs every call and stamps its own touch', () => {
        resetTodoCounts();
        galaxyDoTasksTimeSensitive(galaxy, 0, 1234);
        galaxyDoTasksTimeSensitive(galaxy, 0, 1250);
        expect(todoHits()['M4s reviewPirateMissionsAndAssign']).toBe(2);
        expect(galaxy.lastGalaxyProcessTimeSensitive).toBe(1250);
    });
});

describe('frame driver (Main.Part12.cs method_86)', () => {
    let g: Galaxy;
    beforeAll(() => {
        g = createTickGame(gameData).galaxy;
    }, 120000);

    it('enqueues the galaxy every 100th frame, one empire / pirate faction every 10th frame, one empire fleet pass every 5th', () => {
        resetTodoCounts();
        for (let f = 0; f < 21; f++) runSimFrame(g, nextFrameMs(schedulerState(g), 1));
        const s = schedulerState(g);
        expect(s.frames).toBe(21);
        expect(s.galaxyFrameCounter).toBe(21);
        expect([s.empireCursor, s.empireFrameCounter]).toEqual([3, 1]);
        expect([s.pirateCursor, s.pirateFrameCounter]).toEqual([3, 1]);
        expect([s.fleetEmpireCursor, s.fleetFrameCounter]).toEqual([1, 1]);
        expect(s.inBattleCursor).toBe(0); // the in-battle scan loop is a no-op
        expect(s.queue).toEqual([]);
        expect(todoHits()['M4s reviewPirateMissionsAndAssign']).toBe(21);
        // Empires 0..2 were ticked (at frames 1, 11, 21); empire 3 not yet — it keeps createGame's
        // Start.2.cs 1344-1350 stagger (all six touches = now − Rnd.Next(1, 120) s).
        expect(g.empires[0].lastShortTouch).toBeGreaterThan(0);
        expect(g.empires[3].lastShortTouch).toBeLessThan(0);
        expect(g.empires[3].lastHugeTouch).toBe(g.empires[3].lastShortTouch);
    });

    it('ticks the next min(1000, Habitats.Count) habitats round-robin, wrapping like method_86', () => {
        const s = schedulerState(g);
        const n = g.habitats.length;
        expect(n).toBeGreaterThan(1000);
        s.habitatCursor = n - 10;
        runSimFrame(g, 17);
        const ticked = g.habitats.map((h, i) => (h.lastTouch === g.nowMs ? i : -1)).filter((i) => i >= 0);
        expect(ticked).toHaveLength(1000);
        expect(ticked.slice(0, 990)).toEqual(Array.from({ length: 990 }, (_, i) => i));
        expect(ticked.slice(990)).toEqual(Array.from({ length: 10 }, (_, i) => n - 10 + i));
        expect(s.habitatCursor).toBe(990);
    });

    it('ticks every built object each frame while there are at most 1000 (cursor ends at Count)', () => {
        const s = schedulerState(g);
        runSimFrame(g, 16);
        expect(g.builtObjects.every((b) => b.lastTouch === g.nowMs)).toBe(true);
        expect(s.builtObjectCursor).toBe(g.builtObjects.length);
    });
});

describe('game-start switch-over entry points (tick/gameStart.ts)', () => {
    it('run the real Empire / Galaxy / Habitat skeletons at the current game time without throwing', () => {
        galaxy.nowMs = 0;
        for (const e of galaxy.empires) {
            resetEmpireTouchTimesForAge(galaxy, e);
            // Start.2.cs 1114-1121 back-dates all six touches by 121 s: short..long fire at 1341, huge does not.
            expect(firedBlocks({ long: 'M4i reviewColonyWonders', huge: 'M4u resetRaceEvents' }, () => runGameStartEmpireTick(galaxy, e))).toEqual(['long']);
            staggerEmpireTouchTimes(galaxy, e, 17);
            expect(e.lastLongTouch).toBe(-17000);
            expect(e.lastHugeTouch).toBe(-17000); // Start.2.cs 1350 sets LastHugeTouch too
        }
        resetTodoCounts();
        runGameStartGalaxyTick(galaxy);
        expect([galaxy.lastGalaxyProcessTime, galaxy.lastGalaxyHugeProcessTime]).toEqual([0, 0]);
        expect(todoHits()['M4s checkForTerminatedPirateEmpires']).toBe(1);
        expect(runGameStartHabitatTick(galaxy, galaxy.empires[0].capital!)).toBe(true);
    });
});
