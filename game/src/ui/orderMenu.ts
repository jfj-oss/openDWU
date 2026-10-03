// 17c — the right-click order menu (the original's actionMenu ContextMenuStrip, Main.Part8.cs 1332
// actionMenu_Opening + 3202 method_344) as a DOM popup: positioned at the cursor, submenus on hover, keyboard
// navigable (Up/Down/Left/Right/Enter, Escape closes). The entries are the OrderMenuItem tree the sim-side builder
// (src/sim/player/orderMenu.ts) returns; this file only draws it and reports the picked entry.
// Also the small automation confirm dialog (GenerateAutomationMessageBox) used after an order.
import './orderMenu.css';
import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import type { GalaxyTime } from '../sim/galaxyTime';
import { BuiltObject } from '../sim/builtObject';
import { Habitat } from '../sim/types';
import { ShipGroup } from '../sim/fleets/shipGroup';
import { BuiltObjectMissionType } from '../sim/missions/mission';
import { BuiltObjectRole } from '../sim/data/designSpecifications';
import { FleetPosture } from '../sim/diplomacyTick';
import { resolveGameText, tryGetText } from '../sim/textResolver';
import { ShipAction, ShipActionType, isSystemInfo } from '../sim/player/shipAction';
import { playAttackClick, playOrderSting } from '../audio/gameAudio'; // [audio]
import { type ShipActionMouseHoverMode, type ShipActionResult, type ShipActionSelection } from '../sim/player/executeShipAction';
import { issuePlayerCommand } from '../sim/player/playerCommands';
import type { RightClickResult } from '../sim/player/orderMenu';
import {
    orderSubject,
    resolveHoverOrder,
    rightClickCentersView,
    rightClickOrder,
    selectionAfterClick,
    selectionButtons,
    selectionButtonsDrawRandom,
    selectionRefreshPage,
    type OrderMenuItem,
    type SelectionButton,
} from '../sim/player/orderMenu';
import { showToast } from './toast';
import { saveAutomationResponse, savedAutomationResponse } from './settings'; // [gameoptions]
import { wreckSalvageMenuItem } from './scenario/wreckageUi'; // [wreckage]

export interface OrderMenuHandlers {
    /** An enabled entry with an action (or an idle-ship entry) was clicked; `shift` = Shift held (queue the order). */
    onPick: (item: OrderMenuItem, shift: boolean) => void;
    /** The menu closed (pick, Escape, click outside). */
    onClose?: () => void;
}

interface OpenMenu {
    root: HTMLElement;
    panels: HTMLElement[];
    onKey: (e: KeyboardEvent) => void;
    onDown: (e: MouseEvent) => void;
    onBlur: () => void;
    handlers: OrderMenuHandlers;
}

let open: OpenMenu | null = null;

/** True while the order menu is shown. */
export function isOrderMenuOpen(): boolean {
    return open !== null;
}

/** Close the order menu (no-op when closed). Removes every listener it added. */
export function closeOrderMenu(): void {
    const m = open;
    if (m === null) return;
    open = null;
    document.removeEventListener('keydown', m.onKey, true);
    document.removeEventListener('mousedown', m.onDown, true);
    window.removeEventListener('blur', m.onBlur);
    m.root.remove();
    m.handlers.onClose?.();
}

/** Show `items` as a context menu with its top-left corner at the client point (flipped to stay on screen). */
export function openOrderMenu(items: OrderMenuItem[], clientX: number, clientY: number, handlers: OrderMenuHandlers): void {
    closeOrderMenu();
    if (items.length === 0) return;
    const root = document.createElement('div');
    root.className = 'order-menu-root';
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    document.body.appendChild(root);
    const state: OpenMenu = {
        root,
        panels: [],
        handlers,
        onKey: (e) => onKey(e),
        onDown: (e) => {
            if (!root.contains(e.target as Node)) closeOrderMenu();
        },
        onBlur: () => closeOrderMenu(),
    };
    open = state;

    /** Open the panel for `list` at depth `level` next to `anchor` (null = at the cursor). */
    const showPanel = (list: OrderMenuItem[], level: number, anchor: HTMLElement | null): void => {
        while (state.panels.length > level) state.panels.pop()!.remove();
        const panel = document.createElement('div');
        panel.className = 'order-menu-panel';
        panel.setAttribute('role', 'menu');
        for (const item of list) {
            if (item.separator) {
                const sep = document.createElement('div');
                sep.className = 'order-menu-sep';
                panel.appendChild(sep);
                continue;
            }
            const row = document.createElement('div');
            row.className = 'order-menu-item';
            row.setAttribute('role', 'menuitem');
            row.tabIndex = -1;
            const text = document.createElement('span');
            text.className = 'order-menu-label';
            text.textContent = item.label;
            row.appendChild(text);
            if (item.children.length > 0) {
                const arrow = document.createElement('span');
                arrow.className = 'order-menu-arrow';
                arrow.textContent = '›';
                row.appendChild(arrow);
            }
            if (!item.enabled) row.classList.add('order-menu-disabled');
            if (item.hint) row.title = item.hint;
            const activate = (shift: boolean): void => {
                if (!item.enabled) return;
                if (item.children.length > 0) {
                    showPanel(item.children, level + 1, row);
                    focusFirst(level + 1);
                    return;
                }
                if (item.action === null && item.select === undefined) return;
                const h = state.handlers;
                closeOrderMenu();
                h.onPick(item, shift);
            };
            row.addEventListener('mouseenter', () => {
                setActive(panel, row);
                if (item.children.length > 0 && item.enabled) showPanel(item.children, level + 1, row);
                else while (state.panels.length > level + 1) state.panels.pop()!.remove();
            });
            row.addEventListener('click', (e) => {
                e.stopPropagation();
                activate(e.shiftKey);
            });
            (row as HTMLElement & { activate?: (shift: boolean) => void }).activate = activate;
            panel.appendChild(row);
        }
        root.appendChild(panel);
        state.panels.push(panel);
        // Position: at the cursor for the top level, beside the anchor row for submenus; keep on screen.
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const r = panel.getBoundingClientRect();
        let x: number;
        let y: number;
        if (anchor === null) {
            x = clientX;
            y = clientY;
            if (x + r.width > vw) x = Math.max(0, clientX - r.width);
            if (y + r.height > vh) y = Math.max(0, vh - r.height);
        } else {
            const a = anchor.getBoundingClientRect();
            x = a.right - 2;
            y = a.top - 4;
            if (x + r.width > vw) x = Math.max(0, a.left - r.width + 2);
            if (y + r.height > vh) y = Math.max(0, vh - r.height);
        }
        panel.style.left = `${x}px`;
        panel.style.top = `${y}px`;
    };

    const rowsOf = (panel: HTMLElement): HTMLElement[] => Array.from(panel.querySelectorAll<HTMLElement>('.order-menu-item'));
    const setActive = (panel: HTMLElement, row: HTMLElement | null): void => {
        for (const r of rowsOf(panel)) r.classList.toggle('order-menu-active', r === row);
        row?.focus({ preventScroll: true });
    };
    const focusFirst = (level: number): void => {
        const panel = state.panels[level];
        if (panel) setActive(panel, rowsOf(panel)[0] ?? null);
    };
    const onKey = (e: KeyboardEvent): void => {
        const level = state.panels.length - 1;
        const panel = state.panels[level];
        const rows = rowsOf(panel);
        const cur = rows.findIndex((r) => r.classList.contains('order-menu-active'));
        switch (e.key) {
            case 'Escape':
                if (level > 0) {
                    state.panels.pop()!.remove();
                } else {
                    closeOrderMenu();
                }
                break;
            case 'ArrowDown':
                setActive(panel, rows[(cur + 1) % rows.length] ?? null);
                break;
            case 'ArrowUp':
                setActive(panel, rows[(cur - 1 + rows.length) % rows.length] ?? null);
                break;
            case 'ArrowLeft':
                if (level > 0) state.panels.pop()!.remove();
                break;
            case 'ArrowRight':
            case 'Enter': {
                const row = rows[cur] as (HTMLElement & { activate?: (shift: boolean) => void }) | undefined;
                if (row?.activate) row.activate(e.shiftKey);
                break;
            }
            default:
                return; // let other keys through
        }
        e.preventDefault();
        e.stopImmediatePropagation();
    };
    document.addEventListener('keydown', state.onKey, true);
    document.addEventListener('mousedown', state.onDown, true);
    window.addEventListener('blur', state.onBlur);
    showPanel(items, 0, null);
}

/**
 * GenerateAutomationMessageBox(task) (Main.Part7.cs, e.g. 350-359): "This task is automated: turn it off?" with
 * the original's two buttons. Resolves true for "Turn off automation", false for "Leave on" (also Escape).
 */
export function confirmAutomationOff(taskText: string): Promise<boolean> {
    // [gameoptions] MessageBoxEx.UseSavedResponse: a "Don't ask me again" answer is reused without asking (reset by
    // Game Options → Reset Warnings, Main.Part5.cs:2051).
    const saved = savedAutomationResponse(taskText);
    if (saved !== null) return Promise.resolve(saved);
    return new Promise((resolve) => {
        const wrap = document.createElement('div');
        wrap.className = 'order-confirm-wrap';
        const win = document.createElement('div');
        win.className = 'order-confirm-window';
        const title = document.createElement('div');
        title.className = 'order-confirm-title';
        title.textContent = 'Automation';
        const body = document.createElement('div');
        body.className = 'order-confirm-text';
        body.textContent = `${taskText} is automated. Turn off automation so your order is not overridden?`;
        const buttons = document.createElement('div');
        buttons.className = 'order-confirm-buttons';
        // [gameoptions] AllowSaveResponse / SaveResponseText "Don't ask me again" (Main.Part12.cs:4463-4464).
        const remember = document.createElement('label');
        remember.className = 'order-confirm-remember';
        const rememberBox = document.createElement('input');
        rememberBox.type = 'checkbox';
        remember.append(rememberBox, document.createTextNode(" Don't ask me again"));
        const finish = (v: boolean): void => {
            document.removeEventListener('keydown', onKey, true);
            wrap.remove();
            if (rememberBox.checked) saveAutomationResponse(taskText, v);
            resolve(v);
        };
        const mk = (text: string, v: boolean): HTMLButtonElement => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'order-confirm-button';
            b.textContent = text;
            b.addEventListener('click', () => finish(v));
            buttons.appendChild(b);
            return b;
        };
        mk('Leave on', false);
        const off = mk('Turn off automation', true);
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
                finish(false);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                e.stopImmediatePropagation();
                finish(true);
            }
        };
        document.addEventListener('keydown', onKey, true);
        win.append(title, body, remember, buttons);
        wrap.appendChild(win);
        document.body.appendChild(wrap);
        off.focus();
    });
}

// ---------------------------------------------------------------------------------------------------------------
// The order layer: executing a picked ShipAction (Main.Part7.cs 1846 actionMenu_ItemClicked → method_347) and
// applying its UI effects, the main view's right click (Main.Part10.cs 3049 / Main.Part8.cs 1332) and the selection
// panel's eight action buttons (Main.Part3.cs 1120-3805).
// ---------------------------------------------------------------------------------------------------------------

/** What the order layer needs from the running game view (installed by main.ts). */
export interface OrderUiDeps {
    galaxy: Galaxy;
    /** _Game.PlayerEmpire. */
    empire: Empire;
    clock?: GalaxyTime;
    /** _Game.SelectedObject. */
    getSelected: () => ShipActionSelection;
    /** method_208: select an object (null clears the selection). */
    select: (target: ShipActionSelection) => void;
}

/** The subset of MainView the order layer drives (kept structural so tests / other views can supply it). */
export interface OrderMainView {
    readonly zoomFactor: number;
    pickOrderTarget(sx: number, sy: number): unknown;
    onRightClick?: (sx: number, sy: number, e: MouseEvent) => void;
    onLeftClickIntercept?: (sx: number, sy: number) => boolean;
    onPointerRest?: (sx: number, sy: number, clientX: number, clientY: number) => void;
}
export interface OrderCamera {
    screenToWorld(sx: number, sy: number): { x: number; y: number };
    centerOn(x: number, y: number): void;
}

// [fix6ui] begin — N5: default orders at Sector / Galaxy zoom.
/**
 * The object the hover hint / default right-click order is resolved for. At Sector and Galaxy zoom the pick
 * (Main.Part11.cs 1341 method_145, ported as MainView.pickOrderTarget) returns the SystemInfo; resolveHoverOrder
 * (Main.Part10.cs 248-697 mainView_MouseMove) has cases for null / Habitat / BuiltObject / Creature only, so the
 * system resolves as its star (SystemInfo.SystemStar), the same target the pick returns at System zoom. The C#
 * mouse-move has no SystemInfo case (its default order is empty there); this is the playtest 2026-09-25-b N5
 * change so Move / Explore / Patrol work at every zoom. The Ctrl / action menu still gets the SystemInfo pick.
 */
export function hoverOrderTarget(target: unknown): unknown {
    return isSystemInfo(target) ? target.systemStar : target;
}
// [fix6ui] end

let deps: OrderUiDeps | null = null;
/** mouseHoverMode_0 after SetFleetAttackPoint / SetFleetHomeBase: the next map click picks the point. */
let fleetPointMode: { mode: ShipActionMouseHoverMode; fleet: ShipGroup } | null = null;
let statusEl: HTMLElement | null = null;
let bar: SelectionBar | null = null;

function T(key: string): string {
    return tryGetText(key) ?? key;
}

/** Install the order layer for a game view; returns the teardown. */
export function installOrderUi(d: OrderUiDeps, view: OrderMainView, camera: OrderCamera): () => void {
    deps = d;
    fleetPointMode = null;
    statusEl = document.createElement('div');
    statusEl.className = 'order-status';
    statusEl.hidden = true;
    document.body.appendChild(statusEl);

    // The action menu is built by the journaled 'actionMenu' command (playerOps.ts): building it draws galaxy.rnd and
    // reviews the latest designs, as the C# does, so it runs in the game at the next frame boundary (in-thread within a
    // frame; in worker mode in the worker, one round trip later) and replays from the log (docs/sim-worker.md §8). A
    // reply for an older right-click is dropped.
    let rightClickSeq = 0;
    view.onRightClick = (sx, sy, e) => {
        if (deps === null) return;
        const { galaxy, empire } = deps;
        const seq = ++rightClickSeq;
        const current = (): boolean => seq === rightClickSeq && deps !== null;
        fleetPointMode = null; // mouseHoverMode_0 = Undefined after any click
        const w = camera.screenToWorld(sx, sy);
        const x = Math.trunc(w.x);
        const y = Math.trunc(w.y);
        const selected = deps.getSelected();
        const target = view.pickOrderTarget(sx, sy);
        const hover = resolveHoverOrder({ galaxy, empire, selected, x, y, target: hoverOrderTarget(target) /* [fix6ui] N5 */, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey });
        const keys = { ctrl: e.ctrlKey, alt: e.altKey };
        // [wreckage] begin — scenario 19e-7: a construction / mining ship right-clicking a known debris field gets
        // "Salvage <field>" on top of the full action menu (the default order is not given on that click).
        const salvage = wreckSalvageMenuItem(galaxy, empire, selected, w.x, w.y, 1 / view.zoomFactor);
        if (salvage !== null) {
            issuePlayerCommand(galaxy, empire, 'actionMenu', [selected, x, y, view.zoomFactor, target, hover.action, true], (menu) => {
                if (!current()) return;
                const rest = menu ?? [];
                const sep: OrderMenuItem = { key: '', label: '', hint: null, enabled: false, action: null, children: [], separator: true };
                openOrderMenu(rest.length > 0 ? [salvage.item, sep, ...rest] : [salvage.item], e.clientX, e.clientY, {
                    onPick: (item, shift) => {
                        if (item === salvage.item) {
                            issuePlayerCommand(galaxy, empire, 'salvageWreckField', [salvage.ship, salvage.field.id], (ok) => {
                                if (!ok) showToast('Salvage not possible');
                                bar?.render(true);
                            });
                            return;
                        }
                        if (item.action === null) return;
                        if (shift) item.action.isSubsequentAction = true;
                        void performAction(item.action, true, { x, y });
                    },
                });
            });
            return;
        }
        // [wreckage] end
        const subject = orderSubject(empire, selected);
        // Command log: the order branch changes the sim, so it is queued (applied at the next frame boundary); the
        // other outcomes (idle-ships picker, centre the view) only read it and stay immediate.
        const r = !keys.ctrl && hover.action !== null && (subject.ship !== null || subject.fleet !== null)
            ? ({ kind: 'order', executed: true, attackClick: false } as const)
            : rightClickOrder(galaxy, empire, selected, hover.action, keys, view.zoomFactor);
        if (r.kind === 'order') {
            issuePlayerCommand(galaxy, empire, 'rightClickOrder', [selected, hover.action!, keys, view.zoomFactor], (r: RightClickResult) => {
                // [audio] begin — Main.Part10.cs:3401 / 3539 method_0(ResolveAttackClick()) for an attack / bombard order.
                if (r.kind === 'order' && r.attackClick) playAttackClick();
                // [audio] end
                bar?.render(true);
            });
        } else if (r.kind === 'idleShips') {
            openOrderMenu(r.items, e.clientX, e.clientY, { onPick: (item) => item.select !== undefined && deps?.select(item.select) });
            return;
        }
        // actionMenu_Opening: the ContextMenuStrip opens on the same click unless the default order was given.
        issuePlayerCommand(galaxy, empire, 'actionMenu', [selected, x, y, view.zoomFactor, target, hover.action, e.ctrlKey], (items) => {
            if (!current()) return;
            // Main.Part10.cs 3310-3559 re-centres on the click when something is selected and there is no default order; here the
            // view stays put whenever the menu opens on that click (it opens at the cursor over what was clicked).
            if (rightClickCentersView(r, items)) camera.centerOn(w.x, w.y);
            if (items !== null && items.length > 0) {
                openOrderMenu(items, e.clientX, e.clientY, {
                    onPick: (item, shift) => {
                        if (item.action === null) return;
                        if (shift) item.action.isSubsequentAction = true; // queue after the current mission
                        void performAction(item.action, true, { x, y });
                    },
                });
            }
        });
    };
    view.onLeftClickIntercept = (sx, sy) => {
        if (deps === null || fleetPointMode === null) return false;
        const { mode, fleet } = fleetPointMode;
        fleetPointMode = null;
        const target = view.pickOrderTarget(sx, sy);
        issuePlayerCommand(deps.galaxy, deps.empire, 'fleetPoint', [fleet, mode, target], () => bar?.render(true));
        return true;
    };
    view.onPointerRest = (sx, sy, clientX, clientY) => {
        if (deps === null || statusEl === null) return;
        if (isOrderMenuOpen()) {
            statusEl.hidden = true;
            return;
        }
        void clientX;
        void clientY;
        if (fleetPointMode !== null) {
            statusEl.textContent = fleetPointMode.mode === 'SetFleetAttackPoint' ? T('Set Attack Target') : T('Set Home Base');
            statusEl.hidden = false;
            return;
        }
        const w = camera.screenToWorld(sx, sy);
        const hover = resolveHoverOrder({
            galaxy: deps.galaxy,
            empire: deps.empire,
            selected: deps.getSelected(),
            x: Math.trunc(w.x),
            y: Math.trunc(w.y),
            target: hoverOrderTarget(view.pickOrderTarget(sx, sy)), // [fix6ui] N5
            shift: false,
            alt: false,
            ctrl: false,
        });
        statusEl.textContent = hover.text;
        statusEl.hidden = hover.text === '';
    };
    return () => {
        closeOrderMenu();
        view.onRightClick = undefined;
        view.onLeftClickIntercept = undefined;
        view.onPointerRest = undefined;
        statusEl?.remove();
        statusEl = null;
        fleetPointMode = null;
        deps = null;
    };
}

/**
 * Execute a player order (method_347 via executeShipAction) and apply what the C# does to the UI: the new selection,
 * the selection buttons' page, the fleet point-pick mode, messages, and the automation prompts (asked after the
 * order with the game paused — the C# message box is modal).
 */
export async function performAction(action: ShipAction, fromActionMenu: boolean, actionMenuPoint?: { x: number; y: number }): Promise<void> {
    if (deps === null) return;
    const { galaxy, empire } = deps;
    const selected = deps.getSelected();
    playOrderSting(galaxy, empire, selected, action); // [audio] Main.Part7.cs:504 / 515 investigate → discovery.mp3
    // Command log: queued, applied at the next frame boundary (within one frame); the UI follow-up runs then.
    const r = await new Promise<ShipActionResult>((resolve) => {
        issuePlayerCommand(galaxy, empire, 'shipAction', [selected, action, fromActionMenu, actionMenuPoint], resolve);
    });
    if (deps === null) return;
    if (r.message !== undefined && r.message !== '') showToast(resolveGameText(r.message));
    if (r.mouseHoverMode !== undefined && selected instanceof ShipGroup) {
        fleetPointMode = { mode: r.mouseHoverMode, fleet: selected };
        showToast(r.mouseHoverMode === 'SetFleetAttackPoint' ? T('Set Attack Target') : T('Set Home Base'));
    }
    if (r.showSmugglingResourceSelection) {
        // TODO(port): Main.Part8.cs 5067 method_345 (the smuggling-mission resource picker panel) — use the colony's
        // right-click menu ("Assign Mercenary Smuggling Mission") meanwhile.
        showToast(T('Assign Mercenary Smuggling Mission'));
    }
    if (r.openForm !== undefined) {
        // TODO(port): the Bacon mod forms (planetCargoDataForm / CustomizeShipForm / InvasionCommandForm).
        showToast(`${r.openForm}: not available`);
    }
    if (r.select !== undefined) deps.select(r.select);
    else if (r.selectNextFromHistory) deps.select(null); // no selection history in the streamlined HUD
    if (bar !== null) {
        if (r.openSubMenu !== undefined) bar.page = r.openSubMenu;
        if (r.returnToTop) bar.page = null;
        if (!fromActionMenu) {
            const next = selectionAfterClick(action);
            if (next !== undefined) bar.page = next;
        }
        bar.render(true);
    }
    for (const task of r.automationPrompts) {
        const clock = deps?.clock;
        const wasPaused = clock?.paused ?? true;
        if (clock) clock.paused = true;
        const off = await confirmAutomationOff(T(task));
        if (clock) clock.paused = wasPaused;
        if (off && deps !== null) issuePlayerCommand(deps.galaxy, deps.empire, 'automationOff', [task]);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Selection panel action buttons
// ---------------------------------------------------------------------------------------------------------------

/** A short caption for a button (the original shows only an icon; the long text is the hint). */
export function selectionButtonLabel(b: SelectionButton): string {
    const a = b.action;
    if (a === null) return '';
    if (a.actionType !== ShipActionType.Undefined) {
        switch (a.actionType) {
            case ShipActionType.RecruitTroops:
                return (a.target2 as { name?: string } | null)?.name ?? T('Recruit Troops');
            case ShipActionType.AutomateShip:
                return T('Automate');
            case ShipActionType.UnautomateShip:
                return 'Manual';
            case ShipActionType.JoinShipGroup:
                return T('Join Fleet');
            case ShipActionType.LeaveShipGroup:
                return T('Leave Fleet');
            case ShipActionType.BuildColonize:
                return T('Colonize');
            case ShipActionType.FighterOptions:
                return 'Fighters';
            case ShipActionType.FighterBuildFighter:
                return 'Build Fighter';
            case ShipActionType.FighterBuildBomber:
                return 'Build Bomber';
            case ShipActionType.FighterLaunchFighters:
                return 'Launch Fighters';
            case ShipActionType.FighterLaunchBombers:
                return 'Launch Bombers';
            case ShipActionType.FighterRetrieveFighters:
                return 'Recall Fighters';
            case ShipActionType.FighterRetrieveBombers:
                return 'Recall Bombers';
            case ShipActionType.FighterUpgradeAll:
                return 'Upgrade';
            case ShipActionType.BuildOptions:
                return 'Build…';
            case ShipActionType.BuildOptionsPrivate:
                return 'Civilian…';
            case ShipActionType.ColonyBuildOptions:
                return 'Facilities…';
            case ShipActionType.ColonyBuildWonder:
                return 'Wonders…';
            case ShipActionType.ReturnToTop:
                return '‹ Back';
            case ShipActionType.CreateNewFleet:
                return T('New Fleet');
            case ShipActionType.BuildPlanetaryFacility:
                return (a.target as { name?: string } | null)?.name ?? '';
            case ShipActionType.AssignAttack:
                return T('Attack');
            case ShipActionType.SetFleetPosture:
                return 'Posture';
            case ShipActionType.SetFleetRange:
                return 'Range';
            case ShipActionType.SetFleetAttackPoint:
                return 'Target';
            case ShipActionType.SetFleetHomeBase:
                return 'Home Base';
            case ShipActionType.GeneratePirateMissionAttack:
                return 'Merc. Attack';
            case ShipActionType.GeneratePirateMissionDefend:
                return 'Merc. Defense';
            case ShipActionType.GeneratePirateMissionSmuggling:
                return 'Merc. Smuggling';
            case ShipActionType.DeployVirus:
                return 'Virus';
        }
        return '';
    }
    switch (a.missionType) {
        case BuiltObjectMissionType.Hold:
            return T('Stop');
        case BuiltObjectMissionType.Escape:
            return T('Escape');
        case BuiltObjectMissionType.Refuel:
            return T('Refuel');
        case BuiltObjectMissionType.Repair:
            return T('Repair');
        case BuiltObjectMissionType.Retrofit:
            return T('Retrofit');
        case BuiltObjectMissionType.Retire:
            return 'Scrap';
        case BuiltObjectMissionType.LoadTroops:
            return T('Load Troops');
        case BuiltObjectMissionType.Move:
            return T('Return to base');
        case BuiltObjectMissionType.Explore:
            return T('Explore');
        case BuiltObjectMissionType.Build:
            return a.design !== null ? a.design.name : T('Repair');
    }
    return '';
}

const CHROME_DIR = '/assets/dwu/images/ui/chrome';

/** Main.Part3.cs 1208 method_588(button, action): the button's image — a chrome bitmap for most actions, the design's
 *  ship (rotated 270°) for a build button, the facility / troop / plague picture for those. Null = blank.png (an empty
 *  button). `troopUrl` resolves a RecruitTroops button's troop picture (troopImageUrl needs the galaxy's race count). */
export function selectionButtonIcon(
    b: SelectionButton,
    selected: unknown,
    troopUrl: (troop: unknown) => string | null,
    shipUrl: (design: { pictureRef: number; subRole: number }) => string | null,
): { url: string; rotate: number } | null {
    const a = b.action;
    if (a === null) return null;
    const chrome = (f: string): { url: string; rotate: number } => ({ url: `${CHROME_DIR}/${f}`, rotate: 0 });
    if (a.actionType !== ShipActionType.Undefined) {
        switch (a.actionType) {
            case ShipActionType.RecruitTroops: {
                const u = troopUrl(a.target2);
                return u !== null ? { url: u, rotate: 0 } : null;
            }
            case ShipActionType.AutomateShip: return chrome('automate.png');
            case ShipActionType.UnautomateShip: return chrome('unautomate.png');
            case ShipActionType.JoinShipGroup: return chrome('joinfleet.png');
            case ShipActionType.LeaveShipGroup: return chrome('leavefleet.png');
            case ShipActionType.BuildColonize: return chrome('colonize.png');
            case ShipActionType.FighterOptions: return chrome('fighters.png');
            case ShipActionType.FighterBuildFighter: return chrome('buildfighter.png');
            case ShipActionType.FighterBuildBomber: return chrome('buildbomber.png');
            case ShipActionType.FighterLaunchFighters: return chrome('launchfighters.png');
            case ShipActionType.FighterLaunchBombers: return chrome('launchbombers.png');
            case ShipActionType.FighterRetrieveFighters: return chrome('retrievefighters.png');
            case ShipActionType.FighterRetrieveBombers: return chrome('retrievebombers.png');
            case ShipActionType.FighterUpgradeAll: return chrome('upgradefighters.png');
            case ShipActionType.BuildOptions:
            case ShipActionType.BuildOptionsPrivate:
            case ShipActionType.ColonyBuildOptions:
            case ShipActionType.ColonyBuildWonder:
                return chrome('build.png');
            case ShipActionType.ReturnToTop: return chrome('returntotop.png');
            case ShipActionType.CreateNewFleet: return chrome('newfleet.png');
            case ShipActionType.AssignAttack: return chrome('attack.png');
            case ShipActionType.SetFleetAttackPoint: return chrome('fleetAttackPoint.png');
            case ShipActionType.SetFleetHomeBase: return chrome('fleetHomeBase.png');
            case ShipActionType.GeneratePirateMissionAttack: return chrome('pirateMissionAttack.png');
            case ShipActionType.GeneratePirateMissionDefend: return chrome('pirateMissionDefend.png');
            case ShipActionType.GeneratePirateMissionSmuggling: return chrome('pirateMissionSmuggling.png');
            case ShipActionType.BuildPlanetaryFacility: {
                const ref = (a.target as { pictureRef?: number } | null)?.pictureRef;
                return ref !== undefined ? { url: `/assets/dwu/images/environment/planetaryfacilities/facility_${ref}.png`, rotate: 0 } : null;
            }
            case ShipActionType.SetFleetPosture: {
                const sg = a.target as { posture?: FleetPosture } | null;
                return sg?.posture === FleetPosture.Attack ? chrome('fleetAttackPosture.png') : sg?.posture === FleetPosture.Defend ? chrome('fleetDefendPosture.png') : null;
            }
            case ShipActionType.SetFleetRange: {
                const r = (a.target as { postureRangeSquared?: number } | null)?.postureRangeSquared ?? 0;
                if (r <= 2250000.0) return chrome('fleetRangeTarget.png');
                if (r <= 2304000000.0) return chrome('fleetRangeSystem.png');
                if (r <= 250000000000.0) return chrome('fleetRangeArea.png');
                if (r <= 1000000000000.0) return chrome('fleetRangeSector.png');
                return chrome('fleetRangeAny.png');
            }
            case ShipActionType.DeployVirus: {
                const ref = (a.target2 as { pictureRef?: number } | null)?.pictureRef;
                return ref !== undefined ? { url: `/assets/dwu/images/ui/plagues/Plague_${ref}.png`, rotate: 0 } : null;
            }
        }
        return null;
    }
    switch (a.missionType) {
        case BuiltObjectMissionType.Escape: return chrome('emergency.png');
        case BuiltObjectMissionType.Retire:
            return a.target instanceof BuiltObject ? chrome('scrapbase.png') : chrome('scrapfighter.png');
        case BuiltObjectMissionType.Retrofit:
            return selected instanceof BuiltObject && selected.role === BuiltObjectRole.Base ? chrome('retrofitbase.png') : chrome('retrofitship.png');
        case BuiltObjectMissionType.Hold: return chrome('stop.png');
        case BuiltObjectMissionType.Build:
            if (a.design !== null) {
                const u = shipUrl(a.design);
                return u !== null ? { url: u, rotate: 270 } : null;
            }
            return chrome('build.png');
        case BuiltObjectMissionType.Repair: return chrome('construction.png');
        case BuiltObjectMissionType.Move: return chrome('colony.png');
        case BuiltObjectMissionType.Refuel: return chrome('refuel.png');
        case BuiltObjectMissionType.LoadTroops: return chrome('loadtroops.png');
    }
    return null;
}

/** One of our own controls shown in an empty action-button slot (small tweak: the original has no such buttons). */
export interface SelectionExtraSlot {
    label: string;
    title: string;
    icon?: string;
    active?: boolean;
    disabled?: boolean;
    onClick: () => void;
}
let extraSlotProvider: () => SelectionExtraSlot[] = () => [];
let extraOverflow: (rest: SelectionExtraSlot[], behindMore: boolean) => void = () => {};
let extraMoreToggle: () => void = () => {};
/** The HUD supplies the extras for the current selection and receives those that found no empty slot
 *  (`behindMore`: a "More…" slot opens them; else there was no empty slot at all). */
export function setSelectionExtraSlots(provider: () => SelectionExtraSlot[], overflow: (rest: SelectionExtraSlot[], behindMore: boolean) => void, moreToggle: () => void): void {
    extraSlotProvider = provider;
    extraOverflow = overflow;
    extraMoreToggle = moreToggle;
}

/** Icon resolvers the selection bar uses (installed by the HUD: they need the galaxy's race count / ship art). */
let iconResolvers: { troop: (t: unknown) => string | null; ship: (design: { pictureRef: number; subRole: number }) => string | null } = {
    troop: () => null,
    ship: () => null,
};
/** The installed ship-art resolver (for HUD extras such as the dispatch build buttons). */
export function selectionShipIconUrl(design: { pictureRef: number; subRole: number }): string | null {
    return iconResolvers.ship(design);
}
export function setSelectionIconResolvers(r: typeof iconResolvers): void {
    iconResolvers = r;
}

interface SelectionBar {
    element: HTMLElement;
    /** The button page: null = the top level (method_592), else the sub-menu ShipAction (method_593). */
    page: ShipAction | null;
    /** Rebuild the buttons (`force`: also pages that draw galaxy.rnd). */
    render(force: boolean): void;
    /** Redraw the current buttons and extras without rebuilding the buttons (no galaxy.rnd). */
    redraw(): void;
}

/** The selected object the buttons act on, as the C# SelectedObject (fleet, else ship / base, else habitat). */
export function selectionTarget(sel: { habitat: Habitat; builtObject?: BuiltObject; shipGroup?: ShipGroup; creature?: unknown; fighter?: unknown; builtObjects?: BuiltObject[] } | null): ShipActionSelection {
    if (sel === null) return null;
    // Several ships (a drag box / Shift-clicks): the BuiltObjectList selection the list orders act on (the same array
    // instance while the selection lasts, so the action bar keeps its page).
    if (sel.builtObjects !== undefined && sel.builtObjects.length > 0) return sel.builtObjects;
    // Main.Part3.cs 3616: a selected Creature gets eight empty buttons (method_585 with nulls), as with no selection.
    if (sel.creature !== undefined) return null;
    // TODO(port): a selected Fighter's buttons (Main.Part3.cs 3601-3614: Launch / Retrieve Fighters|Bombers and Retire
    // for the player's own) — none here yet, as for a creature.
    if (sel.fighter !== undefined) return null;
    return sel.shipGroup ?? sel.builtObject ?? sel.habitat;
}

/** The eight btnSelectionAction buttons for the HUD selection panel (hud.ts [ordermenu] block). */
export function createSelectionActionBar(): HTMLElement {
    const element = document.createElement('div');
    element.className = 'order-actions';
    let buttons: SelectionButton[] = [];
    let lastSel: ShipActionSelection = null;
    /** Sim worker: the selection and page the current `buttons` answer (a reply arrives one round trip after render). */
    let buttonsSel: ShipActionSelection = null;
    let buttonsPage: ShipAction | null = null;
    const self: SelectionBar = {
        element,
        page: null,
        redraw(): void {
            if (deps !== null) draw();
        },
        render(force: boolean): void {
            if (deps === null) {
                element.replaceChildren();
                return;
            }
            const selected = deps.getSelected();
            if (selected !== lastSel) {
                lastSel = selected;
                self.page = null; // method_209 → method_592
                force = true;
            }
            const page = self.page;
            const ctx = { galaxy: deps.galaxy, empire: deps.empire, selected };
            const show = (next: SelectionButton[] | null): void => {
                if (deps === null || deps.getSelected() !== selected || self.page !== page) return;
                buttonsSel = selected;
                buttonsPage = page;
                if (next === null) return; // the C# leaves the buttons as they are
                buttons = next;
                draw();
            };
            if (selectionButtonsDrawRandom(ctx, page)) {
                // The 500 ms refresh skips pages whose method_593 draws galaxy.rnd (an unowned habitat's build buttons, a
                // colony's Build Options): they are rebuilt only on player input (selection change, a click), keeping
                // galaxy.rnd player-input-only (the C# redraws them every 500 ms, Main.Part11.cs 661).
                if (!force) return;
                // Built by the journaled 'selectionButtons' command (playerOps.ts), so the draws happen in the game at the
                // next frame boundary and replay from the log (docs/sim-worker.md §8). A reply for a selection / page the
                // bar has left since is not shown.
                issuePlayerCommand(deps.galaxy, deps.empire, 'selectionButtons', [selected, page], show);
                return;
            }
            // Every other page only reads the game (on a sim-worker replica: the replica).
            show(selectionButtons(ctx, page));
        },
    };
    // Eight persistent buttons, updated in place (no DOM rebuild on refresh).
    const btns: HTMLButtonElement[] = [];
    // Our extra controls placed in the empty slots (slotExtras[i] set: that slot is an extra, not an action).
    const slotExtras: (SelectionExtraSlot | null)[] = new Array(8).fill(null);
    for (let i = 0; i < 8; i++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'order-action-btn';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const extra = slotExtras[i];
            if (extra !== null) {
                if (!extra.disabled) {
                    extra.onClick();
                    draw();
                }
                return;
            }
            const b = buttons[i];
            if (b === undefined || b.action === null || !b.enabled) return;
            void performAction(b.action, false); // method_594 → method_347(action, false)
        });
        btns.push(btn);
    }
    const draw = (): void => {
        // The original keeps all eight buttons visible (an empty one shows blank.png, Main.Part3.cs method_588).
        if (element.childElementCount !== 8) element.replaceChildren(...btns);
        const selected = deps?.getSelected() ?? null;
        btns.forEach((btn, i) => {
            const b: SelectionButton = buttons[i] ?? { action: null, enabled: false, hint: '', style: '', count: 0 };
            btn.className = 'order-action-btn';
            if (b.style !== '') btn.classList.add(`order-style-${b.style}`);
            if (b.action === null) btn.classList.add('order-action-empty');
            const icon = selectionButtonIcon(b, selected, iconResolvers.troop, iconResolvers.ship);
            if (icon !== null) {
                const img = document.createElement('img');
                img.className = 'order-action-icon';
                img.src = icon.url;
                img.alt = selectionButtonLabel(b);
                if (icon.rotate !== 0) img.style.transform = `rotate(${icon.rotate}deg)`;
                img.draggable = false;
                btn.replaceChildren(img);
            } else {
                btn.textContent = selectionButtonLabel(b);
            }
            if (b.count > 0) {
                const c = document.createElement('span');
                c.className = 'order-action-count';
                c.textContent = String(b.count);
                btn.appendChild(c);
            }
            btn.title = b.hint;
            btn.disabled = !b.enabled;
        });
        // Fill the empty slots with the extras (follow, dispatch, charter); the rest overflow to the HUD's row.
        let extras = extraSlotProvider();
        const empty = btns.filter((_, i) => buttons[i]?.action == null).length;
        let rest: SelectionExtraSlot[] = [];
        if (extras.length > empty) {
            // More extras than empty slots: the last empty slot opens the rest ("More…" popup).
            const keep = Math.max(0, empty - 1);
            rest = extras.slice(keep);
            extras = extras.slice(0, keep);
            if (empty > 0) extras.push({ label: `More… (${rest.length})`, title: rest.map((x) => x.label).join(', '), onClick: () => extraMoreToggle() });
        }
        let next = 0;
        for (let i = 0; i < 8; i++) {
            slotExtras[i] = null;
            if (buttons[i]?.action != null || next >= extras.length) continue;
            const x = extras[next++];
            slotExtras[i] = x;
            const btn = btns[i];
            btn.className = 'order-action-btn order-action-extra';
            if (x.active) btn.classList.add('order-action-extra-on');
            btn.replaceChildren();
            if (x.icon !== undefined) {
                const img = document.createElement('img');
                img.className = 'order-action-icon';
                img.src = x.icon;
                img.alt = '';
                img.draggable = false;
                btn.appendChild(img);
            }
            // Icon buttons are icon-only like the original strip (the label is in the tooltip).
            if (x.icon === undefined) {
                const cap = document.createElement('span');
                cap.className = 'order-action-caption';
                cap.textContent = x.label;
                btn.appendChild(cap);
            }
            btn.title = x.title;
            btn.disabled = x.disabled === true;
        }
        extraOverflow(rest, empty > 0);
    };
    bar = self;
    // Main.Part11.cs 661-728: refresh the page every 500 ms from the first button's Tag.
    const timer = window.setInterval(() => {
        if (!element.isConnected) {
            window.clearInterval(timer);
            if (bar === self) bar = null;
            return;
        }
        if (deps === null) return;
        const selected = deps.getSelected();
        if (selected !== lastSel) {
            self.render(true);
            return;
        }
        // The buttons of the new selection / page have not arrived yet (a 'selectionButtons' command in flight: the
        // refresh takes the page from the first button, which would undo the page change).
        if (buttonsSel !== selected || buttonsPage !== self.page) return;
        const next = selectionRefreshPage(selected, buttons[0]?.action ?? null);
        if (next === undefined) return;
        self.page = next;
        self.render(false);
    }, 500);
    return element;
}

/** Re-render the selection buttons now (selection changed / after an order). */
export function refreshSelectionActionBar(): void {
    bar?.render(true);
}

/** Redraw the selection buttons' extras (e.g. the dispatch slots arrived) without rebuilding the buttons. */
export function redrawSelectionActionBar(): void {
    bar?.redraw();
}
