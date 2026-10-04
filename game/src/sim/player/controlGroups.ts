// Control groups: the C# Game.PlayerHotkey0..9 (Game.cs 48-57), set by Ctrl+digit (Main.Part7.cs Main_KeyUp
// SetControlGroup0..9: `method_225(); _Game.PlayerHotkeyN = _Game.SelectedObject;`) and read back by digit /
// Shift+digit (SelectControlGroupN: `method_208(_Game.PlayerHotkeyN)`, WithFocus also `method_157(...)`).
//
// The ten slots are saved with the game (the C# serializes its Game object), so they live on the galaxy
// (Galaxy.playerHotkeys, `declare`d: created on the first assignment) and are written through the journaled player op
// `setControlGroup` (playerOps.ts), which also carries the assignment to the sim worker's authoritative galaxy.
// Nothing in the sim reads them. Headless: no DOM / Pixi.

import type { Galaxy } from '../galaxy';
import type { BuiltObject } from '../builtObject';
import type { Habitat, SystemInfo } from '../types';
import type { ShipGroup } from '../fleets/shipGroup';
import type { Creature } from '../creature';
import type { Fighter } from '../combat/fighters';

/** The _Game.SelectedObject kinds a group can hold (BuiltObjectList as an array of ships). */
export type ControlGroupObject = BuiltObject | Habitat | ShipGroup | Creature | Fighter | SystemInfo | BuiltObject[];

/** Game.PlayerHotkey0..9: ten slots. */
export const CONTROL_GROUP_COUNT = 10;

/** _Game.PlayerHotkeyN (null when unassigned, as the C# field's default). */
export function controlGroup(galaxy: Galaxy, index: number): ControlGroupObject | null {
    const slots = galaxy.playerHotkeys;
    if (slots === undefined || index < 0 || index >= CONTROL_GROUP_COUNT) return null;
    return (slots[index] ?? null) as ControlGroupObject | null;
}

/**
 * Main.Part7.cs Main_KeyUp SetControlGroupN: `_Game.PlayerHotkeyN = _Game.SelectedObject` (null clears the slot, as
 * Ctrl+digit with nothing selected does). A ship list is copied: the C# keeps the BuiltObjectList instance that was
 * the selection, which nothing changes afterwards. False for an index outside 0-9.
 */
export function setControlGroup(galaxy: Galaxy, index: number, obj: ControlGroupObject | null): boolean {
    if (!Number.isInteger(index) || index < 0 || index >= CONTROL_GROUP_COUNT) return false;
    let slots = galaxy.playerHotkeys;
    if (slots === undefined) {
        slots = new Array<object | null>(CONTROL_GROUP_COUNT).fill(null);
        galaxy.playerHotkeys = slots;
    }
    slots[index] = Array.isArray(obj) ? obj.slice() : obj;
    return true;
}
