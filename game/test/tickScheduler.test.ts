// M4a tick-structure tests (tasks/M4-plan.md §5.3 layer 2): with every package stubbed, each DoTasks block fires at
// the right times (Empire / pirate 3/10/30/60/120/240 s with `>=`, Habitat strict `>`, BuiltObject first-call
// back-dating, ShipGroup, Galaxy long/huge), the frame length is quantised exactly, and the frame driver's
// round-robin cursors / enqueue cadence follow Main.Part12.cs method_86 (the in-battle scan stays a no-op).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame } from './helpers/tickGame';
import type { BuiltObject } from '../src/sim/builtObject';
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
import { FleetAttack } from '../src/sim/fleets/militaryAI';
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
/** A block with no stub left is detected by a probe: `arm` before the call, `fired` after. */
interface BlockProbe {
    arm: () => void;
    fired: () => boolean;
}

function firedBlocks(markers: Record<string, string | BlockProbe>, fn: () => void): string[] {
    for (const m of Object.values(markers)) if (typeof m !== 'string') m.arm();
    resetTodoCounts();
    fn();
    const hits = todoHits();
    return Object.keys(markers).filter((block) => {
        const m = markers[block];
        return typeof m === 'string' ? (hits[m] ?? 0) > 0 : m.fired();
    });
}

/**
 * The regular block has no stub left (M4b ported ProcessDistressSignals, M4i ReviewDesignsAndRetrofit): arm
 * Empire._ReviewDesignsAndRetrofit (with ControlDesigns off) and see ReviewDesignsAndRetrofit clear it. The clear is
 * recorded through an instance accessor, because a later block in the same frame may set the flag again (a research
 * breakthrough, researchTick.ts DoResearchBreakthrough, once the M4u race events / character reviews run in the frame).
 */
function reviewDesignsProbe(getEmpire: () => Empire): BlockProbe {
    let cleared = false;
    return {
        arm: () => {
            const e = getEmpire();
            e.controlDesigns = false;
            let value = true;
            cleared = false;
            Object.defineProperty(e, 'reviewDesignsAndRetrofitFlag', {
                configurable: true,
                enumerable: true,
                get: () => value,
                set: (v: boolean) => {
                    if (value && !v) cleared = true;
                    value = v;
                },
            });
        },
        fired: () => {
            const e = getEmpire();
            const value = e.reviewDesignsAndRetrofitFlag;
            Object.defineProperty(e, 'reviewDesignsAndRetrofitFlag', { configurable: true, enumerable: true, writable: true, value });
            return cleared;
        },
    };
}

/**
 * CleanupInvalidShips probe (Empire.8.cs 2896, combat/teardown.ts): a docking bay of an auto-controlled base holding a
 * ship whose DockedAt is null is emptied by the huge block.
 */
function cleanupInvalidShipsProbe(getEmpire: () => Empire): BlockProbe {
    let bay: { dockedShip: unknown } | null = null;
    return {
        arm: () => {
            const e = getEmpire();
            const host = (e.builtObjects as unknown as { inView: boolean; isAutoControlled: boolean; dockingBays: { dockedShip: unknown }[] | null }[])
                .find((b) => !b.inView && b.isAutoControlled && b.dockingBays !== null && b.dockingBays.length > 0);
            expect(host).toBeDefined();
            bay = host!.dockingBays![0];
            bay.dockedShip = { dockedAt: null };
        },
        fired: () => {
            const fired = bay !== null && bay.dockedShip === null;
            if (bay !== null) bay.dockedShip = null;
            return fired;
        },
    };
}

/**
 * A block with no unconditional stub left is detected by its touch: Empire.1.cs 3470-3500 sets _Last<Block>Touch to
 * CurrentDateTime before running the block, and only when the block fires.
 */
function touchProbe(galaxyOf: () => Galaxy, getEmpire: () => Empire, field: 'lastPeriodicTouch' | 'lastIntermediateTouch' | 'lastLongTouch' | 'lastHugeTouch'): BlockProbe {
    return {
        arm: () => {},
        fired: () => getEmpire()[field] === galaxyOf().nowMs,
    };
}

/**
 * The short block has no stub left (M4m ported RespondToIncomingEnemyFleetsAndPlanetDestroyers): arm a warning whose
 * planet destroyer has no mission and see Respond… drop it (Empire.1.cs 3208-3212).
 */
function incomingFleetsProbe(getEmpire: () => Empire): BlockProbe {
    let entry: FleetAttack | null = null;
    return {
        arm: () => {
            entry = new FleetAttack({ mission: null } as unknown as BuiltObject, null, 0);
            getEmpire().incomingEnemyFleetsAndPlanetDestroyers.push(entry);
        },
        fired: () => {
            const list = getEmpire().incomingEnemyFleetsAndPlanetDestroyers;
            const i = list.indexOf(entry!);
            if (i >= 0) list.splice(i, 1);
            return i < 0;
        },
    };
}

/** The intermediate block is detected by ReviewSystemThreats (M4m), which zeroes every SystemVisibility.EmpireStrength first. */
function systemThreatsProbe(getEmpire: () => Empire): BlockProbe {
    return {
        arm: () => {
            getEmpire().visibility.systemVisibility[0].empireStrength = -12345;
        },
        fired: () => getEmpire().visibility.systemVisibility[0].empireStrength !== -12345,
    };
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
    let probeEmpire: Empire | null = null;
    const markers = {
        short: incomingFleetsProbe(() => probeEmpire!), // (M4m ported RespondToIncomingEnemyFleetsAndPlanetDestroyers)
        regular: reviewDesignsProbe(() => probeEmpire!), // (no stub left in the regular block: detected by a probe)
        // (M4s2 ported CheckSendPirateRaid, M4z2 PerformIntelligenceMissions): detected by the touch.
        periodic: touchProbe(() => galaxy, () => probeEmpire!, 'lastPeriodicTouch'),
        intermediate: systemThreatsProbe(() => probeEmpire!), // (M4l ported reviewFleetAdmiralBonuses, M4m TaskResupplyShips)
        long: touchProbe(() => galaxy, () => probeEmpire!, 'lastLongTouch'), // (M4f ported ReviewMigrationTourism, M4i ReviewColonyWonders)
        huge: touchProbe(() => galaxy, () => probeEmpire!, 'lastHugeTouch'), // (M4s2 ported CheckColoniesForPirateFacilitiesAndAttack, M4o CleanupInvalidShips)
    };
    const at = (ms: number): string[] => {
        const e = galaxy.empires[1];
        probeEmpire = e;
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
        probeEmpire = e;
        galaxy.nowMs = 500000;
        initEmpireTouchTimes(galaxy, e);
        e.lastHugeTouch = MIN_TIME;
        expect(e.lastLongTouch).toBe(500000 - 121000);
        expect(firedBlocks(markers, () => empireDoTasks(galaxy, e))).toEqual(Object.keys(markers));
    });

    it('pirate factions branch to DoTasksPirates with the same intervals', () => {
        const pirateMarkers = {
            // short: M4u ported ProcessCharacters (the previous marker); the block's other call (ShipGroup.DoTasks) only
            // reaches stubs when the faction has fleets, so the short block is not checked here.
            // M4s1 ported PirateCheckMissionsOnOffer, M4i ReviewDesignsAndRetrofit (4173): detected by a probe.
            regular: reviewDesignsProbe(() => galaxy.pirateEmpires[0]),
            // M4s2 ported the pirate periodic / intermediate / long steps: other stubs (or the touch) mark the blocks.
            // M4z2 ported PerformIntelligenceMissions (the previous marker): detected by the touch.
            periodic: touchProbe(() => galaxy, () => galaxy.pirateEmpires[0], 'lastPeriodicTouch'),
            // M4m ported TaskResupplyShips (the previous intermediate marker): detected by the touch.
            intermediate: touchProbe(() => galaxy, () => galaxy.pirateEmpires[0], 'lastIntermediateTouch'),
            long: touchProbe(() => galaxy, () => galaxy.pirateEmpires[0], 'lastLongTouch'),
            // No stub left in the pirate huge block (M4u PirateReviewRandomEvents, M4d MaintainBaseResourceLevels, M4o
            // CleanupInvalidShips): detected by a probe on CleanupInvalidShips.
            huge: cleanupInvalidShipsProbe(() => galaxy.pirateEmpires[0]),
        };
        const p = galaxy.pirateEmpires[0];
        expect(p.pirateEmpireBaseHabitat).not.toBeNull();
        const pat = (ms: number): string[] => {
            setEmpireTouches(p, 0);
            galaxy.nowMs = ms;
            return firedBlocks(pirateMarkers, () => empireDoTasks(galaxy, p));
        };
        expect(pat(2999)).toEqual([]);
        expect(pat(10000)).toEqual(['regular']);
        expect(pat(60000)).toEqual(['regular', 'periodic', 'intermediate']);
        expect(pat(240000)).toEqual(Object.keys(pirateMarkers));
        // Normal-empire-only steps never run for a pirate.
        expect(firedBlocks({ x: incomingFleetsProbe(() => p) }, () => {
            setEmpireTouches(p, 0);
            galaxy.nowMs = 240000;
            empireDoTasks(galaxy, p);
        })).toEqual([]);
    });
});

describe('Habitat.DoTasks intervals (Habitat.cs 1399, strict >)', () => {
    // Every block's calls are ported (the intermediate CheckForShipsDiscoveringRuins by M4t; M4q ported the periodic
    // ScanForNewOwner / huge ClearTroopsAwaitingPickup markers), so each block is detected by the touch it stamps at its
    // end (Habitat.cs 1440 / 1497 / 1523 / 1543 _Last*Touch = _tempNow).
    const at = (ms: number): string[] => {
        const h = galaxy.empires[0].capital!;
        h.lastTouch = h.lastIntermediateTouch = h.lastPeriodicTouch = h.lastLongTouch = h.lastHugeTouch = 0;
        habitatDoTasks(galaxy, h, ms);
        const fired: string[] = [];
        if (h.lastIntermediateTouch !== 0) fired.push('intermediate');
        if (h.lastPeriodicTouch !== 0) fired.push('periodic');
        if (h.lastLongTouch !== 0) fired.push('long');
        if (h.lastHugeTouch !== 0) fired.push('huge');
        return fired;
    };

    it('fires a block only strictly after its span', () => {
        expect(at(3000)).toEqual([]);
        expect(at(3001)).toEqual(['intermediate']);
        expect(at(10000)).toEqual(['intermediate']);
        expect(at(10001)).toEqual(['intermediate', 'periodic']);
        expect(at(60000)).toEqual(['intermediate', 'periodic']);
        expect(at(60001)).toEqual(['intermediate', 'periodic', 'long']);
        expect(at(240000)).toEqual(['intermediate', 'periodic', 'long']);
        expect(at(240001)).toEqual(['intermediate', 'periodic', 'long', 'huge']);
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
    // M4q ported the last block markers (ProcessBoardingAssault / HealTroops / Bacon HugeProcessingSpanActions): each block
    // is detected by the touch it stamps at its end (BuiltObject.cs 3768 / 3796 / 3812 _Last*Touch = _tempNow).
    const fire = (bo: BuiltObject, t: number): string[] => {
        const before = [bo.lastIntermediateTouch, bo.lastPeriodicTouch, bo.lastLongTouch];
        builtObjectDoTasks(galaxy, bo, t, 0);
        const fired: string[] = [];
        if (bo.lastIntermediateTouch !== before[0]) fired.push('intermediate');
        if (bo.lastPeriodicTouch !== before[1]) fired.push('periodic');
        if (bo.lastLongTouch !== before[2]) fired.push('long');
        return fired;
    };

    it('back-dates the touches on the first call so every block fires, then uses >=', () => {
        const bo = galaxy.builtObjects[0];
        bo.lastTouch = bo.lastIntermediateTouch = bo.lastPeriodicTouch = bo.lastLongTouch = MIN_TIME;
        const t = 500000;
        expect(fire(bo, t)).toEqual(['intermediate', 'periodic', 'long']);
        expect([bo.lastTouch, bo.lastIntermediateTouch, bo.lastPeriodicTouch, bo.lastLongTouch]).toEqual([t, t, t, t]);
        // 3664-3667 allocates StellarObject[20]; the intermediate block's ThreatEvaluation (M4n) then replaces it with the
        // evaluated list (≤ 10 from IdentifySystemThreatsToUs, ≤ 20 from EvaluateThreats).
        expect(bo.threats).not.toBeNull();
        expect(bo.threats!.length).toBeLessThanOrEqual(20);
        expect(fire(bo, t + 2999)).toEqual([]);
        expect(fire(bo, t + 3000)).toEqual(['intermediate']);
        expect(fire(bo, t + 10000)).toEqual(['intermediate', 'periodic']);
        expect(fire(bo, t + 60000)).toEqual(['intermediate', 'periodic', 'long']);
    });

    it('runs the ExecuteCommands loop once for a ship without a mission (the epilogue reaches AutoRefuelRepairShip, ported by M4e, and no M4e stub)', () => {
        // M4b ported ExecuteCommands: with no mission the no-command epilogue (BuiltObject.2.cs 4494-4574) runs
        // AssignQueuedMission (no queued missions) then RevertToPreviousMission → AutoRefuelRepairShip. That was the M4e
        // stub marker here until M4e ported it; now the call must not reach any remaining M4e stub.
        const bo = galaxy.builtObjects[1];
        builtObjectDoTasks(galaxy, bo, 5000, 0); // first call: _LastTouch = now, dt = 0 ⇒ no ExecuteCommands
        resetTodoCounts();
        builtObjectDoTasks(galaxy, bo, 6000, 0);
        expect(Object.keys(todoHits()).filter((k) => k.startsWith('M4e '))).toEqual([]);
    });
});

describe('ShipGroup.DoTasks (ShipGroup.cs 97)', () => {
    it('stamps the first touch, runs the periodic block on the first call, then >= spans', () => {
        // The block subroutines are ported (M4l), so a block is detected by the touch it stamps at its end
        // (the intermediate block stamps _LastTouch, the periodic block _LastPeriodicTouch).
        const sg = new ShipGroup(galaxy);
        sg.empire = galaxy.empires[1];
        const fired = (time: number): string[] => {
            const touch = sg.lastTouch;
            const periodic = sg.lastPeriodicTouch;
            shipGroupDoTasks(galaxy, sg, time);
            const out: string[] = [];
            if (sg.lastTouch !== touch && touch !== MIN_TIME) out.push('intermediate');
            if (sg.lastPeriodicTouch !== periodic) out.push('periodic');
            return out;
        };
        expect(fired(1000)).toEqual(['periodic']);
        expect(sg.lastTouch).toBe(1000);
        expect(fired(3999)).toEqual([]);
        expect(fired(4000)).toEqual(['intermediate']);
        expect(fired(11000)).toEqual(['intermediate', 'periodic']);
    });
});

describe('Galaxy.DoTasks (Galaxy.cs 3054) and DoTasksTimeSensitive (3046)', () => {
    const markers = { long: 'M4s doSuperPirateTasks' }; // (M4s2 ported CheckForTerminatedPirateEmpires)
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
        // M4s1 ported ReviewPirateMissionsAndAssign; ProcessDelayedEventActions (3050) runs in the same call.
        expect(todoHits()['deferred processDelayedEventActions']).toBe(2);
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
        // DoTasksTimeSensitive every frame (ReviewPirateMissionsAndAssign is ported by M4s1; ProcessDelayedEventActions is the stub).
        expect(todoHits()['deferred processDelayedEventActions']).toBe(21);
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
        // Every habitat in the round-robin window is ticked. Since M4f ships have missions, a ship whose MoveTo targets a
        // moon also ticks the moon's parent planet (BuiltObject.2.cs ExecuteCommands, missions/executeCommands.ts), so a
        // planet outside the window may carry this frame's touch too.
        const window = [...Array.from({ length: 990 }, (_, i) => i), ...Array.from({ length: 10 }, (_, i) => n - 10 + i)];
        for (const i of window) expect(ticked).toContain(i);
        for (const i of ticked.filter((x) => !window.includes(x))) expect(g.habitats.some((m) => m.parent === g.habitats[i])).toBe(true);
        expect(s.habitatCursor).toBe(990);
    });

    it('ticks every built object each frame while there are at most 1000 (cursor ends at Count)', () => {
        const s = schedulerState(g);
        // The deferred Empire / Galaxy ticks at the end of the frame can add ships (M4s2 pirate construction), so the
        // cursor is compared with the list as it was when the built objects were ticked.
        const before = g.builtObjects.slice();
        // A full round (Count iterations) from cursor c ends back at c, or at Count when c is 0 / past the end.
        const start = s.builtObjectCursor;
        runSimFrame(g, 16);
        expect(before.every((b) => b == null || b.lastTouch === g.nowMs)).toBe(true);
        expect(s.builtObjectCursor).toBe(start === 0 || start >= before.length ? before.length : start);
    });
});

describe('game-start switch-over entry points (tick/gameStart.ts)', () => {
    it('run the real Empire / Galaxy / Habitat skeletons at the current game time without throwing', () => {
        galaxy.nowMs = 0;
        for (const e of galaxy.empires) {
            resetEmpireTouchTimesForAge(galaxy, e);
            // Start.2.cs 1114-1121 back-dates all six touches by 121 s: short..long fire at 1341, huge does not.
            // (No unconditional stub is left in the long / huge blocks: detected by their touches.)
            expect(firedBlocks({ long: touchProbe(() => galaxy, () => e, 'lastLongTouch'), huge: touchProbe(() => galaxy, () => e, 'lastHugeTouch') }, () => runGameStartEmpireTick(galaxy, e))).toEqual(['long']);
            staggerEmpireTouchTimes(galaxy, e, 17);
            expect(e.lastLongTouch).toBe(-17000);
            expect(e.lastHugeTouch).toBe(-17000); // Start.2.cs 1350 sets LastHugeTouch too
        }
        resetTodoCounts();
        runGameStartGalaxyTick(galaxy);
        expect([galaxy.lastGalaxyProcessTime, galaxy.lastGalaxyHugeProcessTime]).toEqual([0, 0]);
        expect(todoHits()['M4s doSuperPirateTasks']).toBe(1);
        expect(runGameStartHabitatTick(galaxy, galaxy.empires[0].capital!)).toBe(true);
    });
});
