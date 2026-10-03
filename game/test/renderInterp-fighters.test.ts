// Fighters, shots and space creatures drawn smoothly between the round-robin touches that move them
// (src/render/renderInterp.ts sampleFighter / sampleShot / sampleCreature; effectsLayer.ts shotFlightSpeed).
//
// The sim moves these only when their owner is ticked by the background pass (scheduler.ts backgroundPass):
// - fighters and the shots ships and fighters fire, when the carrier / firer's BuiltObject.DoTasks runs — 1000 built
//   objects a step ("GxBO" int_43), so with more each one moves every ceil(n / 1000) steps;
// - creatures, 50 a step ("GxCr" int_44): on the seed-1 harness galaxy (~340 creatures) every 7 steps.
// Their committed position then moves several steps' worth at once and stands still in between; lerped between the
// last two steps that shows as a stutter — the drawn object moves in bursts, then stops (the user's "fighters are not
// smooth moving, they jump"). Sampled at where the next touch will put them (extrapolated from their LastTouch along
// heading × speed, turning toward TargetHeading) they glide.
//
// Each run feeds the same sim steps to two interpolators: one with the extrapolation bounds at 0 (the old behaviour)
// and one as MainView sets it up, and measures every track's drawn motion at 4 render frames per sim step:
// reversals (a frame's move pointing back against the previous one), the largest frame-to-frame change of the move
// vector (jerk; a smooth path changes it by next to nothing) and stalls (a moving object drawn standing still a frame).
import { beforeAll, describe, expect, it } from 'vitest';
import { createGame, type Game } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import type { BuiltObject } from '../src/sim/builtObject';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { tickGameOptions } from './helpers/tickGame';
import { cachedTickGame } from './helpers/gameCache';
import { playerCarrierPort, pirateEscort } from './helpers/combatCast';
import { runGameSeconds } from '../src/sim/tick/harness';
import { runSimFrame } from '../src/sim/tick/scheduler';
import { buildNewFighters, fightersOf, type Fighter } from '../src/sim/combat/fighters';
import { updateIndexesForMovement, updatePosition } from '../src/sim/movement';
import { builtObjectMission } from '../src/sim/missions/mission';
import { BuiltObjectFleeWhen } from '../src/sim/data/designSpecifications';
import { ComponentCategoryType } from '../src/sim/data/policies';
import { ComponentStatus } from '../src/sim/builtObjectComponent';
import { MotionInterpolator, createRenderTime, habitatTouchClampSeconds, sampleBuiltObject, sampleCreature, sampleFighter, sampleShot, type RenderTime } from '../src/render/renderInterp';
import { fighterShotFlightSpeed, shotFlightSpeed } from '../src/render/effectsLayer';
import { creatureAnimSeconds } from '../src/render/creatureLayer';

const STEP_MS = 17;
const SUBFRAMES = 4;
/** World units per frame below which a move is invisible (a hundredth of a pixel at the closest zoom). */
const MIN_MOVE = 0.01;

/** Per-track drawn motion (as renderInterp-parentFrame.test.ts), the first `skipSteps` steps of a track left out (the
 * first sight snaps; a shot's launch step moves a fixed 2 / 10 units). */
class Jitter {
    private seen = 0;
    reversals = 0;
    maxJerk = 0;
    frames = 0;
    stalls = 0;
    private lx = Number.NaN;
    private ly = Number.NaN;
    private ldx = Number.NaN;
    private ldy = Number.NaN;
    constructor(
        private skipSteps = 2,
        /** A shot's LastFired: the weapon record is reused, a new value is a new shot (a new track). */
        readonly epoch = 0,
    ) {}
    add(x: number, y: number): void {
        if (!Number.isNaN(this.lx)) {
            const dx = x - this.lx;
            const dy = y - this.ly;
            if (!Number.isNaN(this.ldx) && ++this.seen > this.skipSteps * SUBFRAMES) {
                this.frames++;
                // Reversals and stalls count only where the motion is visible at all (MIN_MOVE).
                const visible = Math.max(Math.hypot(dx, dy), Math.hypot(this.ldx, this.ldy)) >= MIN_MOVE;
                if (visible && dx * this.ldx + dy * this.ldy < 0) this.reversals++;
                this.maxJerk = Math.max(this.maxJerk, Math.hypot(dx - this.ldx, dy - this.ldy));
                if (visible && dx === 0 && dy === 0) this.stalls++;
            }
            this.ldx = dx;
            this.ldy = dy;
        }
        this.lx = x;
        this.ly = y;
    }
}

interface Stats {
    tracks: number;
    frames: number;
    reversals: number;
    maxJerk: number;
    stalls: number;
}

function total(m: Map<unknown, Jitter>, done: Jitter[]): Stats {
    const s: Stats = { tracks: m.size + done.length, frames: 0, reversals: 0, maxJerk: 0, stalls: 0 };
    for (const j of [...m.values(), ...done]) {
        s.frames += j.frames;
        s.reversals += j.reversals;
        s.maxJerk = Math.max(s.maxJerk, j.maxJerk);
        s.stalls += j.stalls;
    }
    return s;
}

const fmt = (s: Stats) => `tracks=${s.tracks} frames=${s.frames} reversals=${s.reversals} maxJerk=${s.maxJerk.toFixed(3)} stalls=${s.stalls}`;

/** One interpolator and its tracks. `extrapolate` false: the extrapolation bounds zeroed (the previous behaviour). */
class Run {
    readonly m = new MotionInterpolator();
    fighters = new Map<Fighter, Jitter>();
    shots = new Map<object, Jitter>();
    creatures = new Map<object, Jitter>();
    private done = { fighters: [] as Jitter[], shots: [] as Jitter[], creatures: [] as Jitter[] };
    constructor(private extrapolate: boolean) {}
    frame(g: Galaxy, rt: RenderTime, watched: ReadonlySet<BuiltObject> | null): void {
        const m = this.m;
        m.begin(rt, habitatTouchClampSeconds(g.habitats.length), g.builtObjects.length, g.creatures.length, g.habitats.length);
        if (!this.extrapolate) m.untouchedMaxMs = m.creatureUntouchedMaxMs = m.habitatUntouchedMaxMs = 0;
        for (const bo of g.builtObjects) {
            if (bo === null || bo.hasBeenDestroyed) continue;
            sampleBuiltObject(m, bo);
            if (watched !== null && !watched.has(bo)) continue;
            for (const w of bo.weapons ?? []) {
                if (w == null) continue;
                if (!(w.distanceTravelled >= 0) || w.resetNext) {
                    this.end(this.shots, w, this.done.shots);
                    continue;
                }
                const st = sampleShot(m, w, bo.lastTouch, shotFlightSpeed(w.component.type, w.speed, w.distanceTravelled, w.resetNext));
                this.shotTrack(g, w, w.lastFired).add(st.x, st.y);
            }
            for (const f of fightersOf(bo) ?? []) {
                if (f.onboardCarrier || f.hasBeenDestroyed) {
                    this.end(this.fighters, f, this.done.fighters);
                    continue;
                }
                const st = sampleFighter(m, f);
                this.track(this.fighters, f, 2).add(st.x, st.y);
                for (const w of f.weapons) {
                    if (!(w.distanceTravelled >= 0) || w.resetNext) {
                        this.end(this.shots, w, this.done.shots);
                        continue;
                    }
                    const s2 = sampleShot(m, w, f.lastTouch, fighterShotFlightSpeed(w.category, w.speed, w.distanceTravelled, w.resetNext));
                    this.shotTrack(g, w, w.lastFired).add(s2.x, s2.y);
                }
            }
        }
        for (const c of g.creatures) {
            if (c === null || c.hasBeenDestroyed) continue;
            const st = sampleCreature(m, c);
            // Sub-light cruising only (hyperspeed legs end in a relocation; coming to rest is not a stutter).
            if (!(c.currentSpeed > 0) || !(c.targetSpeed > 0) || c.currentSpeed > Math.max(c.movementSpeed, c.lungeSpeed)) {
                this.end(this.creatures, c, this.done.creatures);
                continue;
            }
            this.track(this.creatures, c, 2 * Math.ceil(g.creatures.length / 50)).add(st.x, st.y);
        }
    }
    /** A shot's track, from its launch: the first three firer touches are left out — the spawn, the launch step's fixed
     * 2 / 10 units, and a missile's ramp start (Speed × DistanceTravelled / 120): the sim's own jerk, as the original. */
    private shotTrack(g: Galaxy, w: object, lastFired: number): Jitter {
        let j = this.shots.get(w);
        if (j !== undefined && j.epoch !== lastFired) {
            this.end(this.shots, w, this.done.shots);
            j = undefined;
        }
        if (j === undefined) this.shots.set(w, (j = new Jitter(3 * Math.ceil(g.builtObjects.length / 1000), lastFired)));
        return j;
    }
    private track<K>(map: Map<K, Jitter>, k: K, skip: number): Jitter {
        let j = map.get(k);
        if (j === undefined) map.set(k, (j = new Jitter(skip)));
        return j;
    }
    private end<K>(map: Map<K, Jitter>, k: K, done: Jitter[]): void {
        const j = map.get(k);
        if (j === undefined) return;
        done.push(j);
        map.delete(k);
    }
    stats(): { fighters: Stats; shots: Stats; creatures: Stats } {
        return { fighters: total(this.fighters, this.done.fighters), shots: total(this.shots, this.done.shots), creatures: total(this.creatures, this.done.creatures) };
    }
}

/** Steps `g` `steps` times, drawing SUBFRAMES frames per step through both runs. */
function drive(g: Galaxy, steps: number, runs: Run[], watched: ReadonlySet<BuiltObject> | null): void {
    const rt = createRenderTime();
    rt.stepGameMs = STEP_MS;
    for (let s = 0; s < steps; s++) {
        runSimFrame(g, STEP_MS);
        for (let k = 0; k < SUBFRAMES; k++) {
            rt.alpha = k / SUBFRAMES;
            rt.stepSerial += k === 0 ? 1 : 0;
            rt.simNowMs = g.nowMs;
            rt.renderNowMs = g.nowMs + rt.alpha * STEP_MS;
            for (const r of runs) r.frame(g, rt, watched);
        }
    }
}

/** Moves a ship (re-indexing it) and detaches it from any parent offset (combatScenarios.test.ts place). */
function place(g: Galaxy, b: BuiltObject, x: number, y: number): void {
    const ix = Math.trunc(Math.trunc(b.xpos) / 400000);
    const iy = Math.trunc(Math.trunc(b.ypos) / 400000);
    b.parentBuiltObject = null;
    b.parentHabitat = null;
    b.parentOffsetX = -2000000001.0;
    b.parentOffsetY = -2000000001.0;
    b.xpos = x;
    b.ypos = y;
    updateIndexesForMovement(g, b, ix, iy, true);
    updatePosition(g, b);
}

describe('fighters, shots and creatures are drawn smoothly between round-robin touches', () => {
    const STAR_COUNT = 4000;
    let game: Game;
    beforeAll(async () => {
        const gameData = await loadGameDataFs();
        const o = tickGameOptions(gameData);
        game = createGame({ ...o, starCount: STAR_COUNT, sectorWidth: 15, sectorHeight: 15, systemNames: Array.from({ length: STAR_COUNT }, (_, i) => `S${i}`) });
        runGameSeconds(game, 30);
    }, 1_800_000);

    it('4000-star galaxy (> 1000 built objects): a carrier base launches its fighters at a pirate escort; fighters and every shot fired glide', () => {
        const g = game.galaxy;
        expect(g.builtObjects.length).toBeGreaterThan(1000);
        // Combat scenario (3) of combatScenarios.test.ts: the player's carrier port with its fighters built, a pirate escort
        // with its engines out (it holds position) 670 away — inside the base's 3000 engage range and the fighter leash.
        const port = playerCarrierPort(g);
        buildNewFighters(g, port);
        for (const f of fightersOf(port)!) {
            f.health = 1;
            f.underConstruction = false;
        }
        const pir = pirateEscort(g, 0);
        builtObjectMission(pir.mission)?.clear();
        pir.isAutoControlled = false;
        pir.design.fleeWhen = BuiltObjectFleeWhen.Never;
        for (const c of pir.components.items) if (c.category === ComponentCategoryType.Engine) c.status = ComponentStatus.Damaged;
        pir.reDefine();
        place(g, pir, port.xpos + 600, port.ypos + 300);
        const before = new Run(false);
        const after = new Run(true);
        drive(g, 1200, [before, after], new Set([port, pir]));
        const b = before.stats();
        const a = after.stats();
        console.log(`[fighters 4000-star] builtObjects=${g.builtObjects.length} touched every ${Math.ceil(g.builtObjects.length / 1000)} steps`);
        console.log(`  fighters before: ${fmt(b.fighters)}\n  fighters after:  ${fmt(a.fighters)}`);
        console.log(`  shots    before: ${fmt(b.shots)}\n  shots    after:  ${fmt(a.shots)}`);
        expect(a.fighters.frames).toBeGreaterThan(5000);
        expect(a.shots.tracks).toBeGreaterThan(5);
        // Before: bursts — the drawn fighter moves two steps' worth in one, then stands still for a step.
        expect(b.fighters.stalls).toBeGreaterThan(1000);
        expect(a.fighters.stalls).toBe(0);
        expect(a.fighters.reversals).toBeLessThanOrEqual(b.fighters.reversals);
        expect(a.fighters.maxJerk).toBeLessThan(b.fighters.maxJerk / 2);
        // Includes the out-of-view leash reset when the fight ends (Fighter.cs 1805: every fighter beyond 600 of its
        // carrier moved onto that circle in one step, 40-180 units): eased out (FIGHTER_SOFT_SNAP_MS), not a pop.
        expect(a.fighters.maxJerk).toBeLessThan(0.25);
        expect(b.shots.stalls).toBeGreaterThan(50);
        expect(a.shots.stalls).toBe(0);
        expect(a.shots.reversals).toBe(0);
        expect(a.shots.maxJerk).toBeLessThan(b.shots.maxJerk / 2);
        expect(a.shots.maxJerk).toBeLessThan(1); // a missile's speed ramp over its first 120 units
    }, 1_800_000);
});

describe('space creatures on the seed-1 harness galaxy (moved every ceil(creatures / 50) steps)', () => {
    it('cruising creatures glide: no stalls, far less jerk than the burst-lerp', async () => {
        const gameData = await loadGameDataFs();
        const g = cachedTickGame(gameData, { seconds: 60 }).galaxy;
        expect(g.creatures.length).toBeGreaterThan(100);
        const before = new Run(false);
        const after = new Run(true);
        drive(g, 600, [before, after], new Set());
        const b = before.stats().creatures;
        const a = after.stats().creatures;
        console.log(`[creatures seed-1] creatures=${g.creatures.length} touched every ${Math.ceil(g.creatures.length / 50)} steps`);
        console.log(`  before: ${fmt(b)}\n  after:  ${fmt(a)}`);
        expect(a.frames).toBeGreaterThan(5000);
        expect(b.stalls).toBeGreaterThan(1000);
        expect(a.stalls).toBe(0);
        expect(a.reversals).toBeLessThanOrEqual(b.reversals);
        expect(a.maxJerk).toBeLessThan(b.maxJerk / 2);
        expect(a.maxJerk).toBeLessThan(0.1);
    }, 1_800_000);
});

describe('creature animation clock (creatureLayer.ts)', () => {
    it('runs on the interpolated render instant: advances every render frame, holds while paused', () => {
        // 4 render frames per 17 ms step, then a pause (alpha 0, the committed instant unchanged).
        const committed: number[] = [];
        const render: number[] = [];
        let now = 1_000_000;
        for (let s = 0; s < 30; s++) {
            now += STEP_MS;
            for (let k = 0; k < SUBFRAMES; k++) {
                committed.push(creatureAnimSeconds(now)); // galaxy.nowMs: the previous frame-set clock
                render.push(creatureAnimSeconds(now + (k / SUBFRAMES) * STEP_MS)); // RenderTime.renderNowMs
            }
        }
        const frozen = (a: number[]) => a.slice(1).filter((v, i) => v === a[i]).length;
        console.log(`[creature clock] frames=${render.length} frozen frames: committed time ${frozen(committed)}, render time ${frozen(render)}`);
        expect(frozen(committed)).toBe(30 * (SUBFRAMES - 1));
        expect(frozen(render)).toBe(0);
        // Paused: renderNowMs = nowMs every frame, so the clock holds (the former wall clock kept the rigs moving).
        expect(creatureAnimSeconds(now)).toBe(creatureAnimSeconds(now));
        // Wrapped to a day for the rigs' sines, continuous across the wrap of every rig period (whole seconds).
        expect(creatureAnimSeconds(86_400_000 + 1500)).toBeCloseTo(1.5, 9);
        expect(creatureAnimSeconds(-500)).toBeCloseTo(86_399.5, 9);
    });
});
