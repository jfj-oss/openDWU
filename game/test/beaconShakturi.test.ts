import { describe, expect, it } from 'vitest';
import { shakturiOff, shakturiReplacedByBeacon, type CreateGameOptions } from '../src/sim/game';
import { VictoryConditions } from '../src/sim/victory';

describe("Giantworks' Beacon replaces the Return of the Shakturi storyline", () => {
    it('is on only with Giantworks and its Beacon both on', () => {
        expect(shakturiReplacedByBeacon({ threatGiantworks: true, gwBeacon: true })).toBe(true);
        expect(shakturiReplacedByBeacon({ threatGiantworks: true, gwBeacon: false })).toBe(false);
        expect(shakturiReplacedByBeacon({ gwBeacon: true })).toBe(false);
        expect(shakturiReplacedByBeacon({})).toBe(false);
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
