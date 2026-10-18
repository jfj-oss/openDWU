// Giantworks capture (not in the original): Invade and Ground Report as action buttons in the free slots of the selection panel's
// eight (orderMenu.ts setSelectionFreeSlots, like the Ultramind's directives), shown while a finished Great Work whose shields are
// down (or whose ground war is on) is selected. Invade is the journaled 'threatAction' player command (multiplayer- and
// replay-safe); Ground Report opens the stock Ground Report window on the work (screens/groundReport.ts). Icons drawn here (SVG).

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import type { BuiltObject } from '../sim/builtObject';
import { issuePlayerCommand } from '../sim/player/playerCommands';
import { INVADE_ACTION, captureView } from '../sim/scenario/threats/giantworks/capture';
import { scenarioText } from '../sim/scenario/messages';
import { openGreatWorkGroundReport } from './screens/groundReport';

function svgIcon(body: string, stroke = '#b8c4e0'): string {
    return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="${stroke}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`)}`;
}
/** Invade: a landing pod coming down on a dome. Ground Report: two lines facing each other across a front. */
const INVADE_ICON = svgIcon('<path d="M5 27h22"/><path d="M8 27a8 8 0 0 1 16 0"/><path d="M16 3v9M12 8l4 4 4-4"/>', '#ffd060');
const REPORT_ICON = svgIcon('<path d="M16 4v24" stroke-dasharray="3 3"/><circle cx="9" cy="10" r="2.5"/><circle cx="9" cy="20" r="2.5"/><circle cx="23" cy="10" r="2.5"/><circle cx="23" cy="20" r="2.5"/>');

export interface GreatWorkSlot {
    label: string;
    hint: string;
    icon: string;
    disabled?: boolean;
    onClick: () => void;
}

/** The buttons for the selected object `bo` as seen by `viewer` (empty unless it is a Great Work whose shields are down or whose ground war is on). */
export function greatWorkSlots(galaxy: Galaxy, viewer: Empire, bo: BuiltObject | null | undefined, redraw: () => void): GreatWorkSlot[] {
    if (galaxy.scenario === null || bo === null || bo === undefined) return [];
    const v = captureView(galaxy, bo, viewer);
    if (v === null || (!v.breached && v.rec.invaders.count === 0)) return [];
    const out: GreatWorkSlot[] = [];
    if (v.landingOpen && v.defender !== viewer) {
        const label = scenarioText('Giantworks Capture Action Invade');
        const why = v.canInvade ? '' : ' (no ship of ours with troops aboard is close enough)';
        out.push({ label, hint: `${label}${why}. The shields are down for ${v.windowDays} more days.`, icon: INVADE_ICON, disabled: !v.canInvade, onClick: () => issuePlayerCommand(galaxy, viewer, 'threatAction', [INVADE_ACTION, bo], redraw) });
    }
    out.push({ label: 'Ground Report', hint: `Ground Report: the fight for ${bo.name} (its garrison, the invaders, the strengths)`, icon: REPORT_ICON, onClick: () => void openGreatWorkGroundReport(bo) });
    return out;
}
