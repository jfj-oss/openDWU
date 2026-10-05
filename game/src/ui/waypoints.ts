// Waypoints & Known Locations (an Improvement, ui/improvements.ts id 'waypoints'; not in DW:U): the player's own named
// map pins and the locations the player was told of or found, on the Main View (render/locationMarkers.ts) and in the
// Galaxy Map window (drawGalaxyMapMarkers), with:
// - placing: the main view's right-click menu on empty space ("Add Waypoint here…", ui/orderMenu.ts) or W at the mouse
//   cursor (keyboard.ts, remappable); a small dialog asks for the name;
// - editing: a waypoint's right-click menu (Rename… / Delete) and the Waypoints list panel (Go to / Rename / Delete; the
//   known locations: Go to);
// - toggling: the View popup's "Waypoints & Known Locations" row (MapOverlayState.waypoints, on by default) and its
//   "…" panel (show waypoints / show known locations, UI settings), and Shift+W for the row.
// Every change goes through the journaled player ops addWaypoint / renameWaypoint / deleteWaypoint (sim/player/
// waypoints.ts): applied at the next frame boundary (in worker mode in the worker), saved with the game, replayed from
// the command log. Reading works on the replica.

import './waypoints.css';
import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import type { Camera } from '../render/camera';
import { issuePlayerCommand } from '../sim/player/playerCommands';
import { WAYPOINT_NAME_MAX, defaultWaypointName, sanitizeWaypointName, waypointState, waypoints, type Waypoint } from '../sim/player/waypoints';
import { knownLocationTooltip, knownLocations, type KnownLocation } from '../sim/player/knownLocations';
import type { OrderMenuItem } from '../sim/player/orderMenu';
import { HINT_PULSE_COLOR, KNOWN_LOCATION_COLOR, WAYPOINT_COLOR, labelAllowed, type MapMarker } from '../render/locationMarkers';
import { fogOf } from '../render/fog';
import { resolveStarDateDescription } from '../sim/galaxyTime';
import { isImprovementEnabled } from './improvements';
import { overlayActive, setOverlay, toggleOverlay, type MapOverlayState } from './mapOverlays';
import { getSettings, updateSettings } from './settings';
import { showToast } from './toast';
import { setWaypointKeyHandler } from './keyboard';
import { SECTOR_LEVEL_ZOOM } from './hud';
import type { OverlayOptionPanel } from './overlayOptionPanels';

export const WAYPOINTS_IMPROVEMENT = 'waypoints';

/** What the waypoint UI needs from the running game view (installed by main.ts). */
export interface WaypointUiDeps {
    galaxy: Galaxy;
    /** _Game.PlayerEmpire. */
    empire: Empire;
    camera: Pick<Camera, 'screenToWorld' | 'centerOn' | 'zoomAt' | 'zoom' | 'width' | 'height'>;
    view: {
        markerAt(sx: number, sy: number): MapMarker | null;
        readonly pointerScreen: { x: number; y: number } | null;
        refreshMarkers(): void;
    };
    overlays: MapOverlayState;
    /** Redraw the Galaxy Map window if it is open. */
    redrawGalaxyMap?: () => void;
}

let deps: WaypointUiDeps | null = null;

export function waypointsEnabled(): boolean {
    return isImprovementEnabled(WAYPOINTS_IMPROVEMENT);
}

/** Install the waypoint UI for a game view; returns the teardown. */
export function installWaypointUi(d: WaypointUiDeps): () => void {
    deps = d;
    setWaypointKeyHandler((action) => {
        if (action === 'addWaypoint') addWaypointAtCursor();
        else toggleWaypointsOverlay();
    });
    if (typeof window !== 'undefined') {
        // Dev / screenshot hook (scripts/shot-waypoints.mjs).
        (window as unknown as { __dwuWaypoints?: unknown }).__dwuWaypoints = {
            add: (x: number, y: number, name: string) => issueAdd(x, y, name),
            list: () => waypoints(d.galaxy, d.empire).map((w) => ({ ...w })),
            known: () => knownLocations(d.galaxy, d.empire, fogOf(d.galaxy).reveal).map((k) => ({ kind: k.kind, key: k.key, name: k.name, subject: k.subject, source: k.source, x: k.x, y: k.y })),
            openList: () => openWaypointsList(),
            dismiss: (key: string, v = true) => issuePlayerCommand(d.galaxy, d.empire, 'dismissMarker', [key, v], () => changed()),
        };
    }
    return () => {
        setWaypointKeyHandler(null);
        closeWaypointsList();
        closeNameDialog();
        if (typeof window !== 'undefined') delete (window as unknown as { __dwuWaypoints?: unknown }).__dwuWaypoints;
        if (deps === d) deps = null;
    };
}

/** After a waypoint command: redraw the markers, the list and the Galaxy Map. */
function changed(): void {
    deps?.view.refreshMarkers();
    deps?.redrawGalaxyMap?.();
    refreshList?.(true);
}

/** Make the player's waypoints visible (a new one was just placed). */
function showWaypoints(): void {
    if (deps === null) return;
    setOverlay(deps.overlays, 'waypoints', true);
    if (!getSettings().waypointsShowPlayer) updateSettings({ waypointsShowPlayer: true });
}

function issueAdd(x: number, y: number, name: string): void {
    if (deps === null) return;
    const clean = sanitizeWaypointName(name);
    issuePlayerCommand(deps.galaxy, deps.empire, 'addWaypoint', [Math.trunc(x), Math.trunc(y), clean], (id) => {
        if (id > 0) {
            showWaypoints();
            changed();
            showToast(`Waypoint added: ${waypointLabel(id) ?? clean}`);
        } else showToast('Waypoint not added');
    });
}

function waypointLabel(id: number): string | null {
    return deps === null ? null : (waypointState(deps.galaxy)?.list.find((w) => w.id === id)?.name ?? null);
}

/** "Add Waypoint here…": ask for the name, then place it at world (x, y). */
export function promptAddWaypointAt(x: number, y: number): void {
    if (deps === null || !waypointsEnabled()) return;
    const galaxy = deps.galaxy;
    void askName('Add Waypoint', defaultWaypointName(galaxy), 'Add').then((name) => {
        if (name !== null) issueAdd(x, y, name);
    });
}

/** W: a waypoint at the mouse cursor (the view centre when the pointer is not over the map). */
export function addWaypointAtCursor(): void {
    if (deps === null || !waypointsEnabled()) return;
    const cam = deps.camera;
    const p = deps.view.pointerScreen ?? { x: cam.width / 2, y: cam.height / 2 };
    const w = cam.screenToWorld(p.x, p.y);
    promptAddWaypointAt(w.x, w.y);
}

export function promptRenameWaypoint(w: Waypoint): void {
    if (deps === null) return;
    const { galaxy, empire } = deps;
    void askName('Rename Waypoint', w.name, 'Rename').then((name) => {
        if (name === null) return;
        const clean = sanitizeWaypointName(name);
        if (clean === '' || clean === w.name) return;
        issuePlayerCommand(galaxy, empire, 'renameWaypoint', [w.id, clean], (ok) => {
            if (ok) changed();
            else showToast('Waypoint not renamed');
        });
    });
}

export function removeWaypoint(w: Waypoint): void {
    if (deps === null) return;
    issuePlayerCommand(deps.galaxy, deps.empire, 'deleteWaypoint', [w.id], (ok) => {
        if (ok) {
            changed();
            showToast(`Waypoint deleted: ${w.name}`);
        }
    });
}

/** Centre the Main View on (x, y), zooming in to Sector level when further out. */
export function goToLocation(x: number, y: number): void {
    if (deps === null) return;
    const cam = deps.camera;
    cam.centerOn(x, y);
    if (cam.zoom < SECTOR_LEVEL_ZOOM) cam.zoomAt(SECTOR_LEVEL_ZOOM, cam.width / 2, cam.height / 2);
}

/** Shift+W: the View popup's row. */
export function toggleWaypointsOverlay(): void {
    if (deps === null || !waypointsEnabled()) return;
    toggleOverlay(deps.overlays, 'waypoints');
    showToast(`Waypoints & Known Locations: ${deps.overlays.waypoints ? 'shown' : 'hidden'}`);
    deps.redrawGalaxyMap?.();
}

// ---------------------------------------------------------------------------------------------------------------
// Right-click menu (ui/orderMenu.ts)
// ---------------------------------------------------------------------------------------------------------------

function menuItem(label: string, hint: string | null = null): OrderMenuItem {
    return { key: label, label, hint, enabled: true, action: null, children: [], separator: false, custom: true };
}

/** The waypoint marker under screen (sx, sy) of the main view (the overlay shown), or null. */
export function waypointAtScreen(sx: number, sy: number): Waypoint | null {
    if (deps === null || !waypointsEnabled()) return null;
    return deps.view.markerAt(sx, sy)?.waypoint ?? null;
}

/** The menu entries for the marker under screen (sx, sy): a waypoint's, or "Dismiss marker" for a hint / known location. */
export function markerMenuAtScreen(sx: number, sy: number): { items: OrderMenuItem[]; pick(item: OrderMenuItem): boolean } | null {
    if (deps === null || !waypointsEnabled()) return null;
    const m = deps.view.markerAt(sx, sy);
    if (m === null) return null;
    if (m.waypoint !== null) return waypointMenu(m.waypoint);
    if (m.known === null) return null;
    const k = m.known;
    const item = menuItem(`Dismiss marker "${k.name}"`, 'Hide it from the map (restore it in the Waypoints list)');
    return {
        items: [item],
        pick: (it) => {
            if (it !== item) return false;
            setDismissed(k, true);
            return true;
        },
    };
}

/** Dismiss / restore a hint or known-location marker (journaled dismissMarker; our overlay only). */
export function setDismissed(k: KnownLocation, dismiss: boolean): void {
    if (deps === null) return;
    issuePlayerCommand(deps.galaxy, deps.empire, 'dismissMarker', [k.key, dismiss], (ok) => {
        if (ok) {
            changed();
            showToast(`${dismiss ? 'Marker dismissed' : 'Marker restored'}: ${k.name}`);
        }
    });
}

/** A waypoint's own menu entries (Rename… / Delete) and what picking one does. */
export function waypointMenu(w: Waypoint): { items: OrderMenuItem[]; pick(item: OrderMenuItem): boolean } {
    const rename = menuItem(`Rename Waypoint "${w.name}"…`);
    const del = menuItem(`Delete Waypoint "${w.name}"`);
    return {
        items: [rename, del],
        pick: (item) => {
            if (item === rename) promptRenameWaypoint(w);
            else if (item === del) removeWaypoint(w);
            else return false;
            return true;
        },
    };
}

/** "Add Waypoint here…" for a right-click on empty space at world (x, y) (null while the improvement is off). */
export function addWaypointMenu(x: number, y: number): { item: OrderMenuItem; pick(item: OrderMenuItem): boolean } | null {
    if (deps === null || !waypointsEnabled()) return null;
    const item = menuItem('Add Waypoint here…', 'Put a named pin on the map here (W at the cursor)');
    return {
        item,
        pick: (it) => {
            if (it !== item) return false;
            promptAddWaypointAt(x, y);
            return true;
        },
    };
}

// ---------------------------------------------------------------------------------------------------------------
// The name dialog
// ---------------------------------------------------------------------------------------------------------------

let closeDialog: (() => void) | null = null;

function closeNameDialog(): void {
    closeDialog?.();
}

/** A small modal asking for a waypoint name (Enter = OK, Escape = cancel); resolves the text or null. */
export function askName(title: string, initial: string, okText: string): Promise<string | null> {
    closeNameDialog();
    return new Promise((resolve) => {
        const wrap = document.createElement('div');
        wrap.className = 'order-confirm-wrap waypoint-name-wrap';
        const win = document.createElement('div');
        win.className = 'order-confirm-window waypoint-name-window';
        const head = document.createElement('div');
        head.className = 'order-confirm-title';
        head.textContent = title;
        const body = document.createElement('div');
        body.className = 'order-confirm-text';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'waypoint-name-input';
        input.maxLength = WAYPOINT_NAME_MAX;
        input.value = initial;
        input.spellcheck = false;
        body.appendChild(input);
        const buttons = document.createElement('div');
        buttons.className = 'order-confirm-buttons';
        let done = false;
        const finish = (v: string | null): void => {
            if (done) return;
            done = true;
            closeDialog = null;
            document.removeEventListener('keydown', onKey, true);
            wrap.remove();
            resolve(v);
        };
        const mk = (text: string, v: () => string | null): HTMLButtonElement => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'order-confirm-button';
            b.textContent = text;
            b.addEventListener('click', () => finish(v()));
            buttons.appendChild(b);
            return b;
        };
        mk('Cancel', () => null);
        mk(okText, () => input.value);
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
                finish(null);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                e.stopImmediatePropagation();
                finish(input.value);
            }
        };
        document.addEventListener('keydown', onKey, true);
        wrap.addEventListener('mousedown', (e) => {
            if (e.target === wrap) finish(null);
        });
        win.append(head, body, buttons);
        wrap.appendChild(win);
        document.body.appendChild(wrap);
        closeDialog = () => finish(null);
        input.focus();
        input.select();
    });
}

// ---------------------------------------------------------------------------------------------------------------
// The View popup row's "…" panel (hud.ts)
// ---------------------------------------------------------------------------------------------------------------

/** Show waypoints / show known locations (UI settings) and the Waypoints list. */
export function waypointsOptionsPanel(): OverlayOptionPanel {
    const wrap = document.createElement('div');
    wrap.className = 'hud-option-panel';
    wrap.dataset.panel = 'waypoints';
    const box = (text: string, get: () => boolean, set: (v: boolean) => void): HTMLInputElement => {
        const lbl = document.createElement('label');
        lbl.className = 'hud-option-panel-label';
        const b = document.createElement('input');
        b.type = 'checkbox';
        b.checked = get();
        b.addEventListener('change', () => {
            set(b.checked);
            deps?.redrawGalaxyMap?.();
        });
        lbl.append(b, document.createTextNode(` ${text}`));
        wrap.appendChild(lbl);
        return b;
    };
    const w = box('Show waypoints', () => getSettings().waypointsShowPlayer, (v) => updateSettings({ waypointsShowPlayer: v }));
    const k = box('Show known locations', () => getSettings().waypointsShowKnown, (v) => updateSettings({ waypointsShowKnown: v }));
    w.dataset.option = 'waypointsShowPlayer';
    k.dataset.option = 'waypointsShowKnown';
    const list = document.createElement('button');
    list.type = 'button';
    list.className = 'hud-option-panel-button';
    list.textContent = 'Waypoints list…';
    list.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleWaypointsList();
    });
    wrap.appendChild(list);
    const note = document.createElement('div');
    note.className = 'hud-option-panel-note';
    note.textContent = 'Right-click empty space or press W to add a waypoint; Shift+W shows / hides this overlay. Violet: location hints; amber: known locations.';
    wrap.appendChild(note);
    return {
        element: wrap,
        refresh: () => {
            w.checked = getSettings().waypointsShowPlayer;
            k.checked = getSettings().waypointsShowKnown;
        },
    };
}

// ---------------------------------------------------------------------------------------------------------------
// The Waypoints list panel
// ---------------------------------------------------------------------------------------------------------------

let listEl: HTMLElement | null = null;
let listTimer: number | undefined;
let refreshList: ((force?: boolean) => void) | null = null;

export function isWaypointsListOpen(): boolean {
    return listEl !== null;
}

export function closeWaypointsList(): void {
    if (listTimer !== undefined) clearInterval(listTimer);
    listTimer = undefined;
    listEl?.remove();
    listEl = null;
    refreshList = null;
}

export function toggleWaypointsList(): void {
    if (listEl !== null) closeWaypointsList();
    else openWaypointsList();
}

/** The rows the list shows (pure; tests): the player's waypoints, then the known locations. */
export function waypointListRows(galaxy: Galaxy, empire: Empire, reveal = false, showDismissed = false): { waypoints: Waypoint[]; known: KnownLocation[] } {
    return { waypoints: [...waypoints(galaxy, empire)], known: knownLocations(galaxy, empire, reveal, showDismissed) };
}

export function openWaypointsList(): void {
    if (deps === null || typeof document === 'undefined') return;
    closeWaypointsList();
    const d = deps;
    const root = document.createElement('div');
    root.className = 'hud-panel waypoints-panel';
    root.dataset.panel = 'waypointsList';
    const head = document.createElement('div');
    head.className = 'hud-section-head waypoints-head';
    head.textContent = 'Waypoints';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'hud-btn hud-btn-glyph waypoints-close';
    close.title = 'Close';
    close.textContent = '✕';
    close.addEventListener('click', () => closeWaypointsList());
    const body = document.createElement('div');
    body.className = 'waypoints-body';
    const dlbl = document.createElement('label');
    dlbl.className = 'waypoints-dismissed-toggle';
    const dbox = document.createElement('input');
    dbox.type = 'checkbox';
    dbox.dataset.option = 'showDismissed';
    dbox.addEventListener('change', () => render(true));
    dlbl.append(dbox, document.createTextNode(' Show dismissed'));
    root.append(head, close, dlbl, body);
    document.body.appendChild(root);
    listEl = root;
    let sig = '';
    const btn = (text: string, title: string, fn: () => void): HTMLButtonElement => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'waypoints-btn';
        b.textContent = text;
        b.title = title;
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            fn();
        });
        return b;
    };
    const render = (force = false): void => {
        const rows = waypointListRows(d.galaxy, d.empire, fogOf(d.galaxy).reveal, dbox.checked);
        const s = rows.waypoints.map((w) => `${w.id}:${w.name}`).join(';') + '|' + rows.known.map((k) => k.key + k.name + (k.subject ?? '') + (k.source ?? '') + (k.dismissed === true ? '!' : '')).join(';');
        if (!force && s === sig) return;
        sig = s;
        body.replaceChildren();
        const sec = (t: string): void => {
            const h = document.createElement('div');
            h.className = 'waypoints-sec';
            h.textContent = t;
            body.appendChild(h);
        };
        sec(`Your waypoints (${rows.waypoints.length})`);
        if (rows.waypoints.length === 0) {
            const e = document.createElement('div');
            e.className = 'waypoints-empty';
            e.textContent = 'None yet: right-click empty space on the map, or press W at the cursor.';
            body.appendChild(e);
        }
        for (const w of rows.waypoints) {
            const row = document.createElement('div');
            row.className = 'waypoints-row';
            row.dataset.waypoint = String(w.id);
            const name = document.createElement('span');
            name.className = 'waypoints-name waypoints-name-own';
            name.textContent = w.name;
            name.title = `Placed ${resolveStarDateDescription(w.starDate)} — double-click to go there`;
            name.addEventListener('dblclick', () => goToLocation(w.x, w.y));
            row.append(name, btn('Go to', 'Centre the map on it', () => goToLocation(w.x, w.y)), btn('Rename', 'Rename it', () => promptRenameWaypoint(w)), btn('Delete', 'Delete it', () => removeWaypoint(w)));
            body.appendChild(row);
        }
        sec(`Known locations (${rows.known.length})`);
        if (rows.known.length === 0) {
            const e = document.createElement('div');
            e.className = 'waypoints-empty';
            e.textContent = 'None yet: hints from diplomacy, pirates or story clues, and the special places your ships find, appear here.';
            body.appendChild(e);
        }
        for (const k of rows.known) {
            const row = document.createElement('div');
            row.className = 'waypoints-row';
            row.dataset.marker = k.key;
            if (k.dismissed === true) row.classList.add('waypoints-row-dismissed');
            const name = document.createElement('span');
            name.className = `waypoints-name waypoints-name-${k.kind}`;
            name.textContent = k.kind === 'hint' ? `? ${k.name}` : k.name;
            name.title = knownLocationTooltip(d.galaxy, d.empire, k);
            name.addEventListener('dblclick', () => goToLocation(k.x, k.y));
            const kind = document.createElement('span');
            kind.className = 'waypoints-kind';
            kind.textContent = k.kind === 'hint' && k.subject !== undefined ? `${k.typeLabel}: ${k.subject}${k.source !== undefined ? ` \u2014 ${k.source}` : ''}` : k.typeLabel;
            row.append(name, kind, btn('Go to', 'Centre the map on it', () => goToLocation(k.x, k.y)));
            if (k.dismissed === true) row.append(btn('Restore', 'Show its marker on the map again', () => setDismissed(k, false)));
            else row.append(btn('Dismiss', 'Hide its marker from the map', () => setDismissed(k, true)));
            body.appendChild(row);
        }
    };
    refreshList = render;
    render(true);
    listTimer = window.setInterval(() => render(), 1000);
}

// ---------------------------------------------------------------------------------------------------------------
// The Galaxy Map window (screens/galaxyMap.ts)
// ---------------------------------------------------------------------------------------------------------------

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/**
 * Draw the overlay's markers on the Galaxy Map's canvas (`s` = galaxy units per map pixel, GalaxyMap.cs double_5),
 * while the overlay row is on, as the Main View shows them: waypoints (pennants), known locations (diamonds), hints
 * (violet rings); labels with the same greedy clutter rule at half the spacing (the map is small).
 */
export function drawGalaxyMapMarkers(ctx: CanvasRenderingContext2D, galaxy: Galaxy, s: number): void {
    const d = deps;
    if (d === null || d.galaxy !== galaxy || !overlayActive(d.overlays, 'waypoints')) return;
    const st = getSettings();
    const player = galaxy.playerEmpire;
    if (player === null) return;
    const kept: number[] = [];
    ctx.save();
    ctx.font = '10px "Forgotten Futurist", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.lineJoin = 'round';
    const label = (text: string, x: number, y: number, color: string): void => {
        if (!labelAllowed(kept, x, y, 40)) return;
        kept.push(x, y);
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.strokeText(text, x, y);
        ctx.fillStyle = color;
        ctx.fillText(text, x, y);
    };
    if (st.waypointsShowPlayer) {
        for (const w of waypoints(galaxy, player)) {
            const x = Math.round(w.x / s) + 0.5;
            const y = Math.round(w.y / s) + 0.5;
            ctx.strokeStyle = hex(WAYPOINT_COLOR);
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x, y - 11);
            ctx.stroke();
            ctx.fillStyle = hex(WAYPOINT_COLOR);
            ctx.beginPath();
            ctx.moveTo(x, y - 11);
            ctx.lineTo(x + 7, y - 8.5);
            ctx.lineTo(x, y - 6);
            ctx.closePath();
            ctx.fill();
            label(w.name, x + 8, y - 8, '#c8f4ff');
        }
    }
    if (st.waypointsShowKnown) {
        for (const k of knownLocations(galaxy, player, fogOf(galaxy).reveal)) {
            const x = Math.round(k.x / s) + 0.5;
            const y = Math.round(k.y / s) + 0.5;
            if (k.kind === 'hint') {
                ctx.strokeStyle = hex(HINT_PULSE_COLOR);
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(x, y, 5, 0, Math.PI * 2);
                ctx.stroke();
                if (k.location === null) label(`? ${k.name}`, x + 7, y, '#c4b8ff');
            } else {
                ctx.strokeStyle = hex(KNOWN_LOCATION_COLOR);
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(x, y - 4);
                ctx.lineTo(x + 4, y);
                ctx.lineTo(x, y + 4);
                ctx.lineTo(x - 4, y);
                ctx.closePath();
                ctx.stroke();
                label(k.name, x + 7, y, '#ffe0a8');
            }
        }
    }
    ctx.restore();
}
