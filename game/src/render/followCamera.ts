// Follow camera (task followcam): a toggle in the bottom-left selection panel lets the player keep the Main
// View centred on a selected ship or fleet while it moves or warps. This is a render/UI-only feature with no
// equivalent in the original — DW:U's decompiled source (Main.Part*.cs, Start*.cs) has no "follow" / "track" /
// "lock camera" concept and no per-frame CenterOn-the-selection pass, so there is nothing to port here; this
// module is new.
//
// The state machine (`FollowState` + the functions below it) is pure and DOM/Pixi-free so it can be unit-tested
// on its own. It is driven from three places:
// - src/ui/hud.ts: the toggle button (start/stop/toggle) and `followOnSelectionChanged` (a new selection, or a
//   deselect, stops following unless it is the same object already being followed — e.g. a live refresh
//   re-delivering the same fleet).
// - src/render/mainView.ts: recentres the camera on `followTargetPosition` every frame while following, and
//   stops it (`stopFollow`) on a manual drag/edge-scroll or when `followTargetAlive` goes false (the ship was
//   destroyed, or the fleet disbanded — src/sim/fleets/shipGroupTasks.ts disbandShipGroup empties `ships`).
// - src/ui/keyboard.ts: stops it on a keyboard scroll (arrow keys).
// Wheel-zoom is untouched by all three, so zooming keeps following, per spec.

/** Follow-camera state: `target` is the followed object's identity (a BuiltObject for a ship/base, a ShipGroup
 * for a fleet — compared by reference), or null while off. One instance is shared by the HUD (toggles it) and
 * the Main View (reads/recentres/clears it every frame). */
export interface FollowState {
    target: object | null;
}

export function createFollowState(): FollowState {
    return { target: null };
}

export function isFollowing(state: FollowState): boolean {
    return state.target !== null;
}

/** True while `target` is the one currently followed (used by the toggle button to render its pressed state). */
export function isFollowingTarget(state: FollowState, target: object): boolean {
    return state.target === target;
}

export function startFollow(state: FollowState, target: object): void {
    state.target = target;
}

export function stopFollow(state: FollowState): void {
    state.target = null;
}

/** The toggle button's handler: off (or following something else) -> on with `target`; already following
 * `target` -> off. */
export function toggleFollow(state: FollowState, target: object): void {
    if (state.target === target) stopFollow(state);
    else startFollow(state, target);
}

/** Call on every selection change (click, cycle chip, hotkey, fleets list, "Go to", or a deselect to null):
 * stops following unless the new selection is the exact object already being followed, so following survives a
 * re-delivery of the same selection (the selection panel's periodic live refresh, or clicking the same chip)
 * but not a change to something else or to nothing. */
export function followOnSelectionChanged(state: FollowState, newTarget: object | null): void {
    if (state.target !== null && state.target !== newTarget) stopFollow(state);
}

/** A followable ship/base (BuiltObject fields sampleBuiltObject/renderInterp.ts already reads). */
export interface FollowableShip {
    xpos: number;
    ypos: number;
    hasBeenDestroyed: boolean;
}

/** A followable fleet (ShipGroup fields): src/sim/fleets/shipGroupTasks.ts disbandShipGroup empties `ships` (and
 * shipGroupUpdate reassigns `leadShip`, or clears it once no ship is left) — `ships.length` is the reliable
 * "disbanded" signal; `leadShip` may go stale for one tick in between. */
export interface FollowableFleet {
    leadShip: FollowableShip | null;
    ships: readonly unknown[];
}

export type FollowTarget = FollowableShip | FollowableFleet;

function isFleet(target: FollowTarget): target is FollowableFleet {
    return 'leadShip' in target;
}

/** True while `target` is still valid to keep following: a ship/base not yet destroyed, or a fleet that still
 * has ships and a live (not destroyed) lead ship. False stops the follow camera (mainView.ts). */
export function followTargetAlive(target: FollowTarget): boolean {
    if (isFleet(target)) {
        return target.ships.length > 0 && target.leadShip !== null && !target.leadShip.hasBeenDestroyed;
    }
    return !target.hasBeenDestroyed;
}

/** The MotionInterpolator surface followTargetPosition needs (structural, so tests can fake it without pulling
 * in Pixi/renderInterp.ts). */
export interface FollowMotionSource {
    drawn(obj: object): { x: number; y: number } | null;
}

/** The world point to centre the camera on this frame: the target's drawn (render-interpolated) position — for
 * a fleet, its lead ship's. Falls back to the committed xpos/ypos when the object has not been sampled this
 * frame yet (e.g. the very first frame after selecting), the same fallback the selection ring uses
 * (mainView.ts). Through a hyperjump, MotionInterpolator.sample() snaps its drawn position immediately (no lerp
 * across the jump), so recomputing this every frame is enough to keep the camera cut with the ship instead of
 * lagging behind — no separate camera-side smoothing is needed. Call only when followTargetAlive(target). */
export function followTargetPosition(motion: FollowMotionSource, target: FollowTarget): { x: number; y: number } {
    const ship = isFleet(target) ? (target.leadShip as FollowableShip) : target;
    const d = motion.drawn(ship);
    return d !== null ? { x: d.x, y: d.y } : { x: ship.xpos, y: ship.ypos };
}
