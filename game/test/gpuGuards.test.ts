import { describe, expect, it } from 'vitest';
import { FRAMEBUFFER_CHECK_MS, installGpuGuards, shouldDeferResize, watchdogStep, type DocumentLike } from '../src/render/gpuGuards';

const INVALID_FB = 0x0506;

function fakeEnv(hidden = false) {
    const listeners = new Set<() => void>();
    const doc: DocumentLike & { fire(): void } = {
        hidden,
        addEventListener: (_t, fn) => void listeners.add(fn),
        removeEventListener: (_t, fn) => void listeners.delete(fn),
        fire: () => listeners.forEach((fn) => fn()),
    };
    const win = { innerWidth: 1600, innerHeight: 900 };
    let t = 0;
    return { doc, win, now: () => t, advance: (ms: number) => (t += ms), listeners };
}

function fakeGl(errors: number[]) {
    const calls = { lose: 0, restore: 0 };
    let lost = false;
    // One flag per check: the error, then GL_NO_ERROR (the drain after it).
    let drained = true;
    const gl = {
        getError: () => {
            if (!drained) {
                drained = true;
                return 0;
            }
            const e = errors.shift() ?? 0;
            drained = e === 0;
            return e;
        },
        isContextLost: () => lost,
        getExtension: () => ({ loseContext: () => { calls.lose++; lost = true; }, restoreContext: () => { calls.restore++; lost = false; } }),
    };
    return { gl, calls };
}

describe('gpuGuards', () => {
    it('defers resizes while hidden or (nearly) zero-sized', () => {
        expect(shouldDeferResize(true, 1600, 900)).toBe(true);
        expect(shouldDeferResize(false, 0, 0)).toBe(true);
        expect(shouldDeferResize(false, 1, 1)).toBe(true);
        expect(shouldDeferResize(false, NaN, 900)).toBe(true);
        expect(shouldDeferResize(false, 1600, 900)).toBe(false);
    });

    it('steps: ok, wait, realloc, wait, reset', () => {
        let s = 0;
        const actions: string[] = [];
        for (const e of [0, INVALID_FB, INVALID_FB, INVALID_FB, INVALID_FB, 0]) {
            const r = watchdogStep(e, s);
            s = r.streak;
            actions.push(r.action);
        }
        expect(actions).toEqual(['ok', 'wait', 'realloc', 'wait', 'reset', 'ok']);
    });

    it('holds a resize while the window is minimised and applies it when shown', () => {
        const env = fakeEnv();
        let resizes = 0;
        const app = { resize: () => void resizes++, canvas: { width: 1600, height: 900 }, renderer: { type: 1, gl: fakeGl([]).gl } };
        const g = installGpuGuards(app, { document: env.doc, window: env.win, now: env.now, log: () => {} });
        app.resize();
        expect(resizes).toBe(1);
        env.win.innerWidth = 1;
        env.win.innerHeight = 1;
        app.resize();
        expect(resizes).toBe(1);
        expect(g.state.deferredResizes).toBe(1);
        env.doc.hidden = true;
        env.win.innerWidth = 1600;
        env.win.innerHeight = 900;
        app.resize();
        expect(resizes).toBe(1);
        env.doc.hidden = false;
        env.doc.fire();
        expect(resizes).toBe(2);
        g.dispose();
        expect(env.listeners.size).toBe(0);
    });

    it('reallocates the drawing buffer, then resets the context, while the framebuffer stays incomplete', () => {
        const env = fakeEnv();
        const { gl, calls } = fakeGl([INVALID_FB, INVALID_FB, INVALID_FB, INVALID_FB]);
        const canvas = { _w: 1600, get width() { return this._w; }, set width(v: number) { this._w = v; this.sets++; }, height: 900, sets: 0 };
        const app = { canvas, renderer: { type: 1, gl } };
        const g = installGpuGuards(app, { document: env.doc, window: env.win, now: env.now, log: () => {} });
        // Polled at most once per FRAMEBUFFER_CHECK_MS.
        g.tick();
        g.tick();
        expect(g.state.errors).toBe(1);
        env.advance(FRAMEBUFFER_CHECK_MS);
        g.tick();
        expect(g.state.reallocs).toBe(1);
        expect(canvas.sets).toBe(1);
        expect(canvas.width).toBe(1600);
        env.advance(FRAMEBUFFER_CHECK_MS);
        g.tick();
        env.advance(FRAMEBUFFER_CHECK_MS);
        g.tick();
        expect(g.state.resets).toBe(1);
        expect(calls.lose).toBe(1);
        // A lost context is not polled.
        env.advance(FRAMEBUFFER_CHECK_MS);
        g.tick();
        expect(g.state.errors).toBe(4);
        g.dispose();
    });

    it('does not poll while hidden', () => {
        const env = fakeEnv(true);
        const { gl } = fakeGl([INVALID_FB, INVALID_FB, INVALID_FB]);
        const app = { canvas: { width: 10, height: 10 }, renderer: { type: 1, gl } };
        const g = installGpuGuards(app, { document: env.doc, window: env.win, now: env.now, log: () => {} });
        for (let i = 0; i < 5; i++) {
            env.advance(FRAMEBUFFER_CHECK_MS);
            g.tick();
        }
        expect(g.state.errors).toBe(0);
        g.dispose();
    });
});
