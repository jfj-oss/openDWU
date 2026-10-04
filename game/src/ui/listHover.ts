// Hovering a left-sidebar list row (ItemListPanel.cs 2291-2389): when the hovered item changes, the previous item's
// ping is removed (Main.Part9.cs 795 method_245), the new item's location gets one (759 method_243: the yellow
// method_232 circle in the main view), and SpecialHighlightBuiltObjects (870 method_246: red travel vectors) becomes
// the ships flying the hovered pirate mission (Empire.6.cs 1233 DetermineShipsAssignedToMission), else — with a
// StellarObject selected — the player's ships travelling to the selection (Empire.6.cs 1165
// DetermineShipsMovingToDestination). Both lists live in render/mapHighlights.ts, which the overlay layer draws.
//
// Every list panel does this (Enemy Targets, Pirate Missions, the ship / colony / fleet / character lists). Read-only on
// the game (the replica in sim-worker mode).

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import { ShipGroup } from '../sim/fleets/shipGroup';
import { Character } from '../sim/characters';
import { GalaxyLocation } from '../sim/galaxyLocation';
import { EmpireActivity } from '../sim/pirates/empireActivity';
import { determineShipsAssignedToMission } from '../sim/pirates/pirateMissionsPanel';
import { mapHighlightsOf, selectedStellarObject, shipsMovingToDestination, type SelectedObjectLike } from '../render/mapHighlights';
import type { BuiltObject } from '../sim/builtObject';
import { EnemyTargetItem, type PanelItem } from './leftSidebar';

/** The object a row pings (ItemListPanel.cs 2296-2335 / 2339-2383, before method_243 / method_245). */
export function listItemPingObject(item: PanelItem): unknown {
    if (item instanceof ShipGroup) return item.leadShip;
    if (item instanceof Character) return item.location;
    // `new Point((int)galaxyLocation.Xpos, (int)galaxyLocation.Ypos)`.
    if (item instanceof GalaxyLocation) return { x: Math.trunc(item.xpos), y: Math.trunc(item.ypos) };
    if (item instanceof EmpireActivity) return item.target;
    // PrioritizedTarget: a fleet target pings its lead ship.
    if (item instanceof EnemyTargetItem) return item.target instanceof ShipGroup ? item.target.leadShip : item.target;
    return item;
}

/** The selection the hover falls back to (`_Game.SelectedObject`), installed by the HUD. */
let selectionSource: () => SelectedObjectLike = () => null;
export function setListHoverSelectionSource(fn: () => SelectedObjectLike): void {
    selectionSource = fn;
}

/**
 * ItemListPanel.cs 2291-2389, `if (hoveredItem != object_0)`: `previous` was hovered, `hovered` is now (either null).
 * No-op when they are the same item.
 */
export function itemListHoverChanged(galaxy: Galaxy, player: Empire, previous: PanelItem | null, hovered: PanelItem | null, selected: SelectedObjectLike = selectionSource()): void {
    if (previous === hovered) return;
    const h = mapHighlightsOf(galaxy);
    let list: BuiltObject[] | null = null;
    if (previous !== null) {
        const o = listItemPingObject(previous);
        // 2312-2316: an EmpireActivity without a Target removes nothing.
        if (o !== null && o !== undefined) h.removeEventPings(o);
    }
    if (hovered !== null) {
        const o = listItemPingObject(hovered);
        if (o !== null && o !== undefined) h.addEventPing(o);
        if (hovered instanceof EmpireActivity) list = determineShipsAssignedToMission(galaxy, player, hovered);
    }
    if (list === null || list.length === 0) {
        const target = selectedStellarObject(selected);
        if (target !== null) list = [...shipsMovingToDestination(player, target)];
    }
    h.setSpecialHighlight(list);
}
