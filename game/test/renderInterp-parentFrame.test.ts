// Ships moving in a planet's frame far from it (src/render/renderInterp.ts sampleBuiltObject / followsParent): while a
// ship has a ParentHabitat and a set ParentOffset, the sim moves it by offset from the planet's COMMITTED position
// (movement.ts moveToward: xpos = parentXPos + ParentOffset, executeCommands.ts evaluateRelativeToParent keeps the
// parent at any distance) — e.g. a ship that dropped out of hyperspace ~1300 units from its target planet, or one
// flying on past a planet it was parked at. The planet's committed position only moves when the background round-robin
// touches it (every ceil(habitats / HABITAT_TICK_BATCH_SIZE) steps), so the ship's committed galaxy position stands
// still relative to the planet's orbit and then jumps back with it. Drawn in galaxy coordinates (the old 1000-unit
// offset cap on the parent frame), that jump showed as a shake, once per round-robin cycle, for as long as the ship
// stayed beyond the cap; drawn in the planet's frame (its lerped offset around the planet's interpolated orbit) it is
// smooth at any offset.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { BuiltObject } from '../src/sim/builtObject';
import { runSimFrame } from '../src/sim/tick/scheduler';
import { MotionInterpolator, createRenderTime, habitatTouchClampSeconds, renderHabitatPos, sampleBuiltObject, type MovingBuiltObject, type OrbitingBody } from '../src/render/renderInterp';

const STEP_MS = 17;
const SUBFRAMES = 4;

/** Per-frame drawn motion: reversals (a frame's move pointing backwards against the previous one) and the largest
 * frame-to-frame change of the move vector (a smooth path changes it by next to nothing). The first two steps of a
 * track are left out: the interpolator's first sight (a snap, then one step's lerp from there) or the hyperjump exit
 * that put the ship there. */
class Jitter {
    private seen = 0;
    reversals = 0;
    maxJerk = 0;
    frames = 0;
    private lx = Number.NaN;
    private ly = Number.NaN;
    private ldx = Number.NaN;
    private ldy = Number.NaN;
    add(x: number, y: number): void {
        if (!Number.isNaN(this.lx)) {
            const dx = x - this.lx;
            const dy = y - this.ly;
            if (!Number.isNaN(this.ldx) && ++this.seen > 2 * SUBFRAMES) {
                this.frames++;
                if (dx * this.ldx + dy * this.ldy < 0) this.reversals++;
                this.maxJerk = Math.max(this.maxJerk, Math.hypot(dx - this.ldx, dy - this.ldy));
            }
            this.ldx = dx;
            this.ldy = dy;
        }
        this.lx = x;
        this.ly = y;
    }
    reset(): void {
        this.lx = this.ly = this.ldx = this.ldy = Number.NaN;
        this.seen = 0;
    }
}

describe('a ship moving in a planet\'s frame beyond the parked range is drawn smoothly', () => {
    it('synthetic: a ship flying past its parent planet (offset 1500 → -1500) while the planet is touched only every 27 steps', () => {
        const star: OrbitingBody & { hasBeenDestroyed: boolean } = { parent: null, xpos: 0, ypos: 0, orbitAngle: 0, anglePerSecond: 0, orbitDirection: true, orbitDistance: 0, lastTouch: 0, hasBeenDestroyed: false };
        // Orbit speed 5000 × 0.0007 = 3.5 units / s along +y at angle 0 (a planet like Weiba in the seed-1 game).
        const planet = { parent: star, xpos: 5000, ypos: 0, orbitAngle: 0, anglePerSecond: 0.0007, orbitDirection: true, orbitDistance: 5000, lastTouch: 0, hasBeenDestroyed: false };
        const speed = 14;
        const ship: MovingBuiltObject = { xpos: 5300, ypos: 1500, heading: -Math.PI / 2, topSpeed: 26, warpSpeed: 0, currentSpeed: speed, parentHabitat: planet, parentOffsetX: 300, parentOffsetY: 1500, lastTouch: 0 };
        const m = new MotionInterpolator();
        const rt = createRenderTime();
        rt.stepGameMs = STEP_MS;
        const clamp = 10;
        const j = new Jitter();
        let now = 0;
        let beyond = 0;
        for (let s = 1; ship.parentOffsetY > -1500; s++) {
            now += STEP_MS;
            // Round-robin touch of the planet (habitatTick.ts move).
            if (s % 27 === 0) {
                planet.orbitAngle += (planet.anglePerSecond * (now - planet.lastTouch)) / 1000;
                planet.lastTouch = now;
                planet.xpos = Math.cos(planet.orbitAngle) * planet.orbitDistance;
                planet.ypos = Math.sin(planet.orbitAngle) * planet.orbitDistance;
            }
            // movement.ts moveToward with a parent: the offset advances, xpos = committed parent + offset.
            ship.parentOffsetY -= (speed * STEP_MS) / 1000;
            ship.xpos = planet.xpos + ship.parentOffsetX;
            ship.ypos = planet.ypos + ship.parentOffsetY;
            ship.lastTouch = now;
            for (let k = 0; k < SUBFRAMES; k++) {
                rt.alpha = k / SUBFRAMES;
                rt.stepSerial += k === 0 ? 1 : 0;
                rt.simNowMs = now;
                rt.renderNowMs = now + rt.alpha * STEP_MS;
                m.begin(rt, clamp, 1);
                const st = sampleBuiltObject(m, ship);
                j.add(st.x, st.y);
                if (Math.hypot(ship.parentOffsetX, ship.parentOffsetY) > 1000) beyond++;
                // Drawn around the planet's drawn (interpolated) orbit, never its committed position.
                expect(st.frame).toBe(planet);
                const o = renderHabitatPos(planet, rt.renderNowMs, clamp, { x: 0, y: 0 });
                expect(Math.hypot(st.x - o.x - ship.parentOffsetX, st.y - o.y - ship.parentOffsetY)).toBeLessThan((speed * STEP_MS) / 1000 + 1e-9);
            }
        }
        console.log(`[parentFrame synthetic] frames=${j.frames} beyond1000=${beyond} reversals=${j.reversals} maxJerk=${j.maxJerk.toFixed(4)}`);
        expect(beyond).toBeGreaterThan(1000);
        expect(j.reversals).toBe(0);
        // Per-frame move ≈ (14 − 3.5) × 17 ms / 4 ≈ 0.045 units; its frame-to-frame change stays a small fraction of it.
        expect(j.maxJerk).toBeLessThan(0.01);
    });

    let gameData: GameData;
    beforeAll(async () => {
        gameData = await loadGameDataFs();
    }, 120000);

    it('seed-1 game: ships the sim moves by offset from an orbiting planet, beyond 1000 units, never shake', () => {
        const g = cachedTickGame(gameData, { seconds: 60 }).galaxy;
        const m = new MotionInterpolator();
        const rt = createRenderTime();
        rt.stepGameMs = STEP_MS;
        const jit = new Map<BuiltObject, Jitter>();
        let samples = 0;
        for (let s = 0; s < 600; s++) {
            runSimFrame(g, STEP_MS);
            for (let k = 0; k < SUBFRAMES; k++) {
                rt.alpha = k / SUBFRAMES;
                rt.stepSerial += k === 0 ? 1 : 0;
                rt.simNowMs = g.nowMs;
                rt.renderNowMs = g.nowMs + rt.alpha * STEP_MS;
                m.begin(rt, habitatTouchClampSeconds(g.habitats.length), g.builtObjects.length);
                for (const bo of g.builtObjects) {
                    if (bo === null || bo.hasBeenDestroyed) continue;
                    const st = sampleBuiltObject(m, bo);
                    const h = bo.parentHabitat;
                    // Sub-light, moving, and placed by the sim at the orbiting planet's committed position + a long offset.
                    const inPlanetFrame =
                        h !== null &&
                        h.parent !== null &&
                        bo.currentSpeed > 0 &&
                        bo.currentSpeed <= bo.topSpeed &&
                        bo.dockedAt === null &&
                        Math.hypot(bo.parentOffsetX, bo.parentOffsetY) > 1000 &&
                        Math.hypot(bo.parentOffsetX, bo.parentOffsetY) < 1e6 &&
                        Math.abs(bo.xpos - h.xpos - bo.parentOffsetX) < 1e-6 &&
                        Math.abs(bo.ypos - h.ypos - bo.parentOffsetY) < 1e-6;
                    let j = jit.get(bo);
                    if (!inPlanetFrame) {
                        j?.reset();
                        continue;
                    }
                    if (j === undefined) jit.set(bo, (j = new Jitter()));
                    j.add(st.x, st.y);
                    samples++;
                }
            }
        }
        let reversals = 0;
        let frames = 0;
        let maxJerk = 0;
        for (const j of jit.values()) {
            reversals += j.reversals;
            frames += j.frames;
            maxJerk = Math.max(maxJerk, j.maxJerk);
        }
        console.log(`[parentFrame seed-1] ships=${jit.size} samples=${samples} frames=${frames} reversals=${reversals} maxJerk=${maxJerk.toFixed(4)}`);
        expect(jit.size).toBeGreaterThan(0);
        expect(frames).toBeGreaterThan(1000);
        expect(reversals).toBe(0);
        expect(maxJerk).toBeLessThan(0.05);
    }, 600000);
});
