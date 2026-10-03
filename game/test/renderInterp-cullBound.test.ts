// renderInterp.ts builtObjectDrawnOffsetBound / habitatDrawnOffsetBound: the bound render layers cull on (galaxyMarkers
// updateSymbols, effectsLayer, ambientLayer) before taking a render-interpolated sample, so an object whose committed
// position is off screen by more than its bound is skipped without changing what is drawn. On a real Mature-age game
// run step by step — at 1× and 4× speed, with a speed change, render frames between steps, and objects left unsampled
// for a few steps (culled) — every built object's drawn position must lie within its bound of its committed position,
// and every habitat's drawn orbit position within its habitat bound.
import { beforeAll, describe, expect, it } from 'vitest';
import type { Game } from '../src/sim/game';
import type { BuiltObject } from '../src/sim/builtObject';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import { runSimFrame } from '../src/sim/tick/scheduler';
import {
    MotionInterpolator,
    builtObjectDrawnOffsetBound,
    createRenderTime,
    habitatDrawnOffsetBound,
    habitatTouchClampSeconds,
    renderHabitatPos,
    sampleBuiltObject,
} from '../src/render/renderInterp';
import { BuiltObjectIndex } from '../src/render/builtObjectIndex';

let game: Game;

beforeAll(async () => {
    game = cachedTickGame(await loadGameDataFs(), { age: 4, seconds: 60 });
}, 1_800_000);

describe('drawn-position bounds (render culling)', () => {
    it('every sampled built object is drawn within builtObjectDrawnOffsetBound of its committed position', () => {
        const g = game.galaxy;
        const m = new MotionInterpolator();
        const rt = createRenderTime();
        let checked = 0;
        let worst = 0;
        let seed = 12345;
        const rand = (): number => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
        for (let s = 0; s < 240; s++) {
            const speed = s < 120 ? 1 : 4;
            const stepMs = Math.round((speed * 1000) / 60);
            runSimFrame(g, stepMs);
            rt.stepGameMs = (speed * 1000) / 60;
            rt.stepSerial++;
            for (let k = 0; k < 3; k++) {
                rt.alpha = k / 3;
                rt.simNowMs = g.nowMs;
                rt.renderNowMs = g.nowMs + rt.alpha * rt.stepGameMs;
                m.begin(rt, habitatTouchClampSeconds(g.habitats.length), g.builtObjects.length);
                for (const bo of g.builtObjects) {
                    if (bo === null || bo.hasBeenDestroyed) continue;
                    // Leave some objects unsampled for a while, as off-screen culling does.
                    if (rand() < 0.3) continue;
                    const st = sampleBuiltObject(m, bo);
                    const d = Math.hypot(st.x - bo.xpos, st.y - bo.ypos);
                    const b = builtObjectDrawnOffsetBound(m, bo);
                    if (d > 0) worst = Math.max(worst, d / b);
                    expect(d).toBeLessThanOrEqual(b);
                    checked++;
                }
            }
        }
        expect(checked).toBeGreaterThan(10000);
        expect(worst).toBeGreaterThan(0); // some motion was measured
    }, 600_000);

    it('every habitat is drawn within habitatDrawnOffsetBound of its committed position', () => {
        const g = game.galaxy;
        const clamp = habitatTouchClampSeconds(g.habitats.length);
        const out = { x: 0, y: 0 };
        let checked = 0;
        for (let s = 0; s < 60; s++) {
            runSimFrame(g, 67);
            for (const dt of [0, 30, 67]) {
                for (const h of g.habitats) {
                    if (h === null || h.parent === null) continue;
                    renderHabitatPos(h, g.nowMs + dt, clamp, out);
                    expect(Math.hypot(out.x - h.xpos, out.y - h.ypos)).toBeLessThanOrEqual(habitatDrawnOffsetBound(h, clamp) + 1e-6);
                    checked++;
                }
            }
        }
        expect(checked).toBeGreaterThan(1000);
    }, 600_000);

    it('builtObjectIndex.near: in galaxy order, and keeps every object whose drawn position is in the view', () => {
        const g = game.galaxy;
        const m = new MotionInterpolator();
        const rt = createRenderTime();
        const ix = new BuiltObjectIndex();
        const out: unknown[] = [];
        let seed = 99;
        const rand = (): number => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
        let kept = 0;
        for (let s = 0; s < 60; s++) {
            runSimFrame(g, s < 30 ? 17 : 67);
            rt.stepGameMs = s < 30 ? 1000 / 60 : 4000 / 60;
            rt.stepSerial++;
            rt.alpha = rand();
            rt.simNowMs = g.nowMs;
            rt.renderNowMs = g.nowMs + rt.alpha * rt.stepGameMs;
            m.begin(rt, habitatTouchClampSeconds(g.habitats.length), g.builtObjects.length);
            ix.update(g, m);
            const live = g.builtObjects.filter((b): b is BuiltObject => b !== null && !b.hasBeenDestroyed);
            expect(ix.live).toEqual(live);
            for (let q = 0; q < 5; q++) {
                const bo0 = live[Math.floor(rand() * live.length)];
                const halfW = 2000 + rand() * 200000;
                const halfH = halfW * 0.56;
                const near = ix.near(bo0.xpos, bo0.ypos, halfW, halfH, 0, true, out as never[]) as unknown[];
                // In order (a subsequence of live).
                let j = 0;
                for (const b of near) {
                    while (j < live.length && live[j] !== b) j++;
                    expect(j).toBeLessThan(live.length);
                }
                // Complete: every object drawn inside the rectangle is in the result.
                const set = new Set(near);
                for (const b of live) {
                    const st = sampleBuiltObject(m, b);
                    if (Math.abs(st.x - bo0.xpos) <= halfW && Math.abs(st.y - bo0.ypos) <= halfH) {
                        expect(set.has(b)).toBe(true);
                        kept++;
                    }
                }
            }
        }
        expect(kept).toBeGreaterThan(100);
    }, 600_000);
});
