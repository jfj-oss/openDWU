// Drawn motion of a ship patrolling a colony (it flies in the orbiting planet's frame) and of space creatures between
// their round-robin touches, at 4× — "a destroyer patrolling my colony twitches while it's moving straight", "the giant
// Kaltor is teleporting, even at 1×" (2026-10-04).
//
// - The patrol: DoMovement aims a ship that moves relative to its parent from its committed xpos, which the move
//   commands do not first re-place at parent + ParentOffset (executeCommands.ts 413-431) — so the first touch after the
//   planet's own round-robin touch aims from where the ship stood before the planet moved, and the heading flicks off
//   and back (1-2° on the user's save, once per habitat round-robin). The sim is the C#'s; renderInterp.ts
//   staleFrameAim draws the aim the frame gives (MotionInterpolator.fixFrameAim off: the before).
// - Creatures: one round-robin of 50 a step, so on the user's save (2 548 creatures) each is touched once in 51 steps,
//   and the touch re-aims a wanderer (its turn can lie 50-250 units off the extrapolation), starts it from or brings it
//   to rest at its planet (drawn around the planet's drawn orbit at rest, its committed position trails that), or the
//   unwrapped turn lands on its target between touches — drawn as jumps (isJump snapped them: teleports) or one-frame
//   pops. sampleCreature eases them out over the round-robin (easeCreatures off: the before).
//
// Measured with the visible-jump metric of scripts/perf-render.mjs --motion (renderInterp-heading.test.ts
// VisibleJumps): a frame's move / rotation against the frames before and after it.
import { describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { Galaxy } from '../src/sim/galaxy';
import type { BuiltObject } from '../src/sim/builtObject';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { BuiltObjectMissionType, builtObjectMission } from '../src/sim/missions/mission';
import { createMissionShipActionAt } from '../src/sim/player/shipAction';
import { runPlayerCommand } from '../src/sim/player/playerCommands';
import { nextFrameMs, runSimFrame, schedulerState } from '../src/sim/tick/scheduler';
import { MotionInterpolator, PresentationClock, createRenderTime, habitatTouchClampSeconds, sampleBuiltObject, sampleCreature, updateRenderTime, wrapAngle } from '../src/render/renderInterp';

/** Visible jumps of one object's drawn track: position (world units) and heading (degrees) off the frames around it. */
class Track {
    private x: number[] = [];
    private y: number[] = [];
    private h: number[] = [];
    private ok: boolean[] = [];
    frames = 0;
    pos = 0;
    head = 0;
    maxPos = 0;
    maxHead = 0;
    constructor(private readonly posOver: number, private readonly headOver: number) {}
    /** `counted` false: this frame (and the moves next to it) are left out. */
    add(x: number, y: number, h: number, counted = true): void {
        this.x.push(x);
        this.y.push(y);
        this.h.push(h);
        this.ok.push(counted);
        const n = this.x.length;
        if (n < 4 || !this.ok[n - 1] || !this.ok[n - 2] || !this.ok[n - 3] || !this.ok[n - 4]) return;
        const mv = (j: number): [number, number, number] => [this.x[j + 1] - this.x[j], this.y[j + 1] - this.y[j], wrapAngle(this.h[j + 1] - this.h[j])];
        const w = mv(n - 4);
        const u = mv(n - 3);
        const v = mv(n - 2);
        const sx = v[0] - w[0];
        const sy = v[1] - w[1];
        const L = sx * sx + sy * sy;
        const k = L > 0 ? Math.max(0, Math.min(1, ((u[0] - w[0]) * sx + (u[1] - w[1]) * sy) / L)) : 0;
        const pp = Math.hypot(u[0] - (w[0] + sx * k), u[1] - (w[1] + sy * k)) - 0.05 * Math.hypot(u[0], u[1]);
        const hh = (Math.max(0, u[2] - Math.max(w[2], v[2]), Math.min(w[2], v[2]) - u[2]) * 180) / Math.PI;
        this.frames++;
        if (pp > this.posOver) this.pos++;
        if (hh > this.headOver) this.head++;
        this.maxPos = Math.max(this.maxPos, pp);
        this.maxHead = Math.max(this.maxHead, hh);
    }
}

/** Run `frames` render frames at `speed` (one sim step per 60 Hz frame, as simLoop.ts runs them when the sim keeps up),
 * drawing through the presentation clock as MainView does, into `views`. */
function drive(g: Galaxy, frames: number, speed: number, views: ((m: MotionInterpolator) => void)[], ms: MotionInterpolator[]): void {
    const clock = new PresentationClock();
    const raw = createRenderTime();
    const out = createRenderTime();
    for (let f = 0; f < frames; f++) {
        runSimFrame(g, nextFrameMs(schedulerState(g), speed));
        updateRenderTime(raw, g.nowMs, 0, speed, false, 1);
        const rt = clock.present(raw, (f * 1000) / 60, out);
        for (let i = 0; i < ms.length; i++) {
            ms[i].begin(rt, habitatTouchClampSeconds(g.habitats.length), g.builtObjects.length, g.creatures.length, g.habitats.length);
            views[i](ms[i]);
        }
    }
}

describe('a ship patrolling an orbiting colony at 4×', () => {
    it('flies straight: no heading flick when the planet is touched (staleFrameAim)', async () => {
        const gameData = await loadGameDataFs();
        const g = cachedTickGame(gameData, { seconds: 60 }).galaxy;
        const player = g.playerEmpire!;
        const ships = player.builtObjects.filter((b): b is BuiltObject => b !== null && b.topSpeed > 0 && (b.subRole === BuiltObjectSubRole.Frigate || b.subRole === BuiltObjectSubRole.Destroyer || b.subRole === BuiltObjectSubRole.Escort));
        expect(ships.length).toBeGreaterThan(0);
        const ship = ships[0];
        const colony = g.habitats.find((h) => h.owner === player && h.parent !== null)!;
        expect(colony).toBeDefined();
        runPlayerCommand(g, player, 'shipAction', [ship, createMissionShipActionAt(BuiltObjectMissionType.Patrol, colony, Math.trunc(colony.xpos), Math.trunc(colony.ypos)), false]);
        expect(builtObjectMission(ship.mission)?.type).toBe(BuiltObjectMissionType.Patrol);
        // Until it flies the patrol round the colony (in its frame).
        for (let i = 0; i < 60 * 300 && !(ship.parentHabitat === colony && ship.parentOffsetX > -2e9 && ship.currentSpeed > 0); i++) runSimFrame(g, nextFrameMs(schedulerState(g), 4));
        expect(ship.parentHabitat).toBe(colony);
        const on = new MotionInterpolator();
        const off = new MotionInterpolator();
        off.fixFrameAim = false;
        const tOn = new Track(1, 0.5);
        const tOff = new Track(1, 0.5);
        let inFrame = 0;
        // Counted while it flies straight in the colony's frame: between two waypoints (the same command, the turn onto
        // it done — the sim's heading at the aim the frame gives, but for the flick).
        let cmd: unknown = null;
        let since = 0;
        let straight = false;
        drive(g, 60 * 30, 4, [
            (m) => {
                const c = builtObjectMission(ship.mission)?.fastPeekCurrentCommand() ?? null;
                if (c !== cmd) {
                    cmd = c;
                    since = 0;
                }
                const st = sampleBuiltObject(m, ship);
                straight = st.frame === colony && ++since > 60 && Math.abs(wrapAngle(ship.heading - ship.targetHeading)) < 0.05;
                tOn.add(st.x, st.y, st.heading, straight);
                if (straight) inFrame++;
            },
            (m) => {
                const st = sampleBuiltObject(m, ship);
                tOff.add(st.x, st.y, st.heading, straight);
            },
        ], [on, off]);
        console.log(`[patrol] habitats ${g.habitats.length}, built objects ${g.builtObjects.length}; frames ${tOn.frames} (${inFrame} flying straight in the colony's frame): heading > 0.5° before ${tOff.head} (max ${tOff.maxHead.toFixed(2)}°) after ${tOn.head} (max ${tOn.maxHead.toFixed(2)}°); position > 1 unit before ${tOff.pos} after ${tOn.pos}`);
        expect(inFrame).toBeGreaterThan(500);
        expect(tOff.head).toBeGreaterThan(0);
        expect(tOn.head).toBe(0);
    }, 600_000);
});

describe('space creatures between their round-robin touches (seed-1 harness galaxy, padded to the save\'s 2 548)', () => {
    const USER_CREATURES = 2548;
    for (const speed of [1, 4]) {
        it(`at ${speed}×: no jumps or pops where a touch re-aims, starts or stops a creature (easeCreatures)`, async () => {
            const gameData = await loadGameDataFs();
            const g = cachedTickGame(gameData, { seconds: 60 }).galaxy;
            // As many creatures as the user's save (2 548: each touched once in 51 steps): null holes between them
            // (the round-robin walks them, as it walks the holes CompleteTeardown leaves), spread evenly.
            const live = g.creatures.slice();
            g.creatures.length = 0;
            const per = (USER_CREATURES - live.length) / live.length;
            let holes = 0;
            for (const c of live) {
                g.creatures.push(c);
                for (holes += per; holes >= 1; holes--) g.creatures.push(null as never);
            }
            while (g.creatures.length < USER_CREATURES) g.creatures.push(null as never);
            const on = new MotionInterpolator();
            const off = new MotionInterpolator();
            off.easeCreatures = false;
            const tracks = [new Map<object, Track>(), new Map<object, Track>()];
            const view = (i: number) => (m: MotionInterpolator) => {
                for (const c of g.creatures) {
                    if (c === null) continue;
                    const st = sampleCreature(m, c);
                    let t = tracks[i].get(c);
                    if (t === undefined) tracks[i].set(c, (t = new Track(2, 1.5)));
                    // (Left out: a hyperspeed leg, which ends in a relocation to its exit, and its snap.)
                    t.add(st.x, st.y, st.heading, st.hn > 1 && c.currentSpeed <= Math.max(c.movementSpeed, c.lungeSpeed));
                }
            };
            drive(g, 60 * 20, speed, [view(0), view(1)], [on, off]);
            const sum = (i: number) => {
                const s = { frames: 0, pos: 0, head: 0, maxPos: 0, maxHead: 0 };
                for (const t of tracks[i].values()) {
                    s.frames += t.frames;
                    s.pos += t.pos;
                    s.head += t.head;
                    s.maxPos = Math.max(s.maxPos, t.maxPos);
                    s.maxHead = Math.max(s.maxHead, t.maxHead);
                }
                return s;
            };
            const a = sum(0);
            const b = sum(1);
            const fmt = (s: ReturnType<typeof sum>) => `position > 2 units ${s.pos} (max ${s.maxPos.toFixed(1)}), heading > 1.5° ${s.head} (max ${s.maxHead.toFixed(1)}°)`;
            console.log(`[creatures ${speed}×] ${live.length} creatures in ${g.creatures.length} slots (touched every ${Math.ceil(g.creatures.length / 50)} steps), frames ${a.frames}\n  before: ${fmt(b)}\n  after:  ${fmt(a)}`);
            expect(a.frames).toBeGreaterThan(50000);
            expect(b.pos).toBeGreaterThan(0);
            expect(a.pos).toBe(0);
            expect(a.head).toBeLessThanOrEqual(b.head);
        }, 600_000);
    }
});
