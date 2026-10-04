// Build Queue window (an extension, not in the original): every ship and base being built across the player's
// empire, the construction job board and the fleet-design build orders, on the shared original-style window
// (ui/originalWindow.ts). The original's top-bar btnBuildOrder opens pnlBuildOrder (Main.Part2.cs:404 method_628,
// ui/screens/buildOrder.ts), a purchase form only; this queue view is reached from a "Build Queue" button in that
// window's header (attachBuildQueueLauncher, called wherever the Build Order screen is toggled) and gathers what the
// original only shows per site in Construction Yards (ConstructionYardListView + the wait queue, Main.Part3.cs:681-700;
// the Move to Top / Up / Down / Bottom buttons are Main.Part5.cs:2147-2213). Rows: ui/screens/buildQueueModel.ts.
// Every change is a player command (moveWaitQueueItem, constructionJobMoveUp / Cancel, fleetTemplateCancelOrder).

import './buildQueue.css';
import type { Empire } from '../../sim/empire';
import type { Galaxy } from '../../sim/galaxy';
import type { BuiltObject } from '../../sim/builtObject';
import type { Habitat } from '../../sim/types';
import { issuePlayerCommand } from '../../sim/player/playerCommands';
import type { PlayerOpArgs, PlayerOpName, PlayerOpResult } from '../../sim/player/playerOps';
import { constructionJobRows, type ConstructionJobRow } from '../../sim/player/constructionBoard';
import type { WaitQueueMove } from '../../sim/player/playerOrders';
import { formatThousands } from '../../sim/diplomacyTick';
import { COLORS, FONT, OwGrid, barGraph, dropText, el, glassButton, openOriginalWindow, place, setText, type OriginalWindow } from '../originalWindow';
import {
    buildQueueRows,
    buildQueueStatusText,
    buildQueueSummary,
    fleetOrderRows,
    formatEtaMs,
    formatPercentP,
    jobStateText,
    waitMoveState,
    type BuildQueueRow,
    type FleetOrderRow,
} from './buildQueueModel';
import { requestSimRefresh } from '../../simworker/refresh';

export interface BuildQueueOptions {
    empire: Empire;
    /** Go to: select the object and move the view to it (hud.ts selectStellarObject). */
    onGoto?: (target: BuiltObject | Habitat) => void;
}

/** The window size in the original's pixels (a screen of the Diplomacy class, 940 × 840). */
export const BUILD_QUEUE_SIZE = { w: 940, h: 840 } as const;

let open: OriginalWindow | null = null;

/** Open the Build Queue window, or close it when open. */
export function toggleBuildQueue(opts: BuildQueueOptions): void {
    if (open !== null && !open.closed) {
        open.close();
        return;
    }
    open = createBuildQueue(opts);
}

export function closeBuildQueue(): void {
    open?.close();
}

export function isBuildQueueOpen(): boolean {
    return open !== null && !open.closed;
}

const LAUNCHER_CLASS = 'bq-launcher';

/**
 * Put a "Build Queue" glass button in the open Build Order window's header (left of the close button), so the queue is
 * reached from the same top-bar button / F9 as the original's screen. Finds the window by its title, so it works with
 * either Build Order implementation; a no-op when the window is closed or already has the button.
 */
export function attachBuildQueueLauncher(opts: BuildQueueOptions): void {
    const header = findBuildOrderHeader();
    if (header === null || header.querySelector(`.${LAUNCHER_CLASS}`) !== null) return;
    const b = glassButton('Build Queue', {
        className: LAUNCHER_CLASS,
        size: FONT.normal,
        title: 'Show every ship and base being built across your empire, the construction jobs and the fleet build orders',
        onClick: () => toggleBuildQueue(opts),
    });
    // The header drags the window on pointerdown (and captures the pointer, which would swallow the click).
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    const close = header.classList.contains('build-order-titlebar') ? header.lastElementChild : null;
    header.insertBefore(b, close);
}

function findBuildOrderHeader(): HTMLElement | null {
    for (const frame of document.querySelectorAll<HTMLElement>('.ow-screen')) {
        const title = frame.querySelector('.ow-title');
        if (title?.textContent === 'Build Order') return frame.querySelector<HTMLElement>('.ow-header');
    }
    return document.querySelector<HTMLElement>('.build-order-titlebar');
}

function createBuildQueue(opts: BuildQueueOptions): OriginalWindow {
    const empire = opts.empire;
    const galaxy: Galaxy = empire.galaxy;
    const win = openOriginalWindow({
        id: 'buildQueue',
        title: 'Build Queue',
        icon: 'build.png',
        width: BUILD_QUEUE_SIZE.w,
        height: BUILD_QUEUE_SIZE.h,
        onClose: () => {
            window.clearInterval(timer);
            if (open === win) open = null;
        },
    });
    const body = win.body;
    const W = win.bodySize.w;
    const gridW = W - 20;

    dropText(
        body,
        'Every ship and base being built across your empire: the ships on the slipways of your space ports, colonies and construction ships, the ships waiting for a free yard (in the order they will start), and the bases your construction ships are on their way to build. Below are your construction jobs and fleet build orders.',
        10,
        8,
        { size: FONT.normal, color: COLORS.label, wrapWidth: W - 20, className: 'bq-explanation' },
    );

    let status = '';
    const statusEl = dropText(body, '', 10, 0, { size: FONT.normal, color: COLORS.link, className: 'bq-status' });
    const setStatus = (s: string): void => {
        status = s;
        setText(statusEl, s);
    };

    function issue<K extends PlayerOpName>(op: K, args: PlayerOpArgs<K>, done?: (r: PlayerOpResult<K>) => void): void {
        issuePlayerCommand(galaxy, empire, op, args, (r) => {
            done?.(r);
            refresh();
        });
    }

    // ---------------------------------------------------------------------------------------------------------------
    // A: ships and bases under construction / waiting
    // ---------------------------------------------------------------------------------------------------------------
    const titleA = dropText(body, '', 10, 54, { size: FONT.large, bold: true, color: COLORS.text });
    const valueA = dropText(body, '', W - 10, 56, { size: FONT.normal, color: COLORS.text, className: 'ow-right' });
    let rowsA: BuildQueueRow[] = [];
    const gridA = new OwGrid<BuildQueueRow>({
        key: (r) => r.key,
        rowHeight: 22,
        empty: 'Nothing is being built. Use Build Order to purchase new ships.',
        columns: [
            { id: 'name', header: 'Name', fill: 1, sort: (r) => r.name, render: (r, c) => cellText(c, r.name, `${r.type}: ${r.name}`) },
            { id: 'design', header: 'Design', width: 150, sort: (r) => r.design, render: (r, c) => cellText(c, r.design) },
            { id: 'location', header: 'Location', width: 150, sort: (r) => r.location, render: (r, c) => cellText(c, r.location) },
            {
                id: 'status',
                header: 'Status',
                width: 150,
                sort: (r) => `${r.status === 'waiting' ? 'z' : r.status}${String(r.position).padStart(4, '0')}`,
                render: (r, c) => {
                    cellText(c, buildQueueStatusText(r));
                    if (r.status === 'building' || r.status === 'retrofit') c.style.color = COLORS.green;
                },
            },
            {
                id: 'progress',
                header: 'Progress',
                width: 110,
                align: 'right',
                sort: (r) => r.progress,
                render: (r, c) => {
                    if (r.status === 'building' || r.status === 'retrofit') {
                        c.appendChild(barGraph(r.progress * 100, 100, 110, 22, COLORS.green));
                        c.appendChild(el('span', 'bq-cell-text', formatPercentP(r.progress)));
                    }
                },
            },
            { id: 'cost', header: 'Cost', width: 80, align: 'right', sort: (r) => r.cost, render: (r, c) => cellText(c, formatThousands(r.cost)) },
            { id: 'order', header: 'Order', width: 130, sort: (r) => r.order, render: (r, c) => cellText(c, r.order) },
        ],
        onSelect: () => updateButtons(),
        onDoubleClick: (r) => goto(r),
    });
    place(gridA.el, 10, 80, gridW, 286);
    body.appendChild(gridA.el);

    const goto = (r: BuildQueueRow | null): void => {
        if (r === null || opts.onGoto === undefined) return;
        opts.onGoto(r.ship ?? r.site);
    };
    const btnGoto = glassButton('Go to', { title: 'Select the ship (or its build site) and move the view to it', onClick: () => goto(gridA.selected) });
    place(btnGoto, 10, 372, 120, 30);
    const moveButtons: [WaitQueueMove, HTMLButtonElement][] = (
        [
            ['top', 'Move to Top'],
            ['up', 'Move Up'],
            ['down', 'Move Down'],
            ['bottom', 'Move to Bottom'],
        ] as const
    ).map(([move, label], i) => {
        const b = glassButton(label, {
            title: 'Reorder the selected waiting ship in its yard\'s wait queue',
            onClick: () => {
                const r = gridA.selected;
                if (r === null || r.ship === null || r.status !== 'waiting') return;
                issue('moveWaitQueueItem', [r.site, r.ship, move]);
            },
        });
        place(b, 150 + i * 135, 372, 130, 30);
        return [move, b];
    });
    body.append(btnGoto, ...moveButtons.map(([, b]) => b));

    // ---------------------------------------------------------------------------------------------------------------
    // B: construction job board (sim/player/constructionBoard.ts)
    // ---------------------------------------------------------------------------------------------------------------
    const titleB = dropText(body, '', 10, 414, { size: FONT.large, bold: true, color: COLORS.text });
    const gridB = new OwGrid<ConstructionJobRow>({
        key: (j) => j.id,
        rowHeight: 22,
        empty: 'No construction jobs. Base build orders are queued here and taken by the construction ship that can finish them first.',
        columns: [
            { id: 'n', header: '#', width: 40, align: 'right', render: (j, c) => cellText(c, String(jobsB.indexOf(j) + 1)) },
            { id: 'job', header: 'Job', fill: 1, render: (j, c) => cellText(c, j.label) },
            { id: 'state', header: 'State', width: 100, render: (j, c) => cellText(c, jobStateText(j)) },
            { id: 'ship', header: 'Construction Ship', width: 220, render: (j, c) => cellText(c, j.state === 'open' ? '' : j.shipName) },
            { id: 'eta', header: 'Estimate', width: 100, align: 'right', render: (j, c) => cellText(c, j.etaMs === null ? '-' : formatEtaMs(j.etaMs), 'Estimated time until the job is done (travel + build, after the ship\'s current work)') },
        ],
        onSelect: () => updateButtons(),
        onDoubleClick: (j) => {
            if (j.ship !== null) opts.onGoto?.(j.ship);
        },
    });
    let jobsB: ConstructionJobRow[] = [];
    place(gridB.el, 10, 440, gridW, 130);
    body.appendChild(gridB.el);
    const btnJobUp = glassButton('Move Up', {
        title: 'Earlier jobs are handed out first',
        onClick: () => {
            const j = gridB.selected;
            if (j !== null) issue('constructionJobMoveUp', [j.id]);
        },
    });
    const btnJobCancel = glassButton('Cancel Job', {
        title: 'Remove the selected job from the board',
        onClick: () => {
            const j = gridB.selected;
            if (j !== null) issue('constructionJobCancel', [j.id], (ok) => setStatus(ok ? `Construction job cancelled: ${j.label}` : ''));
        },
    });
    place(btnJobUp, 10, 576, 120, 30);
    place(btnJobCancel, 150, 576, 130, 30);
    body.append(btnJobUp, btnJobCancel);

    // ---------------------------------------------------------------------------------------------------------------
    // C: fleet-design build orders (sim/player/fleetTemplates.ts)
    // ---------------------------------------------------------------------------------------------------------------
    const titleC = dropText(body, '', 10, 618, { size: FONT.large, bold: true, color: COLORS.text });
    const gridC = new OwGrid<FleetOrderRow>({
        key: (o) => o.order.id,
        rowHeight: 22,
        empty: 'No fleet is being built. Build a fleet design from the Fleets screen.',
        columns: [
            { id: 'name', header: 'Fleet Design', fill: 1, render: (o, c) => cellText(c, o.name) },
            {
                id: 'progress',
                header: 'Built',
                width: 130,
                align: 'right',
                render: (o, c) => {
                    c.appendChild(barGraph(o.built, Math.max(1, o.total), 130, 22, COLORS.green));
                    c.appendChild(el('span', 'bq-cell-text', `${o.built} / ${o.total}`));
                },
            },
            { id: 'building', header: 'Building', width: 90, align: 'right', render: (o, c) => cellText(c, String(o.building)) },
            { id: 'lost', header: 'Lost', width: 60, align: 'right', render: (o, c) => cellText(c, String(o.lost)) },
            { id: 'where', header: 'Build In', width: 150, render: (o, c) => cellText(c, o.where) },
            { id: 'fleet', header: 'Fleet', width: 170, render: (o, c) => cellText(c, o.fleet) },
        ],
        onSelect: () => updateButtons(),
    });
    place(gridC.el, 10, 644, gridW, 88);
    body.appendChild(gridC.el);
    const btnOrderCancel = glassButton('Cancel Order', {
        title: 'Stop the order: ships still waiting for a yard are removed and refunded; ships on a slipway finish unassigned (a fleet\'s replacements: also turns off its auto-refill)',
        onClick: () => {
            const o = gridC.selected;
            if (o !== null) {
                issue('fleetTemplateCancelOrder', [o.order.id], (r) =>
                    setStatus(r.ok ? `Order cancelled: ${r.removed} queued ${r.removed === 1 ? 'ship' : 'ships'} removed, ${formatThousands(r.refund)} credits refunded` : ''),
                );
            }
        },
    });
    place(btnOrderCancel, 10, 738, 130, 30);
    body.appendChild(btnOrderCancel);
    place(statusEl, 160, 744);

    function updateButtons(): void {
        const a = gridA.selected;
        btnGoto.disabled = a === null || opts.onGoto === undefined;
        const m = waitMoveState(a);
        for (const [move, b] of moveButtons) b.disabled = !m[move];
        const j = gridB.selected;
        btnJobUp.disabled = j === null || jobsB.indexOf(j) <= 0;
        btnJobCancel.disabled = j === null;
        btnOrderCancel.disabled = gridC.selected === null;
    }

    let lastKey = '';
    function refresh(): void {
        if (win.closed) return;
        rowsA = buildQueueRows(galaxy, empire);
        jobsB = constructionJobRows(galaxy, empire);
        const orders = fleetOrderRows(empire);
        // Rebuild the grids only when something shown changed (keeps hover / scroll steady on the timer).
        const key = [
            rowsA.map((r) => `${r.name}|${r.status}|${r.position}|${r.queueLength}|${Math.round(r.progress * 10000)}|${r.location}|${r.order}`).join(';'),
            jobsB.map((j) => `${j.id}|${j.state}|${j.shipName}|${j.etaMs === null ? '' : Math.round(j.etaMs / 1000)}`).join(';'),
            orders.map((o) => `${o.order.id}|${o.built}|${o.total}|${o.building}|${o.lost}|${o.fleet}`).join(';'),
        ].join('#');
        const s = buildQueueSummary(rowsA);
        setText(titleA, `Ships and Bases Under Construction (${s.building} building, ${s.waiting} waiting${s.enroute > 0 ? `, ${s.enroute} builders en route` : ''})`);
        setText(valueA, `Total value: ${formatThousands(s.value)} credits`);
        setText(titleB, `Construction Jobs (${jobsB.length})`);
        setText(titleC, `Fleet Build Orders (${orders.length})`);
        if (key !== lastKey) {
            lastKey = key;
            gridA.setRows(rowsA);
            gridB.setRows(jobsB);
            gridC.setRows(orders);
        }
        updateButtons();
        void status;
    }

    refresh();
    // Worker mode: bring what the screen shows up to date now instead of up to a cold cycle later (no-op in-thread).
    requestSimRefresh(galaxy, [empire, empire.constructionYards ?? []], () => refresh());
    const timer = window.setInterval(refresh, 1000);
    return win;
}

function cellText(cell: HTMLElement, text: string, title?: string): void {
    cell.textContent = text;
    cell.title = title ?? text;
}
