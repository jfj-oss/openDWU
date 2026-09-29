// Render interpolation in very large galaxies (src/render/renderInterp.ts sampleBuiltObject / extrapolateUntouched), on a
// real 4000-star galaxy (createGame + a 30 s warm-up, ~10 s in all): with more than 1000 built objects the background
// pass (scheduler.ts backgroundPass "GxBO") touches each ship only every ceil(n / 1000) steps, so its committed position
// stands still and then jumps. The drawn position is extrapolated from the last touch along heading × CurrentSpeed.
// Over 120 sim steps drawn at 4 render frames each, every free-flying moving ship must move continuously: no frame move
// larger than 1.5 × the per-frame expected move (its speed, or the committed move of its latest touch spread over one
// step), and no stall (a cruising ship drawn standing still) — which is what the same run shows without extrapolation.
// Intended snaps (isJump, a switch into / out of a ParentHabitat frame), warp legs and docked ships are left out.
import { beforeAll, describe, expect, it } from 'vitest';
import { createGame, type Game } from '../src/sim/game';
import type { BuiltObject } from '../src/sim/builtObject';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { tickGameOptions } from './helpers/tickGame';
import { runGameSeconds } from '../src/sim/tick/harness';
import { runSimFrame } from '../src/sim/tick/scheduler';
import { MotionInterpolator, createRenderTime, habitatTouchClampSeconds, isJump, sampleBuiltObject } from '../src/render/renderInterp';

const STAR_COUNT = 4000;
const STEP_MS = 17; // one sim step at 1x (integer game ms)
const SUBFRAMES = 4; // render frames per sim step (a 240 Hz display)
const STEPS = 120;
/** Moves below half a world unit per frame are sub-pixel even at the closest zoom (1 px per unit): not a visible jump. */
const MIN_VISIBLE = 0.5;

let game: Game;

beforeAll(async () => {
    const gameData = await loadGameDataFs();
    const o = tickGameOptions(gameData);
    game = createGame({ ...o, starCount: STAR_COUNT, sectorWidth: 15, sectorHeight: 15, systemNames: Array.from({ length: STAR_COUNT }, (_, i) => `S${i}`) });
    runGameSeconds(game, 30);
}, 1_800_000);

interface Track {
    x: number;
    y: number;
    speed: number;
    /** |CurrentSpeed| over the last 2 × SUBFRAMES + 1 frames: the lerp draws the previous step's motion, and a speed
     * change (a hyperjump exit) shows up a step late. */
    speeds: number[];
    /** Drawn in galaxy coordinates (not in an orbiting ParentHabitat's frame) at that frame. */
    free: boolean;
    /** Sim step of the last switch into / out of a ParentHabitat's frame (a snap: its next step's lerp starts there). */
    switchStep: number;
    /** The committed position / LastTouch at the latest touch, and the committed per-frame rate of the last two touch
     * intervals (the sim's own motion: CurrentSpeed alone misses moves such as arrival legs or several commands in one
     * DoTasks). */
    tx: number;
    ty: number;
    touch: number;
    rate: number;
    prevRate: number;
}

/** Worst frame-to-frame drawn move / allowed move over STEPS sim steps, for every moving free-flying ship. */
function measure(extrapolate: boolean): { worst: number; samples: number; bad: number; stalls: number } {
    const g = game.galaxy;
    const m = new MotionInterpolator();
    const rt = createRenderTime();
    rt.stepGameMs = STEP_MS;
    const last = new Map<BuiltObject, Track>();
    let worst = 0;
    let samples = 0;
    let bad = 0;
    let stalls = 0;
    for (let s = 0; s < STEPS; s++) {
        runSimFrame(g, STEP_MS);
        for (let k = 0; k < SUBFRAMES; k++) {
            rt.alpha = k / SUBFRAMES;
            rt.stepSerial += k === 0 ? 1 : 0;
            rt.simNowMs = g.nowMs;
            rt.renderNowMs = g.nowMs + rt.alpha * STEP_MS;
            m.begin(rt, habitatTouchClampSeconds(g.habitats.length), g.builtObjects.length);
            if (!extrapolate) m.untouchedMaxMs = 0;
            for (const bo of g.builtObjects) {
                if (bo === null || bo.hasBeenDestroyed) continue;
                const prev = last.get(bo);
                const x0 = prev?.x ?? 0;
                const y0 = prev?.y ?? 0;
                const st = sampleBuiltObject(m, bo);
                const speed = Math.abs(bo.currentSpeed);
                let rate = prev?.rate ?? 0;
                let prevRate = prev?.prevRate ?? 0;
                if (prev !== undefined && bo.lastTouch !== prev.touch) {
                    // The committed move of this touch, as drawn over one step (a relocation the sim made in one touch —
                    // an arrival leg, several commands in one DoTasks — is lerped over the next step).
                    prevRate = rate;
                    rate = Math.hypot(bo.xpos - prev.tx, bo.ypos - prev.ty) / SUBFRAMES;
                }
                // Only ships flying free in galaxy coordinates at sub-light speed on both frames.
                const speeds = prev?.speeds ?? [];
                speeds.push(speed);
                if (speeds.length > 2 * SUBFRAMES + 1) speeds.shift();
                const recent = Math.max(...speeds);
                // Docked / docking objects are carried by their dock (a base parked at an orbiting planet, which itself
                // moves in round-robin jumps): not their own motion, left out.
                const free = st.frame === null && speed > 0 && recent <= bo.topSpeed && bo.dockedAt === null;
                // A switch into / out of a ParentHabitat's frame snaps by design (MotionInterpolator.sample): not motion;
                // left out for that step and the next.
                // Warp legs (hyperjump) are left out with `recent <= topSpeed`.
                // Step 0 is the interpolator's first sight of every ship (a snap) and step 1 opens its first lerp from
                // there: measured from step 2 on.
                const switchStep = prev !== undefined && prev.free !== (st.frame === null) ? s : (prev?.switchStep ?? -10);
                if (s > 1 && prev !== undefined && free && prev.free && s - switchStep > 1 && prev.speed > 0) {
                    const dx = st.x - x0;
                    const dy = st.y - y0;
                    // A snap (isJump over one step) is the interpolator's intended discontinuity: not motion.
                    if (!isJump(dx, dy, 1, Math.max(bo.topSpeed, bo.warpSpeed), STEP_MS / 1000)) {
                        const expected = (recent * STEP_MS) / 1000 / SUBFRAMES;
                        const allowed = Math.max(expected, rate, prevRate, MIN_VISIBLE);
                        const move = Math.hypot(dx, dy);
                        const r = move / allowed;
                        samples++;
                        // A stall: a ship cruising at a steady speed, which the sim did move at its latest touch (a fleet
                        // holding to sync keeps its CurrentSpeed but stays put), drawn standing still for a frame — what
                        // the round-robin touch gap looks like without extrapolation.
                        if (Math.min(...speeds) > 0.9 * recent && expected > 0.01 && rate > 0.5 * expected && move < 0.25 * expected) stalls++;
                        if (r > worst) worst = r;
                        if (r > 1.5) bad++;
                    }
                }
                const touched = prev === undefined || bo.lastTouch !== prev.touch;
                last.set(bo, {
                    x: st.x,
                    y: st.y,
                    speed,
                    speeds,
                    free: st.frame === null,
                    switchStep,
                    tx: touched ? bo.xpos : prev.tx,
                    ty: touched ? bo.ypos : prev.ty,
                    touch: bo.lastTouch,
                    rate,
                    prevRate,
                });
            }
        }
    }
    return { worst, samples, bad, stalls };
}

describe('render interpolation in a 4000-star galaxy (untouched ships extrapolated)', () => {
    it('has more built objects than the background pass touches per step', () => {
        expect(game.galaxy.builtObjects.length).toBeGreaterThan(1000);
    });

    it('drawn motion of moving ships is continuous: no frame move > 1.5 × the per-frame expected move, no stalls', () => {
        // Without extrapolation (the previous behaviour) cruising ships stand still for the steps they are not touched.
        const before = measure(false);
        const r = measure(true);
        console.log(`[bigGalaxy] builtObjects=${game.galaxy.builtObjects.length} samples=${r.samples} worst=${r.worst.toFixed(3)} bad=${r.bad} stalls=${r.stalls} (without extrapolation: worst=${before.worst.toFixed(3)} bad=${before.bad} stalls=${before.stalls})`);
        expect(before.stalls).toBeGreaterThan(100);
        expect(r.samples).toBeGreaterThan(1000);
        expect(r.bad).toBe(0);
        expect(r.worst).toBeLessThanOrEqual(1.5);
        expect(r.stalls).toBe(0);
    }, 600_000);
});
