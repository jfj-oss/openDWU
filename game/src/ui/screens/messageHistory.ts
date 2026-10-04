// Message History panel (task 12i): every line the top-middle message ticker showed, newest first, with its date;
// opened by a click on the ticker (the H key opens the original's Messages window, galacticHistory.ts). Not in the
// original: drawn as one of its ScreenPanels (originalWindow.ts) with ListViewBase's row colours, beside the ticker,
// without pausing the game.

import './messageHistory.css';
import { getHudMessageHistory, type HudMessageEntry } from '../hud';
import { el, FONT, openOriginalWindow, place, scrollPanel, type OriginalWindow } from '../originalWindow';

/** One displayed row of the panel. Pure so the row logic is testable without
 * a DOM (jsdom is not configured). */
export interface HistoryRow {
    text: string;
    /** The entry's `at` display date ('' when none was recorded). */
    at: string;
}

/** Rows for the panel: the entries in reverse order (newest first). */
export function historyRows(entries: ReadonlyArray<HudMessageEntry>): HistoryRow[] {
    return [...entries].reverse().map((e) => ({ text: e.text, at: e.at }));
}

interface OpenState {
    win: OriginalWindow;
    close: () => void;
}

let open: OpenState | null = null;

/** Open the Message History panel, or close it if it is already open. Guarded
 * for node-based tests (no DOM): opening is a no-op there, closing still works. */
export function toggleMessageHistory(): void {
    if (open) {
        open.close();
    } else if (typeof document !== 'undefined') {
        open = createMessageHistory();
    }
}

/** Close the Message History panel (no-op when closed). */
export function closeMessageHistory(): void {
    open?.close();
}

/** ScreenPanel size (original pixels); the list fills the body less a 10 px margin. */
const WIN = { w: 520, h: 600 };

function createMessageHistory(): OpenState {
    const win = openOriginalWindow({
        id: 'messageHistory',
        title: 'Message History',
        icon: 'messages.png',
        width: WIN.w,
        height: WIN.h,
        // The ticker's own list: it does not pause the game (it opened as a side panel before).
        noAutoPause: true,
        // Top left, under the time controls.
        anchor: () => ({ left: 16, top: 130 }),
        onClose: () => {
            if (open !== null && open.win === win) open = null;
        },
    });
    // Hook kept from the earlier DOM (scripts find the panel by it).
    win.frame.classList.add('message-history-wrap');
    const list = place(scrollPanel('mh-list'), 10, 10, win.bodySize.w - 20, win.bodySize.h - 20);
    const rows = historyRows(getHudMessageHistory());
    if (rows.length === 0) list.appendChild(el('div', 'mh-empty', 'No messages'));
    rows.forEach((row, i) => {
        const line = el('div', `mh-row message-history-row${i % 2 === 1 ? ' mh-alt' : ''}`);
        line.style.fontSize = `${FONT.normal}px`;
        if (row.at !== '') line.appendChild(el('span', 'mh-date message-history-date', row.at));
        line.appendChild(el('span', 'mh-text message-history-text', row.text));
        list.appendChild(line);
    });
    win.body.appendChild(list);
    return { win, close: () => win.close() };
}
