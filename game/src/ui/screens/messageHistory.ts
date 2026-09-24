// Message History panel (task 12i): the original's "Historical messages"
// window (Main.Part5.cs), opened by the H key or a click on the top-middle
// message ticker. It lists every pushed HUD message, newest first, with the
// message date dimmed before it when present. Styling follows the Empires
// list / tutorial-window dark-panel tokens.

import './messageHistory.css';
import { getHudMessageHistory, type HudMessageEntry } from '../hud';

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
    root: HTMLElement;
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

function createMessageHistory(): OpenState {
    const root = document.createElement('div');
    root.className = 'message-history-wrap';

    const win = document.createElement('div');
    win.className = 'message-history-window';

    const titlebar = document.createElement('div');
    titlebar.className = 'message-history-titlebar';
    const heading = document.createElement('div');
    heading.className = 'message-history-heading';
    heading.textContent = 'Message History';
    titlebar.appendChild(heading);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'message-history-close';
    closeBtn.title = 'Close';
    closeBtn.textContent = '✕';
    titlebar.appendChild(closeBtn);
    win.appendChild(titlebar);

    const body = document.createElement('div');
    body.className = 'message-history-body';

    for (const row of historyRows(getHudMessageHistory())) {
        const line = document.createElement('div');
        line.className = 'message-history-row';
        if (row.at !== '') {
            const date = document.createElement('span');
            date.className = 'message-history-date';
            date.textContent = row.at;
            line.appendChild(date);
        }
        const text = document.createElement('span');
        text.className = 'message-history-text';
        text.textContent = row.text;
        line.appendChild(text);
        body.appendChild(line);
    }
    win.appendChild(body);
    root.appendChild(win);
    document.body.appendChild(root);

    function close(): void {
        document.removeEventListener('keydown', onKeyDown);
        root.remove();
        open = null;
    }

    // Escape closes the panel; stopImmediatePropagation keeps the global game-menu (and other open panels)
    // Escape handler (registered in createHud) from opening as well.
    function onKeyDown(e: KeyboardEvent): void {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopImmediatePropagation();
            close();
        }
    }
    document.addEventListener('keydown', onKeyDown);
    closeBtn.addEventListener('click', () => close());

    return { root, close };
}