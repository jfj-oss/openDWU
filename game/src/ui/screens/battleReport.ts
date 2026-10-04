// Battle Report window (an Improvement inspired by Distant Worlds 2; NOT in DW:U, so there is no original panel to
// port): one finished report (sim/battleReports/battleReports.ts) in the original-window style (originalWindow.ts:
// ScreenPanel chrome, GradientPanel body, ListViewBase grids, GlassButtons, drop-shadow texts). Opened from the
// "Battle report: <system>" ticker line / message stub and from Galactic History → Battle Reports. Read only: the
// report is plain data on the galaxy's side table (the replica's own copy in worker mode).

import './battleReport.css';
import type { BattleReport, BattleSide, BattleUnit } from '../../sim/battleReports/battleReports';
import { COLORS, FONT, OwGrid, el, glassButton, openOriginalWindow, place, rgbCss, text, type OriginalWindow } from '../originalWindow';
import {
    RESULT_COLORS,
    RESULT_LABELS,
    FATE_COLORS,
    battleLocationText,
    battleReportTitle,
    battleWhenText,
    beforeAfterText,
    campText,
    orderedSides,
    orderedUnits,
    sideForcesText,
    sideLossesText,
    unitFateText,
    unitTypeText,
} from './battleReportModel';

/** ScreenPanel size (original pixels). */
export const BATTLE_REPORT_W = 860;
export const BATTLE_REPORT_H = 720;

let open: { win: OriginalWindow; id: number } | null = null;
let goTo: ((x: number, y: number) => void) | null = null;

/** The game view's Go To (camera jump); null on teardown. */
export function setBattleReportGoTo(fn: ((x: number, y: number) => void) | null): void {
    goTo = fn;
}

export function isBattleReportOpen(): boolean {
    return open !== null;
}

export function closeBattleReport(): void {
    open?.win.close();
}

/** Open the window on `report` (rebinds when another report is open). No-op without a DOM. */
export function openBattleReport(report: BattleReport): void {
    if (typeof document === 'undefined') return;
    if (open !== null) {
        if (open.id === report.id) return;
        open.win.close();
    }
    const win = openOriginalWindow({
        id: 'battleReport',
        title: battleReportTitle(report),
        icon: 'attack.png',
        width: BATTLE_REPORT_W,
        height: BATTLE_REPORT_H,
        noAutoPause: true,
        onClose: () => {
            if (open !== null && open.win === win) open = null;
        },
    });
    open = { win, id: report.id };
    buildBody(win, report);
}

function swatch(color: number): HTMLSpanElement {
    const s = el('span', 'br-swatch');
    s.style.background = rgbCss(color);
    return s;
}

function buildBody(win: OriginalWindow, r: BattleReport): void {
    const body = win.body;
    body.classList.add('br-body');
    const W = win.bodySize.w;
    const H = win.bodySize.h;
    const sides = orderedSides(r);
    const sideByKey = new Map(sides.map((s) => [s.key, s] as const));

    // Header block: where, when, the result.
    const head = place(el('div', 'ow-dark br-head'), 10, 8, W - 20, 78);
    head.style.background = 'rgba(0, 0, 0, 0.376)';
    body.appendChild(head);
    head.appendChild(place(text(battleLocationText(r), { size: FONT.title, bold: true, color: COLORS.text }), 12, 8));
    head.appendChild(place(text(battleWhenText(r), { size: FONT.normal, color: COLORS.label }), 12, 44));
    const result = text(RESULT_LABELS[r.result], { size: FONT.title, bold: true, color: RESULT_COLORS[r.result] });
    result.classList.add('ow-right');
    head.appendChild(place(result, W - 20 - 14, 8));
    const tag = text(r.minor ? 'Skirmish' : 'Improvement — Battle Reports', { size: FONT.tiny, color: COLORS.label });
    tag.classList.add('ow-right');
    head.appendChild(place(tag, W - 20 - 14, 48));

    // Sides: forces at the start, losses, firepower and strength before → after.
    body.appendChild(place(text('Sides', { size: FONT.header, bold: true, color: COLORS.text }), 12, 94));
    const sideGrid = new OwGrid<BattleSide>({
        key: (s) => s.key,
        rowHeight: 22,
        columns: [
            {
                id: 'name',
                header: 'Side',
                fill: 2.2,
                render: (s, c) => {
                    c.append(swatch(s.color), document.createTextNode(` ${s.name}`));
                    c.title = s.name;
                },
            },
            { id: 'camp', header: 'Camp', width: 100, render: (s, c) => (c.textContent = campText(s)) },
            { id: 'forces', header: 'Forces at start', fill: 1.8, render: (s, c) => (c.textContent = sideForcesText(r, s)) },
            {
                id: 'losses',
                header: 'Losses',
                fill: 2,
                render: (s, c) => {
                    c.textContent = sideLossesText(s);
                    if (s.destroyed + s.captured > 0) c.style.color = FATE_COLORS.destroyed;
                },
            },
            { id: 'fp', header: 'Firepower', width: 128, align: 'right', render: (s, c) => (c.textContent = beforeAfterText(s.firepowerStart, s.firepowerEnd)) },
            { id: 'str', header: 'Strength', width: 128, align: 'right', render: (s, c) => (c.textContent = beforeAfterText(s.strengthStart, s.strengthEnd)) },
        ],
    });
    const sidesH = Math.min(6, Math.max(2, sides.length)) * 22 + 24;
    body.appendChild(place(sideGrid.el, 10, 120, W - 20, sidesH));
    sideGrid.setRows(sides);

    // Units: every ship, base, creature and colony each side had, with its fate.
    const unitsTop = 120 + sidesH + 12;
    body.appendChild(place(text('Ships, bases and colonies', { size: FONT.header, bold: true, color: COLORS.text }), 12, unitsTop));
    const units = orderedUnits(r);
    const unitGrid = new OwGrid<BattleUnit>({
        key: (u) => `${u.kind}:${u.id}:${u.name}`,
        rowHeight: 20,
        empty: 'No units',
        columns: [
            {
                id: 'side',
                header: 'Side',
                fill: 1.4,
                sort: (u) => u.side,
                render: (u, c) => {
                    const s = sideByKey.get(u.side);
                    if (s !== undefined) c.append(swatch(s.color), document.createTextNode(` ${s.name}`));
                },
            },
            { id: 'name', header: 'Name', fill: 1.8, sort: (u) => u.name, render: (u, c) => (c.textContent = u.name + (u.engaged ? '' : ' ·')) },
            { id: 'type', header: 'Type', fill: 1.2, sort: (u) => unitTypeText(u), render: (u, c) => (c.textContent = unitTypeText(u)) },
            {
                id: 'fate',
                header: 'Result',
                fill: 1.4,
                sort: (u) => u.fate,
                render: (u, c) => {
                    c.textContent = unitFateText(u);
                    c.style.color = FATE_COLORS[u.fate];
                },
            },
            {
                id: 'str',
                header: 'Strength',
                width: 120,
                align: 'right',
                sort: (u) => u.startStrength,
                render: (u, c) => {
                    if (u.kind === 'colony') c.textContent = `${u.startTroops} → ${u.endTroops} troops`;
                    else c.textContent = `${u.estimated ? '~' : ''}${Math.round(u.startStrength)} → ${Math.round(u.endStrength)}`;
                },
            },
        ],
    });
    const unitsH = H - (unitsTop + 26) - 52;
    body.appendChild(place(unitGrid.el, 10, unitsTop + 26, W - 20, unitsH));
    unitGrid.setRows(units);

    // Footer: the legend and Go To.
    body.appendChild(place(text('· present, did not fight   ~ estimated from its design (first seen destroyed)', { size: FONT.tiny, color: COLORS.label }), 12, H - 38));
    const go = glassButton('Go To', {
        onClick: () => {
            if (goTo === null) return;
            goTo(r.x, r.y);
            win.close();
        },
    });
    go.disabled = goTo === null;
    body.appendChild(place(go, W - 10 - 160, H - 44, 160, 34));
}
