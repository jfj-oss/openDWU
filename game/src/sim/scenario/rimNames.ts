// 19i "Rim atmosphere" item 11 — bleaker rim name table + numbered survey designations (tasks/19-mod-layer-scenarios.md
// §19i item 11). Not a port: display-time only, so generation (Galaxy.4.cs AssignSystemName, galaxy.ts
// assignSystemName) is untouched — the sim digest and every existing pin stay byte-identical.
//
// Determinism: buildRimNameOverrides draws from its own Random, seeded off galaxy.randomSeed the same way the other
// galaxy-seed-derived streams do (colonyTick.ts baconHabitatClockRnd, espionagePrisoners.ts baconSpyClockRnd: `new
// Random((galaxy.randomSeed ^ <tag>) | 0)`), never galaxy.rnd — so installing the overrides at game start draws
// nothing from the shared stream and moves no pin. The result lives only in GalaxyScenario.state (below), read back
// by rimSystemDisplayName; Habitat.name itself is never written.
//
// This module stays sim-safe (no render/Pixi import): the render-side wiring that turns star positions into rim
// weights (rimGeometry/rimFraction/rimWeight/rimParams, src/render/rimAtmosphereLayer.ts) lives in
// src/render/rimAtmosphereWiring.ts and calls installRimNameOverrides with the weights it computed.

import { Random } from '../random';
import type { Galaxy } from '../galaxy';
import { RIM_FLAG_NAME } from './rimShared';
import { scenarioState } from './state';

/** Bleak rim names (a separate table from systemNames.txt, item 11: "bleaker rim name table"). */
export const RIM_NAME_TABLE: readonly string[] = [
    'Cinderfall',
    'Ashreach',
    "Widow's Drift",
    'Hollow Verge',
    'Last Light',
    'Graveyard Deep',
    'Coldmark',
    'Forsaken Reach',
    'Bleakhaven',
    'Nightfall Rim',
    "Derelict's Rest",
    'Farwatch',
    'Stillness',
    'Gravemark',
    'Thin Air',
    'Emberfade',
    'Driftwood Deep',
    "No Man's Marches",
    'Quiet Dark',
    'Skeleton Reach',
    'Rimfall',
    'Deadlight',
];

/** Letters a numbered survey designation draws its suffix from (no I / O: original survey-log flavour, avoids 1/0
 *  confusion in the ticker). */
const SURVEY_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/** A "more numbered survey designations" name (item 11): "Survey Site <100-999>-<letter>". */
export function formatSurveyDesignation(n: number, letter: string): string {
    return `Survey Site ${n}-${letter}`;
}

/** One rim name draw: 40% a still-unused bleak name (falls back to a survey designation once the table is
 *  exhausted), else a numbered survey designation. Mirrors galaxy.ts assignSystemName's draw shape but on its own
 *  Random (never galaxy.rnd) and with no habitat write. */
function pickRimName(rnd: Random, usedPlain: Set<number>): string {
    if (usedPlain.size < RIM_NAME_TABLE.length && rnd.nextDouble() < 0.4) {
        let index = rnd.next(0, RIM_NAME_TABLE.length);
        let tries = 0;
        while (usedPlain.has(index) && tries < 100) {
            index = rnd.next(0, RIM_NAME_TABLE.length);
            tries++;
        }
        if (!usedPlain.has(index)) {
            usedPlain.add(index);
            return RIM_NAME_TABLE[index];
        }
    }
    const n = rnd.next(100, 999);
    const letter = SURVEY_LETTERS[rnd.next(0, SURVEY_LETTERS.length)];
    return formatSurveyDesignation(n, letter);
}

/**
 * Pure: a rim name for every system index whose `rimWeights[i] > 0` (0 = inside `rimInner`, per rimWeight()), drawn
 * in ascending index order from one Random seeded with `seed`. Same `rimWeights` + `seed` always yields the same
 * map (test/rimAtmosphereNames.test.ts determinism check); systems at weight 0 get no entry (rimSystemDisplayName
 * then falls back to the base name).
 */
export function buildRimNameOverrides(rimWeights: readonly number[], seed: number): Record<number, string> {
    const rnd = new Random(seed);
    const usedPlain = new Set<number>();
    const out: Record<number, string> = {};
    for (let i = 0; i < rimWeights.length; i++) {
        if (!(rimWeights[i] > 0)) continue;
        out[i] = pickRimName(rnd, usedPlain);
    }
    return out;
}

/** GalaxyScenario.state key the overrides are kept under. */
export const RIM_NAMES_STATE_KEY = 'rimAtmosphere.names';

/** 'RIMN' as a 32-bit tag, xored into galaxy.randomSeed for this module's Random (the running convention above). */
const RIM_NAMES_SEED_TAG = 0x52494d4e;

/**
 * Installs the item-11 overrides in GalaxyScenario.state (idempotent: a second call keeps the first result). No-op
 * when the scenario flag is off — callers (src/render/rimAtmosphereWiring.ts) also skip this when rimParams(galaxy)
 * is null, so with no scenario or the flag off nothing is read or written here.
 */
export function installRimNameOverrides(galaxy: Galaxy, rimWeights: readonly number[]): void {
    const s = galaxy.scenario;
    if (s === null || s.flags[RIM_FLAG_NAME] !== true) return;
    scenarioState(galaxy, RIM_NAMES_STATE_KEY, () => buildRimNameOverrides(rimWeights, (galaxy.randomSeed ^ RIM_NAMES_SEED_TAG) | 0));
}

/** Minimal shape rimSystemDisplayName needs: real Galaxy and hud.ts's duck-typed camera-label galaxy are both this. */
export interface RimNameHost {
    scenario: { flags: Record<string, boolean>; state: Record<string, unknown> } | null;
}

/**
 * Display-time override (item 11): the rim name for `systemIndex`, or `baseName` with the flag off, no scenario, or
 * no override for that system. Never mutates any Habitat — every caller shows this instead of habitat.name /
 * systemStar.name wherever a system name reaches the screen.
 */
export function rimSystemDisplayName(galaxy: RimNameHost, systemIndex: number, baseName: string): string {
    const s = galaxy.scenario;
    if (s === null || s.flags[RIM_FLAG_NAME] !== true) return baseName;
    const overrides = s.state[RIM_NAMES_STATE_KEY] as Record<number, string> | undefined;
    return overrides?.[systemIndex] ?? baseName;
}
