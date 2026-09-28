// Scenario test harness (tasks/MODLAYER-DESIGN.md §5): load a scenario overlay from the repo's scenarios/ folder (or
// build one inline), apply it over the fs-loaded base GameData, and create the standard seed-1 tick game with it.
// Scenario games are not taken from the test game cache (gameCache.ts keys on the base data only).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { GameData } from '../../src/sim/data/gameData';
import { createGame, type CreateGameOptions, type Game } from '../../src/sim/game';
import { applyScenarioOverlay, resolveScenarioIncludes, type ScenarioOverlay } from '../../src/sim/scenario/overlay';
import { parseScenarioManifest, type ScenarioManifest } from '../../src/sim/scenario/manifest';
import { buildScenarioIndex } from '../../scripts/scenarioIndex.mjs';
import { tickGameOptions } from './tickGame';

export const SCENARIOS_ROOT = resolve(__dirname, '../../scenarios');

/** The index the dev server / build serve at /assets/scenarios/index.json. */
export function scenarioIndexFs(): ScenarioManifest[] {
    return buildScenarioIndex(SCENARIOS_ROOT).scenarios.map((m) => parseScenarioManifest(m));
}

function readOverlayFs(manifest: ScenarioManifest): ScenarioOverlay {
    const files = new Map<string, string>();
    for (const f of manifest.files) files.set(f, readFileSync(resolve(SCENARIOS_ROOT, manifest.id, f), 'utf8'));
    return { manifest, files };
}

/** Every scenarios/<id>/ as an unresolved ScenarioOverlay, by id (the add-on picker's composite reads these). */
export function scenarioOverlaysFs(): Map<string, ScenarioOverlay> {
    return new Map(scenarioIndexFs().map((m) => [m.id, readOverlayFs(m)] as const));
}

/** scenarios/<id>/ as a ScenarioOverlay (manifest + every file), its `include`s resolved from the same folder. */
export function loadScenarioOverlayFs(id: string): ScenarioOverlay {
    const byId = scenarioOverlaysFs();
    const overlay = byId.get(id);
    if (overlay === undefined) throw new Error(`no scenario ${id} under ${SCENARIOS_ROOT}`);
    return resolveScenarioIncludes(overlay, byId);
}

/** An inline overlay for tests: a manifest (plain object, validated) plus files. */
export function inlineOverlay(manifest: Record<string, unknown>, files: Record<string, string> = {}): ScenarioOverlay {
    return { manifest: parseScenarioManifest({ ...manifest, files: Object.keys(files) }), files: new Map(Object.entries(files)) };
}

export interface ScenarioGameOptions {
    /** A scenario folder id or an overlay (inlineOverlay / loadScenarioOverlayFs). */
    scenario: string | ScenarioOverlay;
    flags?: Record<string, boolean>;
    params?: Record<string, number>;
    /** Changes to the standard tick-game options (seed 1, 300 stars, Human + 3 AIs, pirates on). */
    options?: (o: CreateGameOptions) => CreateGameOptions;
}

/** The base GameData with the scenario applied. */
export function scenarioGameData(base: GameData, scenario: string | ScenarioOverlay): GameData {
    return applyScenarioOverlay(base, typeof scenario === 'string' ? loadScenarioOverlayFs(scenario) : scenario);
}

/** The standard seed-1 tick game (test/helpers/tickGame.ts) created with a scenario. */
export function createScenarioGame(base: GameData, o: ScenarioGameOptions): { game: Game; gameData: GameData } {
    const gameData = scenarioGameData(base, o.scenario);
    let opts: CreateGameOptions = { ...tickGameOptions(gameData), scenarioFlags: o.flags, scenarioParams: o.params };
    if (o.options !== undefined) opts = o.options(opts);
    return { game: createGame(opts), gameData };
}
