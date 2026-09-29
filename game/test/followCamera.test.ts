// Follow camera (task followcam) — pure state-machine tests, no DOM/Pixi (src/render/followCamera.ts).
import { describe, expect, it } from 'vitest';
import {
    createFollowState,
    followOnSelectionChanged,
    followTargetAlive,
    followTargetPosition,
    isFollowing,
    isFollowingTarget,
    startFollow,
    stopFollow,
    toggleFollow,
    type FollowableFleet,
    type FollowableShip,
    type FollowMotionSource,
} from '../src/render/followCamera';

function fakeShip(xpos: number, ypos: number, hasBeenDestroyed = false): FollowableShip {
    return { xpos, ypos, hasBeenDestroyed };
}

function fakeFleet(leadShip: FollowableShip | null, shipCount: number): FollowableFleet {
    return { leadShip, ships: new Array<unknown>(shipCount).fill(null) };
}

describe('FollowState on/off transitions', () => {
    it('starts off', () => {
        const state = createFollowState();
        expect(isFollowing(state)).toBe(false);
    });

    it('startFollow turns it on for a given target; stopFollow turns it off', () => {
        const state = createFollowState();
        const target = fakeShip(1, 2);
        startFollow(state, target);
        expect(isFollowing(state)).toBe(true);
        expect(isFollowingTarget(state, target)).toBe(true);
        expect(isFollowingTarget(state, fakeShip(1, 2))).toBe(false); // a different (even equal-valued) object

        stopFollow(state);
        expect(isFollowing(state)).toBe(false);
        expect(isFollowingTarget(state, target)).toBe(false);
    });

    it('toggleFollow: off -> on with the given target', () => {
        const state = createFollowState();
        const target = fakeShip(0, 0);
        toggleFollow(state, target);
        expect(isFollowing(state)).toBe(true);
        expect(isFollowingTarget(state, target)).toBe(true);
    });

    it('toggleFollow: on (same target) -> off', () => {
        const state = createFollowState();
        const target = fakeShip(0, 0);
        startFollow(state, target);
        toggleFollow(state, target);
        expect(isFollowing(state)).toBe(false);
    });

    it('toggleFollow: on (a different target) -> switches to the new target (stays on)', () => {
        const state = createFollowState();
        const a = fakeShip(0, 0);
        const b = fakeShip(9, 9);
        startFollow(state, a);
        toggleFollow(state, b);
        expect(isFollowing(state)).toBe(true);
        expect(isFollowingTarget(state, b)).toBe(true);
        expect(isFollowingTarget(state, a)).toBe(false);
    });

    it('stopFollow is a no-op while already off', () => {
        const state = createFollowState();
        stopFollow(state);
        expect(isFollowing(state)).toBe(false);
    });
});

describe('followOnSelectionChanged', () => {
    it('does nothing while not following', () => {
        const state = createFollowState();
        followOnSelectionChanged(state, fakeShip(1, 1));
        expect(isFollowing(state)).toBe(false);
    });

    it('keeps following when the new selection is the same object (e.g. a live refresh re-delivering it)', () => {
        const state = createFollowState();
        const target = fakeShip(1, 1);
        startFollow(state, target);
        followOnSelectionChanged(state, target);
        expect(isFollowing(state)).toBe(true);
        expect(isFollowingTarget(state, target)).toBe(true);
    });

    it('stops following when the selection changes to a different object', () => {
        const state = createFollowState();
        const target = fakeShip(1, 1);
        const other = fakeShip(2, 2);
        startFollow(state, target);
        followOnSelectionChanged(state, other);
        expect(isFollowing(state)).toBe(false);
    });

    it('stops following when the selection is cleared (null)', () => {
        const state = createFollowState();
        startFollow(state, fakeShip(1, 1));
        followOnSelectionChanged(state, null);
        expect(isFollowing(state)).toBe(false);
    });
});

describe('followTargetAlive', () => {
    it('a ship/base is alive until hasBeenDestroyed', () => {
        expect(followTargetAlive(fakeShip(0, 0, false))).toBe(true);
        expect(followTargetAlive(fakeShip(0, 0, true))).toBe(false);
    });

    it('a fleet is alive while it has ships and a live lead ship', () => {
        const lead = fakeShip(0, 0);
        expect(followTargetAlive(fakeFleet(lead, 3))).toBe(true);
    });

    it('a disbanded fleet (ships emptied — shipGroupTasks.ts disbandShipGroup) is not alive', () => {
        const lead = fakeShip(0, 0);
        expect(followTargetAlive(fakeFleet(lead, 0))).toBe(false);
    });

    it('a fleet with no lead ship is not alive', () => {
        expect(followTargetAlive(fakeFleet(null, 3))).toBe(false);
    });

    it('a fleet whose lead ship was destroyed is not alive', () => {
        const lead = fakeShip(0, 0, true);
        expect(followTargetAlive(fakeFleet(lead, 3))).toBe(false);
    });
});

describe('followTargetPosition (camera target = drawn position)', () => {
    /** A fake MotionInterpolator: drawn positions keyed by object identity (a Map), so the test can tell exactly
     * which object the function asked for. */
    function motionSourceFrom(drawnByIdentity: Map<object, { x: number; y: number }>): FollowMotionSource {
        return { drawn: (obj) => drawnByIdentity.get(obj) ?? null };
    }

    it('a ship uses its own drawn (render-interpolated) position when sampled this frame', () => {
        const ship = fakeShip(100, 200);
        const motion = motionSourceFrom(new Map([[ship, { x: 111, y: 222 }]]));
        expect(followTargetPosition(motion, ship)).toEqual({ x: 111, y: 222 });
    });

    it('a ship falls back to its committed xpos/ypos when not sampled this frame (drawn() returns null)', () => {
        const ship = fakeShip(100, 200);
        const motion = motionSourceFrom(new Map());
        expect(followTargetPosition(motion, ship)).toEqual({ x: 100, y: 200 });
    });

    it('a fleet uses its lead ship\'s drawn position, not the fleet object itself', () => {
        const lead = fakeShip(5, 6);
        const fleet = fakeFleet(lead, 4);
        const motion = motionSourceFrom(new Map([[lead, { x: 55, y: 66 }]]));
        expect(followTargetPosition(motion, fleet)).toEqual({ x: 55, y: 66 });
    });

    it('a fleet falls back to its lead ship\'s committed position when not sampled this frame', () => {
        const lead = fakeShip(5, 6);
        const fleet = fakeFleet(lead, 4);
        const motion = motionSourceFrom(new Map());
        expect(followTargetPosition(motion, fleet)).toEqual({ x: 5, y: 6 });
    });

    it('through a jump, the drawn position already reflects the snap (MotionInterpolator.sample), so this needs no separate smoothing', () => {
        // Simulates a hyperjump exit: renderInterp.ts's MotionInterpolator snaps px/py/cx/cy to the new location the
        // instant a jump is detected, so drawn() already returns the post-jump point — followTargetPosition just
        // has to read it every frame, with no easing of its own.
        const ship = fakeShip(0, 0);
        const motion = motionSourceFrom(new Map([[ship, { x: 9000, y: -4000 }]]));
        expect(followTargetPosition(motion, ship)).toEqual({ x: 9000, y: -4000 });
    });
});
