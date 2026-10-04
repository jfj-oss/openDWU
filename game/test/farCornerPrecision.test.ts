// Far-corner float32 precision: a 90x90-sector galaxy reaches ~1.8e8 world units, where float32 resolves ~16 units.
// Content in its own Pixi render group (galaxyMarkers overlayG / selG) has group-LOCAL float32 vertices and a float32
// group matrix on the GPU; the fix draws it relative to the camera centre with the wrapper at the centre (float64).
import { describe, expect, it } from 'vitest';

const f32 = Math.fround;
const FAR = 1.8e8;

/** Screen px of world point (wx) through a render group: vertex stored float32 in group space, the group matrix
 *  (scale z, translation tx) float32 on the GPU. `origin` is the wrapper position (0 = the old, unrebased draw). */
function gpuScreenX(wx: number, camX: number, z: number, viewW: number, origin: number): number {
    const worldTx = viewW / 2 - camX * z; // float64 on the CPU (world container)
    const vertex = f32(wx - origin);
    const scale = f32(z);
    const tx = f32(worldTx + origin * z); // wrapper position folded in on the CPU in float64
    return f32(f32(vertex * scale) + tx);
}

describe('far corner (1.8e8) render-group precision', () => {
    for (const z of [1, 0.1, 0.01]) {
        it(`rebased draw stays within 0.5 px at zoom ${z}`, () => {
            const cam = FAR - 12345.678;
            let worstOld = 0;
            let worstNew = 0;
            for (let i = 0; i < 400; i++) {
                const wx = cam + (i - 200) * 2.37 / z + 0.31; // a slowly moving ship on screen
                const exact = 1920 / 2 + (wx - cam) * z;
                worstOld = Math.max(worstOld, Math.abs(gpuScreenX(wx, cam, z, 1920, 0) - exact));
                worstNew = Math.max(worstNew, Math.abs(gpuScreenX(wx, cam, z, 1920, cam) - exact));
            }
            expect(worstNew).toBeLessThan(0.5);
            if (z >= 0.1) expect(worstOld).toBeGreaterThan(0.5); // the unrebased path really is broken here
        });
    }
});
