// Stacked-object pick popup: a small DOM list next to the cursor. Esc / a click elsewhere closes it.
import './pickMenu.css';

export interface PickMenuEntry {
    icon: string;
    name: string;
    /** Object type ("Destroyer", "Construction Ship", "Continental Planet", ...); '' = none. */
    type: string;
    owner: string;
    onPick: () => void;
}

let el: HTMLDivElement | null = null;
let cleanup: (() => void) | null = null;

export function isPickMenuOpen(): boolean {
    return el !== null;
}

export function closePickMenu(): void {
    cleanup?.();
    cleanup = null;
    el?.remove();
    el = null;
}

/** Open the popup at client coordinates (clamped into the viewport); replaces any open one. */
export function openPickMenu(entries: readonly PickMenuEntry[], clientX: number, clientY: number): void {
    closePickMenu();
    if (entries.length === 0) return;
    const root = document.createElement('div');
    root.className = 'pick-menu';
    let active = 0;
    const rows: HTMLDivElement[] = [];
    const setActive = (i: number): void => {
        active = (i + rows.length) % rows.length;
        rows.forEach((r, j) => r.classList.toggle('pick-menu-active', j === active));
        rows[active]?.scrollIntoView?.({ block: 'nearest' });
    };
    entries.forEach((en, i) => {
        const row = document.createElement('div');
        row.className = 'pick-menu-row';
        const icon = document.createElement('span');
        icon.className = 'pick-menu-icon';
        icon.textContent = en.icon;
        const name = document.createElement('span');
        name.className = 'pick-menu-name';
        name.textContent = en.name;
        row.append(icon, name);
        if (en.type !== '') {
            const type = document.createElement('span');
            type.className = 'pick-menu-type';
            type.textContent = en.type;
            row.append(type);
        }
        if (en.owner !== '') {
            const owner = document.createElement('span');
            owner.className = 'pick-menu-owner';
            owner.textContent = en.owner;
            row.append(owner);
        }
        row.addEventListener('mouseenter', () => setActive(i));
        row.addEventListener('click', (ev) => {
            ev.stopPropagation();
            closePickMenu();
            en.onPick();
        });
        rows.push(row);
        root.append(row);
    });
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    document.body.appendChild(root);
    const r = root.getBoundingClientRect();
    root.style.left = `${Math.max(4, Math.min(clientX + 8, window.innerWidth - r.width - 4))}px`;
    root.style.top = `${Math.max(4, Math.min(clientY + 8, window.innerHeight - r.height - 4))}px`;
    setActive(0);
    el = root;

    const onDown = (e: MouseEvent): void => {
        if (!root.contains(e.target as Node)) closePickMenu();
    };
    const onKey = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            e.preventDefault();
            closePickMenu();
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.stopPropagation();
            e.preventDefault();
            setActive(active + (e.key === 'ArrowDown' ? 1 : -1));
        } else if (e.key === 'Enter') {
            e.stopPropagation();
            e.preventDefault();
            const en = entries[active];
            closePickMenu();
            en?.onPick();
        }
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    cleanup = () => {
        window.removeEventListener('mousedown', onDown, true);
        window.removeEventListener('keydown', onKey, true);
    };
}
