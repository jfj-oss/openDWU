// "Please wait" overlay for the long main-thread jobs: building a new galaxy (createGameSteps) and loading a save.
// Both are generators that yield a progress report between steps; runStepsWithProgress drives one to completion,
// updating the bar and handing the browser a frame whenever a step has run for a while, so the tab repaints (and does
// not trip the browser's "page unresponsive" check) instead of freezing for the whole job.
import './loadingOverlay.css';
import { chromeImageUrl, originalWindowScale } from './originalWindow';
import { uiScaleFactor } from './settings';

export interface StepProgress {
    step: string;
    fraction: number;
}

export interface LoadingOverlay {
    update(p: StepProgress): void;
    close(): void;
}

/** pnlSaveLoadProgress.Size (Main.Part7.cs:4756 method_383 is 320 × 330) plus the rows we add under the galaxy: the
 *  progress bar and the step line. */
export const LOADING_PANEL_W = 320;
export const LOADING_PANEL_H = 330 + 44;
/** bitmap_47 = images/ui/chrome/galaxy.png (Main.Part12.cs:634), 274 × 274. */
const GALAXY_SIZE = 274;

/**
 * The original's pnlSaveLoadProgress (Main.Part7.cs:4756 method_383): a BorderPanel (the striped Main.resx background,
 * 3 px alpha-96 border) centred on the view, the message in font_2 (18.67 px bold, white) centred at y 13, and the
 * galaxy picture turning under it — method_377 / timer_0_Elapsed rotate galaxy.png by -π/160 every 75 ms (a turn in
 * 24 s, counter-clockwise), centred at ((W - 274) / 2, (330 - 274) / 2 + 15). Ours adds a progress bar and the current
 * step under the picture. The rotation is a CSS animation so the compositor keeps it turning while the main thread is
 * busy in one long step (JSON.parse of a big save, the graph decode): the page never looks frozen.
 */
export function showLoadingOverlay(title: string, root: HTMLElement = document.body): LoadingOverlay {
    const el = document.createElement('div');
    el.className = 'dwu-loading';
    el.setAttribute('role', 'progressbar');
    el.setAttribute('aria-valuemin', '0');
    el.setAttribute('aria-valuemax', '100');
    const box = document.createElement('div');
    box.className = 'ow-screen ow-stripes dwu-loading-box';
    box.style.width = `${LOADING_PANEL_W}px`;
    box.style.height = `${LOADING_PANEL_H}px`;
    const head = document.createElement('div');
    head.className = 'dwu-loading-title';
    head.textContent = title;
    const galaxy = document.createElement('img');
    galaxy.className = 'dwu-loading-galaxy';
    galaxy.src = chromeImageUrl('galaxy.png');
    galaxy.alt = '';
    galaxy.draggable = false;
    galaxy.style.left = `${(LOADING_PANEL_W - GALAXY_SIZE) / 2}px`;
    galaxy.style.top = `${(330 - GALAXY_SIZE) / 2 + 15}px`;
    const bar = document.createElement('div');
    bar.className = 'dwu-loading-bar';
    const fill = document.createElement('div');
    fill.className = 'dwu-loading-fill';
    bar.append(fill);
    const step = document.createElement('div');
    step.className = 'dwu-loading-step';
    box.append(galaxy, head, bar, step);
    el.append(box);
    root.append(el);
    // Scaled like the screen windows (originalWindow.ts originalWindowScale), centred.
    const layout = (): void => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const k = originalWindowScale(vw, vh, uiScaleFactor(), LOADING_PANEL_W, LOADING_PANEL_H);
        box.style.left = `${Math.round((vw - LOADING_PANEL_W * k) / 2)}px`;
        box.style.top = `${Math.round((vh - LOADING_PANEL_H * k) / 2)}px`;
        box.style.transform = k === 1 ? '' : `scale(${k})`;
    };
    layout();
    window.addEventListener('resize', layout);
    return {
        update(p) {
            const f = Math.max(0, Math.min(1, p.fraction));
            fill.style.transform = `scaleX(${f})`;
            el.setAttribute('aria-valuenow', String(Math.round(f * 100)));
            step.textContent = p.step;
        },
        close() {
            window.removeEventListener('resize', layout);
            el.remove();
        },
    };
}

/** Resolve after the browser has had a chance to paint (rAF, then a task); a timer covers hidden tabs, where rAF
 *  does not fire. */
export function nextPaint(): Promise<void> {
    return new Promise((resolve) => {
        let done = false;
        const go = () => {
            if (done) return;
            done = true;
            setTimeout(resolve, 0);
        };
        requestAnimationFrame(go);
        setTimeout(go, 100);
    });
}

/**
 * Run a step generator to completion under a loading overlay. The overlay is painted before the first step; after
 * that the browser gets a frame whenever more than `sliceMs` has passed since the last one (steps are not equal: a
 * few take most of the time), so short steps do not each cost a frame.
 */
export async function runStepsWithProgress<T>(title: string, steps: Generator<StepProgress, T, void>, sliceMs = 50): Promise<T> {
    const overlay = showLoadingOverlay(title);
    try {
        await nextPaint();
        let last = performance.now();
        for (;;) {
            const r = steps.next();
            if (r.done === true) return r.value;
            overlay.update(r.value);
            if (performance.now() - last >= sliceMs) {
                await nextPaint();
                last = performance.now();
            }
        }
    } finally {
        overlay.close();
    }
}
