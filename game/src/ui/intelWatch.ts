// Intelligence screen: "new information" tracking for the Threats and Knowledge pages (UI side, never sim state).
// Per viewing empire (a WeakMap, so hot-seat / multiplayer players each have their own): which page entries the player has
// already seen (a page open marks everything on it seen), which entries have ever been noticed (so a row that fades out and
// returns is not announced twice) and a throttled notification. The first poll of an empire is its baseline: loading a game
// never floods the player with "new" entries.

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import { EmpireMessage, EmpireMessageType, sendEmpireMessage, empireMessageHistory } from '../sim/messages';
import { galaxyStarDate } from '../sim/tick/simTime';
import { threatLeadRows, threatsSectionVisible } from './internalSecurityView';
import { knowledgeView, knowledgeVisible } from './knowledgeView';

export type IntelPage = 'characters' | 'threats' | 'knowledge';

/** Switching model: clicking a page's button opens it; clicking the open page's button goes back to the Characters list. */
export function nextIntelPage(current: IntelPage, clicked: IntelPage): IntelPage {
    return clicked === current ? 'characters' : clicked;
}

/** Real ms between two notifications; entries found in between collapse into the next one. */
export const NOTICE_THROTTLE_MS = 20_000;
/** Knowledge sections whose rows reorder or change with the year, not with what the empire found out. */
const NOISY_SECTIONS = new Set(['warCredit']);
/** Recent messages checked when looking for the entry's own message. */
const OWN_MESSAGE_WINDOW = 60;

export interface IntelEntry {
    key: string;
    /** The place the entry is about (a message's "go to" subject), or null. */
    target: unknown;
}

export interface IntelEntries {
    threats: IntelEntry[];
    knowledge: IntelEntry[];
}

/** Every entry currently on the two pages, keyed so a level rise (suspected -> confirmed) is a new entry. Pure. */
export function intelEntries(galaxy: Galaxy, empire: Empire): IntelEntries {
    const threats: IntelEntry[] = [];
    if (threatsSectionVisible(galaxy)) {
        for (const r of threatLeadRows(galaxy, empire)) {
            if (r.closed) continue;
            const id = (r.key as { id?: unknown } | null)?.id;
            threats.push({ key: `${typeof id === 'number' ? `lead${id}` : r.what}|${r.where}|${r.certainty}`, target: r.goTo });
        }
    }
    const knowledge: IntelEntry[] = [];
    if (knowledgeVisible(galaxy)) {
        const v = knowledgeView(galaxy, empire);
        for (const s of v.sections) {
            if (NOISY_SECTIONS.has(s.id)) continue;
            for (const r of s.rows) knowledge.push({ key: `${s.id}:${r.key}`, target: r.goTo ?? r.point });
        }
        for (const t of v.tips) knowledge.push({ key: `tip:${t}`, target: null });
    }
    return { threats, knowledge };
}

interface WatchState {
    baselined: boolean;
    noticed: Set<string>;
    seenThreats: Set<string>;
    seenKnowledge: Set<string>;
    open: IntelPage;
    pendingThreats: number;
    pendingKnowledge: number;
    pendingTarget: unknown;
    lastNoticeMs: number;
    unseenThreats: number;
    unseenKnowledge: number;
}

const states = new WeakMap<Empire, WatchState>();

function stateOf(empire: Empire): WatchState {
    let s = states.get(empire);
    if (s === undefined) {
        s = { baselined: false, noticed: new Set(), seenThreats: new Set(), seenKnowledge: new Set(), open: 'characters', pendingThreats: 0, pendingKnowledge: 0, pendingTarget: null, lastNoticeMs: -Infinity, unseenThreats: 0, unseenKnowledge: 0 };
        states.set(empire, s);
    }
    return s;
}

/** The Intelligence screen reports which page `empire` is looking at (null/'characters': none). */
export function setIntelPageOpen(empire: Empire, page: IntelPage): void {
    stateOf(empire).open = page;
}

/** How many entries on each page the player has not seen yet (as of the last poll): a non-zero count flashes the page's button. */
export function intelUnseen(empire: Empire): { threats: number; knowledge: number } {
    const s = stateOf(empire);
    return { threats: s.unseenThreats, knowledge: s.unseenKnowledge };
}

/** True when a message about `target` already reached `empire` (the threat sent its own), so no second line is needed. */
function hasOwnMessage(empire: Empire, target: unknown): boolean {
    if (target === null || typeof target !== 'object') return false;
    const recent = (list: readonly EmpireMessage[]): boolean => {
        for (let i = list.length - 1; i >= 0 && i >= list.length - OWN_MESSAGE_WINDOW; i--) if (list[i].subject === target) return true;
        return false;
    };
    return recent(empireMessageHistory(empire)) || recent((empire.messages ?? []) as EmpireMessage[]);
}

export interface IntelNotice {
    text: string;
    target: unknown;
}

/**
 * One poll for `empire` at real time `nowMs`: updates the unseen counts and returns the notification to send now (or null).
 * Entries are announced only once, never while their page is open, never when the threat sent its own message, and bursts
 * collapse into one line at most every NOTICE_THROTTLE_MS. `notify` false (the Intelligence screen's own refresh): only the
 * seen / unseen bookkeeping, the pending notice stays for the driver.
 */
export function pollIntel(galaxy: Galaxy, empire: Empire, nowMs: number, entries: IntelEntries = intelEntries(galaxy, empire), notify = true): IntelNotice | null {
    const s = stateOf(empire);
    const cur: Record<'threats' | 'knowledge', IntelEntry[]> = { threats: entries.threats, knowledge: entries.knowledge };
    if (!s.baselined) {
        s.baselined = true;
        for (const e of cur.threats) {
            s.noticed.add('t' + e.key);
            s.seenThreats.add(e.key);
        }
        for (const e of cur.knowledge) {
            s.noticed.add('k' + e.key);
            s.seenKnowledge.add(e.key);
        }
    }
    for (const e of cur.threats) {
        if (s.noticed.has('t' + e.key)) continue;
        s.noticed.add('t' + e.key);
        if (s.open === 'threats' || hasOwnMessage(empire, e.target)) continue;
        s.pendingThreats++;
        s.pendingTarget ??= e.target;
    }
    for (const e of cur.knowledge) {
        if (s.noticed.has('k' + e.key)) continue;
        s.noticed.add('k' + e.key);
        if (s.open === 'knowledge' || e.key.startsWith('tip:') || hasOwnMessage(empire, e.target)) continue; // a tip flashes the button only
        s.pendingKnowledge++;
        s.pendingTarget ??= e.target;
    }
    // A page that is open has been seen.
    if (s.open === 'threats') for (const e of cur.threats) s.seenThreats.add(e.key);
    if (s.open === 'knowledge') for (const e of cur.knowledge) s.seenKnowledge.add(e.key);
    s.unseenThreats = cur.threats.filter((e) => !s.seenThreats.has(e.key)).length;
    s.unseenKnowledge = cur.knowledge.filter((e) => !s.seenKnowledge.has(e.key)).length;
    if (s.open === 'threats') s.pendingThreats = 0;
    if (s.open === 'knowledge') s.pendingKnowledge = 0;

    const n = s.pendingThreats + s.pendingKnowledge;
    if (!notify || n === 0 || nowMs - s.lastNoticeMs < NOTICE_THROTTLE_MS) return null;
    const parts: string[] = [];
    if (s.pendingThreats > 0) parts.push(`${s.pendingThreats} new ${s.pendingThreats === 1 ? 'entry' : 'entries'} on the Threats page`);
    if (s.pendingKnowledge > 0) parts.push(`${s.pendingKnowledge} new ${s.pendingKnowledge === 1 ? 'entry' : 'entries'} on the Knowledge page`);
    const notice: IntelNotice = { text: `${parts.join(' and ')} (Intelligence, F4).`, target: n === 1 ? s.pendingTarget : null };
    s.pendingThreats = 0;
    s.pendingKnowledge = 0;
    s.pendingTarget = null;
    s.lastNoticeMs = nowMs;
    return notice;
}

/** Sends the notice as a quiet stock message (ticker and history, no popup) to `empire`. Clicking it goes to the entry when there is a single one. */
export function sendIntelNotice(galaxy: Galaxy, empire: Empire, notice: IntelNotice): void {
    const m = new EmpireMessage(null, EmpireMessageType.GeneralNeutralEvent, notice.target);
    m.title = 'Intelligence';
    m.description = notice.text;
    m.starDate = galaxyStarDate(galaxy);
    m.supressPopup = true;
    sendEmpireMessage(m, empire);
}

/** Forget an empire's tracking (a new game / loaded save reuses no state across galaxies, but tests do). */
export function resetIntelWatch(empire: Empire): void {
    states.delete(empire);
}

/**
 * The per-frame driver (main.ts): every 2 s of real time polls each local player and sends their notice. `viewers` is read
 * each time (hot-seat: all humans; multiplayer: only this client's player, so each client notifies only its own player).
 */
export function installIntelWatch(deps: { galaxy: Galaxy; viewers: () => readonly Empire[] }): { frame(): void } {
    let last = -Infinity;
    return {
        frame(): void {
            const now = performance.now();
            if (now - last < 2000) return;
            last = now;
            for (const e of deps.viewers()) {
                if (!e.active) continue;
                const notice = pollIntel(deps.galaxy, e, now);
                if (notice !== null) sendIntelNotice(deps.galaxy, e, notice);
            }
        },
    };
}
