// 19i "Rim atmosphere" data/wiring package: pure-function tests for the item-11 name override determinism, the
// item-12 message-key remap, the item-8/9/10 mood/gain weighting, the item-13-tail minimap dimming, and a
// flags-off no-op check across every module. The render half (rimGeometry/rimFraction/rimWeight/rimParams,
// eyes/derelicts/murk/tint) is covered by test/rim-atmosphere.test.ts; this file only exercises what this package
// added around it.

import { describe, expect, it } from 'vitest';
import type { Galaxy } from '../src/sim/galaxy';
import type { SystemInfo } from '../src/sim/types';
import { addText } from '../src/sim/textResolver';
import { GalaxyScenario } from '../src/sim/scenario/state';
import { buildRimNameOverrides, installRimNameOverrides, RIM_NAME_TABLE, RIM_NAMES_STATE_KEY, rimSystemDisplayName, formatSurveyDesignation } from '../src/sim/scenario/rimNames';
import { installRimWeights, RIM_WEIGHTS_STATE_KEY, rimWeightOfSystem } from '../src/sim/scenario/rimState';
import { rimMessageKey, rimText, RIM_TEXT_SUFFIX } from '../src/sim/scenario/rimMessages';
import { rimDistressCallChance } from '../src/sim/scenario/rimDistressCalls';
import {
    minimapRimDimAlpha,
    pickRimWeightedTrack,
    RIM_MOOD_TRACKS,
    rimAmbientBedGain,
    rimMoodProbability,
    rimVoiceStaticGain,
} from '../src/audio/rimAtmosphereMix';
import { rimWeightAt, rimWeightAtCapital, resetRimAudioGeometryCache } from '../src/audio/rimAtmosphereGeometry';
import { computeRimWeightsPerSystem, installRimAtmosphereData } from '../src/render/rimAtmosphereWiring';
import { nearestSystemName } from '../src/ui/hud';

function star(x: number, y: number, systemIndex: number): SystemInfo {
    return { systemStar: { xpos: x, ypos: y, systemIndex, name: `Base ${systemIndex}` } } as unknown as SystemInfo;
}

// Same four-system layout as test/rim-atmosphere.test.ts: 0/2/3 are progressively farther out, 1 stays central.
const SYSTEMS = [star(500, 500, 0), star(900, 500, 1), star(500, 100, 2), star(140, 500, 3)];

function fakeGalaxy(scenario: unknown): Galaxy {
    return { scenario, systems: SYSTEMS, sizeX: 1000, sizeY: 1000, randomSeed: 1, playerEmpire: null } as unknown as Galaxy;
}

function realScenario(flags: Record<string, boolean>, params: Record<string, number> = {}): GalaxyScenario {
    const s = new GalaxyScenario();
    s.flags = flags;
    s.params = params;
    return s;
}

describe('19i data/wiring: flags-off no-op', () => {
    for (const [name, scenario] of [
        ['no scenario', null],
        ['scenario without the flag', realScenario({ rimAtmosphere: false })],
    ] as const) {
        it(`touches nothing (${name})`, () => {
            addText('Rim Off Test Key;plain wording about {0}.');
            const g = fakeGalaxy(scenario);
            expect(computeRimWeightsPerSystem(g)).toEqual([]);
            installRimAtmosphereData(g); // must not throw, must not write scenario.state
            if (scenario !== null) expect((scenario as GalaxyScenario).state).toEqual({});
            expect(rimWeightAt(g, 0, 0)).toBe(0);
            expect(rimWeightAtCapital(g, null)).toBe(0);
            expect(rimSystemDisplayName({ scenario: scenario as GalaxyScenario | null }, 3, 'Base 3')).toBe('Base 3');
            expect(rimWeightOfSystem({ scenario: scenario as GalaxyScenario | null }, 3)).toBe(0);
            expect(rimText({ scenario: scenario as GalaxyScenario | null }, 'Rim Off Test Key', 3, 'Base 3')).toBe('plain wording about Base 3.');
            expect(nearestSystemName({ galaxy: { systems: SYSTEMS, scenario: scenario as GalaxyScenario | null } }, { x: 140, y: 500 })).toBe('Base 3');
        });
    }
});

describe('item 11: rim name overrides', () => {
    it('buildRimNameOverrides is deterministic for the same weights + seed', () => {
        const weights = [0, 0.4, 0, 1];
        const a = buildRimNameOverrides(weights, 42);
        const b = buildRimNameOverrides(weights, 42);
        expect(a).toEqual(b);
    });

    it('only assigns a name to systems with weight > 0', () => {
        const overrides = buildRimNameOverrides([0, 0.4, 0, 1], 42);
        expect(Object.keys(overrides).sort()).toEqual(['1', '3']);
    });

    it('a different seed gives a different assignment (very likely; checked over a spread of names)', () => {
        const weights = new Array(20).fill(1);
        const a = buildRimNameOverrides(weights, 1);
        const b = buildRimNameOverrides(weights, 2);
        expect(a).not.toEqual(b);
    });

    it('every name is either a table entry or a numbered survey designation', () => {
        const overrides = buildRimNameOverrides(new Array(30).fill(1), 7);
        for (const name of Object.values(overrides)) {
            expect(RIM_NAME_TABLE.includes(name) || /^Survey Site \d+-[A-Z]$/.test(name)).toBe(true);
        }
    });

    it('formatSurveyDesignation formats "Survey Site <n>-<letter>"', () => {
        expect(formatSurveyDesignation(417, 'Q')).toBe('Survey Site 417-Q');
    });

    it('rimSystemDisplayName: off the flag, no scenario, or no override all fall back to the base name', () => {
        expect(rimSystemDisplayName({ scenario: null }, 1, 'Base 1')).toBe('Base 1');
        expect(rimSystemDisplayName({ scenario: { flags: {}, state: {} } }, 1, 'Base 1')).toBe('Base 1');
        const withFlag = { scenario: { flags: { rimAtmosphere: true }, state: {} } };
        expect(rimSystemDisplayName(withFlag, 1, 'Base 1')).toBe('Base 1');
    });

    it('rimSystemDisplayName returns the installed override once one exists', () => {
        const s = realScenario({ rimAtmosphere: true });
        s.state[RIM_NAMES_STATE_KEY] = { 2: 'Cinderfall' };
        expect(rimSystemDisplayName({ scenario: s }, 2, 'Base 2')).toBe('Cinderfall');
        expect(rimSystemDisplayName({ scenario: s }, 0, 'Base 0')).toBe('Base 0');
    });

    it('installRimNameOverrides is idempotent and never touches galaxy.rnd', () => {
        const g = fakeGalaxy(realScenario({ rimAtmosphere: true }));
        installRimNameOverrides(g, [0, 1, 0, 1]);
        const first = { ...(g.scenario as GalaxyScenario).state[RIM_NAMES_STATE_KEY] as Record<number, string> };
        installRimNameOverrides(g, [0, 1, 0, 1]);
        expect((g.scenario as GalaxyScenario).state[RIM_NAMES_STATE_KEY]).toEqual(first);
    });

    it('installRimNameOverrides no-ops off the flag', () => {
        const g = fakeGalaxy(realScenario({ rimAtmosphere: false }));
        installRimNameOverrides(g, [1, 1, 1, 1]);
        expect((g.scenario as GalaxyScenario).state).toEqual({});
    });
});

describe('item 12: rim-specific message wording (text-key remap)', () => {
    it('rimMessageKey: the base key inside the rim, "<key> Rim" past it', () => {
        expect(rimMessageKey('Exploration Ship Lost Contact', 0)).toBe('Exploration Ship Lost Contact');
        expect(rimMessageKey('Exploration Ship Lost Contact', 0.5)).toBe(`Exploration Ship Lost Contact${RIM_TEXT_SUFFIX}`);
    });

    it('rimText resolves the rim wording only when the subject system has an installed weight > 0', () => {
        addText('Rim Test Key;base wording about {0}.\nRim Test Key Rim;rim wording about {0}, half heard through static.');
        const s = realScenario({ rimAtmosphere: true });
        s.state[RIM_WEIGHTS_STATE_KEY] = [0, 1];
        expect(rimText({ scenario: s }, 'Rim Test Key', 0, 'Alpha')).toBe('base wording about Alpha.');
        expect(rimText({ scenario: s }, 'Rim Test Key', 1, 'Alpha')).toBe('rim wording about Alpha, half heard through static.');
    });

    it('rimText falls back to the base key\'s text (then the literal key) with the flag off', () => {
        addText('Rim Fallback Key;plain wording about {0}.');
        expect(rimText({ scenario: null }, 'Rim Fallback Key', 0, 'Alpha')).toBe('plain wording about Alpha.');
        expect(rimText({ scenario: null }, 'Rim Nonexistent Key', 0)).toBe('Rim Nonexistent Key');
    });
});

describe('item 10 ticker half: distress-call chance', () => {
    it('is 0 at or inside rimInner', () => {
        expect(rimDistressCallChance(0.5, 0.72, 0.5)).toBe(0);
        expect(rimDistressCallChance(0.72, 0.72, 0.5)).toBe(0);
    });

    it('ramps up past rimInner and reaches distressCallRate at the band\'s outer edge', () => {
        const low = rimDistressCallChance(0.75, 0.72, 0.5);
        const high = rimDistressCallChance(0.95, 0.72, 0.5);
        expect(low).toBeGreaterThan(0);
        expect(high).toBeGreaterThanOrEqual(low);
        expect(high).toBeLessThanOrEqual(0.5);
    });

    it('is 0 with distressCallRate 0', () => {
        expect(rimDistressCallChance(0.99, 0.72, 0)).toBe(0);
    });
});

describe('items 8/9/10: mood weighting, ambient/static gain, minimap dimming', () => {
    it('rimMoodProbability clamps to [0, 1] and scales with weight × musicMoodWeight', () => {
        expect(rimMoodProbability(0, 0.8)).toBe(0);
        expect(rimMoodProbability(1, 0.8)).toBeCloseTo(0.8);
        expect(rimMoodProbability(2, 2)).toBe(1);
    });

    it('pickRimWeightedTrack prefers the mood pool when it draws below the probability', () => {
        const files = ['Action1.mp3', 'Shadows.mp3', 'Suspense.mp3'];
        const picked = pickRimWeightedTrack(files, RIM_MOOD_TRACKS, null, () => 0, 1); // rand()=0 < 1: always mood
        expect(RIM_MOOD_TRACKS).toContain(picked);
    });

    it('pickRimWeightedTrack never repeats the current file while more than one is available', () => {
        const files = ['Shadows.mp3', 'Suspense.mp3'];
        // rand sequence: 0 (use-mood check true), then 0, 0, 0.9 — first draw would repeat 'Shadows.mp3', loop redraws.
        const seq = [0, 0, 0, 0.9];
        let i = 0;
        const rand = () => seq[Math.min(i++, seq.length - 1)];
        const picked = pickRimWeightedTrack(files, files, 'Shadows.mp3', rand, 1);
        expect(picked).toBe('Suspense.mp3');
    });

    it('pickRimWeightedTrack falls back to the full pool when the mood pool alone cannot avoid repeating', () => {
        const files = ['Shadows.mp3', 'Suspense.mp3'];
        // A mood pool of exactly the current file would redraw it forever; the picker falls back to `files` before
        // the redraw loop, then escapes it the same way test above does (0, 0, then 0.9 → 'Suspense.mp3').
        const seq = [0, 0, 0.9];
        let i = 0;
        const rand = () => seq[Math.min(i++, seq.length - 1)];
        const picked = pickRimWeightedTrack(files, ['Shadows.mp3'], 'Shadows.mp3', rand, 1);
        expect(picked).toBe('Suspense.mp3');
    });

    it('pickRimWeightedTrack returns null for an empty pool', () => {
        expect(pickRimWeightedTrack([], RIM_MOOD_TRACKS, null, Math.random, 1)).toBeNull();
    });

    it('rimAmbientBedGain and rimVoiceStaticGain clamp to [0, 1] and scale linearly', () => {
        expect(rimAmbientBedGain(0, 0.35)).toBe(0);
        expect(rimAmbientBedGain(1, 0.35)).toBeCloseTo(0.35);
        expect(rimAmbientBedGain(1, 5)).toBe(1);
        expect(rimVoiceStaticGain(0, 0, 0.25)).toBe(0);
        expect(rimVoiceStaticGain(0.2, 0.8, 0.25)).toBeCloseTo(0.2); // the greater of the two weights wins
        expect(rimVoiceStaticGain(1, 1, 5)).toBe(1);
    });

    it('minimapRimDimAlpha: 1 (undimmed) at weight 0, dims toward (1 - dimStrength) at weight 1', () => {
        expect(minimapRimDimAlpha(0, 0.6)).toBe(1);
        expect(minimapRimDimAlpha(1, 0.6)).toBeCloseTo(0.4);
        expect(minimapRimDimAlpha(1, 5)).toBe(0);
    });
});

describe('rimWeightAt / rimWeightAtCapital (audio geometry glue)', () => {
    it('matches the render layer\'s own curve for a system placed well past rimInner', () => {
        const g = fakeGalaxy(realScenario({ rimAtmosphere: true }, { rimInner: 0.5 }));
        resetRimAudioGeometryCache(g);
        // System 1 (900, 500) is the farthest point from centre (500, 500) in this four-star set, so its fraction is 1
        // (the 98th-percentile radius), past rimInner=0.5: weight should be 1 (fully in the band's outer half+).
        expect(rimWeightAt(g, 900, 500)).toBeCloseTo(1);
        expect(rimWeightAt(g, 500, 500)).toBe(0); // the centre itself, inside rimInner
    });

    it('rimWeightAtCapital reads the capital\'s position; null/no-capital gives 0', () => {
        const g = fakeGalaxy(realScenario({ rimAtmosphere: true }, { rimInner: 0.5 }));
        resetRimAudioGeometryCache(g);
        expect(rimWeightAtCapital(g, null)).toBe(0);
        expect(rimWeightAtCapital(g, { capital: null } as never)).toBe(0);
        expect(rimWeightAtCapital(g, { capital: { xpos: 900, ypos: 500 } } as never)).toBeCloseTo(1);
    });
});

describe('computeRimWeightsPerSystem / installRimAtmosphereData (render wiring)', () => {
    it('lines up with galaxy.systems order and matches rimWeightAt at each star', () => {
        const g = fakeGalaxy(realScenario({ rimAtmosphere: true }, { rimInner: 0.5 }));
        resetRimAudioGeometryCache(g);
        const weights = computeRimWeightsPerSystem(g);
        expect(weights.length).toBe(SYSTEMS.length);
        for (let i = 0; i < SYSTEMS.length; i++) {
            const star = (SYSTEMS[i] as unknown as { systemStar: { xpos: number; ypos: number } }).systemStar;
            expect(weights[i]).toBeCloseTo(rimWeightAt(g, star.xpos, star.ypos));
        }
    });

    it('installs both the weights and the name overrides, readable back through the sim-safe helpers', () => {
        const g = fakeGalaxy(realScenario({ rimAtmosphere: true }, { rimInner: 0.5 }));
        resetRimAudioGeometryCache(g);
        installRimAtmosphereData(g);
        const weights = (g.scenario as GalaxyScenario).state[RIM_WEIGHTS_STATE_KEY] as number[];
        expect(weights.length).toBe(SYSTEMS.length);
        const rimIndex = weights.findIndex((w) => w > 0);
        expect(rimIndex).toBeGreaterThanOrEqual(0);
        expect(rimWeightOfSystem(g, rimIndex)).toBe(weights[rimIndex]);
        const names = (g.scenario as GalaxyScenario).state[RIM_NAMES_STATE_KEY] as Record<number, string>;
        expect(names[rimIndex]).toBeDefined();
    });
});
