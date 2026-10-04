// M4a: the frame driver — which objects get DoTasks each frame (tasks/M4-plan.md §1.1, §5.1).
//
// Ports of the UI-side loop: Main.Part12.cs 4121 ProgramLoop (per rendered frame: read CurrentDateTime /
// CurrentStarDate once, ProcessMain, method_86), Main.Part11.cs 507 method_123 + 533 ProcessMain (the level-of-detail
// pass for what the camera sees — optional `view` input) and Main.Part12.cs 3517-3743 method_86 (staggered
// background pass: per-frame budgets and round-robin cursors int_48..int_58).
//
// Determinism contract (plan §0/§5.1):
// - Fixed-step, single-threaded. One sim frame = FRAME_REAL_MS (1000/60) × timeSpeed game ms, quantised to integer
//   ms with an exact integer carry (1000·speed per 60 frames), so results never depend on the display refresh rate.
// - The C# hands Galaxy.DoTasks / Empire.DoTasks (incl. pirate factions) to worker threads (method_94 enqueues,
//   method_96 3919-3990 executes) concurrently with the main-thread Habitat / BuiltObject / Creature ticks. The TS
//   runs that queue at the END of the frame, in enqueue order (Galaxy first when it fires in the same frame — it is
//   enqueued first). This is the one ordering the C# leaves undefined.
// - No view ⇒ no in-view LOD pass (tests, headless). With a view, in-view objects also tick with inView = true.
// - Paused ⇒ no frames (the C# loop keeps calling DoTasks with a frozen clock; with dt = 0 only the round-robin
//   cursors would move).

import { battleReportsFrameEnd } from '../battleReports/battleReports';
import { processConstructionBoard } from '../player/constructionBoard';
import { gameVictoryArgs } from '../victory';
import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { BuiltObject } from '../builtObject';
import type { Habitat } from '../types';
import { galaxyNow, galaxyStarDate, syncLegacySecondsClock } from './simTime';
import { galaxyDoTasks, galaxyDoTasksTimeSensitive } from './galaxyTick';
import { empireDoTasks } from './empireTick';
import { builtObjectDoTasks } from './builtObjectTick';
import { habitatDoTasks } from './habitatTick';
import { shipGroupDoTasks } from './shipGroupTick';
import { empireShipGroups } from '../fleets/shipGroup';
import { identifyMechanoidEmpire, warnOfIncomingEnemyFleetsAndPlanetDestroyers } from '../fleets/militaryAI';
import { getBuiltObjectsAtLocation } from '../stationPlacement';
import { drainCommandBoundary, enterSimFrame, leaveSimFrame } from './commandBoundary';
import { ensurePlayerInbox, playerMessagesFrameEnd } from '../playerMessages';

/**
 * Optional per-pass timer (harness `profile`): accumulated wall ms per frame-driver pass. The wall clock is injected
 * by the caller so nothing under src/sim reads a real clock (plan §5.1).
 */
export type TickProfile = Record<string, number>;
let profile: TickProfile | null = null;
let profileClock: () => number = () => 0;
export function setTickProfile(p: TickProfile | null, clock: () => number = () => 0): void {
    profile = p;
    profileClock = clock;
}
function now(): number {
    return profileClock();
}
function addProfile(key: string, start: number): void {
    if (profile !== null) profile[key] = (profile[key] ?? 0) + (now() - start);
}

/** Real ms per sim frame at speed 1 (60 fps). */
export const FRAME_REAL_MS = 1000 / 60;
/** Frames per real second (the integer denominator of the frame-length carry). */
export const FRAMES_PER_SECOND = 60;
/** Main.Part13.cs 277-ish int41 (multiCore budget, backgroundPass "GxHab"): habitats processed per sim frame by the
 * round-robin background pass. Exported so render code (mainView.ts orbit interpolation) can estimate how many sim
 * frames apart a given habitat's real touches land, without duplicating the constant. */
export const HABITAT_TICK_BATCH_SIZE = 1000;

/** Camera input for the level-of-detail pass (Main.Part11.cs 507-610). All fields are the C# UI values. */
export interface SimView {
    /** int_13 / int_14: galaxy coordinates of the view centre. */
    x: number;
    y: number;
    /** mainView.Width / mainView.Height (px). */
    viewWidth: number;
    viewHeight: number;
    /** base.ClientRectangle.Width (px) and double_0 (zoom factor, galaxy units per px). */
    clientWidth: number;
    zoomFactor: number;
}

/** Frame-driver state (Main.cs 3257-3291 int_41..int_58), kept on the galaxy (galaxy.ts M4a section). */
export interface SchedulerState {
    /** int_48: habitat cursor. */
    habitatCursor: number;
    /** int_49 / int_50: in-battle BO cursor (effectively constant, see below) / BO cursor. */
    inBattleCursor: number;
    builtObjectCursor: number;
    /** int_51: creature cursor. */
    creatureCursor: number;
    /** int_52 / int_53: empire cursor / frame counter (every 10th frame). */
    empireCursor: number;
    empireFrameCounter: number;
    /** int_54: galaxy frame counter (every 100th frame). */
    galaxyFrameCounter: number;
    /** int_55 / int_56: fleet-empire cursor / frame counter (every 5th frame). */
    fleetEmpireCursor: number;
    fleetFrameCounter: number;
    /** int_57 / int_58: pirate-empire cursor / frame counter (every 10th frame). */
    pirateCursor: number;
    pirateFrameCounter: number;
    /** int_28 / int_29 / habitat_6: habitat index range and star of the system nearest the camera (method_149). */
    viewHabitatFirst: number;
    viewHabitatLast: number;
    viewSystemStar: Habitat | null;
    /** Frame-length carry: accumulated `1000 × speedMilli / 1000` numerator not yet turned into whole ms (÷ 60). */
    frameCarry: number;
    /** Frames run so far. */
    frames: number;
    /** Worker queue (method_94 / method_96), drained at the end of each frame. */
    queue: (Galaxy | Empire)[];
}

export function createSchedulerState(): SchedulerState {
    // ProgramLoop (Main.Part12.cs 4123-4127) zeroes int_48..int_50, int_52, int_53; the other fields default to 0.
    return {
        habitatCursor: 0,
        inBattleCursor: 0,
        builtObjectCursor: 0,
        creatureCursor: 0,
        empireCursor: 0,
        empireFrameCounter: 0,
        galaxyFrameCounter: 0,
        fleetEmpireCursor: 0,
        fleetFrameCounter: 0,
        pirateCursor: 0,
        pirateFrameCounter: 0,
        viewHabitatFirst: -1,
        viewHabitatLast: -1,
        viewSystemStar: null,
        frameCarry: 0,
        frames: 0,
        queue: [],
    };
}

export function schedulerState(galaxy: Galaxy): SchedulerState {
    if (galaxy.scheduler === null) galaxy.scheduler = createSchedulerState();
    return galaxy.scheduler;
}

/**
 * Game ms for the next frame at `speed` (Galaxy TimeSpeed, 0.25 … 4): floor((carry + 1000·speed) / 60) with the
 * remainder carried, all in integers (speed is taken in 1/1000 steps).
 */
export function nextFrameMs(state: SchedulerState, speed: number): number {
    const speedMilli = Math.round(speed * 1000);
    const acc = state.frameCarry + speedMilli; // (1000 real ms × speedMilli / 1000) per 60 frames
    const ms = Math.floor(acc / FRAMES_PER_SECOND);
    state.frameCarry = acc - ms * FRAMES_PER_SECOND;
    return ms;
}

/** method_94 with one worker queue (int_0 = 1): refuses an object already queued, else appends it. */
function enqueue(state: SchedulerState, item: Galaxy | Empire): boolean {
    if (state.queue.includes(item)) return false;
    state.queue.push(item);
    return true;
}

/** method_96 (Main.Part12.cs 3960-3983): execute queued work in order. */
function drainQueue(galaxy: Galaxy, state: SchedulerState): void {
    // Items enqueued while draining (none today) run in the same pass, like a worker picking them up.
    for (let i = 0; i < state.queue.length; i++) {
        const obj = state.queue[i];
        const t0 = profile !== null ? now() : 0;
        if (obj === galaxy) {
            // ((Galaxy)obj).DoTasks(_Game.IsFinished, _Game.PlayerEmpire, _Game.GlobalVictoryConditions,
            // _Game.PlayerVictoryConditionsToAchieve, _Game.PlayerVictoryConditionsToPrevent) — Game stand-ins on the Galaxy (M4z4).
            galaxyDoTasks(galaxy, galaxy.gameIsFinished, galaxy.playerEmpire, undefined, gameVictoryArgs(galaxy));
            addProfile('galaxy', t0);
        } else {
            const empire = obj as Empire;
            if (empire.active) {
                empireDoTasks(galaxy, empire);
            }
            addProfile(empire.pirateEmpireBaseHabitat !== null ? 'pirateEmpires' : 'empires', t0);
        }
    }
    state.queue.length = 0;
}

/** Main.Part11.cs 1768 method_149: nearest system to the view centre → habitat index range [int_28, int_29]. */
function updateViewSystem(galaxy: Galaxy, state: SchedulerState, view: SimView): void {
    const habitat6 = galaxy.fastFindNearestSystem(view.x, view.y);
    state.viewSystemStar = habitat6;
    let num = state.viewHabitatFirst;
    if (habitat6 !== null) {
        num = habitat6.habitatIndex;
        let num2 = num;
        do {
            num2++;
        } while (num2 < galaxy.habitats.length && galaxy.habitats[num2].parent !== null);
        if (num !== state.viewHabitatFirst) {
            state.viewHabitatFirst = num;
            state.viewHabitatLast = num2 - 1;
        }
    }
}

/** Main.Part11.cs 507 method_123: built objects near the view centre and within the screen ±25000. */
function builtObjectsInView(galaxy: Galaxy, view: SimView): BuiltObject[] {
    const builtObjectList: BuiltObject[] = [];
    const num = -25000;
    const num2 = view.viewWidth + 25000;
    const num3 = -25000;
    const num4 = view.viewHeight + 25000;
    let num5 = Math.trunc(view.clientWidth * view.zoomFactor);
    num5 += galaxy.maxSolarSystemSize * 2;
    const builtObjectsAtLocation = getBuiltObjectsAtLocation(galaxy, view.x, view.y, num5);
    for (let i = 0; i < builtObjectsAtLocation.length; i++) {
        const builtObject = builtObjectsAtLocation[i];
        if (builtObject != null) {
            const num6 = Math.trunc(builtObject.xpos) - view.x + Math.trunc(view.viewWidth / 2);
            const num7 = Math.trunc(builtObject.ypos) - view.y + Math.trunc(view.viewHeight / 2);
            if (num6 >= num && num6 <= num2 && num7 >= num3 && num7 <= num4 && !builtObjectList.includes(builtObject)) {
                builtObjectList.push(builtObject);
            }
        }
    }
    return builtObjectList;
}

/** Main.Part11.cs 533 ProcessMain(time, starDate, builtObjectsInView) — simulation parts only (no UI refresh). */
function processMain(galaxy: Galaxy, state: SchedulerState, time: number, starDate: number, inView: BuiltObject[], view: SimView): void {
    updateViewSystem(galaxy, state, view);
    if (state.viewHabitatFirst >= 0) {
        for (let i = state.viewHabitatFirst; i <= state.viewHabitatLast; i++) {
            if (i < galaxy.habitats.length) {
                const habitat = galaxy.habitats[i];
                if (habitat != null) habitatDoTasks(galaxy, habitat, time);
            }
        }
    }
    for (let j = 0; j < inView.length; j++) {
        if (inView[j] != null) {
            builtObjectDoTasks(galaxy, inView[j], time, starDate, true);
        }
    }
    const star = state.viewSystemStar;
    if (star !== null) {
        const creatures = galaxy.systems[star.systemIndex].creatures ?? [];
        for (let k = 0; k < creatures.length; k++) {
            if (creatures[k] != null) creatures[k].doTasks(time / 1000);
        }
    }
}

/**
 * Perf: the per-frame habitat / built-object batches (up to 1000 each) reuse these arrays instead of allocating two new
 * ones every frame (~400 MB of garbage per 120 game s at 700 stars). Each is filled, walked (still a snapshot: ticks
 * that add or remove galaxy objects do not change the batch) and emptied; backgroundPass is not re-entered from a tick.
 */
const scratchHabitats: Habitat[] = [];
const scratchBuiltObjects: BuiltObject[] = [];

/** Main.Part12.cs 3517 method_86(time, starDate, builtObjectsInView, multiCore). */
function backgroundPass(galaxy: Galaxy, state: SchedulerState, time: number, starDate: number, inView: BuiltObject[], multiCore: boolean): void {
    // 3523-3544 budgets.
    let int41: number;
    let int42: number;
    let int43: number;
    let int44: number;
    let int45: number;
    let int46: number;
    if (multiCore) {
        int41 = HABITAT_TICK_BATCH_SIZE;
        int42 = 150;
        int43 = 1000;
        int44 = 50;
        int45 = 1;
        int46 = 1;
        int41 = Math.min(int41, galaxy.habitats.length);
        int43 = Math.min(int43, galaxy.builtObjects.length);
    } else {
        int41 = 200;
        int42 = 50;
        int43 = 100;
        int44 = 30;
        int45 = 1;
        int46 = 1;
    }
    // Main.Part13.cs 277 int_47 = 1.
    const int47 = 1;
    // 3545
    let t0 = profile !== null ? now() : 0;
    galaxyDoTasksTimeSensitive(galaxy, starDate, time);
    // 3546-3550: every 100th frame enqueue the Galaxy.
    if (state.galaxyFrameCounter % 100 === 0 && enqueue(state, galaxy)) {
        state.galaxyFrameCounter = 0;
    }
    state.galaxyFrameCounter++;
    // 3551-3554 `if (Galaxy.GlobalVictoryConditions == null && _Game.GlobalVictoryConditions != null)` hand-over: createGame
    // assigns Galaxy.globalVictoryConditions itself (Start.2.cs 2026) and the TS keeps no separate Game copy — nothing to do.
    // 3555-3570 UI fleet warnings.
    const empire = identifyMechanoidEmpire(galaxy);
    for (let i = 0; i < galaxy.empires.length; i++) {
        const empire2 = galaxy.empires[i];
        if (empire2 != null) {
            if (empire2 !== galaxy.playerEmpire) {
                warnOfIncomingEnemyFleetsAndPlanetDestroyers(galaxy, empire2, galaxy.playerEmpire);
            }
            if (empire !== null && empire2 !== empire) {
                warnOfIncomingEnemyFleetsAndPlanetDestroyers(galaxy, empire2, empire);
            }
        }
    }
    addProfile('galaxyTimeSensitive+warnings', t0);
    t0 = profile !== null ? now() : 0;
    // 3571-3597 "GxHab": next int_41 habitats round-robin.
    if (galaxy.habitats.length > 0) {
        const habitatList = scratchHabitats;
        habitatList.length = 0;
        let num = state.habitatCursor;
        for (let j = 0; j < int41; j++) {
            if (num >= galaxy.habitats.length) {
                num = 0;
            }
            habitatList.push(galaxy.habitats[num]);
            num++;
        }
        for (let k = 0; k < habitatList.length; k++) {
            if (habitatList[k] != null) habitatDoTasks(galaxy, habitatList[k], time);
        }
        habitatList.length = 0;
        state.habitatCursor = num;
    }
    addProfile('habitats', t0);
    t0 = profile !== null ? now() : 0;
    // 3598-3622 "GxFlt": every 5th frame, one empire's fleets.
    if (galaxy.empires.length > 0) {
        for (let l = 0; l < int46; l++) {
            if (state.fleetEmpireCursor >= galaxy.empires.length) {
                state.fleetEmpireCursor = 0;
            }
            if (state.fleetFrameCounter % 5 === 0) {
                const empire3 = galaxy.empires[state.fleetEmpireCursor];
                if (empire3 != null && empire3.shipGroups != null && empire3.shipGroups.length > 0) {
                    const shipGroups = empireShipGroups(empire3);
                    for (let m = 0; m < shipGroups.length; m++) {
                        const shipGroup = shipGroups[m];
                        if (shipGroup != null) shipGroupDoTasks(galaxy, shipGroup, time);
                    }
                }
                state.fleetFrameCounter = 0;
                state.fleetEmpireCursor++;
            }
            state.fleetFrameCounter++;
        }
    }
    addProfile('fleets', t0);
    t0 = profile !== null ? now() : 0;
    // 3623-3694 "GxBO".
    if (galaxy.builtObjects.length > 0) {
        // builtObjectList_1.Contains (order-neutral, plan §4.4). Perf: no set (and no per-object hash lookup) when nothing
        // is in view — headless runs and a camera over empty space.
        const inViewSet = inView.length > 0 ? new Set(inView) : null;
        const builtObjectList = scratchBuiltObjects;
        builtObjectList.length = 0;
        // (a) 3627-3664 in-battle scan. The decompiled loop never assigns `builtObject` inside the `while`, so it spins
        // until num2 wraps back to num3 and breaks out of the `for`: no object is added and int_49 keeps its value
        // (always 0).
        // Perf: the loop body only walks num2 once around the list (num2++ with wrap) until it meets num3 again, so its
        // outcome is closed-form — num2 === num3 after the first `for` iteration — and nothing else is touched. Walking it
        // cost O(builtObjects) per frame. A cursor at or past the end never meets num3 (the C# spins forever; the literal
        // port threw after length + 1 spins), so that case still throws.
        const num3 = state.inBattleCursor;
        const num2 = num3;
        if (int42 > 0 && num3 >= galaxy.builtObjects.length) {
            throw new Error('scheduler: in-battle scan cursor out of range (C# would loop forever)');
        }
        // (b) 3665-3682: next int_43 BOs round-robin, skipping those ticked in view.
        let num4 = state.builtObjectCursor;
        for (let num5 = 0; num5 < int43; num5++) {
            if (num4 >= galaxy.builtObjects.length) {
                num4 = 0;
            }
            const builtObject2 = galaxy.builtObjects[num4];
            if (builtObject2 != null && (inViewSet === null || !inViewSet.has(builtObject2))) {
                builtObjectList.push(builtObject2);
            }
            num4++;
        }
        // 3683-3693
        for (let num6 = 0; num6 < builtObjectList.length; num6++) {
            if (builtObjectList[num6] != null) builtObjectDoTasks(galaxy, builtObjectList[num6], time, starDate, false);
        }
        builtObjectList.length = 0;
        state.inBattleCursor = num2;
        state.builtObjectCursor = num4;
    }
    addProfile('builtObjects', t0);
    t0 = profile !== null ? now() : 0;
    // 3695-3706 "GxCr": next int_44 creatures round-robin.
    if (galaxy.creatures.length > 0) {
        for (let num7 = 0; num7 < int44; num7++) {
            if (state.creatureCursor >= galaxy.creatures.length) {
                state.creatureCursor = 0;
            }
            const creature = galaxy.creatures[state.creatureCursor];
            if (creature != null) creature.doTasks(time / 1000);
            state.creatureCursor++;
        }
    }
    addProfile('creatures', t0);
    // 3708-3722 "GxEm": every 10th frame enqueue one empire.
    if (galaxy.empires.length > 0) {
        for (let num8 = 0; num8 < int45; num8++) {
            if (state.empireCursor >= galaxy.empires.length) {
                state.empireCursor = 0;
            }
            if (state.empireFrameCounter % 10 === 0 && enqueue(state, galaxy.empires[state.empireCursor])) {
                state.empireFrameCounter = 0;
                state.empireCursor++;
            }
            state.empireFrameCounter++;
        }
    }
    // 3724-3742 "GxEmP": every 10th frame enqueue one pirate faction.
    if (galaxy.pirateEmpires.length <= 0) {
        return;
    }
    for (let num9 = 0; num9 < int47; num9++) {
        if (state.pirateCursor >= galaxy.pirateEmpires.length) {
            state.pirateCursor = 0;
        }
        if (state.pirateFrameCounter % 10 === 0 && enqueue(state, galaxy.pirateEmpires[state.pirateCursor])) {
            state.pirateFrameCounter = 0;
            state.pirateCursor++;
        }
        state.pirateFrameCounter++;
    }
}

export interface FrameOptions {
    /** Camera for the in-view LOD pass; omit for headless / tests (plan §5.1). */
    view?: SimView;
    /** method_86 bool_28 (Environment.ProcessorCount > 1): multi-core budgets. Default true. */
    multiCore?: boolean;
}

/**
 * One ProgramLoop iteration's simulation work (Main.Part12.cs 4207-4219): advance the clock by `frameMs` game ms,
 * read CurrentDateTime / CurrentStarDate once, ProcessMain (with a view), method_86, then the worker queue.
 */
export function runSimFrame(galaxy: Galaxy, frameMs: number, opts: FrameOptions = {}): void {
    // Command log (tasks/M4-agent-brief.md): queued external commands apply here, at the frame boundary, stamped with
    // the sim time before the clock advances. Nothing queued ⇒ nothing happens (the no-command digest is unchanged).
    // The player's message pipeline receives from here on (playerMessages.ts; a no-op once attached).
    ensurePlayerInbox(galaxy);
    drainCommandBoundary(galaxy);
    enterSimFrame();
    try {
        runSimFrameBody(galaxy, frameMs, opts);
    } finally {
        leaveSimFrame();
    }
}

function runSimFrameBody(galaxy: Galaxy, frameMs: number, opts: FrameOptions): void {
    const state = schedulerState(galaxy);
    galaxy.nowMs += frameMs;
    syncLegacySecondsClock(galaxy);
    const time = galaxyNow(galaxy);
    const starDate = galaxyStarDate(galaxy);
    let inView: BuiltObject[] = [];
    if (opts.view !== undefined) {
        inView = builtObjectsInView(galaxy, opts.view);
        processMain(galaxy, state, time, starDate, inView, opts.view);
    }
    backgroundPass(galaxy, state, time, starDate, inView, opts.multiCore ?? true);
    drainQueue(galaxy, state);
    // Not in the C#: the player's construction job board (O(1) unless it changed; player/constructionBoard.ts).
    processConstructionBoard(galaxy);
    // Main's UI thread between two sim frames: what the sim sent the player this frame, in arrival order — the
    // BeginInvoke'd ReceiveMessageInternal / method_523 / PromptForAuthorizationInternal calls — then the advisor queue's
    // age expiry (playerMessages.ts; the C# runs them whenever its UI thread gets to them, the port at this fixed point
    // so that the game stays replayable).
    playerMessagesFrameEnd(galaxy);
    // Mod layer (an Improvement, not in the C#): the battle-report observer — reads only, no Rnd, outside the digest;
    // one comparison per frame, a scan once per game second (battleReports/battleReports.ts).
    battleReportsFrameEnd(galaxy, frameMs);
    state.frames++;
}

/**
 * Real-time driver for the app: accumulates real ms and runs whole sim frames (at most `maxFrames` per call) so the
 * outcome does not depend on the display refresh rate. Returns the number of frames run. Nothing runs while paused.
 */
export class SimDriver {
    private realAccumulator = 0;

    /**
     * Live pause probe, read before EVERY sim frame (not only once per advance): the C# game-end (Main.Part12.cs
     * method_154 DoGameEnd) pauses from inside a tick, and the next frame must not run. The app binds it to the HUD
     * clock (`() => time.paused`).
     */
    isPaused: (() => boolean) | null = null;

    constructor(
        readonly galaxy: Galaxy,
        public speed = 1.0,
        public paused = false,
        public maxFrames = 4,
    ) {}

    private pausedNow(): boolean {
        return this.paused || (this.isPaused !== null && this.isPaused());
    }

    advance(realDtMs: number, opts: FrameOptions = {}): number {
        if (this.pausedNow()) {
            // Orders given while paused land at once (the clock is frozen: same boundary as the next frame's start).
            drainCommandBoundary(this.galaxy);
            return 0;
        }
        this.realAccumulator += realDtMs;
        let frames = 0;
        while (this.realAccumulator >= FRAME_REAL_MS && frames < this.maxFrames) {
            if (this.pausedNow()) break;
            this.realAccumulator -= FRAME_REAL_MS;
            runSimFrame(this.galaxy, nextFrameMs(schedulerState(this.galaxy), this.speed), opts);
            frames++;
        }
        if (frames === this.maxFrames) this.realAccumulator = Math.min(this.realAccumulator, FRAME_REAL_MS);
        return frames;
    }
}
