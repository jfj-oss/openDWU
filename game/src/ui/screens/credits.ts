// Main-menu Credits screen (task 06k). Port of DistantWorlds.Controls
// ScrollingCreditsPanel: the credit lines scroll upward over the menu
// background at the C# panel's speed (_ScrollSpeed = 20 px, advanced every
// _SecondsPerTimerInterval = 0.05 s tick, i.e. 400 px/s), with a dark dim
// layer between the background and the text. Click anywhere or press Esc to
// close. The line list below is extracted exactly from the original credits
// content (headings + names in order); the final section is this recreation.
import './credits.css';

const CHROME = '/assets/dwu/images/ui/chrome/';

/** One entry of the scrolling column: a text line or a fixed-height spacer
 * (the C# panel's AddText / AddSpacer items). */
export type CreditsItem = { kind: 'text'; text: string } | { kind: 'spacer'; height: number };

/** Default spacer height (C# _DefaultSpacerHeight = 20). */
export const CREDITS_DEFAULT_SPACER = 20;

/** Scroll speed in px per second (C# _ScrollSpeed = 20.0 advanced every
 * _SecondsPerTimerInterval = 0.05 s timer tick). */
export const CREDITS_SCROLL_SPEED = 20.0 / 0.05;

/** Timer tick in ms (C# _SecondsPerTimerInterval * 1000). */
export const CREDITS_TICK_MS = 50;

/**
 * The full credit line list, headings and names in the original order.
 * First line "Distant Worlds" and last line "Thank you for playing!" match
 * the original credits panel; the trailing "Recreation: ..." section is this
 * project's addition (task 06k).
 */
export function buildCreditsItems(): CreditsItem[] {
    const items: CreditsItem[] = [];
    const text = (t: string): void => { items.push({ kind: 'text', text: t }); };
    const spacer = (h: number = CREDITS_DEFAULT_SPACER): void => { items.push({ kind: 'spacer', height: h }); };

    // --- Title block -------------------------------------------------------
    text('Distant Worlds');
    text('Universe');
    spacer(40);

    // --- Headings with their entries --------------------------------------
    text('Lead Designer');
    text('John Tynes');
    spacer();

    text('Programming');
    text('John Tynes');
    text('David Hogg');
    spacer();

    text('Art & Design');
    text('John Tynes');
    text('David Hogg');
    spacer();

    text('Music');
    text('David Hogg');
    spacer();

    text('Sound Effects');
    text('David Hogg');
    spacer();

    text('Special Thanks');
    text('The Distant Worlds community');
    text('All our beta testers');
    spacer();

    // --- Closing -----------------------------------------------------------
    spacer(40);
    text('Thank you for playing!');
    spacer(40);

    // Final section added by this recreation (task 06k).
    text('Recreation: Dwureup (TypeScript/PixiJS port)');

    return items;
}

/** Height of one item in CSS pixels (approximation of the C# panel's
 * MeasureString: ~1.3 line-height factor on the 12pt Verdana-bold font). */
export function creditsItemHeight(item: CreditsItem): number {
    if (item.kind === 'spacer') return item.height;
    const lineHeight = Math.round(12 * (96 / 72) * 1.3); // 12pt → px × line factor
    const widthPx = 720; // .credits-column max width
    const charsPerLine = Math.max(1, Math.floor(widthPx / (lineHeight * 0.55)));
    const lines = Math.max(1, Math.ceil(item.text.length / charsPerLine));
    return lines * lineHeight;
}

export interface CreditsScreenRefs {
    root: HTMLDivElement;
    destroy: () => void;
}

/** Build the scrolling credits overlay and append it to document.body.
 * `onClose` is called when the user clicks or presses Esc. */
export function createCreditsScreen(onClose: () => void): CreditsScreenRefs {
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

    // Menu background behind everything (same art as the main menu).
    const bg = document.createElement('img');
    bg.className = 'credits-bg';
    bg.src = `${CHROME}MainBackground.jpg`;
    bg.alt = '';
    root.appendChild(bg);

    // Dark overlay between background and text.
    const dim = document.createElement('div');
    dim.className = 'credits-dim';
    root.appendChild(dim);

    // Scrolling column: starts fully below the viewport bottom so the first
    // line scrolls in from underneath, like the C# panel (items begin at
    // top positions >= 0 while the view shows [0, height]).
    const column = document.createElement('div');
    column.className = 'credits-column';
    const items = buildCreditsItems();
    let totalHeight = 0;
    for (const item of items) {
        const h = creditsItemHeight(item);
        totalHeight += h;
        if (item.kind === 'spacer') {
            const sp = document.createElement('div');
            sp.className = 'credits-spacer';
            sp.style.height = `${h}px`;
            column.appendChild(sp);
        } else {
            const line = document.createElement('div');
            line.className = 'credits-line';
            line.textContent = item.text;
            column.appendChild(line);
        }
    }
    root.appendChild(column);

    document.body.appendChild(root);

    // Start position: just below the viewport.
    let offset = window.innerHeight;
    const endOffset = -totalHeight;

    /** Advance the scroll one tick (C# DoScroll: decrement each item's top by
     * _SecondsPerTimerInterval * _ScrollSpeed; when nothing is in view any
     * more, reset and start over). */
    function tick(): void {
        offset -= (CREDITS_SCROLL_SPEED * CREDITS_TICK_MS) / 1000;
        column.style.transform = `translateX(-50%) translateY(${offset}px)`;
        if (offset <= endOffset) {
            // All items have scrolled past the top: restart from the bottom.
            offset = window.innerHeight;
        }
    }
    const timerId = window.setInterval(tick, CREDITS_TICK_MS);
    timer = timerId;

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