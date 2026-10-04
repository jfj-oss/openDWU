// Tutorials (task 06l): the main-menu Tutorials list screen and the in-game
// tutorial window. Port of the original's pnlTutorials menu panel (Start.1.cs)
// and the in-game tutorial panel (Main.Part5.cs method_455: step title/body,
// Continue/Back/Exit buttons, pause/unpause per step). Modern HUD styling;
// steps whose original behaviour highlights/zooms/opens game UI show text
// only (see TODO(tutorial) notes in src/sim/data/tutorials.ts).

import './tutorials.css';
import { COLORS, FONT, dropText, glassButton, linkLabel, openOriginalWindow, place, text } from '../originalWindow';
import { Tutorial, TUTORIALS, loadTutorialFile, tutorialSummary } from '../../sim/data/tutorials';

export interface TutorialsScreenCallbacks {
    /** Start a game with default options for this tutorial file and open the
     *  tutorial window in it. */
    onStartTutorial: (file: string) => void;
}

export interface TutorialsScreenRefs {
    root: HTMLDivElement;
    destroy: () => void;
}

/** Build the Tutorials list screen and append it to document.body.
 *  Port of Start.2.cs method_119: pnlTutorialStart (a ScreenPanel, "Tutorials") with bold 15 px LinkLabels at x = 35,
 *  38 px apart from y = 20, and a 100 x 25 Cancel glass button at the bottom right. Recreation extras: the intro line,
 *  the per-tutorial step summary under each link, and the Basic / Advanced entries (so the panel is wider and taller
 *  than the original's 385 x 481). */
export function createTutorialsScreen(callbacks: TutorialsScreenCallbacks): TutorialsScreenRefs {
    const INTRO_H = 44;
    const PITCH = 38;
    const W = 520;
    const listTop = 20 + INTRO_H;
    const cancelY = listTop + TUTORIALS.length * PITCH + 10;
    const H = cancelY + 25 + 16 + 63; // body = H - 63 (ScreenPanel.DoLayout)
    const win = openOriginalWindow({
        id: 'tutorials',
        title: 'Tutorials',
        width: W,
        height: H,
        noAutoPause: true,
        onClose: () => undefined,
    });
    const root = win.root;
    root.classList.add('tutorials-overlay', 'ow-modal');
    root.style.background = 'rgba(0, 0, 0, 0.55)';
    root.addEventListener('click', (e) => {
        if (e.target === root) win.close();
    });
    const body = win.body;

    // Menu intro (recreation extra; the original menu shows no description).
    dropText(body, 'Choose a tutorial to start a new game and learn how Distant Worlds works. Each tutorial guides you through its topics step by step.', 35, 12, {
        size: FONT.tiny,
        color: COLORS.label,
        wrapWidth: W - 16 - 70,
    });

    TUTORIALS.forEach((entry, i) => {
        const y = listTop + i * PITCH;
        const link = place(linkLabel(entry.displayName, () => callbacks.onStartTutorial(entry.file), 15), 35, y);
        link.style.fontWeight = 'bold';
        link.classList.add('tutorials-row-name');
        const desc = place(text('', { size: FONT.tiny - 1, color: COLORS.label, className: 'tutorials-row-desc' }), 35, y + 19);
        desc.style.maxWidth = `${W - 16 - 70}px`;
        desc.style.overflow = 'hidden';
        desc.style.textOverflow = 'ellipsis';
        // Filled in from the file's step titles once it loads.
        void loadTutorialFile(entry.file).then((items) => {
            desc.textContent = tutorialSummary(items);
        }).catch(() => {
            desc.textContent = '';
        });
        body.append(link, desc);
    });

    const cancel = glassButton('Cancel', { onClick: () => win.close() });
    body.appendChild(place(cancel, W - 16 - 100 - 25, cancelY, 100, 25));

    return {
        root,
        destroy: () => win.close(),
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