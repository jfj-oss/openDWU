// Task fix8ui: system culling mixes screen px (camera size) and world units
// (star position, orbit extent) correctly at every zoom.
import { describe, expect, it } from 'vitest';
import { systemInView } from '../src/render/mainView';

describe('systemInView', () => {
    it('keeps a system whose far-orbit body is on screen at 100% zoom', () => {
        // Capital moon ~16000 units from its star, camera centred on the moon.
        const starX = 2888032;
        const camX = starX - 15600;
        expect(systemInView(starX, 0, 19000, camX, 0, 1920, 1080, 1, 300)).toBe(true);
    });
    it('culls a system whose extent is entirely off screen', () => {
        expect(systemInView(100000, 0, 19000, 0, 0, 1920, 1080, 1, 300)).toBe(false);
    });
    it('scales the screen half-size by 1/zoom when zoomed out', () => {
        // At z=0.01 the screen spans 192000 world units wide.
        expect(systemInView(90000, 0, 0, 0, 0, 1920, 1080, 0.01, 0)).toBe(true);
        expect(systemInView(100000, 0, 0, 0, 0, 1920, 1080, 0.01, 0)).toBe(false);
    });
});
