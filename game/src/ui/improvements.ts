// "Improvements": the additions that are not in Distant Worlds: Universe (several are Distant Worlds 2 ideas built on
// the original's mechanics). Each has an on/off switch in the Game Options window's "Improvements" group. When an
// improvement is off, its UI entry points (buttons, hotkeys, overlays) are hidden. These switches are UI settings
// (ui/settings.ts `improvements`, persisted per browser). None reaches the sim: every sim change an improvement makes
// still goes through the journaled player commands.
//
// The registry holds {id, label, description, default}. A feature asks `isImprovementEnabled(id)` when it builds or
// refreshes its entry points, and listens with `onImprovementsChange` to show or hide them live.
// `improvementsOptionsGroup` builds the Game Options group (one check box and a description line per improvement).

import { getSettings, onSettingsChange, updateSettings } from './settings';
import { COLORS, checkBox, place, text } from './originalWindow';
import { groupBox } from './originalWindowControls';

export interface ImprovementSpec {
    /** Stable id (the key stored in settings.improvements). */
    id: string;
    /** The check box label in Game Options. */
    label: string;
    /** One line under the label: what it adds. */
    description: string;
    /** On or off before the player changes it. */
    default: boolean;
}

/** Every improvement, in the order Game Options lists them. */
export const IMPROVEMENTS: ImprovementSpec[] = [
    {
        id: 'fleetSettings',
        label: 'Fleet Settings panel',
        description: "A fleet's behaviour settings in one window: posture, engagement, retreat, fuel, troops (Q).",
        default: true,
    },
];

/** Add an improvement to the registry (no-op when its id is listed already). */
export function registerImprovement(spec: ImprovementSpec): void {
    if (!IMPROVEMENTS.some((s) => s.id === spec.id)) IMPROVEMENTS.push(spec);
}

export function findImprovement(id: string): ImprovementSpec | null {
    return IMPROVEMENTS.find((s) => s.id === id) ?? null;
}

/** Whether `id` is on: the player's choice, else its default (an unknown id is off). */
export function isImprovementEnabled(id: string): boolean {
    const spec = findImprovement(id);
    if (spec === null) return false;
    const stored = getSettings().improvements[id];
    return typeof stored === 'boolean' ? stored : spec.default;
}

/** Turn `id` on or off (persisted; listeners are told). */
export function setImprovementEnabled(id: string, on: boolean): void {
    updateSettings({ improvements: { ...getSettings().improvements, [id]: on } });
}

/** Called after any improvement switch may have changed. Returns the unsubscribe function. */
export function onImprovementsChange(cb: () => void): () => void {
    let last = JSON.stringify(IMPROVEMENTS.map((s) => isImprovementEnabled(s.id)));
    return onSettingsChange(() => {
        const now = JSON.stringify(IMPROVEMENTS.map((s) => isImprovementEnabled(s.id)));
        if (now === last) return;
        last = now;
        cb();
    });
}

/** Height of the Game Options "Improvements" group for `n` improvements (caption + 44 px per row). */
export function improvementsGroupHeight(n: number = IMPROVEMENTS.length): number {
    return 30 + 44 * Math.max(1, n);
}

/** The Game Options "Improvements" group, `w` wide: a check box per improvement with its description under it. */
export function improvementsOptionsGroup(w: number, size = 20.77): HTMLDivElement {
    const g = groupBox('Improvements', w, improvementsGroupHeight(), 18.67);
    g.dataset.go = 'improvements';
    IMPROVEMENTS.forEach((spec, i) => {
        const y = 22 + 44 * i;
        const c = checkBox(spec.label, isImprovementEnabled(spec.id), (v) => setImprovementEnabled(spec.id, v), size);
        c.classList.add('go-check');
        c.dataset.improvement = spec.id;
        g.appendChild(place(c, 9, y));
        const d = text(spec.description, { size: 14, color: COLORS.label, shadow: false, className: 'go-label' });
        g.appendChild(place(d, 32, y + 23, w - 44));
    });
    return g;
}
