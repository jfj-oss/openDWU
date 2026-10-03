// [parC1] Control groups: the game view's handler for the 0-9 keys (keyboard.ts setControlGroupHandler).
//
// Ports of Main.Part7.cs Main_KeyUp:
//   SetControlGroupN            Ctrl+N   method_225() (grid.wav); _Game.PlayerHotkeyN = _Game.SelectedObject
//   SelectControlGroupN         N        method_208(_Game.PlayerHotkeyN)
//   SelectControlGroupNWithFocus Shift+N method_208(_Game.PlayerHotkeyN); method_157(_Game.PlayerHotkeyN)
// (default keys: ExpansionMod GameHotKeysMappingFile.json, KeyCode 48-57 with 17 = Ctrl / 16 = Shift.)
//
// method_208 → method_209(obj, bool_28: true) (Main.Part10.cs:1265): outside GodMode an object the player cannot see is
// not selected (a ship / creature not visible, a habitat in an unexplored system, a fleet whose lead ship is not
// visible, a ship list with any ship not visible); null clears the selection. method_157 (Main.Part11.cs:2241) centres
// the view on the object (int_13 / int_14 + method_149), keeping the zoom.
//
// The groups are game state saved with the game (C# Game.PlayerHotkey0..9 → Galaxy.playerHotkeys), so an assignment is
// the journaled player op `setControlGroup` (sim/player/controlGroups.ts); in sim-worker mode it reaches the
// authoritative galaxy and comes back with the sync. Until the op is applied (the next frame boundary, one round trip
// in worker mode) the key reads the assignment from `pending`, so Ctrl+1 then 1 selects at once, as in the C#.

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import { BuiltObject } from '../sim/builtObject';
import { Habitat, type SystemInfo } from '../sim/types';
import { ShipGroup } from '../sim/fleets/shipGroup';
import { Creature } from '../sim/creature';
import { Fighter } from '../sim/combat/fighters';
import { SystemVisibilityStatus } from '../sim/visibility';
import { isObjectVisibleToThisEmpire } from '../sim/independentTraders';
import { controlGroup, type ControlGroupObject } from '../sim/player/controlGroups';
import { issuePlayerCommand } from '../sim/player/playerCommands';
import { creatureVisibleToEmpire } from '../render/creatureLayer';
import type { Selection } from './hud';
import type { ControlGroupKeyKind } from './keyboard';

/** A SystemInfo of the galaxy (a plain object: galaxy.systems[star.systemIndex]). */
function isSystemInfo(galaxy: Galaxy, o: object): o is SystemInfo {
    const s = o as SystemInfo;
    return s.systemStar instanceof Habitat && galaxy.systems[s.systemStar.systemIndex] === o;
}

/** The HUD selection as the C# _Game.SelectedObject: a ship list, a fleet, a creature, a ship / base, a system (the
 *  galaxy-zoom star selection, InfoPanel DrawSystemInfo) or a habitat. */
export function selectedGameObject(sel: Selection | null): ControlGroupObject | null {
    if (sel === null) return null;
    if (sel.builtObjects !== undefined && sel.builtObjects.length > 0) return sel.builtObjects;
    if (sel.shipGroup !== undefined) return sel.shipGroup;
    if (sel.creature !== undefined) return sel.creature;
    if (sel.builtObject !== undefined) return sel.builtObject;
    if (sel.systemInfo === true) return sel.system;
    return sel.habitat;
}

/** Port of the method_209 visibility gate (Main.Part10.cs:1276-1318): may `obj` be selected? */
export function controlGroupSelectable(galaxy: Galaxy, player: Empire, obj: ControlGroupObject, godMode: boolean): boolean {
    if (godMode) return true;
    if (obj instanceof BuiltObject) return isObjectVisibleToThisEmpire(galaxy, player, obj);
    if (obj instanceof Fighter) return isObjectVisibleToThisEmpire(galaxy, player, obj);
    if (obj instanceof Habitat) return player.visibility.checkSystemVisibilityStatus(obj.systemIndex) !== SystemVisibilityStatus.Unexplored;
    if (obj instanceof Creature) return creatureVisibleToEmpire(galaxy, player, obj);
    if (obj instanceof ShipGroup) {
        // IsObjectVisibleToThisEmpire(LeadShip): a fleet without a lead ship (disbanded) is not selected.
        return obj.leadShip !== null && isObjectVisibleToThisEmpire(galaxy, player, obj.leadShip);
    }
    if (Array.isArray(obj)) {
        for (const bo of obj) if (!isObjectVisibleToThisEmpire(galaxy, player, bo)) return false;
        return true;
    }
    // A SystemInfo: method_209 has no test for it.
    return true;
}

/** Port of method_157 (Main.Part11.cs:2241): the point the view centres on, or null (an empty ship list, a fleet
 *  without a lead ship). */
export function controlGroupFocusPoint(galaxy: Galaxy, obj: ControlGroupObject | null): { x: number; y: number } | null {
    if (obj === null) return null;
    if (obj instanceof ShipGroup) return obj.leadShip !== null ? { x: Math.trunc(obj.leadShip.xpos), y: Math.trunc(obj.leadShip.ypos) } : null;
    if (Array.isArray(obj)) return obj.length > 0 ? { x: Math.trunc(obj[0].xpos), y: Math.trunc(obj[0].ypos) } : null;
    if (isSystemInfo(galaxy, obj)) return { x: Math.trunc(obj.systemStar.xpos), y: Math.trunc(obj.systemStar.ypos) };
    const o = obj as { xpos: number; ypos: number };
    return { x: Math.trunc(o.xpos), y: Math.trunc(o.ypos) };
}

export interface ControlGroupDeps {
    galaxy: Galaxy;
    player: Empire;
    camera: { centerOn(x: number, y: number): void };
    getSelection: () => Selection | null;
    /** Apply `obj` as the HUD selection without moving the view (null clears it). */
    select: (obj: ControlGroupObject | null) => void;
    /** _Game.GodMode (the `?godMode=1` / `?reveal=1` dev toggle, fog.ts). */
    godMode: () => boolean;
    /** method_225: grid.wav at the effects volume (gameAudio.ts playGridClick). */
    playSetSound?: () => void;
}

export interface ControlGroupKeys {
    handle: (kind: ControlGroupKeyKind, index: number) => void;
    /** The group's object as the keys see it (a pending assignment first). */
    group: (index: number) => ControlGroupObject | null;
}

export function createControlGroupKeys(d: ControlGroupDeps): ControlGroupKeys {
    /** Assignments issued and not applied yet, by slot (the latest per slot). */
    const pending = new Map<number, { obj: ControlGroupObject | null; seq: number }>();
    let seq = 0;
    const group = (index: number): ControlGroupObject | null => {
        const p = pending.get(index);
        return p !== undefined ? p.obj : controlGroup(d.galaxy, index);
    };
    return {
        group,
        handle(kind, index) {
            if (kind === 'set') {
                d.playSetSound?.();
                const sel = selectedGameObject(d.getSelection());
                const obj = Array.isArray(sel) ? sel.slice() : sel;
                const mine = ++seq;
                pending.set(index, { obj, seq: mine });
                issuePlayerCommand(d.galaxy, d.player, 'setControlGroup', [index, obj], () => {
                    if (pending.get(index)?.seq === mine) pending.delete(index);
                });
                return;
            }
            const obj = group(index);
            if (obj === null) {
                d.select(null); // method_209(null): the selection is cleared
                return;
            }
            if (!controlGroupSelectable(d.galaxy, d.player, obj, d.godMode())) return;
            d.select(obj);
            if (kind === 'selectWithFocus') {
                const p = controlGroupFocusPoint(d.galaxy, obj);
                if (p !== null) d.camera.centerOn(p.x, p.y);
            }
        },
    };
}
