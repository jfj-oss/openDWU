// The Game End panel (pnlGameEnd): the outcome, "Continue Playing..." and "Exit to main menu".
//
// Ports: Main.Part12.cs:3423 DoGameEnd → Main.Part6.cs:3998 method_436 (the outcome lines, Continue disabled after a
// defeat that left the player without colonies or an active empire; empireComparison.ts gameEndBannerLines /
// canContinueAfterGameEnd), Main.Part6.cs:4044 btnGameEndContinue_Click (method_437 hide + method_155 resume) and
// Main.Part6.cs:4050 btnGameEndExit_Click (method_92 … method_3 / method_64: leave the game for the start screen).
// Button texts: Main.Part3.cs:877-878 ("Continue Playing...", "Exit to main menu").
//
// In 1.9.5 method_436 shows the outcome over the Empire Comparison window's Game Summary (Achievements tab,
// pnlGameSummary.OverlayTextLines — empireComparison.ts presentGameEnd opens it) and nothing sets pnlGameEnd.Visible:
// the panel and its buttons are left over from earlier versions (InitializeComponent places them at designer
// placeholder sizes, there is no layout code for them, and the method_431 taunt timer is never started). The buttons'
// handlers are still there, so the panel is shown with them; its layout (size and positions) is ours, beside the
// comparison window. The method_429-431 empire taunts are not ported (dead code; they would draw on Galaxy.Rnd).

import './gameEndPanel.css';
import type { Galaxy } from '../../sim/galaxy';
import type { GameEndEventArgs } from '../../sim/victory';
import { el, glassButton, hudScale, place, text } from '../originalWindow';
import { onSettingsChange, uiScaleFactor } from '../settings';
import { canContinueAfterGameEnd, gameEndBannerLines } from './empireComparison';

/** Our size for pnlGameEnd (original pixels; see the header). */
const PANEL_W = 380;
const PANEL_H = 196;
/** GameSummaryPanel's huge font (font_0, GenerateFont(32, bold)) for the headline; font_6 for the description. */
const F_HUGE = 32;
const F_TEXT = 16.67;
const F_BUTTON = 16.67;

/** Main.Part6.cs:4050 btnGameEndExit_Click: main.ts tears the game down and shows the main menu. */
let exitHandler: (() => void) | null = null;

/** main.ts: how "Exit to main menu" leaves the game (null when no game view is up). */
export function setGameEndExitHandler(fn: (() => void) | null): void {
    exitHandler = fn;
}

interface OpenPanel {
    root: HTMLElement;
    unsubscribe: () => void;
}

let open: OpenPanel | null = null;

/** pnlGameEnd.Visible. */
export function isGameEndPanelOpen(): boolean {
    return open !== null;
}

/** Main.Part6.cs:4037 method_437: hide the panel. */
export function closeGameEndPanel(): void {
    if (open === null) return;
    open.unsubscribe();
    window.removeEventListener('resize', layoutOpen);
    open.root.remove();
    open = null;
}

let layoutOpen: () => void = () => {};

/** Show the Game End panel for a GameEnd (DoGameEnd's UI part; the game is already paused). */
export function openGameEndPanel(galaxy: Galaxy, time: { paused: boolean }, e: GameEndEventArgs): HTMLElement {
    closeGameEndPanel();
    const root = el('div', 'ow-layer game-end-layer');
    const frame = el('div', 'ow-screen game-end-panel');
    frame.dataset.ow = 'gameend';
    root.appendChild(frame);

    // The outcome: method_436's lines ("VICTORY!" / "DEFEAT!", a blank, the description; a stalemate has no headline).
    const lines = gameEndBannerLines(e);
    const headline = lines.length === 3 ? lines[0] : '';
    if (headline !== '') frame.appendChild(place(text(headline, { size: F_HUGE, bold: true, color: 'rgb(255, 255, 0)', className: 'game-end-headline' }), 0, 14, PANEL_W));
    const desc = text(e.description, { size: F_TEXT, color: 'rgb(255, 255, 0)', wrapWidth: PANEL_W - 40, className: 'game-end-description' });
    frame.appendChild(place(desc, 20, headline !== '' ? 62 : 30, PANEL_W - 40, 60));

    // btnGameEndContinue / btnGameEndExit.
    const cont = glassButton('Continue Playing...', {
        size: F_BUTTON,
        className: 'game-end-continue',
        // method_436: disabled after a defeat with no colonies left or an inactive player empire.
        disabled: !canContinueAfterGameEnd(e, galaxy.playerEmpire),
        onClick: () => {
            closeGameEndPanel(); // method_437
            time.paused = false; // method_155
        },
    });
    frame.appendChild(place(cont, 20, 136, 160, 40));
    const exit = glassButton('Exit to main menu', {
        size: F_BUTTON,
        className: 'game-end-exit',
        onClick: () => {
            closeGameEndPanel(); // method_437 (inside btnGameEndExit_Click)
            exitHandler?.();
        },
    });
    frame.appendChild(place(exit, PANEL_W - 180, 136, 160, 40));

    // Scaled like the original-style windows (the HUD's factor), anchored at the right edge, vertically centred.
    const layout = (): void => {
        const k = Math.min(hudScale(window.innerHeight, uiScaleFactor()), (window.innerWidth - 16) / PANEL_W);
        frame.style.width = `${PANEL_W}px`;
        frame.style.height = `${PANEL_H}px`;
        frame.style.transform = `scale(${k})`;
        frame.style.left = `${Math.round(window.innerWidth - 16 - PANEL_W * k)}px`;
        frame.style.top = `${Math.round((window.innerHeight - PANEL_H * k) / 2)}px`;
    };
    layoutOpen = layout;
    layout();
    window.addEventListener('resize', layout);
    document.body.appendChild(root);
    open = { root, unsubscribe: onSettingsChange(() => layout()) };
    return frame;
}
