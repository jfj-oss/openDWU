// Veterans add-on (scenarios/veterans; not in the original): the selection panel's "Make flagship" action button, in a free
// slot of the eight like Intercept / Mothball (orderMenu.ts setSelectionFreeSlots; the More menu when none is free). With
// one of your warships selected that sits in a fleet of two or more: a click makes it the fleet's flagship. With such a
// fleet selected: a click (or right-click) lists its ships to choose from (the current flagship marked). The order is
// the journaled player command 'makeFlagship'; this file only reads. Nothing shows when the add-on is off. The icon is
// drawn here (SVG), no art files.

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import type { BuiltObject } from '../sim/builtObject';
import { ShipGroup } from '../sim/fleets/shipGroup';
import { BuiltObjectRole } from '../sim/data/designSpecifications';
import { issuePlayerCommand } from '../sim/player/playerCommands';
import { fleetFlagship, makeFlagshipUnavailableReason, veteranShipLabel, veteransOn, type FlagshipCommandResult } from '../sim/scenario/veterans/veterans';
import { showToast } from './toast';

export const FLAGSHIP_TITLE = 'Make flagship: the fleet fights a little better near its flagship; if the flagship is destroyed the whole fleet fights worse for a while until it reforms';

function svgIcon(body: string): string {
    return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="#b8c4e0" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`)}`;
}
/** A pennant on a mast. */
export const FLAGSHIP_ICON = svgIcon('<path d="M10 28V4"/><path d="M10 5h15l-4 5 4 5H10" fill="#e0c040" stroke="#e0c040"/>');

export interface FlagshipChoice {
    label: string;
    hint: string;
    chosen: boolean;
    disabled: boolean;
    pick: () => void;
}

export interface FlagshipSlotModel {
    label: string;
    icon: string;
    hint: string;
    disabled: boolean;
    /** A click opens `choices` instead of calling `click` (a fleet is selected). */
    listOnClick: boolean;
    click: () => void;
    choices: FlagshipChoice[];
}

function done(r: unknown): void {
    showToast((r as FlagshipCommandResult).message);
}

/** The Make flagship button for `sel` (an own warship in a fleet, or an own fleet of two or more); null otherwise. */
export function flagshipSlot(galaxy: Galaxy, empire: Empire, sel: { shipGroup?: ShipGroup; builtObject?: BuiltObject; builtObjects?: BuiltObject[] } | null): FlagshipSlotModel | null {
    if (!veteransOn(galaxy) || sel === null || (sel.builtObjects !== undefined && sel.builtObjects.length > 0)) return null;
    const pick = (b: BuiltObject) => (): void => issuePlayerCommand(galaxy, empire, 'makeFlagship', [b], done);
    if (sel.shipGroup !== undefined) {
        const g = sel.shipGroup;
        if (g.empire !== empire) return null;
        const ships = g.ships.filter((b) => b.role === BuiltObjectRole.Military && !b.hasBeenDestroyed);
        if (ships.length < 2) return null;
        const cur = fleetFlagship(galaxy, g);
        const choices: FlagshipChoice[] = ships.map((b) => {
            const why = makeFlagshipUnavailableReason(galaxy, empire, b);
            const crew = veteranShipLabel(galaxy, b);
            return {
                label: `${b === cur ? '★ ' : ''}${b.name}${crew !== null ? ` — ${crew}` : ''}`,
                hint: why !== null ? why : `Make ${b.name} the flagship of ${g.name ?? 'the fleet'}`,
                chosen: b === cur,
                disabled: why !== null,
                pick: pick(b),
            };
        });
        return { label: 'Make flagship', icon: FLAGSHIP_ICON, hint: `${FLAGSHIP_TITLE} (choose the ship)`, disabled: false, listOnClick: true, click: () => {}, choices };
    }
    const b = sel.builtObject;
    if (b === undefined || b.empire !== empire || !(b.shipGroup instanceof ShipGroup)) return null;
    const why = makeFlagshipUnavailableReason(galaxy, empire, b);
    if (why !== null) return { label: 'Make flagship', icon: FLAGSHIP_ICON, hint: `${FLAGSHIP_TITLE} (${why})`, disabled: true, listOnClick: false, click: () => {}, choices: [] };
    return { label: 'Make flagship', icon: FLAGSHIP_ICON, hint: `Make ${b.name} the flagship of ${b.shipGroup.name ?? 'its fleet'}. ${FLAGSHIP_TITLE}`, disabled: false, listOnClick: false, click: pick(b), choices: [] };
}
