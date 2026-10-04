// DOM drawing of the selection info panel (InfoPanel.cs DrawPanel): turns a selectionInfo.ts InfoModel into the
// panel's rows — title + corner flag, the faded picture, the label-area band, labelled rows, bar graphs, icon strips,
// the system colonies summary and the ship grids. Hotspots (InfoPanel.AddHotspot) become clickable elements with
// the original's hover text; `onTarget` performs the click (select the object / open the empire).

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import { troopImageUrl, wireTroopImageFallback } from '../render/troopImages';
import { raceHasConcordArt } from '../render/concordArt';
import type { Race } from '../sim/data/races';
import { resolveEmpireEmblem, rgbaToDataUrl, stockEmpireFlagRgba } from './empireEmblem';
import {
    BAR_BACKGROUND,
    INFO,
    WHITE,
    chromeUrl,
    css,
    dropShadowColor,
    type ColonySummaryItem,
    type InfoModel,
    type InfoRow,
    type InfoSeg,
    type InfoTarget,
    type ShipCell,
} from './selectionInfo';

export interface InfoViewOptions {
    galaxy: Galaxy;
    onTarget: (t: InfoTarget) => void;
    /** Click on the automate icon (the player's automated ship / fleet). */
    onAutomate?: () => void;
    /** Hotspot messages as `data-hover` for a hover-message line (the main view's selection panel) instead of tool
     *  tips. */
    hoverMessage?: boolean;
}

// ---------------------------------------------------------------------------------------------------------------
// Empire flags (Empire.LargeFlagPicture: the flag shape in the secondary colour on the main colour)
// ---------------------------------------------------------------------------------------------------------------

const flagCache = new Map<string, Promise<string>>();

/** The empire's flag picture as a URL: a scenario emblem override when there is one, else the stock composed flag
 *  (empireEmblem.ts stockFlagRgba, GenerateEmpireFlag). Cached per shape/colours. */
export function empireFlagUrl(galaxy: Galaxy, empire: Empire): Promise<string> {
    const key = `${galaxy.randomSeed}|${empire.empireId}|${empire.flagShape}|${empire.mainColor}|${empire.secondaryColor}|${galaxy.scenario !== null ? 's' : ''}`;
    let p = flagCache.get(key);
    if (p === undefined) {
        p = (async () => {
            if (galaxy.scenario !== null) {
                const e = await resolveEmpireEmblem(galaxy, empire);
                if (e.flagUrl !== null && e.flagFilter === '') return e.flagUrl;
            }
            return rgbaToDataUrl(await stockEmpireFlagRgba(galaxy, empire));
        })();
        flagCache.set(key, p);
    }
    return p;
}

function flagElement(galaxy: Galaxy, empire: Empire, w: number, h: number): HTMLElement {
    const box = document.createElement('span');
    box.className = 'sel-flag';
    box.style.width = `${w}px`;
    box.style.height = `${h}px`;
    box.style.background = css(empire.mainColor);
    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    void empireFlagUrl(galaxy, empire).then((url) => {
        if (url !== '') img.src = url;
    });
    box.appendChild(img);
    return box;
}

// ---------------------------------------------------------------------------------------------------------------
// Segments / rows
// ---------------------------------------------------------------------------------------------------------------

function shadow(rgb: number): string {
    return `1px 1px 0 ${css(dropShadowColor(rgb))}`;
}

/** Readability (not in the original): a colour dark enough for the original's white drop shadow (dropShadowColor) is
 *  drawn half-way to white over a black shadow instead — the white 1 px shadow smears dark text (an empire's dark red
 *  name) into an unreadable white blur at this size. Other colours keep the original colour and shadow. */
function readableText(rgb: number): { color: string; shadow: string } {
    if (dropShadowColor(rgb) !== 0xffffff) return { color: css(rgb), shadow: shadow(rgb) };
    const lift = (v: number): number => Math.round(v + (255 - v) * 0.5);
    const lifted = (lift((rgb >> 16) & 0xff) << 16) | (lift((rgb >> 8) & 0xff) << 8) | lift(rgb & 0xff);
    return { color: css(lifted), shadow: '1px 1px 0 #000' };
}

/** The hotspot's hover message (Hotspot.HoverMessage): the main view draws it in yellow above the selection panel while
 *  the cursor is over the hotspot (Main.Part10.cs 1141-1159 → string_17, MainView.cs 1599), not as a tool tip. hud.ts
 *  shows it (the .sel-hover-msg line); `data-hover` carries it. */
export function setHoverMessage(el: HTMLElement, text: string | undefined): void {
    if (text !== undefined && text !== '') el.dataset.hover = text;
}

/** The panel shows its hotspot messages in a hover-message line (`data-hover`), or — in a window with no such line
 *  (the Colonies screen's pnlColonyHabitatInfo, the Galaxy Map's pnlHabitatInfo, ...) — as tool tips. */
let hoverAsTitle = true;
function setHover(el: HTMLElement, text: string | undefined): void {
    if (hoverAsTitle) {
        if (text !== undefined && text !== '') el.title = text;
    } else setHoverMessage(el, text);
}

function attachTarget(el: HTMLElement, target: InfoTarget | undefined, title: string | undefined, o: InfoViewOptions): void {
    setHover(el, title);
    if (target === undefined) return;
    el.classList.add('sel-hot');
    el.addEventListener('click', (e) => {
        e.stopPropagation();
        o.onTarget(target);
    });
}

function segElement(seg: InfoSeg, o: InfoViewOptions): HTMLElement {
    let el: HTMLElement;
    if (seg.flagOf !== undefined) {
        el = flagElement(o.galaxy, seg.flagOf, seg.w ?? INFO.flagSmall.w, seg.h ?? INFO.flagSmall.h);
    } else if (seg.troop !== undefined) {
        const img = document.createElement('img');
        img.className = 'sel-icon sel-troop';
        if (seg.troopState) img.classList.add(`sel-troop-${seg.troopState}`);
        const raceCount = o.galaxy.races.length;
        const concordArt = raceHasConcordArt(o.galaxy, (seg.troop.race as Race | null)?.name);
        img.src = troopImageUrl(seg.troop, raceCount, { concordArt });
        wireTroopImageFallback(img, seg.troop, raceCount, { concordArt });
        img.alt = '';
        img.draggable = false;
        el = img;
    } else if (seg.img !== undefined || (seg.text === undefined && seg.width !== undefined)) {
        if (seg.img === undefined) {
            el = document.createElement('span');
            el.className = 'sel-spacer';
        } else {
            const img = document.createElement('img');
            img.className = 'sel-icon';
            img.src = seg.img;
            img.alt = '';
            img.draggable = false;
            img.onerror = () => {
                img.style.visibility = 'hidden';
            };
            el = img;
        }
        const w = seg.w ?? seg.width ?? INFO.imageSize;
        const h = seg.h ?? INFO.imageSize;
        el.style.width = `${w}px`;
        el.style.height = `${h}px`;
        if (seg.faded) el.classList.add('sel-faded');
    } else {
        el = document.createElement('span');
        el.className = 'sel-text';
        el.textContent = seg.text ?? '';
        const t = readableText(seg.color ?? WHITE);
        el.style.color = t.color;
        el.style.textShadow = t.shadow;
        if (seg.tiny) el.classList.add('sel-tiny');
        if (seg.width !== undefined && seg.width > 0) {
            el.style.width = `${seg.width}px`;
            el.classList.add('sel-fixed');
        }
    }
    if (seg.bg !== undefined) el.style.background = seg.bg;
    if (seg.gap !== undefined && seg.gap !== 0) el.style.marginLeft = `${seg.gap}px`;
    attachTarget(el, seg.target, seg.title, o);
    return el;
}

function labelElement(text: string, width: number): HTMLElement {
    const l = document.createElement('span');
    l.className = 'sel-label';
    l.style.width = `${width}px`;
    l.textContent = text;
    return l;
}

function barElement(row: Extract<InfoRow, { kind: 'bar' }>, labelWidth: number): HTMLElement {
    const line = document.createElement('div');
    line.className = 'sel-row sel-bar-row';
    line.appendChild(labelElement(row.label, labelWidth));
    // InfoPanel.cs 2497 DrawBarGraph: the bar spans overallWidth - (descriptionWidth + 10 + width("99999") + 5).
    const barWidth = INFO.width - 10 - (labelWidth + 10 + 32);
    const bar = document.createElement('span');
    bar.className = 'sel-bar';
    bar.style.width = `${barWidth}px`;
    bar.style.background = BAR_BACKGROUND;
    const frac = row.max > 0 ? Math.max(0, Math.min(1, row.current / row.max)) : 0;
    if (frac > 0) {
        const fill = document.createElement('span');
        fill.className = 'sel-bar-fill';
        fill.style.width = `${Math.trunc(frac * barWidth)}px`;
        fill.style.background = `linear-gradient(to right, ${row.fill[0]}, ${row.fill[1]})`;
        bar.appendChild(fill);
        if (row.alt !== undefined) {
            // UpdateColor: the fill oscillates towards the alternate colours once a second.
            const alt = document.createElement('span');
            alt.className = 'sel-bar-fill sel-bar-alt';
            alt.style.width = fill.style.width;
            alt.style.background = `linear-gradient(to right, ${row.alt[0]}, ${row.alt[1]})`;
            bar.appendChild(alt);
        }
    }
    const inner = document.createElement('span');
    inner.className = 'sel-bar-text';
    inner.textContent = row.inner;
    bar.appendChild(inner);
    line.appendChild(bar);
    const right = document.createElement('span');
    right.className = 'sel-text sel-bar-max';
    right.textContent = row.right;
    right.style.textShadow = shadow(WHITE);
    line.appendChild(right);
    return line;
}

/** InfoPanel.cs 3690 DrawSingleColonySummary columns, laid out like DrawSystemColoniesSummary (3642). */
function coloniesElement(row: Extract<InfoRow, { kind: 'colonies' }>, labelWidth: number, o: InfoViewOptions): HTMLElement {
    const box = document.createElement('div');
    box.className = 'sel-colonies';
    const size = INFO.habitatImageSize;
    const n = row.items.length;
    const span = INFO.width - labelWidth - 10;
    const fit = Math.trunc(span / size);
    const pad = Math.max(1, Math.trunc((span - size * n) / (n + 1)));
    let x = labelWidth + pad - 5; // rows start at x = 5
    if (n > 0) {
        const line = document.createElement('div');
        line.className = 'sel-colonies-line';
        line.style.left = `${x - 5}px`;
        line.style.top = `${size + 3 + 13}px`;
        line.style.width = `${10 + (Math.min(n, fit) * (size + pad) - pad)}px`;
        box.appendChild(line);
    }
    for (const item of row.items) {
        box.appendChild(colonyColumn(item, x, o));
        x += size + pad;
    }
    if (row.more) {
        const more = document.createElement('span');
        more.className = 'sel-text';
        more.textContent = '...';
        more.style.position = 'absolute';
        more.style.left = `${x}px`;
        more.style.top = '5px';
        box.appendChild(more);
    }
    return box;
}

function colonyColumn(item: ColonySummaryItem, x: number, o: InfoViewOptions): HTMLElement {
    const col = document.createElement('div');
    col.className = 'sel-colony';
    col.style.left = `${x}px`;
    const size = INFO.habitatImageSize;
    const dw = INFO.colonySummaryDetailWidth;
    const habitat = document.createElement('img');
    habitat.className = 'sel-colony-img';
    if (item.img !== null) habitat.src = item.img;
    habitat.alt = '';
    habitat.draggable = false;
    attachTarget(habitat, { kind: 'select', obj: item.habitat }, `${item.habitat.name} (click to select)`, o);
    col.appendChild(habitat);
    const detail = document.createElement('div');
    detail.className = 'sel-colony-detail';
    detail.style.left = `${(size - dw) / 2}px`;
    detail.style.width = `${dw}px`;
    const abbr = document.createElement('div');
    abbr.className = 'sel-text sel-tiny sel-colony-abbr';
    abbr.textContent = item.abbr;
    detail.appendChild(abbr);
    const flagRow = document.createElement('div');
    flagRow.className = 'sel-colony-flag';
    if (item.flagOf !== null) {
        const f = flagElement(o.galaxy, item.flagOf, dw, Math.trunc(dw * 0.6));
        attachTarget(f, { kind: 'empire', empire: item.flagOf }, `${item.flagOf.name} (click for details)`, o);
        flagRow.appendChild(f);
    }
    detail.appendChild(flagRow);
    if (item.raceImg !== null) {
        const race = document.createElement('img');
        race.className = 'sel-colony-race';
        race.src = item.raceImg;
        race.alt = '';
        race.draggable = false;
        // InfoPanel.cs 3781: the dominant race, "Name (click for details)" → the Galactopedia (Main.Part4.cs 3603).
        if (item.race !== null) attachTarget(race, { kind: 'galactopedia', topic: item.race.name }, `${item.race.name} (click for details)`, o);
        detail.appendChild(race);
        // DrawPopulationIndicator: a 5×5 grid, population columns × development rows lit.
        const grid = document.createElement('div');
        grid.className = 'sel-popgrid';
        for (let row = 4; row >= 0; row--) {
            for (let colI = 0; colI < 5; colI++) {
                const c = document.createElement('span');
                if (colI < item.pop && row < item.dev) c.className = 'lit';
                grid.appendChild(c);
            }
        }
        setHover(grid, 'Population / development');
        detail.appendChild(grid);
    } else if (item.base !== null) {
        const base = document.createElement('img');
        base.className = 'sel-colony-base';
        if (item.baseImg !== null) base.src = item.baseImg;
        base.alt = '';
        base.draggable = false;
        attachTarget(base, { kind: 'select', obj: item.base }, `${item.base.name} (click to select)`, o);
        detail.appendChild(base);
        if (item.resourceImg !== null) {
            const r = document.createElement('img');
            r.className = 'sel-colony-res';
            r.src = item.resourceImg;
            r.alt = '';
            // InfoPanel.cs 3811: the base's first resource, a "Name (click for details)" hotspot → the Galactopedia.
            attachTarget(r, item.resourceTopic !== null ? { kind: 'galactopedia', topic: item.resourceTopic } : undefined, item.resourceTitle, o);
            detail.appendChild(r);
        } else if (item.resourceUnknown) {
            const q = document.createElement('div');
            q.className = 'sel-text sel-tiny';
            q.textContent = '?';
            detail.appendChild(q);
        }
    }
    col.appendChild(detail);
    return col;
}

function gridElement(row: Extract<InfoRow, { kind: 'grid' }>, labelWidth: number, o: InfoViewOptions, hasBand: boolean): HTMLElement {
    const grid = document.createElement('div');
    grid.className = 'sel-grid';
    grid.style.marginLeft = `${hasBand ? labelWidth + 10 + row.indent : row.indent + 5}px`;
    for (const c of row.cells) grid.appendChild(shipCellElement(c, o));
    return grid;
}

function shipCellElement(c: ShipCell, o: InfoViewOptions): HTMLElement {
    const cell = document.createElement('span');
    cell.className = 'sel-cell';
    if (c.bg !== null) cell.style.background = c.bg;
    if (c.img !== null) {
        const img = document.createElement('img');
        img.src = c.img;
        img.alt = '';
        img.draggable = false;
        img.style.width = `${c.side}px`;
        img.style.height = `${c.side}px`;
        cell.appendChild(img);
    }
    if (c.fuel !== null) {
        const fuel = document.createElement('span');
        fuel.className = 'sel-cell-fuel';
        fuel.style.height = `${Math.trunc(c.fuel * 23)}px`;
        cell.appendChild(fuel);
    }
    attachTarget(cell, c.clickable ? { kind: 'select', obj: c.ship } : undefined, c.title, o);
    return cell;
}

function rowElement(row: InfoRow, labelWidth: number, o: InfoViewOptions, banded: boolean): HTMLElement | null {
    switch (row.kind) {
        case 'gap': {
            const g = document.createElement('div');
            g.style.height = `${row.h}px`;
            return g;
        }
        case 'band':
            return null;
        case 'bar':
            return barElement(row, labelWidth);
        case 'colonies':
            return coloniesElement(row, labelWidth, o);
        case 'grid':
            return gridElement(row, labelWidth, o, banded);
        case 'line': {
            const line = document.createElement('div');
            line.className = 'sel-row sel-line';
            if (row.wrap) line.classList.add('sel-wrap');
            if (row.alert) line.classList.add('sel-alert');
            for (const s of row.segs) line.appendChild(segElement(s, o));
            attachTarget(line, row.target, row.title, o);
            return line;
        }
        case 'row': {
            const line = document.createElement('div');
            line.className = 'sel-row';
            if (row.alert) line.classList.add('sel-alert');
            line.appendChild(labelElement(row.label, labelWidth));
            const content = document.createElement('span');
            content.className = 'sel-content';
            if (row.strip) content.classList.add('sel-strip');
            if (row.wrap) content.classList.add('sel-wrap');
            for (const s of row.segs) content.appendChild(segElement(s, o));
            line.appendChild(content);
            attachTarget(row.target !== undefined ? content : line, row.target, row.title, o);
            return line;
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------------------------------------------

/** Fill `panel` (the 280 × 240 pnlDetailInfo box) with the model. */
export function renderInfoModel(panel: HTMLElement, model: InfoModel | null, o: InfoViewOptions): void {
    hoverAsTitle = o.hoverMessage !== true;
    try {
        renderInfoModelInner(panel, model, o);
    } finally {
        hoverAsTitle = true;
    }
}

function renderInfoModelInner(panel: HTMLElement, model: InfoModel | null, o: InfoViewOptions): void {
    panel.replaceChildren();
    if (model === null) return;
    // Background picture (DrawBackgroundPicture): centred in the panel, faded; a star 55% off the left edge.
    if (model.picture !== null) {
        const p = model.picture;
        const img = document.createElement('img');
        img.className = 'sel-picture';
        img.src = p.url;
        img.alt = '';
        img.draggable = false;
        img.style.opacity = String(p.alpha);
        const side = Math.min(p.size, INFO.height - 6);
        img.style.width = `${side}px`;
        img.style.height = `${side}px`;
        img.style.left = p.star ? `${-Math.trunc(side * 0.55)}px` : `${3 + Math.trunc((INFO.width - 6 - side) / 2)}px`;
        img.style.top = `${3 + Math.trunc((INFO.height - 6 - side) / 2)}px`;
        if (p.rotate !== 0) img.style.transform = `rotate(${p.rotate}deg)`;
        img.onerror = () => img.remove();
        panel.appendChild(img);
    }
    const scroll = document.createElement('div');
    scroll.className = 'sel-scroll';
    // Title line + corner.
    const title = document.createElement('div');
    title.className = 'sel-title';
    for (const s of model.title) {
        const el = segElement(s, o);
        // A title segment flagged w = -1 is the normal-font "(Empire)" / "(lead ship)" suffix.
        if (s.w === -1) {
            el.classList.add('sel-title-suffix');
            el.style.width = '';
            el.style.height = '';
        }
        title.appendChild(el);
    }
    scroll.appendChild(title);
    if (model.corner !== null) {
        const c = model.corner;
        let el: HTMLElement;
        if (c.flagOf !== undefined) el = flagElement(o.galaxy, c.flagOf, INFO.flagSmall.w, INFO.flagSmall.h);
        else {
            el = document.createElement('span');
            el.className = 'sel-text';
            el.textContent = c.text ?? '';
            el.style.color = css(c.color ?? WHITE);
        }
        el.classList.add('sel-corner');
        attachTarget(el, c.target, c.flagOf !== undefined ? `${c.flagOf.name} (click for details)` : undefined, o);
        scroll.appendChild(el);
    }
    // Rows; everything after the band marker sits on the label-area brush.
    let target: HTMLElement = scroll;
    let banded = false;
    for (const row of model.rows) {
        if (row.kind === 'band') {
            const band = document.createElement('div');
            band.className = 'sel-banded';
            band.style.setProperty('--band-w', `${model.labelWidth + 4}px`);
            scroll.appendChild(band);
            target = band;
            banded = true;
            continue;
        }
        const el = rowElement(row, model.labelWidth, o, banded);
        if (el !== null) target.appendChild(el);
    }
    panel.appendChild(scroll);
    if (model.automated) {
        const auto = document.createElement('img');
        auto.className = 'sel-automate';
        auto.src = chromeUrl('automate.png');
        auto.alt = '';
        auto.draggable = false;
        setHover(auto, 'Automated (click to turn off)');
        if (o.onAutomate !== undefined) {
            auto.classList.add('sel-hot');
            const onAutomate = o.onAutomate;
            auto.addEventListener('click', (e) => {
                e.stopPropagation();
                onAutomate();
            });
        }
        panel.appendChild(auto);
    }
}
