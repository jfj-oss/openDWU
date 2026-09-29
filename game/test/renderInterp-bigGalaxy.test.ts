// Render interpolation in very large galaxies (src/render/renderInterp.ts sampleBuiltObject / extrapolateUntouched), on a
// real 4000-star galaxy (createGame + a 30 s warm-up, ~10 s in all): with more than 1000 built objects the background
// pass (scheduler.ts backgroundPass "GxBO") touches each ship only every ceil(n / 1000) steps, so its committed position
// stands still and then jumps. The drawn position is extrapolated from the last touch along heading × CurrentSpeed.
// Over 120 sim steps drawn at 4 render frames each, every moving ship must move continuously: no frame move
// larger than 1.5 × the per-frame expected move (its speed, or the committed move of its latest touch spread over one
// step), and no stall (a cruising ship drawn standing still) — which is what the same run shows without extrapolation.
// Ships drawn in a parent's frame (parked at a planet, docked at / parked by a base) may move only with the drawn parent
// plus their own speed; a frame change is blended evenly over one step. Intended snaps (isJump) and warp legs are left out.
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
    /** The frame it was drawn in (null: galaxy coordinates; else its ParentHabitat / DockedAt / ParentBuiltObject) and
     * that frame's drawn origin. */
    frame: object | null;
    ox: number;
    oy: number;
    /** Step of the last frame change and the per-frame share of that step's lerp: the change is blended over the step
     * (the drawn parent vs its committed position is absorbed evenly), never taken in one frame. */
    switchStep: number;
    blend: number;
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
function measure(extrapolate: boolean): { worst: number; samples: number; bad: number; stalls: number; framed: number; inBase: number; switches: number } {
    const g = game.galaxy;
    const m = new MotionInterpolator();
    const rt = createRenderTime();
    rt.stepGameMs = STEP_MS;
    const last = new Map<BuiltObject, Track>();
    let worst = 0;
    let samples = 0;
    let bad = 0;
    let stalls = 0;
    let framed = 0;
    let inBase = 0;
    let switches = 0;
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
                const speeds = prev?.speeds ?? [];
                speeds.push(speed);
                if (speeds.length > 2 * SUBFRAMES + 1) speeds.shift();
                const recent = Math.max(...speeds);
                // Moving ships at sub-light speed (warp legs — hyperjump — are left out with `recent <= topSpeed`), in
                // any frame: flying free, parked at a planet, docked at / parked by a base, and across frame changes.
                const moving = speed > 0 && recent <= bo.topSpeed;
                // Step 0 is the interpolator's first sight of every ship (a snap) and step 1 opens its first lerp from
                // there: measured from step 2 on.
                let switchStep = prev?.switchStep ?? -10;
                let blend = prev?.blend ?? 0;
                if (prev !== undefined && st.frame !== prev.frame) {
                    switchStep = s;
                    blend = Math.hypot(st.cx - st.px, st.cy - st.py) / SUBFRAMES;
                }
                const inBlend = s === switchStep || (s === switchStep + 1 && k === 0);
                if (s > 1 && prev !== undefined && moving && prev.speed > 0) {
                    const dx = st.x - x0;
                    const dy = st.y - y0;
                    // A snap (isJump over one step) is the interpolator's intended discontinuity: not motion.
                    if (!isJump(dx, dy, 1, Math.max(bo.topSpeed, bo.warpSpeed), STEP_MS / 1000)) {
                        const expected = (recent * STEP_MS) / 1000 / SUBFRAMES;
                        const move = Math.hypot(dx, dy);
                        let allowed: number;
                        if (st.frame !== null && st.frame === prev.frame) {
                            // In a parent's frame: its own motion plus how far the drawn parent moved this frame. The
                            // parent's committed position jumps with the round-robin; the drawn one must not carry that.
                            allowed = Math.max(expected + Math.hypot(st.ox - prev.ox, st.oy - prev.oy), MIN_VISIBLE);
                            framed++;
                            if (!('orbitAngle' in st.frame)) inBase++;
                        } else {
                            allowed = Math.max(expected, rate, prevRate, MIN_VISIBLE);
                            if (st.frame !== prev.frame) switches++;
                        }
                        if (inBlend) allowed = Math.max(allowed, blend);
                        const r = move / allowed;
                        samples++;
                        // A stall: a ship cruising at a steady speed in galaxy coordinates, which the sim did move at its
                        // latest touch (a fleet holding to sync keeps its CurrentSpeed but stays put), drawn standing still
                        // for a frame — what the round-robin touch gap looks like without extrapolation.
                        if (st.frame === null && prev.frame === null && Math.min(...speeds) > 0.9 * recent && expected > 0.01 && rate > 0.5 * expected && move < 0.25 * expected) stalls++;
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
                    frame: st.frame,
                    ox: st.ox,
                    oy: st.oy,
                    switchStep,
                    blend,
                    tx: touched ? bo.xpos : prev.tx,
                    ty: touched ? bo.ypos : prev.ty,
                    touch: bo.lastTouch,
                    rate,
                    prevRate,
                });
            }
        }
    }
    return { worst, samples, bad, stalls, framed, inBase, switches };
}

describe('render interpolation in a 4000-star galaxy (untouched ships extrapolated)', () => {
    it('has more built objects than the background pass touches per step', () => {
        expect(game.galaxy.builtObjects.length).toBeGreaterThan(1000);
    });

    it('drawn motion of moving ships is continuous: no frame move > 1.5 × the per-frame expected move, no stalls', () => {
        // Without extrapolation (the previous behaviour) cruising ships stand still for the steps they are not touched.
        const before = measure(false);
        const r = measure(true);
        console.log(`[bigGalaxy] builtObjects=${game.galaxy.builtObjects.length} samples=${r.samples} worst=${r.worst.toFixed(3)} bad=${r.bad} stalls=${r.stalls} framed=${r.framed} inBase=${r.inBase} switches=${r.switches} (without extrapolation: worst=${before.worst.toFixed(3)} bad=${before.bad} stalls=${before.stalls})`);
        expect(before.stalls).toBeGreaterThan(100);
        expect(r.samples).toBeGreaterThan(1000);
        expect(r.bad).toBe(0);
        expect(r.worst).toBeLessThanOrEqual(1.5);
        expect(r.stalls).toBe(0);
        expect(r.framed).toBeGreaterThan(0);
        expect(r.inBase).toBeGreaterThan(0); // docked at / parked by a base (drawn around the drawn base)
        expect(r.switches).toBeGreaterThan(0);
    }, 600_000);
});
