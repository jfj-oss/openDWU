// Main menu screen (task 06a). Port of the visual layout of Main.Part*.cs /
// Start.InitializeComponent.cs's pnlMainMenu, using the original chrome art
// served from /assets/dwu/images/ui/chrome/. Task 06k adds the Credits
// screen and the Options modal.
import './mainMenu.css';
import { buildOptionsPanel, type MusicAdapter } from './gameMenu';
import { createCreditsScreen } from './credits';
import { createTutorialsScreen } from './tutorials';
import { musicControls, stopAllMusic } from '../../audio/musicPlayer';
import { openGalactopedia } from './galactopedia';
import { showToast } from '../toast';
import { openChangeTheme } from './changeTheme';
import { activeCustomizationSetName } from '../../sim/data/customization';
import { themeMenuBackgroundUrl } from '../../themeAssets';
import { getSettings } from '../settings';
import { tryGetText } from '../../sim/textResolver';

const CHROME = '/assets/dwu/images/ui/chrome/';

/** BaconStart.InitializeMore's background, resolved at the first menu of the session (undefined = not yet). */
let startupMenuBackground: string | null | undefined;

export interface MenuItem {
    id: string;
    label: string;
    /** Base file name (without _Inactive/_Active.png) under images/ui/chrome/. */
    imageBase: string;
}

/**
 * The vertical main-menu list, in the original order (Main.Part12.cs
 * LoadUiChromeButtons / Start.InitializeComponent.cs pnlMainMenu).
 */
export const MENU_ITEMS: MenuItem[] = [
    { id: 'tutorials', label: 'Tutorials', imageBase: 'Menu_Tutorials' },
    { id: 'startNewGame', label: 'Start New Game', imageBase: 'Menu_StartNewGame' },
    { id: 'loadGame', label: 'Load Game', imageBase: 'Menu_LoadGame' },
    { id: 'options', label: 'Options', imageBase: 'Menu_Options' },
    { id: 'changeTheme', label: 'Change Theme', imageBase: 'Menu_ChangeTheme' },
    { id: 'exit', label: 'Exit', imageBase: 'Menu_Exit' },
];

export interface MainMenuCallbacks {
    onStartNewGame: () => void;
    /** Task 06l: open the Tutorials list screen (or start a tutorial game). */
    onTutorials?: () => void;
    /** Called when "Load Game" is clicked (task 11a3: open the load panel). */
    onLoadGame?: () => void;
    /** Change Theme → Switch Theme (Start.1.cs btnThemeSwitch_Click → method_2): load and remember theme `name`. */
    onSwitchTheme?: (name: string) => void | Promise<void>;
}

export interface MainMenuRefs {
    root: HTMLDivElement;
    destroy: () => void;
}

/** Electron sets a distinctive UA token; used to pick the Exit behaviour. */
function isDesktopShell(): boolean {
    return navigator.userAgent.includes('Electron');
}

/**
 * Menu art scale (task 06c): s = clamp(innerHeight/1080, 0.6, 1.4). All
 * chrome art renders at its natural pixel size × s so items keep their real
 * aspect ratios and relative heights.
 */
export function menuScale(): number {
    const s = window.innerHeight / 1080;
    return Math.min(1.4, Math.max(0.6, s));
}

/** Preload an image (used for the _Active hover variants so swapping src on
 * mouseenter causes no layout shift or flicker). */
function preloadImage(src: string): void {
    const img = new Image();
    img.src = src;
}

/** Lazily fetch the real music player for the Options panel (created by
 * musicPlayer.ts musicControls); null if audio is unavailable. */
function menuMusic(): MusicAdapter | null {
    try {
        return musicControls();
    } catch {
        return null;
    }
}

/** Task 06k: open the Options sub-panel (shared with the in-game Escape
 * menu) as a centred modal over the main menu. Esc or ✕ closes it and
 * returns to the menu. */
export function openOptionsModal(root: HTMLElement): void {
    const overlay = document.createElement('div');
    overlay.className = 'main-menu-options-overlay';

    const dim = document.createElement('div');
    dim.className = 'main-menu-options-dim';
    overlay.appendChild(dim);

    const panel = document.createElement('div');
    panel.className = 'game-menu-panel main-menu-options-panel';

    const title = document.createElement('div');
    title.className = 'game-menu-title';
    title.textContent = 'Options';
    panel.appendChild(title);

    // The same rows the in-game Escape menu shows (music volume/mute, UI
    // scale, label toggles).
    panel.appendChild(buildOptionsPanel(menuMusic()));

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'game-menu-close';
    closeBtn.title = 'Close';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => close());
    panel.appendChild(closeBtn);

    overlay.appendChild(panel);
    root.appendChild(overlay);

    function onKeyDown(e: KeyboardEvent): void {
        if (e.key === 'Escape') {
            e.preventDefault();
            close();
        }
    }
    document.addEventListener('keydown', onKeyDown);

    function close(): void {
        document.removeEventListener('keydown', onKeyDown);
        overlay.remove();
    }
}

/** Build the main menu screen and append it to document.body. */
export function createMainMenu(callbacks: MainMenuCallbacks): MainMenuRefs {
    const root = document.createElement('div');
    root.className = 'main-menu';

    // Task 06c: all chrome art renders at natural size × s.
    const s = menuScale();

    const bg = document.createElement('img');
    bg.className = 'main-menu-bg';
    // BaconStart.cs 23-40 InitializeMore (once, from the Start form constructor): the startup theme's
    // images\customBackgroundImage.jpg replaces the background for the session.
    if (startupMenuBackground === undefined) startupMenuBackground = themeMenuBackgroundUrl();
    bg.src = startupMenuBackground ?? `${CHROME}MainBackground.jpg`;
    bg.alt = '';
    root.appendChild(bg);

    const themeLabel = document.createElement('div');
    themeLabel.className = 'main-menu-theme';
    // Start.cs method_1: "Current Theme: <set>", empty for the stock game.
    const activeTheme = activeCustomizationSetName();
    themeLabel.textContent = activeTheme === '' ? '' : `${tryGetText('Current Theme') ?? 'Current Theme'}: ${activeTheme}`;
    root.appendChild(themeLabel);

    // Vertical item list panel.
    const panel = document.createElement('div');
    panel.className = 'main-menu-panel';
    for (const item of MENU_ITEMS) {
        const btn = document.createElement('button');
        btn.className = 'main-menu-item';
        btn.type = 'button';
        btn.setAttribute('data-id', item.id);

        const img = document.createElement('img');
        img.src = `${CHROME}${item.imageBase}_Inactive.png`;
        img.alt = item.label;
        // Natural size × s (task 06c); height follows from the aspect ratio.
        img.style.width = `${280 * s}px`;
        btn.appendChild(img);

        // Preload the hover variant so swapping src on mouseenter is instant
        // and causes no layout shift.
        preloadImage(`${CHROME}${item.imageBase}_Active.png`);

        btn.addEventListener('mouseenter', () => {
            img.src = `${CHROME}${item.imageBase}_Active.png`;
        });
        btn.addEventListener('mouseleave', () => {
            img.src = `${CHROME}${item.imageBase}_Inactive.png`;
        });
        btn.addEventListener('click', () => {
            switch (item.id) {
                case 'tutorials':
                    // Task 06l: the Tutorials list screen (Start.1.cs pnlTutorials).
                    if (callbacks.onTutorials) {
                        callbacks.onTutorials();
                    } else {
                        createTutorialsScreen({ onStartTutorial: () => undefined });
                    }
                    break;
                case 'startNewGame':
                    callbacks.onStartNewGame();
                    break;
                case 'options':
                    // Task 06k: same options panel as the in-game Escape menu.
                    openOptionsModal(root);
                    break;
                case 'loadGame':
                    if (callbacks.onLoadGame) {
                        callbacks.onLoadGame();
                    } else {
                        console.info('TODO(menu): loadGame');
                    }
                    break;
                case 'exit':
                    stopAllMusic(); // [audio] Start.cs:2427 lnkExit: musicPlayer_0.Stop(); musicPlayer_1.Stop()
                    if (isDesktopShell()) {
                        window.close();
                    } else {
                        showToast('Close this tab to exit', root);
                    }
                    break;
                case 'changeTheme':
                    // Start.cs menuChangeTheme_Click → method_26 (pnlThemes).
                    void openChangeTheme({
                        current: getSettings().customizationSet,
                        onSwitch: async (name) => {
                            await callbacks.onSwitchTheme?.(name);
                        },
                    });
                    break;
                default:
                    console.info(`TODO(menu): ${item.id}`);
                    break;
            }
        });
        panel.appendChild(btn);
    }
    root.appendChild(panel);

    // Title art, lower-middle (task 06c): natural aspect, width =
    // min(482px * s, 40vw); bottom edge sits 6% above the window bottom.
    const title = document.createElement('img');
    title.className = 'main-menu-title';
    title.src = `${CHROME}Title.png`;
    title.alt = 'Distant Worlds: Universe';
    title.style.width = `min(${482 * s}px, 40vw)`;
    root.appendChild(title);

    // Corner items.
    const galactopedia = document.createElement('button');
    galactopedia.className = 'main-menu-corner main-menu-galactopedia';
    galactopedia.type = 'button';
    const galactopediaImg = document.createElement('img');
    galactopediaImg.src = `${CHROME}Menu_Galactopedia_Inactive.png`;
    galactopediaImg.alt = 'Galactopedia';
    // Natural size × s (115×93 art).
    galactopediaImg.style.width = `${115 * s}px`;
    preloadImage(`${CHROME}Menu_Galactopedia_Active.png`);
    galactopedia.appendChild(galactopediaImg);
    galactopedia.addEventListener('mouseenter', () => {
        galactopediaImg.src = `${CHROME}Menu_Galactopedia_Active.png`;
    });
    galactopedia.addEventListener('mouseleave', () => {
        galactopediaImg.src = `${CHROME}Menu_Galactopedia_Inactive.png`;
    });
    // Start.cs menuGalactopedia_Click: method_127("") -> the home page.
    galactopedia.addEventListener('click', () => openGalactopedia());
    root.appendChild(galactopedia);

    const updatesWrap = document.createElement('div');
    updatesWrap.className = 'main-menu-corner main-menu-updates';
    const updates = document.createElement('button');
    updates.type = 'button';
    const updatesImg = document.createElement('img');
    updatesImg.src = `${CHROME}Menu_CheckForUpdates_Inactive.png`;
    updatesImg.alt = 'Check for Updates';
    // Natural size × s (89×48 art).
    updatesImg.style.width = `${89 * s}px`;
    preloadImage(`${CHROME}Menu_CheckForUpdates_Active.png`);
    updates.appendChild(updatesImg);
    updates.addEventListener('mouseenter', () => {
        updatesImg.src = `${CHROME}Menu_CheckForUpdates_Active.png`;
    });
    updates.addEventListener('mouseleave', () => {
        updatesImg.src = `${CHROME}Menu_CheckForUpdates_Inactive.png`;
    });
    // The original checks its update server; this recreation has none.
    updates.addEventListener('click', () => showToast('No updates: this is the recreation build', root));
    const version = document.createElement('div');
    version.className = 'main-menu-version';
    version.textContent = 'Version 1.9.5 (recreation)';
    updatesWrap.appendChild(updates);
    updatesWrap.appendChild(version);
    root.appendChild(updatesWrap);

    const credits = document.createElement('button');
    credits.className = 'main-menu-corner main-menu-credits';
    credits.type = 'button';
    const creditsImg = document.createElement('img');
    creditsImg.src = `${CHROME}Menu_Credits_Inactive.png`;
    creditsImg.alt = 'Credits';
    // Natural size × s (89×44 art).
    creditsImg.style.width = `${89 * s}px`;
    preloadImage(`${CHROME}Menu_Credits_Active.png`);
    credits.appendChild(creditsImg);
    credits.addEventListener('mouseenter', () => {
        creditsImg.src = `${CHROME}Menu_Credits_Active.png`;
    });
    credits.addEventListener('mouseleave', () => {
        creditsImg.src = `${CHROME}Menu_Credits_Inactive.png`;
    });
    credits.addEventListener('click', () => {
        // Task 06k: scrolling credits screen (port of ScrollingCreditsPanel).
        const screen = createCreditsScreen(() => undefined);
    });
    root.appendChild(credits);

    document.body.appendChild(root);

    return {
        root,
        destroy: () => root.remove(),
    };
}
