// In-game Escape menu (task 10c). A centred modal that dims the map behind
// at 55%, pauses GalaxyTime while open and restores the previous paused state
// on close. Buttons: Resume, Save Game, Load Game, Options, Main Menu, Exit.
// The Options sub-panel edits src/ui/settings.ts (persisted) and drives the
// music player + UI scale.
import './gameMenu.css';
import { GalaxyTime } from '../../sim/clock';
import { musicControls, stopAllMusic } from '../../audio/musicPlayer';
import { startEffects } from '../../audio/effectsPlayer';
import { getSettings, updateSettings, uiScaleFactor, type GalaxyViewDisplayKey } from '../settings';

/** [galaxymarkers] The original's "Galaxy View - Ship Display" check boxes (Main.InitializeComponent.cs 9931-10041). */
const GALAXY_VIEW_DISPLAY_ROWS: ReadonlyArray<[string, GalaxyViewDisplayKey]> = [
    ['Fleets', 'galaxyViewDisplayFleets'],
    ['Military ships', 'galaxyViewDisplayMilitaryShips'],
    ['Resupply ships', 'galaxyViewDisplayResupplyShips'],
    ['Space ports', 'galaxyViewDisplaySpacePorts'],
    ['Other bases', 'galaxyViewDisplayOtherBases'],
    ['Exploration ships', 'galaxyViewDisplayExplorationShips'],
    ['Colony ships', 'galaxyViewDisplayColonyShips'],
    ['Construction ships', 'galaxyViewDisplayConstructionShips'],
    ['Civilian ships', 'galaxyViewDisplayCivilianShips'],
    ['Always show enemy Fleets', 'galaxyViewDisplayAlwaysEnemyFleets'],
    ['Always show enemy Military ships', 'galaxyViewDisplayAlwaysEnemyMilitaryShips'],
    ['Always show Pirates', 'galaxyViewDisplayAlwaysPirates'],
];
import { showToast } from '../toast';
import { getSaveLoadProvider } from './saveLoad';

/** Music volume adapter so the screen stays import-safe in node tests. */
export interface MusicAdapter {
    setVolume(v: number): void;
    mute(): void;
    unmute(): void;
}

/** Lazily fetch the real music player (musicPlayer.ts musicControls: both players). */
function defaultMusic(): MusicAdapter | null {
    try {
        return musicControls();
    } catch {
        return null;
    }
}

/** Sound effects adapter so the screen stays import-safe in node tests. */
export interface EffectsAdapter {
    setVolume(v: number): void;
    mute(): void;
    unmute(): void;
}

/** Lazily fetch the real effects player (created by startEffects at boot). */
function defaultEffects(): EffectsAdapter | null {
    try {
        return startEffects();
    } catch {
        return null;
    }
}

export interface GameMenuCallbacks {
    /** Called when "Main Menu" is confirmed (return to the main menu screen). */
    onMainMenu?: () => void;
    /** Called when "Exit" is confirmed (window.close / browser toast). */
    onExit?: () => void;
    /** "Options" (Main.Part7.cs:4507 btnGameMenuOptions_Click → method_402): open the Game Options screen
     *  (gameOptionsPanel.ts). Without it the button toggles the inline settings panel (buildOptionsPanel). */
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

/** Apply the persisted UI scale as `--ui-scale` on the HUD root. */
function applyUiScaleToHudRoot(): void {
    const hud = document.getElementById('hud');
    if (hud) {
        hud.style.setProperty('--ui-scale', String(uiScaleFactor()));
    }
}

/**
 * Build the Options sub-panel (music volume/mute, sound effects volume/mute,
 * UI scale, label toggles).
 * Task 06k: extracted from createGameMenu so the main menu's "Options" item
 * can open the same panel as a centred modal. The returned element carries
 * the `game-menu-options` class and its own rows; callers append it to their
 * own container. `music` / `effects` may be null (menu-only contexts without
 * a player); they are only touched inside event handlers, keeping the panel
 * import-safe in node tests.
 */
export function buildOptionsPanel(
    music: MusicAdapter | null,
    effects: EffectsAdapter | null = null,
): HTMLElement {
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

    // Sound effects volume slider + mute (task 12h). Built exactly like the
    // music row; it writes soundVolume/soundMuted and drives the effects
    // player. startEffects is only called inside the handlers via the
    // defaultEffects adapter, so panel build stays import-safe in node tests.
    const effectsAdapter = effects ?? defaultEffects();
    const sfxRow = document.createElement('div');
    sfxRow.className = 'game-menu-option-row';
    const sfxLabel = document.createElement('span');
    sfxLabel.className = 'game-menu-option-label';
    sfxLabel.textContent = 'Sound Effects Volume';
    const sfxSlider = document.createElement('input');
    sfxSlider.type = 'range';
    sfxSlider.min = '0';
    sfxSlider.max = '1';
    sfxSlider.step = '0.05';
    sfxSlider.value = String(settings.soundVolume);
    sfxSlider.setAttribute('aria-label', 'Sound effects volume');
    sfxSlider.addEventListener('input', () => {
        const v = parseFloat(sfxSlider.value);
        updateSettings({ soundVolume: v, soundMuted: false });
        effectsAdapter?.setVolume(v);
        effectsAdapter?.unmute();
    });
    const sfxMuteBtn = document.createElement('button');
    sfxMuteBtn.type = 'button';
    sfxMuteBtn.className = 'game-menu-mute';
    sfxMuteBtn.textContent = settings.soundMuted ? 'Unmute' : 'Mute';
    sfxMuteBtn.addEventListener('click', () => {
        const nowMuted = !getSettings().soundMuted;
        updateSettings({ soundMuted: nowMuted });
        if (nowMuted) {
            effectsAdapter?.mute();
        } else {
            effectsAdapter?.unmute();
        }
        sfxMuteBtn.textContent = nowMuted ? 'Unmute' : 'Mute';
    });
    sfxRow.append(sfxLabel, sfxSlider, sfxMuteBtn);
    optionsPanel.appendChild(sfxRow);

    // UI scale (90/100/110/125%).
    const scaleRow = document.createElement('div');
    scaleRow.className = 'game-menu-option-row';
    const scaleLabel = document.createElement('span');
    scaleLabel.className = 'game-menu-option-label';
    scaleLabel.textContent = 'UI Scale';
    // Slider 50% - 200% (100% = the default size).
    const scaleSelect = document.createElement('input');
    scaleSelect.type = 'range';
    scaleSelect.min = '50';
    scaleSelect.max = '200';
    scaleSelect.step = '5';
    scaleSelect.value = String(settings.uiScale);
    scaleSelect.setAttribute('aria-label', 'UI scale');
    const scaleValue = document.createElement('span');
    scaleValue.className = 'game-menu-option-value';
    scaleValue.textContent = `${settings.uiScale}%`;
    scaleSelect.addEventListener('input', () => {
        const pct = parseInt(scaleSelect.value, 10) || 100;
        scaleValue.textContent = `${pct}%`;
        updateSettings({ uiScale: pct });
        applyUiScaleToHudRoot();
    });
    scaleRow.append(scaleLabel, scaleSelect, scaleValue);
    optionsPanel.appendChild(scaleRow);

    // Show system names / region labels toggles.
    const makeToggle = (labelText: string, key: 'showSystemNames' | 'showRegionLabels' | 'freightFlowsDefault' | 'ditherGradients' | 'pullStationsToCentre' | 'showWeaponRangeCircles' | 'autoPauseInPopup' | 'simWorker' | GalaxyViewDisplayKey): HTMLElement => {
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
    optionsPanel.appendChild(makeToggle('Pause game when a screen is open', 'autoPauseInPopup'));
    optionsPanel.appendChild(makeToggle('Show system names', 'showSystemNames'));
    optionsPanel.appendChild(makeToggle('Show region labels', 'showRegionLabels'));
    optionsPanel.appendChild(makeToggle('Freight flows overlay on at start', 'freightFlowsDefault')); // [freightOverlay]
    // Applied live by main.ts (onSettingsChange → render/outputDither.ts setOutputDither).
    optionsPanel.appendChild(makeToggle('Dither gradients (no banding)', 'ditherGradients'));
    optionsPanel.appendChild(makeToggle('Draw stations closer to their planet / moon', 'pullStationsToCentre'));
    optionsPanel.appendChild(makeToggle('Show weapon range circles for the selected ship', 'showWeaponRangeCircles'));
    // docs/sim-worker.md: read by main.ts when the next game starts or loads; off = the in-thread fallback.
    optionsPanel.appendChild(makeToggle('Simulation in a worker thread (experimental, next game)', 'simWorker'));
    // [galaxymarkers] begin — Main.InitializeComponent.cs 9922-10041: grpGameOptionsAdvancedDisplaySettingsGalaxyIcons.
    const gvHead = document.createElement('div');
    gvHead.className = 'game-menu-option-label';
    gvHead.textContent = 'Galaxy View - Ship Display';
    optionsPanel.appendChild(gvHead);
    for (const [label, key] of GALAXY_VIEW_DISPLAY_ROWS) optionsPanel.appendChild(makeToggle(label, key));
    // [galaxymarkers] end

    return optionsPanel;
}

/** Build the in-game game menu and append it to document.body. */
export function createGameMenu(
    clock: GalaxyTime,
    callbacks: GameMenuCallbacks = {},
    music: MusicAdapter | null = null,
): GameMenuRefs {
    const resolvedMusic = music ?? defaultMusic();
    const resolvedEffects = defaultEffects();
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
    const optionsPanel = buildOptionsPanel(resolvedMusic, resolvedEffects);
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
    // Task 11a3: open the shared Save/Load panel (registered by src/main.ts
    // after booting a game view); fall back to a toast when no provider is
    // registered (e.g. the URL-param boot path without a full Game object).
    const saveBtn = makeButton('Save Game', () => {
        const provider = getSaveLoadProvider();
        if (provider) {
            provider.open('save');
        } else {
            showToast('Save Game not available in this mode', root);
        }
    });
    const loadBtn = makeButton('Load Game', () => {
        const provider = getSaveLoadProvider();
        if (provider) {
            provider.open('load');
        } else {
            showToast('Load Game not available in this mode', root);
        }
    });
    const optionsBtn = makeButton('Options', () => {
        if (callbacks.onOptions) {
            // The Game Options window pauses by itself (AutoPauseWhenInPopupWindow); the menu closes behind it.
            hide();
            callbacks.onOptions();
            return;
        }
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
            stopAllMusic(); // [audio] Main.Part7.cs:4568 btnGameMenuQuit: musicPlayer_0.Stop(); musicPlayer_1.Stop()
            if (callbacks.onExit) {
                callbacks.onExit();
            } else if (isDesktopShell()) {
                window.close();
            } else {
                showToast('Close this tab to exit', root);
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