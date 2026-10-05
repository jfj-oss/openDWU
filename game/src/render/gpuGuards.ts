// Main View canvas guards (render-only, no sim state): keep the WebGL drawing buffer valid across window hides,
// minimises and driver hiccups.
//
// Seen on Linux / Wayland / NVIDIA (0.1.4): after an alt-tab or while the map stood still, the GPU process logged
// "GL_INVALID_FRAMEBUFFER_OPERATION: glClear / glDrawElements: Framebuffer is incomplete" for every draw of every frame
// (then "Too many GL errors"), with nvidia-drm "Failed to allocate NVKMS memory for GEM object" nearby. Every Pixi draw
// went into the incomplete default framebuffer, so the map was black while the DOM HUD and the minimap (not WebGL) still
// drew. No context loss is fired for that, so contextLoss.ts never ran.
//
// 1. Viewport guard: Pixi's resizeTo: window resizes the renderer to innerWidth x innerHeight on every resize event.
//    A minimised / hidden window can report a 0 or 1 px size; Pixi ignores 0 but a 1 px resize reallocates the drawing
//    buffer at 1x1 and every screen-sized thing follows (camera viewport, screen-sized pool textures). While the page is
//    hidden or the window is under MIN_VIEWPORT_PX the resize is deferred and applied when it is shown again.
// 2. Framebuffer watchdog: about once a second while visible (one gl.getError: a sync round trip to the GPU process,
//    well under a millisecond) it looks for INVALID_FRAMEBUFFER_OPERATION. On a repeat it reallocates the drawing buffer
//    (re-assigning the canvas size, which WebGL defines as a fresh buffer of that size); if the error persists, it forces
//    a context loss + restore, which Pixi and contextLoss.ts already recover from (textures re-uploaded, nebula patches
//    regenerated). On becoming visible again the canvas size is re-checked and the watchdog checks at once.

/** Smallest window side (CSS px) the renderer is resized to; below it the resize waits (a minimised window). */
export const MIN_VIEWPORT_PX = 16;
/** Checks between getError polls (ms). */
export const FRAMEBUFFER_CHECK_MS = 1000;
/** Consecutive failing checks before the drawing buffer is reallocated / the context is reset. */
export const REALLOC_AFTER = 2;
export const RESET_AFTER = 4;

const GL_INVALID_FRAMEBUFFER_OPERATION = 0x0506;
const GL_NO_ERROR = 0;

interface GlLike {
    getError(): number;
    isContextLost(): boolean;
    getExtension(name: 'WEBGL_lose_context'): { loseContext(): void; restoreContext(): void } | null;
}

export interface CanvasLike {
    width: number;
    height: number;
}

export interface DocumentLike {
    hidden: boolean;
    addEventListener(type: 'visibilitychange', fn: () => void): void;
    removeEventListener(type: 'visibilitychange', fn: () => void): void;
}

export interface WindowLike {
    innerWidth: number;
    innerHeight: number;
}

/** What the guards drive: Pixi's Application (resize from the ResizePlugin) and its renderer. */
export interface GuardedApp {
    resize?: () => void;
    canvas: CanvasLike;
    renderer: { gl?: unknown; type?: number; screen?: { width: number; height: number } };
}

export interface FramebufferWatchdogState {
    /** Checks that found INVALID_FRAMEBUFFER_OPERATION. */
    errors: number;
    /** Drawing-buffer reallocations / forced context resets done. */
    reallocs: number;
    resets: number;
    /** Resizes deferred while hidden or too small. */
    deferredResizes: number;
}

/** Whether a resize to (w, h) should wait: the page is hidden or the window is (nearly) zero-sized. */
export function shouldDeferResize(hidden: boolean, w: number, h: number): boolean {
    return hidden || !(w >= MIN_VIEWPORT_PX) || !(h >= MIN_VIEWPORT_PX);
}

/**
 * The watchdog's decision for one check, from the error just read and the failing streak before it: 'ok', 'wait'
 * (one failing check: can be a transient), 'realloc' or 'reset'.
 */
export function watchdogStep(error: number, streak: number): { streak: number; action: 'ok' | 'wait' | 'realloc' | 'reset' } {
    if (error !== GL_INVALID_FRAMEBUFFER_OPERATION) return { streak: 0, action: 'ok' };
    const s = streak + 1;
    if (s >= RESET_AFTER) return { streak: 0, action: 'reset' };
    if (s === REALLOC_AFTER) return { streak: s, action: 'realloc' };
    return { streak: s, action: 'wait' };
}

/**
 * Install both guards on a WebGL app. `tick` must be called once per rendered frame (after render) with the frame time;
 * returns the live state and a dispose for the game-view teardown.
 */
export function installGpuGuards(
    app: GuardedApp,
    env: { document: DocumentLike; window: WindowLike; now?: () => number; log?: (msg: string) => void } = {
        document: globalThis.document,
        window: globalThis.window,
    },
): { state: FramebufferWatchdogState; tick: () => void; dispose: () => void } {
    const doc = env.document;
    const win = env.window;
    const now = env.now ?? (() => performance.now());
    const log = env.log ?? ((m: string) => console.warn(m));
    const state: FramebufferWatchdogState = { errors: 0, reallocs: 0, resets: 0, deferredResizes: 0 };
    const gl = (app.renderer.type === 1 /* WEBGL */ ? (app.renderer.gl as GlLike | undefined) : undefined) ?? null;

    // 1. Viewport guard.
    const innerResize = app.resize;
    let pending = false;
    if (typeof innerResize === 'function') {
        app.resize = () => {
            if (shouldDeferResize(doc.hidden, win.innerWidth, win.innerHeight)) {
                if (!pending) state.deferredResizes++;
                pending = true;
                return;
            }
            pending = false;
            innerResize.call(app);
        };
    }

    // 2. Framebuffer watchdog.
    let streak = 0;
    let lastCheck = -Infinity;
    const check = (): void => {
        if (gl === null || doc.hidden || gl.isContextLost()) {
            streak = 0;
            return;
        }
        const e = gl.getError();
        // Drain the rest of the error queue (getError returns one flag per call), so the next check sees fresh state.
        for (let i = 0, x = e; x !== GL_NO_ERROR && i < 8; i++) x = gl.getError();
        if (e === GL_INVALID_FRAMEBUFFER_OPERATION) state.errors++;
        const step = watchdogStep(e, streak);
        streak = step.streak;
        if (step.action === 'realloc') {
            state.reallocs++;
            log('WebGL: the canvas framebuffer is incomplete — reallocating the drawing buffer');
            const c = app.canvas;
            const w = c.width;
            const h = c.height;
            // Re-assigning the size gives the canvas a fresh drawing buffer (also when unchanged).
            c.width = w;
            c.height = h;
        } else if (step.action === 'reset') {
            state.resets++;
            log('WebGL: the canvas framebuffer stays incomplete — resetting the context');
            const lose = gl.getExtension('WEBGL_lose_context');
            if (lose !== null) {
                lose.loseContext();
                // Pixi asks the browser to restore on the loss event; ask too in case it does not come on its own.
                setTimeout(() => {
                    if (gl.isContextLost()) lose.restoreContext();
                }, 250);
            }
        }
    };
    const tick = (): void => {
        const t = now();
        if (t - lastCheck < FRAMEBUFFER_CHECK_MS) return;
        lastCheck = t;
        check();
    };
    const onVisibility = (): void => {
        if (doc.hidden) return;
        // Shown again: apply a resize that waited, and look at the framebuffer on the next frame.
        if (pending && typeof app.resize === 'function') app.resize();
        lastCheck = -Infinity;
    };
    doc.addEventListener('visibilitychange', onVisibility);
    return {
        state,
        tick,
        dispose: () => {
            doc.removeEventListener('visibilitychange', onVisibility);
            if (typeof innerResize === 'function') app.resize = innerResize;
        },
    };
}
