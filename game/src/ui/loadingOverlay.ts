// "Please wait" overlay for the long main-thread jobs: building a new galaxy (createGameSteps) and loading a save.
// Both are generators that yield a progress report between steps; runStepsWithProgress drives one to completion,
// updating the bar and handing the browser a frame whenever a step has run for a while, so the tab repaints (and does
// not trip the browser's "page unresponsive" check) instead of freezing for the whole job.
import './loadingOverlay.css';

export interface StepProgress {
    step: string;
    fraction: number;
}

export interface LoadingOverlay {
    update(p: StepProgress): void;
    close(): void;
}

export function showLoadingOverlay(title: string, root: HTMLElement = document.body): LoadingOverlay {
    const el = document.createElement('div');
    el.className = 'dwu-loading';
    el.setAttribute('role', 'progressbar');
    el.setAttribute('aria-valuemin', '0');
    el.setAttribute('aria-valuemax', '100');
    const box = document.createElement('div');
    box.className = 'dwu-loading-box';
    const head = document.createElement('div');
    head.className = 'dwu-loading-title';
    const spinner = document.createElement('div');
    spinner.className = 'dwu-loading-spinner';
    const label = document.createElement('span');
    label.textContent = title;
    head.append(spinner, label);
    const bar = document.createElement('div');
    bar.className = 'dwu-loading-bar';
    const fill = document.createElement('div');
    fill.className = 'dwu-loading-fill';
    bar.append(fill);
    const step = document.createElement('div');
    step.className = 'dwu-loading-step';
    box.append(head, bar, step);
    el.append(box);
    root.append(el);
    return {
        update(p) {
            const f = Math.max(0, Math.min(1, p.fraction));
            fill.style.transform = `scaleX(${f})`;
            el.setAttribute('aria-valuenow', String(Math.round(f * 100)));
            step.textContent = p.step;
        },
        close() {
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
