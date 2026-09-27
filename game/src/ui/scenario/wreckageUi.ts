// Scenario 19e-7 "battle wreckage & salvage": pure UI helpers — the wreck-field markers / tooltip the map overlay draws,
// the selection panel's "Salvage" row and the right-click "Salvage" entry. Not a port (scenario UI); no DOM here.
import type { Galaxy } from '../../sim/galaxy';
import type { Empire } from '../../sim/empire';
import type { BuiltObject } from '../../sim/builtObject';
import { scenarioFlag, scenarioText } from '../../sim/scenario';
import {
    WRECKAGE_FLAG,
    isSalvageShip,
    salvageJobOf,
    wreckFieldAtPoint,
    wreckFieldById,
    wreckFieldKnownTo,
    wreckFieldSummary,
    wreckFields,
    type WreckField,
} from '../../sim/scenario/wreckage/common';
import type { OrderMenuItem } from '../../sim/player/orderMenu';

/** Marker colour (rust orange: distinct from the yellow overlay rings and the threat amber / red). */
export const WRECK_MARKER_COLOR = 0xc87a3c;

/** The fields the player's map shows (known to the player; nothing without the scenario flag). */
export function visibleWreckFields(galaxy: Galaxy, player: Empire | null): WreckField[] {
    if (player === null || !scenarioFlag(galaxy, WRECKAGE_FLAG)) return [];
    return wreckFields(galaxy).filter((f) => f.wrecks.length > 0 && wreckFieldKnownTo(player, f));
}

/** Marker geometry at zoom z: a ring around the field extent, at least 12 px. */
export function wreckMarker(f: WreckField, z: number): { x: number; y: number; r: number } {
    return { x: f.x, y: f.y, r: Math.max(f.location.width / 2, 12 / z) };
}

/** The visible field under the world point (hover / right click), with a 14 px pick slack. */
export function wreckFieldHit(galaxy: Galaxy, player: Empire | null, x: number, y: number, z: number): WreckField | null {
    if (player === null || !scenarioFlag(galaxy, WRECKAGE_FLAG)) return null;
    const f = wreckFieldAtPoint(galaxy, x, y, 14 / z);
    return f !== null && f.wrecks.length > 0 && wreckFieldKnownTo(player, f) ? f : null;
}

/** Tooltip: field name, ship count, value. */
export function wreckTooltipText(galaxy: Galaxy, f: WreckField): string {
    const s = wreckFieldSummary(galaxy, f);
    return `${s.name} — ${s.ships} ${s.ships === 1 ? 'wreck' : 'wrecks'} · salvage value ${s.value.toLocaleString('en-US')}`;
}

/** The selected ship that may salvage for the player (own construction / mining ship), else null. */
export function salvageShipOf(galaxy: Galaxy, player: Empire | null, selected: unknown): BuiltObject | null {
    if (player === null || !scenarioFlag(galaxy, WRECKAGE_FLAG) || selected === null || typeof selected !== 'object') return null;
    const bo = selected as BuiltObject;
    if (typeof (bo as { builtObjectID?: unknown }).builtObjectID !== 'number' || bo.hasBeenDestroyed) return null;
    if (bo.actualEmpire !== player || !isSalvageShip(bo)) return null;
    return bo;
}

/** The right-click entry "Salvage <field>" for the selected ship at a field (null: none applies). */
export function wreckSalvageMenuItem(galaxy: Galaxy, player: Empire | null, selected: unknown, x: number, y: number, z: number): { item: OrderMenuItem; ship: BuiltObject; field: WreckField } | null {
    const ship = salvageShipOf(galaxy, player, selected);
    if (ship === null) return null;
    const field = wreckFieldHit(galaxy, player, x, y, z);
    if (field === null) return null;
    const label = scenarioText('Scenario Wreckage Salvage Menu', field.name);
    const item: OrderMenuItem = {
        key: 'Scenario Wreckage Salvage Menu',
        label,
        hint: scenarioText('Scenario Wreckage Salvage Hint', field.wrecks.length, field.name),
        enabled: true,
        action: null,
        children: [],
        separator: false,
    };
    return { item, ship, field };
}

/** The selection panel's "Salvage" row for a ship (its job, or the nearest known field it could salvage). */
export function wreckSalvageRows(galaxy: Galaxy, bo: BuiltObject, player: Empire | null): { label: string; value: string }[] {
    if (player === null || !scenarioFlag(galaxy, WRECKAGE_FLAG) || bo.actualEmpire !== player || !isSalvageShip(bo)) return [];
    const job = salvageJobOf(galaxy, bo);
    if (job !== null) {
        const field = wreckFieldById(galaxy, job.fieldId);
        const where = field?.name ?? 'debris field';
        if (job.phase === 'return') return [{ label: 'Salvage', value: `Returning salvage to ${job.port?.name ?? 'port'}` }];
        return [{ label: 'Salvage', value: job.arrivedStarDate >= 0 ? `Salvaging ${where}` : `En route to ${where}` }];
    }
    let best: WreckField | null = null;
    let bestD = Number.MAX_VALUE;
    for (const f of visibleWreckFields(galaxy, player)) {
        const d = galaxy.calculateDistance(bo.xpos, bo.ypos, f.x, f.y);
        if (d < bestD) {
            best = f;
            bestD = d;
        }
    }
    if (best === null) return [];
    const s = wreckFieldSummary(galaxy, best);
    return [{ label: 'Salvage', value: `${s.name}: ${s.ships} wrecks, value ${s.value.toLocaleString('en-US')} (right-click it to salvage)` }];
}
