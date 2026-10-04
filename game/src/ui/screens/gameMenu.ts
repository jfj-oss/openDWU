// In-game Escape menu (task 10c), restyled as the original's pnlGameMenu: a BorderPanel (BackColor (48, 48, 64) under
// Main.resx's striped BackgroundImage, 3 px alpha-96 border) laid out by Main.Part7.cs:3668 method_356 — 220 × 408,
// centred on the main view; picGameMenuHeader (Main.resx picGameMenuHeader.BackgroundImage, 196 × 118) at (12, 10),
// lblGameMenuTitle hidden; eight 200 × 30 GlassButtons in font_2 (18.67 px bold) at x 10, y 137 + 33 i:
// Exit Distant Worlds, Exit to Main Menu, Load Game, Save Game, Save Game As, Options, Enter Game Editor, Resume
// Playing (texts Main.Part3.cs:621, 879-885; method_356 renames Cancel to "Resume Playing").
// Opening it pauses GalaxyTime and closing restores the previous paused state (the original pauses only with
// AutoPauseWhenInPopupWindow on; ours always did and still does). No dim layer (the original draws none), but the
// full-screen layer still keeps clicks off the map while the menu is open.
// Handlers (Main.Part7.cs): btnGameMenuQuit_Click / btnGameMenuStartMenu_Click ask with MessageBoxEx Yes / No first;
// Load / Save / Save As open the shared Save/Load window (saveLoad.ts; the original opens the Windows file dialogs —
// Save Game re-saves string_2, the current game's file, which our window pre-fills); Options opens the Game Options
// window (method_402, gameOptionsPanel.ts); the Game Editor (method_506 / method_476) is not ported: its button is
// shown disabled with a tooltip.
import './gameMenu.css';
import { GalaxyTime } from '../../sim/clock';
import { stopAllMusic } from '../../audio/musicPlayer';
import { uiScaleFactor, onSettingsChange } from '../settings';
import { el, glassButton, messageBox, originalWindowScale, place } from '../originalWindow';
import { mainResxImageUrl } from '../resxImage';
import { tryGetText } from '../../sim/textResolver';
import { showToast } from '../toast';
import { getSaveLoadProvider } from './saveLoad';

/** Music volume adapter (kept for callers typing an audio stand-in; the options apply through ui/settings.ts). */
export interface MusicAdapter {
    setVolume(v: number): void;
    mute(): void;
    unmute(): void;
}

/** Sound effects adapter (see MusicAdapter). */
export interface EffectsAdapter {
    setVolume(v: number): void;
    mute(): void;
    unmute(): void;
}

export interface GameMenuCallbacks {
    /** Called when "Exit to Main Menu" is confirmed (return to the main menu screen). */
    onMainMenu?: () => void;
    /** Called when "Exit Distant Worlds" is confirmed (default: window.close / browser toast). */
    onExit?: () => void;
    /** "Options" (Main.Part7.cs:4507 btnGameMenuOptions_Click → method_402): open the Game Options screen
     *  (gameOptionsPanel.ts). */
    onOptions?: () => void;
}

export interface GameMenuRefs {
    root: HTMLDivElement;
    visible: () => boolean;
    show: () => void;
    hide: () => void;
    toggle: () => boolean;
    destroy: () => void;
}

// ---------------------------------------------------------------------------
// Pure pause helpers (testable without a DOM). Opening the menu snapshots the
// clock's paused flag, forces it true; closing restores the snapshot.
// ---------------------------------------------------------------------------

/** Snapshot `clock.paused` and force it true. Returns the previous value. */
export function pauseForMenu(clock: GalaxyTime): boolean {
    const prev = clock.paused;
    if (!prev) clock.paused = true;
    return prev;
}

/** Restore a previously-snapshotted paused state. */
export function restorePauseState(clock: GalaxyTime, prevPaused: boolean): void {
    clock.paused = prevPaused;
}

/** pnlGameMenu.Size (Main.Part7.cs method_356). */
export const GAME_MENU_W = 220;
export const GAME_MENU_H = 408;

export type GameMenuButtonId = 'quit' | 'startMenu' | 'load' | 'save' | 'saveAs' | 'options' | 'editor' | 'cancel';

/** The eight buttons of method_356, top to bottom: id, GameText key, y (x 10, 200 × 30). */
export const GAME_MENU_BUTTONS: readonly { id: GameMenuButtonId; text: string; y: number }[] = [
    { id: 'quit', text: 'Exit Distant Worlds', y: 137 },
    { id: 'startMenu', text: 'Exit to Main Menu', y: 170 },
    { id: 'load', text: 'Load Game', y: 203 },
    { id: 'save', text: 'Save Game', y: 236 },
    { id: 'saveAs', text: 'Save Game As', y: 269 },
    { id: 'options', text: 'Options', y: 302 },
    { id: 'editor', text: 'Enter Game Editor', y: 335 },
    { id: 'cancel', text: 'Resume Playing', y: 368 },
];

/** Main font_2 (Main.Part12.cs:1523 GenerateFont(18.67, bold)). */
const FONT_2 = 18.67;

/** Electron sets a distinctive UA token; used to pick the Exit behaviour. */
function isDesktopShell(): boolean {
    return navigator.userAgent.includes('Electron');
}

/** Apply the persisted UI scale as `--ui-scale` on the HUD root. */
function applyUiScaleToHudRoot(): void {
    const hud = document.getElementById('hud');
    if (hud) {
        hud.style.setProperty('--ui-scale', String(uiScaleFactor()));
    }
}

const gameText = (key: string): string => tryGetText(key) ?? key;

/** Build the in-game game menu and append it to document.body. */
export function createGameMenu(clock: GalaxyTime, callbacks: GameMenuCallbacks = {}): GameMenuRefs {
    let prevPaused = false;
    let open = false;

    const root = document.createElement('div');
    root.id = 'game-menu-overlay';
    root.style.display = 'none';

    // The click shield over the map (transparent: the original does not dim the view).
    root.appendChild(el('div', 'game-menu-dim'));

    // pnlGameMenu: a BorderPanel (ow-screen draws the 3 px border) with the striped background image.
    const panel = el('div', 'ow-screen ow-stripes game-menu-panel');
    panel.dataset.ow = 'gamemenu';
    panel.style.width = `${GAME_MENU_W}px`;
    panel.style.height = `${GAME_MENU_H}px`;

    // picGameMenuHeader (12, 10) 196 × 118; the title text stands in while the resource loads or when it is missing.
    const title = place(el('div', 'game-menu-title', gameText('Game Menu')), 12, 10, 196, 118);
    panel.appendChild(title);
    const header = place(el('img', 'game-menu-header'), 12, 10, 196, 118);
    header.alt = '';
    header.draggable = false;
    header.style.display = 'none';
    panel.appendChild(header);
    void mainResxImageUrl('picGameMenuHeader.BackgroundImage').then((url) => {
        if (url === null) return;
        header.src = url;
        header.style.display = '';
        title.style.display = 'none';
    });

    const openSaveLoad = (mode: 'save' | 'load', saveAs = false): void => {
        const provider = getSaveLoadProvider();
        if (provider) provider.open(mode, { saveAs });
        else showToast(`${mode === 'save' ? 'Save Game' : 'Load Game'} not available in this mode`, root);
    };

    const actions: Record<GameMenuButtonId, () => void> = {
        quit: () => {
            // btnGameMenuQuit_Click: method_372 (Yes / No, question icon).
            void messageBox({
                caption: gameText('Exit Distant Worlds'),
                text: gameText('Are you sure that you wish to exit this game?'),
                buttons: ['Yes', 'No'],
                icon: 'question',
            }).then((r) => {
                if (r !== 'Yes') return;
                hide();
                stopAllMusic(); // [audio] Main.Part7.cs:4568 btnGameMenuQuit: musicPlayer_0.Stop(); musicPlayer_1.Stop()
                if (callbacks.onExit) callbacks.onExit();
                else if (isDesktopShell()) window.close();
                else showToast('Close this tab to exit', document.body);
            });
        },
        startMenu: () => {
            // btnGameMenuStartMenu_Click: method_372, then back to the start screen.
            void messageBox({
                caption: gameText('Exit to main menu'),
                text: gameText('Are you sure that you wish to exit to the main menu?'),
                buttons: ['Yes', 'No'],
                icon: 'question',
            }).then((r) => {
                if (r !== 'Yes') return;
                hide();
                callbacks.onMainMenu?.();
            });
        },
        load: () => openSaveLoad('load'),
        save: () => openSaveLoad('save'),
        saveAs: () => openSaveLoad('save', true),
        options: () => {
            // The Game Options window pauses by itself (AutoPauseWhenInPopupWindow); the menu closes behind it.
            hide();
            callbacks.onOptions?.();
        },
        editor: () => undefined,
        cancel: () => hide(), // btnGameMenuCancel_Click → method_357
    };

    for (const b of GAME_MENU_BUTTONS) {
        const btn = glassButton(gameText(b.text), { onClick: actions[b.id], size: FONT_2, className: 'game-menu-btn' });
        btn.dataset.id = b.id;
        if (b.id === 'editor') {
            // The Game Editor (pnlGameEditor, method_476 / method_506) is not ported: disabled, with the tooltip on a
            // wrapper because a disabled button gets no hover.
            btn.disabled = true;
            const wrap = place(el('div', 'game-menu-btn-wrap'), 10, b.y, 200, 30);
            wrap.title = 'The Game Editor is not available in this recreation yet';
            wrap.appendChild(place(btn, 0, 0, 200, 30));
            panel.appendChild(wrap);
            continue;
        }
        panel.appendChild(place(btn, 10, b.y, 200, 30));
    }

    root.appendChild(panel);
    document.body.appendChild(root);

    // Apply the persisted UI scale once at creation so the HUD reflects it.
    applyUiScaleToHudRoot();

    /** Centre and scale the panel like the screen windows (originalWindow.ts originalWindowScale). */
    function layout(): void {
        if (!open) return;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const k = originalWindowScale(vw, vh, uiScaleFactor(), GAME_MENU_W, GAME_MENU_H);
        panel.style.left = `${Math.round((vw - GAME_MENU_W * k) / 2)}px`;
        panel.style.top = `${Math.round((vh - GAME_MENU_H * k) / 2)}px`;
        panel.style.transform = k === 1 ? '' : `scale(${k})`;
    }
    window.addEventListener('resize', layout);
    const offSettings = onSettingsChange(() => {
        layout();
        applyUiScaleToHudRoot();
    });

    function show(): void {
        if (open) return;
        open = true;
        prevPaused = pauseForMenu(clock);
        root.style.display = '';
        layout();
    }

    function hide(): void {
        if (!open) return;
        open = false;
        root.style.display = 'none';
        restorePauseState(clock, prevPaused);
    }

    function toggle(): boolean {
        if (open) {
            hide();
        } else {
            show();
        }
        return open;
    }

    return {
        root,
        visible: () => open,
        show,
        hide,
        toggle,
        destroy: () => {
            window.removeEventListener('resize', layout);
            offSettings();
            root.remove();
        },
    };
}
