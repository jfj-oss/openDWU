// Main menu screen (task 06a). Port of the visual layout of Main.Part*.cs /
// Start.InitializeComponent.cs's pnlMainMenu, using the original chrome art
// served from /assets/dwu/images/ui/chrome/.
import './mainMenu.css';

const CHROME = '/assets/dwu/images/ui/chrome/';

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
}

export interface MainMenuRefs {
    root: HTMLDivElement;
    destroy: () => void;
}

/** Electron sets a distinctive UA token; used to pick the Exit behaviour. */
function isDesktopShell(): boolean {
    return navigator.userAgent.includes('Electron');
}

function showExitToast(root: HTMLElement): void {
    const toast = document.createElement('div');
    toast.className = 'menu-toast';
    toast.textContent = 'Close this tab to exit';
    root.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

/** Build the main menu screen and append it to document.body. */
export function createMainMenu(callbacks: MainMenuCallbacks): MainMenuRefs {
    const root = document.createElement('div');
    root.className = 'main-menu';

    const bg = document.createElement('img');
    bg.className = 'main-menu-bg';
    bg.src = `${CHROME}MainBackground.jpg`;
    bg.alt = '';
    root.appendChild(bg);

    const themeLabel = document.createElement('div');
    themeLabel.className = 'main-menu-theme';
    themeLabel.textContent = 'Current Theme: Distant Worlds Original';
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
        btn.appendChild(img);

        btn.addEventListener('mouseenter', () => {
            img.src = `${CHROME}${item.imageBase}_Active.png`;
        });
        btn.addEventListener('mouseleave', () => {
            img.src = `${CHROME}${item.imageBase}_Inactive.png`;
        });
        btn.addEventListener('click', () => {
            switch (item.id) {
                case 'startNewGame':
                    callbacks.onStartNewGame();
                    break;
                case 'exit':
                    if (isDesktopShell()) {
                        window.close();
                    } else {
                        showExitToast(root);
                    }
                    break;
                default:
                    console.info(`TODO(menu): ${item.id}`);
                    break;
            }
        });
        panel.appendChild(btn);
    }
    root.appendChild(panel);

    // Title art, lower-middle.
    const title = document.createElement('img');
    title.className = 'main-menu-title';
    title.src = `${CHROME}Title.png`;
    title.alt = 'Distant Worlds: Universe';
    root.appendChild(title);

    // Corner items.
    const galactopedia = document.createElement('button');
    galactopedia.className = 'main-menu-corner main-menu-galactopedia';
    galactopedia.type = 'button';
    const galactopediaImg = document.createElement('img');
    galactopediaImg.src = `${CHROME}Menu_Galactopedia_Inactive.png`;
    galactopediaImg.alt = 'Galactopedia';
    galactopedia.appendChild(galactopediaImg);
    galactopedia.addEventListener('mouseenter', () => {
        galactopediaImg.src = `${CHROME}Menu_Galactopedia_Active.png`;
    });
    galactopedia.addEventListener('mouseleave', () => {
        galactopediaImg.src = `${CHROME}Menu_Galactopedia_Inactive.png`;
    });
    galactopedia.addEventListener('click', () => console.info('TODO(menu): galactopedia'));
    root.appendChild(galactopedia);

    const updatesWrap = document.createElement('div');
    updatesWrap.className = 'main-menu-corner main-menu-updates';
    const updates = document.createElement('button');
    updates.type = 'button';
    const updatesImg = document.createElement('img');
    updatesImg.src = `${CHROME}Menu_CheckForUpdates_Inactive.png`;
    updatesImg.alt = 'Check for Updates';
    updates.appendChild(updatesImg);
    updates.addEventListener('mouseenter', () => {
        updatesImg.src = `${CHROME}Menu_CheckForUpdates_Active.png`;
    });
    updates.addEventListener('mouseleave', () => {
        updatesImg.src = `${CHROME}Menu_CheckForUpdates_Inactive.png`;
    });
    updates.addEventListener('click', () => console.info('TODO(menu): checkForUpdates'));
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
    credits.appendChild(creditsImg);
    credits.addEventListener('mouseenter', () => {
        creditsImg.src = `${CHROME}Menu_Credits_Active.png`;
    });
    credits.addEventListener('mouseleave', () => {
        creditsImg.src = `${CHROME}Menu_Credits_Inactive.png`;
    });
    credits.addEventListener('click', () => console.info('TODO(menu): credits'));
    root.appendChild(credits);

    document.body.appendChild(root);

    return {
        root,
        destroy: () => root.remove(),
    };
}
