// popupstubs: the stub list under the top-right money panel (DOM wiring of messageStubs.ts). Every popup message,
// queued conversation (messagePopups.ts) and advisor suggestion (advisorSuggestions.ts) shows as a one-line stub, newest
// at the top; up to 6 at once (Game Options setting), the rest scroll by (held while hovered, frozen while paused, wheel
// scrolls by hand). Clicking a stub opens the existing card / conversation dialog / suggestion window.

import './messageStubList.css';
import type { Empire } from '../sim/empire';
import type { Galaxy } from '../sim/galaxy';
import type { EmpireMessage } from '../sim/messages';
import { galaxyStarDate } from '../sim/tick/simTime';
import { resolveStarDateDescription } from '../sim/galaxyTime';
import { resolveGameText } from '../sim/textResolver';
import { advisorSuggestions } from '../sim/advisorQueue';
import { computeHudLayout } from './hudLayout';
import { getSettings, onSettingsChange, uiScaleFactor } from './settings';
import { rgbCss } from './hud';
import {
    addStub,
    advanceStubList,
    advisorIconUrl,
    createStubListState,
    markStubRead,
    messageIconUrl,
    messageStubTitle,
    oneLine,
    stepStubList,
    syncStubs,
    visibleStubs,
    TICKER_ROW_PX,
    type MessageStub,
    type StubListState,
} from './messageStubs';
import { conversationHeading, conversationQueue, openConversation, openMessageCard, openMessageKey } from './messagePopups';
import { advisorSuggestionView, openAdvisorSuggestion, openAdvisorSuggestionKey } from './advisorSuggestions';

/** Where the list sits: directly under the top-right money panel, same width (hudLayout.ts pnlMoney). The transform
 *  origin is the panel's top-right corner so the list stays under the panel at any UI scale. */
export function messageStubsRect(width: number, height: number): { right: number; top: number; w: number; origin: string } {
    const money = computeHudLayout(width, height)['pnlMoney'];
    const top = money.y + money.h + 4;
    return { right: Math.max(0, width - money.x - money.w), top, w: money.w, origin: `100% ${money.y - top}px` };
}

export interface MessageStubListOptions {
    player: Empire;
    galaxy: Galaxy;
    clock?: { paused: boolean };
}

// The state outlives install/remove within a game (pushes may arrive first); a new game clears it.
let state: StubListState = createStubListState();
let player: Empire | null = null;
let installed: { root: HTMLElement; frame: number; cleanup: () => void } | null = null;

const ids = new WeakMap<EmpireMessage, number>();
let nextId = 1;
function idOf(m: EmpireMessage): number {
    let id = ids.get(m);
    if (id === undefined) {
        id = nextId++;
        ids.set(m, id);
    }
    return id;
}

/** A popup message arrived (messagePopups.ts): add its stub. `read`: the card already opened by itself. */
export function pushMessageStub(m: EmpireMessage, read = false): void {
    addStub(state, {
        key: m,
        kind: 'message',
        icon: messageIconUrl(m, player),
        title: messageStubTitle(resolveGameText(m.title), resolveGameText(m.description), m.sender?.name ?? null),
        tooltip: oneLine(resolveGameText(m.description)),
        starDate: m.starDate,
        color: m.sender ? rgbCss(m.sender.mainColor) : null,
        needsAnswer: false,
        read,
    });
}

/** The card / dialog for `m` opened: its stub loses the unread dot. */
export function markMessageStubRead(m: EmpireMessage): void {
    markStubRead(state, m);
}

function el(tag: string, className: string, text?: string): HTMLElement {
    const e = document.createElement(tag);
    e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
}

export function installMessageStubList(opts: MessageStubListOptions): void {
    removeMessageStubList(false);
    const { galaxy } = opts;
    player = opts.player;
    const p = opts.player;

    const root = el('div', 'message-stubs');
    root.hidden = true;
    const viewport = el('div', 'message-stubs-viewport');
    const track = el('div', 'message-stubs-track');
    viewport.append(track);
    const more = el('div', 'message-stubs-more');
    root.append(viewport, more);
    document.body.append(root);

    let hovered = false;
    let renderedKey = '';
    root.addEventListener('mouseenter', () => (hovered = true));
    root.addEventListener('mouseleave', () => (hovered = false));
    root.addEventListener(
        'wheel',
        (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.deltaY !== 0) stepStubList(state, e.deltaY > 0 ? 1 : -1);
            render();
        },
        { passive: false },
    );

    function place(): void {
        const r = messageStubsRect(window.innerWidth, window.innerHeight);
        root.style.right = `${r.right}px`;
        root.style.top = `${r.top}px`;
        root.style.width = `${r.w}px`;
        const s = uiScaleFactor();
        root.style.transformOrigin = r.origin;
        root.style.transform = s === 1 ? '' : `scale(${s})`;
    }
    place();
    window.addEventListener('resize', place);
    const offSettings = onSettingsChange(() => {
        place();
        renderedKey = '';
        render();
    });

    function open(s: MessageStub): void {
        markStubRead(state, s.key);
        if (s.kind === 'message') openMessageCard(s.key);
        else if (s.kind === 'suggestion') openAdvisorSuggestion(s.key);
        else {
            const entry = conversationQueue().find((e) => e.message === s.key);
            if (entry) openConversation(entry);
        }
        renderedKey = '';
        render();
    }

    function stubRow(s: MessageStub, active: boolean): HTMLElement {
        const row = el('button', 'message-stub') as HTMLButtonElement;
        row.type = 'button';
        row.classList.add(`message-stub-${s.kind}`);
        if (s.needsAnswer) row.classList.add('message-stub-answer');
        if (active) row.classList.add('message-stub-active');
        row.title = s.tooltip;
        if (s.color !== null) row.style.setProperty('--stub-color', s.color);
        const icon = document.createElement('img');
        icon.className = 'message-stub-icon';
        icon.alt = '';
        if (s.icon !== null) icon.src = s.icon;
        const dot = el('span', 'message-stub-dot');
        if (s.read) dot.classList.add('message-stub-dot-read');
        row.append(icon, el('span', 'message-stub-title', s.title), el('span', 'message-stub-date', resolveStarDateDescription(s.starDate)), dot);
        row.addEventListener('click', () => open(s));
        return row;
    }

    function sync(): void {
        const starDate = galaxyStarDate(galaxy);
        const queue = conversationQueue();
        syncStubs(
            state,
            'conversation',
            queue.map((e) => e.message),
            (m) => {
                const entry = queue.find((e) => e.message === m)!;
                const heading = oneLine(conversationHeading(entry, p, starDate));
                const sender = entry.sender?.name ?? '';
                return {
                    key: m,
                    kind: 'conversation',
                    icon: messageIconUrl(m, p),
                    title: sender !== '' && heading !== '' ? `${sender}: ${heading}` : sender || heading || 'Message',
                    tooltip: oneLine(resolveGameText(m.description)),
                    starDate: m.starDate,
                    color: entry.sender ? rgbCss(entry.sender.mainColor) : null,
                    needsAnswer: true,
                };
            },
        );
        syncStubs(state, 'suggestion', advisorSuggestions(p), (m) => {
            const view = advisorSuggestionView(galaxy, p, m);
            return {
                key: m,
                kind: 'suggestion',
                icon: advisorIconUrl(m.advisorMessageType),
                title: view.title,
                tooltip: oneLine(view.text),
                starDate: m.starDate,
                color: null,
                needsAnswer: true,
            };
        });
    }

    function render(): void {
        const visible = getSettings().messageStubsVisible;
        const win = visibleStubs(state, visible);
        root.hidden = state.stubs.length === 0;
        if (root.hidden) return;
        const active = openMessageKey() ?? openAdvisorSuggestionKey();
        const rows = win.next !== null ? [...win.rows, win.next] : win.rows;
        const key = rows.map((s) => `${idOf(s.key)}${s.read ? 'r' : ''}${s.key === active ? 'a' : ''}`).join(',') + `|${win.rows.length}`;
        if (key !== renderedKey) {
            renderedKey = key;
            track.replaceChildren(...rows.map((s) => stubRow(s, s.key === active)));
            viewport.style.height = `${win.rows.length * TICKER_ROW_PX}px`;
            more.hidden = win.more === 0;
            more.textContent = `${win.more} more`;
        }
        track.style.transform = state.progress > 0 ? `translateY(${-state.progress * TICKER_ROW_PX}px)` : '';
    }

    let last = performance.now();
    let syncAt = 0;
    function frame(now: number): void {
        const dt = Math.min(1000, now - last);
        last = now;
        if (now >= syncAt) {
            sync();
            syncAt = now + 250;
        }
        advanceStubList(state, dt, { visible: getSettings().messageStubsVisible, hovered, paused: opts.clock?.paused ?? false });
        render();
        if (installed !== null) installed.frame = requestAnimationFrame(frame);
    }
    installed = {
        root,
        frame: requestAnimationFrame(frame),
        cleanup: () => {
            window.removeEventListener('resize', place);
            offSettings();
        },
    };
    sync();
    render();
}

/** Remove the list. `clear` (the default, game teardown) also drops the stubs; a re-install keeps them. */
export function removeMessageStubList(clear = true): void {
    if (installed !== null) {
        const s = installed;
        installed = null;
        cancelAnimationFrame(s.frame);
        s.cleanup();
        s.root.remove();
    }
    if (clear) {
        state = createStubListState();
        player = null;
    }
}
