// UI fixes: markers follow the drawn ship position, no camera jump when the order menu opens, asteroids are pickable.
import { describe, expect, it } from 'vitest';
import { rightClickCentersView, type OrderMenuItem, type RightClickResult } from '../src/sim/player/orderMenu';
import { MotionInterpolator, createRenderTime, drawnBuiltObjectPos, sampleBuiltObject } from '../src/render/renderInterp';
import { ROCK_MIN_ZOOM, asteroidDrawnPx, hitTestHabitats } from '../src/render/mainView';
import { Habitat, HabitatCategoryType, HabitatType } from '../src/sim/types';

describe('right click opening the order menu leaves the camera where it was', () => {
    const items = [{ key: 'a' }] as unknown as OrderMenuItem[];
    const center: RightClickResult = { kind: 'center' };
    it('does not re-centre when the action menu opens on that click', () => {
        expect(rightClickCentersView(center, items)).toBe(false);
    });
    it('still re-centres (original behaviour) when nothing opens', () => {
        expect(rightClickCentersView(center, null)).toBe(true);
        expect(rightClickCentersView(center, [])).toBe(true);
    });
    it('never re-centres for the other outcomes', () => {
        expect(rightClickCentersView({ kind: 'none' }, null)).toBe(false);
        expect(rightClickCentersView({ kind: 'order', executed: true, attackClick: false }, null)).toBe(false);
    });
});

describe('ship overlays read the same drawn position as the ship sprite', () => {
    const UNSET = -2000000001.0;
    it('the marker position equals the sprite sample for a moving ship, every frame between steps', () => {
        const ship = { xpos: 5_000_000, ypos: 3_000_000, heading: 0, topSpeed: 600, warpSpeed: 0, currentSpeed: 100, parentHabitat: null, parentOffsetX: UNSET, parentOffsetY: UNSET };
        const m = new MotionInterpolator();
        const rt = createRenderTime();
        rt.stepGameMs = 1000 / 60;
        m.begin(rt, 10);
        sampleBuiltObject(m, ship);
        for (let step = 1; step <= 3; step++) {
            ship.xpos += 10;
            rt.stepSerial = step;
            for (const alpha of [0, 0.25, 0.5, 0.75]) {
                rt.alpha = alpha;
                m.begin(rt, 10);
                const sprite = sampleBuiltObject(m, ship); // BuiltObjectLayer, first in the frame
                const spriteX = sprite.x;
                const spriteY = sprite.y;
                const marker = drawnBuiltObjectPos(m, ship); // markers / combat bars / selection ring, later
                expect(marker.x).toBe(spriteX);
                expect(marker.y).toBe(spriteY);
                expect(m.positionOf(ship).x).toBe(spriteX);
                expect(marker.x).toBeCloseTo(ship.xpos - 10 + 10 * alpha, 6);
            }
        }
    });
});

describe('asteroids are pickable (drawn rock size, at least 6 px)', () => {
    const star = new Habitat(HabitatCategoryType.Star, HabitatType.MainSequence, 'star', 0, 0);
    const rock = new Habitat(HabitatCategoryType.Asteroid, HabitatType.BarrenRock, 'rock', star, 0.3, true, 40_000, 10);
    rock.diameter = 20;
    const size = (h: Habitat, z: number): number => (h.category === HabitatCategoryType.Asteroid && z > ROCK_MIN_ZOOM ? asteroidDrawnPx(h.diameter, z) : 0);
    it('draws world-linear: diameter * zoom * 0.45', () => {
        expect(asteroidDrawnPx(20, 2)).toBeCloseTo(18);
    });
    it('is hit within 6 px of the rock even when it draws smaller, and not beyond', () => {
        const z = 0.5; // rock draws 4.5 px
        const p = { x: rock.xpos, y: rock.ypos };
        expect(hitTestHabitats([rock], p.x + 5 / z, p.y, size, z)).toBe(rock);
        expect(hitTestHabitats([rock], p.x + 7 / z, p.y, size, z)).toBeNull();
    });
    it('is hit at its interpolated drawn position, not the committed one', () => {
        const z = 1;
        const drawn = { x: rock.xpos + 500, y: rock.ypos };
        expect(hitTestHabitats([rock], drawn.x, drawn.y, size, z, () => drawn)).toBe(rock);
        expect(hitTestHabitats([rock], rock.xpos, rock.ypos, size, z, () => drawn)).toBeNull();
    });
    it('is not hit when rocks are not drawn (below the rock zoom)', () => {
        expect(hitTestHabitats([rock], rock.xpos, rock.ypos, size, ROCK_MIN_ZOOM)).toBeNull();
    });
});
