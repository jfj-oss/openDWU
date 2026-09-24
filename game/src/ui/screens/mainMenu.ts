// Main menu screen (task 06a). Port of the original's main menu: a full-screen
// MainBackground.jpg, the vertical menu list in a dark rounded panel near the
// top, the Title.png logo lower-middle, and small corner items (Galactopedia,
// CheckForUpdates + version text, Credits) plus the theme label top-centre.
// The galaxy/Main View/HUD are created only after Start New Game is clicked;
// booting with any of ?seed/shape/stars/zoom/cx/cy/skipMenu skips the menu.

import './mainMenu.css';

/** A main-menu entry: its control id, human label, and chrome image base name
 * (the real files are `Menu_<imageBase>_Inactive.png` / `_Active.png`). */
export interface MenuItem {
    id: string;
    label: string;
    imageBase: string;
}

/** The vertical menu list, in display order (original main-menu order). */
export const MENU_ITEMS: readonly MenuItem[] = [
    { id: 'Tutorials', label: 'Tutorials', imageBase: 'Menu_Tutorials' },
    { id: 'StartNewGame', label: 'Start New Game', imageBase: 'Menu_StartNewGame' },
    { id: 'LoadGame', label: 'Load Game', imageBase: 'Menu_LoadGame' },
    { id: 'Options', label: 'Options', imageBase: 'Menu_Options' },
    { id: 'ChangeTheme', label: 'Change Theme', imageBase: 'Menu_ChangeTheme' },
    { id: 'Exit', label: 'Exit', imageBase: 'Menu_Exit' },
];

const CHROME = '/assets/dwu/images/ui/chrome';

/** True when the URL asks to boot straight into the game (screenshot scripts). */
export function shouldSkipMenu(search: string): boolean {
    const p = new URLSearchParams(search);
    return ['seed', 'shape', 'stars', 'zoom', 'cx', 'cy', 'skipMenu'].some((k) => p.get(k) !== null);
}

/** True when the URL asks to open the new-game wizard directly (screenshots). */
export function shouldOpenWizard(search: string): boolean {
    return new URLSearchParams(search).get('screen') === 'wizard';
}

export interface MainMenuRefs {
    root: HTMLDivElement;
    /** Remove the menu from the document (called on Start New Game). */
    destroy(): void;
}

/** Build the main menu overlay and append it to document.body. */
export function createMainMenu(onStartNewGame: () => void): MainMenuRefs {
    const root = document.createElement('div');
    root.id = 'main-menu';

    // Full-screen background art (object-fit: cover), black behind.
    const bg = document.createElement('img');
    bg.className = 'menu-background';
    bg.src = `${CHROME}/MainBackground.jpg`;
    bg.alt = '';
    bg.draggable = false;
    root.appendChild(bg);

    // Top-centre theme label.
    const theme = document.createElement('div');
    theme.className = 'menu-theme-label';
    theme.textContent = 'Current Theme: Distant Worlds Original';
    root.appendChild(theme);

    // Centred vertical menu list in a dark rounded translucent panel.
    const panel = document.createElement('div');
    panel.className = 'menu-panel';
    for (const item of MENU_ITEMS) {
        panel.appendChild(buildMenuItem(item, onStartNewGame));
    }
    root.appendChild(panel);

    // Title logo, lower-middle, ~50% of window width (aspect kept).
    const title = document.createElement('img');
    title.className = 'menu-title';
    title.src = `${CHROME}/Title.png`;
    title.alt = 'Distant Worlds Universe';
    title.draggable = false;
    root.appendChild(title);

    // Small corner items.
    root.appendChild(buildCornerItem('Galactopedia', 'menu-corner-galactopedia'));
    const updates = buildCornerItem('CheckForUpdates', 'menu-corner-updates');
    const version = document.createElement('div');
    version.className = 'menu-version';
    version.textContent = 'Version 1.9.5 (recreation)';
    updates.appendChild(version);
    root.appendChild(updates);
    root.appendChild(buildCornerItem('Credits', 'menu-corner-credits'));

    document.body.appendChild(root);
    return {
        root,
        destroy() {
            root.remove();
        },
    };
}

/** One row of the vertical list: Inactive art, swapped to Active on hover. */
function buildMenuItem(item: MenuItem, onStartNewGame: () => void): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'menu-item';
    btn.title = item.label;
    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    const inactive = `${CHROME}/${item.imageBase}_Inactive.png`;
    const active = `${CHROME}/${item.imageBase}_Active.png`;
    img.src = inactive;
    btn.appendChild(img);
    btn.addEventListener('mouseenter', () => {
        img.src = active;
    });
    btn.addEventListener('mouseleave', () => {
        img.src = inactive;
    });
    btn.addEventListener('click', () => {
        if (item.id === 'StartNewGame') {
            onStartNewGame();
            return;
        }
        if (item.id === 'Exit') {
            exitApp();
            return;
        }
        console.info(`TODO(menu): ${item.id}`);
    });
    return btn;
}

/** A small corner item (top-left / bottom-left / bottom-right). */
function buildCornerItem(id: string, className: string): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `menu-corner ${className}`;
    btn.title = id;
    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    const inactive = `${CHROME}/Menu_${id}_Inactive.png`;
    const active = `${CHROME}/Menu_${id}_Active.png`;
    img.src = inactive;
    btn.appendChild(img);
    btn.addEventListener('mouseenter', () => {
        img.src = active;
    });
    btn.addEventListener('mouseleave', () => {
        img.src = inactive;
    });
    btn.addEventListener('click', () => {
        console.info(`TODO(menu): ${id}`);
    });
    return btn;
}

/** Exit: close the desktop window; in a plain browser show a toast instead. */
function exitApp(): void {
    const w = window as unknown as { close?: () => void };
    try {
        if (typeof w.close === 'function') {
            w.close();
            return;
        }
    } catch {
        // some browsers throw unless the tab was script-opened
    }
    const toast = document.createElement('div');
    toast.className = 'menu-toast';
    toast.textContent = 'Close this tab to exit';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}