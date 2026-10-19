// beaconCloakFx.ts: the Watchers' cloak visuals (render only): the reveal's pace, the lights' gate, the sightings' fade.
import { describe, expect, it } from 'vitest';
import { CLOAK_TRANSITION_S, cloakGlow, cloakLightGate, cloakStep, watcherSightings } from '../src/render/beaconCloakFx';
import type { BuiltObject } from '../src/sim/builtObject';
import type { Empire } from '../src/sim/empire';

describe('the Watchers\' cloak (render only)', () => {
    it('a decloak / re-cloak takes CLOAK_TRANSITION_S; the engines come up late, the lights last', () => {
        expect(CLOAK_TRANSITION_S).toBeGreaterThanOrEqual(1.5);
        expect(CLOAK_TRANSITION_S).toBeLessThanOrEqual(2.5);
        let r = 0;
        let t = 0;
        while (r < 1 && t < 10) {
            r = cloakStep(r, 1, 0.05);
            t += 0.05;
        }
        expect(t).toBeCloseTo(CLOAK_TRANSITION_S, 1);
        expect(cloakStep(1, 0, CLOAK_TRANSITION_S / 2)).toBeCloseTo(0.5, 9);
        expect(cloakGlow(0.4)).toBe(0);
        expect(cloakGlow(1)).toBe(1);
        expect(cloakLightGate(0.7, 3.1, 2)).toBe(0);
        expect(cloakLightGate(1, 3.1, 2)).toBe(1);
        let on = 0;
        for (let i = 0; i < 200; i++) on += cloakLightGate(0.9, i * 0.013, 5);
        expect(on).toBeGreaterThan(40);
        expect(on).toBeLessThan(160);
    });

    it('a sighting stays where the viewer detected the Watcher, fading out over its seen-through span', () => {
        const viewer = { empireId: 3 } as Empire;
        const w = { xpos: 100, ypos: 200, hasBeenDestroyed: false, cloakSeenBy: [{ empireId: 3, until: 1000 }] } as unknown as BuiltObject;
        const out: { x: number; y: number; fade: number }[] = [];
        expect(watcherSightings([w], viewer, 0, out)).toBe(1);
        expect(out[0].fade).toBeCloseTo(1, 9);
        w.xpos = 5000; // it moves on, the sighting stays put
        expect(watcherSightings([w], viewer, 500, out)).toBe(1);
        expect(out[0].x).toBe(100);
        expect(out[0].fade).toBeCloseTo(0.5, 9);
        expect(watcherSightings([w], { empireId: 4 } as Empire, 1001, out)).toBe(0);
    });
});
