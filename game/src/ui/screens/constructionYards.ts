// Construction Yards panel (task 16c): a streamlined port of the original's
// Construction Yards view, opened by F10 or the top-bar tbtnConstructionYards
// button. The site list is BaconMain.cs method_423's "Construction Yards"
// branch; the yards table ports ConstructionYardListView.cs BindData; the
// wait-queue buttons port Main.Part5.cs:2147-2213 (Move to Top / Up / Down /
// Bottom). Styling follows the Ships and Bases list.
// TODO(port): remove from queue / scrap ship / construction summary / manufacturing wait queue (Main.Part3.cs:681-700 buttons) — not in 16c

import './constructionYards.css';
import type { Empire } from '../../sim/empire';
import type { Galaxy } from '../../sim/galaxy';
import type { BuiltObject } from '../../sim/builtObject';
import type { Habitat } from '../../sim/types';
import type { ConstructionQueue } from '../../sim/construction/constructionQueue';
import type { ConstructionYard } from '../../sim/construction/constructionYard';
import { componentListDiff, yardsCountUnderConstruction } from '../../sim/construction/constructionYard';
import { resolveSubRoleDescription, componentDefinitionsStatic } from '../../sim/designGeneration';
import { formatMoney } from '../hud';

export type ConstructionSite = { kind: 'builtObject'; builtObject: BuiltObject } | { kind: 'colony'; habitat: Habitat };

/** The site's construction queue (the field is `unknown` on BuiltObject and Habitat). */
export function siteQueue(site: ConstructionSite): ConstructionQueue | null {
    return (site.kind === 'colony' ? site.habitat : site.builtObject).constructionQueue as ConstructionQueue | null;
}

// BaconMain.cs method_423, "Construction Yards" branch: state then private ship
// yards with at least one yard, then every colony.
export function constructionSites(empire: Empire): ConstructionSite[] {
    const sites: ConstructionSite[] = [];
    const addYards = (list: readonly BuiltObject[]): void => {
        for (let i = 0; i < list.length; i++) {
            const bo = list[i];
            if (!bo) continue;
            const queue = bo.constructionQueue as ConstructionQueue | null;
            if (bo.isShipYard && queue != null && (queue.constructionYards?.length ?? 0) > 0) {
                sites.push({ kind: 'builtObject', builtObject: bo });
            }
        }
    };
    addYards(empire.builtObjects);
    addYards(empire.privateBuiltObjects);
    for (let k = 0; k < empire.colonies.length; k++) sites.push({ kind: 'colony', habitat: empire.colonies[k] });
    return sites;
}

// ConstructionYardListView.cs:128 BindData, Cells[4] (Progress).
export function yardProgress(yard: ConstructionYard): number {
    const ship = yard.shipUnderConstruction;
    if (ship === null) return 0;
    if (ship.retrofitDesign !== null) {
        const design = ship.design;
        const retrofitDesign = ship.retrofitDesign;
        const num1 =
            componentListDiff(design.components, retrofitDesign.components).length +
            Math.trunc(componentListDiff(retrofitDesign.components, design.components).length / 4);
        const num2 = yard.retrofitComponentsToBeBuilt !== null ? yard.retrofitComponentsToBeBuilt.length : 0;
        const num3 = yard.retrofitComponentsToBeScrapped !== null ? yard.retrofitComponentsToBeScrapped.length : 0;
        // The C# would divide by zero here (retrofit to an identical component list).
        if (num1 === 0) return 1;
        return 1.0 - (num2 + Math.trunc(num3 / 4)) / num1;
    }
    // The C# would divide by zero here (a ship with no components).
    if (ship.components.count === 0) return 0;
    return 1.0 - ship.unbuiltOrDamagedComponentCount / ship.components.count;
}

/** .NET numeric format "p": percent with two decimals. */
export function formatProgressP(v: number): string {
    return `${(v * 100).toFixed(2)}%`;
}

export interface ConstructionSiteRow {
    site: ConstructionSite;
    name: string;
    type: string;
    yards: number;
    building: number;
    waiting: number;
    speed: number;
}

// BaconMain.cs method_423 list rows, with the queue counts the Construction
// Yards view shows for the selected site.
export function constructionSiteRows(empire: Empire): ConstructionSiteRow[] {
    return constructionSites(empire).map((site) => {
        const queue = siteQueue(site);
        const yards = queue?.constructionYards ?? [];
        return {
            site,
            name: site.kind === 'colony' ? site.habitat.name : site.builtObject.name,
            type: site.kind === 'colony' ? 'Colony' : resolveSubRoleDescription(site.builtObject.subRole),
            yards: queue ? yards.length : 0,
            building: queue ? yardsCountUnderConstruction(yards) : 0,
            waiting: queue ? (queue.constructionWaitQueue?.length ?? 0) : 0,
            speed: queue ? queue.constructionSpeed : 0,
        };
    });
}

export interface YardRow {
    yard: string;
    ship: string;
    progress: number;
    progressText: string;
    speed: number;
}

// ConstructionYardListView.cs:128 BindData: one row per yard with ComponentId >= 0
// (Cells[0] tooltip = component name, Cells[3] ship, Cells[4] progress, Cells[5] speed).
export function yardRows(site: ConstructionSite, componentName: (componentId: number) => string): YardRow[] {
    const yards = siteQueue(site)?.constructionYards ?? [];
    const rows: YardRow[] = [];
    for (const yard of yards) {
        if (!yard || yard.componentId < 0) continue;
        const progress = yardProgress(yard);
        rows.push({
            yard: componentName(yard.componentId),
            ship: yard.shipUnderConstruction !== null ? yard.shipUnderConstruction.name : '',
            progress,
            progressText: formatProgressP(progress),
            speed: yard.constructionSpeed,
        });
    }
    return rows;
}

export interface WaitRow {
    builtObject: BuiltObject;
    name: string;
    type: string;
    price: string;
}

/** "Ships waiting to be constructed" (Main.Part3.cs:699), in queue order. */
export function waitRows(site: ConstructionSite): WaitRow[] {
    const wait = siteQueue(site)?.constructionWaitQueue ?? [];
    const rows: WaitRow[] = [];
    for (const bo of wait) {
        if (!bo) continue;
        rows.push({ builtObject: bo, name: bo.name, type: resolveSubRoleDescription(bo.subRole), price: formatMoney(bo.purchasePrice) });
    }
    return rows;
}

export type WaitQueueMove = 'top' | 'up' | 'down' | 'bottom';

// Main.Part5.cs:2147-2213 (Move to Top / Move Up / Move Down / Move to Bottom),
// in place on the live wait queue. Returns whether the order changed.
export function moveWaitQueueItem(queue: BuiltObject[], item: BuiltObject, move: WaitQueueMove): boolean {
    const num = queue.indexOf(item);
    switch (move) {
        case 'top':
            if (num > 0) {
                queue.splice(num, 1);
                queue.splice(0, 0, item);
                return true;
            }
            return false;
        case 'up':
            if (num > 0) {
                queue.splice(num, 1);
                queue.splice(num - 1, 0, item);
                return true;
            }
            return false;
        case 'down':
            if (num >= 0 && num < queue.length - 1) {
                queue.splice(num, 1);
                queue.splice(num + 1, 0, item);
                return true;
            }
            return false;
        case 'bottom':
            if (num >= 0 && num < queue.length - 1) {
                queue.splice(num, 1);
                queue.splice(queue.length, 0, item);
                return true;
            }
            return false;
    }
}

export interface ConstructionYardsOptions {
    /** The player's empire. */
    empire: Empire;
    /** Go to: select the site and zoom to it. */
    onSelect: (target: BuiltObject | Habitat) => void;
}

interface OpenState {
    root: HTMLElement;
    close: () => void;
}

let open: OpenState | null = null;

/** Open the Construction Yards panel, or close it if it is already open. */
export function toggleConstructionYards(opts: ConstructionYardsOptions): void {
    if (open) {
        open.close();
    } else {
        open = createConstructionYards(opts);
    }
}

/** Close the Construction Yards panel (no-op when closed). */
export function closeConstructionYards(): void {
    open?.close();
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
}

function setText(e: HTMLElement, text: string, title = false): void {
    if (e.textContent !== text) e.textContent = text;
    if (title && e.title !== text) e.title = text;
}

/** Keyed in-place list refresh: rows are reused by key (object identity), updated,
 * and re-appended only when the order changes, so clicks survive the refresh tick. */
function syncRows<T, K>(
    container: HTMLElement,
    cache: Map<K, HTMLElement>,
    items: readonly T[],
    key: (item: T) => K,
    create: (item: T) => HTMLElement,
    update: (line: HTMLElement, item: T) => void,
): void {
    const seen = new Set<K>();
    const lines: HTMLElement[] = [];
    for (const item of items) {
        const k = key(item);
        seen.add(k);
        let line = cache.get(k);
        if (!line) {
            line = create(item);
            cache.set(k, line);
        }
        update(line, item);
        lines.push(line);
    }
    for (const [k, line] of cache) {
        if (!seen.has(k)) {
            line.remove();
            cache.delete(k);
        }
    }
    const current = Array.from(container.children);
    if (current.length !== lines.length || lines.some((l, i) => current[i] !== l)) container.replaceChildren(...lines);
}

function siteTarget(site: ConstructionSite): BuiltObject | Habitat {
    return site.kind === 'colony' ? site.habitat : site.builtObject;
}

function headerRow(gridClass: string, cols: readonly (readonly [string, boolean])[]): HTMLElement {
    const header = el('div', `construction-yards-header ${gridClass}`);
    for (const [text, num] of cols) {
        header.appendChild(el('span', 'construction-yards-header-cell' + (num ? ' construction-yards-number' : ''), text));
    }
    return header;
}

function createConstructionYards(opts: ConstructionYardsOptions): OpenState {
    const galaxy: Galaxy = opts.empire.galaxy;
    const componentName = (componentId: number): string => {
        const defs = componentDefinitionsStatic(galaxy);
        return defs.find((d) => d.componentId === componentId)?.name ?? '';
    };

    const root = el('div', 'construction-yards-wrap');
    const win = el('div', 'construction-yards-window');
    const titlebar = el('div', 'construction-yards-titlebar');
    const heading = el('div', 'construction-yards-heading');
    titlebar.appendChild(heading);
    const closeBtn = el('button', 'construction-yards-close', '✕');
    closeBtn.type = 'button';
    closeBtn.title = 'Close';
    titlebar.appendChild(closeBtn);
    win.appendChild(titlebar);

    const body = el('div', 'construction-yards-body');
    const emptyAll = el('div', 'construction-yards-empty', 'No construction yards');

    // Left pane: the site table (Name | Type | Yards | Building | Waiting | Speed).
    const left = el('div', 'construction-yards-left');
    left.appendChild(
        headerRow('construction-yards-site-grid', [['Name', false], ['Type', false], ['Yards', true], ['Building', true], ['Waiting', true], ['Speed', true]]),
    );
    const siteList = el('div', 'construction-yards-list');
    left.appendChild(siteList);

    // Right pane: the selected site.
    const right = el('div', 'construction-yards-right');
    const siteHead = el('div', 'construction-yards-site-head');
    const siteName = el('div', 'construction-yards-site-name');
    const goTo = el('button', 'construction-yards-button', 'Go to');
    goTo.type = 'button';
    siteHead.append(siteName, goTo);
    const yardHeader = headerRow('construction-yards-yard-grid', [['Yard', false], ['Ship', false], ['Progress', true], ['Speed', true]]);
    const yardList = el('div', 'construction-yards-list');
    const yardEmpty = el('div', 'construction-yards-empty', 'No construction yards');
    const waitLabel = el('div', 'construction-yards-section', 'Ships waiting to be constructed');
    const waitList = el('div', 'construction-yards-list');
    const waitEmpty = el('div', 'construction-yards-empty', 'No ships waiting');
    const buttons = el('div', 'construction-yards-buttons');
    const moveButtons: HTMLButtonElement[] = [];
    for (const [text, move] of [['Move to Top', 'top'], ['Move Up', 'up'], ['Move Down', 'down'], ['Move to Bottom', 'bottom']] as const) {
        const b = el('button', 'construction-yards-button', text);
        b.type = 'button';
        b.addEventListener('click', () => {
            const site = selectedSite;
            const wait = site ? siteQueue(site)?.constructionWaitQueue : null;
            if (!wait || selectedWait === null) return;
            moveWaitQueueItem(wait, selectedWait, move);
            render();
        });
        moveButtons.push(b);
        buttons.appendChild(b);
    }
    right.append(siteHead, yardHeader, yardList, yardEmpty, waitLabel, waitList, waitEmpty, buttons);

    win.appendChild(body);
    root.appendChild(win);
    document.body.appendChild(root);

    // Selections are kept by object identity across refreshes.
    let selectedTarget: BuiltObject | Habitat | null = null;
    let selectedSite: ConstructionSite | null = null;
    let selectedWait: BuiltObject | null = null;
    const siteLines = new Map<BuiltObject | Habitat, HTMLElement>();
    const waitLines = new Map<BuiltObject, HTMLElement>();

    goTo.addEventListener('click', () => {
        const site = selectedSite;
        if (!site) return;
        close();
        opts.onSelect(siteTarget(site));
    });

    function render(): void {
        const rows = constructionSiteRows(opts.empire);
        setText(heading, `Construction Yards (${rows.length})`);
        if (rows.length === 0) {
            body.classList.remove('construction-yards-split');
            if (body.firstChild !== emptyAll || body.childNodes.length !== 1) body.replaceChildren(emptyAll);
            selectedTarget = null;
            selectedSite = null;
            selectedWait = null;
            return;
        }
        body.classList.add('construction-yards-split');
        if (body.firstChild !== left) body.replaceChildren(left, right);

        let selectedRow = rows.find((r) => siteTarget(r.site) === selectedTarget);
        if (!selectedRow) {
            selectedRow = rows[0];
            selectedTarget = siteTarget(selectedRow.site);
            selectedWait = null;
        }
        selectedSite = selectedRow.site;
        const site = selectedRow.site;

        syncRows(
            siteList,
            siteLines,
            rows,
            (r) => siteTarget(r.site),
            (r) => {
                const line = el('div', 'construction-yards-row construction-yards-site-grid');
                line.append(
                    el('span', 'construction-yards-name'),
                    el('span', 'construction-yards-cell'),
                    el('span', 'construction-yards-cell construction-yards-number'),
                    el('span', 'construction-yards-cell construction-yards-number'),
                    el('span', 'construction-yards-cell construction-yards-number'),
                    el('span', 'construction-yards-cell construction-yards-number'),
                );
                const t = siteTarget(r.site);
                line.addEventListener('click', () => {
                    if (t !== selectedTarget) {
                        selectedTarget = t;
                        selectedWait = null;
                        render();
                    }
                });
                return line;
            },
            (line, r) => {
                const c = line.children as HTMLCollectionOf<HTMLElement>;
                setText(c[0], r.name, true);
                setText(c[1], r.type, true);
                setText(c[2], String(r.yards));
                setText(c[3], String(r.building));
                setText(c[4], String(r.waiting));
                setText(c[5], String(r.speed));
                line.classList.toggle('construction-yards-row-selected', r === selectedRow);
            },
        );

        setText(siteName, selectedRow.name, true);

        // Yards: rebuilt only when the row count changes, text updated in place.
        const yRows = yardRows(site, componentName);
        yardHeader.hidden = yRows.length === 0;
        yardEmpty.hidden = yRows.length !== 0;
        while (yardList.children.length > yRows.length) yardList.lastElementChild!.remove();
        while (yardList.children.length < yRows.length) {
            const line = el('div', 'construction-yards-row construction-yards-static construction-yards-yard-grid');
            line.append(
                el('span', 'construction-yards-cell'),
                el('span', 'construction-yards-name'),
                el('span', 'construction-yards-cell construction-yards-number'),
                el('span', 'construction-yards-cell construction-yards-number'),
            );
            yardList.appendChild(line);
        }
        yRows.forEach((y, i) => {
            const c = yardList.children[i].children as HTMLCollectionOf<HTMLElement>;
            setText(c[0], y.yard, true);
            setText(c[1], y.ship, true);
            setText(c[2], y.ship ? y.progressText : '');
            setText(c[3], String(y.speed));
        });

        // Wait queue.
        const wRows = waitRows(site);
        if (selectedWait !== null && !wRows.some((w) => w.builtObject === selectedWait)) selectedWait = null;
        waitEmpty.hidden = wRows.length !== 0;
        syncRows(
            waitList,
            waitLines,
            wRows,
            (w) => w.builtObject,
            (w) => {
                const line = el('div', 'construction-yards-row construction-yards-wait-grid');
                line.append(
                    el('span', 'construction-yards-name'),
                    el('span', 'construction-yards-cell'),
                    el('span', 'construction-yards-cell construction-yards-number'),
                );
                const bo = w.builtObject;
                line.addEventListener('click', () => {
                    selectedWait = bo;
                    render();
                });
                return line;
            },
            (line, w) => {
                const c = line.children as HTMLCollectionOf<HTMLElement>;
                setText(c[0], w.name, true);
                setText(c[1], w.type, true);
                setText(c[2], w.price);
                line.classList.toggle('construction-yards-row-selected', w.builtObject === selectedWait);
            },
        );
        for (const b of moveButtons) b.disabled = selectedWait === null;
    }

    render();
    // Progress moves while open: refresh every second, keeping both selections.
    const timer = window.setInterval(render, 1000);

    function close(): void {
        window.clearInterval(timer);
        document.removeEventListener('keydown', onKeyDown);
        root.remove();
        open = null;
    }

    // Escape closes the panel; stopImmediatePropagation keeps the global game-menu Escape handler from firing.
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
