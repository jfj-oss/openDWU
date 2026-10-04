// 18c — the council log: one entry per AI empire decision round of the local model (aiAdvisorDriver.ts), showing the
// empire, the star date, the model's rationale and what the sim did with each decision (✓ applied, ✗ blocked by a C#
// gate, ⊘ rejected as not legal). Transparency for the player: an empire's war or treaty offer comes with its reason.
// No original counterpart; styling is the original ScreenPanel (originalWindow.ts). Newest first, at most MAX_ENTRIES; the × hides the
// panel until the next entry.

import './aiAdvisorLog.css';
import type { StrategicTurn } from './aiAdvisorDriver';
import { openOriginalWindow, place, scrollPanel, type OriginalWindow } from './originalWindow';

export const MAX_ENTRIES = 6;
/** A rejected line (e.g. the long list of legal values) is cut to this many characters. */
export const MAX_LINE_CHARS = 110;

export interface CouncilLogLine {
    kind: 'ok' | 'blocked' | 'rejected' | 'error' | 'none';
    text: string;
}

export interface CouncilLogEntry {
    empire: string;
    /** Packed RGB (Empire.mainColor). */
    color: number;
    starDate: string;
    rationale: string;
    lines: CouncilLogLine[];
}

/** The log entry of a finished turn (pure). */
export function councilLogEntry(turn: StrategicTurn): CouncilLogEntry {
    const lines: CouncilLogLine[] = [];
    for (const r of turn.results) {
        if (r.status === 'applied') lines.push({ kind: 'ok', text: `✓ ${r.text}` });
        else if (r.status === 'blocked') lines.push({ kind: 'blocked', text: `✗ ${r.text}` });
        else lines.push({ kind: 'rejected', text: `⊘ ${r.text}` });
    }
    for (const r of turn.rejected) {
        const text = `⊘ ${r.id}${r.targetId !== undefined ? ` → ${r.targetId}` : ''}: ${r.reason}`;
        lines.push({ kind: 'rejected', text: text.length > MAX_LINE_CHARS ? `${text.slice(0, MAX_LINE_CHARS - 1)}…` : text });
    }
    if (turn.error !== undefined) lines.push({ kind: 'error', text: `No decision: ${turn.error}` });
    else if (turn.results.length === 0 && turn.rejected.length === 0) lines.push({ kind: 'none', text: 'No change' });
    return { empire: turn.empireName, color: turn.empire.mainColor, starDate: turn.starDate, rationale: turn.rationale, lines };
}

let root: HTMLElement | null = null;
let list: HTMLElement | null = null;
let win: OriginalWindow | null = null;
const entries: CouncilLogEntry[] = [];

function ensurePanel(): HTMLElement {
    if (root !== null && list !== null) return list;
    // Original-style ScreenPanel docked left, below the top bar (ui/originalWindow.ts); the close button hides it until
    // the next decision, the entries are kept. It does not pause the game or react to Escape.
    const w = openOriginalWindow({
        id: 'councillog',
        title: 'Empire councils (local model)',
        icon: 'diplomacy.png',
        width: 520,
        height: 460,
        noAutoPause: true,
        escapeCloses: false,
        anchor: () => ({ left: 44, top: 120 }),
        onClose: () => {
            if (win === w) {
                win = null;
                root = null;
                list = null;
            }
        },
    });
    win = w;
    root = w.root;
    root.classList.add('council-log');
    list = scrollPanel('council-log-list');
    place(list, 8, 8, w.bodySize.w - 16, w.bodySize.h - 16);
    w.body.appendChild(list);
    return list;
}

function render(): void {
    const l = ensurePanel();
    l.replaceChildren();
    for (const e of entries) {
        const item = document.createElement('div');
        item.className = 'council-log-entry';
        const hdr = document.createElement('div');
        hdr.className = 'council-log-entry-head';
        const sw = document.createElement('span');
        sw.className = 'council-log-swatch';
        sw.style.background = `rgb(${(e.color >> 16) & 255}, ${(e.color >> 8) & 255}, ${e.color & 255})`;
        const name = document.createElement('span');
        name.className = 'council-log-empire';
        name.textContent = e.empire;
        const date = document.createElement('span');
        date.className = 'council-log-date';
        date.textContent = e.starDate;
        hdr.append(sw, name, date);
        item.append(hdr);
        if (e.rationale !== '') {
            const r = document.createElement('div');
            r.className = 'council-log-rationale';
            r.textContent = `“${e.rationale}”`;
            item.append(r);
        }
        for (const line of e.lines) {
            const d = document.createElement('div');
            d.className = `council-log-line council-log-${line.kind}`;
            d.textContent = line.text;
            item.append(d);
        }
        l.append(item);
    }
}

/** Add a finished turn to the log (newest first) and show the panel. */
export function pushCouncilLog(turn: StrategicTurn): void {
    entries.unshift(councilLogEntry(turn));
    if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
    render();
}

/** Remove the panel and forget the entries (game teardown). */
export function closeCouncilLog(): void {
    win?.close();
    win = null;
    root = null;
    list = null;
    entries.length = 0;
}
