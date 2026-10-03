// Left sidebar view: draws the Empire Navigation Tool (leftSidebar.ts, a port of ItemListCollectionPanel /
// ItemListPanel) as DOM in the original's pixels, scaled as one with the HUD (originalWindow.ts hudScale: window
// height × UI scale × HUD_FRAME_SIZE), anchored at the original's Area (Main.Part2.cs method_666) above the selection
// panel. Behaviour (ItemListCollectionPanel.CheckClick / ItemListPanel.CheckClick, Main.Part12.cs method_78):
//   - a category button opens its panel; clicking it again (or the panel's X) closes it;
//   - the title bar's size icon cycles the tool's size (1 → 1.33 → 1.77, CycleChangeSize);
//   - toggle buttons cycle their state and rebind the list;
//   - the scroll bars and the mouse wheel scroll by ScrollAmountPerClick (25 × size);
//   - an item click selects it (method_208); a double click also centres the view on it and zooms to the 100%
//     planet level (method_157 + method_4(1.0)); Shift+click a ship adds it to / removes it from a multi-selection;
//   - the panel redraws every 0.5 s (MainView: LastRefresh > 0.5 s);
//   - Pirate Missions: the list comes from the `pirateMissionsPanel` sim query (in the worker on a replica: building it
//     obtains pirate relations); a click on a row's right-hand button (Bid / Accept Mission / Cancel) issues the
//     pirateMissionButton command (ItemListPanel.cs 2248 bid zone → Main.Part12.cs 2601 BidButtonClicked).

import './leftSidebar.css';
import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import type { Camera } from '../render/camera';
import type { GameData } from '../sim/data/gameData';
import { BuiltObject } from '../sim/builtObject';
import { ShipGroup } from '../sim/fleets/shipGroup';
import { Habitat } from '../sim/types';
import { hudScale } from './originalWindow';
import { EmpireActivity } from '../sim/pirates/empireActivity';
import { pirateMissionBidZoneActive, type PirateMissionsPanelData } from '../sim/pirates/pirateMissionsPanel';
import { issuePlayerCommand } from '../sim/player/playerCommands';
import { isRemoteQueryGalaxy, simQuery } from '../simworker/simQuery';
import { WorkerQueryCache } from './workerQueryCache';
import { empireFlagUrl } from './selectionInfoView';
import { onSettingsChange, uiScaleFactor } from './settings';
import { css } from './selectionInfo';
import {
    PLANET_LEVEL_ZOOM,
    getSelection,
    selectBuiltObjectList,
    selectShipGroup,
    selectStellarObject,
    selectionFrameScale,
    selectionPanelSmall,
} from './hud';
import {
    buttonColumnTop,
    clampScroll,
    isSlowPanel,
    itemClickTarget,
    itemListArea,
    itemPanelDefs,
    itemRowModel,
    nextSizeFactor,
    noItemsText,
    panelButtonHint,
    panelIconUrl,
    panelItems,
    panelLayout,
    panelMetrics,
    panelTitleText,
    shiftToggleSelection,
    snapSizeFactor,
    visibleItemRange,
    type ItemListArea,
    type ItemPanelDef,
    type ItemPanelId,
    type ItemRowModel,
    type PanelItem,
    type RowContext,
    type RowSeg,
} from './leftSidebar';

export interface LeftSidebarWiring {
    galaxy?: Galaxy;
    game?: { playerEmpire: unknown };
    camera?: Camera;
    gameData?: GameData;
}

const STORE = 'dwu.itemList';
const SCROLL_UP_URL = '/assets/dwu/images/ui/chrome/scrolluparrow.png';
const SCROLL_DOWN_URL = '/assets/dwu/images/ui/chrome/scrolldownarrow.png';
/** ItemListCollectionPanel.AlphaTransparency: every ScaleLimitImage'd picture is drawn at 60 %. */
const ALPHA = 0.6;
/** Main.Part13.cs: a second click within this time on the same item is a double click (SystemInformation default). */
const DOUBLE_CLICK_MS = 500;

function load<T>(key: string, fallback: T): T {
    try {
        const v = localStorage.getItem(`${STORE}.${key}`);
        return v === null ? fallback : (JSON.parse(v) as T);
    } catch {
        return fallback;
    }
}
function save(key: string, v: unknown): void {
    try {
        localStorage.setItem(`${STORE}.${key}`, JSON.stringify(v));
    } catch {
        // private mode: not persisted
    }
}

function div(cls: string): HTMLDivElement {
    const d = document.createElement('div');
    d.className = cls;
    return d;
}

function image(url: string, cls: string, alpha = ALPHA): HTMLImageElement {
    const i = document.createElement('img');
    i.className = cls;
    i.src = url;
    i.draggable = false;
    i.alt = '';
    if (alpha !== 1) i.style.opacity = String(alpha);
    i.addEventListener('error', () => {
        i.style.visibility = 'hidden';
    });
    return i;
}

/** ItemListPanel method_2 (the X) / method_3 (the size arrow), `n` = TitleBarHeight − 10 px, as an SVG. */
function titleIcon(kind: 'close' | 'size', n: number): SVGSVGElement {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', String(n + 2));
    svg.setAttribute('height', String(n + 2));
    svg.setAttribute('viewBox', `-1 -1 ${n + 2} ${n + 2}`);
    const line = (x1: number, y1: number, x2: number, y2: number, w: number): void => {
        const l = document.createElementNS(ns, 'line');
        l.setAttribute('x1', String(x1));
        l.setAttribute('y1', String(y1));
        l.setAttribute('x2', String(x2));
        l.setAttribute('y2', String(y2));
        l.setAttribute('stroke', 'currentColor');
        l.setAttribute('stroke-width', String(w));
        svg.appendChild(l);
    };
    if (kind === 'close') {
        line(0, 0, n, n, 2);
        line(0, n, n, 0, 2);
    } else {
        const a = Math.trunc(n * 0.6);
        line(0, n, n, 0, 2);
        line(0, n, 0, n - a, 1);
        line(0, n, a, n, 1);
        line(n, 0, n - a, 0, 1);
        line(n, 0, n, a, 1);
    }
    return svg;
}

interface State {
    open: ItemPanelId | null;
    sizeFactor: number;
    toggles: Partial<Record<ItemPanelId, number[]>>;
    scroll: number;
    items: PanelItem[];
    itemsAt: number;
    hovered: number;
    lastClick: { item: PanelItem | null; at: number };
}

/** Builds the sidebar (category buttons + the open panel) and keeps it laid out and refreshed. */
export function createLeftSidebar(wiring: LeftSidebarWiring): HTMLElement {
    const root = div('ls-root hud-el');
    root.dataset.hud = 'pnlItemList';
    const buttons = div('ls-buttons');
    const panel = div('ls-panel');
    panel.hidden = true;
    root.append(buttons, panel);

    const state: State = {
        open: load<ItemPanelId | null>('open', null),
        sizeFactor: snapSizeFactor(load<number>('size', 1)),
        toggles: load<State['toggles']>('toggles', {}),
        scroll: 0,
        items: [],
        itemsAt: 0,
        hovered: -1,
        lastClick: { item: null, at: 0 },
    };
    let area: ItemListArea = itemListArea(800, 600, 1);
    let defs: ItemPanelDef[] = [];
    /** The Pirate Missions query's last answer (by toggle key); in-thread it is asked synchronously on every bind. */
    let missions: PirateMissionsPanelData | null = null;
    let missionsCache: { galaxy: Galaxy; cache: WorkerQueryCache<string, PirateMissionsPanelData> } | null = null;
    const missionsData = (galaxy: Galaxy, p: Empire, t: readonly number[]): PirateMissionsPanelData | null => {
        const ask = (key: string, done: (v: PirateMissionsPanelData) => void): void => {
            const [a, b] = key.split(',').map(Number);
            simQuery(galaxy, p, 'pirateMissionsPanel', [a, b], done);
        };
        const key = `${t[0] ?? 0},${t[1] ?? 0}`;
        if (!isRemoteQueryGalaxy(galaxy)) {
            let out: PirateMissionsPanelData | null = null;
            ask(key, (v) => {
                out = v;
            });
            return out;
        }
        if (missionsCache === null || missionsCache.galaxy !== galaxy) {
            missionsCache?.cache.dispose();
            missionsCache = {
                galaxy,
                cache: new WorkerQueryCache<string, PirateMissionsPanelData>(ask, () => {
                    bind(true);
                    render();
                }, () => false, 500),
            };
        }
        return missionsCache.cache.read(key) ?? null;
    };

    const player = (): Empire | null => (wiring.game?.playerEmpire as Empire | undefined) ?? null;
    const rowCtx = (): RowContext | null => {
        const galaxy = wiring.galaxy;
        const p = player();
        if (!galaxy || !p) return null;
        const gd = wiring.gameData;
        return {
            galaxy,
            player: p,
            sizeFactor: state.sizeFactor,
            resource: (id) => {
                const r = gd?.resources.find((x) => x.resourceId === id);
                return r ? { name: r.name, pictureRef: r.pictureRef } : null;
            },
            pirateMissionsConsidering: missions !== null ? new Map(missions.items.map((a, i) => [a, missions!.considering[i] ?? 0])) : undefined,
        };
    };
    const openDef = (): ItemPanelDef | null => defs.find((d) => d.id === state.open) ?? null;
    const togglesOf = (d: ItemPanelDef): number[] => {
        const t = state.toggles[d.id] ?? [];
        return d.toggles.map((_, i) => t[i] ?? 0);
    };

    // ----- layout -----------------------------------------------------------------------------------------------
    let panelEls: {
        title: HTMLDivElement;
        titleText: HTMLSpanElement;
        toggles: HTMLDivElement[];
        up: HTMLDivElement;
        upArrow: HTMLImageElement;
        items: HTMLDivElement;
        down: HTMLDivElement;
        downArrow: HTMLImageElement;
    } | null = null;

    const layout = (): void => {
        const s = uiScaleFactor();
        const k = hudScale(window.innerHeight, s);
        const clientH = window.innerHeight / k;
        // pnlInfoPanel.Top: the selection frame's top + 36 (hud.ts SELECTION_FRAME: y (num - 36) .. bottom + 30), the
        // frame anchored 10 px above the window bottom and scaled by selectionFrameScale.
        const ks = selectionFrameScale(window.innerHeight, s, selectionPanelSmall());
        const infoTop = (window.innerHeight - 10 - (310 - 36) * ks) / k;
        area = itemListArea(clientH, infoTop, state.sizeFactor);
        root.style.left = `${area.x * k}px`;
        root.style.top = `${area.y * k}px`;
        root.style.width = `${area.w}px`;
        root.style.height = `${area.h}px`;
        root.style.transform = `scale(${k})`;
        root.style.setProperty('--ls-f', String(state.sizeFactor));
        buildButtons();
        buildPanel();
    };

    // ----- category buttons (ItemListCollectionPanel.DrawPanel) ------------------------------------------------
    const buildButtons = (): void => {
        const p = player();
        defs = itemPanelDefs(p?.pirateEmpireBaseHabitat != null);
        if (state.open !== null && !defs.some((d) => d.id === state.open)) state.open = null;
        const top = buttonColumnTop(area, defs.length);
        buttons.replaceChildren();
        defs.forEach((d, i) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'ls-button';
            b.dataset.panel = d.id;
            b.style.top = `${top + i * area.button}px`;
            b.style.width = `${area.button + 1}px`;
            b.style.height = `${area.button + 1}px`;
            b.title = panelButtonHint(d.title, state.open === d.id);
            if (p) {
                const ic = panelIconUrl(d.icon, p);
                if (ic.url) {
                    const im = image(ic.url, `ls-button-icon${ic.rotate ? ' ls-rot' : ''}`);
                    im.style.width = `${area.icon}px`;
                    im.style.height = `${area.icon}px`;
                    b.appendChild(im);
                }
            }
            b.addEventListener('click', () => openPanel(state.open === d.id ? null : d.id));
            buttons.appendChild(b);
        });
    };

    const openPanel = (id: ItemPanelId | null): void => {
        state.open = id;
        state.scroll = 0;
        state.hovered = -1;
        save('open', id);
        for (const b of buttons.querySelectorAll<HTMLButtonElement>('.ls-button')) {
            const d = defs.find((x) => x.id === b.dataset.panel);
            if (d) b.title = panelButtonHint(d.title, state.open === d.id);
        }
        bind(true);
        buildPanel();
    };

    // ----- the open panel (ItemListPanel.DrawPanel) -------------------------------------------------------------
    const buildPanel = (): void => {
        const d = openDef();
        panel.hidden = d === null;
        panelEls = null;
        panel.replaceChildren();
        if (!d) return;
        const m = panelMetrics(state.sizeFactor, d.itemHeightFactor);
        const w = area.w - (area.button + 2);
        const h = area.h;
        panel.style.left = `${area.button + 2}px`;
        panel.style.top = '0px';
        panel.style.width = `${w}px`;
        panel.style.height = `${h}px`;
        const L = panelLayout(w, h, m, d.toggles.length);
        const p = player();

        const title = div('ls-title');
        place(title, L.title);
        if (p) {
            const ic = panelIconUrl(d.icon, p);
            if (ic.url) {
                const im = image(ic.url, `ls-title-icon${ic.rotate ? ' ls-rot' : ''}`);
                const box = Math.max(1, Math.min(area.button - 4, Math.trunc(16 * state.sizeFactor)));
                im.style.width = `${box}px`;
                im.style.height = `${box}px`;
                title.appendChild(im);
            }
        }
        const titleText = document.createElement('span');
        titleText.className = 'ls-title-text';
        titleText.style.left = `${2 + Math.max(1, Math.min(area.button - 4, Math.trunc(16 * state.sizeFactor))) + 3}px`;
        title.appendChild(titleText);
        const sizeBtn = div('ls-title-btn');
        sizeBtn.style.left = `${L.sizeIcon.x - 1}px`;
        sizeBtn.style.top = `${L.sizeIcon.y - 1}px`;
        sizeBtn.title = 'Change the size of the list';
        sizeBtn.appendChild(titleIcon('size', m.titleBar - 10));
        sizeBtn.addEventListener('click', () => {
            state.sizeFactor = nextSizeFactor(state.sizeFactor);
            save('size', state.sizeFactor);
            layout();
            render();
        });
        const closeBtn = div('ls-title-btn');
        closeBtn.style.left = `${L.closeIcon.x - 1}px`;
        closeBtn.style.top = `${L.closeIcon.y - 1}px`;
        closeBtn.title = 'Close';
        closeBtn.appendChild(titleIcon('close', m.titleBar - 10));
        closeBtn.addEventListener('click', () => openPanel(null));
        title.append(sizeBtn, closeBtn);
        panel.appendChild(title);

        const toggleEls: HTMLDivElement[] = [];
        L.toggles.forEach((r, i) => {
            const t = div('ls-toggle');
            place(t, r);
            t.addEventListener('click', () => {
                const cur = togglesOf(d);
                cur[i] = (cur[i] + 1) % d.toggles[i].length;
                state.toggles[d.id] = cur;
                save('toggles', state.toggles);
                bind(true);
                render();
            });
            toggleEls.push(t);
            panel.appendChild(t);
        });

        const up = div('ls-scrollbar');
        place(up, L.scrollUp);
        const upArrow = image(SCROLL_UP_URL, 'ls-arrow', 1);
        up.appendChild(upArrow);
        const items = div('ls-items');
        place(items, L.items);
        const down = div('ls-scrollbar');
        place(down, L.scrollDown);
        const downArrow = image(SCROLL_DOWN_URL, 'ls-arrow ls-arrow-down', 1);
        down.appendChild(downArrow);
        holdToScroll(up, -1);
        holdToScroll(down, 1);
        panel.append(up, items, down);
        panelEls = { title, titleText, toggles: toggleEls, up, upArrow, items, down, downArrow };

        items.addEventListener('mousemove', (e) => setHovered(itemIndexAt(e)));
        items.addEventListener('mouseleave', () => setHovered(-1));
        items.addEventListener('click', (e) => {
            const i = itemIndexAt(e);
            if (i >= 0) clickItem(state.items[i], e.shiftKey, bidZoneAt(e));
        });
        render();
    };

    /** The hovered item (ItemListPanel object_0): highlighted by class, without redrawing the rows. */
    const setHovered = (i: number): void => {
        if (i === state.hovered) return;
        state.hovered = i;
        for (const r of panelEls?.items.querySelectorAll<HTMLElement>('.ls-row') ?? []) r.classList.toggle('ls-hover', Number(r.dataset.index) === i);
    };

    const place = (e: HTMLElement, r: { x: number; y: number; w: number; h: number }): void => {
        e.style.left = `${r.x}px`;
        e.style.top = `${r.y}px`;
        e.style.width = `${r.w}px`;
        e.style.height = `${r.h}px`;
    };

    const metrics = () => panelMetrics(state.sizeFactor, openDef()?.itemHeightFactor ?? 1);

    const itemIndexAt = (e: MouseEvent): number => {
        if (!panelEls) return -1;
        const r = panelEls.items.getBoundingClientRect();
        const k = r.height / Math.max(1, panelEls.items.offsetHeight);
        const y = (e.clientY - r.top) / (k || 1) + state.scroll;
        const m = metrics();
        const i = Math.trunc(y / (m.item + m.gap));
        // method_11: the gap between rows is no item.
        if (y < 0 || y > i * (m.item + m.gap) + m.item) return -1;
        return i < state.items.length ? i : -1;
    };

    /** ItemListPanel.cs 2251: the click is in the right-hand 60 px (the bid button's column). */
    const bidZoneAt = (e: MouseEvent): boolean => {
        if (!panelEls) return false;
        const r = panelEls.items.getBoundingClientRect();
        const k = r.width / Math.max(1, panelEls.items.offsetWidth);
        const x = (e.clientX - r.left) / (k || 1);
        return x > panelEls.items.offsetWidth - Math.trunc(60 * state.sizeFactor);
    };

    const scrollBy = (dir: number, amount: number): void => {
        const d = openDef();
        if (!d) return;
        const next = clampScroll(state.scroll + dir * amount, state.items.length, metrics(), area.h, d.toggles.length);
        if (next !== state.scroll) {
            state.scroll = next;
            renderRows();
            renderBars();
        }
    };

    const holdToScroll = (el: HTMLElement, dir: number): void => {
        let timer: number | undefined;
        const stop = (): void => {
            if (timer !== undefined) window.clearInterval(timer);
            timer = undefined;
        };
        el.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            scrollBy(dir, metrics().scrollPerClick);
            stop();
            let n = 0;
            timer = window.setInterval(() => {
                if (++n > 3) scrollBy(dir, metrics().scrollPerClick);
            }, 80);
        });
        el.addEventListener('mouseup', stop);
        el.addEventListener('mouseleave', stop);
    };

    root.addEventListener(
        'wheel',
        (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!panelEls || !panel.contains(e.target as Node)) return;
            // CheckScrollWheel: ScrollAmountPerClick × Delta / 100 (one notch = 120 → 1.2 steps).
            const notch = e.deltaMode === 1 ? e.deltaY / 3 : e.deltaY / 100;
            scrollBy(Math.sign(notch), Math.round(metrics().scrollPerClick * 1.2 * Math.abs(notch)));
            setHovered(itemIndexAt(e)); // CheckScrollWheel → DetectHoveredElement
        },
        { passive: false },
    );

    // ----- data -------------------------------------------------------------------------------------------------
    /** BindData: rebuild the open panel's list (keeping the scroll position, clamped). */
    const bind = (force: boolean): void => {
        const d = openDef();
        const galaxy = wiring.galaxy;
        const p = player();
        if (!d || !galaxy || !p) {
            state.items = [];
            return;
        }
        const now = performance.now();
        if (!force && isSlowPanel(d.id) && now - state.itemsAt < 3000) return;
        try {
            if (d.id === 'pirateMissions') missions = missionsData(galaxy, p, togglesOf(d));
            state.items = panelItems(d.id, galaxy, p, { toggles: togglesOf(d), pirateMissions: missions });
        } catch (err) {
            console.warn('item list', d.id, err);
            state.items = [];
        }
        state.itemsAt = now;
        state.scroll = clampScroll(state.scroll, state.items.length, metrics(), area.h, d.toggles.length);
    };

    const render = (): void => {
        const d = openDef();
        if (!d || !panelEls) return;
        panelEls.titleText.textContent = panelTitleText(d.title, state.items.length);
        const t = togglesOf(d);
        panelEls.toggles.forEach((el, i) => {
            el.textContent = d.toggles[i][t[i]] ?? '';
        });
        renderBars();
        renderRows();
    };

    const renderBars = (): void => {
        const d = openDef();
        if (!d || !panelEls) return;
        const canUp = state.scroll > 0;
        const max = clampScroll(Number.MAX_SAFE_INTEGER, state.items.length, metrics(), area.h, d.toggles.length);
        const canDown = state.scroll < max;
        panelEls.up.classList.toggle('ls-can', canUp);
        panelEls.down.classList.toggle('ls-can', canDown);
        panelEls.upArrow.hidden = !canUp;
        panelEls.downArrow.hidden = !canDown;
    };

    const renderRows = (): void => {
        const d = openDef();
        const ctx = rowCtx();
        if (!d || !panelEls || !ctx) return;
        const box = panelEls.items;
        box.replaceChildren();
        const m = metrics();
        if (state.items.length === 0) {
            const e = div('ls-empty');
            e.textContent = noItemsText(d.title);
            box.appendChild(e);
            return;
        }
        const viewH = box.offsetHeight || area.h;
        const { first, last } = visibleItemRange(state.scroll, viewH, state.items.length, m);
        for (let i = first; i <= last; i++) {
            const item = state.items[i];
            let model: ItemRowModel;
            try {
                model = itemRowModel(ctx, d.id, item);
            } catch (err) {
                console.warn('item row', d.id, err);
                continue;
            }
            const row = drawRow(model, m.item, box.offsetWidth - 2);
            row.style.top = `${i * (m.item + m.gap) - state.scroll}px`;
            row.dataset.index = String(i);
            if (i === state.hovered) row.classList.add('ls-hover');
            box.appendChild(row);
        }
    };

    const drawRow = (model: ItemRowModel, h: number, w: number): HTMLDivElement => {
        const f = state.sizeFactor;
        const row = div('ls-row');
        row.style.left = '1px';
        row.style.width = `${w}px`;
        row.style.height = `${h}px`;
        for (const p of model.pictures) {
            const im = image(p.url, `ls-pic${p.rotate ? ' ls-rot' : ''}`);
            im.style.left = `${p.x}px`;
            im.style.top = `${p.y}px`;
            im.style.width = `${p.size}px`;
            im.style.height = `${p.size}px`;
            row.appendChild(im);
        }
        for (const o of model.overlays) {
            const im = image(o.url, 'ls-overlay', o.full ? 1 : ALPHA);
            im.style.left = `${o.x}px`;
            im.style.top = `${o.y}px`;
            if (o.size !== undefined) {
                im.style.width = `${o.size}px`;
                im.style.height = `${o.size}px`;
                im.style.objectFit = 'contain';
            }
            row.appendChild(im);
        }
        // Line 1 at y num (3): the bold name; the small text 3 px lower (num4 = 6), icons at num3 (5).
        const l1 = drawLine(model.line1, { text: 0, small: Math.trunc(3 * f), img: Math.trunc(2 * f) });
        l1.style.left = `${model.textX}px`;
        l1.style.top = `${Math.trunc(3 * f)}px`;
        // Line 2: icons at num14 (22), text at num15 (24).
        const l2 = drawLine(model.line2, { text: Math.trunc(2 * f), small: Math.trunc(2 * f), img: 0 });
        l2.style.left = `${model.textX}px`;
        l2.style.top = `${Math.trunc(22 * f)}px`;
        row.append(l1, l2);
        for (const fr of model.free ?? []) {
            const piece = drawLine([fr.seg], { text: 0, small: 0, img: 0 });
            piece.style.left = `${fr.x}px`;
            piece.style.top = `${fr.y}px`;
            row.appendChild(piece);
        }
        if (model.button) {
            // method_7 rect3: (w - num, 1) num × (h - num2), fill (216, 96, 96, 96), 2 px white border; the text centred.
            const b = div('ls-mission-btn');
            b.style.left = `${w - model.button.w}px`;
            b.style.top = '1px';
            b.style.width = `${model.button.w}px`;
            b.style.height = `${h - Math.trunc(2 * f)}px`;
            const t1 = document.createElement('span');
            t1.className = 'ls-bold';
            t1.textContent = model.button.text;
            b.appendChild(t1);
            if (model.button.sub !== '') {
                const t2 = document.createElement('span');
                t2.className = 'ls-small';
                t2.textContent = model.button.sub;
                b.appendChild(t2);
            }
            row.appendChild(b);
        }
        for (const r of model.right) {
            const im = image(r.url, 'ls-overlay', r.full ? 1 : ALPHA);
            im.style.left = `${w - r.fromRight}px`;
            im.style.top = `${r.y}px`;
            im.style.width = `${r.size}px`;
            im.style.height = `${r.size}px`;
            im.style.objectFit = 'contain';
            row.appendChild(im);
        }
        return row;
    };

    const drawLine = (segs: RowSeg[], dy: { text: number; small: number; img: number }): HTMLDivElement => {
        const line = div('ls-line');
        for (const s of segs) {
            let e: HTMLElement;
            if (s.kind === 'flag') {
                const g = wiring.galaxy;
                const box = document.createElement('span');
                box.className = 'ls-flag';
                box.style.width = `${s.w}px`;
                box.style.height = `${s.h}px`;
                box.style.background = css(s.empire.mainColor);
                if (g) {
                    const im = document.createElement('img');
                    im.alt = '';
                    void empireFlagUrl(g, s.empire).then((u) => {
                        if (u !== '') im.src = u;
                    });
                    box.appendChild(im);
                }
                e = box;
            } else if (s.kind === 'text') {
                e = document.createElement('span');
                e.className = s.font === 'bold' ? 'ls-bold' : s.font === 'regular' ? 'ls-regular' : 'ls-small';
                e.textContent = s.text;
                e.style.color = css(s.color);
                e.style.marginTop = `${s.font === 'small' ? dy.small : dy.text}px`;
                if (s.maxWidth !== undefined) {
                    e.style.maxWidth = `${s.maxWidth}px`;
                    e.classList.add('ls-ellipsis');
                }
            } else {
                const im = image(s.url, `ls-icon${s.dotted ? ' ls-dotted' : ''}`, s.full ? 1 : ALPHA);
                im.style.width = `${s.size}px`;
                im.style.height = `${s.size}px`;
                im.style.marginTop = `${dy.img}px`;
                if (s.title) im.title = s.title;
                e = im;
            }
            if (s.at !== undefined) {
                e.style.position = 'absolute';
                e.style.left = `${s.at}px`;
                e.style.top = '0';
            } else if (s.gapBefore) {
                e.style.marginLeft = `${s.gapBefore}px`;
            }
            line.appendChild(e);
        }
        return line;
    };

    // ----- clicks (Main.Part12.cs method_78) --------------------------------------------------------------------
    const clickItem = (item: PanelItem | undefined, shift: boolean, bidZone = false): void => {
        if (!item) return;
        const now = performance.now();
        const dbl = state.lastClick.item === item && now - state.lastClick.at < DOUBLE_CLICK_MS;
        state.lastClick = dbl ? { item: null, at: 0 } : { item, at: now };
        const p = player();
        // Main.Part12.cs 2601: the row's button (ItemListPanel.cs 2248-2286 decides whether the click hit it).
        if (item instanceof EmpireActivity && bidZone && p && wiring.galaxy && pirateMissionBidZoneActive(p, item) && item.target !== null) {
            const d = openDef();
            const key = d !== null ? `${togglesOf(d)[0] ?? 0},${togglesOf(d)[1] ?? 0}` : '';
            issuePlayerCommand(wiring.galaxy, p, 'pirateMissionButton', [item.target, item.type, item.requestingEmpire, item.targetEmpire], () => {
                missionsCache?.cache.invalidate(key);
                bind(true);
                render();
            });
        }
        if (shift && item instanceof BuiltObject && p) {
            const sel = getSelection();
            const current = sel?.builtObjects ?? sel?.builtObject ?? null;
            const next = shiftToggleSelection(current, item, p);
            if (next !== null) {
                selectBuiltObjectList(next); // 0 → clear, 1 → that ship, 2+ → the multi-selection
                return;
            }
        }
        const t = itemClickTarget(item);
        if (t.select instanceof ShipGroup) selectShipGroup(t.select, false);
        else if (t.select instanceof Habitat || t.select instanceof BuiltObject) selectStellarObject(t.select, false);
        const cam = wiring.camera;
        if (dbl && cam && t.centre) {
            cam.centerOn(t.centre.x, t.centre.y);
            cam.zoomAt(PLANET_LEVEL_ZOOM, cam.width / 2, cam.height / 2);
        }
    };

    // ----- lifecycle ----------------------------------------------------------------------------------------------
    layout();
    bind(true);
    render();
    window.addEventListener('resize', () => {
        layout();
    });
    onSettingsChange(() => layout());
    window.setInterval(() => {
        if (!root.isConnected || state.open === null) return;
        bind(false);
        render();
    }, 500);
    (root as HTMLElement & { relayout?: () => void }).relayout = layout;
    return root;
}

/** Re-run the sidebar's layout (after the selection panel changes size). */
export function relayoutLeftSidebar(el: HTMLElement | null | undefined): void {
    (el as (HTMLElement & { relayout?: () => void }) | null | undefined)?.relayout?.();
}
