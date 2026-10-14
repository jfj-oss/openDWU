// WebGL context loss: recover, and if it keeps happening fall back to cheaper rendering instead of looping
// (render-only, no sim state).
//
// Pixi asks the browser to restore a lost context (preventDefault in its GlContextSystem) and re-uploads every texture
// from its source on the next frames; render-texture content does not come back. A loss with a cause that persists —
// the GPU process out of memory or surfaces — would otherwise repeat every few seconds, each time a white flash and a
// full re-upload (seen on an 8 GB Apple M2 with a late save, textureCanvas.ts). This watcher:
// - on every restore, has the view regenerate what lived only on the GPU (the system-nebula render textures);
// - from the second loss within LOSS_WINDOW_MS, steps down one detail level per loss (GpuDetailTarget.useLowGpuMode):
//   level 1 = CPU nebula path (8-bit, no render-to-texture), half its texture budget, and render resolution 1 instead
//   of the device pixel ratio (a quarter of the back-buffer memory on a 2x screen); level 2 = no system nebulae;
// - logs each loss and restore with the count, and says once in a toast that detail was reduced;
// - a loss the browser does not restore (seen on Windows after a GPU driver reset: the map went blank until the player
//   saved and loaded): after RESTORE_NUDGE_MS it asks WEBGL_lose_context.restoreContext() (enough for a simulated
//   loss), and after STUCK_MS still lost it calls onStuck — main.ts then rebuilds the view (a new canvas and renderer)
//   from the current game, the same path as loading a save, without reloading the page.

import { getTestContext } from 'pixi.js';

/** What the watcher drives: the Main View. */
export interface GpuDetailTarget {
    /** The context came back: rebuild GPU-only content. */
    onGpuContextRestored(): void;
    /** Reduce GPU work / memory to `level` (1, 2; never raised again). */
    useLowGpuMode(level: number): void;
}

export interface ContextLossState {
    losses: number;
    restores: number;
    /** Current reduced-detail level (0 = full detail). */
    level: number;
    /** Losses the browser never restored (the view was rebuilt). */
    stuck?: number;
}

/** Losses closer together than this count as recurring (ms). */
export const LOSS_WINDOW_MS = 5 * 60 * 1000;
/** A loss not restored after this long gets a restoreContext() nudge (ms). */
export const RESTORE_NUDGE_MS = 3000;
/** Still lost after this long: the view is rebuilt (onStuck, ms). */
export const STUCK_MS = 8000;
/** Highest reduced-detail level. */
export const MAX_GPU_DETAIL_LEVEL = 2;

interface RendererLike {
    resolution: number;
}

export interface ContextLossOptions {
    /** One-line user notice (the HUD toast). */
    notify?: (message: string) => void;
    now?: () => number;
    /** The context is still lost STUCK_MS after a loss: rebuild the view. */
    onStuck?: () => void;
    /** The renderer's WebGL context (for the restoreContext nudge). */
    gl?: () => WebGLRenderingContext | WebGL2RenderingContext | null | undefined;
    setTimeout?: (fn: () => void, ms: number) => unknown;
    clearTimeout?: (id: unknown) => void;
}

/**
 * Watch `canvas` (the Pixi view) for context loss / restore. Returns the live state (also for diagnostics) and a
 * dispose function for the game-view teardown.
 */
export function installContextLossRecovery(
    canvas: HTMLCanvasElement,
    renderer: RendererLike,
    target: GpuDetailTarget,
    options: ContextLossOptions = {},
): { state: ContextLossState; dispose: () => void } {
    const now = options.now ?? (() => performance.now());
    const state: ContextLossState = { losses: 0, restores: 0, level: 0 };
    let lastLoss = -Infinity;
    let pendingLevel = 0;
    let notified = false;
    const setT = options.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
    const clearT = options.clearTimeout ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>));
    // WEBGL_lose_context, fetched while the context is alive: getExtension answers null on a lost context.
    let loseExt: { restoreContext(): void } | null = null;
    const grabExt = (): void => {
        const gl = options.gl?.();
        if (gl && !gl.isContextLost()) loseExt = gl.getExtension('WEBGL_lose_context') ?? loseExt;
    };
    grabExt();
    let nudge: unknown = null;
    let stuck: unknown = null;
    const clearTimers = (): void => {
        if (nudge !== null) clearT(nudge);
        if (stuck !== null) clearT(stuck);
        nudge = stuck = null;
    };
    const onLost = (): void => {
        const t = now();
        state.losses++;
        // A second loss soon after the first: the cause persists, so come back with less GPU work.
        if (t - lastLoss <= LOSS_WINDOW_MS) pendingLevel = Math.min(MAX_GPU_DETAIL_LEVEL, Math.max(pendingLevel, state.level) + 1);
        lastLoss = t;
        console.warn(`WebGL context lost (loss #${state.losses}); the browser will restore it`);
        clearTimers();
        nudge = setT(() => {
            nudge = null;
            const gl = options.gl?.();
            if (!gl || !gl.isContextLost()) return;
            console.warn(`WebGL context still lost after ${RESTORE_NUDGE_MS} ms: asking for it back`);
            try {
                loseExt?.restoreContext();
            } catch {
                /* only valid after loseContext(); a real loss is the browser's to restore */
            }
        }, RESTORE_NUDGE_MS);
        stuck = setT(() => {
            stuck = null;
            const gl = options.gl?.();
            if (gl && !gl.isContextLost()) return;
            state.stuck = (state.stuck ?? 0) + 1;
            console.error(`WebGL context lost for ${STUCK_MS / 1000} s and not restored: rebuilding the view`);
            options.onStuck?.();
        }, STUCK_MS);
    };
    const onRestored = (): void => {
        clearTimers();
        grabExt();
        state.restores++;
        if (pendingLevel > state.level) {
            state.level = pendingLevel;
            if (state.level >= 1 && renderer.resolution > 1) renderer.resolution = 1;
            target.useLowGpuMode(state.level);
            if (!notified) {
                notified = true;
                options.notify?.('Graphics were reset repeatedly — switched to reduced detail');
            }
        }
        target.onGpuContextRestored();
        console.warn(`WebGL context restored (detail level ${state.level})`);
    };
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    return {
        state,
        dispose: () => {
            clearTimers();
            canvas.removeEventListener('webglcontextlost', onLost);
            canvas.removeEventListener('webglcontextrestored', onRestored);
        },
    };
}

/**
 * Lose Pixi's capability-probe context (getTestContext: a detached WebGL1 canvas Pixi reads shader-precision and
 * texture-unit limits from, then keeps for the page's lifetime). Pixi caches those answers and makes a new probe if it
 * ever asks again, as its own getMaxTexturesPerBatch does after use. Call after the renderer has drawn its programs.
 */
export function releasePixiTestContext(renderer: { type?: number }): void {
    if (renderer.type !== 1 /* RendererType.WEBGL */) return;
    try {
        const gl = getTestContext() as WebGLRenderingContext | null;
        if (gl && !gl.isContextLost()) gl.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
        /* no WebGL in this environment */
    }
}
