// In-game Escape menu (task 10c). A centred modal that dims the map behind
// at 55%, pauses GalaxyTime while open and restores the previous paused state
// on close. Buttons: Resume, Save Game, Load Game, Options, Main Menu, Exit.
// The Options sub-panel edits src/ui/settings.ts (persisted) and drives the
// music player + UI scale.
import './gameMenu.css';
import { GalaxyTime } from '../../sim/clock';
import { startMusic } from '../../audio/musicPlayer';
import { getSettings, updateSettings, uiScaleFactor } from '../settings';

/** Music volume adapter so the screen stays import-safe in node tests. */
export interface MusicAdapter {
    setVolume(v: number): void;
    mute(): void;
    unmute(): void;
}

/** Lazily fetch the real music player (created by startMusic at boot). */
function defaultMusic(): MusicAdapter | null {
    try {
        return startMusic();
    } catch {
        return null;
    }
}

export interface GameMenuCallbacks {
    /** Called when "Main Menu" is confirmed (return to the main menu screen). */
    onMainMenu?: () => void;
    /** Called when "Exit" is confirmed (window.close / browser toast). */
    onExit?: () => void;
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

/** True when focus is inside an input/textarea/contenteditable element. */
function isTypingTarget(target: EventTarget | null): boolean {
    const el = target as Partial<Pick<HTMLElement, 'tagName' | 'isContentEditable'>> | null;
    if (!el || typeof el.tagName !== 'string') return false;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return true;
    return !!el.isContentEditable;
}

/** Electron sets a distinctive UA token; used to pick the Exit behaviour. */
function isDesktopShell(): boolean {
    return navigator.userAgent.includes('Electron');
}

function showToast(root: HTMLElement, text: string): void {
    const toast = document.createElement('div');
    toast.className = 'game-menu-toast';
    toast.textContent = text;
    root.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

/** Apply the persisted UI scale as `--ui-scale` on the HUD root. */
function applyUiScaleToHudRoot(): void {
    const hud = document.getElementById('hud');
    if (hud) {
        hud.style.setProperty('--ui-scale', String(uiScaleFactor()));
    }
}

/**
 * Build the Options sub-panel (music volume/mute, UI scale, label toggles).
 * Task 06k: extracted from createGameMenu so the main menu's "Options" item
 * can open the same panel as a centred modal. The returned element carries
 * the `game-menu-options` class and its own rows; callers append it to their
 * own container. `music` may be null (menu-only contexts without a player).
 */
export function buildOptionsPanel(music: MusicAdapter | null): HTMLElement {
    const optionsPanel = document.createElement('div');
    optionsPanel.className = 'game-menu-options';

    const settings = getSettings();

    // Music volume slider + mute.
    const musicRow = document.createElement('div');
    musicRow.className = 'game-menu-option-row';
    const musicLabel = document.createElement('span');
    musicLabel.className = 'game-menu-option-label';
    musicLabel.textContent = 'Music Volume';
    const volSlider = document.createElement('input');
    volSlider.type = 'range';
    volSlider.min = '0';
    volSlider.max = '1';
    volSlider.step = '0.05';
    volSlider.value = String(settings.musicVolume);
    volSlider.setAttribute('aria-label', 'Music volume');
    volSlider.addEventListener('input', () => {
        const v = parseFloat(volSlider.value);
        updateSettings({ musicVolume: v, musicMuted: false });
        music?.setVolume(v);
        music?.unmute();
    });
    const muteBtn = document.createElement('button');
    muteBtn.type = 'button';
    muteBtn.className = 'game-menu-mute';
    muteBtn.textContent = settings.musicMuted ? 'Unmute' : 'Mute';
    muteBtn.addEventListener('click', () => {
        const nowMuted = !getSettings().musicMuted;
        updateSettings({ musicMuted: nowMuted });
        if (nowMuted) {
            music?.mute();
        } else {
            music?.unmute();
        }
        muteBtn.textContent = nowMuted ? 'Unmute' : 'Mute';
    });
    musicRow.append(musicLabel, volSlider, muteBtn);
    optionsPanel.appendChild(musicRow);

    // UI scale (90/100/110/125%).
    const scaleRow = document.createElement('div');
    scaleRow.className = 'game-menu-option-row';
    const scaleLabel = document.createElement('span');
    scaleLabel.className = 'game-menu-option-label';
    scaleLabel.textContent = 'UI Scale';
    const scaleSelect = document.createElement('select');
    scaleSelect.setAttribute('aria-label', 'UI scale');
    for (const pct of [90, 100, 110, 125]) {
        const opt = document.createElement('option');
        opt.value = String(pct);
        opt.textContent = `${pct}%`;
        if (pct === settings.uiScale) opt.selected = true;
        scaleSelect.appendChild(opt);
    }
    scaleSelect.addEventListener('change', () => {
        const pct = parseInt(scaleSelect.value, 10) || 100;
        updateSettings({ uiScale: pct });
        applyUiScaleToHudRoot();
    });
    scaleRow.append(scaleLabel, scaleSelect);
    optionsPanel.appendChild(scaleRow);

    // Show system names / region labels toggles.
    const makeToggle = (labelText: string, key: 'showSystemNames' | 'showRegionLabels'): HTMLElement => {
        const row = document.createElement('div');
        row.className = 'game-menu-option-row';
        const lbl = document.createElement('span');
        lbl.className = 'game-menu-option-label';
        lbl.textContent = labelText;
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = getSettings()[key];
        chk.setAttribute('aria-label', labelText);
        chk.addEventListener('change', () => {
            updateSettings({ [key]: chk.checked } as Partial<typeof settings>);
            // Task 10f: the Main View renderer reads these flags per frame
            // (src/render/mainView.ts), so no extra wiring is needed here.
        });
        row.append(lbl, chk);
        return row;
    };
    optionsPanel.appendChild(makeToggle('Show system names', 'showSystemNames'));
    optionsPanel.appendChild(makeToggle('Show region labels', 'showRegionLabels'));

    return optionsPanel;
}

/** Build the in-game game menu and append it to document.body. */
export function createGameMenu(
    clock: GalaxyTime,
    callbacks: GameMenuCallbacks = {},
    music: MusicAdapter | null = null,
): GameMenuRefs {
    const resolvedMusic = music ?? defaultMusic();
    let prevPaused = false;
    let open = false;

    const root = document.createElement('div');
    root.id = 'game-menu-overlay';
    root.style.display = 'none';

    // Dim layer (55%) behind the panel.
    const dim = document.createElement('div');
    dim.className = 'game-menu-dim';
    root.appendChild(dim);

    const panel = document.createElement('div');
    panel.className = 'game-menu-panel';

    const title = document.createElement('div');
    title.className = 'game-menu-title';
    title.textContent = 'Game Menu';
    panel.appendChild(title);

    const list = document.createElement('div');
    list.className = 'game-menu-list';
    panel.appendChild(list);

    // --- Options sub-panel (task 06k: shared buildOptionsPanel) -----------
    const optionsPanel = buildOptionsPanel(resolvedMusic);
    optionsPanel.style.display = 'none';

    // --- Button row -------------------------------------------------------
    const makeButton = (label: string, onClick: () => void): HTMLButtonElement => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'game-menu-btn';
        btn.textContent = label;
        btn.addEventListener('click', onClick);
        return btn;
    };

    const resumeBtn = makeButton('Resume', () => hide());
    const saveBtn = makeButton('Save Game', () => {
        // TODO(port): implement save — DistantWorlds.SaveGame.cs.
        showToast(root, 'Save Game not implemented yet');
    });
    const loadBtn = makeButton('Load Game', () => {
        // TODO(port): implement load — DistantWorlds.LoadGame.cs.
        showToast(root, 'Load Game not implemented yet');
    });
    const optionsBtn = makeButton('Options', () => {
        optionsPanel.style.display = optionsPanel.style.display === 'none' ? '' : 'none';
    });
    const mainMenuBtn = makeButton('Main Menu', () => {
        const ok = window.confirm('Return to the main menu? Unsaved progress will be lost.');
        if (ok) {
            hide();
            callbacks.onMainMenu?.();
        }
    });
    const exitBtn = makeButton('Exit', () => {
        const ok = window.confirm('Exit the game?');
        if (ok) {
            hide();
            if (callbacks.onExit) {
                callbacks.onExit();
            } else if (isDesktopShell()) {
                window.close();
            } else {
                showToast(root, 'Close this tab to exit');
            }
        }
    });
    list.append(resumeBtn, saveBtn, loadBtn, optionsBtn, mainMenuBtn, exitBtn);

    panel.appendChild(optionsPanel);
    root.appendChild(panel);

    // Close button (top-right of the panel).
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'game-menu-close';
    closeBtn.title = 'Close';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => hide());
    panel.appendChild(closeBtn);

    document.body.appendChild(root);

    // Apply the persisted UI scale once at creation so the HUD reflects it.
    applyUiScaleToHudRoot();

    function show(): void {
        if (open) return;
        open = true;
        prevPaused = pauseForMenu(clock);
        root.style.display = '';
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
            root.remove();
        },
    };
}