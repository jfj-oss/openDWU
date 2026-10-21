import { describe, expect, it } from 'vitest';
import { shakturiOff, shakturiReplacedByBeacon, type CreateGameOptions } from '../src/sim/game';
import { VictoryConditions } from '../src/sim/victory';

describe("Giantworks' Beacon replaces the Return of the Shakturi storyline", () => {
    it('only when the Beacon will come: guaranteed, or at least the six-empire minimum', () => {
        const on = { threatGiantworks: true, gwBeacon: true };
        expect(shakturiReplacedByBeacon({ ...on, gwBeaconGuaranteed: true }, 3, 6)).toBe(true); // guaranteed ignores the minimum
        expect(shakturiReplacedByBeacon({ ...on, gwBeaconGuaranteed: false }, 6, 6)).toBe(true);
        expect(shakturiReplacedByBeacon({ ...on, gwBeaconGuaranteed: false }, 5, 6)).toBe(false); // too few empires to roll it
        expect(shakturiReplacedByBeacon({ threatGiantworks: true, gwBeacon: false, gwBeaconGuaranteed: true }, 10, 6)).toBe(false);
        expect(shakturiReplacedByBeacon({ gwBeacon: true }, 10, 6)).toBe(false);
    });
    it('turns only the Shakturi story off; the Distant Worlds and Shadows stories stay', () => {
        const vc = new VictoryConditions();
        vc.enableStoryEvents = true;
        vc.enableStoryEventsShadows = true;
        const o = shakturiOff({ storyReturnOfTheShakturiEnabled: true, storyDistantWorldsEnabled: true, storyShadowsEnabled: true, victoryConditions: vc } as unknown as CreateGameOptions);
        expect(o.storyReturnOfTheShakturiEnabled).toBe(false);
        expect(o.victoryConditions!.enableStoryEvents).toBe(false);
        expect(o.storyDistantWorldsEnabled).toBe(true);
        expect(o.storyShadowsEnabled).toBe(true);
        expect(o.victoryConditions!.enableStoryEventsShadows).toBe(true);
        expect(vc.enableStoryEvents).toBe(true); // the caller's object is not changed
    });
});
