// Giantworks, the Ultramind (not in the original): its directive, Logic Bomb and Withdraw as action buttons in the free slots of the selection
// panel's eight (orderMenu.ts setSelectionFreeSlots, like Intercept / Mothball), shown while the Ultramind's station is selected. The current
// directive is lit; only the holder's directive buttons act (the others see them greyed, with the same tooltips). A click is the journaled
// 'threatAction' player command (multiplayer- and replay-safe). Nothing shows without a finished Ultramind. The icons are drawn here (SVG).

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import type { BuiltObject } from '../sim/builtObject';
import { issuePlayerCommand } from '../sim/player/playerCommands';
import { availableThreatActions } from '../sim/scenario/threats/framework';
import { directiveView, type Directive } from '../sim/scenario/threats/giantworks/ultramind';
import { INVADE_ACTION } from '../sim/scenario/threats/giantworks/capture';

function svgIcon(body: string, stroke = '#b8c4e0'): string {
    return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="${stroke}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`)}`;
}
/** Research: an atom. War: crossed blades. Economy: a stack of coins. Intelligence: an eye. */
const DIRECTIVE_ICON_BODY: Record<Directive, string> = {
    research: '<ellipse cx="16" cy="16" rx="12" ry="4.6"/><ellipse cx="16" cy="16" rx="12" ry="4.6" transform="rotate(60 16 16)"/><ellipse cx="16" cy="16" rx="12" ry="4.6" transform="rotate(120 16 16)"/><circle cx="16" cy="16" r="1.6" fill="currentColor"/>',
    war: '<path d="M6 6l20 20M26 6L6 26"/><path d="M4 10l6-6M28 10l-6-6M4 22l6 6M28 22l-6 6"/>',
    economy: '<ellipse cx="16" cy="9" rx="9" ry="3.6"/><path d="M7 9v6c0 2 4 3.6 9 3.6s9-1.6 9-3.6V9"/><path d="M7 15v6c0 2 4 3.6 9 3.6s9-1.6 9-3.6v-6"/>',
    intelligence: '<path d="M3 16C8 8 24 8 29 16 24 24 8 24 3 16z"/><circle cx="16" cy="16" r="4"/>',
};
const BOMB_ICON = svgIcon('<circle cx="14" cy="19" r="8"/><path d="M20 13l4-4"/><path d="M24 9l2-3M23 5l1 4M28 8l-4 1" stroke="#ffb040"/>');
const WITHDRAW_ICON = svgIcon('<path d="M13 5H6v22h7"/><path d="M12 16h15M22 10l6 6-6 6"/>');

export interface UltramindSlot {
    label: string;
    hint: string;
    icon: string;
    disabled?: boolean;
    active?: boolean;
    onClick: () => void;
}

/** The buttons for the selected object `bo` as seen by `viewer` (empty unless it is a finished Ultramind's station). `redraw` runs after a click. */
export function ultramindSlots(galaxy: Galaxy, viewer: Empire, bo: BuiltObject | null | undefined, redraw: () => void): UltramindSlot[] {
    if (galaxy.scenario === null || bo === null || bo === undefined) return [];
    const v = directiveView(galaxy, bo, viewer);
    if (v === null) return [];
    const out: UltramindSlot[] = [];
    if (!v.awakened) {
        for (const o of v.options) {
            const switching = o.state === 'switching';
            const current = o.state === 'current';
            const note = current ? ' (current)' : switching ? ` (switching, ${v.daysLeft} days left)` : v.canChange ? ' (click to switch)' : ' (only the empire whose territory holds the Ultramind can change it)';
            out.push({
                label: `Directive: ${o.name}${note}`,
                hint: `Directive: ${o.name}${note}. ${o.tip}`,
                icon: svgIcon(DIRECTIVE_ICON_BODY[o.id], current || switching ? '#ffd060' : '#b8c4e0'),
                active: current || switching,
                disabled: o.action === null || !v.canChange,
                onClick: () => {
                    if (o.action !== null) issuePlayerCommand(galaxy, viewer, 'threatAction', [o.action, bo], redraw);
                },
            });
        }
    }
    for (const a of availableThreatActions(galaxy, viewer, bo)) {
        if (a.kind.startsWith('giantworks.umDirective') || a.kind === INVADE_ACTION) continue; // Invade: ui/greatWorkSlots.ts
        out.push({
            label: a.label,
            hint: a.label,
            icon: a.kind === 'giantworks.logicBomb' ? BOMB_ICON : WITHDRAW_ICON,
            onClick: () => issuePlayerCommand(galaxy, viewer, 'threatAction', [a.kind, bo], redraw),
        });
    }
    return out;
}
