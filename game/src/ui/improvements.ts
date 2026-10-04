// "Improvements": every Distant Worlds 2-inspired addition that is NOT in the original game, in one category. Each one
// is listed here once ({id, label, description, default}); the player turns it on or off in Game Options → Advanced
// Display Settings → "Improvements" (improvementsOptionsGroup), and the ones that are map overlays get their own
// "Improvements" section in the HUD's View popup, below the original's Overlays (improvementsSection; the rows are
// ui/mapOverlays.ts IMPROVEMENT_OVERLAY_ROWS). A disabled improvement hides its rows and draws nothing.
//
// UI-only: nothing here reads or writes the game. The enabled flags persist in localStorage under their own key (the
// storage is optional: tests and private windows keep them in memory).
//
// No DOM access at import time (render layers and node tests import the registry); the section / group helpers build
// DOM only when called.

/** One improvement. `default`: enabled until the player changes it. */
export interface ImprovementDef {
    id: ImprovementId;
    label: string;
    description: string;
    default: boolean;
}

export type ImprovementId = 'colonyTargetScores' | 'resourcesOverlay' | 'fuelRangeOverlay';

/** The registry, in display order. Enabled by default: each one's overlay toggle itself still starts off. */
export const IMPROVEMENTS: readonly ImprovementDef[] = [
    {
        id: 'colonyTargetScores',
        label: 'Colony target scores',
        description: "Map overlay: the Expansion Planner's colonization targets, ringed in a colour from their score (green = best)",
        default: true,
    },
    {
        id: 'resourcesOverlay',
        label: 'Resources overlay',
        description: 'Map overlay: the resources you know of in each system, with rarity and abundance; pick one resource to find it',
        default: true,
    },
    {
        id: 'fuelRangeOverlay',
        label: 'Fuel range overlay',
        description: "Map overlay: the selected ship's or fleet's reach on its current fuel and the refuelling points it can use",
        default: true,
    },
];

const STORAGE_KEY = 'dwu.improvements';

let enabled: Map<ImprovementId, boolean> | null = null;
const listeners = new Set<() => void>();

function storage(): Storage | null {
    try {
        return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
        return null;
    }
}

function load(): Map<ImprovementId, boolean> {
    const out = new Map<ImprovementId, boolean>();
    for (const d of IMPROVEMENTS) out.set(d.id, d.default);
    try {
        const raw = storage()?.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            for (const d of IMPROVEMENTS) if (typeof parsed[d.id] === 'boolean') out.set(d.id, parsed[d.id] as boolean);
        }
    } catch {
        /* unreadable: the defaults */
    }
    return out;
}

function flags(): Map<ImprovementId, boolean> {
    if (enabled === null) enabled = load();
    return enabled;
}

export function improvementDef(id: ImprovementId): ImprovementDef | undefined {
    return IMPROVEMENTS.find((d) => d.id === id);
}

/** Whether the player has this improvement on (Game Options). */
export function improvementEnabled(id: ImprovementId): boolean {
    return flags().get(id) ?? improvementDef(id)?.default ?? false;
}

/** Turn an improvement on / off, persist it and notify the subscribers. */
export function setImprovementEnabled(id: ImprovementId, on: boolean): void {
    const f = flags();
    if (f.get(id) === on) return;
    f.set(id, on);
    try {
        storage()?.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(f)));
    } catch {
        /* storage unavailable */
    }
    for (const fn of listeners) fn();
}

/** Subscribe to improvement on / off changes. Returns the unsubscribe function. */
export function onImprovementsChange(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** Tests: forget the loaded flags (re-read from storage / defaults on next use). */
export function resetImprovementsForTest(): void {
    enabled = null;
}

/**
 * The View popup's "Improvements" section: a section head and the given rows (one element per improvement), each row
 * hidden while its improvement is disabled, and the whole section while all are. The rows follow later Game Options
 * changes until `signal` aborts (the HUD's lifetime, ui/hudLifetime.ts).
 */
export function improvementsSection(rows: readonly { improvement: ImprovementId; element: HTMLElement }[], signal?: AbortSignal): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'hud-improvements';
    const head = document.createElement('div');
    head.className = 'hud-section-head';
    head.textContent = 'Improvements';
    head.title = 'Additions inspired by Distant Worlds 2 (not in the original game); turn them on or off in Game Options';
    wrap.appendChild(head);
    for (const r of rows) wrap.appendChild(r.element);
    const sync = (): void => {
        let any = false;
        for (const r of rows) {
            const on = improvementEnabled(r.improvement);
            r.element.style.display = on ? '' : 'none';
            any ||= on;
        }
        wrap.style.display = any ? '' : 'none';
    };
    sync();
    const off = onImprovementsChange(sync);
    signal?.addEventListener('abort', off, { once: true });
    return wrap;
}

/** What improvementsOptionsGroup draws with (the original-style window's controls, passed in to keep this module light). */
export interface OptionsGroupControls {
    groupBox(title: string, w: number, h: number, size?: number): HTMLElement;
    checkBox(label: string, checked: boolean, onChange: (v: boolean) => void, size?: number): HTMLElement;
    place<T extends HTMLElement>(e: T, x: number, y: number, w?: number, h?: number): T;
}

/** Height of improvementsOptionsGroup for the current registry. */
export function improvementsOptionsGroupHeight(): number {
    return 30 + 22 * IMPROVEMENTS.length;
}

/** Game Options' "Improvements" group: one checkbox per improvement (its description as the tooltip). */
export function improvementsOptionsGroup(c: OptionsGroupControls, width: number, titleSize?: number, checkSize?: number): HTMLElement {
    const g = c.groupBox('Improvements', width, improvementsOptionsGroupHeight(), titleSize);
    g.title = 'Additions inspired by Distant Worlds 2 — not in the original game';
    IMPROVEMENTS.forEach((d, i) => {
        const box = c.checkBox(d.label, improvementEnabled(d.id), (v) => setImprovementEnabled(d.id, v), checkSize);
        box.title = d.description;
        box.classList.add('go-check');
        g.appendChild(c.place(box, 10, 22 + 22 * i));
    });
    return g;
}
