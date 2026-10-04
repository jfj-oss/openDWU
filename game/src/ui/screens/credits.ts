// Main-menu Credits (task 06k): a port of Start.1.cs:897 method_138 / method_139 on DistantWorlds.Controls
// ScrollingCreditsPanel. The panel (pnlAboutCredits) is 330 wide and the window's full height at x = Width - 350; its
// background is a snapshot of the screen under it, so the menu art shows through. method_139 fills it: Height / 20
// spacers (the column starts below the bottom edge), smallTitle.png, the headings and names, codeforce.png; text in
// font_7 (18.67 px bold) in the panel's DefaultTextColor (Color.Yellow) with a black copy at (+1, +1)
// (ScrollingCreditsPanel.Draw), every item centred. ScrollSpeed 30 px/s (DoScroll: SecondsPerTimerInterval 0.05 ×
// ScrollSpeed per tick); when nothing is in view any more it starts over. btnAboutClose "Close Credits" (font_7,
// 300 × 35) sits centred 55 px above the panel's bottom; method_140 closes the panel and shows menuCredits again.
// Ours: the recreation's line at the end, and Esc or a click outside the column also closes.
// Sizes are the original's pixels × the menu art scale (mainMenu.ts menuScale).
import './credits.css';
import { glassButton } from '../originalWindow';
import { tryGetText } from '../../sim/textResolver';

const CHROME = '/assets/dwu/images/ui/chrome/';

/** One entry of the scrolling column: a text line, a fixed-height spacer or a picture (the C# panel's AddText /
 * AddSpacer / AddImage items). */
export type CreditsItem = { kind: 'text'; text: string } | { kind: 'spacer'; height: number } | { kind: 'image'; file: string; width: number; height: number };

/** Default spacer height (C# _DefaultSpacerHeight = 20). */
export const CREDITS_DEFAULT_SPACER = 20;

/** ScrollingCreditsPanel's default speed in px per second (_ScrollSpeed = 20.0, advanced every
 * _SecondsPerTimerInterval = 0.05 s timer tick). */
export const CREDITS_SCROLL_SPEED = 20.0 / 0.05;

/** method_138's ScrollSpeed: 30 → 1.5 px every 0.05 s tick. */
export const CREDITS_MENU_SCROLL_SPEED = 30.0;

/** Timer tick in ms (C# _SecondsPerTimerInterval * 1000). */
export const CREDITS_TICK_MS = 50;

/** pnlAboutCredits: 330 wide at x = Width - 350 (method_138). */
export const CREDITS_PANEL_W = 330;
export const CREDITS_PANEL_RIGHT = 20;

/** The line the recreation adds after the original list. */
export const CREDITS_RECREATION_LINE = 'Recreation: Dwureup (TypeScript/PixiJS port)';

const gameText = (key: string, fallback: string): string => tryGetText(key) ?? fallback;

/**
 * method_139's items in order for a panel `viewHeight` px tall (Height / 20 leading spacers), then the recreation's
 * line. Texts go through TextResolver like the source (GameText.txt "Design && Development" = "Design & Development").
 */
export function buildCreditsItems(viewHeight = 1080): CreditsItem[] {
    const items: CreditsItem[] = [];
    const t = (s: string): void => {
        items.push({ kind: 'text', text: s });
    };
    const spacer = (): void => {
        items.push({ kind: 'spacer', height: CREDITS_DEFAULT_SPACER });
    };
    const lead = Math.floor(viewHeight / 20);
    for (let i = 0; i < lead; i++) spacer();
    items.push({ kind: 'image', file: 'smallTitle.png', width: 196, height: 118 });
    spacer();
    t(gameText('Design && Development', 'Design & Development'));
    t('ELLIOT GIBBS');
    spacer();
    t(gameText('Art Designer', 'Art Designer'));
    t('JASON BARISH');
    spacer();
    t(gameText('Additional Artwork', 'Additional Artwork'));
    t('RICHARD EVANS');
    t('PETR JACH');
    t('MARTIN WOOD');
    t('MARC VON MARTIAL');
    t('ELLIOT GIBBS');
    t('THE LORDZ GAME STUDIO');
    spacer();
    t(gameText('Concept Reviewer', 'Concept Reviewer'));
    t('CHITOSE GIBBS');
    spacer();
    spacer();
    spacer();
    t(`${gameText('Copyright Only', 'Copyright')} ©2014`);
    t('CODEFORCE LIMITED');
    items.push({ kind: 'image', file: 'codeforce.png', width: 303, height: 62 });
    t('www.codeforce.co.nz');
    t(gameText('All rights reserved', 'All rights reserved'));
    spacer();
    spacer();
    t(gameText('With special thanks to', 'With special thanks to'));
    t('Chitose, Natasha, Jessica and Benjamin');
    spacer();
    spacer();
    spacer();
    t('SLITHERINE GROUP');
    spacer();
    t(gameText('PRODUCERS', 'PRODUCERS'));
    t('Erik Rutins');
    // Ours (task 06k): this recreation.
    spacer();
    spacer();
    spacer();
    t(CREDITS_RECREATION_LINE);
    return items;
}

/** An item's height in original pixels (GetItemSize: the spacer's height, the picture's, one line of font_7). */
export function creditsItemHeight(item: CreditsItem): number {
    if (item.kind === 'spacer') return item.height;
    if (item.kind === 'image') return item.height;
    return 24; // MeasureString of one 18.67 px line
}

export interface CreditsScreenRefs {
    root: HTMLDivElement;
    destroy: () => void;
}

/** The menu art scale (mainMenu.ts menuScale; repeated here to keep the import graph one-way). */
function artScale(): number {
    return Math.min(1.4, Math.max(0.6, window.innerHeight / 1080));
}

/** Build the credits panel and append it to document.body. `onClose` is called when it closes ("Close Credits",
 * Esc, or a click outside the column). */
export function createCreditsScreen(onClose: () => void): CreditsScreenRefs {
    const s = artScale();
    const root = document.createElement('div');
    root.className = 'credits-overlay';

    let destroyed = false;
    let timer = 0;

    /** Remove the overlay and stop the scroll loop. */
    function destroy(): void {
        if (destroyed) return;
        destroyed = true;
        window.clearInterval(timer);
        document.removeEventListener('keydown', onKeyDown);
        root.remove();
    }

    function close(): void {
        destroy();
        onClose();
    }

    // pnlAboutCredits: 330 × Height at x = Width - 350.
    const panel = document.createElement('div');
    panel.className = 'credits-panel';
    panel.style.width = `${CREDITS_PANEL_W * s}px`;
    panel.style.right = `${CREDITS_PANEL_RIGHT * s}px`;
    panel.addEventListener('click', (e) => e.stopPropagation());
    root.appendChild(panel);

    // The scrolling column (each item centred, ScrollingCreditsPanel.Draw).
    const column = document.createElement('div');
    column.className = 'credits-column';
    column.style.fontSize = `${18.67 * s}px`;
    for (const item of buildCreditsItems(window.innerHeight / s)) {
        if (item.kind === 'spacer') {
            const sp = document.createElement('div');
            sp.className = 'credits-spacer';
            sp.style.height = `${item.height * s}px`;
            column.appendChild(sp);
        } else if (item.kind === 'image') {
            const img = document.createElement('img');
            img.className = 'credits-image';
            img.src = `${CHROME}${item.file}`;
            img.alt = '';
            img.draggable = false;
            img.style.width = `${item.width * s}px`;
            img.style.height = `${item.height * s}px`;
            column.appendChild(img);
        } else {
            const line = document.createElement('div');
            line.className = 'credits-line';
            line.textContent = item.text;
            column.appendChild(line);
        }
    }
    panel.appendChild(column);

    // btnAboutClose: "Close Credits", font_7, 300 × 35, centred, its top 55 px above the panel's bottom.
    const closeBtn = glassButton(tryGetText('Close Credits') ?? 'Close Credits', { size: 18.67 * s, className: 'credits-close', onClick: () => close() });
    closeBtn.style.width = `${300 * s}px`;
    closeBtn.style.height = `${35 * s}px`;
    closeBtn.style.left = `${((CREDITS_PANEL_W - 300) / 2) * s}px`;
    closeBtn.style.bottom = `${(55 - 35) * s}px`;
    panel.appendChild(closeBtn);

    document.body.appendChild(root);

    // SetScrollPosition(0) + StartScroll: the items begin at their own tops (the leading spacers put the first picture
    // at the bottom edge) and move up ScrollSpeed × 0.05 px per tick.
    let offset = 0;
    function tick(): void {
        offset -= (CREDITS_MENU_SCROLL_SPEED * s * CREDITS_TICK_MS) / 1000;
        // DoScroll: when no item is in view any more, ResetControlPositions and scroll again.
        if (offset <= -column.offsetHeight) offset = 0;
        column.style.transform = `translateY(${offset}px)`;
    }
    timer = window.setInterval(tick, CREDITS_TICK_MS);

    function onKeyDown(e: KeyboardEvent): void {
        if (e.key === 'Escape') {
            e.preventDefault();
            close();
        }
    }
    document.addEventListener('keydown', onKeyDown);
    root.addEventListener('click', () => close());

    return {
        root,
        destroy,
    };
}
