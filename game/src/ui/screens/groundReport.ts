// [parC1] Ground Report: the original's ground invasion status panel (pnlColonyInvasion, a ScreenPanel holding the
// ColonyInvasionPanel control) in the original-style window (originalWindow.ts). Opened by the "[" key
// (Main.Part7.cs:3321 OpenGroundInvasionStatusScreen: the selected colony, else the capital; the key closes it when
// open) and by the selection panel's Troops / battle rows (InfoPanel.cs 4461 / 4497 → Main.Part4.cs:3534
// pnlDetailInfo_MouseClick → method_164). Main.Part11.cs:2682 method_164 sizes it to the view + (25, 70) and places it
// right of the selection panel, 10 px above the bottom; method_165 closes it. It does not pause the game.
//
// The content is groundReportModel.ts (the ColonyInvasion.Draw port), redrawn twice a second; the hover message and the
// dotted frame follow the mouse (CheckHovered), the size glyph cycles the three sizes. Read only: the panel never
// attaches Habitat.colonyInvasion (see groundReportModel.ts for why). Sim worker: the panel reads the replica and asks
// for a refresh of the colony every second (simworker/refresh.ts).

import './groundReport.css';
import type { Empire } from '../../sim/empire';
import type { Galaxy } from '../../sim/galaxy';
import { BuiltObject } from '../../sim/builtObject';
import { Habitat, HabitatType } from '../../sim/types';
import { Troop } from '../../sim/cargo';
import { Character } from '../../sim/characters';
import { PlanetaryFacility } from '../../sim/construction/facilities';
import { requestSimRefresh } from '../../simworker/refresh';
import { troopImageUrl, wireTroopImageFallback } from '../../render/troopImages';
import { raceHasConcordArt } from '../../render/concordArt';
import { characterPortraitUrl } from '../characterPortrait';
import { racePortraitUrl } from '../empireEmblem';
import { facilityImageUrl, habitatImageUrl, shipImageUrl } from '../selectionInfo';
import { getSelection } from '../hud';
import { getEmpireSummarySource } from './empireSummary';
import { selectedGameObject } from '../controlGroups';
import { el, originalVirtualSize, openOriginalWindow, place, type OriginalWindow } from '../originalWindow';
import { uiScaleFactor } from '../settings';
import { tryGetText } from '../../sim/textResolver';
import type { Race } from '../../sim/data/races';
import {
    buildGroundReport,
    groundReportKeyColony,
    groundReportWindowSize,
    hotspotAt,
    nextGroundReportSize,
    type GroundReportItem,
    type GroundReportModel,
    type GrRect,
} from './groundReportModel';

const CHROME = '/assets/dwu/images/ui/chrome';
const PLANET_MAPS = '/assets/dwu/images/environment/planetmaps';

interface OpenState {
    win: OriginalWindow;
    colony: Habitat;
    close: () => void;
}

let open: OpenState | null = null;
/** ColonyInvasion.PanelSize: kept between openings (the one control on the Main form). */
let panelSize = 0;

export function isGroundReportOpen(): boolean {
    return open !== null;
}

/** method_165: close the panel (no-op when closed). */
export function closeGroundReport(): void {
    open?.close();
}

/** The "[" key: close when open, else open on the selected colony / the capital (Main.Part7.cs:3321-3350). */
export function toggleGroundReportFromKey(): void {
    if (open !== null) {
        closeGroundReport();
        return;
    }
    const src = getEmpireSummarySource();
    if (!src) return;
    const capital = (src.empire.capital as Habitat | null) ?? null;
    const colony = groundReportKeyColony(selectedGameObject(getSelection()), (o): o is Habitat => o instanceof Habitat, capital);
    if (colony !== null) openGroundReport(colony);
}

/** method_164(habitat): open (or rebind) the panel on `colony`. No-op without a DOM. */
export function openGroundReport(colony: Habitat): void {
    if (typeof document === 'undefined') return;
    if (open !== null) {
        if (open.colony === colony) return;
        open.close();
    }
    const galaxy = (getEmpireSummarySource()?.empire.galaxy ?? null) as Galaxy | null;
    const player = galaxy?.playerEmpire ?? null;
    if (galaxy === null) return;
    open = createGroundReport(galaxy, player, colony);
}

/** The window's top-left corner: right of the selection panel, 10 px (scaled) above the bottom (method_164). */
function anchor(vp: { w: number; h: number }, size: { w: number; h: number }, scale: number): { left: number; top: number } {
    const sel = document.querySelector<HTMLElement>('[data-hud="pnlSelection"]');
    const r = sel?.getBoundingClientRect();
    const right = r !== undefined && r.width > 0 ? r.right : 10 + 399 * scale;
    const left = Math.min(right + 20 * scale, Math.max(0, vp.w - size.w * scale - 8));
    const top = Math.max(0, vp.h - (size.h + 10) * scale);
    return { left, top };
}

function createGroundReport(galaxy: Galaxy, player: Empire | null, colony: Habitat): OpenState {
    const title = (): string => `${tryGetText('Ground Report') ?? 'Ground Report'}: ${colony.name}`;
    const winSize = groundReportWindowSize(panelSize);
    const win = openOriginalWindow({
        id: 'groundReport',
        title: title(),
        iconUrl: habitatImageUrl(colony) ?? undefined,
        width: winSize.w,
        height: winSize.h,
        noAutoPause: true, // method_164 does not pause (no method_154)
        anchor,
        onClose: () => {
            clearInterval(timer);
            clearInterval(refreshTimer);
            if (open !== null && open.win === win) open = null;
        },
    });
    const view = el('div', 'gr-view');
    win.body.appendChild(view);
    const content = el('div', 'gr-content');
    const hoverText = el('div', 'gr-hover-text');
    const hoverBox = el('div', 'gr-hover-box');
    view.append(content, hoverBox, hoverText);

    let model: GroundReportModel | null = null;
    let mouse: { x: number; y: number } | null = null;
    const raceCount = galaxy.races.length;

    const imageOf = (item: GroundReportItem): { src: string | null; troop?: Troop } => {
        const o = item.obj;
        if (item.kind === 'population') {
            const race = (o as Habitat).population?.dominantRace as Race | null | undefined;
            return { src: race != null ? racePortraitUrl(race.pictureIndex) : null };
        }
        if (o instanceof BuiltObject) return { src: shipImageUrl(o) };
        if (o instanceof PlanetaryFacility) return { src: facilityImageUrl(o.def.pictureRef) };
        if (o instanceof Character) return { src: characterPortraitUrl(o) };
        if (o instanceof Troop) {
            const concordArt = raceHasConcordArt(galaxy, (o.race as Race | null)?.name);
            return { src: troopImageUrl(o, raceCount, { concordArt }), troop: o };
        }
        return { src: null };
    };

    const rgb = (c: number, a = 1): string => `rgba(${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255}, ${a})`;
    const box = (cls: string, r: GrRect): HTMLDivElement => place(el('div', cls), r.x, r.y, r.w, r.h);

    const render = (): void => {
        const size = groundReportWindowSize(panelSize);
        win.setSize(size.w, size.h);
        win.setTitle(title());
        const m = buildGroundReport({ galaxy, colony, panelSize, habitatTypeName: HabitatType[colony.type] ?? '' });
        model = m;
        place(view, 5, 5, m.size.w, m.size.h);
        content.replaceChildren();
        const W = m.size.w;
        const H = m.size.h;
        if (m.headerFill) content.appendChild(place(el('div', 'gr-header'), 0, 0, W, 150));
        // The landscape (left) and Space.png (the orbit strip, right) below the header; the atmosphere gradient.
        const land = el('img', 'gr-landscape');
        land.src = `${PLANET_MAPS}/${m.landscape}`;
        land.alt = '';
        land.draggable = false;
        content.appendChild(place(land, 0, 150, m.landscapeWidth, H - 150));
        const space = el('img', 'gr-space');
        space.src = `${CHROME}/Space.png`;
        space.alt = '';
        space.draggable = false;
        content.appendChild(place(space, m.landscapeWidth, 150, W - m.landscapeWidth, H - 150));
        const atmo = place(el('div', 'gr-atmosphere'), m.landscapeWidth - 1, 150, 40, H - 150);
        atmo.style.background = `linear-gradient(to right, ${rgb(m.atmosphereColor)}, transparent)`;
        content.appendChild(atmo);
        // The frontline and the status bar.
        if (m.frontlineX !== null) content.appendChild(place(el('div', 'gr-frontline'), m.frontlineX - 1, 150, 2, H - 150));
        if (m.statusBar !== null) {
            const sb = m.statusBar;
            if (sb.defenderColor !== null) {
                const d = place(el('div', 'gr-status'), sb.x, sb.y, sb.w, sb.h);
                d.style.background = rgb(sb.defenderColor);
                content.appendChild(d);
            }
            if (sb.invaderColor !== null) {
                const a = place(el('div', 'gr-status'), sb.split, sb.y, sb.w - (sb.split - sb.x), sb.h);
                a.style.background = rgb(sb.invaderColor);
                content.appendChild(a);
            }
        }
        if (m.shield !== null) content.appendChild(box('gr-shield', m.shield));
        // The pictures, in Draw's order (later ones on top).
        for (const item of m.items) {
            if (item.fill !== null) {
                const f = box('gr-fill', item.rect);
                f.style.background = rgb(item.fill, 32 / 255);
                content.appendChild(f);
            }
            const { src, troop } = imageOf(item);
            if (src !== null) {
                const img = el('img', item.mirrored ? 'gr-img gr-mirrored' : 'gr-img');
                img.src = src;
                img.alt = '';
                img.draggable = false;
                if (troop !== undefined) wireTroopImageFallback(img, troop, raceCount, { concordArt: raceHasConcordArt(galaxy, (troop.race as Race | null)?.name) });
                content.appendChild(place(img, item.rect.x, item.rect.y, item.rect.w, item.rect.h));
            }
            if (item.readiness !== null) {
                const w = Math.trunc((item.readiness / 100) * m.columns.troop);
                if (item.readiness < 100) content.appendChild(place(el('div', 'gr-bar gr-bar-red'), item.rect.x, item.rect.y, item.rect.w, 2));
                content.appendChild(place(el('div', 'gr-bar gr-bar-green'), item.rect.x, item.rect.y, Math.max(0, w), 2));
            }
        }
        // The header / status texts (drop shadow).
        for (const t of m.texts) {
            const d = el('div', `gr-text${t.bold ? ' gr-bold' : ''}${t.centered ? ' gr-centered' : ''}`, t.text);
            d.style.fontSize = `${t.size}px`;
            d.style.left = `${t.x}px`;
            d.style.top = `${t.y}px`;
            if (t.maxWidth !== null) {
                d.style.width = `${t.maxWidth}px`;
                d.style.whiteSpace = 'normal';
            }
            content.appendChild(d);
        }
        // The size glyph.
        const glyph = box(`gr-resize${m.resize.expanded ? ' gr-shrink' : ''}`, m.resize.rect);
        glyph.innerHTML = m.resize.expanded
            ? '<svg viewBox="0 0 18 18" width="18" height="18"><path d="M2 2 L2 16 L16 16 M16 2 L2 16"/></svg>'
            : '<svg viewBox="0 0 18 18" width="18" height="18"><path d="M2 2 L16 2 L16 16 M16 2 L2 16"/></svg>';
        content.appendChild(glyph);
        updateHover();
    };

    /** CheckHovered + Draw 1497-1506: the hovered hotspot's message (yellow, centred at y 130) and its dotted frame. */
    const updateHover = (): void => {
        const h = model !== null && mouse !== null ? hotspotAt(model.hotspots, mouse.x, mouse.y) : null;
        view.classList.toggle('gr-hover-resize', h?.target === 'resize');
        if (h === null || model === null) {
            hoverText.hidden = true;
            hoverBox.hidden = true;
            return;
        }
        hoverText.hidden = false;
        hoverBox.hidden = false;
        hoverText.textContent = h.message;
        hoverText.style.left = `${model.size.w / 2}px`;
        hoverText.style.top = `${150 - 20}px`;
        place(hoverBox, h.rect.x, h.rect.y, h.rect.w, h.rect.h);
    };

    const toLocal = (e: MouseEvent): { x: number; y: number } => {
        const r = view.getBoundingClientRect();
        const k = model !== null && r.width > 0 ? r.width / model.size.w : 1;
        return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
    };
    view.addEventListener('mousemove', (e) => {
        mouse = toLocal(e);
        updateHover();
    });
    view.addEventListener('mouseleave', () => {
        mouse = null;
        updateHover();
    });
    // ColonyInvasionPanel.OnClick: the size glyph resizes (the close hotspot is the ScreenPanel's own button here).
    view.addEventListener('click', (e) => {
        if (model === null) return;
        const p = toLocal(e);
        const h = hotspotAt(model.hotspots, p.x, p.y);
        if (h?.target !== 'resize') return;
        panelSize = nextGroundReportSize(panelSize, originalVirtualSize(window.innerWidth, window.innerHeight, uiScaleFactor()));
        render();
    });

    render();
    // ColonyInvasionPanel repaints continuously; twice a second is enough for strengths, readiness and casualties.
    const timer = setInterval(() => {
        if (!win.closed) render();
    }, 500);
    // Sim worker: keep the colony's troops / characters current (no-op in-thread).
    const ask = (): void => requestSimRefresh(galaxy, [colony, colony.troops ?? [], colony.invadingTroops ?? [], ...(colony.basesAtHabitat ?? [])], () => {
        if (!win.closed) render();
    });
    ask();
    const refreshTimer = setInterval(ask, 1000);
    void player;
    const state: OpenState = { win, colony, close: () => win.close() };
    return state;
}
