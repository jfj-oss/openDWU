// [fix6ui] The game view's handler for the ship-order and selection keys (keyboard.ts SHIP_COMMAND_ACTIONS):
// E/R/A/S/`,` run shipHotkeys.ts executeShipOrderKey on the selection; Z selects the nearest available military ship
// (Main.Part4.cs 2330 kouhXgMiyR, from the view centre int_13/int_14); N/B walk the selection history
// (Main.Part10.cs 1505/1535); L toggles the view lock (Main.Part9.cs 3165 btnLockView_Click; the lock re-centres the
// view on the selection every frame, Main.Part11.cs 605, and a manual scroll unlocks it, Main.Part11.cs 2231
// method_156).

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import { BuiltObject } from '../sim/builtObject';
import { Habitat } from '../sim/types';
import { ShipGroup } from '../sim/fleets/shipGroup';
import { isObjectVisibleToThisEmpire } from '../sim/independentTraders';
import type { ShipActionSelection } from '../sim/player/executeShipAction';
import type { Selection } from './hud';
import type { ShipCommandAction } from './keyboard';
import { SelectionHistory, fastFindNearestAvailableMilitaryShip, isShipOrderKeyAction, type HistoryEntry } from './shipHotkeys';
import { issuePlayerCommand } from '../sim/player/playerCommands';
import { showToast } from './toast';

export interface ShipCommandKeyDeps {
    galaxy: Galaxy;
    player: Empire;
    camera: { x: number; y: number; zoom: number; centerOn(x: number, y: number): void };
    getSelection: () => Selection | null;
    /** selectionTarget(getSelection()) — _Game.SelectedObject for the order keys. */
    getSelected: () => ShipActionSelection;
    /** method_209(obj, bool_28: false): select without moving the view (null clears). */
    select: (obj: HistoryEntry | null) => void;
    /** pnlDetailInfo / selection buttons refresh after an order. */
    refresh: () => void;
}

export interface ShipCommandKeys {
    handle: (action: ShipCommandAction) => void;
    /** Call after every selection change (records the history, drops the lock on a cleared selection). */
    afterSelectionChange: (sel: Selection | null) => void;
    /** Call once per render frame (the view lock). */
    frame: () => void;
    readonly locked: boolean;
    readonly history: SelectionHistory;
}

/** The selected object as the C# _Game.SelectedObject (a fleet before its lead ship). */
export function selectionObject(sel: Selection | null): HistoryEntry | null {
    if (sel === null) return null;
    // A multi-ship selection (BuiltObjectList) is not a HistoryEntry kind here: no history entry, no view lock.
    if (sel.builtObjects !== undefined) return null;
    return sel.shipGroup ?? sel.builtObject ?? sel.habitat;
}

export function createShipCommandKeys(d: ShipCommandKeyDeps): ShipCommandKeys {
    const history = new SelectionHistory();
    let navigating = false;
    let locked = false;
    let lastCentre: { x: number; y: number; zoom: number } | null = null;

    const isValid = (o: HistoryEntry): boolean => {
        if (o instanceof BuiltObject) return !o.hasBeenDestroyed && isObjectVisibleToThisEmpire(d.galaxy, d.player, o);
        if (o instanceof ShipGroup) return o.ships.length > 0 && o.leadShip !== null && isObjectVisibleToThisEmpire(d.galaxy, d.player, o.leadShip);
        return o instanceof Habitat;
    };
    const navigate = (o: HistoryEntry | null): void => {
        navigating = true;
        try {
            d.select(o);
        } finally {
            navigating = false;
        }
    };
    const lockPosition = (): { x: number; y: number } | null => {
        const o = selectionObject(d.getSelection());
        if (o === null) return null;
        if (o instanceof ShipGroup) return o.leadShip !== null ? { x: o.leadShip.xpos, y: o.leadShip.ypos } : null;
        return { x: o.xpos, y: o.ypos };
    };

    return {
        history,
        get locked() {
            return locked;
        },
        handle(action) {
            if (isShipOrderKeyAction(action)) {
                // Command log: queued, applied at the next frame boundary.
                issuePlayerCommand(d.galaxy, d.player, 'shipOrderKey', [d.getSelected(), action], (changed) => changed && d.refresh());
                return;
            }
            switch (action) {
                case 'selectNearestMilitaryShip': {
                    const bo = fastFindNearestAvailableMilitaryShip(d.galaxy, d.camera.x, d.camera.y, d.player);
                    if (bo !== null) d.select(bo); // method_208: recorded in the history
                    return;
                }
                case 'selectionForward':
                    navigate(history.forward(d.getSelection() !== null, isValid));
                    return;
                case 'selectionBackward':
                    navigate(history.back(d.getSelection() !== null, isValid));
                    return;
                case 'lockView':
                    locked = !locked;
                    lastCentre = null;
                    showToast(locked ? 'View locked on the selection (L)' : 'View unlocked (L)');
                    return;
            }
        },
        afterSelectionChange(sel) {
            const o = selectionObject(sel);
            if (o === null) {
                locked = false; // Main.Part10.cs 1369
                lastCentre = null;
                return;
            }
            if (!navigating) history.push(o);
        },
        frame() {
            if (!locked) return;
            const p = lockPosition();
            if (p === null) return;
            const cam = d.camera;
            // A manual scroll (drag / edge / arrow keys) since the last frame unlocks the view (method_156); a zoom
            // keeps the lock and re-centres.
            if (lastCentre !== null && cam.zoom === lastCentre.zoom && (Math.abs(cam.x - lastCentre.x) > 1e-6 || Math.abs(cam.y - lastCentre.y) > 1e-6)) {
                locked = false;
                lastCentre = null;
                return;
            }
            cam.centerOn(p.x, p.y);
            lastCentre = { x: cam.x, y: cam.y, zoom: cam.zoom };
        },
    };
}
