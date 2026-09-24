// Tutorials (task 06l): the main-menu Tutorials list screen and the in-game
// tutorial window. Port of the original's pnlTutorials menu panel (Start.1.cs)
// and the in-game tutorial panel (Main.Part5.cs method_455: step title/body,
// Continue/Back/Exit buttons, pause/unpause per step). Modern HUD styling;
// steps whose original behaviour highlights/zooms/opens game UI show text
// only (see TODO(tutorial) notes in src/sim/data/tutorials.ts).

import './tutorials.css';
import { Tutorial, TUTORIALS, loadTutorialFile, tutorialSummary } from '../../sim/data/tutorials';

const CHROME = '/assets/dwu/images/ui/chrome/';

export interface TutorialsScreenCallbacks {
    /** Start a game with default options for this tutorial file and open the
     *  tutorial window in it. */
    onStartTutorial: (file: string) => void;
}

export interface TutorialsScreenRefs {
    root: HTMLDivElement;
    destroy: () => void;
}

/** Build the Tutorials list screen and append it to document.body. */
export function createTutorialsScreen(callbacks: TutorialsScreenCallbacks): TutorialsScreenRefs {
    const root = document.createElement('div');
    root.className = 'tutorials-overlay';

    // Menu background behind everything (same art as the main menu/wizard).
    const dim = document.createElement('div');
    dim.className = 'tutorials-dim';
    root.appendChild(dim);

    const win = document.createElement('div');
    win.className = 'tutorials-window';

    const titlebar = document.createElement('div');
    titlebar.className = 'tutorials-titlebar';
    const title = document.createElement('div');
    title.className = 'tutorials-title';
    title.textContent = 'Tutorials';
    titlebar.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'tutorials-close';
    closeBtn.title = 'Close';
    closeBtn.textContent = '✕';
    titlebar.appendChild(closeBtn);
    win.appendChild(titlebar);

    const body = document.createElement('div');
    body.className = 'tutorials-body';

    const intro = document.createElement('p');
    intro.className = 'tutorials-intro';
    intro.textContent = 'Choose a tutorial to start a new game and learn how Distant Worlds works. Each tutorial guides you through its topics step by step.';
    body.appendChild(intro);

    const list = document.createElement('div');
    list.className = 'tutorials-list';
    for (const entry of TUTORIALS) {
        const row = document.createElement('div');
        row.className = 'tutorials-row';

        const info = document.createElement('div');
        info.className = 'tutorials-row-info';
        const name = document.createElement('div');
        name.className = 'tutorials-row-name';
        name.textContent = entry.displayName;
        const desc = document.createElement('div');
        desc.className = 'tutorials-row-desc';
        // Filled in from the file's step titles once it loads (the original
        // menu shows no description; this is a recreation convenience).
        void loadTutorialFile(entry.file).then((items) => {
            desc.textContent = tutorialSummary(items);
        }).catch(() => {
            desc.textContent = '';
        });
        info.append(name, desc);

        const start = document.createElement('button');
        start.type = 'button';
        start.className = 'tutorials-start-btn';
        start.textContent = 'Start';
        start.addEventListener('click', () => callbacks.onStartTutorial(entry.file));

        row.append(info, start);
        list.appendChild(row);
    }
    body.appendChild(list);
    win.appendChild(body);
    root.appendChild(win);

    function onKeyDown(e: KeyboardEvent): void {
        if (e.key === 'Escape') {
            e.preventDefault();
            close();
        }
    }
    document.addEventListener('keydown', onKeyDown);
    closeBtn.addEventListener('click', () => close());

    function close(): void {
        document.removeEventListener('keydown', onKeyDown);
        root.remove();
    }

    document.body.appendChild(root);

    return {
        root,
        destroy: () => root.remove(),
    };
}

// ---------------------------------------------------------------------------
// In-game tutorial window (Main.Part5.cs method_455).
// ---------------------------------------------------------------------------

export interface TutorialWindowCallbacks {
    /** Last step reached: the original unpauses and shows "Play This Game". */
    onPlayThisGame?: () => void;
    onClose?: () => void;
}

export interface TutorialWindowRefs {
    root: HTMLDivElement;
    destroy: () => void;
}

/** Open the draggable tutorial window over the running game. Shows the
 *  current step's title + body with Continue → / ← Back / Close and a
 *  `n / m` step counter. Port of method_455's visible behaviour:
 *  - LastStep: unpause + the Continue button becomes "Play This Game";
 *  - CurrentStep.UnpauseGame: unpause, else pause;
 *  - title label = "Tutorial: <Title>", text label = Text.
 *  The original also clears PreviousStep.OpenScreen.HighlightControls and
 *  zooms/scrolls to CurrentStep.ZoomScrollObject (ShipGroup/BuiltObject/
 *  Habitat/SystemInfo via mainView.method_2) — those objects are not wired
 *  up yet (text-only steps).
 *  TODO(tutorial): highlight/zoom/open-screen behaviours — Main.Part5.cs
 *  method_455 (OpenScreen.HighlightControls, ZoomScrollObject camera move). */
export function createTutorialWindow(
    tutorial: Tutorial,
    callbacks: TutorialWindowCallbacks = {},
): TutorialWindowRefs {
    const root = document.createElement('div');
    root.className = 'tutorial-window-wrap';

    const win = document.createElement('div');
    win.className = 'tutorial-window';

    // Title bar doubles as the drag handle.
    const titlebar = document.createElement('div');
    titlebar.className = 'tutorial-titlebar';
    const heading = document.createElement('div');
    heading.className = 'tutorial-heading';
    heading.textContent = 'Tutorial';
    titlebar.appendChild(heading);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'tutorial-close';
    closeBtn.title = 'Close';
    closeBtn.textContent = '✕';
    titlebar.appendChild(closeBtn);
    win.appendChild(titlebar);

    const content = document.createElement('div');
    content.className = 'tutorial-content';
    const stepTitle = document.createElement('div');
    stepTitle.className = 'tutorial-step-title';
    const stepText = document.createElement('pre');
    stepText.className = 'tutorial-step-text';
    content.append(stepTitle, stepText);
    win.appendChild(content);

    const footer = document.createElement('div');
    footer.className = 'tutorial-footer';
    const btnBack = document.createElement('button');
    btnBack.type = 'button';
    btnBack.className = 'tutorial-btn';
    btnBack.textContent = '← Back';
    const counter = document.createElement('span');
    counter.className = 'tutorial-counter';
    const btnContinue = document.createElement('button');
    btnContinue.type = 'button';
    btnContinue.className = 'tutorial-btn tutorial-btn-primary';
    btnContinue.textContent = 'Continue →';
    footer.append(btnBack, counter, btnContinue);
    win.appendChild(footer);

    root.appendChild(win);
    document.body.appendChild(root);

    let destroyed = false;

    /** Position the window at top-left (the original docks it there too). */
    function placeWindow(): void {
        win.style.left = `${Math.max(8, Math.round(window.innerWidth * 0.06))}px`;
        win.style.top = `${Math.max(8, Math.round(window.innerHeight * 0.12))}px`;
    }
    placeWindow();

    // Draggable by the title bar.
    let dragging = false;
    let grabDX = 0;
    let grabDY = 0;
    const onMove = (e: MouseEvent): void => {
        if (!dragging) return;
        const x = Math.min(Math.max(0, e.clientX - grabDX), window.innerWidth - 60);
        const y = Math.min(Math.max(0, e.clientY - grabDY), window.innerHeight - 40);
        win.style.left = `${x}px`;
        win.style.top = `${y}px`;
    };
    const onUp = (): void => {
        dragging = false;
    };
    titlebar.addEventListener('mousedown', (e) => {
        if (e.target === closeBtn) return;
        dragging = true;
        const rect = win.getBoundingClientRect();
        grabDX = e.clientX - rect.left;
        grabDY = e.clientY - rect.top;
        e.preventDefault();
    });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);

    function close(): void {
        if (destroyed) return;
        destroyed = true;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        document.removeEventListener('keydown', onKeyDown);
        root.remove();
        callbacks.onClose?.();
    }

    function onKeyDown(e: KeyboardEvent): void {
        if (e.key === 'Escape') {
            e.preventDefault();
            close();
        }
    }
    document.addEventListener('keydown', onKeyDown);
    closeBtn.addEventListener('click', () => close());

    /** Refresh the window from the tutorial's current state (method_455). */
    function refresh(): void {
        const total = tutorial.items.length;
        const step = tutorial.currentStep;
        if (step === null || tutorial.finished) {
            // Finished: nothing left to show; the caller closes the window.
            stepTitle.textContent = 'Tutorial complete!';
            stepText.textContent = '';
            counter.textContent = `${total} / ${total}`;
            btnBack.disabled = true;
            btnContinue.textContent = 'Play This Game';
            return;
        }
        const n = tutorial.index + 1;
        counter.textContent = `${n} / ${total}`;
        btnBack.disabled = tutorial.index <= 0;
        // LastStep: the Continue button becomes "Play This Game" (method_455).
        btnContinue.textContent = tutorial.lastStep ? 'Play This Game' : 'Continue →';
        // lblTutorialTitle.Text = "Tutorial: " + CurrentStep.Title
        stepTitle.textContent = `Tutorial: ${step.title}`;
        // lblTutorialText.Text = CurrentStep.Text
        stepText.textContent = step.text;
        stepText.scrollTop = 0;
    }

    btnBack.addEventListener('click', () => {
        if (tutorial.index > 0) {
            tutorial.index--;
            refresh();
        }
    });

    btnContinue.addEventListener('click', () => {
        if (tutorial.lastStep) {
            // method_455 LastStep branch: unpause + "Play This Game" ->
            // continue playing the game (window stays until closed).
            callbacks.onPlayThisGame?.();
            return;
        }
        tutorial.next();
        if (tutorial.finished) {
            close();
            return;
        }
        refresh();
    });

    refresh();

    return {
        root,
        destroy: close,
    };
}

/** Load a tutorial file and open its window (used when starting a game from
 * the Tutorials screen). Resolves to null if the file is missing. */
export async function openTutorialWindow(file: string, callbacks: TutorialWindowCallbacks = {}): Promise<TutorialWindowRefs | null> {
    let items;
    try {
        items = await loadTutorialFile(file);
    } catch (err) {
        console.warn(`Tutorial "${file}" could not be loaded`, err);
        return null;
    }
    const tutorial = new Tutorial();
    tutorial.name = file;
    tutorial.items = items;
    return createTutorialWindow(tutorial, callbacks);
}