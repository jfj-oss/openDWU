// 17c — the right-click order menu (the original's actionMenu ContextMenuStrip, Main.Part8.cs 1332
// actionMenu_Opening + 3202 method_344) as a DOM popup: positioned at the cursor, submenus on hover, keyboard
// navigable (Up/Down/Left/Right/Enter, Escape closes). The entries are the OrderMenuItem tree the sim-side builder
// (src/sim/player/orderMenu.ts) returns; this file only draws it and reports the picked entry.
// Also the small automation confirm dialog (GenerateAutomationMessageBox) used after an order.
import './orderMenu.css';
import type { OrderMenuItem } from '../sim/player/orderMenu';

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
        const finish = (v: boolean): void => {
            document.removeEventListener('keydown', onKey, true);
            wrap.remove();
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
        win.append(title, body, buttons);
        wrap.appendChild(win);
        document.body.appendChild(wrap);
        off.focus();
    });
}
